/**
 * Put an island and the browsers that draw it back on the same ground.
 *
 * The land travelled once, at founding. Postgres has held that copy ever
 * since and every browser works the same ground out from the seed — so the
 * generator is a wire format with one message in it, sent on founding day,
 * and every change to it since moves the ground under an island already
 * standing. Nothing in the game says so. `tile_change` carries what people
 * have dug and nothing else; the island quietly wins every disagreement; and
 * you get *"That ground will not pack down"* on a tile your screen draws as
 * dirt and has drawn as dirt all week.
 *
 * This finds those tiles and, asked to, writes them down. A `tile_change` row
 * is the one thing every browser reads on every join, so one row per tile is
 * the whole cure — and it cures it for everybody, for ever, without the land
 * travelling again.
 *
 *   SUPABASE_URL=... SUPABASE_KEY=<service key> \
 *     npx tsx tools/reconcile-land.ts --name Wildermon
 *
 * Reports and writes nothing. `--write` writes. Both read the island's land
 * a band at a time, so a 4096 island costs memory in megabytes rather than
 * in hundreds of them.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { generateAtlasWindow } from '../src/world/atlas-world';
import { PROJECT } from '../src/net/supabase';
import { readAtlas } from './atlas-node';
import { TILE_DEFS } from '../src/world/tiles';

/** Rows of land read and compared at a time. */
const BAND = 64;
/** Rows of `tile_change` written per request. */
const WRITE_BATCH = 2000;

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const wanted = arg('name', '');
const write = has('write');

/** Ground a shovel treads down, which is also the ground a sapling takes. */
const SOFT = new Set([0, 1, 5, 6, 11, 20]);

const faceName = (t: number): string =>
  (TILE_DEFS as Record<number, { name: string } | undefined>)[t]?.name ?? String(t);

const REGION = 256;
const regionOf = (x: number, y: number): number => Math.floor(y / REGION) * 4096 + Math.floor(x / REGION);

/** Postgres hands a bytea back as `\x...` over REST, and base64 over some paths. */
function bytes(v: string): Uint8Array {
  if (v.startsWith('\\x')) return Uint8Array.from(Buffer.from(v.slice(2), 'hex'));
  return Uint8Array.from(Buffer.from(v, 'base64'));
}

/** A signed 16-bit height out of a corner row. */
const i16 = (b: Uint8Array, i: number): number => {
  const v = b[i * 2] | (b[i * 2 + 1] << 8);
  return v > 32767 ? v - 65536 : v;
};

