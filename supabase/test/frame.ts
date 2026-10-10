/**
 * Jetties and balconies, railings, and columns, the same on both sides.
 *
 * Asked for: an upper storey's floor laid one tile out past the footprint on
 * the wall of the storey below -- a jettied storey with more room than the
 * ground floor, or, shut off behind a door, a balcony; a railing for the open
 * edges of balconies and flat roofs; and columns on the corners of a storey,
 * holding up what is over them as walls do, so that four columns and a roof
 * make an open hall.
 *
 * Every one of those is a rule twice -- `src/game/frame.ts` and the storey
 * rules in `building.ts`, and `frame_refusal`, `frame_storey`, `level_gap`,
 * `bearing`, `sheltered` and `frame_footing` on the island -- so the same
 * buildings are put to both, and every refusal has to come back in the same
 * words, every storey closed in or not the same way, every bill the same.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on
 * it. His settlement there is moved over the ground this uses for the while
 * (21,26, five tiles round), on both sides, and the ground, the settlement and
 * Dane are put back after.
 */
import { dyeHex, dyeText, pureDye } from '../../src/game/dyestuffs';
import { Game } from '../../src/game/game';
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID } from '../../src/game/actions';
import { frameSays } from '../../src/game/frameActions';
import { CELLAR_DEPTH, COLUMN_SHARE, columnBill, floorKind, gapText, INDOORS_DECAY, INDOORS_REST, isDone, MATERIAL_BY_ID, MATERIALS, RAILING_HEIGHT, wallBill, WALL_TYPE_BY_ID, type Side, type WallType } from '../../src/game/building';
import { needsText } from '../../src/game/buildActions';
import { AQ_OVER, aqueductPlan } from '../../src/game/aqueducts';
import { COUNTER_EMPTY_FIRST } from '../../src/game/counters';
import { GLASS_PITCHED, GLASS_ROOF_ONLY } from '../../src/game/glasshouse';
import { deckBears, deckCarries } from '../../src/game/piers';
import { numberWord } from '../../src/game/words';
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
const W = `(select id from world where name = 'Hoarding')`;
const DANE = `(select uid from player where world_id = ${W} and name = 'Dane')`;

/* ---- the ground, as it was, to be put back ------------------------------- */
const X0 = 14, X1 = 28, Y0 = 19, Y1 = 33;
const heightsWere = psql(`select string_agg(gx || ',' || gy || ',' || coalesce(land_height(${W}, gx, gy), 0), ';')
  from generate_series(${X0}, ${X1 + 1}) gx, generate_series(${Y0}, ${Y1 + 1}) gy;`);
const tilesWere = psql(`select string_agg(gx || ',' || gy || ',' || land_tile(${W}, gx, gy) || ',' || coalesce(land_data(${W}, gx, gy), 0), ';')
  from generate_series(${X0}, ${X1}) gx, generate_series(${Y0}, ${Y1}) gy;`);
const daneWas = psql(`select x || ',' || y || ',' || level from player where world_id = ${W} and name = 'Dane';`);
const deedWas = psql(`select coalesce((select x || ',' || y || ',' || radius || ',' || level from deed
  where world_id = ${W} and founded_by = ${DANE}), '');`);

/* ---- the same ground on both sides: level grass at twenty ------------------ */
const BASE = 20;
const game = Game.create(4242);
const bld = game.buildings;
const world = game.world;
(game as unknown as { deed: unknown }).deed = { name: 'Latecomer', x: 21, y: 26, radius: 5, level: 1, mine: true };
for (let y = Y0; y <= Y1 + 1; y++) for (let x = X0; x <= X1 + 1; x++) world.setHeight(x, y, BASE);
for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) world.setTile(x, y, TileType.Grass, 0);
game.inventory.add('mallet', { ql: 40 });
game.inventory.add('trowel', { ql: 40 });
game.skills.values.set('carpentry', 90);
game.skills.values.set('masonry', 90);
game.player.x = 18.5;
game.player.y = 23.5;
game.player.level = 1;

psql(`
do $$
declare w uuid; u uuid; gx int; gy int;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  delete from wall where world_id = w;
  delete from floor_tile where world_id = w;
  delete from building_column where world_id = w;
  delete from building_tile where world_id = w;
  delete from building where world_id = w;
  delete from bridge where world_id = w;
  delete from item where world_id = w and holder = 'player' and holder_uid = u
    and def in ('mallet', 'trowel', 'shovel', 'dirt', 'sprout', 'log', 'plank', 'timber', 'marble_brick', 'mortar');
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'mallet', 40, 1), (w, 'player', u, 'trowel', 40, 1);
  for gx in ${X0}..${X1 + 1} loop for gy in ${Y0}..${Y1 + 1} loop perform land_set_height(w, gx, gy, ${BASE}); end loop; end loop;
  for gx in ${X0}..${X1} loop for gy in ${Y0}..${Y1} loop
    perform land_set_tile(w, gx, gy, tile_id('Grass')); perform land_set_data(w, gx, gy, 0);
  end loop; end loop;
  insert into skill (world_id, uid, id, value) values (w, u, 'carpentry', 90), (w, u, 'masonry', 90)
    on conflict (world_id, uid, id) do update set value = 90;
  -- His settlement over this ground, as the browser has it.
  if exists (select 1 from deed where world_id = w and founded_by = u) then
    update deed set x = 21, y = 26, radius = 5, level = 1 where world_id = w and founded_by = u;
  else
    insert into deed (world_id, name, x, y, radius, founded_by) values (w, 'Latecomer', 21, 26, 5, u);
  end if;
  update player set x = 18.5, y = 23.5, level = 1 where world_id = w and uid = u;
end $$;`);

/* ---- building on both sides at once ---------------------------------------- */
const firstOf = (mat: string): string => MATERIALS.find((m) => m.id === mat)?.bill[0][0] ?? 'log';
const along = (x: number, y: number, side: Side): { bx: number; by: number; dir: 'h' | 'v' } => ({
  bx: side === 'e' ? x + 1 : x, by: side === 's' ? y + 1 : y, dir: side === 'n' || side === 's' ? 'h' : 'v',
});
const sql = (s: string): void => {
  psql(`do $$ declare w uuid; u uuid; begin
    select id into w from world where name = 'Hoarding';
    select uid into u from player where world_id = w and name = 'Dane';
    ${s}
  end $$;`);
};
const building = (id: number, name: string, tiles: Array<[number, number]>, levels: number, work = levels - 1): void => {
  const b = bld.create(name, tiles[0][0], tiles[0][1]);
  if (b.id !== id) throw new Error(`the browser numbered ${name} ${b.id}, not ${id}`);
  for (const [x, y] of tiles.slice(1)) bld.addTile(b, x, y);
  b.levels = levels;
  b.workLevel = work;
  sql(`insert into building (world_id, id, name, levels, work_level, planned_by) values (w, ${id}, '${name}', ${levels}, ${work}, u);
    insert into building_tile (world_id, building, x, y) values ${tiles.map(([x, y]) => `(w, ${id}, ${x}, ${y})`).join(', ')};`);
};
const setLevels = (id: number, levels: number, work = levels - 1): void => {
  const b = bld.list.get(id)!;
  b.levels = levels;
  b.workLevel = work;
  sql(`update building set levels = ${levels}, work_level = ${work} where world_id = w and id = ${id};`);
};
const wall = (id: number, level: number, x: number, y: number, side: Side, type: WallType, mat: string, left = 0): void => {
  const b = bld.list.get(id)!;
  const wl = bld.setWall(b, level, x, y, side, type, mat);
  wl.building = id;
  for (const k of Object.keys(wl.needed)) wl.needed[k] = 0;
  const first = Object.keys(wl.needed)[0] ?? firstOf(mat);
  if (left) wl.needed[first] = left;
  const { bx, by, dir } = along(x, y, side);
  sql(`delete from wall where world_id = w and level = ${level} and dir = '${dir}' and x = ${bx} and y = ${by};
    insert into wall (world_id, level, dir, x, y, building, type, material, needed, total)
    values (w, ${level}, '${dir}', ${bx}, ${by}, ${id}, '${type}', '${mat}', '${JSON.stringify(wl.needed)}', '${JSON.stringify(wl.total)}');`);
};
const unwall = (level: number, x: number, y: number, side: Side): void => {
  bld.removeWall(level, x, y, side);
  const { bx, by, dir } = along(x, y, side);
  sql(`delete from wall where world_id = w and level = ${level} and dir = '${dir}' and x = ${bx} and y = ${by};`);
};
const floor = (id: number, level: number, x: number, y: number, mat: string, kind: 'floor' | 'roof' = 'floor', left = 0): void => {
  const b = bld.list.get(id)!;
  const f = bld.setFloor(b, level, x, y, mat, kind);
  for (const k of Object.keys(f.needed)) f.needed[k] = 0;
  if (left) f.needed[Object.keys(f.needed)[0]] = left;
  sql(`delete from floor_tile where world_id = w and level = ${level} and x = ${x} and y = ${y};
    insert into floor_tile (world_id, level, x, y, building, material, kind, needed, total)
    values (w, ${level}, ${x}, ${y}, ${id}, '${mat}', '${kind}', '${JSON.stringify(f.needed)}', '${JSON.stringify(f.total)}');`);
};
const unfloor = (level: number, x: number, y: number): void => {
  bld.removeFloor(level, x, y);
  sql(`delete from floor_tile where world_id = w and level = ${level} and x = ${x} and y = ${y};`);
};
const column = (id: number, level: number, x: number, y: number, mat: string, left = 0): void => {
  const b = bld.list.get(id)!;
  const c = bld.setColumn(b, level, x, y, mat);
  for (const k of Object.keys(c.needed)) c.needed[k] = 0;
  if (left) c.needed[Object.keys(c.needed)[0]] = left;
  sql(`delete from building_column where world_id = w and level = ${level} and x = ${x} and y = ${y};
    insert into building_column (world_id, level, x, y, building, material, needed, total)
    values (w, ${level}, ${x}, ${y}, ${id}, '${mat}', '${JSON.stringify(c.needed)}', '${JSON.stringify(c.total)}');`);
};
const uncolumn = (level: number, x: number, y: number): void => {
  bld.removeColumn(level, x, y);
  sql(`delete from building_column where world_id = w and level = ${level} and x = ${x} and y = ${y};`);
};
const setTile = (x: number, y: number, t: number, name: string): void => {
  world.setTile(x, y, t as TileType, 0);
  sql(`perform land_set_tile(w, ${x}, ${y}, tile_id('${name}'));`);
};
const setCorner = (x: number, y: number, h: number): void => {
  world.setHeight(x, y, h);
  sql(`perform land_set_height(w, ${x}, ${y}, ${h});`);
};
const stand = (x: number, y: number, level: number): void => {
  game.player.x = x;
  game.player.y = y;
  game.player.level = level;
  sql(`update player set x = ${x}, y = ${y}, level = ${level} where world_id = w and uid = u;`);
};

