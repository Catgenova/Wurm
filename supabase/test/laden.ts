/**
 * What you gather goes in the cart.
 *
 * Asked: "When doing actions from the cart, all gathered materials should go
 * right to the cart."
 *
 * The cart you are working from is the cart or wagon you have the reins of,
 * or the small cart you have by the shafts; a boat is not one. Asked of both
 * sides:
 *
 *   * driving a wagon, what a dig brings up goes into the wagon, and nothing
 *     into the pack;
 *   * a wagon two short of full takes two, the rest goes in the pack, and it
 *     says the wagon is full once, not once a swing;
 *   * a creel's catch goes the same way;
 *   * pulling a small cart, what you gather goes into it;
 *   * in a boat, or on foot, it goes in the pack as it always did;
 *   * and taking hold of a cart says so.
 *
 * The island half runs against the database the suite leaves behind, in one
 * transaction that is rolled back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import { furnitureSpare } from '../../src/game/furniture';
import type { Item } from '../../src/game/items';

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

/* ---- the browser --------------------------------------------------------- */

const game = Game.create(4242);
// Diggable ground with dirt under it and room round it.
let spot: [number, number] | null = null;
for (let r = 0; r < 120 && !spot; r++) {
  for (let dx = -r; dx <= r && !spot; dx++) {
    for (const dy of [-r, r]) {
      const [x, y] = [64 + dx, 64 + dy];
      let fine = game.world.getDirt(x, y) > 4 && game.world.getHeight(x, y) > 5;
      for (let j = -1; j <= 1 && fine; j++) {
        for (let i = -1; i <= 3 && fine; i++) fine = game.world.isPassable(x + i, y + j) && !game.world.hasWater(x + i, y + j);
      }
      if (fine) {
        spot = [x, y];
        break;
      }
    }
  }
}
const [px, py] = spot ?? [64, 64];
game.player.x = px + 0.5;
game.player.y = py + 0.5;
for (const f of [...game.furniture.values()]) game.removeFurniture(f.id);
const pack = game.inventory;
for (const it of [...pack.items]) if (['dirt', 'log', 'rock_shards', 'minnow'].includes(it.id)) pack.remove(it.uid, it.count);
if (!pack.has('shovel')) pack.add('shovel', { ql: 50 });

const count = (items: Item[], id: string): number => items.filter((it) => it.id === id).reduce((n, it) => n + it.count, 0);
const wagon = game.addFurniture('wagon', px + 1, py, 0, 0, 40, [], 'Pine');
wagon.driven = true;

console.log('--- the browser');
check('driving a wagon, it is the cart you are working from', game.workCart() === wagon);
const dig = ACTION_BY_ID.get('dig');
if (!dig) throw new Error('no dig');
const spade = { kind: 'tile', x: px, y: py, cx: px, cy: py } as Target;
for (let i = 0; i < 40 && count(wagon.items, 'dirt') < 3; i++) {
  game.player.stats.stamina = 1;
  dig.perform(spade, game);
}
check('what a dig brings up goes into the wagon, and nothing into the pack',
  count(wagon.items, 'dirt') >= 3 && count(pack.items, 'dirt') === 0,
  `${count(wagon.items, 'dirt')} dirt in the wagon, ${count(pack.items, 'dirt')} in the pack`);

// Two short of full.
wagon.items.push({ uid: pack.nextUid++, id: 'rock_shards', ql: 20, dmg: 0, count: furnitureSpare(wagon) - 2 });
const inWagon = count(wagon.items, 'dirt');
const heard = game.log.length;
game.gather('dirt', { count: 5, ql: 30 });
game.gather('dirt', { count: 5, ql: 30 });
const full = game.log.slice(heard).filter((l) => l.text === 'The wagon (pine) is full. What does not fit goes in your pack.');
check('a wagon two short of full takes two, and the rest goes in the pack',
  count(wagon.items, 'dirt') === inWagon + 2 && count(pack.items, 'dirt') === 8,
  `${count(wagon.items, 'dirt') - inWagon} into the wagon, ${count(pack.items, 'dirt')} into the pack`);
check('and it says the wagon is full once, not once a swing', full.length === 1, `${full.length} times`);
wagon.items = wagon.items.filter((it) => it.id !== 'rock_shards');

