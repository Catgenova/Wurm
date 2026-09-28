/**
 * Crops through the year, the same on both sides.
 *
 * Asked for: "Implement outdoor seasonal growths for crops, with planters that
 * can be grown indoors regardless of season at a much slower rate." A field
 * grows at its season's share of a crop's pace and not at all in winter; a
 * planter at one share in every season. Growth is counted on a field clock
 * (`fieldClock`, the island's `field_clock`), the integral of that rate over
 * the wall clock, and a crop is settled on it lazily, when it is read or
 * worked. The browser and the island each work all of it out for themselves,
 * so this puts them to the same questions and holds them to each other:
 *
 *   * the field clock and its inverse at thousands of moments -- every two
 *     hours from before the first spring to three years on, a second and a
 *     microsecond either side of every season's turn, deep in winters, and
 *     two thousand moments at random -- to the last bit;
 *   * crops whose stages straddle the turns and whole winters, settled to the
 *     same stage and the same stage start to the microsecond, in a field and
 *     in a planter;
 *   * the words a wait is said in, which the sowing line carries on both;
 *   * a season held still for a test (`wurm.season`);
 *   * a planter sown, tended, harvested and pulled up through the doors on
 *     both sides, refused in the same words, with the Farmer's pace and Crop
 *     Rotation keyed to it, Bounty bringing it on and a night's sleep moving
 *     it; and a planter's pace the same in every season;
 *   * the browser's own field clock, which runs at the season's share of
 *     every game second and is kept in the save, and the ground read that
 *     lays the island's crops on it.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID } from '../../src/game/actions';
import type { Target } from '../../src/game/actions';
import { CROPS, cropSteps, cropWhen, cropYield, RIPE, settleCrop, sownSaid, STAGE_NAMES, type Crop } from '../../src/game/farming';
import { fieldClock, fieldMoment, fieldRate, PLANTER_GROWTH, SEASON_GROWTH, SEASON_SECONDS, YEAR_SECONDS, YEARLESS_GROWTH } from '../../src/game/growth';
import { PLANTER_GROWING } from '../../src/game/furniture';
import { perksOf } from '../../src/game/perks';
import { packLand, packWorld, unpack } from '../../src/game/save';
import { SEASONS, YEAR_FROM, seasonAt, type Season } from '../../src/world/calendar';
import { DAY_SECONDS } from '../../src/game/pace';

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
/** A day of the island's year: a day and night of its clock, thirty to a season. */
const YEAR_DAY = DAY_SECONDS;
const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
/** Rolls that are the same rolls every run. */
let state = 0x5eed1e5;
const rnd = (): number => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/*
 * Moments cross the wire as whole microseconds, which is all a timestamp on
 * the island holds: the browser reads one as `us / 1e6` and the island as
 * `'epoch' + us microseconds`, and both come to the same double.
 */
const usOf = (t: number): number => Math.round(t * 1e6);
/** A double the island printed. */
const num = (s: string): number => (s === 'Infinity' ? Infinity : s === '-Infinity' ? -Infinity : Number(s));
/**
 * The microsecond the island stores a moment in epoch seconds at, as its
 * `to_timestamp` rounds it: the seconds taken off its own epoch, times a
 * million, and to the nearest whole, the even one on a tie.
 */
const PG_EPOCH = 946684800;
const rint = (x: number): number => {
  const f = Math.floor(x);
  const d = x - f;
  return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;
};
const storedUs = (t: number): number => rint((t - PG_EPOCH) * 1e6) + PG_EPOCH * 1e6;

/* ---- the field clock, to the last bit ------------------------------------------------------ */

const moments: number[] = [];
// Every two hours from two months before the first spring to three years after it.
for (let t = YEAR_FROM - 60 * DAY; t <= YEAR_FROM + 3 * YEAR_SECONDS; t += 2 * HOUR) moments.push(usOf(t));
// A second and a microsecond either side of every turn of the first three years, and the turn itself.
for (let k = 0; k <= 12; k++) {
  const turn = YEAR_FROM + k * SEASON_SECONDS;
  for (const d of [-1, -1e-6, 0, 1e-6, 1]) moments.push(usOf(turn) + Math.round(d * 1e6));
}
// Deep in each of three winters.
for (let y = 0; y < 3; y++) {
  for (const f of [0.1, 0.5, 0.9]) moments.push(usOf(YEAR_FROM + y * YEAR_SECONDS + (3 + f) * SEASON_SECONDS));
}
// And two thousand anywhere in five years round the first spring, to the microsecond.
for (let i = 0; i < 2000; i++) moments.push(usOf(YEAR_FROM - YEAR_SECONDS) + Math.floor(rnd() * 5 * YEAR_SECONDS * 1e6));

// Readings of the clock to go back from: every moment's own, and two thousand anywhere.
const readings: number[] = moments.map((u) => fieldClock(u / 1e6));
for (let i = 0; i < 2000; i++) readings.push(YEAR_FROM - YEAR_SECONDS + rnd() * 5 * YEAR_SECONDS);

const clockOut = psql(`
select string_agg(field_clock(ts.t)::text, ',' order by u.i)
  from unnest(array[${moments.join(',')}]::bigint[]) with ordinality u(m, i)
  cross join lateral (select timestamptz 'epoch' + u.m * interval '1 microsecond' as t) ts;
select string_agg(field_moment(r.g)::text, ',' order by r.i)
  from unnest(array[${readings.map((g) => `${g}`).join(',')}]::double precision[]) with ordinality r(g, i);
`).split('\n');
const islandClock = clockOut[0].split(',').map(num);
const islandMoment = clockOut[1].split(',').map(num);
{
  let same = 0;
  const differ: string[] = [];
  moments.forEach((u, i) => {
    const mine = fieldClock(u / 1e6);
    if (mine === islandClock[i]) same++;
    else if (differ.length < 4) differ.push(`${new Date(u / 1000).toISOString()}: ${mine} against ${islandClock[i]}`);
  });
  check(`the field clock is the same double on both sides at ${moments.length} moments`, same === moments.length, differ.join('; ') || `${same} of ${moments.length}`);
}
{
  let same = 0;
  const differ: string[] = [];
  readings.forEach((g, i) => {
    const mine = fieldMoment(g);
    if (mine === islandMoment[i]) same++;
    else if (differ.length < 4) differ.push(`${g}: ${mine} against ${islandMoment[i]}`);
  });
  check(`and so is the moment it reads each of ${readings.length} readings`, same === readings.length, differ.join('; ') || `${same} of ${readings.length}`);
}

