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
 * Three moves, each carrying only what it changed:
 *
 *  - `move`: the rock under the Northeast Tundra and West Skerry, written as the
 *    generator has it now (nothing writes rock after founding, so every
 *    difference there is the move); and trees on the tundra and East Isle where
 *    a plum is involved, on tiles nobody has touched, keeping their age.
 *  - `clearTrees`: on an island where no tree grows of itself, the trees nobody
 *    has touched come off and the tile goes back to what the generator lays
 *    there now. Planted ones are in `tile_change` and stay.
 *  - `goldOff`: gold seams anywhere but under the Northeast Tundra's mountain
 *    become what the generator lays there now (iron, as any seam that belongs
 *    to another island does).
 *
 * Each island a move has done goes into `land_move`, and an island already
 * there is skipped without reading its land, so a deploy can run this every
 * time. It talks to Postgres through psql, as the deploy's other steps do,
 * because the deploy holds the database password and not a service key:
 *
 *   PGPASSWORD=... MOVE_DB_URLS="postgresql://postgres@host:5432/postgres" \
 *     npx tsx tools/move-ground.ts
 */
import { execFileSync } from 'node:child_process';
import { generateAtlasWindow, regionAt } from '../src/world/atlas-world';
import { REGIONS } from '../src/world/regions';
import { packTreeData, ROCK_VARIANTS, TileType, TREE_DEFS, treeSpecies, treeVariant } from '../src/world/tiles';
import { readAtlas } from './atlas-node';

/** Rows of land read and written at a time. */
const BAND = 64;

/** One round trip: the statements in, the rows out, fields split on tabs. */
export type Sql = (text: string) => string[][];

