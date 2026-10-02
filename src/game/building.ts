/**
 * Buildings, Wurm style: a footprint of flat packed-dirt tiles on a deed,
 * walls that sit on tile borders, and stacked floors. Walls and floors are
 * planned first, then built by feeding them materials one unit at a time.
 */
import { fill } from './words';

export type WallType = 'solid' | 'window' | 'bay' | 'door' | 'double_door' | 'arch' | 'fence' | 'fence_gate' | 'half_wall' | 'iron_gate'
  | 'counter' | 'railing';

/**
 * How high a railing stands, as a share of a storey: waist-high, a little
 * under a fence, because it is leant on rather than climbed.
 */
export const RAILING_HEIGHT = 0.36;

export interface WallTypeDef {
  id: WallType;
  name: string;
  /** Material multiplier relative to a solid wall. */
  factor: number;
  passable: boolean;
  /** How much of a storey it stands, for drawing; 1 is a full wall. */
  height?: number;
  /**
   * Waist-high work: it stops anything alive at the border and nothing rests
   * on it, so no storey can be raised over a run of it.
   */
  low?: boolean;
  /** Posts and rails rather than a face, for drawing. */
  railed?: boolean;
  /** Offered on any border, building or no building. */
  standalone?: boolean;
  /** Passable for people and for nothing else: a wildermon or a monster finds it shut. */
  beastProof?: boolean;
  /** Cast metal the wall takes over its material's bill: hinges for anything that swings, brackets to bind a gate. */
  fittings?: Array<[string, number]>;
  /**
   * How thick it is against an ordinary wall, for the drawing. A bay stands
   * proud of the wall it is let into; a half wall is a parapet and is built
   * heavier than the storey it caps.
   */
  thick?: number;
  /**
   * Wide enough to drive through.
   *
   * A door is a door: you turn sideways and carry what you can hold. A cart
   * needs an opening it fits through, which is what a double door, an archway
   * and a gate in a fence are for — and what they were never given a reason to
   * be, since a cart went through a single door as happily as a person.
   */
  wide?: boolean;
  /**
   * Stops the eye. Only a solid wall does: a window and a bay are glass, a
   * door, an arch and a gate are openings, and a fence or a half wall is
   * waist-high and seen over.
   */
  opaque?: boolean;
}

export const WALL_TYPES: WallTypeDef[] = [
  { id: 'solid', name: 'Solid', factor: 1, passable: false, opaque: true },
  { id: 'window', name: 'Window', factor: 0.75, passable: false, fittings: [['glass', 6]] },
  /*
   * No `thick`. It used to carry 1.7 of it, which moved the whole section
   * that much nearer the camera and left a slice of ground showing at the
   * joint with its neighbours -- a wall a bay is set into is the thickness
   * the wall is. What a bay projects by, it projects by: the box stands out
   * in front of the face, which is where a bay actually is.
   */
  { id: 'bay', name: 'Bay window', factor: 1.25, passable: false, fittings: [['glass', 12]] },
  { id: 'door', name: 'Door', factor: 0.75, passable: true, fittings: [['hinge', 4]] },
  { id: 'double_door', name: 'Double door', factor: 1, passable: true, wide: true, fittings: [['hinge', 8]] },
  /*
   * A doorway with nothing hung in it.
   *
   * It is the only opening in the list that takes no ironwork — there is
   * nothing to swing, so there are no hinges to cast — and the only one you
   * can walk through that a wildermon can walk through as well. That is the
   * trade: an archway is cheaper than a door and quicker to raise, and it
   * shuts nothing out. Build it between two rooms of your own and put a door
   * on the way in from the field.
   */
  { id: 'arch', name: 'Arch', factor: 0.85, passable: true, wide: true },
  // Waist-high, and cheap because there is so much less of them. A gate is
  // the one thing in the list you can walk through.
  { id: 'fence', name: 'Fence', factor: 0.3, passable: false, height: 0.42, low: true, railed: true, standalone: true },
  { id: 'fence_gate', name: 'Fence gate', factor: 0.4, passable: true, wide: true, height: 0.42, low: true, railed: true, standalone: true, fittings: [['hinge', 2]] },
  // Bound in iron: it swings for a person and holds against everything else.
  { id: 'iron_gate', name: 'Iron-bound gate', factor: 0.5, passable: true, wide: true, height: 0.6, low: true, railed: true, standalone: true, beastProof: true, fittings: [['hinge', 4], ['bracket', 8]] },
  { id: 'half_wall', name: 'Half wall', factor: 0.5, passable: false, height: 0.5, low: true, standalone: true, thick: 1.25 },
  /*
   * A shop counter: a board at waist height in an opening in the wall, the
   * wall carried over it on a lintel so a storey still stands on it, and an
   * awning over the opening on two arms that swing on the hinges. Nobody goes
   * through it and the eye goes over it. What it sells and who may buy is
   * `counters.ts`.
   */
  { id: 'counter', name: 'Shop counter', factor: 0.75, passable: false, fittings: [['hinge', 2]] },
  /*
   * The edge of a balcony or a terrace: a rail and its balusters, waist-high
   * and seen through. It stops anybody walking off, as every wall does, and it
   * is low, so nothing is ever built on it. Only on a storey above the ground,
   * a deck on piers or round a flat roof: on the ground it would be a fence,
   * and there are fences for that. See `frame.ts` and `railing.ts`.
   */
  { id: 'railing', name: 'Railing', factor: 0.35, passable: false, height: RAILING_HEIGHT, low: true, railed: true },
];
export const WALL_TYPE_BY_ID = new Map(WALL_TYPES.map((w) => [w.id, w]));
/** Whether a wall type is waist-high work that nothing can be built over. */
export const isLowWall = (type: WallType): boolean => !!WALL_TYPE_BY_ID.get(type)?.low;
/** Whether a cart, a wagon or anything else on wheels fits through it. */
export const isWideOpening = (type: WallType): boolean => !!WALL_TYPE_BY_ID.get(type)?.wide;
/** The types that can go on any border, with or without a building around them. */
export const FENCE_TYPES = WALL_TYPES.filter((w) => w.standalone);

export type RGB = readonly [number, number, number];

export interface MaterialDef {
  id: string;
  name: string;
  kind: 'wood' | 'stone';
  /** Tool needed to build with it. */
  tool: 'mallet' | 'trowel';
  skill: 'carpentry' | 'masonry';
  color: RGB;
  trim: RGB;
  floor: RGB;
  /**
   * How many courses of it cover a roof slope, and how many boards a floor of
   * it is laid in — one number for both, because both are the same question:
   * how big a piece the stuff comes in. Slate splits small and goes on in many
   * narrow courses; a marble slab is cut big and goes on in few wide ones.
   */
  courses: number;
  /** Items consumed by one solid wall. */
  bill: Array<[string, number]>;
  /**
   * How many storeys of the stuff will stand on top of one another.
   *
   * A log house is a log house: three storeys of squared timber is already a
   * tall thing to have built out of trees, and the fourth is how you find out
   * why nobody does. Cut and mortared stone goes to the ten the world allows.
   */
  storeys: number;
  /**
   * How heavy one storey of it is, and so what has to be under it.
   *
   * Three grades, because three is what anybody can hold in their head while
   * they plan: timber, which anything carries; brick, rubble and rammed earth;
   * and cut stone, which only cut stone will take. Nothing heavier may be
   * raised over something lighter — the courses below have to carry it, and a
   * marble storey over a log one is a roof looking for somewhere to fall.
   */
  heft: number;
}

/** The three grades of weight, as a builder names them. */
export const HEFT_WORDS: Record<number, string> = { 1: 'timber', 2: 'brick and rubble', 3: 'cut stone' };
export const heftWord = (n: number): string => HEFT_WORDS[n] ?? 'timber';
/**
 * Skill in the storey-below's trade wanted before another storey may be
 * planned over it: ten a storey, so the second wants ten and the tenth ninety.
 */
export const STOREY_SKILL = 10;
/** Past the tenth storey, which only a Mason's Tall Walls reaches, a hundred is as much as there is. */
export const storeySkill = (levels: number): number => Math.min(100, levels * STOREY_SKILL);

