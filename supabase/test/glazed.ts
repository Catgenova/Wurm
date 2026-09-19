/**
 * Glass in the window, and a colour on the wall.
 *
 * Two things a builder never had, and one of them was drawn all along.
 *
 * Every window on this island has had glass in it since the first day and the
 * glass was never made, never paid for and never once lit. A window wall cost
 * three quarters of a solid one and nothing besides, so glazing was free and a
 * window was *cheaper* than the wall it was cut into. Sand run flat on a
 * smelter hearth and cut square is what a pane is; a window takes two and a
 * bay takes four.
 *
 * And paint. Everything here comes out the colour of what it was made of, so a
 * street of twelve materials is a street of twelve colours and no more: a
 * builder chooses what a wall is *of* and never what it looks like.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID, ACTIONS } from '../../src/game/actions';
import { wallBill, type Side } from '../../src/game/building';
import { DYE_BY_ID } from '../../src/game/dyestuffs';
import { Game } from '../../src/game/game';
import { ITEM_DEFS } from '../../src/game/items';
import { RECIPE_BY_ID } from '../../src/game/recipes';

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
void ACTIONS.length;
const W = `(select id from world where name = 'Hoarding')`;
const U = `(select uid from player where world_id = ${W} and name = 'Dane')`;

/* ---- glass ---------------------------------------------------------------- */
check('there is such a thing as a pane of glass', !!ITEM_DEFS.glass, ITEM_DEFS.glass?.name ?? 'nothing');
check('and the island has heard of it', psql(`select count(*) from item_def where id = 'glass';`) === '1');

const mine = RECIPE_BY_ID.get('make_glass');
const theirs = psql(`select coalesce((select string_agg(i.item || 'x' || i.count, ',' order by i.ord)
                     from recipe_input i where i.recipe = 'make_glass'), 'NOTHING');`);
check('sand is run flat into panes at a smelter, the same bill on both sides',
  !!mine && theirs === mine.inputs.map((i) => `${i.item}x${i.count ?? 1}`).join(','),
  `browser ${mine?.inputs.map((i) => `${i.item}x${i.count ?? 1}`).join(',')} → ${mine?.count} glass, island ${theirs}`);

/* ---- and a window that costs it ------------------------------------------ */
for (const [type, want] of [['window', 2], ['bay', 4]] as Array<[string, number]>) {
  const minePanes = wallBill('log', type as never).total.glass ?? 0;
  const theirPanes = Number(psql(`select coalesce((wall_bill('log', '${type}')->>'glass')::int, 0);`));
  check(`a ${type === 'bay' ? 'bay window' : 'window'} takes ${want} panes, on both sides`,
    minePanes === want && theirPanes === want, `browser ${minePanes}, island ${theirPanes}`);
}
check('while a solid wall takes none', (wallBill('log', 'solid').total.glass ?? 0) === 0, 'a wall is a wall');

/* ---- paint ---------------------------------------------------------------- */
const game = Game.create(4242);
const b = game.buildings.create('Painted house', 30, 30);
game.player.x = 30.5;
game.player.y = 30.5;
const wall = game.buildings.setWall(b, 0, 30, 30, 'n', 'solid', 'log');
for (const k of Object.keys(wall.needed)) wall.needed[k] = 0;
game.inventory.add('dye', { ql: 60, extra: 'Woad' });
game.inventory.add('dye', { ql: 60, extra: 'Woad' });
game.inventory.add('lye_bucket', { ql: 40 });

psql(`
do $$
declare w uuid; u uuid;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  delete from wall where world_id = w; delete from floor_tile where world_id = w;
  delete from building_tile where world_id = w; delete from building where world_id = w;
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def in ('dye', 'lye_bucket', 'bucket');
  insert into item (world_id, holder, holder_uid, def, ql, count, extra) values
    (w, 'player', u, 'dye', 60, 2, 'Woad');
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'lye_bucket', 40, 1);
  insert into building (world_id, id, name, levels, work_level, planned_by) values (w, 4, 'Painted house', 1, 0, u);
  insert into building_tile (world_id, building, x, y) values (w, 4, 30, 30);
  insert into wall (world_id, level, dir, x, y, building, type, material, needed, total)
    values (w, 0, 'h', 30, 30, 4, 'solid', 'log', '{"log": 0}', '{"log": 4}');
  update player set x = 30.5, y = 30.5 where world_id = w and uid = u;
end $$;`);

const target = { kind: 'tile' as const, x: 30, y: 30, cx: 30, cy: 30, side: 'n' as Side };
const TJ = '{"x":30,"y":30,"side":"n"}';
const mineSaid = (): string => {
  game.log.length = 0;
  ACTION_BY_ID.get('paint_wall')?.perform?.(target as never, game);
  return game.log.map((l) => l.text).find((t) => t.startsWith('You brush')) ?? 'NOTHING SAID';
};
const theirSaid = (action: string): string => psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  delete from event where world_id = w and uid = u;
  perform perform_building(w, u, '${action}', '${TJ}'::jsonb);
  insert into said select text from event where world_id = w and uid = u and kind = 'event';
end $$;
select k from said;
commit;
`).split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? 'NOTHING SAID';

const browserBrush = mineSaid();
const islandBrush = theirSaid('paint_wall');
check('a pot of woad goes onto the wall in the same sentence on both sides',
  browserBrush === islandBrush && browserBrush.includes('blue'),
  `browser "${browserBrush}", island "${islandBrush}"`);
check('and the wall is the colour it was painted, on both sides',
  wall.dye === 'woad' && psql(`select coalesce(dye, 'NONE') from wall where world_id = ${W} and dir = 'h' and x = 30 and y = 30;`) === 'woad',
  `browser ${wall.dye}, island ${psql(`select coalesce(dye, 'NONE') from wall where world_id = ${W} and dir = 'h' and x = 30 and y = 30;`)}`);

const mineAgain = ACTION_BY_ID.get('paint_wall')?.check?.(target as never, game) ?? 'ALLOWED';
const theirAgain = psql(`select coalesce(build_refusal(${W}, ${U}, 'paint_wall', '${TJ}'::jsonb), 'ALLOWED');`);
check('painting it the colour it already is is refused in the same words',
  mineAgain === theirAgain && mineAgain === `It is ${DYE_BY_ID.get('woad')?.word} already.`,
  `browser "${mineAgain}", island "${theirAgain}"`);

/* And lye takes it back off, the bucket with it. */
game.log.length = 0;
ACTION_BY_ID.get('strip_wall_paint')?.perform?.(target as never, game);
const mineStrip = game.log.map((l) => l.text).find((t) => t.startsWith('You scrub')) ?? 'NOTHING SAID';
const theirStrip = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  delete from event where world_id = w and uid = u;
  perform perform_building(w, u, 'strip_wall_paint', '${TJ}'::jsonb);
  insert into said select text from event where world_id = w and uid = u and kind = 'event';
end $$;
select k from said;
commit;
`).split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? 'NOTHING SAID';
check('and lye scrubs it back to bare wood, said the same way on both sides',
  mineStrip === theirStrip && !wall.dye, `browser "${mineStrip}", island "${theirStrip}"`);
check('the empty bucket comes back, on both sides',
  game.inventory.has('bucket') && Number(psql(`select coalesce(sum(count), 0) from item where world_id = ${W} and holder = 'player' and holder_uid = ${U} and def = 'bucket';`)) > 0,
  'one bucket of lye, one bucket back');

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a window costs the glass that was always drawn in it, and a wall may be painted — ${ok.length} of ${ok.length}`);
