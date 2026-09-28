/**
 * Wildflowers grow in the same drifts on both sides, and are picked the same.
 *
 * Asked for: untouched grass carries drifts of small flowers in spring and
 * summer, clumped rather than sprinkled, none in autumn or winter; Pick
 * flowers gives wildflowers, and a picked tile has none until the next spring.
 * The page draws the drifts and the island decides whether a tile may be
 * picked, so the two have to find the same drift on the same tile to the last
 * whole number, or somebody is refused flowers they can see.
 *
 * So this asks:
 *
 *   * the numbers are the same numbers: the lattices, each season's line and
 *     most, the step a clump takes and the picked bit;
 *   * the drift is the same whole number on both sides for every tile of a
 *     block on four seeds, the largest a seed can be among them, and far out
 *     on a big island's coordinates; and so is what each season makes of it;
 *   * it is clumped: a drift is patches of tiles, not a sprinkle;
 *   * the year is counted the same, so a picked tile comes back on both sides
 *     at the same turn;
 *   * picking, on the island and in the browser, at whatever season the suite
 *     runs in: the same refusals in the same words, and in a flowering season
 *     the same wildflowers, the tile marked and told, and refused after;
 *   * the day keeps a picked tile picked beside its mowing count, clears it
 *     when a new year begins, and tells everybody -- on both sides.
 *
 * Runs against the database the suite leaves behind: Faraway, and Ivar on it.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { bloomOf, FLOWER_FROM, FLOWER_MOST, FLOWER_OCTAVES, FLOWER_STEP, flowerDrift } from '../../src/world/flowers';
import { SEASON_DAYS, SEASONS, seasonAt, yearOf, YEAR_DAYS, YEAR_FROM } from '../../src/world/calendar';
import { DAY_SECONDS } from '../../src/game/pace';
import { FLOWERS_PICKED, lastDawn, MOWN_TODAY, TileType } from '../../src/world/tiles';
import { flowerRefusal, flowersHere, groundSays, pickedSays } from '../../src/game/wildflowers';
import { ACTIONS } from '../../src/game/actions';

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

/* ---- the numbers ----------------------------------------------------------- */

const octaves = psql(`select string_agg(i || ':' || cell || ':' || salt || ':' || weight || ':' || case when eased then 't' else 'f' end, ' ' order by i) from flower_octave`);
const mine = FLOWER_OCTAVES.map((o, i) => `${i}:${o.cell}:${o.salt}:${o.weight}:${o.eased ? 't' : 'f'}`).join(' ');
check('the drift is laid on the same lattices on both sides', octaves === mine, `island ${octaves}, browser ${mine}`);
const seasons = psql(`select string_agg(season || ':' || coalesce(drift::text, '-') || ':' || most, ' ' order by season) from flower_season`);
const mySeasons = Object.keys(FLOWER_FROM).sort().map((s) => `${s}:${FLOWER_FROM[s as keyof typeof FLOWER_FROM] ?? '-'}:${FLOWER_MOST[s as keyof typeof FLOWER_MOST]}`).join(' ');
check('and each season\'s line and most are the same', seasons === mySeasons, `island ${seasons}, browser ${mySeasons}`);
const [iStep, iPicked] = psql(`select flower_step()::int || ' ' || flowers_picked()::int`).split(' ').map(Number);
check('and the step a clump takes, and the bit that says a tile is picked', iStep === FLOWER_STEP && iPicked === FLOWERS_PICKED,
  `island ${iStep} and ${iPicked}, browser ${FLOWER_STEP} and ${FLOWERS_PICKED}`);

/* ---- the drift ------------------------------------------------------------- */

