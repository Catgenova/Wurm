/**
 * A room, a roof that is worth something, and three shapes of roof.
 *
 * A roof cost half a wall, took the same work as one, and did nothing at all.
 * A building was a shape with a door in it: what you left on the floor of a
 * finished house rotted at exactly the rate it rotted at in a field, and the
 * only thing on this island that ever sheltered anything was a sack.
 *
 * So there are rooms now — everywhere you can walk to from a tile without
 * crossing a wall, a door being a wall with a hole in it — and a room with
 * walls all round it and something over every tile of it is indoors. What is
 * indoors rots at a tenth of what it would outside, on top of the deed's own
 * tenth, and a bed indoors banks a third again as much of a night.
 *
 * And a roof has a shape, where before there was one way of drawing one: a
 * gable, a hip, or a flat deck you can walk out onto.
 *
 * Both sides, all of it, because a house that shelters in the browser and not
 * on the island is a house that eats what you leave in it.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID } from '../../src/game/actions';
import { floorBill, ROOF_SHAPES, type Side, type WallType } from '../../src/game/building';
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

/* ---- a hut of two tiles, with a door in the outside wall ------------------ */
const TILES: Array<[number, number]> = [[50, 50], [51, 50]];
const WALLS: Array<[number, number, Side, WallType]> = [
  [50, 50, 'n', 'solid'], [50, 50, 's', 'solid'], [50, 50, 'w', 'door'],
  [51, 50, 'n', 'solid'], [51, 50, 's', 'solid'], [51, 50, 'e', 'solid'],
];
const row = (x: number, y: number, side: Side, level: number, type: WallType): string => {
  const bx = side === 'e' ? x + 1 : x;
  const by = side === 's' ? y + 1 : y;
  const dir = side === 'n' || side === 's' ? 'h' : 'v';
  return `(w, ${level}, '${dir}', ${bx}, ${by}, 1, '${type}', 'log', '{"log": 0}', '{"log": 4}')`;
};

const game = Game.create(4242);
const bld = game.buildings;
const b = bld.create('Hut', 50, 50);
bld.addTile(b, 51, 50);
game.player.x = 50.5;
game.player.y = 50.5;
game.inventory.add('mallet', { ql: 40 });
for (const [x, y, side, type] of WALLS) {
  const w = bld.setWall(b, 0, x, y, side, type, 'log');
  for (const k of Object.keys(w.needed)) w.needed[k] = 0;
}

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
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'mallet';
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'mallet', 40, 1);
  insert into building (world_id, id, name, levels, work_level, planned_by) values (w, 1, 'Hut', 1, 0, u);
  insert into building_tile (world_id, building, x, y) values ${TILES.map(([x, y]) => `(w, 1, ${x}, ${y})`).join(', ')};
  insert into wall (world_id, level, dir, x, y, building, type, material, needed, total) values
    ${WALLS.map(([x, y, s, t]) => row(x, y, s, 0, t)).join(',\n    ')};
  update player set x = 50.5, y = 50.5 where world_id = w and uid = u;
