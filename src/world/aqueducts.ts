/**
 * Aqueducts, as water sees them: a channel that takes a spring's water out of
 * a pond or a pool and carries it to a basin somewhere else.
 *
 * A spring's water goes one way. It fills the hollow it rises in, goes over
 * that hollow's lowest lip, and runs on down to whatever it fills next
 * (`./springs`). An aqueduct whose head stands in one of those ponds, at the
 * height of its channel or under it, takes what that pond would have spilled:
 * the water leaves by the channel instead of over the lip, the stream that ran
 * on from the pond dries up, and every pond below that only that stream kept
 * goes dry with it. At the foot of the channel the water pours into its
 * basin -- a pool, which is full already and spills over its lowest edge; a
 * hollow, which it fills and then spills over the hollow's lip; or a fountain,
 * which keeps it -- and from there it runs on down as any spring's water does.
 *
 * All of that is worked out with the spring, from the ground, when the spring
 * is settled (`settleWater`), and the island does the same steps in
 * `settle_water`. Nothing here runs on the clock but the drawing.
 *
 * How much it carries is the channel's own: `CHANNEL_WIDE` across and
 * `CHANNEL_DEEP` deep, the water in it running at the springs' own pace,
 * `RUN_RATE` corners a second. That is `AQUEDUCT_FLOW` litres a minute, and a
 * hollow at its foot fills at that rate: its litres (`pondVolume`) over the
 * channel's (`fillSeconds`).
 */
import { pondTiles, RUN_RATE, settleChain, springCorner, type Chain, type Pond, type Shut, type SlabAt, type SpringRefusal, type Stream } from './springs';

/** A tile is this many height units across (the renderer's `UNITS_PER_TILE`), and a metre this many. */
export const TILE_UNITS = 40;
export const UNITS_A_METRE = 10;
/** A tile's breadth, in metres. */
export const TILE_METRES = TILE_UNITS / UNITS_A_METRE;

/** How wide the water in an aqueduct's channel is, in tiles (a metre), and how deep it runs, in height units. */
export const CHANNEL_WIDE = 1 / 4;
export const CHANNEL_DEEP = 1;
/**
 * The litres a channel carries in a second: its water's breadth and depth, in
 * metres, running `RUN_RATE` corners a second, a corner being a tile.
 */
export const AQUEDUCT_LPS = CHANNEL_WIDE * TILE_METRES * (CHANNEL_DEEP / UNITS_A_METRE) * RUN_RATE * TILE_METRES * 1000;
/** And in a minute, which is how it is said. */
export const AQUEDUCT_FLOW = AQUEDUCT_LPS * 60;
/**
 * The litres of pond over one corner for every height unit of water standing
 * on it: a corner stands for a tile's breadth of the bed.
 */
export const CORNER_LITRES = TILE_METRES * TILE_METRES * (1 / UNITS_A_METRE) * 1000;
/**
 * How high over the ground a fountain's lowest basin holds its water, in
 * height units: an aqueduct's channel has to stand at least this high over
 * the fountain's tile to pour into it.
 */
export const FOUNTAIN_RIM = 5;

/** A finished aqueduct, as water sees it. */
export interface Channel {
  id: number;
  /** The tile its head stands in, and the tile it pours into. */
  from: [number, number];
  to: [number, number];
  /** The height its water runs at: the water at its head when it was set out. */
  height: number;
  /** How many tiles of channel the water runs along between the two. */
  along: number;
  /** Whether a fountain stands in the tile it pours into, which keeps what it is given. */
  fountain: boolean;
}

/** Whether a pond lies over a tile: a pool that takes it in, or a pond with any corner of the tile under it. */
export function pondCovers(p: Pond, x: number, y: number): boolean {
  if (p.tiles) {
    for (let k = 0; k < p.tiles.length; k += 2) if (p.tiles[k] === x && p.tiles[k + 1] === y) return true;
    return false;
  }
  for (let k = 0; k < p.wet.length; k += 2) {
    const dx = p.wet[k] - x;
    const dy = p.wet[k + 1] - y;
    if ((dx === 0 || dx === 1) && (dy === 0 || dy === 1)) return true;
  }
  return false;
}

/** The litres a pond holds full: over every corner under it, as deep as the water there, a tile's breadth. */
export function pondVolume(p: Pond, height: (x: number, y: number) => number | null): number {
  let units = 0;
  for (let k = 0; k < p.wet.length; k += 2) units += p.level - (height(p.wet[k], p.wet[k + 1]) ?? p.level);
  return units * CORNER_LITRES;
}

/** How many seconds a channel takes to fill that many litres. */
export const fillSeconds = (litres: number): number => litres / AQUEDUCT_LPS;

/** How fast a pond an aqueduct fills rises, in height units a second: from its floor to its level in the time its litres take. */
export const pondRate = (p: Pick<Pond, 'level' | 'floor' | 'volume'>): number | undefined =>
  p.volume ? (p.level - p.floor) / fillSeconds(p.volume) : undefined;

