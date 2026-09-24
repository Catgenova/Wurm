/**
 * An archway, in each material.
 *
 * Asked for: "add a new doorway type, Arch, in each material."
 *
 * A wall type is offered in every material by construction — the menu is every
 * type crossed with every material, and the bill is the material's own bill
 * scaled by the type's factor — so "in each material" is not a list of twelve
 * things to write but one thing to check twelve times, on both sides, because
 * the bill is what the island charges you and the browser is what tells you
 * what it will cost before you commit.
 *
 * What is actually new about an arch is what it does not have. It takes no
 * ironwork: there is nothing to swing, so there are no hinges to cast, and it
 * is the only opening in the list that carries no fittings. And it is the only
 * thing you can walk through that a wildermon can walk through as well — a
 * gate is shut against a beast and an arch is a hole in a wall.
 *
 * Runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';
import { floorBill, MATERIALS, ROOF_SHAPES, WALL_TYPE_BY_ID, WALL_TYPES, wallBill } from '../../src/game/building';

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

const arch = WALL_TYPE_BY_ID.get('arch');
if (!arch) throw new Error('there is no arch');

/* ---- what it is, on both sides ---- */
check('an arch is a wall type the island knows about',
  psql(`select id || ' ' || name || ' ' || factor || ' ' || passable || ' ' || beast_proof from wall_type_def where id = 'arch'`)
    === `arch ${arch.name} ${arch.factor} true false`,
  `${arch.name}, ${arch.factor} of a wall, walked through by anything`);
check('it is walked through, and not only by people',
  arch.passable && !arch.beastProof,
  'a gate is shut against a beast; an arch is a hole in a wall');
check('and it hangs nothing, so it casts no ironwork',
  arch.fittings === undefined && psql(`select count(*) from wall_fitting where type = 'arch'`) === '0',
  'the only opening in the list with no hinges in its bill');
const swings = WALL_TYPES.filter((t) => t.passable && t.fittings);
check('every other thing you can walk through does hang on something',
  swings.length === 4 && swings.every((t) => t.id !== 'arch'),
  swings.map((t) => t.name.toLowerCase()).join(', '));

/* ---- and what it costs, in each material ---- */
let same = 0;
let cheaper = 0;
const lines: string[] = [];
for (const m of MATERIALS) {
  const mine = wallBill(m.id, 'arch').needed;
  const theirs = JSON.parse(psql(`select wall_bill(${JSON.stringify(m.id).replace(/"/g, "'")}, 'arch')`)) as Record<string, number>;
  const alike = Object.keys(mine).length === Object.keys(theirs).length
    && Object.entries(mine).every(([k, n]) => theirs[k] === n);
  if (alike) same++;
  const solid = Object.values(wallBill(m.id, 'solid').needed).reduce((a, b) => a + b, 0);
  const hole = Object.values(mine).reduce((a, b) => a + b, 0);
  if (hole <= solid) cheaper++;
  lines.push(`${m.name}: ${Object.entries(mine).map(([k, n]) => `${n} ${k}`).join(', ')}${alike ? '' : ' MISMATCH'}`);
}
check(`an arch in every one of the ${MATERIALS.length} materials, and the same bill on both sides`,
  same === MATERIALS.length, `${same} of ${MATERIALS.length}`);
check('and none of them costs more than the solid wall it is a hole in',
  cheaper === MATERIALS.length, `${cheaper} of ${MATERIALS.length}`);
for (const line of lines) console.log(`    ${line}`);

/*
 * ---- and every other type and roof, in every material ----
 *
 * The arch was the one the suite asked about, and the one that showed the
 * factor was a four-byte `real` on the island: 0.85 there is 0.8500000238,
 * and twenty shards times that rounds up to eighteen where the browser's
 * double makes seventeen. Any factor that is not a whole number of halves is
 * open to the same, so every type and every roof is put to both sides, in one
 * query.
 */
const island = JSON.parse(psql(`select jsonb_object_agg(m.id || '|' || t.id, wall_bill(m.id, t.id))
    || (select jsonb_object_agg(m2.id || '|roof:' || r.id, floor_bill(m2.id, 'roof', r.id))
          from build_material_def m2, roof_shape_def r)
  from build_material_def m, wall_type_def t`)) as Record<string, Record<string, number>>;
const differ: string[] = [];
let asked = 0;
const same2 = (mine: Record<string, number>, theirs: Record<string, number> | undefined): boolean =>
  !!theirs && Object.keys(mine).length === Object.keys(theirs).length
  && Object.entries(mine).every(([k, n]) => theirs[k] === n);
for (const m of MATERIALS) {
  for (const t of WALL_TYPES) {
    asked++;
    const mine = wallBill(m.id, t.id).needed;
    const theirs = island[`${m.id}|${t.id}`];
    if (!same2(mine, theirs)) differ.push(`${m.id} ${t.id}: ${JSON.stringify(mine)} here, ${JSON.stringify(theirs)} there`);
  }
  for (const r of ROOF_SHAPES) {
    asked++;
    const mine = floorBill(m.id, 'roof', r.id).needed;
    const theirs = island[`${m.id}|roof:${r.id}`];
    if (!same2(mine, theirs)) differ.push(`${m.id} ${r.id} roof: ${JSON.stringify(mine)} here, ${JSON.stringify(theirs)} there`);
  }
}
check(`every wall type and every roof, in every material, costs the same on both sides`,
  differ.length === 0, differ.length ? differ.slice(0, 4).join('; ') : `${asked} bills`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`an arch in each of the ${MATERIALS.length} materials, charged the same by both sides, and hung with nothing`);
