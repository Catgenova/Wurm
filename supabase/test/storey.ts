/**
 * What a storey stands on, and what fits through a door.
 *
 * Three rules that had never existed, measured rather than asserted, and
 * measured on both sides because a refusal the island gives and the browser
 * does not is a button that works until it doesn't.
 *
 * A building could be ten storeys of logs: nothing anywhere asked what the
 * stuff would stand. Each material says now how many storeys of it hold up,
 * and the shortest material anywhere in a building caps the whole of it. A
 * storey may not be heavier than what carries it — timber, brick and rubble,
 * cut stone, and never a heavier grade over a lighter one. And raising one
 * takes ten points of the trade below for every storey above the first.
 *
 * The cart half is the browser's alone: the island has never had an opinion
 * about where wheels may go, so `blocksVehicle` is asked here and nowhere
 * else. A door is for a person; a cart wants a double door, an archway or a
 * gate.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID } from '../../src/game/actions';
import { Buildings, MATERIALS, WALL_TYPES, type Side, type WallType } from '../../src/game/building';
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

/* ---- the twelve materials say the same thing on both sides ---------------- */
const theirMats = new Map(
  psql(`select id || '|' || storeys || '|' || heft from build_material_def;`)
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { const [id, s, h] = l.split('|'); return [id, `${s}|${h}`] as const; }),
);
const matsApart = MATERIALS.filter((m) => theirMats.get(m.id) !== `${m.storeys}|${m.heft}`);
check('every build material stands as high and weighs as much on both sides', matsApart.length === 0,
  matsApart.length ? matsApart.map((m) => `${m.id}: browser ${m.storeys}/${m.heft}, island ${theirMats.get(m.id) ?? 'nothing'}`).join('; ')
    : `${MATERIALS.length} of them, logs at ${MATERIALS[0].storeys} storeys and marble at 10`);

const theirWide = new Set(psql(`select id from wall_type_def where wide;`).split('\n').map((s) => s.trim()).filter(Boolean));
const mineWide = WALL_TYPES.filter((w) => w.wide).map((w) => w.id);
check('and the same openings are wide enough to drive through',
  mineWide.length === theirWide.size && mineWide.every((id) => theirWide.has(id)),
  `${mineWide.join(', ')} against ${[...theirWide].sort().join(', ')}`);

/* ---- one tile, four log walls, on both sides ----------------------------- */
const SIDES: Side[] = ['n', 'e', 's', 'w'];
const wallRow = (x: number, y: number, side: Side, level: number, type: WallType, mat: string): string => {
  const bx = side === 'e' ? x + 1 : x;
  const by = side === 's' ? y + 1 : y;
  const dir = side === 'n' || side === 's' ? 'h' : 'v';
  return `(w, ${level}, '${dir}', ${bx}, ${by}, 1, '${type}', '${mat}', '{"log": 0}', '{"log": 4}')`;
};

const game = Game.create(4242);
const bld: Buildings = game.buildings;
const b = bld.create('Tower', 40, 40);
game.player.x = 40.5;
game.player.y = 40.5;
game.inventory.add('mallet', { ql: 40 });
game.inventory.add('trowel', { ql: 40 });
for (const side of SIDES) {
  const w = bld.setWall(b, 0, 40, 40, side, 'solid', 'log');
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
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def in ('mallet', 'trowel');
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'mallet', 40, 1), (w, 'player', u, 'trowel', 40, 1);
  insert into building (world_id, id, name, levels, work_level, planned_by) values (w, 1, 'Tower', 1, 0, u);
  insert into building_tile (world_id, building, x, y) values (w, 1, 40, 40);
  insert into wall (world_id, level, dir, x, y, building, type, material, needed, total) values
    ${SIDES.map((s) => wallRow(40, 40, s, 0, 'solid', 'log')).join(',\n    ')};
  update player set x = 40.5, y = 40.5 where world_id = w and uid = u;
