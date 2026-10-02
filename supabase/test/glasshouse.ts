/**
 * Glasshouses, the same on both sides.
 *
 * A roof may be laid in glass, on a pitched roof and nowhere else; a building
 * of one storey with every tile of it under finished glass is a glasshouse,
 * whose ground is tilled and sown like a field; and what grows there grows at
 * `GLASSHOUSE_GROWTH` of its pace in every season, winter included, on a clock
 * of its own -- the glass clock, that share of the plain one. A crop is carried
 * onto that clock when the last of the glass over it is finished and back onto
 * the field's when any of it comes off, as far into its stage as it had grown.
 * The browser (`src/game/glasshouse.ts`) and the island (the `glasshouses`
 * migration) each work all of it out for themselves, so this puts them to the
 * same questions and holds them to each other:
 *
 *   * the glass clock and its inverse at thousands of moments, to the last bit;
 *   * crops under glass settled across every turn of the year, to the same
 *     stage and stage start to the microsecond, and held in each season: the
 *     whole of their pace in every one, winter too, where a field has none;
 *   * a stage start carried from the field's clock onto the glass clock and
 *     back, at moments all round the year, to the microsecond, and never
 *     losing or gaining a second of what the crop had grown;
 *   * the words a sowing and a wait are said in;
 *   * a glasshouse built through the doors on both sides -- glass refused on a
 *     wall, a fence, a floor and a flat roof, its ground refused a till until
 *     the last pane is in, then tilled, sown, tended, carried off the glass
 *     clock when a roof tile comes off and back on when it is laid again, and
 *     when a tile joins the footprint and leaves it, and when a wall comes down
 *     and goes back up -- a fence in its place too low to count; refused a till
 *     on a poured slab; grown on in a winter while
 *     the field outside it waits; brought on by Bounty, moved a night by a
 *     night's sleep, harvested, and worked by a Farmer's pace and patches; what
 *     is left in it indoors; what Examine says of it; no roof but glass and no
 *     storey over a field until the field is cleared, and the field cleared
 *     back to packed earth;
 *     and the ground read that carries all of it.
 *
 * Runs against the database the suite leaves behind (Hoarding, and Dane on
 * it), and puts it back.
 */
import { Game } from '../../src/game/game';
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import { floorBill, GLASS_ROOF, INDOORS_DECAY, isDone, wallBill, type Side } from '../../src/game/building';
import { CROPS, cropSteps, cropWhen, cropYield, glassExamine, RIPE, settleCrop, sownSaid, STAGE_NAMES, type Crop } from '../../src/game/farming';
import {
  fieldClock, fieldMoment, glassClock, glassMoment, GLASSHOUSE_GROWTH, rebaseStage, SEASON_GROWTH, SEASON_SECONDS,
  SPRING_GROWTH, YEAR_SECONDS,
} from '../../src/game/growth';
import {
  clearedSaid, FIELD_GLASS_ONLY, FIELD_NO_STOREY, FIELD_UNFLOORED, GLASS, GLASS_FLOORED, GLASS_PITCHED, GLASS_ROOF_ONLY, GLASS_SLAB, isGlasshouse, NOT_A_GLASSHOUSE, underGlass,
} from '../../src/game/glasshouse';
import { perksOf } from '../../src/game/perks';
import { packLand, packWorld, unpack } from '../../src/game/save';
import { SEASONS, YEAR_FROM, type Season } from '../../src/world/calendar';
import { DAY_SECONDS } from '../../src/game/pace';
import { TileType } from '../../src/world/tiles';

const psql = (sql: string): string =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
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

const HOUR = 3600;
const DAY = 24 * HOUR;
const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
/** Rolls that are the same rolls every run. */
let state = 0x61a55e5;
const rnd = (): number => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** Moments cross the wire as whole microseconds, as `seasons.ts` has it. */
const usOf = (t: number): number => Math.round(t * 1e6);
const num = (s: string): number => (s === 'Infinity' ? Infinity : s === '-Infinity' ? -Infinity : Number(s));
/** The microsecond the island stores a moment in epoch seconds at, as its `to_timestamp` rounds it. */
const PG_EPOCH = 946684800;
const rint = (x: number): number => {
  const f = Math.floor(x);
  const d = x - f;
  return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;
};
const storedUs = (t: number): number => rint((t - PG_EPOCH) * 1e6) + PG_EPOCH * 1e6;
const ts = (us: string): string => `(timestamptz 'epoch' + ${us} * interval '1 microsecond')`;

check(`a glasshouse grows at ${GLASSHOUSE_GROWTH} of a crop's pace, a spring field's, on both sides`,
  GLASSHOUSE_GROWTH === SPRING_GROWTH && Number(psql('select glasshouse_growth()')) === GLASSHOUSE_GROWTH, psql('select glasshouse_growth()'));
{
  const theirs = psql(`select floor_bill('glass', 'roof', 'hip')::text || '|' || floor_bill('glass', 'roof', 'gable')::text
                         || '|' || bill_text('glass', floor_bill('glass', 'roof', 'hip'))`).split('|');
  const hip = floorBill(GLASS, 'roof', 'hip').total;
  const gable = floorBill(GLASS, 'roof', 'gable').total;
  const same = (a: Record<string, number>, j: string): boolean => {
    const b = JSON.parse(j) as Record<string, number>;
    return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);
  };
  check(`a tile of glass roof costs the same on both sides: hipped ${hip.glass} panes and ${hip.timber} timbers, gabled ${gable.glass} and ${gable.timber}`,
    same(hip, theirs[0]) && same(gable, theirs[1]) && GLASS_ROOF.bill.every(([id]) => id in hip), theirs.join(' / '));
}

/* ---- the glass clock, to the last bit ------------------------------------------------------ */

const moments: number[] = [];
for (let t = YEAR_FROM - 30 * DAY; t <= YEAR_FROM + 2 * YEAR_SECONDS; t += 3 * HOUR) moments.push(usOf(t));
for (let k = 0; k <= 8; k++) {
  const turn = YEAR_FROM + k * SEASON_SECONDS;
  for (const d of [-1, -1e-6, 0, 1e-6, 1]) moments.push(usOf(turn) + Math.round(d * 1e6));
}
for (let i = 0; i < 1500; i++) moments.push(usOf(YEAR_FROM - YEAR_SECONDS) + Math.floor(rnd() * 4 * YEAR_SECONDS * 1e6));
const readings: number[] = moments.map((u) => glassClock(u / 1e6));
for (let i = 0; i < 1000; i++) readings.push(YEAR_FROM - YEAR_SECONDS + rnd() * 4 * YEAR_SECONDS);
{
  const out = psql(`
select string_agg(crop_clock_on('glass', ${ts('u.m')})::text, ',' order by u.i)
  from unnest(array[${moments.join(',')}]::bigint[]) with ordinality u(m, i);
select string_agg(((extract(epoch from crop_moment_on('glass', r.g)) * 1000000)::bigint)::text, ',' order by r.i)
  from unnest(array[${readings.map((g) => `${g}`).join(',')}]::double precision[]) with ordinality r(g, i);
`).split('\n');
  const clock = out[0].split(',').map(num);
  const back = out[1].split(',').map(Number);
  const clockSame = moments.filter((u, i) => glassClock(u / 1e6) === clock[i]).length;
  const backSame = readings.filter((g, i) => storedUs(glassMoment(g)) === back[i]).length;
  check(`the glass clock is the same double on both sides at ${moments.length} moments`, clockSame === moments.length, `${clockSame} of ${moments.length}`);
  check(`and the moment it reads each of ${readings.length} readings is the same microsecond`, backSame === readings.length, `${backSame} of ${readings.length}`);
}

/* ---- crops under glass settled across the turns --------------------------------------------- */

interface Case { stage: number; at: number; now: number; per: number }
const PERS = [CROPS.mint.stageSeconds, CROPS.wheat.stageSeconds * 0.8, CROPS.corn.stageSeconds * 0.72 * 0.8, 3.3 * DAY];
const cases: Case[] = [];
for (let k = 1; k <= 8; k++) {
  const turn = usOf(YEAR_FROM + k * SEASON_SECONDS);
  for (const per of PERS) {
    for (const back of [3 * per, per - 1, 1, 0, -1]) {
      const at = turn - Math.round(back * 1e6);
      for (const later of [1, per / 2, per, 1.5 * per, 2 * per, DAY, 8 * DAY]) {
        cases.push({ stage: Math.floor(rnd() * RIPE), at, now: at + Math.round(later * 1e6), per });
      }
    }
  }
}
for (let i = 0; i < 800; i++) {
  const at = usOf(YEAR_FROM - 30 * DAY) + Math.floor(rnd() * 2 * YEAR_SECONDS * 1e6);
  cases.push({ stage: Math.floor(rnd() * RIPE), at, now: at + Math.floor(rnd() * 40 * DAY * 1e6), per: PERS[Math.floor(rnd() * PERS.length)] });
}
{
  const out = psql(`
select string_agg(s.o_stage || ':' || s.o_steps || ':' || (extract(epoch from s.o_stage_at) * 1000000)::bigint, ',' order by c.i)
  from unnest(array[${cases.map((c) => c.stage).join(',')}]::int[], array[${cases.map((c) => c.at).join(',')}]::bigint[],
              array[${cases.map((c) => c.now).join(',')}]::bigint[], array[${cases.map((c) => `${c.per}`).join(',')}]::double precision[])
       with ordinality c(stage, at, now, per, i)
  cross join lateral crop_settled_on(c.stage, ${ts('c.at')}, c.per, 'glass', ${ts('c.now')}) s;`).split(',');
  let same = 0;
  let winter = 0;
  const differ: string[] = [];
  cases.forEach((cs, i) => {
    const c: Crop = { x: 0, y: 0, id: 'wheat', stage: cs.stage, stageAt: glassClock(cs.at / 1e6), tended: 0, tendedNow: false, ql: 1, glass: true };
    const steps = cropSteps(c, cs.per, glassClock(cs.now / 1e6));
    settleCrop(c, cs.per, glassClock(cs.now / 1e6));
    const startUs = steps > 0 ? storedUs(glassMoment(c.stageAt)) : cs.at;
    const [stage, isteps, iat] = (out[i] ?? '').split(':').map(Number);
    if (stage === c.stage && isteps === steps && iat === startUs) same++;
    else if (differ.length < 4) differ.push(`stage ${cs.stage} from ${cs.at} at ${cs.now}, ${cs.per}s: ${c.stage}/${steps}/${startUs} against ${out[i]}`);
    if (steps > 0 && fieldClock(cs.now / 1e6) === fieldClock(cs.at / 1e6)) winter++;
  });
  check(`${cases.length} crops under glass settled across the turns come to the same stage, steps and stage start to the microsecond`,
    same === cases.length && winter > 0, differ.join('; ') || `${same} of ${cases.length}, ${winter} of them moving on while a field stood still in a winter`);
}

