/**
 * A field gets sown, and a load goes where there is room for it.
 *
 * Two reports off one afternoon: "seavic isn't planting seeds that are in
 * crates on deed", and "rabba are just overdelivering to the full deed crate
 * instead of bringing anything to the empty crate".
 *
 * Both were the island being thinner than the browser. A browser farm worker
 * has sown since the day fields existed — `farmJobAt` answers `sow` for a
 * field with nothing in it and `seedFor` looks in its own cheeks and then in
 * every store on the settlement — while the island's `worker_gatherable`
 * only ever called a tile work when a crop was already standing on it, so an
 * empty field was never work and nothing ever walked to one. And a browser
 * load goes wherever there is room — `storeFor` takes the settlement's own
 * crate while it has room and the nearest thing that will hold it after —
 * while the island sent every load to `deed_crate` and nowhere else, and a
 * full crate refuses, so the load came home, was refused, and went back out
 * to the fields with it still in its arms.
 *
 * So both questions are put to both sides over the same ground: the same
 * settlement, the same field, the same seed in the same crate, and then the
 * same crate filled to the brim with a second one standing beside it.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { TileType } from '../../src/world/tiles';
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

const W = `(select id from world where name = 'Hoarding')`;
const DANE = `(select uid from player where world_id = ${W} and name = 'Dane')`;
/** The worker, as a creature row, for the island's own rules to be asked about. */
const HAND = `(select c from creature c where c.world_id = ${W} and c.keeper = ${DANE} and c.species = 'seavic' order by c.id desc limit 1)`;

/* ---- the same settlement on both sides ------------------------------------
 * Dane's deed at 30,30 with five tiles of reach; a block of field at 28..31 by
 * 28..31 with nothing growing in it; the settlement's crate at 32,30.
 */
const game = Game.create(4242);
const w = game.world;
for (let y = 26; y <= 36; y++) {
  for (let x = 26; x <= 36; x++) {
    w.setHeight(x, y, 4);
    w.setDirt(x, y, 5);
    w.setTile(x, y, TileType.Grass, 0);
  }
}
for (let y = 28; y <= 31; y++) for (let x = 28; x <= 31; x++) w.setTile(x, y, TileType.Field, 0);
game.deed = { name: 'Hoarding', x: 30, y: 30, radius: 5, level: 1, mine: true };
game.crates.clear();
const own = game.addCrate('plank', 32, 30, 1, 1, [], true);

psql(`
do $$
declare w uuid; u uuid; tx int; ty int;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  for tx in 26..36 loop for ty in 26..36 loop
    perform land_set_height(w, tx, ty, 4); perform land_set_dirt(w, tx, ty, 5);
    perform land_set_tile(w, tx, ty, tile_id('Grass'));
  end loop; end loop;
  for tx in 28..31 loop for ty in 28..31 loop
    perform land_set_tile(w, tx, ty, tile_id('Field'));
  end loop; end loop;
  delete from crop where world_id = w;
  delete from item where world_id = w and def in (select seed from crop_def);
  delete from item i where i.world_id = w and i.holder = 'ground' and i.gx between 26 and 36 and i.gy between 26 and 36;
  delete from item i where i.world_id = w and i.holder = 'crate';
  delete from crate where world_id = w;
  delete from deed where world_id = w;
  insert into deed (world_id, name, x, y, radius, level, founded_by) values (w, 'Hoarding', 30, 30, 5, 1, u);
  insert into crate (world_id, id, kind, x, y, sx, sy, deed, made_by) values (w, 1, 'plank', 32, 30, 1, 1, true, u);
  delete from creature where world_id = w and keeper = u and species = 'seavic';
  perform creature_spawn(w, 'seavic', 30.5, 30.5, 'deed', now() - interval '3 hours', u);
  -- Ten minutes owed, so that one settle is ten minutes of work rather than none.
  update creature set job = 'farm', mode = 'deed', phase = 'idle',
      until = now() - interval '600 seconds', leg_at = now() - interval '600 seconds',
      leg_ends = now() - interval '600 seconds', settled_at = now() - interval '600 seconds'
    where world_id = w and keeper = u and species = 'seavic';
end $$;`);

// A seavic of Dane's, set to the trade its species keeps anyway.
const hand = game.creatures.spawn('seavic', 30.5, 30.5, 'deed', game.rand, game.time - 3600 * 3);
hand.trade = 'farm';

check('the same field on both sides',
  psql(`select count(*) from generate_series(28,31) gx, generate_series(28,31) gy where land_tile(${W}, gx, gy) = tile_id('Field')`) === '16'
    && [...Array(4)].every((_, j) => [...Array(4)].every((_, i) => w.getTile(28 + i, 28 + j) === TileType.Field)),
  'sixteen tiles of it, nothing growing');

