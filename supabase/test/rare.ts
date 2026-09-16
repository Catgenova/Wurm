/**
 * What a rare thing is, on both sides of the wire, and what a pass can turn one into.
 *
 * Every number about rarity lives in `RARITIES` and `RARITY_ODDS` and is
 * crossed into `rarity_def` by `npm run defs` — so the two sides agree by
 * construction, right up until somebody writes one of those numbers out again
 * by hand. That has happened: `improve_ceiling` said a rare thing could be
 * bettered 4 past your skill while the table, the browser and the island's own
 * examine line all said 5, and nothing anywhere noticed for as long as it took
 * somebody to ask.
 *
 * So this reads the numbers out of the TypeScript and out of `all.sql` and
 * puts them side by side — and then rolls the browser's own `liftRarity` a
 * quarter of a million times to show that a pass up the ladder is one step or
 * none, at the odds of making one outright.
 */
import { readFileSync } from 'node:fs';
import { RARITIES, RARITY_LIFT, RARITY_ODDS, RARITY_WORD, liftRarity, rarityChance } from '../../src/game/items';

let bad = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) bad++;
  console.log(`${ok ? '  ' : 'X '}${line}`);
};

// A seeded roll, so a run that reads differently from the last one is a change
// in the rules rather than the luck of the draw.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*
 * The odds of *reaching* a step, which is what anybody means by "the odds of a
 * fantastic" — the three conditional rolls multiplied out.
 */
console.log('the odds of a thing being this rare at all:');
for (const [step, want] of [[1, 100], [2, 1000], [3, 10000]] as Array<[number, number]>) {
  const chance = rarityChance(step);
  say(Math.abs(1 / chance - want) < 0.5,
    `${RARITIES[step].name}: 1 in ${Math.round(1 / chance)}`);
}
say(rarityChance(0) === 0 && rarityChance(4) === 0, 'and nothing above or below the ladder');

/*
 * And the ladder itself. A quarter of a million passes from each rung: the
 * only thing that may ever come out is the rung above, and it comes out at the
 * odds of making one outright.
 */
console.log('a quarter of a million good passes from each rung:');
const rolls = 250000;
for (let step = 0; step < RARITIES.length; step++) {
  const rand = seeded(0x9e3779b9 + step);
  const seen = new Set<number | null>();
  let lifts = 0;
  for (let i = 0; i < rolls; i++) {
    const got = liftRarity({ rare: step || undefined }, rand);
    seen.add(got);
    if (got !== null) lifts++;
  }
  const only = [...seen].filter((g): g is number => g !== null);
  const top = step + 1 >= RARITIES.length;
  const want = top ? 0 : rarityChance(step + 1);
  // Two things at once: nothing but the next rung ever came out, and it came
  // out about as often as it should. A fifth either way at one in ten thousand
  // is twenty-five expected, which is loose enough not to flap and tight
  // enough to catch an odds table that has moved.
  const never = only.every((g) => g === step + 1);
  const rate = lifts / rolls;
  const close = want === 0 ? lifts === 0 : Math.abs(rate - want) < want * 0.45;
  say(never && close,
    `${step === 0 ? 'plain' : RARITIES[step].name} → ${top ? 'nothing above it' : RARITIES[step + 1].name}: `
    + `${lifts} of ${rolls}${top ? '' : `, wanted about ${Math.round(rolls * want)}`}`
    + `${only.length > 1 || (only.length === 1 && only[0] !== step + 1) ? ' — AND SOMETHING ELSE CAME OUT' : ''}`);
}

/*
 * And the same numbers as the island holds them. `rarity_def` is generated
 * from these very constants, so a disagreement here is somebody having edited
 * the generated SQL or the generator having drifted from what it reads.
 */
const sql = readFileSync('supabase/all.sql', 'utf8');
/**
 * id, ord, boost, keep, ceiling, odds, word, lift — and the last two are prose
 * with commas in it, so the split has to know where the quotes are. A regex
 * alternation does not: the first draft of this cut "Something gives under the
 * file, and what was an ordinary thing…" in half and reported three
 * disagreements that were its own.
 */
function values(line: string): string[] {
  const out: string[] = [];
  let at = 0;
  let quoted = false;
  let here = '';
  while (at < line.length) {
    const c = line[at];
    if (quoted) {
      if (c === "'" && line[at + 1] === "'") {
        here += "'";
        at += 2;
        continue;
      }
      if (c === "'") quoted = false;
      else here += c;
    } else if (c === "'") quoted = true;
    else if (c === ',') {
      out.push(here.trim());
      here = '';
    } else here += c;
    at++;
  }
  out.push(here.trim());
  return out;
}

const rows = new Map<string, string[]>();
for (const m of sql.matchAll(/insert into rarity_def values \(([^;]*)\);/g)) {
  const parts = values(m[1]);
  rows.set(parts[0], parts);
}
console.log(`the island holds ${rows.size} of them:`);
for (let ord = 1; ord < RARITIES.length; ord++) {
  const r = RARITIES[ord];
  const got = rows.get(r.name);
  if (!got) {
    say(false, `${r.name}: the island has no row for it`);
    continue;
  }
  const want = [r.name, String(ord), String(r.boost), String(r.keep), String(r.ceiling),
    String(RARITY_ODDS[ord - 1]), RARITY_WORD[ord], RARITY_LIFT[ord]];
  const same = want.every((v, i) => v === got[i]);
  say(same, `${r.name}: ×${r.boost} wear ×${r.keep} +${r.ceiling} QL at ${RARITY_ODDS[ord - 1]}`
    + (same ? '' : `\n        island: ${got.join(' | ')}\n        here:   ${want.join(' | ')}`));
}

if (bad) {
  console.error(`${bad} of them are not what they should be`);
  process.exit(1);
}
