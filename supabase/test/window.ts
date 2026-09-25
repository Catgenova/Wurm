/**
 * Two roads to the same island: the land read, against the history replayed.
 *
 * A joining browser has always worked the island out from its seed and then
 * laid every row of `tile_change` over the top. That is correct and it is
 * unbounded: `compact_changes` settles the table at about one row per tile
 * anybody has ever touched, so a join costs the *area that has been worked*
 * and the number only ever climbs. A live island reached a hundred and
 * twenty-six thousand rows and twenty-five seconds of reading them.
 *
 * The other road is to read the land as it currently stands, which the island
 * has kept in `land_tile` and `land_corner` since the rules moved into
 * Postgres. That costs what the square *is* and not what was done to it.
 *
 * Two roads to one place is the thing this island has been bitten by more than
 * any other: a number written twice is a number that drifts. So this drives
 * both, over the same island, with the same digging done to it, and compares
 * the two worlds byte for byte. It also checks the seam that makes the swap
 * safe — the cursor the window is read at comes *before* the land, so a change
 * that lands in between is replayed as well as read rather than lost between
 * them.
 */
import { execFileSync } from 'node:child_process';
import { generateWorld } from '../../src/world/generate';
import { rowsOf, layRows, layChange, blankWorld, type LandRow, type TileChange } from '../../src/net/landpack';
import { LAND_NEAR } from '../../src/game/keep';

const SIZE = 96;
const SEED = 4242;
const WHO = '33333333-3333-3333-3333-333333333333';

const psql = (sql: string): string =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'], {
    env: {
      ...process.env,
      PGHOST: process.env.PGHOST ?? '/var/run/postgresql',
      PGPORT: process.env.PGPORT ?? '5433',
      PGUSER: process.env.PGUSER ?? 'wurm',
      PGDATABASE: process.env.PGDATABASE ?? 'postgres',
    },
    input: `select set_config('request.jwt.claims', '{"sub":"${WHO}"}', false) \\g /dev/null\n${sql}\n`,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  }).trim();

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

/* ---- An island, handed over and opened ---------------------------------- */

const gen = generateWorld(SEED, SIZE);
const world = gen.world;
const id = psql(`select rpc_found('Two roads', ${SEED}, ${SIZE}, ${gen.spawn.x}, ${gen.spawn.y})`);
for (let y = 0; y <= world.h; y += 32) {
  const batch: LandRow[] = rowsOf(world, y, Math.min(world.h, y + 31));
  psql(`select rpc_put_land('${id}', $j$${JSON.stringify(batch)}$j$::jsonb)`);
}
psql(`select rpc_ready('${id}')`);
// Somebody has to be standing on it: the window door answers a body, not a
// stranger who knows the island's name.
psql(`select rpc_join('${id}', 'Two roads')`);

/* ---- Some digging, written the island's own way ------------------------- */

/**
 * The pair every rule on the island uses: move the land, then say so. A write
 * without the announcement is drift nobody can see, which is why `land_announce`
 * is not optional and why 859 counts the rows it writes.
 */
const dig = (x: number, y: number, by: number): void => {
  psql([
    `select land_set_tile('${id}', ${x}, ${y}, ${(x * 7 + y) % 5 + 1})`,
    `select land_set_data('${id}', ${x}, ${y}, ${(x + y) % 3})`,
    ...[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].flatMap(([cx, cy]) => [
      `select land_set_height('${id}', ${cx}, ${cy}, ${world.getHeight(cx, cy) - by})`,
      `select land_set_dirt('${id}', ${cx}, ${cy}, ${Math.max(0, world.getDirt(cx, cy) - by)})`,
    ]),
    `select land_announce('${id}', ${x}, ${y})`,
  ].join(';\n'));
};

const dugAt: Array<[number, number]> = [];
for (let i = 0; i < 24; i++) {
  const x = (i * 13 + 5) % (SIZE - 2);
  const y = (i * 29 + 11) % (SIZE - 2);
  dugAt.push([x, y]);
  dig(x, y, 3 + (i % 7));
}
const changes = Number(psql(`select count(*) from tile_change where world_id = '${id}'`));
check('the digging is in the record', changes === dugAt.length, `${changes} rows for ${dugAt.length} spadefuls`);

/* ---- Road one: the seed, and every row of the history over it ----------- */

const replayed = generateWorld(SEED, SIZE).world;
const rows = JSON.parse(psql(
  `select coalesce(jsonb_agg(jsonb_build_object('x',x,'y',y,'tile',tile,'data',data,'corners',corners,'soil',soil) order by n), '[]')::text
     from tile_change where world_id = '${id}'`)) as TileChange[];
let laidChanges = 0;
for (const c of rows) if (layChange(replayed, c)) laidChanges += 1;
check('the history lays onto the generated island', laidChanges === changes, `${laidChanges} of ${changes}`);

/* ---- Road two: the island's own land, read through the window door ------ */

