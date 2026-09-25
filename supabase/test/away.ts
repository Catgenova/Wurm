/**
 * While you were away.
 *
 * Asked for: "'While you were away' on login. Summarise what your workers
 * gathered, births, stall sales and parcels."
 *
 * The browser half: the lines a count turns into, with what they say derived
 * from the same rules and names the rest of the game uses.
 *
 * The island half, through the real paths, as Dane on the suite's Hoarding
 * with somebody new, Cato, beside him:
 *
 *   * a sale off Dane's stall while he is there is not counted -- he saw it;
 *   * once he has gone, two sales are, with their silver; a parcel Cato posts
 *     him is, under Cato's name; a young one born to his rabba that follows
 *     him is, and a second that has nowhere to go and goes off into the wild
 *     is counted as that; and two loads a worker of his puts into a store are
 *     counted together, as items;
 *   * coming back, `rpc_join` hands over every count and how long he was
 *     gone, and forgets them: the table is empty after, and a second join
 *     straight away has nothing to say;
 *   * and the lines the browser makes of that answer say all of it.
 *
 * Runs against the database the suite leaves behind, in a transaction that is
 * rolled back.
 */
import { execFileSync } from 'node:child_process';
import { AWAY_NAMED, awayFor, awayLines, type Away } from '../../src/game/away';
import { priceWords } from '../../src/game/money';

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

console.log('--- the browser');
check('nothing counted, nothing said', awayLines({ secs: 7200, tally: [] }).length === 0);
check('a length of time as anybody says it',
  awayFor(59) === '1 minute' && awayFor(3600) === '1 hour' && awayFor(11520) === '3 hours and 12 minutes'
    && awayFor(90000) === '1 day and 1 hour' && awayFor(172800) === '2 days',
  [59, 3600, 11520, 90000, 172800].map(awayFor).join(' | '));

const many: Away = {
  secs: 11520,
  tally: ['log', 'plank', 'clay', 'sand', 'dirt', 'reed', 'peat', 'tar'].map((def, i) => ({ what: 'haul', def, n: 20 - i, silver: 0 })),
};
const manyLines = awayLines(many);
check('the first line says for how long', manyLines[0] === 'You were away 3 hours and 12 minutes.', manyLines[0]);
check(`a line names ${AWAY_NAMED} sorts, most first, and counts the rest`,
  manyLines[1] === 'Your workers put 20 × log, 19 × plank, 18 × clay, 17 × sand, 16 × dirt, 15 × reed and 2 more sorts into the stores.',
  manyLines[1]);

const sales: Away = {
  secs: 600,
  tally: [
    { what: 'sold', def: 'plank', n: 2, silver: 9 },
    { what: 'sold', def: 'hatchet', n: 1, silver: 14 },
    { what: 'parcel', def: 'Bryn', n: 1, silver: 0 },
  ],
};
const saleLines = awayLines(sales);
check('sales are summed into one price, in coins',
  saleLines[1] === `Your stalls sold 2 × plank and 1 × hatchet for ${priceWords(23)}. It is in their tills.`, saleLines[1]);
check('one parcel is one parcel, and who from', saleLines[2] === 'A parcel from Bryn waits for you at any mailbox.', saleLines[2]);

