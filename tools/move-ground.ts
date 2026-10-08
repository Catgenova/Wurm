/**
 * Carry a change of the generator onto islands founded before it.
 *
 * The land travels once, at founding, and every browser works the same ground
 * out from the seed afterwards. When what the generator says about a region
 * changes, an island already standing holds the old answer and browsers draw
 * the new one. `reconcile-land.ts` settles that the other way, by writing the
 * island's answer into `tile_change`; this moves the island's own ground to the
 * new answer instead, which is what a change meant for the islands people are
 * already on needs.
 *
 * It is one move, named below, and it carries only what that move changed:
 *
 *  - the rock under the Northeast Tundra and West Skerry, written as the
 *    generator has it now. Nothing writes rock after founding, so every
 *    difference there is the move.
 *  - trees on the Northeast Tundra and East Isle where a plum is involved, on
 *    tiles nobody has touched (no `tile_change`), with the age the island has
 *    grown them to kept.
 *
 * Each island it has done goes into `land_move`, and an island already there
 * is skipped without reading its land, so a deploy can run this every time.
 *
 *   SUPABASE_URL=... SUPABASE_KEY=<service key> npx tsx tools/move-ground.ts
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { generateAtlasWindow, regionAt } from '../src/world/atlas-world';
import { REGIONS } from '../src/world/regions';
import { packTreeData, ROCK_VARIANTS, TileType, TREE_DEFS, treeSpecies, treeVariant } from '../src/world/tiles';
import { PROJECT } from '../src/net/supabase';
import { readAtlas } from './atlas-node';

const MOVE = '2026-10-08 glimmersteel to West Skerry, plum to East Isle, a bare tundra';
const regionNamed = (key: string): number => REGIONS.findIndex((R) => R.key === key);
const ROCK_REGIONS = new Set(['NortheastTundra', 'WestSkerry'].map(regionNamed));
const TREE_REGIONS = new Set(['NortheastTundra', 'EastIsle'].map(regionNamed));
const PLUM = TREE_DEFS.findIndex((t) => t.name === 'Plum');

/** Rows of land read and written at a time. */
const BAND = 64;

function bytes(v: string): Uint8Array {
  if (v.startsWith('\\x')) return Uint8Array.from(Buffer.from(v.slice(2), 'hex'));
  return Uint8Array.from(Buffer.from(v, 'base64'));
}

interface Row { y: number; tiles: string; data: string; rock: string }
interface World { id: string; name: string; seed: number; size: number }

