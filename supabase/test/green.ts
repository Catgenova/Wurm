/**
 * Stone that ages, the same on both sides.
 *
 * Asked for off a picture of a grey castle: ivy on the walls, moss on the
 * paving, the statues, the poured slabs and the stone bridges, bare the day
 * they are built and as green as they get `GREEN_DAYS` days later; Clear the
 * ivy and Scrub the moss start it again. The browser draws it and asks about
 * it (`src/game/greening.ts`) and the island keeps the clock (`green_since`,
 * `20260928013000_stone_that_ages.sql`), so this holds the two to each other:
 *
 *   1. the clock: `greenDays` and `green_days` over the same moments, a day's
 *      edge to the quarter second either side, and a start that is never
 *      before greening came in;
 *   2. the starts: what writes one on the island -- a trigger on every way a
 *      wall, a slab or an arch is finished, `land_set_tile` for paving -- and
 *      in the browser, the performs that finish the same things;
 *   3. what the ground read carries: every thing's days worked out in a
 *      browser from what `rpc_ground` said, against the island's own;
 *   4. the two actions: every refusal in the same words for the same body,
 *      and a clearing that says the same and leaves the same bare stone.
 *
 * Runs against the database the suite leaves behind: Hoarding. Everything it
 * does is rolled back.
 */
import { execFileSync } from 'node:child_process';
import { Game, type IslandGround } from '../../src/game/game';
import type { Target } from '../../src/game/actions';
import { ACTIONS } from '../../src/game/actions';
import type { Wall } from '../../src/game/building';
import {
  bridgeGreen, greenDays, greenNow, greenStart, pavingGreen, pieceGreen, slabGreen, wallGreen,
  GREEN_ACTIONS, GREEN_AGAIN, GREEN_DAY, GREEN_DAYS, NOTHING_YET,
} from '../../src/game/greening';
import { TileType } from '../../src/world/tiles';

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

/** The island's `KEY|value` lines, by key. */
const keyed = (out: string): Map<string, string> => {
  const m = new Map<string, string>();
  for (const l of out.split('\n')) {
    const i = l.indexOf('|');
    if (i > 0) m.set(l.slice(0, i).trim(), l.slice(i + 1));
  }
  return m;
};

/* ---- 1. the clock ----------------------------------------------------------- */

/** A moment to count from, a quarter second off the whole so the edges are exact in both. */
const F = 1_790_000_000.25;
const D = GREEN_DAY;
const OFFSETS: number[] = [
  -D, -1, -0.25, 0, 0.25, 1, D - 1, D - 0.25, D, D + 0.25, D + 1, 2 * D, 3 * D - 0.25, 3 * D,
  7 * D + 3600, (GREEN_DAYS - 1) * D - 0.25, (GREEN_DAYS - 1) * D, GREEN_DAYS * D - 0.25, GREEN_DAYS * D,
  GREEN_DAYS * D + 1, 40 * D,
];
let seed = 20260928;
const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
// And two hundred more anywhere from two days before to a week past the end, to the quarter second.
for (let i = 0; i < 200; i++) OFFSETS.push(Math.round((rnd() * (GREEN_DAYS + 9) - 2) * D * 4) / 4);
/** Starts against when greening came in: none, before it, on it, after it. */
const STARTS: Array<[number | undefined, number]> = [[undefined, F], [F - 100, F], [F, F], [F + 100, F], [F + 3 * D, F - D]];

const clock = keyed(psql(`
select 'SPAN|' || green_span() || ',' || green_day();
select 'AGAIN|' || green_again();
select 'YET|' || green_nothing_yet();
select 'DAYS|' || string_agg(green_days(to_timestamp(s), to_timestamp(n))::text, ',' order by i)
  from (values ${OFFSETS.map((o, i) => `(${i}, ${F}::float8, ${F + o}::float8)`).join(', ')}) v(i, s, n);
select 'START|' || string_agg(extract(epoch from green_start(to_timestamp(s), to_timestamp(f)))::float8::text, ',' order by i)
  from (values ${STARTS.map(([s, f], i) => `(${i}, ${s === undefined ? 'null' : s}::float8, ${f}::float8)`).join(', ')}) v(i, s, f);
select 'AGO|' || green_ago(null, now() - interval '5 days') || ',' || green_ago(now() - interval '1 day', now() - interval '5 days')
    || ',' || green_ago(now() - interval '9 days', now() - interval '5 days');
`));

check('a fortnight, of days a day long, on both sides', clock.get('SPAN') === `${GREEN_DAYS},${GREEN_DAY}`, clock.get('SPAN'));
const islandDays = (clock.get('DAYS') ?? '').split(',').map(Number);
const wrong = OFFSETS.flatMap((o, i) => (greenDays(F, F + o) === islandDays[i] ? [] : [`${o}s: ${greenDays(F, F + o)} against ${islandDays[i]}`]));
check(`the days grown are the same at every one of ${OFFSETS.length} moments, a day's edge to the quarter second either side`,
  wrong.length === 0 && islandDays.length === OFFSETS.length, wrong.slice(0, 4).join('; '));
check('bare to begin with, one day a day, and never past the last',
  greenDays(F, F - 1) === 0 && greenDays(F, F + D - 0.25) === 0 && greenDays(F, F + D) === 1
    && greenDays(F, F + GREEN_DAYS * D) === GREEN_DAYS && greenDays(F, F + 40 * D) === GREEN_DAYS);
const islandStarts = (clock.get('START') ?? '').split(',').map(Number);
check('a start is when it says, and never before greening came in, on both sides',
  STARTS.every(([s, f], i) => greenStart(s, f) === islandStarts[i]),
  STARTS.map(([s, f], i) => `${greenStart(s, f) - F} / ${islandStarts[i] - F}`).join(', '));
check('and the ground read carries seconds since that, from greening coming in when nothing is said or it is earlier',
  clock.get('AGO') === `${5 * D},${D},${5 * D}`, clock.get('AGO'));
