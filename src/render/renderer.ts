import { Camera } from '../engine/camera';
import { emoteAt } from '../game/emotes';
import { ACTION_BY_ID } from '../game/actions';
import type { FullscreenCanvas } from '../engine/canvas';
import type { Game } from '../game/game';
import {
  borderOf,
  borderPoints,
  floorKind,
  isDone,
  bordersRoom,
  MATERIAL_BY_ID,
  progressOf,
  ROOF_PITCH,
  roofShapeDef,
  WALL_HEIGHT,
  WALL_THICK,
  FENCE_THICK,
  FLOOR_DEEP,
  WALL_TYPE_BY_ID,
  workLevel,
  type Border,
  type FloorTile,
  type MaterialDef,
  type Side,
  type Wall,
  type Building,
  floorBill,
  roofShapeOf,
} from '../game/building';
import { foundationDone } from '../game/foundations';
import { DYE_BY_ID } from '../game/dyestuffs';
import { hash2 } from '../world/noise';
import { bareRock, DAMP_SAND, dustiness, FLAT, growth, oreWash, PAVED, ROCK_VARIANTS, SLAB_VARIANTS, STREWN, TileType, TILE_DEFS, COVERED, bushSpecies, slabVariant, treeSpecies, treeVariant } from '../world/tiles';
import { HALF_H, HALF_W, HEIGHT_SCALE, UNITS_PER_TILE } from './iso';
import { depthOf, type View } from './view';
import { FALLS, roofModel, type Fall, type RoofGable, type RoofModel, type RoofPt } from './roofshape';
import { COVER_PPT, covering } from './roofing';
import { FLOOR_PPT, FLOOR_TILES, concrete, flooring, slabbing } from './flooring';
import { LADDER, stairStyle } from './stairing';
import { drawShine, shines } from './shine';
import { ARCH, BAY, DOOR, DOUBLE, FENCE_GAP, WINDOW, type Masonry, adobe, brickwork, cobble, goldwork, logwork, marblework, planking, sandstone, silverwork, slatework, stonework, timbercraft } from './masonry';
import { anvilCentre, type PlacedAnvil } from '../game/anvil';
import { postCentre, postLeft, postLife, type PlacedPost } from '../game/posts';
import { trapCentre, type PlacedTrap } from '../game/traps';
import { ageDef } from '../game/creatures';
import { CRATE_DOOR, CREATURE_CRATE } from '../game/creaturecrate';
import { fireCentre, type PlacedCampfire } from '../game/campfire';
import { smelterCentre, type PlacedSmelter } from '../game/smelter';
import { kilnCentre, type PlacedKiln } from '../game/kiln';
import { furnitureCentre, furnitureDef, type PlacedFurniture, facingOf as pieceFacing, furnitureFootprint } from '../game/furniture';
import { UNSEEN, VISIBLE } from '../game/vision';
import { DAWN, DUSK } from '../game/game';
import { drawFurniture, furnitureSpan, FURNITURE_HEIGHT, headingView, pieceView } from './furniture';
import { dyeOf } from '../game/dyestuffs';
import { sailTrim } from '../game/wind';
import { FURNITURE_BY_ID, rackDeck, rackSpots } from '../game/furniture';
import { cropDef } from '../game/farming';
import { crateCentre, crateKindOfItem, subtileOf, SUBTILES } from '../game/crates';
import { maxHealth, SPECIES, type Creature } from '../game/creatures';
import { CREST_ALPHA, FOAM_WIDTH, foamAlpha, LONG_WAVE, SHORT_WAVE, SWELL_SPEED, swellAt, swellShow, TROUGH_ALPHA, WATER_LIT, WATER_PALETTE, waterLevel } from './water';
import { Wakes } from './wake';
import { Dust } from './dust';
import { Gaits } from './gait';
import type { Peer } from '../game/roster';
import { css, HAZE_REACH, rgba, skyAt, unknownInk, type Sky } from './sky';

/**
 * How many steps the distance is mixed in. Enough that the banding is under
 * the eye, few enough that a wood builds a handful of copies per sprite
 * rather than one per tree per frame.
 */
const HAZE_STEPS = 6;

/** The top of a creature crate's floor, in pixels at zoom 1: 0.7 units up. */
const CRATE_FLOOR = 0.7 * HEIGHT_SCALE;
/** How big a wildermon is drawn in a crate against out in the world, so a grown one stands inside it. */
const CRATE_SCALE = 0.8;
import { FLOAT_COLOURS, Floaters } from './floaters';
import { drawSpeech } from './bubble';
import { SKILL_BY_ID } from '../game/skills';
import { PUFFS, PUFF_DRIFT, PUFF_RISE, puffAge, puffOf } from './smoke';
import { CROWD, DROWNS, hemOf, ruffle, strew, strewLook, WADES, WADE_DEPTH } from './meadow';
import { seam } from './seam';
import { SWAY_MAX, swayAt } from './sway';
import { ColourPages } from './pages';
import { spriteScaleFor, bushSprite, crateSprite, cropSprite, drawAnvil, drawCampfire, drawCreature, drawKiln, drawPlayer, drawSmelter, facingOf, pileSprite, tokenSprite, treeSprite, type Sprite, drawWorkPost, drawTrap, drawDeck, stumpSprite } from './sprites';
import { FIGURE_TOP } from './figure';

/** Result of picking a screen point: the tile, the approximate world position and the nearest corner. */
/**
 * What is on its way to the ground: a piece of furniture following the
 * cursor, or a staircase on its tile, turned the way Q and E have turned it.
 * `ok` is whether it can go where it is.
 */
export type Ghost =
  | { kind: 'furniture'; piece: string; material?: string; x: number; y: number; sx: number; sy: number; facing: Side; ok: boolean }
  | { kind: 'stairs'; x: number; y: number; level: number; material: string; floorKind: 'stairs' | 'ladder'; side: Side; ok: boolean };

export interface Pick {
  x: number;
  y: number;
  wx: number;
  wy: number;
  cx: number;
  cy: number;
  /** A creature under the cursor, when one is. */
  creature?: number;
  /**
   * Somebody else under the cursor, by the uid the island knows them by.
   *
   * Everything else on this list is picked by a number that means something to
   * this browser. A person has to be picked by something that means something
   * to the *island*, because what you do with one — invite them home, ask to be
   * their friend, write to them — is a door and not a drawing.
   */
  peer?: string;
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
  kind: 'tree' | 'bush' | 'stump' | 'player' | 'peer' | 'pile' | 'token' | 'crate' | 'creature' | 'campfire' | 'crop' | 'smelter' | 'kiln' | 'furniture' | 'anvil' | 'post' | 'trap' | 'deck';
  x: number;
  y: number;
  sx: number;
  sy: number;
  spr: Sprite | null;
  creature?: Creature;
  peer?: Peer;
  crateId?: number;
  fire?: PlacedCampfire;
  smelter?: PlacedSmelter;
  kiln?: PlacedKiln;
  piece?: PlacedFurniture;
  anvil?: PlacedAnvil;
  post?: PlacedPost;
  trap?: PlacedTrap;
  deck?: { kind: string; done: boolean; drop: number; id: number };
  /** 1 rare, 2 supreme, 3 fantastic, for the shine over it; absent for the ordinary run of things. */
  rare?: number;
  /**
   * Pixels to draw above where it sorts. A driver sits on the cart, so the
   * figure belongs above it on screen while still sorting as though it stood
   * on the same ground — lift the sort key instead and the cart is drawn last,
   * over the top of its own driver.
   */
  lift?: number;
  /**
   * Where a body on a hull's deck is drawn, in pixels from where it sorts.
   * Everybody aboard sorts with the hull, a hair after it, so the deck is never
   * drawn over them; each is drawn at their own place on it.
   */
  drawDx?: number;
  drawDy?: number;
  /** On a deck on their feet rather than sat at a helm or on a seat. */
  standing?: boolean;
}

interface HitRect {
  x: number;
  y: number;
  left: number;
  top: number;
  w: number;
  h: number;
  creature?: number;
  peer?: string;
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


/**
 * The cold laid over ground that is remembered rather than watched.
 *
 * A neutral grey rather than the blue it was: remembered ground is *memory*,
 * not night, and a blue wash said "it is dark over there" where what is meant
 * is "you are not looking". The colour underneath it is drained of its own
 * hue as well — see `computeColor` — so the two together read as an old
 * photograph of the place rather than the place at midnight.
 */
const FOG_COLOR = 'rgba(30, 30, 32, 0.46)';
/** How much of its own colour remembered ground keeps. */
const MEMORY_SATURATION = 0.22;
const GRID_COLOR = 'rgba(0,0,0,0.16)';
const DEED_COLOR = 'rgba(96, 230, 110, 0.9)';
const DEED_SHADOW = 'rgba(0, 40, 0, 0.6)';
const PLAN_COLOR = 'rgba(120, 220, 140, 0.95)';
/** The shade a wall throws on the ground at its foot: cool, as the shade on a wall's own turned face is. */
const SHADE_INK = 'rgba(50, 44, 70, 0.26)';
/**
 * Concrete, and the shadow line down a shutter board.
 *
 * A foundation is the one thing in the world whose whole point is that its
 * sides are vertical, so it is drawn as the box it is: a flat top at the level
 * it was poured to, and a face straight down from each edge the camera is on
 * to the corner heights the ground still has. Nothing else in the game has an
 * edge like that, which is exactly why it was asked for.
 */
const CONCRETE: readonly [number, number, number] = [172, 169, 160];
const CONCRETE_TRIM: readonly [number, number, number] = [112, 109, 102];
/** How deep a shutter board is, in height units: the width of one band of a foundation's side. */
const SHUTTER = 3;
/*
 * Scaffolding: what a plan looks like before anything is built on it.
 *
 * Reported as "there's currently nothing at all to show it's a plan", with a
 * picture of a tile whose tooltip said `Part of Oceanport · House · one
 * storey` over ground that looked exactly like the ground beside it. A plan
 * with no walls on it yet drew nothing whatever, because everything drawn for
 * a building hangs off a wall or a floor, and a fresh plan has neither.
 *
 * So the plan itself is drawn: stakes and string round the edge of the
 * footprint, the way a builder marks a site out before a stone is laid. Pale
 * timber for the stakes so they read as something standing there, and the
 * plan's own green for the string, so a run of it says the same word the
 * dashed outline of a planned wall says.
 */
const SCAFFOLD_POST = 'rgba(186, 158, 112, 0.95)';
const SCAFFOLD_TRIM = 'rgba(112, 88, 56, 0.95)';
const SCAFFOLD_LINE = 'rgba(120, 220, 140, 0.75)';
/** How tall a stake stands, as a share of a wall. Waist high on a body. */
const SCAFFOLD_HEIGHT = 0.42;
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

/** A dye's hex, as the three numbers everything else here is drawn from. */
const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/*
 * How much of the hour's light the inside of an archway keeps.
 *
 * A reveal is a face turned away from the light, not a hole in the daylight.
 * At a little over half it came out near black against a pale wall and read as
 * a slot rather than a passage. The jambs keep three quarters, because the sky
 * still reaches down the sides of a way through; the soffit keeps half again
 * of that, because nothing reaches the underside of an arch.
 */
const JAMB_LIT = 0.86;
const SOFFIT_LIT = 0.7;
/** The inside of a sill is the one surface in a wall turned up at the sky. */
const SILL_LIT = 1.02;
/** And so is a threshold, which is walked on as well, so it is paler still. */
const STEP_LIT = 1.06;
/** Strap hinges and a door ring: the only iron on a wall made of stone and oak. */
/**
 * Where the meadow starts, which is the zoom the game opens at.
 *
 * Further out than this a tile is sixty pixels across, a tuft is eight and a
 * daisy is two -- which is noise -- and there are three times as many tiles
 * on the screen to draw all of it on. Paving has the same rule at three
 * quarters and the ground speckles at a quarter more, for the same reason:
 * looking at the country is not the same job as standing in it.
 */
const MEADOW_FROM = 1;

/**
 * And where the ruffled join starts, which is further out than that.
 *
 * A clump is a thing in a field and from far enough away it is three pixels
 * of green on green, which is why the meadow waits. A join is the *shape* of
 * the country -- where the field stops and the track begins -- and the eye
 * reads that from a good deal further off than it reads anything standing in
 * it. It is also cheap: a run of lobes along one edge, against a picture
 * blitted per clump per tile.
 *
 * This is the zoom the blended seam it replaces used to start at, so the join
 * between two grounds is drawn over exactly the range it always was.
 */
const RUFFLE_FROM = 0.5;
const IRON: readonly [number, number, number] = [0x7b, 0x81, 0x88];
/** Its own shade, so a bar of it reads as round stock rather than as a painted line. */
const IRON_DARK: readonly [number, number, number] = [0x44, 0x4a, 0x51];


/**
 * Which of `n` pictures a section of a run takes, by a hash of where it is,
 * for a masonry that takes them so: in no order a street shows, never the
 * same as the section either side of it along the run, and never the same
 * as the section under it, so no picture stands twice in a row either way.
 *
 * Along the run every fourth section takes its picture by the hash alone,
 * and each of the three after it one of the others -- not the one the
 * section before took, and the third not the one the next fourth takes
 * either -- so no section has to know more of the run than the three before
 * it. Bumping a picture that matched the one before it, as this did, only
 * moved the match on: three sections running took the same picture. Up the
 * wall each storey is the one under it turned on by the same step, a step
 * the run keeps, so the storeys differ and the run still does.
 */
function scatterOf(b: Border, level: number, n: number): number {
  const along = b.dir === 'h' ? b.x : b.y, run = b.dir === 'h' ? b.y : b.x;
  const hash = (i: number, salt: number): number => {
    let k = (i * 374761393 + run * 668265263 + salt * 1442695041 + (b.dir === 'h' ? 0 : 97)) | 0;
    k = Math.imul(k ^ (k >>> 13), 1274126177);
    return (k ^ (k >>> 16)) >>> 0;
  };
  if (n < 3) return (hash(along, 0) + level) % n;
  /** By a hash, one of the `n` that is none of `not`. */
  const other = (not: number[], h: number): number => {
    const free: number[] = [];
    for (let j = 0; j < n; j++) if (!not.includes(j)) free.push(j);
    return free[h % free.length];
  };
  const first = Math.floor(along / 4) * 4;
  let v = hash(first, 1) % n;
  for (let i = first + 1; i <= along; i++) {
    v = other(i - first === 3 ? [v, hash(first + 4, 1) % n] : [v], hash(i, 2));
  }
  return (v + level * (1 + (hash(0, 3) % (n - 1)))) % n;
}

/** Four whole numbers to one in [0, 1), the same every time: where a thing falls, by where it is. */
function hash4(a: number, b: number, c: number, d: number): number {
  let k = (a * 374761393 + b * 668265263 + c * 1442695041 + d * 2246822519) | 0;
  k = Math.imul(k ^ (k >>> 13), 1274126177);
  k = Math.imul(k ^ (k >>> 16), 2654435761);
  return ((k ^ (k >>> 15)) >>> 0) / 4294967296;
}

const rgb = (c: readonly [number, number, number], k: number, a = 1): string =>
  `rgba(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0},${a})`;
/**
 * A wall's face in the two coordinates that mean anything on it: `t` along the
 * border and `k` up the height, with `s` choosing the face the camera is on or
 * the one behind. Handed to whatever draws on a wall so that it never has to
 * know where the wall is or which way the view is turned.
 */
interface WallGeom {
  px: (t: number, k: number, s?: number) => number;
  py: (t: number, k: number, s?: number) => number;
  quad: (t0: number, t1: number, k0: number, k1: number, s?: number) => void;
}

/** Specks of grain laid on each tile once you are close enough to see them. */
const GRAIN_SPECKS = 14;
/** How far in from the eaves a roof goes on rising, in tiles: past that it is a flat top. */
const ROOF_CAP = 2.5;
/** How far the eaves hang out past the wall's line, and the verge past a gable end, in tiles. */
const ROOF_OVER = 0.14;
const ROOF_VERGE = 0.1;
/** The colour an outline is drawn in round whatever the cursor is on. */
const HOVER_INK = 'rgb(255, 226, 120)';

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

/** How often a still cursor is told again what it is over, in milliseconds. */
const PICK_EVERY = 90;

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

/**
 * What a ground colour looks like once it is in the air. Kicked-up ground is
 * always paler than the ground it came off — it is the dry, fine part of it,
 * lit from every side at once — which also happens to be the only way dust off
 * a green field can be seen against the green field.
 */
function dustTone(colour: string): string {
  const m = /(\d+),(\d+),(\d+)/.exec(colour);
  if (!m) return 'rgb(210,198,176)';
  const r = +m[1];
  const g = +m[2];
  const b = +m[3];
  // Dry earth for ordinary ground; for ground already brighter than that —
  // snow, marble chippings — it goes towards white instead, since dust off a
  // snowfield is not the colour of a ploughed field.
  const pale = (r + g + b) / 3 > 190;
  const mix = (v: number, to: number): number => Math.round(v + (to - v) * 0.62);
  return `rgb(${mix(r, pale ? 255 : 236)},${mix(g, pale ? 255 : 226)},${mix(b, pale ? 255 : 202)})`;
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
  /** What is being set down, drawn after everything that stands. */
  ghost: Ghost | null = null;
  /** The tile the tile window is looking at, outlined so you can see which it is. */
  selected: { x: number; y: number } | null = null;
  fps = 0;
  private colors: ColourPages;
  /** Which step of the sun's walk the ground was last shaded for. */
  private lastSun = -1;
  /** Where a shadow falls this frame, in screen pixels, and how dark it is. */
  private shadow = { dx: 0, dy: 0, alpha: 0 };
  /** Tile colours as the map remembers them, for ground nobody is watching. */
  private memColors: ColourPages;
  private lastVision = -1;
  private pts = new Float64Array(8);
  /** The tile's outline in screen pixels from its anchor corner, worked out once a frame. */
  private shapeBuf = new Float64Array(8);
  private cornerBuf = [0, 0, 0, 0];
  /**
   * Corners for working out a colour, kept apart from the ones the draw loop
   * is holding. They used to share a buffer, and since a tile asks its
   * neighbours for their colours to blend the seam, the loop would find a
   * neighbour's heights where its own had been — so a tree stood at the wrong
   * height for a frame whenever a colour had to be worked out again, which is
   * every time the fog moves.
   */
  private colorBuf = [0, 0, 0, 0];
  private ents: Entity[] = [];
  /**
   * Entities are handed out of a pool rather than made fresh.
   *
   * Every tree, pile, crate, fire and animal on screen was an object literal,
   * built and thrown away on every frame — a few thousand of them a second,
   * all of them dead before the next frame starts. They are lent out of here
   * instead and given back when the row is done.
   *
   * `take` blanks every optional field, which is the whole safety of it: a
   * crate handed a creature's slot must not still be carrying that creature.
   * There is exactly one place that can go wrong and it clears the lot.
   */
  private entPool: Entity[] = [];
  private entN = 0;

  private take(kind: Entity['kind'], x: number, y: number, sx: number, sy: number, spr: Sprite | null): Entity {
    let e = this.entPool[this.entN];
    if (!e) {
      e = { kind, x, y, sx, sy, spr };
      this.entPool[this.entN] = e;
    } else {
      e.kind = kind;
      e.x = x;
      e.y = y;
      e.sx = sx;
      e.sy = sy;
      e.spr = spr;
    }
    this.entN++;
    e.creature = undefined;
    e.peer = undefined;
    e.crateId = undefined;
    e.fire = undefined;
    e.smelter = undefined;
    e.kiln = undefined;
    e.piece = undefined;
    e.anvil = undefined;
    e.post = undefined;
    e.trap = undefined;
    e.deck = undefined;
    e.lift = undefined;
    e.drawDx = undefined;
    e.drawDy = undefined;
    e.standing = undefined;
    e.rare = undefined;
    this.ents.push(e);
    return e;
  }
  private waterPoly = new Float64Array(16);
  /** Every water polygon drawn this frame, so a wake can be kept on the water. */
  private waterEdge = new Float64Array(4);
  /** Grain on bare ground, gathered a diagonal at a time so it costs two fills, not two a tile. */
  /**
   * The grain speckles for the row being drawn: three numbers apiece — x, y and
   * size — in two buffers that are filled and emptied rather than replaced.
   *
   * This was two fresh `Path2D` objects per row of the island, every frame,
   * zoomed in. They are filled onto the context's own path instead, which
   * `beginPath` empties for nothing.
   */
  private grainDark = new Float32Array(3 * 4096);
  private grainPale = new Float32Array(3 * 4096);
  private grainN = 0;
  private grainM = 0;
  /** The grass quads of the row being drawn, four corners apiece, for one fill. */
  /** Whether any water was drawn this frame; an inland view skips the surface pass. */
  private drewWater = false;
  private seaPath = new Path2D();
  /** What everything on the water has left behind it. */
  readonly wakes = new Wakes();
  /** What has been kicked up underfoot. */
  readonly dust = new Dust();
  /** Numbers and words standing over what they belong to. */
  readonly floaters = new Floaters();
  /** How long a thing keeps the white of being hit, in seconds. */
  private static readonly FLASH = 0.22;
  /** Which way the wind leans things on screen, and how hard, worked out once a frame. */
  private lean = { x: 0, y: 0, force: 0 };
  /** The light this frame, kept so anything needing a ground colour can ask for one. */
  private sunNow: [number, number, number] = [0, 0, 1];
  /** The sky this frame, which the haze over the distance is drawn in. */
  private sky: Sky = skyAt(0, 0);
  /** The wind as the surface sees it, worked out once a frame rather than per tile. */
  private surf = { dirX: 1, dirY: 0, force: 0.5 };
  private drawnTiles = 0;
  /** What the cursor was last told it was over, and when. */
  private picked: Pick | null = null;
  private pickedAt = -1e9;
  private pickX = NaN;
  private pickY = NaN;
  private playerFacing = 1;
  private creatureHits: HitRect[] = [];
  private peerHits: HitRect[] = [];
  private crateHits: HitRect[] = [];
  private fireHits: HitRect[] = [];
  private smelterHits: HitRect[] = [];
  private kilnHits: HitRect[] = [];
  private furnitureHits: HitRect[] = [];
  private anvilHits: HitRect[] = [];
  private postHits: HitRect[] = [];
  private trapHits: HitRect[] = [];
  private deckHits: HitRect[] = [];
  /** Painted materials, worked out once each and kept: there are not many. */
  private readonly paints = new Map<string, MaterialDef>();
  /** Which way each beast is turned, so the answer holds still between frames. */
  private readonly beastFacing = new Map<number, number>();
  /**
   * How hard every body on screen is going, read off the ground it covers.
   *
   * Kept by the renderer rather than by the game because it is a drawing
   * question — nothing in the rules cares whether a rabba is trotting — and
   * because reading it here gets a person, a peer and a wildermon all at once
   * without a field on any of them.
   */
  private readonly gaits = new Gaits();
  /** How long the frame being drawn is, for anything worked out per second. */
  private frameDt = 1 / 60;
  /**
   * The tiles of the room the player is standing in, for the cutaway.
   *
   * Walls facing the camera used to be taken away — or faded — by *building*:
   * step inside a longhouse and every near wall of the whole house went
   * translucent, the far bedroom's included, though nothing in the bedroom
   * was between you and anything. There are rooms now, so the question can be
   * asked properly: a wall is in your way when it stands on the edge of the
   * room you are actually in.
   *
   * Worked out once a frame rather than once a wall, because it is a flood
   * fill; null when you are out of doors, which is most of the time and
   * costs nothing.
   */
  private roomTiles: Set<string> | null = null;
  /**
   * The shade each wall throws on the ground, worked out the first time a
   * tile asks for it in a frame: up to six tiles ask after the same wall.
   */
  private shades = new Map<string, Float64Array | null>();
  /** The pitched roofs to lay this frame, by the line of the ground after whose walls each goes on. */
  private roofQueue = new Map<number, Building[]>();
  /** Each building's roof, worked out once for the tiles it covers and kept until they change. */
  private roofShapes = new Map<number, { sig: string; model: RoofModel }>();
  /** A covering with the hour's light for one face laid into it, as a pattern: see `drawPitchedRoof`. */
  private roofPatterns = new Map<string, CanvasPattern>();
  /**
   * Which way a cart, a wagon or a hull was last going, by piece, so it keeps
   * pointing there when it stops. Kept to the nearest sixty-fourth of a turn,
   * finer than a cart can be seen to turn, so one being driven is drawn from
   * a handful of pictures of itself rather than a new one every frame.
   */
  private pieceHeadings = new Map<number, number>();
  /** A floor's picture as a pattern, by material, paint and size. */
  private floorPatterns = new Map<string, CanvasPattern>();

  constructor(
    private readonly canvas: FullscreenCanvas,
    private readonly game: Game,
  ) {
    this.colors = new ColourPages(game.world.w);
    this.memColors = new ColourPages(game.world.w);
    game.world.onChange((x, y) => this.invalidate(x, y));
    // Damage and skill both go up over the thing they happened to. Damage adds
    // up per target, skill per skill, so a flurry of either reads as one
    // running number rather than a stack of them.
    game.events.on('hit', (x, y, amount, kind) => {
      const key = `${kind}:${Math.round(x)},${Math.round(y)}`;
      this.floaters.add(x, y, kind, key, amount, this.time, (total) => (total < 0.05 ? 'blocked' : `${kind === 'taken' ? '-' : ''}${total < 10 ? total.toFixed(1) : Math.round(total)}`));
    });
    game.events.on('skill', (id, gain) => {
      if (gain <= 0) return;
      const name = SKILL_BY_ID.get(id)?.name ?? id;
      const p = game.player;
      this.floaters.add(p.x, p.y, 'skill', `skill:${id}`, gain, this.time, (total) => `${name} +${total.toFixed(2)}`);
    });
    // A turn of work throws something up where the work is going: chips off
    // the rock, earth off the spade, in the colour of whatever is there.
    game.events.on('strike', (x, y) => {
      if (this.camera.zoom < 0.6) return;
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      const w = game.world;
      if (!w.inBounds(tx, ty) || w.heightAt(x, y) < 0) return;
      const tone = dustTone(this.groundColor(tx, ty, true, this.sunNow));
      this.dust.burst(x, y, this.time, tone, Math.max(0.45, dustiness(w.viewTile(tx, ty, true))));
    });
    game.events.on('reset', () => {
      this.floaters.clear();
      this.dust.clear();
      this.wakes.clear();
      this.gaits.clear();
    });
    canvas.onResize(() => this.camera.setViewport(canvas.width, canvas.height));
    this.camera.setViewport(canvas.width, canvas.height);
  }

  get tilesDrawn(): number {
    return this.drawnTiles;
  }

  /**
   * Sprites already the size they are about to be drawn.
   *
   * A tree is a canvas drawn at its own scale and then squeezed down to
   * whatever the zoom is, and squeezing a picture is the expensive half of
   * putting one on the screen. A wood is a hundred and seventy trees drawn
   * from about eight pictures, so it was doing that same squeeze a hundred and
   * seventy times a frame for eight answers.
   *
   * Each one is squeezed once, into a canvas of its own at the size the screen
   * wants, and then blitted. The cache is thrown away whenever the zoom
   * changes, which is the only thing that can change the answer — a pinch
   * costs one frame of rebuilding and every frame after it is a straight copy.
   *
   * Kept at device pixels rather than CSS ones, because the context is scaled
   * by the display's ratio: a canvas made at CSS size would be blown back up
   * on the way out and come out softer than it does now.
   */
  private scaled = new Map<HTMLCanvasElement, HTMLCanvasElement>();
  /** Rescaled copies of each sprite, kept per eighth of a size. */
  private scaledSizes = new Map<HTMLCanvasElement, Map<number, HTMLCanvasElement>>();
  /** The distance-mixed copies of each rescaled sprite, one per haze step. */
  private hazes = new WeakMap<HTMLCanvasElement, HTMLCanvasElement[]>();
  private scaledAt = -1;

  /** The same sprite, already down to `w` by `h` CSS pixels. */
  /**
   * The same picture with the distance mixed into it, at full opacity.
   *
   * Distance used to be done by laying the tree on thinner, which is the
   * obvious thing and the wrong one: a half-transparent tree is a tree you
   * can see through, so the bushes and the conifer fronds standing behind a
   * far crown read straight out through the front of it. Shapes reading as
   * flat cutouts is the first thing this whole look rests on, and a faded
   * tree is not a cutout, it is a stain.
   *
   * So the colours are mixed toward the distance instead and the thing stays
   * solid. `source-atop` does it inside the sprite's own alpha, which is why
   * it has to happen on a canvas of its own -- done straight onto the
   * picture it would wash the ground round the tree as well as the tree.
   *
   * Six steps rather than a continuous amount, and each step kept against
   * the already-scaled canvas, so a wood of a hundred trees builds at most
   * six of these per sprite per zoom instead of one per tree per frame.
   */
  private hazed(ready: HTMLCanvasElement, step: number): HTMLCanvasElement {
    let steps = this.hazes.get(ready);
    if (!steps) {
      steps = [];
      this.hazes.set(ready, steps);
    }
    const had = steps[step];
    if (had) return had;
    const cv = document.createElement('canvas');
    cv.width = ready.width;
    cv.height = ready.height;
    const g = cv.getContext('2d');
    if (g) {
      g.drawImage(ready, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = (step / HAZE_STEPS) * 0.62;
      g.fillStyle = css(this.sky.far);
      g.fillRect(0, 0, cv.width, cv.height);
    }
    steps[step] = cv;
    return cv;
  }

  /*
   * `w` and `h` used to be taken on trust: the first caller for a sprite got
   * a canvas at its size and every later one got that same canvas back
   * whatever it had asked for. That was true while every tree of a species
   * was drawn at one size, and stopped being true the moment they each grew
   * their own -- an emergent oak was being blown up from a canvas cut for an
   * understorey sapling of the same species, and went soft for it. Kept per
   * eighth of a size now, which is under what the eye picks up and still
   * only a handful of canvases per sprite.
   */
  private atSize(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
    const step = Math.max(1, Math.round(w / 8));
    let sizes = this.scaledSizes.get(src);
    if (!sizes) {
      sizes = new Map();
      this.scaledSizes.set(src, sizes);
    }
    const had = sizes.get(step);
    if (had) return had;
    const dpr = this.canvas.dpr;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * dpr));
    // A height of nought means square, which is what a ground picture is.
    cv.height = h > 0 ? Math.max(1, Math.round(h * dpr)) : cv.width;
    const g = cv.getContext('2d');
    if (g) g.drawImage(src, 0, 0, cv.width, cv.height);
    sizes.set(step, cv);
    return cv;
  }

  private invalidate(x: number, y: number): void {
    const w = this.game.world;
    for (let yy = y - 1; yy <= y + 1; yy++) {
      for (let xx = x - 1; xx <= x + 1; xx++) {
        if (w.inBounds(xx, yy)) {
          this.colors.forget(xx, yy);
          this.memColors.forget(xx, yy);
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
  private computeColor(x: number, y: number, type: TileType, data: number, light: [number, number, number], lit = true): string {
    const w = this.game.world;
    // A wood is a field with trees in it and a kelp bed is sand with weed
    // in it, not soils of their own: see `groundAt`. Worked out here, so it
    // is cached and thrown away with the colour it decides rather than being
    // asked again every frame.
    const ground = COVERED.has(type) ? this.groundAt(x, y, lit) : type;
    const def = TILE_DEFS[ground];
    const c = w.corners(x, y, this.colorBuf);
    const gx = (c[1] + c[2] - (c[0] + c[3])) / 2 / UNITS_PER_TILE;
    const gy = (c[2] + c[3] - (c[0] + c[1])) / 2 / UNITS_PER_TILE;
    const len = Math.hypot(gx, gy, 1);
    const dot = (-gx * light[0] - gy * light[1] + light[2]) / len;
    let shade = 0.48 + 0.6 * Math.max(0, dot);
    /*
     * A tile of ore is stone with a wash of the metal through it, not the
     * metal. The seam itself is drawn on top of this as a shape (`seam.ts`);
     * what the wash is for is the other end of the telescope -- from far
     * enough out that the shapes are two pixels, a prospector still has to be
     * able to see that there is something in that hillside.
     */
    const base =
      ground === TileType.Rock
        ? oreWash(ROCK_VARIANTS[w.rockFace(x, y)].color, this.oreBuf)
        : ground === TileType.Slabs
          ? SLAB_VARIANTS[slabVariant(data)].color
          : def.color;
    let r = base[0];
    let g = base[1];
    let b = base[2];
    /*
     * Sand with the sea against it is damp sand. Four reads, and only on the
     * tiles that are actually sand, so the whole of the beach costs what one
     * tile of it used to; and it is worked out here rather than drawn on top
     * because it belongs to the tile's colour, and so it is cached with the
     * colour and thrown away with it when the land moves.
     */
    if (ground === TileType.Sand) {
      let wet = false;
      for (let e = 0; e < 4 && !wet; e++) {
        const nx = x + (e === 1 ? 1 : e === 3 ? -1 : 0);
        const ny = y + (e === 0 ? -1 : e === 2 ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
        if (w.heightAt(nx + 0.5, ny + 0.5) < 0) wet = true;
      }
      if (wet) {
        r = DAMP_SAND[0];
        g = DAMP_SAND[1];
        b = DAMP_SAND[2];
      }
    }
    // Steep ground wears through to the rock under it. A cliff face used to be
    // whatever was growing on the top of it, stretched down the drop, which is
    // the one thing a cliff never looks like.
    if (ground !== TileType.Rock) {
      const bare = bareRock(Math.hypot(gx, gy));
      if (bare > 0) {
        const k = bare * 0.88;
        const face = ROCK_VARIANTS[0].color;
        const grain = 0.88 + hash2(x, y, 23) * 0.26;
        r += (face[0] * grain - r) * k;
        g += (face[1] * grain - g) * k;
        b += (face[2] * grain - b) * k;
      }
    }
    const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
    /*
     * A nudge of brightness per tile, so a wide sheet of one ground is not
     * one flat sheet of colour. The flat grounds get none of it: they are
     * meant to read as one colour with things standing on them, and a tenth
     * either way per tile came out as a chequerboard -- every tile a slightly
     * different green, which is the one thing a meadow never looks like, and
     * a cliff of it looked like a wall somebody had patched.
     */
    if (avg >= 0) shade *= 1 + (hash2(x, y, 9) - 0.5) * (FLAT.has(ground) ? 0 : 0.1);
    else {
      const deep = -avg;
      /*
       * How far under this is, as a share of the depth by which the water
       * has finished taking the ground over: nought at the line and one at
       * `WATER_LIT`.
       */
      const under = Math.min(1, deep / WATER_LIT);
      const keep = 1 - under;
      /*
       * Water takes the red out of what is under it first and the blue out
       * of it last, which is a good half of what makes a sea floor read as
       * being under a sea rather than as a differently coloured field.
       *
       * It used to go on whole the moment a tile's four corners averaged
       * below zero -- twenty-eight per cent of the red gone in one step, at
       * no depth at all. A tile the waterline runs through is one tile with
       * one colour, and the water polygon covers only the part of it that is
       * actually below the line: so the part above the line came out as dry
       * sand painted as though it were drowned, and every beach on the
       * island had a band of grey-green a tile wide along the top of the
       * water. It comes in with depth now, from nothing. The water drawn
       * over the top is already more than half opaque at the line itself
       * (`waterVeil`), so the shallows have never needed this to look wet,
       * and by the time it is fully on there is not much of the floor left
       * showing through to cast.
       */
      const fade = Math.max(0.3, 1 - deep / 80);
      r *= (keep + under * 0.72) * fade;
      g *= (keep + under * 0.86) * fade;
      b *= (keep + under * 0.95) * fade;
      // And the slope lighting fades out over the same depth: see
      // `WATER_LIT`. What looked like the depth ramp banding was the sea
      // floor being faceted like a hillside and showing through water that
      // is not opaque.
      shade = 1 + (shade - 1) * keep;
    }
    /*
     * Ground you are only remembering keeps almost none of its own colour.
     * Colour is what an eye is getting *now*; a memory of a place is the shape
     * of it and how light it was, which is a grey. Done here rather than as
     * another wash because a wash over green is still green, and because both
     * of these are cached per tile — it costs nothing after the first frame.
     */
    if (!lit) {
      const grey = 0.299 * r + 0.587 * g + 0.114 * b;
      r = grey + (r - grey) * MEMORY_SATURATION;
      g = grey + (g - grey) * MEMORY_SATURATION;
      b = grey + (b - grey) * MEMORY_SATURATION;
    }
    return `rgb(${clamp255(r * shade)},${clamp255(g * shade)},${clamp255(b * shade)})`;
  }

  /** A tile's colour as drawn, worked out once and kept until something changes it. */
  private groundColor(x: number, y: number, lit: boolean, sun: [number, number, number]): string {
    const cache = lit ? this.colors : this.memColors;
    let color = cache.get(x, y);
    if (!color) {
      const w = this.game.world;
      color = this.computeColor(x, y, w.viewTile(x, y, lit), w.viewData(x, y, lit), sun, lit);
      cache.set(x, y, color);
    }
    return color;
  }

  /** Scratch for `groundAt`: four neighbours, and no array made per tile. */
  private nearBuf: TileType[] = [];

  /**
   * What ground a tile is, with a wooded one resolved to what it stands in.
   *
   * A tile of Tree, Bush or Stump is a soil somebody's wood is growing out
   * of rather than a soil of its own, so it takes the commonest ground among
   * its four neighbours -- and grass where the wood is thick enough that all
   * four of them are trees too, which is a place nobody can see the ground
   * anyway.
   *
   * It is a function of the two coordinates and nothing else, so the tile on
   * either side of a join works out the same pair of answers and the two of
   * them agree about which way the join runs.
   */
  private groundAt(x: number, y: number, lit: boolean): TileType {
    const world = this.game.world;
    const t = world.viewTile(x, y, lit) as TileType;
    if (!COVERED.has(t)) return t;
    // A tree takes the ground it stands on and weed takes the floor it grows
    // out of, so neither of them is allowed to take the other's.
    const under = world.heightAt(x + 0.5, y + 0.5) < 0;
    const near = this.nearBuf;
    near.length = 0;
    for (let e = 0; e < 4; e++) {
      const nx = x + (e === 1 ? 1 : e === 3 ? -1 : 0);
      const ny = y + (e === 0 ? -1 : e === 2 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
      const n = world.viewTile(nx, ny, lit) as TileType;
      // Not another one of these, and not a road.
      if (COVERED.has(n) || PAVED.has(n)) continue;
      if ((world.heightAt(nx + 0.5, ny + 0.5) < 0) !== under) continue;
      near.push(n);
    }
    // Thick enough wood, or thick enough weed, that all four neighbours were
    // the same as this one: the field it would be, or the shelf it grows on.
    let best: TileType = under ? TileType.Sand : TileType.Grass;
    let most = 0;
    for (const u of near) {
      let n = 0;
      for (const v of near) if (v === u) n++;
      if (n > most || (n === most && u < best)) { best = u; most = n; }
    }
    return best;
  }

  /**
   * The greener ground spilling over the edge of the barer one beside it.
   *
   * This is the only join there is now. Every pair of unlike grounds used to
   * get a wedge of each other's colour washed over the half of the tile
   * nearest the line between them -- which read as a smear where two fields
   * met, and, round any tile that was a different ground only because
   * something was growing on it, as a box of shadow four wedges wide sitting
   * on the meadow. A field against a path somebody wore across it does not
   * fade into it: it thins out and gives up in lumps, and that ragged edge is
   * most of what makes the path read as walked rather than as painted on. So
   * every join is that now, and `growth` says which of the two runs over.
   *
   * The barer tile draws it, into itself, clipped to itself. Which ends of
   * the edge are which swaps at every other quarter turn, so the run is taken
   * in the order the *world's* corners come in rather than the screen's, or
   * the ruffle reads one way round at one rotation and the other at the next
   * and the whole path crawls as the camera comes about.
   */
  /** One tile's ruffled edges, and one colour's worth of them: reused, never remade. */
  private hemBuf: number[] = [];
  private hemRun: number[] = [];

  private swardEdges(ctx: CanvasRenderingContext2D, V: View, x: number, y: number, pts: Float64Array, zoom: number, lit: boolean): boolean {
    const world = this.game.world;
    const co = V.corners;
    const mine = world.heightAt(x + 0.5, y + 0.5);
    const grew = growth(this.groundAt(x, y, lit));
    const buf = this.hemBuf;
    buf.length = 0;
    for (let e = 0; e < 4; e++) {
      const nx = x + V.edges[e][0];
      const ny = y + V.edges[e][1];
      if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
      const theirs = this.groundAt(nx, ny, lit);
      if (growth(theirs) <= grew) continue;
      const over = world.heightAt(nx + 0.5, ny + 0.5);
      /*
       * And only where the two are at much the same height. A field spills
       * over the lip of a path it is level with; it does not spill over the
       * top of a cliff it is standing twenty feet above, and a ruffle drawn
       * along that edge is a fringe of grass growing out of thin air.
       */
      if (Math.abs(over - mine) > UNITS_PER_TILE * 0.35) continue;
      if (over < 0) continue;
      const f = (e + 1) & 3;
      const a = co[e], b = co[f];
      buf.push(
        pts[e * 2], pts[e * 2 + 1], pts[f * 2], pts[f * 2 + 1],
        // Which ends of the edge are which swaps at every other quarter turn,
        // so the run is taken in the order the *world's* corners come in
        // rather than the screen's, or the ruffle reads one way round at one
        // rotation and the other at the next and the whole path crawls as the
        // camera comes about.
        a[0] * 2 + a[1] > b[0] * 2 + b[1] ? 1 : 0,
        // Off the pair of tiles, so the same join is the same ruffle whatever
        // the camera is doing and whichever of the two is being drawn.
        Math.floor(hash2(x + nx, y + ny, 907) * 0x7fffffff),
        theirs,
      );
    }
    if (!buf.length) return false;
    const cx = (pts[0] + pts[2] + pts[4] + pts[6]) / 4;
    const cy = (pts[1] + pts[3] + pts[5] + pts[7]) / 4;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let k = 1; k < 4; k++) ctx.lineTo(pts[k * 2], pts[k * 2 + 1]);
    ctx.closePath();
    ctx.clip();
    /*
     * A colour at a time. Two sides of a tile with the same field over them
     * go into one path and one set of fills, which is most of what a corner
     * of country where three grounds meet used to cost.
     */
    const run = this.hemRun;
    for (let i = 0; i < buf.length; i += 7) {
      const kind = buf[i + 6];
      let first = true;
      for (let j = 0; j < i; j += 7) if (buf[j + 6] === kind) { first = false; break; }
      if (!first) continue;
      run.length = 0;
      for (let j = i; j < buf.length; j += 7) {
        if (buf[j + 6] !== kind) continue;
        run.push(buf[j], buf[j + 1], buf[j + 2], buf[j + 3], buf[j + 4], buf[j + 5]);
      }
      // In the field's own colour, not the meadow's: a steppe runs out onto a
      // track looking like steppe.
      ruffle(ctx, hemOf(kind as TileType), run, cx, cy, zoom);
    }
    ctx.restore();
    return true;
  }

  /**
   * A square picture laid over a tile, in two triangles.
   *
   * A tile whose four corners stand at four heights is not a parallelogram, so
   * the one transform a wall's face is blitted with will not do: it is cut on
   * the diagonal and each half taken across on its own, which is what every
   * renderer does with a bent quad. The two halves are clipped to exactly the
   * same diagonal and not a pixel over it: a blend laid on twice is not the
   * same as a blend laid on once, so a sliver of overlap where they meet
   * comes out as a bright line straight across every tile in the road.
   *
   * `rot` says which of the four screen corners holds the tile's own (0, 0).
   * The picture is hung off the world's axes rather than off the screen's, so
   * a road holds still when the camera turns and a tile butts its neighbour
   * whichever way round the two of them have come out.
   */
  private laidOver(img: HTMLCanvasElement, pts: Float64Array, rot: number, mode: GlobalCompositeOperation): void {
    const ctx = this.canvas.ctx;
    const qx: number[] = [];
    const qy: number[] = [];
    for (let i = 0; i < 4; i++) {
      const k = (rot + i) & 3;
      qx.push(pts[k * 2]);
      qy.push(pts[k * 2 + 1]);
    }
    /*
     * Squeezed to the size it is going to be drawn at, once per zoom, so the
     * blit is one device pixel to one. A picture taken down by three as it
     * goes on costs several times what the same picture costs at its own
     * size, and over a field of open country that alone was a third of the
     * frame.
     */
    const ready = this.atSize(img, Math.hypot(qx[1] - qx[0], qy[1] - qy[0]), 0);
    const s = ready.width;
    ctx.save();
    ctx.globalCompositeOperation = mode;
    /*
     * A tile whose four corners lie in a plane comes out on screen as a
     * parallelogram, and a parallelogram is one transform with no clipping at
     * all -- the picture is square, so its own four corners land on the
     * tile's. That is the ordinary case: ground is mostly smooth, and it is
     * the difference between two clipped blits a tile and one bare one, which
     * over a field is the difference between sixty frames a second and
     * fifteen. Anything genuinely bowed falls through to the two halves.
     */
    const bow = Math.abs(qx[0] - qx[1] + qx[2] - qx[3]) + Math.abs(qy[0] - qy[1] + qy[2] - qy[3]);
    if (bow < 0.7) {
      ctx.transform((qx[1] - qx[0]) / s, (qy[1] - qy[0]) / s, (qx[3] - qx[0]) / s, (qy[3] - qy[0]) / s, qx[0], qy[0]);
      ctx.drawImage(ready, 0, 0);
      ctx.restore();
      return;
    }
    const half = (i0: number, i1: number, i2: number, a: number, b: number, c: number, d: number): void => {
      ctx.save();
      ctx.beginPath();
      for (const i of [i0, i1, i2]) ctx.lineTo(qx[i], qy[i]);
      ctx.closePath();
      ctx.clip();
      ctx.transform(a, b, c, d, qx[i0], qy[i0]);
      ctx.drawImage(ready, 0, 0);
      ctx.restore();
    };
    // (0,0) (s,0) (s,s), then (0,0) (s,s) (0,s).
    half(0, 1, 2, (qx[1] - qx[0]) / s, (qy[1] - qy[0]) / s, (qx[2] - qx[1]) / s, (qy[2] - qy[1]) / s);
    half(0, 2, 3, (qx[2] - qx[3]) / s, (qy[2] - qy[3]) / s, (qx[3] - qx[0]) / s, (qy[3] - qy[0]) / s);
    ctx.restore();
  }

  /**
   * What a paved tile is paved with.
   *
   * Asked for after the walls: the same treatment for floors, pavements and
   * roofs. A pavement is the easiest of the three to get wrong, because the
   * ground it sits in is drawn as one flat colour a tile and paving drawn that
   * way is a coloured-in square — you cannot tell a road from a lawn that
   * happens to be grey.
   *
   * So the stones are painted, cobbles and slabs, and laid on in light and
   * shade rather than in a colour of their own: the light, the weather and
   * the cold wash over remembered land are all already in the colour
   * underneath, and none of them has to be worked out twice. Slabs were a
   * grid of squares a shade lighter or darker than each other, which is a
   * chequer; they are cut stones now, their arrises lit, their faces the
   * stone's -- see `slabbing`. Every picture comes off the tile's own
   * coordinates, so a road holds still while you walk down it.
   */
  private paving(t: TileType, x: number, y: number, data: number, pts: Float64Array, rot: number): void {
    if (t === TileType.Cobblestone) {
      /*
       * A road is a picture, not a pattern. It was six by six rectangles with
       * every other row shoved half a stone over, tinted light and dark --
       * which says the right thing about how setts are laid and nothing about
       * what a sett is. The picture is painted in light and shade and laid on
       * with `overlay`, so the tile keeps its own colour, its sun and its fog
       * and the road is a shape cut in them.
       */
      const cob = cobble();
      const q = cob.paveN;
      const road = cob.pave();
      this.laidOver(road[(((y % q) + q) % q) * q + (((x % q) + q) % q)], pts, rot, 'overlay');
      return;
    }
    // Slabs, laid as their stone splits and in the size it comes off the block in.
    const v = slabVariant(data);
    const tiles = slabbing(v, SLAB_VARIANTS[v].courses);
    const q = FLOOR_TILES;
    this.laidOver(tiles[(((y % q) + q) % q) * q + (((x % q) + q) % q)], pts, rot, 'overlay');
  }

  /**
   * What grows on a tile of grass, which is the whole of what grass has on it.
   *
   * The field itself is flat colour and stays that way. It carried a texture
   * for a while -- a sward of soft light and shade laid over the lot of it --
   * and flat is better: the ground the references are drawn on is one green
   * with the detail sitting on it in pieces you can count, and a wash over
   * the whole field puts the ground into the same range of light and dark as
   * the things standing in it.
   *
   * Only on ground you can actually see: remembered ground keeps its shape
   * and its trees and nothing else, and a clump you are remembering is not a
   * clump you are looking at.
   */
  private strewTile(type: TileType, x: number, y: number, pts: Float64Array, rot: number, zoom: number, lit: boolean): void {
    const ctx = this.canvas.ctx;
    const m = strew(type);
    if (!lit) return;
    // The tile's own corners, so a daisy stays on the same square foot of
    // ground when the camera comes round rather than jumping a corner.
    const A = (rot & 3) * 2, B = ((rot + 1) & 3) * 2, C = ((rot + 2) & 3) * 2, D = ((rot + 3) & 3) * 2;
    const atX = (u: number, v: number): number =>
      (pts[A] * (1 - u) + pts[B] * u) * (1 - v) + (pts[D] * (1 - u) + pts[C] * u) * v;
    const atY = (u: number, v: number): number =>
      (pts[A + 1] * (1 - u) + pts[B + 1] * u) * (1 - v) + (pts[D + 1] * (1 - u) + pts[C + 1] * u) * v;
    const look = m.looks[strewLook(m.cuts, x, y)];
    const lo = look.blobN[0];
    const n = lo + Math.floor(hash2(x, y, 301) * (look.blobN[1] - lo + 1));
    // Where the first one stands. The rest are placed off it rather than off
    // the tile, so a look that says its clumps are crowded together grows
    // them crowded together instead of one in each far corner.
    const u0 = 0.16 + hash2(x, y, 311) * 0.68;
    const v0 = 0.16 + hash2(x, y, 312) * 0.68;
    const crowd = look.spread < CROWD;
    for (let i = 0; i < n; i++) {
      const pick = look.slots ? look.slots[Math.min(i, look.slots.length - 1)] : look.blobs;
      const b = m.blobs[pick[Math.floor(hash2(x, y, 310 + i * 3) * pick.length) % pick.length]];
      let u = u0, v = v0;
      if (i) {
        u = u0 + (hash2(x, y, 311 + i * 3) - 0.5) * 2 * look.spread;
        // In a crowd the later ones come down the screen as well as across,
        // so the one drawn over the top of another is the one in front of it.
        v = crowd
          ? v0 + hash2(x, y, 312 + i * 3) * look.spread
          : v0 + (hash2(x, y, 312 + i * 3) - 0.5) * 2 * look.spread;
        u = Math.min(0.9, Math.max(0.1, u));
        v = Math.min(0.9, Math.max(0.1, v));
      }
      const ready = this.atSize(b.canvas, b.w * zoom, b.h * zoom);
      ctx.drawImage(ready, atX(u, v) - b.ax * zoom, atY(u, v) - b.ay * zoom, b.w * zoom, b.h * zoom);
    }
  }


  /**
   * The ore's colour washed into the stone, which is what a tile of it fills
   * with. Into a buffer, because this is worked out for every rock tile on the
   * screen every time its colour is: a new array apiece was three hundred of
   * them a frame for a number that is the same three numbers each time.
   */
  private oreBuf: [number, number, number] = [0, 0, 0];

  /**
   * Grain on the ground, close up. From a distance a tile is a flat lozenge of
   * colour and that is the right amount of detail for it; at the zoom where
   * you are actually standing on a thing, flat colour reads as paper. Five
   * specks per tile, placed from the tile's own coordinates so they never
   * crawl, laid into a path shared by the whole diagonal.
   *
   * The specks are plain black and white at low alpha rather than a shade of
   * the ground, which means no colour has to be worked out per tile and any
   * ground — sand, rock, a cliff face, a ploughed field — gets grain that
   * suits it.
   */
  private addGrain(x: number, y: number, pts: Float64Array, zoom: number): void {
    const size = Math.max(1, 2.6 * zoom);
    for (let i = 0; i < GRAIN_SPECKS; i++) {
      const a = hash2(x, y, 40 + i * 3);
      const b = hash2(x, y, 41 + i * 3);
      // Bilinear across the quad, so a speck sits on the ground however the
      // corners are pulled about.
      const top = 1 - b;
      const sx = (pts[0] * (1 - a) + pts[2] * a) * top + (pts[6] * (1 - a) + pts[4] * a) * b;
      const sy = (pts[1] * (1 - a) + pts[3] * a) * top + (pts[7] * (1 - a) + pts[5] * a) * b;
      if (hash2(x, y, 42 + i * 3) < 0.5) {
        if (this.grainN + 3 > this.grainDark.length) continue;
        this.grainDark[this.grainN++] = sx - size * 0.5;
        this.grainDark[this.grainN++] = sy - size * 0.5;
        this.grainDark[this.grainN++] = size;
      } else {
        if (this.grainM + 3 > this.grainPale.length) continue;
        this.grainPale[this.grainM++] = sx - size * 0.5;
        this.grainPale[this.grainM++] = sy - size * 0.5;
        this.grainPale[this.grainM++] = size;
      }
    }
  }

  /** Lay a row's worth of speckles down in one fill. */
  private specks(ctx: CanvasRenderingContext2D, buf: Float32Array, n: number, ink: string): void {
    if (!n) return;
    ctx.beginPath();
    for (let i = 0; i < n; i += 3) ctx.rect(buf[i], buf[i + 1], buf[i + 2], buf[i + 2]);
    ctx.fillStyle = ink;
    ctx.fill();
  }

  render(dt: number): void {
    this.time += dt;
    this.frameDt = dt;
    this.roomTiles = this.myRoom();
    this.shades.clear();
    // Other people are walked along between one word about them and the next,
    // on the drawing clock rather than the world's: it is smoothing, not
    // simulation, and should stay smooth even when nothing is being simulated.
    if (this.game.roster.size) this.game.roster.ease(dt);
    const canvas = this.canvas;
    const ctx = canvas.ctx;
    const W = canvas.width;
    const H = canvas.height;
    const cam = this.camera;
    const world = this.game.world;
    const zoom = cam.zoom;
    // How sharp the sprites want to be, which is a question about how close
    // the camera is. Nothing happens here unless the answer has changed.
    spriteScaleFor(zoom);
    cam.setViewport(W, H);
    canvas.begin();
    // Past the edge of the island is sky and distance rather than a hole. It
    // takes the hour's colour, so the horizon at dusk is the dusk's.
    const hour0 = this.game.hourOfDay();
    const sky = skyAt(this.game.darkness(), Math.max(0, 1 - Math.min(Math.abs(hour0 - DAWN), Math.abs(hour0 - DUSK)) / 2.6));
    this.sky = sky;
    const voidInk = css(unknownInk(sky));
    const back = ctx.createLinearGradient(0, 0, 0, H);
    back.addColorStop(0, css(sky.top));
    back.addColorStop(0.62, css(sky.far));
    back.addColorStop(1, css(sky.far));
    ctx.fillStyle = back;
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';

    // The ground is walked in the lattice of whichever viewpoint we are at:
    // `d` down the screen a line at a time, `e` along it. The lattice is a
    // root-two step coarser at the diagonals, where a tile is a rectangle
    // rather than a diamond, and denser cells would draw each one twice.
    const V = cam.view;
    const stepW = HALF_W * V.unit;
    const stepH = HALF_H * V.unit;
    const b = cam.isoBounds();
    const eMin = Math.floor(b.left / stepW) - 1;
    const eMax = Math.ceil(b.right / stepW) + 1;
    const eStep = V.staggered ? 2 : 1;
    const dLo = Math.floor((b.top + world.minHeight * HEIGHT_SCALE) / stepH) - 2;
    const dHi = Math.ceil((b.bottom + world.maxHeight * HEIGHT_SCALE) / stepH) + 1;
    this.queueRoofs(V, dLo, dHi);
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
    // Which way the wind pushes on screen. Everything rooted leans this way
    // and smoke drifts this way, so it is worked out once for the frame.
    {
      const lu = cam.rotateX(this.surf.dirX, this.surf.dirY);
      const lv = cam.rotateY(this.surf.dirX, this.surf.dirY);
      const lx = (lu - lv) * HALF_W;
      const ly = (lu + lv) * HALF_H;
      const ll = Math.hypot(lx, ly) || 1;
      this.lean = { x: lx / ll, y: ly / ll, force: wind.force };
    }
    this.markWakes();
    this.markDust();
    // A tile last seen a moment ago has a new memory; throw away the colour
    // that was worked out from the old one.
    if (vision.revision !== this.lastVision) {
      this.lastVision = vision.revision;
      const box = vision.dirty;
      if (box) {
        this.memColors.forgetBox(Math.max(0, box.x0), Math.max(0, box.y0),
          Math.min(world.w - 1, box.x1), Math.min(world.h - 1, box.y1));
      } else this.memColors.clear();
    }
    // The sun moves through the day, so the ground has to be shaded again as it
    // goes. It is cut into steps rather than recomputed every frame: a repaint
    // a few times an in-game hour is nothing, one every frame is not.
    const hour = this.game.hourOfDay();
    const sun = sunAt(hour);
    this.sunNow = sun;
    const sunStep = Math.floor((hour / 24) * SUN_STEPS);
    if (sunStep !== this.lastSun) {
      this.lastSun = sunStep;
      this.colors.clear();
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
    // Grain is only worth drawing once a tile is big enough to hold it, and
    // once few enough tiles are on screen for it to be cheap.
    const grain = zoom >= 1.25;
    // Paving is laid rather than poured, and from close enough you can see
    // every joint in it. Cheaper than grain and worth more, so it starts
    // sooner.
    /*
     * One squeeze per picture per zoom, rather than one per thing drawn --
     * emptied here rather than where the entities are drawn, because the
     * ground now uses it too and the ground goes first.
     */
    if (zoom !== this.scaledAt) {
      this.scaledAt = zoom;
      this.scaled.clear();
      this.scaledSizes.clear();
    }
    const paved = zoom >= 0.75;
    /*
     * A seam is shapes in the stone, and below this a band of it is a few
     * pixels wide: the wash of the metal through the tile's own colour is what
     * says there is ore in that hillside from further out than this.
     *
     * It is also where the ground pass is dearest. Every band is pixels filled
     * two or three times over, and a hillside that is ore the whole way across
     * -- which takes some doing, but a miner can make one -- costs twenty-odd
     * milliseconds a frame at zoom one against one and a half for the rich
     * hillside that actually occurs. Below here it costs nothing at all.
     */
    const seamed = zoom >= 0.9;
    // Grass is flat colour with things growing in it, and a clump of grass
    // painted at a quarter of a tile to the screen is three pixels of green
    // on green. Below this the field says what it has to say with its colour.
    const grassy = zoom >= MEADOW_FROM;
    // The join between two grounds carries further than the things growing in
    // either of them: see `RUFFLE_FROM`.
    const hemmed = zoom >= RUFFLE_FROM;
    // Close enough to be picking things up rather than looking at the country.
    const player = this.game.player;
    const playerDepth = depthOf(V, player.tileX, player.tileY);
    // Everybody at the helm of a hull somebody else is steering, or aboard one, is drawn with her; see `takeAboard`.
    this.seated.clear();
    for (const f of this.game.furniture.values()) {
      if (f.helm) this.seated.add(f.helm);
      for (const r of f.riders ?? []) this.seated.add(r.who);
    }
    const hw = stepW * zoom;
    const hh = stepH * zoom;
    const hs = HEIGHT_SCALE * zoom;
    // The tile's screen outline and the world corners it hangs on. Both are
    // fixed for the whole frame: the shape of a tile does not change across
    // the island, only where it sits and how far its corners are lifted.
    const off = this.shapeBuf;
    for (let i = 0; i < 4; i++) {
      off[i * 2] = V.shape[i][0] * hw;
      off[i * 2 + 1] = V.shape[i][1] * hh;
    }
    const co = V.corners;
    /*
     * Which of the four screen corners holds the tile's own (0, 0). The view
     * lists them clockwise from whichever is topmost on screen, and that is a
     * different one of the four at each quarter turn; anything hung off the
     * world's axes rather than the screen's needs to know which.
     */
    const paveRot = co.findIndex((cc) => cc[0] === 0 && cc[1] === 0);
    const bottomMargin = 220 * zoom;
    const pts = this.pts;
    const c = this.cornerBuf;
    this.creatureHits.length = 0;
    this.peerHits.length = 0;
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
      this.entN = 0;
      if (grain) {
        this.grainN = 0;
        this.grainM = 0;
      }
      const baseY = (d * stepH - cam.cy) * zoom + H / 2;
      let e = eMin;
      if (V.staggered && ((e + d) & 1) !== 0) e++;
      for (; e <= eMax; e += eStep) {
        const x = V.x[0] + V.x[1] * d + V.x[2] * e;
        const y = V.y[0] + V.y[1] * d + V.y[2] * e;
        if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
        c[0] = world.getHeight(x + co[0][0], y + co[0][1]);
        c[1] = world.getHeight(x + co[1][0], y + co[1][1]);
        c[2] = world.getHeight(x + co[2][0], y + co[2][1]);
        c[3] = world.getHeight(x + co[3][0], y + co[3][1]);
        const baseX = (e * stepW - cam.cx) * zoom + W / 2;
        pts[0] = baseX + off[0];
        pts[1] = baseY + off[1] - c[0] * hs;
        pts[2] = baseX + off[2];
        pts[3] = baseY + off[3] - c[1] * hs;
        pts[4] = baseX + off[4];
        pts[5] = baseY + off[5] - c[2] * hs;
        pts[6] = baseX + off[6];
        pts[7] = baseY + off[7] - c[3] * hs;
        const minY = Math.min(pts[1], pts[3], pts[5], pts[7]);
        const maxY = Math.max(pts[1], pts[3], pts[5], pts[7]);
        if (maxY < 0 || minY > H + bottomMargin) continue;
        this.drawnTiles++;

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
          ctx.fillStyle = voidInk;
          ctx.fill();
          continue;
        }
        const lit = fog === VISIBLE;
        const color = this.groundColor(x, y, lit, sun);
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        ctx.lineTo(pts[2], pts[3]);
        ctx.lineTo(pts[4], pts[5]);
        ctx.lineTo(pts[6], pts[7]);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        const wet = c[0] < 0 || c[1] < 0 || c[2] < 0 || c[3] < 0;
        /*
         * What is on this tile, and what ground it counts as. For a tile of
         * forest those are two different answers: the first is a tree, the
         * second is the field it stands in (see `groundAt`). Everything about
         * the ground asks the second -- whether it is flat, whether it strews,
         * whether it is paved -- because a wood painted as meadow and then
         * given a wood's grain and a wood's tufts is a meadow with a rash on
         * it in the shape of the trees. The sprite is the only thing that
         * wants the first, and it is the whole of what a wooded tile is.
         */
        const here = world.viewTile(x, y, lit) as TileType;
        const t0 = this.groundAt(x, y, lit);
        ctx.strokeStyle = grid && !wet ? GRID_COLOR : color;
        ctx.stroke();
        // Weed on the bottom goes under the water rather than over it.
        if (grassy && wet && DROWNS.has(here)) this.strewTile(here, x, y, pts, paveRot, zoom, lit);
        if (wet) this.drawWater(V, x, y, c, fogged && !lit ? fogPath : undefined);

        // A flat ground gets no speckles. A sward is a flat ground with clumps
        // growing in it, and the speckles are what it had instead of clumps:
        // both at once is mud.
        if (grain && !wet && !FLAT.has(t0)) this.addGrain(x, y, pts, zoom);
        /*
         * And what grows on it. Everything on the ground stops at the
         * waterline except the reeds, which wade: see `WADES`. They are laid
         * after the water is, so they stand up out of it.
         *
         * Weed is the other way about -- it is laid before the water, up with
         * `drawWater` above, because it grows on the bottom. And it is asked
         * for by what the tile *is* rather than by what it counts as: a kelp
         * tile counts as the sand it grows out of, and sand-coloured weed is
         * no weed at all.
         */
        const wades = wet && WADES.has(t0) && (c[0] + c[1] + c[2] + c[3]) / 4 > -WADE_DEPTH;
        if (grassy && (!wet || wades) && STREWN.has(t0)) this.strewTile(t0, x, y, pts, paveRot, zoom, lit);
        /*
         * And where something greener grows beside this, it comes over the
         * edge of it. Paving is left out: a flagstone or a cobble was laid to
         * a line and keeps to it.
         *
         * Most ground has the same ground all round it, and finding that out
         * costs four tile reads and four bounds checks per tile per frame.
         * The answer goes stale exactly when the colour does, so it is kept
         * beside the colour: one means there was nothing growing over this
         * tile and it can be passed over, two means there was.
         */
        if (hemmed && !wet && !PAVED.has(t0)) {
          const seams = lit ? this.colors : this.memColors;
          const known = seams.flag(x, y);
          if (known !== 1) {
            const drew = this.swardEdges(ctx, V, x, y, pts, zoom, lit);
            if (known === 0) seams.setFlag(x, y, drew ? 2 : 1);
          }
        }
        if (paved && !wet && PAVED.has(t0)) this.paving(t0, x, y, world.viewData(x, y, lit), pts, paveRot);
        // And the metal in the stone, where there is any. Plain rock is plain.
        if (seamed && !wet && t0 === TileType.Rock) {
          const kind = world.rockFace(x, y);
          if (kind > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(pts[0], pts[1]);
            for (let k = 1; k < 4; k++) ctx.lineTo(pts[k * 2], pts[k * 2 + 1]);
            ctx.closePath();
            ctx.clip();
            seam(ctx, x, y, ROCK_VARIANTS[kind].color, pts, paveRot, zoom);
            ctx.restore();
          }
        }

        const t = here;
        if (!lit) {
          // Remembered ground keeps its shape and its trees and nothing else:
          // no creatures, no piles, no detail, and a cold wash over the lot.
          if (t === TileType.Tree || t === TileType.Bush || t === TileType.Stump) {
            const data = world.viewData(x, y, false);
            const spr = t === TileType.Tree ? treeSprite(treeSpecies(data), treeVariant(data)) : t === TileType.Bush ? bushSprite(bushSpecies(data)) : stumpSprite(treeSpecies(data));
            const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
            this.take(t === TileType.Tree ? 'tree' : t === TileType.Bush ? 'bush' : 'stump', x, y, baseX, baseY + hh - avg * hs, spr);
          }
          if (this.game.buildings.list.size || this.game.buildings.walls.size) this.drawStructures(x, y, V, d > playerDepth);
          fogPath.moveTo(pts[0], pts[1]);
          fogPath.lineTo(pts[2], pts[3]);
          fogPath.lineTo(pts[4], pts[5]);
          fogPath.lineTo(pts[6], pts[7]);
          fogPath.closePath();
          continue;
        }
        if (t === TileType.Tree || t === TileType.Bush || t === TileType.Stump) {
          const data = world.getData(x, y);
          const spr = t === TileType.Tree ? treeSprite(treeSpecies(data), treeVariant(data)) : t === TileType.Bush ? bushSprite(bushSpecies(data)) : stumpSprite(treeSpecies(data));
          const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
          this.take(t === TileType.Tree ? 'tree' : t === TileType.Bush ? 'bush' : 'stump', x, y, baseX, baseY + hh - avg * hs, spr);
        }
        if (this.game.ground.size && this.game.groundAt(x, y).length) {
          const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
          const pile = this.take('pile', x, y, baseX, baseY + hh - avg * hs, pileSprite());
          // A heap shines for the best thing in it: one fantastic hatchet under
          // a hundred rocks is still a fantastic hatchet lying in the grass.
          let best = 0;
          for (const it of this.game.groundAt(x, y)) if ((it.rare ?? 0) > best) best = it.rare ?? 0;
          if (best) pile.rare = best;
        }
        if (this.game.isToken(x, y)) {
          const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
          this.take('token', x, y, baseX, baseY + hh - avg * hs, tokenSprite());
        }
        if (this.game.crops.size) {
          const crop = this.game.cropAt(x, y);
          if (crop) {
            const def = cropDef(crop.id);
            const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
            this.take('crop', x, y, baseX, baseY + hh - avg * hs,
              cropSprite(crop.id, Math.min(3, crop.stage), def.look, def.colors[0], def.colors[1]));
          }
        }
        /*
         * A bridge is not put down on a tile, it spans one, so it is asked
         * for on its own rather than through the count below.
         */
        if (this.game.bridges.size) {
          const bridge = this.game.bridgeAt(x, y);
          if (bridge) {
            const span = bridge.spans.find((sp) => sp.x === x && sp.y === y);
            const wx = x + 0.5;
            const wy = y + 0.5;
            this.take('deck', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, bridge.height), null).deck =
              { kind: bridge.kind, done: !!span && Object.values(span.needed).every((n) => n <= 0), drop: bridge.height - world.centerHeight(x, y), id: bridge.id };
          }
        }
        /*
         * Everything put down, asked about only where something was put down.
         *
         * These are eight separate indexes and this used to ask all eight
         * about every tile on screen: eight map lookups per tile, and on all
         * but a handful of tiles all eight answers are nothing. One shared
         * count of what stands where — kept by the indexes themselves, so it
         * cannot fall out of step with them — turns that into a single
         * lookup, and the eight are opened only where there is anything in
         * them.
         */
        if (this.game.anythingPlaced(x, y)) {
          for (const sm of this.game.smeltersOnTile(x, y)) {
            const [wx, wy] = smelterCentre(sm);
            const se = this.take('smelter', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), null);
            se.smelter = sm;
            if (sm.rare) se.rare = sm.rare;
          }
          for (const kl of this.game.kilnsOnTile(x, y)) {
            const [wx, wy] = kilnCentre(kl);
            const ke = this.take('kiln', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), null);
            ke.kiln = kl;
            if (kl.rare) ke.rare = kl.rare;
          }
          for (const fu of this.game.furnitureOnTile(x, y)) {
            // A hull somebody else is steering is where their hands are, which is read a dozen times a second; where
            // she was set down is read once.
            const [wx, wy] = fu.helm ? this.game.hullCentre(fu) : furnitureCentre(fu);
            const fe = this.take('furniture', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, this.pieceBase(fu, wx, wy)), null);
            fe.piece = fu;
            if (fu.rare) fe.rare = fu.rare;
            if (fu.helm || fu.riders?.length || player.aboard === fu.id) this.takeAboard(fu, x, y, fe.sx, fe.sy, zoom);
          }
          for (const an of this.game.anvilsOnTile(x, y)) {
            const [wx, wy] = anvilCentre(an);
            const ae = this.take('anvil', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), null);
            ae.anvil = an;
            if (an.rare) ae.rare = an.rare;
          }
          for (const po of this.game.postsOnTile(x, y)) {
            const [wx, wy] = postCentre(po);
            this.take('post', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), null).post = po;
          }
          for (const tr of this.game.trapsOnTile(x, y)) {
            const [wx, wy] = trapCentre(tr);
            this.take('trap', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), null).trap = tr;
          }
          for (const fire of this.game.campfiresOnTile(x, y)) {
            const [wx, wy] = fireCentre(fire);
            this.take('campfire', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), null).fire = fire;
          }
          for (const crate of this.game.cratesOnTile(x, y)) {
            // A crate standing on a rack is drawn by the rack, up on its deck
            // where it actually is. Drawn here as well it would be a second
            // crate on the floor underneath the first.
            if (this.game.rackAt(crate.x, crate.y, crate.sx, crate.sy)) continue;
            const [wx, wy] = crateCentre(crate);
            const ce = this.take('crate', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), crateSprite(crate.kind));
            ce.crateId = crate.id;
            if (crate.rare) ce.rare = crate.rare;
          }
        }
        // Other people on the island stand on tiles like anything else does.
        if (this.game.roster.size) {
          for (const peer of this.game.roster.atTile(x, y)) {
            if (peer.uid && this.seated.has(peer.uid)) continue;
            const [px, py] = this.game.roster.drawnAt(peer);
            this.take('peer', x, y, cam.worldToScreenX(px, py),
              cam.worldToScreenY(px, py, Math.max(world.heightAt(px, py), -4) + peer.level * WALL_HEIGHT), null).peer = peer;
          }
        }
        if (this.game.creatures.list.size) {
          // Anything standing on a tile with a deck or a slab over it stands on that.
          const deckHere = this.game.laidOver(x, y);
          for (const cr of this.game.creatures.atTile(x, y)) {
            // One shut in a crate is drawn in the crate, by the crate.
            if (cr.mode === 'stored') continue;
            this.take('creature', x, y, cam.worldToScreenX(cr.x, cr.y),
              cam.worldToScreenY(cr.x, cr.y, deckHere ?? Math.max(world.heightAt(cr.x, cr.y), -4)), null).creature = cr;
          }
        }
        if (this.game.foundations.size) this.drawFoundation(x, y, lit);
        if (this.game.buildings.list.size || this.game.buildings.walls.size) this.drawStructures(x, y, V, d > playerDepth);
      }

      if (d === playerDepth && player.aboard === null) {
        // On a bridge you stand on the deck, not in whatever is under it.
        // On the deck unless you are in a hull passing under it.
        const deck = this.game.afloat() ? null : this.game.laidOver(player.tileX, player.tileY);
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
        const sy = drivenBy || up ? cam.worldToScreenY(vx, vy, drivenBy ? this.pieceBase(drivenBy, vx, vy) : world.heightAt(vx, vy)) + 0.01 : cam.worldToScreenY(player.x, player.y, ph);
        const pe = this.take('player', player.tileX, player.tileY, cam.worldToScreenX(vx, vy), sy, null);
        pe.lift = this.driverSeat() * zoom;
        // At a helm on a deck of its own the driver stands there, not in her middle.
        if (drivenBy && furnitureDef(drivenBy.kind).boat?.helm) this.onDeck(pe, drivenBy, this.game.helmSpot(drivenBy), pe.lift, true);
      }
      if (grain) {
        this.specks(ctx, this.grainDark, this.grainN, 'rgba(0,0,0,0.095)');
        this.specks(ctx, this.grainPale, this.grainM, 'rgba(255,255,255,0.07)');
      }
      // The roofs of the buildings whose last walls this line drew, before
      // anything standing in front of them.
      const roofs = this.roofQueue.get(d);
      if (roofs) for (const bb of roofs) this.drawPitchedRoof(bb);
      if (this.ents.length) this.drawEntities(ctx, zoom);
    }
    // The surface and then what crossed it, both clipped to the water, so
    // neither washes up over a beach standing in front of them.
    this.drawSwell(ctx, zoom);
    this.drawWakes(ctx, zoom);
    this.drawAir(ctx, zoom);
    this.drawHaze(ctx, zoom);
    this.drawFloaters(ctx, zoom);

    // One pass for all of it, so a remembered wood goes cold with its ground.
    if (fogged) {
      ctx.fillStyle = FOG_COLOR;
      ctx.fill(fogPath);
    }

    this.drawOverlays(ctx, zoom);
  }

  /**
   * The height a piece stands at: the ground under it, or for a hull the
   * water she floats on. A boat is drawn from her waterline up, so she sits
   * on the surface however deep it is under her rather than on the bottom.
   */
  /**
   * The people on a hull: whoever else has her helm and whoever is aboard as a
   * passenger, us among them. Each sorts a hair after her, so her deck is never
   * drawn over them, and is drawn at their own place on it, lifted to it: the
   * helm to `seat`, sat in her middle or on their feet on a deck of its own,
   * and the passengers on their feet at her waist.
   */
  private readonly seated = new Set<string>();
  private takeAboard(f: PlacedFurniture, x: number, y: number, sx: number, sy: number, zoom: number): void {
    const boat = furnitureDef(f.kind).boat;
    if (!boat) return;
    const waist = boat.waist ?? boat.seat;
    let k = 1;
    const aboard = (uid: string, at: (peer: Peer) => [number, number], deck: number, standing: boolean): void => {
      const peer = this.game.roster.list().find((p) => p.uid === uid);
      if (!peer) return;
      const e = this.take('peer', x, y, sx, sy + 0.01 * k++, null);
      e.peer = peer;
      this.onDeck(e, f, at(peer), deck * zoom, standing);
    };
    if (f.helm) aboard(f.helm, () => this.game.helmSpot(f), boat.seat, !!boat.helm);
    const me = this.game.player;
    if (me.aboard === f.id) this.onDeck(this.take('player', x, y, sx, sy + 0.01 * k++, null), f, [me.x, me.y], waist * zoom, true);
    for (const r of f.riders ?? []) aboard(r.who, (peer) => this.game.roster.drawnAt(peer), waist, true);
  }

  /** Somebody on `f`, drawn at `wx`, `wy` on her rather than where they sort, `lift` up. */
  private onDeck(e: Entity, f: PlacedFurniture, [wx, wy]: [number, number], lift: number, standing: boolean): void {
    const cam = this.camera;
    e.drawDx = cam.worldToScreenX(wx, wy) - e.sx;
    e.drawDy = cam.worldToScreenY(wx, wy, this.pieceBase(f, wx, wy)) - e.sy;
    e.lift = lift;
    e.standing = standing;
  }

  private pieceBase(f: { kind: string }, wx: number, wy: number): number {
    const h = this.game.world.heightAt(wx, wy);
    return furnitureDef(f.kind).boat ? Math.max(h, 0) : h;
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

  /**
   * The scratch one entity is drawn on when it has to be tinted whole. Tinting
   * with a canvas filter costs per drawing operation, and a wildermon is forty
   * of them; on the scratch it is one. It is kept between frames and only
   * resized when the zoom outgrows it.
   */
  private tintPad: HTMLCanvasElement | null = null;
  private tintCtx: CanvasRenderingContext2D | null = null;

  private scratch(zoom: number): { pad: HTMLCanvasElement; g: CanvasRenderingContext2D; ox: number; oy: number } {
    const side = Math.ceil(124 * Math.max(1, zoom));
    if (!this.tintPad || this.tintPad.width < side) {
      this.tintPad = document.createElement('canvas');
      this.tintPad.width = side;
      this.tintPad.height = side;
      this.tintCtx = this.tintPad.getContext('2d');
    }
    const g = this.tintCtx as CanvasRenderingContext2D;
    g.clearRect(0, 0, this.tintPad.width, this.tintPad.height);
    return { pad: this.tintPad, g, ox: this.tintPad.width / 2, oy: this.tintPad.height * 0.78 };
  }

  /**
   * A flat stamp of whatever was last drawn on the scratch: its silhouette,
   * in one colour. `source-atop` paints only where something is already
   * there, so the shape comes out of the drawing itself and nothing has to
   * know what shape a rabba is.
   */
  private stamp(colour: string): void {
    const pad = this.tintPad as HTMLCanvasElement;
    const g = this.tintCtx as CanvasRenderingContext2D;
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = colour;
    g.fillRect(0, 0, pad.width, pad.height);
    g.globalCompositeOperation = 'source-over';
  }

  /**
   * Draw one thing, plainly or lit up.
   *
   * A canvas filter would do both of these in a line, and costs per drawing
   * operation rather than per thing — a wildermon is some forty operations, so
   * a dozen of them flashing at once turned a frame into half a second. This
   * does the same work with a silhouette taken off a scratch canvas: white
   * over the top for a blow, and stamped eight ways round the outside for the
   * thing under the cursor, which is a real outline rather than a glow round
   * a box.
   */
  private paint(
    ctx: CanvasRenderingContext2D,
    zoom: number,
    effect: 'none' | 'flash' | 'hover',
    power: number,
    sx: number,
    sy: number,
    draw: (g: CanvasRenderingContext2D, px: number, py: number) => void,
  ): void {
    if (effect === 'none') {
      draw(ctx, sx, sy);
      return;
    }
    const { pad, g, ox, oy } = this.scratch(zoom);
    draw(g, ox, oy);
    const left = sx - ox;
    const top = sy - oy;
    if (effect === 'flash') {
      ctx.drawImage(pad, left, top);
      this.stamp('#ffffff');
      ctx.globalAlpha = Math.max(0, Math.min(1, power));
      ctx.drawImage(pad, left, top);
      ctx.globalAlpha = 1;
      return;
    }
    // The outline goes down first and the thing on top of it, so what shows is
    // the part of the ring that sticks out past the edges.
    this.stamp(HOVER_INK);
    const r = Math.max(1.6, 2.1 * zoom);
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.drawImage(pad, left + Math.cos(a) * r, top + Math.sin(a) * r);
    }
    ctx.globalAlpha = 1;
    draw(ctx, sx, sy);
  }

  /**
   * Which of the eight ways something heading (dx, dy) through the world is
   * turned, as the screen sees it.
   *
   * The heading put through the projection rather than the world angle
   * quantised: the projection squashes one axis and not the other, so a figure
   * walking north and one walking east do not leave at the same angle, and the
   * screen is what it is being drawn on.
   */
  private facingOnScreen(dx: number, dy: number, was?: number): number {
    const cam = this.camera;
    const du = cam.rotateX(dx, dy);
    const dv = cam.rotateY(dx, dy);
    return facingOf((du - dv) * HALF_W, (du + dv) * HALF_H, was);
  }

  private drawEntities(ctx: CanvasRenderingContext2D, zoom: number): void {
    const ents = this.ents;
    // Within a diagonal, whatever stands lower on screen is nearer the viewer.
    if (ents.length > 1) ents.sort((a, b) => a.sy - b.sy || a.sx - b.sx || (a.lift ?? 0) - (b.lift ?? 0));
    const player = this.game.player;
    const cam = this.camera;
    this.playerFacing = this.facingOnScreen(player.dirX, player.dirY, this.playerFacing);
    for (const ent of ents) {
      // Being hit beats being pointed at: a blow should read as a blow even
      // while the cursor is sitting on the thing taking it.
      const hovering = this.isHovered(ent);
      if (ent.kind === 'player') {
        const struck = this.flashOf(player.attackedAt);
        const ex = ent.sx + (ent.drawDx ?? 0), ey = ent.sy + (ent.drawDy ?? 0);
        this.paint(ctx, zoom, struck > 0 ? 'flash' : 'none', struck * 0.75, ex, ey - (ent.lift ?? 0), (g, px, py) =>
          drawPlayer(g, px, py, zoom, {
            id: 'player',
            phase: player.moving ? player.walkPhase : this.time * 6,
            // On a deck it is the hull that is going somewhere, not the feet.
            moving: player.moving && !ent.standing,
            gait: this.gaits.of('player', player.x, player.y, this.frameDt),
            facing: this.playerFacing,
            swimming: player.swimming,
            working: this.game.action?.state === 'performing',
            driving: (ent.lift ?? 0) > 0 && !ent.standing,
            // Dyed cloth or leather on the chest and legs is worn where it shows.
            tunic: dyeOf(this.game.worn('chest'))?.colour,
            trousers: dyeOf(this.game.worn('legs'))?.colour,
            look: player.look,
            // Both clocks here are `performance.now()`: the one the emote was
            // stamped on and the one the frames are drawn on.
            emote: player.emote,
            emoteT: emoteAt(player.emote, player.emoteAt, performance.now() / 1000) ?? undefined,
          }),
        );
        // What this body last said, over its own head. No name drawn under it,
        // so the bubble sits where a peer's name would be.
        const mine = this.game.saidAloud;
        if (mine) this.speechBubble(ctx, zoom, ex, ey - (ent.lift ?? 0) - FIGURE_TOP * zoom, mine.text, mine.at);
        continue;
      }
      if (ent.kind === 'peer' && ent.peer) {
        const peer = ent.peer;
        // Somebody on a deck is drawn at their place on it, lifted to it; see `takeAboard`.
        const ex = ent.sx + (ent.drawDx ?? 0), ey = ent.sy + (ent.drawDy ?? 0) - (ent.lift ?? 0);
        // The same box a creature catches clicks with, because it is the same
        // figure at the same size. Without one, the only thing you could ever
        // do to another person was walk to the tile they were standing on.
        if (peer.uid) {
          this.peerHits.push({ x: ent.x, y: ent.y, left: ex - 10 * zoom, top: ey - (FIGURE_TOP - 2) * zoom, w: 20 * zoom, h: FIGURE_TOP * zoom, peer: peer.uid });
        }
        peer.facing = this.facingOnScreen(peer.dirX, peer.dirY, peer.facing);
        this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ex, ey, (g, px, py) =>
          drawPlayer(g, px, py, zoom, {
            id: 'o' + peer.id,
            phase: peer.moving ? peer.walkPhase : this.time * 6,
            moving: peer.moving && !ent.standing,
            gait: this.gaits.of('o' + peer.id, peer.x, peer.y, this.frameDt),
            facing: peer.facing,
            swimming: peer.swimming,
            working: peer.working,
            driving: (ent.lift ?? 0) > 0 && !ent.standing,
            tunic: peer.tunic,
            trousers: peer.trousers,
            look: peer.look,
            emote: peer.emote,
            emoteT: emoteAt(peer.emote, peer.emoteAt, performance.now() / 1000) ?? undefined,
          }),
        );
        // Somebody else is only somebody else if you can tell which one.
        if (zoom >= 0.5) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          const ty = ey - (FIGURE_TOP + 1) * zoom;
          ctx.strokeStyle = 'rgba(10,10,12,0.85)';
          ctx.lineWidth = 3;
          ctx.font = `${Math.round(11 * zoom)}px system-ui, sans-serif`;
          ctx.strokeText(peer.name, ex, ty);
          ctx.fillStyle = '#cfe6ff';
          ctx.fillText(peer.name, ex, ty);
          /*
           * And what they are at, over the name.
           *
           * The figure already bends over when somebody is working, which says
           * that they are busy and nothing about what at — so a yard with four
           * people in it was four people bending over. The id crosses the wire
           * and the words are looked up here, out of the same table this
           * browser names its own actions from: an id we have never heard of
           * draws nothing rather than drawing whatever it says.
           *
           * Smaller and dimmer than the name, and above it, so a crowd reads
           * as names with a note over each rather than as two rows of text.
           */
          const doing = peer.act ? ACTION_BY_ID.get(peer.act)?.verb : undefined;
          if (doing) {
            ctx.font = `${Math.round(9 * zoom)}px system-ui, sans-serif`;
            ctx.strokeText(doing, ex, ty - 11 * zoom);
            ctx.fillStyle = 'rgba(207,230,255,0.72)';
            ctx.fillText(doing, ex, ty - 11 * zoom);
          }
          ctx.lineWidth = 1;
          ctx.textAlign = 'left';
        }
        // Over the name and over whatever they are at, so a person talking
        // while they dig reads top to bottom: what they said, what they are
        // doing, who they are.
        if (peer.said) this.speechBubble(ctx, zoom, ex, ey - (FIGURE_TOP + 17) * zoom, peer.said, peer.saidAt ?? 0);
        continue;
      }
      if (ent.kind === 'creature' && ent.creature) {
        const cr = ent.creature;
        const def = SPECIES[cr.species] ?? SPECIES.rabba;
        /*
         * Which of the eight ways it is turned, kept between frames so a walk
         * along a line that happens to sit on a boundary is not spent flicking
         * between two of them. It used to be a sign — the flank, or the flank
         * in the mirror — so a beast heading north and one heading east were
         * the same picture and walking the camera round one turned it on the
         * spot rather than showing you its other end.
         */
        const turned = this.facingOnScreen(cr.dirX, cr.dirY, this.beastFacing.get(cr.id));
        this.beastFacing.set(cr.id, turned);
        const hit = this.flashOf(cr.attackedAt);
        this.paint(ctx, zoom, hit > 0 ? 'flash' : hovering ? 'hover' : 'none', hit * 0.92, ent.sx, ent.sy, (g, px, py) =>
          drawCreature(g, px, py, zoom, {
            species: def.id,
            facing: turned,
            phase: cr.walkPhase,
            moving: cr.moving,
            gait: this.gaits.of('c' + cr.id, cr.x, cr.y, this.frameDt),
            colors: def.variants[cr.variant] ?? def.variants[0],
            health: cr.health / maxHealth(cr, def),
            fleece: cr.fleece,
            scale: ageDef(cr, this.game.time).scale,
            label: cr.mode === 'wild' ? undefined : cr.name,
          }),
        );
        this.creatureHits.push({ x: ent.x, y: ent.y, left: ent.sx - 10 * zoom, top: ent.sy - 22 * zoom, w: 20 * zoom, h: 24 * zoom, creature: cr.id });
        continue;
      }
      if (ent.kind === 'furniture' && ent.piece) {
        const piece = ent.piece;
        // What is being driven or pulled points the way it is going, and stays pointing the way it went when it
        // stops; anything else stands the way it was set.
        if ((piece.driven || piece.hitched) && this.game.player.moving) {
          const step = (Math.PI * 2) / 64;
          this.pieceHeadings.set(piece.id, Math.round(this.game.heading() / step) * step);
        }
        // A hull somebody else is steering, or with people on her deck, points the way the game has her
        // pointing, which is the way they are stood along her.
        if (piece.helm || piece.riders?.length) {
          const step = (Math.PI * 2) / 64;
          this.pieceHeadings.set(piece.id, Math.round(this.game.shipHeading(piece) / step) * step);
        }
        const heading = this.pieceHeadings.get(piece.id);
        const view = heading !== undefined ? headingView(heading, cam.rotation) : pieceView(pieceFacing(piece), cam.rotation);
        const [W, D] = furnitureSpan(piece.kind);
        const h = FURNITURE_HEIGHT[piece.kind] ?? 14;
        /*
         * A creature crate with somebody in it: its far half, the wildermon
         * standing on its floor facing the door, and its near half and lid
         * over them, so it is seen inside rather than on top. Its name stands
         * over the crate the way a companion's stands over its head.
         */
        const inside = piece.kind === CREATURE_CRATE && piece.creature !== undefined ? this.game.creatures.get(piece.creature) : undefined;
        if (inside && inside.mode === 'stored') {
          const def = SPECIES[inside.species] ?? SPECIES.rabba;
          const [fx, fy] = CRATE_DOOR[pieceFacing(piece)];
          const turned = this.facingOnScreen(fx, fy, this.beastFacing.get(inside.id));
          this.beastFacing.set(inside.id, turned);
          const tint = dyeOf(piece) ?? undefined;
          this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ent.sx, ent.sy, (g, px, py) => {
            drawFurniture(g, px, py, zoom, piece.kind, false, tint, 0, view, piece.material);
            drawCreature(g, px, py - CRATE_FLOOR * zoom, zoom, {
              species: def.id,
              facing: turned,
              phase: 0,
              moving: false,
              colors: def.variants[inside.variant] ?? def.variants[0],
              health: 1,
              fleece: inside.fleece,
              scale: ageDef(inside, this.game.time).scale * CRATE_SCALE,
            });
            drawFurniture(g, px, py, zoom, piece.kind, false, tint, 1, view, piece.material);
          });
          if (zoom >= 0.6) {
            ctx.font = `${Math.max(9, 10 * zoom)}px "Segoe UI", system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            ctx.strokeText(inside.name, ent.sx, ent.sy - (h + 4) * zoom);
            ctx.fillStyle = '#e3b657';
            ctx.fillText(inside.name, ent.sx, ent.sy - (h + 4) * zoom);
            ctx.textAlign = 'left';
            ctx.lineWidth = 1;
          }
        } else {
          this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ent.sx, ent.sy, (g, px, py) => drawFurniture(g, px, py, zoom, piece.kind, !!piece.lit, dyeOf(piece) ?? undefined, this.pieceTrim(piece), view, piece.material));
        }
        // A sign is a board made to be read, so what is written on it stands
        // over it in the world rather than waiting in a tooltip.
        if (piece.name && furnitureDef(piece.kind).sign && zoom >= 0.6) {
          const text = piece.name;
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
        this.furnitureHits.push({ x: ent.x, y: ent.y, left: ent.sx - W * zoom, top: ent.sy - (h + D + 2) * zoom, w: W * 2 * zoom, h: (h + D * 2 + 4) * zoom, furniture: piece.id });
        if (shines(ent.rare)) drawShine(ctx, ent.sx, ent.sy, zoom, ent.rare as number, piece.id, this.time, W * 2 * zoom, h * zoom);
      }
      if (ent.kind === 'kiln' && ent.kiln) {
        const kiln = ent.kiln;
        this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ent.sx, ent.sy, (g, px, py) => drawKiln(g, px, py, zoom, kiln.lit, kiln.jobs.length > 0, this.time));
        this.kilnHits.push({ x: ent.x, y: ent.y, left: ent.sx - 26 * zoom, top: ent.sy - 44 * zoom, w: 52 * zoom, h: 48 * zoom, kiln: kiln.id });
        if (shines(ent.rare)) drawShine(ctx, ent.sx, ent.sy, zoom, ent.rare as number, kiln.id, this.time, 52 * zoom, 36 * zoom);
      }
      if (ent.kind === 'smelter' && ent.smelter) {
        const sm = ent.smelter;
        this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ent.sx, ent.sy, (g, px, py) => drawSmelter(g, px, py, zoom, sm.lit, sm.jobs.length > 0, this.time));
        this.smelterHits.push({ x: ent.x, y: ent.y, left: ent.sx - 34 * zoom, top: ent.sy - 58 * zoom, w: 68 * zoom, h: 62 * zoom, smelter: sm.id });
        if (shines(ent.rare)) drawShine(ctx, ent.sx, ent.sy, zoom, ent.rare as number, sm.id, this.time, 68 * zoom, 48 * zoom);
        continue;
      }
      if (ent.kind === 'anvil' && ent.anvil) {
        // An anvil takes the colour of the metal it was cast from.
        const metal = ent.anvil.metal;
        const rock = ROCK_VARIANTS.find((r) => r.yields === `${metal}_ore`);
        const c = rock ? rock.color : ([150, 150, 156] as const);
        const face = `rgb(${c[0]},${c[1]},${c[2]})`;
        const shade = `rgb(${Math.round(c[0] * 0.68)},${Math.round(c[1] * 0.68)},${Math.round(c[2] * 0.68)})`;
        this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ent.sx, ent.sy, (g, px, py) => drawAnvil(g, px, py, zoom, face, shade));
        this.anvilHits.push({ x: ent.x, y: ent.y, left: ent.sx - 20 * zoom, top: ent.sy - 27 * zoom, w: 40 * zoom, h: 30 * zoom, anvil: ent.anvil.id });
        if (shines(ent.rare)) drawShine(ctx, ent.sx, ent.sy, zoom, ent.rare as number, ent.anvil.id, this.time, 40 * zoom, 22 * zoom);
        continue;
      }
      if (ent.kind === 'post' && ent.post) {
        const post = ent.post;
        this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ent.sx, ent.sy, (g, px, py) => drawWorkPost(g, px, py, zoom, postLeft(post) / postLife(post.ql), post.worker !== null));
        this.postHits.push({ x: ent.x, y: ent.y, left: ent.sx - 9 * zoom, top: ent.sy - 30 * zoom, w: 18 * zoom, h: 32 * zoom, post: post.id });
        continue;
      }
      if (ent.kind === 'deck' && ent.deck) {
        const deck = ent.deck;
        this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ent.sx, ent.sy, (g, px, py) => drawDeck(g, px, py, zoom, deck.kind, deck.done, deck.drop));
        this.deckHits.push({ x: ent.x, y: ent.y, left: ent.sx - 40 * zoom, top: ent.sy - 22 * zoom, w: 80 * zoom, h: 44 * zoom, bridge: deck.id });
        continue;
      }
      if (ent.kind === 'trap' && ent.trap) {
        const trap = ent.trap;
        this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ent.sx, ent.sy, (g, px, py) => drawTrap(g, px, py, zoom, trap.kind, !!trap.bait, trap.caught !== null));
        this.trapHits.push({ x: ent.x, y: ent.y, left: ent.sx - 8 * zoom, top: ent.sy - 12 * zoom, w: 16 * zoom, h: 14 * zoom, trap: trap.id });
        continue;
      }
      if (ent.kind === 'campfire' && ent.fire) {
        const fire = ent.fire;
        this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ent.sx, ent.sy, (g, px, py) => drawCampfire(g, px, py, zoom, fire.lit, fire.fuel, this.time));
        this.fireHits.push({ x: ent.x, y: ent.y, left: ent.sx - 22 * zoom, top: ent.sy - 20 * zoom, w: 44 * zoom, h: 30 * zoom, fire: fire.id });
        continue;
      }
      const spr = ent.spr;
      if (!spr) continue;
      /*
       * How big this particular one is.
       *
       * Every tree of a species and an age shares one baked sprite, so
       * without this a wood is one tree printed a hundred times and every
       * crown in it tops out on the same line -- which the eye reads as
       * horizontal banding long before it notices it is looking at trees.
       * It costs nothing: no second sprite, no second draw, just a different
       * size to blit the one sprite at, taken about the foot so a tree that
       * grew bigger does not also climb out of the ground.
       *
       * A fifth either way was not enough. A real wood is not one height
       * with a wobble on it, it is layers: a few emergents standing a head
       * and shoulders over everything, a thick middle rank, and an
       * understorey of small wide ones down in the shade of them. So the
       * roll is shaped rather than flat -- one tree in nine is half again
       * as big or better, one in four is half size or less, and the rest
       * fill the middle. That is what puts a top and a floor on a canopy.
       */
      let grew = 1;
      if (ent.kind === 'tree' || ent.kind === 'bush') {
        const r = hash2(Math.round(ent.x), Math.round(ent.y), 7717);
        grew = r > 0.89 ? 1.42 + 0.5 * (r - 0.89) / 0.11
          : r < 0.26 ? 0.46 + 0.28 * (r / 0.26)
            : 0.8 + 0.5 * ((r - 0.26) / 0.63);
      }
      const dw = spr.w * zoom * grew;
      const dh = spr.h * zoom * grew;
      const left = ent.sx - spr.ax * zoom * grew;
      const top = ent.sy - spr.ay * zoom * grew;
      // Anything standing up throws a shadow away from the sun, long at the
      // ends of the day and gone at noon. The sprite's own contact shadow does
      // the rest, which is why this can be thrown away entirely at midday.
      if (this.shadow.alpha > 0.012) this.castShadow(ctx, ent.sx, ent.sy, (spr.ay - (spr.h - spr.ay)) * 0.5 * zoom + dh * 0.12);
      if (ent.kind === 'tree' || ent.kind === 'bush') {
        const ready = this.atSize(spr.canvas, dw, dh);
        /*
         * Air between here and the back of the wood.
         *
         * Everything standing up was drawn at one strength whatever its
         * distance, so the far rank of a wood came forward as hard as the
         * near one and the whole thing flattened into a pattern. The screen
         * is the depth here -- in this projection a thing further away is a
         * thing higher up the picture -- so the top of the view is washed
         * toward the sky and the bottom is left alone. It is the same trick
         * the ground haze uses, and unlike the ground haze it has to keep
         * working when somebody zooms in, which is exactly where a wood
         * needed it most.
         */
        const far = Math.max(0, Math.min(1, 1 - (ent.sy + dh * 0.5) / (this.canvas.height * 0.82)));
        // Rooted at the foot, leaning at the head: the shear is taken about
        // the trunk, so the tree bends rather than slides. A lean that moves
        // the crown less than half a pixel is not worth a transform to draw.
        const bend = (swayAt(ent.x, ent.y, this.time, this.lean.force) * SWAY_MAX * (ent.kind === 'bush' ? 0.6 : 1)) / 2;
        /*
         * The lean this one grew with, as against the one the wind is putting
         * on it this instant. Both are the same shear about the foot, so they
         * add, and neither costs a second sprite.
         *
         * Nothing had one. Every tree on the island stood dead upright, which
         * is the single thing that made a wood read as one stamp printed a
         * hundred times however different the crowns were -- an array of
         * uprights is an array whatever is on top of the posts. Up to about
         * six degrees, its own for every tile, and either way.
         */
        const stand = (hash2(Math.round(ent.x), Math.round(ent.y), 9931) - 0.5) * 0.22;
        /*
         * Laid on thinner the further back it stands, so it takes up some of
         * whatever is behind it -- the meadow low down, the wood's own far
         * rank higher up, the sky over the top of all of it. In a picture
         * made of flat colour that is the whole of atmosphere: contrast and
         * chroma both come off with distance because the thing is literally
         * part ground now, and it costs one number.
         */
        /*
         * And a little off each tree on its own account, so no two of a
         * species are quite the same weight of green. A canopy is one sprite
         * per species per age however many hues the table carries, and sixty
         * tiles of one hue in a frame reads as one flat colour -- this is a
         * value jitter rather than a hue one, but against a ground it is the
         * same thing: every tree takes a different amount of the floor up
         * into itself.
         */
        // How far off it is, in steps, plus a little of its own so no two
        // trees of a species carry quite the same weight of colour.
        const own = 0.06 * hash2(Math.round(ent.x), Math.round(ent.y), 4231);
        const step = Math.min(HAZE_STEPS, Math.round((far * 0.94 + own) * HAZE_STEPS));
        const shown = step > 0 ? this.hazed(ready, step) : ready;
        const shear = stand - this.lean.x * bend;
        if (Math.abs(shear) * dh < 1.5) {
          ctx.drawImage(shown, left, top, dw, dh);
          continue;
        }
        ctx.save();
        ctx.translate(ent.sx, ent.sy);
        ctx.transform(1, 0, shear, 1, 0, 0);
        ctx.drawImage(shown, left - ent.sx, top - ent.sy, dw, dh);
        ctx.restore();
        continue;
      }
      const ready = this.atSize(spr.canvas, dw, dh);
      this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ent.sx, ent.sy, (g, px, py) => g.drawImage(ready, px - spr.ax * zoom, py - spr.ay * zoom, dw, dh));
      /*
       * And the shine, over the top of whatever it is, because the light comes
       * off the thing rather than out from behind it. The seed is the tile, so
       * a heap keeps the same motes in the same places from one frame to the
       * next and two heaps side by side do not shine in step.
       */
      if (shines(ent.rare)) drawShine(ctx, ent.sx, ent.sy, zoom, ent.rare as number, ent.x * 4099 + ent.y, this.time, dw, spr.ay * zoom);
      if (ent.kind === 'crate' && ent.crateId !== undefined) {
        this.crateHits.push({ x: ent.x, y: ent.y, left: left + dw * 0.15, top: top + dh * 0.2, w: dw * 0.7, h: dh * 0.75, crate: ent.crateId });
      }
    }
    if (this.ghost) this.drawGhost(ctx, zoom, this.ghost);
  }

  /** The ghost of what is being set down, over everything, and washed red where it will not go. */
  private drawGhost(ctx: CanvasRenderingContext2D, zoom: number, ghost: Ghost): void {
    const cam = this.camera;
    const world = this.game.world;
    ctx.save();
    ctx.globalAlpha = 0.6;
    if (ghost.kind === 'furniture') {
      const [w, h] = furnitureFootprint(ghost.piece, ghost.facing);
      const wx = ghost.x + (ghost.sx + w / 2) / SUBTILES;
      const wy = ghost.y + (ghost.sy + h / 2) / SUBTILES;
      const px = cam.worldToScreenX(wx, wy);
      const py = cam.worldToScreenY(wx, wy, this.pieceBase({ kind: ghost.piece }, wx, wy));
      drawFurniture(ctx, px, py, zoom, ghost.piece, false, undefined, undefined, pieceView(ghost.facing, cam.rotation), ghost.material);
      if (!ghost.ok) {
        const [W, D] = furnitureSpan(ghost.piece);
        ctx.fillStyle = 'rgba(214, 58, 42, 0.5)';
        ctx.beginPath();
        ctx.ellipse(px, py, W * zoom, D * zoom, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const tile: FloorTile = { building: 0, level: ghost.level, x: ghost.x, y: ghost.y, material: ghost.material, kind: ghost.floorKind, facing: ghost.side, ...floorBill(ghost.material, ghost.floorKind) };
      const base = world.getHeight(ghost.x, ghost.y);
      if (ghost.floorKind === 'stairs') this.drawStairs(tile, ghost.x, ghost.y, base, 0.6);
      else this.drawLadder(tile, ghost.x, ghost.y, base, 0.6);
      if (!ghost.ok) {
        const px = cam.worldToScreenX(ghost.x + 0.5, ghost.y + 0.5);
        const py = cam.worldToScreenY(ghost.x + 0.5, ghost.y + 0.5, base + (ghost.level - 1) * WALL_HEIGHT);
        ctx.fillStyle = 'rgba(214, 58, 42, 0.5)';
        ctx.beginPath();
        ctx.ellipse(px, py, 18 * zoom, 9 * zoom, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /**
   * Which tiles are in the room the player is standing in, or null for
   * somebody out of doors.
   *
   * An unenclosed room still counts: a house with one wall left to build is
   * exactly the house you most want to see into, and a cutaway that waited
   * for the last wall would switch itself on at the moment it stopped being
   * needed.
   */
  private myRoom(): Set<string> | null {
    const p = this.game.player;
    const bld = this.game.buildings;
    if (!bld.list.size) return null;
    if (!bld.buildingAt(p.tileX, p.tileY)) return null;
    const room = bld.room(p.level, p.tileX, p.tileY);
    return room ? new Set(room.tiles) : null;
  }

  /** Whether a border is one of the room's own edges, or stands over it. */
  private wallsMyRoom(b: Border): boolean {
    return !!this.roomTiles && bordersRoom(this.roomTiles, b);
  }

  /**
   * Floors and walls belonging to a tile. Walls are drawn on the two borders
   * that are the tile's back edges under the current viewpoint, so every wall
   * is drawn exactly once, after the ground behind it and before whatever
   * stands in front. Walls of the player's own room go translucent once they
   * would hide the player, and what counts as "the player's" is the room they
   * are standing in rather than the whole building.
   *
   * Looked at square on — the four diagonal viewpoints — the two borders
   * running away from the viewer are edge on and draw as nothing at all, which
   * is what a wall seen end on looks like. Which of the pair is claimed still
   * matters: claim both sides of one border and it is drawn twice.
   */
  private drawStructures(x: number, y: number, V: View, inFront: boolean): void {
    const bld = this.game.buildings;
    const w = this.game.world;
    const inside = bld.buildingAt(this.game.player.tileX, this.game.player.tileY);
    const building = bld.buildingAt(x, y);
    const base = w.getHeight(x, y);
    // One border across the top of the screen and one down a side, whichever
    // way we are looking: between them every wall on the island is claimed by
    // exactly one tile, and claimed by the tile in front of it.
    const backA: Border = borderOf(x, y, V.back[0]);
    const backB: Border = borderOf(x, y, V.back[1]);
    const playerLevel = this.game.player.level;
    const maxLevels = building ? building.levels : Math.max(1, this.maxLevelsAround(x, y));
    const { cutaway, viewLevel } = this.game.settings;
    // Floors, stairs and ladders for each storey, walls of each storey, then the roof one level up.
    for (let level = 0; level <= maxLevels; level++) {
      /*
       * A ladder goes on after the walls of the storey it opens into: its
       * stiles stand up past the floor, in front of a wall on the far side
       * of the hatch, which laid after it covered them.
       */
      let late: (() => void) | null = null;
      if (building) {
        const floor = bld.floor(level, x, y);
        /*
         * Looking at one storey means lifting the ceilings above it off, but
         * not the way up through them: a flight or a ladder stands in the
         * storey under the floor it climbs to, and a ladder loses only its
         * hatch.
         */
        const above = floor && viewLevel !== null ? floor.level - viewLevel : 0;
        const climb = !!floor && (floorKind(floor) === 'stairs' || floorKind(floor) === 'ladder');
        if (floor && (above <= 0 || (above === 1 && climb))) {
          // A floor over your head is the ceiling of the room you are in, and
          // only of that room: the far end of a longhouse keeps its own.
          const dim = level > playerLevel && !!this.roomTiles?.has(`${x},${y}`);
          const alpha = dim ? 0.35 : 1;
          switch (floorKind(floor)) {
            case 'stairs':
              this.drawStairs(floor, x, y, base, alpha);
              break;
            case 'ladder':
              late = () => this.drawLadder(floor, x, y, base, alpha, above <= 0);
              break;
            case 'roof':
              // A flat roof is a deck, laid a tile at a time like a floor so
              // anybody out on it stands on it; a pitched one is laid whole,
              // after its walls: see `queueRoofs`.
              if (roofShapeOf(building) === 'flat') this.drawDeck(floor, x, y, base, alpha);
              break;
            default:
              this.drawFloor(floor, x, y, base, alpha);
          }
        }
      }
      if (level >= maxLevels || (viewLevel !== null && level > viewLevel)) {
        late?.();
        if (level >= maxLevels) break;
        continue;
      }
      // The shade of every wall round the tile, on the ground or on the floor
      // of the storey, before any wall of the storey stands on it -- on a
      // floor, that is: a hatch or a flight has none to take it.
      const slot = level ? bld.floor(level, x, y) : undefined;
      if (level === 0 || (slot && (floorKind(slot) === 'floor' || floorKind(slot) === 'roof'))) this.groundShade(x, y, level, V);
      for (const border of [backA, backB]) {
        const wall = bld.wallOnBorder(level, border);
        if (!wall) {
          /*
           * No wall here, planned or built. If the border is the edge of a
           * plan it is marked out instead, so a building that is nothing but
           * a footprint still looks like one.
           */
          const plan = bld.edgeOf(border);
          if (plan && !(cutaway && building?.id !== plan.id)) {
            const [tx, ty] = border.dir === 'h'
              ? [border.x, bld.buildingAt(border.x, border.y) === plan ? border.y : border.y - 1]
              : [bld.buildingAt(border.x, border.y) === plan ? border.x : border.x - 1, border.y];
            // Nothing stands in the air: an upper storey is only marked out
            // where there is a floor under it to mark out.
            if (level === 0 || bld.floor(level, tx, ty)) {
              this.drawScaffold(border, base, level, inside?.id === plan.id && inFront ? 0.35 : 1);
            }
          }
          continue;
        }
        /*
         * Every wall is drawn once, by whichever tile has it as a back edge.
         * When that tile is not part of the wall's own building the wall
         * stands between the viewer and the inside: those are the ones a
         * cutaway takes away.
         */
        if (cutaway && building?.id !== wall.building) continue;
        const dim = inFront && this.wallsMyRoom(border);
        this.drawWall(wall, border, base, dim ? 0.3 : 1);
      }
      late?.();
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

  /**
   * The shade the walls round a tile throw on it, laid over the tile's own
   * ground, or its floor on a storey, before anything stands on it.
   *
   * Entities cast a shadow and walls never had, which on three metres of
   * house nobody misses -- the wall is most of what you are looking at. On a
   * metre and a quarter of field wall the ground line is most of it, and a
   * plinth is the one course of a house that stands out past the face:
   * without the band of shade either puts on the grass it is a sticker laid
   * on the field.
   *
   * Every wall used to lay its own shade as it was drawn, and that went
   * wrong wherever two met. Two shades at a corner overlapped, and the
   * ground where they did was in the shade twice over: a darker square at
   * the foot of every corner of every house. And a wall's shade ran on past
   * its end into the tile across the corner, which is drawn after it, and
   * that tile's grass cut the shade off square. Laid here, all the shades
   * that reach a tile are one path and one fill, cut to the tile, so the
   * ground is in shade once however many walls put it there, and a tile
   * drawn later lays its own share rather than covering somebody else's.
   * Cut a hair past the tile: the tile in front strokes its outline half a
   * pixel into this one, and that half pixel is laid again by the tile that
   * covered it.
   */
  private groundShade(x: number, y: number, level: number, V: View): void {
    const cam = this.camera;
    const world = this.game.world;
    const ctx = this.canvas.ctx;
    ctx.beginPath();
    let any = false;
    for (const b of [
      { dir: 'h', x, y }, { dir: 'h', x, y: y + 1 }, { dir: 'v', x, y }, { dir: 'v', x: x + 1, y },
      { dir: 'h', x: x - 1, y }, { dir: 'v', x, y: y - 1 }, { dir: 'h', x: x + 1, y }, { dir: 'v', x: x + 1, y: y - 1 },
      { dir: 'h', x: x + 1, y: y + 1 }, { dir: 'v', x: x + 1, y: y + 1 }, { dir: 'h', x: x - 1, y: y + 1 }, { dir: 'v', x, y: y + 1 },
    ] as Border[]) {
      const p = this.shadeOf(level, b, V);
      if (!p) continue;
      any = true;
      for (let i = 0; i < p.length; i += 3) {
        const sx = cam.worldToScreenX(p[i], p[i + 1]), sy = cam.worldToScreenY(p[i], p[i + 1], p[i + 2]);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
    }
    if (!any) return;
    const rise = level * WALL_HEIGHT;
    const corner = (cx: number, cy: number): [number, number] => [cam.worldToScreenX(cx, cy), cam.worldToScreenY(cx, cy, world.getHeight(cx, cy) + rise)];
    const q = [corner(x, y), corner(x + 1, y), corner(x + 1, y + 1), corner(x, y + 1)];
    const mx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, my = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    ctx.save();
    const clip = new Path2D();
    for (const [sx, sy] of q) {
      const l = Math.hypot(sx - mx, sy - my) || 1;
      clip.lineTo(sx + ((sx - mx) / l) * 0.8, sy + ((sy - my) / l) * 0.8);
    }
    clip.closePath();
    ctx.clip(clip);
    ctx.fillStyle = SHADE_INK;
    ctx.fill();
    ctx.restore();
  }

  /**
   * The ground a finished wall throws its shade on, as a polygon of world
   * points with their heights, or null for a wall that throws none.
   *
   * A garden wall shades both sides of itself, a distance out that goes with
   * how thick it is. A house wall on a masonry with a plinth shades the side
   * that is out of doors, further out: the plinth stands proud of the face.
   * A partition shades nothing. Along the run the shade goes from one end to
   * the other, and past an end only where the wall turns a corner and nothing
   * as big carries on: there it goes on round the corner as far as the other
   * wall's shade reaches, so the two together fill the angle outside it. At
   * a T or a cross it stops at the line of the wall across it, whose own
   * shade covers the rest.
   */
  private shadeOf(level: number, b: Border, V: View): Float64Array | null {
    const key = `${level}:${b.dir}:${b.x},${b.y}`;
    const had = this.shades.get(key);
    if (had !== undefined) return had;
    const bld = this.game.buildings;
    const world = this.game.world;
    const found = (bb: Border): Wall | undefined => {
      const w = bld.wallOnBorder(level, bb);
      return w && isDone(w) ? w : undefined;
    };
    const halfOf = (w: Wall): number => {
      const k = WALL_TYPE_BY_ID.get(w.type);
      return (k?.railed ? FENCE_THICK : WALL_THICK) * (k?.thick ?? 1);
    };
    /** How far out a wall's shade reaches from its line, or 0 for a wall that throws none. */
    const reachOf = (w: Wall): number => {
      const cob = this.masonryOf(w);
      if (!cob) return 0;
      if (WALL_TYPE_BY_ID.get(w.type)?.low) return 2.1 * halfOf(w);
      return cob.plinth && level === 0 ? 3.4 * halfOf(w) : 0;
    };
    /** The tile a border is drawn from: the one in front of it, which gives the wall its footing. */
    const from = (bb: Border): [number, number] => bb.dir === 'h'
      ? [bb.x, V.back.includes('n') ? bb.y : bb.y - 1]
      : [V.back.includes('w') ? bb.x : bb.x - 1, bb.y];
    const done = (out: Float64Array | null): Float64Array | null => { this.shades.set(key, out); return out; };
    const wall = found(b);
    if (!wall) return done(null);
    const [fx, fy] = from(b);
    // A wall the cutaway has taken away takes its shade with it.
    if (this.game.settings.cutaway && bld.buildingAt(fx, fy)?.id !== wall.building) return done(null);
    const reach = reachOf(wall);
    if (!reach) return done(null);
    const low = !!WALL_TYPE_BY_ID.get(wall.type)?.low;
    const [ax, ay] = borderPoints(b);
    const dx = b.dir === 'h' ? 1 : 0, dy = b.dir === 'h' ? 0 : 1;
    // Across the run: `+` is toward the tile at the border's own x and y for
    // a border along x, and away from it for one along y.
    const nx = -dy, ny = dx;
    const outside = (s: 1 | -1): boolean => {
      if (low) return true;
      const tx = b.dir === 'h' ? b.x : s > 0 ? b.x - 1 : b.x;
      const ty = b.dir === 'h' ? (s > 0 ? b.y : b.y - 1) : b.y;
      return bld.buildingAt(tx, ty)?.id !== wall.building;
    };
    const s0 = outside(-1) ? -reach : 0, s1 = outside(1) ? reach : 0;
    if (s0 === s1) return done(null);
    const tall = this.standing(wall, b), half = halfOf(wall);
    /** Where the shade stops at the `i` end, along the run. */
    const end = (i: -1 | 1): number => {
      const t = i < 0 ? 0 : 1, cx = ax + dx * t, cy = ay + dy * t;
      const next: Border = b.dir === 'h' ? { dir: 'h', x: b.x + i, y: b.y } : { dir: 'v', x: b.x, y: b.y + i };
      const on = found(next);
      if (on && this.standing(on, next) >= tall - 1e-6 && halfOf(on) >= half - 1e-9) return t;
      const arms = (b.dir === 'h'
        ? [{ dir: 'v', x: cx, y: cy - 1 }, { dir: 'v', x: cx, y: cy }]
        : [{ dir: 'h', x: cx - 1, y: cy }, { dir: 'h', x: cx, y: cy }]) as Border[];
      const met = arms.map(found).filter((w): w is Wall => !!w);
      if (met.length !== 1) return t;
      return t + i * Math.max(reachOf(met[0]), halfOf(met[0]));
    };
    const t0 = end(-1), t1 = end(1);
    const h = world.getHeight(fx, fy) + level * WALL_HEIGHT;
    const out = new Float64Array(12);
    [[t0, s0], [t1, s0], [t1, s1], [t0, s1]].forEach(([t, s], k) => {
      out[k * 3] = ax + dx * t + nx * s;
      out[k * 3 + 1] = ay + dy * t + ny * s;
      out[k * 3 + 2] = h;
    });
    return done(out);
  }

  /**
   * What a painted thing is the colour of.
   *
   * A limewash goes over the face and leaves the grain and the courses where
   * they are, so only the colours change and every line the material draws on
   * itself is drawn in the new one. Nothing is painted until somebody paints
   * it, so the common case costs one undefined check.
   */
  private painted(mat: MaterialDef, dye: string | undefined): MaterialDef {
    if (!dye) return mat;
    const d = DYE_BY_ID.get(dye);
    if (!d) return mat;
    const key = `${mat.id}:${dye}`;
    const had = this.paints.get(key);
    if (had) return had;
    const made: MaterialDef = { ...mat, color: hexRgb(d.colour), trim: hexRgb(d.shade), floor: hexRgb(d.colour) };
    this.paints.set(key, made);
    return made;
  }

  /**
   * A flight of stairs up from the storey below to this one: see
   * `stairing.ts` for what each material builds one as.
   *
   * It was six quads in two flat colours with nothing at either side, so a
   * flight seen from the side was a stack of boards floating in the room.
   * Each step is a riser and a tread now, the tread standing a nosing proud
   * of the riser; the flight has sides -- the wall it is built of cut to the
   * steps, or its strings -- and a side open to the room is railed. It
   * stands clear of a wall it runs up beside, against the wall's face, not
   * in it.
   */
  private drawStairs(floor: FloorTile, x: number, y: number, base: number, alpha: number): void {
    const main = this.canvas.ctx;
    const cam = this.camera;
    const bld = this.game.buildings;
    const bare = MATERIAL_BY_ID.get(floor.material);
    if (!bare) return;
    const facing = floor.facing ?? 's';
    const h0 = base + (floor.level - 1) * WALL_HEIGHT;
    const h1 = base + floor.level * WALL_HEIGHT;
    // Eight to a storey: six made every step half a metre, and a flight a pile of blocks.
    const N = 8;
    const rise = (h1 - h0) / N;
    const done = isDone(floor);
    const zoom = cam.zoom;
    const st = stairStyle(floor.material);
    /*
     * A painted flight is its paint all over, as a painted wall is -- each
     * part of it a step lighter or darker in the paint as it was in the
     * wood, so a tread still reads against its riser.
     */
    const paint = floor.dye ? this.painted(bare, floor.dye).color : null;
    const lum = (c: readonly [number, number, number]): number => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const C = (c: readonly [number, number, number], k: number, a = 1): string => {
      if (!paint) return rgb(c, k, a);
      const f = Math.max(0.6, Math.min(1.3, lum(c) / Math.max(1, lum(st.riser))));
      return rgb(paint, k * f, a);
    };
    const lw = (k: number): number => Math.max(0.8, k * zoom);
    const W = (t: number, s: number): [number, number] => Renderer.stairPoint(x, y, facing, t, s);
    const P = (t: number, s: number, h: number): [number, number] => {
      const [wx, wy] = W(t, s);
      return [cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, h)];
    };
    /*
     * Seen through -- in a room of its own under the storey you are standing
     * on -- it is laid whole on a layer and put over the room once, over the
     * box it stands in, rails and all.
     */
    let box: [number, number, number, number] | null = null;
    if (alpha < 1) {
      const dpr = this.canvas.dpr;
      const xs: number[] = [], ys: number[] = [];
      for (const t of [-0.2, 1.2]) for (const u of [-0.2, 1.2]) for (const h of [h0, h1 + 20]) {
        const [qx, qy] = P(t, u, h);
        xs.push(qx);
        ys.push(qy);
      }
      const bx = Math.max(0, Math.floor(Math.min(...xs) * dpr)), by = Math.max(0, Math.floor(Math.min(...ys) * dpr));
      box = [bx, by, Math.ceil(Math.max(...xs) * dpr) - bx + 1, Math.ceil(Math.max(...ys) * dpr) - by + 1];
    }
    const ctx = box ? this.seeThroughCtx(box) : main;
    const poly = (pts: Array<[number, number]>): void => {
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
    };
    const line = (a: [number, number], b: [number, number], ink: string, width: number): void => {
      ctx.strokeStyle = ink;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    };
    // Up the flight and across it, in the world.
    const [ox, oy] = W(0, 0);
    const ux = W(0, 1)[0] - ox, uy = W(0, 1)[1] - oy;
    const cx = W(1, 0)[0] - ox, cy = W(1, 0)[1] - oy;
    // Lit as a wall is: a tread looks at the sky, a riser and the flight's end as a wall across it, its side as a wall along it.
    const treadLit = 1.12, riserLit = this.faceLight(cx, cy), sideLit = this.faceLight(ux, uy);
    const risersShow = cam.nearSide(-ux, -uy) > 0;
    const near: 0 | 1 = cam.nearSide(cx, cy) > 0 ? 1 : 0;
    /** The border a side of the flight runs along. */
    const sideBorder = (t: 0 | 1): Border => {
      const [a, b] = [W(t, 0), W(t, 1)];
      return Math.abs(a[0] - b[0]) < 1e-9 ? { dir: 'v', x: a[0], y: Math.min(a[1], b[1]) } : { dir: 'h', x: Math.min(a[0], b[0]), y: a[1] };
    };
    const walled = (t: 0 | 1): boolean => {
      const w = bld.wallOnBorder(floor.level - 1, sideBorder(t));
      return !!w && isDone(w);
    };
    /** Whether a flight beside it on side `t` goes up the same way, making one wide flight with it. */
    const joined = (t: 0 | 1): boolean => {
      const [nx, ny] = t ? [cx, cy] : [-cx, -cy];
      const f = bld.floor(floor.level, x + Math.round(nx), y + Math.round(ny));
      return !!f && floorKind(f) === 'stairs' && (f.facing ?? 's') === facing;
    };
    /** Whether a side stands open to the room: no wall along it, and no flight beside it. */
    const open = (t: 0 | 1): boolean => !walled(t) && !joined(t);
    // Against a wall, the flight stops at the wall's face.
    const tLo = walled(0) ? WALL_THICK : 0, tHi = walled(1) ? 1 - WALL_THICK : 1;
    const tNear = near ? tHi : tLo, tFar = near ? tLo : tHi;
    const NOSE = st.proud ? 0.03 : 0, NOSE_H = st.proud ? 1.3 : 0;
    const hTop = (i: number): number => h0 + (i + 1) * rise;
    /** The top edge of a closed string at `s` up the flight: a hand over the nosings, level with the landing at its head. */
    const closedTop = (s: number): number => Math.min(h0 + rise + (h1 - h0) * s + 2, h1 + 2);
    /** The steps' outline up the side at `t`, from the foot of the first riser to the back of the top tread. */
    const profile = (t: number): Array<[number, number]> => {
      const out: Array<[number, number]> = [P(t, 0, h0)];
      for (let i = 0; i < N; i++) {
        out.push(P(t, i / N, hTop(i)));
        out.push(P(t, (i + 1) / N, hTop(i)));
      }
      return out;
    };
    /**
     * A masonry's own wall picture laid up a vertical face of the flight: the
     * face from `a` to `b` along the ground, the field of a storey of it from
     * the floor to the landing -- without the band at the head of the storey,
     * which cut to the steps was a scrap of cornice under the top one -- cut
     * to whatever path is set as the clip, and lit as a face that way is.
     * False where the flight's material has no picture.
     */
    const cob = this.masonryOf(floor);
    const pictured = (a: [number, number], b: [number, number], lit: number): boolean => {
      if (!cob || st.build !== 'solid') return false;
      const img = cob.face[Math.abs(x * 31 + y * 17 + floor.level * 7) % cob.face.length];
      const S = (w: [number, number], k: number): [number, number] => [cam.worldToScreenX(w[0], w[1]), cam.worldToScreenY(w[0], w[1], h0 + WALL_HEIGHT * k)];
      const turned = !!cob.handed && S(b, 0)[0] < S(a, 0)[0];
      const [pa, pb] = turned ? [b, a] : [a, b];
      const [tlx, tly] = S(pa, 1), [trx, try_] = S(pb, 1), [blx, bly] = S(pa, 0);
      const fh = img.height - cob.head;
      ctx.save();
      ctx.clip();
      ctx.save();
      ctx.transform((trx - tlx) / img.width, (try_ - tly) / img.width, (blx - tlx) / fh, (bly - tly) / fh, tlx, tly);
      ctx.drawImage(img, 0, cob.head, img.width, fh, 0, 0, img.width, fh);
      ctx.restore();
      const [sr, sg, sb] = cob.shade;
      ctx.fillStyle = `rgba(${sr}, ${sg}, ${sb}, ${cob.shadow(lit).toFixed(3)})`;
      ctx.fillRect(-1e5, -1e5, 2e5, 2e5);
      ctx.restore();
      return true;
    };
    /** A face of the flight along one side, cut to the steps -- or, on adobe, carried up as a parapet over them. */
    const side = (t: number, parapet: boolean): void => {
      const pts = profile(t);
      if (parapet) {
        pts.splice(1, pts.length - 1, P(t, 0, h0 + rise + 8), P(t, 0.93, h1 + 8), P(t, 1, h1 + 8));
      }
      pts.push(P(t, 1, h0));
      poly(pts);
      if (!pictured(W(t, 0), W(t, 1), sideLit)) {
        ctx.fillStyle = C(st.string, sideLit);
        ctx.fill();
      }
      poly(pts);
      ctx.strokeStyle = C(st.line, sideLit, 0.55);
      ctx.lineWidth = lw(1);
      ctx.stroke();
      if (parapet) line(P(t, 0, h0 + rise + 8), P(t, 0.93, h1 + 8), C(st.barHi, 1.08), lw(2));
    };
    /** A timber string up the side at `t`: cut to the steps, or closed over them. */
    const string = (t: number): void => {
      const D = 4;
      const bottom = (s: number): number => Math.max(h0, h0 + (h1 - h0) * s - D);
      const pts: Array<[number, number]> = [];
      if (st.build === 'closed') {
        pts.push(P(t, 0, h0), P(t, 0, closedTop(0)));
        const knee = 1 - 1 / N;
        pts.push(P(t, knee, closedTop(knee)), P(t, 1, closedTop(1)));
      } else {
        pts.push(...profile(t));
      }
      pts.push(P(t, 1, bottom(1)), P(t, D / (h1 - h0), h0));
      poly(pts);
      ctx.fillStyle = C(st.string, sideLit);
      ctx.fill();
      ctx.strokeStyle = C(st.line, sideLit, 0.7);
      ctx.lineWidth = lw(1);
      ctx.stroke();
      if (st.build === 'closed') line(P(t, 0, closedTop(0)), P(t, 1, closedTop(1)), C(st.stringHi, 1.05), lw(1.4));
    };
    /** A log laid up the side at `t` for the split logs to rest on. */
    const stringer = (t: number): void => {
      const a = P(t, 0.02, h0 + 1.5), b = P(t, 1, h1 - 2.5), w = Math.max(3, 8 * zoom);
      ctx.lineCap = 'round';
      line(a, b, C(st.line, 1), w + lw(1.6));
      line(a, b, C(st.string, sideLit), w);
      line([a[0], a[1] - w * 0.25], [b[0], b[1] - w * 0.25], C(st.stringHi, 1.05), Math.max(1, w * 0.3));
      ctx.lineCap = 'butt';
    };
    /** The rail along an open side at `t`, as its material rails one. */
    const rail = (t: number): void => {
      const R = st.rail === 'stone' ? 9 : 10;
      const s0 = 0.06, s1 = 0.95, b0 = h0 + rise, b1 = h1;
      const at = (s: number): number => b0 + R + ((b1 - b0) * (s - s0)) / (s1 - s0);
      const ink = (c: readonly [number, number, number], k = 1, a = 1): string => (st.rail === 'iron' ? rgb(c, k, a) : C(c, k, a));
      const postW = st.rail === 'stone' ? 4.2 : st.rail === 'pole' ? 3.6 : st.rail === 'wood' ? 3 : 1.8;
      const barW = st.rail === 'stone' ? 3.2 : st.rail === 'pole' ? 3 : st.rail === 'wood' ? 2.4 : 1.8;
      const balW = st.rail === 'stone' ? 2.6 : st.rail === 'wood' ? 1.3 : 1;
      if (st.rail !== 'pole') {
        // The balusters: one to a step, two on carpentry and stone.
        const per = st.rail === 'wood' || st.rail === 'stone' ? 2 : 1;
        for (let i = 0; i < N; i++) {
          for (let k = 0; k < per; k++) {
            const s = (i + (k + 0.5) / per) / N;
            if (s < s0 + 0.03 || s > s1 - 0.03) continue;
            const foot = st.build === 'closed' ? closedTop(s) : hTop(i);
            line(P(t, s, foot), P(t, s, at(s)), ink(st.bar, 0.95), lw(balW));
            if (st.rail === 'stone') line(P(t, s, hTop(i) + R * 0.45), P(t, s, hTop(i) + R * 0.62), ink(st.barHi, 1), lw(balW + 1.4));
          }
        }
      }
      // The newels at its foot and head, and the rail between them.
      for (const [s, b] of [[s0, b0], [s1, b1]] as Array<[number, number]>) {
        line(P(t, s, b), P(t, s, b + R + 2), ink(st.line, 1), lw(postW + 1.2));
        line(P(t, s, b), P(t, s, b + R + 2), ink(st.post, 1.05), lw(postW));
        if (st.rail === 'gilt' || st.rail === 'wood') {
          const [fx, fy] = P(t, s, b + R + 3.4);
          ctx.beginPath();
          ctx.arc(fx, fy, lw(postW * 0.62), 0, Math.PI * 2);
          ctx.fillStyle = ink(st.barHi, 1.05);
          ctx.fill();
          ctx.strokeStyle = ink(st.line, 1, 0.8);
          ctx.lineWidth = lw(0.8);
          ctx.stroke();
        }
      }
      ctx.lineCap = 'round';
      line(P(t, s0, at(s0)), P(t, s1, at(s1)), ink(st.line, 1), lw(barW + 1.2));
      line(P(t, s0, at(s0)), P(t, s1, at(s1)), ink(st.bar, 1.05), lw(barW));
      line(P(t, s0, at(s0) + barW * 0.2), P(t, s1, at(s1) + barW * 0.2), ink(st.barHi, 1.1), lw(Math.max(0.8, barW * 0.35)));
      ctx.lineCap = 'butt';
    };
    /** One step: its riser where the camera sees it, and its tread. */
    const step = (i: number): void => {
      const sF = i / N, sB = (i + 1) / N, hb = h0 + i * rise, ht = hTop(i);
      const salt = x * 131 + y * 71 + floor.level * 13 + i * 7;
      if (st.build === 'log') {
        // A split log across the flight, its flat face up and its round under it.
        const sm = (sF + sB) / 2, r = rise * 0.55;
        poly([P(tLo, sF + 0.01, ht), P(tHi, sF + 0.01, ht), P(tHi, sB - 0.01, ht), P(tLo, sB - 0.01, ht)]);
        ctx.fillStyle = C(st.tread, treadLit);
        ctx.fill();
        ctx.strokeStyle = C(st.line, treadLit, 0.6);
        ctx.lineWidth = lw(1);
        ctx.stroke();
        if (risersShow) {
          poly([P(tLo, sF + 0.01, ht), P(tHi, sF + 0.01, ht), P(tHi, sm - 0.04, ht - r), P(tLo, sm - 0.04, ht - r)]);
          ctx.fillStyle = C(st.string, riserLit);
          ctx.fill();
          ctx.stroke();
        }
        // Its end, where the saw cut it: rings in a half round.
        const [ex, ey] = P(tNear, sm, ht - 0.2);
        const e2 = P(tNear, sF + 0.01, ht), rr = Math.max(2, Math.hypot(e2[0] - ex, e2[1] - ey));
        ctx.beginPath();
        ctx.ellipse(ex, ey, rr, rr * 0.75, 0, 0, Math.PI);
        ctx.closePath();
        ctx.fillStyle = C(st.nose, sideLit * 1.05);
        ctx.fill();
        ctx.strokeStyle = C(st.line, 1, 0.7);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(ex, ey, rr * 0.55, rr * 0.4, 0, 0, Math.PI);
        ctx.strokeStyle = C(st.joint, 1, 0.8);
        ctx.stroke();
        return;
      }
      if (!risersShow && st.build !== 'solid') {
        // Seen from behind: the back of its riser board, under the tread over it.
        poly([P(tLo, sF, hb), P(tHi, sF, hb), P(tHi, sF, ht - NOSE_H), P(tLo, sF, ht - NOSE_H)]);
        ctx.fillStyle = C(st.riser, riserLit * 0.86);
        ctx.fill();
        ctx.strokeStyle = C(st.line, riserLit, 0.45);
        ctx.lineWidth = lw(0.9);
        ctx.stroke();
      }
      if (risersShow) {
        const rt = ht - NOSE_H;
        poly([P(tLo, sF, hb), P(tHi, sF, hb), P(tHi, sF, rt), P(tLo, sF, rt)]);
        ctx.fillStyle = C(st.riser, riserLit);
        ctx.fill();
        // Its courses and the joints between its units, broken course to course.
        const n = Math.max(1, st.courses);
        for (let k = 0; k < st.courses; k++) {
          const k0 = hb + ((rt - hb) * k) / n, k1 = hb + ((rt - hb) * (k + 1)) / n;
          if (k) line(P(tLo, sF, k0), P(tHi, sF, k0), C(st.joint, riserLit, 0.9), lw(1));
          for (let j = 0; j < st.across; j++) {
            const tj = tLo + (tHi - tLo) * ((j + 0.5 * ((k + i) % 2) + 0.25 * hash2(salt, k * 5 + j, 29)) / st.across);
            if (tj <= tLo + 0.04 || tj >= tHi - 0.04) continue;
            line(P(tj, sF, k0), P(tj, sF, k1), C(st.joint, riserLit, 0.9), lw(1));
          }
        }
        // The shade under the nosing.
        if (NOSE) {
          poly([P(tLo, sF, rt), P(tHi, sF, rt), P(tHi, sF, rt - 1.4), P(tLo, sF, rt - 1.4)]);
          ctx.fillStyle = C(st.line, 1, 0.28);
          ctx.fill();
        }
        poly([P(tLo, sF, hb), P(tHi, sF, hb), P(tHi, sF, rt), P(tLo, sF, rt)]);
        ctx.strokeStyle = C(st.line, riserLit, 0.45);
        ctx.lineWidth = lw(0.9);
        ctx.stroke();
      }
      // The tread, a nosing proud of the riser, and the face of the nosing.
      const sN = sF - NOSE;
      if (NOSE && risersShow) {
        poly([P(tLo, sN, ht - NOSE_H), P(tHi, sN, ht - NOSE_H), P(tHi, sN, ht), P(tLo, sN, ht)]);
        ctx.fillStyle = C(st.nose, riserLit * 1.04);
        ctx.fill();
      }
      poly([P(tLo, sN, ht), P(tHi, sN, ht), P(tHi, sB, ht), P(tLo, sB, ht)]);
      ctx.fillStyle = C(st.tread, treadLit);
      ctx.fill();
      // Where one slab or board of it ends and the next begins.
      for (let j = 1; j < st.slabs; j++) {
        const tj = tLo + (tHi - tLo) * ((j + (hash2(salt, j, 31) - 0.5) * 0.4) / st.slabs);
        line(P(tj, sN, ht), P(tj, sB, ht), C(st.joint, treadLit, 0.85), lw(1));
      }
      if (st.build !== 'solid') line(P(tLo, (sN + sB) / 2, ht), P(tHi, (sN + sB) / 2, ht), C(st.joint, treadLit, 0.5), lw(0.8));
      line(P(tLo, sN, ht), P(tHi, sN, ht), C(st.nose, treadLit * 1.05), lw(1.6));
      poly([P(tLo, sN, ht), P(tHi, sN, ht), P(tHi, sB, ht), P(tLo, sB, ht)]);
      ctx.strokeStyle = C(st.line, treadLit, 0.4);
      ctx.lineWidth = lw(0.9);
      ctx.stroke();
    };
    ctx.globalAlpha = box ? (done ? 1 : 0.45) : alpha * (done ? 1 : 0.45);
    ctx.lineJoin = 'round';
    // What stands beyond the steps from the camera: the far string, the far rail.
    const far: 0 | 1 = near ? 0 : 1;
    const farOpen = open(far), nearOpen = open(near);
    if ((st.build === 'string' || st.build === 'closed') && !joined(far)) string(tFar);
    if (st.build === 'log' && !joined(far)) stringer(tFar + (near ? 0.08 : -0.08));
    if (farOpen) {
      if (st.rail === 'parapet') side(tFar, true);
      else rail(tFar);
    }
    // The steps, back to front.
    const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => {
      const [ax, ay] = W(0.5, (a + 0.5) / N);
      const [bx, by] = W(0.5, (b + 0.5) / N);
      return cam.rotateX(ax, ay) + cam.rotateY(ax, ay) - (cam.rotateX(bx, by) + cam.rotateY(bx, by));
    });
    for (const i of order) step(i);
    // A solid flight seen from behind shows the end of it under the landing.
    if (st.build === 'solid' && !risersShow) {
      const pts: Array<[number, number]> = [P(tLo, 1, h0), P(tHi, 1, h0), P(tHi, 1, h1), P(tLo, 1, h1)];
      poly(pts);
      if (!pictured(W(tLo, 1), W(tHi, 1), riserLit)) {
        ctx.fillStyle = C(st.string, riserLit);
        ctx.fill();
      }
      poly(pts);
      ctx.strokeStyle = C(st.line, riserLit, 0.5);
      ctx.lineWidth = lw(1);
      ctx.stroke();
    }
    // Then the side toward the camera, and its rail.
    if (!joined(near)) {
      if (st.build === 'solid') side(tNear, st.rail === 'parapet' && nearOpen);
      else if (st.build === 'log') stringer(tNear + (near ? -0.08 : 0.08));
      else string(tNear);
    }
    if (nearOpen && st.rail !== 'parapet') rail(tNear + (near ? -0.05 : 0.05));
    if (!done) {
      poly([P(0, 0, h1), P(1, 0, h1), P(1, 1, h1), P(0, 1, h1)]);
      ctx.strokeStyle = PLAN_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
    if (box) {
      main.save();
      main.setTransform(1, 0, 0, 1, 0, 0);
      main.globalAlpha = alpha;
      main.drawImage(ctx.canvas, box[0], box[1], box[2], box[3], box[0], box[1], box[2], box[3]);
      main.restore();
    }
  }

  /**
   * A hatch in this storey's floor and a ladder up to it from the storey
   * below, climbed from the facing side.
   *
   * It was a dark square laid on the floor and two lines standing upright
   * beside it, which from half the turns of the view stood out in the yard.
   * The hatch is a hole now: the floor round it shows its cut edges on the
   * far side, lit as the edge of a deck is, with the dark of the room below
   * under them. And the ladder leans: its foot out on the floor below toward
   * the side it is climbed from, its head against the far edge of the hatch
   * -- clear of a wall standing there -- and its stiles running on up past
   * the floor as handholds, the way you get off one at the top.
   *
   * Over your head, the hatch is dimmed with the ceiling it is cut in; the
   * ladder is not, because it stands in the room with you and is too thin to
   * hide you.
   */
  private drawLadder(floor: FloorTile, x: number, y: number, base: number, alpha: number, hatch = true): void {
    const main = this.canvas.ctx;
    const cam = this.camera;
    const bld = this.game.buildings;
    const facing = floor.facing ?? 's';
    const h0 = base + (floor.level - 1) * WALL_HEIGHT;
    const h1 = base + floor.level * WALL_HEIGHT;
    const done = isDone(floor);
    const zoom = cam.zoom;
    const lw = (k: number): number => Math.max(0.8, k * zoom);
    const W = (t: number, s: number): [number, number] => Renderer.stairPoint(x, y, facing, t, s);
    const P = (t: number, s: number, h: number): [number, number] => {
      const [wx, wy] = W(t, s);
      return [cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, h)];
    };
    /*
     * What is laid faint is laid whole on a layer and put over once, as a
     * flight seen through is: a piece at a time, every place two pieces of it
     * overlap would come out darker than either.
     */
    const lay = (a: number, draw: (g: CanvasRenderingContext2D) => void): void => {
      if (a >= 1) {
        main.globalAlpha = 1;
        draw(main);
        main.globalAlpha = 1;
        return;
      }
      const dpr = this.canvas.dpr;
      const xs: number[] = [], ys: number[] = [];
      for (const t of [-0.2, 1.2]) for (const s of [-0.2, 1.2]) for (const h of [h0, h1 + 12]) {
        const [qx, qy] = P(t, s, h);
        xs.push(qx);
        ys.push(qy);
      }
      const bx = Math.max(0, Math.floor(Math.min(...xs) * dpr)), by = Math.max(0, Math.floor(Math.min(...ys) * dpr));
      const box: [number, number, number, number] = [bx, by, Math.ceil(Math.max(...xs) * dpr) - bx + 1, Math.ceil(Math.max(...ys) * dpr) - by + 1];
      const g = this.seeThroughCtx(box);
      draw(g);
      main.save();
      main.setTransform(1, 0, 0, 1, 0, 0);
      main.globalAlpha = a;
      main.drawImage(g.canvas, box[0], box[1], box[2], box[3], box[0], box[1], box[2], box[3]);
      main.restore();
    };
    const poly = (g: CanvasRenderingContext2D, pts: Array<[number, number]>): void => {
      g.beginPath();
      pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.closePath();
    };
    const line = (g: CanvasRenderingContext2D, a: [number, number], b: [number, number], ink: string, width: number): void => {
      g.strokeStyle = ink;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    };
    /*
     * The hole. What shows through it is the room below, in the shade of the
     * floor over it; round it, the edges of the floor that are cut to it, on
     * the side of it away from the camera, where their cut face looks back.
     */
    if (hatch) lay(alpha, (g) => {
      poly(g, [P(0, 0, h1), P(1, 0, h1), P(1, 1, h1), P(0, 1, h1)]);
      g.fillStyle = 'rgba(34, 26, 22, 0.42)';
      g.fill();
      // The four edges: along each, the way out of the hatch and the tile there.
      const edges: Array<[number, number, number, number, number, number]> = [
        [0, 0, 1, 0, 0, -1], [1, 0, 1, 1, 1, 0], [1, 1, 0, 1, 0, 1], [0, 1, 0, 0, -1, 0],
      ];
      for (const [t0, s0, t1, s1, dt, ds] of edges) {
        const [ax, ay] = W(t0 + dt * 0.5 + 0.5 * (t1 - t0), s0 + ds * 0.5 + 0.5 * (s1 - s0));
        const nx = ax - (x + 0.5), ny = ay - (y + 0.5);
        // Only the far edges: their cut face looks back into the hatch, at the camera. One seen edge on is nothing.
        if (cam.rotateX(-nx, -ny) + cam.rotateY(-nx, -ny) < 1e-6) continue;
        const beyond = bld.floor(floor.level, x + Math.round(nx), y + Math.round(ny));
        if (!beyond || floorKind(beyond) === 'ladder' || floorKind(beyond) === 'stairs') continue;
        const mat = MATERIAL_BY_ID.get(beyond.material);
        if (!mat) continue;
        const trim = this.painted(mat, beyond.dye).trim;
        const lit = Math.abs(cam.rotateX(nx, ny)) > Math.abs(cam.rotateY(nx, ny)) ? 0.95 : 0.76;
        poly(g, [P(t0, s0, h1), P(t1, s1, h1), P(t1, s1, h1 - FLOOR_DEEP), P(t0, s0, h1 - FLOOR_DEEP)]);
        g.fillStyle = rgb(trim, lit);
        g.fill();
        // And the shade it throws down into the room, under its lip.
        poly(g, [P(t0, s0, h1 - FLOOR_DEEP), P(t1, s1, h1 - FLOOR_DEEP), P(t1, s1, h1 - FLOOR_DEEP - 5), P(t0, s0, h1 - FLOOR_DEEP - 5)]);
        const shade = g.createLinearGradient(0, P(0.5, 0.5, h1 - FLOOR_DEEP)[1], 0, P(0.5, 0.5, h1 - FLOOR_DEEP - 5)[1]);
        shade.addColorStop(0, 'rgba(34, 26, 22, 0.4)');
        shade.addColorStop(1, 'rgba(34, 26, 22, 0)');
        g.fillStyle = shade;
        g.fill();
        line(g, P(t0, s0, h1), P(t1, s1, h1), rgb(trim, lit * 1.12), lw(1));
      }
      if (!done) {
        poly(g, [P(0, 0, h1), P(1, 0, h1), P(1, 1, h1), P(0, 1, h1)]);
        g.strokeStyle = PLAN_COLOR;
        g.lineWidth = 1;
        g.setLineDash([4, 3]);
        g.stroke();
        g.setLineDash([]);
      }
    });
    /*
     * The ladder: a stile either side and a rung to every three units of
     * height, leaning at the angle a ladder is safe at -- a quarter of its
     * height out at the foot -- its head against the far edge of the hatch,
     * or against the face of a wall standing there. Where three units of
     * height come to less than six pixels of screen, the rungs would run
     * together, so they go in at six units, or nine, instead.
     */
    const headWall = bld.wallOnBorder(floor.level - 1, borderOf(x, y, ({ n: 's', s: 'n', e: 'w', w: 'e' } as const)[facing]));
    const sHead = headWall && isDone(headWall) ? 1 - WALL_THICK - 0.02 : 0.985;
    const sFoot = sHead - ((h1 - h0) / UNITS_PER_TILE) * 0.26;
    const top = h1 + 7;
    const sAt = (h: number): number => sFoot + ((sHead - sFoot) * (h - h0)) / (h1 - h0);
    const pitch = 3 * Math.ceil(6 / (3 * HEIGHT_SCALE * zoom));
    const bare = MATERIAL_BY_ID.get(floor.material) ?? MATERIAL_BY_ID.get('plank');
    const paint = floor.dye && bare ? this.painted(bare, floor.dye).color : null;
    const wood = (c: readonly [number, number, number], k: number): string => {
      if (!paint) return rgb(c, k);
      const lum = (q: readonly [number, number, number]): number => 0.299 * q[0] + 0.587 * q[1] + 0.114 * q[2];
      return rgb(paint, k * Math.max(0.6, Math.min(1.3, lum(c) / lum(LADDER.stile))));
    };
    const T0 = 0.36, T1 = 0.64;
    // The stile further from the camera, the rungs, then the nearer stile.
    const nearT = cam.nearSide(W(1, 0)[0] - W(0, 0)[0], W(1, 0)[1] - W(0, 0)[1]) > 0 ? T1 : T0;
    const farT = nearT === T1 ? T0 : T1;
    const lit = this.faceLight(W(0, 1)[0] - W(0, 0)[0], W(0, 1)[1] - W(0, 0)[1]);
    lay(done ? 1 : 0.45, (g) => {
      g.lineJoin = 'round';
      g.lineCap = 'round';
      const ws = Math.max(2.2, 4 * zoom), edge = (ws + lw(1.4)) / 2;
      const stile = (t: number): void => {
        const a = P(t, sFoot, h0), b = P(t, sAt(top), top);
        line(g, a, b, wood(LADDER.line, 1), ws + lw(1.4));
        line(g, a, b, wood(LADDER.stile, lit), ws);
        line(g, [a[0] - ws * 0.18, a[1]], [b[0] - ws * 0.18, b[1]], wood(LADDER.stileHi, 1.02), Math.max(0.8, ws * 0.3));
      };
      stile(farT);
      /*
       * A rung butts against the inside of the stile behind it, cut along
       * that stile's edge whatever the angle, and the stile in front covers
       * its other end.
       */
      const fa = P(farT, sFoot, h0), fb = P(farT, sAt(top), top);
      const along = Math.hypot(fb[0] - fa[0], fb[1] - fa[1]) || 1;
      const ox = (-(fb[1] - fa[1]) / along) * edge, oy = ((fb[0] - fa[0]) / along) * edge;
      g.save();
      g.beginPath();
      g.rect(-1e5, -1e5, 2e5, 2e5);
      g.moveTo(fa[0] + ox, fa[1] + oy);
      g.lineTo(fb[0] + ox, fb[1] + oy);
      g.lineTo(fb[0] - ox, fb[1] - oy);
      g.lineTo(fa[0] - ox, fa[1] - oy);
      g.closePath();
      g.clip('evenodd');
      g.lineCap = 'butt';
      for (let h = h0 + pitch; h <= h1 - 1; h += pitch) {
        const s = sAt(h), a = P(farT, s, h), b = P(nearT, s, h), w = Math.max(1.6, 2.6 * zoom);
        line(g, a, b, wood(LADDER.line, 1), w + lw(1.2));
        line(g, a, b, wood(LADDER.rung, 1.02), w);
        line(g, [a[0], a[1] - w * 0.2], [b[0], b[1] - w * 0.2], wood(LADDER.rungHi, 1.05), Math.max(0.7, w * 0.3));
      }
      g.restore();
      g.lineCap = 'round';
      stile(nearT);
      g.lineCap = 'butt';
      g.lineWidth = 1;
    });
  }

  /**
   * Which pitched roofs are laid this frame, and when.
   *
   * A roof is one surface over its building, and it goes on after every wall
   * under it: its eaves hang out over the walls' heads. Laid a tile at a time
   * with the tiles, as it was, the walls of the next line of the ground came
   * out over the roof behind them. So each is laid once, after the line of the
   * ground that holds the building's front walls -- the line in front of its
   * front tiles -- and before anything standing on that line.
   */
  private queueRoofs(V: View, dLo: number, dHi: number): void {
    this.roofQueue.clear();
    const bld = this.game.buildings;
    // A building pulled down takes its roof's shape with it.
    for (const id of this.roofShapes.keys()) if (!bld.list.has(id)) this.roofShapes.delete(id);
    const { viewLevel } = this.game.settings;
    for (const b of bld.list.values()) {
      if (roofShapeOf(b) === 'flat') continue;
      // Looking at one storey lifts everything over it off, the roof with it.
      if (viewLevel !== null && b.levels > viewLevel) continue;
      let front = -Infinity;
      for (const k of b.tiles) {
        const [x, y] = k.split(',').map(Number);
        const f = bld.floor(b.levels, x, y);
        if (f && floorKind(f) === 'roof') front = Math.max(front, depthOf(V, x, y));
      }
      if (front === -Infinity || front + 1 < dLo) continue;
      const d = Math.min(front + 1, dHi);
      const line = this.roofQueue.get(d);
      if (line) line.push(b);
      else this.roofQueue.set(d, [b]);
    }
  }

  /**
   * Which of a covering's three pictures to lay, or a floor's, painted at
   * `ppt` pixels to the tile: the coarsest that still has a pixel of it for
   * every pixel of screen a tile's side covers. The finest shrunk to a
   * quarter was sampled, not shrunk, and a roof of courses shimmered into
   * stripes as the camera moved.
   */
  private roofMip(ppt = COVER_PPT): number {
    const side = Math.hypot(HALF_W, HALF_H) * this.camera.zoom * this.canvas.dpr;
    return ppt / 4 >= side * 0.9 ? 2 : ppt / 2 >= side * 0.9 ? 1 : 0;
  }

  /**
   * A tile of a flat roof: the covering's deck, laid across the building in
   * one piece, from the inner face of the wall round it -- the wall's own top
   * is the rim of it -- and marked out where it is only planned.
   */
  private drawDeck(floor: FloorTile, x: number, y: number, base: number, alpha: number): void {
    const ctx = this.canvas.ctx;
    const cam = this.camera;
    const bld = this.game.buildings;
    const h = base + floor.level * WALL_HEIGHT;
    const done = isDone(floor);
    const decked = (tx: number, ty: number): boolean => {
      const f = bld.floor(floor.level, tx, ty);
      return !!f && floorKind(f) === 'roof';
    };
    const u0 = decked(x - 1, y) ? 0 : WALL_THICK, u1 = decked(x + 1, y) ? 1 : 1 - WALL_THICK;
    const v0 = decked(x, y - 1) ? 0 : WALL_THICK, v1 = decked(x, y + 1) ? 1 : 1 - WALL_THICK;
    const pts = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]): [number, number] => [cam.worldToScreenX(x + u, y + v), cam.worldToScreenY(x + u, y + v, h)]);
    const cx = (pts[0][0] + pts[2][0]) / 2, cy = (pts[0][1] + pts[2][1]) / 2;
    ctx.globalAlpha = alpha * (done ? 1 : 0.4);
    // A hair past its own edges, so nothing shows between it and the next tile of it.
    ctx.beginPath();
    for (const [px, py] of pts) {
      const l = Math.hypot(px - cx, py - cy) || 1;
      ctx.lineTo(px + ((px - cx) / l) * 0.5, py + ((py - cy) / l) * 0.5);
    }
    ctx.closePath();
    const cov = covering(floor.material);
    if (done) {
      const mip = this.roofMip(), k = 1 / (COVER_PPT >> mip);
      const key = `deck:${floor.material}:${mip}`;
      let pat = this.roofPatterns.get(key);
      if (!pat) {
        pat = ctx.createPattern(cov.deck[mip], 'repeat') ?? undefined;
        if (pat) this.roofPatterns.set(key, pat);
      }
      if (pat) {
        const sx = cam.worldToScreenX(0, 0), sy = cam.worldToScreenY(0, 0, h);
        pat.setTransform(new DOMMatrix([
          cam.worldToScreenX(k, 0) - sx, cam.worldToScreenY(k, 0, h) - sy,
          cam.worldToScreenX(0, k) - sx, cam.worldToScreenY(0, k, h) - sy,
          sx, sy,
        ]));
        ctx.fillStyle = pat;
        ctx.fill();
      }
    } else {
      ctx.fillStyle = `rgba(${cov.fascia.body[0]}, ${cov.fascia.body[1]}, ${cov.fascia.body[2]}, 0.5)`;
      ctx.fill();
      ctx.beginPath();
      for (const [px, py] of pts) ctx.lineTo(px, py);
      ctx.closePath();
      ctx.strokeStyle = PLAN_COLOR;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  /** How a face turned the way a wall running `ux`, `uy` faces is lit: the light walls are drawn in. */
  private faceLight(ux: number, uy: number): number {
    const cam = this.camera;
    const vx = cam.rotateX(ux, uy);
    const along = Math.abs(vx);
    const into = Math.abs(cam.rotateY(ux, uy));
    const face = along / (along + into || 1);
    return 0.72 * (1 - face) + (vx > 0 ? 1 : 0.8) * face;
  }

  /**
   * A pitched roof, whole: see `roofshape.ts` for its shape and `roofing.ts`
   * for what covers it.
   *
   * Everything on it -- its faces, the capping along its ridges and hips, the
   * line down its valleys, the board along its eaves and up its verges, and
   * its gable ends -- goes into one list and is laid back to front. A roof is
   * a surface never over itself seen from above, so of two pieces of it the
   * one standing further down the screen is the one in front. The shade its
   * eaves throw on the walls under them goes on first, under all of it.
   */
  private drawPitchedRoof(b: Building): void {
    const main = this.canvas.ctx;
    const cam = this.camera;
    const bld = this.game.buildings;
    const world = this.game.world;
    const zoom = cam.zoom;
    const level = b.levels;
    const roofs: FloorTile[] = [];
    for (const k of b.tiles) {
      const [x, y] = k.split(',').map(Number);
      const f = bld.floor(level, x, y);
      if (f && floorKind(f) === 'roof') roofs.push(f);
    }
    if (!roofs.length) return;
    const shape = roofShapeOf(b) === 'gable' ? 'gable' : 'hip';
    const sig = `${shape}:${roofs.map((f) => `${f.x},${f.y}`).join(';')}`;
    let kept = this.roofShapes.get(b.id);
    if (!kept || kept.sig !== sig) {
      kept = { sig, model: roofModel(roofs.map((f): [number, number] => [f.x, f.y]), shape, ROOF_OVER, ROOF_VERGE, ROOF_CAP) };
      this.roofShapes.set(b.id, kept);
    }
    const model = kept.model;
    const pitch = ROOF_PITCH * roofShapeDef(b).rise;
    let eave = -Infinity;
    for (const f of roofs) eave = Math.max(eave, world.getHeight(f.x, f.y));
    eave += level * WALL_HEIGHT;
    const X = (p: RoofPt): number => cam.worldToScreenX(p[0], p[1]);
    const Y = (p: RoofPt, drop = 0): number => cam.worldToScreenY(p[0], p[1], eave + pitch * p[2] - drop);
    const deep = (x: number, y: number): number => cam.worldToScreenY(x, y, 0);
    /*
     * Standing under it, you see through it. It is laid on a layer of its own
     * and the layer put over the room at a third: laid straight on at a third,
     * every place two of its pieces overlap came out darker than the rest.
     */
    const under = !!this.roomTiles && roofs.some((f) => this.roomTiles?.has(`${f.x},${f.y}`));
    const ctx = under ? this.seeThroughCtx() : main;
    /*
     * How a face of it is lit, on the scale the walls are: the light from the
     * camera's left and from above that makes a wall facing down the screen
     * to the left the bright one, taken on a face tilted at the pitch.
     */
    const slope = pitch / UNITS_PER_TILE;
    const lightOf = (fall: Fall): number => {
      let nx = 0, ny = 0;
      if (fall !== 4) {
        const [fx, fy] = FALLS[fall];
        nx = cam.rotateX(fx, fy) * slope;
        ny = cam.rotateY(fx, fy) * slope;
      }
      const l = Math.hypot(nx, ny, 1);
      return 0.55 + 0.55 * ((-0.249 * nx + 0.498 * ny + 0.83) / l);
    };
    const mip = this.roofMip();
    const ppt = COVER_PPT >> mip;
    /** The covering with a face's light laid into it. Laid over, two faces of one plane overlapping at a seam would take it twice. */
    const patternOf = (material: string, lit: number): CanvasPattern | null => {
      const q = Math.round(lit * 50) / 50;
      const k = `${material}:${mip}:${q}`;
      let pat = this.roofPatterns.get(k);
      if (pat) {
        this.roofPatterns.delete(k);
        this.roofPatterns.set(k, pat);
        return pat;
      }
      const cov = covering(material);
      const img = cov.mips[mip];
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.drawImage(img, 0, 0);
      const a = cov.shadow(q);
      if (a > 0.001) {
        g.fillStyle = `rgba(${cov.shade[0]}, ${cov.shade[1]}, ${cov.shade[2]}, ${a.toFixed(3)})`;
        g.fillRect(0, 0, c.width, c.height);
      } else if (q > 1) {
        g.fillStyle = `rgba(255, 250, 240, ${Math.min(0.24, (q - 1) * 0.8).toFixed(3)})`;
        g.fillRect(0, 0, c.width, c.height);
      }
      pat = ctx.createPattern(c, 'repeat') ?? undefined;
      if (!pat) return null;
      this.roofPatterns.set(k, pat);
      // A camera turned all the way round asks for forty of them; the oldest go.
      while (this.roofPatterns.size > 48) {
        const first = this.roofPatterns.keys().next().value;
        if (first === undefined) break;
        this.roofPatterns.delete(first);
      }
      return pat;
    };
    /*
     * The items to lay, back to front. A run of faces of one plane next to
     * each other in that order is laid as one path, with one fill: it is
     * the same picture in the same place, and a fill is what a roof costs.
     */
    const items: Array<{ d: number; draw: () => void; plane?: string; face?: number }> = [];
    const faceDepth = model.faces.map((f) => {
      let x = 0, y = 0;
      for (const p of f.pts) { x += p[0]; y += p[1]; }
      return deep(x / f.pts.length, y / f.pts.length);
    });
    /*
     * Whether a way of falling faces the camera. A roof is one surface over
     * the ground, so a slope falling away from the camera more steeply than
     * the camera looks down is under the slopes in front of it everywhere it
     * shows: drawn, it only cost a fill and was covered.
     */
    const [gx, gy] = [cam.unrotateX(1, 1), cam.unrotateY(1, 1)];
    const gl = Math.hypot(gx, gy) || 1;
    const down = (HALF_H * Math.SQRT2) / (HEIGHT_SCALE * UNITS_PER_TILE);
    const facing = (fall: Fall): boolean => {
      if (fall === 4) return true;
      const [fx, fy] = FALLS[fall];
      return slope * ((fx * gx + fy * gy) / gl) + down > 0;
    };
    const planeOf = (f: (typeof model.faces)[number]): string => {
      const tile = roofs[f.tile];
      if (!isDone(tile)) return `plan:${tile.material}`;
      if (f.fall === 4) return `${tile.material}:4:${f.pts[0][2]}`;
      const [nx, ny] = FALLS[f.fall];
      const p0 = f.pts[0];
      return `${tile.material}:${f.fall}:${(p0[2] + nx * p0[0] + ny * p0[1]).toFixed(4)}`;
    };
    /** A face's outline, a hair past its own edges, so nothing shows between two faces of one plane. */
    const outlineOf = (f: (typeof model.faces)[number]): void => {
      const pts = f.pts.map((p): [number, number] => [X(p), Y(p)]);
      let cx = 0, cy = 0;
      for (const [x, y] of pts) { cx += x; cy += y; }
      cx /= pts.length;
      cy /= pts.length;
      pts.forEach(([x, y], i) => {
        const l = Math.hypot(x - cx, y - cy) || 1;
        const qx = x + ((x - cx) / l) * 0.5, qy = y + ((y - cy) / l) * 0.5;
        if (i) ctx.lineTo(qx, qy); else ctx.moveTo(qx, qy);
      });
      ctx.closePath();
    };
    /** Fill what has been outlined with the face's picture, laid on its plane. */
    const fillAs = (f: (typeof model.faces)[number]): void => {
      const tile = roofs[f.tile];
      if (!isDone(tile)) {
        const cov = covering(tile.material);
        ctx.fillStyle = `rgba(${cov.fascia.body[0]}, ${cov.fascia.body[1]}, ${cov.fascia.body[2]}, 0.28)`;
        ctx.fill();
        return;
      }
      const pat = patternOf(tile.material, lightOf(f.fall));
      if (!pat) return;
      /*
       * The picture laid on the plane: across it along the eave, and down it
       * from the eave's edge, so a course's tail lies along every eave.
       */
      const [nx, ny] = FALLS[f.fall === 4 ? 1 : f.fall];
      const ex = -ny, ey = nx;
      const k = 1 / ppt;
      let ox: number, oy: number, h0: number, rise: number;
      if (f.fall === 4) {
        ox = 0; oy = 0; h0 = eave + pitch * f.pts[0][2]; rise = 0;
      } else {
        const p0 = f.pts[0];
        const c = p0[2] + nx * p0[0] + ny * p0[1];
        ox = nx * (c + ROOF_OVER); oy = ny * (c + ROOF_OVER); h0 = eave - pitch * ROOF_OVER; rise = 1;
      }
      const sx = cam.worldToScreenX(ox, oy), sy = cam.worldToScreenY(ox, oy, h0);
      pat.setTransform(new DOMMatrix([
        cam.worldToScreenX(ox + ex * k, oy + ey * k) - sx, cam.worldToScreenY(ox + ex * k, oy + ey * k, h0) - sy,
        cam.worldToScreenX(ox + nx * k, oy + ny * k) - sx, cam.worldToScreenY(ox + nx * k, oy + ny * k, h0 - pitch * rise * k) - sy,
        sx, sy,
      ]));
      ctx.fillStyle = pat;
      ctx.fill();
    };
    const plan: FloorTile[] = [];
    model.faces.forEach((f, i) => {
      if (!facing(f.fall)) return;
      items.push({ d: faceDepth[i], plane: planeOf(f), face: i, draw: () => { ctx.beginPath(); outlineOf(f); fillAs(f); } });
    });
    for (const f of roofs) if (!isDone(f)) plan.push(f);
    // The creases and the edges go on after the faces they lie along.
    const byPoint = new Map<string, number[]>();
    model.faces.forEach((f, i) => {
      for (const p of f.pts) {
        const k = `${p[0]},${p[1]}`;
        const at = byPoint.get(k);
        if (at) at.push(i);
        else byPoint.set(k, [i]);
      }
    });
    const after = (a: RoofPt, bq: RoofPt): number => {
      const A = byPoint.get(`${a[0]},${a[1]}`) ?? [];
      const B = new Set(byPoint.get(`${bq[0]},${bq[1]}`) ?? []);
      let m = -Infinity;
      for (const i of A) if (B.has(i)) m = Math.max(m, faceDepth[i]);
      return m === -Infinity ? deep((a[0] + bq[0]) / 2, (a[1] + bq[1]) / 2) : m;
    };
    /** Points at every `every` tiles along a crease from `a` to `b`, counted from the world's own origin so they run on from one piece of it to the next. */
    const marks = (a: RoofPt, bq: RoofPt, every: number): RoofPt[] => {
      const out: RoofPt[] = [];
      const along = Math.abs(bq[0] - a[0]) > 1e-9 ? 0 : 1;
      const u0 = a[along], u1 = bq[along];
      if (Math.abs(u1 - u0) < 1e-9) return out;
      const lo = Math.min(u0, u1), hi = Math.max(u0, u1);
      for (let u = Math.ceil(lo / every - 1e-9) * every; u <= hi + 1e-9; u += every) {
        const t = (u - u0) / (u1 - u0);
        if (t <= 1e-6 || t >= 1 - 1e-6) continue;
        out.push([a[0] + (bq[0] - a[0]) * t, a[1] + (bq[1] - a[1]) * t, a[2] + (bq[2] - a[2]) * t]);
      }
      return out;
    };
    /** Whether any face along a crease from `a` to `b` is one the camera sees. */
    const seen = (a: RoofPt, bq: RoofPt): boolean => {
      const B = new Set(byPoint.get(`${bq[0]},${bq[1]}`) ?? []);
      return (byPoint.get(`${a[0]},${a[1]}`) ?? []).some((i) => B.has(i) && facing(model.faces[i].fall));
    };
    for (const c of model.creases) {
      if (!isDone(roofs[c.tile]) || !seen(c.a, c.b)) continue;
      items.push({ d: after(c.a, c.b) + 0.001, draw: () => {
        const cov = covering(roofs[c.tile].material);
        let ax = X(c.a), ay = Y(c.a), bx = X(c.b), by = Y(c.b);
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 0.01) return;
        const ux = (bx - ax) / len, uy = (by - ay) / len;
        if (c.kind === 'valley') {
          ctx.strokeStyle = cov.valley;
          ctx.lineWidth = Math.max(1, 1.6 * zoom);
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
          ctx.lineCap = 'butt';
          ctx.lineWidth = 1;
          return;
        }
        // A hair longer at both ends, so two pieces of one ridge meet with nothing between them.
        ax -= ux * 0.5; ay -= uy * 0.5; bx += ux * 0.5; by += uy * 0.5;
        const cap = cov.cap, w = Math.max(1.5, cap.w * zoom);
        const run = (width: number, ink: string, oy = 0): void => {
          ctx.strokeStyle = ink;
          ctx.lineWidth = width;
          ctx.beginPath(); ctx.moveTo(ax, ay + oy); ctx.lineTo(bx, by + oy); ctx.stroke();
        };
        run(w + Math.max(1.2, 1.4 * zoom), cap.dark, Math.max(0.5, 0.5 * zoom));
        run(w, cap.body);
        run(Math.max(0.8, w * 0.28), cap.hi, -w * 0.22);
        // Across it: the joints of its ridge tiles, the spars pegging a straw ridge down.
        const tick = (p: RoofPt, dx: number, dy: number, width: number, ink: string): void => {
          const px = X(p), py = Y(p);
          ctx.strokeStyle = ink;
          ctx.lineWidth = width;
          ctx.beginPath(); ctx.moveTo(px - dx, py - dy); ctx.lineTo(px + dx, py + dy); ctx.stroke();
        };
        const nX = -uy * w * 0.5, nY = ux * w * 0.5;
        if (cap.kind === 'straw') {
          for (const p of marks(c.a, c.b, cap.joint)) {
            tick(p, nX + ux * w * 0.35, nY + uy * w * 0.35, Math.max(0.8, 1.1 * zoom), cap.dark);
            tick(p, nX - ux * w * 0.35, nY - uy * w * 0.35, Math.max(0.8, 1.1 * zoom), cap.dark);
          }
        } else if (cap.joint > 0) {
          for (const p of marks(c.a, c.b, cap.joint)) tick(p, nX, nY, Math.max(0.8, 1 * zoom), cap.dark);
        }
        // And on polished metal, a cresting of finials along the ridge itself.
        if (cap.kind === 'crest' && c.kind === 'ridge') {
          for (const p of marks(c.a, c.b, 0.25)) {
            const px = X(p), py = Y(p) - w * 0.4, h = Math.max(2, 4.5 * zoom);
            ctx.strokeStyle = cap.dark;
            ctx.lineWidth = Math.max(1, 1.2 * zoom);
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - h); ctx.stroke();
            ctx.beginPath(); ctx.arc(px, py - h, Math.max(1, 1.4 * zoom), 0, Math.PI * 2);
            ctx.fillStyle = cap.hi; ctx.fill(); ctx.stroke();
          }
        }
        ctx.lineWidth = 1;
      } });
    }
    for (const e of model.edges) {
      if (!isDone(roofs[e.tile])) continue;
      const [ox, oy] = FALLS[e.out];
      if (cam.nearSide(ox, oy) < 0) continue;
      const cov = covering(roofs[e.tile].material);
      const fl = this.faceLight(-oy, ox);
      // The shade the eave throws down the wall under it, under everything.
      if (e.wall) {
        const [wa, wb] = e.wall;
        const off = (p: RoofPt): RoofPt => [p[0] + ox * WALL_THICK, p[1] + oy * WALL_THICK, 0];
        const A = off(wa), B = off(wb);
        items.push({ d: -Infinity, draw: () => {
          const top = Y(A, pitch * WALL_THICK), bottom = Y(A, 10);
          ctx.beginPath();
          ctx.moveTo(X(A), Y(A, pitch * WALL_THICK)); ctx.lineTo(X(B), Y(B, pitch * WALL_THICK));
          ctx.lineTo(X(B), Y(B, 10)); ctx.lineTo(X(A), Y(A, 10));
          ctx.closePath();
          const g = ctx.createLinearGradient(0, top, 0, bottom);
          g.addColorStop(0, 'rgba(44, 34, 56, 0.3)');
          g.addColorStop(1, 'rgba(44, 34, 56, 0)');
          ctx.fillStyle = g;
          ctx.fill();
        } });
      }
      items.push({ d: after(e.a, e.b) + 0.002, draw: () => {
        const F = cov.fascia, dp = F.deep;
        ctx.beginPath();
        ctx.moveTo(X(e.a), Y(e.a));
        ctx.lineTo(X(e.b), Y(e.b));
        ctx.lineTo(X(e.b), Y(e.b, dp));
        ctx.lineTo(X(e.a), Y(e.a, dp));
        ctx.closePath();
        if (F.kind === 'straw') {
          const g = ctx.createLinearGradient(0, Math.min(Y(e.a), Y(e.b)), 0, Math.max(Y(e.a, dp), Y(e.b, dp)));
          g.addColorStop(0, rgb(F.body, fl * 1.08));
          g.addColorStop(1, rgb(F.edge, fl));
          ctx.fillStyle = g;
        } else {
          ctx.fillStyle = rgb(F.body, fl);
        }
        ctx.fill();
        // Its foot, and on a gutter the light along its round.
        ctx.strokeStyle = rgb(F.edge, fl);
        ctx.lineWidth = Math.max(1, 1.1 * zoom);
        ctx.beginPath(); ctx.moveTo(X(e.a), Y(e.a, dp)); ctx.lineTo(X(e.b), Y(e.b, dp)); ctx.stroke();
        if (F.kind === 'gutter' || F.kind === 'cornice') {
          ctx.strokeStyle = rgb(F.body, Math.min(1.35, fl * 1.25));
          ctx.beginPath(); ctx.moveTo(X(e.a), Y(e.a, dp * 0.4)); ctx.lineTo(X(e.b), Y(e.b, dp * 0.4)); ctx.stroke();
        }
        // Along a marble eave, the ends of its covers stand up in a row of palmettes.
        if (F.kind === 'cornice' && e.kind === 'eave') {
          for (const p of marks(e.a, e.b, 1 / 8)) {
            const px = X(p), py = Y(p), r = Math.max(1.2, 2.4 * zoom);
            ctx.beginPath();
            ctx.moveTo(px - r, py);
            ctx.arc(px, py, r, Math.PI, 0);
            ctx.closePath();
            ctx.fillStyle = rgb(F.body, Math.min(1.3, fl * 1.12));
            ctx.fill();
            ctx.strokeStyle = rgb(F.edge, fl);
            ctx.lineWidth = Math.max(0.7, 0.8 * zoom);
            ctx.stroke();
          }
        }
        ctx.lineWidth = 1;
      } });
    }
    for (const g of model.gables) {
      const [ox, oy] = FALLS[g.out];
      if (cam.nearSide(ox, oy) < 0) continue;
      // Before everything along its edge: the verge over it stands further out.
      const d = Math.min(...g.line.map((p) => deep(p[0], p[1]))) - 0.001;
      // It goes up with the roof over it: under a roof only planned, it is only planned too.
      const built = g.borders.every((bb) => isDone(roofs[bb.tile]));
      items.push({ d, draw: () => {
        const was = ctx.globalAlpha;
        if (!built) ctx.globalAlpha = was * 0.3;
        this.drawGable(ctx, g, level, eave, pitch, roofs);
        ctx.globalAlpha = was;
      } });
    }
    items.sort((p, q) => p.d - q.d);
    ctx.globalAlpha = 1;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.plane === undefined || it.face === undefined) { it.draw(); continue; }
      ctx.beginPath();
      outlineOf(model.faces[it.face]);
      while (i + 1 < items.length && items[i + 1].plane === it.plane && items[i + 1].face !== undefined) {
        outlineOf(model.faces[items[i + 1].face as number]);
        i++;
      }
      fillAs(model.faces[it.face]);
    }
    // What is only planned yet is marked out where it will go.
    if (plan.length) {
      ctx.strokeStyle = PLAN_COLOR;
      ctx.setLineDash([5, 4]);
      for (const f of plan) {
        ctx.beginPath();
        for (const [cx, cy] of [[f.x, f.y], [f.x + 1, f.y], [f.x + 1, f.y + 1], [f.x, f.y + 1]]) ctx.lineTo(cam.worldToScreenX(cx, cy), cam.worldToScreenY(cx, cy, eave));
        ctx.closePath();
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    if (under) {
      main.save();
      main.setTransform(1, 0, 0, 1, 0, 0);
      main.globalAlpha = 0.35;
      main.drawImage(ctx.canvas, 0, 0);
      main.restore();
    }
  }

  /**
   * A canvas the size of the screen, for something seen through: drawn on it
   * whole and then put over the picture at the alpha asked for, once, where
   * drawn straight on at that alpha every place two of its pieces overlap came
   * out darker than the rest. Cleared over `box` -- device pixels, the whole
   * of it when not given -- and set up to be drawn on as the screen is.
   */
  private seeThrough: CanvasRenderingContext2D | null = null;
  private seeThroughCtx(box?: [number, number, number, number]): CanvasRenderingContext2D {
    const el = this.canvas.el;
    if (!this.seeThrough || this.seeThrough.canvas.width !== el.width || this.seeThrough.canvas.height !== el.height) {
      const c = document.createElement('canvas');
      c.width = el.width;
      c.height = el.height;
      this.seeThrough = c.getContext('2d') as CanvasRenderingContext2D;
    }
    const g = this.seeThrough;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (box) g.clearRect(...box);
    else g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    g.setTransform(this.canvas.ctx.getTransform());
    g.globalAlpha = 1;
    g.lineJoin = 'round';
    return g;
  }

  /**
   * A gable end: the wall carried up in a triangle under the roof's line, in
   * the wall's own picture -- the field of it, without the head of the storey
   * under it -- laid on over the top storey's a border at a time, and lit as
   * the wall is. Over a wall with no picture, in its colour.
   */
  private drawGable(ctx: CanvasRenderingContext2D, gable: RoofGable, level: number, eave: number, pitch: number, roofs: FloorTile[]): void {
    const cam = this.camera;
    const bld = this.game.buildings;
    const [ox, oy] = FALLS[gable.out];
    const dir: 'h' | 'v' = gable.out === 0 || gable.out === 2 ? 'v' : 'h';
    const dx = dir === 'h' ? 1 : 0, dy = dir === 'h' ? 0 : 1;
    /** A point on the outer face of the wall: a world point on its line, `h` height units over the eaves. */
    const at = (x: number, y: number, h: number): [number, number] => [
      cam.worldToScreenX(x + ox * WALL_THICK, y + oy * WALL_THICK),
      cam.worldToScreenY(x + ox * WALL_THICK, y + oy * WALL_THICK, eave + h),
    ];
    const first = gable.line[0], last = gable.line[gable.line.length - 1];
    const outline = (): void => {
      ctx.beginPath();
      ctx.moveTo(...at(first[0], first[1], 0));
      for (const p of gable.line) ctx.lineTo(...at(p[0], p[1], pitch * p[2]));
      ctx.lineTo(...at(last[0], last[1], 0));
      ctx.closePath();
    };
    const lit = this.faceLight(dx, dy);
    const top = Math.max(...gable.line.map((p) => p[2])) * pitch;
    ctx.save();
    outline();
    ctx.clip();
    let shaded: Masonry | undefined;
    for (const b of gable.borders) {
      const border: Border = { dir, x: b.x, y: b.y };
      const wall = bld.wallOnBorder(level - 1, border);
      const cob = wall && isDone(wall) ? this.masonryOf(wall) : undefined;
      const [ax, ay] = borderPoints(border);
      const P = (t: number, h: number): [number, number] => at(ax + dx * t, ay + dy * t, h);
      if (!cob) {
        const mat = MATERIAL_BY_ID.get(wall?.material ?? roofs[b.tile].material);
        ctx.beginPath();
        ctx.moveTo(...P(-0.01, -1)); ctx.lineTo(...P(1.01, -1)); ctx.lineTo(...P(1.01, top + 2)); ctx.lineTo(...P(-0.01, top + 2));
        ctx.closePath();
        ctx.fillStyle = rgb(mat ? this.painted(mat, wall?.dye).color : [180, 160, 140], lit);
        ctx.fill();
        continue;
      }
      shaded = shaded ?? cob;
      const n = cob.face.length;
      const v = cob.scatter ? scatterOf(border, level, n) : Math.abs(border.x * 31 + border.y * 17 + level * 7) % n;
      const img = cob.face[v];
      const head = cob.head, fh = img.height - head;
      const turned = !!cob.handed && P(1, 0)[0] < P(0, 0)[0];
      const [t0, t1] = turned ? [1.01, -0.01] : [-0.01, 1.01];
      // A storey's field at a time, from the head of the top storey up.
      const step = (WALL_HEIGHT * fh) / img.height;
      for (let h = 0; h < top; h += step) {
        const [tlx, tly] = P(t0, h + step), [trx, try_] = P(t1, h + step), [blx, bly] = P(t0, h);
        ctx.save();
        ctx.transform((trx - tlx) / img.width, (try_ - tly) / img.width, (blx - tlx) / fh, (bly - tly) / fh, tlx, tly);
        ctx.drawImage(img, 0, head, img.width, fh, 0, 0, img.width, fh);
        ctx.restore();
      }
    }
    if (shaded) {
      const [sr, sg, sb] = shaded.shade;
      outline();
      ctx.fillStyle = `rgba(${sr}, ${sg}, ${sb}, ${shaded.shadow(lit).toFixed(3)})`;
      ctx.fill();
    }
    ctx.restore();
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

  /**
   * A slab poured over a tile, or the shuttering waiting for it.
   *
   * The top is one flat quad at the level chosen, drawn in whatever the tile
   * has been surfaced with — concrete until somebody paves it, and then the
   * paving, joints and all, because a foundation is ground you may pave. The
   * sides are the two the camera is on, each running from the ground's own
   * corner heights straight up to that level: that vertical face is the whole
   * of what a foundation is, and it is the thing you can put a wall against.
   */
  private drawFoundation(x: number, y: number, lit: boolean): void {
    const f = this.game.foundationAt(x, y);
    if (!f) return;
    const ctx = this.canvas.ctx;
    const cam = this.camera;
    const world = this.game.world;
    const c = world.tileCorners(x, y);
    /** The tile's four corners in world space, north, east, south, west. */
    const at: Array<[number, number]> = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
    /** Which way is out through the edge that leaves corner `i`. */
    const out: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const px = (i: number): number => cam.worldToScreenX(at[i][0], at[i][1]);
    const py = (i: number, h: number): number => cam.worldToScreenY(at[i][0], at[i][1], h);
    const done = foundationDone(f);
    ctx.globalAlpha = lit ? 1 : 0.55;
    if (!done) {
      /*
       * Boards and string. A plan has no concrete in it yet, so drawing it as
       * a slab would be a lie you could walk into: what is there is the line
       * it will be poured to and the shutters holding it.
       */
      ctx.strokeStyle = PLAN_COLOR;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const p = i === 0 ? ctx.moveTo.bind(ctx) : ctx.lineTo.bind(ctx);
        p(px(i), py(i, f.top));
      }
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(px(i), py(i, c[i]));
        ctx.lineTo(px(i), py(i, f.top));
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
      return;
    }
    // The faces, nearest last so the one across the view lies over the one
    // running into it, as a wall's two faces do.
    const zoom = cam.zoom;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const [nx, ny] = out[i];
      if (cam.nearSide(nx, ny) <= 0) continue;
      const face = (): void => {
        ctx.beginPath();
        ctx.moveTo(px(i), py(i, f.top));
        ctx.lineTo(px(j), py(j, f.top));
        ctx.lineTo(px(j), py(j, c[j]));
        ctx.lineTo(px(i), py(i, c[i]));
        ctx.closePath();
      };
      // The face that runs across the view catches more light than the one
      // running into it: the same two tones every wall in the world uses.
      const lit = Math.abs(cam.rotateX(nx, ny)) > Math.abs(cam.rotateY(nx, ny)) ? 0.82 : 0.66;
      face();
      ctx.fillStyle = rgb(CONCRETE, lit);
      ctx.fill();
      /*
       * Board-marked, as concrete cast against shuttering is: a line where
       * each board met the next, every other board a shade off its
       * neighbour, and the holes the ties went through on every other line.
       * Straight across however the ground under it falls, because the
       * boards were set level and the ground was dug to them.
       */
      if (zoom >= 0.5) {
        ctx.save();
        face();
        ctx.clip();
        const lo = Math.min(c[i], c[j]);
        /** A point `t` of the way along the face, at height `h`. */
        const on = (t: number, h: number): [number, number] => {
          const wx = at[i][0] + (at[j][0] - at[i][0]) * t, wy = at[i][1] + (at[j][1] - at[i][1]) * t;
          return [cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, h)];
        };
        for (let k = 0, h = f.top; h > lo; k++, h -= SHUTTER) {
          const [a0, b0] = [on(0, h), on(1, h)], [a1, b1] = [on(0, h - SHUTTER), on(1, h - SHUTTER)];
          if (k % 2) {
            ctx.beginPath();
            ctx.moveTo(a0[0], a0[1]); ctx.lineTo(b0[0], b0[1]); ctx.lineTo(b1[0], b1[1]); ctx.lineTo(a1[0], a1[1]);
            ctx.closePath();
            ctx.fillStyle = 'rgba(40, 36, 48, 0.05)';
            ctx.fill();
          }
          ctx.beginPath();
          ctx.moveTo(a1[0], a1[1]);
          ctx.lineTo(b1[0], b1[1]);
          ctx.strokeStyle = 'rgba(40, 36, 48, 0.2)';
          ctx.lineWidth = Math.max(0.7, zoom * 0.9);
          ctx.stroke();
          if (k % 2 === 1) {
            for (const t of [0.25, 0.75]) {
              const [tx, ty] = on(t, h - SHUTTER * 0.5);
              ctx.fillStyle = 'rgba(40, 36, 48, 0.35)';
              ctx.beginPath(); ctx.arc(tx, ty, Math.max(0.8, zoom * 1.1), 0, Math.PI * 2); ctx.fill();
            }
          }
        }
        ctx.restore();
      }
      face();
      ctx.strokeStyle = rgb(CONCRETE_TRIM, 0.85);
      ctx.lineWidth = 1;
      ctx.stroke();
      // The arris along its top, where the light catches it.
      ctx.beginPath();
      ctx.moveTo(px(i), py(i, f.top));
      ctx.lineTo(px(j), py(j, f.top));
      ctx.strokeStyle = rgb(CONCRETE, Math.min(1.25, lit * 1.3));
      ctx.lineWidth = Math.max(1, zoom * 1.2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    const quad = new Float64Array(8);
    for (let i = 0; i < 4; i++) {
      quad[i * 2] = px(i);
      quad[i * 2 + 1] = py(i, f.top);
    }
    ctx.beginPath();
    ctx.moveTo(quad[0], quad[1]);
    ctx.lineTo(quad[2], quad[3]);
    ctx.lineTo(quad[4], quad[5]);
    ctx.lineTo(quad[6], quad[7]);
    ctx.closePath();
    const t = world.viewTile(x, y, lit) as TileType;
    const data = world.viewData(x, y, lit);
    const paved = PAVED.has(t);
    const base = !paved ? CONCRETE : t === TileType.Slabs ? SLAB_VARIANTS[slabVariant(data)].color : (TILE_DEFS[t]?.color ?? CONCRETE);
    ctx.fillStyle = rgb(base, 0.97);
    ctx.fill();
    ctx.strokeStyle = rgb(CONCRETE_TRIM, 0.9);
    ctx.stroke();
    // A floor's corners are already in the tile's own order, so nothing turns.
    if (cam.zoom >= 0.75) {
      if (paved) this.paving(t, x, y, data, quad, 0);
      else this.laidOver(concrete(), quad, 0, 'overlay');
    }
    ctx.globalAlpha = 1;
  }

  /**
   * A floor, laid rather than coloured in: see `flooring.ts` for what each
   * material lays one in.
   *
   * It was one lozenge of the material's floor colour a tile, with boards
   * ruled over the woods and a grid over every stone, so oak and pine were
   * one floor in two browns and brick, marble and slate one chequer in three
   * colours. The floor is a picture now, laid as a pattern fixed to the
   * world, so a room is one floor and a board runs on over the join between
   * two tiles of it. Boards run the way the building runs, which is what
   * makes a room of them read as one floor rather than as a grid of tiles
   * each doing its own thing.
   *
   * An upper floor has a thickness wherever nothing carries on from it and
   * the camera can see its edge: at the edge of the storey, and round the
   * well a flight comes up through. A ladder's hatch cuts its own.
   */
  private drawFloor(floor: FloorTile, x: number, y: number, base: number, alpha: number): void {
    const ctx = this.canvas.ctx;
    const cam = this.camera;
    const bare = MATERIAL_BY_ID.get(floor.material);
    if (!bare) return;
    const paint = floor.dye ? this.painted(bare, floor.dye).color : undefined;
    const fl = flooring(floor.material, paint);
    const h = base + floor.level * WALL_HEIGHT + 0.5;
    const done = isDone(floor);
    /** A point on the deck, by its two shares across the tile, and `dh` under it. */
    const fx = (u: number, v: number): number => cam.worldToScreenX(x + u, y + v);
    const fy = (u: number, v: number, dh = 0): number => cam.worldToScreenY(x + u, y + v, h - dh);
    const corners: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    ctx.globalAlpha = alpha * (done ? 1 : 0.4);
    if (done) {
      /*
       * A hair past its own edges, so nothing of what is under it shows
       * between it and the next tile of it -- except seen through, where the
       * hair laid twice is a line across the ceiling.
       */
      const cx = fx(0.5, 0.5), cy = fy(0.5, 0.5), grow = alpha < 1 ? 0 : 0.5;
      ctx.beginPath();
      for (const [u, v] of corners) {
        const px = fx(u, v), py = fy(u, v), l = Math.hypot(px - cx, py - cy) || 1;
        ctx.lineTo(px + ((px - cx) / l) * grow, py + ((py - cy) / l) * grow);
      }
      ctx.closePath();
      const mip = this.roofMip(FLOOR_PPT), k = 1 / (FLOOR_PPT >> mip);
      // Boards run with the building: along one axis on one storey and across it on the next.
      const turned = fl.runs && (floor.building + floor.level) % 2 === 1;
      const key = `${floor.material}:${floor.dye ?? ''}:${mip}`;
      let pat = this.floorPatterns.get(key);
      if (!pat) {
        pat = ctx.createPattern(fl.mips[mip], 'repeat') ?? undefined;
        if (pat) this.floorPatterns.set(key, pat);
      }
      if (pat) {
        const sx = cam.worldToScreenX(0, 0), sy = cam.worldToScreenY(0, 0, h);
        const ax = cam.worldToScreenX(k, 0) - sx, ay = cam.worldToScreenY(k, 0, h) - sy;
        const bx = cam.worldToScreenX(0, k) - sx, by = cam.worldToScreenY(0, k, h) - sy;
        pat.setTransform(new DOMMatrix(turned ? [bx, by, ax, ay, sx, sy] : [ax, ay, bx, by, sx, sy]));
        ctx.fillStyle = pat;
      } else {
        ctx.fillStyle = rgb(fl.mean, 1);
      }
      ctx.fill();
    } else {
      ctx.beginPath();
      for (const [u, v] of corners) ctx.lineTo(fx(u, v), fy(u, v));
      ctx.closePath();
      ctx.fillStyle = rgb(fl.mean, 1);
      ctx.fill();
      ctx.strokeStyle = PLAN_COLOR;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    /*
     * And the edge of the deck, where there is nothing to carry on into. A
     * floor is joists and boards and it has a depth, under the deck walked
     * on: drawn without one it ends in a line, which is the one thing a floor
     * five metres up never does, and drawn standing up from its edge it is a
     * kerb round every hole in it. It is edged in what its flights are built
     * of, the board or the stone along their sides.
     */
    if (done && floor.level > 0) {
      const bld = this.game.buildings;
      const st = stairStyle(floor.material);
      const lum = (c: readonly [number, number, number]): number => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      const C = (c: readonly [number, number, number], k: number, a = 1): string =>
        paint ? rgb(paint, k * Math.max(0.6, Math.min(1.3, lum(c) / Math.max(1, lum(st.string)))), a) : rgb(c, k, a);
      /*
       * The two edges facing the camera, whichever two those are: turn the
       * view and the other pair comes round, the same rule a wall uses to
       * pick the face it shows.
       */
      const edges: Array<[number, number, number, number, number, number]> = [
        [0, 0, 1, 0, 0, -1],
        [1, 0, 1, 1, 1, 0],
        [1, 1, 0, 1, 0, 1],
        [0, 1, 0, 0, -1, 0],
      ];
      for (const [u0, v0, u1, v1, nx, ny] of edges) {
        if (cam.rotateX(nx, ny) + cam.rotateY(nx, ny) < 1e-6) continue;
        // Nothing beyond it, or the well a flight comes up: a ladder's hatch is cut when the ladder goes in.
        const beyond = bld.floor(floor.level, x + nx, y + ny);
        if (beyond && floorKind(beyond) !== 'stairs') continue;
        const across = Math.abs(cam.rotateX(nx, ny)) > Math.abs(cam.rotateY(nx, ny));
        // The edge that runs across the view catches more of the light than
        // the one that runs into it, as a wall's two faces do.
        const lit = across ? 0.95 : 0.76;
        ctx.beginPath();
        ctx.moveTo(fx(u0, v0), fy(u0, v0));
        ctx.lineTo(fx(u1, v1), fy(u1, v1));
        ctx.lineTo(fx(u1, v1), fy(u1, v1, FLOOR_DEEP));
        ctx.lineTo(fx(u0, v0), fy(u0, v0, FLOOR_DEEP));
        ctx.closePath();
        ctx.fillStyle = C(st.string, lit);
        ctx.fill();
        ctx.strokeStyle = C(st.line, 1, 0.55);
        ctx.lineWidth = Math.max(0.8, cam.zoom);
        ctx.stroke();
        // The arris, where the light catches it.
        ctx.beginPath();
        ctx.moveTo(fx(u0, v0), fy(u0, v0));
        ctx.lineTo(fx(u1, v1), fy(u1, v1));
        ctx.strokeStyle = C(st.stringHi, lit * 1.05);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * A stake at each end of a border, a string between them and a brace across:
   * the site marked out, which is all a plan is until somebody builds on it.
   */
  private drawScaffold(border: Border, base: number, level: number, alpha: number): void {
    const ctx = this.canvas.ctx;
    const cam = this.camera;
    const [ax, ay, bx, by] = borderPoints(border);
    const h0 = base + level * WALL_HEIGHT;
    const h1 = h0 + WALL_HEIGHT * SCAFFOLD_HEIGHT;
    const px = (t: number): number => cam.worldToScreenX(ax + (bx - ax) * t, ay + (by - ay) * t);
    const py = (t: number, k: number): number => cam.worldToScreenY(ax + (bx - ax) * t, ay + (by - ay) * t, h0 + (h1 - h0) * k);
    const line = (t0: number, k0: number, t1: number, k1: number): void => {
      ctx.beginPath();
      ctx.moveTo(px(t0), py(t0, k0));
      ctx.lineTo(px(t1), py(t1, k1));
      ctx.stroke();
    };
    ctx.globalAlpha = alpha;
    // The chalk line on the ground, which is the line the wall will stand on.
    ctx.strokeStyle = PLAN_COLOR;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    line(0, 0, 1, 0);
    ctx.setLineDash([]);
    /*
     * And the string between the stakes, which is the whole of what a marked
     * out site is. It had a diagonal brace across it for a moment, and eight
     * of those round a two by two footprint read as a cat's cradle rather than
     * a building: the line a wall will stand on is the thing worth drawing.
     */
    ctx.strokeStyle = SCAFFOLD_LINE;
    ctx.lineWidth = 1.4;
    line(0.05, 1, 0.95, 1);
    // And the stakes themselves, which are the only solid thing about a plan.
    ctx.fillStyle = SCAFFOLD_POST;
    ctx.strokeStyle = SCAFFOLD_TRIM;
    ctx.lineWidth = 1;
    for (const t of [0.05, 0.95]) {
      const w = 0.045;
      ctx.beginPath();
      ctx.moveTo(px(t - w), py(t - w, 0));
      ctx.lineTo(px(t + w), py(t + w, 0));
      ctx.lineTo(px(t + w), py(t + w, 1));
      ctx.lineTo(px(t - w), py(t - w, 1));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The masonry a wall -- or a flight of stairs, or anything else built of a
   * material -- is painted in, or none: the others are ruled in flat colours,
   * and a coat of paint over any of them would be two walls at once, so a
   * dyed one goes down to the flat colours with everything else.
   */
  private masonryOf(wall: { material: string; dye?: string }): Masonry | undefined {
    return wall.dye ? undefined
      : wall.material === 'cobblestone' ? cobble()
        : wall.material === 'clay_bricks' ? brickwork()
          : wall.material === 'stone_brick' ? stonework()
            : wall.material === 'sandstone' ? sandstone()
              : wall.material === 'slate' ? slatework()
                : wall.material === 'marble' ? marblework()
                  : wall.material === 'clay_adobe' ? adobe()
                    : wall.material === 'timbercraft' ? timbercraft()
                      : wall.material === 'log' ? logwork()
                        : wall.material === 'plank' ? planking()
                          : wall.material === 'ornate_silver' ? silverwork()
                            : wall.material === 'ornate_gold' ? goldwork()
                              : undefined;
  }

  /**
   * How tall a wall stands, as a share of a storey: its type's height, except
   * that on a masonry laid by hand, or framed, a gate hung in a run of taller
   * garden wall stands to that wall's height. Its piers or its posts are the
   * wall built up either side of it, and a gate a foot lower than the wall it
   * hangs in was a notch. On a masonry whose gates hang between piers, the
   * gate stands its piers' height over the tallest wall it hangs in.
   */
  private standing(wall: Wall, border: Border): number {
    const own = WALL_TYPE_BY_ID.get(wall.type)?.height ?? 1;
    const gate = (w: Wall): boolean => w.type === 'fence_gate' || w.type === 'iron_gate';
    const cob = gate(wall) ? this.masonryOf(wall) : undefined;
    if (!cob || !(cob.wrap || cob.piers)) return own;
    let near = 0;
    for (const i of [-1, 1]) {
      const b: Border = border.dir === 'h'
        ? { dir: 'h', x: border.x + i, y: border.y }
        : { dir: 'v', x: border.x, y: border.y + i };
      const w = this.game.buildings.wallOnBorder(wall.level, b);
      const k = w && WALL_TYPE_BY_ID.get(w.type);
      if (w && isDone(w) && !gate(w) && k?.low) near = Math.max(near, k.height ?? 1);
    }
    return Math.max(own, near + (cob.piers && near ? cob.piers : 0));
  }

  /** Per building, which way its floor joists run, and how many tiles it had when that was worked out. */
  private joists = new Map<number, { n: number; h: boolean }>();

  /**
   * Whether a wall is one of the two a building's floor joists rest on.
   *
   * A joist spans the short way across a house, because that is the length
   * of timber there is, so it rests on the two long walls and the gable walls
   * carry none. A square house has its joists run north to south, which puts
   * the beam ends on the fronts people build toward the sun.
   */
  private bearsJoists(id: number, border: Border): boolean {
    const b = this.game.buildings.list.get(id);
    if (!b) return false;
    let had = this.joists.get(id);
    if (!had || had.n !== b.tiles.length) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const key of b.tiles) {
        const i = key.indexOf(',');
        const x = +key.slice(0, i), y = +key.slice(i + 1);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      had = { n: b.tiles.length, h: x1 - x0 >= y1 - y0 };
      this.joists.set(id, had);
    }
    return had.h === (border.dir === 'h');
  }

  /**
   * A wall, with a thickness to it.
   *
   * Reported: "walls are paper thin and have no character." They were exactly
   * paper: one quad standing on the border line, one flat colour, and a few
   * lines ruled across it. Nothing in that says how thick a thing is or what
   * it is made of, and a village of it reads as folded card.
   *
   * So a wall is a box now rather than a curtain. It is centred on its border
   * and carries three faces: the one the camera is on, the cap along its top —
   * which catches the sky and is the whole of what says "thick" in a view from
   * above — and, at an end with nothing carrying on from it, the end grain.
   * The three are lit apart: the top brightest, the face by its angle to the
   * light as before, the end in shadow.
   *
   * What it is made of is drawn on the face by `wallGrain`, and only when you
   * are near enough to see it; from far off a wall is its three faces and
   * that is the right amount of a wall.
   */
  private drawWall(wall: Wall, border: Border, base: number, alpha: number): void {
    const ctx = this.canvas.ctx;
    const cam = this.camera;
    const bare = MATERIAL_BY_ID.get(wall.material);
    if (!bare) return;
    const mat = this.painted(bare, wall.dye);
    const [ax, ay, bx, by] = borderPoints(border);
    const kind = WALL_TYPE_BY_ID.get(wall.type);
    const cob = this.masonryOf(wall);
    const tall = this.standing(wall, border);
    const h0 = base + wall.level * WALL_HEIGHT;
    const h1 = h0 + WALL_HEIGHT * tall;
    const dx = bx - ax;
    const dy = by - ay;
    /*
     * Across the border, and which way of the two is the camera's.
     *
     * Everything further down the screen is nearer in this projection, and a
     * step across the wall moves down the screen by `u + v`, so the sign of
     * that is the side we can see. It is worked out per wall rather than per
     * building: turn the view and the other face comes round.
     */
    const half = (kind?.railed ? FENCE_THICK : WALL_THICK) * (kind?.thick ?? 1);
    const nx = -dy * half;
    const ny = dx * half;
    const toward = cam.nearSide(nx, ny);
    /** A point on the wall: `t` along it, `k` up it, `s` the near face or the far one. */
    const px = (t: number, k: number, s = 1): number =>
      cam.worldToScreenX(ax + dx * t + nx * s * toward, ay + dy * t + ny * s * toward);
    const py = (t: number, k: number, s = 1): number =>
      cam.worldToScreenY(ax + dx * t + nx * s * toward, ay + dy * t + ny * s * toward, h0 + (h1 - h0) * k);
    const quad = (t0: number, t1: number, k0: number, k1: number, s = 1): void => {
      ctx.beginPath();
      ctx.moveTo(px(t0, k0, s), py(t0, k0, s));
      ctx.lineTo(px(t1, k0, s), py(t1, k0, s));
      ctx.lineTo(px(t1, k1, s), py(t1, k1, s));
      ctx.lineTo(px(t0, k1, s), py(t0, k1, s));
      ctx.closePath();
    };
    /** The cap across the top of a run, front edge to back edge. */
    const cap = (t0: number, t1: number, k: number): void => {
      ctx.beginPath();
      ctx.moveTo(px(t0, k, 1), py(t0, k, 1));
      ctx.lineTo(px(t1, k, 1), py(t1, k, 1));
      ctx.lineTo(px(t1, k, -1), py(t1, k, -1));
      ctx.lineTo(px(t0, k, -1), py(t0, k, -1));
      ctx.closePath();
    };
    /** And the end of a run, where the thickness shows as end grain: all of it, or from `s0` to `s1` across it. */
    const endOf = (t: number, k0: number, k1: number, s0 = -1, s1 = 1): void => {
      ctx.beginPath();
      ctx.moveTo(px(t, k0, s1), py(t, k0, s1));
      ctx.lineTo(px(t, k0, s0), py(t, k0, s0));
      ctx.lineTo(px(t, k1, s0), py(t, k1, s0));
      ctx.lineTo(px(t, k1, s1), py(t, k1, s1));
      ctx.closePath();
    };
    // The face running along the view's x axis catches the light. How much of
    // it does is a matter of degree rather than a choice between two: turning
    // the view an eighth would otherwise jump a wall between the two tones,
    // and at a diagonal it is neither.
    const litOf = (ux: number, uy: number): number => {
      const vx = cam.rotateX(ux, uy);
      const along = Math.abs(vx);
      const into = Math.abs(cam.rotateY(ux, uy));
      const face = along / (along + into || 1);
      return 0.72 * (1 - face) + (vx > 0 ? 1 : 0.8) * face;
    };
    const lit = litOf(dx, dy);
    // A cap looks at the sky.
    const topLit = Math.min(1.3, lit * 1.24);
    /*
     * An end of a wall is a face turned square to it, and it is lit as that
     * face is -- as the face of a wall running the other way, or the face
     * round the corner it carries on. A quarter under the wall's own light,
     * it was a post of a darker colour than either face down every free end,
     * and where a fence stepped up to a half wall the step was a dark rule.
     */
    const endLit = litOf(border.dir === 'h' ? 0 : 1, border.dir === 'h' ? 1 : 0);
    const done = isDone(wall);
    const zoom = cam.zoom;
    /**
     * Whether a wall of the same storey carries on past this one's end, and
     * covers it.
     *
     * A neighbour that is lower or thinner does not. Where a garden wall
     * steps up from a fence to a half wall the taller one's end stood open --
     * nothing carried on at its full height or thickness, but something was
     * there, so no end was drawn and the grass showed through the step.
     */
    const on = (i: number): boolean => {
      const b: Border = border.dir === 'h'
        ? { dir: 'h', x: border.x + i, y: border.y }
        : { dir: 'v', x: border.x, y: border.y + i };
      const w = this.game.buildings.wallOnBorder(wall.level, b);
      if (!w || !isDone(w)) return false;
      const k2 = WALL_TYPE_BY_ID.get(w.type);
      const half2 = (k2?.railed ? FENCE_THICK : WALL_THICK) * (k2?.thick ?? 1);
      return this.standing(w, b) >= tall - 1e-6 && half2 >= half - 1e-9;
    };
    /*
     * What this wall meets at each end, and so where its face and its top
     * stop.
     *
     * A section is a box one border long and a wall's thickness deep, and two
     * boxes meeting at a corner neither cover the square the corner is nor
     * leave it alone: each overlaps the other in one quarter of it and the
     * quarter at the arris is left open, with the end grain of one of them
     * showing in the notch -- a post of another colour down every corner. So
     * each end looks at the walls square to it there, finished and standing
     * at least as tall as this one: one on the camera's side (`near`) is a
     * wall this one's face runs into, and the face stops at its face; one
     * only on the far side is a corner this face turns, and it runs on to the
     * arris. The top is one wall's at a corner: the one running east and west
     * carries its top over the corner and the other's stops at it; at a T it
     * is the through wall's, at a cross the east-west run's. A lower wall that
     * meets a taller one square stops at its face, top and all, whatever
     * else is there. And an end shows only where nothing covers it and it
     * faces the camera: turned away it lies behind the face, and drawn after
     * it, it was a strip of end grain laid over the face's end.
     */
    const crossAt = (i: -1 | 1, near: boolean): { h: number; st: number } | null => {
      const t = i < 0 ? 0 : 1;
      const cx = border.dir === 'h' ? border.x + t : border.x;
      const cy = border.dir === 'h' ? border.y : border.y + t;
      const mine = near === toward > 0;
      const b: Border = border.dir === 'h'
        ? { dir: 'v', x: cx, y: mine ? cy : cy - 1 }
        : { dir: 'h', x: mine ? cx - 1 : cx, y: cy };
      const w = this.game.buildings.wallOnBorder(wall.level, b);
      if (!w || !isDone(w)) return null;
      const k2 = WALL_TYPE_BY_ID.get(w.type);
      return { h: (k2?.railed ? FENCE_THICK : WALL_THICK) * (k2?.thick ?? 1), st: this.standing(w, b) };
    };
    /** And the finished wall carrying on in line past the `i` end, of whatever size. */
    const lineAt = (i: -1 | 1): { h: number; st: number } | null => {
      const b: Border = border.dir === 'h'
        ? { dir: 'h', x: border.x + i, y: border.y }
        : { dir: 'v', x: border.x, y: border.y + i };
      const w = this.game.buildings.wallOnBorder(wall.level, b);
      if (!w || !isDone(w)) return null;
      const k2 = WALL_TYPE_BY_ID.get(w.type);
      return { h: (k2?.railed ? FENCE_THICK : WALL_THICK) * (k2?.thick ?? 1), st: this.standing(w, b) };
    };
    /*
     * Walls of two heights. A lower wall that comes up to a taller one stops
     * at its face, wherever it meets it. And where a taller wall's end has
     * nothing as tall at it and nothing carrying on from it, but lower walls
     * come up to it square -- a half wall at the corner of a fence, or into
     * the side of a run of one -- its body goes on past the end through
     * their thickness (`past`), so that it is the taller one that fills the
     * angle. It stopped on the lower wall's centre line, and with the lower
     * one stopped at its face that left a slot half a fence thick with the
     * grass showing through it.
     */
    const joins = ([-1, 1] as const).map((i) => {
      const near = crossAt(i, true), far = crossAt(i, false), line = lineAt(i);
      const big = (j: { h: number; st: number } | null): { h: number; up: boolean } | null =>
        j && j.st >= tall - 1e-6 ? { h: j.h, up: j.st > tall + 1e-6 } : null;
      const P = big(near), Q = big(far), n = on(i);
      const past = !n && !P && !Q && !line ? Math.max(near?.h ?? 0, far?.h ?? 0) : 0;
      return { i, n, P, Q, line, past, up: Math.max(P?.up ? P.h : 0, Q?.up ? Q.h : 0) };
    });
    const joinAt = (i: -1 | 1): (typeof joins)[number] => joins[i < 0 ? 0 : 1];
    /** Where the face on the camera's side stops at the `i` end, along the run. */
    const faceEnd = (i: -1 | 1): number => {
      const edge = i < 0 ? 0 : 1, { n, P, Q, up, past } = joinAt(i);
      if (past) return edge + i * past;
      if (up) return edge - i * up;
      if (n) return edge;
      if (P) return edge - i * P.h;
      if (Q) return edge + i * Q.h;
      return edge;
    };
    /** And where the top stops. */
    const capEnd = (i: -1 | 1): number => {
      const edge = i < 0 ? 0 : 1, { n, P, Q, up, past } = joinAt(i);
      if (past) return edge + i * past;
      if (up) return edge - i * up;
      if (P && Q) return n && border.dir === 'h' ? edge : edge - i * Math.max(P.h, Q.h);
      const R = P ?? Q;
      if (!R || n) return edge;
      return border.dir === 'h' ? edge + i * R.h : edge - i * R.h;
    };
    /** Whether the `i` end turns toward the camera. */
    const facing = (i: -1 | 1): boolean => (cam.rotateX(dx, dy) + cam.rotateY(dx, dy)) * i > 1e-6;
    /** Whether the end grain at the `i` end is there to be seen. */
    const endShows = (i: -1 | 1): boolean => {
      const { n, P, Q, up } = joinAt(i);
      return !n && !P && !Q && !up && facing(i);
    };
    /**
     * The part of an end still to be seen where it stops at the face of a
     * taller wall that meets it from one side only, beside a taller but
     * thinner wall carrying on in line -- a half wall run on from the corner
     * of a house, which is thicker than the house's wall: the edge of its end
     * stands out past the house's corner, and left undrawn it was a slit of
     * grass. As a span across the end, or null.
     */
    const proud = (i: -1 | 1): [number, number] | null => {
      const { P, Q, up, line } = joinAt(i);
      if (!up || (P && Q) || !line || line.st <= tall + 1e-6 || line.h >= half - 1e-9 || !facing(i)) return null;
      return P ? [-1, -line.h / half] : [line.h / half, 1];
    };
    ctx.globalAlpha = alpha;
    if (!done) {
      /*
       * A plan, and then a plan filling. It keeps the thickness — a wall that
       * grew a body the moment its last plank went in would jump — but the
       * body is only drawn as far up as the materials have reached.
       */
      const progress = progressOf(wall);
      if (progress > 0) {
        quad(0, 1, 0, progress);
        ctx.fillStyle = rgb(mat.color, lit, 0.9);
        ctx.fill();
        cap(0, 1, progress);
        ctx.fillStyle = rgb(mat.color, topLit, 0.9);
        ctx.fill();
      }
      quad(0, 1, progress, 1);
      ctx.fillStyle = rgb(mat.color, lit, 0.18);
      ctx.fill();
      quad(0, 1, 0, 1);
      ctx.strokeStyle = PLAN_COLOR;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      return;
    }
    if (kind?.railed && !cob) {
      /*
       * Posts and rails, each of them a piece of timber with a top to it: a
       * fence drawn flat is a comb, and a comb is what this was.
       *
       * A fence in paint only: every masonry has a garden wall of its own,
       * drawn below, and a stone fence is not posts and rails -- it is a wall
       * you can see over.
       *
       * A post stands at each end of a section and one halfway along, square
       * and a tenth of a tile across, the ones at the ends centred on the
       * corner of the tile. Where sections meet -- in a run, at a corner, at a
       * T -- each of them draws the same post in the same place, and the
       * joint has one post. Each section's end posts stood a hand's breadth
       * in from its own ends, and every joint was a pair of posts side by
       * side. Where the fence runs into a wall, the wall is the post: the
       * rails stop at its face and no post is drawn inside it.
       */
      const P = 0.05, S = P / half;
      const bld = this.game.buildings;
      const rail = (w: Wall): boolean => !!WALL_TYPE_BY_ID.get(w.type)?.railed && !this.masonryOf(w);
      /** Whether anything but more of this fence meets the `i` end. */
      const walled = (i: -1 | 1): boolean => {
        const t = i < 0 ? 0 : 1, cx = ax + dx * t, cy = ay + dy * t;
        const round = [
          { dir: 'h', x: cx - 1, y: cy }, { dir: 'h', x: cx, y: cy }, { dir: 'v', x: cx, y: cy - 1 }, { dir: 'v', x: cx, y: cy },
        ] as Border[];
        return round.some((b) => {
          if (b.dir === border.dir && b.x === border.x && b.y === border.y) return false;
          const w = bld.wallOnBorder(wall.level, b);
          return !!w && isDone(w) && !rail(w);
        });
      };
      // Which end of a post turns toward the camera, lit as a face running the other way.
      const toCam = cam.rotateX(dx, dy) + cam.rotateY(dx, dy);
      const post = (t: number): void => {
        const t0 = t - P, t1 = t + P;
        quad(t0, t1, 0, 1, S);
        ctx.fillStyle = rgb(mat.color, lit);
        ctx.fill();
        ctx.strokeStyle = rgb(mat.trim, lit * 0.9);
        ctx.stroke();
        if (Math.abs(toCam) > 1e-6) {
          const te = toCam > 0 ? t1 : t0;
          ctx.beginPath();
          ctx.moveTo(px(te, 0, S), py(te, 0, S));
          ctx.lineTo(px(te, 0, -S), py(te, 0, -S));
          ctx.lineTo(px(te, 1, -S), py(te, 1, -S));
          ctx.lineTo(px(te, 1, S), py(te, 1, S));
          ctx.closePath();
          ctx.fillStyle = rgb(mat.color, endLit);
          ctx.fill();
          ctx.strokeStyle = rgb(mat.trim, endLit * 0.9);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(px(t0, 1, S), py(t0, 1, S));
        ctx.lineTo(px(t1, 1, S), py(t1, 1, S));
        ctx.lineTo(px(t1, 1, -S), py(t1, 1, -S));
        ctx.lineTo(px(t0, 1, -S), py(t0, 1, -S));
        ctx.closePath();
        ctx.fillStyle = rgb(mat.color, topLit);
        ctx.fill();
        ctx.strokeStyle = rgb(mat.trim, lit * 0.9);
        ctx.stroke();
      };
      const R0 = faceEnd(-1), R1 = faceEnd(1);
      for (const [k0, k1] of [[0.3, 0.45], [0.7, 0.85]] as Array<[number, number]>) {
        quad(R0, R1, k0, k1);
        ctx.fillStyle = rgb(mat.color, lit * 0.92);
        ctx.fill();
        ctx.strokeStyle = rgb(mat.trim, lit * 0.85);
        ctx.stroke();
        cap(R0, R1, k1);
        ctx.fillStyle = rgb(mat.color, topLit * 0.94);
        ctx.fill();
      }
      if (!walled(-1)) post(0);
      post(0.5);
      if (!walled(1)) post(1);
      if (wall.type === 'fence_gate' || wall.type === 'iron_gate') {
        // The leaf hangs behind the posts, which is what the recess says.
        const iron = wall.type === 'iron_gate';
        quad(0.07, 0.43, 0.06, 0.94, -0.4);
        ctx.fillStyle = rgb(iron ? [72, 74, 80] : mat.floor, lit, 0.9);
        ctx.fill();
        ctx.strokeStyle = rgb(iron ? [40, 42, 48] : mat.trim, lit);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px(0.09, 0.1, -0.4), py(0.09, 0.1, -0.4));
        ctx.lineTo(px(0.41, 0.9, -0.4), py(0.41, 0.9, -0.4));
        ctx.stroke();
        if (iron) {
          // Two straps across it, which is where the iron actually is.
          ctx.lineWidth = Math.max(1.5, 2.4 * zoom);
          ctx.strokeStyle = rgb([54, 56, 62], lit);
          for (const k of [0.24, 0.76]) {
            ctx.beginPath();
            ctx.moveTo(px(0.07, k, -0.4), py(0.07, k, -0.4));
            ctx.lineTo(px(0.43, k, -0.4), py(0.43, k, -0.4));
            ctx.stroke();
          }
          ctx.lineWidth = 1;
        }
      }
      ctx.globalAlpha = 1;
      return;
    }
    /*
     * Cobblestone is painted rather than ruled. It is the cheap masonry and the
     * first a novice lays, so its picture is of a wall that shows it: blocks of
     * no two sizes, joints of no two widths, courses that wander, and the
     * chips, cracks and damp of a thing that has stood a while. What grows on
     * it depends on where in the wall the face is, which is why it is three
     * pictures and not one -- the hedge and the damp belong to the storey that
     * meets the ground, the ivy to the one with nothing above it, and neither
     * belongs to a face looking into somebody's room.
     *
     * A painted wall is left to the flat colours below: the picture has its own
     * stone in it, and a coat of paint over that would be two walls at once.
     */
    if (cob) {
      const bld = this.game.buildings;
      /** Which of the five, by where the wall is: neighbours differ, and a wall keeps its own. */
      const v = cob.scatter ? scatterOf(border, wall.level, cob.face.length)
        : Math.abs(border.x * 31 + border.y * 17 + wall.level * 7) % cob.face.length;
      const up = bld.wallOnBorder(wall.level + 1, border);
      const roofed = !!up && isDone(up);
      /*
       * The tile the camera is on this side of. A border runs along the top of
       * its own tile or down its left, so which tile that is depends on the
       * side, and that is what `toward` already worked out.
       */
      const seenX = border.dir === 'h' ? border.x : (toward > 0 ? border.x - 1 : border.x);
      const seenY = border.dir === 'h' ? (toward > 0 ? border.y : border.y - 1) : border.y;
      const indoors = !!bld.buildingAt(seenX, seenY);
      /**
       * A finished wall of the same kind standing square to this one at its
       * `i` end, on the camera's side of it (`near`) or the far side, and as
       * tall and as thick as this one. A fence square to the end of a half
       * wall does not bury the end: it stands lower and thinner, and the end
       * left undrawn over it showed the grass under the half wall's cap.
       */
      const square = (i: -1 | 1, near: boolean): boolean => {
        const t = i < 0 ? 0 : 1;
        const cx = border.dir === 'h' ? border.x + t : border.x;
        const cy = border.dir === 'h' ? border.y : border.y + t;
        const mine = near === toward > 0;
        const b: Border = border.dir === 'h'
          ? { dir: 'v', x: cx, y: mine ? cy : cy - 1 }
          : { dir: 'h', x: mine ? cx - 1 : cx, y: cy };
        const w = bld.wallOnBorder(wall.level, b);
        if (!w || !isDone(w)) return false;
        const k2 = WALL_TYPE_BY_ID.get(w.type);
        if (!!k2?.low !== !!kind?.low) return false;
        const half2 = (k2?.railed ? FENCE_THICK : WALL_THICK) * (k2?.thick ?? 1);
        return this.standing(w, b) >= tall - 1e-6 && half2 >= half - 1e-9;
      };
      /*
       * Where the run turns a corner away from the camera the face is carried
       * on past its end by the thickness of the wall that turns there, to meet
       * that wall's own face carried on the same way, and the picture goes
       * round with it; where it runs into a wall on the camera's side it stops
       * at that wall's face (see `faceEnd`). Stopped at the border, the two
       * left the angle between their ends showing -- a notch the depth of the
       * wall, which with its end grain in it was a post of another colour
       * down every corner.
       */
      const T0 = faceEnd(-1), T1 = faceEnd(1);
      const e0 = Math.max(0, -T0), e1 = Math.max(0, T1 - 1);
      /** Where the top stops, at either end. */
      const C0 = capEnd(-1), C1 = capEnd(1);
      /** A garden wall's pictures, at the height it stands to, and whether a gate hangs in it. */
      const lw = kind?.low ? cob.low(tall) : undefined;
      const hung = wall.type === 'fence_gate' || wall.type === 'iron_gate';
      /*
       * The head of the wall, on a masonry laid by hand, where nothing stands
       * on it: how far it rises over its line at `t`, as a share of the
       * height the picture is painted to -- the variant's crest, or on a
       * garden wall its pillows and the domes of a gate's piers -- and
       * nothing at either end, so a head runs on into the next section's.
       */
      const topTones = cob.top ?? { lit: cob.hi, hi: cob.hi, shade: cob.hi };
      const heads = !cob.soft || roofed ? undefined
        : lw ? (hung ? lw.gateCrest : lw.crest)?.[v] : cob.crest?.[v];
      const headPx = lw ? lw.h : cob.h;
      const rise = (t: number): number => {
        if (!heads || t <= 0 || t >= 1) return 0;
        const f = t * (heads.length - 1), i = Math.floor(f), u = f - i;
        return (heads[i] * (1 - u) + heads[Math.min(i + 1, heads.length - 1)] * u) / headPx;
      };
      /** The points from `a` to `b` a head is drawn through: the two ends, and every point its crest is given at between. */
      const ticks = (a: number, b: number): number[] => {
        const out = [a];
        if (heads) {
          const n = heads.length - 1;
          for (let i = 1; i < n; i++) if (i / n > a && i / n < b) out.push(i / n);
        }
        out.push(b);
        return out;
      };
      /** A picture, between three of its corners: top left, top right, bottom left. */
      const dpr = this.canvas.dpr;
      /** A point's distance along the face on whole device pixels: a face's ends are true verticals on screen. */
      const snapX = (t: number): number => Math.round(px(t, 0) * dpr) / dpr;
      /** A device pixel, as a share of the section's length on screen. */
      const hair = 1 / Math.max(1, Math.abs(px(1, 0) - px(0, 0)) * dpr);
      /**
       * Whether this face's pictures go on the other way round: on a masonry
       * painted with its light on the left, a face that runs right to left on
       * screen, which is the face turned from the light.
       */
      const turned = !!cob.handed && px(1, 0) < px(0, 0);
      /**
       * A picture laid from `shift` to `shift + 1` along the run: `flip` lays
       * it the other way round, and `spread` runs it a hair past both ends.
       */
      const lay = (img: HTMLCanvasElement, k0: number, k1: number, s: number, across: boolean, over: number, spread: number, shift = 0, flip = false): void => {
        // `over` hangs the far edge of an `across` picture past the back arris,
        // which is where a cope stone standing proud of the run has to go.
        const far = -(1 + 2 * over);
        // `spread` runs a face picture a hair past both ends of the section, for
        // a picture whose ends are not the coat's own flat tone: its half-drawn
        // edge would otherwise show the paler face under it down every seam.
        const t0 = shift + (flip ? 1 + spread : -spread), t1 = shift + (flip ? -spread : 1 + spread);
        const [a0, a1] = flip ? [shift + 1, shift] : [shift, shift + 1];
        const [tlx, tly] = across ? [px(a0, k1, far), py(a0, k1, far)] : [px(t0, k1, s), py(t0, k1, s)];
        const [trx, try_] = across
          ? [px(a1, k1, far), py(a1, k1, far)]
          : [px(t1, k1, s), py(t1, k1, s)];
        const [blx, bly] = across ? [px(a0, k1, 1), py(a0, k1, 1)] : [px(t0, k0, s), py(t0, k0, s)];
        ctx.save();
        ctx.transform(
          (trx - tlx) / img.width, (try_ - tly) / img.width,
          (blx - tlx) / img.height, (bly - tly) / img.height,
          tlx, tly,
        );
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      };
      /** Everything on screen between two points along the face, for a clip. */
      const strip = (x0: number, x1: number): void => {
        ctx.beginPath();
        ctx.rect(Math.min(x0, x1), -1e5, Math.abs(x1 - x0), 2e5);
      };
      /** The top of the wall between two points along it, out to `far` past the back arris. */
      const lid = (t0: number, t1: number, far: number): void => {
        ctx.beginPath();
        ctx.moveTo(px(t0, 1, 1), py(t0, 1, 1));
        ctx.lineTo(px(t1, 1, 1), py(t1, 1, 1));
        ctx.lineTo(px(t1, 1, far), py(t1, 1, far));
        ctx.lineTo(px(t0, 1, far), py(t0, 1, far));
        ctx.closePath();
      };
      /**
       * A picture over the section.
       *
       * On a masonry laid under a flat colour it goes on between the face's
       * two ends on whole device pixels, a device pixel past both so nothing
       * of the colour under it shows along an end, and not a hair past them
       * into the section beside it. Drawn anywhere else its ends are half
       * covered: the section drawn second lays a half pixel of unlit picture
       * over the lit one before it, and down a shaded face that is a pale
       * line every four metres. Where the face is carried round a corner the
       * same picture is laid again past that end, cut to it -- the seams
       * already promise that a section's own edges run on into each other.
       * `round` says whether a picture goes round: a beam end does not.
       */
      const blit = (img: HTMLCanvasElement, k0: number, k1: number, s = 1, across = false, over = 0, spread = 0, flip = false, round = true): void => {
        // A section whose ends are whole, on a masonry laid with no colour
        // under it, goes on as it always has. Anything stopped short or
        // carried round at a junction is cut to it.
        const junction = across ? C0 !== 0 || C1 !== 1 : T0 !== 0 || T1 !== 1;
        if (!cob.under && !junction) { lay(img, k0, k1, s, across, over, spread, 0, flip); return; }
        if (across) {
          const far = -(1 + 2 * over);
          ctx.save(); lid(Math.max(C0, 0), Math.min(C1, 1), far); ctx.clip();
          lay(img, k0, k1, s, true, over, 0);
          ctx.restore();
          for (const [a, b, shift] of [[C0, 0, -1], [1, C1, 1]] as Array<[number, number, number]>) {
            if (b - a <= 1e-9 || !round) continue;
            ctx.save(); lid(a, b, far); ctx.clip();
            lay(img, k0, k1, s, true, over, 0, shift);
            ctx.restore();
          }
          return;
        }
        const sp = Math.max(spread, hair);
        ctx.save(); strip(snapX(T0), snapX(T1)); ctx.clip();
        lay(img, k0, k1, s, false, 0, sp, 0, flip);
        ctx.restore();
        for (const [e, a, b, shift] of [[e0, T0, 0, -1], [e1, 1, T1, 1]] as Array<[number, number, number, number]>) {
          if (!e || !round) continue;
          ctx.save(); strip(snapX(a), snapX(b)); ctx.clip();
          lay(img, k0, k1, s, false, 0, sp, shift, flip);
          ctx.restore();
        }
      };
      /** And the hour's light over it, laid the way the flat colours take it. */
      /*
       * The face again, with its two ends on whole device pixels.
       *
       * A face's ends are true verticals on screen -- a point's height moves
       * it up the screen and never across -- so on a whole pixel two sections
       * meet with nothing between them and nothing doubled. Drawn anywhere
       * else each end is half-covered, and the hour's shade laid over two of
       * them leaves a pale hairline down the seam: nothing on stone or brick,
       * where the joints swallow it, and a ruled line every four metres down
       * a coat of mud. Only the masonries that ask for an under-colour take
       * this path, so the others draw exactly as they did.
       */
      const flush = (t0: number, t1: number, k0: number, k1: number): void => {
        const sx = (t: number): number => (t === 0 || t === 1 || t === T0 || t === T1 ? snapX(t) : px(t, 0));
        const x0 = sx(t0), x1 = sx(t1);
        ctx.beginPath();
        ctx.moveTo(x0, py(t0, k0)); ctx.lineTo(x1, py(t1, k0));
        ctx.lineTo(x1, py(t1, k1)); ctx.lineTo(x0, py(t0, k1));
        ctx.closePath();
      };
      /*
       * And the foot of a storey stood on another is laid a device pixel down
       * over the head of the one under it. The floor line is not a vertical
       * and cannot be put on whole pixels, so each storey half covers the
       * row it falls in and the hour's shade over the two leaves that row
       * paler than either: a ruled line across a coat of mud at every floor.
       * The lower storey is drawn first, so the upper one's colour and shade
       * cover the row outright and only its own edge, a row lower, is shared.
       */
      const below = wall.level > 0 ? bld.wallOnBorder(wall.level - 1, border) : undefined;
      const sunk = cob.under && below && isDone(below) ? 1 / Math.max(1, (py(0, 0) - py(0, 1)) * dpr) : 0;
      /** The face, with its ends on whole device pixels and its head along the crest. */
      const hull = (k0: number): void => {
        const sx = (t: number): number => (t === T0 || t === T1 ? snapX(t) : px(t, 0));
        const ts = ticks(T0, T1);
        ctx.beginPath();
        ctx.moveTo(sx(T0), py(T0, k0)); ctx.lineTo(sx(T1), py(T1, k0));
        for (let i = ts.length - 1; i >= 0; i--) ctx.lineTo(sx(ts[i]), py(ts[i], 1 + rise(ts[i])));
        ctx.closePath();
      };
      const face = (): void => { if (cob.under) hull(-sunk); else quad(0, 1, 0, 1); };
      /** The head where it rises over its line: the coat rolled over the top, in the top's own tone. */
      const crown = (): void => {
        if (!heads) return;
        const ts = ticks(0, 1);
        ctx.beginPath();
        for (const t of ts) ctx.lineTo(px(t, 0), py(t, 1 + rise(t)));
        for (let i = ts.length - 1; i >= 0; i--) ctx.lineTo(px(ts[i], 0), py(ts[i], 1));
        ctx.closePath();
        ctx.fillStyle = rgb(topTones.lit, 1);
        ctx.fill();
      };
      /** A colour as the hour lights a face at `k`, laid flat rather than shaded over. */
      const tint = (c: readonly [number, number, number], k: number, a = 1): string => {
        const f = cob.shadow(k), [sr, sg, sb] = cob.shade;
        return `rgba(${(c[0] * (1 - f) + sr * f) | 0},${(c[1] * (1 - f) + sg * f) | 0},${(c[2] * (1 - f) + sb * f) | 0},${a})`;
      };
      /**
       * The top of a wall laid by hand, between `a` and `b` along its head: the
       * coat turned up at the sky, its far slope a step down from its crown and
       * a line of light along the crown itself. Laid in the hour's light rather
       * than shaded over, and a device pixel past each end, so two tops meet
       * with nothing showing between them and nothing doubled. A device pixel
       * down the screen as well as across it: on a wall seen end on, which is
       * no width across, a pixel across was the whole of a section, and the
       * top of each side wall stood up past the back of the house like a pole.
       */
      const top = (a: number, b: number, k: number): void => {
        const over = Math.min(hair, 1 / Math.max(1, Math.abs(py(1, 0) - py(0, 0)) * dpr));
        const ts = [a - over, ...ticks(a, b).slice(1, -1), b + over];
        const at = (t: number, s: number): [number, number] => [px(t, 1 + rise(t), s), py(t, 1 + rise(t), s)];
        const band = (s0: number, s1: number): void => {
          ctx.beginPath();
          for (const t of ts) ctx.lineTo(...at(t, s0));
          for (let i = ts.length - 1; i >= 0; i--) ctx.lineTo(...at(ts[i], s1));
          ctx.closePath();
        };
        band(1, -1); ctx.fillStyle = tint(topTones.lit, k); ctx.fill();
        band(-0.2, -1); ctx.fillStyle = tint(topTones.shade, k, 0.8); ctx.fill();
        ctx.beginPath();
        for (const t of ts) ctx.lineTo(...at(t, 0.25));
        ctx.strokeStyle = tint(topTones.hi, k, 0.9); ctx.lineWidth = Math.max(0.6, 0.9 * zoom); ctx.stroke();
        ctx.lineWidth = 1;
      };
      /**
       * The coat rolled round an arris, on this face's side of it: nearest the
       * corner a step between this face's light and the light of the face
       * round it, and on the lighter of the two a line of light beside that,
       * wandering a little up the height and swelling where it meets the
       * ground and where it goes over the head. A ruled strip of light down a
       * corner was the edge of a box.
       */
      const roll = (T: number, other: number): void => {
        const aT = cob.shadow(lit), aO = cob.shadow(other), mid = (aT + aO) / 2;
        const x0 = snapX(T), dir = Math.sign(px(0.5, 0) - px(T, 0)) || 1;
        const w = Math.max(0.75, zoom);
        // It swells where it meets the ground and where it goes over the head,
        // and nowhere between storeys, where it runs on up the next.
        const foot = wall.level === 0 ? 1 : 0, head = roofed ? 0 : 1;
        const wob = (k: number): number => 1 + 0.6 * (foot * (1 - k) ** 8 + head * k ** 8) + 0.25 * Math.sin(k * 11 + (border.x + border.y) * 1.7 + T * 5);
        const band = (o0: number, o1: number, fill: string): void => {
          ctx.beginPath();
          for (let i = 0; i <= 12; i++) ctx.lineTo(x0 + dir * o1 * wob(i / 12), py(T, i / 12));
          for (let i = 12; i >= 0; i--) ctx.lineTo(x0 + dir * o0 * wob(i / 12), py(T, i / 12));
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();
        };
        const [sr, sg, sb] = cob.shade;
        if (aT < aO - 1e-3) {
          band(0, w, `rgba(${sr}, ${sg}, ${sb}, ${((mid - aT) / (1 - aT)).toFixed(3)})`);
          band(w, 2 * w, rgb(cob.hi, 1, 0.35));
        } else if (aT > aO + 1e-3) {
          band(0, w, rgb(cob.under ?? cob.hi, 1, Math.max(0, 1 - mid / aT)));
        }
      };
      /** And the end's own side of it, on the end grain nearest the face. */
      const endRoll = (t: number): void => {
        const aE = cob.shadow(endLit), aM = cob.shadow(lit), mid = (aE + aM) / 2;
        ctx.beginPath();
        ctx.moveTo(px(t, 0, 1), py(t, 0, 1)); ctx.lineTo(px(t, 0, 0.3), py(t, 0, 0.3));
        ctx.lineTo(px(t, 1, 0.3), py(t, 1, 0.3)); ctx.lineTo(px(t, 1, 1), py(t, 1, 1));
        ctx.closePath();
        const [sr, sg, sb] = cob.shade;
        ctx.fillStyle = aE > aM ? rgb(cob.under ?? cob.hi, 1, Math.max(0, 1 - mid / aE))
          : `rgba(${sr}, ${sg}, ${sb}, ${((mid - aE) / (1 - aE)).toFixed(3)})`;
        ctx.fill();
      };
      /**
       * A room with no roof on it is still in the shade of its own walls: an
       * inside face is a step under the same face outside, and deeper toward
       * the floor, where the far wall's shadow lies across it. Lit as the
       * outside was, the house read as one card with a line across it.
       */
      const inside = (): void => {
        const [sr, sg, sb] = cob.shade;
        const g = ctx.createLinearGradient(0, py(0.5, 1), 0, py(0.5, 0));
        g.addColorStop(0, `rgba(${sr}, ${sg}, ${sb}, 0.06)`);
        g.addColorStop(1, `rgba(${sr}, ${sg}, ${sb}, 0.2)`);
        hull(-sunk);
        ctx.fillStyle = g;
        ctx.fill();
      };
      /** A picture laid on the face with its top left `u`, `v` picture px into a section `H` px tall, turned round if `flip`. */
      const patch = (img: HTMLCanvasElement, u: number, v0: number, H: number, flip = false): void => {
        const ta = u / cob.w, tb = (u + img.width) / cob.w;
        const k1 = 1 - v0 / H, k0 = 1 - (v0 + img.height) / H;
        const [a, b] = flip ? [tb, ta] : [ta, tb];
        const tlx = px(a, k1), tly = py(a, k1);
        ctx.save();
        // Cut to the face, top and bottom as well as at its ends: the courses
        // a loss at the foot has under it for the foot to cover went on down
        // past the bottom of the wall onto the grass.
        hull(0); ctx.clip();
        ctx.transform((px(b, k1) - tlx) / img.width, (py(b, k1) - tly) / img.width, (px(a, k0) - tlx) / img.height, (py(a, k0) - tly) / img.height, tlx, tly);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      };
      /**
       * A frame's post at each end of the section that turns a corner or
       * stops, or a log wall's crossing at a corner, its picture laid from
       * `k0` to `k1` up the face and shown only above `from`: over the face
       * carried round the corner and the half of the end post the section has
       * of its own, its outer edge on the corner. Without it the corner was
       * the ends of two sections' posts with a strip of the limewash they were
       * painted on between them -- a pale line down the one place a frame is
       * heaviest. A wall running the other way takes `alt`, where there is
       * one: the logs of the two walls at a corner cross turn about.
       */
      const posts = (post: { img: HTMLCanvasElement; alt?: HTMLCanvasElement }, k0: number, k1: number, from: number): void => {
        if (!cob.post || indoors) return;
        const img = post.alt && border.dir === 'v' ? post.alt : post.img;
        const w = half + cob.post.reach / cob.w;
        for (const [i, e, T] of [[-1, e0, T0], [1, e1, T1]] as Array<[-1 | 1, number, number]>) {
          if (on(i) || (!e && (!cob.post.free || square(i, true) || square(i, false)))) continue;
          // From the outer edge in, a device pixel past the corner so the
          // edge is oak however the corner falls on the pixels.
          const [a, b] = i < 0 ? [T - hair, T + w] : [T + hair, T - w];
          ctx.save();
          strip(snapX(T0), snapX(T1)); ctx.clip();
          ctx.beginPath();
          ctx.moveTo(px(a, from), py(a, from)); ctx.lineTo(px(b, from), py(b, from));
          ctx.lineTo(px(b, 1), py(b, 1)); ctx.lineTo(px(a, 1), py(a, 1));
          ctx.closePath(); ctx.clip();
          const tlx = px(a, k1), tly = py(a, k1);
          ctx.transform((px(b, k1) - tlx) / img.width, (py(b, k1) - tly) / img.width, (px(a, k0) - tlx) / img.height, (py(a, k0) - tly) / img.height, tlx, tly);
          ctx.drawImage(img, 0, 0);
          ctx.restore();
        }
      };
      /**
       * On polished metal, the brightest of a picture laid again over the
       * shade, from `from` up the face -- but not where a post stands over
       * the face at a corner or a free end, nor over the foot of a ground
       * storey: laid over those, the face's own lights came through them.
       */
      const gleamed = (img: HTMLCanvasElement, from: number, flip: boolean, spread = 0, H = 1): void => {
        if (!cob.gleam) return;
        let a = T0, b = T1;
        if (cob.post && !indoors) {
          const w = half + cob.post.reach / cob.w;
          for (const [i, e] of [[-1, e0], [1, e1]] as Array<[-1 | 1, number]>) {
            if (on(i) || (!e && (!cob.post.free || square(i, true) || square(i, false)))) continue;
            if (i < 0) a = T0 + w; else b = T1 - w;
          }
        }
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(px(a, from), py(a, from)); ctx.lineTo(px(b, from), py(b, from));
        ctx.lineTo(px(b, H + 0.3), py(b, H + 0.3)); ctx.lineTo(px(a, H + 0.3), py(a, H + 0.3));
        ctx.closePath(); ctx.clip();
        blit(cob.gleam(img), 0, H, 1, false, 0, spread, flip);
        ctx.restore();
      };
      /**
       * Where the weather has taken the coat off this section, out of doors.
       *
       * Not everywhere: on a section in two or three, and where the water
       * and the wear go. Off a corner, where both walls that meet there agree
       * on it by the corner itself; out of the foot of a ground storey; under
       * the end of a sill; under the head of a top storey that has no beam
       * ends to drip -- the ones under the beam ends come with the beams.
       * `H` is how tall the section's picture is, `keep` a stretch along it
       * a loss at the foot must stay out of (a doorway, a gateway), and
       * `sill` the height of a sill in the picture, where there is one.
       */
      const wear = (H: number, keep: [number, number] | null, sill: number | null, bare: boolean): void => {
        const L = cob.losses;
        if (!L || indoors) return;
        const q = (salt: number): number => hash4(border.x, border.y, wall.level * 2 + (border.dir === 'h' ? 0 : 1), salt);
        const pick = (xs: HTMLCanvasElement[], r: number): HTMLCanvasElement => xs[Math.floor(r * xs.length) % xs.length];
        const courses = (img: HTMLCanvasElement): number => Math.round((img.height - L.lip - 2) / L.ch);
        const bottom = Math.round((H - (lw ? 34 : cob.plinth) - L.from) / L.ch);
        let laid = false;
        for (const [e, i] of [[e0, -1], [e1, 1]] as Array<[number, number]>) {
          if (!e) continue;
          const t = i < 0 ? 0 : 1;
          const cx = border.dir === 'h' ? border.x + t : border.x, cy = border.dir === 'h' ? border.y : border.y + t;
          if (hash4(cx, cy, wall.level, 17) > 0.45) continue;
          const img = pick(L.corner, hash4(cx, cy, wall.level, 18)), n = courses(img);
          const line = wall.level === 0 ? bottom - n + 1 : 1 + Math.floor(hash4(cx, cy, wall.level, 19) * Math.max(1, bottom - n - 1));
          patch(img, i > 0 ? T1 * cob.w - img.width : T0 * cob.w, L.from + line * L.ch - L.lip, H, i < 0);
          laid = true;
        }
        if (laid) return;
        if (sill !== null && q(21) < 0.4) {
          const img = pick(L.sill, q(23)), left = q(22) < 0.5;
          const x = (left ? WINDOW.t0 : WINDOW.t1) * cob.w + (left ? -18 : 18) - img.width / 2;
          patch(img, x, L.from + Math.ceil((sill + 18 - L.from) / L.ch) * L.ch - L.lip, H);
          return;
        }
        if (wall.level === 0 && q(31) < (lw ? 0.22 : 0.32)) {
          const img = pick(L.foot, q(33)), n = courses(img) - 2;
          const room = cob.w - 2 * 26 - img.width;
          let x = 26 + q(32) * room;
          if (keep && x + img.width > keep[0] * cob.w && x < keep[1] * cob.w) {
            x = q(34) < 0.5 ? Math.max(18, keep[0] * cob.w - img.width - 10) : Math.min(cob.w - img.width - 18, keep[1] * cob.w + 10);
            if (x + img.width > keep[0] * cob.w && x < keep[1] * cob.w) return;
          }
          patch(img, x, L.from + (bottom - n) * L.ch - L.lip, H);
          return;
        }
        if (bare && !lw && !roofed && q(41) < 0.3) {
          const img = pick(L.head, q(43));
          patch(img, 30 + q(42) * (cob.w - 60 - img.width), L.from - L.ch - L.lip, H);
        }
      };
      const light = (k: number): void => {
        if (k >= 0.999) return;
        const [sr, sg, sb] = cob.shade;
        ctx.fillStyle = `rgba(${sr}, ${sg}, ${sb}, ${cob.shadow(k).toFixed(3)})`;
        ctx.fill();
      };
      /**
       * The end grain, at each end where it shows (see `endShows`, and `proud`
       * for the edge of one left standing out), with its picture laid across
       * the whole end whatever part of the end is drawn.
       */
      const endGrain = (img: HTMLCanvasElement): void => {
        for (const i of [-1, 1] as const) {
          const cut = proud(i);
          if (!cut && !endShows(i)) continue;
          const t = i < 0 ? T0 : T1, [s0, s1] = cut ?? [-1, 1];
          endOf(t, 0, 1, s0, s1);
          ctx.fillStyle = rgb(mat.color, endLit);
          ctx.fill();
          ctx.save();
          ctx.clip();
          const [ex, ey] = [px(t, 1, 1), py(t, 1, 1)];
          ctx.transform(
            (px(t, 1, -1) - ex) / img.width, (py(t, 1, -1) - ey) / img.width,
            (px(t, 0, 1) - ex) / img.height, (py(t, 0, 1) - ey) / img.height,
            ex, ey,
          );
          ctx.drawImage(img, 0, 0);
          ctx.restore();
          endOf(t, 0, 1, s0, s1);
          light(endLit);
          if (cob.soft && !cut) { endRoll(t); roll(t, endLit); }
        }
      };
      /*
       * A field wall is its own picture, not the house wall squashed.
       *
       * A fence section is a fraction of a storey tall, so blitting the
       * wall's three metres into it flattened every stone by two and a half
       * and put the band course -- which is the string course at a floor line
       * -- along the top of something that has no floors. What it gets is a
       * coping, painted at the height the wall type actually asks for, with
       * everything it carries in the one picture: a fence has no openings to
       * clip growth out of and no storey above it to belong to.
       *
       * Every low wall takes it, not only the fences -- a half wall was the
       * same three metres squashed into one and a half, and a half wall in
       * cobblestone is a garden wall, which is what this draws.
       */
      if (lw) {
        // What it throws on the ground it stands on is laid with the ground: see `groundShade`.
        if (cob.under) {
          ctx.fillStyle = rgb(cob.under, 1);
          for (const [a, b] of (hung ? [[T0, FENCE_GAP.t0], [FENCE_GAP.t1, T1]] : [[T0, T1]]) as Array<[number, number]>) {
            flush(a, b, 0, 0.8);
            ctx.fill();
          }
        }
        blit(hung ? lw.gate[v] : lw.face[v], 0, 1 + lw.proud / lw.h, 1, false, 0, cob.under ? 0.004 : 0, turned);
        if (lw.post) posts(lw.post, lw.post.foot / lw.h, 1, lw.post.foot / lw.h);
        wear(lw.h, hung ? [FENCE_GAP.t0 - 0.12, FENCE_GAP.t1 + 0.12] : null, null, false);
        if (hung) this.fenceGate(cob, { px, py, quad }, zoom, wall.type === 'iron_gate');
        crown();
        face();
        light(lit);
        // Polished metal keeps its brightest light on a face turned from the sun.
        if (cob.gleam && cob.shadow(lit) > 0.05) gleamed(hung ? lw.gate[v] : lw.face[v], 0, turned, cob.under ? 0.004 : 0, 1 + lw.proud / lw.h);
        /*
         * The top of a fence, at nine tenths of the light a wall's top gets.
         *
         * It is the same stone turned at the sky, so it is lighter than the
         * face -- but on three metres of wall that top is a surface and on a
         * fence it is a line three pixels deep, and a line a quarter brighter
         * than everything around it, running dead straight for as far as the
         * wall runs, is the brightest thing in the picture. It still reads as
         * lit. It no longer reads as paint.
         */
        const capLit = topLit * 0.9;
        /*
         * In two pieces over a gate, because there is nothing over a gateway.
         * The blit is cut to the opening but the flat colour under it is what
         * shows through the joints, and laid across the whole section it came
         * out as a grey bar hanging in the air above the gate.
         */
        const capRuns: Array<[number, number]> = hung
          ? [[C0, FENCE_GAP.t0], [FENCE_GAP.t1, C1]]
          : [[C0, C1]];
        if (cob.wrap) {
          for (const [a, b] of capRuns) top(a, b, capLit);
        } else {
          for (const [a, b] of capRuns) {
            cap(a, b, 1);
            ctx.fillStyle = rgb(mat.color, capLit);
            ctx.fill();
          }
          blit(hung ? lw.gateCap[v] : lw.cap[v], 1, 1, 1, true, lw.proud / cob.capH);
          for (const [a, b] of capRuns) { cap(a, b, 1); light(capLit); }
        }
        endGrain(lw.ends);
        if (cob.soft && e0) roll(T0, endLit);
        if (cob.soft && e1) roll(T1, endLit);
        ctx.globalAlpha = 1;
        return;
      }
      /*
       * An archway is the same section with a hole in it, so it is the same
       * blit with a different picture -- not a shape drawn over the stone.
       * The picture's hole and the clip below both come out of `ARCH`, so
       * there is one statement about where a doorway is.
       */
      const arched = wall.type === 'arch';
      const windowed = wall.type === 'window';
      const doored = wall.type === 'door';
      const gated = wall.type === 'double_door';
      const bayed = wall.type === 'bay';
      const cut = arched || windowed || doored || gated || bayed;
      /** Whichever hole this section has, added to the path that is open. */
      const hole = (s: number): void => {
        if (arched) { this.archGeom({ px, py, quad }, zoom).hole(s); return; }
        const [t0, t1, k0, k1] = doored
          ? [DOOR.t0, DOOR.t1, 0, DOOR.k1]
          : gated
            ? [DOUBLE.t0, DOUBLE.t1, 0, DOUBLE.k1]
            : bayed
              ? [BAY.t0, BAY.t1, BAY.k0, BAY.k1]
              : [WINDOW.t0, WINDOW.t1, WINDOW.k0, WINDOW.k1];
        ctx.moveTo(px(t0, k0, s), py(t0, k0, s));
        ctx.lineTo(px(t1, k0, s), py(t1, k0, s));
        ctx.lineTo(px(t1, k1, s), py(t1, k1, s));
        ctx.lineTo(px(t0, k1, s), py(t0, k1, s));
        ctx.closePath();
      };
      /*
       * Everything but the opening. Moss is the one green thing that always
       * has to be clipped to the stone, because moss grows on stone: a lens of
       * it is drawn on a block of the field, and the blocks the hole was
       * broken out of are not there any more.
       *
       * The outer boundary is not the face. The overlay sits over the ground
       * line, so the boundary is drawn wide enough to hold anything a section
       * carries and only the hole is taken out of it -- the two paths in one,
       * clipped even-odd.
       */
      const onStone = (): void => {
        if (!cut) return;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(px(-1, -1), py(-1, -1));
        ctx.lineTo(px(2, -1), py(2, -1));
        ctx.lineTo(px(2, 3), py(2, 3));
        ctx.lineTo(px(-1, 3), py(-1, 3));
        ctx.closePath();
        hole(1);
        ctx.clip('evenodd');
      };
      const offStone = (): void => { if (cut) ctx.restore(); };
      // What a plinth throws on the ground it stands on is laid with the ground: see `groundShade`.
      /*
       * Under the picture, where the masonry asks for it, its own flat colour
       * a hair wider than the section: two pictures meeting on one line leave
       * a hairline of whatever is behind, and on a coat of mud that is a
       * ruled line down the wall at every seam.
       */
      if (cob.under) {
        onStone();
        flush(T0, T1, -sunk, 1);
        ctx.fillStyle = rgb(cob.under, 1);
        ctx.fill();
        offStone();
      }
      blit(arched ? cob.arch[v]
        : windowed ? cob.window[v]
        : doored ? cob.door[v]
        : gated ? cob.gate[v]
        : bayed ? cob.bay[v]
        : cob.face[v], 0, 1, 1, false, 0, 0, turned);
      /*
       * Quoins, where the run stops or turns a corner: the masonry's own
       * dressing of a free end, toothed into the face. Out of doors only --
       * the end of a partition inside a room is plaster and furniture.
       */
      if (!indoors) {
        for (const [img, i] of [[cob.quoinL, -1], [cob.quoinR, 1]] as Array<[HTMLCanvasElement | undefined, -1 | 1]>) {
          const { n, P, up } = joinAt(i);
          // Not where the run carries on, nor in an angle the face runs into.
          if (!img || n || P || up) continue;
          // At an arris a corner has carried the face out to, the stones go out with it.
          ctx.save(); strip(snapX(T0), snapX(T1)); ctx.clip();
          lay(img, 0, 1, 1, false, 0, 0, i < 0 ? T0 : T1 - 1);
          ctx.restore();
        }
      }
      wear(
        cob.h,
        arched ? [ARCH.t0, ARCH.t1] : doored ? [DOOR.t0, DOOR.t1] : gated ? [DOUBLE.t0, DOUBLE.t1] : null,
        windowed ? cob.h * (1 - WINDOW.k0) : bayed ? cob.h * (1 - BAY.k0) : null,
        !(cob.vigas && this.bearsJoists(wall.building, border)),
      );
      /*
       * The way through goes in before anything that grows, and unlit,
       * because the wash below takes the whole face at once: a bush that has
       * got into a doorway stands in front of the reveal, not behind it, and
       * the hour has to reach the stone and the bush in one pass or the bush
       * is cut in half along the edge of the opening.
       */
      if (arched) {
        const geom = this.archGeom({ px, py, quad }, zoom);
        ctx.save();
        geom.outline(1);
        ctx.clip();
        /*
         * The hedge again, and this time round the corner.
         *
         * A bush at the foot of a wall that meets a doorway does not stop and
         * it does not stand across the gap like a hoarding: it turns the
         * arris and goes on growing down the inside of the passage. So the
         * same picture is laid twice -- on the face of the wall, clipped to
         * the stone, and on the far side of the wall's thickness, clipped to
         * the opening. The step between the two at the jamb is the corner it
         * turned, and the reveal drawn over it is the jamb standing in front
         * of it.
         */
        this.threshold(cob, { px, py, quad }, ARCH.t0, ARCH.t1, zoom);
        if (cob.growth && wall.level === 0 && !indoors) blit(cob.base[v], 0, 1, -1);
        this.archShade({ px, py, quad }, zoom);
        this.archDepth(cob.reveal, 1, { px, py, quad }, zoom);
        ctx.restore();
        /*
         * And a line round the edge of it, in the same ink the picture draws
         * every block with. Every stone in the wall is outlined and the one
         * hole in it was not, so the opening read as a gap between stones
         * rather than as an edge somebody cut.
         */
        geom.rim(1);
        ctx.strokeStyle = rgb(cob.line, 0.95, 0.6);
        ctx.lineWidth = Math.max(1, 1.5 * zoom);
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      /*
       * A window is the same idea with glass in it, so it is the same picture
       * with a smaller hole and the same reveal round it. There is no wrapping
       * the hedge through this one: a bush does not grow through a pane.
       */
      if (windowed || doored || gated) {
        ctx.save();
        ctx.beginPath();
        hole(1);
        ctx.clip();
        if (doored || gated) this.paintedDoor(cob, { px, py, quad }, zoom, gated ? 2 : 1);
        else this.paintedGlass(cob, { px, py, quad }, zoom, this.lampBehind(wall, border));
        ctx.restore();
        ctx.beginPath();
        hole(1);
        ctx.strokeStyle = rgb(cob.line, 0.95, 0.6);
        ctx.lineWidth = Math.max(1, 1.5 * zoom);
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      /*
       * A bay sticks out of one side of a wall, and from the other side of
       * that wall it is a hole with glass across the back of it. So from
       * inside a room it is drawn as the window it is from in there, and only
       * from out of doors is the box drawn -- which is also why a bay is not
       * clipped to the hole out there: what fills the hole is the inside of
       * the box, and the box stands in front of the stone.
       */
      if (bayed) {
        ctx.save();
        ctx.beginPath();
        hole(1);
        ctx.clip();
        if (indoors) this.paintedGlass(cob, { px, py, quad }, zoom, this.lampBehind(wall, border), BAY);
        else { ctx.fillStyle = rgb(cob.reveal, 0.42); ctx.fill(); }
        ctx.restore();
        ctx.beginPath();
        hole(1);
        ctx.strokeStyle = rgb(cob.line, 0.95, 0.6);
        ctx.lineWidth = Math.max(1, 1.5 * zoom);
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      if (wall.level === 0 && !indoors) {
        onStone();
        blit(cob.foot[v], 0, 1, 1, false, 0, cob.under ? 0.004 : 0, turned);
        // The face's half of the hedge, where a doorway took the other half
        // round the corner with it.
        if (cob.growth && arched) blit(cob.base[v], 0, 1);
        offStone();
        // Anywhere else it is one picture and goes on whole: a bush that has
        // grown up in front of a window stands in front of it, glass and all.
        if (cob.growth && !arched) blit(cob.base[v], 0, 1);
        if (cob.growth && arched) blit(cob.archWeed[v], 0, 1);
      }
      // After the foot, and down to it: the sole it lays along the footing runs into the post.
      if (cob.post) posts(cob.post, 0, 1, wall.level === 0 ? cob.plinth / cob.h : -sunk);
      // Nothing grows on a masonry that is bare: those pictures are empty, and
      // there is no call to lay an empty picture across a whole wall.
      if (cob.growth) {
        if (windowed) blit(cob.winWeed[v], 0, 1);
        if (doored) blit(cob.doorWeed[v], 0, 1);
        if (gated) blit(cob.gateWeed[v], 0, 1);
      }
      /*
       * The beam ends of the floor over this storey, where this is one of the
       * two walls of the house its joists rest on, and out of doors: inside,
       * the beams are the ceiling of the room. They are painted leaning out
       * to one side, which is the side a log a foot out of the wall stands to
       * from a diagonal, and square on it stands straight below; the face
       * that shows its picture laid the other way round takes them the other
       * way round. The shade they throw falls on a face with the sun on it
       * and on no other, and the rain off them runs down to the head of an
       * opening and no further.
       */
      if (cob.vigas && !indoors && !kind?.low && this.bearsJoists(wall.building, border)) {
        const V = cob.vigas;
        const ux = px(1, 0) - px(0, 0);
        if (Math.abs(ux) > 0.5) {
          const a = (px(0, 0, 1) - px(0, 0, 0)) / half / ux;
          const iso = Math.abs(a) > 0.5;
          const k0 = 1 - V.h / cob.h;
          const sun = cam.rotateX(dx, dy) > 0 && ux > 0 ? Math.min(1, Math.max(0, (lit - 0.72) / 0.28)) : 0;
          if (sun > 0.02) {
            ctx.globalAlpha = alpha * sun;
            blit(V.shade[v], 1 - V.sh / cob.h, 1, 1, false, 0, 0, false, false);
            ctx.globalAlpha = alpha;
          }
          const zone = arched ? [ARCH.t0, ARCH.t1, 0.76] : windowed ? [WINDOW.t0, WINDOW.t1, 0.78]
            : doored ? [DOOR.t0, DOOR.t1, 0.8] : gated ? [DOUBLE.t0, DOUBLE.t1, 0.8] : bayed ? [BAY.t0, BAY.t1, 0.8] : null;
          ctx.save();
          if (zone) {
            const [z0, z1, zk] = zone;
            ctx.beginPath();
            ctx.rect(-1e5, -1e5, 2e5, 2e5);
            ctx.moveTo(px(z0 - 0.07, -0.2), py(z0 - 0.07, -0.2));
            ctx.lineTo(px(z1 + 0.07, -0.2), py(z1 + 0.07, -0.2));
            ctx.lineTo(px(z1 + 0.07, zk), py(z1 + 0.07, zk));
            ctx.lineTo(px(z0 - 0.07, zk), py(z0 - 0.07, zk));
            ctx.closePath();
            ctx.clip('evenodd');
          }
          blit(iso ? V.iso[v] : V.square[v], k0, 1, 1, false, 0, 0, iso && a > 0, false);
          ctx.restore();
        }
      }
      // The coat rolled over the head of a wall nothing stands on.
      if (cob.brow && !roofed) blit(cob.brow[v], 1 - cob.brow[v].height / cob.h, 1);
      /*
       * The hour's light, and only that. A flat wall takes a wash down its
       * face as well -- dark where the ground throws shade back up it, light
       * where the sky catches the last of it -- and this one must not: the
       * wash runs top to bottom of a storey, so at every floor line the lit
       * top of one storey would meet the shaded foot of the next and draw a
       * band across a wall that was built to stack without one. The shade at
       * the ground is painted into `foot` instead, on the storey that has a
       * ground to be shaded by.
       */
      crown();
      face();
      light(lit);
      /*
       * Polished metal keeps its brightest light whichever way it is turned:
       * a mirror turned from the sun still shows the sky. So on a masonry
       * that is, what is brightest in its pictures goes on again over the
       * shade, and a face away from the light keeps its white edges on a
       * darker body. A face the shade barely touches keeps them anyway.
       */
      if (cob.gleam && cob.shadow(lit) > 0.05) {
        const ground = wall.level === 0 && !indoors;
        gleamed(arched ? cob.arch[v] : windowed ? cob.window[v] : doored ? cob.door[v] : gated ? cob.gate[v] : bayed ? cob.bay[v] : cob.face[v], ground ? (cob.plinth + 8) / cob.h : 0, turned);
        if (ground) { onStone(); gleamed(cob.foot[v], 0, turned, cob.under ? 0.004 : 0); offStone(); }
      }
      if (cob.soft && indoors) inside();
      if (cob.soft && e0) roll(T0, endLit);
      if (cob.soft && e1) roll(T1, endLit);
      // A wall whose face goes round its corners has its top laid flat as
      // well: a picture over it seamed at every section. And where a storey
      // stands on it, it is under that storey -- carried round a corner, it
      // came out past the face above. So is the cope of any other masonry
      // under a storey as thick as it is: drawn from a tile later than the
      // storey over the corner, its end came out over that storey's foot.
      const lidded = roofed && (WALL_TYPE_BY_ID.get(up.type)?.thick ?? 1) >= (kind?.thick ?? 1) && !WALL_TYPE_BY_ID.get(up.type)?.railed;
      if (cob.wrap) { if (!roofed) top(C0, C1, topLit); } else if (!lidded) {
        cap(C0, C1, 1);
        ctx.fillStyle = rgb(mat.color, topLit);
        ctx.fill();
        blit(cob.cap, 1, 1, 1, true);
        cap(C0, C1, 1);
        light(topLit);
      }
      // The ground storey's end, where the masonry's foot goes round it.
      endGrain(wall.level === 0 && cob.endsFoot ? cob.endsFoot : cob.ends);
      /*
       * The ivy last, and unlit: it stands proud of the cap, so it has to go on
       * over it, and a leaf in the sun is in the sun whichever way the wall
       * behind it is turned.
       */
      if (cob.growth && !roofed && !indoors) {
        blit(cob.spill[v], 0, 1 + cob.pad / cob.h);
        // And the tongue of it that hangs into the opening, on the variants
        // whose curtain reaches that far along the wall.
        if (arched) blit(cob.archIvy[v], 0, 1);
        if (windowed) blit(cob.winIvy[v], 0, 1);
        if (doored) blit(cob.doorIvy[v], 0, 1);
        if (gated) blit(cob.gateIvy[v], 0, 1);
      }
      if (bayed && !indoors) this.paintedBay(cob, { px, py, quad }, zoom, this.lampBehind(wall, border));
      if (!cut) this.wallOpenings(wall, mat, lit, { px, py, quad }, zoom, border);
      ctx.globalAlpha = 1;
      return;
    }
    /* The face, then what it is made of, then the top and the end. */
    const T0 = faceEnd(-1), T1 = faceEnd(1), C0 = capEnd(-1), C1 = capEnd(1);
    quad(T0, T1, 0, 1);
    ctx.fillStyle = rgb(mat.color, lit);
    ctx.fill();
    // The grain is ruled across the whole section, so it is cut to the face:
    // past a face stopped short at a corner it was ruled over the wall there.
    if (zoom >= 0.5) {
      ctx.save();
      quad(T0, T1, 0, 1);
      ctx.clip();
      this.wallGrain(mat, lit, border.x * 31 + border.y * 17 + wall.level, { px, py, quad }, zoom);
      ctx.restore();
    }
    /*
     * And the light down the face of it. Nothing out of doors is one flat
     * tone from top to bottom: the ground throws shade back up the first foot
     * of a wall and the sky picks out the last of it, and without that a wall
     * of however good a masonry sits on the grass like a decal.
     */
    quad(T0, T1, 0, 1);
    const wash = ctx.createLinearGradient(px(0.5, 0), py(0.5, 0), px(0.5, 1), py(0.5, 1));
    wash.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
    wash.addColorStop(0.3, 'rgba(0, 0, 0, 0.05)');
    wash.addColorStop(0.82, 'rgba(255, 255, 255, 0.03)');
    wash.addColorStop(1, 'rgba(255, 255, 255, 0.1)');
    ctx.fillStyle = wash;
    ctx.fill();
    ctx.strokeStyle = rgb(mat.trim, lit * 0.9);
    ctx.stroke();
    cap(C0, C1, 1);
    ctx.fillStyle = rgb(mat.color, topLit);
    ctx.fill();
    ctx.stroke();
    /*
     * And the end grain, at an end that nothing carries on from. A run of
     * wall down a street is one wall to look at; it is only where a run stops
     * that the thickness of it should be on show.
     */
    for (const i of [-1, 1] as const) {
      const cut = proud(i);
      if (!cut && !endShows(i)) continue;
      endOf(i < 0 ? T0 : T1, 0, 1, ...(cut ?? [-1, 1]));
      ctx.fillStyle = rgb(mat.color, endLit);
      ctx.fill();
      ctx.strokeStyle = rgb(mat.trim, endLit);
      ctx.stroke();
    }
    this.wallOpenings(wall, mat, lit, { px, py, quad }, zoom, border);
    ctx.globalAlpha = 1;
  }

  /** The hole in a wall, whatever the wall is made of. */
  private wallOpenings(wall: Wall, mat: MaterialDef, lit: number, g: WallGeom, zoom: number, border: Border): void {
    switch (wall.type) {
      case 'window':
        this.wallOpening(mat, lit, g, WINDOW.t0, WINDOW.t1, WINDOW.k0, WINDOW.k1, 'glass', zoom, this.lampBehind(wall, border));
        break;
      case 'bay':
        this.wallOpening(mat, lit, g, BAY.t0, BAY.t1, BAY.k0, BAY.k1, 'glass', zoom, this.lampBehind(wall, border));
        break;
      case 'door':
        this.wallOpening(mat, lit, g, DOOR.t0, DOOR.t1, 0, DOOR.k1, 'door', zoom);
        break;
      case 'double_door':
        this.wallOpening(mat, lit, g, DOUBLE.t0, DOUBLE.t1, 0, DOUBLE.k1, 'double', zoom);
        break;
      case 'arch':
        this.wallArch(mat, lit, g, zoom);
        break;
      default:
        break;
    }
  }

  /**
   * What a wall is made of, drawn on its face.
   *
   * Reported as "no character", and the word is fair: every wall on the
   * island was one flat colour with at most a few ruled lines on it, so a log
   * wall and a slate one differed by hue alone. A wall should say what it is
   * from across the deed — logs by the round of them, boarding by the run of
   * the boards, half-timber by its frame, and stone by the size and lie of its
   * blocks. All of it is drawn off the wall's own coordinates, so nothing
   * crawls when the view turns, and none of it is drawn at all from far off.
   */
  private wallGrain(mat: MaterialDef, lit: number, seed: number, g: WallGeom, zoom: number): void {
    const ctx = this.canvas.ctx;
    const { px, py, quad } = g;
    /** A band across the face, filled flat. */
    const band = (t0: number, t1: number, k0: number, k1: number, k: number): void => {
      quad(t0, t1, k0, k1);
      ctx.fillStyle = rgb(mat.color, lit * k);
      ctx.fill();
    };
    /** A rule across or up the face, for a joint or a seam. */
    const rule = (t0: number, k0: number, t1: number, k1: number, k: number, a: number): void => {
      ctx.strokeStyle = rgb(mat.trim, lit * k, a);
      ctx.beginPath();
      ctx.moveTo(px(t0, k0), py(t0, k0));
      ctx.lineTo(px(t1, k1), py(t1, k1));
      ctx.stroke();
    };
    /**
     * Courses of blocks, which is most of what masonry is to look at: the
     * mortar showing between them, every other course set half a block over,
     * and no two blocks quite the same colour.
     */
    /** A stone with the corners knocked off it, for anything not cut square. */
    const blob = (t0: number, t1: number, k0: number, k1: number): void => {
      const mt = (t0 + t1) / 2;
      const mk = (k0 + k1) / 2;
      ctx.beginPath();
      ctx.moveTo(px(t0, mk), py(t0, mk));
      ctx.quadraticCurveTo(px(t0, k1), py(t0, k1), px(mt, k1), py(mt, k1));
      ctx.quadraticCurveTo(px(t1, k1), py(t1, k1), px(t1, mk), py(t1, mk));
      ctx.quadraticCurveTo(px(t1, k0), py(t1, k0), px(mt, k0), py(mt, k0));
      ctx.quadraticCurveTo(px(t0, k0), py(t0, k0), px(t0, mk), py(t0, mk));
      ctx.closePath();
    };
    const courses = (rows0: number, cols0: number, jitter: number, gap: number, rough = false): void => {
      /*
       * Half as many blocks from twice as far off. A brick wall is fifty-four
       * little quads at the zoom where you can count them, and a village of
       * that is a lot of paths for a difference nobody can see from there.
       */
      const rows = zoom >= 0.9 ? rows0 : Math.max(2, Math.round(rows0 / 2));
      const cols = zoom >= 0.9 ? cols0 : Math.max(2, Math.round(cols0 / 2));
      quad(0, 1, 0, 1);
      // The mortar showing between. A cut joint is a dark line; rubble is
      // bedded in a pale lime that shows as much as the stone does.
      ctx.fillStyle = rgb(mat.trim, lit * (rough ? 0.92 : 0.82));
      ctx.fill();
      const kh = 1 / rows;
      for (let r = 0; r < rows; r++) {
        const k0 = r * kh + gap * kh;
        const k1 = (r + 1) * kh - gap * kh;
        const off = (r % 2) * 0.5;
        for (let c = -1; c <= cols; c++) {
          // Rubble comes off the field in whatever size it comes off in, so a
          // course of it is not a course of equal stones.
          const w = rough ? 0.62 + hash2(seed + c, r, 29) * 0.38 : 1;
          const t0 = Math.max(0, (c + off) / cols + gap / cols);
          const t1 = Math.min(1, t0 + ((c + 1 + off) / cols - gap / cols - t0) * w);
          if (t1 <= t0) continue;
          const j = hash2(seed + c, r, 19);
          quad(t0, t1, k0, k1);
          // Rubble is picked out against its bedding; ashlar is nearly one tone.
          ctx.fillStyle = rgb(mat.color, lit * ((rough ? 1.05 : 1) + (j - 0.5) * jitter));
          ctx.fill();
        }
      }
    };
    switch (mat.id) {
      case 'log': {
        /*
         * Logs laid one on another. Each is a cylinder, so the light on it
         * runs from a shadow at the bottom through a crown just above the
         * middle to a softer top where it turns away — which is the whole
         * difference between a log wall and a brown rectangle.
         */
        const n = 5;
        for (let i = 0; i < n; i++) {
          const k0 = i / n;
          const k1 = (i + 1) / n;
          quad(0, 1, k0, k1);
          const gr = ctx.createLinearGradient(px(0.5, k0), py(0.5, k0), px(0.5, k1), py(0.5, k1));
          gr.addColorStop(0, rgb(mat.color, lit * 0.7));
          gr.addColorStop(0.55, rgb(mat.color, lit * 1.12));
          gr.addColorStop(1, rgb(mat.color, lit * 0.88));
          ctx.fillStyle = gr;
          ctx.fill();
          if (i) rule(0, k0, 1, k0, 0.8, 0.75);
        }
        break;
      }
      case 'plank': {
        // Boarding: upright boards of slightly different woods, a sill under
        // them and a head over, which is how boarding is actually held on.
        const n = 7;
        for (let i = 0; i < n; i++) {
          const j = hash2(seed, i, 23);
          band(i / n, (i + 1) / n, 0.06, 0.94, 0.9 + j * 0.2);
          if (i) rule(i / n, 0.06, i / n, 0.94, 0.85, 0.5);
        }
        band(0, 1, 0, 0.06, 0.78);
        band(0, 1, 0.94, 1, 0.86);
        break;
      }
      case 'timbercraft': {
        /*
         * Half-timbering: pale daub between dark timbers. The braces are what
         * make it read at a glance — a frame with no braces in it is a window
         * frame, and a frame with them is a house.
         */
        const frame = (t0: number, t1: number, k0: number, k1: number, k: number): void => {
          quad(t0, t1, k0, k1);
          ctx.fillStyle = rgb(mat.trim, lit * k);
          ctx.fill();
        };
        frame(0, 1, 0, 0.08, 0.95);
        frame(0, 1, 0.92, 1, 1.05);
        frame(0, 0.08, 0, 1, 1);
        frame(0.92, 1, 0, 1, 1);
        frame(0.46, 0.54, 0, 1, 1);
        frame(0, 1, 0.47, 0.55, 0.98);
        if (zoom >= 0.7) {
          ctx.strokeStyle = rgb(mat.trim, lit);
          ctx.lineWidth = Math.max(1.5, 3.2 * zoom);
          for (const [a, b] of [[0.08, 0.46], [0.92, 0.54]] as Array<[number, number]>) {
            ctx.beginPath();
            ctx.moveTo(px(a, 0.08), py(a, 0.08));
            ctx.lineTo(px(b, 0.47), py(b, 0.47));
            ctx.stroke();
          }
          ctx.lineWidth = 1;
        }
        break;
      }
      case 'cobblestone':
        // Field stone: round, uneven, and laid in courses only roughly.
        courses(5, 6, 0.3, 0.045, true);
        break;
      case 'stone_brick':
        courses(6, 4, 0.14, 0.055);
        break;
      case 'slate':
        // Thin beds, because that is how slate comes off the hill.
        courses(9, 3, 0.16, 0.05);
        break;
      case 'sandstone':
        courses(5, 3, 0.2, 0.05);
        break;
      case 'clay_bricks':
        courses(9, 6, 0.16, 0.07);
        break;
      case 'marble': {
        // Great ashlar blocks and hardly any joint, and a vein or two.
        courses(3, 2, 0.05, 0.02);
        if (zoom >= 0.9) {
          ctx.strokeStyle = rgb(mat.trim, lit, 0.35);
          for (let i = 0; i < 3; i++) {
            const t = 0.15 + hash2(seed, i, 41) * 0.7;
            const k = 0.15 + hash2(seed, i, 43) * 0.6;
            ctx.beginPath();
            ctx.moveTo(px(t - 0.12, k - 0.06), py(t - 0.12, k - 0.06));
            ctx.quadraticCurveTo(px(t, k + 0.05), py(t, k + 0.05), px(t + 0.13, k - 0.02), py(t + 0.13, k - 0.02));
            ctx.stroke();
          }
        }
        break;
      }
      case 'clay_adobe': {
        /*
         * No joints at all: mud rendered on by hand and left. What says adobe
         * is that nothing about it is straight — patches where one day's
         * render met the next, a heavy dark foot where the rain splashes up
         * it, and a crack or two from the drying.
         */
        if (zoom >= 0.6) {
          for (let i = 0; i < 9; i++) {
            const t = hash2(seed, i, 53);
            const k = hash2(seed, i, 59);
            blob(Math.max(0, t - 0.17), Math.min(1, t + 0.17), Math.max(0, k - 0.13), Math.min(1, k + 0.13));
            ctx.fillStyle = rgb(mat.color, lit * (0.9 + hash2(seed, i, 61) * 0.22));
            ctx.fill();
          }
        }
        // The foot of it, dark where the ground throws the wet back up.
        quad(0, 1, 0, 0.14);
        const foot = ctx.createLinearGradient(px(0.5, 0), py(0.5, 0), px(0.5, 0.14), py(0.5, 0.14));
        foot.addColorStop(0, rgb(mat.trim, lit * 0.82));
        foot.addColorStop(1, rgb(mat.color, lit, 0));
        ctx.fillStyle = foot;
        ctx.fill();
        if (zoom >= 0.9) {
          ctx.strokeStyle = rgb(mat.trim, lit * 0.8, 0.5);
          for (let i = 0; i < 2; i++) {
            const t = 0.22 + hash2(seed, i, 67) * 0.55;
            ctx.beginPath();
            ctx.moveTo(px(t, 0.95), py(t, 0.95));
            ctx.lineTo(px(t + 0.04, 0.68), py(t + 0.04, 0.68));
            ctx.lineTo(px(t - 0.02, 0.42), py(t - 0.02, 0.42));
            ctx.stroke();
          }
        }
        break;
      }
      case 'ornate_silver':
      case 'ornate_gold': {
        // Ashlar with a band of worked metal across it, which is the whole
        // reason anybody spends the silver.
        courses(5, 3, 0.08, 0.04);
        quad(0.04, 0.96, 0.42, 0.6);
        const gr = ctx.createLinearGradient(px(0.04, 0.6), py(0.04, 0.6), px(0.04, 0.42), py(0.04, 0.42));
        gr.addColorStop(0, rgb(mat.trim, lit * 0.9));
        gr.addColorStop(0.45, rgb(mat.color, lit * 1.3));
        gr.addColorStop(1, rgb(mat.trim, lit));
        ctx.fillStyle = gr;
        ctx.fill();
        ctx.strokeStyle = rgb(mat.trim, lit * 0.8);
        ctx.stroke();
        if (zoom >= 0.8) for (let i = 1; i < 6; i++) rule(i / 6, 0.42, i / 6, 0.6, 0.75, 0.6);
        break;
      }
      default:
        break;
    }
  }

  /**
   * An archway: a doorway with nothing hung in it.
   *
   * Asked for as a new doorway type in every material, and it is the one
   * opening whose shape is the point of it. A door is a rectangle with a leaf
   * in it and the leaf is what you look at; an arch is a hole, so the hole has
   * to be worth looking at — which means a true round head, the wall's own
   * thickness carried round the curve as a soffit, and the stones or the
   * timbers that hold the head up drawn as the things that actually hold it up.
   *
   * The head is a real semicircle rather than a squashed one: a tile is forty
   * terrain units across and a storey is thirty up, so a rise of four thirds
   * of the half-width in `k` is a rise equal to it on the ground.
   */
  /**
   * The way through an archway, and the outline of it.
   *
   * Split out of `wallArch` because a cobblestone one is a painted picture
   * with a hole in it rather than a shape drawn over a flat colour, and the
   * two want the same geometry and nothing else in common. The numbers come
   * from `ARCH`, which the texture that cuts the hole reads as well, so the
   * clip and the hole are one statement.
   */
  private archGeom(g: WallGeom, zoom: number): {
    t0: number; t1: number; spring: number; steps: number;
    headT: (u: number) => number; headK: (u: number) => number;
    hole: (s: number) => void; outline: (s: number) => void; rim: (s: number) => void;
  } {
    const ctx = this.canvas.ctx;
    const { px, py } = g;
    const { t0, t1, spring } = ARCH;
    const mid = (t0 + t1) / 2;
    const halfW = (t1 - t0) / 2;
    // A true semicircle: the rise above the springing is the half span, said
    // in the units the wall is measured in rather than in fractions of two
    // different things.
    const rise = (halfW * UNITS_PER_TILE) / WALL_HEIGHT;
    const steps = zoom >= 0.9 ? 12 : 6;
    const headT = (u: number): number => mid - halfW * Math.cos(Math.PI * u);
    const headK = (u: number): number => spring + rise * Math.sin(Math.PI * u);
    /** The way through, added to whatever path is open: one shape, several uses. */
    const hole = (s: number): void => {
      ctx.moveTo(px(t0, 0, s), py(t0, 0, s));
      ctx.lineTo(px(t0, spring, s), py(t0, spring, s));
      for (let i = 1; i <= steps; i++) ctx.lineTo(px(headT(i / steps), headK(i / steps), s), py(headT(i / steps), headK(i / steps), s));
      ctx.lineTo(px(t1, 0, s), py(t1, 0, s));
      ctx.closePath();
    };
    const outline = (s: number): void => { ctx.beginPath(); hole(s); };
    /**
     * The same edge, left open at the threshold, for stroking.
     *
     * The closed shape ends by running back along the ground from one jamb to
     * the other, and a line drawn there is a doorstep across a doorway that
     * has not got one.
     */
    const rim = (s: number): void => {
      ctx.beginPath();
      ctx.moveTo(px(t0, 0, s), py(t0, 0, s));
      ctx.lineTo(px(t0, spring, s), py(t0, spring, s));
      for (let i = 1; i <= steps; i++) ctx.lineTo(px(headT(i / steps), headK(i / steps), s), py(headT(i / steps), headK(i / steps), s));
      ctx.lineTo(px(t1, 0, s), py(t1, 0, s));
    };
    return { t0, t1, spring, steps, headT, headK, hole, outline, rim };
  }

  /**
   * What you see through an archway: the far side of the opening, and the
   * wall's own thickness seen edge on all the way round it.
   *
   * Drawn as one strip from the near outline to the far one, which is what
   * makes an arch look cut through something rather than painted on it. It is
   * bounded by the near hole because that is what you are looking through.
   */
  /**
   * The shade under an archway.
   *
   * What you see through one has already been drawn -- the grass, the floor
   * of whatever it lets into, whoever is walking towards you -- and it was
   * drawn in full daylight, because nothing that drew it knew there was three
   * metres of wall standing over it. So the ground inside the opening came
   * out brighter than the ground in front of the opening, and an arch with no
   * shade in it is not a way through: it is a shape painted on a wall.
   *
   * Two washes. One flat over the whole opening, for standing under a wall;
   * one along the head, for standing under the part of it that leans over
   * you. Called clipped to the hole, so neither reaches the stone.
   */
  private archShade(g: WallGeom, zoom: number): void {
    const ctx = this.canvas.ctx;
    const { px, py, quad } = g;
    const { spring, headK } = this.archGeom(g, zoom);
    quad(0, 1, 0, 1);
    ctx.fillStyle = 'rgba(38, 34, 22, 0.18)';
    ctx.fill();
    // From the crown down to the springing, where the head stops overhanging.
    const top = headK(0.5);
    const wash = ctx.createLinearGradient(px(0.5, top), py(0.5, top), px(0.5, spring), py(0.5, spring));
    wash.addColorStop(0, 'rgba(38, 34, 22, 0.20)');
    wash.addColorStop(1, 'rgba(38, 34, 22, 0)');
    quad(0, 1, 0, 1);
    ctx.fillStyle = wash;
    ctx.fill();
  }

  private archDepth(ink: readonly [number, number, number], lit: number, g: WallGeom, zoom: number): void {
    const ctx = this.canvas.ctx;
    const { px, py } = g;
    const { t0, t1, spring, steps, headT, headK } = this.archGeom(g, zoom);
    /*
     * Nothing is painted on the far side of it.
     *
     * It used to be: a dark gradient over the whole opening, standing in for a
     * room beyond. But an arch is a way through, and what is on the other side
     * of it has already been drawn -- the ground, the floor of whatever it
     * lets into, whoever is walking towards you through it -- because
     * everything further off is drawn first. Painting over that put a black
     * slab in a doorway you can walk through, which on a free-standing wall
     * with nothing behind it but grass is a hole in the world.
     *
     * So only the wall's own thickness is drawn, which is the part that is
     * really there.
     */
    /*
     * Each strip, and the joint at the leading edge of it.
     *
     * Without the joints the reveal is the one surface in the whole wall with
     * no line on it anywhere, and a featureless band of grey in a doorway
     * reads as a sheet of metal taped inside the opening rather than as the
     * broken ends of the courses. Round the head they are the voussoirs seen
     * edge on; down a jamb they are the jamb's own coursing.
     */
    const seam = rgb(ink, lit * 0.52, 0.55);
    const strip = (ta: number, ka: number, tb: number, kb: number, k: number, joint: boolean): void => {
      ctx.fillStyle = rgb(ink, lit * k);
      ctx.beginPath();
      ctx.moveTo(px(ta, ka, 1), py(ta, ka, 1));
      ctx.lineTo(px(tb, kb, 1), py(tb, kb, 1));
      ctx.lineTo(px(tb, kb, -1), py(tb, kb, -1));
      ctx.lineTo(px(ta, ka, -1), py(ta, ka, -1));
      ctx.closePath();
      ctx.fill();
      if (!joint || zoom < 0.55) return;
      ctx.strokeStyle = seam;
      ctx.lineWidth = Math.max(1, 1.2 * zoom);
      ctx.beginPath();
      ctx.moveTo(px(ta, ka, 1), py(ta, ka, 1));
      ctx.lineTo(px(ta, ka, -1), py(ta, ka, -1));
      ctx.stroke();
    };
    /*
     * The jambs stand on edge and the soffit hangs over you, so they do not
     * take the same light: the sky reaches down the sides of a passage and
     * not into the top of it. One step between them is what gives the way
     * through a shape rather than a flat band of grey round a hole, and it
     * darkens the head of the arch, which is where the eye reads the curve.
     */
    // Three courses up each jamb, drawn bottom up so each one lays its joint
    // on the one below it.
    const COURSES = 3;
    for (const t of [t0, t1]) {
      for (let i = 0; i < COURSES; i++) {
        strip(t, (spring * i) / COURSES, t, (spring * (i + 1)) / COURSES, JAMB_LIT, i > 0);
      }
    }
    for (let i = 0; i < steps; i++) {
      // Down the two ends of the head, up to the crown: what is nearly
      // vertical there is still a jamb, what is nearly level is soffit.
      const u = (i + 0.5) / steps;
      const k = JAMB_LIT + (SOFFIT_LIT - JAMB_LIT) * Math.sin(Math.PI * u);
      strip(headT(i / steps), headK(i / steps), headT((i + 1) / steps), headK((i + 1) / steps), k, i % 2 === 1);
    }
  }

  private wallArch(mat: MaterialDef, lit: number, g: WallGeom, zoom: number): void {
    const ctx = this.canvas.ctx;
    const { px, py } = g;
    const { t0, t1 } = ARCH;
    const mid = (t0 + t1) / 2;
    const { spring, steps, headT, headK, rim, outline } = this.archGeom(g, zoom);
    ctx.save();
    outline(1);
    ctx.clip();
    this.archShade(g, zoom);
    ctx.restore();
    this.archDepth(mat.color, lit, g, zoom);
    // And the edge of the hole, so the face reads as cut rather than shaded.
    rim(1);
    ctx.strokeStyle = rgb(mat.trim, lit * 0.85);
    ctx.stroke();
    if (zoom < 0.7) return;
    /*
     * And what holds the head up, which is the whole of how an arch is built
     * and differs by what it is built of. Stone is cut into wedges that lean
     * on each other, with a keystone at the crown; timber is bent or built up
     * in a ring and pegged, so it reads as a band rather than as courses.
     */
    if (mat.kind === 'stone') {
      ctx.strokeStyle = rgb(mat.trim, lit * 0.9);
      ctx.lineWidth = Math.max(1, 1.4 * zoom);
      const ring = 0.3;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const t = headT(u);
        const k = headK(u);
        // Out along the radius: the joint between one wedge and the next.
        ctx.beginPath();
        ctx.moveTo(px(t, k), py(t, k));
        ctx.lineTo(px(mid + (t - mid) * (1 + ring), spring + (k - spring) * (1 + ring)),
                   py(mid + (t - mid) * (1 + ring), spring + (k - spring) * (1 + ring)));
        ctx.stroke();
      }
      // The keystone, a shade lighter because it is the one that was cut last.
      ctx.beginPath();
      const key = 0.5 / steps;
      for (const [u, r] of [[0.5 - key, 0], [0.5 + key, 0], [0.5 + key, ring], [0.5 - key, ring]] as Array<[number, number]>) {
        const t = mid + (headT(u) - mid) * (1 + r);
        const k = spring + (headK(u) - spring) * (1 + r);
        if (u === 0.5 - key && r === 0) ctx.moveTo(px(t, k), py(t, k));
        else ctx.lineTo(px(t, k), py(t, k));
      }
      ctx.closePath();
      ctx.fillStyle = rgb(mat.color, lit * 1.1);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 1;
    } else {
      // A timber ring, pegged where it meets the jambs.
      ctx.strokeStyle = rgb(mat.trim, lit);
      ctx.lineWidth = Math.max(2, 4.5 * zoom);
      ctx.beginPath();
      ctx.moveTo(px(t0, spring - 0.06), py(t0, spring - 0.06));
      for (let i = 0; i <= steps; i++) ctx.lineTo(px(headT(i / steps), headK(i / steps), 1), py(headT(i / steps), headK(i / steps), 1));
      ctx.lineTo(px(t1, spring - 0.06), py(t1, spring - 0.06));
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  /**
   * A hole in a wall, with the wall's own thickness showing round it.
   *
   * The leaf or the glass sits on the back plane rather than on the face, so
   * the reveal — the jamb and the head — is the wall itself seen edge on, and
   * comes out of the projection rather than out of a drawn line. A window that
   * was painted on the front of a sheet is a window on a sheet.
   */
  /**
   * How much of a light is burning in the room this wall shuts in.
   *
   * Only asked after dark, and only of a window, so the flood fill behind it
   * runs on a handful of walls in the few frames that want it. Something on
   * one of the room's own tiles is inside; a fire in the yard is not, however
   * near the glass it stands.
   */
  private lampBehind(wall: Wall, border: Border): number {
    const dark = this.game.darkness();
    if (dark < 0.2) return 0;
    const near = this.game.buildings.buildingAt(border.x, border.y)
      ? { x: border.x, y: border.y }
      : border.dir === 'h' ? { x: border.x, y: border.y - 1 } : { x: border.x - 1, y: border.y };
    const room = this.game.buildings.room(wall.level, near.x, near.y);
    if (!room) return 0;
    const inside = new Set(room.tiles);
    let most = 0;
    for (const l of this.game.lights()) {
      if (!inside.has(`${Math.floor(l.x)},${Math.floor(l.y)}`)) continue;
      most = Math.max(most, l.strength);
    }
    return most * dark;
  }

  /**
   * A pane, and a window with something burning behind it.
   *
   * Glass was drawn in every window on the island from the first day and
   * never made, never paid for and never once lit: a window at midnight was
   * the same cold blue pane as a window at noon, in a room with a fire in it.
   * `alight` is how much of a light is in the room behind this wall, and it
   * warms the pane and takes the sky out of it.
   */
  private pane(g: WallGeom, t0: number, t1: number, k0: number, k1: number, alight: number): CanvasGradient {
    const ctx = this.canvas.ctx;
    const { px, py } = g;
    const gr = ctx.createLinearGradient(px(t0, k1, -1), py(t0, k1, -1), px(t1, k0, -1), py(t1, k0, -1));
    if (alight > 0) {
      const k = Math.min(1, alight);
      gr.addColorStop(0, `rgba(${(198 + 52 * k) | 0}, ${(226 - 26 * k) | 0}, ${(244 - 110 * k) | 0}, 0.9)`);
      gr.addColorStop(0.55, `rgba(${(126 + 124 * k) | 0}, ${(170 + 20 * k) | 0}, ${(205 - 110 * k) | 0}, ${0.8 + 0.15 * k})`);
      gr.addColorStop(1, `rgba(${(158 + 82 * k) | 0}, ${(198 - 10 * k) | 0}, ${(226 - 120 * k) | 0}, 0.9)`);
    } else {
      gr.addColorStop(0, 'rgba(198, 226, 244, 0.85)');
      gr.addColorStop(0.55, 'rgba(126, 170, 205, 0.8)');
      gr.addColorStop(1, 'rgba(158, 198, 226, 0.85)');
    }
    return gr;
  }

  /**
   * The leaf hung between the piers of a field wall.
   *
   * Five bars and a brace across them, which is what a gate is when it has to
   * be light enough to swing and stiff enough not to drop on its hinges. In
   * oak it is the same timber as the beam over a doorway; in iron it is the
   * same bars with two straps across them and no wood in it at all.
   *
   * It hangs behind the piers rather than between them, because a gate in a
   * gap is a gate that jams the first time the wall settles.
   */
  private fenceGate(cob: Masonry, g: WallGeom, zoom: number, iron: boolean): void {
    const ctx = this.canvas.ctx;
    const { px, py } = g;
    const { t0, t1 } = FENCE_GAP;
    const S = -0.55, k0 = 0.06, k1 = 0.9;
    const a = t0 + 0.015, b = t1 - 0.015;
    /*
     * The side of the pier the gap was cut from, whichever one faces us.
     *
     * The leaf hangs back in the wall's thickness, behind the face, so from
     * any angle there is a strip between the pier's edge on the face and the
     * leaf's stile where what shows is the pier's own side. Nothing drew it,
     * and the grass showed through a slit down the whole height of the gate.
     *
     * Which of the two jambs is towards us is the question a face's winding
     * answers: the face of the wall is drawn on the side the camera is on, so
     * a jamb whose outline turns the same way round on screen is facing us
     * and the other is facing away, behind the pier it belongs to.
     */
    const at = (t: number, k: number, s: number): [number, number] => [px(t, k, s), py(t, k, s)];
    const turn = (pts: Array<[number, number]>): number => {
      let sum = 0;
      for (let i = 0; i < pts.length; i++) {
        const [xa, ya] = pts[i], [xb, yb] = pts[(i + 1) % pts.length];
        sum += xa * yb - xb * ya;
      }
      return Math.sign(sum);
    };
    const face = turn([at(0, 0, 1), at(1, 0, 1), at(1, 1, 1), at(0, 1, 1)]);
    for (const [t, out] of [[t0, 1], [t1, -1]] as Array<[number, number]>) {
      // Round the jamb the way that makes its outward side +t or -t, as the
      // face is laid round so that its outward side is the camera's.
      const ring = [at(t, 0, -1), at(t, 1, -1), at(t, 1, 1), at(t, 0, 1)];
      if (out < 0) ring.reverse();
      if (turn(ring) !== face) continue;
      ctx.beginPath();
      for (const [x, y] of ring) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fillStyle = rgb(cob.reveal, 0.86);
      ctx.fill();
      ctx.strokeStyle = rgb(cob.line, 0.95, 0.6);
      ctx.lineWidth = Math.max(1, 1.2 * zoom);
      ctx.stroke();
    }
    /**
     * One member of it, drawn as timber is drawn everywhere else in the game:
     * the dark of the wood laid down wide and the wood itself laid on top of
     * it, so a rail crossing a field has an outline and reads as a rail. Iron
     * is one stroke, because a bar of iron is a line.
     */
    const seg = (ta: number, ka: number, tb: number, kb: number, ink: readonly [number, number, number], lw: number): void => {
      ctx.strokeStyle = rgb(ink, 1);
      ctx.lineWidth = Math.max(1, lw * zoom);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px(ta, ka, S), py(ta, ka, S));
      ctx.lineTo(px(tb, kb, S), py(tb, kb, S));
      ctx.stroke();
    };
    const bar = (ta: number, ka: number, tb: number, kb: number, w: number): void => {
      // Iron gets the same two strokes the timber does. A bar drawn once in
      // one flat near-black is the only thing in the asset with no value in
      // it, and a gate made of thirteen of them is a drain grate.
      if (iron) { seg(ta, ka, tb, kb, IRON_DARK, w + 0.9); seg(ta, ka, tb, kb, IRON, w); return; }
      seg(ta, ka, tb, kb, cob.beamLine, w + 1.4);
      seg(ta, ka, tb, kb, cob.beam, w);
    };
    /*
     * A gate in a field wall is a frame with the field showing through it.
     *
     * The oak one was a filled leaf with its bars drawn on the face of it,
     * which is a door -- and a door is the one thing that cannot be hung in a
     * dry wall. A field gate is open because a man swings it one-handed and
     * because a gale has to go through it rather than take it away. So both
     * of them are open now, and what tells them apart is what they are made
     * of: five heavy bars and a brace in oak, a grid in iron.
     */
    /*
     * And they are not the same gate in two colours.
     *
     * The iron one was the oak one painted grey: the same five rails, the
     * same lapped brace, the same weight of member. Iron is not laid up like
     * timber -- a smith sets uprights in a top and a bottom rail, because
     * that is what he can forge and weld -- so the iron gate is uprights and
     * two rails, at a third of the oak's weight, and its tone is cold where
     * the oak's is warm.
     */
    const heavy = iron ? 1 : 1.38;
    /*
     * Two of the eight rotations look along the wall, and a shut gate lies in
     * the wall's plane: what you see of it then is its edge. Drawn as a gate
     * anyway, its five bars land on top of each other inside four pixels and
     * come out as one fat brown pill. So at that angle it is what it is --
     * one member, the thickness of a stile.
     */
    const span = Math.hypot(px(b, k0, S) - px(a, k0, S), py(b, k0, S) - py(a, k0, S));
    if (span < 14) {
      const m = (a + b) / 2;
      bar(m, k0, m, k1, 2.6 * heavy);
      return;
    }
    for (const k of iron ? [k0, k1] : [k0, 0.28, 0.5, 0.71, k1]) bar(a, k, b, k, 2.1 * heavy);
    bar(a, k0, a, k1, 2.6 * heavy);
    bar(b, k0, b, k1, 2.6 * heavy);
    if (iron) {
      if (zoom >= 0.5) for (let i = 1; i < 6; i++) bar(a + (b - a) * (i / 6), k0, a + (b - a) * (i / 6), k1, 1.1);
      bar(a, k0 + 0.04, b, k1 - 0.04, 1.5);
    } else {
      // The brace, rising from the foot of the hinge stile to the head of the
      // latch stile, which is the way round it has to go if it is to carry the
      // gate's weight instead of hanging off it. It ran from the head of the
      // hinge stile down, the one way round a brace in wood does nothing.
      bar(a, k0 + 0.03, b, k1 - 0.03, 2.3 * heavy);
    }
    /*
     * And the straps it swings on, which are iron on either gate.
     *
     * Tapered, because a strap is wide where it is bolted to the hinge and
     * narrow where it runs out along the rail. A bar of one width with round
     * ends, three times the weight of anything else on the gate, is a cable
     * tie.
     */
    if (zoom >= 0.5) {
      for (const k of [0.24, 0.76]) {
        seg(a, k, a + (b - a) * 0.14, k, IRON_DARK, 1.9);
        seg(a + (b - a) * 0.14, k, a + (b - a) * 0.3, k, IRON_DARK, 1.1);
        seg(a, k, a, k, IRON, 2.2);
      }
    }
    ctx.lineWidth = 1;
  }

  /**
   * The threshold: the one stone in a wall that gets walked on.
   *
   * It is the floor of the opening, seen in plan, and it is the lightest
   * surface in the whole of it because it is the only one lying face up at
   * the sky. The hollow worn down its middle is the part that says a doorway
   * is used rather than drawn: nothing else on the wall has anybody's boots
   * in it.
   */
  private threshold(cob: Masonry, g: WallGeom, t0: number, t1: number, zoom: number): void {
    const ctx = this.canvas.ctx;
    const { px, py, quad } = g;
    const slab = (a: number, b: number, s: number): void => {
      ctx.beginPath();
      ctx.moveTo(px(a, 0, s), py(a, 0, s));
      ctx.lineTo(px(b, 0, s), py(b, 0, s));
      ctx.lineTo(px(b, 0, -s), py(b, 0, -s));
      ctx.lineTo(px(a, 0, -s), py(a, 0, -s));
      ctx.closePath();
    };
    slab(t0, t1, 1);
    ctx.fillStyle = rgb(cob.reveal, STEP_LIT);
    ctx.fill();
    ctx.strokeStyle = rgb(cob.line, 0.9, 0.5);
    ctx.lineWidth = Math.max(1, 1.2 * zoom);
    ctx.stroke();
    if (zoom < 0.7) return;
    const w = (t1 - t0) * 0.16;
    slab(t0 + w, t1 - w, 0.62);
    ctx.fillStyle = rgb(cob.reveal, STEP_LIT * 0.88);
    ctx.fill();
    void quad;
  }

  /**
   * A painted wall's doorway: the threshold, the reveal, and the leaf.
   *
   * The head of the reveal is the underside of the beam rather than stone,
   * which is the whole of what makes this opening different from the window
   * over it -- you are looking at the one piece of timber in the wall, from
   * below, and it is holding up two and a quarter metres of rubble.
   */
  private paintedDoor(cob: Masonry, g: WallGeom, zoom: number, leaves: 1 | 2): void {
    const ctx = this.canvas.ctx;
    const { px, py, quad } = g;
    const { t0, t1, k1 } = leaves === 2 ? DOUBLE : DOOR;
    this.threshold(cob, g, t0, t1, zoom);
    const strip = (ax: number, ak: number, bx: number, bk: number, k: number, ink: readonly [number, number, number]): void => {
      ctx.fillStyle = rgb(ink, k);
      ctx.beginPath();
      ctx.moveTo(px(ax, ak, 1), py(ax, ak, 1));
      ctx.lineTo(px(bx, bk, 1), py(bx, bk, 1));
      ctx.lineTo(px(bx, bk, -1), py(bx, bk, -1));
      ctx.lineTo(px(ax, ak, -1), py(ax, ak, -1));
      ctx.closePath();
      ctx.fill();
    };
    strip(t0, 0, t0, k1, JAMB_LIT, cob.reveal);
    strip(t1, 0, t1, k1, JAMB_LIT, cob.reveal);
    strip(t0, k1, t1, k1, SOFFIT_LIT, cob.beam);
    // And the leaf, hung on the back plane: boards up and down, two ledges
    // across them, and the straps that hold it to the wall.
    quad(t0, t1, 0, k1, -1);
    ctx.fillStyle = rgb(cob.beam, 0.96);
    ctx.fill();
    if (zoom < 0.7) {
      ctx.strokeStyle = rgb(cob.beamLine, 0.9);
      ctx.stroke();
      return;
    }
    const board = (t: number, a: number, b: number): void => {
      ctx.beginPath();
      ctx.moveTo(px(t, a, -1), py(t, a, -1));
      ctx.lineTo(px(t, b, -1), py(t, b, -1));
      ctx.stroke();
    };
    ctx.strokeStyle = rgb(cob.beamLine, 0.95, 0.6);
    ctx.lineWidth = Math.max(1, 1.3 * zoom);
    const planks = leaves === 2 ? 10 : 5;
    for (let i = 1; i < planks; i++) board(t0 + ((t1 - t0) * i) / planks, 0.03, k1 - 0.03);
    /*
     * Which stile of the leaf you can see.
     *
     * The leaf hangs on the back plane and the opening is cut in the front
     * one, so the wall's own thickness hides about a third of it, off one
     * edge or the other depending which way the section is turned. Both the
     * straps and the ring go in the part that shows: the straps anchored on
     * the stile you can see and running two fifths of the way over, the ring
     * just inside where the jamb starts cutting the leaf off. A strap whose
     * anchored end is behind the wall is a dash floating on a door.
     */
    const at = (u: number): number => t0 + (t1 - t0) * u;
    /*
     * How much of the leaf you can actually see, as a fraction of it.
     *
     * The leaf hangs on the back plane and the opening is cut in the front
     * one, so the wall's thickness hides a third of it off one edge -- which
     * edge, and how much, depends on which way the section is turned. This was
     * a guess at first: a sign test on which way the back plane moves, and a
     * ring placed a fixed distance in from the end it decided was showing.
     * Turn the view a quarter and the guess was wrong and the ring came out
     * half over the jamb.
     *
     * So it is measured instead. The near opening runs between two screen
     * points and so does the leaf; where they overlap is what you can see, and
     * everything hung on the leaf is placed inside that.
     */
    const a = px(t0, 0, 1), b = px(t1, 0, 1);
    const a2 = px(t0, 0, -1), b2 = px(t1, 0, -1);
    const uOf = (x: number): number => (x - a2) / (b2 - a2 || 1);
    const ends = [uOf(Math.max(Math.min(a, b), Math.min(a2, b2))), uOf(Math.min(Math.max(a, b), Math.max(a2, b2)))];
    const u0 = Math.max(0, Math.min(ends[0], ends[1]));
    const u1 = Math.min(1, Math.max(ends[0], ends[1]));
    const span = Math.max(0.2, u1 - u0);
    // The straps are anchored on the stile that shows, because a strap whose
    // anchored end is behind the wall is a dash floating on a door; the ring
    // goes as far the other way as the opening lets it.
    const hinge = u0 <= 0.02 ? 0 : 1;
    /*
     * A gate is two leaves and the line where they meet, and they hang the
     * way a pair of gates hangs: each on the stile at its own outer edge,
     * each pulled by a ring at the middle. So the straps run outward-in from
     * both ends and the rings sit either side of the meeting line, which is
     * the one part of a wide opening the wall's thickness never hides.
     */
    // Where the two leaves meet: a shadow the width of a finger, not a line
    // like the ones between boards, or a gate reads as one wide door.
    if (leaves === 2) {
      quad(at(0.487), at(0.513), 0.02, k1 - 0.02, -1);
      ctx.fillStyle = rgb(cob.beamLine, 0.85, 0.6);
      ctx.fill();
    }
    for (const k of [k1 * 0.24, k1 * 0.76]) {
      quad(t0 + 0.006, t1 - 0.006, k - 0.045, k + 0.045, -1);
      ctx.fillStyle = rgb(cob.beam, 1.12);
      ctx.fill();
      ctx.strokeStyle = rgb(cob.beamLine, 0.9, 0.55);
      ctx.stroke();
      // The strap runs out of the ledge over the boards and stops short of
      // the far stile. Thin: a band of iron the depth of the ledge is a black
      // bar across the door and reads as a gap, not as ironwork.
      const bands: Array<[number, number]> = leaves === 2
        ? [[0.02, 0.30], [0.70, 0.98]]
        : [hinge ? [u1 - span * 0.72, u1] : [u0, u0 + span * 0.72]];
      for (const [a, b] of bands) {
        quad(at(a), at(b), k - 0.015, k + 0.015, -1);
        ctx.fillStyle = rgb(IRON, 1);
        ctx.fill();
      }
    }
    // And a ring to pull it by -- one on a door, one to each leaf on a gate.
    const rings = leaves === 2 ? [0.5 - 0.125, 0.5 + 0.125] : [hinge ? u0 + span * 0.26 : u1 - span * 0.26];
    ctx.strokeStyle = rgb(IRON, 1);
    ctx.lineWidth = Math.max(1, 1.1 * zoom);
    for (const u of rings) {
      const cx = px(at(u), k1 * 0.5, -1), cy = py(at(u), k1 * 0.5, -1);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, 3.6 * zoom * (leaves === 2 ? 0.72 : 1)), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  /**
   * The bay, which is the only part of a wall that is not in it.
   *
   * Everything else an opening is made of lies between the two faces of the
   * wall and comes out of `px` with an `s` of one or minus one. A bay is a box
   * of glass standing on a shelf, three sides of it out in the weather, and it
   * is drawn where it actually is: `OUT` past the near face, canted back to
   * the jambs so the two cheeks look along the wall.
   *
   * Which cheek you can see depends on which way the section is turned, and
   * there is no depth buffer here to work it out, so each face is wound the
   * same way round and one whose projected area comes out with the wrong sign
   * is facing away and is not drawn. That is the whole of it: a bay is four
   * quads and a rule about which of them are yours to look at.
   */
  private paintedBay(cob: Masonry, g: WallGeom, zoom: number, alight: number): void {
    const ctx = this.canvas.ctx;
    const { px, py } = g;
    const { t0, t1, k0, k1 } = BAY;
    /** How far the box stands off the near face, in half-thicknesses of wall. */
    const OUT = 3.4;
    /** How far in the cheeks come, so they look along the wall and not across it. */
    const CANT = 0.1;
    /** The lid falls away from the wall, because a flat one would hold the rain. */
    const kLid = k1 - 0.045;
    const a0 = t0 + CANT, a1 = t1 - CANT;
    type P = [number, number, number];
    const pt = ([t, k, s]: P): [number, number] => [px(t, k, s), py(t, k, s)];
    /** Twice the signed area of a projected face: negative means it is turned away. */
    const facing = (q: Array<[number, number]>): number => {
      let a = 0;
      for (let i = 0; i < q.length; i++) { const p = q[i], r = q[(i + 1) % q.length]; a += p[0] * r[1] - r[0] * p[1]; }
      return a;
    };
    const path = (q: Array<[number, number]>): void => {
      ctx.beginPath();
      ctx.moveTo(q[0][0], q[0][1]);
      for (let i = 1; i < q.length; i++) ctx.lineTo(q[i][0], q[i][1]);
      ctx.closePath();
    };
    const front: P[] = [[a0, k1, OUT], [a1, k1, OUT], [a1, k0, OUT], [a0, k0, OUT]];
    const sign = Math.sign(facing(front.map(pt)));
    /** A light of the bay: the glass, the frame round it and the bars across it. */
    const light = (face: P[], bars: number): void => {
      const q = face.map(pt);
      if (Math.sign(facing(q)) !== sign) return;
      path(q);
      ctx.fillStyle = this.pane({ px, py, quad: g.quad }, t0, t1, k0, k1, alight);
      ctx.fill();
      ctx.strokeStyle = rgb(cob.line, 0.95, 0.8);
      ctx.lineWidth = Math.max(1, 1.6 * zoom);
      ctx.stroke();
      if (zoom < 0.7) return;
      // The bars: `bars` up the light and one across it, struck between the
      // corners of the face itself so they follow it however it is turned.
      const lerp = (p: [number, number], r: [number, number], u: number): [number, number] =>
        [p[0] + (r[0] - p[0]) * u, p[1] + (r[1] - p[1]) * u];
      ctx.lineWidth = Math.max(1, 1.2 * zoom);
      ctx.beginPath();
      for (let i = 1; i <= bars; i++) {
        const u = i / (bars + 1);
        const a = lerp(q[0], q[1], u), b = lerp(q[3], q[2], u);
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      const l = lerp(q[0], q[3], 0.5), r = lerp(q[1], q[2], 0.5);
      ctx.moveTo(l[0], l[1]); ctx.lineTo(r[0], r[1]);
      ctx.stroke();
    };
    // The apron under it, so the box is standing on something rather than
    // hanging: the shelf's own edge, following the bay's plan.
    const apron: P[] = [[t0, k0, 1], [a0, k0, OUT], [a1, k0, OUT], [t1, k0, 1]];
    const skirt = apron.map(pt).concat(apron.slice().reverse().map(([t, , s]) => pt([t, k0 - 0.05, s])));
    /*
     * And the two brackets under it, before the apron, so the apron sits on
     * their heads. A box of glass a metre off the ground with nothing under
     * it is a box of glass floating, and the eye says so before it has
     * worked out why.
     */
    ctx.strokeStyle = rgb(cob.line, 0.95, 0.6);
    ctx.lineWidth = Math.max(1, 1.4 * zoom);
    for (const t of [t0 + 0.07, t1 - 0.07]) {
      const wedge: P[] = [[t, k0, 1], [t, k0, OUT * 0.85], [t, k0 - 0.19, 1]];
      path(wedge.map(pt));
      ctx.fillStyle = rgb(cob.reveal, 0.74);
      ctx.fill();
      ctx.stroke();
    }
    path(skirt);
    ctx.fillStyle = rgb(cob.reveal, 0.82);
    ctx.fill();
    ctx.stroke();
    light([[t0, k1, 1], [a0, kLid, OUT], [a0, k0, OUT], [t0, k0, 1]], 1);
    light([[a1, kLid, OUT], [t1, k1, 1], [t1, k0, 1], [a1, k0, OUT]], 1);
    light([[a0, kLid, OUT], [a1, kLid, OUT], [a1, k0, OUT], [a0, k0, OUT]], 2);
    // And the lid over the lot, which is the same slab the wall is capped with.
    const lid: P[] = [[t0, k1, 1], [t1, k1, 1], [a1, kLid, OUT], [a0, kLid, OUT]];
    path(lid.map(pt));
    ctx.fillStyle = rgb(cob.reveal, 1.1);
    ctx.fill();
    ctx.strokeStyle = rgb(cob.line, 0.95, 0.7);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  /**
   * A painted wall's window: the reveal, the pane on the back plane, and the
   * bars across it.
   *
   * The same three surfaces an archway has and the same reason for each of
   * them -- the jambs keep most of the light because the sky reaches down the
   * sides of a hole, the head keeps least because nothing reaches the
   * underside of a lintel -- and one more, the inside of the sill, which is
   * the only surface in a wall turned up at the sky and so the lightest thing
   * in the opening. Drawn unlit: the wash over the whole face takes the hour.
   */
  private paintedGlass(cob: Masonry, g: WallGeom, zoom: number, alight: number,
                   rect: { t0: number; t1: number; k0: number; k1: number } = WINDOW): void {
    const ctx = this.canvas.ctx;
    const { px, py, quad } = g;
    const { t0, t1, k0, k1 } = rect;
    const strip = (ax: number, ak: number, bx: number, bk: number, k: number): void => {
      ctx.fillStyle = rgb(cob.reveal, k);
      ctx.beginPath();
      ctx.moveTo(px(ax, ak, 1), py(ax, ak, 1));
      ctx.lineTo(px(bx, bk, 1), py(bx, bk, 1));
      ctx.lineTo(px(bx, bk, -1), py(bx, bk, -1));
      ctx.lineTo(px(ax, ak, -1), py(ax, ak, -1));
      ctx.closePath();
      ctx.fill();
    };
    strip(t0, k0, t0, k1, JAMB_LIT);
    strip(t1, k0, t1, k1, JAMB_LIT);
    strip(t0, k1, t1, k1, SOFFIT_LIT);
    strip(t0, k0, t1, k0, SILL_LIT);
    quad(t0, t1, k0, k1, -1);
    ctx.fillStyle = this.pane(g, t0, t1, k0, k1, alight);
    ctx.fill();
    if (zoom < 0.7) return;
    ctx.strokeStyle = rgb(cob.line, 0.9, 0.75);
    ctx.lineWidth = Math.max(1, 1.6 * zoom);
    // One bar up and one across, which is what a small pane looks like.
    ctx.beginPath();
    ctx.moveTo(px((t0 + t1) / 2, k0, -1), py((t0 + t1) / 2, k0, -1));
    ctx.lineTo(px((t0 + t1) / 2, k1, -1), py((t0 + t1) / 2, k1, -1));
    ctx.moveTo(px(t0, (k0 + k1) / 2, -1), py(t0, (k0 + k1) / 2, -1));
    ctx.lineTo(px(t1, (k0 + k1) / 2, -1), py(t1, (k0 + k1) / 2, -1));
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  private wallOpening(mat: MaterialDef, lit: number, g: WallGeom,
                      t0: number, t1: number, k0: number, k1: number,
                      what: 'glass' | 'door' | 'double', zoom: number, alight = 0): void {
    const ctx = this.canvas.ctx;
    const { px, py, quad } = g;
    // The reveal: the sides and head of the hole, which are in shadow because
    // they face across the wall rather than along it.
    ctx.fillStyle = rgb(mat.color, lit * 0.6);
    for (const [a, b] of [[t0, t0], [t1, t1]] as Array<[number, number]>) {
      ctx.beginPath();
      ctx.moveTo(px(a, k0, 1), py(a, k0, 1));
      ctx.lineTo(px(b, k0, -1), py(b, k0, -1));
      ctx.lineTo(px(b, k1, -1), py(b, k1, -1));
      ctx.lineTo(px(a, k1, 1), py(a, k1, 1));
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(px(t0, k1, 1), py(t0, k1, 1));
    ctx.lineTo(px(t1, k1, 1), py(t1, k1, 1));
    ctx.lineTo(px(t1, k1, -1), py(t1, k1, -1));
    ctx.lineTo(px(t0, k1, -1), py(t0, k1, -1));
    ctx.closePath();
    ctx.fillStyle = rgb(mat.color, lit * 0.48);
    ctx.fill();
    // And what is hung in it, on the back plane.
    quad(t0, t1, k0, k1, -1);
    if (what === 'glass') {
      ctx.fillStyle = this.pane(g, t0, t1, k0, k1, alight);
    } else {
      ctx.fillStyle = rgb(mat.floor, lit * 0.5, 0.95);
    }
    ctx.fill();
    ctx.strokeStyle = rgb(mat.trim, lit * 0.8);
    ctx.stroke();
    const line = (t: number, a: number, b: number): void => {
      ctx.beginPath();
      ctx.moveTo(px(t, a, -1), py(t, a, -1));
      ctx.lineTo(px(t, b, -1), py(t, b, -1));
      ctx.stroke();
    };
    if (zoom < 0.7) return;
    ctx.lineWidth = Math.max(1, 1.6 * zoom);
    if (what === 'glass') {
      // Bars: one up and one across, which is what a small pane looks like.
      ctx.strokeStyle = rgb(mat.trim, lit);
      line((t0 + t1) / 2, k0, k1);
      ctx.beginPath();
      ctx.moveTo(px(t0, (k0 + k1) / 2, -1), py(t0, (k0 + k1) / 2, -1));
      ctx.lineTo(px(t1, (k0 + k1) / 2, -1), py(t1, (k0 + k1) / 2, -1));
      ctx.stroke();
    } else {
      // Boards down the leaf, and the gap where a double door meets.
      ctx.strokeStyle = rgb(mat.trim, lit * 0.7);
      const leaves = what === 'double' ? 2 : 1;
      for (let i = 1; i < leaves * 3; i++) line(t0 + ((t1 - t0) * i) / (leaves * 3), k0 + 0.03, k1 - 0.03);
      if (what === 'double') {
        ctx.strokeStyle = rgb(mat.trim, lit);
        line((t0 + t1) / 2, k0, k1);
      }
    }
    ctx.lineWidth = 1;
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

  /**
   * Your border, and your neighbours'.
   *
   * Theirs is drawn in the same line at half the weight, because knowing you
   * are standing in somebody's yard is the difference between "this game will
   * not let me build" and "this is not my land". It is only ever drawn for a
   * settlement near enough to be standing in — the island does not send the
   * distant ones — and it lights nothing: the fog is worked out from your own
   * eyes and your own settlement, and that is the whole reason these two are
   * kept apart.
   */
  private drawDeedBorder(ctx: CanvasRenderingContext2D): void {
    /*
     * Somebody else's border is faint; land you were asked onto is not.
     *
     * A citizen may build on three settlements besides their own, and a border
     * you may work inside is a different thing from one you are only standing
     * near — so it is drawn at the weight your own is.
     */
    for (const d of this.game.neighbourDeeds) this.deedRing(ctx, d, d.mine ? 0.8 : 0.45);
    const deed = this.game.deed;
    if (deed) this.deedRing(ctx, deed, 1);
  }

  private deedRing(ctx: CanvasRenderingContext2D, deed: { x: number; y: number; radius: number }, weight: number): void {
    const w = this.game.world;
    const cam = this.camera;
    const x0 = deed.x - deed.radius;
    const y0 = deed.y - deed.radius;
    const x1 = deed.x + deed.radius + 1;
    const y1 = deed.y + deed.radius + 1;
    ctx.save();
    ctx.globalAlpha = weight;
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
    ctx.restore();
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
  /**
   * Note what is walking about on dry ground. The dust is the colour of the
   * ground it came off, which is why a run across a beach and a run across a
   * ploughed field do not look the same.
   */
  private markDust(): void {
    if (this.camera.zoom < 0.6) return;
    const w = this.game.world;
    const now = this.time;
    const sun = this.sunNow;
    const dry = (x: number, y: number): boolean => w.heightAt(x, y) >= 0;
    const kick = (id: string, x: number, y: number): void => {
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      if (!w.inBounds(tx, ty) || !dry(x, y)) return;
      this.dust.step(id, x, y, now, dustTone(this.groundColor(tx, ty, true, sun)), dustiness(w.viewTile(tx, ty, true)));
    };
    // Whether a thing counts as walking is settled by how far it has actually
    // gone, not by a flag: a pace covered is a pace, whoever or whatever moved
    // it. Standing still covers no ground and so raises none.
    const p = this.game.player;
    if (!p.swimming) kick('player', p.x, p.y);
    if (this.game.creatures.list.size) {
      for (const cr of this.game.creatures.list.values()) kick('c' + cr.id, cr.x, cr.y);
    }
  }

  /**
   * The dust in the air and the smoke over what is burning, both drawn after
   * everything on the ground because both of them are above it.
   */
  private drawAir(ctx: CanvasRenderingContext2D, zoom: number): void {
    const cam = this.camera;
    const w = this.game.world;
    for (const p of this.dust.live(this.time)) {
      const { radius, lift, alpha } = Dust.spread(p, this.time);
      if (alpha < 0.02) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.colour;
      ctx.beginPath();
      ctx.ellipse(cam.worldToScreenX(p.x, p.y), cam.worldToScreenY(p.x, p.y, w.heightAt(p.x, p.y)) - lift * zoom, radius * zoom, radius * 0.55 * zoom, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const fires = this.game.fires();
    if (!fires.length) return;
    const drift = this.lean.force * PUFF_DRIFT;
    for (const f of fires) {
      const sx = cam.worldToScreenX(f.x, f.y);
      const sy = cam.worldToScreenY(f.x, f.y, w.heightAt(f.x, f.y));
      const seed = (f.x * 0.37 + f.y * 0.71) % 1;
      for (let i = 0; i < PUFFS; i++) {
        const age = puffAge(i, this.time, seed);
        const puff = puffOf(age, f.heat);
        if (puff.alpha < 0.012) continue;
        // Higher up it has been in the wind longer, so a plume leans over
        // rather than standing straight.
        const blown = drift * age * age * HALF_W * zoom;
        const px = sx + this.lean.x * blown + Math.sin(age * 7 + seed * 11) * 1.6 * zoom;
        const py = sy + this.lean.y * blown * 0.4 - (6 + age * PUFF_RISE) * zoom;
        // Dark and tight at the fire, pale and open once it has thinned.
        const grey = Math.round(64 + age * 168);
        ctx.fillStyle = `rgba(${grey},${grey - 4},${grey - 10},${puff.alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(px, py, puff.radius * zoom, puff.radius * 0.82 * zoom, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * Whether this is the thing under the cursor. Picking already knows what it
   * is by id; this asks the other way round, so an entity about to be drawn
   * can be told to light up.
   */
  private isHovered(ent: Entity): boolean {
    const h = this.hover;
    if (!h) return false;
    switch (ent.kind) {
      case 'creature':
        return h.creature !== undefined && h.creature === ent.creature?.id;
      case 'crate':
        return h.crate !== undefined && h.crate === ent.crateId;
      case 'campfire':
        return h.fire !== undefined && h.fire === ent.fire?.id;
      case 'smelter':
        return h.smelter !== undefined && h.smelter === ent.smelter?.id;
      case 'kiln':
        return h.kiln !== undefined && h.kiln === ent.kiln?.id;
      case 'furniture':
        return h.furniture !== undefined && h.furniture === ent.piece?.id;
      case 'anvil':
        return h.anvil !== undefined && h.anvil === ent.anvil?.id;
      case 'post':
        return h.post !== undefined && h.post === ent.post?.id;
      case 'trap':
        return h.trap !== undefined && h.trap === ent.trap?.id;
      default:
        return false;
    }
  }

  /**
   * The light that comes up around whatever the cursor is on. It hugs the
   * silhouette rather than boxing it, which is the difference between knowing
   * a thing is selected and knowing which thing is selected — in a crowded
   * pen with four rabba standing on the same tile, a box round the tile tells
   * you nothing.
   */
  /**
   * Haze over the distance. In this view whatever is furthest away is highest
   * on the screen, so the distance is a band across the top, thickening toward
   * it. It is laid in the same colour as the far sky, which is what makes a
   * coastline eight hundred tiles off dissolve into the horizon instead of
   * sitting there as hard as the ground under your feet.
   *
   * Zoomed out there is more distance in view and so more of it; up close it
   * is almost nothing, which is right — you can see a wall in front of you
   * perfectly clearly on the haziest day there is.
   */
  private drawHaze(ctx: CanvasRenderingContext2D, zoom: number): void {
    const H = this.canvas.height;
    const strength = this.sky.haze * Math.max(0, Math.min(1, (1.35 - zoom) / 1.1));
    if (strength < 0.01) return;
    const g = ctx.createLinearGradient(0, 0, 0, H * HAZE_REACH);
    g.addColorStop(0, rgba(this.sky.far, strength));
    g.addColorStop(0.45, rgba(this.sky.far, strength * 0.42));
    g.addColorStop(1, rgba(this.sky.far, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.canvas.width, H * HAZE_REACH);
  }

  /**
   * The numbers and words standing over the world. They are drawn after
   * everything else on the ground and before the fog, so a number over a
   * wildermon in the dark is still readable — which is the whole point of it
   * being a number rather than a line in the log.
   */
  private drawFloaters(ctx: CanvasRenderingContext2D, zoom: number): void {
    const live = this.floaters.live(this.time);
    if (!live.length) return;
    const cam = this.camera;
    const w = this.game.world;
    const size = Math.max(11, Math.round(13 * Math.min(1.4, zoom)));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    for (const f of live) {
      const { lift, alpha, scale } = Floaters.rise(f, this.time);
      if (alpha <= 0.01) continue;
      const sx = cam.worldToScreenX(f.x, f.y);
      // A row apiece for whatever went up together, so two things that happened
      // in the same instant over the same spot are two lines rather than one
      // unreadable one. The row is in screen pixels because that is where the
      // overlap is: it has to clear the glyphs, not the ground.
      const sy = cam.worldToScreenY(f.x, f.y, w.heightAt(f.x, f.y))
        - 26 * zoom - lift * zoom - f.lane * (size + 3);
      ctx.font = `600 ${Math.round(size * scale)}px system-ui, sans-serif`;
      // Written twice: a dark surround first, so it stays legible over grass,
      // over sand, over water and over a wildermon.
      ctx.strokeStyle = `rgba(12,12,14,${(alpha * 0.85).toFixed(3)})`;
      ctx.lineWidth = 3.4;
      ctx.strokeText(f.text, sx, sy);
      ctx.fillStyle = `rgba(${FLOAT_COLOURS[f.kind]},${alpha.toFixed(3)})`;
      ctx.fillText(f.text, sx, sy);
    }
    ctx.lineWidth = 1;
    ctx.textAlign = 'left';
  }

  /**
   * How white a thing is from having just been hit. It is a short, hard flash
   * — long enough to see, short enough that a run of blows reads as a run of
   * blows rather than one long glow.
   */
  private flashOf(at: number): number {
    const since = this.game.time - at;
    if (since < 0 || since > Renderer.FLASH) return 0;
    return 1 - since / Renderer.FLASH;
  }

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

  private drawWater(V: View, x: number, y: number, c: number[], fogInto?: Path2D): void {
    const poly = this.waterPoly;
    // Where the ground crosses zero: two points on a beach tile, none on open
    // water, and four on the rare saddle, which gets no foam rather than the
    // wrong foam. Walked round the tile in the order its corners are drawn, so
    // the polygon that comes out is the shape it looks like on screen.
    const edge = this.waterEdge;
    const cs = V.corners;
    let cross = 0;
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3;
      const ax = x + cs[i][0];
      const ay = y + cs[i][1];
      const bx = x + cs[j][0];
      const by = y + cs[j][1];
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
    const level = waterLevel(depth);
    const { dirX, dirY, force } = this.surf;
    const wave = swellAt(x, y, this.time, dirX, dirY, force);
    const show = swellShow(force);
    ctx.fillStyle = WATER_PALETTE[level];
    ctx.beginPath();
    for (let k = 0; k < n; k += 2) {
      const sx = cam.worldToScreenX(poly[k], poly[k + 1]);
      const sy = cam.worldToScreenY(poly[k], poly[k + 1], 0);
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
      ctx.moveTo(cam.worldToScreenX(edge[0], edge[1]), cam.worldToScreenY(edge[0], edge[1], 0));
      ctx.lineTo(cam.worldToScreenX(edge[2], edge[3]), cam.worldToScreenY(edge[2], edge[3], 0));
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
  /**
   * The one number a piece carries into its own model.
   *
   * A sail wants how hard it is drawing; a crate rack wants which of its eight
   * spots have a crate on them, as a mask. Two pieces, one channel, because
   * nothing else has ever needed one and a second parameter for the second
   * user would be a parameter for every piece that has no use for either.
   */
  private pieceTrim(f: PlacedFurniture): number | undefined {
    if (rackSpots(f)) {
      let mask = 0;
      const deck = rackDeck(f);
      for (let n = 0; n < deck.length; n++) {
        if (this.game.crateAt(f.x, f.y, deck[n][0], deck[n][1])) mask |= 1 << n;
      }
      return mask;
    }
    return this.sailTrim(f);
  }

  /**
   * What somebody just said, over their head.
   *
   * The drawing itself is `drawSpeech`, which takes an age rather than a stamp
   * so that it can be handed any moment of a bubble's life and drawn on its
   * own — which is how it was checked, nine of them side by side, rather than
   * by squinting at a game and hoping somebody typed something.
   */
  private speechBubble(ctx: CanvasRenderingContext2D, zoom: number, sx: number, sy: number, text: string, at: number): void {
    drawSpeech(ctx, zoom, sx, sy, text, performance.now() / 1000 - at);
  }

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
  /**
   * What is under the cursor, asked no oftener than it can have changed.
   *
   * `pick` walks eleven lists of hit boxes and then searches back along the
   * lattice for the tile under the point, and it was being asked on every
   * frame whether or not anything had moved — including while the cursor sat
   * still on a menu-less screen. A cursor that has not moved is re-asked a few
   * times a second, which is quicker than anything on the island can walk out
   * from under it and a sixth of the work.
   */
  hoverPick(sx: number, sy: number): Pick | null {
    const now = performance.now();
    if (sx === this.pickX && sy === this.pickY && now - this.pickedAt < PICK_EVERY) return this.picked;
    this.pickX = sx;
    this.pickY = sy;
    this.pickedAt = now;
    this.picked = this.pick(sx, sy);
    return this.picked;
  }

  /** The cursor has left the canvas: what was under it is not under it now. */
  forgetPick(): void {
    this.pickX = NaN;
    this.picked = null;
  }

  pick(sx: number, sy: number): Pick | null {
    for (let i = this.peerHits.length - 1; i >= 0; i--) {
      const h = this.peerHits[i];
      if (sx >= h.left && sx <= h.left + h.w && sy >= h.top && sy <= h.top + h.h) return { ...this.makePick(h.x, h.y, sx, sy), peer: h.peer };
    }
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
    const V = cam.view;
    const stepW = HALF_W * V.unit;
    const stepH = HALF_H * V.unit;
    const eF = iso.x / stepW;
    const dF = iso.y / stepH;
    // A hill in front stands between the cursor and the ground it is over, so
    // the search runs from the nearest line that could reach this high back to
    // the furthest that could reach this low, and takes the first tile it hits.
    const up = Math.ceil((world.maxHeight * HEIGHT_SCALE) / stepH) + 1;
    const down = Math.ceil((-world.minHeight * HEIGHT_SCALE) / stepH) + 3;
    const eLo = Math.floor(eF) - 1;
    const eHi = Math.ceil(eF) + 1;
    for (let d = Math.floor(dF) + up; d >= Math.floor(dF) - down; d--) {
      for (let e = eLo; e <= eHi; e++) {
        if (V.staggered && ((e + d) & 1) !== 0) continue;
        const x = V.x[0] + V.x[1] * d + V.x[2] * e;
        const y = V.y[0] + V.y[1] * d + V.y[2] * e;
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
