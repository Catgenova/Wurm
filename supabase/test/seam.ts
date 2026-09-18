/**
 * Concrete goes on plain rock, never on a seam.
 *
 * Asked for: "only allow raising a rock corner with concrete, not an ore /
 * seam corner". A corner holds up four tiles, and a vein under any of them
 * raised with concrete would be ore for ever: mined down a step, laid up a
 * step and mined again. This asks the browser's own door, `raise_rock`'s
 * check, about a flat shelf of bare rock at height four: allowed on plain
 * rock; refused with a copper vein under any one of the corner's four tiles,
 * and with the coal seam, which is no ore and every bit a seam; and still
 * allowed at the corner next door, whose four tiles are plain.
 */
import { ACTION_BY_ID } from '../../src/game/actions';
import { Game } from '../../src/game/game';
import { ROCK_VARIANTS, TileType } from '../../src/world/tiles';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const game = Game.create(4242);
const w = game.world;
// A shelf of bare rock at four, tiles 20..23 × 20..23, every corner flat.
for (let y = 20; y <= 24; y++) for (let x = 20; x <= 24; x++) { w.setHeight(x, y, 4); w.setDirt(x, y, 0); }
for (let y = 20; y <= 23; y++) for (let x = 20; x <= 23; x++) { w.setTile(x, y, TileType.Rock, 0); w.setRockKind(x, y, 0); }
game.inventory.add('concrete', { ql: 50 });
game.inventory.add('trowel', { ql: 60 });
game.player.x = 21.5; game.player.y = 21.5;
const raise = ACTION_BY_ID.get('raise_rock');
if (!raise?.check) throw new Error('no raise_rock action');
const door = (cx: number, cy: number): string => raise.check?.({ kind: 'tile', x: cx, y: cy, cx, cy }, game) ?? 'allowed';

check('plain rock: the door is open', door(22, 22) === 'allowed', door(22, 22));
const copper = ROCK_VARIANTS.findIndex((r) => r.yields === 'copper_ore');
const coal = ROCK_VARIANTS.findIndex((r) => r.yields === 'coal');
check('the table knows a copper vein and a coal seam', copper > 0 && coal > 0, `${copper}, ${coal}`);
// The corner at 22,22 holds up the tiles 21,21 · 22,21 · 21,22 · 22,22.
for (const [x, y] of [[21, 21], [22, 21], [21, 22], [22, 22]]) {
  w.setRockKind(x, y, copper);
  check(`a copper vein under the tile at ${x},${y}: refused`, door(22, 22) === 'That corner is on a seam. Concrete goes on plain rock.', door(22, 22));
  w.setRockKind(x, y, 0);
}
w.setRockKind(21, 21, coal);
check('the coal seam is a seam too', door(22, 22) === 'That corner is on a seam. Concrete goes on plain rock.', door(22, 22));
check('while the corner next door, over plain rock, is still open', door(23, 23) === 'allowed', door(23, 23));
w.setRockKind(21, 21, 0);
check('and plain again, the door reopens', door(22, 22) === 'allowed', door(22, 22));

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} went wrong` : `\nall ${ok.length} right`);
process.exit(bad.length ? 1 : 0);
