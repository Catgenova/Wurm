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
  ROOF_RISE,
  roofShapeDef,
  WALL_HEIGHT,
  WALL_THICK,
  FENCE_THICK,
  FLOOR_DEEP,
  EAVE_DEEP,
  WALL_TYPE_BY_ID,
  workLevel,
  type Border,
  type FloorTile,
  type MaterialDef,
  type Side,
  type Wall,
  floorBill,
} from '../game/building';
import { foundationDone } from '../game/foundations';
import { DYE_BY_ID } from '../game/dyestuffs';
import { hash2 } from '../world/noise';
import { bareRock, dustiness, HARD_EDGED, PAVED, ROCK_VARIANTS, SLAB_VARIANTS, TileType, TILE_DEFS, bushSpecies, slabVariant, treeSpecies, treeVariant } from '../world/tiles';
import { HALF_H, HALF_W, HEIGHT_SCALE, UNITS_PER_TILE } from './iso';
import { depthOf, type View } from './view';
import { drawShine, shines } from './shine';
import { ARCH, DOOR, DOUBLE, WINDOW, type Cobble, cobble } from './cobble';
import { anvilCentre, type PlacedAnvil } from '../game/anvil';
import { postCentre, postLeft, postLife, type PlacedPost } from '../game/posts';
import { trapCentre, type PlacedTrap } from '../game/traps';
import { ageDef } from '../game/creatures';
import { fireCentre, type PlacedCampfire } from '../game/campfire';
import { smelterCentre, type PlacedSmelter } from '../game/smelter';
import { kilnCentre, type PlacedKiln } from '../game/kiln';
import { furnitureCentre, furnitureDef, type PlacedFurniture, facingOf as pieceFacing, furnitureFootprint } from '../game/furniture';
import { UNSEEN, VISIBLE } from '../game/vision';
import { DAWN, DUSK } from '../game/game';
import { drawFurniture, furnitureSpan, FURNITURE_HEIGHT, pieceTurn } from './furniture';
import { dyeOf } from '../game/dyestuffs';
import { sailTrim } from '../game/wind';
import { FURNITURE_BY_ID, rackDeck, rackSpots } from '../game/furniture';
import { cropDef } from '../game/farming';
import { crateCentre, crateKindOfItem, subtileOf, SUBTILES } from '../game/crates';
import { maxHealth, SPECIES, type Creature } from '../game/creatures';
import { CREST_ALPHA, FOAM_WIDTH, foamAlpha, LONG_WAVE, SHORT_WAVE, SWELL_SPEED, swellAt, swellShow, TROUGH_ALPHA, WATER_PALETTE, waterLevel } from './water';
import { Wakes } from './wake';
import { Dust } from './dust';
import { Gaits } from './gait';
import type { Peer } from '../game/roster';
import { css, HAZE_REACH, rgba, skyAt, unknownInk, type Sky } from './sky';
import { FLOAT_COLOURS, Floaters } from './floaters';
import { drawSpeech } from './bubble';
import { SKILL_BY_ID } from '../game/skills';
import { PUFFS, PUFF_DRIFT, PUFF_RISE, puffAge, puffOf } from './smoke';
import { SWAY_MAX, swayAt } from './sway';
import { ColourPages } from './pages';
import { spriteScaleFor, bushSprite, crateSprite, cropSprite, drawAnvil, drawCampfire, drawCreature, drawKiln, drawPlayer, drawSmelter, facingOf, pileSprite, tokenSprite, treeSprite, type Sprite, drawWorkPost, drawTrap, drawDeck, stumpSprite } from './sprites';

/** Result of picking a screen point: the tile, the approximate world position and the nearest corner. */
/**
 * What is on its way to the ground: a piece of furniture following the
 * cursor, or a staircase on its tile, turned the way Q and E have turned it.
 * `ok` is whether it can go where it is.
 */
export type Ghost =
  | { kind: 'furniture'; piece: string; x: number; y: number; sx: number; sy: number; facing: Side; ok: boolean }
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
const IRON: readonly [number, number, number] = [0x6b, 0x65, 0x5b];


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

/** How much of a neighbour's colour washes over the edge of a tile. */
const BLEND_ALPHA = 0.46;
/** How far in from the edge the neighbour's colour reaches, as a share of the way to the middle. */
const BLEND_REACH = 0.55;
/** Specks of grain laid on each tile once you are close enough to see them. */
const GRAIN_SPECKS = 14;
/*
 * Roof shading: how bright a slope is, by the way it falls on screen. The
 * three numbers are the old four tones — 1 falling away up and left, 0.86 up
 * and right, 0.78 down and left, 0.64 towards the viewer — refitted as a plane
 * through those four, so a cardinal viewpoint shades a roof exactly as it
 * always did and every viewpoint between two of them follows on.
 */
