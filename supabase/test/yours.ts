/**
 * Whose wildermon the Wildermon window lists.
 *
 * Reported: "When registering as a new player I have all other players
 * wildermon in my wildermon UI before taming anything."
 *
 * On an island every creature near you comes in the one list, the tame ones of
 * everybody who lives there with the wild ones, and the island marks each one
 * yours or not (`mine`). The window listed everything that was not wild, so a
 * newcomer who had tamed nothing was shown every neighbour's herd. The journal's
 * "Keep five species" goal, the list of wildermon to set to a post and the best
 * tier in your herd counted the same way.
 *
 * All four now ask `Creatures.yours()`. By yourself nothing is marked, and
 * every tame one is yours, as there is nobody else to have tamed it.
 */
import { Game } from '../../src/game/game';
import { herdBest } from '../../src/game/husbandry';
import { ALL_GOALS } from '../../src/game/journal';
import { postCandidates } from '../../src/game/posts';

let bad = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) bad++;
  console.log(`${ok ? '  ' : 'X '}${line}`);
};

const game = Game.create(4402);
const five = ALL_GOALS.find((g) => g.id === 'five');
if (!five) throw new Error('the journal has no goal "five"');

/* A neighbour's herd: five species, tame and about, one of them bred to a fantastic line. */
const SPECIES = ['rabba', 'vola', 'woola', 'roxxen', 'cudda'];
game.creatures.list.clear();
const theirs = SPECIES.map((s, i) => {
  const c = game.creatures.spawn(s, game.player.x + 1 + i, game.player.y + 1, 'active', game.rand, game.time);
  c.mine = false;
  return c;
});
theirs[0].traits = ['windborn'];
const wild = game.creatures.spawn('rabba', game.player.x - 2, game.player.y, 'wild', game.rand, game.time);
wild.mine = false;

say(game.creatures.yours().length === 0,
  `a newcomer with ${theirs.length} of a neighbour's wildermon about and one wild one has none of their own (${game.creatures.yours().length})`);
say(!five.met(game), `and has not met "${five.text}"`);
say(postCandidates(game).length === 0, `and has none to set to a post (${postCandidates(game).length})`);
say(herdBest(game) === 'common', `and a herd of nothing is common at best, whatever the neighbour bred (${herdBest(game)})`);

/* The island marks one of them yours. */
theirs[1].mine = true;
say(game.creatures.yours().length === 1 && game.creatures.yours()[0] === theirs[1],
  `once one is marked yours, that one is listed and no other (${game.creatures.yours().length})`);
say(postCandidates(game).length === 1, `and it is the one that can be set to a post (${postCandidates(game).length})`);

/* By yourself nothing is marked: every tame one is yours. */
for (const c of theirs) c.mine = undefined;
wild.mine = undefined;
say(game.creatures.yours().length === theirs.length,
  `by yourself every tame one is yours (${game.creatures.yours().length} of ${theirs.length}), and the wild one is not`);
say(five.met(game), `and five species kept at once meets "${five.text}"`);
say(herdBest(game) === 'fantastic', `and the fantastic line counts as your herd's best (${herdBest(game)})`);

if (bad) {
  console.error(`${bad} of them are not what they should be`);
  process.exit(1);
}
console.log('the Wildermon window lists your own wildermon and nobody else\'s');
