/**
 * Butchering: learnt by butchering, and the skill decides what comes off.
 *
 * Asked for: "Add the Butchering skill that gains experience from the
 * matching option. Butchering skill determines ql of Butchering output".
 *
 * The skill was in the book and the Butcher action named it, but on an island
 * a go never raised it -- the butcher branch of `perform_fight` had no
 * `skill_raise`, where every other performer has one for its trade -- so a
 * butcher there stayed at 1.00 for good. And the quality of what came off was
 * the skill's product quality times (0.6 + the corpse's quality / 250), which
 * held a butcher at 100 to 66 to 80.
 *
 * Asked of both sides, with a rabba carcass and a butchering knife of QL 100,
 * whose roll always lands, so what comes off is exactly the skill:
 *
 *   * a go raises Butchering;
 *   * everything taken off comes off at the skill, whatever the corpse's own
 *     quality -- at 40 and at 80 alike, from a carcass of QL 10 and of QL 90;
 *   * the log line says the QL;
 *   * and in the browser, the Butcher line on the menu gives the QL range for
 *     the knife in hand, from the same rule: the skill exactly with this knife,
 *     and 0.6 to 1.4 times it, plus 1, bare-handed.
 */
import { execFileSync } from 'node:child_process';
import { Game, productQlRange } from '../../src/game/game';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import { butcherPreview } from '../../src/game/butcher';

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

const PARTS = ['meat', 'fur', 'hide', 'bone', 'gland'];

/* ---- the browser ----------------------------------------------------------- */

const game = Game.create(4242);
const butcher = ACTION_BY_ID.get('butcher')!;
const [x, y] = [game.player.tileX, game.player.tileY];
for (const it of [...game.inventory.items]) if (it.id === 'butchering_knife' || PARTS.includes(it.id)) game.inventory.remove(it.uid, it.count);
game.inventory.add('butchering_knife', { ql: 100 });
const here: Target = { kind: 'ground', x, y, uid: null };

/** One carcass of this quality, butchered at this skill through the whole go, as a player would. */
const go = (skill: number, corpseQl: number): { before: number; after: number; qls: number[]; said: string } => {
  game.skills.values.set('butchering', skill);
  for (const it of [...game.inventory.items]) if (PARTS.includes(it.id)) game.inventory.remove(it.uid, it.count);
  game.dropOnGround(x, y, { uid: game.inventory.nextUid++, id: 'corpse', ql: corpseQl, dmg: 0, count: 1, extra: 'Rabba' });
  const seen = game.log.length;
  const before = game.skills.get('butchering');
  game.requestAction(butcher, here);
  for (let t = 0; t < 400 && game.action; t++) game.update(0.25);
  const qls = game.inventory.items.filter((it) => PARTS.includes(it.id)).map((it) => it.ql);
  const said = game.log.slice(seen).map((l) => l.text).find((l) => l.startsWith('You butcher')) ?? '';
  return { before, after: game.skills.get('butchering'), qls, said };
};

console.log('--- the browser');
const low = go(40, 10);
const high = go(40, 90);
const master = go(80, 10);
check('a go raises Butchering', low.after > low.before, `${low.before.toFixed(2)} → ${low.after.toFixed(2)}`);
check('what comes off a carcass of QL 10 comes off at the skill, 40',
  low.qls.length > 0 && low.qls.every((q) => Math.abs(q - 40) < 1e-9), low.qls.map((q) => q.toFixed(1)).join(', '));
check('and off a carcass of QL 90, the same',
  high.qls.length > 0 && high.qls.every((q) => Math.abs(q - 40) < 1e-9), high.qls.map((q) => q.toFixed(1)).join(', '));
check('a butcher at 80 takes it off at 80',
  master.qls.length > 0 && master.qls.every((q) => Math.abs(q - 80) < 1e-9), master.qls.map((q) => q.toFixed(1)).join(', '));
check('the log line says the QL', / \(QL 80\.0\)\./.test(master.said), master.said);
game.skills.values.set('butchering', 50);
game.dropOnGround(x, y, { uid: game.inventory.nextUid++, id: 'corpse', ql: 30, dmg: 0, count: 1, extra: 'Rabba' });
const corpse = game.groundAt(x, y).find((it) => it.id === 'corpse')!;
check('the menu says the QL for the knife in hand: the skill exactly with this one',
  butcherPreview(game, corpse).endsWith(', at QL 50'), butcherPreview(game, corpse));