// What the clock is for: the rates it runs at, a winter it stands still through, and an inverse that is the earliest moment.
{
  const at = (season: Season, day: number, y = 0): number => YEAR_FROM + y * YEAR_SECONDS + SEASONS.indexOf(season) * SEASON_SECONDS + day * YEAR_DAY;
  const rates = SEASONS.map((s) => (fieldClock(at(s, 3) + HOUR) - fieldClock(at(s, 3))) / HOUR);
  check(`a field grows ${SEASONS.map((s) => `${SEASON_GROWTH[s]} of a crop's pace in ${s}`).join(', ')}`,
    SEASONS.every((s, i) => Math.abs(rates[i] - SEASON_GROWTH[s]) < 1e-9 && fieldRate(at(s, 3)) === SEASON_GROWTH[s]), rates.join(', '));
  check(`and ${YEARLESS_GROWTH} before the first spring, so nothing already growing changed`,
    fieldClock(YEAR_FROM - DAY) === YEAR_FROM - DAY && fieldRate(YEAR_FROM - 1) === YEARLESS_GROWTH);
  const autumnEnds = at('winter', 0);
  check('a winter holds the clock where the autumn left it, and spring takes it on from there',
    fieldClock(at('winter', 3)) === fieldClock(autumnEnds) && fieldClock(at('spring', 0, 1)) === fieldClock(autumnEnds)
      && fieldClock(at('spring', 0, 1) + 60) - fieldClock(autumnEnds) === 60 * SEASON_GROWTH.spring);
  check('and a reading a winter holds is reached at the end of the autumn, not somewhere in the flat',
    fieldMoment(fieldClock(at('winter', 5))) === autumnEnds, `${fieldMoment(fieldClock(at('winter', 5))) - autumnEnds}s off`);
  let round = 0;
  for (const u of moments) {
    const t = u / 1e6;
    if (Math.abs(fieldClock(fieldMoment(fieldClock(t))) - fieldClock(t)) < 1e-6 && fieldMoment(fieldClock(t)) <= t + 1e-6) round++;
  }
  check('going back from a reading lands where the clock reads it, never after the moment it was read at', round === moments.length, `${round} of ${moments.length}`);
}

/* ---- crops settled across the turns ---------------------------------------------------------- */

/*
 * A crop in a field or a planter, at a stage, its stage begun at a moment and
 * asked about at a later one, with a stage of a given length. Stages begun
 * three stages, one stage and a second before each turn of two years, a
 * microsecond either side of it and a second after, looked at a second, half
 * a stage, a stage, a stage and a half, two stages, a day, eight days and a
 * month later -- so every kind of straddle, a winter swallowed whole
 * included -- and a thousand more anywhere.
 */
interface Case { stage: number; at: number; now: number; per: number; planter: boolean }
const cases: Case[] = [];
const PERS = [CROPS.mint.stageSeconds, CROPS.wheat.stageSeconds * 0.8, CROPS.corn.stageSeconds * 0.72 * 0.8, 3.3 * DAY];
for (let k = 1; k <= 8; k++) {
  const turn = usOf(YEAR_FROM + k * SEASON_SECONDS);
  for (const per of PERS) {
    for (const back of [3 * per, per - 1, 1, 1e-6, 0, -1e-6, -1]) {
      const at = turn - Math.round(back * 1e6);
      for (const later of [1, per / 2, per, 1.5 * per, 2 * per, DAY, 8 * DAY, 30 * DAY]) {
        cases.push({ stage: Math.floor(rnd() * RIPE), at, now: at + Math.round(later * 1e6), per, planter: rnd() < 0.25 });
      }
    }
  }
}
for (let i = 0; i < 1000; i++) {
  const at = usOf(YEAR_FROM - 30 * DAY) + Math.floor(rnd() * 2 * YEAR_SECONDS * 1e6);
  cases.push({ stage: Math.floor(rnd() * RIPE), at, now: at + Math.floor(rnd() * 40 * DAY * 1e6), per: PERS[Math.floor(rnd() * PERS.length)], planter: rnd() < 0.3 });
}
const settledOut = psql(`
select string_agg(s.o_stage || ':' || s.o_steps || ':' || (extract(epoch from s.o_stage_at) * 1000000)::bigint, ',' order by c.i)
  from unnest(array[${cases.map((c) => c.stage).join(',')}]::int[], array[${cases.map((c) => c.at).join(',')}]::bigint[],
              array[${cases.map((c) => c.now).join(',')}]::bigint[], array[${cases.map((c) => `${c.per}`).join(',')}]::double precision[],
              array[${cases.map((c) => c.planter).join(',')}]::boolean[]) with ordinality c(stage, at, now, per, planter, i)
  cross join lateral crop_settled(c.stage, (timestamptz 'epoch' + c.at * interval '1 microsecond'), c.per, c.planter, (timestamptz 'epoch' + c.now * interval '1 microsecond')) s;
`).split(',');
{
  let same = 0;
  let straddled = 0;
  const differ: string[] = [];
  cases.forEach((cs, i) => {
    // The browser's: the stage start on the clock it grows on, settled there, and read back as a moment.
    const clock = (t: number): number => (cs.planter ? PLANTER_GROWTH * t : fieldClock(t));
    const back = (g: number): number => (cs.planter ? g / PLANTER_GROWTH : fieldMoment(g));
    const c: Crop = { x: 0, y: 0, id: 'wheat', stage: cs.stage, stageAt: clock(cs.at / 1e6), tended: 0, tendedNow: false, ql: 1 };
    const steps = cropSteps(c, cs.per, clock(cs.now / 1e6));
    settleCrop(c, cs.per, clock(cs.now / 1e6));
    const startUs = steps > 0 ? storedUs(back(c.stageAt)) : cs.at;
    const [stage, isteps, iat] = (settledOut[i] ?? '').split(':').map(Number);
    if (stage === c.stage && isteps === steps && iat === startUs) same++;
    else if (differ.length < 4) differ.push(`${cs.planter ? 'planter' : 'field'} stage ${cs.stage} from ${new Date(cs.at / 1000).toISOString()} at ${new Date(cs.now / 1000).toISOString()}, ${cs.per}s: ${c.stage}/${steps}/${startUs} against ${settledOut[i]}`);
    if (!cs.planter && seasonAt(cs.at / 1e6).season !== seasonAt(cs.now / 1e6).season && cs.at / 1e6 >= YEAR_FROM) straddled++;
  });
  check(`${cases.length} crops settled across the turns come to the same stage, the same steps and the same stage start to the microsecond`,
    same === cases.length, differ.join('; ') || `${same} of ${cases.length}, ${straddled} of them fields whose stage straddles a turn`);
}

