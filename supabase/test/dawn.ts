/**
 * A day in the woods happens at dawn, and finishes.
 *
 * `tree-tick` had been wound at ten-minute intervals against a job with one
 * day's work in it, and the one go a day that had work to do was being killed
 * by the statement timeout — twenty-eight times in a row on the real island.
 *
 * The reason is a cliff that opens on the fourth line of an island and is
 * invisible before it. `land_tile.tiles` is four kilobytes and compresses to
 * a few hundred, and `select into` copies the datum as the row stores it — so
 * the variable holds the line folded up. plpgsql plans a statement afresh for
 * its first few goes, and a fresh plan folds the parameter in as a constant,
 * unpacked once. On the fifth go it keeps the plan, the value becomes a
 * parameter, and every `get_byte` unpacks the whole line again to read one
 * byte out of it. Appending nothing to the read unpacks it once, up front.
 *
 * So this asks four things:
 *
 *   * `tree_day` still hands `select into` a line rather than a folded line,
 *     which a future edit could undo in one character and nothing would say;
 *   * the cliff is real, measured here rather than asserted, and the appended
 *     read does not go over it;
 *   * the island's dawn is nine in the morning at UTC-4, and the tick is wound
 *     for that hour and no other;
 *   * and a day owed is still a day taken, on a real island, with the trees
 *     older at the end of it.
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

const out = psql(`
begin;
create temp table said (k text);

-- 1. What the read hands the rest of the function.
insert into said
select 'READ|' || case
  when body like '%select t.tiles, t.data into v_tiles, v_data%' then 'folded'
  when body not like '%select t.tiles || ''''::bytea, t.data || ''''::bytea into v_tiles, v_data%'
    then 'neither, so somebody has moved the read'
  else 'unpacked' end
from (select pg_get_functiondef('public.tree_day(uuid)'::regprocedure) as body) f;

-- 2. The cliff, on a line the same width and the same compressibility as a
--    real one: four thousand bytes of ground with a tree every tenth tile.
create temp table line (b bytea);
insert into line
select string_agg(set_byte('\\x00'::bytea, 0, case when g % 10 = 0 then 16 else 0 end), ''::bytea order by g)
  from generate_series(0, 4095) g;

create function pg_temp.pass(p_unpack boolean) returns numeric language plpgsql as $f$
declare v bytea; t0 timestamptz; n int;
begin
  if p_unpack then select b || ''::bytea into v from line; else select b into v from line; end if;
  t0 := clock_timestamp();
  -- The same shape as the day's pass: several looks at the line per tile.
  select count(*) into n from generate_series(0, 4095) g
   where get_byte(v, g) = 16 or get_byte(v, g) = 17 or get_byte(v, g) = 4
      or (get_byte(v, g) & 15) = 3 or get_byte(v, g) > 200;
  return extract(epoch from (clock_timestamp() - t0)) * 1000;
end $f$;

do $$
declare i int; v numeric; folded_first numeric; folded_last numeric; flat_first numeric; flat_last numeric;
begin
  -- How it is stored, which is the whole reason this happens.
  insert into said select 'SIZE|' || pg_column_size(b) || '|' || octet_length(b) from line;
  for i in 1..12 loop
    v := pg_temp.pass(false);
    if i = 1 then folded_first := v; end if;
    if i = 12 then folded_last := v; end if;
  end loop;
  for i in 1..12 loop
    v := pg_temp.pass(true);
    if i = 1 then flat_first := v; end if;
    if i = 12 then flat_last := v; end if;
  end loop;
  insert into said values ('CLIFF|' || to_char(folded_first, 'FM9990.00') || '|' || to_char(folded_last, 'FM9990.00')
    || '|' || to_char(folded_last / greatest(folded_first, 0.001), 'FM9990.0'));
  insert into said values ('FLAT|' || to_char(flat_first, 'FM9990.00') || '|' || to_char(flat_last, 'FM9990.00')
    || '|' || to_char(flat_last / greatest(flat_first, 0.001), 'FM9990.0'));
  insert into said values ('GAIN|' || to_char(folded_last / greatest(flat_last, 0.001), 'FM9990.0'));
end $$;

-- 3. The hour. Thirteen hundred UTC is nine in the morning at UTC-4.
insert into said select 'HOUR|' || tree_dawn_utc();
insert into said select 'DAWN|' || to_char(tree_last_dawn() at time zone 'UTC', 'HH24:MI:SS')
  || '|' || case when tree_last_dawn() <= now() and tree_last_dawn() > now() - interval '1 day'
                 then 'behind us' else 'nowhere near now' end
  || '|' || case when tree_next_dawn() = tree_last_dawn() + interval '1 day' and tree_next_dawn() > now()
                 then 'a day on' else 'not a day on' end;
insert into said select 'GATE|' || case
  when pg_get_functiondef('public.tree_tick()'::regprocedure) like '%trees_at < tree_last_dawn()%'
  then 'last dawn' else 'something else' end;
-- The bare postgres the suite runs on has no pg_cron, so this is asked at
-- run time or not at all: naming the table outright fails to parse there.
do $$
declare v text;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    execute $q$ select coalesce(max(schedule), 'not wound') from cron.job where jobname = 'tree-tick' $q$ into v;
  else
    v := 'no cron here';
  end if;
  insert into said values ('CRON|' || v);
end $$;

-- 4. And a day owed is a day taken, on a real island with a real tree on it.
do $$
declare w record; v_x int := 3; v_y int := 3; v_before int; v_after int; v_grew jsonb;
begin
  select * into w from world where ready order by size desc limit 1;
  if w is null then insert into said values ('DAY|no island'); return; end if;
  update land_tile set tiles = set_byte(tiles, v_x, 16), data = set_byte(data, v_x, tree_pack(0, 0))
    where world_id = w.id and y = v_y;
  v_before := (select tree_age(get_byte(data, v_x)) from land_tile where world_id = w.id and y = v_y);
  update world set trees_at = tree_last_dawn() - interval '1 second' where id = w.id;
  v_grew := tree_tick();
  v_after := (select tree_age(get_byte(data, v_x)) from land_tile where world_id = w.id and y = v_y);
  insert into said values ('DAY|' || v_before || '|' || v_after || '|'
    || case when (select trees_at from world where id = w.id) >= tree_last_dawn() then 'marked' else 'unmarked' end
    || '|' || coalesce(v_grew->>'isles', '?'));
  -- And nothing owed is nothing done, the very next go.
  v_grew := tree_tick();
  insert into said values ('AGAIN|' || coalesce(v_grew->>'isles', '?'));
end $$;

select * from said;
rollback;
`);

const said = (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

check('the day\'s pass is handed a line, not a line folded up',
  said('READ') === 'unpacked', said('READ'));

const [stored, reads] = said('SIZE').split('|');
check('a line of ground is stored packed, which is what makes this possible at all',
  Number(stored) < Number(reads) / 2, `${stored} bytes stored, ${reads} bytes long`);

const [cf, cl, cliff] = said('CLIFF').split('|');
check('reading it folded falls off a cliff once plpgsql keeps the plan',
  Number(cliff) >= 3, `${cf} ms on the first go, ${cl} ms on the twelfth — ${cliff}×`);

const [ff, fl, flat] = said('FLAT').split('|');
check('and reading it unpacked does not, however many goes it gets',
  Number(flat) <= 3, `${ff} ms on the first go, ${fl} ms on the twelfth — ${flat}×`);

check('which is the whole difference, on the twelfth go', Number(said('GAIN')) >= 3,
  `${said('GAIN')}× between the two`);

check('the island\'s dawn is nine in the morning at UTC-4', said('HOUR') === '13', `${said('HOUR')}:00 UTC`);
check('and the last dawn is that hour, behind us, with the next one a day on',
  said('DAWN') === '13:00:00|behind us|a day on', said('DAWN'));
check('the tick still asks whether a day is owed since that dawn',
  said('GATE') === 'last dawn', said('GATE'));
check('and where there is a cron to wind, it is wound for that hour and no other',
  said('CRON') === '0 13 * * *' || said('CRON') === 'no cron here', said('CRON'));

const [before, after, marked, isles] = said('DAY').split('|');
check('a day owed is a day taken: the tree is older',
  Number(after) === Number(before) + 1, `age ${before} became age ${after}`);
check('and the island is marked as having had it',
  marked === 'marked' && Number(isles) >= 1, `${marked}, ${isles} island(s)`);
check('and the very next go finds nothing owed', said('AGAIN') === '0', `${said('AGAIN')} island(s)`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the woods turn over once, at dawn, and finish — ${ok.length} of ${ok.length}`);
