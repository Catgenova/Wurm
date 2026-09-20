/**
 * The window that draws the trades, and the answers it is drawn from.
 *
 * `rpc_classes`, `rpc_tree`, `rpc_take_class`, `rpc_take_node` and `rpc_rite`
 * existed for a day with nothing drawing them. `src/ui/panels/trades.ts` draws
 * them now, and it works out none of it for itself: every name, number and
 * refusal on that window is a field off one of those two reads.
 *
 * Which makes the shape of the answer a contract rather than an implementation
 * detail. A field renamed on the island is a blank card in the browser, and
 * nothing else in the suite would say so -- the door would still answer, the
 * migration would still apply, and the window would quietly draw `undefined`.
 * That is exactly the failure `arcane.ts` had this afternoon, from the other
 * direction.
 *
 * So this asks:
 *
 *   * every field the panel reads is there, on every card, with the type the
 *     panel expects -- asked of the real answer rather than of a fixture;
 *   * the two sides agree on what a trade *is*: the same twenty-four ids, the
 *     same names, notes and levers as `src/game/classes.ts`, which is what
 *     generated them;
 *   * the refusals read as sentences, and an archer is an archer;
 *   * and the three write-doors do what the buttons promise: take a trade, buy
 *     a node, and have the answers move.
 *
 * Runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';
import { CLASSES, classRefusal } from '../../src/game/classes';

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
const check = (what: string, right: boolean, saw = ''): void => {
  (right ? ok : bad).push(`${right ? 'ok  ' : 'FAIL'} ${what}${saw ? ` — ${saw}` : ''}`);
};

/*
 * One body, a trade taken, a node bought and the rite asked for, all inside a
 * transaction that is rolled back. The suite's island is exactly as it was.
 *
 * The body must be standing on ground with a height, for the same reason
 * `arcane.ts` must: a world id is a fresh uuid every run, so which body sorts
 * first differs between runs, and one of them stands where there is no land.
 */
