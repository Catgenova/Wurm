import { TileType, TILE_DEFS, TREE_DEFS, BUSH_DEFS, ROCK_VARIANTS, treeSpecies, bushSpecies, rockVariant } from './tiles';

export type WorldListener = (x: number, y: number) => void;

/**
 * The terrain: a grid of tiles plus a (w+1) x (h+1) grid of corner heights,
 * exactly like Wurm's surface. Water sits at height 0.
 */
export class World {
  readonly w: number;
  readonly h: number;
  /** Corner grid width (w + 1). */
  readonly cw: number;
  readonly heights: Int16Array;
  readonly tiles: Uint8Array;
  readonly data: Uint8Array;
  minHeight = 0;
  maxHeight = 0;
  private listeners: WorldListener[] = [];

  constructor(w: number, h: number, heights?: Int16Array, tiles?: Uint8Array, data?: Uint8Array) {
    this.w = w;
    this.h = h;
    this.cw = w + 1;
    this.heights = heights ?? new Int16Array((w + 1) * (h + 1));
    this.tiles = tiles ?? new Uint8Array(w * h);
    this.data = data ?? new Uint8Array(w * h);
    this.recomputeRange();
  }

  onChange(fn: WorldListener): void {
    this.listeners.push(fn);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  cornerInBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx <= this.w && cy <= this.h;
  }

  getHeight(cx: number, cy: number): number {
    const x = cx < 0 ? 0 : cx > this.w ? this.w : cx;
    const y = cy < 0 ? 0 : cy > this.h ? this.h : cy;
    return this.heights[y * this.cw + x];
  }

  setHeight(cx: number, cy: number, v: number): void {
    if (!this.cornerInBounds(cx, cy)) return;
    this.heights[cy * this.cw + cx] = v;
    if (v > this.maxHeight) this.maxHeight = v;
    if (v < this.minHeight) this.minHeight = v;
    for (let y = cy - 1; y <= cy; y++) {
      for (let x = cx - 1; x <= cx; x++) {
        if (this.inBounds(x, y)) this.notify(x, y);
      }
    }
  }

  getTile(x: number, y: number): TileType {
    if (!this.inBounds(x, y)) return TileType.Sand;
    return this.tiles[y * this.w + x] as TileType;
  }

  getData(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.data[y * this.w + x];
  }

  setTile(x: number, y: number, t: TileType, data = 0): void {
    if (!this.inBounds(x, y)) return;
    this.tiles[y * this.w + x] = t;
    this.data[y * this.w + x] = data;
    this.notify(x, y);
  }

  /** Corner heights of a tile in the order north (x,y), east (x+1,y), south (x+1,y+1), west (x,y+1). */
  corners(x: number, y: number, out: number[]): number[] {
    out[0] = this.getHeight(x, y);
    out[1] = this.getHeight(x + 1, y);
    out[2] = this.getHeight(x + 1, y + 1);
    out[3] = this.getHeight(x, y + 1);
    return out;
  }

  centerHeight(x: number, y: number): number {
    return (this.getHeight(x, y) + this.getHeight(x + 1, y) + this.getHeight(x + 1, y + 1) + this.getHeight(x, y + 1)) / 4;
  }

  /** Bilinearly interpolated surface height at a world position. */
  heightAt(wx: number, wy: number): number {
    const x0 = Math.floor(wx);
    const y0 = Math.floor(wy);
    const fx = wx - x0;
    const fy = wy - y0;
    const h00 = this.getHeight(x0, y0);
    const h10 = this.getHeight(x0 + 1, y0);
    const h01 = this.getHeight(x0, y0 + 1);
    const h11 = this.getHeight(x0 + 1, y0 + 1);
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
  }

  /** Maximum height difference between the corners of a tile. */
  slope(x: number, y: number): number {
    const n = this.getHeight(x, y);
    const e = this.getHeight(x + 1, y);
    const s = this.getHeight(x + 1, y + 1);
    const w = this.getHeight(x, y + 1);
    return Math.max(n, e, s, w) - Math.min(n, e, s, w);
  }

  /** Steepest slope of the four tiles that share a corner. */
  slopeAroundCorner(cx: number, cy: number): number {
    let m = 0;
    for (let y = cy - 1; y <= cy; y++) {
      for (let x = cx - 1; x <= cx; x++) {
        if (this.inBounds(x, y)) m = Math.max(m, this.slope(x, y));
      }
    }
    return m;
  }

  hasWater(x: number, y: number): boolean {
    return this.getHeight(x, y) < 0 || this.getHeight(x + 1, y) < 0 || this.getHeight(x + 1, y + 1) < 0 || this.getHeight(x, y + 1) < 0;
  }

  isSubmerged(x: number, y: number): boolean {
    return this.getHeight(x, y) < 0 && this.getHeight(x + 1, y) < 0 && this.getHeight(x + 1, y + 1) < 0 && this.getHeight(x, y + 1) < 0;
  }

  /** Human readable tile name, e.g. "Oak tree" or "Grass". */
  tileName(x: number, y: number): string {
    const t = this.getTile(x, y);
    if (t === TileType.Tree) return `${TREE_DEFS[treeSpecies(this.getData(x, y))].name} tree`;
    if (t === TileType.Bush) return BUSH_DEFS[bushSpecies(this.getData(x, y))].name;
    if (t === TileType.Rock) return ROCK_VARIANTS[rockVariant(this.getData(x, y))].name;
    return TILE_DEFS[t].name;
  }

  /** Whether an entity can stand on the tile at all. */
  isPassable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    return !TILE_DEFS[this.getTile(x, y)].blocks;
  }

  recomputeRange(): void {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < this.heights.length; i++) {
      const v = this.heights[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    this.minHeight = Number.isFinite(lo) ? lo : 0;
    this.maxHeight = Number.isFinite(hi) ? hi : 0;
  }

  private notify(x: number, y: number): void {
    for (const fn of this.listeners) fn(x, y);
  }
}
