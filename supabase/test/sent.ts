/**
 * Live updates over Broadcast: what the island sends, to whom, and who may
 * listen.
 *
 * Asked for: "Live updates over Supabase Broadcast. Realtime's constant
 * reading of the database's change log is its second-biggest single query.
 * Sending updates as Broadcast messages instead would remove it."
 *
 * The island now writes its own messages with `realtime.send`, once a
 * statement. Locally `realtime.send` keeps the row it would have sent (see
 * supabase/local/00_shim.sql), so this reads back what went out, on the
 * suite's four-thousand-tile Bigness with Ivar the only one not away:
 *
 *   * a tile changed where he stands goes to his block with the row in it,
 *     and one in the block beside him goes too;
 *   * one eight blocks off goes nowhere, nor does one under him once he is
 *     away;
 *   * a hundred and fifty changed in his block in one statement are one
 *     message, which says only how far the island has got;
 *   * a line to him goes to his own topic, a line to everybody to the
 *     island's, and a line to somebody away nowhere;
 *   * a thing into his pack goes to his own topic as what is in it now, and
 *     out of it (put down, or gone) as its id; somebody away's pack sends
 *     nothing;
 *   * `private.hears` lets him listen to the island's land and lines and his
 *     own topic, and to nobody else's, no other island's and nothing
 *     misspelt -- and the policy on `realtime.messages` says the same;
 *   * `rpc_join` says the island sends; the six tables are out of the
 *     publication; and `private.shut` and `private.lock_doors` are not a
 *     signed-in body's to run.
 *
 * Runs against the database the suite leaves behind, in a transaction that is
 * rolled back.
 */
import { execFileSync } from 'node:child_process';
import { SENT_INLINE, REGION } from '../../src/game/keep';

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

const MANY = SENT_INLINE + 50;
const out = psql(`
begin;
create temp table said (k text);
grant insert, select on said to authenticated;
select id as w from world where name = 'Bigness' \\gset
select uid as ivar from player where world_id = :'w' and name = 'Ivar' \\gset
select uid as alice from player where world_id = :'w' and name = 'Alice' \\gset
select id as other from world where name = 'Hoarding' \\gset
do $b$
declare w uuid; ivar uuid; alice uuid; ix int := 2101; iy int := 2061;
        v_block int; v_item bigint; v_item2 bigint; v_gift bigint; v_join jsonb; v_top bigint;
begin
  select id into w from world where name = 'Bigness';
  select uid into ivar from player where world_id = w and name = 'Ivar';
  select uid into alice from player where world_id = w and name = 'Alice';
  update player set away = true where world_id = w and uid <> ivar;
  update player set away = false, x = ix + 0.5, y = iy + 0.5 where world_id = w and uid = ivar;
  v_block := region_of(ix, iy);
  delete from realtime.messages;

  -- The land.
  perform land_announce(w, ix, iy);
  insert into said select 'HERE|' || count(*) || '|' || coalesce(min(payload->'rows'->0->>'x'), 'none')
    || '|' || coalesce(min(jsonb_array_length(payload->'rows')), 0)
    from realtime.messages where topic = 'land:' || w || ':' || v_block and event = 'land';
  delete from realtime.messages;
  perform land_announce(w, ix + ${REGION}, iy);
  insert into said select 'BESIDE|' || count(*) from realtime.messages
    where topic = 'land:' || w || ':' || region_of(ix + ${REGION}, iy);
  delete from realtime.messages;
  perform land_announce(w, 100, 100);
  insert into said select 'FAR|' || count(*) from realtime.messages where extension = 'broadcast';
  delete from realtime.messages;
  insert into tile_change (world_id, x, y, region, tile, data, corners)
    select w, ix, iy, v_block, 0, 0, array[0, 0, 0, 0] from generate_series(1, ${MANY});
  select max(n) into v_top from tile_change where world_id = w;
  insert into said select 'MANY|' || count(*) || '|' || coalesce(min(payload->>'upto'), 'none')
    || '|' || (min(payload->>'upto') = v_top::text) || '|' || coalesce(min(payload->>'rows'), 'no rows')
    from realtime.messages where topic = 'land:' || w || ':' || v_block;
  delete from realtime.messages;

  -- Lines.
  perform tell(w, ivar, 'For Ivar.', 'event');
  insert into said select 'OWNLINE|' || count(*) || '|' || coalesce(min(payload->'lines'->0->>'text'), 'none')
    from realtime.messages where topic = 'own:' || w || ':' || ivar and event = 'said';
  perform tell(w, null, 'For everybody.', 'info');
  insert into said select 'ALLLINE|' || count(*) || '|' || coalesce(min(payload->'lines'->0->>'text'), 'none')
    from realtime.messages where topic = 'said:' || w and event = 'said';
  delete from realtime.messages;
  perform tell(w, alice, 'For Alice.', 'event');
  insert into said select 'AWAYLINE|' || count(*) from realtime.messages;
  delete from realtime.messages;

  -- The pack.
  v_item := give(w, ivar, 'rope', 1, 30);
  insert into said select 'INPACK|' || count(*) filter (where exists (
      select 1 from jsonb_array_elements(payload->'set') s where (s->>'id')::bigint = v_item))
    from realtime.messages where topic = 'own:' || w || ':' || ivar and event = 'pack';
  delete from realtime.messages;
  update item set holder = 'ground', holder_uid = null, gx = ix, gy = iy where id = v_item;
  insert into said select 'PUTDOWN|' || count(*) filter (where payload->'gone' @> to_jsonb(v_item))
    from realtime.messages where topic = 'own:' || w || ':' || ivar and event = 'pack';
  v_item2 := give(w, ivar, 'rope', 1, 30);
  delete from realtime.messages;
  delete from item where id = v_item2;
  insert into said select 'DELETED|' || count(*) filter (where payload->'gone' @> to_jsonb(v_item2))
    from realtime.messages where topic = 'own:' || w || ':' || ivar and event = 'pack';
  delete from realtime.messages;
  v_gift := give(w, alice, 'rope', 1, 30);
  insert into said select 'AWAYPACK|' || count(*) from realtime.messages;

  -- Gone home: nothing more to him, and nothing to his block.
  update player set away = true where world_id = w and uid = ivar;
  delete from realtime.messages;
  perform land_announce(w, ix, iy);
  perform tell(w, ivar, 'Nobody reads this.', 'event');
  insert into said select 'GONE|' || count(*) from realtime.messages;
  update player set away = false where world_id = w and uid = ivar;

  -- And the join says the island sends.
  perform set_config('request.jwt.claims', json_build_object('sub', ivar)::text, true);
  v_join := rpc_join(w, null);
  insert into said values ('JOIN|' || coalesce(v_join->>'hears', 'null'));
end $b$;

-- Who may listen, as Ivar and through the policy: one probe on each topic.
delete from realtime.messages;
insert into realtime.messages (topic, extension, payload, event, private)
  select t, 'broadcast', '{}'::jsonb, 'probe', true
    from unnest(array['land:' || :'w' || ':8200', 'said:' || :'w', 'own:' || :'w' || ':' || :'ivar',
                      'own:' || :'w' || ':' || :'alice', 'land:' || :'other' || ':0']) t;
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, true) \\g /dev/null
set local role authenticated;
select 'HEARS|' || string_agg(private.hears(t)::text, ',' order by o)
  from unnest(array['land:' || :'w' || ':8200', 'said:' || :'w', 'own:' || :'w' || ':' || :'ivar',
                    'own:' || :'w' || ':' || :'alice', 'land:' || :'other' || ':0',
                    'land:' || :'w' || ':8200:x', 'land:' || :'w' || ':abc', 'nonsense', 'said:not-a-uuid'])
       with ordinality u(t, o);
select set_config('realtime.topic', 'land:' || :'w' || ':8200', true) \\g /dev/null
select 'POLICY|land|' || count(*) from realtime.messages where topic = 'land:' || :'w' || ':8200';
select set_config('realtime.topic', 'own:' || :'w' || ':' || :'ivar', true) \\g /dev/null
select 'POLICY|mine|' || count(*) from realtime.messages where topic = 'own:' || :'w' || ':' || :'ivar';
select set_config('realtime.topic', 'own:' || :'w' || ':' || :'alice', true) \\g /dev/null
select 'POLICY|hers|' || count(*) from realtime.messages where topic = 'own:' || :'w' || ':' || :'alice';
select set_config('realtime.topic', 'land:' || :'other' || ':0', true) \\g /dev/null
select 'POLICY|elsewhere|' || count(*) from realtime.messages where topic = 'land:' || :'other' || ':0';
reset role;

select 'PUB|' || count(*) from pg_publication_tables
 where pubname = 'supabase_realtime' and tablename in ('tile_change', 'event', 'item', 'bridge', 'bridge_span', 'foundation');
select 'DOORS|' || has_function_privilege('authenticated', 'private.shut(text)', 'execute')
    || ',' || has_function_privilege('authenticated', 'private.lock_doors()', 'execute')
    || ',' || has_function_privilege('authenticated', 'private.send(text, text, jsonb)', 'execute')
    || ',' || has_function_privilege('authenticated', 'private.hears(text)', 'execute');
select k from said;
rollback;
`);