check('a clearing ends in the same sentence on both sides', clock.get('AGAIN') === GREEN_AGAIN, clock.get('AGAIN'));
check('and nothing to clear yet is said the same', clock.get('YET') === NOTHING_YET, clock.get('YET'));

/* ---- 2. the starts ------------------------------------------------------------ */

const starts = keyed(psql(`
begin;
create temp table said (k text, v text);
do $$
declare w uuid; v_b bigint; v_p bigint;
begin
  select id into w from world where name = 'Hoarding';
  delete from wall where world_id = w and x between 38 and 42 and y between 38 and 42;
  delete from foundation where world_id = w and x between 38 and 42 and y between 38 and 42;
  delete from green_since where world_id = w;

  -- A wall of stone finished as it is set down: bare from now.
  insert into wall (world_id, level, dir, x, y, type, material, needed, total)
    values (w, 0, 'h', 40, 40, 'solid', 'stone_brick', '{"stone_brick": 0}', '{"stone_brick": 16}');
  insert into said select 'BUILT', coalesce((select (since = now())::text from green_since
    where world_id = w and thing = 'wall' and x = 40 and y = 40 and k = green_wall_k(0, 'h')), 'none');
  -- One of logs, finished: ivy does not climb timber, so it has no start.
  insert into wall (world_id, level, dir, x, y, type, material, needed, total)
    values (w, 0, 'v', 40, 40, 'solid', 'log', '{"log": 0}', '{"log": 16}');
  insert into said select 'WOOD', coalesce((select since::text from green_since
    where world_id = w and thing = 'wall' and x = 40 and y = 40 and k = green_wall_k(0, 'v')), 'none');
  -- A stone wall going up: nothing until its last unit goes in, and then bare from then.
  insert into wall (world_id, level, dir, x, y, type, material, needed, total)
    values (w, 0, 'h', 41, 40, 'solid', 'slate', '{"slate": 2}', '{"slate": 16}');
  insert into said select 'LAYING', coalesce((select since::text from green_since
    where world_id = w and thing = 'wall' and x = 41 and y = 40), 'none');
  update wall set needed = '{"slate": 1}' where world_id = w and level = 0 and dir = 'h' and x = 41 and y = 40;
  insert into said select 'ALMOST', coalesce((select since::text from green_since
    where world_id = w and thing = 'wall' and x = 41 and y = 40), 'none');
  update wall set needed = '{"slate": 0}' where world_id = w and level = 0 and dir = 'h' and x = 41 and y = 40;
  insert into said select 'LAID', coalesce((select (since = now())::text from green_since
    where world_id = w and thing = 'wall' and x = 41 and y = 40), 'none');
  -- A storey above it is a wall of its own.
  insert into wall (world_id, level, dir, x, y, type, material, needed, total)
    values (w, 1, 'h', 41, 40, 'solid', 'slate', '{"slate": 0}', '{"slate": 16}');
  insert into said select 'STOREYS', (select string_agg(k::text, ',' order by k) from green_since
    where world_id = w and thing = 'wall' and x = 41 and y = 40);
  -- Five days on, painting it or counting it again leaves the ivy where it is...
  update green_since set since = now() - interval '5 days' where world_id = w and thing = 'wall' and x = 40 and y = 40;
  update wall set dye = 'dye_weld', total = '{"stone_brick": 17}' where world_id = w and level = 0 and dir = 'h' and x = 40 and y = 40;
  update wall set needed = '{"stone_brick": 0}' where world_id = w and level = 0 and dir = 'h' and x = 40 and y = 40;
  insert into said select 'KEPT', (select (since = now() - interval '5 days')::text from green_since
    where world_id = w and thing = 'wall' and x = 40 and y = 40 and k = 0);
  -- ...and repointing it in another stone takes the old face and the ivy with it.
  update wall set material = 'marble', needed = '{"marble": 0}', total = '{"marble": 16}'
   where world_id = w and level = 0 and dir = 'h' and x = 40 and y = 40;
  insert into said select 'REPOINTED', (select (since = now())::text from green_since
    where world_id = w and thing = 'wall' and x = 40 and y = 40 and k = 0);
  -- Taken down, it forgets.
  delete from wall where world_id = w and level = 0 and dir = 'h' and x = 40 and y = 40;
  insert into said select 'DOWN', (select count(*)::text from green_since where world_id = w and thing = 'wall' and x = 40 and y = 40);

  -- Paving laid is bare from now, through the one door every tile goes through.
  perform land_set_tile(w, 40, 42, tile_id('Grass'));
  perform land_set_tile(w, 40, 42, tile_id('Packed dirt'));
  insert into said select 'DIRT', (select count(*)::text from green_since where world_id = w and thing = 'paving');
  perform land_set_tile(w, 40, 42, tile_id('Cobblestone'));
  insert into said select 'PAVED', coalesce((select (since = now())::text from green_since
    where world_id = w and thing = 'paving' and x = 40 and y = 42), 'none');
  update green_since set since = now() - interval '3 days' where world_id = w and thing = 'paving';
  perform land_set_tile(w, 40, 42, tile_id('Cobblestone'));
  insert into said select 'SAME', (select (since = now() - interval '3 days')::text from green_since
    where world_id = w and thing = 'paving' and x = 40 and y = 42);
  perform land_set_tile(w, 40, 42, tile_id('Stone slabs'));
  insert into said select 'RELAID', (select (since = now())::text from green_since
    where world_id = w and thing = 'paving' and x = 40 and y = 42);
  perform land_set_tile(w, 40, 42, tile_id('Packed dirt'));
  insert into said select 'LIFTED', (select count(*)::text from green_since where world_id = w and thing = 'paving');

  -- A slab: bare from its last barrowful, and forgotten when it is struck.
  insert into foundation (world_id, id, x, y, top, needed, total)
    values (w, 9001, 38, 38, 10, '{"concrete": 0}', '{"concrete": 20}'),
           (w, 9002, 39, 38, 10, '{"concrete": 4}', '{"concrete": 20}');
  insert into said select 'POURED', coalesce((select (since = now())::text from green_since
    where world_id = w and thing = 'slab' and x = 38 and y = 38), 'none')
    || ',' || coalesce((select since::text from green_since where world_id = w and thing = 'slab' and x = 39 and y = 38), 'none');
  update foundation set needed = '{"concrete": 0}' where world_id = w and id = 9002;
  insert into said select 'SET', coalesce((select (since = now())::text from green_since
    where world_id = w and thing = 'slab' and x = 39 and y = 38), 'none');
  delete from foundation where world_id = w and id = 9001;
  insert into said select 'STRUCK', (select count(*)::text from green_since where world_id = w and thing = 'slab');

  -- An arch: bare from when its last span is decked; a rope bridge never.
  insert into bridge (world_id, kind, ax, ay, bx, by, height, level) values (w, 'stone', 38, 41, 38, 44, 12, 0) returning id into v_b;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total) values
    (w, v_b, 0, 38, 42, '{"stone_brick": 1}', '{"stone_brick": 10}'),
    (w, v_b, 1, 38, 43, '{"stone_brick": 1}', '{"stone_brick": 10}');
  update bridge_span set needed = '{"stone_brick": 0}' where world_id = w and bridge = v_b and n = 0;
  insert into said select 'HALF_DECKED', (select count(*)::text from green_since where world_id = w and thing = 'bridge');
  update bridge_span set needed = '{"stone_brick": 0}' where world_id = w and bridge = v_b and n = 1;
  insert into said select 'DECKED', coalesce((select (since = now())::text from green_since
    where world_id = w and thing = 'bridge' and x = 38 and y = 41 and k = v_b), 'none');
  insert into bridge (world_id, kind, ax, ay, bx, by, height, level) values (w, 'rope', 39, 41, 39, 43, 12, 0) returning id into v_p;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total) values (w, v_p, 0, 39, 42, '{"rope": 1}', '{"rope": 4}');
  update bridge_span set needed = '{"rope": 0}' where world_id = w and bridge = v_p;
  insert into said select 'ROPE', (select count(*)::text from green_since where world_id = w and thing = 'bridge');
  delete from bridge where world_id = w and id = v_b;
  insert into said select 'PULLED', (select count(*)::text from green_since where world_id = w and thing = 'bridge');

  -- A statue's start is when it was set down; one scrubbed and then taken up forgets its scrubbing.
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_at)
    values (w, 'furniture', 'statue', 41, 38, 0, 0, 41.5, 38.5, now() - interval '2 days') returning id into v_p;
  perform green_mark(w, 'piece', 41, 38, v_p);
  delete from placed where id = v_p;
  insert into said select 'TAKEN_UP', (select count(*)::text from green_since where world_id = w and thing = 'piece');
end $$;
select k || '|' || coalesce(v, 'NULL') from said;
rollback;
`));

