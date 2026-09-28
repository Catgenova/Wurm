/**
 * Paths are worn where people walk, the same on both sides.
 *
 * Asked for: grass, lawn, steppe, tundra and moss wear where people walk; a
 * step into such a tile adds one to its wear, and at a threshold it becomes a
 * trail, which keeps what it was and is that again once its wear has fallen
 * back at the woods' turn. Paved, built, tilled or planted ground never wears.
 * On the island the count is taken where a body changes tile in `rpc_move`,
 * as one small write, and the fall at the woods' turn.
 *
 * So the same rows of ground are laid on both sides and walked on both --
 * through `rpc_move` on the island, frame by frame through the browser's own
 * body in a game of its own -- and this asks:
 *
 *   * the numbers are the same numbers, and a trail walks and rolls as packed
 *     dirt does and is dug, packed and paved as it should be;
 *   * a pass along a row puts one point of wear on every tile it steps into,
 *     on both sides, and nothing on dirt, on a building's ground, on a
 *     foundation or on a bridge's deck, nor a storey up or in the saddle;
 *   * the pass that brings a tile to the threshold makes it a trail keeping
 *     what it was, on both sides, and the island tells everybody;
 *   * a tile holds no more than the most, and a step at the most writes
 *     nothing at all;
 *   * the woods' turn takes the fall off every worn tile on both sides, puts
 *     a trail with none left back to what it was, forgets what has none, and
 *     tells everybody of the trails that went;
 *   * and what the walk costs `rpc_move`: nothing measurable on a call that
 *     stays in its tile, and a small keyed write on one that leaves it.
 *
 * Runs against the database the suite leaves behind: Faraway, and Ivar on it.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { TILE_DEFS, TileType, WEAR_FALL, WEAR_MOST, WEAR_TRAIL, WEARS, lastDawn } from '../../src/world/tiles';

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

const W = `(select id from world where name = 'Faraway')`;
const IVAR = `(select uid from player where world_id = ${W} and name = 'Ivar')`;

/* ---- the numbers ----------------------------------------------------------- */

const [iTrail, iMost, iFall] = psql(`select wear_trail()::int || ' ' || wear_most()::int || ' ' || wear_fall()::int`).split(' ').map(Number);
check('both sides wear a tile to a trail at the same wear, hold the same most, and take the same fall a day',
  iTrail === WEAR_TRAIL && iMost === WEAR_MOST && iFall === WEAR_FALL,
  `island ${iTrail}, ${iMost}, ${iFall}; browser ${WEAR_TRAIL}, ${WEAR_MOST}, ${WEAR_FALL}`);
const iWears = psql(`select string_agg(id::text, ',' order by id) from tile_def where wears`);
const bWears = [...WEARS].sort((a, b) => a - b).join(',');
check('and the same five grounds wear: grass, lawn, steppe, tundra and moss', iWears === bWears, `island ${iWears}, browser ${bWears}`);
const trail = TILE_DEFS[TileType.Trail];
const packed = TILE_DEFS[TileType.PackedDirt];
const iDef = psql(`select speed || '|' || coalesce(dig_yield, '-') || '|' || pavable || '|' || turns_to_dirt || '|' || packable(id) || '|' || exists (select 1 from buryable where tile = id)
  from tile_def where id = ${TileType.Trail}`);
check('a trail walks and rolls as packed dirt does, is dug for dirt, packs, is buried and takes paving, on both sides',
  trail.speed === packed.speed && trail.roll === packed.roll && iDef === `${packed.speed}|dirt|true|true|true|true`,
  `browser pace ${trail.speed} and roll ${trail.roll} against packed dirt's ${packed.speed} and ${packed.roll}; island ${iDef}`);

/* ---- the ground, on both sides ---------------------------------------------
 * Flat at four, rows 30 to 36 and x 5 to 22: one row of each ground that
 * wears, one of dirt, and one of grass with a building's ground on x 10, a
 * foundation on x 12 and a bridge's deck over x 14 and 15, its banks on x 13
 * and 16.
 */