console.log('--- the island');
const out = psql(`
begin;
create temp table said (k text);
do $b$
declare w uuid; a uuid; b uuid := 'a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4';
        ax double precision; ay double precision; d deed;
        v_stall bigint; v_plank bigint; v_plank2 bigint; v_shaft bigint; v_gift bigint;
        v_dam int; v_who creature; v_crate int; r record; v_join jsonb;
begin
  select id into w from world where name = 'Hoarding';
  select uid, x, y into a, ax, ay from player where world_id = w and name = 'Dane';
  select * into d from deed where world_id = w and founded_by = a limit 1;
  update player set act = null, act_queue = '[]'::jsonb, away = false where world_id = w and uid = a;
  -- Nothing left over from anything before: what is counted here is this test's.
  delete from away_tally where world_id = w and uid = a;
  insert into player (world_id, uid, name, x, y) values (w, b, 'Cato', ax + 1, ay);
  perform give_coins(w, b, 50);

  -- A stall of Dane's with three things priced on it, and a mailbox beside it.
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by)
    values (w, 'furniture', 'stall', floor(ax)::int, floor(ay)::int, 0, 0, floor(ax)::int + 0.5, floor(ay)::int + 0.5, a)
    returning id into v_stall;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by)
    values (w, 'furniture', 'mailbox', floor(ax)::int, floor(ay)::int, 2, 2, floor(ax)::int + 0.75, floor(ay)::int + 0.75, a);
  insert into item (world_id, holder, def, ql, count, placed, price)
    values (w, 'furniture', 'plank', 30, 1, v_stall, 5) returning id into v_plank;
  insert into item (world_id, holder, def, ql, count, placed, price)
    values (w, 'furniture', 'plank', 30, 1, v_stall, 6) returning id into v_plank2;
  insert into item (world_id, holder, def, ql, count, placed, price)
    values (w, 'furniture', 'shaft', 30, 3, v_stall, 4) returning id into v_shaft;

  -- Bought while Dane is there to see it.
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  perform rpc_buy(w, v_plank);
  insert into said values ('HERE|' || (select count(*) from away_tally where world_id = w and uid = a));

  -- Dane goes home, three hours ago.
  update player set away = true, left_at = now() - interval '3 hours', seen_at = now() - interval '3 hours'
    where world_id = w and uid = a;
  insert into said values ('BUY1|' || coalesce(rpc_buy(w, v_plank2)->>'why', 'bought'));
  insert into said values ('BUY2|' || coalesce(rpc_buy(w, v_shaft)->>'why', 'bought'));
  v_gift := give(w, b, 'rope', 1, 30);
  insert into said values ('POST|' || coalesce(rpc_parcel(w, a, 'For you.', array[v_gift])->>'why', 'posted'));

  -- Two young ones to a rabba of his: the first follows him, and the second,
  -- with the first already following and no empty crate anywhere, goes wild.
  update creature set mode = 'stored' where world_id = w and keeper = a and mode = 'active';
  delete from item where world_id = w and holder = 'player' and holder_uid = a
    and def = 'creature_crate' and creature is null;
  delete from placed where world_id = w and kind = 'furniture' and sub = 'creature_crate'
    and creature is null and made_by = a;
  v_dam := creature_spawn(w, 'rabba', ax, ay, 'stored', now() - interval '3 hours', a);
  update creature set sex = 'female', unborn = '{"traits": [], "sex": "male"}'::jsonb, due = now() - interval '1 second'
    where world_id = w and id = v_dam;
  insert into said values ('BORN1|' || give_birth(w, v_dam));
  update creature set unborn = '{"traits": [], "sex": "female"}'::jsonb, due = now() - interval '1 second'
    where world_id = w and id = v_dam;
  insert into said values ('BORN2|' || give_birth(w, v_dam));

  -- Two loads a worker of his puts away: a crate on the settlement for them
  -- to go in, and the worker standing at wherever it would take them.
  select coalesce(max(id), 0) + 1 into v_crate from crate where world_id = w;
  insert into crate (world_id, id, kind, x, y, sx, sy, deed)
    select w, v_crate, kind, d.x, d.y, 0, 0, false from crate_def limit 1;
  select * into v_who from creature c where c.world_id = w and c.keeper = a and c.mode = 'deed' limit 1;
  select * into r from worker_store(w, v_who, 'log', 1);
  insert into said values ('STORE|' || coalesce(r.kind, 'nowhere'));
  for i in 1..2 loop
    update creature set from_x = r.cx, from_y = r.cy, to_x = r.cx, to_y = r.cy, post = null,
        phase = 'home', carrying = jsonb_build_object('def', 'log', 'count', i, 'ql', 30, 'extra', 'oak'),
        leg_at = now() - interval '1 second', leg_ends = now() - interval '1 second',
        until = now() - interval '0.5 seconds', settled_at = now()
      where world_id = w and id = v_who.id;
    perform worker_settle(w, v_who.id);
  end loop;
  insert into said values ('HAULED|' || coalesce((select carrying::text from creature where world_id = w and id = v_who.id), 'put away'));

  -- And back.
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  v_join := rpc_join(w, null);
  insert into said values ('JOIN|' || coalesce(v_join->'away', 'null'::jsonb)::text);
  insert into said values ('LEFT|' || (select count(*) from away_tally where world_id = w and uid = a));
  insert into said values ('AGAIN|' || coalesce(rpc_join(w, null)->'away', 'null'::jsonb)::text);
end $b$;
select k from said;
rollback;
`);

