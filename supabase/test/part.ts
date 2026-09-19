/**
 * What fits goes in, and the rest stays in your pack.
 *
 * Asked for: "when trying to put 48 items in a container that has room for 13,
 * deposit 13 and reject the 35."
 *
 * It was all or nothing on both sides and everywhere a thing could be put
 * away — a crate, a chest, a bin, a bag. An armful that would not fit whole
 * came back whole with "the crate is full", and the way through it was to
 * count the difference yourself, split the stack by hand and put in exactly as
 * much as would go, which is arithmetic a game should be doing.
 *
 * The sentence it says afterwards has to be the same sentence on both sides,
 * because a body puts things in crates from the browser and the island is what
 * actually moves the row. So the same crate is built twice — room for exactly
 * thirteen, forty-eight in the pack — and both are asked the same three
 * things: whether it may be done, what happened, and what it said.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID } from '../../src/game/actions';
import { Game } from '../../src/game/game';
import { crateCapacity, crateName, crateSpare, crateUnits } from '../../src/game/crates';

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
const ORE = `(select i.id from item i where i.world_id = ${W} and i.holder = 'player' and i.holder_uid = ${DANE} and i.def = 'iron_ore' order by i.id desc limit 1)`;
const asDane = `select set_config('request.jwt.claims', json_build_object('sub', ${DANE})::text, false);`;

/* ---- one crate with room for thirteen, on both sides ---- */
const game = Game.create(4242);
game.crates.clear();
const crate = game.addCrate('plank', 30, 30, 0, 0, [], false, 'pine');
const ROOM = 13;
game.crateAdd(crate, { uid: game.inventory.nextUid++, id: 'rock_shards', ql: 20, dmg: 0, count: crateCapacity(crate) - ROOM });
game.player.x = 30.1;
game.player.y = 30.1;
const ore = game.inventory.add('iron_ore', { ql: 40, count: 48 });

psql(`
do $$
declare w uuid; u uuid;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  delete from item i where i.world_id = w and i.holder = 'crate';
  delete from crate where world_id = w;
  insert into crate (world_id, id, kind, x, y, sx, sy, deed, made_by, material)
    values (w, 1, 'plank', 30, 30, 0, 0, false, u, 'pine');
  insert into item (world_id, holder, crate, def, ql, count)
    select w, 'crate', 1, 'rock_shards', 20, crate_capacity(c) - ${ROOM} from crate c where c.world_id = w and c.id = 1;
  update player set x = 30.1, y = 30.1 where world_id = w and uid = u;
  delete from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = 'iron_ore';
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'iron_ore', 40, 48);
end $$;`);

check('the same crate on both sides, with room for thirteen',
  psql(`select crate_spare(${W}, c) || '/' || crate_capacity(c) from crate c where c.world_id = ${W}`)
    === `${crateSpare(crate)}/${crateCapacity(crate)}`,
  `room for ${crateSpare(crate)} of ${crateCapacity(crate)}, and 48 in the pack`);

/* ---- forty-eight asked for, thirteen of them taken ---- */
const def = ACTION_BY_ID.get('store_in_crate');
if (!def) throw new Error('there is no store_in_crate any more');
const target = { kind: 'item' as const, uid: ore.uid, count: 48, into: crate.id };
const mine = def.check?.(target, game) ?? 'ALLOWED';
const theirs = psql(`select coalesce(act_refusal(${W}, ${DANE}, 'store_in_crate',
  jsonb_build_object('kind', 'item', 'uid', ${ORE}, 'count', 48, 'into', 1)), 'ALLOWED')`);
check('putting forty-eight into room for thirteen is allowed rather than refused',
  mine === 'ALLOWED' && theirs === 'ALLOWED', `browser "${mine}", island "${theirs}"`);

const said: string[] = [];
game.logMsg = ((text: string) => { said.push(text); }) as Game['logMsg'];
def.perform?.(target, game);
psql(`${asDane} select rpc_act(${W}, 'store_in_crate', jsonb_build_object('kind', 'item', 'uid', ${ORE}, 'count', 48, 'into', 1), 1);`);

const theirCrate = psql(`select crate_units(${W}, 1) || '/' || crate_capacity(c) from crate c where c.world_id = ${W} and c.id = 1`);
const theirPack = psql(`select coalesce(sum(count), 0) from item i where i.world_id = ${W} and i.holder = 'player' and i.holder_uid = ${DANE} and i.def = 'iron_ore'`);
check('thirteen went in and the crate is full',
  crateUnits(crate) === crateCapacity(crate) && theirCrate === `${crateCapacity(crate)}/${crateCapacity(crate)}`,
  `browser ${crateUnits(crate)}/${crateCapacity(crate)}, island ${theirCrate}`);
check('and the other thirty-five are still in the pack',
  (game.inventory.count('iron_ore')) === 35 && theirPack === '35',
  `browser ${game.inventory.count('iron_ore')}, island ${theirPack}`);

const theirLine = psql(`select text from event where world_id = ${W} and uid = ${DANE} order by n desc limit 1`);
check('and both sides say so in the same sentence',
  said[said.length - 1] === theirLine
    && theirLine === `You put 13 × iron ore in the ${crateName(crate).toLowerCase()}. The other 35 would not fit.`,
  `browser "${said[said.length - 1]}", island "${theirLine}"`);

/* ---- and a crate with no room at all still refuses, by name ---- */
const full = def.check?.({ kind: 'item', uid: ore.uid, count: 35, into: crate.id }, game) ?? 'ALLOWED';
const theirFull = psql(`select coalesce(act_refusal(${W}, ${DANE}, 'store_in_crate',
  jsonb_build_object('kind', 'item', 'uid', ${ORE}, 'count', 35, 'into', 1)), 'ALLOWED')`);
check('a crate with no room at all refuses, and names itself',
  full === `The ${crateName(crate).toLowerCase()} is full.` && theirFull === full,
  `browser "${full}", island "${theirFull}"`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not the same on both sides`);
  process.exit(1);
}
console.log(`a put takes what there is room for and leaves the rest, the same on both sides — ${ok.length} of ${ok.length}`);
