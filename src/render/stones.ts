/**
 * Stepping stones, as they are drawn: a few flat stones on each tile of them,
 * standing a hand's breadth out of the water, a wet dark rim round a pale dry
 * top, and the water lapping round each.
 *
 * Where every stone goes is worked out from its tile and the tiles beside it
 * and from nothing else, so it never moves and never flickers. They run in a
 * line through the tile toward each tile of stones beside it, square or
 * corner to corner, and on out of the last tile of a line toward whatever it
 * points at; a tile on its own lies across toward the dry ground either side
 * of it. Along a line they are a third of the way across a tile apart -- a
 * stride -- and one stands on the join between each two tiles of a line,
 * drawn by one of the two, so the spacing is the same across a join as inside
 * a tile and a stream running along the join is stepped over on a stone
 * standing in the middle of it. Each stone is its own size and shape and a
 * little off the line, so a crossing reads as a crossing from every turn of
 * the view and never as a row of tiles; a line turns a corner on one stone
 * set in the crook of it.
 *
 * Drawn after the water on their line of the ground and before anything that
 * stands on them (`Renderer`), which also keeps the sea's swell off them.
 * Below `DETAIL_FROM` they are their shapes and colours.
 */
import type { Camera } from '../engine/camera';
import { hash2 } from '../world/noise';
import { SLAB_VARIANTS, stonesKind, TileType, type RGB } from '../world/tiles';
import type { World } from '../world/world';
import { DETAIL_FROM } from './falls';
import { SPRING_FOAM } from './water';

/** How far a stone's top stands out of the water it is set in, in height units: dry, and a step up out of it. What a body on them is drawn standing at. */
export const STONES_RISE = 1;
/** How far apart two stones along a line are, as a share of the step from one tile's middle to the next's. */
const STRIDE = 1 / 3;
/** Numbers a stone is kept as: where it is in the world, its radius in tiles, its turn, how much narrower it is one way, and a number of its own. */
const S = 6;
/** The most stones on a tile: one in the crook or the middle, and one out along each of four ways. */
const MOST = 5;
/** Corners round a stone's outline. */
const EDGE = 9;

const SQUARE: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const ASLANT: ReadonlyArray<readonly [number, number]> = [[1, -1], [1, 1], [-1, 1], [-1, -1]];

/**
 * The stones on tile (x, y), into `out` as `S` numbers each, and how many.
 * `stones` says whether a tile is stepping stones and `dry` whether it is
 * ground with no water on it, as the tile is to be drawn.
 */
