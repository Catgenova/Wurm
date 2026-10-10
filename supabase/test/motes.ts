/**
 * Elementalism and the mote swirls (`motes.ts`), on both sides.
 *
 * Every turn of the woods takes the day's swirls away and puts `SWIRLS_A_DAY`
 * new ones down, anywhere on the map with room; on water a swirl is water,
 * on land dark or light one time in a hundred each and otherwise the land's
 * own element. Collect motes takes a swirl for good and gives `motesFor` the
 * collector's Elementalism of its element's mote, and trains Elementalism.
 *
 * So this asks, of the island:
 *
 *   * the numbers and the words are the browser's: what a swirl gives at each
 *     level, what a swirl put down is for any roll, each island's element,
 *     the chart itself cell by cell, what collecting says and what Examine says;
 *   * on a world of land, a swirl on each of the seven islands has that
 *     island's element (or is dark or light);
 *   * an island that has never had swirls has the day's the first time
 *     anybody asks, and the dawn's tick replaces them with a new day's and
 *     says so to whoever is about;
 *   * a day's swirls are as many as asked for, one to a tile, on the map,
 *     none on a tree or inside a building, water exactly where there is water
 *     and on land only the land's element, dark or light -- and over thirty
 *     days, about as often as the rule says;
 *   * a collect gives one mote under Elementalism 20 and five from 80, from
 *     the Elementalism before the go, trains it by what one go of it is
 *     worth, takes the swirl, and says so to the block it was in;
 *   * two at one swirl: the first to finish has it and the second is told it
 *     is gone and is given nothing; and a swirl out of reach is refused;
 *
 * and of the browser, on a game of its own: the day's swirls by the same
 * rules, a collect giving the same as the island's and taking the swirl,
 * and the same words on a refusal and on Examine.
 *
 * Everything random is seeded: `setseed` on the island and `mulberry32` here.
 * Runs against the database the suite leaves behind; the island half is
 * rolled back.
 *
 *   npx esbuild supabase/test/motes.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/motes.mjs && node node_modules/.cache/motes.mjs
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import { SKILL_BY_ID, isQuiet, skillGain } from '../../src/game/skills';
import { ITEM_DEFS } from '../../src/game/items';
import { groundSays } from '../../src/game/wildflowers';
import {
  collectedSays, ELEMENTALISM, ISLAND_ELEMENT, LAND_ELEMENTS, landElement, laySwirls, MOTE_ELEMENTS, moteItem, MOTES_LEAST, MOTES_MOST, MOTES_STEP, motesFor,
  motesWord, SWIRL_DARK, SWIRL_DRAWS, SWIRL_LIGHT, SWIRL_SAID, SWIRL_TRIES, swirlElement, swirlSays, SWIRLS_A_DAY, type MoteElement, type Swirl,
} from '../../src/game/motes';
import { REGIONS } from '../../src/world/regions';
import { chartCells, chartRegion } from '../../src/world/chart';
import { TILE_DEFS, TileType } from '../../src/world/tiles';
import { mulberry32 } from '../../src/world/noise';

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

/* ---- the numbers and the words, on both sides ------------------------------ */

const LEVELS = [0, 1, 19.99, 20, 39.9, 40, 59, 60, 79.99, 80, 99, 100];
const motes = psql(`select string_agg(motes_for(v)::text, ' ' order by o) from unnest(array[${LEVELS.join(', ')}]::double precision[]) with ordinality u(v, o)`);
check(`a swirl gives ${MOTES_LEAST} under Elementalism ${MOTES_STEP}, one more each ${MOTES_STEP}, ${MOTES_MOST} from ${(MOTES_MOST - MOTES_LEAST) * MOTES_STEP}, the same on both sides`,
  motes === LEVELS.map(motesFor).join(' ') && motesFor(19.99) === 1 && motesFor(80) === 5 && motesFor(100) === 5 && motesFor(0) === 1,
  `island ${motes}, browser ${LEVELS.map(motesFor).join(' ')}`);

