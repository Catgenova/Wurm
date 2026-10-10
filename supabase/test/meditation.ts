/**
 * Meditation's framework and the Knowledge path, on the island and in the
 * browser's rulebook (`src/game/meditation.ts`,
 * `the_reader_moves_onto_tiers.sql`). What this asks:
 *
 *   * the numbers are the same numbers: the meditation a path is chosen at,
 *     the five tiers (a patron's five), the picks to a tier, which paths have
 *     moved, every pick field for field, and the steps Love and Power keep;
 *   * a path is chosen at twenty and not at nineteen, and somebody who chose
 *     before keeps their path whatever their meditation;
 *   * a pick is refused with no path, of another path, of a path still on its
 *     steps, at a tier not open yet, at a tier already taken from and twice,
 *     in the same words on both sides; one taken goes on the bar's path slot,
 *     which takes no other school's spell;
 *   * a sitting banks ten Calm times its place, up to favour's curve off
 *     meditation, and a Deep Calm's more; the place is the same sum on both
 *     sides for every spot, a swirl within three tiles is worth a quarter more,
 *     a spot within two of one sat at since the woods turned half, and a blow
 *     that lands in a sitting ends it with nothing come of it;
 *   * each technique costs its Calm and rests, is refused short of Calm, and
 *     does what it says: Seek marks the nearest swirl until it is collected,
 *     Read the Sky says the wind the island's clock will bring, Trace marks a
 *     hoard of a map in your pack, Foreknow makes the next goes certain
 *     through the clock, Clarity adds to every gain while it lasts; and a Seek
 *     or a Trace that finds nothing costs nothing;
 *   * each discipline does what it says where its rule is: Attentive and
 *     Clarity on what a gain is multiplied by, Reader on a wildermon's blood,
 *     Deep Calm on the cap, Quick Study on the day's first gain, Elemental
 *     Lore on a collect, Deep Reading on a prospector's reach and Polymath on
 *     a knack's chance -- and Keen Sight, Night Eyes and Cartographer on the
 *     browser's sight and map, which are the browser's alone;
 *   * Love and Power keep their steps and their abilities; Knowledge has none;
 *   * and no door is open but the rpc ones.
 *
 * Every roll is seeded: `setseed` on the island and `mulberry32` here.
 */
import { execFileSync } from 'node:child_process';
// `game` first: the root of the module graph, so nothing below comes out half-built.
import { Game } from '../../src/game/game';
import type { ActionDef, Target } from '../../src/game/actions';
import { ACTION_BY_ID, prospectRadius } from '../../src/game/actions';
import {
  CHOOSE_AT, calmCap, calmRefusal, MEDITATION, PATH_LIST, PATH_PICK_BY_ID, PATH_PICKS, PATH_TIER_AT, PATHS, PICKS_PER_TIER, pathPickRefusal,
  SIT_CALM, SIT_GAIN, SIT_STALE_SAID, SIT_SWIRL_SAID, SIT_WORTH, sitPlace, sittingWorth, skySaid, stepsOf, STRUCK_SAID, TECHNIQUE_GAIN, tierSaid, tookSaid, type PathPickDef,
} from '../../src/game/meditation';
import { FAITH_TIER_AT, slotRefusal } from '../../src/game/patrons';
import { favourCap } from '../../src/game/faith';
import { knackChance } from '../../src/game/titles';
import { motesFor } from '../../src/game/motes';
import { mulberry32 } from '../../src/world/noise';
import { DAY_SECONDS } from '../../src/game/pace';

const psql = (sql: string): string =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
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
const q = (v: string): string => `'${v.replace(/'/g, "''")}'`;
const P = (id: string): PathPickDef => {
  const k = PATH_PICK_BY_ID.get(`knowledge_${id}`);
  if (!k) throw new Error(`no pick knowledge_${id}`);
  return k;
};

/* ---- The numbers, the words and the rulebook, on both sides ------------------ */

/** Every kind of spot: the heights either side of high and thin ground, and every yes and no. */
const SPOTS: Array<[boolean, number, boolean, boolean, boolean]> = [];
for (const deed of [false, true]) for (const h of [0, SIT_WORTH.highAt + 5, SIT_WORTH.thinAt + 5]) {
  for (const water of [false, true]) for (const swirl of [false, true]) for (const stale of [false, true]) SPOTS.push([deed, h, water, swirl, stale]);
}
const MEDS = [1, 19.5, 20, 50, 99, 100];
/** Seeds and island hours to read the sky at. */
const SKIES: Array<[number, number]> = [[7, 0], [7, 12345.678], [1234567, 99999.5], [4243, 3600 * 24 * 3 + 17], [42, 777777.25]];
const KNACKS: Array<[string, number]> = [['carpentry', 1], ['swimming', 0.05], ['mining', 0.4]];

const rules = psql(`
begin;
create temp table said (k text, v text);
insert into said values ('NUMS', choose_at() || '|' || picks_per_tier() || '|' || sit_calm() || '|' || sit_gain() || '|' || technique_gain());
insert into said select 'TIERS', string_agg(at::text, ',' order by tier) from path_tier;
insert into said select 'MOVED', string_agg(id || ':' || moved, ',' order by id) from path_def;
insert into said select 'PICKS', jsonb_agg(jsonb_build_object('id', id, 'path', path, 'tier', tier, 'kind', kind, 'name', name,
  'note', note, 'cost', cost, 'rest', rest, 'fx', fx) order by num)::text from path_pick;
insert into said select 'STEPS', string_agg(path || ':' || at || ':' || name || ':' || coalesce(ability, '-') || ':' || coalesce(rest::text, '-'), ',' order by path, n) from path_step;
insert into said select 'PLACE' || o, (s).place || '|' || (s).said
  from (select o, sit_place(d, h, w, sw, st) as s
          from unnest(array[${SPOTS.map((x) => x[0]).join(',')}]::boolean[], array[${SPOTS.map((x) => x[1]).join(',')}]::double precision[],
                      array[${SPOTS.map((x) => x[2]).join(',')}]::boolean[], array[${SPOTS.map((x) => x[3]).join(',')}]::boolean[],
                      array[${SPOTS.map((x) => x[4]).join(',')}]::boolean[]) with ordinality u(d, h, w, sw, st, o)) z;
insert into said select 'CAP', string_agg(calm_cap(m) || ':' || calm_cap(m, ${P('deep_calm').fx.calm}) || ':' || favour_cap(m), ',' order by o)
  from unnest(array[${MEDS.join(',')}]::double precision[]) with ordinality u(m, o);
insert into said select 'SKY' || o, sky_said(s, t, ${P('sky').fx.hours})
  from unnest(array[${SKIES.map((x) => x[0]).join(',')}]::bigint[], array[${SKIES.map((x) => x[1]).join(',')}]::double precision[]) with ordinality u(s, t, o);
insert into said select 'KNACK', string_agg(knack_chance(s, b, ${P('polymath').fx.knack}) || ':' || knack_chance(s, b), ',' order by o)
  from unnest(array[${KNACKS.map((x) => q(x[0])).join(',')}]::text[], array[${KNACKS.map((x) => x[1]).join(',')}]::double precision[]) with ordinality u(s, b, o);
insert into said values ('STEPSOF', path_steps('love', 25) || '|' || path_steps('power', 70) || '|' || path_steps('knowledge', 99) || '|' || path_steps(null, 99));
insert into said values ('SAYS', struck_said() || '|' || sit_swirl_said() || '|' || sit_stale_said());
select k || '=' || v from said order by k;
rollback;
`);
const said = new Map<string, string>();
for (const line of rules.split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) said.set(line.slice(0, i), line.slice(i + 1));
}
const rule = (k: string): string => said.get(k) ?? '(nothing)';

