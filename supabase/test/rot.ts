/**
 * What is lying about, going off where it lies.
 *
 * `ground_sweep` used to rewrite every thing on an island's ground once a
 * second -- `rot_at = now()` on every row, whether any damage had accrued
 * worth writing down or not. At ninety-five microseconds a row that was the
 * whole of a world round on a busy island.
 *
 * It is charged in steps now, and the claim that makes that safe is
 * arithmetic: damage is `rate * multiplier * elapsed / 3600` and `rot_at` is
 * when it was last charged, so charging twice over two stretches adds exactly
 * what charging once over both would. The elapsed terms telescope.
 *
 * What this asks:
 *
 *   * that they telescope -- two hours then one hour lands on the same damage
 *     as three hours in one go, to the last bit, and neither hit the clamp;
 *   * that a thing too freshly charged to be worth touching is not touched,
 *     and one that has waited a step is;
 *   * that a round charges at most `ground_rows()` of them and takes the
 *     oldest, so a backlog is a delay rather than a starvation;
 *   * that a thing worn through to a hundred still goes;
 *   * that a thing never charged before has its clock started and is charged
 *     nothing for the time before anyone was counting;
 *   * and that a quiet round does not read the ground at all -- asserted in
 *     buffers rather than in milliseconds, so it means the same thing on a
 *     slow machine as on a fast one.
 *
 * Runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';

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

/* How many things to litter the ground with for the cost measurements. */
const LITTER = 3000;

const out = psql(`
begin;
create temp table said (k text);
insert into said select 'NUMBERS|' || extract(epoch from ground_step())::int || '|' || ground_rows();

do $$
declare v_w uuid; a bigint; b bigint; c bigint; d bigint; n int;
        v_b double precision; v_c double precision; v_plan text;
begin
  select id into v_w from world order by id limit 1;
  delete from item where world_id = v_w and holder = 'ground';

  /*
   * Three pickaxes on one tile, so whatever the deed and the roof do to the
   * rate is the same for all three and cancels out of the comparison.
   */
  insert into item (world_id, holder, gx, gy, def, ql, rot_at)
    values (v_w, 'ground', 7, 7, 'pickaxe', 30, now() - interval '3 hours') returning id into c;
  insert into item (world_id, holder, gx, gy, def, ql, rot_at)
    values (v_w, 'ground', 7, 7, 'pickaxe', 30, now() - interval '2 hours') returning id into b;
  -- And one that has never been charged at all.
  insert into item (world_id, holder, gx, gy, def, ql)
    values (v_w, 'ground', 7, 7, 'pickaxe', 30) returning id into d;

  -- Three hours in one go for c, two hours for b, and nothing for d.
  perform ground_sweep(v_w);
  insert into said select 'FRESH|' || dmg || '|' || (rot_at is not null)::text
    from item where id = d;

  -- Another hour on b, by hand, since now() does not move inside a transaction.
  update item set rot_at = rot_at - interval '1 hour' where id = b;
  perform ground_sweep(v_w);
  select dmg into v_b from item where id = b;
  select dmg into v_c from item where id = c;
  insert into said select 'TELESCOPE|' || v_b || '|' || v_c;

  -- A thing charged a moment ago is not worth touching again.
  insert into said select 'QUIET|' || ground_sweep(v_w);
  update item set rot_at = now() - ground_step() - interval '1 second'
    where world_id = v_w and holder = 'ground';
  insert into said select 'DUE|' || ground_sweep(v_w);

  -- Worn through, and gone.
  update item set dmg = 100 where id = b;
  perform ground_sweep(v_w);
  insert into said select 'GONE|' || (not exists (select 1 from item where id = b))::text;

  /*
   * A backlog: more overdue than a round may take. The cap holds, the oldest
   * go first, and what is left is still there to be taken next round.
   */
  delete from item where world_id = v_w and holder = 'ground';
  insert into item (world_id, holder, gx, gy, def, ql, rot_at)
  select v_w, 'ground', 7, 7, 'pickaxe', 30, now() - make_interval(secs => 600 + g)
    from generate_series(1, ground_rows() + 50) g;
  n := ground_sweep(v_w);
  insert into said select 'CAP|' || n || '|' || ground_sweep(v_w);
  -- The ones left behind are the ones that had waited least.
  insert into said select 'OLDEST|' || count(*) from item i
    where i.world_id = v_w and i.holder = 'ground' and i.dmg > 0;

  /*
   * And the cost, in pages rather than in milliseconds.
   *
   * Both statements of a quiet round, explained against a littered island. A
   * round that has to read the ground to find out there is nothing to do is
   * the bug this file exists about, and it shows up here as buffers whether
   * the machine is fast or slow.
   */
  delete from item where world_id = v_w and holder = 'ground';
  insert into item (world_id, holder, gx, gy, def, ql, dmg, rot_at)
  select v_w, 'ground', (g % 60) + 2, (g / 60) + 2, 'pickaxe', 30, 0, now()
    from generate_series(1, ${LITTER}) g;
  execute 'analyze item';

  execute $x$explain (analyze, buffers, format json)
    select i.id from item i
     where i.world_id = $x$ || quote_literal(v_w) || $x$::uuid and i.holder = 'ground'
       and coalesce(i.rot_at, '-infinity'::timestamptz) <= now() - ground_step()
     order by coalesce(i.rot_at, '-infinity'::timestamptz)
     limit ground_rows()$x$ into v_plan;
  -- The index is wherever the planner put it in the tree, so the plan is asked
  -- whether it names it at all rather than where. The pages are the top node's,
  -- which is the whole statement's.
  insert into said select 'DUEPLAN|' || (v_plan like '%item\_ground\_due%')::text
    || '|' || coalesce((v_plan::jsonb #>> '{0,Plan,Shared Hit Blocks}'), 'none');

  execute $x$explain (analyze, buffers, format json)
    delete from item where world_id = $x$ || quote_literal(v_w) || $x$::uuid
      and holder = 'ground' and dmg >= 100$x$ into v_plan;
  insert into said select 'GONEPLAN|' || (v_plan like '%item\_ground\_gone%')::text
    || '|' || coalesce((v_plan::jsonb #>> '{0,Plan,Shared Hit Blocks}'), 'none');

  insert into said select 'LITTER|' || count(*) from item
    where world_id = v_w and holder = 'ground';
end $$;

select * from said;
rollback;
`);

