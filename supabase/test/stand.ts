/**
 * A slope you can stand on is the same slope on both sides.
 *
 * The standing cap is written twice — `standsOn` and `standSlope` in the
 * browser, `walk_share` and `creature_tile_ok` on the island — because a solo
 * world walks by the browser's rule and an island by the island's, and whoever
 * plays both should never be able to tell which. So the same dug ground is put
 * to both: a patch flat at four with one corner raised seventy and another
 * fifty, a walker at climbing nought and then fifty asking to step off the
 * flat into each, and a wild thing asked whether it would stand there.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { TileType } from '../../src/world/tiles';

const psql = (sql: string): string =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
    env: {
      ...process.env,
      PGHOST: process.env.PGHOST ?? '/var/run/postgresql',
      PGPORT: process.env.PGPORT ?? '5433',
      PGUSER: process.env.PGUSER ?? 'wurm',
      PGDATABASE: process.env.PGDATABASE ?? 'postgres',
    },
  }).trim();

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

// The same ground on both sides: flat at four from 26 to 36, the corner at
// 32,32 raised seventy (the four tiles round it seventy steep) and the corner
// at 28,32 raised fifty.
const game = Game.create(4242);
const w = game.world;
for (let y = 26; y <= 36; y++) {
  for (let x = 26; x <= 36; x++) {
    w.setHeight(x, y, 4);
    w.setDirt(x, y, 5);
    if (x < 36 && y < 36) w.setTile(x, y, TileType.Grass, 0);
  }
}
w.setHeight(32, 32, 74);
w.setHeight(28, 32, 54);
psql(`
do $$
declare w uuid; gx int; gy int;
begin
  select id into w from world where name = 'Hoarding';
  for gx in 26..36 loop for gy in 26..36 loop
    perform land_set_height(w, gx, gy, 4); perform land_set_dirt(w, gx, gy, 5);
    if gx < 36 and gy < 36 then perform land_set_tile(w, gx, gy, tile_id('Grass')); end if;
  end loop; end loop;
  perform land_set_height(w, 32, 32, 74);
  perform land_set_height(w, 28, 32, 54);
  delete from skill where world_id = w and id = 'climbing'
    and uid = (select uid from player where world_id = w and name = 'Dane');
end $$;`);
const W = `(select id from world where name = 'Hoarding')`;
const DANE = `(select uid from player where world_id = ${W} and name = 'Dane')`;

check('the ground is the same ground', psql(`select tile_slope(${W}, 31, 32) || '/' || tile_slope(${W}, 28, 32)`) === `${w.slope(31, 32)}/${w.slope(28, 32)}`,
  `seventy and fifty: island ${psql(`select tile_slope(${W}, 31, 32) || '/' || tile_slope(${W}, 28, 32)`)}, browser ${w.slope(31, 32)}/${w.slope(28, 32)}`);

// A walk off the flat into each, as the browser's step rule and the island's
// walk share each answer it: null or a share short of one is a refusal.
const walk = (x0: number, y0: number, x1: number, y1: number): [boolean, boolean] => [
  game.stepRule(x0, y0, 0, x1, y1) !== null,
  Number(psql(`select walk_share(${W}, ${DANE}, 0, ${x0 + 0.5}, ${y0 + 0.5}, ${x1 + 0.5}, ${y1 + 0.5})`)) >= 1,
];
const cap = (): [number, number] => [game.standSlope(), Number(psql(`select max_stand() + skill_of(${W}, ${DANE}, 'climbing') * climb_per_level()`))];

for (const climbing of [0, 50]) {
  game.skills.values.set('climbing', climbing);
  psql(`insert into skill (world_id, uid, id, value) select ${W}, ${DANE}, 'climbing', ${climbing}
        on conflict (world_id, uid, id) do update set value = excluded.value`);
  const [bc, ic] = cap();
  check(`at climbing ${climbing} the cap is the same`, bc === ic, `browser ${bc}, island ${ic}`);
  const [b70, i70] = walk(30, 32, 31, 32);
  check(`at climbing ${climbing} the seventy is ${b70 ? 'walked' : 'refused'} on both sides`, b70 === i70, `browser ${b70 ? 'walks' : 'refuses'}, island ${i70 ? 'walks' : 'refuses'}`);
  const [b50, i50] = walk(29, 32, 28, 32);
  check(`at climbing ${climbing} the fifty is ${b50 ? 'walked' : 'refused'} on both sides`, b50 === i50, `browser ${b50 ? 'walks' : 'refuses'}, island ${i50 ? 'walks' : 'refuses'}`);
  check(`at climbing ${climbing} the flat is walked on both sides`, walk(30, 30, 31, 30).every(Boolean));
}

// A wild thing has no climbing: sixty, and no more.
for (const [x, y, word] of [[31, 32, 'seventy'], [28, 32, 'fifty'], [31, 30, 'flat']] as const) {
  const b = game.creatures.tileOk(game, x, y);
  const i = psql(`select creature_tile_ok(${W}, ${x}, ${y})`) === 't';
  check(`a wild thing ${b ? 'would' : 'would not'} stand on the ${word}, on both sides`, b === i, `browser ${b}, island ${i}`);
}

for (const line of ok) console.log(line);
for (const line of bad) console.log(line);
console.log(bad.length === 0 ? `the slope you can stand on is the same slope on both sides (${ok.length} agreements)` : `THEY DISAGREE (${bad.length})`);
process.exit(bad.length === 0 ? 0 : 1);