export function stonesOn(x: number, y: number, stones: (x: number, y: number) => boolean, dry: (x: number, y: number) => boolean, out: Float64Array): number {
  const arms = ARMS;
  let n = 0;
  for (const [dx, dy] of SQUARE) if (stones(x + dx, y + dy)) { arms[n++] = dx; arms[n++] = dy; }
  // Corner to corner, where the line does not already go round that corner square.
  for (const [dx, dy] of ASLANT) if (stones(x + dx, y + dy) && !stones(x + dx, y) && !stones(x, y + dy)) { arms[n++] = dx; arms[n++] = dy; }
  // The end of a line carries on through the tile, toward the bank it was laid to reach.
  if (n === 2) { arms[2] = -arms[0]; arms[3] = -arms[1]; n = 4; }
  if (!n) {
    // A tile on its own lies across toward the dry ground either side of it, or whichever way it falls.
    const acrossX = dry(x - 1, y) || dry(x + 1, y);
    const acrossY = dry(x, y - 1) || dry(x, y + 1);
    const alongX = acrossX !== acrossY ? acrossX : hash2(x, y, 71) < 0.5;
    arms[0] = alongX ? 1 : 0; arms[1] = alongX ? 0 : 1; arms[2] = -arms[0]; arms[3] = -arms[1];
    n = 4;
  }
  let m = 0;
  const put = (k: number, ax: number, ay: number): void => {
    // A stone's own numbers are keyed to where it would stand exactly, so it is the same stone every frame, whichever tile draws it.
    const px = x + 0.5 + ax * k;
    const py = y + 0.5 + ay * k;
    const ix = Math.round(px * 12);
    const iy = Math.round(py * 12);
    // Off the line either way a little, and along it less; one in the middle of a meeting, any way at all.
    const len = Math.hypot(ax, ay);
    const way = hash2(ix, iy, 77) * Math.PI * 2;
    const ux = len ? ax / len : Math.cos(way);
    const uy = len ? ay / len : Math.sin(way);
    const off = (hash2(ix, iy, 72) - 0.5) * 0.08;
    const slip = (hash2(ix, iy, 73) - 0.5) * 0.03;
    out[m++] = px - uy * off + ux * slip;
    out[m++] = py + ux * off + uy * slip;
    out[m++] = 0.115 + 0.035 * hash2(ix, iy, 74);
    out[m++] = hash2(ix, iy, 75) * Math.PI * 2;
    out[m++] = 0.7 + 0.26 * hash2(ix, iy, 76);
    out[m++] = hash2(ix, iy, 78);
  };
  // The stone on the join with the tile an arm goes to, if this tile is the one that draws it: the one to the north, or square to the west.
  const joins = (ax: number, ay: number): boolean => ay < 0 || (ay === 0 && ax < 0);
  const straight = n === 4 && arms[0] === -arms[2] && arms[1] === -arms[3];
  if (straight) {
    for (let a = 0; a < 4; a += 2) {
      put(STRIDE / 2, arms[a], arms[a + 1]);
      if (joins(arms[a], arms[a + 1])) put(0.5, arms[a], arms[a + 1]);
    }
  } else if (n === 4) {
    // A turn: one stone in the crook of it, a stride from the stones on the joins either side.
    put(STRIDE / 2, arms[0] + arms[2], arms[1] + arms[3]);
    for (let a = 0; a < 4; a += 2) if (joins(arms[a], arms[a + 1])) put(0.5, arms[a], arms[a + 1]);
  } else {
    // Where lines meet: one in the middle, and the joins.
    put(0, 0, 0);
    for (let a = 0; a < n && m < MOST * S; a += 2) if (joins(arms[a], arms[a + 1])) put(0.5, arms[a], arms[a + 1]);
  }
  return m / S;
}

/** A tile's four corners, from its own; and how near the line a stream runs along a stone stands in it, in tiles. */
const CORNER: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
const STREAM_NEAR = 0.16;
/** How far a point is from the stretch between two others. */
function along(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const k = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - dx * k, py - ay - dy * k);
}

/** Scratch: the ways out of a tile, as steps; its stones; and one stone's outline on the screen. */
const ARMS = new Int8Array(16);
const ONE = new Float64Array(MOST * S);
const RIM = new Float64Array(EDGE * 2);

/** A stone to draw this frame: its screen place, the heights of the water round it and of its top, and its kind. */
interface Placed {
  sx: number;
  sy: number;
  wx: number;
  wy: number;
  r: number;
  turn: number;
  narrow: number;
  seed: number;
  water: number;
  top: number;
  wet: boolean;
  /** Standing in a stream, the water piling up against it. */
  stream: boolean;
  /** Out in the sea, all of its tile under it, where the swell runs. */
  sea: boolean;
  kind: number;
}

/** What stone looks like out of the water: its dry top and the damp at its edge, its wet side, the line round it and the softer one round its top; remembered, much of the colour gone. */
interface Inks {
  dry: string;
  damp: string;
  side: string;
  line: string;
  rim: string;
}
const tone = (c: RGB, k: number, toward: RGB = [0, 0, 0], by = 0): string =>
  `rgb(${[0, 1, 2].map((i) => Math.round(Math.max(0, Math.min(255, (c[i] + (toward[i] - c[i]) * by) * k)))).join(',')})`;
const grey = (c: RGB, keep: number): RGB => {
  const g = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  return [g + (c[0] - g) * keep, g + (c[1] - g) * keep, g + (c[2] - g) * keep];
};
/** The water's teal, which a wet stone takes a little of. */
const WET: RGB = [38, 84, 92];
const inksOf = (c: RGB): Inks => ({
  dry: tone(c, 1.07, [255, 255, 250], 0.16),
  damp: tone(c, 0.84, WET, 0.16),
  side: tone(c, 0.6, WET, 0.3),
  line: tone(c, 0.42, [30, 26, 34], 0.3),
  rim: tone(c, 0.66, WET, 0.2),
});
const INKS: Inks[][] = [SLAB_VARIANTS.map((v) => inksOf(v.color)), SLAB_VARIANTS.map((v) => inksOf(grey(v.color, 0.22)))];
/** The water darkened round a stone, and the foam of it lapping. */
const SHADE = 'rgba(16,52,58,0.24)';
const DAMP_GROUND = 'rgba(40,56,40,0.2)';
const lap = (a: number): string => `rgba(${SPRING_FOAM[0]},${SPRING_FOAM[1]},${SPRING_FOAM[2]},${a.toFixed(3)})`;

