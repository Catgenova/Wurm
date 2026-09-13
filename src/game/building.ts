/**
 * Buildings, Wurm style: a footprint of flat packed-dirt tiles on a deed,
 * walls that sit on tile borders, and stacked floors. Walls and floors are
 * planned first, then built by feeding them materials one unit at a time.
 */

export type WallType = 'solid' | 'window' | 'bay' | 'door' | 'double_door';

export interface WallTypeDef {
  id: WallType;
  name: string;
  /** Material multiplier relative to a solid wall. */
  factor: number;
  passable: boolean;
}

export const WALL_TYPES: WallTypeDef[] = [
  { id: 'solid', name: 'Solid', factor: 1, passable: false },
  { id: 'window', name: 'Window', factor: 0.75, passable: false },
  { id: 'bay', name: 'Bay window', factor: 1.25, passable: false },
  { id: 'door', name: 'Door', factor: 0.75, passable: true },
  { id: 'double_door', name: 'Double door', factor: 1, passable: true },
];
export const WALL_TYPE_BY_ID = new Map(WALL_TYPES.map((w) => [w.id, w]));

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
export const MAX_LEVELS = 5;

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

export interface FloorTile extends Bill {
  building: number;
  level: number;
  x: number;
  y: number;
  material: string;
}

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

export const wallBill = (material: string, type: WallType): Bill => scaledBill(material, WALL_TYPE_BY_ID.get(type)?.factor ?? 1);
export const floorBill = (material: string): Bill => scaledBill(material, 0.5);

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
    const border = borderOf(x, y, side);
    const wall: Wall = { building: b.id, level, x: border.x, y: border.y, dir: border.dir, type, material, ...wallBill(material, type) };
    this.walls.set(wallKey(level, border), wall);
    return wall;
  }

  removeWall(level: number, x: number, y: number, side: Side): void {
    this.walls.delete(wallKey(level, borderOf(x, y, side)));
  }

  floor(level: number, x: number, y: number): FloorTile | undefined {
    return this.floors.get(floorKey(level, x, y));
  }

  setFloor(b: Building, level: number, x: number, y: number, material: string): FloorTile {
    const f: FloorTile = { building: b.id, level, x, y, material, ...floorBill(material) };
    this.floors.set(floorKey(level, x, y), f);
    return f;
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
    if (!this.walls.size) return false;
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx === 0 && dy === 0) return false;
    if (Math.abs(dx) + Math.abs(dy) === 1) {
      const border: Border =
        dx === 1 ? { x: x1, y: y0, dir: 'v' } : dx === -1 ? { x: x0, y: y0, dir: 'v' } : dy === 1 ? { x: x0, y: y1, dir: 'h' } : { x: x0, y: y0, dir: 'h' };
      const w = this.wallOnBorder(0, border);
      return !!w && isDone(w) && !(WALL_TYPE_BY_ID.get(w.type)?.passable ?? false);
    }
    // Diagonal: allowed only when at least one of the two L-shaped routes is open.
    const viaX = !this.blocks(x0, y0, x1, y0) && !this.blocks(x1, y0, x1, y1);
    const viaY = !this.blocks(x0, y0, x0, y1) && !this.blocks(x0, y1, x1, y1);
    return !(viaX || viaY);
  }

  toJSON(): BuildingsJSON {
    return { nextId: this.nextId, list: [...this.list.values()], walls: [...this.walls.values()], floors: [...this.floors.values()] };
  }

  static fromJSON(data: BuildingsJSON | undefined): Buildings {
    const b = new Buildings();
    if (!data) return b;
    b.nextId = data.nextId ?? 1;
    for (const bl of data.list ?? []) {
      b.list.set(bl.id, bl);
      for (const t of bl.tiles) b.tileIndex.set(t, bl.id);
    }
    for (const w of data.walls ?? []) b.walls.set(wallKey(w.level, w), w);
    for (const f of data.floors ?? []) b.floors.set(floorKey(f.level, f.x, f.y), f);
    return b;
  }
}

/** Human readable remaining materials, e.g. "2 logs, 1 plank". */
export function describeNeeds(bill: Bill, nameOf: (id: string, n: number) => string): string {
  const parts: string[] = [];
  for (const [id, n] of Object.entries(bill.needed)) if (n > 0) parts.push(`${n} ${nameOf(id, n)}`);
  return parts.join(', ');
}
