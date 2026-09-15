/**
 * Found the big island, once.
 *
 * A 4096 x 4096 world is sixteen point eight million tiles: about three
 * minutes to work out and 138 MB of land to hand over. That is fine for a
 * thing done once by a tool and is no way to spend a tab with somebody
 * watching, which is why `Island.found` refuses anything over 512 and points
 * here.
 *
 * The land has to travel exactly this once. After that nobody downloads it
 * again: the join carries the seed and every browser works the ground out for
 * itself, so the only thing on the wire is what people have actually dug.
 * Postgres keeps this copy because the rules are checked against it — a
 * database that does not know where the hills are cannot tell you that you
 * may not dig the sea.
 *
 *   SUPABASE_URL=... SUPABASE_KEY=... \
 *     npx tsx tools/found-island.ts --name "Wildermon" --size 4096 --seed 7
 *
 * With no URL it uses the project in src/net/supabase.ts. `--dry` works the
 * ground out and reports what it would send without sending any of it, which
 * is how this is tested somewhere with no network.
 */
import { createClient } from '@supabase/supabase-js';
import { generateAtlasWindow, findBaySpawn, ATLAS_CONFIG } from '../src/world/atlas-world';
import { PROJECT } from '../src/net/supabase';
import { readAtlas } from './atlas-node';
import type { LandRow } from '../src/net/landpack';

/** Rows of land per request. Thirty-two at 4096 is about a megabyte of JSON. */
const BATCH = 32;

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const size = Number(arg('size', '4096'));
const seed = Number(arg('seed', String((Math.random() * 0x7fffffff) >>> 0)));
const name = arg('name', 'Wildermon');
const dry = has('dry');

if (!Number.isInteger(size) || size < 8 || size > 4096) throw new Error(`${size} is not a size of island`);

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/** One band of land as the rows `rpc_put_land` takes. */
function bandRows(win: ReturnType<typeof generateAtlasWindow>, y0: number, h: number, w: number): LandRow[] {
  const cw = w + 1;
  const heightBytes = new Uint8Array(win.heights.buffer, win.heights.byteOffset, win.heights.byteLength);
  const out: LandRow[] = [];
  // h + 1 rows of corners and h of tiles. The last corner row of a band is the
  // first of the next, written twice with the same bytes — `rpc_put_land`
  // updates by y, so the overlap costs a row and needs no bookkeeping.
  for (let y = 0; y <= h; y++) {
    if (y0 + y > w) break;
    const row: LandRow = {
      y: y0 + y,
      heights: b64(heightBytes.subarray(y * cw * 2, (y + 1) * cw * 2)),
      dirt: b64(win.dirt.subarray(y * cw, (y + 1) * cw)),
    };
    if (y < h && y0 + y < w) {
      row.tiles = b64(win.tiles.subarray(y * w, (y + 1) * w));
      row.data = b64(win.data.subarray(y * w, (y + 1) * w));
      row.rock = b64(win.rock.subarray(y * w, (y + 1) * w));
    }
    out.push(row);
  }
  return out;
}

const atlas = readAtlas();
const spawn = findBaySpawn(atlas, seed, size);
console.log(`${name}: ${size} x ${size}, seed ${seed}, ashore at ${spawn.x}, ${spawn.y}`);
// Three bytes a corner (a 16-bit height and a byte of soil) and three a tile,
// and base64 puts a third back on top of that.
const wire = ((size + 1) * (size + 1) * 3 + size * size * 3) * 4 / 3;
console.log(`${(size * size / 1e6).toFixed(1)} M tiles, ${(wire / 1048576).toFixed(0)} MB of land to hand over`);

const started = Date.now();
let sent = 0;
let bytes = 0;

const sb = dry ? null : createClient(process.env.SUPABASE_URL || PROJECT.url, process.env.SUPABASE_KEY || PROJECT.key,
  { auth: { persistSession: false, autoRefreshToken: false } });
let worldId = '(dry run)';
let opened = false;

if (sb) {
  const { error: who } = await sb.auth.signInAnonymously();
  if (who) throw new Error(`could not sign in: ${who.message}`);
  const { data: id, error } = await sb.rpc('rpc_found', {
    p_name: name, p_seed: seed, p_size: size, p_spawn_x: spawn.x, p_spawn_y: spawn.y,
  });
  if (error || typeof id !== 'string') throw new Error(`the island would not start: ${error?.message}`);
  worldId = id;
  console.log(`island ${worldId}`);
  /*
   * An island that was started and never finished is worse than one that was
   * never started: it sits in the table, closed, holding 8,193 rows of nothing.
   * Said on the way out so that whoever is watching knows to clear it up.
   */
  process.on('exit', () => {
    if (!opened) console.error(`\nUNFINISHED: island ${worldId} never opened. Delete it before founding another.`);
  });
}

const put = async (rows: LandRow[]): Promise<void> => {
  if (!sb) return;
  const { error } = await sb.rpc('rpc_put_land', { p_world: worldId, p_rows: rows });
  if (error) throw new Error(`the land did not all arrive at row ${rows[0]?.y}: ${error.message}`);
};

for (let y0 = 0; y0 <= size; y0 += BATCH) {
  const h = Math.min(BATCH, size - y0);
  const win = generateAtlasWindow(seed, atlas, 0, y0, size, Math.max(1, h), size, ATLAS_CONFIG);
  const rows = bandRows(win, y0, Math.max(1, h), size);
  bytes += rows.reduce((a, r) => a + r.heights.length + r.dirt.length + (r.tiles?.length ?? 0) + (r.data?.length ?? 0) + (r.rock?.length ?? 0), 0);
  await put(rows);
  sent = y0 + rows.length;
  const done = Math.min(1, sent / (size + 1));
  const secs = (Date.now() - started) / 1000;
  process.stdout.write(`\r  ${(done * 100).toFixed(1)}%  ${sent} of ${size + 1} rows  ${(bytes / 1048576).toFixed(0)} MB  ${secs.toFixed(0)}s  (${(secs / Math.max(0.001, done) - secs).toFixed(0)}s left)   `);
}
process.stdout.write('\n');

if (sb) {
  /*
   * Open. After this `rpc_put_land` refuses, which is what makes the land
   * settled rather than something anybody can still edit.
   *
   * Tried more than once, because this is the one call where giving up costs
   * something: the land is already up, and the island was founded by *this*
   * anonymous session, so a later run cannot come back and finish it. A first
   * attempt at the big island timed out here with all 130 MB already handed
   * over, and the whole minute was thrown away for the want of a second go.
   */
  let why = '';
  for (let go = 1; go <= 3 && !opened; go++) {
    const { error } = await sb.rpc('rpc_ready', { p_world: worldId });
    if (!error) { opened = true; break; }
    why = error.message;
    console.error(`  opening it did not take (${why}); going again (${go} of 3)`);
    await new Promise((done) => setTimeout(done, go * 3000));
  }
  if (!opened) throw new Error(`the island would not open: ${why}`);
}
console.log(`${(bytes / 1048576).toFixed(0)} MB of land in ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log(dry
  ? 'dry run: nothing was sent and no island was made.'
  : `island ${worldId} is open — come ashore with ?island=${worldId}`);
