/**
 * The Runestones and the Telestone (`runestones.ts`), on both sides.
 *
 * Five Runestones stand at fixed places on the chart's own island, laid over
 * a world of any size by scale; their nine tiles refuse every job that
 * changes the ground or puts something on it, and nothing walks into them. A
 * Telestone, cut with stonecutting from five earth motes and a stone brick,
 * takes whoever carries it to a free tile beside any stone within its reach,
 * and they then wait before travelling again: reach and wait straight from
 * 300 tiles and a day at QL 1 to 5000 tiles and an hour at QL 100.
 *
 * So this asks, of the island:
 *
 *   * the numbers and the words are the browser's: where each stone stands
 *     at every size, which tiles are a stone's, the reach and the wait at
 *     every quality and exactly at 1, 50 and 100, the tiles a traveller may
 *     arrive on and their order, the jobs a stone's ground refuses, what a
 *     refused journey says, and the Telestone and its recipe;
 *   * a Telestone is cut from five earth motes and a brick, and takes them;
 *   * a stone out of reach is refused, in the browser's words; at QL 1, 50
 *     and 100 a journey is made and the wait it starts is the rule's;
 *   * a second journey in the wait is refused with the time left, and allowed
 *     once the wait is over;
 *   * every refusal, each in the browser's words: no Telestone, no stone,
 *     another job, a fight, a cart, a hull, a mount, a companion, swimming,
 *     too heavy, and no room to arrive;
 *   * a traveller arrives on the first free tile beside the stone, the next
 *     when that one is taken, as the browser has it, and the browser is told;
 *   * a word about walking from before the journey does not pull the body
 *     back, and after the grace it is a walk like any other;
 *   * a stone's ground refuses digging, flattening, paving, planting,
 *     planning a building, setting furniture down, a spadeful dropped at your
 *     feet and a bridge thrown across it, and the ground beside it does not;
 *     nobody walks into it, nothing wild does, no worker plants on it, and
 *     Examine names it;
 *
 * and of the browser, on a game of its own over the same ground: the same
 * Telestone cut from the same things, the same refusals in the same words,
 * the same landing tile, and the same stone's ground refusing the same jobs.
 *
 * Everything random is seeded: `setseed` on the island and `mulberry32` here.
 * Runs against the database the suite leaves behind; the island half is
 * rolled back.
 *
 *   npx esbuild supabase/test/telestone.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/telestone.mjs && node node_modules/.cache/telestone.mjs
 */
import { execFileSync } from 'node:child_process';
import { Game, WORLD_SIZE } from '../../src/game/game';
import { ACTION_BY_ID, type ActionDef, type Target } from '../../src/game/actions';
import { ITEM_DEFS } from '../../src/game/items';
import { RECIPE_BY_ID } from '../../src/game/recipes';
import { groundSays } from '../../src/game/wildflowers';
import {
  companionSaid, farSaid, LANDING, landingTile, noRoomSaid, restSaid, RUNESTONE_BY_ID, runestoneAt, RUNESTONES, stoneCentre, stoneGroundSaid,
  LANDING_STAND, STONE_GUARDED, STONE_LEAST, stoneSays, stoneTiles, TELE_FAR, TELE_FAST, TELE_GRACE, TELE_NEAR, TELE_SLOW, TELESTONE, TELESTONE_KEY, TELESTONE_SAID, telestoneRange,
  telestoneRest, travelledSays, TRAVEL, type Runestone,
} from '../../src/game/runestones';
import { timeWords } from '../../src/game/words';
import { MAX_STAND } from '../../src/game/player';
import { TileType } from '../../src/world/tiles';
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

const SMALL = [16, 64, 256, 1000];
const none = psql(`select string_agg(s || ':' || (select count(*) from runestone_centres(s)) || ':' || coalesce(runestone_on(s, s / 2, s / 2), '-'), ' ' order by s)
  from unnest(array[${SMALL.join(', ')}]) s`);
check(`no stone stands on a world under ${STONE_LEAST} across -- a game of your own is ${WORLD_SIZE} -- on either side: a test's island of ${SMALL.slice(0, 3).join(', ')} or ${SMALL[3]} tiles`,
  STONE_LEAST === WORLD_SIZE && none === SMALL.map((n) => `${n}:0:-`).join(' ') && SMALL.every((n) => stoneTiles(n).size === 0), none);

const stones = psql(`select string_agg(id || ':' || name || ':' || x || ':' || y, '|' order by ord) from runestones()`);
check(`the ${RUNESTONES.length} stones stand at the same places on the chart's island on both sides (${RUNESTONES.map((s) => `${s.name} ${s.x},${s.y}`).join('; ')})`,
  stones === RUNESTONES.map((s) => `${s.id}:${s.name}:${s.x}:${s.y}`).join('|'), stones);

const SIZES = [1024, 1500, 2048, 3000, 4096];
const centres = psql(`select string_agg(c.id || '@' || s || ':' || c.x || ',' || c.y, '|' order by s, c.ord)
  from unnest(array[${SIZES.join(', ')}]) s, lateral runestone_centres(s) c`);