const Y = { grass: 30, lawn: 31, steppe: 32, tundra: 33, moss: 34, dirt: 35, built: 36 } as const;
const KIND: Record<number, number> = {
  [Y.grass]: TileType.Grass, [Y.lawn]: TileType.Lawn, [Y.steppe]: TileType.Steppe, [Y.tundra]: TileType.Tundra,
  [Y.moss]: TileType.Moss, [Y.dirt]: TileType.Dirt, [Y.built]: TileType.Grass,
};
const X0 = 6;
const X1 = 20;
const ROWS = Object.values(Y);

const game = Game.create(4242);
const w = game.world;
const layBrowser = (): void => {
  for (let y = 28; y <= 38; y++) for (let x = 5; x <= 23; x++) w.setHeight(x, y, 4);
  for (const y of ROWS) for (let x = 5; x <= 22; x++) w.setTile(x, y, KIND[y] as TileType, 0);
  w.wear.clear();
};
layBrowser();
game.buildings.create('Wearless', 10, Y.built);
game.addFoundation(12, Y.built, 4, 0);
game.addBridge('wood', 13, Y.built, 16, Y.built, 30);

psql(`
do $$
declare w uuid; u uuid; gx int; gy int; v_b bigint;
begin
  select id into w from world where name = 'Faraway';
  select uid into u from player where world_id = w and name = 'Ivar';
  for gy in 28..38 loop for gx in 5..23 loop perform land_set_height(w, gx, gy, 4); end loop; end loop;
  ${ROWS.map((y) => `for gx in 5..22 loop perform land_set_tile(w, gx, ${y}, ${KIND[y]}); perform land_set_data(w, gx, ${y}, 0); end loop;`).join('\n  ')}
  delete from tile_wear where world_id = w;
  delete from building_tile where world_id = w and y between 28 and 38;
  delete from foundation where world_id = w and y between 28 and 38;
  delete from bridge_span where world_id = w and y between 28 and 38;
  delete from bridge where world_id = w and ay between 28 and 38;
  insert into building (world_id, id, name) values (w, 90210, 'Wearless') on conflict do nothing;
  insert into building_tile (world_id, building, x, y) values (w, 90210, 10, ${Y.built});
  insert into foundation (world_id, id, x, y, top, needed, total) values (w, 90210, 12, ${Y.built}, 4, '{}', '{}');
  insert into bridge (world_id, kind, ax, ay, bx, by, height) values (w, 'wood', 13, ${Y.built}, 16, ${Y.built}, 30)
    returning id into v_b;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    values (w, v_b, 0, 14, ${Y.built}, '{}', '{}'), (w, v_b, 1, 15, ${Y.built}, '{}', '{}');
  delete from tile_change where world_id = w;
  update creature set rider = null where world_id = w and rider = u;
  delete from placed where world_id = w and driver = u;
  update player set level = 0, aboard = null where world_id = w and uid = u;
end $$;`);

/* ---- walking ------------------------------------------------------------------ */

/**
 * A pass along a row on the island, through `rpc_move` as a browser sends it:
 * a call every half tile, each a second after the last, from the middle of
 * the tile before `X0` to the middle of `X1`, or back.
 */
