/**
 * A single staircase, on both sides: the second model of every flight, half
 * the tile wide, up the half on your left or your right as you climb.
 *
 * Asked of both:
 *   * what one costs in every material a flight is built in -- half a wall's
 *     bill, where the wide one's is three quarters -- the same on both sides;
 *   * planning one, a wide one, and one whose hand is no hand: the refusal,
 *     what is planned, the hand it keeps and what is said;
 *   * the hand sent back with the floor in the ground read, and a hand on
 *     anything but a staircase refused by the table;
 *   * walking onto one from below, which takes you up a storey as the wide
 *     one does;
 *   * and taking one out, in its own name;
 *   * and wheels: a wagon driven up a wide staircase from its foot, through a
 *     doorway wide enough, and off its head onto the storey's floor or back
 *     down off its foot -- never over its rails, up a single staircase or off
 *     the edge of what is floored -- standing on the storey it was driven to
 *     on the island, its team kept in the traces up there, and its reins not
 *     taken from another storey, in the same words on both sides.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import type { Target } from '../../src/game/actions';
import { BUILD_ACTION_BY_ID } from '../../src/game/buildActions';
import { floorBill, MATERIALS, SINGLE_STAIRS_NAME, SINGLE_STAIRS_SHARE, STAIRS_SHARE, takesAs } from '../../src/game/building';
import { ACTION_BY_ID } from '../../src/game/actions';
import { furnitureCentre, tracesStoreyRefusal } from '../../src/game/furniture';
import { TOP_LEVELS } from '../../src/game/building';
import { pathOptions } from '../../src/game/player';
import { findPath } from '../../src/world/pathfinding';
import { TileType } from '../../src/world/tiles';

const psql = (sql: string): string =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      PGHOST: process.env.PGHOST ?? '/var/run/postgresql',
      PGPORT: process.env.PGPORT ?? '5433',
      PGUSER: process.env.PGUSER ?? 'wurm',
      PGDATABASE: process.env.PGDATABASE ?? 'postgres',
    },
  }).trim();

let bad = 0;
let good = 0;
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) good++;
  else bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};
const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const answers = (out: string): Map<string, string> =>
  new Map(out.split('\n~~\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

/* ---- what one costs ------------------------------------------------------------------------------ */

const STAIRED = MATERIALS.filter((m) => takesAs(m, { floor: 'stairs' }));
const bills = JSON.parse(psql(`select jsonb_object_agg(m.id, jsonb_build_object(
    'single', floor_bill(m.id, 'stairs', null, 'l'), 'right', floor_bill(m.id, 'stairs', null, 'r'),
    'wide', floor_bill(m.id, 'stairs', null, null)))
  from build_material_def m where m.id in (${STAIRED.map((m) => q(m.id)).join(', ')})`)) as
  Record<string, { single: Record<string, number>; right: Record<string, number>; wide: Record<string, number> }>;
const same = (a: Record<string, number>, b: Record<string, number> | undefined): boolean =>
  !!b && Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, n]) => b[k] === n);
const differ: string[] = [];
let smaller = 0;
for (const m of STAIRED) {
  const single = floorBill(m.id, 'stairs', undefined, 'l').needed;
  const wide = floorBill(m.id, 'stairs').needed;
  const theirs = bills[m.id];
  if (!same(single, theirs?.single) || !same(single, theirs?.right) || !same(wide, theirs?.wide)) {
    differ.push(`${m.id}: ${JSON.stringify(single)} here, ${JSON.stringify(theirs?.single)} there`);
  }
  const total = (b: Record<string, number>): number => Object.values(b).reduce((a, n) => a + n, 0);
  if (total(single) < total(wide)) smaller++;
}
check(`a single staircase costs ${SINGLE_STAIRS_SHARE * 100}% of a solid wall's bill on both sides, in every material a flight is built in`,
  differ.length === 0 && STAIRED.length > 0, differ.length ? differ.slice(0, 3).join('; ') : `${STAIRED.length} materials`);
check(`and less than the wide one's ${STAIRS_SHARE * 100}% in every one of them`, smaller === STAIRED.length, `${smaller} of ${STAIRED.length}`);