/* ---- held in each season ------------------------------------------------------------------------ */

{
  const held = psql(`
begin;
create temp table held (s text, o int, v text) on commit drop;
do $$
declare v_s text; v_o int; v_now timestamptz := date_trunc('second', now());
begin
  for v_s, v_o in select u.s, u.o from unnest(seasons()) with ordinality u(s, o) loop
    perform set_config('wurm.season', v_s, true);
    insert into held values (v_s, v_o, (crop_clock_on('glass', v_now) - crop_clock_on('glass', v_now - interval '1 hour'))
      || '/' || (crop_settled_on(0, v_now - interval '1 hour', 1700, 'glass', v_now)).o_steps
      || '/' || (crop_settled_on(0, v_now - interval '1 hour', 1700, 'field', v_now)).o_steps);
  end loop;
  perform set_config('wurm.season', '', true);
end $$;
select string_agg(s || ':' || v, ',' order by o) from held;
commit;`);
  const rows = new Map(held.split(',').map((r) => r.split(':') as [string, string]));
  const right = SEASONS.every((s) => {
    const [hour, glass, field] = (rows.get(s) ?? '').split('/').map(Number);
    return Math.abs(hour - HOUR * GLASSHOUSE_GROWTH) < 1e-6 && glass === Math.floor((HOUR * GLASSHOUSE_GROWTH) / 1700)
      && field === Math.min(RIPE, Math.floor((HOUR * SEASON_GROWTH[s]) / 1700));
  });
  check(`held in each season, a crop under glass grows ${GLASSHOUSE_GROWTH} of every second, where a field grows ${SEASONS.map((s) => SEASON_GROWTH[s]).join(', ')}`,
    right, held);
}

/* ---- carried from one clock onto the other ------------------------------------------------------- */

/*
 * A stage begun at a moment and carried across at a later one, onto the glass
 * clock from a field's and back: moments all round the year, winters and turns
 * among them. The island stores the new stage start to the microsecond; the
 * browser's is the same reading carried the same way and put back as a moment.
 */
interface Move { at: number; now: number; to: 'glass' | 'field' }
const moves: Move[] = [];
for (let k = 0; k <= 8; k++) {
  const turn = usOf(YEAR_FROM + k * SEASON_SECONDS);
  for (const d of [-2 * DAY, -HOUR, -1, 0, 1, HOUR, 2 * DAY]) {
    for (const ago of [0, 1, 300, 2 * HOUR, 3 * DAY]) {
      for (const to of ['glass', 'field'] as const) moves.push({ at: turn + Math.round((d - ago) * 1e6), now: turn + Math.round(d * 1e6), to });
    }
  }
}
for (let i = 0; i < 1200; i++) {
  const now = usOf(YEAR_FROM - 20 * DAY) + Math.floor(rnd() * 2 * YEAR_SECONDS * 1e6);
  moves.push({ at: now - Math.floor(rnd() * 10 * DAY * 1e6), now, to: rnd() < 0.5 ? 'glass' : 'field' });
}
{
  const out = psql(`
select string_agg(((extract(epoch from crop_rebased(${ts('m.at')}, case when m.to_glass then 'field' else 'glass' end,
                                                     case when m.to_glass then 'glass' else 'field' end, ${ts('m.now')})) * 1000000)::bigint)::text, ',' order by m.i)
  from unnest(array[${moves.map((m) => m.at).join(',')}]::bigint[], array[${moves.map((m) => m.now).join(',')}]::bigint[],
              array[${moves.map((m) => m.to === 'glass').join(',')}]::boolean[]) with ordinality m(at, now, to_glass, i);`).split(',').map(Number);
  let same = 0;
  let kept = 0;
  const differ: string[] = [];
  const clockOf = (k: 'glass' | 'field', t: number): number => (k === 'glass' ? glassClock(t) : fieldClock(t));
  const momentOf = (k: 'glass' | 'field', g: number): number => (k === 'glass' ? glassMoment(g) : fieldMoment(g));
  moves.forEach((m, i) => {
    const from = m.to === 'glass' ? 'field' : 'glass';
    const at = m.at / 1e6;
    const now = m.now / 1e6;
    const reading = rebaseStage(clockOf(from, at), clockOf(from, now), clockOf(m.to, now));
    const mine = storedUs(momentOf(m.to, reading));
    if (mine === out[i]) same++;
    else if (differ.length < 4) differ.push(`${from} to ${m.to}, ${m.at} at ${m.now}: ${mine} against ${out[i]}`);
    // What it had grown on the old clock is what it has grown on the new one, to the rounding of a stored moment.
    const grew = clockOf(from, now) - clockOf(from, at);
    const grows = clockOf(m.to, now) - clockOf(m.to, out[i] / 1e6);
    if (Math.abs(grew - grows) < 2e-6) kept++;
  });
  check(`${moves.length} stage starts carried onto the glass clock and back come to the same microsecond on both sides`,
    same === moves.length, differ.join('; ') || `${same} of ${moves.length}`);
  check('and every one is as far into its stage on the new clock as it had grown on the old', kept === moves.length, `${kept} of ${moves.length}`);
}

/* ---- the words ------------------------------------------------------------------------------------- */

{
  const saids: Array<{ at: number; left: number; next: string }> = [];
  moments.forEach((u, i) => {
    if (i % 7) return;
    for (const left of [1, 59, CROPS.mint.stageSeconds, 3 * CROPS.corn.stageSeconds, 2 * DAY]) saids.push({ at: u, left, next: STAGE_NAMES[1 + (i % RIPE)] });
  });
  const out = psql(`
select string_agg(crop_when_on(w.nx, w.lft, 'glass', ${ts('w.at')}), '|' order by w.i)
  from unnest(array[${saids.map((w) => q(w.next)).join(',')}]::text[], array[${saids.map((w) => `${w.left}`).join(',')}]::double precision[],
              array[${saids.map((w) => w.at).join(',')}]::bigint[]) with ordinality w(nx, lft, at, i);
select sown_said_on('Wheat', 'glass', 'sprouting in 5 minutes') || '|' || sown_said_on('Mint', 'planter', 'sprouting in 8 minutes')
    || '|' || sown_said_on('Corn', 'field', 'sprouting in 9 minutes');`).split('\n');
  const theirs = out[0].split('|');
  const same = saids.filter((w, i) => cropWhen(w.next, w.left, 'glass', w.at / 1e6) === theirs[i]).length;
  const winter = saids.find((w) => fieldClock(w.at / 1e6 + 1) === fieldClock(w.at / 1e6));
  check(`when a stage under glass comes is said in the same words on both sides, ${saids.length} times over, and never waits for spring`,
    same === saids.length && !!winter && !cropWhen('sprouting', 60, 'glass', winter.at / 1e6).includes('waiting'),
    `${same} of ${saids.length}${winter ? `; in a winter: "${cropWhen('sprouting', 60, 'glass', winter.at / 1e6)}"` : ''}`);
  check('and a sowing under glass is said in the same line',
    out[1] === [sownSaid('Wheat', 'glass', 'sprouting in 5 minutes'), sownSaid('Mint', true, 'sprouting in 8 minutes'), sownSaid('Corn', false, 'sprouting in 9 minutes')].join('|'),
    out[1]);
}

/* ---- a glasshouse, through the doors on the island ------------------------------------------------ */

/*
 * Two tiles by two on Dane's settlement, walled in windows, with three of its
 * four roof tiles laid in glass and the fourth planned; a field in the open
 * beside it; and one more building with a flat roof. Everything the island
 * says is kept to be held against the browser's below.
 */
const FOOT: Array<[number, number]> = [[20, 26], [21, 26], [20, 27], [21, 27]];
const LAST: [number, number] = [21, 27];
const OPEN: [number, number] = [23, 26];
const FLAT: [number, number] = [24, 29];
const SIDES: Array<[number, number, Side]> = [
  [20, 26, 'n'], [21, 26, 'n'], [20, 27, 's'], [21, 27, 's'], [20, 26, 'w'], [20, 27, 'w'], [21, 26, 'e'], [21, 27, 'e'],
];
const border = (x: number, y: number, s: Side): [string, number, number] =>
  s === 'n' ? ['h', x, y] : s === 's' ? ['h', x, y + 1] : s === 'w' ? ['v', x, y] : ['v', x + 1, y];