/** Blocks of tiles on several seeds, near the origin and far out on a big island. */
const BLOCKS: Array<{ seed: number; x0: number; y0: number; n: number }> = [
  { seed: 99, x0: 0, y0: 0, n: 64 },
  { seed: 424242, x0: 100, y0: 37, n: 60 },
  { seed: 0x7fffffff, x0: 3990, y0: 4020, n: 60 },
  { seed: 7, x0: 2011, y0: 1733, n: 60 },
];
let tiles = 0;
let same = 0;
let sameBloom = 0;
const differ: string[] = [];
for (const b of BLOCKS) {
  const island = psql(`
    select string_agg(flower_drift(${b.seed}, x, y)::text, ',' order by y, x)
      from generate_series(${b.y0}, ${b.y0 + b.n - 1}) y, generate_series(${b.x0}, ${b.x0 + b.n - 1}) x;`).split(',').map(Number);
  let k = 0;
  for (let y = b.y0; y < b.y0 + b.n; y++) {
    for (let x = b.x0; x < b.x0 + b.n; x++, k++) {
      const d = flowerDrift(b.seed, x, y);
      tiles++;
      if (d === island[k]) same++;
      else if (differ.length < 5) differ.push(`seed ${b.seed} at ${x},${y}: ${d} against ${island[k]}`);
    }
  }
  // What the seasons make of the same drifts, asked of the island's own rule.
  const blooms = psql(`
    select string_agg(flower_bloom(d, s)::text, ',' order by y, x, s)
      from (select x, y, flower_drift(${b.seed}, x, y) as d
              from generate_series(${b.y0}, ${b.y0 + b.n - 1}) y, generate_series(${b.x0}, ${b.x0 + b.n - 1}) x) q,
           unnest(array['autumn', 'spring', 'summer', 'winter']) s;`).split(',').map(Number);
  let j = 0;
  for (let y = b.y0; y < b.y0 + b.n; y++) {
    for (let x = b.x0; x < b.x0 + b.n; x++) {
      const d = flowerDrift(b.seed, x, y);
      let all = true;
      for (const s of ['autumn', 'spring', 'summer', 'winter'] as const) if (bloomOf(d, s) !== blooms[j++]) all = false;
      if (all) sameBloom++;
    }
  }
}
check(`the drift is the same whole number on both sides, tile for tile, over ${tiles} tiles on ${BLOCKS.length} seeds`,
  same === tiles, differ.join('; ') || `${same} of ${tiles}`);
check('and every season makes the same of it: the same clumps, and none in autumn or winter', sameBloom === tiles, `${sameBloom} of ${tiles}`);

// Clumped, not sprinkled: a tile in flower has others in flower beside it far
// more often than a sprinkle of the same thickness would.
{
  const seed = 424242;
  let flowering = 0;
  let neighbours = 0;
  let pairs = 0;
  const N = 200;
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      if (!bloomOf(flowerDrift(seed, x, y), 'summer')) continue;
      flowering++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        pairs++;
        if (bloomOf(flowerDrift(seed, x + dx, y + dy), 'summer')) neighbours++;
      }
    }
  }
  const share = flowering / ((N - 2) * (N - 2));
  const beside = neighbours / pairs;
  check('a drift is clumped: a tile in flower in summer has its neighbours in flower far more often than the thickness alone would give',
    beside > 3 * share && share > 0.08 && share < 0.3,
    `${(share * 100).toFixed(1)}% of tiles flower, and ${(beside * 100).toFixed(1)}% of the neighbours of one that does`);
}

/* ---- the year -------------------------------------------------------------- */

{
  // A day of the year is a day and night of the island's clock.
  const DAY = DAY_SECONDS;
  const moments: number[] = [];
  for (let d = -2 * YEAR_DAYS; d <= 3 * YEAR_DAYS; d++) moments.push(YEAR_FROM + d * DAY - 1, YEAR_FROM + d * DAY, YEAR_FROM + d * DAY + DAY / 2);
  const island = psql(`select string_agg(year_of(to_timestamp(t))::text, ',' order by i)
    from unnest(array[${moments.join(',')}]::double precision[]) with ordinality as m(t, i);`).split(',').map(Number);
  const wrong = moments.filter((t, i) => yearOf(t) !== island[i]);
  check(`the year is counted the same on both sides, at ${moments.length} moments round five years' turns`,
    wrong.length === 0, wrong.slice(0, 3).map((t) => `${new Date(t * 1000).toISOString()}: ${yearOf(t)}`).join('; ') || 'all agree');
  const first = seasonAt(YEAR_FROM + 1);
  check('and a year begins with the spring, at the first dawn of it', yearOf(YEAR_FROM) === 0 && yearOf(YEAR_FROM - 1) === -1
    && first.season === SEASONS[0] && first.day === 1);
}

