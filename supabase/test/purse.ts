/**
 * One purse, two payments at once.
 *
 * `take_coins` counted a purse and then took coins out of it, and a second
 * payment out of the same purse could count it in between: both found the
 * money there, and the second was told it had paid with coins the first had
 * already taken. It holds the purse's coins before counting them now.
 *
 * Two sessions pay 8 silver each out of a purse of 10. The first holds its
 * payment open for a second and a half; the second asks in the middle of it.
 * The first pays; the second waits for it, counts the 2 that are left and is
 * refused; and the purse ends at 2.
 *
 * Runs against the database the suite leaves behind, committed and tidied
 * away after, since the race wants two sessions to see the same purse.
 */
import { execFileSync, spawn } from 'node:child_process';

const ENV = {
  ...process.env,
  PGHOST: process.env.PGHOST ?? '/var/run/postgresql',
  PGPORT: process.env.PGPORT ?? '5433',
  PGUSER: process.env.PGUSER ?? 'wurm',
  PGDATABASE: process.env.PGDATABASE ?? 'postgres',
};
const ARGS = ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'];
const psql = (sql: string): string => execFileSync('psql', ARGS, { input: sql, encoding: 'utf8', env: ENV }).trim();
const session = (sql: string): Promise<string> => new Promise((done, fail) => {
  const p = spawn('psql', ARGS, { env: ENV });
  let out = '';
  let err = '';
  p.stdout.on('data', (b: Buffer) => (out += b.toString()));
  p.stderr.on('data', (b: Buffer) => (err += b.toString()));
  p.on('close', (code) => (code === 0 ? done(out.trim()) : fail(new Error(err))));
  p.stdin.end(sql);
});

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const IONA = 'd6d6d6d6-d6d6-d6d6-d6d6-d6d6d6d6d6d6';
const world = psql(`select id from world where name = 'Hoarding';`);
const tidy = `
delete from item where world_id = '${world}' and holder_uid = '${IONA}';
delete from player where world_id = '${world}' and uid = '${IONA}';
`;
try {
  psql(`
${tidy}
insert into player (world_id, uid, name, x, y) values ('${world}', '${IONA}', 'Iona', 8.5, 8.5);
select give_coins('${world}', '${IONA}', 10) \\g /dev/null
`);
  check('a purse of 10 silver to pay out of', psql(`select purse('${world}', '${IONA}');`) === '10');
  const [first, second] = await Promise.all([
    session(`
begin;
select take_coins('${world}', '${IONA}', 8);
select 'the first holds it', pg_sleep(1.5);
commit;`),
    session(`
do $$
declare tries int := 0;
begin
  while tries < 200 and not exists (select 1 from pg_stat_activity where pid <> pg_backend_pid()
                                       and state = 'active' and query like '%the first holds it%') loop
    perform pg_sleep(0.05);
    perform pg_stat_clear_snapshot();
    tries := tries + 1;
  end loop;
end $$;
select take_coins('${world}', '${IONA}', 8) || '|'
  || round(extract(epoch from clock_timestamp() - statement_timestamp())::numeric, 1);`),
  ]);
  check('the first payment goes through', first.split('\n')[0] === 't', first.split('\n')[0]);
  const [paid, waited] = second.split('|');
  check('the second waits for the first, and is refused for what is left', paid === 'false' && Number(waited) >= 0.8,
    `${second} (paid|seconds waited)`);
  check('and the purse ends at what the first left', psql(`select purse('${world}', '${IONA}');`) === '2');
} finally {
  psql(tidy);
}

for (const line of [...ok, ...bad]) console.log(line);
console.log(`one purse, two payments — ${ok.length} of ${ok.length + bad.length}`);
if (bad.length) process.exit(1);