const centresHere = SIZES.flatMap((n) => RUNESTONES.map((s) => { const c = stoneCentre(s, n); return `${s.id}@${n}:${c.x},${c.y}`; })).join('|');
check('and are laid over a world of every size at the same centre tiles, a 4096 island at the places themselves',
  centres === centresHere && RUNESTONES.every((s) => stoneCentre(s, 4096).x === s.x && stoneCentre(s, 4096).y === s.y), centres === centresHere ? '' : centres.slice(0, 200));

{
  const N = 1024;
  const probe: Array<[number, number]> = [];
  for (const s of RUNESTONES) {
    const c = stoneCentre(s, N);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) probe.push([c.x + dx, c.y + dy]);
  }
  const on = psql(`select string_agg(coalesce(runestone_on(${N}, p.x, p.y), '-'), ' ' order by p.o)
    from unnest(array[${probe.map((p) => p[0]).join(', ')}], array[${probe.map((p) => p[1]).join(', ')}]) with ordinality p(x, y, o)`);
  const onHere = probe.map(([x, y]) => runestoneAt(x, y, N)?.id ?? '-').join(' ');
  const nine = RUNESTONES.every((s) => onHere.split(' ').filter((id) => id === s.id).length === 9);
  check('every tile round each stone is its or not the same on both sides, nine to a stone', on === onHere && nine, on === onHere ? '' : on.slice(0, 200));
}

const QLS = [-5, 0, 1, 2, 25, 49.5, 50, 57.3, 99.99, 100, 140];
const reach = psql(`select string_agg(telestone_range(q)::text || '/' || telestone_rest(q)::text, ' ' order by o)
  from unnest(array[${QLS.join(', ')}]::double precision[]) with ordinality u(q, o)`).split(' ');
const reachHere = QLS.map((q) => [telestoneRange(q), telestoneRest(q)]);
check('a Telestone reaches as far and makes you wait as long at every quality on both sides',
  reach.length === QLS.length && reach.every((r, i) => {
    const [a, b] = r.split('/').map(Number);
    return Math.abs(a - reachHere[i][0]) < 1e-9 && Math.abs(b - reachHere[i][1]) < 1e-9;
  }), reach.join(' '));
// The owner's two points, and the line between them.
const line = (ql: number): [number, number] => [300 + (ql - 1) * (5000 - 300) / 99, 24 * 3600 - (ql - 1) * 23 * 3600 / 99];
check(`at QL 1 ${TELE_NEAR} tiles and ${TELE_SLOW / 3600} hours, at QL 100 ${TELE_FAR} tiles and ${TELE_FAST / 3600} hour, and at QL 50 on the straight line between: ${telestoneRange(50).toFixed(1)} tiles and ${timeWords(telestoneRest(50))}`,
  [1, 50, 100].every((q) => Math.abs(telestoneRange(q) - line(q)[0]) < 1e-9 && Math.abs(telestoneRest(q) - line(q)[1]) < 1e-9)
    && telestoneRange(1) === 300 && telestoneRest(1) === 86400 && telestoneRange(100) === 5000 && telestoneRest(100) === 3600,
  `${telestoneRange(50)} / ${telestoneRest(50)}`);

const ring = psql(`select string_agg(dx || ',' || dy, ' ' order by k) from landing_ring()`);
check(`a traveller may arrive on the same ${LANDING.length} tiles round a stone, tried in the same order, the middle of its south side first, none steeper than a body stands on (${LANDING_STAND})`,
  ring === LANDING.map(([dx, dy]) => `${dx},${dy}`).join(' ') && LANDING[0][0] === 0 && LANDING[0][1] === 2
    && LANDING_STAND === MAX_STAND && psql('select landing_stand()') === String(MAX_STAND), ring.slice(0, 80));

const guarded = psql(`select string_agg(a.id, ' ' order by a.id collate "C") from action_def a where stone_guarded(a.id)`);
const guardedHere = [...STONE_GUARDED].sort().join(' ');
check(`a stone's ground refuses the same ${STONE_GUARDED.size} jobs on both sides, every one of them a job there is`,
  guarded === guardedHere && [...STONE_GUARDED].every((id) => ACTION_BY_ID.has(id)), guarded === guardedHere ? '' : guarded);

const saidIsle = psql(`select string_agg(telestone_said(k), '|' order by o) from unnest(array[${Object.keys(TELESTONE_SAID).map((k) => `'${k}'`).join(', ')}]) with ordinality u(k, o)`);
check('a refused journey is said in the same words', saidIsle === Object.values(TELESTONE_SAID).join('|'), saidIsle);
const WAITS = [1, 59, 61, 3599, 3600, 3661, 45418.18, 86399, 86400];
const waits = psql(`select string_agg(time_words(s), '|' order by o) from unnest(array[${WAITS.join(', ')}]::double precision[]) with ordinality u(s, o)`);
check('and the time left in the same words', waits === WAITS.map(timeWords).join('|'), waits);

const defs = psql(`select (select id || ':' || name || ':' || weight || ':' || stackable || ':' || coalesce(description, '') from item_def where id = 'telestone')
  || '#' || (select result || ':' || skill || ':' || tool || ':' || coalesce(difficulty::text, '') from recipe where id = 'make_telestone')
  || '#' || (select string_agg(item || 'x' || count, ',' order by ord) from recipe_input where recipe = 'make_telestone')
  || '#' || act_ported('travel_runestone') || ':' || act_ported('make_telestone')
  || '#' || (select instant || ':' || stamina from action_def where id = 'travel_runestone')`);
