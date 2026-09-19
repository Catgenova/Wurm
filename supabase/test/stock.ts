/**
 * Who pays for the wildlife, and what it costs them.
 *
 * "Something is severely delaying server responses." It was this. A block of
 * country is stocked the first time anybody walks into it, and that used to
 * happen inside `rpc_move` — the call a walking browser makes constantly —
 * so the walker stood still for a second and a half while it happened. Worse
 * than the standing still: PostgREST answers eight at a time, so three people
 * crossing fresh country held three of those eight, and everything else the
 * island was asked queued behind them.
 *
 * It lives on a clock of its own now, and this holds the three things that
 * have to stay true about that.
 *
 * **The walk call must not stock.** Proved by walking thirty steps across a
 * block that has never been stocked and finding it still empty afterwards.
 * This is the assertion that actually matters: it is exact, it does not care
 * what machine it runs on, and it is the one that fails if anybody ever puts
 * `creature_stock_near` back on a request path.
 *
 * **The clock must stock.** Proved by turning it once and finding the same
 * block full.
 *
 * **And it must look ahead**, because a clock that only stocked the block
 * underfoot would be the walk call again with extra steps — it would still be
 * putting country out because somebody had arrived rather than before.
 *
 * The density is kept here too, because it is a number two sides have to
 * agree on and one of them is generated from the other, and the clock bound
 * because a constant changed in TypeScript once made the server five times
 * slower with every test still green.
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
 * A block is allowed this long to put its head out, in milliseconds, and a
 * walk call this long to make plainly clear it is not doing the stocking.
 *
 * Both loose on purpose. The cost of a block is linear in the density, so the
 * exact assertions — that both sides hold the same head to a square, that a
 * block is owed sixty-four, and above all that the walk leaves the country
 * empty — are what would catch somebody trebling it again. These are
 * backstops against an order of magnitude, nothing finer.
 */
const BUDGET = 8000;
const WALK_BUDGET = 2000;

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

const owed = 8 * 8 * PER_REGION;
check('a two-hundred-and-fifty-six tile block is owed what its squares are owed', owed === 64,
  `${owed} head`);

/* ---- the walk call does not stock, which is the whole point of this ------ */
/*
 * A body is put on a block that has never been put out, and walked thirty
 * steps across it. Nothing may appear. The block chosen is the one the spawn
 * is in, emptied first, because it is certainly land — a block of sea would
 * pass this test by being sea.
 */
const walked = psql(`
create temporary table walkcost (head int, ms int, moved boolean);
do $$
declare w uuid; u uuid; t0 timestamptz; i int; sx int; sy int; v_bx int; v_by int;
        n int; ms int; x0 double precision; y0 double precision; p player;
begin
  select id, spawn_x, spawn_y into w, sx, sy from world where name = 'Bigness';
  v_bx := floor(sx / 256.0)::int; v_by := floor(sy / 256.0)::int;
  delete from world_stocked where world_id = w and world_stocked.bx = v_bx and world_stocked.by = v_by;
  delete from creature where world_id = w and mode = 'wild'
    and to_x >= v_bx * 256 and to_x < v_bx * 256 + 256
    and to_y >= v_by * 256 and to_y < v_by * 256 + 256;
  select uid into u from player where world_id = w order by uid limit 1;
  -- One body on the island, so that "the block underfoot" means one block.
  -- The clock walks the live bodies in the order they stand in, so leaving the
  -- suite's other fixtures afoot would spend the round's one block on whoever
  -- happened to be furthest west.
  update player set away = true where world_id = w and uid <> u;
  update player set x = sx + 0.5, y = sy + 0.5, away = false, seen_at = now(),
         act = null, act_ends = null, act_queue = '[]'::jsonb
    where world_id = w and uid = u;
  delete from caller where uid = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
  x0 := sx + 0.5; y0 := sy + 0.5;
  t0 := clock_timestamp();
  for i in 1..30 loop
    perform rpc_move(w, x0 + i * 0.3, y0 + i * 0.2, 0);
  end loop;
  ms := round(extract(epoch from (clock_timestamp() - t0)) * 1000);
  select count(*) into n from creature
   where world_id = w and mode = 'wild'
     and to_x >= v_bx * 256 and to_x < v_bx * 256 + 256
     and to_y >= v_by * 256 and to_y < v_by * 256 + 256;
  select * into p from player where world_id = w and uid = u;
  insert into walkcost values (n, ms, p.x > x0);
end $$;
select head || ' ' || ms || ' ' || moved from walkcost;`).trim().split(/\s+/);
check('thirty steps across country never stocked put out nothing at all',
  Number(walked[0]) === 0, `${walked[0]} head appeared`);
