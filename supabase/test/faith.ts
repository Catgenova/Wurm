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
 *   * what a spell is pointed at is found and counted as yourself, another
 *     person, a wildermon, an enemy, a thing or the ground, or refused -- not
 *     there, not a kind the spell takes, or too far off -- in the same words on
 *     both sides (`spell_target`);
 *   * the skill is called Faith, and no door is open but the rpc ones.
 */
import { execFileSync } from 'node:child_process';
import {
  BAR_SLOTS, FAITH_TIER_AT, faithSpellRefusal, PATRON_AT, patronRefusal, PATRONS, slotRefusal, SPELL_BAR, SPELL_ON_WORDS, SPELL_ONS,
  SPELL_REACH, SPELLS_PER_TIER, spellTargetRefusal, type FaithSpellDef, type PointedAt,
} from '../../src/game/patrons';
import { SKILL_BY_ID } from '../../src/game/skills';
import { FAITH, FAITH_ACTIONS, favourCap, PRAYER, PRAYER_GAIN, PRAYER_REST, prayerRestWords, prayerWorth } from '../../src/game/faith';

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
const SPELL_A: FaithSpellDef = { id: 'blessing_test_a', patron: 'blessing', tier: 1, name: 'Test A', note: 'Nothing.', cost: 5, rest: 30, on: ['self'], fx: {} };
const SPELL_B: FaithSpellDef = { ...SPELL_A, id: 'blessing_test_b', name: 'Test B' };
const SPELL_C: FaithSpellDef = { ...SPELL_A, id: 'blessing_test_c', name: 'Test C', tier: 2, on: ['enemy'] };
const SPELL_D: FaithSpellDef = { ...SPELL_A, id: 'chaos_test_d', name: 'Test D', patron: 'chaos' };
/* And four only ever pointed at things, for what they are cast on: never taken, so at the last tier. */
const SPELL_E: FaithSpellDef = { ...SPELL_A, id: 'blessing_test_e', name: 'Test E', tier: 5, on: ['self', 'player'] };
const SPELL_F: FaithSpellDef = { ...SPELL_E, id: 'blessing_test_f', name: 'Test F', on: ['enemy'] };
const SPELL_G: FaithSpellDef = { ...SPELL_E, id: 'blessing_test_g', name: 'Test G', on: ['wildermon'] };
const SPELL_H: FaithSpellDef = { ...SPELL_E, id: 'blessing_test_h', name: 'Test H', on: ['object', 'area'], radius: 3 };
const TEST_SPELLS = [SPELL_A, SPELL_B, SPELL_C, SPELL_D, SPELL_E, SPELL_F, SPELL_G, SPELL_H];
const row = (s: FaithSpellDef): string =>
  `('${s.id}', '${s.patron}', ${s.tier}, '${s.name}', '${s.note}', ${s.cost}, ${s.rest}, '{${s.on.join(',')}}', ${s.radius ?? 'null'})`;