const ROLLS = [0, 0.005, 0.0099, 0.01, 0.015, 0.0199, 0.02, 0.5, 0.999];
const kinds = psql(`select string_agg(swirl_element(w, l, r), ' ' order by w, l, o)
  from unnest(array[false, true]) w, unnest(array[${LAND_ELEMENTS.map((e) => `'${e}'`).join(', ')}]::text[]) l,
       unnest(array[${ROLLS.join(', ')}]::double precision[]) with ordinality q(r, o)`);
const kindsHere = [false, true].flatMap((w) => [...LAND_ELEMENTS].sort().flatMap((l) => ROLLS.map((r) => swirlElement(w, l, r)))).join(' ');
check('what a swirl put down is, for water and every land and every roll, is the same on both sides', kinds === kindsHere, kinds === kindsHere ? '' : `island ${kinds}`);
const nowhere = psql(`select coalesce(swirl_element(false, null, 0.5), 'none') || ' ' || coalesce(swirl_element(false, null, 0.001), 'none') || ' ' || swirl_element(true, null, 0.5)`);
check('land that is no island\'s takes no swirl, not even a dark one, and water is water anywhere, on both sides',
  nowhere === [swirlElement(false, null, 0.5) ?? 'none', swirlElement(false, null, 0.001) ?? 'none', swirlElement(true, null, 0.5)].join(' ') && nowhere === 'none none water', nowhere);

const REGION_IDS = [...REGIONS.keys(), REGIONS.length, 255, -1];
const regions = psql(`select string_agg(coalesce(region_element(r), 'none'), ' ' order by o) from unnest(array[${REGION_IDS.join(', ')}]::int[]) with ordinality u(r, o)`);
check(`each island of the chart has its one land element and a byte that is no island's has none, the same on both sides (${REGIONS.map((R) => `${R.key} ${ISLAND_ELEMENT[R.key]}`).join(', ')})`,
  regions === REGION_IDS.map((r) => landElement(r) ?? 'none').join(' ')
    && REGIONS.every((R) => (LAND_ELEMENTS as readonly string[]).includes(ISLAND_ELEMENT[R.key]))
    && Object.keys(ISLAND_ELEMENT).every((k) => REGIONS.some((R) => R.key === k)),
  `island ${regions}`);
// The chart as the island holds it, cell by cell, against the browser's copy, and the scale both lay a world over it by.
const chart = psql(`select string_agg(encode(cells, 'hex'), '' order by cy) from chart_region`);
const chartHere = Buffer.from(chartCells()).toString('hex');
const scaled = psql(`select string_agg(region_at(w.id, p.x, p.y)::text, ' ' order by p.o)
  from (select id from world where ready order by size desc limit 1) w,
       unnest(array[0, 17.5, 1000.25, 2047.9, 4095.99], array[4095.99, 3000.5, 12.75, 2048, 0]) with ordinality p(x, y, o)`);
const scaledSize = Number(psql(`select size from world where ready order by size desc limit 1`));
const scaledHere = [[0, 4095.99], [17.5, 3000.5], [1000.25, 12.75], [2047.9, 2048], [4095.99, 0]].map(([x, y]) => chartRegion(x, y, scaledSize)).join(' ');
check('the browser reads the same chart as the island, cell by cell, and lays a world over it at the same scale',
  chart === chartHere && scaled === scaledHere, `${chart.length / 2} cells on the island, ${chartHere.length / 2} here; ${scaled} against ${scaledHere} on a ${scaledSize} island`);

