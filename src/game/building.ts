/**
 * Buildings, Wurm style: a footprint of flat packed-dirt tiles on a deed,
 * walls that sit on tile borders, and stacked floors. Walls and floors are
 * planned first, then built by feeding them materials one unit at a time.
 */
import { fill } from './words';

export type WallType = 'solid' | 'window' | 'bay' | 'door' | 'double_door' | 'arch' | 'fence' | 'fence_gate' | 'half_wall' | 'iron_gate';

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
  { id: 'window', name: 'Window', factor: 0.75, passable: false, fittings: [['glass', 2]] },
  /*
   * No `thick`. It used to carry 1.7 of it, which moved the whole section
   * that much nearer the camera and left a slice of ground showing at the
   * joint with its neighbours -- a wall a bay is set into is the thickness
   * the wall is. What a bay projects by, it projects by: the box stands out
   * in front of the face, which is where a bay actually is.
   */
  { id: 'bay', name: 'Bay window', factor: 1.25, passable: false, fittings: [['glass', 4]] },
  { id: 'door', name: 'Door', factor: 0.75, passable: true, fittings: [['hinge', 2]] },
  { id: 'double_door', name: 'Double door', factor: 1, passable: true, wide: true, fittings: [['hinge', 4]] },
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
  { id: 'iron_gate', name: 'Iron-bound gate', factor: 0.5, passable: true, wide: true, height: 0.6, low: true, railed: true, standalone: true, beastProof: true, fittings: [['hinge', 2], ['bracket', 4]] },
  { id: 'half_wall', name: 'Half wall', factor: 0.5, passable: false, height: 0.5, low: true, standalone: true, thick: 1.25 },
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
export const storeySkill = (levels: number): number => levels * STOREY_SKILL;

export const MATERIALS: MaterialDef[] = [
  { id: 'log', name: 'Log', kind: 'wood', tool: 'mallet', skill: 'carpentry', color: [139, 106, 62], trim: [92, 66, 38], floor: [150, 118, 74], courses: 3, bill: [['log', 4]], storeys: 3, heft: 1 },
  { id: 'plank', name: 'Plank', kind: 'wood', tool: 'mallet', skill: 'carpentry', color: [178, 138, 84], trim: [112, 82, 46], floor: [186, 148, 96], courses: 4, bill: [['plank', 6]], storeys: 4, heft: 1 },
  { id: 'timbercraft', name: 'Timbercraft', kind: 'wood', tool: 'mallet', skill: 'carpentry', color: [206, 184, 142], trim: [88, 62, 38], floor: [176, 140, 92], courses: 4, bill: [['plank', 2], ['thatch', 2], ['timber', 2]], storeys: 4, heft: 1 },
  { id: 'cobblestone', name: 'Cobblestone', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [140, 136, 128], trim: [92, 88, 82], floor: [126, 122, 116], courses: 4, bill: [['rock_shards', 20], ['mortar', 10]], storeys: 6, heft: 2 },
  { id: 'slate', name: 'Slate', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [96, 104, 118], trim: [60, 66, 78], floor: [88, 96, 110], courses: 5, bill: [['slate_brick', 4], ['mortar', 4]], storeys: 8, heft: 3 },
  { id: 'marble', name: 'Marble', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [228, 226, 220], trim: [170, 168, 160], floor: [216, 214, 208], courses: 2, bill: [['marble_brick', 4], ['mortar', 4]], storeys: 10, heft: 3 },
  { id: 'sandstone', name: 'Sandstone', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [214, 184, 132], trim: [150, 122, 78], floor: [200, 172, 124], courses: 3, bill: [['sandstone_brick', 4], ['mortar', 4]], storeys: 7, heft: 3 },
  { id: 'stone_brick', name: 'Stone brick', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [160, 154, 144], trim: [104, 98, 90], floor: [148, 142, 132], courses: 3, bill: [['stone_brick', 4], ['mortar', 4]], storeys: 10, heft: 3 },
  { id: 'clay_adobe', name: 'Clay adobe', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [198, 154, 106], trim: [138, 100, 62], floor: [184, 142, 98], courses: 3, bill: [['adobe', 5]], storeys: 5, heft: 2 },
  { id: 'clay_bricks', name: 'Clay bricks', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [176, 85, 60], trim: [110, 50, 36], floor: [164, 82, 60], courses: 5, bill: [['clay_brick', 4], ['mortar', 4]], storeys: 7, heft: 2 },
  { id: 'ornate_silver', name: 'Ornate silver', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [200, 204, 212], trim: [120, 126, 140], floor: [190, 194, 202], courses: 3, bill: [['stone_brick', 3], ['mortar', 3], ['silver_lump', 2]], storeys: 10, heft: 3 },
  { id: 'ornate_gold', name: 'Ornate gold', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [217, 180, 81], trim: [150, 112, 34], floor: [206, 172, 84], courses: 3, bill: [['stone_brick', 3], ['mortar', 3], ['gold_lump', 2]], storeys: 10, heft: 3 },
];
export const MATERIAL_BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));

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
 * What a roof over your head is worth to everything left under it.
 *
 * A tenth, on top of whatever the ground is already worth — so a tenth in the
 * wild and a hundredth on a deed. A roof cost half a wall and did nothing at
 * all before this.
 */
