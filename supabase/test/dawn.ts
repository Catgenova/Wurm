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
 * And the day the woods die, which is the day the first four never met. A
 * tree lives six days, so an island that came ashore with its trees spread
 * over the first four ages loses a quarter of them on its third morning and a
 * sixth to a quarter of them every morning after. The real island's tick
 * finished twice and then hit the timeout on every die-off it was given --
 * inside `b_i16`, writing down the dead. So this also asks:
 *
 *   * `b_i16` is one expression the planner can inline, and says what it
 *     always said for every one of the 65,536 values it can be handed;
 *   * the corners the record needs are read out of their two rows unpacked,
 *     not read a byte at a time out of the rows where they lie -- measured
 *     both ways, on a row of heights as wide and as compressible as a real one;
 *   * the saplings are drawn from a band of ground read out once, not from a
 *     join to the land per candidate;
 *   * a die-off on a real island still leaves stumps where the trees stood,
 *     saplings round them and nowhere else, and all of it written down;
 *   * and the tick takes one island a go, every minute of the dawn hour, with
 *     five minutes to do it in.
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
insert into said
select 'CORNERS|' || case
  when body like '%join land_corner c0%' then 'joined a byte at a time'
  when body like '%select c.heights || ''''::bytea, c.dirt || ''''::bytea into v_h0, v_d0%' then 'unpacked'
  else 'neither, so somebody has moved the read' end
