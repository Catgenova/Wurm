/**
 * The stud book, built.
 *
 * `scripts/dump-wildermon.ts` reads the definitions and prints them as JSON;
 * `scripts/wildermon.html` is the page with a hole in it where the JSON goes.
 * This puts one in the other and writes `wildermon.html` at the repository
 * root, which is what GitHub Pages serves and what gets published as the
 * artifact. Run it after anything in `src/game/creatures.ts` or
 * `src/game/traits.ts` moves; `npm run build` runs it for you.
 *
 * The page carries a fingerprint of its own data rather than a build time, so
 * regenerating it with nothing changed writes the same bytes and leaves the
 * working tree clean.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = 'wildermon.html';

execFileSync('npx', ['esbuild', 'scripts/dump-wildermon.ts', '--bundle', '--platform=node',
  '--format=esm', '--outfile=node_modules/.cache/dump-wildermon.mjs', '--log-level=error'], { stdio: 'inherit' });
const json = execFileSync('node', ['node_modules/.cache/dump-wildermon.mjs'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// Nothing in a description may close the script element it is sitting in.
const safe = json.replace(/</g, '\\u003c');
const stamp = createHash('sha256').update(json).digest('hex').slice(0, 8);

const page = readFileSync('scripts/wildermon.html', 'utf8')
  .replace('__WILDERMON_DATA__', () => safe)
  .replace('__WILDERMON_STAMP__', stamp);
if (page.includes('__WILDERMON_')) throw new Error('scripts/wildermon.html: a placeholder was left unfilled.');

const before = (() => { try { return readFileSync(OUT, 'utf8'); } catch { return null; } })();
writeFileSync(OUT, page);
const data = JSON.parse(json);
console.log(`${before === page ? 'Unchanged' : 'Wrote'} ${OUT}: ${data.species.length} wildermon, ${data.traits.length} trait rows, fingerprint ${stamp}.`);