/** What each side says to a job: the browser's check, and the island's `build_refusal`. */
const say = (id: string, target: Record<string, unknown>): [string, string] => {
  const t = { kind: 'tile', cx: target.x, cy: target.y, ...target };
  const a = ACTION_BY_ID.get(id);
  if (!a) throw new Error(`there is no ${id}`);
  const mine = a.check?.(t as never, game) ?? 'ALLOWED';
  const theirs = psql(`select coalesce(build_refusal(${W}, ${DANE}, '${id}', '${JSON.stringify(t)}'::jsonb), 'ALLOWED');`);
  return [mine, theirs];
};
const same = (what: string, id: string, target: Record<string, unknown>, want: string): void => {
  const [mine, theirs] = say(id, target);
  check(what, mine === want && theirs === want, `browser "${mine}", island "${theirs}"`);
};
/** Do a job on both sides, and what each said doing it. */
const both = (id: string, target: Record<string, unknown>, prefix: string): [string, string] => {
  const t = { kind: 'tile', cx: target.x, cy: target.y, ...target };
  game.log.length = 0;
  ACTION_BY_ID.get(id)?.perform(t as never, game);
  const mine = game.log.map((l) => l.text).find((s) => s.startsWith(prefix)) ?? 'NOTHING SAID';
  psql(`delete from event where world_id = ${W} and uid = ${DANE};`);
  psql(`select perform_building(${W}, ${DANE}, '${id}', '${JSON.stringify(t)}'::jsonb);`);
  const theirs = psql(`select text from event where world_id = ${W} and uid = ${DANE} and text like '${prefix.replace(/'/g, "''")}%' order by n desc limit 1;`) || 'NOTHING SAID';
  return [mine, theirs];
};

/** What Examine says of a tile's jetty and columns on each side, and that the island's Examine says it. */
const says = (what: string, x: number, y: number, want: string): void => {
  const mine = frameSays(game, x, y).trim();
  const theirs = psql(`select frame_says(${W}, ${x}, ${y});`);
  const whole = psql(`select examine_tile_text(${W}, ${x}, ${y}, ${DANE});`);
  check(what, mine === want && theirs === want && whole.includes(want), `browser "${mine}", island "${theirs}"`);
};

/** A wall's bill in the words a plan is said in. */
const wallBillOf = (mat: string, type: WallType): string => needsText(wallBill(mat, type));

/* ---- the numbers ------------------------------------------------------------- */
const railing = WALL_TYPE_BY_ID.get('railing');
const theirRail = psql(`select factor || '|' || coalesce(height, 0) || '|' || passable || '|' || low || '|' || railed || '|' || standalone from wall_type_def where id = 'railing';`);
check('a railing is the same wall type on both sides: waist-high, low, railed, not passable, not a fence',
  !!railing && theirRail === `${railing.factor}|${railing.height}|false|true|true|false` && railing.height === RAILING_HEIGHT && !railing.opaque,
  `browser ${railing?.factor}|${railing?.height}|${railing?.passable}|${railing?.low}|${railing?.railed}; island ${theirRail}`);
check('and a column takes the same share of a wall on both sides',
  Number(psql('select column_share();')) === COLUMN_SHARE, `${COLUMN_SHARE} of a solid wall's bill`);
const billsApart = MATERIALS.filter((m) => {
  const mine = JSON.stringify(Object.entries(columnBill(m.id).needed).sort());
  const theirs = psql(`select coalesce(jsonb_agg(jsonb_build_array(key, value::int) order by key)::text, '[]') from jsonb_each_text(scaled_bill('${m.id}', column_share()));`);
  return mine !== theirs.replace(/ /g, '');
});
check(`and a column of each of the ${numberWord(MATERIALS.length)} materials costs the same on both sides`, billsApart.length === 0,
  billsApart.length ? billsApart.map((m) => m.id).join(', ')
    : MATERIALS.slice(0, 4).map((m) => `${m.id} ${Object.entries(columnBill(m.id).needed).map(([k, n]) => `${n} ${k}`).join(' + ')}`).join('; '));

/* ---- a tower of two tiles, two storeys ---------------------------------------
 *
 *   (18,23) (19,23)   log walls all round the ground floor, finished;
 *                     plank floors on storey 2, finished.
 *   (18,24)           the tile a jetty goes on, south of the first.
 */
building(1, 'Tower', [[18, 23], [19, 23]], 2, 1);
for (const [x, y, side] of [[18, 23, 'n'], [18, 23, 'w'], [18, 23, 's'], [19, 23, 'n'], [19, 23, 'e'], [19, 23, 's']] as Array<[number, number, Side]>) {
  wall(1, 0, x, y, side, 'solid', 'log');
}
floor(1, 1, 18, 23, 'plank');
floor(1, 1, 19, 23, 'plank');
const JETTY = { x: 18, y: 24, material: 'plank', floorKind: 'floor', buildingId: 1 };

setLevels(1, 2, 0);
same('a jetty is never floored out from the ground floor, and working on it you are told to work a storey up', 'plan_floor', JETTY,
  'Work on storey 2 or above to floor a jetty here.');
setLevels(1, 1, 0);
same('while a building of one storey is told to plan another', 'plan_floor', JETTY,
  'A jetty is floored out from a storey above the ground: plan another storey and work on it.');
setLevels(1, 2, 1);

same('stairs and ladders stay inside the footprint', 'plan_floor', { ...JETTY, floorKind: 'stairs', side: 'n' },
  'Stairs and ladders go inside the footprint, not out on a jetty.');

wall(1, 0, 18, 23, 's', 'half_wall', 'log');
same('it rests on a full-height wall of the storey below, and a half wall is not one', 'plan_floor', JETTY,
  'A jetty rests on a finished full-height wall of storey 1: build one on a side this tile shares with Tower first.');
wall(1, 0, 18, 23, 's', 'solid', 'log', 2);
same('nor is a wall still going up', 'plan_floor', JETTY,
  'A jetty rests on a finished full-height wall of storey 1: build one on a side this tile shares with Tower first.');
wall(1, 0, 18, 23, 's', 'door', 'log');
same('a door is a wall to rest on: the joists go over it', 'plan_floor', JETTY, 'ALLOWED');
wall(1, 0, 18, 23, 's', 'solid', 'log');

setTile(18, 24, TileType.Tree, 'Tree');
same('it is built over open ground, and not over a tree', 'plan_floor', JETTY,
  'A jetty is built over open ground: clear the tree or the bush from under it first.');
setTile(18, 24, TileType.Bush, 'Bush');
same('nor over a bush', 'plan_floor', JETTY, 'A jetty is built over open ground: clear the tree or the bush from under it first.');
setTile(18, 24, TileType.Grass, 'Grass');

setCorner(19, 25, BASE + 3);
same('and never lower over the ground than the storey under it stands', 'plan_floor', JETTY,
  'The ground under it rises above the floor of storey 1: dig it down, or floor the jetty out a storey higher.');
setCorner(19, 25, BASE);

same('marble will not go out past log walls', 'plan_floor', { ...JETTY, material: 'marble' },
  'Marble is too heavy to lay out past the walls. The walls under it carry timber, no more.');
same('while planks will, on both sides', 'plan_floor', JETTY, 'ALLOWED');

/* The same out past the edge of the settlement: a jetty is built on your own ground. */
building(2, 'Edge', [[16, 28]], 2, 1);
for (const side of ['n', 'e', 's', 'w'] as Side[]) wall(2, 0, 16, 28, side, 'solid', 'log');
floor(2, 1, 16, 28, 'plank');
same('and only over your own settlement', 'plan_floor', { x: 15, y: 28, material: 'plank', floorKind: 'floor', buildingId: 2 },
  'You may only build on your own deed.');

/* Planned, on both sides, in the same words. */
const [planMine, planTheirs] = both('plan_floor', JETTY, 'You plan');
check('planning one is said the same on both sides', planMine === planTheirs && planMine.startsWith('You plan a plank floor'),
  `browser "${planMine}", island "${planTheirs}"`);
check('and it is a floor of storey 2 on the tile out past the tower, on both sides',
  bld.floor(1, 18, 24)?.building === 1 && bld.jettyAt(18, 24)?.id === 1
    && psql(`select building || '|' || kind from floor_tile where world_id = ${W} and level = 1 and x = 18 and y = 24;`) === '1|floor'
    && psql(`select frame_jetty_of(${W}, 18, 24);`) === '1',
  `island ${psql(`select building || '|' || kind from floor_tile where world_id = ${W} and level = 1 and x = 18 and y = 24;`)}`);
says('Examine on the ground under it names the jetty planned over it, on both sides', 18, 24,
  "A jetty of Tower's storey 2 is planned over it.");
floor(1, 1, 18, 24, 'plank');

/* Nothing else goes on or under it. */
building(3, 'Shed', [[18, 25]], 2, 1);
for (const side of ['n', 'e', 's', 'w'] as Side[]) wall(3, 0, 18, 25, side, 'solid', 'log');
same('another building cannot floor out over it', 'plan_floor', { ...JETTY, buildingId: 3 }, "That tile is under Tower's jetty.");
same('nor plan a building under it', 'plan_building', { x: 18, y: 24, name: 'Lean-to' }, "That tile is under Tower's jetty.");
same('nor add the ground under it to a building', 'add_to_building', { x: 18, y: 24 }, "That tile is under Tower's jetty.");

/* The wall it rests on stays up while it does, unless a column at each end of it carries that side. */
setLevels(1, 2, 0);
same('the last wall a jetty rests on is not taken down from under it', 'remove_wall', { x: 18, y: 23, side: 's' },
  'A jetty of storey 2 rests on this wall: raise a column at each end of it, or tear the jetty up, first.');
