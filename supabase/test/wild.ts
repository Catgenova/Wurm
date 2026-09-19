/**
 * What the wild mix actually comes out as.
 *
 * Reported: "with wildermon like mola, their spawn points can be over seams
 * buried, not just exposed. I have yet to see a single mola spawn."
 *
 * The first half was already so. `suits` asks `bedrockAt`, which is the rock
 * under a tile whether it is bare or under ten feet of soil, so a mola settles
 * anywhere there is metal beneath it — and nine in ten of those tiles are
 * ordinary ground with a seam under them. Measured below.
 *
 * The second half was real, and the cause was the order of the two rolls. The
 * spawner picked a tile, rolled what stood up on it against `WILD_SPECIES`,
 * and threw the roll away if that tile was wrong for it. A species is then not
 * as common as its weight says: it is as common as its weight times the share
 * of the island that suits it. Mola is one in thirty by weight and metal is
 * about a seventh of the ground, so a mola was one in two hundred — and it is
 * only ever standing on metal, which is the hills.
 *
 * So the roll is kept and a place is looked for (`SITE_LOOKS` looks at ground a
 * creature could stand on). This measures the mix that comes out against the
 * weights, and against the arithmetic of the old scheme.
 */
import { Game } from '../../src/game/game';
import { SITE_LOOKS, SPECIES, WILD_SPECIES } from '../../src/game/creatures';
import { bedrockAt } from '../../src/world/ore';
import { isSeam, TileType } from '../../src/world/tiles';

/*
 * Enough rolls that a species living on a twentieth of the island is counted
 * in hundreds rather than in ones: this is a measurement, and a bar it clears
 * by luck half the time is not a measurement of anything. Two thousand was not
 * enough — a snout is one roll in a hundred and fifty, so a run held a dozen
 * of them and a dozen wanders by four, which is most of the bar.
 */
const HOW_MANY = 20000;

let bad = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) bad++;
  console.log(`${ok ? '  ' : 'X '}${line}`);
};

const game = Game.create(20260918, 192);
const w = game.world;
const weight = new Map(WILD_SPECIES);
const total = WILD_SPECIES.reduce((n, [, v]) => n + v, 0);

/* The ground first: what a spawner has to choose from, and what suits whom. */
const ground: Array<{ x: number; y: number }> = [];
for (let y = 0; y < w.h; y++) {
  for (let x = 0; x < w.w; x++) {
    if (!game.creatures.tileOk(game, x, y)) continue;
    if (w.centerHeight(x, y) < 2 || game.onDeed(x, y)) continue;
    ground.push({ x, y });
  }
}
const suitShare = new Map<string, number>();
for (const [id] of WILD_SPECIES) {
  const n = ground.filter((g) => game.creatures.suits(game, SPECIES[id], g.x, g.y)).length;
  suitShare.set(id, n / Math.max(1, ground.length));
}

const molaGround = ground.filter((g) => game.creatures.suits(game, SPECIES.mola, g.x, g.y));
const bare = molaGround.filter((g) => w.getTile(g.x, g.y) === TileType.Rock).length;
console.log(`${w.w} x ${w.h}: ${ground.length} tiles a creature can be put down on, ${molaGround.length} of them suit a mola`);
say(molaGround.length > 0, `a mola has somewhere to live: ${(100 * molaGround.length / ground.length).toFixed(1)}% of the ground`);
say(bare < molaGround.length / 2,
  `and it is mostly buried metal rather than bare faces: ${molaGround.length - bare} buried, ${bare} bare`);
say(molaGround.every((g) => isSeam(bedrockAt(w, g.x, g.y))),
  'every one of them has a seam under it');

/* What the old scheme came out as, which is arithmetic rather than a guess:
 * the roll is thrown away when the tile is wrong, so a species is placed in
 * proportion to its weight times the share of the ground that suits it. */
const oldWeighted = new Map<string, number>();
let oldTotal = 0;
for (const [id, wt] of WILD_SPECIES) {
  const v = wt * (suitShare.get(id) ?? 0);
  oldWeighted.set(id, v);
  oldTotal += v;
}

