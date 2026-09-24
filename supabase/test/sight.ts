/**
 * Seeing into a house, and out of one.
 *
 * Reported from the island's chat: "does being in a building change how your
 * vision works? ... seems to be tiles in buildings in general", "i can see
 * through the doors, but only one tile deep", and asked whether that matched
 * the night's radius: "correct", it did not.
 *
 * The line of sight treated every tile a building stood on as a solid block,
 * whatever stood round it. So from a doorway the first tile in was the last,
 * and from inside a house only the tiles touching you were in view. Walls
 * stand on the borders between tiles, and it is a wall that should stop the
 * eye -- a solid one, and nothing else.
 *
 * One house on bare, level ground, five tiles a side and finished: solid walls
 * all round but for the middle of each side, where there is a door to the
 * south, a window to the east, an arch to the north and a half wall to the
 * west. Asked of it, by day and by night:
 *
 *   * from two tiles out, straight through the door, the eye reaches the far
 *     side of the house, and through the window the middle of it;
 *   * a solid wall still hides what is behind it, from outside and in;
 *   * from the middle of the house, the whole of the inside is in view;
 *   * and out through the door, the arch, the window and over the half wall,
 *     as far as the eye reaches in the open -- by day, and at night, where it
 *     comes to the night's radius and not one tile.
 */
import { Game } from '../../src/game/game';
import type { Side, WallType } from '../../src/game/building';
import { TileType } from '../../src/world/tiles';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const game = Game.create(4242);
game.settings.fog = true;
const world = game.world;
// Bare, level ground round the spawn, far enough that nothing else is in view.
const [cx, cy] = [game.spawn.x, game.spawn.y];
const R = 30;
for (let y = cy - R; y <= cy + R + 1; y++) for (let x = cx - R; x <= cx + R + 1; x++) world.setHeight(x, y, 60);
for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) world.setTile(x, y, TileType.Grass);
(game as unknown as { deed: unknown }).deed = null;

// The house: five by five, round (cx, cy).
const [hx, hy] = [cx - 2, cy - 2];
const house = game.buildings.create('House', hx, hy);
for (let y = hy; y < hy + 5; y++) for (let x = hx; x < hx + 5; x++) if (x !== hx || y !== hy) game.buildings.addTile(house, x, y);
const opening: Partial<Record<Side, WallType>> = { s: 'door', e: 'window', n: 'arch', w: 'half_wall' };
const wall = (x: number, y: number, side: Side, type: WallType): void => {
  const w = game.buildings.setWall(house, 0, x, y, side, type, 'log');
  for (const k of Object.keys(w.needed)) w.needed[k] = 0;
};
for (let i = 0; i < 5; i++) {
  wall(hx + i, hy, 'n', i === 2 ? opening.n! : 'solid');
  wall(hx + i, hy + 4, 's', i === 2 ? opening.s! : 'solid');
  wall(hx, hy + i, 'w', i === 2 ? opening.w! : 'solid');
  wall(hx + 4, hy + i, 'e', i === 2 ? opening.e! : 'solid');
}

let dark = 0;
(game as unknown as { darkness: () => number }).darkness = () => dark;
const stand = (x: number, y: number): void => {
  game.player.x = x + 0.5;
  game.player.y = y + 0.5;
  game.player.level = 0;
  game.vision.invalidate();
  game.vision.update();
};
const seen = (x: number, y: number): boolean => game.vision.isVisible(x, y);
/** How many tiles on in a straight line from where you stand are in view before the first that is not. */
const reach = (dx: number, dy: number): number => {
  const [x0, y0] = [game.player.tileX, game.player.tileY];
  let k = 1;
  while (k < 60 && seen(x0 + dx * k, y0 + dy * k)) k++;
  return k - 1;
};

for (const [when, d] of [['by day', 0], ['at night', 1]] as Array<[string, number]>) {
  dark = d;
  stand(cx, cy);
  const open = Math.floor(game.vision.sightRange());
  console.log(`--- ${when}: the eye reaches ${open} tiles in the open`);

  // From outside, two tiles south of the door and two east of the window.
  stand(hx + 2, hy + 6);
  if (open >= 6) {
    check(`${when}, from two tiles out, straight through the door, the eye reaches the far side of the house`,
      seen(hx + 2, hy) && seen(hx + 2, hy + 2), `in view: ${[4, 3, 2, 1, 0].filter((j) => seen(hx + 2, hy + j)).map((j) => `${j}`).join(', ')} rows down`);
  } else {
    check(`${when}, from two tiles out, straight through the door, the eye reaches as far into the house as it reaches anywhere`,
      reach(0, -1) === open, `${reach(0, -1)} tiles, ${open} in the open`);
  }
  // The wedge a one-tile door shows from two tiles out: one tile wide just
  // inside, three wide two rows in. Anything outside it is behind the wall.
  const beside = [[hx + 1, hy + 4], [hx + 3, hy + 4], [hx, hy + 3], [hx + 4, hy + 3], [hx, hy + 4], [hx + 4, hy + 4]];
  check(`${when}, a solid wall hides what is behind it, and the door shows only the wedge a door would`,
    beside.every(([x, y]) => !seen(x, y)),
    `outside the wedge: ${beside.map(([x, y]) => `${x - hx},${y - hy} ${seen(x, y) ? 'SEEN' : 'hidden'}`).join('; ')}`);
  stand(hx + 6, hy + 2);
  check(`${when}, through the window, the eye reaches as far in as it does anywhere`,
    reach(-1, 0) >= Math.min(open, 6), `${reach(-1, 0)} tiles, ${open} in the open`);

  // From the middle of the house.
  stand(hx + 2, hy + 2);
  const inside: string[] = [];
  for (let y = hy; y < hy + 5; y++) for (let x = hx; x < hx + 5; x++) if (!seen(x, y)) inside.push(`${x - hx},${y - hy}`);
  if (open >= 3) {
    check(`${when}, from the middle of the house, the whole of the inside is in view`, !inside.length, inside.length ? `hidden: ${inside.join(' ')}` : '');
  }
  for (const [side, dx, dy] of [['door', 0, 1], ['arch', 0, -1], ['window', 1, 0], ['half wall', -1, 0]] as Array<[string, number, number]>) {
    check(`${when}, out through the ${side}, as far as the eye reaches in the open`, reach(dx, dy) === open, `${reach(dx, dy)} tiles, ${open} in the open`);
  }
  // A corner of the inside: the walls on its two outer sides are solid.
  stand(hx + 1, hy + 1);
  check(`${when}, and from inside, a solid wall hides what is behind it`,
    !seen(hx - 2, hy + 1) && !seen(hx + 1, hy - 2), `west ${seen(hx - 2, hy + 1)}, north ${seen(hx + 1, hy - 2)}`);
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`seeing into a house and out of one — ${ok.length} of ${ok.length}`);
