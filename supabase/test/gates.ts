/**
 * A portcullis, a drawbridge and a hidden door, the same on both sides.
 *
 * Asked for: a portcullis that is raised and lowered and stops everything but
 * the eye when it is down; a drawbridge that is raised and lowered from its
 * winch and cannot be crossed when it is up; and a door that is a solid wall
 * to everybody its lock does not admit -- "the island must never tell a
 * browser it is a door unless that player is admitted".
 *
 * One gatehouse on Hoarding and the same one in a browser: three tiles a side
 * of stone brick, a portcullis in its south wall, a hidden door in its east
 * wall, and a drawbridge from the tile outside the portcullis over a moat to
 * the far bank. Four people: Gil, who founded the settlement it stands on;
 * Kay, who holds the keys and nothing else; Ben, a builder on Gil's
 * settlement with no key; and Sim, a stranger. And two more, east of the
 * moat, for pulling bridges down: Ann, who founded a small settlement there,
 * and Bob, a stranger to it.
 *
 *   * what each thing is and costs, on both sides;
 *   * what the island's ground read says to each of the four, and that the
 *     wall table cannot be read round it;
 *   * what a browser fed that read lets through -- people, beasts, carts --
 *     and lets the eye through, at every state of both gates;
 *   * who may raise and lower each, in the island's words and the browser's,
 *     and what doing it says and leaves behind;
 *   * the island's own walk over the drawbridge, down and up;
 *   * the word a gate sends to the block it stands in;
 *   * that a padlock fitted becomes its own key, and its key the padlock again
 *     when it comes off, so every key is keyed to its own number;
 *   * who may pull a bridge down, and from how near: on a settlement only its
 *     builders, and a padlock on a drawbridge stops even them without its key;
 *   * planning each, and the refusals -- and that a hidden door's plan is a
 *     solid wall's plan on everything anybody else may read: the one call,
 *     the fields of the planner's row it moves, the job over their head, its
 *     time and its wind, the one line it writes, how far it moves the
 *     island's counters, and the wall it leaves in the ground read; that on an
 *     island nothing goes before the walk; that each ask goes with its own
 *     job, so a refused plan keeps nothing and a job dropped -- put down, the
 *     queue cleared, refused as it came up, the walk given up -- leaves
 *     nothing for a later plain wall; and that an ask lapses;
 *   * where a bridge may start: not inside a building nor through a wall, so
 *     never through a portcullis nor a hidden door -- and that a wall on a
 *     deck's border is still a wall to a body and a cart;
 *   * and what the pointer says of each, to whom.
 *
 * Runs against the database the suite leaves behind, and puts Hoarding's
 * ground back as it found it.
 */
import { Game, type IslandGround } from '../../src/game/game';
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID, type ActionDef, type Target } from '../../src/game/actions';
import { borderOf, MATERIALS, WALL_TYPE_BY_ID, WALL_TYPES, wallBill, type Side } from '../../src/game/building';
import { BRIDGES, PULL_REACH, spanBill, type BridgeKind } from '../../src/game/bridges';
import {
  BRIDGE_END_HERE, BRIDGE_END_INSIDE, bridgeEndRefusal, bridgeEndWall, DRAWBRIDGE_UNDER_JETTY, drawbridgeEndsOut, drawbridgeSaid, gateHoverLine, gatePlanRefusal,
  JETTY_OVER_WINCH,
  hiddenAsk, HIDDEN_DOOR_ALONE, HIDDEN_DOOR_HINGES, HIDDEN_DOOR_LAPSE, HIDDEN_DOOR_SHORT, hiddenDoorSaid, planHiddenDoor, planLine,
  portcullisSaid,
} from '../../src/game/gates';
import { cellarGate } from '../../src/game/cellar';
import { isGlasshouse } from '../../src/game/glasshouse';
import { frameJettyEntries } from '../../src/ui/frameMenu';
import type { MenuItem } from '../../src/ui/contextmenu';
import type { Pick } from '../../src/render/renderer';
import { TileType } from '../../src/world/tiles';
import { numberWord, spanWords } from '../../src/game/words';

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
const same = (a: Record<string, number>, b: Record<string, number>): boolean =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, n]) => b[k] === n);
const said = (bill: Record<string, number>): string => Object.entries(bill).map(([k, n]) => `${n} ${k}`).join(', ');

const W = `(select id from world where name = 'Hoarding')`;
const WHO = {
  gil: '9a7e0000-0001-4000-8000-00000000000a',
  kay: '9a7e0000-0002-4000-8000-00000000000b',
  ben: '9a7e0000-0003-4000-8000-00000000000c',
  sim: '9a7e0000-0004-4000-8000-00000000000d',
  ann: '9a7e0000-0005-4000-8000-00000000000e',
  bob: '9a7e0000-0006-4000-8000-00000000000f',
} as const;
type Who = keyof typeof WHO;
const NAME: Record<Who, string> = { gil: 'Gil', kay: 'Kay', ben: 'Ben', sim: 'Sim', ann: 'Ann', bob: 'Bob' };
const EVERYBODY = Object.values(WHO).map((u) => `'${u}'`).join(', ');

/* ---- the scene ---------------------------------------------------------------
 *
 * Flat at sixty, and a moat along the corners at y 14 down at minus a hundred
 * and twenty: the tiles in rows 13 and 14 fall a hundred and eighty across,
 * their middles are out of anybody's depth, and nobody walks into or out of
 * them. The gatehouse is tiles 9 to 11 by 9 to 11; the drawbridge runs from
 * its gate, at (10, 12), to (10, 15). Gil's settlement reaches from x 2 to
 * 12, so it holds both gates' locks and nothing east of the hidden door; Ann's
 * is the three tiles a side from (14, 15) to (16, 17), over the moat.
 */
const BANK = 60;
const MOAT = -120;
const MOAT_Y = 14;
const BOX = { x0: 6, y0: 6, x1: 15, y1: 17 };
const MAT = 'stone_brick';
const PORTCULLIS = { x: 10, y: 11, side: 's' as Side };
const HIDDEN = { x: 11, y: 10, side: 'e' as Side };
const BRIDGE = { ax: 10, ay: 12, bx: 10, by: 15 };
const LOCK_P = 7770001;
const LOCK_H = 7770002;
const cornerH = (y: number): number => (y === MOAT_Y ? MOAT : BANK);
const inGate = (x: number, y: number): boolean => x >= 9 && x <= 11 && y >= 9 && y <= 11;

/** The ground as Hoarding had it before, to be put back. */
const before = psql(`
select string_agg(gx || ',' || gy || ',' || coalesce(land_height(${W}, gx, gy), 0), ';')
  from generate_series(${BOX.x0}, ${BOX.x1}) gx cross join generate_series(${BOX.y0}, ${BOX.y1}) gy;
select string_agg(gx || ',' || gy || ',' || coalesce(land_tile(${W}, gx, gy), 0), ';')
  from generate_series(${BOX.x0}, ${BOX.x1 - 1}) gx cross join generate_series(${BOX.y0}, ${BOX.y1 - 1}) gy;`).split('\n');

const bill = (type: string): string => JSON.stringify(wallBill(MAT, type as never).total);
const zero = (type: string): string => JSON.stringify(Object.fromEntries(Object.keys(wallBill(MAT, type as never).total).map((k) => [k, 0])));
/** The gatehouse's twelve outer walls, as border rows: its portcullis and hidden door among them. */
const WALLS: Array<{ dir: 'h' | 'v'; x: number; y: number; type: string; lock?: number }> = [];
for (let i = 9; i <= 11; i++) {
  WALLS.push({ dir: 'h', x: i, y: 9, type: 'solid' });
  WALLS.push({ dir: 'h', x: i, y: 12, type: i === 10 ? 'portcullis' : 'solid', lock: i === 10 ? LOCK_P : undefined });
  WALLS.push({ dir: 'v', x: 9, y: i, type: 'solid' });
  WALLS.push({ dir: 'v', x: 12, y: i, type: i === 10 ? 'hidden_door' : 'solid', lock: i === 10 ? LOCK_H : undefined });
}

psql(`
do $$
declare w uuid; gx int; gy int; v_full jsonb := '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb; v_b bigint;
begin
  select id into w from world where name = 'Hoarding';
  delete from building where world_id = w and id in (select bt.building from building_tile bt where bt.world_id = w
    and bt.x between ${BOX.x0} and ${BOX.x1} and bt.y between ${BOX.y0} and ${BOX.y1});
  delete from wall where world_id = w and x between ${BOX.x0} and ${BOX.x1} and y between ${BOX.y0} and ${BOX.y1};
  delete from bridge where world_id = w and ax between ${BOX.x0} and ${BOX.x1} and ay between ${BOX.y0} and ${BOX.y1};
  delete from bridge_span where world_id = w and not exists (select 1 from bridge b where b.world_id = w and b.id = bridge);
  delete from deed where world_id = w and founded_by in (${EVERYBODY});
  delete from item where world_id = w and holder = 'player' and holder_uid in (${EVERYBODY});
  delete from player where world_id = w and uid in (${EVERYBODY});
  delete from private.hidden_door_plan where world_id = w;
  insert into player (world_id, uid, name, x, y, stats) values
    (w, '${WHO.gil}', 'Gil', 10.5, 12.5, v_full), (w, '${WHO.kay}', 'Kay', 10.5, 12.5, v_full),
    (w, '${WHO.ben}', 'Ben', 10.5, 12.5, v_full), (w, '${WHO.sim}', 'Sim', 10.5, 12.5, v_full),
    (w, '${WHO.ann}', 'Ann', 14.5, 15.5, v_full), (w, '${WHO.bob}', 'Bob', 14.5, 12.5, v_full);
  insert into deed (world_id, name, x, y, radius, founded_by) values (w, 'Gatehold', 7, 10, 5, '${WHO.gil}');
  insert into deed (world_id, name, x, y, radius, founded_by) values (w, 'Annhold', 15, 16, 1, '${WHO.ann}');
  insert into deed_member (world_id, founder, uid, role) values (w, '${WHO.gil}', '${WHO.ben}', 'builder');
  -- Kay holds a key to the portcullis and one to the hidden door, and Gil nothing: the ground is his.
  insert into item (world_id, holder, holder_uid, def, ql, count, keyed) values
    (w, 'player', '${WHO.kay}', 'key', 40, 1, ${LOCK_P}), (w, 'player', '${WHO.kay}', 'key', 40, 1, ${LOCK_H});
  for gx in ${BOX.x0}..${BOX.x1} loop for gy in ${BOX.y0}..${BOX.y1} loop
    perform land_set_height(w, gx, gy, case when gy = ${MOAT_Y} then ${MOAT} else ${BANK} end);
  end loop; end loop;
  for gx in ${BOX.x0}..${BOX.x1 - 1} loop for gy in ${BOX.y0}..${BOX.y1 - 1} loop
    perform land_set_tile(w, gx, gy, case when gx between 9 and 11 and gy between 9 and 11 then tile_id('Packed dirt') else tile_id('Grass') end);
  end loop; end loop;
  insert into building (world_id, id, name, levels, work_level, planned_by) values (w, 77, 'Gatehouse', 1, 0, '${WHO.gil}');
  for gx in 9..11 loop for gy in 9..11 loop
    insert into building_tile (world_id, building, x, y) values (w, 77, gx, gy);
  end loop; end loop;
  ${WALLS.map((wl) => `insert into wall (world_id, level, dir, x, y, building, type, material, needed, total, lock)
    values (w, 0, '${wl.dir}', ${wl.x}, ${wl.y}, 77, '${wl.type}', '${MAT}', '${zero(wl.type)}', '${bill(wl.type)}', ${wl.lock ?? 'null'});`).join('\n  ')}
  insert into bridge (world_id, kind, ax, ay, bx, by, height, material, made_by)
    values (w, 'draw', ${BRIDGE.ax}, ${BRIDGE.ay}, ${BRIDGE.bx}, ${BRIDGE.by}, ${BANK}, 'Oak', '${WHO.gil}') returning id into v_b;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select w, v_b, t.n, t.x, t.y, (select jsonb_object_agg(k, 0) from jsonb_object_keys(span_bill('draw', t.n)) k), span_bill('draw', t.n)
      from span_tiles(${BRIDGE.ax}, ${BRIDGE.ay}, ${BRIDGE.bx}, ${BRIDGE.by}) t;
end $$;`);
const BID = Number(psql(`select id from bridge where world_id = ${W} and ax = ${BRIDGE.ax} and ay = ${BRIDGE.ay}`));

/** The ground a browser stands on: the same box, shaped the same. */
const shape = (g: Game): void => {
  const w = g.world;
  for (let x = BOX.x0; x <= BOX.x1; x++) for (let y = BOX.y0; y <= BOX.y1; y++) w.setHeight(x, y, cornerH(y));
  for (let x = BOX.x0; x < BOX.x1; x++) for (let y = BOX.y0; y < BOX.y1; y++) w.setTile(x, y, inGate(x, y) ? TileType.PackedDirt : TileType.Grass);
};

/** What the island tells somebody standing at (x, y), as `rpc_ground` says it. */
const groundFor = (who: Who, x = 10.5, y = 12.5): IslandGround => JSON.parse(psql(`
update player set x = ${x}, y = ${y}, level = 0 where world_id = ${W} and uid = '${WHO[who]}';
select set_config('request.jwt.claims', json_build_object('sub', '${WHO[who]}')::text, false) \\g /dev/null
select rpc_ground(${W}, 40, true)::text;`).split('\n').pop() as string) as IslandGround;

/** A browser in somebody's shoes: the same ground, the island's word about what stands on it, and their keys. */
const browserFor = (who: Who, x = 10.5, y = 12.5): Game => {
  const g = Game.create(4242);
  shape(g);
  g.settings.fog = true;
  (g as unknown as { darkness: () => number }).darkness = () => 0;
  g.sawGround(groundFor(who, x, y));
  if (who === 'kay') for (const lock of [LOCK_P, LOCK_H]) g.inventory.add('key', { ql: 40 }).keyed = lock;
  g.player.x = x;
  g.player.y = y;
  g.player.level = 0;
  return g;
};

/* ---- 1. what each thing is, on both sides ------------------------------------ */

const pDef = WALL_TYPE_BY_ID.get('portcullis');
const hDef = WALL_TYPE_BY_ID.get('hidden_door');
const row = (id: string): string => psql(`select passable || ' ' || wide || ' ' || beast_proof || ' ' || stone || ' ' || ground from wall_type_def where id = '${id}'`);
check('a portcullis is a wide opening laid in stone on the ground floor, on both sides',
  !!pDef && row('portcullis') === `${pDef.passable} ${!!pDef.wide} ${!!pDef.beastProof} ${!!pDef.stone} ${!!pDef.ground}` && !!pDef.wide && !!pDef.stone && !!pDef.ground,
  `island: passable, wide, beast-proof, stone, ground = ${row('portcullis')}`);
const pIron = psql(`select string_agg(item || ' ' || count, ', ' order by item) from wall_fitting where type = 'portcullis'`);
check('and its grille is the same iron on both sides',
  pIron === [...(pDef?.fittings ?? [])].sort().map(([k, n]) => `${k} ${n}`).join(', '), pIron);
let stoneSame = 0;
const stones = MATERIALS.filter((m) => m.kind === 'stone');
for (const m of stones) {
  const theirs = JSON.parse(psql(`select wall_bill('${m.id}', 'portcullis')`)) as Record<string, number>;
  if (same(wallBill(m.id, 'portcullis').total, theirs)) stoneSame++;
}
check(`a portcullis costs the same on both sides in each of the ${stones.length} stones`, stoneSame === stones.length,
  `${stoneSame} of ${stones.length}; in stone brick ${said(wallBill(MAT, 'portcullis').total)}`);
check('a hidden door is a door to a person and never to a beast or a cart, on both sides',
  !!hDef && hDef.passable && !!hDef.beastProof && !hDef.wide && !hDef.opaque && row('hidden_door') === 'true false true false false',
  row('hidden_door'));
let solidSame = 0;
for (const m of MATERIALS) {
  const theirs = JSON.parse(psql(`select wall_bill('${m.id}', 'hidden_door')`)) as Record<string, number>;
  const solid = JSON.parse(psql(`select wall_bill('${m.id}', 'solid')`)) as Record<string, number>;
  if (same(wallBill(m.id, 'hidden_door').total, theirs) && same(theirs, solid) && same(wallBill(m.id, 'solid').total, solid)) solidSame++;
}
check(`and it is built of exactly a solid wall's bill, in all ${MATERIALS.length} materials, on both sides`, solidSame === MATERIALS.length,
  `${solidSame} of ${MATERIALS.length}`);
check('its padlock and hinges go in when it is planned: a door\'s hinges, on both sides',
  Number(psql('select hidden_door_hinges()')) === HIDDEN_DOOR_HINGES && HIDDEN_DOOR_HINGES === (WALL_TYPE_BY_ID.get('door')?.fittings?.find(([k]) => k === 'hinge')?.[1] ?? -1),
  `${HIDDEN_DOOR_HINGES} hinges`);