const passIsland = (y: number, back = false, level = 0): string => {
  const calls: string[] = [];
  const from = back ? X1 + 0.5 : X0 - 0.5;
  const to = back ? X0 - 0.5 : X1 + 0.5;
  calls.push(`update player set x = ${from}, y = ${y + 0.5}, level = ${level}, moved_at = now() - interval '1 second', away = false
    where world_id = ${W} and uid = ${IVAR};`);
  const step = back ? -0.5 : 0.5;
  for (let x = from + step; back ? x >= to : x <= to; x += step) {
    calls.push(`update player set moved_at = now() - interval '1 second' where world_id = ${W} and uid = ${IVAR};
delete from caller where uid = ${IVAR};
select rpc_move(${W}, ${x}, ${y + 0.5}, ${level}) \\g /dev/null`);
  }
  return `select set_config('request.jwt.claims', json_build_object('sub', ${IVAR})::text, false) \\g /dev/null\n${calls.join('\n')}`;
};
/** The same pass in the browser: the body walked along the row a frame at a time. */
const passBrowser = (y: number, back = false): void => {
  const p = game.player;
  p.x = (back ? X1 : X0 - 1) + 0.5;
  p.y = y + 0.5;
  p.level = 0;
  const path: Array<{ x: number; y: number; level: number }> = [];
  if (back) for (let x = X1 - 1; x >= X0 - 1; x--) path.push({ x, y, level: 0 });
  else for (let x = X0; x <= X1; x++) path.push({ x, y, level: 0 });
  p.path = path;
  for (let i = 0; i < 2000 && p.path; i++) game.update(0.05);
};
const wearIsland = (y: number): string => psql(`select string_agg(coalesce((select tw.wear from tile_wear tw where tw.world_id = ${W} and tw.x = g.gx and tw.y = ${y}), 0)::text, ' ' order by g.gx)
  from generate_series(${X0 - 1}, ${X1 + 1}) g(gx)`);
const wearBrowser = (y: number): string => Array.from({ length: X1 - X0 + 3 }, (_, i) => w.wearAt(X0 - 1 + i, y)).join(' ');
const tilesIsland = (y: number): string => psql(`select string_agg(land_tile(${W}, x, ${y}) || ':' || land_data(${W}, x, ${y}), ' ' order by x) from generate_series(${X0 - 1}, ${X1 + 1}) x`);
const tilesBrowser = (y: number): string => Array.from({ length: X1 - X0 + 3 }, (_, i) => `${w.getTile(X0 - 1 + i, y)}:${w.getData(X0 - 1 + i, y)}`).join(' ');

// One pass along every row, both sides.
psql(ROWS.map((y) => passIsland(y)).join('\n'));
for (const y of ROWS) passBrowser(y);
const one = ROWS.map((y) => ({ y, island: wearIsland(y), browser: wearBrowser(y) }));
const expected = (y: number): string => Array.from({ length: X1 - X0 + 3 }, (_, i) => {
  const x = X0 - 1 + i;
  if (x === X0 - 1 || x === X1 + 1) return '0'; // where the walk started, and past where it stopped
  if (KIND[y] === TileType.Dirt) return '0';
  if (y === Y.built && (x === 10 || x === 12 || x === 14 || x === 15)) return '0';
  return '1';
}).join(' ');
check('a pass along each row puts a point on every tile it steps into, on both sides',
  one.every((r) => r.island === r.browser && r.island === expected(r.y)),
  one.map((r) => `row ${r.y}: island ${r.island} | browser ${r.browser}`).join('; '));
check('and nothing on dirt, a building\'s ground, a foundation or a bridge\'s deck -- and a bridge\'s banks are ground',
  wearIsland(Y.dirt).split(' ').every((v) => v === '0') && ['10', '12', '14', '15'].every((x) => wearIsland(Y.built).split(' ')[Number(x) - X0 + 1] === '0')
  && ['13', '16'].every((x) => wearIsland(Y.built).split(' ')[Number(x) - X0 + 1] === '1'),
  `dirt ${wearIsland(Y.dirt)}; built ${wearIsland(Y.built)}`);

