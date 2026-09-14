import { TileType, TILE_DEFS, TREE_DEFS, BUSH_DEFS, ROCK_VARIANTS, SLAB_VARIANTS, treeSpecies, bushSpecies, rockVariant, slabVariant } from './tiles';

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
  /** Soil depth over bedrock at each corner. Dig it away and you are on rock. */
  readonly dirt: Uint8Array;
  readonly tiles: Uint8Array;
  readonly data: Uint8Array;
  /** The rock under every tile, settled when the world was made. */
  readonly rock: Uint8Array;
  /** 1 where the land has been laid eyes on at least once. */
  readonly seen: Uint8Array;
  /** The tile as it was when last seen, which is what a remembered map shows. */
  readonly mem: Uint8Array;
  readonly memData: Uint8Array;
  /** The seed this world was made from, so rock kinds stay consistent. */
  seed = 0;
  minHeight = 0;
  maxHeight = 0;
  private listeners: WorldListener[] = [];

  constructor(
    w: number,
    h: number,
    heights?: Int16Array,
    tiles?: Uint8Array,
    data?: Uint8Array,
    dirt?: Uint8Array,
    rock?: Uint8Array,
    seen?: Uint8Array,
    mem?: Uint8Array,
    memData?: Uint8Array,
  ) {
    this.w = w;
    this.h = h;
    this.cw = w + 1;
    this.heights = heights ?? new Int16Array((w + 1) * (h + 1));
    this.tiles = tiles ?? new Uint8Array(w * h);
    this.data = data ?? new Uint8Array(w * h);
    this.dirt = dirt ?? new Uint8Array((w + 1) * (h + 1));
    this.rock = rock ?? new Uint8Array(w * h);
    this.seen = seen ?? new Uint8Array(w * h);
    this.mem = mem ?? new Uint8Array(w * h);
    this.memData = memData ?? new Uint8Array(w * h);
    this.recomputeRange();
  }

  /** The kind of rock under a tile, bare or buried. */
  rockKind(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.rock[y * this.w + x];
  }

  setRockKind(x: number, y: number, kind: number): void {
    if (this.inBounds(x, y)) this.rock[y * this.w + x] = kind;
  }

  /** Soil left over the bedrock at a corner; 0 means the rock is bare. */
  getDirt(cx: number, cy: number): number {
    const x = cx < 0 ? 0 : cx > this.w ? this.w : cx;
    const y = cy < 0 ? 0 : cy > this.h ? this.h : cy;
    return this.dirt[y * this.cw + x];
  }

  setDirt(cx: number, cy: number, v: number): void {
    if (!this.cornerInBounds(cx, cy)) return;
    this.dirt[cy * this.cw + cx] = Math.max(0, Math.min(255, v));
  }

  /** Height of the bedrock under a corner. */
  rockHeight(cx: number, cy: number): number {
    return this.getHeight(cx, cy) - this.getDirt(cx, cy);
  }

  /** Whether every corner of a tile is bare rock. */
  allBare(x: number, y: number): boolean {
    return this.getDirt(x, y) === 0 && this.getDirt(x + 1, y) === 0 && this.getDirt(x + 1, y + 1) === 0 && this.getDirt(x, y + 1) === 0;
  }

  /**
   * Bring a tile's type in line with the soil on its corners: strip the last
   * dirt off all four and the rock beneath is exposed; put soil back on any
   * corner and it is ground again.
   */
  reconcile(x: number, y: number): void {
    if (!this.inBounds(x, y)) return;
    const t = this.getTile(x, y);
    const bare = this.allBare(x, y);
    if (bare && t !== TileType.Rock && t !== TileType.Snow) {
      this.setTile(x, y, TileType.Rock, this.rockKind(x, y));
    } else if (!bare && t === TileType.Rock) {
      this.setTile(x, y, TileType.Dirt);
    }
  }

  /** Reconcile every tile touching a corner. */
  reconcileAround(cx: number, cy: number): void {
    for (let y = cy - 1; y <= cy; y++) for (let x = cx - 1; x <= cx; x++) this.reconcile(x, y);
  }

  /** Fill in the rock under every tile, and keep bare rock tiles showing it. */
  fillRock(kind: (x: number, y: number) => number): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        const k = kind(x, y);
        this.rock[i] = k;
        if (this.tiles[i] === TileType.Rock) this.data[i] = k;
      }
    }
  }

  /** Fill in soil depths for a world that was saved before rock had a depth. */
  deriveDirt(depth = 10): void {
    for (let cy = 0; cy <= this.h; cy++) {
      for (let cx = 0; cx <= this.w; cx++) {
        let d = depth;
        for (let y = cy - 1; y <= cy; y++) {
          for (let x = cx - 1; x <= cx; x++) {
            if (!this.inBounds(x, y)) continue;
            const t = this.getTile(x, y);
            if (t === TileType.Rock || t === TileType.Snow) d = 0;
          }
        }
        this.dirt[cy * this.cw + cx] = d;
      }
    }
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

  /** Whether this ground has ever been looked at. */
  isKnown(x: number, y: number): boolean {
    return this.seen[y * this.w + x] === 1;
  }

  /**
   * Write down what a tile looks like now, because somebody is looking at it.
   * What is remembered is what was last seen, not what is there: fell a wood
   * and walk away and the map keeps the trees until you go back.
   */
  remember(x: number, y: number): boolean {
    const i = y * this.w + x;
    const t = this.tiles[i];
    const d = this.data[i];
    if (this.seen[i] === 1 && this.mem[i] === t && this.memData[i] === d) return false;
    this.seen[i] = 1;
    this.mem[i] = t;
    this.memData[i] = d;
    return true;
  }

  /** Mark the whole map as looked at, for a world that predates any fog. */
  rememberAll(): void {
    this.seen.fill(1);
    this.mem.set(this.tiles);
    this.memData.set(this.data);
  }

  /** The tile as a given viewer has it: what is there, or what was last seen. */
  viewTile(x: number, y: number, live: boolean): TileType {
    return (live ? this.tiles[y * this.w + x] : this.mem[y * this.w + x]) as TileType;
  }

  viewData(x: number, y: number, live: boolean): number {
    return live ? this.data[y * this.w + x] : this.memData[y * this.w + x];
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
    if (t === TileType.Slabs) return SLAB_VARIANTS[slabVariant(this.getData(x, y))].name;
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
