/**
 * What is lying on the ground reaches a browser.
 *
 * Reported as "killed a roxxa, no corpse dropped to butcher, or at least isn't
 * displaying". The corpse was on the island; nothing carried it. `rpc_ground`
 * sent the fires, the crates, the crops and the walls and never a thing lying
 * on the grass, and the browser's map of the ground was only ever written by
 * its own rules, which do not run on an island. The answer carries `lying`
 * now, on the fast half, and this hands `sawGround` one exactly as the island
 * hands it: the piles land on their tiles as the island's own rows, a fast
 * answer that says nothing about the ground leaves them standing, an empty
 * list clears them, and a corpse on a tile is a thing the menu offers to
 * butcher.
 */
import { Game } from '../../src/game/game';
import type { IslandGround } from '../../src/game/game';
import type { ItemRow } from '../../src/net/island';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

/** A row as `select *` hands one over, lying on a tile. */
function row(id: number, def: string, gx: number, gy: number, over: Partial<ItemRow> = {}): ItemRow {
  return {
    id, def, ql: 30, dmg: 0, count: 1, extra: null, holder: 'ground', gx, gy,
    charges: null, locked: false, issued: false, rare: null, dye: null, bless: null, maker: null, piece: null,
    lit: false, lit_at: null, inside: null, ...over,
  };
}

const game = Game.create(4242);
game.bodyFromIsland = true;
const fast = (lying?: ItemRow[]): IslandGround => (lying ? { placed: [], crates: [], lying } : { placed: [], crates: [] });

game.sawGround(fast([row(750, 'corpse', 9, 6, { extra: 'Rabba', ql: 25 }), row(751, 'log', 9, 6, { extra: 'Oak', count: 3 }), row(760, 'hatchet', 3, 3, { ql: 20, dmg: 0.5 })]));
check('a ground answer lays the piles in, one a tile', game.ground.size === 2, `${game.ground.size} tiles`);
const pile = game.groundAt(9, 6);
check('two things on the tile the rabba fell on', pile.length === 2, pile.map((it) => it.id).join(', '));
const corpse = pile.find((it) => it.id === 'corpse');
check('the corpse is the island\'s row, id and all', corpse?.uid === 750 && corpse.extra === 'Rabba' && corpse.ql === 25,
  JSON.stringify(corpse));
check('and the logs keep their count', pile.find((it) => it.id === 'log')?.count === 3);
check('the hatchet lies where it was dropped', game.groundAt(3, 3)[0]?.uid === 760);
const offered = game.actionsFor({ kind: 'ground', x: 9, y: 6, uid: 750 }).map((a) => a.def.id);
check('and the menu on that tile offers to butcher it', offered.includes('butcher'), offered.join(', '));
check('and to pick it up', offered.includes('pick_up'), offered.join(', '));

game.sawGround(fast());
check('a fast answer that says nothing about the ground leaves the piles standing', game.ground.size === 2, `${game.ground.size} tiles`);
game.sawGround(fast([row(751, 'log', 9, 6, { extra: 'Oak', count: 3 })]));
check('one that says the corpse has gone takes it off the tile', game.groundAt(9, 6).length === 1 && game.groundAt(3, 3).length === 0,
  `${game.groundAt(9, 6).map((it) => it.id).join(', ')} at 9,6 and ${game.groundAt(3, 3).length} at 3,3`);
game.sawGround(fast([]));
check('and an empty list is a clean floor', game.ground.size === 0, `${game.ground.size} tiles`);

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} went wrong` : `\nall ${ok.length} right`);
process.exit(bad.length ? 1 : 0);