const dDef = BRIDGES.draw;
check('a drawbridge is a timber bridge of a stated length, both ends on the ground, that carries a cart',
  psql(`select span || ' ' || carts || ' ' || grounded || ' ' || tool from bridge_def where id = 'draw'`) === `${dDef.span} ${dDef.carts} ${!!dDef.grounded} ${dDef.tool}`
    && dDef.tool === 'mallet' && dDef.carts,
  `at most ${dDef.span} tiles`);
check('and its first span takes its winch as well as its deck, the same on both sides',
  same(spanBill('draw', true).total, JSON.parse(psql(`select span_bill('draw', 1)`)))
    && same(spanBill('draw').total, JSON.parse(psql(`select span_bill('draw', 2)`)))
    && same(spanBill('wood').total, JSON.parse(psql(`select span_bill('wood', 1)`))),
  `first ${said(spanBill('draw', true).total)}; the rest ${said(spanBill('draw').total)}`);

/* ---- 2. what the island says, and to whom ------------------------------------ */

const WHOS: Who[] = ['gil', 'kay', 'ben', 'sim'];
const ADMITTED: Record<Who, boolean> = { gil: true, kay: true, ben: false, sim: false, ann: false, bob: false };
const grounds = Object.fromEntries(WHOS.map((w) => [w, groundFor(w)])) as Record<Who, IslandGround>;
type WallRow = Record<string, unknown>;
const wallIn = (g: IslandGround, dir: string, x: number, y: number): WallRow | undefined =>
  (g.buildings?.walls as unknown as WallRow[] | undefined)?.find((w) => w.dir === dir && w.x === x && w.y === y && w.level === 0);
for (const who of WHOS) {
  const door = wallIn(grounds[who], 'v', 12, 10);
  const plain = wallIn(grounds[who], 'v', 12, 9);
  if (ADMITTED[who]) {
    check(`${NAME[who]} is told the hidden door is a door, and its padlock`, door?.type === 'hidden_door' && door?.lock === LOCK_H,
      JSON.stringify(door));
  } else {
    const keys = (r: WallRow | undefined): string => Object.keys(r ?? {}).sort().join(',');
    check(`${NAME[who]} is told it is a solid wall, and nothing on the wire says otherwise`,
      door?.type === 'solid' && door.lock === undefined && keys(door) === keys(plain)
        && JSON.stringify(door.needed) === JSON.stringify(plain?.needed) && JSON.stringify(door.total) === JSON.stringify(plain?.total)
        && !JSON.stringify(grounds[who]).includes('hidden_door') && !JSON.stringify(grounds[who]).includes(String(LOCK_H)),
      `the door ${JSON.stringify(door)}, the wall beside it ${JSON.stringify(plain)}`);
  }
}
check('the portcullis and its padlock are told to everybody',
  WHOS.every((w) => wallIn(grounds[w], 'h', 10, 12)?.type === 'portcullis' && wallIn(grounds[w], 'h', 10, 12)?.lock === LOCK_P),
  WHOS.map((w) => `${NAME[w]} ${wallIn(grounds[w], 'h', 10, 12)?.type}`).join(', '));
/** Whether a client signed in as Sim may read this off the wall table itself, round the ground read. */
const reads = (what: string): string => psql(`
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${WHO.sim}')::text, true) \\g /dev/null
do $$ begin
  perform ${what} from wall;
  perform set_config('gates.read', 'read', true);
exception when others then
  perform set_config('gates.read', sqlerrm, true);
end $$;
select current_setting('gates.read');
commit;`).split('\n').pop() as string;
check('and a wall\'s type and padlock cannot be read round the ground read',
  /permission denied/.test(reads('type')) && /permission denied/.test(reads('lock')) && /permission denied/.test(reads('*')),
  `type: ${reads('type')}; lock: ${reads('lock')}`);
check('while what says nothing about a hidden door still can', reads('count(*)') === 'read' && reads('x, y, dir, material, needed, total, lowered') === 'read',
  reads('x, y, dir, material, needed, total, lowered'));

/* ---- 3. what gets through, fed what the island said ---------------------------- */

const P = { x0: 10, y0: 11, x1: 10, y1: 12 };
const H = { x0: 11, y0: 10, x1: 12, y1: 10 };
type Pass = { person: boolean; beast: boolean; cart: boolean };
const passes = (g: Game, s: typeof P): Pass => ({
  person: !g.buildings.blocksAt(0, s.x0, s.y0, s.x1, s.y1),
  beast: !g.buildings.blocksAt(0, s.x0, s.y0, s.x1, s.y1, true),
  cart: !g.buildings.blocksVehicle(s.x0, s.y0, s.x1, s.y1),
});
const pass = (p: Pass): string => `person ${p.person ? 'passes' : 'stopped'}, beast ${p.beast ? 'passes' : 'stopped'}, cart ${p.cart ? 'passes' : 'stopped'}`;
const looks = (g: Game, from: [number, number], at: [number, number]): boolean => {
  g.player.x = from[0] + 0.5;
  g.player.y = from[1] + 0.5;
  g.vision.invalidate();
  g.vision.update();
  return g.vision.isVisible(at[0], at[1]);
};
for (const who of WHOS) {
  const g = browserFor(who);
  const d = passes(g, H);
  check(`the hidden door, to ${NAME[who]}: ${ADMITTED[who] ? 'a door to walk through' : 'a wall'}, and never a way for a beast or a cart`,
    d.person === ADMITTED[who] && !d.beast && !d.cart, pass(d));
  check(`and ${NAME[who]} ${ADMITTED[who] ? 'sees through it as through any door' : 'cannot see through it'}`,
    looks(g, [10, 10], [14, 10]) === ADMITTED[who], 'from inside the gatehouse at 10,10 out to 14,10, off the settlement');
}

/** The island lets the portcullis down or winches it up, as somebody who may. */
const setPortcullis = (down: boolean): void => {
  psql(`update wall set lowered = ${down} where world_id = ${W} and level = 0 and dir = 'h' and x = 10 and y = 12;`);
};
const setDrawbridge = (up: boolean): void => {
  psql(`update bridge set raised = ${up} where world_id = ${W} and id = ${BID};`);
};
for (const down of [false, true]) {
  setPortcullis(down);
  const g = browserFor('sim');
  const p = passes(g, P);
  check(`the portcullis ${down ? 'down: nothing gets through' : 'up: everything gets through, carts included'}`,
    down ? !p.person && !p.beast && !p.cart : p.person && p.beast && p.cart, pass(p));
  check(`and ${down ? 'down' : 'up'}, the eye goes through it: it is a grille`, looks(g, [10, 12], [10, 10]), 'from the gate at 10,12 to 10,10');
}
setPortcullis(false);

for (const up of [false, true]) {
  setDrawbridge(up);
  const g = browserFor('sim');
  const step = g.stepRule(10, 12, 0, 10, 13);
  const drive = g.driveRule(10, 12, 0, 10, 13);
  const beast = !g.buildings.blocksAt(0, 10, 12, 10, 13, true);
  check(`the drawbridge ${up ? 'up: nobody steps onto the gap and no cart rolls onto it' : 'down: a body walks onto it and a cart drives onto it'}`,
    up ? step === null && drive === null : step === 0 && drive === 0,
    `a step ${step === null ? 'refused' : `onto storey ${step}`}, a cart ${drive === null ? 'refused' : 'rolls'}`);
  check(`and ${up ? 'up, its hinge is shut to a beast as to everything' : 'down, its hinge is no wall to anything'}`,
    beast === !up, `a beast ${beast ? 'passes' : 'stopped'} over the hinge`);
  const across = g.stepRule(10, 13, 0, 10, 14);
  check(`and ${up ? 'up, there is no deck to walk along' : 'down, the deck is walked end to end'}`,
    up ? across === null : across === 0, `along the span ${across === null ? 'refused' : 'walked'}`);
  check(`and the eye ${up ? 'stops at it, standing on end over its hinge' : 'goes over it'}`,
    looks(g, [10, 16], [10, 11]) === !up, 'from the far bank at 10,16 through the gate to 10,11');
}
setDrawbridge(false);

/* ---- 4. who may raise and lower each ------------------------------------------- */

const tileT = (x: number, y: number, side: Side): Target => ({ kind: 'tile', x, y, cx: x, cy: y, side });
const PT = tileT(PORTCULLIS.x, PORTCULLIS.y, PORTCULLIS.side);
const BT: Target = { kind: 'bridge', id: BID };
const tj = (t: Target): string => JSON.stringify(t).replace(/'/g, "''");
const islandSays = (who: Who, action: string, t: Target, x = 10.5, y = 12.5): string => psql(`
update player set x = ${x}, y = ${y}, level = 0 where world_id = ${W} and uid = '${WHO[who]}';
select coalesce(act_refusal(${W}, '${WHO[who]}', '${action}', '${tj(t)}'::jsonb), 'ALLOWED');`).split('\n').pop() as string;
const browserSays = (who: Who, action: string, t: Target, x = 10.5, y = 12.5): string =>
  ACTION_BY_ID.get(action)?.check?.(t, browserFor(who, x, y)) ?? 'ALLOWED';
const both = (what: string, who: Who, action: string, t: Target, want: string | null, at: [number, number] = [10.5, 12.5]): void => {
  const mine = browserSays(who, action, t, ...at);
  const theirs = islandSays(who, action, t, ...at);
  check(what, mine === theirs && (want === null ? mine === 'ALLOWED' : mine === want), `browser "${mine}", island "${theirs}"`);
};
const LOCKED = 'It is locked, and you have no key to it.';
both('raising a portcullis that is up is refused in the same words', 'gil', 'raise_portcullis', PT, 'The portcullis is up already.');
// Taking it down: a builder of the settlement may take its walls down, but not a padlocked portcullis he has no key to.
both('Ben, who builds on Gil\'s settlement but holds no key, may not take the locked portcullis down, in the lock\'s words',
  'ben', 'remove_wall', PT, LOCKED);
both('and Gil, whose ground it is, may', 'gil', 'remove_wall', PT, null);
both('while the hidden door Ben holds no key to answers him as the solid wall it looks like, and says nothing of its lock',
  'ben', 'remove_wall', tileT(HIDDEN.x, HIDDEN.y, HIDDEN.side), null, [11.5, 10.5]);
for (const who of WHOS) {
  both(`${NAME[who]} ${ADMITTED[who] ? 'may' : 'may not'} let the locked portcullis down${ADMITTED[who] ? '' : ', in the same words'}`,
    who, 'lower_portcullis', PT, ADMITTED[who] ? null : LOCKED);
}
both('and the same from inside the gatehouse', 'kay', 'lower_portcullis', tileT(10, 11, 's'), null, [10.5, 11.5]);
check('the island measures the reach from either side and no further',
  islandSays('kay', 'lower_portcullis', PT, 10.5, 14.5) === 'You are too far away from that.', islandSays('kay', 'lower_portcullis', PT, 10.5, 14.5));
check('and the hidden door is no portcullis to anybody', WHOS.every((w) => islandSays(w, 'lower_portcullis', tileT(HIDDEN.x, HIDDEN.y, HIDDEN.side), 11.5, 10.5) === 'There is no portcullis there.'
  && browserSays(w, 'lower_portcullis', tileT(HIDDEN.x, HIDDEN.y, HIDDEN.side), 11.5, 10.5) === 'There is no portcullis there.'), 'there is no portcullis there');

/**
 * Every counter that numbers rows the island serves, as "name=last value",
 * comma by comma: the public schema's. Not `private`'s, which no API reaches,
 * nor `realtime.messages`', whose numbers no client is sent -- and the only
 * messages a hidden door's plan adds are the planner's own pack, on the
 * planner's own topic.
 */
const COUNTERS = `select string_agg(sequencename || '=' || coalesce(last_value, 0), ',' order by sequencename) from pg_sequences where schemaname = 'public';`;
/** How far each counter moved between two readings: "event_n_seq +1, item_id_seq +0", and any other that moved. */
const moved = (a: string, b: string): string => {
  const was = new Map(a.split(',').map((kv) => kv.split('=') as [string, string]));
  return b.split(',').map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v) - Number(was.get(k) ?? 0)] as const)
    .filter(([k, d]) => d !== 0 || k === 'event_n_seq' || k === 'item_id_seq')
    .map(([k, d]) => `${k} +${d}`).join(', ');
};
/** The items' counter alone, moved: "+0". */
const items = (a: string, b: string): string => moved(a, b).split(', ').find((m) => m.startsWith('item_id_seq '))?.slice('item_id_seq '.length) ?? '?';

/** Somebody does it on both sides: what each said, and what it left. */
const doBoth = (who: Who, action: string, t: Target, at: [number, number] = [10.5, 12.5]): { mine: string; theirs: string; g: Game } => {
  const g = browserFor(who, ...at);
  g.log.length = 0;
  ACTION_BY_ID.get(action)?.perform(t, g);
  const mine = g.log.map((l) => l.text).pop() ?? 'NOTHING SAID';
  const theirs = psql(`
update player set x = ${at[0]}, y = ${at[1]}, level = 0 where world_id = ${W} and uid = '${WHO[who]}';
delete from event where world_id = ${W} and uid = '${WHO[who]}';
select act_perform(${W}, '${WHO[who]}', '${action}', '${tj(t)}'::jsonb) \\g /dev/null
select coalesce((select text from event where world_id = ${W} and uid = '${WHO[who]}' order by n desc limit 1), 'NOTHING SAID');`).split('\n').pop() as string;
  return { mine, theirs, g };
};
psql(`delete from realtime.messages where topic like 'land:%';`);
{
  const { mine, theirs, g } = doBoth('kay', 'lower_portcullis', PT);
  check('Kay lets it down, and both sides say so in the same words', mine === theirs && mine === portcullisSaid(false), `browser "${mine}", island "${theirs}"`);
  check('and it is down on both sides',
    g.buildings.wall(0, 10, 11, 's')?.lowered === true && psql(`select lowered from wall where world_id = ${W} and level = 0 and dir = 'h' and x = 10 and y = 12`) === 't');
  const heard = psql(`select count(*) from realtime.messages where topic = 'land:' || ${W} || ':' || region_of(10, 12) and payload->>'gates' = 'true'`);
  check('and the island tells the block it stands in, so the browsers there read the walls again', heard === '1', `${heard} message`);
  check('which the next ground read carries to everybody', WHOS.every((w) => wallIn(groundFor(w), 'h', 10, 12)?.lowered === true));
}
both('Sim may not winch it up again', 'sim', 'raise_portcullis', PT, LOCKED);
{
  const { mine, theirs } = doBoth('gil', 'raise_portcullis', PT);
  check('and Gil, on his own ground, may, and it says so on both sides', mine === theirs && mine === portcullisSaid(true), `browser "${mine}", island "${theirs}"`);
}
// Without its padlock, anybody may.
{
  const kayKey = psql(`select id from item where world_id = ${W} and holder_uid = '${WHO.kay}' and def = 'key' and keyed = ${LOCK_P}`);
  const c0 = psql(COUNTERS);
  const { mine, theirs, g } = doBoth('kay', 'take_off_lock', PT);
  const c1 = psql(COUNTERS);
  check('Kay takes the padlock off it, in the same words on both sides', mine === theirs && mine.startsWith('You take the padlock off'), `browser "${mine}", island "${theirs}"`);
  const back = psql(`select def || ' ' || ql || ' ' || coalesce(keyed::text, 'keyed to nothing') from item where id = ${kayKey}`);
  const mineBack = g.inventory.items.filter((i) => i.id === 'padlock');
  check('and the key she threw in after it is the padlock handed back: the same row, a padlock of quality 40 again, and no new row numbered, on both sides',
    back === 'padlock 40 keyed to nothing' && items(c0, c1) === '+0' && mineBack.length === 1 && mineBack[0].ql === 40
      && !g.inventory.items.some((i) => i.id === 'key' && i.keyed === LOCK_P),
    `island: row ${kayKey} is now "${back}", items ${items(c0, c1)}; browser: ${mineBack.length} padlock`);
  both('and then even Sim may let it down', 'sim', 'lower_portcullis', PT, null);
}
check('the padlock is off it on the island', psql(`select coalesce(lock::text, 'NONE') from wall where world_id = ${W} and dir = 'h' and x = 10 and y = 12`) === 'NONE');

// The drawbridge, with no padlock yet: anybody at the winch.
both('anybody may raise the drawbridge from its winch while it has no padlock', 'sim', 'raise_drawbridge', BT, null);
check('but only standing at the winch end: the island measures it',
  islandSays('sim', 'raise_drawbridge', BT, 10.5, 15.5) === 'You are too far away from that.', islandSays('sim', 'raise_drawbridge', BT, 10.5, 15.5));
