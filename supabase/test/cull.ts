/**
 * Seed that does not stay in a worker's cheeks, and a way to put one down.
 *
 * Two asks off one message. "Seavics also move seeds to storage if not using
 * them when working deed": a farm hand harvested all season and put nothing
 * but the crop in the crate. The seed went somewhere neither side showed —
 * into the browser's `pouch`, which is a field on the creature and nothing a
 * person can open, and into the furrow on the island, where the next sowing
 * took one and the rest lay under the growing crop for ever.
 *
 * Both sides now treat that seed as a load like any other: the pouch is
 * emptied at the next store the worker stands at, and a sown field with seed
 * lying on it is a tile worth walking to. The two halves are shaped
 * differently because the seed sits in a different place on each, so what is
 * asked here is the outcome, which is the same: it ends up in the crate.
 *
 * And then "add a cull option on tamed wildermon to kill them with one
 * action". There has always been exactly one way to kill something you keep,
 * which was to swing at it until it stopped — the same fight you would give
 * something wild, against your own livestock. One action now, with the same
 * carcass at the end of it.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { Game } from '../../src/game/game';
import { execFileSync } from 'node:child_process';
import { CREATURE_ACTION_BY_ID } from '../../src/game/creatureActions';
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
const HAND_ID = `(select c.id from creature c where c.world_id = ${W} and c.keeper = ${DANE} and c.species = 'seavic' order by c.id desc limit 1)`;
const HAND = `(select c from creature c where c.world_id = ${W} and c.keeper = ${DANE} and c.species = 'seavic' order by c.id desc limit 1)`;

/* ---- the same settlement on both sides ------------------------------------
 * Dane's deed at 30,30, one field at 29,29 with a wheat crop standing on it
 * already weeded, and the settlement's crate at 32,30. Six wheat seed in the
 * furrow at 29,29 on the island; the same six in the seavic's cheeks in the
 * browser, which is where that side keeps them.
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
w.setTile(29, 29, TileType.Field, 0);
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
  perform land_set_tile(w, 29, 29, tile_id('Field'));
  delete from crop where world_id = w;
  delete from item i where i.world_id = w and i.holder = 'ground' and i.gx between 26 and 36 and i.gy between 26 and 36;
  delete from item i where i.world_id = w and i.holder = 'crate';
  delete from crate where world_id = w;
  delete from deed where world_id = w;
  insert into deed (world_id, name, x, y, radius, level, founded_by) values (w, 'Hoarding', 30, 30, 5, 1, u);
  insert into crate (world_id, id, kind, x, y, sx, sy, deed, made_by) values (w, 1, 'plank', 32, 30, 1, 1, true, u);
  -- A crop standing and weeded: nothing to sow here, nothing to tend, and
  -- nine hundred seconds off ripe, so nothing to reap either.
  insert into crop (world_id, x, y, id, stage, stage_at, tended, tended_now, ql, sown_by)
    values (w, 29, 29, 'wheat', 0, now(), 1, true, 40, u);
  -- And the seed the last harvest left in the furrow.
  insert into item (world_id, holder, gx, gy, def, ql, count)
    values (w, 'ground', 29, 29, 'wheat_seed', 40, 6);
  delete from creature where world_id = w and keeper = u and species = 'seavic';
  perform creature_spawn(w, 'seavic', 30.5, 30.5, 'deed', now() - interval '3 hours', u);
  update creature set job = 'farm', mode = 'deed', phase = 'idle',
      until = now() - interval '200 seconds', leg_at = now() - interval '200 seconds',
      leg_ends = now() - interval '200 seconds', settled_at = now() - interval '200 seconds'
    where world_id = w and keeper = u and species = 'seavic';
end $$;`);

const hand = game.creatures.spawn('seavic', 30.5, 30.5, 'deed', game.rand, game.time - 3600 * 3);
hand.trade = 'farm';
hand.pouch = { uid: game.inventory.nextUid++, id: 'wheat_seed', ql: 40, dmg: 0, count: 6 };

/* ---- the seed the field has no use for ----------------------------------- */
check('the island calls a sown field with loose seed on it work',
  psql(`select worker_gatherable(${W}, 29, 29, 'farm', ${HAND})`) === 't');
check('and a bare tile with none is nothing to walk to',
  psql(`select worker_gatherable(${W}, 30, 29, 'farm', ${HAND})`) === 'f');

// What the job itself is worth: the seed, in the arms, not a sowing.
const load = psql(`
  update creature set work_x = 29, work_y = 29 where world_id = ${W} and id = ${HAND_ID};
  select coalesce(worker_do(${W}, ${HAND_ID})::text, 'nothing');`).trim();
check('and doing it puts the seed in its arms', load.includes('wheat_seed') && load.includes('"count": 6'), load);
check('leaving nothing in the furrow',
  psql(`select count(*) from item where world_id = ${W} and holder = 'ground' and gx = 29 and gy = 29`) === '0');
check('and the crop standing where it was',
  psql(`select count(*) from crop where world_id = ${W} and x = 29 and y = 29`) === '1');

// Put it back and let the worker run the whole trip for itself.
psql(`
  delete from item where world_id = ${W} and holder = 'crate';
  insert into item (world_id, holder, gx, gy, def, ql, count)
    values (${W}, 'ground', 29, 29, 'wheat_seed', 40, 6);
  update creature set work_x = null, work_y = null, carrying = null, phase = 'idle',
      until = now() - interval '200 seconds', settled_at = now() - interval '200 seconds'
    where world_id = ${W} and id = ${HAND_ID};
  select worker_settle(${W}, ${HAND_ID});`);