check('the meditation a path is chosen at, the picks to a tier, the Calm and meditation a sitting is worth and what a technique trains, the same on both sides',
  rule('NUMS') === `${CHOOSE_AT}|${PICKS_PER_TIER}|${SIT_CALM}|${SIT_GAIN}|${TECHNIQUE_GAIN}`, rule('NUMS'));
check(`five tiers at ${PATH_TIER_AT.join(', ')} meditation, a patron's own five, chosen at the first`,
  rule('TIERS') === PATH_TIER_AT.join(',') && PATH_TIER_AT.join() === FAITH_TIER_AT.join() && CHOOSE_AT === PATH_TIER_AT[0], rule('TIERS'));
check('Knowledge has moved and Love and Power have not, on both sides',
  rule('MOVED') === [...PATH_LIST].sort((a, b) => a.id.localeCompare(b.id)).map((p) => `${p.id}:${p.moved}`).join(',')
    && PATHS.knowledge.moved && !PATHS.love.moved && !PATHS.power.moved, rule('MOVED'));
{
  const rows = JSON.parse(rule('PICKS')) as Array<Record<string, unknown>>;
  const same = rows.length === PATH_PICKS.length && rows.every((r, i) => {
    const k = PATH_PICKS[i];
    return r.id === k.id && r.path === k.path && r.tier === k.tier && r.kind === k.kind && r.name === k.name && r.note === k.note
      && r.cost === k.cost && r.rest === k.rest && JSON.stringify(r.fx) === JSON.stringify(k.fx);
  });
  check(`the island holds the browser's ${PATH_PICKS.length} picks field for field`, same, same ? '' : rule('PICKS').slice(0, 300));
  const shape = PATH_LIST.filter((p) => p.moved).every((p) => PATH_TIER_AT.every((_, i) => {
    const at = PATH_PICKS.filter((k) => k.path === p.id && k.tier === i + 1);
    return at.length === PICKS_PER_TIER && at[0].kind === 'technique' && at.slice(1).every((k) => k.kind === 'discipline');
  }));
  check('a moved path offers a technique and two disciplines at every tier', shape);
}
check('Love and Power keep their steps, every one as it was, and Knowledge has none, on both sides',
  rule('STEPS').split(',').sort().join(',') === PATH_LIST.flatMap((p) => p.steps.map((s) => `${p.id}:${s.at}:${s.name}:${s.ability?.id ?? '-'}:${s.ability?.rest ?? '-'}`)).sort().join(',')
    && PATHS.love.steps.length === 5 && PATHS.power.steps.length === 5 && PATHS.knowledge.steps.length === 0,
  rule('STEPS').slice(0, 200));
check('the steps behind you: three of Love at 25, five of Power at 70, none of Knowledge however far, on both sides',
  rule('STEPSOF') === `${stepsOf('love', 25)}|${stepsOf('power', 70)}|${stepsOf('knowledge', 99)}|0` && rule('STEPSOF') === '3|5|0|0', rule('STEPSOF'));
{
  const wrong = SPOTS.map((s, i) => {
    const b = sitPlace({ onDeed: s[0], height: s[1], water: s[2], swirl: s[3], stale: s[4] });
    const [place, ...rest] = rule(`PLACE${i + 1}`).split('|');
    return near(Number(place), b.place, 1e-9) && rest.join('|') === b.where ? null : `${s.join(',')}: island ${rule(`PLACE${i + 1}`)}, browser ${b.place}|${b.where}`;
  }).filter((x) => x);
  check(`what a spot is worth and what sitting there says, the same on both sides for every one of ${SPOTS.length} kinds of spot`, !wrong.length, wrong.slice(0, 2).join('; '));
  const swirlOnly = sitPlace({ onDeed: false, height: 0, water: false, swirl: true, stale: false });
  const staleOnly = sitPlace({ onDeed: false, height: 0, water: false, swirl: false, stale: true });
  check(`a swirl within reach is ${SIT_WORTH.swirl} times a sitting and one within reach of a spot sat at is ${SIT_WORTH.stale}, and both say so`,
    near(swirlOnly.place, SIT_WORTH.swirl) && near(staleOnly.place, SIT_WORTH.stale) && swirlOnly.where.endsWith(SIT_SWIRL_SAID) && staleOnly.where.endsWith(SIT_STALE_SAID));
}
check('what a blow in a sitting says, and what a swirl and a spot sat at add, in the same words on both sides',
  rule('SAYS') === `${STRUCK_SAID}|${SIT_SWIRL_SAID}|${SIT_STALE_SAID}`, rule('SAYS'));
{
  const caps = rule('CAP').split(',').map((c) => c.split(':').map(Number));
  check(`Calm holds what favour holds at the same level, and a Deep Calm ${P('deep_calm').fx.calm} times that, on both sides`,
    caps.length === MEDS.length && caps.every(([c, d, f], i) => near(c, calmCap(MEDS[i]), 1e-6) && near(d, calmCap(MEDS[i], P('deep_calm').fx.calm), 1e-6)
      && near(f, favourCap(MEDS[i]), 1e-6) && near(calmCap(MEDS[i]), favourCap(MEDS[i]))), rule('CAP'));
}
{
  const wrong = SKIES.map(([s, t], i) => (rule(`SKY${i + 1}`) === skySaid(s, t, P('sky').fx.hours) ? null : `${s}@${t}: island "${rule(`SKY${i + 1}`)}", browser "${skySaid(s, t, P('sky').fx.hours)}"`))
    .filter((x) => x);
  check('the wind ahead, as Read the Sky says it, is the same on both sides for every seed and hour asked', !wrong.length, wrong.slice(0, 1).join('; '));
}
{
  const ks = rule('KNACK').split(',').map((c) => c.split(':').map(Number));
  check(`a Polymath's knack chance is ${P('polymath').fx.knack} times anybody's, on both sides`,
    ks.length === KNACKS.length && ks.every(([m, plain], i) => near(m, knackChance(KNACKS[i][0], KNACKS[i][1], P('polymath').fx.knack), 1e-12)
      && near(plain, knackChance(KNACKS[i][0], KNACKS[i][1]), 1e-12) && near(m, plain * P('polymath').fx.knack, 1e-12)), rule('KNACK'));
}

/* ---- On the island ------------------------------------------------------------ */

/** The suite's own pick of Love's, to be refused: Love has not moved. */
const LOVE_TEST: PathPickDef = { id: 'love_test', path: 'love', tier: 1, kind: 'technique', name: 'Test', note: 'Nothing.', cost: 5, rest: 30, fx: {} };
/** Where the suite puts the swirls and the hoard for Seek and Trace, off where the body sits. */
const SWIRL_NEAR: [number, number] = [5, 0];
const SWIRL_FAR: [number, number] = [9, 0];
const HOARD_AT: [number, number] = [6, 8];
/** Calm enough for any one technique and some over: more than the dearest costs. */
const CALM = Math.max(...PATH_PICKS.map((k) => k.cost)) + 10;
const DISCIPLINES_A = ['attentive', 'keen', 'quick_study', 'cartographer', 'night_eyes'].map((id) => `knowledge_${id}`);
const DISCIPLINES_B = ['reader', 'deep_calm', 'lore', 'deep_reading', 'polymath'].map((id) => `knowledge_${id}`);
const TECHNIQUE_IDS = ['seek', 'sky', 'trace', 'foreknow', 'clarity'].map((id) => `knowledge_${id}`);