// A storey up, and in the saddle: nothing.
const beforeStorey = wearIsland(Y.grass);
psql(passIsland(Y.grass, false, 1));
const storey = wearIsland(Y.grass);
psql(`update player set level = 0 where world_id = ${W} and uid = ${IVAR};
do $$
declare w uuid; u uuid; c int;
begin
  select id into w from world where name = 'Faraway';
  select uid into u from player where world_id = w and name = 'Ivar';
  c := creature_spawn(w, 'rabba', ${X0 - 0.5}, ${Y.grass + 0.5}, 'active', now() - interval '3 days', u);
  update creature set rider = u where world_id = w and id = c;
end $$;`);
psql(passIsland(Y.grass));
const ridden = wearIsland(Y.grass);
psql(`delete from creature where world_id = ${W} and rider = ${IVAR};`);
check('a pass a storey up, or in the saddle, wears nothing: only feet on the ground do',
  storey === beforeStorey && ridden === beforeStorey, `before ${beforeStorey}; a storey up ${storey}; ridden ${ridden}`);

/* ---- to a trail ----------------------------------------------------------------- */

// Back and forth until every walked tile has had the threshold.
for (let k = 1; k < WEAR_TRAIL; k++) {
  psql(ROWS.map((y) => passIsland(y, k % 2 === 1)).join('\n'));
  for (const y of ROWS) passBrowser(y, k % 2 === 1);
}
const worn = ROWS.map((y) => ({ y, island: tilesIsland(y), browser: tilesBrowser(y), iw: wearIsland(y), bw: wearBrowser(y) }));
/*
 * Four there and four back: every tile between the two ends is stepped into
 * both ways, eight times; the two ends only one way, four; and past the far
 * end, never.
 */
const trailRow = (y: number): string => Array.from({ length: X1 - X0 + 3 }, (_, i) => {
  const x = X0 - 1 + i;
  const k = KIND[y];
  const between = x >= X0 && x < X1 && k !== TileType.Dirt && !(y === Y.built && [10, 12, 14, 15].includes(x));
  return between ? `${TileType.Trail}:${k}` : `${k}:0`;
}).join(' ');
check(`the pass that brings a tile to ${WEAR_TRAIL} makes it a trail that keeps what it was, on both sides`,
  worn.every((r) => r.island === r.browser),
  worn.map((r) => `row ${r.y}: island ${r.island} | browser ${r.browser}`).join('; '));
check('every walked tile of the five grounds, and nothing else',
  worn.every((r) => r.island === trailRow(r.y)), worn.map((r) => `row ${r.y}: ${r.island} against ${trailRow(r.y)}`).join('; '));
check('and the wear on both sides is the same, tile for tile', worn.every((r) => r.iw === r.bw),
  worn.map((r) => `row ${r.y}: island ${r.iw} | browser ${r.bw}`).join('; '));
const told = psql(`select count(*) || '|' || count(*) filter (where tile = ${TileType.Trail}) from tile_change where world_id = ${W} and y between 30 and 36`);
const trails = worn.reduce((n, r) => n + r.island.split(' ').filter((t) => t.startsWith(`${TileType.Trail}:`)).length, 0);
check('and the island tells everybody of every trail as it forms, once', told === `${trails}|${trails}`, `${told} rows for ${trails} trails`);

// Past the most, nothing is written.
for (let k = WEAR_TRAIL; k < WEAR_MOST + 2; k++) {
  psql(passIsland(Y.grass, k % 2 === 1));
  passBrowser(Y.grass, k % 2 === 1);
}
const capped = { island: wearIsland(Y.grass), browser: wearBrowser(Y.grass) };
check(`a tile holds no more than ${WEAR_MOST}, on both sides`, capped.island === capped.browser && capped.island.split(' ').every((v) => Number(v) <= WEAR_MOST)
  && capped.island.split(' ').filter((v) => v === String(WEAR_MOST)).length === X1 - X0, `island ${capped.island} | browser ${capped.browser}`);
const xmin = (): string => psql(`select string_agg(xmin::text, ',' order by x) from tile_wear where world_id = ${W} and y = ${Y.grass} and wear = ${WEAR_MOST}`);
const was = xmin();
psql(passIsland(Y.grass));
check('and a step onto a tile at the most writes nothing at all', xmin() === was, `row versions ${was} and then ${xmin()}`);