/* ---- picking ----------------------------------------------------------------
 * A tile of Faraway's own seed that flowers in whatever season it is now if
 * any does, grass on both sides, and Ivar beside it. The browser's world is
 * made from the same seed so its drift is the same drift.
 */
const W = `(select id from world where name = 'Faraway')`;
const IVAR = `(select uid from player where world_id = ${W} and name = 'Ivar')`;
const SEED = Number(psql(`select seed from world where name = 'Faraway'`));
const now = Date.now() / 1000;
/** A day of the island's year: a day and night of its clock. */
const YEAR_DAY = DAY_SECONDS;
// The deepest tile of the drift in the rows the test may use.
let best = { x: 20, y: 44, d: -1 };
for (let y = 42; y < 58; y++) for (let x = 6; x < 58; x++) {
  const d = flowerDrift(SEED, x, y);
  if (d > best.d) best = { x, y, d };
}
const { x: FX, y: FY } = best;
// And one beside it that stands outside every drift, for the refusal.
let bare = { x: 20, y: 44 };
for (let y = 42; y < 58; y++) for (let x = 6; x < 58; x++) if (flowerDrift(SEED, x, y) < (FLOWER_FROM.summer ?? 0) - 40) bare = { x, y };

const pick = ACTIONS.find((a) => a.id === 'pick_flowers');
const target = (x: number, y: number): string => `'{"kind":"tile","x":${x},"y":${y}}'::jsonb`;
/**
 * Picking on both sides at a season: the season it is now, or one pinned for
 * the length of a transaction that is rolled back -- `season_at` redefined in
 * it on the island, the clock stood still at a moment of that season in the
 * browser -- so the whole of picking is asked whatever season the suite runs in.
 */