/* Where the suite stands the two of them, and how far off it puts what is too far. */
const FAR = SPELL_REACH + 8;

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
insert into faith_spell values ${TEST_SPELLS.map(row).join(', ')};
do $b$
declare w record; r jsonb; o uuid; v_px double precision; v_py double precision; a int; b int; v_item bigint; v_theirs bigint; v_placed bigint;
begin
  insert into said values ('NUMS', patron_at() || '|' || spells_per_tier() || '|' || spell_reach());
  insert into said select 'ONS', string_agg(id || ':' || word, ',' order by id) from spell_on_def;
  insert into said select 'TIERS', string_agg(at::text, ',' order by tier) from faith_tier;
  insert into said select 'PATRONS', string_agg(id || ':' || name || ':' || alignment, ',' order by id) from patron_def;
  insert into said select 'SLOTS', string_agg(school, ',' order by slot) from spell_slot;
  insert into said select 'SKILL', name from skill_def where id = faith_skill();

  -- Somebody on an island with somebody else on it, for a spell cast on another person.
  select p.world_id, p.uid, wd.spawn_x, wd.spawn_y into w from player p join world wd on wd.id = p.world_id
   where (select count(*) from player q where q.world_id = p.world_id) >= 2
   order by wd.size desc, p.world_id, p.uid limit 1;
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

  -- What a spell is cast on: yourself, somebody else, creatures, things and the ground.
  select uid into o from player where world_id = w.world_id and uid <> w.uid order by uid limit 1;
  v_px := w.spawn_x + 0.5; v_py := w.spawn_y + 0.5;
  update player set x = v_px, y = v_py, away = false where world_id = w.world_id and uid = w.uid;
  update player set x = v_px + 3, y = v_py, away = false where world_id = w.world_id and uid = o;
  insert into said values ('T:SELF', spell_target(w.world_id, w.uid, 'blessing_test_e', '{}'::jsonb)->>'kind');
  insert into said values ('T:YOU', spell_target(w.world_id, w.uid, 'blessing_test_e', jsonb_build_object('kind', 'player', 'uid', w.uid))->>'kind');
  r := spell_target(w.world_id, w.uid, 'blessing_test_e', jsonb_build_object('kind', 'player', 'uid', o));
  insert into said values ('T:OTHER', (r->>'kind') || '|' || ((r->>'uid') = o::text));
  update player set away = true where world_id = w.world_id and uid = o;
  insert into said values ('T:AWAY', spell_target(w.world_id, w.uid, 'blessing_test_e', jsonb_build_object('kind', 'player', 'uid', o))->>'why');
  update player set away = false, x = v_px + ${FAR} where world_id = w.world_id and uid = o;
  insert into said values ('T:FAR', spell_target(w.world_id, w.uid, 'blessing_test_e', jsonb_build_object('kind', 'player', 'uid', o))->>'why');
  a := creature_spawn(w.world_id, 'rowl', v_px + 4, v_py, 'wild', now() - interval '2 hours');
  b := creature_spawn(w.world_id, 'rowl', v_px, v_py + 4, 'wild', now() - interval '2 hours');
  update creature set hunting = null where world_id = w.world_id and id in (a, b);
  update creature set mode = 'deed' where world_id = w.world_id and id = b;
  insert into said values ('T:KIND', spell_target(w.world_id, w.uid, 'blessing_test_e', jsonb_build_object('kind', 'creature', 'id', a))->>'why');
  insert into said values ('T:ENEMY', spell_target(w.world_id, w.uid, 'blessing_test_f', jsonb_build_object('kind', 'creature', 'id', a))->>'kind');
  insert into said values ('T:TAME', spell_target(w.world_id, w.uid, 'blessing_test_f', jsonb_build_object('kind', 'creature', 'id', b))->>'why');
  insert into said values ('T:WILDERMON', (spell_target(w.world_id, w.uid, 'blessing_test_g', jsonb_build_object('kind', 'creature', 'id', a))->>'kind')
    || '|' || (spell_target(w.world_id, w.uid, 'blessing_test_g', jsonb_build_object('kind', 'creature', 'id', b))->>'kind'));
  update creature set hunting = w.uid where world_id = w.world_id and id = a;
  insert into said values ('T:AFTER', spell_target(w.world_id, w.uid, 'blessing_test_g', jsonb_build_object('kind', 'creature', 'id', a))->>'why');
  insert into said values ('T:JUNK', spell_target(w.world_id, w.uid, 'blessing_test_f', jsonb_build_object('kind', 'creature', 'id', 'a goblin'))->>'why');
  insert into item (world_id, holder, holder_uid, def, ql) values (w.world_id, 'player', w.uid, (select id from item_def order by id limit 1), 10)
    returning id into v_item;
  insert into item (world_id, holder, holder_uid, def, ql) values (w.world_id, 'player', o, (select id from item_def order by id limit 1), 10)
    returning id into v_theirs;
  r := spell_target(w.world_id, w.uid, 'blessing_test_h', jsonb_build_object('kind', 'item', 'id', v_item));
  insert into said values ('T:ITEM', (r->>'kind') || '|' || ((r->>'item')::bigint = v_item));
  insert into said values ('T:THEIRS', spell_target(w.world_id, w.uid, 'blessing_test_h', jsonb_build_object('kind', 'item', 'id', v_theirs))->>'why');
  insert into placed (world_id, kind, x, y, cx, cy) values (w.world_id, 'campfire', floor(v_px)::int + 2, floor(v_py)::int, floor(v_px) + 2.5, floor(v_py) + 0.5)
    returning id into v_placed;
  r := spell_target(w.world_id, w.uid, 'blessing_test_h', jsonb_build_object('kind', 'placed', 'id', v_placed));
  insert into said values ('T:PLACED', (r->>'kind') || '|' || ((r->>'placed')::bigint = v_placed));
  r := spell_target(w.world_id, w.uid, 'blessing_test_h', jsonb_build_object('kind', 'area'));
  insert into said values ('T:AREA', (r->>'kind') || '|' || ((r->>'x')::double precision - v_px) || '|' || ((r->>'y')::double precision - v_py) || '|' || (r->>'radius'));
  insert into said values ('T:AREAFAR', spell_target(w.world_id, w.uid, 'blessing_test_h', jsonb_build_object('kind', 'area', 'x', v_px + ${FAR}, 'y', v_py))->>'why');
  insert into said values ('T:NOTSELF', spell_target(w.world_id, w.uid, 'blessing_test_h', '{}'::jsonb)->>'why');
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
  island('NUMS') === `${PATRON_AT}|${SPELLS_PER_TIER}|${SPELL_REACH}`, island('NUMS'));
