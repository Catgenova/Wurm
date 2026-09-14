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
  WALL_TYPE_BY_ID,
  workLevel,
  type Border,
  type FloorTile,
  type Side,
  type Wall,
} from '../game/building';
import { hash2 } from '../world/noise';
import { ROCK_VARIANTS, SLAB_VARIANTS, TileType, TILE_DEFS, bushSpecies, rockVariant, slabVariant, treeSpecies, treeVariant } from '../world/tiles';
import { HALF_H, HALF_W, HEIGHT_SCALE, UNITS_PER_TILE } from './iso';
import { anvilCentre, type PlacedAnvil } from '../game/anvil';
import { postCentre, postLeft, postLife, type PlacedPost } from '../game/posts';
import { trapCentre, type PlacedTrap } from '../game/traps';
import { ageDef } from '../game/creatures';
import { fireCentre, type PlacedCampfire } from '../game/campfire';
import { smelterCentre, type PlacedSmelter } from '../game/smelter';
import { kilnCentre, type PlacedKiln } from '../game/kiln';
import { furnitureCentre, furnitureDef, type PlacedFurniture } from '../game/furniture';
import { UNSEEN, VISIBLE } from '../game/vision';
import { DAWN, DUSK } from '../game/game';
import { drawFurniture, furnitureSpan, FURNITURE_HEIGHT } from './furniture';
import { dyeOf } from '../game/dyestuffs';
import { sailTrim } from '../game/wind';
import { FURNITURE_BY_ID } from '../game/furniture';
import { cropDef } from '../game/farming';
import { crateCentre, crateKindOfItem, subtileOf, SUBTILES } from '../game/crates';
import { maxHealth, SPECIES, type Creature } from '../game/creatures';
import { CREST_ALPHA, FOAM_WIDTH, foamAlpha, LONG_WAVE, SHORT_WAVE, SWELL_SPEED, swellAt, swellShow, TROUGH_ALPHA } from './water';
import { Wakes } from './wake';
import { bushSprite, crateSprite, cropSprite, drawAnvil, drawCampfire, drawCreature, drawKiln, drawPlayer, drawSmelter, GRASS_VARIANTS, grassSprite, pileSprite, tokenSprite, treeSprite, type Sprite, drawWorkPost, drawTrap, drawDeck } from './sprites';

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
  /** A campfire under the cursor, when one is. */
  fire?: number;
  /** A smelter under the cursor, when one is. */
  smelter?: number;
  /** An anvil under the cursor, when one is. */
  anvil?: number;
  /** A work post under the cursor, when one is. */
  post?: number;
  /** A trap under the cursor, when one is. */
  trap?: number;
  /** A bridge under the cursor, when one is. */
  bridge?: number;
  /** A kiln under the cursor, when one is. */
  kiln?: number;
  /** A piece of furniture under the cursor, when one is. */
  furniture?: number;
}

interface Entity {
  kind: 'tree' | 'bush' | 'player' | 'pile' | 'token' | 'crate' | 'creature' | 'campfire' | 'crop' | 'smelter' | 'kiln' | 'furniture' | 'anvil' | 'post' | 'trap' | 'deck';
  x: number;
  y: number;
  sx: number;
  sy: number;
  spr: Sprite | null;
  creature?: Creature;
  crateId?: number;
  fire?: PlacedCampfire;
  smelter?: PlacedSmelter;
  kiln?: PlacedKiln;
  piece?: PlacedFurniture;
  anvil?: PlacedAnvil;
  post?: PlacedPost;
  trap?: PlacedTrap;
  deck?: { kind: string; done: boolean; drop: number; id: number };
  /**
   * Pixels to draw above where it sorts. A driver sits on the cart, so the
   * figure belongs above it on screen while still sorting as though it stood
   * on the same ground — lift the sort key instead and the cart is drawn last,
   * over the top of its own driver.
   */
  lift?: number;
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
  fire?: number;
  smelter?: number;
  kiln?: number;
  furniture?: number;
  anvil?: number;
  post?: number;
  trap?: number;
  bridge?: number;
}

const VOID_COLOR = '#12395f';
/** The cold laid over ground that is remembered rather than watched. */
const FOG_COLOR = 'rgba(16, 24, 46, 0.58)';
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

/**
 * Where the light comes from at a given hour. The sun rises on one side, goes
 * overhead at noon and sets on the other, so a hillside that was bright in the
 * morning is in shade by the afternoon and every slope on the island changes
 * shape as the day goes by. Before dawn and after dusk it sits on the horizon,
 * which is as close to moonlight as this needs to get.
 */
export function sunAt(hour: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, (hour - DAWN) / (DUSK - DAWN)));
  const a = Math.PI * t;
  return normalize(0.72 * Math.cos(a), -0.3, 0.3 + 0.7 * Math.sin(a));
}

/** How finely the sun's walk is cut up: the ground is re-shaded on each step. */
const SUN_STEPS = 48;

/**
 * The wash over everything at this hour: warm at the two ends of the day, cold
 * in the middle of the night, nothing at all at noon. Dusk and dawn overlap
 * with the night's own blue, which is what gives the half-hour after sundown
 * its colour.
 */
