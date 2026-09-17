import { TileType, TILE_DEFS, TREE_DEFS, BUSH_DEFS, ROCK_VARIANTS, SLAB_VARIANTS, treeSpecies, bushSpecies, rockVariant, slabVariant } from './tiles';

export type WorldListener = (x: number, y: number) => void;

/** The square the ground is worked out in. The same one the cost analysis measured. */
export const CHUNK = 64;

/** One square of land, exactly the shape `generateAtlasWindow` returns. */
export interface LandWindow {
  /** (w + 1) x (h + 1) corner heights and soil depths. */
  heights: Int16Array;
  dirt: Uint8Array;
  /** w x h tiles. */
  tiles: Uint8Array;
  data: Uint8Array;
  rock: Uint8Array;
}

/**
 * Where ground comes from when nobody has worked it out yet.
 *
 * A callback rather than an import, so this file still knows nothing about
 * atlases, noise or archipelagos — it knows that ground can be asked for a
 * square at a time, and whoever built the world knows how to answer.
 */
export type LandSource = (x0: number, y0: number, w: number, h: number) => LandWindow;

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
  /**
   * The box everything ever seen falls inside. A map of a thousand tiles a
   * side drawn whole is mostly unexplored dark with a speck in it; this is
   * what lets the map show what there is to see. Empty until the first tile
   * is looked at, which is what x1 below zero means.
   */
  readonly knownBox = { x0: 0, y0: 0, x1: -1, y1: -1 };
  /**
   * Whether the ground, or what is known of it, has changed since it was last
   * put away. The land of a big island is ten megabytes; copying all of it
   * out every twenty seconds costs a visible hitch, and most of the time none
   * of it has moved. Digging touches the ground; walking somewhere new touches
   * the fog; standing still touches neither.
   */
  groundTouched = true;
  fogTouched = true;
  /**
   * Squares whose remembered picture still has to be taken from the ground.
   *
   * A fog restored from the island says where somebody has been and nothing
   * about what they saw there, which is right — this browser builds the whole
   * island from its seed and has replayed every change anybody made, so the
   * ground is known without being told. But the remembered map is read out of
   * `mem`, and `mem` is empty until something writes it.
   *
   * Filling it at the join would mean working out every square anybody has
   * ever walked over before they can see anything, which on a well-travelled
   * island is the whole map and three minutes of it — exactly the cost
   * `streamFrom` exists to avoid. So it is filled a square at a time, the
   * first time the remembered map is read there, which is the moment it is
   * actually wanted. One byte a square: four kilobytes for a 4096 island.
   *
   * Opening the map does read all of it, so a restored fog costs about ten
   * milliseconds a square there, once — the map has always had to work a
   * square out to draw a height, and what is new is only that a refresh no
   * longer arrives with it already done. `supabase/test/fog.ts` keeps that
   * number in sight so it cannot quietly get worse.
   *
   * Null once every square has been filled, which is also the fast path for
   * every world that never restored a fog at all.
   */
  private refill: Uint8Array | null = null;
  private refilling = 0;
  /** The seed this world was made from, so rock kinds stay consistent. */
  seed = 0;
  /**
   * Ground that has not been worked out yet.
   *
   * A 4096 x 4096 island is 16.8 M tiles and something like three minutes of
   * generation. Nobody waits three minutes, and nobody needs to: the land is a
   * pure function of the seed, so it can be worked out a square at a time, and
   * the nine squares a player can actually see cost a fraction of a second.
   *
   * `ready` has one byte per 64 x 64 square and `source` knows how to fill
   * one. Both stay null for a world that arrived complete — a small island, or
   * one read back out of a save — and then every reader below is exactly the
   * array lookup it always was.
   */
  private source: LandSource | null = null;
  private ready: Uint8Array | null = null;
  private across = 0;
  private down = 0;
  /** How many squares have been worked out, for anybody drawing a progress line. */
  grown = 0;
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
    if (seen) this.measureKnown();
  }


  /** Work the box out from scratch, for a world that has just been read in. */
  private measureKnown(): void {
    const b = this.knownBox;
    b.x0 = this.w;
    b.y0 = this.h;
    b.x1 = -1;
    b.y1 = -1;
    for (let y = 0; y < this.h; y++) {
      const row = y * this.w;
      for (let x = 0; x < this.w; x++) {
        if (!this.seen[row + x]) continue;
        if (x < b.x0) b.x0 = x;
        if (x > b.x1) b.x1 = x;
        if (y < b.y0) b.y0 = y;
        if (y > b.y1) b.y1 = y;
      }
    }
  }

  /**
   * Work this world out as it is asked for rather than all at once.
   *
   * Everything below that reads the ground calls `ensure` first, so there is
   * no call site anywhere in the program that can forget — a reader that
   * forgot would not crash, it would quietly see an ocean at height zero,
   * which is the worst kind of bug to have to find.
   */
  streamFrom(source: LandSource): void {
    this.source = source;
    this.across = Math.ceil(this.w / CHUNK);
    this.down = Math.ceil(this.h / CHUNK);
    this.ready = new Uint8Array(this.across * this.down);
    this.grown = 0;
    this.minHeight = 0;
    this.maxHeight = 0;
  }

  /** Whether this world is worked out as it goes rather than held whole. */
  get streamed(): boolean {
    return this.ready !== null;
  }

  /** How much of it exists so far, 0 to 1. */
  get grownShare(): number {
    return this.ready ? this.grown / this.ready.length : 1;
  }

  /** The ground under a tile, worked out if it has not been yet. */
  ensure(x: number, y: number): void {
    const r = this.ready;
    if (r === null) return;
    const cx = x < 0 ? 0 : x >= this.w ? this.across - 1 : (x / CHUNK) | 0;
    const cy = y < 0 ? 0 : y >= this.h ? this.down - 1 : (y / CHUNK) | 0;
    if (r[cy * this.across + cx] === 0) this.grow(cx, cy);
  }

  /**
   * Every square touching a box.
   *
   * What the renderer and the pathfinder call before they sweep a region, so
   * that a walk across a chunk boundary costs one pause up front rather than a
   * stutter in the middle of a frame.
   */
  ensureBox(x0: number, y0: number, x1: number, y1: number): void {
    const r = this.ready;
    if (r === null) return;
    const cx0 = Math.max(0, (Math.min(x0, x1) / CHUNK) | 0);
    const cy0 = Math.max(0, (Math.min(y0, y1) / CHUNK) | 0);
    const cx1 = Math.min(this.across - 1, (Math.max(x0, x1) / CHUNK) | 0);
    const cy1 = Math.min(this.down - 1, (Math.max(y0, y1) / CHUNK) | 0);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) if (r[cy * this.across + cx] === 0) this.grow(cx, cy);
    }
  }

  /**
   * Whether a corner on this square's edge belongs to a square already made.
   *
   * The corner planes are one wider than the tile planes, so every square
   * writes the corners along its far edges too — the same corners its
   * neighbours write. While the only thing writing them was the generator that
   * overlap cost nothing, because both sides wrote the same number.
   *
   * It stopped being free the moment a join started replaying the island's
   * history onto the land. A dig writes four corners; two of them may sit on
   * the edge of the next square along. If that square is worked out *later* —
   * because somebody dug there later, or simply walked that way — it lays the
   * generated ground back over them, and the hole gets a seam down one side.
   *
   * So a corner is written by the first square that reaches it and left alone
   * by the rest: whoever got there first may have been written over since, and
   * what is on the ground now is the island's answer, not the seed's. Up to
   * four squares touch a corner, hence the pair of candidates each way.
   */
  private cornerTaken(gx: number, gy: number, cx: number, cy: number): boolean {
    const r = this.ready;
    if (!r) return false;
    /*
     * Which squares actually touch this corner, and only those.
     *
     * A corner on a square line is shared with the square across it; a corner
     * in the middle of that line is shared with nobody, and the square along
     * the *other* axis does not reach it. Asking one square too far each way
     * was the whole of "there are ditches through the entire map": walk south
     * and back north and the square you come back to sees its neighbour below
     * marked ready, decides the whole of its left-hand edge is somebody
     * else's, and writes none of it. Nobody else ever does either, so a line
     * of corners stays at the nought the array was made with — a trench
     * through the land, a shoal through the sea, and bare rock down the middle
     * of it because the soil was skipped with the height. Straight, unbroken,
     * and every sixty-four tiles both ways.
     */
    const onX = gx % CHUNK === 0;
    const onY = gy % CHUNK === 0;
    const i0 = onX ? gx / CHUNK - 1 : (gx / CHUNK) | 0;
    const j0 = onY ? gy / CHUNK - 1 : (gy / CHUNK) | 0;
    for (let j = j0; j <= (onY ? j0 + 1 : j0); j++) {
      if (j < 0 || j >= this.down) continue;
      for (let i = i0; i <= (onX ? i0 + 1 : i0); i++) {
        if (i < 0 || i >= this.across) continue;
        if (i === cx && j === cy) continue;
        if (r[j * this.across + i] === 1) return true;
      }
    }
    return false;
  }

  /**
   * One square, worked out and laid into the full arrays.
   */
  private grow(cx: number, cy: number): void {
    const source = this.source;
    const r = this.ready;
    if (!source || !r) return;
    // Marked before the work, not after: a source that reads back through this
    // world would otherwise ask for the square it is in the middle of making.
    r[cy * this.across + cx] = 1;
    this.grown += 1;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const w = Math.min(CHUNK, this.w - x0);
    const h = Math.min(CHUNK, this.h - y0);
    const win = source(x0, y0, w, h);
    for (let y = 0; y <= h; y++) {
      const from = y * (w + 1);
      const to = (y0 + y) * this.cw + x0;
      const edge = y === 0 || y === h;
      for (let x = 0; x <= w; x++) {
        // Only the corners along the four edges are anybody else's, and only
        // those are worth asking about.
        if ((edge || x === 0 || x === w) && this.cornerTaken(x0 + x, y0 + y, cx, cy)) continue;
        const v = win.heights[from + x];
        this.heights[to + x] = v;
        this.dirt[to + x] = win.dirt[from + x];
        if (v > this.maxHeight) this.maxHeight = v;
        if (v < this.minHeight) this.minHeight = v;
      }
    }
    for (let y = 0; y < h; y++) {
      const from = y * w;
      const to = (y0 + y) * this.w + x0;
      for (let x = 0; x < w; x++) {
        this.tiles[to + x] = win.tiles[from + x];
        this.data[to + x] = win.data[from + x];
        this.rock[to + x] = win.rock[from + x];
      }
    }
  }

  /** The kind of rock under a tile, bare or buried. */
  rockKind(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    this.ensure(x, y);
    return this.rock[y * this.w + x];
  }

  setRockKind(x: number, y: number, kind: number): void {
    if (!this.inBounds(x, y)) return;
    this.ensure(x, y);
    this.rock[y * this.w + x] = kind;
  }

  /** Soil left over the bedrock at a corner; 0 means the rock is bare. */
  getDirt(cx: number, cy: number): number {
    const x = cx < 0 ? 0 : cx > this.w ? this.w : cx;
    const y = cy < 0 ? 0 : cy > this.h ? this.h : cy;
    this.ensure(x, y);
    return this.dirt[y * this.cw + x];
  }

  setDirt(cx: number, cy: number, v: number): void {
    if (!this.cornerInBounds(cx, cy)) return;
    this.ensure(cx, cy);
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
   *
   * Except over a bed, which is the one thing this rule cannot put back.
   *
   * It strips a surface off and knows exactly one thing to lay down in its
   * place, and that thing is dirt. Over grass that is right — grass grows back
   * and dirt is what is under it. Over sand, clay, peat or tar it is the end of
   * the bed: dig the last spadeful off a clay pit and the tile went to rock,
   * drop one spadeful of dirt on it and the tile came back as *dirt*, and the
   * clay was gone for good. Reported from the island as dropping dirt turning
   * sand and clay into dirt, which is the second half of it.
   *
   * A bed is the ground itself rather than soil lying on rock — `collect` says
   * so, and says it in the same words the shovel reads: "the tile is exactly as
   * it was afterwards". So nothing here has any business touching it.
   */
  reconcile(x: number, y: number): void {
    if (!this.inBounds(x, y)) return;
    const t = this.getTile(x, y);
    if (TILE_DEFS[t as TileType]?.collect) return;
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
    this.groundTouched = true;
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
    this.groundTouched = true;
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
    this.ensure(x, y);
    return this.heights[y * this.cw + x];
  }

  setHeight(cx: number, cy: number, v: number): void {
    if (!this.cornerInBounds(cx, cy)) return;
    this.ensure(cx, cy);
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
    this.ensure(x, y);
    const i = y * this.w + x;
    const t = this.tiles[i];
    const d = this.data[i];
    if (this.seen[i] === 1 && this.mem[i] === t && this.memData[i] === d) return false;
    if (this.seen[i] === 0) {
      const b = this.knownBox;
      if (b.x1 < 0) {
        b.x0 = x;
        b.x1 = x;
        b.y0 = y;
        b.y1 = y;
      } else {
        if (x < b.x0) b.x0 = x;
        if (x > b.x1) b.x1 = x;
        if (y < b.y0) b.y0 = y;
        if (y > b.y1) b.y1 = y;
      }
    }
    this.seen[i] = 1;
    this.mem[i] = t;
    this.memData[i] = d;
    this.fogTouched = true;
    return true;
  }

  /**
   * Ground somebody has walked before, with no picture of what they saw.
   *
   * The other half of `remember`, for a fog that was worked out in another
   * sitting and kept somewhere else. It sets what is known and leaves the
   * remembered picture to `fillMemory` below, which takes it off the ground
   * itself when the map is looked at.
   */
  markSeen(x: number, y: number): void {
    if (!this.inBounds(x, y)) return;
    const i = y * this.w + x;
    if (this.seen[i] === 1) return;
    this.seen[i] = 1;
    this.fogTouched = true;
    const b = this.knownBox;
    if (b.x1 < 0) {
      b.x0 = x;
      b.x1 = x;
      b.y0 = y;
      b.y1 = y;
    } else {
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    }
    // A world held whole has its ground already and can be remembered on the
    // spot; only a streamed one has to wait for the square to exist.
    if (!this.ready) {
      this.mem[i] = this.tiles[i];
      this.memData[i] = this.data[i];
      return;
    }
    if (!this.refill) this.refill = new Uint8Array(this.across * this.down);
    const c = ((y / CHUNK) | 0) * this.across + ((x / CHUNK) | 0);
    if (!this.refill[c]) {
      this.refill[c] = 1;
      this.refilling += 1;
    }
  }

  /** Take a square's remembered picture off the ground, once, the first time it is read. */
  private fillMemory(x: number, y: number): void {
    const r = this.refill;
    if (!r) return;
    const cx = (x / CHUNK) | 0;
    const cy = (y / CHUNK) | 0;
    const c = cy * this.across + cx;
    if (!r[c]) return;
    r[c] = 0;
    this.refilling -= 1;
    if (this.refilling <= 0) this.refill = null;
    this.ensure(x, y);
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const x1 = Math.min(this.w, x0 + CHUNK);
    const y1 = Math.min(this.h, y0 + CHUNK);
    for (let ty = y0; ty < y1; ty++) {
      const row = ty * this.w;
      for (let tx = x0; tx < x1; tx++) {
        const i = row + tx;
        if (this.seen[i] === 1) {
          this.mem[i] = this.tiles[i];
          this.memData[i] = this.data[i];
        }
      }
    }
  }

  /**
   * Mark the whole map as looked at, for a world that predates any fog.
   *
   * Refused for a streamed world, and that refusal is the point: it would
   * copy sixteen million zeros into the remembered map and leave a player
   * looking at a flat ocean they have apparently already explored. On a big
   * island the fog is not a nicety, it is the thing that makes the map mean
   * anything, so there is nothing here to opt out of.
   */
  rememberAll(): void {
    if (this.ready) return;
    this.fogTouched = true;
    this.knownBox.x0 = 0;
    this.knownBox.y0 = 0;
    this.knownBox.x1 = this.w - 1;
    this.knownBox.y1 = this.h - 1;
    this.seen.fill(1);
    this.mem.set(this.tiles);
    this.memData.set(this.data);
  }

  /** The tile as a given viewer has it: what is there, or what was last seen. */
  viewTile(x: number, y: number, live: boolean): TileType {
    // Ground that came back with a restored fog has no remembered picture yet;
    // this is where it is taken off the ground, and the check costs a null
    // test on every world that never restored one.
    if (!live && this.refill) this.fillMemory(x, y);
    return (live ? this.tiles[y * this.w + x] : this.mem[y * this.w + x]) as TileType;
  }

  viewData(x: number, y: number, live: boolean): number {
    if (!live && this.refill) this.fillMemory(x, y);
    return live ? this.data[y * this.w + x] : this.memData[y * this.w + x];
  }

  getTile(x: number, y: number): TileType {
    if (!this.inBounds(x, y)) return TileType.Sand;
    this.ensure(x, y);
    return this.tiles[y * this.w + x] as TileType;
  }

  getData(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    this.ensure(x, y);
    return this.data[y * this.w + x];
  }

  setTile(x: number, y: number, t: TileType, data = 0): void {
    if (!this.inBounds(x, y)) return;
    this.ensure(x, y);
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

  /**
   * The lowest and highest ground there is.
   *
   * Skipped entirely for a streamed world: most of its corners have not been
   * worked out, so a sweep would read sixteen million zeros and conclude the
   * island is flat. `grow` keeps the range up to date square by square
   * instead, which is the same answer arrived at as the ground arrives.
   */
  recomputeRange(): void {
    if (this.ready) return;
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
    this.groundTouched = true;
    for (const fn of this.listeners) fn(x, y);
  }
}
