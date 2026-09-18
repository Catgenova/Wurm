/**
 * What a ground read is allowed to forget.
 *
 * `rpc_ground` answers in two halves. The fast one — everything burning, what
 * is standing on the tiles around you — comes about once a second. The slow
 * one comes on the reconcile and carries the things that hardly move: the
 * settlements, who is ashore, the buildings, and what is growing.
 *
 * So `sawGround` has two kinds of key: ones the answer always carries, which
 * may be cleared and replaced, and ones it carries only sometimes, which may
 * not. Getting that wrong does not look like a bug in the reading — it looks
 * like the thing itself flickering. Crops appeared on a reconcile and vanished
 * a second later on the next fast read, over and over.
 *
 * It has now been got wrong twice in the same function, once for the
 * settlements and once for the crops, so it is worth a test rather than a
 * comment. `undefined` is "nothing said about this"; an empty array is
 * "nothing is there", and they are not the same answer.
 */
import { Game } from '../../src/game/game';
import type { IslandGround } from '../../src/game/game';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const game = Game.create(4242);

/** The slow half, as the island sends it on a reconcile. */
const slow = (): IslandGround => ({
  placed: [],
  crates: [],
  deed: { name: 'Lambfold', x: 5, y: 7, radius: 5, level: 1, mine: true },
  deeds: [],
  folk: [{ uid: 'u1', name: 'Hild', online: true }],
  crops: [
    { x: 12, y: 12, id: 'cotton', stage: 1, ago: 30, tended: 0, tendedNow: false, ql: 40 },
    { x: 13, y: 12, id: 'wheat', stage: 3, ago: 5, tended: 2, tendedNow: true, ql: 55 },
  ],
});

/** And the fast half, which says nothing at all about any of that. */
const fast = (): IslandGround => ({ placed: [], crates: [] });

game.sawGround(slow());
check('a reconcile lays the crops in', game.crops.size === 2, `${game.crops.size} of 2`);
const sown = game.cropAt(12, 12);
check('with the stage the island gave them', sown?.stage === 1 && sown?.id === 'cotton',
  sown ? `${sown.id} at stage ${sown.stage}` : 'nothing at 12,12');
// The island counts from a timestamp and this side counts in its own seconds,
// so what crosses is how long the stage has been running.
check('and counting from how long it has been in it',
  !!sown && Math.abs(game.time - (sown.stageAt ?? 0) - 30) < 0.01,
  sown ? `${(game.time - sown.stageAt).toFixed(2)}s into the stage, told 30` : 'no crop');

/*
 * The one that was reported: a second later, a fast read arrives carrying
 * nothing about crops at all.
 */
for (let i = 0; i < 5; i++) game.sawGround(fast());
check('and a fast read does not take them away again', game.crops.size === 2,
  `${game.crops.size} of 2 left after five fast reads`);
check('nor the settlement', game.deed?.name === 'Lambfold', game.deed?.name ?? 'gone');
check('nor who is ashore', game.folkAshore.length === 1, `${game.folkAshore.length} of 1`);

/* But a reconcile that says the field is bare is an answer, and is obeyed. */
game.sawGround({ ...slow(), crops: [] });
check('an empty answer is still an answer', game.crops.size === 0, `${game.crops.size} left`);

/* And one that lists a different field replaces rather than merges. */
game.sawGround(slow());
game.sawGround({ ...slow(), crops: [{ x: 1, y: 1, id: 'cotton', stage: 0, ago: 0, tended: 0, tendedNow: false, ql: 10 }] });
check('and a later answer replaces the earlier one',
  game.crops.size === 1 && !!game.cropAt(1, 1) && !game.cropAt(12, 12),
  `${game.crops.size} crop, at ${[...game.crops.values()].map((c) => `${c.x},${c.y}`).join(' ')}`);

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} went wrong` : `\nall ${ok.length} right`);
process.exit(bad.length ? 1 : 0);