const words = psql(`select string_agg(motes_word(n, e), '|' order by o, n) from unnest(array[${MOTE_ELEMENTS.map((e) => `'${e}'`).join(', ')}]::text[]) with ordinality u(e, o), generate_series(1, 5) n`);
const wordsHere = MOTE_ELEMENTS.flatMap((e) => [1, 2, 3, 4, 5].map((n) => motesWord(n, e))).join('|');
check('what a collect gives is said in the same words on both sides ("an ice mote", "three fire motes")', words === wordsHere, words === wordsHere ? '' : `island ${words}`);
const saidIsle = psql(`select swirl_said('ground') || '|' || swirl_said('nothing') || '|' || swirl_said('gone')`);
check('and a refused collect too', saidIsle === [SWIRL_SAID.ground, SWIRL_SAID.nothing, SWIRL_SAID.gone].join('|'), saidIsle);
const consts = psql(`select swirls_a_day() || '|' || swirl_tries() || '|' || swirl_draws() || '|' || swirl_dark() || '|' || swirl_light() || '|' || elementalism_skill()`);
check('as many swirls a day, as many rounds and draws to find room, as much dark and light, and the same skill',
  consts === [SWIRLS_A_DAY, SWIRL_TRIES, SWIRL_DRAWS, SWIRL_DARK, SWIRL_LIGHT, ELEMENTALISM].join('|'), consts);

const defs = psql(`select (select id || ':' || start || ':' || quiet from skill_def where id = 'elementalism')
  || '#' || (select string_agg(id || ':' || name || ':' || stackable || ':' || weight || ':' || coalesce(description, ''), '#' order by id collate "C")
             from item_def where id = any(array[${MOTE_ELEMENTS.map((e) => `'${moteItem(e)}'`).join(', ')}, 'mote']))
  || '#' || act_ported('collect_motes') || ':' || (select count(*) from rpc_unported() u where u::text like '%collect_motes%')`);
const defsHere = [`${ELEMENTALISM}:1:false`,
  ...[...MOTE_ELEMENTS.map(moteItem), 'mote'].sort().map((id) => `${id}:${ITEM_DEFS[id].name}:${!!ITEM_DEFS[id].stackable}:${ITEM_DEFS[id].weight}:${ITEM_DEFS[id].description ?? ''}`),
  'true:0'].join('#');
check('Elementalism is a skill beginning at one that speaks on every go, eight motes are things of their own beside the altar\'s, and collecting is ported',
  defs === defsHere && SKILL_BY_ID.get(ELEMENTALISM)?.start === 1 && !isQuiet(ELEMENTALISM)
    && new Set(MOTE_ELEMENTS.map((e) => ITEM_DEFS[moteItem(e)].name)).size === MOTE_ELEMENTS.length
    && MOTE_ELEMENTS.every((e) => ITEM_DEFS[moteItem(e)].name !== ITEM_DEFS.mote.name && moteItem(e) !== 'mote'),
  defs === defsHere ? '' : `island ${defs.slice(0, 300)}…`);

/* ---- on the island -------------------------------------------------------- */

/*
 * Motes: two hundred and fifty-six square, seed 4243. Land at height ten west
 * of corner 128 and sea at minus ten from it, so every tile from x 127 east
 * has a corner under the sea; a strip of trees along the west edge (x 0 to 9)
 * and a hall on 20..39 by 20..39. Mira and Tobin come ashore at 60, 60.
 */