export const MATERIALS: MaterialDef[] = [
  { id: 'log', name: 'Log', kind: 'wood', tool: 'mallet', skill: 'carpentry', color: [139, 106, 62], trim: [92, 66, 38], floor: [150, 118, 74], courses: 3, bill: [['log', 16]], storeys: 3, heft: 1 },
  { id: 'plank', name: 'Plank', kind: 'wood', tool: 'mallet', skill: 'carpentry', color: [178, 138, 84], trim: [112, 82, 46], floor: [186, 148, 96], courses: 4, bill: [['plank', 24], ['timber', 4]], storeys: 4, heft: 1 },
  { id: 'timbercraft', name: 'Timbercraft', kind: 'wood', tool: 'mallet', skill: 'carpentry', color: [206, 184, 142], trim: [88, 62, 38], floor: [176, 140, 92], courses: 4, bill: [['plank', 8], ['thatch', 8], ['timber', 8]], storeys: 4, heft: 1 },
  { id: 'cobblestone', name: 'Cobblestone', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [140, 136, 128], trim: [92, 88, 82], floor: [126, 122, 116], courses: 4, bill: [['rock_shards', 20], ['mortar', 10]], storeys: 6, heft: 2 },
  { id: 'slate', name: 'Slate', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [96, 104, 118], trim: [60, 66, 78], floor: [88, 96, 110], courses: 5, bill: [['slate_brick', 24], ['mortar', 12]], storeys: 8, heft: 3 },
  { id: 'marble', name: 'Marble', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [228, 226, 220], trim: [170, 168, 160], floor: [216, 214, 208], courses: 2, bill: [['marble_brick', 32], ['mortar', 16]], storeys: 10, heft: 3 },
  { id: 'sandstone', name: 'Sandstone', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [214, 184, 132], trim: [150, 122, 78], floor: [200, 172, 124], courses: 3, bill: [['sandstone_brick', 24], ['mortar', 12]], storeys: 7, heft: 3 },
  { id: 'stone_brick', name: 'Stone brick', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [160, 154, 144], trim: [104, 98, 90], floor: [148, 142, 132], courses: 3, bill: [['stone_brick', 24], ['mortar', 12]], storeys: 10, heft: 3 },
  { id: 'clay_adobe', name: 'Clay adobe', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [198, 154, 106], trim: [138, 100, 62], floor: [184, 142, 98], courses: 3, bill: [['adobe', 10]], storeys: 5, heft: 2 },
  { id: 'clay_bricks', name: 'Clay bricks', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [176, 85, 60], trim: [110, 50, 36], floor: [164, 82, 60], courses: 5, bill: [['clay_brick', 12], ['mortar', 6]], storeys: 7, heft: 2 },
  { id: 'ornate_silver', name: 'Ornate silver', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [200, 204, 212], trim: [120, 126, 140], floor: [190, 194, 202], courses: 3, bill: [['stone_brick', 24], ['mortar', 12], ['silver_lump', 12]], storeys: 10, heft: 3 },
  { id: 'ornate_gold', name: 'Ornate gold', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [217, 180, 81], trim: [150, 112, 34], floor: [206, 172, 84], courses: 3, bill: [['stone_brick', 24], ['mortar', 12], ['gold_lump', 12]], storeys: 10, heft: 3 },
];
export const MATERIAL_BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));
/**
 * Glass, for a roof: panes laid on timber glazing bars, put up with the mallet
 * and trained as carpentry. A roof covering and nothing else, so it is not in
 * `MATERIALS`, which every menu of walls, fences and floors offers -- but it is
 * looked up by id like any of them, and its bill is a solid wall's worth that a
 * roof shape takes its share of, as every material's is. See `glasshouse.ts`.
 */
export const GLASS_ROOF: MaterialDef = {
  id: 'glass', name: 'Glass', kind: 'wood', tool: 'mallet', skill: 'carpentry',
  color: [190, 222, 214], trim: [238, 236, 226], floor: [190, 222, 214], courses: 6,
  // A roof is not a wall: neither how high it stands nor how heavy it is is ever asked of it.
  bill: [['glass', 24], ['timber', 8]], storeys: 10, heft: 1,
};
MATERIAL_BY_ID.set(GLASS_ROOF.id, GLASS_ROOF);

/** Height of one storey in terrain units (3 m). */
export const WALL_HEIGHT = 30;
/**
 * Half the thickness of a wall and of a fence, in tiles.
 *
 * A wall is centred on its border and stands out this far either side of it,
 * which is what gives it a top to catch the light and an end to show its
 * grain. Reported as "walls are paper thin", and they were: a wall was a line
 * with a picture on it. Forty-odd centimetres of stone at four metres to the
 * tile is enough to read as built and not so much that a room loses its floor.
 */
export const WALL_THICK = 0.055;
export const FENCE_THICK = 0.028;
/**
 * How deep a floor deck is, in terrain units: the joists and the boards over
 * them. Only ever seen at an edge with nothing beyond it, which is exactly
 * where a floor without one stops looking like a floor and starts looking like
 * a sheet of paper laid over the storey below.
 */
export const FLOOR_DEEP = 2.2;
/** And how deep an eave is: the board along the rafter ends, under the courses lapped over them. */
export const EAVE_DEEP = 2.6;
export const MAX_LEVELS = 10;
/**
 * How many storeys past what its stone will stand a building of stone may
 * rise when it was planned by a Mason with Tall Walls, and so the tallest any
 * building on the island can be. Everything that walks, climbs or looks up a
 * building reaches as high as this; everything that plans one stops at
 * `MAX_LEVELS` without the perk.
 */
export const TALL_STOREYS = 2;
export const TOP_LEVELS = MAX_LEVELS + TALL_STOREYS;
/**
 * What a roof over your head is worth to everything left under it.
 *
 * A tenth, on top of whatever the ground is already worth — so a tenth in the
 * wild and a hundredth on a deed. A roof cost half a wall and did nothing at
 * all before this.
 */
export const INDOORS_DECAY = 0.1;
/** How much more of a night a bed indoors banks than the same bed in a field. */
export const INDOORS_REST = 1.35;

/**
 * A cellar: the storey under the ground floor, dug out of the ground a tile at
 * a time under a finished building (`cellar.ts` holds its rules).
 *
 * It is storey `CELLAR_LEVEL`, one below the ground floor's nought, and it is
 * `CELLAR_DEPTH` deep -- one storey -- so its floor lies that far under the
 * ground floor over it. The ground floor stays where it is: a cellar is dug
 * *under* it, and the way down is a flight or a ladder on the ground floor.
 */
export const CELLAR_LEVEL = -1;
export const CELLAR_DEPTH = WALL_HEIGHT;
/**
 * What a cellar is worth to everything left lying in it: a twentieth of the
 * rate out of doors, in place of the tenth a room above ground is worth
 * (`INDOORS_DECAY`), and on top of whatever the deed is worth -- so the
 * slowest anything rots anywhere.
 */
export const CELLAR_DECAY = 0.05;
/** Where a crate or a piece goes that is set down from down in a cellar: on that cellar's own floor. */
export const CELLAR_FLOOR = 'Set it down on the floor of the cellar you are in.';
/**
 * The least soil over the rock, at every corner of a tile, for a cellar to be
 * started under it: a cellar is begun with a shovel, and where the rock comes
 * nearer the ground floor than this there is nothing to begin in.
 */
export const CELLAR_SOIL = 3;
/** The storey a thing or a body counts as for reach: the cellar, or the ground and everything over it. */
export const floorOf = (level: number | undefined): number => ((level ?? 0) < 0 ? CELLAR_LEVEL : 0);

/** One tile of a cellar, dug or being dug. */
export interface CellarTile {
  building: number;
  x: number;
  y: number;
  /** How far down it has been dug, in terrain units; a cellar at `CELLAR_DEPTH`. */
  dug: number;
}

export type Side = 'n' | 'e' | 's' | 'w';
export const SIDE_NAMES: Record<Side, string> = { n: 'north', e: 'east', s: 'south', w: 'west' };
export type Dir = 'h' | 'v';

/** A tile border in canonical form: `h` is the north border of tile (x, y), `v` its west border. */
export interface Border {
  x: number;
  y: number;
  dir: Dir;
}

export function borderOf(x: number, y: number, side: Side): Border {
  switch (side) {
    case 'n':
      return { x, y, dir: 'h' };
    case 's':
      return { x, y: y + 1, dir: 'h' };
    case 'w':
      return { x, y, dir: 'v' };
    default:
      return { x: x + 1, y, dir: 'v' };
  }
}