check('and so are the kinds of thing a spell is cast on, in the same words',
  island('ONS') === [...SPELL_ONS].sort().map((o) => `${o}:${SPELL_ON_WORDS[o]}`).join(','), island('ONS'));
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

const why = (s: FaithSpellDef, t: PointedAt): string => spellTargetRefusal(s, t) ?? 'null';
check('a spell pointed at nothing at all is cast on yourself', island('T:SELF') === 'self', island('T:SELF'));
check('and so is one pointed at you by name', island('T:YOU') === 'self', island('T:YOU'));
check('one that takes another person is cast on somebody within reach', island('T:OTHER') === 'player|true', island('T:OTHER'));
check('not on somebody who is away, in the same words on both sides',
  island('T:AWAY') === why(SPELL_E, { kind: 'player', found: false, dist: 0 }), island('T:AWAY'));
check(`nor on somebody more than ${SPELL_REACH} tiles off, ditto`,
  island('T:FAR') === why(SPELL_E, { kind: 'player', found: true, dist: FAR }), island('T:FAR'));
check('nor on a kind of thing it does not take, ditto',
  island('T:KIND') === why(SPELL_E, { kind: 'creature', found: true, dist: 4, wild: true, after: false }), island('T:KIND'));
check('an enemy is anything wild', island('T:ENEMY') === 'enemy', island('T:ENEMY'));
check('and not a tame one, ditto', island('T:TAME') === why(SPELL_F, { kind: 'creature', found: true, dist: 4, wild: false }), island('T:TAME'));
check('a wildermon is anything not after you, wild or tame', island('T:WILDERMON') === 'wildermon|wildermon', island('T:WILDERMON'));
check('and not one that is, ditto',
  island('T:AFTER') === why(SPELL_G, { kind: 'creature', found: true, dist: 4, wild: true, after: true }), island('T:AFTER'));
