import { Camera } from '../engine/camera';
import type { FullscreenCanvas } from '../engine/canvas';
import type { Game } from '../game/game';
import {
  borderOf,
  borderPoints,
  floorKind,
  isDone,
  MATERIAL_BY_ID,
  progressOf,
  ROOF_RISE,
  WALL_HEIGHT,
  workLevel,
  type Border,
  type FloorTile,
  type Side,
  type Wall,
} from '../game/building';
import { hash2 } from '../world/noise';
import { ROCK_VARIANTS, TileType, TILE_DEFS, bushSpecies, rockVariant, treeSpecies, treeVariant } from '../world/tiles';
import { HALF_H, HALF_W, HEIGHT_SCALE, UNITS_PER_TILE } from './iso';
import { crateCentre, crateKindOfItem, subtileOf, SUBTILES } from '../game/crates';
import { SPECIES, type Creature } from '../game/creatures';
import { bushSprite, crateSprite, drawCreature, drawPlayer, GRASS_VARIANTS, grassSprite, pileSprite, tokenSprite, treeSprite, type Sprite } from './sprites';

/** Result of picking a screen point: the tile, the approximate world position and the nearest corner. */
export interface Pick {
  x: number;
  y: number;
  wx: number;
  wy: number;
  cx: number;
  cy: number;
  /** A creature under the cursor, when one is. */
  creature?: number;
  /** A crate under the cursor, when one is. */
  crate?: number;
}

interface Entity {
  kind: 'tree' | 'bush' | 'player' | 'pile' | 'token' | 'crate' | 'creature';
  x: number;
  y: number;
  sx: number;
  sy: number;
  spr: Sprite | null;
  creature?: Creature;
  crateId?: number;
}

