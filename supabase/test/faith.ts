/**
 * Patrons, faith spells and the spell bar, on the island and in the browser's
 * rulebook (`src/game/patrons.ts`, `patrons_and_the_spell_bar.sql`). What this
 * asks:
 *
 *   * the numbers are the same numbers: the faith a patron is taken at, the
 *     tiers, how many spells a tier offers, the three patrons and the six
 *     slots of the bar;
 *   * a patron is refused below its faith, taken at it, and never twice, in
 *     the same words on both sides;
 *   * a spell is refused at a tier not open yet and from another patron, taken
 *     at an open tier and put on the bar, and the other spells of its tier
 *     close -- with spells of the suite's own, since none are written yet;
 *   * the bar takes a spell you have in a slot of its school only, moves it
 *     rather than copying it, and empties a slot;
 *   * a call off the bar costs nothing when nothing is written behind the
 *     spell, is refused while the favour is short, costs its favour and rests
 *     when it works, and is refused while it rests;
 *   * the skill is called Faith, and no door is open but the rpc ones.
 */
import { execFileSync } from 'node:child_process';
import {
  BAR_SLOTS, FAITH_TIER_AT, faithSpellRefusal, PATRON_AT, patronRefusal, PATRONS, slotRefusal, SPELL_BAR, SPELLS_PER_TIER,
  type FaithSpellDef,
} from '../../src/game/patrons';
import { SKILL_BY_ID } from '../../src/game/skills';

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

/* The suite's own spells: two at the Blessing's first tier, one at its second, and one of Chaos's. */
const SPELL_A: FaithSpellDef = { id: 'blessing_test_a', patron: 'blessing', tier: 1, name: 'Test A', note: 'Nothing.', cost: 5, rest: 30, on: 'self' };
const SPELL_B: FaithSpellDef = { ...SPELL_A, id: 'blessing_test_b', name: 'Test B' };
const SPELL_C: FaithSpellDef = { ...SPELL_A, id: 'blessing_test_c', name: 'Test C', tier: 2, on: 'creature' };
const SPELL_D: FaithSpellDef = { ...SPELL_A, id: 'chaos_test_d', name: 'Test D', patron: 'chaos' };
const TEST_SPELLS = [SPELL_A, SPELL_B, SPELL_C, SPELL_D];
const row = (s: FaithSpellDef): string =>
  `('${s.id}', '${s.patron}', ${s.tier}, '${s.name}', '${s.note}', ${s.cost}, ${s.rest}, '${s.on}')`;

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
insert into faith_spell values ${TEST_SPELLS.map(row).join(', ')};
do $b$
declare w record; r jsonb;
begin
  insert into said values ('NUMS', patron_at() || '|' || spells_per_tier());
  insert into said select 'TIERS', string_agg(at::text, ',' order by tier) from faith_tier;
  insert into said select 'PATRONS', string_agg(id || ':' || name || ':' || alignment, ',' order by id) from patron_def;
  insert into said select 'SLOTS', string_agg(school, ',' order by slot) from spell_slot;
  insert into said select 'SKILL', name from skill_def where id = faith_skill();

  select p.world_id, p.uid into w from player p order by p.world_id, p.uid limit 1;
  update player set patron = null, spell_bar = '[]'::jsonb, used_at = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  delete from player_spell where world_id = w.world_id and uid = w.uid;
  delete from event where uid = w.uid;
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, faith_skill(), 10)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  perform set_config('request.jwt.claims', json_build_object('sub', w.uid)::text, true);

  -- A patron: too little faith, no such patron, taken at enough, and never a second.
  delete from caller where uid = w.uid;
  insert into said values ('LOW', rpc_take_patron(w.world_id, 'blessing')->>'why');
  insert into said values ('NOPE', rpc_take_patron(w.world_id, 'nobody')->>'why');
  update skill set value = 25 where world_id = w.world_id and uid = w.uid and id = faith_skill();
  r := rpc_take_patron(w.world_id, 'blessing');
  insert into said values ('TOOK', coalesce(r->>'took', 'none') || '|' || coalesce(r->>'patron', 'none') || '|'
    || (select count(*) from event where uid = w.uid and text = 'Blessing is your patron.'));
  insert into said values ('AGAIN', rpc_take_patron(w.world_id, 'chaos')->>'why');

  -- A spell: a tier not open, another patron's, one taken onto the bar, its tier closed, and the same again.
  delete from caller where uid = w.uid;
  insert into said values ('TIER2', rpc_take_faith_spell(w.world_id, 'blessing_test_c')->>'why');
  insert into said values ('OTHER', rpc_take_faith_spell(w.world_id, 'chaos_test_d')->>'why');
  r := rpc_take_faith_spell(w.world_id, 'blessing_test_a');
  insert into said values ('SPELL', coalesce(r->>'took', 'none') || '|' || (r->'bar')::text || '|' || (r->'taken')::text);
  insert into said values ('SHUT', rpc_take_faith_spell(w.world_id, 'blessing_test_b')->>'why');
  insert into said values ('HAVE', rpc_take_faith_spell(w.world_id, 'blessing_test_a')->>'why');
  r := rpc_faith(w.world_id);
  insert into said values ('WHYS', coalesce(r->'spells'->>'blessing_test_b', 'null') || '|' || coalesce(r->'spells'->>'blessing_test_a', 'null'));

  -- The bar: the wrong school, no such slot, a spell not had, a move, and an emptying.
  delete from caller where uid = w.uid;
  insert into said values ('CLASS', rpc_spell_bar(w.world_id, 0, 'blessing_test_a')->>'why');
  insert into said values ('NOSLOT', rpc_spell_bar(w.world_id, 9, null)->>'why');
  insert into said values ('NOTHAD', rpc_spell_bar(w.world_id, 4, 'blessing_test_b')->>'why');
  insert into said values ('MOVED', (rpc_spell_bar(w.world_id, 4, 'blessing_test_a')->'bar')::text);
  insert into said values ('EMPTIED', (rpc_spell_bar(w.world_id, 4, null)->'bar')::text);
  perform rpc_spell_bar(w.world_id, 3, 'blessing_test_a');

  -- A call: an empty slot, then nothing written behind it, which costs nothing.
  delete from caller where uid = w.uid;
  update player set favour = 40, favour_at = now() where world_id = w.world_id and uid = w.uid;
  insert into said values ('EMPTY', rpc_cast_spell(w.world_id, 0, '{}'::jsonb)->>'why');
  insert into said values ('UNWRITTEN', (rpc_cast_spell(w.world_id, 3, '{}'::jsonb)->>'why') || '|'
    || (select favour from player where world_id = w.world_id and uid = w.uid));
  -- And with something written behind it: short of favour, then a call, then resting.
  execute $x$
    create or replace function faith_spell_cast(p_world uuid, p_uid uuid, p_spell text, p_target jsonb) returns jsonb
     language plpgsql as $f$ begin return jsonb_build_object('said', 'Test A answers.'); end $f$
  $x$;
  update player set favour = 2, favour_at = now() where world_id = w.world_id and uid = w.uid;
  insert into said values ('POOR', rpc_cast_spell(w.world_id, 3, '{}'::jsonb)->>'why');
  update player set favour = 40, favour_at = now() where world_id = w.world_id and uid = w.uid;
  r := rpc_cast_spell(w.world_id, 3, '{}'::jsonb);
  insert into said values ('CAST', coalesce(r->>'cast', 'none') || '|' || coalesce(r->>'said', 'none') || '|'
    || (r->>'favour') || '|' || coalesce(r->'rest'->>'blessing_test_a', 'none') || '|'
    || (select count(*) from event where uid = w.uid and text = 'Test A answers.'));
  insert into said values ('RESTING', rpc_cast_spell(w.world_id, 3, '{}'::jsonb)->>'why');