const MIRA = '7e1e7e1e-0000-4000-8000-000000000001';
const TOBIN = '7e1e7e1e-0000-4000-8000-000000000002';
const BANDS = [1, 19.5, 20, 45, 79.9, 80, 100];
const out = psql(`
begin;
select setseed(0.2718) \\g /dev/null
create temp table said (k text, v text);
do $t$
declare w uuid; w2 uuid; u uuid := '${MIRA}'; v uuid := '${TOBIN}'; j jsonb; v_id bigint; v_old bigint; lvl double precision;
        v_before int; v_after int; s_before double precision; s_after double precision; v_why text; v_t0 timestamptz;
        tgt jsonb := '{"kind":"tile","x":61,"y":60,"cx":61,"cy":60}'::jsonb; i int;
begin
  insert into world (name, seed, size, spawn_x, spawn_y, ready) values ('Motes', 4243, 256, 60, 60, true) returning id into w;
  perform land_blank(w, 256);
  update land_corner set heights = decode(repeat('0a00', 128) || repeat('f6ff', 129), 'hex') where world_id = w;
  update land_tile set tiles = decode(repeat('10', 10) || repeat('00', 246), 'hex') where world_id = w;
  insert into building (world_id, id, name) values (w, 1, 'Hall');
  insert into building_tile (world_id, building, x, y) select w, 1, gx, gy from generate_series(20, 39) gx, generate_series(20, 39) gy;
  insert into said values ('WORLD', w::text);
  perform set_config('request.jwt.claims', json_build_object('sub', v)::text, true);
  perform rpc_join(w, 'Tobin');
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  perform rpc_join(w, 'Mira');

  -- 1. Nobody has asked yet, so there are none; the first to ask has the day's.
  insert into said values ('BEFORE', (select count(*) from mote_swirl where world_id = w)::text);
  delete from realtime.messages;
  j := rpc_swirls(w);
  insert into said values ('FIRST', jsonb_array_length(j) || '|' || (select count(*) from mote_swirl where world_id = w)
    || '|' || exists (select 1 from mote_day where world_id = w));
  -- And asking again does not put another day down.
  j := rpc_swirls(w);
  insert into said values ('AGAIN', jsonb_array_length(j) || '|' || (select count(*) from mote_swirl where world_id = w));

  -- 2. A day's swirls, as they lie.
  insert into said select 'DAY', count(*) || '|' || count(distinct (m.x, m.y))
    || '|' || count(*) filter (where m.x < 0 or m.y < 0 or m.x > 255 or m.y > 255)
    || '|' || count(*) filter (where m.x < 10)
    || '|' || count(*) filter (where m.x between 20 and 39 and m.y between 20 and 39)
    || '|' || count(*) filter (where (m.element = 'water') <> has_water(w, m.x, m.y))
    || '|' || count(*) filter (where m.element <> 'water'
                               and m.element not in ('dark', 'light', region_element(region_at(w, m.x + 0.5, m.y + 0.5))))
    || '|' || count(*) filter (where m.region <> region_of(m.x, m.y))
    from mote_swirl m where m.world_id = w;

  -- 2b. Every island's land: a world the chart's size, all of it land with nothing on it, and a day put down on it.
  insert into world (name, seed, size, spawn_x, spawn_y, ready) values ('Motes chart', 4244, 256, 128, 128, true) returning id into w2;
  perform land_blank(w2, 256);
  perform swirl_day(w2);
  insert into said select 'CHART', string_agg(m.x || ',' || m.y || ',' || m.element, ' ' order by m.x, m.y)
    from mote_swirl m where m.world_id = w2;

  -- 3. Thirty days: how often each comes up.
  create temp table tally (element text, n int);
  v_t0 := clock_timestamp();
  for i in 1..30 loop
    perform swirl_day(w);
    insert into tally select m.element, count(*) from mote_swirl m where m.world_id = w group by m.element;
  end loop;
  insert into said values ('MS', (extract(epoch from clock_timestamp() - v_t0) * 1000 / 30)::numeric(10, 1)::text);
  insert into said select 'RATES', sum(n) filter (where element = 'water') || '|' || sum(n) filter (where element = 'dark')
    || '|' || sum(n) filter (where element = 'light') || '|' || sum(n) from tally;
  -- The ground that has room, land and water: the map less the trees and the hall.
  insert into said select 'ROOM', count(*) filter (where x >= 127) || '|' || count(*)
    from generate_series(0, 255) x, generate_series(0, 255) y
   where x >= 10 and not (x between 20 and 39 and y between 20 and 39);

  -- 4. Dawn: the tick turns this island's woods and puts a new day down in place of the old, and says so.
  update world set trees_at = now() where id <> w;
  update world set trees_at = tree_last_dawn() - interval '1 second' where id = w;
  select max(id) into v_old from mote_swirl where world_id = w;
  delete from realtime.messages;
  perform tree_tick();
  insert into said select 'DAWN', count(*) || '|' || count(*) filter (where id <= v_old)
    || '|' || (select count(*) from realtime.messages r where r.topic = 'land:' || w || ':' || region_of(60, 60)
                and r.payload->>'swirls' = 'day')
    from mote_swirl where world_id = w;

  -- 5. A collect at each band of Elementalism, from beside a fire swirl at 61, 60.
  foreach lvl in array array[${BANDS.join(', ')}]::double precision[] loop
    delete from mote_swirl where world_id = w;
    insert into mote_swirl (world_id, x, y, element, region) values (w, 61, 60, 'fire', region_of(61, 60)) returning id into v_id;
    update player set x = 60.5, y = 60.5, level = 0 where world_id = w and uid = u;
    insert into skill (world_id, uid, id, value) values (w, u, 'elementalism', lvl)
      on conflict (world_id, uid, id) do update set value = excluded.value;
    v_before := coalesce((select sum(count) from item where world_id = w and holder_uid = u and def = 'fire_mote'), 0);
    s_before := skill_of(w, u, 'elementalism');
    v_why := act_refusal(w, u, 'collect_motes', tgt);
    delete from realtime.messages;
    perform act_perform(w, u, 'collect_motes', tgt);
    v_after := coalesce((select sum(count) from item where world_id = w and holder_uid = u and def = 'fire_mote'), 0);
    s_after := skill_of(w, u, 'elementalism');
    insert into said values ('BAND' || lvl, coalesce(v_why, 'none') || '|' || (v_after - v_before) || '|' || s_before || '|' || s_after
      || '|' || exists (select 1 from mote_swirl where world_id = w and id = v_id)
      || '|' || (select e.text from event e where e.world_id = w and e.uid = u order by e.n desc limit 1)
      || '|' || (select count(*) from realtime.messages r where r.topic = 'land:' || w || ':' || region_of(61, 60)
                  and r.payload->'swirls'->'gone' @> to_jsonb(v_id))
      || '|' || (skill_gain_of(lvl, skill_mult(w, u, 'elementalism'), 0.6)) || '|' || (skill_gain_of(lvl, skill_mult(w, u, 'elementalism'), 1.4)));
    -- And again, once it is gone.
    insert into said values ('GONE' || lvl, coalesce(act_refusal(w, u, 'collect_motes', tgt), 'none'));
  end loop;

  -- 6. Out of reach, off the map, and not the ground.
  insert into mote_swirl (world_id, x, y, element, region) values (w, 61, 60, 'fire', region_of(61, 60)) returning id into v_id;
  update player set x = 70.5, y = 60.5 where world_id = w and uid = u;
  insert into said values ('FAR', coalesce(act_refusal(w, u, 'collect_motes', tgt), 'none'));
  insert into said values ('OFF', coalesce(act_refusal(w, u, 'collect_motes', '{"kind":"tile","x":999,"y":5,"cx":999,"cy":5}'::jsonb), 'none'));
  insert into said values ('ITEM', coalesce(act_refusal(w, u, 'collect_motes', '{"kind":"item","uid":1}'::jsonb), 'none'));
  insert into said values ('LOOK', ground_says(w, 61, 60));

  -- 7. Two at one swirl: both may start, the first to finish has it, the second is told it is gone and given nothing.
  update player set x = 60.5, y = 60.5 where world_id = w and uid = u;
  update player set x = 62.5, y = 60.5 where world_id = w and uid = v;
  insert into skill (world_id, uid, id, value) values (w, v, 'elementalism', 50)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  update skill set value = 1 where world_id = w and uid = u and id = 'elementalism';
  insert into said values ('RACEASK', coalesce(act_refusal(w, u, 'collect_motes', tgt), 'none') || '|' || coalesce(act_refusal(w, v, 'collect_motes', tgt), 'none'));
  v_before := coalesce((select sum(count) from item where world_id = w and holder_uid = u and def = 'fire_mote'), 0);
  perform act_perform(w, u, 'collect_motes', tgt);
  s_before := skill_of(w, v, 'elementalism');
  perform act_perform(w, v, 'collect_motes', tgt);
  insert into said values ('RACE',
    (coalesce((select sum(count) from item where world_id = w and holder_uid = u and def = 'fire_mote'), 0) - v_before)
    || '|' || coalesce((select sum(count) from item where world_id = w and holder_uid = v and def = 'fire_mote'), 0)
    || '|' || (select e.text || ':' || e.kind from event e where e.world_id = w and e.uid = v order by e.n desc limit 1)
    || '|' || (skill_of(w, v, 'elementalism') - s_before));

  -- 8. On the water: a water swirl at 130, 60, collected swimming beside it.
  insert into mote_swirl (world_id, x, y, element, region) values (w, 130, 60, 'water', region_of(130, 60));
  update player set x = 129.5, y = 60.5 where world_id = w and uid = u;
  perform act_perform(w, u, 'collect_motes', '{"kind":"tile","x":130,"y":60,"cx":130,"cy":60}'::jsonb);
  insert into said values ('WATER', coalesce((select sum(count) from item where world_id = w and holder_uid = u and def = 'water_mote'), 0)::text);
end $t$;
select k || '=' || v from said order by k;
rollback;`);
const isle = new Map(out.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)] as [string, string]));
const part = (k: string, i = 0): string => (isle.get(k) ?? '').split('|')[i] ?? '';
const num = (k: string, i = 0): number => Number(part(k, i));