game.gatherItem({ uid: pack.nextUid++, id: 'minnow', ql: 30, dmg: 0, count: 4 });
check('a catch that is already a thing goes the same way', count(wagon.items, 'minnow') === 4, `${count(wagon.items, 'minnow')}`);

wagon.driven = false;
const barrow = game.addFurniture('cart', px + 2, py + 1, 0, 0, 40, [], 'Pine');
barrow.hitched = true;
game.gather('log', { count: 3, ql: 30, extra: 'Pine' });
check('pulling a small cart, what you gather goes into it', count(barrow.items, 'log') === 3 && count(pack.items, 'log') === 0,
  `${count(barrow.items, 'log')} in the cart`);
barrow.hitched = false;

const boat = game.addFurniture('rowing_boat', px - 1, py - 1, 0, 0, 40, [], 'Pine');
boat.driven = true;
game.gather('log', { count: 2, ql: 30, extra: 'Pine' });
check('in a boat it goes in the pack', count(pack.items, 'log') === 2 && count(boat.items, 'log') === 0,
  `${count(pack.items, 'log')} in the pack`);
boat.driven = false;
game.gather('log', { count: 1, ql: 30, extra: 'Pine' });
check('and on foot, as it always did', count(pack.items, 'log') === 3, `${count(pack.items, 'log')}`);

/* ---- the island ---------------------------------------------------------- */

const isle = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; me uuid; v_x int; v_y int; v_wagon bigint; v_cart bigint; v_boat bigint; v_creel bigint;
        v_dirt int; i int;
