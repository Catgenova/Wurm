/**
 * Climbing that stays climbed.
 *
 * Reported: "climbing seems to level up then resets to 1, i'm assuming it's
 * not actually leveling on the server end".
 *
 * It was not. Climbing was the last trade the browser still raised for itself
 * on an island, off every step between tiles in `update`, and the island never
 * raised it at all — so there was no `climbing` row in the book the island
 * sends every beat, the next beat wrote the number back to where it started,
 * and a refresh did the same.
 *
 * So the same hillside is put to both sides. The island has to pay for it off
 * the walk it is told about, a go a step, at the browser's rate; the browser
 * has to stop paying for it wherever the island owns the body, and pay the
 * same goes where it does not. Flat ground, a slope under a third of a step, a
 * storey and a saddle teach nothing on either side.
 *
 * Runs against the database the suite leaves behind: Faraway, and Ivar on it.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { CLIMB_LEARN, CLIMB_LEARN_FROM, CLIMB_LEARN_STEEP, MAX_STEP } from '../../src/game/player';
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

const W = `(select id from world where name = 'Faraway')`;
const IVAR = `(select uid from player where world_id = ${W} and name = 'Ivar')`;

/* ---- the same ground on both sides ----------------------------------------
 * Flat at four from 6 to 40 along rows 3 to 26, and three hillsides on it,
 * each a run of corners raised a fixed amount a column so that every step
 * between the tiles on it is the same height:
 *
 *   row 5   up sixteen a column from x 10 — steps of 16, a half of `MAX_STEP`
 *   row 15  up eight a column from x 10   — steps of 8, under the third
 *   row 25  flat
 */
const BASE = 4;
const RISES: Array<[number, number]> = [[5, 16], [15, 8]];
const game = Game.create(4242);
const w = game.world;
for (let y = 3; y <= 26; y++) {
  for (let x = 6; x <= 40; x++) {
    w.setHeight(x, y, BASE);
    if (y < 26 && x < 40) w.setTile(x, y, TileType.Grass, 0);
  }
}
for (const [row, rise] of RISES) {
  for (const y of [row, row + 1]) for (let i = 0; i < 4; i++) w.setHeight(10 + i, y, BASE + rise * (i + 1));
}
psql(`
do $$
declare w uuid; u uuid; gx int; gy int;
begin
  select id into w from world where name = 'Faraway';
  select uid into u from player where world_id = w and name = 'Ivar';
  for gx in 6..40 loop for gy in 3..26 loop
    perform land_set_height(w, gx, gy, ${BASE});
    if gx < 40 and gy < 26 then perform land_set_tile(w, gx, gy, tile_id('Grass')); end if;
  end loop; end loop;
  ${RISES.map(([row, rise]) => `for gx in 0..3 loop
    perform land_set_height(w, 10 + gx, ${row}, ${BASE} + ${rise} * (gx + 1));
    perform land_set_height(w, 10 + gx, ${row + 1}, ${BASE} + ${rise} * (gx + 1));
  end loop;`).join('\n  ')}
  delete from skill where world_id = w and uid = u and id = 'climbing';
  delete from bridge where world_id = w;
  update creature set rider = null where world_id = w and rider = u;
  delete from placed where world_id = w and driver = u;
end $$;`);

check('the ground is the same ground',
  [5, 15, 25].every((row) => [9, 10, 11, 12].every((x) =>
    Number(psql(`select centre_height(${W}, ${x}, ${row})`)) === w.centerHeight(x, row))),
  `row 5 on the island ${[9, 10, 11, 12].map((x) => psql(`select centre_height(${W}, ${x}, 5)`)).join(' ')}, `
    + `in the browser ${[9, 10, 11, 12].map((x) => w.centerHeight(x, 5)).join(' ')}`);

/* ---- the numbers ---------------------------------------------------------- */
const [iFrom, iLearn, iSteep, iStep] = psql(`select climb_learn_from() || ' ' || climb_learn() || ' ' || climb_learn_steep() || ' ' || max_step()`)
  .split(' ').map(Number);