const is = (key: string, want: string, what: string): void => check(what, starts.get(key) === want, `${key}: ${starts.get(key)}`);
is('BUILT', 'true', 'a wall of stone finished as it is set down is bare from that moment');
is('WOOD', 'none', 'one of timber has no start, since ivy does not climb it');
is('LAYING', 'none', 'a stone wall going up has none');
is('ALMOST', 'none', 'nor with one unit still to go');
is('LAID', 'true', 'and is bare from the moment its last unit goes in');
is('STOREYS', '0,2', 'a storey above is a start of its own, by storey and run');
is('KEPT', 'true', 'painting a wall, or its bill counted again, leaves its ivy be');
is('REPOINTED', 'true', 'laying it again in another stone makes it bare from then');
is('DOWN', '0', 'a wall taken down forgets');
is('DIRT', '0', 'ground that is not paving has no start');
is('PAVED', 'true', 'paving laid is bare from then, written at the one door every tile goes through');
is('SAME', 'true', 'the same paving written over itself keeps its moss');
is('RELAID', 'true', 'paving laid again in slabs is bare again');
is('LIFTED', '0', 'and paving lifted forgets');
is('POURED', 'true,none', 'a slab poured is bare from then, shuttering not yet');
is('SET', 'true', 'and shuttering from its last barrowful');
is('STRUCK', '1', 'a slab struck forgets');
is('HALF_DECKED', '0', 'an arch half decked has no start');
is('DECKED', 'true', 'and is bare from the moment its last span is decked');
is('ROPE', '1', 'a rope bridge never has one');
is('PULLED', '0', 'an arch pulled down forgets');
is('TAKEN_UP', '0', 'a statue taken up forgets when it was last scrubbed');

// And the browser's own starts, on the same moments.
const home = Game.create(4242, 64);
const t0 = greenNow();
const going: Wall = { building: 0, level: 0, x: 40, y: 40, dir: 'h', type: 'solid', material: 'slate', needed: { slate: 2 }, total: { slate: 16 } };
home.fitIntoWall(going, 'slate');
const almost = going.greenSince;
home.fitIntoWall(going, 'slate');
check('in the browser too, a stone wall has no start until its last unit goes in, and is bare from then',
  almost === undefined && (going.greenSince ?? 0) >= t0 && (going.greenSince ?? Infinity) <= greenNow(), `${almost} then ${going.greenSince}`);
const statue = home.addFurniture('statue', 41, 38, 0, 0, 30);
const chest = home.addFurniture('chest', 42, 38, 0, 0, 30);
check('a statue set down is bare from then, and a chest has no start',
  (statue.greenSince ?? 0) >= t0 && chest.greenSince === undefined, `${statue.greenSince} / ${chest.greenSince}`);
const poured = home.addFoundation(38, 38, 10, 0);
const shuttering = home.addFoundation(39, 38, 10, 4);
check('a slab with nothing to pour is bare as it is set out; shuttering is not yet',
  (poured.greenSince ?? 0) >= t0 && shuttering.greenSince === undefined, `${poured.greenSince} / ${shuttering.greenSince}`);