interface HitRect {
  x: number;
  y: number;
  left: number;
  top: number;
  w: number;
  h: number;
  creature?: number;
  crate?: number;
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
  private creatureHits: HitRect[] = [];
  private crateHits: HitRect[] = [];

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
    const grassDetail = zoom >= 0.75;
    const player = this.game.player;
    const rot = cam.rotation;
    const tb = this.tileBuf;
    this.worldToViewTile(rot, player.tileX, player.tileY, tb);
    const playerDepth = tb[0] + tb[1];
    const hw = HALF_W * zoom;
    const hh = HALF_H * zoom;
    const hs = HEIGHT_SCALE * zoom;
    const bottomMargin = 220 * zoom;
    const pts = this.pts;
    const c = this.cornerBuf;
    this.treeHits.length = 0;
    this.creatureHits.length = 0;
    this.crateHits.length = 0;
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
        if (t === TileType.Grass && grassDetail && !wet) {
          // Tufts show what the tile still has to give: berries to forage, flowers to botanize.
          const state = (this.game.isForaged(x, y, 'forage') ? 0 : 1) | (this.game.isForaged(x, y, 'botanize') ? 0 : 2);
          const spr = grassSprite(state, (x * 7 + y * 13 + ((x ^ y) & 3)) % GRASS_VARIANTS);
          const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
          const gy = baseY + hh - avg * hs;
          ctx.drawImage(spr.canvas, baseX - spr.ax * zoom, gy - spr.ay * zoom, spr.w * zoom, spr.h * zoom);
        }
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
        if (this.game.crates.size) {
          for (const crate of this.game.cratesOnTile(x, y)) {
            const [wx, wy] = crateCentre(crate);
            this.ents.push({ kind: 'crate', x, y, sx: cam.worldToScreenX(wx, wy), sy: cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), spr: crateSprite(crate.kind), crateId: crate.id });
          }
        }
        if (this.game.creatures.list.size) {
          for (const cr of this.game.creatures.atTile(x, y)) {
            this.ents.push({
              kind: 'creature',
              x,
              y,
              sx: cam.worldToScreenX(cr.x, cr.y),
              sy: cam.worldToScreenY(cr.x, cr.y, Math.max(world.heightAt(cr.x, cr.y), -4)),
              spr: null,
              creature: cr,
            });
          }
        }
        if (this.game.buildings.list.size) this.drawStructures(x, y, rot, d > playerDepth);
      }

      if (d === playerDepth) {
        const ph = Math.max(world.heightAt(player.x, player.y), -4) + player.visualLevel * WALL_HEIGHT;
        this.ents.push({
          kind: 'player',
          x: player.tileX,
          y: player.tileY,
          sx: cam.worldToScreenX(player.x, player.y),
          sy: cam.worldToScreenY(player.x, player.y, ph),
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
    // Within a diagonal, whatever stands lower on screen is nearer the viewer.
    if (ents.length > 1) ents.sort((a, b) => a.sy - b.sy || a.sx - b.sx);
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
      if (ent.kind === 'creature' && ent.creature) {
        const cr = ent.creature;
        const def = SPECIES[cr.species] ?? SPECIES.rabba;
        const dx = cam.rotateX(cr.dirX, cr.dirY) - cam.rotateY(cr.dirX, cr.dirY);
        drawCreature(ctx, ent.sx, ent.sy, zoom, {
          species: def.id,
          facing: dx >= 0 ? 1 : -1,
          phase: cr.walkPhase,
          moving: cr.moving,
          colors: def.variants[cr.variant] ?? def.variants[0],
          health: cr.health / def.health,
          label: cr.mode === 'wild' ? undefined : cr.name,
        });
        this.creatureHits.push({ x: ent.x, y: ent.y, left: ent.sx - 10 * zoom, top: ent.sy - 22 * zoom, w: 20 * zoom, h: 24 * zoom, creature: cr.id });
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
      } else if (ent.kind === 'crate' && ent.crateId !== undefined) {
        this.crateHits.push({ x: ent.x, y: ent.y, left: left + dw * 0.15, top: top + dh * 0.2, w: dw * 0.7, h: dh * 0.75, crate: ent.crateId });
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
    const playerLevel = this.game.player.level;
    const maxLevels = building ? building.levels : this.maxLevelsAround(x, y);
    // Floors, stairs and ladders for each storey, walls of each storey, then the roof one level up.
    for (let level = 0; level <= maxLevels; level++) {
      if (building) {
        const floor = bld.floor(level, x, y);
        if (floor) {
          const dim = inside?.id === building.id && level > playerLevel;
          const alpha = dim ? 0.35 : 1;
          switch (floorKind(floor)) {
            case 'stairs':
              this.drawStairs(floor, x, y, base, alpha);
              break;
            case 'ladder':
              this.drawLadder(floor, x, y, base, alpha);
              break;
            case 'roof':
              this.drawRoof(floor, x, y, base, alpha);
              break;
            default:
              this.drawFloor(floor, x, y, base, alpha);
          }
        }
      }
      if (level >= maxLevels) break;
      for (const border of [backA, backB]) {
        const wall = bld.wallOnBorder(level, border);
        if (!wall) continue;
        const dim = inside?.id === wall.building && inFront;
        this.drawWall(wall, border, base, dim ? 0.35 : 1);
      }
    }
  }

  /** World point on a tile from a coordinate across (t) and away from the climbing side (s). */
  private static stairPoint(x: number, y: number, facing: Side, t: number, s: number): [number, number] {
    switch (facing) {
      case 'n':
        return [x + t, y + s];
      case 's':
        return [x + t, y + 1 - s];
      case 'w':
        return [x + s, y + t];
      default:
        return [x + 1 - s, y + t];
    }
  }

  /** A staircase climbing from the storey below to this floor's storey, starting at its facing side. */
  private drawStairs(floor: FloorTile, x: number, y: number, base: number, alpha: number): void {
    const ctx = this.canvas.ctx;
    const cam = this.camera;
    const mat = MATERIAL_BY_ID.get(floor.material);
    if (!mat) return;
    const facing = floor.facing ?? 's';
    const h0 = base + (floor.level - 1) * WALL_HEIGHT;
    const h1 = base + floor.level * WALL_HEIGHT;
    const done = isDone(floor);
    const STEPS = 6;
    const P = (t: number, s: number, h: number): [number, number] => {
      const [wx, wy] = Renderer.stairPoint(x, y, facing, t, s);
      return [cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, h)];
    };
    const quad = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]): void => {
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.lineTo(c[0], c[1]);
      ctx.lineTo(d[0], d[1]);
      ctx.closePath();
    };
    // Draw the steps back to front in view space.
    const order = Array.from({ length: STEPS }, (_, i) => i).sort((a, b) => {
      const [ax, ay] = Renderer.stairPoint(x, y, facing, 0.5, (a + 0.5) / STEPS);
      const [bx, by] = Renderer.stairPoint(x, y, facing, 0.5, (b + 0.5) / STEPS);
      return cam.rotateX(ax, ay) + cam.rotateY(ax, ay) - (cam.rotateX(bx, by) + cam.rotateY(bx, by));
    });
    ctx.globalAlpha = alpha * (done ? 1 : 0.45);
    for (const i of order) {
      const s0 = i / STEPS;
      const s1 = (i + 1) / STEPS;
      const hp = h0 + ((h1 - h0) * i) / STEPS;
      const h = h0 + ((h1 - h0) * (i + 1)) / STEPS;
      quad(P(0, s0, hp), P(1, s0, hp), P(1, s0, h), P(0, s0, h));
      ctx.fillStyle = rgb(mat.trim, 0.9);
      ctx.fill();
      quad(P(0, s0, h), P(1, s0, h), P(1, s1, h), P(0, s1, h));
      ctx.fillStyle = rgb(mat.floor, 1);
      ctx.fill();
      ctx.strokeStyle = rgb(mat.trim, 0.8);
      ctx.stroke();
    }
    if (!done) {
      quad(P(0, 0, h1), P(1, 0, h1), P(1, 1, h1), P(0, 1, h1));
      ctx.strokeStyle = PLAN_COLOR;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  /** An opening in this storey's floor with a ladder up from the storey below on the facing side. */
  private drawLadder(floor: FloorTile, x: number, y: number, base: number, alpha: number): void {
    const ctx = this.canvas.ctx;
    const cam = this.camera;
    const facing = floor.facing ?? 's';
    const h0 = base + (floor.level - 1) * WALL_HEIGHT;
    const h1 = base + floor.level * WALL_HEIGHT;
    const done = isDone(floor);
    const P = (t: number, s: number, h: number): [number, number] => {
      const [wx, wy] = Renderer.stairPoint(x, y, facing, t, s);
      return [cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, h)];
    };
    ctx.globalAlpha = alpha * (done ? 1 : 0.45);
    // the opening
    const o = [P(0, 0, h1), P(1, 0, h1), P(1, 1, h1), P(0, 1, h1)];
    ctx.beginPath();
    ctx.moveTo(o[0][0], o[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(o[i][0], o[i][1]);
    ctx.closePath();
    ctx.fillStyle = 'rgba(30, 22, 16, 0.55)';
    ctx.fill();
    ctx.strokeStyle = done ? 'rgba(120, 90, 50, 0.9)' : PLAN_COLOR;
    if (!done) ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    // rails and rungs, inset a little from the climbing side
    ctx.strokeStyle = '#b08850';
    ctx.lineWidth = 2;
    for (const t of [0.4, 0.6]) {
      const a = P(t, 0.12, h0);
      const b = P(t, 0.12, h1 + 3);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    for (let k = 1; k <= 7; k++) {
      const h = h0 + ((h1 - h0) * k) / 8;
      const a = P(0.4, 0.12, h);
      const b = P(0.6, 0.12, h);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** A roof tile: eaves at the corners, ridges where neighbouring roof tiles meet, hips elsewhere. */
  private drawRoof(floor: FloorTile, x: number, y: number, base: number, alpha: number): void {
    const ctx = this.canvas.ctx;
    const cam = this.camera;
    const bld = this.game.buildings;
    const mat = MATERIAL_BY_ID.get(floor.material);
    if (!mat) return;
    const level = floor.level;
    const eave = base + level * WALL_HEIGHT;
    const done = isDone(floor);
    const roof = (tx: number, ty: number): boolean => !!bld.roofAt(level, tx, ty) || (bld.floor(level, tx, ty) !== undefined && floorKind(bld.floor(level, tx, ty) as FloorTile) === 'roof');
    // A corner is interior when all four tiles around it carry roof.
    const cornerH = (cx: number, cy: number): number => (roof(cx - 1, cy - 1) && roof(cx, cy - 1) && roof(cx - 1, cy) && roof(cx, cy) ? eave + ROOF_RISE : eave);
    const corners: Array<[number, number, number]> = [
      [x, y, cornerH(x, y)],
      [x + 1, y, cornerH(x + 1, y)],
      [x + 1, y + 1, cornerH(x + 1, y + 1)],
      [x, y + 1, cornerH(x, y + 1)],
    ];
    const ridge = eave + ROOF_RISE * 0.7;
    const avg = corners.reduce((s, c) => s + c[2], 0) / 4;
    const centreH = Math.max(avg, ridge);
    // Edge midpoints rise to the ridge where a neighbouring tile is roofed too, so rows form ridges.
    const neighbours: Array<[number, number]> = [
      [x, y - 1],
      [x + 1, y],
      [x, y + 1],
      [x - 1, y],
    ];
    const cx = x + 0.5;
    const cy = y + 0.5;
    const csx = cam.worldToScreenX(cx, cy);
    const csy = cam.worldToScreenY(cx, cy, centreH);
    const cu = cam.rotateX(cx, cy);
    const cv = cam.rotateY(cx, cy);
    const tri = (a: [number, number, number], b: [number, number, number]): void => {
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const du = cam.rotateX(mx, my) - cu;
      const dv = cam.rotateY(mx, my) - cv;
      const sx = du - dv;
      const sy = du + dv;
      const shade = sx < 0 && sy < 0 ? 1 : sx > 0 && sy < 0 ? 0.86 : sx < 0 ? 0.78 : 0.64;
      ctx.beginPath();
      ctx.moveTo(csx, csy);
      ctx.lineTo(cam.worldToScreenX(a[0], a[1]), cam.worldToScreenY(a[0], a[1], a[2]));
      ctx.lineTo(cam.worldToScreenX(b[0], b[1]), cam.worldToScreenY(b[0], b[1], b[2]));
      ctx.closePath();
      ctx.fillStyle = rgb(mat.floor, 0.9 * shade);
      ctx.fill();
      ctx.strokeStyle = rgb(mat.trim, shade, done ? 0.55 : 1);
      if (!done) ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    ctx.globalAlpha = alpha * (done ? 1 : 0.4);
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      const [nx, ny] = neighbours[i];
      const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, roof(nx, ny) ? ridge : eave];
      tri(a, mid);
      tri(mid, b);
    }
    ctx.globalAlpha = 1;
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
      const carryingCrate = game.inventory.items.some((it) => crateKindOfItem(it.id));
      if (carryingCrate && hover.crate === undefined) {
        // The 4 by 4 snap grid, with the spot a crate would take.
        const h = (wx: number, wy: number): number => w.heightAt(wx, wy) + 0.3;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        for (let i = 1; i < SUBTILES; i++) {
          const f = i / SUBTILES;
          ctx.beginPath();
          ctx.moveTo(cam.worldToScreenX(hover.x + f, hover.y), cam.worldToScreenY(hover.x + f, hover.y, h(hover.x + f, hover.y)));
          ctx.lineTo(cam.worldToScreenX(hover.x + f, hover.y + 1), cam.worldToScreenY(hover.x + f, hover.y + 1, h(hover.x + f, hover.y + 1)));
          ctx.moveTo(cam.worldToScreenX(hover.x, hover.y + f), cam.worldToScreenY(hover.x, hover.y + f, h(hover.x, hover.y + f)));
          ctx.lineTo(cam.worldToScreenX(hover.x + 1, hover.y + f), cam.worldToScreenY(hover.x + 1, hover.y + f, h(hover.x + 1, hover.y + f)));
          ctx.stroke();
        }
        const [sx0, sy0] = subtileOf(hover.x, hover.y, hover.wx, hover.wy);
        const x0 = hover.x + sx0 / SUBTILES;
        const y0 = hover.y + sy0 / SUBTILES;
        const s = 1 / SUBTILES;
        ctx.beginPath();
        ctx.moveTo(cam.worldToScreenX(x0, y0), cam.worldToScreenY(x0, y0, h(x0, y0)));
        ctx.lineTo(cam.worldToScreenX(x0 + s, y0), cam.worldToScreenY(x0 + s, y0, h(x0 + s, y0)));
        ctx.lineTo(cam.worldToScreenX(x0 + s, y0 + s), cam.worldToScreenY(x0 + s, y0 + s, h(x0 + s, y0 + s)));
        ctx.lineTo(cam.worldToScreenX(x0, y0 + s), cam.worldToScreenY(x0, y0 + s, h(x0, y0 + s)));
        ctx.closePath();
        ctx.fillStyle = game.crateAt(hover.x, hover.y, sx0, sy0) ? 'rgba(255,90,70,0.35)' : 'rgba(120,255,140,0.35)';
        ctx.fill();
      }
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

  /** Screen point to tile, taking terrain height into account; creatures and trees are picked by their sprite. */
  pick(sx: number, sy: number): Pick | null {
    for (let i = this.creatureHits.length - 1; i >= 0; i--) {
      const h = this.creatureHits[i];
      if (sx >= h.left && sx <= h.left + h.w && sy >= h.top && sy <= h.top + h.h) return { ...this.makePick(h.x, h.y, sx, sy), creature: h.creature };
    }
    for (let i = this.crateHits.length - 1; i >= 0; i--) {
      const h = this.crateHits[i];
      if (sx >= h.left && sx <= h.left + h.w && sy >= h.top && sy <= h.top + h.h) return { ...this.makePick(h.x, h.y, sx, sy), crate: h.crate };
    }
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