end $$;`);

const theirSay = (action: string, target: string): string =>
  psql(`select coalesce(build_refusal(${W}, (select uid from player where world_id = ${W} and name = 'Dane'),
        '${action}', '${target}'::jsonb), 'ALLOWED');`);
const mineSay = (id: string, target: Record<string, unknown>): string => {
  const a = ACTION_BY_ID.get(id);
  return a?.check?.({ kind: 'tile', x: 40, y: 40, cx: 40, cy: 40, ...target } as never, game) ?? 'ALLOWED';
};
const setLevels = (n: number, work = n - 1): void => {
  b.levels = n;
  b.workLevel = work;
  psql(`update building set levels = ${n}, work_level = ${work} where world_id = ${W} and id = 1;`);
};
const setSkill = (id: string, v: number): void => {
  game.skills.values.set(id, v);
  psql(`insert into skill (world_id, uid, id, value) values (${W},
        (select uid from player where world_id = ${W} and name = 'Dane'), '${id}', ${v})
        on conflict (world_id, uid, id) do update set value = ${v};`);
};

/* ---- how high a thing will stand ----------------------------------------- */
setSkill('carpentry', 90);
setSkill('masonry', 90);
setLevels(3);
const capMine = mineSay('add_floor', {});
const capTheirs = theirSay('add_floor', '{"x":40,"y":40}');
check('logs will not stand a fourth storey, and both sides say so in the same words',
  capMine === 'Log will not stand 4 storeys. 3 is as high as it goes.' && capTheirs === capMine,
  `browser "${capMine}", island "${capTheirs}"`);

/* ---- and the hands it takes ---------------------------------------------- */
setLevels(1, 0);
setSkill('carpentry', 5);
const skillMine = mineSay('add_floor', {});
const skillTheirs = theirSay('add_floor', '{"x":40,"y":40}');
check('a second storey over logs takes carpentry ten, in the same sentence on both sides',
  skillMine === 'Raising a 2nd storey over log takes carpentry 10. You have 5.0.' && skillTheirs === skillMine,
  `browser "${skillMine}", island "${skillTheirs}"`);

setSkill('carpentry', 10);
const enoughMine = mineSay('add_floor', {});
const enoughTheirs = theirSay('add_floor', '{"x":40,"y":40}');
check('and with the ten it is allowed on both sides', enoughMine === 'ALLOWED' && enoughTheirs === 'ALLOWED',
  `browser "${enoughMine}", island "${enoughTheirs}"`);

/* ---- and what may be raised over it -------------------------------------- */
setSkill('carpentry', 90);
setLevels(2, 1);
const f = bld.setFloor(b, 1, 40, 40, 'log');
for (const k of Object.keys(f.needed)) f.needed[k] = 0;
psql(`insert into floor_tile (world_id, level, x, y, building, material, kind, needed, total)
      values (${W}, 1, 40, 40, 1, 'log', 'floor', '{"log": 0}', '{"log": 2}');`);

const heavyMine = mineSay('plan_wall', { side: 'n', wallType: 'solid', material: 'marble' });
const heavyTheirs = theirSay('plan_wall', '{"x":40,"y":40,"side":"n","wallType":"solid","material":"marble"}');
check('marble will not go up over a log storey, and the refusal is word for word the same',
  heavyMine === 'Marble is too heavy to raise over what is under it. This storey carries timber, no more.'
    && heavyTheirs === heavyMine, `browser "${heavyMine}", island "${heavyTheirs}"`);

const lightMine = mineSay('plan_wall', { side: 'n', wallType: 'solid', material: 'plank' });
const lightTheirs = theirSay('plan_wall', '{"x":40,"y":40,"side":"n","wallType":"solid","material":"plank"}');
check('while planks over logs are nothing to object to', lightMine === 'ALLOWED' && lightTheirs === 'ALLOWED',
  `browser "${lightMine}", island "${lightTheirs}"`);

/* And a ground floor answers to nothing: there is nothing under it to ask. */
setLevels(1, 0);
const groundMine = mineSay('plan_wall', { side: 'n', wallType: 'solid', material: 'marble' });
check('and a ground floor of marble stands on the earth, which carries anything',
  groundMine === 'There is already a wall on that side.', groundMine);

/* ---- what fits through a door -------------------------------------------- */
/*
 * The browser's own, since nothing on the island has ever decided where a cart
 * may go. A person still walks through everything they always did: what
 * changed is that wheels ask for the width as well as the opening.
 */
const gv = Game.create(4242);
const yard = gv.buildings.create('Yard', 10, 10);
const put = (side: Side, type: WallType): void => {
  const w = gv.buildings.setWall(yard, 0, 10, 10, side, type, 'log');
  for (const k of Object.keys(w.needed)) w.needed[k] = 0;
};
put('n', 'door');
put('e', 'arch');
put('s', 'double_door');
put('w', 'solid');
const carts: Array<[string, Side, number, number, boolean]> = [
  ['a single door', 'n', 10, 9, true],
  ['an archway', 'e', 11, 10, false],
  ['a double door', 's', 10, 11, false],
  ['a solid wall', 'w', 9, 10, true],
];
const wrong = carts.filter(([, , x, y, stops]) => gv.buildings.blocksVehicle(10, 10, x, y) !== stops);
check('a cart is stopped by a door and a wall, and by neither wide opening', wrong.length === 0,
  wrong.length ? wrong.map(([what]) => what).join(', ') : carts.map(([what, , , , s]) => `${what}: ${s ? 'stopped' : 'through'}`).join(', '));
const walkWrong = carts.filter(([, , x, y]) => gv.buildings.blocksAt(0, 10, 10, x, y) !== (x === 9));
check('while a person still walks through every one of them a person could before', walkWrong.length === 0,
  walkWrong.length ? walkWrong.map(([what]) => what).join(', ') : 'the door, the arch and the double door, and not the wall');

/* And a gate, because a fence with no way through it is a cart trap. */
const gg = Game.create(4242);
gg.buildings.setFence(12, 12, 'n', 'fence_gate', 'log');
const gate = gg.buildings.wall(0, 12, 12, 'n')!;
for (const k of Object.keys(gate.needed)) gate.needed[k] = 0;
check('and a gate in a fence lets the cart onto your own land',
  !gg.buildings.blocksVehicle(12, 12, 12, 11), 'a fence gate is a wide opening');

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a storey stands on what is under it, no higher than the stuff allows, and a cart wants a wider door — ${ok.length} of ${ok.length}`);