const FARMER = perksOf('farmer');
const perk = (name: string) => {
  const p = FARMER.find((x) => x.name === name);
  if (!p) throw new Error(`the Farmer has no perk called ${name}`);
  return p;
};
const FAST = perk('Fast Growth');
const TEND = perk('Tend a Patch');
const wheatPer = CROPS.wheat.stageSeconds;
/** Seconds into its stage a crop is read at by the ground read: less than a stage, so nothing moves it on first. */
const GROWN = Math.round(wheatPer / 2);
const tileT = (x: number, y: number, extra: Record<string, unknown> = {}): string => q(JSON.stringify({ kind: 'tile', x, y, ...extra }));

const island = psql(`
begin;
create temp table said (k text, v text);
create function pg_temp.hold(w uuid, u uuid, ids text[]) returns jsonb language plpgsql as $f$
begin
  delete from player_node where world_id = w and uid = u;
  insert into player_node (world_id, uid, node) select w, u, x from unnest(ids) x;
  return class_fold(w, u);
end $f$;
create function pg_temp.said(w uuid, u uuid, p text) returns text language sql as $f$
  select e.text from event e where e.world_id = w and e.uid = u and e.text like p order by e.n desc limit 1
$f$;
-- Every skill check passes, and a pair of hands turns out forty: a go must show the rule.
create or replace function skill_check(p_skill double precision, p_difficulty double precision,
   p_tool_ql double precision default 0, p_ease double precision default 0)
   returns boolean language sql as 'select true';
create or replace function product_ql(p_skill double precision, p_tool_ql double precision default 0)
  returns double precision language sql as 'select 40::double precision';
do $$
declare w uuid; u uuid; v_x int; v_y int; v_seed bigint; v_n int; v_g double precision; v_j jsonb; v_per double precision;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  delete from wall where world_id = w;
  delete from floor_tile where world_id = w;
  delete from building_tile where world_id = w;
  delete from building where world_id = w;
  delete from crop where world_id = w;
  delete from crop_last where world_id = w;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  update player set x = 20.5, y = 26.5, level = 0, act = null, act_target = null, act_started = null, act_ends = null,
         act_left = null, act_goes = null, act_queue = '[]', craft_class = 'farmer', class_mul = null, way = null,
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
   where world_id = w and uid = u;
  perform pg_temp.hold(w, u, '{}');
  -- Dane's settlement over the glasshouse and the field beside it, wherever the suite left it: Bounty works on it, and it has its own decay.
  insert into deed (world_id, name, x, y, radius, founded_by) values (w, 'Latecomer', 21, 26, 5, u)
    on conflict (world_id, founded_by) do update set x = 21, y = 26, radius = 5;
  insert into skill (world_id, uid, id, value) values (w, u, 'farming', 50), (w, u, 'carpentry', 50)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  -- Level ground, packed under the glasshouse and the flat-roofed shed, grass in the open.
  for v_x in 18 .. 26 loop for v_y in 24 .. 31 loop
    perform land_set_height(w, v_x, v_y, 40);
    perform land_set_tile(w, v_x, v_y, tile_id('Grass'));
  end loop; end loop;
  ${FOOT.map(([x, y]) => `perform land_set_tile(w, ${x}, ${y}, tile_id('Packed dirt'));`).join('\n  ')}
  perform land_set_tile(w, ${FLAT[0]}, ${FLAT[1]}, tile_id('Packed dirt'));
  insert into building (world_id, id, name, levels, work_level, planned_by, roof) values (w, 1, 'Glasshouse', 1, 0, u, 'hip');
  insert into building_tile (world_id, building, x, y) values ${FOOT.map(([x, y]) => `(w, 1, ${x}, ${y})`).join(', ')};
  insert into wall (world_id, level, dir, x, y, building, type, material, needed, total) values
    ${SIDES.map(([x, y, s]) => { const [d, bx, by] = border(x, y, s); return `(w, 0, '${d}', ${bx}, ${by}, 1, 'window', 'plank', '{"plank":0,"timber":0,"glass":0}', '{"plank":18,"timber":3,"glass":6}')`; }).join(',\n    ')};
  insert into floor_tile (world_id, level, x, y, building, material, kind, needed, total) values
    ${FOOT.map(([x, y]) => `(w, 1, ${x}, ${y}, 1, 'glass', 'roof', ${x === LAST[0] && y === LAST[1] ? `floor_bill('glass', 'roof', 'hip')` : `'{"glass":0,"timber":0}'`}, floor_bill('glass', 'roof', 'hip'))`).join(',\n    ')};
  insert into building (world_id, id, name, levels, work_level, planned_by, roof) values (w, 2, 'Shed', 1, 0, u, 'flat');
  insert into building_tile (world_id, building, x, y) values (w, 2, ${FLAT[0]}, ${FLAT[1]});
  perform give(w, u, 'mallet', 1, 40);
  perform give(w, u, 'rake', 1, 40);

  -- Glass is refused on a wall, a fence, a floor and a flat roof, and the ground until the last pane is in.
  insert into said values ('WALL', coalesce(act_refusal(w, u, 'plan_wall', ${tileT(20, 26, { side: 'n', wallType: 'solid', material: 'glass' })}), 'ALLOWED'));
  update player set x = 24.5, y = 25.5 where world_id = w and uid = u;
  insert into said values ('FENCE', coalesce(act_refusal(w, u, 'plan_fence', ${tileT(24, 25, { side: 'n', wallType: 'fence', material: 'glass' })}), 'ALLOWED'));
  update player set x = ${FLAT[0] + 0.5}, y = ${FLAT[1] + 0.5} where world_id = w and uid = u;
  insert into said values ('FLAT', coalesce(act_refusal(w, u, 'plan_floor', ${tileT(FLAT[0], FLAT[1], { material: 'glass', floorKind: 'roof' })}), 'ALLOWED'));
  update player set x = 20.5, y = 26.5 where world_id = w and uid = u;
  insert into said values ('FLOOR', coalesce(act_refusal(w, u, 'plan_floor', ${tileT(20, 26, { material: 'glass', floorKind: 'floor' })}), 'ALLOWED'));
  insert into said values ('NOTYET', coalesce(act_refusal(w, u, 'till', ${tileT(20, 26)}), 'ALLOWED') || '|' || glasshouse(w, 1));

  -- The last of the glass, through the door, a pane or a timber a go.
  perform give(w, u, 'glass', 12, 40);
  perform give(w, u, 'timber', 4, 40);
  update player set x = ${LAST[0] + 0.5}, y = ${LAST[1] + 0.5} where world_id = w and uid = u;
  insert into said values ('BUILDASK', coalesce(act_refusal(w, u, 'build_floor', ${tileT(LAST[0], LAST[1], { floorKind: 'roof' })}), 'ALLOWED'));
  v_n := 0;
  while not bill_done((select f.needed from floor_tile f where f.world_id = w and f.level = 1 and f.x = ${LAST[0]} and f.y = ${LAST[1]})) and v_n < 40 loop
    perform act_perform(w, u, 'build_floor', ${tileT(LAST[0], LAST[1], { floorKind: 'roof' })});
    v_n := v_n + 1;
  end loop;
  insert into said values ('ROOFED', v_n || '|' || glasshouse(w, 1) || '|' || coalesce(pg_temp.said(w, u, 'You finish%'), 'unsaid'));

  -- Tilled, and not where a floor is planned; and no floor over a field.
  update player set x = 20.5, y = 26.5 where world_id = w and uid = u;
  insert into said values ('TILLASK', coalesce(act_refusal(w, u, 'till', ${tileT(20, 26)}), 'ALLOWED'));
  perform act_perform(w, u, 'till', ${tileT(20, 26)});
  perform act_perform(w, u, 'till', ${tileT(20, 27)});
  insert into said values ('TILLED', (land_tile(w, 20, 26) = tile_id('Field')) || '|' || (land_tile(w, 20, 27) = tile_id('Field')));
  insert into said values ('AGAIN', coalesce(act_refusal(w, u, 'till', ${tileT(20, 26)}), 'ALLOWED'));
  insert into said values ('FIELDFLOOR', coalesce(act_refusal(w, u, 'plan_floor', ${tileT(20, 26, { material: 'plank', floorKind: 'floor' })}), 'ALLOWED'));
  insert into floor_tile (world_id, level, x, y, building, material, kind, needed, total) values (w, 0, 21, 26, 1, 'plank', 'floor', '{"plank":0}', '{"plank":12}');
  update player set x = 21.5, y = 26.5 where world_id = w and uid = u;
  insert into said values ('FLOORED', coalesce(act_refusal(w, u, 'till', ${tileT(21, 26)}), 'ALLOWED'));
  delete from floor_tile where world_id = w and level = 0 and x = 21 and y = 26;
  update player set x = 20.5, y = 26.5 where world_id = w and uid = u;

  -- Sown under glass, and tended.
  perform give(w, u, 'wheat_seed', 5, 50);
  v_seed := (select i.id from item i where i.world_id = w and i.holder_uid = u and i.def = 'wheat_seed' order by i.id desc limit 1);
  insert into said values ('SOWASK', coalesce(act_refusal(w, u, 'plant_seed', ${tileT(20, 26)}::jsonb || jsonb_build_object('itemUid', v_seed)), 'ALLOWED'));
  perform act_perform(w, u, 'plant_seed', ${tileT(20, 26)}::jsonb || jsonb_build_object('itemUid', v_seed));
  insert into said select 'SOWN', c.id || ':' || c.stage || ':' || c.glass || ':' || c.pace from crop c where c.world_id = w and c.x = 20 and c.y = 26;
  insert into said values ('SOWSAID', coalesce(pg_temp.said(w, u, 'You sow %'), 'unsaid'));
  perform act_perform(w, u, 'tend_crop', ${tileT(20, 26)});
  insert into said select 'TENDED', c.tended || ':' || c.tended_now from crop c where c.world_id = w and c.x = 20 and c.y = 26;

  -- A winter held: a stage and a second of the glass clock brings it on, and the field outside stands still.
  v_per := (select stage_seconds from crop_def where id = 'wheat');
  perform land_set_tile(w, ${OPEN[0]}, ${OPEN[1]}, tile_id('Field'));
  insert into crop (world_id, x, y, id, stage, stage_at, ql) values (w, ${OPEN[0]}, ${OPEN[1]}, 'wheat', 0, now() - make_interval(secs => v_per + 1), 40);
  update crop set stage_at = now() - make_interval(secs => v_per / glasshouse_growth() + 1) where world_id = w and x = 20 and y = 26;
  perform set_config('wurm.season', 'winter', true);
  perform crops_settle(w, 21.5, 26.5, 4);
  insert into said values ('WINTER', (select stage || ':' || glass || ':' || tended_now from crop where world_id = w and x = 20 and y = 26)
      || '|' || (select stage || ':' || glass from crop where world_id = w and x = ${OPEN[0]} and y = ${OPEN[1]})
      || '|' || coalesce(act_refusal(w, u, 'tend_crop', ${tileT(20, 26)}), 'ALLOWED'));
  perform set_config('wurm.season', 'spring', true);

  -- A roof tile taken off: onto the field clock, as far into its stage as it had grown; laid again: back.
  update crop set stage_at = now() - interval '100 seconds' where world_id = w and x = 20 and y = 26;
  update player set x = ${LAST[0] + 0.5}, y = ${LAST[1] + 0.5} where world_id = w and uid = u;
  perform act_perform(w, u, 'remove_floor', ${tileT(LAST[0], LAST[1], { floorKind: 'roof' })});
  insert into said select 'OFF', glasshouse(w, 1) || ':' || c.glass || ':' || round((field_clock(now()) - field_clock(c.stage_at))::numeric, 4)
    from crop c where c.world_id = w and c.x = 20 and c.y = 26;
  perform act_perform(w, u, 'plan_floor', ${tileT(LAST[0], LAST[1], { material: 'glass', floorKind: 'roof' })});
  perform give(w, u, 'glass', 12, 40);
  perform give(w, u, 'timber', 4, 40);
  v_n := 0;
  while not bill_done((select f.needed from floor_tile f where f.world_id = w and f.level = 1 and f.x = ${LAST[0]} and f.y = ${LAST[1]})) and v_n < 40 loop
    perform act_perform(w, u, 'build_floor', ${tileT(LAST[0], LAST[1], { floorKind: 'roof' })});
    v_n := v_n + 1;
  end loop;
  insert into said select 'ON', glasshouse(w, 1) || ':' || c.glass || ':' || round((crop_clock_on('glass', now()) - crop_clock_on('glass', c.stage_at))::numeric, 4)
    from crop c where c.world_id = w and c.x = 20 and c.y = 26;

  -- A tile joins the footprint, with no glass over it, and leaves it again.
  perform perform_building(w, u, 'add_to_building', ${tileT(22, 26)});
  insert into said select 'JOINED', glasshouse(w, 1) || ':' || c.glass from crop c where c.world_id = w and c.x = 20 and c.y = 26;
  perform perform_building(w, u, 'remove_from_plan', ${tileT(22, 26)});
  insert into said select 'LEFT', glasshouse(w, 1) || ':' || c.glass || ':' || round((crop_clock_on('glass', now()) - crop_clock_on('glass', c.stage_at))::numeric, 4)
    from crop c where c.world_id = w and c.x = 20 and c.y = 26;

  -- A wall taken down: open to the weather, onto the field clock as far along, and no Till; built back up a unit a go, onto the glass clock again.
  update player set x = 20.5, y = 26.5 where world_id = w and uid = u;
  perform act_perform(w, u, 'remove_wall', ${tileT(20, 26, { side: 'n' })});
  insert into said select 'WALLOFF', glasshouse(w, 1) || ':' || c.glass || ':' || round((field_clock(now()) - field_clock(c.stage_at))::numeric, 4)
    from crop c where c.world_id = w and c.x = 20 and c.y = 26;
  insert into said values ('WALLTILL', coalesce(act_refusal(w, u, 'till', ${tileT(20, 27)}), 'ALLOWED'));
  -- A fence in the gap is too low to close it in: still no glasshouse.
  perform give(w, u, 'plank', 40, 40);
  perform give(w, u, 'timber', 12, 40);
  perform act_perform(w, u, 'plan_wall', ${tileT(20, 26, { side: 'n', wallType: 'fence', material: 'plank' })});
  v_n := 0;
  while not bill_done((select wl.needed from wall wl where wl.world_id = w and wl.level = 0 and wl.dir = 'h' and wl.x = 20 and wl.y = 26)) and v_n < 60 loop
    perform act_perform(w, u, 'build_wall', ${tileT(20, 26, { side: 'n' })});
    v_n := v_n + 1;
  end loop;
  insert into said select 'FENCED', v_n || '|' || glasshouse(w, 1) || ':' || c.glass from crop c where c.world_id = w and c.x = 20 and c.y = 26;
  perform act_perform(w, u, 'remove_wall', ${tileT(20, 26, { side: 'n' })});
  perform act_perform(w, u, 'plan_wall', ${tileT(20, 26, { side: 'n', wallType: 'solid', material: 'plank' })});
  v_n := 0;
  while not bill_done((select wl.needed from wall wl where wl.world_id = w and wl.level = 0 and wl.dir = 'h' and wl.x = 20 and wl.y = 26)) and v_n < 60 loop
    perform act_perform(w, u, 'build_wall', ${tileT(20, 26, { side: 'n' })});
    v_n := v_n + 1;
  end loop;
  insert into said select 'WALLON', v_n || '|' || glasshouse(w, 1) || ':' || c.glass || ':' || round((crop_clock_on('glass', now()) - crop_clock_on('glass', c.stage_at))::numeric, 4)
    from crop c where c.world_id = w and c.x = 20 and c.y = 26;

  -- Sown by something other than a hand -- a worker's sowing is a plain insert -- and it is under glass all the same.
  insert into crop (world_id, x, y, id, stage, stage_at, ql) values (w, 20, 27, 'mint', 0, now(), 30);
  insert into said select 'WORKER', c.glass::text from crop c where c.world_id = w and c.x = 20 and c.y = 27;

  -- The ground read: which clock, and how far along it.
  update crop set stage_at = now() - interval '${GROWN} seconds' where world_id = w and x = 20 and y = 26;
  delete from caller where uid = u;
  v_j := rpc_ground(w, 40, true);
  insert into said select 'GROUND', (r->>'glass') || ':' || round((r->>'grown')::numeric, 3) || ':' || coalesce(r2->>'glass', 'none')
    from jsonb_array_elements(v_j->'crops') r, jsonb_array_elements(v_j->'crops') r2
   where (r->>'x')::int = 20 and (r->>'y')::int = 26 and (r2->>'x')::int = ${OPEN[0]} and (r2->>'y')::int = ${OPEN[1]};

  -- Bounty: a stage on, and the new one begun now.
  update crop set stage = 0, stage_at = now() - interval '50 seconds', tended_now = true where world_id = w and x = 20 and y = 26;
  -- Its own statement, then the reading: a statement does not see what it did itself.
  v_n := hasten_crops(w, u);
  insert into said values ('BOUNTY', v_n || '|' || (select stage || ':' || (stage_at = now()) || ':' || tended_now from crop where world_id = w and x = 20 and y = 26));

  -- A night slept in autumn: the glasshouse the whole of it, the field in the open half of it.
  perform set_config('wurm.season', 'autumn', true);
  update crop set stage = 0, stage_at = now() where world_id = w and x in (20, ${OPEN[0]}) and y = 26;
  perform sleep_forward(w, u, 600);
  insert into said values ('SLEPT', (select round((crop_clock_on('glass', now()) - crop_clock_on('glass', stage_at))::numeric, 3) from crop where world_id = w and x = 20 and y = 26)
      || ':' || (select round((field_clock(now()) - field_clock(stage_at))::numeric, 3) from crop where world_id = w and x = ${OPEN[0]} and y = ${OPEN[1]}));
  perform set_config('wurm.season', '', true);

  -- Ripe by the glass clock alone, and harvested as a field is.
  update crop set stage = 0, tended = 1, tended_now = false, stage_at = now() - make_interval(secs => 3 * v_per / glasshouse_growth() + 1)
   where world_id = w and x = 20 and y = 26;
  insert into said values ('RIPE', coalesce(act_refusal(w, u, 'tend_crop', ${tileT(20, 26)}), 'ALLOWED') || '|' || coalesce(act_refusal(w, u, 'harvest_crop', ${tileT(20, 26)}), 'ALLOWED'));
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def in ('wheat', 'wheat_seed');
  perform act_perform(w, u, 'harvest_crop', ${tileT(20, 26)});
  insert into said values ('HARVEST', (select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder_uid = u and i.def = 'wheat')
      || ':' || (select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder_uid = u and i.def = 'wheat_seed')
      || ':' || (select count(*) from crop c where c.world_id = w and c.x = 20 and c.y = 26) || ':' || (land_tile(w, 20, 26) = tile_id('Field')));
  insert into said values ('HARVESTSAID', coalesce(pg_temp.said(w, u, 'You harvest %'), 'unsaid'));

  -- A Farmer's Fast Growth stamped on a sowing under glass, and Tend a Patch over the glasshouse.
  perform pg_temp.hold(w, u, array[${q(FAST.id)}, ${q(TEND.id)}]);
  perform act_perform(w, u, 'plant_seed', ${tileT(20, 26)}::jsonb || jsonb_build_object('itemUid',
    (select i.id from item i where i.world_id = w and i.holder_uid = u and i.def = 'wheat_seed' order by i.id desc limit 1)));
  insert into said select 'PACE', c.pace || ':' || c.glass from crop c where c.world_id = w and c.x = 20 and c.y = 26;
  -- The mint beside it, which a night brought on to ripe, sown again as it was.
  update crop set stage = 0, stage_at = now(), tended_now = false where world_id = w and x = 20 and y = 27;
  perform act_perform(w, u, 'tend_patch', ${tileT(20, 26)});
  insert into said values ('PATCH', (select count(*) from crop c where c.world_id = w and c.x between 19 and 21 and c.y between 25 and 27 and c.tended_now)
      || '|' || coalesce(pg_temp.said(w, u, 'You weed and water %'), 'unsaid'));
  perform pg_temp.hold(w, u, '{}');

  -- And through the whole door: asked of \`rpc_act\` as a browser asks it, and finished by the clock in \`settle\`.
  update player set x = 21.5, y = 26.5 where world_id = w and uid = u;
  perform act_perform(w, u, 'till', ${tileT(21, 26)});
  perform give(w, u, 'wheat_seed', 1, 50);
  delete from caller where uid = u;
  v_j := rpc_act(w, 'plant_seed', ${tileT(21, 26)}::jsonb || jsonb_build_object('itemUid',
    (select i.id from item i where i.world_id = w and i.holder_uid = u and i.def = 'wheat_seed' order by i.id desc limit 1)), 1);
  update player set act_started = act_started - interval '600 seconds', act_ends = act_ends - interval '600 seconds'
   where world_id = w and uid = u;
  perform settle(w, u);
  insert into said values ('DOOR', coalesce(v_j->>'why', 'taken') || ':'
      || coalesce((select c.id || ':' || c.glass from crop c where c.world_id = w and c.x = 21 and c.y = 26), 'nothing sown'));

  -- What is left lying in it is indoors.
  insert into said values ('DECAY', decay_multiplier(w, 20, 27) || ':' || decay_multiplier(w, ${OPEN[0]}, ${OPEN[1]}));

  -- A poured slab under a tile of it is not earth: Till refused in the browser's words.
  insert into foundation (world_id, id, x, y, top, needed, total)
    values (w, (select coalesce(max(id), 0) + 1 from foundation), ${LAST[0]}, ${LAST[1]}, 40, '{}'::jsonb, '{}'::jsonb);
  update player set x = ${LAST[0] + 0.5}, y = ${LAST[1] + 0.5} where world_id = w and uid = u;
  insert into said values ('SLAB', glasshouse(w, 1) || '|' || coalesce(act_refusal(w, u, 'till', ${tileT(LAST[0], LAST[1])}), 'ALLOWED'));
  delete from foundation where world_id = w and x = ${LAST[0]} and y = ${LAST[1]};
  update player set x = 20.5, y = 26.5 where world_id = w and uid = u;

  -- What Examine says of it, and of the shed beside it.
  insert into said values ('EXAMINE', examine_tile_text(w, 20, 26, u));
  insert into said values ('EXAMINESHED', examine_tile_text(w, ${FLAT[0]}, ${FLAT[1]}, u));

  -- A roof tile off: with fields in it, only glass goes back on, and no storey goes over it.
  update player set x = ${LAST[0] + 0.5}, y = ${LAST[1] + 0.5} where world_id = w and uid = u;
  perform act_perform(w, u, 'remove_floor', ${tileT(LAST[0], LAST[1], { floorKind: 'roof' })});
  insert into said values ('SLATE', coalesce(act_refusal(w, u, 'plan_floor', ${tileT(LAST[0], LAST[1], { material: 'slate', floorKind: 'roof' })}), 'ALLOWED'));
  insert into said values ('GLASSAGAIN', coalesce(act_refusal(w, u, 'plan_floor', ${tileT(LAST[0], LAST[1], { material: 'glass', floorKind: 'roof' })}), 'ALLOWED'));
  insert into said values ('STOREY', coalesce(act_refusal(w, u, 'add_floor', ${tileT(LAST[0], LAST[1])}), 'ALLOWED'));
  -- The fields cleared, as the refusals say, and then the roof is anybody's to choose.
  update player set x = 20.5, y = 26.5 where world_id = w and uid = u;
  insert into said values ('CLEARASK', coalesce(act_refusal(w, u, 'clear_field', ${tileT(20, 26)}), 'ALLOWED'));
  perform act_perform(w, u, 'clear_field', ${tileT(20, 26)});
  insert into said values ('CLEARSAID', coalesce(pg_temp.said(w, u, 'You %'), 'unsaid'));
  perform act_perform(w, u, 'clear_field', ${tileT(20, 27)});
  perform act_perform(w, u, 'clear_field', ${tileT(21, 26)});
  insert into said values ('CLEARED', (select count(*) from building_tile bt where bt.world_id = w and bt.building = 1 and land_tile(w, bt.x, bt.y) = tile_id('Field'))
      || ':' || (select count(*) from crop c where c.world_id = w and c.x between 20 and 21 and c.y between 26 and 27)
      || ':' || (land_tile(w, 20, 26) = tile_id('Packed dirt')));
  update player set x = ${LAST[0] + 0.5}, y = ${LAST[1] + 0.5} where world_id = w and uid = u;
  insert into said values ('SLATECLEAR', coalesce(act_refusal(w, u, 'plan_floor', ${tileT(LAST[0], LAST[1], { material: 'slate', floorKind: 'roof' })}), 'ALLOWED'));
  insert into said values ('STOREYCLEAR', coalesce(act_refusal(w, u, 'add_floor', ${tileT(LAST[0], LAST[1])}), 'ALLOWED'));
end $$;
select k || E'\\t' || coalesce(v, '') from said;
rollback;
`);
const isaid = new Map(island.split('\n').filter(Boolean).map((l) => {
  const [k, ...v] = l.split('\t');
  return [k, v.join('\t')];
}));
const say = (k: string): string => isaid.get(k) ?? 'unsaid';

