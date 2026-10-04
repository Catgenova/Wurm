/**
 * Justice's fifteen spells, on the island (`justices_spells.sql`) and in the
 * browser's rulebook (`FAITH_SPELLS` in `src/game/patrons.ts`).
 *
 * Every spell is pointed through `spell_target` and cast through
 * `faith_spell_cast`, as the door does it, and what it did is read back. What
 * lasts is asked of the rule it works through: a mark through `wound_beast`,
 * a Retribution owed and paid through `faith_owed_pay`, a Truce through both
 * `hurt_player` and `wound_beast`, a Summons through `engage_beast`, a Temper
 * through any wear at all, an Oath through a blow, a Due Reward through
 * `skill_mult`. Every number asked after is the browser's own.
 */
import { execFileSync } from 'node:child_process';
import { BLOW_SHARE } from '../../src/game/creatures';
import { FAITH_SPELL_BY_ID, FAITH_SPELLS, FAITH_TIER_AT, SPELLS_PER_TIER, type FaithSpellDef } from '../../src/game/patrons';

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
const near = (a: number, b: number, by = 1e-6): boolean => Math.abs(a - b) <= by;
const spell = (id: string): FaithSpellDef => {
  const s = FAITH_SPELL_BY_ID.get(`justice_${id}`);
  if (!s) throw new Error(`no justice_${id}`);
  return s;
};
const fx = (id: string, k: string): number => spell(id).fx[k];
const R = (id: string): number => spell(id).radius ?? 0;

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w record; o uuid; v_px double precision; v_py double precision; r jsonb; c creature;
        a int; b int; g int; n int; h1 int; v_item bigint; v_log bigint; v_grave bigint; v_max double precision;
        h0 double precision; v_m0 double precision;