/* ---- the scene ------------------------------------------------------------------------------------ */

/*
 * On the Hoarding island, in its north-east: ground flat at 30 from corner
 * (42, 8) to (50, 16), packed dirt, and a house of three tiles in a row at
 * y 12, x 44 to 46, two storeys high and worked on its second. Dane stands in
 * it with a mallet.
 */
const H = 30;
const HOUSE = { id: 9301, name: 'Stair house', tiles: [[44, 12], [45, 12], [46, 12]] as Array<[number, number]> };
const MAT = 'plank';

const ISLAND_SCENE = `
  select id into w from world where name = 'Hoarding';
  select uid into me from player where world_id = w and name = 'Dane';
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  delete from building b where b.world_id = w and (b.id = ${HOUSE.id} or exists (select 1 from building_tile bt
    where bt.world_id = w and bt.building = b.id and bt.x between 42 and 50 and bt.y between 8 and 16));
  delete from deed where world_id = w and x between 22 and 70 and y between 0 and 36;
  delete from placed where world_id = w and x between 42 and 50 and y between 8 and 16;
  for gx in 42..50 loop for gy in 8..16 loop
    perform land_set_height(w, gx, gy, ${H});
    if gx < 50 and gy < 16 then perform land_set_tile(w, gx, gy, tile_id('Packed dirt')); end if;
  end loop; end loop;
  insert into building (world_id, id, name, levels, work_level, planned_by) values (w, ${HOUSE.id}, ${q(HOUSE.name)}, 2, 1, me);
  insert into building_tile (world_id, building, x, y) values ${HOUSE.tiles.map(([x, y]) => `(w, ${HOUSE.id}, ${x}, ${y})`).join(', ')};
  update player set x = 45.5, y = 12.5, level = 0, level_h = null, act = null, act_queue = '[]'::jsonb, aboard = null,
         stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'::jsonb)
   where world_id = w and uid = me;
  delete from item where world_id = w and holder = 'player' and holder_uid = me;
  perform give(w, me, 'mallet', 1, 50);
`;

function browserScene(): Game {
  const g = Game.create(9301, 64);
  const w = g.world;
  for (let y = 8; y <= 16; y++) for (let x = 42; x <= 50; x++) w.setHeight(x, y, H);
  for (let y = 8; y < 16; y++) for (let x = 42; x < 50; x++) w.setTile(x, y, TileType.PackedDirt, 0);
  for (const it of [...g.inventory.items]) g.inventory.remove(it.uid, it.count);
  g.inventory.add('mallet', { ql: 50 });
  const b = g.buildings.create(HOUSE.name, HOUSE.tiles[0][0], HOUSE.tiles[0][1]);
  for (const [x, y] of HOUSE.tiles.slice(1)) g.buildings.addTile(b, x, y);
  b.levels = 2;
  b.workLevel = 1;
  g.player.x = 45.5;
  g.player.y = 12.5;
  g.player.level = 0;
  return g;
}

const tile = (x: number, y: number, more: Record<string, unknown> = {}): Target => ({ kind: 'tile', x, y, cx: x, cy: y, ...more } as Target);
const jt = (t: Target): string => `${q(JSON.stringify(t))}::jsonb`;
const build = (id: string) => BUILD_ACTION_BY_ID.get(id)!;
/** The browser's door and then its deed: the message it logs, or its refusal. */
function run(g: Game, id: string, t: Target): string {
  const why = build(id).check?.(t, g) ?? null;
  if (why) return `REFUSED ${why}`;
  build(id).perform(t, g);
  return g.log[g.log.length - 1]?.text ?? '';
}
/** The same on the island, in a block with `w`, `me` and `v_why` declared. */
const runSql = (tag: string, id: string, t: Target): string => `
  v_why := build_refusal(w, me, ${q(id)}, ${jt(t)});
  if v_why is null then
    perform perform_building(w, me, ${q(id)}, ${jt(t)});
    insert into said values (${q(tag)}, (select e.text from event e where e.world_id = w and e.uid = me order by e.n desc limit 1));
  else
    insert into said values (${q(tag)}, 'REFUSED ' || v_why);
  end if;`;