/** Scratch, kept between frames: the stones of a line of the ground. */
const LINE: Placed[] = [];

/**
 * The stones on the tiles of one line of the ground, `tiles` as x and y
 * pairs, back to front. `sea` is the outline of the sea drawn so far, which
 * the swell is laid over: each stone standing on a tile wholly under the sea
 * is cut out of it, turned the other way round, so the swell goes round it
 * rather than over it and costs nothing more for it. `lit` false is ground
 * only remembered: drawn still and grey, as the rest of it is.
 */
export function drawStones(
  ctx: CanvasRenderingContext2D, cam: Camera, world: World, tiles: readonly number[], t: number, lit: boolean, sea: Path2D | null,
): void {
  const z = cam.zoom;
  const ox = cam.worldToScreenX(0, 0);
  const oy = cam.worldToScreenY(0, 0, 0);
  const xx = cam.worldToScreenX(1, 0) - ox;
  const xy = cam.worldToScreenX(0, 1) - ox;
  const yx = cam.worldToScreenY(1, 0, 0) - oy;
  const yy = cam.worldToScreenY(0, 1, 0) - oy;
  const hs = oy - cam.worldToScreenY(0, 0, 1);
  const stones = (x: number, y: number): boolean => world.inBounds(x, y) && world.viewTile(x, y, lit) === TileType.SteppingStones;
  /*
   * Whether a stone on a tile a stream runs over stands in the stream: near
   * the line between two corners of its tile the water runs over, one side
   * of it or corner to corner, where the stream is drawn.
   */
  const field = world.water;
  const inStream = (wx: number, wy: number, x: number, y: number): boolean => {
    if (!field) return false;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = CORNER[i];
      if (!field.runsAt(x + ax, y + ay)) continue;
      for (let j = i + 1; j < 4; j++) {
        const [bx, by] = CORNER[j];
        if (!field.runsAt(x + bx, y + by)) continue;
        if (along(wx - x, wy - y, ax, ay, bx, by) < STREAM_NEAR) return true;
      }
    }
    return false;
  };
  const dry = (x: number, y: number): boolean => world.inBounds(x, y) && !world.hasWater(x, y) && !(world.water?.runsOver(x, y) ?? false);
  let used = 0;
  for (let i = 0; i < tiles.length; i += 2) {
    const x = tiles[i];
    const y = tiles[i + 1];
    const kind = stonesKind(world.viewData(x, y, lit));
    const surface = world.hasWater(x, y) ? world.surfaceAt(x, y) : -Infinity;
    const under = world.isSubmerged(x, y);
    const n = stonesOn(x, y, stones, dry, ONE);
    for (let k = 0; k < n; k++) {
      const b = k * S;
      const wx = ONE[b];
      const wy = ONE[b + 1];
      const ground = world.heightAt(wx, wy);
      const water = Math.max(ground, surface);
      const top = water + STONES_RISE;
      const p = LINE[used] ?? (LINE[used] = {} as Placed);
      used++;
      p.wx = wx;
      p.wy = wy;
      p.sx = ox + xx * wx + xy * wy;
      p.sy = oy + yx * wx + yy * wy;
      p.r = ONE[b + 2];
      p.turn = ONE[b + 3];
      p.narrow = ONE[b + 4];
      p.seed = ONE[b + 5];
      p.water = water;
      p.top = top;
      p.stream = surface === -Infinity && inStream(wx, wy, x, y);
      p.wet = surface > ground + 0.2 || p.stream;
      p.sea = under;
      p.kind = kind;
    }
  }
  if (!used) return;
  const list = LINE.slice(0, used).sort((a, b) => a.sy - b.sy);
  const detail = z >= DETAIL_FROM;
  // A stone's outline on the screen, `grow` times its size, at height `h`, into `RIM`.
  const outline = (p: Placed, grow: number, h: number): void => {
    const c = Math.cos(p.turn);
    const s = Math.sin(p.turn);
    const key = Math.floor(p.seed * 1e6);
    for (let e = 0; e < EDGE; e++) {
      const a = (e / EDGE) * Math.PI * 2 + (hash2(key, e, 81) - 0.5) * 0.35;
      const r = p.r * grow * (0.84 + 0.26 * hash2(key, e, 82));
      const lx = Math.cos(a) * r;
      const ly = Math.sin(a) * r * p.narrow;
      const dx = lx * c - ly * s;
      const dy = lx * s + ly * c;
      RIM[e * 2] = p.sx + xx * dx + xy * dy;
      RIM[e * 2 + 1] = p.sy + yx * dx + yy * dy - h * hs;
    }
  };
  // The outline as a smooth round, through the middles of its edges.
  const trace = (path: CanvasRenderingContext2D | Path2D): void => {
    const mx = (e: number): number => (RIM[e * 2] + RIM[((e + 1) % EDGE) * 2]) / 2;
    const my = (e: number): number => (RIM[e * 2 + 1] + RIM[((e + 1) % EDGE) * 2 + 1]) / 2;
    path.moveTo(mx(EDGE - 1), my(EDGE - 1));
    for (let e = 0; e < EDGE; e++) path.quadraticCurveTo(RIM[e * 2], RIM[e * 2 + 1], mx(e), my(e));
    path.closePath();
  };
  const shape = (p: Placed, grow: number, h: number): void => {
    outline(p, grow, h);
    ctx.beginPath();
    trace(ctx);
  };
  const inks = INKS[lit ? 0 : 1];
  for (const p of list) {
    const ink = inks[p.kind];
    // The water darkened round its foot, or the ground damp round it where a stream runs past.
    if (detail) {
      shape(p, 1.16, p.water);
      ctx.fillStyle = p.wet ? SHADE : DAMP_GROUND;
      ctx.fill();
    }
    if (detail && lit && p.wet) {
      // The water lapping round it: a line of foam close in, breathing, and now and then a ring going out.
      const breathe = Math.sin(t * (p.stream ? 4.1 : 1.7) + p.seed * 17);
      shape(p, 1.2 + 0.05 * breathe, p.water);
      ctx.strokeStyle = lap((p.stream ? 0.62 : 0.34) + 0.14 * breathe);
      ctx.lineWidth = Math.max(0.8, 1.1 * z);
      ctx.stroke();
      if (z >= 1) {
        const age = (t / (2.6 + 1.4 * p.seed) + p.seed * 5) % 1;
        shape(p, 1.25 + 0.7 * age, p.water);
        ctx.strokeStyle = lap(0.3 * (1 - age) * (1 - age));
        ctx.lineWidth = Math.max(0.7, 0.9 * z);
        ctx.stroke();
      }
    }
    // Its side, wet and dark, rounding in from the water up to its top, with the line round the whole of it.
    shape(p, 1.08, p.water);
    ctx.fillStyle = ink.side;
    ctx.fill();
    if (detail) {
      ctx.lineWidth = Math.max(0.7, 0.8 * z);
      ctx.strokeStyle = ink.line;
      ctx.stroke();
    }
    shape(p, 1.04, (p.water + p.top) / 2);
    ctx.fillStyle = ink.side;
    ctx.fill();
    // Its top, damp at the edge and dry in the middle, a little toward the back where the wet has not reached.
    shape(p, 1, p.top);
    ctx.fillStyle = ink.damp;
    ctx.fill();
    if (detail) {
      ctx.lineWidth = Math.max(0.6, 0.6 * z);
      ctx.strokeStyle = ink.rim;
      ctx.stroke();
      shape(p, 0.74, p.top + 0.25);
      ctx.fillStyle = ink.dry;
      ctx.fill();
    }
    if (sea && p.sea) {
      // Cut out of the sea the other way round from the way its tiles go round, so the swell's clip leaves it out.
      outline(p, 1.06, (p.water + p.top) / 2);
      sea.moveTo(RIM[0], RIM[1]);
      for (let e = EDGE - 1; e >= 0; e--) sea.lineTo(RIM[e * 2], RIM[e * 2 + 1]);
      sea.closePath();
    }
  }
  ctx.lineWidth = 1;
}