const act = (id: string) => ACTIONS.find((a) => a.id === id)!;
const at = (x: number, y: number, side?: 'n' | 'e' | 's' | 'w'): Target => ({ kind: 'tile', x, y, cx: x, cy: y, ...(side ? { side } : {}) });
home.world.setTile(40, 42, TileType.PackedDirt);
home.inventory.add('stone_brick', { ql: 30 });
act('pave_cobble').perform(at(40, 42), home);
const laid = home.pavingSince.get('40,42');
act('remove_paving').perform(at(40, 42), home);
check('paving laid is bare from then, and lifted forgets, in the browser as on the island',
  laid !== undefined && laid >= t0 && !home.pavingSince.has('40,42') && home.world.getTile(40, 42) !== TileType.Cobblestone,
  `${laid} then ${home.pavingSince.get('40,42')}`);

/* ---- 3 and 4. a garden to ask about --------------------------------------------- */

const IVY = '6e6e6e6e-0001-4000-8000-00000000000a';
const ROOK = '6e6e6e6e-0002-4000-8000-00000000000b';
const WREN = '6e6e6e6e-0003-4000-8000-00000000000c';
const WHO: Record<string, string> = { ivy: IVY, rook: ROOK, wren: WREN };
/** Ivy's settlement, which everything but the one wall out in the open stands on. */
const DEED = { name: 'Ivyholm', x: 48, y: 48, r: 7 };

/** Each thing, how long ago it began (an interval, or null for "when greening came in"), and how the island says so. */
interface WallAt { key: string; level: number; dir: 'h' | 'v'; x: number; y: number; material: string; done: boolean; ago: string | null }
const WALLS: WallAt[] = [
  { key: 'w1_0', level: 0, dir: 'h', x: 44, y: 44, material: 'stone_brick', done: true, ago: '4 days 2 hours' },
  { key: 'w1_1', level: 1, dir: 'h', x: 44, y: 44, material: 'slate', done: true, ago: '9 days 5 hours' },
  { key: 'wood', level: 0, dir: 'v', x: 46, y: 44, material: 'log', done: true, ago: null },
  { key: 'half', level: 0, dir: 'v', x: 48, y: 44, material: 'stone_brick', done: false, ago: null },
  { key: 'fresh', level: 0, dir: 'h', x: 50, y: 44, material: 'marble', done: true, ago: '0 seconds' },
  { key: 'old', level: 0, dir: 'h', x: 52, y: 44, material: 'cobblestone', done: true, ago: null },
  { key: 'wild', level: 0, dir: 'h', x: 58, y: 50, material: 'sandstone', done: true, ago: '2 days 1 hour' },
];
const PAVING: Array<{ key: string; x: number; y: number; ago: string | null }> = [
  { key: 'p1', x: 44, y: 48, ago: '3 days 1 hour' },
  { key: 'pold', x: 46, y: 48, ago: null },
  { key: 'pslab', x: 48, y: 48, ago: '2 days' },
];
const SLABS: Array<{ key: string; id: number; x: number; y: number; done: boolean; ago: string | null }> = [
  { key: 'pslab_s', id: 9101, x: 48, y: 48, done: true, ago: '12 days 6 hours' },
  { key: 's1', id: 9102, x: 50, y: 48, done: true, ago: '11 days' },
  { key: 'swet', id: 9103, x: 52, y: 48, done: false, ago: null },
];
/** Tiles that are not paved, set so on both sides. */
const GRASS: Array<[number, number]> = [[50, 48], [52, 48], [54, 48]];
const GREEN_FROM_AGO = '15 days 2 hours';

/** A question: who asks, what, of what, and where they stand. */
interface Ask { key: string; who: 'ivy' | 'rook' | 'wren'; act: 'clear_ivy' | 'scrub_moss'; t: string; at: [number, number]; islandOnly?: boolean }
/** Targets by name: tiles as they are, the rest by the ids the island gives them. */
const TILES: Record<string, Target> = {
  w1: at(44, 44, 'n'), w1s: at(44, 43, 's'), noside: at(44, 44), wood: at(46, 44, 'w'), half: at(48, 44, 'w'),
  fresh: at(50, 44, 'n'), old: at(52, 44, 'n'), nowall: at(54, 44, 'n'), wild: at(58, 50, 'n'),
  p1: at(44, 48), pold: at(46, 48), pslab: at(48, 48), s1: at(50, 48), swet: at(52, 48), bare: at(54, 48),
};
const THINGS: Record<string, { kind: 'furniture' | 'bridge'; v: string }> = {
  statue: { kind: 'furniture', v: 'v_statue' }, chest: { kind: 'furniture', v: 'v_chest' },
  arch: { kind: 'bridge', v: 'v_arch' }, rope: { kind: 'bridge', v: 'v_rope' },
};
const targetSql = (t: string): string => {
  if (THINGS[t]) return `jsonb_build_object('kind', '${THINGS[t].kind}', 'id', ${THINGS[t].v})`;
  const tt = TILES[t] as Extract<Target, { kind: 'tile' }>;
  return `'${JSON.stringify({ kind: 'tile', x: tt.x, y: tt.y, cx: tt.cx, cy: tt.cy, ...(tt.side ? { side: tt.side } : {}) })}'::jsonb`;
};
const STAND: Record<string, [number, number]> = {
  w1: [44.5, 44.5], w1s: [44.5, 43.5], noside: [44.5, 44.5], wood: [46.5, 44.5], half: [48.5, 44.5], fresh: [50.5, 44.5],
  old: [52.5, 44.5], nowall: [54.5, 44.5], wild: [58.5, 50.5], p1: [44.5, 48.5], pold: [46.5, 48.5], pslab: [48.5, 48.5],
  s1: [50.5, 48.5], swet: [52.5, 48.5], bare: [54.5, 48.5], statue: [44.5, 52.5], chest: [46.5, 52.5], arch: [47.5, 52.5],
  rope: [47.5, 55.5],
};
const ask = (key: string, who: Ask['who'], act: Ask['act'], t: string, extra: Partial<Ask> = {}): Ask => ({ key, who, act, t, at: STAND[t], ...extra });
/** Asked before anybody has a tool. */
const BARE: Ask[] = [ask('nosickle', 'ivy', 'clear_ivy', 'w1'), ask('nobrush', 'ivy', 'scrub_moss', 'p1')];
const ASKS: Ask[] = [
  ask('w1', 'ivy', 'clear_ivy', 'w1'), ask('w1s', 'ivy', 'clear_ivy', 'w1s'), ask('noside', 'ivy', 'clear_ivy', 'noside'),
  ask('wood', 'ivy', 'clear_ivy', 'wood'), ask('half', 'ivy', 'clear_ivy', 'half'), ask('fresh', 'ivy', 'clear_ivy', 'fresh'),
  ask('old', 'ivy', 'clear_ivy', 'old'), ask('nowall', 'ivy', 'clear_ivy', 'nowall'),
  ask('p1', 'ivy', 'scrub_moss', 'p1'), ask('pold', 'ivy', 'scrub_moss', 'pold'), ask('pslab', 'ivy', 'scrub_moss', 'pslab'),
  ask('s1', 'ivy', 'scrub_moss', 's1'), ask('swet', 'ivy', 'scrub_moss', 'swet'), ask('bare', 'ivy', 'scrub_moss', 'bare'),
  ask('statue', 'ivy', 'scrub_moss', 'statue'), ask('chest', 'ivy', 'scrub_moss', 'chest'),
  ask('arch', 'ivy', 'scrub_moss', 'arch'), ask('rope', 'ivy', 'scrub_moss', 'rope'),
  ask('rook_w1', 'rook', 'clear_ivy', 'w1'), ask('rook_statue', 'rook', 'scrub_moss', 'statue'),
  ask('rook_arch', 'rook', 'scrub_moss', 'arch'), ask('rook_wild', 'rook', 'clear_ivy', 'wild'),
  ask('wren_w1', 'wren', 'clear_ivy', 'w1'), ask('wren_p1', 'wren', 'scrub_moss', 'p1'),
  ask('far', 'ivy', 'clear_ivy', 'w1', { at: [40.5, 40.5], islandOnly: true }),
];
/** What Ivy clears, in this order, on both sides. */
const DOES: Ask[] = [
  ask('w1', 'ivy', 'clear_ivy', 'w1'), ask('p1', 'ivy', 'scrub_moss', 'p1'), ask('pslab', 'ivy', 'scrub_moss', 'pslab'),
  ask('s1', 'ivy', 'scrub_moss', 's1'), ask('statue', 'ivy', 'scrub_moss', 'statue'), ask('arch', 'ivy', 'scrub_moss', 'arch'),
];