check('the island refuses glass on a wall, a fence and a floor, in so many words',
  say('WALL') === GLASS_ROOF_ONLY && say('FENCE') === GLASS_ROOF_ONLY && say('FLOOR') === GLASS_ROOF_ONLY, `${say('WALL')} / ${say('FENCE')} / ${say('FLOOR')}`);
check('and on a flat roof', say('FLAT') === GLASS_PITCHED, say('FLAT'));
check('and a till in a building roofed in glass until the last of it is in', say('NOTYET') === `${NOT_A_GLASSHOUSE}|false`, say('NOTYET'));
{
  const [goes, roofed, line] = say('ROOFED').split('|');
  const bill = floorBill(GLASS, 'roof', 'hip').total;
  check(`the last tile of glass goes in through the door a unit a go, ${bill.glass + bill.timber} of them, and makes a glasshouse`,
    say('BUILDASK') === 'ALLOWED' && Number(goes) === bill.glass + bill.timber && roofed === 'true' && line === 'You finish the glass roof.', say('ROOFED'));
}
check('then its ground tills into fields, and not under a floor, and no floor goes over a field',
  say('TILLASK') === 'ALLOWED' && say('TILLED') === 'true|true' && say('FLOORED') === GLASS_FLOORED && say('FIELDFLOOR') === FIELD_UNFLOORED,
  `${say('TILLASK')} / ${say('TILLED')} / ${say('FLOORED')} / ${say('FIELDFLOOR')}`);