/* ---- the words a wait is said in --------------------------------------------------------------- */

/*
 * When the next stage comes, from a moment and the growing seconds still to
 * go: a field growing, a field whose stage runs into a winter, a field in a
 * winter, and a planter, which never waits. The sowing line says it on both
 * sides, so it has to be the same line.
 */
interface Said { at: number; left: number; planter: boolean; next: string }
const saids: Said[] = [];
const LEFTS = [1, 59, CROPS.mint.stageSeconds, CROPS.wheat.stageSeconds, CROPS.wheat.stageSeconds / PLANTER_GROWTH, 3 * CROPS.corn.stageSeconds, 2 * DAY, 8 * DAY];
moments.forEach((u, i) => {
  if (i % 3) return;
  for (const left of LEFTS) saids.push({ at: u, left, planter: rnd() < 0.2, next: STAGE_NAMES[1 + Math.floor(rnd() * RIPE)] });
});
const saidOut = psql(`
select string_agg(crop_when(w.nx, w.lft, w.planter, timestamptz 'epoch' + w.at * interval '1 microsecond'), '|' order by w.i)
  from unnest(array[${saids.map((w) => q(w.next)).join(',')}]::text[], array[${saids.map((w) => `${w.left}`).join(',')}]::double precision[],
              array[${saids.map((w) => w.planter).join(',')}]::boolean[], array[${saids.map((w) => w.at).join(',')}]::bigint[])
       with ordinality w(nx, lft, planter, at, i);
select sown_said('Wheat', false, 'waiting for spring, in 2 days, then sprouting 5 minutes after') || '|' || sown_said('Mint', true, 'sprouting in 8 minutes');
`).split('\n');
{
  const theirs = saidOut[0].split('|');
  let same = 0;
  const kinds = new Set<string>();
  const differ: string[] = [];
  saids.forEach((w, i) => {
    const mine = cropWhen(w.next, w.left, w.planter, w.at / 1e6);
    if (mine === theirs[i]) same++;
    else if (differ.length < 4) differ.push(`${new Date(w.at / 1000).toISOString()} ${w.left}s: "${mine}" against "${theirs[i]}"`);
    kinds.add(w.planter ? 'planter' : mine.startsWith('waiting for') ? 'waiting' : mine.includes(', after the') ? 'over a winter' : 'growing');
  });
  check(`when the next stage comes is said in the same words on both sides, ${saids.length} times over`,
    same === saids.length && kinds.size === 4, differ.join('; ') || `${same} of ${saids.length}: ${[...kinds].join(', ')}`);
  // Two days into a winter of thirty, each a day and night of the clock: twenty-eight of them to wait, a day and four hours.
  const winter = YEAR_FROM + 3 * SEASON_SECONDS + 2 * YEAR_DAY;
  const lateAutumn = YEAR_FROM + 3 * SEASON_SECONDS - HOUR;
  check('a field in winter says it waits for spring and how long that is, and when the stage then comes',
    cropWhen('sprouting', CROPS.wheat.stageSeconds, false, winter) === `waiting for spring, in 1 day and 4 hours, then sprouting 5 minutes after`,
    cropWhen('sprouting', CROPS.wheat.stageSeconds, false, winter));
  check('and a stage that runs into a winter says when it will come, and that the winter is in it',
    // An hour of autumn at half pace, the winter's thirty hours, and the hour and a half left at spring's.
    cropWhen('ripe', 2 * HOUR, false, lateAutumn) === 'ripe in 1 day and 8 hours, after the winter',
    cropWhen('ripe', 2 * HOUR, false, lateAutumn));
  check('and a planter never waits: the same wait in every season',
    SEASONS.every((s) => cropWhen('sprouting', CROPS.wheat.stageSeconds, true, YEAR_FROM + (SEASONS.indexOf(s) + 0.5) * SEASON_SECONDS)
      === cropWhen('sprouting', CROPS.wheat.stageSeconds, true, YEAR_FROM)),
    cropWhen('sprouting', CROPS.wheat.stageSeconds, true, YEAR_FROM));
  const [sowField, sowBox] = saidOut[1].split('|');
  // A field sown in winter, and a planter sown whenever.
  check('and a sowing says it in the same line', sowField === sownSaid('Wheat', false, 'waiting for spring, in 2 days, then sprouting 5 minutes after')
    && sowBox === sownSaid('Mint', true, 'sprouting in 8 minutes'), `${sowField} / ${sowBox}`);
}

/* ---- a season held still, for a test ------------------------------------------------------------ */

/*
 * `wurm.season` holds every moment in one season to a field, for the session
 * that sets it: what the suite's farming runs under, so that it reads the
 * same whatever day it is run on. A planter pays it no mind.
 */
