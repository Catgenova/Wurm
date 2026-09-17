/**
 * The island's history, laid over land that is worked out as it goes.
 *
 * This is the load-bearing half of a join and it had never been tested,
 * because the client that does it cannot be made to do it without a network.
 * `layChange` is out here in `landpack` for exactly that reason: it is the
 * same function the browser runs, asked the same questions, from Node.
 *
 * What makes it delicate is that a joining browser does not hold the island —
 * it holds a seed and works out squares of ground as something asks for them.
 * So the replay writes onto land that mostly does not exist yet, and every
 * square it writes onto has to be worked out first and then never worked out
 * again. Get either half wrong and the symptom is the same one that was
 * reported from a phone: a tree felled an hour ago standing again, and the
 * island telling you there is nothing there to cut down.
 */
import { generateAtlasWindow } from '../../src/world/atlas-world';
import { CHUNK, World } from '../../src/world/world';
import { layChange, layHistory, type TileChange } from '../../src/net/landpack';
import { readAtlas } from '../../tools/atlas-node';

const atlas = readAtlas();
const SIZE = 256;
const SEED = 90210;

/** A world as a browser has it at a join: a seed, and nothing worked out yet. */
function joining(): World {
  const w = new World(SIZE, SIZE);
  w.seed = SEED;
  w.streamFrom((x0, y0, ww, hh) => generateAtlasWindow(SEED, atlas, x0, y0, ww, hh, SIZE));
  return w;
}

/** What the ground under a tile is before anybody has touched it. */
function asRolled(x: number, y: number): { tile: number; data: number; corners: number[]; soil: number[] } {
  const win = generateAtlasWindow(SEED, atlas, x, y, 1, 1, SIZE);
  return {
    tile: win.tiles[0],
    data: win.data[0],
    corners: [win.heights[0], win.heights[1], win.heights[3], win.heights[2]],
    soil: [win.dirt[0], win.dirt[1], win.dirt[3], win.dirt[2]],
  };
}

/**
 * A dig at a tile: every corner a step lower, the soil a step thinner, and the
 * ground turned over.
 *
 * The soil is the half of this that was missing until somebody dug fourteen
 * spadefuls out of a corner on the live island and was told they were no
 * nearer the rock. The ground came down the wire; how much of it was left over
 * the rock never did.
 */
function dug(x: number, y: number, by = 8): TileChange {
  const was = asRolled(x, y);
  // Whatever it was, something else — so "the tile is what the island says"
  // cannot pass by the tile having been that already.
  return {
    x, y, tile: was.tile === 1 ? 2 : 1, data: 0,
    corners: was.corners.map((c) => c - by),
    soil: was.soil.map((d) => Math.max(0, d - by)),
  };
}

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

/*
 * A change on ground nobody has looked at.
 *
 * The one that matters most: at a join *every* square is like this, so if a
 * change cannot land on unworked ground then no change in the island's history
 * lands at all.
 */
{
  const w = joining();
  const x = 140, y = 200;
  const was = asRolled(x, y);
  const c = dug(x, y);
  check('a square nobody has asked for is not worked out yet', w.grown === 0, `${w.grown} squares`);
  check('the change is applied', layChange(w, c));
  check('and the tile is what the island says', w.getTile(x, y) === c.tile, `${was.tile} rolled, ${w.getTile(x, y)} now`);
  check('and the corner with it', w.getHeight(x, y) === c.corners[0],
    `${was.corners[0]} rolled, ${w.getHeight(x, y)} now, ${c.corners[0]} wanted`);
  check('and it cost one square of generation', w.grown === 1, `${w.grown} squares worked out`);

  /*
   * And it is still there after the ground around it arrives.
   *
   * A square is worked out once and marked, so walking over it later must not
   * roll it again. This is the check that would fail if `grow` ever stopped
   * marking before it works.
   */
  w.ensureBox(0, 0, SIZE - 1, SIZE - 1);
  check('and survives the rest of the island being worked out',
    w.getTile(x, y) === c.tile && w.getHeight(x, y) === c.corners[0],
    `tile ${w.getTile(x, y)}, corner ${w.getHeight(x, y)}`);
}