end $b$;
insert into said select 'OPEN', count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname <> 'rpc_name_free'
    and (has_function_privilege('anon', p.oid, 'execute')
         or (p.proname not like 'rpc\\_%' and has_function_privilege('authenticated', p.oid, 'execute')));
insert into said select 'DOORS', count(*)::text from pg_proc p
  where p.proname in ('rpc_faith', 'rpc_take_patron', 'rpc_take_faith_spell', 'rpc_spell_bar', 'rpc_cast_spell')
    and has_function_privilege('authenticated', p.oid, 'execute') and p.prosecdef;
select k || '=' || v from said order by k;
rollback;
`);
const said = new Map<string, string>();
for (const line of out.split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) said.set(line.slice(0, i), line.slice(i + 1));
}
const island = (k: string): string => said.get(k) ?? '(nothing)';

check('the faith a patron is taken at, and the spells a tier offers, are the same on both sides',
  island('NUMS') === `${PATRON_AT}|${SPELLS_PER_TIER}`, island('NUMS'));
check('and so are the tiers', island('TIERS') === FAITH_TIER_AT.join(','), island('TIERS'));
check('and the patrons, by name and alignment',
  island('PATRONS') === [...PATRONS].sort((a, b) => a.id.localeCompare(b.id)).map((p) => `${p.id}:${p.name}:${p.alignment}`).join(','),
  island('PATRONS'));
check(`and the ${BAR_SLOTS} slots of the bar, by school`, island('SLOTS') === SPELL_BAR.join(','), island('SLOTS'));
check('the faith skill is called Faith on both sides', island('SKILL') === 'Faith' && SKILL_BY_ID.get('prayer')?.name === 'Faith', island('SKILL'));

check('a patron is refused below its faith, in the same words on both sides',
  island('LOW') === patronRefusal('blessing', null, 10), island('LOW'));
check('and one that is not there', island('NOPE') === patronRefusal('nobody', null, 25), island('NOPE'));
check('at enough faith it is taken, and you are told', island('TOOK') === 'blessing|blessing|1', island('TOOK'));
check('and a second is refused, ditto', island('AGAIN') === patronRefusal('chaos', 'blessing', 25), island('AGAIN'));

check('a spell at a tier not open is refused, ditto',
  island('TIER2') === faithSpellRefusal(SPELL_C, 'blessing', [], 25, TEST_SPELLS), island('TIER2'));
check('and another patron’s, ditto', island('OTHER') === faithSpellRefusal(SPELL_D, 'blessing', [], 25, TEST_SPELLS), island('OTHER'));
check('one at an open tier is taken and goes on the first faith slot of the bar',
  island('SPELL') === `blessing_test_a|[null, null, null, "blessing_test_a", null, null]|["blessing_test_a"]`, island('SPELL'));
check('and the others of its tier close, ditto',
  island('SHUT') === faithSpellRefusal(SPELL_B, 'blessing', [SPELL_A.id], 25, TEST_SPELLS), island('SHUT'));
check('and it is not taken twice, ditto',
  island('HAVE') === faithSpellRefusal(SPELL_A, 'blessing', [SPELL_A.id], 25, TEST_SPELLS), island('HAVE'));
check('the window is told why each spell is refused', island('WHYS') === `${faithSpellRefusal(SPELL_B, 'blessing', [SPELL_A.id], 25, TEST_SPELLS)}|${faithSpellRefusal(SPELL_A, 'blessing', [SPELL_A.id], 25, TEST_SPELLS)}`,
  island('WHYS'));

check('a slot of another school is refused, ditto', island('CLASS') === slotRefusal(0, SPELL_A.id, [SPELL_A.id], 'faith'), island('CLASS'));
check('and a slot that is not there, ditto', island('NOSLOT') === slotRefusal(9, null, []), island('NOSLOT'));
check('and a spell not had, ditto', island('NOTHAD') === slotRefusal(4, SPELL_B.id, [SPELL_A.id], 'faith'), island('NOTHAD'));
check('a spell put in another slot moves there', island('MOVED') === '[null, null, null, null, "blessing_test_a", null]', island('MOVED'));
check('and a slot is emptied', island('EMPTIED') === '[null, null, null, null, null, null]', island('EMPTIED'));

check('an empty slot calls nothing', island('EMPTY') === 'Nothing is in that slot.', island('EMPTY'));
check('a spell with nothing written behind it says so and costs nothing',
  island('UNWRITTEN') === 'Nothing is written behind that spell yet.|40', island('UNWRITTEN'));
check(`short of favour it is refused`, island('POOR') === `${SPELL_A.name} costs ${SPELL_A.cost} favour; you hold 2. Pray at an altar.`, island('POOR'));
check(`a call costs its ${SPELL_A.cost} favour, rests ${SPELL_A.rest} seconds and says what it did`,
  island('CAST') === `${SPELL_A.id}|Test A answers.|${40 - SPELL_A.cost}|${SPELL_A.rest}|1`, island('CAST'));
check('and while it rests it is refused', island('RESTING') === `${SPELL_A.name} can be called again in ${SPELL_A.rest} seconds.`, island('RESTING'));

check('no function is open to a player but the doors', island('OPEN') === '0', island('OPEN'));
check('and the five faith doors are, running as their owner', island('DOORS') === '5', island('DOORS'));

/* ---- The browser's half --------------------------------------------------- */

check('the browser takes the tiers every ten faith from the patron to ninety, and the last at ninety-nine',
  FAITH_TIER_AT[0] === PATRON_AT && FAITH_TIER_AT[FAITH_TIER_AT.length - 1] === 99
  && FAITH_TIER_AT.slice(0, -1).every((at, i) => i === 0 || at - FAITH_TIER_AT[i - 1] === 10), FAITH_TIER_AT.join(','));
check('three patrons, good, neutral and evil', PATRONS.map((p) => p.alignment).join(',') === 'good,neutral,evil');
check('a bar of three class slots, two faith and one path', SPELL_BAR.join(',') === 'class,class,class,faith,faith,path');

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`patrons, faith spells and the spell bar — ${ok.length} of ${ok.length}`);