const pinned = psql(`
begin;
create temp table held (s text, o int, v text) on commit drop;
do $$
declare v_s text; v_o int; v_now timestamptz := date_trunc('second', now());
begin
  for v_s, v_o in select u.s, u.o from unnest(seasons()) with ordinality u(s, o) loop
    perform set_config('wurm.season', v_s, true);
    insert into held values (v_s, v_o, field_rate(v_now) || '/' || (field_clock(v_now) - field_clock(v_now - interval '1 hour'))
      || '/' || (crop_settled(0, v_now - interval '1 hour', 1700, false, v_now)).o_steps
      || '/' || (crop_settled(0, v_now - interval '1 hour', 3400 * ${PLANTER_GROWTH}, true, v_now)).o_steps);
  end loop;
  perform set_config('wurm.season', '', true);
end $$;
select string_agg(s || ':' || v, ',' order by o) from held;
select coalesce(season_pinned(), 'none');
commit;
`).split('\n');
{
  const rows = new Map(pinned[0].split(',').map((r) => r.split(':') as [string, string]));
  const right = SEASONS.every((s) => {
    const [rate, hour, field, box] = (rows.get(s) ?? '').split('/').map(Number);
    return rate === SEASON_GROWTH[s] && Math.abs(hour - HOUR * SEASON_GROWTH[s]) < 1e-3
      && field === Math.min(RIPE, Math.floor((HOUR * SEASON_GROWTH[s]) / 1700)) && box === 1;
  });
  check(`held in each season, a field grows at that season's share of every second and a planter at ${PLANTER_GROWTH} of it regardless`, right, pinned[0]);
  check('and let go, nothing is held', pinned[pinned.length - 1] === 'none', pinned[pinned.length - 1]);
}

/* ---- a planter, through the doors -------------------------------------------------------------- */

/*
 * One planter on the suite's own island, beside its first body, and the four
 * jobs aimed at it: refused, sown, tended, ripened by the clock alone,
 * harvested, sown again with the Farmer's pace and Crop Rotation keyed to it,
 * pulled up, and lifted once it is empty. Then Bounty on a settlement with a
 * planter on it and one off it, and a night's sleep. Everything the island
 * says is kept to be held against the browser's below.
 */