const pickAt = (pinned: 'summer' | 'spring' | null): void => {
  const at = pinned === null ? now : YEAR_FROM + (yearOf(now) * YEAR_DAYS + SEASONS.indexOf(pinned) * SEASON_DAYS + 2) * YEAR_DAY + YEAR_DAY / 2;
  const inSeason = seasonAt(at).season;
  const islandSays = psql(`
begin;
${pinned === null ? '' : `create or replace function season_at(p_at timestamptz default now()) returns text language sql stable as $pin$ select '${pinned}'::text $pin$;`}
update player set x = ${bare.x + 0.5}, y = ${bare.y + 1.5}, level = 0 where world_id = ${W} and uid = ${IVAR};
select land_set_tile(${W}, ${FX}, ${FY}, tile_id('Grass')); select land_set_data(${W}, ${FX}, ${FY}, 0);
select land_set_tile(${W}, ${bare.x}, ${bare.y}, tile_id('Grass')); select land_set_data(${W}, ${bare.x}, ${bare.y}, 0);
delete from building_tile where world_id = ${W} and ((x = ${FX} and y = ${FY}) or (x = ${bare.x} and y = ${bare.y}));
delete from item where world_id = ${W} and holder = 'player' and holder_uid = ${IVAR} and def = 'wildflowers';
delete from tile_change where world_id = ${W};
select 'BARE|' || coalesce(act_refusal_rules(${W}, ${IVAR}, 'pick_flowers', ${target(bare.x, bare.y)}), '-');
update player set x = ${FX + 0.5}, y = ${FY + 1.5} where world_id = ${W} and uid = ${IVAR};
select 'BLOOM|' || flowers_on(${W}, ${FX}, ${FY});
select 'FIRST|' || coalesce(act_refusal_rules(${W}, ${IVAR}, 'pick_flowers', ${target(FX, FY)}), '-');
select act_perform(${W}, ${IVAR}, 'pick_flowers', ${target(FX, FY)});
select 'GOT|' || coalesce(sum(count), 0) from item where world_id = ${W} and holder = 'player' and holder_uid = ${IVAR} and def = 'wildflowers';
select 'DATA|' || land_data(${W}, ${FX}, ${FY});
select 'TOLD|' || count(*) || '|' || coalesce(max(data), -1) from tile_change where world_id = ${W} and x = ${FX} and y = ${FY};
select 'SAID|' || coalesce((select text from event where world_id = ${W} and uid = ${IVAR} order by n desc limit 1), '-');
select 'AFTER|' || coalesce(act_refusal_rules(${W}, ${IVAR}, 'pick_flowers', ${target(FX, FY)}), '-');
select 'LOOK|' || examine_tile_text(${W}, ${FX}, ${FY}, ${IVAR});
rollback;`);
  const said = (key: string): string => islandSays.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';
  const g = Game.create(SEED);
  g.world.seed = SEED;
  const gw = g.world;
  for (const [x, y] of [[FX, FY], [bare.x, bare.y]]) gw.setTile(x, y, TileType.Grass, 0);
  const tell = `in ${inSeason}${pinned === null ? ', as it is now' : ', pinned'}`;
  const bloom = flowersHere(g, FX, FY, at);
  check(`${tell}: the island and the browser count the same clumps on the tile`,
    Number(said('BLOOM')) === bloom, `island ${said('BLOOM')}, browser ${bloom}; drift ${best.d}`);
  const bFirst = flowerRefusal(g, FX, FY, at) ?? '-';
  check(`${tell}: and say the same about picking it`, said('FIRST') === bFirst, `island "${said('FIRST')}", browser "${bFirst}"`);
  const bBare = flowerRefusal(g, bare.x, bare.y, at) ?? '-';
  check(`${tell}: and about a tile of grass outside every drift`, said('BARE') === bBare && bBare !== '-', `island "${said('BARE')}", browser "${bBare}"`);
  if (bloom > 0) {
    // In flower: the same wildflowers, the tile marked picked and told, and refused after.
    const real = Date.now;
    Date.now = () => at * 1000;
    const before = g.inventory.count('wildflowers');
    pick?.perform({ kind: 'tile', x: FX, y: FY, cx: FX + 0.5, cy: FY + 0.5 }, g);
    const got = g.inventory.count('wildflowers') - before;
    const bAfter = flowerRefusal(g, FX, FY, at) ?? '-';
    Date.now = real;
    check(`${tell}: picked, both sides give a wildflower a clump`, Number(said('GOT')) === bloom && got === bloom,
      `island ${said('GOT')}, browser ${got}, of ${bloom} clumps`);
    check(`${tell}: and mark the tile picked in its byte, and the island tells everybody`,
      Number(said('DATA')) === FLOWERS_PICKED && gw.getData(FX, FY) === FLOWERS_PICKED && said('TOLD') === `1|${FLOWERS_PICKED}`,
      `island byte ${said('DATA')}, browser ${gw.getData(FX, FY)}; told ${said('TOLD')}`);
    check(`${tell}: and say the same thing about it`, said('SAID') === pickedSays(bloom), `island "${said('SAID')}", browser "${pickedSays(bloom)}"`);
    check(`${tell}: and after, both refuse it in the same words, until the spring`, said('AFTER') === bAfter && bAfter.includes(SEASONS[0]),
      `island "${said('AFTER')}", browser "${bAfter}"`);
    const look = groundSays(g, FX, FY, at);
    check(`${tell}: and Examine says the same of the ground on both sides`, said('LOOK').includes(look.trim()) && look.includes('picked'),
      `island "${said('LOOK')}", browser "${look}"`);
  } else {
    check(`${tell}: nothing flowers, and both refuse to pick, in the same words`, said('FIRST') === bFirst && bFirst.includes(inSeason), `"${bFirst}"`);
  }
};
check('Pick flowers is an action the island knows and has a performer for',
  !!pick && psql(`select act_ported('pick_flowers')`) === 't' && psql(`select count(*) from action_def where id = 'pick_flowers'`) === '1');