check('an island that has never had swirls has none until somebody asks', isle.get('BEFORE') === '0', isle.get('BEFORE'));
check(`and the first to ask has the day's ${SWIRLS_A_DAY}, all of them in the nine blocks round them, and the day is written down`,
  isle.get('FIRST') === `${SWIRLS_A_DAY}|${SWIRLS_A_DAY}|true`, isle.get('FIRST'));
check('asking again puts no second day down', isle.get('AGAIN') === `${SWIRLS_A_DAY}|${SWIRLS_A_DAY}`, isle.get('AGAIN'));
check('a day is as many as asked, one to a tile, all on the map, none on a tree or in the hall',
  [0, 1].every((i) => num('DAY', i) === SWIRLS_A_DAY) && [2, 3, 4].every((i) => num('DAY', i) === 0), isle.get('DAY'));
check('water exactly where there is water, and on land only the land\'s element, dark or light; each in its own block',
  [5, 6, 7].every((i) => num('DAY', i) === 0), isle.get('DAY'));
{
  // A swirl on each island of the chart has that island's element, or is dark or light.
  const laid = (isle.get('CHART') ?? '').split(' ').filter(Boolean).map((s) => s.split(','));
  const onIsland = new Map<number, number>();
  const wrong: string[] = [];
  for (const [x, y, e] of laid) {
    const r = chartRegion(Number(x) + 0.5, Number(y) + 0.5, 256);
    if (e === 'dark' || e === 'light') continue;
    onIsland.set(r, (onIsland.get(r) ?? 0) + 1);
    if (e !== ISLAND_ELEMENT[REGIONS[r]?.key ?? '']) wrong.push(`${x},${y} ${e} on ${REGIONS[r]?.key}`);
  }
  check(`on a world of land, a swirl on every island has that island's element: ${REGIONS.map((R, i) => `${onIsland.get(i) ?? 0} ${ISLAND_ELEMENT[R.key]} on ${R.key}`).join(', ')}`,
    laid.length === SWIRLS_A_DAY && wrong.length === 0 && REGIONS.every((_, i) => (onIsland.get(i) ?? 0) > 0),
    wrong.slice(0, 5).join('; ') || `${laid.length} swirls`);
}
{
  const [water, dark, light, all] = [0, 1, 2, 3].map((i) => num('RATES', i));
  const land = all - water;
  const share = num('ROOM', 0) / num('ROOM', 1);
  check(`over thirty days, about the water's share of the ground with room on water (${(share * 100).toFixed(1)}%)`,
    all === 30 * SWIRLS_A_DAY && Math.abs(water / all - share) < 0.02, `${water} of ${all}: ${(water / all * 100).toFixed(1)}%`);
  check(`and about ${SWIRL_DARK * 100}% dark and ${SWIRL_LIGHT * 100}% light of the swirls on land`,
    Math.abs(dark / land - SWIRL_DARK) < 0.4 * SWIRL_DARK && Math.abs(light / land - SWIRL_LIGHT) < 0.4 * SWIRL_LIGHT,
    `${dark} dark and ${light} light of ${land}: ${(dark / land * 100).toFixed(2)}% and ${(light / land * 100).toFixed(2)}%`);
  console.log(`  (a day's swirls on a 256 island: ${isle.get('MS')} ms)`);
}
check('the dawn\'s tick takes every swirl away, puts the day\'s down, and tells the block somebody stands in',
  num('DAWN', 0) === SWIRLS_A_DAY && num('DAWN', 1) === 0 && num('DAWN', 2) >= 1, isle.get('DAWN'));