const FARMER = perksOf('farmer');
const perk = (name: string) => {
  const p = FARMER.find((x) => x.name === name);
  if (!p) throw new Error(`the Farmer has no perk called ${name}`);
  return p;
};
const FAST = perk('Fast Growth');
const ROTATE = perk('Crop Rotation');
/** Where the planter stands: tile 10,9, its two subtiles at the corner, and its middle. */
const BOX = { x: 10, y: 9, sx: 0, sy: 0, cx: 10 + 1 / 4, cy: 9 + 0.5 / 4 };
const island = psql(`
begin;
create temp table said (k text, v text);
create function pg_temp.hold(w uuid, u uuid, ids text[]) returns jsonb language plpgsql as $f$
begin
  delete from player_node where world_id = w and uid = u;
  insert into player_node (world_id, uid, node) select w, u, x from unnest(ids) x;
  return class_fold(w, u);
end $f$;
-- Every skill check passes, and a pair of hands turns out forty: a go must show the rule.
create or replace function skill_check(p_skill double precision, p_difficulty double precision,
   p_tool_ql double precision default 0, p_ease double precision default 0)
   returns boolean language sql as 'select true';
create or replace function product_ql(p_skill double precision, p_tool_ql double precision default 0)
  returns double precision language sql as 'select 40::double precision';
do $$
declare w uuid; u uuid; v_box bigint; v_far bigint; v_c int; t jsonb; v_seed bigint; v_per double precision; v_j jsonb;
        v_field_before double precision; v_box_before timestamptz; v_g double precision;
begin
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  delete from placed where world_id = w and x between 4 and 15 and y between 4 and 15;
  delete from crop where world_id = w;
  delete from deed where world_id = w;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  update player set way = null where world_id = w;
  update player set x = 9.5, y = 9.5, act = null, act_target = null, act_started = null, act_ends = null,
         act_left = null, act_goes = null, act_queue = '[]', craft_class = 'farmer', class_mul = null,
         body_at = now(), stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
   where world_id = w and uid = u;
  perform pg_temp.hold(w, u, '{}');
  insert into skill (world_id, uid, id, value) values (w, u, 'farming', 50)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'planter', ${BOX.x}, ${BOX.y}, ${BOX.sx}, ${BOX.sy}, ${BOX.cx}, ${BOX.cy}, 40, 'Oak', u) returning id into v_box;
  t := jsonb_build_object('kind', 'furniture', 'id', v_box);

  -- Refused: with no seed, and from across the island.
  insert into said values ('NOSEED', coalesce(act_refusal(w, u, 'plant_seed', t), 'ALLOWED'));
  update player set x = 15.5, y = 15.5 where world_id = w and uid = u;
  insert into said values ('FAR', coalesce(act_refusal(w, u, 'plant_seed', t), 'ALLOWED'));
  update player set x = 9.5, y = 9.5 where world_id = w and uid = u;

  -- Sown, through the doors.
  perform give(w, u, 'wheat_seed', 5, 50);
  v_seed := (select i.id from item i where i.world_id = w and i.holder_uid = u and i.def = 'wheat_seed' order by i.id desc limit 1);
  insert into said values ('SOWASK', coalesce(act_refusal(w, u, 'plant_seed', t || jsonb_build_object('itemUid', v_seed)), 'ALLOWED'));
  perform act_perform(w, u, 'plant_seed', t || jsonb_build_object('itemUid', v_seed));
  insert into said select 'SOWN', c.id || ':' || c.stage || ':' || c.pace || ':'
      || (select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder_uid = u and i.def = 'wheat_seed')
      || ':' || (select p.state->>'sown' from placed p where p.id = v_box)
    from planter_crop c where c.placed = v_box;
  insert into said select 'SOWSAID', e.text from event e where e.world_id = w and e.uid = u and e.text like 'You sow %' order by e.n desc limit 1;
  insert into said values ('AGAIN', coalesce(act_refusal(w, u, 'plant_seed', t || jsonb_build_object('itemUid', v_seed)), 'ALLOWED'));
  insert into said values ('EARLY', coalesce(act_refusal(w, u, 'harvest_crop', t), 'ALLOWED'));
  insert into said values ('LIFT', coalesce(act_refusal(w, u, 'pick_up_furniture', t), 'ALLOWED'));

  -- Tended, once a stage.
  perform act_perform(w, u, 'tend_crop', t);
  insert into said select 'TENDED', c.tended || ':' || c.tended_now || ':' || round(c.ql::numeric, 2) from planter_crop c where c.placed = v_box;
  insert into said select 'TENDSAID', e.text from event e where e.world_id = w and e.uid = u and e.text like 'You weed %' order by e.n desc limit 1;
  insert into said values ('TENDAGAIN', coalesce(act_refusal(w, u, 'tend_crop', t), 'ALLOWED'));

  -- What the ground read says of it: its stage, how far into it it has grown on its own clock, and the island's clock.
  update planter_crop set stage_at = now() - interval '400 seconds' where placed = v_box;
  delete from caller where uid = u;
  v_j := rpc_ground(w, 40, true);
  insert into said select 'GROUND', (r->>'planter') || ':' || (r->>'stage') || ':' || round((r->>'grown')::numeric, 3)
      || ':' || (v_j ? 'now') || ':' || (abs((v_j->>'now')::double precision - extract(epoch from now())) < 1)
    from jsonb_array_elements(v_j->'planted') r where (r->>'planter')::bigint = v_box;

  -- Ripe by the clock alone: three stages of the planter's own time, and a second.
  v_per := (select stage_seconds from crop_def where id = 'wheat');
  update planter_crop set stage_at = now() - make_interval(secs => 3 * v_per / planter_growth() + 1) where placed = v_box;
  insert into said values ('RIPE', coalesce(act_refusal(w, u, 'tend_crop', t), 'ALLOWED') || '|' || coalesce(act_refusal(w, u, 'harvest_crop', t), 'ALLOWED'));
  perform act_perform(w, u, 'harvest_crop', t);
  insert into said values ('HARVEST', (select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder_uid = u and i.def = 'wheat')
      || ':' || (select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder_uid = u and i.def = 'wheat_seed')
      || ':' || (select count(*) from planter_crop c where c.placed = v_box));
  insert into said select 'HARVESTSAID', e.text from event e where e.world_id = w and e.uid = u and e.text like 'You harvest %' order by e.n desc limit 1;

  -- The Farmer's pace, and Crop Rotation keyed to the planter: wheat after wheat is none, carrot after wheat is.
  perform pg_temp.hold(w, u, array[${q(FAST.id)}, ${q(ROTATE.id)}]);
  perform give(w, u, 'carrot_seed', 3, 50);
  perform act_perform(w, u, 'plant_seed', t || jsonb_build_object('itemUid',
    (select i.id from item i where i.world_id = w and i.holder_uid = u and i.def = 'wheat_seed' order by i.id desc limit 1)));
  insert into said select 'PACE', c.pace::text from planter_crop c where c.placed = v_box;
  perform act_perform(w, u, 'clear_field', t);
  insert into said select 'PULLSAID', e.text from event e where e.world_id = w and e.uid = u and e.text like 'You turn %' order by e.n desc limit 1;
  perform act_perform(w, u, 'plant_seed', t || jsonb_build_object('itemUid',
    (select i.id from item i where i.world_id = w and i.holder_uid = u and i.def = 'carrot_seed' order by i.id desc limit 1)));
  insert into said select 'ROTATED', c.id || ':' || c.pace from planter_crop c where c.placed = v_box;
  perform pg_temp.hold(w, u, '{}');
  perform act_perform(w, u, 'clear_field', t);
  insert into said values ('PULLED', (select count(*) from planter_crop c where c.placed = v_box)::text
      || ':' || coalesce(act_refusal(w, u, 'pick_up_furniture', t), 'ALLOWED')
      || ':' || coalesce(act_refusal(w, u, 'harvest_crop', t), 'ALLOWED'));

  -- And through the whole door: asked of \`rpc_act\` as a browser asks it, and finished by the clock in \`settle\`.
  perform give(w, u, 'wheat_seed', 1, 50);
  delete from caller where uid = u;
  v_j := rpc_act(w, 'plant_seed', t || jsonb_build_object('itemUid',
    (select i.id from item i where i.world_id = w and i.holder_uid = u and i.def = 'wheat_seed' order by i.id desc limit 1)), 1);
  update player set act_started = act_started - interval '600 seconds', act_ends = act_ends - interval '600 seconds'
   where world_id = w and uid = u;
  perform settle(w, u);
  insert into said values ('DOOR', coalesce(v_j->>'why', 'taken') || ':'
      || coalesce((select c.id || ':' || c.stage from planter_crop c where c.placed = v_box), 'nothing sown'));
  delete from planter_crop where placed = v_box;

  -- Bounty: a settlement over the planter and a field, and a second planter off it.
  insert into deed (world_id, name, x, y, radius, level, founded_by) values (w, 'Seedbed', 8, 8, 3, 1, u);
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'planter', 14, 14, 0, 0, 14.25, 14.125, 40, 'Oak', u) returning id into v_far;
  insert into planter_crop (placed, world_id, id, stage, stage_at, ql) values (v_box, w, 'wheat', 0, now(), 40), (v_far, w, 'wheat', 0, now(), 40);
  perform land_set_tile(w, 7, 7, tile_id('Field'));
  insert into crop (world_id, x, y, id, stage, stage_at, ql) values (w, 7, 7, 'wheat', 1, now(), 40);
  -- Its own statement, then the reading: a statement does not see what it did itself.
  v_c := hasten_crops(w, u);
  insert into said values ('BOUNTY', v_c || ':' || (select stage from planter_crop where placed = v_box)
      || ':' || (select stage from planter_crop where placed = v_far) || ':' || (select stage from crop where world_id = w and x = 7 and y = 7));

  -- A night slept through: the planter the whole of it, the field the season's share of it.
  update planter_crop set stage = 0, stage_at = now() where placed = v_box;
  update crop set stage = 0, stage_at = now() where world_id = w and x = 7 and y = 7;
  v_field_before := field_clock(now());
  perform sleep_forward(w, u, 600);
  insert into said values ('SLEPT', round(extract(epoch from (now() - (select stage_at from planter_crop where placed = v_box)))::numeric, 3)
      || ':' || round((v_field_before - field_clock((select stage_at from crop where world_id = w and x = 7 and y = 7)))::numeric, 3)
      || ':' || field_rate(now()));
end $$;
select k || E'\\t' || coalesce(v, '') from said;
rollback;
`);
const isaid = new Map(island.split('\n').filter(Boolean).map((l) => {
  const [k, ...v] = l.split('\t');
  return [k, v.join('\t')];
}));
const say = (k: string): string => isaid.get(k) ?? 'unsaid';
const wheatPer = CROPS.wheat.stageSeconds;
const plantSaid = sownSaid('Wheat', true, cropWhen(STAGE_NAMES[1], wheatPer, true, YEAR_FROM));
check('the island refuses a planter with no seed and from across the island, in the field\'s words and the furniture\'s',
  say('NOSEED') === 'Choose a seed to sow.' && say('FAR') === 'Stand next to the planter.', `${say('NOSEED')} / ${say('FAR')}`);
