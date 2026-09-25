/**
 * A cheaper stir.
 *
 * Asked for: "A cheaper world tick ... Move creatures near a player every
 * second and the rest in coarse steps." A round swept everything heading
 * within 104 tiles of every body, against the 40 a browser is shown, and it
 * was 94% of a round on the live island.
 *
 * What this asks, on a small island with one body on it and a second, asleep,
 * seventy tiles off:
 *
 *   * the every-round sweep takes a wild creature ten tiles from the body
 *     and leaves one seventy tiles off standing, due as it is;
 *   * the sweep of the tame takes a crated creature seventy tiles off, and
 *     still leaves the wild one there standing;
 *   * a crated creature, once settled, is not due again for `stored_settle()`
 *     seconds, where it used to be due the very next round;
 *   * and a whole round of the clock, whichever second it falls on, leaves the
 *     far wild creature standing.
 *
 * Runs against the database the suite leaves behind; everything it makes is
 * given up at the end.
 */
import { execFileSync } from 'node:child_process';
import { generateWorld } from '../../src/world/generate';
import { rowsOf, type LandRow } from '../../src/net/landpack';

const SIZE = 192;
const SEED = 5151;
const WHO = '55555555-5555-5555-5555-555555555555';
const ASLEEP = '55555555-5555-5555-5555-5555555555aa';

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
    maxBuffer: 256 * 1024 * 1024,
  }).trim();

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const gen = generateWorld(SEED, SIZE);
const id = psql(`select rpc_found('A cheaper stir', ${SEED}, ${SIZE}, ${gen.spawn.x}, ${gen.spawn.y})`);
try {
  for (let y = 0; y <= gen.world.h; y += 32) {
    const batch: LandRow[] = rowsOf(gen.world, y, Math.min(gen.world.h, y + 31));
    psql(`select rpc_put_land('${id}', $j$${JSON.stringify(batch)}$j$::jsonb)`);
  }
  psql(`select rpc_ready('${id}')`);
  psql(`select rpc_join('${id}', 'Stirrer')`);
  const [sx, sy] = psql(`select x || '|' || y from player where world_id = '${id}' and uid = '${WHO}'`).split('|').map(Number);

  /** The standable tile nearest (x, y). */
  const near = (x: number, y: number): [number, number] => {
    const at = psql(`select tx || '|' || ty from generate_series(0, ${SIZE - 1}) tx, generate_series(0, ${SIZE - 1}) ty
      where creature_tile_ok('${id}', tx, ty) order by (tx - ${x}) ^ 2 + (ty - ${y}) ^ 2 limit 1`);
    return at.split('|').map(Number) as [number, number];
  };
  const far = sx + 70 < SIZE ? sx + 70 : sx - 70;
  const [nx, ny] = near(sx + 10, sy);
  const [fx, fy] = near(far, sy);
  psql(`delete from creature where world_id = '${id}'`);
  const spawn = (x: number, y: number): number => Number(psql(`select creature_spawn('${id}', 'rabba', ${x + 0.5}, ${y + 0.5})`));
  const wildNear = spawn(nx, ny);
  const wildFar = spawn(fx, fy);
  const crated = spawn(fx, fy);
  // The crated one is somebody else's, asleep seventy tiles off with it in their pack.
  psql(`insert into player (world_id, uid, name, x, y, away) values ('${id}', '${ASLEEP}', 'Sleeper', ${fx + 0.5}, ${fy + 0.5}, true);
        update creature set mode = 'stored', keeper = '${ASLEEP}' where world_id = '${id}' and id = ${crated};`);
  const due = `update creature set until = now() - interval '1 second' where world_id = '${id}'`;
  const isDue = (c: number): boolean => psql(`select until <= now() from creature where world_id = '${id}' and id = ${c}`) === 't';

  psql(due);
  psql(`select creature_sweep('${id}', ${sx}, ${sy}, 40, null, stir_slack())`);
  check('every round, a wild creature ten tiles from the body is walked', !isDue(wildNear));
  check('and one seventy tiles off stands where it is', isDue(wildFar));
  check('and so, that round, does a crated one seventy tiles off', isDue(crated));

  psql(`select creature_sweep('${id}', ${sx}, ${sy}, 40, null, null, true)`);
  check('the sweep of the tame takes the crated one seventy tiles off', !isDue(crated));
  check('and still leaves the wild one there standing', isDue(wildFar));
  const wait = Number(psql(`select round(extract(epoch from until - now())) from creature where world_id = '${id}' and id = ${crated}`));
  const stored = Number(psql(`select stored_settle()`));
  check(`a crated one is next due in ${stored} seconds, not the next round`, Math.abs(wait - stored) <= 1, `${wait} s`);

  /*
   * And a whole round. A round serves islands in turn within its budget, and
   * the suite leaves plenty of others with somebody on them, so this one is
   * the only island awake for it: everybody else is sent to sleep inside a
   * transaction that is rolled back.
   */
  const round = psql(`begin;
    update player set away = true where world_id <> '${id}';
    update player set seen_at = now(), away = false where world_id = '${id}' and uid = '${WHO}';
    ${due};
    select world_tick() \\g /dev/null
    select (select until <= now() from creature where world_id = '${id}' and id = ${wildFar})
       || '|' || (select until <= now() from creature where world_id = '${id}' and id = ${wildNear});
    rollback;`).split('\n').pop() ?? '';
  const [farStill, nearStill] = round.split('|');
  check('a whole round of the clock leaves the far wild one standing', farStill === 'true', round);
  check('and walks the near one', nearStill === 'false', round);
} finally {
  psql(`select rpc_abandon('${id}')`);
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a cheaper stir — ${ok.length} of ${ok.length}`);
