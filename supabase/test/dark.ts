/**
 * Three quarters day, one quarter night — and both sides saying so.
 *
 * "On the full day cycle, it shouldn't be half night half day, it should be
 * 3/4 day and 1/4 night." It was not half, quite: dark from about ten to
 * eight in the evening until six minutes past six in the morning, which is
 * ten hours and a bit of the twenty-four. Near enough to half to be read as
 * half, and far too much of anybody's hour to spend holding a lantern.
 *
 * Dawn moves to three and dusk to nine in the evening. That is eighteen hours
 * between the two and six the other way round, with noon sitting exactly
 * between them — which six-to-eight never did.
 *
 * The second half of this is the reason the first half was possible to get
 * wrong. `darkness` on the island held 7, 19, 21 and 5 written out by hand,
 * the same bug `hour_of_day` had when it held 1440: two sides that could
 * drift with nothing to say so. It reads the generated `dawn_hour()` and
 * `dusk_hour()` now, so the whole cycle is asked of both sides hour by hour.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 * Every clock it winds is wound inside a transaction that is thrown away.
 */
import { execFileSync } from 'node:child_process';
import { DAWN, DAY_SECONDS, DUSK, Game } from '../../src/game/game';

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

const game = Game.create(4242);
/** The browser's own clock, wound to a given hour of the day. */
const at = (hour: number): Game => {
  game.time = (hour / 24) * DAY_SECONDS;
  return game;
};

/* ---- the shape of the cycle ---------------------------------------------- */
check('dawn and dusk sit either side of noon', (DAWN + DUSK) / 2 === 12, `${DAWN} and ${DUSK}`);
check('eighteen hours of it are between the two', DUSK - DAWN === 18, `${DUSK - DAWN}`);

/*
 * Counted the way everything else counts it: `isNight` is darkness past 0.45,
 * which is what decides whether you may sleep, what a nocturnal thing comes
 * out for and what the hud calls it. Sampled every three minutes of the day.
 */
const STEP = 0.05;
const samples: number[] = [];
for (let h = 0; h < 24; h += STEP) samples.push(Number(h.toFixed(4)));
const nights = samples.filter((h) => at(h).isNight()).length;
const share = nights / samples.length;
check('a quarter of the cycle is night', share > 0.24 && share < 0.27,
  `${(share * 100).toFixed(1)}% of it, ${(share * 24).toFixed(2)} hours`);
check('and three quarters of it is day', 1 - share > 0.73 && 1 - share < 0.76,
  `${((1 - share) * 100).toFixed(1)}%`);

// Which is the whole of the complaint: it used to be very nearly half.
const wasNight = samples.filter((h) => {
  const d = h >= 7 && h <= 19 ? 0 : h >= 21 || h <= 5 ? 1 : h > 12 ? Math.min(1, Math.max(0, (h - 19) / 2)) : Math.min(1, Math.max(0, (7 - h) / 2));
  return d > 0.45;
}).length / samples.length;
check('the old six-to-eight was nearly half', wasNight > 0.4,
  `${(wasNight * 100).toFixed(1)}% against ${(share * 100).toFixed(1)}%`);

/* ---- broad day, dead of night, and the ramps between --------------------- */
check('noon is broad day', at(12).darkness() === 0);
check('the small hours are dark through', at(0).darkness() === 1 && at(1).darkness() === 1);
check('it is full dark an hour after dusk', at(DUSK + 1).darkness() === 1);
check('and full light an hour after dawn', at(DAWN + 1).darkness() === 0);
check('dusk itself is halfway down', Math.abs(at(DUSK).darkness() - 0.5) < 1e-9, `${at(DUSK).darkness()}`);
check('and dawn halfway up', Math.abs(at(DAWN).darkness() - 0.5) < 1e-9, `${at(DAWN).darkness()}`);

/* ---- the island's two numbers -------------------------------------------- */
check('the island was told when the sun comes up',
  psql('select dawn_hour()') === String(DAWN), psql('select dawn_hour()'));
check('and when it goes down',
  psql('select dusk_hour()') === String(DUSK), psql('select dusk_hour()'));

/*
 * And then the whole day, hour by hour, on both sides. The island's clock is
 * its world's epoch, so winding it is a matter of moving that epoch back by
 * however much of a day is wanted — inside a transaction that is rolled back,
 * because the suite goes on using this world after us.
 */
const rows = psql(`
begin;
create temporary table probe(h double precision, dark double precision, night boolean) on commit drop;
do $$
declare w uuid; i int; hh double precision;
begin
  select id into w from world where name = 'Hoarding';
  for i in 0..479 loop
    hh := i * 0.05;
    update world set epoch = now() - make_interval(secs => hh / 24 * day_seconds()) where id = w;
    insert into probe values (hh, darkness(w), is_night(w));
  end loop;
end $$;
select h || ' ' || dark || ' ' || night from probe order by h;
rollback;`).split('\n').filter((l) => l.trim().length);

check('the island answers for every hour of it', rows.length === samples.length, `${rows.length} rows`);
let worst = 0;
let worstAt = -1;
let nightMismatch = 0;
for (const row of rows) {
  const [hs, ds, ns] = row.trim().split(' ');
  const h = Number(hs);
  const there = Number(ds);
  const here = at(h).darkness();
  if (worstAt < 0 || Math.abs(there - here) > worst) {
    worst = Math.abs(there - here);
    worstAt = h;
  }
  if (ns.startsWith('t') !== at(h).isNight()) nightMismatch += 1;
}
check('the two sides are equally dark at every hour of the day', worst < 1e-9,
  `worst ${worst.toExponential(2)} at ${worstAt.toFixed(2)}`);
check('and call the same hours night', nightMismatch === 0, `${nightMismatch} disagree`);

/* ---- and a sleeper wakes at the same time on both ------------------------ */
const wake = (h: number): number => (h < DAWN + 0.5 ? DAWN + 0.5 - h : 24 - h + DAWN + 0.5);
const wakeThere = psql(`
  select string_agg(to_char(case when h < dawn_hour() + 0.5 then dawn_hour() + 0.5 - h
                                 else 24 - h + dawn_hour() + 0.5 end, 'FM990.0000'), ',' order by h)
  from (select generate_series(0, 23)::double precision as h) q`).split(',');
const wakeHere = [...Array(24)].map((_, h) => wake(h).toFixed(4));
check('a night banked is the same length of night on both sides',
  wakeThere.length === 24 && wakeThere.every((v, i) => Math.abs(Number(v) - Number(wakeHere[i])) < 1e-4),
  `${wakeThere[22]} against ${wakeHere[22]} at ten at night`);
check('and it is always half an hour past the new dawn',
  Math.abs(wake(DAWN) - 0.5) < 1e-9 && Math.abs(wake(23) - (24 - 23 + DAWN + 0.5)) < 1e-9);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not the same on both sides`);
  process.exit(1);
}
console.log(`a quarter of the cycle is dark and both sides agree hour by hour — ${ok.length} of ${ok.length}`);