const ROOF_LIGHT = 0.82;
const ROOF_SIDE = 0.14;
const ROOF_DROP = 0.22;
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
  private scaledAt = -1;

  /** The same sprite, already down to `w` by `h` CSS pixels. */
  private atSize(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
    const had = this.scaled.get(src);
    if (had) return had;
    const dpr = this.canvas.dpr;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    const g = cv.getContext('2d');
    if (g) g.drawImage(src, 0, 0, cv.width, cv.height);
    this.scaled.set(src, cv);
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
    const def = TILE_DEFS[type];
    const c = w.corners(x, y, this.colorBuf);
    const gx = (c[1] + c[2] - (c[0] + c[3])) / 2 / UNITS_PER_TILE;
    const gy = (c[2] + c[3] - (c[0] + c[1])) / 2 / UNITS_PER_TILE;
    const len = Math.hypot(gx, gy, 1);
    const dot = (-gx * light[0] - gy * light[1] + light[2]) / len;
    let shade = 0.48 + 0.6 * Math.max(0, dot);
    const base =
      type === TileType.Rock
        ? ROCK_VARIANTS[w.rockFace(x, y)].color
        : type === TileType.Slabs
          ? SLAB_VARIANTS[slabVariant(data)].color
          : def.color;
    let r = base[0];
    let g = base[1];
    let b = base[2];
    // Steep ground wears through to the rock under it. A cliff face used to be
    // whatever was growing on the top of it, stretched down the drop, which is
    // the one thing a cliff never looks like.
    if (type !== TileType.Rock) {
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
    if (avg >= 0) shade *= 1 + (hash2(x, y, 9) - 0.5) * 0.1;
    else {
      const k = Math.max(0.3, 1 - -avg / 80);
      r *= 0.72 * k;
      g *= 0.86 * k;
      b *= 0.95 * k;
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

  /**
   * Where one kind of ground meets another. Soil does not stop dead on a tile
   * line: sand runs into grass, grass into dirt. Each edge with a different
   * tile across it gets a wedge of that neighbour's colour laid over the half
   * of the tile nearest it, and since the neighbour does the same back, the
   * pair of them read as one blended seam. Paving and rock are left alone —
   * a road stops where it was laid.
   *
   * It costs nothing over open country: a field of grass has no edges to
   * blend, so the work is proportional to how broken up the ground is.
   */
  private blendEdges(ctx: CanvasRenderingContext2D, V: View, x: number, y: number, mine: TileType, lit: boolean, sun: [number, number, number], pts: Float64Array): boolean {
    const world = this.game.world;
    let drew = false;
    const cx = (pts[0] + pts[2] + pts[4] + pts[6]) / 4;
    const cy = (pts[1] + pts[3] + pts[5] + pts[7]) / 4;
    for (let e = 0; e < 4; e++) {
      // Screen edge `e` runs between corners `e` and `e + 1`; the view knows
      // which of the tile's four neighbours lies across it.
      const nx = x + V.edges[e][0];
      const ny = y + V.edges[e][1];
      if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
      const theirs = world.viewTile(nx, ny, lit) as TileType;
      if (theirs === mine || HARD_EDGED.has(theirs)) continue;
      if (world.heightAt(nx + 0.5, ny + 0.5) < 0) continue;
      const ax = pts[e * 2];
      const ay = pts[e * 2 + 1];
      const bx = pts[((e + 1) & 3) * 2];
      const by = pts[((e + 1) & 3) * 2 + 1];
      ctx.fillStyle = this.groundColor(nx, ny, lit, sun);
      ctx.globalAlpha = BLEND_ALPHA;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + (cx - bx) * BLEND_REACH, by + (cy - by) * BLEND_REACH);
      ctx.lineTo(ax + (cx - ax) * BLEND_REACH, ay + (cy - ay) * BLEND_REACH);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      drew = true;
    }
    return drew;
  }

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
  /**
   * What a paved tile is paved with.
   *
   * Asked for after the walls: the same treatment for floors, pavements and
   * roofs. A pavement is the easiest of the three to get wrong, because the
   * ground it sits in is drawn as one flat colour a tile and paving drawn that
   * way is a coloured-in square — you cannot tell a road from a lawn that
   * happens to be grey.
   *
   * So the joints are drawn, and the stones between them. Like the grain, it
   * is laid on in plain black and white at low alpha rather than in a shade of
   * the ground: the light, the weather and the cold wash over remembered land
   * are all already in the colour underneath, and none of them has to be
   * worked out twice. Every figure comes off the tile's own coordinates, so a
   * road holds still while you walk down it.
   */
  private paving(t: TileType, x: number, y: number, data: number, pts: Float64Array): void {
    const ctx = this.canvas.ctx;
    /** A point inside the tile, by its two shares across it. */
    const qx = (u: number, v: number): number =>
      (pts[0] * (1 - u) + pts[2] * u) * (1 - v) + (pts[6] * (1 - u) + pts[4] * u) * v;
    const qy = (u: number, v: number): number =>
      (pts[1] * (1 - u) + pts[3] * u) * (1 - v) + (pts[7] * (1 - u) + pts[5] * u) * v;
    const patch = (u0: number, u1: number, v0: number, v1: number, fill: string): void => {
      ctx.beginPath();
      ctx.moveTo(qx(u0, v0), qy(u0, v0));
      ctx.lineTo(qx(u1, v0), qy(u1, v0));
      ctx.lineTo(qx(u1, v1), qy(u1, v1));
      ctx.lineTo(qx(u0, v1), qy(u0, v1));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    if (t === TileType.Gravel) {
      /*
       * Chips, and nothing laid about them: no rows, no joints, no two the
       * same size. Small and many, because the moment a chip is big enough to
       * read as a stone the path reads as badly laid cobbles instead of as a
       * heap of gravel — which is the whole difference between the two.
       */
      for (let i = 0; i < 30; i++) {
        const u = hash2(x, y, 90 + i * 2);
        const v = hash2(x, y, 91 + i * 2);
        const r = 0.022 + hash2(x, y, 140 + i) * 0.032;
        patch(u - r, u + r, v - r * 0.8, v + r * 0.8,
          hash2(x, y, 170 + i) > 0.45 ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.2)');
      }
      return;
    }
    // Slabs are cut square and laid square, in the size their stone is cut in;
    // cobbles are picked off the field and laid in rows with every other row
    // shoved half a stone over.
    const slabs = t === TileType.Slabs;
    const n = slabs ? SLAB_VARIANTS[slabVariant(data)].courses : 6;
    const stagger = t === TileType.Cobblestone;
    const joint = slabs ? 0.06 : 0.11;
    for (let r = 0; r < n; r++) {
      const v0 = r / n + joint / n;
      const v1 = (r + 1) / n - joint / n;
      const off = stagger ? (r % 2) * 0.5 : 0;
      for (let c = stagger ? -1 : 0; c < n; c++) {
        const u0 = Math.max(0, (c + off) / n + joint / n);
        const u1 = Math.min(1, (c + 1 + off) / n - joint / n);
        if (u1 <= u0) continue;
        const k = hash2(x * 8 + c, y * 8 + r, 61);
        // A cut slab is nearly its neighbour; a cobble is whatever came out of
        // the field, so no two of them are the same stone.
        const spread = slabs ? 0.22 : 0.42;
        patch(u0, u1, v0, v1, k > 0.5
          ? `rgba(255, 255, 255, ${(k - 0.5) * spread})`
          : `rgba(0, 0, 0, ${(0.5 - k) * (spread + 0.04)})`);
      }
    }
  }

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
    // Blended seams are a close-up nicety; from high up the tiles are too small to tell.
    const blend = zoom >= 0.5;
    // Grain is only worth drawing once a tile is big enough to hold it, and
    // once few enough tiles are on screen for it to be cheap.
    const grain = zoom >= 1.25;
    // Paving is laid rather than poured, and from close enough you can see
    // every joint in it. Cheaper than grain and worth more, so it starts
    // sooner.
    const paved = zoom >= 0.75;
    // Close enough to be picking things up rather than looking at the country.
    const player = this.game.player;
    const playerDepth = depthOf(V, player.tileX, player.tileY);
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
        const t0 = world.viewTile(x, y, lit) as TileType;
        if (blend && !wet && !HARD_EDGED.has(t0)) {
          /*
           * Most ground has the same ground all round it, and finding that out
           * costs four tile reads and four bounds checks per tile per frame.
           * The answer goes stale exactly when the colour does, so it is kept
           * beside the colour: one means there was nothing to blend here and
           * this tile can be passed over, two means there was.
           */
          const seams = lit ? this.colors : this.memColors;
          const known = seams.flag(x, y);
          if (known !== 1) {
            const drew = this.blendEdges(ctx, V, x, y, t0, lit, sun, pts);
            if (known === 0) seams.setFlag(x, y, drew ? 2 : 1);
          }
        }
        ctx.strokeStyle = grid && !wet ? GRID_COLOR : color;
        ctx.stroke();
        if (wet) this.drawWater(V, x, y, c, fogged && !lit ? fogPath : undefined);

        if (grain && !wet) this.addGrain(x, y, pts, zoom);
        if (paved && !wet && PAVED.has(t0)) this.paving(t0, x, y, world.viewData(x, y, lit), pts);

        const t = t0;
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
            const [wx, wy] = furnitureCentre(fu);
            const fe = this.take('furniture', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, world.heightAt(wx, wy)), null);
            fe.piece = fu;
            if (fu.rare) fe.rare = fu.rare;
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
            const [px, py] = this.game.roster.drawnAt(peer);
            this.take('peer', x, y, cam.worldToScreenX(px, py),
              cam.worldToScreenY(px, py, Math.max(world.heightAt(px, py), -4) + peer.level * WALL_HEIGHT), null).peer = peer;
          }
        }
        if (this.game.creatures.list.size) {
          // Anything standing on a tile with a deck or a slab over it stands on that.
          const deckHere = this.game.laidOver(x, y);
          for (const cr of this.game.creatures.atTile(x, y)) {
            this.take('creature', x, y, cam.worldToScreenX(cr.x, cr.y),
              cam.worldToScreenY(cr.x, cr.y, deckHere ?? Math.max(world.heightAt(cr.x, cr.y), -4)), null).creature = cr;
          }
        }
        if (this.game.foundations.size) this.drawFoundation(x, y, lit);
        if (this.game.buildings.list.size || this.game.buildings.walls.size) this.drawStructures(x, y, V, d > playerDepth);
      }

      if (d === playerDepth) {
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
        const sy = drivenBy || up ? cam.worldToScreenY(vx, vy, world.heightAt(vx, vy)) + 0.01 : cam.worldToScreenY(player.x, player.y, ph);
        this.take('player', player.tileX, player.tileY, cam.worldToScreenX(vx, vy), sy, null).lift = this.driverSeat() * zoom;
      }
      if (grain) {
        this.specks(ctx, this.grainDark, this.grainN, 'rgba(0,0,0,0.095)');
        this.specks(ctx, this.grainPale, this.grainM, 'rgba(255,255,255,0.07)');
      }
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
    // One squeeze per picture per zoom, rather than one per thing drawn.
    if (zoom !== this.scaledAt) {
      this.scaledAt = zoom;
      this.scaled.clear();
    }
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
        this.paint(ctx, zoom, struck > 0 ? 'flash' : 'none', struck * 0.75, ent.sx, ent.sy - (ent.lift ?? 0), (g, px, py) =>
          drawPlayer(g, px, py, zoom, {
            phase: player.moving ? player.walkPhase : this.time * 6,
            moving: player.moving,
            gait: this.gaits.of('player', player.x, player.y, this.frameDt),
            facing: this.playerFacing,
            swimming: player.swimming,
            working: this.game.action?.state === 'performing',
            driving: (ent.lift ?? 0) > 0,
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
        if (mine) this.speechBubble(ctx, zoom, ent.sx, ent.sy - 32 * zoom, mine.text, mine.at);
        continue;
      }
      if (ent.kind === 'peer' && ent.peer) {
        const peer = ent.peer;
        // The same box a creature catches clicks with, because it is the same
        // figure at the same size. Without one, the only thing you could ever
        // do to another person was walk to the tile they were standing on.
        if (peer.uid) {
          this.peerHits.push({ x: ent.x, y: ent.y, left: ent.sx - 10 * zoom, top: ent.sy - 26 * zoom, w: 20 * zoom, h: 28 * zoom, peer: peer.uid });
        }
        peer.facing = this.facingOnScreen(peer.dirX, peer.dirY, peer.facing);
        this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ent.sx, ent.sy, (g, px, py) =>
          drawPlayer(g, px, py, zoom, {
            phase: peer.moving ? peer.walkPhase : this.time * 6,
            moving: peer.moving,
            gait: this.gaits.of('o' + peer.id, peer.x, peer.y, this.frameDt),
            facing: peer.facing,
            swimming: peer.swimming,
            working: peer.working,
            driving: false,
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
          const ty = ent.sy - 30 * zoom;
          ctx.strokeStyle = 'rgba(10,10,12,0.85)';
          ctx.lineWidth = 3;
          ctx.font = `${Math.round(11 * zoom)}px system-ui, sans-serif`;
          ctx.strokeText(peer.name, ent.sx, ty);
          ctx.fillStyle = '#cfe6ff';
          ctx.fillText(peer.name, ent.sx, ty);
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
            ctx.strokeText(doing, ent.sx, ty - 11 * zoom);
            ctx.fillStyle = 'rgba(207,230,255,0.72)';
            ctx.fillText(doing, ent.sx, ty - 11 * zoom);
          }
          ctx.lineWidth = 1;
          ctx.textAlign = 'left';
        }
        // Over the name and over whatever they are at, so a person talking
        // while they dig reads top to bottom: what they said, what they are
        // doing, who they are.
        if (peer.said) this.speechBubble(ctx, zoom, ent.sx, ent.sy - 46 * zoom, peer.said, peer.saidAt ?? 0);
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
        this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ent.sx, ent.sy, (g, px, py) => drawFurniture(g, px, py, zoom, piece.kind, !!piece.lit, dyeOf(piece) ?? undefined, this.pieceTrim(piece), pieceTurn(pieceFacing(piece), cam.rotation)));
        const [W, D] = furnitureSpan(piece.kind);
        const h = FURNITURE_HEIGHT[piece.kind] ?? 14;
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
      const dw = spr.w * zoom;
      const dh = spr.h * zoom;
      const left = ent.sx - spr.ax * zoom;
      const top = ent.sy - spr.ay * zoom;
      // Anything standing up throws a shadow away from the sun, long at the
      // ends of the day and gone at noon. The sprite's own contact shadow does
      // the rest, which is why this can be thrown away entirely at midday.
      if (this.shadow.alpha > 0.012) this.castShadow(ctx, ent.sx, ent.sy, (spr.ay - (spr.h - spr.ay)) * 0.5 * zoom + dh * 0.12);
      if (ent.kind === 'tree' || ent.kind === 'bush') {
        const ready = this.atSize(spr.canvas, dw, dh);
        // Rooted at the foot, leaning at the head: the shear is taken about
        // the trunk, so the tree bends rather than slides. A lean that moves
        // the crown less than half a pixel is not worth a transform to draw.
        const bend = (swayAt(ent.x, ent.y, this.time, this.lean.force) * SWAY_MAX * (ent.kind === 'bush' ? 0.6 : 1)) / 2;
        if (Math.abs(this.lean.x * bend) * dh < 0.5) {
          ctx.drawImage(ready, left, top, dw, dh);
          continue;
        }
        ctx.save();
        ctx.translate(ent.sx, ent.sy);
        ctx.transform(1, 0, -this.lean.x * bend, 1, 0, 0);
        ctx.drawImage(ready, left - ent.sx, top - ent.sy, dw, dh);
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

  /**
   * Floors and walls belonging to a tile. Walls are drawn on the two borders
   * that are the tile's back edges under the current viewpoint, so every wall
   * is drawn exactly once, after the ground behind it and before whatever
   * once they would hide the player. What counts as "the player's" is the room
   * they are standing in rather than the whole building.
   *
   * Looked at square on — the four diagonal viewpoints — the two borders
   * running away from the viewer are edge on and draw as nothing at all, which
   * is what a wall seen end on looks like. Which of the pair is claimed still
   * matters: claim both sides of one border and it is drawn twice.
   */
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
      const py = cam.worldToScreenY(wx, wy, world.heightAt(wx, wy));
      drawFurniture(ctx, px, py, zoom, ghost.piece, false, undefined, undefined, pieceTurn(ghost.facing, cam.rotation));
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
      if (building) {
        const floor = bld.floor(level, x, y);
        // Looking at one storey means lifting the ceilings above it off.
        if (floor && !(viewLevel !== null && floor.level > viewLevel)) {
          // A floor over your head is the ceiling of the room you are in, and
          // only of that room: the far end of a longhouse keeps its own.
          const dim = level > playerLevel && !!this.roomTiles?.has(`${x},${y}`);
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
    /*
     * How high a point of the roof stands, which is the whole of the shape.
     *
     * A **hip** rises wherever it is interior — all four tiles round a corner
     * roofed — so every outside edge falls away and the middle of a big roof
     * is a plateau. That is what every roof on the island was.
     *
     * A **gable** runs one ridge the length of the building and knows nothing
     * about corners: the height depends only on how far across the short way
     * you are, full at the middle line and nothing at either eave. The ends
     * are wall carried up, which is why they are flat against the sky.
     *
     * A **flat** roof does not rise at all. It is a deck.
     */
    const b = bld.list.get(floor.building);
    const shape = roofShapeDef(b);
    const box = b ? bld.footprintBox(b) : { x0: x, y0: y, x1: x + 1, y1: y + 1 };
    const along: 'x' | 'y' = box.x1 - box.x0 >= box.y1 - box.y0 ? 'x' : 'y';
    const rise = ROOF_RISE * shape.rise;
    /** How far up the gable a point is: nothing at the eaves, all of it on the ridge. */
    const ramp = (px: number, py: number): number => {
      const lo = along === 'x' ? box.y0 : box.x0;
      const hi = along === 'x' ? box.y1 : box.x1;
      if (hi - lo <= 0) return 1;
      const t = ((along === 'x' ? py : px) - lo) / (hi - lo);
      return Math.max(0, 1 - Math.abs(2 * t - 1));
    };
    const heightAt = (px: number, py: number, interior: boolean): number =>
      shape.id === 'flat' ? eave : shape.id === 'gable' ? eave + rise * ramp(px, py) : eave + (interior ? rise : 0);
    // A corner is interior when all four tiles around it carry roof.
    const cornerH = (cx: number, cy: number): number =>
      heightAt(cx, cy, roof(cx - 1, cy - 1) && roof(cx, cy - 1) && roof(cx - 1, cy) && roof(cx, cy));
    const corners: Array<[number, number, number]> = [
      [x, y, cornerH(x, y)],
      [x + 1, y, cornerH(x + 1, y)],
      [x + 1, y + 1, cornerH(x + 1, y + 1)],
      [x, y + 1, cornerH(x, y + 1)],
    ];
    // A hipped ridge sits a little under the corners it springs from, which is
    // the number this roof has always been drawn with.
    const ridge = shape.id === 'flat' ? eave : eave + rise * (shape.id === 'gable' ? ramp(x + 0.5, y + 0.5) : 0.7);
    /** How high the middle of one edge stands: on a gable the ramp decides, and nothing else. */
    const midH = (mx: number, my: number, next: boolean): number =>
      shape.id === 'gable' ? heightAt(mx, my, true) : next ? ridge : eave;
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
    /*
     * How bright one of the four slopes is: which way it falls on screen, read
     * as a direction rather than as a quadrant. A quadrant shades the two
     * halves of a slope by where each half's middle happens to sit, which is
     * the same answer for both only while the view is square to the grid — an
     * eighth turn splits every roof down the middle.
     */
    const shadeOf = (dx: number, dy: number): number => {
      const du = cam.rotateX(cx + dx, cy + dy) - cu;
      const dv = cam.rotateY(cx + dx, cy + dy) - cv;
      const sx = du - dv;
      const sy = du + dv;
      const len = Math.abs(sx) + Math.abs(sy) || 1;
      return ROOF_LIGHT - (ROOF_SIDE * sx + ROOF_DROP * sy) / len;
    };
    const zoom = cam.zoom;
    /*
     * What a roof is covered with, drawn in courses running along the slope.
     *
     * A slope is a triangle from the middle of the tile out to half of one
     * side, and a course is that triangle cut across: the band between two
     * shares of the way up from the eave to the ridge. Every covering there is
     * goes on in courses from the bottom up, each lapping the one below, and
     * the shadow line under each lap is the thing that says roof from any
     * distance at all. How many courses is the material's own business: slate
     * splits narrow and marble is cut wide.
     */
    const courses = mat.courses;
    const lap = (a: [number, number, number], b: [number, number, number], shade: number): void => {
      if (zoom < 0.55) return;
      const n = zoom >= 0.9 ? courses : Math.max(2, courses >> 1);
      for (let i = 0; i < n; i++) {
        const t0 = i / n;
        const t1 = (i + 1) / n;
        const pt = (p: [number, number, number], t: number): [number, number] => [
          cam.worldToScreenX(p[0] + (cx - p[0]) * t, p[1] + (cy - p[1]) * t),
          cam.worldToScreenY(p[0] + (cx - p[0]) * t, p[1] + (cy - p[1]) * t, p[2] + (centreH - p[2]) * t),
        ];
        ctx.beginPath();
        const p0 = pt(a, t0);
        const p1 = pt(b, t0);
        const p2 = pt(b, t1);
        const p3 = pt(a, t1);
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.lineTo(p3[0], p3[1]);
        ctx.closePath();
        // Each course a shade of its own, and darker at its foot where the one
        // below it laps under.
        const k = hash2(x * 5 + i, y * 5 + Math.round(a[0] - b[0]), 83);
        ctx.fillStyle = rgb(mat.floor, 0.9 * shade * (0.94 + k * 0.12));
        ctx.fill();
        // The shadow under each lap, once you are near enough for it to be
        // worth a path of its own.
        if (zoom >= 0.95) {
          ctx.strokeStyle = rgb(mat.trim, shade * 0.85, 0.4);
          ctx.beginPath();
          ctx.moveTo(p0[0], p0[1]);
          ctx.lineTo(p1[0], p1[1]);
          ctx.stroke();
        }
      }
    };
    const tri = (a: [number, number, number], b: [number, number, number], shade: number): void => {
      ctx.beginPath();
      ctx.moveTo(csx, csy);
      ctx.lineTo(cam.worldToScreenX(a[0], a[1]), cam.worldToScreenY(a[0], a[1], a[2]));
      ctx.lineTo(cam.worldToScreenX(b[0], b[1]), cam.worldToScreenY(b[0], b[1], b[2]));
      ctx.closePath();
      ctx.fillStyle = rgb(mat.floor, 0.9 * shade);
      ctx.fill();
      if (done) lap(a, b, shade);
      ctx.beginPath();
      ctx.moveTo(csx, csy);
      ctx.lineTo(cam.worldToScreenX(a[0], a[1]), cam.worldToScreenY(a[0], a[1], a[2]));
      ctx.lineTo(cam.worldToScreenX(b[0], b[1]), cam.worldToScreenY(b[0], b[1], b[2]));
      ctx.closePath();
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
      const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, midH((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, roof(nx, ny))];
      // Both halves of a slope face the same way, so both take the shade of
      // the slope itself: the way out from the middle of the roof to the
      // middle of this side.
      const shade = shadeOf(mid[0] - cx, mid[1] - cy);
      tri(a, mid, shade);
      tri(mid, b, shade);
      /*
       * And the edge of it, which is where a roof stops being a shape and
       * starts being a thing. An eave is the ends of the rafters and the
       * courses over them — a board's depth of it, hanging over whatever is
       * under — and a roof drawn without one ends in a line and reads as a
       * folded sheet. Only at an edge with no roof carrying on from it, and
       * only on the sides the camera is on.
       */
      if (done && zoom >= 0.5 && !roof(nx, ny) && cam.nearSide(nx - x, ny - y) > 0) {
        ctx.beginPath();
        ctx.moveTo(cam.worldToScreenX(a[0], a[1]), cam.worldToScreenY(a[0], a[1], a[2]));
        ctx.lineTo(cam.worldToScreenX(b[0], b[1]), cam.worldToScreenY(b[0], b[1], b[2]));
        ctx.lineTo(cam.worldToScreenX(b[0], b[1]), cam.worldToScreenY(b[0], b[1], b[2] - EAVE_DEEP));
        ctx.lineTo(cam.worldToScreenX(a[0], a[1]), cam.worldToScreenY(a[0], a[1], a[2] - EAVE_DEEP));
        ctx.closePath();
        ctx.fillStyle = rgb(mat.trim, shade * 0.9);
        ctx.fill();
        ctx.strokeStyle = rgb(mat.trim, shade * 0.7);
        ctx.stroke();
      }
    }
    /*
     * The ridge, capped. Where two slopes meet there is a course of something
     * laid over the joint — it is what keeps the rain out of the one place a
     * roof cannot lap — and it is the line that makes a row of roofs read as
     * a street rather than as a field of pyramids.
     */
    if (done && zoom >= 0.55) {
      ctx.strokeStyle = rgb(mat.floor, 1.14);
      ctx.lineWidth = Math.max(1.5, 3 * zoom);
      for (let i = 0; i < 4; i++) {
        const [nx, ny] = neighbours[i];
        if (!roof(nx, ny)) continue;
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        ctx.beginPath();
        ctx.moveTo(csx, csy);
        ctx.lineTo(cam.worldToScreenX(mx, my), cam.worldToScreenY(mx, my, midH(mx, my, true)));
        ctx.stroke();
      }
      ctx.lineWidth = 1;
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

  /**
   * A floor, laid rather than coloured in.
   *
   * It was one flat lozenge of the material's floor colour, which from above
   * is the same shape and the same nothing as the ground under it — a storey
   * of oak boards and a storey of marble differed by hue and by no other
   * thing. And an upper floor had no edge to it at all: a deck five metres up
   * ended in a line, so a house with its top storey half laid looked like a
   * sheet of paper laid over the walls.
   *
   * So a floor has a thickness at any edge that nothing carries on from, and
   * it is laid in boards or in flags with the joints showing. The boards run
   * the way the building runs, which is what makes a room of them read as one
   * floor rather than as a grid of tiles each doing its own thing.
   */
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
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const [nx, ny] = out[i];
      if (cam.nearSide(nx, ny) <= 0) continue;
      ctx.beginPath();
      ctx.moveTo(px(i), py(i, f.top));
      ctx.lineTo(px(j), py(j, f.top));
      ctx.lineTo(px(j), py(j, c[j]));
      ctx.lineTo(px(i), py(i, c[i]));
      ctx.closePath();
      // The face that runs across the view catches more light than the one
      // running into it: the same two tones every wall in the world uses.
      ctx.fillStyle = rgb(CONCRETE, Math.abs(cam.rotateX(nx, ny)) > Math.abs(cam.rotateY(nx, ny)) ? 0.82 : 0.66);
      ctx.fill();
      ctx.strokeStyle = rgb(CONCRETE_TRIM, 0.85);
      ctx.stroke();
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
    if (paved && cam.zoom >= 0.75) this.paving(t, x, y, data, quad);
    ctx.globalAlpha = 1;
  }

  private drawFloor(floor: FloorTile, x: number, y: number, base: number, alpha: number): void {
    const ctx = this.canvas.ctx;
    const cam = this.camera;
    const bare = MATERIAL_BY_ID.get(floor.material);
    if (!bare) return;
    const mat = this.painted(bare, floor.dye);
    const h = base + floor.level * WALL_HEIGHT + 0.5;
    const done = isDone(floor);
    const zoom = cam.zoom;
    /** A point on the deck, by its two shares across the tile. */
    const fx = (u: number, v: number): number => cam.worldToScreenX(x + u, y + v);
    const fy = (u: number, v: number, dh = 0): number => cam.worldToScreenY(x + u, y + v, h - dh);
    const patch = (u0: number, u1: number, v0: number, v1: number): void => {
      ctx.beginPath();
      ctx.moveTo(fx(u0, v0), fy(u0, v0));
      ctx.lineTo(fx(u1, v0), fy(u1, v0));
      ctx.lineTo(fx(u1, v1), fy(u1, v1));
      ctx.lineTo(fx(u0, v1), fy(u0, v1));
      ctx.closePath();
    };
    ctx.globalAlpha = alpha * (done ? 1 : 0.4);
    patch(0, 1, 0, 1);
    ctx.fillStyle = rgb(mat.floor, 0.95);
    ctx.fill();
    if (done && zoom >= 0.55) {
      /*
       * Boards one way for wood, flags both ways for stone. Which way the
       * boards run is the building's, not the tile's, so a room is boarded
       * across rather than patchworked; and no two boards are quite the same
       * piece of timber.
       */
      const along = (floor.building + floor.level) % 2 === 0;
      if (mat.kind === 'wood') {
        const n = mat.courses;
        for (let i = 0; i < n; i++) {
          const a = i / n;
          const b = (i + 1) / n;
          if (along) patch(0, 1, a, b);
          else patch(a, b, 0, 1);
          const k = hash2(x * 4 + i, y * 4, 71);
          ctx.fillStyle = rgb(mat.floor, 0.95 * (0.93 + k * 0.15));
          ctx.fill();
        }
        ctx.strokeStyle = rgb(mat.trim, 0.9, 0.45);
        for (let i = 1; i < n; i++) {
          const a = i / n;
          ctx.beginPath();
          ctx.moveTo(fx(along ? 0 : a, along ? a : 0), fy(along ? 0 : a, along ? a : 0));
          ctx.lineTo(fx(along ? 1 : a, along ? a : 1), fy(along ? 1 : a, along ? a : 1));
          ctx.stroke();
        }
      } else {
        // Flags rather than boards, and one size smaller than the same stone
        // goes on a roof in: a floor is walked on and a roof is only looked at.
        // The bed goes down first and the flags on top of it, so the mortar
        // between them is a colour rather than a gap: a dark floor laid with
        // flags a shade off each other is a dark floor and nothing else.
        const n = Math.max(2, mat.courses - 1);
        patch(0, 1, 0, 1);
        ctx.fillStyle = rgb(mat.trim, 0.9);
        ctx.fill();
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            const j = 0.07 / n;
            patch(c / n + j, (c + 1) / n - j, r / n + j, (r + 1) / n - j);
            const k = hash2(x * 4 + c, y * 4 + r, 73);
            ctx.fillStyle = rgb(mat.floor, 0.95 * (0.93 + k * 0.16));
            ctx.fill();
          }
        }
      }
    }
    patch(0, 1, 0, 1);
    ctx.strokeStyle = done ? rgb(mat.trim, 1) : PLAN_COLOR;
    if (!done) ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    /*
     * And the edge of the deck, where there is nothing to carry on into. A
     * floor is joists and boards and it has a depth; drawn without one it ends
     * in a line, which is the one thing a floor five metres up never does.
     */
    if (done && floor.level > 0) {
      const bld = this.game.buildings;
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
        if (cam.nearSide(nx, ny) < 0) continue;
        if (bld.floor(floor.level, x + nx, y + ny)) continue;
        ctx.beginPath();
        ctx.moveTo(fx(u0, v0), fy(u0, v0));
        ctx.lineTo(fx(u1, v1), fy(u1, v1));
        ctx.lineTo(fx(u1, v1), fy(u1, v1, -FLOOR_DEEP));
        ctx.lineTo(fx(u0, v0), fy(u0, v0, -FLOOR_DEEP));
        ctx.closePath();
        // The edge that runs across the view catches more of the light than
        // the one that runs into it, as a wall's two faces do.
        ctx.fillStyle = rgb(mat.trim, Math.abs(cam.rotateX(nx, ny)) > Math.abs(cam.rotateY(nx, ny)) ? 0.95 : 0.76);
        ctx.fill();
        ctx.strokeStyle = rgb(mat.trim, 0.6);
        ctx.stroke();
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
    const h0 = base + wall.level * WALL_HEIGHT;
    const h1 = h0 + WALL_HEIGHT * (kind?.height ?? 1);
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
    /** And the end of a run, where the thickness shows as end grain. */
    const endOf = (t: number, k0: number, k1: number): void => {
      ctx.beginPath();
      ctx.moveTo(px(t, k0, 1), py(t, k0, 1));
      ctx.lineTo(px(t, k0, -1), py(t, k0, -1));
      ctx.lineTo(px(t, k1, -1), py(t, k1, -1));
      ctx.lineTo(px(t, k1, 1), py(t, k1, 1));
      ctx.closePath();
    };
    // The face running along the view's x axis catches the light. How much of
    // it does is a matter of degree rather than a choice between two: turning
    // the view an eighth would otherwise jump a wall between the two tones,
    // and at a diagonal it is neither.
    const vx = cam.rotateX(dx, dy);
    const vy = cam.rotateY(dx, dy);
    const along = Math.abs(vx);
    const into = Math.abs(vy);
    const face = along / (along + into || 1);
    const lit = 0.72 * (1 - face) + (vx > 0 ? 1 : 0.8) * face;
    // A cap looks at the sky and an end looks away from it.
    const topLit = Math.min(1.3, lit * 1.24);
    const endLit = lit * 0.74;
    const done = isDone(wall);
    const zoom = cam.zoom;
    /** Whether a wall of the same storey carries on past this one's end. */
    const on = (i: number): boolean => {
      const b: Border = border.dir === 'h'
        ? { dir: 'h', x: border.x + i, y: border.y }
        : { dir: 'v', x: border.x, y: border.y + i };
      const w = this.game.buildings.wallOnBorder(wall.level, b);
      return !!w && isDone(w);
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
    if (kind?.railed) {
      /*
       * Posts and rails, each of them a piece of timber with a top to it: a
       * fence drawn flat is a comb, and a comb is what this was.
       */
      const post = (t: number, w: number): void => {
        const t0 = Math.max(0, t - w);
        const t1 = Math.min(1, t + w);
        quad(t0, t1, 0, 1);
        ctx.fillStyle = rgb(mat.color, lit);
        ctx.fill();
        ctx.strokeStyle = rgb(mat.trim, lit * 0.9);
        ctx.stroke();
        cap(t0, t1, 1);
        ctx.fillStyle = rgb(mat.color, topLit);
        ctx.fill();
        ctx.stroke();
      };
      for (const [k0, k1] of [[0.3, 0.45], [0.7, 0.85]] as Array<[number, number]>) {
        quad(0, 1, k0, k1);
        ctx.fillStyle = rgb(mat.color, lit * 0.92);
        ctx.fill();
        ctx.strokeStyle = rgb(mat.trim, lit * 0.85);
        ctx.stroke();
        cap(0, 1, k1);
        ctx.fillStyle = rgb(mat.color, topLit * 0.94);
        ctx.fill();
      }
      for (const t of [0.04, 0.5, 0.96]) post(t, 0.05);
      if (wall.type === 'fence_gate' || wall.type === 'iron_gate') {
        // The leaf hangs behind the posts, which is what the recess says.
        const iron = wall.type === 'iron_gate';
        quad(0.09, 0.45, 0.06, 0.94, -0.4);
        ctx.fillStyle = rgb(iron ? [72, 74, 80] : mat.floor, lit, 0.9);
        ctx.fill();
        ctx.strokeStyle = rgb(iron ? [40, 42, 48] : mat.trim, lit);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px(0.11, 0.1, -0.4), py(0.11, 0.1, -0.4));
        ctx.lineTo(px(0.43, 0.9, -0.4), py(0.43, 0.9, -0.4));
        ctx.stroke();
        if (iron) {
          // Two straps across it, which is where the iron actually is.
          ctx.lineWidth = Math.max(1.5, 2.4 * zoom);
          ctx.strokeStyle = rgb([54, 56, 62], lit);
          for (const k of [0.24, 0.76]) {
            ctx.beginPath();
            ctx.moveTo(px(0.09, k, -0.4), py(0.09, k, -0.4));
            ctx.lineTo(px(0.45, k, -0.4), py(0.45, k, -0.4));
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
    const cob = wall.material === 'cobblestone' && !wall.dye ? cobble() : undefined;
    if (cob) {
      const bld = this.game.buildings;
      /** Which of the five, by where the wall is: neighbours differ, and a wall keeps its own. */
      const v = Math.abs(border.x * 31 + border.y * 17 + wall.level * 7) % cob.face.length;
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
      /** A picture, between three of its corners: top left, top right, bottom left. */
      const blit = (img: HTMLCanvasElement, k0: number, k1: number, s = 1, across = false): void => {
        const [tlx, tly] = across ? [px(0, k1, -1), py(0, k1, -1)] : [px(0, k1, s), py(0, k1, s)];
        const [trx, try_] = across
          ? [px(1, k1, -1), py(1, k1, -1)]
          : [px(1, k1, s), py(1, k1, s)];
        const [blx, bly] = across ? [px(0, k1, 1), py(0, k1, 1)] : [px(0, k0, s), py(0, k0, s)];
        ctx.save();
        ctx.transform(
          (trx - tlx) / img.width, (try_ - tly) / img.width,
          (blx - tlx) / img.height, (bly - tly) / img.height,
          tlx, tly,
        );
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      };
      /** And the hour's light over it, laid the way the flat colours take it. */
      const light = (k: number): void => {
        if (k >= 0.999) return;
        ctx.fillStyle = `rgba(24, 20, 12, ${((1 - k) * 0.85).toFixed(3)})`;
        ctx.fill();
      };
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
      const cut = arched || windowed || doored || gated;
      /** Whichever hole this section has, added to the path that is open. */
      const hole = (s: number): void => {
        if (arched) { this.archGeom({ px, py, quad }, zoom).hole(s); return; }
        const [t0, t1, k0, k1] = doored
          ? [DOOR.t0, DOOR.t1, 0, DOOR.k1]
          : gated
            ? [DOUBLE.t0, DOUBLE.t1, 0, DOUBLE.k1]
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
      blit(arched ? cob.arch[v]
        : windowed ? cob.window[v]
        : doored ? cob.door[v]
        : gated ? cob.gate[v]
        : cob.face[v], 0, 1);
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
        if (wall.level === 0 && !indoors) blit(cob.base[v], 0, 1, -1);
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
        if (doored || gated) this.cobDoor(cob, { px, py, quad }, zoom, gated ? 2 : 1);
        else this.cobGlass(cob, { px, py, quad }, zoom, this.lampBehind(wall, border));
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
        blit(cob.foot[v], 0, 1);
        // The face's half of the hedge, where a doorway took the other half
        // round the corner with it.
        if (arched) blit(cob.base[v], 0, 1);
        offStone();
        // Anywhere else it is one picture and goes on whole: a bush that has
        // grown up in front of a window stands in front of it, glass and all.
        if (!arched) blit(cob.base[v], 0, 1);
        if (arched) blit(cob.archWeed[v], 0, 1);
      }
      if (windowed) blit(cob.winWeed[v], 0, 1);
      if (doored) blit(cob.doorWeed[v], 0, 1);
      if (gated) blit(cob.gateWeed[v], 0, 1);
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
      quad(0, 1, 0, 1);
      light(lit);
      cap(0, 1, 1);
      ctx.fillStyle = rgb(mat.color, topLit);
      ctx.fill();
      blit(cob.cap, 1, 1, 1, true);
      cap(0, 1, 1);
      light(topLit);
      for (const [t, i] of [[0, -1], [1, 1]] as Array<[number, number]>) {
        if (on(i)) continue;
        endOf(t, 0, 1);
        ctx.fillStyle = rgb(mat.color, endLit);
        ctx.fill();
        ctx.save();
        ctx.clip();
        const [ex, ey] = [px(t, 1, 1), py(t, 1, 1)];
        ctx.transform(
          (px(t, 1, -1) - ex) / cob.ends.width, (py(t, 1, -1) - ey) / cob.ends.width,
          (px(t, 0, 1) - ex) / cob.ends.height, (py(t, 0, 1) - ey) / cob.ends.height,
          ex, ey,
        );
        ctx.drawImage(cob.ends, 0, 0);
        ctx.restore();
        endOf(t, 0, 1);
        light(endLit);
      }
      /*
       * The ivy last, and unlit: it stands proud of the cap, so it has to go on
       * over it, and a leaf in the sun is in the sun whichever way the wall
       * behind it is turned.
       */
      if (!roofed && !indoors) {
        blit(cob.spill[v], 0, 1 + cob.pad / cob.h);
        // And the tongue of it that hangs into the opening, on the variants
        // whose curtain reaches that far along the wall.
        if (arched) blit(cob.archIvy[v], 0, 1);
        if (windowed) blit(cob.winIvy[v], 0, 1);
        if (doored) blit(cob.doorIvy[v], 0, 1);
        if (gated) blit(cob.gateIvy[v], 0, 1);
      }
      if (!cut) this.wallOpenings(wall, mat, lit, { px, py, quad }, zoom, border);
      ctx.globalAlpha = 1;
      return;
    }
    /* The face, then what it is made of, then the top and the end. */
    quad(0, 1, 0, 1);
    ctx.fillStyle = rgb(mat.color, lit);
    ctx.fill();
    if (zoom >= 0.5) this.wallGrain(mat, lit, border.x * 31 + border.y * 17 + wall.level, { px, py, quad }, zoom);
    /*
     * And the light down the face of it. Nothing out of doors is one flat
     * tone from top to bottom: the ground throws shade back up the first foot
     * of a wall and the sky picks out the last of it, and without that a wall
     * of however good a masonry sits on the grass like a decal.
     */
    quad(0, 1, 0, 1);
    const wash = ctx.createLinearGradient(px(0.5, 0), py(0.5, 0), px(0.5, 1), py(0.5, 1));
    wash.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
    wash.addColorStop(0.3, 'rgba(0, 0, 0, 0.05)');
    wash.addColorStop(0.82, 'rgba(255, 255, 255, 0.03)');
    wash.addColorStop(1, 'rgba(255, 255, 255, 0.1)');
    ctx.fillStyle = wash;
    ctx.fill();
    ctx.strokeStyle = rgb(mat.trim, lit * 0.9);
    ctx.stroke();
    cap(0, 1, 1);
    ctx.fillStyle = rgb(mat.color, topLit);
    ctx.fill();
    ctx.stroke();
    /*
     * And the end grain, at an end that nothing carries on from. A run of
     * wall down a street is one wall to look at; it is only where a run stops
     * that the thickness of it should be on show.
     */
    for (const [t, i] of [[0, -1], [1, 1]] as Array<[number, number]>) {
      if (on(i)) continue;
      endOf(t, 0, 1);
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
        this.wallOpening(mat, lit, g, 0.18, 0.82, 0.33, 0.82, 'glass', zoom, this.lampBehind(wall, border));
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
   * The threshold: the one stone in a wall that gets walked on.
   *
   * It is the floor of the opening, seen in plan, and it is the lightest
   * surface in the whole of it because it is the only one lying face up at
   * the sky. The hollow worn down its middle is the part that says a doorway
   * is used rather than drawn: nothing else on the wall has anybody's boots
   * in it.
   */
  private threshold(cob: Cobble, g: WallGeom, t0: number, t1: number, zoom: number): void {
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
  private cobDoor(cob: Cobble, g: WallGeom, zoom: number, leaves: 1 | 2): void {
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
    const shown = px(0.5, 0.5, -1) - px(0.5, 0.5, 1) > 0 ? 0 : 1;
    const at = (u: number): number => t0 + (t1 - t0) * u;
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
        : [shown ? [0.54, 0.98] : [0.02, 0.46]];
      for (const [a, b] of bands) {
        quad(at(a), at(b), k - 0.015, k + 0.015, -1);
        ctx.fillStyle = rgb(IRON, 1);
        ctx.fill();
      }
    }
    // And a ring to pull it by -- one on a door, one to each leaf on a gate.
    const rings = leaves === 2 ? [0.5 - 0.125, 0.5 + 0.125] : [shown ? 0.58 : 0.42];
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
  private cobGlass(cob: Cobble, g: WallGeom, zoom: number, alight: number): void {
    const ctx = this.canvas.ctx;
    const { px, py, quad } = g;
    const { t0, t1, k0, k1 } = WINDOW;
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