const out = psql(`
begin;
create temp table said (line text) on commit drop;
do $$
declare w record; v jsonb; v_node text; v_cls text; v_fight text;
begin
  select p.world_id, p.uid into w from player p
   where land_height(p.world_id, floor(p.x)::int, floor(p.y)::int) is not null
   order by p.world_id, p.uid limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', w.uid)::text, false);

  -- A clean slate, so what is asserted below is this test's doing and not the
  -- leavings of whatever ran before it.
  update player set craft_class = null, combat_class = null, class_mul = null, class_taken = null
   where world_id = w.world_id and uid = w.uid;
  delete from player_node where world_id = w.world_id and uid = w.uid;

  /*
   * The refusal, read before any skill is raised.
   *
   * It has to be first, because the two trades taken below are the two whose
   * names begin with a vowel -- artisan and archer -- and a trade that has
   * been earned has no refusal to read. A coalesce rather than a bare
   * concatenation, so that a null arrives as the word "none" and fails one
   * check by name, instead of deleting the whole line and failing every check
   * that reads it. That is this afternoon's lesson, and it costs one call.
   */
  insert into said select 'WHY|' || coalesce(c.value->>'why', 'none')
    from jsonb_array_elements(rpc_classes(w.world_id)->'classes') c
   where c.value->>'id' = 'archer';

  /*
   * And two trades this body has actually earned -- one of each, which is what
   * a person may hold and what the Tree tab is laid out for.
   *
   * Both are needed to exercise the window. Points come off the best skill a
   * trade covers, so each is taken to eighty: high enough to open it and high
   * enough to have points to spend on the node the button below buys. And only
   * a fighting trade has a rite -- the fourteen craft trades have none, which
   * is why the panel draws the rite box per trade rather than per tree.
   *
   * Which two is immaterial: the panel draws whatever the island answers, so
   * they are whichever sort first and every assertion reads the answer rather
   * than assuming a name.
   */
  select c.id into v_cls from class_def c where c.kind = 'craft' order by c.id limit 1;
  select c.id into v_fight from class_def c where c.kind = 'combat'
   and exists (select 1 from rite_def r where r.class = c.id) order by c.id limit 1;
  insert into skill (world_id, uid, id, value)
  select w.world_id, w.uid, cs.skill, 80 from class_skill cs
   where cs.class in (v_cls, v_fight)
     on conflict (world_id, uid, id) do update set value = 80;

  -- 1. What the Trades tab draws, before anything is taken.
  v := rpc_classes(w.world_id);
  insert into said select 'KEYS|' || string_agg(k, ',' order by k) from jsonb_object_keys(v) k;
  insert into said values ('COUNT|' || jsonb_array_length(v->'classes'));
  -- Every card, every field the panel reads, and its json type.
  insert into said select 'FIELDS|' || coalesce(string_agg(distinct miss, ' | '), 'all there')
    from jsonb_array_elements(v->'classes') c,
    lateral (select c.value->>'id' || ':' || f as miss
             from unnest(array['id','kind','name','note','main','lever','points','open']) f
             where not (c.value ? f) or c.value->f = 'null'::jsonb) z;
  insert into said select 'TYPES|' || coalesce(string_agg(distinct wrong, ' | '), 'all right')
    from jsonb_array_elements(v->'classes') c,
    lateral (select c.value->>'id' || ':' || f || ' is ' || jsonb_typeof(c.value->f) as wrong
             from unnest(array['points']) f where jsonb_typeof(c.value->f) <> 'number'
             union all
             select c.value->>'id' || ':open is ' || jsonb_typeof(c.value->'open')
             where jsonb_typeof(c.value->'open') <> 'boolean'
             union all
             select c.value->>'id' || ':skills is ' || jsonb_typeof(c.value->'skills')
             where jsonb_typeof(c.value->'skills') not in ('array')) z;
  -- The three the header line is built from.
  insert into said values ('HEAD|' || (v->>'at') || '|' || (v->>'change_cost')
    || '|' || jsonb_typeof(v->'purse'));
  -- What the cards say, so the browser can be asked the same question.
  insert into said select 'CARDS|' || string_agg(
      (c.value->>'id') || '~' || (c.value->>'name') || '~' || (c.value->>'note')
        || '~' || (c.value->>'lever') || '~' || (c.value->>'kind'), '#' order by c.value->>'id')
    from jsonb_array_elements(v->'classes') c;

  -- 2. Take one up, the way the button does.
  if not (select (c.value->>'open')::boolean from jsonb_array_elements(v->'classes') c
           where c.value->>'id' = v_cls) then
    insert into said values ('TOOK|the trade did not open at eighty, which it should have');
    return;
  end if;
  v := rpc_take_class(w.world_id, v_cls);
  insert into said values ('TOOK|' || coalesce(v->>'took', 'nothing') || '|' || coalesce(v->>'why', 'no why'));
  v := rpc_take_class(w.world_id, v_fight);
  insert into said values ('FOUGHT|' || coalesce(v->>'took', 'nothing') || '|' || coalesce(v->>'why', 'no why'));

  -- 3. What the Tree tab draws.
  v := rpc_tree(w.world_id);
  insert into said select 'TKEYS|' || string_agg(k, ',' order by k) from jsonb_object_keys(v) k;
  insert into said values ('TRADES|' || jsonb_array_length(v->'trades'));
  insert into said values ('CHANNELS|' || jsonb_array_length(v->'channels'));
  insert into said select 'NODES|' || jsonb_array_length(t.value->'nodes')
    from jsonb_array_elements(v->'trades') t limit 1;
  insert into said select 'NFIELDS|' || coalesce(string_agg(distinct miss, ' | '), 'all there')
    from jsonb_array_elements(v->'trades') t,
         jsonb_array_elements(t.value->'nodes') n,
    lateral (select n.value->>'id' || ':' || f as miss
             from unnest(array['id','col','rank','name','note','channel','cost','mul','taken']) f
             where not (n.value ? f) or n.value->f = 'null'::jsonb) z;
  insert into said select 'CHFIELDS|' || coalesce(string_agg(distinct miss, ' | '), 'all there')
    from jsonb_array_elements(v->'channels') c,
    lateral (select c.value->>'id' || ':' || f as miss
             from unnest(array['id','name','note','downward']) f
             where not (c.value ? f) or c.value->f = 'null'::jsonb) z;
  -- The points line at the head of the tree.
  insert into said select 'POINTS|' || (t.value->>'points') || '|' || (t.value->>'spent')
    from jsonb_array_elements(v->'trades') t limit 1;

  -- 4. Buy a node, the way the button does, and see the tree move.
  select n.value->>'id' into v_node
    from jsonb_array_elements(v->'trades') t, jsonb_array_elements(t.value->'nodes') n
   where n.value->>'why' is null and not (n.value->>'taken')::boolean limit 1;
  if v_node is null then
    insert into said values ('NODE|nothing affordable, which is fair on a body with no points');
  else
    v := rpc_take_node(w.world_id, v_node);
    insert into said values ('NODE|' || coalesce(v->>'took', 'nothing') || '|' || coalesce(v->>'why', 'no why'));
    v := rpc_tree(w.world_id);
    insert into said select 'AFTER|' || count(*) filter (where (n.value->>'taken')::boolean)
      from jsonb_array_elements(v->'trades') t, jsonb_array_elements(t.value->'nodes') n;
  end if;

  -- 5. And the rite the panel puts at the head of the tree.
  v := rpc_tree(w.world_id);
  insert into said select 'RITE|' || coalesce(string_agg(distinct miss, ' | '), 'all there')
    from jsonb_array_elements(v->'rites') r,
    lateral (select r.value->>'id' || ':' || f as miss
             from unnest(array['id','class','name','cost','level','secs','rest','muls','note']) f
             where not (r.value ? f) or r.value->f = 'null'::jsonb) z;
  insert into said values ('RITES|' || jsonb_array_length(v->'rites'));
  -- Its refusal is a sentence, which is what goes under the button.
  insert into said select 'RWHY|' || coalesce(r.value->>'why', 'ready')
    from jsonb_array_elements(v->'rites') r limit 1;
end $$;
select * from said;
rollback;
`);