const r = RECIPE_BY_ID.get('make_telestone');
const t0 = ITEM_DEFS[TELESTONE];
const defsHere = `telestone:${t0.name}:${t0.weight}:${!!t0.stackable}:${t0.description ?? ''}#${r?.result}:${r?.skill}:${r?.tool}:${r?.difficulty ?? ''}`
  + `#${(r?.inputs ?? []).map((i) => `${i.item}x${i.count ?? 1}`).join(',')}#true:true#true:0`;
check('the Telestone, its description off the rule, and its recipe -- stonecutting, five earth motes and a stone brick -- are the same on both sides, and travelling is ported',
  defs === defsHere && (r?.inputs ?? []).some((i) => i.item === 'earth_mote' && i.count === 5) && (r?.inputs ?? []).some((i) => i.item === 'stone_brick' && (i.count ?? 1) === 1)
    && r?.skill === 'stonecutting' && !(t0.description ?? '').includes('{'),
  defs === defsHere ? '' : `island ${defs.slice(0, 300)}`);

/* ---- on the island -------------------------------------------------------- */

/*
 * Runestones: a thousand and twenty-four square, so the stones stand where the
 * browser's game of its own puts them, seed 4245. Land at ten everywhere but
 * a sea at minus forty from corner 1000 east. Mira and Tobin come ashore at 5, 5.
 */
const N = 1024;
const MIRA = '7e1e5701-0000-4000-8000-000000000001';
const TOBIN = '7e1e5701-0000-4000-8000-000000000002';
const at = (s: string): Runestone => RUNESTONE_BY_ID.get(s) as Runestone;
const crown = stoneCentre(at('crownstone'), N);
const harrow = stoneCentre(at('harrowmark'), N);
const sun = stoneCentre(at('sunreach'), N);
/** Beside the Crownstone, on the tile under the middle of its south side. */
const BESIDE: [number, number] = [crown.x + 0.5, crown.y + 2.5];
/** The jobs a stone's ground is asked about, and where: on the stone, then the same job beside it. */
const GROUND_JOBS: Array<{ id: string; on: Record<string, unknown>; off: Record<string, unknown> }> = [
  { id: 'dig', on: { kind: 'tile', x: crown.x, y: crown.y + 1, cx: crown.x, cy: crown.y + 2 }, off: { kind: 'tile', x: crown.x, y: crown.y + 3, cx: crown.x, cy: crown.y + 4 } },
  { id: 'flatten', on: { kind: 'tile', x: crown.x, y: crown.y + 1, cx: crown.x, cy: crown.y + 1 }, off: { kind: 'tile', x: crown.x, y: crown.y + 3, cx: crown.x, cy: crown.y + 3 } },
  { id: 'pave_cobble', on: { kind: 'tile', x: crown.x + 1, y: crown.y + 1, cx: crown.x + 1, cy: crown.y + 1 }, off: { kind: 'tile', x: crown.x + 1, y: crown.y + 2, cx: crown.x + 1, cy: crown.y + 2 } },
  { id: 'plant', on: { kind: 'tile', x: crown.x - 1, y: crown.y + 1, cx: crown.x - 1, cy: crown.y + 1 }, off: { kind: 'tile', x: crown.x - 1, y: crown.y + 2, cx: crown.x - 1, cy: crown.y + 2 } },
  { id: 'plan_building', on: { kind: 'tile', x: crown.x, y: crown.y, cx: crown.x, cy: crown.y }, off: { kind: 'tile', x: crown.x + 3, y: crown.y, cx: crown.x + 3, cy: crown.y } },
  { id: 'place_furniture', on: { kind: 'tile', x: crown.x, y: crown.y + 1, cx: crown.x, cy: crown.y + 1, sx: 1, sy: 1, itemUid: 1 }, off: { kind: 'tile', x: crown.x, y: crown.y + 2, cx: crown.x, cy: crown.y + 2, sx: 1, sy: 1, itemUid: 1 } },
  { id: 'plan_bridge', on: { kind: 'tile', x: crown.x, y: crown.y - 3, cx: crown.x, cy: crown.y - 3, material: 'plank' }, off: { kind: 'tile', x: crown.x + 3, y: crown.y + 2, cx: crown.x + 3, cy: crown.y + 2, material: 'plank' } },
  { id: 'drop_dirt_here', on: { kind: 'item', uid: 1 }, off: { kind: 'item', uid: 1 } },
];
const jobSql = (on: 'on' | 'off'): string => GROUND_JOBS.map((j) => `
    ${j.id === 'drop_dirt_here' ? `update player set y = ${on === 'on' ? BESIDE[1] - 0.4 : BESIDE[1] + 0.6} where world_id = w and uid = u;` : ''}
    insert into said values ('${on.toUpperCase()}:${j.id}', coalesce(act_refusal(w, u, '${j.id}', '${JSON.stringify(on === 'on' ? j.on : j.off)}'::jsonb), 'none'));
    update player set x = ${BESIDE[0]}, y = ${BESIDE[1]} where world_id = w and uid = u;`).join('');
const travel = (stone: string, uidVar = 'ts'): string => `jsonb_build_object('kind', 'item', 'uid', ${uidVar}, 'stone', '${stone}')`;