const said = (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

const [step, rows] = said('NUMBERS').split('|').map(Number);
check('a thing is charged no oftener than every five minutes, at most a few hundred a round',
  step === 300 && rows === 250, `a step of ${step}s, ${rows} a round`);

const [telB, telC] = said('TELESCOPE').split('|').map(Number);
check('two hours and then one land on the same damage as three in one go',
  telB === telC && telB > 0 && telB < 100,
  `two-then-one ${telB}, three at once ${telC}`);

const [freshDmg, freshClock] = said('FRESH').split('|');
check('a thing never charged before is charged nothing, and its clock starts',
  Number(freshDmg) === 0 && freshClock === 'true',
  `${freshDmg} damage, clock started ${freshClock}`);

check('a thing charged a moment ago is left alone', said('QUIET') === '0', said('QUIET'));
check('and one that has waited a step is not', Number(said('DUE')) > 0, said('DUE'));
check('a thing worn through to a hundred goes', said('GONE') === 'true', said('GONE'));

const [capped, leftovers] = said('CAP').split('|').map(Number);
check('a round charges at most what it may, and the rest wait for the next one',
  capped === rows && leftovers === 50, `${capped} then ${leftovers}`);
check('and all of them were reached across the two rounds',
  Number(said('OLDEST')) === rows + 50, `${said('OLDEST')} of ${rows + 50} charged`);

const [dueIndexed, dueBuf] = said('DUEPLAN').split('|');
check('a quiet round finds nothing due without reading the ground',
  dueIndexed === 'true' && Number(dueBuf) < 50,
  `on item_ground_due: ${dueIndexed}, ${dueBuf} pages for ${said('LITTER')} things on the ground`);

const [goneIndexed, goneBuf] = said('GONEPLAN').split('|');
check('and sweeps up the worn-through without reading it either',
  goneIndexed === 'true' && Number(goneBuf) < 50,
  `on item_ground_gone: ${goneIndexed}, ${goneBuf} pages`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`what is lying about, going off where it lies — ${ok.length} of ${ok.length}`);
