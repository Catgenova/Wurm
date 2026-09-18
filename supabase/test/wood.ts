/**
 * The crafting window's choice of wood.
 *
 * Asked for: "when making products from wood, allow the wood type selection".
 * A pack with oak and pine in it: the window said "of oak" for a deed stake
 * because there was more oak, and the only way to a pine one was to find
 * the pine stack in the pack and click that. `materialChoices` lists the
 * woods carried for a recipe, `recipeStatus` takes the one the row is set to
 * so long as any of it is carried, and the counts and the maximum follow it.
 * A clicked stack still wins over the row, and a recipe that names its wood
 * offers nothing to choose.
 */
import { ACTION_BY_ID } from '../../src/game/actions';
import { Game } from '../../src/game/game';
import { RECIPES, chooseMaterial, materialChoices, recipeStatus } from '../../src/game/recipes';

let fails = 0;
let n = 0;
function say(what: string, got: unknown, want: unknown): void {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? '  ' : '!!'} ${n}. ${what}: ${JSON.stringify(got)}${ok ? '' : ` — wanted ${JSON.stringify(want)}`}`);
}

const game = Game.create(4242);
const pack = game.inventory;
for (const it of [...pack.items]) if (['shaft', 'log', 'carving_knife'].includes(it.id)) pack.remove(it.uid, it.count);
pack.add('carving_knife', { ql: 40 });
pack.add('shaft', { count: 5, extra: 'Oak', ql: 40 });
const pine = pack.add('shaft', { count: 2, extra: 'Pine', ql: 40 });

const stake = RECIPES.find((r) => r.id === 'make_deed_stake')!;
console.log('--- a deed stake, from a pack with five oak shafts and two pine');
say('the woods on offer', materialChoices(game, stake), ['Oak', 'Pine']);
const plain = recipeStatus(stake, game);
say('left alone the row says', plain.material, 'Oak');
say('and can make', plain.max, 5);
const set = recipeStatus(stake, game, 'Pine');
say('set to pine it says', set.material, 'Pine');
say('counts the pine shafts', set.inputs.find((i) => i.item === 'shaft')?.have, 2);
say('and can make', set.max, 2);
say('set to a wood not carried it falls back to', recipeStatus(stake, game, 'Birch').material, 'Oak');
say('the pine stack clicked beats a row set to oak', chooseMaterial(game, stake, pine.uid, 'Oak'), 'Pine');

const bow = RECIPES.find((r) => r.id === 'make_short_bow')!;
console.log('\n--- a bow, which is willow and nothing else');
say('offers no choice', materialChoices(game, bow), []);
say('and says', recipeStatus(bow, game, 'Oak').material, 'Willow');

console.log('\n--- and making the thing of the wood the row was set to');
pack.add('log', { count: 2, extra: 'Oak', ql: 40 });
const pineLog = pack.add('log', { count: 1, extra: 'Pine', ql: 40 });
const shafts = RECIPES.find((r) => r.id === 'make_shafts')!;
say('the row set to pine finds the pine log', recipeStatus(shafts, game, 'Pine').material, 'Pine');
// What the window's Craft button does: start on a stack of what the row said.
const stack = pack.items.find((it) => it.id === 'log' && it.extra === recipeStatus(shafts, game, 'Pine').material);
say('and the stack it starts on is the pine log', stack?.uid, pineLog.uid);
ACTION_BY_ID.get('make_shafts')!.perform({ kind: 'item', uid: pineLog.uid }, game);
say('four shafts of pine come off it', pack.items.filter((it) => it.id === 'shaft' && it.extra === 'Pine').reduce((s, it) => s + it.count, 0), 6);
say('and the oak logs are untouched', pack.items.filter((it) => it.id === 'log' && it.extra === 'Oak').reduce((s, it) => s + it.count, 0), 2);

console.log(fails ? `\n${fails} of ${n} wrong` : `\nall ${n} right`);
process.exit(fails ? 1 : 0);