const out = psql(`
begin;
select setseed(0.42);
create temp table said (k text, v text);
insert into path_pick values ('${LOVE_TEST.id}', 'love', 1, 999, 'technique', 'Test', 'Nothing.', ${LOVE_TEST.cost}, ${LOVE_TEST.rest}, '{}');
create function pg_temp.hold(w uuid, u uuid, ids text[]) returns void language plpgsql as $f$
begin
  delete from path_taken where world_id = w and uid = u;
  insert into path_taken (world_id, uid, pick, took) select w, u, x, now() + make_interval(secs => o) from unnest(ids) with ordinality z(x, o);
end $f$;
create function pg_temp.med(w uuid, u uuid, v double precision) returns void language sql as $f$
  insert into skill (world_id, uid, id, value) values (w, u, meditation_skill(), v)
    on conflict (world_id, uid, id) do update set value = excluded.value
$f$;
create function pg_temp.motes(w uuid, u uuid) returns bigint language sql as $f$
  select coalesce(sum(count), 0) from item where world_id = w and holder_uid = u and def = 'fire_mote'
$f$;
do $b$
declare w record; u uuid; r jsonb; tx int; ty int; v_a double precision; v_b double precision; v_c double precision;
        v_map bigint; v_other bigint; v_n int; v_t text; v_day bigint; s record;
begin
  select p.world_id, p.uid, wd.spawn_x, wd.spawn_y, wd.seed into w from player p join world wd on wd.id = p.world_id
   order by wd.size desc, p.world_id, p.uid limit 1;
  u := w.uid;
  tx := w.spawn_x; ty := w.spawn_y;
  -- A clean slate: no path, no Calm, nothing sat or cast, standing at the spawn, nothing on the bar or in hand.
  update player set way = null, calm = 0, sat_spots = '[]'::jsonb, sat_dawn = null, sat_at = null, foreknow = 0, clarity_until = null,
         studied = '{}'::jsonb, path_marks = '{}'::jsonb, struck_at = null, spell_bar = '[]'::jsonb, used_at = '{}'::jsonb,
         knacks = '{}'::jsonb, rested = 0, boons = '[]'::jsonb, blessings = '{}'::jsonb, act = null, act_target = null, act_queue = '[]'::jsonb,
         x = tx + 0.5, y = ty + 0.5, level = 0, away = false, aboard = null
   where world_id = w.world_id and uid = u;
  delete from path_taken where world_id = w.world_id and uid = u;
  delete from event where uid = u;
  delete from deed where world_id = w.world_id and abs(x - tx) <= radius + 3 and abs(y - ty) <= radius + 3;
  delete from mote_swirl where world_id = w.world_id;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);

  -- Choosing: not at nineteen, at twenty; and somebody who chose at five keeps their path.
  perform pg_temp.med(w.world_id, u, ${CHOOSE_AT - 1});
  insert into said values ('CHOOSE19', coalesce(faith_refusal(w.world_id, u, 'choose_path', '{"kind":"tile","material":"knowledge"}'), 'ALLOWED'));
  perform pg_temp.med(w.world_id, u, ${CHOOSE_AT});
  insert into said values ('CHOOSE20', coalesce(faith_refusal(w.world_id, u, 'choose_path', '{"kind":"tile","material":"knowledge"}'), 'ALLOWED'));
  perform perform_faith(w.world_id, u, 'choose_path', '{"kind":"tile","material":"knowledge"}');
  insert into said select 'WAY', coalesce(way, 'none') from player where world_id = w.world_id and uid = u;
  perform pg_temp.med(w.world_id, u, 5);
  insert into said values ('OLD', coalesce(faith_refusal(w.world_id, u, 'choose_path', '{"kind":"tile","material":"love"}'), 'ALLOWED')
    || '|' || (select way from player where world_id = w.world_id and uid = u)
    || '|' || coalesce(path_said(w.world_id, u)->>'way', 'none'));

  -- Picks: a tier not open to an old walker at five, no path, another path's, a path on its steps.
  delete from caller where uid = u;
  insert into said values ('TIER5', rpc_take_path_pick(w.world_id, 'knowledge_seek')->>'why');
  update player set way = null where world_id = w.world_id and uid = u;
  insert into said values ('NOPATH', rpc_take_path_pick(w.world_id, 'knowledge_seek')->>'why');
  update player set way = 'love' where world_id = w.world_id and uid = u;
  insert into said values ('OTHERS', rpc_take_path_pick(w.world_id, 'knowledge_seek')->>'why');
  insert into said values ('ONSTEPS', rpc_take_path_pick(w.world_id, '${LOVE_TEST.id}')->>'why');
  update player set way = 'knowledge' where world_id = w.world_id and uid = u;
  perform pg_temp.med(w.world_id, u, ${PATH_TIER_AT[0] + 5});
  delete from caller where uid = u;
  delete from event where uid = u;
  r := rpc_take_path_pick(w.world_id, 'knowledge_seek');
  insert into said values ('TOOK', coalesce(r->>'took', 'none') || '|' || (r->'bar')::text || '|' || (r->'pathSpells')::text || '|'
    || (r->'path'->'taken')::text || '|' || coalesce((select text from event where uid = u order by n desc limit 1), 'nothing said'));
  insert into said values ('SHUT', rpc_take_path_pick(w.world_id, 'knowledge_attentive')->>'why');
  insert into said values ('HAVE', rpc_take_path_pick(w.world_id, 'knowledge_seek')->>'why');
  insert into said values ('TIER2', rpc_take_path_pick(w.world_id, 'knowledge_keen')->>'why');
  r := rpc_faith(w.world_id);
  insert into said values ('WHYS', (r->'path'->'picks')::text);
  insert into said values ('PATHSAID', (r->'path')::text);
  delete from caller where uid = u;
  insert into said values ('BARCLASS', rpc_spell_bar(w.world_id, 0, 'knowledge_seek')->>'why');

  -- A sitting: Calm banked off the place, then the same spot again (half), the woods turned (whole), a swirl near (a quarter more), the cap.
  update player set calm = 0, sat_spots = '[]'::jsonb, sat_dawn = null where world_id = w.world_id and uid = u;
  select * into s from sitting_worth(w.world_id, u);
  insert into said values ('WORTH0', s.place || '|' || s.gain || '|' || s.calm);
  delete from event where uid = u;
  perform perform_faith(w.world_id, u, 'meditate', jsonb_build_object('kind', 'tile', 'x', tx, 'y', ty));
  insert into said select 'SAT1', calm || '|' || floor(player_calm_cap(w.world_id, u)) || '|'
    || coalesce((select text from event e where e.uid = u and e.kind = 'event' order by n desc limit 1), 'nothing said') || '|' || sat_spots::text
    from player where world_id = w.world_id and uid = u;
  select * into s from sitting_worth(w.world_id, u);
  insert into said values ('STALE', s.place::text);
  update player set x = tx + 0.5 + ${SIT_WORTH.staleReach + 1} where world_id = w.world_id and uid = u;
  select * into s from sitting_worth(w.world_id, u);
  insert into said values ('AWAY', s.place::text);
  update player set x = tx + 0.5, sat_dawn = tree_last_dawn() - interval '1 day' where world_id = w.world_id and uid = u;
  select * into s from sitting_worth(w.world_id, u);
  insert into said values ('TURNED', s.place::text);
  insert into mote_swirl (world_id, x, y, element, region) values (w.world_id, tx + ${SIT_WORTH.swirlReach}, ty, 'fire', region_of(tx + ${SIT_WORTH.swirlReach}, ty));
  select * into s from sitting_worth(w.world_id, u);
  insert into said values ('SWIRL', s.place || '|' || s.said);
  delete from mote_swirl where world_id = w.world_id;
  update player set calm = player_calm_cap(w.world_id, u) - 1, sat_spots = '[]'::jsonb where world_id = w.world_id and uid = u;
  perform perform_faith(w.world_id, u, 'meditate', jsonb_build_object('kind', 'tile', 'x', tx, 'y', ty));
  insert into said select 'CAPPED', calm || '|' || player_calm_cap(w.world_id, u) from player where world_id = w.world_id and uid = u;
  -- A sitting across a tier says it is open.
  perform pg_temp.med(w.world_id, u, ${PATH_TIER_AT[1]} - 0.0001);
  delete from event where uid = u;
  perform perform_faith(w.world_id, u, 'meditate', jsonb_build_object('kind', 'tile', 'x', tx, 'y', ty));
  insert into said select 'OPENED', coalesce(string_agg(text, '|' order by n), 'nothing') from event where uid = u and kind = 'system';
  -- And the beat says the path.
  delete from caller where uid = u;
  insert into said values ('BEAT', (rpc_settle(p_world => w.world_id)->'path')::text);

  -- Stillness: a blow in a sitting with nothing behind it ends it; with a queue behind it, its go comes due and gives nothing.
  update player set act = 'meditate', act_target = jsonb_build_object('kind', 'tile', 'x', tx, 'y', ty), act_started = now() - interval '5 seconds',
         act_ends = now() + interval '20 seconds', act_left = 1, act_goes = 1, act_queue = '[]'::jsonb,
         stats = coalesce(stats, '{}'::jsonb) - 'hurtBy' || '{"health": 1}'::jsonb, wounds = '[]'::jsonb
   where world_id = w.world_id and uid = u;
  delete from event where uid = u;
  perform hurt_player(w.world_id, u, 0.02, 'Something strikes you');
  insert into said select 'STRUCK', coalesce(act, 'none') || '|' || (select count(*) from event e where e.uid = u and e.text = struck_said())
    from player where world_id = w.world_id and uid = u;
  update player set act = 'meditate', act_started = now() - interval '5 seconds', act_ends = now() + interval '20 seconds', act_left = 1,
         act_queue = '[{"action": "meditate", "target": {"kind": "tile"}}]'::jsonb, sat_at = null, calm = 0
   where world_id = w.world_id and uid = u;
  perform sitting_struck(w.world_id, u);
  v_a := skill_of(w.world_id, u, meditation_skill());
  perform perform_faith(w.world_id, u, 'meditate', jsonb_build_object('kind', 'tile', 'x', tx, 'y', ty));
  insert into said select 'STRUCKQ', (act_ends <= now()) || '|' || (skill_of(w.world_id, u, meditation_skill()) = v_a) || '|' || calm || '|' || coalesce(sat_at::text, 'none')
    from player where world_id = w.world_id and uid = u;
  update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_goes = null, act_queue = '[]'::jsonb
   where world_id = w.world_id and uid = u;

  -- The techniques, one a tier, each on the path slot in its turn.
  perform pg_temp.med(w.world_id, u, 99);
  perform pg_temp.hold(w.world_id, u, array[${TECHNIQUE_IDS.map(q).join(', ')}]);
  -- Seek: the nearer of two swirls, its Calm and its rest; refused while it rests and short of Calm; a mark until it is collected.
  insert into mote_swirl (world_id, x, y, element, region) values
    (w.world_id, tx + ${SWIRL_FAR[0]}, ty + ${SWIRL_FAR[1]}, 'fire', 0), (w.world_id, tx + ${SWIRL_NEAR[0]}, ty + ${SWIRL_NEAR[1]}, 'ice', 0);
  update player set calm = ${CALM}, used_at = '{}'::jsonb where world_id = w.world_id and uid = u;
  delete from caller where uid = u;
  perform rpc_spell_bar(w.world_id, 5, 'knowledge_seek');
  delete from caller where uid = u;
  r := rpc_cast_spell(w.world_id, 5, '{}'::jsonb);
  insert into said values ('SEEK', coalesce(r->>'said', r->>'why') || '|' || (select calm from player where world_id = w.world_id and uid = u)
    || '|' || coalesce(r->'rest'->>'knowledge_seek', 'none') || '|' || coalesce((path_beat(w.world_id, u)->'seek')::text, 'none'));
  delete from caller where uid = u;
  insert into said values ('RESTING', rpc_cast_spell(w.world_id, 5, '{}'::jsonb)->>'why');
  update player set used_at = '{}'::jsonb, calm = 2 where world_id = w.world_id and uid = u;
  delete from caller where uid = u;
  insert into said values ('POOR', rpc_cast_spell(w.world_id, 5, '{}'::jsonb)->>'why');
  delete from mote_swirl where world_id = w.world_id and x = tx + ${SWIRL_NEAR[0]};
  insert into said values ('COLLECTED', coalesce((path_beat(w.world_id, u)->'seek')::text, 'none'));
  delete from mote_swirl where world_id = w.world_id;
  update player set calm = ${CALM} where world_id = w.world_id and uid = u;
  delete from caller where uid = u;
  r := rpc_cast_spell(w.world_id, 5, '{}'::jsonb);
  insert into said values ('SEEKNONE', (r->>'why') || '|' || (select calm from player where world_id = w.world_id and uid = u)
    || '|' || coalesce((select used_at->>'spell:knowledge_seek' from player where world_id = w.world_id and uid = u), 'not rested'));

  -- Read the Sky: the wind of the next hours of this island's clock.
  delete from caller where uid = u;
  perform rpc_spell_bar(w.world_id, 5, 'knowledge_sky');
  delete from caller where uid = u;
  r := rpc_cast_spell(w.world_id, 5, '{}'::jsonb);
  insert into said values ('SKY', coalesce(r->>'said', r->>'why') || '|' || (select calm from player where world_id = w.world_id and uid = u)
    || '|' || coalesce(r->'rest'->>'knowledge_sky', 'none'));
  insert into said values ('SKYAT', w.seed || '|' || world_time(w.world_id));

  -- Trace: a hoard of a map in the pack, not one of a map that is not; marked until it is dug up.
  update player set calm = ${CALM} where world_id = w.world_id and uid = u;
  insert into item (world_id, holder, holder_uid, def, ql) values (w.world_id, 'player', u, 'treasure_map', 50) returning id into v_map;
  insert into item (world_id, holder, holder_uid, def, ql) values (w.world_id, 'ground', null, 'treasure_map', 50) returning id into v_other;
  insert into treasure (item_id, world_id, x, y, tier) values (v_map, w.world_id, tx + ${HOARD_AT[0]}, ty + ${HOARD_AT[1]}, 'worn'),
    (v_other, w.world_id, tx + 1, ty, 'worn');
  delete from caller where uid = u;
  perform rpc_spell_bar(w.world_id, 5, 'knowledge_trace');
  delete from caller where uid = u;
  r := rpc_cast_spell(w.world_id, 5, '{}'::jsonb);
  insert into said values ('TRACE', coalesce(r->>'said', r->>'why') || '|' || (select calm from player where world_id = w.world_id and uid = u)
    || '|' || coalesce(r->'rest'->>'knowledge_trace', 'none') || '|' || coalesce((path_beat(w.world_id, u)->'trace')::text, 'none'));
  delete from treasure where item_id = v_map;
  insert into said values ('DUG', coalesce((path_beat(w.world_id, u)->'trace')::text, 'none'));
  update player set used_at = '{}'::jsonb where world_id = w.world_id and uid = u;
  delete from caller where uid = u;
  insert into said values ('TRACENONE', rpc_cast_spell(w.world_id, 5, '{}'::jsonb)->>'why');

  -- Foreknow: five goes that cannot fail, spent a go at a time through the clock.
  update player set calm = ${CALM} where world_id = w.world_id and uid = u;
  delete from caller where uid = u;
  perform rpc_spell_bar(w.world_id, 5, 'knowledge_foreknow');
  delete from caller where uid = u;
  r := rpc_cast_spell(w.world_id, 5, '{}'::jsonb);
  insert into said values ('FORE', coalesce(r->>'said', r->>'why') || '|' || (select calm || '|' || foreknow from player where world_id = w.world_id and uid = u)
    || '|' || coalesce(r->'rest'->>'knowledge_foreknow', 'none'));

  -- Clarity: half again on what every gain is multiplied by, while it lasts.
  update player set calm = ${CALM} where world_id = w.world_id and uid = u;
  perform pg_temp.hold(w.world_id, u, array[${TECHNIQUE_IDS.map(q).join(', ')}]);
  v_a := skill_mult(w.world_id, u, 'mining');
  delete from caller where uid = u;
  perform rpc_spell_bar(w.world_id, 5, 'knowledge_clarity');
  delete from caller where uid = u;
  r := rpc_cast_spell(w.world_id, 5, '{}'::jsonb);
  v_b := skill_mult(w.world_id, u, 'mining');
  insert into said values ('CLARITY', coalesce(r->>'said', r->>'why') || '|' || (select calm from player where world_id = w.world_id and uid = u)
    || '|' || coalesce(r->'rest'->>'knowledge_clarity', 'none') || '|' || v_a || '|' || v_b
    || '|' || (select extract(epoch from clarity_until - now()) from player where world_id = w.world_id and uid = u));
  update player set clarity_until = null where world_id = w.world_id and uid = u;

  -- The disciplines, five at a time, one a tier.
  perform pg_temp.hold(w.world_id, u, array[]::text[]);
  v_a := skill_mult(w.world_id, u, 'mining');
  insert into said values ('CALM0', player_calm_cap(w.world_id, u) || '|' || skill_of(w.world_id, u, meditation_skill()));
  perform pg_temp.hold(w.world_id, u, array[${DISCIPLINES_A.map(q).join(', ')}]);
  v_b := skill_mult(w.world_id, u, 'mining');
  insert into said values ('ATTENTIVE', v_a || '|' || v_b || '|' || skill_mult(w.world_id, u, meditation_skill()));
  v_day := floor(world_time(w.world_id) / day_seconds())::bigint;
  v_a := path_first(w.world_id, u, 'mining');
  v_b := path_first(w.world_id, u, 'mining');
  v_c := path_first(w.world_id, u, 'digging');
  insert into said values ('STUDY', v_a || '|' || v_b || '|' || v_c || '|'
    || ((select studied->>'mining' from player where world_id = w.world_id and uid = u)::bigint = v_day));
  update player set studied = jsonb_build_object('mining', v_day - 1) where world_id = w.world_id and uid = u;
  insert into said values ('STUDYNEXT', path_first(w.world_id, u, 'mining')::text);
  insert into said values ('HELD', (path_beat(w.world_id, u)->'picks')::text || '|' || path_fx(w.world_id, u, 'sight', 1) || '|' || path_fx(w.world_id, u, 'dark', 1)
    || '|' || path_fx(w.world_id, u, 'reveal', 0));
  -- Reader: every trait at husbandry one, where without it only the common ones.
  insert into skill (world_id, uid, id, value) values (w.world_id, u, 'animal_husbandry', 1)
    on conflict (world_id, uid, id) do update set value = 1;
  insert into said select 'READ0', coalesce(array_length(blood_seen(w.world_id, u, array_agg(id)), 1), 0) || '|' || count(*) from trait_def;
  perform pg_temp.hold(w.world_id, u, array[${DISCIPLINES_B.map(q).join(', ')}]);
  insert into said select 'READ', coalesce(array_length(blood_seen(w.world_id, u, array_agg(id)), 1), 0) || '|' || count(*) from trait_def;
  insert into said values ('DEEPCALM', player_calm_cap(w.world_id, u)::text);
  insert into said values ('POLYMATH', path_fx(w.world_id, u, 'knack', 1)::text);
  -- Elemental Lore: a mote more than Elementalism gives.
  insert into skill (world_id, uid, id, value) values (w.world_id, u, elementalism_skill(), 1)
    on conflict (world_id, uid, id) do update set value = 1;
  insert into mote_swirl (world_id, x, y, element, region) values (w.world_id, tx, ty, 'fire', 0);
  v_n := pg_temp.motes(w.world_id, u);
  perform perform_swirl(w.world_id, u, 'collect_motes', jsonb_build_object('kind', 'tile', 'x', tx, 'y', ty));
  insert into said values ('LORE', (pg_temp.motes(w.world_id, u) - v_n)::text);
  -- Deep Reading: the prospector's reach, read off what the island says it read.
  insert into skill (world_id, uid, id, value) values (w.world_id, u, 'prospecting', 1)
    on conflict (world_id, uid, id) do update set value = 1;
  delete from event where uid = u;
  perform perform_ground(w.world_id, u, 'prospect', jsonb_build_object('kind', 'tile', 'x', tx, 'y', ty));
  insert into said select 'READING', string_agg(text, ' ' order by n) from event where uid = u and kind = 'event';

  -- Foreknow through the clock: a go's every roll succeeds, and each go that rolled spends one.
  perform pg_temp.hold(w.world_id, u, array[${TECHNIQUE_IDS.map(q).join(', ')}]);
  create temp table rolled (n serial, ok boolean, fore text);
  execute $x$
    create or replace function perform_swirl(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns void
     language plpgsql as $f$
     begin
       insert into rolled (ok, fore) values (skill_check(1, 1000) and skill_check(1, 1000), coalesce(current_setting('wurm.foreknow', true), ''));
     end $f$
  $x$;
  update player set foreknow = ${P('foreknow').fx.goes} where world_id = w.world_id and uid = u;
  for v_n in 1..${P('foreknow').fx.goes + 1} loop
    update player set act = 'collect_motes', act_target = jsonb_build_object('kind', 'tile', 'x', tx, 'y', ty),
           act_started = now() - interval '2 seconds', act_ends = now() - interval '1 second', act_left = 1, act_goes = 1, act_queue = '[]'::jsonb
     where world_id = w.world_id and uid = u;
    perform settle(w.world_id, u);
  end loop;
  insert into said select 'FOREGO', string_agg(fore || ':' || case when fore = 'on' then ok::text else '-' end, ',' order by n)
    || '|' || (select foreknow from player where world_id = w.world_id and uid = u) from rolled;
  insert into said values ('FORESET', coalesce(current_setting('wurm.foreknow', true), '') || '|' || coalesce(current_setting('wurm.foreknown', true), ''));

  -- Love and Power keep their steps and abilities; Knowledge has none.
  update player set way = 'love' where world_id = w.world_id and uid = u;
  perform pg_temp.med(w.world_id, u, 25);
  insert into said values ('LOVE', walks(w.world_id, u, 'love', 3) || '|' || coalesce((ability_of(w.world_id, u, 'refresh')).name, 'none')
    || '|' || coalesce(faith_refusal(w.world_id, u, 'use_ability', '{"kind":"tile","material":"refresh"}'), 'ALLOWED'));
  update player set way = 'power' where world_id = w.world_id and uid = u;
  perform pg_temp.med(w.world_id, u, 70);
  insert into said values ('POWER', walks(w.world_id, u, 'power', 5) || '|' || coalesce((ability_of(w.world_id, u, 'fury')).name, 'none'));
  update player set way = 'knowledge' where world_id = w.world_id and uid = u;
  insert into said values ('KNOW', walks(w.world_id, u, 'knowledge', 1) || '|' || coalesce((ability_of(w.world_id, u, 'sense')).name, 'none')
    || '|' || coalesce((ability_of(w.world_id, u, 'recall')).name, 'none') || '|' || work_ability(w.world_id, u, 'sense'));
end $b$;
insert into said select 'OPEN', count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname <> 'rpc_name_free'
    and (has_function_privilege('anon', p.oid, 'execute')
         or (p.proname not like 'rpc\\_%' and has_function_privilege('authenticated', p.oid, 'execute')));
insert into said select 'DOOR', count(*)::text from pg_proc p
  where p.proname = 'rpc_take_path_pick' and has_function_privilege('authenticated', p.oid, 'execute') and p.prosecdef;
select k || '=' || v from said order by k;
rollback;
`);
const isle = new Map<string, string>();
for (const line of out.split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) isle.set(line.slice(0, i), line.slice(i + 1));
}
const at = (k: string): string => isle.get(k) ?? '(nothing)';
const part = (k: string, n: number): string => at(k).split('|')[n] ?? '(nothing)';