both('lowering one that is down is refused in the same words', 'sim', 'lower_drawbridge', BT, 'The drawbridge is down already.');
psql(`insert into item (world_id, holder, holder_uid, def, ql, count) values (${W}, 'player', '${WHO.gil}', 'padlock', 40, 1);`);
{
  const g = browserFor('gil');
  g.inventory.add('padlock', { ql: 40 });
  const mineWhy = ACTION_BY_ID.get('fit_lock')?.check?.(BT, g) ?? 'ALLOWED';
  const theirsWhy = islandSays('gil', 'fit_lock', BT);
  check('Gil may fit a padlock to its winch, on both sides', mineWhy === 'ALLOWED' && theirsWhy === 'ALLOWED', `browser "${mineWhy}", island "${theirsWhy}"`);
  const padlockRow = psql(`select id from item where world_id = ${W} and holder_uid = '${WHO.gil}' and def = 'padlock'`);
  const c0 = psql(COUNTERS);
  psql(`select act_perform(${W}, '${WHO.gil}', 'fit_lock', '${tj(BT)}'::jsonb);`);
  const c1 = psql(COUNTERS);
  const lock = Number(psql(`select coalesce(lock, 0) from bridge where world_id = ${W} and id = ${BID}`));
  const key = psql(`select string_agg(id || ' keyed ' || keyed, ',') from item where world_id = ${W} and holder_uid = '${WHO.gil}' and def = 'key' and keyed = ${lock}`);
  check('and the island puts it on the winch and cuts his key', lock > 0 && key === `${lock} keyed ${lock}`, `lock ${lock}, key ${key}`);
  const padlock = g.inventory.find('padlock');
  const next = g.inventory.nextUid;
  ACTION_BY_ID.get('fit_lock')?.perform(BT, g);
  const mineKey = g.inventory.items.find((i) => i.id === 'key' && i.keyed === g.bridges.get(BID)?.lock);
  check('and the key is the padlock\'s own row, keyed to its own number as every key now is, and no new row is numbered, on both sides',
    Number(padlockRow) === lock && items(c0, c1) === '+0' && !!mineKey && mineKey === padlock && mineKey.keyed === mineKey.uid && g.inventory.nextUid === next,
    `island: padlock row ${padlockRow}, key ${key}, items ${items(c0, c1)}; browser: padlock ${padlock?.uid}, key ${mineKey?.uid} keyed ${mineKey?.keyed}`);
}
{
  // And a crate, the padlock's oldest use: the same on the island's own path (`perform_lock`) and in a browser.
  psql(`
delete from crate where world_id = ${W} and id = 7771;
insert into crate (world_id, id, kind, x, y, sx, sy, made_by) values (${W}, 7771, 'plank', 8, 12, 0, 0, '${WHO.gil}');
delete from item where world_id = ${W} and holder_uid = '${WHO.gil}' and def = 'padlock';
insert into item (world_id, holder, holder_uid, def, ql, count) values (${W}, 'player', '${WHO.gil}', 'padlock', 63, 1);
update player set x = 8.5, y = 11.5, level = 0 where world_id = ${W} and uid = '${WHO.gil}';`);
  const CT: Target = { kind: 'crate', id: 7771 };
  const padlockRow = psql(`select id from item where world_id = ${W} and holder_uid = '${WHO.gil}' and def = 'padlock'`);
  const c0 = psql(COUNTERS);
  psql(`select act_perform(${W}, '${WHO.gil}', 'fit_lock', '${tj(CT)}'::jsonb);`);
  const c1 = psql(COUNTERS);
  const fitted = psql(`select c.lock || '|' || i.id || ' keyed ' || i.keyed || ' ql ' || i.ql from crate c join item i on i.keyed = c.lock and i.def = 'key'
    where c.world_id = ${W} and c.id = 7771`);
  // Taken off by the key's holder: the key becomes the padlock handed back.
  psql(`select act_perform(${W}, '${WHO.gil}', 'take_off_lock', '${tj(CT)}'::jsonb);`);
  const c2 = psql(COUNTERS);
  const back = psql(`select def || ' ' || ql || ' ' || coalesce(keyed::text, 'keyed to nothing') from item where id = ${padlockRow}`);
  // Fitted again, the key handed to Kay, and taken off by the founder on his own ground, who holds no key: a new padlock, the key left as it was.
  psql(`select act_perform(${W}, '${WHO.gil}', 'fit_lock', '${tj(CT)}'::jsonb);
update item set holder_uid = '${WHO.kay}' where world_id = ${W} and def = 'key' and keyed = (select lock from crate where world_id = ${W} and id = 7771);`);
  const c3 = psql(COUNTERS);
  psql(`select act_perform(${W}, '${WHO.gil}', 'take_off_lock', '${tj(CT)}'::jsonb);`);
  const c4 = psql(COUNTERS);
  const masters = psql(`select (select count(*) from item where world_id = ${W} and holder_uid = '${WHO.gil}' and def = 'padlock') || ' padlock, '
    || (select count(*) from item where world_id = ${W} and holder_uid = '${WHO.kay}' and def = 'key' and keyed = ${padlockRow}) || ' key left with Kay'`);
  check('fitted to a crate, the padlock\'s own row becomes its key on the island too, keyed to its own number, and no new row is numbered',
    fitted === `${padlockRow}|${padlockRow} keyed ${padlockRow} ql 63` && items(c0, c1) === '+0', `${fitted}; items ${items(c0, c1)}`);
  check('and taken off by the key\'s holder the same row is the padlock handed back, as one always was: quality 40, keyed to nothing',
    back === 'padlock 40 keyed to nothing' && items(c1, c2) === '+0', `${back}; items ${items(c1, c2)}`);
  check('while taken off by the founder, who holds no key, a new padlock comes and the key is left where it was, as before',
    items(c3, c4) === '+1' && masters === '1 padlock, 1 key left with Kay', `${masters}; items ${items(c3, c4)}`);
  // And alone, in a browser.
  const g = Game.create(4242);
  const [hx, hy] = [Math.floor(g.player.x), Math.floor(g.player.y)];
  const crate = g.addCrate('log', hx, hy, 0, 0);
  const lock = g.inventory.add('padlock', { ql: 63 });
  const next = g.inventory.nextUid;
  const t: Target = { kind: 'crate', id: crate.id };
  ACTION_BY_ID.get('fit_lock')?.perform(t, g);
  const key = g.inventory.items.find((i) => i.id === 'key');
  const keyedTo = key?.keyed;
  const keyed = key === lock && crate.lock === lock.uid && keyedTo === lock.uid && key?.ql === 63 && g.inventory.nextUid === next;
  ACTION_BY_ID.get('take_off_lock')?.perform(t, g);
  check('and in a browser alone: the padlock is its key, keyed to its own number, and taken off the key is the padlock handed back',
    keyed && lock.id === 'padlock' && lock.ql === 40 && lock.keyed === undefined && crate.lock === undefined && g.inventory.nextUid === next,
    `key ${key?.uid} keyed ${keyedTo}; then ${lock.id} ${lock.ql}`);
  psql(`delete from crate where world_id = ${W} and id = 7771;
delete from item where world_id = ${W} and holder_uid in ('${WHO.gil}', '${WHO.kay}') and def in ('padlock', 'key') and keyed is distinct from ${LOCK_H};`);
}
{
  // Which padlock is fitted: the first numbered of those not locked against use, to a crate (`perform_lock`) and to a
  // portcullis (`perform_gate_lock`) alike, on both sides. Gil's padlocks: quality 50, 80 locked against use, and 65,
  // numbered in that order -- so neither the best nor the first numbered is the one, if a locked one were taken.
  const CT: Target = { kind: 'crate', id: 7772 };
  const PORT = `world_id = ${W} and level = 0 and dir = 'h' and x = ${PORTCULLIS.x} and y = ${PORTCULLIS.y + 1}`;
  const pack = (pads: Array<[number, boolean]>): string => `
delete from item where world_id = ${W} and holder_uid = '${WHO.gil}' and def = 'padlock';
${pads.map(([ql, locked]) => `insert into item (world_id, holder, holder_uid, def, ql, count, locked) values (${W}, 'player', '${WHO.gil}', 'padlock', ${ql}, 1, ${locked});`).join('\n')}`;
  const browserPack = (g: Game, pads: Array<[number, boolean]>): void => {
    for (const p of g.inventory.items.filter((i) => i.id === 'padlock')) g.inventory.remove(p.uid, p.count);
    for (const [ql, locked] of pads) g.inventory.add('padlock', { ql }).locked = locked;
  };
  psql(`delete from crate where world_id = ${W} and id = 7772;
insert into crate (world_id, id, kind, x, y, sx, sy, made_by) values (${W}, 7772, 'plank', 8, 12, 0, 0, '${WHO.gil}');
${pack([[80, true]])}`);
  // Only a padlock locked against use: none to fit, in the same words, to a crate and to a portcullis.
  const gL = browserFor('gil', 8.5, 11.5);
  browserPack(gL, [[80, true]]);
  const fit = ACTION_BY_ID.get('fit_lock') as ActionDef;
  const NONE = 'You have no padlock. Forge one at a smelter.';
  const crateWhy = [fit.check?.(CT, gL) ?? 'ALLOWED', islandSays('gil', 'fit_lock', CT, 8.5, 11.5)];
  gL.player.x = 10.5;
  gL.player.y = 12.5;
  const portWhy = [fit.check?.(PT, gL) ?? 'ALLOWED', islandSays('gil', 'fit_lock', PT)];
  check('with only a padlock locked against use, there is no padlock to fit, to a crate or to a portcullis, in the same words on both sides, and the browser does not offer the job',
    [...crateWhy, ...portWhy].every((w) => w === NONE) && !fit.applies(CT, gL) && !fit.applies(PT, gL),
    `crate: browser "${crateWhy[0]}", island "${crateWhy[1]}"; portcullis: browser "${portWhy[0]}", island "${portWhy[1]}"`);
  // And with all three: the crate takes the 50, and the portcullis then the 65; the locked 80 stays a locked padlock.
  psql(`${pack([[50, false], [80, true], [65, false]])}
update player set x = 8.5, y = 11.5, level = 0 where world_id = ${W} and uid = '${WHO.gil}';
select act_perform(${W}, '${WHO.gil}', 'fit_lock', '${tj(CT)}'::jsonb) \\g /dev/null
update player set x = 10.5, y = 12.5, level = 0 where world_id = ${W} and uid = '${WHO.gil}';
select act_perform(${W}, '${WHO.gil}', 'fit_lock', '${tj(PT)}'::jsonb) \\g /dev/null`);
  const island = psql(`select format('crate %s, portcullis %s; left: %s',
  (select i.def || ' ' || i.ql from crate c join item i on i.id = c.lock where c.world_id = ${W} and c.id = 7772),
  (select i.def || ' ' || i.ql from wall w join item i on i.id = w.lock
    where w.world_id = ${W} and w.level = 0 and w.dir = 'h' and w.x = ${PORTCULLIS.x} and w.y = ${PORTCULLIS.y + 1}),
  (select string_agg(def || ' ' || ql || case when locked then ' locked' else '' end, ', ' order by id) from item
    where world_id = ${W} and holder_uid = '${WHO.gil}' and def = 'padlock'))`);
  const g = browserFor('gil', 8.5, 11.5);
  browserPack(g, [[50, false], [80, true], [65, false]]);
  fit.perform(CT, g);
  g.player.x = 10.5;
  g.player.y = 12.5;
  fit.perform(PT, g);
  const lockOf = (uid: number | undefined): string => {
    const it = g.inventory.items.find((i) => i.uid === uid);
    return it ? `${it.id} ${it.ql}` : 'none';
  };
  const mine = `crate ${lockOf(g.crates.get(7772)?.lock)}, portcullis ${lockOf(g.buildings.wall(0, PORTCULLIS.x, PORTCULLIS.y, PORTCULLIS.side)?.lock)}; left: ${
    g.inventory.items.filter((i) => i.id === 'padlock').map((i) => `padlock ${i.ql}${i.locked ? ' locked' : ''}`).join(', ')}`;
  check('Fit a padlock takes the first numbered padlock not locked against use, to a crate and then to a portcullis, and leaves the locked one a locked padlock, on both sides',
    island === mine && island === 'crate key 50, portcullis key 65; left: padlock 80 locked', `island "${island}", browser "${mine}"`);
  psql(`delete from crate where world_id = ${W} and id = 7772;
update wall set lock = null where ${PORT};
delete from item where world_id = ${W} and holder_uid = '${WHO.gil}' and def in ('padlock', 'key') and keyed is distinct from ${LOCK_H}
  and keyed is distinct from (select lock from bridge where world_id = ${W} and id = ${BID});`);
}
both('then Sim may not raise it', 'sim', 'raise_drawbridge', BT, LOCKED);
both('nor may Kay, whose keys are to other locks', 'kay', 'raise_drawbridge', BT, LOCKED);
{
  const { mine, theirs, g } = doBoth('gil', 'raise_drawbridge', BT);
  check('Gil raises it, in the same words on both sides', mine === theirs && mine === drawbridgeSaid(true), `browser "${mine}", island "${theirs}"`);
  check('and it is up on both sides', g.bridges.get(BID)?.raised === true && psql(`select raised from bridge where id = ${BID}`) === 't');
}

/* ---- 5. the island's own walk, over the drawbridge ------------------------------ */

const walk = (x0: number, y0: number, x1: number, y1: number): number =>
  Number(psql(`select walk_share(${W}, '${WHO.sim}', 0, ${x0}, ${y0}, ${x1}, ${y1})`));
const deep = (): string => psql(`
update player set x = 10.5, y = 13.5, level = 0 where world_id = ${W} and uid = '${WHO.sim}';
select in_deep_water(${W}, '${WHO.sim}');`).split('\n').pop() as string;
{
  const upAcross = walk(10.5, 12.5, 10.5, 15.5);
  const upFrom = walk(10.5, 12.5, 10.5, 13.5);
  const g = browserFor('sim');
  check('up, the island will not let a body walk out over the gap, from the winch end or the far bank',
    upAcross < 1 && upFrom < 1 && walk(10.5, 15.5, 10.5, 12.5) < 1 && g.stepRule(10, 15, 0, 10, 14) === null,
    `across ${upAcross.toFixed(2)} of the way, off the bank ${upFrom.toFixed(2)}`);
  check('and a body out on the span is in the moat', deep() === 't', `in deep water: ${deep()}`);
  setDrawbridge(false);
  const downAcross = walk(10.5, 12.5, 10.5, 15.5);
  const g2 = browserFor('sim');
  check('down, the island lets a body walk it end to end, and so does the browser',
    downAcross === 1 && g2.stepRule(10, 12, 0, 10, 13) === 0 && g2.stepRule(10, 14, 0, 10, 15) === 0, `${downAcross} of the way`);
  check('and a body on the span is on the deck', deep() === 'f', `in deep water: ${deep()}`);
}

/* ---- 6. who may pull a bridge down ---------------------------------------------- */

const PULL = (deed: string): string =>
  `That is part of ${deed}. Only its builders may ${ACTION_BY_ID.get('demolish_bridge')?.label.toLowerCase()} there.`;
// Down, both its ends on Gatehold, with the padlock Gil fitted to its winch in 4.
both('a drawbridge on a settlement is not pulled down by Sim, a stranger to it, in the same words on both sides',
  'sim', 'demolish_bridge', BT, PULL('Gatehold'));
both('nor by Kay, whose keys are to other locks and who is no builder there', 'kay', 'demolish_bridge', BT, PULL('Gatehold'));
setDrawbridge(true);
both('nor from the far bank with the deck drawn up', 'sim', 'demolish_bridge', BT, PULL('Gatehold'), [10.5, 15.5]);
setDrawbridge(false);
both('Ben, who may take a wall down there, may pull a bridge down there too, but the padlock stops him, in the lock\'s words',
  'ben', 'demolish_bridge', BT, LOCKED);
both('and Gil, whose key and ground it is, may pull it down', 'gil', 'demolish_bridge', BT, null);

/** A plank bridge from (x, 12) over the moat to (x, 15), decked, as somebody set it out. */
const plankBridge = (x: number, by: Who): Extract<Target, { kind: 'bridge' }> => {
  psql(`
do $$
declare w uuid; v_b bigint;
begin
  select id into w from world where name = 'Hoarding';
  insert into bridge (world_id, kind, ax, ay, bx, by, height, material, made_by)
    values (w, 'wood', ${x}, 12, ${x}, 15, ${BANK}, 'Oak', '${WHO[by]}') returning id into v_b;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select w, v_b, t.n, t.x, t.y, (select jsonb_object_agg(k, 0) from jsonb_object_keys(span_bill('wood', t.n)) k), span_bill('wood', t.n)
      from span_tiles(${x}, 12, ${x}, 15) t;
end $$;`);
  return { kind: 'bridge', id: Number(psql(`select id from bridge where world_id = ${W} and ax = ${x} and ay = 12`)) };
};
const OPEN = plankBridge(13, 'gil');
const ANNS = plankBridge(14, 'ann');
both('off any settlement anybody may pull a bridge down, as before: Sim, one Gil set out', 'sim', 'demolish_bridge', OPEN, null, [13.5, 12.5]);
both('Bob, a stranger on Annhold, may not pull down one with its far end on Annhold, in the same words on both sides',
  'bob', 'demolish_bridge', ANNS, PULL('Annhold'), [14.5, 12.5]);