/* And what comes out now. */
for (const c of [...game.creatures.list.values()]) game.creatures.list.delete(c.id);
const placed = game.creatures.spawnSpecies(game, null, HOW_MANY, 0);
const got = new Map<string, number>();
for (const c of game.creatures.list.values()) got.set(c.species, (got.get(c.species) ?? 0) + 1);
say(placed >= HOW_MANY * 0.9, `${placed} of ${HOW_MANY} asked for were put down`);

console.log('');
console.log('  species   weight   ground   was    now');
const watched = ['rabba', 'vola', 'mola', 'dowse', 'crawler', 'quarra', 'gorral', 'wadd', 'bogga', 'lume'];
for (const id of watched) {
  if (!weight.has(id)) continue;
  const want = 100 * (weight.get(id) as number) / total;
  const was = 100 * (oldWeighted.get(id) ?? 0) / oldTotal;
  const now = 100 * (got.get(id) ?? 0) / Math.max(1, placed);
  console.log(`  ${id.padEnd(9)} ${want.toFixed(1).padStart(5)}%  ${(100 * (suitShare.get(id) ?? 0)).toFixed(0).padStart(4)}%  ${was.toFixed(2).padStart(5)}%  ${now.toFixed(2).padStart(5)}%`);
}
console.log('');

/*
 * Two bars, because eight looks are eight looks. A species with a tenth of the
 * island to live on is found nearly every time, and should come out near its
 * weight; one living on a twentieth is found about half the time, and should
 * at least be worth several of what the old scheme left it. Anything whose
 * ground is under one tile in fifty here is not being measured by 900 rolls.
 */
let thin = 0;
/*
 * And every bar below is set three draws' worth of luck under where it is
 * aimed. A count out of a bag wanders by about its own square root, so a bar a
 * true scheme trips over one run in twenty is not a bar, it is a coin — which
 * is what a snout at 0.30% against a weight of 0.68% turned out to be, six of
 * them where thirteen were due.
 */
const slack = (rate: number): number => 3 * Math.sqrt(Math.max(1, rate * placed)) / Math.max(1, placed);
for (const [id, wt] of WILD_SPECIES) {
  const share = suitShare.get(id) ?? 0;
  if (share < 0.02) continue;
  const want = wt / total;
  const was = (oldWeighted.get(id) ?? 0) / oldTotal;
  const now = (got.get(id) ?? 0) / Math.max(1, placed);
  if (share >= 0.1) {
    if (now + slack(want) < want * 0.5) say(false, `${id} came out at ${(now * 100).toFixed(2)}% against a weight of ${(want * 100).toFixed(2)}% (${(share * 100).toFixed(0)}% of the ground suits it)`);
  } else {
    thin++;
    if (now + slack(was * 1.5) < was * 1.5) say(false, `${id} came out at ${(now * 100).toFixed(2)}%, no better than the ${(was * 100).toFixed(2)}% the old scheme gave it`);
  }
}
say(true, `every species with a tenth of the island to live on is within half its weight, and the ${thin} living on less are worth half again as much as they were`);

const molaWant = (weight.get('mola') as number) / total;
const molaNow = (got.get('mola') ?? 0) / Math.max(1, placed);
const molaWas = (oldWeighted.get('mola') ?? 0) / oldTotal;
say(molaNow > molaWas * 2, `a mola is ${(molaNow / Math.max(1e-9, molaWas)).toFixed(1)} times commoner than the old scheme put it`);
say(molaNow + slack(molaWant) >= molaWant * 0.5, `one in ${Math.round(1 / Math.max(1e-9, molaNow))} of the wild rather than one in ${Math.round(1 / Math.max(1e-9, molaWas))}`);
say(SITE_LOOKS > 0, `${SITE_LOOKS} looks at ground per roll, which is what the island reads as site_looks()`);

if (bad) {
  console.error(`${bad} of them are not what they should be`);
  process.exit(1);
}
console.log('the wild mix is the mix the weights ask for, and a mola lives over buried metal');
