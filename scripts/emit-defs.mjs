/**
 * The generated definitions, as a migration that will actually be applied.
 *
 * A migration the database has already run is never run again, so rewriting
 * the same file when an item's weight changes would put the new number in the
 * repository and nowhere else. So this writes a *new* timestamped migration
 * whenever the generated SQL differs from the last one, and nothing at all
 * when it does not.
 *
 * It used to write a whole four-hundred-kilobyte snapshot every time. Twenty
 * five of those came to 8.7 MB of a 10 MB repository — the same rulebook,
 * twenty-five times — and every fresh database and every CI run replayed all
 * of them to arrive at the last one. The snapshot lives once now, in
 * `supabase/defs-state.sql`, which is outside `migrations/` and so may be
 * rewritten; the migration carries what changed. `scripts/defs-delta.mjs` says
 * when that is safe and when the whole thing has to go in again.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { delta } from './defs-delta.mjs';

const DIR = 'supabase/migrations';
const STATE = 'supabase/defs-state.sql';

execFileSync('npx', ['esbuild', 'scripts/dump-defs.ts', '--bundle', '--platform=node',
  '--format=esm', '--outfile=node_modules/.cache/dump-defs.mjs', '--log-level=error'], { stdio: 'inherit' });
const sql = execFileSync('node', ['node_modules/.cache/dump-defs.mjs'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// The snapshot as it stands. Before this file existed that was the newest
// `_defs.sql`, which was a whole one; after it, it is the state file.
const existing = readdirSync(DIR).filter((f) => f.endsWith('_defs.sql')).sort();
const previous = existsSync(STATE)
  ? readFileSync(STATE, 'utf8')
  : existing.length ? readFileSync(join(DIR, existing[existing.length - 1]), 'utf8') : '';

if (previous === sql) {
  writeFileSync(STATE, sql);
  console.log(`definitions unchanged (${existing[existing.length - 1] ?? 'nothing yet'})`);
  process.exit(0);
}

const made = delta(previous, sql);
const now = new Date();
const stamp = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(),
  now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()]
  .map((n, i) => String(n).padStart(i === 0 ? 4 : 2, '0')).join('');
const name = `${stamp}_defs.sql`;
/*
 * A whole snapshot carries the rulebook's own DDL -- `create table if not
 * exists`, `alter table ... add column if not exists` -- over tables every
 * door on the island reads. An `alter table` wants ACCESS EXCLUSIVE, and the
 * moment it starts waiting for one, every query behind it waits too, so a
 * deploy that lands while somebody is mid-action can stop the island until
 * that action finishes. Bounded, it is a failed deploy instead, which is the
 * cheaper of the two and the thing you want to be told about.
 *
 * It goes on here rather than in the dump itself so that `defs-state.sql` and
 * the statement-by-statement comparison that makes a delta stay exactly what
 * the TypeScript says. A delta carries no DDL and needs none of this.
 *
 * There is a CI guard that will not let an altering migration through without
 * it. That guard caught this file before this line existed, which is the only
 * reason the line is here.
 */
const guard = made.whole
  ? "set local lock_timeout = '3s';\n\n"
  : '';
const [firstLine, ...rest] = made.sql.split('\n');
const body = made.whole
  ? [firstLine, rest[0], '', guard.trimEnd(), ...rest.slice(1)].join('\n')
  : made.sql;
writeFileSync(join(DIR, name), body);
writeFileSync(STATE, sql);
console.log(made.whole
  ? `definitions changed: the rulebook itself moved, so ${name} is the whole snapshot (${made.sql.split('\n').length} lines)`
  : `definitions changed: ${name} carries ${made.count} statement${made.count === 1 ? '' : 's'}, not the whole ${sql.split('\n').length}-line snapshot`);
