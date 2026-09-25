/**
 * Leaving a settlement you were asked onto, from the settlement itself.
 *
 * Asked for: "add a leave settlement option so citizens can quit oceanport".
 * The island has had `rpc_leave_deed` since citizens landed, and the People
 * window had a Leave line at the foot of its settlement page. The settlement's
 * own menu -- right-click its land -- gave a citizen the founder's menu
 * instead: an upgrade, a new name and disbanding, which the island refuses to
 * anybody but the founder, and no way off the roll. The Settlement window
 * offered the upgrade and nothing else.
 *
 * The ground names a settlement by where its token stands, and the door wants
 * the founder, so the browser asks the social answer which founder that is.
 *
 * Asked of both sides:
 *
 *   * the social answer gives each settlement you belong to with its founder
 *     and its token, and `rollAt` finds the one to leave by the token: not
 *     your own, and not a tile that is not a token;
 *   * a citizen is told the upgrade is the founder's, and the founder is not;
 *   * what you are on a settlement, and what leaving costs, name the
 *     settlement and whose it is;
 *   * and on the island a builder of the other settlement leaves by the
 *     founder the social answer gave: off the roll, no longer handed that
 *     settlement as theirs, told so, the founder told too -- and asked
 *     again, the social answer has nothing there to leave.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { leaveQuestion, standingWord, upgradeReason } from '../../src/game/deed';
import { rollAt, type MyDeed } from '../../src/net/island';

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

/* ---- the island, first: what the social answer says ---------------------- */

const isle = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; boss uuid; cit uuid; social jsonb; left_ jsonb;
begin
  select id into w from world where name = 'Hoarding';
  select founded_by into boss from deed where world_id = w order by founded_at limit 1;
  select p.uid into cit from player p where p.world_id = w and p.uid <> boss
     and not exists (select 1 from deed d where d.world_id = w and d.founded_by = p.uid)
   order by p.uid limit 1;
  delete from deed_member where world_id = w and uid = cit;
  insert into deed_member (world_id, founder, uid, role) values (w, boss, cit, 'builder');
  perform set_config('request.jwt.claims', json_build_object('sub', cit)::text, true);
  insert into said select 'DEED|' || (select jsonb_build_object('name', d.name, 'x', d.x, 'y', d.y, 'founder', d.founded_by)::text
    from deed d where d.world_id = w and d.founded_by = boss);
  social := rpc_social(w);
  insert into said values ('SOCIAL|' || coalesce(social->'deeds', '[]'::jsonb)::text);
  insert into said values ('HANDED|' || coalesce((select d.name from my_deed(w, cit) d where d.world_id is not null), 'none'));

  -- Leave, by the founder the social answer names.
  left_ := rpc_leave_deed(w, (social->'deeds'->0->>'founder')::uuid, null);
  insert into said values ('LEFT|' || left_::text);
  insert into said values ('ROLL|' || exists (select 1 from deed_member m where m.world_id = w and m.founder = boss and m.uid = cit));
  insert into said values ('HANDED_AFTER|' || coalesce((select d.name from my_deed(w, cit) d where d.world_id is not null), 'none'));
  insert into said values ('TOLD|' || coalesce((select e.text from event e where e.world_id = w and e.uid = cit order by e.n desc limit 1), 'nothing'));
  insert into said values ('FOUNDER_TOLD|' || coalesce((select e.text from event e where e.world_id = w and e.uid = boss order by e.n desc limit 1), 'nothing'));
  insert into said values ('SOCIAL_AFTER|' || coalesce(rpc_social(w)->'deeds', '[]'::jsonb)::text);
  insert into said values ('AGAIN|' || rpc_leave_deed(w, boss, null)::text);
end $$;
select string_agg(k, E'\\n') from said;
rollback;
`);
const said = (key: string): string => isle.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? '(nothing)';
const deed = JSON.parse(said('DEED')) as { name: string; x: number; y: number; founder: string };
const social = JSON.parse(said('SOCIAL')) as MyDeed[];
const after = JSON.parse(said('SOCIAL_AFTER')) as MyDeed[];

/* ---- the browser ----------------------------------------------------------- */

console.log('--- finding the settlement to leave');
const found = rollAt(social, deed.x, deed.y);
check('the social answer gives the settlement with its founder and its token, and the token finds it',
  found?.founder === deed.founder && found?.name === deed.name, `${found?.name ?? 'nothing'} by ${found?.by ?? '?'}`);
check('a tile that is not its token finds nothing', rollAt(social, deed.x + 1, deed.y) === undefined);
const own: MyDeed = { ...social[0]!, name: 'Hearth', x: 3, y: 4, mine: true };
check('and a settlement of your own is not one you leave', rollAt([own, ...social], 3, 4) === undefined);

console.log('--- what the settlement says to a citizen');
const game = Game.create(4242);
const oceanport = { name: 'Oceanport', x: game.spawn.x + 20, y: game.spawn.y, radius: 5, level: 1 };
game.deed = { ...oceanport, mine: true, role: 'builder' };
check('a citizen is told the upgrade is the founder\'s', upgradeReason(game) === 'Only whoever founded Oceanport can upgrade it.', upgradeReason(game) ?? 'none');
game.deed = { ...oceanport, name: 'Hearth', mine: true, role: 'founder' };
check('and the founder is not', !(upgradeReason(game) ?? '').startsWith('Only whoever founded'), upgradeReason(game) ?? 'none');
check('what a builder is on it', standingWord('builder') === 'You are a citizen here: you may shape the ground and build on it.', standingWord('builder'));
const q = leaveQuestion({ ...oceanport, role: 'builder' }, 'Somebody');
check('leaving asks first, naming the settlement and who is told',
  q.startsWith('Leave Oceanport? ') && q.includes('Somebody is told') && q.includes('only an invitation puts you back'), q);

/* ---- the island, leaving -------------------------------------------------- */

console.log('--- the island');
check('before leaving, the settlement handed to the citizen is that one', said('HANDED') === deed.name, said('HANDED'));
check('leaving by the founder the social answer named takes you off the roll',
  (JSON.parse(said('LEFT')) as { left?: string }).left === deed.name && said('ROLL') === 'false', `${said('LEFT')}; on the roll: ${said('ROLL')}`);
check('and the settlement is no longer handed to you as yours', said('HANDED_AFTER') === 'none', said('HANDED_AFTER'));
check('you are told', said('TOLD') === `You are no longer a citizen of ${deed.name}.`, said('TOLD'));
check('and so is its founder', said('FOUNDER_TOLD').endsWith(` has left ${deed.name}.`), said('FOUNDER_TOLD'));
check('asked again, the social answer has nothing there to leave', rollAt(after, deed.x, deed.y) === undefined, `${after.length} settlements`);
check('and the door says there is nobody to send away', (JSON.parse(said('AGAIN')) as { why?: string }).why === 'Nobody there to send away.', said('AGAIN'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`leaving a settlement you were asked onto — ${ok.length} of ${ok.length}`);