check('nonsense is nothing that is here, ditto', island('T:JUNK') === why(SPELL_F, { kind: 'creature', found: false, dist: 0 }), island('T:JUNK'));
check('a thing is one in your own pack', island('T:ITEM') === 'object|true', island('T:ITEM'));
check('and not one in somebody else’s, ditto', island('T:THEIRS') === why(SPELL_H, { kind: 'item', found: false, dist: 0 }), island('T:THEIRS'));
check('or one set down within reach', island('T:PLACED') === 'object|true', island('T:PLACED'));
check(`the ground is round where you stand, out to the spell’s own ${SPELL_H.radius} tiles`,
  island('T:AREA') === `area|0|0|${SPELL_H.radius}`, island('T:AREA'));
check('and not ground too far off, ditto', island('T:AREAFAR') === why(SPELL_H, { kind: 'area', found: true, dist: FAR }), island('T:AREAFAR'));
check('a spell that does not take you says what it does take, ditto',
  island('T:NOTSELF') === why(SPELL_H, { kind: 'self', found: true, dist: 0 }), island('T:NOTSELF'));

check('no function is open to a player but the doors', island('OPEN') === '0', island('OPEN'));
check('and the five faith doors are, running as their owner', island('DOORS') === '5', island('DOORS'));

/* ---- The browser's half --------------------------------------------------- */

check('the browser takes five tiers: the patron’s own, every twenty to eighty, and the last at ninety-nine',
  FAITH_TIER_AT.length === 5 && FAITH_TIER_AT[0] === PATRON_AT && FAITH_TIER_AT[FAITH_TIER_AT.length - 1] === 99
  && FAITH_TIER_AT.slice(0, -1).every((at, i) => i === 0 || at - FAITH_TIER_AT[i - 1] === 20), FAITH_TIER_AT.join(','));
check('three patrons, good, neutral and evil', PATRONS.map((p) => p.alignment).join(',') === 'good,neutral,evil');
check('a bar of three class slots, two faith and one path', SPELL_BAR.join(',') === 'class,class,class,faith,faith,path');

/* ---- Prayer: every thirty minutes; Prayer sets what it banks, faith what you hold, and it trains both -- */
const ALTAR_QL = 40;
const [FAITH_AT, PRAYER_AT] = [10, 60];
const prayed = psql(`
begin;
create temp table said (k text, v text);
do $p$
declare w record; v_altar bigint; v_at jsonb;
begin
  select p.world_id, p.uid, p.x, p.y into w from player p order by p.world_id, p.uid limit 1;
  -- Faith low and Prayer high, so which of them a prayer reads shows.
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, faith_skill(), ${FAITH_AT}), (w.world_id, w.uid, praying_skill(), ${PRAYER_AT})
    on conflict (world_id, uid, id) do update set value = excluded.value;
  -- An altar where the body kneels, no prayer said yet, and no favour banked.
  insert into placed (world_id, kind, sub, x, y, cx, cy, ql)
    values (w.world_id, 'furniture', 'altar', floor(w.x)::int, floor(w.y)::int, w.x, w.y, ${ALTAR_QL}) returning id into v_altar;
  v_at := jsonb_build_object('kind', 'furniture', 'id', v_altar);
  update player set prayed_at = null, favour = 0, favour_at = now() where world_id = w.world_id and uid = w.uid;
  insert into said values ('REST', prayer_rest() || '|' || prayer_gain());
  insert into said values ('SKILLS', faith_skill() || '|' || praying_skill() || '|' || (select skill from action_def where id = 'pray'));
  insert into said values ('FIRST', coalesce(faith_refusal(w.world_id, w.uid, 'pray', v_at), 'HEARD'));
  perform perform_faith(w.world_id, w.uid, 'pray', v_at);
  insert into said select 'BANKED', favour || '|' || hour_of_day(w.world_id) from player where world_id = w.world_id and uid = w.uid;
  insert into said select 'TRAINED', string_agg(id || ':' || (value > case when id = faith_skill() then ${FAITH_AT} else ${PRAYER_AT} end), '|' order by id)
    from skill where world_id = w.world_id and uid = w.uid and id in (faith_skill(), praying_skill());
  -- Faith at its first point holds no more than it carries, however much Prayer banks.
  update skill set value = case when id = faith_skill() then 1 else 100 end
    where world_id = w.world_id and uid = w.uid and id in (faith_skill(), praying_skill());
  update player set favour = favour_cap(1) - 1, favour_at = now() where world_id = w.world_id and uid = w.uid;
  perform perform_faith(w.world_id, w.uid, 'pray', v_at);
  insert into said select 'CAPPED', favour || '|' || favour_cap(1) from player where world_id = w.world_id and uid = w.uid;
  -- Twelve minutes short of the rest, and a minute past it.
  update player set prayed_at = now() - make_interval(secs => prayer_rest() - 12 * 60) where world_id = w.world_id and uid = w.uid;
  insert into said values ('WAIT', coalesce(faith_refusal(w.world_id, w.uid, 'pray', v_at), 'HEARD'));
  update player set prayed_at = now() - make_interval(secs => prayer_rest() + 60) where world_id = w.world_id and uid = w.uid;
  insert into said values ('AGAIN', coalesce(faith_refusal(w.world_id, w.uid, 'pray', v_at), 'HEARD'));
end $p$;
select k || '=' || v from said order by k;
rollback;`);
const prayer = new Map(prayed.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)] as [string, string]));
check(`a prayer rests ${PRAYER_REST / 60} minutes and trains faith by the same base on both sides`,
  prayer.get('REST') === `${PRAYER_REST}|${PRAYER_GAIN}` && PRAYER_REST === 30 * 60, prayer.get('REST'));
