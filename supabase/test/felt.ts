/**
 * The numbers that float over your head, and why only one kind of them did.
 *
 * Reported as "floating text only shows for climbing". The renderer draws a
 * floater off two events and nothing else: `hit`, with an amount and a place,
 * and `skill`, with an id and a gain. In a game of your own both come out of
 * the code that does the thing — `hurtPlayer` and `gainSkill` — and on an
 * island the island does the thing, so neither runs.
 *
 * Climbing and swimming were the exception, and that is the whole of the
 * report: they are earned off your own feet in `Game.update`, which is one of
 * the few things the browser still owns, so they still went through
 * `gainSkill` and still floated.
 *
 * Nothing new has to be sent for the rest. The island's answer already carries
 * the whole book of skills, the body's health and every creature's, every
 * beat. What was never worked out is the *change*, and that is what this
 * measures.
 */
import { Creatures } from '../../src/game/creatures';
import type { IslandCreature } from '../../src/game/creatures';
import { bodyForward, skillRises, tookOff, BODY_GAP, HURT_FLOOR, SKILL_FLOOR, type Body, type Rise } from '../../src/net/felt';

let fails = 0;
let n = 0;
function say(what: string, got: unknown, want: unknown): void {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? '  ' : '!!'} ${n}. ${what}: ${JSON.stringify(got)}${ok ? '' : ` — wanted ${JSON.stringify(want)}`}`);
}

/** A book of skills as `rpc_settle` hands one over. */
const book = (o: Record<string, number>): Record<string, number> => o;

/** Gains to four places, because a float is a float and this is about which. */
const tidy = (rises: Rise[]): Rise[] => rises.map((r) => ({ id: r.id, gain: +r.gain.toFixed(4) }));

/** What the browser is holding, with 1 for anything it has not heard of. */
const holding = (o: Record<string, number>) => (id: string): number => o[id] ?? 1;

console.log('--- a skill going up, which had no way of being said');

/*
 * What this replaces. The hook set every number and then emitted a gain of
 * nothing, and the renderer drops a gain of nothing — so the log line arrived
 * and the number did not.
 */
const asItWas = { id: '', gain: 0 };
say('the old answer to "which skill went up"', asItWas, { id: '', gain: 0 });
say('and the renderer keeps a gain of', asItWas.gain > 0, false);

const held = holding({ mining: 12.5, digging: 30, climbing: 4 });
say('one skill up, and only that one',
  tidy(skillRises(book({ mining: 12.92, digging: 30, climbing: 4 }), held, true)),
  [{ id: 'mining', gain: 0.42 }]);

say('two at once, in the order the island wrote them',
  skillRises(book({ mining: 12.6, digging: 30.25 }), held, true).map((r) => r.id),
  ['mining', 'digging']);

say('a book that says nothing new',
  skillRises(book({ mining: 12.5, digging: 30 }), held, true), []);

/*
 * The last stretch of a skill moves in ten-thousandths and a player at ninety
 * nine deserves to see it move. `gainSkill` draws its line at the same place,
 * so the two ways a skill can rise agree about when it is worth saying so.
 */
say('a rise of a ten-thousandth still floats',
  skillRises(book({ mining: 12.5001 }), held, true).length, 1);
say('and one under the floor does not',
  skillRises(book({ mining: 12.5 + SKILL_FLOOR / 2 }), held, true), []);
say('nor does one going the other way',
  skillRises(book({ mining: 12.4 }), held, true), []);

// A skill the browser has never heard of starts where every skill starts.
say('a skill first heard of, from the one it started at',
  tidy(skillRises(book({ fishing: 1.09 }), held, true)), [{ id: 'fishing', gain: 0.09 }]);

/*
 * And the join, which is a seeding rather than an afternoon's work: the island
 * hands over the whole book at once and a browser holding a book of ones would
 * otherwise throw up a number for every skill in it.
 */
say('the first answer of a session floats nothing',
  skillRises(book({ mining: 40, digging: 55, fishing: 12 }), holding({}), false), []);
say('and the next one floats what has moved since',
  tidy(skillRises(book({ mining: 40.3, digging: 55, fishing: 12 }), holding({ mining: 40, digging: 55, fishing: 12 }), true)),
  [{ id: 'mining', gain: 0.3 }]);

console.log('\n--- and a body, which is hurt over there');

say('a blow', tookOff(0.9, 0.62).toFixed(2), '0.28');
say('healing is not a blow', tookOff(0.62, 0.9), 0);
say('standing still is not a blow', tookOff(0.9, 0.9), 0);
say('and neither is the last thousandth of a quiet beat',
  tookOff(0.9, 0.9 - HURT_FLOOR / 2), 0);

console.log('\n--- and everything else in front of you');

/** A creature row as `rpc_creatures` hands one over. */
function mob(over: Partial<IslandCreature> = {}): IslandCreature {
  return {
    id: 1, species: 'boar', name: null, variant: null, mode: 'wild', stance: 'calm',
    x: 10, y: 12, fromX: 10, fromY: 12, toX: 10, toY: 12, legFor: 0, legLeft: 0,
    health: 30, max: 30, hunger: 1, sex: 'male', age: 'adult', traits: {},
    hunting: false, mine: false, ...over,
  } as unknown as IslandCreature;
}

const wild = new Creatures();
wild.fromIsland = true;
say('the first sight of a thing is not a wound', wild.sawAll([mob({ health: 30 })]), []);
say('and then a blow off it',
  wild.sawAll([mob({ health: 18 })]), [{ x: 10, y: 12, taken: 12 }]);
say('another, where it now stands',
  wild.sawAll([mob({ health: 6, x: 11, y: 13 })]), [{ x: 11, y: 13, taken: 12 }]);
say('standing there bleeding nothing', wild.sawAll([mob({ health: 6, x: 11, y: 13 })]), []);
say('a beast healing up is not a wound',
  wild.sawAll([mob({ health: 20, x: 11, y: 13 })]), []);
/*
 * A body's top health moves with its age, so an old thing shedding a
 * hundredth as it goes past its prime is not a wound — and the renderer writes
 * anything under a twentieth as "blocked", which would be a lie about it.
 */
say('and neither is an old thing shedding a hundredth',
  wild.sawAll([mob({ health: 19.99, x: 11, y: 13 })]), []);

// One that walked out of range and back is a first sight again, not a wound.
say('out of sight', wild.sawAll([]), []);
say('and back, hurt while it was away, which nobody saw happen',
  wild.sawAll([mob({ health: 2 })]), []);

// Several at once, each answering for itself.
const field = new Creatures();
field.fromIsland = true;
field.sawAll([mob({ id: 1, health: 30 }), mob({ id: 2, health: 40, x: 4, y: 5 })]);
say('two in front of you and one of them struck',
  field.sawAll([mob({ id: 1, health: 30 }), mob({ id: 2, health: 33, x: 4, y: 5 })]),
  [{ x: 4, y: 5, taken: 7 }]);

/*
 * And the body drawn forward, which is the whole of why the bars can be live
 * without asking anything.
 *
 * Every number below is checked against what `body_settle` does with the same
 * input — the island's rates, read out of Postgres:
 *
 *     hunger_rate 5e-05  thirst_rate 7.5e-05  wind_rest 0.05
 *     heal_rate 0.004    heal_fed 0.2         wind_starving 0.3
 */
console.log('\n--- and a body between one answer and the next');

const full: Body = { health: 1, stamina: 1, hunger: 1, thirst: 1 };
const rested = { acting: false, wind: 1 };
const working = { acting: true, wind: 1 };

say('a minute of standing still takes off hunger',
  +(1 - bodyForward(full, 60, rested).hunger).toFixed(6), 0.003);
say('and thirst, half again as fast',
  +(1 - bodyForward(full, 60, rested).thirst).toFixed(6), 0.0045);
say('no time, no change', bodyForward(full, 0, rested), full);
say('and time going backwards is no time at all', bodyForward(full, -5, rested), full);

const worn: Body = { health: 0.5, stamina: 0.2, hunger: 0.8, thirst: 0.8 };
say('ten seconds of wind back, hands empty',
  +bodyForward(worn, 10, rested).stamina.toFixed(4), 0.2 + 10 * 0.05);
say('and none at all with your hands full',
  bodyForward(worn, 60, working).stamina, 0.2);
say('wind does not go past full',
  bodyForward({ ...worn, stamina: 0.99 }, 60, rested).stamina, 1);

say('a minute of knitting, fed and watered',
  +bodyForward(worn, 60, rested).health.toFixed(4), 0.5 + 60 * 0.004);
const starved: Body = { health: 0.5, stamina: 0.2, hunger: 0.1, thirst: 0.8 };
say('and none on an empty stomach', bodyForward(starved, 60, rested).health, 0.5);
say('an empty one gets its wind back at a share of the rate',
  +bodyForward({ ...worn, hunger: 0 }, 10, rested).stamina.toFixed(4), 0.2 + 10 * 0.05 * 0.3);

say('a body twice as good at standing about',
  +bodyForward(worn, 5, { acting: false, wind: 2 }).stamina.toFixed(4), 0.2 + 5 * 0.05 * 2);

// Nothing falls below nothing, and nothing is drawn past what the island will
// settle in one go.
const nearly: Body = { health: 0.5, stamina: 0.2, hunger: 0.0001, thirst: 0.0001 };
say('hunger stops at nothing', bodyForward(nearly, 600, rested).hunger, 0);
say('and a gap longer than the island settles is clamped to it',
  bodyForward(full, 10000, rested).hunger, bodyForward(full, BODY_GAP, rested).hunger);

/*
 * The frame rate and the heartbeat land in the same place, which is what makes
 * this safe to draw: sixty steps of a sixtieth of a second come out where one
 * step of a second does, so the bar does not creep away from the island's own
 * answer between pins.
 */
let stepped = full;
for (let i = 0; i < 600; i++) stepped = bodyForward(stepped, 0.1, rested);
say('six hundred frames of a tenth, against one minute in one go',
  +stepped.hunger.toFixed(9), +bodyForward(full, 60, rested).hunger.toFixed(9));

console.log(fails ? `\n${fails} of ${n} wrong` : `\nall ${n} right`);
process.exit(fails ? 1 : 0);