both('and Gil, who founded another, is a stranger there too', 'gil', 'demolish_bridge', ANNS, PULL('Annhold'), [14.5, 12.5]);
both('while Ann, who founded it, may', 'ann', 'demolish_bridge', ANNS, null, [14.5, 15.5]);
check(`it is pulled down within ${PULL_REACH} tiles of the middle of either end, the same number on both sides`,
  Number(psql('select bridge_pull_reach()')) === PULL_REACH, `${PULL_REACH} tiles`);
both(`so Sim may, standing ${PULL_REACH - 0.4} tiles from the middle of its near end`, 'sim', 'demolish_bridge', OPEN, null, [13.5, 12.5 - (PULL_REACH - 0.4)]);
both(`and may not from ${PULL_REACH + 0.2}, in the same words`, 'sim', 'demolish_bridge', OPEN, 'Stand at one end of it.', [13.5, 12.5 - (PULL_REACH + 0.2)]);
psql(`
delete from bridge_span where world_id = ${W} and bridge in (${OPEN.id}, ${ANNS.id});
delete from bridge where world_id = ${W} and id in (${OPEN.id}, ${ANNS.id});
delete from deed where world_id = ${W} and founded_by = '${WHO.ann}';`);

/* ---- 7. planning each ------------------------------------------------------------ */

psql(`
do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  delete from wall where world_id = w and level = 0 and dir = 'h' and x = 11 and y = 9;
  delete from private.hidden_door_plan where world_id = w;
  update player set x = 11.5, y = 9.5 where world_id = w and uid in ('${WHO.gil}', '${WHO.ben}');
  delete from item where world_id = w and holder_uid in ('${WHO.gil}', '${WHO.ben}') and def in ('padlock', 'hinge', 'mallet', 'key');
  insert into item (world_id, holder, holder_uid, def, ql, count) values
    (w, 'player', '${WHO.gil}', 'mallet', 40, 1), (w, 'player', '${WHO.ben}', 'mallet', 40, 1);
end $$;`);
const PLAN_WALL = ACTION_BY_ID.get('plan_wall') as ActionDef;
type TileTarget = Extract<Target, { kind: 'tile' }>;
const NT = (wallType: string, material: string, x = 11, y = 9, side: Side = 'n'): TileTarget =>
  ({ ...tileT(x, y, side), wallType: wallType as never, material } as TileTarget);
const MAT_NAME = MATERIALS.find((m) => m.id === MAT)?.name ?? MAT;
/** The north side of (11, 9) with no wall on it, in a browser in somebody's shoes with a mallet and whatever `give` adds. */
const planner = (give: (g: Game) => void = () => {}, who: Who = 'gil'): Game => {
  const g = browserFor(who, 11.5, 9.5);
  g.buildings.removeWall(0, 11, 9, 'n');
  g.inventory.add('mallet', { ql: 40 });
  give(g);
  return g;
};
const planBoth = (what: string, action: string, t: Target, want: string | null, give: (g: Game) => void = () => {}, at: [number, number] = [11.5, 9.5]): void => {
  const g = planner(give);
  g.player.x = at[0];
  g.player.y = at[1];
  const mine = ACTION_BY_ID.get(action)?.check?.(t, g) ?? 'ALLOWED';
  const theirs = islandSays('gil', action, t, ...at);
  check(what, mine === theirs && (want === null ? mine === 'ALLOWED' : mine === want), `browser "${mine}", island "${theirs}"`);
};

// The portcullis: in stone, and named as what it is.
const woodWhy = gatePlanRefusal('portcullis', MATERIALS.find((m) => m.id === 'log'), 0);
planBoth('a portcullis will not be laid in timber, in the same words', 'plan_wall', NT('portcullis', 'log'), woodWhy);
planBoth('but in stone it may be planned', 'plan_wall', NT('portcullis', MAT), null);
{
  const { mine, theirs } = doBoth('gil', 'plan_wall', NT('portcullis', MAT), [11.5, 9.5]);
  check('and planning one says what it is, in the same words on both sides',
    mine === theirs && mine.startsWith(`${planLine('portcullis', MAT_NAME, 'north')} It needs `), `browser "${mine}", island "${theirs}"`);
  psql(`delete from wall where world_id = ${W} and level = 0 and dir = 'h' and x = 11 and y = 9;`);
}
{
  const lines = WALL_TYPES.map((d) => ({ id: d.id, mine: planLine(d.id, MAT_NAME, 'north'), theirs: psql(`select plan_line('${d.id}', '${MAT}', 'n')`) }));
  const arch = lines.find((l) => l.id === 'arch')?.mine;
  check(`and the plan line gives every one of the ${lines.length} types of wall its own article, in the same words on both sides`,
    lines.every((l) => l.mine === l.theirs) && arch === 'You plan an arch in stone brick on the north side.',
    lines.filter((l) => l.mine !== l.theirs).map((l) => `${l.id}: "${l.mine}" and "${l.theirs}"`).join('; ') || `"${arch}"`);
}

// The hidden door: not a wall type to plan, and asked for with the plan itself.
planBoth('a hidden door is not planned as a type of wall, and the refusal says where it is, in the same words', 'plan_wall',
  NT('hidden_door', MAT), HIDDEN_DOOR_ALONE);
const HT: TileTarget = { ...tileT(11, 9, 'n'), material: MAT } as TileTarget;
const ST = NT('solid', MAT);
const iron = (g: Game): void => { g.inventory.add('padlock', { ql: 55 }); g.inventory.add('hinge', { ql: 40, count: HIDDEN_DOOR_HINGES }); };

/** Gil's iron for a hidden door, and nothing else of the sort: `n` padlocks and `hinges` hinges, and no keys. */
const ironFor = (n: number, hinges = n * HIDDEN_DOOR_HINGES): string => `
delete from item where world_id = ${W} and holder_uid = '${WHO.gil}' and def in ('padlock', 'hinge', 'key');
${n ? `insert into item (world_id, holder, holder_uid, def, ql, count)
  select ${W}, 'player', '${WHO.gil}', 'padlock', 55, 1 from generate_series(1, ${n});` : ''}
${hinges ? `insert into item (world_id, holder, holder_uid, def, ql, count) values (${W}, 'player', '${WHO.gil}', 'hinge', 40, ${hinges});` : ''}`;
/**
 * Somebody at `at`, hands empty and rested, and the island signed in as them;
 * then whatever `body` sets. Each run from the same hands: what the last plan
 * taught them would shorten this one, and the body's characteristics, which
 * speak only when their whole number moves, are set halfway between two, so
 * that what a plan teaches them is never a line in one run and not in another
 * -- the lines are counted. Nothing asked is cleared here: what is asked is
 * kept or dropped by the island's own rules, and that is what is tested.
 */
const fresh = (body = '', who: Who = 'gil', at: [number, number] = [11.5, 9.5]): string => `
update player set x = ${at[0]}, y = ${at[1]}, level = 0, act = null, act_target = null, act_started = null, act_ends = null,
       act_left = null, act_goes = null, act_queue = '[]', stats = stats || '{"stamina": 1}'::jsonb
 where world_id = ${W} and uid = '${WHO[who]}';
${body ? `update player set ${body} where world_id = ${W} and uid = '${WHO[who]}';` : ''}
delete from skill where world_id = ${W} and uid = '${WHO[who]}';
insert into skill (world_id, uid, id, value) select ${W}, '${WHO[who]}', d.id, d.start + 0.5 from skill_def d where d.quiet;
delete from event where world_id = ${W} and uid = '${WHO[who]}';
delete from caller where uid = '${WHO[who]}';
select set_config('request.jwt.claims', json_build_object('sub', '${WHO[who]}')::text, false) \\g /dev/null`;
/** A wall's plan asked for on the island, as a browser sends it: a solid wall's by `rpc_act`, a hidden door's by `rpc_plan_hidden_wall`. */
const askPlan = (hidden: boolean, t: TileTarget = ST): string => (hidden
  ? `rpc_plan_hidden_wall(${W}, '${tj(t)}'::jsonb)`
  : `rpc_act(${W}, 'plan_wall', '${tj(t)}'::jsonb)`);
const ASKS = `select count(*) from private.hidden_door_plan where world_id = ${W};`;
psql(`delete from private.hidden_door_plan where world_id = ${W};`);

// The iron, asked for first, by the one call that would plan it: refused, nothing is started and nothing is kept.
{
  const islandSaysIron = (n: number, hinges: number): string[] => psql(`${fresh()}
${ironFor(n, hinges)}
delete from wall where world_id = ${W} and level = 0 and dir = 'h' and x = 11 and y = 9;
select coalesce(${askPlan(true, HT)}->>'why', 'TAKEN');
${ASKS}
select coalesce(act, 'nothing') from player where world_id = ${W} and uid = '${WHO.gil}';`).split('\n');
  const browserSaysIron = (give: (g: Game) => void): Game => {
    const g = planner(give);
    planHiddenDoor(g, PLAN_WALL, HT);
    return g;
  };
  const [why, kept, act] = islandSaysIron(0, 0);
  const g = browserSaysIron(() => {});
  const mine = g.log[g.log.length - 1]?.text;
  check('a hidden door wants a padlock in hand: refused by the one call that would plan it, in the same words on both sides, nothing started and nothing kept',
    why === mine && why === 'A hidden door takes a padlock when it is planned. Forge one at a smelter.' && kept === '0' && act === 'nothing'
      && g.action === null,
    `island "${why}", ${kept} kept, in hand ${act}; browser "${mine}", ${job(g)}`);
  const [why2, kept2] = islandSaysIron(1, 0);
  const g2 = browserSaysIron((x) => { x.inventory.add('padlock', { ql: 55 }); });
  const mine2 = g2.log[g2.log.length - 1]?.text;
  check('and a door\'s hinges, in the same words',
    why2 === mine2 && why2 === `A hidden door takes ${numberWord(HIDDEN_DOOR_HINGES)} hinges when it is planned.` && kept2 === '0' && g2.action === null,
    `island "${why2}", browser "${mine2}"`);
}

/** What planning the north side of (11, 9) on the island leaves, asked for as a hidden door or as a solid wall. */
type Run = {
  answer: string; row: string; wind: string; wall: string; told: string; pack: string; seen: string;
  /** The padlocks' rows before, and the key to the wall after, as "row keyed lock". */
  pads: string; key: string;
  /** How far the island's counters moved, from the call to the plan done. */
  moved: string;
  /** What the call changed on the planner's row, which every islander reads: the fields, by name. */
  fields: string;
};
const islandPlan = (who: Who, hidden: boolean, between = '', t: TileTarget = ST): Run => {
  const bd = borderOf(t.x, t.y, t.side as Side);
  const [pads, c0, r0, answer, r1, row, wind, c1, wall, told, pack, key] = psql(`${fresh('', who, [t.x + 0.5, t.y + 0.5])}
delete from wall where world_id = ${W} and level = 0 and dir = '${bd.dir}' and x = ${bd.x} and y = ${bd.y};
select coalesce((select string_agg(id::text, ',' order by id) from item where world_id = ${W} and holder_uid = '${WHO[who]}' and def = 'padlock'), 'none');
${COUNTERS}
select to_jsonb(p)::text from player p where world_id = ${W} and uid = '${WHO[who]}';
select (${askPlan(hidden, t)} - 'ends')::text;
select to_jsonb(p)::text from player p where world_id = ${W} and uid = '${WHO[who]}';
select format('%s|%s|%s|%s|%s|%s', act, act_target, act_queue, act_left, act_goes, round(extract(epoch from act_ends - act_started)::numeric, 3))
  from player where world_id = ${W} and uid = '${WHO[who]}';
${between}
update player set act_ends = now() where world_id = ${W} and uid = '${WHO[who]}';
select settle(${W}, '${WHO[who]}') \\g /dev/null
select round((stats->>'stamina')::numeric, 4) from player where world_id = ${W} and uid = '${WHO[who]}';
${COUNTERS}
select coalesce((select format('%s|%s|%s', type, coalesce(lock::text, 'none'), planned_by) from wall
  where world_id = ${W} and level = 0 and dir = '${bd.dir}' and x = ${bd.x} and y = ${bd.y}), 'no wall');
select coalesce(string_agg(text, '~' order by n), '') from event where world_id = ${W} and uid = '${WHO[who]}' and kind = 'event';
select format('%s padlocks, %s hinges, %s keys', pack_count(${W}, '${WHO[who]}', 'padlock'), pack_count(${W}, '${WHO[who]}', 'hinge'),
  (select count(*) from item i join wall w on w.world_id = i.world_id and w.lock = i.keyed
    where i.world_id = ${W} and i.holder_uid = '${WHO[who]}' and i.def = 'key' and w.level = 0 and w.dir = '${bd.dir}' and w.x = ${bd.x} and w.y = ${bd.y}));
select coalesce((select string_agg(i.id || ' keyed ' || i.keyed, ',') from item i join wall w on w.world_id = i.world_id and w.lock = i.keyed
    where i.world_id = ${W} and i.holder_uid = '${WHO[who]}' and i.def = 'key' and w.level = 0 and w.dir = '${bd.dir}' and w.x = ${bd.x} and w.y = ${bd.y}), 'none');`).split('\n');
  const before = JSON.parse(r0) as Record<string, unknown>;
  const after = JSON.parse(r1) as Record<string, unknown>;
  const fields = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])).sort().join(', ');
  const seen = JSON.stringify(wallIn(groundFor('sim', 13.5, 9.5), bd.dir, bd.x, bd.y));
  return { answer, row, wind, wall, told, pack, seen, pads, key, moved: moved(c0, c1), fields };
};
/** And on the island, a plain solid wall planned at the north side of (11, 9) afterwards: what it is, and the iron left. */
const islandLater = (): string => {
  const P = islandPlan('gil', false);
  return `${P.wall}; ${P.pack}`;
};
const LATER = `solid|none|${WHO.gil}; 1 padlocks, ${HIDDEN_DOOR_HINGES} hinges, 0 keys`;

psql(ironFor(1));
const SOLID = islandPlan('gil', false);
const HID = islandPlan('gil', true);
check('asked for as a hidden door, the plan is the one call, answered exactly as a solid wall\'s: the same job, target, queue and time',
  HID.row === SOLID.row && HID.answer === SOLID.answer && SOLID.row.startsWith('plan_wall|') && SOLID.row.includes('"wallType": "solid"'),
  `solid "${SOLID.row}", hidden "${HID.row}"; answered ${HID.answer === SOLID.answer ? 'the same' : `"${SOLID.answer}" and "${HID.answer}"`}`);
check('and the call moves the fields of the planner\'s row that every islander reads exactly as a solid wall\'s plan moves them, and no others',
  HID.fields === SOLID.fields && SOLID.fields.includes('act_target'), `solid wall: ${SOLID.fields}; hidden door: ${HID.fields}`);
check('and it takes the same wind', HID.wind === SOLID.wind && Number(SOLID.wind) < 1, `${SOLID.wind} and ${HID.wind} left`);
check('and to Sim the wall it leaves is the same row in the ground read, in every field', HID.seen === SOLID.seen && JSON.parse(SOLID.seen)?.type === 'solid', `${SOLID.seen} and ${HID.seen}`);
const lockH = Number(HID.wall.split('|')[1]);
check('and on the island it is a hidden door: the padlock\'s number is its lock, the key is cut, the hinges spent',
  SOLID.wall === `solid|none|${WHO.gil}` && HID.wall === `hidden_door|${lockH}|${WHO.gil}` && lockH > 0 && HID.pack === '0 padlocks, 0 hinges, 1 keys',
  `solid "${SOLID.wall}", hidden "${HID.wall}", ${HID.pack}`);
check('and the key is the padlock\'s own row, keyed to itself: no new row is numbered for it',
  /^\d+$/.test(HID.pads) && HID.key === `${HID.pads} keyed ${HID.pads}` && lockH === Number(HID.pads), `padlock row ${HID.pads}; key ${HID.key}`);
check('and every counter numbering rows the island serves moves exactly as far for a hidden door as for a solid wall, the events\' and the items\' among them',
  HID.moved === SOLID.moved && SOLID.moved.includes('event_n_seq +') && SOLID.moved.includes('item_id_seq +0'),
  `solid wall: ${SOLID.moved}; hidden door: ${HID.moved}`);
check('the island tells the planner the line a solid wall\'s plan says, and what it is on the end of that same line, on his own ground',
  HID.told === `${SOLID.told} ${hiddenDoorSaid({ own: true, deed: 'Gatehold' })}` && !HID.told.includes('~') && !SOLID.told.includes('~')
    && SOLID.told.startsWith(`${planLine('solid', MAT_NAME, 'north')} It needs `),
  HID.told.replace(/~/g, ' / '));
check('nothing is left asked for', psql(ASKS) === '0');
check('and the founder\'s own ground read tells him what it is', wallIn(groundFor('gil', 11.5, 9.5), 'h', 11, 9)?.type === 'hidden_door');