check(`a path is not chosen at ${CHOOSE_AT - 1} meditation, in the browser's words`, at('CHOOSE19') === `Sit until you have ${CHOOSE_AT} meditation behind you.`, at('CHOOSE19'));
check(`and is at ${CHOOSE_AT}`, at('CHOOSE20') === 'ALLOWED' && at('WAY') === 'knowledge', `${at('CHOOSE20')} / ${at('WAY')}`);
check('somebody who chose before keeps their path at five meditation, and may not choose again',
  part('OLD', 0) === 'You have chosen, and it is not the sort of thing that is chosen twice.' && part('OLD', 1) === 'knowledge' && part('OLD', 2) === 'knowledge', at('OLD'));

const seek = P('seek');
check('and a pick at a tier not open to them yet is refused, in the same words on both sides',
  at('TIER5') === pathPickRefusal(seek, 'knowledge', [], 5), at('TIER5'));
check('a pick with no path is refused, ditto', at('NOPATH') === pathPickRefusal(seek, null, [], CHOOSE_AT + 5), at('NOPATH'));
check('and another path’s, ditto', at('OTHERS') === pathPickRefusal(seek, 'love', [], CHOOSE_AT + 5), at('OTHERS'));
check('and one of a path still on its steps, ditto', at('ONSTEPS') === pathPickRefusal(LOVE_TEST, 'love', [], CHOOSE_AT + 5, [...PATH_PICKS, LOVE_TEST]), at('ONSTEPS'));
check('a pick at an open tier is taken, said in the browser\'s words, and a technique goes on the path slot of the bar',
  at('TOOK') === `${seek.id}|[null, null, null, null, null, "${seek.id}"]|["${seek.id}"]|["${seek.id}"]|${tookSaid(seek)}`, at('TOOK'));