/** Whether a step from one tile to its neighbour goes square across the tile's `side`: across that border, not round a corner. */
export function acrossSide(side: Side, x0: number, y0: number, x1: number, y1: number): boolean {
  switch (side) {
    case 'n':
      return x1 === x0 && y1 === y0 - 1;
    case 's':
      return x1 === x0 && y1 === y0 + 1;
    case 'w':
      return x1 === x0 - 1 && y1 === y0;
    default:
      return x1 === x0 + 1 && y1 === y0;
  }
}

/** World corner points of a border, from a to b. */
export function borderPoints(b: Border): [number, number, number, number] {
  return b.dir === 'h' ? [b.x, b.y, b.x + 1, b.y] : [b.x, b.y, b.x, b.y + 1];
}

export interface Bill {
  needed: Record<string, number>;
  total: Record<string, number>;
}

export interface Wall extends Bill {
  building: number;
  level: number;
  x: number;
  y: number;
  dir: Dir;
  type: WallType;
  material: string;
  /**
   * The colour it has been painted, if it has.
   *
   * The same pots the tailoring uses, worked into a limewash and brushed over
   * finished stone or boarding. Everything on this island comes out the colour
   * of what it was made of and a street of twelve materials is still a street
   * of twelve colours; paint is the first thing a builder gets to choose.
   */
  dye?: string;
  /**
   * When the ivy on it began, in real seconds: when it was finished, laid again
   * in another stone or last cleared. See `greening.ts`; absent is when
   * greening came to the island (`Game.greenFrom`).
   */
  greenSince?: number;
}

/**
 * What occupies a tile's floor slot on a storey. Stairs and ladders sit on the
 * upper storey and connect it with the one below; a roof sits one level above
 * the top storey.
 */
export type FloorKind = 'floor' | 'stairs' | 'ladder' | 'roof';
export const FLOOR_KIND_NAMES: Record<FloorKind, string> = { floor: 'floor', stairs: 'staircase', ladder: 'ladder', roof: 'roof' };

export interface FloorTile extends Bill {
  building: number;
  level: number;
  x: number;
  y: number;
  material: string;
  kind?: FloorKind;
  /** For stairs and ladders: the side where you step on from below. */
  facing?: Side;
  /** The colour it has been painted, if it has. */
  dye?: string;
}

export const floorKind = (f: FloorTile): FloorKind => f.kind ?? 'floor';
/** Whether a finished floor tile can be stood on. */
export const walkableKind = (k: FloorKind): boolean => k !== 'roof';
export const connectsDown = (k: FloorKind): boolean => k === 'stairs' || k === 'ladder';
/**
 * How far a pitched roof rises for every tile it is in from its eaves, in
 * terrain units: a roof over a house two tiles across stands one tile's
 * worth of this over its eaves at the ridge, and one over a hall stands
 * higher.
 */
export const ROOF_PITCH = 22;

/**
 * What shape the roof is.
 *
 * Every building on the island had the same roof: one rise, hipped on all four
 * sides, because there was one way of drawing a roof and no way of asking for
 * another. Three now, and they are a real choice rather than three pictures.
 *
 * A **gable** runs one ridge the length of the building and falls to the eaves
 * on two sides only; the ends are the wall carried up in a triangle, which is
 * why it is the cheapest of the three — there is less roof.
 *
 * A **hip** falls away on all four sides. More covering, no gable ends to
 * build, and it is what a building had before any of this.
 *
 * A **flat** roof is not really a roof at all: it is a floor with nothing over
 * it, laid heavy enough to walk on and stand a chair on. It costs most, and
 * what you get for it is a terrace.
 */
export type RoofShape = 'gable' | 'hip' | 'flat';
export interface RoofShapeDef {
  id: RoofShape;
  name: string;
  /** How far it rises for every tile in from its eaves, as a share of `ROOF_PITCH`. */
  rise: number;
  /** Materials, against a solid wall of the same stuff. */
  factor: number;
  /** Whether you may walk out onto it. */
  walkable: boolean;
  note: string;
}
export const ROOF_SHAPES: RoofShapeDef[] = [
  { id: 'gable', name: 'Gabled', rise: 1, factor: 0.3, walkable: false,
    note: 'One ridge down the length of it, falling to the eaves on the long sides; the ends are wall carried up in a triangle rather than roof. A tile of it takes {factor:share} of what a solid wall of the same stuff does.' },
  { id: 'hip', name: 'Hipped', rise: 1, factor: 0.5, walkable: false,
    note: 'Falling away on every side, with no gable ends to raise, and it sheds weather off every wall. A tile of it takes {factor:share} of what a solid wall of the same stuff does.' },
  { id: 'flat', name: 'Flat', rise: 0, factor: 0.85, walkable: true,
    note: 'A deck rather than a roof: laid heavy enough to walk out onto, and what you get for it is a terrace. A tile of it takes {factor:share} of what a solid wall of the same stuff does.' },
];
// What a roof costs is said off its own `factor`, so the three can be weighed against each other.
for (const r of ROOF_SHAPES) r.note = fill(r.note, r);
export const ROOF_SHAPE_BY_ID = new Map(ROOF_SHAPES.map((r) => [r.id, r]));
/** A building's roof shape; hipped is what every building had before there was a choice. */
export const roofShapeOf = (b: Building | undefined): RoofShape => b?.roof ?? 'hip';
export const roofShapeDef = (b: Building | undefined): RoofShapeDef => ROOF_SHAPE_BY_ID.get(roofShapeOf(b)) ?? ROOF_SHAPES[1];

/** A room: the tiles of it, and whether it is shut in and covered over. */
export interface Room {
  building: number;
  level: number;
  tiles: string[];
  enclosed: boolean;
  covered: boolean;
}

/**
 * Whether a border is one of a room's own edges, or stands over one.
 *
 * What the cutaway asks of every wall it is about to draw. A border has two
 * tiles either side of it; it walls this room when either of them is in it.
 * The storey is deliberately not part of the question — a wall on the floor
 * above, standing over the room you are in, is as much in the way as one
 * beside you, and a cutaway that let it stand would show you a room with a
 * lid on it.
 */
export function bordersRoom(tiles: ReadonlySet<string>, b: Border): boolean {
  return b.dir === 'h'
    ? tiles.has(tileKey(b.x, b.y - 1)) || tiles.has(tileKey(b.x, b.y))
    : tiles.has(tileKey(b.x - 1, b.y)) || tiles.has(tileKey(b.x, b.y));
}

export interface Building {
  id: number;
  name: string;
  tiles: string[];
  /** Number of storeys planned; the ground floor counts as one. */
  levels: number;
  /** Storey that wall and floor work applies to; defaults to the top one. */
  workLevel?: number;
  /** The shape of its roof, chosen when the first roof tile is planned. */
  roof?: RoofShape;
  /**
   * The height its ground floor stands at when any of it stands on piers
   * (`piers.ts`), set when the first tile on piers is taken in; absent (or
   * null, off the island) for a building standing on its ground.
   */
  deck?: number | null;
  /** Which of its tiles stand on piers, as `x,y` keys; absent for none. */
  piers?: string[];
}

/** The storey being worked on, clamped to what exists. */
export const workLevel = (b: Building): number => Math.min(b.workLevel ?? b.levels - 1, b.levels - 1);
/**
 * The storey a job on a building is for: the one the job names (`level` in
 * its target, which the menus fill in from the storey being worked), when the
 * building has it, or else the storey being worked. The island reads the same
 * field the same way (`frame_job_level`), so a job asked from a menu lands on
 * the storey the menu said, whatever the island last took to be worked.
 */
export function jobLevel(b: Building, t: { level?: number }): number {
  const l = t.level;
  return typeof l === 'number' && Number.isInteger(l) && l >= 0 && l <= b.levels - 1 ? l : workLevel(b);
}

export const isDone = (b: Bill): boolean => Object.values(b.needed).every((n) => n <= 0);

/**
 * What is left before a storey is closed in: sides with nothing on them at
 * all, walls that are up but not finished, and the nearest of either.
 */
export interface LevelGap {
  bare: number;
  unfinished: number;
  at?: { x: number; y: number; side: Side };
}