/** A browser's job in hand, as the body broadcast and the bar over its head say it: the job, its target, its time and wind. */
function job(g: Game): string {
  const a = g.action;
  if (!a) return 'none';
  const target = Object.fromEntries(Object.entries(a.target).sort(([p], [q]) => p.localeCompare(q)));
  return `${a.def.id}|${a.def.verb}|${JSON.stringify(target)}|${a.duration.toFixed(3)}|${a.def.stamina}`;
}
/** And that job done, and what it said. */
const finish = (g: Game): string => {
  const a = g.action;
  g.log.length = 0;
  if (a) {
    a.def.perform(a.target, g);
    g.action = null;
  }
  return g.log.filter((l) => l.kind === 'event').map((l) => l.text).join('~');
};
/** And in a browser, alone, a plain solid wall planned at the north side of (11, 9) afterwards, standing by it: what it is, and the padlock. */
const browserLater = (g: Game): string => {
  g.action = null;
  g.queue.length = 0;
  g.player.stats.stamina = 1;
  g.player.x = 11.5;
  g.player.y = 9.5;
  g.buildings.removeWall(0, 11, 9, 'n');
  g.requestAction(PLAN_WALL, NT('solid', MAT));
  finish(g);
  return `${g.buildings.wall(0, 11, 9, 'n')?.type}, ${g.inventory.has('padlock') ? 'the padlock in the pack' : 'no padlock'}`;
};
const B_LATER = 'solid, the padlock in the pack';
{
  const gS = planner(iron);
  gS.requestAction(PLAN_WALL, ST);
  const jobS = job(gS);
  const gH = planner(iron);
  const padlock = gH.inventory.find('padlock');
  planHiddenDoor(gH, PLAN_WALL, HT);
  check('in a browser too, asked for as a hidden door it is a solid wall\'s plan: the same job, target, time, wind and words over your head',
    job(gH) === jobS && jobS.startsWith('plan_wall|'), `solid ${jobS}; hidden ${job(gH)}`);
  const toldS = finish(gS);
  const toldH = finish(gH);
  const w = gH.buildings.wall(0, 11, 9, 'n');
  const key = gH.inventory.items.find((i) => i.id === 'key' && i.keyed === padlock?.uid);
  check('and planned, it takes the padlock and the hinges and cuts the key, as the island does',
    w?.type === 'hidden_door' && w.lock === padlock?.uid && !!key && !gH.inventory.has('padlock') && gH.inventory.count('hinge') === 0
      && gS.buildings.wall(0, 11, 9, 'n')?.type === 'solid',
    `lock ${w?.lock}, key to ${key?.keyed}`);
  check('and the key is the padlock itself, keyed to itself, so no new item is numbered for it, as on the island',
    key === padlock && key?.uid === padlock?.uid && gH.inventory.nextUid === gS.inventory.nextUid,
    `padlock ${padlock?.uid}, key ${key?.uid}; next number ${gH.inventory.nextUid} and ${gS.inventory.nextUid} for a solid wall`);
  check('and says what the island says, in the one line a solid wall\'s plan says', toldS === SOLID.told && toldH === HID.told,
    `browser "${toldH.replace(/~/g, ' / ')}"`);
}

// On an island the browser sends nothing before the walk: the plan goes when the feet arrive, in the one call, as every plan does.
{
  type Sent = { action: string; target: Target; hidden: boolean };
  const onIsland = (from: [number, number]): { g: Game; sent: Sent[] } => {
    const g = planner(iron);
    const sent: Sent[] = [];
    g.ask = (def, target) => { sent.push({ action: def.id, target, hidden: hiddenAsk(target) }); };
    g.player.x = from[0];
    g.player.y = from[1];
    return { g, sent };
  };
  const { g, sent } = onIsland([7.5, 6.5]);
  planHiddenDoor(g, PLAN_WALL, HT);
  const walking = g.action?.state === 'walking' && !!g.player.path;
  const before = sent.length;
  // The feet arrive.
  g.player.path = null;
  g.player.x = 11.5;
  g.player.y = 8.5;
  (g as unknown as { updateAction(dt: number): void }).updateAction(0);
  const s = sent[0];
  check('on an island, asked for from across the yard, nothing goes to the island while the feet are on their way, and when they arrive the one call goes: the solid wall\'s plan, sent as a hidden door\'s',
    walking && before === 0 && sent.length === 1 && s.action === 'plan_wall' && s.hidden
      && JSON.stringify(s.target) === JSON.stringify({ ...HT, wallType: 'solid' }),
    `walking ${walking}, ${before} sent on the way; then ${JSON.stringify(sent.map((x) => ({ ...x, target: undefined })))}`);
  const near = onIsland([11.5, 9.5]);
  planHiddenDoor(near.g, PLAN_WALL, HT);
  const nowhere = onIsland([7.5, 6.5]);
  (nowhere.g as unknown as { walkToward(): boolean }).walkToward = () => false;
  planHiddenDoor(nowhere.g, PLAN_WALL, HT);
  check('and asked for beside it, it goes at once; with no way there, nothing goes at all',
    near.sent.length === 1 && near.sent[0].hidden && nowhere.sent.length === 0
      && nowhere.g.log[nowhere.g.log.length - 1]?.text === "You can't find a way to get there.",
    `beside: ${near.sent.length} sent; no way: ${nowhere.sent.length} sent, "${nowhere.g.log[nowhere.g.log.length - 1]?.text}"`);
}

// Ben, a builder on Gil's settlement: the founder is named.
{
  psql(`delete from item where world_id = ${W} and holder_uid = '${WHO.ben}' and def in ('padlock', 'hinge', 'key');
insert into item (world_id, holder, holder_uid, def, ql, count) values
    (${W}, 'player', '${WHO.ben}', 'padlock', 55, 1), (${W}, 'player', '${WHO.ben}', 'hinge', 40, ${HIDDEN_DOOR_HINGES});`);
  const B = islandPlan('ben', true);
  const g = planner(iron, 'ben');
  planHiddenDoor(g, PLAN_WALL, HT);
  const told = finish(g);
  check('planned by a builder who is not the founder, both sides name the founder it also admits',
    B.told === told && told.endsWith(hiddenDoorSaid({ own: false, deed: 'Gatehold' })) && B.wall.startsWith('hidden_door|'),
    `browser "${told.replace(/~/g, ' / ')}", island "${B.told.replace(/~/g, ' / ')}"`);
}

// The padlock gone before the plan is done: the solid wall it was asked as.
{
  psql(ironFor(1));
  const R = islandPlan('gil', true, `delete from item where world_id = ${W} and holder_uid = '${WHO.gil}' and def = 'padlock';`);
  const g = planner(iron);
  planHiddenDoor(g, PLAN_WALL, HT);
  const lock = g.inventory.find('padlock');
  if (lock) g.inventory.remove(lock.uid, 1);
  const told = finish(g);
  check('with the padlock gone before the plan is done, it is the solid wall it was asked as, in the same words',
    R.wall === `solid|none|${WHO.gil}` && g.buildings.wall(0, 11, 9, 'n')?.type === 'solid' && R.told === told && told.endsWith(HIDDEN_DOOR_SHORT),
    `browser "${told.replace(/~/g, ' / ')}", island "${R.told.replace(/~/g, ' / ')}"`);
}

// An ask still waiting `HIDDEN_DOOR_LAPSE` after it was made is not taken up: a backstop only.
const LAPSE = spanWords(HIDDEN_DOOR_LAPSE);
check(`an ask waits ${LAPSE} at most, on both sides`, Number(psql('select hidden_door_lapse()')) === HIDDEN_DOOR_LAPSE, `${HIDDEN_DOOR_LAPSE} seconds`);
{
  psql(ironFor(1));
  const L = islandPlan('gil', true, `update private.hidden_door_plan set at = at - make_interval(secs => hidden_door_lapse() + 1) where world_id = ${W};`);
  const g = planner(iron);
  planHiddenDoor(g, PLAN_WALL, HT);
  const realNow = Date.now;
  Date.now = () => realNow() + (HIDDEN_DOOR_LAPSE + 1) * 1000;
  const told = finish(g);
  Date.now = realNow;
  check(`a plan done more than ${LAPSE} after it was asked for is the solid wall it was planned as: the iron stays in the pack and the line says nothing more, on both sides`,
    L.wall === `solid|none|${WHO.gil}` && L.pack === `1 padlocks, ${HIDDEN_DOOR_HINGES} hinges, 0 keys` && L.told === SOLID.told
      && g.buildings.wall(0, 11, 9, 'n')?.type === 'solid' && g.inventory.has('padlock') && told === L.told && psql(ASKS) === '0',
    `island "${L.wall}", ${L.pack}; browser "${told}"`);
}

// Two asked for at once, on two borders, both plans lined up: both are doors.
const HB: TileTarget = { ...tileT(11, 9, 'e'), material: MAT } as TileTarget;
const solidOf = (t: TileTarget): TileTarget => ({ ...t, wallType: 'solid' } as TileTarget);
const BOTH2 = `((dir = 'h' and x = 11 and y = 9) or (dir = 'v' and x = 12 and y = 9))`;
const BOTH2W = `((w.dir = 'h' and w.x = 11 and w.y = 9) or (w.dir = 'v' and w.x = 12 and w.y = 9))`;
/** The island, after `calls`: the asks and the queue waiting, then both jobs done, the two walls, the iron and what was said. */
const islandTwo = (calls: string, n: number): string[] => psql(`${fresh()}
${ironFor(n)}
delete from wall where world_id = ${W} and level = 0 and ${BOTH2};
${calls}
select (${ASKS.replace(/;$/, '')}) || ' asked, ' || (select jsonb_array_length(act_queue) from player where world_id = ${W} and uid = '${WHO.gil}') || ' lined up';
update player set act_ends = now() where world_id = ${W} and uid = '${WHO.gil}';
select settle(${W}, '${WHO.gil}') \\g /dev/null
update player set act_ends = now() where world_id = ${W} and uid = '${WHO.gil}';
select settle(${W}, '${WHO.gil}') \\g /dev/null
select string_agg(format('%s %s,%s %s', dir, x, y, type), '; ' order by dir, x, y) from wall where world_id = ${W} and level = 0 and ${BOTH2};
select format('%s padlocks, %s hinges, %s keys to them, %s asked', pack_count(${W}, '${WHO.gil}', 'padlock'), pack_count(${W}, '${WHO.gil}', 'hinge'),
  (select count(distinct i.id) from item i join wall w on w.world_id = i.world_id and w.lock = i.keyed
    where i.world_id = ${W} and i.holder_uid = '${WHO.gil}' and i.def = 'key' and w.level = 0 and ${BOTH2W}),
  (${ASKS.replace(/;$/, '')}));
select coalesce(string_agg(text, '~' order by n), '') from event where world_id = ${W} and uid = '${WHO.gil}' and kind = 'event';`).split('\n');
/** And a browser, alone, the same: two plans asked for in turn, the first in hand and the second lined up, both done. */
const browserTwo = (first: (g: Game) => void, second: (g: Game) => void, give: (g: Game) => void): { g: Game; lined: string; told: string } => {
  const g = planner(give);
  g.buildings.removeWall(0, 11, 9, 'e');
  first(g);
  second(g);
  const lined = `${g.action ? 1 : 0} in hand, ${g.queue.length} lined up`;
  const toldA = finish(g);
  (g as unknown as { nextInQueue(): boolean }).nextInQueue();
  const toldB = finish(g);
  return { g, lined, told: `${toldA}~${toldB}` };
};
{
  const [waiting, walls, pack, told] = islandTwo(`select ${askPlan(true, solidOf(HT))} \\g /dev/null
select ${askPlan(true, solidOf(HB))} \\g /dev/null`, 2);
  const pads: number[] = [];
  const two = browserTwo((g) => planHiddenDoor(g, PLAN_WALL, HT), (g) => planHiddenDoor(g, PLAN_WALL, HB), (g) => {
    iron(g);
    iron(g);
    pads.push(...g.inventory.items.filter((i) => i.id === 'padlock').map((i) => i.uid));
  });
  const a = two.g.buildings.wall(0, 11, 9, 'n');
  const b = two.g.buildings.wall(0, 11, 9, 'e');
  check('asked for on two borders at once, the second plan lined up behind the first, each ask waits beside its own job, and both are hidden doors, each with its own padlock and key, on both sides',
    waiting === '2 asked, 1 lined up' && walls === 'h 11,9 hidden_door; v 12,9 hidden_door' && pack === '0 padlocks, 0 hinges, 2 keys to them, 0 asked'
      && two.lined === '1 in hand, 1 lined up' && a?.type === 'hidden_door' && b?.type === 'hidden_door' && a.lock !== b.lock
      && pads.includes(a.lock ?? -1) && pads.includes(b.lock ?? -1) && !two.g.inventory.has('padlock') && two.g.inventory.count('hinge') === 0
      && two.told === told,
    `island: ${waiting}; ${walls}; ${pack}. browser: ${two.lined}; ${a?.type}, ${b?.type}; ${two.told === told ? 'the same lines' : `"${two.told}" and "${told}"`}`);
}
{
  // A hidden door's plan in hand and a plain wall's lined up behind it: only the door is a door.
  const [, walls, pack, told] = islandTwo(`select ${askPlan(true, solidOf(HT))} \\g /dev/null
select ${askPlan(false, solidOf(HB))} \\g /dev/null`, 2);
  const two = browserTwo((g) => planHiddenDoor(g, PLAN_WALL, HT), (g) => g.requestAction(PLAN_WALL, solidOf(HB)), (g) => { iron(g); iron(g); });
  const a = two.g.buildings.wall(0, 11, 9, 'n');
  const b = two.g.buildings.wall(0, 11, 9, 'e');
  check('with a hidden door\'s plan in hand and a plain wall\'s lined up behind it, the one is a door and the other a solid wall, and one padlock is left, on both sides',
    walls === 'h 11,9 hidden_door; v 12,9 solid' && pack === `1 padlocks, ${HIDDEN_DOOR_HINGES} hinges, 1 keys to them, 0 asked`
      && a?.type === 'hidden_door' && b?.type === 'solid' && two.g.inventory.count('padlock') === 1 && two.told === told,
    `island: ${walls}; ${pack}. browser: ${a?.type}, ${b?.type}`);
  // The east wall back as the gatehouse had it.
  psql(`update wall set type = 'solid', lock = null where world_id = ${W} and level = 0 and dir = 'v' and x = 12 and y = 9;`);
}

