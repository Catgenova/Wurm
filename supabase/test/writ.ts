/**
 * Every goal the journal counts, against every note the island writes.
 *
 * Forty-six of the journal's eighty-five goals are `did('tree')`,
 * `did('ore')`, `did('brew:ale')` — a count of things done, kept in
 * `game.tally`. Every one of those counts was written by a browser performer,
 * and on an island the island performs. So none of them could tick, ever, and
 * nothing said so: a goal whose key nobody sets is indistinguishable from a
 * goal you have not got round to.
 *
 * The notes live in the island now, one beside each `tell` that says the same
 * thing in words. That is forty-seven lines in seventeen functions, and the
 * thing that will go wrong is not a line being wrong — it is a line going
 * missing when a rule is next re-emitted, or a goal being added here that
 * nothing over there sets. Neither has a symptom. This is the symptom.
 *
 * Three keys are deliberately still the browser's, and named as such: sailing
 * is the browser's to move, so `reach` and `laden` are noted here; `wounded` is
 * noted by nothing that reads it.
 */
import { readFileSync } from 'node:fs';
import { ALL_GOALS, JOURNAL } from '../../src/game/journal';
import { FISH } from '../../src/game/fishing';

/** Keys the browser still sets on its own, and why each is not the island's. */
const OURS: Record<string, string> = {
  reach: 'sailing: the browser moves the hull',
  laden: 'sailing: the browser moves the hull',
  wounded: 'noted by nothing that reads it',
};

// Read off the repository rather than off the bundle: esbuild puts this in
// `node_modules/.cache`, so `import.meta.url` points at somewhere with no
// rules in it. Both files are named from the root the test is run from.
const sql = readFileSync('supabase/all.sql', 'utf8');

/*
 * What the island notes, read off the rules themselves rather than off a list
 * somebody keeps up to date. A literal key, or a prefix it builds a key from.
 */
const literals = new Set<string>();
const prefixes = new Set<string>();
let rarities = false;
for (const call of sql.match(/journal_note\([^;]*?\)/g) ?? []) {
  for (const m of call.matchAll(/'([a-z_]+):'\s*\|\|/g)) prefixes.add(`${m[1]}:`);
  for (const m of call.matchAll(/,\s*'([a-z_]+)'/g)) literals.add(m[1]);
  // `perform journal_note(p_world, p_uid, rare)` — whatever `rarity_roll` gave.
  if (/,\s*v?_?rare\)/.test(call)) rarities = true;
}
// The ledger writes its own two, from every bench on the island.
if (/journal_made\(/.test(sql)) {
  literals.add('made');
  prefixes.add('made:');
}
if (rarities) for (const r of ['rare', 'supreme', 'fantastic']) literals.add(r);

let bad = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) bad++;
  console.log(`${ok ? '  ' : 'X '}${line}`);
};

console.log(`the island writes ${literals.size} keys and ${prefixes.size} kinds of key: `
  + `${[...prefixes].sort().join(' ')}`);

/*
 * What the journal asks for. Read out of the source rather than by running the
 * predicates, because a predicate wants a whole game to ask its question of
 * and this only wants the key it would look up.
 */
const source = readFileSync('src/game/journal.ts', 'utf8');
const wanted = new Map<string, string>();
for (const m of source.matchAll(/did\('([^']+)'/g)) wanted.set(m[1], 'did');
for (const b of ['ale', 'cider', 'mead', 'wine']) wanted.set(`brew:${b}`, 'the four brews');
for (const f of FISH) wanted.set(`fish:${f.id}`, 'one of every fish');

const covers = (key: string): boolean =>
  literals.has(key) || [...prefixes].some((p) => key.startsWith(p));

console.log(`the journal counts ${wanted.size} keys across ${ALL_GOALS.length} goals `
  + `in ${JOURNAL.length} chapters:`);
const missing: string[] = [];
for (const [key, why] of [...wanted].sort()) {
  if (covers(key)) continue;
  if (OURS[key]) {
    console.log(`  ${key} — the browser's own (${OURS[key]})`);
    continue;
  }
  missing.push(`${key} (${why})`);
}
say(missing.length === 0, missing.length
  ? `${missing.length} the island never writes: ${missing.join(', ')}`
  : `every one of them is written by the island or named as the browser's own`);

// And the other way round: a note nobody reads is a line that has outlived
// whatever asked for it. Worth saying, not worth failing over.
const unread = [...literals].filter((k) => !wanted.has(k) && !OURS[k]).sort();
if (unread.length) console.log(`  noted and not counted by any goal: ${unread.join(', ')}`);

if (bad) {
  console.error(`${bad} of them are not what they should be`);
  process.exit(1);
}
