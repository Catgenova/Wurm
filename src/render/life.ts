/**
 * Small life: butterflies over what is in flower by day, dragonflies over
 * still and running water from morning to dusk, fireflies over the grass by
 * trees and water at night -- and what comes down out of the trees
 * (`./foliage`): petals off the fruit trees in flower all spring and leaves
 * off the broadleaves at the end of autumn, on the wind round them, lying
 * where they land and floating on any water under them.
 *
 * Only drawn, and nothing of it is kept. Where each thing lives is read off
 * the tile it lives on, and where it is now is worked out from that and the
 * island's clock, so two people standing at the same pond see the same
 * dragonfly in the same place, and a pond that has had one over it for a
 * week costs what a pond dug a second ago costs. How many are out is the hour
 * (`hourOfDay`, `darkness`) and the season (`seasonAt`): the insects are out
 * from spring to autumn, fullest in summer, and none in winter.
 *
 * It costs what is on the screen. The homes are found by walking the tiles
 * the ground is about to be drawn on, and a home is only looked at at all
 * when its tile is one that could be one; every kind is capped, so a field
 * of lavender at the widest zoom is still a handful of butterflies; and
 * below `LIFE_FROM` none of it is drawn or worked out. What is aloft is
 * handed to the renderer to be sorted in among everything else standing on
 * its line of the ground, so a butterfly behind a tree is behind the tree;
 * what lies on the ground is laid with the line it lies on; and the
 * fireflies are laid last, over the night, because they are lights.
 */
import type { Camera } from '../engine/camera';
import { DAWN, DUSK } from '../game/game';
import type { Season } from '../world/calendar';
import { FLOWER_MOST, flowersOn } from '../world/flowers';
import { hash2 } from '../world/noise';
import { BUSH_DEFS, TileType, TREE_AGES, TREE_DEFS, bushSpecies, treeSpecies, treeVariant, type TreeDef } from '../world/tiles';
import type { World } from '../world/world';
import { AUTUMN, bloomOf, blooms, bushYear, SHED_MOST, shedOn, shedding } from './foliage';
import { FLOWER_TOP } from './flowers';
import { HALF_H, HALF_W, HEIGHT_SCALE } from './iso';
import { grownAt, WORLD_SCALE } from './sprites';
import { depthOf, type View } from './view';

/** Below this zoom none of it is drawn: the island is shapes and colours only. */
export const LIFE_FROM = 0.6;

/**
 * How many of each are out at once at most over a screen's worth of ground
 * at zoom 1, whatever is in view: enough to feel alive, never a swarm. Closer
 * in there is less ground on the screen and the caps come down with it (to a
 * third at most), so a garden seen close is as full as it is from further
 * off and no fuller. Past the cap, the ones kept are the ones whose own roll
 * is lowest, so the same ones stay as the view moves.
 */
export const MOST = { butterfly: 14, dragonfly: 9, firefly: 60, tree: 40 } as const;
/** The ground a screen shows at zoom 1, in tiles, that `MOST` is counted over: a 1600 by 1000 view. */
const MOST_OVER = (1600 * 1000) / (HALF_W * HALF_H * 2);

/**
 * The share of the homes each kind has one in, before the hour and the
 * season: a flowering bush, a planter, a tree in flower; a tile of pond or
 * pool, a corner a stream runs over, a fish pond; a tile of grass near a tree
 * or near water (weighted: see `nearWeight`).
 */
const SHARE = {
  bush: 0.2, planter: 0.65, blossom: 0.22, wildflowers: 0.04,
  pond: 0.07, stream: 0.1, fishPond: 0.75,
  grass: 0.3,
} as const;

/**
 * How many of each kind are out in each season, as a share of the most:
 * spring, summer, autumn, winter. Fullest in summer; none in winter.
 */
export const SEASONAL: Readonly<Record<'butterfly' | 'dragonfly' | 'firefly', readonly [number, number, number, number]>> = {
  butterfly: [1, 1, 0.45, 0],
  dragonfly: [0.6, 1, 0.5, 0],
  firefly: [0.8, 1, 0.35, 0],
};
const SEASON_INDEX: Record<Season, number> = { spring: 0, summer: 1, autumn: 2, winter: 3 };

/**
 * `SEASONAL` in words, for the help and the news: "all of them in summer; in
 * spring 60% of the dragonflies and 80% of the fireflies; ...; none in
 * winter". Worked out from the table, so the words cannot drift from it.
 */
export function lifeSeasons(): string {
  const kinds = Object.entries(SEASONAL) as Array<[string, readonly number[]]>;
  const many = (k: string): string => k.replace(/y$/, 'ies');
  const pc = (v: number): string => `${Math.round(v * 100)}%`;
  const parts = (['spring', 'summer', 'autumn', 'winter'] as const).map((season, i) => {
    if (kinds.every(([, v]) => v[i] >= 1)) return `all of them in ${season}`;
    if (kinds.every(([, v]) => v[i] <= 0)) return `none in ${season}`;
    const some = kinds.filter(([, v]) => v[i] < 1).map(([k, v]) => (v[i] > 0 ? `${pc(v[i])} of the ${many(k)}` : `no ${many(k)}`));
    return `in ${season} ${some.length > 1 ? `${some.slice(0, -1).join(', ')} and ${some[some.length - 1]}` : some[0]}`;
  });
  return parts.join('; ');
}

/**
 * The hours each is out, in the game's hours. Butterflies want the sun well
 * up: out over the hour and a half after `DAWN` + 1.5 and gone over the hour
 * and a half before `DUSK` - 1.5. Dragonflies are out from morning to dusk.
 * Fireflies come out with the dark itself (`darkness`), from a tenth of it.
 */
export const BUTTERFLY_HOURS = [DAWN + 1.5, DAWN + 3, DUSK - 3, DUSK - 1.5] as const;
export const DRAGONFLY_HOURS = [DAWN + 1, DAWN + 2.5, DUSK - 1, DUSK] as const;
export const FIREFLY_DARK = [0.1, 0.6] as const;

/** Seconds a petal or a leaf takes from leaving the crown to gone, on the ground or the water. */
export const PETAL_LIFE = 9;
/** How fast a petal falls, in height units a second: about a third of a metre; a leaf a little faster. */
const PETAL_FALL = 3.2;
const LEAF_FALL = 4.2;
/** How far one is carried while it falls, in tiles a second, in no wind and in a gale. */
const PETAL_CALM = 0.03;
const PETAL_BLOWN = 0.26;
/** How many petals a tree in flower has in the air, in a flat calm and in a gale. */
const PETALS_CALM = 1.5;
const PETALS_GALE = 5;
/** And leaves, for a crown coming down at the rate of the last day of autumn (`shedding`), in a calm and in a gale. */
const LEAVES_CALM = 1.2;
const LEAVES_GALE = 3.6;
/**
 * How many lie floating on any water near a tree in flower or dropping its
 * leaves, out to this far past the crown's reach, in tiles. A tree never
 * stands on a bank tile the water comes onto, so the nearest water is half a
 * tile to a tile from its trunk. What lies on dry ground under it is in its
 * own picture (`./foliage`, `litter`); water is not in a tree's picture, so
 * this is laid on it here.
 */