check('and sows it through the doors: one seed, at its own pace, and the planter remembers it',
  say('SOWASK') === 'ALLOWED' && say('SOWN') === 'wheat:0:1:4:wheat', say('SOWN'));
check(`and says when it will sprout at a planter's ${PLANTER_GROWTH} of the crop's pace: "${plantSaid}"`, say('SOWSAID') === plantSaid, say('SOWSAID'));
check('and refuses a second sowing, an early harvest and lifting it while it grows, in so many words',
  say('AGAIN') === 'Something is already growing there.' && say('EARLY') === 'It is only sown. Let it grow.' && say('LIFT') === PLANTER_GROWING,
  `${say('AGAIN')} / ${say('EARLY')} / ${say('LIFT')}`);
check('and tends it once a stage, as a field is tended',
  // The seed's fifty and the hands' forty, averaged over the care it was given.
  say('TENDED') === '1:true:45.00' && say('TENDSAID') === `You weed and water the wheat. It should give ${cropYield(1).produce} wheat and ${cropYield(1).seeds} seed.`
    && say('TENDAGAIN') === 'You have already tended it at this stage. Wait for it to grow on.', `${say('TENDED')} / ${say('TENDSAID')}`);
{
  const [id, stage, grown, hasNow, nowRight] = say('GROUND').split(':');
  check('the ground read says what grows in it and how far it has grown on its own clock, and the island\'s clock',
    Number(id) > 0 && stage === '0' && Math.abs(Number(grown) - 400 * PLANTER_GROWTH) < 0.5 && hasNow === 'true' && nowRight === 'true', say('GROUND'));
}
check('three stages of the planter\'s time ripen it by the clock alone, and the doors know it without a hand on it',
  say('RIPE') === 'It is ripe. Harvest it.|ALLOWED', say('RIPE'));
check(`and it harvests as a field does: ${cropYield(1).produce} wheat and ${cropYield(1).seeds} seed for one tending, and the planter empty`,
  // Its forty-five and the hands' forty, halved.
  say('HARVEST') === `${cropYield(1).produce}:${4 + cropYield(1).seeds}:0` && say('HARVESTSAID').endsWith('The planter is ready to sow again. (QL 42.5)'),
  `${say('HARVEST')} / ${say('HARVESTSAID')}`);
const fg = FAST.fx['grow:plant_seed'];
const cr = ROTATE.fx['rotate:plant_seed'];
check(`Fast Growth's pace goes into a planter, ${fg}, and Crop Rotation is the planter's own: none after the same crop, ${cr} more after another`,
  Math.abs(Number(say('PACE')) - fg) < 1e-9 && say('ROTATED').startsWith('carrot:') && Math.abs(Number(say('ROTATED').split(':')[1]) - fg * cr) < 1e-9,
  `${say('PACE')} / ${say('ROTATED')}`);
check('pulled up, it says so, it is empty, and it may be lifted',
  say('PULLSAID') === 'You turn the wheat back into the soil.' && say('PULLED') === '0:ALLOWED:Nothing is growing there.', `${say('PULLSAID')} / ${say('PULLED')}`);
check('and asked through the door a browser uses, the clock finishing the go, it is sown just the same', say('DOOR') === 'taken:wheat:0', say('DOOR'));
check('Bounty brings on every crop on the caster\'s settlement, the planter standing on it included, and not one off it',
  say('BOUNTY') === '2:1:0:2', say('BOUNTY'));
{
  const [box, field, rate] = say('SLEPT').split(':').map(Number);
  check(`a night slept moves a planter on by the whole of it, and a field by the season's share of it (${rate} now)`,
    Math.abs(box - 600) < 0.01 && Math.abs(field - 600 * rate) < 0.01, say('SLEPT'));
}

/* ---- and the same planter in the browser --------------------------------------------------------- */

const game = Game.create(3141);
const heard = (prefix: string): string => [...game.log].reverse().find((l) => l.text.startsWith(prefix))?.text ?? 'unsaid';
const box = game.addFurniture('planter', BOX.x, BOX.y, BOX.sx, BOX.sy, 40, [], 'Oak');
game.player.x = 9.5;
game.player.y = 9.5;
const ft = { kind: 'furniture', id: box.id } as Target;
const withSeed = (uid: number): Target => ({ kind: 'furniture', id: box.id, itemUid: uid } as Target);
const ask = (id: string, t: Target): string => ACTION_BY_ID.get(id)!.check?.(t, game) ?? 'ALLOWED';
const run = (id: string, t: Target): void => { ACTION_BY_ID.get(id)!.perform(t, game); };
game.setPerks({});
// The hands at forty, as the island's are held for the test.
game.productQl = () => 40;
check('the browser refuses the same: no seed, and too far off',
  ask('plant_seed', ft) === say('NOSEED') && (() => {
    game.player.x = 15.5; game.player.y = 15.5;
    const far = ask('plant_seed', ft);
    game.player.x = 9.5; game.player.y = 9.5;
    return far === say('FAR');
  })());