begin
  select p.world_id, p.uid, wd.spawn_x, wd.spawn_y into w from player p join world wd on wd.id = p.world_id
   where exists (select 1 from land_tile lt where lt.world_id = wd.id)
     and (select count(*) from player q where q.world_id = p.world_id) >= 2
   order by wd.size desc, p.world_id, p.uid limit 1;
  select uid into o from player where world_id = w.world_id and uid <> w.uid order by uid limit 1;
  v_px := w.spawn_x + peace_reach() + 20.5; v_py := w.spawn_y + 0.5;
  update player set x = v_px, y = v_py, away = false, act = null, act_target = null, equipped = '{}'::jsonb, wounds = '[]'::jsonb,
         fight_stance = 'balanced', blessings = '{}'::jsonb, used_at = '{}'::jsonb, body_at = now(),
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('health', 1, 'hunger', 1, 'thirst', 1, 'stamina', 1, 'aegis', 0)
   where world_id = w.world_id and uid in (w.uid, o);
  update player set x = v_px + 2 where world_id = w.world_id and uid = o;
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'body_control', 1)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  delete from event where uid in (w.uid, o);
  delete from friend where world_id = w.world_id and ((uid = w.uid and other = o) or (uid = o and other = w.uid));
  delete from creature where world_id = w.world_id and to_x between v_px - 40 and v_px + 40 and to_y between v_py - 40 and v_py + 40;
  delete from faith_zone where world_id = w.world_id;
  delete from item where world_id = w.world_id and holder = 'furniture' and placed in
    (select id from placed where world_id = w.world_id and kind = 'furniture' and sub = 'grave' and made_by = w.uid);
  delete from placed where world_id = w.world_id and kind = 'furniture' and sub = 'grave' and made_by = w.uid;

  insert into said select 'ROWS', count(*)::text from faith_spell where patron = 'justice';

  a := creature_spawn(w.world_id, 'rowl', v_px + 3, v_py, 'wild', now() - interval '2 hours');
  b := creature_spawn(w.world_id, 'rowl', v_px - 3, v_py, 'wild', now() - interval '2 hours');
  g := creature_spawn(w.world_id, 'goblin', v_px, v_py + 3, 'wild', now() - interval '2 hours');
  update creature set traits = '{}', hunting = null, hunt_again = null, settled_at = now(), until = now() + interval '1 hour'
    where world_id = w.world_id and id in (a, b, g);

  -- Mark of Judgment: its share more off every blow.
  update creature set health = max_health(creature) * 0.8 where world_id = w.world_id and id = a;
  perform faith_spell_cast(w.world_id, w.uid, 'justice_mark', spell_target(w.world_id, w.uid, 'justice_mark', jsonb_build_object('kind', 'creature', 'id', a)));
  select * into c from creature where world_id = w.world_id and id = a;
  h0 := c.health;
  perform hurt_creature(w.world_id, a, 10, w.uid);
  insert into said select 'MARK', round(faith_marked(w.world_id, a)::numeric, 4) || '|'
    || round(((h0 - cr.health) / (10 * beast_mul(c, 'soak')))::numeric, 4) from creature cr where cr.world_id = w.world_id and cr.id = a;

  -- Retribution: its share of what landed is owed to the striker, and paid at its settling.
  perform faith_spell_cast(w.world_id, w.uid, 'justice_retribution', spell_target(w.world_id, w.uid, 'justice_retribution', '{}'::jsonb));
  update player set stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{hurtBy}', to_jsonb(a)) where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.2, 'A test blow', 'bite');
  insert into said select 'RETRIB', round((1 - (stats->>'health')::double precision)::numeric, 4) || '|'
    || (select round(sum(dmg)::numeric, 4) from faith_owed where world_id = w.world_id and creature_id = a)
    from player where world_id = w.world_id and uid = w.uid;
  select health into h0 from creature where world_id = w.world_id and id = a;
  perform faith_owed_pay(w.world_id, a);
  insert into said select 'RETRIB:PAID', round((h0 - health)::numeric, 4) || '|' || (select count(*) from faith_owed where world_id = w.world_id)
    from creature where world_id = w.world_id and id = a;

  -- Assay: the ore under the ground round the spot, marked for its while.
  r := faith_spell_cast(w.world_id, w.uid, 'justice_assay', spell_target(w.world_id, w.uid, 'justice_assay', jsonb_build_object('kind', 'area')));
  insert into said select 'ASSAY', (select count(*) from generate_series(floor(v_px - ${R('assay')})::int, floor(v_px + ${R('assay')})::int) x
      cross join generate_series(floor(v_py - ${R('assay')})::int, floor(v_py + ${R('assay')})::int) y
      where (x + 0.5 - v_px) ^ 2 + (y + 0.5 - v_py) ^ 2 <= ${R('assay')} ^ 2 and (bedrock_at(w.world_id, x, y)).ore)
    || '|' || coalesce(jsonb_array_length(stats->'prospected'->'tiles'), 0)
    || '|' || coalesce(round((stats->'prospected'->>'until')::numeric - extract(epoch from now())::numeric), 0)
    || '|' || coalesce(r->>'said', r->>'why')
    from player where world_id = w.world_id and uid = w.uid;

  -- Sentence: refused on the unhurt; a share of what it has lost.
  insert into said values ('SENT:WHOLE', faith_spell_cast(w.world_id, w.uid, 'justice_sentence',
    spell_target(w.world_id, w.uid, 'justice_sentence', jsonb_build_object('kind', 'creature', 'id', b)))->>'why');
  update creature set health = max_health(creature) * 0.5 where world_id = w.world_id and id = b;
  perform faith_spell_cast(w.world_id, w.uid, 'justice_sentence', spell_target(w.world_id, w.uid, 'justice_sentence', jsonb_build_object('kind', 'creature', 'id', b)));
  insert into said select 'SENT', round((health / max_health(cr))::numeric, 4) from creature cr where world_id = w.world_id and id = b;

  -- Bind: held where it stands, and a monster half as long.
  perform faith_spell_cast(w.world_id, w.uid, 'justice_bind', spell_target(w.world_id, w.uid, 'justice_bind', jsonb_build_object('kind', 'creature', 'id', b)));
  perform faith_spell_cast(w.world_id, w.uid, 'justice_bind', spell_target(w.world_id, w.uid, 'justice_bind', jsonb_build_object('kind', 'creature', 'id', g)));
  insert into said select 'BIND', string_agg(round(extract(epoch from until - now())::numeric, 2) || ':' || (from_x = to_x and from_y = to_y), '|' order by id)
    from creature where world_id = w.world_id and id in (b, g);

  -- Equity: both at the average; refused when even.
  update player set stats = jsonb_set(stats, '{health}', case when uid = w.uid then '0.9' else '0.3' end::jsonb)
    where world_id = w.world_id and uid in (w.uid, o);
  perform faith_spell_cast(w.world_id, w.uid, 'justice_equity', spell_target(w.world_id, w.uid, 'justice_equity', jsonb_build_object('kind', 'player', 'uid', o)));
  insert into said select 'EQUITY', string_agg(round((stats->>'health')::numeric, 4)::text, '|' order by uid) from player where world_id = w.world_id and uid in (w.uid, o);
  insert into said values ('EQUITY:EVEN', faith_spell_cast(w.world_id, w.uid, 'justice_equity',
    spell_target(w.world_id, w.uid, 'justice_equity', jsonb_build_object('kind', 'player', 'uid', o)))->>'why');

  -- Verdict and Execution: below the line it dies, above it loses its share.
  for n in 1..6 loop
    h1 := creature_spawn(w.world_id, case when n in (3, 6) then 'goblin' else 'rowl' end, v_px + 5, v_py - 3 + n, 'wild', now() - interval '2 hours');
    update creature set traits = '{}', hunting = null, settled_at = now(), until = now() + interval '1 hour'
      where world_id = w.world_id and id = h1;
    -- Apart from the traits, which the whole row in the same update would still have the old ones of.
    update creature set health = max_health(creature) * (array[0.15, 0.5, 0.15, 0.45, 0.6, 0.25])[n]
      where world_id = w.world_id and id = h1;
    perform faith_spell_cast(w.world_id, w.uid, case when n <= 3 then 'justice_verdict' else 'justice_execution' end,
      spell_target(w.world_id, w.uid, case when n <= 3 then 'justice_verdict' else 'justice_execution' end, jsonb_build_object('kind', 'creature', 'id', h1)));
    insert into said select 'DOOM:' || n, coalesce((select round((health / max_health(cr))::numeric, 4)::text from creature cr
      where cr.world_id = w.world_id and cr.id = h1), 'dead');
  end loop;

  -- Summons: it turns on you, and somebody else striking it does not take it back.
  update creature set hunting = o, health = max_health(creature) where world_id = w.world_id and id = g;
  perform faith_spell_cast(w.world_id, w.uid, 'justice_summons', spell_target(w.world_id, w.uid, 'justice_summons', jsonb_build_object('kind', 'creature', 'id', g)));
  insert into said select 'SUMMON', (hunting = w.uid)::text from creature where world_id = w.world_id and id = g;
  perform engage_beast(w.world_id, g, o);
  insert into said select 'SUMMON:HELD', (hunting = w.uid)::text from creature where world_id = w.world_id and id = g;

  -- Temper: the tempered tool's wear stays put, whatever wears it; another's does not.
  insert into item (world_id, holder, holder_uid, def, ql, dmg) values (w.world_id, 'player', w.uid, 'mallet', 30, 10) returning id into v_item;
  insert into item (world_id, holder, holder_uid, def, ql, dmg) values (w.world_id, 'player', w.uid, 'log', 30, 10) returning id into v_log;
  perform faith_spell_cast(w.world_id, w.uid, 'justice_temper', spell_target(w.world_id, w.uid, 'justice_temper', jsonb_build_object('kind', 'item', 'id', v_item)));
  update item set dmg = dmg + 5 where id in (v_item, v_log);
  perform damage_item(v_item, 5);
  insert into said select 'TEMPER', string_agg(dmg::text, '|' order by id) from item where id in (v_item, v_log);

  -- Judgment: the hunters inside lose their share and are marked; one minding its own business is left be.
  update creature set health = max_health(creature), hunting = w.uid where world_id = w.world_id and id = b;
  update creature set health = max_health(creature), hunting = null where world_id = w.world_id and id = a;
  delete from faith_mark where world_id = w.world_id;
  perform faith_spell_cast(w.world_id, w.uid, 'justice_judgment', spell_target(w.world_id, w.uid, 'justice_judgment', jsonb_build_object('kind', 'area')));
  insert into said select 'JUDGE', string_agg(round((health / max_health(cr))::numeric, 4) || ':' || round(faith_marked(w.world_id, cr.id)::numeric, 4), '|' order by cr.id)
    from creature cr where world_id = w.world_id and id in (a, b);

  -- Truce: nothing struck inside, nor from inside; outside, as before.
  update player set stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{hurtBy}', to_jsonb(g)), blessings = '{}'::jsonb
    where world_id = w.world_id and uid = w.uid;
  perform faith_spell_cast(w.world_id, w.uid, 'justice_truce', spell_target(w.world_id, w.uid, 'justice_truce', jsonb_build_object('kind', 'area')));
  perform hurt_player(w.world_id, w.uid, 0.2, 'A test blow', 'bite');
  select health into h0 from creature where world_id = w.world_id and id = a;
  perform hurt_creature(w.world_id, a, 10, w.uid);
  insert into said select 'TRUCE', (stats->>'health') || '|' || round((h0 - (select health from creature where world_id = w.world_id and id = a))::numeric, 4)
    from player where world_id = w.world_id and uid = w.uid;
  update player set x = v_px + 40 where world_id = w.world_id and uid = o;
  h1 := creature_spawn(w.world_id, 'rowl', v_px + 40, v_py + 1, 'wild', now() - interval '2 hours');
  update creature set traits = '{}', settled_at = now() where world_id = w.world_id and id = h1;
  update creature set health = max_health(creature) where world_id = w.world_id and id = h1;
  select health into h0 from creature where world_id = w.world_id and id = h1;
  perform hurt_creature(w.world_id, h1, 10, o);
  insert into said select 'TRUCE:OUT', (round((h0 - health)::numeric, 4) > 0)::text from creature where world_id = w.world_id and id = h1;
  delete from faith_zone where world_id = w.world_id;
  update player set x = v_px + 2 where world_id = w.world_id and uid = o;

  -- Restitution: the grave's contents come home and the grave is gone; no grave, refused.
  insert into said values ('REST:NONE', faith_spell_cast(w.world_id, w.uid, 'justice_restitution',
    spell_target(w.world_id, w.uid, 'justice_restitution', '{}'::jsonb))->>'why');
  insert into placed (world_id, kind, sub, x, y, cx, cy, made_by) values (w.world_id, 'furniture', 'grave', floor(v_px)::int + 50, floor(v_py)::int,
    floor(v_px) + 50.5, floor(v_py) + 0.5, w.uid) returning id into v_grave;
  insert into item (world_id, holder, placed, def, ql) values (w.world_id, 'furniture', v_grave, 'log', 20), (w.world_id, 'furniture', v_grave, 'mallet', 20);
  r := faith_spell_cast(w.world_id, w.uid, 'justice_restitution', spell_target(w.world_id, w.uid, 'justice_restitution', '{}'::jsonb));
  insert into said values ('REST', (select count(*) from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def in ('log', 'mallet') and ql = 20)
    || '|' || (select count(*) from placed where id = v_grave) || '|' || coalesce(r->>'said', r->>'why'));

  -- Oath: refused on a stranger; between friends, a blow on either is split.
  insert into said values ('OATH:STRANGER', faith_spell_cast(w.world_id, w.uid, 'justice_oath',
    spell_target(w.world_id, w.uid, 'justice_oath', jsonb_build_object('kind', 'player', 'uid', o)))->>'why');
  insert into friend (world_id, uid, other, state, at) values (w.world_id, w.uid, o, 'friends', now()), (w.world_id, o, w.uid, 'friends', now());
  perform faith_spell_cast(w.world_id, w.uid, 'justice_oath', spell_target(w.world_id, w.uid, 'justice_oath', jsonb_build_object('kind', 'player', 'uid', o)));
  update player set stats = jsonb_set(stats, '{health}', '1') - 'hurtBy', wounds = '[]'::jsonb where world_id = w.world_id and uid in (w.uid, o);
  perform hurt_player(w.world_id, w.uid, 0.2, 'A test blow', 'bite');
  insert into said select 'OATH', string_agg(round(1 - (stats->>'health')::numeric, 4)::text, '|' order by uid = w.uid desc) from player
    where world_id = w.world_id and uid in (w.uid, o);

  -- Due Reward: every skill's gain its share more.
  v_m0 := skill_mult(w.world_id, o, 'mining');
  perform faith_spell_cast(w.world_id, w.uid, 'justice_reward', spell_target(w.world_id, w.uid, 'justice_reward', jsonb_build_object('kind', 'player', 'uid', o)));
  insert into said values ('REWARD', round((skill_mult(w.world_id, o, 'mining') / v_m0)::numeric, 4)::text);