check('and the others of its tier close, ditto', at('SHUT') === pathPickRefusal(P('attentive'), 'knowledge', [seek.id], CHOOSE_AT + 5), at('SHUT'));
check('and it is not taken twice, ditto', at('HAVE') === pathPickRefusal(seek, 'knowledge', [seek.id], CHOOSE_AT + 5), at('HAVE'));
check('and the next tier waits for its meditation, ditto', at('TIER2') === pathPickRefusal(P('keen'), 'knowledge', [seek.id], CHOOSE_AT + 5), at('TIER2'));
{
  const whys = JSON.parse(at('WHYS')) as Record<string, string | null>;
  const wrong = PATH_PICKS.filter((k) => k.path === 'knowledge').filter((k) => (whys[k.id] ?? null) !== pathPickRefusal(k, 'knowledge', [seek.id], CHOOSE_AT + 5));
  check('the Faith window is told why every pick of the path is refused, in the browser\'s words', !wrong.length, wrong.map((k) => `${k.id}: ${whys[k.id]}`).join('; '));
  const ps = JSON.parse(at('PATHSAID')) as { way: string; meditation: number; calm: number; cap: number; taken: string[] };
  check('and the path, the meditation, Calm and its cap', ps.way === 'knowledge' && ps.meditation === CHOOSE_AT + 5 && ps.calm === 0
    && ps.cap === Math.floor(calmCap(CHOOSE_AT + 5)) && JSON.stringify(ps.taken) === JSON.stringify([seek.id]), at('PATHSAID'));
}
check('a technique will not go in a class slot, in the same words on both sides', at('BARCLASS') === slotRefusal(0, seek.id, [seek.id]), at('BARCLASS'));

