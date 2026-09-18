/**
 * A furnace off the island reads the way one you built yourself does.
 *
 * Reported from the island: "right clicking a smelter that's lit and
 * processing ore partially locks up my game … came back later when the fire
 * had burned out and the behavior's the same." The menu for a smelter lists
 * what is finished in it, by name. The island writes a finished piece as
 * `{def, ql, count, extra}` — its own shape for a thing — and the browser
 * took the list as it came and asked each piece its `id`. No id, no name, and
 * a name with nothing in it cannot be lowercased. The throw came out of the
 * click handler before it had let go of the press, so every move after it
 * read as a drag: the partial lock-up.
 *
 * So this hands `sawGround` a smelter and a kiln exactly as the island hands
 * them — a job as `furnace_settle` writes one, a finished piece as it writes
 * one — and then asks what the menu asks.
 */
import { Game } from '../../src/game/game';
import type { IslandGround } from '../../src/game/game';
import { itemName } from '../../src/game/items';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const game = Game.create(4242);
const off: IslandGround = {
  placed: [
    // Verbatim shapes: a job and a finished lump as the island's firing rules
    // build them, and a fired pot the same way.
    { id: 7, kind: 'smelter', x: 10, y: 10, sx: 0, sy: 0, ql: 40, fuel: 300, lit: true, mine: true,
      state: { jobs: [{ makes: 'iron_lump', left: 120, total: 180, ql: 31.2 }],
               output: [{ def: 'iron_lump', ql: 30.5, count: 1, extra: null }, { def: 'copper_lump', ql: 22, count: 1, extra: null }] } },
    { id: 8, kind: 'kiln', x: 12, y: 10, sx: 0, sy: 0, ql: 40, fuel: 0, lit: false, mine: true,
      state: { jobs: [], output: [{ def: 'clay_pot', ql: 18, count: 2, extra: null }] } },
  ] as unknown as IslandGround['placed'],
  crates: [],
};
game.sawGround(off);

const s = game.smelters.get(7);
const k = game.kilns.get(8);
check('the smelter is there', !!s, s ? `${s.jobs.length} in the furnace, ${s.output.length} finished` : 'missing');
check('the kiln is there', !!k, k ? `${k.output.length} fired` : 'missing');

// What the menu asks of each finished piece, exactly as the menu asks it.
const named = (items: Array<{ id?: string }>): string | Error => {
  try {
    return items.map((o) => itemName(o as never).toLowerCase()).join(', ');
  } catch (e) {
    return e as Error;
  }
};
const fin = named(s?.output ?? []);
check('what is finished in the smelter can be named', typeof fin === 'string' && fin.length > 0, typeof fin === 'string' ? fin : `throws: ${(fin as Error).message}`);
const fired = named(k?.output ?? []);
check('and what is fired in the kiln', typeof fired === 'string' && fired.length > 0, typeof fired === 'string' ? fired : `throws: ${(fired as Error).message}`);
check('a finished piece keeps its quality and count', !!s && s.output[0]?.ql === 30.5 && (s.output[0]?.count ?? 0) === 1 && (k?.output[0]?.count ?? 0) === 2,
  s ? `ql ${s.output[0]?.ql}, count ${s.output[0]?.count}; pot count ${k?.output[0]?.count}` : '');
check('and an id of its own, since it is a thing in the browser now', !!s && s.output.every((o) => typeof o.uid === 'number') && new Set(s.output.map((o) => o.uid)).size === s.output.length,
  s ? `uids ${s.output.map((o) => o.uid).join(', ')}` : '');

// The job the furnace is on, which the game loop moves along when the island's
// clock is not there to: it must be whole enough to finish without throwing.
const job = s?.jobs[0];
check('the job in the furnace says what it makes', !!job && job.makes === 'iron_lump' && job.left === 120, job ? `${job.makes}, ${job.left}s of ${job.total}` : 'no job');
let ran: string | null = null;
try {
  (game as unknown as { runSmelters(dt: number): void }).runSmelters(500);
} catch (e) {
  ran = (e as Error).message;
}
check('and finishing it does not throw', ran === null, ran ?? `${s?.output.length} finished, ${s?.jobs.length} left`);

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} went wrong` : `\nall ${ok.length} right`);
process.exit(bad.length ? 1 : 0);
