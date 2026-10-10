/**
 * Do it again.
 *
 * Asked for: "a repeat last action key, i think that'll help some of the more
 * tedious actions like casting nails." One key asks for the last job asked for
 * once more, through the same `requestAction` every other way of starting a
 * job goes through. What this asks:
 *
 *   * with nothing asked yet it says so and asks for nothing;
 *   * it asks for the same job, on the same target, the same number of times;
 *   * a thing the last job named that is gone is stood in for by another of
 *     the same kind in the pack, and by nothing of another kind;
 *   * a name or a yes given the first time is asked for again, not taken as read;
 *   * the key is the full stop, and nothing else answers to it.
 *
 * The browser's half only: the island is asked exactly as it is for any other
 * ask, so there is nothing new over there to hold.
 */
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, type ActionDef } from '../../src/game/actions';
import { BINDS, BIND_BY_ID } from '../../src/game/keybinds';
import type { Target } from '../../src/game/actions';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const g = Game.create(4242);
const asked: Array<{ def: string; target: Target; goes?: number }> = [];
const real = g.requestAction.bind(g);
g.requestAction = (def: ActionDef, target: Target, goes?: number): void => {
  asked.push({ def: def.id, target, goes });
  real(def, target, goes);
};
const lastSaid = (): string => g.log[g.log.length - 1]?.text ?? '';

g.repeatLast();
check('with nothing asked yet it says so, and asks for nothing', asked.length === 0 && lastSaid() === 'There is nothing to do again yet.', lastSaid());

const examine = ACTION_BY_ID.get('examine_item')!;
// The starter pack has a hatchet of its own; only these two are in play.
for (const it of g.inventory.items.filter((x) => x.id === 'hatchet')) g.inventory.remove(it.uid, it.count);
const a = g.inventory.add('hatchet');
const b = g.inventory.add('hatchet');
const s = g.inventory.add('shovel');
g.requestAction(examine, { kind: 'item', uid: a.uid }, 3);
check('a job asked for is kept, with what it named', g.lastAsked?.def.id === 'examine_item' && g.lastAsked?.was === 'hatchet' && g.lastAsked?.goes === 3);

asked.length = 0;
g.repeatLast();
const again = asked[0];
check('it asks for the same job on the same thing, as many times',
  asked.length === 1 && again.def === 'examine_item' && again.target.kind === 'item' && again.target.uid === a.uid && again.goes === 3,
  JSON.stringify(asked));

g.inventory.remove(a.uid);
asked.length = 0;
g.repeatLast();
const stood = asked[0]?.target;
check('a thing that is gone is stood in for by another of its kind', stood?.kind === 'item' && stood.uid === b.uid, JSON.stringify(stood));

g.inventory.remove(b.uid);
g.lastAsked = { def: examine, target: { kind: 'item', uid: a.uid }, goes: 1, was: 'hatchet' };
asked.length = 0;
g.repeatLast();
const none = asked[0]?.target;
check('and never by a thing of another kind', none?.kind === 'item' && none.uid === a.uid, JSON.stringify(none));

g.requestAction(examine, { kind: 'item', uid: s.uid, name: 'Spade', sure: true } as unknown as Target);
asked.length = 0;
g.repeatLast();
const fresh = asked[0]?.target as (Target & { name?: string; sure?: boolean }) | undefined;
check('a name or a yes given the first time is asked for again', !!fresh && fresh.name === undefined && fresh.sure === undefined, JSON.stringify(fresh));

check('the key is the full stop', BIND_BY_ID.get('repeat')?.keys[0] === 'Period');
check('and nothing else answers to it', BINDS.filter((x) => x.keys.includes('Period')).length === 1);

for (const line of [...ok, ...bad]) console.log(line);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
if (bad.length) process.exit(1);