check('both sides teach a step at the same rate, from the same numbers',
  Math.abs(iFrom - CLIMB_LEARN_FROM) < 1e-9 && iLearn === CLIMB_LEARN && iSteep === CLIMB_LEARN_STEEP && iStep === MAX_STEP,
  `the island says from ${iFrom.toFixed(4)} of ${iStep}, ${iLearn} and ${iSteep} more a step; the browser ${CLIMB_LEARN_FROM.toFixed(4)} of ${MAX_STEP}, ${CLIMB_LEARN} and ${CLIMB_LEARN_STEEP}`);

/** What a step of this height is worth, by the browser's rule; nothing when it teaches nothing. */
const worth = (c: number): number | null => (c > MAX_STEP * CLIMB_LEARN_FROM ? CLIMB_LEARN + (c / MAX_STEP) * CLIMB_LEARN_STEEP : null);

/* ---- on the island --------------------------------------------------------
 * The browser tells the island where it is once a second at most, so the
 * island sees a walk as the straight line between two places and pays for the
 * steps along it. Ten seconds since the last move, so the pull-back lets the
 * whole of it stand.
 */
const climbing = (): number => Number(psql(`select skill_of(${W}, ${IVAR}, 'climbing')`));
const walkIsland = (x0: number, y0: number, x1: number, y1: number, level = 0): { was: number; now: number; at: string } => {
  psql(`update player set x = ${x0}, y = ${y0}, level = ${level}, moved_at = now() - interval '10 seconds', away = false
          where world_id = ${W} and uid = ${IVAR};`);
  const was = climbing();
  const went = JSON.parse(psql(`
    select set_config('request.jwt.claims', json_build_object('sub', ${IVAR})::text, false) \\g /dev/null
    select rpc_move(${W}, ${x1}, ${y1}, ${level})::text;`).split('\n').pop()!) as { x: number; y: number };
  return { was, now: climbing(), at: `${went.x},${went.y}` };
};

const steps = psql(`select array_to_string(walk_climbs(${W}, 9.5, 5.5, 12.5, 5.5), ' ')`).split(' ').map(Number);
check('the island reads three steps of sixteen up the hillside', steps.length === 3 && steps.every((c) => c === 16), steps.join(' '));

const up = walkIsland(9.5, 5.5, 12.5, 5.5);
/*
 * A go is rolled — 0.6 to 1.4 of the base, as every go is — so what three
 * goes come to is a range. Both ends of it, from where he started, by the
 * island's own `skill_gain_of` and the multiplier it would have applied.
 */
const range = (was: number, bases: number[]): [number, number] =>
  [0.6, 1.4].map((roll) => Number(psql(`
    select ${bases.reduce((v, b) => `(${v} + skill_gain_of(${v}, ${b} * skill_mult(${W}, ${IVAR}, 'climbing'), ${roll}))`, String(was))}`))) as [number, number];
const [lo, hi] = range(up.was, steps.map((c) => worth(c) ?? 0));
check('and walking up it through rpc_move raises climbing on the island, three goes of it',
  up.now >= lo - 1e-9 && up.now <= hi + 1e-9 && up.at === '12.5,5.5',
  `${up.was} to ${up.now.toFixed(4)}, between ${lo.toFixed(4)} and ${hi.toFixed(4)}; he stands at ${up.at}`);
check('which is a row in the skill book the island sends, and not the browser\'s number',
  psql(`select count(*) from skill where world_id = ${W} and uid = ${IVAR} and id = 'climbing' and value > 1`) === '1');

const down = walkIsland(12.5, 5.5, 9.5, 5.5);
check('and walking back down it teaches too: a step is a step either way', down.now > down.was, `${down.was.toFixed(4)} to ${down.now.toFixed(4)}`);

const gentle = walkIsland(9.5, 15.5, 12.5, 15.5);
check('a slope of steps under a third of a step teaches nothing', gentle.now === gentle.was && gentle.at === '12.5,15.5',
  `steps of ${psql(`select array_to_string(walk_climbs(${W}, 9.5, 15.5, 12.5, 15.5), ' ')`)}, against ${(MAX_STEP * CLIMB_LEARN_FROM).toFixed(2)}`);