const said = (key: string): string => out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? '';

check('a tile changed where he stands goes to his block, with the row in it', said('HERE') === '1|2101|1', said('HERE'));
check('and one in the block beside him goes too', said('BESIDE') === '1', said('BESIDE'));
check('one eight blocks off goes nowhere', said('FAR') === '0', said('FAR'));
check(`${MANY} in one statement are one message, which says only how far the island has got`,
  /^1\|\d+\|true\|no rows$/.test(said('MANY')), said('MANY'));
check('a line to him goes to his own topic', said('OWNLINE') === '1|For Ivar.', said('OWNLINE'));
check('a line to everybody goes to the island\'s', said('ALLLINE') === '1|For everybody.', said('ALLLINE'));
check('a line to somebody away goes nowhere', said('AWAYLINE') === '0', said('AWAYLINE'));
check('a thing into his pack goes to him as what is in it', Number(said('INPACK')) >= 1, said('INPACK'));
check('put down, it goes to him as gone', said('PUTDOWN') === '1', said('PUTDOWN'));
check('and so does one that is deleted', said('DELETED') === '1', said('DELETED'));
check('the pack of somebody away sends nothing', said('AWAYPACK') === '0', said('AWAYPACK'));
check('once he has gone home, nothing goes to him or his block', said('GONE') === '0', said('GONE'));
check('the join says the island sends', said('JOIN') === 'true', said('JOIN'));
check('he may listen to his island\'s land and lines and his own topic, and nothing else',
  said('HEARS') === 'true,true,true,false,false,false,false,false,false', said('HEARS'));
check('the policy lets him read his island\'s land', said('POLICY|land') === '1', said('POLICY|land'));
check('and his own', said('POLICY|mine') === '1', said('POLICY|mine'));
check('and not somebody else\'s', said('POLICY|hers') === '0', said('POLICY|hers'));
check('nor another island\'s', said('POLICY|elsewhere') === '0', said('POLICY|elsewhere'));
check('the six tables are out of the publication', said('PUB') === '0', said('PUB'));
check('private.shut, private.lock_doors and private.send are not a signed-in body\'s, and private.hears is',
  said('DOORS') === 'false,false,false,true', said('DOORS'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`live updates over broadcast — ${ok.length} of ${ok.length}`);