/*
 * And the soil that came off with the ground.
 *
 * `tile_change` carried the four corner heights and nothing about the dirt, so
 * a dig lowered the ground on both sides and thinned the soil on the island's
 * side alone. Reported from the island as fourteen spadefuls and no nearer the
 * rock — and worse than a wrong number: the browser reads its own soil to
 * decide whether a corner is down to bare rock at all, so it kept offering a
 * dig the island had been refusing for an hour.
 */
{
  const w = joining();
  const x = 64, y = 88;
  const was = asRolled(x, y);
  const c = dug(x, y, 3);
  layChange(w, c);
  check('the soil comes down with the ground',
    w.getDirt(x, y) === c.soil?.[0] && w.getDirt(x + 1, y + 1) === c.soil?.[2],
    `${was.soil[0]} rolled, ${w.getDirt(x, y)} now, ${c.soil?.[0]} wanted`);
  check('and the rock under it is where the island says it is',
    w.rockHeight(x, y) === c.corners[0] - (c.soil?.[0] ?? 0),
    `surface ${w.getHeight(x, y)} less ${w.getDirt(x, y)} of soil`);

  /*
   * And a row from before the island carried any: the browser keeps its own
   * reckoning rather than zeroing the soil under a square it was told nothing
   * about. Every `tile_change` written before today is one of these.
   */
  const older = joining();
  const before = asRolled(x, y);
  layChange(older, { x, y, tile: 2, data: 0, corners: before.corners.map((k) => k - 1) });
  check('and a row with no soil on it leaves the soil alone',
    older.getDirt(x, y) === before.soil[0],
    `${before.soil[0]} rolled, ${older.getDirt(x, y)} after`);
}

/*
 * Two changes either side of a square's edge, the far one first.
 *
 * Corners are shared: the corner planes are one wider than the tile planes, so
 * four squares of generated ground can each claim the same corner. While only
 * the generator wrote them that cost nothing, because both sides wrote the
 * same number — and a replay writing the island's own history over them turned
 * the overlap into a race. A dig on one side of the line, then a dig on the
 * other, and the second square being worked out laid the seed's ground back
 * over the first one's corners.
 */
{
  const w = joining();
  // The first tile of the next square along. Its own corner sits on the line.
  const far = dug(CHUNK, 70);
  layChange(w, far);
  check('the far dig worked out one square', w.grown === 1, `${w.grown} squares`);
  // And now something in the square on the near side, well away from it, so
  // that the only thing touching the shared corner is the generation itself.
  const near = dug(CHUNK - 1, 110);
  layChange(w, near);
  check('the near dig worked out a second', w.grown === 2, `${w.grown} squares`);
  check('and the corner on the line is still the island\'s, not the seed\'s',
    w.getHeight(CHUNK, 70) === far.corners[0],
    `${w.getHeight(CHUNK, 70)} there, ${far.corners[0]} wanted, ${asRolled(CHUNK, 70).corners[0]} as rolled`);
  check('and so is the one below it', w.getHeight(CHUNK, 71) === far.corners[3],
    `${w.getHeight(CHUNK, 71)} there, ${far.corners[3]} wanted`);
  check('and both tiles are dug', w.getTile(CHUNK, 70) === far.tile && w.getTile(CHUNK - 1, 110) === near.tile);
}

/*
 * The same, at the point where four squares meet.
 *
 * A corner on an edge is shared with one square; a corner on a corner is
 * shared with three, and only one of the three is across an edge. The other
 * two are diagonal, which is the case a check written for the obvious
 * direction would miss.
 */
{
  const w = joining();
  const c = dug(CHUNK - 1, CHUNK - 1);
  layChange(w, c);
  w.ensure(CHUNK, CHUNK - 1);      // the square across the edge
  w.ensure(CHUNK - 1, CHUNK);      // the one across the other edge
  w.ensure(CHUNK, CHUNK);          // and the one diagonally across
  check('all four squares are worked out', w.grown === 4, `${w.grown} squares`);
  check('and the corner where they meet is still the island\'s',
    w.getHeight(CHUNK, CHUNK) === c.corners[2],
    `${w.getHeight(CHUNK, CHUNK)} there, ${c.corners[2]} wanted, ${asRolled(CHUNK - 1, CHUNK - 1).corners[2]} as rolled`);
}