column(1, 0, 18, 24, 'log');
same('nor with a column at one end of it only', 'remove_wall', { x: 18, y: 23, side: 's' },
  'A jetty of storey 2 rests on this wall: raise a column at each end of it, or tear the jetty up, first.');
column(1, 0, 19, 24, 'log', 1);
same('nor while the other is still going up', 'remove_wall', { x: 18, y: 23, side: 's' },
  'A jetty of storey 2 rests on this wall: raise a column at each end of it, or tear the jetty up, first.');
column(1, 0, 19, 24, 'log');
same('with a finished column at each end it comes down: the columns carry the jetty\'s side, so a door can go in its place', 'remove_wall',
  { x: 18, y: 23, side: 's' }, 'ALLOWED');
uncolumn(0, 18, 24);
uncolumn(0, 19, 24);
same('while a wall with nothing out past it comes down', 'remove_wall', { x: 18, y: 23, side: 'w' }, 'ALLOWED');
setLevels(1, 2, 1);

/* ---- walls and railings on it --------------------------------------------- */
same('a railing goes on its edge', 'plan_wall', { x: 18, y: 24, side: 'e', wallType: 'railing', material: 'log', buildingId: 1 }, 'ALLOWED');
setLevels(1, 2, 0);
same('but never on the ground floor', 'plan_wall', { x: 18, y: 23, side: 'n', wallType: 'railing', material: 'log' },
  'A railing goes on the edge of a storey above the ground, of a deck on piers, or round a terrace. On the ground, plan a fence.');
setLevels(1, 2, 1);
const [railMine, railTheirs] = both('plan_wall', { x: 18, y: 24, side: 'e', wallType: 'railing', material: 'log', buildingId: 1 }, 'You plan');
check('and planning one on a jetty is said the same, as a railing, and stands on storey 2 on both sides',
  railMine === railTheirs && railMine === `You plan a log railing on the east side. It needs ${wallBillOf('log', 'railing')}.` && !!bld.wall(1, 18, 24, 'e')
    && psql(`select type from wall where world_id = ${W} and level = 1 and dir = 'v' and x = 19 and y = 24;`) === 'railing',
  `browser "${railMine}", island "${railTheirs}"`);
{
  const [needMine, needTheirs] = say('build_wall', { x: 18, y: 24, side: 'e', buildingId: 1 });
  check('and building it is asked of the railing on storey 2, on both sides', needMine === needTheirs && needMine.startsWith('You need'),
    `browser "${needMine}", island "${needTheirs}"`);
}
check('a railing stops a body stepping across it', game.buildings.blocksAt(1, 18, 24, 19, 24) === false, 'not until it is finished');

/* ---- the storey with its jetty open to it -------------------------------- */
// Walled round, the jetty railed on its three outer sides: a storey closed in by railings.
for (const [x, y, side] of [[18, 23, 'n'], [18, 23, 'w'], [19, 23, 'n'], [19, 23, 'e'], [19, 23, 's']] as Array<[number, number, Side]>) {
  wall(1, 1, x, y, side, 'solid', 'plank');
}
for (const side of ['e', 's', 'w'] as Side[]) wall(1, 1, 18, 24, side, 'railing', 'plank');
check('a railing, finished, stops a body stepping across it', game.buildings.blocksAt(1, 18, 24, 19, 24), 'as any wall does');
const gapMine = gapText(2, bld.levelGaps(bld.list.get(1)!, 1, 18.5, 23.5));
const gapTheirs = psql(`select coalesce(level_gap(${W}, 1, 1, 18.5, 23.5), 'CLOSED IN');`);
check('open to its storey, a jetty is part of it, and its railings close it in, on both sides',
  gapMine === null && gapTheirs === 'CLOSED IN', `browser ${gapMine ?? 'CLOSED IN'}, island ${gapTheirs}`);
says('and, open to the storey, names it a jetty and what it wants', 18, 24,
  "Over it is a jetty of Tower's storey 2, part of that storey: its open sides want a wall, a railing or columns to close the storey in, and a roof over it rests on walls or columns, never on a railing.");
const ROOF_J = { x: 18, y: 24, material: 'plank', floorKind: 'roof', buildingId: 1 };
same('but a roof over the jetty does not rest on its railings, only on the end of a wall at the house', 'plan_floor', ROOF_J,
  'A roof over the jetty rests on walls or columns: raise a column on its south-east corner first. A railing carries nothing.');
for (const [cx, cy] of [[18, 24], [19, 24], [18, 25], [19, 25]]) column(1, 1, cx, cy, 'plank');
same('so with a post at each corner of it the roof may go over the jetty with the rest', 'plan_floor', ROOF_J, 'ALLOWED');
for (const [cx, cy] of [[18, 24], [19, 24], [18, 25], [19, 25]]) uncolumn(1, cx, cy);
/* No bridge goes through a jetty, its railings and whoever is on it. */
{
  const mine = game.bridgeReason('wood', 17, 24, 19, 24);
  const theirs = psql(`select coalesce(bridge_reason(${W}, ${DANE}, 'wood', 17, 24, 19, 24), 'ALLOWED');`);
  check('no bridge is planned through a jetty, on both sides', mine === "Not over a building's jetty." && theirs === mine,
    `browser "${mine}", island "${theirs}"`);
}
/* Nor a tree under one, which would grow up through it. */
game.inventory.add('sprout', { ql: 20, extra: 'Oak' });
sql(`insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (w, 'player', u, 'sprout', 20, 1, 'Oak');`);
{
  const t = { kind: 'tile', x: 18, y: 24 };
  const mine = ACTION_BY_ID.get('plant')?.check?.(t as never, game) ?? 'ALLOWED';
  const theirs = psql(`select coalesce(act_refusal(${W}, ${DANE}, 'plant', '${JSON.stringify(t)}'::jsonb), 'ALLOWED');`);
  check('and no sprout is planted under one, on both sides', mine === "That tile is under Tower's jetty." && theirs === mine,
    `browser "${mine}", island "${theirs}"`);
}
same('but nothing rests on its railings', 'add_floor', { x: 18, y: 23 },
  'Nothing rests on a fence, a half wall or a railing: the storey below needs walls, or finished columns at both ends of every open side.');
unwall(1, 18, 24, 's');
const openMine = gapText(2, bld.levelGaps(bld.list.get(1)!, 1, 18.5, 23.5));
const openTheirs = psql(`select coalesce(level_gap(${W}, 1, 1, 18.5, 23.5), 'CLOSED IN');`);
check('and a jetty open to its storey with a side left bare leaves the storey open, the same words on both sides',
  openMine === 'Storey 2 is not closed in: 1 side with no wall or columns, nearest the south side of 18,24.' && openTheirs === openMine,
  `browser "${openMine}", island "${openTheirs}"`);
wall(1, 1, 18, 24, 's', 'railing', 'plank');

/* ---- shut off behind a door, it is a balcony ------------------------------ */
wall(1, 1, 18, 23, 's', 'door', 'plank');
check('shut off behind a door it is a balcony, outside the storey, on both sides',
  !bld.storeyArea(bld.list.get(1)!, 1).has('18,24')
    && psql(`select count(*) from frame_storey(${W}, 1, 1) where x = 18 and y = 24;`) === '0',
  `the storey is ${[...bld.storeyArea(bld.list.get(1)!, 1)].join(' ')}`);
says('and, shut off, names it a balcony', 18, 24,
  "Over it is a balcony of Tower's storey 2, shut off from the storey by a wall or a door: it takes a railing, and no roof.");
same('and a storey over it asks nothing of the balcony railing', 'add_floor', { x: 18, y: 23 }, 'ALLOWED');
same('and a balcony takes no roof', 'plan_floor', { x: 18, y: 24, material: 'plank', floorKind: 'roof', buildingId: 1 },
  'That jetty is shut off from storey 2 by a wall or a door, which makes it a balcony, and a balcony takes no roof.');

/* ---- the edge of it -------------------------------------------------------- */
/*
 * An edge with nothing on it stops you, as every upper floor's edge always has:
 * nothing is built out there to step onto. The browser's step rule, and the
 * island's `rpc_move` up a storey.
 */
unwall(1, 18, 24, 'w');
const stepMine = [game.stepRule(18, 24, 1, 17, 24), game.stepRule(18, 24, 1, 18, 25), game.stepRule(18, 24, 1, 18, 23)];
check('in the browser, off the bare edge and through the railing is no step, and through the door is',
  stepMine[0] === null && stepMine[1] === null && stepMine[2] === 1, `west ${stepMine[0]}, south ${stepMine[1]}, north ${stepMine[2]}`);
const move = (x0: number, y0: number, x1: number, y1: number, level: number): { x: number; y: number; blocked: boolean } => {
  psql(`update player set x = ${x0}, y = ${y0}, level = ${level}, moved_at = now() - interval '10 seconds', away = false
          where world_id = ${W} and uid = ${DANE};`);
  const out = psql(`
    select set_config('request.jwt.claims', json_build_object('sub', ${DANE})::text, false) \\g /dev/null
    select rpc_move(${W}, ${x1}, ${y1}, ${level})::text;`).split('\n').pop() ?? '{}';
  return JSON.parse(out) as { x: number; y: number; blocked: boolean };
};
const offEdge = move(18.5, 24.5, 17.2, 24.5, 1);
check('on the island, up a storey, a walk off the edge of the balcony stops at the edge',
  offEdge.blocked && Math.floor(offEdge.x) === 18, `stands at ${offEdge.x.toFixed(2)},${offEdge.y.toFixed(2)}`);
const inside = move(18.5, 24.5, 18.5, 23.4, 1);
check('and a walk onto the floor of the storey is let stand', !inside.blocked && Math.floor(inside.y) === 23,
  `stands at ${inside.x.toFixed(2)},${inside.y.toFixed(2)}`);
const ground = move(17.5, 24.5, 17.5, 25.5, 0);
check('while down on the ground under it nothing of that is asked', !ground.blocked && Math.floor(ground.y) === 25,
  `stands at ${ground.x.toFixed(2)},${ground.y.toFixed(2)}`);
wall(1, 1, 18, 24, 'w', 'railing', 'plank');