/**
 * That, as the sentence both sides say. A door, a window and a gate are walls
 * here — what a border wants is something on it with its bill paid, and it has
 * never cared which kind.
 */
export function gapText(storey: number, gap: LevelGap): string | null {
  if (!gap.bare && !gap.unfinished) return null;
  const parts: string[] = [];
  if (gap.bare) parts.push(`${gap.bare} side${gap.bare === 1 ? '' : 's'} with no wall or columns`);
  if (gap.unfinished) parts.push(`${gap.unfinished} still going up`);
  const where = gap.at ? `, nearest the ${SIDE_NAMES[gap.at.side]} side of ${gap.at.x},${gap.at.y}` : '';
  return `Storey ${storey} is not closed in: ${parts.join(' and ')}${where}.`;
}

export function progressOf(b: Bill): number {
  const total = Object.values(b.total).reduce((s, n) => s + n, 0);
  const left = Object.values(b.needed).reduce((s, n) => s + n, 0);
  return total ? 1 - left / total : 1;
}

export function scaledBill(material: string, factor: number): Bill {
  const def = MATERIAL_BY_ID.get(material);
  const needed: Record<string, number> = {};
  if (def) for (const [id, n] of def.bill) needed[id] = Math.max(1, Math.ceil(n * factor));
  return { needed, total: { ...needed } };
}

/**
 * What a wall of this type and material takes to build. `scale` is a perk's
 * share of the material (a Carpenter's Fence Builder), rounded up like the
 * type's own; the fittings are what they are whatever the wall is of.
 */
export const wallBill = (material: string, type: WallType, scale = 1): Bill => {
  const def = WALL_TYPE_BY_ID.get(type);
  const bill = scaledBill(material, (def?.factor ?? 1) * scale);
  // The fittings go on top of the material's bill, whatever the wall is of.
  for (const [item, n] of def?.fittings ?? []) {
    bill.needed[item] = (bill.needed[item] ?? 0) + n;
    bill.total[item] = (bill.total[item] ?? 0) + n;
  }
  return bill;
};

/** Planks in a ladder, whatever the house it climbs is built of. */
export const LADDER_PLANKS = 8;

/**
 * Materials for a floor slot: a floor takes half a wall, stairs three
 * quarters, a ladder `LADDER_PLANKS` planks whatever the house is of, and a
 * roof whatever its shape costs — a gable least, because a gable end is wall
 * rather than roof, and a flat deck most, because a thing you walk on is built
 * like a floor.
 */
export function floorBill(material: string, kind: FloorKind = 'floor', roof: RoofShape = 'hip'): Bill {
  if (kind === 'ladder') return { needed: { plank: LADDER_PLANKS }, total: { plank: LADDER_PLANKS } };
  if (kind === 'roof') return scaledBill(material, ROOF_SHAPE_BY_ID.get(roof)?.factor ?? 0.5);
  return scaledBill(material, kind === 'stairs' ? 0.75 : 0.5);
}

/**
 * How far out past its footprint a storey above the ground may be floored:
 * a jetty is one tile, sharing an edge with the building, and never more.
 */
export const JETTY_REACH = 1;
/** What a column takes of a solid wall's bill in the same material. */
export const COLUMN_SHARE = 0.25;

/**
 * A column: a squared post in timber, a pillar in stone, standing on a tile
 * corner of a storey and carrying what is over it as a wall does. `x` and `y`
 * are the corner.
 */
export interface Column extends Bill {
  building: number;
  level: number;
  x: number;
  y: number;
  material: string;
  dye?: string;
}

/** What a column of a material takes to build: `COLUMN_SHARE` of a solid wall of it, rounded up. */
export const columnBill = (material: string): Bill => scaledBill(material, COLUMN_SHARE);

export const tileKey = (x: number, y: number): string => `${x},${y}`;
const wallKey = (level: number, b: Border): string => `${level}:${b.dir}:${b.x},${b.y}`;
const floorKey = (level: number, x: number, y: number): string => `${level}:${x},${y}`;
const columnKey = (level: number, x: number, y: number): string => `${level}:${x},${y}`;
/** A corner as one number, for an index the drawing asks of every tile: no island is 65536 corners across. */
const cornerNumber = (x: number, y: number): number => x * 65536 + y;
/** The four sides of a tile and the step across each, in the order the island asks them. */
const STEPS: ReadonlyArray<readonly [Side, number, number]> = [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]];

export interface BuildingsJSON {
  nextId: number;
  list: Building[];
  walls: Wall[];
  floors: FloorTile[];
  /** The tiles dug out under them, whole or in part; absent from a save made before there were cellars. */
  cellars?: CellarTile[];
  /** The columns standing on its corners, where there are any. */
  columns?: Column[];
}

export class Buildings {
  readonly list = new Map<number, Building>();
  readonly tileIndex = new Map<string, number>();
  readonly walls = new Map<string, Wall>();
  readonly floors = new Map<string, FloorTile>();
  /** Every tile that stands on piers, whoever's building it is in (`piers.ts`). */
  readonly pierTiles = new Set<string>();
  /** Counts every change to which tiles stand on piers, for what is worked out from them and kept (`Renderer.wetPiers`). */
  pierStamp = 0;
  /** What has been dug out under the ground floors, by tile (`tileKey`). */
  readonly cellars = new Map<string, CellarTile>();
  /** Columns, by storey and corner. */
  readonly columns = new Map<string, Column>();
  /**
   * The tiles out past every footprint that carry a floor of a storey, and
   * whose: a jetty's, a balcony's, or the roof over one (`jettyAt`). Kept as
   * floors come and go, because the drawing asks it of every tile it draws.
   */
  private readonly jettyIndex = new Map<string, number>();
  /** How many columns stand on each corner, whatever the storey, by `cornerNumber`: what the drawing asks first. */
  private readonly cornerIndex = new Map<number, number>();
  /**
   * The storey this browser chose to work on, by building, and how many
   * storeys the building had then. The island sends its own work level with
   * every ground read; a choice made here stands over it until the building
   * gains or loses a storey, since jobs name their storey (`jobLevel`).
   */
  private readonly chosen = new Map<number, { level: number; levels: number }>();
  nextId = 1;

  /** Work on a storey of a building, and keep to it across what the island sends. */
  chooseWorkLevel(b: Building, level: number): void {
    b.workLevel = Math.max(0, Math.min(level, b.levels - 1));
    this.chosen.set(b.id, { level: b.workLevel, levels: b.levels });
  }

  buildingAt(x: number, y: number): Building | undefined {
    const id = this.tileIndex.get(tileKey(x, y));
    return id === undefined ? undefined : this.list.get(id);
  }

  /** A new plan on one tile: on its ground, or on piers under a deck at `deck`. */
  create(name: string, x: number, y: number, deck?: number): Building {
    const b: Building = { id: this.nextId++, name, tiles: [tileKey(x, y)], levels: 1 };
    this.list.set(b.id, b);
    this.tileIndex.set(tileKey(x, y), b.id);
    if (deck !== undefined) this.standOnPiers(b, x, y, deck);
    return b;
  }

  addTile(b: Building, x: number, y: number, deck?: number): void {
    const key = tileKey(x, y);
    if (this.tileIndex.has(key)) return;
    b.tiles.push(key);
    this.tileIndex.set(key, b.id);
    if (deck !== undefined) this.standOnPiers(b, x, y, deck);
  }

  /** A tile of a building stood on piers, under a deck that is the building's from now on if it had none. */
  private standOnPiers(b: Building, x: number, y: number, deck: number): void {
    const key = tileKey(x, y);
    b.deck ??= deck;
    (b.piers ??= []).push(key);
    this.pierTiles.add(key);
    this.pierStamp++;
  }

  /** Whether any of the four tiles round a corner is a tile of a building: a corner whose ground is not to be moved. */
  aroundCorner(cx: number, cy: number): boolean {
    for (let y = cy - 1; y <= cy; y++) for (let x = cx - 1; x <= cx; x++) if (this.tileIndex.has(tileKey(x, y))) return true;
    return false;
  }