interface Row { y: number; tiles: string; data: string }
interface Corner { y: number; heights: string; dirt: string }

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL || PROJECT.url;
  const key = process.env.SUPABASE_KEY || '';
  if (!key) throw new Error('SUPABASE_KEY must be the project service key: this reads and writes land.');
  const sb: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

  const { data: worlds, error: we } = await sb.from('world').select('id, name, seed, size').eq('ready', true);
  if (we) throw new Error(`could not read the worlds: ${we.message}`);
  const list = (worlds ?? []) as Array<{ id: string; name: string; seed: number; size: number }>;
  const world = wanted ? list.find((w) => w.name === wanted) : list.length === 1 ? list[0] : undefined;
  if (!world) {
    throw new Error(wanted
      ? `no island called ${wanted}; there is ${list.map((w) => w.name).join(', ') || 'none'}`
      : `name one with --name: ${list.map((w) => w.name).join(', ')}`);
  }
  console.log(`${world.name}: ${world.size} tiles a side, seed ${world.seed}`);

  /*
   * What the browser already knows, which is the whole of what it knows.
   *
   * A tile with a change on it is a tile the browser gets right whatever the
   * generator says, because the replay lays the change over the generated
   * ground. Only the untouched ones can be wrong, and this is what tells them
   * apart — bounded by how much of the island has ever been dug rather than
   * by how big it is.
   */
  const told = new Map<number, number>();
  for (let from = 0; ; ) {
    const { data, error } = await sb.from('tile_change')
      .select('x, y, tile, n').eq('world_id', world.id).gt('n', from).order('n').limit(10000);
    if (error) throw new Error(`could not read the record: ${error.message}`);
    const rows = (data ?? []) as Array<{ x: number; y: number; tile: number; n: number }>;
    if (!rows.length) break;
    for (const r of rows) told.set(r.y * world.size + r.x, r.tile);
    from = rows[rows.length - 1].n;
  }
  console.log(`  the record already covers ${told.size} tiles`);

  const atlas = readAtlas();
  let checked = 0, apart = 0, refuses = 0, written = 0;
  const kinds = new Map<string, number>();
  let batch: Array<Record<string, unknown>> = [];

  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    const { error } = await sb.from('tile_change').insert(batch);
    if (error) throw new Error(`could not write the record: ${error.message}`);
    written += batch.length;
    batch = [];
  };

  for (let y0 = 0; y0 < world.size; y0 += BAND) {
    const h = Math.min(BAND, world.size - y0);
    const { data: landData, error: le } = await sb.from('land_tile')
      .select('y, tiles, data').eq('world_id', world.id).gte('y', y0).lt('y', y0 + h);
    if (le) throw new Error(`could not read the land at ${y0}: ${le.message}`);
    const land = new Map<number, Row>();
    for (const r of (landData ?? []) as Row[]) land.set(r.y, r);

    const win = generateAtlasWindow(world.seed, atlas, 0, y0, world.size, h, world.size);

    // Corners only when there is something to write, and one band's worth.
    let corners: Map<number, { heights: Uint8Array; dirt: Uint8Array }> | null = null;
    const bandCorners = async (): Promise<NonNullable<typeof corners>> => {
      if (corners) return corners;
      const { data, error } = await sb.from('land_corner')
        .select('y, heights, dirt').eq('world_id', world.id).gte('y', y0).lte('y', y0 + h);
      if (error) throw new Error(`could not read the corners at ${y0}: ${error.message}`);
      corners = new Map();
      for (const c of (data ?? []) as Corner[]) corners.set(c.y, { heights: bytes(c.heights), dirt: bytes(c.dirt) });
      return corners;
    };

    for (let j = 0; j < h; j++) {
      const row = land.get(y0 + j);
      if (!row) continue;
      const stored = bytes(row.tiles);
      const storedData = bytes(row.data);
      for (let x = 0; x < world.size; x++) {
        checked++;
        const k = (y0 + j) * world.size + x;
        // The browser's own answer: the change if there is one, the seed if not.
        const drawn = told.has(k) ? (told.get(k) as number) : win.tiles[j * world.size + x];
        const truth = stored[x];
        /*
         * And the byte under the face, which a change carries as well. The
         * same face with a different byte is a different tree: the day the
         * eight fruit trees were held to their islands, the generator kept
         * every face and moved the species of one tree in fifty, which this
         * used to look straight through.
         */
        const byteApart = !told.has(k) && win.data[j * world.size + x] !== storedData[x];
        if (drawn === truth && !byteApart) continue;
        apart++;
        if (SOFT.has(drawn) && !SOFT.has(truth)) refuses++;
        const name = drawn === truth ? `${faceName(truth)} both, the byte apart` : `${faceName(drawn)} drawn, ${faceName(truth)} held`;
        kinds.set(name, (kinds.get(name) ?? 0) + 1);
        if (!write) continue;
        const c = await bandCorners();
        const c0 = c.get(y0 + j);
        const c1 = c.get(y0 + j + 1);
        if (!c0 || !c1) continue;
        batch.push({
          world_id: world.id, x, y: y0 + j, region: regionOf(x, y0 + j),
          tile: truth, data: storedData[x],
          corners: [i16(c0.heights, x), i16(c0.heights, x + 1), i16(c1.heights, x + 1), i16(c1.heights, x)],
          soil: [c0.dirt[x], c0.dirt[x + 1], c1.dirt[x + 1], c1.dirt[x]],
        });
        if (batch.length >= WRITE_BATCH) await flush();
      }
    }
    if (y0 % (BAND * 8) === 0) process.stdout.write(`  ${y0}/${world.size}\r`);
  }
  await flush();

  console.log(`  ${checked} tiles compared`);
  console.log(`  ${apart} where the island and a fresh browser disagree`);
  console.log(`  ${refuses} of those are soft ground drawn over something the island will not pack`);
  for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`      ${String(n).padStart(8)}  ${k}`);
  console.log(write ? `  ${written} written into the record` : '  nothing written; pass --write to write it');
}

main().catch((e: unknown) => { console.error(String(e)); process.exit(1); });