/* ---- round a flat roof ------------------------------------------------------ */
const tower = bld.list.get(1)!;
setLevels(1, 2, 1);
tower.roof = 'hip';
sql(`update building set roof = 'hip' where world_id = w and id = 1;`);
floor(1, 2, 18, 23, 'plank', 'roof');
floor(1, 2, 19, 23, 'plank', 'roof', 2);
const TERRACE = { x: 18, y: 23, side: 'n', wallType: 'railing', material: 'log', terrace: true };
same('a pitched roof is no terrace', 'plan_wall', TERRACE, 'Only a flat roof is a terrace.');
tower.roof = 'flat';
sql(`update building set roof = 'flat' where world_id = w and id = 1;`);
same('a flat one takes a railing round it', 'plan_wall', TERRACE, 'ALLOWED');
same('and nothing else', 'plan_wall', { ...TERRACE, wallType: 'solid' }, 'Only a railing goes round a terrace.');
same('and only where the roof is finished', 'plan_wall', { ...TERRACE, x: 19, side: 'e' }, 'Finish the roof on this tile first.');
const [terMine, terTheirs] = both('plan_wall', TERRACE, 'You plan');
check('planned, it stands on the roof\'s own level on both sides',
  terMine === terTheirs && bld.wall(2, 18, 23, 'n')?.type === 'railing'
    && psql(`select type from wall where world_id = ${W} and level = 2 and dir = 'h' and x = 18 and y = 23;`) === 'railing',
  `browser "${terMine}", island "${terTheirs}"`);
same('and the roof under a railing is not torn up from under it', 'remove_floor', { x: 18, y: 23, floorKind: 'roof' },
  'Take down the railing standing on it first.');
check('and a flat roof is walked on to its edge and no further, on both sides',
  game.standable(18, 23, 2) && psql(`select frame_stands(${W}, 18, 23, 2);`) === 't'
    && !game.standable(18, 22, 2) && psql(`select frame_stands(${W}, 18, 22, 2);`) === 'f');
// The roof off again, for what follows.
for (const [x, y] of [[18, 23], [19, 23]]) {
  bld.removeFloor(2, x, y);
  sql(`delete from floor_tile where world_id = w and level = 2 and x = ${x} and y = ${y};`);
}
unwall(2, 18, 23, 'n');
tower.roof = undefined;
sql(`update building set roof = null where world_id = w and id = 1;`);

/* ---- columns ---------------------------------------------------------------
 *
 *   (23,29)  a hall of one tile, on the settlement, with nothing on its sides.
 */
building(4, 'Hall', [[23, 29]], 1, 0);
stand(23.5, 29.5, 0);
const COL = { x: 23, y: 29, cx: 23, cy: 29, material: 'log' };
same('a column goes on a corner of the tile', 'plan_column', COL, 'ALLOWED');
same('and only on a corner of it', 'plan_column', { ...COL, cx: 25 }, 'Choose a corner of the tile.');
const [colMine, colTheirs] = both('plan_column', COL, 'You plan');
check('planning one is said the same on both sides, with its bill',
  colMine === colTheirs && colMine === `You plan a log column on the north-west corner. It needs ${columnBill('log').needed.log} logs.`,
  `browser "${colMine}", island "${colTheirs}"`);
same('and one is all a corner takes', 'plan_column', COL, 'There is already a column on that corner.');
same('building it wants its logs', 'build_column', COL, `You need ${columnBill('log').needed.log} logs.`);
check('and the island hears of the column job as one of the building jobs',
  psql(`select coalesce(act_refusal(${W}, ${DANE}, 'build_column', '${JSON.stringify({ kind: 'tile', ...COL })}'::jsonb), 'ALLOWED');`)
    === `You need ${columnBill('log').needed.log} logs.`);
// Logs to hand, and a unit laid on each side.
game.inventory.add('log', { ql: 30, count: 2 });
sql(`insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'log', 30, 2);`);
const [layMine, layTheirs] = both('build_column', COL, 'You fit');
check('and a unit laid in it is said the same on both sides', layMine === layTheirs && layMine.startsWith('You fit log into the column'),
  `browser "${layMine}", island "${layTheirs}"`);

/* Four columns, finished: an open hall. */
for (const [cx, cy] of [[23, 29], [24, 29], [24, 30], [23, 30]]) column(4, 0, cx, cy, 'log');
const hallMine = gapText(1, bld.levelGaps(bld.list.get(4)!, 0, 23.5, 29.5));
const hallTheirs = psql(`select coalesce(level_gap(${W}, 4, 0, 23.5, 29.5), 'CLOSED IN');`);
check('four finished columns close a storey in with no wall on it, on both sides',
  hallMine === null && hallTheirs === 'CLOSED IN', `browser ${hallMine ?? 'CLOSED IN'}, island ${hallTheirs}`);
same('so a roof goes on four columns', 'plan_floor', { x: 23, y: 29, material: 'log', floorKind: 'roof' }, 'ALLOWED');
column(4, 0, 24, 30, 'log', 1);
says('Examine lists the columns on a tile\'s corners and what one going up still needs', 23, 29,
  'Columns: log on the north-west corner; log on the north-east corner; log on the south-west corner; log on the south-east corner (needs 1 log).');
const oneShort = gapText(1, bld.levelGaps(bld.list.get(4)!, 0, 23.5, 29.5));
const oneShortTheirs = psql(`select coalesce(level_gap(${W}, 4, 0, 23.5, 29.5), 'CLOSED IN');`);
check('and a column still going up leaves both its sides open, in the same words',
  oneShort === 'Storey 1 is not closed in: 2 sides with no wall or columns, nearest the east side of 23,29.' && oneShortTheirs === oneShort,
  `browser "${oneShort}", island "${oneShortTheirs}"`);
column(4, 0, 24, 30, 'log');

/* Roofed: what lies there keeps as it would indoors, and a bed is still in the open. */
floor(4, 1, 23, 29, 'log', 'roof');
says('and under a roof on columns says what the roof is worth and what it is not', 23, 29,
  'Columns: log on the north-west corner; log on the north-east corner; log on the south-west corner; log on the south-east corner.'
  + ` Under a roof on columns: what is left here decays at ${Math.round(INDOORS_DECAY * 100)}% of the rate in the open, but a bed here is in the open: the ×${INDOORS_REST} rest of a bed indoors wants walls all round.`);
const keepMine = game.decayMultiplier(23, 29), keepTheirs = Number(psql(`select decay_multiplier(${W}, 23, 29);`));
const openMine2 = game.decayMultiplier(26, 29), openTheirs2 = Number(psql(`select decay_multiplier(${W}, 26, 29);`));
check('under a roof on columns things rot at a tenth of what they would beside it, on both sides',
  Math.abs(keepMine / openMine2 - 0.1) < 1e-9 && Math.abs(keepTheirs / openTheirs2 - 0.1) < 1e-9 && Math.abs(keepMine - keepTheirs) < 1e-9,
  `browser ${keepMine} against ${openMine2}, island ${keepTheirs} against ${openTheirs2}`);
same('and a column carrying a side under the roof comes down only after the roof, and says which side', 'remove_column', { x: 23, y: 29, cx: 24, cy: 30 },
  'The south side of 23,29 is carried on this column: wall it, or take off what is over it, first.');
check('but it is no room to sleep in: indoors is walls all round, on both sides',
  !bld.indoors(0, 23, 29) && psql(`select indoors(${W}, 0, 23, 29);`) === 'f' && bld.sheltered(0, 23, 29)
    && psql(`select sheltered(${W}, 0, 23, 29);`) === 't');
uncolumn(0, 24, 30);
check('and with a column gone it is out in the weather again, on both sides',
  !bld.sheltered(0, 23, 29) && psql(`select sheltered(${W}, 0, 23, 29);`) === 'f'
    && Math.abs(game.decayMultiplier(23, 29) - Number(psql(`select decay_multiplier(${W}, 23, 29);`))) < 1e-9);
column(4, 0, 24, 30, 'log');

/* What columns carry, and how high. */
bld.removeFloor(1, 23, 29);
sql(`delete from floor_tile where world_id = w and level = 1 and x = 23 and y = 29;`);
same('a storey goes up on four columns', 'add_floor', { x: 23, y: 29 }, 'ALLOWED');
setLevels(4, 2, 1);
floor(4, 1, 23, 29, 'plank', 'floor', 2);
same('and a column is raised on the finished floor of its storey', 'plan_column', { ...COL, material: 'plank' },
  'Build the floor of this storey first.');
floor(4, 1, 23, 29, 'plank');
check('and what is over them may be no heavier than they are, on both sides',
  bld.bearing(bld.list.get(4)!, 1) === 1 && psql(`select bearing(${W}, 4, 1);`) === '1');
same('so marble will not go up over log columns', 'plan_wall', { x: 23, y: 29, side: 'n', wallType: 'solid', material: 'marble' },
  'Marble is too heavy to raise over what is under it. This storey carries timber, no more.');
same('nor a marble column', 'plan_column', { ...COL, material: 'marble' },
  'Marble is too heavy to raise over what is under it. This storey carries timber, no more.');
setLevels(4, 3, 2);
same('and log columns will not stand a fourth storey', 'add_floor', { x: 23, y: 29 }, 'Log will not stand 4 storeys. 3 is as high as it goes.');
setLevels(4, 2, 1);
bld.removeFloor(1, 23, 29);
sql(`delete from floor_tile where world_id = w and level = 1 and x = 23 and y = 29;`);
column(4, 1, 23, 29, 'plank');
same('columns on the top storey come down before it does', 'remove_storey', { x: 23, y: 29 }, 'Take down the columns of the top storey first.');
uncolumn(1, 23, 29);
setLevels(4, 1, 0);
same('and the columns on its corners before a tile leaves the plan', 'remove_from_plan', { x: 23, y: 29 },
  'Take down the columns on its corners first.');
const [downMine, downTheirs] = both('remove_column', { x: 23, y: 29, cx: 24, cy: 30 }, 'You take down');
check('taking one down is said the same on both sides', downMine === downTheirs && downMine === 'You take down the column on the south-east corner.',
  `browser "${downMine}", island "${downTheirs}"`);

/* ---- what a floor up a storey holds up ---------------------------------------
 *
 *   (22,23)  a loft, walled round, its storey-2 floor finished;
 *   (22,24)  a jetty of it with nothing on its edges.
 */