const FLOATING = 10;
const FLOAT_REACH = 0.9;

/*
 * Where a crown is, for what flies round it and what falls out of it: how
 * high its middle stands over the foot and how far it reaches out, in the
 * sprite's own units for a tree of size one (`./sprites`, `treeSprite`, read
 * off each shape's numbers). A sprite unit is `WORLD_SCALE` pixels at zoom 1,
 * a height unit is `HEIGHT_SCALE` of them, and a circle of r tiles on the
 * ground is r * HALF_W * root two pixels across.
 */
const RISE: Record<TreeDef['shape'], number> = { parasol: 57, bulb: 40, shelf: 42, column: 32, plate: 57, fan: 40, spire: 50, weeping: 42 };
const REACH: Record<TreeDef['shape'], number> = { parasol: 18, bulb: 17, shelf: 18, column: 12, plate: 22, fan: 15, spire: 15, weeping: 22 };
function crownOf(species: number, variant: number, grew: number): { rise: number; reach: number } {
  const def = TREE_DEFS[species];
  const size = def.size * (TREE_AGES[variant] ?? TREE_AGES[0]).size * grew;
  return {
    rise: (RISE[def.shape] * size * WORLD_SCALE) / HEIGHT_SCALE,
    reach: (REACH[def.shape] * size * WORLD_SCALE) / (HALF_W * Math.SQRT2),
  };
}

/** How high a bush is at its top, in height units, for one grown to one: its lobes' top, in the sprite. */
const BUSH_TOP = (20 * WORLD_SCALE) / HEIGHT_SCALE;
/** How high the flowers in a planter stand over the ground, in height units. */
const PLANTER_TOP = 6;

/*
 * The butterflies there are, chalked into the palette: a white, a sulphur, an
 * orange, a blue and a rose. Wing, the darker edge of it, and the body.
 */
const BUTTERFLIES: ReadonlyArray<readonly [wing: string, edge: string, body: string]> = [
  ['#f6f2e6', '#8f8e8a', '#4a4540'],
  ['#f0dc84', '#b89a3c', '#5a4a2c'],
  ['#eba35e', '#8a4a2a', '#3e2c24'],
  ['#9fbfe6', '#4d6f9e', '#34384a'],
  ['#e7a9bd', '#9a5a72', '#443038'],
];
/** And the dragonflies: body, and the darker tail end of it. Wings are glass for all of them. */
const DRAGONFLIES: ReadonlyArray<readonly [body: string, tail: string]> = [
  ['#4f93c8', '#2d5d86'],
  ['#62a870', '#3a6d46'],
  ['#c9604e', '#8a3a30'],
];

const TAU = Math.PI * 2;

/** An ellipse as a subpath of its own: started where it starts, so a fill of many of them has no slivers joining them. */
function oval(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number): void {
  ctx.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx);
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
}
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (v: number): number => v * v * (3 - 2 * v);
/** Up from `a` to `b`, level, down from `c` to `d`. */
const window4 = (h: number, w: readonly [number, number, number, number]): number =>
  Math.min(clamp01((h - w[0]) / (w[1] - w[0])), clamp01((w[3] - h) / (w[3] - w[2])));

/** What flies over what: flowers, water or grass; a tree in flower, which is flowers and petals both; a tree dropping its leaves. */
const enum Home { Nectar, Water, Grass, Bloom, Leaves }

interface HomeAt {
  kind: Home;
  /** Where it is, in tiles, and the ground or water under it, in height units. */
  x: number;
  y: number;
  ground: number;
  /** How high what it flies over stands above that, in height units, and how far round it it ranges, in tiles. */
  top: number;
  reach: number;
  /** Its own roll: which ones are kept past a cap, and everything each one does. */
  roll: number;
  /** For a tree in flower or dropping its leaves: its species and its stage, and how much of its crown is coming down. */
  species: number;
  variant: number;
  shed: number;
}

/** Something aloft: sorted in among what stands on its line of the ground, by the ground under it. */
export interface Mote {
  kind: 'butterfly' | 'dragonfly' | 'petal';
  /** The tile under it and where on the screen that ground is: what it is sorted by. */
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  /** Where its body is on the screen. */
  bx: number;
  by: number;
  /** How much of it is here, 0 to 1: arriving, leaving, or a petal thinning away. */
  a: number;
  /** Which of its kind's colours, for a butterfly or a dragonfly. */
  c: number;
  /**
   * A butterfly: how far open its wings are, 1 flat to 0 shut up over its
   * back. A petal or a leaf: how much of its face shows as it turns over.
   */
  open: number;
  /** A butterfly: which way it banks, -1 to 1. */
  lean: number;
  /**
   * A dragonfly: its heading and the line across it, on the screen, in steps
   * of `HALF_W`. A petal or a leaf: `hx` is how far round it has turned and
   * `px` how big it is, in pixels.
   */
  hx: number;
  hy: number;
  px: number;
  py: number;
  /** A petal's or a leaf's face and back. */
  ink: string;
  ink2: string;
}

interface Flake {
  sx: number;
  sy: number;
  /** Half its length and width in pixels, and its turn. */
  rx: number;
  ry: number;
  rot: number;
  ink: string;
}

interface Glow {
  x: number;
  y: number;
  g: number;
}

/** Everything a frame of it is worked out from, handed over by the renderer before the ground. */
export interface LifeFrame {
  world: World;
  cam: Camera;
  view: View;
  /** The lattice the ground is about to be walked in (`Renderer.render`). */
  dLo: number;
  dHi: number;
  eMin: number;
  eMax: number;
  width: number;
  height: number;
  /** The island's clock in seconds: what everything moves by, the same on every machine. */
  clock: number;
  hour: number;
  dark: number;
  /** The season and its day, 1 to 7 (`seasonAt`). */
  season: Season;
  day: number;
  /** The wind in the world: which way it blows, as a unit step, and how hard. */
  windX: number;
  windY: number;
  force: number;
  /** Whether a tile can be seen right now; nothing lives on remembered ground. */
  visible: (x: number, y: number) => boolean;
  /** Whether a tile is under a floor or a slab, where nothing lies on the bare ground. */
  covered: (x: number, y: number) => boolean;
  /** Whether a tile is inside a building, where nothing flies: a planter indoors is under a roof. */
  indoors: (x: number, y: number) => boolean;
  /** The pieces standing that anything lives over: planters and fish ponds, by where they stand. */
  pieces: () => Iterable<{ kind: string; x: number; y: number; id: number; at: readonly [number, number] }>;
}

