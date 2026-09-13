import { Camera } from '../engine/camera';
import type { FullscreenCanvas } from '../engine/canvas';
import type { Game } from '../game/game';
import { borderOf, borderPoints, isDone, MATERIAL_BY_ID, progressOf, WALL_HEIGHT, workLevel, type Border, type FloorTile, type Side, type Wall } from '../game/building';
import { hash2 } from '../world/noise';
import { ROCK_VARIANTS, TileType, TILE_DEFS, bushSpecies, rockVariant, treeSpecies, treeVariant } from '../world/tiles';
import { HALF_H, HALF_W, HEIGHT_SCALE, UNITS_PER_TILE } from './iso';
import { bushSprite, drawPlayer, pileSprite, tokenSprite, treeSprite, type Sprite } from './sprites';

/** Result of picking a screen point: the tile, the approximate world position and the nearest corner. */
export interface Pick {
  x: number;
  y: number;
  wx: number;
  wy: number;
  cx: number;
  cy: number;
}

interface Entity {
  kind: 'tree' | 'bush' | 'player' | 'pile' | 'token';
  x: number;
  y: number;
  sx: number;
  sy: number;
  spr: Sprite | null;
}

interface HitRect {
  x: number;
  y: number;
  left: number;
  top: number;
  w: number;
  h: number;
}

const VOID_COLOR = '#12395f';
const GRID_COLOR = 'rgba(0,0,0,0.16)';
const DEED_COLOR = 'rgba(96, 230, 110, 0.9)';
const DEED_SHADOW = 'rgba(0, 40, 0, 0.6)';
const PLAN_COLOR = 'rgba(120, 220, 140, 0.95)';
const SIDES: Side[] = ['n', 'e', 's', 'w'];

/** Which side of a tile a picked point is closest to. */
export function nearestSide(x: number, y: number, wx: number, wy: number): Side {
  const dn = wy - y;
  const ds = y + 1 - wy;
  const dw = wx - x;
  const de = x + 1 - wx;
  const m = Math.min(dn, ds, dw, de);
  return m === dn ? 'n' : m === ds ? 's' : m === dw ? 'w' : 'e';
}

const rgb = (c: readonly [number, number, number], k: number, a = 1): string =>
  `rgba(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0},${a})`;
const WATER_STEPS = 24;
const WATER_SHALLOW = [86, 168, 190];
const WATER_DEEP = [16, 58, 118];

