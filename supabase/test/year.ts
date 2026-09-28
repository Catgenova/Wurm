/**
 * The island's year is the same year on both sides.
 *
 * The browser works the season out for itself (`seasonAt`, src/world/calendar.ts)
 * and the island does the same (`season_at`, `season_day_at`, `year_of`,
 * `season_began`): wildflowers, blossom and whatever else comes and goes with
 * the year have to be there on the page when the island says they are. So
 * both are asked about the same moments — every quarter of a day for half a
 * year either side of the first spring, a second either side of every day's
 * turn for a year either side of it and of every season's turn for three
 * years, and two thousand moments at random — and held to each other. A day
 * of the year is a day and night of the island's clock (`DAY_SECONDS`, the
 * island's `day_seconds()`), and a season thirty of them.
 */
import { execFileSync } from 'node:child_process';
import { DAY_SECONDS } from '../../src/game/pace';
import { SEASON_DAYS, SEASONS, YEAR_DAYS, YEAR_FROM, seasonAt, seasonBegan, yearOf } from '../../src/world/calendar';
import { TREE_DAWN_UTC } from '../../src/world/tiles';

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

/** A day of the year: one of the island's days and nights. */
const DAY = DAY_SECONDS;
/** Rolls that are the same rolls every run. */
let state = 0x5eed1e5;
const rnd = (): number => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** Every quarter of a day from half a year before the first spring to half a year after it. */
const moments: number[] = [];
for (let t = YEAR_FROM - (YEAR_DAYS / 2) * DAY; t <= YEAR_FROM + (YEAR_DAYS / 2) * DAY; t += DAY / 4) moments.push(t);
/** A second either side of every day's turn for a year either side of the first spring, and of every season's across three years. */
const turns: number[] = [];
for (let d = -YEAR_DAYS; d <= YEAR_DAYS; d++) turns.push(YEAR_FROM + d * DAY - 1, YEAR_FROM + d * DAY);
for (let d = -YEAR_DAYS; d <= 2 * YEAR_DAYS; d += SEASON_DAYS) turns.push(YEAR_FROM + d * DAY - 1, YEAR_FROM + d * DAY);
/** And moments at random, to the second, from a year before the first spring to four years after it. */
const random: number[] = [];
for (let i = 0; i < 2000; i++) random.push(YEAR_FROM - YEAR_DAYS * DAY + Math.floor(rnd() * 5 * YEAR_DAYS * DAY));
const all = [...moments, ...turns, ...random];

const island = psql(`
select string_agg(season_at(to_timestamp(t)) || ':' || season_day_at(to_timestamp(t)) || ':' || year_of(to_timestamp(t))
                  || ':' || extract(epoch from season_began(to_timestamp(t)))::bigint, ',' order by i)
  from unnest(array[${all.join(',')}]::double precision[]) with ordinality as m(t, i);
`).split(',');

let same = 0;
const differ: string[] = [];
all.forEach((t, i) => {
  const mine = seasonAt(t);
  const line = `${mine.season}:${mine.day}:${yearOf(t)}:${seasonBegan(t)}`;
  const theirs = island[i] ?? '';
  if (line === theirs) same++;
  else if (differ.length < 5) differ.push(`${new Date(t * 1000).toISOString()}: ${line} against ${theirs}`);
});
check(`the two sides give the same season, day, year and season's first dawn at ${all.length} moments`, same === all.length, differ.join('; ') || `${same} of ${all.length}`);

// The island counts in the browser's lengths, which come over with the definitions.
const lengths = psql(`select day_seconds() || ':' || season_days() || ':' || year_days()`);
check(`a day of the year is ${DAY_SECONDS} seconds on both sides, a season ${SEASON_DAYS} of them and a year ${YEAR_DAYS}`,
  lengths === `${DAY_SECONDS}:${SEASON_DAYS}:${YEAR_DAYS}`, lengths);

// The first spring begins at the woods' dawn, and the second before it is the last of a winter.
const first = seasonAt(YEAR_FROM);
const before = seasonAt(YEAR_FROM - 1);
check(`the first spring's first day begins at ${TREE_DAWN_UTC}:00 UTC on the day it was set for`,
  first.season === 'spring' && first.day === 1 && new Date(YEAR_FROM * 1000).getUTCHours() === TREE_DAWN_UTC,
  `${first.season} ${first.day} at ${new Date(YEAR_FROM * 1000).toISOString()}`);
check(`and the second before it is the last day of a winter`, before.season === 'winter' && before.day === SEASON_DAYS, `${before.season} ${before.day}`);

// Round the year: each season in turn, each for its days, and back to spring.
const walk: string[] = [];
for (let d = 0; d <= YEAR_DAYS; d++) {
  const s = seasonAt(YEAR_FROM + d * DAY + DAY / 2);
  walk.push(`${s.season[0]}${s.day}`);
}
const expected = [...SEASONS.flatMap((s) => Array.from({ length: SEASON_DAYS }, (_, k) => `${s[0]}${k + 1}`)), 's1'];
check(`round the year, ${SEASON_DAYS} days to a season and back to spring`, walk.join(' ') === expected.join(' '), walk.join(' '));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the island's year — ${ok.length} of ${ok.length}`);