export class SmallLife {
  private homes: HomeAt[] = [];
  private homeN = 0;
  private motes: Mote[] = [];
  private moteN = 0;
  private flakes: Flake[] = [];
  private flakeN = 0;
  private glows: Glow[] = [];
  private glowN = 0;
  /** What is aloft and what lies on the ground, by line of the ground, as indices; `lo` is the first line. */
  private aloftRows: Mote[][] = [];
  private groundRows: number[][] = [];
  private lo = 0;
  private live = false;
  private zoom = 1;
  /** Whether a tile of grass is near a tree, near water, or both, kept until the ground changes: see `nearWeight`. */
  private near = new Map<number, number>();
  private streamTiles = new Set<number>();
  private streamsOf: unknown = null;
  private glowPad: HTMLCanvasElement | null = null;
  private glowPadZoom = -1;

  /** The ground has changed somewhere: forget what was worked out about what is near what. */
  touched(): void {
    this.near.clear();
  }

  /** The glow of one firefly, drawn once a zoom and blitted. */
  private glowSprite(zoom: number): HTMLCanvasElement {
    if (this.glowPad && this.glowPadZoom === zoom) return this.glowPad;
    const r = Math.max(6, Math.ceil(13 * zoom));
    const cv = this.glowPad ?? document.createElement('canvas');
    cv.width = r * 2;
    cv.height = r * 2;
    const g = cv.getContext('2d') as CanvasRenderingContext2D;
    g.clearRect(0, 0, r * 2, r * 2);
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(250, 255, 214, 1)');
    grad.addColorStop(0.09, 'rgba(236, 255, 160, 0.95)');
    grad.addColorStop(0.24, 'rgba(206, 246, 110, 0.5)');
    grad.addColorStop(0.58, 'rgba(170, 226, 90, 0.16)');
    grad.addColorStop(1, 'rgba(150, 210, 80, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, r * 2, r * 2);
    this.glowPad = cv;
    this.glowPadZoom = zoom;
    return cv;
  }

  private home(): HomeAt {
    let h = this.homes[this.homeN];
    if (!h) {
      h = { kind: Home.Nectar, x: 0, y: 0, ground: 0, top: 0, reach: 0, roll: 0, species: 0, variant: 0, shed: 0 };
      this.homes[this.homeN] = h;
    }
    this.homeN++;
    return h;
  }

  private mote(): Mote {
    let m = this.motes[this.moteN];
    if (!m) {
      m = { kind: 'petal', tx: 0, ty: 0, sx: 0, sy: 0, bx: 0, by: 0, a: 1, c: 0, open: 0, lean: 0, hx: 1, hy: 0, px: 0, py: 1, ink: '', ink2: '' };
      this.motes[this.moteN] = m;
    }
    this.moteN++;
    return m;
  }

  private flake(): Flake {
    let f = this.flakes[this.flakeN];
    if (!f) {
      f = { sx: 0, sy: 0, rx: 0, ry: 0, rot: 0, ink: '' };
      this.flakes[this.flakeN] = f;
    }
    this.flakeN++;
    return f;
  }

  /**
   * Whether a tile of grass is near a tree, near water, or both: 0.5 for
   * either and 1.3 for both, 0 for neither. Two tiles round, trees by their
   * tile and water by a pond's or a pool's tile or a stream's corner. Kept
   * per tile until the ground or the water changes, because it is twenty-
   * five looks and the answer is the same every frame.
   */
  private nearWeight(f: LifeFrame, x: number, y: number): number {
    const key = y * f.world.w + x;
    const had = this.near.get(key);
    if (had !== undefined) return had;
    const w = f.world;
    const water = w.water;
    let tree = false;
    let wet = false;
    for (let dy = -2; dy <= 2 && !(tree && wet); dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
        if (!tree && w.tiles[ny * w.w + nx] === TileType.Tree) tree = true;
        if (!wet && ((water !== null && water.wet(nx, ny)) || this.streamTiles.has(ny * w.w + nx))) wet = true;
      }
    }
    const v = (tree ? 0.5 : 0) + (wet ? 0.5 : 0) + (tree && wet ? 0.3 : 0);
    this.near.set(key, v);
    return v;
  }

  /** Where the ground or the water is at a point, whichever is higher, in height units. */
  private surface(w: World, x: number, y: number): number {
    const ground = w.heightAt(x, y);
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const pond = w.water?.levelAt(tx, ty) ?? null;
    const top = pond ?? (ground < 0 ? 0 : -Infinity);
    return top > ground ? top : ground;
  }