const flat = walkIsland(9.5, 25.5, 30.5, 25.5);
check('nor twenty-one tiles of flat ground', flat.now === flat.was && flat.at === '30.5,25.5', `${flat.was.toFixed(4)} to ${flat.now.toFixed(4)}`);

const storey = walkIsland(9.5, 5.5, 12.5, 5.5, 1);
check('nor the same hillside a storey up, where the floor is flat', storey.now === storey.was, `${storey.was.toFixed(4)} to ${storey.now.toFixed(4)}`);
psql(`update player set level = 0 where world_id = ${W} and uid = ${IVAR};`);

psql(`
do $$
declare w uuid; u uuid; c int;
begin
  select id into w from world where name = 'Faraway';
  select uid into u from player where world_id = w and name = 'Ivar';
  c := creature_spawn(w, 'rabba', 9.5, 5.5, 'active', now() - interval '3 days', u);
  update creature set rider = u where world_id = w and id = c;
end $$;`);
const ridden = walkIsland(9.5, 5.5, 12.5, 5.5);
check('nor the hillside ridden: the climb is the beast\'s', ridden.now === ridden.was && ridden.at === '12.5,5.5',
  `${ridden.was.toFixed(4)} to ${ridden.now.toFixed(4)}, at ${ridden.at}`);
psql(`delete from creature where world_id = ${W} and rider = ${IVAR};`);

/* ---- in the browser ------------------------------------------------------ */
/** Walk the browser's body along tiles, a frame at a time, and note every go of climbing it pays. */
const walkBrowser = (from: [number, number], to: Array<[number, number]>): number[] => {
  const p = game.player;
  p.x = from[0] + 0.5;
  p.y = from[1] + 0.5;
  p.level = 0;
  p.path = to.map(([x, y]) => ({ x, y, level: 0 }));
  const paid: number[] = [];
  const raise = game.gainSkill.bind(game);
  game.gainSkill = (id: string, base?: number): number => {
    if (id === 'climbing') paid.push(base ?? 0);
    return raise(id, base);
  };
  for (let i = 0; i < 400 && p.path; i++) game.update(0.05);
  game.gainSkill = raise;
  return paid;
};
const hillside: Array<[number, number]> = [[10, 5], [11, 5], [12, 5]];

game.bodyFromIsland = true;
const before = game.skills.get('climbing');
const onIsland = walkBrowser([9, 5], hillside);
check('on an island the browser pays nothing for the hillside — the island pays it',
  onIsland.length === 0 && game.skills.get('climbing') === before && game.player.tileX === 12,
  `${onIsland.length} goes, climbing ${before} to ${game.skills.get('climbing')}, at ${game.player.tileX},${game.player.tileY}`);

game.bodyFromIsland = false;
const alone = walkBrowser([9, 5], hillside);
const islandBases = steps.map(worth);
check('in a game of its own it pays the same goes for the same hillside as the island does',
  alone.length === islandBases.length && alone.every((b, i) => Math.abs(b - (islandBases[i] ?? NaN)) < 1e-9),
  `browser ${alone.map((b) => b.toFixed(3)).join(' ')}, island ${islandBases.map((b) => b?.toFixed(3)).join(' ')}`);
check('and nothing for the gentle slope', walkBrowser([9, 15], [[10, 15], [11, 15], [12, 15]]).length === 0);
check('nor for flat ground', walkBrowser([9, 25], [[10, 25], [11, 25], [12, 25], [13, 25]]).length === 0);

for (const line of ok) console.log(line);
for (const line of bad) console.log(line);
console.log(bad.length === 0
  ? `climbing is paid by the island off the walk it is told about, at the browser's rate, and kept (${ok.length} of ${ok.length})`
  : `CLIMBING IS NOT KEPT (${bad.length})`);
process.exit(bad.length === 0 ? 0 : 1);