// The ask is for its border: whichever plan of a wall on it is planned first as a solid wall is the door, on whatever storey.
/** The north side of (11, 9) on the island after `calls` from Gil beside it with the iron for one, every job settled. */
const islandOne = (calls: string): { walls: string; state: string; told: string; refused: string } => {
  const [walls, state, told, refused] = psql(`${fresh()}
${ironFor(1)}
delete from wall where world_id = ${W} and level in (0, 1) and dir = 'h' and x = 11 and y = 9;
${calls}
update player set act_ends = now() where world_id = ${W} and uid = '${WHO.gil}';
select settle(${W}, '${WHO.gil}') \\g /dev/null
update player set act_ends = now() where world_id = ${W} and uid = '${WHO.gil}';
select settle(${W}, '${WHO.gil}') \\g /dev/null
select coalesce((select string_agg(level || ' ' || type, '; ' order by level) from wall where world_id = ${W} and dir = 'h' and x = 11 and y = 9), 'no wall');
select format('%s padlocks, %s hinges, %s keys, %s in hand, %s lined up', pack_count(${W}, '${WHO.gil}', 'padlock'), pack_count(${W}, '${WHO.gil}', 'hinge'),
  (select count(*) from item i join wall w on w.world_id = i.world_id and w.lock = i.keyed
    where i.world_id = ${W} and i.holder_uid = '${WHO.gil}' and i.def = 'key' and w.dir = 'h' and w.x = 11 and w.y = 9),
  (select coalesce(act, 'nothing') from player where world_id = ${W} and uid = '${WHO.gil}'),
  (select jsonb_array_length(act_queue) from player where world_id = ${W} and uid = '${WHO.gil}'));
select coalesce(string_agg(text, '~' order by n), '') from event where world_id = ${W} and uid = '${WHO.gil}' and kind = 'event';
select coalesce((select text from event where world_id = ${W} and uid = '${WHO.gil}' and kind = 'error' order by n desc limit 1), 'nothing refused');`).split('\n');
  return { walls, state, told, refused };
};
/** And a browser, alone, the same: `ask`, beside it with the iron for one; the job in hand done, and what was lined up taken up. */
const browserOne = (ask: (g: Game) => void): { walls: string; state: string; told: string; refused: string } => {
  const g = planner(iron);
  ask(g);
  const told = finish(g);
  (g as unknown as { nextInQueue(): boolean }).nextInQueue();
  const walls = [0, 1].map((l) => g.buildings.wall(l, 11, 9, 'n')).filter((w) => w !== undefined).map((w) => `${w?.level} ${w?.type}`).join('; ') || 'no wall';
  const locks = new Set<number | undefined>([0, 1].map((l) => g.buildings.wall(l, 11, 9, 'n')?.lock).filter((l) => l !== undefined));
  const keys = g.inventory.items.filter((i) => i.id === 'key' && i.keyed !== undefined && locks.has(i.keyed)).length;
  const state = `${g.inventory.count('padlock')} padlocks, ${g.inventory.count('hinge')} hinges, ${keys} keys, ${g.action?.def.id ?? 'nothing'} in hand, ${g.queue.length} lined up`;
  const refused = g.log.filter((l) => l.kind === 'error').map((l) => l.text).pop() ?? 'nothing refused';
  return { walls, state, told, refused };
};
const DOOR = { walls: '0 hidden_door', state: '0 padlocks, 0 hinges, 1 keys, nothing in hand, 0 lined up' };
const sameOne = (a: { walls: string; state: string; told: string; refused: string }, b: typeof a): boolean =>
  a.walls === b.walls && a.state === b.state && a.told === b.told && a.refused.endsWith(b.refused.replace(/^Plan wall: /, ''));
{
  const I = islandOne(`select ${askPlan(false, ST)} \\g /dev/null
select ${askPlan(true, HT)} \\g /dev/null`);
  const B = browserOne((g) => {
    g.requestAction(PLAN_WALL, ST);
    planHiddenDoor(g, PLAN_WALL, HT);
  });
  check('a plain solid wall\'s plan in hand and a hidden door\'s lined up behind it on the same side: the plain one, planned first, is the door, and the other is then refused, on both sides',
    sameOne(I, B) && I.walls === DOOR.walls && I.state === DOOR.state && I.told === HID.told && I.refused === 'There is already a wall on that side.',
    `island: ${I.walls}; ${I.state}; refused "${I.refused}". browser: ${B.walls}; ${B.state}; refused "${B.refused}"${I.told === B.told ? '' : `; told "${I.told}" and "${B.told}"`}`);
}
{
  const I = islandOne(`select ${askPlan(true, HT)} \\g /dev/null
select rpc_hold(${W}) \\g /dev/null
select ${askPlan(false, ST)} \\g /dev/null`);
  const B = browserOne((g) => {
    planHiddenDoor(g, PLAN_WALL, HT);
    // A walk puts the work down: the job back at the front of the queue, held.
    g.pauseAction();
    g.requestAction(PLAN_WALL, ST);
  });
  check('a hidden door\'s plan put down by a walk, and a plain solid wall then planned on that side: the plain one is the door, and the held one is refused when it comes up, on both sides',
    sameOne(I, B) && I.walls === DOOR.walls && I.state === DOOR.state && I.told === HID.told && I.refused === 'There is already a wall on that side.',
    `island: ${I.walls}; ${I.state}; refused "${I.refused}". browser: ${B.walls}; ${B.state}; refused "${B.refused}"${I.told === B.told ? '' : `; told "${I.told}" and "${B.told}"`}`);
}
{
  // Asked on the ground floor, and the work raised a storey before the plan is done: the wall it plans, up there, is the door.
  const I = islandOne(`update building set levels = 2, work_level = 0 where world_id = ${W} and id = 77;
select ${askPlan(true, HT)} \\g /dev/null
update building set work_level = 1 where world_id = ${W} and id = 77;`);
  psql(`update building set levels = 1, work_level = 0 where world_id = ${W} and id = 77;
delete from wall where world_id = ${W} and level = 1 and dir = 'h' and x = 11 and y = 9;`);
  const B = browserOne((g) => {
    const b = g.buildings.buildingAt(11, 9);
    if (b) {
      b.levels = 2;
      b.workLevel = 0;
    }
    planHiddenDoor(g, PLAN_WALL, HT);
    if (b) b.workLevel = 1;
  });
  check('asked for on the ground floor and planned after the work was raised a storey, the wall planned on that side up there is the door, on both sides',
    I.walls === B.walls && I.state === B.state && I.told === B.told && I.walls === '1 hidden_door' && I.state === DOOR.state,
    `island: ${I.walls}; ${I.state}. browser: ${B.walls}; ${B.state}${I.told === B.told ? '' : `; told "${I.told}" and "${B.told}"`}`);
}

// A plan refused keeps nothing: the plan and the ask are one call, refused together.
{
  const cap = Number(psql(`select queue_capacity(${W}, '${WHO.gil}')`));
  const other = NT('solid', MAT, 11, 9, 'w');
  const FULL = `You can only keep ${cap} jobs in your head at once. Mind logic is what widens that.`;
  const SPENT = 'You are too exhausted to do that. Rest a moment.';
  const FAR = 'You are too far away from that.';
  /** The island asked, as Gil in the state `body` puts him in at `at`: its answer, what is kept, and what he has in hand. */
  const islandRefuses = (body: string, at: [number, number] = [11.5, 9.5]): string[] => psql(`${fresh(body, 'gil', at)}
${ironFor(1)}
delete from wall where world_id = ${W} and level = 0 and dir = 'h' and x = 11 and y = 9;
select coalesce(${askPlan(true, HT)}->>'why', 'TAKEN');
${ASKS}`).split('\n');
  /** And a browser, alone, put in that state by `put`: what it said, and what a plain wall planned there afterwards is. */
  const browserRefuses = (put: (g: Game) => void): { said: string; after: string } => {
    const g = planner(iron);
    put(g);
    planHiddenDoor(g, PLAN_WALL, HT);
    const said = g.log[g.log.length - 1]?.text ?? '';
    return { said, after: browserLater(g) };
  };
  const busy = (n: number): string => `act = 'plan_wall', act_target = '${tj(other)}'::jsonb, act_started = now(),
    act_ends = now() + interval '1 hour', act_left = 1, act_goes = 1,
    act_queue = coalesce((select jsonb_agg(jsonb_build_object('action', 'plan_wall', 'target', '${tj(other)}'::jsonb, 'goes', 1))
                            from generate_series(1, ${n})), '[]'::jsonb)`;
  const fill = (g: Game): void => {
    g.action = { def: PLAN_WALL, target: other, state: 'performing', elapsed: 0, duration: 3600 };
    while (g.queueCapacity() - 1 - g.queue.length > 0) g.queue.push({ def: PLAN_WALL, target: other });
  };
  {
    const [ask, left] = islandRefuses(busy(cap - 1));
    const later = islandLater();
    const mine = browserRefuses(fill);
    check(`with ${numberWord(cap)} jobs in the head already, the one call is refused in the plan's words and keeps nothing, and a plain wall planned there after is a solid wall with the iron still in the pack, on both sides`,
      ask === FULL && left === '0' && later === LATER && mine.said === FULL && mine.after === B_LATER,
      `island "${ask}", ${left} kept, then ${later}; browser "${mine.said}", then ${mine.after}`);
  }
  {
    const [ask, left] = islandRefuses(`stats = stats || '{"stamina": 0}'::jsonb, body_at = now()`);
    const later = islandLater();
    const mine = browserRefuses((g) => { g.player.stats.stamina = 0; });
    check('nor with no wind left for the plan, on both sides',
      ask === SPENT && left === '0' && later === LATER && mine.said === SPENT && mine.after === B_LATER,
      `island "${ask}", ${left} kept, then ${later}; browser "${mine.said}", then ${mine.after}`);
  }
  {
    const [ask, left] = islandRefuses('', [7.5, 6.5]);
    const later = islandLater();
    check('nor from too far away: the island answers as for any plan, keeps nothing, and a plain wall planned there after is solid with the iron in the pack',
      ask === FAR && left === '0' && later === LATER, `"${ask}", ${left} kept, then ${later}`);
  }
}

// A job dropped keeps nothing: the ask goes with its job, however the job goes.
{
  /** The island, after `calls` from Gil beside the north side of (11, 9): the asks kept, then a plain wall planned there. */
  const islandDrops = (calls: string, n = 1): [string, string] => {
    const [left] = psql(`${fresh()}
${ironFor(n)}
delete from wall where world_id = ${W} and level = 0 and dir = 'h' and x = 11 and y = 9;
${calls}
${ASKS}`).split('\n');
    return [left, islandLater()];
  };
  // Another plan within reach to have in hand: the north side of (10, 9), its wall taken away for it.
  const OTHER = NT('solid', MAT, 10, 9, 'n');
  psql(`delete from wall where world_id = ${W} and level = 0 and dir = 'h' and x = 10 and y = 9;`);
  {
    const [left, later] = islandDrops(`select ${askPlan(true, solidOf(HT))} \\g /dev/null
select rpc_cancel(${W}) \\g /dev/null`);
    const g = planner(iron);
    planHiddenDoor(g, PLAN_WALL, HT);
    g.cancelAction();
    const after = browserLater(g);
    check('put down once started, the ask goes with it, and a plain wall planned there after is solid with the iron in the pack, on both sides',
      left === '0' && later === LATER && after === B_LATER, `island ${left} kept, then ${later}; browser ${after}`);
  }
  {
    const [left, later] = islandDrops(`select ${askPlan(false, OTHER)} \\g /dev/null
select ${askPlan(true, solidOf(HT))} \\g /dev/null
select rpc_cancel(${W}) \\g /dev/null`);
    const g = planner(iron);
    g.buildings.removeWall(0, 10, 9, 'n');
    g.requestAction(PLAN_WALL, OTHER);
    planHiddenDoor(g, PLAN_WALL, HT);
    const lined = g.queue.length;
    g.clearQueue();
    const after = browserLater(g);
    check('lined up behind another job and the queue cleared, it goes with its job, on both sides',
      left === '0' && later === LATER && lined === 1 && after === B_LATER, `island ${left} kept, then ${later}; browser ${lined} lined up, then ${after}`);
  }
  {
    // Lined up, and refused as it comes up: a wall went up on its border meanwhile.
    const [left, later] = islandDrops(`select ${askPlan(false, OTHER)} \\g /dev/null
select ${askPlan(true, solidOf(HT))} \\g /dev/null
insert into wall (world_id, level, dir, x, y, building, type, material, needed, total)
  values (${W}, 0, 'h', 11, 9, 77, 'solid', '${MAT}', '${zero('solid')}', '${bill('solid')}');
update player set act_ends = now() where world_id = ${W} and uid = '${WHO.gil}';
select settle(${W}, '${WHO.gil}') \\g /dev/null
delete from wall where world_id = ${W} and level = 0 and dir = 'h' and x = 11 and y = 9;`);
    const g = planner(iron);
    g.buildings.removeWall(0, 10, 9, 'n');
    g.requestAction(PLAN_WALL, OTHER);
    planHiddenDoor(g, PLAN_WALL, HT);
    const house = g.buildings.buildingAt(11, 9);
    if (house) g.buildings.setWall(house, 0, 11, 9, 'n', 'solid', MAT);
    finish(g);
    (g as unknown as { nextInQueue(): boolean }).nextInQueue();
    const refused = g.log[g.log.length - 1]?.text ?? '';
    const after = browserLater(g);
    check('lined up and refused as it came up, a wall having gone up on its border meanwhile, it goes with its job, on both sides',
      left === '0' && later === LATER && refused.endsWith('There is already a wall on that side.') && after === B_LATER,
      `island ${left} kept, then ${later}; browser "${refused}", then ${after}`);
  }
  {
    // From across the yard: the walk given up, or no way there. Nothing went to the island, and alone nothing is kept.
    const g = planner(iron);
    g.player.x = 7.5;
    g.player.y = 6.5;
    planHiddenDoor(g, PLAN_WALL, HT);
    const walking = g.action?.state === 'walking';
    g.cancelAction();
    const after = browserLater(g);
    const gN = planner(iron);
    gN.player.x = 7.5;
    gN.player.y = 6.5;
    (gN as unknown as { walkToward(): boolean }).walkToward = () => false;
    planHiddenDoor(gN, PLAN_WALL, HT);
    const afterN = browserLater(gN);
    check('asked for from across the yard and the walk given up, or with no way there, a plain wall planned there after is solid with the iron in the pack',
      walking && after === B_LATER && afterN === B_LATER, `walk given up: ${after}; no way: ${afterN}`);
  }
  {
    // Held, it goes back into the queue, and its ask stays beside it.
    const [held] = psql(`${fresh()}
${ironFor(1)}
delete from wall where world_id = ${W} and level = 0 and dir = 'h' and x = 11 and y = 9;
select ${askPlan(true, solidOf(HT))} \\g /dev/null
select rpc_hold(${W}) \\g /dev/null
${ASKS}`).split('\n');
    check('and held rather than put down, it goes back into the queue and its ask stays beside it', held === '1', `${held} kept`);
    const [left] = psql(`select set_config('request.jwt.claims', json_build_object('sub', '${WHO.gil}')::text, false) \\g /dev/null
delete from caller where uid = '${WHO.gil}';
select rpc_cancel(${W}) \\g /dev/null
${ASKS}`).split('\n');
    check('until the queue is put down', left === '0', `${left} kept`);
  }
  // The north wall of (10, 9) back as the gatehouse had it.
  psql(`delete from wall where world_id = ${W} and level = 0 and dir = 'h' and x in (10, 11) and y = 9;
insert into wall (world_id, level, dir, x, y, building, type, material, needed, total)
  values (${W}, 0, 'h', 10, 9, 77, 'solid', '${MAT}', '${zero('solid')}', '${bill('solid')}');`);
}

// The keeping never raises: a job whose x or y is not a whole number names no border, and is read as none.
{
  const odd = (x: string, y: string): string => `{"action": "plan_wall", "target": {"kind": "tile", "x": ${x}, "y": ${y}, "cx": 11, "cy": 9, "side": "n"}, "goes": 1}`;
  const planted = [odd('"12.5"', '9'), odd('12.5', '9'), odd('11', '"abc"'), odd('99999999999', '9')].join(', ');
  let out: string;
  try {
    out = psql(`${fresh()}
${ironFor(1)}
delete from wall where world_id = ${W} and level = 0 and dir = 'h' and x = 11 and y = 9;
select ${askPlan(true, HT)} \\g /dev/null
update player set act_queue = act_queue || '[${planted}]'::jsonb where world_id = ${W} and uid = '${WHO.gil}';
${ASKS}
select rpc_hold(${W}) \\g /dev/null
${ASKS}
update player set act = 'plan_wall', act_target = '{"kind": "tile", "x": "abc", "y": 9.5, "side": "n"}'::jsonb where world_id = ${W} and uid = '${WHO.gil}';
${ASKS}
update player set act = null, act_target = null, act_queue = '[]' where world_id = ${W} and uid = '${WHO.gil}';
${ASKS}`).split('\n').join(', ');
  } catch (e) {
    out = `raised: ${String((e as { stderr?: string }).stderr ?? e).trim()}`;
  }
  check('with jobs lined up whose x or y is no whole number -- "12.5", 12.5, "abc" or 99999999999 -- set behind an ask by hand, nothing raises: the ask stays while its own plan is in hand or held, through the planner\'s own hold, and goes with the last of them',
    out === '1, 1, 1, 0', out);
}
// An island that goes takes its asks with it, and the keeping is called by nobody but the trigger.
check('an island that goes takes its asks with it',
  psql(`begin;
insert into world (id, name, seed, size, spawn_x, spawn_y, ready, made_by)
  values ('9a7e0000-0000-4000-8000-0000000000ff', 'Gone', 1, 8, 1, 1, true, '${WHO.gil}');
insert into private.hidden_door_plan (world_id, uid, dir, x, y) values ('9a7e0000-0000-4000-8000-0000000000ff', '${WHO.gil}', 'h', 1, 1);
delete from world where id = '9a7e0000-0000-4000-8000-0000000000ff';
select count(*) from private.hidden_door_plan where world_id = '9a7e0000-0000-4000-8000-0000000000ff';
rollback;`).split('\n').pop() === '0'
    && psql(`select confdeltype from pg_constraint where conrelid = 'private.hidden_door_plan'::regclass and confrelid = 'public.world'::regclass`) === 'c');
check('and private.hidden_door_keep may be executed by no API role, nor by everybody, as every private function',
  psql(`select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
 where p.oid = 'private.hidden_door_keep()'::regprocedure and a.privilege_type = 'EXECUTE'
   and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))`) === '0');

/* ---- 8. where a bridge may start, and what a wall at its end does ----------------- */

const LOG_BILL = (type: string): string => JSON.stringify(wallBill('log', type as never).total);
const LOG_ZERO = (type: string): string => JSON.stringify(Object.fromEntries(Object.keys(wallBill('log', type as never).total).map((k) => [k, 0])));
const bridgeBoth = (what: string, kind: BridgeKind, a: [number, number], b: [number, number], want: string | null, tweak: (g: Game) => void = () => {}): void => {
  const g = browserFor('gil', 10.5, 7.5);
  tweak(g);
  const mine = g.bridgeReason(kind, ...a, ...b) ?? 'ALLOWED';
  const theirs = psql(`select coalesce(bridge_reason(${W}, '${WHO.gil}', '${kind}', ${a[0]}, ${a[1]}, ${b[0]}, ${b[1]}), 'ALLOWED')`);
  check(what, mine === theirs && (want === null ? mine === 'ALLOWED' : mine === want), `browser "${mine}", island "${theirs}"`);
};
bridgeBoth('a drawbridge is not set out from inside a building: its winch stands outside, in the same words', 'draw', [10, 9], [10, 7], drawbridgeEndsOut(0));
bridgeBoth('nor brought down inside one', 'draw', [10, 7], [10, 9], drawbridgeEndsOut(1));
bridgeBoth('and no bridge starts on a building\'s ground floor', 'wood', [10, 9], [10, 7], BRIDGE_END_INSIDE);
psql(`insert into wall (world_id, level, dir, x, y, building, type, material, needed, total)
  values (${W}, 0, 'h', 14, 13, 0, 'fence', 'log', '${LOG_ZERO('fence')}', '${LOG_BILL('fence')}');`);
