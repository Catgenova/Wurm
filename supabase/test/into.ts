/**
 * The store you aimed at is the store it goes in.
 *
 * Reported with a crate rack on the screen and eight plank crates standing on
 * it: "container inventories need to update visually live on the browser. they
 * show as empty when transferring in items. also on the crate rack, trying to
 * place any items in any of the pine crates gives an error that the maple
 * crate is full."
 *
 * One cause under both halves. Putting a thing into a container never said
 * which container: `store_in_crate` took the nearest crate and
 * `store_in_furniture` the nearest store, on both sides, so the ask meant
 * "whatever is closest" however carefully you had opened one crate and dragged
 * the thing into its window. A crate standing on its own is its own nearest
 * and nobody ever noticed. A rack stands eight on one tile — so every put went
 * into the one nearest the feet, the crate on the screen stayed empty, and
 * once that one was full every put came back refused in its name.
 *
 * So the ask carries the store, and this puts the two sides' answers side by
 * side over the same pair of crates: one full maple and one empty pine on the
 * same tile, a stack of planks in hand, and the same three questions.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID } from '../../src/game/actions';
import { Game } from '../../src/game/game';
import { crateCapacity, crateName, crateUnits } from '../../src/game/crates';
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

/* ---- the same two crates on both sides ------------------------------------
 * A tile at 30,30, a maple crate filled to the brim on the near corner of it
 * and an empty pine crate on the far corner, and a body standing at the maple
 * with ten planks in its pack. Which is a crate rack, in miniature.
 */
const game = Game.create(4242);
const w = game.world;
for (let y = 28; y <= 33; y++) for (let x = 28; x <= 33; x++) {
  w.setHeight(x, y, 4);
  w.setTile(x, y, TileType.Grass, 0);
}
game.crates.clear();
const maple = game.addCrate('plank', 30, 30, 0, 0, [], false, 'maple');
const pine = game.addCrate('plank', 30, 30, 3, 3, [], false, 'pine');
game.crateAdd(maple, { uid: game.inventory.nextUid++, id: 'rock_shards', ql: 20, dmg: 0, count: crateCapacity(maple) });
game.player.x = 30.1;
game.player.y = 30.1;
const planks = game.inventory.add('plank', { ql: 40, count: 10 });

psql(`
do $$
declare w uuid; u uuid; tx int; ty int;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  for tx in 28..33 loop for ty in 28..33 loop
    perform land_set_height(w, tx, ty, 4);
    perform land_set_tile(w, tx, ty, tile_id('Grass'));
  end loop; end loop;
  delete from item i where i.world_id = w and i.holder = 'crate';
  delete from crate where world_id = w;
  insert into crate (world_id, id, kind, x, y, sx, sy, deed, made_by, material) values
    (w, 1, 'plank', 30, 30, 0, 0, false, u, 'maple'),
    (w, 2, 'plank', 30, 30, 3, 3, false, u, 'pine');
  insert into item (world_id, holder, crate, def, ql, count)
    select w, 'crate', 1, 'rock_shards', 20, crate_capacity(c) from crate c where c.world_id = w and c.id = 1;
  update player set x = 30.1, y = 30.1 where world_id = w and uid = u;
  delete from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = 'plank';
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'plank', 40, 10);
end $$;`);
/** Signed in as Dane, because every psql here is its own session. */
const asDane = `select set_config('request.jwt.claims', json_build_object('sub', ${DANE})::text, false);`;
const PLANK = `(select i.id from item i where i.world_id = ${W} and i.holder = 'player' and i.holder_uid = ${DANE} and i.def = 'plank' order by i.id desc limit 1)`;
const refusal = (into?: number): string =>
  psql(`select coalesce(act_refusal(${W}, ${DANE}, 'store_in_crate',
    jsonb_build_object('kind', 'item', 'uid', ${PLANK}, 'count', 10${into === undefined ? '' : `, 'into', ${into}`})), 'ALLOWED')`);

check('the same two crates on both sides',
  psql(`select crate_name(c) || ' ' || crate_units(${W}, c.id) || '/' || crate_capacity(c) from crate c where c.world_id = ${W} order by c.id`)
    === `${crateName(maple)} ${crateUnits(maple)}/${crateCapacity(maple)}\n${crateName(pine)} ${crateUnits(pine)}/${crateCapacity(pine)}`,
  `${crateName(maple)} full and ${crateName(pine)} empty on one tile`);

/* ---- the three questions ------------------------------------------------- */
const def = ACTION_BY_ID.get('store_in_crate');
if (!def) throw new Error('there is no store_in_crate any more');
const mine = (into?: number): string =>
  def.check?.({ kind: 'item', uid: planks.uid, count: 10, ...(into === undefined ? {} : { into }) }, game) ?? 'ALLOWED';

// Naming none is what an item's own menu means: the nearest, which is the
// maple, which is full. This is the sentence that was reported, and it is the
// right sentence for this ask.
check('naming no crate takes the nearest, and says so when it is full',
  mine() === 'The plank crate (maple) is full.' && refusal() === mine(),
  `browser "${mine()}", island "${refusal()}"`);

check('naming the empty pine crate goes through',
  mine(pine.id) === 'ALLOWED' && refusal(2) === 'ALLOWED');

check('naming the full maple crate is refused in the maple crate\'s name',
  mine(maple.id) === 'The plank crate (maple) is full.' && refusal(1) === mine(maple.id),
  `browser "${mine(maple.id)}", island "${refusal(1)}"`);

/* ---- and the planks land in the crate that was named --------------------- */
def.perform?.({ kind: 'item', uid: planks.uid, count: 10, into: pine.id }, game);
psql(`${asDane} select rpc_act(${W}, 'store_in_crate', jsonb_build_object('kind', 'item', 'uid', ${PLANK}, 'count', 10, 'into', 2), 1)`);
const island = psql(`select crate_units(${W}, 1) || '/' || crate_units(${W}, 2)`);
check('the planks are in the crate that was named, not the one underfoot',
  crateUnits(pine) === 10 && crateUnits(maple) === crateCapacity(maple) && island === `${crateUnits(maple)}/10`,
  `browser maple ${crateUnits(maple)} pine ${crateUnits(pine)}, island ${island}`);
check('and both sides say the same thing about it',
  psql(`select text from event where world_id = ${W} and uid = ${DANE} order by n desc limit 1`)
    === 'You put 10 × plank in the plank crate (pine).',
  psql(`select text from event where world_id = ${W} and uid = ${DANE} order by n desc limit 1`));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not the same on both sides`);
  process.exit(1);
}
console.log(`a thing goes into the container you put it in rather than the one nearest your feet, on both sides — ${ok.length} of ${ok.length}`);
