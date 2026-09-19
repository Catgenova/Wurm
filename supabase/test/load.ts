/**
 * What a back takes, and where carrying stops being a drag and becomes a wall.
 *
 * Asked for: "time to implement the inventory movement cap. when inventory is
 * above 150% cap, movement speed becomes 0."
 *
 * Past the limit a body was already slower and tired faster, and that was the
 * whole of it — the drag is capped, so a body under ten times its limit still
 * walked, at a crawl. Half again over it is the end of walking now.
 *
 * The rule has to be the same rule on both sides. The browser draws the body
 * and must not draw it walking; the island decides where a body actually is
 * and must not move it — a stop only the browser holds is a stop a browser can
 * decline. So the two numbers behind it are generated into the island as
 * `carry_base()` and `carry_per_strength()`, the stop as `carry_stop()`, and
 * this puts the browser's to the island's and then loads a body in a game of
 * its own until it cannot move.
 */
import { execFileSync } from 'node:child_process';
import { Game, CARRY_BASE, CARRY_PER_STRENGTH, CARRY_STOP } from '../../src/game/game';
import { itemWeight } from '../../src/game/items';

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
  }).replace(/\n$/, '');

let bad = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) bad++;
  console.log(`${ok ? '  ' : 'X '}${line}`);
};

/* The three numbers, on both sides. */
const theirs = psql("select carry_base() || ',' || carry_per_strength() || ',' || carry_stop()").split(',').map(Number);
const mine = [CARRY_BASE, CARRY_PER_STRENGTH, CARRY_STOP];
say(mine.every((n, i) => n === theirs[i]),
  `the same three numbers on both sides: base ${mine[0]} kg, ${mine[1]} kg a point of body strength, stop at ${mine[2]}× — the island says ${theirs.join(', ')}`);

/* A body in a game of its own, loaded until it cannot walk. */
const game = Game.create(4242, 96);
const limit = game.carryLimit();
say(limit === CARRY_BASE + game.skills.get('body_strength') * CARRY_PER_STRENGTH,
  `a fresh body's back takes ${limit.toFixed(0)} kg at body strength ${game.skills.get('body_strength').toFixed(1)}`);
say(!game.stalled(), `carrying ${game.inventory.totalWeight().toFixed(1)} kg of starting kit, it can walk`);

/** Load the pack to about this share of the limit, and say what it came out at. */
const loadTo = (share: number): number => {
  for (const it of [...game.inventory.items]) game.inventory.remove(it.uid, it.count);
  const one = itemWeight({ id: 'iron_ore', count: 1 });
  game.inventory.add('iron_ore', { ql: 20, count: Math.ceil((limit * share) / one) });
  return game.carryShare();
};

const heavy = loadTo(1.4);
say(!game.stalled(), `at ${(heavy * 100).toFixed(0)}% of it — heavy going — it still walks`);
const burdened = game.burden();
say(burdened > 0, `and it is paying for it: burden ${burdened.toFixed(2)}, which is ${(100 / (1 + burdened)).toFixed(0)}% of its pace`);

const over = loadTo(1.8);
say(game.stalled(), `at ${(over * 100).toFixed(0)}% it is stopped where it stands`);

/* And the body itself: a walk asked for, and nothing moved. */
const w = game.world;
for (let cy = game.player.tileY - 1; cy <= game.player.tileY + 3; cy++) {
  for (let cx = game.player.tileX - 1; cx <= game.player.tileX + 3; cx++) w.setHeight(cx, cy, 40);
}
game.player.stalled = game.stalled();
const from = { x: game.player.x, y: game.player.y };
game.player.walkTo(w, game.player.tileX + 2, game.player.tileY);
for (let i = 0; i < 40; i++) game.player.update(0.1, w);
const stoodStill = Math.hypot(game.player.x - from.x, game.player.y - from.y) < 0.001;
say(stoodStill, `four seconds of walking with ${(over * 100).toFixed(0)}% on its back moved it ${Math.hypot(game.player.x - from.x, game.player.y - from.y).toFixed(3)} tiles`);
say(game.player.path === null, 'and the walk was dropped rather than left waiting');

/* Put it down and the road opens again. */
const light = loadTo(0.5);
game.player.stalled = game.stalled();
game.player.walkTo(w, game.player.tileX + 2, game.player.tileY);
for (let i = 0; i < 40; i++) game.player.update(0.1, w);
const moved = Math.hypot(game.player.x - from.x, game.player.y - from.y);
say(!game.stalled() && moved > 0.5, `put down to ${(light * 100).toFixed(0)}% it walks again: ${moved.toFixed(2)} tiles in four seconds`);

if (bad) {
  console.error(`${bad} of them are not what they should be`);
  process.exit(1);
}
console.log('a body walks under its limit, labours over it, and stands still half again past it — the same sum on both sides');