export function skyWash(hour: number, dark: number): Array<{ colour: string; alpha: number }> {
  const out: Array<{ colour: string; alpha: number }> = [];
  // A bell on each end of the day, two hours wide.
  const bell = (centre: number): number => Math.max(0, 1 - Math.abs(hour - centre) / 2);
  const dusk = bell(DUSK);
  const dawn = bell(DAWN);
  if (dusk > 0.01) out.push({ colour: '255, 146, 58', alpha: dusk * 0.22 });
  if (dawn > 0.01) out.push({ colour: '255, 168, 146', alpha: dawn * 0.18 });
  if (dark > 0.01) out.push({ colour: '12, 20, 44', alpha: dark * 0.68 });
  return out;
}

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
  /** The tile the tile window is looking at, outlined so you can see which it is. */
  selected: { x: number; y: number } | null = null;
  fps = 0;
  private colors: (string | null)[];
  /** Which step of the sun's walk the ground was last shaded for. */
  private lastSun = -1;
  /** Where a shadow falls this frame, in screen pixels, and how dark it is. */
  private shadow = { dx: 0, dy: 0, alpha: 0 };
  /** Tile colours as the map remembers them, for ground nobody is watching. */
  private memColors: (string | null)[];
  private lastVision = -1;
  private pts = new Float64Array(8);
  private cornerBuf = [0, 0, 0, 0];
  private ents: Entity[] = [];
  private waterPoly = new Float64Array(16);
  /** Every water polygon drawn this frame, so a wake can be kept on the water. */
  private waterEdge = new Float64Array(4);
  /** Whether any water was drawn this frame; an inland view skips the surface pass. */
  private drewWater = false;
  private seaPath = new Path2D();
  /** What everything on the water has left behind it. */
  readonly wakes = new Wakes();
  /** The wind as the surface sees it, worked out once a frame rather than per tile. */
  private surf = { dirX: 1, dirY: 0, force: 0.5 };
  private drawnTiles = 0;
  private tileBuf = [0, 0];
  private playerFacing = 1;
  private creatureHits: HitRect[] = [];
  private crateHits: HitRect[] = [];
  private fireHits: HitRect[] = [];
  private smelterHits: HitRect[] = [];
  private kilnHits: HitRect[] = [];
  private furnitureHits: HitRect[] = [];
  private anvilHits: HitRect[] = [];
  private postHits: HitRect[] = [];
  private trapHits: HitRect[] = [];
  private deckHits: HitRect[] = [];

  constructor(
    private readonly canvas: FullscreenCanvas,
    private readonly game: Game,
  ) {
    this.colors = new Array<string | null>(game.world.w * game.world.h).fill(null);
    this.memColors = new Array<string | null>(game.world.w * game.world.h).fill(null);
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
        if (w.inBounds(xx, yy)) {
          this.colors[yy * w.w + xx] = null;
          this.memColors[yy * w.w + xx] = null;
        }
      }
    }
  }

  /**
   * One thing's shadow, stretched away from the sun. It is an ellipse squashed
   * along the direction it falls, which is what a round thing's shadow is on
   * flat ground, and it fades out as the sun climbs.
   */
  private castShadow(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number): void {
    const { dx, dy, alpha } = this.shadow;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    const r = Math.max(3, size * 0.55);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(len * 0.5, 0, len * 0.5 + r, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * How much a light is worth this instant. A fire breathes: two waves out of
   * step, so it never settles into a rhythm you can watch. A steady light —
   * a candle behind cloth, a creature that glows — does not do this at all.
   */
  private flicker(l: { x: number; y: number; steady?: boolean }): number {
    if (l.steady) return 1;
    const seed = l.x * 0.7 + l.y * 1.3;
    return 1 + 0.055 * Math.sin(this.time * 6.1 + seed) + 0.035 * Math.sin(this.time * 11.3 + seed * 2.1);
  }

  /**
   * The scratch canvas the night is mixed on. It is kept between frames and
   * only resized when the window is, since making one every frame at screen
   * size is the sort of thing that costs a night's frame rate.
   */
  private night: HTMLCanvasElement | null = null;

  private nightLayer(): HTMLCanvasElement {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!this.night || this.night.width !== w || this.night.height !== h) {
      this.night = document.createElement('canvas');
      this.night.width = w;
      this.night.height = h;
    }
    return this.night;
  }

  /** Flat-shaded colour for a tile: base colour, slope lighting, per-tile variation and depth tint under water. */
  private computeColor(x: number, y: number, type: TileType, data: number, light: [number, number, number]): string {
    const w = this.game.world;
    const def = TILE_DEFS[type];
    const c = w.corners(x, y, this.cornerBuf);
    const gx = (c[1] + c[2] - (c[0] + c[3])) / 2 / UNITS_PER_TILE;
    const gy = (c[2] + c[3] - (c[0] + c[1])) / 2 / UNITS_PER_TILE;
    const len = Math.hypot(gx, gy, 1);
    const dot = (-gx * light[0] - gy * light[1] + light[2]) / len;
    let shade = 0.48 + 0.6 * Math.max(0, dot);
    const base =
      type === TileType.Rock
        ? ROCK_VARIANTS[rockVariant(data)].color
        : type === TileType.Slabs
          ? SLAB_VARIANTS[slabVariant(data)].color
          : def.color;
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
    const vision = this.game.vision;
    const fogged = this.game.settings.fog;
    const fogPath = new Path2D();
    this.seaPath = new Path2D();
    this.drewWater = false;
    // The swell runs down the wind, and everything crossing open water drags
    // something behind it. Both are worked out once for the frame.
    const wind = this.game.wind();
    this.surf = { dirX: Math.cos(wind.dir), dirY: Math.sin(wind.dir), force: wind.force };
    this.markWakes();
    // A tile last seen a moment ago has a new memory; throw away the colour
    // that was worked out from the old one.
    if (vision.revision !== this.lastVision) {
      this.lastVision = vision.revision;
      const box = vision.dirty;
      if (box) {
        for (let y = Math.max(0, box.y0); y <= Math.min(world.h - 1, box.y1); y++) {
          for (let x = Math.max(0, box.x0); x <= Math.min(world.w - 1, box.x1); x++) this.memColors[y * world.w + x] = null;
        }
      } else this.memColors.fill(null);
    }
    // The sun moves through the day, so the ground has to be shaded again as it
    // goes. It is cut into steps rather than recomputed every frame: a repaint
    // a few times an in-game hour is nothing, one every frame is not.
    const hour = this.game.hourOfDay();
    const sun = sunAt(hour);
    const sunStep = Math.floor((hour / 24) * SUN_STEPS);
    if (sunStep !== this.lastSun) {
      this.lastSun = sunStep;
      this.colors.fill(null);
    }
    /*
     * Where a shadow falls, and how long it is. Straight down and invisible at
     * noon; away from the sun and two and a half tiles long when the sun is on
     * the horizon. Worked out once for the frame: the projection is linear, so
     * one world vector gives the screen offset for everything on the island.
     */
    const sunUp = Math.max(0, sun[2]);
    const cast = (1 - sunUp) * 2.4;
    const wx = -sun[0] * cast;
    const wy = -sun[1] * cast;
    const du = cam.rotateX(wx, wy);
    const dv = cam.rotateY(wx, wy);
    this.shadow = {
      dx: (du - dv) * HALF_W * zoom,
      dy: (du + dv) * HALF_H * zoom,
      alpha: 0.45 * (1 - sunUp) * (1 - this.game.darkness()),
    };
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
    this.creatureHits.length = 0;
    this.crateHits.length = 0;
    this.fireHits.length = 0;
    this.smelterHits.length = 0;
    this.kilnHits.length = 0;
    this.furnitureHits.length = 0;
    this.anvilHits.length = 0;
    this.postHits.length = 0;
    this.trapHits.length = 0;
    this.deckHits.length = 0;
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
        // Three states: land nobody has seen is not drawn at all, land in sight
        // is drawn as it is, and land only remembered is drawn as it was.
        const fog = vision.state(x, y);
        if (fog === UNSEEN) {
          // Still lay the shape down, flat and empty. A hill drawn behind a
          // hole in the map would otherwise hang its face out over the dark.
          ctx.beginPath();
          ctx.moveTo(pts[0], pts[1]);
          ctx.lineTo(pts[2], pts[3]);
          ctx.lineTo(pts[4], pts[5]);
          ctx.lineTo(pts[6], pts[7]);
          ctx.closePath();
          ctx.fillStyle = VOID_COLOR;
          ctx.fill();
          continue;
        }
        const lit = fog === VISIBLE;
        let color = lit ? this.colors[idx] : this.memColors[idx];
        if (!color) {
          color = this.computeColor(x, y, world.viewTile(x, y, lit), world.viewData(x, y, lit), sun);
          if (lit) this.colors[idx] = color;
          else this.memColors[idx] = color;
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
        if (wet) this.drawWater(u, v, x, y, c, fogged && !lit ? fogPath : undefined);

        const t = world.viewTile(x, y, lit);
        if (!lit) {
          // Remembered ground keeps its shape and its trees and nothing else:
          // no creatures, no piles, no detail, and a cold wash over the lot.
          if (t === TileType.Tree || t === TileType.Bush) {
            const data = world.viewData(x, y, false);
            const spr = t === TileType.Tree ? treeSprite(treeSpecies(data), treeVariant(data)) : bushSprite(bushSpecies(data));
            const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
            this.ents.push({ kind: t === TileType.Tree ? 'tree' : 'bush', x, y, sx: baseX, sy: baseY + hh - avg * hs, spr });
          }
          if (this.game.buildings.list.size || this.game.buildings.walls.size) this.drawStructures(x, y, rot, d > playerDepth);
          fogPath.moveTo(pts[0], pts[1]);
          fogPath.lineTo(pts[2], pts[3]);
          fogPath.lineTo(pts[4], pts[5]);
          fogPath.lineTo(pts[6], pts[7]);
          fogPath.closePath();
          continue;
        }
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
        if (this.game.crops.size) {
          const crop = this.game.cropAt(x, y);
          if (crop) {
            const def = cropDef(crop.id);
            const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
            this.ents.push({
              kind: 'crop',
              x,
              y,
              sx: baseX,
              sy: baseY + hh - avg * hs,
              spr: cropSprite(crop.id, Math.min(3, crop.stage), def.look, def.colors[0], def.colors[1]),
            });
          }
        }
        if (this.game.smelters.size) {
          for (const sm of this.game.smeltersOnTile(x, y)) {
            const [wx, wy] = smelterCentre(sm);
            this.ents.push({ kind: 'smelter', x, y, sx: cam.worldToScreenX(wx, wy), sy: cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), spr: null, smelter: sm });
          }
        }
        if (this.game.kilns.size) {
          for (const kl of this.game.kilnsOnTile(x, y)) {
            const [wx, wy] = kilnCentre(kl);
            this.ents.push({ kind: 'kiln', x, y, sx: cam.worldToScreenX(wx, wy), sy: cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), spr: null, kiln: kl });
          }
        }
        if (this.game.furniture.size) {
          for (const fu of this.game.furnitureOnTile(x, y)) {
            const [wx, wy] = furnitureCentre(fu);
            this.ents.push({ kind: 'furniture', x, y, sx: cam.worldToScreenX(wx, wy), sy: cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), spr: null, piece: fu });
          }
        }
        if (this.game.anvils.size) {
          for (const an of this.game.anvilsOnTile(x, y)) {
            const [wx, wy] = anvilCentre(an);
            this.ents.push({ kind: 'anvil', x, y, sx: cam.worldToScreenX(wx, wy), sy: cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), spr: null, anvil: an });
          }
        }
        if (this.game.posts.size) {
          for (const po of this.game.postsOnTile(x, y)) {
            const [wx, wy] = postCentre(po);
            this.ents.push({ kind: 'post', x, y, sx: cam.worldToScreenX(wx, wy), sy: cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), spr: null, post: po });
          }
        }
        if (this.game.bridges.size) {
          const bridge = this.game.bridgeAt(x, y);
          if (bridge) {
            const span = bridge.spans.find((sp) => sp.x === x && sp.y === y);
            const wx = x + 0.5;
            const wy = y + 0.5;
            this.ents.push({
              kind: 'deck',
              x,
              y,
              sx: cam.worldToScreenX(wx, wy),
              sy: cam.worldToScreenY(wx, wy, bridge.height),
              spr: null,
              deck: { kind: bridge.kind, done: !!span && Object.values(span.needed).every((n) => n <= 0), drop: bridge.height - world.centerHeight(x, y), id: bridge.id },
            });
          }
        }
        if (this.game.traps.size) {
          for (const tr of this.game.trapsOnTile(x, y)) {
            const [wx, wy] = trapCentre(tr);
            this.ents.push({ kind: 'trap', x, y, sx: cam.worldToScreenX(wx, wy), sy: cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), spr: null, trap: tr });
          }
        }
        if (this.game.campfires.size) {
          for (const fire of this.game.campfiresOnTile(x, y)) {
            const [wx, wy] = fireCentre(fire);
            this.ents.push({ kind: 'campfire', x, y, sx: cam.worldToScreenX(wx, wy), sy: cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), spr: null, fire });
          }
        }
        if (this.game.crates.size) {
          for (const crate of this.game.cratesOnTile(x, y)) {
            const [wx, wy] = crateCentre(crate);
            this.ents.push({ kind: 'crate', x, y, sx: cam.worldToScreenX(wx, wy), sy: cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), spr: crateSprite(crate.kind), crateId: crate.id });
          }
        }
        if (this.game.creatures.list.size) {
          // Anything standing on a tile with finished deck over it stands on the deck.
          const deckHere = this.game.bridges.size ? this.game.deckAt(x, y) : null;
          for (const cr of this.game.creatures.atTile(x, y)) {
            this.ents.push({
              kind: 'creature',
              x,
              y,
              sx: cam.worldToScreenX(cr.x, cr.y),
              sy: cam.worldToScreenY(cr.x, cr.y, deckHere ?? Math.max(world.heightAt(cr.x, cr.y), -4)),
              spr: null,
              creature: cr,
            });
          }
        }
        if (this.game.buildings.list.size || this.game.buildings.walls.size) this.drawStructures(x, y, rot, d > playerDepth);
      }

      if (d === playerDepth) {
        // On a bridge you stand on the deck, not in whatever is under it.
        // On the deck unless you are in a hull passing under it.
        const deck = this.game.bridges.size && !this.game.afloat() ? this.game.deckAt(player.tileX, player.tileY) : null;
        const ph = deck !== null ? deck : Math.max(world.heightAt(player.x, player.y), -4) + player.visualLevel * WALL_HEIGHT;
        // A driver is drawn on the seat, which is a lift in screen pixels
        // rather than in world height: the cart is under them, not the ground.
        const drivenBy = this.game.driving();
        const up = this.game.mounted();
        // A driver sorts with the vehicle rather than with their own feet, a
        // hair behind it, so the figure is drawn onto the seat and not under
        // the box it is sitting on.
        // Sat on the box, the driver goes where the box goes rather than where
        // their own feet are, and sorts a hair behind it so it is drawn first.
        const [vx, vy] = drivenBy ? furnitureCentre(drivenBy) : [player.x, player.y];
        // A rider sits where their mount stands, which is where they stand.
        const sy = drivenBy || up ? cam.worldToScreenY(vx, vy, world.heightAt(vx, vy)) + 0.01 : cam.worldToScreenY(player.x, player.y, ph);
        this.ents.push({
          kind: 'player',
          x: player.tileX,
          y: player.tileY,
          sx: cam.worldToScreenX(vx, vy),
          sy,
          spr: null,
          lift: this.driverSeat() * zoom,
        });
      }
      if (this.ents.length) this.drawEntities(ctx, zoom);
    }
    // The surface and then what crossed it, both clipped to the water, so
    // neither washes up over a beach standing in front of them.
    this.drawSwell(ctx, zoom);
    this.drawWakes(ctx, zoom);

    // One pass for all of it, so a remembered wood goes cold with its ground.
    if (fogged) {
      ctx.fillStyle = FOG_COLOR;
      ctx.fill(fogPath);
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

  /**
   * How high off the ground the player is sitting: the deck of whatever they
   * are driving, or nothing at all when they are on their own two feet.
   */
  private driverSeat(): number {
    const f = this.game.driving();
    if (f) return furnitureDef(f.kind).vehicle?.seat ?? furnitureDef(f.kind).boat?.seat ?? 0;
    const up = this.game.mounted();
    return up ? SPECIES[up.species]?.mount ?? 0 : 0;
  }

  private drawEntities(ctx: CanvasRenderingContext2D, zoom: number): void {
    const ents = this.ents;
    // Within a diagonal, whatever stands lower on screen is nearer the viewer.
    if (ents.length > 1) ents.sort((a, b) => a.sy - b.sy || a.sx - b.sx || (a.lift ?? 0) - (b.lift ?? 0));
    const player = this.game.player;
    const cam = this.camera;
    const screenDx = cam.rotateX(player.dirX, player.dirY) - cam.rotateY(player.dirX, player.dirY);
    if (Math.abs(screenDx) > 0.05) this.playerFacing = screenDx > 0 ? 1 : -1;
    for (const ent of ents) {
      if (ent.kind === 'player') {
        drawPlayer(ctx, ent.sx, ent.sy - (ent.lift ?? 0), zoom, {
          phase: player.moving ? player.walkPhase : this.time * 6,
          moving: player.moving,
          facing: this.playerFacing,
          swimming: player.swimming,
          working: this.game.action?.state === 'performing',
          driving: (ent.lift ?? 0) > 0,
          // Dyed cloth or leather on the chest and legs is worn where it shows.
          tunic: dyeOf(this.game.worn('chest'))?.colour,
          trousers: dyeOf(this.game.worn('legs'))?.colour,
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
          health: cr.health / maxHealth(cr, def),
          fleece: cr.fleece,
          scale: ageDef(cr, this.game.time).scale,
          label: cr.mode === 'wild' ? undefined : cr.name,
        });
        this.creatureHits.push({ x: ent.x, y: ent.y, left: ent.sx - 10 * zoom, top: ent.sy - 22 * zoom, w: 20 * zoom, h: 24 * zoom, creature: cr.id });
        continue;
      }
      if (ent.kind === 'furniture' && ent.piece) {
        drawFurniture(ctx, ent.sx, ent.sy, zoom, ent.piece.kind, !!ent.piece.lit, dyeOf(ent.piece) ?? undefined, this.sailTrim(ent.piece));
        const [W, D] = furnitureSpan(ent.piece.kind);
        const h = FURNITURE_HEIGHT[ent.piece.kind] ?? 14;
        // A sign is a board made to be read, so what is written on it stands
        // over it in the world rather than waiting in a tooltip.
        if (ent.piece.name && furnitureDef(ent.piece.kind).sign && zoom >= 0.6) {
          const text = ent.piece.name;
          ctx.font = `${Math.round(11 * zoom)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          const w = ctx.measureText(text).width;
          const ty = ent.sy - (h + 6) * zoom;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(ent.sx - w / 2 - 4 * zoom, ty - 11 * zoom, w + 8 * zoom, 14 * zoom);
          ctx.fillStyle = '#e7d7a8';
          ctx.fillText(text, ent.sx, ty);
          ctx.textAlign = 'left';
        }
        this.furnitureHits.push({ x: ent.x, y: ent.y, left: ent.sx - W * zoom, top: ent.sy - (h + D + 2) * zoom, w: W * 2 * zoom, h: (h + D * 2 + 4) * zoom, furniture: ent.piece.id });
      }
      if (ent.kind === 'kiln' && ent.kiln) {
        drawKiln(ctx, ent.sx, ent.sy, zoom, ent.kiln.lit, ent.kiln.jobs.length > 0, this.time);
        this.kilnHits.push({ x: ent.x, y: ent.y, left: ent.sx - 26 * zoom, top: ent.sy - 44 * zoom, w: 52 * zoom, h: 48 * zoom, kiln: ent.kiln.id });
      }
      if (ent.kind === 'smelter' && ent.smelter) {
        drawSmelter(ctx, ent.sx, ent.sy, zoom, ent.smelter.lit, ent.smelter.jobs.length > 0, this.time);
        this.smelterHits.push({ x: ent.x, y: ent.y, left: ent.sx - 34 * zoom, top: ent.sy - 58 * zoom, w: 68 * zoom, h: 62 * zoom, smelter: ent.smelter.id });
        continue;
      }
      if (ent.kind === 'anvil' && ent.anvil) {
        // An anvil takes the colour of the metal it was cast from.
        const metal = ent.anvil.metal;
        const rock = ROCK_VARIANTS.find((r) => r.yields === `${metal}_ore`);
        const c = rock ? rock.color : ([150, 150, 156] as const);
        const face = `rgb(${c[0]},${c[1]},${c[2]})`;
        const shade = `rgb(${Math.round(c[0] * 0.68)},${Math.round(c[1] * 0.68)},${Math.round(c[2] * 0.68)})`;
        drawAnvil(ctx, ent.sx, ent.sy, zoom, face, shade);
        this.anvilHits.push({ x: ent.x, y: ent.y, left: ent.sx - 20 * zoom, top: ent.sy - 27 * zoom, w: 40 * zoom, h: 30 * zoom, anvil: ent.anvil.id });
        continue;
      }
      if (ent.kind === 'post' && ent.post) {
        drawWorkPost(ctx, ent.sx, ent.sy, zoom, postLeft(ent.post) / postLife(ent.post.ql), ent.post.worker !== null);
        this.postHits.push({ x: ent.x, y: ent.y, left: ent.sx - 9 * zoom, top: ent.sy - 30 * zoom, w: 18 * zoom, h: 32 * zoom, post: ent.post.id });
        continue;
      }
      if (ent.kind === 'deck' && ent.deck) {
        drawDeck(ctx, ent.sx, ent.sy, zoom, ent.deck.kind, ent.deck.done, ent.deck.drop);
        this.deckHits.push({ x: ent.x, y: ent.y, left: ent.sx - 40 * zoom, top: ent.sy - 22 * zoom, w: 80 * zoom, h: 44 * zoom, bridge: ent.deck.id });
        continue;
      }
      if (ent.kind === 'trap' && ent.trap) {
        drawTrap(ctx, ent.sx, ent.sy, zoom, ent.trap.kind, !!ent.trap.bait, ent.trap.caught !== null);
        this.trapHits.push({ x: ent.x, y: ent.y, left: ent.sx - 8 * zoom, top: ent.sy - 12 * zoom, w: 16 * zoom, h: 14 * zoom, trap: ent.trap.id });
        continue;
      }
      if (ent.kind === 'campfire' && ent.fire) {
        drawCampfire(ctx, ent.sx, ent.sy, zoom, ent.fire.lit, ent.fire.fuel, this.time);
        this.fireHits.push({ x: ent.x, y: ent.y, left: ent.sx - 22 * zoom, top: ent.sy - 20 * zoom, w: 44 * zoom, h: 30 * zoom, fire: ent.fire.id });
        continue;
      }
      const spr = ent.spr;
      if (!spr) continue;
      const dw = spr.w * zoom;
      const dh = spr.h * zoom;
      const left = ent.sx - spr.ax * zoom;
      const top = ent.sy - spr.ay * zoom;
      // Anything standing up throws a shadow away from the sun, long at the
      // ends of the day and gone at noon. The sprite's own contact shadow does
      // the rest, which is why this can be thrown away entirely at midday.
      if (this.shadow.alpha > 0.012) this.castShadow(ctx, ent.sx, ent.sy, (spr.ay - (spr.h - spr.ay)) * 0.5 * zoom + dh * 0.12);
      ctx.drawImage(spr.canvas, left, top, dw, dh);
      if (ent.kind === 'crate' && ent.crateId !== undefined) {
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
    const maxLevels = building ? building.levels : Math.max(1, this.maxLevelsAround(x, y));
    const { cutaway, viewLevel } = this.game.settings;
    // Floors, stairs and ladders for each storey, walls of each storey, then the roof one level up.
    for (let level = 0; level <= maxLevels; level++) {
      if (building) {
        const floor = bld.floor(level, x, y);
        // Looking at one storey means lifting the ceilings above it off.
        if (floor && !(viewLevel !== null && floor.level > viewLevel)) {
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
      if (viewLevel !== null && level > viewLevel) continue;
      for (const border of [backA, backB]) {
        const wall = bld.wallOnBorder(level, border);
        if (!wall) continue;
        /*
         * Every wall is drawn once, by whichever tile has it as a back edge.
         * When that tile is not part of the wall's own building the wall
         * stands between the viewer and the inside: those are the ones a
         * cutaway takes away.
         */
        if (cutaway && building?.id !== wall.building) continue;
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
    const kind = WALL_TYPE_BY_ID.get(wall.type);
    const h0 = base + wall.level * WALL_HEIGHT;
    const h1 = h0 + WALL_HEIGHT * (kind?.height ?? 1);
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
    if (kind?.railed) {
      // Posts at the ends and the middle, two rails between them, and a gate
      // leaf hung in the gap when there is one.
      ctx.fillStyle = rgb(mat.color, lit);
      ctx.strokeStyle = rgb(mat.trim, lit);
      for (const t of [0.03, 0.5, 0.97]) {
        quad(Math.max(0, t - 0.05), Math.min(1, t + 0.05), 0, 1);
        ctx.fill();
        ctx.stroke();
      }
      for (const [k0, k1] of [[0.32, 0.46], [0.72, 0.86]] as Array<[number, number]>) {
        quad(0, 1, k0, k1);
        ctx.fillStyle = rgb(mat.color, lit * 0.94);
        ctx.fill();
        ctx.stroke();
      }
      if (wall.type === 'fence_gate') {
        quad(0.08, 0.46, 0.06, 0.94);
        ctx.fillStyle = rgb(mat.floor, lit, 0.85);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px(0.1, 0.1), py(0.1, 0.1));
        ctx.lineTo(px(0.44, 0.9), py(0.44, 0.9));
        ctx.stroke();
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
  /** Ore a prospector has read, glowing until the marks fade. */
  private drawProspected(ctx: CanvasRenderingContext2D): void {
    const p = this.game.prospected;
    if (!p || this.game.time >= p.until) return;
    const w = this.game.world;
    // Fade out over the last few seconds rather than blinking off.
    const left = p.until - this.game.time;
    const pulse = 0.72 + Math.sin(this.time * 3) * 0.22;
    ctx.save();
    ctx.globalAlpha = Math.min(1, left / 8) * pulse;
    for (const key of p.tiles) {
      const x = key % w.w;
      const y = (key - x) / w.w;
      this.tilePath(ctx, x, y);
      ctx.fillStyle = '#ffcf3d';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#5a3c00';
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff3c0';
      ctx.stroke();
    }
    ctx.restore();
  }

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
  /**
   * The water lying on a tile. Its surface is drawn flat at sea level, not on
   * the drowned ground, so on screen it sits well clear of the tile's own
   * diamond — which is why remembered water used to stay bright while the land
   * around it went cold. `fogInto` takes the same shape so the wash covers
   * what was actually drawn rather than what is underneath it.
   */
  /**
   * Note where everything on open water is this frame. A swimmer drags a
   * narrow wake, a hull as wide as its beam; a wildermon out of its depth
   * leaves one too. Nothing on dry land leaves anything.
   */
  private markWakes(): void {
    const w = this.game.world;
    const now = this.time;
    const afloat = (x: number, y: number): boolean => w.heightAt(x, y) < -0.5;
    const player = this.game.player;
    const boat = this.game.driving();
    const hull = boat && furnitureDef(boat.kind).boat ? boat : null;
    if (hull) {
      const [bx, by] = furnitureCentre(hull);
      const [sw, sd] = furnitureSpan(hull.kind);
      if (afloat(bx, by)) this.wakes.mark('hull', bx, by, now, Math.max(sw, sd) * 0.42);
    } else if (afloat(player.x, player.y)) {
      this.wakes.mark('player', player.x, player.y, now, 0.3);
    }
    if (this.game.creatures.list.size) {
      for (const cr of this.game.creatures.list.values()) {
        if (afloat(cr.x, cr.y)) this.wakes.mark('c' + cr.id, cr.x, cr.y, now, 0.26);
      }
    }
  }

  /**
   * The swell, drawn across the whole sea at once rather than a shade per
   * tile. One band of light and dark runs down the wind and a shorter, faster
   * chop is set across it; both are laid on as gradients over the water
   * polygon, which is what keeps the surface continuous instead of breaking
   * at every tile edge — a sea drawn a diamond at a time reads as a tiled
   * floor no matter what the arithmetic says.
   */
  private drawSwell(ctx: CanvasRenderingContext2D, zoom: number): void {
    if (!this.drewWater) return;
    ctx.save();
    ctx.clip(this.seaPath);
    this.swellBand(ctx, zoom, 0, LONG_WAVE, CREST_ALPHA, 1);
    this.swellBand(ctx, zoom, 0.55, SHORT_WAVE, TROUGH_ALPHA * 0.7, 0.62);
    ctx.restore();
  }

  /** One train of waves: a wavelength, a lean off the wind, and a speed. */
  private swellBand(ctx: CanvasRenderingContext2D, zoom: number, lean: number, waveTiles: number, amp: number, rate: number): void {
    const cam = this.camera;
    const a = Math.atan2(this.surf.dirY, this.surf.dirX) + lean;
    const wdx = Math.cos(a);
    const wdy = Math.sin(a);
    // Where one tile lands on screen, along the wind and across it. The
    // projection squashes one axis and not the other, so the line a crest runs
    // along is not square to the direction it travels — the gradient has to be
    // laid out across the crests, not down the wind.
    const shift = (dx: number, dy: number): [number, number] => {
      const du = cam.rotateX(dx, dy);
      const dv = cam.rotateY(dx, dy);
      return [(du - dv) * HALF_W * zoom, (du + dv) * HALF_H * zoom];
    };
    const [pwx, pwy] = shift(wdx, wdy);
    const [pnx, pny] = shift(-wdy, wdx);
    const nlen = Math.hypot(pnx, pny);
    if (nlen < 0.001) return;
    let gx = pny / nlen;
    let gy = -pnx / nlen;
    let k = pwx * gx + pwy * gy;
    if (k < 0) {
      gx = -gx;
      gy = -gy;
      k = -k;
    }
    if (k < 2) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 4; i++) {
      const q = ((i & 1 ? W : 0) - cx) * gx + ((i & 2 ? H : 0) - cy) * gy;
      if (q < lo) lo = q;
      if (q > hi) hi = q;
    }
    const lenPx = waveTiles * k;
    const show = swellShow(this.surf.force);
    // Which bit of sea is under the middle of the screen, so the swell stays
    // on the water as you walk along the beach rather than travelling with
    // the view. The gradient is in screen space; this is what pins it down.
    const mid = cam.screenToWorld(cx, cy, 0);
    const drift = (this.time * SWELL_SPEED * (0.3 + 0.7 * this.surf.force) * rate - (mid.x * wdx + mid.y * wdy)) * k;
    const g = ctx.createLinearGradient(cx + gx * lo, cy + gy * lo, cx + gx * hi, cy + gy * hi);
    const span = hi - lo;
    const steps = Math.max(8, Math.min(140, Math.ceil((span / lenPx) * 9)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const w = Math.sin(((lo + t * span - drift) / lenPx) * Math.PI * 2);
      const alpha = amp * Math.abs(w) * show;
      g.addColorStop(t, w >= 0 ? `rgba(226,242,252,${alpha.toFixed(3)})` : `rgba(4,22,52,${alpha.toFixed(3)})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /**
   * What crossed the water, clipped to the water so a wake never washes up
   * over a beach standing in front of it. Each trail is drawn as a ribbon
   * that widens and fades behind whatever left it: one quad per pair of
   * points, which is what gives the spread its taper without anything having
   * to work out the shape of a wake.
   */
  private drawWakes(ctx: CanvasRenderingContext2D, zoom: number): void {
    const trails = this.wakes.live(this.time);
    if (!trails.length) return;
    const cam = this.camera;
    ctx.save();
    ctx.clip(this.seaPath);
    for (const trail of trails) {
      // One outline for the whole trail — up one side and back down the other
      // — so there is no seam anywhere along it. The width at each point is
      // how far that bit of water has had time to spread.
      const sx = (x: number, y: number): number => cam.worldToScreenX(x, y);
      const sy = (x: number, y: number): number => cam.worldToScreenY(x, y, 0);
      const side = (i: number, hand: number): [number, number] => {
        const p = trail[i];
        const a = trail[Math.max(0, i - 1)];
        const b = trail[Math.min(trail.length - 1, i + 1)];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const w = Wakes.spread(p, this.time).width * hand;
        return [p.x + (-dy / len) * w, p.y + (dx / len) * w];
      };
      ctx.beginPath();
      for (let i = 0; i < trail.length; i++) {
        const [wx, wy] = side(i, 1);
        if (i === 0) ctx.moveTo(sx(wx, wy), sy(wx, wy));
        else ctx.lineTo(sx(wx, wy), sy(wx, wy));
      }
      for (let i = trail.length - 1; i >= 0; i--) {
        const [wx, wy] = side(i, -1);
        ctx.lineTo(sx(wx, wy), sy(wx, wy));
      }
      ctx.closePath();
      // Brightest at the stern and gone by the far end, laid along the trail.
      const head = trail[trail.length - 1];
      const tail = trail[0];
      const g = ctx.createLinearGradient(sx(head.x, head.y), sy(head.x, head.y), sx(tail.x, tail.y), sy(tail.x, tail.y));
      const lead = Wakes.spread(head, this.time).alpha;
      g.addColorStop(0, `rgba(228,242,250,${lead.toFixed(3)})`);
      g.addColorStop(0.55, `rgba(228,242,250,${(lead * 0.5).toFixed(3)})`);
      g.addColorStop(1, 'rgba(228,242,250,0)');
      ctx.fillStyle = g;
      ctx.fill();
      // And a curl of broken water right where the thing is now.
      ctx.fillStyle = 'rgba(240,250,255,0.3)';
      ctx.beginPath();
      ctx.ellipse(sx(head.x, head.y), sy(head.x, head.y), head.beam * 1.15 * HALF_W * zoom, head.beam * 1.15 * HALF_H * zoom, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawWater(u: number, v: number, x: number, y: number, c: number[], fogInto?: Path2D): void {
    const poly = this.waterPoly;
    // Where the ground crosses zero: two points on a beach tile, none on open
    // water, and four on the rare saddle, which gets no foam rather than the
    // wrong foam.
    const edge = this.waterEdge;
    let cross = 0;
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
        const cx = ax + (bx - ax) * t;
        const cy = ay + (by - ay) * t;
        if (cross < 4) {
          edge[cross++] = cx;
          edge[cross++] = cy;
        } else cross = 5;
        poly[n++] = cx;
        poly[n++] = cy;
      }
    }
    if (n < 6) return;
    const ctx = this.canvas.ctx;
    const cam = this.camera;
    const depth = Math.max(0, -(c[0] + c[1] + c[2] + c[3]) / 4);
    const level = Math.min(WATER_STEPS - 1, Math.floor(depth / 1.6));
    const { dirX, dirY, force } = this.surf;
    const wave = swellAt(x, y, this.time, dirX, dirY, force);
    const show = swellShow(force);
    ctx.fillStyle = WATER_PALETTE[level];
    ctx.beginPath();
    for (let k = 0; k < n; k += 2) {
      const sx = cam.viewToScreenX(poly[k], poly[k + 1]);
      const sy = cam.viewToScreenY(poly[k], poly[k + 1], 0);
      if (k === 0) {
        ctx.moveTo(sx, sy);
        fogInto?.moveTo(sx, sy);
        this.seaPath.moveTo(sx, sy);
      } else {
        ctx.lineTo(sx, sy);
        fogInto?.lineTo(sx, sy);
        this.seaPath.lineTo(sx, sy);
      }
    }
    ctx.closePath();
    fogInto?.closePath();
    this.seaPath.closePath();
    this.drewWater = true;
    ctx.fill();
    // Foam, where the ground crosses the waterline. The two points the
    // polygon had to interpolate to know its own shape are the beach.
    if (cross === 4) {
      ctx.strokeStyle = `rgba(240,250,255,${foamAlpha(wave, force).toFixed(3)})`;
      ctx.lineWidth = FOAM_WIDTH * cam.zoom * (0.72 + 0.42 * Math.max(0, wave) * show);
      ctx.beginPath();
      ctx.moveTo(cam.viewToScreenX(edge[0], edge[1]), cam.viewToScreenY(edge[0], edge[1], 0));
      ctx.lineTo(cam.viewToScreenX(edge[2], edge[3]), cam.viewToScreenY(edge[2], edge[3], 0));
      ctx.stroke();
      ctx.lineWidth = 1;
    }
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

    /*
     * Night: a cold wash over the whole world, with a hole burnt in it by
     * everything alight. The wash is laid down on its own layer so each light
     * can be taken back out of it with a soft-edged gradient; that is what
     * makes a lantern feel like a lantern rather than a brighter circle.
     * Markers and the hud sit on top of the lot.
     */
    const dark = game.darkness();
    // The warm end of the day arrives before the dark does, so the wash is
    // asked for whatever the darkness reads.
    const washes = skyWash(game.hourOfDay(), dark);
    if (washes.length) {
      const lights = game.lights();
      if (!lights.length) {
        for (const wash of washes) {
          ctx.fillStyle = `rgba(${wash.colour}, ${wash.alpha.toFixed(3)})`;
          ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
      } else {
        const night = this.nightLayer();
        const nc = night.getContext('2d') as CanvasRenderingContext2D;
        nc.setTransform(1, 0, 0, 1, 0, 0);
        nc.globalCompositeOperation = 'source-over';
        nc.clearRect(0, 0, night.width, night.height);
        for (const wash of washes) {
          nc.fillStyle = `rgba(${wash.colour}, ${wash.alpha.toFixed(3)})`;
          nc.fillRect(0, 0, night.width, night.height);
        }
        nc.globalCompositeOperation = 'destination-out';
        for (const l of lights) {
          const h = w.heightAt(l.x, l.y);
          const sx = cam.worldToScreenX(l.x, l.y);
          const sy = cam.worldToScreenY(l.x, l.y, h);
          // A flame is never steady; a candle behind cloth very nearly is.
          const r = Math.max(8, l.radius * HALF_W * zoom * this.flicker(l));
          if (sx < -r || sy < -r || sx > night.width + r || sy > night.height + r) continue;
          const grad = nc.createRadialGradient(sx, sy, 0, sx, sy, r);
          grad.addColorStop(0, `rgba(0,0,0,${l.strength.toFixed(2)})`);
          grad.addColorStop(0.55, `rgba(0,0,0,${(l.strength * 0.55).toFixed(2)})`);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          nc.fillStyle = grad;
          nc.beginPath();
          nc.arc(sx, sy, r, 0, Math.PI * 2);
          nc.fill();
        }
        nc.globalCompositeOperation = 'source-over';
        ctx.drawImage(night, 0, 0);
        // A warm cast where the firelight actually falls, over the cold.
        ctx.globalCompositeOperation = 'lighter';
        for (const l of lights) {
          const h = w.heightAt(l.x, l.y);
          const sx = cam.worldToScreenX(l.x, l.y);
          const sy = cam.worldToScreenY(l.x, l.y, h);
          const r = Math.max(8, l.radius * HALF_W * zoom * this.flicker(l));
          if (sx < -r || sy < -r || sx > this.canvas.width + r || sy > this.canvas.height + r) continue;
          const warm = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
          warm.addColorStop(0, `rgba(255, 186, 92, ${(0.16 * dark * l.strength).toFixed(3)})`);
          warm.addColorStop(1, 'rgba(255, 186, 92, 0)');
          ctx.fillStyle = warm;
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // The chosen tile, marked whether or not the cursor is anywhere near it.
    const chosen = this.selected;
    if (chosen && w.inBounds(chosen.x, chosen.y)) {
      this.tilePath(ctx, chosen.x, chosen.y);
      ctx.fillStyle = 'rgba(227,182,87,0.14)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(240,205,120,0.95)';
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    const hover = this.hover;
    this.drawProspected(ctx);
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

  /**
   * How a sail is set: which side it is out on and how full it is. A hull
   * nobody is sailing sits with the sail slack.
   */
  private sailTrim(f: PlacedFurniture): number | undefined {
    const def = FURNITURE_BY_ID.get(f.kind)?.boat;
    if (!def?.sail) return undefined;
    if (!f.driven) return 0.25;
    return sailTrim(this.game.heading(), this.game.wind());
  }

  /** Screen point to tile, taking terrain height into account; creatures and trees are picked by their sprite. */
  /**
   * What is under a screen point. Things standing on the ground are picked by
   * their sprite; a tree is not, because a tree is the tile rather than a thing
   * on it — its canopy leans over the tiles behind it, and catching clicks with
   * it put the cursor on a tile a long way from where it was pointing.
   */
  pick(sx: number, sy: number): Pick | null {
    for (let i = this.creatureHits.length - 1; i >= 0; i--) {
      const h = this.creatureHits[i];
      if (sx >= h.left && sx <= h.left + h.w && sy >= h.top && sy <= h.top + h.h) return { ...this.makePick(h.x, h.y, sx, sy), creature: h.creature };
    }
    for (let i = this.crateHits.length - 1; i >= 0; i--) {
      const h = this.crateHits[i];
      if (sx >= h.left && sx <= h.left + h.w && sy >= h.top && sy <= h.top + h.h) return { ...this.makePick(h.x, h.y, sx, sy), crate: h.crate };
    }
    for (let i = this.smelterHits.length - 1; i >= 0; i--) {
      const h = this.smelterHits[i];
      if (sx >= h.left && sx <= h.left + h.w && sy >= h.top && sy <= h.top + h.h) return { ...this.makePick(h.x, h.y, sx, sy), smelter: h.smelter };
    }
    for (let i = this.furnitureHits.length - 1; i >= 0; i--) {
      const h = this.furnitureHits[i];
      if (sx >= h.left && sx <= h.left + h.w && sy >= h.top && sy <= h.top + h.h) return { ...this.makePick(h.x, h.y, sx, sy), furniture: h.furniture };
    }
    for (let i = this.kilnHits.length - 1; i >= 0; i--) {
      const h = this.kilnHits[i];
      if (sx >= h.left && sx <= h.left + h.w && sy >= h.top && sy <= h.top + h.h) return { ...this.makePick(h.x, h.y, sx, sy), kiln: h.kiln };
    }
    for (let i = this.postHits.length - 1; i >= 0; i--) {
      const h = this.postHits[i];
      if (sx >= h.left && sx <= h.left + h.w && sy >= h.top && sy <= h.top + h.h) return { ...this.makePick(h.x, h.y, sx, sy), post: h.post };
    }
    for (let i = this.trapHits.length - 1; i >= 0; i--) {
      const h = this.trapHits[i];
      if (sx >= h.left && sx <= h.left + h.w && sy >= h.top && sy <= h.top + h.h) return { ...this.makePick(h.x, h.y, sx, sy), trap: h.trap };
    }
    for (let i = this.deckHits.length - 1; i >= 0; i--) {
      const h = this.deckHits[i];
      if (sx >= h.left && sx <= h.left + h.w && sy >= h.top && sy <= h.top + h.h) return { ...this.makePick(h.x, h.y, sx, sy), bridge: h.bridge };
    }
    for (let i = this.anvilHits.length - 1; i >= 0; i--) {
      const h = this.anvilHits[i];
      if (sx >= h.left && sx <= h.left + h.w && sy >= h.top && sy <= h.top + h.h) return { ...this.makePick(h.x, h.y, sx, sy), anvil: h.anvil };
    }
    for (let i = this.fireHits.length - 1; i >= 0; i--) {
      const h = this.fireHits[i];
      if (sx >= h.left && sx <= h.left + h.w && sy >= h.top && sy <= h.top + h.h) return { ...this.makePick(h.x, h.y, sx, sy), fire: h.fire };
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
        // Ground nobody has seen is not there to be clicked on.
        if (this.pointInTile(x, y, sx, sy)) return this.game.vision.state(x, y) === UNSEEN ? null : this.makePick(x, y, sx, sy);
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
