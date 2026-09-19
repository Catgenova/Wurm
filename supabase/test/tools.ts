/**
 * Every tool on the island can be made a second time.
 *
 * Reported: "there does not seem to be a way to make a chisel / mould for
 * chisel." Quite so, and the chisel was only the one that got noticed first.
 * You come ashore with ten issued tools and four of them — the chisel, the
 * saw, the trowel and the carving knife — could never be made again by
 * anybody. Every tool wears with use, so each of those was a countdown: the
 * chisel's ran out first because the whole of Stonework wants one, and it
 * takes the bricks, the slabs, the whetstone and the quern down with it.
 *
 * It is the kind of hole nobody sees by reading, because nothing is *wrong* in
 * any one file — a tool simply has no row anywhere, and no row is hard to
 * notice. So it is counted instead. Everything that can put a tool in your
 * hands is walked here: what comes off a bench, what comes out of a mould,
 * what comes out of a kiln, and the short list of things you fill or draw
 * rather than make. Anything left over is a tool nobody can replace.
 *
 * The island is asked the same question of its own tables, because a recipe
 * the browser offers and the island has never heard of is a bench that refuses
 * to work on an island.
 *
 * Runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';
import { ACTIONS } from '../../src/game/actions';
import { RECIPES } from '../../src/game/recipes';
import { MOULDS } from '../../src/game/metal';
import { POTTERY } from '../../src/game/kiln';
import { ITEM_DEFS } from '../../src/game/items';

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

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};
// The action list is what resolves the ring of imports these all sit in; ask
// for it first or the recipe list comes back empty and this passes on nothing.
void ACTIONS.length;

/**
 * The few things you get by doing rather than by making, named here because
 * naming them is the point: a list of three is a list somebody reads, and an
 * empty tool with no row anywhere is not.
 */
const NOT_MADE = new Map<string, string>([
  ['water_bucket', 'a bucket filled at a shore, a well or a barrel'],
]);

const madeBy = new Map<string, string>();
for (const r of RECIPES) if (!madeBy.has(r.result)) madeBy.set(r.result, `the bench, as ${r.id}`);
for (const m of MOULDS) {
  if (!madeBy.has(m.id)) madeBy.set(m.id, 'fired from sand at a smelter');
  if (!madeBy.has(m.makes)) madeBy.set(m.makes, `poured into a ${m.name.toLowerCase()}`);
}
for (const p of POTTERY) if (!madeBy.has(p.fired)) madeBy.set(p.fired, `fired in a kiln from ${p.unfired}`);
for (const [id, how] of NOT_MADE) if (!madeBy.has(id)) madeBy.set(id, how);

const tools = Object.entries(ITEM_DEFS)
  .filter(([, d]) => (d as { category?: string }).category === 'tool')
  .map(([id]) => id);
const orphans = tools.filter((t) => !madeBy.has(t));
check('every tool has a way to make a second one', orphans.length === 0,
  orphans.length ? `no way to make: ${orphans.map((t) => (ITEM_DEFS[t] as { name: string }).name).join(', ')}` : `all ${tools.length} of them`);

/* ---- and the four that were the report ----------------------------------- */
for (const [id, want] of [
  ['chisel', 'poured into a chisel mould'],
  ['saw', 'the bench, as fit_saw_blade'],
  ['trowel', 'the bench, as fit_trowel_blade'],
  ['carving_knife', 'the bench, as make_carving_knife'],
] as Array<[string, string]>) {
  check(`a ${(ITEM_DEFS[id] as { name: string }).name.toLowerCase()} can be made`, madeBy.get(id) === want,
    `${madeBy.get(id) ?? 'nowhere at all'}`);
}

/*
 * And the tools you are issued with, which are the ones that matter most: a
 * body comes ashore with these and nothing else, so a hole in this list is a
 * trade that ends the first time something wears out.
 */
const ISSUED = ['hatchet', 'shovel', 'pickaxe', 'carving_knife', 'chisel', 'mallet', 'trowel', 'saw', 'butchering_knife', 'rake'];
const shortIssued = ISSUED.filter((t) => !madeBy.has(t));
check('and every tool you come ashore with can be replaced', shortIssued.length === 0,
  shortIssued.length ? shortIssued.join(', ') : `all ${ISSUED.length}: ${ISSUED.map((t) => `${t} (${madeBy.get(t)})`).slice(0, 2).join('; ')}, and the rest`);

/* ---- the island has to have heard of all of it --------------------------- */
const theirMoulds = new Set(psql(`select id from mould_def;`).split('\n').map((s) => s.trim()).filter(Boolean));
const mineMoulds = MOULDS.map((m) => m.id);
const missingMoulds = mineMoulds.filter((m) => !theirMoulds.has(m));
check('the island knows every mould the browser offers', missingMoulds.length === 0,
  missingMoulds.length ? `never heard of ${missingMoulds.join(', ')}` : `all ${mineMoulds.length} of them`);
check('and no more than it should', theirMoulds.size === mineMoulds.length,
  `${theirMoulds.size} against ${mineMoulds.length}`);

const theirRecipes = new Set(psql(`select id from recipe;`).split('\n').map((s) => s.trim()).filter(Boolean));
const missingRecipes = RECIPES.map((r) => r.id).filter((r) => !theirRecipes.has(r));
check('and every recipe, so a bench that works here works there too', missingRecipes.length === 0,
  missingRecipes.length ? `never heard of ${missingRecipes.join(', ')}` : `all ${RECIPES.length} of them`);

/* And the new ones charge the same on both sides, down to the last nail. */
const bills = psql(`
  select r.id || '=' || coalesce((select string_agg(i.item || 'x' || i.count, ',' order by i.ord)
                                    from recipe_input i where i.recipe = r.id), 'nothing')
    from recipe r where r.id in ('make_carving_knife', 'fit_saw_blade', 'fit_trowel_blade')
   order by r.id;
`).split('\n').map((s) => s.trim()).filter(Boolean);
let agreed = 0;
for (const row of bills) {
  const [id, theirs] = row.split('=');
  const mine = RECIPES.find((r) => r.id === id);
  const want = mine ? mine.inputs.map((i) => `${i.item}x${i.count ?? 1}`).join(',') : '?';
  if (want === theirs) agreed++;
  else check(`${id} costs the same on both sides`, false, `browser ${want}, island ${theirs}`);
}
check('the three new handles cost the same on both sides', agreed === 3 && bills.length === 3,
  bills.map((b) => b.replace('=', ': ')).join(' | '));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log('every tool on the island can be made a second time, and the island has heard of every way of making one');