  /**
   * The deck a building on piers stands on at its lightest: the material of
   * the deck planned on each of its tiles on piers, the least heft first and
   * then by id, as the island's `deck_carries` orders them. Undefined for a
   * building with no deck planned on piers.
   */
  deckUnder(b: Building): MaterialDef | undefined {
    let best: MaterialDef | undefined;
    for (const key of b.piers ?? []) {
      const [x, y] = key.split(',').map(Number);
      const f = this.floor(0, x, y);
      const m = f && floorKind(f) === 'floor' ? MATERIAL_BY_ID.get(f.material) : undefined;
      if (m && (!best || m.heft < best.heft || (m.heft === best.heft && m.id < best.id))) best = m;
    }
    return best;
  }

  /** The heaviest wall planned or standing in a building, as a heft, its columns counted as the walls they stand for (`frame.ts`); nought for none. */
  heaviestWall(b: Building): number {
    let most = 0;
    for (const w of this.walls.values()) if (w.building === b.id) most = Math.max(most, MATERIAL_BY_ID.get(w.material)?.heft ?? 0);
    for (const c of this.columns.values()) if (c.building === b.id) most = Math.max(most, MATERIAL_BY_ID.get(c.material)?.heft ?? 0);
    return most;
  }

  /** Whether a tile stands on piers. */
  onPiers(x: number, y: number): boolean {
    return this.pierTiles.size > 0 && this.pierTiles.has(tileKey(x, y));
  }

  /** Drop a tile from a footprint; deletes the building when it was the last one. */
  removeTile(b: Building, x: number, y: number): void {
    const key = tileKey(x, y);
    b.tiles = b.tiles.filter((t) => t !== key);
    this.tileIndex.delete(key);
    if (b.piers?.includes(key)) {
      b.piers = b.piers.filter((t) => t !== key);
      this.pierTiles.delete(key);
      this.pierStamp++;
    }
    if (!b.tiles.length) this.list.delete(b.id);
  }