/** The island's days for each thing, as `green_refusal` works them out. */
const since = (thing: string, x: number, y: number, k: string): string =>
  `(select g.since from green_since g where g.world_id = w and g.thing = '${thing}' and g.x = ${x} and g.y = ${y} and g.k = ${k})`;
const DAYS_SQL: Array<[string, string]> = [
  ...WALLS.map((wl): [string, string] => [wl.key, wl.done && wl.material !== 'log'
    ? `green_days(green_start(${since('wall', wl.x, wl.y, `green_wall_k(${wl.level}, '${wl.dir}')`)}, v_from))::text` : `'null'`]),
  ...PAVING.map((p): [string, string] => [p.key, `green_days(green_start(${since('paving', p.x, p.y, '0')}, v_from))::text`]),
  ...SLABS.map((s): [string, string] => [s.key, s.done ? `green_days(green_start(${since('slab', s.x, s.y, '0')}, v_from))::text` : `'null'`]),
  ['statue', `green_days(green_start(greatest((select made_at from placed where id = v_statue), ${since('piece', 44, 52, 'v_statue')}), v_from))::text`],
  ['chest', `'null'`],
  ['arch', `green_days(green_start(${since('bridge', 48, 52, 'v_arch')}, v_from))::text`],
  ['rope', `'null'`],
];
const daysSql = (prefix: string): string => DAYS_SQL.map(([k, e]) => `insert into said values ('${prefix}_${k}', ${e});`).join('\n  ');
const askSql = (a: Ask, prefix = 'R'): string =>
  `update player set x = ${a.at[0]}, y = ${a.at[1]} where world_id = w and uid = '${WHO[a.who]}';
  insert into said values ('${prefix}_${a.key}', coalesce(act_refusal(w, '${WHO[a.who]}', '${a.act}', ${targetSql(a.t)}), 'ALLOWED'));`;
const groundSql = (key: string, who: string, slow = true): string =>
  `update player set x = 48.5, y = 48.5 where world_id = w and uid = '${WHO[who]}';
  perform set_config('request.jwt.claims', json_build_object('sub', '${WHO[who]}')::text, true);
  insert into said values ('${key}', rpc_ground(w, 40, ${slow})::text);`;
const interval = (ago: string | null): string => (ago === null ? 'null' : `now() - interval '${ago}'`);
/** Sets a start to `ago`, or takes it away so it began when greening came in. */
const startSql = (thing: string, x: number, y: number, k: string, ago: string | null): string =>
  ago === null
    ? `delete from green_since where world_id = w and thing = '${thing}' and x = ${x} and y = ${y} and k = ${k};`
    : `insert into green_since (world_id, thing, x, y, k, since) values (w, '${thing}', ${x}, ${y}, ${k}, ${interval(ago)})
       on conflict (world_id, thing, x, y, k) do update set since = excluded.since;`;

