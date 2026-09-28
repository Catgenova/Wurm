/**
 * The island's year is the same year on both sides.
 *
 * The browser works the season out for itself (`seasonAt`, src/world/calendar.ts)
 * and the island does the same (`season_at`, `season_day_at`): wildflowers,
 * blossom and whatever else comes and goes with the year have to be there on
 * the page when the island says they are. So both are asked about the same
 * moments — every six hours for half a year either side of the first spring,
 * and a second either side of each dawn the seasons turn at — and held to
 * each other.
 */
import { execFileSync } from 'node:child_process';
import { SEASON_DAYS, SEASONS, YEAR_DAYS, YEAR_FROM, seasonAt } from '../../src/world/calendar';
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

const HOUR = 3600;
const DAY = 24 * HOUR;
/** Every six hours from half a year before the first spring to half a year after it. */
const moments: number[] = [];
for (let t = YEAR_FROM - 182 * DAY; t <= YEAR_FROM + 182 * DAY; t += 6 * HOUR) moments.push(t);
/** And a second either side of every dawn a season turns at, across two years. */
const turns: number[] = [];
for (let d = -YEAR_DAYS; d <= 2 * YEAR_DAYS; d += SEASON_DAYS) turns.push(YEAR_FROM + d * DAY - 1, YEAR_FROM + d * DAY);
const all = [...moments, ...turns];

const island = psql(`
select string_agg(season_at(to_timestamp(t)) || ':' || season_day_at(to_timestamp(t)), ',' order by i)
  from unnest(array[${all.join(',')}]::double precision[]) with ordinality as m(t, i);
`).split(',');

let same = 0;
const differ: string[] = [];
all.forEach((t, i) => {
  const mine = seasonAt(t);
  const theirs = island[i] ?? '';
  if (`${mine.season}:${mine.day}` === theirs) same++;
  else if (differ.length < 5) differ.push(`${new Date(t * 1000).toISOString()}: ${mine.season} ${mine.day} against ${theirs}`);
});
check(`the two sides give the same season and day at ${all.length} moments`, same === all.length, differ.join('; ') || `${same} of ${all.length}`);

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
  const s = seasonAt(YEAR_FROM + d * DAY + HOUR);
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
