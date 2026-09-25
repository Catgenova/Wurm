/**
 * Islands that go.
 *
 * Asked for, of the live project: "Clean up after the CI test" -- seven
 * islands the smoke test founded between 09-17 and 09-20 were still on it --
 * and "Retire islands nobody plays". `reap_islands` used to take only an
 * island nobody had stood on for a month. It now takes, whichever comes first:
 *
 *   * an island founded to last a while, once its while is up, whoever is on it;
 *   * a founding still shut a day on, which nobody can have set foot on;
 *   * an island nobody ever came ashore on, a week after it was made;
 *   * and one nobody has stood on for a month, as before.
 *
 * The home island never goes. And the three tables that kept an island's id
 * with no foreign key -- `bridge_span`, `friend`, `letter` -- lose their rows
 * with it.
 *
 * Eleven islands, each set up to sit just inside or just outside one rule, are
 * put down in a transaction that is rolled back, and the clock's own tidy is
 * called on them. Runs against the database the suite leaves behind.
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

/** Each island: its name, when it was made, whether it opened, when anybody on it was last seen, and whether it lasts. */
const ISLANDS: Array<{ name: string; made: string; ready: boolean; seen?: string; lasts?: string; home?: true; goes: boolean }> = [
  { name: 'Reap home', made: '60 days', ready: true, home: true, goes: false },
  { name: 'Reap shut', made: '25 hours', ready: false, goes: true },
  { name: 'Reap shut today', made: '23 hours', ready: false, goes: false },
  { name: 'Reap unvisited', made: '8 days', ready: true, goes: true },
  { name: 'Reap unvisited new', made: '6 days', ready: true, goes: false },
  { name: 'Reap played', made: '40 days', ready: true, seen: '20 days', goes: false },
  { name: 'Reap forgotten', made: '60 days', ready: true, seen: '31 days', goes: true },
  { name: 'Reap old, new face', made: '60 days', ready: true, seen: '1 hour', goes: false },
  { name: 'Reap trial over', made: '2 days', ready: true, seen: '1 minute', lasts: '-1 minute', goes: true },
  { name: 'Reap trial running', made: '1 hour', ready: true, seen: '1 minute', lasts: '1 hour', goes: false },
];

const setUp = ISLANDS.map((isle, i) => {
  const id = `00000000-0000-0000-0000-0000000ee${String(i).padStart(3, '0')}`;
  return `
insert into world (id, name, seed, size, spawn_x, spawn_y, ready, made_at, lasts_until)
values ('${id}', '${isle.name.replace(/'/g, "''")}', ${i}, 8, 4, 4, ${isle.ready}, now() - interval '${isle.made}',
        ${isle.lasts ? `now() + interval '${isle.lasts}'` : 'null'});
${isle.seen ? `insert into player (world_id, uid, name, x, y, seen_at, joined_at)
values ('${id}', '00000000-0000-0000-0000-00000000f${String(i).padStart(3, '0')}', 'Reaper${i}', 4, 4,
        now() - interval '${isle.seen}', now() - interval '${isle.made}');` : ''}`;
}).join('\n');

const homeId = (name: string): string =>
  `00000000-0000-0000-0000-0000000ee${String(ISLANDS.findIndex((x) => x.name === name)).padStart(3, '0')}`;
const shut = homeId('Reap shut');

const out = psql(`
begin;
${setUp}
insert into home (one, island) values (true, '${homeId('Reap home')}')
  on conflict (one) do update set island = excluded.island;
-- A row in each of the three tables that had no foreign key, on an island that goes.
insert into letter (world_id, sender, reader, text) values ('${shut}', gen_random_uuid(), gen_random_uuid(), 'hello');
insert into friend (world_id, uid, other) values ('${shut}', gen_random_uuid(), gen_random_uuid());
insert into bridge_span (world_id, bridge, n, x, y, needed, total) values ('${shut}', 1, 0, 1, 1, '{}', '{}');
select 'REAPED|' || reap_islands();
select 'LEFT|' || coalesce(string_agg(name, ';' order by name), '') from world where name like 'Reap %';
select 'ORPHANS|' || (select count(*) from letter where world_id = '${shut}')
     + (select count(*) from friend where world_id = '${shut}')
     + (select count(*) from bridge_span where world_id = '${shut}');
-- Made the home, one that never opened is never taken, however long it stays shut.
update home set island = '${homeId('Reap shut today')}';
update world set made_at = now() - interval '3 days' where id = '${homeId('Reap shut today')}';
select 'HOMESHUT|' || coalesce(island_goes_at('${homeId('Reap shut today')}')::text, 'never');
-- And what the readout will say of one that is played: a month after it was last seen.
select 'PLAYED|' || round(extract(epoch from island_goes_at('${homeId('Reap played')}') - now()) / 86400);
-- Founding to last: a day is kept, a minute is the least, a month the most.
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000ee999')::text, true);
select rpc_found('Reap founded', 5, 8, 4, 4, 86400) as founded \\gset
select 'LASTS|' || round(extract(epoch from w.lasts_until - now())) from world w where w.id = :'founded';
select rpc_found('Reap founded, kept', 5, 8, 4, 4) as kept \\gset
select 'UNLASTING|' || coalesce(w.lasts_until::text, 'null') from world w where w.id = :'kept';
create temp table reap_said (v text) on commit drop;
do $$ begin
  perform rpc_found('Reap too short', 5, 8, 4, 4, 30);
  insert into reap_said values ('allowed');
exception when others then insert into reap_said values (sqlerrm);
end $$;
select 'SHORT|' || v from reap_said;
rollback;
`);

const said = (key: string): string => out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? '';
const left = new Set(said('LEFT').split(';').filter(Boolean));
for (const isle of ISLANDS) {
  const why = isle.home ? 'the home island'
    : isle.lasts ? `founded to last, ${isle.lasts.startsWith('-') ? 'and over' : 'and still running'}, with somebody on it`
      : !isle.ready ? `never opened, made ${isle.made} ago`
        : !isle.seen ? `nobody ever came ashore, made ${isle.made} ago`
          : `made ${isle.made} ago, last seen ${isle.seen} ago`;
  check(`${isle.goes ? 'goes' : 'stays'}: ${why}`, left.has(isle.name) === !isle.goes,
    left.has(isle.name) ? 'still there' : 'gone');
}
const goes = ISLANDS.filter((x) => x.goes).length;
check(`the tidy says it took ${goes}`, said('REAPED') === String(goes), said('REAPED'));
check('its letters, friends and bridge spans go with it', said('ORPHANS') === '0', `${said('ORPHANS')} left`);
check('a home that never opened still never goes', said('HOMESHUT') === 'never', said('HOMESHUT'));
check('one played 20 days ago goes a month after that, in 10 days', said('PLAYED') === '10', `${said('PLAYED')} days`);
check('an island founded to last a day is kept a day', Math.abs(Number(said('LASTS')) - 86400) <= 2, `${said('LASTS')} s`);
check('one founded without saying is kept by the other rules', said('UNLASTING') === 'null', said('UNLASTING'));
check('and half a minute is refused, in the island\'s words', said('SHORT') === 'an island is kept between a minute and 30 days',
  said('SHORT'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`islands that go — ${ok.length} of ${ok.length}`);
