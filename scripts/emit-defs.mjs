/**
 * The generated definitions, as a migration that will actually be applied.
 *
 * A migration the database has already run is never run again, so rewriting
 * the same file when an item's weight changes would put the new number in the
 * repository and nowhere else. Instead this writes a *new* timestamped
 * migration whenever the generated SQL differs from the last one, and does
 * nothing at all when it does not. Each truncates and refills, so applying
 * them in order lands on the same place however many there are.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';
execFileSync('npx', ['esbuild', 'scripts/dump-defs.ts', '--bundle', '--platform=node',
  '--format=esm', '--outfile=node_modules/.cache/dump-defs.mjs', '--log-level=error'], { stdio: 'inherit' });
const sql = execFileSync('node', ['node_modules/.cache/dump-defs.mjs'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const existing = readdirSync(DIR).filter((f) => f.endsWith('_defs.sql')).sort();
const latest = existing.length ? readFileSync(join(DIR, existing[existing.length - 1]), 'utf8') : '';
if (latest === sql) {
  console.log(`definitions unchanged (${existing[existing.length - 1]})`);
  process.exit(0);
}
const now = new Date();
const stamp = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(),
  now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()]
  .map((n, i) => String(n).padStart(i === 0 ? 4 : 2, '0')).join('');
const name = `${stamp}_defs.sql`;
writeFileSync(join(DIR, name), sql);
console.log(`definitions changed: wrote ${name} (${sql.split('\n').length} lines)`);