building(5, 'Loft', [[22, 23]], 2, 1);
for (const side of ['n', 'e', 's', 'w'] as Side[]) wall(5, 0, 22, 23, side, 'solid', 'log');
floor(5, 1, 22, 23, 'plank');
floor(5, 1, 22, 24, 'plank');
const LOFT_JETTY = { x: 22, y: 24, buildingId: 5 };
column(5, 1, 22, 24, 'plank');
same('a column with the storey\'s own floor still under it is no bar to tearing up the jetty', 'remove_floor', LOFT_JETTY, 'ALLOWED');
column(5, 1, 23, 25, 'plank');
same('but one standing on the jetty and nothing else is', 'remove_floor', LOFT_JETTY, 'Take down the column on its south-east corner first.');
uncolumn(1, 22, 24);
uncolumn(1, 23, 25);
floor(5, 2, 22, 23, 'plank', 'roof');
floor(5, 2, 22, 24, 'plank', 'roof');
same('and a jetty with the roof over it comes up only after the roof', 'remove_floor', LOFT_JETTY, 'Take the roof over it off first.');
same('which itself comes off', 'remove_floor', { ...LOFT_JETTY, floorKind: 'roof' }, 'ALLOWED');

/*
 * A roof over a jetty rests on walls or columns round it. The roof over the
 * jetty off again, the storey walled round, the jetty railed: nothing for a
 * roof to stand on out there until a post goes up at each corner.
 */
unfloor(2, 22, 24);
for (const side of ['n', 'e', 'w'] as Side[]) wall(5, 1, 22, 23, side, 'solid', 'plank');
for (const side of ['e', 's', 'w'] as Side[]) wall(5, 1, 22, 24, side, 'railing', 'plank');
const LOFT_ROOF = { ...LOFT_JETTY, material: 'plank', floorKind: 'roof' };
same('a roof over a railed jetty: a railing carries nothing, and the first corner short of a post is named', 'plan_floor', LOFT_ROOF,
  'A roof over the jetty rests on walls or columns: raise a column on its south-east corner first. A railing carries nothing.');
column(5, 1, 23, 25, 'plank');
same('and then the next', 'plan_floor', LOFT_ROOF,
  'A roof over the jetty rests on walls or columns: raise a column on its south-west corner first. A railing carries nothing.');
column(5, 1, 22, 25, 'plank');
same('with a post at each outer corner the roof goes over the jetty, its inner corners carried by the ends of the loft\'s walls', 'plan_floor', LOFT_ROOF, 'ALLOWED');
floor(5, 2, 22, 23, 'plank', 'roof');
floor(5, 2, 22, 24, 'plank', 'roof');
same('and a post a side under it rests on stays up, naming the side', 'remove_column', { ...LOFT_JETTY, cx: 23, cy: 25 },
  'The south side of 22,24 is carried on this column: wall it, or take off what is over it, first.');
/* Walls for the railings: the roof on its walls, and the one wall a side of it rests on stays up. */
for (const side of ['e', 's', 'w'] as Side[]) wall(5, 1, 22, 24, side, 'solid', 'plank');
for (const [cx, cy] of [[23, 25], [22, 25]]) uncolumn(1, cx, cy);
same('a wall a roof over the jetty rests on stays up', 'remove_wall', { ...LOFT_JETTY, side: 's' },
  'The roof over the jetty rests on this wall: raise a column at each end of it, or take the roof off, first.');
column(5, 1, 22, 25, 'plank');
column(5, 1, 23, 25, 'plank');
same('while with a post at each end of it, it comes down', 'remove_wall', { ...LOFT_JETTY, side: 's' }, 'ALLOWED');
uncolumn(1, 22, 25);
uncolumn(1, 23, 25);
/* And no wall or door shuts a roofed jetty off from its storey: it would be a balcony under a roof. */
same('no wall goes between a storey and its roofed jetty', 'plan_wall', { x: 22, y: 23, side: 's', wallType: 'door', material: 'plank' },
  'The roof is over that jetty: take it off first. A balcony takes no roof.');
/* A column on a corner walls carry carries nothing, and comes down under a floor: named by its storey (`level`). */
column(5, 0, 22, 23, 'log');
column(5, 0, 23, 23, 'log');
same('a column whose sides walls carry comes down, a floor over it or not, asked of storey 1 from storey 2',
  'remove_column', { x: 22, y: 23, cx: 23, cy: 23, level: 0 }, 'ALLOWED');
uncolumn(0, 22, 23);
uncolumn(0, 23, 23);

/*
 * ---- a storey over a jettied room ----------------------------------------
 *
 *   (25,25)  a tower of three storeys; storey 2 floored out a tile on the
 *   (25,26)  south, open to it: storey 3 floors over that room, on its walls.
 */
building(6, 'Tall', [[25, 25]], 3, 2);
for (const side of ['n', 'e', 's', 'w'] as Side[]) wall(6, 0, 25, 25, side, 'solid', 'log');
floor(6, 1, 25, 25, 'plank');
floor(6, 1, 25, 26, 'plank');
floor(6, 2, 25, 25, 'plank');
const OVER = { x: 25, y: 26, material: 'plank', floorKind: 'floor', buildingId: 6, level: 2 };
same('a floor of storey 3 goes over the jetty of storey 2 inside that storey', 'plan_floor', OVER, 'ALLOWED');
floor(6, 1, 25, 26, 'plank', 'floor', 2);
same('but not over one still being laid', 'plan_floor', OVER,
  'A jetty rests on a finished full-height wall of storey 2: build one on a side this tile shares with Tall first.');
floor(6, 1, 25, 26, 'plank');
floor(6, 2, 25, 26, 'plank');
same('and the jetty under it does not come up from under it', 'remove_floor', { x: 25, y: 26, buildingId: 6, level: 1 },
  'The floor of storey 3 rests on it: take that up first.');
/* A job names its storey, and both sides put it there: a column on storey 2 asked while storey 3 is worked. */
{
  const [mine, theirs] = both('plan_column', { x: 25, y: 25, cx: 26, cy: 26, material: 'log', level: 1 }, 'You plan');
  check('a column planned for storey 2 from storey 3 stands on storey 2, on both sides',
    mine === theirs && !!bld.column(1, 26, 26)
      && psql(`select level from building_column where world_id = ${W} and x = 26 and y = 26;`) === '1',
    `browser "${mine}", island "${theirs}"`);
  uncolumn(1, 26, 26);
}

/*
 * ---- a column on a joint in a wall ---------------------------------------
 *
 *   (20,28) (21,28)  two tiles walled round under a roof, a column at each
 *   end of the side between them: inside the storey, that side carries nothing.
 */
building(7, 'Pair', [[20, 28], [21, 28]], 1, 0);
for (const [x, side] of [[20, 'n'], [20, 's'], [20, 'w'], [21, 'n'], [21, 's'], [21, 'e']] as Array<[number, Side]>) wall(7, 0, x, 28, side, 'solid', 'log');
floor(7, 1, 20, 28, 'plank', 'roof');
floor(7, 1, 21, 28, 'plank', 'roof');
column(7, 0, 21, 28, 'log');
column(7, 0, 21, 29, 'log');
same('a column on a joint in its walls comes down under the roof they carry: the side it closes is inside the storey',
  'remove_column', { x: 20, y: 28, cx: 21, cy: 28 }, 'ALLOWED');
unwall(0, 21, 28, 's');
column(7, 0, 22, 29, 'log');
same('but with a wall gone for a column at its far end, the side they close is the storey\'s edge, and it stays up',
  'remove_column', { x: 21, y: 28, cx: 21, cy: 29 }, 'The south side of 21,28 is carried on this column: wall it, or take off what is over it, first.');
for (const [cx, cy] of [[21, 28], [21, 29], [22, 29]]) uncolumn(0, cx, cy);

/*
 * ---- a floor beside a wall ------------------------------------------------------
 *
 *   (20,28)  walled on three sides. A wall stands on a floor only where it may
 *   not go up without a finished one (`plan_wall`), a storey up or on a deck;
 *   on the ground floor it stands on the ground. So a floor planned beside a
 *   wall can be called off again, and a finished one there taken up.
 */
floor(7, 0, 20, 28, 'plank', 'floor', 2);
same('a floor still planned beside a wall is called off without the wall coming down', 'remove_floor', { x: 20, y: 28, level: 0 }, 'ALLOWED');
floor(7, 0, 20, 28, 'plank');
same('and a finished one on the ground floor comes up too: its walls stand on the ground', 'remove_floor', { x: 20, y: 28, level: 0 }, 'ALLOWED');
unfloor(0, 20, 28);

/*
 * ---- the storey a job names ------------------------------------------------
 *
 *   (23,31) (24,31)  three storeys, the third being worked: every ordinary
 *   job sent for storey 1 (`level` 0) or storey 2 is done there, on both sides.
 */
