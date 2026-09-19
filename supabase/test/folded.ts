/**
 * The numbers a browser reads are the same, and cheap again.
 *
 * `rpc_creatures` is the call every browser makes every second. With the
 * wildlife sweep off it, four hundred creatures in the box still cost a
 * hundred and fifty milliseconds to answer, and ninety-six percent of that
 * was one field: `max`.
 *
 * Postgres folds a `language sql` scalar function into its caller — which is
 * why `beast_mul` and `trait_mul` cost nearly nothing — but refuses when the
 * body holds a sublink. `max_health` held one, `(select health from
 * species_def …)`, so every row paid a whole function call with the entire
 * `creature` row handed in as a composite, which handed it in again to
 * `beast_mul`. `deed_aura` held one too, and so four hundred wild animals
 * each paid a call to be told the thing they are not on a deed.
 *
 * Both had the sublink moved into a helper that takes a string, or four, and
 * the bodies around them fold. This asks the three things that matters:
 *
 *   * the bodies are still free of sublinks, which is the property that makes
 *     them fold — a future edit that puts one back would be silent otherwise;
 *   * the answers are arithmetic-identical to the bodies they replaced, over
 *     every creature on the island and every channel there is;
 *   * and `max_health` costs about what its own body costs, where before it
 *     cost eleven times as much. Measured as a ratio, both halves on the same
 *     box in the same second, so a loaded machine moves both and not the
 *     verdict.
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

-- The bodies as they were before the rewrite, to answer against.
create function was_max_health(c creature) returns double precision
 language sql stable as $f$
  select round((select health from species_def where id = c.species) * beast_mul(c, 'hardy'))
 $f$;
create function was_deed_aura(c creature, p_channel text) returns double precision
 language sql stable as $f$
  select case when c.mode <> 'deed' or not aura_channel(p_channel) then 1 else
    coalesce((select exp(sum(ln(e.mul)))
      from creature o
      cross join lateral unnest(coalesce(o.traits, '{}')) u(id)
      join trait_def d on d.id = u.id and d.aura
      join trait_effect e on e.trait = u.id and e.channel = p_channel
      where o.world_id = c.world_id and o.mode = 'deed'
        and o.keeper is not distinct from c.keeper
        and o.post is not distinct from c.post), 1) end
 $f$;

-- The property that makes a body foldable, asked of the bodies themselves.
insert into said select 'SUBLINK|' || coalesce(string_agg(proname, ', '), 'none')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('max_health', 'deed_aura')
   and p.prosrc ~ '\\(\\s*select';

do $$
declare v_n int; v_chan int; v_beasts int;
        t0 timestamptz; v_fn double precision; v_body double precision; i int;
begin
  select count(*) into v_beasts from creature;
  select count(distinct channel) into v_chan from trait_effect;

  select count(*) filter (where max_health(c) is distinct from was_max_health(c))
    into v_n from creature c;
  insert into said values ('MAX|' || v_n || ' of ' || v_beasts);

  select count(*) filter (where deed_aura(c, ch.channel) is distinct from was_deed_aura(c, ch.channel))
    into v_n from creature c cross join (select distinct channel from trait_effect) ch;
  insert into said values ('AURA|' || v_n || ' of ' || (v_beasts * v_chan));
  insert into said values ('PAIRS|' || (v_beasts * v_chan) || ' over ' || v_chan || ' channels');

  -- One worked out straight from the tables, owing nothing to either body.
  select count(*) filter (where max_health(c) is distinct from round(s.health
      * coalesce((select exp(sum(ln(e.mul))) from trait_effect e
                   where e.channel = 'hardy' and e.trait = any(coalesce(c.traits, '{}'))), 1)))
    into v_n from creature c join species_def s on s.id = c.species where c.mode <> 'deed';
  insert into said values ('SUMS|' || v_n);

  -- And what it costs, against its own body written out. Best of three.
  v_fn := 1e9; v_body := 1e9;
  for i in 1..3 loop
    t0 := clock_timestamp();
    perform sum(max_health(c)) from creature c;
    v_fn := least(v_fn, extract(epoch from (clock_timestamp() - t0)) * 1000);
    t0 := clock_timestamp();
    perform sum(round(species_health(c.species) * trait_mul(c.traits, 'hardy') * deed_aura(c, 'hardy')))
      from creature c;
    v_body := least(v_body, extract(epoch from (clock_timestamp() - t0)) * 1000);
  end loop;
  insert into said values ('COST|' || to_char(v_fn, 'FM9990.0') || '|'
    || to_char(v_body, 'FM9990.0') || '|' || to_char(v_fn / greatest(v_body, 0.001), 'FM990.00'));
end $$;
select * from said;
rollback;
`);
const said = (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

check('neither body carries a sublink, so both fold into their callers',
  said('SUBLINK') === 'none', said('SUBLINK'));
check('max_health answers exactly what its old body answered, every creature',
  said('MAX').startsWith('0 of ') && !said('MAX').endsWith(' of 0'), said('MAX'));
check('and deed_aura likewise, on every channel there is',
  said('AURA').startsWith('0 of ') && !said('AURA').endsWith(' of 0'), said('AURA'));
check('which is a real number of pairs, not an empty island', said('PAIRS') !== 'MISSING', said('PAIRS'));
check('and the number agrees with the tables it is made of, owing nothing to either body',
  said('SUMS') === '0', `${said('SUMS')} disagree`);

const [fn, body, ratio] = said('COST').split('|');
check('and calling it costs about what its own body costs, where it used to cost eleven times as much',
  Number(ratio) <= 3, `${fn} ms through the function, ${body} ms written out — ${ratio}×`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the same numbers, folded back into the query — ${ok.length} of ${ok.length}`);
