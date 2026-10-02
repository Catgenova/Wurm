/**
 * An aqueduct as it is drawn: an arcade of dressed stone, one bay to a tile
 * of span, carrying a channel of running water between two parapets, and at
 * its foot a spout the water goes over into its basin as a falling sheet.
 *
 * The stone is the stone brick's own, laid as the renderer lays a wall of it:
 * the same painted face (`stonework` in `./masonry`), its courses level with
 * the world's, shaded by the hour's light the way a wall turned from the sun
 * is. Where a mason dresses stone it is dressed in the stone brick's pale
 * limestone -- the ring of voussoirs round each arch and its keystone, the
 * impost it springs from, the string course between one tier of arches and
 * the next, the cornice under the parapets, the coping along them. A tall one
 * stands in tiers, as the great ones do: a tier of arches for every `TIER` of
 * height the ground falls away below the channel, to `TIERS` of them, the
 * lowest standing on its piers on the ground, on the water standing over it,
 * or on a foundation's top. Where the ground comes up under a bay too high
 * for an arch to open in it, the bay is laid solid, as an abutment is.
 *
 * Everything is worked out in the world -- along the run, across it, and up
 * -- and put on the screen through the camera's own projection, so it is the
 * same aqueduct at every turn of the view. Each bay is drawn as two pieces
 * sorted among what stands on its tile: what is seen through its arches (the
 * jamb and the floor of the passage under each, in the arcade's shade) behind
 * anybody standing under it, and its face, top and water in front of them.
 *
 * The water is the springs' (`./water` for its colours, `./falls` for the
 * sheet at the spout): it comes along the channel from its head when a
 * spring's water first reaches it, runs in streaks at the pace of water on a
 * gentle fall, glints where the sun catches it, and goes dark with the night
 * as everything does. Zoomed out below `DETAIL_FROM` it is shapes and colours.
 */
import type { Camera } from '../engine/camera';
import { isDone, progressOf, WALL_HEIGHT } from '../game/building';
import type { Bridge } from '../game/bridges';
import { hash2 } from '../world/noise';
import { CHANNEL_DEEP, CHANNEL_WIDE, TILE_UNITS } from '../world/aqueducts';
import { RUN_RATE } from '../world/springs';
import type { World } from '../world/world';
import { DETAIL_FROM, drawFoot, drawLip, drawSheet, place, type FallView, type Placed, type Sheet } from './falls';
import { FOUNT } from './fountain';
import { HEIGHT_SCALE } from './iso';
import { mossStrip, PPM } from './ivy';
import { stonework } from './masonry';
import type { Side } from './pools';
import { depthOf, type View } from './view';
import { SPRING_EDGE, SPRING_FOAM, SPRING_PALE, SPRING_WATER } from './water';

/** Half the width of the arcade across its run, in tiles: two metres wide, the channel a metre of it. */
const HALF = 0.25;
/** Half the width of the water in the channel, in tiles. */
const WET = CHANNEL_WIDE / 2;
/** How far the parapets stand over the water, in height units. */
const PARAPET = 1.6;
/** Half the thickness of a pier along the run, in tiles: each bay's arch opens between two. */
const PIER = 0.12;
/** How far each arch springs from the middle of its bay, in tiles, and how high it rises, in height units: a true half circle. */
const SPAN = 0.5 - PIER;
const RISE = SPAN * TILE_UNITS;
/**
 * The height of one tier of arches, in height units, and the most tiers there
 * are: enough that the lowest arch keeps its proportions down the deepest
 * gorge a channel can be carried over, rather than opening into a slot.
 */
const TIER = 38;
const TIERS = 24;
/** The cornice along the top, the string course between tiers, and the ring of voussoirs round an arch, in height units. */
const CORNICE = 1.8;
const STRING = 1.3;
const RING = 2.4;
/** The masonry over the crown of the top arch, under the channel's bed, in height units. */
const OVER = 3;
/** How far an arch's ground may come up its opening before the bay is laid solid instead, as a share of the arch's rise over its springing. */
const BURIED = 0.4;
/** The footing along the bottom of the face, darker for the damp, in height units. */
const FOOTING = 3;
/** How far the spout stands out past the last pier, in tiles. */
const SPOUT = 0.11;
/** How fast the water in the channel is drawn going, in tiles a second: water on a gentle fall, whatever pace the rules give it. */
const DRAWN_PACE = 1.15;
/** How far apart the streaks on the channel's water are, in tiles, and how long one is. */
const STREAK_EVERY = 0.31;
const STREAK_LONG = 0.11;
/** How far apart the glints on it are, in tiles, and how long each takes to come and go, in seconds. */
const GLINT_EVERY = 0.23;
const GLINT_LIFE = 1.3;
/** How long a coping stone along a parapet is, in tiles. */
const COPING = 0.25;
/** The arcade's shade over the floor of the passage under an arch. */
const PASSAGE_SHADE = 'rgba(40,40,70,0.2)';