begin
  select id into w from world where name = 'Hoarding';
  select uid into me from player where world_id = w and name = 'Dane';
  -- Grass or dirt with dirt under it, off every settlement.
  select gx, gy into v_x, v_y
    from world wd, generate_series(3, wd.size - 4) gx, generate_series(3, wd.size - 4) gy
   where wd.id = w and land_tile(w, gx, gy) in (0, 1) and land_dirt(w, gx, gy) > 4
     and not exists (select 1 from deed d where d.world_id = w
                      and abs(d.x - gx) <= d.radius + 6 and abs(d.y - gy) <= d.radius + 6)
   order by gx, gy limit 1;
  update player set x = v_x + 0.5, y = v_y + 0.5, act = null, act_queue = '[]'::jsonb,
      stats = jsonb_build_object('health', 1, 'hunger', 1, 'thirst', 1, 'stamina', 1), body_at = now()
    where world_id = w and uid = me;
  update placed set driver = null where world_id = w and driver = me;
  update placed set puller = null where world_id = w and puller = me;
  delete from item where world_id = w and holder = 'player' and holder_uid = me and def in ('dirt', 'log', 'minnow', 'shovel');
  perform give(w, me, 'shovel', 1, 50);
  insert into said values ('SPOT|' || v_x || ',' || v_y);

  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by, driver)
    values (w, 'furniture', 'wagon', v_x + 1, v_y, 0, 0, v_x + 1.5, v_y + 0.5, 40, 'Pine', me, me)
    returning id into v_wagon;
  insert into said values ('CART|' || coalesce((work_cart(w, me)).id = v_wagon, false));

  -- A dig, through the performer, until a spadeful comes up.
  for i in 1..40 loop
    exit when (select coalesce(sum(count), 0) from item where placed = v_wagon and def = 'dirt') >= 3;
    perform act_perform(w, me, 'dig', jsonb_build_object('kind', 'tile', 'x', v_x, 'y', v_y, 'cx', v_x, 'cy', v_y));
  end loop;
  insert into said values ('DIG|' || (select coalesce(sum(count), 0) from item where placed = v_wagon and def = 'dirt')
    || ',' || pack_count(w, me, 'dirt'));

  -- Two short of full, and gathered twice in the one ask.
  insert into item (world_id, holder, placed, def, ql, count)
    values (w, 'furniture', v_wagon, 'rock_shards', 20,
            furniture_spare((select pl from placed pl where pl.id = v_wagon)) - 2);
  select coalesce(sum(count), 0) into v_dirt from item where placed = v_wagon and def = 'dirt';
  delete from event where world_id = w and uid = me;
  perform gather(w, me, 'dirt', 5, 30);
  perform gather(w, me, 'dirt', 5, 30);
  insert into said values ('FULL|' || ((select coalesce(sum(count), 0) from item where placed = v_wagon and def = 'dirt') - v_dirt)
    || ',' || pack_count(w, me, 'dirt'));
  insert into said select 'SAID|' || count(*) from event where world_id = w and uid = me and kind = 'error'
    and text = 'The wagon (pine) is full. What does not fit goes in your pack.';
  delete from item where placed = v_wagon and def = 'rock_shards';

  -- A creel's catch.
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'trap', 'creel', v_x, v_y + 1, 0, 0, v_x + 0.5, v_y + 1.5, 40, me) returning id into v_creel;
  insert into item (world_id, holder, placed, def, ql, count) values (w, 'trap', v_creel, 'minnow', 30, 4);
  perform perform_trap(w, me, 'empty_creel', jsonb_build_object('kind', 'trap', 'id', v_creel));
  insert into said values ('CREEL|' || (select coalesce(sum(count), 0) from item where placed = v_wagon and def = 'minnow')
    || ',' || pack_count(w, me, 'minnow'));

  -- Off the wagon and onto the shafts of a small cart.
  update placed set driver = null where id = v_wagon;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'cart', v_x + 2, v_y + 1, 0, 0, v_x + 2.5, v_y + 1.25, 40, 'Pine', me) returning id into v_cart;
  delete from event where world_id = w and uid = me;
  perform act_perform(w, me, 'pull_cart', jsonb_build_object('kind', 'furniture', 'id', v_cart));
  insert into said select 'SHAFTS|' || coalesce(string_agg(text, ' / '), 'nothing') from event where world_id = w and uid = me;
  perform gather(w, me, 'log', 3, 30, 'Pine');
  insert into said values ('PULLED|' || (select coalesce(sum(count), 0) from item where placed = v_cart and def = 'log')
    || ',' || pack_count(w, me, 'log'));
  update placed set puller = null where id = v_cart;

  -- In a boat, and on foot.
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by, driver)
    values (w, 'furniture', 'rowing_boat', v_x - 1, v_y - 1, 0, 0, v_x - 0.5, v_y - 0.5, 40, 'Pine', me, me)
    returning id into v_boat;
  perform gather(w, me, 'log', 2, 30, 'Pine');
  insert into said values ('BOAT|' || (select coalesce(sum(count), 0) from item where placed = v_boat and def = 'log')
    || ',' || pack_count(w, me, 'log'));
  update placed set driver = null where id = v_boat;
  perform gather(w, me, 'log', 1, 30, 'Pine');
  insert into said values ('FOOT|' || pack_count(w, me, 'log'));
end $$;
select * from said;
rollback;
`);
const said = (key: string): string =>
  isle.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

console.log('--- the island');
check('there is somewhere to dig', said('SPOT') !== 'MISSING' && !said('SPOT').includes('null'), said('SPOT'));
check('driving a wagon, it is the cart you are working from', said('CART') === 'true', said('CART'));
const [dug, packed] = said('DIG').split(',').map(Number);
check('what a dig brings up goes into the wagon, and nothing into the pack', dug >= 3 && packed === 0,
  `${dug} dirt in the wagon, ${packed} in the pack`);
check('a wagon two short of full takes two, and the rest goes in the pack', said('FULL') === '2,8', said('FULL'));
check('and it says the wagon is full once, not once a swing', said('SAID') === '1', said('SAID'));
check('a creel\'s catch goes the same way', said('CREEL') === '4,0', said('CREEL'));
check('taking hold of a small cart says what you gather goes into it',
  said('SHAFTS').includes('It will follow you now, and what you gather goes into it.'), said('SHAFTS'));
check('pulling a small cart, what you gather goes into it', said('PULLED') === '3,0', said('PULLED'));
check('in a boat it goes in the pack', said('BOAT') === '0,2', said('BOAT'));
check('and on foot, as it always did', said('FOOT') === '3', said('FOOT'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`what you gather goes in the cart — ${ok.length} of ${ok.length}`);