const out = psql(`
begin;
select setseed(0.4245) \\g /dev/null
create temp table said (k text, v text);
do $t$
declare w uuid; u uuid := '${MIRA}'; v uuid := '${TOBIN}'; j jsonb; ts bigint; v_mote bigint; i int; v_ql double precision;
        v_cart bigint; k int; dx int; dy int;
begin
  insert into world (name, seed, size, spawn_x, spawn_y, ready) values ('Runestones', 4245, ${N}, 5, 5, true) returning id into w;
  perform land_blank(w, ${N});
  update land_corner set heights = decode(repeat('0a00', 1000) || repeat('d8ff', ${N + 1 - 1000}), 'hex') where world_id = w;
  insert into said values ('WORLD', w::text);
  perform set_config('request.jwt.claims', json_build_object('sub', v)::text, true);
  perform rpc_join(w, 'Tobin');
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  perform rpc_join(w, 'Mira');
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  update player set x = 5.5, y = 5.5, body_at = now(), swim_at = now(),
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
   where world_id = w and uid = u;

  -- 1. A Telestone cut: five earth motes and a stone brick, with a chisel, at stonecutting 90; tried until a go comes off.
  insert into skill (world_id, uid, id, value) values (w, u, 'stonecutting', 90)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  perform give(w, u, 'chisel', 1, 100);
  v_mote := give(w, u, 'earth_mote', 7, 40);
  perform give(w, u, 'stone_brick', 2, 40);
  insert into said values ('CRAFTASK', coalesce(act_refusal(w, u, 'make_telestone', jsonb_build_object('kind', 'item', 'uid', v_mote)), 'none'));
  i := 0;
  while not exists (select 1 from item where world_id = w and holder = 'player' and holder_uid = u and def = 'telestone') and i < 20 loop
    i := i + 1;
    perform perform_craft(w, u, 'make_telestone', jsonb_build_object('kind', 'item', 'uid', v_mote));
  end loop;
  select id into ts from item where world_id = w and holder = 'player' and holder_uid = u and def = 'telestone';
  insert into said values ('CRAFT', i || '|' || coalesce((select sum(count) from item where world_id = w and holder_uid = u and def = 'earth_mote'), 0)
    || '|' || coalesce((select sum(count) from item where world_id = w and holder_uid = u and def = 'stone_brick'), 0)
    || '|' || (select count(*) from item where world_id = w and holder_uid = u and def = 'telestone')
    || '|' || coalesce((select ql from item where id = ts), -1));
  insert into said values ('TS', ts::text);

  -- 2. Out of reach at QL 1: the Sunreach Stone from 5, 5.
  update item set ql = 1 where id = ts;
  insert into said values ('FAR', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('sunreach')}), 'none'));

  -- 3. At QL 50 it is in reach: the journey, where it lands, the wait it starts, what is said, and what the browser is told.
  update item set ql = 50 where id = ts;
  insert into said values ('ASK50', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('sunreach')}), 'none'));
  delete from realtime.messages;
  perform act_perform(w, u, 'travel_runestone', ${travel('sunreach')});
  insert into said select 'WENT50', p.x || ',' || p.y || ',' || p.level
    || '|' || (select extract(epoch from t.until - t.used_at) from telestone_journey t where t.world_id = w and t.uid = u)
    || '|' || (select e.text from event e where e.world_id = w and e.uid = u order by e.n desc limit 1)
    || '|' || (select count(*) from realtime.messages r where r.topic = 'own:' || w || ':' || u
                 and (r.payload->>'x')::double precision = p.x and (r.payload->>'y')::double precision = p.y
                 and abs((r.payload->>'until')::double precision
                         - extract(epoch from (select t.until from telestone_journey t where t.world_id = w and t.uid = u))) < 0.001)
    from player p where p.world_id = w and p.uid = u;

  -- 4. Again at once: the wait, and the time left.
  insert into said values ('AGAIN', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('harrowmark')}), 'none') || '|' || telestone_wait(w, u));

  -- 5. A word from before the journey, claiming the old ground: the body stays. After the grace, it is a walk.
  delete from caller where uid = u;
  j := rpc_move(w, 5.5, 5.5, 0);
  insert into said select 'GRACE', (j->>'x') || ',' || (j->>'y') || ',' || (j->>'pulled') || '|' || p.x || ',' || p.y
    from player p where p.world_id = w and p.uid = u;
  update telestone_journey set used_at = now() - make_interval(secs => telestone_grace() + 1) where world_id = w and uid = u;
  update player set x = ${sun.x - 3.5}, y = ${sun.y + 2.5}, moved_at = now() - interval '1 second' where world_id = w and uid = u;
  j := rpc_move(w, 5.5, 5.5, 0);
  insert into said values ('AFTER', (j->>'x') || ',' || (j->>'y') || ',' || (j->>'pulled'));

  -- 6. The wait over: allowed again. At QL 1 from inside its reach of the Crownstone, and at QL 100 to the Wardenfall.
  update telestone_journey set until = now() - interval '1 second' where world_id = w and uid = u;
  update item set ql = 1 where id = ts;
  update player set x = ${crown.x + 0.5}, y = ${crown.y - 200 + 0.5} where world_id = w and uid = u;
  insert into said values ('ASK1', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('crownstone')}), 'none'));
  perform act_perform(w, u, 'travel_runestone', ${travel('crownstone')});
  insert into said select 'WENT1', p.x || ',' || p.y || '|' || (select extract(epoch from t.until - t.used_at) from telestone_journey t where t.world_id = w and t.uid = u)
    from player p where p.world_id = w and p.uid = u;
  update telestone_journey set until = now() - interval '1 second' where world_id = w and uid = u;
  update item set ql = 100 where id = ts;
  update player set x = 5.5, y = 5.5 where world_id = w and uid = u;
  insert into said values ('ASK100', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('wardenfall')}), 'none'));
  perform act_perform(w, u, 'travel_runestone', ${travel('wardenfall')});
  insert into said select 'WENT100', p.x || ',' || p.y || '|' || (select extract(epoch from t.until - t.used_at) from telestone_journey t where t.world_id = w and t.uid = u)
    from player p where p.world_id = w and p.uid = u;
  update telestone_journey set until = now() - interval '1 second' where world_id = w and uid = u;

  -- 7. Each refusal on its own, from 5, 5 with a QL 100 Telestone and no wait.
  update player set x = 5.5, y = 5.5 where world_id = w and uid = u;
  insert into said values ('R:tile', coalesce(act_refusal(w, u, 'travel_runestone', '{"kind":"tile","x":5,"y":5,"cx":5,"cy":5,"stone":"crownstone"}'::jsonb), 'none'));
  insert into said values ('R:mote', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('crownstone', 'v_mote')}), 'none'));
  insert into said values ('R:stone', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('atlantis')}), 'none'));
  update player set act = 'dig', act_target = '{}'::jsonb, act_started = now(), act_ends = now() + interval '1 hour' where world_id = w and uid = u;
  insert into said values ('R:busy', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('crownstone')}), 'none'));
  update player set act = null, act_target = null, act_started = null, act_ends = null where world_id = w and uid = u;
  insert into creature (world_id, id, species, name, mode, from_x, from_y, to_x, to_y, health, sex, hunting)
    values (w, 9001, 'rabba', 'Snapper', 'wild', 6.5, 5.5, 6.5, 5.5, 10, 'female', u);
  insert into said values ('R:fight', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('crownstone')}), 'none'));
  delete from creature where world_id = w and id = 9001;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, driver)
    values (w, 'furniture', 'cart', 5, 6, 0, 0, 5.5, 6.5, 10, u) returning id into v_cart;
  insert into said values ('R:drive', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('crownstone')}), 'none'));
  update placed set driver = null, puller = u where id = v_cart;
  insert into said values ('R:pull', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('crownstone')}), 'none'));
  update placed set puller = null where id = v_cart;
  update player set aboard = v_cart where world_id = w and uid = u;
  insert into said values ('R:aboard', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('crownstone')}), 'none'));
  update player set aboard = null where world_id = w and uid = u;
  delete from placed where id = v_cart;
  insert into creature (world_id, id, species, name, mode, from_x, from_y, to_x, to_y, health, sex, keeper, rider)
    values (w, 9002, 'vola', 'Strider', 'deed', 5.5, 5.5, 5.5, 5.5, 10, 'male', u, u);
  insert into said values ('R:mount', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('crownstone')}), 'none'));
  update creature set rider = null, mode = 'active', name = 'Bramble' where world_id = w and id = 9002;
  insert into said values ('R:pet', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('crownstone')}), 'none'));
  delete from creature where world_id = w and id = 9002;
  update player set x = 1010.5, y = 5.5 where world_id = w and uid = u;
  insert into said values ('R:swim', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('crownstone')}), 'none'));
  update player set x = 5.5, y = 5.5 where world_id = w and uid = u;
  perform give(w, u, 'stone_brick', 400, 30);
  insert into said values ('R:heavy', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('crownstone')}), 'none'));
  delete from item where world_id = w and holder_uid = u and def = 'stone_brick';
  insert into building (world_id, id, name) values (w, 77, 'Ring');
  insert into building_tile (world_id, building, x, y)
    select w, 77, ${harrow.x} + r.dx, ${harrow.y} + r.dy from landing_ring() r;
  insert into said values ('R:room', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('harrowmark')}), 'none'));
  delete from building_tile where world_id = w and building = 77;
  delete from building where world_id = w and id = 77;
  insert into said values ('R:none', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('crownstone')}), 'none'));
  update world set size = ${N / 2} where id = w;
  insert into said values ('R:nowhere', coalesce(act_refusal(w, u, 'travel_runestone', ${travel('crownstone')}), 'none'));
  update world set size = ${N} where id = w;

  -- 8. Where a traveller arrives when the first tile beside the stone is taken: a tree on it.
  perform land_set_tile(w, ${harrow.x + LANDING[0][0]}, ${harrow.y + LANDING[0][1]}, tile_id('Tree'));
  insert into said select 'LAND', l.x || ',' || l.y from telestone_landing(w, 'harrowmark') l;

  -- 9. The Crownstone's ground, from beside it: the jobs on the stone, and the same beside it.
  update player set x = ${BESIDE[0]}, y = ${BESIDE[1]} where world_id = w and uid = u;
  ${jobSql('on')}
  ${jobSql('off')}
  insert into said values ('WALK', walk_share(w, u, 0, ${BESIDE[0]}, ${BESIDE[1]}, ${BESIDE[0]}, ${crown.y - 3.5})::text
    || '|' || walk_share(w, u, 0, ${BESIDE[0]}, ${BESIDE[1]}, ${BESIDE[0] + 4}, ${BESIDE[1]})::text);
  delete from caller where uid = u;
  update player set moved_at = now() - interval '2 seconds' where world_id = w and uid = u;
  j := rpc_move(w, ${BESIDE[0]}, ${crown.y + 0.5}, 0);
  insert into said values ('MOVE', (j->>'y') || ',' || (j->>'blocked'));
  insert into said values ('WILD', creature_tile_ok(w, ${crown.x}, ${crown.y + 1}) || '|' || creature_tile_ok(w, ${crown.x}, ${crown.y + 2})
    || '|' || line_clear(w, ${crown.x + 0.5}, ${crown.y + 3.5}, ${crown.x + 0.5}, ${crown.y - 3.5})
    || '|' || line_clear(w, ${crown.x + 3.5}, ${crown.y + 3.5}, ${crown.x + 3.5}, ${crown.y - 3.5})
    || '|' || plantable_tile(w, ${crown.x + 1}, ${crown.y - 1}) || '|' || plantable_tile(w, ${crown.x + 2}, ${crown.y - 1}));
  insert into said values ('LOOK', ground_says(w, ${crown.x - 1}, ${crown.y - 1}));
  perform swirl_day(w);
  insert into said select 'SWIRLS', count(*) || '|' || count(*) filter (where runestone_on(${N}, m.x, m.y) is not null)
    from mote_swirl m where m.world_id = w;
end $t$;
select k || '=' || v from said order by k;
rollback;`);
const isle = new Map(out.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)] as [string, string]));
const part = (k: string, i = 0): string => (isle.get(k) ?? '').split('|')[i] ?? '';

