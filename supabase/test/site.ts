/**
 * The pile on the site, and a bridge that lands on a storey.
 *
 * A builder carried everything. Six log walls, at what a log weighs, is trip
 * after trip from the woodpile to the corner of the house — and the crate you
 * tipped them into is standing on the very tile you are working. A wall draws
 * from a crate on its own tile now, and from the pack after. On the tile, not
 * within reach: a crate two tiles off is a store.
 *
 * And a bridge may land on a storey. Its ends wanted a bank or a poured slab,
 * and both of those are ground, so two towers a tile apart were a staircase
 * down, a walk across the yard and a staircase up.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID } from '../../src/game/actions';
import { WALL_HEIGHT, type Side } from '../../src/game/building';
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
const W = `(select id from world where name = 'Hoarding')`;
const U = `(select uid from player where world_id = ${W} and name = 'Dane')`;

/* ---- a wall, and a crate of logs standing on the tile -------------------- */
const game = Game.create(4242);
game.inventory.add('mallet', { ql: 40 });
const b = game.buildings.create('Store', 20, 20);
game.player.x = 20.5;
game.player.y = 20.5;
const wall = game.buildings.setWall(b, 0, 20, 20, 'n', 'solid', 'log');
/* What a log wall takes, off its own bill, and a crate holding that and four over. */
const LOGS = wall.total.log;
const crate = game.addCrate('log', 20, 20, 1, 1);
crate.items.push({ uid: 9001, id: 'log', ql: 40, dmg: 0, count: LOGS + 4 } as never);

psql(`
do $$
declare w uuid; u uuid;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  delete from wall where world_id = w; delete from floor_tile where world_id = w;
  delete from building_tile where world_id = w; delete from building where world_id = w;
  delete from bridge where world_id = w;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  delete from item where world_id = w and holder = 'crate';
  delete from crate where world_id = w;
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'mallet', 40, 1);
  insert into building (world_id, id, name, levels, work_level, planned_by) values (w, 1, 'Store', 1, 0, u);
  insert into building_tile (world_id, building, x, y) values (w, 1, 20, 20);
  insert into wall (world_id, level, dir, x, y, building, type, material, needed, total)
    values (w, 0, 'h', 20, 20, 1, 'solid', 'log', wall_bill('log', 'solid'), wall_bill('log', 'solid'));
  insert into crate (world_id, id, kind, x, y, sx, sy) values (w, 1, 'log', 20, 20, 1, 1);
  insert into item (world_id, holder, crate, def, ql, count) values (w, 'crate', 1, 'log', 40, ${LOGS + 4});
  update player set x = 20.5, y = 20.5 where world_id = w and uid = u;
end $$;`);

const mineSay = (id: string, t: Record<string, unknown>): string =>
  ACTION_BY_ID.get(id)?.check?.({ kind: 'tile', x: 20, y: 20, cx: 20, cy: 20, ...t } as never, game) ?? 'ALLOWED';
const theirSay = (action: string, target: string): string =>
  psql(`select coalesce(build_refusal(${W}, ${U}, '${action}', '${target}'::jsonb), 'ALLOWED');`);

check('a wall may be built out of the crate standing on its own tile, on both sides',
  mineSay('build_wall', { side: 'n' }) === 'ALLOWED'
    && theirSay('build_wall', '{"x":20,"y":20,"side":"n"}') === 'ALLOWED',
  `browser "${mineSay('build_wall', { side: 'n' })}", island "${theirSay('build_wall', '{"x":20,"y":20,"side":"n"}')}"`);

/* And a go for every log of it draws on the crate rather than the pack, which is empty. */
const act = ACTION_BY_ID.get('build_wall');
for (let i = 0; i < LOGS; i++) act?.perform?.({ kind: 'tile', x: 20, y: 20, cx: 20, cy: 20, side: 'n' } as never, game);
psql(`do $$
declare w uuid; u uuid;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  for i in 1..${LOGS} loop perform perform_building(w, u, 'build_wall', '{"x":20,"y":20,"side":"n"}'::jsonb); end loop;
end $$;`);
const theirLeft = Number(psql(`select coalesce(sum(count), 0) from item where world_id = ${W} and holder = 'crate';`));
const mineLeft = crate.items.reduce((n, it) => n + it.count, 0);
check(`and ${LOGS} goes take ${LOGS} logs out of the crate, on both sides`,
  mineLeft === 4 && theirLeft === 4, `browser ${mineLeft} left, island ${theirLeft} left`);
check('the wall is finished by them', Object.values(wall.needed).every((n) => n <= 0)
  && psql(`select bill_done(needed) from wall where world_id = ${W} and dir = 'h' and x = 20 and y = 20;`) === 't',
  `${LOGS} logs out of the pile on the site`);