const wheat = game.inventory.add('wheat_seed', { count: 5, ql: 50 });
check('and allows the sowing the island allows', ask('plant_seed', withSeed(wheat.uid)) === say('SOWASK'));
run('plant_seed', withSeed(wheat.uid));
const growing = game.planted.get(box.id);
check('and sows it: one seed, at its own pace, and the planter remembers it, as the island has it',
  `${growing?.id}:${growing?.stage}:${growing?.pace ?? 1}:${game.inventory.count('wheat_seed')}:${box.sown}` === say('SOWN'),
  `${growing?.id}:${growing?.stage}:${growing?.pace ?? 1}:${game.inventory.count('wheat_seed')}:${box.sown}`);
check('and says the island\'s line about when it will sprout', heard('You sow ') === say('SOWSAID'), heard('You sow '));
check('and refuses a second sowing, an early harvest and lifting it in the island\'s words',
  ask('plant_seed', withSeed(wheat.uid)) === say('AGAIN') && ask('harvest_crop', ft) === say('EARLY') && ask('pick_up_furniture', ft) === say('LIFT'),
  `${ask('plant_seed', withSeed(wheat.uid))} / ${ask('harvest_crop', ft)} / ${ask('pick_up_furniture', ft)}`);
run('tend_crop', ft);
check('and tends it, saying what it will give, and not twice a stage',
  `${growing?.tended}:${growing?.tendedNow}:${growing?.ql.toFixed(2)}` === say('TENDED') && heard('You weed ') === say('TENDSAID')
    && ask('tend_crop', ft) === say('TENDAGAIN'), `${growing?.tended}:${growing?.tendedNow}:${growing?.ql.toFixed(2)} / ${heard('You weed ')}`);
// Three stages of the planter's own time, by the clock alone.
if (growing) growing.stageAt -= 3 * wheatPer + PLANTER_GROWTH;
game.update(0.01);
check('ripened by the planter\'s clock, it wants harvesting and not tending, as on the island', `${ask('tend_crop', ft)}|${ask('harvest_crop', ft)}` === say('RIPE'),
  `${ask('tend_crop', ft)}|${ask('harvest_crop', ft)}`);
run('harvest_crop', ft);
check('and harvests to the same yield and the same line',
  `${game.inventory.count('wheat')}:${game.inventory.count('wheat_seed')}:${game.planted.has(box.id) ? 1 : 0}` === say('HARVEST')
    && heard('You harvest ') === say('HARVESTSAID'), `${game.inventory.count('wheat')}:${game.inventory.count('wheat_seed')} / ${heard('You harvest ')}`);
game.setPerks({ ...FAST.fx, ...ROTATE.fx });
run('plant_seed', withSeed(game.inventory.find('wheat_seed')!.uid));
const samePace = game.planted.get(box.id)?.pace ?? 1;
check('Pull it up is what a planter calls clearing', ACTION_BY_ID.get('clear_field')!.labelFor?.(ft, game) === 'Pull it up');
run('clear_field', ft);
const pullSaid = heard('You turn ');
const carrots = game.inventory.add('carrot_seed', { count: 3, ql: 50 });
run('plant_seed', withSeed(carrots.uid));
const rotated = game.planted.get(box.id);
check('and the browser stamps the same paces: Fast Growth, and Crop Rotation off the planter\'s own last crop',
  Math.abs(samePace - Number(say('PACE'))) < 1e-9 && `${rotated?.id}:${rotated?.pace}` === say('ROTATED') && pullSaid === say('PULLSAID'),
  `${samePace} / ${rotated?.id}:${rotated?.pace} / ${pullSaid}`);
game.setPerks({});
run('clear_field', ft);
check('and, pulled up, it may be lifted and has nothing to harvest',
  `${game.planted.has(box.id) ? 1 : 0}:${ask('pick_up_furniture', ft)}:${ask('harvest_crop', ft)}` === say('PULLED'),
  `${game.planted.has(box.id) ? 1 : 0}:${ask('pick_up_furniture', ft)}:${ask('harvest_crop', ft)}`);
// Bounty on a settlement over the planter and a field, with a second planter off it.
game.deed = { name: 'Seedbed', x: 8, y: 8, radius: 3, level: 1, mine: true };
const far = game.addFurniture('planter', 14, 14, 0, 0, 40, [], 'Oak');
game.sowPlanter(box, 'wheat', 40);
game.sowPlanter(far, 'wheat', 40);
game.plantCrop(7, 7, 'wheat', 40).stage = 1;
check('and Bounty brings on the same: the field and the planter on the settlement, and not the one off it',
  `${game.hastenCrops()}:${game.planted.get(box.id)?.stage}:${game.planted.get(far.id)?.stage}:${game.cropAt(7, 7)?.stage}` === say('BOUNTY'),
  `${game.planted.get(box.id)?.stage}:${game.planted.get(far.id)?.stage}:${game.cropAt(7, 7)?.stage}`);

/* ---- a planter's pace, the same in every season ------------------------------------------------ */

/*
 * The same crop sown on the same day of each season, in a field and in a
 * planter, and looked at a stage's worth of a planter's time later: the
 * planter has come on exactly one stage in every season and the field as
 * its season lets it -- on both sides.
 */
{
  const per = CROPS.cotton.stageSeconds;
  const span = per / PLANTER_GROWTH + 1;
  const sown = SEASONS.map((s) => usOf(YEAR_FROM + YEAR_SECONDS + SEASONS.indexOf(s) * SEASON_SECONDS + 2 * YEAR_DAY));
  const theirs = psql(`
select string_agg((crop_settled(0, timestamptz 'epoch' + a * interval '1 microsecond', ${per}, true,
                                timestamptz 'epoch' + (a + ${Math.round(span * 1e6)}) * interval '1 microsecond')).o_steps
                  || ':' || (crop_settled(0, timestamptz 'epoch' + a * interval '1 microsecond', ${per}, false,
                                timestamptz 'epoch' + (a + ${Math.round(span * 1e6)}) * interval '1 microsecond')).o_steps, ',' order by o)
  from unnest(array[${sown.join(',')}]::bigint[]) with ordinality u(a, o);`).split(',');
  const mine = sown.map((a) => {
    const at = a / 1e6;
    const later = (a + Math.round(span * 1e6)) / 1e6;
    const box = cropSteps({ stage: 0, stageAt: PLANTER_GROWTH * at }, per, PLANTER_GROWTH * later);
    const field = cropSteps({ stage: 0, stageAt: fieldClock(at) }, per, fieldClock(later));
    return `${box}:${field}`;
  });
  check(`a planter comes on one stage in ${Math.round(span / 60)} minutes in spring, summer, autumn and winter alike, where a field comes on ${mine.map((m) => m.split(':')[1]).join(', ')}`,
    mine.every((m) => m.startsWith('1:')) && mine.join(',') === theirs.join(',') && mine[3].endsWith(':0') && Number(mine[1].split(':')[1]) > Number(mine[2].split(':')[1]),
    `browser ${mine.join(' ')} · island ${theirs.join(' ')}`);
}