building(8, 'Three', [[23, 31], [24, 31]], 3, 2);
const THREE = { x: 23, y: 31 };
/** Which storeys a wall stands on, on each side: the browser's, then the island's. */
const wallStoreys = (x: number, y: number, side: Side): [string, string] => {
  const { bx, by, dir } = along(x, y, side);
  const mine = [0, 1, 2].filter((l) => !!bld.wall(l, x, y, side)).join(',');
  const theirs = psql(`select coalesce(string_agg(level::text, ',' order by level), '') from wall where world_id = ${W} and dir = '${dir}' and x = ${bx} and y = ${by};`);
  return [mine, theirs];
};
const floorStoreys = (x: number, y: number): [string, string] => [
  [0, 1, 2].filter((l) => !!bld.floor(l, x, y)).map((l) => `${l}:${floorKind(bld.floor(l, x, y)!)}`).join(','),
  psql(`select coalesce(string_agg(level || ':' || kind, ',' order by level), '') from floor_tile where world_id = ${W} and x = ${x} and y = ${y};`),
];
// The ground floor's own floor, laid and torn up again from storey 3, before any wall stands on it.
same('a floor planned for storey 1 while storey 3 is worked is allowed', 'plan_floor', { ...THREE, material: 'plank', level: 0 }, 'ALLOWED');
{
  const [mine, theirs] = both('plan_floor', { ...THREE, material: 'plank', level: 0 }, 'You plan');
  const [onMine, onTheirs] = floorStoreys(23, 31);
  check('and it goes down on storey 1, on both sides', mine === theirs && onMine === '0:floor' && onTheirs === onMine,
    `browser "${mine}" on ${onMine}, island "${theirs}" on ${onTheirs}`);
}
same('and it comes up from storey 1 again', 'remove_floor', { ...THREE, level: 0 }, 'ALLOWED');
{
  const [mine, theirs] = both('remove_floor', { ...THREE, level: 0 }, 'You remove');
  const [onMine, onTheirs] = floorStoreys(23, 31);
  check('and it is gone from storey 1, on both sides', mine === theirs && onMine === '' && onTheirs === '',
    `browser "${mine}" leaving ${onMine || 'nothing'}, island "${theirs}" leaving ${onTheirs || 'nothing'}`);
}
for (const level of [0, 1, 2]) {
  for (const [x, side] of [[23, 'n'], [23, 's'], [23, 'w'], [24, 'n'], [24, 's'], [24, 'e']] as Array<[number, Side]>) wall(8, level, x, 31, side, 'solid', 'log');
}
floor(8, 1, 24, 31, 'plank');
floor(8, 2, 23, 31, 'plank');
floor(8, 2, 24, 31, 'plank');
// Stairs on storey 1 are refused, naming the storeys to work on; on storey 2 they go there, not up on storey 3.
same('stairs asked for storey 1 of a building with storeys over it say to work a storey up', 'plan_floor',
  { ...THREE, material: 'plank', floorKind: 'stairs', side: 's', level: 0 }, 'Work on storey 2 or above to plan stairs here.');
same('and so does a ladder', 'plan_floor', { ...THREE, material: 'plank', floorKind: 'ladder', side: 's', level: 0 },
  'Work on storey 2 or above to plan a ladder here.');
same('while in a building of one storey they ask for another storey first', 'plan_floor',
  { x: 20, y: 28, material: 'plank', floorKind: 'stairs', side: 's' }, 'Stairs and ladders belong to an upper storey; plan another storey first.');
{
  const stairs = { ...THREE, material: 'plank', floorKind: 'stairs', side: 's', level: 1 };
  same('stairs planned for storey 2 while storey 3 is worked are allowed', 'plan_floor', stairs, 'ALLOWED');
  const [mine, theirs] = both('plan_floor', stairs, 'You plan');
  const [onMine, onTheirs] = floorStoreys(23, 31);
  check('and they go in on storey 2, on both sides', mine === theirs && onMine === '1:stairs,2:floor' && onTheirs === onMine,
    `browser "${mine}" on ${onMine}, island "${theirs}" on ${onTheirs}`);
}
// A wall planned for storey 1, between the two rooms.
{
  const plan = { ...THREE, side: 'e', wallType: 'solid', material: 'log', level: 0 };
  same('a wall planned for storey 1 is allowed', 'plan_wall', plan, 'ALLOWED');
  const [mine, theirs] = both('plan_wall', plan, 'You plan');
  const [onMine, onTheirs] = wallStoreys(23, 31, 'e');
  check('and it goes up on storey 1 alone, on both sides', mine === theirs && onMine === '0' && onTheirs === '0',
    `browser "${mine}" on ${onMine}, island "${theirs}" on ${onTheirs}`);
}
// Paint brushed onto storey 1's wall, and onto no other.
// A bucket of blue dye, five litres at QL 50, on both sides.
const BLUE = dyeText(pureDye('blue', 50), 5);
game.inventory.add('dye_bucket', { ql: 60 }).dye = BLUE;
sql(`insert into item (world_id, holder, holder_uid, def, ql, count, dye) values (w, 'player', u, 'dye_bucket', 60, 1, '${BLUE}');`);
{
  const paint = { ...THREE, side: 'n', level: 0 };
  same('storey 1\'s north wall is painted from storey 3', 'paint_wall', paint, 'ALLOWED');
  const [mine, theirs] = both('paint_wall', paint, 'You brush');
  const dyedMine = [0, 1, 2].map((l) => bld.wall(l, 23, 31, 'n')?.dye ?? '-').join(',');
  const dyedTheirs = psql(`select string_agg(coalesce(dye, '-'), ',' order by level) from wall where world_id = ${W} and dir = 'h' and x = 23 and y = 31;`);
  check('and the paint goes on storey 1\'s wall only, on both sides', mine === theirs && dyedMine === `${dyeHex(pureDye('blue', 50))},-,-` && dyedTheirs === dyedMine,
    `browser "${mine}" ${dyedMine}, island "${theirs}" ${dyedTheirs}`);
}
// The storeys over a wall stand on it: taken down from the top, or carried on columns first.
same('storey 1\'s wall under storey 2\'s stays up', 'remove_wall', { ...THREE, side: 'n', level: 0 },
  'Storey 2 stands on this wall: raise a column at each end of it, or take down the wall over it, first.');
same('and storey 2\'s under storey 3\'s', 'remove_wall', { ...THREE, side: 'n', level: 1 },
  'Storey 3 stands on this wall: raise a column at each end of it, or take down the wall over it, first.');
same('storey 3\'s comes down', 'remove_wall', { ...THREE, side: 'n', level: 2 }, 'ALLOWED');
for (const level of [2, 1, 0]) {
  if (level < 2) same(`and then storey ${level + 1}'s`, 'remove_wall', { ...THREE, side: 'n', level }, 'ALLOWED');
  const [mine, theirs] = both('remove_wall', { ...THREE, side: 'n', level }, 'You take down');
  const [onMine, onTheirs] = wallStoreys(23, 31, 'n');
  const left = [0, 1, 2].filter((l) => l < level).join(',');
  check(`taking storey ${level + 1}'s down leaves the storeys under it, on both sides`, mine === theirs && onMine === left && onTheirs === left,
    `browser "${mine}" leaving ${onMine || 'none'}, island "${theirs}" leaving ${onTheirs || 'none'}`);
}
column(8, 0, 24, 31, 'log');
column(8, 0, 25, 31, 'log');
same('a wall under a storey comes down once a column at each end carries the side', 'remove_wall', { x: 24, y: 31, side: 'n', level: 0 }, 'ALLOWED');
uncolumn(0, 24, 31);
uncolumn(0, 25, 31);
// What stands over it is a wall with something of it built: a plan stands on nothing.
wall(8, 0, 23, 31, 'n', 'solid', 'log');
{
  wall(8, 1, 23, 31, 'n', 'solid', 'log');
  const up = bld.wall(1, 23, 31, 'n')!;
  for (const k of Object.keys(up.needed)) up.needed[k] = up.total[k];
  sql(`update wall set needed = total where world_id = w and level = 1 and dir = 'h' and x = 23 and y = 31;`);
}
same('a wall of storey 2 planned over it, with nothing in it yet, stands on nothing: storey 1\'s comes down', 'remove_wall',
  { ...THREE, side: 'n', level: 0 }, 'ALLOWED');
{
  const up = bld.wall(1, 23, 31, 'n')!;
  const first = Object.keys(up.needed)[0];
  up.needed[first] = up.total[first] - 1;
  sql(`update wall set needed = jsonb_set(needed, '{${first}}', to_jsonb(${up.needed[first]})) where world_id = w and level = 1 and dir = 'h' and x = 23 and y = 31;`);
}
same('one with any of its materials in stands on it', 'remove_wall', { ...THREE, side: 'n', level: 0 },
  'Storey 2 stands on this wall: raise a column at each end of it, or take down the wall over it, first.');
unwall(1, 23, 31, 'n');

/*
 * ---- a loggia roofed on three posts ---------------------------------------
 *
 *   (25,21) (26,21)  two storeys walled round, and on the south of storey 2 a
 *   (25,22) (26,22)  loggia open to it, railed: its sides out from the house
 *   run from the ends of the house's own walls, so three posts at its outer
 *   corners carry the roof.
 */
building(9, 'Porch', [[25, 21], [26, 21]], 2, 1);
for (const [x, side] of [[25, 'n'], [25, 's'], [25, 'w'], [26, 'n'], [26, 's'], [26, 'e']] as Array<[number, Side]>) wall(9, 0, x, 21, side, 'solid', 'log');
for (const [x, side] of [[25, 'n'], [25, 'w'], [26, 'n'], [26, 'e']] as Array<[number, Side]>) wall(9, 1, x, 21, side, 'solid', 'log');
for (const x of [25, 26]) { floor(9, 1, x, 21, 'plank'); floor(9, 1, x, 22, 'plank'); }
for (const [x, side] of [[25, 'w'], [25, 's'], [26, 's'], [26, 'e']] as Array<[number, Side]>) wall(9, 1, x, 22, side, 'railing', 'plank');
const PORCH_ROOF = { x: 25, y: 22, buildingId: 9, material: 'plank', floorKind: 'roof' };
same('a roof over a loggia asks first for the post at its outer corner', 'plan_floor', PORCH_ROOF,
  'A roof over the jetty rests on walls or columns: raise a column on its south-west corner first. A railing carries nothing.');
for (const cx of [25, 26, 27]) column(9, 1, cx, 23, 'plank');
same('and with a post at each outer corner the ends of the house\'s walls carry the rest', 'plan_floor', PORCH_ROOF, 'ALLOWED');
same('over both tiles of it', 'plan_floor', { ...PORCH_ROOF, x: 26 }, 'ALLOWED');
// Roofed, the end of the house's wall a side of the loggia rests on stays up, unless a column takes that corner.
for (const [x, y] of [[25, 21], [26, 21], [25, 22], [26, 22]]) floor(9, 2, x, y, 'plank', 'roof');
same('the house\'s wall whose end is all that carries the loggia\'s side stays up, naming that end', 'remove_wall', { x: 25, y: 21, side: 'w' },
  'The roof over the jetty rests on the south end of this wall: raise a column there, or take the roof off, first.');
same('and so does the one on the other side', 'remove_wall', { x: 26, y: 21, side: 'e' },
  'The roof over the jetty rests on the south end of this wall: raise a column there, or take the roof off, first.');
column(9, 1, 25, 22, 'plank');
same('with a column on that corner it comes down', 'remove_wall', { x: 25, y: 21, side: 'w' }, 'ALLOWED');
/*
 * And that column, once it alone carries the corner, stays up while the roof
 * does: the house's wall down, and the loggia's south side walled at its
 * west end, so the post at the far end of its west side is not wanted.
 */