{
  const [place0, gain0, calm0] = at('WORTH0').split('|').map(Number);
  const [calm1, cap1] = [Number(part('SAT1', 0)), Number(part('SAT1', 1))];
  check(`a sitting banks ${SIT_CALM} Calm times its place and trains meditation by ${SIT_GAIN} times it`,
    near(gain0, SIT_GAIN * place0) && near(calm0, SIT_CALM * place0) && calm0 < cap1 && near(calm1, calm0, 1e-4),
    at('WORTH0') + ' / ' + at('SAT1').slice(0, 80));
  check('and says what it banked out of what it holds',
    part('SAT1', 2).endsWith(` Calm ${Math.floor(calm1)} of ${part('SAT1', 1)}.`), part('SAT1', 2));
  check(`a second sitting within ${SIT_WORTH.staleReach} tiles of the first, before the woods turn, is worth ${SIT_WORTH.stale} of it`,
    near(Number(at('STALE')), place0 * SIT_WORTH.stale), `${at('STALE')} against ${place0}`);
  check(`and one ${SIT_WORTH.staleReach + 1} tiles off is not`, near(Number(at('AWAY')), place0), at('AWAY'));
  check('and once the woods have turned the spot is fresh again', near(Number(at('TURNED')), place0), at('TURNED'));
  check(`a mote swirl ${SIT_WORTH.swirlReach} tiles off is worth ${SIT_WORTH.swirl} times a sitting, and the sitting says so`,
    near(Number(part('SWIRL', 0)), place0 * SIT_WORTH.swirl) && at('SWIRL').endsWith(SIT_SWIRL_SAID), at('SWIRL'));
  const [held, cap] = at('CAPPED').split('|').map(Number);
  check('Calm stops at the cap however much a sitting is worth', near(held, cap, 1e-3), at('CAPPED'));
}
check('a sitting across a tier says it is open, in the browser\'s words', at('OPENED') === tierSaid('knowledge', 2), at('OPENED'));
{
  const beat = JSON.parse(at('BEAT')) as { way?: string; picks?: string[]; calm?: number; sat?: unknown[] };
  check('the beat says the path, its picks, Calm and the spots sat at', beat.way === 'knowledge' && JSON.stringify(beat.picks) === JSON.stringify([seek.id])
    && typeof beat.calm === 'number' && Array.isArray(beat.sat) && beat.sat.length > 0, at('BEAT'));
}
check('a blow that lands in a sitting ends it and says so', at('STRUCK') === 'none|1', at('STRUCK'));
check('and with a job behind it, the sitting comes due at once and gives nothing: no meditation, no Calm, no rest begun',
  at('STRUCKQ') === 'true|true|0|none', at('STRUCKQ'));