  /** Edge-adjacent buildings around a tile. */
  neighbourBuilding(x: number, y: number): Building | undefined {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const b = this.buildingAt(x + dx, y + dy);
      if (b) return b;
    }
    return undefined;
  }

  wall(level: number, x: number, y: number, side: Side): Wall | undefined {
    return this.walls.get(wallKey(level, borderOf(x, y, side)));
  }

  wallOnBorder(level: number, b: Border): Wall | undefined {
    return this.walls.get(wallKey(level, b));
  }

  /**
   * The building a border is the edge of, when it is the edge of exactly one.
   *
   * A border between two tiles of the same building is inside it; what this
   * finds is the outline, which is what a site marked out with stakes and
   * string looks like and where the scaffolding goes. A border between two
   * *different* buildings is an edge of both, and the near one owns it.
   */
  edgeOf(border: Border): Building | undefined {
    const near = this.buildingAt(border.x, border.y);
    const far = border.dir === 'h' ? this.buildingAt(border.x, border.y - 1) : this.buildingAt(border.x - 1, border.y);
    if (near && far && near.id === far.id) return undefined;
    return near ?? far;
  }

  setWall(b: Building, level: number, x: number, y: number, side: Side, type: WallType, material: string, scale = 1): Wall {
    return this.planWall(b.id, level, x, y, side, type, material, scale);
  }

  /**
   * A fence or a half wall on a bare border. It goes in the same place a wall
   * does — the border is the thing walls live on — and belongs to no building,
   * which is what building 0 means.
   */
  setFence(x: number, y: number, side: Side, type: WallType, material: string, scale = 1): Wall {
    return this.planWall(0, 0, x, y, side, type, material, scale);
  }

  private planWall(building: number, level: number, x: number, y: number, side: Side, type: WallType, material: string, scale = 1): Wall {
    const border = borderOf(x, y, side);
    const wall: Wall = { building, level, x: border.x, y: border.y, dir: border.dir, type, material, ...wallBill(material, type, scale) };
    this.walls.set(wallKey(level, border), wall);
    return wall;
  }

  /**
   * Whether a storey of a building carries anything waist-high — its own, or a
   * fence that was already standing on one of its borders when the footprint
   * was laid out around it. Either way there is nothing up there to build on.
   */
  hasLowWall(b: Building, level: number): boolean {
    // Up a storey, only what touches the storey the next one stands on: a
    // railing round a balcony shut off behind a door carries nothing.
    const area = level > 0 && this.jettyIndex.size ? this.storeyArea(b, level) : null;
    for (const w of this.walls.values()) {
      if (w.building !== b.id || w.level !== level || !isLowWall(w.type)) continue;
      if (area && !bordersRoom(area, w)) continue;
      return true;
    }
    if (level === 0) {
      for (const border of this.exteriorBorders(b)) {
        const w = this.wallOnBorder(level, border);
        if (w && isLowWall(w.type)) return true;
      }
    }
    return false;
  }

  removeWall(level: number, x: number, y: number, side: Side): void {
    this.walls.delete(wallKey(level, borderOf(x, y, side)));
  }

  floor(level: number, x: number, y: number): FloorTile | undefined {
    return this.floors.get(floorKey(level, x, y));
  }

  setFloor(b: Building, level: number, x: number, y: number, material: string, kind: FloorKind = 'floor', facing?: Side): FloorTile {
    const f: FloorTile = { building: b.id, level, x, y, material, kind, facing, ...floorBill(material, kind, roofShapeOf(b)) };
    this.floors.set(floorKey(level, x, y), f);
    if (level > 0 && !this.tileIndex.has(tileKey(x, y))) this.jettyIndex.set(tileKey(x, y), b.id);
    return f;
  }

  /** A finished roof tile at a level, if any. */
  roofAt(level: number, x: number, y: number): FloorTile | undefined {
    const f = this.floors.get(floorKey(level, x, y));
    return f && floorKind(f) === 'roof' ? f : undefined;
  }

  hasRoof(b: Building): boolean {
    for (const f of this.floors.values()) if (f.building === b.id && floorKind(f) === 'roof') return true;
    return false;
  }

  removeFloor(level: number, x: number, y: number): void {
    this.floors.delete(floorKey(level, x, y));
    if (this.jettyIndex.has(tileKey(x, y))) this.reindexJetty(x, y);
  }

  /** What has been dug out under a tile, if anything. */
  cellar(x: number, y: number): CellarTile | undefined {
    return this.cellars.size ? this.cellars.get(tileKey(x, y)) : undefined;
  }

  /** Whether a tile is dug out the whole storey down: a cellar tile, somewhere to stand at `CELLAR_LEVEL`. */
  cellarDone(x: number, y: number): boolean {
    const c = this.cellar(x, y);
    return !!c && c.dug >= CELLAR_DEPTH;
  }

  /**
   * Whether a tile is a finished tile of the given building's cellar. Two
   * buildings side by side have two cellars, with the ground between them:
   * nothing walks, sees or reaches from one into the other.
   */
  sameCellar(building: number | undefined, x: number, y: number): boolean {
    const c = this.cellar(x, y);
    return !!c && c.building === building && c.dug >= CELLAR_DEPTH;
  }

  /** Dig a tile down to `dug`, or fill it back in to nothing. */
  setCellar(building: number, x: number, y: number, dug: number): void {
    if (dug <= 0) this.cellars.delete(tileKey(x, y));
    else this.cellars.set(tileKey(x, y), { building, x, y, dug: Math.min(CELLAR_DEPTH, dug) });
  }

  /** Whether any of a building's ground has been dug out under it. */
  hasCellar(b: Building): boolean {
    for (const c of this.cellars.values()) if (c.building === b.id) return true;
    return false;
  }

  /** A finished staircase or ladder down from the ground floor to the cellar, on a tile. */
  flightDown(x: number, y: number): FloorTile | undefined {
    const f = this.floor(0, x, y);
    return f && connectsDown(floorKind(f)) && isDone(f) && this.cellarDone(x, y) ? f : undefined;
  }

  /** Any wall on the tile's borders or floor on the tile, at any level. */
  tileHasStructures(x: number, y: number): boolean {
    for (const w of this.walls.values()) {
      if (w.dir === 'h' && w.x === x && (w.y === y || w.y === y + 1)) return true;
      if (w.dir === 'v' && w.y === y && (w.x === x || w.x === x + 1)) return true;
    }
    for (const f of this.floors.values()) if (f.x === x && f.y === y) return true;
    return false;
  }

  /** Borders of the footprint whose far side is outside the building. */
  exteriorBorders(b: Building): Border[] {
    const out: Border[] = [];
    for (const key of b.tiles) {
      const [xs, ys] = key.split(',');
      const x = Number(xs);
      const y = Number(ys);
      const sides: Array<[Side, number, number]> = [
        ['n', x, y - 1],
        ['s', x, y + 1],
        ['w', x - 1, y],
        ['e', x + 1, y],
      ];
      for (const [side, nx, ny] of sides) if (this.tileIndex.get(tileKey(nx, ny)) !== b.id) out.push(borderOf(x, y, side));
    }
    return out;
  }

  /**
   * What is stopping a storey being closed in, counted and pointed at.
   *
   * `levelComplete` answers yes or no, and a no is no help at all on a
   * building of any size: reported as "cant plan roof on when conditions are
   * met", with the suspicion that a door or a window did not count as a wall.
   * They do, and always have — what counts is that a border carries a wall and
   * that its bill is paid, whatever kind of wall it is. What the answer never
   * said was *which* storey and *which* border, and on a building whose upper
   * storey has been planned but not walled, "all walls of the top storey must
   * be built" reads like a lie while you are standing in a finished room.
   *
   * So: how many sides have nothing on them, how many walls are still going
   * up, and where the nearest of them is from wherever you are standing.
   */
  levelGaps(b: Building, level: number, fromX: number, fromY: number): LevelGap {
    const gap: LevelGap = { bare: 0, unfinished: 0 };
    const holes: Array<{ x: number; y: number; side: Side }> = [];
    /*
     * The storey is its footprint and every jetty open to it (`storeyArea`),
     * and a side with no wall on it is closed all the same when a finished
     * column stands at both ends of it (`carried`): that is a colonnade.
     */
    const area = this.storeyArea(b, level);
    const outline = new Set<string>();
    for (const key of area) {
      const [xs, ys] = key.split(',');
      const x = Number(xs);
      const y = Number(ys);
      const sides: Array<[Side, number, number]> = [
        ['n', x, y - 1],
        ['e', x + 1, y],
        ['s', x, y + 1],
        ['w', x - 1, y],
      ];
      for (const [side, nx, ny] of sides) {
        if (area.has(tileKey(nx, ny))) continue;
        const border = borderOf(x, y, side);
        outline.add(wallKey(level, border));
        const w = this.wallOnBorder(level, border);
        if (w && isDone(w)) continue;
        if (!w && this.carried(level, border)) continue;
        if (w) gap.unfinished++;
        else gap.bare++;
        holes.push({ x, y, side });
      }
    }
    // Nearest to whoever asked, and the same one the island would name: the
    // tie is broken the same way on both sides, so the two sentences match
    // even on a square building with a hole at each corner.
    holes.sort((p, q) =>
      (p.x + 0.5 - fromX) ** 2 + (p.y + 0.5 - fromY) ** 2 - ((q.x + 0.5 - fromX) ** 2 + (q.y + 0.5 - fromY) ** 2)
      || p.x - q.x || p.y - q.y || 'nesw'.indexOf(p.side) - 'nesw'.indexOf(q.side));
    gap.at = holes[0];
    // And anything inside it that was planned and never finished, which stops
    // a storey being closed in just as surely as a hole in the outside wall.
    for (const w of this.walls.values()) {
      if (w.building !== b.id || w.level !== level || isDone(w)) continue;
      if (outline.has(wallKey(level, w))) continue;
      gap.unfinished++;
    }
    return gap;
  }

  /**
   * The heaviest thing that may be raised over a storey.
   *
   * Whatever is under it, at its lightest: a storey of cut stone over a storey
   * of brick over a log ground floor is held up by the logs, so the logs are
   * the answer. Nothing below means nothing to disagree with, which is what a
   * ground floor standing on the earth is.
   */
  bearing(b: Building, level: number): number {
    let least = Infinity;
    for (const w of this.walls.values()) {
      if (w.building !== b.id || w.level >= level) continue;
      const m = MATERIAL_BY_ID.get(w.material);
      if (m) least = Math.min(least, m.heft);
    }
    // A column carries what is over it as a wall does, and no more than its stuff will.
    for (const c of this.columns.values()) {
      if (c.building !== b.id || c.level >= level) continue;
      const m = MATERIAL_BY_ID.get(c.material);
      if (m) least = Math.min(least, m.heft);
    }
    return least;
  }

  /** Every build material standing in a building, whatever storey it is on: its walls and its columns. */
  materialsIn(b: Building): MaterialDef[] {
    const out = new Map<string, MaterialDef>();
    for (const w of this.walls.values()) {
      if (w.building !== b.id) continue;
      const m = MATERIAL_BY_ID.get(w.material);
      if (m) out.set(m.id, m);
    }
    for (const c of this.columns.values()) {
      if (c.building !== b.id) continue;
      const m = MATERIAL_BY_ID.get(c.material);
      if (m) out.set(m.id, m);
    }
    return [...out.values()];
  }

  /**
   * How tall this building may go: the shortest of what it is made of, and
   * never past what the world allows. A wing of planks caps the stone tower
   * it is joined to, which is the point — a building is one thing.
   *
   * `tall` is what its planner's Tall Walls adds, if they are a Mason who
   * took it: that many storeys more on every stone in it, and on the world's
   * limit, and nothing on timber.
   */
  storeyCap(b: Building, tall = 0): number {
    let cap = MAX_LEVELS + tall;
    for (const m of this.materialsIn(b)) cap = Math.min(cap, m.storeys + (m.kind === 'stone' ? tall : 0));
    return cap;
  }

  /** The material a storey is mostly walled in, for the sentences that name one. */
  storeyMaterial(b: Building, level: number): MaterialDef | undefined {
    const seen = new Map<string, number>();
    for (const w of this.walls.values()) {
      if (w.building !== b.id || w.level !== level) continue;
      seen.set(w.material, (seen.get(w.material) ?? 0) + 1);
    }
    // A column counts as a wall does: a hall on columns is raised on in their trade.
    for (const c of this.columns.values()) {
      if (c.building !== b.id || c.level !== level) continue;
      seen.set(c.material, (seen.get(c.material) ?? 0) + 1);
    }
    let best: string | undefined;
    // A tie goes to the first by name, as `storey_material` breaks it on the island.
    for (const [id, n] of seen) if (!best || n > (seen.get(best) ?? 0) || (n === seen.get(best) && id < best)) best = id;
    return best ? MATERIAL_BY_ID.get(best) : undefined;
  }

  /** True when every exterior border of the level carries a finished wall and no wall on the level is unfinished. */
  levelComplete(b: Building, level: number): boolean {
    for (const border of this.exteriorBorders(b)) {
      const w = this.wallOnBorder(level, border);
      if (!w || !isDone(w)) return false;
    }
    for (const w of this.walls.values()) if (w.building === b.id && w.level === level && !isDone(w)) return false;
    return true;
  }

  /**
   * Whether anything stands over a tile on a storey: a floor, or a roof.
   *
   * A floor above your head is a roof as far as the weather is concerned,
   * which is why this asks for a finished slot of any kind rather than for a
   * roof in particular.
   */
  coveredAt(level: number, x: number, y: number): boolean {
    const f = this.floor(level + 1, x, y);
    return !!f && isDone(f);
  }

  /**
   * The room a tile is in: everywhere you can walk to without crossing a wall.
   *
   * A door is a wall with a hole in it, and a room stops at one — that is what
   * makes it a room and not a floor plan. `enclosed` says whether the fill
   * ever came up against a border with nothing on it, which is the difference
   * between a room and a corner of a building site; `covered` says whether
   * every tile of it has something overhead.
   *
   * Only ever asked of one tile at a time by somebody standing on it, so it is
   * a plain flood fill with no index behind it.
   */
  room(level: number, x: number, y: number): Room | undefined {
    // Up a storey a room runs out onto its jetties, which are its floor as much as the footprint is.
    const b = this.buildingAt(x, y) ?? (level > 0 ? this.jettyAt(x, y) : undefined);
    if (!b) return undefined;
    if (level < 0) return this.cellarRoom(b, x, y);
    if (level > 0 && !this.floor(level, x, y)) return undefined;
    const seen = new Set<string>([tileKey(x, y)]);
    const queue: Array<[number, number]> = [[x, y]];
    const sides: Side[] = ['n', 'e', 's', 'w'];
    while (queue.length) {
      const [tx, ty] = queue.shift() as [number, number];
      for (const side of sides) {
        const [nx, ny] = side === 'n' ? [tx, ty - 1] : side === 's' ? [tx, ty + 1] : side === 'w' ? [tx - 1, ty] : [tx + 1, ty];
        if (seen.has(tileKey(nx, ny))) continue;
        const w = this.wallOnBorder(level, borderOf(tx, ty, side));
        if (w && isDone(w)) continue;
        if (this.tileIndex.get(tileKey(nx, ny)) !== b.id && !(level > 0 && this.jettyAt(nx, ny)?.id === b.id)) continue;
        if (level > 0 && !this.floor(level, nx, ny)) continue;
        seen.add(tileKey(nx, ny));
        queue.push([nx, ny]);
      }
    }
    let enclosed = true;
    let covered = true;
    for (const key of seen) {
      const [xs, ys] = key.split(',');
      const tx = Number(xs);
      const ty = Number(ys);
      if (!this.coveredAt(level, tx, ty)) covered = false;
      for (const side of sides) {
        const [nx, ny] = side === 'n' ? [tx, ty - 1] : side === 's' ? [tx, ty + 1] : side === 'w' ? [tx - 1, ty] : [tx + 1, ty];
        if (seen.has(tileKey(nx, ny))) continue;
        const w = this.wallOnBorder(level, borderOf(tx, ty, side));
        if (!w || !isDone(w)) enclosed = false;
      }
    }
    return { building: b.id, level, tiles: [...seen], enclosed, covered };
  }

  /**
   * A cellar's room: every finished cellar tile of the building that can be
   * walked to from this one, square to square. It needs no walls -- the
   * ground round it is its walls -- and the ground floor is over every tile of
   * it, so it is always shut in and always covered.
   */
  private cellarRoom(b: Building, x: number, y: number): Room | undefined {
    if (!this.cellarDone(x, y)) return undefined;
    const seen = new Set<string>([tileKey(x, y)]);
    const queue: Array<[number, number]> = [[x, y]];
    while (queue.length) {
      const [tx, ty] = queue.shift() as [number, number];
      for (const [nx, ny] of [[tx, ty - 1], [tx + 1, ty], [tx, ty + 1], [tx - 1, ty]] as Array<[number, number]>) {
        if (seen.has(tileKey(nx, ny)) || this.cellar(nx, ny)?.building !== b.id || !this.cellarDone(nx, ny)) continue;
        seen.add(tileKey(nx, ny));
        queue.push([nx, ny]);
      }
    }
    return { building: b.id, level: CELLAR_LEVEL, tiles: [...seen], enclosed: true, covered: true };
  }

  /**
   * Indoors: a room with walls all round it and something over it.
   *
   * The whole of what a roof is worth. Asked on the hot path by everything
   * that rots, so it stops at the first no. A cellar is always indoors.
   */
  indoors(level: number, x: number, y: number): boolean {
    if (level < 0) return this.cellarDone(x, y);
    if (!this.buildingAt(x, y)) return false;
    if (!this.coveredAt(level, x, y)) return false;
    const r = this.room(level, x, y);
    return !!r && r.enclosed && r.covered;
  }

  /**
   * Under a roof: indoors, or a room covered all over whose every open side
   * stands between two finished columns -- an open hall, a colonnade, a
   * market roof on posts. What lies there rots as it would indoors
   * (`INDOORS_DECAY`); a bed there is still a bed in the open air, because
   * a room is closed by its walls (`indoors`, `INDOORS_REST`).
   */
  sheltered(level: number, x: number, y: number): boolean {
    if (!this.buildingAt(x, y)) return false;
    if (!this.coveredAt(level, x, y)) return false;
    const r = this.room(level, x, y);
    if (!r || !r.covered) return false;
    if (r.enclosed) return true;
    if (!this.columns.size) return false;
    const tiles = new Set(r.tiles);
    for (const key of r.tiles) {
      const [xs, ys] = key.split(',');
      const tx = Number(xs);
      const ty = Number(ys);
      for (const [side, dx, dy] of STEPS) {
        if (tiles.has(tileKey(tx + dx, ty + dy))) continue;
        const border = borderOf(tx, ty, side);
        const w = this.wallOnBorder(level, border);
        if (w && isDone(w)) continue;
        if (!w && this.carried(level, border)) continue;
        return false;
      }
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Jetties and balconies, and columns.
  // -------------------------------------------------------------------------

  /**
   * The building whose jetty a tile is: a tile out past every footprint that
   * carries a floor, or the roof over one, of a storey of it.
   */
  jettyAt(x: number, y: number): Building | undefined {
    if (!this.jettyIndex.size) return undefined;
    const key = tileKey(x, y);
    const id = this.jettyIndex.get(key);
    if (id === undefined || this.tileIndex.has(key)) return undefined;
    return this.list.get(id);
  }

  /** Work that out again for one tile, after a floor on it has gone. */
  private reindexJetty(x: number, y: number): void {
    const key = tileKey(x, y);
    this.jettyIndex.delete(key);
    if (this.tileIndex.has(key)) return;
    for (let level = 1; level <= TOP_LEVELS; level++) {
      const f = this.floors.get(floorKey(level, x, y));
      if (f) {
        this.jettyIndex.set(key, f.building);
        return;
      }
    }
  }

  /**
   * The building `id`, when a tile could be a jetty of it: out past every
   * footprint and sharing an edge with this one's. What a job on a tile
   * that is not a building's own is done for, when it names the building
   * (`buildingId` in the target).
   */
  jettyHost(x: number, y: number, id: number | undefined): Building | undefined {
    if (id === undefined || this.tileIndex.has(tileKey(x, y))) return undefined;
    const b = this.list.get(id);
    if (!b) return undefined;
    for (const [, dx, dy] of STEPS) if (this.tileIndex.get(tileKey(x + dx, y + dy)) === id) return b;
    return undefined;
  }

  /**
   * What a jetty on a storey rests on: a finished full-height wall of the
   * storey below, of this building, on a border the tile shares with its
   * footprint -- its joists or its corbels go into that wall. The first of
   * them going round the tile from the north, or none.
   */
  jettyBearer(b: Building, level: number, x: number, y: number): { wall: Wall; side: Side } | undefined {
    if (level < 1) return undefined;
    for (const [side, dx, dy] of STEPS) {
      if (this.tileIndex.get(tileKey(x + dx, y + dy)) !== b.id) continue;
      const w = this.wallOnBorder(level - 1, borderOf(x, y, side));
      if (w && w.building === b.id && isDone(w) && !isLowWall(w.type)) return { wall: w, side };
    }
    return undefined;
  }

  /**
   * A storey's floor as far as what stands over it is concerned: the
   * footprint, and every jetty of that storey reached from it without
   * crossing a finished full-height wall. A jetty behind a door is a
   * balcony, outside the storey: nothing rests on its railing, and it is
   * walled or roofed as nothing.
   */
  storeyArea(b: Building, level: number, shut?: Border): Set<string> {
    const area = new Set(b.tiles);
    if (level <= 0 || !this.jettyIndex.size) return area;
    const queue = [...b.tiles];
    while (queue.length) {
      const key = queue.pop() as string;
      const [xs, ys] = key.split(',');
      const x = Number(xs);
      const y = Number(ys);
      for (const [side, dx, dy] of STEPS) {
        const nk = tileKey(x + dx, y + dy);
        if (area.has(nk) || this.tileIndex.has(nk)) continue;
        const f = this.floors.get(floorKey(level, x + dx, y + dy));
        if (!f || f.building !== b.id) continue;
        const border = borderOf(x, y, side);
        // `shut`: as it would be with a wall on that border, which is what a wall planned there is asked.
        if (shut && shut.dir === border.dir && shut.x === border.x && shut.y === border.y) continue;
        const w = this.wallOnBorder(level, border);
        if (w && isDone(w) && !isLowWall(w.type)) continue;
        area.add(nk);
        queue.push(nk);
      }
    }
    return area;
  }

  column(level: number, x: number, y: number): Column | undefined {
    return this.columns.get(columnKey(level, x, y));
  }

  setColumn(b: Building, level: number, x: number, y: number, material: string): Column {
    const c: Column = { building: b.id, level, x, y, material, ...columnBill(material) };
    if (!this.columns.has(columnKey(level, x, y))) this.cornerIndex.set(cornerNumber(x, y), (this.cornerIndex.get(cornerNumber(x, y)) ?? 0) + 1);
    this.columns.set(columnKey(level, x, y), c);
    return c;
  }

  removeColumn(level: number, x: number, y: number): void {
    if (!this.columns.delete(columnKey(level, x, y))) return;
    const n = (this.cornerIndex.get(cornerNumber(x, y)) ?? 1) - 1;
    if (n > 0) this.cornerIndex.set(cornerNumber(x, y), n);
    else this.cornerIndex.delete(cornerNumber(x, y));
  }

  /** Whether any column stands on a corner, on any storey. */
  hasColumnAt(x: number, y: number): boolean {
    return this.cornerIndex.size > 0 && this.cornerIndex.has(cornerNumber(x, y));
  }

  /**
   * Every tile a building's roof covers: its footprint's, and its jetties'
   * where the roof goes out over them. What a pitched roof is laid over.
   */
  roofTiles(b: Building): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const key of b.tiles) {
      const [xs, ys] = key.split(',');
      out.push([Number(xs), Number(ys)]);
    }
    for (const [key, id] of this.jettyIndex) {
      if (id !== b.id || this.tileIndex.has(key)) continue;
      const [xs, ys] = key.split(',');
      const f = this.floors.get(floorKey(b.levels, Number(xs), Number(ys)));
      if (f && f.building === b.id && floorKind(f) === 'roof') out.push([Number(xs), Number(ys)]);
    }
    return out;
  }

  /** Whether a finished column stands at both ends of a border on a storey, carrying it with no wall on it. */
  carried(level: number, b: Border): boolean {
    if (!this.columns.size || !this.hasColumnAt(b.x, b.y)) return false;
    const [ax, ay, bx, by] = borderPoints(b);
    const c0 = this.column(level, ax, ay);
    const c1 = this.column(level, bx, by);
    return !!c0 && !!c1 && isDone(c0) && isDone(c1);
  }

  /** The bounding box of a footprint, for the shapes that need to know which way is long. */
  footprintBox(b: Building): { x0: number; y0: number; x1: number; y1: number } {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const key of b.tiles) {
      const [xs, ys] = key.split(',');
      const x = Number(xs);
      const y = Number(ys);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
    return { x0, y0, x1, y1 };
  }

  /** Whether a finished, impassable ground-floor wall stops a step between two tiles. */
  blocks(x0: number, y0: number, x1: number, y1: number): boolean {
    return this.blocksAt(0, x0, y0, x1, y1);
  }

  /** Same, for the walls of a given storey. */
  blocksAt(level: number, x0: number, y0: number, x1: number, y1: number, beast = false): boolean {
    if (!this.walls.size) return false;
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx === 0 && dy === 0) return false;
    if (Math.abs(dx) + Math.abs(dy) === 1) {
      const border: Border =
        dx === 1 ? { x: x1, y: y0, dir: 'v' } : dx === -1 ? { x: x0, y: y0, dir: 'v' } : dy === 1 ? { x: x0, y: y1, dir: 'h' } : { x: x0, y: y0, dir: 'h' };
      const w = this.wallOnBorder(level, border);
      if (!w || !isDone(w)) return false;
      const def = WALL_TYPE_BY_ID.get(w.type);
      // A gate bound in iron swings for a person and for nothing else.
      return !(def?.passable ?? false) || (beast && !!def?.beastProof);
    }
    // Diagonal: allowed only when at least one of the two L-shaped routes is open.
    const viaX = !this.blocksAt(level, x0, y0, x1, y0, beast) && !this.blocksAt(level, x1, y0, x1, y1, beast);
    const viaY = !this.blocksAt(level, x0, y0, x0, y1, beast) && !this.blocksAt(level, x0, y1, x1, y1, beast);
    return !(viaX || viaY);
  }

  /**
   * Whether a wall stops a cart between two tiles.
   *
   * The same walk as `blocksAt` on the ground floor, asked of something with
   * wheels: a door a person turns sideways through is shut to a cart, and only
   * a double door, an archway or a gate is not. Everything impassable is as
   * impassable as it ever was.
   */
  blocksVehicle(x0: number, y0: number, x1: number, y1: number): boolean {
    if (!this.walls.size) return false;
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx === 0 && dy === 0) return false;
    if (Math.abs(dx) + Math.abs(dy) === 1) {
      const border: Border =
        dx === 1 ? { x: x1, y: y0, dir: 'v' } : dx === -1 ? { x: x0, y: y0, dir: 'v' } : dy === 1 ? { x: x0, y: y1, dir: 'h' } : { x: x0, y: y0, dir: 'h' };
      const w = this.wallOnBorder(0, border);
      if (!w || !isDone(w)) return false;
      const def = WALL_TYPE_BY_ID.get(w.type);
      return !(def?.passable ?? false) || !def?.wide;
    }
    const viaX = !this.blocksVehicle(x0, y0, x1, y0) && !this.blocksVehicle(x1, y0, x1, y1);
    const viaY = !this.blocksVehicle(x0, y0, x0, y1) && !this.blocksVehicle(x0, y1, x1, y1);
    return !(viaX || viaY);
  }

  toJSON(): BuildingsJSON {
    return {
      nextId: this.nextId, list: [...this.list.values()], walls: [...this.walls.values()], floors: [...this.floors.values()],
      cellars: [...this.cellars.values()], columns: [...this.columns.values()],
    };
  }

  /**
   * Lay in what is standing, in place of whatever was here.
   *
   * On an island this is the island's word and it arrives over and over, with
   * every answer about the ground — so it replaces rather than merges. A
   * building taken down elsewhere has to be able to disappear, and a merge
   * would leave it standing in this browser for ever.
   */
  sawIsland(data: BuildingsJSON): void {
    this.list.clear();
    this.tileIndex.clear();
    this.pierTiles.clear();
    this.pierStamp++;
    this.walls.clear();
    this.floors.clear();
    this.cellars.clear();
    this.columns.clear();
    this.jettyIndex.clear();
    this.nextId = data.nextId ?? 1;
    // A choice for a building that is gone goes with it: a new one given its number starts on its own top storey.
    const still = new Set((data.list ?? []).map((bl) => bl.id));
    for (const id of [...this.chosen.keys()]) if (!still.has(id)) this.chosen.delete(id);
    for (const bl of data.list ?? []) {
      this.list.set(bl.id, bl);
      for (const t of bl.tiles) this.tileIndex.set(t, bl.id);
      for (const t of bl.piers ?? []) this.pierTiles.add(t);
      // The storey chosen here stands while the building has as many storeys as it had then.
      const c = this.chosen.get(bl.id);
      if (c && c.levels === bl.levels) bl.workLevel = c.level;
      else this.chosen.delete(bl.id);
    }
    for (const w of data.walls ?? []) this.walls.set(wallKey(w.level, w), w);
    for (const f of data.floors ?? []) {
      this.floors.set(floorKey(f.level, f.x, f.y), f);
      if (f.level > 0 && !this.tileIndex.has(tileKey(f.x, f.y))) this.jettyIndex.set(tileKey(f.x, f.y), f.building);
    }
    this.cornerIndex.clear();
    for (const c of data.columns ?? []) {
      this.columns.set(columnKey(c.level, c.x, c.y), c);
      this.cornerIndex.set(cornerNumber(c.x, c.y), (this.cornerIndex.get(cornerNumber(c.x, c.y)) ?? 0) + 1);
    }
    for (const c of data.cellars ?? []) if (c.dug > 0) this.cellars.set(tileKey(c.x, c.y), c);
  }

  static fromJSON(data: BuildingsJSON | undefined): Buildings {
    const b = new Buildings();
    if (data) b.sawIsland(data);
    return b;
  }
}

/** Human readable remaining materials, e.g. "2 logs, 1 plank". */
export function describeNeeds(bill: Bill, nameOf: (id: string, n: number) => string): string {
  const parts: string[] = [];
  for (const [id, n] of Object.entries(bill.needed)) if (n > 0) parts.push(`${n} ${nameOf(id, n)}`);
  return parts.join(', ');
}
