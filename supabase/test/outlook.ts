/**
 * What Look says is coming for a tree, the same on both sides.
 *
 * "The woods turn over in 9 hours, and it will be shrivelled. Prune it to keep
 * it." is one sentence written twice: `treeOutlook` and `hoursHence` in the
 * browser, `tree_outlook` and `hours_hence` on the island. A solo world hears
 * the browser's; an island hears the island's; a player who plays both should
 * never be able to tell which. So every stage of the age table is put to both,
 * on an island whose woods turned over a minute after the last dawn — so the
 * next is the next dawn, however far off that is at the hour this runs — and
 * a spread of seconds is put to the hour-words, including the thresholds,
 * where a sentence turns.
 */
import { execFileSync } from 'node:child_process';
import { lastDawn, TREE_AGES } from '../../src/world/tiles';
import { hoursHence, treeOutlook } from '../../src/game/actions';

const psql = (sql: string): string =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
    env: {
      ...process.env,
      PGHOST: process.env.PGHOST ?? '/var/run/postgresql',
      PGPORT: process.env.PGPORT ?? '5433',
      PGUSER: process.env.PGUSER ?? 'wurm',
      PGDATABASE: process.env.PGDATABASE ?? 'postgres',
    },
    // Only the trailing newline: the sentence itself begins with a space,
    // since it follows "You see ..." on both sides, and that space is part of
    // what has to agree.
  }).replace(/\n$/, '');

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

// The island the suite left, its woods turned over a minute after the last dawn.
psql(`update world set trees_at = tree_last_dawn() + interval '1 minute' where name = 'Hoarding'`);
const treesAt = lastDawn(Date.now() / 1000) + 60;

for (const age of TREE_AGES) {
  const island = psql(`select tree_outlook(w.id, a) from tree_age_def a, world w where w.name = 'Hoarding' and a.id = ${age.id}`);
  const browser = treeOutlook(age, treesAt);
  check(`${age.name.toLowerCase()}: both sides say the same`, island === browser, island === browser ? `"${browser.trim()}"` : `island "${island}" browser "${browser}"`);
}

const seconds = [0, 60, 119, 120, 121, 1800, 2999, 3000, 3001, 5399, 5400, 5401, 7200, 36000, 54000, 86400];
const islandHours = psql(`select string_agg(hours_hence(s), '|' order by ord) from unnest(array[${seconds.join(',')}]) with ordinality as u(s, ord)`).split('|');
seconds.forEach((s, i) => check(`${s} seconds hence`, islandHours[i] === hoursHence(s), islandHours[i] === hoursHence(s) ? hoursHence(s) : `island "${islandHours[i]}" browser "${hoursHence(s)}"`));

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} disagree` : `\nall ${ok.length} agree`);
process.exit(bad.length ? 1 : 0);