unwall(1, 25, 21, 'w');
wall(9, 1, 25, 22, 's', 'solid', 'plank');
uncolumn(1, 25, 23);
const LOGGIA_POST = { x: 25, y: 22, cx: 25, cy: 22, buildingId: 9 };
same('the column that alone carries the end of the loggia\'s open side stays up, naming the side', 'remove_column', LOGGIA_POST,
  'The roof over the jetty rests on this column: wall the west side of 25,22, or take the roof off, first.');
wall(9, 1, 25, 22, 'w', 'solid', 'plank');
same('and with that side walled it comes down', 'remove_column', LOGGIA_POST, 'ALLOWED');
wall(9, 1, 25, 21, 'w', 'solid', 'log');
for (const side of ['w', 's'] as Side[]) wall(9, 1, 25, 22, side, 'railing', 'plank');
column(9, 1, 25, 23, 'plank');
uncolumn(1, 25, 22);
for (const [x, y] of [[25, 21], [26, 21], [25, 22], [26, 22]]) unfloor(2, x, y);
for (const cx of [25, 26, 27]) uncolumn(1, cx, 23);

/*
 * ---- a neighbour's jetty wall over a wall --------------------------------
 *
 *   (17,21) (18,21) (19,21)  Left, its storey-2 jetty walled on the east, and
 *   Right, whose west wall is under that jetty wall: a storey of its own
 *   building is all that stands on a wall.
 */
building(10, 'Left', [[17, 21]], 2, 1);
building(11, 'Right', [[19, 21]], 2, 1);
for (const side of ['n', 'e', 's', 'w'] as Side[]) { wall(10, 0, 17, 21, side, 'solid', 'log'); wall(11, 0, 19, 21, side, 'solid', 'log'); }
floor(10, 1, 17, 21, 'plank');
floor(10, 1, 18, 21, 'plank');
wall(10, 1, 18, 21, 'e', 'solid', 'plank');
same('Right\'s wall under Left\'s jetty wall is its own: it comes down', 'remove_wall', { x: 19, y: 21, side: 'w', level: 0 }, 'ALLOWED');
same('while the wall Left\'s jetty rests on stays up', 'remove_wall', { x: 17, y: 21, side: 'e', level: 0 },
  'A jetty of storey 2 rests on this wall: raise a column at each end of it, or tear the jetty up, first.');

/*
 * The ground under a jetty is its building's, as the ground under the
 * footprint is: no corner of it is dug or raised (`corner_under_building`,
 * which every corner job asks). Asked here of a spadeful of dirt dropped on
 * it, which both sides put to that one rule.
 */
game.inventory.add('dirt', { ql: 20, count: 2 });
sql(`insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'dirt', 20, 2);`);
stand(22.5, 25.5, 0);
{
  const t = { kind: 'tile', x: 22, y: 25, cx: 23, cy: 25 };
  const mine = ACTION_BY_ID.get('drop_dirt')?.check?.(t as never, game) ?? 'ALLOWED';
  const theirs = psql(`select coalesce(act_refusal(${W}, ${DANE}, 'drop_dirt', '${JSON.stringify(t)}'::jsonb), 'ALLOWED');`);
  check('a corner under a jetty is not dug or raised, on both sides', mine === 'You cannot dig under a building.' && theirs === mine,
    `browser "${mine}", island "${theirs}"`);
  // A corner a tile further out has nothing over it.
  const clear = { ...t, cy: 26 };
  const mineClear = ACTION_BY_ID.get('drop_dirt')?.check?.(clear as never, game) ?? 'ALLOWED';
  const theirsClear = psql(`select coalesce(corner_under_building(${W}, 23, 26), 'CLEAR');`);
  check('while one a tile past it is open ground, on both sides', mineClear !== 'You cannot dig under a building.' && theirsClear === 'CLEAR',
    `browser "${mineClear}", island "${theirsClear}"`);
}

/* ---- and what reaches a browser -------------------------------------------- */
const seen = JSON.parse(psql(`
  select set_config('request.jwt.claims', json_build_object('sub', ${DANE})::text, false) \\g /dev/null
  select (rpc_ground(${W}, 40, true)->'buildings')::text;`).split('\n').pop() ?? '{}') as {
    columns?: Array<{ x: number; y: number; level: number; material: string; building: number }>;
    floors?: Array<{ x: number; y: number; level: number; building: number }>;
    list?: Array<{ id: number; roof?: string | null }>;
  };
check('the ground read hands a browser the columns and the jetty', (seen.columns?.length ?? 0) === 3
    && !!seen.floors?.some((f) => f.x === 18 && f.y === 24 && f.level === 1 && f.building === 1),
  `${seen.columns?.length ?? 0} columns, jetty ${seen.floors?.some((f) => f.x === 18 && f.y === 24) ? 'there' : 'missing'}`);
const g2 = Game.create(4242);
g2.buildings.sawIsland(seen as never);
check('and a browser lays them in as the island has them', g2.buildings.columns.size === 3 && g2.buildings.jettyAt(18, 24)?.id === 1
  && isDone(g2.buildings.column(0, 23, 29)!), `${g2.buildings.columns.size} columns, jetty of ${g2.buildings.jettyAt(18, 24)?.name}`);

/*
 * ---- where it meets the rest of a building ---------------------------------
 *
 *   (16,31) (17,31)   Stilts, two storeys on piers under a deck at thirty: a
 *                     stone-brick deck on the second tile, none yet on the
 *                     first; plank walls on the second's other three sides;
 *   (17,32)           its jetty, over ground that rises toward the deck;
 *   (19,31)           Cellared, one storey, a column on a corner and a cellar
 *                     dug out under it;
 *   (22,32) (22,33)   Shop, two storeys, a shop counter in its south wall and
 *                     a jetty resting on the counter;
 *   (14,32)..(20,32)  the line of an aqueduct from a pool to a fountain.
 *
 * Each is a rule of another batch's that a jetty, a railing or a column runs
 * into, put to both sides as the rest are.
 */
// Dane's settlement over the whole of this ground, on both sides.
(game as unknown as { deed: { radius: number } }).deed.radius = 7;
sql(`update deed set radius = 7 where world_id = w and founded_by = u;`);
const DECK = BASE + 10;
{
  const b = bld.create('Stilts', 17, 31, DECK);
  if (b.id !== 12) throw new Error(`the browser numbered Stilts ${b.id}, not 12`);
  bld.addTile(b, 16, 31, DECK);
  b.levels = 2;
  b.workLevel = 1;
  sql(`insert into building (world_id, id, name, levels, work_level, planned_by, deck) values (w, 12, 'Stilts', 2, 1, u, ${DECK});
    insert into building_tile (world_id, building, x, y, pier) values (w, 12, 17, 31, true), (w, 12, 16, 31, true);`);
}
floor(12, 0, 17, 31, 'stone_brick');
for (const side of ['n', 'e', 's'] as Side[]) wall(12, 0, 17, 31, side, 'solid', 'plank');

// Off a building on piers a jetty's storeys count from the deck, not from the ground under it.
for (const x of [17, 18]) setCorner(x, 33, BASE + 5);
const STILTS_JETTY = { x: 17, y: 32, material: 'plank', buildingId: 12 };
same('a jetty off a building on piers is floored a storey over its deck, over ground higher than the ground under the deck',
  'plan_floor', STILTS_JETTY, 'ALLOWED');
for (const x of [17, 18]) setCorner(x, 33, DECK + 5);
same('and refused where the ground under it rises over the deck', 'plan_floor', STILTS_JETTY,
  'The ground under it rises above the floor of storey 1: dig it down, or floor the jetty out a storey higher.');
for (const x of [17, 18]) setCorner(x, 33, BASE + 5);

// Not over an aqueduct's span, in the aqueduct's own words; over a bridge's end, which is its bank, as over any ground.
{
  const aq = game.addBridge('aqueduct', 14, 32, 20, 32, 58);
  sql(`with b as (insert into bridge (world_id, kind, ax, ay, bx, by, height) values (w, 'aqueduct', 14, 32, 20, 32, 58) returning id)
    insert into bridge_span (world_id, bridge, n, x, y, needed, total) select w, b.id, t.n, t.x, t.y, '{}'::jsonb, '{}'::jsonb from b, span_tiles(14, 32, 20, 32) t;`);
  same('no jetty is floored over the span of an aqueduct', 'plan_floor', STILTS_JETTY, AQ_OVER);
  game.removeBridge(aq.id);
  const rope = game.addBridge('rope', 17, 32, 17, 34, 40);
  sql(`delete from bridge_span where world_id = w; delete from bridge where world_id = w;
    with b as (insert into bridge (world_id, kind, ax, ay, bx, by, height) values (w, 'rope', 17, 32, 17, 34, 40) returning id)
    insert into bridge_span (world_id, bridge, n, x, y, needed, total) select w, b.id, t.n, t.x, t.y, '{}'::jsonb, '{}'::jsonb from b, span_tiles(17, 32, 17, 34) t;`);
  same('but one is over the end of a bridge, the bank it lands on', 'plan_floor', STILTS_JETTY, 'ALLOWED');
  game.removeBridge(rope.id);
  sql(`delete from bridge_span where world_id = w; delete from bridge where world_id = w;`);
}
floor(12, 1, 17, 32, 'plank');

// Glass is a pitched roof's, out over a jetty as over the footprint, and asked before anything about the jetty.
bld.list.get(12)!.roof = 'flat';
sql(`update building set roof = 'flat' where world_id = w and id = 12;`);
same('no glass over a jetty under a flat roof', 'plan_floor', { ...STILTS_JETTY, material: 'glass', floorKind: 'roof' }, GLASS_PITCHED);
bld.list.get(12)!.roof = undefined;
sql(`update building set roof = null where world_id = w and id = 12;`);
same('and glass is no floor out on a jetty, which is said before the storey the job is on', 'plan_floor',
  { ...STILTS_JETTY, material: 'glass', level: 0 }, GLASS_ROOF_ONLY);

