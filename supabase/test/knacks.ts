/**
 * Knacks on the move.
 *
 * Asked for: "Reduce the rate of knack gain for skills like driving and
 * swimming due to frequency of skill gain ticks." Swimming is raised once a
 * second in deep water, driving and sailing once a tile, climbing once a steep
 * step, and every raise rolled a whole go's odds for a knack. A raise of one of
 * those now rolls at the share of a go it teaches. What this asks:
 *
 *   * the island's `knack_chance` is the browser's `knackChance`, for every
 *     skill and over a spread of bases;
 *   * a go at an ordinary trade keeps its one in `KNACK_ODDS`, whatever its
 *     base, and a tick of a trade on the move rolls at its base's share of a go;
 *   * the island's raise hands its base on to the knack, and the browser's
 *     raise rolls at `knackChance` -- driven through `gainSkill` with the dice
 *     held, on both sides of the line.
 *
 * Runs against any database with the migrations on it.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { SWIM_LEARN } from '../../src/game/body';
import { CLIMB_LEARN } from '../../src/game/player';
import { DRIVING_LEARN, SAILING_LEARN } from '../../src/game/travel';
import { SKILL_DEFS } from '../../src/game/skills';
import { knackChance, KNACK_BY_LEARNING, KNACK_GO, KNACK_ODDS } from '../../src/game/titles';

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
  }).trim();
const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-12 + 1e-9 * Math.abs(b);

/* ---- the rule, both sides ------------------------------------------------- */
const BASES = [0.003, 0.04, 0.09, 0.2, 0.45, 1, 1.5];
const ids = SKILL_DEFS.map((s) => s.id);
const pairs = ids.flatMap((id) => BASES.map((b) => [id, b] as const));
const island = psql(`select string_agg(knack_chance(s, b)::text, ',' order by n) from (values ${
  pairs.map(([s, b], n) => `(${n}, ${lit(s)}, ${b}::double precision)`).join(', ')
}) v(n, s, b);`).split(',').map(Number);
const differ = pairs.filter(([s, b], n) => !near(island[n], knackChance(s, b)));
check(`the island's chance is the browser's, for ${ids.length} skills at ${BASES.length} bases`, differ.length === 0,
  differ.slice(0, 4).map(([s, b]) => `${s}@${b}`).join(' '));

check('a go at an ordinary trade is one in KNACK_ODDS, whatever its base',
  BASES.every((b) => near(knackChance('carpentry', b), 1 / KNACK_ODDS)));
check('a second in deep water rolls at its share of a go', near(knackChance('swimming', SWIM_LEARN), SWIM_LEARN / KNACK_GO / KNACK_ODDS),
  `one in ${Math.round(1 / knackChance('swimming', SWIM_LEARN))}`);
check('a tile driven and a tile sailed the same way',
  near(knackChance('driving', DRIVING_LEARN), DRIVING_LEARN / KNACK_GO / KNACK_ODDS)
  && near(knackChance('sailing', SAILING_LEARN), SAILING_LEARN / KNACK_GO / KNACK_ODDS),
  `one in ${Math.round(1 / knackChance('driving', DRIVING_LEARN))}`);
check('a steep step climbed the same way', near(knackChance('climbing', CLIMB_LEARN), CLIMB_LEARN / KNACK_GO / KNACK_ODDS));
check('and never more than a go', KNACK_BY_LEARNING.every((s) => near(knackChance(s, 50), 1 / KNACK_ODDS)));

/* ---- the island's raise hands its base on --------------------------------- */
const raise = psql(`select pg_get_functiondef('skill_raise(uuid, uuid, text, double precision)'::regprocedure);`);
check('the island\'s raise rolls the knack with its base', /earn_knacks\(p_world, p_uid, p_id, p_base\)/.test(raise));
const earn = psql(`select pg_get_functiondef('earn_knacks(uuid, uuid, text, double precision)'::regprocedure);`);
check('and the knack asks knack_chance for it', /knack_chance\(p_id, p_base\)/.test(earn));

/* ---- the browser's raise rolls at the chance ------------------------------ */
// Dice held just under and just over the chance: under, a knack; over, none.
// The first draw is the knack's; the next says where it lands, held at home.
const roll = (skill: string, base: number, at: number): number => {
  const g = Game.create(4242);
  g.player.knacks = {};
  let n = 0;
  const h = g as unknown as { rand: () => number; earnKnacks: (id: string, b: number) => void };
  h.rand = () => (n++ === 0 ? at : 0);
  h.earnKnacks(skill, base);
  return Object.values(g.player.knacks).reduce((x, y) => x + y, 0);
};
const chance = knackChance('swimming', SWIM_LEARN);
const under = roll('swimming', SWIM_LEARN, chance * 0.999);
const over = roll('swimming', SWIM_LEARN, Math.min(0.999, chance * 1.001));
check('the browser leaves a knack under the chance of a swim and none over it', under === 1 && over === 0, `${under}|${over}`);
const go = 1 / KNACK_ODDS;
check('and a go at the bench keeps a go\'s odds', roll('carpentry', 1, go * 0.999) === 1 && roll('carpentry', 1, go * 1.001) === 0);

for (const line of [...ok, ...bad]) console.log(line);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
if (bad.length) process.exit(1);