/* ---- in a game of your own, over the same ground ------------------------------ */

const g = Game.create(4245);
g.rand = mulberry32(4245);
const w = g.world;
w.water = null;
w.heights.fill(10);
for (let y = 0; y <= w.h; y++) for (let x = 1000; x <= w.w; x++) w.heights[y * w.cw + x] = -40;
w.tiles.fill(TileType.Grass);
w.data.fill(0);
for (const id of [...g.creatures.list.keys()]) g.creatures.list.delete(id);
g.inventory.items.length = 0;
g.putBody(5.5, 5.5, 0);
g.skills.values.set('stonecutting', 90);
g.gather('chisel', { count: 1, ql: 100 });
const mote = g.gather('earth_mote', { count: 7, ql: 40 });
g.gather('stone_brick', { count: 2, ql: 40 });
const held = (id: string): number => g.inventory.items.filter((it) => it.id === id).reduce((n, it) => n + it.count, 0);
const make = ACTION_BY_ID.get('make_telestone') as ActionDef;
let tries = 0;
const craftAsk = make.check?.({ kind: 'item', uid: mote.uid }, g) ?? null;
while (!held(TELESTONE) && tries < 20) {
  tries++;
  make.perform({ kind: 'item', uid: mote.uid }, g);
}
const stone = g.inventory.items.find((it) => it.id === TELESTONE);
const go = ACTION_BY_ID.get(TRAVEL) as ActionDef;
const tt = (s: string, uid = stone?.uid ?? -1): Target => ({ kind: 'item', uid, stone: s });
const ask = (s: string, uid?: number): string => go.check?.(tt(s, uid), g) ?? 'none';