{
  const sk = P('sky');
  const tr = P('trace');
  const fk = P('foreknow');
  const cl = P('clarity');
  const d = (x: number, y: number): number => Math.round(Math.hypot(x, y));
  check(`Seek finds the nearer swirl, ${d(...SWIRL_NEAR)} tiles off, costs its ${seek.cost} Calm, rests ${seek.rest} seconds and marks it`,
    at('SEEK').startsWith(`The nearest mote swirl is ${d(...SWIRL_NEAR)} tiles off, an ice mote swirl. It is marked on your map.|${CALM - seek.cost}|${seek.rest}|`)
      && part('SEEK', 3) !== 'none', at('SEEK'));
  check('and while it rests it is refused', at('RESTING') === `${seek.name} can be called again in ${seek.rest} seconds.`, at('RESTING'));
  check('short of Calm it is refused, in the same words on both sides', at('POOR') === calmRefusal(seek.name, seek.cost, 2), at('POOR'));
  check('the mark goes once the swirl is collected', at('COLLECTED') === 'null', at('COLLECTED'));
  check(`with no swirl within ${seek.fx.reach} tiles it is refused, costs nothing and does not rest`,
    at('SEEKNONE') === `There is no mote swirl within ${seek.fx.reach} tiles of you.|${CALM}|not rested`, at('SEEKNONE'));
  const [seed, time] = at('SKYAT').split('|').map(Number);
  check(`Read the Sky says the wind of the next ${sk.fx.hours} hours of the island's clock as the browser works it out, for ${sk.cost} Calm, resting ${sk.rest} seconds`,
    at('SKY') === `${skySaid(seed, time, sk.fx.hours)}|${CALM - sk.cost}|${sk.rest}`,
    `${at('SKY')} against ${skySaid(seed, time, sk.fx.hours)}`);
  check(`Trace finds the hoard of the map in the pack ${d(...HOARD_AT)} tiles off, not the nearer one of a map that is not, for ${tr.cost} Calm, resting ${tr.rest} seconds, and marks it`,
    at('TRACE').startsWith(`A hoard buried for a map in your pack is ${d(...HOARD_AT)} tiles off. It is marked on your map.|${CALM - tr.cost}|${tr.rest}|`)
      && part('TRACE', 3) !== 'none', at('TRACE'));
  check('the mark goes once the hoard is dug up', at('DUG') === 'null', at('DUG'));
  check('and with none within reach it is refused', at('TRACENONE') === `No hoard of a map in your pack is buried within ${tr.fx.reach} tiles of you.`, at('TRACENONE'));
  check(`Foreknow sets ${fk.fx.goes} goes, for ${fk.cost} Calm, resting ${fk.rest} seconds`,
    at('FORE') === `Your next five goes that roll for success will succeed.|${CALM - fk.cost}|${fk.fx.goes}|${fk.rest}`, at('FORE'));
  check(`through the clock, each of ${fk.fx.goes} goes cannot fail a roll and spends one; the next is rolled again`,
    at('FOREGO') === `${Array.from({ length: fk.fx.goes }, () => 'on:true').join(',')},:-|0`, at('FOREGO'));
  check('and nothing of it is left set once the clock is done', at('FORESET') === '|', at('FORESET'));
  const [mA, mB] = [Number(part('CLARITY', 3)), Number(part('CLARITY', 4))];
  check(`Clarity adds ${cl.fx.more} to what every gain is multiplied by for ${cl.fx.secs} seconds, for ${cl.cost} Calm, resting ${cl.rest} seconds`,
    part('CLARITY', 0) === `For 10 minutes every skill gain you make is 50% larger.` && Number(part('CLARITY', 1)) === CALM - cl.cost
      && Number(part('CLARITY', 2)) === cl.rest && near(mB / mA, 1 + cl.fx.more, 1e-9) && near(Number(part('CLARITY', 5)), cl.fx.secs, 2), at('CLARITY'));
}
{
  const [a, b, medit] = at('ATTENTIVE').split('|').map(Number);
  check(`Attentive adds ${P('attentive').fx.learn} to what every gain is multiplied by, meditation's too`,
    near(b / a, 1 + P('attentive').fx.learn, 1e-9) && medit > 1, at('ATTENTIVE'));
  check(`Quick Study: the first gain of a skill on a day of the island's clock is ${P('quick_study').fx.first} times, the next is not, another skill's first is, and the day is written down`,
    at('STUDY') === `${P('quick_study').fx.first}|1|${P('quick_study').fx.first}|true`, at('STUDY'));
  check('and the next day the first is again', at('STUDYNEXT') === String(P('quick_study').fx.first), at('STUDYNEXT'));
  check('the island holds Keen Sight, Night Eyes and Cartographer and sends them, and reads nothing else of them',
    at('HELD') === `${JSON.stringify(DISCIPLINES_A).replace(/,/g, ', ')}|${P('keen').fx.sight}|${P('night_eyes').fx.dark}|${P('cartographer').fx.reveal}`, at('HELD'));
  const [seen0, all0] = at('READ0').split('|').map(Number);
  const [seen1, all1] = at('READ').split('|').map(Number);
  check('Reader reads every trait at husbandry one, where without it not all of them', seen1 === all1 && seen0 < all0 && all0 > 0, `${at('READ0')} / ${at('READ')}`);
  const [c0, med0] = at('CALM0').split('|').map(Number);
  const c1 = Number(at('DEEPCALM'));
  check(`Deep Calm holds ${P('deep_calm').fx.calm} times the Calm, on both sides`,
    near(c1, c0 * P('deep_calm').fx.calm, 1e-9) && near(c0, calmCap(med0), 1e-6) && near(c1, calmCap(med0, P('deep_calm').fx.calm), 1e-6), `${at('CALM0')} / ${c1}`);
  check(`Polymath's knacks are ${P('polymath').fx.knack} times as likely`, Number(at('POLYMATH')) === P('polymath').fx.knack, at('POLYMATH'));
  check(`Elemental Lore: a collect gives ${P('lore').fx.motes} more than Elementalism one does`, Number(at('LORE')) === motesFor(1) + P('lore').fx.motes, at('LORE'));
  const reach = prospectRadius(1) + P('deep_reading').fx.further;
  check(`Deep Reading: prospecting at one reads ${reach} tiles round you, ${P('deep_reading').fx.further} further`,
    new RegExp(`\\b${reach} tiles`).test(at('READING')), at('READING'));
}
check('Love keeps its steps and its abilities: Gentle hand at 25, and Refresh', at('LOVE') === 'true|Refresh|ALLOWED', at('LOVE'));
check('and Power its: Ironhide at 70, and Fury', at('POWER') === 'true|Fury', at('POWER'));
check('and Knowledge, moved, has no steps and no old abilities; Sense the Rock and Recall the Way are gone', at('KNOW') === 'false|none|none|Nothing happens.', at('KNOW'));
check('no function is open to a player but the doors', at('OPEN') === '0', at('OPEN'));
check('and the pick door is, running as its owner', at('DOOR') === '1', at('DOOR'));

/* ---- In the browser -------------------------------------------------------------- */

