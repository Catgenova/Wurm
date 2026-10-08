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
 * And a second: the trees nobody has touched on an island where none grow of
 * themselves, taken off and the ground under them laid as the generator lays
 * it now (`clearTrees`).
 *
 * And a third: gold seams anywhere but under the Northeast Tundra's mountain
 * become what the generator lays there now (`goldOff`).
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

const CLEAR = '2026-10-08 the Northeast Tundra treeless';
const TREELESS = new Set(REGIONS.map((R, i) => (R.treeless ? i : -1)).filter((i) => i >= 0));

/**
 * The second move: on an island where no tree grows of itself, the trees the
 * old generator put there and nobody has touched since come off, and the tile
 * goes back to what the generator lays there now. Trees people planted are in
 * `tile_change` and stay.
 */
export async function clearTrees(sb: SupabaseClient, world: World): Promise<void> {
  const atlas = readAtlas();
  const S = world.size;
  const step = Math.max(1, S >> 10);
  let yLo = S, yHi = -1, xLo = S, xHi = -1;
  for (let y = 0; y < S; y += step) for (let x = 0; x < S; x += step) {
    if (!TREELESS.has(regionAt(atlas, x, y, S))) continue;
    yLo = Math.min(yLo, y); yHi = Math.max(yHi, y + step - 1);
    xLo = Math.min(xLo, x); xHi = Math.max(xHi, x + step - 1);
  }
  let cleared = 0;
  if (yHi >= 0) {
    yHi = Math.min(S - 1, yHi); xHi = Math.min(S - 1, xHi);
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
    const w = xHi - xLo + 1;
    for (let y0 = yLo; y0 <= yHi; y0 += BAND) {
      const h = Math.min(BAND, yHi + 1 - y0);
      const { data: land, error } = await sb.from('land_tile')
        .select('y, tiles, data').eq('world_id', world.id).gte('y', y0).lt('y', y0 + h);
      if (error) throw new Error(`could not read the land at ${y0}: ${error.message}`);
      const win = generateAtlasWindow(world.seed, atlas, xLo, y0, w, h, S);
      for (const row of (land ?? []) as Array<{ y: number; tiles: string; data: string }>) {
        const j = row.y - y0;
        const tiles = bytes(row.tiles), data = bytes(row.data);
        const xs: number[] = [], fromT: number[] = [], fromD: number[] = [], toT: number[] = [], toD: number[] = [];
        for (let x = xLo; x <= xHi; x++) {
          if (tiles[x] !== TileType.Tree || told.has(row.y * S + x) || !TREELESS.has(regionAt(atlas, x, row.y, S))) continue;
          const k = j * w + (x - xLo);
          if (win.tiles[k] === TileType.Tree) continue;
          xs.push(x); fromT.push(tiles[x]); fromD.push(data[x]); toT.push(win.tiles[k]); toD.push(win.data[k]);
        }
        if (!xs.length) continue;
        const { data: n, error: we } = await sb.rpc('land_regrow_face', {
          p_world: world.id, p_y: row.y, p_x: xs, p_from_tile: fromT, p_from_data: fromD, p_tile: toT, p_data: toD,
        });
        if (we) throw new Error(`could not write row ${row.y}: ${we.message}`);
        cleared += Number(n ?? 0);
      }
      process.stdout.write(`  ${y0 - yLo}/${yHi - yLo}\r`);
    }
    const { error: ce } = await sb.from('land_chunk').delete().eq('world_id', world.id);
    if (ce) throw new Error(`could not forget the land chunks: ${ce.message}`);
  }
  const { error: le } = await sb.from('land_move').insert({ world_id: world.id, move: CLEAR, trees: cleared });
  if (le) throw new Error(`could not record the move: ${le.message}`);
  console.log(`${world.name}: ${cleared} trees taken off where none grow of themselves`);
}

const GOLD_MOVE = '2026-10-08 gold only under the Northeast Tundra';
const GOLD = ROCK_VARIANTS.findIndex((r) => r.yields === 'gold_ore');

/**
 * The third move: gold is the Northeast Tundra's alone, under its mountain, so
 * every gold seam anywhere else on an island founded before becomes what the
 * generator lays there now (iron, as any seam that belongs to another island
 * does). Nothing writes rock after founding, so every such seam is the old
 * generator's.
 */
export async function goldOff(sb: SupabaseClient, world: World): Promise<void> {
  const atlas = readAtlas();
  const S = world.size;
  let moved = 0;
  for (let y0 = 0; y0 < S; y0 += BAND) {
    const h = Math.min(BAND, S - y0);
    const { data: land, error } = await sb.from('land_tile')
      .select('y, rock').eq('world_id', world.id).gte('y', y0).lt('y', y0 + h);
    if (error) throw new Error(`could not read the land at ${y0}: ${error.message}`);
    const rows = (land ?? []) as Array<{ y: number; rock: string }>;
    const withGold = rows.map((r) => ({ y: r.y, rock: bytes(r.rock) })).filter((r) => r.rock.includes(GOLD));
    if (!withGold.length) continue;
    const win = generateAtlasWindow(world.seed, atlas, 0, y0, S, h, S);
    for (const row of withGold) {
      const j = row.y - y0;
      const xs: number[] = [], to: number[] = [];
      for (let x = 0; x < S; x++) {
        if (row.rock[x] !== GOLD || win.rock[j * S + x] === GOLD) continue;
        xs.push(x); to.push(win.rock[j * S + x]);
      }
      if (!xs.length) continue;
      const { data: n, error: we } = await sb.rpc('land_regrow_row', {
        p_world: world.id, p_y: row.y, p_rock_x: xs, p_rock: to,
        p_tree_x: [], p_tree_from: [], p_tree_to: [], p_tree: TileType.Tree,
      });
      if (we) throw new Error(`could not write row ${row.y}: ${we.message}`);
      moved += Number(n ?? 0);
    }
    process.stdout.write(`  ${y0}/${S}\r`);
  }
  if (moved) {
    const { error: ce } = await sb.from('land_chunk').delete().eq('world_id', world.id);
    if (ce) throw new Error(`could not forget the land chunks: ${ce.message}`);
  }
  const { error: le } = await sb.from('land_move').insert({ world_id: world.id, move: GOLD_MOVE, rock: moved });
  if (le) throw new Error(`could not record the move: ${le.message}`);
  console.log(`${world.name}: ${moved} gold seams off the islands that no longer hold gold`);
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL || PROJECT.url;
  const key = process.env.SUPABASE_KEY || '';
  if (!key) throw new Error('SUPABASE_KEY must be the project service key: this reads and writes land.');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: worlds, error } = await sb.from('world').select('id, name, seed, size').eq('ready', true);
  if (error) throw new Error(`could not read the worlds: ${error.message}`);
  for (const [name, run] of [[MOVE, move], [CLEAR, clearTrees], [GOLD_MOVE, goldOff]] as const) {
    const { data: done, error: de } = await sb.from('land_move').select('world_id').eq('move', name);
    if (de) throw new Error(`could not read the moves: ${de.message}`);
    const had = new Set(((done ?? []) as Array<{ world_id: string }>).map((d) => d.world_id));
    const todo = ((worlds ?? []) as World[]).filter((w) => !had.has(w.id));
    console.log(`${name}: ${todo.length} of ${(worlds ?? []).length} islands to move`);
    for (const w of todo) await run(sb, w);
  }
}

// Left alone when a test brings `move` in with a client of its own.
if (process.env.MOVE_GROUND_TEST !== '1') main().catch((e: unknown) => { console.error(String(e)); process.exit(1); });