const scene = keyed(psql(`
begin;
create temp table said (k text, v text);
do $$
declare w uuid; v_from timestamptz; v_statue bigint; v_chest bigint; v_arch bigint; v_rope bigint;
        v_full jsonb := '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb;
begin
  select id into w from world where name = 'Hoarding';
  -- A clear corner, and greening came in ${GREEN_FROM_AGO} ago.
  delete from wall where world_id = w and x between 40 and 60 and y between 40 and 58;
  delete from foundation where world_id = w and x between 40 and 60 and y between 40 and 58;
  delete from placed where world_id = w and x between 40 and 60 and y between 40 and 58;
  delete from bridge where world_id = w and ax between 40 and 60 and ay between 40 and 58;
  delete from green_since where world_id = w;
  update world set green_from = ${interval(GREEN_FROM_AGO)} where id = w;
  select green_from into v_from from world where id = w;

  delete from player where world_id = w and uid in ('${IVY}', '${ROOK}', '${WREN}');
  insert into player (world_id, uid, name, x, y, stats) values
    (w, '${IVY}', 'Ivy', 48.5, 48.5, v_full), (w, '${ROOK}', 'Rook', 48.5, 48.5, v_full), (w, '${WREN}', 'Wren', 48.5, 48.5, v_full);
  -- Ivy's settlement; Wren is a guest on it and Rook nothing.
  insert into deed (world_id, name, x, y, radius, founded_by) values (w, '${DEED.name}', ${DEED.x}, ${DEED.y}, ${DEED.r}, '${IVY}');
  insert into deed_member (world_id, founder, uid, role) values (w, '${IVY}', '${WREN}', 'guest');

  -- The walls.
  ${WALLS.map((wl) => `insert into wall (world_id, level, dir, x, y, type, material, needed, total) values (w, ${wl.level}, '${wl.dir}', ${wl.x}, ${wl.y}, 'solid', '${wl.material}', '{"${wl.material}": ${wl.done ? 0 : 3}}', '{"${wl.material}": 16}');
  ${wl.done && wl.material !== 'log' ? startSql('wall', wl.x, wl.y, `green_wall_k(${wl.level}, '${wl.dir}')`, wl.ago) : ''}`).join('\n  ')}
  -- The paving, and the ground that is not.
  ${PAVING.map((p) => `perform land_set_tile(w, ${p.x}, ${p.y}, tile_id('Cobblestone'));
  ${startSql('paving', p.x, p.y, '0', p.ago)}`).join('\n  ')}
  ${GRASS.map(([x, y]) => `perform land_set_tile(w, ${x}, ${y}, tile_id('Grass'));`).join('\n  ')}
  -- The slabs.
  ${SLABS.map((s) => `insert into foundation (world_id, id, x, y, top, needed, total) values (w, ${s.id}, ${s.x}, ${s.y}, 10, '{"concrete": ${s.done ? 0 : 4}}', '{"concrete": 20}');
  ${s.done ? startSql('slab', s.x, s.y, '0', s.ago) : ''}`).join('\n  ')}
  -- A statue set down eight days ago, and a chest beside it.
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, made_at)
    values (w, 'furniture', 'statue', 44, 52, 0, 0, 44.5, 52.5, 30, '${IVY}', now() - interval '8 days 4 hours') returning id into v_statue;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'furniture', 'chest', 46, 52, 0, 0, 46.5, 52.5, 30, '${IVY}') returning id into v_chest;
  -- A stone arch decked twenty days ago, which is as green as it gets, and a rope bridge.
  insert into bridge (world_id, kind, ax, ay, bx, by, height, level) values (w, 'stone', 48, 52, 52, 52, 12, 0) returning id into v_arch;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total) values
    (w, v_arch, 0, 49, 52, '{"stone_brick": 0}', '{"stone_brick": 10}'),
    (w, v_arch, 1, 50, 52, '{"stone_brick": 0}', '{"stone_brick": 10}'),
    (w, v_arch, 2, 51, 52, '{"stone_brick": 0}', '{"stone_brick": 10}');
  ${startSql('bridge', 48, 52, 'v_arch', '20 days')}
  insert into bridge (world_id, kind, ax, ay, bx, by, height, level) values (w, 'rope', 48, 55, 51, 55, 12, 0) returning id into v_rope;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total) values
    (w, v_rope, 0, 49, 55, '{"rope": 0}', '{"rope": 4}'), (w, v_rope, 1, 50, 55, '{"rope": 0}', '{"rope": 4}');
  insert into said values ('IDS', v_statue || ',' || v_chest || ',' || v_arch || ',' || v_rope);

  -- What each thing has grown, as the island counts it.
  ${daysSql('DAYS')}

  -- Asked with nothing in hand, and then with a sickle and a brush each.
  ${BARE.map((a) => askSql(a)).join('\n  ')}
  ${Object.values(WHO).map((u) => `perform give(w, '${u}', 'sickle', 1, 30); perform give(w, '${u}', 'brush', 1, 30);`).join('\n  ')}
  ${ASKS.map((a) => askSql(a)).join('\n  ')}

  -- What each of them is told of it: the slow half, and Ivy's fast half.
  ${groundSql('GROUND_ivy', 'ivy')}
  ${groundSql('GROUND_rook', 'rook')}
  ${groundSql('GROUND_wren', 'wren')}
  ${groundSql('FAST_ivy', 'ivy', false)}

  -- Ivy clears it all, and is told so; then there is nothing yet to clear.
  ${DOES.map((a) => `update player set x = ${a.at[0]}, y = ${a.at[1]} where world_id = w and uid = '${IVY}';
  perform act_perform(w, '${IVY}', '${a.act}', ${targetSql(a.t)});
  insert into said values ('DID_${a.key}', (select text from event where world_id = w and uid = '${IVY}' order by n desc limit 1));
  ${askSql(a, 'AFTER')}`).join('\n  ')}
  -- Rook tries on Ivy's land and nothing happens.
  update player set x = 52.5, y = 44.5 where world_id = w and uid = '${ROOK}';
  perform act_perform(w, '${ROOK}', 'clear_ivy', ${targetSql('old')});
  insert into said values ('ROOK_DID', coalesce((select text from event where world_id = w and uid = '${ROOK}' order by n desc limit 1), 'nothing')
    || '|' || (select count(*) from green_since where world_id = w and thing = 'wall' and x = 52 and y = 44));
  ${daysSql('LATER')}
  ${groundSql('GROUND_after', 'ivy')}
end $$;
select k || '|' || coalesce(v, 'NULL') from said;
rollback;
`));