/* ---- the sowing ---------------------------------------------------------- */
const noSeed = game.creatures.farmJobAt(game, hand, 29, 29);
check('a bare field with no seed anywhere is not work, in the browser', noSeed === null, `${noSeed}`);
check('nor on the island',
  psql(`select worker_gatherable(${W}, 29, 29, 'farm', ${HAND})`) === 'f');

// Twelve of wheat seed, in the settlement's crate rather than in its cheeks,
// which is the whole of the report.
const seed: Item = { uid: game.inventory.nextUid++, id: 'wheat_seed', ql: 30, dmg: 0, count: 12 };
game.crateAdd(own, seed);
psql(`insert into item (world_id, holder, crate, def, ql, count) select ${W}, 'crate', 1, 'wheat_seed', 30, 12`);

const job = game.creatures.farmJobAt(game, hand, 29, 29);
check('with seed in the crate it is work, in the browser', job === 'sow', `${job}`);
check('and on the island',
  psql(`select worker_gatherable(${W}, 29, 29, 'farm', ${HAND})`) === 't');
check('the island finds the same seed the browser would',
  psql(`select coalesce((sow_seed(${W}, ${HAND}, 29, 29)).def, 'nothing')`) === 'wheat_seed');

// And it comes out of the crate rather than out of thin air: ten minutes of a
// seavic puts seed in the ground and takes it off the shelf.
const sown = Number(psql(`select worker_settle(${W}, (select id from creature where world_id = ${W} and keeper = ${DANE} and species = 'seavic' order by id desc limit 1))`));
const standing = Number(psql(`select count(*) from crop where world_id = ${W}`));
const left = Number(psql(`select coalesce(sum(count), 0) from item where world_id = ${W} and holder = 'crate' and def = 'wheat_seed'`));
check('ten minutes of it sows the field out of the crate', standing > 0 && left < 12 && standing + left === 12,
  `${sown} goes, ${standing} tiles sown and ${left} seed left of twelve`);

/* ---- where a load goes ----------------------------------------------------
 * The settlement's crate filled to the brim, and an empty one beside it.
 */
const spare = game.addCrate('plank', 32, 31, 1, 1, [], false);
const load: Item = { uid: game.inventory.nextUid++, id: 'blueberry', ql: 20, dmg: 0, count: 3 };
const roomy = game.creatures.storeFor(game, hand, load);
check('while the settlement crate has room the load goes in it, in the browser',
  roomy?.deed === true, roomy ? roomy.name : 'nowhere');
psql(`insert into crate (world_id, id, kind, x, y, sx, sy, deed, made_by) select ${W}, 2, 'plank', 32, 31, 1, 1, false, ${DANE}`);
check('and on the island', psql(`select kind || ' ' || id from worker_store(${W}, ${HAND}, 'blueberry', 3)`) === 'crate 1');

// Now fill it. Under the old rule this is where a worker started walking the
// same armful home for ever.
const fill: Item = { uid: game.inventory.nextUid++, id: 'rock_shards', ql: 20, dmg: 0, count: 60 - own.items.reduce((n, it) => n + it.count, 0) };
game.crateAdd(own, fill);
psql(`insert into item (world_id, holder, crate, def, ql, count)
        select ${W}, 'crate', 1, 'rock_shards', 20, crate_capacity(cr) - crate_units(${W}, 1)
        from crate cr where cr.world_id = ${W} and cr.id = 1 and crate_capacity(cr) > crate_units(${W}, 1)`);
const moved = game.creatures.storeFor(game, hand, load);
check('a full settlement crate is passed over for one with room, in the browser',
  moved?.deed === false && moved?.x === spare.x && moved?.y === spare.y, moved ? `${moved.name} at ${moved.x},${moved.y}` : 'nowhere');
check('and on the island', psql(`select kind || ' ' || id from worker_store(${W}, ${HAND}, 'blueberry', 3)`) === 'crate 2');

// And with both full there is nowhere at all, which is a reason to hold a load
// rather than to tip it out on the ground.
const fill2: Item = { uid: game.inventory.nextUid++, id: 'rock_shards', ql: 20, dmg: 0, count: 60 };
game.crateAdd(spare, fill2);
psql(`insert into item (world_id, holder, crate, def, ql, count)
        select ${W}, 'crate', 2, 'rock_shards', 20, crate_capacity(cr) - crate_units(${W}, 2)
        from crate cr where cr.world_id = ${W} and cr.id = 2 and crate_capacity(cr) > crate_units(${W}, 2)`);
check('with every crate full the browser says nowhere', game.creatures.storeFor(game, hand, load) === null);
check('and so does the island', psql(`select count(*) from worker_store(${W}, ${HAND}, 'blueberry', 3)`) === '0');

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not the same on both sides`);
  process.exit(1);
}
console.log(`a field is work when there is seed for it and a load goes where the room is, the same on both sides — ${ok.length} of ${ok.length}`);