type RGB = readonly [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const css = (c: RGB, a = 1): string => (a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`);
const lit = (c: RGB, k: number): RGB => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

/**
 * The stone brick's own colours (`STONE_PASTEL` in `./masonry`): the block
 * and its shade, the limestone it is dressed in with its shade and its
 * light, the band of it at a floor line and the top of one, the joint
 * between two voussoirs, the ink round a block, and the footing.
 */
const STONE = hex('#aeb2c0');
const STONE_SHADE = hex('#999dac');
const DRESS = hex('#d8cfbc');
const DRESS_SHADE = hex('#c0b5a1');
const DRESS_HI = hex('#e7e0d2');
const BAND = hex('#d3c9b5');
const BAND_SHADE = hex('#b9ae99');
const TOP = hex('#ddd4c2');
const RING_JOINT = hex('#8c8e9c');
const LINE = hex('#6b6d7d');
const FOOT = hex('#8f93a3');
/** The timber of the centring an arch is turned over. */
const TIMBER = hex('#8a6a46');
const TIMBER_DARK = hex('#5e4630');
/** The channel's bed where no water runs, its walls where it does, and the damp along the foot of a pier standing in water. */
const BED_DRY = hex('#9ea2ae');
const WALL_WET = hex('#7f8f96');
const DAMP = hex('#7d8394');

/** One piece of an aqueduct to draw: a bay's insides, its face and water, or the spout at its foot. */
export interface AqueductPart {
  b: Bridge;
  /** Which bay, by its place in the spans from the head. */
  k: number;
  part: 'back' | 'front' | 'spout' | 'intake' | 'off';
}

/** What a frame of aqueducts is drawn with, handed over by the renderer before the ground. */
export interface AqueductFrame {
  cam: Camera;
  world: World;
  /** The drawing clock, in seconds, and the wall clock, in milliseconds. */
  t: number;
  now: number;
  /** How dark it has got, nought to one, and how high the sun stands, nought on the horizon to one overhead. */
  dark: number;
  sunUp: number;
  /** The falls painter's projection, for the sheet at a spout. */
  fv: FallView;
  /** When a spring's water starts along an aqueduct, in milliseconds of the wall clock, or null while it is dry. */
  flowing: (id: number) => number | null;
  /** How high the water on a tile stands, or null where there is none. */
  surface: (x: number, y: number) => number | null;
  /** The top of a foundation poured on a tile, or null where there is none; and of one with no pool dug in it. */
  slab: (x: number, y: number) => number | null;
  bare: (x: number, y: number) => number | null;
  /** The corner a spring's water goes on from at an aqueduct's foot, where it runs on as a stream, by the aqueduct's id. */
  pours: (id: number) => readonly [number, number] | null;
  /** The broken water at a fall's foot, and somewhere to send the mist off it. */
  foam: CanvasImageSource | null;
  mist: (p: Placed) => void;
  /** A fountain standing on a tile: its middle, and the ground it stands on. */
  fountain: (x: number, y: number) => { x: number; y: number; base: number } | null;
  /**
   * How far the moss on a finished aqueduct's face has got over its tile, in
   * stages of `PAVE_STAGES` (`greenShows`), for a face turned to the shade
   * (`shade` 1) or to the sun: its stone greens as a stone arch's does.
   */
  moss: (b: Bridge, x: number, y: number, shade: number) => number;
}

/** One tier of a bay's arches: its crown, where it springs, and what its piers stand on. */
interface Tier {
  crown: number;
  spring: number;
  foot: number;
}

/** A bay as it lies this frame: its tile's middle, the unit steps along and across the run, the heights, and the screen projection. */
interface Bay {
  b: Bridge;
  k: number;
  n: number;
  mx: number;
  my: number;
  ax: number;
  ay: number;
  cx: number;
  cy: number;
  /** Which side across the run faces the camera, +1 or -1. */
  near: number;
  water: number;
  top: number;
  bed: number;
  /** What its piers stand on where it is higher than the ground: the water over its tile, the sea's, or a foundation's top. */
  base: number;
  /** The lowest and highest of what it stands on, every sample of it, and the arches it stands on, top tier first: none on an abutment. */
  low: number;
  high: number;
  ground: number[];
  tiers: Tier[];
  /** Which of the stonework's faces it is laid in. */
  v: number;
}

export class AqueductPainter {
  private f: AqueductFrame | null = null;
  /** The aqueducts that pour into each tile and that draw from each, by `y * width + x`, and the world's width. */
  private feet = new Map<number, Bridge[]>();
  private heads = new Map<number, Bridge[]>();
  /** Where water poured onto a foundation at an aqueduct's foot goes over its edge facing the camera: by the tile it falls into, the aqueduct and the edge. */
  private offs = new Map<number, Array<{ b: Bridge; edge: SlabEdge }>>();
  private w = 1;
  /** The projection: the screen point of the world's origin at height nought, and the screen step for a tile along x, along y, and a unit up. */
  private ox = 0;
  private oy = 0;
  private xx = 0;
  private xy = 0;
  private yx = 0;
  private yy = 0;
  private hs = HEIGHT_SCALE;
  private zoom = 1;
  /**
   * Each bay's masonry as a picture of its own, by bay and piece: drawn once
   * and laid again every frame while nothing it shows has changed -- the turn
   * and zoom of the view, how far the work has got, the ground under it --
   * so a still view or a pan costs a picture a piece. The water on it moves,
   * and is drawn every frame over and under it.
   */
  private layers = new Map<string, { key: string; zoom: number; canvas: HTMLCanvasElement; dx: number; dy: number; w: number; h: number; seen: number }>();
  private frames = 0;
  /**
   * While the view is being zoomed, by a pinch or a wheel, every bay's picture
   * is laid again scaled to the zoom rather than drawn afresh in any frame of
   * it; once the zoom has stood still for `ZOOM_SETTLE` ms they are drawn
   * again at the new one, `REDRAWS` of them a frame. A step to another zoom
   * from a still view, further than `ZOOM_STEP`, draws them all at once.
   */
  private lastZoom = 0;
  private zoomedAt = -Infinity;
  private zooming = false;
  private redraws = 0;
  /** Every span with any of its stone laid, by `y * width + x`: what the water under it is drawn behind (`under`), and a count that changes when they do. */
  private spanAt = new Map<number, Array<{ b: Bridge; k: number }>>();
  underKey = 0;

  /** Once a frame, before the ground: where the camera is, and which tiles an aqueduct pours into. */
  frame(f: AqueductFrame, bridges: Iterable<Bridge>, width: number): void {
    this.f = f;
    this.w = width;
    // Pictures of bays nobody has looked at for a while go.
    if (++this.frames % 120 === 0) for (const [id, l] of this.layers) if (this.frames - l.seen > 600) this.layers.delete(id);
    const cam = f.cam;
    this.zoom = cam.zoom;
    const clock = performance.now();
    let jumped = false;
    if (cam.zoom !== this.lastZoom) {
      const step = this.lastZoom > 0 ? Math.abs(Math.log(cam.zoom / this.lastZoom)) : Infinity;
      // A step of a pinch, or any step while one is going on.
      if (clock - this.zoomedAt < ZOOM_SETTLE || step <= Math.log(1 + ZOOM_STEP)) this.zoomedAt = clock;
      else {
        this.zoomedAt = -Infinity;
        jumped = true;
      }
      this.lastZoom = cam.zoom;
    }
    this.zooming = clock - this.zoomedAt < ZOOM_SETTLE;
    this.redraws = jumped ? Infinity : REDRAWS;
    this.ox = cam.worldToScreenX(0, 0);
    this.oy = cam.worldToScreenY(0, 0, 0);
    this.xx = cam.worldToScreenX(1, 0) - this.ox;
    this.xy = cam.worldToScreenX(0, 1) - this.ox;
    this.yx = cam.worldToScreenY(1, 0, 0) - this.oy;
    this.yy = cam.worldToScreenY(0, 1, 0) - this.oy;
    this.hs = HEIGHT_SCALE * cam.zoom;
    this.feet.clear();
    this.heads.clear();
    this.spanAt.clear();
    this.offs.clear();
    let sig = 0;
    for (const b of bridges) {
      if (b.kind !== 'aqueduct') continue;
      b.spans.forEach((sp, k) => {
        if (!isDone(sp) && progressOf(sp) <= 0) return;
        sig = (sig * 31 + b.id * 17 + k + 1) | 0;
        const at = sp.y * width + sp.x;
        const here = this.spanAt.get(at);
        if (here) here.push({ b, k });
        else this.spanAt.set(at, [{ b, k }]);
      });
      const edge = f.bare(b.bx, b.by) !== null && b.spans.every(isDone) ? this.slabEdge(b) : null;
      if (edge && cam.nearSide(edge.nx, edge.ny) > 0) {
        const at = (b.by + edge.ny) * width + b.bx + edge.nx;
        const here = this.offs.get(at);
        if (here) here.push({ b, edge });
        else this.offs.set(at, [{ b, edge }]);
      }
      for (const [map, key] of [[this.feet, b.by * width + b.bx], [this.heads, b.ay * width + b.ax]] as const) {
        const here = map.get(key);
        if (here) here.push(b);
        else map.set(key, [b]);
      }
    }
    this.underKey = sig & 0xffff;
  }

  /**
   * The line of the ground the bay standing in a point's tile is drawn in, or
   * null where none is: water running under an arch, or falling down beside a
   * bay within its tile, is drawn before the bay -- behind its piers, its face
   * and its coping -- rather than over them, so no stream or fall is ever
   * drawn across its masonry.
   */
  under(wx: number, wy: number, V: View): number | null {
    if (!this.spanAt.size) return null;
    const fx = Math.floor(wx);
    const fy = Math.floor(wy);
    let best: number | null = null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const { b } of this.spanAt.get((fy + dy) * this.w + fx + dx) ?? NO_SPANS) {
          const ax = Math.sign(b.bx - b.ax);
          const ay = Math.sign(b.by - b.ay);
          const ox = wx - (fx + dx + 0.5);
          const oy = wy - (fy + dy + 0.5);
          if (Math.abs(ox * ax + oy * ay) > 0.52 || Math.abs(-ox * ay + oy * ax) > 0.52) continue;
          const d = depthOf(V, fx + dx, fy + dy);
          if (best === null || d < best) best = d;
        }
      }
    }
    return best;
  }

  /**
   * The bays standing in front of a building whose roof is laid at line `d`
   * of the ground, drawn on earlier lines: those within two tiles of it with
   * the building across their run on their far side. Its roof is laid with
   * them cut out of it (`clipOut`), so it does not come out over them.
   */
  before(tiles: Iterable<string>, d: number, V: View): Array<{ b: Bridge; k: number }> {
    const out: Array<{ b: Bridge; k: number }> = [];
    if (!this.spanAt.size || !this.f) return out;
    const seen = new Set<string>();
    for (const t of tiles) {
      const [x, y] = t.split(',').map(Number);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const sx = x + dx;
          const sy = y + dy;
          for (const { b, k } of this.spanAt.get(sy * this.w + sx) ?? NO_SPANS) {
            const id = `${b.id}:${k}`;
            if (seen.has(id) || depthOf(V, sx, sy) >= d) continue;
            const cx = -Math.sign(b.by - b.ay);
            const cy = Math.sign(b.bx - b.ax);
            if (((x - sx) * cx + (y - sy) * cy) * this.f.cam.nearSide(cx, cy) >= 0) continue;
            seen.add(id);
            out.push({ b, k });
          }
        }
      }
    }
    return out;
  }

  /**
   * Cut these bays out of what is drawn next: their faces but for their
   * arches, their tops, and an end where it faces the camera, each a hair
   * past its edges, so nothing shows along the seams between them.
   */
  clipOut(ctx: CanvasRenderingContext2D, bays: ReadonlyArray<{ b: Bridge; k: number }>): void {
    for (const { b, k } of bays) {
      const bay = this.bay(b, k);
      if (!bay) continue;
      const shape = this.shapeOf(bay);
      ctx.beginPath();
      ctx.rect(-1e4, -1e4, 3e4, 3e4);
      polyPath(ctx, grown(shape.face, SEAM));
      for (const hole of shape.holes) polyPath(ctx, hole);
      ctx.clip('evenodd');
      for (const part of [shape.top, shape.end]) {
        if (!part) continue;
        ctx.beginPath();
        ctx.rect(-1e4, -1e4, 3e4, 3e4);
        polyPath(ctx, grown(part, SEAM));
        ctx.clip('evenodd');
      }
    }
  }

  /** Whether a screen point is on a bay as it was drawn: its face but not through an arch, its top, or an end facing the camera. */
  hits(shape: AqueductShape, x: number, y: number): boolean {
    if (inPoly(shape.top, x, y) || (shape.end && inPoly(shape.end, x, y))) return true;
    return inPoly(shape.face, x, y) && !shape.holes.some((h) => inPoly(h, x, y));
  }

  /**
   * A bay's outline on the screen, as far up as it has been laid (or pegged
   * out, before any of it is): its near face from what it stands on to its
   * top, the arches through that face, its top across the arcade's width,
   * and the end of the arcade where that faces the camera.
   */
  private shapeOf(bay: Bay): AqueductShape {
    const sp = bay.b.spans[bay.k];
    const done = isDone(sp);
    const p = progressOf(sp);
    const upTo = done || p <= 0 ? bay.top : bay.low + (bay.top - bay.low) * p;
    const nearS = bay.near * HALF;
    const pts = (list: Array<[number, number, number]>): Float64Array => {
      const out = new Float64Array(list.length * 2);
      list.forEach(([t, sd, h], i) => {
        this.at(bay, t, sd, h);
        out[i * 2] = PT[0];
        out[i * 2 + 1] = PT[1];
      });
      return out;
    };
    const face = pts([[0, nearS, upTo], [1, nearS, upTo], ...[1, 0.75, 0.5, 0.25, 0].map((t): [number, number, number] => [t, nearS, this.floor(bay, t, nearS) - 0.8])]);
    // Across its width at the top, and on a finished bay the channel sunk in it down to its bed, which shows past the top's ends.
    const rim: Array<[number, number, number]> = [[0, -HALF, upTo], [1, -HALF, upTo], [1, HALF, upTo], [0, HALF, upTo]];
    const top = done ? hullOf(pts([...rim, [0, -WET, bay.bed], [1, -WET, bay.bed], [1, WET, bay.bed], [0, WET, bay.bed]])) : pts(rim);
    const n = this.zoom >= DETAIL_FROM ? 16 : 9;
    const holes = bay.tiers.filter((tier) => tier.spring < upTo).map((tier) => {
      const arc: Array<[number, number, number]> = [[PIER, nearS, tier.foot]];
      for (let i = 0; i <= n; i++) {
        const a = Math.PI - (Math.PI * i) / n;
        arc.push([0.5 + SPAN * Math.cos(a), nearS, tier.spring + RISE * Math.sin(a)]);
      }
      arc.push([1 - PIER, nearS, tier.foot]);
      return pts(arc);
    });
    // The end of the arcade, at its head or its foot, where it faces the camera.
    const cam = this.f!.cam;
    const endT = bay.k === 0 && cam.nearSide(-bay.ax, -bay.ay) > 0 ? 0 : bay.k === bay.n - 1 && cam.nearSide(bay.ax, bay.ay) > 0 ? 1 : -1;
    const end = endT < 0 ? null
      : pts([[endT, -HALF, this.floor(bay, endT, -HALF) - 0.8], [endT, HALF, this.floor(bay, endT, HALF) - 0.8], [endT, HALF, upTo], [endT, -HALF, upTo]]);
    return { face, top, end, holes };
  }

  /** The aqueducts pouring into a tile, which draw their spout with it. */
  footAt(x: number, y: number): readonly Bridge[] | undefined {
    return this.feet.size ? this.feet.get(y * this.w + x) : undefined;
  }

  /** The aqueducts whose water goes over the edge of a foundation at their foot into a tile, facing the camera, which draw that fall with it. */
  offAt(x: number, y: number): ReadonlyArray<{ b: Bridge; edge: SlabEdge }> | undefined {
    return this.offs.size ? this.offs.get(y * this.w + x) : undefined;
  }

  /**
   * Where the water an aqueduct pours onto a foundation with no pool in it
   * goes over the slab's edge (`settleChain`'s `pour`): the corner its stream
   * runs on from, and of the two edges of the slab at that corner the first in
   * the rules' order -- north, west, east, south -- other than the one its end
   * pier stands on; the point on that edge a channel's width in from the
   * corner, and the way out over it.
   */
  private slabEdge(b: Bridge): SlabEdge | null {
    const at = this.f!.pours(b.id);
    if (!at) return null;
    const [px, py] = at;
    const tx = b.bx;
    const ty = b.by;
    const ax = Math.sign(b.bx - b.ax);
    const ay = Math.sign(b.by - b.ay);
    const sides: Array<[number, number]> = [];
    if (py === ty) sides.push([0, -1]);
    if (px === tx) sides.push([-1, 0]);
    if (px === tx + 1) sides.push([1, 0]);
    if (py === ty + 1) sides.push([0, 1]);
    const side = sides.find(([nx, ny]) => !(nx === -ax && ny === -ay));
    if (!side) return null;
    const [nx, ny] = side;
    const inX = nx === 0 ? (px === tx ? 1 : -1) : 0;
    const inY = ny === 0 ? (py === ty ? 1 : -1) : 0;
    return { x: px + inX * (WET + 0.04), y: py + inY * (WET + 0.04), nx, ny };
  }

  /** The aqueducts drawing from a tile, which draw the cut their water comes in by with it. */
  headAt(x: number, y: number): readonly Bridge[] | undefined {
    return this.heads.size ? this.heads.get(y * this.w + x) : undefined;
  }

  /**
   * Where a finished aqueduct's channel goes through the rim of a pool dug in
   * a tile (`./pools`): out of the pool it draws from, at its water, and into
   * the pool it pours into where its water runs lower than that pool's top --
   * through the side the arcade stands on, the channel's width about its middle.
   */
  cutsAt(x: number, y: number): Array<{ side: Side; t0: number; t1: number }> | undefined {
    if (!this.heads.size) return undefined;
    const key = y * this.w + x;
    const out: Array<{ side: Side; t0: number; t1: number }> = [];
    const cut = (dx: number, dy: number): void => {
      out.push({ side: dx > 0 ? 'e' : dx < 0 ? 'w' : dy > 0 ? 's' : 'n', t0: 0.5 - WET, t1: 0.5 + WET });
    };
    for (const b of this.heads.get(key) ?? []) if (b.spans.every(isDone)) cut(Math.sign(b.bx - b.ax), Math.sign(b.by - b.ay));
    const top = this.f?.slab(x, y) ?? null;
    for (const b of this.feet.get(key) ?? []) if (top !== null && b.height < top && b.spans.every(isDone)) cut(Math.sign(b.ax - b.bx), Math.sign(b.ay - b.by));
    return out.length ? out : undefined;
  }

  /**
   * Where a piece sorts among what stands on its tile, on the ground: a bay's
   * insides at the middle of its far face and the rest at the middle of its
   * near face, so somebody under its arch is drawn between the two; and the
   * fall at a spout where it comes down, so a fountain it pours into stands
   * in front of it or behind it as it should.
   */
  sortPoint(b: Bridge, x: number, y: number, part: AqueductPart['part']): [number, number] {
    const ax = Math.sign(b.bx - b.ax);
    const ay = Math.sign(b.by - b.ay);
    const cx = -ay;
    const cy = ax;
    let wx: number;
    let wy: number;
    if (part === 'spout') {
      // The near edge of the tile it pours into, and a little way in past the spout.
      wx = x + 0.5 - ax * (0.5 - SPOUT - 0.2);
      wy = y + 0.5 - ay * (0.5 - SPOUT - 0.2);
    } else if (part === 'off') {
      // Just out over the edge of the foundation the water goes over.
      const e = this.slabEdge(b);
      wx = (e?.x ?? x + 0.5) + (e?.nx ?? 0) * 0.15;
      wy = (e?.y ?? y + 0.5) + (e?.ny ?? 0) * 0.15;
    } else if (part === 'intake') {
      // The edge of the tile it draws from, where the arcade begins.
      wx = x + 0.5 + ax * 0.45;
      wy = y + 0.5 + ay * 0.45;
    } else {
      const near = this.f ? this.f.cam.nearSide(cx, cy) : 1;
      const s = (part === 'front' ? 1 : -1) * near * HALF;
      wx = x + 0.5 + cx * s;
      wy = y + 0.5 + cy * s;
    }
    const g = this.f ? this.f.world.heightAt(wx, wy) : 0;
    return [this.sx(wx, wy), this.sy(wx, wy, g)];
  }

  /** Draw one piece. Answers the screen box a bay covers and its outline in it, for picking it, or null. */
  draw(ctx: CanvasRenderingContext2D, p: AqueductPart): { left: number; top: number; w: number; h: number; shape: AqueductShape } | null {
    const f = this.f;
    if (!f) return null;
    if (p.part === 'spout') {
      this.spout(ctx, p.b);
      return null;
    }
    if (p.part === 'intake') {
      this.intake(ctx, p.b);
      return null;
    }
    if (p.part === 'off') {
      this.overEdge(ctx, p.b);
      return null;
    }
    const bay = this.bay(p.b, p.k);
    if (!bay) return null;
    if (p.part === 'back') {
      const sp = bay.b.spans[bay.k];
      if (!isDone(sp) && progressOf(sp) <= 0) return null;
      this.layered(ctx, bay, 'back', this.keyOf(bay), (g) => this.insides(g, bay));
      return null;
    }
    const box = this.front(ctx, bay);
    return { ...box, shape: this.shapeOf(bay) };
  }

  /** What a bay's pictures show depends on: the view, how far the work has got, its run and its height, and the ground under it. */
  private keyOf(bay: Bay): string {
    const sp = bay.b.spans[bay.k];
    return `${this.f!.cam.rotation}|${isDone(sp) ? 'done' : progressOf(sp).toFixed(4)}|${bay.b.height}|${bay.n}|`
      + `${bay.b.ax},${bay.b.ay},${bay.b.bx},${bay.b.by}|${bay.ground.map((g) => g.toFixed(2)).join(',')}`;
  }

  /**
   * Lay a piece of a bay from its picture, drawing the picture first if it
   * has none or what it shows has changed (`key`); a piece too big to keep a
   * picture of, close in, is drawn straight onto the screen. The picture is
   * kept at the screen's own pixels, drawn on whole ones.
   */
  private layered(ctx: CanvasRenderingContext2D, bay: Bay, part: string, key: string, paint: (g: CanvasRenderingContext2D) => void): void {
    const ax = this.sx(bay.mx, bay.my);
    const ay = this.sy(bay.mx, bay.my, 0);
    const scale = ctx.getTransform().a || 1;
    const id = `${bay.b.id}:${bay.k}:${part}`;
    const want = `${key}|${scale}`;
    let l = this.layers.get(id);
    // Drawn at another zoom: laid scaled while the view is being zoomed, or past this frame's share of drawing again.
    if (l && l.key === want && l.zoom !== this.zoom) {
      if (this.zooming || this.redraws <= 0) {
        const k = this.zoom / l.zoom;
        l.seen = this.frames;
        ctx.drawImage(l.canvas, ax + l.dx * k, ay + l.dy * k, l.w * k, l.h * k);
        return;
      }
      this.redraws--;
    }
    if (!l || l.key !== want || l.zoom !== this.zoom) {
      const box = this.box(bay);
      const m = 4 + 4 * this.zoom;
      // On whole device pixels, so a still view lays it back exactly as it was drawn.
      const x0 = Math.floor((box.left - m) * scale) / scale;
      const y0 = Math.floor((box.top - m) * scale) / scale;
      const w = box.w + 2 * m + 1;
      const h = box.h + 2 * m + 1;
      if (w * h * scale * scale > PICTURE_MOST) {
        this.layers.delete(id);
        paint(ctx);
        return;
      }
      const canvas = l?.canvas ?? document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(w * scale));
      canvas.height = Math.max(1, Math.ceil(h * scale));
      const g = canvas.getContext('2d');
      if (!g) {
        paint(ctx);
        return;
      }
      g.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
      paint(g);
      l = { key: want, zoom: this.zoom, canvas, dx: x0 - ax, dy: y0 - ay, w: canvas.width / scale, h: canvas.height / scale, seen: this.frames };
      this.layers.set(id, l);
    }
    l.seen = this.frames;
    // Where the view has moved since, it moves with it, every bay alike, so no seam opens between two.
    ctx.drawImage(l.canvas, ax + l.dx, ay + l.dy, l.w, l.h);
  }

  /* ---- Geometry ---------------------------------------------------------- */

  private sx(wx: number, wy: number): number {
    return this.ox + this.xx * wx + this.xy * wy;
  }

  private sy(wx: number, wy: number, h: number): number {
    return this.oy + this.yx * wx + this.yy * wy - h * this.hs;
  }

  /** The world point `t` along a bay from its head side, `s` across from its middle line. */
  private wx(bay: Bay, t: number, s: number): number {
    return bay.mx + bay.ax * (t - 0.5) + bay.cx * s;
  }

  private wy(bay: Bay, t: number, s: number): number {
    return bay.my + bay.ay * (t - 0.5) + bay.cy * s;
  }

  /** A point of a bay on the screen, into `PT`. */
  private at(bay: Bay, t: number, s: number, h: number): void {
    const x = this.wx(bay, t, s);
    const y = this.wy(bay, t, s);
    PT[0] = this.sx(x, y);
    PT[1] = this.sy(x, y, h);
  }

  private move(ctx: CanvasRenderingContext2D, bay: Bay, t: number, s: number, h: number): void {
    this.at(bay, t, s, h);
    ctx.moveTo(PT[0], PT[1]);
  }

  private line(ctx: CanvasRenderingContext2D, bay: Bay, t: number, s: number, h: number): void {
    this.at(bay, t, s, h);
    ctx.lineTo(PT[0], PT[1]);
  }

  /** What a point of a bay stands on: the ground, or the water or the foundation over it where that is higher. */
  private floor(bay: Bay, t: number, s: number): number {
    return Math.max(this.f!.world.heightAt(this.wx(bay, t, s), this.wy(bay, t, s)), bay.base);
  }

  /** A bay as it stands: its run, its heights, and the tiers of arches the ground under it leaves room for. */
  private bay(b: Bridge, k: number): Bay | null {
    const sp = b.spans[k];
    if (!sp) return null;
    const f = this.f!;
    const ax = Math.sign(b.bx - b.ax);
    const ay = Math.sign(b.by - b.ay);
    const cx = -ay;
    const cy = ax;
    const water = b.height;
    const top = water + PARAPET;
    const bay: Bay = {
      b, k, n: b.spans.length, mx: sp.x + 0.5, my: sp.y + 0.5, ax, ay, cx, cy,
      near: f.cam.nearSide(cx, cy), water, top, bed: water - CHANNEL_DEEP,
      // The sea stands at nought.
      base: Math.max(0, f.surface(sp.x, sp.y) ?? -Infinity, f.slab(sp.x, sp.y) ?? -Infinity),
      low: Infinity, high: -Infinity, ground: [], tiers: [], v: (b.id * 7 + k * 3) & 0xffff,
    };
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      for (const s of [-HALF, HALF]) {
        const g = this.floor(bay, t, s);
        bay.ground.push(g);
        bay.low = Math.min(bay.low, g);
        bay.high = Math.max(bay.high, g);
      }
    }
    /*
     * The top tier's arch under the channel, and another under it wherever the
     * ground falls away below the string course it would stand under, as the
     * tiers run on across a valley and into the hillside either side. An arch
     * the ground comes up into past `BURIED` of its rise is not opened: the
     * top one where the ground is that high anywhere in it, which makes the
     * bay an abutment, and a lower one where it is on the whole, which leaves
     * it standing with the slope across its foot.
     */
    let most = -Infinity;
    let mean = 0;
    for (const t of [PIER, 0.5, 1 - PIER]) {
      for (const s of [-HALF, HALF]) {
        const g = this.floor(bay, t, s);
        most = Math.max(most, g);
        mean += g / 6;
      }
    }
    for (let i = 0; i < TIERS; i++) {
      const head = i === 0 ? bay.bed - OVER : top - i * TIER - STRING;
      const crown = head - (i === 0 ? 0 : 1.5);
      const spring = crown - RISE;
      if (i > 0 && head < bay.low + 4) break;
      if ((i === 0 ? most : mean) > spring + RISE * BURIED) break;
      bay.tiers.push({ crown, spring, foot: 0 });
    }
    // Each arch stands on the string course of the tier under it, and the lowest on what is under the bay.
    for (let i = 0; i < bay.tiers.length; i++) {
      bay.tiers[i].foot = i + 1 < bay.tiers.length ? top - (i + 1) * TIER : bay.low - 4;
    }
    return bay;
  }

  /** How much light a face running one way takes: as the renderer lights a wall (`faceLight`). */
  private light(ux: number, uy: number): number {
    const cam = this.f!.cam;
    const vx = cam.rotateX(ux, uy);
    const along = Math.abs(vx);
    const into = Math.abs(cam.rotateY(ux, uy));
    const face = along / (along + into || 1);
    return 0.72 * (1 - face) + (vx > 0 ? 1 : 0.8) * face;
  }

  /** The hour's shade over a face of the stone at a light, as the renderer lays it over a wall of stone brick. */
  private shade(k: number): string {
    const M = stonework();
    const a = M.shadow(k);
    return `rgba(${M.shade[0]},${M.shade[1]},${M.shade[2]},${a.toFixed(3)})`;
  }

  /**
   * The stone brick's own painted face laid over a strip of upright face,
   * from the world point `x0, y0` to `x1, y1` and from `h0` up to `h1`: its
   * courses level with the world's, a tile of run to the width of the
   * picture, as the renderer lays a gable of it. Cut to whatever clip is set.
   */
  private stone(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, h0: number, h1: number, v: number): void {
    const M = stonework();
    const img = M.face[v % M.face.length];
    const head = M.head;
    const fh = img.height - head;
    const step = (WALL_HEIGHT * fh) / img.height;
    const len = Math.min(1, Math.hypot(x1 - x0, y1 - y0));
    const sw = img.width * len;
    const from = ((v >> 3) % 4) * 0.25 * (img.width - sw);
    const lx = this.sx(x0, y0);
    const rx = this.sx(x1, y1);
    for (let h = Math.floor(h0 / step) * step; h < h1; h += step) {
      const ty = this.sy(x0, y0, h + step);
      const ry = this.sy(x1, y1, h + step);
      const by = this.sy(x0, y0, h);
      ctx.save();
      ctx.transform((rx - lx) / sw, (ry - ty) / sw, 0, (by - ty) / fh, lx, ty);
      ctx.drawImage(img, from, head, sw, fh, 0, 0, sw, fh);
      ctx.restore();
    }
  }

  /** The outline of the face on one side, `s` across, from what it stands on up to `h` (its top, or as far as the work has got). */
  private facePath(ctx: CanvasRenderingContext2D, bay: Bay, s: number, h: number, t0 = -0.004, t1 = 1.004): void {
    this.move(ctx, bay, t0, s, h);
    this.line(ctx, bay, t1, s, h);
    for (const t of [t1, 0.75, 0.5, 0.25, t0]) this.line(ctx, bay, t, s, this.floor(bay, Math.min(1, Math.max(0, t)), s) - 0.8);
    ctx.closePath();
  }

  /** The opening of one tier's arch on the face `s` across: up its jambs from its foot, and over. */
  private archPath(ctx: CanvasRenderingContext2D, bay: Bay, s: number, tier: Tier, grow = 0, from = tier.foot): void {
    const n = this.zoom >= DETAIL_FROM ? 16 : 9;
    this.move(ctx, bay, PIER - grow, s, from);
    for (let i = 0; i <= n; i++) {
      const a = Math.PI - (Math.PI * i) / n;
      this.line(ctx, bay, 0.5 + (SPAN + grow) * Math.cos(a), s, tier.spring + (RISE + grow * TILE_UNITS) * Math.sin(a));
    }
    this.line(ctx, bay, 1 - PIER + grow, s, from);
    ctx.closePath();
  }

  /* ---- Through the arches -------------------------------------------------- */

  /**
   * What is seen through an arch of the near face that the far face does not
   * let the eye through: the floor of the passage under it -- the ground, or
   * the top of the tier below -- in the arcade's shade, and the jamb of the
   * pier on the far side of it, the one whose face looks back at the camera,
   * with the foot of the vault over it. Drawn behind anybody standing under it.
   */
  private insides(ctx: CanvasRenderingContext2D, bay: Bay): void {
    const sp = bay.b.spans[bay.k];
    const done = isDone(sp);
    const upTo = done ? bay.top : bay.low + (bay.top - bay.low) * progressOf(sp);
    if (!done && progressOf(sp) <= 0) return;
    const M = stonework();
    const nearS = bay.near * HALF;
    const farS = -nearS;
    // The jamb that faces the camera: the head side's pier where the run comes toward it, the foot side's where it goes away.
    const jt = this.f!.cam.nearSide(bay.ax, bay.ay) > 0 ? PIER : 1 - PIER;
    const reveal: RGB = M.reveal;
    const jambLit = this.light(bay.cx, bay.cy);
    for (let i = 0; i < bay.tiers.length; i++) {
      const tier = bay.tiers[i];
      const lowest = i === bay.tiers.length - 1;
      if (!lowest && tier.foot >= upTo) continue;
      ctx.save();
      ctx.beginPath();
      this.archPath(ctx, bay, nearS, tier);
      ctx.clip();
      ctx.beginPath();
      this.facePath(ctx, bay, nearS, upTo);
      ctx.clip();
      ctx.beginPath();
      ctx.rect(-1e4, -1e4, 3e4, 3e4);
      this.archPath(ctx, bay, farS, tier);
      ctx.clip('evenodd');
      // The floor of the passage: the top of the tier below, where it stands on one; the ground is drawn already.
      if (!lowest) {
        ctx.fillStyle = css(mix(STONE, BAND, 0.35));
        ctx.beginPath();
        this.move(ctx, bay, PIER, nearS, tier.foot);
        this.line(ctx, bay, 1 - PIER, nearS, tier.foot);
        this.line(ctx, bay, 1 - PIER, farS, tier.foot);
        this.line(ctx, bay, PIER, farS, tier.foot);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = PASSAGE_SHADE;
      ctx.fillRect(-1e4, -1e4, 3e4, 3e4);
      /*
       * The jamb, and the foot of the vault over it, from the near face
       * through to the far one, as high as the work has got. Finished, only
       * what shows through the arch; going up, all of it, since nothing
       * stands over it yet and its far end shows over the near face's top.
       */
      if (!done) {
        ctx.restore();
        ctx.save();
      }
      const fn = lowest ? this.floor(bay, jt, nearS) - 0.8 : tier.foot;
      const ff = lowest ? this.floor(bay, jt, farS) - 0.8 : tier.foot;
      const side = jt < 0.5 ? -1 : 1;
      const n = this.zoom >= DETAIL_FROM ? 8 : 4;
      const most = Math.asin(Math.max(0, Math.min(1, (upTo - tier.spring) / RISE)));
      const arc = (s: number, q: number): void => {
        const a = most * (q / n);
        this.line(ctx, bay, 0.5 + side * SPAN * Math.cos(a), s, Math.min(upTo, tier.spring + RISE * Math.sin(a)));
      };
      ctx.beginPath();
      this.move(ctx, bay, jt, nearS, fn);
      for (let q = 0; q <= n; q++) arc(nearS, q);
      for (let q = n; q >= 0; q--) arc(farS, q);
      this.line(ctx, bay, jt, farS, ff);
      ctx.closePath();
      ctx.clip();
      // Laid in the same stone as the face, in the light a face turned that way takes, and darker up into the vault.
      this.stone(ctx, this.wx(bay, jt, nearS), this.wy(bay, jt, nearS), this.wx(bay, jt, farS), this.wy(bay, jt, farS), Math.min(fn, ff) - 2, tier.crown + 1, bay.v + 11);
      this.at(bay, jt, 0, tier.spring + RISE);
      const y0 = PT[1];
      this.at(bay, jt, 0, Math.min(fn, ff));
      const g = ctx.createLinearGradient(0, y0, 0, PT[1]);
      g.addColorStop(0, css(reveal, 0.85));
      g.addColorStop(0.35, css(reveal, 0.45));
      g.addColorStop(1, css(reveal, 0.2));
      ctx.fillStyle = g;
      ctx.fillRect(-1e4, -1e4, 3e4, 3e4);
      ctx.fillStyle = this.shade(jambLit);
      ctx.fillRect(-1e4, -1e4, 3e4, 3e4);
      ctx.restore();
    }
  }

  /* ---- The face, the top and the water --------------------------------------- */

  private front(ctx: CanvasRenderingContext2D, bay: Bay): { left: number; top: number; w: number; h: number } {
    const sp = bay.b.spans[bay.k];
    const done = isDone(sp);
    const progress = progressOf(sp);
    const nearS = bay.near * HALF;
    const faceLit = this.light(bay.ax, bay.ay);
    const detail = this.zoom >= DETAIL_FROM;
    // How far the masonry has got: all of it, or up from the ground as the bill is laid.
    const upTo = done ? bay.top : bay.low + (bay.top - bay.low) * progress;
    const first = bay.k === 0;
    const last = bay.k === bay.n - 1;

    if (!done && progress <= 0) {
      // Set out and nothing laid: its outline pegged out, to the height it will stand.
      ctx.strokeStyle = 'rgba(70,62,52,0.7)';
      ctx.lineWidth = Math.max(1, this.zoom);
      ctx.setLineDash([4 * this.zoom, 3 * this.zoom]);
      ctx.beginPath();
      this.facePath(ctx, bay, nearS, bay.top, 0, 1);
      for (const tier of bay.tiers) this.archPath(ctx, bay, nearS, tier);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      return this.box(bay);
    }

    if (done) this.channel(ctx, bay, faceLit, detail);
    // A north or a west face is the shady one, as a wall's is.
    const moss = done ? this.f!.moss(bay.b, sp.x, sp.y, bay.cx * bay.near + bay.cy * bay.near < 0 ? 1 : 0) : 0;
    const key = `${this.keyOf(bay)}|${first ? '' : this.laidTo(bay.b, bay.k - 1)}|${last ? '' : this.laidTo(bay.b, bay.k + 1)}|${moss}`;
    this.layered(ctx, bay, 'front', key, (g) => this.face(g, bay, upTo, done, faceLit, detail, moss));
    if (last && done) this.spoutStone(ctx, bay);
    return this.box(bay);
  }

  /** The near face of a bay with its arches cut through it, as far up as it has been laid; the work on it; its ends; and the line round it. */
  private face(ctx: CanvasRenderingContext2D, bay: Bay, upTo: number, done: boolean, faceLit: number, detail: boolean, moss = 0): void {
    const f = this.f!;
    const nearS = bay.near * HALF;
    const first = bay.k === 0;
    const last = bay.k === bay.n - 1;
    ctx.save();
    ctx.beginPath();
    this.facePath(ctx, bay, nearS, upTo);
    ctx.clip();
    ctx.beginPath();
    ctx.rect(-1e4, -1e4, 3e4, 3e4);
    for (const tier of bay.tiers) this.archPath(ctx, bay, nearS, tier);
    ctx.clip('evenodd');
    this.stone(ctx, this.wx(bay, -0.004, nearS), this.wy(bay, -0.004, nearS), this.wx(bay, 1.004, nearS), this.wy(bay, 1.004, nearS), bay.low - 4, upTo, bay.v);
    this.footing(ctx, bay, nearS, -0.004, 1.004);
    this.dressings(ctx, bay, nearS, upTo, detail);
    if (moss > 0) this.moss(ctx, bay, nearS, moss);
    ctx.fillStyle = this.shade(faceLit);
    ctx.fillRect(-1e4, -1e4, 3e4, 3e4);
    ctx.restore();

    // Still going up: the bed of the work across the arcade's width, and an arch being turned on its timber centring.
    if (!done) {
      this.workTop(ctx, bay, upTo);
      this.centring(ctx, bay, nearS, upTo);
    }

    // The ends of the arcade, where they face us: across the run, with the channel through them. And
    // while it goes up, the end of a bay over the next one, where that one is lower.
    if (f.cam.nearSide(-bay.ax, -bay.ay) > 0) {
      if (first) this.end(ctx, bay, 0, upTo, done);
      else this.end(ctx, bay, 0, upTo, done, this.laidTo(bay.b, bay.k - 1));
    }
    if (f.cam.nearSide(bay.ax, bay.ay) > 0) {
      if (last) this.end(ctx, bay, 1, upTo, done);
      else this.end(ctx, bay, 1, upTo, done, this.laidTo(bay.b, bay.k + 1));
    }

    // A line round it, as round everything that stands: along its top, and round each arch's opening; none of it under the ground.
    ctx.save();
    ctx.beginPath();
    this.facePath(ctx, bay, nearS, upTo + 2);
    if (done) this.facePath(ctx, bay, -nearS, bay.top + 2);
    ctx.clip();
    ctx.strokeStyle = css(LINE, 0.6);
    ctx.lineWidth = Math.max(0.8, 0.9 * this.zoom);
    ctx.beginPath();
    this.move(ctx, bay, first ? 0 : -0.004, nearS, upTo);
    this.line(ctx, bay, last ? 1 : 1.004, nearS, upTo);
    if (done) {
      this.move(ctx, bay, first ? 0 : -0.004, -nearS, bay.top);
      this.line(ctx, bay, last ? 1 : 1.004, -nearS, bay.top);
    }
    ctx.stroke();
    if (detail) {
      ctx.strokeStyle = css(LINE, 0.45);
      ctx.lineWidth = Math.max(0.6, 0.75 * this.zoom);
      ctx.beginPath();
      for (const tier of bay.tiers) if (tier.spring < upTo) this.archPath(ctx, bay, nearS, tier);
      ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = 1;
  }

  /**
   * The moss on a finished bay's face, at `stage` of `PAVE_STAGES`, as a
   * slab's face carries it (`mossStrip`): cushions climbing from its foot
   * along the ground or the water it stands in, and a row under its cornice
   * with the damp run down from under it. A tile of face is four metres of
   * the strip, and a metre up it ten height units.
   */
  private moss(ctx: CanvasRenderingContext2D, bay: Bay, s: number, stage: number): void {
    const v = (bay.v >> 2) % 3;
    const foot = mossStrip('foot', v, stage);
    const lip = mossStrip('lip', (v + 1) % 3, stage);
    const x0 = this.wx(bay, -0.004, s);
    const y0 = this.wy(bay, -0.004, s);
    const x1 = this.wx(bay, 1.004, s);
    const y1 = this.wy(bay, 1.004, s);
    const lx = this.sx(x0, y0);
    const across = (this.sx(x1, y1) - lx) / (4 * PPM);
    const up = (10 * this.hs) / PPM;
    if (foot) {
      const g0 = this.floor(bay, 0, s);
      const g1 = this.floor(bay, 1, s);
      ctx.save();
      ctx.transform(across, (this.sy(x1, y1, g1) - this.sy(x0, y0, g0)) / (4 * PPM), 0, up, lx, this.sy(x0, y0, g0) - foot.height * up);
      ctx.drawImage(foot, 0, 0);
      ctx.restore();
    }
    if (lip) {
      const h = bay.top - CORNICE;
      ctx.save();
      ctx.transform(across, (this.sy(x1, y1, h) - this.sy(x0, y0, h)) / (4 * PPM), 0, up, lx, this.sy(x0, y0, h));
      ctx.drawImage(lip, 0, 0);
      ctx.restore();
    }
  }

  /** How high the masonry of a bay stands: to its top once it is finished, and nowhere before any of it is laid. */
  private laidTo(b: Bridge, k: number): number {
    const sp = b.spans[k];
    if (!sp || isDone(sp)) return Infinity;
    const p = progressOf(sp);
    if (p <= 0) return -Infinity;
    const nb = this.bay(b, k)!;
    return nb.low + (nb.top - nb.low) * p;
  }

  /**
   * The top of the work on a bay still going up, at the height it has got
   * to: the bed the next course goes on, the arcade's width across, wherever
   * there is masonry at that height -- the two piers below an arch's
   * springing, the haunches either side of its opening above it, the whole
   * bay over its crown -- and nowhere the ground stands over it.
   */
  private workTop(ctx: CanvasRenderingContext2D, bay: Bay, upTo: number): void {
    let open0 = 1;
    let open1 = 0;
    for (const tier of bay.tiers) {
      if (upTo < tier.foot || upTo > tier.spring + RISE) continue;
      const half = upTo <= tier.spring ? SPAN : SPAN * Math.sqrt(Math.max(0, 1 - ((upTo - tier.spring) / RISE) ** 2));
      open0 = 0.5 - half;
      open1 = 0.5 + half;
    }
    // Along the bay, where the ground under both faces is below it.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      if (this.floor(bay, t, -HALF) < upTo && this.floor(bay, t, HALF) < upTo) {
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
    }
    if (hi <= lo) return;
    const parts: Array<[number, number]> = open0 < open1 ? [[-0.004, open0], [open1, 1.004]] : [[-0.004, 1.004]];
    ctx.fillStyle = css(lit(STONE, 1.07));
    ctx.strokeStyle = css(LINE, 0.45);
    ctx.lineWidth = Math.max(0.6, 0.75 * this.zoom);
    for (const [a0, a1] of parts) {
      const a = Math.max(a0, lo - 0.03);
      const b = Math.min(a1, hi + 0.03);
      if (b <= a) continue;
      ctx.beginPath();
      this.move(ctx, bay, a, -HALF, upTo);
      this.line(ctx, bay, b, -HALF, upTo);
      this.line(ctx, bay, b, HALF, upTo);
      this.line(ctx, bay, a, HALF, upTo);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  /**
   * The top of a finished bay: the inside of the far parapet over the water,
   * the bed, the water where it has got to, and the coping along both
   * parapets with the line along their outer edges -- from `from` along the
   * bay, which is before its start where the cut at a pond's head is drawn.
   */
  private channel(ctx: CanvasRenderingContext2D, bay: Bay, faceLit: number, detail: boolean, from = -0.004): void {
    const farWet = -bay.near * WET;
    const flow = this.water(bay);
    const wet = from < 0 && flow.wet > 0 ? 1 : flow.wet;
    ctx.fillStyle = css(lit(flow.wet > 0 ? WALL_WET : mix(STONE, STONE_SHADE, 0.6), 0.86 + 0.14 * faceLit));
    ctx.beginPath();
    this.move(ctx, bay, from, farWet, bay.top);
    this.line(ctx, bay, 1.004, farWet, bay.top);
    this.line(ctx, bay, 1.004, farWet, bay.bed);
    this.line(ctx, bay, from, farWet, bay.bed);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = css(BED_DRY);
    ctx.beginPath();
    this.move(ctx, bay, from, -WET, bay.bed);
    this.line(ctx, bay, 1.004, -WET, bay.bed);
    this.line(ctx, bay, 1.004, WET, bay.bed);
    this.line(ctx, bay, from, WET, bay.bed);
    ctx.closePath();
    ctx.fill();
    if (wet > 0) this.channelWater(ctx, bay, flow.wet, from);
    // The coping, far parapet then near, its stones a hair apart.
    for (const side of [-bay.near, bay.near]) {
      const s0 = side * WET;
      const s1 = side * HALF;
      ctx.fillStyle = css(TOP);
      ctx.beginPath();
      this.move(ctx, bay, from, s0, bay.top);
      this.line(ctx, bay, 1.004, s0, bay.top);
      this.line(ctx, bay, 1.004, s1, bay.top);
      this.line(ctx, bay, from, s1, bay.top);
      ctx.closePath();
      ctx.fill();
      if (detail) {
        ctx.strokeStyle = css(DRESS_SHADE, 0.9);
        ctx.lineWidth = Math.max(0.6, 0.7 * this.zoom);
        ctx.beginPath();
        for (let t = COPING * (hash2(bay.b.id, bay.k, 41) * 0.5 + 0.25) - (from < 0 ? COPING * 4 : 0); t < 1; t += COPING) {
          if (t <= from) continue;
          this.move(ctx, bay, t, s0, bay.top);
          this.line(ctx, bay, t, s1, bay.top);
        }
        // The arris along the water's side, in the coping's shade.
        this.move(ctx, bay, from, s0, bay.top);
        this.line(ctx, bay, 1.004, s0, bay.top);
        ctx.stroke();
      }
      ctx.strokeStyle = css(LINE, 0.6);
      ctx.lineWidth = Math.max(0.8, 0.9 * this.zoom);
      ctx.beginPath();
      this.move(ctx, bay, from, s1, bay.top);
      this.line(ctx, bay, 1.004, s1, bay.top);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  /** The screen box a bay covers, ground to parapet, for picking it out. */
  private box(bay: Bay): { left: number; top: number; w: number; h: number } {
    let l = Infinity;
    let r = -Infinity;
    let t = Infinity;
    let b = -Infinity;
    for (const tt of [0, 1]) {
      for (const s of [-HALF, HALF]) {
        for (const h of [bay.top, this.floor(bay, tt, s)]) {
          this.at(bay, tt, s, h);
          l = Math.min(l, PT[0]);
          r = Math.max(r, PT[0]);
          t = Math.min(t, PT[1]);
          b = Math.max(b, PT[1]);
        }
      }
    }
    return { left: l, top: t, w: r - l, h: b - t };
  }

  /**
   * How far along this bay the water has got, nought to one: from the head
   * at `RUN_RATE` tiles a second from when it started along the channel, as
   * the rules time it.
   */
  private water(bay: Bay): { wet: number } {
    const f = this.f!;
    const since = f.flowing(bay.b.id);
    if (since === null) return { wet: 0 };
    const front = ((f.now - since) / 1000) * RUN_RATE;
    return { wet: Math.max(0, Math.min(1, front - bay.k)) };
  }

  /**
   * The water in the channel over this bay, as far as it has got: dark at its
   * walls and paler down its middle, the streaks of it running down toward
   * the foot, and where the sun is up the glints off it coming and going.
   */
  private channelWater(ctx: CanvasRenderingContext2D, bay: Bay, wet: number, from = -0.004): void {
    const f = this.f!;
    const end = Math.min(1.004, wet + (wet >= 1 ? 0.004 : 0));
    const bands: Array<[number, RGB]> = [
      [1, SPRING_EDGE], [0.84, mix(SPRING_WATER, SPRING_EDGE, 0.12)], [0.56, mix(SPRING_WATER, SPRING_PALE, 0.3)], [0.24, mix(SPRING_WATER, SPRING_PALE, 0.58)],
    ];
    for (const [w, c] of bands) {
      ctx.fillStyle = css(c);
      ctx.beginPath();
      this.move(ctx, bay, from, -WET * w, bay.water);
      this.line(ctx, bay, end, -WET * w, bay.water);
      this.line(ctx, bay, end, WET * w, bay.water);
      this.line(ctx, bay, from, WET * w, bay.water);
      ctx.closePath();
      ctx.fill();
    }
    if (this.zoom < DETAIL_FROM) return;
    // Streaks: short lengths down the water in three lanes, each running at the water's pace and placed by where it is along the whole channel.
    const t = f.t;
    const id = bay.b.id;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.7, 0.95 * this.zoom);
    for (const [lane, ink] of [[-0.55, css(SPRING_FOAM, 0.4)], [0, css(SPRING_FOAM, 0.75)], [0.55, css(SPRING_FOAM, 0.4)]] as const) {
      ctx.strokeStyle = ink;
      ctx.beginPath();
      const shift = hash2(id, Math.round(lane * 10), 61) * STREAK_EVERY;
      const run = t * DRAWN_PACE + shift;
      // Positions along the whole run of the channel, in tiles from its head.
      const g0 = bay.k + Math.min(0, from);
      const g1 = bay.k + wet;
      for (let q = Math.floor((g0 - run) / STREAK_EVERY) - 1; q * STREAK_EVERY + run < g1 + STREAK_LONG; q++) {
        const head = q * STREAK_EVERY + run + (hash2(id, q, 63 + Math.round(lane * 10)) - 0.5) * 0.08;
        const tail = head - STREAK_LONG * (0.6 + 0.6 * hash2(id, q, 67));
        const a = Math.max(g0, tail);
        const b = Math.min(g1, head);
        if (b <= a) continue;
        const wob = (hash2(id, q, 71) - 0.5) * 0.25;
        this.move(ctx, bay, a - bay.k, WET * (lane + wob), bay.water);
        this.line(ctx, bay, b - bay.k, WET * (lane + wob), bay.water);
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    // Glints, where the sun catches the moving water: a bright fleck that comes and goes, carried along with it.
    const sun = f.sunUp * (1 - f.dark);
    if (sun > 0.05) {
      ctx.fillStyle = css(SPRING_FOAM, 0.95);
      ctx.beginPath();
      const run = t * DRAWN_PACE;
      const g0 = bay.k + Math.min(0, from);
      const g1 = bay.k + wet;
      for (let q = Math.floor((g0 - run) / GLINT_EVERY) - 1; q * GLINT_EVERY + run < g1; q++) {
        const h = hash2(id, q, 73);
        const g = q * GLINT_EVERY + run + (h - 0.5) * GLINT_EVERY * 0.6;
        if (g < g0 || g > g1) continue;
        const life = (((t / GLINT_LIFE + h * 7.1) % 1) + 1) % 1;
        const bright = Math.sin(Math.PI * life) ** 6 * sun;
        if (bright < 0.08) continue;
        this.at(bay, g - bay.k, WET * (hash2(id, q, 79) - 0.5) * 1.2, bay.water);
        const r = (0.7 + 1.6 * bright) * Math.min(1.6, this.zoom);
        // A four-pointed sparkle, longer across the screen than down it.
        ctx.moveTo(PT[0] - r * 1.6, PT[1]);
        ctx.lineTo(PT[0] - r * 0.25, PT[1] - r * 0.25);
        ctx.lineTo(PT[0], PT[1] - r * 0.9);
        ctx.lineTo(PT[0] + r * 0.25, PT[1] - r * 0.25);
        ctx.lineTo(PT[0] + r * 1.6, PT[1]);
        ctx.lineTo(PT[0] + r * 0.25, PT[1] + r * 0.25);
        ctx.lineTo(PT[0], PT[1] + r * 0.9);
        ctx.lineTo(PT[0] - r * 0.25, PT[1] + r * 0.25);
        ctx.closePath();
      }
      ctx.fill();
    }
    // Where the water comes to the spout, it quickens and whitens.
    if (bay.k === bay.n - 1 && wet >= 1) {
      ctx.strokeStyle = css(SPRING_FOAM, 0.55);
      ctx.lineWidth = Math.max(0.6, 0.8 * this.zoom);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const age = (((t * 1.7 + i / 4) % 1) + 1) % 1;
        const along = 0.72 + 0.28 * age;
        const across = WET * ((i % 2 ? 0.45 : -0.45) + (hash2(id, i, 83) - 0.5) * 0.3);
        this.move(ctx, bay, along - 0.06, across, bay.water);
        this.line(ctx, bay, Math.min(1, along), across * 0.7, bay.water);
      }
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  /** The footing along the bottom of a face from `t0` to `t1`, `s` across: the blue stone a step darker, and darker again for the damp where it stands in water. */
  private footing(ctx: CanvasRenderingContext2D, bay: Bay, s: number, t0: number, t1: number): void {
    const ts = [t0, 0.25, 0.5, 0.75, t1].filter((t) => t >= t0 && t <= t1);
    ctx.fillStyle = css(FOOT);
    ctx.beginPath();
    this.move(ctx, bay, t0, s, bay.low - 6);
    this.line(ctx, bay, t1, s, bay.low - 6);
    for (let i = ts.length - 1; i >= 0; i--) this.line(ctx, bay, ts[i], s, this.floor(bay, Math.min(1, Math.max(0, ts[i])), s) + FOOTING);
    ctx.closePath();
    ctx.fill();
    // Its top edge, a course line in the stone's own joint.
    ctx.strokeStyle = css(LINE, 0.35);
    ctx.lineWidth = Math.max(0.6, 0.7 * this.zoom);
    ctx.beginPath();
    for (let i = 0; i < ts.length; i++) {
      const h = this.floor(bay, Math.min(1, Math.max(0, ts[i])), s) + FOOTING;
      if (i === 0) this.move(ctx, bay, ts[i], s, h);
      else this.line(ctx, bay, ts[i], s, h);
    }
    ctx.stroke();
    // Standing in water, a band of damp over the waterline.
    const g = this.f!.world;
    const wetAt = (t: number): number => bay.base - g.heightAt(this.wx(bay, t, s), this.wy(bay, t, s));
    if (ts.some((t) => wetAt(t) > 0.5)) {
      ctx.fillStyle = css(DAMP, 0.85);
      ctx.beginPath();
      this.move(ctx, bay, t0, s, bay.base - 1);
      this.line(ctx, bay, t1, s, bay.base - 1);
      this.line(ctx, bay, t1, s, bay.base + FOOTING * 0.55);
      this.line(ctx, bay, t0, s, bay.base + FOOTING * 0.55);
      ctx.closePath();
      ctx.fill();
    }
    ctx.lineWidth = 1;
  }

  /**
   * The limestone the face is dressed in: the string course between tiers,
   * the cornice along the top under the coping, the ring of voussoirs round
   * each arch with its keystone, and the imposts it springs from.
   */
  private dressings(ctx: CanvasRenderingContext2D, bay: Bay, s: number, upTo: number, detail: boolean): void {
    // The string courses run on along the whole arcade, wherever the ground leaves room for them.
    for (let i = 1; i < TIERS; i++) {
      const h1 = bay.top - i * TIER;
      if (h1 - STRING < bay.low) break;
      this.band(ctx, bay, s, h1 - STRING, h1, upTo);
    }
    if (upTo >= bay.top - CORNICE) this.band(ctx, bay, s, bay.top - CORNICE, bay.top, upTo);
    for (const tier of bay.tiers) {
      if (tier.spring > upTo) continue;
      // The ring: between the opening and an arch `RING` wider, as far as it is laid.
      ctx.fillStyle = css(DRESS);
      ctx.beginPath();
      this.archPath(ctx, bay, s, tier, RING / TILE_UNITS, tier.spring);
      this.archPath(ctx, bay, s, tier, 0, tier.spring);
      ctx.fill('evenodd');
      if (detail) {
        // The joints between the voussoirs, and the keystone standing proud of them.
        ctx.strokeStyle = css(RING_JOINT, 0.8);
        ctx.lineWidth = Math.max(0.6, 0.7 * this.zoom);
        ctx.beginPath();
        const n = 11;
        for (let v = 1; v < n; v++) {
          const a = Math.PI - (Math.PI * v) / n;
          this.move(ctx, bay, 0.5 + SPAN * Math.cos(a), s, tier.spring + RISE * Math.sin(a));
          this.line(ctx, bay, 0.5 + (SPAN + RING / TILE_UNITS) * Math.cos(a), s, tier.spring + (RISE + RING) * Math.sin(a));
        }
        ctx.stroke();
        ctx.fillStyle = css(DRESS_HI);
        ctx.beginPath();
        const k0 = Math.PI / 2 - 0.09;
        const k1 = Math.PI / 2 + 0.09;
        this.move(ctx, bay, 0.5 + SPAN * Math.cos(k1), s, tier.spring + RISE * Math.sin(k1));
        this.line(ctx, bay, 0.5 + SPAN * Math.cos(k0), s, tier.spring + RISE * Math.sin(k0));
        this.line(ctx, bay, 0.5 + (SPAN + RING / TILE_UNITS) * Math.cos(k0) + 0.012, s, tier.spring + RISE + RING + 0.6);
        this.line(ctx, bay, 0.5 + (SPAN + RING / TILE_UNITS) * Math.cos(k1) - 0.012, s, tier.spring + RISE + RING + 0.6);
        ctx.closePath();
        ctx.fill();
      }
      // The imposts: a block at the head of each pier the arch springs from.
      ctx.fillStyle = css(DRESS_SHADE);
      ctx.beginPath();
      for (const [a, b] of [[PIER - 0.035, PIER + 0.005], [1 - PIER - 0.005, 1 - PIER + 0.035]]) {
        this.move(ctx, bay, a, s, tier.spring - 1.4);
        this.line(ctx, bay, b, s, tier.spring - 1.4);
        this.line(ctx, bay, b, s, tier.spring);
        this.line(ctx, bay, a, s, tier.spring);
        ctx.closePath();
      }
      ctx.fill();
    }
    ctx.lineWidth = 1;
  }

  /** A band of dressed stone across the face, from `h0` to `h1`, as far up as the work has got, with the shadow it throws under it. */
  private band(ctx: CanvasRenderingContext2D, bay: Bay, s: number, h0: number, h1: number, upTo: number): void {
    const top = Math.min(h1, upTo);
    if (top <= h0) return;
    ctx.fillStyle = css(BAND);
    ctx.beginPath();
    this.move(ctx, bay, -0.004, s, h0);
    this.line(ctx, bay, 1.004, s, h0);
    this.line(ctx, bay, 1.004, s, top);
    this.line(ctx, bay, -0.004, s, top);
    ctx.closePath();
    ctx.fill();
    // Its underside in shade, and the line of its top.
    ctx.fillStyle = css(BAND_SHADE);
    ctx.beginPath();
    this.move(ctx, bay, -0.004, s, h0);
    this.line(ctx, bay, 1.004, s, h0);
    this.line(ctx, bay, 1.004, s, h0 + 0.45);
    this.line(ctx, bay, -0.004, s, h0 + 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = css(LINE, 0.3);
    ctx.lineWidth = Math.max(0.6, 0.7 * this.zoom);
    ctx.beginPath();
    this.move(ctx, bay, -0.004, s, h0 - 0.1);
    this.line(ctx, bay, 1.004, s, h0 - 0.1);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  /** The timber centring an arch is turned over, standing in each opening the work has got up to and not yet over. */
  private centring(ctx: CanvasRenderingContext2D, bay: Bay, s: number, upTo: number): void {
    for (const tier of bay.tiers) {
      if (upTo < tier.spring - 4 || upTo > tier.crown + RING + 2) continue;
      ctx.strokeStyle = css(TIMBER);
      ctx.lineWidth = Math.max(1, 1.6 * this.zoom);
      ctx.beginPath();
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const a = Math.PI - (Math.PI * i) / n;
        const t = 0.5 + (SPAN - 0.01) * Math.cos(a);
        const h = tier.spring + (RISE - 0.4) * Math.sin(a);
        if (i === 0) this.move(ctx, bay, t, s, h);
        else this.line(ctx, bay, t, s, h);
      }
      ctx.stroke();
      // Its struts, down to the foot of the opening.
      ctx.strokeStyle = css(TIMBER_DARK);
      ctx.lineWidth = Math.max(0.8, 1.1 * this.zoom);
      ctx.beginPath();
      for (const t of [0.5 - SPAN * 0.55, 0.5, 0.5 + SPAN * 0.55]) {
        const a = Math.acos((t - 0.5) / SPAN);
        this.move(ctx, bay, t, s, tier.spring + (RISE - 0.4) * Math.sin(a));
        this.line(ctx, bay, t, s, Math.max(tier.foot, this.floor(bay, t, s)));
      }
      this.move(ctx, bay, 0.5 - SPAN * 0.55, s, tier.spring + RISE * 0.2);
      this.line(ctx, bay, 0.5 + SPAN * 0.55, s, tier.spring + RISE * 0.2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  /**
   * An end of a bay, square to its run at `t`, with the channel through the
   * top of it when it is finished: the end of the arcade, or where the bay
   * beside it stands lower, still going up, from the top of that bay (`from`).
   */
  private end(ctx: CanvasRenderingContext2D, bay: Bay, t: number, upTo: number, done: boolean, from = -Infinity): void {
    const k = this.light(bay.cx, bay.cy);
    const g0 = Math.max(this.floor(bay, t, -HALF) - 0.8, from);
    const g1 = Math.max(this.floor(bay, t, HALF) - 0.8, from);
    if (g0 >= upTo && g1 >= upTo) return;
    const outline = (): void => {
      ctx.beginPath();
      this.move(ctx, bay, t, -HALF, g0);
      this.line(ctx, bay, t, HALF, g1);
      this.line(ctx, bay, t, HALF, upTo);
      if (done) {
        // Through the top of it, the channel: notched down to its bed.
        this.line(ctx, bay, t, WET, upTo);
        this.line(ctx, bay, t, WET, bay.bed);
        this.line(ctx, bay, t, -WET, bay.bed);
        this.line(ctx, bay, t, -WET, upTo);
      }
      this.line(ctx, bay, t, -HALF, upTo);
      ctx.closePath();
    };
    ctx.save();
    outline();
    ctx.clip();
    this.stone(ctx, this.wx(bay, t, -HALF), this.wy(bay, t, -HALF), this.wx(bay, t, HALF), this.wy(bay, t, HALF), Math.min(g0, g1) - 2, upTo, bay.v + 5);
    // The footing round the end, and the cornice round it when it is up.
    ctx.fillStyle = css(FOOT);
    ctx.beginPath();
    this.move(ctx, bay, t, -HALF, g0 - 4);
    this.line(ctx, bay, t, HALF, g1 - 4);
    this.line(ctx, bay, t, HALF, g1 + 0.8 + FOOTING);
    this.line(ctx, bay, t, -HALF, g0 + 0.8 + FOOTING);
    ctx.closePath();
    ctx.fill();
    for (let i = 1; i < TIERS; i++) {
      const h1 = bay.top - i * TIER;
      if (h1 - STRING < Math.max(g0, g1)) break;
      if (h1 - STRING > upTo) continue;
      ctx.fillStyle = css(BAND);
      ctx.beginPath();
      this.move(ctx, bay, t, -HALF, h1 - STRING);
      this.line(ctx, bay, t, HALF, h1 - STRING);
      this.line(ctx, bay, t, HALF, Math.min(h1, upTo));
      this.line(ctx, bay, t, -HALF, Math.min(h1, upTo));
      ctx.closePath();
      ctx.fill();
    }
    if (done) {
      ctx.fillStyle = css(BAND);
      ctx.beginPath();
      this.move(ctx, bay, t, -HALF, bay.top - CORNICE);
      this.line(ctx, bay, t, HALF, bay.top - CORNICE);
      this.line(ctx, bay, t, HALF, bay.top);
      this.line(ctx, bay, t, -HALF, bay.top);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = this.shade(k);
    ctx.fillRect(-1e4, -1e4, 3e4, 3e4);
    ctx.restore();
    ctx.strokeStyle = css(LINE, 0.6);
    ctx.lineWidth = Math.max(0.8, 0.9 * this.zoom);
    ctx.beginPath();
    this.move(ctx, bay, t, -HALF, g0);
    this.line(ctx, bay, t, -HALF, upTo);
    this.move(ctx, bay, t, HALF, g1);
    this.line(ctx, bay, t, HALF, upTo);
    if (done) {
      this.move(ctx, bay, t, -HALF, upTo);
      this.line(ctx, bay, t, -WET, upTo);
      this.move(ctx, bay, t, WET, upTo);
      this.line(ctx, bay, t, HALF, upTo);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  /** The spout: the channel carried out past the last pier in a lipped trough of dressed stone, for the water to go over. */
  private spoutStone(ctx: CanvasRenderingContext2D, bay: Bay): void {
    const t1 = 1 + SPOUT;
    const side = WET + 0.03;
    const under = bay.bed - 2.2;
    const k = this.light(bay.ax, bay.ay);
    // Its underside and its near side, then its floor and the water running out along it.
    ctx.fillStyle = css(lit(DRESS_SHADE, 0.6 + 0.4 * k));
    ctx.beginPath();
    this.move(ctx, bay, 1, bay.near * side, under);
    this.line(ctx, bay, t1, bay.near * side, under);
    this.line(ctx, bay, t1, bay.near * side, bay.water + 0.6);
    this.line(ctx, bay, 1, bay.near * side, bay.water + 0.6);
    ctx.closePath();
    ctx.fill();
    const front = this.f!.cam.nearSide(bay.ax, bay.ay) > 0;
    ctx.fillStyle = css(lit(DRESS, 0.6 + 0.4 * this.light(bay.cx, bay.cy)));
    ctx.beginPath();
    if (front) {
      // Its end, facing us.
      this.move(ctx, bay, t1, -side, under);
      this.line(ctx, bay, t1, side, under);
      this.line(ctx, bay, t1, side, bay.bed);
      this.line(ctx, bay, t1, -side, bay.bed);
      ctx.closePath();
    }
    ctx.fill();
    // The tops of its two walls.
    ctx.fillStyle = css(TOP);
    ctx.beginPath();
    for (const sd of [-1, 1]) {
      this.move(ctx, bay, 1, sd * side, bay.water + 0.6);
      this.line(ctx, bay, t1, sd * side, bay.water + 0.6);
      this.line(ctx, bay, t1, sd * WET, bay.water + 0.6);
      this.line(ctx, bay, 1, sd * WET, bay.water + 0.6);
      ctx.closePath();
    }
    ctx.fill();
    const flow = this.water(bay);
    ctx.fillStyle = css(flow.wet >= 1 ? mix(SPRING_WATER, SPRING_PALE, 0.35) : BED_DRY);
    ctx.beginPath();
    this.move(ctx, bay, 1 - 0.004, -WET, flow.wet >= 1 ? bay.water : bay.bed);
    this.line(ctx, bay, t1, -WET, flow.wet >= 1 ? bay.water : bay.bed);
    this.line(ctx, bay, t1, WET, flow.wet >= 1 ? bay.water : bay.bed);
    this.line(ctx, bay, 1 - 0.004, WET, flow.wet >= 1 ? bay.water : bay.bed);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = css(LINE, 0.55);
    ctx.lineWidth = Math.max(0.7, 0.8 * this.zoom);
    ctx.beginPath();
    this.move(ctx, bay, 1, bay.near * side, under);
    this.line(ctx, bay, t1, bay.near * side, under);
    this.line(ctx, bay, t1, bay.near * side, bay.water + 0.6);
    if (front) {
      this.line(ctx, bay, t1, -bay.near * side, bay.water + 0.6);
      this.move(ctx, bay, t1, -bay.near * side, under);
      this.line(ctx, bay, t1, bay.near * side, under);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  /**
   * The cut a finished aqueduct's water comes in by from a pond at its head:
   * the channel carried on back from the arcade's end, coped as it is, to
   * where the pond's water stands, so the pond runs into it; drawn with the
   * pond's tile, and the first bay's top again over it, so where the ground
   * at the lip stands in front of that bay the channel still runs on unbroken
   * into the cut. A pool at its head has its rim cut instead (`cutsAt`).
   */
  private intake(ctx: CanvasRenderingContext2D, b: Bridge): void {
    const f = this.f!;
    if (!b.spans.length || !b.spans.every(isDone) || f.slab(b.ax, b.ay) !== null) return;
    const bay = this.bay(b, 0);
    if (!bay) return;
    // Back along the run from the arcade to the pond's water.
    const wetAt = (t: number): boolean => f.world.heightAt(this.wx(bay, t, 0), this.wy(bay, t, 0)) < bay.water;
    let back = 0;
    while (back < 1 && !wetAt(-back)) back += 0.05;
    if (back <= 0) return;
    this.channel(ctx, bay, this.light(bay.ax, bay.ay), this.zoom >= DETAIL_FROM, -back - 0.03);
  }

  /* ---- The spout's water ----------------------------------------------------- */

  /**
   * The water going over the end of the spout into the basin at the foot, as
   * the falls painter draws every fall: a sheet as wide as the channel, its
   * foot foaming on the water it lands in or on the ground, and its lip.
   * Drawn with the tile it lands on, after that tile's ground and water.
   */
  private spout(ctx: CanvasRenderingContext2D, b: Bridge): void {
    const f = this.f!;
    if (!b.spans.length || !b.spans.every(isDone)) return;
    const since = f.flowing(b.id);
    if (since === null) return;
    const n = b.spans.length;
    // When the water gets to the end of the spout, and how far down it has fallen since.
    const arrive = since + ((n + SPOUT) / RUN_RATE) * 1000;
    const gone = (f.now - arrive) / 1000;
    if (gone <= 0) return;
    const bay = this.bay(b, n - 1);
    if (!bay) return;
    const lipT = 1 + SPOUT;
    const lx = this.wx(bay, lipT, 0);
    const ly = this.wy(bay, lipT, 0);
    // Where it lands: in the near half of a fountain's lowest basin, on a foundation's top, on the water standing in the tile it pours into, or on the ground.
    const fountain = f.fountain(b.bx, b.by);
    const bare = f.bare(b.bx, b.by);
    let reach: number;
    let land: number;
    let wet: boolean;
    if (bare !== null) {
      reach = Math.max(0.12, Math.min(0.42, 0.1 + 0.0035 * Math.max(0, bay.water - bare)));
      land = bare;
      wet = false;
    } else if (fountain) {
      const out = (fountain.x - lx) * bay.ax + (fountain.y - ly) * bay.ay;
      reach = Math.max(0.08, out - (FOUNT.low.inner / TILE_UNITS) * 0.45);
      land = fountain.base + FOUNT.low.water;
      wet = true;
    } else {
      const drop0 = bay.water - (f.surface(b.bx, b.by) ?? f.world.heightAt(lx, ly));
      reach = Math.max(0.12, Math.min(0.42, 0.1 + 0.0035 * Math.max(0, drop0)));
      // Over shallows, on out to where the water it lands in is two units deep, wherever that is in the tile it pours into.
      const depth = (r: number): number => (f.surface(Math.floor(lx + bay.ax * r), Math.floor(ly + bay.ay * r)) ?? -Infinity)
        - f.world.heightAt(lx + bay.ax * r, ly + bay.ay * r);
      for (let r = reach; depth(reach) < 2 && r <= 1 - SPOUT; r += 0.04) if (depth(r) >= 2) reach = r;
      const ground = f.world.heightAt(lx + bay.ax * reach, ly + bay.ay * reach);
      const surface = f.surface(Math.floor(lx + bay.ax * reach), Math.floor(ly + bay.ay * reach));
      wet = surface !== null && surface > ground;
      land = wet ? surface! : ground;
    }
    const alongX = bay.ax === 0;
    const sheet: Sheet = {
      axis: alongX ? 0 : 1,
      line: alongX ? ly : lx,
      from: alongX ? lx : ly,
      to: alongX ? lx : ly,
      half: WET,
      way: (alongX ? bay.ay : bay.ax) > 0 ? 1 : -1,
      reach,
      curl: 0.8,
      top: bay.water,
      landFrom: alongX ? lx : ly,
      land: Float64Array.of(land),
      wet,
      grow: Math.min(1, gone / 0.7),
      feed: WET,
      back: 0.1,
    };
    const placed = place(f.fv, sheet);
    const u0 = sheet.from - sheet.half;
    const u1 = sheet.to + sheet.half;
    drawSheet(ctx, f.fv, placed, u0, u1);
    drawFoot(ctx, f.fv, placed, u0, u1, f.foam);
    drawLip(ctx, f.fv, placed, u0, u1);
    if (sheet.grow >= 1) f.mist(placed);
    if (bare !== null) this.film(ctx, b, lx + bay.ax * reach, ly + bay.ay * reach, bare, gone);
  }

  /**
   * Water poured onto a foundation with no pool in it, across its top from
   * where the spout's water lands to where it goes over the slab's edge
   * (`slabEdge`): a channel's width of it, lying on the slab.
   */
  private film(ctx: CanvasRenderingContext2D, b: Bridge, lx: number, ly: number, top: number, gone: number): void {
    const e = this.slabEdge(b);
    if (!e) return;
    const k = Math.min(1, Math.max(0, (gone - 0.6) / 0.4));
    if (k <= 0) return;
    const ex = lx + (e.x - lx) * k;
    const ey = ly + (e.y - ly) * k;
    const len = Math.hypot(ex - lx, ey - ly);
    if (len < 0.01) return;
    const ux = (ex - lx) / len;
    const uy = (ey - ly) / len;
    const h = top + 0.25;
    for (const [w, c, a] of [[WET, SPRING_EDGE, 0.85], [WET * 0.55, mix(SPRING_WATER, SPRING_PALE, 0.45), 0.9]] as const) {
      ctx.fillStyle = css(c, a);
      ctx.beginPath();
      ctx.moveTo(this.sx(lx - uy * w, ly + ux * w), this.sy(lx - uy * w, ly + ux * w, h));
      ctx.lineTo(this.sx(ex - uy * w, ey + ux * w), this.sy(ex - uy * w, ey + ux * w, h));
      ctx.lineTo(this.sx(ex + uy * w, ey - ux * w), this.sy(ex + uy * w, ey - ux * w, h));
      ctx.lineTo(this.sx(lx + uy * w, ly - ux * w), this.sy(lx + uy * w, ly - ux * w, h));
      ctx.closePath();
      ctx.fill();
    }
  }

  /**
   * The same water going over the foundation's edge, where that edge faces
   * the camera: a sheet a channel wide down the slab's side to the ground or
   * the water at its foot, drawn with the tile it falls into.
   */
  private overEdge(ctx: CanvasRenderingContext2D, b: Bridge): void {
    const f = this.f!;
    const since = f.flowing(b.id);
    const top = f.bare(b.bx, b.by);
    const e = this.slabEdge(b);
    if (since === null || top === null || !e || !b.spans.length) return;
    // After the spout's water has landed and run across the slab to the edge.
    const gone = (f.now - since - ((b.spans.length + SPOUT) / RUN_RATE) * 1000) / 1000 - 1;
    if (gone <= 0) return;
    const alongX = e.ny !== 0;
    const reach = 0.14;
    const fx = e.x + e.nx * reach;
    const fy = e.y + e.ny * reach;
    const ground = f.world.heightAt(fx, fy);
    const surface = f.surface(Math.floor(fx), Math.floor(fy));
    const wet = surface !== null && surface > ground;
    const sheet: Sheet = {
      axis: alongX ? 0 : 1,
      line: alongX ? Math.round(e.y) : Math.round(e.x),
      from: alongX ? e.x : e.y,
      to: alongX ? e.x : e.y,
      half: WET,
      way: ((alongX ? e.ny : e.nx) > 0 ? 1 : -1) as 1 | -1,
      reach,
      curl: 0.5,
      top: top + 0.25,
      landFrom: alongX ? e.x : e.y,
      land: Float64Array.of(wet ? surface! : ground),
      wet,
      grow: Math.min(1, gone / 0.5),
      feed: WET,
      back: 0.1,
    };
    if (sheet.top - sheet.land[0] < 1) return;
    const placed = place(f.fv, sheet);
    const u0 = sheet.from - sheet.half;
    const u1 = sheet.to + sheet.half;
    drawSheet(ctx, f.fv, placed, u0, u1);
    drawFoot(ctx, f.fv, placed, u0, u1, f.foam);
    drawLip(ctx, f.fv, placed, u0, u1);
    if (sheet.grow >= 1) f.mist(placed);
  }
}

/** Where water poured onto a foundation goes over its edge: the point on the edge, and the way out over it. */
interface SlabEdge {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** Scratch: a screen point. */
const PT = new Float64Array(2);
const NO_SPANS: ReadonlyArray<{ b: Bridge; k: number }> = [];

/** A bay's outline on the screen, as x, y pairs: its face, the arches through it, its top, and an end facing the camera. */
export interface AqueductShape {
  face: Float64Array;
  holes: Float64Array[];
  top: Float64Array;
  end: Float64Array | null;
}

/** How far past its edges a bay's outline is cut out of a roof laid after it, in screen pixels. */
const SEAM = 0.75;

/** An outline moved out from its middle by `by` pixels at every corner. */
function grown(p: Float64Array, by: number): Float64Array {
  const n = p.length / 2;
  let cx = 0, cy = 0;
  for (let i = 0; i < p.length; i += 2) {
    cx += p[i] / n;
    cy += p[i + 1] / n;
  }
  const out = new Float64Array(p.length);
  for (let i = 0; i < p.length; i += 2) {
    const l = Math.hypot(p[i] - cx, p[i + 1] - cy) || 1;
    out[i] = p[i] + ((p[i] - cx) / l) * by;
    out[i + 1] = p[i + 1] + ((p[i + 1] - cy) / l) * by;
  }
  return out;
}

/** The convex hull of some points, x, y pairs, as an outline of x, y pairs. */
export function hullOf(pts: ArrayLike<number>): Float64Array {
  const ps: Array<[number, number]> = [];
  for (let i = 0; i < pts.length; i += 2) ps.push([pts[i], pts[i + 1]]);
  ps.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Array<[number, number]>): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    return out;
  };
  const lower = half(ps);
  const upper = half([...ps].reverse());
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  const flat = new Float64Array(hull.length * 2);
  hull.forEach((q, i) => {
    flat[i * 2] = q[0];
    flat[i * 2 + 1] = q[1];
  });
  return flat;
}

/** A closed outline added to the path. */
function polyPath(ctx: CanvasRenderingContext2D, p: Float64Array): void {
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.closePath();
}

/** Whether a point is inside a closed outline, by the crossings of a ray from it. */
function inPoly(p: Float64Array, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i];
    const yi = p[i + 1];
    const xj = p[j];
    const yj = p[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** The most device pixels a picture of one piece of a bay is kept at; past it, close in, the piece is drawn straight onto the screen. */
const PICTURE_MOST = 1_500_000;
/**
 * How long the zoom stands still after a pinch or a wheel's turn before the
 * pictures are drawn again at it, in milliseconds; how many are drawn again a
 * frame from then; and how far the zoom may move in one frame from a still
 * view and be the start of a pinch rather than a step to another zoom, which
 * draws them all again at once, as a share of it.
 */
const ZOOM_SETTLE = 180;
const REDRAWS = 4;
const ZOOM_STEP = 0.15;
