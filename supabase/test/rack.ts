/**
 * The crate rack: loading it, reading it, and lifting it.
 *
 * Reported: "no way to add crates to crate shelf and it looks more like a
 * table than a double decker shelf with box slots."
 *
 * The rules were all there and had been since the rack was built. `rackAt`
 * knows whether a spot is a deck, `place_crate` skips the ground rules on one
 * and refuses anything but a plank crate on the runners, `cratesOn` reads it,
 * and `pick_up_furniture` will not take a loaded rack out from under its
 * crates. What was missing was any way to *reach* them: the placing lived in
 * the tile menu, and a click on a tile with furniture on it never gets that
 * far — it is the piece's menu that opens. And a crate on a deck is drawn by
 * the rack rather than as an entity of its own, so it had no hit box either:
 * eight crates you could neither put up nor open.
 *
 * So the rack's own menu now loads it and reaches what is on it. This measures
 * the rules under that menu, and the mask the model draws from — bit n is the
 * nth spot in `rackDeck` order, which is the order the model fills.
 */
import { Game } from '../../src/game/game';
import { ACTION_BY_ID } from '../../src/game/actions';
import { furnitureCapacity, furnitureUnits, rackDeck, rackSpots } from '../../src/game/furniture';
import { crateKindOfItem } from '../../src/game/crates';
import type { Target } from '../../src/game/actions';

let bad = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) bad++;
  console.log(`${ok ? '  ' : 'X '}${line}`);
};

const game = Game.create(4242, 96);
const w = game.world;

/* Flat, dry ground for the rack to stand on, right where the player is. */
const x = game.player.tileX;
const y = game.player.tileY;
for (let cy = y; cy <= y + 1; cy++) for (let cx = x; cx <= x + 1; cx++) w.setHeight(cx, cy, Math.max(20, w.getHeight(cx, cy)));

const shelf = game.addFurniture('crate_shelf', x, y, 0, 0, 20);
say(rackSpots(shelf) === 8, `a crate shelf has ${rackSpots(shelf)} spots`);
const deck = rackDeck(shelf);
say(deck.length === 8, `and its deck is ${deck.length} subtiles: ${deck.map(([sx, sy]) => `${sx},${sy}`).join(' ')}`);
say(deck.every(([sx, sy]) => game.rackAt(x, y, sx, sy) === shelf), 'every one of them answers as the rack');
say(game.rackAt(x, y, 3, 3) === undefined, 'and a subtile off the deck does not');

const place = ACTION_BY_ID.get('place_crate');
if (!place) {
  say(false, 'there is no place_crate action');
  process.exit(1);
}
const spot = (n: number, uid: number): Target =>
  ({ kind: 'tile', x, y, cx: x, cy: y, sx: deck[n][0], sy: deck[n][1], itemUid: uid });

/* A log crate will not sit on the runners; a plank crate will. */
const log = game.inventory.add('crate_log', { ql: 20 });
const logWhy = place.check?.(spot(0, log.uid), game) ?? null;
say(!!logWhy && logWhy.includes('will not sit on the runners'), `a log crate on the deck: ${logWhy ?? 'ALLOWED'}`);
game.inventory.remove(log.uid, 1);

/* Eight plank crates, put up one at a time, and the ninth with nowhere to go. */
let placed = 0;
for (let n = 0; n < 9; n++) {
  const it = game.inventory.add('crate_plank', { ql: 20 });
  say(!!crateKindOfItem(it.id), n === 0 ? 'a plank crate is a crate to the rules' : `crate ${n + 1} in hand`);
  const free = deck.findIndex(([sx, sy]) => !game.crateAt(x, y, sx, sy));
  if (free < 0) {
    say(n === 8, `with eight up there is no spot left for the ninth (${n + 1} tried)`);
    game.inventory.remove(it.uid, 1);
    break;
  }
  const why = place.check?.(spot(free, it.uid), game) ?? null;
  if (why) {
    say(false, `spot ${free} refused: ${why}`);
    break;
  }
  place.perform?.(spot(free, it.uid), game);
  placed++;
}
say(placed === 8, `${placed} crates went up on the rack`);
say(game.cratesOn(shelf).length === 8, `and the rack reads ${game.cratesOn(shelf).length} of 8 full`);

