/**
 * Which storey, which side, and how many to go.
 *
 * Reported: "cant plan roof on when conditions are met. make sure that doors
 * and window walls etc count as elligible walls if completed."
 *
 * They do count, and always have: what a border wants is something standing on
 * it with its bill paid, and neither side has ever asked what kind of wall it
 * is. That half is measured here so the claim is a measurement rather than an
 * assurance — a room closed in by a solid wall, a door, a window, a bay and an
 * archway takes a roof. The arch is the sharpest case of it: a doorway with
 * nothing hung in it, that anything at all can walk through, and it closes a
 * storey exactly as a foot of stone does.
 *
 * What was wrong was the answer to a storey that is genuinely short. "All
 * walls of the top storey must be built before roofing" names no storey and no
 * side, and the storey it means is the one planned over your head rather than
 * the finished room you are standing in. So the refusal now says which storey,
 * how many sides have nothing on them, how many walls are up but not paid for,
 * and where the nearest of them is — and it has to be the same sentence on
 * both sides, down to which gap it calls nearest.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID } from '../../src/game/actions';
import { Buildings, gapText, type Side, type WallType } from '../../src/game/building';
import { Game } from '../../src/game/game';

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

const W = `(select id from world where name = 'Hoarding')`;

/* ---- one room, two tiles, six sides, four kinds of wall ------------------
 * A solid wall, a door, a window and a bay between them: every side closed in
 * by something, and not one of them a plain wall on all four corners.
 */
const SIX: Array<[number, number, Side, WallType]> = [
  [30, 30, 'n', 'solid'],
  [30, 30, 'w', 'door'],
  [30, 30, 's', 'window'],
  [31, 30, 'n', 'bay'],
  [31, 30, 'e', 'arch'],
  [31, 30, 's', 'solid'],
];

const game = Game.create(4242);
const bld: Buildings = game.buildings;
const b = bld.create('Oceanport', 30, 30);
bld.addTile(b, 31, 30);
for (const [x, y, side, type] of SIX) {
  const w = bld.setWall(b, 0, x, y, side, type, 'log');
  for (const k of Object.keys(w.needed)) w.needed[k] = 0;
}
game.player.x = 30.5;
game.player.y = 30.5;

const walls = SIX.map(([x, y, side, type]) => {
  const bx = side === 'e' ? x + 1 : x;
  const by = side === 's' ? y + 1 : y;
  const dir = side === 'n' || side === 's' ? 'h' : 'v';
  return `(w, 0, '${dir}', ${bx}, ${by}, 1, '${type}', 'log', '{"log": 0}', '{"log": 4}')`;
}).join(',\n    ');

psql(`
do $$
declare w uuid; u uuid;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  delete from wall where world_id = w;
  delete from floor_tile where world_id = w;
  delete from building_tile where world_id = w;
  delete from building where world_id = w;
  insert into building (world_id, id, name, levels, work_level, planned_by) values (w, 1, 'Oceanport', 1, 0, u);
  insert into building_tile (world_id, building, x, y) values (w, 1, 30, 30), (w, 1, 31, 30);
  insert into wall (world_id, level, dir, x, y, building, type, material, needed, total) values
    ${walls};
  update player set x = 30.5, y = 30.5 where world_id = w and uid = u;
end $$;`);

/* ---- closed in by a door, a window and a bay ---- */
const mine = gapText(b.levels, bld.levelGaps(b, 0, game.player.x, game.player.y));
const theirs = psql(`select coalesce(level_gap(${W}, 1, 0, 30.5, 30.5), 'CLOSED IN')`);
check('a room closed in by a solid wall, a door, a window, a bay and an arch is closed in',
  mine === null && theirs === 'CLOSED IN', `browser ${mine ?? 'CLOSED IN'}, island ${theirs}`);

const roof = ACTION_BY_ID.get('plan_floor');
if (!roof) throw new Error('there is no plan_floor any more');
const target = { kind: 'tile' as const, x: 30, y: 30, cx: 30, cy: 30, material: 'log', floorKind: 'roof' as const };
const mineRoof = roof.check?.(target, game) ?? 'ALLOWED';
check('so a roof may be planned on it', mineRoof === 'ALLOWED' || mineRoof.startsWith('You need'), mineRoof);

/* ---- and a storey that is genuinely short says how short, and where ---- */
bld.removeWall(0, 31, 30, 'e');
psql(`delete from wall where world_id = ${W} and level = 0 and dir = 'v' and x = 32 and y = 30;`);
const oneOut = gapText(b.levels, bld.levelGaps(b, 0, game.player.x, game.player.y));
const theirOneOut = psql(`select coalesce(level_gap(${W}, 1, 0, 30.5, 30.5), 'CLOSED IN')`);
check('one wall taken out and the answer says which side it was',
  oneOut === 'Storey 1 is not closed in: 1 side with no wall, nearest the east side of 31,30.'
    && theirOneOut === oneOut, `browser "${oneOut}", island "${theirOneOut}"`);

/* ---- a wall planned and not paid for counts as still going up ---- */
const going = bld.setWall(b, 0, 31, 30, 'e', 'solid', 'log');
going.needed.log = 3;
psql(`insert into wall (world_id, level, dir, x, y, building, type, material, needed, total)
      values (${W}, 0, 'v', 32, 30, 1, 'solid', 'log', '{"log": 3}', '{"log": 4}');`);
bld.removeWall(0, 30, 30, 'n');
psql(`delete from wall where world_id = ${W} and level = 0 and dir = 'h' and x = 30 and y = 30;`);
const both = gapText(b.levels, bld.levelGaps(b, 0, game.player.x, game.player.y));
const theirBoth = psql(`select coalesce(level_gap(${W}, 1, 0, 30.5, 30.5), 'CLOSED IN')`);
check('a hole and a half-built wall are counted apart, and the nearer one named',
  both === 'Storey 1 is not closed in: 1 side with no wall and 1 still going up, nearest the north side of 30,30.'
    && theirBoth === both, `browser "${both}", island "${theirBoth}"`);

/* ---- and the storey it names is the one that is short ---- */
b.levels = 2;
psql(`update building set levels = 2 where world_id = ${W} and id = 1;`);
const upstairs = gapText(b.levels, bld.levelGaps(b, 1, game.player.x, game.player.y));
const theirUpstairs = psql(`select coalesce(level_gap(${W}, 1, 1, 30.5, 30.5), 'CLOSED IN')`);
check('a second storey with no walls at all names itself, not the room below',
  upstairs === 'Storey 2 is not closed in: 6 sides with no wall, nearest the north side of 30,30.'
    && theirUpstairs === upstairs, `browser "${upstairs}", island "${theirUpstairs}"`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not the same on both sides`);
  process.exit(1);
}
console.log(`a door closes a storey as well as a wall does, and a storey that is short says how short — ${ok.length} of ${ok.length}`);