/** Planned: a single staircase up the left of the west tile, a wide one on the middle tile, and one whose hand is no hand on the east tile. */
const SINGLE = tile(44, 12, { material: MAT, floorKind: 'stairs', side: 's', hand: 'l' });
const WIDE = tile(45, 12, { material: MAT, floorKind: 'stairs', side: 's' });
const ODD = tile(46, 12, { material: MAT, floorKind: 'stairs', side: 's', hand: 'x' });
const LADDER = tile(46, 12, { material: 'plank', floorKind: 'ladder', side: 's', hand: 'r' });

const out = answers(psql(`begin;
create temp table said (k text, v text) on commit drop;
do $b$
declare w uuid; me uuid; v_why text; v_ground jsonb;
begin
  ${ISLAND_SCENE}
  ${runSql('single', 'plan_floor', SINGLE)}
  ${runSql('wide', 'plan_floor', WIDE)}
  ${runSql('odd', 'plan_floor', ODD)}
  insert into said select 'rows', string_agg(x || ':' || coalesce(hand, '-') || ':' || needed::text, ' ' order by x)
    from floor_tile where world_id = w and level = 1 and y = 12 and x between 44 and 46;
  delete from floor_tile where world_id = w and level = 1 and x = 46 and y = 12;
  ${runSql('ladder', 'plan_floor', LADDER)}
  insert into said select 'ladderHand', coalesce(hand, '-') from floor_tile where world_id = w and level = 1 and x = 46 and y = 12;
  v_ground := rpc_ground(w, 40, true);
  insert into said select 'read', string_agg((f->>'x') || ':' || coalesce(f->>'hand', '-'), ' ' order by (f->>'x'))
    from jsonb_array_elements(v_ground->'buildings'->'floors') f where (f->>'level')::int = 1 and (f->>'y')::int = 12;
  begin
    update floor_tile set hand = 'l' where world_id = w and level = 1 and x = 46 and y = 12;
    insert into said values ('handOnLadder', 'TAKEN');
  exception when check_violation then
    insert into said values ('handOnLadder', 'REFUSED');
  end;
  ${runSql('remove', 'remove_floor', tile(44, 12, { floorKind: 'stairs' }))}
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\\n~~\\n' order by k) from said;
rollback;`));