/* A crate a tile away is a store, not a site. */
const far = Game.create(4242);
far.inventory.add('mallet', { ql: 40 });
const fb = far.buildings.create('Store', 20, 20);
far.player.x = 20.5;
far.player.y = 20.5;
far.buildings.setWall(fb, 0, 20, 20, 'n', 'solid', 'log');
const away = far.addCrate('log', 21, 20, 1, 1);
away.items.push({ uid: 9002, id: 'log', ql: 40, dmg: 0, count: 8 } as never);
const farSaid = ACTION_BY_ID.get('build_wall')?.check?.({ kind: 'tile', x: 20, y: 20, cx: 20, cy: 20, side: 'n' } as never, far) ?? 'ALLOWED';
check('while a crate on the next tile is a store and not a site', farSaid.startsWith('You need'), farSaid);

/* ---- a bridge from one storey to another --------------------------------- */
const gb = Game.create(4242);
// Flat, dry, walkable ground under the whole of it: a bank that is not a bank
// answers the wrong refusal, and the one under test is about storeys.
for (let x = 39; x <= 46; x++) {
  for (let y = 39; y <= 43; y++) {
    gb.world.setHeight(x, y, 100);
    gb.world.setTile(x, y, TileType.Grass);
  }
}
const towerAt = (x: number, name: string) => {
  const t = gb.buildings.create(name, x, 40);
  t.levels = 2;
  const f = gb.buildings.setFloor(t, 1, x, 40, 'log');
  for (const k of Object.keys(f.needed)) f.needed[k] = 0;
  for (const side of ['n', 'e', 's', 'w'] as Side[]) {
    const w = gb.buildings.setWall(t, 0, x, 40, side, 'solid', 'log');
    for (const k of Object.keys(w.needed)) w.needed[k] = 0;
  }
  return t;
};
towerAt(40, 'West tower');
towerAt(42, 'East tower');
check('a finished second floor is the top deck of its tile',
  gb.topDeck(40, 40).level === 1 && Math.abs(gb.topDeck(40, 40).height - (100 + WALL_HEIGHT)) < 1e-6,
  `storey ${gb.topDeck(40, 40).level} at ${gb.topDeck(40, 40).height}`);

const across = gb.bridgeReason('wood', 40, 40, 42, 40);
check('and a walkway may be thrown from one tower to the other', across === null, across ?? 'allowed');

const down = gb.bridgeReason('wood', 40, 40, 44, 40);
check('but not from a storey to the ground, and it says which is which',
  down === 'One end is on storey 2 and the other on the ground. A deck meets one storey or the other.', down ?? 'allowed');

/* The same two questions of the island. */
psql(`
do $$
declare w uuid; u uuid; gx int; gy int;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  delete from wall where world_id = w; delete from floor_tile where world_id = w;
  delete from building_tile where world_id = w; delete from building where world_id = w;
  insert into building (world_id, id, name, levels, work_level, planned_by) values
    (w, 2, 'West tower', 2, 1, u), (w, 3, 'East tower', 2, 1, u);
  insert into building_tile (world_id, building, x, y) values (w, 2, 40, 40), (w, 3, 42, 40);
  insert into floor_tile (world_id, level, x, y, building, material, kind, needed, total) values
    (w, 1, 40, 40, 2, 'log', 'floor', '{"log": 0}', '{"log": 2}'),
    (w, 1, 42, 40, 3, 'log', 'floor', '{"log": 0}', '{"log": 2}');
  -- Flat, dry, walkable ground under the whole of it, as in the browser: a
  -- bank that is not a bank answers the wrong refusal.
  for gx in 39..46 loop
    for gy in 39..43 loop
      perform land_set_height(w, gx, gy, 100);
      perform land_set_tile(w, gx, gy, tile_id('Grass'));
    end loop;
  end loop;
end $$;`);
const theirDeck = Number(psql(`select top_deck(${W}, 40, 40);`));
check('the island reads the same top deck', theirDeck === 1, `storey ${theirDeck + 1}`);
const theirDown = psql(`select coalesce(bridge_reason(${W}, 'wood', 40, 40, 44, 40), 'ALLOWED');`);
check('and refuses the mismatched pair in the same words', theirDown === down,
  `island "${theirDown}", browser "${down}"`);

/* And you walk it at the storey it lands on, not at the ground under it. */
const deck = gb.addBridge('wood', 40, 40, 42, 40, 100 + WALL_HEIGHT, 'Oak', 1);
for (const sp of deck.spans) for (const k of Object.keys(sp.needed)) sp.needed[k] = 0;
check('a finished walkway is stepped onto from the storey it meets',
  gb.stepRule(40, 40, 1, 41, 40) === 1, `stepRule gives ${gb.stepRule(40, 40, 1, 41, 40)}`);
check('and not from the yard underneath it',
  gb.stepRule(40, 40, 0, 41, 40) === null, `stepRule gives ${gb.stepRule(40, 40, 0, 41, 40)}`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a builder builds out of the pile on the site, and a bridge may land on a storey — ${ok.length} of ${ok.length}`);