const said = (key: string): string => out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? '';

check('a sale while you are there is not counted', said('HERE') === '0', said('HERE'));
check('a sale while you are away goes through', said('BUY1') === 'bought' && said('BUY2') === 'bought', `${said('BUY1')}, ${said('BUY2')}`);
check('and so does a parcel', said('POST') === 'posted', said('POST'));
check('two young ones are born', Number(said('BORN1')) > 0 && Number(said('BORN2')) > 0, `${said('BORN1')}, ${said('BORN2')}`);
check('a worker has somewhere to put a load', said('STORE') !== 'nowhere', said('STORE'));
check('and puts both of them away', said('HAULED') === 'put away', said('HAULED'));

let away: Away | null = null;
try {
  away = JSON.parse(said('JOIN')) as Away | null;
} catch {
  away = null;
}
const row = (what: string, def: string) => away?.tally.find((t) => t.what === what && t.def === def);
check('coming back hands the counts over', !!away && Array.isArray(away.tally), said('JOIN'));
check('with how long you were gone', !!away && Math.abs(away.secs - 3 * 3600) <= 5, String(away?.secs));
check('both sales, with what they took', row('sold', 'plank')?.n === 1 && row('sold', 'plank')?.silver === 6
  && row('sold', 'shaft')?.n === 3 && row('sold', 'shaft')?.silver === 4, JSON.stringify(away?.tally.filter((t) => t.what === 'sold')));
check('the parcel, under the sender\'s name', row('parcel', 'Cato')?.n === 1, JSON.stringify(row('parcel', 'Cato')));
check('the young one that follows you', row('born', 'rabba')?.n === 1, JSON.stringify(row('born', 'rabba')));
check('and the one that went off into the wild', row('strayed', 'rabba')?.n === 1, JSON.stringify(row('strayed', 'rabba')));
check('the two loads, counted together as items', row('haul', 'log')?.n === 3, JSON.stringify(row('haul', 'log')));
check('and nothing else', away?.tally.length === 6, String(away?.tally.length));
check('and then it is forgotten', said('LEFT') === '0', said('LEFT'));
check('so a second join straight after has nothing to say', said('AGAIN') === 'null', said('AGAIN'));

const lines = away ? awayLines(away) : [];
check('the browser says how long', lines[0] === 'You were away 3 hours.', lines[0]);
check('and all five of them', lines.length === 6, lines.join(' / '));
check('the loads', lines.includes('Your workers put 3 × log into the stores.'), lines[1]);
check('the young', lines.includes('Born to your wildermon: 1 rabba.'), lines[2]);
check('the sales, summed', lines.includes(`Your stalls sold 3 × shaft and 1 × plank for ${priceWords(10)}. It is in their tills.`), lines[4]);
check('and the parcel', lines.includes('A parcel from Cato waits for you at any mailbox.'), lines[5]);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`while you were away — ${ok.length} of ${ok.length}`);