const [STATUE, CHEST, ARCH, ROPE] = (scene.get('IDS') ?? '').split(',').map(Number);
const TARGETS: Record<string, Target> = {
  ...TILES,
  statue: { kind: 'furniture', id: STATUE }, chest: { kind: 'furniture', id: CHEST },
  arch: { kind: 'bridge', id: ARCH }, rope: { kind: 'bridge', id: ROPE },
};
const grounds = (key: string): IslandGround => JSON.parse(scene.get(key) ?? '{}') as IslandGround;
const byId = (id: string) => GREEN_ACTIONS.find((a) => a.id === id)!;

/** A browser as each of them has it: the tiles it streamed, and the ground read the island gave it. */
function browserOf(who: string, read: string): Game {
  const g = Game.create(4242, 64);
  g.bodyFromIsland = true;
  g.inventory.items.splice(0);
  for (const p of PAVING) g.world.setTile(p.x, p.y, TileType.Cobblestone);
  for (const [x, y] of GRASS) g.world.setTile(x, y, TileType.Grass);
  g.sawGround(grounds(read), undefined, WHO[who]);
  return g;
}

/** Each thing's days in a browser, the way the drawing and the refusals work them out. */
function browserDays(g: Game): Map<string, string> {
  const now = greenNow();
  const out = new Map<string, string>();
  const show = (d: number | null): string => (d === null ? 'null' : String(d));
  for (const wl of WALLS) {
    const w = [...g.buildings.walls.values()].find((v) => v.level === wl.level && v.dir === wl.dir && v.x === wl.x && v.y === wl.y);
    out.set(wl.key, w ? show(wallGreen(g, w, now)) : 'missing');
  }
  for (const p of PAVING) out.set(p.key, show(pavingGreen(g, p.x, p.y, now)));
  for (const s of SLABS) {
    const f = g.foundations.get(s.id);
    out.set(s.key, f ? show(slabGreen(g, f, now)) : 'missing');
  }
  for (const [key, id] of [['statue', STATUE], ['chest', CHEST]] as const) {
    const f = g.furniture.get(id);
    out.set(key, f ? show(pieceGreen(g, f, now)) : 'missing');
  }
  for (const [key, id] of [['arch', ARCH], ['rope', ROPE]] as const) {
    const b = g.bridges.get(id);
    out.set(key, b ? show(bridgeGreen(g, b, now)) : 'missing');
  }
  return out;
}

/* ---- 3. what the ground read carries --------------------------------------------- */

const ivy = browserOf('ivy', 'GROUND_ivy');
const seen = browserDays(ivy);
const keys = DAYS_SQL.map(([k]) => k);
const differ = keys.filter((k) => seen.get(k) !== scene.get(`DAYS_${k}`));
check(`every thing's days, worked out in the browser from the ground read, are the island's: ${keys.length} things`,
  differ.length === 0, differ.map((k) => `${k} ${seen.get(k)} against ${scene.get(`DAYS_${k}`)}`).join('; '));
check('which are the ages they were given: a storey at a time, from greening coming in when nothing is said, and no more than the last',
  ['w1_0:4', 'w1_1:9', 'fresh:0', 'old:14', 'wild:2', 'p1:3', 'pold:14', 'pslab:2', 'pslab_s:12', 's1:11', 'statue:8', 'arch:14']
    .every((kv) => `${kv.split(':')[0]}:${seen.get(kv.split(':')[0])}` === kv),
  keys.map((k) => `${k}=${seen.get(k)}`).join(' '));
check('and what does not green says so on both: timber, a wall going up, shuttering, a chest, a rope bridge',
  ['wood', 'half', 'swet', 'chest', 'rope'].every((k) => seen.get(k) === 'null' && scene.get(`DAYS_${k}`) === 'null'));
const fast = grounds('FAST_ivy');
const statueRow = fast.placed?.find((r) => r.id === STATUE);
const chestRow = fast.placed?.find((r) => r.id === CHEST);
check('the fast half carries a statue\'s seconds with it, and nothing for a chest',
  typeof statueRow?.green_ago === 'number' && !!chestRow && !('green_ago' in chestRow), `${statueRow?.green_ago} / ${JSON.stringify(chestRow?.green_ago)}`);
check('and leaves the paving and the walls to the slow half',
  fast.paving === undefined && fast.greenFromAgo === undefined && fast.buildings === undefined && fast.bridges === undefined);
ivy.sawGround(fast, undefined, IVY);
check('so a fast read in between changes nobody\'s days', [...browserDays(ivy)].every(([k, v]) => seen.get(k) === v));
// Paving the island lays between two ground reads comes as a tile, before the read that says when it went down.
const between = browserOf('ivy', 'GROUND_ivy');
between.world.setTile(56, 48, TileType.Cobblestone);
between.sawPaving(56, 48, true);
const laidNow = pavingGreen(between, 56, 48, greenNow());
const keptOld = pavingGreen(between, 46, 48, greenNow());
between.world.setTile(56, 48, TileType.Dirt);
between.sawPaving(56, 48, false);
check('paving the island has just laid is bare until the ground read says when, and paving already there keeps its moss',
  laidNow === 0 && keptOld === 14 && !between.pavingSince.has('56,48'), `${laidNow} / ${keptOld}`);
check('the bridges come with the slow half, spans and all, as the browser keeps them, and the deck is walked',
  ivy.bridges.get(ARCH)?.spans.length === 3 && ivy.bridges.get(ROPE)?.kind === 'rope' && ivy.bridgeAt(50, 52)?.id === ARCH
    && ivy.deckAt(50, 52) === 12,
  JSON.stringify(ivy.bridges.get(ARCH)?.spans.map((s) => [s.x, s.y])));

/* ---- 4. the two actions ------------------------------------------------------------- */

const asked = (g: Game, a: Ask): string => byId(a.act).check?.(TARGETS[a.t], g) ?? 'ALLOWED';
// With nothing in hand first.
for (const a of BARE) {
  const mine = asked(ivy, a);
  check(`${a.key}: the same refusal on both sides`, mine === scene.get(`R_${a.key}`), `"${mine}" against "${scene.get(`R_${a.key}`)}"`);
}
check('which is the tool, named', scene.get('R_nosickle') === 'You need a sickle to clear the ivy.' && scene.get('R_nobrush') === 'You need a brush to scrub the moss.',
  `${scene.get('R_nosickle')} / ${scene.get('R_nobrush')}`);
