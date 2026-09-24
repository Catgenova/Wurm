/**
 * The first ten minutes, and the rules nobody says out loud.
 *
 * There is no tutorial on this island and never has been. The journal is
 * eighty-five goals in eleven chapters, all on screen at once, which is a
 * good list and a poor answer to the only question somebody who came ashore
 * ninety seconds ago actually has — "what now" — because a list says
 * everything at the same volume and leaves the reading to you.
 *
 * So the chapters are taken as the order they were written as, and the goals
 * nearest the front are read out one at a time, in as many words as it takes,
 * until the stake is in the ground. Then it stands down for good, because by
 * then the question has become "what else" and the list is the right answer
 * to that one.
 *
 * And one rule is said out loud that never was. The quality of everything
 * anybody makes here is decided in one function and explained nowhere: your
 * skill is the ceiling and your tool decides how often you reach it. That was
 * reported as the game being broken — "i've made a lot of whetstones and
 * haven't managed anything other than QL 1" — which is what a rule looks like
 * from outside when nobody has said it. Every recipe row says it now.
 *
 * Needs no database.
 */
// `game` first, deliberately. It is the root of the module graph here and
// pulling a leaf of it in ahead of it leaves the leaf half-built — `RECIPES`
// comes out undefined, which is a cycle rather than a bug in either file.
import { Game } from '../../src/game/game';
import { ALL_GOALS, JOURNAL, ashore, chapterOf, nextGoals } from '../../src/game/journal';
import { RECIPES, prospect } from '../../src/game/recipes';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

/* ---- the guide leads, and then gets out of the way ------------------------ */

const none = new Set<string>();
const first = nextGoals(none, 3);
check('somebody who has done nothing is pointed at the first thing in the first chapter',
  first.length === 3 && first[0].id === JOURNAL[0].goals[0].id && chapterOf(first[0].id) === JOURNAL[0].name,
  `${chapterOf(first[0].id)}: ${first.map((g) => g.text.toLowerCase()).join(', then ')}`);

/*
 * The instruction, not the note. `hint` is a line in a list read by somebody
 * who knows what they are looking at; `how` is for somebody who does not yet
 * know that right-click is how anything happens at all.
 */
const opening = JOURNAL[0].goals;
check('and every goal in that first chapter says how, in as many words as it takes',
  opening.every((g) => (g.how ?? '').length > 60),
  `${opening.length} goals, the shortest of them ${Math.min(...opening.map((g) => (g.how ?? '').length))} characters`);
check('and each of those names something the player can actually see and press',
  opening.every((g) => /right-click|crafting|\(r\)|pack/i.test(g.how ?? '')),
  'each says where to click or what to open');

/* Doing them in order walks the guide down the chapter. */
const done = new Set<string>();
const walked: string[] = [];
for (const goal of opening) {
  const next = nextGoals(done, 1)[0];
  walked.push(next?.id ?? '(none)');
  done.add(goal.id);
}
check('ticking them off in order walks the guide down the chapter, one at a time',
  walked.join(',') === opening.map((g) => g.id).join(','), walked.join(' → '));

check('and once the stake is in the ground the guide stands down',
  !ashore(none) && ashore(done), `${done.size} of ${opening.length} done`);
check('while the journal itself carries on, into the next chapter',
  nextGoals(done, 1)[0]?.id === JOURNAL[1].goals[0].id,
  `next up: ${nextGoals(done, 1)[0]?.text.toLowerCase()} — ${chapterOf(nextGoals(done, 1)[0]?.id ?? '')}`);

const all = new Set(ALL_GOALS.map((g) => g.id));
check('and somebody who has done the lot is offered nothing, rather than the first thing again',
  nextGoals(all, 3).length === 0, `${all.size} goals, none left`);

/* ---- your skill is the ceiling, your tool is how often you reach it ------- */

/*
 * The afternoon that was reported, measured rather than argued about: a
 * beginner with the chisel they washed ashore with. The copper chisel is
 * quality fifteen and stonecutting starts at one.
 */
const g = Game.create(4242);
const stone = RECIPES.find((r) => r.tool === 'chisel' && r.skill === 'stonecutting');
check('there is a stonecutting recipe that takes a chisel to measure this with', !!stone, stone?.id ?? 'none found');
if (stone) {
  const green = prospect(stone, g);
  check('a beginner is told their ceiling is their own hands, and it is low',
    green.ceiling <= 2 && green.tooled, `QL ${green.ceiling.toFixed(1)}, with a tool`);
  check('and that the issued chisel reaches it only now and then',
    green.reach > 0 && green.reach < 0.25, `${Math.round(green.reach * 100)}% of goes`);

  /*
   * And the same bench after an afternoon's work, which is the half that
   * makes the first half worth saying: the number moves, and it is the tool
   * that moves it.
   */
  g.skills.values.set('stonecutting', 60);
  const skilled = prospect(stone, g);
  check('a trained hand raises the ceiling',
    skilled.ceiling >= 59, `QL ${skilled.ceiling.toFixed(0)}`);
  check('and with a rough tool the tool is named as the thing in the way',
    skilled.toolBound, `reaching ${Math.round(skilled.reach * 100)}% of the time, the rest near QL ${skilled.short.toFixed(0)}`);
  check('while a miss with it is no longer rubbish, which is what was reported',
    skilled.short > 10, `a go that falls short comes out near QL ${skilled.short.toFixed(0)}`);

  g.inventory.add('chisel', { ql: 90, extra: 'Steel' });
  const kitted = prospect(stone, g);
  check('and a good tool stops being the thing in the way',
    !kitted.toolBound && kitted.reach > 0.8, `${Math.round(kitted.reach * 100)}% of goes at QL ${kitted.ceiling.toFixed(0)}`);
  check('without ever raising the ceiling above the hands, which is the rule',
    kitted.ceiling === skilled.ceiling, `QL ${kitted.ceiling.toFixed(0)} either way`);
}

/*
 * And the line is offered for every recipe rather than the handful somebody
 * thought of, since a recipe with no answer would silently say nothing.
 *
 * A thing made out of its parts has no roll and so no short: what it comes
 * out at is the parts, and until they are at hand the line is the share of
 * them the hands keep. That rule came after this check was written, and
 * every one of those recipes failed it for having no roll to report.
 */
const dumb = RECIPES.filter((r) => {
  const pr = prospect(r, g);
  if (pr.fromInputs) return !(pr.keep > 0 && pr.keep <= 1 && (!pr.partsInHand || (pr.ceiling >= 1 && pr.ceiling <= 100)));
  return !(pr.ceiling >= 1 && pr.ceiling <= 100 && pr.reach >= 0 && pr.reach <= 1 && pr.short >= 1);
});
check('every recipe in the book can say what it would come out at',
  dumb.length === 0, dumb.length ? dumb.slice(0, 3).map((r) => r.id).join(', ') : `${RECIPES.length} recipes`);
check('and a recipe needing no tool is never held back by one',
  RECIPES.filter((r) => !r.tool).every((r) => !prospect(r, g).toolBound && !prospect(r, g).tooled),
  `${RECIPES.filter((r) => !r.tool).length} of them take no tool`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`somebody coming ashore is told what to do and what decides it — ${ok.length} of ${ok.length}`);