const g = browserScene();
const mine = {
  single: run(g, 'plan_floor', SINGLE),
  wide: run(g, 'plan_floor', WIDE),
  odd: run(g, 'plan_floor', ODD),
};
const floorRow = (x: number): string => {
  const f = g.buildings.floor(1, x, 12);
  return f ? `${x}:${f.hand ?? '-'}:${JSON.stringify(f.needed)}` : `${x}:none`;
};
const normal = (s: string | undefined): string => (s ?? '').replace(/\s+/g, '').replace(/"/g, '');
for (const k of ['single', 'wide', 'odd'] as const) {
  check(`planning ${k === 'single' ? 'a single staircase' : k === 'wide' ? 'a wide one' : 'one whose hand is no hand'} says the same on both sides`,
    mine[k] === out.get(k), `browser "${mine[k]}", island "${out.get(k)}"`);
}
check(`and it is planned as ${SINGLE_STAIRS_NAME}, in its own words`, mine.single.includes(SINGLE_STAIRS_NAME) && !mine.wide.includes(SINGLE_STAIRS_NAME),
  mine.single);
const rowsMine = [44, 45, 46].map(floorRow).join(' ');
check('the single one keeps its hand and its bill, the wide one and the one with no hand neither, the same on both sides',
  normal(rowsMine) === normal(out.get('rows')) && rowsMine.startsWith('44:l:') && /45:-:/.test(rowsMine) && /46:-:/.test(rowsMine),
  `browser ${rowsMine}; island ${out.get('rows')}`);
const g2 = browserScene();
run(g2, 'plan_floor', LADDER);
check('a ladder takes no hand on either side', (g2.buildings.floor(1, 46, 12)?.hand ?? '-') === '-' && out.get('ladderHand') === '-',
  `browser ${g2.buildings.floor(1, 46, 12)?.hand ?? '-'}, island ${out.get('ladderHand')}`);
check('the ground read sends each floor its hand', out.get('read') === '44:l 45:- 46:-', out.get('read'));
check('and the table holds no hand on anything but a staircase', out.get('handOnLadder') === 'REFUSED', out.get('handOnLadder'));

/* ---- walked ------------------------------------------------------------------------------------- */
const single = g.buildings.floor(1, 44, 12)!;
for (const k of Object.keys(single.needed)) single.needed[k] = 0;
check('walking onto a finished single staircase from below takes you up a storey, as the wide one does',
  g.stepRule(44, 13, 0, 44, 12) === 1, `arrives on storey ${g.stepRule(44, 13, 0, 44, 12)}`);

/* ---- taken out ---------------------------------------------------------------------------------- */
const removed = run(g, 'remove_floor', tile(44, 12, { floorKind: 'stairs' }));
check('and it is taken out in its own name, on both sides', removed === out.get('remove') && removed.includes(SINGLE_STAIRS_NAME),
  `browser "${removed}", island "${out.get('remove')}"`);

/* ---- wheels up a wide staircase ------------------------------------------------------------------ */

/*
 * The house again, a storey up: a wide plank staircase on its west tile
 * climbed from the west, its foot out on the ground at 43,12; a finished
 * floor on the middle tile, off its head; and a single staircase on the east
 * tile, climbed from the south.
 */
const w3 = browserScene();
const house = w3.buildings.list.values().next().value!;
const done = (f: { needed: Record<string, number> }): void => { for (const k of Object.keys(f.needed)) f.needed[k] = 0; };
done(w3.buildings.setFloor(house, 1, 44, 12, MAT, 'stairs', 'w'));
done(w3.buildings.setFloor(house, 1, 45, 12, MAT, 'floor'));
done(w3.buildings.setFloor(house, 1, 46, 12, MAT, 'stairs', 's', 'l'));
const drive = (x0: number, y0: number, level: number, x1: number, y1: number): number | null => w3.driveRule(x0, y0, level, x1, y1);
check('a wagon goes up a wide staircase from its foot, onto the storey over it', drive(43, 12, 0, 44, 12) === 1, `${drive(43, 12, 0, 44, 12)}`);
check('and not onto it over its rails', drive(44, 13, 0, 44, 12) === null && drive(44, 11, 0, 44, 12) === null,
  `${drive(44, 13, 0, 44, 12)}, ${drive(44, 11, 0, 44, 12)}`);
check('off its head onto the floor up there, and back down off its foot', drive(44, 12, 1, 45, 12) === 1 && drive(44, 12, 1, 43, 12) === 0,
  `${drive(44, 12, 1, 45, 12)}, ${drive(44, 12, 1, 43, 12)}`);
check('and on a storey up, onto the head of a wide staircase only from its head', drive(45, 12, 1, 44, 12) === 1 && drive(44, 11, 1, 44, 12) === null,
  `${drive(45, 12, 1, 44, 12)}, ${drive(44, 11, 1, 44, 12)}`);
check('but up no single staircase, from its foot or along the storey, though a walker climbs it',
  drive(46, 13, 0, 46, 12) === null && drive(45, 12, 1, 46, 12) === null && w3.stepRule(46, 13, 0, 46, 12) === 1,
  `${drive(46, 13, 0, 46, 12)}, ${drive(45, 12, 1, 46, 12)}, walking ${w3.stepRule(46, 13, 0, 46, 12)}`);
check('nor off the edge of what is floored up there', drive(45, 12, 1, 45, 13) === null && drive(45, 12, 1, 45, 11) === null,
  `${drive(45, 12, 1, 45, 13)}, ${drive(45, 12, 1, 45, 11)}`);
const door = w3.buildings.setWall(house, 0, 44, 12, 'w', 'solid', MAT);
done(door);
const walled = drive(43, 12, 0, 44, 12);
door.type = 'door';
const narrow = drive(43, 12, 0, 44, 12);
door.type = 'double_door';
const wide = drive(43, 12, 0, 44, 12);
check('and up from its foot only through a doorway wide enough for wheels, as on the ground',
  walled === null && narrow === null && wide === 1, `solid ${walled}, door ${narrow}, double door ${wide}`);
const route = findPath(w3.world, 42, 12, 0, 45, 12, { ...pathOptions(w3.world, w3.driveRule, TOP_LEVELS), goalLevel: 1 });
check('and a drive is found from the ground outside, in through the double door, up the flight and onto the floor over it',
  !!route && route[route.length - 1].level === 1 && route.some((pt) => pt.x === 44 && pt.y === 12),
  route ? route.map((pt) => `${pt.x},${pt.y}@${pt.level}`).join(' ') : 'no way');
const up = w3.buildings.setWall(house, 1, 45, 12, 'e', 'solid', MAT);
done(up);
check('and a wall up there stops it as one does on the ground', drive(45, 12, 1, 46, 12) === null, `${drive(45, 12, 1, 46, 12)}`);

// The wagon itself: a storey up beside the stair head on both sides, and Dane on the ground under it.
const wagon = w3.addFurniture('wagon', 45, 12, 0, 0, 50, [], undefined, 's');
// Where driving it up the flight leaves it (`updateTeam`): nothing is set down a storey up any other way.
wagon.level = 1;
const [wcx, wcy] = furnitureCentre(wagon);
w3.player.x = wcx + 0.5;
w3.player.y = wcy;
w3.player.level = 0;
const board = (g: Game): string => ACTION_BY_ID.get('board_vehicle')?.check?.({ kind: 'furniture', id: wagon.id } as Target, g) ?? 'ALLOWED';
const unhitch = (g: Game): string => ACTION_BY_ID.get('unhitch_team')?.check?.({ kind: 'furniture', id: wagon.id } as Target, g) ?? 'ALLOWED';
const boardBelow = board(w3);
w3.player.level = 1;
const unhitchUp = unhitch(w3);
const wheels = answers(psql(`begin;
create temp table said (k text, v text) on commit drop;
do $b$
declare w uuid; me uuid; v_id bigint;
begin
  ${ISLAND_SCENE}
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, level)
    values (w, 'furniture', 'wagon', 45, 12, 0, 0, ${wcx}, ${wcy}, 50, me, 1) returning id into v_id;
  update player set x = ${wcx + 0.5}, y = ${wcy}, level = 0 where world_id = w and uid = me;
  insert into said values ('boardBelow', coalesce(ride_refusal(w, me, 'board_vehicle', jsonb_build_object('kind', 'furniture', 'id', v_id)), 'ALLOWED'));
  update player set level = 1 where world_id = w and uid = me;
  insert into said values ('unhitchUp', coalesce(ride_refusal(w, me, 'unhitch_team', jsonb_build_object('kind', 'furniture', 'id', v_id)), 'ALLOWED'));
  -- Driven: down to the ground with its driver, and up again.
  update placed set driver = me where world_id = w and id = v_id;
  update player set level = 0 where world_id = w and uid = me;
  perform drag_along(w, me, 43.5, 12.5);
  insert into said select 'dragDown', level::text from placed where world_id = w and id = v_id;
  update player set level = 1 where world_id = w and uid = me;
  perform drag_along(w, me, 45.5, 12.5);
  insert into said select 'dragUp', level::text from placed where world_id = w and id = v_id;
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\n~~\n' order by k) from said;
rollback;`));
check('nobody takes the reins of a wagon a storey up from the ground under it, on both sides',
  boardBelow === 'Stand beside it first.' && boardBelow === wheels.get('boardBelow'), `browser "${boardBelow}", island "${wheels.get('boardBelow')}"`);
check('and its team is not taken out of the traces up there, in the same words on both sides',
  unhitchUp === tracesStoreyRefusal(wagon) && unhitchUp === wheels.get('unhitchUp'), `browser "${unhitchUp}", island "${wheels.get('unhitchUp')}"`);
check('on the island a driven wagon stands on the storey its driver drove it to, and on the ground again after',
  wheels.get('dragUp') === '1' && wheels.get('dragDown') === '0', `down: ${wheels.get('dragDown')}, up: ${wheels.get('dragUp')}`);

console.log(`${good} ok, ${bad} failed`);
if (bad) process.exit(1);