/* The mask the model draws from: bit n is the nth spot, in deck order. */
const maskOf = (): number => {
  let m = 0;
  deck.forEach(([sx, sy], n) => { if (game.crateAt(x, y, sx, sy)) m |= 1 << n; });
  return m;
};
say(maskOf() === 0xff, `the model is told all eight: 0b${maskOf().toString(2).padStart(8, '0')}`);

/*
 * And the gross, which is what a rack has to say about itself: it holds
 * nothing of its own, so every reader of a piece of furniture said it was
 * empty however loaded it was. Asked for as "show inventory gross (x/x)".
 */
const empty = game.rackLoad(shelf);
say(empty.crates === 8 && empty.units === 0 && empty.capacity > 0,
  `eight empty crates on it: ${empty.crates} of ${empty.spots} spots, ${empty.units} / ${empty.capacity} things`);
say(furnitureCapacity(shelf) === 0 && furnitureUnits(shelf) === 0,
  'the rack itself holds nothing, which is why the gross had to be added up from the crates');

let put = 0;
let uid = 90001;
for (const c of game.cratesOn(shelf).slice(0, 3)) {
  for (let i = 0; i < 4; i++) {
    // Straight into the crate rather than through the pack: `inventory.add`
    // stacks, and a stack that grows is not four things going in.
    if (game.crateAdd(c, { uid: uid++, id: 'iron_ore', ql: 20, dmg: 0, count: 1 })) put += 1;
  }
}
const loaded = game.rackLoad(shelf);
say(loaded.units === put, `${put} ore into three of them: ${loaded.units} / ${loaded.capacity} things on the rack`);
say(loaded.capacity === empty.capacity, 'and the room on it has not changed, only what is in it');

// Emptied again, so what follows is about lifting rather than about loading.
for (const c of game.cratesOn(shelf)) c.items.length = 0;
say(game.rackLoad(shelf).units === 0, 'taken out again: 0 of the gross left');

/* Lifting the rack out from under them is refused, and lifting them is not. */
const lift = ACTION_BY_ID.get('pick_up_furniture');
const ft: Target = { kind: 'furniture', id: shelf.id };
const liftWhy = lift?.check?.(ft, game) ?? null;
say(!!liftWhy && liftWhy.includes('off it first'), `lifting a loaded rack: ${liftWhy ?? 'ALLOWED'}`);

const takeUp = ACTION_BY_ID.get('pick_up_crate');
for (const c of [...game.cratesOn(shelf)]) {
  const ct: Target = { kind: 'crate', id: c.id };
  const why = takeUp?.check?.(ct, game) ?? null;
  if (why) { say(false, `taking a crate off the rack: ${why}`); break; }
  takeUp?.perform?.(ct, game);
}
say(game.cratesOn(shelf).length === 0, `the rack is empty again: ${game.cratesOn(shelf).length} of 8`);
say(maskOf() === 0, 'and the model is told so');
const nowWhy = lift?.check?.(ft, game) ?? null;
say(nowWhy === null, `lifting the empty rack: ${nowWhy ?? 'ALLOWED'}`);

/* Two crates at the far end, which is what says the mask is places and not a count. */
for (const n of [6, 7]) {
  const it = game.inventory.add('crate_plank', { ql: 20 });
  place.perform?.(spot(n, it.uid), game);
}
say(maskOf() === 0b11000000, `two at the far end read as 0b${maskOf().toString(2).padStart(8, '0')}, not as a count of two`);

if (bad) {
  console.error(`${bad} of them are not what they should be`);
  process.exit(1);
}
console.log('a rack takes eight crates, says which of its spots are full, and will not be lifted out from under them');