bridgeBoth('nor through a fence across its end, which it names', 'draw', [14, 12], [14, 15], bridgeEndWall('fence'));
psql(`update wall set type = 'fence_gate', needed = '${LOG_ZERO('fence_gate')}', total = '${LOG_BILL('fence_gate')}'
  where world_id = ${W} and level = 0 and dir = 'h' and x = 14 and y = 13;`);
bridgeBoth('but through a gate in it, it may be', 'draw', [14, 12], [14, 15], null);
psql(`delete from wall where world_id = ${W} and level = 0 and dir = 'h' and x = 14 and y = 13;`);
{
  const g = browserFor('gil', 10.5, 7.5);
  const three = g.bridgeReason('draw', 10, 12, 10, 16);
  const theirs = psql(`select coalesce(bridge_reason(${W}, '${WHO.gil}', 'draw', 10, 12, 10, 16), 'ALLOWED')`);
  check(`a drawbridge of more than ${BRIDGES.draw.span} spans is refused, in the same words`, three === theirs && three === `A drawbridge spans ${BRIDGES.draw.span} tiles; that is 3.`,
    `browser "${three}", island "${theirs}"`);
}
const plainT = (x: number, y: number): Target => ({ kind: 'tile', x, y, cx: x, cy: y });
planBoth('a building is not planned over the end of a bridge, in the same words', 'plan_building', plainT(10, 15), BRIDGE_END_HERE, () => {}, [10.5, 14.5]);
planBoth('nor added to over one', 'add_to_building', plainT(10, 12), BRIDGE_END_HERE, () => {}, [10.5, 12.5]);

// The drawbridge gone, and the moat filled under the gate: from the gate tile out through the portcullis.
psql(`
do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  delete from bridge_span where world_id = w and bridge = ${BID};
  delete from bridge where world_id = w and id = ${BID};
  perform land_set_height(w, 10, ${MOAT_Y}, ${BANK});
  perform land_set_height(w, 11, ${MOAT_Y}, ${BANK});
end $$;`);
const filled = (g: Game): void => { g.world.setHeight(10, MOAT_Y, BANK); g.world.setHeight(11, MOAT_Y, BANK); };
// A hidden door across a bridge's end is the solid wall it looks like to the rule, whoever asks: its key holder too.
for (const who of ['kay', 'sim'] as Who[]) {
  const g = browserFor(who, 12.5, 10.5);
  const door = bridgeEndRefusal(g, 'wood', 12, 10, 10, 10, [0, 0]);
  const plain = bridgeEndRefusal(g, 'wood', 12, 11, 10, 11, [0, 0]);
  const theirs = psql(`select bridge_end_refusal(${W}, '${WHO[who]}', 'wood', 12, 10, 10, 10, 0, 0)`);
  check(`a hidden door across a bridge's end is a solid wall to the rule, to ${NAME[who]}${ADMITTED[who] ? ', whose key opens it,' : ''} as to the wall beside it, in the same words on both sides`,
    door === theirs && door === bridgeEndWall('solid') && plain === door, `browser "${door}", island "${theirs}", the wall beside it "${plain}"`);
}
bridgeBoth('a drawbridge from the gate tile out through the portcullis is refused: its winch stands outside', 'draw', [10, 11], [10, 13], drawbridgeEndsOut(0), filled);
bridgeBoth('and a plank bridge from it', 'wood', [10, 11], [10, 13], BRIDGE_END_INSIDE, filled);
{
  // One laid through it all the same, as one set out before this rule may be: a wall on the border is still a wall.
  const g = browserFor('sim', 10.5, 11.5);
  const lay = (kind: BridgeKind, x: number): void => {
    const b = g.addBridge(kind, x, 11, x, 14, BANK, 'Oak', 0);
    for (const s of b.spans) for (const k of Object.keys(s.needed)) s.needed[k] = 0;
  };
  lay('draw', 10);
  lay('wood', 9);
  g.reindexDecks();
  const port = g.buildings.wall(0, 10, 11, 's');
  const way = (): string => {
    const out = g.stepRule(10, 11, 0, 10, 12);
    const back = g.stepRule(10, 12, 0, 10, 11);
    const cart = g.driveRule(10, 11, 0, 10, 12);
    return `out ${out === null ? 'refused' : 'walks'}, in ${back === null ? 'refused' : 'walks'}, a cart ${cart === null ? 'refused' : 'rolls'}`;
  };
  if (port) port.lowered = true;
  const down = way();
  if (port) port.lowered = false;
  const up = way();
  check('with a drawbridge down through it, a lowered portcullis still stops a body either way and a cart, in a browser',
    down === 'out refused, in refused, a cart refused', down);
  check('and raised, it lets them all through', up === 'out walks, in walks, a cart rolls', up);
  const plank = g.stepRule(9, 11, 0, 9, 12);
  check('and a plank bridge through a solid wall is no way through it', plank === null, plank === null ? 'refused' : 'walks');
}

// What the pointer says of each, to whom.
{
  const kay = browserFor('kay', 12.5, 10.5);
  const sim = browserFor('sim', 12.5, 10.5);
  const gil = browserFor('gil', 10.5, 12.5);
  const fromOutside = gateHoverLine(kay, 12, 10, 'w', 'west', false);
  check('a key holder\'s pointer names a hidden door from outside it, as from in',
    fromOutside === `west wall: hidden door ${MAT_NAME.toLowerCase()} · your key opens it`
      && gateHoverLine(kay, 11, 10, 'e', 'east', true) === `east wall on the ground floor: hidden door ${MAT_NAME.toLowerCase()} · your key opens it`,
    fromOutside ?? 'nothing');
  check('and a stranger\'s names nothing there', gateHoverLine(sim, 12, 10, 'w', 'west', false) === null);
  const port = gateHoverLine(gil, 10, 12, 'n', 'north', false);
  check('a portcullis is named with where it stands, from outside it', port === `north wall: portcullis ${MAT_NAME.toLowerCase()} · up: all pass`, port ?? 'nothing');
}

/* ---- 9. beside what the other batches build ---------------------------------------
 *
 * A second box east of the first, the same ground: flat at sixty, the moat along
 * y 14, all of it Kay's settlement, Kayhold. Stilthouse is a deck on piers at
 * (20, 13), over the moat's bank. An aqueduct, unfinished, runs from (26, 8) to
 * (26, 10), and a wooden bridge from (28, 12) to (28, 15). Overhang is two
 * storeys on (22, 12) and (23, 12), with a jetty of storey 2 out over (23, 11);
 * and a drawbridge's winch stands at (22, 11), north of it.
 */
const BOX2 = { x0: 18, y0: 6, x1: 30, y1: 17 };
const before2 = psql(`
select string_agg(gx || ',' || gy || ',' || coalesce(land_height(${W}, gx, gy), 0), ';')
  from generate_series(${BOX2.x0}, ${BOX2.x1}) gx cross join generate_series(${BOX2.y0}, ${BOX2.y1}) gy;
select string_agg(gx || ',' || gy || ',' || coalesce(land_tile(${W}, gx, gy), 0), ';')
  from generate_series(${BOX2.x0}, ${BOX2.x1 - 1}) gx cross join generate_series(${BOX2.y0}, ${BOX2.y1 - 1}) gy;
select piers from world where id = ${W};`).split('\n');
const ZERO = (bill: string): string => `(select jsonb_object_agg(k, 0) from jsonb_object_keys(${bill}) k)`;
const FLOOR = `floor_bill('${MAT}', 'floor', null)`;
const OVER = [[22, 12], [23, 12]] as const;
const OVER_WALLS: Array<[string, number, number]> = [['h', 22, 12], ['h', 23, 12], ['h', 22, 13], ['h', 23, 13], ['v', 22, 12], ['v', 24, 12]];
psql(`
do $$
declare w uuid; gx int; gy int; v_b bigint;
begin
  select id into w from world where name = 'Hoarding';
  for gx in ${BOX2.x0}..${BOX2.x1} loop for gy in ${BOX2.y0}..${BOX2.y1} loop
    perform land_set_height(w, gx, gy, case when gy = ${MOAT_Y} then ${MOAT} else ${BANK} end);
  end loop; end loop;
  for gx in ${BOX2.x0}..${BOX2.x1 - 1} loop for gy in ${BOX2.y0}..${BOX2.y1 - 1} loop
    perform land_set_tile(w, gx, gy, tile_id('Grass'));
  end loop; end loop;
  insert into deed (world_id, name, x, y, radius, founded_by) values (w, 'Kayhold', 24, 11, 6, '${WHO.kay}');
  insert into building (world_id, id, name, levels, work_level, planned_by, deck) values (w, 78, 'Stilthouse', 1, 0, '${WHO.kay}', ${BANK});
  insert into building_tile (world_id, building, x, y, pier) values (w, 78, 20, 13, true);
  insert into floor_tile (world_id, level, x, y, building, material, kind, needed, total, planned_by)
    values (w, 0, 20, 13, 78, '${MAT}', 'floor', ${ZERO(FLOOR)}, ${FLOOR}, '${WHO.kay}');
  update world set piers = true where id = w;
  insert into bridge (world_id, kind, ax, ay, bx, by, height, made_by) values (w, 'aqueduct', 26, 8, 26, 10, ${BANK}, '${WHO.kay}') returning id into v_b;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total) values (w, v_b, 1, 26, 9, span_bill('aqueduct'), span_bill('aqueduct'));
  insert into bridge (world_id, kind, ax, ay, bx, by, height, made_by) values (w, 'wood', 28, 12, 28, 15, ${BANK}, '${WHO.kay}') returning id into v_b;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select w, v_b, t.n, t.x, t.y, ${ZERO("span_bill('wood')")}, span_bill('wood') from span_tiles(28, 12, 28, 15) t;
  insert into bridge (world_id, kind, ax, ay, bx, by, height, made_by) values (w, 'draw', 22, 11, 22, 8, ${BANK}, '${WHO.kay}') returning id into v_b;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select w, v_b, t.n, t.x, t.y, ${ZERO("span_bill('draw', t.n)")}, span_bill('draw', t.n) from span_tiles(22, 11, 22, 8) t;
  insert into building (world_id, id, name, levels, work_level, planned_by) values (w, 79, 'Overhang', 2, 1, '${WHO.kay}');
  ${OVER.map(([x, y]) => `insert into building_tile (world_id, building, x, y) values (w, 79, ${x}, ${y});
  insert into floor_tile (world_id, level, x, y, building, material, kind, needed, total, planned_by)
    values (w, 1, ${x}, ${y}, 79, '${MAT}', 'floor', ${ZERO(FLOOR)}, ${FLOOR}, '${WHO.kay}');`).join('\n  ')}
  ${OVER_WALLS.map(([d, x, y]) => `insert into wall (world_id, level, dir, x, y, building, type, material, needed, total)
    values (w, 0, '${d}', ${x}, ${y}, 79, 'solid', '${MAT}', '${zero('solid')}', '${bill('solid')}');`).join('\n  ')}
  insert into floor_tile (world_id, level, x, y, building, material, kind, needed, total, planned_by)
    values (w, 1, 23, 11, 79, '${MAT}', 'floor', ${ZERO(FLOOR)}, ${FLOOR}, '${WHO.kay}');
  delete from item where world_id = w and holder_uid = '${WHO.kay}' and def in ('mallet', 'padlock', 'hinge', 'key');
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', '${WHO.kay}', 'mallet', 40, 1);
end $$;`);
/** The second box, shaped the same in a browser. */
const shape2 = (g: Game): void => {
  const w = g.world;
  for (let x = BOX2.x0; x <= BOX2.x1; x++) for (let y = BOX2.y0; y <= BOX2.y1; y++) w.setHeight(x, y, cornerH(y));
  for (let x = BOX2.x0; x < BOX2.x1; x++) for (let y = BOX2.y0; y < BOX2.y1; y++) w.setTile(x, y, TileType.Grass);
};
/** Kay's browser in the second box, standing at (x, y), with her mallet. */
const kayAt = (x: number, y: number): Game => {
  const g = Game.create(4242);
  shape(g);
  shape2(g);
  g.settings.fog = true;
  (g as unknown as { darkness: () => number }).darkness = () => 0;
  g.sawGround(groundFor('kay', x, y));
  g.player.x = x;
  g.player.y = y;
  g.player.level = 0;
  g.inventory.add('mallet', { ql: 40 });
  return g;
};
const ALLOWED = 'ALLOWED';
const islandBridge = (kind: BridgeKind, ax: number, ay: number, bx: number, by: number): string =>
  psql(`select coalesce(bridge_reason(${W}, '${WHO.kay}', '${kind}', ${ax}, ${ay}, ${bx}, ${by}), '${ALLOWED}')`);
const sameBridge = (what: string, kind: BridgeKind, ax: number, ay: number, bx: number, by: number, want: string): void => {
  const mine = kayAt(24.5, 11.5).bridgeReason(kind, ax, ay, bx, by) ?? ALLOWED;
  const theirs = islandBridge(kind, ax, ay, bx, by);
  check(what, mine === theirs && theirs === want, `browser "${mine}", island "${theirs}"`);
};

// A deck on piers: a bridge lands on it as on a bank; a drawbridge, which stands outside at both ends, does not.
sameBridge('a wooden bridge lands on a finished deck on piers as on a bank, which the rule against a ground floor\'s inside does not refuse, on both sides',
  'wood', 20, 13, 20, 15, ALLOWED);
sameBridge('and from the bank to the deck too', 'wood', 20, 15, 20, 13, ALLOWED);
sameBridge('but a drawbridge\'s winch is not set on a deck, in the same words on both sides', 'draw', 20, 13, 20, 15, drawbridgeEndsOut(0));
sameBridge('nor does a drawbridge come down on one', 'draw', 20, 15, 20, 13, drawbridgeEndsOut(1));
{
  // And a wall on the deck's edge across a bridge's end stops it, as any storey's wall does.
  psql(`insert into wall (world_id, level, dir, x, y, building, type, material, needed, total)
    values (${W}, 0, 'h', 20, 14, 78, 'solid', '${MAT}', '${zero('solid')}', '${bill('solid')}');`);
  sameBridge('and a deck\'s wall across the end stops a bridge as a storey\'s does, a hidden door counted as the solid wall it looks like',
    'wood', 20, 13, 20, 15, bridgeEndWall('solid'));
  psql(`update wall set type = 'hidden_door', lock = ${LOCK_H} where world_id = ${W} and level = 0 and dir = 'h' and x = 20 and y = 14;`);
  sameBridge('the same for a hidden door there', 'wood', 20, 13, 20, 15, bridgeEndWall('solid'));
  psql(`delete from wall where world_id = ${W} and level = 0 and dir = 'h' and x = 20 and y = 14;`);
}

// Another bridge's end, or a span over one: refused on both sides, as the island's `bridge_at` has always counted it.
sameBridge('no bridge ends on another\'s end: a drawbridge set out from the far end of a wooden bridge is refused in the same words on both sides',
  'draw', 28, 15, 28, 17, 'One end is already under a bridge.');
sameBridge('nor on an aqueduct\'s', 'wood', 26, 10, 29, 10, 'One end is already under a bridge.');
sameBridge('nor crosses one: a drawbridge over the end of the wooden bridge', 'draw', 27, 12, 29, 12, 'Something is already bridged across there.');
sameBridge('nor over an aqueduct\'s span', 'draw', 25, 9, 27, 9, 'Something is already bridged across there.');

// A bridge's end: nothing is built on it. An aqueduct's ends are the water it draws from and the basin it pours into: its own.
{
  const g = kayAt(24.5, 11.5);
  const planHere = (x: number, y: number): [string, string] =>
    [g.planReason(x, y) ?? ALLOWED, psql(`select coalesce(plan_reason(${W}, '${WHO.kay}', ${x}, ${y}), '${ALLOWED}')`)];
  const [woodMine, woodTheirs] = planHere(28, 12);
  check('nothing is planned on the end of a bridge thrown across, in the same words on both sides',
    woodMine === woodTheirs && woodMine === BRIDGE_END_HERE, `browser "${woodMine}", island "${woodTheirs}"`);
  const [aqMine, aqTheirs] = planHere(26, 10);
  const [grassMine] = planHere(25, 10);
  check('while an aqueduct\'s end answers as the ground there does, the rule for a bridge\'s end left out, on both sides',
    aqMine === aqTheirs && aqMine === grassMine && aqMine !== BRIDGE_END_HERE, `browser "${aqMine}", island "${aqTheirs}"; the grass beside it: "${grassMine}"`);
}