export const INDOORS_DECAY = 0.1;
/** How much more of a night a bed indoors banks than the same bed in a field. */
export const INDOORS_REST = 1.35;

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
}

/** The storey being worked on, clamped to what exists. */
export const workLevel = (b: Building): number => Math.min(b.workLevel ?? b.levels - 1, b.levels - 1);

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
  if (gap.bare) parts.push(`${gap.bare} side${gap.bare === 1 ? '' : 's'} with no wall`);
  if (gap.unfinished) parts.push(`${gap.unfinished} still going up`);
  const where = gap.at ? `, nearest the ${SIDE_NAMES[gap.at.side]} side of ${gap.at.x},${gap.at.y}` : '';
  return `Storey ${storey} is not closed in: ${parts.join(' and ')}${where}.`;
}

export function progressOf(b: Bill): number {
  const total = Object.values(b.total).reduce((s, n) => s + n, 0);
  const left = Object.values(b.needed).reduce((s, n) => s + n, 0);
  return total ? 1 - left / total : 1;
}

function scaledBill(material: string, factor: number): Bill {
  const def = MATERIAL_BY_ID.get(material);
  const needed: Record<string, number> = {};
  if (def) for (const [id, n] of def.bill) needed[id] = Math.max(1, Math.ceil(n * factor));
  return { needed, total: { ...needed } };
}

export const wallBill = (material: string, type: WallType): Bill => {
  const def = WALL_TYPE_BY_ID.get(type);
  const bill = scaledBill(material, def?.factor ?? 1);
  // The fittings go on top of the material's bill, whatever the wall is of.
  for (const [item, n] of def?.fittings ?? []) {
    bill.needed[item] = (bill.needed[item] ?? 0) + n;
    bill.total[item] = (bill.total[item] ?? 0) + n;
  }
  return bill;
};

/**
 * Materials for a floor slot: a floor takes half a wall, stairs three
 * quarters, a ladder is two planks, and a roof is whatever its shape costs —
 * a gable least, because a gable end is wall rather than roof, and a flat deck
 * most, because a thing you walk on is built like a floor.
 */
export function floorBill(material: string, kind: FloorKind = 'floor', roof: RoofShape = 'hip'): Bill {
  if (kind === 'ladder') return { needed: { plank: 2 }, total: { plank: 2 } };
  if (kind === 'roof') return scaledBill(material, ROOF_SHAPE_BY_ID.get(roof)?.factor ?? 0.5);
  return scaledBill(material, kind === 'stairs' ? 0.75 : 0.5);
}

export const tileKey = (x: number, y: number): string => `${x},${y}`;
const wallKey = (level: number, b: Border): string => `${level}:${b.dir}:${b.x},${b.y}`;
const floorKey = (level: number, x: number, y: number): string => `${level}:${x},${y}`;

export interface BuildingsJSON {
  nextId: number;
  list: Building[];
  walls: Wall[];
  floors: FloorTile[];
}

export class Buildings {
  readonly list = new Map<number, Building>();
  readonly tileIndex = new Map<string, number>();
  readonly walls = new Map<string, Wall>();
  readonly floors = new Map<string, FloorTile>();
  nextId = 1;

  buildingAt(x: number, y: number): Building | undefined {
    const id = this.tileIndex.get(tileKey(x, y));
    return id === undefined ? undefined : this.list.get(id);
  }

  create(name: string, x: number, y: number): Building {
    const b: Building = { id: this.nextId++, name, tiles: [tileKey(x, y)], levels: 1 };
    this.list.set(b.id, b);
    this.tileIndex.set(tileKey(x, y), b.id);
    return b;
  }