check('a Telestone is cut on the island from five earth motes and a stone brick, and takes them',
  part('CRAFTASK') === 'none' && Number(part('CRAFT', 0)) >= 1 && part('CRAFT', 1) === '2' && part('CRAFT', 2) === '1' && part('CRAFT', 3) === '1'
    && Number(part('CRAFT', 4)) > 0, isle.get('CRAFT'));
check('and in a game of your own the same', craftAsk === null && !!stone && held('earth_mote') === 2 && held('stone_brick') === 1 && held(TELESTONE) === 1,
  `${tries} goes, ${held('earth_mote')} motes and ${held('stone_brick')} bricks left`);

/* The browser's word on each of the island's cases, the body put where the island's was. */
const dAt = (s: string, x: number, y: number): number => Math.hypot(x - (stoneCentre(at(s), N).x + 0.5), y - (stoneCentre(at(s), N).y + 0.5));
if (stone) stone.ql = 1;
const farHere = ask('sunreach');
check(`out of reach at QL 1 (${Math.round(dAt('sunreach', 5.5, 5.5))} tiles to the Sunreach Stone, ${TELE_NEAR} reached) is refused in the same words on both sides`,
  isle.get('FAR') === farSaid(at('sunreach'), dAt('sunreach', 5.5, 5.5), telestoneRange(1)) && farHere === isle.get('FAR'), `${isle.get('FAR')} / ${farHere}`);
