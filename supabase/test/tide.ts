/**
 * The waterline, and the one height either side of it that was wrong.
 *
 * Reported from the island with a picture: a copper vein, "You cannot mine
 * below the water level.", and no water drawn on the tile or anywhere near it.
 * Two rules meet at nought and they did not agree about it.
 *
 *   * What the browser draws. A tile is wet where any of its four corners is
 *     below nought, and the water polygon is clipped to the part of it that
 *     is — so one dug corner is a puddle with a shoreline round it, and a
 *     tile-wide hollow is a pond. That has always been the rule and it is
 *     measured here rather than assumed, because the report was half a
 *     question about it.
 *
 *   * What the island allowed. `rock_height(corner) <= 0`, which is the
 *     bedrock under the soil rather than the ground, and `<=` rather than `<`.
 *     Nought is the one height that refuses and draws nothing to refuse for.
 *
 * The island's half is measured in `island.sql`, against the rules themselves.
 * This is the browser's half: that water is drawn from the first unit below
 * the line, and that the allowance both sides read is one number.
 */
import { World } from '../../src/world/world';
import { MINE_DEPTH } from '../../src/game/actions';
import { Player, SWIM_DEPTH } from '../../src/game/player';

const world = new World(16, 16);
for (let y = 0; y <= 16; y++) for (let x = 0; x <= 16; x++) world.setHeight(x, y, 20);

let bad = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) bad++;
  console.log(`${ok ? '  ' : 'X '}${line}`);
};

// One corner of one tile, taken down a unit at a time. Water is drawn where a
// corner is below the line, so the first unit down is already a puddle.
console.log('a single corner, dug:');
for (const h of [1, 0, -1, -2]) {
  world.setHeight(8, 8, h);
  say(world.hasWater(8, 8) === h < 0,
    `corner at ${String(h).padStart(2)} — water drawn: ${world.hasWater(8, 8)}, `
    + `whole tile under: ${world.isSubmerged(8, 8)}`);
}
world.setHeight(8, 8, 20);

// And a tile-wide hollow, which is the pond the report was looking for.
console.log('a tile dug out on all four corners:');
for (const h of [0, -1, -10, -11]) {
  for (const [cx, cy] of [[8, 8], [9, 8], [9, 9], [8, 9]]) world.setHeight(cx, cy, h);
  say(world.hasWater(8, 8) === h < 0 && world.isSubmerged(8, 8) === h < 0,
    `all four at ${String(h).padStart(3)} — water drawn: ${world.hasWater(8, 8)}, `
    + `${h < -MINE_DEPTH ? 'too deep to work' : 'a face here can still be worked'}`);
}

console.log(`the allowance both sides read: ${MINE_DEPTH} units of water over a face`);
say(MINE_DEPTH > 0, `which leaves the waterline itself workable, which is where a shore face stands`);

/*
 * And who is in the water, which was read off the ground and nothing else.
 *
 * `swimming` was `height < -SWIM_DEPTH` and no more, so a hull in thirty feet
 * of water was swimming: slowed to a swimmer's share of a walking pace,
 * spending a swimmer's wind, and — now that the island charges for it —
 * drowning its crew. A Wadd carrying a rider across a sound was the same, and
 * carrying a rider across a sound is what a Wadd is for. The island asks
 * whether anything is holding you up; this is the browser's half of that
 * question, and `in_deep_water` is the island's.
 */
console.log('and whose feet are actually in it:');
const pool = new World(16, 16);
for (let y = 0; y <= 16; y++) for (let x = 0; x <= 16; x++) pool.setHeight(x, y, 20);
for (const [cx, cy] of [[8, 8], [9, 8], [9, 9], [8, 9]]) pool.setHeight(cx, cy, -(SWIM_DEPTH + 6));
const body = new Player(8.5, 8.5);
body.update(0.1, pool);
say(body.swimming, `on your own feet in ${SWIM_DEPTH + 6} units of water: swimming ${body.swimming}`);
body.carried = true;
body.update(0.1, pool);
say(!body.swimming, `in a hull over the same water: swimming ${body.swimming}`);
body.carried = false;
body.x = 2.5;
body.y = 2.5;
body.update(0.1, pool);
say(!body.swimming, `back on the meadow: swimming ${body.swimming}`);

if (bad) {
  console.error(`${bad} of them are not what they should be`);
  process.exit(1);
}