const g = Game.create(4243);
g.rand = mulberry32(4243);
g.player.way = 'knowledge';
g.skills.values.set(MEDITATION, 99);
const p = g.player;
const set = (ids: string[]): void => {
  p.picks = ids;
};
{
  const k = P('seek');
  check('the browser refuses a pick in the same words, and takes one', g.takePathPick(P('keen').id) === null && g.takePathPick(P('deep_calm').id) === pathPickRefusal(P('deep_calm'), 'knowledge', [P('keen').id], 99),
    `${p.picks.join(',')}`);
  set([k.id]);
  p.calm = 3;
  check('a technique short of Calm is refused in the island\'s words', g.techniqueRefusal(k.id) === calmRefusal(k.name, k.cost, 3), g.techniqueRefusal(k.id) ?? 'none');
  p.calm = CALM;
  g.setSwirls([{ id: 1, x: p.tileX + SWIRL_FAR[0], y: p.tileY, element: 'fire' }, { id: 2, x: p.tileX + SWIRL_NEAR[0], y: p.tileY, element: 'ice' }]);
  const why = g.castTechnique(k.id);
  check('Seek, playing by yourself: the nearer swirl, marked, its Calm paid and its rest begun',
    why === null && p.calm === CALM - k.cost && g.marksNow().some((m) => m.kind === 'seek' && m.x === p.tileX + SWIRL_NEAR[0])
      && g.techniqueRefusal(k.id) === `${k.name} can be called again in ${k.rest} seconds.`, `${why} ${p.calm}`);
  g.takeSwirl(2);
  check('and the mark goes with the swirl', !g.marksNow().some((m) => m.kind === 'seek'));
}
{
  // Sight: Keen Sight further and further than the furthest; Night Eyes the same at midnight as at noon; Cartographer a disc twice sight.
  const v = g.vision;
  g.islandClock = () => DAY_SECONDS / 2;
  set([]);
  const noon = v.sightRange();
  set([P('keen').id]);
  const keen = v.sightRange();
  check(`Keen Sight sees ${P('keen').fx.sight} times as far`, near(keen, noon * P('keen').fx.sight, 1e-9), `${noon} → ${keen}`);
  g.islandClock = () => 0;
  set([]);
  const night = v.sightRange();
  set([P('night_eyes').id]);
  const eyes = v.sightRange();
  check('Night Eyes see as far at midnight as at noon, where without them the dark takes most of it', night < noon && near(eyes, noon, 1e-9), `${night} / ${eyes} / ${noon}`);
  g.islandClock = () => DAY_SECONDS / 2;
  set([P('cartographer').id]);
  v.invalidate();
  v.update();
  const r = Math.floor(v.sightRange() * P('cartographer').fx.reveal);
  const [cx, cy] = [p.tileX, p.tileY];
  let inDisc = 0;
  let known = 0;
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (!g.world.inBounds(x, y) || Math.hypot(x - cx, y - cy) > r) continue;
    inDisc++;
    if (g.world.seen[y * g.world.w + x]) known++;
  }
  check(`Cartographer: the map remembers every tile within ${P('cartographer').fx.reveal} times your sight of you`, inDisc > 0 && known === inDisc, `${known} of ${inDisc}`);
}
{
  set([]);
  const a = g.skillMult('mining');
  set([P('attentive').id]);
  const b = g.skillMult('mining');
  check('Attentive in the browser adds what it adds on the island', near(b / a, 1 + P('attentive').fx.learn, 1e-9), `${a} → ${b}`);
  set([P('reader').id, P('deep_calm').id, P('lore').id, P('deep_reading').id, P('polymath').id]);
  check('Reader, Deep Calm, Deep Reading and Polymath read in the browser',
    g.holds(P('reader').id) && near(g.calmCap(), calmCap(g.skills.get(MEDITATION), P('deep_calm').fx.calm)) && g.pathFx('further', 0) === P('deep_reading').fx.further
      && g.pathFx('knack', 1) === P('polymath').fx.knack);
  const def = ACTION_BY_ID.get('collect_motes');
  const t: Target = { kind: 'tile', x: p.tileX + 1, y: p.tileY, cx: p.tileX + 1, cy: p.tileY };
  g.setSwirls([{ id: 7, x: t.x, y: t.y, element: 'fire' }]);
  g.skills.values.set('elementalism', 1);
  const held = (): number => g.inventory.items.filter((it) => it.id === 'fire_mote').reduce((n, it) => n + it.count, 0);
  const before = held();
  def?.perform(t, g);
  check('Elemental Lore in the browser: the same mote more', held() - before === motesFor(1) + P('lore').fx.motes, `${held() - before}`);
  // A walker of a path on its steps holds nothing, whatever is in the list.
  p.way = 'love';
  check('a pick of a path you do not walk is nothing', !g.holds(P('reader').id) && g.pathFx('calm', 1) === 1);
  p.way = 'knowledge';
}
{
  // Foreknow through a go: every roll of it succeeds, and the go spends one.
  set([P('foreknow').id]);
  p.calm = CALM;
  p.usedAt = {};
  g.castTechnique(P('foreknow').id);
  g.rand = () => 0.999;
  const rolls: boolean[] = [];
  const job: ActionDef = {
    id: 'test_roll', label: 'Roll', verb: 'rolling', stamina: 0, baseTime: 1, applies: () => true,
    perform: (_t, gg) => { rolls.push(gg.skillCheck('mining', 1000) && gg.skillCheck('mining', 1000)); },
  };
  const tgt: Target = { kind: 'tile', x: p.tileX, y: p.tileY, cx: p.tileX, cy: p.tileY };
  for (let i = 0; i <= P('foreknow').fx.goes; i++) {
    g.action = { def: job, target: tgt, state: 'performing', elapsed: 1, duration: 1 };
    (g as unknown as { completeAction(): void }).completeAction();
  }
  check(`Foreknow in the browser: ${P('foreknow').fx.goes} goes whose every roll succeeds, one spent a go, then the rolls are the dice's again`,
    rolls.slice(0, P('foreknow').fx.goes).every((x) => x) && rolls[P('foreknow').fx.goes] === false && p.foreknow === 0, rolls.join(','));
  g.rand = mulberry32(7);
}
{
  // Stillness in the browser: a blow in a sitting ends it.
  const sit = ACTION_BY_ID.get('meditate');
  if (sit) {
    g.action = { def: sit, target: { kind: 'tile', x: p.tileX, y: p.tileY, cx: p.tileX, cy: p.tileY }, state: 'performing', elapsed: 3, duration: 25 };
    p.attackedAt = g.time - 1;
    (g as unknown as { updateAction(dt: number): void }).updateAction(0.1);
  }
  check('a blow in a sitting ends it in the browser too', g.action === null);
}
{
  // A sitting in the browser: Calm banked off the place, the same spot again half, and a swirl near a quarter more.
  const sit = ACTION_BY_ID.get('meditate');
  const here: Target = { kind: 'tile', x: p.tileX, y: p.tileY, cx: p.tileX, cy: p.tileY };
  g.setSwirls([]);
  p.satSpots = [];
  p.calm = 0;
  p.satAt = -1e9;
  set([]);
  const first = sittingWorth(g);
  sit?.perform(here, g);
  const again = sittingWorth(g);
  g.setSwirls([{ id: 99, x: p.tileX + SIT_WORTH.swirlReach, y: p.tileY, element: 'fire' }]);
  const swirled = sittingWorth(g);
  check('a sitting in the browser banks its Calm, and the spot is worth half until the woods turn, and a quarter more by a swirl',
    near(p.calm, Math.min(g.calmCap(), first.calm), 1e-9) && near(again.place, first.place * SIT_WORTH.stale) && near(swirled.place, again.place * SIT_WORTH.swirl)
      && swirled.where.includes(SIT_SWIRL_SAID) && swirled.where.endsWith(SIT_STALE_SAID), `${first.place} → ${again.place} → ${swirled.place}, Calm ${p.calm}`);
}
check(`the browser says a tier as it opens: ${tierSaid('knowledge', 1)}`, tierSaid('knowledge', 2).includes(P('sky').name));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`meditation's framework and the Knowledge path, the same on both sides — ${ok.length} of ${ok.length}`);