/* ---- the woods' turn --------------------------------------------------------------
 * Four tiles of the lawn row set by hand on both sides: a trail with one
 * point left, a trail with five, a tile of lawn with one and one with three.
 */
const setDay = [[7, 1, true], [8, 5, true], [9, 1, false], [11, 3, false]] as const;
psql(`
do $$
declare w uuid;
begin
  select id into w from world where name = 'Faraway';
  ${setDay.map(([x, v, t]) => `perform land_set_tile(w, ${x}, ${Y.lawn}, ${t ? TileType.Trail : TileType.Lawn}); perform land_set_data(w, ${x}, ${Y.lawn}, ${t ? TileType.Lawn : 0});
  insert into tile_wear (world_id, x, y, wear) values (w, ${x}, ${Y.lawn}, ${v}) on conflict (world_id, x, y) do update set wear = excluded.wear;`).join('\n  ')}
  delete from tile_change where world_id = w;
  update player set away = true where world_id = w;
  update world set trees_at = now() - interval '1 second' where id = w;
  perform tree_day(w);
  update player set away = false where world_id = w;
end $$;`);
for (const [x, v, t] of setDay) {
  w.setTile(x, Y.lawn, t ? TileType.Trail : TileType.Lawn, t ? TileType.Lawn : 0);
  w.wear.set(Y.lawn * w.w + x, v);
}
{
  const now = Date.now() / 1000;
  game.treesAt = lastDawn(now) - 1;
  for (let k = 0; k < 100000 && game.treesAt < lastDawn(now); k++) game.growTrees(now);
}
const dayIsland = setDay.map(([x]) => `${psql(`select land_tile(${W}, ${x}, ${Y.lawn}) || ':' || land_data(${W}, ${x}, ${Y.lawn}) || ':' || coalesce((select wear from tile_wear where world_id = ${W} and x = ${x} and y = ${Y.lawn}), 0)`)}`).join(' ');
const dayBrowser = setDay.map(([x]) => `${w.getTile(x, Y.lawn)}:${w.getData(x, Y.lawn)}:${w.wearAt(x, Y.lawn)}`).join(' ');
const dayWant = `${TileType.Lawn}:0:0 ${TileType.Trail}:${TileType.Lawn}:${5 - WEAR_FALL} ${TileType.Lawn}:0:0 ${TileType.Lawn}:0:${3 - WEAR_FALL}`;
check(`the woods' turn takes ${WEAR_FALL} off every worn tile and puts a trail with none left back to what it was, on both sides`,
  dayIsland === dayBrowser && dayIsland === dayWant, `island ${dayIsland} | browser ${dayBrowser} | wanted ${dayWant}`);
const dayTold = psql(`select string_agg(x || ':' || tile || ':' || data, ' ' order by x) from tile_change where world_id = ${W} and y = ${Y.lawn}`);
check('and tells everybody of the trail that went, with nobody about to see it', dayTold === `7:${TileType.Lawn}:0`, dayTold);
check('and forgets a tile with no wear left', psql(`select count(*) from tile_wear where world_id = ${W} and y = ${Y.lawn} and x in (7, 9)`) === '0'
  && !w.wear.has(Y.lawn * w.w + 7) && !w.wear.has(Y.lawn * w.w + 9));

/* ---- what the walk costs ----------------------------------------------------------
 * What the wear adds to `rpc_move` is `wear_walk`, called only when the walk
 * left the tile it started in. Timed on its own, three hundred goes, best of
 * three: a step into grass that wears (one keyed row written), a step into a
 * tile already at the most (a row read and nothing written) and a step into
 * dirt (nothing looked up past the ground). And `rpc_move` itself, staying in
 * its tile and stepping into grass, to set it beside.
 */
const guard = psql(`select pg_get_functiondef('public.rpc_move(uuid, double precision, double precision, integer)'::regprocedure)
  like '%if floor(p_x) <> floor(p.x) or floor(p_y) <> floor(p.y) then%perform wear_walk(%'`);