const say = (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

/* ---- the Trades tab ------------------------------------------------- */

check('the classes door answers the five things the tab is built from',
  say('KEYS') === 'at,change_cost,classes,purse,taken', say('KEYS'));
check('a card for every trade there is',
  say('COUNT') === String(CLASSES.length), `${say('COUNT')} island, ${CLASSES.length} browser`);
check('and every field the panel reads is on every one of them',
  say('FIELDS') === 'all there', say('FIELDS'));
check('with the types it reads them as', say('TYPES') === 'all right', say('TYPES'));
const [at, change, purse] = say('HEAD').split('|');
check('the header line has its three numbers',
  Number(at) > 0 && Number(change) > 0 && purse === 'number',
  `opens at ${at}, changing costs ${change}, purse is a ${purse}`);

/*
 * The two sides agree on what a trade is. The island's rows were generated
 * from `CLASSES`, so this is really asking that the generator and the deploy
 * have not drifted -- and it is the browser's own rulebook doing the asking,
 * field by field, rather than a count.
 */
const mine = CLASSES.map((c) => `${c.id}~${c.name}~${c.note}~${c.lever}~${c.kind}`)
  .sort().join('#');
const theirs = say('CARDS');
check('and the two sides describe them identically, name, note and lever',
  mine === theirs,
  mine === theirs ? `${CLASSES.length} of them` : firstDiff(mine, theirs));

/* ---- the sentences, which the panel puts on the card ------------------ */

const archer = CLASSES.find((c) => c.id === 'archer')!;
const browserWhy = classRefusal(archer, () => 0);
check('an archer is an archer on the island', say('WHY').startsWith('You are not an archer'), say('WHY'));
check('and on the browser', !!browserWhy?.startsWith('You are not an archer'), browserWhy ?? 'none');
check('word for word, both of them', say('WHY') === browserWhy, `island: ${say('WHY')}`);

/* ---- the Tree tab ----------------------------------------------------- */

check('the tree door answers the four things that tab is built from',
  say('TKEYS') === 'channels,mul,rites,trades', say('TKEYS'));
check('taking a trade of each works, and the tree has both',
  say('TOOK').split('|')[1] === 'no why' && say('FOUGHT').split('|')[1] === 'no why'
    && say('TRADES') === '2',
  `${say('TOOK').split('|')[0]} and ${say('FOUGHT').split('|')[0]} · ${say('TRADES')} in the tree`);
check('nine nodes to it, three columns of three', say('NODES') === '9', say('NODES'));
check('and every field the node card reads is on every one',
  say('NFIELDS') === 'all there', say('NFIELDS'));
check('every channel carries the name, note and direction the column head wants',
  say('CHFIELDS') === 'all there', say('CHFIELDS'));
check('fourteen channels, one for each way a trade can lean',
  say('CHANNELS') === '14', say('CHANNELS'));
const [points, spent] = say('POINTS').split('|');
check('and the points line has both its numbers',
  Number.isFinite(Number(points)) && Number.isFinite(Number(spent)),
  `${points} earned, ${spent} spent`);

/* ---- the buttons ------------------------------------------------------ */

const node = say('NODE');
check('buying a node goes through, or says plainly that there is nothing to buy',
  node.startsWith('nothing affordable') || node.split('|')[1] === 'no why', node);
if (!node.startsWith('nothing affordable')) {
  check('and the tree says so the next time it is asked', say('AFTER') === '1', `${say('AFTER')} taken`);
}

/* ---- the rite, at the head of the tree --------------------------------- */

/*
 * One rite, not two: the fighting trade has one and the craft trade has none,
 * which is the case the panel's per-trade rite box exists for.
 */
check('a rite for the fighting trade and none for the craft one',
  say('RITES') === '1', `${say('RITES')} rite(s) across two trades`);
check('carrying every field the rite card reads', say('RITE') === 'all there', say('RITE'));
check('and a refusal that is a sentence, or nothing at all',
  say('RWHY') === 'ready' || /[.!]$/.test(say('RWHY')), say('RWHY'));

/** Where two long joined strings first differ, which is the useful half. */
function firstDiff(a: string, b: string): string {
  const x = a.split('#');
  const y = b.split('#');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return `browser ${x[i] ?? '(none)'} / island ${y[i] ?? '(none)'}`;
  }
  return 'no difference found';
}

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length
  ? `\n${bad.length} of ${ok.length + bad.length} are not what they should be`
  : `\nthe window draws what the island answers — ${ok.length} of ${ok.length}`);
process.exit(bad.length ? 1 : 0);
