import { gearFrom, wornWire } from '../game/worn';
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
  TOP_LEVELS,
  type Column,
  type Border,
  type FloorTile,
  type StairHand,
  type MaterialDef,
  type Side,
  type Wall,
  type Building,
  floorBill,
  roofShapeOf,
  CELLAR_DEPTH,
  CELLAR_LEVEL,
  type CellarTile,
} from '../game/building';
import { foundationDone } from '../game/foundations';
import { DYE_BY_ID } from '../game/dyestuffs';
import { hash2 } from '../world/noise';
import { bareRock, DAMP_SAND, dustiness, FLAT, growth, oreWash, PAVED, ROCK_VARIANTS, SLAB_VARIANTS, STREWN, TileType, TILE_DEFS, COVERED, bushSpecies, slabVariant, trailGround, stonesBed, treeSpecies, treeVariant } from '../world/tiles';
import { HALF_H, HALF_W, HEIGHT_SCALE, UNITS_PER_TILE } from './iso';
import { HUNT_REACH, inFightReach, isFightJob, WIND_UP } from '../game/fight';
import { depthOf, type View } from './view';
import { FALLS, roofModel, type Fall, type RoofGable, type RoofModel, type RoofPt } from './roofshape';
import { COVER_PPT, covering } from './roofing';
import { glass, glassBack, glassFace, glassReflects } from './glazing';
import { GLASS } from '../game/glasshouse';
import type { LightSource } from '../game/light';
import { FLOOR_PPT, FLOOR_TILES, concrete, flooring, slabbing } from './flooring';
import { LADDER, stairStyle } from './stairing';
import { BEAM_DEEP, drawBeam, drawColumn, drawJettySupports, drawRailing, JOIST_DEEP, PILASTER_PROUD, type Cut, type RailEnds } from './framing';
import { jettyBase } from '../game/frame';
import { drawSteps, stepsFootAt } from './steps';
import { seasonAt, type Season } from '../world/calendar';
import { drawShine, shines } from './shine';
import { ARCH, BAY, DOOR, DOUBLE, FENCE_GAP, WINDOW, type Masonry, adobe, brickwork, cobble, goldwork, logwork, glasswork, marblework, planking, sandstone, silverwork, slatework, stonework, timbercraft } from './masonry';
import { CAP_D, CAP_W, capMoss, hashOf, ivyLayout, mossStrip, PAVE_STAGES, pavingMoss, PPM, slabTopMoss, strandPic, vigour, type Keep } from './ivy';
import { bridgeGreen, greenNow, greenShows, GREEN_WET_REACH, mossyPiece, pavingGreen, pieceGreen, slabGreen, wallGreen, wetFrom } from '../game/greening';
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
import { clothInWind, crewOrder, deviceOf, drawFurniture, drawFurnitureLive, driverOn, furnitureHoles, reinsTo, rowedPiece, furnitureSpan, FURNITURE_HEIGHT, glowsAtNight, headingView, mossTrim, PIECE_STAGES, pieceView, planterTrim, roseTrim, type Air, type Crew, type PieceView } from './furniture';
import { roseStage } from '../game/roses';
import { fieldRate } from '../game/growth';
import { dyeOf } from '../game/dyestuffs';
import { sailTrim } from '../game/wind';
import { FURNITURE_BY_ID, isPlanter, rackDeck, rackSpots } from '../game/furniture';
import { isLampPiece, lampBurning } from '../game/lamps';
import { drawLampBloom } from './furniture';
import { COUNTER_HOLDS, counterHeld, counterSeat, streetOf } from '../game/counters';
import { counterHole, counterWares, drawCounterDaylight, drawCounterFrontKept, drawCounterInside, drawCounterReveal, stripeOf, type CounterLook } from './counter';
import { cropDef, type CropLook } from '../game/farming';
import { crateCentre, crateKindOfItem, subtileOf, SUBTILES } from '../game/crates';
import { HUNT_SIGHT, maxHealth, PLAYER_ATTACKER, SPECIES, type Creature } from '../game/creatures';
import { rarityOf } from '../game/items';
import { CREST_ALPHA, FOAM_WIDTH, foamAlpha, LONG_WAVE, SHORT_WAVE, SPRING_EDGE, SPRING_PALETTE, springLevel, SWELL_RATE, SWELL_SPEED, swellAt, swellShow, TROUGH_ALPHA, WATER_LIT, WATER_PALETTE, waterLevel } from './water';
import { Wakes } from './wake';
import { foamTexture, SpringWater } from './ponds';
import { drawFountain } from './fountain';
import { fallView } from './falls';
import { AqueductPainter, hullOf, type AqueductPart, type AqueductShape } from './aqueducts';
import { drawPool, type Run } from './pools';
import { drawStones, STONES_RISE } from './stones';
import { drawPierFeet, drawPierTile, pierFeetOf, slabOutline, type PierFoot, type PierTile } from './piers';
import { drawPlantsFlat, drawPlantUpright, plantFoot, standsUp, type PlantFrame } from './waterplants';
import type { WaterPlant } from '../world/waterplants';
import type { WaterField } from '../world/springs';
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
/** The share of the screen's pixels the swell's gradients are worked out at, across and down (`drawSwell`). */
const SWELL_RES = 0.5;
/** The most bands of a tree's picture its sway is laid on in (`drawTree`); a gale on a tall tree puts a pixel and a bit between them. */
const TREE_BANDS = 24;
/** Device pixels of tree pictures kept between frames (`drawTree`): about forty-eight megabytes. */
const TREE_PIXELS = 12_000_000;

/** A tree drawn ready for the screen (`drawTree`), and where in it the foot is. */
interface TreePicture {
  cv: HTMLCanvasElement;
  footX: number;
  footY: number;
  /** The frame it was last put down in. */
  used: number;
}
/** How long a wall's or a roof's picture is kept before it is made again whatever happens (`baked`), in seconds. */
const BAKE_LIFE = 0.5;
/** Device pixels of wall and roof pictures kept before the lot go: about a hundred and twenty-eight megabytes. */
const BAKE_PIXELS = 32_000_000;
/** No one picture is bigger than this; a thing that would be is drawn as it always was. */
const BAKE_MOST = 4_000_000;
/** How dark it is when a lamp inside starts to show through a wall or a roof (`lampBehind`), and pictures stop being kept. */
const LAMP_DARK = 0.2;
/** A wall's or a roof's picture, where it was made, where its corner went, when, and how long it is kept. */
interface Baked {
  cv: HTMLCanvasElement;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  at: number;
  life: number;
}
/** How many device pixels of tile edge pictures are kept before the lot go (`hems`): about sixty-four megabytes. */
const HEM_PIXELS = 16_000_000;
/** No one tile's edge picture is bigger than this; a tile that would be is drawn as it always was. */
const HEM_TILE_MOST = 400_000;
/** A tile's ruffled edges as a picture, where it was made, and where its top-left corner went (CSS pixels). */
interface HemPicture {
  cv: HTMLCanvasElement | null;
  px: number;
  py: number;
  bx: number;
  by: number;
}

/** The thin darker line where a pond meets its bank. */
const POND_SHORE = `rgba(${SPRING_EDGE.join(',')},0.6)`;

/** The top of a creature crate's floor, in pixels at zoom 1: 0.7 units up. */
const CRATE_FLOOR = 0.7 * HEIGHT_SCALE;
/** How big a wildermon is drawn in a crate against out in the world, so a grown one stands inside it. */
const CRATE_SCALE = 0.8;
import { FLOAT_COLOURS, Floaters } from './floaters';
import { drawSpeech } from './bubble';
import { SKILL_BY_ID } from '../game/skills';
import { PUFFS, PUFF_DRIFT, PUFF_RISE, puffAge, puffOf } from './smoke';
import { CROWD, DROWNS, hemOf, ruffle, strew, strewLook, WADES, WADE_DEPTH, type Lobe } from './meadow';
import { seam } from './seam';
import { SWAY_MAX, swayAt } from './sway';
import { Timings } from './timings';
import { ColourPages, MarkPages } from './pages';
import { trailMask, trailShape, type TrailShape } from './trails';
import { clumpOf, FLOWER_COLOURS, flowerSprite, swayFrame, tileColour } from './flowers';
import { flowerSeason, flowersOn } from '../world/flowers';
import { drawFace, EDGES, ROCK_MOSS, topEdges, type Face } from './outcrops';
import { forgetTrees, grownAt, spriteScaleFor, bushSprite, crateSprite, cropSprite, drawAnvil, drawCampfire, drawCreature, drawKiln, drawPlayer, drawSmelter, facingOf, pileSprite, tokenSprite, treeSprite, type Sprite, drawWorkPost, drawTrap, drawDeck, stumpSprite, type DeckShape } from './sprites';
import { wildermonHead, wildermonTop } from './wildermon';
import {
  drawChains, drawDrawbridgeSpan, drawGallows, drawGatewayDressing, drawGrille, drawGrooves, drawHiddenMark, drawHingeCrib, drawLandingCrib,
  drawStandingDeck,
  gallowsTop, gatewayArch, gatewayClear, gatewayPicture, moveTo, DRAWBRIDGE_FALL, DRAWBRIDGE_RISE, GATEWAY, PORTCULLIS_DROP, PORTCULLIS_RISE, type ArchShape,
  type DrawbridgeGeom, type Motion, type WallFace,
} from './gates';
import { hingeKey, hingeOf, isDrawbridge, landingOf } from '../game/gates';
import { bridgeDone, type Bridge } from '../game/bridges';
import { SmallLife, type Mote } from './life';
import { personBody, SpellStage, type Aim, type Who } from './spells/stage';
import { spellInfo } from './spells/info';
import type { Body as SpellBody, WorldRec as SpellRec } from './spells/kit';
import type { CastAt } from '../game/events';
import { lookStep, yearAt } from './foliage';
import { FIGURE_TOP, type Seat } from './figure';
/**
 * How much larger a beast in the traces is drawn than one loose: enough that
 * a grown orse, the draught beast, stands a quarter again as tall as a body
 * (`FIGURE_TOP`), as a horse in harness stands over its driver. The rest of a
 * team is drawn up by the same, so a team keeps its kinds' sizes to each other.
 */
/**
 * A rider in the saddle: astride, the seat where the saddle is, and the reins
 * out over the withers to the bit, ahead of the saddle and up at the height
 * of the beast's mouth.
 */
const SADDLE: Seat = { hands: 'reins', up: 0, astride: true, grip: [0, 7.5, 2.5] };
/** Reins: dark leather, inked. */
const REIN_LEATHER = 'rgb(112, 74, 46)';
const REIN_LINE = 'rgba(46, 30, 22, 0.85)';
const TRACES_SCALE = Math.max(1, (1.25 * FIGURE_TOP) / (wildermonTop('orse') ?? FIGURE_TOP));
import {
  CELLAR_DARK, CELLAR_DARK_INK, CELLAR_FALL, CELLAR_VEIL, cellarFloor, cellarFloorHeight, cellarOrder, cutFace, earthEnd, earthFace, faceOn, KERB, OUT, UNDER,
  flightShade, SHAFT_STOPS, shaftAlpha, shaftShade, sidesOf, type CellarCanvas,
} from './cellar';

/** Result of picking a screen point: the tile, the approximate world position and the nearest corner. */
/**
 * What is on its way to the ground: a piece of furniture following the
 * cursor, or a staircase on its tile, turned the way Q and E have turned it.
 * `ok` is whether it can go where it is.
 */
export type Ghost =
  | { kind: 'furniture'; piece: string; material?: string; x: number; y: number; sx: number; sy: number; facing: Side; ok: boolean }
  | { kind: 'stairs'; x: number; y: number; level: number; material: string; floorKind: 'stairs' | 'ladder'; side: Side; hand?: StairHand; ok: boolean };

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
  /** Picked on the floor of a cellar, looking into it, rather than on the ground over it. */
  down?: boolean;
}

interface Entity {
  kind: 'tree' | 'bush' | 'stump' | 'player' | 'peer' | 'pile' | 'token' | 'crate' | 'creature' | 'campfire' | 'crop' | 'smelter' | 'kiln' | 'furniture' | 'hull' | 'anvil' | 'post' | 'trap' | 'deck' | 'life' | 'waterplant' | 'spell';
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
  deck?: { kind: string; done: boolean; drop: number; id: number; shape?: DeckShape; green?: number; span?: number };
  /** A lotus standing up off the water: its raised leaves, flowers and seed heads, sorted among what else stands there. */
  plant?: WaterPlant;
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
  /**
   * Sat driving something with a seat of its own (`driverOn` in
   * `./furniture`): what is sat on and held, and the way the body faces,
   * square along the piece however it is turned rather than the nearest of
   * the eight ways, so it sits square on the bench.
   */
  seat?: Seat;
  seatFacing?: number;
  /** Which way round a piece is drawn this frame, worked out once where it is taken, so its layers and its crew agree. */
  view?: PieceView;
  /** For a hull drawn in layers round the people on her (`takeAboard`): which layer this is. */
  layer?: number;
  /** Something small aloft over this line of the ground: a butterfly, a dragonfly, a petal or a leaf (`./life`). */
  mote?: Mote;
  /** A piece of a spell standing in the world: an orb, a bolt, a shell, a puff of its smoke (`./spells`). */
  fx?: SpellRec;
  /** A piece of an aqueduct: a bay's insides or its face and water, the spout at its foot, or the cut at its head (`./aqueducts`). */
  aq?: AqueductPart;
  /** The part of the screen a body shows in, for one down a hole: the ground in front of the hole hides the rest (`onFlight`). */
  clip?: Array<[number, number]>;
}

/**
 * Where the people on a hull stand, for baking her in layers round them
 * (`Crew` in `./furniture`): her helm first, then each passenger's place, in
 * her own units. Only a hull with a deck of her own to stand on has one --
 * a rowing boat's or a sailing boat's helm sits in her middle, under
 * nothing -- and only one of those is worth a picture per person.
 */
const crews = new Map<string, Crew | null>();
function crewOf(kind: string): Crew | null {
  let c = crews.get(kind);
  if (c === undefined) {
    const boat = furnitureDef(kind).boat;
    c = boat && (boat.helm || boat.deck?.length) ? {
      tall: FIGURE_TOP / HEIGHT_SCALE,
      at: [
        [(boat.helm?.[0] ?? 0) * UNITS_PER_TILE, (boat.helm?.[1] ?? 0) * UNITS_PER_TILE, boat.seat / HEIGHT_SCALE],
        ...(boat.deck ?? []).map(([along, across]): [number, number, number] => [along * UNITS_PER_TILE, across * UNITS_PER_TILE, (boat.waist ?? boat.seat) / HEIGHT_SCALE]),
      ],
    } : null;
    crews.set(kind, c);
  }
  return c;
}

/**
 * A wall drawn after a pilaster it runs out from (`Renderer.pilasterGuard`):
 * from `x` on the screen on, on its `side`, and what of it stands over the
 * pilaster's head nearer the corner inside the box `over` (x0, y0, x1, y1),
 * over the head's line where the pilaster is let go to be seen through.
 */
interface PilasterGuard {
  x: number;
  side: number;
  over: [number, number, number, number] | null;
  /** The pilaster's head's line along the face, where it crosses the box's two sides. */
  head: [number, number] | null;
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
  /** An aqueduct's bay: its outline in the box, which is what a click has to land on (`./aqueducts`). */
  aq?: AqueductShape;
  /** Or the outlines in the box a click has to land on one of, each as x, y pairs: a bridge's deck and its lips. */
  poly?: Float64Array[];
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
const FOG_RGB = '30, 30, 32';
const FOG_ALPHA = 0.46;
const FOG_COLOR = `rgba(${FOG_RGB}, ${FOG_ALPHA})`;
/** The same laid solid, for the wash's own layer (`fogLayer`). */
const FOG_INK = `rgb(${FOG_RGB})`;

/** The indices of the points on the convex hull of a handful of points, in order round it (Andrew's monotone chain). */
function convexHull(xs: readonly number[], ys: readonly number[]): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b] || ys[a] - ys[b]);
  const cross = (o: number, a: number, b: number): number => (xs[a] - xs[o]) * (ys[b] - ys[o]) - (ys[a] - ys[o]) * (xs[b] - xs[o]);
  const lower: number[] = [];
  for (const i of idx) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop();
    upper.push(i);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * A polygon onto a path, its points in `order`, wound the way a tile lying
 * the right way up is wound. Shapes gathered on one path and filled once
 * cover what any of them covers only while they all go round the same way:
 * one wound the other way takes a hole out of the rest where they overlap.
 * A steep tile folded over on itself on the screen comes the other way round.
 */
function windOn(path: Path2D, xs: ArrayLike<number>, ys: ArrayLike<number>, order: ArrayLike<number>): void {
  const n = order.length;
  let area = 0;
  for (let k = 0; k < n; k++) {
    const a = order[k];
    const b = order[(k + 1) % n];
    area += xs[a] * ys[b] - xs[b] * ys[a];
  }
  const at = (k: number): number => order[area >= 0 ? k : (n - k) % n];
  path.moveTo(xs[at(0)], ys[at(0)]);
  for (let k = 1; k < n; k++) path.lineTo(xs[at(k)], ys[at(k)]);
  path.closePath();
}
/** How much of its own colour remembered ground keeps. */
const MEMORY_SATURATION = 0.22;
const GRID_COLOR = 'rgba(0,0,0,0.16)';
const DEED_COLOR = 'rgba(96, 230, 110, 0.9)';
const DEED_SHADOW = 'rgba(0, 40, 0, 0.6)';
const PLAN_COLOR = 'rgba(120, 220, 140, 0.95)';
/** The shade a wall throws on the ground at its foot: cool, as the shade on a wall's own turned face is. */
const SHADE_INK = 'rgba(50, 44, 70, 0.26)';
/** Steps to a storey's flight: six made every step half a metre, and a flight a pile of blocks. */
const FLIGHT_STEPS = 8;
/** The ground under a jetty: open ground with a storey over it, in its shade. */
const JETTY_SHADE = 'rgba(50, 44, 70, 0.13)';
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
/** The timber of a shop counter's board on a wall drawn in flat colours, and its ink (`counter.ts`). */
const COUNTER_OAK: readonly [number, number, number] = [178, 138, 84];
const COUNTER_OAK_INK: readonly [number, number, number] = [112, 82, 46];
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
/** How far up a face from the water the damp reaches, in height units: seven tenths of a metre. */
const DAMP_UNITS = 7;
/** How steep a tile is: the fall across it, as the ground's colour measures it. */
const slopeOf = (w: { getHeight(x: number, y: number): number }, x: number, y: number): number => {
  const h0 = w.getHeight(x, y), h1 = w.getHeight(x + 1, y), h2 = w.getHeight(x + 1, y + 1), h3 = w.getHeight(x, y + 1);
  return Math.hypot((h1 + h2 - h0 - h3) / 2 / UNITS_PER_TILE, (h2 + h3 - h0 - h1) / 2 / UNITS_PER_TILE);
};
/**
 * The zoom from which wildflowers are the painted clumps rather than a speck
 * of colour each: the level of detail everything else drops at, where a
 * clump would be ten pixels and a head two.
 */
const FLOWERS_DRAWN = 0.6;
/**
 * One side of a cut: the polygon in `a` (screen pairs, `n` numbers) kept to
 * the side of the line (x0, y0)-(x1, y1) that (cx, cy) is on, written into
 * `out`, and how many numbers it came to. Sutherland and Hodgman's, a line at
 * a time, which is all a convex tile needs.
 */
function cutByLine(a: Float64Array, n: number, x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, out: Float64Array): number {
  const dx = x1 - x0, dy = y1 - y0;
  const s = dx * (cy - y0) - dy * (cx - x0) >= 0 ? 1 : -1;
  const side = (px: number, py: number): number => s * (dx * (py - y0) - dy * (px - x0));
  let m = 0;
  let px = a[n - 2], py = a[n - 1];
  let ps = side(px, py);
  for (let i = 0; i < n; i += 2) {
    const qx = a[i], qy = a[i + 1];
    const qs = side(qx, qy);
    if ((qs >= 0) !== (ps >= 0) && m + 2 <= out.length) {
      const t = ps / (ps - qs);
      out[m++] = px + (qx - px) * t;
      out[m++] = py + (qy - py) * t;
    }
    if (qs >= 0 && m + 2 <= out.length) {
      out[m++] = qx;
      out[m++] = qy;
    }
    px = qx;
    py = qy;
    ps = qs;
  }
  return m;
}

/** The radius of a lobe of grass along a worn path's edge, in screen pixels at zoom one: a shade under the ruffle's. */
const TRAIL_LOBE = 3.6;
/** From how close a path's grass is drawn with its shade under it as well as itself. */
const TRAIL_NEAR = 1.5;

/** Circles at `at` moved by (dx, dy) and grown by `grow`, filled in one colour as one shape. */
function circles(g: CanvasRenderingContext2D, at: Lobe[], n: number, dx: number, dy: number, grow: number, fill: string): void {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const [x, y, r] = at[i];
    const rr = Math.max(0.25, r + grow);
    g.moveTo(x + dx + rr, y + dy);
    g.arc(x + dx, y + dy, rr, 0, 7);
  }
  g.fillStyle = fill;
  g.fill();
}
/** And the shade the grass along its edge throws on the path. */
const TRAIL_SHADE = 'rgba(70, 52, 30, 0.13)';
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
/** Whether two sets of numbers hold the same ones, nothing counting as empty. */
function sameSet(a: ReadonlySet<number> | null, b: ReadonlySet<number> | null): boolean {
  if ((a?.size ?? 0) !== (b?.size ?? 0)) return false;
  for (const v of a ?? []) if (!b!.has(v)) return false;
  return true;
}

function hash4(a: number, b: number, c: number, d: number): number {
  let k = (a * 374761393 + b * 668265263 + c * 1442695041 + d * 2246822519) | 0;
  k = Math.imul(k ^ (k >>> 13), 1274126177);
  k = Math.imul(k ^ (k >>> 16), 2654435761);
  return ((k ^ (k >>> 15)) >>> 0) / 4294967296;
}

/** Whether a screen point is inside a polygon of screen points. */
function inOutline(p: ReadonlyArray<readonly [number, number]>, sx: number, sy: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > sy !== yj > sy && sx < ((xj - xi) * (sy - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Which way is out through a piece's front, and which way its width runs, in the world, by the side it faces. */
const FRONT_OF: Record<Side, [number, number]> = { s: [0, 1], e: [1, 0], n: [0, -1], w: [-1, 0] };
const ACROSS_OF: Record<Side, [number, number]> = { s: [1, 0], e: [0, -1], n: [-1, 0], w: [0, 1] };
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
/** What nothing that grows on a wall goes over on a shop counter's face: its opening, the board under it and the awning over it. */
const COUNTER_KEEP = { t0: BAY.t0 - 0.06, t1: BAY.t1 + 0.06, k0: BAY.k0 - 0.2, k1: BAY.k1 + 0.14 } as const;
/** The share of the screen's size the lights' holes in the night and their casts are worked out at: soft enough not to show it. */
const LIGHT_RES = 0.5;
/** A rectangle: x, y, width, height. */
type Box = [number, number, number, number];
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

/** The crops whose plants flower, which a butterfly will come to in a planter: the herbs and the fibre crops. */
const FLOWERING_LOOKS: ReadonlySet<CropLook> = new Set<CropLook>(['herb', 'fibre']);

/** Scratch for the outlines `coveredAfter` tests a point against. */
const COVER_PTS = new Float64Array(8);

/** Whether a point is inside a closed outline of `n` numbers, x, y pairs, by the crossings of a ray from it. */
function inPolygon(p: ArrayLike<number>, n: number, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = p[i];
    const yi = p[i + 1];
    const xj = p[j];
    const yj = p[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** How deep the lip `drawDeck` lays under a deck's edges that run left to right is, in zoom-one pixels. */
const DECK_EDGE = 2.5;

/**
 * The outlines a bridge's deck is drawn in on the screen, each as x, y
 * pairs: its tile at the deck's height (`q`, from the deck's middle in
 * zoom-one pixels), a tile's diamond where it has no shape, and the lip
 * `drawDeck` lays under each of its edges that runs left to right.
 */
function deckOutline(q: ReadonlyArray<readonly [number, number]> | undefined, sx: number, sy: number, zoom: number): Float64Array[] {
  const top = q ?? [[0, -24], [48, 0], [0, 24], [-48, 0]];
  const out = [new Float64Array(top.flatMap(([x, y]) => [sx + x * zoom, sy + y * zoom]))];
  top.forEach(([x, y], i) => {
    const [nx, ny] = top[(i + 1) % top.length];
    if (nx - x <= 0) return;
    const ax = sx + x * zoom, ay = sy + y * zoom, bx = sx + nx * zoom, by = sy + ny * zoom;
    out.push(Float64Array.of(ax, ay, bx, by, bx, by + DECK_EDGE * zoom, ax, ay + DECK_EDGE * zoom));
  });
  return out;
}

/** How far down the pier `drawDeck` stands a deck on reaches from just under its middle, in zoom-one pixels: nought for none. */
function deckPier(kind: string, drop: number): number {
  return drop > 2 && kind !== 'rope' ? Math.min(34, drop * 0.8) : 0;
}

/** Whether a point is within `r` of the segment from `ax, ay` to `bx, by`. */
function nearSegment(ax: number, ay: number, bx: number, by: number, x: number, y: number, r: number): boolean {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(x - ax - dx * t, y - ay - dy * t) <= r;
}

/** Whether a point is inside the convex hull of some points, x, y pairs. */
function inHull(pts: number[], x: number, y: number): boolean {
  const hull = hullOf(pts);
  return hull.length >= 6 && inPolygon(hull, hull.length, x, y);
}

/** A piece of a cellar's drawing laid into a canvas of its own (`Renderer.layOut`), and where it was laid against. */
type CellarLaid = { cv: HTMLCanvasElement; x0: number; y0: number; ax: number; ay: number; w: number; h: number };

/** You, as the spell stage names whoever casts. */
const PLAYER_CASTS: Who = { kind: 'player' };

export class Renderer {
  readonly camera = new Camera();
  time = 0;
  hover: Pick | null = null;
  /** What is being set down, drawn after everything that stands. */
  ghost: Ghost | null = null;
  /** The tile the tile window is looking at, outlined so you can see which it is. */
  selected: { x: number; y: number; down?: boolean } | null = null;
  fps = 0;
  private colors: ColourPages;
  /** Which step of the sun's walk the ground was last shaded for. */
  private lastSun = -1;
  /** Where a shadow falls this frame, in screen pixels, and how dark it is. */
  private shadow = { dx: 0, dy: 0, alpha: 0 };
  /** Tile colours as the map remembers them, for ground nobody is watching. */
  private memColors: ColourPages;
  /**
   * Each tile's path mask plus one (`trails.ts`), worked out from the tiles
   * round it, for ground in sight and ground remembered; the shapes a path's
   * pieces are drawn in, by tile, with the mask they were made for; and the
   * colour of a path's bare earth on each tile in sight, shaded as the ground
   * under it is.
   */
  private trailMarks: MarkPages;
  private trailMemMarks: MarkPages;
  private trailShapes = new Map<number, { mask: number; shape: TrailShape }>();
  private trailPaint: ColourPages;
  /**
   * Each tile's wildflowers plus one: how many clumps, and the colour the
   * patch is mostly, three bits over the count (`flowerAt`). Kept until the
   * tile changes, the season turns, or a building goes up or comes down.
   */
  private flowerMarks: MarkPages;
  private flowerSeasonNow: Season | null = null;
  private flowerBuildings = -1;
  /** Coloured specks for the flowers of a line of ground seen from far off, by colour: x, y pairs. */
  private flowerSpecks: Float32Array[] = FLOWER_COLOURS.map(() => new Float32Array(4096));
  private flowerSpeckN: number[] = FLOWER_COLOURS.map(() => 0);
  /** Each steep tile's face (`outcrops.ts`): its top edges and what grows above them, kept until a tile round it changes. */
  private faces = new Map<number, Face>();
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
    e.plant = undefined;
    e.lift = undefined;
    e.drawDx = undefined;
    e.drawDy = undefined;
    e.standing = undefined;
    e.seat = undefined;
    e.seatFacing = undefined;
    e.rare = undefined;
    e.view = undefined;
    e.layer = undefined;
    e.mote = undefined;
    e.fx = undefined;
    e.aq = undefined;
    e.clip = undefined;
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
  /** Round `seaPath` on the screen: left, top, right, bottom, NaN while there is none. */
  private seaBox = new Float64Array([NaN, NaN, NaN, NaN]);
  private growSeaBox(x: number, y: number): void {
    const b = this.seaBox;
    if (!(b[0] <= x)) b[0] = x;
    if (!(b[1] <= y)) b[1] = y;
    if (!(b[2] >= x)) b[2] = x;
    if (!(b[3] >= y)) b[3] = y;
  }
  /** The tiles of stepping stones on the line of the ground being drawn, as x and y pairs: in sight, and only remembered. */
  private stoneRow: number[] = [];
  private stoneRowDim: number[] = [];
  /** The water round the feet of piers, by the tile in front of each, whose water they wait for (`piers.ts`). */
  private pierFeet = new Map<string, PierFoot[]>();
  /**
   * The lines of the ground with a tile of a building standing on piers in
   * the water, this frame, and those buildings: before each, the swell and
   * the wakes are laid over the water drawn so far (`layWater`).
   */
  private wetPierLines: Set<number> | null = null;
  private wetPierBuildings: Set<number> | null = null;
  /** The width the last tile of ground was edged in: its edge lies half that over the tiles beside it. */
  private groundEdge = 1;
  /**
   * Those buildings as they were last worked out: again only when the tiles
   * on piers change (`Buildings.pierStamp`), or a second on for the water,
   * which can rise under a deck; and their lines again only for a new view.
   */
  private wetPierCache: { stamp: number; at: number; buildings: Set<number> | null; view: View | null; lines: Set<number> | null } | null = null;
  /** The foam a fountain's falling water lands in, made the first time one is drawn running. */
  private fountainFoam: HTMLCanvasElement | null = null;
  /** The water plants on the line of the ground being drawn, and what their drawing is told this frame. */
  private plantRow: WaterPlant[] = [];
  private plantFrame: PlantFrame | null = null;
  /** The top of the water on a tile as it is drawn this frame -- a pond still rising stands where it has got to -- or null where there is none. */
  private readonly drawnSurface = (x: number, y: number): number | null => {
    const w = this.game.world;
    if (!w.hasWater(x, y)) return null;
    let top = -Infinity;
    if (w.water) for (const p of w.water.pondsAt(x, y)) top = Math.max(top, this.springWater.levelOf(p));
    return top > -Infinity ? top : w.surfaceAt(x, y);
  };
  private readonly groundHere = (x: number, y: number): number => this.game.world.heightAt(x, y);
  /**
   * The water springs have made above the sea: its ponds, streams, falls and
   * wells as they are drawn (`./ponds`). Idle, and free, while there are none.
   */
  readonly springWater = new SpringWater();
  /** The aqueducts: their arches, their channels' water, and the falls at their spouts (`./aqueducts`). */
  private readonly aqueducts = new AqueductPainter();
  /** Which curtain each side of each pool's tiles is part of, worked out once a frame for all the tiles that ask (`runOf`). */
  private readonly poolRuns = new Map<number, Run | null>();
  /**
   * Butterflies, dragonflies, fireflies, and what comes down out of the trees
   * (`./life`): worked out once a frame from what is in view and the clock,
   * sorted in with what stands on each line of the ground, and free while
   * zoomed out past `LIFE_FROM`.
   */
  readonly life = new SmallLife();
  /**
   * Every spell on the screen (`./spells`): cast by you or by anybody in
   * sight, followed wherever its caster and its target go, drawn in among
   * everything else, and lighting the night.
   */
  readonly spells: SpellStage = new SpellStage({
    body: (w) => this.spellBody(w),
    ground: (x, y) => (this.game.world.inBounds(Math.floor(x), Math.floor(y)) ? this.game.world.heightAt(x, y) : 0),
    turn: (w, x, y) => this.spellTurn(w, x, y),
    companion: (w) => {
      if (w.kind !== 'player') return null;
      const c = this.game.creatures.active();
      return c ? this.spellBody({ kind: 'creature', id: c.id }) : null;
    },
  });
  /** The season and its day, for the trees' look (`./foliage`): read once a frame off the wall clock, as the hud reads it. */
  private year = yearAt(Date.now() / 1000);
  /** What the small life asks of the island, made once rather than every frame. */
  private readonly lifeVisible = (x: number, y: number): boolean => this.game.vision.state(x, y) === VISIBLE;
  private readonly lifeCovered = (x: number, y: number): boolean => {
    const g = this.game;
    if (g.foundations.size) {
      const slab = g.slabAt(x, y);
      if (slab && !slab.pool) return true;
    }
    return g.buildings.list.size > 0 && g.buildings.buildingAt(x, y) !== undefined;
  };
  private readonly lifeIndoors = (x: number, y: number): boolean =>
    this.game.buildings.list.size > 0 && this.game.buildings.buildingAt(x, y) !== undefined;
  private readonly lifePieces = function* (this: Renderer): Iterable<{ kind: string; x: number; y: number; id: number; at: readonly [number, number] }> {
    for (const f of this.game.furniture.values()) {
      if (f.kind !== 'planter' && f.kind !== 'fish_pond') continue;
      // A planter only while what grows in it is in flower: a herb or a fibre crop from its growing stage on.
      if (f.kind === 'planter') {
        const c = this.game.planted.get(f.id);
        if (!c || c.stage < 2 || !FLOWERING_LOOKS.has(cropDef(c.id).look)) continue;
      }
      yield { kind: f.kind, x: f.x, y: f.y, id: f.id, at: furnitureCentre(f) };
    }
  }.bind(this);
  /** Every pond's water drawn this frame, so a wake crossing a pond is kept on it; null while nothing is leaving a wake. */
  private pondPath: Path2D | null = null;
  /** The ponds with water on the tile being drawn: the level each stands at, and which of the tile's corners it covers, one bit each. */
  private pondsHereLevel: number[] = [];
  private pondsHereMask: number[] = [];
  private pondsHereN = 0;
  /** The highest of them. */
  private pondTop = 0;
  /** Whether a poured slab stands over a tile, for the water running past it. */
  private readonly slabOver = (x: number, y: number): boolean => !!this.game.slabAt(x, y);
  /** The corner a spring wells up at, for the drawing, by the spring's id. */
  private readonly wellAt = (id: number): readonly [number, number] | null => {
    const s = this.game.springs.list.get(id);
    return s ? [s.cx, s.cy] : null;
  };
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
  /** Everything burning this frame, after dark, for what glows under glass: read once a frame. */
  private lightsNow: LightSource[] = [];
  /** Glass with a light under it, laid over the night once the night is down: see `drawGlassGlow`. */
  private glassNight: Array<{ faces: Array<{ path: Path2D; m: DOMMatrix }>; lights: Array<{ x: number; y: number; r: number; a: number }>; box: [number, number, number, number] }> = [];
  /** The layer a glass roof's glow is made on, at half the screen's size (`drawGlassGlow`). */
  private glowLayer: CanvasRenderingContext2D | null = null;
  /** The sky this frame, which the haze over the distance is drawn in. */
  private sky: Sky = skyAt(0, 0);
  /** The season this frame, for the pots on a flight of steps and the roses on an arch. */
  private season: Season = 'spring';
  /** How a face of a flight of steps is lit: the light walls are drawn in (`faceLight`). */
  private readonly stepsLight = (ux: number, uy: number): number => this.faceLight(ux, uy);
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
  /**
   * The pieces drawn this frame with a light of their own -- an altar's stars
   * -- and where, so the night can be taken back off them when it is laid
   * down (`furnitureHoles`): they are drawn in their place among everything
   * else, and shine because the wash is thin over them, not because they are
   * painted over it.
   */
  private glows: Array<{ sx: number; sy: number; kind: string; view: PieceView }> = [];
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
  /** Whether the fields are waiting out a winter this frame: nothing in one grows, and it is drawn so. */
  private dormant = false;
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
  /**
   * Looking into a cellar this frame (`Game.cellarView`); the buildings over
   * the cellars, which are taken off while you are; every tile of every
   * cellar in the order it was laid; and each one's outline on the screen,
   * from its floor to the ground floor over it, for the dark and for a click.
   */
  private cellarFrame = false;
  private cut = new Set<number>();
  private cellarTiles: CellarTile[] = [];
  private cellarHulls: Array<{ x: number; y: number; hull: Array<[number, number]>; floor: Array<[number, number]> }> = [];
  /** While a cellar's own things are being laid, so a ghost over one is drawn then and not with the ground over it. */
  private inCellarPass = false;
  /** Names and what is said, held back while a cellar is laid line by line and put over it after (`overCellar`). */
  private cellarWords: Array<() => void> = [];
  /**
   * Each cellar tile's own drawing -- its floor and the sides of the dig
   * round it, and the cut across its near sides -- laid once into a canvas
   * of its own and put down again every frame after (`cellarLayer`), until
   * the view turns or zooms or a cellar changes (`cellarStamp`).
   */
  private cellarCache = new Map<string, CellarLaid>();
  private cellarStamp = '';
  /**
   * The inside of each hole a flight or a ladder goes down through, seen from
   * up top -- the dark, the far sides, the floor at the bottom, the way down
   * as far as the ground floor, each shaded by how deep it is -- laid once
   * and put down every frame after (`drawOpening`), until something it was
   * laid from changes: the view's turn or zoom, the dig, the flight, a wall
   * on its edge. Each keeps the stamp it was laid at.
   */
  private holeCache = new Map<string, CellarLaid & { stamp: string }>();
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
    this.trailMarks = new MarkPages(game.world.w);
    this.trailMemMarks = new MarkPages(game.world.w);
    this.trailPaint = new ColourPages(game.world.w);
    this.flowerMarks = new MarkPages(game.world.w);
    game.world.onChange((x, y) => this.invalidate(x, y));
    // Ground dug under or beside a stream moves the line it runs along.
    game.world.onChange((x, y) => this.springWater.touched(x, y));
    // And what is near a tree or near water, for the fireflies.
    game.world.onChange(() => this.life.touched());
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
      if (!w.inBounds(tx, ty) || w.heightAt(x, y) < w.surfaceAt(tx, ty)) return;
      const tone = dustTone(this.groundColor(tx, ty, true, this.sunNow));
      this.dust.burst(x, y, this.time, tone, Math.max(0.45, dustiness(w.viewTile(tx, ty, true))));
    });
    // A spell cast, yours or anybody's in sight: drawn from whoever cast it at whatever it was cast at.
    game.events.on('cast', (c) => {
      const by: Who = c.by === null ? { kind: 'player' } : { kind: 'peer', id: c.by };
      this.spells.play(c.spell, by, this.spellAim(c.at), { mine: c.by === null });
    });
    game.events.on('reset', () => {
      this.spells.clear();
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
          this.trailMarks.forget(xx, yy);
          this.trailMemMarks.forget(xx, yy);
          this.trailPaint.forget(xx, yy);
          this.trailShapes.delete(yy * w.w + xx);
          this.flowerMarks.forget(xx, yy);
          this.faces.delete(yy * w.w + xx);
          for (const m of [this.hemCache, this.hemMemCache]) {
            const h = m.get(yy * w.w + xx);
            if (h?.cv) this.hemPixels -= h.cv.width * h.cv.height;
            m.delete(yy * w.w + xx);
          }
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
  /**
   * The layer the cold wash over remembered ground is moved onto while
   * something in sight stands up in front of it (`fogLayer`). Kept between
   * frames at the canvas's own size, as the night is.
   */
  private fogMask: HTMLCanvasElement | null = null;
  /**
   * How far down the screen the wash gathered so far this frame comes, a
   * column of the ground's lattice at a time: two numbers to a column, the
   * lowest it comes at the column's left edge and at its right (`reach`).
   */
  private washFloor = new Float64Array(0);
  /** And how far down what is waiting to take the wash off comes, the same way, since it last did. */
  private liftFloor = new Float64Array(0);
  /** Which column of a tile's own each of the view's four corners falls in, counted from its leftmost; and how many columns a tile is across. */
  private readonly cornerCol = new Int8Array(4);
  private cornerSpan = 2;
  /** A tile's highest or lowest point on each of its column edges, worked out in `reach` and `over`. */
  private readonly colY = new Float64Array(3);
  /** The path a wall drawn now takes the wash off with, while it is drawn for a tile in sight (`liftWall`). */
  private wallLift: Path2D | null = null;
  /** Where the first of the wash's columns is across the screen this frame, and how wide a column is. */
  private washX0 = 0;
  private washHw = 1;
  /** Whether anything is waiting on the lift path to take the wash off. */
  private lifted = false;

  /**
   * What the lights do to the night, worked out apart from the night itself:
   * `mask`, whose alpha is how much of the wash each spot keeps -- every
   * light's soft hole taken out of it, as the wash used to have them taken
   * out of it directly -- and `warm`, black but for each light's cast, where
   * two overlap the warmer of the two rather than both added, so that a row
   * of lamps lights a street and does not bleach it white. Both are worked
   * out at `LIGHT_RES` of the screen, which their soft edges do not show,
   * and laid over it scaled back up.
   *
   * And kept: what steady lights do -- a lantern, a lamp on a post, an
   * altar, a glowing wildermon -- is kept from one frame to the next while
   * the view, the size of the screen and those lights stand still, and only
   * the ones that flicker, the fires, are worked out again each frame, over a
   * copy of it. How dark it is goes on at the end, so the hour moving does
   * not undo any of it.
   */
  /**
   * The steady lights' layers, made with a margin round the screen and slid
   * with the camera rather than made again for every frame it moves: `cx`
   * and `cy` are where it was when they were made, `pad` the margin in CSS
   * pixels. Made again when the lights change, or the view slides further
   * than the margin.
   */
  private lit: { mask: HTMLCanvasElement; warm: HTMLCanvasElement; key: string; cx: number; cy: number; pad: number } | null = null;
  private litNow: { mask: HTMLCanvasElement; warm: HTMLCanvasElement } | null = null;

  private lightLayers(lights: LightSource[], w: number, h: number): { mask: HTMLCanvasElement; warm: HTMLCanvasElement; box: Box } {
    const cam = this.camera;
    const zoom = cam.zoom;
    const lw = Math.max(1, Math.ceil(w * LIGHT_RES)), lh = Math.max(1, Math.ceil(h * LIGHT_RES));
    const sheet = (had: HTMLCanvasElement | undefined): HTMLCanvasElement => {
      const c = had ?? document.createElement('canvas');
      if (c.width !== lw || c.height !== lh) { c.width = lw; c.height = lh; }
      return c;
    };
    /** Each light where it falls on the screen this frame, and how far it reaches there. */
    const placed = (l: LightSource, pad = 0): { sx: number; sy: number; r: number } | null => {
      const sx = cam.worldToScreenX(l.x, l.y) + pad;
      // At what it stands on: the ground, or the finished deck of a tile on piers (`standTop`).
      const sy = cam.worldToScreenY(l.x, l.y, this.standTop(l.x, l.y)) + pad;
      // A flame is never steady; a candle behind cloth very nearly is.
      const r = Math.max(8, l.radius * HALF_W * zoom * this.flicker(l));
      return sx < -r || sy < -r || sx > w + 2 * pad + r || sy > h + 2 * pad + r ? null : { sx, sy, r };
    };
    const holes = (g: CanvasRenderingContext2D, ls: LightSource[], pad = 0): void => {
      g.globalCompositeOperation = 'destination-out';
      for (const l of ls) {
        const p = placed(l, pad);
        if (!p) continue;
        const grad = g.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, p.r);
        grad.addColorStop(0, `rgba(0,0,0,${l.strength.toFixed(2)})`);
        grad.addColorStop(0.55, `rgba(0,0,0,${(l.strength * 0.55).toFixed(2)})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(p.sx, p.sy, p.r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    };
    /** The part of the layers the casts cover, in their own whole pixels: x, y, width, height. */
    const cover = (ls: LightSource[], into: Box = [0, 0, 0, 0]): Box => {
      let [x0, y0, x1, y1] = into[2] > 0 ? [into[0], into[1], into[0] + into[2], into[1] + into[3]] : [Infinity, Infinity, -Infinity, -Infinity];
      for (const l of ls) {
        const p = placed(l);
        if (!p) continue;
        x0 = Math.min(x0, Math.max(0, Math.floor((p.sx - p.r) * LIGHT_RES)));
        y0 = Math.min(y0, Math.max(0, Math.floor((p.sy - p.r) * LIGHT_RES)));
        x1 = Math.max(x1, Math.min(lw, Math.ceil((p.sx + p.r) * LIGHT_RES)));
        y1 = Math.max(y1, Math.min(lh, Math.ceil((p.sy + p.r) * LIGHT_RES)));
      }
      return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : [0, 0, 0, 0];
    };
    const casts = (g: CanvasRenderingContext2D, ls: LightSource[], pad = 0): void => {
      // Opaque on black, so 'lighten' keeps the larger of what is there and what comes: the warmest light, not the sum.
      g.globalCompositeOperation = 'lighten';
      for (const l of ls) {
        const p = placed(l, pad);
        if (!p) continue;
        const a = l.castAlpha ?? 0.16 * l.strength;
        const [r0, g0, b0] = (l.cast ?? '255, 186, 92').split(',').map((v) => Math.round(Number(v) * a));
        const grad = g.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, p.r);
        grad.addColorStop(0, `rgb(${r0}, ${g0}, ${b0})`);
        grad.addColorStop(1, 'rgb(0, 0, 0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(p.sx, p.sy, p.r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    };
    const ctxOf = (c: HTMLCanvasElement): CanvasRenderingContext2D => {
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.setTransform(LIGHT_RES, 0, 0, LIGHT_RES, 0, 0);
      return g;
    };
    const steady = lights.filter((l) => l.steady);
    const live = lights.filter((l) => !l.steady);
    // Not where the camera is: the layers are slid with it (`lit`).
    const key = `${lw}x${lh}|${zoom},${cam.rotation}|`
      + steady.map((l) => `${l.x.toFixed(3)},${l.y.toFixed(3)},${this.standTop(l.x, l.y)},${l.radius},${l.strength},${l.cast ?? ''},${l.castAlpha ?? ''}`).join(';');
    const slid = (at: { cx: number; cy: number }): [number, number] => [(at.cx - cam.cx) * zoom, (at.cy - cam.cy) * zoom];
    const stale = (at: NonNullable<Renderer['lit']>): boolean => {
      const [ox, oy] = slid(at);
      return at.key !== key || Math.abs(ox) > at.pad || Math.abs(oy) > at.pad;
    };
    if (!this.lit || stale(this.lit)) {
      // A quarter of the screen spare on every side.
      const pad = Math.ceil(Math.max(w, h) * 0.25);
      const bw = Math.max(1, Math.ceil((w + 2 * pad) * LIGHT_RES)), bh = Math.max(1, Math.ceil((h + 2 * pad) * LIGHT_RES));
      const big = (had: HTMLCanvasElement | undefined): HTMLCanvasElement => {
        const c = had ?? document.createElement('canvas');
        if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
        return c;
      };
      const mask = big(this.lit?.mask), warm = big(this.lit?.warm);
      const m = ctxOf(mask), c = ctxOf(warm);
      m.globalCompositeOperation = 'source-over';
      m.fillStyle = '#000';
      m.fillRect(0, 0, w + 2 * pad, h + 2 * pad);
      holes(m, steady, pad);
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = '#000';
      c.fillRect(0, 0, w + 2 * pad, h + 2 * pad);
      casts(c, steady, pad);
      this.lit = { mask, warm, key, cx: cam.cx, cy: cam.cy, pad };
    }
    // The steady layers where the camera is now, and the fires over them.
    const now = this.litNow ?? (this.litNow = { mask: sheet(undefined), warm: sheet(undefined) });
    const mask = sheet(now.mask), warm = sheet(now.warm);
    const [ox, oy] = slid(this.lit);
    for (const [to, from] of [[mask, this.lit.mask], [warm, this.lit.warm]] as const) {
      const g = to.getContext('2d') as CanvasRenderingContext2D;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'copy';
      g.drawImage(from, (ox - this.lit.pad) * LIGHT_RES, (oy - this.lit.pad) * LIGHT_RES);
      g.globalCompositeOperation = 'source-over';
    }
    if (live.length) {
      holes(ctxOf(mask), live);
      casts(ctxOf(warm), live);
    }
    return { mask, warm, box: cover(live, cover(steady)) };
  }

  /**
   * The wash's layer for this frame: the canvas's own pixels, cleared, drawn
   * on as the world is and in the wash's colour laid solid, so ground gathered
   * on it twice is washed once. It goes over the world at the wash's own
   * strength, `FOG_ALPHA`, at the end.
   */
  private fogLayer(drawnAt: DOMMatrix): HTMLCanvasElement {
    const { width, height } = this.canvas.el;
    if (!this.fogMask || this.fogMask.width !== width || this.fogMask.height !== height) {
      this.fogMask = document.createElement('canvas');
      this.fogMask.width = width;
      this.fogMask.height = height;
    }
    const fc = this.fogMask.getContext('2d') as CanvasRenderingContext2D;
    fc.setTransform(1, 0, 0, 1, 0, 0);
    fc.globalCompositeOperation = 'source-over';
    fc.clearRect(0, 0, width, height);
    fc.setTransform(drawnAt);
    fc.fillStyle = FOG_INK;
    return this.fogMask;
  }

  /** Lay the wash gathered since it was last laid onto its layer, and take off it what in sight was drawn over it. */
  private layWash(wash: HTMLCanvasElement, fog: Path2D | null, lift: Path2D | null): void {
    const fc = wash.getContext('2d') as CanvasRenderingContext2D;
    if (fog) {
      fc.globalCompositeOperation = 'source-over';
      fc.fill(fog);
    }
    if (lift) {
      fc.globalCompositeOperation = 'destination-out';
      fc.fill(lift);
    }
  }

  /**
   * Set the wash's columns up for a frame of `cols` columns, none of them
   * reached yet, and where the view's corners fall among a tile's own. Returns
   * the leftmost corner's place across the lattice from the tile's own, which
   * a tile's first column is counted from.
   */
  private washColumns(V: View, cols: number): number {
    if (this.washFloor.length < cols * 2) {
      this.washFloor = new Float64Array(cols * 2);
      this.liftFloor = new Float64Array(cols * 2);
    }
    this.washFloor.fill(-Infinity);
    this.liftFloor.fill(-Infinity);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [sx] of V.shape) {
      lo = Math.min(lo, sx);
      hi = Math.max(hi, sx);
    }
    for (let k = 0; k < 4; k++) this.cornerCol[k] = V.shape[k][0] - lo;
    this.cornerSpan = hi - lo;
    return lo;
  }

  /**
   * Note on `f` how far down the screen something laid over a tile comes --
   * its wash, or what takes the wash off it: as far as its ground does, at
   * each edge of each column it is across, whose first is `at`. Its ground is
   * the lowest of it -- water over it and a floor raised on it are both
   * higher up -- and between two edges of a column a tile's ground runs
   * straight, so the two ends say it all.
   */
  private reach(f: Float64Array, at: number, pts: ArrayLike<number>): void {
    const ys = this.colY;
    ys.fill(-Infinity);
    for (let k = 0; k < 4; k++) {
      const j = this.cornerCol[k];
      if (pts[k * 2 + 1] > ys[j]) ys[j] = pts[k * 2 + 1];
    }
    for (let j = 0; j < this.cornerSpan; j++) {
      const i = (at + j) * 2;
      if (ys[j] > f[i]) f[i] = ys[j];
      if (ys[j + 1] > f[i + 1]) f[i + 1] = ys[j + 1];
    }
  }

  /**
   * Whether a tile, standing up to `top` over its ground (or its ground
   * alone, where null), comes up the screen past what `f` has noted in any
   * column it is across, and so over some of it: a tile in sight over the
   * wash gathered behind it, or remembered ground in front over what is
   * waiting to take the wash off. Ground beside either meets it along an edge
   * and does not come past it: half a pixel is allowed for that.
   */
  private over(f: Float64Array, at: number, pts: ArrayLike<number>, c: ArrayLike<number>, top: number | null, hs: number): boolean {
    const ys = this.colY;
    ys.fill(Infinity);
    for (let k = 0; k < 4; k++) {
      const j = this.cornerCol[k];
      const y = pts[k * 2 + 1] - (top === null ? 0 : Math.max(0, top - c[k]) * hs);
      if (y < ys[j]) ys[j] = y;
    }
    for (let j = 0; j < this.cornerSpan; j++) {
      const i = (at + j) * 2;
      if (ys[j] < f[i] - 0.5 || ys[j + 1] < f[i + 1] - 0.5) return true;
    }
    return false;
  }

  /**
   * Take the wash off a wall drawn for a tile in sight, where the wall comes
   * up the screen past the wash gathered behind it: the wall from its foot to
   * its top, both faces, onto `wallLift`. `px` and `py` are `drawWall`'s own
   * points on it. A wall seen end on covers nothing.
   */
  private liftWall(px: (t: number, k: number, s?: number) => number, py: (t: number, k: number, s?: number) => number): void {
    const path = this.wallLift;
    if (!path) return;
    const ca = Math.round((px(0, 0) - this.washX0) / this.washHw);
    const cb = Math.round((px(1, 0) - this.washX0) / this.washHw);
    if (ca === cb) return;
    const i = Math.min(ca, cb) * 2;
    const f = this.washFloor;
    if (i < 0 || i + 1 >= f.length) return;
    const topA = Math.min(py(0, 1, 1), py(0, 1, -1));
    const topB = Math.min(py(1, 1, 1), py(1, 1, -1));
    if (!((ca < cb ? topA : topB) < f[i] - 0.5 || (ca < cb ? topB : topA) < f[i + 1] - 0.5)) return;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const t of [0, 1]) {
      for (const k of [0, 1]) {
        for (const s of [1, -1]) {
          xs.push(px(t, k, s));
          ys.push(py(t, k, s));
        }
      }
    }
    windOn(path, xs, ys, convexHull(xs, ys));
    // Its foot, at each end, is as far down the screen as it comes.
    const footA = Math.max(py(0, 0, 1), py(0, 0, -1));
    const footB = Math.max(py(1, 0, 1), py(1, 0, -1));
    const lf = this.liftFloor;
    lf[i] = Math.max(lf[i], ca < cb ? footA : footB);
    lf[i + 1] = Math.max(lf[i + 1], ca < cb ? footB : footA);
    this.lifted = true;
  }

  /**
   * The top of a floor raised over a tile's ground on its ground floor -- the
   * deck of a building on piers, a poured slab -- or null where its ground is
   * all there is.
   */
  private raisedTop(x: number, y: number): number | null {
    const deck = this.game.buildings.buildingAt(x, y)?.deck;
    if (deck != null) return deck;
    return this.game.foundations.size ? (this.game.foundationAt(x, y)?.top ?? null) : null;
  }

  /**
   * The screen a tile's ground floor covers, onto a path: its ground, and
   * where a floor is raised over it to `top`, everything between the two --
   * the hull of the tile's four corners at both heights. `pts` is the ground's
   * diamond as drawn, `c` its corners' heights and `hs` the screen's pixels
   * to a unit of height.
   */
  private tileColumn(path: Path2D, pts: ArrayLike<number>, c: ArrayLike<number>, top: number | null, hs: number): void {
    const low = Math.min(c[0], c[1], c[2], c[3]);
    if (top === null || top <= low) {
      // Wound as a tile lying the right way up is, folded over or not (`windOn`), without making four arrays a tile to say so.
      let area = 0;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) & 3;
        area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
      }
      const step = area >= 0 ? 1 : 3;
      path.moveTo(pts[0], pts[1]);
      for (let k = 1; k < 4; k++) {
        const i = (k * step) & 3;
        path.lineTo(pts[i * 2], pts[i * 2 + 1]);
      }
      path.closePath();
      return;
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 4; i++) {
      xs.push(pts[i * 2], pts[i * 2]);
      ys.push(pts[i * 2 + 1], pts[i * 2 + 1] - Math.max(0, top - c[i]) * hs);
    }
    windOn(path, xs, ys, convexHull(xs, ys));
  }

  private nightLayer(res = 1): HTMLCanvasElement {
    const w = Math.max(1, Math.ceil(this.canvas.width * res));
    const h = Math.max(1, Math.ceil(this.canvas.height * res));
    if (!this.night || this.night.width !== w || this.night.height !== h) {
      this.night = document.createElement('canvas');
      this.night.width = w;
      this.night.height = h;
    }
    return this.night;
  }

  /** Flat-shaded colour for a tile: base colour, slope lighting, per-tile variation and depth tint under water. */
  private computeColor(x: number, y: number, type: TileType, data: number, light: [number, number, number], lit = true, own = false): string {
    const w = this.game.world;
    // A wood is a field with trees in it and a kelp bed is sand with weed
    // in it, not soils of their own: see `groundAt`. Worked out here, so it
    // is cached and thrown away with the colour it decides rather than being
    // asked again every frame. And a trail is the ground it was worn out of,
    // with the path drawn across it (`drawTrail`) -- unless it is the path's
    // own colour that is wanted, shaded the same -- and stepping stones are
    // the ground they were laid over, under the water with the stones on it.
    const ground = own ? type : COVERED.has(type) || type === TileType.Trail || type === TileType.SteppingStones ? this.groundAt(x, y, lit) : type;
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
    // Stepping stones are laid over a ground and keep which in their data: that ground is what is under the water.
    const t = this.bedOf(x, y, lit);
    // A trail is the ground it was worn out of, which its byte keeps.
    if (t === TileType.Trail) return trailGround(world.viewData(x, y, lit));
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
      const n = this.bedOf(nx, ny, lit);
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

  /** What a tile is, with a tile of stepping stones taken for the ground they were laid over. */
  private bedOf(x: number, y: number, lit: boolean): TileType {
    const world = this.game.world;
    const t = world.viewTile(x, y, lit) as TileType;
    return t === TileType.SteppingStones ? stonesBed(world.viewData(x, y, lit)) : t;
  }

  /**
   * The height a body at (x, y) is drawn standing at, on the ground under it
   * with nothing laid over it: the ground, or afloat at the top of the water
   * over it -- the sea's surface or a pond's -- on a flight of garden steps
   * the tread under it, a riser higher at a time, and on stepping stones the
   * stones' tops, however deep the water round them is.
   */
  /**
   * A body on the head of a way down, up top, stands in the hole on the tread
   * under its feet, and not on the air over it at the ground floor: how high
   * that is, and the part of the screen it shows in -- the hole and what is
   * over it, and not the ground in front of the hole, which hides the rest.
   * Null anywhere else.
   */
  private onFlight(px: number, py: number): { h: number; clip: Array<[number, number]> } | null {
    const tx = Math.floor(px), ty = Math.floor(py);
    const f = this.game.buildings.flightDown(tx, ty);
    if (!f) return null;
    const w = this.game.world;
    const cam = this.camera;
    const base = w.getHeight(tx, ty);
    const facing = f.facing ?? 's';
    // How far up the flight from its foot, as `stairPoint` lays it; a ladder is climbed the whole way, a flight a tread at a time.
    const u = px - tx, v = py - ty;
    const s = Math.max(0, Math.min(1, facing === 'n' ? v : facing === 's' ? 1 - v : facing === 'w' ? u : 1 - u));
    const h = floorKind(f) === 'ladder' ? base - WALL_HEIGHT * (1 - s)
      : base - WALL_HEIGHT + (Math.min(FLIGHT_STEPS - 1, Math.floor(s * FLIGHT_STEPS)) + 1) * (WALL_HEIGHT / FLIGHT_STEPS);
    // The hole's corners on the screen, and the run of its edge nearest the camera, from its leftmost corner to its rightmost.
    const hole = ([[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]] as Array<[number, number]>)
      .map(([cx, cy]): [number, number] => [cam.worldToScreenX(cx, cy), cam.worldToScreenY(cx, cy, w.getHeight(cx, cy))]);
    let left = 0, right = 0;
    for (let i = 1; i < 4; i++) {
      if (hole[i][0] < hole[left][0] - 1e-6 || (Math.abs(hole[i][0] - hole[left][0]) <= 1e-6 && hole[i][1] > hole[left][1])) left = i;
      if (hole[i][0] > hole[right][0] + 1e-6 || (Math.abs(hole[i][0] - hole[right][0]) <= 1e-6 && hole[i][1] > hole[right][1])) right = i;
    }
    const run = (step: number): Array<[number, number]> => {
      const out: Array<[number, number]> = [hole[left]];
      for (let i = left; i !== right;) {
        i = (i + step + 4) % 4;
        out.push(hole[i]);
      }
      return out;
    };
    const mean = (pts: Array<[number, number]>): number => pts.reduce((n, p) => n + p[1], 0) / pts.length;
    const a = run(1), b = run(-1);
    const near = mean(a) >= mean(b) ? a : b;
    const clip: Array<[number, number]> = [[-1e5, near[0][1]], ...near, [1e5, near[near.length - 1][1]], [1e5, -1e5], [-1e5, -1e5]];
    return { h, clip };
  }

  private footAt(x: number, y: number): number {
    const world = this.game.world;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (world.getTile(tx, ty) === TileType.Steps) return stepsFootAt(world, x, y);
    const ground = world.heightAt(x, y);
    if (world.stonesAt(tx, ty)) return Math.max(ground, world.hasWater(tx, ty) ? world.surfaceAt(tx, ty) : ground) + STONES_RISE;
    return Math.max(ground, world.surfaceAt(tx, ty) - 4);
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
  /**
   * Each tile's ruffled edges, drawn once into a picture of their own and
   * laid down from it after that.
   *
   * The ruffles were the dearest thing on an ordinary screen of country: some
   * sixty arcs a tile wherever two grounds meet, filled three times over,
   * every frame -- about two fifths of a whole frame on open meadow. They
   * change only when the ground does, so they are drawn once and copied.
   *
   * A copy only lines up with the polygon it sits on if both land on the same
   * fraction of a pixel. `render` puts the camera on a whole device pixel for
   * the frame, so a tile keeps its fraction of a pixel however far the view
   * is panned, and a picture made of it in one frame is the same picture in
   * the next, moved by whole pixels. While the zoom is still moving every
   * picture would be out of date by the next frame, so then the edges are
   * drawn as they always were and nothing is kept.
   *
   * By tile, for ground in sight and ground remembered apart; dropped with the
   * colour, which goes stale at the same moments, and all at once past
   * `HEM_PIXELS` of pictures.
   */
  private hemCache = new Map<number, HemPicture>();
  private hemMemCache = new Map<number, HemPicture>();
  private hemPixels = 0;
  /** The zoom, view and screen the pictures were made for, and whether the zoom has held still since the last frame. */
  private hemFor = '';
  private hemZoomWas = 0;
  private hemSteady = false;

  private forgetHems(lit?: boolean): void {
    if (lit !== false) this.hemCache.clear();
    if (lit !== true) this.hemMemCache.clear();
    this.hemPixels = 0;
    for (const m of [this.hemCache, this.hemMemCache]) for (const h of m.values()) this.hemPixels += h.cv ? h.cv.width * h.cv.height : 0;
  }

  /** `swardEdges`, from the tile's picture when it has one that fits, making one when it may. */
  private hems(ctx: CanvasRenderingContext2D, V: View, x: number, y: number, pts: Float64Array, zoom: number, lit: boolean): boolean {
    if (!this.hemSteady) return this.swardEdges(ctx, V, x, y, pts, zoom, lit);
    const dpr = this.canvas.dpr;
    const cache = lit ? this.hemCache : this.hemMemCache;
    const key = y * this.game.world.w + x;
    const had = cache.get(key);
    if (had) {
      const dx = (pts[0] - had.px) * dpr;
      const dy = (pts[1] - had.py) * dpr;
      const rx = Math.round(dx), ry = Math.round(dy);
      if (Math.abs(dx - rx) < 0.02 && Math.abs(dy - ry) < 0.02) {
        if (had.cv) ctx.drawImage(had.cv, had.bx + rx / dpr, had.by + ry / dpr, had.cv.width / dpr, had.cv.height / dpr);
        return had.cv !== null;
      }
      if (had.cv) this.hemPixels -= had.cv.width * had.cv.height;
      cache.delete(key);
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < 8; k += 2) {
      x0 = Math.min(x0, pts[k]); x1 = Math.max(x1, pts[k]);
      y0 = Math.min(y0, pts[k + 1]); y1 = Math.max(y1, pts[k + 1]);
    }
    // A pixel either side for the antialiasing along the clip.
    const bx = Math.floor(x0 * dpr) - 1, by = Math.floor(y0 * dpr) - 1;
    const w = Math.ceil(x1 * dpr) + 1 - bx, h = Math.ceil(y1 * dpr) + 1 - by;
    if (w <= 0 || h <= 0 || w * h > HEM_TILE_MOST) return this.swardEdges(ctx, V, x, y, pts, zoom, lit);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    if (!g) return this.swardEdges(ctx, V, x, y, pts, zoom, lit);
    g.setTransform(dpr, 0, 0, dpr, -bx, -by);
    const drew = this.swardEdges(g, V, x, y, pts, zoom, lit);
    if (this.hemPixels + w * h > HEM_PIXELS) this.forgetHems();
    cache.set(key, { cv: drew ? cv : null, px: pts[0], py: pts[1], bx: bx / dpr, by: by / dpr });
    if (drew) {
      this.hemPixels += w * h;
      ctx.drawImage(cv, bx / dpr, by / dpr, w / dpr, h / dpr);
    }
    return drew;
  }

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
   * The wildflowers on a tile, plus one: how many clumps in the low three
   * bits, the colour the patch is mostly over them. Off the island's own rule
   * (`world/flowers.ts`) for the season it is, and none under a building.
   */
  private flowerAt(x: number, y: number): number {
    const had = this.flowerMarks.get(x, y);
    if (had) return had - 1;
    const w = this.game.world;
    const n = this.flowerSeasonNow === null || this.game.buildings.buildingAt(x, y) ? 0
      : flowersOn(w.seed, x, y, w.getTile(x, y), w.getData(x, y), this.flowerSeasonNow);
    const v = n ? n | (tileColour(x, y) << 3) : 0;
    this.flowerMarks.set(x, y, v + 1);
    return v;
  }

  /**
   * A tile's wildflowers: a clump for each its drift gives it, each where the
   * tile's coordinates put it, leaning with the wind and nodding on its own
   * clock (`render/flowers.ts`). From three fifths of a tile's zoom up they
   * are the painted clumps; further out, a speck of colour a clump, laid with
   * the rest of the line's in one fill a colour.
   *
   * What it costs: a kept lookup a tile of grass, and one picture blitted a
   * clump -- a fifth of a meadow flowers in summer and a tenth in spring, two
   * or three clumps a tile -- or a rectangle a clump from far off.
   */
  private drawFlowers(ctx: CanvasRenderingContext2D, x: number, y: number, pts: Float64Array, zoom: number): void {
    const f = this.flowerAt(x, y);
    const n = f & 7;
    if (!n) return;
    const main = f >> 3;
    const [a, b, c, d] = this.cornerAt;
    const ax = pts[a], ay = pts[a + 1], bx = pts[b], by = pts[b + 1];
    const cx = pts[c], cy = pts[c + 1], dx = pts[d], dy = pts[d + 1];
    const far = zoom < FLOWERS_DRAWN;
    const lean = this.lean.x * this.lean.force;
    for (let i = 0; i < n; i++) {
      const [u, v, colour, variant, phase, size] = clumpOf(x, y, i, n, main);
      const sx = (ax + (bx - ax) * u) * (1 - v) + (dx + (cx - dx) * u) * v;
      const sy = (ay + (by - ay) * u) * (1 - v) + (dy + (cy - dy) * u) * v;
      if (far) {
        // Two specks a clump, side by side, a little up off the ground.
        const k = this.flowerSpeckN[colour];
        const buf = this.flowerSpecks[colour];
        if (k + 4 <= buf.length) {
          buf[k] = sx - 2.4 * zoom;
          buf[k + 1] = sy - 3 * zoom;
          buf[k + 2] = sx + 2.2 * zoom;
          buf[k + 3] = sy - 4.4 * zoom;
          this.flowerSpeckN[colour] = k + 4;
        }
        continue;
      }
      const spr = flowerSprite(colour, variant, swayFrame(lean, this.lean.force, this.time, phase));
      const k = zoom * size;
      const ready = this.atSize(spr.canvas, spr.w * k, spr.h * k);
      ctx.drawImage(ready, sx - spr.ax * k, sy - spr.ay * k, spr.w * k, spr.h * k);
    }
  }

  /** A steep tile's face, off its corners and the tiles round it: worked out once and kept. */
  private faceAt(x: number, y: number, gx: number, gy: number): Face {
    const w = this.game.world;
    const key = y * w.w + x;
    const had = this.faces.get(key);
    if (had) return had;
    const tops = topEdges(w.getHeight(x, y), w.getHeight(x + 1, y), w.getHeight(x + 1, y + 1), w.getHeight(x, y + 1));
    const face: Face = { tops: [-1, -1, -1, -1], wetTop: false, shade: 0 };
    for (let e = 0; e < 4; e++) {
      if (!tops[e]) continue;
      const nx = x + EDGES[e].dx, ny = y + EDGES[e].dy;
      if (!w.inBounds(nx, ny)) { face.tops[e] = -2; continue; }
      // The ground over the top edge grows, and is the top: not more of the same face going on up.
      const ground = this.groundAt(nx, ny, true);
      const steep = bareRock(slopeOf(w, nx, ny)) > 0;
      face.tops[e] = growth(ground) > 0 && !steep ? ground : -2;
      if (w.hasWater(nx, ny)) face.wetTop = true;
    }
    // Turned from the sun, which is in the south-east: its way down against (1, 1).
    const l = Math.hypot(gx, gy) || 1;
    face.shade = Math.max(0, Math.min(1, (1 + (gx + gy) / l / Math.SQRT2) / 2));
    if (this.faces.size > 16384) this.faces.clear();
    this.faces.set(key, face);
    return face;
  }

  /** Where each edge of a tile's square crosses a height, as (u, v) pairs, in order round it. */
  private crossings(h: readonly number[], level: number, out: number[]): number {
    let n = 0;
    const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3;
      const a = h[i], b = h[j];
      if ((a < level) === (b < level)) continue;
      const t = (level - a) / (b - a);
      out[n++] = sq[i][0] + (sq[j][0] - sq[i][0]) * t;
      out[n++] = sq[i][1] + (sq[j][1] - sq[i][1]) * t;
    }
    return n;
  }

  private faceH = [0, 0, 0, 0];
  private faceCross = [0, 0, 0, 0, 0, 0, 0, 0];
  private faceDamp = [0, 0, 0, 0, 0, 0, 0, 0];

  /**
   * The dressing on a face of steep ground (`outcrops.ts`): its lip of grass,
   * its moss, its cracks and ferns, and the damp where water is at its foot
   * or over its top -- on a tile steep enough to show its rock, turned
   * towards the camera, and only the part of it above any water.
   *
   * What it costs: every tile pays four corner heights it already has and a
   * square root; a face in view pays a fill each for its moss and its lip,
   * and from three fifths of a tile's zoom a stroke of cracks, a fill of
   * damp and the moss's line and the lip's shade, a fern or two from zoom one
   * and the light on the moss and the lip from half as close again
   * (`drawFace`). Only a face with water against it is clipped, to the part
   * above the water. What it is made of is worked out once a face and kept.
   */
  private dressFace(ctx: CanvasRenderingContext2D, x: number, y: number, pts: Float64Array, zoom: number, sea: boolean, pond: boolean): void {
    const w = this.game.world;
    const h = this.faceH;
    h[0] = w.getHeight(x, y);
    h[1] = w.getHeight(x + 1, y);
    h[2] = w.getHeight(x + 1, y + 1);
    h[3] = w.getHeight(x, y + 1);
    const gx = (h[1] + h[2] - h[0] - h[3]) / 2 / UNITS_PER_TILE;
    const gy = (h[2] + h[3] - h[0] - h[1]) / 2 / UNITS_PER_TILE;
    const bare = bareRock(Math.hypot(gx, gy));
    if (bare <= 0) return;
    const face = this.faceAt(x, y, gx, gy);
    const [a, b, c, d] = this.cornerAt;
    const ax = pts[a], ay = pts[a + 1], bx = pts[b], by = pts[b + 1];
    const cx = pts[c], cy = pts[c + 1], dx = pts[d], dy = pts[d + 1];
    const X = (u: number, v: number): number => (ax + (bx - ax) * u) * (1 - v) + (dx + (cx - dx) * u) * v;
    const Y = (u: number, v: number): number => (ay + (by - ay) * u) * (1 - v) + (dy + (cy - dy) * u) * v;
    // Turned towards the camera: its top edges higher on the screen than its middle.
    let up = 0;
    let tops = 0;
    for (let e = 0; e < 4; e++) {
      if (face.tops[e] === -1) continue;
      const E = EDGES[e];
      up += Y((E.a[0] + E.b[0]) / 2, (E.a[1] + E.b[1]) / 2);
      tops++;
    }
    if (!tops || up / tops >= Y(0.5, 0.5) - 1) return;
    // The water against it, if any: the sea's nothing, or a pond's level.
    let level = -Infinity;
    if (pond) level = w.surfaceAt(x, y);
    else if (sea) level = 0;
    const under = (h[0] < level ? 1 : 0) + (h[1] < level ? 1 : 0) + (h[2] < level ? 1 : 0) + (h[3] < level ? 1 : 0);
    if (under === 4) return;
    let waterline: [number, number, number, number] | null = null;
    let dampline: [number, number, number, number] | null = null;
    // Cut off at the water, where there is any against it; a dry face is dressed whole, and not cut at all.
    if (under) {
      ctx.save();
      ctx.beginPath();
      // Only above the water: the corners that stand clear of it and where its edges cross the line.
      const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];
      let first = true;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) & 3;
        if (h[i] >= level) {
          if (first) ctx.moveTo(X(sq[i][0], sq[i][1]), Y(sq[i][0], sq[i][1]));
          else ctx.lineTo(X(sq[i][0], sq[i][1]), Y(sq[i][0], sq[i][1]));
          first = false;
        }
        if ((h[i] < level) !== (h[j] < level)) {
          const t = (level - h[i]) / (h[j] - h[i]);
          const u = sq[i][0] + (sq[j][0] - sq[i][0]) * t, v = sq[i][1] + (sq[j][1] - sq[i][1]) * t;
          if (first) ctx.moveTo(X(u, v), Y(u, v));
          else ctx.lineTo(X(u, v), Y(u, v));
          first = false;
        }
      }
      const cr = this.faceCross, dm = this.faceDamp;
      if (this.crossings(h, level, cr) === 4 && this.crossings(h, level + DAMP_UNITS, dm) === 4) {
        waterline = [cr[0], cr[1], cr[2], cr[3]];
        // The damp line's ends matched to the waterline's, nearest to nearest.
        const flip = Math.hypot(dm[0] - cr[0], dm[1] - cr[1]) > Math.hypot(dm[2] - cr[0], dm[3] - cr[1]);
        dampline = flip ? [dm[2], dm[3], dm[0], dm[1]] : [dm[0], dm[1], dm[2], dm[3]];
      }
      ctx.closePath();
      ctx.clip();
    }
    drawFace(ctx, {
      x, y, face, bare, zoom, X, Y,
      hem: (t) => hemOf(t as TileType),
      moss: ROCK_MOSS,
      sized: (cv, cw, ch) => this.atSize(cv, cw, ch),
      waterline, dampline,
    }, zoom < 0.6 ? 0 : zoom < 1.5 ? 1 : 2);
    if (under) ctx.restore();
  }

  /** Which of a tile's screen corners, times two, is each of its world corners: (0,0), (1,0), (1,1), (0,1). Set each frame. */
  private cornerAt = [0, 2, 4, 6];

  /** A tile's path mask (`trails.ts`), from the tiles round it, kept until one of them changes. */
  private trailMaskAt(x: number, y: number, lit: boolean): number {
    const pages = lit ? this.trailMarks : this.trailMemMarks;
    const had = pages.get(x, y);
    if (had) return had - 1;
    const w = this.game.world;
    const m = trailMask((dx, dy) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < w.w && ny < w.h && w.viewTile(nx, ny, lit) === TileType.Trail;
    });
    pages.set(x, y, m + 1);
    return m;
  }

  /** The colour of a path's bare earth on a tile, shaded as the ground under it is. */
  private trailColor(x: number, y: number, lit: boolean): string {
    if (!lit) return this.computeColor(x, y, TileType.Trail, 0, this.sunNow, false, true);
    let c = this.trailPaint.get(x, y);
    if (!c) {
      c = this.computeColor(x, y, TileType.Trail, 0, this.sunNow, true, true);
      this.trailPaint.set(x, y, c);
    }
    return c;
  }

  /** Lobes of grass along a path's edges, placed on screen: written over rather than made afresh. */
  private trailLobes: Lobe[] = [];
  /** The tile a path is cut to, let out, and two buffers to cut its pieces through. */
  private trailQuad = new Float64Array(8);
  private trailCut = [new Float64Array(1024), new Float64Array(1024)];

  /**
   * The part of a worn path that lies on one tile (`trails.ts`): its bare
   * earth, in the path's colour shaded as this tile is, and the lobes of the
   * ground's own green lying over its edges, cut to the tile. The shapes
   * are the tile's own square mapped onto the tile as it lies, so a path
   * follows the ground over a bank and holds still as the view comes round.
   *
   * What it costs: one fill a tile, cut to the tile by hand, and one more
   * for the lobes from three fifths of a tile's zoom up (two from
   * `TRAIL_NEAR`); the shapes are worked out once a tile and kept, and nothing
   * here is asked of a tile with no path on or beside it but its kept mask.
   */
  private drawTrail(ctx: CanvasRenderingContext2D, x: number, y: number, mask: number, pts: Float64Array, lit: boolean, zoom: number): void {
    const world = this.game.world;
    const key = y * world.w + x;
    let kept = this.trailShapes.get(key);
    if (!kept || kept.mask !== mask) {
      if (this.trailShapes.size > 4096) this.trailShapes.clear();
      kept = { mask, shape: trailShape(x, y, mask) };
      this.trailShapes.set(key, kept);
    }
    const { polys, lobes } = kept.shape;
    if (!polys.length) return;
    const [a, b, c, d] = this.cornerAt;
    const ax = pts[a], ay = pts[a + 1], bx = pts[b], by = pts[b + 1];
    const cx = pts[c], cy = pts[c + 1], dx = pts[d], dy = pts[d + 1];
    const X = (u: number, v: number): number => (ax + (bx - ax) * u) * (1 - v) + (dx + (cx - dx) * u) * v;
    const Y = (u: number, v: number): number => (ay + (by - ay) * u) * (1 - v) + (dy + (cy - dy) * u) * v;
    /*
     * Cut to the tile let out by a pixel and a half all round. The tile after
     * this one strokes its own outline in its own colour, and half of that
     * line lies on this tile -- across the path, wherever the path crosses
     * into it, as a thread of grass. This tile's path drawn over the edge lies
     * under the next tile's, which is the same path in the same place. Cut by
     * hand, on the screen, rather than with the canvas's clip: a clip is a
     * mask made and thrown away a tile, and it cost more than all the rest of
     * the path together.
     */
    const mx = (pts[0] + pts[2] + pts[4] + pts[6]) / 4, my = (pts[1] + pts[3] + pts[5] + pts[7]) / 4;
    const quad = this.trailQuad;
    for (let k = 0; k < 4; k++) {
      const ex = pts[k * 2] - mx, ey = pts[k * 2 + 1] - my;
      const el = Math.hypot(ex, ey) || 1;
      quad[k * 2] = pts[k * 2] + (ex / el) * 1.5;
      quad[k * 2 + 1] = pts[k * 2 + 1] + (ey / el) * 1.5;
    }
    ctx.beginPath();
    for (const p of polys) {
      let buf = this.trailCut[0];
      let n = 0;
      for (let i = 0; i < p.length && n + 2 <= buf.length; i += 2) {
        buf[n++] = X(p[i], p[i + 1]);
        buf[n++] = Y(p[i], p[i + 1]);
      }
      for (let k = 0; k < 4 && n; k++) {
        const out = buf === this.trailCut[0] ? this.trailCut[1] : this.trailCut[0];
        n = cutByLine(buf, n, quad[k * 2], quad[k * 2 + 1], quad[((k + 1) & 3) * 2], quad[((k + 1) & 3) * 2 + 1], mx, my, out);
        buf = out;
      }
      if (n < 6) continue;
      ctx.moveTo(buf[0], buf[1]);
      for (let i = 2; i < n; i += 2) ctx.lineTo(buf[i], buf[i + 1]);
      ctx.closePath();
    }
    ctx.fillStyle = this.trailColor(x, y, lit);
    ctx.fill();
    // The grass over its edges, only where there is grass to lie over them,
    // only on ground in sight, and only close enough to see a lobe.
    const ground = this.groundAt(x, y, lit);
    if (lit && zoom >= 0.6 && lobes.length && growth(ground) > 0) {
      const r = TRAIL_LOBE * zoom;
      const at = this.trailLobes;
      let n = 0;
      for (let i = 0; i < lobes.length; i += 3) {
        const lx = X(lobes[i], lobes[i + 1]), ly = Y(lobes[i], lobes[i + 1]), lr = r * lobes[i + 2];
        const had = at[n];
        if (had) { had[0] = lx; had[1] = ly; had[2] = lr; } else at[n] = [lx, ly, lr];
        n++;
      }
      /*
       * No line round them and no light on them: they are the grass itself
       * running to the path's edge, not tufts lying on it, and lit one by one
       * they were a row of beads. Close to, a breath of shade under them
       * first, down and away from the sun, so the grass stands a little proud
       * of the earth it has grown over; from further off the lobes alone, a
       * fill a tile.
       */
      if (zoom >= TRAIL_NEAR) circles(ctx, at, n, r * 0.3, r * 0.35, 0, TRAIL_SHADE);
      circles(ctx, at, n, 0, 0, 0, hemOf(ground).shade);
    }
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
  private paving(t: TileType, x: number, y: number, data: number, pts: Float64Array, rot: number, lit = true): void {
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
      const i = (((y % q) + q) % q) * q + (((x % q) + q) % q);
      this.laidOver(road[i], pts, rot, 'overlay');
      if (lit) this.pavingMoss(road, q, i, x, y, pts, rot);
      return;
    }
    // Slabs, laid as their stone splits and in the size it comes off the block in.
    const v = slabVariant(data);
    const tiles = slabbing(v, SLAB_VARIANTS[v].courses);
    const q = FLOOR_TILES;
    const i = (((y % q) + q) % q) * q + (((x % q) + q) % q);
    this.laidOver(tiles[i], pts, rot, 'overlay');
    if (lit) this.pavingMoss(tiles, q, i, x, y, pts, rot);
  }

  /**
   * The moss in a paved tile's joints (`greening.ts`): as far on as the days
   * since it was laid or scrubbed have brought it, a little further by water,
   * and a stage either way tile to tile so a road greens in patches rather
   * than all at one pace. Laid over the paving picture of the same index, in
   * its own colour rather than in the ground's light and shade.
   */
  private pavingMoss(pics: HTMLCanvasElement[], q: number, i: number, x: number, y: number, pts: Float64Array, rot: number): void {
    const days = pavingGreen(this.game, x, y, this.greenAt);
    if (!days) return;
    const g = greenShows(days, 0, this.wetness(x, y));
    const stage = Math.max(0, Math.min(PAVE_STAGES, Math.round(g * PAVE_STAGES + (hashOf(x, y, 0, 5) - 0.5) * 1.6)));
    const moss = pavingMoss(pics, q, stage);
    if (moss) this.laidOver(moss[i], pts, rot, 'source-over');
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

  /** The wall clock, in real seconds, for what greens (`greening.ts`): read once a frame. */
  private greenAt = 0;
  /** Whether the ivy is in flower: in spring and summer (`seasonAt`). */
  private bloom = false;

  /**
   * One frame, with the camera put on a whole device pixel for the length of
   * it: everything drawn then lands on the same fraction of a pixel frame
   * after frame however the view is panned, which is what lets a picture made
   * in one frame be laid down unchanged in the next (`hems`). Half a device
   * pixel at most, and put back afterwards for everything that reads the
   * camera between frames.
   */
  render(dt: number): void {
    const cam = this.camera;
    const cx = cam.cx, cy = cam.cy;
    const unit = cam.zoom * this.canvas.dpr;
    cam.cx = Math.round(cx * unit) / unit;
    cam.cy = Math.round(cy * unit) / unit;
    // The pictures are for one zoom, one view and one screen; and none are made while the zoom is moving.
    const fit = `${cam.zoom}|${cam.rotation}|${cam.width}|${cam.height}|${this.canvas.dpr}`;
    this.hemSteady = cam.zoom === this.hemZoomWas;
    this.hemZoomWas = cam.zoom;
    if (this.hemSteady && fit !== this.hemFor) {
      this.hemFor = fit;
      this.forgetHems();
    }
    this.timings.set(this, this.game.settings.timings);
    this.timings.begin();
    try {
      this.renderFrame(dt);
    } finally {
      cam.cx = cx;
      cam.cy = cy;
      this.timings.end(performance.now() / 1000);
    }
  }

  /** Where the drawing went, layer by layer, while `Settings.timings` is on. */
  readonly timings = new Timings();

  /** The fast graphics this frame (`Settings.graphics`): no swell, no haze, no small life. */
  private fast = false;

  /** Frames drawn, for anything worked out once a frame and asked for more than once in it. */
  private frameNo = 0;

  private renderFrame(dt: number): void {
    this.frameNo++;
    this.fast = this.game.settings.graphics === 'fast';
    this.time += dt;
    this.frameDt = dt;
    this.poolRuns.clear();
    this.greenAt = greenNow();
    const season = seasonAt(this.greenAt).season;
    this.bloom = season === 'spring' || season === 'summer';
    // Whether the fields are waiting out a winter, which they are drawn doing: asked once a frame, not once a tile.
    this.dormant = this.game.crops.size > 0 && fieldRate(this.game.wallNow()) <= 0;
    this.roomTiles = this.myRoom();
    this.shades.clear();
    // The spells first: what they light is among what is burning.
    this.spells.update({ eye: this.camera, now: performance.now() / 1000, dt, fast: this.fast });
    this.game.spellLights = this.spells.lights;
    // What is burning, for glass to glow with at night, and last frame's glow gone.
    this.lightsNow = this.game.darkness() > 0.02 ? this.game.lights() : [];
    this.glassNight.length = 0;
    // Every drawbridge by the border it is hinged on, and the two tiles either side of that border, one of
    // which draws it (`drawGateAt`): a number per tile, so the tiles with none cost one lookup.
    this.drawbridges.clear();
    this.landings.clear();
    this.hingeTiles.clear();
    if (this.game.bridges.size) {
      for (const b of this.game.bridges.values()) {
        if (!isDrawbridge(b)) continue;
        // And the border its far end comes down on, where the crib it lands on is drawn from.
        for (const [border, into] of [[hingeOf(b), this.drawbridges], [landingOf(b), this.landings]] as const) {
          into.set(hingeKey(0, border), b);
          this.hingeTiles.add(border.x * 65536 + border.y);
          this.hingeTiles.add(border.dir === 'h' ? border.x * 65536 + border.y - 1 : (border.x - 1) * 65536 + border.y);
        }
      }
    }
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
    // The island's year, for what flowers and what does not (`seasonAt`): read off the wall clock once a frame.
    this.season = seasonAt(this.game.wallNow()).season;
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
    // Looking into a cellar, the building over it is taken off, roof and all: see `drawCellarView`.
    this.cellarFrame = this.game.cellarView();
    this.cut.clear();
    if (this.cellarFrame) {
      for (const cel of this.game.buildings.cellars.values()) this.cut.add(cel.building);
      this.cutInFront();
    }
    this.queueRoofs(V, dLo, dHi);
    // What the spells drew this frame, sorted into the lines it goes down with.
    this.spells.layout(ctx, V, dLo, dHi);
    this.linePilasters.length = 0;
    this.frameCuts.clear();
    this.jettyCuts.clear();
    const grid = this.game.settings.grid && zoom >= 0.7;
    const vision = this.game.vision;
    const fogged = this.game.settings.fog;
    /*
     * The wash over remembered ground, gathered a line at a time and laid over
     * the world once at the end, so a remembered wood goes cold with its
     * ground. But what is in sight and stands higher than remembered ground
     * behind it -- a hilltop over the plain behind it, a deck on piers, a
     * poured slab, a wall -- is drawn over that ground, and its wash, laid
     * last, would darken it. So whatever in sight comes up the screen past the
     * wash behind it (`over`) is gathered as well, and at the end the wash goes
     * onto a layer of its own (`fogLayer`) and that is taken off it before it
     * is laid over the world. Remembered ground in front that comes back down
     * over any of that is the one thing that cannot wait: the wash so far is
     * laid, and taken off, before its own goes on. Where nothing in sight
     * comes up past the wash behind it, the wash is the one fill it always
     * was.
     */
    const raising = fogged && (this.game.buildings.pierTiles.size > 0 || this.game.foundations.size > 0);
    const walled = fogged && this.game.buildings.walls.size > 0;
    const washAt = fogged ? 1 - eMin + this.washColumns(V, eMax - eMin + 4) : 0;
    const drawnAt = ctx.getTransform();
    let wash: HTMLCanvasElement | null = null;
    let fogPath = new Path2D();
    let lineFog = new Path2D();
    let liftPath = new Path2D();
    // Any wash gathered yet this frame; and any waiting in `fogPath` to be laid.
    let washed = false;
    let gathered = false;
    let lineAny = false;
    // Whether remembered ground on this line came down over something waiting to take the wash off.
    let lineOver = false;
    this.lifted = false;
    this.seaPath = new Path2D();
    this.seaBox.fill(NaN);
    this.drewWater = false;
    this.pierFeet.clear();
    this.wetPiers(cam.view);
    this.plantFrame = this.game.waterPlants.size
      ? { cam, t: this.time, now: Date.now() / 1000, dark: this.game.darkness(), surface: this.drawnSurface, ground: this.groundHere }
      : null;
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
    // Wildflowers come and go with the season, and none grow inside a building.
    {
      const season = flowerSeason(this.game.wallNow());
      const built = this.game.buildings.list.size;
      if (season !== this.flowerSeasonNow || built !== this.flowerBuildings) {
        this.flowerSeasonNow = season;
        this.flowerBuildings = built;
        this.flowerMarks.clear();
      }
    }
    // A tile last seen a moment ago has a new memory; throw away the colour
    // that was worked out from the old one.
    if (vision.revision !== this.lastVision) {
      this.lastVision = vision.revision;
      const box = vision.dirty;
      if (box) {
        this.memColors.forgetBox(Math.max(0, box.x0), Math.max(0, box.y0),
          Math.min(world.w - 1, box.x1), Math.min(world.h - 1, box.y1));
      } else this.memColors.clear();
      this.forgetHems(false);
      this.trailMemMarks.clear();
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
      this.forgetHems();
      this.trailPaint.clear();
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
      this.forgetTreePictures();
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
    // A hull with a deck of her own whose helm I have: I am drawn among her crew, by `takeAboard`, rather than on my own.
    const mine = this.game.driving();
    this.helming = mine && crewOf(mine.kind) ? mine : null;
    const hw = stepW * zoom;
    const hh = stepH * zoom;
    const hs = HEIGHT_SCALE * zoom;
    // Where the first of the wash's columns is across the screen, for a wall to find its own by (`liftWall`).
    this.washX0 = (eMin - 1) * hw - cam.cx * zoom + W / 2;
    this.washHw = hw;
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
    // And which of the tile's screen corners is each of its world corners, for
    // anything laid on in the tile's own square: (0,0), (1,0), (1,1), (0,1).
    const cornerAt = this.cornerAt;
    for (let k = 0; k < 4; k++) {
      const [cu, cv] = k === 0 ? [0, 0] : k === 1 ? [1, 0] : k === 2 ? [1, 1] : [0, 1];
      cornerAt[k] = co.findIndex((cc) => cc[0] === cu && cc[1] === cv) * 2;
    }
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
    this.glows.length = 0;
    this.anvilHits.length = 0;
    this.postHits.length = 0;
    this.trapHits.length = 0;
    this.deckHits.length = 0;
    // Where the aqueducts are this frame and how their water stands, once, if there are any bridges at all.
    if (this.game.bridges.size) {
      const springs = this.game.springs;
      this.aqueducts.frame({
        cam, world, t: this.time, now: Date.now(), dark: this.game.darkness(), sunUp: Math.max(0, sun[2]),
        fv: fallView(cam, this.time, W, H, HEIGHT_SCALE * zoom),
        flowing: (id) => springs.flowingSince(id),
        surface: (x, y) => world.water?.levelAt(x, y) ?? null,
        slab: (x, y) => this.game.slabAt(x, y)?.top ?? null,
        bare: (x, y) => {
          const sl = this.game.foundations.size ? this.game.slabAt(x, y) : undefined;
          return sl && !sl.pool ? sl.top : null;
        },
        pours: (id) => {
          for (const sp of springs.list.values()) {
            const st = sp.chain.streams.find((t) => t.via === id);
            if (st) return st.path.length >= 2 ? [st.path[0], st.path[1]] : null;
          }
          return null;
        },
        foam: world.water ? this.springWater.foam : null,
        mist: (placed) => this.springWater.mistOf(placed),
        moss: (b, x, y, shade) => Math.round(greenShows(bridgeGreen(this.game, b, this.greenAt) ?? 0, shade, this.wetness(x, y)) * PAVE_STAGES),
        fountain: (x, y) => {
          const fu = this.game.furnitureOnTile(x, y).find((p) => p.kind === 'fountain');
          if (!fu) return null;
          const [fx, fy] = furnitureCentre(fu);
          return { x: fx, y: fy, base: this.pieceBase(fu, fx, fy) };
        },
      }, this.game.bridges.values(), world.w);
    }
    this.drawnTiles = 0;
    // The water springs have made, if any: where each pond stands this frame, how far each stream has run, and which line of the ground each piece goes after.
    const water = world.water;
    // Their outline only matters to a wake, so it is gathered only while something is leaving one.
    this.pondPath = water && this.wakes.live(this.time).length ? new Path2D() : null;
    if (water) {
      this.springWater.frame({
        world, cam, view: V, now: Date.now(), t: this.time, width: W, height: H, dLo, dHi,
        lean: this.lean, sun, dark: this.game.darkness(), wellAt: this.wellAt,
        slab: this.game.foundations.size ? this.slabOver : undefined,
        decked: this.game.buildings.pierTiles.size ? this.pierOver : undefined,
        ...(this.game.bridges.size ? { under: (wx: number, wy: number) => this.aqueducts.under(wx, wy, V), underKey: this.aqueducts.underKey } : {}),
      }, water);
    }
    // The day of the year the trees are dressed for, and what is out in it.
    // When their look turns (`lookStep`), the last look's pictures of them go, and every copy made of them.
    const year = yearAt(this.game.wallNow());
    if (year.season !== this.year.season || lookStep(year.day) !== lookStep(this.year.day)) {
      forgetTrees();
      this.scaled.clear();
      this.scaledSizes.clear();
      this.forgetTreePictures();
    }
    this.year = year;
    if (!this.fast) this.life.frame({
      world, cam, view: V, dLo, dHi, eMin, eMax, width: W, height: H,
      // The island's clock where there is one, so every player sees the same butterfly in the same place.
      clock: this.game.islandClock ? this.game.islandClock() : this.game.time,
      hour: hour0, dark: this.game.darkness(), season: this.year.season, day: this.year.day,
      windX: this.surf.dirX, windY: this.surf.dirY, force: this.surf.force,
      visible: this.lifeVisible, covered: this.lifeCovered, indoors: this.lifeIndoors, pieces: this.lifePieces,
    }, zoom);

    for (let d = dLo; d <= dHi; d++) {
      // A building on piers in the water stands in front of all the water drawn before its line, swell and wakes and all.
      if (this.wetPierLines?.has(d)) this.layWater(ctx, zoom);
      this.ents.length = 0;
      this.entN = 0;
      if (grain) {
        this.grainN = 0;
        this.grainM = 0;
      }
      for (let k = 0; k < this.flowerSpeckN.length; k++) this.flowerSpeckN[k] = 0;
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
        // Remembered ground's wash comes this far down the screen; ground in sight that comes up past it takes it off what it covers.
        this.wallLift = null;
        if (!lit) {
          if (fogged) {
            lineAny = true;
            this.reach(this.washFloor, e + washAt, pts);
          }
        } else if (washed) {
          // Its ground, and the floor raised on it where there is one.
          const top = raising ? this.raisedTop(x, y) : null;
          if (this.over(this.washFloor, e + washAt, pts, c, top, hs)) {
            this.tileColumn(liftPath, pts, c, top, hs);
            this.reach(this.liftFloor, e + washAt, pts);
            this.lifted = true;
          }
          // And the walls it stands, each as it is drawn (`liftWall`).
          if (walled) this.wallLift = liftPath;
        }
        // Under the sea where a corner is below nothing, and under a pond where its water has risen over a corner of the tile.
        const sea = c[0] < 0 || c[1] < 0 || c[2] < 0 || c[3] < 0;
        const pond = water !== null && water.wet(x, y) && this.pondsOn(water, x, y, c, co);
        const wet = sea || pond;
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
        // Stepping stones go down after the line's water, over it; remembered ones too, as paving is.
        if (here === TileType.SteppingStones) (lit ? this.stoneRow : this.stoneRowDim).push(x, y);
        ctx.strokeStyle = grid && !wet ? GRID_COLOR : color;
        ctx.stroke();
        // How wide that edge went down, which a deck's shade on this tile has to come back over (`piers.ts`).
        this.groundEdge = ctx.lineWidth;
        // Weed on the bottom goes under the water rather than over it.
        if (grassy && wet && DROWNS.has(here)) this.strewTile(here, x, y, pts, paveRot, zoom, lit);
        if (sea) this.drawWater(V, x, y, c, fogged && !lit ? lineFog : undefined);
        if (pond) this.drawPonds(V, x, y, c, fogged && !lit ? lineFog : undefined);
        // The water lapping round the feet of piers this tile is in front of, now its water is down (`piers.ts`).
        if (wet && this.game.buildings.pierTiles.size && this.game.buildings.onPiers(x, y)) this.pierFeetHere(x, y, V);
        if (this.pierFeet.size) {
          const feet = this.pierFeet.get(`${x},${y}`);
          if (feet) {
            drawPierFeet(ctx, cam, feet, this.time);
            this.pierFeet.delete(`${x},${y}`);
          }
        }

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
        const wades = wet && WADES.has(t0) && (c[0] + c[1] + c[2] + c[3]) / 4 > (pond ? Math.max(0, this.pondTop) : 0) - WADE_DEPTH;
        if (grassy && (!wet || wades) && STREWN.has(t0) && here !== TileType.Trail) this.strewTile(t0, x, y, pts, paveRot, zoom, lit);
        // And the wildflowers in it, in their season: see `drawFlowers`.
        if (lit && !wet && here === TileType.Grass) this.drawFlowers(ctx, x, y, pts, zoom);
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
        if (hemmed && !wet && !PAVED.has(t0) && t0 !== TileType.Steps) {
          const seams = lit ? this.colors : this.memColors;
          const known = seams.flag(x, y);
          if (known !== 1) {
            const drew = this.hems(ctx, V, x, y, pts, zoom, lit);
            if (known === 0) seams.setFlag(x, y, drew ? 2 : 1);
          }
        }
        /*
         * And a path worn across it: the path itself on a trail, or the wedge
         * of one that crosses a corner of this tile on the diagonal. Asked of
         * every tile, off a mask kept beside the colour.
         */
        if (!wet) {
          const tm = this.trailMaskAt(x, y, lit);
          if (tm) this.drawTrail(ctx, x, y, tm, pts, lit, zoom);
        }
        // And a face of steep ground dressed as the rock in the pictures is: see `dressFace`.
        if (lit) this.dressFace(ctx, x, y, pts, zoom, sea, pond);
        if (paved && !wet && PAVED.has(t0)) this.paving(t0, x, y, world.viewData(x, y, lit), pts, paveRot, lit);
        // A flight of garden steps, built up the tile over its colour: see `steps.ts`.
        if (!wet && t0 === TileType.Steps) {
          drawSteps({ ctx, cam, world, zoom, season: this.season, light: this.stepsLight, dpr: this.canvas.dpr }, x, y);
        }
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
        // A building over a cellar you are looking into is taken off, and everything in it with it.
        const cutHere = this.cut.size > 0 && this.cut.has(this.game.buildings.buildingAt(x, y)?.id ?? -1);
        if (!lit) {
          // Remembered ground keeps its shape and its trees and nothing else:
          // no creatures, no piles, no detail, and a cold wash over the lot.
          if (t === TileType.Tree || t === TileType.Bush || t === TileType.Stump) {
            const data = world.viewData(x, y, false);
            const spr = t === TileType.Tree ? treeSprite(treeSpecies(data), treeVariant(data), this.year.season, this.year.day) : t === TileType.Bush ? bushSprite(bushSpecies(data), this.year.season, this.year.day) : stumpSprite(treeSpecies(data));
            const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
            this.take(t === TileType.Tree ? 'tree' : t === TileType.Bush ? 'bush' : 'stump', x, y, baseX, baseY + hh - avg * hs, spr);
          }
          if (this.game.buildings.list.size || this.game.buildings.walls.size) this.drawStructures(x, y, V, d > playerDepth);
          if (this.hingeTiles.has(x * 65536 + y)) this.drawGateAt(x, y, V);
          const top = raising ? this.raisedTop(x, y) : null;
          this.tileColumn(lineFog, pts, c, top, hs);
          // Come down over something waiting to take the wash off, which stands behind it, its wash and its water's: that goes first.
          if (this.lifted && !lineOver && this.over(this.liftFloor, e + washAt, pts, c, wet ? Math.max(top ?? -Infinity, pond ? this.pondTop : 0) : top, hs)) lineOver = true;
          continue;
        }
        if (t === TileType.Tree || t === TileType.Bush || t === TileType.Stump) {
          const data = world.getData(x, y);
          const spr = t === TileType.Tree ? treeSprite(treeSpecies(data), treeVariant(data), this.year.season, this.year.day) : t === TileType.Bush ? bushSprite(bushSpecies(data), this.year.season, this.year.day) : stumpSprite(treeSpecies(data));
          const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
          this.take(t === TileType.Tree ? 'tree' : t === TileType.Bush ? 'bush' : 'stump', x, y, baseX, baseY + hh - avg * hs, spr);
        }
        if (!cutHere && this.game.ground.size && this.game.groundAt(x, y).length) {
          const avg = (this.game.buildings.pierTiles.size ? this.game.pierDeckAt(x, y) : null) ?? (c[0] + c[1] + c[2] + c[3]) / 4;
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
        // A water plant: what lies on the water goes down after the line's water; a lotus's stalks stand up among everything else.
        if (this.plantFrame) {
          const plant = this.game.waterPlantAt(x, y);
          if (plant) {
            this.plantRow.push(plant);
            if (standsUp(plant, this.plantFrame.now)) {
              const [px, py] = plantFoot(plant, this.plantFrame);
              this.take('waterplant', x, y, px, py, null).plant = plant;
            }
          }
        }
        if (this.game.crops.size) {
          const crop = this.game.cropAt(x, y);
          if (crop) {
            const def = cropDef(crop.id);
            const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
            /*
             * A field waits out a winter; what grows under glass does not
             * (`glasshouse.ts`). Stood at the tile's middle: the top corner and
             * a tile's height down on a diamond, and half across and half down
             * a rectangle -- where it used to stand on the rectangle's corner,
             * and a glasshouse's crops stood half out through its walls.
             */
            const [mx, my] = V.staggered ? [baseX, baseY + hh] : [baseX + hw / 2, baseY + hh / 2];
            this.take('crop', x, y, mx, my - avg * hs,
              cropSprite(crop.id, Math.min(3, crop.stage), def.look, def.colors[0], def.colors[1], this.dormant && !crop.glass, !V.staggered));
          }
        }
        /*
         * A bridge is not put down on a tile, it spans one, so it is asked
         * for on its own rather than through the count below.
         */
        if (this.game.bridges.size) {
          const bridge = this.game.bridgeAt(x, y);
          // An aqueduct's bay is two pieces, its insides behind whoever stands under it and its face in front (`./aqueducts`).
          if (bridge?.kind === 'aqueduct') {
            const k = bridge.spans.findIndex((sp) => sp.x === x && sp.y === y);
            for (const part of ['back', 'front'] as const) {
              const [px, py] = this.aqueducts.sortPoint(bridge, x, y, part);
              this.take('deck', x, y, px, py, null).aq = { b: bridge, k, part };
            }
          }
          // And the fall at its foot goes with the tile it pours into, and the cut its water comes in by with the tile it draws from.
          for (const b of this.aqueducts.footAt(x, y) ?? []) {
            const [px, py] = this.aqueducts.sortPoint(b, x, y, 'spout');
            this.take('deck', x, y, px, py, null).aq = { b, k: b.spans.length - 1, part: 'spout' };
          }
          for (const b of this.aqueducts.headAt(x, y) ?? []) {
            const [px, py] = this.aqueducts.sortPoint(b, x, y, 'intake');
            this.take('deck', x, y, px, py, null).aq = { b, k: 0, part: 'intake' };
          }
          // And water poured onto a foundation at the foot going over its edge, with the tile it falls into.
          for (const { b } of this.aqueducts.offAt(x, y) ?? []) {
            const [px, py] = this.aqueducts.sortPoint(b, x, y, 'off');
            this.take('deck', x, y, px, py, null).aq = { b, k: b.spans.length - 1, part: 'off' };
          }
          // A drawbridge lying on the far bank is laid a span at a time; anything else of it is drawn at its hinge (`drawGateAt`).
          if (bridge && isDrawbridge(bridge)) {
            const i = bridge.spans.findIndex((sp) => sp.x === x && sp.y === y);
            if (i >= 0 && this.drawbridgeUp(bridge) === 0) {
              const wx = x + 0.5, wy = y + 0.5;
              this.take('deck', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, bridge.height), null).deck =
                { kind: 'draw', done: Object.values(bridge.spans[i].needed).every((n) => n <= 0), drop: 0, id: bridge.id, span: i };
            }
          } else if (bridge && bridge.kind !== 'aqueduct') {
            const span = bridge.spans.find((sp) => sp.x === x && sp.y === y);
            const wx = x + 0.5;
            const wy = y + 0.5;
            const dx = cam.worldToScreenX(wx, wy), dy = cam.worldToScreenY(wx, wy, bridge.height);
            // The tile it spans, corner by corner at the deck's height, so it is that tile at every turn of the view.
            const q = ([[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]] as Array<[number, number]>)
              .map(([a, b]): [number, number] => [(cam.worldToScreenX(a, b) - dx) / zoom, (cam.worldToScreenY(a, b, bridge.height) - dy) / zoom]);
            this.take('deck', x, y, dx, dy, null).deck =
              { kind: bridge.kind, done: !!span && Object.values(span.needed).every((n) => n <= 0), drop: bridge.height - world.centerHeight(x, y), id: bridge.id,
                shape: { q, along: bridge.ay === bridge.by ? 'x' : 'y' },
                // How far the moss on a stone arch has got (`greening.ts`): over water, always by it.
                green: greenShows(bridgeGreen(this.game, bridge, this.greenAt) ?? 0, 0, this.wetness(x, y)) };
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
        if (!cutHere && this.game.anythingPlaced(x, y)) {
          for (const sm of this.game.smeltersOnTile(x, y)) {
            const [wx, wy] = smelterCentre(sm);
            const se = this.take('smelter', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, this.standTop(wx, wy)), null);
            se.smelter = sm;
            if (sm.rare) se.rare = sm.rare;
          }
          for (const kl of this.game.kilnsOnTile(x, y)) {
            const [wx, wy] = kilnCentre(kl);
            const ke = this.take('kiln', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, this.standTop(wx, wy)), null);
            ke.kiln = kl;
            if (kl.rare) ke.rare = kl.rare;
          }
          for (const fu of this.game.furnitureOnTile(x, y)) {
            // A piece down in a cellar is drawn with the cellar (`drawCellarView`), and not at all from up top.
            if ((fu.level ?? 0) < 0) continue;
            // A hull somebody else is steering is where their hands are, which is read a dozen times a second; where
            // she was set down is read once.
            const [wx, wy] = fu.helm ? this.game.hullCentre(fu) : furnitureCentre(fu);
            const fe = this.take('furniture', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, this.pieceBase(fu, wx, wy)), null);
            fe.piece = fu;
            fe.view = this.viewOf(fu);
            if (fu.rare) fe.rare = fu.rare;
            if (fu.helm || fu.riders?.length || player.aboard === fu.id || this.helming === fu) this.takeAboard(fu, fe, x, y, zoom);
          }
          for (const an of this.game.anvilsOnTile(x, y)) {
            const [wx, wy] = anvilCentre(an);
            const ae = this.take('anvil', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, this.standTop(wx, wy)), null);
            ae.anvil = an;
            if (an.rare) ae.rare = an.rare;
          }
          for (const po of this.game.postsOnTile(x, y)) {
            const [wx, wy] = postCentre(po);
            this.take('post', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, this.standTop(wx, wy)), null).post = po;
          }
          for (const tr of this.game.trapsOnTile(x, y)) {
            const [wx, wy] = trapCentre(tr);
            this.take('trap', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, this.standTop(wx, wy)), null).trap = tr;
          }
          for (const fire of this.game.campfiresOnTile(x, y)) {
            const [wx, wy] = fireCentre(fire);
            this.take('campfire', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, this.standTop(wx, wy)), null).fire = fire;
          }
          for (const crate of this.game.cratesOnTile(x, y)) {
            // A crate standing on a rack is drawn by the rack, up on its deck
            // where it actually is. Drawn here as well it would be a second
            // crate on the floor underneath the first. And one down in a cellar is drawn with the cellar.
            if ((crate.level ?? 0) < 0 || this.game.rackAt(crate.x, crate.y, crate.sx, crate.sy, crate.level)) continue;
            const [wx, wy] = crateCentre(crate);
            const ce = this.take('crate', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, this.standTop(wx, wy)), crateSprite(crate.kind));
            ce.crateId = crate.id;
            if (crate.rare) ce.rare = crate.rare;
          }
        }
        // Other people on the island stand on tiles like anything else does.
        if (!cutHere && this.game.roster.size) {
          for (const peer of this.game.roster.atTile(x, y)) {
            // Down in a cellar: drawn with it, from down there, and not from up top.
            if (peer.level < 0 || (peer.uid && this.seated.has(peer.uid))) continue;
            const [px, py] = this.game.roster.drawnAt(peer);
            const flight = peer.level === 0 ? this.onFlight(px, py) : null;
            const pe = this.take('peer', x, y, cam.worldToScreenX(px, py),
              cam.worldToScreenY(px, py, flight ? flight.h : (this.game.deckBase(Math.floor(px), Math.floor(py), peer.level) ?? this.footOn(px, py, peer.level)) + peer.level * WALL_HEIGHT), null);
            pe.peer = peer;
            if (flight) pe.clip = flight.clip;
          }
        }
        if (!cutHere && this.game.creatures.list.size) {
          // Anything standing on a tile with a bridge's deck or a slab over it stands on that. No
          // creature goes onto a tile on piers (`Creatures.tileOk`), so the ground is all there is.
          const deckHere = this.game.laidOver(x, y);
          for (const cr of this.game.creatures.atTile(x, y)) {
            // One shut in a crate is drawn in the crate, by the crate.
            if (cr.mode === 'stored') continue;
            // One in the traces of a wagon a storey up is up there with it (`driveStorey`).
            const up = cr.hitchedTo !== null ? this.game.furniture.get(cr.hitchedTo)?.level ?? 0 : 0;
            this.take('creature', x, y, cam.worldToScreenX(cr.x, cr.y),
              cam.worldToScreenY(cr.x, cr.y, up > 0 ? this.footOn(cr.x, cr.y, up) + up * WALL_HEIGHT : deckHere ?? this.footAt(cr.x, cr.y)), null).creature = cr;
          }
        }
        if (this.game.foundations.size) this.drawFoundation(x, y, lit);
        if (this.game.buildings.list.size || this.game.buildings.walls.size) this.drawStructures(x, y, V, d > playerDepth);
        if (this.hingeTiles.has(x * 65536 + y)) this.drawGateAt(x, y, V);
      }

      // Down in a cellar you are drawn with it (`drawCellarView`), and from up top not at all.
      if (d === playerDepth && player.aboard === null && !this.helming && player.level >= 0) {
        // On a bridge you stand on the deck, not in whatever is under it.
        // On the deck unless you are in a hull passing under it.
        // In a building on piers, on its deck and the storeys over it (`piers.ts`).
        const piered = this.game.afloat() ? null : this.game.deckBase(player.tileX, player.tileY, player.level);
        const deck = this.game.afloat() || piered !== null ? null : this.game.laidOver(player.tileX, player.tileY);
        // A driver is drawn on the seat, which is a lift in screen pixels
        // rather than in world height: the cart is under them, not the ground.
        const drivenBy = this.game.driving();
        const up = this.game.mounted();
        // On the head of a way down, in the hole on its tread.
        const flight = piered === null && deck === null && player.level === 0 && !drivenBy && !up ? this.onFlight(player.x, player.y) : null;
        // Afloat in deep water, at the top of it: the sea's surface, or a pond's; on stepping stones, on their tops.
        const ph = piered !== null ? piered + player.visualLevel * WALL_HEIGHT
          : deck !== null ? deck : flight ? flight.h : this.footOn(player.x, player.y, player.level) + player.visualLevel * WALL_HEIGHT;
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
        if (flight) pe.clip = flight.clip;
        // At a helm on a deck of its own the driver stands there, not in her middle.
        if (drivenBy && furnitureDef(drivenBy.kind).boat?.helm) this.onDeck(pe, drivenBy, this.game.helmSpot(drivenBy), pe.lift, true);
        // Anything else with a seat, on that seat with what is to hand there.
        else if (drivenBy) this.seatOn(pe, drivenBy, zoom);
        // A rider, astride.
        else if (up) pe.seat = SADDLE;
      }
      // A wall laid at the end of the line is laid again over one already laid, which took the wash off it then.
      this.wallLift = null;
      if (grain) {
        this.specks(ctx, this.grainDark, this.grainN, 'rgba(0,0,0,0.095)');
        this.specks(ctx, this.grainPale, this.grainM, 'rgba(255,255,255,0.07)');
      }
      // The line's wildflowers from far off, a fill a colour.
      for (let k = 0; k < this.flowerSpeckN.length; k++) {
        const n = this.flowerSpeckN[k];
        if (!n) continue;
        const buf = this.flowerSpecks[k];
        const sz = Math.max(2.3, 3.8 * zoom);
        ctx.beginPath();
        for (let i = 0; i < n; i += 2) ctx.rect(buf[i] - sz / 2, buf[i + 1] - sz / 2, sz, sz);
        ctx.fillStyle = FLOWER_COLOURS[k].petal;
        ctx.fill();
      }
      // The light on this line's ponds, and the streams, falls and springs whose water lies on it, over the ground and under what stands on it.
      if (water) this.springWater.row(ctx, d);
      // Then the stepping stones standing up out of all of it, before anybody standing on them; and the pads lying on it.
      if (this.stoneRow.length || this.stoneRowDim.length) this.stonesOnLine(ctx);

      if (this.plantRow.length && this.plantFrame) {
        drawPlantsFlat(ctx, this.plantRow, this.plantFrame);
        this.plantRow.length = 0;
      }
      // Petals and leaves lying on this line's ground and floating on its water.
      if (!this.fast) this.life.ground(ctx, d);
      // The line's pilasters, over every wall of it and under its roofs (`drawColumnsAt`).
      if (this.linePilasters.length) {
        for (const lay of this.linePilasters) lay();
        this.linePilasters.length = 0;
      }
      // The roofs of the buildings whose last walls this line drew, before
      // anything standing in front of them.
      const roofs = this.roofQueue.get(d);
      if (roofs) {
        for (const bb of roofs) {
          // And so does its roof, over the water drawn beside its last tiles.
          if (this.wetPierBuildings?.has(bb.id)) this.layWater(ctx, zoom);
          // Not over the bays of an aqueduct standing in front of it, drawn on the lines before this one.
          const cut = this.game.bridges.size ? this.aqueducts.before(bb.tiles, d, V) : null;
          if (cut?.length) {
            ctx.save();
            this.aqueducts.clipOut(ctx, cut);
          }
          this.drawPitchedRoof(bb);
          if (cut?.length) ctx.restore();
        }
      }
      // A drawbridge's gallows and a deck off the bank stand in front of any roof this line laid (`drawGateAt`).
      if (this.gateLate.length) {
        for (const draw of this.gateLate) draw();
        this.gateLate.length = 0;
      }
      // And whatever small thing is in the air over it, sorted in with everything standing on it.
      if (!this.fast) for (const m of this.life.aloft(d)) this.take('life', m.tx, m.ty, m.sx, m.sy, null).mote = m;
      // What spells lay on this line's ground, under everything standing on it; and what of them stands here, sorted in with it.
      this.spells.groundLine(ctx, d);
      for (const rec of this.spells.itemsAt(d)) this.take('spell', Math.floor(rec.x), Math.floor(rec.y), rec.sx, rec.sy, null).fx = rec;
      if (this.ents.length) this.drawEntities(ctx, zoom);
      // Remembered ground on this line came down over what was waiting to take the wash off: the wash so far is laid, and that taken off it, first.
      if (lineOver) {
        wash ??= this.fogLayer(drawnAt);
        this.layWash(wash, gathered ? fogPath : null, liftPath);
        fogPath = new Path2D();
        liftPath = new Path2D();
        gathered = false;
        lineOver = false;
        this.lifted = false;
        this.liftFloor.fill(-Infinity);
      }
      if (lineAny) {
        fogPath.addPath(lineFog);
        lineFog = new Path2D();
        washed = true;
        gathered = true;
        lineAny = false;
      }
    }
    // The surface and then what crossed it, both clipped to the water, so
    // neither washes up over a beach standing in front of them.
    if (!this.fast) this.drawSwell(ctx, zoom);
    this.drawWakes(ctx, zoom);
    this.drawAir(ctx, zoom);
    if (!this.fast) this.drawHaze(ctx, zoom);
    this.drawFloaters(ctx, zoom);

    // One pass for all of it, so a remembered wood goes cold with its ground.
    if (this.lifted || wash) {
      wash ??= this.fogLayer(drawnAt);
      this.layWash(wash, gathered ? fogPath : null, this.lifted ? liftPath : null);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = FOG_ALPHA;
      ctx.drawImage(wash, 0, 0);
      ctx.restore();
    } else if (gathered) {
      ctx.fillStyle = FOG_COLOR;
      ctx.fill(fogPath);
    }

    this.drawOverlays(ctx, zoom);
    this.drawFight(ctx, zoom);
  }

  /** Where your feet were drawn this frame, on the screen. */
  private feetAt: { x: number; y: number } | null = null;

  /**
   * The fight, over everything else: a bar over whatever is after you and
   * over what you are fighting or have marked, the swing in hand as a ring
   * filling at your feet, an arrow at the edge of the view for each thing
   * after you out of it, how far a hunter under the cursor notices you from,
   * and the edge of the view reddening when you are struck.
   */
  private drawFight(ctx: CanvasRenderingContext2D, zoom: number): void {
    const game = this.game;
    const cam = this.camera;
    const w = game.world;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const marked = game.fightTarget ?? game.marked;
    ctx.save();
    for (const hit of this.creatureHits) {
      if (hit.creature === undefined) continue;
      const c = game.creatures.get(hit.creature);
      if (!c || c.mode !== 'wild' || c.health <= 0 || (c.enemy !== PLAYER_ATTACKER && c.id !== marked)) continue;
      const k = Math.max(0, Math.min(1, c.health / maxHealth(c, game.creatures.species(c))));
      const bw = 34 * zoom;
      const bh = Math.max(3, 4 * zoom);
      const bx = hit.left + hit.w / 2 - bw / 2;
      const by = hit.top - bh - 3 * zoom;
      ctx.fillStyle = 'rgba(12, 8, 6, 0.75)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = k > 0.5 ? '#7cc46a' : k > 0.25 ? '#e0b44a' : '#e2553c';
      ctx.fillRect(bx, by, bw * k, bh);
      if (c.id === marked) {
        ctx.strokeStyle = 'rgba(255, 220, 140, 0.9)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx - 2.5, by - 2.5, bw + 5, bh + 5);
      }
    }
    // The swing or the draw in hand, filling round your feet as it comes.
    const a = game.action;
    if (a && isFightJob(a.def.id) && a.state === 'performing' && this.feetAt) {
      const k = Math.max(0, Math.min(1, a.elapsed / Math.max(0.001, a.duration)));
      const rx = 0.5 * Math.SQRT2 * HALF_W * zoom;
      const ry = 0.5 * Math.SQRT2 * HALF_H * zoom;
      ctx.lineWidth = Math.max(2, 3 * zoom);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.ellipse(this.feetAt.x, this.feetAt.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 214, 120, 0.95)';
      ctx.beginPath();
      ctx.ellipse(this.feetAt.x, this.feetAt.y, rx, ry, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
      ctx.stroke();
    }
    // A bow being drawn: the line to what it is drawn on, filling as the draw comes up,
    // in amber while it is within the bow's range and grey once it is not.
    if (a && a.def.id === 'shoot_creature' && a.state === 'performing' && a.target.kind === 'creature' && this.feetAt) {
      const t = game.creatures.get(a.target.id);
      if (t) {
        const k = Math.max(0, Math.min(1, a.elapsed / Math.max(0.001, a.duration)));
        const tx = cam.worldToScreenX(t.x, t.y);
        const ty = cam.worldToScreenY(t.x, t.y, w.heightAt(t.x, t.y));
        const fx = this.feetAt.x;
        const fy = this.feetAt.y;
        const inRange = inFightReach(game, 'shoot_creature', t);
        ctx.lineWidth = Math.max(1, 1.5 * zoom);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.lineWidth = Math.max(2, 2.5 * zoom);
        ctx.strokeStyle = inRange ? 'rgba(255, 214, 120, 0.95)' : 'rgba(170, 170, 170, 0.8)';
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx + (tx - fx) * k, fy + (ty - fy) * k);
        ctx.stroke();
      }
    }
    // Your companion's fight: a line from it to what it is going for.
    ctx.setLineDash([5 * zoom, 4 * zoom]);
    for (const c of game.creatures.list.values()) {
      if (c.mode !== 'active' || c.mine === false || c.enemy === null || c.enemy === PLAYER_ATTACKER) continue;
      const e = game.creatures.get(c.enemy);
      if (!e) continue;
      const cx = cam.worldToScreenX(c.x, c.y);
      const cy = cam.worldToScreenY(c.x, c.y, w.heightAt(c.x, c.y));
      const ex = cam.worldToScreenX(e.x, e.y);
      const ey = cam.worldToScreenY(e.x, e.y, w.heightAt(e.x, e.y));
      ctx.lineWidth = Math.max(1.5, 2 * zoom);
      ctx.strokeStyle = 'rgba(120, 190, 255, 0.85)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = 'rgba(120, 190, 255, 0.95)';
      ctx.beginPath();
      ctx.arc(ex, ey, Math.max(2.5, 3.5 * zoom), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.setLineDash([]);
    // How far a hunter under the cursor will notice you from.
    const hc = this.hover?.creature !== undefined ? game.creatures.get(this.hover.creature) : undefined;
    if (hc && hc.mode === 'wild' && hc.enemy !== PLAYER_ATTACKER && game.creatures.species(hc).hunter) {
      const r = game.creatures.species(hc).notice ?? HUNT_SIGHT;
      const sx = cam.worldToScreenX(hc.x, hc.y);
      const sy = cam.worldToScreenY(hc.x, hc.y, w.heightAt(hc.x, hc.y));
      ctx.setLineDash([6 * zoom, 5 * zoom]);
      ctx.lineWidth = Math.max(1.5, 2 * zoom);
      ctx.strokeStyle = 'rgba(232, 150, 60, 0.85)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, r * Math.SQRT2 * HALF_W * zoom, r * Math.SQRT2 * HALF_H * zoom, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // An arrow at the edge of the view for everything after you that is out of it.
    const m = 26;
    for (const c of game.creatures.list.values()) {
      if (c.mode !== 'wild' || c.health <= 0 || c.enemy !== PLAYER_ATTACKER) continue;
      const sx = cam.worldToScreenX(c.x, c.y);
      const sy = cam.worldToScreenY(c.x, c.y, w.heightAt(c.x, c.y));
      if (sx >= m && sx <= W - m && sy >= m && sy <= H - m) continue;
      const dx = sx - W / 2;
      const dy = sy - H / 2;
      const t = Math.min((W / 2 - m) / Math.max(1e-6, Math.abs(dx)), (H / 2 - m) / Math.max(1e-6, Math.abs(dy)));
      const ax = W / 2 + dx * t;
      const ay = H / 2 + dy * t;
      const ang = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(ang);
      ctx.fillStyle = 'rgba(226, 70, 50, 0.92)';
      ctx.strokeStyle = 'rgba(20, 8, 6, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-8, -9);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-8, 9);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }
    // Struck: the edge of the view reddens for the length of the flash.
    const struck = this.flashOf(game.player.attackedAt);
    if (struck > 0) {
      const glow = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
      glow.addColorStop(0, 'rgba(190, 28, 18, 0)');
      glow.addColorStop(1, `rgba(190, 28, 18, ${(0.42 * struck).toFixed(3)})`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  /** The stepping stones of the line of the ground just drawn, over its water, each one out in the sea cut out of the sea the swell goes over. */
  private stonesOnLine(ctx: CanvasRenderingContext2D): void {
    const world = this.game.world;
    if (this.stoneRowDim.length) drawStones(ctx, this.camera, world, this.stoneRowDim, this.time, false, this.seaPath);
    if (this.stoneRow.length) drawStones(ctx, this.camera, world, this.stoneRow, this.time, true, this.seaPath);
    this.stoneRow.length = 0;
    this.stoneRowDim.length = 0;
  }

  /**
   * The height a piece stands at: the ground under it, or for a hull the
   * water she floats on. A boat is drawn from her waterline up, so she sits
   * on the surface however deep it is under her rather than on the bottom.
   */
  /**
   * The people on a hull: whoever has her helm and whoever is aboard as a
   * passenger, us among them. Each is drawn at their own place on her,
   * lifted to it: the helm to `seat`, sat in her middle or on their feet on a
   * deck of its own, and the passengers on their feet at her waist.
   *
   * And each is drawn among her, not over her. A hull with a deck of her own
   * is baked in layers split where each place on her comes in the order her
   * parts are drawn (`crewOf`, `crewOrder`), and whoever stands at a place
   * goes between the layer before it and the one after: a fore course nearer
   * you than the waist is drawn over the people in the waist, and the mizzen
   * behind them under. Everybody sorts a hair after her, and in that order.
   * Any other hull is one picture with its people after it, as they come.
   */
  private readonly seated = new Set<string>();
  /** The hull with a deck of her own that I have the helm of, this frame. */
  private helming: PlacedFurniture | null = null;
  private takeAboard(f: PlacedFurniture, fe: Entity, x: number, y: number, zoom: number): void {
    const boat = furnitureDef(f.kind).boat;
    if (!boat) return;
    const waist = boat.waist ?? boat.seat;
    const me = this.game.player;
    // Who is where: place 0 is her helm, and a passenger's place is their seat.
    const hands: Array<{ spot: number; take: (sy: number) => void }> = [];
    const aboard = (uid: string, spot: number, at: (peer: Peer) => [number, number], deck: number, standing: boolean): void => {
      const peer = this.game.roster.list().find((p) => p.uid === uid);
      if (!peer) return;
      hands.push({ spot, take: (sy) => {
        const e = this.take('peer', x, y, fe.sx, sy, null);
        e.peer = peer;
        this.onDeck(e, f, at(peer), deck * zoom, standing);
        // Whoever has the helm of a boat with no deck of its own to stand at it is sat at her oars or her tiller.
        if (spot === 0 && !standing) this.seatOn(e, f, zoom);
      } });
    };
    if (f.helm) aboard(f.helm, 0, () => this.game.helmSpot(f), boat.seat, !!boat.helm);
    if (this.helming === f) hands.push({ spot: 0, take: (sy) => this.onDeck(this.take('player', x, y, fe.sx, sy, null), f, this.game.helmSpot(f), boat.seat * zoom, true) });
    if (me.aboard === f.id) hands.push({ spot: me.seat ?? 0, take: (sy) => this.onDeck(this.take('player', x, y, fe.sx, sy, null), f, [me.x, me.y], waist * zoom, true) });
    for (const r of f.riders ?? []) aboard(r.who, r.seat, (peer) => this.game.roster.drawnAt(peer), waist, true);

    const crew = crewOf(f.kind);
    const HAIR = 0.01;
    if (!crew || !fe.view) {
      hands.forEach((h, i) => h.take(fe.sy + HAIR * (i + 1)));
      return;
    }
    const order = crewOrder(zoom, f.kind, !!f.lit, dyeOf(f) ?? undefined, this.pieceTrim(f), fe.view, f.material, crew);
    fe.layer = 0;
    order.forEach((spot, n) => {
      for (const h of hands) if (h.spot === spot) h.take(fe.sy + HAIR * (2 * n + 1));
      const le = this.take('hull', x, y, fe.sx, fe.sy + HAIR * (2 * n + 2), null);
      le.piece = f;
      le.view = fe.view;
      le.layer = n + 1;
      // Drawn where she is, whatever it sorts as.
      le.drawDy = -HAIR * (2 * n + 2);
    });
    // Anybody at a place she has no stand-in for goes over the lot.
    for (const h of hands) if (!order.includes(h.spot)) h.take(fe.sy + HAIR * (2 * order.length + 1));
  }

  /**
   * Somebody driving `f`, sat where its driver sits (`driverOn`): their feet
   * put that far from wherever they are drawn from now, and lifted to the
   * floor under the seat, which is what makes them a driver.
   */
  private seatOn(e: Entity, f: PlacedFurniture, zoom: number): void {
    const d = driverOn(f.kind, this.viewOf(f));
    if (!d) return;
    e.lift = d.lift * zoom;
    e.drawDx = (e.drawDx ?? 0) + d.dx * zoom;
    e.drawDy = (e.drawDy ?? 0) + d.dy * zoom + e.lift;
    e.seat = d.seat;
    e.seatFacing = d.facing;
  }

  /** Somebody on `f`, drawn at `wx`, `wy` on her rather than where they sort, `lift` up. */
  private onDeck(e: Entity, f: PlacedFurniture, [wx, wy]: [number, number], lift: number, standing: boolean): void {
    const cam = this.camera;
    e.drawDx = cam.worldToScreenX(wx, wy) - e.sx;
    e.drawDy = cam.worldToScreenY(wx, wy, this.pieceBase(f, wx, wy)) - e.sy;
    e.lift = lift;
    e.standing = standing;
  }

  /**
   * The reins of a beast in the traces: from where its head is drawn back to
   * the driver's box of the cart or wagon it is put to, at the height of the
   * driver's hands, hanging a little between -- two lines of leather, a pair to
   * each beast, as a team is driven. Drawn over the beast, so they are seen
   * coming off its head; the box, drawn after it where it stands in front,
   * takes their other end.
   */
  private drawReins(ctx: CanvasRenderingContext2D, cr: Creature, sx: number, sy: number, facing: number, big: number, zoom: number): void {
    const f = cr.hitchedTo !== null ? this.game.furniture.get(cr.hitchedTo) : undefined;
    const to = f && reinsTo(f.kind);
    if (!f || !to) return;
    const cam = this.camera;
    const head = wildermonHead(cr.species, facing) ?? [0, -(wildermonTop(cr.species) ?? 20) * 0.8];
    const hx = sx + head[0] * zoom * big, hy = sy + head[1] * zoom * big;
    // The driver's hands: over the front of the box, toward the team, where the seat is.
    const [cx, cy] = furnitureCentre(f);
    const dx = cr.x - cx, dy = cr.y - cy, d = Math.hypot(dx, dy) || 1;
    // Where the driver's own reins come to (`Seat.grip`), so the two are one line.
    const wx = cx + (dx / d) * (to[0] / UNITS_PER_TILE), wy = cy + (dy / d) * (to[0] / UNITS_PER_TILE);
    const bx = cam.worldToScreenX(wx, wy);
    const by = cam.worldToScreenY(wx, wy, this.pieceBase(f, wx, wy)) - to[2] * HEIGHT_SCALE * zoom;
    // A pair a hand apart, sagging by a little of the length between.
    const nx = -(hy - by), ny = hx - bx, nl = Math.hypot(nx, ny) || 1;
    const sag = Math.min(14, Math.hypot(hx - bx, hy - by) * 0.12) * zoom;
    ctx.save();
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      const ox = (nx / nl) * side * 1.1 * zoom, oy = (ny / nl) * side * 1.1 * zoom;
      const mx = (hx + bx) / 2 + ox, my = (hy + by) / 2 + oy + sag;
      for (const [ink, w] of [[REIN_LINE, 2.2], [REIN_LEATHER, 1.2]] as Array<[string, number]>) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(0.8, w * zoom * 0.6);
        ctx.beginPath();
        ctx.moveTo(bx + ox, by + oy);
        ctx.quadraticCurveTo(mx, my, hx + ox, hy + oy);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private pieceBase(f: { kind: string; level?: number }, wx: number, wy: number): number {
    // A wagon driven up a wide staircase stands on the floor of its storey, as a body up there does.
    const up = f.level ?? 0;
    if (up > 0) return this.footOn(wx, wy, up) + up * WALL_HEIGHT;
    const h = this.game.world.heightAt(wx, wy);
    return furnitureDef(f.kind).boat ? Math.max(h, 0) : this.standTop(wx, wy);
  }

  /** Whether a tile stands on piers, for the pond painter (`WaterFrame.decked`). */
  private readonly pierOver = (x: number, y: number): boolean => this.game.buildings.onPiers(x, y);

  /** How high a thing set down at a point stands: on the finished deck of a tile on piers, or on the ground. */
  private standTop(wx: number, wy: number): number {
    return (this.game.buildings.pierTiles.size ? this.game.pierDeckAt(Math.floor(wx), Math.floor(wy)) : null) ?? this.game.world.heightAt(wx, wy);
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

  /**
   * The scratch, at the screen's own resolution: a pixel of it is a device
   * pixel, so a copy of what was drawn on it is as sharp as the thing drawn
   * straight onto the screen, and can stand in for it (`paint`). `side` is
   * its size in CSS pixels, and (ox, oy) where the thing's feet go on it.
   */
  private scratch(zoom: number): { pad: HTMLCanvasElement; g: CanvasRenderingContext2D; ox: number; oy: number; side: number } {
    const dpr = this.canvas.dpr;
    const want = Math.ceil(124 * Math.max(1, zoom) * dpr);
    if (!this.tintPad || this.tintPad.width < want) {
      this.tintPad = document.createElement('canvas');
      this.tintPad.width = want;
      this.tintPad.height = want;
      this.tintCtx = this.tintPad.getContext('2d');
    }
    const g = this.tintCtx as CanvasRenderingContext2D;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.tintPad.width, this.tintPad.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const side = this.tintPad.width / dpr;
    return { pad: this.tintPad, g, ox: side / 2, oy: side * 0.78, side };
  }

  /** The ring round the thing under the cursor, put together off the screen and laid down in one go (`paint`). */
  private ringPad: HTMLCanvasElement | null = null;
  /** And a copy of the thing as it was drawn, laid over the ring rather than drawing the thing a second time. */
  private keepPad: HTMLCanvasElement | null = null;
  private sized(had: HTMLCanvasElement | null, w: number, h: number): HTMLCanvasElement {
    const c = had ?? document.createElement('canvas');
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return c;
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
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = colour;
    g.fillRect(0, 0, pad.width, pad.height);
    g.restore();
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
    const { pad, g, ox, oy, side } = this.scratch(zoom);
    draw(g, ox, oy);
    const left = sx - ox;
    const top = sy - oy;
    if (effect === 'flash') {
      ctx.drawImage(pad, left, top, side, side);
      this.stamp('#ffffff');
      ctx.globalAlpha = Math.max(0, Math.min(1, power));
      ctx.drawImage(pad, left, top, side, side);
      ctx.globalAlpha = 1;
      return;
    }
    // The outline goes down first and the thing on top of it, so what shows is
    // the part of the ring that sticks out past the edges. The thing is kept
    // as it was drawn before the scratch is stamped, and the ring is put
    // together off the screen: two copies onto the screen, where there were
    // eight and the whole thing drawn over again.
    const dpr = this.canvas.dpr;
    const keep = (this.keepPad = this.sized(this.keepPad, pad.width, pad.height));
    const kg = keep.getContext('2d') as CanvasRenderingContext2D;
    kg.globalCompositeOperation = 'copy';
    kg.drawImage(pad, 0, 0);
    kg.globalCompositeOperation = 'source-over';
    this.stamp(HOVER_INK);
    const r = Math.max(1.6, 2.1 * zoom);
    const m = Math.ceil(r * dpr) + 1;
    const ring = (this.ringPad = this.sized(this.ringPad, pad.width + 2 * m, pad.height + 2 * m));
    const rg = ring.getContext('2d') as CanvasRenderingContext2D;
    rg.clearRect(0, 0, ring.width, ring.height);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      rg.drawImage(pad, m + Math.cos(a) * r * dpr, m + Math.sin(a) * r * dpr);
    }
    ctx.globalAlpha = 0.9;
    ctx.drawImage(ring, left - m / dpr, top - m / dpr, ring.width / dpr, ring.height / dpr);
    ctx.globalAlpha = 1;
    ctx.drawImage(keep, left, top, side, side);
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

  /** Save the context and clip it to `clip`, when there is one: the caller restores it after drawing. */
  private clipTo(ctx: CanvasRenderingContext2D, clip: Array<[number, number]> | undefined): void {
    if (!clip) return;
    ctx.save();
    ctx.beginPath();
    clip.forEach(([cx, cy], i) => (i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy)));
    ctx.closePath();
    ctx.clip();
  }

  /* ---- spells ---------------------------------------------------------------------- */

  /** Where somebody a spell is cast by or at stands this frame, as the stage wants them; nothing when they are gone. */
  private spellBody(w: Who): SpellBody | null {
    const game = this.game;
    if (w.kind === 'player') {
      const p = game.player;
      const z = this.footOn(p.x, p.y, Math.max(0, p.level)) + Math.max(0, p.visualLevel) * WALL_HEIGHT;
      return personBody(p.x, p.y, z, this.playerFacing, 'player', {
        phase: p.moving ? p.walkPhase : this.time * 6, moving: p.moving, gait: 0, facing: this.playerFacing, swimming: p.swimming, working: false,
        look: p.look, gear: gearFrom(wornWire((slot) => game.worn(slot))),
      });
    }
    if (w.kind === 'peer') {
      const peer = game.roster.get(w.id);
      if (!peer || peer.level < 0) return null;
      const [x, y] = game.roster.drawnAt(peer);
      const z = this.footOn(x, y, peer.level) + peer.level * WALL_HEIGHT;
      return personBody(x, y, z, peer.facing, 'peer', {
        phase: peer.moving ? peer.walkPhase : this.time * 6, moving: peer.moving, facing: peer.facing, swimming: peer.swimming, working: !!peer.working,
        look: peer.look, gear: peer.gear,
      });
    }
    const cr = game.creatures.get(w.id);
    if (!cr || cr.health <= 0 || cr.mode === 'stored') return null;
    const def = SPECIES[cr.species] ?? SPECIES.rabba;
    const big = ageDef(cr, game.time).scale * rarityOf(cr).size;
    const tall = Math.max(22 * rarityOf(cr).size, (wildermonTop(def.id) ?? 0) * big) / HEIGHT_SCALE;
    return {
      x: cr.x, y: cr.y, z: game.laidOver(Math.floor(cr.x), Math.floor(cr.y)) ?? this.footAt(cr.x, cr.y), tall, wide: 5 * rarityOf(cr).size,
      facing: this.beastFacing.get(cr.id) ?? 0, kind: 'creature',
    };
  }

  /** Somebody turned to face what they are casting at, unless they are walking somewhere. */
  private spellTurn(w: Who, x: number, y: number): void {
    const game = this.game;
    const who = w.kind === 'player' ? game.player : w.kind === 'peer' ? game.roster.get(w.id) : undefined;
    if (!who || who.moving) return;
    const dx = x - who.x, dy = y - who.y, l = Math.hypot(dx, dy);
    if (l < 0.05) return;
    who.dirX = dx / l;
    who.dirY = dy / l;
  }

  /**
   * Play a spell's drawing from you, with no island and nothing done: for
   * checking how a spell looks (`wurm.spell` in the console). At what is
   * under the cursor -- a creature, somebody, the ground -- unless told, or
   * at yourself for a spell cast only on yourself. Nothing is sent to anybody.
   */
  playSpell(spell: string, at?: CastAt): boolean {
    const info = spellInfo(spell);
    const hover = this.hover;
    const p = this.game.player;
    let aim: CastAt;
    if (info && info.on.length === 1 && info.on[0] === 'self') aim = { kind: 'self' };
    else if (at) aim = at;
    else if (hover?.creature !== undefined) aim = { kind: 'creature', id: hover.creature };
    else if (hover?.peer !== undefined) {
      const peer = this.game.roster.list().find((q) => q.uid === hover.peer);
      aim = peer ? { kind: 'peer', id: peer.id } : { kind: 'self' };
    } else if (hover) aim = { kind: 'spot', x: hover.wx, y: hover.wy };
    else aim = { kind: 'spot', x: p.x + p.dirX * 3, y: p.y + p.dirY * 3 };
    return this.spells.play(spell, PLAYER_CASTS, this.spellAim(aim), { mine: true });
  }

  /** What a cast was at, as the stage takes it. */
  private spellAim(at: CastAt): Aim {
    switch (at.kind) {
      case 'self': return { kind: 'self' };
      case 'you': return { kind: 'player' };
      case 'peer': return { kind: 'peer', id: at.id };
      case 'creature': return { kind: 'creature', id: at.id };
      case 'spot': return { kind: 'spot', x: at.x, y: at.y };
    }
  }

  private drawEntities(ctx: CanvasRenderingContext2D, zoom: number): void {
    const ents = this.ents;
    // Within a diagonal, whatever stands lower on screen is nearer the viewer.
    if (ents.length > 1) ents.sort((a, b) => a.sy - b.sy || a.sx - b.sx || (a.lift ?? 0) - (b.lift ?? 0));
    const player = this.game.player;
    this.playerFacing = this.facingOnScreen(player.dirX, player.dirY, this.playerFacing);
    /*
     * What stands still on the ground under a jetty is behind the jetty's
     * floor (`underJetty`), cut out of it until the next thing is drawn.
     * Whoever and whatever moves about under one is drawn whole, as before:
     * a body, a beast, a bird is looked for, and under a floor that deep
     * would be lost.
     */
    let behind = false;
    for (const ent of ents) {
      if (behind) {
        ctx.restore();
        behind = false;
      }
      const under = ent.kind === 'life' || ent.kind === 'spell' || ent.kind === 'player' || ent.kind === 'peer' || ent.kind === 'creature' ? null : this.underJetty(ent);
      if (under) {
        ctx.save();
        ctx.clip(under, 'evenodd');
        behind = true;
      }
      if (ent.kind === 'life') {
        if (ent.mote) this.life.draw(ctx, ent.mote);
        continue;
      }
      if (ent.kind === 'spell') {
        if (ent.fx) this.spells.drawItem(ctx, ent.fx);
        continue;
      }
      // Being hit beats being pointed at: a blow should read as a blow even
      // while the cursor is sitting on the thing taking it.
      const hovering = this.isHovered(ent);
      if (ent.kind === 'player') {
        const struck = this.flashOf(player.attackedAt);
        const ex = ent.sx + (ent.drawDx ?? 0), ey = ent.sy + (ent.drawDy ?? 0);
        // Where your feet are on the screen, for the ring the swing in hand is drawn as (`drawFight`).
        this.feetAt = { x: ex, y: ey - (ent.lift ?? 0) };
        this.clipTo(ctx, ent.clip);
        this.paint(ctx, zoom, struck > 0 ? 'flash' : 'none', struck * 0.75, ex, ey - (ent.lift ?? 0), (g, px, py) =>
          drawPlayer(g, px, py, zoom, {
            id: 'player',
            phase: player.moving ? player.walkPhase : this.time * 6,
            // On a deck it is the hull that is going somewhere, not the feet.
            moving: player.moving && !ent.standing,
            gait: this.gaits.of('player', player.x, player.y, this.frameDt),
            facing: ent.seatFacing ?? this.playerFacing,
            swimming: player.swimming,
            working: this.game.action?.state === 'performing',
            driving: (ent.lift ?? 0) > 0 && !ent.standing,
            seat: ent.seat,
            look: player.look,
            // Everything on, each piece drawn in its own material, dye and rarity.
            gear: gearFrom(wornWire((slot) => this.game.worn(slot))),
            // Both clocks here are `performance.now()`: the one the emote was
            // stamped on and the one the frames are drawn on.
            emote: player.emote,
            emoteT: emoteAt(player.emote, player.emoteAt, performance.now() / 1000) ?? undefined,
            cast: this.spells.poseOf(PLAYER_CASTS),
          }),
        );
        if (ent.clip) ctx.restore();
        // What this body last said, over its own head. No name drawn under it,
        // so the bubble sits where a peer's name would be.
        const mine = this.game.saidAloud;
        if (mine) this.overCellar(() => this.speechBubble(ctx, zoom, ex, ey - (ent.lift ?? 0) - FIGURE_TOP * zoom, mine.text, mine.at));
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
        this.clipTo(ctx, ent.clip);
        this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ex, ey, (g, px, py) =>
          drawPlayer(g, px, py, zoom, {
            id: 'o' + peer.id,
            phase: peer.moving ? peer.walkPhase : this.time * 6,
            moving: peer.moving && !ent.standing,
            gait: this.gaits.of('o' + peer.id, peer.x, peer.y, this.frameDt),
            facing: ent.seatFacing ?? peer.facing,
            swimming: peer.swimming,
            working: peer.working,
            driving: (ent.lift ?? 0) > 0 && !ent.standing,
            seat: ent.seat,
            tunic: peer.tunic,
            trousers: peer.trousers,
            look: peer.look,
            gear: peer.gear,
            emote: peer.emote,
            emoteT: emoteAt(peer.emote, peer.emoteAt, performance.now() / 1000) ?? undefined,
            cast: this.spells.poseOf({ kind: 'peer', id: peer.id }),
          }),
        );
        if (ent.clip) ctx.restore();
        // Somebody else is only somebody else if you can tell which one.
        if (zoom >= 0.5) this.overCellar(() => {
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
        });
        // Over the name and over whatever they are at, so a person talking
        // while they dig reads top to bottom: what they said, what they are
        // doing, who they are.
        const said = peer.said;
        if (said) this.overCellar(() => this.speechBubble(ctx, zoom, ex, ey - (FIGURE_TOP + 17) * zoom, said, peer.saidAt ?? 0));
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
        // Its age, and how rare it came into the world: a fantastic one stands three times the height of its kind.
        // And in the traces at draught size: a team that came up to the driver's chest read as foals next to the wagon (`TRACES_SCALE`).
        const big = ageDef(cr, this.game.time).scale * rarityOf(cr).size * (cr.hitchedTo !== null ? TRACES_SCALE : 1);
        const hit = this.flashOf(cr.attackedAt);
        // Drawing back for a heavy blow: its reach on the ground under it, filling as the blow comes (`WIND_UP`).
        if (cr.windup > 0) this.drawWindupReach(ctx, ent.sx, ent.sy, zoom, cr.windup);
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
            scale: big,
            label: cr.mode === 'wild' ? undefined : cr.name,
            id: cr.id,
            graze: cr.state === 'forage',
            rare: cr.rare,
          }),
        );
        // In the traces: the reins back from its head to the box of what it pulls.
        if (cr.hitchedTo !== null) this.drawReins(ctx, cr, ent.sx, ent.sy, turned, big, zoom);
        // As tall and as wide as it is drawn: a big one, or a rare one, is clicked by its head as well as its feet.
        const size = rarityOf(cr).size;
        const tall = Math.max(22 * size, (wildermonTop(def.id) ?? 0) * big);
        const wide = 10 * size;
        // And a mark over it, for the second it has to be seen in.
        if (cr.windup > 0) this.drawWindupMark(ctx, ent.sx, ent.sy - (tall + 16) * zoom, zoom);
        this.creatureHits.push({ x: ent.x, y: ent.y, left: ent.sx - wide * zoom, top: ent.sy - tall * zoom, w: 2 * wide * zoom, h: (tall + 2) * zoom, creature: cr.id });
        continue;
      }
      // The layers of a hull in front of somebody on her deck; see `takeAboard`.
      if (ent.kind === 'hull' && ent.piece && ent.view) {
        const piece = ent.piece;
        drawFurniture(ctx, ent.sx, ent.sy + (ent.drawDy ?? 0), zoom, piece.kind, !!piece.lit, dyeOf(piece) ?? undefined, this.pieceTrim(piece), ent.view, piece.material, crewOf(piece.kind) ?? undefined, ent.layer);
        continue;
      }
      if (ent.kind === 'furniture' && ent.piece) {
        const piece = ent.piece;
        const view = ent.view ?? this.viewOf(piece);
        const [W, D] = furnitureSpan(piece.kind);
        // What it covered when it was drawn, from its floor contact, for the box it is clicked by.
        let drawn: [number, number, number, number] | null = null;
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
              id: inside.id,
              rare: inside.rare,
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
        } else if (piece.kind === 'fountain') {
          /*
           * A tiered fountain: its stone in three layers with its water drawn
           * live in between them, running while it holds a litre or more to
           * draw (`drawFountain`). Clicked by all three layers together.
           */
          const [wx, wy] = furnitureCentre(piece);
          const base = this.pieceBase(piece, wx, wy);
          const fv = fallView(this.camera, this.time, this.canvas.width, this.canvas.height, HEIGHT_SCALE * zoom);
          const dark = this.game.darkness();
          const flowing = (piece.litres ?? 0) >= 1;
          if (flowing) this.fountainFoam ??= foamTexture();
          const foam = this.fountainFoam;
          let box: [number, number, number, number] | null = null;
          this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ent.sx, ent.sy, (g, px, py) => {
            const v = { ...fv, ox: fv.ox + px - ent.sx, oy: fv.oy + py - ent.sy };
            drawFountain(g, { v, x: wx, y: wy, base, key: piece.id, flowing, dark, foamTex: foam }, (layer) => {
              const b = drawFurniture(g, px, py, zoom, piece.kind, false, undefined, layer, view, piece.material, undefined, 'all', false);
              box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
            });
          });
          drawn = box;
        } else {
          /*
           * Only the first of her layers when she is drawn in layers round her
           * crew, the rest coming after them; or all of them at once under the
           * pointer, so the ring round her is round the whole of her, and the
           * layers in front then drawn again over whoever is aboard.
           */
          const crew = ent.layer === 0 ? crewOf(piece.kind) ?? undefined : undefined;
          this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ent.sx, ent.sy, (g, px, py) => {
            drawn = drawFurniture(g, px, py, zoom, piece.kind, !!piece.lit, dyeOf(piece) ?? undefined, this.pieceTrim(piece), view, piece.material, crew, crew && !hovering ? 0 : 'all', false);
          });
          // What on it moves -- an altar's stars, a banner's cloth -- over it, and outside the
          // ring under the pointer: a ring round a bloom of light is a blot.
          drawFurnitureLive(ctx, ent.sx, ent.sy, zoom, piece.kind, view, this.game.darkness(), clothInWind(piece.kind) ? this.airOf(piece) : undefined);
          // A lantern burning on a post or a pillar blooms as the dark comes on (`lamps.ts`).
          if (lampBurning(piece)) drawLampBloom(ctx, ent.sx, ent.sy, zoom, piece.kind, view, this.game.darkness());
          // Not indoors: a roof or a wall stands in front of it there, and the night cut away at its stars would be cut out of that.
          if (glowsAtNight(piece.kind) && !this.game.buildings.buildingAt(Math.floor(piece.x), Math.floor(piece.y))) {
            this.glows.push({ sx: ent.sx, sy: ent.sy, kind: piece.kind, view });
          }
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
        /*
         * Clicked by the box it stands in, or by what it is drawn as where that
         * is bigger. The box is its footprint and its height, which for most
         * things is what is drawn; a caravel lies out over the water at bow
         * and stern, half as long again as the tile she is built on, and could
         * only be clicked in her middle.
         */
        let [left, top, right, bottom] = [ent.sx - W * zoom, ent.sy - (h + D + 2) * zoom, ent.sx + W * zoom, ent.sy + (D + 2) * zoom];
        if (drawn) {
          left = Math.min(left, ent.sx + drawn[0]);
          top = Math.min(top, ent.sy + drawn[1]);
          right = Math.max(right, ent.sx + drawn[2]);
          bottom = Math.max(bottom, ent.sy + drawn[3]);
        }
        this.furnitureHits.push({ x: ent.x, y: ent.y, left, top, w: right - left, h: bottom - top, furniture: piece.id });
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
      if (ent.kind === 'waterplant' && ent.plant && this.plantFrame) {
        drawPlantUpright(ctx, ent.plant, this.plantFrame);
        continue;
      }
      if (ent.kind === 'deck' && ent.aq) {
        const box = this.aqueducts.draw(ctx, ent.aq);
        if (box) this.deckHits.push({ x: ent.x, y: ent.y, left: box.left, top: box.top, w: box.w, h: box.h, bridge: ent.aq.b.id, aq: box.shape });
        continue;
      }
      if (ent.kind === 'deck' && ent.deck?.kind === 'draw') {
        const b = this.game.bridges.get(ent.deck.id);
        // Its chains go up to a gallows, which there is none of on a building's floor (`drawGateAt`).
        if (b) drawDrawbridgeSpan(ctx, this.project, this.drawbridgeGeom(b), ent.deck.span ?? 0, zoom, this.deckLit(b), ent.deck.done,
          bridgeDone(b) && !this.game.buildings.buildingAt(b.ax, b.ay));
        this.deckHits.push({ x: ent.x, y: ent.y, left: ent.sx - 40 * zoom, top: ent.sy - 22 * zoom, w: 80 * zoom, h: 44 * zoom, bridge: ent.deck.id });
        continue;
      }
      if (ent.kind === 'deck' && ent.deck) {
        const deck = ent.deck;
        this.paint(ctx, zoom, hovering ? 'hover' : 'none', 0, ent.sx, ent.sy, (g, px, py) => drawDeck(g, px, py, zoom, deck.kind, deck.done, deck.drop, deck.shape, deck.green, ent.x * 31 + ent.y * 17));
        // The deck as it is laid: the tile at the deck's height and its edge under it, not a box round it.
        const poly = deckOutline(deck.shape?.q, ent.sx, ent.sy, zoom);
        let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
        for (const o of poly) {
          for (let k = 0; k < o.length; k += 2) {
            l = Math.min(l, o[k]);
            r = Math.max(r, o[k]);
            t = Math.min(t, o[k + 1]);
            b = Math.max(b, o[k + 1]);
          }
        }
        // And the pier under it, which the deck is laid over.
        const pier = deckPier(deck.kind, deck.drop);
        if (pier > 0) this.deckHits.push({ x: ent.x, y: ent.y, left: ent.sx - 5 * zoom, top: ent.sy + 2 * zoom, w: 10 * zoom, h: pier * zoom, bridge: deck.id });
        this.deckHits.push({ x: ent.x, y: ent.y, left: l, top: t, w: r - l, h: b - t, bridge: deck.id, poly });
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
      const grew = ent.kind === 'tree' || ent.kind === 'bush' ? grownAt(ent.x, ent.y) : 1;
      const dw = spr.w * zoom * grew;
      const dh = spr.h * zoom * grew;
      const left = ent.sx - spr.ax * zoom * grew;
      const top = ent.sy - spr.ay * zoom * grew;
      // Anything standing up throws a shadow away from the sun, long at the
      // ends of the day and gone at noon. The sprite's own contact shadow does
      // the rest, which is why this can be thrown away entirely at midday.
      if (ent.kind === 'tree' || ent.kind === 'bush') {
        this.drawTree(ctx, ent, spr, zoom, grew);
        continue;
      }
      if (this.shadow.alpha > 0.012) this.castShadow(ctx, ent.sx, ent.sy, (spr.ay - (spr.h - spr.ay)) * 0.5 * zoom + dh * 0.12);
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
    if (behind) ctx.restore();
    // Down a cellar it goes on once, over the whole of the cellar (`drawCellarView`).
    if (this.ghost && !this.inCellarPass) this.drawGhost(ctx, zoom, this.ghost);
  }

  /**
   * A tree or a bush, from a picture of it kept at exactly the size it is on
   * the screen, already leaning the way it grew and already mixed toward the
   * distance, put down on whole device pixels.
   *
   * It was rescaled and sheared afresh every frame for the wind, and those
   * are the two dearest things a picture can be put down with: a straight
   * copy of the same picture measured a seventh of the rescaled one and a
   * fifteenth of the sheared one, and a close view of a wood was spending
   * half its frame on nineteen trees. The wind is laid on over the top as a
   * few bands of the picture, each a straight copy shifted along by the lean
   * at its height -- the shear, a whole pixel at a time.
   */
  private drawTree(ctx: CanvasRenderingContext2D, ent: Entity, spr: Sprite, zoom: number, grew: number): void {
    const dw = spr.w * zoom * grew;
    const dh = spr.h * zoom * grew;
    const left = ent.sx - spr.ax * zoom * grew;
    const top = ent.sy - spr.ay * zoom * grew;
    if (this.shadow.alpha > 0.012) this.castShadow(ctx, ent.sx, ent.sy, (spr.ay - (spr.h - spr.ay)) * 0.5 * zoom + dh * 0.12);
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
    const sway = -this.lean.x * bend;
    const t = ctx.getTransform();
    // While the zoom is moving every size is new every frame, and a picture made for one frame is wasted: drawn as it was.
    if (this.hemSteady && t.b === 0 && t.c === 0 && t.a === t.d) {
      const wDev = Math.round(dw * t.a);
      const hDev = Math.round(dh * t.a);
      const pic = wDev > 0 && hDev > 0 ? this.treePicture(spr, wDev, hDev, step, Math.round(stand * hDev)) : null;
      if (pic) {
        const x = Math.round(t.a * ent.sx + t.e - pic.footX);
        const y = Math.round(t.d * ent.sy + t.f - pic.footY);
        const cv = pic.cv;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (Math.abs(sway) * hDev < 0.5) ctx.drawImage(cv, x, y);
        else {
          /*
           * Cut at the same heights whatever the wind is doing, counted up
           * from the foot, so a band moves only when its own lean crosses a
           * whole pixel. Cut where the lean put a pixel between bands, the
           * cuts moved every frame the wind changed and the seams ran up and
           * down the tree: it shook. Short enough that a full gale puts no
           * more than a pixel between one band and the next, and never more
           * than `TREE_BANDS` of them.
           */
          const band = Math.max(Math.ceil(2 / SWAY_MAX), Math.ceil(hDev / TREE_BANDS));
          const lay = (y0: number, y1: number): void => {
            if (y1 <= y0) return;
            const off = Math.round(sway * ((y0 + y1) / 2 - pic.footY));
            ctx.drawImage(cv, 0, y0, cv.width, y1 - y0, x + off, y + y0, cv.width, y1 - y0);
          };
          const foot = Math.max(0, Math.min(hDev, Math.round(pic.footY)));
          lay(foot, hDev);
          for (let y1 = foot; y1 > 0; y1 -= band) lay(Math.max(0, y1 - band), y1);
        }
        ctx.restore();
        return;
      }
    }
    const ready = this.atSize(spr.canvas, dw, dh);
    const shown = step > 0 ? this.hazed(ready, step) : ready;
    const shear = stand + sway;
    if (Math.abs(shear) * dh < 1.5) {
      ctx.drawImage(shown, left, top, dw, dh);
      return;
    }
    ctx.save();
    ctx.translate(ent.sx, ent.sy);
    ctx.transform(1, 0, shear, 1, 0, 0);
    ctx.drawImage(shown, left - ent.sx, top - ent.sy, dw, dh);
    ctx.restore();
  }

  /** The tree pictures (`drawTree`), most lately used last, and how many pixels they hold between them. */
  private treePics = new Map<string, TreePicture>();
  private treePixels = 0;
  private spriteIds = new WeakMap<HTMLCanvasElement, number>();

  private forgetTreePictures(): void {
    this.treePics.clear();
    this.treePixels = 0;
  }

  /**
   * `spr` at `w` by `h` device pixels, sheared about its foot so its crown
   * stands `lean` pixels over, and mixed `haze` steps toward the distance.
   * Null when the pictures in use this frame already fill `TREE_PIXELS`.
   */
  private treePicture(spr: Sprite, w: number, h: number, haze: number, lean: number): TreePicture | null {
    let id = this.spriteIds.get(spr.canvas);
    if (id === undefined) {
      id = ++this.spriteCount;
      this.spriteIds.set(spr.canvas, id);
    }
    const key = `${id}|${w}|${h}|${haze}|${lean}`;
    const had = this.treePics.get(key);
    if (had) {
      had.used = this.frameNo;
      this.treePics.delete(key);
      this.treePics.set(key, had);
      return had;
    }
    const s = lean / h;
    const fx = (spr.ax / spr.w) * w;
    const fy = (spr.ay / spr.h) * h;
    const lo = Math.min(0, -s * fy, s * (h - fy));
    const hi = Math.max(0, -s * fy, s * (h - fy));
    const ox = Math.ceil(-lo);
    const cw = Math.ceil(w + ox + hi) + 1;
    // Room made by putting away what has gone longest unused, and never what this frame has drawn already.
    while (this.treePixels + cw * h > TREE_PIXELS) {
      const first = this.treePics.entries().next();
      if (first.done || first.value[1].used === this.frameNo) return null;
      this.treePics.delete(first.value[0]);
      this.treePixels -= first.value[1].cv.width * first.value[1].cv.height;
    }
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = h;
    const g = cv.getContext('2d');
    if (!g) return null;
    g.setTransform(1, 0, s, 1, ox - s * fy, 0);
    g.drawImage(spr.canvas, 0, 0, w, h);
    if (haze > 0) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = (haze / HAZE_STEPS) * 0.62;
      g.fillStyle = css(this.sky.far);
      g.fillRect(0, 0, cw, h);
    }
    const pic: TreePicture = { cv, footX: ox + fx, footY: fy, used: this.frameNo };
    this.treePics.set(key, pic);
    this.treePixels += cw * h;
    return pic;
  }

  private spriteCount = 0;

  /** The ghost of what is being set down, over everything, and washed red where it will not go. */
  private drawGhost(ctx: CanvasRenderingContext2D, zoom: number, ghost: Ghost): void {
    const cam = this.camera;
    const world = this.game.world;
    /*
     * Over a cellar you are looking into, a piece goes down on its floor and
     * a way down stands in it, and both are drawn with the cellar; from up
     * top, a way down is the hole it would go down through.
     */
    const below = this.cellarFrame && this.game.buildings.cellarDone(ghost.x, ghost.y)
      && (ghost.kind === 'furniture' || ghost.level === 0);
    if (below !== this.inCellarPass) return;
    ctx.save();
    ctx.globalAlpha = 0.6;
    if (ghost.kind === 'furniture') {
      const [w, h] = furnitureFootprint(ghost.piece, ghost.facing);
      const wx = ghost.x + (ghost.sx + w / 2) / SUBTILES;
      const wy = ghost.y + (ghost.sy + h / 2) / SUBTILES;
      const px = cam.worldToScreenX(wx, wy);
      const py = cam.worldToScreenY(wx, wy, below ? cellarFloorHeight(this.game, ghost.x, ghost.y) : this.pieceBase({ kind: ghost.piece }, wx, wy));
      drawFurniture(ctx, px, py, zoom, ghost.piece, false, undefined, undefined, pieceView(ghost.facing, cam.rotation), ghost.material);
      if (!ghost.ok) {
        const [W, D] = furnitureSpan(ghost.piece);
        ctx.fillStyle = 'rgba(214, 58, 42, 0.5)';
        ctx.beginPath();
        ctx.ellipse(px, py, W * zoom, D * zoom, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const hand = ghost.floorKind === 'stairs' ? ghost.hand : undefined;
      const tile: FloorTile = { building: 0, level: ghost.level, x: ghost.x, y: ghost.y, material: ghost.material, kind: ghost.floorKind, facing: ghost.side, ...(hand ? { hand } : {}), ...floorBill(ghost.material, ghost.floorKind, undefined, hand) };
      const base = this.game.buildings.buildingAt(ghost.x, ghost.y)?.deck ?? world.getHeight(ghost.x, ghost.y);
      if (ghost.level === 0 && !below && this.game.buildings.cellarDone(ghost.x, ghost.y)) this.drawOpening(tile, ghost.x, ghost.y, base, 0.6);
      else if (ghost.floorKind === 'stairs') this.drawStairs(tile, ghost.x, ghost.y, base, 0.6);
      else this.drawLadder(tile, ghost.x, ghost.y, base, 0.6, ghost.level > 0);
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
    if (!bld.buildingAt(p.tileX, p.tileY) && !(p.level > 0 && bld.jettyAt(p.tileX, p.tileY))) return null;
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
    const ground = w.getHeight(x, y);
    // A building on piers stands every storey on its deck (`piers.ts`); anything else on the ground.
    const base = building?.deck ?? ground;
    // A tile out past a footprint carrying a storey's floor: a jetty, at its building's floor height (`frame.ts`).
    const jetty = building ? undefined : bld.jettyAt(x, y);
    const floorBase = jetty ? (jettyBase(this.game, jetty, x, y) ?? base) : base;
    // One border across the top of the screen and one down a side, whichever
    // way we are looking: between them every wall on the island is claimed by
    // exactly one tile, and claimed by the tile in front of it.
    const backA: Border = borderOf(x, y, V.back[0]);
    const backB: Border = borderOf(x, y, V.back[1]);
    const playerLevel = this.game.player.level;
    const maxLevels = building ? building.levels : Math.max(1, this.maxLevelsAround(x, y));
    const { cutaway } = this.game.settings;
    // Looking into a cellar, a building with none under it is looked at as its ground floor is.
    const viewLevel = this.game.settings.viewLevel === null ? null : Math.max(0, this.game.settings.viewLevel);
    // And one over a cellar is taken off, all of it, its jetties with it: only another building's wall on this tile's borders stands.
    const gone = (!!building && this.cut.has(building.id)) || (!!jetty && this.cut.has(jetty.id));
    if (jetty && !gone) this.jettyShade(x, y, jetty);
    // Floors, stairs and ladders for each storey, walls of each storey, then the roof one level up.
    let columnsTo = -1;
    for (let level = 0; level <= maxLevels; level++) {
      /*
       * A ladder goes on after the walls of the storey it opens into: its
       * stiles stand up past the floor, in front of a wall on the far side
       * of the hatch, which laid after it covered them.
       */
      let late: (() => void) | null = null;
      // Under the ground floor of a tile on piers, the piers: see `piers.ts`.
      if (level === 0 && building && !gone && bld.pierTiles.size && bld.onPiers(x, y)) this.drawPiers(x, y, V);
      const host = gone ? undefined : building ?? (level > 0 ? jetty : undefined);
      if (host) {
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
          // A way down from the ground floor is a hole in it, and only the top of the way down shows: see `drawOpening`.
          // Under a finished roof drawn whole over it -- you are not standing under it, nor looking into the storey --
          // it is not seen, and not drawn.
          const down = level === 0 && climb && !!bld.cellar(x, y);
          const lid = down && viewLevel === null && !this.roomTiles?.has(`${x},${y}`) ? bld.roofAt(host.levels, x, y) : undefined;
          if (down) {
            if (!lid || !isDone(lid)) this.drawOpening(floor, x, y, base, alpha);
          } else switch (floorKind(floor)) {
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
              if (roofShapeOf(host) === 'flat') this.drawDeck(floor, x, y, floorBase, alpha);
              break;
            default:
              // A jetty overhangs on its joists or its corbels (`framing.ts`).
              if (jetty) this.drawJettyUnder(floor, jetty, x, y, floorBase, alpha);
              this.drawFloor(floor, x, y, floorBase, alpha);
          }
        }
      }
      if (level >= maxLevels || (viewLevel !== null && level > viewLevel)) {
        late?.();
        // A railing round a flat roof stands on the roof's own level (`frame.ts`).
        if (level === maxLevels && !gone && (viewLevel === null || level <= viewLevel)) this.drawTerrace(x, y, level, [backA, backB], building ?? jetty, inFront);
        if (level >= maxLevels) break;
        continue;
      }
      // The shade of every wall round the tile, on the ground or on the floor
      // of the storey, before any wall of the storey stands on it -- on a
      // floor, that is: a hatch or a flight has none to take it.
      const slot = level ? bld.floor(level, x, y) : undefined;
      // Not on a jetty's floor, which stands at its building's height and not its ground's.
      if (!gone && (level === 0 || (!jetty && slot && (floorKind(slot) === 'floor' || floorKind(slot) === 'roof')))) this.groundShade(x, y, level, V);
      // The foot of a column put up before this tile, which its ground or floor has just covered.
      if (bld.columns.size) this.columnFootOn(x, y, V, level);
      for (const border of [backA, backB]) {
        const wall = bld.wallOnBorder(level, border);
        if (!wall) {
          /*
           * No wall here, planned or built. If the border is the edge of a
           * plan it is marked out instead, so a building that is nothing but
           * a footprint still looks like one.
           */
          const plan = bld.edgeOf(border);
          // A side with a column at an end of it is built, not marked out: it is open on purpose (`framing.ts`).
          if (plan && !(cutaway && building?.id !== plan.id) && !this.cut.has(plan.id) && !this.columnEnds(border)) {
            const [tx, ty] = border.dir === 'h'
              ? [border.x, bld.buildingAt(border.x, border.y) === plan ? border.y : border.y - 1]
              : [bld.buildingAt(border.x, border.y) === plan ? border.x : border.x - 1, border.y];
            // A finished deck on piers is built, not marked out: its edge is the edge of the deck.
            if (level === 0 && bld.pierTiles.size && this.game.pierDeckAt(tx, ty) !== null) continue;
            // Nothing stands in the air: an upper storey is only marked out
            // where there is a floor under it to mark out. Nor where the
            // storey goes on out over its own jetty, open to it (`frame.ts`).
            const [ox, oy] = border.dir === 'h' ? [tx, ty === border.y ? border.y - 1 : border.y] : [tx === border.x ? border.x - 1 : border.x, ty];
            if ((level === 0 || bld.floor(level, tx, ty)) && !(level > 0 && bld.floor(level, ox, oy)?.building === plan.id)) {
              this.drawScaffold(border, plan.deck ?? this.edgeGround(border), level, inside?.id === plan.id && inFront ? 0.35 : 1);
            }
          }
          // Two columns with no wall between them carry a beam (`framing.ts`).
          if (bld.columns.size) this.drawBeamOn(border, level, inFront);
          continue;
        }
        /*
         * Every wall is drawn once, by whichever tile has it as a back edge.
         * When that tile is not part of the wall's own building the wall
         * stands between the viewer and the inside: those are the ones a
         * cutaway takes away.
         */
        // A jetty's tile is its building's on the storeys it is floored on.
        const own = building ?? (level > 0 && jetty && bld.floor(level, x, y)?.building === jetty.id ? jetty : undefined);
        // A railing hides nothing behind it, and a balcony with its railings cut away is a shelf.
        if (cutaway && own?.id !== wall.building && wall.type !== 'railing' && !this.edgeOn(border)) continue;
        if (this.cut.has(wall.building)) continue;
        const dim = inFront && this.wallsMyRoom(border);
        // A railing hides little, and the edge you stand at reads as railed: it is let go no further than this.
        const alpha = dim ? (wall.type === 'railing' ? 0.7 : 0.3) : 1;
        // A building on piers stands its walls on its deck; a jetty's stand at its building's floor (`jettyWallBase`).
        const at = this.jettyWallBase(wall, border, (wall.building ? bld.list.get(wall.building)?.deck : undefined) ?? this.edgeGround(border));
        // Drawn after a pilaster it runs out from, it is drawn from the pilaster's face on.
        const guard = this.pilasterGuard(wall, border, at, V, x, y);
        if (guard) this.guardedWall(wall, border, at, alpha, guard);
        else this.drawWall(wall, border, at, alpha);
        // And over a railing or a half wall between two columns, the beam they carry.
        if (bld.columns.size && WALL_TYPE_BY_ID.get(wall.type)?.low) this.drawBeamOn(border, level, inFront);
      }
      late?.();
      // The storey's columns on the corner this tile draws (`cornerClaim`), before the floor or the deck over them.
      if (bld.columns.size) this.drawColumnsAt(x, y, V, level, level);
      columnsTo = level;
    }
    // And any on storeys this tile's own did not reach.
    if (bld.columns.size) this.drawColumnsAt(x, y, V, columnsTo + 1, TOP_LEVELS);
  }

  /**
   * Whether a border runs straight away from the camera, so that a wall on it
   * has no face on the screen: at four of the eight turns, half the walls.
   * Such a wall stands between the viewer and nothing, so the cutaway leaves
   * it -- which side of its own line it is drawn from is a tie the sums
   * break either way, and the one it broke toward the street was taken away
   * with everything standing out of it, a shop counter's board and awning
   * among them.
   */
  private edgeOn(border: Border): boolean {
    const cam = this.camera;
    const [nx, ny] = border.dir === 'h' ? [0, 1] : [-1, 0];
    return Math.abs(cam.rotateX(nx, ny) + cam.rotateY(nx, ny)) < 1e-6;
  }

  /**
   * A tile on piers as its painter takes it (`piers.ts`), or null for one
   * that has no deck to stand under. Its open sides are the ones with no tile
   * of the building on piers beyond them; each corner's post is drawn by the
   * last of the building's tiles on piers round that corner to be drawn,
   * after the ground of every one of them, and kept off the decks of the
   * others, which were laid before it and stand over it (`hide`). `hide` is
   * only worked out when `withHide`, for the post; the feet do without it.
   */
  private pierTileAt(x: number, y: number, V: View, withHide: boolean): PierTile | null {
    const g = this.game;
    const bld = g.buildings;
    const b = bld.buildingAt(x, y);
    const deck = b?.deck;
    if (!b || deck == null) return null;
    const world = g.world;
    const mine = (tx: number, ty: number): boolean => bld.onPiers(tx, ty) && bld.buildingAt(tx, ty)?.id === b.id;
    const corners: Array<[number, number]> = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
    const posts = corners.map(([cx, cy]) => {
      const owner = this.drawnLast(V, cx, cy, mine);
      return !!owner && owner[0] === x && owner[1] === y;
    });
    const hide = corners.map(([cx, cy], i) => {
      if (!withHide || !posts[i]) return null;
      const decks: number[][] = [];
      for (const [tx, ty] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]] as Array<[number, number]>) {
        if ((tx !== x || ty !== y) && mine(tx, ty) && g.pierDeckAt(tx, ty) !== null) decks.push(slabOutline(this.camera, tx, ty, deck, deck - FLOOR_DEEP));
      }
      return decks.length ? decks : null;
    });
    const open = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => !mine(x + dx, y + dy));
    const floor = bld.floor(0, x, y);
    const planned = floor && floorKind(floor) === 'floor' ? floor : undefined;
    const water = world.hasWater(x, y) ? world.surfaceAt(x, y) : null;
    return {
      x, y, deck, ground: world.tileCorners(x, y), water,
      sea: water !== null && world.water?.levelAt(x, y) == null,
      open, posts, hide, material: planned?.material ?? null, progress: planned ? progressOf(planned) : 0,
      lit: g.vision.state(x, y) === VISIBLE,
      // The tile's own ground was edged a moment ago, half its width over the shade of the decks beside it.
      seam: Math.max(1, this.groundEdge) / 2,
    };
  }

  /** Of the tiles round a corner that pass `keep`, the one drawn last this frame: on the deepest line, and furthest along it. */
  private drawnLast(V: View, cx: number, cy: number, keep: (tx: number, ty: number) => boolean): [number, number] | null {
    const order = (tx: number, ty: number): number => depthOf(V, tx, ty) * 1e6 + V.e[0] + V.e[1] * tx + V.e[2] * ty;
    let best: [number, number] | null = null;
    for (const [tx, ty] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]] as Array<[number, number]>) {
      if (keep(tx, ty) && (!best || order(tx, ty) > order(best[0], best[1]))) best = [tx, ty];
    }
    return best;
  }

  /** The piers under a tile on piers, before its deck: see `piers.ts`. */
  private drawPiers(x: number, y: number, V: View): void {
    const p = this.pierTileAt(x, y, V, true);
    if (p) drawPierTile(this.canvas.ctx, this.camera, p);
  }

  /**
   * The water round the feet of the posts of a tile on piers, worked out as
   * its water goes down, before anything stands on it: each foot is laid
   * with the water of the tile in front of its corner, the last of the four
   * round it to be drawn -- now, if that is this tile, and otherwise when
   * that tile's water is down -- and never under the decks round it, in whose
   * shade it stands.
   */
  private pierFeetHere(x: number, y: number, V: View): void {
    const p = this.pierTileAt(x, y, V, false);
    if (!p || p.water === null) return;
    const bld = this.game.buildings;
    const cam = this.camera;
    for (const f of pierFeetOf(cam, p)) {
      const cx = Math.round(f.wx), cy = Math.round(f.wy);
      for (const [tx, ty] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]] as Array<[number, number]>) {
        if (!bld.onPiers(tx, ty)) continue;
        const q: number[] = [];
        for (const [qx, qy] of [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]]) q.push(cam.worldToScreenX(qx, qy), cam.worldToScreenY(qx, qy, f.h));
        f.under.push(q);
      }
      // A post with decks all round it stands in their shade, and nothing laps round it that shows.
      if (f.under.length === 4) continue;
      const front = this.drawnLast(V, cx, cy, () => true) ?? [x, y];
      const key = `${front[0]},${front[1]}`;
      const row = this.pierFeet.get(key);
      if (row) row.push(f);
      else this.pierFeet.set(key, [f]);
    }
  }

  /**
   * A name, or what somebody said, over a body: at once up top, and down in a
   * cellar once the whole of it is laid. A cellar is laid a line of the ground
   * at a time, and a flight standing in a nearer line went on over a name
   * that stood up into it.
   */
  private overCellar(draw: () => void): void {
    if (this.inCellarPass) this.cellarWords.push(draw);
    else draw();
  }

  /**
   * The cellar, from down in it, over everything: the country laid back
   * under a veil, then every tile of every cellar a line at a time, back to
   * front -- its floor, the far sides of the dig, the way up, the near sides
   * cut down to a kerb, and what is down there, standing and lying -- and
   * the cellar's own dark over the lot, with what burns down there and the
   * daylight down the way in taken out of it. What the eye down there does
   * not reach (`Vision.cellarState`) is drawn as it is remembered: the room,
   * and nothing in it.
   */
  private drawCellarView(ctx: CanvasRenderingContext2D, zoom: number): void {
    const g = this.game;
    const bld = g.buildings;
    const cam = this.camera;
    const V = cam.view;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.fillStyle = CELLAR_VEIL;
    ctx.fillRect(0, 0, W, H);
    const tiles = cellarOrder(g, V, this.cellarTiles);
    const { back, front } = sidesOf(V);
    const fogged = g.settings.fog;
    this.cellarHulls.length = 0;
    // What the cellars' own drawing was laid for: the view, and every tile of every cellar as it is dug.
    let stamp = `${cam.rotation}|${zoom}|${this.canvas.dpr}`;
    for (const t of tiles) {
      stamp += `;${t.x},${t.y},${t.dug},${t.building}`;
      // And the flight standing in it, for the shade it throws on the floor.
      const f = bld.floor(0, t.x, t.y);
      if (f && floorKind(f) === 'stairs') stamp += (f.facing ?? 's') + (f.hand ?? '');
    }
    if (stamp !== this.cellarStamp) {
      this.cellarStamp = stamp;
      this.cellarCache.clear();
    }
    /*
     * Ground standing in front of any of a cellar, within the three lines of
     * the screen a storey of it covers, is cut down to the cellar's floor and
     * a hand over it, so the room behind it shows: its sides there are drawn
     * cut (`cutFace`). Ground with nothing of a cellar behind it keeps its
     * full height, the dig's far sides standing up to the ground floor.
     */
    const eOf = (x: number, y: number): number => V.e[0] + V.e[1] * x + V.e[2] * y;
    const span = V.staggered ? 2 : 1;
    const cuts = new Map<string, number | null>();
    const cutTo = (ex: number, ey: number, building: number): number | null => {
      const key = `${ex},${ey},${building}`;
      const had = cuts.get(key);
      if (had !== undefined) return had;
      let out: number | null = null;
      if (!bld.cellar(ex, ey)) {
        const d0 = depthOf(V, ex, ey);
        const e0 = eOf(ex, ey);
        for (let dy = -3; dy <= 3 && out === null; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            // Only the same cellar: another one behind is another room, and its own sides are its own.
            const behind = bld.cellar(ex + dx, ey + dy);
            if (!behind || behind.building !== building) continue;
            const dd = d0 - depthOf(V, behind.x, behind.y);
            if (dd > 0 && dd <= 3 && Math.abs(eOf(behind.x, behind.y) - e0) < span) {
              out = g.world.getHeight(behind.x, behind.y) - CELLAR_DEPTH + KERB;
              break;
            }
          }
        }
      }
      cuts.set(key, out);
      return out;
    };
    // What was hit-boxed up top before the cellar went over it: whatever the cellar covers is not there to click.
    const hitLists = [this.creatureHits, this.peerHits, this.crateHits, this.fireHits, this.smelterHits, this.kilnHits,
      this.furnitureHits, this.anvilHits, this.postHits, this.trapHits, this.deckHits];
    const upTop = hitLists.map((l) => l.length);
    this.inCellarPass = true;
    for (let i = 0; i < tiles.length;) {
      const d = depthOf(V, tiles[i].x, tiles[i].y);
      this.ents.length = 0;
      this.entN = 0;
      for (; i < tiles.length && depthOf(V, tiles[i].x, tiles[i].y) === d; i++) {
        const t = tiles[i];
        const { x, y } = t;
        const top = g.world.getHeight(x, y);
        const F = top - t.dug;
        // The floor of the dig at its deepest: what a tile only part dug stands on, cut.
        const deep = Math.min(F, top - CELLAR_DEPTH);
        const sx = cam.worldToScreenX(x + 0.5, y + 0.5);
        if (sx < -HALF_W * 2 * zoom || sx > W + HALF_W * 2 * zoom) continue;
        if (cam.worldToScreenY(x + 0.5, y + 0.5, deep) < -HALF_H * 2 * zoom || cam.worldToScreenY(x + 0.5, y + 0.5, top + 12) > H + HALF_H * 2 * zoom) continue;
        const hull = this.cellarHull(x, y, deep - UNDER, top);
        const floor = ([[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]] as Array<[number, number]>)
          .map(([px, py]): [number, number] => [cam.worldToScreenX(px, py), cam.worldToScreenY(px, py, F)]);
        this.cellarHulls.push({ x, y, hull, floor });
        // Which sides are the ground, and which go on into more of the same cellar.
        const same = (side: Side): CellarTile | undefined => {
          const n = bld.cellar(x + OUT[side][0], y + OUT[side][1]);
          return n && n.building === t.building ? n : undefined;
        };
        const against = (['n', 'e', 's', 'w'] as Side[]).filter((side) => !same(side));
        const anchor: [number, number] = [cam.worldToScreenX(x, y), cam.worldToScreenY(x, y, top)];
        const flight = bld.floor(0, x, y);
        this.cellarLayer(`${x},${y}:under`, hull, anchor, (c) => {
          cellarFloor(c, g, x, y, F, against);
          // Under a staircase, the floor in its shade: a flight seen from its head end stands up off the floor and not on it.
          if (flight && floorKind(flight) === 'stairs') flightShade(c, x, y, F, flight.facing ?? 's');
          for (const side of back) {
            const n = same(side);
            if (!n) {
              const cut = cutTo(x + OUT[side][0], y + OUT[side][1], t.building);
              if (cut === null) earthFace(c, faceOn(g, x, y, side, F, 1, true));
              else cutFace(c, g, x, y, side, F, cut, false);
              // The next building's cellar across it: square on, the earth between the two is edge on.
              if (bld.cellar(x + OUT[side][0], y + OUT[side][1])) earthEnd(c, x, y, side, F, top);
              continue;
            }
            // More of the cellar, not dug so deep: the face of what is left standing, up to its floor.
            const nF = cellarFloorHeight(g, x + OUT[side][0], y + OUT[side][1]);
            if (nF > F + 0.01) {
              const face = faceOn(g, x, y, side, F, 1, false);
              face.hi0 = nF;
              face.hi1 = nF;
              earthFace(c, face);
            }
          }
        });
        // The way up out of it, from its floor to the ground floor, standing in this tile: cut where everything over
        // the ground floor is, its rails and a ladder's head with it.
        if (flight && (floorKind(flight) === 'stairs' || floorKind(flight) === 'ladder')) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(hull[0][0], hull[0][1]);
          for (let k = 1; k < hull.length; k++) ctx.lineTo(hull[k][0], hull[k][1]);
          ctx.closePath();
          ctx.clip();
          if (floorKind(flight) === 'ladder') this.drawLadder(flight, x, y, top, 1, false);
          else this.drawStairs(flight, x, y, top, 1);
          ctx.restore();
        }
        const cutNear = front.filter((side) => !same(side));
        if (cutNear.length) this.cellarLayer(`${x},${y}:over`, hull, anchor, (c) => {
          for (const side of cutNear) cutFace(c, g, x, y, side, deep - UNDER, F + KERB, true);
        });
        // A tile only part dug is seen when the room beside it is: its face and its top are what you see of it.
        const seen = !fogged || g.vision.cellarState(x, y) === VISIBLE
          || (t.dug < CELLAR_DEPTH && (['n', 'e', 's', 'w'] as Side[]).some((side) => !!same(side) && g.vision.cellarState(x + OUT[side][0], y + OUT[side][1]) === VISIBLE));
        if (seen) this.takeCellarThings(x, y, F);
        else {
          // Remembered: the room as it was, and nothing in it -- its floor under the cold wash remembered ground has.
          ctx.beginPath();
          ctx.moveTo(floor[0][0], floor[0][1]);
          for (let k = 1; k < 4; k++) ctx.lineTo(floor[k][0], floor[k][1]);
          ctx.closePath();
          ctx.fillStyle = FOG_COLOR;
          ctx.fill();
        }
      }
      if (this.ents.length) this.drawEntities(ctx, zoom);
    }
    // The names over everybody down here, over everything in the cellar.
    for (const draw of this.cellarWords) draw();
    this.cellarWords.length = 0;
    // What is being set down down here, over the whole of it, once.
    if (this.ghost) this.drawGhost(ctx, zoom, this.ghost);
    this.inCellarPass = false;
    hitLists.forEach((list, n) => {
      let k = 0;
      for (let i = 0; i < list.length; i++) {
        const h = list[i];
        if (i < upTop[n] && this.cellarHulls.some((c) => inOutline(c.hull, h.left + h.w / 2, h.top + h.h / 2))) continue;
        list[k++] = h;
      }
      list.length = k;
    });
    this.cellarDark(ctx, zoom);
  }

  /**
   * Lay a cellar tile's own drawing through the cache: drawn into a canvas
   * of its own the first time it is wanted, over the box of the tile's
   * outline, and put down every frame after at the same place against the
   * tile's corner, on a whole pixel so it stays sharp. What a cellar costs a
   * frame is then a few blits and what moves in it.
   */
  private cellarLayer(key: string, hull: Array<[number, number]>, anchor: [number, number], draw: (c: CellarCanvas) => void): void {
    let had = this.cellarCache.get(key);
    if (!had) {
      had = this.layOut(hull, anchor, draw);
      this.cellarCache.set(key, had);
    }
    this.putDown(had, anchor, 1);
  }

  /** A drawing laid into a canvas of its own, over the box round `hull` and a margin, against `anchor`. */
  private layOut(hull: Array<[number, number]>, anchor: [number, number], draw: (c: CellarCanvas) => void): CellarLaid {
    const dpr = this.canvas.dpr;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [hx, hy] of hull) {
      if (hx < x0) x0 = hx;
      if (hx > x1) x1 = hx;
      if (hy < y0) y0 = hy;
      if (hy > y1) y1 = hy;
    }
    x0 = Math.floor(x0) - 4;
    y0 = Math.floor(y0) - 4;
    const w = Math.ceil(x1) + 4 - x0, h = Math.ceil(y1) + 4 - y0;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w * dpr));
    cv.height = Math.max(1, Math.ceil(h * dpr));
    const lay = cv.getContext('2d') as CanvasRenderingContext2D;
    lay.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    lay.lineJoin = 'round';
    draw({ ctx: lay, cam: this.camera, zoom: this.camera.zoom, light: (ux, uy) => this.faceLight(ux, uy) });
    return { cv, x0, y0, ax: anchor[0], ay: anchor[1], w, h };
  }

  /** Put a laid drawing down where its anchor has gone since, as the camera moved: on a whole pixel, so it stays sharp. */
  private putDown(had: CellarLaid, anchor: [number, number], alpha: number): void {
    const dpr = this.canvas.dpr;
    const dx = Math.round((anchor[0] - had.ax) * dpr) / dpr;
    const dy = Math.round((anchor[1] - had.ay) * dpr) / dpr;
    const ctx = this.canvas.ctx;
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.drawImage(had.cv, had.x0 + dx, had.y0 + dy, had.w, had.h);
    if (alpha < 1) ctx.globalAlpha = 1;
  }

  /**
   * A cellar tile's outline on the screen, from its floor to the ground
   * floor over it: the box it is, a hair wider than the tile so the kerb
   * round it is in it too, as the hull of its eight corners.
   */
  private cellarHull(x: number, y: number, floor: number, top: number): Array<[number, number]> {
    const cam = this.camera;
    const pts: Array<[number, number]> = [];
    for (const [u, v] of [[-0.1, -0.1], [1.1, -0.1], [1.1, 1.1], [-0.1, 1.1]]) pts.push([cam.worldToScreenX(x + u, y + v), cam.worldToScreenY(x + u, y + v, floor - 0.6)]);
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) pts.push([cam.worldToScreenX(x + u, y + v), cam.worldToScreenY(x + u, y + v, top + 1)]);
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower: Array<[number, number]> = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper: Array<[number, number]> = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
  }

  /** What is down in a cellar on one tile, stood on its floor at `floor`: things lying, pieces, crates, people. */
  private takeCellarThings(x: number, y: number, floor: number): void {
    const g = this.game;
    const cam = this.camera;
    const pile = g.groundAt(x, y, CELLAR_LEVEL);
    if (pile.length) {
      const e = this.take('pile', x, y, cam.worldToScreenX(x + 0.5, y + 0.5), cam.worldToScreenY(x + 0.5, y + 0.5, floor), pileSprite());
      let best = 0;
      for (const it of pile) if ((it.rare ?? 0) > best) best = it.rare ?? 0;
      if (best) e.rare = best;
    }
    if (g.anythingPlaced(x, y)) {
      for (const fu of g.furnitureOnTile(x, y)) {
        if ((fu.level ?? 0) >= 0) continue;
        const [wx, wy] = furnitureCentre(fu);
        const fe = this.take('furniture', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, floor), null);
        fe.piece = fu;
        fe.view = this.viewOf(fu);
        if (fu.rare) fe.rare = fu.rare;
      }
      for (const crate of g.cratesOnTile(x, y)) {
        if ((crate.level ?? 0) >= 0 || g.rackAt(crate.x, crate.y, crate.sx, crate.sy, crate.level)) continue;
        const [wx, wy] = crateCentre(crate);
        const ce = this.take('crate', x, y, cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, floor), crateSprite(crate.kind));
        ce.crateId = crate.id;
        if (crate.rare) ce.rare = crate.rare;
      }
    }
    if (g.roster.size) {
      for (const peer of g.roster.atTile(x, y)) {
        if (peer.level >= 0) continue;
        const [px, py] = g.roster.drawnAt(peer);
        this.take('peer', x, y, cam.worldToScreenX(px, py), cam.worldToScreenY(px, py, this.footAt(px, py) + peer.level * WALL_HEIGHT), null).peer = peer;
      }
    }
    const p = g.player;
    if (p.level < 0 && p.tileX === x && p.tileY === y) {
      this.take('player', x, y, cam.worldToScreenX(p.x, p.y), cam.worldToScreenY(p.x, p.y, this.footAt(p.x, p.y) + p.visualLevel * WALL_HEIGHT), null);
    }
  }

  /**
   * A cellar's dark: laid over every tile of it that was drawn, at every
   * hour, with what burns down there and the daylight down the way in taken
   * out of it, as the night's wash has the lights taken out of it up top,
   * and a warm cast where a flame's light falls.
   */
  private cellarDark(ctx: CanvasRenderingContext2D, zoom: number): void {
    if (!this.cellarHulls.length) return;
    const g = this.game;
    const cam = this.camera;
    const room = new Path2D();
    // And the box round all of it on the screen: the dark is laid in that and no more, so it costs what the cellar covers.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { hull } of this.cellarHulls) {
      room.moveTo(hull[0][0], hull[0][1]);
      for (let k = 1; k < hull.length; k++) room.lineTo(hull[k][0], hull[k][1]);
      room.closePath();
      for (const [hx, hy] of hull) {
        if (hx < x0) x0 = hx;
        if (hx > x1) x1 = hx;
        if (hy < y0) y0 = hy;
        if (hy > y1) y1 = hy;
      }
    }
    const lights = g.cellarLights();
    const at = (l: { x: number; y: number }): [number, number] => {
      const h = cellarFloorHeight(g, Math.floor(l.x), Math.floor(l.y)) + 8;
      return [cam.worldToScreenX(l.x, l.y), cam.worldToScreenY(l.x, l.y, h)];
    };
    const layer = this.nightLayer();
    const bx = Math.max(0, Math.floor(x0) - 2), by = Math.max(0, Math.floor(y0) - 2);
    const bw = Math.min(layer.width, Math.ceil(x1) + 2) - bx, bh = Math.min(layer.height, Math.ceil(y1) + 2) - by;
    if (bw <= 0 || bh <= 0) return;
    const nc = layer.getContext('2d') as CanvasRenderingContext2D;
    nc.setTransform(1, 0, 0, 1, 0, 0);
    nc.globalCompositeOperation = 'source-over';
    nc.clearRect(bx, by, bw, bh);
    nc.save();
    nc.beginPath();
    nc.rect(bx, by, bw, bh);
    nc.clip();
    nc.fillStyle = `rgba(${CELLAR_DARK_INK}, ${CELLAR_DARK})`;
    nc.fill(room, 'nonzero');
    nc.globalCompositeOperation = 'destination-out';
    for (const l of lights) {
      const [sx, sy] = at(l);
      const r = Math.max(8, l.radius * HALF_W * zoom * this.flicker(l));
      // Falling off fast from the flame: what you carry lights what is round you, and leaves the far side of a room in the dark.
      const grad = nc.createRadialGradient(sx, sy, 0, sx, sy, r);
      for (const [at, k] of CELLAR_FALL) grad.addColorStop(at, `rgba(0,0,0,${(l.strength * k).toFixed(3)})`);
      nc.fillStyle = grad;
      nc.beginPath();
      nc.arc(sx, sy, r, 0, Math.PI * 2);
      nc.fill();
    }
    nc.restore();
    nc.globalCompositeOperation = 'source-over';
    ctx.drawImage(layer, bx, by, bw, bh, bx, by, bw, bh);
    if (!lights.length) return;
    ctx.save();
    ctx.clip(room);
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      const [sx, sy] = at(l);
      const r = Math.max(8, l.radius * HALF_W * zoom * this.flicker(l));
      const cast = l.cast ?? '255, 186, 92';
      const warm = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      warm.addColorStop(0, `rgba(${cast}, ${(l.castAlpha ?? 0.16 * l.strength).toFixed(3)})`);
      warm.addColorStop(1, `rgba(${cast}, 0)`);
      ctx.fillStyle = warm;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * A way down into a cellar, from up top: a hole in the ground floor, and
   * what can be seen down it -- the far sides of the hole going down out of
   * the light, the cellar floor at the bottom where it shows, and the flight
   * or the ladder going down. Everything below the ground floor shows only
   * through the hole; what stands up out of it, a rail or a ladder's head,
   * shows over it.
   */
  private drawOpening(floor: FloorTile, x: number, y: number, base: number, alpha: number): void {
    const ctx = this.canvas.ctx;
    const cam = this.camera;
    const g = this.game;
    const w = g.world;
    const bld = g.buildings;
    const hole: Array<[number, number]> = ([[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]] as Array<[number, number]>)
      .map(([cx, cy]) => [cam.worldToScreenX(cx, cy), cam.worldToScreenY(cx, cy, w.getHeight(cx, cy))]);
    const holePath = (): void => {
      ctx.beginPath();
      ctx.moveTo(hole[0][0], hole[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(hole[i][0], hole[i][1]);
      ctx.closePath();
    };
    // The sides of the hole that are the ground, and the walls standing on its edges.
    const own = bld.cellar(x, y)?.building;
    const against: Side[] = [];
    let walls = '';
    for (const side of ['n', 'e', 's', 'w'] as Side[]) {
      const [ox, oy] = OUT[side];
      if (!bld.sameCellar(own, x + ox, y + oy)) against.push(side);
      const wall = bld.wall(0, x, y, side);
      walls += wall && isDone(wall) ? side : '-';
      const next = bld.floor(0, x + ox, y + oy);
      if (next && floorKind(next) === 'stairs') walls += (next.facing ?? 's') + (next.hand ?? '');
    }
    // Inside the hole, laid once: everything under the ground floor's plane, each part shaded by how deep it is.
    const stamp = `${cam.rotation}|${cam.zoom}|${this.canvas.dpr}|${bld.cellar(x, y)?.dug}|${floor.kind}${floor.facing}${floor.hand ?? ''}${floor.material}`
      + `${floor.dye ?? ''}${isDone(floor) ? 1 : 0}|${against.join('')}|${walls}`;
    const key = `${x},${y}`;
    const anchor: [number, number] = hole[0];
    let had = this.holeCache.get(key);
    if (!had || had.stamp !== stamp) {
      if (this.holeCache.size > 256) this.holeCache.clear();
      had = { ...this.layOut(hole, anchor, (c) => this.holeInside(c, floor, x, y, base, hole, against)), stamp };
      this.holeCache.set(key, had);
    }
    this.putDown(had, anchor, alpha);
    // What stands up out of it, over the screen above the hole and not in it: the rails, and a ladder's head.
    // The hole's upper edges: from its leftmost corner over its top one to its rightmost, the higher of two level with each other.
    let hi = 0, left = 0, right = 0;
    for (let i = 1; i < 4; i++) {
      const [hx, hy] = hole[i];
      if (hy < hole[hi][1]) hi = i;
      if (hx < hole[left][0] - 1e-6 || (Math.abs(hx - hole[left][0]) <= 1e-6 && hy < hole[left][1])) left = i;
      if (hx > hole[right][0] + 1e-6 || (Math.abs(hx - hole[right][0]) <= 1e-6 && hy < hole[right][1])) right = i;
    }
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(hole[left][0], -1e5);
    ctx.lineTo(hole[left][0], hole[left][1]);
    ctx.lineTo(hole[hi][0], hole[hi][1]);
    ctx.lineTo(hole[right][0], hole[right][1]);
    ctx.lineTo(hole[right][0], -1e5);
    ctx.closePath();
    ctx.clip();
    if (floorKind(floor) === 'ladder') this.drawLadder(floor, x, y, base, alpha, false);
    else this.drawStairs(floor, x, y, base, alpha, 'over');
    ctx.restore();
    // And the rim of the hole.
    holePath();
    ctx.strokeStyle = 'rgba(40, 30, 32, 0.85)';
    ctx.lineWidth = Math.max(0.8, cam.zoom);
    ctx.stroke();
  }

  /**
   * The inside of a hole down to a cellar, laid into `c` (`drawOpening`): the
   * dark, the floor at the bottom, the far sides going down, and the way down
   * as far as the ground floor -- each darker the deeper it is
   * (`shaftShade`), by its height under the ground floor rather than by where
   * it falls on the screen, so the top of a flight is in the light at every
   * turn of the view, whichever way it goes down.
   */
  private holeInside(c: CellarCanvas, floor: FloorTile, x: number, y: number, base: number, hole: Array<[number, number]>, against: readonly Side[]): void {
    const g = this.game;
    const bld = g.buildings;
    const cam = this.camera;
    const lay = c.ctx;
    const bottom = cellarFloorHeight(g, x, y);
    const deep = Math.max(1, base - bottom);
    const { back } = sidesOf(cam.view);
    const P = (wx: number, wy: number, h: number): [number, number] => [cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, h)];
    lay.save();
    lay.beginPath();
    lay.moveTo(hole[0][0], hole[0][1]);
    for (let i = 1; i < 4; i++) lay.lineTo(hole[i][0], hole[i][1]);
    lay.closePath();
    lay.clip();
    lay.fillStyle = 'rgb(26, 20, 22)';
    lay.fillRect(-1e5, -1e5, 2e5, 2e5);
    // The floor at the bottom, as deep as the hole goes.
    cellarFloor(c, g, x, y, bottom, against, true);
    lay.save();
    lay.beginPath();
    const fl = [P(x, y, bottom), P(x + 1, y, bottom), P(x + 1, y + 1, bottom), P(x, y + 1, bottom)];
    lay.moveTo(fl[0][0], fl[0][1]);
    for (let i = 1; i < 4; i++) lay.lineTo(fl[i][0], fl[i][1]);
    lay.closePath();
    lay.fillStyle = `rgba(12, 9, 12, ${shaftAlpha((base - bottom) / deep).toFixed(3)})`;
    lay.fill();
    lay.restore();
    // The far sides, each shaded down its own height.
    for (const side of back) {
      const [ox, oy] = OUT[side];
      const open = !against.includes(side);
      const face = faceOn(g, x, y, side, bottom, 0.7, true);
      face.plain = true;
      // The cellar going on under the floor beside the hole: dark, with the floor's timbers over it.
      if (open) {
        face.lo0 = face.hi0 - 3.6;
        face.lo1 = face.hi1 - 3.6;
        face.rock0 = face.lo0 - 1;
        face.rock1 = face.lo1 - 1;
      }
      // A wall standing on the edge of the hole stands on the ground floor's edge: the hole's side is its inner face.
      const wall = bld.wall(0, x, y, side);
      if (wall && isDone(wall)) {
        face.ax -= ox * WALL_THICK;
        face.bx -= ox * WALL_THICK;
        face.ay -= oy * WALL_THICK;
        face.by -= oy * WALL_THICK;
      }
      earthFace(c, face);
      // Shaded by depth: along the face's own up and down, from its head at the ground floor to the floor of the hole.
      const a0 = P(face.ax, face.ay, face.hi0), a1 = P(face.bx, face.by, face.hi1), b0 = P(face.ax, face.ay, bottom);
      lay.save();
      lay.beginPath();
      lay.moveTo(a0[0], a0[1]);
      lay.lineTo(a1[0], a1[1]);
      const b1 = P(face.bx, face.by, Math.min(face.lo1, face.hi1));
      const b0f = P(face.ax, face.ay, Math.min(face.lo0, face.hi0));
      lay.lineTo(b1[0], b1[1]);
      lay.lineTo(b0f[0], b0f[1]);
      lay.closePath();
      lay.fillStyle = shaftShade(lay, a0, a1, b0);
      lay.fill();
      lay.restore();
    }
    // The way down, as far as the ground floor, laid on a sheet of its own and shaded from its foot to its head.
    const sheet = document.createElement('canvas');
    sheet.width = lay.canvas.width;
    sheet.height = lay.canvas.height;
    const way = sheet.getContext('2d') as CanvasRenderingContext2D;
    way.setTransform(lay.getTransform());
    way.lineJoin = 'round';
    const ladder = floorKind(floor) === 'ladder';
    if (ladder) this.drawLadder(floor, x, y, base, 1, false, way);
    else this.drawStairs(floor, x, y, base, 1, 'whole', way);
    const [foot, head] = Renderer.wayEnds(x, y, floor.facing ?? 's', ladder);
    const f0 = P(foot[0], foot[1], bottom), f1 = P(head[0], head[1], base);
    const grad = way.createLinearGradient(f0[0], f0[1], f1[0], f1[1]);
    for (const [k, at] of SHAFT_STOPS) grad.addColorStop(1 - at, `rgba(12, 9, 12, ${k})`);
    way.globalCompositeOperation = 'source-atop';
    way.fillStyle = grad;
    way.fillRect(-1e5, -1e5, 2e5, 2e5);
    lay.setTransform(1, 0, 0, 1, 0, 0);
    lay.drawImage(sheet, 0, 0);
    lay.restore();
  }

  /** Where a flight's foot and its head are, in the world: the middle of the tile's edge it is climbed from, and of the far one. */
  private static wayEnds(x: number, y: number, facing: Side, ladder: boolean): [[number, number], [number, number]] {
    const s0 = ladder ? 0.4 : 0, s1 = ladder ? 0.985 : 1;
    return [Renderer.stairPoint(x, y, facing, 0.5, s0), Renderer.stairPoint(x, y, facing, 0.5, s1)];
  }

  /**
   * The stretch across its tile a flight takes, in `stairPoint`'s coordinate
   * across: the whole of it for the wide one, and for a single one the half
   * on the hand it names as you climb -- which end of the run across that is
   * turns with the side it is climbed from.
   */
  static stairSpan(facing: Side, hand?: StairHand): [number, number] {
    if (!hand) return [0, 1];
    const [ox, oy] = Renderer.stairPoint(0, 0, facing, 0, 0);
    const [ux, uy] = Renderer.stairPoint(0, 0, facing, 0, 1);
    const [cx, cy] = Renderer.stairPoint(0, 0, facing, 1, 0);
    // Your left as you climb, with y running south: the climb turned a quarter.
    const highIsLeft = (cx - ox) * (uy - oy) - (cy - oy) * (ux - ox) > 0;
    return (hand === 'l') === highIsLeft ? [0.5, 1] : [0, 0.5];
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
    // On a building on piers, on its deck.
    const deck = this.game.buildings.buildingAt(x, y)?.deck;
    const corner = (cx: number, cy: number): [number, number] => [cam.worldToScreenX(cx, cy), cam.worldToScreenY(cx, cy, (deck ?? world.getHeight(cx, cy)) + rise)];
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
      // A wall taken off over a cellar you are looking into throws nothing.
      return w && isDone(w) && !this.cut.has(w.building) ? w : undefined;
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
    // A wall the cutaway has taken away takes its shade with it: not one seen edge on, which it leaves (`edgeOn`).
    if (this.game.settings.cutaway && bld.buildingAt(fx, fy)?.id !== wall.building && !this.edgeOn(b)) return done(null);
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
    const h = ((wall.building ? bld.list.get(wall.building)?.deck : undefined) ?? world.getHeight(fx, fy)) + level * WALL_HEIGHT;
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
  private drawStairs(floor: FloorTile, x: number, y: number, base: number, alpha: number, part: 'whole' | 'over' = 'whole',
    into?: CanvasRenderingContext2D): void {
    const main = into ?? this.canvas.ctx;
    const cam = this.camera;
    const bld = this.game.buildings;
    const bare = MATERIAL_BY_ID.get(floor.material);
    if (!bare) return;
    const facing = floor.facing ?? 's';
    const h0 = base + (floor.level - 1) * WALL_HEIGHT;
    const h1 = base + floor.level * WALL_HEIGHT;
    const N = FLIGHT_STEPS;
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
    if (alpha < 1 && !into) {
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
    /*
     * The stretch of the tile it takes across: all of it, or for a single
     * staircase the half it runs up, its other side open on the stairwell
     * beside it in the middle of the tile, where no wall and no flight is.
     */
    const span = Renderer.stairSpan(facing, floor.hand);
    const atEdge = (t: 0 | 1): boolean => span[t] === t;
    /** The border a side of the flight runs along. */
    const sideBorder = (t: 0 | 1): Border => {
      const [a, b] = [W(t, 0), W(t, 1)];
      return Math.abs(a[0] - b[0]) < 1e-9 ? { dir: 'v', x: a[0], y: Math.min(a[1], b[1]) } : { dir: 'h', x: Math.min(a[0], b[0]), y: a[1] };
    };
    const walled = (t: 0 | 1): boolean => {
      if (!atEdge(t)) return false;
      const w = bld.wallOnBorder(floor.level - 1, sideBorder(t));
      return !!w && isDone(w);
    };
    /** Whether a flight beside it on side `t` goes up the same way and runs up against it, making one wider flight with it. */
    const joined = (t: 0 | 1): boolean => {
      if (!atEdge(t)) return false;
      const [nx, ny] = t ? [cx, cy] : [-cx, -cy];
      const f = bld.floor(floor.level, x + Math.round(nx), y + Math.round(ny));
      if (!f || floorKind(f) !== 'stairs' || (f.facing ?? 's') !== facing) return false;
      const theirs = Renderer.stairSpan(facing, f.hand);
      return t ? theirs[0] === 0 : theirs[1] === 1;
    };
    /** Whether a side stands open to the room: no wall along it, and no flight beside it. */
    const open = (t: 0 | 1): boolean => !walled(t) && !joined(t);
    // Against a wall, the flight stops at the wall's face.
    const tLo = walled(0) ? WALL_THICK : span[0], tHi = walled(1) ? 1 - WALL_THICK : span[1];
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
        } else {
          // Seen from its head: the round back of the log under the tread, each one a step higher than the one beyond it.
          poly([P(tLo, sB - 0.01, ht), P(tHi, sB - 0.01, ht), P(tHi, sm + 0.04, ht - r), P(tLo, sm + 0.04, ht - r)]);
          ctx.fillStyle = C(st.string, riserLit * 0.84);
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
    // Only what stands up over the ground floor, for a flight down whose hole is laid already (`drawOpening`).
    const whole = part === 'whole';
    if (whole && (st.build === 'string' || st.build === 'closed') && !joined(far)) string(tFar);
    /*
     * Under the split logs, between the stringers, the backs of the logs in
     * their own shade, laid along the pitch of the flight: through the gaps
     * between its steps a log flight shows the underside of the steps beyond,
     * and not the floor and the wall behind it, which is what a ladder shows.
     */
    if (whole && st.build === 'log') {
      poly([P(tLo, 0.02, h0), P(tHi, 0.02, h0), P(tHi, 1, h1 - rise * 0.55), P(tLo, 1, h1 - rise * 0.55)]);
      ctx.fillStyle = C(st.string, sideLit * 0.46);
      ctx.fill();
    }
    if (whole && st.build === 'log' && !joined(far)) stringer(tFar + (near ? 0.08 : -0.08));
    // And the near one under the split logs too: they lie across the two and stand out past them, so each step's end,
    // stacked up the flight, is laid over its stringer -- which seen from the head end is what says it climbs.
    if (whole && st.build === 'log' && !joined(near)) stringer(tNear + (near ? -0.08 : 0.08));
    if (farOpen) {
      if (st.rail === 'parapet') side(tFar, true);
      else rail(tFar);
    }
    // The steps, back to front.
    const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => {
      const [ax, ay] = W((tLo + tHi) / 2, (a + 0.5) / N);
      const [bx, by] = W((tLo + tHi) / 2, (b + 0.5) / N);
      return cam.rotateX(ax, ay) + cam.rotateY(ax, ay) - (cam.rotateX(bx, by) + cam.rotateY(bx, by));
    });
    if (whole) for (const i of order) step(i);
    // A solid flight seen from behind shows the end of it under the landing.
    if (whole && st.build === 'solid' && !risersShow) {
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
      if (st.build === 'solid') {
        if (whole || (st.rail === 'parapet' && nearOpen)) side(tNear, st.rail === 'parapet' && nearOpen);
      } else if (!whole || st.build === 'log') {
        // Nothing of a string or a stringer stands over the ground floor, and a log flight's stringers went in under its steps.
      } else string(tNear);
    }
    if (nearOpen && st.rail !== 'parapet') rail(tNear + (near ? -0.05 : 0.05));
    if (!done && whole) {
      poly([P(span[0], 0, h1), P(span[1], 0, h1), P(span[1], 1, h1), P(span[0], 1, h1)]);
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
  private drawLadder(floor: FloorTile, x: number, y: number, base: number, alpha: number, hatch = true, into?: CanvasRenderingContext2D): void {
    const main = into ?? this.canvas.ctx;
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
      if (a >= 1 || into) {
        main.globalAlpha = Math.min(1, a);
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
   * Looking into a cellar, take off with the building over it every building
   * that stands between a cellar and the eye and whose box on the screen falls
   * over the cellar's: the cellar is laid over the country round it, and a
   * house in front of it laid under it would read as a house behind it. Asked
   * of the buildings within a few tiles of a cellar, and only while one is
   * being looked into.
   */
  private cutInFront(): void {
    const g = this.game;
    const bld = g.buildings;
    const cam = this.camera;
    const V = cam.view;
    type Box = { x0: number; x1: number; y0: number; y1: number; front: number; tx0: number; tx1: number; ty0: number; ty1: number };
    const boxes = new Map<number, Box>();
    const grow = (b: Box, px: number, py: number, hTop: number, hLow: number): void => {
      const sx = cam.worldToScreenX(px, py);
      b.x0 = Math.min(b.x0, sx);
      b.x1 = Math.max(b.x1, sx);
      b.y0 = Math.min(b.y0, cam.worldToScreenY(px, py, hTop));
      b.y1 = Math.max(b.y1, cam.worldToScreenY(px, py, hLow));
    };
    const fresh = (): Box => ({ x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, front: -Infinity, tx0: Infinity, tx1: -Infinity, ty0: Infinity, ty1: -Infinity });
    for (const c of bld.cellars.values()) {
      let b = boxes.get(c.building);
      if (!b) boxes.set(c.building, (b = fresh()));
      const top = g.world.getHeight(c.x, c.y);
      for (const [px, py] of [[c.x, c.y], [c.x + 1, c.y], [c.x + 1, c.y + 1], [c.x, c.y + 1]]) grow(b, px, py, top, top - CELLAR_DEPTH);
      b.front = Math.max(b.front, depthOf(V, c.x, c.y));
      b.tx0 = Math.min(b.tx0, c.x);
      b.tx1 = Math.max(b.tx1, c.x);
      b.ty0 = Math.min(b.ty0, c.y);
      b.ty1 = Math.max(b.ty1, c.y);
    }
    const NEAR = 8;
    for (const b of bld.list.values()) {
      if (this.cut.has(b.id) || !b.tiles.length) continue;
      const [fx, fy] = b.tiles[0].split(',').map(Number);
      const near = [...boxes.values()].filter((c) => fx >= c.tx0 - NEAR && fx <= c.tx1 + NEAR && fy >= c.ty0 - NEAR && fy <= c.ty1 + NEAR);
      if (!near.length) continue;
      const box = fresh();
      for (const k of b.tiles) {
        const [x, y] = k.split(',').map(Number);
        const ground = g.world.getHeight(x, y);
        for (const [px, py] of [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]) grow(box, px, py, ground + b.levels * WALL_HEIGHT + 24, ground);
        box.front = Math.max(box.front, depthOf(V, x, y));
        // Its jetties too, a tile out, at its floor's height (`frame.ts`): one of them can stand over the cellar's box.
        for (const [jx, jy] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) {
          if (bld.jettyAt(jx, jy)?.id !== b.id) continue;
          const floor = jettyBase(g, b, jx, jy) ?? ground;
          for (const [px, py] of [[jx, jy], [jx + 1, jy], [jx + 1, jy + 1], [jx, jy + 1]]) grow(box, px, py, floor + b.levels * WALL_HEIGHT + 24, g.world.getHeight(px, py));
          box.front = Math.max(box.front, depthOf(V, jx, jy));
        }
      }
      if (near.some((c) => box.front >= c.front && box.x0 < c.x1 && box.x1 > c.x0 && box.y0 < c.y1 && box.y1 > c.y0)) this.cut.add(b.id);
    }
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
      // Looking at one storey lifts everything over it off, the roof with it; and looking into a cellar, the building over it.
      if (viewLevel !== null && b.levels > viewLevel) continue;
      if (this.cut.has(b.id)) continue;
      let front = -Infinity;
      // Its jetties' tiles too, where the roof goes out over them (`roofTiles`).
      for (const [x, y] of bld.roofTiles(b)) {
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
    const bld = this.game.buildings;
    const level = b.levels;
    // Standing under it, or with a light burning under it after dark (glass glows with it, `lightsUnder`): as it always was.
    const roofTiles = bld.roofTiles(b);
    if ((this.game.darkness() >= LAMP_DARK && this.lightsUnder(b).length) || (this.roomTiles && roofTiles.some(([x, y]) => this.roomTiles?.has(`${x},${y}`)))) {
      this.drawPitchedRoofNow(b);
      return;
    }
    const cam = this.camera;
    const world = this.game.world;
    let sig = '';
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let lowest = Infinity, wide = 1;
    let fx = Infinity, fy = Infinity;
    for (const [x, y] of roofTiles) {
      const f = bld.floor(level, x, y);
      if (!f || floorKind(f) !== 'roof') continue;
      sig += `${x},${y},${f.material},${f.dye ?? ''},${isDone(f) ? 1 : 0};`;
      lowest = Math.min(lowest, world.getHeight(x, y));
      fx = Math.min(fx, x); fy = Math.min(fy, y);
      wide = Math.max(wide, Math.abs(x - roofTiles[0][0]) + 1, Math.abs(y - roofTiles[0][1]) + 1);
    }
    if (!sig) return;
    if (b.deck != null) lowest = Math.min(lowest, b.deck);
    // From the ground under it to the ridge as high as the widest roof of its footprint could stand, a tile and a half past every eave.
    const top = Math.max(lowest, b.deck ?? lowest) + (level + 0.5) * WALL_HEIGHT + ROOF_PITCH * roofShapeDef(b).rise * (wide + 2);
    for (const [x, y] of roofTiles) {
      for (const [cx, cy] of [[x - 1.5, y - 1.5], [x + 2.5, y - 1.5], [x - 1.5, y + 2.5], [x + 2.5, y + 2.5]]) {
        for (const z of [lowest - WALL_HEIGHT * 0.2, top]) {
          const sx = cam.worldToScreenX(cx, cy), sy = cam.worldToScreenY(cx, cy, z);
          x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
        }
      }
    }
    const key = `r|${b.id}|${level}|${b.deck ?? ''}|${roofShapeOf(b)}|${sig}`;
    this.baked(key, cam.worldToScreenX(fx, fy), cam.worldToScreenY(fx, fy, lowest), [x0, y0, x1, y1], () => this.drawPitchedRoofNow(b));
  }

  private drawPitchedRoofNow(b: Building): void {
    const main = this.canvas.ctx;
    const cam = this.camera;
    const bld = this.game.buildings;
    const world = this.game.world;
    const zoom = cam.zoom;
    const level = b.levels;
    const roofs: FloorTile[] = [];
    // Over its jetties as well as its footprint (`roofTiles`).
    for (const [x, y] of bld.roofTiles(b)) {
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
    // A jetty's ground is not the building's: the eaves are over the footprint's.
    for (const f of roofs) if (bld.buildingAt(f.x, f.y)) eave = Math.max(eave, world.getHeight(f.x, f.y));
    if (eave === -Infinity) eave = this.buildingBase(b.id);
    // A building on piers stands on its deck, whatever the ground under it does.
    if (b.deck != null) eave = b.deck;
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
    /*
     * Glass is seen through already (`glazing.ts`), so out of doors a roof of
     * it is laid straight on. Standing under one it goes on that layer as any
     * roof over you does: the frame and the panes of all of it ghosted over the
     * room at a third, so you can see where the glass is without it hiding
     * what you are working on.
     */
    const glassy = (f: FloorTile): boolean => f.material === GLASS;
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
      // The hour's light on what is there and not over it: a covering seen through keeps the opacity it was painted at.
      g.globalCompositeOperation = 'source-atop';
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
    /** Whether a slope turned away is turned far enough to show at all, through the glass in front of it: edge on, it is a hairline. */
    const showsBehind = (fall: Fall): boolean => {
      if (fall === 4) return false;
      const [fx, fy] = FALLS[fall];
      return slope * ((fx * gx + fy * gy) / gl) + down < -0.05;
    };
    /*
     * The far slopes seen through glass, and the glint on it, are detail: none
     * below the level-of-detail line at 0.6, all of it from 0.7, and faded in
     * between, so zooming across the line does not switch them on in a frame.
     */
    const behind = Math.max(0, Math.min(1, (zoom - 0.6) / 0.1));
    /**
     * How much of a face is laid: one turned to the eye, all of it; a far slope
     * of finished glass, seen through the near one, as much as `behind` gives;
     * anything else, none. The creases go by the same answer, so none is drawn
     * without a face beside it.
     */
    const shown = (f: (typeof model.faces)[number]): number => {
      if (facing(f.fall)) return 1;
      const tile = roofs[f.tile];
      return glassy(tile) && isDone(tile) && showsBehind(f.fall) ? behind : 0;
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
    /*
     * The picture laid on a face's plane: across it along the eave, and down
     * it from the eave's edge, so a course's tail lies along every eave.
     */
    const planeMatrix = (f: (typeof model.faces)[number]): DOMMatrix => {
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
      return new DOMMatrix([
        cam.worldToScreenX(ox + ex * k, oy + ey * k) - sx, cam.worldToScreenY(ox + ex * k, oy + ey * k, h0) - sy,
        cam.worldToScreenX(ox + nx * k, oy + ny * k) - sx, cam.worldToScreenY(ox + nx * k, oy + ny * k, h0 - pitch * rise * k) - sy,
        sx, sy,
      ]);
    };
    /*
     * How hard a slope of glass throws the sun back into the eye: the sun off
     * the face's plane, against the way the camera looks down, as a specular
     * glint that moves from slope to slope with the hour and the turn of the
     * view, and nothing in the dark.
     */
    const sun = this.sunNow;
    const upward = Math.sin(Math.atan(down));
    const across = Math.cos(Math.atan(down));
    const eye: [number, number, number] = [(gx / gl) * across, (gy / gl) * across, upward];
    const glintOf = (fall: Fall): number => {
      const [fx, fy] = fall === 4 ? [0, 0] : FALLS[fall];
      const nl = Math.hypot(slope * fx, slope * fy, 1);
      const n = [(slope * fx) / nl, (slope * fy) / nl, 1 / nl];
      const sn = sun[0] * n[0] + sun[1] * n[1] + sun[2] * n[2];
      if (sn <= 0 || sun[2] <= 0) return 0;
      const rv = (2 * sn * n[0] - sun[0]) * eye[0] + (2 * sn * n[1] - sun[1]) * eye[1] + (2 * sn * n[2] - sun[2]) * eye[2];
      return rv <= 0 ? 0 : Math.min(1, rv ** 6 * 1.2) * (1 - this.game.darkness());
    };
    // A light burning under the glass, for the glow the night lays on it.
    const burning = this.lightsUnder(b);
    /** Fill what has been outlined with the face's picture, laid on its plane. */
    const fillAs = (f: (typeof model.faces)[number]): void => {
      const tile = roofs[f.tile];
      if (!isDone(tile)) {
        const cov = covering(tile.material);
        ctx.fillStyle = `rgba(${cov.fascia.body[0]}, ${cov.fascia.body[1]}, ${cov.fascia.body[2]}, 0.28)`;
        ctx.fill();
        return;
      }
      if (glassy(tile)) {
        this.glaze(ctx, planeMatrix(f), lightOf(f.fall), facing(f.fall), glintOf(f.fall), behind);
        return;
      }
      const pat = patternOf(tile.material, lightOf(f.fall));
      if (!pat) return;
      pat.setTransform(planeMatrix(f));
      ctx.fillStyle = pat;
      ctx.fill();
    };
    const plan: FloorTile[] = [];
    // The faces of glass a light burns under, for the glow the night lays on them, and the box round them: see `drawGlassGlow`.
    const glowing: Array<{ path: Path2D; m: DOMMatrix }> = [];
    const glowBox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    model.faces.forEach((f, i) => {
      const tile = roofs[f.tile];
      // Glass shows the slopes beyond it, from under them; anything else only what faces the eye.
      if (shown(f) <= 0) return;
      items.push({ d: faceDepth[i], plane: planeOf(f), face: i, draw: () => { ctx.beginPath(); outlineOf(f); fillAs(f); } });
      if (burning.length && facing(f.fall) && glassy(tile) && isDone(tile)) {
        const path = new Path2D();
        f.pts.forEach((p, k) => {
          const px = X(p), py = Y(p);
          if (k) path.lineTo(px, py); else path.moveTo(px, py);
          glowBox[0] = Math.min(glowBox[0], px); glowBox[1] = Math.min(glowBox[1], py);
          glowBox[2] = Math.max(glowBox[2], px); glowBox[3] = Math.max(glowBox[3], py);
        });
        path.closePath();
        glowing.push({ path, m: planeMatrix(f) });
      }
    });
    if (glowing.length) this.noteGlassGlow(glowing, glowBox, burning, eave + pitch * 0.5, under);
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
    /** How much of the faces along a crease from `a` to `b` is laid (`shown`): a crease is drawn as strongly as the most of them, and not at all with none. */
    const seen = (a: RoofPt, bq: RoofPt): number => {
      const B = new Set(byPoint.get(`${bq[0]},${bq[1]}`) ?? []);
      let most = 0;
      for (const i of byPoint.get(`${a[0]},${a[1]}`) ?? []) if (B.has(i)) most = Math.max(most, shown(model.faces[i]));
      return most;
    };
    /*
     * On a roof with no valley every ridge and hip is on top of everything
     * else of it, so they go on after all its faces: laid after only the two
     * faces either side, the next tile's face along the hip went on over the
     * end of the piece before it, and every joint of the ridge was a notch of
     * the covering cut into the cap.
     */
    const ridgedLast = !model.creases.some((c) => c.kind === 'valley');
    for (const c of model.creases) {
      const strength = isDone(roofs[c.tile]) ? seen(c.a, c.b) : 0;
      if (strength <= 0) continue;
      items.push({ d: (ridgedLast ? 1e9 : 0) + after(c.a, c.b) + 0.001, draw: () => {
        const was = ctx.globalAlpha;
        ctx.globalAlpha = was * strength;
        drawCrease();
        ctx.globalAlpha = was;
      } });
      const drawCrease = (): void => {
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
      };
    }
    for (const e of model.edges) {
      if (!isDone(roofs[e.tile])) continue;
      const [ox, oy] = FALLS[e.out];
      if (cam.nearSide(ox, oy) < 0) continue;
      const cov = covering(roofs[e.tile].material);
      /*
       * Where glass stops at a hole in the roof -- the next tile of the
       * building has no finished roof yet, or none at all -- it is a cut edge,
       * not an eave: its last bar along it, and no gutter.
       */
      const edgeTile = roofs[e.tile];
      if (glassy(edgeTile) && bld.buildingAt(edgeTile.x + ox, edgeTile.y + oy)?.id === b.id) {
        items.push({ d: after(e.a, e.b) + 0.002, draw: () => {
          ctx.lineCap = 'round';
          ctx.strokeStyle = cov.cap.dark;
          ctx.lineWidth = Math.max(1.4, 2 * zoom);
          ctx.beginPath(); ctx.moveTo(X(e.a), Y(e.a) + 0.5); ctx.lineTo(X(e.b), Y(e.b) + 0.5); ctx.stroke();
          ctx.strokeStyle = cov.cap.body;
          ctx.lineWidth = Math.max(0.8, 1.2 * zoom);
          ctx.beginPath(); ctx.moveTo(X(e.a), Y(e.a)); ctx.lineTo(X(e.b), Y(e.b)); ctx.stroke();
          ctx.lineCap = 'butt';
          ctx.lineWidth = 1;
        } });
        continue;
      }
      const fl = this.faceLight(-oy, ox);
      // The shade the eave throws down the wall under it, under everything: glass lets the light through.
      if (e.wall && !glassy(roofs[e.tile])) {
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
      // A gable end under a glass roof is glazed, and seen through from either side.
      const glazed = g.borders.every((bb) => glassy(roofs[bb.tile]));
      if (cam.nearSide(ox, oy) < 0 && !glazed) continue;
      // Before everything along its edge: the verge over it stands further out.
      const d = Math.min(...g.line.map((p) => deep(p[0], p[1]))) - 0.001;
      // It goes up with the roof over it: under a roof only planned, it is only planned too.
      const built = g.borders.every((bb) => isDone(roofs[bb.tile]));
      items.push({ d, draw: () => {
        const was = ctx.globalAlpha;
        if (!built) ctx.globalAlpha = was * 0.3;
        if (glazed) this.drawGlassGable(ctx, g, eave, pitch);
        else this.drawGable(ctx, g, level, eave, pitch, roofs);
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
    if (under && ctx !== main) {
      main.save();
      main.setTransform(1, 0, 0, 1, 0, 0);
      main.globalAlpha = 0.35;
      main.drawImage(ctx.canvas, 0, 0);
      main.restore();
    }
  }


  /**
   * Lay a face of glass (`glazing.ts`) over what has been outlined: its panes
   * as thick as its light lays them and its frame in that light; a slope seen
   * from under it, through the glass in front, as its frame alone in shade;
   * and over a face that throws the sun at the eye, the glint, as strongly as
   * it does.
   */
  private glaze(ctx: CanvasRenderingContext2D, m: DOMMatrix, lit: number, front: boolean, shine: number, detail: number): void {
    const mip = this.roofMip();
    const pat = this.glassPattern(front ? 'face' : 'back', lit, mip, ctx);
    if (!pat) return;
    pat.setTransform(m);
    const was = ctx.globalAlpha;
    if (!front) ctx.globalAlpha = was * 0.4 * detail;
    ctx.fillStyle = pat;
    ctx.fill();
    ctx.globalAlpha = was;
    // No glint where a face is a few pixels across: from that far off a roof is its shape and its colour. It fades in with `detail`.
    if (front && shine > 0.02 && detail > 0) {
      const glint = this.glassPattern('glint', 1, mip, ctx);
      if (glint) {
        // The band of sun slides along the slope as the hours go, a picture's width over a third of a day.
        glint.setTransform(m.translate(((this.game.hourOfDay() / 8) % 1) * (COVER_PPT >> mip) * 2, 0));
        ctx.globalAlpha = was * shine * detail;
        ctx.fillStyle = glint;
        ctx.fill();
        ctx.globalAlpha = was;
      }
    }
  }

  /** Glass's patterns, made once for each size and each step of light, and kept with the roofs'. */
  private glassPattern(kind: 'face' | 'back' | 'glint' | 'glow', lit: number, mip: number, ctx: CanvasRenderingContext2D): CanvasPattern | null {
    const q = Math.round(lit * 50) / 50;
    const k = `glass:${kind}:${mip}${kind === 'face' || kind === 'back' ? `:${q}` : ''}`;
    let pat = this.roofPatterns.get(k);
    if (pat) {
      this.roofPatterns.delete(k);
      this.roofPatterns.set(k, pat);
      return pat;
    }
    const src = kind === 'face' ? glassFace(q, mip) : kind === 'back' ? glassBack(q, mip) : kind === 'glint' ? glass().glint[mip] : glass().glow[mip];
    pat = ctx.createPattern(src, 'repeat') ?? undefined;
    if (!pat) return null;
    this.roofPatterns.set(k, pat);
    while (this.roofPatterns.size > 48) {
      const first = this.roofPatterns.keys().next().value;
      if (first === undefined) break;
      this.roofPatterns.delete(first);
    }
    return pat;
  }

  /**
   * What is burning under a building's roof after dark with nothing finished
   * between it and the roof: the lights a glass roof glows with. A fire on the
   * ground floor of a house of two storeys has a ceiling over it.
   */
  private lightsUnder(b: Building): LightSource[] {
    if (!this.lightsNow.length) return [];
    const bld = this.game.buildings;
    return this.lightsNow.filter((l) => {
      const x = Math.floor(l.x), y = Math.floor(l.y);
      if (bld.buildingAt(x, y)?.id !== b.id) return false;
      for (let k = l.level ?? 0; k < b.levels - 1; k++) if (bld.coveredAt(k, x, y)) return false;
      return true;
    });
  }

  /**
   * A roof's faces of glass with lights under them, kept for the night to lay
   * the glow on after the dark has gone over everything: the faces' outlines
   * and pictures, and each light where it stands under the roof, how far its
   * glow carries across the glass -- half again its own reach, falling to
   * nothing there -- and how strong it is. Over your head, at the third the
   * roof itself is laid at.
   */
  private noteGlassGlow(faces: Array<{ path: Path2D; m: DOMMatrix }>, box: [number, number, number, number], lights: LightSource[], height: number, under: boolean): void {
    const cam = this.camera;
    const zoom = cam.zoom;
    const [x0, y0, x1, y1] = box;
    const lit = lights.map((l) => ({
      x: cam.worldToScreenX(l.x, l.y),
      y: cam.worldToScreenY(l.x, l.y, height),
      r: Math.max(8, 1.5 * l.radius * HALF_W * zoom),
      a: l.strength * (under ? 0.35 : 1),
    }));
    this.glassNight.push({ faces, lights: lit, box: [x0 - 2, y0 - 2, x1 + 2, y1 + 2] });
  }

  /**
   * The glow of glass with a light under it, over the night: its panes warm
   * and bright, its bars dark across them, brightest over a light and gone at
   * half again its reach. One pass a roof, however many lights burn under it,
   * on one layer at half the screen's size -- a glow is soft, and half the size
   * is a quarter of the work:
   *
   *   * every light's reach is added into the layer as a mask, each drawn over
   *     its own reach and no further;
   *   * the lit faces are laid in the glow's picture over that mask, `source-atop`,
   *     so a face takes the picture as strongly as the lights reach it, and
   *     what lies between faces keeps only the mask, which is black and adds
   *     nothing to the night;
   *   * and the lot goes onto the night once, as light is, so the dark under it
   *     is lifted rather than painted over.
   *
   * All of it in the part of the roof's box some light reaches: for a big roof
   * with one lamp in a corner, the corner.
   */
  private drawGlassGlow(ctx: CanvasRenderingContext2D, dark: number): void {
    const layer = this.glowCtx();
    const pat = this.glassPattern('glow', 1, this.roofMip(), layer);
    if (!pat) return;
    const t = layer.getTransform();
    const k = layer.canvas.width / Math.max(1, ctx.canvas.width);
    for (const roof of this.glassNight) {
      let bx0 = roof.box[0], by0 = roof.box[1], bx1 = roof.box[2], by1 = roof.box[3];
      let rx0 = Infinity, ry0 = Infinity, rx1 = -Infinity, ry1 = -Infinity;
      for (const l of roof.lights) {
        rx0 = Math.min(rx0, l.x - l.r); ry0 = Math.min(ry0, l.y - l.r);
        rx1 = Math.max(rx1, l.x + l.r); ry1 = Math.max(ry1, l.y + l.r);
      }
      bx0 = Math.max(bx0, rx0); by0 = Math.max(by0, ry0); bx1 = Math.min(bx1, rx1); by1 = Math.min(by1, ry1);
      if (bx1 <= bx0 || by1 <= by0) continue;
      // The box on the layer, in its own pixels, and where that lands on the screen.
      const p0 = t.transformPoint(new DOMPoint(bx0, by0));
      const p1 = t.transformPoint(new DOMPoint(bx1, by1));
      const lx = Math.max(0, Math.floor(Math.min(p0.x, p1.x))), ly = Math.max(0, Math.floor(Math.min(p0.y, p1.y)));
      const lw = Math.min(layer.canvas.width, Math.ceil(Math.max(p0.x, p1.x))) - lx;
      const lh = Math.min(layer.canvas.height, Math.ceil(Math.max(p0.y, p1.y))) - ly;
      if (lw <= 0 || lh <= 0) continue;
      layer.save();
      layer.setTransform(1, 0, 0, 1, 0, 0);
      layer.clearRect(lx, ly, lw, lh);
      layer.restore();
      layer.save();
      layer.beginPath();
      layer.rect(bx0, by0, bx1 - bx0, by1 - by0);
      layer.clip();
      // Every light's reach, added together.
      layer.globalCompositeOperation = 'lighter';
      for (const l of roof.lights) {
        const reach = layer.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
        reach.addColorStop(0, `rgba(0, 0, 0, ${l.a.toFixed(3)})`);
        reach.addColorStop(0.45, `rgba(0, 0, 0, ${(l.a * 0.62).toFixed(3)})`);
        reach.addColorStop(1, 'rgba(0, 0, 0, 0)');
        layer.fillStyle = reach;
        layer.fillRect(l.x - l.r, l.y - l.r, 2 * l.r, 2 * l.r);
      }
      // The lit faces over it, as strongly as it reaches them.
      layer.globalCompositeOperation = 'source-atop';
      layer.fillStyle = pat;
      for (const f of roof.faces) {
        pat.setTransform(f.m);
        layer.fill(f.path);
      }
      layer.restore();
      // And onto the night, once.
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, dark * 0.55);
      ctx.drawImage(layer.canvas, lx, ly, lw, lh, lx / k, ly / k, lw / k, lh / k);
      ctx.restore();
    }
  }

  /** The layer a glass roof's glow is made on (`drawGlassGlow`): half the screen's size each way, kept. */
  private glowCtx(): CanvasRenderingContext2D {
    const el = this.canvas.el;
    const w = Math.max(1, Math.ceil(el.width / 2)), h = Math.max(1, Math.ceil(el.height / 2));
    if (!this.glowLayer || this.glowLayer.canvas.width !== w || this.glowLayer.canvas.height !== h) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      this.glowLayer = c.getContext('2d') as CanvasRenderingContext2D;
    }
    const g = this.glowLayer;
    const m = this.canvas.ctx.getTransform();
    const k = w / el.width;
    g.setTransform(m.a * k, m.b * k, m.c * k, m.d * k, m.e * k, m.f * k);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    return g;
  }

  /**
   * A gable end under a roof of glass: glazed, the wall carried up in panes
   * between mullions a sixth of a tile apart with a transom across, pale where
   * the light takes it -- and seen through, so a far one shows past the near
   * side of the roof. The verge over it is the roof's.
   */
  private drawGlassGable(ctx: CanvasRenderingContext2D, gable: RoofGable, eave: number, pitch: number): void {
    const cam = this.camera;
    const zoom = cam.zoom;
    const [ox, oy] = FALLS[gable.out];
    const along = gable.out === 0 || gable.out === 2 ? 'y' : 'x';
    const at = (x: number, y: number, h: number): [number, number] => [
      cam.worldToScreenX(x + ox * WALL_THICK, y + oy * WALL_THICK),
      cam.worldToScreenY(x + ox * WALL_THICK, y + oy * WALL_THICK, eave + h),
    ];
    const line = gable.line;
    const first = line[0], last = line[line.length - 1];
    const outline = (): void => {
      ctx.beginPath();
      ctx.moveTo(...at(first[0], first[1], 0));
      for (const p of line) ctx.lineTo(...at(p[0], p[1], pitch * p[2]));
      ctx.lineTo(...at(last[0], last[1], 0));
      ctx.closePath();
    };
    const lit = this.faceLight(along === 'x' ? 1 : 0, along === 'y' ? 1 : 0);
    outline();
    ctx.fillStyle = `rgba(214, 238, 236, ${(glassReflects(lit) * 0.9).toFixed(3)})`;
    ctx.fill();
    ctx.save();
    outline();
    ctx.clip();
    /** The roof's height over the eaves at a place along the end, off its line. */
    const riseAt = (u: number): number => {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        const ua = along === 'x' ? a[0] : a[1], ub = along === 'x' ? b[0] : b[1];
        if ((u - ua) * (u - ub) <= 0 && ua !== ub) return pitch * (a[2] + ((u - ua) / (ub - ua)) * (b[2] - a[2]));
      }
      return 0;
    };
    const u0 = along === 'x' ? Math.min(first[0], last[0]) : Math.min(first[1], last[1]);
    const u1 = along === 'x' ? Math.max(first[0], last[0]) : Math.max(first[1], last[1]);
    const fixed = along === 'x' ? first[1] : first[0];
    const pt = (u: number, h: number): [number, number] => (along === 'x' ? at(u, fixed, h) : at(fixed, u, h));
    const ink = rgb([112, 116, 112], lit);
    const body = rgb([239, 236, 227], lit);
    const bar = (a: [number, number], b: [number, number], w: number): void => {
      ctx.lineCap = 'butt';
      ctx.strokeStyle = ink;
      ctx.lineWidth = w + Math.max(0.8, 0.9 * zoom);
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
      ctx.strokeStyle = body;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
    };
    const top = Math.max(...line.map((p) => p[2])) * pitch;
    // A transom a third of the way up, then a mullion every sixth of a tile.
    bar(pt(u0 - 0.1, top / 3), pt(u1 + 0.1, top / 3), Math.max(1, 1.6 * zoom));
    for (let u = Math.ceil(u0 * 6) / 6; u <= u1 + 1e-9; u += 1 / 6) {
      const h = riseAt(u);
      if (h <= 0.5) continue;
      bar(pt(u, 0), pt(u, h + 1), Math.max(1, 1.8 * zoom));
    }
    ctx.restore();
    ctx.lineWidth = 1;
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
      // Over two columns and no wall, the gable is laid in the columns' stuff, on their beam (`framing.ts`).
      const face = wall && isDone(wall) ? wall : bld.carried(level - 1, border) ? bld.column(level - 1, border.x, border.y) : undefined;
      const cob = face ? this.masonryOf(face) : undefined;
      const [ax, ay] = borderPoints(border);
      const P = (t: number, h: number): [number, number] => at(ax + dx * t, ay + dy * t, h);
      if (!cob) {
        const mat = MATERIAL_BY_ID.get(face?.material ?? wall?.material ?? roofs[b.tile].material);
        ctx.beginPath();
        ctx.moveTo(...P(-0.01, -1)); ctx.lineTo(...P(1.01, -1)); ctx.lineTo(...P(1.01, top + 2)); ctx.lineTo(...P(-0.01, top + 2));
        ctx.closePath();
        ctx.fillStyle = rgb(mat ? this.painted(mat, face?.dye ?? wall?.dye).color : [180, 160, 140], lit);
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

  // -------------------------------------------------------------------------
  // Jetties, railings and columns (`framing.ts`, `../game/frame.ts`).
  // -------------------------------------------------------------------------

  /**
   * The storey being looked at, as `drawStructures` draws to it: looking into
   * a cellar, every building over none is drawn as its ground floor is, so
   * the ground floor's walls, columns and beams with it. Null for all of them.
   */
  private seenLevel(): number | null {
    const v = this.game.settings.viewLevel;
    return v === null ? null : Math.max(0, v);
  }

  /** Whether a column stands at either end of a border, on any storey. */
  private columnEnds(border: Border): boolean {
    const bld = this.game.buildings;
    if (!bld.columns.size) return false;
    const [ax, ay, bx, by] = borderPoints(border);
    return bld.hasColumnAt(ax, ay) || bld.hasColumnAt(bx, by);
  }

  /** The height a building's floors are counted from: its deck on piers (`piers.ts`), or the ground at its first tile, as its own walls are drawn. */
  private buildingBase(id: number): number {
    const b = this.game.buildings.list.get(id);
    if (!b || !b.tiles.length) return 0;
    if (b.deck != null) return b.deck;
    const i = b.tiles[0].indexOf(',');
    return this.game.world.getHeight(+b.tiles[0].slice(0, i), +b.tiles[0].slice(i + 1));
  }

  /** Where feet stand on a tile at a storey: up on a jetty, its building's floor; anywhere else, the ground. */
  private footOn(x: number, y: number, level: number): number {
    if (level > 0) {
      const j = this.game.buildings.jettyAt(Math.floor(x), Math.floor(y));
      const h = j ? jettyBase(this.game, j, Math.floor(x), Math.floor(y)) : null;
      if (h !== null) return h;
    }
    return this.footAt(x, y);
  }

  /**
   * The ground a wall, a railing or a plan's outline on a border stands on:
   * the corner the border starts from, which the tiles on both sides of it
   * share. Taken from the border and never from the tile that happens to draw
   * it, because which tile that is turns with the view: on a slope the other
   * tile's own corner is a tile away, and a wall drawn from it stood in the
   * air or down the face of a cliff. In the two views whose back edges are
   * the north and the west, the drawing tile's corner was this one already,
   * so those draw exactly as they did.
   */
  private edgeGround(border: Border): number {
    return this.game.world.getHeight(border.x, border.y);
  }

  /** The height a wall stands from: a jetty's at its building's floor, whatever the ground under it does. */
  private jettyWallBase(wall: Wall, border: Border, base: number): number {
    if (!wall.building) return base;
    const bld = this.game.buildings;
    const [ox, oy] = border.dir === 'h' ? [border.x, border.y - 1] : [border.x - 1, border.y];
    for (const [tx, ty] of [[border.x, border.y], [ox, oy]]) {
      const j = bld.jettyAt(tx, ty);
      if (j && j.id === wall.building) return jettyBase(this.game, j, tx, ty) ?? base;
    }
    return base;
  }

  /**
   * Where the floor of the jetty over a tile stands on the screen, as a cut
   * for what stands on the ground under it: the slab from its boards down
   * through the joists under it (`drawJettySupports`), which are over it and
   * in front of it wherever the two meet on the screen, while the walls on
   * the slab behind it are not. Drawn before the line's things (the tile is
   * on the line), so the thing is cut out of it rather than the slab laid
   * again. Null where no finished jetty floor is drawn over the tile: none,
   * the storey not looked at, or the building taken off over a cellar.
   * Worked out once a tile a frame.
   */
  private underJetty(ent: Entity): Path2D | null {
    const bld = this.game.buildings;
    const j = bld.jettyAt(ent.x, ent.y);
    if (!j) return null;
    const key = `${ent.x},${ent.y}`;
    const had = this.jettyCuts.get(key);
    if (had !== undefined) return had;
    let out: Path2D | null = null;
    const seen = this.seenLevel();
    for (let level = 1; level < j.levels && !this.cut.has(j.id); level++) {
      const f = bld.floor(level, ent.x, ent.y);
      if (!f || f.building !== j.id || floorKind(f) !== 'floor') continue;
      if (isDone(f) && (seen === null || level <= seen)) {
        const cam = this.camera;
        const top = (jettyBase(this.game, j, ent.x, ent.y) ?? this.game.world.getHeight(ent.x, ent.y)) + level * WALL_HEIGHT + 0.5;
        const pts: number[] = [];
        for (const h of [top, top - FLOOR_DEEP - JOIST_DEEP]) {
          for (const [px, py] of [[ent.x, ent.y], [ent.x + 1, ent.y], [ent.x + 1, ent.y + 1], [ent.x, ent.y + 1]]) {
            pts.push(cam.worldToScreenX(px, py), cam.worldToScreenY(px, py, h));
          }
        }
        const hull = hullOf(pts);
        out = new Path2D();
        out.rect(-1e5, -1e5, 2e5, 2e5);
        out.moveTo(hull[0], hull[1]);
        for (let i = 2; i < hull.length; i += 2) out.lineTo(hull[i], hull[i + 1]);
        out.closePath();
      }
      break;
    }
    this.jettyCuts.set(key, out);
    return out;
  }
  /** The jetty floors over tiles this frame, as `underJetty` cuts them. */
  private readonly jettyCuts = new Map<string, Path2D | null>();

  /** The ground under a jetty, in its shade: open ground, with a storey over it. */
  private jettyShade(x: number, y: number, jetty: Building): void {
    let over = false;
    for (let level = 1; level < jetty.levels && !over; level++) {
      const f = this.game.buildings.floor(level, x, y);
      over = !!f && f.building === jetty.id && isDone(f);
    }
    if (!over) return;
    const cam = this.camera;
    const w = this.game.world;
    const ctx = this.canvas.ctx;
    ctx.beginPath();
    for (const [cx, cy] of [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]) {
      ctx.lineTo(cam.worldToScreenX(cx, cy), cam.worldToScreenY(cx, cy, w.getHeight(cx, cy)));
    }
    ctx.closePath();
    ctx.fillStyle = JETTY_SHADE;
    ctx.fill();
  }

  /** What a jetty's floor rests on, under it, before it is laid: its joists or its corbels, on the sides turned to the camera. */
  private drawJettyUnder(floor: FloorTile, jetty: Building, x: number, y: number, base: number, alpha: number): void {
    if (!isDone(floor) || floorKind(floor) !== 'floor') return;
    const bld = this.game.buildings;
    const steps: Array<[Side, number, number]> = [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]];
    // On its wall, or, that wall taken down, on the beam a column at each end of that side carries (`jettyOnWall`).
    const bears = bld.jettyBearer(jetty, floor.level, x, y)?.side
      ?? steps.find(([side, dx, dy]) => bld.tileIndex.get(`${x + dx},${y + dy}`) === jetty.id && bld.carried(floor.level - 1, borderOf(x, y, side)))?.[0];
    if (!bears) return;
    const open: Side[] = [];
    for (const [side, dx, dy] of steps) {
      if (side === bears) continue;
      const beyond = bld.floor(floor.level, x + dx, y + dy);
      if (beyond && beyond.building === jetty.id) continue;
      if (bld.tileIndex.get(`${x + dx},${y + dy}`) === jetty.id) continue;
      open.push(side);
    }
    drawJettySupports(this.canvas.ctx, this.camera, x, y, base + floor.level * WALL_HEIGHT + 0.5, floor.material, bears, open, alpha);
  }

  /** The railings round a flat roof that this tile draws: on its back borders, on the roof's own level. */
  private drawTerrace(x: number, y: number, level: number, backs: Border[], own: Building | undefined, inFront: boolean): void {
    const bld = this.game.buildings;
    const { cutaway } = this.game.settings;
    for (const border of backs) {
      const wall = bld.wallOnBorder(level, border);
      if (!wall || this.cut.has(wall.building)) continue;
      if (cutaway && own?.id !== wall.building && wall.type !== 'railing') continue;
      const dim = inFront && this.wallsMyRoom(border);
      const at = (wall.building ? bld.list.get(wall.building)?.deck : undefined) ?? this.edgeGround(border);
      this.drawWall(wall, border, this.jettyWallBase(wall, border, at), dim ? (wall.type === 'railing' ? 0.7 : 0.3) : 1);
    }
  }

  /**
   * The beam two finished columns carry along a side with no full wall on it,
   * under what is over them. Seen through as the columns under it are: in
   * front of you in your room, or on a storey of it not your own.
   */
  private drawBeamOn(border: Border, level: number, inFront: boolean): void {
    const bld = this.game.buildings;
    if (!bld.carried(level, border)) return;
    const c = bld.column(level, border.x, border.y) as Column;
    if (this.cut.has(c.building)) return;
    const top = this.buildingBase(c.building) + (level + 1) * WALL_HEIGHT + 0.5 - FLOOR_DEEP;
    const dim = this.wallsMyRoom(border) && (inFront || level !== this.game.player.level);
    drawBeam(this.canvas.ctx, this.camera, border, top, c.material, dim ? 0.35 : 1);
  }

  /**
   * Per view, which of the four tiles round a corner draws its column, as an
   * offset back to the corner: the last but one of them to be drawn, after
   * the walls running away from the camera from the corner and before those
   * coming toward it. A pilaster is laid at the end of that tile's line
   * (`drawColumnsAt`).
   */
  private readonly claims = new Map<View, ReadonlyArray<readonly [number, number]>>();
  private cornerOrder(V: View): ReadonlyArray<readonly [number, number]> {
    const had = this.claims.get(V);
    if (had) return had;
    const offs: Array<[number, number]> = [[-1, -1], [0, -1], [-1, 0], [0, 0]];
    const key = ([ox, oy]: [number, number]): [number, number] => [V.d[1] * ox + V.d[2] * oy, V.e[1] * ox + V.e[2] * oy];
    offs.sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
    this.claims.set(V, offs);
    return offs;
  }
  private cornerClaim(V: View): readonly [number, number] {
    return this.cornerOrder(V)[2];
  }

  /** The four borders meeting on a corner, each with the way it runs out from it. */
  private static arms(cx: number, cy: number): Array<[Border, number, number]> {
    return [
      [{ dir: 'h', x: cx, y: cy }, 1, 0], [{ dir: 'h', x: cx - 1, y: cy }, -1, 0],
      [{ dir: 'v', x: cx, y: cy }, 0, 1], [{ dir: 'v', x: cx, y: cy - 1 }, 0, -1],
    ];
  }

  /** Half a finished wall's thickness, as it is drawn. */
  private static halfOf(w: Wall): number {
    const k = WALL_TYPE_BY_ID.get(w.type);
    return (k?.railed ? FENCE_THICK : WALL_THICK) * (k?.thick ?? 1);
  }

  /**
   * Whether a column stands engaged in walls: two or more finished full-height
   * walls of its storey meeting on its corner, which make it a pilaster
   * (`framing.ts`). As half the thickest of them, or 0 for a column standing free.
   */
  private engagedIn(level: number, cx: number, cy: number): number {
    const bld = this.game.buildings;
    let n = 0, half = 0;
    for (const [b] of Renderer.arms(cx, cy)) {
      const w = bld.wallOnBorder(level, b);
      if (!w || !isDone(w) || WALL_TYPE_BY_ID.get(w.type)?.low) continue;
      n++;
      half = Math.max(half, Renderer.halfOf(w));
    }
    return n >= 2 ? half : 0;
  }

  /**
   * Whether what stands on a border is drawn whole, as `drawStructures` draws
   * it: on a storey being looked at, not cut away, and not let go to be seen
   * through in front of you. A wall needs `w`; a beam is never cut away.
   */
  private drawnWhole(b: Border, level: number, V: View, w?: Wall): boolean {
    const { cutaway } = this.game.settings;
    const viewLevel = this.seenLevel();
    if (viewLevel !== null && level > viewLevel) return false;
    const bld = this.game.buildings;
    // The tile that draws it: the one it is a back edge of.
    const [tx, ty] = b.dir === 'h' ? (V.back.includes('n') ? [b.x, b.y] : [b.x, b.y - 1]) : (V.back.includes('w') ? [b.x, b.y] : [b.x - 1, b.y]);
    // Looking into a cellar, the building over it is not drawn at all; a beam is its columns'.
    if (this.cut.size && (w ? this.cut.has(w.building) : this.cut.has(bld.column(level, b.x, b.y)?.building ?? -1))) return false;
    if (w && cutaway && w.type !== 'railing' && !this.edgeOn(b)) {
      const building = bld.buildingAt(tx, ty);
      const jetty = building ? undefined : bld.jettyAt(tx, ty);
      const own = building ?? (level > 0 && jetty && bld.floor(level, tx, ty)?.building === jetty.id ? jetty : undefined);
      if (own?.id !== w.building) return false;
    }
    if (!this.wallsMyRoom(b)) return true;
    const p = this.game.player;
    const inFront = depthOf(V, tx, ty) > depthOf(V, p.tileX, p.tileY);
    return w ? !inFront : !(inFront || level !== p.level);
  }

  /**
   * What stands in front of a pilaster on corner `cx, cy`, or over it, and
   * hides it there: its storey's walls above its head, those coming toward the
   * camera from its face on, the beams on its head, and the walls and the
   * floors of the storey over it, each as it is drawn whole (`drawnWhole`).
   * It is drawn after all of them, with them cut out of it.
   */
  private pilasterCuts(level: number, cx: number, cy: number, base: number, head: number, r: number, V: View): Cut[] {
    const bld = this.game.buildings;
    const cam = this.camera;
    const cuts: Cut[] = [];
    const foot = base + level * WALL_HEIGHT;
    const arms = Renderer.arms(cx, cy);
    // How far past the corner a wall can run, joining the others there.
    let e = 0;
    for (const [b] of arms) for (const lv of [level, level + 1]) {
      const w = bld.wallOnBorder(lv, b);
      if (w && isDone(w)) e = Math.max(e, Renderer.halfOf(w));
    }
    for (const [b, dx, dy] of arms) {
      const w = bld.wallOnBorder(level, b);
      const full = !!w && isDone(w) && !WALL_TYPE_BY_ID.get(w.type)?.low;
      if (w && isDone(w) && this.drawnWhole(b, level, V, w)) {
        const half = w.type === 'railing' ? 0.05 : Renderer.halfOf(w);
        const top = foot + WALL_HEIGHT * this.standing(w, b);
        if (top > head) cuts.push({ x: cx, y: cy, dx, dy, t0: -e, t1: 1, half, h0: head, h1: top });
        if (cam.rotateX(dx, dy) + cam.rotateY(dx, dy) > 1e-6) cuts.push({ x: cx, y: cy, dx, dy, t0: r, t1: 1, half, h0: foot, h1: top });
      }
      if (!full && bld.carried(level, b) && this.drawnWhole(b, level, V)) {
        const top = base + (level + 1) * WALL_HEIGHT + 0.5 - FLOOR_DEEP;
        cuts.push({ x: cx, y: cy, dx, dy, t0: 0, t1: 1, half: 0.05, h0: top - BEAM_DEEP, h1: top });
      }
      const up = bld.wallOnBorder(level + 1, b);
      if (up && isDone(up) && this.drawnWhole(b, level + 1, V, up)) {
        const h0 = foot + WALL_HEIGHT;
        cuts.push({ x: cx, y: cy, dx, dy, t0: -e, t1: 1, half: Renderer.halfOf(up), h0, h1: h0 + WALL_HEIGHT * this.standing(up, b) });
      }
    }
    // The floors and the decks of the storey over it round its corner, which lie over its head, drawn whole.
    const viewLevel = this.seenLevel();
    const over = level + 1;
    if (viewLevel === null || over <= viewLevel) {
      const top = base + over * WALL_HEIGHT + 0.5;
      for (const [tx, ty] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
        const f = bld.floor(over, tx, ty);
        if (!f || !isDone(f)) continue;
        const kind = floorKind(f);
        const owner = bld.list.get(f.building);
        if (kind !== 'floor' && !(kind === 'roof' && owner && roofShapeOf(owner) === 'flat')) continue;
        // A ceiling over your room is let go to be seen through.
        if (over > this.game.player.level && this.roomTiles?.has(`${tx},${ty}`)) continue;
        cuts.push({ x: tx, y: ty + 0.5, dx: 1, dy: 0, t0: 0, t1: 1, half: 0.5, h0: top - FLOOR_DEEP, h1: top });
      }
    }
    return cuts;
  }

  /** Where a column stands on its storey and where its head is: under the floor or the eaves over it, or under a beam. */
  private columnSpan(level: number, cx: number, cy: number, base: number): [number, number] {
    const bld = this.game.buildings;
    const h0 = base + level * WALL_HEIGHT + (level > 0 ? 0.5 : 0);
    const round: Border[] = [{ dir: 'h', x: cx, y: cy }, { dir: 'h', x: cx - 1, y: cy }, { dir: 'v', x: cx, y: cy }, { dir: 'v', x: cx, y: cy - 1 }];
    const beamed = round.some((b) => bld.carried(level, b) && !(bld.wallOnBorder(level, b) && !WALL_TYPE_BY_ID.get(bld.wallOnBorder(level, b)!.type)?.low));
    return [h0, base + (level + 1) * WALL_HEIGHT + 0.5 - FLOOR_DEEP - (beamed ? BEAM_DEEP : 0)];
  }

  /**
   * The pilasters of the line of the ground being drawn, laid over its
   * structures and under its roofs and everything standing on it.
   */
  private readonly linePilasters: Array<() => void> = [];

  /**
   * The columns on the corner a tile draws (`cornerClaim`), storey by storey:
   * after the walls either side of the corner behind it and before those
   * coming toward the camera, and before the roof over them. A column
   * standing free goes up with the tile's own storey. A pilaster goes up at
   * the end of the tile's line (`linePilasters`), after every wall of the
   * line, with what hides it cut out of it (`pilasterCuts`), and before the
   * line's roofs and whatever stands on it in front. A wall coming toward the
   * camera from it whose tile is on a later line is drawn from its face on,
   * and what of that wall stands over its head goes on just before it
   * (`pilasterGuard`, `overHeads`).
   */
  private drawColumnsAt(x: number, y: number, V: View, from: number, to: number): void {
    const bld = this.game.buildings;
    const [ox, oy] = this.cornerClaim(V);
    const cx = x - ox, cy = y - oy;
    if (!bld.hasColumnAt(cx, cy)) return;
    const viewLevel = this.seenLevel();
    for (let level = from; level <= to; level++) {
      const c = bld.column(level, cx, cy);
      // Looking into a cellar, a building over it goes, its columns with it.
      if (!c || (viewLevel !== null && level > viewLevel) || this.cut.has(c.building)) continue;
      const engaged = this.engagedIn(level, cx, cy);
      if (engaged > 0) {
        this.linePilasters.push(() => {
          this.overHeads(level, cx, cy, V, engaged);
          this.columnOn(c, level, cx, cy, V, engaged);
        });
      } else this.columnOn(c, level, cx, cy, V, engaged);
    }
  }

  /**
   * One column, drawn: free, or a pilaster with what hides it cut out of it.
   * Seen through in the room you are in, in front of you or on a storey of it
   * not your own, as its walls are: a free column in front of you as the tile
   * that puts it up is, a pilaster as the last tile round its corner is, which
   * draws the walls coming toward the camera from it.
   */
  private columnOn(c: Column, level: number, cx: number, cy: number, V: View, engaged: number): void {
    const base = this.buildingBase(c.building);
    const [h0, h1] = this.columnSpan(level, cx, cy, base);
    const alpha = this.columnAlpha(level, cx, cy, V, engaged);
    const paint = c.dye ? this.painted(MATERIAL_BY_ID.get(c.material) as MaterialDef, c.dye).color : undefined;
    let cuts: Cut[] | undefined;
    if (engaged > 0) {
      // Worked out once a frame, though a pilaster is laid and its foot laid again.
      const key = `${level},${cx},${cy}`;
      cuts = this.frameCuts.get(key);
      if (!cuts) this.frameCuts.set(key, (cuts = this.pilasterCuts(level, cx, cy, base, h1, engaged + PILASTER_PROUD, V)));
    }
    drawColumn(this.canvas.ctx, this.camera, cx, cy, h0, h1, c.material, progressOf(c), alpha, PLAN_COLOR, paint, this.canvas.dpr, level === 0, engaged, cuts);
  }

  /** How far a column is let go to be seen through, as `columnOn` lays it. */
  private columnAlpha(level: number, cx: number, cy: number, V: View, engaged: number): number {
    const [ox, oy] = this.cornerOrder(V)[engaged > 0 ? 3 : 2];
    const p = this.game.player;
    const inFront = depthOf(V, cx + ox, cy + oy) > depthOf(V, p.tileX, p.tileY);
    const mine = !!this.roomTiles && [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]].some(([tx, ty]) => this.roomTiles?.has(`${tx},${ty}`));
    return mine && (inFront || level !== p.level) ? 0.35 : 1;
  }

  /** The pilasters' cuts of the frame being drawn (`columnOn`). */
  private readonly frameCuts = new Map<string, Cut[]>();

  /**
   * The foot of the column on the corner this tile is the last of the four
   * round, laid again over this tile's ground or floor: the column went up
   * before this tile was drawn (`drawColumnsAt`), and what of its foot stands
   * on this tile the ground laid since had covered.
   */
  private columnFootOn(x: number, y: number, V: View, level: number): void {
    const bld = this.game.buildings;
    const order = this.cornerOrder(V);
    const cx = x - order[3][0], cy = y - order[3][1];
    if (!bld.hasColumnAt(cx, cy)) return;
    const c = bld.column(level, cx, cy);
    const viewLevel = this.seenLevel();
    if (!c || (viewLevel !== null && level > viewLevel) || this.cut.has(c.building)) return;
    // The tile that put it up: a pilaster goes up at the end of its line, which is after this tile when this tile is on it.
    const engaged = this.engagedIn(level, cx, cy);
    if (engaged > 0 && depthOf(V, x, y) <= depthOf(V, cx + order[2][0], cy + order[2][1])) return;
    const w = this.game.world;
    const cam = this.camera;
    const ctx = this.canvas.ctx;
    const floorTop = this.buildingBase(c.building) + level * WALL_HEIGHT + 0.5;
    ctx.save();
    ctx.beginPath();
    for (const [px, py] of [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]) {
      ctx.lineTo(cam.worldToScreenX(px, py), cam.worldToScreenY(px, py, level ? floorTop : w.getHeight(px, py)));
    }
    ctx.closePath();
    ctx.clip();
    this.columnOn(c, level, cx, cy, V, engaged);
    ctx.restore();
  }

  /**
   * How a finished wall running toward the camera from a pilaster's corner on
   * its storey is drawn when its tile is on a later line than the pilaster's
   * (on the diagonal turns). Inside the pilaster it is hidden, so it is drawn
   * from the pilaster's face on, as a railing's rails stop there
   * (`railEnds`): on the screen, on the `side` of `x` that the run goes, `x`
   * being where the face it shows meets the pilaster's face -- a true
   * vertical, put on a whole device pixel (`guardedWall`). Nearer the corner
   * than that it shows over the pilaster's head, and that stretch of it,
   * inside the box `over` on the screen, is laid just before the pilaster is,
   * which then covers what of the box is under its head (`overHeads`). Null
   * for any other wall, and for a railing, whose rails stop at the face
   * anyway.
   */
  private pilasterGuard(wall: Wall, border: Border, base: number, V: View, x: number, y: number): PilasterGuard | null {
    const bld = this.game.buildings;
    if (!bld.columns.size || !isDone(wall) || wall.type === 'railing') return null;
    const cam = this.camera;
    const [ax, ay, bx, by] = borderPoints(border);
    const [ox, oy] = this.cornerClaim(V);
    for (const [cx, cy, dx, dy] of [[ax, ay, bx - ax, by - ay], [bx, by, ax - bx, ay - by]]) {
      if (cam.rotateX(dx, dy) + cam.rotateY(dx, dy) <= 1e-6) continue;
      const c = bld.column(wall.level, cx, cy);
      if (!c || !isDone(c)) continue;
      // Drawn after the pilaster only if on a later line than the tile that lays it.
      if (depthOf(V, x, y) <= depthOf(V, cx + ox, cy + oy)) continue;
      const engaged = this.engagedIn(wall.level, cx, cy);
      if (!engaged) continue;
      // Which way the run goes across the screen. Seen end on, the pilaster's face is no line to stop at.
      const side = Math.sign(cam.worldToScreenX(cx + dx, cy + dy) - cam.worldToScreenX(cx, cy));
      if (!side) return null;
      // A point on the face the camera sees, `t` along from the corner and `s` faces out from the wall's line, as `drawWall` has it.
      const half = Renderer.halfOf(wall);
      const nx = -(by - ay) * half, ny = (bx - ax) * half;
      const toward = cam.nearSide(nx, ny);
      const at = (t: number, h: number, s = 1): [number, number] => {
        const wx = cx + dx * t + nx * toward * s, wy = cy + dy * t + ny * toward * s;
        return [cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, h)];
      };
      const r = engaged + PILASTER_PROUD;
      const dpr = this.canvas.dpr;
      const edge = Math.round(at(r, 0)[0] * dpr) / dpr;
      const top = base + wall.level * WALL_HEIGHT + WALL_HEIGHT * this.standing(wall, border);
      const [, head] = this.columnSpan(wall.level, cx, cy, this.buildingBase(c.building));
      if (top <= head) return { x: edge, side, over: null, head: null };
      /*
       * From the face's edge back past the corner as far as the face can run
       * on round it (`faceEnd`), from as low as the head's line along the
       * face goes there up to the back of the wall's top -- or past what
       * grows over the top, where nothing stands on it -- on whole device
       * pixels: a box, which costs a clip nothing.
       */
      let e = 0;
      for (const [b] of Renderer.arms(cx, cy)) {
        const w = bld.wallOnBorder(wall.level, b);
        if (w && isDone(w)) e = Math.max(e, Renderer.halfOf(w));
      }
      const far = -e - 0.02;
      const upper = bld.wallOnBorder(wall.level + 1, border);
      const crest = upper && isDone(upper) ? 0 : 6;
      const [hx, hy] = at(r, head), [fx, fy] = at(far, head);
      const low = Math.max(hy, fy);
      const high = Math.min(at(r, top + crest, -1.5)[1], at(far, top + crest, -1.5)[1]) - 1;
      const out = (v: number, up: boolean): number => (up ? Math.ceil(v * dpr) : Math.floor(v * dpr)) / dpr;
      const x0 = side > 0 ? out(fx, false) : edge, x1 = side > 0 ? edge : out(fx, true);
      // The head's line along the face, at either side of the box.
      const lineAt = (sx: number): number => hy + ((fy - hy) * (sx - hx)) / (fx - hx);
      return { x: edge, side, over: [x0, out(high, false), x1, out(low, true)], head: [lineAt(x0), lineAt(x1)] };
    }
    return null;
  }

  /**
   * A wall run toward the camera out of a pilaster laid before it, as its
   * guard says (`pilasterGuard`): from the pilaster's face on. What of it
   * stands over the pilaster's head nearer the corner went on before the
   * pilaster did (`overHeads`), and the two meet on a whole device pixel, so
   * nothing of the pilaster shows between them and nothing is laid twice.
   */
  private guardedWall(wall: Wall, border: Border, base: number, alpha: number, g: PilasterGuard): void {
    const ctx = this.canvas.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.side > 0 ? g.x : g.x - 1e5, -1e5, 1e5, 2e5);
    ctx.clip();
    this.drawWall(wall, border, base, alpha);
    ctx.restore();
  }

  /**
   * Where `drawStructures` draws the wall on a border on a storey, and how:
   * from the tile it is a back edge of, at that tile's base, let go to be
   * seen through in front of you in your room. Null where it is not drawn: on
   * a storey above the one looked at, past its tile's storeys, or cut away.
   */
  private wallAsDrawn(b: Border, level: number, V: View): { wall: Wall; base: number; alpha: number; x: number; y: number } | null {
    const bld = this.game.buildings;
    const wall = bld.wallOnBorder(level, b);
    if (!wall) return null;
    const { cutaway } = this.game.settings;
    const viewLevel = this.seenLevel();
    if (viewLevel !== null && level > viewLevel) return null;
    const [tx, ty] = b.dir === 'h' ? (V.back.includes('n') ? [b.x, b.y] : [b.x, b.y - 1]) : (V.back.includes('w') ? [b.x, b.y] : [b.x - 1, b.y]);
    const building = bld.buildingAt(tx, ty);
    if (level >= (building ? building.levels : Math.max(1, this.maxLevelsAround(tx, ty)))) return null;
    const jetty = building ? undefined : bld.jettyAt(tx, ty);
    const own = building ?? (level > 0 && jetty && bld.floor(level, tx, ty)?.building === jetty.id ? jetty : undefined);
    if (cutaway && own?.id !== wall.building && wall.type !== 'railing' && !this.edgeOn(b)) return null;
    if (this.cut.has(wall.building)) return null;
    const p = this.game.player;
    const dim = depthOf(V, tx, ty) > depthOf(V, p.tileX, p.tileY) && this.wallsMyRoom(b);
    // On its building's deck, on piers, as `drawStructures` stands it.
    const base = this.jettyWallBase(wall, b, (wall.building ? bld.list.get(wall.building)?.deck : undefined) ?? this.edgeGround(b));
    return { wall, base, alpha: dim ? (wall.type === 'railing' ? 0.7 : 0.3) : 1, x: tx, y: ty };
  }

  /**
   * What stands over a pilaster's head of the walls running toward the
   * camera from it whose tile draws them after it (`pilasterGuard`): the
   * back edges of the last tile round its corner, in the order that tile
   * draws them. Laid just before the pilaster, after every wall of its line,
   * so that the pilaster, and the column on its corner a storey up, which
   * stand over it, go on over it. A column standing free up there went up
   * with its tile, before this, and goes on again over it. Where the
   * pilaster is let go to be seen through, what of the wall is under its
   * head would show through it, so the box is cut along the head's line.
   */
  private overHeads(level: number, cx: number, cy: number, V: View, engaged: number): void {
    const ctx = this.canvas.ctx;
    const [ox, oy] = this.cornerOrder(V)[3];
    const ghost = this.columnAlpha(level, cx, cy, V, engaged) < 1;
    for (const b of [borderOf(cx + ox, cy + oy, V.back[0]), borderOf(cx + ox, cy + oy, V.back[1])]) {
      const d = this.wallAsDrawn(b, level, V);
      const g = d && this.pilasterGuard(d.wall, b, d.base, V, d.x, d.y);
      if (!d || !g?.over) continue;
      const [x0, y0, x1, y1] = g.over;
      ctx.save();
      ctx.beginPath();
      if (ghost && g.head) {
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, g.head[1]); ctx.lineTo(x0, g.head[0]);
        ctx.closePath();
      } else ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      this.drawWall(d.wall, b, d.base, d.alpha);
      const up = this.game.buildings.column(level + 1, cx, cy);
      const viewLevel = this.seenLevel();
      if (up && (viewLevel === null || level + 1 <= viewLevel) && !this.engagedIn(level + 1, cx, cy)) this.columnOn(up, level + 1, cx, cy, V, 0);
      ctx.restore();
    }
  }

  /**
   * What stands at each end of a section of railing: a post, drawn once at
   * each corner by the first finished railing round it, or a wall or a column
   * that is the post there and that the rails stop at. A section still going
   * up stands its own post where no finished railing has one.
   */
  private railEnds(wall: Wall, border: Border): RailEnds {
    const bld = this.game.buildings;
    const ends: RailEnds = { post: [false, false], cut: [0, 0] };
    const [ax, ay, bx, by] = borderPoints(border);
    ([[ax, ay], [bx, by]] as Array<[number, number]>).forEach(([cx, cy], i) => {
      const round: Border[] = [{ dir: 'h', x: cx, y: cy }, { dir: 'v', x: cx, y: cy }, { dir: 'h', x: cx - 1, y: cy }, { dir: 'v', x: cx, y: cy - 1 }];
      let owner: Border | undefined;
      let stop = -1;
      for (const b of round) {
        const w = bld.wallOnBorder(wall.level, b);
        if (!w || !isDone(w)) continue;
        if (w.type === 'railing') {
          owner ??= b;
          continue;
        }
        // A wall meeting it: in line, the rails run to its end; square to it, to its face.
        const half = WALL_TYPE_BY_ID.get(w.type)?.railed ? FENCE_THICK : WALL_THICK * (WALL_TYPE_BY_ID.get(w.type)?.thick ?? 1);
        stop = Math.max(stop, b.dir === border.dir ? 0 : half);
      }
      const col = bld.column(wall.level, cx, cy);
      // A column the rails stop at: at its shaft, or at a pilaster's face.
      if (col && isDone(col)) {
        const engaged = this.engagedIn(wall.level, cx, cy);
        stop = Math.max(stop, engaged > 0 ? engaged + PILASTER_PROUD : 0.05);
      }
      if (stop >= 0) ends.cut[i] = stop;
      else if (!isDone(wall)) ends.post[i] = !owner;
      else ends.post[i] = !!owner && owner.dir === border.dir && owner.x === border.x && owner.y === border.y;
    });
    return ends;
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
      const b = this.game.buildings.buildingAt(x + dx, y + dy) ?? this.game.buildings.jettyAt(x + dx, y + dy);
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
    /*
     * How far on the moss is (`greening.ts`): the days since it was poured or
     * scrubbed, a little further by water, as paving's is. On ground in sight
     * only, and not when the view is too far out to see a cushion.
     */
    const days = lit && zoom >= 0.6 ? slabGreen(this.game, f, this.greenAt) ?? 0 : 0;
    const wet = days > 0 ? this.wetness(x, y) : 0;
    const grown = greenShows(days, 0, wet);
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
      /*
       * The moss on this face: cushions climbing from its foot along the
       * ground line, and a row along its top edge with the damp run down from
       * under it, more on a face turned from the sun in the south-east.
       */
      if (grown > 0) {
        // A north or a west face is the shady one, as a wall's is (`greenShows`).
        const st = Math.round(greenShows(days, nx + ny < 0 ? 1 : 0, wet) * PAVE_STAGES);
        const v = Math.floor(hashOf(x, y, i, 71) * 3);
        const lip = mossStrip('lip', v, st), foot = mossStrip('foot', (v + 1) % 3, st);
        if (lip || foot) {
          // Picture px to the screen: along the face, and straight down it at a metre to the metre.
          const up = (10 * HEIGHT_SCALE * zoom) / PPM;
          ctx.save();
          face();
          ctx.clip();
          if (lip) {
            ctx.save();
            ctx.transform((px(j) - px(i)) / (4 * PPM), (py(j, f.top) - py(i, f.top)) / (4 * PPM), 0, up, px(i), py(i, f.top));
            ctx.drawImage(lip, 0, 0);
            ctx.restore();
          }
          if (foot) {
            ctx.save();
            ctx.transform((px(j) - px(i)) / (4 * PPM), (py(j, c[j]) - py(i, c[i])) / (4 * PPM), 0, up, px(i), py(i, c[i]) - foot.height * up);
            ctx.drawImage(foot, 0, 0);
            ctx.restore();
          }
          ctx.restore();
        }
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
      if (paved) this.paving(t, x, y, data, quad, 0, lit);
      else {
        this.laidOver(concrete(), quad, 0, 'overlay');
        // And moss in the margin tooled round a bare top.
        const top = grown > 0 ? slabTopMoss(Math.round(grown * PAVE_STAGES)) : null;
        if (top) this.laidOver(top, quad, 0, 'source-over');
      }
    }
    if (f.pool) {
      const water = this.springWater;
      drawPool(ctx, cam, {
        x, y, top: f.top, time: lit ? this.time : null, concrete: CONCRETE,
        poolTop: (px, py) => {
          const o = this.game.foundationAt(px, py);
          return o?.pool && foundationDone(o) ? o.top : null;
        },
        slabTop: (px, py) => {
          const o = this.game.foundationAt(px, py);
          return o && foundationDone(o) ? o.top : null;
        },
        spillsAt: (px, py) => world.water?.spillsAt(px, py),
        channels: this.game.bridges.size ? (px, py) => this.aqueducts.cutsAt(px, py) : undefined,
        ground: (cx, cy) => world.getHeight(cx, cy),
        falls: world.water ? {
          view: water.view,
          row: (tx, ty) => depthOf(cam.view, tx, ty),
          foot: (row, placed, u0, u1) => water.footAfter(row, placed, u0, u1),
          mist: (placed) => water.mistOf(placed),
          foam: water.foam,
        } : undefined,
        runs: this.poolRuns,
      });
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
    // Seen through, or after dark, when a lamp in the room may be falling on it: as it always was. Otherwise a picture (`baked`).
    if (alpha < 1 || this.game.darkness() >= LAMP_DARK) {
      this.drawFloorNow(floor, x, y, base, alpha);
      return;
    }
    const cam = this.camera;
    const h = base + floor.level * WALL_HEIGHT;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [u, v] of [[-0.4, -0.4], [1.4, -0.4], [1.4, 1.4], [-0.4, 1.4]]) {
      for (const z of [h - WALL_HEIGHT * 0.4, h + WALL_HEIGHT * 0.25]) {
        const sx = cam.worldToScreenX(x + u, y + v), sy = cam.worldToScreenY(x + u, y + v, z);
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
    }
    const key = `f|${floor.level}|${x},${y}|${floor.material}|${floor.kind ?? ''}|${floor.dye ?? ''}|${isDone(floor) ? 1 : 0}|${base}`;
    this.baked(key, cam.worldToScreenX(x, y), cam.worldToScreenY(x, y, h), [x0, y0, x1, y1], () => this.drawFloorNow(floor, x, y, base, alpha));
  }

  private drawFloorNow(floor: FloorTile, x: number, y: number, base: number, alpha: number): void {
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
      // Glass over your head is a tint of its colour: its lead drawn faint was a second grid over the room under it.
      if (alpha < 1 && bare.seeThrough) {
        ctx.fillStyle = rgb(fl.mean, 0.4);
        ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
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
      // Out on a jetty the plan hangs in front of the wall under it, which a faint line is lost on.
      if (floor.level > 0 && !this.game.buildings.tileIndex.has(`${x},${y}`)) ctx.globalAlpha = alpha;
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
    const bld = this.game.buildings;
    // The ground floor of a tile on piers is a deck standing clear of the ground, and it has an edge too.
    const decked = floor.level === 0 && bld.pierTiles.size > 0 && bld.onPiers(x, y);
    if (done && (floor.level > 0 || decked)) {
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
        if (!decked && beyond && floorKind(beyond) !== 'stairs') continue;
        // On a deck, beyond is the building's own floor at the deck's height: level ground, or another finished deck.
        if (decked && bld.buildingAt(x + nx, y + ny)?.id === floor.building
          && (!bld.onPiers(x + nx, y + ny) || (!!beyond && isDone(beyond)))) continue;
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
                              : wall.material === 'stained_glass' ? glasswork()
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
  /**
   * Walls and roofs, drawn once into a picture of their own and copied after
   * that: in a village they were most of a frame, every frame, and they change
   * when somebody builds, not when the camera moves.
   *
   * Like the ground's edges (`hems`) a picture is good only where it lands on
   * the same fraction of a pixel, which the camera's whole-pixel step keeps
   * true; `ax`, `ay` is a point on the screen that moves with the thing, to
   * tell. Each picture is also made again after `BAKE_LIFE` seconds whatever
   * else happens, a little sooner or later for each so they do not all come
   * due in one frame: a wall reads its neighbours, its ivy and its wetness,
   * and what any of those do shows within that, rather than having to be
   * named here. What changes faster than that -- a lamp behind it at night, a
   * room it is seen through, the wash of remembered ground -- is drawn as it
   * always was (`drawWall`, `drawPitchedRoof`).
   */
  private bakes = new Map<string, Baked>();
  private bakePixels = 0;

  private baked(key: string, ax: number, ay: number, box: [number, number, number, number], draw: () => void): void {
    if (!this.hemSteady) {
      draw();
      return;
    }
    const ctx = this.canvas.ctx;
    const dpr = this.canvas.dpr;
    const had = this.bakes.get(key);
    if (had && this.time - had.at < had.life && this.time >= had.at) {
      const dx = (ax - had.ax) * dpr, dy = (ay - had.ay) * dpr;
      const rx = Math.round(dx), ry = Math.round(dy);
      if (Math.abs(dx - rx) < 0.02 && Math.abs(dy - ry) < 0.02) {
        ctx.drawImage(had.cv, had.bx + rx / dpr, had.by + ry / dpr, had.cv.width / dpr, had.cv.height / dpr);
        return;
      }
    }
    const bx = Math.floor(box[0] * dpr) - 2, by = Math.floor(box[1] * dpr) - 2;
    const w = Math.ceil(box[2] * dpr) + 2 - bx, h = Math.ceil(box[3] * dpr) + 2 - by;
    // Off the screen altogether, or too big to be worth keeping: drawn as it always was.
    const W = this.canvas.el.width, H = this.canvas.el.height;
    if (w <= 0 || h <= 0 || w * h > BAKE_MOST || bx > W || by > H || bx + w < 0 || by + h < 0) {
      draw();
      return;
    }
    let cv = had?.cv;
    if (had) {
      this.bakePixels -= had.cv.width * had.cv.height;
      this.bakes.delete(key);
    }
    if (!cv) cv = document.createElement('canvas');
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    } else (cv.getContext('2d') as CanvasRenderingContext2D).clearRect(0, 0, w, h);
    const g = cv.getContext('2d') as CanvasRenderingContext2D;
    g.setTransform(dpr, 0, 0, dpr, -bx, -by);
    // What the screen's pen was left holding, which the drawing reads without setting: the ends of a line, the joins, the type.
    g.lineCap = ctx.lineCap;
    g.lineJoin = ctx.lineJoin;
    g.miterLimit = ctx.miterLimit;
    g.lineWidth = ctx.lineWidth;
    g.strokeStyle = ctx.strokeStyle;
    g.fillStyle = ctx.fillStyle;
    g.font = ctx.font;
    g.textAlign = ctx.textAlign;
    g.textBaseline = ctx.textBaseline;
    g.setLineDash(ctx.getLineDash());
    // Everything that draws a wall or a roof draws on `this.canvas.ctx`, so for the length of it that is the picture.
    const canvas = this.canvas as { ctx: CanvasRenderingContext2D };
    canvas.ctx = g;
    try {
      draw();
    } finally {
      canvas.ctx = ctx;
    }
    if (this.bakePixels + w * h > BAKE_PIXELS) {
      this.bakes.clear();
      this.bakePixels = 0;
    }
    // Due again somewhere in the second half of a life to the first half of the next, by the key, so they come due apart.
    let spread = 0;
    for (let i = 0; i < key.length; i++) spread = (spread * 31 + key.charCodeAt(i)) >>> 0;
    this.bakes.set(key, { cv, ax, ay, bx: bx / dpr, by: by / dpr, at: this.time, life: BAKE_LIFE * (0.75 + (spread % 1000) / 2000) });
    this.bakePixels += w * h;
    ctx.drawImage(cv, bx / dpr, by / dpr, w / dpr, h / dpr);
  }

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
    // Seen through, half built, taking the wash off remembered ground, or with a lamp behind it at night: as it always was.
    if (alpha < 1 || this.wallLift || !isDone(wall) || this.lampBehind(wall, border) > 0) {
      this.drawWallNow(wall, border, base, alpha);
      return;
    }
    const cam = this.camera;
    const [ax, ay, bx, by] = borderPoints(border);
    const dx = bx - ax, dy = by - ay;
    // The box it can reach: half a tile past either end and either face, from under its foot to well over its top.
    const lo = base + (wall.level - 0.3) * WALL_HEIGHT, hi = base + (wall.level + 1.6) * WALL_HEIGHT;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of [-0.5, 1.5]) for (const s of [-0.5, 0.5]) for (const z of [lo, hi]) {
      const wx = ax + dx * t - dy * s, wy = ay + dy * t + dx * s;
      const sx = cam.worldToScreenX(wx, wy), sy = cam.worldToScreenY(wx, wy, z);
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    const key = `w|${wall.level}|${border.dir}${border.x},${border.y}|${wall.type}|${wall.material}|${wall.dye ?? ''}|${wall.building}|${base}`;
    this.baked(key, cam.worldToScreenX(ax, ay), cam.worldToScreenY(ax, ay, base), [x0, y0, x1, y1],
      () => this.drawWallNow(wall, border, base, alpha));
  }

  private drawWallNow(wall: Wall, border: Border, base: number, alpha: number): void {
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
    // In sight in front of remembered ground, it takes the wash off it -- finished and solid: not one seen through, half built or a railing.
    if (this.wallLift && alpha >= 1 && !kind?.railed && isDone(wall)) this.liftWall(px, py);
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
    /*
     * Glass let go in front of the room you are in is a breath of its colour
     * and the line of its frame. Drawn faint in full, its lead and its marble
     * were a cage laid over everything in the room.
     */
    if (done && alpha < 1 && bare.seeThrough) {
      quad(0, 1, 0, 1);
      ctx.fillStyle = rgb(mat.color, lit, 0.4);
      ctx.fill();
      ctx.strokeStyle = rgb(mat.trim, lit, 0.9);
      ctx.lineWidth = Math.max(0.75, 0.75 * zoom);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
      return;
    }
    if (!done && wall.type === 'railing') {
      /*
       * A railing going up: inside the outline of the whole of it, at its
       * height, its posts go in first, with the first quarter of the
       * materials, and then its rails and balusters from one end along to
       * the other as the rest go in.
       */
      quad(0, 1, 0, 1);
      ctx.fillStyle = rgb(mat.color, lit, 0.08);
      ctx.fill();
      ctx.strokeStyle = PLAN_COLOR;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      const progress = progressOf(wall);
      if (progress > 0) {
        const ends = this.railEnds(wall, border);
        const along = Math.max(0, (progress - 0.25) / 0.75);
        const c0 = ends.cut[0], c1 = 1 - ends.cut[1];
        ends.cut = [c0, 1 - (c0 + (c1 - c0) * along)];
        drawRailing(ctx, cam, border, h0, wall.material, ends, alpha, wall.dye ? mat.color : undefined, this.canvas.dpr);
      }
      ctx.globalAlpha = 1;
      return;
    }
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
    // A railing is a run of rail and balusters on posts, in a drawing of its own (`framing.ts`).
    if (wall.type === 'railing') {
      drawRailing(ctx, cam, border, h0, wall.material, this.railEnds(wall, border), alpha, wall.dye ? mat.color : undefined, this.canvas.dpr);
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
      // A ground-floor wall standing on the deck of a tile on piers is out of reach of the ground: nothing grows up it from there, and no damp.
      const aloft = wall.level === 0 && bld.pierTiles.size > 0
        && (bld.onPiers(border.x, border.y) || bld.onPiers(border.dir === 'h' ? border.x : border.x - 1, border.dir === 'h' ? border.y - 1 : border.y));
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
        // And the ivy it has grown since it was built (`greening.ts`), over everything.
        this.wallIvy(wall, px, py, tall, nx * toward, ny * toward, false, indoors);
        ctx.globalAlpha = 1;
        return;
      }
      /*
       * An archway is the same section with a hole in it, so it is the same
       * blit with a different picture -- not a shape drawn over the stone.
       * The picture's hole and the clip below both come out of `ARCH`, so
       * there is one statement about where a doorway is.
       */
      // gates: a portcullis is a gateway as wide as a double door, under a segmental head, with its grille hung in it
      // (`gatewayArch`, `drawGrille`): the face's own picture with that hole cut out of it and dressed (`gatewayPicture`).
      const gateway = wall.type === 'portcullis';
      const arched = wall.type === 'arch' || gateway;
      const windowed = wall.type === 'window';
      const doored = wall.type === 'door';
      const gated = wall.type === 'double_door';
      // A shop counter is cut and dressed as a bay is, and is a shop rather than a window (`counter.ts`).
      const countered = wall.type === 'counter';
      const bayed = wall.type === 'bay' || countered;
      const cut = arched || windowed || doored || gated || bayed;
      /** Whichever hole this section has, added to the path that is open. */
      const hole = (s: number): void => {
        if (gateway) { gatewayArch(ctx, { px, py }, zoom, WALL_HEIGHT).hole(s); return; }
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
      /*
       * gates: a portcullis's gateway, its way through laid first and unclipped -- the threshold, the shade,
       * the wall's thickness, the grooves and the grille, each kept to the opening by its own shape -- and its
       * picture, with the hole cut and the dressing laid, over the lot (`gates.ts`). The hedge does not turn
       * the corner into it, as it does into an archway: what grows on the face stops at the jambs, as the ivy
       * stops round the head (`gatewayClear`), so nothing stands in the grille's way.
       */
      const gw = gateway ? gatewayArch(ctx, { px, py }, zoom, WALL_HEIGHT) : undefined;
      if (gw) {
        // A wall drawn faint, in front of the room you are in, is seen through: there it is kept to the opening.
        const faint = alpha < 1;
        if (faint) { ctx.save(); gw.outline(1); ctx.clip(); }
        this.threshold(cob, { px, py, quad }, gw.t0, gw.t1, zoom);
        this.archShade({ px, py, quad }, zoom, gw, () => gw.outline(1));
        this.archDepth(cob.reveal, 1, { px, py, quad }, zoom, gw);
        drawGrooves(ctx, { px, py }, zoom, gw);
        this.grille(wall, border, { px, py }, lit, gw);
        if (faint) ctx.restore();
      }
      if (cob.under) {
        if (gw) {
          // Round the opening rather than clipped to it.
          flush(T0, T1, -sunk, 1);
          gw.hole(1);
          ctx.fillStyle = rgb(cob.under, 1);
          ctx.fill('evenodd');
        } else {
          onStone();
          flush(T0, T1, -sunk, 1);
          ctx.fillStyle = rgb(cob.under, 1);
          ctx.fill();
          offStone();
        }
      }
      /** gates: the face's picture with a portcullis's gateway in it. */
      const gatePic = (img: HTMLCanvasElement): HTMLCanvasElement =>
        gatewayPicture(img, WALL_HEIGHT, cob.reveal.map((c) => c * 1.3) as unknown as [number, number, number], cob.line);
      blit(gateway ? gatePic(cob.face[v])
        : arched ? cob.arch[v]
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
        gateway ? [GATEWAY.t0 - 0.12, GATEWAY.t1 + 0.12] : arched ? [ARCH.t0, ARCH.t1] : doored ? [DOOR.t0, DOOR.t1] : gated ? [DOUBLE.t0, DOUBLE.t1] : null,
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
      if (arched && !gw) {
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
        if (cob.growth && wall.level === 0 && !indoors && !aloft) blit(cob.base[v], 0, 1, -1);
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
      // gates: and the same line round a portcullis's gateway, whose way through went in under its picture.
      if (gw) {
        gw.rim(1);
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
      if (countered) this.drawCounterPart('inside', wall, border, { px, py, quad }, zoom, lit, { line: cob.line, reveal: cob.reveal, wood: cob.beam, woodLine: cob.beamLine });
      if (bayed && !countered) {
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
      if (wall.level === 0 && !indoors && !aloft) {
        onStone();
        blit(cob.foot[v], 0, 1, 1, false, 0, cob.under ? 0.004 : 0, turned);
        // The face's half of the hedge, where a doorway took the other half
        // round the corner with it.
        if (cob.growth && arched) blit(cob.base[v], 0, 1);
        offStone();
        // Anywhere else it is one picture and goes on whole: a bush that has
        // grown up in front of a window stands in front of it, glass and all --
        // but not up into a shop counter's opening, where the board and the
        // goods stand (`counter.ts`).
        if (cob.growth && !arched) {
          if (countered) this.counterCut({ px, py });
          blit(cob.base[v], 0, 1);
          if (countered) ctx.restore();
        }
        // gates: a portcullis's gateway takes a cart gate's tussocks, kept off its opening as its ivy is (`gatewayClear`).
        if (cob.growth && arched) blit(gateway ? gatewayClear(cob.gateWeed[v], WALL_HEIGHT) : cob.archWeed[v], 0, 1);
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
          const zone = gateway ? [GATEWAY.t0, GATEWAY.t1, GATEWAY.crown + 0.16] : arched ? [ARCH.t0, ARCH.t1, 0.76] : windowed ? [WINDOW.t0, WINDOW.t1, 0.78]
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
        const ground = wall.level === 0 && !indoors && !aloft;
        gleamed(gateway ? gatePic(cob.face[v]) : arched ? cob.arch[v] : windowed ? cob.window[v] : doored ? cob.door[v] : gated ? cob.gate[v] : bayed ? cob.bay[v] : cob.face[v], ground ? (cob.plinth + 8) / cob.h : 0, turned);
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
        // Round a shop counter's opening, board and awning, as its hedge goes (`counterCut`).
        if (countered) this.counterCut({ px, py });
        // gates: kept off a portcullis's gateway, to the stone round its head (`gatewayClear`).
        blit(gateway ? gatewayClear(cob.spill[v], WALL_HEIGHT, 1 + cob.pad / cob.h) : cob.spill[v], 0, 1 + cob.pad / cob.h);
        if (countered) ctx.restore();
        // And the tongue of it that hangs into the opening, on the variants
        // whose curtain reaches that far along the wall.
        // gates: and over a portcullis's gateway, kept to the stone round its head (`gatewayClear`).
        if (arched) blit(gateway ? gatewayClear(cob.gateIvy[v], WALL_HEIGHT) : cob.archIvy[v], 0, 1);
        if (windowed) blit(cob.winIvy[v], 0, 1);
        if (doored) blit(cob.doorIvy[v], 0, 1);
        if (gated) blit(cob.gateIvy[v], 0, 1);
      }
      // And the ivy it has grown since it was built (`greening.ts`): after the painted ivy, and unlit, as that is.
      this.wallIvy(wall, px, py, tall, nx * toward, ny * toward, roofed, indoors);
      if (bayed && !indoors && !countered) this.paintedBay(cob, { px, py, quad }, zoom, this.lampBehind(wall, border));
      if (countered) this.drawCounterPart('front', wall, border, { px, py, quad }, zoom, lit, { line: cob.line, reveal: cob.reveal, wood: cob.beam, woodLine: cob.beamLine });
      if (!cut) this.wallOpenings(wall, mat, lit, { px, py, quad }, zoom, border);
      if (wall.type === 'hidden_door' && this.game.buildings.seenType(wall) === 'hidden_door') drawHiddenMark(ctx, { px, py }, zoom, cob.line);
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
    // A painted wall of stone grows ivy as a bare one does (`greening.ts`).
    {
      const up = this.game.buildings.wallOnBorder(wall.level + 1, border);
      const seenX = border.dir === 'h' ? border.x : (toward > 0 ? border.x - 1 : border.x);
      const seenY = border.dir === 'h' ? (toward > 0 ? border.y : border.y - 1) : border.y;
      this.wallIvy(wall, px, py, tall, nx * toward, ny * toward, !!up && isDone(up), !!this.game.buildings.buildingAt(seenX, seenY));
    }
    if (wall.type === 'hidden_door' && this.game.buildings.seenType(wall) === 'hidden_door') drawHiddenMark(ctx, { px, py }, zoom, mat.trim);
    ctx.globalAlpha = 1;
  }

  /**
   * The ivy a wall has grown (`greening.ts`), on the face the camera is on.
   *
   * Laid out by `ivyLayout` off where the face is and which side of its wall,
   * so each face grows its own and grows the same ones as it ages: trails off
   * the head of a wall nothing stands on, clumps and stems from the foot of
   * one on the ground, clear of its openings. How far it has got is the days
   * since the wall was finished or cleared, more on a face turned from the sun
   * -- the light comes from the south-east -- and on one by water. Out of
   * doors only; the inside of a room grows nothing.
   *
   * `ox`, `oy` is which way the face looks, in the world.
   */
  private wallIvy(wall: Wall, px: (t: number, k: number, s?: number) => number, py: (t: number, k: number, s?: number) => number,
    tall: number, ox: number, oy: number, roofed: boolean, indoors: boolean): void {
    // Too far out to see a leaf, it is not drawn at all: shapes and colours only.
    if (this.camera.zoom < 0.6) return;
    const days = wallGreen(this.game, wall, this.greenAt);
    if (!days) return;
    /*
     * Moss along its coping first, where nothing stands on it, so the clumps
     * of any trail over the top lie over the moss: seen from indoors as well,
     * since a top is a top from either side.
     */
    if (!roofed) {
      const g = greenShows(days, 0, this.wetness(wall.x, wall.y));
      const cm = capMoss(Math.floor(hashOf(wall.x, wall.y, wall.level, wall.dir === 'h' ? 3 : 4) * 3), Math.round(g * PAVE_STAGES));
      if (cm) {
        const ctx = this.canvas.ctx;
        const x0 = px(0, 1, 1), y0 = py(0, 1, 1);
        ctx.save();
        ctx.transform((px(1, 1, 1) - x0) / CAP_W, (py(1, 1, 1) - y0) / CAP_W, (px(0, 1, -1) - x0) / CAP_D, (py(0, 1, -1) - y0) / CAP_D, x0, y0);
        ctx.drawImage(cm, 0, 0);
        ctx.restore();
      }
    }
    if (indoors) return;
    const kind = WALL_TYPE_BY_ID.get(wall.type);
    // Turned from the sun, which stands in the south-east: a north or a west face is the shady one (`greenShows`).
    const shade = ox + oy < 0 ? 1 : 0;
    const tx = wall.dir === 'h' ? wall.x : wall.x - (ox < 0 ? 1 : 0);
    const ty = wall.dir === 'h' ? wall.y - (oy < 0 ? 1 : 0) : wall.y;
    const wet = this.wetness(tx, ty);
    const keep: Keep[] = [];
    switch (wall.type) {
      case 'arch': keep.push({ t0: ARCH.t0, t1: ARCH.t1, k0: 0, k1: 0.8 }); break;
      case 'portcullis': keep.push({ t0: GATEWAY.t0 - 0.06, t1: GATEWAY.t1 + 0.06, k0: 0, k1: GATEWAY.crown + 0.16 }); break;
      case 'window': keep.push({ t0: WINDOW.t0, t1: WINDOW.t1, k0: WINDOW.k0 - 0.05, k1: WINDOW.k1 + 0.1 }); break;
      case 'bay': keep.push({ t0: BAY.t0, t1: BAY.t1, k0: BAY.k0 - 0.05, k1: BAY.k1 + 0.08 }); break;
      // A counter's opening, its board and the awning over it (`counter.ts`).
      case 'counter': keep.push(COUNTER_KEEP); break;
      case 'door': keep.push({ t0: DOOR.t0, t1: DOOR.t1, k0: 0, k1: DOOR.k1 + 0.08 }); break;
      case 'double_door': keep.push({ t0: DOUBLE.t0, t1: DOUBLE.t1, k0: 0, k1: DOUBLE.k1 + 0.08 }); break;
      case 'fence_gate': case 'iron_gate': keep.push({ t0: FENCE_GAP.t0, t1: FENCE_GAP.t1, k0: 0, k1: 1 }); break;
    }
    const low = !!kind?.low;
    const height = (WALL_HEIGHT * tall) / 10;
    const strands = ivyLayout({
      seed: Math.floor(hashOf(wall.x, wall.y, wall.dir === 'h' ? 0 : 1, (ox + oy > 0 ? 1 : 0) + wall.level * 2) * 2 ** 31),
      grown: greenShows(days, shade, wet),
      vigour: vigour(wall.x + (wall.dir === 'h' ? 0.5 : 0), wall.y + (wall.dir === 'v' ? 0.5 : 0)),
      shade, wet, height,
      top: low || !roofed,
      ground: wall.level === 0,
      below: wall.level > 0,
      keep,
    });
    if (!strands.length) return;
    const ctx = this.canvas.ctx;
    /*
     * And on a shop counter, never over its opening, its board or the awning
     * over it: a strand rooted clear of `keep` still spreads its picture
     * across them, so the face is cut to everything but that box.
     */
    const cutOut = wall.type === 'counter';
    if (cutOut) this.counterCut({ px, py });
    // The face's two axes on the screen: a metre along it, and a metre up it.
    const ax = (px(1, 0) - px(0, 0)) / 4, ay = (py(1, 0) - py(0, 0)) / 4;
    const kx = (px(0, 1) - px(0, 0)) / height, ky = (py(0, 1) - py(0, 0)) / height;
    // A face that runs right to left on the screen takes its pictures the other way round, so their light stays on the left.
    const flip = ax < 0 ? -1 : 1;
    const a = (flip * ax) / PPM, b = (flip * ay) / PPM, c = -kx / PPM, d = -ky / PPM;
    /*
     * Each picture taken down once to about the size it is drawn at (`atSize`),
     * by the larger of its two scales on the face: sixty-four pixels to the
     * metre skewed straight down to a fraction of that costs several times the
     * same blit at its own size.
     */
    const scale = Math.max(Math.hypot(a, b), Math.hypot(c, d));
    // In device pixels: a close view on a sharp screen draws them at their own size or more, and takes them as they are.
    const smaller = scale * this.canvas.dpr < 0.9;
    for (const s of strands) {
      const pic = strandPic(s.kind, s.v, s.stage, this.bloom);
      if (!pic) continue;
      const k = s.kind === 'hang' ? 1 : 0;
      const ox0 = px(s.t, k), oy0 = py(s.t, k);
      const img = smaller ? this.atSize(pic.img, pic.img.width * scale, pic.img.height * scale) : pic.img;
      const sx = img.width / pic.img.width, sy = img.height / pic.img.height;
      ctx.save();
      ctx.transform(a / sx, b / sx, c / sy, d / sy, ox0 - a * pic.ax - c * pic.ay, oy0 - b * pic.ax - d * pic.ay);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    }
    if (cutOut) ctx.restore();
  }

  /**
   * Clip what is drawn next to a shop counter's face to everything but its
   * opening, its board and its awning (`COUNTER_KEEP`): what grows on the
   * wall goes round a shop, not across it. Saves the context; the caller
   * restores it.
   */
  private counterCut(g: { px: (t: number, k: number, s?: number) => number; py: (t: number, k: number, s?: number) => number }): void {
    const ctx = this.canvas.ctx;
    const quadAt = (t0: number, t1: number, k0: number, k1: number): void => {
      ctx.moveTo(g.px(t0, k0), g.py(t0, k0));
      ctx.lineTo(g.px(t1, k0), g.py(t1, k0));
      ctx.lineTo(g.px(t1, k1), g.py(t1, k1));
      ctx.lineTo(g.px(t0, k1), g.py(t0, k1));
      ctx.closePath();
    };
    ctx.save();
    ctx.beginPath();
    quadAt(-1, 2, -1, 2);
    quadAt(COUNTER_KEEP.t0, COUNTER_KEEP.t1, COUNTER_KEEP.k0, COUNTER_KEEP.k1);
    ctx.clip('evenodd');
  }

  /** How near water a tile stands, nought to one, for what greens beside it: kept a few seconds, so a pond dug is seen. */
  private wetCache = new Map<number, number>();
  private wetKept = -Infinity;
  private wetness(x: number, y: number): number {
    if (Math.abs(this.time - this.wetKept) > 5) {
      this.wetCache.clear();
      this.wetKept = this.time;
    }
    const key = y * 65536 + x;
    const had = this.wetCache.get(key);
    if (had !== undefined) return had;
    const w = this.game.world;
    const reach = GREEN_WET_REACH - 1;
    let near = GREEN_WET_REACH;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      if (w.inBounds(x + dx, y + dy) && w.hasWater(x + dx, y + dy)) near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dy)));
    }
    const v = wetFrom(near);
    this.wetCache.set(key, v);
    return v;
  }

  /**
   * A shop counter in its wall (`counter.ts`), a half at a time: `inside`,
   * the opening, in the hole before the hour's light goes over the wall --
   * the shop from the street, or the reveal from within it; `front`, the
   * board, the goods and the awning, over everything on the face once the
   * wall is done -- from within, only as far as they are seen through the
   * opening; and `flat`, both on a wall drawn in flat colours, which has no
   * hole to see through.
   *
   * At the four turns where a wall runs straight away from the camera its
   * face has no width on the screen and neither has the opening, so nothing
   * is clipped to it: the board and the awning stand out of the wall to the
   * street's side, and are seen from either side of it.
   */
  private drawCounterPart(stage: 'inside' | 'front' | 'flat', wall: Wall, border: Border, g: WallGeom, zoom: number, lit: number,
    paint: { line: CounterLook['line']; reveal: CounterLook['reveal']; wood: CounterLook['wood']; woodLine: CounterLook['woodLine'] }): void {
    const ctx = this.canvas.ctx;
    const game = this.game;
    const cam = this.camera;
    const c = game.counters.onBorder(border);
    const seat = c ?? counterSeat(game, wall);
    const st = streetOf(seat);
    // The tile on the camera's side of the border, as `drawWall` works it out.
    const [bx, by] = border.dir === 'h' ? [1, 0] : [0, 1];
    const toward = cam.nearSide(-by, bx);
    const edgeOn = this.edgeOn(border);
    const seenX = border.dir === 'h' ? border.x : (toward > 0 ? border.x - 1 : border.x);
    const seenY = border.dir === 'h' ? (toward > 0 ? border.y : border.y - 1) : border.y;
    // A room with a floor or a roof over it is dim behind the opening; one open to the sky is daylit.
    const over = game.buildings.floor(wall.level + 1, seat.x, seat.y);
    const look: CounterLook = {
      zoom, lit, ...paint,
      street: seenX === st.x && seenY === st.y ? 1 : -1,
      stripe: stripeOf(seat.x, seat.y, seat.side),
      wares: c ? counterWares(c) : [],
      full: c ? Math.min(1, counterHeld(c) / COUNTER_HOLDS) : 0,
      // Only the room behind the opening is lit from within, and only from the street is it seen.
      alight: stage !== 'front' ? this.lampBehind(wall, border) : 0,
      sky: !over || !isDone(over),
    };
    /** From within, what lies beyond the wall is seen through the far side of the opening and no further: edge on, there is no opening to see it through. */
    const beyond = look.street < 0 && !edgeOn;
    const dpr = this.canvas.dpr;
    if (stage === 'inside') {
      ctx.save();
      counterHole(ctx, g, 1);
      ctx.clip();
      if (look.street > 0) drawCounterInside(ctx, g, look);
      else drawCounterReveal(ctx, g, look);
      ctx.restore();
    } else if (stage === 'front') {
      drawCounterFrontKept(ctx, g, look, beyond, dpr);
    } else if (look.street > 0) {
      drawCounterInside(ctx, g, look);
      drawCounterFrontKept(ctx, g, look, false, dpr);
    } else {
      drawCounterDaylight(ctx, g, look);
      drawCounterFrontKept(ctx, g, look, beyond, dpr);
    }
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
      case 'counter':
        this.drawCounterPart('flat', wall, border, g, zoom, lit, { line: mat.trim, reveal: mat.color, wood: COUNTER_OAK, woodLine: COUNTER_OAK_INK });
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
      case 'portcullis':
        this.wallGateway(wall, border, mat, lit, g, zoom);
        break;
      default:
        break;
    }
  }

  // ---- Gates: a portcullis's grille and a drawbridge (`gates.ts`). ----

  /** Where each gate is in its travel, by the border or the bridge. */
  private gateMotion = new Map<string, Motion>();
  /** This frame's drawbridges, by the border each is hinged on, and the tiles either side of each hinge. */
  private drawbridges = new Map<string, Bridge>();
  private landings = new Map<string, Bridge>();
  private hingeTiles = new Set<number>();
  /** What `drawGateAt` found on this line, laid after the line's roofs and before what stands on it. */
  private gateLate: Array<() => void> = [];
  /** A world point and a height, to the screen. */
  private readonly project = (x: number, y: number, h: number): [number, number] =>
    [this.camera.worldToScreenX(x, y), this.camera.worldToScreenY(x, y, h)];

  /** How far a thing that moves between two ends is along its way now: nought at one, one at the other. */
  private travel(key: string, to: number, up: number, down: number): number {
    const { m, at } = moveTo(this.gateMotion.get(key), to, this.time, up, down);
    this.gateMotion.set(key, m);
    return at;
  }

  /** A portcullis's grille in its arch, as far down as it has dropped. */
  private grille(wall: Wall, border: Border, g: WallFace, lit: number, a: ArchShape): void {
    // The grille goes in with the last of the wall's bill: until then it is an archway being built.
    if (!isDone(wall)) return;
    const down = this.travel(`p:${wall.level}:${border.dir}:${border.x},${border.y}`, wall.lowered ? 1 : 0, PORTCULLIS_DROP, PORTCULLIS_RISE);
    drawGrille(this.canvas.ctx, g, a, this.camera.zoom, down, lit, WALL_HEIGHT);
  }

  /** How far a drawbridge stands up now: nought lying on the far bank, one on end. */
  private drawbridgeUp(b: Bridge): number {
    return this.travel(`b:${b.id}`, b.raised ? 1 : 0, DRAWBRIDGE_RISE, DRAWBRIDGE_FALL);
  }

  /** Where everything about a drawbridge is, and how far up it stands. */
  private drawbridgeGeom(b: Bridge): DrawbridgeGeom {
    const ux = Math.sign(b.bx - b.ax), uy = Math.sign(b.by - b.ay);
    return {
      hx: b.ax + 0.5 + ux * 0.5, hy: b.ay + 0.5 + uy * 0.5, ux, uy, nx: -uy, ny: ux,
      len: b.spans.length, h: b.height, up: this.drawbridgeUp(b), groundAt: (x, y) => this.game.world.heightAt(x, y),
    };
  }

  /** The light on a drawbridge's planks, as a floor's: a face running across it. */
  private deckLit(b: Bridge): number {
    return this.faceLight(-Math.sign(b.by - b.ay), Math.sign(b.bx - b.ax));
  }

  /**
   * A drawbridge's gallows and winch, and its deck whenever it is not lying on
   * the far bank, drawn by the tile that has the hinge for a back border --
   * the one in front of it -- as a wall on that border is, but after the
   * roofs that line lays (`gateLate`): a roof is laid a line in front of its
   * own walls, and a gallows a tile in front of a gatehouse stood under its
   * eaves. Seen from the winch side the deck stands behind the gallows; from
   * the far side, in front.
   */
  private drawGateAt(x: number, y: number, V: View): void {
    for (const side of V.back) {
      const border = borderOf(x, y, side);
      const key = hingeKey(0, border);
      const landing = this.landings.get(key);
      if (landing) this.drawLandingAt(landing);
      const b = this.drawbridges.get(key);
      if (!b) continue;
      const ctx = this.canvas.ctx;
      const zoom = this.camera.zoom;
      const g = this.drawbridgeGeom(b);
      const P = this.project;
      const lit = this.deckLit(b);
      const done = bridgeDone(b);
      const near = (dx: number, dy: number): boolean => this.camera.nearSide(dx, dy) > 0;
      // A face of timber is lit as a wall facing the same way is.
      const faceLit = (ox: number, oy: number): number => this.faceLight(-oy, ox);
      // Which side of the hinge the camera is on: the winch's, or the far bank's.
      const winchSide = this.camera.nearSide(-g.ux, -g.uy) > 0;
      // A drawbridge set out from a building's floor before that was refused has no gallows in there, nor a crib.
      const open = !this.game.buildings.buildingAt(b.ax, b.ay);
      const deck = (): void => {
        if (!done || g.up <= 0) return;
        drawStandingDeck(ctx, P, g, zoom, lit, faceLit);
      };
      const crib = (): void => {
        if (open && isDone(b.spans[0])) drawHingeCrib(ctx, P, g, zoom, near, faceLit, lit);
      };
      const gallows = (): void => {
        if (!done || !open) return;
        drawGallows(ctx, P, g, zoom, near, faceLit);
        // The chains: whole when it is off the bank, and the length over the winch end when it lies on it.
        if (g.up > 0) drawChains(ctx, P, g, zoom, lit);
        else drawChains(ctx, P, g, zoom, lit, { d0: -0.2, d1: 0 });
      };
      this.gateLate.push(winchSide ? () => { deck(); crib(); gallows(); } : () => { crib(); gallows(); deck(); });
      if (done) {
        // What is clicked for it, standing: the gallows and the deck on end.
        const [lx, ly] = P(g.hx - g.nx * 0.6, g.hy - g.ny * 0.6, Math.max(gallowsTop(g), g.h + g.len * UNITS_PER_TILE * g.up));
        const [rx, ry] = P(g.hx + g.nx * 0.6, g.hy + g.ny * 0.6, g.groundAt(g.hx, g.hy));
        const left = Math.min(lx, rx), top = Math.min(ly, ry);
        this.deckHits.push({ x: b.ax, y: b.ay, left, top, w: Math.abs(rx - lx), h: Math.abs(ry - ly), bridge: b.id });
      }
    }
  }

  /** The crib a drawbridge's far end comes down on, laid with the rest of the line its border is the back of. */
  private drawLandingAt(b: Bridge): void {
    const last = b.spans[b.spans.length - 1];
    if (!last || !isDone(last) || this.game.buildings.buildingAt(b.bx, b.by)) return;
    const g = this.drawbridgeGeom(b);
    const near = (dx: number, dy: number): boolean => this.camera.nearSide(dx, dy) > 0;
    const faceLit = (ox: number, oy: number): number => this.faceLight(-oy, ox);
    const lit = this.deckLit(b);
    this.gateLate.push(() => drawLandingCrib(this.canvas.ctx, this.project, g, this.camera.zoom, near, faceLit, lit));
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
   * you. Called clipped to the hole, so neither reaches the stone -- or
   * handed the hole as `region` to lay them in, unclipped.
   */
  private archShade(g: WallGeom, zoom: number, geom: ArchShape | ReturnType<Renderer['archGeom']> = this.archGeom(g, zoom),
    region: () => void = () => g.quad(0, 1, 0, 1)): void {
    const ctx = this.canvas.ctx;
    const { px, py } = g;
    // gates: under a portcullis's gateway too, whose head is its own (`gatewayArch`), laid in the opening's own shape.
    const { spring, headK } = geom;
    region();
    ctx.fillStyle = 'rgba(38, 34, 22, 0.18)';
    ctx.fill();
    // From the crown down to the springing, where the head stops overhanging.
    const top = headK(0.5);
    const wash = ctx.createLinearGradient(px(0.5, top), py(0.5, top), px(0.5, spring), py(0.5, spring));
    wash.addColorStop(0, 'rgba(38, 34, 22, 0.20)');
    wash.addColorStop(1, 'rgba(38, 34, 22, 0)');
    region();
    ctx.fillStyle = wash;
    ctx.fill();
  }

  private archDepth(ink: readonly [number, number, number], lit: number, g: WallGeom, zoom: number,
    geom: ArchShape | ReturnType<Renderer['archGeom']> = this.archGeom(g, zoom)): void {
    const ctx = this.canvas.ctx;
    const { px, py } = g;
    // gates: round a portcullis's gateway too (`gatewayArch`).
    const { t0, t1, spring, steps, headT, headK } = geom;
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

  /**
   * A portcullis on a wall drawn in its flat colour (`gates.ts`): the gateway
   * as `wallArch` draws an archway -- its shade, the wall's thickness round
   * it, the edge of it -- with the voussoirs and jamb stones in the
   * material's trim, the grooves, and the grille hung in them.
   */
  private wallGateway(wall: Wall, border: Border, mat: MaterialDef, lit: number, g: WallGeom, zoom: number): void {
    const ctx = this.canvas.ctx;
    const geom = gatewayArch(ctx, g, zoom, WALL_HEIGHT);
    ctx.save();
    geom.outline(1);
    ctx.clip();
    this.archShade(g, zoom, geom);
    this.archDepth(mat.color, lit, g, zoom, geom);
    drawGrooves(ctx, g, zoom, geom);
    this.grille(wall, border, g, lit, geom);
    ctx.restore();
    drawGatewayDressing(ctx, g, geom, mat.color.map((c) => c * lit) as unknown as [number, number, number], mat.trim,
      { detail: zoom >= 0.6, line: Math.max(0.8, 1.1 * zoom) });
    geom.rim(1);
    ctx.strokeStyle = rgb(mat.trim, lit * 0.85);
    ctx.lineWidth = Math.max(1, 1.2 * zoom);
    ctx.stroke();
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
    if (dark < LAMP_DARK) return 0;
    const near = this.game.buildings.buildingAt(border.x, border.y)
      ? { x: border.x, y: border.y }
      : border.dir === 'h' ? { x: border.x, y: border.y - 1 } : { x: border.x - 1, y: border.y };
    const room = this.game.buildings.room(wall.level, near.x, near.y);
    if (!room) return 0;
    const inside = new Set(room.tiles);
    let most = 0;
    // The frame's own (`lightsNow`): gathered once a frame, not once a wall.
    for (const l of this.lightsNow) {
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
    const dry = (x: number, y: number): boolean => w.heightAt(x, y) >= w.surfaceAt(Math.floor(x), Math.floor(y));
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
    // The mist off the falls, which hangs over everything the same as smoke does.
    if (this.game.world.water) this.springWater.air(ctx);
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
      // A critical blow is written half as large again.
      ctx.font = `${f.kind === 'crit' ? 800 : 600} ${Math.round(size * scale * (f.kind === 'crit' ? 1.5 : 1))}px system-ui, sans-serif`;
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
  /**
   * The ground a heavy blow will land on: a ring of `HUNT_REACH` tiles round
   * the one drawing back for it, as the view draws a circle, filling as the
   * blow comes. Out of it by the time it is full is out of it.
   */
  private drawWindupReach(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, left: number): void {
    const k = Math.max(0, Math.min(1, 1 - left / WIND_UP));
    const rx = HUNT_REACH * Math.SQRT2 * HALF_W * zoom;
    const ry = HUNT_REACH * Math.SQRT2 * HALF_H * zoom;
    ctx.save();
    ctx.fillStyle = `rgba(214, 62, 44, ${0.1 + 0.2 * k})`;
    ctx.beginPath();
    ctx.ellipse(sx, sy, Math.max(1, rx * k), Math.max(1, ry * k), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(232, 74, 52, ${0.55 + 0.4 * k})`;
    ctx.lineWidth = Math.max(1.5, 2.2 * zoom);
    ctx.beginPath();
    ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** A mark over the head of something drawing back for a heavy blow. */
  private drawWindupMark(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number): void {
    const size = Math.max(11, Math.round(18 * zoom));
    ctx.save();
    ctx.font = `bold ${size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = Math.max(2, 3 * zoom);
    ctx.strokeStyle = 'rgba(20, 10, 8, 0.75)';
    ctx.strokeText('!', sx, sy);
    ctx.fillStyle = '#ff5a3c';
    ctx.fillText('!', sx, sy);
    ctx.restore();
  }

  private flashOf(at: number): number {
    const since = this.game.time - at;
    if (since < 0 || since > Renderer.FLASH) return 0;
    return 1 - since / Renderer.FLASH;
  }

  private markWakes(): void {
    const w = this.game.world;
    const now = this.time;
    // Nobody on stepping stones is in the water, however deep it is round them.
    const afloat = (x: number, y: number): boolean => w.heightAt(x, y) < w.surfaceAt(Math.floor(x), Math.floor(y)) - 0.5 && !w.stonesAt(Math.floor(x), Math.floor(y))
      && !this.game.onPierDeck(Math.floor(x), Math.floor(y));
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
    // A frame with buildings standing in the water lays its swell in pieces round them (`layWater`): each piece laid straight on as it comes.
    if (this.wetPierBuildings) {
      this.swellBand(ctx, zoom, 0, LONG_WAVE, CREST_ALPHA, 1, this.seaPath);
      this.swellBand(ctx, zoom, 0.55, SHORT_WAVE, TROUGH_ALPHA * 0.7, 0.62, this.seaPath);
      return;
    }
    /*
     * Otherwise it is a picture of its own, already cut to the sea, made
     * `SWELL_RATE` times a second and copied on in between, moved with the
     * view so it stays where the sea is. Painting the two gradients over
     * the sea every frame cost more than the trees: half a close view of open
     * water, a frame. The waves are slow enough that the steps between one
     * picture and the next do not show.
     */
    const cam = this.camera;
    const t = ctx.getTransform();
    const dev = t.a;
    const W = this.canvas.width, H = this.canvas.height;
    const ax = cam.worldToScreenX(0, 0), ay = cam.worldToScreenY(0, 0, 0);
    const fit = `${zoom}|${cam.rotation}|${W}|${H}|${dev}|${t.e}|${t.f}`;
    let pic = this.swellPic;
    // Never two frames running, so a slow machine is not painting it afresh every frame it draws.
    if (!pic || pic.fit !== fit || Math.abs(ax - pic.ax) > W / 4 || Math.abs(ay - pic.ay) > H / 4
      || ((this.time - pic.at >= 1 / SWELL_RATE || this.time < pic.at) && this.frameNo - pic.frame > 1)) {
      const full = pic?.cv ?? document.createElement('canvas');
      const half = pic?.half ?? document.createElement('canvas');
      if (full.width !== ctx.canvas.width || full.height !== ctx.canvas.height) {
        full.width = ctx.canvas.width;
        full.height = ctx.canvas.height;
      }
      // The two gradients worked out at `SWELL_RES` of the pixels: neither has an edge of its own to keep sharp.
      const sw = Math.max(1, Math.ceil(full.width * SWELL_RES)), sh = Math.max(1, Math.ceil(full.height * SWELL_RES));
      if (half.width !== sw || half.height !== sh) {
        half.width = sw;
        half.height = sh;
      }
      const h = half.getContext('2d') as CanvasRenderingContext2D;
      h.setTransform(1, 0, 0, 1, 0, 0);
      h.clearRect(0, 0, sw, sh);
      h.setTransform(t.a * SWELL_RES, 0, 0, t.d * SWELL_RES, t.e * SWELL_RES, t.f * SWELL_RES);
      this.swellBand(h, zoom, 0, LONG_WAVE, CREST_ALPHA, 1, null);
      this.swellBand(h, zoom, 0.55, SHORT_WAVE, TROUGH_ALPHA * 0.7, 0.62, null);
      // And cut to the sea at the screen's own, which is where the edge is: the shore.
      const g = full.getContext('2d') as CanvasRenderingContext2D;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, full.width, full.height);
      g.drawImage(half, 0, 0, full.width, full.height);
      g.setTransform(t);
      g.globalCompositeOperation = 'destination-in';
      g.fillStyle = '#000';
      g.fill(this.seaPath);
      // Where on it the sea is, in its pixels, so only that much of it is copied on.
      const b = this.seaBox;
      const bx = Math.max(0, Math.floor(t.a * b[0] + t.e) - 2), by = Math.max(0, Math.floor(t.d * b[1] + t.f) - 2);
      const box: [number, number, number, number] = [bx, by, Math.min(full.width, Math.ceil(t.a * b[2] + t.e) + 2) - bx, Math.min(full.height, Math.ceil(t.d * b[3] + t.f) + 2) - by];
      pic = this.swellPic = { cv: full, half, fit, at: this.time, frame: this.frameNo, ax, ay, box };
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const [bx, by, bw, bh] = pic.box;
    if (bw > 0 && bh > 0) ctx.drawImage(pic.cv, bx, by, bw, bh, bx + Math.round((ax - pic.ax) * dev), by + Math.round((ay - pic.ay) * dev), bw, bh);
    ctx.restore();
  }

  /** The swell as last made (`drawSwell`): its picture, the view it was made for, when, and where the world's corner was on the screen. */
  private swellPic: { cv: HTMLCanvasElement; half: HTMLCanvasElement; fit: string; at: number; frame: number; ax: number; ay: number; box: [number, number, number, number] } | null = null;

  /**
   * Which lines of the ground this frame have a tile of a building standing
   * on piers in the water (`piers.ts`), and which buildings those are.
   */
  private wetPiers(V: View): void {
    this.wetPierLines = null;
    this.wetPierBuildings = null;
    const bld = this.game.buildings;
    if (!bld.pierTiles.size) return;
    let c = this.wetPierCache;
    if (!c || c.stamp !== bld.pierStamp || this.time - c.at > 1 || this.time < c.at) {
      const world = this.game.world;
      let wet: Set<number> | null = null;
      for (const key of bld.pierTiles) {
        const [x, y] = key.split(',').map(Number);
        const b = bld.buildingAt(x, y);
        if (b && world.hasWater(x, y)) (wet ??= new Set()).add(b.id);
      }
      // The lines are kept while the buildings are the same, whatever the water does.
      const same = !!c && c.stamp === bld.pierStamp && sameSet(c.buildings, wet);
      c = this.wetPierCache = { stamp: bld.pierStamp, at: this.time, buildings: wet, view: same ? c!.view : null, lines: same ? c!.lines : null };
    }
    if (!c.buildings) return;
    if (c.view !== V || !c.lines) {
      c.lines = new Set();
      c.view = V;
      for (const id of c.buildings) {
        for (const key of bld.list.get(id)?.tiles ?? []) {
          const [x, y] = key.split(',').map(Number);
          c.lines.add(depthOf(V, x, y));
        }
      }
    }
    this.wetPierBuildings = c.buildings;
    this.wetPierLines = c.lines;
  }

  /**
   * The swell and the wakes laid over the water drawn so far, which is then
   * done with: before a building standing on piers in the water is drawn in
   * front of it, so neither is laid over the building. The water under its
   * own decks is never in it (`drawWater`, `drawPonds`): that is in their
   * shade, and the piers stand in it.
   */
  private layWater(ctx: CanvasRenderingContext2D, zoom: number): void {
    if (!this.fast) this.drawSwell(ctx, zoom);
    this.drawWakes(ctx, zoom);
    this.seaPath = new Path2D();
    this.seaBox.fill(NaN);
    this.drewWater = false;
    if (this.pondPath) this.pondPath = new Path2D();
  }

  /** One train of waves: a wavelength, a lean off the wind, and a speed. */
  /** One train of waves as a gradient, over `area` or over the whole screen. */
  private swellBand(ctx: CanvasRenderingContext2D, zoom: number, lean: number, waveTiles: number, amp: number, rate: number, area: Path2D | null): void {
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
    if (area) ctx.fill(area);
    else ctx.fillRect(0, 0, W, H);
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
    const w = this.game.world;
    ctx.save();
    // The sea and every pond: a swimmer in a pond leaves a wake on it too.
    if (this.pondPath) {
      const both = new Path2D(this.seaPath);
      both.addPath(this.pondPath);
      ctx.clip(both);
    } else ctx.clip(this.seaPath);
    for (const trail of trails) {
      // One outline for the whole trail — up one side and back down the other
      // — so there is no seam anywhere along it. The width at each point is
      // how far that bit of water has had time to spread.
      const sx = (x: number, y: number): number => cam.worldToScreenX(x, y);
      const sy = (x: number, y: number): number => cam.worldToScreenY(x, y, w.surfaceAt(Math.floor(x), Math.floor(y)));
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
    // The water under a deck on piers is in its shade, and no swell runs there (`layWater`).
    const sea = this.wetPierLines && this.game.buildings.onPiers(x, y) ? null : this.seaPath;
    for (let k = 0; k < n; k += 2) {
      const sx = cam.worldToScreenX(poly[k], poly[k + 1]);
      const sy = cam.worldToScreenY(poly[k], poly[k + 1], 0);
      if (k === 0) {
        ctx.moveTo(sx, sy);
        fogInto?.moveTo(sx, sy);
        sea?.moveTo(sx, sy);
      } else {
        ctx.lineTo(sx, sy);
        fogInto?.lineTo(sx, sy);
        sea?.lineTo(sx, sy);
      }
      if (sea) this.growSeaBox(sx, sy);
    }
    ctx.closePath();
    fogInto?.closePath();
    sea?.closePath();
    if (sea) this.drewWater = true;
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

  /**
   * Which of the ponds on a tile have water on it this frame, into
   * `pondsHereLevel` and `pondsHereMask`: a pond still rising has not got to
   * every corner it will cover, and one only just dug has got to none. True
   * when any has.
   */
  private pondsOn(water: WaterField, x: number, y: number, c: number[], co: View['corners']): boolean {
    const cw = this.game.world.w + 1;
    let n = 0;
    this.pondTop = -Infinity;
    for (const p of water.pondsAt(x, y)) {
      const level = this.springWater.levelOf(p);
      let mask = 0;
      for (let i = 0; i < 4; i++) {
        if (c[i] < level && p.wet.has((y + co[i][1]) * cw + x + co[i][0])) mask |= 1 << i;
      }
      if (!mask) continue;
      // Two springs filling the same pond are one pond's water: laid once, not once for each.
      let twice = false;
      for (let k = 0; k < n && !twice; k++) twice = this.pondsHereLevel[k] === level && this.pondsHereMask[k] === mask;
      if (twice) continue;
      this.pondsHereLevel[n] = level;
      this.pondsHereMask[n] = mask;
      n++;
      if (level > this.pondTop) this.pondTop = level;
    }
    this.pondsHereN = n;
    return n > 0;
  }

  /**
   * A pond's water on a tile, the way the sea's is drawn but at the pond's own
   * surface, and only over the corners it covers: cut where the ground comes
   * up through the surface, which is its shore, and halfway along an edge that
   * runs from its water to a corner lower than the surface but not in the
   * pond, which is the far side of its lip. Coloured by depth off spring
   * water's own ramp, turquoise and not the sea's blue, and edged at the bank
   * with a thin line of darker teal rather than the sea's foam: nothing
   * breaks on a pond.
   */
  private drawPonds(V: View, x: number, y: number, c: number[], fogInto?: Path2D): void {
    const ctx = this.canvas.ctx;
    const cam = this.camera;
    const cs = V.corners;
    const poly = this.waterPoly;
    const edge = this.waterEdge;
    // The water under a deck on piers is in its shade, and no wake runs there (`layWater`).
    const wakes = this.pondPath && this.wetPierLines && this.game.buildings.onPiers(x, y) ? null : this.pondPath;
    for (let q = 0; q < this.pondsHereN; q++) {
      const level = this.pondsHereLevel[q];
      const mask = this.pondsHereMask[q];
      let n = 0;
      let cross = 0;
      let sum = 0;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) & 3;
        const ha = c[i];
        const hb = c[j];
        const wa = (mask >> i) & 1;
        const wb = (mask >> j) & 1;
        const ax = x + cs[i][0];
        const ay = y + cs[i][1];
        // Depth is measured to the ground under the water; a corner out of the pond counts as the waterline.
        sum += wa ? ha : Math.max(ha, level);
        if (wa) {
          poly[n++] = ax;
          poly[n++] = ay;
        }
        if (wa !== wb) {
          const shore = (wa ? hb : ha) >= level;
          const t = shore ? (level - ha) / (hb - ha) : 0.5;
          const px = ax + (x + cs[j][0] - ax) * t;
          const py = ay + (y + cs[j][1] - ay) * t;
          if (shore) {
            if (cross < 4) {
              edge[cross++] = px;
              edge[cross++] = py;
            } else cross = 5;
          }
          poly[n++] = px;
          poly[n++] = py;
        }
      }
      if (n < 6) continue;
      ctx.fillStyle = SPRING_PALETTE[springLevel(level - sum / 4)];
      ctx.beginPath();
      for (let k = 0; k < n; k += 2) {
        const sx = cam.worldToScreenX(poly[k], poly[k + 1]);
        const sy = cam.worldToScreenY(poly[k], poly[k + 1], level);
        if (k === 0) {
          ctx.moveTo(sx, sy);
          fogInto?.moveTo(sx, sy);
          wakes?.moveTo(sx, sy);
        } else {
          ctx.lineTo(sx, sy);
          fogInto?.lineTo(sx, sy);
          wakes?.lineTo(sx, sy);
        }
      }
      ctx.closePath();
      fogInto?.closePath();
      wakes?.closePath();
      ctx.fill();
      if (cross === 4) {
        ctx.strokeStyle = POND_SHORE;
        ctx.lineWidth = Math.max(0.8, 1.1 * cam.zoom);
        ctx.beginPath();
        ctx.moveTo(cam.worldToScreenX(edge[0], edge[1]), cam.worldToScreenY(edge[0], edge[1], level));
        ctx.lineTo(cam.worldToScreenX(edge[2], edge[3]), cam.worldToScreenY(edge[2], edge[3], level));
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
  }

  /** A tile's outline on the screen: on the ground, or on the floor of the cellar under it (`down`). */
  private tilePath(ctx: CanvasRenderingContext2D, x: number, y: number, down = false): void {
    const w = this.game.world;
    const cam = this.camera;
    const floor = down ? cellarFloorHeight(this.game, x, y) : 0;
    const h = (cx: number, cy: number): number => (down ? floor : w.getHeight(cx, cy));
    ctx.beginPath();
    ctx.moveTo(cam.worldToScreenX(x, y), cam.worldToScreenY(x, y, h(x, y)));
    ctx.lineTo(cam.worldToScreenX(x + 1, y), cam.worldToScreenY(x + 1, y, h(x + 1, y)));
    ctx.lineTo(cam.worldToScreenX(x + 1, y + 1), cam.worldToScreenY(x + 1, y + 1, h(x + 1, y + 1)));
    ctx.lineTo(cam.worldToScreenX(x, y + 1), cam.worldToScreenY(x, y + 1, h(x, y + 1)));
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
    // The way you are walking, and the tile you are working: over the cellar when you are looking into one, after it is drawn.
    const marks = (): void => {
      const path = game.player.path;
      if (path) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        for (const p of path) {
          const sx = cam.worldToScreenX(p.x + 0.5, p.y + 0.5);
          // A step down in a cellar is on its floor.
          const sy = cam.worldToScreenY(p.x + 0.5, p.y + 0.5, p.level < 0 ? cellarFloorHeight(game, p.x, p.y) : w.centerHeight(p.x, p.y));
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
          this.tilePath(ctx, t.x, t.y, this.cellarFrame && game.buildings.cellar(t.x, t.y) !== undefined);
          ctx.strokeStyle = `rgba(255,200,70,${pulse.toFixed(2)})`;
          ctx.stroke();
        }
        ctx.lineWidth = 1;
      }
    };
    if (!this.cellarFrame) marks();

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
      // Gathered once at the top of the frame when it is dark enough to want them (`lightsNow`).
      const lights = dark > 0.02 ? this.lightsNow : game.lights();
      if (!lights.length && !this.glows.length) {
        for (const wash of washes) {
          ctx.fillStyle = `rgba(${wash.colour}, ${wash.alpha.toFixed(3)})`;
          ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
      } else {
        const W = this.canvas.width, H = this.canvas.height;
        const lit = this.lightLayers(lights, W, H);
        /*
         * The wash is one colour, so the night is mixed at the size its holes
         * were worked out at and laid over the screen scaled up -- unless
         * something with a light of its own is in view, whose holes are fine
         * work (an altar's stars and lines), and then at full size.
         */
        const res = this.glows.length ? 1 : LIGHT_RES;
        const night = this.nightLayer(res);
        const nc = night.getContext('2d') as CanvasRenderingContext2D;
        nc.setTransform(1, 0, 0, 1, 0, 0);
        nc.globalCompositeOperation = 'source-over';
        nc.clearRect(0, 0, night.width, night.height);
        for (const wash of washes) {
          nc.fillStyle = `rgba(${wash.colour}, ${wash.alpha.toFixed(3)})`;
          nc.fillRect(0, 0, night.width, night.height);
        }
        // What the lights leave of it (`lightLayers`).
        nc.globalCompositeOperation = 'destination-in';
        if (res === LIGHT_RES) nc.drawImage(lit.mask, 0, 0);
        else nc.drawImage(lit.mask, 0, 0, lit.mask.width / LIGHT_RES, lit.mask.height / LIGHT_RES);
        nc.globalCompositeOperation = 'destination-out';
        // And off whatever has a light of its own, where it was drawn this frame.
        for (const n of this.glows) {
          for (const h of furnitureHoles(n.sx, n.sy, zoom, n.kind, n.view)) {
            const grad = nc.createRadialGradient(h.x, h.y, 0, h.x, h.y, h.r);
            grad.addColorStop(0, `rgba(0,0,0,${h.a.toFixed(2)})`);
            grad.addColorStop(0.5, `rgba(0,0,0,${(h.a * 0.45).toFixed(2)})`);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            nc.fillStyle = grad;
            nc.beginPath();
            nc.arc(h.x, h.y, h.r, 0, Math.PI * 2);
            nc.fill();
          }
        }
        nc.globalCompositeOperation = 'source-over';
        ctx.drawImage(night, 0, 0, night.width / res, night.height / res);
        // A warm cast where the firelight actually falls, over the cold: the warmest light's at each spot, as dark as
        // it is, and only over the part of the screen any light reaches -- the rest of the layer is black.
        const [bx, by, bw, bh] = lit.box;
        if (bw > 0 && bh > 0) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = dark;
          ctx.drawImage(lit.warm, bx, by, bw, bh, bx / LIGHT_RES, by / LIGHT_RES, bw / LIGHT_RES, bh / LIGHT_RES);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.globalCompositeOperation = 'source-over';
        // And glass with a light burning under it, glowing through the dark (`glazing.ts`).
        if (this.glassNight.length) this.drawGlassGlow(ctx, dark);
      }
    }
    // The fireflies, which are lights: over the night, not under it.
    if (!this.fast) this.life.glow(ctx);
    // And the spells' light, over the night too, and the screen's tint for a great one of your own over that.
    this.spells.glowPass(ctx);
    this.spells.screenPass(ctx, this.canvas.width, this.canvas.height);
    // Down in a cellar, the cellar, over all of it; and the marks over that.
    if (this.cellarFrame) {
      this.drawCellarView(ctx, zoom);
      marks();
    } else this.cellarHulls.length = 0;

    // The chosen tile, marked whether or not the cursor is anywhere near it.
    const chosen = this.selected;
    if (chosen && w.inBounds(chosen.x, chosen.y)) {
      this.tilePath(ctx, chosen.x, chosen.y, !!chosen.down && this.cellarFrame);
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
      this.tilePath(ctx, hover.x, hover.y, !!hover.down);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();
      ctx.lineWidth = 1;
      const carryingCrate = game.inventory.items.some((it) => crateKindOfItem(it.id));
      if (carryingCrate && hover.crate === undefined) {
        // The 4 by 4 snap grid, with the spot a crate would take: on the cellar's floor, picked down there.
        const floor = hover.down ? cellarFloorHeight(game, hover.x, hover.y) : 0;
        const h = (wx: number, wy: number): number => (hover.down ? floor : w.heightAt(wx, wy)) + 0.3;
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
        ctx.fillStyle = game.crateAt(hover.x, hover.y, sx0, sy0, hover.down ? CELLAR_LEVEL : 0) ? 'rgba(255,90,70,0.35)' : 'rgba(120,255,140,0.35)';
        ctx.fill();
      }
      const building = hover.down ? undefined : game.buildings.buildingAt(hover.x, hover.y);
      if (hover.down) {
        // Nothing is built down in a cellar: the floor is the whole of it.
      } else if (building) {
        // Show which border a wall would go on, at the storey being worked on.
        const side = nearestSide(hover.x, hover.y, hover.wx, hover.wy);
        const [ax, ay, bx, by] = borderPoints(borderOf(hover.x, hover.y, side));
        const h = (building.deck ?? w.getHeight(hover.x, hover.y)) + workLevel(building) * WALL_HEIGHT + 0.5;
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
  /**
   * Which way round a piece is drawn this frame.
   *
   * What is being driven or pulled points the way it is going, and stays
   * pointing the way it went when it stops; a hull somebody else is steering,
   * or with people on her deck, points the way the game has her pointing,
   * which is the way they are stood along her; anything else stands the way
   * it was set.
   */
  private viewOf(piece: PlacedFurniture): PieceView {
    const step = (Math.PI * 2) / 64;
    if ((piece.driven || piece.hitched) && this.game.player.moving) this.pieceHeadings.set(piece.id, Math.round(this.game.heading() / step) * step);
    if (piece.helm || piece.riders?.length) this.pieceHeadings.set(piece.id, Math.round(this.game.shipHeading(piece) / step) * step);
    const heading = this.pieceHeadings.get(piece.id);
    return heading !== undefined ? headingView(heading, this.camera.rotation) : pieceView(pieceFacing(piece), this.camera.rotation);
  }

  private pieceTrim(f: PlacedFurniture): number | undefined {
    // A rowing boat somebody is rowing has her oars out in their hands, not shipped in her.
    if (rowedPiece(f.kind)) return f.driven || f.helm ? 1 : 0;
    // A lantern post or pillar, with its lantern in it or without (`lamps.ts`).
    if (isLampPiece(f)) return f.lamp ? 1 : 0;
    // An arch's roses: their variety, which is its place's, and how far they have grown (`roses.ts`).
    if (FURNITURE_BY_ID.get(f.kind)?.roses) {
      const r = roseStage(f.setAt, this.game.wallNow());
      return roseTrim(Math.floor(hash2(f.x * 4 + f.sx, f.y * 4 + f.sy, 71) * 4), r.days, r.blooms);
    }
    // The moss on a piece that gathers it (`greening.ts`), a stage every two days, and which way it faces.
    if (mossyPiece(f)) {
      const days = pieceGreen(this.game, f, this.greenAt) ?? 0;
      const g = greenShows(days, 0, this.wetness(f.x, f.y));
      return mossTrim(Math.round(g * PIECE_STAGES), pieceFacing(f));
    }
    // A planter is drawn with what grows in it, at the stage it is at.
    if (isPlanter(f)) {
      const c = this.game.planted.get(f.id);
      return c ? planterTrim(c.id, c.stage) : 0;
    }
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

  /**
   * The weather on a piece's cloth this frame: the wind turned into the
   * piece's own frame, which way it faces being which way its cloth hangs; the
   * drawing clock; its dye; and the device of the settlement it stands on.
   */
  private airOf(f: PlacedFurniture): Air {
    const s = this.surf;
    const facing = pieceFacing(f);
    const [fx, fy] = FRONT_OF[facing], [ax, ay] = ACROSS_OF[facing];
    const deed = this.deedOver(f.x, f.y);
    return {
      x: s.dirX * ax + s.dirY * ay, y: s.dirX * fx + s.dirY * fy, force: s.force, t: this.time,
      tint: dyeOf(f) ?? undefined, device: deed ? deviceOf(deed) : undefined,
    };
  }

  /** The name of the settlement over a tile, yours or anybody's, or null. */
  private deedOver(x: number, y: number): string | null {
    const own = this.game.deed;
    if (own && Math.abs(x - own.x) <= own.radius && Math.abs(y - own.y) <= own.radius) return own.name;
    return this.game.deedAt(x, y)?.name ?? null;
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
      if (sx < h.left || sx > h.left + h.w || sy < h.top || sy > h.top + h.h) continue;
      if (h.poly && !h.poly.some((o) => inPolygon(o, o.length, sx, sy))) continue;
      // An aqueduct's bay takes the click where its masonry is drawn and nothing drawn after it stands over that point.
      if (h.aq && (!this.aqueducts.hits(h.aq, sx, sy) || this.coveredAfter(sx, sy, h.x, h.y, h.bridge))) continue;
      return { ...this.makePick(h.x, h.y, sx, sy), bridge: h.bridge };
    }
    for (let i = this.anvilHits.length - 1; i >= 0; i--) {
      const h = this.anvilHits[i];
      if (sx >= h.left && sx <= h.left + h.w && sy >= h.top && sy <= h.top + h.h) return { ...this.makePick(h.x, h.y, sx, sy), anvil: h.anvil };
    }
    for (let i = this.fireHits.length - 1; i >= 0; i--) {
      const h = this.fireHits[i];
      if (sx >= h.left && sx <= h.left + h.w && sy >= h.top && sy <= h.top + h.h) return { ...this.makePick(h.x, h.y, sx, sy), fire: h.fire };
    }
    // Looking into a cellar: its floor, nearest first; and a side of the dig is nothing to click on.
    if (this.cellarHulls.length) {
      const hulls = this.cellarHulls;
      for (let i = hulls.length - 1; i >= 0; i--) {
        if (inOutline(hulls[i].floor, sx, sy)) {
          const { x, y } = hulls[i];
          return { ...this.makePick(x, y, sx, sy, cellarFloorHeight(this.game, x, y)), down: true };
        }
      }
      for (const h of hulls) if (inOutline(h.hull, sx, sy)) return null;
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

  /**
   * Whether something drawn after the bay of an aqueduct on tile `bx, by`
   * stands over a screen point: the ground or the water of a line of the
   * ground nearer the camera, a foundation or a deck on piers on one, a wall
   * a nearer line draws, or the roof of a building laid after it. A click
   * there is on that, not on the masonry behind it.
   */
  private coveredAfter(sx: number, sy: number, bx: number, by: number, bridge: number | undefined): boolean {
    const cam = this.camera;
    const world = this.game.world;
    const V = cam.view;
    const d0 = depthOf(V, bx, by);
    const iso = cam.screenToIso(sx, sy);
    const stepW = HALF_W * V.unit;
    const stepH = HALF_H * V.unit;
    const eF = iso.x / stepW;
    const dF = iso.y / stepH;
    const bld = this.game.buildings;
    // As high as anything on a line can stand: the ground, and the storeys and the roof of a building on it.
    const up = Math.ceil(((world.maxHeight + (TOP_LEVELS + 2) * WALL_HEIGHT) * HEIGHT_SCALE) / stepH) + 1;
    const down = Math.ceil((-world.minHeight * HEIGHT_SCALE) / stepH) + 3;
    const p = COVER_PTS;
    const corner = (cx: number, cy: number, h: number, i: number): void => {
      p[i * 2] = cam.worldToScreenX(cx, cy);
      p[i * 2 + 1] = cam.worldToScreenY(cx, cy, h);
    };
    for (let d = Math.floor(dF) + up; d > d0 && d >= Math.floor(dF) - down; d--) {
      for (let e = Math.floor(eF) - 1; e <= Math.ceil(eF) + 1; e++) {
        if (V.staggered && ((e + d) & 1) !== 0) continue;
        const x = V.x[0] + V.x[1] * d + V.x[2] * e;
        const y = V.y[0] + V.y[1] * d + V.y[2] * e;
        if (!world.inBounds(x, y)) continue;
        // The ground, or the water over it.
        const water = world.surfaceAt(x, y);
        corner(x, y, Math.max(world.getHeight(x, y), water), 0);
        corner(x + 1, y, Math.max(world.getHeight(x + 1, y), water), 1);
        corner(x + 1, y + 1, Math.max(world.getHeight(x + 1, y + 1), water), 2);
        corner(x, y + 1, Math.max(world.getHeight(x, y + 1), water), 3);
        if (inPolygon(p, 8, sx, sy)) return true;
        // A poured foundation, as the box it stands in. (A bridge's deck drawn after the bay is before it in `deckHits`.)
        const slab = this.game.foundations.size ? this.game.slabAt(x, y) : undefined;
        if (slab && this.boxHas(x, y, null, slab.top, sx, sy)) return true;
        // A finished deck on piers, as thick as it is laid (`slabOutline`).
        const deck = bld.pierTiles.size ? this.game.pierDeckAt(x, y) : null;
        if (deck !== null && this.boxHas(x, y, deck - FLOOR_DEEP, deck, sx, sy)) return true;
        // The walls this line draws: the borders of the tile facing away from the camera, every storey of them.
        for (const side of V.back) {
          for (let level = 0; level < TOP_LEVELS; level++) {
            const w = bld.walls.size ? bld.wall(level, x, y, side) : undefined;
            if (!w) break;
            if (!isDone(w) || WALL_TYPE_BY_ID.get(w.type)?.low) continue;
            const owner = bld.list.get(w.building);
            const [ax, ay, bx2, by2] = side === 'n' ? [x, y, x + 1, y] : side === 's' ? [x, y + 1, x + 1, y + 1] : side === 'w' ? [x, y, x, y + 1] : [x + 1, y, x + 1, y + 1];
            // On the ground at the corner of the tile drawing it, or on the deck of a building on piers (`drawStructures`).
            const base = owner?.deck ?? world.getHeight(x, y);
            corner(ax, ay, base + level * WALL_HEIGHT, 0);
            corner(bx2, by2, base + level * WALL_HEIGHT, 1);
            corner(bx2, by2, base + (level + 1) * WALL_HEIGHT, 2);
            corner(ax, ay, base + (level + 1) * WALL_HEIGHT, 3);
            if (owner && inPolygon(p, 8, sx, sy)) return true;
          }
        }
      }
    }
    // A roof laid after it, unless the bay stands in front of that building and is cut out of its roof (`AqueductPainter.before`).
    for (const [row, list] of this.roofQueue) {
      if (row <= d0) continue;
      for (const b of list) {
        if (this.aqueducts.before(b.tiles, row, V).some((c) => c.b.id === bridge && c.b.spans[c.k].x === bx && c.b.spans[c.k].y === by)) continue;
        if (this.roofCovers(b, sx, sy)) return true;
      }
    }
    return false;
  }

  /** Whether a screen point is in the box over a tile from `bottom` (its ground where null) up to `top`, as the eye sees it. */
  private boxHas(x: number, y: number, bottom: number | null, top: number, sx: number, sy: number): boolean {
    const cam = this.camera;
    const w = this.game.world;
    const pts: number[] = [];
    for (const [cx, cy] of [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]) {
      const px = cam.worldToScreenX(cx, cy);
      pts.push(px, cam.worldToScreenY(cx, cy, top), px, cam.worldToScreenY(cx, cy, bottom ?? w.getHeight(cx, cy)));
    }
    return inHull(pts, sx, sy);
  }

  /**
   * Whether a screen point is on a building's pitched roof as `drawPitchedRoof`
   * lays it: a face, a hair past its edges as it is outlined; the cap along a
   * ridge or a hip, as wide as it is stroked; the fascia under an eave on the
   * near side; or a gable end on the near side (`drawGable`).
   */
  private roofCovers(b: Building, sx: number, sy: number): boolean {
    const kept = this.roofShapes.get(b.id);
    if (!kept) return false;
    const cam = this.camera;
    const zoom = cam.zoom;
    const world = this.game.world;
    const bld = this.game.buildings;
    const roofs: FloorTile[] = [];
    for (const k of b.tiles) {
      const [x, y] = k.split(',').map(Number);
      const f = bld.floor(b.levels, x, y);
      if (f && floorKind(f) === 'roof') roofs.push(f);
    }
    if (!roofs.length) return false;
    let eave = -Infinity;
    for (const f of roofs) eave = Math.max(eave, world.getHeight(f.x, f.y));
    // A building on piers stands on its deck, whatever the ground under it does.
    if (b.deck != null) eave = b.deck;
    eave += b.levels * WALL_HEIGHT;
    const pitch = ROOF_PITCH * roofShapeDef(b).rise;
    const model = kept.model;
    const X = (q: RoofPt): number => cam.worldToScreenX(q[0], q[1]);
    const Y = (q: RoofPt, drop = 0): number => cam.worldToScreenY(q[0], q[1], eave + pitch * q[2] - drop);
    for (const face of model.faces) {
      const n = face.pts.length;
      const poly = new Float64Array(n * 2);
      let cx = 0, cy = 0;
      face.pts.forEach((q, i) => {
        poly[i * 2] = X(q);
        poly[i * 2 + 1] = Y(q);
        cx += poly[i * 2] / n;
        cy += poly[i * 2 + 1] / n;
      });
      for (let i = 0; i < n * 2; i += 2) {
        const l = Math.hypot(poly[i] - cx, poly[i + 1] - cy) || 1;
        poly[i] += ((poly[i] - cx) / l) * 0.5;
        poly[i + 1] += ((poly[i + 1] - cy) / l) * 0.5;
      }
      if (inPolygon(poly, n * 2, sx, sy)) return true;
    }
    for (const c of model.creases) {
      if (c.kind === 'valley' || !isDone(roofs[c.tile])) continue;
      const w = Math.max(1.5, covering(roofs[c.tile].material).cap.w * zoom);
      const reach = (w + Math.max(1.2, 1.4 * zoom)) / 2 + Math.max(0.5, 0.5 * zoom);
      if (nearSegment(X(c.a), Y(c.a), X(c.b), Y(c.b), sx, sy, reach)) return true;
    }
    const p = COVER_PTS;
    for (const e of model.edges) {
      if (!isDone(roofs[e.tile])) continue;
      const [ox, oy] = FALLS[e.out];
      if (cam.nearSide(ox, oy) < 0) continue;
      const dp = covering(roofs[e.tile].material).fascia.deep;
      p[0] = X(e.a); p[1] = Y(e.a); p[2] = X(e.b); p[3] = Y(e.b);
      p[4] = X(e.b); p[5] = Y(e.b, dp); p[6] = X(e.a); p[7] = Y(e.a, dp);
      if (inPolygon(p, 8, sx, sy)) return true;
    }
    for (const g of model.gables) {
      const [ox, oy] = FALLS[g.out];
      if (cam.nearSide(ox, oy) < 0) continue;
      const out: number[] = [];
      const at = (q: RoofPt, h: number): void => {
        const wx = q[0] + ox * WALL_THICK, wy = q[1] + oy * WALL_THICK;
        out.push(cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, eave + h));
      };
      at(g.line[0], 0);
      for (const q of g.line) at(q, pitch * q[2]);
      at(g.line[g.line.length - 1], 0);
      if (inPolygon(out, out.length, sx, sy)) return true;
    }
    return false;
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

  private makePick(x: number, y: number, sx: number, sy: number, h?: number): Pick {
    const w = this.game.world;
    const approx = this.camera.screenToWorld(sx, sy, h ?? w.centerHeight(x, y));
    const wx = Math.min(x + 0.999, Math.max(x, approx.x));
    const wy = Math.min(y + 0.999, Math.max(y, approx.y));
    return { x, y, wx, wy, cx: Math.round(wx), cy: Math.round(wy) };
  }
}