check('and ground that is a field already is not tilled again', say('AGAIN') === 'That ground will not rake into a field.', say('AGAIN'));
check('and asked through the door a browser uses, the clock finishing the go, it is sown under glass just the same', say('DOOR') === 'taken:wheat:true', say('DOOR'));
check('and it is sown under glass through the doors, and tended', say('SOWASK') === 'ALLOWED' && say('SOWN') === 'wheat:0:true:1' && say('TENDED') === '1:true',
  `${say('SOWN')} / ${say('TENDED')}`);
const sowLine = sownSaid('Wheat', 'glass', cropWhen(STAGE_NAMES[1], wheatPer, 'glass', YEAR_FROM));
check(`and says when it will sprout at the glasshouse's ${GLASSHOUSE_GROWTH} of the crop's pace, in any season: "${sowLine}"`, say('SOWSAID') === sowLine, say('SOWSAID'));
check('held in winter, a stage of the glass clock brings it on, untended, while the field in the open waits',
  say('WINTER') === '1:true:false|0:false|ALLOWED', say('WINTER'));
check('a roof tile taken off puts it on the field clock exactly as far into its stage as it had grown, and laying it again puts it back',
  say('OFF') === `false:false:${(100 * GLASSHOUSE_GROWTH).toFixed(4)}` && say('ON') === `true:true:${(100 * GLASSHOUSE_GROWTH).toFixed(4)}`,
  `${say('OFF')} / ${say('ON')}`);