check('and the body did actually walk, so that nought means something',
  walked[2].startsWith('t'));
check('and the whole walk cost less than one block used to',
  Number(walked[1]) < WALK_BUDGET, `${walked[1]} ms for thirty steps`);

/* ---- and the clock does stock ------------------------------------------- */
/*
 * The islands take turns, oldest stamp first, so this puts Bigness at the
 * front of the queue rather than hoping it is there. That rotation is the
 * point of the stamp: with one block to a round, an island that never came up
 * would never be stocked at all.
 */
const turned = psql(`
create temporary table turn (head int, ms int, blocks int);
do $$
declare w uuid; t0 timestamptz; n int; ms int; sx int; sy int; v_bx int; v_by int; r jsonb;
begin
  select id, spawn_x, spawn_y into w, sx, sy from world where name = 'Bigness';
  v_bx := floor(sx / 256.0)::int; v_by := floor(sy / 256.0)::int;
  update world set stocked_at = now() - interval '1 day' where id = w;
  t0 := clock_timestamp();
  r := stock_tick();
  ms := round(extract(epoch from (clock_timestamp() - t0)) * 1000);
  select count(*) into n from creature
   where world_id = w and mode = 'wild'
     and to_x >= v_bx * 256 and to_x < v_bx * 256 + 256
     and to_y >= v_by * 256 and to_y < v_by * 256 + 256;
  insert into turn values (n, ms, (r->>'blocks')::int);
end $$;
select head || ' ' || ms || ' ' || blocks from turn;`).trim().split(/\s+/);
check('one turn of the clock puts the block underfoot out', Number(turned[0]) > 0,
  `${turned[0]} head`);
check('and does it inside the budget a clock of its own can afford', Number(turned[1]) < BUDGET,
  `${turned[1]} ms against ${BUDGET}`);
check('and does no more blocks in a round than a round is allowed',
  Number(turned[2]) <= Number(psql('select stock_a_round()')),
  `${turned[2]} blocks, ${psql('select stock_a_round()')} allowed`);

/* ---- and it looks ahead of the walker ----------------------------------- */
/*
 * Turned enough times to fill the ring. What is being asked is whether blocks
 * nobody has set foot in get put out at all — a clock that only did the one
 * underfoot would be the walk call again, just later.
 */
const ahead = psql(`
do $$ declare i int; w uuid;
begin
  select id into w from world where name = 'Bigness';
  for i in 1..12 loop
    -- Bigness to the front of the queue each turn, so this measures the ring
    -- filling rather than how many other islands happen to be live.
    update world set stocked_at = now() - interval '1 day' where id = w;
    perform stock_tick();
  end loop;
end $$;
select count(*) from world_stocked s, world w
 where w.name = 'Bigness' and s.world_id = w.id
   and s.bx between floor(w.spawn_x / 256.0)::int - 1 and floor(w.spawn_x / 256.0)::int + 1
   and s.by between floor(w.spawn_y / 256.0)::int - 1 and floor(w.spawn_y / 256.0)::int + 1;`).trim();
check('and goes on to put out the country round about, before anybody is in it',
  Number(ahead) > 1, `${ahead} of the 9 blocks round the body`);

/* ---- open sea, the case that costs most for nothing ---------------------- */
const dry = psql(`
create temporary table seacost (head int, ms int);
do $$
declare w uuid; t0 timestamptz; n int; ms int;
begin
  select id into w from world where name = 'Bigness';
  delete from world_stocked where world_id = w and bx = 0 and by = 0;
  t0 := clock_timestamp();
  n := creature_stock_block(w, 0, 0);
  ms := round(extract(epoch from (clock_timestamp() - t0)) * 1000);
  insert into seacost values (n, ms);
end $$;
select head || ' ' || ms from seacost;`).trim().split(/\s+/);
check('a block of open sea puts out nothing', Number(dry[0]) === 0, `${dry[0]} head`);
check('and spends less than the budget finding that out', Number(dry[1]) < BUDGET,
  `${dry[1]} ms against ${BUDGET}`);

/* ---- and a block already out is a single indexed read -------------------- */
const again = psql(`
create temporary table twice (ms int);
do $$
declare w uuid; t0 timestamptz; ms int;
begin
  select id into w from world where name = 'Bigness';
  t0 := clock_timestamp();
  perform stock_due(w, 0, 0);
  ms := round(extract(epoch from (clock_timestamp() - t0)) * 1000);
  insert into twice values (ms);
end $$;
select ms from twice;`).trim();
check('asking after a block already put out costs nothing', Number(again) < 50, `${again} ms`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the wildlife goes out on a clock, and nobody waits for it — ${ok.length} of ${ok.length}`);