check('rpc_move asks after wear only when the walk has left the tile it started in', guard === 't');
const cost = psql(`
begin;
select set_config('request.jwt.claims', json_build_object('sub', ${IVAR})::text, true) \\g /dev/null
create function pg_temp.t(p_what text, p_n int) returns double precision language plpgsql as $f$
declare w uuid; u uuid; t0 timestamptz; i int; r int; took double precision; best double precision := 1e9;
begin
  select id into w from world where name = 'Faraway';
  select uid into u from player where world_id = w and name = 'Ivar';
  perform land_set_tile(w, 22, ${Y.grass}, ${TileType.Grass}); perform land_set_tile(w, 22, ${Y.dirt}, ${TileType.Dirt});
  for r in 1..3 loop
    took := 0;
    for i in 1..p_n loop
      update player set x = 21.2, y = ${Y.grass + 0.5}, moved_at = now() - interval '1 second' where world_id = w and uid = u;
      delete from tile_wear where world_id = w and x = 22 and y = ${Y.grass};
      if p_what = 'cap' then insert into tile_wear (world_id, x, y, wear) values (w, 22, ${Y.grass}, ${WEAR_MOST}); end if;
      delete from caller where uid = u;
      t0 := clock_timestamp();
      if p_what = 'grass' or p_what = 'cap' then perform wear_walk(w, 21.2, ${Y.grass + 0.5}, 22.2, ${Y.grass + 0.5});
      elsif p_what = 'dirt' then perform wear_walk(w, 21.2, ${Y.dirt + 0.5}, 22.2, ${Y.dirt + 0.5});
      elsif p_what = 'stay' then perform rpc_move(w, 21.5, ${Y.grass + 0.5}, 0);
      else perform rpc_move(w, 22.2, ${Y.grass + 0.5}, 0);
      end if;
      took := took + extract(epoch from clock_timestamp() - t0);
    end loop;
    best := least(best, took / p_n * 1000);
  end loop;
  return best;
end $f$;
select pg_temp.t('grass', 300) || '|' || pg_temp.t('cap', 300) || '|' || pg_temp.t('dirt', 300)
  || '|' || pg_temp.t('stay', 300) || '|' || pg_temp.t('step', 300);
rollback;`).split('\n').pop() ?? '';
const [cGrass, cCap, cDirt, cStay, cStep] = cost.split('|').map(Number);
check('and then it costs a fraction of a millisecond a tile stepped into: one keyed row where the ground wears, a read where it is at the most, less where it never wears',
  cGrass < 1 && cCap < 1 && cDirt < 1,
  `${cGrass.toFixed(3)} ms into grass, ${cCap.toFixed(3)} ms into a tile at the most, ${cDirt.toFixed(3)} ms into dirt; `
    + `rpc_move itself ${cStay.toFixed(3)} ms staying in its tile and ${cStep.toFixed(3)} ms stepping into grass`);
console.log(`COST wear_walk grass ${cGrass.toFixed(3)} cap ${cCap.toFixed(3)} dirt ${cDirt.toFixed(3)}; rpc_move stay ${cStay.toFixed(3)} step ${cStep.toFixed(3)}`);

// And the ground put back as the rows were, for whatever runs after.
psql(`
do $$
declare w uuid;
begin
  select id into w from world where name = 'Faraway';
  ${ROWS.map((y) => `perform land_set_tile(w, gx, ${y}, tile_id('Grass')) from generate_series(5, 22) gx; perform land_set_data(w, gx, ${y}, 0) from generate_series(5, 22) gx;`).join('\n  ')}
  delete from tile_wear where world_id = w;
  delete from building_tile where world_id = w and building = 90210;
  delete from building where world_id = w and id = 90210;
  delete from foundation where world_id = w and id = 90210;
  delete from bridge_span where world_id = w and y between 28 and 38;
  delete from bridge where world_id = w and ay between 28 and 38;
end $$;`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`paths are worn where people walk, the same on both sides — ${ok.length} of ${ok.length}`);