check('a tile joining the footprint takes it off the glass clock, and leaving it puts it back as far along',
  say('JOINED') === 'false:false' && say('LEFT') === `true:true:${(100 * GLASSHOUSE_GROWTH).toFixed(4)}`, `${say('JOINED')} / ${say('LEFT')}`);
check('whatever sows it, it is sown under glass', say('WORKER') === 'true', say('WORKER'));
check('the ground read says which crops are under glass and how far each has grown on its own clock',
  say('GROUND') === `true:${(GROWN * GLASSHOUSE_GROWTH).toFixed(3)}:none`, say('GROUND'));
check('Bounty brings it on a stage, the new one begun now and untended', say('BOUNTY').endsWith('|1:true:false'), say('BOUNTY'));
check(`a night slept in autumn moves it the whole night, ${600 * GLASSHOUSE_GROWTH} growing seconds, and the field outside ${600 * SEASON_GROWTH.autumn}`,
  say('SLEPT') === `${(600 * GLASSHOUSE_GROWTH).toFixed(3)}:${(600 * SEASON_GROWTH.autumn).toFixed(3)}`, say('SLEPT'));
check(`ripe by the glass clock alone, it harvests as a field does: ${cropYield(1).produce} wheat and ${cropYield(1).seeds} seed for one tending, and the field ready to sow again`,
  say('RIPE') === 'It is ripe. Harvest it.|ALLOWED' && say('HARVEST') === `${cropYield(1).produce}:${cropYield(1).seeds}:0:true`
    && say('HARVESTSAID').includes('The field is ready to sow again.'), `${say('RIPE')} / ${say('HARVEST')} / ${say('HARVESTSAID')}`);
check(`a Farmer's Fast Growth goes into a sowing under glass, ${FAST.fx['grow:plant_seed']}, and Tend a Patch tends the glasshouse`,
  Math.abs(Number(say('PACE').split(':')[0]) - (FAST.fx['grow:plant_seed'] ?? 0)) < 1e-9 && say('PACE').endsWith(':true') && say('PATCH').startsWith('2|'),
  `${say('PACE')} / ${say('PATCH')}`);
{
  const [inside, outside] = say('DECAY').split(':').map(Number);
  check(`what is left in it rots at ${INDOORS_DECAY} of what it would in the open`, Math.abs(inside / outside - INDOORS_DECAY) < 1e-9, say('DECAY'));
}
check(`Examine says what it is and does: "${glassExamine().trim()}", and of the shed nothing of the kind`,
  say('EXAMINE').includes(`It belongs to Glasshouse, a single-storey building.${glassExamine()}`)
    && say('EXAMINESHED').includes('It belongs to Shed, a single-storey building.') && !say('EXAMINESHED').includes(glassExamine()),
  `${say('EXAMINE')} / ${say('EXAMINESHED')}`);
check('with fields in it, a roof tile taken off goes back on in glass and in nothing else, and no storey goes over it',
  say('SLATE') === FIELD_GLASS_ONLY && say('GLASSAGAIN') === 'ALLOWED' && say('STOREY') === FIELD_NO_STOREY,
  `${say('SLATE')} / ${say('GLASSAGAIN')} / ${say('STOREY')}`);
check('and its fields clear back to packed earth, crops and all, as those refusals say to, and then any roof goes on',
  say('CLEARASK') === 'ALLOWED' && say('CLEARED') === '0:0:true' && say('SLATECLEAR') === 'ALLOWED' && say('STOREYCLEAR') === 'Take the roof off first.'
    && say('CLEARSAID') === clearedSaid('wheat', true),
  `${say('CLEARASK')} / ${say('CLEARED')} / ${say('SLATECLEAR')} / ${say('STOREYCLEAR')} / ${say('CLEARSAID')}`);
check('a wall taken down takes it off the glass clock as far along and refuses Till in the island\'s words; a fence in the gap is too low to make it a glasshouse; and a full wall built back up a unit a go puts it back',
  say('WALLOFF') === 'false:false:100.0000' && say('WALLTILL') === NOT_A_GLASSHOUSE
    && say('FENCED') === `${wallBill('plank', 'fence').total.plank + wallBill('plank', 'fence').total.timber}|false:false`
    && say('WALLON') === `${wallBill('plank', 'solid').total.plank + wallBill('plank', 'solid').total.timber}|true:true:100.0000`,
  `${say('WALLOFF')} / ${say('WALLTILL')} / ${say('FENCED')} / ${say('WALLON')}`);
check('a poured slab under a tile of a glasshouse is refused a Till, in so many words', say('SLAB') === `true|${GLASS_SLAB}`, say('SLAB'));

/* ---- and the same glasshouse in the browser -------------------------------------------------------- */

const game = Game.create(4242);
/*
 * No wildlife, and none coming: this game is run on in steps of minutes at a
 * time, and a beast walking that far in one step asks the walls about a stride
 * of several tiles, which the wall check was never made for -- in play a frame
 * is a tenth of a second at most (`engine/loop.ts`). What grows here does not
 * need anything to walk about, so the creatures are taken away and left to an
 * island's keeping, which here is nobody's: none is banked, streamed in or
 * moved on.
 */
for (const c of [...game.creatures.list.values()]) game.creatures.remove(c.id);
game.creatures.fromIsland = true;
const heard = (prefix: string): string => [...game.log].reverse().find((l) => l.text.startsWith(prefix))?.text ?? 'unsaid';
const bld = game.buildings;
for (let x = 18; x <= 27; x++) for (let y = 24; y <= 32; y++) game.world.setHeight(x, y, 40);
for (let x = 18; x <= 26; x++) for (let y = 24; y <= 31; y++) game.world.setTile(x, y, TileType.Grass);
for (const [x, y] of [...FOOT, FLAT]) game.world.setTile(x, y, TileType.PackedDirt);
const gh = bld.create('Glasshouse', 20, 26);
for (const [x, y] of FOOT.slice(1)) bld.addTile(gh, x, y);
for (const [x, y, s] of SIDES) {
  const wl = bld.setWall(gh, 0, x, y, s, 'window', 'plank');
  for (const k of Object.keys(wl.needed)) wl.needed[k] = 0;
}
gh.roof = 'hip';
for (const [x, y] of FOOT) {
  const f = bld.setFloor(gh, 1, x, y, GLASS, 'roof');
  if (x !== LAST[0] || y !== LAST[1]) for (const k of Object.keys(f.needed)) f.needed[k] = 0;
}
const shed = bld.create('Shed', FLAT[0], FLAT[1]);
shed.roof = 'flat';
// The same settlement over it as on the island.
game.deed = { name: 'Latecomer', x: 21, y: 26, radius: 5, level: 1, mine: true } as typeof game.deed;
game.inventory.add('mallet', { ql: 40 });
game.inventory.add('rake', { ql: 40 });
game.setPerks({});
game.productQl = () => 40;
const at = (x: number, y: number, extra: Record<string, unknown> = {}): Target => ({ kind: 'tile', x, y, cx: x, cy: y, ...extra } as Target);
const ask = (id: string, t: Target): string => ACTION_BY_ID.get(id)!.check?.(t, game) ?? 'ALLOWED';
const run = (id: string, t: Target): unknown => ACTION_BY_ID.get(id)!.perform(t, game);
const stand = (x: number, y: number): void => { game.player.x = x + 0.5; game.player.y = y + 0.5; };

stand(20, 26);
const wallSaid = ask('plan_wall', at(20, 26, { side: 'n', wallType: 'solid', material: GLASS }));
stand(24, 25);
const fenceSaid = ask('plan_fence', at(24, 25, { side: 'n', wallType: 'fence', material: GLASS }));
stand(FLAT[0], FLAT[1]);
const flatSaid = ask('plan_floor', at(FLAT[0], FLAT[1], { material: GLASS, floorKind: 'roof' }));
stand(20, 26);
const floorSaid = ask('plan_floor', at(20, 26, { material: GLASS, floorKind: 'floor' }));
check('the browser refuses glass on a wall, a fence, a floor and a flat roof in the island\'s words',
  wallSaid === say('WALL') && fenceSaid === say('FENCE') && floorSaid === say('FLOOR') && flatSaid === say('FLAT'),
  `${wallSaid} / ${fenceSaid} / ${floorSaid} / ${flatSaid}`);
check('and Till is offered in a building being roofed in glass, and refused until it is a glasshouse, as the island refuses it',
  ACTION_BY_ID.get('till')!.applies(at(20, 26), game) && `${ask('till', at(20, 26))}|${isGlasshouse(bld, gh)}` === say('NOTYET'),
  `${ask('till', at(20, 26))}|${isGlasshouse(bld, gh)}`);