/** psql against the first address that answers, kept once one has. */
export function psql(urls: string[]): Sql {
  let chosen: string | null = null;
  return (text) => {
    const tries = chosen ? [chosen] : urls;
    let last: unknown = null;
    for (const url of tries) {
      try {
        const out = execFileSync('psql', [url, '-X', '-q', '-t', '-A', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
          { input: text, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'] });
        chosen = url;
        return out.split('\n').filter((l) => l.length).map((l) => l.split('\t'));
      } catch (e) {
        last = e;
        if (chosen) break;
      }
    }
    throw new Error(`psql failed: ${String((last as { stderr?: string })?.stderr ?? last)}`);
  };
}

const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const arr = (xs: number[]): string => `array[${xs.join(',')}]::int[]`;
const hexBytes = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'));

export interface World { id: string; name: string; seed: number; size: number }

const regionNamed = (key: string): number => REGIONS.findIndex((R) => R.key === key);
const PLUM = TREE_DEFS.findIndex((t) => t.name === 'Plum');
const GOLD = ROCK_VARIANTS.findIndex((r) => r.yields === 'gold_ore');

/** The rows of land from y0 for h rows, by y: the columns asked for, unpacked. */
function readBand(sql: Sql, world: World, y0: number, h: number, cols: Array<'tiles' | 'data' | 'rock'>): Map<number, Record<string, Uint8Array>> {
  const rows = sql(`select y, ${cols.map((c) => `encode(${c}, 'hex')`).join(', ')} from land_tile
    where world_id = ${lit(world.id)} and y >= ${y0} and y < ${y0 + h} order by y;`);
  const out = new Map<number, Record<string, Uint8Array>>();
  for (const r of rows) {
    const rec: Record<string, Uint8Array> = {};
    cols.forEach((c, i) => { rec[c] = hexBytes(r[i + 1]); });
    out.set(Number(r[0]), rec);
  }
  return out;
}

/** Every tile the record covers: the ones whose ground people made. */
function touched(sql: Sql, world: World): Set<number> {
  const told = new Set<number>();
  for (const [x, y] of sql(`select x, y from tile_change where world_id = ${lit(world.id)};`)) told.add(Number(y) * world.size + Number(x));
  return told;
}

/** The rows and columns that hold any of these regions, sampled off the chart. */
function boundsOf(world: World, regions: Set<number>): { xLo: number; xHi: number; yLo: number; yHi: number } | null {
  const atlas = readAtlas();
  const S = world.size;
  const step = Math.max(1, S >> 10);
  let yLo = S, yHi = -1, xLo = S, xHi = -1;
  for (let y = 0; y < S; y += step) for (let x = 0; x < S; x += step) {
    if (!regions.has(regionAt(atlas, x, y, S))) continue;
    yLo = Math.min(yLo, y); yHi = Math.max(yHi, y + step - 1);
    xLo = Math.min(xLo, x); xHi = Math.max(xHi, x + step - 1);
  }
  return yHi < 0 ? null : { xLo, xHi: Math.min(S - 1, xHi), yLo, yHi: Math.min(S - 1, yHi) };
}

/** A band's writes in one transaction, and what they changed between them. */
function writeBand(sql: Sql, statements: string[]): number {
  if (!statements.length) return 0;
  const got = sql(`begin;\nset local lock_timeout = '5s';\nselect coalesce(sum(n), 0) from (\n${statements.join('\nunion all\n')}\n) w(n);\ncommit;`);
  return Number(got[0]?.[0] ?? 0);
}

/** The packed windows were cut from the old ground; and the move is down in the ledger. */
function finish(sql: Sql, world: World, name: string, rock: number, trees: number): void {
  sql(`${rock + trees > 0 ? `delete from land_chunk where world_id = ${lit(world.id)};\n` : ''}insert into land_move (world_id, move, rock, trees)
    values (${lit(world.id)}, ${lit(name)}, ${rock}, ${trees}) on conflict do nothing;`);
}

export const MOVE = '2026-10-08 glimmersteel to West Skerry, plum to East Isle, a bare tundra';
export function move(sql: Sql, world: World): string {
  const ROCK_REGIONS = new Set(['NortheastTundra', 'WestSkerry'].map(regionNamed));
  const TREE_REGIONS = new Set(['NortheastTundra', 'EastIsle'].map(regionNamed));
  const b = boundsOf(world, new Set([...ROCK_REGIONS, ...TREE_REGIONS]));
  let rockN = 0, treeN = 0;
  if (b) {
    const atlas = readAtlas();
    const S = world.size;
    const told = touched(sql, world);
    const w = b.xHi - b.xLo + 1;
    for (let y0 = b.yLo; y0 <= b.yHi; y0 += BAND) {
      const h = Math.min(BAND, b.yHi + 1 - y0);
      const land = readBand(sql, world, y0, h, ['tiles', 'data', 'rock']);
      const win = generateAtlasWindow(world.seed, atlas, b.xLo, y0, w, h, S);
      const statements: string[] = [];
      for (const [y, row] of land) {
        const j = y - y0;
        const rockX: number[] = [], rockTo: number[] = [];
        const treeX: number[] = [], treeFrom: number[] = [], treeTo: number[] = [];
        for (let x = b.xLo; x <= b.xHi; x++) {
          const r = regionAt(atlas, x, y, S);
          const k = j * w + (x - b.xLo);
          if (ROCK_REGIONS.has(r) && win.rock[k] !== row.rock[x]) { rockX.push(x); rockTo.push(win.rock[k]); }
          if (!TREE_REGIONS.has(r) || told.has(y * S + x)) continue;
          if (row.tiles[x] !== TileType.Tree || win.tiles[k] !== TileType.Tree) continue;
          const had = treeSpecies(row.data[x]), now = treeSpecies(win.data[k]);
          if (had === now || (had !== PLUM && now !== PLUM)) continue;
          treeX.push(x); treeFrom.push(row.data[x]); treeTo.push(packTreeData(now, treeVariant(row.data[x])));
        }
        if (!rockX.length && !treeX.length) continue;
        rockN += rockX.length;
        treeN += treeX.length;
        statements.push(`select land_regrow_row(${lit(world.id)}, ${y}, ${arr(rockX)}, ${arr(rockTo)}, ${arr(treeX)}, ${arr(treeFrom)}, ${arr(treeTo)}, ${TileType.Tree})`);
      }
      writeBand(sql, statements);
    }
  }
  finish(sql, world, MOVE, rockN, treeN);
  return `${world.name}: ${rockN} rock and ${treeN} trees moved`;
}

export const CLEAR = '2026-10-08 the Northeast Tundra treeless';
export function clearTrees(sql: Sql, world: World): string {
  const TREELESS = new Set(REGIONS.map((R, i) => (R.treeless ? i : -1)).filter((i) => i >= 0));
  const b = boundsOf(world, TREELESS);
  let cleared = 0;
  if (b) {
    const atlas = readAtlas();
    const S = world.size;
    const told = touched(sql, world);
    const w = b.xHi - b.xLo + 1;
    for (let y0 = b.yLo; y0 <= b.yHi; y0 += BAND) {
      const h = Math.min(BAND, b.yHi + 1 - y0);
      const land = readBand(sql, world, y0, h, ['tiles', 'data']);
      const win = generateAtlasWindow(world.seed, atlas, b.xLo, y0, w, h, S);
      const statements: string[] = [];
      for (const [y, row] of land) {
        const j = y - y0;
        const xs: number[] = [], fromT: number[] = [], fromD: number[] = [], toT: number[] = [], toD: number[] = [];
        for (let x = b.xLo; x <= b.xHi; x++) {
          if (row.tiles[x] !== TileType.Tree || told.has(y * S + x) || !TREELESS.has(regionAt(atlas, x, y, S))) continue;
          const k = j * w + (x - b.xLo);
          if (win.tiles[k] === TileType.Tree) continue;
          xs.push(x); fromT.push(row.tiles[x]); fromD.push(row.data[x]); toT.push(win.tiles[k]); toD.push(win.data[k]);
        }
        if (xs.length) statements.push(`select land_regrow_face(${lit(world.id)}, ${y}, ${arr(xs)}, ${arr(fromT)}, ${arr(fromD)}, ${arr(toT)}, ${arr(toD)})`);
      }
      cleared += writeBand(sql, statements);
    }
  }
  finish(sql, world, CLEAR, 0, cleared);
  return `${world.name}: ${cleared} trees taken off where none grow of themselves`;
}

export const GOLD_MOVE = '2026-10-08 gold only under the Northeast Tundra';
export function goldOff(sql: Sql, world: World): string {
  const atlas = readAtlas();
  const S = world.size;
  let moved = 0;
  for (let y0 = 0; y0 < S; y0 += BAND) {
    const h = Math.min(BAND, S - y0);
    const land = readBand(sql, world, y0, h, ['rock']);
    const withGold = [...land].filter(([, r]) => r.rock.includes(GOLD));
    if (!withGold.length) continue;
    const win = generateAtlasWindow(world.seed, atlas, 0, y0, S, h, S);
    const statements: string[] = [];
    for (const [y, { rock }] of withGold) {
      const j = y - y0;
      const xs: number[] = [], to: number[] = [];
      for (let x = 0; x < S; x++) {
        if (rock[x] !== GOLD || win.rock[j * S + x] === GOLD) continue;
        xs.push(x); to.push(win.rock[j * S + x]);
      }
      if (xs.length) statements.push(`select land_regrow_row(${lit(world.id)}, ${y}, ${arr(xs)}, ${arr(to)}, ${arr([])}, ${arr([])}, ${arr([])}, ${TileType.Tree})`);
    }
    moved += writeBand(sql, statements);
  }
  finish(sql, world, GOLD_MOVE, moved, 0);
  return `${world.name}: ${moved} gold seams off the islands that no longer hold gold`;
}

export const MOVES: Array<[string, (sql: Sql, world: World) => string]> = [[MOVE, move], [CLEAR, clearTrees], [GOLD_MOVE, goldOff]];

/** Every move not yet made, on every island that is open. */
export function moveAll(sql: Sql): void {
  const worlds = sql('select id, name, seed, size from world where ready;')
    .map(([id, name, seed, size]) => ({ id, name, seed: Number(seed), size: Number(size) }));
  for (const [name, run] of MOVES) {
    const done = new Set(sql(`select world_id from land_move where move = ${lit(name)};`).map((r) => r[0]));
    const todo = worlds.filter((w) => !done.has(w.id));
    console.log(`${name}: ${todo.length} of ${worlds.length} islands to move`);
    for (const w of todo) console.log(`  ${run(sql, w)}`);
  }
}

// Left alone when a test brings the moves in with a database of its own.
if (process.env.MOVE_GROUND_TEST !== '1') {
  const urls = (process.env.MOVE_DB_URLS ?? '').split(/\s+/).filter(Boolean);
  if (!urls.length) {
    console.error('MOVE_DB_URLS must name the database, with the password in PGPASSWORD.');
    process.exit(1);
  }
  try {
    moveAll(psql(urls));
  } catch (e) {
    console.error(String(e));
    process.exit(1);
  }
}