/* ---- the browser's own field clock --------------------------------------------------------------- */

/*
 * Played by yourself the game's clock is not the wall clock -- it stops when
 * the page is shut and leaps when you sleep -- so the fields keep a clock of
 * their own that runs at the season's share of every game second and is kept
 * in the save. Each season's moment is held still on the wall clock for it.
 */
{
  const g = Game.create(2718);
  const moment = (s: Season): number => YEAR_FROM + (SEASONS.indexOf(s) + 0.5) * SEASON_SECONDS;
  const ran = SEASONS.map((s) => {
    g.wallClock = () => moment(s);
    const before = g.fieldTime;
    g.update(10);
    return g.fieldTime - before;
  });
  g.wallClock = () => YEAR_FROM - DAY;
  const before = g.fieldTime;
  g.update(10);
  const yearless = g.fieldTime - before;
  check(`ten seconds of play run the field clock ${ran.map((r) => r.toFixed(1)).join(', ')} through the four seasons, and ${yearless.toFixed(1)} before the first spring`,
    SEASONS.every((s, i) => Math.abs(ran[i] - 10 * SEASON_GROWTH[s]) < 1e-9) && Math.abs(yearless - 10 * YEARLESS_GROWTH) < 1e-9);
  // In a winter: a field stands still, a planter grows.
  g.wallClock = () => moment('winter');
  const field = g.plantCrop(20, 20, 'mint', 40);
  const pot = g.addFurniture('planter', 21, 20, 0, 0, 40, [], 'Oak');
  const inPot = g.sowPlanter(pot, 'mint', 40);
  for (let i = 0; i < 40; i++) g.update(CROPS.mint.stageSeconds / 10);
  check('four stages of a winter: the field has not moved and the planter has come on one',
    field.stage === 0 && inPot.stage === 1, `field ${field.stage}, planter ${inPot.stage}`);
  // A night's sleep in summer is the night at summer's share.
  g.wallClock = () => moment('summer');
  const was = g.fieldTime;
  const slept = g.time;
  g.sleepUntilMorning(1, 'bed');
  check(`a night slept in summer runs the field clock on ${SEASON_GROWTH.summer} of the night`,
    Math.abs(g.fieldTime - was - (g.time - slept) * SEASON_GROWTH.summer) < 1e-6, `${(g.fieldTime - was).toFixed(1)} for ${(g.time - slept).toFixed(1)}`);
  // Kept in the save, and a save from before the year starts it at the game clock.
  const land = await packLand(g);
  const back = await unpack(land, JSON.parse(JSON.stringify(packWorld(g))));
  check('the field clock and what grows in planters come back from a save',
    !!back && back.fieldTime === g.fieldTime && back.planted.get(pot.id)?.stage === inPot.stage && back.planted.get(pot.id)?.planter === pot.id);
  const aged = await unpack(land, { ...(JSON.parse(JSON.stringify(packWorld(g))) as object), fieldTime: undefined });
  check('and a save from before the year starts it where the game clock stands, so nothing growing jumps', !!aged && aged.fieldTime === aged.time);
}

/* ---- the ground read lays the island's crops on the browser's clock ------------------------------ */

{
  const g = Game.create(1618);
  g.islandClock = () => 0;
  // In a winter, where the field clock stands still while this is asked.
  const islandNow = YEAR_FROM + 3 * SEASON_SECONDS + 2 * YEAR_DAY + 0.25;
  g.sawGround({
    placed: [], crates: [], now: islandNow,
    crops: [{ x: 5, y: 5, id: 'wheat', stage: 1, grown: 30, ago: 99999, tended: 1, tendedNow: false, ql: 40 }],
    planted: [{ planter: 7, x: 6, y: 5, id: 'mint', stage: 2, grown: 12, tended: 0, tendedNow: false, ql: 30 }],
  });
  const f = g.cropAt(5, 5);
  const p = g.planted.get(7);
  check('the island\'s clock is taken as it answered', Math.abs(g.wallNow() - islandNow) < 0.05, `${(g.wallNow() - islandNow).toFixed(3)}s off`);
  check('and a crop goes onto the field clock as far into its stage as the island has it grown, whatever wall seconds have passed',
    !!f && Math.abs(g.fieldNow() - f.stageAt - 30) < 1e-6 && Math.abs(fieldClock(g.wallNow()) - g.fieldNow()) < 1e-9, f ? `${g.fieldNow() - f.stageAt}` : 'no crop');
  // Its clock runs on while this is asked, a quarter second for every second of it.
  check('and a planter\'s onto the planter\'s clock', !!p && p.planter === 7 && p.x === 6 && Math.abs(g.planterNow() - p.stageAt - 12) < 0.01,
    p ? `${g.planterNow() - p.stageAt}` : 'no planter');
  check('an island from before the year, which said only the wall seconds, still lands where it did',
    (() => {
      g.sawGround({ placed: [], crates: [], crops: [{ x: 5, y: 5, id: 'wheat', stage: 1, ago: 30, tended: 0, tendedNow: false, ql: 40 }] });
      const c = g.cropAt(5, 5);
      return !!c && Math.abs(g.fieldNow() - c.stageAt - 30) < 1e-6;
    })());
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not the same on both sides`);
  process.exit(1);
}
console.log(`crops through the year — ${ok.length} of ${ok.length}`);