for (const it of [...game.inventory.items]) if (it.id === 'butchering_knife') game.inventory.remove(it.uid, it.count);
const [lo, hi] = productQlRange(50, 0);
check('and bare-handed, 0.6 to 1.4 times the skill, plus 1',
  lo === 31 && hi === 71 && butcherPreview(game, corpse).endsWith(', at QL 31–71'), butcherPreview(game, corpse));

/* ---- the island ------------------------------------------------------------ */

const isle = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; me uuid; v_x int; v_y int; aim jsonb; before double precision;
begin
  select id into w from world where name = 'Hoarding';
  select uid into me from player where world_id = w and name = 'Dane';
  select floor(x)::int, floor(y)::int into v_x, v_y from player where world_id = w and uid = me;
  update player set act = null, act_queue = '[]'::jsonb where world_id = w and uid = me;
  delete from item where world_id = w and holder = 'player' and holder_uid = me
    and (def = 'butchering_knife' or def in ('meat', 'fur', 'hide', 'bone', 'gland') or is_bag(def));
  perform give(w, me, 'butchering_knife', 1, 100);
  aim := jsonb_build_object('kind', 'ground', 'x', v_x, 'y', v_y);

  -- At 40, from a carcass of QL 10 and then of QL 90.
  insert into skill (world_id, uid, id, value) values (w, me, 'butchering', 40)
    on conflict (world_id, uid, id) do update set value = 40;
  perform drop_on_ground(w, v_x, v_y, 'corpse', 10, 'Rabba');
  before := skill_of(w, me, 'butchering');
  perform act_perform(w, me, 'butcher', aim);
  insert into said values ('GAIN|' || round(before::numeric, 4) || ',' || round(skill_of(w, me, 'butchering')::numeric, 4));
  insert into said values ('LOW|' || coalesce((select string_agg(distinct round(ql::numeric, 1)::text, ',') from item
    where world_id = w and holder = 'player' and holder_uid = me and def in ('meat', 'fur', 'hide', 'bone', 'gland')), 'nothing'));
  delete from item where world_id = w and holder = 'player' and holder_uid = me and def in ('meat', 'fur', 'hide', 'bone', 'gland');
  update skill set value = 40 where world_id = w and uid = me and id = 'butchering';
  perform drop_on_ground(w, v_x, v_y, 'corpse', 90, 'Rabba');
  perform act_perform(w, me, 'butcher', aim);
  insert into said values ('HIGH|' || coalesce((select string_agg(distinct round(ql::numeric, 1)::text, ',') from item
    where world_id = w and holder = 'player' and holder_uid = me and def in ('meat', 'fur', 'hide', 'bone', 'gland')), 'nothing'));
  delete from item where world_id = w and holder = 'player' and holder_uid = me and def in ('meat', 'fur', 'hide', 'bone', 'gland');

  -- At 80.
  update skill set value = 80 where world_id = w and uid = me and id = 'butchering';
  perform drop_on_ground(w, v_x, v_y, 'corpse', 10, 'Rabba');
  perform act_perform(w, me, 'butcher', aim);
  insert into said values ('MASTER|' || coalesce((select string_agg(distinct round(ql::numeric, 1)::text, ',') from item
    where world_id = w and holder = 'player' and holder_uid = me and def in ('meat', 'fur', 'hide', 'bone', 'gland')), 'nothing'));
  insert into said values ('SAID|' || coalesce((select e.text from event e where e.world_id = w and e.uid = me
    and e.text like 'You butcher%' order by e.n desc limit 1), 'nothing'));
end $$;
select string_agg(k, E'\\n') from said;
rollback;
`);
const said = (key: string): string => isle.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? '(nothing)';

console.log('--- the island');
const [was, now] = said('GAIN').split(',').map(Number);
check('a go raises Butchering, as it never did', now > was, said('GAIN'));
check('what comes off a carcass of QL 10 comes off at the skill, 40', said('LOW') === '40.0', said('LOW'));
check('and off a carcass of QL 90, the same', said('HIGH') === '40.0', said('HIGH'));
check('a butcher at 80 takes it off at 80', said('MASTER') === '80.0', said('MASTER'));
check('the log line says the QL, as the browser\'s does', / \(QL 80\.0\)\./.test(said('SAID')), said('SAID'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`butchering is learnt by butchering, and decides what comes off — ${ok.length} of ${ok.length}`);