pickAt(null);
pickAt('spring');
pickAt('summer');

/* ---- the day ----------------------------------------------------------------
 * A picked tile, a picked tile being mown, and an unpicked one being mown, on
 * both sides; a turn within the year keeps the picks, and the first turn of a
 * new year clears them and tells everybody.
 */
const DAYROW = 60;
/** A day of the woods, which turn once a day at the same hour (`lastDawn`). */
const DAY = 86400;
const turn = (newYear: boolean): { island: string; browser: string; told: string } => {
  // The island turns on its own clock: the last turn a second ago in the same
  // year, or a year ago in the one before.
  const out = psql(`
begin;
update player set away = true where world_id = ${W};
delete from tile_change where world_id = ${W};
select land_set_tile(${W}, x, ${DAYROW}, tile_id('Grass')) from generate_series(10, 12) x;
select land_set_data(${W}, 10, ${DAYROW}, ${FLOWERS_PICKED});
select land_set_data(${W}, 11, ${DAYROW}, ${FLOWERS_PICKED | MOWN_TODAY});
select land_set_data(${W}, 12, ${DAYROW}, ${MOWN_TODAY});
update world set trees_at = now() - ${newYear ? `interval '${YEAR_DAYS * YEAR_DAY} seconds'` : `interval '1 second'`} where id = ${W};
select tree_day(${W});
select 'DAY|' || string_agg(land_tile(${W}, x, ${DAYROW}) || ':' || land_data(${W}, x, ${DAYROW}), ' ' order by x) from generate_series(10, 12) x;
select 'TOLD|' || count(*) from tile_change where world_id = ${W} and y = ${DAYROW} and x = 10;
rollback;`);
  const get = (k: string): string => out.split('\n').find((l) => l.startsWith(`${k}|`))?.slice(k.length + 1) ?? 'MISSING';
  // The browser's turn waits for the woods' dawn, so it is handed its
  // moments: an afternoon of this year with the last turn two days before it,
  // or the first afternoon of this year with the last turn the day before,
  // which was the year before. A year begins at the woods' dawn, being a whole
  // number of the woods' days long.
  const g = Game.create(SEED);
  const gw = g.world;
  for (let x = 10; x <= 12; x++) gw.setTile(x, DAYROW, TileType.Grass, 0);
  gw.setTile(10, DAYROW, TileType.Grass, FLOWERS_PICKED);
  gw.setTile(11, DAYROW, TileType.Grass, FLOWERS_PICKED | MOWN_TODAY);
  gw.setTile(12, DAYROW, TileType.Grass, MOWN_TODAY);
  const yearStart = YEAR_FROM + yearOf(now) * YEAR_DAYS * YEAR_DAY;
  const at = newYear ? yearStart + 3600 * 5 : yearStart + 3 * DAY + 3600 * 5;
  g.treesAt = at - (newYear ? DAY : 2 * DAY);
  for (let k = 0; k < 100000 && g.treesAt < lastDawn(at); k++) g.growTrees(at);
  const browser = [10, 11, 12].map((x) => `${gw.getTile(x, DAYROW)}:${gw.getData(x, DAYROW)}`).join(' ');
  return { island: get('DAY'), browser, told: get('TOLD') };
};
const within = turn(false);
check('a turn within the year keeps a picked tile picked, beside a mowing count that moves on as it did, on both sides',
  within.island === within.browser && within.island === `0:${FLOWERS_PICKED} 0:${FLOWERS_PICKED | 1} 0:1`,
  `island ${within.island}, browser ${within.browser}`);
const turned = turn(true);
check('and the first turn of a new year clears every pick, on both sides',
  turned.island === turned.browser && turned.island === '0:0 0:1 0:1', `island ${turned.island}, browser ${turned.browser}`);
check('and tells everybody the tile flowers again, with nobody about to see it', turned.told === '1', `${turned.told} rows`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`wildflowers grow in the same drifts on both sides, and are picked the same — ${ok.length} of ${ok.length}`);