const rook = browserOf('rook', 'GROUND_rook');
const wren = browserOf('wren', 'GROUND_wren');
for (const g of [ivy, rook, wren]) {
  g.inventory.add('sickle', { ql: 30 });
  g.inventory.add('brush', { ql: 30 });
}
const BROWSERS: Record<string, Game> = { ivy, rook, wren };
for (const a of ASKS.filter((q) => !q.islandOnly)) {
  const mine = asked(BROWSERS[a.who], a);
  check(`${a.key}: ${a.who} is answered the same on both sides`, mine === scene.get(`R_${a.key}`), `"${mine}" against "${scene.get(`R_${a.key}`)}"`);
}
const said = (k: string): string => scene.get(`R_${k}`) ?? 'MISSING';
check('whatever has grown, its settlement\'s builders may clear it', ['w1', 'w1s', 'old', 'p1', 'pold', 'pslab', 's1', 'statue', 'arch'].every((k) => said(k) === 'ALLOWED'),
  ['w1', 'w1s', 'old', 'p1', 'pold', 'pslab', 's1', 'statue', 'arch'].map((k) => `${k}: ${said(k)}`).join(' / '));
check('and anybody may on land nobody holds', said('rook_wild') === 'ALLOWED', said('rook_wild'));
check('a stranger or a guest is told whose it is',
  said('rook_w1') === `That is part of ${DEED.name}. Only its builders may clear the ivy there.`
    && said('wren_p1') === `That is part of ${DEED.name}. Only its builders may scrub the moss there.`,
  `${said('rook_w1')} / ${said('wren_p1')}`);
check('a wall of timber, or one still going up, has no ivy to clear',
  said('wood') === 'There is no finished wall of stone or brick there.' && said('half') === said('wood') && said('nowall') === said('wood'),
  `${said('wood')} / ${said('half')} / ${said('nowall')}`);
check('a tile with neither paving nor a poured slab has no moss to scrub', said('swet') === 'There is no paving or poured foundation here.' && said('bare') === said('swet'), said('bare'));
check('nor has a chest or a rope bridge', said('chest') === 'No moss grows on that.' && said('rope') === said('chest'), said('rope'));
check('a wall finished today has nothing on it yet', said('fresh') === NOTHING_YET, said('fresh'));
check('and the island asks you to stand beside what you clear', said('far') === 'You are too far away from that.', said('far'));
const menu = (t: Target): boolean => ivy.actionsFor(t).some((e) => e.def.id === 'scrub_moss');
check('Scrub the moss is on the menu of paving, a slab, a statue and an arch, and not of a chest, a rope bridge or grass',
  ['p1', 'pslab', 's1', 'statue', 'arch'].every((k) => menu(TARGETS[k])) && !['chest', 'rope', 'bare'].some((k) => menu(TARGETS[k])));

// And done, on both sides.
for (const a of DOES) {
  ivy.log.length = 0;
  byId(a.act).perform(TARGETS[a.t], ivy);
  const told = ivy.log.map((l) => l.text).join(' | ');
  check(`${a.key}: clearing it says the same on both sides`, told === scene.get(`DID_${a.key}`), `"${told}" against "${scene.get(`DID_${a.key}`)}"`);
  const after = asked(ivy, a);
  check(`${a.key}: and leaves nothing to clear on either`, after === NOTHING_YET && scene.get(`AFTER_${a.key}`) === NOTHING_YET,
    `"${after}" / "${scene.get(`AFTER_${a.key}`)}"`);
}
check('the words name what was cleared', scene.get('DID_w1') === `You clear the ivy off the north wall. ${GREEN_AGAIN}`
  && scene.get('DID_pslab') === `You scrub the moss off the paving and the foundation. ${GREEN_AGAIN}`
  && scene.get('DID_statue') === `You scrub the moss off the statue. ${GREEN_AGAIN}`
  && scene.get('DID_arch') === `You scrub the moss off the bridge. ${GREEN_AGAIN}`, scene.get('DID_pslab'));
const ivyNow = browserDays(ivy);
const cleared = ['w1_0', 'w1_1', 'p1', 'pslab', 'pslab_s', 's1', 'statue', 'arch'];
check('every storey of that side, and everything scrubbed, is bare stone in the browser that did it',
  cleared.every((k) => ivyNow.get(k) === '0'), cleared.map((k) => `${k}=${ivyNow.get(k)}`).join(' '));
check('and on the island', cleared.every((k) => scene.get(`LATER_${k}`) === '0'), cleared.map((k) => `${k}=${scene.get(`LATER_${k}`)}`).join(' '));
check('while what was not cleared keeps what it had, on both', ['old', 'wild', 'pold', 'fresh'].every((k) =>
  ivyNow.get(k) === seen.get(k) && scene.get(`LATER_${k}`) === scene.get(`DAYS_${k}`)));
const later = browserDays(browserOf('ivy', 'GROUND_after'));
const differLater = keys.filter((k) => later.get(k) !== scene.get(`LATER_${k}`));
check('and every browser is told so by the next ground read', differLater.length === 0,
  differLater.map((k) => `${k} ${later.get(k)} against ${scene.get(`LATER_${k}`)}`).join('; '));
const before = [...rook.buildings.walls.values()].find((w) => w.x === 52 && w.y === 44)?.greenSince;
rook.log.length = 0;
byId('clear_ivy').perform(TARGETS.old, rook);
check('a clearing refused does nothing and says nothing, on both sides',
  rook.log.length === 0 && [...rook.buildings.walls.values()].find((w) => w.x === 52 && w.y === 44)?.greenSince === before
    && scene.get('ROOK_DID') === 'nothing|0', `${scene.get('ROOK_DID')}`);

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} went wrong` : `\nall ${ok.length} right`);
process.exit(bad.length ? 1 : 0);