from (select pg_get_functiondef('public.tree_day(uuid)'::regprocedure) as body) f;
insert into said
select 'GROUND|' || case
  when body like '%join land_tile t on t.world_id = p_world and t.y = c.gy%' then 'joined per candidate'
  when body like '%select string_agg(t.tiles, ''''::bytea order by t.y) into v_ground%' then 'a band read once'
  else 'neither, so somebody has moved the read' end
from (select pg_get_functiondef('public.tree_day(uuid)'::regprocedure) as body) f;

-- 1b. b_i16, inlined, and the same answer as ever for every value it can be handed.
-- Asked of a column, because handed a constant the planner works the answer
-- out before it runs and there is nothing left to look at either way.
create temp table two (b bytea);
insert into two values ('\\x01000200');
do $$
declare r record; v text := '';
begin
  for r in execute $q$ explain (verbose, costs off) select b_i16(b, 1) from two $q$ loop
    v := v || r."QUERY PLAN" || ' ';
  end loop;
  insert into said values ('INLINE|' || case when v like '%b_i16%' then 'called' when v like '%get_byte%' then 'inlined' else v end);
end $$;
insert into said
select 'EVERY|' || count(*) || '|' || count(*) filter (where
         b_i16(set_byte(set_byte('\\x0000'::bytea, 0, v & 255), 1, v >> 8), 0)
         is distinct from (case when v > 32767 then v - 65536 else v end))
  from generate_series(0, 65535) v;

-- 1c. What that costs, on two rows of corners as wide and as compressible as
--     the real island's: eight thousand bytes of heights -- a hill, terraced,
--     and a knock in every seventh corner -- which store as about half that,
--     as the real ones store as five in eight, and a line of soil. Four
--     hundred tiles written down the way the record was written the day it
--     timed out, and the way it is now.
create temp table corner (y int, heights bytea, dirt bytea);
insert into corner
select r, string_agg(set_byte(set_byte('\\x0000'::bytea, 0, h & 255), 1, h >> 8), ''::bytea order by g),
          string_agg(set_byte('\\x00'::bytea, 0, (g / 7) % 12), ''::bytea order by g)
  from generate_series(0, 1) r, generate_series(0, 4096) g,
       lateral (select (900 + 300 * sin(g / 97.0) + 40 * sin(g / 11.0 + r))::int / 4 * 4
                       + case when g % 7 = 0 then 1 else 0 end as h) q
 group by r;
create function pg_temp.old_i16(b bytea, i int) returns int language sql immutable as $f$
  select case when v > 32767 then v - 65536 else v end
  from (select get_byte(b, i * 2) | (get_byte(b, i * 2 + 1) << 8) as v) q
$f$;
create temp table told (x int, corners int[], soil int[]);
create function pg_temp.record(p_unpacked boolean) returns numeric language plpgsql as $f$
declare t0 timestamptz; v_h0 bytea; v_h1 bytea; v_d0 bytea; v_d1 bytea; v_x int[];
begin
  select array_agg(g * 10) into v_x from generate_series(0, 399) g;
  t0 := clock_timestamp();
  if p_unpacked then
    select c.heights || ''::bytea, c.dirt || ''::bytea into v_h0, v_d0 from corner c where c.y = 0;
    select c.heights || ''::bytea, c.dirt || ''::bytea into v_h1, v_d1 from corner c where c.y = 1;
    insert into told
    select u.gi, array[b_i16(v_h0, u.gi), b_i16(v_h0, u.gi + 1), b_i16(v_h1, u.gi + 1), b_i16(v_h1, u.gi)],
                 array[get_byte(v_d0, u.gi), get_byte(v_d0, u.gi + 1), get_byte(v_d1, u.gi + 1), get_byte(v_d1, u.gi)]
      from unnest(v_x) as u(gi);
  else
    insert into told
    select u.gi, array[pg_temp.old_i16(c0.heights, u.gi), pg_temp.old_i16(c0.heights, u.gi + 1),
                       pg_temp.old_i16(c1.heights, u.gi + 1), pg_temp.old_i16(c1.heights, u.gi)],
                 array[get_byte(c0.dirt, u.gi), get_byte(c0.dirt, u.gi + 1), get_byte(c1.dirt, u.gi + 1), get_byte(c1.dirt, u.gi)]
      from unnest(v_x) as u(gi)
      join corner c0 on c0.y = 0
      join corner c1 on c1.y = 1;
  end if;
  return extract(epoch from (clock_timestamp() - t0)) * 1000;
end $f$;
do $$
declare i int; v numeric; v_old numeric := 1e9; v_new numeric := 1e9; v_same boolean;
begin
  insert into said select 'STORED|' || pg_column_size(heights) || '|' || octet_length(heights) from corner where y = 0;
  -- Best of five each way, so a busy runner slows both rather than one.
  for i in 1..5 loop
    delete from told;
    v_old := least(v_old, pg_temp.record(false));
  end loop;
  create temp table told_old as select * from told;
  for i in 1..5 loop
    delete from told;
    v_new := least(v_new, pg_temp.record(true));
  end loop;
  v_same := not exists (select * from told except select * from told_old)
        and not exists (select * from told_old except select * from told);
  insert into said values ('RECORD|' || to_char(v_old, 'FM9990.00') || '|' || to_char(v_new, 'FM9990.00')
    || '|' || to_char(v_old / greatest(v_new, 0.001), 'FM99990.0') || '|' || case when v_same then 'same' else 'DIFFERENT' end);
end $$;

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
    execute $q$ select coalesce(max(schedule || '|' || command), 'not wound') from cron.job where jobname = 'tree-tick' $q$ into v;
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
  -- A go is one island, so every other island is stamped as turned first:
  -- the question is whether this one's day is taken, not which one is drawn.
  update world set trees_at = now() where id <> w.id;
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

-- 5. The day the woods die, on a real island: a block of shrivelled oaks in a
--    clearing, with a settlement over one corner of the clearing.
do $$
declare w record; v_first int := tree_first(); v_before int; v_after int;
        v_stumps int; v_saplings int; v_far int; v_deeded int; v_unplantable int; v_told int; v_wrong int;
begin
  select * into w from world where ready and size >= 64 and size <= 128 order by name limit 1;
  if w is null then insert into said values ('DIEOFF|no island'); return; end if;
  update player set away = true where world_id = w.id;
  delete from deed where world_id = w.id;
  delete from tile_change where world_id = w.id;
  -- Whatever wood the island already had is cleared, so that nothing but the
  -- block below dies today or seeds anything.
  for j in 0 .. w.size - 1 loop for i in 0 .. w.size - 1 loop
    if land_tile(w.id, i, j) in (16, tile_id('Stump')) then
      perform land_set_tile(w.id, i, j, tile_id('Grass'));
      perform land_set_data(w.id, i, j, 0);
    end if;
  end loop; end loop;
  for j in 10..33 loop for i in 10..33 loop
    perform land_set_tile(w.id, i, j, tile_id('Grass'));
    perform land_set_data(w.id, i, j, 0);
  end loop; end loop;
  -- Shrivelled is the last age there is: every one of these goes today.
  for j in 16..27 loop for i in 16..27 loop
    perform land_set_tile(w.id, i, j, 16);
    perform land_set_data(w.id, i, j, tree_pack(2, (select id from tree_age_def where next is null and not alive)));
  end loop; end loop;
  insert into deed (world_id, name, x, y, radius, level, founded_by)
  values (w.id, 'The corner', 12, 12, 3, 1, '00000000-0000-4000-8000-00000000dead');
  update world set trees_at = tree_last_dawn() - interval '1 minute' where id = w.id;
  perform tree_day(w.id);

  select count(*) filter (where land_tile(w.id, i, j) = tile_id('Stump')),
         count(*) filter (where land_tile(w.id, i, j) = 16 and tree_age(land_data(w.id, i, j)) = v_first)
    into v_stumps, v_saplings
    from generate_series(10, 33) i, generate_series(10, 33) j;
  -- A sapling further from every stump than a seed goes, on the settlement, or
  -- on anything but the grass it was all laid as.
  select count(*) filter (where not exists (select 1 from generate_series(16, 27) si, generate_series(16, 27) sj
                                             where abs(si - i) <= tree_seed_reach() and abs(sj - j) <= tree_seed_reach())),
         count(*) filter (where exists (select 1 from deed d where d.world_id = w.id and deed_covers(d, i, j)))
    into v_far, v_deeded
    from generate_series(0, w.size - 1) i, generate_series(0, w.size - 1) j
   where land_tile(w.id, i, j) = 16 and tree_age(land_data(w.id, i, j)) = v_first
     and not (i between 16 and 27 and j between 16 and 27);
  select count(*) into v_unplantable
    from generate_series(10, 33) i, generate_series(10, 33) j
   where land_tile(w.id, i, j) = 16 and (i between 16 and 27 and j between 16 and 27);
  -- And the record: a row for every stump and every sapling, and what it says
  -- is what the land says, corners and all.
  select count(*) into v_told from tile_change c where c.world_id = w.id;
  select count(*) into v_wrong from tile_change c
   where c.world_id = w.id
     and (c.tile <> land_tile(w.id, c.x, c.y) or c.data <> land_data(w.id, c.x, c.y)
          or c.corners <> array[land_height(w.id, c.x, c.y), land_height(w.id, c.x + 1, c.y),
                                land_height(w.id, c.x + 1, c.y + 1), land_height(w.id, c.x, c.y + 1)]);
  insert into said values ('DIEOFF|' || v_stumps || '|' || v_saplings || '|' || v_far || '|' || v_deeded
    || '|' || v_unplantable || '|' || v_told || '|' || v_wrong
    || '|' || case when (select trees_at from world where id = w.id) >= tree_last_dawn() then 'marked' else 'unmarked' end);
end $$;

-- 6. One island a go: two owed, three goes.
do $$
declare a uuid; b uuid; t1 jsonb; t2 jsonb; t3 jsonb;
begin
  update world set trees_at = now();
  select id into a from world where ready and size <= 128 order by name limit 1;
  select id into b from world where ready and size <= 128 and id <> a order by name limit 1;
  update world set trees_at = tree_last_dawn() - interval '1 minute' where id in (a, b);
  t1 := tree_tick();
  t2 := tree_tick();
  t3 := tree_tick();
  insert into said values ('GOES|' || coalesce(t1->>'isles', '?') || '|' || coalesce(t2->>'isles', '?') || '|' || coalesce(t3->>'isles', '?')
    || '|' || (select count(*) from world where id in (a, b) and trees_at >= tree_last_dawn()));
end $$;

select * from said;
rollback;
`);

const said = (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

check('the day\'s pass is handed a line, not a line folded up',
  said('READ') === 'unpacked', said('READ'));
check('the corners the record needs are read out of their two rows unpacked, once a line',
  said('CORNERS') === 'unpacked', said('CORNERS'));
check('and the ground the saplings are drawn from is a band read out once, not a join per candidate',
  said('GROUND') === 'a band read once', said('GROUND'));

check('`b_i16` is one expression the planner inlines, not a function called per corner',
  said('INLINE') === 'inlined', said('INLINE'));
const [every, differ] = said('EVERY').split('|');
check('and it says what it always said, for every value it can be handed',
  every === '65536' && differ === '0', `${differ} of ${every} values differ`);

const [hStored, hLong] = said('STORED').split('|');
check('a row of heights as wide as the real island\'s is stored packed',
  Number(hStored) < Number(hLong), `${hStored} bytes stored, ${hLong} bytes long`);
const [rOld, rNew, rGain, rSame] = said('RECORD').split('|');
check('and four hundred tiles written down from it cost a fraction of what they did the day the tick timed out',
  Number(rGain) >= 5 && rSame === 'same', `${rOld} ms read where they lie, ${rNew} ms read out once — ${rGain}×, and the rows are ${rSame}`);

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
check('and where there is a cron to wind, it is wound for every minute of that hour and no other, with five minutes a go',
  said('CRON') === "* 13 * * *|set statement_timeout = '5min'; select public.tree_tick()" || said('CRON') === 'no cron here', said('CRON'));

const [before, after, marked, isles] = said('DAY').split('|');
check('a day owed is a day taken: the tree is older',
  Number(after) === Number(before) + 1, `age ${before} became age ${after}`);
check('and the island is marked as having had it',
  marked === 'marked' && Number(isles) >= 1, `${marked}, ${isles} island(s)`);
check('and the very next go finds nothing owed', said('AGAIN') === '0', `${said('AGAIN')} island(s)`);

const [stumps, saplings, far, deeded, unplantable, told, wrong, dieMarked] = said('DIEOFF').split('|');
check('a die-off leaves a stump where every tree stood',
  stumps === '144', `${stumps} stumps where 144 shrivelled oaks were`);
check('and saplings round them, none further than a seed goes and none on the settlement',
  Number(saplings) > 0 && far === '0' && deeded === '0',
  `${saplings} saplings; ${far} out of reach, ${deeded} on the settlement`);
check('and none where the stumps are, which is not ground a seed takes',
  unplantable === '0', `${unplantable} trees standing among the stumps`);
check('and every one of them written down, as the land has it',
  Number(told) === Number(stumps) + Number(saplings) && wrong === '0' && dieMarked === 'marked',
  `${told} rows for ${stumps} stumps and ${saplings} saplings, ${wrong} that disagree with the land, island ${dieMarked}`);

const [go1, go2, go3, turned] = said('GOES').split('|');
check('the tick takes one island a go: two owed, turned one and then the other, and then none',
  go1 === '1' && go2 === '1' && go3 === '0' && turned === '2', `${go1}, ${go2}, ${go3}; ${turned} of 2 turned`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the woods turn over once, at dawn, and finish — ${ok.length} of ${ok.length}`);