const inCrate = psql(`select coalesce(sum(count), 0) from item where world_id = ${W} and holder = 'crate' and def = 'wheat_seed'`);
check('three minutes of a seavic carries it home to the crate', inCrate === '6', `${inCrate} of six`);

/*
 * And the browser, where the seed sits in the creature instead of the ground.
 * Same question, same answer: it should be in the crate and not in its mouth.
 */
let ticks = 0;
const seedInCrate = (): number => own.items.filter((it) => it.id === 'wheat_seed').reduce((n, it) => n + it.count, 0);
while (ticks < 1200 && seedInCrate() === 0) {
  game.update(0.2);
  ticks += 1;
}
check('and the browser empties its cheeks into the same crate', hand.pouch === null && seedInCrate() === 6,
  `${hand.pouch ? `${hand.pouch.count} still in its mouth` : 'mouth empty'}, ${seedInCrate()} in the crate after ${(ticks * 0.2).toFixed(0)}s`);
check('with nothing tipped out on the ground on the way',
  game.groundAt(29, 29).length === 0 && game.groundAt(32, 30).length === 0);

/* ---- a cull ---------------------------------------------------------------
 * A Rabba of Dane's, stood next to him, and one action.
 */
const cull = CREATURE_ACTION_BY_ID.get('cull_creature');
if (!cull) throw new Error('no cull action');
check('the island was told about the action',
  psql(`select label || ' ' || instant from action_def where id = 'cull_creature'`) === 'Cull true');
check('and lets it through the creature door', psql(`select creature_action('cull_creature')`) === 't');

const pet = game.creatures.spawn('rabba', 31.5, 30.5, 'active', game.rand, game.time - 3600);
pet.name = 'Nubbin';
const target = { kind: 'creature' as const, id: pet.id };
check('it applies to one you keep', cull.applies(target, game));
check('and asks before it happens', (cull.confirms?.(target, game) ?? '').includes('Nubbin'),
  `${cull.confirms?.(target, game)}`);

const wild = game.creatures.spawn('rabba', 33.5, 30.5, 'wild', game.rand, game.time - 3600);
check('and never to something wild', !cull.applies({ kind: 'creature', id: wild.id }, game));
check('which it says in so many words',
  (cull.check?.({ kind: 'creature', id: wild.id }, game) ?? '').includes('Fight it'),
  `${cull.check?.({ kind: 'creature', id: wild.id }, game)}`);

cull.perform(target, game);
check('the browser puts it down where it stood', !game.creatures.get(pet.id));
check('and leaves a carcass for the knife',
  game.groundAt(31, 30).some((it) => it.id === 'corpse'), `${game.groundAt(31, 30).map((it) => it.id).join(', ')}`);

/* ---- and the same on the island ------------------------------------------ */
psql(`
do $$
declare w uuid; u uuid; c int;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  delete from creature where world_id = w and keeper = u and species = 'rabba';
  delete from item i where i.world_id = w and i.holder = 'ground' and i.gx = 31 and i.gy = 30;
  perform creature_spawn(w, 'rabba', 31.5, 30.5, 'active', now() - interval '1 hour', u);
  update creature set name = 'Nubbin', settled_at = now(), until = now(),
      from_x = 31.5, from_y = 30.5, to_x = 31.5, to_y = 30.5, leg_at = now(), leg_ends = now()
    where world_id = w and keeper = u and species = 'rabba';
  update player set x = 31.5, y = 30.5 where world_id = w and uid = u;
end $$;`);
const PET = `(select c.id from creature c where c.world_id = ${W} and c.keeper = ${DANE} and c.species = 'rabba' order by c.id desc limit 1)`;
const petTarget = `jsonb_build_object('kind', 'creature', 'id', ${PET})`;
check('the island refuses nobody nothing when it is yours and you are beside it',
  psql(`select coalesce(creature_refusal(${W}, ${DANE}, 'cull_creature', ${petTarget}), 'nothing')`) === 'nothing');

/*
 * And not from across the island. Asked of the seavic rather than the rabba,
 * because a companion is wherever its keeper is: walking away from one of
 * those walks it along with you, which is the right answer to a different
 * question.
 */
const away = psql(`
  update player set x = 60, y = 60 where world_id = ${W} and uid = ${DANE};
  select coalesce(creature_refusal(${W}, ${DANE}, 'cull_creature',
    jsonb_build_object('kind', 'creature', 'id', ${HAND_ID})), 'nothing');
  update player set x = 31.5, y = 30.5 where world_id = ${W} and uid = ${DANE};`).trim();
check('and will not have it done from across the island', away.includes('Stand next to'), away);

psql(`select perform_creature(${W}, ${DANE}, 'cull_creature', ${petTarget})`);
check('one action and it is gone',
  psql(`select count(*) from creature where world_id = ${W} and keeper = ${DANE} and species = 'rabba'`) === '0');
check('with a carcass on the tile it stood on',
  psql(`select count(*) from item where world_id = ${W} and holder = 'ground' and gx = 31 and gy = 30 and def = 'corpse'`) === '1');
check('and the line said so rather than calling it a wild kill',
  psql(`select text from event where world_id = ${W} and uid = ${DANE} order by n desc limit 1`).includes('You put Nubbin down'),
  psql(`select text from event where world_id = ${W} and uid = ${DANE} order by n desc limit 1`));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not the same on both sides`);
  process.exit(1);
}
console.log(`seed goes to the crate and one you keep can be put down in one action — ${ok.length} of ${ok.length}`);