game.inventory.add('glass', { count: 12, ql: 40 });
game.inventory.add('timber', { count: 4, ql: 40 });
stand(LAST[0], LAST[1]);
const buildAsk = ask('build_floor', at(LAST[0], LAST[1], { floorKind: 'roof' }));
let goes = 0;
while (goes < 40 && run('build_floor', at(LAST[0], LAST[1], { floorKind: 'roof' })) !== false) goes++;
goes++;
check('and the last tile goes in a unit a go, as many as on the island, and the browser calls it a glasshouse too',
  buildAsk === say('BUILDASK') && `${goes}|${isGlasshouse(bld, gh)}|${heard('You finish')}` === say('ROOFED'),
  `${goes}|${isGlasshouse(bld, gh)}|${heard('You finish')}`);
stand(20, 26);
const tillAsk = ask('till', at(20, 26));
run('till', at(20, 26));
run('till', at(20, 27));
const fieldFloor = ask('plan_floor', at(20, 26, { material: 'plank', floorKind: 'floor' }));
const boards = bld.setFloor(gh, 0, 21, 26, 'plank', 'floor');
for (const k of Object.keys(boards.needed)) boards.needed[k] = 0;
stand(21, 26);
const floored = ask('till', at(21, 26));
bld.removeFloor(0, 21, 26);
stand(20, 26);
check('then it tills, and refuses the same floor and field as the island',
  tillAsk === say('TILLASK') && ask('till', at(20, 26)) === say('AGAIN') && `${game.world.getTile(20, 26) === TileType.Field}|${game.world.getTile(20, 27) === TileType.Field}` === say('TILLED')
    && floored === say('FLOORED') && fieldFloor === say('FIELDFLOOR'), `${tillAsk} / ${floored} / ${fieldFloor}`);
const seeds = game.inventory.add('wheat_seed', { count: 5, ql: 50 });
const sowAsk = ask('plant_seed', at(20, 26, { itemUid: seeds.uid }));
run('plant_seed', at(20, 26, { itemUid: seeds.uid }));
const crop = game.cropAt(20, 26);
run('tend_crop', at(20, 26));
check('and sows it under glass, tends it, and says the island\'s line',
  sowAsk === say('SOWASK') && `${crop?.id}:${crop?.stage}:${!!crop?.glass}:${crop?.pace ?? 1}` === say('SOWN') && heard('You sow ') === say('SOWSAID')
    && `${crop?.tended}:${crop?.tendedNow}` === say('TENDED'), `${crop?.id}:${crop?.stage}:${!!crop?.glass} / ${heard('You sow ')}`);

// A winter: the glass crop comes on a stage; a field in the open stands still.
game.world.setTile(OPEN[0], OPEN[1], TileType.Field);
const outside = game.plantCrop(OPEN[0], OPEN[1], 'wheat', 40);
const winterAt = YEAR_FROM + YEAR_SECONDS + 3.5 * SEASON_SECONDS;
game.wallClock = () => winterAt;
// A stage and a second of a winter's day go by.
const fieldBefore = game.fieldTime;
game.update(wheatPer + 1);
check('held in winter in the browser, the same: the glass crop on a stage and untended, the field outside waiting',
  `${crop?.stage}:${!!crop?.glass}:${crop?.tendedNow}|${outside.stage}:${!!outside.glass}|${ask('tend_crop', at(20, 26))}` === say('WINTER')
    && game.fieldTime === fieldBefore, `${crop?.stage}:${crop?.tendedNow}|${outside.stage}`);
game.wallClock = () => YEAR_FROM + YEAR_SECONDS + 0.5 * SEASON_SECONDS;

// A roof tile off and on again, and a tile in and out of the footprint: the same clocks, as far along.
if (crop) crop.stageAt = game.glassNow() - 100 * GLASSHOUSE_GROWTH;
stand(LAST[0], LAST[1]);
run('remove_floor', at(LAST[0], LAST[1], { floorKind: 'roof' }));
const offSaid = `${isGlasshouse(bld, gh)}:${!!crop?.glass}:${crop ? (game.fieldNow() - crop.stageAt).toFixed(4) : 'none'}`;
run('plan_floor', at(LAST[0], LAST[1], { material: GLASS, floorKind: 'roof' }));
game.inventory.add('glass', { count: 12, ql: 40 });
game.inventory.add('timber', { count: 4, ql: 40 });
for (let i = 0; i < 40 && run('build_floor', at(LAST[0], LAST[1], { floorKind: 'roof' })) !== false; i++);
const onSaid = `${isGlasshouse(bld, gh)}:${!!crop?.glass}:${crop ? (game.glassNow() - crop.stageAt).toFixed(4) : 'none'}`;
check('a roof tile taken off and laid again carries it off the glass clock and back just as the island does',
  offSaid === say('OFF') && onSaid === say('ON'), `${offSaid} / ${onSaid}`);
game.world.setTile(22, 26, TileType.PackedDirt);
stand(22, 26);
run('add_to_building', at(22, 26));
const joined = `${isGlasshouse(bld, gh)}:${!!crop?.glass}`;
run('remove_from_plan', at(22, 26));
const left = `${isGlasshouse(bld, gh)}:${!!crop?.glass}:${crop ? (game.glassNow() - crop.stageAt).toFixed(4) : 'none'}`;
check('and a tile joining the footprint and leaving it, the same', joined === say('JOINED') && left === say('LEFT'), `${joined} / ${left}`);
// A wall down and back up.
stand(20, 26);
run('remove_wall', at(20, 26, { side: 'n' }));
const wallOff = `${isGlasshouse(bld, gh)}:${!!crop?.glass}:${crop ? (game.fieldNow() - crop.stageAt).toFixed(4) : 'none'}`;
const wallTill = ask('till', at(20, 27));
game.inventory.add('plank', { count: 40, ql: 40 });
game.inventory.add('timber', { count: 12, ql: 40 });
run('plan_wall', at(20, 26, { side: 'n', wallType: 'fence', material: 'plank' }));
let fenceGoes = 0;
while (fenceGoes < 60 && !isDone(bld.wall(0, 20, 26, 'n')!)) {
  run('build_wall', at(20, 26, { side: 'n' }));
  fenceGoes++;
}
const fenced = `${fenceGoes}|${isGlasshouse(bld, gh)}:${!!crop?.glass}`;
run('remove_wall', at(20, 26, { side: 'n' }));
run('plan_wall', at(20, 26, { side: 'n', wallType: 'solid', material: 'plank' }));
let wallGoes = 0;
while (wallGoes < 60 && !isDone(bld.wall(0, 20, 26, 'n')!)) {
  run('build_wall', at(20, 26, { side: 'n' }));
  wallGoes++;
}
const wallOn = `${wallGoes}|${isGlasshouse(bld, gh)}:${!!crop?.glass}:${crop ? (game.glassNow() - crop.stageAt).toFixed(4) : 'none'}`;
check('and a wall down, a fence in its place and a wall back up, the same, in the same words',
  wallOff === say('WALLOFF') && wallTill === say('WALLTILL') && fenced === say('FENCED') && wallOn === say('WALLON'), `${wallOff} / ${wallTill} / ${fenced} / ${wallOn}`);
const worker = game.plantCrop(20, 27, 'mint', 30);
check('and anything that sows there sows under glass', `${!!worker.glass}` === say('WORKER') && underGlass(bld, 20, 27));

// Bounty and a night's sleep.
if (crop) {
  crop.stage = 0;
  crop.stageAt = game.glassNow() - 50;
  crop.tendedNow = true;
}
game.hastenCrops();
check('Bounty brings it on the same, the new stage begun now on the glass clock',
  `${crop?.stage}:${crop?.stageAt === game.glassNow()}:${crop?.tendedNow}` === say('BOUNTY').split('|')[1], `${crop?.stage}:${crop?.tendedNow}`);
const autumnAt = YEAR_FROM + YEAR_SECONDS + 2.5 * SEASON_SECONDS;
game.wallClock = () => autumnAt;
// Stages far longer than a night, so a night's growing is all there is to read.
if (crop) { crop.stage = 0; crop.pace = 100; crop.stageAt = game.glassNow(); }
outside.stage = 0;
outside.pace = 100;
outside.stageAt = game.fieldNow();
game.player.x = 20.5;
game.player.y = 26.5;
const sleptFrom = game.time;
game.sleepUntilMorning(1, 'bed');
const night = game.time - sleptFrom;
check(`a night slept in autumn moves it by the whole night on the glass clock, and the field outside by ${SEASON_GROWTH.autumn} of it, as on the island`,
  !!crop && Math.abs(game.glassNow() - crop.stageAt - night * GLASSHOUSE_GROWTH) < 1e-6
    && Math.abs(game.fieldNow() - outside.stageAt - night * SEASON_GROWTH.autumn) < 1e-6,
  `${crop ? (game.glassNow() - crop.stageAt).toFixed(1) : 'none'} and ${(game.fieldNow() - outside.stageAt).toFixed(1)} for a night of ${night.toFixed(1)}`);
game.wallClock = () => YEAR_FROM + YEAR_SECONDS + 0.5 * SEASON_SECONDS;

// Ripe, harvested, and a Farmer at work.
if (crop) { crop.stage = 0; crop.tended = 1; crop.tendedNow = false; delete crop.pace; crop.stageAt = game.glassNow() - 3 * wheatPer - 1; }
game.update(0.01);
const ripe = `${ask('tend_crop', at(20, 26))}|${ask('harvest_crop', at(20, 26))}`;
for (const id of ['wheat', 'wheat_seed']) for (const it of game.inventory.items.filter((i) => i.id === id)) game.inventory.remove(it.uid, it.count);
run('harvest_crop', at(20, 26));
check('ripe by the glass clock, it harvests to the same yield and the same line',
  ripe === say('RIPE') && `${game.inventory.count('wheat')}:${game.inventory.count('wheat_seed')}:${game.cropAt(20, 26) ? 1 : 0}:${game.world.getTile(20, 26) === TileType.Field}` === say('HARVEST')
    && heard('You harvest ') === say('HARVESTSAID'), `${ripe} / ${game.inventory.count('wheat')}:${game.inventory.count('wheat_seed')} / ${heard('You harvest ')}`);