const readWorld = blankWorld(SIZE, SEED);
const win = JSON.parse(psql(`select rpc_land_window('${id}', 0, 0, ${SIZE - 1}, ${SIZE - 1})::text`)) as
  { n: number; x0: number; y0: number; x1: number; y1: number; rows: LandRow[] };
const laidRows = layRows(readWorld, win.rows);
check('the window covers the island it was asked for',
  win.x0 === 0 && win.y0 === 0 && win.x1 === SIZE - 1 && win.y1 === SIZE - 1 && laidRows === SIZE + 1,
  `${win.x0},${win.y0} to ${win.x1},${win.y1} in ${laidRows} rows`);

/* ---- And whether they are the same island ------------------------------- */

const same = (a: ArrayLike<number>, b: ArrayLike<number>, what: string): void => {
  if (a.length !== b.length) {
    check(`${what} agree`, false, `lengths differ, ${a.length} against ${b.length}`);
    return;
  }
  let first = -1;
  let wrong = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (first < 0) first = i;
      wrong += 1;
    }
  }
  check(`${what} agree`, wrong === 0,
    wrong ? `${wrong} of ${a.length} differ, first at ${first}: replayed ${a[first]}, read ${b[first]}`
          : `all ${a.length} the same`);
};
same(replayed.heights, readWorld.heights, 'heights');
same(replayed.dirt, readWorld.dirt, 'soil   ');
same(replayed.tiles, readWorld.tiles, 'tiles  ');
same(replayed.data, readWorld.data, 'data   ');
same(replayed.rock, readWorld.rock, 'rock   ');

/* ---- A box rather than a band ------------------------------------------ */

const boxWorld = blankWorld(SIZE, SEED);
const box = JSON.parse(psql(`select rpc_land_window('${id}', 20, 30, 59, 69)::text`)) as
  { rows: LandRow[]; x0: number; y0: number; x1: number; y1: number };
layRows(boxWorld, box.rows);
let inside = 0;
let spilled = 0;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = y * SIZE + x;
    if (x >= 20 && x <= 59 && y >= 30 && y <= 69) {
      if (boxWorld.tiles[i] === replayed.tiles[i] && boxWorld.getHeight(x, y) === replayed.getHeight(x, y)) inside += 1;
    } else if (boxWorld.tiles[i] !== 0) {
      // Laid into a blank world, so anything outside the box that is not still
      // nought is a row written at the wrong offset — which would look like
      // terrain rather than like a bug.
      spilled += 1;
    }
  }
}
check('a box lays inside itself and nowhere else', inside === 40 * 40 && spilled === 0,
  `${inside} of ${40 * 40} tiles inside it are the island's, and ${spilled} tiles outside it were written`);

/* ---- The seam: the cursor comes before the land ------------------------- */

/*
 * The window was read at cursor `n`. Dig again *after* that read, then replay
 * from `n` the way a joining browser does, and the new spadeful has to arrive:
 * if the island took its cursor after reading the land instead, this change
 * would be in neither half and the tile would stay wrong until somebody dug it
 * again.
 */
const [lx, ly] = [7, 9];
dig(lx, ly, 11);
const after = JSON.parse(psql(
  `select coalesce(jsonb_agg(jsonb_build_object('x',x,'y',y,'tile',tile,'data',data,'corners',corners,'soil',soil) order by n), '[]')::text
     from tile_change where world_id = '${id}' and n > ${win.n}`)) as TileChange[];
for (const c of after) layChange(readWorld, c);
const island = psql(`select land_height('${id}',${lx},${ly}) || ' ' || land_tile('${id}',${lx},${ly})`);
const browser = `${readWorld.getHeight(lx, ly)} ${readWorld.getTile(lx, ly)}`;
check('a spadeful turned after the land was read still arrives', island === browser,
  `the island says "${island}", the browser that read and then caught up says "${browser}" (${after.length} row past the cursor)`);

/* ---- And what it will not hand over ------------------------------------- */

const refused = (sql: string): string => {
  try {
    psql(sql);
    return 'ALLOWED';
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? e).split('\n').find((l) => l.includes('ERROR'))?.trim() ?? 'refused';
  }
};
/*
 * The cap only bites on an island big enough to reach it, and this one is
 * ninety-six tiles across — every ask on it clamps to the shore long before
 * `land_ask`. So: a big island with a body on it and no land handed over at
 * all, because the cap is checked before a byte of land is read.
 */
const huge = psql(`insert into world (name, seed, size, spawn_x, spawn_y, ready)
                   values ('Too much', 1, 4096, 1, 1, true) returning id`);
psql(`insert into player (world_id, uid, name, x, y) values ('${huge}', '${WHO}', 'Two roads', 1.5, 1.5)`);
const big = refused(`select rpc_land_window('${huge}', 0, 0, 4095, 4095) \\g /dev/null`);
check('the whole of a big island is not one ask', big !== 'ALLOWED', big.slice(0, 96));
const fits = refused(`select rpc_land_window('${huge}', 0, 0, ${400 - 1}, ${400 - 1}) \\g /dev/null`);
check('and a square of land_ask a side is', fits === 'ALLOWED', fits.slice(0, 96));
const stranger = refused(
  `select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', false) \\g /dev/null
   select rpc_land_window('${id}', 0, 0, 8, 8) \\g /dev/null`);