// Pulling an aqueduct down: from as near either end as a bridge, and on a settlement only by its builders.
{
  const aq = Number(psql(`select id from bridge where world_id = ${W} and kind = 'aqueduct' and ax = 26 and ay = 8`));
  const AT: Target = { kind: 'bridge', id: aq };
  const pullAq = ACTION_BY_ID.get('demolish_aqueduct') as ActionDef;
  const says = (who: Who, x: number, y: number): [string, string] => {
    const g = kayAt(x, y);
    if (who !== 'kay') {
      // Sim, who is nobody on Kayhold, in the same place.
      const s = browserFor('sim', x, y);
      shape2(s);
      return [pullAq.check?.(AT, s) ?? ALLOWED, islandSays('sim', 'demolish_aqueduct', AT, x, y)];
    }
    return [pullAq.check?.(AT, g) ?? ALLOWED, islandSays('kay', 'demolish_aqueduct', AT, x, y)];
  };
  // West of its foot (26, 10), on the dry grass of rows 10, clear of the moat's banks.
  const [farMine, farTheirs] = says('kay', 26.5 - PULL_REACH - 0.2, 10.5);
  const [nearMine, nearTheirs] = says('kay', 26.5 - 3, 10.5);
  const [simMine, simTheirs] = says('sim', 26.5, 11.5);
  const label = pullAq.label.toLowerCase();
  check(`an aqueduct is pulled down from within ${PULL_REACH} tiles of the middle of either end, as a bridge is, on both sides`,
    farMine === farTheirs && farMine === 'Stand at one end of it.' && nearMine === nearTheirs && nearMine === ALLOWED,
    `out of reach: browser "${farMine}", island "${farTheirs}"; within it: browser "${nearMine}", island "${nearTheirs}"`);
  check('and on a settlement only by its builders, in the same words on both sides',
    simMine === simTheirs && simMine === `That is part of Kayhold. Only its builders may ${label} there.`,
    `browser "${simMine}", island "${simTheirs}"`);
  check('and Pull it down, which is a bridge\'s job, is not offered for one in a browser',
    !(ACTION_BY_ID.get('demolish_bridge') as ActionDef).applies(AT, kayAt(26.5, 11.5)));
}

// A drawbridge's winch and a jetty: neither over the other, since its gallows rise over the winch higher than a storey.
// A jetty planned out over (21, 12), west of Overhang, not yet built: its tile is still ground to a bridge.
psql(`insert into floor_tile (world_id, level, x, y, building, material, kind, needed, total, planned_by)
  values (${W}, 1, 21, 12, 79, '${MAT}', 'floor', ${FLOOR}, ${FLOOR}, '${WHO.kay}');`);
sameBridge('a drawbridge\'s winch is not set on the ground under a jetty, even one only planned, in the same words on both sides',
  'draw', 21, 12, 19, 12, DRAWBRIDGE_UNDER_JETTY);
sameBridge('while its far end there is refused for what is under it, the flat ground, not for the jetty', 'draw', 19, 12, 21, 12,
  'That is not a gap, it is ground. Walk it.');
// A finished jetty is a floor of the storey it is out from, which a bridge's end lands on, as the island has always had it (`top_deck`).
sameBridge('a bridge\'s end at a finished jetty is on the jetty\'s storey, as on any finished floor, on both sides', 'wood', 23, 11, 23, 9,
  'One end is on storey 2 and the other on the ground. A deck meets one storey or the other.');
sameBridge('so a drawbridge, which goes from ground to ground, ends on none', 'draw', 23, 9, 23, 11, `A ${BRIDGES.draw.name.toLowerCase()} goes from ground to ground, not to a storey.`);
sameBridge('nor is set out from one, which is a storey and not the ground under a jetty', 'draw', 23, 11, 23, 9,
  `A ${BRIDGES.draw.name.toLowerCase()} goes from ground to ground, not to a storey.`);
{
  const t: Target = { kind: 'tile', x: 22, y: 11, cx: 22, cy: 11, buildingId: 79, level: 1, floorKind: 'floor', material: MAT } as unknown as Target;
  const g = kayAt(21.5, 11.5);
  const mine = ACTION_BY_ID.get('plan_floor')?.check?.(t, g) ?? ALLOWED;
  const theirs = islandSays('kay', 'plan_floor', t, 21.5, 11.5);
  check('nor is a jetty floored over a drawbridge\'s winch, in the same words on both sides',
    mine === theirs && mine === JETTY_OVER_WINCH, `browser "${mine}", island "${theirs}"`);
}

// A portcullis and a hidden door in a jetty's wall.
{
  const t = (wallType: string): Target => ({ kind: 'tile', x: 23, y: 11, cx: 23, cy: 11, side: 'n', buildingId: 79, level: 1, wallType, material: MAT } as unknown as Target);
  const g = kayAt(23.5, 10.5);
  const mine = PLAN_WALL.check?.(t('portcullis'), g) ?? ALLOWED;
  const theirs = islandSays('kay', 'plan_wall', t('portcullis'), 23.5, 10.5);
  check('a portcullis is not planned in a jetty\'s wall, and the refusal does not send you to work on storey 1, which brings no jetty down, on both sides',
    mine === theirs && mine === gatePlanRefusal('portcullis', MATERIALS.find((m) => m.id === MAT), 1, true) && !mine.includes('Work on'),
    `browser "${mine}", island "${theirs}"`);
  const solid = PLAN_WALL.check?.(t('solid'), g) ?? ALLOWED;
  check('while a solid wall there may be planned', solid === ALLOWED && islandSays('kay', 'plan_wall', t('solid'), 23.5, 10.5) === ALLOWED, solid);
  // A hidden door there: asked for with the jetty's own target, and planned on its storey.
  const ht = { kind: 'tile', x: 23, y: 11, cx: 23, cy: 11, side: 'n', buildingId: 79, level: 1, material: MAT } as unknown as TileTarget;
  // The browser first, from the ground as it is before the island plans anything there.
  const gh = kayAt(23.5, 10.5);
  iron(gh);
  planHiddenDoor(gh, PLAN_WALL, ht);
  const toldB = finish(gh);
  const w = gh.buildings.wall(1, 23, 11, 'n');
  const [wall, told] = psql(`update player set x = 23.5, y = 10.5, level = 0, act = null, act_target = null, act_queue = '[]',
       stats = stats || '{"stamina": 1}'::jsonb where world_id = ${W} and uid = '${WHO.kay}';
delete from item where world_id = ${W} and holder_uid = '${WHO.kay}' and def in ('padlock', 'hinge');
insert into item (world_id, holder, holder_uid, def, ql, count) values
  (${W}, 'player', '${WHO.kay}', 'padlock', 55, 1), (${W}, 'player', '${WHO.kay}', 'hinge', 40, ${HIDDEN_DOOR_HINGES});
delete from skill where world_id = ${W} and uid = '${WHO.kay}';
insert into skill (world_id, uid, id, value) select ${W}, '${WHO.kay}', d.id, d.start + 0.5 from skill_def d where d.quiet;
delete from event where world_id = ${W} and uid = '${WHO.kay}';
delete from caller where uid = '${WHO.kay}';
select set_config('request.jwt.claims', json_build_object('sub', '${WHO.kay}')::text, false) \\g /dev/null
select rpc_plan_hidden_wall(${W}, '${tj(ht)}'::jsonb) \\g /dev/null
update player set act_ends = now() where world_id = ${W} and uid = '${WHO.kay}';
select settle(${W}, '${WHO.kay}') \\g /dev/null
select coalesce((select string_agg(level || ' ' || type || ' ' || (lock is not null), '; ') from wall
  where world_id = ${W} and dir = 'h' and x = 23 and y = 11), 'no wall');
select coalesce(string_agg(text, '~' order by n), '') from event where world_id = ${W} and uid = '${WHO.kay}' and kind = 'event';`).split('\n');
  check('and a hidden door asked for in a jetty\'s wall is planned on the jetty\'s storey and is a door there, saying the same, on both sides',
    wall === '1 hidden_door true' && w?.type === 'hidden_door' && w.lock !== undefined && toldB === told && told.includes(hiddenDoorSaid({ own: true, deed: 'Kayhold' })),
    `island: ${wall}, "${told}"; browser: ${w?.level} ${w?.type}, "${toldB}"`);
  psql(`delete from wall where world_id = ${W} and dir = 'h' and x = 23 and y = 11;`);
}
{
  // And from the jetty's own menu, as a player asks for one: Plan wall or railing, Hidden door, a material.
  const g = kayAt(23.5, 10.5);
  iron(g);
  const rows = frameJettyEntries(g, { x: 23, y: 11, cx: 23, cy: 11, wx: 23.5, wy: 11.1 } as Pick);
  const flat = (items: MenuItem[]): MenuItem[] => items.flatMap((i) => [i, ...flat(i.children ?? [])]);
  const plan = flat(rows).find((i) => i.label === 'Plan wall or railing (north)');
  const stone = plan?.children?.find((i) => i.label === 'Hidden door')?.children?.find((i) => i.label === MAT_NAME);
  const port = plan?.children?.find((i) => i.label === 'Portcullis')?.children?.find((i) => i.label === MAT_NAME);
  stone?.onSelect?.();
  const a = g.action;
  check('and the jetty\'s own menu offers a hidden door in its wall, asked for with a solid wall\'s plan, and a portcullis there refused in the words above',
    !!stone && !stone.disabled && !!a && a.def.id === 'plan_wall' && hiddenAsk(a.target) && (a.target as { wallType?: string }).wallType === 'solid'
      && !!port && port.disabled === true && port.hint === gatePlanRefusal('portcullis', MATERIALS.find((m) => m.id === MAT), 1, true),
    `hidden door in ${MAT_NAME}: ${stone ? (stone.disabled ? `refused, "${stone.hint}"` : 'offered') : 'not listed'}; in hand ${a?.def.id ?? 'nothing'}, `
      + `asked as a door ${a ? hiddenAsk(a.target) : '-'}; portcullis: ${port ? `"${port.hint}"` : 'not listed'}`);
}

// A body down in a cellar raises nothing up top: the cellar's own rule, which answers for every gate job.
{
  const g = browserFor('gil', 10.5, 12.5);
  g.player.level = -1;
  const says = (action: string, t: Target): [string, string] => {
    const def = ACTION_BY_ID.get(action) as ActionDef;
    const theirs = psql(`update player set x = 10.5, y = 12.5, level = -1 where world_id = ${W} and uid = '${WHO.gil}';
select coalesce(act_refusal(${W}, '${WHO.gil}', '${action}', '${tj(t)}'::jsonb), '${ALLOWED}');
update player set level = 0 where world_id = ${W} and uid = '${WHO.gil}';`).split('\n')[0];
    return [cellarGate(g, action, t) ?? def.check?.(t, g) ?? ALLOWED, theirs];
  };
  const pairs = [says('raise_portcullis', PT), says('lower_drawbridge', BT), says('fit_lock', PT), says('plan_wall', ST)];
  check('from down in a cellar nobody works a portcullis, a drawbridge, a padlock or a wall\'s plan up top, in the same words on both sides',
    pairs.every(([m, t]) => m === t && m === 'You are down in the cellar. Go up to do that.'), pairs.map(([m, t]) => `"${m}" / "${t}"`).join('; '));
}

// A column on a corner of a portcullis, and a railing beside one on a deck.
{
  const COL = { kind: 'tile', x: 10, y: 11, cx: 10, cy: 12, material: 'log' } as unknown as Target;
  const g = browserFor('gil', 10.5, 12.5);
  g.inventory.add('mallet', { ql: 40 });
  psql(`insert into item (world_id, holder, holder_uid, def, ql, count) values (${W}, 'player', '${WHO.gil}', 'mallet', 40, 1);`);
  const mine = ACTION_BY_ID.get('plan_column')?.check?.(COL, g) ?? ALLOWED;
  const theirs = islandSays('gil', 'plan_column', COL);
  check('a column goes on the corner of a portcullis as on any wall\'s, on both sides', mine === theirs && mine === ALLOWED, `browser "${mine}", island "${theirs}"`);
  const DT = (side: Side, wallType: string): Target => ({ kind: 'tile', x: 20, y: 13, cx: 20, cy: 13, side, wallType, material: MAT } as unknown as Target);
  // Standing on the deck itself.
  const k = kayAt(20.5, 13.5);
  const pairs = (['e', 'w'] as Side[]).map((side, i) => {
    const t = DT(side, i === 0 ? 'portcullis' : 'railing');
    return [PLAN_WALL.check?.(t, k) ?? ALLOWED, islandSays('kay', 'plan_wall', t, 20.5, 13.5)];
  });
  check('and on a deck on piers in stone a portcullis may be planned on one side and a railing beside it, on both sides',
    pairs.every(([m, t]) => m === t && m === ALLOWED), pairs.map(([m, t]) => `"${m}" / "${t}"`).join('; '));
}

// A glasshouse walled round with a portcullis and a hidden door in its walls: both are walls to the glass, as a door is.
{
  const GLASS_ROOF_BILL = `floor_bill(glass_material(), 'roof', null)`;
  psql(`
do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  insert into building (world_id, id, name, levels, work_level, planned_by) values (w, 80, 'Glasspane', 1, 0, '${WHO.kay}');
  insert into building_tile (world_id, building, x, y) values (w, 80, 26, 12);
  insert into wall (world_id, level, dir, x, y, building, type, material, needed, total, lock) values
    (w, 0, 'h', 26, 12, 80, 'solid', '${MAT}', '${zero('solid')}', '${bill('solid')}', null),
    (w, 0, 'h', 26, 13, 80, 'portcullis', '${MAT}', '${zero('portcullis')}', '${bill('portcullis')}', null),
    (w, 0, 'v', 26, 12, 80, 'hidden_door', '${MAT}', '${zero('hidden_door')}', '${bill('hidden_door')}', ${LOCK_H}),
    (w, 0, 'v', 27, 12, 80, 'solid', '${MAT}', '${zero('solid')}', '${bill('solid')}', null);
  insert into floor_tile (world_id, level, x, y, building, material, kind, needed, total, planned_by)
    values (w, 1, 26, 12, 80, glass_material(), 'roof', ${ZERO(GLASS_ROOF_BILL)}, ${GLASS_ROOF_BILL}, '${WHO.kay}');
end $$;`);
  const island = psql(`select glasshouse(${W}, 80)`);
  const k = kayAt(26.5, 11.5);
  const sim = browserFor('sim', 26.5, 11.5);
  const mine = isGlasshouse(k.buildings, k.buildings.buildingAt(26, 12));
  const theirs = isGlasshouse(sim.buildings, sim.buildings.buildingAt(26, 12));
  check('a glasshouse is walled round by a portcullis and a hidden door as by solid walls, on the island and in the browser of its founder and of a stranger, who sees a solid wall',
    island === 't' && mine && theirs && sim.buildings.wall(0, 26, 12, 'w')?.type === 'solid' && k.buildings.wall(0, 26, 12, 'w')?.type === 'hidden_door',
    `island ${island}, Kay's browser ${mine}, Sim's ${theirs}`);
}

// Kayhold and all of it gone again, and the second box's ground as it was.
{
  const [hs2, ts2, piers2] = before2;
  psql(`
do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  delete from wall where world_id = w and building in (78, 79, 80);
  delete from floor_tile where world_id = w and building in (78, 79, 80);
  delete from building_tile where world_id = w and building in (78, 79, 80);
  delete from building where world_id = w and id in (78, 79, 80);
  delete from bridge_span where world_id = w and bridge in (select id from bridge where world_id = w
    and ax between ${BOX2.x0} and ${BOX2.x1} and ay between ${BOX2.y0} and ${BOX2.y1});
  delete from bridge where world_id = w and ax between ${BOX2.x0} and ${BOX2.x1} and ay between ${BOX2.y0} and ${BOX2.y1};
  update world set piers = ${piers2 === 't'} where id = w;
  ${hs2.split(';').map((c) => { const [x, y, h] = c.split(','); return `perform land_set_height(w, ${x}, ${y}, ${h});`; }).join('\n  ')}
  ${ts2.split(';').map((c) => { const [x, y, t] = c.split(','); return `perform land_set_tile(w, ${x}, ${y}, ${t});`; }).join('\n  ')}
end $$;`);
}

/* ---- and Hoarding's ground as it was ------------------------------------------- */
const [hs, ts] = before;
psql(`
do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  delete from building where world_id = w and id = 77;
  delete from wall where world_id = w and x between ${BOX.x0} and ${BOX.x1} and y between ${BOX.y0} and ${BOX.y1};
  delete from bridge_span where world_id = w and bridge in (select id from bridge where world_id = w
    and ax between ${BOX.x0} and ${BOX.x1} and ay between ${BOX.y0} and ${BOX.y1});
  delete from bridge where world_id = w and ax between ${BOX.x0} and ${BOX.x1} and ay between ${BOX.y0} and ${BOX.y1};
  delete from deed where world_id = w and founded_by in (${EVERYBODY});
  delete from private.hidden_door_plan where world_id = w;
  delete from item where world_id = w and holder = 'player' and holder_uid in (${EVERYBODY});
  delete from player where world_id = w and uid in (${EVERYBODY});
  ${hs.split(';').map((c) => { const [x, y, h] = c.split(','); return `perform land_set_height(w, ${x}, ${y}, ${h});`; }).join('\n  ')}
  ${ts.split(';').map((c) => { const [x, y, t] = c.split(','); return `perform land_set_tile(w, ${x}, ${y}, ${t});`; }).join('\n  ')}
end $$;`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a portcullis, a drawbridge and a hidden door, the same on both sides — ${ok.length} of ${ok.length}`);
