/**
 * An island out through the wire format, into a real Postgres, back out, and
 * laid into a fresh world — compared byte for byte against the one that left.
 *
 * This is the one seam that no amount of care can be sure of by reading: the
 * TypeScript packs little-endian pairs by taking a view of an Int16Array, and
 * `b_i16` in the migrations takes the two bytes apart by hand. Both look right.
 * Only running an island through both finds out.
 */
import { execFileSync } from 'node:child_process';
import { generateWorld } from '../../src/world/generate';
import { rowsOf, layRows, blankWorld } from '../../src/net/landpack';

const SIZE = 64;
/**
 * Everything goes down one pipe per call, with the identity re-asserted at the
 * top of it: `psql -c` is a fresh session every time, so a `set_config` in one
 * call is gone by the next and every rule answers "not signed in".
 */
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

const gen = generateWorld(1234, SIZE);
const world = gen.world;
console.log(`an island of ${SIZE}x${SIZE}, seed 1234, spawn ${gen.spawn.x}, ${gen.spawn.y}`);
console.log(`  heights ${world.heights.length} corners, ${Math.min(...world.heights)}..${Math.max(...world.heights)}`);

const id = psql(`select rpc_found('Round trip', 1234, ${SIZE}, ${gen.spawn.x}, ${gen.spawn.y})`);
console.log(`  founded as ${id}`);

let sent = 0;
for (let y = 0; y <= world.h; y += 32) {
  const batch = rowsOf(world, y, Math.min(world.h, y + 31));
  sent += Number(psql(`select rpc_put_land('${id}', $j$${JSON.stringify(batch)}$j$::jsonb)`));
}
psql(`select rpc_ready('${id}')`);
console.log(`  ${sent} rows handed over and the island opened`);

// And back out again, through the reader a joining client uses.
const back = blankWorld(SIZE, 1234);
let laid = 0;
for (let y = 0; y <= world.h; y += 64) {
  const raw = psql(`select rpc_land('${id}', ${y}, ${Math.min(world.h, y + 63)})::text`);
  laid += layRows(back, JSON.parse(raw));
}
console.log(`  ${laid} rows read back`);

const same = (a: ArrayLike<number>, b: ArrayLike<number>, what: string): boolean => {
  if (a.length !== b.length) { console.log(`  ${what}: LENGTHS DIFFER, ${a.length} vs ${b.length}`); return false; }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      console.log(`  ${what}: DIFFERS at ${i}, ${a[i]} became ${b[i]}`);
      return false;
    }
  }
  console.log(`  ${what}: all ${a.length} the same`);
  return true;
};

const ok = [
  same(world.heights, back.heights, 'heights'),
  same(world.dirt, back.dirt, 'soil   '),
  same(world.tiles, back.tiles, 'tiles  '),
  same(world.data, back.data, 'data   '),
  same(world.rock, back.rock, 'rock   '),
].every(Boolean);

// And the database's own view of a few corners, read the way a rule reads them.
const spot = (x: number, y: number): string =>
  psql(`select land_height('${id}',${x},${y}) || ' ' || land_dirt('${id}',${x},${y}) || ' ' || land_tile('${id}',${x},${y}) || ' ' || land_rock('${id}',${x},${y})`);
console.log('  the database, asked directly about four corners, against the island that left:');
for (const [x, y] of [[0, 0], [17, 5], [63, 63], [40, 31]]) {
  const mine = `${world.getHeight(x, y)} ${world.getDirt(x, y)} ${world.getTile(x, y)} ${world.rock[y * world.w + x]}`;
  console.log(`    (${x},${y})  here ${mine.padEnd(18)} there ${spot(x, y).padEnd(18)} ${mine === spot(x, y) ? 'same' : 'DIFFERENT'}`);
}
console.log(ok ? '\nthe island that came back is the island that went out' : '\nTHE ISLAND CHANGED ON THE WAY');
process.exit(ok ? 0 : 1);
