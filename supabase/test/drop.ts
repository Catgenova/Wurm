/**
 * Let go over a container.
 *
 * Asked: "Allow drag and drop from the player inventory directly to a
 * container by dragging the item to the asset model and releasing."
 *
 * The drag itself is the page's: a row dragged out of the inventory window and
 * let go over the world asks the renderer what is under the cursor, and a
 * crate, or a piece of furniture that holds things, takes it (`storeAt` and
 * `dropOnWorld` on the UI). What that asks for is the door the store window's
 * drop uses -- `store_in_crate` or `store_in_furniture`, naming the store by
 * `into` -- and this asks that door what a drop needs of it:
 *
 *   * a crate within reach takes the whole stack at once, and says nothing
 *     about starting anything;
 *   * a crate across the yard is walked to, and that crate takes it -- not the
 *     one beside you, which is where a name out of reach used to fall back to;
 *   * so is a chest;
 *   * reach is measured the way the doors measure it: from the far corner of
 *     the next tile the crate named is out of it, so the feet take the half
 *     step first, rather than the crate at your feet taking the stack;
 *   * and on an island the walk comes first and the island is asked when the
 *     feet arrive, naming the store.
 */
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import type { Item } from '../../src/game/items';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const game = Game.create(4242);
// Open ground with a yard's room round it.
let spot: [number, number] | null = null;
for (let r = 0; r < 120 && !spot; r++) {
  for (let dx = -r; dx <= r && !spot; dx++) {
    for (const dy of [-r, r]) {
      const [x, y] = [game.spawn.x + dx, game.spawn.y + dy];
      let fine = true;
      for (let j = -2; j <= 3 && fine; j++) {
        for (let i = -3; i <= 8 && fine; i++) {
          fine = game.world.isPassable(x + i, y + j) && !game.world.hasWater(x + i, y + j) && game.world.slope(x + i, y + j) < 30;
        }
      }
      if (fine) {
        spot = [x, y];
        break;
      }
    }
  }
}
check('a yard to work in', spot !== null, spot ? `${spot[0]}, ${spot[1]}` : 'none found');
const [px, py] = spot ?? [64, 64];
const home = (): void => {
  game.player.x = px + 0.5;
  game.player.y = py + 0.5;
  game.player.path = null;
};
home();
for (const c of [...game.crates.values()]) game.removeCrate(c.id);
for (const f of [...game.furniture.values()]) game.removeFurniture(f.id);
const pack = game.inventory;
for (const it of [...pack.items]) if (['log', 'rock_shards'].includes(it.id)) pack.remove(it.uid, it.count);

const beside = game.addCrate('plank', px + 1, py, 0, 0, []);
const yonder = game.addCrate('plank', px + 7, py, 0, 0, []);
const chest = game.addFurniture('chest', px + 7, py + 2, 0, 0, 40);
const count = (items: Item[], id: string): number => items.filter((it) => it.id === id).reduce((n, it) => n + it.count, 0);
const intoCrate = ACTION_BY_ID.get('store_in_crate');
const intoPiece = ACTION_BY_ID.get('store_in_furniture');
if (!intoCrate || !intoPiece) throw new Error('a store door is missing');
const settle = (): void => {
  for (let t = 0; t < 400 && (game.action || game.player.path); t++) game.update(0.2);
};

// Within reach: at once, and nothing said about starting.
let logs = pack.add('log', { count: 5, ql: 30, extra: 'Pine' });
let heard = game.log.length;
game.requestAction(intoCrate, { kind: 'item', uid: logs.uid, count: logs.count, into: beside.id } as Target);
check('a crate within reach takes the whole stack at once', count(beside.items, 'log') === 5 && count(pack.items, 'log') === 0,
  `${count(beside.items, 'log')} in the crate, ${count(pack.items, 'log')} in the pack`);
check('and says nothing about starting anything', !game.log.slice(heard).some((l) => l.text.startsWith('You start')),
  game.log.slice(heard).map((l) => l.text).join(' | '));

// Across the yard.
logs = pack.add('log', { count: 5, ql: 30, extra: 'Pine' });
heard = game.log.length;
game.requestAction(intoCrate, { kind: 'item', uid: logs.uid, count: logs.count, into: yonder.id } as Target);
check('a crate across the yard is walked to', game.action?.state === 'walking' && !!game.player.path,
  `${game.action?.state ?? 'nothing in hand'}`);
settle();
check('and that crate takes it, not the one that was beside you',
  count(yonder.items, 'log') === 5 && count(beside.items, 'log') === 5 && count(pack.items, 'log') === 0,
  `${count(yonder.items, 'log')} in the far crate, ${count(beside.items, 'log')} in the near one, ${count(pack.items, 'log')} in the pack`);
check('with the same words a drop in the store window has', game.log.slice(heard).some((l) => l.kind === 'event' && /crate/i.test(l.text)),
  game.log.slice(heard).map((l) => l.text).join(' | '));

// A chest across the yard.
home();
const shards = pack.add('rock_shards', { count: 7, ql: 20 });
game.requestAction(intoPiece, { kind: 'item', uid: shards.uid, count: shards.count, into: chest.id } as Target);
settle();
check('so is a chest', count(chest.items, 'rock_shards') === 7 && count(pack.items, 'rock_shards') === 0,
  `${count(chest.items, 'rock_shards')} in the chest`);

// The far corner of the next tile: next to the crate named by tiles, further
// than a reach from it by the doors' measure, and a crate at your feet.
const underfoot = game.addCrate('plank', px + 3, py + 2, 0, 0, []);
game.player.x = px + 2.95;
game.player.y = py + 1.95;
game.player.path = null;
const had = count(beside.items, 'log');
logs = pack.add('log', { count: 4, ql: 30, extra: 'Pine' });
game.requestAction(intoCrate, { kind: 'item', uid: logs.uid, count: logs.count, into: beside.id } as Target);
settle();
check('from the far corner of the next tile, the crate named takes it and not the one at your feet',
  count(beside.items, 'log') === had + 4 && count(underfoot.items, 'log') === 0 && count(pack.items, 'log') === 0,
  `${count(beside.items, 'log') - had} in the crate named, ${count(underfoot.items, 'log')} in the one at your feet`);
game.removeCrate(underfoot.id);

// On an island: the walk first, and the ask on arrival, naming the store.
home();
const asked: Array<{ id: string; into?: number }> = [];
game.ask = (def, target) => {
  asked.push({ id: def.id, into: target.kind === 'item' ? target.into : undefined });
};
logs = pack.add('log', { count: 3, ql: 30, extra: 'Pine' });
game.requestAction(intoCrate, { kind: 'item', uid: logs.uid, count: logs.count, into: yonder.id } as Target);
check('on an island the feet go first', asked.length === 0 && !!game.player.path, `${asked.length} asked before walking`);
settle();
check('and the island is asked on arrival, naming the store', asked.length === 1 && asked[0].id === 'store_in_crate' && asked[0].into === yonder.id,
  JSON.stringify(asked));
game.ask = null;

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`let go over a container — ${ok.length} of ${ok.length}`);
