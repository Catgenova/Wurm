/**
 * What it costs the island to put its wildlife out.
 *
 * "Something is severely delaying server responses." It was this, and the
 * number at the bottom of it was one somebody had asked me to change: the
 * wildlife went from one head to a thirty-two tile square to three, because
 * the country between settlements read as empty, which was fair. What nobody
 * looked at — the actual mistake — is that trebling the density trebles the
 * work of *placing* them, and that work happens inside `rpc_move`, which is
 * the call a walking browser makes constantly.
 *
 * `creature_stock_block` throws darts at a two-hundred-and-fifty-six tile
 * square until the square holds what it is owed, giving up after twelve
 * throws a head. An eighth of this island is ground anything can stand on, so
 * seven throws in eight miss. Measured on Bigness, one block, in the walk
 * call: seven seconds of server at three a region against one and a half at
 * one.
 *
 * So the two things worth holding are held here. The density, because it is a
 * number two sides have to agree on and one of them is generated from the
 * other. And the cost, because that is the thing that actually broke and
 * nothing anywhere would have said a word about it — a constant changed in
 * TypeScript and a server five times slower, with every test still green.
 *
 * The clock bound is deliberately loose. It is not there to measure a machine,
 * it is there to catch the next five-fold.
 *
 * Runs against the database the suite leaves behind.
 */
import { PER_REGION, wildTargetFor } from '../../src/game/creatures';
import { execFileSync } from 'node:child_process';

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

/**
 * A block is allowed this long to put its head out, in milliseconds.
 *
 * Loose on purpose, and not the thing doing the work. The cost here is linear
 * in the density, so the assertions above — that both sides hold the same head
 * to a square, and that a block is owed sixty-four of them — are what would
 * actually catch somebody trebling it again; they are exact and they do not
 * care what machine they are on. Two runs of this on the same machine came
 * back 1,430 ms and 2,256 ms, which is all a clock is worth here. This is a
 * backstop against an order of magnitude, nothing finer.
 */
const BUDGET = 8000;

/* ---- the density, which both sides have to say the same number for ------- */
check('both sides hold the same head to a stretch of country',
  PER_REGION === Number(psql('select wild_per_region()')),
  `${PER_REGION} here, ${psql('select wild_per_region()')} there`);

const size = 4096;
const mine = wildTargetFor(size, size);
const theirs = Number(psql(`select creature_target(id) from world where name = 'Bigness'`));
check('and add up to the same island', mine === theirs, `${mine} here, ${theirs} there`);
check('which is a head to every thirty-two tile square', mine === (size / 32) * (size / 32) * PER_REGION,
  `${mine} over ${(size / 32) * (size / 32)} squares`);

/* ---- and what it costs to put one square of it out ----------------------- */
const owed = 8 * 8 * PER_REGION;
check('a two-hundred-and-fifty-six tile block is owed what its squares are owed', owed === 64,
  `${owed} head`);

/*
 * The landing block, which is certainly land, timed as `rpc_move` would run
 * it: emptied of wildlife first so the whole shortfall is thrown for, which is
 * the worst this can be.
 */
const timed = psql(`
create temporary table cost (head int, ms int);
do $$
declare w uuid; t0 timestamptz; n int; sx int; sy int; ms int;
begin
  select id, spawn_x, spawn_y into w, sx, sy from world where name = 'Bigness';
  delete from world_stocked where world_id = w;
  delete from creature where world_id = w and mode = 'wild';
  t0 := clock_timestamp();
  n := creature_stock_block(w, floor(sx / 256.0)::int, floor(sy / 256.0)::int);
  ms := round(extract(epoch from (clock_timestamp() - t0)) * 1000);
  insert into cost values (n, ms);
end $$;
select head || ' ' || ms from cost;`).trim().split(/\s+/);
const head = Number(timed[0]);
const ms = Number(timed[1]);
check('the landing block puts out the head it is owed', head === owed, `${head} of ${owed}`);
check('and does it inside the budget the walk call can afford', ms < BUDGET,
  `${ms} ms against ${BUDGET}`);

/*
 * And open sea, which is the case that costs the most for nothing: every throw
 * lands in the water, the whole budget of throws is spent, and no head comes
 * of it. It is a third of the block above and it used to be as long again.
 */
const dry = psql(`
create temporary table seacost (head int, ms int);
do $$
declare w uuid; t0 timestamptz; n int; ms int;
begin
  select id into w from world where name = 'Bigness';
  delete from world_stocked where world_id = w and bx = 4 and by = 4;
  t0 := clock_timestamp();
  n := creature_stock_block(w, 4, 4);
  ms := round(extract(epoch from (clock_timestamp() - t0)) * 1000);
  insert into seacost values (n, ms);
end $$;
select head || ' ' || ms from seacost;`).trim().split(/\s+/);
check('a block of open sea puts out nothing', Number(dry[0]) === 0, `${dry[0]} head`);
check('and spends less than the budget finding that out', Number(dry[1]) < BUDGET,
  `${dry[1]} ms against ${BUDGET}`);

/*
 * And it is looked at once rather than on every step: the block is stamped on
 * the way in, so the walk call after this one costs a single indexed read.
 */
const again = psql(`
create temporary table twice (ms int);
do $$
declare w uuid; t0 timestamptz; ms int;
begin
  select id into w from world where name = 'Bigness';
  t0 := clock_timestamp();
  perform creature_stock_near(w, 4 * 256 + 128, 4 * 256 + 128);
  ms := round(extract(epoch from (clock_timestamp() - t0)) * 1000);
  insert into twice values (ms);
end $$;
select ms from twice;`).trim();
check('walking on through a block already put out costs nothing', Number(again) < 50, `${again} ms`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the wildlife goes out at a price the walk call can pay — ${ok.length} of ${ok.length}`);
