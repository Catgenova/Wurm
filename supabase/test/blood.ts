/**
 * Thirty traits for a fight, each with a roll of its own for the grade.
 *
 * Asked for: "add 30 combat traits that can roll on wildermon, each with its
 * own rarity roll as well". A plain trait is its tier; fighting blood is a
 * name and a grade, and the grade is rolled for it. Measured here: the thirty
 * names in four grades each, climbing the right way on every channel; what
 * share of the wild's rolls is fighting blood and how its grades fall; that
 * no animal ever carries two grades of one name; and that a line bred from a
 * fanged (rare) sire and a fanged (supreme) dam climbs to fanged (fantastic)
 * rather than into some other name.
 */
import { BY_TIER, CHANNELS, DOWN_CHANNELS, FIGHT_SHARE, FIGHTING, FIGHTING_TRAITS, TIERS, TRAITS, WILD_ODDS,
         auraMul, breedTraits, familyOf, gradeId, rollTrait, rollTraits, traitMul, traitOf, type TraitTier } from '../../src/game/traits';

let n = 0;
let fails = 0;
function say(what: string, got: unknown, want: unknown): void {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? '  ' : '!!'} ${n}. ${what}: ${JSON.stringify(got)}${ok ? '' : ` — wanted ${JSON.stringify(want)}`}`);
}
function near(what: string, got: number, want: number, within: number): void {
  n++;
  const ok = Math.abs(got - want) <= within;
  if (!ok) fails++;
  console.log(`${ok ? '  ' : '!!'} ${n}. ${what}: ${got.toFixed(4)} against ${want} ± ${within}`);
}
/** A seeded random, so the odds measured are the same odds every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log('--- the table');
say('thirty names', FIGHTING.length, 30);
say('in four grades each', FIGHTING_TRAITS.length, 120);
say('and no two rows share an id', new Set(TRAITS.map((t) => t.id)).size, TRAITS.length);
say('the plain traits are still what they were', Object.values(BY_TIER).reduce((a, b) => a + b.length, 0), 31);
say('and none of them is a grade of anything', Object.values(BY_TIER).flat().filter((t) => t.family).length, 0);
say('every grade names its family', FIGHTING_TRAITS.filter((t) => familyOf(t.id) !== t.family).length, 0);
say('common is the bare name and the rest wear their grade', FIGHTING.map((f) => TIERS.map((tier) => traitOf(gradeId(f.id, tier))?.name)).flat().filter((name, i) => {
  const tier = TIERS[i % 4];
  return tier === 'common' ? !!name?.includes('(') : !name?.endsWith(`(${tier})`);
}).length, 0);
const wrongWay: string[] = [];
for (const f of FIGHTING) {
  for (const ch of Object.keys(f.gains) as Array<keyof typeof f.gains>) {
    const muls = TIERS.map((tier) => traitOf(gradeId(f.id, tier))?.effects[ch] as number);
    const down = DOWN_CHANNELS.has(ch);
    for (let i = 1; i < 4; i++) if (down ? muls[i] >= muls[i - 1] : muls[i] <= muls[i - 1]) wrongWay.push(`${f.id}.${ch}`);
    if (down ? muls[0] >= 1 : muls[0] <= 1) wrongWay.push(`${f.id}.${ch} at common`);
  }
}
say('every grade climbs the right way on every channel', wrongWay, []);
say('the channels where less is better say so on the card', CHANNELS.filter((ch) => ch.up === DOWN_CHANNELS.has(ch.id)).map((ch) => ch.id), []);
say('a communal grade lifts the herd and a plain grade does not', [auraMul(['shield_wall_rare'], 'soak') < 1, auraMul(['plated_fantastic'], 'soak')], [true, 1]);
say('fanged in its four grades', TIERS.map((tier) => traitOf(gradeId('fanged', tier))?.effects.tough), [1.1, 1.25, 1.45, 1.7]);
say('plated in its four grades, which is less of a blow', TIERS.map((tier) => traitOf(gradeId('plated', tier))?.effects.soak), [0.893, 0.769, 0.649, 0.543]);
say('two grades of a set multiply like any other traits', Math.round(traitMul(['plated_fantastic', 'shield_wall'], 'soak') * 1000) / 1000, Math.round(0.543 * 0.962 * 1000) / 1000);

console.log('\n--- the wild');
const rand = seeded(4242);
const draws = 40000;
let fighting = 0;
const grades: Record<TraitTier, number> = { common: 0, rare: 0, supreme: 0, fantastic: 0 };
const plain: Record<TraitTier, number> = { common: 0, rare: 0, supreme: 0, fantastic: 0 };
for (let i = 0; i < draws; i++) {
  const id = rollTrait(rand) as string;
  const t = traitOf(id);
  if (!t) throw new Error(`rolled a trait that is not on the table: ${id}`);
  if (t.family) {
    fighting++;
    grades[t.tier]++;
  } else plain[t.tier]++;
}
console.log(`   ${draws} rolls: ${fighting} fighting blood, graded ${TIERS.map((t) => `${t} ${grades[t]}`).join(', ')}; plain ${TIERS.map((t) => `${t} ${plain[t]}`).join(', ')}`);
near('the share of a roll that is fighting blood', fighting / draws, FIGHT_SHARE, 0.01);
near('a fighting trait rolls common at the wild odds', grades.common / fighting, WILD_ODDS.common, 0.01);
near('rare', grades.rare / fighting, WILD_ODDS.rare, 0.008);
near('supreme', grades.supreme / fighting, WILD_ODDS.supreme, 0.004);
near('fantastic', grades.fantastic / fighting, WILD_ODDS.fantastic, 0.002);
near('and so does a plain one', plain.common / (draws - fighting), WILD_ODDS.common, 0.01);
let short = 0;
let twice = 0;
for (let i = 0; i < 5000; i++) {
  const t = rollTraits(rand);
  if (t.length !== 3) short++;
  if (new Set(t.map(familyOf)).size !== t.length) twice++;
}
say('five thousand animals, every one with three traits', short, 0);
say('and none carrying one name twice', twice, 0);

console.log('\n--- breeding');
const sire = ['fanged_rare', 'thick_hided', 'fleet'];
const dam = ['fanged_supreme', 'plated', 'swift'];
const foals = 3000;
let bredShort = 0;
let bredTwice = 0;
let fangedTop = 0;
let fangedCommon = 0;
let climbedPlain = 0;
const topPlain = new Set(BY_TIER.fantastic.map((t) => t.id));
for (let i = 0; i < foals; i++) {
  const t = breedTraits(sire, dam, 100, 1, rand);
  if (t.length !== 3) bredShort++;
  if (new Set(t.map(familyOf)).size !== t.length) bredTwice++;
  if (t.includes('fanged_fantastic')) fangedTop++;
  if (t.includes('fanged')) fangedCommon++;
  if (t.some((id) => topPlain.has(id))) climbedPlain++;
}
console.log(`   ${foals} foals: ${fangedTop} fanged (fantastic), ${fangedCommon} plain fanged, ${climbedPlain} with a fantastic plain trait`);
say('every foal has three traits', bredShort, 0);
say('and none carries a name twice, though both parents were fanged', bredTwice, 0);
say('a line climbs a grade of its own name', fangedTop > foals * 0.1, true);
say('and hardly ever falls back to the bare name', fangedCommon < foals * 0.01, true);
say('while swift still climbs into a fantastic plain trait', climbedPlain > 0, true);

console.log(fails ? `\n${fails} of ${n} wrong` : `\nall ${n} right`);
process.exit(fails ? 1 : 0);