  addTile(b: Building, x: number, y: number): void {
    const key = tileKey(x, y);
    if (this.tileIndex.has(key)) return;
    b.tiles.push(key);
    this.tileIndex.set(key, b.id);
  }

  /** Drop a tile from a footprint; deletes the building when it was the last one. */
  removeTile(b: Building, x: number, y: number): void {
    const key = tileKey(x, y);
    b.tiles = b.tiles.filter((t) => t !== key);
    this.tileIndex.delete(key);
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

  setWall(b: Building, level: number, x: number, y: number, side: Side, type: WallType, material: string): Wall {
    return this.planWall(b.id, level, x, y, side, type, material);
  }

  /**
   * A fence or a half wall on a bare border. It goes in the same place a wall
   * does — the border is the thing walls live on — and belongs to no building,
   * which is what building 0 means.
   */
  setFence(x: number, y: number, side: Side, type: WallType, material: string): Wall {
    return this.planWall(0, 0, x, y, side, type, material);
  }

  private planWall(building: number, level: number, x: number, y: number, side: Side, type: WallType, material: string): Wall {
    const border = borderOf(x, y, side);
    const wall: Wall = { building, level, x: border.x, y: border.y, dir: border.dir, type, material, ...wallBill(material, type) };
    this.walls.set(wallKey(level, border), wall);
    return wall;
  }

  /**
   * Whether a storey of a building carries anything waist-high — its own, or a
   * fence that was already standing on one of its borders when the footprint
   * was laid out around it. Either way there is nothing up there to build on.
   */
  hasLowWall(b: Building, level: number): boolean {
    for (const w of this.walls.values()) if (w.building === b.id && w.level === level && isLowWall(w.type)) return true;
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
    for (const key of b.tiles) {
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
        if (this.tileIndex.get(tileKey(nx, ny)) === b.id) continue;
        const w = this.wallOnBorder(level, borderOf(x, y, side));
        if (w && isDone(w)) continue;
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
      if (this.exteriorBorders(b).some((e) => e.dir === w.dir && e.x === w.x && e.y === w.y)) continue;
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
    return least;
  }

  /** Every build material standing in a building, whatever storey it is on. */
  materialsIn(b: Building): MaterialDef[] {
    const out = new Map<string, MaterialDef>();
    for (const w of this.walls.values()) {
      if (w.building !== b.id) continue;
      const m = MATERIAL_BY_ID.get(w.material);
      if (m) out.set(m.id, m);
    }
    return [...out.values()];
  }

  /**
   * How tall this building may go: the shortest of what it is made of, and
   * never past what the world allows. A wing of planks caps the stone tower
   * it is joined to, which is the point — a building is one thing.
   */
  storeyCap(b: Building): number {
    let cap = MAX_LEVELS;
    for (const m of this.materialsIn(b)) cap = Math.min(cap, m.storeys);
    return cap;
  }

  /** The material a storey is mostly walled in, for the sentences that name one. */
  storeyMaterial(b: Building, level: number): MaterialDef | undefined {
    const seen = new Map<string, number>();
    for (const w of this.walls.values()) {
      if (w.building !== b.id || w.level !== level) continue;
      seen.set(w.material, (seen.get(w.material) ?? 0) + 1);
    }
    let best: string | undefined;
    for (const [id, n] of seen) if (!best || n > (seen.get(best) ?? 0)) best = id;
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
    const b = this.buildingAt(x, y);
    if (!b) return undefined;
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
        if (this.tileIndex.get(tileKey(nx, ny)) !== b.id) continue;
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
   * Indoors: a room with walls all round it and something over it.
   *
   * The whole of what a roof is worth. Asked on the hot path by everything
   * that rots, so it stops at the first no.
   */
  indoors(level: number, x: number, y: number): boolean {
    if (!this.buildingAt(x, y)) return false;
    if (!this.coveredAt(level, x, y)) return false;
    const r = this.room(level, x, y);
    return !!r && r.enclosed && r.covered;
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
    return { nextId: this.nextId, list: [...this.list.values()], walls: [...this.walls.values()], floors: [...this.floors.values()] };
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
    this.walls.clear();
    this.floors.clear();
    this.nextId = data.nextId ?? 1;
    for (const bl of data.list ?? []) {
      this.list.set(bl.id, bl);
      for (const t of bl.tiles) this.tileIndex.set(t, bl.id);
    }
    for (const w of data.walls ?? []) this.walls.set(wallKey(w.level, w), w);
    for (const f of data.floors ?? []) this.floors.set(floorKey(f.level, f.x, f.y), f);
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