if (stone) stone.ql = 50;
const askHere50 = ask('sunreach');
const land50 = landingTile(g, at('sunreach'));
go.perform(tt('sunreach'), g);
const wentHere: [number, number] = [g.player.x, g.player.y];
const restHere = (g.player.usedAt[TELESTONE_KEY] ?? 0) - g.wallNow();
const [wx, wy] = part('WENT50', 0).split(',').map(Number);
check(`at QL 50 it is in reach, and the traveller lands on the first free tile beside the stone -- the middle of its south side -- on both sides`,
  isle.get('ASK50') === 'none' && askHere50 === 'none' && wx === sun.x + LANDING[0][0] + 0.5 && wy === sun.y + LANDING[0][1] + 0.5
    && land50?.x === sun.x + LANDING[0][0] && land50?.y === sun.y + LANDING[0][1] && wentHere[0] === wx && wentHere[1] === wy,
  `island ${part('WENT50', 0)}, browser ${wentHere.join(',')}`);
check(`and the wait it starts is the rule's at QL 50: ${timeWords(telestoneRest(50))}`,
  Math.abs(Number(part('WENT50', 1)) - telestoneRest(50)) < 0.01 && Math.abs(restHere - telestoneRest(50)) < 2, `island ${part('WENT50', 1)} s, browser ${restHere.toFixed(1)} s`);
check('the journey is said in the same words on both sides, and the browser is told where the body went and when the next may be made',
  part('WENT50', 2) === travelledSays(at('sunreach'), telestoneRest(50)) && part('WENT50', 3) === '1', `${part('WENT50', 2)} (${part('WENT50', 3)} told)`);
const againHere = ask('harrowmark');
check('a second journey in the wait is refused with the time left, in the same words on both sides',
  part('AGAIN', 0) === restSaid(Number(part('AGAIN', 1))) && Number(part('AGAIN', 1)) > telestoneRest(50) - 5
    && againHere.startsWith('You can travel by Telestone again in ') && againHere === restSaid(restHere),
  `${part('AGAIN', 0)} / ${againHere}`);
check(`a word about walking from before the journey leaves the body where the journey put it, for ${TELE_GRACE} seconds`,
  part('GRACE', 0) === `${wx},${wy},true` && part('GRACE', 1) === `${wx},${wy}`, isle.get('GRACE'));
{
  const [ax, ay] = part('AFTER').split(',').map(Number);
  check('and after the grace the same word is a walk like any other, pulled a walk\'s worth towards it',
    Math.abs(ax - (sun.x - 3.5)) + Math.abs(ay - (sun.y + 2.5)) > 0.5 && Math.hypot(ax - (sun.x - 3.5), ay - (sun.y + 2.5)) < 50, isle.get('AFTER'));
}
check(`at QL 1 inside its reach the journey is made, and the wait is ${timeWords(TELE_SLOW)}`,
  isle.get('ASK1') === 'none' && Math.abs(Number(part('WENT1', 1)) - TELE_SLOW) < 0.01
    && part('WENT1', 0) === `${crown.x + LANDING[0][0] + 0.5},${crown.y + LANDING[0][1] + 0.5}`, `${isle.get('ASK1')} ${isle.get('WENT1')}`);
check(`at QL 100 any stone on the island is in reach, and the wait is ${timeWords(TELE_FAST)}`,
  isle.get('ASK100') === 'none' && Math.abs(Number(part('WENT100', 1)) - TELE_FAST) < 0.01, `${isle.get('ASK100')} ${isle.get('WENT100')}`);