function normalize(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** Light arrives from the upper-left of the screen, slightly from the top. */
const LIGHT = normalize(-0.62, -0.28, 0.72);

const WATER_PALETTE: string[] = [];
for (let i = 0; i < WATER_STEPS; i++) {
  const t = Math.pow(i / (WATER_STEPS - 1), 0.75);
  const r = Math.round(WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * t);
  const g = Math.round(WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * t);
  const b = Math.round(WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * t);
  WATER_PALETTE.push(`rgba(${r},${g},${b},${(0.42 + 0.5 * t).toFixed(3)})`);
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/**
 * Draws the world onto the full-page canvas: terrain quads back to front, one
 * diagonal at a time, with trees and the player slotted in at their depth.
 */
export class Renderer {
  readonly camera = new Camera();
  time = 0;
  hover: Pick | null = null;
  fps = 0;
  private colors: (string | null)[];
  private treeHits: HitRect[] = [];
  private pts = new Float64Array(8);
  private cornerBuf = [0, 0, 0, 0];
  private ents: Entity[] = [];
  private waterPoly = new Float64Array(16);
  private drawnTiles = 0;
  private tileBuf = [0, 0];
  private playerFacing = 1;

  constructor(
    private readonly canvas: FullscreenCanvas,
    private readonly game: Game,
  ) {
    this.colors = new Array<string | null>(game.world.w * game.world.h).fill(null);
    game.world.onChange((x, y) => this.invalidate(x, y));
    canvas.onResize(() => this.camera.setViewport(canvas.width, canvas.height));
    this.camera.setViewport(canvas.width, canvas.height);
  }

  get tilesDrawn(): number {
    return this.drawnTiles;
  }

  private invalidate(x: number, y: number): void {
    const w = this.game.world;
    for (let yy = y - 1; yy <= y + 1; yy++) {
      for (let xx = x - 1; xx <= x + 1; xx++) {
        if (w.inBounds(xx, yy)) this.colors[yy * w.w + xx] = null;
      }
    }
  }

  /** Flat-shaded colour for a tile: base colour, slope lighting, per-tile variation and depth tint under water. */
  private computeColor(x: number, y: number): string {
    const w = this.game.world;
    const type = w.getTile(x, y);
    const def = TILE_DEFS[type];
    const c = w.corners(x, y, this.cornerBuf);
    const gx = (c[1] + c[2] - (c[0] + c[3])) / 2 / UNITS_PER_TILE;
    const gy = (c[2] + c[3] - (c[0] + c[1])) / 2 / UNITS_PER_TILE;
    const len = Math.hypot(gx, gy, 1);
    const dot = (-gx * LIGHT[0] - gy * LIGHT[1] + LIGHT[2]) / len;
    let shade = 0.48 + 0.6 * Math.max(0, dot);
    const base = type === TileType.Rock ? ROCK_VARIANTS[rockVariant(w.getData(x, y))].color : def.color;
    let r = base[0];
    let g = base[1];
    let b = base[2];
    const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
    if (avg >= 0) shade *= 1 + (hash2(x, y, 9) - 0.5) * 0.1;
    else {
      const k = Math.max(0.3, 1 - -avg / 80);
      r *= 0.72 * k;
      g *= 0.86 * k;
      b *= 0.95 * k;
    }
    return `rgb(${clamp255(r * shade)},${clamp255(g * shade)},${clamp255(b * shade)})`;
  }

  render(dt: number): void {
    this.time += dt;
    const canvas = this.canvas;
    const ctx = canvas.ctx;
    const W = canvas.width;
    const H = canvas.height;
    const cam = this.camera;
    const world = this.game.world;
    const zoom = cam.zoom;
    cam.setViewport(W, H);
    canvas.begin();
    ctx.fillStyle = VOID_COLOR;
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';

    const b = cam.isoBounds();
    const eMin = Math.floor(b.left / HALF_W) - 1;
    const eMax = Math.ceil(b.right / HALF_W) + 1;
    const dLo = Math.floor((b.top + world.minHeight * HEIGHT_SCALE) / HALF_H) - 2;
    const dHi = Math.ceil((b.bottom + world.maxHeight * HEIGHT_SCALE) / HALF_H) + 1;
    const grid = this.game.settings.grid && zoom >= 0.7;
    const player = this.game.player;
    const rot = cam.rotation;
    const tb = this.tileBuf;
    this.worldToViewTile(rot, player.tileX, player.tileY, tb);
    const playerDepth = tb[0] + tb[1];
    const hw = HALF_W * zoom;
    const hh = HALF_H * zoom;
    const hs = HEIGHT_SCALE * zoom;
    const bottomMargin = 140 * zoom;
    const pts = this.pts;
    const c = this.cornerBuf;
    this.treeHits.length = 0;
    this.drawnTiles = 0;

    for (let d = dLo; d <= dHi; d++) {
      this.ents.length = 0;
      const baseY = (d * HALF_H - cam.cy) * zoom + H / 2;
      let e = eMin;
      if (((e + d) & 1) !== 0) e++;
      for (; e <= eMax; e += 2) {
        const u = (d + e) / 2;
        const v = (d - e) / 2;
        this.viewToWorldTile(rot, u, v, tb);
        const x = tb[0];
        const y = tb[1];
        if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
        this.viewCorners(rot, u, v, c);
        const baseX = (e * HALF_W - cam.cx) * zoom + W / 2;
        pts[0] = baseX;
        pts[1] = baseY - c[0] * hs;
        pts[2] = baseX + hw;
        pts[3] = baseY + hh - c[1] * hs;
        pts[4] = baseX;
        pts[5] = baseY + 2 * hh - c[2] * hs;
        pts[6] = baseX - hw;
        pts[7] = baseY + hh - c[3] * hs;
        const minY = Math.min(pts[1], pts[3], pts[5], pts[7]);
        const maxY = Math.max(pts[1], pts[3], pts[5], pts[7]);
        if (maxY < 0 || minY > H + bottomMargin) continue;
        this.drawnTiles++;

        const idx = y * world.w + x;
        let color = this.colors[idx];
        if (!color) {
          color = this.computeColor(x, y);
          this.colors[idx] = color;
        }
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        ctx.lineTo(pts[2], pts[3]);
        ctx.lineTo(pts[4], pts[5]);
        ctx.lineTo(pts[6], pts[7]);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        const wet = c[0] < 0 || c[1] < 0 || c[2] < 0 || c[3] < 0;
        ctx.strokeStyle = grid && !wet ? GRID_COLOR : color;
        ctx.stroke();
        if (wet) this.drawWater(u, v, x, y, c);

        const t = world.getTile(x, y);
        if (t === TileType.Tree || t === TileType.Bush) {
          const data = world.getData(x, y);
          const spr = t === TileType.Tree ? treeSprite(treeSpecies(data), treeVariant(data)) : bushSprite(bushSpecies(data));
          const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
          this.ents.push({ kind: t === TileType.Tree ? 'tree' : 'bush', x, y, sx: baseX, sy: baseY + hh - avg * hs, spr });
        }
        if (this.game.ground.size && this.game.groundAt(x, y).length) {
          const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
          this.ents.push({ kind: 'pile', x, y, sx: baseX, sy: baseY + hh - avg * hs, spr: pileSprite() });
        }
        if (this.game.isToken(x, y)) {
          const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
          this.ents.push({ kind: 'token', x, y, sx: baseX, sy: baseY + hh - avg * hs, spr: tokenSprite() });
        }
        if (this.game.buildings.list.size) this.drawStructures(x, y, rot, d > playerDepth);
      }

      if (d === playerDepth) {
        const ph = world.heightAt(player.x, player.y);
        this.ents.push({
          kind: 'player',
          x: player.tileX,
          y: player.tileY,
          sx: cam.worldToScreenX(player.x, player.y),
          sy: cam.worldToScreenY(player.x, player.y, Math.max(ph, -4)),
          spr: null,
        });
      }
      if (this.ents.length) this.drawEntities(ctx, zoom);
    }

    this.drawOverlays(ctx, zoom);
  }

  /** View-space tile (u, v) to world tile, written into `out`. */
  private viewToWorldTile(rot: number, u: number, v: number, out: number[]): void {
    switch (rot) {
      case 1:
        out[0] = -v - 1;
        out[1] = u;
        break;
      case 2:
        out[0] = -u - 1;
        out[1] = -v - 1;
        break;
      case 3:
        out[0] = v;
        out[1] = -u - 1;
        break;
      default:
        out[0] = u;
        out[1] = v;
    }
  }

  /** World tile to view-space tile, written into `out`. */
  private worldToViewTile(rot: number, x: number, y: number, out: number[]): void {
    switch (rot) {
      case 1:
        out[0] = y;
        out[1] = -x - 1;
        break;
      case 2:
        out[0] = -x - 1;
        out[1] = -y - 1;
        break;
      case 3:
        out[0] = -y - 1;
        out[1] = x;
        break;
      default:
        out[0] = x;
        out[1] = y;
    }
  }

  /** Corner heights of view tile (u, v) in screen order: top, right, bottom, left. */
  private viewCorners(rot: number, u: number, v: number, out: number[]): void {
    const w = this.game.world;
    switch (rot) {
      case 1:
        out[0] = w.getHeight(-v, u);
        out[1] = w.getHeight(-v, u + 1);
        out[2] = w.getHeight(-v - 1, u + 1);
        out[3] = w.getHeight(-v - 1, u);
        break;
      case 2:
        out[0] = w.getHeight(-u, -v);
        out[1] = w.getHeight(-u - 1, -v);
        out[2] = w.getHeight(-u - 1, -v - 1);
        out[3] = w.getHeight(-u, -v - 1);
        break;
      case 3:
        out[0] = w.getHeight(v, -u);
        out[1] = w.getHeight(v, -u - 1);
        out[2] = w.getHeight(v + 1, -u - 1);
        out[3] = w.getHeight(v + 1, -u);
        break;
      default:
        out[0] = w.getHeight(u, v);
        out[1] = w.getHeight(u + 1, v);
        out[2] = w.getHeight(u + 1, v + 1);
        out[3] = w.getHeight(u, v + 1);
    }
  }

  private drawEntities(ctx: CanvasRenderingContext2D, zoom: number): void {
    const ents = this.ents;
    if (ents.length > 1) ents.sort((a, b) => a.sx - b.sx);
    const player = this.game.player;
    const cam = this.camera;
    const screenDx = cam.rotateX(player.dirX, player.dirY) - cam.rotateY(player.dirX, player.dirY);
    if (Math.abs(screenDx) > 0.05) this.playerFacing = screenDx > 0 ? 1 : -1;
    for (const ent of ents) {
      if (ent.kind === 'player') {
        drawPlayer(ctx, ent.sx, ent.sy, zoom, {
          phase: player.moving ? player.walkPhase : this.time * 6,
          moving: player.moving,
          facing: this.playerFacing,
          swimming: player.swimming,
          working: this.game.action?.state === 'performing',
        });
        continue;
      }
      const spr = ent.spr;
      if (!spr) continue;
      const dw = spr.w * zoom;
      const dh = spr.h * zoom;
      const left = ent.sx - spr.ax * zoom;
      const top = ent.sy - spr.ay * zoom;
      ctx.drawImage(spr.canvas, left, top, dw, dh);
      if (ent.kind === 'tree') {
        this.treeHits.push({ x: ent.x, y: ent.y, left: left + dw * 0.22, top: top + dh * 0.12, w: dw * 0.56, h: dh * 0.86 });
      }
    }
  }

  /**
   * Floors and walls belonging to a tile. Walls are drawn on the two borders
   * that are the tile's back edges in the current rotation, so every wall is
   * drawn exactly once, after the ground behind it and before whatever stands
   * in front. Walls of the building the player is inside go translucent once
   * they would hide the player.
   */
  private drawStructures(x: number, y: number, rot: number, inFront: boolean): void {
    const bld = this.game.buildings;
    const w = this.game.world;
    const inside = bld.buildingAt(this.game.player.tileX, this.game.player.tileY);
    const building = bld.buildingAt(x, y);
    const base = w.getHeight(x, y);
    let backA: Border;
    let backB: Border;
    switch (rot) {
      case 1:
        backA = borderOf(x, y, 'n');
        backB = borderOf(x, y, 'e');
        break;
      case 2:
        backA = borderOf(x, y, 'e');
        backB = borderOf(x, y, 's');
        break;
      case 3:
        backA = borderOf(x, y, 's');
        backB = borderOf(x, y, 'w');
        break;
      default:
        backA = borderOf(x, y, 'n');
        backB = borderOf(x, y, 'w');
    }
    const maxLevels = building ? building.levels : this.maxLevelsAround(x, y);
    for (let level = 0; level < maxLevels; level++) {
      if (building) {
        const floor = bld.floor(level, x, y);
        if (floor) this.drawFloor(floor, x, y, base, inside?.id === building.id && level > 0 ? 0.35 : 1);
      }
      for (const border of [backA, backB]) {
        const wall = bld.wallOnBorder(level, border);
        if (!wall) continue;
        const dim = inside?.id === wall.building && (inFront || level > 0);
        this.drawWall(wall, border, base, dim ? 0.35 : 1);
      }
    }
  }

  /** Storeys of any building touching a tile's borders, for tiles just outside a footprint. */
  private maxLevelsAround(x: number, y: number): number {
    let m = 0;
    for (const [dx, dy] of [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ]) {
      const b = this.game.buildings.buildingAt(x + dx, y + dy);
      if (b && b.levels > m) m = b.levels;
    }
    return m;
  }

  private drawFloor(floor: FloorTile, x: number, y: number, base: number, alpha: number): void {
    const ctx = this.canvas.ctx;
    const cam = this.camera;
    const mat = MATERIAL_BY_ID.get(floor.material);
    if (!mat) return;
    const h = base + floor.level * WALL_HEIGHT + 0.5;
    const done = isDone(floor);
    ctx.globalAlpha = alpha * (done ? 1 : 0.4);
    ctx.beginPath();
    ctx.moveTo(cam.worldToScreenX(x, y), cam.worldToScreenY(x, y, h));
    ctx.lineTo(cam.worldToScreenX(x + 1, y), cam.worldToScreenY(x + 1, y, h));
    ctx.lineTo(cam.worldToScreenX(x + 1, y + 1), cam.worldToScreenY(x + 1, y + 1, h));
    ctx.lineTo(cam.worldToScreenX(x, y + 1), cam.worldToScreenY(x, y + 1, h));
    ctx.closePath();
    ctx.fillStyle = rgb(mat.floor, 0.95);
    ctx.fill();
    ctx.strokeStyle = done ? rgb(mat.trim, 1) : PLAN_COLOR;
    if (!done) ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  private drawWall(wall: Wall, border: Border, base: number, alpha: number): void {
    const ctx = this.canvas.ctx;
    const cam = this.camera;
    const mat = MATERIAL_BY_ID.get(wall.material);
    if (!mat) return;
    const [ax, ay, bx, by] = borderPoints(border);
    const h0 = base + wall.level * WALL_HEIGHT;
    const h1 = h0 + WALL_HEIGHT;
    // A point on the wall face: t along the border, k up the height.
    const px = (t: number, k: number): number => cam.worldToScreenX(ax + (bx - ax) * t, ay + (by - ay) * t);
    const py = (t: number, k: number): number => cam.worldToScreenY(ax + (bx - ax) * t, ay + (by - ay) * t, h0 + (h1 - h0) * k);
    const quad = (t0: number, t1: number, k0: number, k1: number): void => {
      ctx.beginPath();
      ctx.moveTo(px(t0, k0), py(t0, k0));
      ctx.lineTo(px(t1, k0), py(t1, k0));
      ctx.lineTo(px(t1, k1), py(t1, k1));
      ctx.lineTo(px(t0, k1), py(t0, k1));
      ctx.closePath();
    };
    // The face running along the view's x axis catches the light.
    const vx = cam.rotateX(bx - ax, by - ay);
    const vy = cam.rotateY(bx - ax, by - ay);
    const lit = Math.abs(vx) >= Math.abs(vy) ? (vx > 0 ? 1 : 0.8) : 0.72;
    const done = isDone(wall);
    ctx.globalAlpha = alpha;
    if (!done) {
      const progress = progressOf(wall);
      quad(0, 1, 0, 1);
      ctx.fillStyle = rgb(mat.color, lit, 0.22);
      ctx.fill();
      ctx.strokeStyle = PLAN_COLOR;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (progress > 0) {
        quad(0, 1, 0, progress);
        ctx.fillStyle = rgb(mat.color, lit, 0.85);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    quad(0, 1, 0, 1);
    ctx.fillStyle = rgb(mat.color, lit);
    ctx.fill();
    ctx.strokeStyle = rgb(mat.trim, lit);
    ctx.stroke();
    if (mat.id === 'log') {
      ctx.strokeStyle = rgb(mat.trim, lit, 0.5);
      for (let k = 0.2; k < 1; k += 0.2) {
        ctx.beginPath();
        ctx.moveTo(px(0, k), py(0, k));
        ctx.lineTo(px(1, k), py(1, k));
        ctx.stroke();
      }
    } else if (mat.id === 'timbercraft') {
      ctx.strokeStyle = rgb(mat.trim, lit);
      ctx.lineWidth = 2;
      for (const t of [0.33, 0.66]) {
        ctx.beginPath();
        ctx.moveTo(px(t, 0), py(t, 0));
        ctx.lineTo(px(t, 1), py(t, 1));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(px(0, 0.5), py(0, 0.5));
      ctx.lineTo(px(1, 0.5), py(1, 0.5));
      ctx.stroke();
      ctx.lineWidth = 1;
    } else if (mat.kind === 'stone' && mat.id !== 'marble') {
      ctx.strokeStyle = rgb(mat.trim, lit, 0.35);
      for (let k = 0.25; k < 1; k += 0.25) {
        ctx.beginPath();
        ctx.moveTo(px(0, k), py(0, k));
        ctx.lineTo(px(1, k), py(1, k));
        ctx.stroke();
      }
    }
    if (mat.id.startsWith('ornate')) {
      ctx.strokeStyle = rgb(mat.trim, 1);
      ctx.lineWidth = 2;
      quad(0.06, 0.94, 0.08, 0.92);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    switch (wall.type) {
      case 'window':
        quad(0.32, 0.68, 0.4, 0.78);
        ctx.fillStyle = 'rgba(150, 200, 235, 0.75)';
        ctx.fill();
        ctx.strokeStyle = rgb(mat.trim, lit);
        ctx.stroke();
        break;
      case 'bay':
        quad(0.2, 0.8, 0.35, 0.82);
        ctx.fillStyle = 'rgba(150, 200, 235, 0.75)';
        ctx.fill();
        ctx.strokeStyle = rgb(mat.trim, lit);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
        break;
      case 'door':
        quad(0.36, 0.64, 0, 0.72);
        ctx.fillStyle = 'rgba(40, 28, 18, 0.9)';
        ctx.fill();
        ctx.strokeStyle = rgb(mat.trim, lit);
        ctx.stroke();
        break;
      case 'double_door':
        quad(0.22, 0.78, 0, 0.74);
        ctx.fillStyle = 'rgba(40, 28, 18, 0.9)';
        ctx.fill();
        ctx.strokeStyle = rgb(mat.trim, lit);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px(0.5, 0), py(0.5, 0));
        ctx.lineTo(px(0.5, 0.74), py(0.5, 0.74));
        ctx.stroke();
        break;
      default:
        break;
    }
    ctx.globalAlpha = 1;
  }

  /** The deed's boundary as a line that follows the ground. */
  private drawDeedBorder(ctx: CanvasRenderingContext2D): void {
    const deed = this.game.deed;
    if (!deed) return;
    const w = this.game.world;
    const cam = this.camera;
    const x0 = deed.x - deed.radius;
    const y0 = deed.y - deed.radius;
    const x1 = deed.x + deed.radius + 1;
    const y1 = deed.y + deed.radius + 1;
    ctx.beginPath();
    const pt = (x: number, y: number, first: boolean): void => {
      const sx = cam.worldToScreenX(x, y);
      const sy = cam.worldToScreenY(x, y, w.getHeight(x, y) + 0.5);
      if (first) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    };
    for (let x = x0; x <= x1; x++) pt(x, y0, x === x0);
    for (let y = y0 + 1; y <= y1; y++) pt(x1, y, false);
    for (let x = x1 - 1; x >= x0; x--) pt(x, y1, false);
    for (let y = y1 - 1; y > y0; y--) pt(x0, y, false);
    ctx.closePath();
    ctx.lineWidth = 4;
    ctx.strokeStyle = DEED_SHADOW;
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = DEED_COLOR;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  /** Water surface at height 0, clipped to the part of the tile that lies below it. Built in view space. */
  private drawWater(u: number, v: number, x: number, y: number, c: number[]): void {
    const poly = this.waterPoly;
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3;
      const ax = i === 1 || i === 2 ? u + 1 : u;
      const ay = i >= 2 ? v + 1 : v;
      const bx = j === 1 || j === 2 ? u + 1 : u;
      const by = j >= 2 ? v + 1 : v;
      const ha = c[i];
      const hb = c[j];
      if (ha < 0) {
        poly[n++] = ax;
        poly[n++] = ay;
      }
      if (ha < 0 !== hb < 0) {
        const t = ha / (ha - hb);
        poly[n++] = ax + (bx - ax) * t;
        poly[n++] = ay + (by - ay) * t;
      }
    }
    if (n < 6) return;
    const ctx = this.canvas.ctx;
    const cam = this.camera;
    const depth = Math.max(0, -(c[0] + c[1] + c[2] + c[3]) / 4);
    const level = Math.min(WATER_STEPS - 1, Math.floor(depth / 1.6));
    ctx.globalAlpha = 0.94 + 0.06 * Math.sin(this.time * 1.2 + (x + y) * 0.35 + (x - y) * 0.11);
    ctx.fillStyle = WATER_PALETTE[level];
    ctx.strokeStyle = WATER_PALETTE[level];
    ctx.beginPath();
    for (let k = 0; k < n; k += 2) {
      const sx = cam.viewToScreenX(poly[k], poly[k + 1]);
      const sy = cam.viewToScreenY(poly[k], poly[k + 1], 0);
      if (k === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private tilePath(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const w = this.game.world;
    const cam = this.camera;
    ctx.beginPath();
    ctx.moveTo(cam.worldToScreenX(x, y), cam.worldToScreenY(x, y, w.getHeight(x, y)));
    ctx.lineTo(cam.worldToScreenX(x + 1, y), cam.worldToScreenY(x + 1, y, w.getHeight(x + 1, y)));
    ctx.lineTo(cam.worldToScreenX(x + 1, y + 1), cam.worldToScreenY(x + 1, y + 1, w.getHeight(x + 1, y + 1)));
    ctx.lineTo(cam.worldToScreenX(x, y + 1), cam.worldToScreenY(x, y + 1, w.getHeight(x, y + 1)));
    ctx.closePath();
  }

  private cornerMarker(ctx: CanvasRenderingContext2D, cx: number, cy: number, zoom: number, color: string): void {
    const w = this.game.world;
    const sx = this.camera.worldToScreenX(cx, cy);
    const sy = this.camera.worldToScreenY(cx, cy, w.getHeight(cx, cy));
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx, sy, 3.5 * Math.max(0.8, zoom), 0, Math.PI * 2);
    ctx.fill();
  }

  private drawOverlays(ctx: CanvasRenderingContext2D, zoom: number): void {
    const game = this.game;
    const w = game.world;
    const cam = this.camera;
    const path = game.player.path;
    if (path) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (const p of path) {
        const sx = cam.worldToScreenX(p.x + 0.5, p.y + 0.5);
        const sy = cam.worldToScreenY(p.x + 0.5, p.y + 0.5, w.centerHeight(p.x, p.y));
        ctx.beginPath();
        ctx.arc(sx, sy, 2.5 * zoom, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const action = game.action;
    if (action && action.target.kind === 'tile') {
      const t = action.target;
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 6);
      ctx.lineWidth = 2;
      if (action.def.corner) {
        this.cornerMarker(ctx, t.cx, t.cy, zoom, `rgba(255,200,70,${pulse.toFixed(2)})`);
      } else {
        this.tilePath(ctx, t.x, t.y);
        ctx.strokeStyle = `rgba(255,200,70,${pulse.toFixed(2)})`;
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    }

    const hover = this.hover;
    if (game.deed && (game.settings.deedBorder || (hover && game.isToken(hover.x, hover.y)))) this.drawDeedBorder(ctx);
    if (hover) {
      this.tilePath(ctx, hover.x, hover.y);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();
      ctx.lineWidth = 1;
      const building = game.buildings.buildingAt(hover.x, hover.y);
      if (building) {
        // Show which border a wall would go on, at the storey being worked on.
        const side = nearestSide(hover.x, hover.y, hover.wx, hover.wy);
        const [ax, ay, bx, by] = borderPoints(borderOf(hover.x, hover.y, side));
        const h = w.getHeight(hover.x, hover.y) + workLevel(building) * WALL_HEIGHT + 0.5;
        ctx.beginPath();
        ctx.moveTo(cam.worldToScreenX(ax, ay), cam.worldToScreenY(ax, ay, h));
        ctx.lineTo(cam.worldToScreenX(bx, by), cam.worldToScreenY(bx, by, h));
        ctx.lineWidth = 4;
        ctx.strokeStyle = PLAN_COLOR;
        ctx.stroke();
        ctx.lineWidth = 1;
      } else {
        this.cornerMarker(ctx, hover.cx, hover.cy, zoom, 'rgba(255,235,150,0.9)');
      }
    }
  }

  /** Sides in drawing order, exported for menus. */
  static readonly SIDES = SIDES;

  /** Screen point to tile, taking terrain height into account; trees are picked by their sprite. */
  pick(sx: number, sy: number): Pick | null {
    for (let i = this.treeHits.length - 1; i >= 0; i--) {
      const h = this.treeHits[i];
      if (sx >= h.left && sx <= h.left + h.w && sy >= h.top && sy <= h.top + h.h) return this.makePick(h.x, h.y, sx, sy);
    }
    const cam = this.camera;
    const world = this.game.world;
    const iso = cam.screenToIso(sx, sy);
    const eF = iso.x / HALF_W;
    const dF = iso.y / HALF_H;
    const up = Math.ceil((world.maxHeight * HEIGHT_SCALE) / HALF_H) + 1;
    const down = Math.ceil((-world.minHeight * HEIGHT_SCALE) / HALF_H) + 3;
    const eLo = Math.floor(eF) - 1;
    const eHi = Math.ceil(eF) + 1;
    const rot = cam.rotation;
    const tb = this.tileBuf;
    for (let d = Math.floor(dF) + up; d >= Math.floor(dF) - down; d--) {
      for (let e = eLo; e <= eHi; e++) {
        if (((e + d) & 1) !== 0) continue;
        this.viewToWorldTile(rot, (d + e) / 2, (d - e) / 2, tb);
        const x = tb[0];
        const y = tb[1];
        if (!world.inBounds(x, y)) continue;
        if (this.pointInTile(x, y, sx, sy)) return this.makePick(x, y, sx, sy);
      }
    }
    return null;
  }

  private pointInTile(x: number, y: number, sx: number, sy: number): boolean {
    const w = this.game.world;
    const cam = this.camera;
    const p = this.pts;
    p[0] = cam.worldToScreenX(x, y);
    p[1] = cam.worldToScreenY(x, y, w.getHeight(x, y));
    p[2] = cam.worldToScreenX(x + 1, y);
    p[3] = cam.worldToScreenY(x + 1, y, w.getHeight(x + 1, y));
    p[4] = cam.worldToScreenX(x + 1, y + 1);
    p[5] = cam.worldToScreenY(x + 1, y + 1, w.getHeight(x + 1, y + 1));
    p[6] = cam.worldToScreenX(x, y + 1);
    p[7] = cam.worldToScreenY(x, y + 1, w.getHeight(x, y + 1));
    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      const xi = p[i * 2];
      const yi = p[i * 2 + 1];
      const xj = p[j * 2];
      const yj = p[j * 2 + 1];
      if (yi > sy !== yj > sy && sx < ((xj - xi) * (sy - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  private makePick(x: number, y: number, sx: number, sy: number): Pick {
    const w = this.game.world;
    const approx = this.camera.screenToWorld(sx, sy, w.centerHeight(x, y));
    const wx = Math.min(x + 0.999, Math.max(x, approx.x));
    const wy = Math.min(y + 0.999, Math.max(y, approx.y));
    return { x, y, wx, wy, cx: Math.round(wx), cy: Math.round(wy) };
  }
}