for (const lvl of BANDS) {
  const k = `BAND${lvl}`;
  const [why, gained, before, after, still, text, told, lo, hi] = (isle.get(k) ?? '').split('|');
  const want = motesFor(lvl);
  check(`at Elementalism ${lvl}, a collect gives ${want} fire mote${want === 1 ? '' : 's'}, takes the swirl, says so on both sides and to the block`,
    why === 'none' && Number(gained) === want && still === 'false' && text === collectedSays(want, 'fire') && told === '1',
    isle.get(k));
  const gain = Number(after) - Number(before);
  check(`and trains Elementalism by one go of it at ${lvl}, as the browser's gain has it`,
    (lvl >= 100 && gain === 0) || (gain >= Number(lo) - 1e-9 && gain <= Number(hi) + 1e-9
      && Number(lo) <= skillGain(lvl, 1, 0.6) * 1.0001 + 1e-12 && Number(hi) >= skillGain(lvl, 1, 1.4) * 0.9999),
    `+${gain.toFixed(5)}, between ${Number(lo).toFixed(5)} and ${Number(hi).toFixed(5)}`);
  check(`and once it is gone, a collect is refused: "${SWIRL_SAID.gone}"`, isle.get(`GONE${lvl}`) === SWIRL_SAID.gone, isle.get(`GONE${lvl}`));
}
check('out of reach, off the map and not the ground are refused, in those words',
  isle.get('FAR') === 'You are too far away from that.' && isle.get('OFF') === SWIRL_SAID.nothing && isle.get('ITEM') === SWIRL_SAID.ground,
  `${isle.get('FAR')} / ${isle.get('OFF')} / ${isle.get('ITEM')}`);
