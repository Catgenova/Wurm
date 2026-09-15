import { FOG_BYTES } from '../game/keep';
import type { World } from '../world/world';

/**
 * The fog of war, small enough to keep somewhere other than this tab.
 *
 * What has been seen is one bit a tile, and a 4096 island is sixteen million
 * of them — two megabytes flat, and the three arrays the local save writes are
 * fifty. Neither travels. But a fog is not a random spray of bits: it is a
 * body's own path widened by how far it can see, so along any row of the
 * island it is a handful of long runs. Run-length encoding is not a clever
 * trick here, it is the shape of the thing.
 *
 * Over the box the exploring falls inside rather than the whole island, since
 * `knownBox` already tracks it and a body that has walked a road up one coast
 * should not pay for the ocean on the other. A road across an island comes to
 * a few kilobytes; an island somebody has combed, tens.
 *
 * Base64 on the way out, because it goes through `jsonb` like everything else
 * the island is told.
 */

/**
 * A number, in as few bytes as it needs.
 *
 * Seven bits at a time, top bit set while there is more to come. A run of
 * three costs one byte and a skip across a whole 4096 island costs four, which
 * is the property that makes the empty parts of a map free.
 */
function putVarint(out: number[], v: number): void {
  let n = v;
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The fog as it stands, or null when none of the island has been seen yet.
 *
 * Null rather than an empty string so that a caller can tell "nothing to keep"
 * from "keep nothing", which are different instructions to the island.
 *
 * Too big to keep comes back null as well, and that is deliberate: the cap is
 * the island's and this is the side that knows what it is about to send, so it
 * is better to notice here than to be refused there. It cannot happen in
 * practice on any island this game founds — the whole of a 4096 map picked
 * over tile by tile in a chequerboard would do it, and nothing walks like
 * that.
 */
export function packFog(world: World): string | null {
  const b = world.knownBox;
  if (b.x1 < b.x0 || b.y1 < b.y0) return null;
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  const out: number[] = [];
  putVarint(out, b.x0);
  putVarint(out, b.y0);
  putVarint(out, bw);
  putVarint(out, bh);
  /*
   * Runs across the box, row after row, starting with unseen.
   *
   * The rows run into each other on purpose: a body walking east leaves a band
   * whose runs join up at the row ends, and treating the box as one long line
   * costs nothing and saves a run a row.
   */
  let run = 0;
  let want = 0;
  for (let y = b.y0; y <= b.y1; y++) {
    const row = y * world.w;
    for (let x = b.x0; x <= b.x1; x++) {
      const is = world.seen[row + x];
      if (is === want) run++;
      else {
        putVarint(out, run);
        want = is;
        run = 1;
      }
    }
  }
  putVarint(out, run);
  if (out.length > FOG_BYTES * 0.7) return null;
  return toBase64(Uint8Array.from(out));
}

/**
 * Take on a fog worked out in another sitting, and say how many tiles it was.
 *
 * Nothing about what the ground *looked like* comes with it, and nothing needs
 * to: this browser builds the whole island from its seed and has already
 * replayed every change anybody ever made over it, so the ground is right
 * without being told. `markSeen` is the whole of what this restores — where
 * somebody has been — and the remembered picture is taken from the ground
 * itself, square by square, as the map is looked at.
 *
 * Returns -1 on anything it cannot read. A fog that does not unpack is a fog
 * lost, which is a black map and a bad afternoon; it is not a reason to fail
 * to come ashore.
 */
export function unpackFog(world: World, packed: string): number {
  try {
    const bytes = fromBase64(packed);
    let at = 0;
    const take = (): number => {
      let v = 0;
      let shift = 0;
      for (;;) {
        if (at >= bytes.length) throw new Error('the fog ends in the middle of a number');
        const byte = bytes[at++];
        v += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0) return v;
        shift += 7;
        if (shift > 35) throw new Error('that is not a number');
      }
    };
    const x0 = take();
    const y0 = take();
    const bw = take();
    const bh = take();
    if (bw <= 0 || bh <= 0 || x0 + bw > world.w || y0 + bh > world.h) return -1;
    let seen = 0;
    let want = 0;
    let cell = 0;
    const cells = bw * bh;
    while (at < bytes.length && cell < cells) {
      const run = take();
      if (want === 1) {
        for (let i = 0; i < run && cell < cells; i++, cell++) {
          world.markSeen(x0 + (cell % bw), y0 + ((cell / bw) | 0));
          seen++;
        }
      } else {
        cell += run;
      }
      want = want === 1 ? 0 : 1;
    }
    return seen;
  } catch {
    return -1;
  }
}
