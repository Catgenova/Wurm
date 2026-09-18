/**
 * Buildings, Wurm style: a footprint of flat packed-dirt tiles on a deed,
 * walls that sit on tile borders, and stacked floors. Walls and floors are
 * planned first, then built by feeding them materials one unit at a time.
 */

export type WallType = 'solid' | 'window' | 'bay' | 'door' | 'double_door' | 'fence' | 'fence_gate' | 'half_wall' | 'iron_gate';

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
}

export const WALL_TYPES: WallTypeDef[] = [
  { id: 'solid', name: 'Solid', factor: 1, passable: false },
  { id: 'window', name: 'Window', factor: 0.75, passable: false },
  { id: 'bay', name: 'Bay window', factor: 1.25, passable: false },
  { id: 'door', name: 'Door', factor: 0.75, passable: true, fittings: [['hinge', 2]] },
  { id: 'double_door', name: 'Double door', factor: 1, passable: true, fittings: [['hinge', 4]] },
  // Waist-high, and cheap because there is so much less of them. A gate is
  // the one thing in the list you can walk through.
  { id: 'fence', name: 'Fence', factor: 0.3, passable: false, height: 0.42, low: true, railed: true, standalone: true },
  { id: 'fence_gate', name: 'Fence gate', factor: 0.4, passable: true, height: 0.42, low: true, railed: true, standalone: true, fittings: [['hinge', 2]] },
  // Bound in iron: it swings for a person and holds against everything else.
  { id: 'iron_gate', name: 'Iron-bound gate', factor: 0.5, passable: true, height: 0.6, low: true, railed: true, standalone: true, beastProof: true, fittings: [['hinge', 2], ['bracket', 4]] },
  { id: 'half_wall', name: 'Half wall', factor: 0.5, passable: false, height: 0.5, low: true, standalone: true },
];
export const WALL_TYPE_BY_ID = new Map(WALL_TYPES.map((w) => [w.id, w]));
/** Whether a wall type is waist-high work that nothing can be built over. */
export const isLowWall = (type: WallType): boolean => !!WALL_TYPE_BY_ID.get(type)?.low;
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
  /** Items consumed by one solid wall. */
  bill: Array<[string, number]>;
}

export const MATERIALS: MaterialDef[] = [
  { id: 'log', name: 'Log', kind: 'wood', tool: 'mallet', skill: 'carpentry', color: [139, 106, 62], trim: [92, 66, 38], floor: [150, 118, 74], bill: [['log', 4]] },
  { id: 'plank', name: 'Plank', kind: 'wood', tool: 'mallet', skill: 'carpentry', color: [178, 138, 84], trim: [112, 82, 46], floor: [186, 148, 96], bill: [['plank', 6]] },
  { id: 'timbercraft', name: 'Timbercraft', kind: 'wood', tool: 'mallet', skill: 'carpentry', color: [206, 184, 142], trim: [88, 62, 38], floor: [176, 140, 92], bill: [['plank', 2], ['thatch', 2], ['timber', 2]] },
  { id: 'cobblestone', name: 'Cobblestone', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [140, 136, 128], trim: [92, 88, 82], floor: [126, 122, 116], bill: [['rock_shards', 5]] },
  { id: 'slate', name: 'Slate', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [96, 104, 118], trim: [60, 66, 78], floor: [88, 96, 110], bill: [['slate_brick', 4], ['mortar', 4]] },
  { id: 'marble', name: 'Marble', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [228, 226, 220], trim: [170, 168, 160], floor: [216, 214, 208], bill: [['marble_brick', 4], ['mortar', 4]] },
  { id: 'sandstone', name: 'Sandstone', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [214, 184, 132], trim: [150, 122, 78], floor: [200, 172, 124], bill: [['sandstone_brick', 4], ['mortar', 4]] },
  { id: 'stone_brick', name: 'Stone brick', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [160, 154, 144], trim: [104, 98, 90], floor: [148, 142, 132], bill: [['stone_brick', 4], ['mortar', 4]] },
  { id: 'clay_adobe', name: 'Clay adobe', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [198, 154, 106], trim: [138, 100, 62], floor: [184, 142, 98], bill: [['adobe', 5]] },
  { id: 'clay_bricks', name: 'Clay bricks', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [176, 85, 60], trim: [110, 50, 36], floor: [164, 82, 60], bill: [['clay_brick', 4], ['mortar', 4]] },
  { id: 'ornate_silver', name: 'Ornate silver', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [200, 204, 212], trim: [120, 126, 140], floor: [190, 194, 202], bill: [['stone_brick', 3], ['mortar', 3], ['silver_lump', 2]] },
  { id: 'ornate_gold', name: 'Ornate gold', kind: 'stone', tool: 'trowel', skill: 'masonry', color: [217, 180, 81], trim: [150, 112, 34], floor: [206, 172, 84], bill: [['stone_brick', 3], ['mortar', 3], ['gold_lump', 2]] },
];
export const MATERIAL_BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));

/** Height of one storey in terrain units (3 m). */
export const WALL_HEIGHT = 30;
export const MAX_LEVELS = 10;

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
}

export const floorKind = (f: FloorTile): FloorKind => f.kind ?? 'floor';
/** Whether a finished floor tile can be stood on. */
export const walkableKind = (k: FloorKind): boolean => k !== 'roof';
export const connectsDown = (k: FloorKind): boolean => k === 'stairs' || k === 'ladder';
/** Rise of a roof ridge above its eaves, in terrain units. */
export const ROOF_RISE = 22;

export interface Building {
  id: number;
  name: string;
  tiles: string[];
  /** Number of storeys planned; the ground floor counts as one. */
  levels: number;
  /** Storey that wall and floor work applies to; defaults to the top one. */
  workLevel?: number;
}

/** The storey being worked on, clamped to what exists. */
export const workLevel = (b: Building): number => Math.min(b.workLevel ?? b.levels - 1, b.levels - 1);

export const isDone = (b: Bill): boolean => Object.values(b.needed).every((n) => n <= 0);

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

/** Materials for a floor slot: floors and roofs take half a wall, stairs three quarters, ladders are two planks. */
export function floorBill(material: string, kind: FloorKind = 'floor'): Bill {
  if (kind === 'ladder') return { needed: { plank: 2 }, total: { plank: 2 } };
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
    const f: FloorTile = { building: b.id, level, x, y, material, kind, facing, ...floorBill(material, kind) };
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

  /** True when every exterior border of the level carries a finished wall and no wall on the level is unfinished. */
  levelComplete(b: Building, level: number): boolean {
    for (const border of this.exteriorBorders(b)) {
      const w = this.wallOnBorder(level, border);
      if (!w || !isDone(w)) return false;
    }
    for (const w of this.walls.values()) if (w.building === b.id && w.level === level && !isDone(w)) return false;
    return true;
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