export async function move(sb: SupabaseClient, world: World): Promise<void> {
  const atlas = readAtlas();
  const S = world.size;
  // Only the bands that hold one of the regions this move touches.
  const regionRow = (x: number, y: number): number => regionAt(atlas, x, y, S);
  const step = Math.max(1, S >> 10);
  let yLo = S, yHi = -1, xLo = S, xHi = -1;
  for (let y = 0; y < S; y += step) for (let x = 0; x < S; x += step) {
    const r = regionRow(x, y);
    if (!ROCK_REGIONS.has(r) && !TREE_REGIONS.has(r)) continue;
    yLo = Math.min(yLo, y); yHi = Math.max(yHi, y + step - 1);
    xLo = Math.min(xLo, x); xHi = Math.max(xHi, x + step - 1);
  }
  if (yHi < 0) return;
  yHi = Math.min(S - 1, yHi); xHi = Math.min(S - 1, xHi);

  // The tiles the record already covers, whose tree is what people made it.
  const told = new Set<number>();
  for (let from = 0; ; ) {
    const { data, error } = await sb.from('tile_change')
      .select('x, y, n').eq('world_id', world.id).gt('n', from).order('n').limit(10000);
    if (error) throw new Error(`could not read the record: ${error.message}`);
    const rows = (data ?? []) as Array<{ x: number; y: number; n: number }>;
    if (!rows.length) break;
    for (const r of rows) told.add(r.y * S + r.x);
    from = rows[rows.length - 1].n;
  }

  let rockN = 0, treeN = 0;
  const kinds = new Map<string, number>();
  const tally = (k: string): void => { kinds.set(k, (kinds.get(k) ?? 0) + 1); };
  const w = xHi - xLo + 1;
  for (let y0 = yLo; y0 <= yHi; y0 += BAND) {
    const h = Math.min(BAND, yHi + 1 - y0);
    const { data: land, error } = await sb.from('land_tile')
      .select('y, tiles, data, rock').eq('world_id', world.id).gte('y', y0).lt('y', y0 + h);
    if (error) throw new Error(`could not read the land at ${y0}: ${error.message}`);
    const win = generateAtlasWindow(world.seed, atlas, xLo, y0, w, h, S);
    for (const row of (land ?? []) as Row[]) {
      const j = row.y - y0;
      const tiles = bytes(row.tiles), data = bytes(row.data), rock = bytes(row.rock);
      const rockX: number[] = [], rockTo: number[] = [];
      const treeX: number[] = [], treeFrom: number[] = [], treeTo: number[] = [];
      for (let x = xLo; x <= xHi; x++) {
        const r = regionRow(x, row.y);
        const k = j * w + (x - xLo);
        if (ROCK_REGIONS.has(r) && win.rock[k] !== rock[x]) {
          rockX.push(x); rockTo.push(win.rock[k]);
          tally(`rock ${ROCK_VARIANTS[rock[x]]?.name ?? rock[x]} -> ${ROCK_VARIANTS[win.rock[k]].name}`);
        }
        if (!TREE_REGIONS.has(r) || told.has(row.y * S + x)) continue;
        if (tiles[x] !== TileType.Tree || win.tiles[k] !== TileType.Tree) continue;
        const had = treeSpecies(data[x]), now = treeSpecies(win.data[k]);
        if (had === now || (had !== PLUM && now !== PLUM)) continue;
        treeX.push(x); treeFrom.push(data[x]); treeTo.push(packTreeData(now, treeVariant(data[x])));
        tally(`tree ${TREE_DEFS[had].name} -> ${TREE_DEFS[now].name}`);
      }
      if (!rockX.length && !treeX.length) continue;
      const { data: n, error: we } = await sb.rpc('land_regrow_row', {
        p_world: world.id, p_y: row.y, p_rock_x: rockX, p_rock: rockTo,
        p_tree_x: treeX, p_tree_from: treeFrom, p_tree_to: treeTo, p_tree: TileType.Tree,
      });
      if (we) throw new Error(`could not write row ${row.y}: ${we.message}`);
      rockN += rockX.length;
      treeN += Math.max(0, Number(n ?? 0) - rockX.length);
    }
    process.stdout.write(`  ${y0 - yLo}/${yHi - yLo}\r`);
  }
  // The packed windows were cut from the old ground.
  const { error: ce } = await sb.from('land_chunk').delete().eq('world_id', world.id);
  if (ce) throw new Error(`could not forget the land chunks: ${ce.message}`);
  const { error: le } = await sb.from('land_move').insert({ world_id: world.id, move: MOVE, rock: rockN, trees: treeN });
  if (le) throw new Error(`could not record the move: ${le.message}`);
  console.log(`${world.name}: ${rockN} rock and ${treeN} trees moved`);
  for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(8)}  ${k}`);
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL || PROJECT.url;
  const key = process.env.SUPABASE_KEY || '';
  if (!key) throw new Error('SUPABASE_KEY must be the project service key: this reads and writes land.');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: worlds, error } = await sb.from('world').select('id, name, seed, size').eq('ready', true);
  if (error) throw new Error(`could not read the worlds: ${error.message}`);
  const { data: done, error: de } = await sb.from('land_move').select('world_id').eq('move', MOVE);
  if (de) throw new Error(`could not read the moves: ${de.message}`);
  const had = new Set(((done ?? []) as Array<{ world_id: string }>).map((d) => d.world_id));
  const todo = ((worlds ?? []) as World[]).filter((w) => !had.has(w.id));
  console.log(`${MOVE}: ${todo.length} of ${(worlds ?? []).length} islands to move`);
  for (const w of todo) await move(sb, w);
}

// Left alone when a test brings `move` in with a client of its own.
if (process.env.MOVE_GROUND_TEST !== '1') main().catch((e: unknown) => { console.error(String(e)); process.exit(1); });