check('a prayer at an altar with no prayer before it is heard', prayer.get('FIRST') === 'HEARD', prayer.get('FIRST'));
const prayJob = FAITH_ACTIONS.find((a) => a.id === 'pray');
check('a prayer is said with Prayer, on both sides, and faith is a skill of its own',
  prayer.get('SKILLS') === `${FAITH}|${PRAYER}|${PRAYER}` && prayJob?.skill === PRAYER,
  `island ${prayer.get('SKILLS')}, browser ${FAITH}|${PRAYER}|${prayJob?.skill}`);
{
  const [banked, hour] = (prayer.get('BANKED') ?? '').split('|').map(Number);
  const want = prayerWorth(ALTAR_QL, hour, PRAYER_AT);
  check(`it banks what Prayer ${PRAYER_AT} says at a quality ${ALTAR_QL} altar, the same on both sides, and not what faith ${FAITH_AT} would`,
    Math.abs(banked - want) < 1e-6 && Math.abs(want - prayerWorth(ALTAR_QL, hour, FAITH_AT)) > 1,
    `island ${banked}, browser ${want} at hour ${hour}`);
}
check('and trains both faith and Prayer on the island', prayer.get('TRAINED') === [FAITH, PRAYER].sort().map((id) => `${id}:true`).join('|'),
  prayer.get('TRAINED'));
{
  const [held, cap] = (prayer.get('CAPPED') ?? '').split('|').map(Number);
  // A point short of the cap, and a prayer at Prayer 100 worth more than that point.
  const hour = Number((prayer.get('BANKED') ?? '').split('|')[1]);
  check('faith sets the most it holds, the same on both sides, whatever Prayer would bank',
    Math.abs(held - cap) < 1e-9 && Math.abs(cap - favourCap(1)) < 1e-9 && prayerWorth(ALTAR_QL, hour, 100) > 1,
    `held ${held} after a prayer worth ${prayerWorth(ALTAR_QL, hour, 100).toFixed(2)} from a point short; island cap ${cap}, browser cap ${favourCap(1)}`);
}
check('a prayer twelve minutes short of the rest waits, in the same words on both sides',
  prayer.get('WAIT') === prayerRestWords(12 * 60), `island "${prayer.get('WAIT')}", browser "${prayerRestWords(12 * 60)}"`);
check('and one a minute past it is heard', prayer.get('AGAIN') === 'HEARD', prayer.get('AGAIN'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`patrons, faith spells and the spell bar — ${ok.length} of ${ok.length}`);