end $b$;
insert into said select 'OPEN', count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname <> 'rpc_name_free'
    and (has_function_privilege('anon', p.oid, 'execute')
         or (p.proname not like 'rpc\\_%' and has_function_privilege('authenticated', p.oid, 'execute')));
select k || '=' || v from said order by k;
rollback;
`);
const said = new Map<string, string>();
for (const line of out.split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) said.set(line.slice(0, i), line.slice(i + 1));
}
const island = (k: string): string => said.get(k) ?? '(nothing)';
const parts = (k: string): string[] => island(k).split('|');
const pct = (x: number): string => `${Math.round(x * 100)}%`;

/* ---- What came back ------------------------------------------------------ */

const JUSTICE = FAITH_SPELLS.filter((s) => s.patron === 'justice');
check(`the island has Justice's ${JUSTICE.length} spells`, island('ROWS') === String(JUSTICE.length), island('ROWS'));
check(`Mark of Judgment: ${pct(fx('mark', 'more'))} more from a blow`,
  near(Number(parts('MARK')[0]), 1 + fx('mark', 'more')) && near(Number(parts('MARK')[1]), 1 + fx('mark', 'more'), 1e-3), island('MARK'));
{
  const [landed, owed] = parts('RETRIB').map(Number);
  check(`Retribution owes the striker ${pct(fx('retribution', 'share'))} of what landed, in its own health`,
    near(owed, landed * fx('retribution', 'share') / BLOW_SHARE, 1e-3), island('RETRIB'));
  check('and it is paid when the striker is next settled, and nothing is left owing',
    near(Number(parts('RETRIB:PAID')[0]), owed, 1e-3) && parts('RETRIB:PAID')[1] === '0', island('RETRIB:PAID'));
}
{
  const [count, marked, secs, line] = parts('ASSAY');
  check(Number(count) > 0 ? `Assay marks the ${count} ore seams within ${R('assay')} tiles for ${fx('assay', 'secs')} s`
                          : 'Assay is refused where there is no ore',
    Number(count) > 0 ? marked === count && near(Number(secs), fx('assay', 'secs'), 1)
                      : line === `There is no ore under the ground within ${R('assay')} tiles.`, island('ASSAY'));
}
check('Sentence is refused on a creature unhurt', island('SENT:WHOLE') === 'The rowl is unhurt.', island('SENT:WHOLE'));
check(`and takes ${pct(fx('sentence', 'share'))} of what it has lost`,
  near(Number(island('SENT')), 0.5 - 0.5 * fx('sentence', 'share'), 1e-3), island('SENT'));
{
  const [rowl, goblin] = parts('BIND');
  check(`Bind holds a creature still for ${fx('bind', 'secs')} s, a monster for ${fx('bind', 'secs') * fx('bind', 'monster')} s`,
    rowl === `${fx('bind', 'secs').toFixed(2)}:true` && goblin === `${(fx('bind', 'secs') * fx('bind', 'monster')).toFixed(2)}:true`, island('BIND'));
}
check('Equity leaves both at the average', island('EQUITY') === '0.6000|0.6000', island('EQUITY'));
check('and is refused when they are even', /are even already\.$/.test(island('EQUITY:EVEN')), island('EQUITY:EVEN'));
{
  const v = (n: number): string => island(`DOOM:${n}`);
  const share = (id: string, from: number): string => (from - fx(id, 'share')).toFixed(4);
  check(`Verdict kills below ${pct(fx('verdict', 'below'))}`, v(1) === 'dead', v(1));
  check(`and above it takes ${pct(fx('verdict', 'share'))}`, v(2) === share('verdict', 0.5), v(2));
  check(`a monster only below ${pct(fx('verdict', 'monster'))}`, v(3) === share('verdict', 0.15), v(3));
  check(`Execution kills below ${pct(fx('execution', 'below'))}`, v(4) === 'dead', v(4));
  check(`and above it takes ${pct(fx('execution', 'share'))}`, v(5) === share('execution', 0.6), v(5));
  check(`a monster below ${pct(fx('execution', 'monster'))}`, v(6) === 'dead', v(6));
}
check('Summons turns the creature on you', island('SUMMON') === 'true', island('SUMMON'));
check('and somebody else striking it does not take it back', island('SUMMON:HELD') === 'true', island('SUMMON:HELD'));
check('Temper keeps the tempered tool from wearing, however it is worn, and nothing else', island('TEMPER') === '10|15', island('TEMPER'));
{
  const [idle, hunter] = parts('JUDGE');
  check(`Judgment takes ${pct(fx('judgment', 'share'))} off a hunter inside and marks it ${pct(fx('judgment', 'more'))}`,
    hunter === `${(1 - fx('judgment', 'share')).toFixed(4)}:${(1 + fx('judgment', 'more')).toFixed(4)}`, island('JUDGE'));
  check('and leaves one hunting nobody be', idle === '1.0000:1.0000', island('JUDGE'));
}
check('Truce: nothing struck inside, a person or a creature', island('TRUCE') === '1|0.0000', island('TRUCE'));
check('and outside it blows land as before', island('TRUCE:OUT') === 'true', island('TRUCE:OUT'));
check('Restitution is refused with no grave', island('REST:NONE') === 'You have no grave.', island('REST:NONE'));
check('and brings a grave home, the grave gone', island('REST') === '2|0|Restitution brings 2 things back from your grave.', island('REST'));
check('Oath is refused on somebody not a friend', /^An Oath binds only friends/.test(island('OATH:STRANGER')), island('OATH:STRANGER'));
{
  const [mine, theirs] = parts('OATH').map(Number);
  check('between friends a blow is split evenly', near(mine, theirs, 1e-4) && mine > 0, island('OATH'));
}
check(`Due Reward: every skill's gain ${pct(fx('reward', 'more'))} more`, near(Number(island('REWARD')), 1 + fx('reward', 'more'), 1e-4), island('REWARD'));
check('no function is open to a player but the doors', island('OPEN') === '0', island('OPEN'));

/* ---- The browser's half --------------------------------------------------- */

check(`Justice offers ${SPELLS_PER_TIER} spells at each of its ${FAITH_TIER_AT.length} tiers`,
  FAITH_TIER_AT.every((_, i) => JUSTICE.filter((s) => s.tier === i + 1).length === SPELLS_PER_TIER), JUSTICE.map((s) => s.tier).join(','));
check('every spell on the ground has a radius, and no other does', JUSTICE.every((s) => s.on.includes('area') === (s.radius !== undefined && s.radius > 0)));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`Justice's spells — ${ok.length} of ${ok.length}`);