check('Examine says a swirl is there, in the browser\'s words', (isle.get('LOOK') ?? '').endsWith(swirlSays('fire')), isle.get('LOOK'));
check('two at one swirl may both start on it', isle.get('RACEASK') === 'none|none', isle.get('RACEASK'));
check('and the first to finish has it; the second is told it is gone, given nothing, and taught only a missed go',
  num('RACE', 0) === motesFor(1) && num('RACE', 1) === 0 && part('RACE', 2) === `${SWIRL_SAID.gone}:error` && num('RACE', 3) > 0 && num('RACE', 3) < skillGain(50, 1, 1.4),
  isle.get('RACE'));
check('a water swirl is collected from the water beside it', num('WATER') === motesFor(1), isle.get('WATER'));

/* ---- in a game of your own ------------------------------------------------- */

const g = Game.create(4243);
g.rand = mulberry32(4243);
g.growTrees(Date.now() / 1000);
const day = [...g.swirls.values()];
const w = g.world;
const islandOf = (s: Swirl): MoteElement | null => landElement(chartRegion(s.x + 0.5, s.y + 0.5, w.w));
check(`a game of your own has the day's ${SWIRLS_A_DAY} swirls from its first frame, one to a tile, on the map`,
  day.length === SWIRLS_A_DAY && new Set(day.map((s) => s.y * w.w + s.x)).size === SWIRLS_A_DAY && day.every((s) => w.inBounds(s.x, s.y)),
  `${day.length}`);