/*
 * A whole island's history, and what it costs.
 *
 * A join works out a square of ground for every square anybody has ever dug
 * in, which is the price of laying the history onto land that is generated as
 * it goes. What matters is that the price is paid per *square* and not per
 * change — four hundred digs in a settlement cost the settlement, not four
 * hundred — because a busy island's history is long and its footprint is not.
 * That, and `compact_changes` collapsing the old rows, is what keeps a join
 * from getting slower every week.
 */
{
  const spread = joining();
  const changes: TileChange[] = [];
  for (let i = 0; i < 400; i++) {
    changes.push(dug((i * 97) % SIZE, (i * 43 + 11) % SIZE, 4));
  }
  const at = Date.now();
  let laid = 0;
  for (const c of changes) if (layChange(spread, c)) laid++;
  const took = Date.now() - at;
  let wrong = 0;
  for (const c of changes) if (spread.getTile(c.x, c.y) !== c.tile) wrong++;
  check('every change in the history lands', laid === changes.length && wrong === 0,
    `${laid} of ${changes.length} applied, ${wrong} not on the ground afterwards`);

  const settled = joining();
  for (let i = 0; i < 400; i++) {
    layChange(settled, dug(100 + ((i * 7) % 24), 100 + ((i * 11) % 24), 4));
  }
  check('and a history in one place costs one place, not one square per change',
    settled.grown <= 4, `${settled.grown} squares for 400 digs in a settlement`);
  const squares = Math.ceil(SIZE / CHUNK) ** 2;
  check('while one scattered over the whole island costs the whole island',
    spread.grown === squares, `${spread.grown} of ${squares} squares, in ${took}ms`);
}

/* And a row for somewhere that is not on this island at all. */
{
  const w = joining();
  check('a change off the edge of the island is refused',
    !layChange(w, { x: -1, y: 4, tile: 1, data: 0, corners: [0, 0, 0, 0] }));
  check('and one past the far side too',
    !layChange(w, { x: SIZE, y: 4, tile: 1, data: 0, corners: [0, 0, 0, 0] }));
  check('and neither worked out any ground', w.grown === 0, `${w.grown} squares`);
}

/*
 * And the ground under it all, when the squares are not asked for in order.
 *
 * Reported from a phone as "massive grid ditches through the entire map", and
 * that is exactly what it was: a line of corners left at the nought the array
 * was made with, every sixty-four tiles in both directions. A square that
 * reached its own edge *after* its neighbour below had been worked out decided
 * the whole edge belonged to that neighbour and wrote none of it — and the
 * neighbour never touched it either, because it does not reach that far. A
 * trench through the land, a shoal through the sea, and bare rock down the
 * middle of it, because the soil is skipped along with the height.
 *
 * Nobody walks an island in reading order, so neither does this: south first,
 * then back north over ground nobody has asked about yet, which is the order
 * that leaves a square with a ready neighbour below it.
 */
{
  const w = joining();
  for (const [tx, ty] of [[100, 150], [100, 80], [170, 80], [170, 150], [40, 80], [40, 150]] as Array<[number, number]>) {
    w.getHeight(tx, ty);
  }
  const wandered = w.grown;
  const truth = generateAtlasWindow(SEED, atlas, 0, 0, SIZE, SIZE, SIZE);
  let wrong = 0;
  let nought = 0;
  let first = '';
  for (let gy = 0; gy <= SIZE; gy++) {
    for (let gx = 0; gx <= SIZE; gx++) {
      const mine = w.getHeight(gx, gy);
      const real = truth.heights[gy * (SIZE + 1) + gx];
      if (mine === real) continue;
      wrong++;
      if (mine === 0) nought++;
      if (!first) first = `${gx},${gy} is ${mine} and should be ${real}`;
    }
  }
  check('a square worked out after its neighbours still writes its own edges',
    wrong === 0, `${wrong} corners wrong after wandering over ${wandered} squares, ${nought} of them left at nought${first ? ` — ${first}` : ''}`);
  const w2 = joining();
  for (const [tx, ty] of [[100, 150], [100, 80], [170, 80], [170, 150]] as Array<[number, number]>) w2.getHeight(tx, ty);
  // And the reason the skipping is there at all: a corner somebody has dug is
  // not written back over by a square that turns up afterwards.
  const deep = dug(101, 128, 9);
  layChange(w2, deep);
  w2.getHeight(101, 70);
  w2.getHeight(40, 128);
  check('and a corner somebody dug is still not written back over',
    w2.getHeight(101, 128) === deep.corners[0],
    `${w2.getHeight(101, 128)} against the ${deep.corners[0]} that was dug`);
}