/* Each refusal, the browser's game set up the same way. */
g.player.usedAt[TELESTONE_KEY] = 0;
if (stone) stone.ql = 100;
g.putBody(5.5, 5.5, 0);
const here: Record<string, string> = {};
here.tile = go.check?.({ kind: 'tile', x: 5, y: 5, cx: 5, cy: 5 }, g) ?? 'none';
here.mote = ask('crownstone', mote.uid);
here.stone = ask('atlantis');
g.action = { def: ACTION_BY_ID.get('dig') as ActionDef, target: { kind: 'tile', x: 5, y: 6, cx: 5, cy: 6 }, state: 'performing', elapsed: 0, duration: 10 } as typeof g.action;
here.busy = ask('crownstone');
g.action = null;
const swap = <T>(set: () => T, undo: (v: T) => void, key: string): void => {
  const v = set();
  here[key] = ask('crownstone');
  undo(v);
};
// What the island reads off its rows, the browser asks of its own: a fight, a cart, a hull, a mount, a companion.
swap(() => { g.inAFight = () => true; return 0; }, () => { delete (g as unknown as Record<string, unknown>).inAFight; }, 'fight');
swap(() => { const was = g.driving; g.driving = () => ({}) as ReturnType<typeof g.driving>; return was; }, (was) => { g.driving = was; }, 'drive');
swap(() => { const was = g.aboardShip; g.aboardShip = () => ({}) as ReturnType<typeof g.aboardShip>; return was; }, (was) => { g.aboardShip = was; }, 'aboard');
swap(() => { const was = g.mounted; g.mounted = () => ({}) as ReturnType<typeof g.mounted>; return was; }, (was) => { g.mounted = was; }, 'mount');
swap(() => { const was = g.companion; g.companion = () => ({ name: 'Bramble' }) as ReturnType<typeof g.companion>; return was; }, (was) => { g.companion = was; }, 'pet');
swap(() => { g.player.swimming = true; return 0; }, () => { g.player.swimming = false; }, 'swim');
swap(() => { const it = g.gather('stone_brick', { count: 400, ql: 30 }); return it; }, (it) => { g.inventory.items.splice(g.inventory.items.indexOf(it), 1); }, 'heavy');
here.none = ask('crownstone');
const RCASES: Array<[string, string, string]> = [
  ['tile', 'R:tile', TELESTONE_SAID.item], ['mote', 'R:mote', TELESTONE_SAID.item], ['stone', 'R:stone', TELESTONE_SAID.stone],
  ['busy', 'R:busy', TELESTONE_SAID.busy], ['fight', 'R:fight', TELESTONE_SAID.fight], ['drive', 'R:drive', TELESTONE_SAID.driving],
  ['drive', 'R:pull', TELESTONE_SAID.driving], ['aboard', 'R:aboard', TELESTONE_SAID.aboard], ['mount', 'R:mount', TELESTONE_SAID.mounted],
  ['pet', 'R:pet', companionSaid('Bramble')], ['swim', 'R:swim', TELESTONE_SAID.swimming], ['heavy', 'R:heavy', TELESTONE_SAID.heavy],
  ['none', 'R:none', 'none'],
];
for (const [h, k, want] of RCASES) {
  check(`refused on both sides, in the same words: ${want}`, isle.get(k) === want && here[h] === want, `island ${isle.get(k)}, browser ${here[h]}`);
}
{
  const small = Game.create(4245, N / 2);
  const st = small.gather(TELESTONE, { count: 1, ql: 100 });
  const said = (ACTION_BY_ID.get(TRAVEL) as ActionDef).check?.({ kind: 'item', uid: st.uid, stone: 'crownstone' }, small) ?? 'none';
  check(`on a world under ${STONE_LEAST} a Telestone is refused on both sides: ${TELESTONE_SAID.nowhere}`,
    isle.get('R:nowhere') === TELESTONE_SAID.nowhere && said === TELESTONE_SAID.nowhere, `island ${isle.get('R:nowhere')}, browser ${said}`);
}
check(`refused when there is no free ground beside the stone: ${noRoomSaid(at('harrowmark'))}`, isle.get('R:room') === noRoomSaid(at('harrowmark')), isle.get('R:room'));
{
  w.setTile(harrow.x + LANDING[0][0], harrow.y + LANDING[0][1], TileType.Tree);
  const l = landingTile(g, at('harrowmark'));
  check('with the first tile beside a stone taken, the traveller arrives on the next, on both sides',
    isle.get('LAND') === `${harrow.x + LANDING[1][0]},${harrow.y + LANDING[1][1]}` && `${l?.x},${l?.y}` === isle.get('LAND'), `island ${isle.get('LAND')}, browser ${l?.x},${l?.y}`);
}

/* The Crownstone's ground. */
g.putBody(BESIDE[0], BESIDE[1], 0);
for (const j of GROUND_JOBS) {
  const def = ACTION_BY_ID.get(j.id) as ActionDef;
  const said = stoneGroundSaid(at('crownstone'));
  if (j.id === 'drop_dirt_here') g.putBody(BESIDE[0], BESIDE[1] - 0.4, 0);
  const onHere = def.check?.(j.on as Target, g) ?? 'none';
  if (j.id === 'drop_dirt_here') g.putBody(BESIDE[0], BESIDE[1] + 0.6, 0);
  const offHere = def.check?.(j.off as Target, g) ?? 'none';
  g.putBody(BESIDE[0], BESIDE[1], 0);
  check(`${def.label} on the Crownstone's ground is refused on both sides, and beside it is not for that`,
    isle.get(`ON:${j.id}`) === said && onHere === said && isle.get(`OFF:${j.id}`) !== said && offHere !== said,
    `island ${isle.get(`ON:${j.id}`)} / ${isle.get(`OFF:${j.id}`)}; browser ${onHere} / ${offHere}`);
}
check('nobody walks into a stone on the island, and walks past it', Number(part('WALK', 0)) < 1 && Number(part('WALK', 1)) === 1, isle.get('WALK'));
check('a walk the browser says goes through it is stopped short of it',
  Math.floor(Number(part('MOVE').split(',')[0])) >= crown.y + 2 && part('MOVE').split(',')[1] === 'true', isle.get('MOVE'));
check('and in a game of your own nobody can stand on it, and beside it they can',
  !w.isPassable(crown.x, crown.y + 1) && w.isPassable(crown.x, crown.y + 2) && !g.plantableTile(crown.x + 1, crown.y - 1) && g.plantableTile(crown.x + 2, crown.y - 1));
check('nothing wild walks onto it or through it on the island, and no worker plants on it',
  isle.get('WILD') === 'false|true|false|true|false|true', isle.get('WILD'));
check('Examine names it, in the same words on both sides',
  (isle.get('LOOK') ?? '').endsWith(stoneSays(at('crownstone'))) && groundSays(g, crown.x - 1, crown.y - 1).endsWith(stoneSays(at('crownstone'))), isle.get('LOOK'));
check('no mote swirl is put down on a stone', Number(part('SWIRLS', 0)) > 0 && part('SWIRLS', 1) === '0', isle.get('SWIRLS'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`runestones and the telestone — ${ok.length} of ${ok.length}`);
