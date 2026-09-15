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
import { layChange, type TileChange } from '../../src/net/landpack';
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
function asRolled(x: number, y: number): { tile: number; data: number; corners: number[] } {
  const win = generateAtlasWindow(SEED, atlas, x, y, 1, 1, SIZE);
  return {
    tile: win.tiles[0],
    data: win.data[0],
    corners: [win.heights[0], win.heights[1], win.heights[3], win.heights[2]],
  };
}

/** A dig at a tile: every corner a step lower, and the ground turned over. */
function dug(x: number, y: number, by = 8): TileChange {
  const was = asRolled(x, y);
  // Whatever it was, something else — so "the tile is what the island says"
  // cannot pass by the tile having been that already.
  return { x, y, tile: was.tile === 1 ? 2 : 1, data: 0, corners: was.corners.map((c) => c - by) };
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

for (const l of ok) console.log(l);
for (const l of bad) console.log(l);
console.log(bad.length ? `${bad.length} of ${ok.length + bad.length} went wrong.`
                       : `the island's history lays onto the land — ${ok.length} checks.`);
process.exit(bad.length ? 1 : 0);