/*
 * And the whole history coming down, which is the part that failed.
 *
 * Reported from the island: *"all my paved tiles and levelled terrain from
 * this morning reverted."* Nothing had been lost. A join builds the ground
 * from the seed and lays the record over it, so a read of the record that
 * comes back empty is an island nobody has ever touched — and a read that
 * *fails* came back empty, because the error was thrown away and `null`
 * became `[]`.
 *
 * The read is a page at a time now, so this asks the three things that can go
 * wrong with paging: that every page is laid, that a server capping pages
 * below what was asked does not look like the end, and that a failure is loud
 * and keeps what it had already read.
 */
{
  const HISTORY = 12_000;
  const PAGE = 5000;
  const all: Array<TileChange & { n: number }> = [];
  for (let i = 0; i < HISTORY; i++) {
    all.push({ ...dug(10 + (i % 200), 10 + Math.floor(i / 200), 30 + (i % 7)), n: i + 1 });
  }
  /** A reader that answers from `all`, capping each page at `cap` of its own. */
  const reader = (cap: number, failAt?: number) => {
    let calls = 0;
    return async (after: number, take: number) => {
      calls++;
      if (failAt && calls === failAt) return { rows: [], error: 'statement timeout' };
      const from = all.findIndex((c) => c.n > after);
      const rows = from < 0 ? [] : all.slice(from, from + Math.min(take, cap));
      return { rows };
    };
  };

  let laid = 0;
  let seen = await layHistory(0, PAGE, reader(PAGE), () => { laid++; });
  check('every page of a long history is laid down', laid === HISTORY && seen === HISTORY,
    `${laid} of ${HISTORY} laid, cursor at ${seen}`);

  // A server with a cap of its own, below the page asked for: every page comes
  // back short, and short must not mean the end.
  laid = 0;
  seen = await layHistory(0, PAGE, reader(1000), () => { laid++; });
  check('a server capping pages below the page asked for is not the end of it',
    laid === HISTORY && seen === HISTORY, `${laid} of ${HISTORY} laid, cursor at ${seen}`);

  // And a read that dies: loud, and what it had already read is kept.
  laid = 0;
  let threw = '';
  let kept = -1;
  try {
    kept = await layHistory(0, PAGE, reader(PAGE, 2), () => { laid++; });
  } catch (e) {
    threw = String(e);
  }
  check('a history that will not come is thrown rather than swallowed',
    threw.includes('would not come'), threw || `it returned ${kept} quietly`);
  check('and the page it did read is not read again',
    laid === PAGE, `${laid} laid before it gave up`);
}

for (const l of ok) console.log(l);
for (const l of bad) console.log(l);
console.log(bad.length ? `${bad.length} of ${ok.length + bad.length} went wrong.`
                       : `the island's history lays onto the land — ${ok.length} checks.`);
process.exit(bad.length ? 1 : 0);