check('none on a tree or in a building, water exactly on water, and on land only the element of the island of the chart it is on, dark or light',
  day.every((s) => !TILE_DEFS[w.getTile(s.x, s.y)].blocks && w.getTile(s.x, s.y) !== TileType.Tree && !g.buildings.buildingAt(s.x, s.y))
    && day.every((s) => (s.element === 'water') === w.hasWater(s.x, s.y))
    && day.every((s) => s.element === 'water' || s.element === 'dark' || s.element === 'light' || s.element === islandOf(s)),
  [...new Set(day.filter((s) => s.element !== 'water').map((s) => s.element))].join(', '));
{
  const rand = mulberry32(31);
  let onLand = 0, dark = 0, light = 0;
  for (let d = 0; d < 30; d++) {
    for (const s of laySwirls(g, 1, rand)) {
      if (s.element === 'water') continue;
      onLand++;
      if (s.element === 'dark') dark++;
      if (s.element === 'light') light++;
    }
  }
  check(`and over thirty days about ${SWIRL_DARK * 100}% dark and ${SWIRL_LIGHT * 100}% light of the swirls on land, as on the island`,
    onLand > 0 && Math.abs(dark / onLand - SWIRL_DARK) < 0.4 * SWIRL_DARK && Math.abs(light / onLand - SWIRL_LIGHT) < 0.4 * SWIRL_LIGHT,
    `${dark} dark and ${light} light of ${onLand}`);
}
{
  const def = ACTION_BY_ID.get('collect_motes');
  const px = Math.floor(g.player.x), py = Math.floor(g.player.y);
  const at = { x: px + 1, y: py };
  const t: Target = { kind: 'tile', x: at.x, y: at.y, cx: at.x, cy: at.y };
  const held = (): number => g.inventory.items.filter((it) => it.id === 'fire_mote').reduce((n, it) => n + it.count, 0);
  const gave: number[] = [];
  let words = true;
  let gone = true;
  for (const lvl of BANDS) {
    const s: Swirl = { id: 9000 + gave.length, x: at.x, y: at.y, element: 'fire' };
    g.setSwirls([s]);
    g.skills.values.set(ELEMENTALISM, lvl);
    const before = held();
    if (!def || !def.applies(t, g) || def.check?.(t, g) !== null) words = false;
    def?.perform(t, g);
    gave.push(held() - before);
    if (g.swirlAt(at.x, at.y) || def?.check?.(t, g) !== SWIRL_SAID.gone) gone = false;
  }
  check('in a game of your own a collect gives what the island gives at every band, and takes the swirl',
    gave.join(' ') === BANDS.map(motesFor).join(' ') && words && gone, `${gave.join(' ')} against ${BANDS.map(motesFor).join(' ')}`);
  g.setSwirls([{ id: 1, x: at.x, y: at.y, element: 'fire' }]);
  check('and Examine says a swirl is there in the same words as the island', groundSays(g, at.x, at.y).endsWith(swirlSays('fire')), groundSays(g, at.x, at.y));
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`elementalism and mote swirls — ${ok.length} of ${ok.length}`);