end $$;`);

const theirRoom = (x: number, y: number): number =>
  Number(psql(`select count(*) from room_tiles(${W}, 0, ${x}, ${y});`));
const theirIndoors = (x: number, y: number): boolean => psql(`select indoors(${W}, 0, ${x}, ${y});`) === 't';

/* ---- the room ------------------------------------------------------------ */
const mineRoom = bld.room(0, 50, 50);
check('two tiles with nothing between them are one room, on both sides',
  mineRoom?.tiles.length === 2 && theirRoom(50, 50) === 2,
  `browser ${mineRoom?.tiles.length}, island ${theirRoom(50, 50)}`);

const inner = bld.setWall(b, 0, 51, 50, 'w', 'solid', 'log');
for (const k of Object.keys(inner.needed)) inner.needed[k] = 0;
psql(`insert into wall (world_id, level, dir, x, y, building, type, material, needed, total)
      values (${W}, 0, 'v', 51, 50, 1, 'solid', 'log', '{"log": 0}', '{"log": 4}');`);
check('and a wall down the middle makes two rooms of one, on both sides',
  bld.room(0, 50, 50)?.tiles.length === 1 && bld.room(0, 51, 50)?.tiles.length === 1
    && theirRoom(50, 50) === 1 && theirRoom(51, 50) === 1,
  `browser ${bld.room(0, 50, 50)?.tiles.length}/${bld.room(0, 51, 50)?.tiles.length}, island ${theirRoom(50, 50)}/${theirRoom(51, 50)}`);
bld.removeWall(0, 51, 50, 'w');
psql(`delete from wall where world_id = ${W} and level = 0 and dir = 'v' and x = 51 and y = 50;`);

/* ---- and what a roof over it is worth ------------------------------------ */
check('a room with nothing over it is not indoors, on either side',
  !bld.indoors(0, 50, 50) && !theirIndoors(50, 50), `browser ${bld.indoors(0, 50, 50)}, island ${theirIndoors(50, 50)}`);

for (const [x, y] of TILES) {
  const f = bld.setFloor(b, 1, x, y, 'log', 'roof');
  for (const k of Object.keys(f.needed)) f.needed[k] = 0;
}
psql(`insert into floor_tile (world_id, level, x, y, building, material, kind, needed, total) values
      ${TILES.map(([x, y]) => `(${W}, 1, ${x}, ${y}, 1, 'log', 'roof', '{"log": 0}', '{"log": 2}')`).join(', ')};`);
check('roofed and walled all round, it is', bld.indoors(0, 50, 50) && theirIndoors(50, 50),
  `browser ${bld.indoors(0, 50, 50)}, island ${theirIndoors(50, 50)}`);
check('and the door it is walled with is still a wall as far as the weather goes',
  bld.room(0, 50, 50)?.enclosed === true, 'a door bounds a room, and closes one');

/* One wall not paid for and the room is a building site again. */
const halfUp = bld.wall(0, 51, 50, 'e')!;
halfUp.needed.log = 2;
psql(`update wall set needed = '{"log": 2}' where world_id = ${W} and level = 0 and dir = 'v' and x = 52 and y = 50;`);
check('a wall still going up leaves it out in the weather, on both sides',
  !bld.indoors(0, 50, 50) && !theirIndoors(50, 50), `browser ${bld.indoors(0, 50, 50)}, island ${theirIndoors(50, 50)}`);
halfUp.needed.log = 0;
psql(`update wall set needed = '{"log": 0}' where world_id = ${W} and level = 0 and dir = 'v' and x = 52 and y = 50;`);

/* ---- what that is worth to a crate of planks ----------------------------- */
const inside = game.decayMultiplier(50, 50);
const outside = game.decayMultiplier(60, 60);
const theirInside = Number(psql(`select decay_multiplier(${W}, 50, 50);`));
const theirOutside = Number(psql(`select decay_multiplier(${W}, 60, 60);`));
check('a thing indoors rots at a tenth of what it would in the open, on both sides',
  Math.abs(inside / outside - 0.1) < 1e-9 && Math.abs(theirInside / theirOutside - 0.1) < 1e-9,
  `browser ${inside} against ${outside}, island ${theirInside} against ${theirOutside}`);
check('and the island charges for a deed as the browser always has',
  Math.abs(theirOutside - outside) < 1e-9, `island ${theirOutside}, browser ${outside}`);

/* ---- three shapes of roof ------------------------------------------------ */
const theirShapes = new Map(
  psql(`select id || '|' || factor || '|' || rise || '|' || walkable from roof_shape_def;`)
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { const [id, ...rest] = l.split('|'); return [id, rest.join('|')] as const; }),
);
const shapesApart = ROOF_SHAPES.filter((r) => theirShapes.get(r.id) !== `${r.factor}|${r.rise}|${r.walkable}`);
check('the three shapes of roof are the same three on both sides', shapesApart.length === 0,
  shapesApart.length ? shapesApart.map((r) => `${r.id}: island ${theirShapes.get(r.id) ?? 'nothing'}`).join('; ')
    : ROOF_SHAPES.map((r) => `${r.id} at ${r.factor}`).join(', '));

const billsApart = ROOF_SHAPES.filter((r) => {
  const mine = floorBill('log', 'roof', r.id).total.log;
  const theirs = Number(psql(`select coalesce((floor_bill('log', 'roof', '${r.id}')->>'log')::int, -1);`));
  return mine !== theirs;
});
check('and a roof of each costs the same on both sides', billsApart.length === 0,
  billsApart.length ? billsApart.map((r) => r.id).join(', ')
    : ROOF_SHAPES.map((r) => `${r.id} ${floorBill('log', 'roof', r.id).total.log} logs`).join(', '));

/* And the order of them, which is the whole reason to offer a choice. */
const per = (id: 'gable' | 'hip' | 'flat'): number => floorBill('plank', 'roof', id).total.plank ?? 0;
check('a gable is cheaper than a hip, and a deck dearer than either',
  per('gable') < per('hip') && per('hip') < per('flat'),
  `plank: gable ${per('gable')}, hip ${per('hip')}, flat ${per('flat')} a tile`);

/* The sentence that names one has to be the same sentence, shape and all. */
const gb = Game.create(4242);
gb.inventory.add('mallet', { ql: 40 });
const gbB = gb.buildings.create('Shed', 70, 70);
gb.player.x = 70.5;
gb.player.y = 70.5;
for (const side of ['n', 'e', 's', 'w'] as Side[]) {
  const w = gb.buildings.setWall(gbB, 0, 70, 70, side, 'solid', 'log');
  for (const k of Object.keys(w.needed)) w.needed[k] = 0;
}
gb.log.length = 0;
ACTION_BY_ID.get('plan_floor')?.perform?.(
  { kind: 'tile', x: 70, y: 70, cx: 70, cy: 70, material: 'log', floorKind: 'roof', roofShape: 'gable' } as never, gb);
const mineSaid = gb.log.map((l) => l.text).find((t) => t.startsWith('You plan')) ?? 'NOTHING SAID';
const theirSaid = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  insert into building (world_id, id, name, levels, work_level, planned_by) values (w, 2, 'Shed', 1, 0, u);
  insert into building_tile (world_id, building, x, y) values (w, 2, 70, 70);
  insert into wall (world_id, level, dir, x, y, building, type, material, needed, total) values
    (w,0,'h',70,70,2,'solid','log','{"log":0}','{"log":4}'),
    (w,0,'h',70,71,2,'solid','log','{"log":0}','{"log":4}'),
    (w,0,'v',70,70,2,'solid','log','{"log":0}','{"log":4}'),
    (w,0,'v',71,70,2,'solid','log','{"log":0}','{"log":4}');
  delete from event where world_id = w and uid = u;
  perform perform_building(w, u, 'plan_floor',
    '{"x":70,"y":70,"material":"log","floorKind":"roof","roofShape":"gable"}'::jsonb);
  insert into said select text from event where world_id = w and uid = u and text like 'You plan%';
end $$;
select k from said;
rollback;
`).split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? 'NOTHING SAID';
check('and planning one is announced in the same words, shape and all',
  mineSaid === theirSaid && mineSaid.includes('gabled'), `browser "${mineSaid}", island "${theirSaid}"`);

/* ---- and what you may walk out onto -------------------------------------- */
const gw = Game.create(4242);
const flat = gw.buildings.create('Terrace', 80, 80);
flat.roof = 'flat';
const deck = gw.buildings.setFloor(flat, 1, 80, 80, 'marble', 'roof');
for (const k of Object.keys(deck.needed)) deck.needed[k] = 0;
check('a flat roof is a terrace you can stand on', gw.standable(80, 80, 1), 'a deck is a floor with nothing over it');
flat.roof = 'hip';
check('and a pitched one is not', !gw.standable(80, 80, 1), 'nobody stands on a slope');

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a room with walls round it and a roof over it keeps what you leave in it — ${ok.length} of ${ok.length}`);