check('and not to somebody who is not on the island', stranger !== 'ALLOWED', stranger.slice(0, 96));

/* ---- What it cost ------------------------------------------------------- */

const wire = Number(psql(`select length(rpc_land_window('${id}', 0, 0, ${SIZE - 1}, ${SIZE - 1})::text)`));
const history = Number(psql(
  `select coalesce(sum(length(jsonb_build_object('n',n,'x',x,'y',y,'tile',tile,'data',data,'corners',corners,'soil',soil)::text)), 0)
     from tile_change where world_id = '${id}'`));
/*
 * Both numbers, and which way round they come is the point rather than the
 * winner. This island is ninety-six tiles across with twenty-five spadefuls
 * turned on it, so its history is far the cheaper road — of course it is,
 * almost nothing has happened. One of these two numbers is what the land *is*
 * and does not move; the other is what has been *done* to it and only ever
 * climbs. The live island crossed over long ago: a hundred and twenty-six
 * thousand rows against a megabyte a window.
 */
const perTile = wire / (SIZE * SIZE);
const perSpadeful = history / (changes + 1);
// The square a join actually reads, and the history a join actually reads:
// one is a square round the body, the other is the whole island's, wherever
// the body happens to be standing.
const near = (LAND_NEAR * 2 + 1) ** 2 * perTile;
const LIVE = 126396;
console.log(`\n  ${SIZE}x${SIZE} island, ${changes + 1} spadefuls turned`);
console.log(`  land:    ${perTile.toFixed(1)} bytes a tile, so the ${LAND_NEAR * 2 + 1}-tile square a join reads is ${(near / 1048576).toFixed(2)} MB`);
console.log(`  history: ${perSpadeful.toFixed(0)} bytes a spadeful, and a join reads every one of them wherever it stands`);
console.log(`  so at the ${LIVE.toLocaleString()} the live island is carrying: ${(LIVE * perSpadeful / 1048576).toFixed(1)} MB of history against ${(near / 1048576).toFixed(2)} MB of land`);
console.log('  the land number does not move. The other one is what a morning of paving adds to.');

/* ---- The history lets go, and says how far ------------------------------ */

/*
 * Changes are kept for `change_keep()` and then let go of, oldest first, with
 * `world.changes_from` saying how far. Backdate the older half of the digging
 * past the keep and sweep: that half has gone, `changes_from` is the last of
 * it, and the newer half is all still there.
 */
const total = Number(psql(`select count(*) from tile_change where world_id = '${id}'`));
const half = Number(psql(
  `select n from tile_change where world_id = '${id}' order by n offset ${Math.floor(total / 2) - 1} limit 1`));
psql(`update tile_change set at = now() - make_interval(secs => change_keep() + 60)
        where world_id = '${id}' and n <= ${half}`);
const letGo = Number(psql(`select compact_changes('${id}')`));
const from = Number(psql(`select changes_from from world where id = '${id}'`));
const kept = Number(psql(`select count(*) from tile_change where world_id = '${id}'`));
const oldest = Number(psql(`select min(n) from tile_change where world_id = '${id}'`));
check('an hour-old change is let go of, and the island says how far',
  letGo === Math.floor(total / 2) && from === half && kept === total - letGo && oldest > from,
  `${letGo} of ${total} let go, changes_from ${from} for the last of them at ${half}, ${kept} kept from ${oldest}`);

/*
 * A browser that has just read the land must never be taken to be behind, and
 * once the whole history has gone there is no change left to take a cursor
 * from: the window's cursor comes up to `changes_from` rather than falling to 0.
 */
psql(`update tile_change set at = now() - make_interval(secs => change_keep() + 60) where world_id = '${id}'`);
psql(`select compact_changes('${id}')`);
const none = Number(psql(`select count(*) from tile_change where world_id = '${id}'`));
const fromAll = Number(psql(`select changes_from from world where id = '${id}'`));
const cursor = Number((JSON.parse(psql(`select rpc_land_window('${id}', 0, 0, 8, 8)::text`)) as { n: number }).n);
check('with all of it let go, a land read still starts at or past it',
  none === 0 && fromAll > from && cursor >= fromAll,
  `${none} rows left, changes_from ${fromAll}, the window's cursor ${cursor}`);

// And a browser that is behind hears about it on the beat it makes anyway.
const beat = JSON.parse(psql(`select rpc_settle(0, '${id}')::text`)) as { land_from?: number };
check('the heartbeat says how far the history has gone', beat.land_from === fromAll,
  `land_from ${beat.land_from} for changes_from ${fromAll}`);

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} went wrong` : `\nall ${ok.length} the same on both roads`);
process.exit(bad.length ? 1 : 0);