/**
 * A spring's water, from the ground, with the aqueducts it reaches.
 *
 * `settleChain` from the spring first. Then down its ponds in order: the first
 * whose water stands over the head of a finished aqueduct at the channel's
 * height or above (the first such aqueduct by id, one not already taken) is
 * where the water leaves -- every pond after it and every stream out of it go,
 * and a stream along the channel (`Stream.via`) takes their place. At the foot
 * it pours into a fountain, which keeps it, and that is the end of it; or into
 * a pool, settled as a spring dug in that pool is; or onto the ground at the
 * lowest corner of the tile it pours into, from which it runs (`settleChain`
 * with `run`). What that makes is added on, each hollow it fills with the
 * litres it holds (`Pond.volume`), and the ponds of it looked at in turn for
 * aqueducts of their own. Onto a foundation at the foot with no pool in it
 * (one filled in since) it lands on the slab's top and goes off its edge with
 * the lowest thing beyond it, as a pool's water does (`settleChain`'s
 * `pour`). Wherever a pool's water would go over an edge an aqueduct's pier
 * stands on, that edge is a wall (`shut`, `aqueductShut`).
 */
export function settleWater(
  height: (x: number, y: number) => number | null, sx: number, sy: number, slabs: SlabAt | undefined,
  tile: [number, number] | undefined, channels: readonly Channel[], shut?: Shut,
): Chain | SpringRefusal {
  const first = settleChain(height, sx, sy, slabs, tile, { shut });
  if (typeof first === 'string' || !channels.length) return first;
  let ponds = first.ponds.slice();
  let streams = first.streams.slice();
  let box: Chain['box'] = [...first.box];
  const grow = (b: readonly number[]): void => {
    box = [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])];
  };
  const byId = [...channels].sort((a, b) => a.id - b.id);
  const used = new Set<number>();
  for (let k = 0; k < ponds.length; k++) {
    const p = ponds[k];
    const c = byId.find((ch) => !used.has(ch.id) && p.level >= ch.height && pondCovers(p, ch.from[0], ch.from[1]));
    if (!c) continue;
    used.add(c.id);
    ponds = ponds.slice(0, k + 1);
    // What went over a pool's edge goes along the channel instead.
    if (p.spill) {
      const dry = { ...p };
      delete dry.spill;
      ponds[k] = dry;
    }
    streams = streams.filter((s) => s.from < k);
    const [tx, ty] = c.to;
    grow([tx, ty, tx + 1, ty + 1]);
    const via = { via: c.id, along: c.along };
    if (c.fountain) {
      streams.push({ from: k, path: [], to: 'lost', ...via, fountain: true });
      break;
    }
    const [cx, cy] = springCorner((x, y) => height(x, y) ?? 0, tx, ty);
    const slab = slabs?.(tx, ty) ?? null;
    const cont = slab ? settleChain(height, cx, cy, slabs, [tx, ty], { pour: !slab.pool, shut })
      : settleChain(height, cx, cy, undefined, undefined, { run: true });
    if (typeof cont === 'string') {
      streams.push({ from: k, path: [], to: 'lost', ...via });
      break;
    }
    const off = ponds.length;
    for (const q of cont.ponds) ponds.push(q.wet.length ? { ...q, volume: pondVolume(q, height) } : q);
    if (slab?.pool) streams.push({ from: k, path: [], to: off, ...via });
    for (const s of cont.streams) {
      const to: Stream['to'] = typeof s.to === 'number' ? s.to + off : s.to;
      streams.push(s.from < 0 ? { from: k, path: s.path, to, ...via } : { from: s.from + off, path: s.path, to });
    }
    grow(cont.box);
  }
  return { ponds, streams, box };
}

/** Where an aqueduct runs, end to end: the tile it draws from, and the tile it pours into. */
export interface AqueductLine {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** Whether a tile is one an aqueduct runs over or ends on. */
const onLine = (l: AqueductLine, x: number, y: number): boolean =>
  l.ay === l.by ? y === l.ay && x >= Math.min(l.ax, l.bx) && x <= Math.max(l.ax, l.bx)
    : x === l.ax && y >= Math.min(l.ay, l.by) && y <= Math.max(l.ay, l.by);

/**
 * The edges an aqueduct's piers stand on, as walls to a pool's water: the
 * edge between any two tiles of its line, end to end, one after the other --
 * where a pool at either end of it, or one under a span, would otherwise
 * pour through a pier. Every aqueduct, set out or built. The island's
 * `aqueduct_shuts`.
 */
export function aqueductShut(lines: readonly AqueductLine[]): Shut | undefined {
  if (!lines.length) return undefined;
  return (px, py, nx, ny) => lines.some((l) => onLine(l, px, py) && onLine(l, nx, ny));
}

/** The aqueducts a chain carries water along, by id: the streams that go by one. */
export const channelsOf = (chain: Pick<Chain, 'streams'>): Stream[] => chain.streams.filter((s) => s.via !== undefined);

/** The tiles of a pond, as `pondTiles` has them: for a pool, its own. */
export const tilesOf = (p: Pond, w: number, h: number): number[] => (p.tiles ? p.tiles : pondTiles(p.wet, w, h));