// An aqueduct is not set out under a jetty, as a bridge is not; with the jetty up, the same one is.
{
  const pool = game.addFoundation(14, 32, BASE + 40, 0);
  pool.pool = true;
  const fountain = game.addFurniture('fountain', 20, 32, 0, 0, 80);
  sql(`insert into foundation (world_id, id, x, y, top, needed, total, pool) values (w, 9991, 14, 32, ${BASE + 40}, '{"concrete":0}', '{"concrete":1}', true);
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql) values (w, 'furniture', 'fountain', 20, 32, 0, 0, 20.375, 32.375, 80);`);
  const aqueduct = (): [string, string] => {
    const r = aqueductPlan(game, 14, 32, 20, 32);
    return [typeof r === 'string' ? r : 'ALLOWED', psql(`select coalesce(aqueduct_plan(${W}, ${DANE}, 14, 32, 20, 32)->>'refused', 'ALLOWED');`)];
  };
  const [under, underIsland] = aqueduct();
  check('an aqueduct is not set out under a jetty, on both sides', under === "Not over a building's jetty." && underIsland === under,
    `browser "${under}", island "${underIsland}"`);
  unfloor(1, 17, 32);
  const [clear, clearIsland] = aqueduct();
  check('and with the jetty torn up the same aqueduct is set out, on both sides', clear === 'ALLOWED' && clearIsland === clear,
    `browser "${clear}", island "${clearIsland}"`);
  floor(12, 1, 17, 32, 'plank');
  game.removeFoundation(pool.id);
  game.removeFurniture(fountain.id);
  sql(`delete from foundation where world_id = w and id = 9991; delete from placed where world_id = w and kind = 'furniture' and sub = 'fountain';`);
}

// A column on piers stands on a built deck, carried by the lightest deck under the building; none is glass.
same('a column on a tile on piers wants its deck built first', 'plan_column', { x: 16, y: 31, cx: 16, cy: 31, material: 'plank', level: 0 },
  'Build the floor of this storey first.');
same('and no column is glass', 'plan_column', { x: 17, y: 31, cx: 18, cy: 31, material: 'glass', level: 0 }, GLASS_ROOF_ONLY);
same('a marble column stands on a stone-brick deck', 'plan_column', { x: 17, y: 31, cx: 18, cy: 31, material: 'marble', level: 0 }, 'ALLOWED');
column(12, 0, 18, 31, 'marble');
const marble = MATERIAL_BY_ID.get('marble')!;
const plank = MATERIAL_BY_ID.get('plank')!;
same('and a deck planned under the building carries that column as it would a wall of it', 'plan_floor',
  { x: 16, y: 31, material: 'plank', level: 0 }, deckBears(plank, marble.heft, 'Stilts') ?? 'ALLOWED');
uncolumn(0, 18, 31);
floor(12, 0, 16, 31, 'plank');
same('while no column goes up heavier than the lightest deck under the building', 'plan_column',
  { x: 17, y: 31, cx: 18, cy: 31, material: 'marble', level: 0 }, deckCarries(marble, plank, 'Stilts') ?? 'ALLOWED');

// A deck's edge is a drop, as an upper floor's is: it takes a railing.
same('a railing goes on the edge of a deck on piers', 'plan_wall', { x: 16, y: 31, side: 'w', wallType: 'railing', material: 'plank', level: 0 }, 'ALLOWED');

// A deck holds up a column standing on it alone, and whoever is on it.
column(12, 0, 16, 31, 'plank');
same('a deck with a column on it and on nothing else stays down', 'remove_floor', { x: 16, y: 31, level: 0 },
  'Take down the column on its north-west corner first.');
uncolumn(0, 16, 31);
stand(16.5, 31.5, 0);
same('and one with you on it, as the piers have it on both sides', 'remove_floor', { x: 16, y: 31, level: 0 }, 'Step off the deck first.');
stand(18.5, 23.5, 1);

// A cellar is filled in before the building over it comes off the plan, whatever stands on its corners; glass is no railing.
building(13, 'Cellared', [[19, 31]], 1, 0);
column(13, 0, 19, 31, 'plank');
bld.setCellar(13, 19, 31, CELLAR_DEPTH);
sql(`insert into cellar_tile (world_id, x, y, building, dug) values (w, 19, 31, 13, ${CELLAR_DEPTH});`);
same('a building over a cellar says the cellar first, its columns after', 'remove_from_plan', { x: 19, y: 31 }, 'Fill in the cellar under it first.');
same('and glass is no railing, which is said before where a railing goes', 'plan_wall',
  { x: 19, y: 31, side: 'n', wallType: 'railing', material: 'glass' }, GLASS_ROOF_ONLY);
bld.setCellar(13, 19, 31, 0);
sql(`delete from cellar_tile where world_id = w;`);

// A column on the ground takes the corner spot of every tile round it: no piece set down there, and none planned over one.
{
  const post = game.inventory.add('lamp_post', { ql: 50 });
  const theirs = Number(psql(`insert into item (world_id, holder, holder_uid, def, ql, count) values (${W}, 'player', ${DANE}, 'lamp_post', 50, 1) returning id;`).split('\n')[0]);
  const place = (sx: number, sy: number): [string, string] => {
    const t = { kind: 'tile', x: 19, y: 31, sx, sy, facing: 's' };
    const mine = ACTION_BY_ID.get('place_furniture')?.check?.({ ...t, itemUid: post.uid } as never, game) ?? 'ALLOWED';
    const island = psql(`select coalesce(fire_refusal(${W}, ${DANE}, 'place_furniture', '${JSON.stringify({ ...t, itemUid: theirs })}'::jsonb), 'ALLOWED');`);
    return [mine, island];
  };
  const [inCorner, inCornerIsland] = place(0, 0);
  check('a lantern post is not set down in the corner spot a column stands in, on both sides',
    inCorner === 'Something is already standing there.' && inCornerIsland === inCorner, `browser "${inCorner}", island "${inCornerIsland}"`);
  const [beside, besideIsland] = place(1, 1);
  check('and is, a spot out from it', beside === 'ALLOWED' && besideIsland === beside, `browser "${beside}", island "${besideIsland}"`);
  game.inventory.remove(post.uid, 1);
  sql(`delete from item where id = ${theirs};`);
  const standing = game.addFurniture('lamp_post', 20, 31, 0, 0, 50);
  sql(`insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql) values (w, 'furniture', 'lamp_post', 20, 31, 0, 0, 20.125, 31.125, 50);`);
  same('nor a column planned over a piece standing in its corner', 'plan_column', { x: 19, y: 31, cx: 20, cy: 31, material: 'plank' },
    'Move what stands in that corner first.');
  game.removeFurniture(standing.id);
  sql(`delete from placed where world_id = w and kind = 'furniture' and sub = 'lamp_post';`);
}

// A shop counter with a jetty resting on it: the jetty is said first, and then the counter's goods.
building(14, 'Shop', [[22, 32]], 2, 1);
for (const side of ['n', 'e', 'w'] as Side[]) wall(14, 0, 22, 32, side, 'solid', 'plank');
wall(14, 0, 22, 32, 's', 'counter', 'plank');
floor(14, 1, 22, 33, 'plank');
game.counters.open(22, 32, 's').till = 5;
sql(`insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, till) values (w, 'counter', 's', 22, 32, 0, 0, 22.5, 32.5, 5);`);
same('a shop counter a jetty rests on says the jetty first, on both sides', 'remove_wall', { x: 22, y: 32, side: 's', level: 0 },
  'A jetty of storey 2 rests on this wall: raise a column at each end of it, or tear the jetty up, first.');
unfloor(1, 22, 33);
same('and with the jetty up, its goods', 'remove_wall', { x: 22, y: 32, side: 's', level: 0 }, COUNTER_EMPTY_FIRST);
game.counters.close(22, 32, 's');
sql(`delete from placed where world_id = w and kind = 'counter';`);

// Stairs on the ground floor of a building with a storey over it: a way up is asked for a storey up, a way down is the cellar's to say.
const SHOP_STAIRS = { x: 22, y: 32, material: 'plank', floorKind: 'stairs', side: 'n', level: 0 };
same('stairs on the ground floor of two storeys, over no cellar, are a storey up', 'plan_floor', SHOP_STAIRS,
  'Work on storey 2 or above to plan stairs here.');
same('and a way down asked for over no cellar is the cellar\'s to refuse', 'plan_floor', { ...SHOP_STAIRS, down: true },
  `Dig the cellar out under it first: it is 0 of ${CELLAR_DEPTH} down.`);
bld.setCellar(14, 22, 32, CELLAR_DEPTH);
sql(`insert into cellar_tile (world_id, x, y, building, dug) values (w, 22, 32, 14, ${CELLAR_DEPTH});`);
same('as are stairs over a cellar dug out under the tile', 'plan_floor', SHOP_STAIRS,
  'Its foot would come down on 22,31, and there is no cellar dug out there to come down on.');
bld.setCellar(14, 22, 32, 0);
sql(`delete from cellar_tile where world_id = w;`);

/* ---- put the ground back -------------------------------------------------- */
{
  const heights = heightsWere.split(';').map((r) => r.split(',').map(Number));
  const tiles = tilesWere.split(';').map((r) => r.split(',').map(Number));
  const [px, py, pl] = daneWas.split(',').map(Number);
  sql(`delete from wall where world_id = w;
    delete from floor_tile where world_id = w;
    delete from building_column where world_id = w;
    delete from building_tile where world_id = w;
    delete from building where world_id = w;
    ${heights.map(([x, y, h]) => `perform land_set_height(w, ${x}, ${y}, ${h});`).join('\n')}
    ${tiles.map(([x, y, t, d]) => `perform land_set_tile(w, ${x}, ${y}, ${t}); perform land_set_data(w, ${x}, ${y}, ${d});`).join('\n')}
    update player set x = ${px}, y = ${py}, level = ${pl} where world_id = w and uid = u;
    ${deedWas ? `update deed set x = ${deedWas.split(',')[0]}, y = ${deedWas.split(',')[1]}, radius = ${deedWas.split(',')[2]}, level = ${deedWas.split(',')[3]}
      where world_id = w and founded_by = u;` : 'delete from deed where world_id = w and founded_by = u;'}`);
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not the same on both sides`);
  process.exit(1);
}
console.log(`jetties, balconies, railings and columns are the same rules on both sides — ${ok.length} of ${ok.length}`);