game.setPerks({ ...FAST.fx, ...TEND.fx });
run('plant_seed', at(20, 26, { itemUid: game.inventory.find('wheat_seed')!.uid }));
const paced = game.cropAt(20, 26);
worker.stage = 0;
worker.stageAt = game.glassNow();
worker.tendedNow = false;
run('tend_patch', at(20, 26));
const tended = [game.cropAt(20, 26), game.cropAt(20, 27)].filter((c) => c?.tendedNow).length;
check('and a Farmer\'s Fast Growth and Tend a Patch work there as on the island',
  `${paced?.pace}:${!!paced?.glass}` === say('PACE') && `${tended}|${heard('You weed and water ')}` === say('PATCH'),
  `${paced?.pace}:${!!paced?.glass} / ${tended}|${heard('You weed and water ')}`);
game.setPerks({});
{
  // A poured slab under a tile of it: Till not offered there, and refused as the island refuses it.
  const slab = game.addFoundation(LAST[0], LAST[1], 40, 0);
  stand(LAST[0], LAST[1]);
  const slabSaid = `${isGlasshouse(bld, gh)}|${ask('till', at(LAST[0], LAST[1]))}`;
  const slabOffered = ACTION_BY_ID.get('till')!.applies(at(LAST[0], LAST[1]), game);
  game.removeFoundation(slab.id);
  const earthOffered = ACTION_BY_ID.get('till')!.applies(at(LAST[0], LAST[1]), game);
  stand(20, 26);
  check('and the browser does not offer Till on the slab, and refuses it in the island\'s words, where it offers it on the earth beside',
    slabSaid === say('SLAB') && !slabOffered && earthOffered, `${slabSaid} / offered on the slab ${slabOffered}, on earth ${earthOffered}`);
}
{
  const inside = game.decayMultiplier(20, 27);
  const open = game.decayMultiplier(OPEN[0], OPEN[1]);
  const [theirIn, theirOut] = say('DECAY').split(':').map(Number);
  check(`and what is left in it rots at ${INDOORS_DECAY} of the rate outside, as on the island`,
    Math.abs(inside / open - INDOORS_DECAY) < 1e-9 && Math.abs(inside - theirIn) < 1e-12 && Math.abs(open - theirOut) < 1e-12, `${inside}:${open} against ${say('DECAY')}`);
}
/* ---- in every season, by yourself ------------------------------------------------------------------- */

{
  const g = Game.create(2718);
  // No wildlife, as above: this one is run on a tenth of a stage at a time.
  for (const c of [...g.creatures.list.values()]) g.creatures.remove(c.id);
  g.creatures.fromIsland = true;
  const house = g.buildings.create('Frame', 5, 5);
  g.buildings.addTile(house, 6, 5);
  // Walled all round, and roofed in glass.
  for (const [x, y, side] of [[5, 5, 'n'], [6, 5, 'n'], [5, 5, 's'], [6, 5, 's'], [5, 5, 'w'], [6, 5, 'e']] as Array<[number, number, Side]>) {
    const wl = g.buildings.setWall(house, 0, x, y, side, 'window', 'plank');
    for (const k of Object.keys(wl.needed)) wl.needed[k] = 0;
  }
  for (const [x, y] of [[5, 5], [6, 5]] as Array<[number, number]>) {
    const f = g.buildings.setFloor(house, 1, x, y, GLASS, 'roof');
    for (const k of Object.keys(f.needed)) f.needed[k] = 0;
    g.world.setTile(x, y, TileType.Field);
  }
  const moment = (s: Season): number => YEAR_FROM + YEAR_SECONDS + (SEASONS.indexOf(s) + 0.5) * SEASON_SECONDS;
  const per = CROPS.mint.stageSeconds;
  const came = SEASONS.map((s) => {
    g.wallClock = () => moment(s);
    g.crops.clear();
    const under = g.plantCrop(5, 5, 'mint', 40);
    g.world.setTile(9, 9, TileType.Field);
    const open = g.plantCrop(9, 9, 'mint', 40);
    for (let i = 0; i < 21; i++) g.update(per / 10);
    return `${under.stage}/${open.stage}`;
  });
  check(`a stage and a stage of mint under glass come on in spring, summer, autumn and winter alike: ${came.join(', ')} under glass/in the open`,
    came.every((c) => c.startsWith(`${Math.min(RIPE, Math.floor((2 * per * GLASSHOUSE_GROWTH) / per))}/`)) && came[3].endsWith('/0'), came.join(' '));
}

/* ---- the ground read, and a save ---------------------------------------------------------------------- */

{
  const g = Game.create(1618);
  g.islandClock = () => 0;
  const islandNow = YEAR_FROM + 3 * SEASON_SECONDS + 2 * DAY_SECONDS + 0.25;
  g.sawGround({
    placed: [], crates: [], now: islandNow,
    crops: [
      { x: 5, y: 5, id: 'wheat', stage: 1, grown: 30, ago: 99999, tended: 1, tendedNow: false, ql: 40, glass: true },
      { x: 6, y: 5, id: 'wheat', stage: 1, grown: 30, ago: 99999, tended: 1, tendedNow: false, ql: 40 },
    ],
  });
  const under = g.cropAt(5, 5);
  const open = g.cropAt(6, 5);
  check('a crop the island says is under glass goes onto the glass clock as far along as it has grown, and one in the open onto the field\'s',
    !!under?.glass && Math.abs(g.glassNow() - under.stageAt - 30) < 0.05 && !open?.glass && !!open && Math.abs(g.fieldNow() - open.stageAt - 30) < 1e-6,
    `${under ? (g.glassNow() - under.stageAt).toFixed(3) : 'none'} / ${open ? (g.fieldNow() - open.stageAt).toFixed(3) : 'none'}`);
}
{
  const land = await packLand(game);
  const back = await unpack(land, JSON.parse(JSON.stringify(packWorld(game))));
  const was = game.cropAt(20, 26);
  const now = back?.cropAt(20, 26);
  check('and a crop under glass comes back from a save under glass, where it was on its clock',
    !!was?.glass && !!now?.glass && now.stageAt === was.stageAt && !!back && isGlasshouse(back.buildings, back.buildings.buildingAt(20, 26)));
}

/* ---- what Examine says, and a field cleared, in the browser --------------------------------------- */

{
  // What Examine says, in the island's words.
  run('examine', at(20, 26));
  const seen = heard('You see ');
  run('examine', at(FLAT[0], FLAT[1]));
  const shedSeen = heard('You see ');
  check('Examine says the same of the glasshouse and of the shed in the browser',
    seen.includes(`It belongs to Glasshouse, a single-storey building.${glassExamine()}`)
      && shedSeen.includes('It belongs to Shed, a single-storey building.') && !shedSeen.includes(glassExamine()),
    `${seen} / ${shedSeen}`);
  // A roof tile off, with fields in it; then the fields cleared.
  stand(LAST[0], LAST[1]);
  run('remove_floor', at(LAST[0], LAST[1], { floorKind: 'roof' }));
  const slate = ask('plan_floor', at(LAST[0], LAST[1], { material: 'slate', floorKind: 'roof' }));
  const glassAgain = ask('plan_floor', at(LAST[0], LAST[1], { material: GLASS, floorKind: 'roof' }));
  const storey = ask('add_floor', at(LAST[0], LAST[1]));
  check('and refuses a roof but glass and a storey over its fields, as the island does',
    slate === say('SLATE') && glassAgain === say('GLASSAGAIN') && storey === say('STOREY'), `${slate} / ${glassAgain} / ${storey}`);
  stand(20, 26);
  const clearAsk = ask('clear_field', at(20, 26));
  run('clear_field', at(20, 26));
  const clearSaid = heard('You ');
  for (const [x, y] of [[20, 27], [21, 26]]) if (game.world.getTile(x, y) === TileType.Field) run('clear_field', at(x, y));
  const cleared = `${gh.tiles.filter((k) => { const [x, y] = k.split(',').map(Number); return game.world.getTile(x, y) === TileType.Field; }).length}`
    + `:${[[20, 26], [20, 27], [21, 26], [21, 27]].filter(([x, y]) => game.cropAt(x, y)).length}:${game.world.getTile(20, 26) === TileType.PackedDirt}`;
  stand(LAST[0], LAST[1]);
  const slateClear = ask('plan_floor', at(LAST[0], LAST[1], { material: 'slate', floorKind: 'roof' }));
  const storeyClear = ask('add_floor', at(LAST[0], LAST[1]));
  check('and its fields clear back to packed earth, and then any roof goes on, as on the island, in the same words',
    clearAsk === say('CLEARASK') && cleared === say('CLEARED') && slateClear === say('SLATECLEAR') && storeyClear === say('STOREYCLEAR') && clearSaid === say('CLEARSAID'),
    `${clearAsk} / ${cleared} / ${slateClear} / ${storeyClear} / ${clearSaid}`);
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not the same on both sides`);
  process.exit(1);
}
console.log(`glasshouses — ${ok.length} of ${ok.length}`);