  /** Put what is aloft on its line and its place on the screen: false where it is off the screen or on unseen ground. */
  private place(f: LifeFrame, m: Mote, x: number, y: number, h: number, lift: number): boolean {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= f.world.w || ty >= f.world.h || !f.visible(tx, ty)) return false;
    const cam = f.cam;
    const sx = cam.worldToScreenX(x, y);
    const sy = cam.worldToScreenY(x, y, h);
    const by = sy - lift * HEIGHT_SCALE * this.zoom;
    if (sx < -40 || sx > f.width + 40 || by < -40 || sy > f.height + 60) return false;
    const d = depthOf(f.view, tx, ty) - this.lo;
    if (d < 0 || d >= this.aloftRows.length) return false;
    m.tx = tx;
    m.ty = ty;
    m.sx = sx;
    m.sy = sy;
    m.bx = sx;
    m.by = by;
    this.aloftRows[d].push(m);
    return true;
  }

  /** Lay something on the ground or the water, on its line. */
  private lay(f: LifeFrame, x: number, y: number, h: number, rx: number, ry: number, rot: number, ink: string): void {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= f.world.w || ty >= f.world.h || !f.visible(tx, ty) || f.covered(tx, ty)) return;
    const sx = f.cam.worldToScreenX(x, y);
    const sy = f.cam.worldToScreenY(x, y, h);
    if (sx < -8 || sx > f.width + 8 || sy < -8 || sy > f.height + 8) return;
    const d = depthOf(f.view, tx, ty) - this.lo;
    if (d < 0 || d >= this.groundRows.length) return;
    const k = this.flakeN;
    const fl = this.flake();
    fl.sx = sx;
    fl.sy = sy;
    fl.rx = rx;
    fl.ry = ry;
    fl.rot = rot;
    fl.ink = ink;
    this.groundRows[d].push(k);
  }

  /**
   * Work out the frame: find the homes in view, and from them and the clock
   * where everything is. Nothing is drawn here.
   */
  frame(f: LifeFrame, zoom: number): void {
    this.homeN = 0;
    this.moteN = 0;
    this.flakeN = 0;
    this.glowN = 0;
    this.zoom = zoom;
    this.live = false;
    if (zoom < LIFE_FROM) return;
    const s = SEASON_INDEX[f.season];
    const flutter = window4(f.hour, BUTTERFLY_HOURS) * SEASONAL.butterfly[s];
    const darting = window4(f.hour, DRAGONFLY_HOURS) * SEASONAL.dragonfly[s];
    const glowing = clamp01((f.dark - FIREFLY_DARK[0]) / (FIREFLY_DARK[1] - FIREFLY_DARK[0])) * SEASONAL.firefly[s];
    // What comes down out of the trees: petals all spring, leaves on the days a crown is thinning.
    const falling = f.season === 'spring' || shedOn(f.season, f.day) > 0;
    if (!falling && flutter <= 0 && darting <= 0 && glowing <= 0) return;
    this.live = true;
    const rows = f.dHi - f.dLo + 1;
    this.lo = f.dLo;
    for (let i = 0; i < rows; i++) {
      if (this.aloftRows[i]) this.aloftRows[i].length = 0;
      else this.aloftRows[i] = [];
      if (this.groundRows[i]) this.groundRows[i].length = 0;
      else this.groundRows[i] = [];
    }
    this.aloftRows.length = rows;
    this.groundRows.length = rows;
    const w = f.world;
    const water = w.water;
    // The streams' tiles, kept for as long as the streams are the same streams.
    if (water && water.streams !== this.streamsOf) {
      this.streamsOf = water.streams;
      this.streamTiles.clear();
      for (const st of water.streams) {
        for (let k = 0; k + 1 < st.path.length; k += 2) {
          const cx = st.path[k];
          const cy = st.path[k + 1];
          for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
            if (cx + ox >= 0 && cy + oy >= 0) this.streamTiles.add((cy + oy) * w.w + cx + ox);
          }
        }
      }
      this.near.clear();
    }
    this.findHomes(f, falling, flutter > 0, darting > 0, glowing > 0);
    // The kept ones past each cap, by their own roll.
    const homes = this.homes.slice(0, this.homeN);
    const t = f.clock;
    const counts = { butterfly: 0, dragonfly: 0, firefly: 0, tree: 0 };
    const ground = (f.width * f.height) / (HALF_W * HALF_H * 2 * zoom * zoom);
    const k = Math.max(1 / 3, Math.min(1, ground / MOST_OVER));
    const most = {
      butterfly: Math.round(MOST.butterfly * k), dragonfly: Math.round(MOST.dragonfly * k),
      firefly: Math.round(MOST.firefly * k), tree: Math.round(MOST.tree * k),
    };
    homes.sort((a, b) => a.roll - b.roll);
    for (const h of homes) {
      if (h.kind === Home.Leaves) {
        if (counts.tree >= most.tree) continue;
        counts.tree++;
        this.fall(f, h, t);
      } else if (h.kind === Home.Bloom) {
        if (counts.tree >= most.tree) continue;
        counts.tree++;
        this.fall(f, h, t);
        // Some trees in flower have a butterfly at them too.
        if (flutter > 0 && hash2(Math.floor(h.x), Math.floor(h.y), 5101) < SHARE.blossom && counts.butterfly < most.butterfly) {
          if (this.butterfly(f, h, t, flutter, 0)) counts.butterfly++;
        }
      } else if (h.kind === Home.Nectar) {
        if (counts.butterfly >= most.butterfly) continue;
        if (this.butterfly(f, h, t, flutter, 0)) counts.butterfly++;
        // One in four has a second, and the two of them go round each other.
        if (h.roll < 0.25 && counts.butterfly < most.butterfly && this.butterfly(f, h, t, flutter, 1)) counts.butterfly++;
      } else if (h.kind === Home.Water) {
        if (counts.dragonfly >= most.dragonfly) continue;
        if (this.dragonfly(f, h, t, darting)) counts.dragonfly++;
      } else if (h.kind === Home.Grass) {
        if (counts.firefly >= most.firefly) continue;
        if (this.firefly(f, h, t, glowing, 0)) counts.firefly++;
        if (h.roll < 0.45 && counts.firefly < most.firefly && this.firefly(f, h, t, glowing, 1)) counts.firefly++;
      }
    }
    // Sorted for the ground: one fill per colour per line.
    for (const row of this.groundRows) if (row.length > 1) row.sort((a, b) => (this.flakes[a].ink < this.flakes[b].ink ? -1 : this.flakes[a].ink > this.flakes[b].ink ? 1 : 0));
  }

  /**
   * Walk the tiles about to be drawn for anything that could be a home, the
   * way the ground is walked (`Renderer.render`), and take down the ones that
   * are. Only a tile that could be one is looked at twice.
   */
  private findHomes(f: LifeFrame, falling: boolean, nectar: boolean, water: boolean, grass: boolean): void {
    const w = f.world;
    const V = f.view;
    const eStep = V.staggered ? 2 : 1;
    const tiles = w.tiles;
    const data = w.data;
    const W = w.w;
    const pools = w.water;
    for (let d = f.dLo; d <= f.dHi; d++) {
      let e = f.eMin;
      if (V.staggered && ((e + d) & 1) !== 0) e++;
      for (; e <= f.eMax; e += eStep) {
        const x = V.x[0] + V.x[1] * d + V.x[2] * e;
        const y = V.y[0] + V.y[1] * d + V.y[2] * e;
        if (x < 0 || y < 0 || x >= W || y >= w.h) continue;
        const i = y * W + x;
        const t = tiles[i];
        if (t === TileType.Tree) {
          if (!falling) continue;
          const sp = treeSpecies(data[i]);
          const age = treeVariant(data[i]);
          const flower = f.season === 'spring' && blooms(sp, age);
          const shed = flower ? 0 : shedding(sp, age, f.season, f.day);
          if ((!flower && shed <= 0) || !f.visible(x, y)) continue;
          const grew = grownAt(x, y);
          const crown = crownOf(sp, age, grew);
          const h = this.home();
          h.kind = flower ? Home.Bloom : Home.Leaves;
          h.shed = shed;
          h.x = x + 0.5;
          h.y = y + 0.5;
          h.ground = w.centerHeight(x, y);
          h.top = crown.rise;
          h.reach = crown.reach;
          h.roll = hash2(x, y, 5003);
          h.species = sp;
          h.variant = age;
          continue;
        }
        if (t === TileType.Bush) {
          // Only a bush that is in flower today (`bushYear`): hips and haws are no use to a butterfly.
          if (!nectar) continue;
          const kind = bushSpecies(data[i]);
          const year = bushYear(BUSH_DEFS[kind], kind, f.season, f.day);
          if (!year.flowers || f.season === 'autumn') continue;
          const roll = hash2(x, y, 5007);
          if (roll >= SHARE.bush || !f.visible(x, y)) continue;
          const h = this.home();
          h.kind = Home.Nectar;
          h.x = x + 0.5;
          h.y = y + 0.5;
          h.ground = w.centerHeight(x, y);
          h.top = BUSH_TOP * grownAt(x, y);
          h.reach = 0.9;
          h.roll = roll / SHARE.bush;
          continue;
        }
        /*
         * Wildflowers: a tile of grass in flower is a home for butterflies like
         * a flowering bush, at a much smaller share since there are so many
         * more of them, and the likelier the more clumps it has.
         */
        if (nectar && t === TileType.Grass) {
          const clumps = flowersOn(w.seed, x, y, t, data[i], f.season);
          const roll = hash2(x, y, 5019);
          if (clumps > 0 && roll < SHARE.wildflowers * clumps / FLOWER_MOST.summer && f.visible(x, y)) {
            const h = this.home();
            h.kind = Home.Nectar;
            h.x = x + 0.5;
            h.y = y + 0.5;
            h.ground = w.centerHeight(x, y);
            h.top = FLOWER_TOP;
            h.reach = 0.6;
            h.roll = roll / SHARE.wildflowers;
            continue;
          }
        }
        if (water && pools !== null) {
          const roll = hash2(x, y, 5011);
          if (roll < SHARE.pond && pools.wet(x, y) && f.visible(x, y)) {
            const level = pools.levelAt(x, y);
            // Over open water, not the half-drowned edge of the bank.
            if (level !== null && level > w.centerHeight(x, y) + 1) {
              const h = this.home();
              h.kind = Home.Water;
              h.x = x + 0.5;
              h.y = y + 0.5;
              h.ground = level;
              h.top = 0;
              h.reach = 0.75;
              h.roll = roll / SHARE.pond;
              continue;
            }
          }
        }
        if (grass && (t === TileType.Grass || t === TileType.Lawn || t === TileType.Steppe || t === TileType.Moss || t === TileType.Marsh || t === TileType.Reed)) {
          const roll = hash2(x, y, 5013);
          if (roll >= SHARE.grass) continue;
          const near = this.nearWeight(f, x, y);
          if (roll >= SHARE.grass * near * 0.77 || !f.visible(x, y)) continue;
          const h = this.home();
          h.kind = Home.Grass;
          h.x = x + 0.5;
          h.y = y + 0.5;
          h.ground = w.centerHeight(x, y);
          h.top = 0;
          h.reach = 1.1;
          h.roll = roll / SHARE.grass;
        }
      }
    }
    // Along the streams, a corner here and there.
    if (water && pools !== null) {
      for (const st of pools.streams) {
        for (let k = 0; k + 1 < st.path.length; k += 2) {
          const cx = st.path[k];
          const cy = st.path[k + 1];
          const roll = hash2(cx, cy, 5017);
          if (roll >= SHARE.stream) continue;
          const sx = f.cam.worldToScreenX(cx, cy);
          const sy = f.cam.worldToScreenY(cx, cy, w.getHeight(cx, cy));
          if (sx < -60 || sx > f.width + 60 || sy < -60 || sy > f.height + 60) continue;
          if (!f.visible(Math.min(w.w - 1, cx), Math.min(w.h - 1, cy))) continue;
          const h = this.home();
          h.kind = Home.Water;
          h.x = cx;
          h.y = cy;
          h.ground = w.getHeight(cx, cy);
          h.top = 0;
          h.reach = 0.8;
          h.roll = roll / SHARE.stream;
        }
      }
    }
    // Planters and fish ponds.
    if (nectar || water) {
      for (const p of f.pieces()) {
        const planter = p.kind === 'planter';
        if (!(planter ? nectar : water && p.kind === 'fish_pond')) continue;
        const roll = hash2(p.id, p.x * 31 + p.y, 5021);
        if (roll >= (planter ? SHARE.planter : SHARE.fishPond)) continue;
        const [px, py] = p.at;
        if (f.indoors(p.x, p.y)) continue;
        const sx = f.cam.worldToScreenX(px, py);
        const sy = f.cam.worldToScreenY(px, py, w.heightAt(px, py));
        if (sx < -80 || sx > f.width + 80 || sy < -80 || sy > f.height + 80 || !f.visible(p.x, p.y)) continue;
        const h = this.home();
        h.kind = planter ? Home.Nectar : Home.Water;
        h.x = px;
        h.y = py;
        h.ground = w.heightAt(px, py) + (planter ? 0 : 1.4);
        h.top = planter ? PLANTER_TOP : 0;
        h.reach = planter ? 0.8 : 0.35;
        h.roll = roll / (planter ? SHARE.planter : SHARE.fishPond);
      }
    }
  }

  /**
   * How far a thing has come in or gone, 0 to 1, when the share of homes
   * that have one is `out` and its own roll is `roll`: each one comes and
   * goes at its own moment, and takes a few seconds about it rather than
   * appearing.
   */
  private arrived(out: number, roll: number): number {
    return clamp01((out - roll) / 0.04);
  }

  /**
   * A butterfly: round and round the flowers on a loop of its own, bobbing as
   * it goes, and every so often down on them for a while with its wings
   * slowly opening and shutting, and up again.
   */
  private butterfly(f: LifeFrame, h: HomeAt, t: number, out: number, n: number): boolean {
    const seed = h.roll * 1000 + n * 17.3 + h.x * 0.13;
    const r = (k: number): number => hash2(Math.floor(h.x * 8) + n * 97, Math.floor(h.y * 8), 5100 + k);
    const come = this.arrived(out, n ? Math.min(0.999, h.roll * 0.5 + 0.5) : h.roll * 0.5);
    if (come <= 0) return false;
    const m = this.mote();
    m.kind = 'butterfly';
    m.c = Math.floor(r(1) * BUTTERFLIES.length);
    // Its loop: two waves on each axis, so it wanders rather than orbits.
    const pace = 0.5 + 0.35 * r(2);
    const u = t * pace + seed;
    const R = h.reach * (0.75 + 0.3 * r(3));
    const at = (v: number): [number, number, number] => [
      R * (0.62 * Math.sin(v * 0.9 + r(4) * TAU) + 0.38 * Math.sin(v * 2.3 + r(5) * TAU)),
      R * (0.62 * Math.sin(v * 0.73 + r(6) * TAU) + 0.38 * Math.sin(v * 1.9 + r(7) * TAU)),
      3 + 5 * (0.5 + 0.5 * Math.sin(v * 1.3 + r(8) * TAU)),
    ];
    let [ox, oy, lift] = at(u);
    // The bob of a butterfly's flight: up and down a hand's breadth, quick.
    lift += 0.9 * Math.sin(t * 7.1 + seed) + 0.4 * Math.sin(t * 12.7 + seed * 2);
    // Settling: a cycle of its own, most of it flying and a stretch of it down on the flowers.
    const cycle = 9 + 7 * r(9);
    const ph = t / cycle + r(10);
    const phase = ph - Math.floor(ph);
    const turn = Math.floor(ph);
    let down = 0;
    if (phase > 0.6) down = phase < 0.68 ? ease((phase - 0.6) / 0.08) : phase < 0.9 ? 1 : 1 - ease((phase - 0.9) / 0.1);
    let open: number;
    const flap = t * (8.5 + 3 * r(11)) * TAU + seed;
    if (down > 0) {
      const spot = hash2(Math.floor(h.x * 8), Math.floor(h.y * 8) + n * 7, 5200 + turn);
      const spot2 = hash2(Math.floor(h.x * 8) + 3, Math.floor(h.y * 8), 5300 + turn);
      const rest: [number, number] = [(spot - 0.5) * h.reach * 0.45, (spot2 - 0.5) * h.reach * 0.45];
      ox += (rest[0] - ox) * down;
      oy += (rest[1] - oy) * down;
      lift += (0.5 - lift) * down;
      // Down on a flower it opens and shuts its wings slowly, mostly shut.
      const slow = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.2 + seed));
      open = Math.abs(Math.cos(flap)) * (1 - down) + slow * down;
    } else {
      open = Math.abs(Math.cos(flap));
    }
    // In a wind it is carried a little way off downwind, and comes back when it drops.
    ox += f.windX * f.force * 0.3 * (1 - down);
    oy += f.windY * f.force * 0.3 * (1 - down);
    // Coming or going, it is up and away over the rooftops.
    const away = 1 - come;
    lift += away * away * 60;
    ox += f.windX * away * 2;
    oy += f.windY * away * 2;
    const x = h.x + ox;
    const y = h.y + oy;
    const ground = this.surface(f.world, x, y);
    const top = Math.max(h.ground + h.top, ground);
    const [nx, ny] = at(u + 0.05);
    m.open = open;
    m.lean = Math.max(-1, Math.min(1, (f.cam.rotateX(nx - ox, ny - oy) - f.cam.rotateY(nx - ox, ny - oy)) * 6));
    m.a = come;
    if (!this.place(f, m, x, y, ground, top - ground + lift)) {
      this.moteN--;
      return false;
    }
    return true;
  }

  /**
   * A dragonfly: holding still in the air over the water, then gone in a
   * dart to another place over it, and holding still again. Where it holds
   * is its own roll for each stretch, so it patrols the water rather than
   * going round a loop.
   */
  private dragonfly(f: LifeFrame, h: HomeAt, t: number, out: number): boolean {
    const r = (k: number): number => hash2(Math.floor(h.x * 4), Math.floor(h.y * 4), 5400 + k);
    const come = this.arrived(out, h.roll);
    if (come <= 0) return false;
    const m = this.mote();
    m.kind = 'dragonfly';
    m.c = Math.floor(r(1) * DRAGONFLIES.length);
    const hold = 1.4 + 1.6 * r(2);
    const dart = 0.42;
    const clock = t + r(3) * 100;
    const k = Math.floor(clock / hold);
    const within = clock - k * hold;
    const spot = (j: number): [number, number, number] => {
      const a = hash2(Math.floor(h.x * 4) + j, Math.floor(h.y * 4), 5500) * TAU;
      const d = h.reach * Math.sqrt(hash2(Math.floor(h.x * 4), Math.floor(h.y * 4) + j, 5600));
      return [Math.cos(a) * d, Math.sin(a) * d, 4 + 6 * hash2(j, Math.floor(h.x * 4) + Math.floor(h.y * 4), 5700)];
    };
    const p0 = spot(k - 1);
    const p1 = spot(k);
    let ox: number;
    let oy: number;
    let lift: number;
    let hx = p1[0] - p0[0];
    let hy = p1[1] - p0[1];
    if (within < dart) {
      const e = ease(within / dart);
      ox = p0[0] + (p1[0] - p0[0]) * e;
      oy = p0[1] + (p1[1] - p0[1]) * e;
      lift = p0[2] + (p1[2] - p0[2]) * e;
    } else {
      // Holding: a hover that is never quite still.
      ox = p1[0] + 0.025 * Math.sin(t * 3.1 + k);
      oy = p1[1] + 0.025 * Math.sin(t * 2.3 + k * 1.7);
      lift = p1[2] + 0.35 * Math.sin(t * 5.3 + k);
      // Turning a little toward where it goes next, over the hold.
      const p2 = spot(k + 1);
      const turn = ease(clamp01((within - hold * 0.7) / (hold * 0.3)));
      hx += (p2[0] - p1[0] - hx) * turn;
      hy += (p2[1] - p1[1] - hy) * turn;
    }
    const away = 1 - come;
    lift += away * away * 50;
    const x = h.x + ox;
    const y = h.y + oy;
    const ground = this.surface(f.world, x, y);
    // Its heading and the line across it, put through the projection so the wings lie in the world and not on the glass.
    const hl = Math.hypot(hx, hy) || 1;
    const wx = hx / hl;
    const wy = hy / hl;
    const cam = f.cam;
    const su = (vx: number, vy: number): [number, number] => {
      const u = cam.rotateX(vx, vy);
      const v = cam.rotateY(vx, vy);
      return [(u - v) * HALF_W, (u + v) * HALF_H];
    };
    const [ax, ay] = su(wx, wy);
    const [cx, cy] = su(-wy, wx);
    m.hx = ax / HALF_W;
    m.hy = ay / HALF_W;
    m.px = cx / HALF_W;
    m.py = cy / HALF_W;
    m.a = come;
    m.open = 0.5 + 0.5 * Math.sin(t * 61 + h.roll * 40);
    if (!this.place(f, m, x, y, ground, Math.max(h.ground, ground) - ground + lift)) {
      this.moteN--;
      return false;
    }
    return true;
  }

  /**
   * A firefly: drifting slowly over the grass a little above it, lit in
   * short pulses on a beat of its own -- a quick rise and a slower fade --
   * and dark between them.
   */
  private firefly(f: LifeFrame, h: HomeAt, t: number, out: number, n: number): boolean {
    const r = (k: number): number => hash2(Math.floor(h.x) * 3 + n, Math.floor(h.y), 5800 + k);
    const come = this.arrived(out, n ? Math.min(0.999, 0.4 + h.roll) : h.roll * 0.6);
    if (come <= 0) return false;
    const u = t * (0.16 + 0.1 * r(1));
    const x = h.x + h.reach * (0.6 * Math.sin(u + r(2) * TAU) + 0.4 * Math.sin(u * 2.3 + r(3) * TAU)) + f.windX * f.force * 0.25;
    const y = h.y + h.reach * (0.6 * Math.sin(u * 0.8 + r(4) * TAU) + 0.4 * Math.sin(u * 1.9 + r(5) * TAU)) + f.windY * f.force * 0.25;
    const lift = 3 + 8 * (0.5 + 0.5 * Math.sin(u * 1.7 + r(6) * TAU));
    const beat = 2.2 + 2.4 * r(7);
    const ph = t / beat + r(8);
    const p = ph - Math.floor(ph);
    const pulse = p < 0.07 ? p / 0.07 : Math.exp(-(p - 0.07) * beat * 1.25);
    const g = pulse * come;
    if (g < 0.03) return true;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= f.world.w || ty >= f.world.h || !f.visible(tx, ty)) return false;
    const ground = this.surface(f.world, x, y);
    const sx = f.cam.worldToScreenX(x, y);
    const sy = f.cam.worldToScreenY(x, y, ground + lift);
    if (sx < -20 || sx > f.width + 20 || sy < -20 || sy > f.height + 20) return false;
    let gl = this.glows[this.glowN];
    if (!gl) {
      gl = { x: 0, y: 0, g: 0 };
      this.glows[this.glowN] = gl;
    }
    this.glowN++;
    gl.x = sx;
    gl.y = sy;
    gl.g = g;
    return true;
  }

  /**
   * What comes down out of a tree: petals off one in flower, leaves off one
   * whose crown is thinning at the end of autumn.
   *
   * Each of a handful of places in the air has one leave the crown from a
   * spot of its own, come down turning over and swinging across the wind as
   * it falls, carried down the wind the harder it blows; lie where it lands
   * for the rest of its `PETAL_LIFE`, or float on the water there drifting
   * on the wind; and thin to nothing, and the place goes round again from
   * somewhere else in the crown. How many are in the air is the wind: a
   * couple of petals in a calm and five in a gale; a leaf or so in a calm and
   * three or four in a gale on the last day of autumn, fewer the day before.
   * What already lies under the tree is in the tree's own picture
   * (`./foliage`, `litter`).
   */
  private fall(f: LifeFrame, h: HomeAt, t: number): void {
    const leaf = h.kind === Home.Leaves;
    const bloom = leaf ? null : bloomOf(h.species);
    const tones = leaf ? AUTUMN[TREE_DEFS[h.species].name] : bloom?.tones;
    if (!tones) return;
    const tx = Math.floor(h.x);
    const ty = Math.floor(h.y);
    const w = f.world;
    const z = this.zoom;
    const light = tones[0];
    const mid = tones[1];
    const want = leaf
      ? (LEAVES_CALM + (LEAVES_GALE - LEAVES_CALM) * f.force) * (h.shed / SHED_MOST)
      : PETALS_CALM + (PETALS_GALE - PETALS_CALM) * f.force;
    const slots = Math.ceil(leaf ? LEAVES_GALE : PETALS_GALE);
    const drift = PETAL_CALM + (PETAL_BLOWN - PETAL_CALM) * f.force;
    /*
     * What floats on the water near it, turning slowly where it lies and
     * riding the ripples round. Water is on one side of a tree if it is near
     * it at all, so places are tried three times over and the first that are
     * on water are kept: petals gather along the bank they came down by.
     */
    const floating = Math.round(FLOATING * (leaf ? h.shed / SHED_MOST : 1));
    for (let i = 0, laid = 0; i < floating * 3 && laid < floating; i++) {
      const a = hash2(tx, ty, 7000 + i) * TAU;
      const d = (h.reach + FLOAT_REACH) * (0.35 + 0.65 * Math.sqrt(hash2(tx, ty, 7100 + i)));
      const px = h.x + Math.cos(a) * d + 0.05 * Math.sin(t * 0.31 + i * 1.7);
      const py = h.y + Math.sin(a) * d + 0.05 * Math.cos(t * 0.23 + i * 2.3);
      const on = this.surface(w, px, py);
      if (on <= w.heightAt(px, py) + 0.01) continue;
      laid++;
      const size = (0.95 + 0.4 * hash2(tx, ty, 7200 + i)) * z * (leaf ? 1.45 : 1);
      this.lay(f, px, py, on, 2.5 * size, 1.6 * size, hash2(tx, ty, 7300 + i) * TAU + t * 0.12, leaf ? tones[i % 3] : i % 3 ? mid : light);
    }
    const ground0 = h.ground;
    const speed = leaf ? LEAF_FALL : PETAL_FALL;
    for (let i = 0; i < slots; i++) {
      const share = clamp01(want - i);
      if (share <= 0) break;
      const off = hash2(tx + i * 13, ty, 6400);
      const ph = t / PETAL_LIFE + off;
      const k = Math.floor(ph);
      const age = (ph - k) * PETAL_LIFE;
      const a = hash2(tx * 7 + i, ty * 5 + k, 6500) * TAU;
      const d = h.reach * Math.sqrt(hash2(tx + k, ty * 3 + i, 6600));
      const x0 = h.x + Math.cos(a) * d;
      const y0 = h.y + Math.sin(a) * d;
      const h0 = ground0 + h.top * (0.7 + 0.45 * hash2(tx + i, ty + k, 6700));
      const fall = Math.min(PETAL_LIFE * 0.62, (h0 - ground0) / speed);
      const flight = Math.min(age, fall);
      // Swinging across the wind as it comes down: a falling leaf's pendulum, wider for a leaf.
      const swing = (leaf ? 0.11 : 0.07) * Math.sin(flight * (leaf ? 2.4 : 3.3) + i * 2.1 + k);
      let x = x0 + f.windX * drift * flight - f.windY * swing;
      let y = y0 + f.windY * drift * flight + f.windX * swing;
      const size = (0.95 + 0.4 * hash2(tx + k, ty + i, 6800)) * z * (leaf ? 1.45 : 1);
      const spin = flight * (4 + 3 * hash2(tx, ty + k, 6900)) + k;
      const ink = leaf ? tones[(i + k) % 3] : light;
      if (age < fall) {
        const ground = this.surface(w, x, y);
        const height = h0 + (ground0 - h0) * (age / fall);
        const m = this.mote();
        m.kind = 'petal';
        m.a = share * clamp01(age / 0.4);
        m.hx = spin;
        m.open = Math.abs(Math.cos(spin * 0.7)) * 0.75 + 0.25;
        m.px = size;
        m.ink = ink;
        m.ink2 = leaf ? tones[2] : mid;
        if (!this.place(f, m, x, y, ground, Math.max(0, height - ground))) this.moteN--;
        continue;
      }
      // Down: on the ground it lies; on the water it floats off on the wind.
      const since = age - fall;
      const left = PETAL_LIFE - fall;
      const thin = 1 - ease(clamp01((since - left * 0.55) / (left * 0.45)));
      if (thin <= 0.05) continue;
      let on = this.surface(w, x, y);
      if (on > w.heightAt(x, y) + 0.01) {
        x += f.windX * (0.02 + 0.05 * f.force) * since;
        y += f.windY * (0.02 + 0.05 * f.force) * since;
        on = this.surface(w, x, y);
      }
      this.lay(f, x, y, on, 2.5 * size * thin * share, 1.6 * size * thin * share, spin, leaf ? ink : mid);
    }
  }

  /** What is aloft on a line of the ground, to be sorted in with everything else standing on it. */
  aloft(d: number): readonly Mote[] {
    if (!this.live) return NONE;
    return this.aloftRows[d - this.lo] ?? NONE;
  }

  /** Lay what lies on a line of the ground: after the line's ground and water, before anything stands on it. */
  ground(ctx: CanvasRenderingContext2D, d: number): void {
    if (!this.live) return;
    const row = this.groundRows[d - this.lo];
    if (!row || !row.length) return;
    let ink = '';
    for (let j = 0; j < row.length; j++) {
      const fl = this.flakes[row[j]];
      if (fl.ink !== ink) {
        if (ink) ctx.fill();
        ink = fl.ink;
        ctx.fillStyle = ink;
        ctx.beginPath();
      }
      oval(ctx, fl.sx, fl.sy, fl.rx, fl.ry * 0.62, fl.rot);
    }
    if (ink) ctx.fill();
  }

  /** Draw one thing that is aloft. */
  draw(ctx: CanvasRenderingContext2D, m: Mote): void {
    const z = this.zoom;
    if (m.kind === 'petal') {
      ctx.globalAlpha = m.a;
      ctx.fillStyle = m.open > 0.6 ? m.ink : m.ink2;
      ctx.beginPath();
      ctx.ellipse(m.bx, m.by, 2.5 * m.px, 1.6 * m.px * m.open, m.hx, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    if (m.kind === 'butterfly') {
      const [wing, edge, body] = BUTTERFLIES[m.c];
      const span = 6.2 * z;
      const o = 0.18 + 0.82 * m.open;
      // Its shadow on what is under it, which is what says how high it is.
      ctx.globalAlpha = 0.16 * m.a;
      ctx.fillStyle = '#2c4a4e';
      ctx.beginPath();
      oval(ctx, m.sx, m.sy, span * 0.55 * o + z, span * 0.22, 0);
      ctx.fill();
      ctx.globalAlpha = m.a;
      /*
       * The wings, folding up over its back as they shut: a forewing reaching
       * up and out and a smaller hindwing down and out each side, with the
       * notch between them that makes it a butterfly and not a bow. Banked
       * as a whole into the way it is turning.
       */
      ctx.save();
      ctx.translate(m.bx, m.by);
      ctx.rotate(m.lean * 0.3);
      const up = (1 - o) * span * 0.5;
      for (const [ink, grow] of [[edge, 1], [wing, 0.8]] as const) {
        ctx.fillStyle = ink;
        ctx.beginPath();
        for (const side of [-1, 1]) {
          oval(ctx, side * span * 0.52 * o, -span * 0.26 - up, (span * 0.5 * o + 0.5 * z) * grow, span * 0.4 * grow, side * 0.7);
          oval(ctx, side * span * 0.36 * o, span * 0.24 - up * 0.6, (span * 0.36 * o + 0.4 * z) * grow, span * 0.28 * grow, -side * 0.55);
        }
        ctx.fill();
      }
      ctx.fillStyle = body;
      ctx.beginPath();
      oval(ctx, 0, 0, span * 0.42, 0.75 * z, Math.PI / 2);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }
    // A dragonfly: a long body down its heading, four wings of glass across it.
    const [bodyInk, tailInk] = DRAGONFLIES[m.c];
    const len = 8 * z;
    const x = m.bx;
    const y = m.by;
    ctx.globalAlpha = 0.14 * m.a;
    ctx.fillStyle = '#1f3f4a';
    ctx.beginPath();
    oval(ctx, m.sx, m.sy, len * 0.7, len * 0.26, 0);
    ctx.fill();
    ctx.globalAlpha = m.a;
    const hx = m.hx;
    const hy = m.hy;
    const px = m.px;
    const py = m.py;
    // The wings first, so the body lies over them: a fore pair swept a little forward, a hind pair back.
    const wing = 7.6 * z;
    const across = Math.atan2(py, px);
    ctx.fillStyle = `rgba(242, 249, 255, ${(0.55 + 0.2 * m.open).toFixed(2)})`;
    ctx.strokeStyle = 'rgba(70, 96, 112, 0.7)';
    ctx.lineWidth = Math.max(0.6, 0.5 * z);
    ctx.beginPath();
    for (const [along, sweep] of [[0.2, 0.16], [0.02, -0.14]] as const) {
      for (const side of [-1, 1]) {
        const cx = x + hx * len * along + px * side * wing * 0.5;
        const cy = y + hy * len * along + py * side * wing * 0.5;
        oval(ctx, cx, cy, wing * 0.5, wing * 0.15, across - side * sweep);
      }
    }
    ctx.fill();
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.strokeStyle = tailInk;
    ctx.lineWidth = Math.max(1.2, 1.9 * z);
    ctx.beginPath();
    ctx.moveTo(x + hx * len * 0.1, y + hy * len * 0.1);
    ctx.lineTo(x - hx * len * 0.9, y - hy * len * 0.9);
    ctx.stroke();
    ctx.fillStyle = bodyInk;
    ctx.beginPath();
    oval(ctx, x + hx * len * 0.16, y + hy * len * 0.16, 1.7 * z, 1.35 * z, Math.atan2(hy, hx));
    oval(ctx, x + hx * len * 0.38, y + hy * len * 0.38, 1.2 * z, 1.2 * z, 0);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
  }

  /** The fireflies, over the night: added light, so each one is a light and not a dot painted on the dark. */
  glow(ctx: CanvasRenderingContext2D): void {
    if (!this.live || !this.glowN) return;
    const pad = this.glowSprite(this.zoom);
    const r = pad.width / 2;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.glowN; i++) {
      const g = this.glows[i];
      ctx.globalAlpha = Math.min(1, g.g);
      ctx.drawImage(pad, g.x - r, g.y - r);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

const NONE: readonly Mote[] = [];
