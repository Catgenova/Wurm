/**
 * What changed in the generated definitions, and nothing else.
 *
 * Every `*_defs.sql` was a complete snapshot of the rulebook — truncate and
 * refill, four hundred kilobytes of it — written afresh whenever any one
 * number moved. Twenty-five of them came to **8.7 MB of the repository's 10**,
 * and every fresh database and every CI run replayed all twenty-five to arrive
 * at the last one.
 *
 * The snapshot is not the problem; keeping twenty-five is. So the snapshot
 * lives once, in `supabase/defs-state.sql`, outside `migrations/` where it can
 * be rewritten, and a migration carries the difference.
 *
 * ## What may safely be a difference
 *
 * Every statement in the dump is idempotent **except the inserts**, which only
 * mean anything after the truncate that clears the table — and the truncates
 * come in groups, because the tables have foreign keys between them and cannot
 * be cleared one at a time.
 *
 * So the rule is deliberately blunt: if the data statements are identical, the
 * migration carries only the statements that are new or changed — which is the
 * overwhelmingly common case, because what usually moves is a constant. If any
 * data statement differs, the migration carries every data statement, in the
 * dump's own order, and still only the *other* statements that are new.
 *
 * ## Why the other statements have to be left out
 *
 * That last clause used to read "the migration is the whole snapshot", and it
 * was wrong in a way that only a live island could show. The snapshot opens
 * with seventy pieces of DDL — `create table if not exists`, `alter table ...
 * add column if not exists`, `enable row level security` — every one of them
 * idempotent, and every one of them a no-op on a project that has run them
 * before.
 *
 * A no-op `alter table` is not free. Postgres takes ACCESS EXCLUSIVE *before*
 * it looks to see whether there is anything to do, and holds it to the end of
 * the transaction. ACCESS EXCLUSIVE conflicts with the ACCESS SHARE every
 * reader takes, so on `tile_def` -- which the clock and every land read touch
 * constantly -- the alter can only get in during a gap that never comes. Worse,
 * the moment it starts waiting, every reader queues behind it.
 *
 * Measured, on the real project: `alter table tile_def add column if not
 * exists paved ...` could not get the lock in three seconds and the deploy
 * failed. That was the `lock_timeout` doing its job -- the alternative is an
 * island that stops until the deploy gives up -- but the deploy has to land,
 * and the way it lands is by not asking for the lock at all. A change to a
 * number has no business touching the shape of a table.
 */

/** Split generated SQL into statements, respecting dollar quoting. */
export function statements(sql) {
  const out = [];
  let buf = [];
  let tag = null;
  for (const line of sql.split('\n')) {
    buf.push(line);
    let rest = line;
    for (;;) {
      if (tag) {
        const end = rest.indexOf(tag);
        if (end < 0) break;
        rest = rest.slice(end + tag.length);
        tag = null;
      } else {
        const m = /\$[A-Za-z_]*\$/.exec(rest);
        if (!m) break;
        tag = m[0];
        rest = rest.slice(m.index + m[0].length);
      }
    }
    if (!tag && /;\s*$/.test(line)) {
      out.push(buf.join('\n'));
      buf = [];
    }
  }
  if (buf.join('\n').trim()) out.push(buf.join('\n'));
  return out;
}

/**
 * A statement that only means anything beside the others in its group.
 *
 * The `m` flag is load-bearing. A truncate is wrapped in a retry loop now --
 * `do $patient$ ... truncate a, b, c; ... $patient$;` -- because on a live
 * island it may have to ask for its lock several times. Without `m` the
 * wrapper reads as ordinary DDL, and a snapshot whose truncate had not changed
 * since the last one would drop it as already-applied and leave every insert
 * behind it filling a table that was never cleared. Every rulebook table
 * doubled, on every deploy, silently.
 */
const DATA = /^\s*(insert\s+into|update\s|truncate\s)/im;

/** The statements that only mean anything next to their truncate. */
export const dataOnly = (list) => list.filter((s) => DATA.test(s));

/**
 * The migration to write, given the last snapshot and the new one.
 *
 * Returns `{ sql, whole }` — `whole` says whether the data moved and the
 * snapshot had to go in entire.
 */
export function delta(oldSql, newSql) {
  const older = statements(oldSql);
  const newer = statements(newSql);
  const oldData = dataOnly(older).join('\n');
  const newData = dataOnly(newer).join('\n');
  const had = new Set(older);

  if (oldData !== newData) {
    /*
     * The rulebook itself moved, so every truncate and every insert goes in,
     * in the dump's own order -- they mean nothing apart from each other. The
     * statements that are not data go in only if they are new, which on an
     * established project is none of them: see the note above on what a no-op
     * `alter table` costs.
     */
    const kept = newer.filter((s) => DATA.test(s) || !had.has(s));
    const ddl = kept.filter((s) => !DATA.test(s)).length;
    const head = [
      '-- Generated by scripts/dump-defs.ts from the TypeScript definitions.',
      '-- Do not edit: run `npm run defs` instead.',
      '--',
      '-- The rulebook moved, so this carries all of it: every truncate and every',
      '-- insert, which mean nothing apart from each other. What it does not carry',
      '-- is the shape of the tables — that is already there, and a no-op',
      '-- `alter table` still takes ACCESS EXCLUSIVE to find out it has nothing to',
      '-- do, which is a stalled island and a failed deploy. Only genuinely new',
      '-- statements come with it.',
      '',
    ].join('\n');
    return { sql: `${head}${kept.join('\n')}\n`, whole: true, count: kept.length, ddl };
  }

  const changed = newer.filter((s) => !DATA.test(s) && !had.has(s));
  const head = [
    '-- Generated by scripts/dump-defs.ts from the TypeScript definitions.',
    '-- Do not edit: run `npm run defs` instead.',
    '--',
    '-- What changed since the last one. The rulebook itself did not move, so',
    '-- this is only the statements that did — every one of them idempotent, in',
    '-- the order the dump writes them. The whole snapshot lives in',
    '-- supabase/defs-state.sql.',
    '',
  ].join('\n');
  return { sql: `${head}${changed.join('\n')}\n`, whole: false, count: changed.length };
}
