/**
 * One pile and not six.
 *
 * Reported off a screenshot of a pack holding 1,996 things, among them six
 * separate piles of cotton seeds at 22.4, 37.4, 35.0, 45.6, 63.1 and 47.3.
 * `give` had always folded a harvest into a matching stack; the eight
 * statements that *move* a row into a pack -- picking up, taking all from a
 * crate, emptying a cupboard, clearing a trap, buying, collecting the post --
 * folded nothing, so every one of them started a rival pile.
 *
 * There is one rule now, `stack_key`, and `sameStack` in the browser is the
 * same sentence. This asks:
 *
 *   * the reported case folds, with nothing gained or lost by it;
 *   * the things that must not fold do not -- a locked pile above all, since
 *     locking is how somebody says *not this one*;
 *   * the two sides agree, pair by pair, rather than being trusted to;
 *   * the doors that move rows fold them on arrival;
 *   * ash is a raw material on both sides, and a bin will take it;
 *   * and a worker carrying anything raw walks to a raw material bin even
 *     when a crate is nearer.
 *
 * Runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';
import { sameStack, itemDef } from '../../src/game/items';
import type { Item } from '../../src/game/items';

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

/*
 * The pairs both sides are asked about. The first of each is the plain thing;
 * the second differs in exactly one way, and the third column is whether they
 * should end up in one pile.
 */
const base = { uid: 1, id: 'cotton_seed', ql: 30, dmg: 0, count: 1 } as Item;
const PAIRS: Array<[string, Partial<Item>, boolean]> = [
  ['nothing at all differs', {}, true],
  ['a different quality', { ql: 90 }, true],
  ['a different damage', { dmg: 12 }, true],
  ['a different count', { count: 7 }, true],
  ['one of them is locked', { locked: true }, false],
  ['one of them is lit', { lit: true }, false],
  ['a different wood or species', { extra: 'oak' }, false],
  ['a rarity on one of them', { rare: 2 }, false],
  ['a colour on one of them', { dye: 'blue' }, false],
  ['a blessing on one of them', { bless: 2 }, false],
  ['a maker’s mark on one of them', { maker: 'Ivar' }, false],
  ['a different piece', { piece: 'hatchet_head' }, false],
  ['one of them was issued, not made', { issued: true }, false],
  ['a different number of charges', { charges: 3 }, false],
];
const rows = PAIRS.map(([, diff], i) => ({ i, diff }));

const lit = (v: unknown): string =>
  v === undefined || v === null ? 'null'
    : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'`
    : typeof v === 'boolean' ? (v ? 'true' : 'false')
    : String(v);
const asRow = (it: Partial<Item> & { id?: string }): string =>
  `(null, null, 'player', null, null, null, ${lit(it.inside ?? null)}, ${lit(it.id ?? base.id)},`
  + ` ${lit(it.ql ?? base.ql)}, ${lit(it.dmg ?? base.dmg)}, ${lit(it.count ?? base.count)},`
  + ` ${lit(it.extra ?? null)}, ${lit(it.rare ?? null)}, ${lit(it.dye ?? null)}, ${lit(it.bless ?? null)},`
  + ` ${lit(it.charges ?? null)}, ${lit(it.locked ?? false)}, ${lit(it.issued ?? false)}, now(), null,`
  + ` ${lit(it.lit ?? false)}, null, null, null, ${lit(it.maker ?? null)}, ${lit(it.piece ?? null)},`
  + ` null, null, null, null)::item`;

const out = psql(`
begin;
create temp table said (k text);
-- A player on an island that has a settlement with a worker on it, because
-- the last third of this asks where a worker takes a load. Picking any player
-- and hoping worked until the sweep ran in a different order and picked one
-- ashore on an empty island.
select p.world_id, p.uid into temp who from player p
 where exists (select 1 from deed d
                where d.world_id = p.world_id
                  and exists (select 1 from creature c where c.world_id = d.world_id
                                and c.keeper = d.founded_by and c.mode = 'deed'))
 order by p.world_id, p.uid limit 1;

-- 1. The pack from the screenshot, six piles of cotton seeds.
insert into item (world_id, holder, holder_uid, def, ql, count)
select w.world_id, 'player', w.uid, 'cotton_seed', q.ql, q.n from who w,
 (values (22.4,1),(37.4,2),(35.0,1),(45.6,3),(63.1,1),(47.3,4)) q(ql,n);
insert into said select 'WAS|' || count(*) || '|' || sum(i.count) || '|'
  || round((sum(i.ql::numeric * i.count) / sum(i.count)), 4)
  from item i, who w where i.world_id = w.world_id and i.holder_uid = w.uid and i.def = 'cotton_seed';
insert into said select 'FOLDED|' || pack_fold(w.world_id, w.uid) from who w;
insert into said select 'NOW|' || count(*) || '|' || sum(i.count) || '|' || round(max(i.ql)::numeric, 4)
  from item i, who w where i.world_id = w.world_id and i.holder_uid = w.uid and i.def = 'cotton_seed';

-- 2. And a locked pile, which must stand apart however many times it is asked.
insert into item (world_id, holder, holder_uid, def, ql, count, locked)
select w.world_id, 'player', w.uid, 'cotton_seed', 99.0, 1, true from who w;
insert into said select 'LOCKED|' || pack_fold(w.world_id, w.uid) || '|' ||
  (select count(*) from item i where i.world_id = w.world_id and i.holder_uid = w.uid and i.def = 'cotton_seed')
  from who w;

-- 3. The rule itself, pair by pair, against the same pairs in TypeScript.
insert into said
select 'PAIR|' || q.i || '|' || case when stack_key(q.a) is not null and stack_key(q.a) = stack_key(q.b)
                                     then 'one' else 'two' end
from (values ${rows.map((r) => `(${r.i}, ${asRow({})}, ${asRow(r.diff)})`).join(',\n      ')}) q(i, a, b);

-- 4. Taking all from a crate, which is the loudest of the doors.
do $$
declare w record; v_c int; v_before int; v_after int;
begin
  select * into w from who;
  select coalesce(max(id), 0) + 1 into v_c from crate where world_id = w.world_id;
  insert into crate (world_id, id, kind, x, y, sx, sy)
    select w.world_id, v_c, kind, floor(p.x)::int, floor(p.y)::int, 0, 0
      from crate_def, player p where p.world_id = w.world_id and p.uid = w.uid limit 1;
  -- A worker's afternoon: five loads of the same thing, each its own row.
  insert into item (world_id, holder, holder_uid, crate, def, ql, count)
  select w.world_id, 'crate', null, v_c, 'peat', q.ql, 2 from (values (10.0),(20.0),(30.0),(40.0),(50.0)) q(ql);
  select count(*) into v_before from item i where i.world_id = w.world_id and i.holder_uid = w.uid and i.def = 'peat';
  update player set x = (select x from crate where world_id = w.world_id and id = v_c) + 0.5,
                    y = (select y from crate where world_id = w.world_id and id = v_c) + 0.5
    where world_id = w.world_id and uid = w.uid;
  perform perform_crate(w.world_id, w.uid, 'crate_take_all',
    jsonb_build_object('kind', 'crate', 'id', v_c));
  select count(*) into v_after from item i where i.world_id = w.world_id and i.holder_uid = w.uid and i.def = 'peat';
  insert into said values ('CRATE|' || v_before || '|' || v_after || '|' ||
    coalesce((select round(ql::numeric, 2) || '/' || count from item i
                where i.world_id = w.world_id and i.holder_uid = w.uid and i.def = 'peat' limit 1)::text, 'none'));
end $$;

-- 4b. And adding to a pile does not burn a row number doing it.
do $$
declare w record; a bigint; b bigint;
begin
  select * into w from who;
  perform give(w.world_id, w.uid, 'peat', 1, 10);
  a := (select last_value from item_id_seq);
  perform give(w.world_id, w.uid, 'peat', 1, 20);
  perform give(w.world_id, w.uid, 'peat', 1, 30);
  b := (select last_value from item_id_seq);
  insert into said values ('IDS|' || (b - a));
end $$;

-- 5. Ash, and 6. where a worker carrying it goes.
do $$
declare w record; d record; v_bin bigint; v_c int; v_who creature; r record;
begin
  select * into w from who;
  select dd.* into d from deed dd
   where dd.world_id = w.world_id
     and exists (select 1 from creature c where c.world_id = dd.world_id
                   and c.keeper = dd.founded_by and c.mode = 'deed')
   order by dd.founded_by limit 1;
  if d is null then insert into said values ('ASH|no deed'); return; end if;
  -- A bin at the far corner of the deed, and a crate right under the worker's feet.
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by)
  values (w.world_id, 'furniture', 'bulk_bin', d.x + d.radius - 1, d.y + d.radius - 1, 0, 0,
          d.x + d.radius - 1 + 0.5, d.y + d.radius - 1 + 0.5, d.founded_by)
  returning id into v_bin;
  insert into said select 'ASH|' || item_raw('ash') || '|'
    || coalesce(furniture_refuses(p, 'ash'), 'takes it') from placed p where p.id = v_bin;

  select coalesce(max(id), 0) + 1 into v_c from crate where world_id = w.world_id;
  insert into crate (world_id, id, kind, x, y, sx, sy, deed)
    select w.world_id, v_c, kind, d.x, d.y, 0, 0, false from crate_def limit 1;

  -- A worker of this deed's, standing on the crate.
  select * into v_who from creature c
   where c.world_id = w.world_id and c.keeper = d.founded_by and c.mode = 'deed' limit 1;
  if v_who.id is null then insert into said values ('BIN|no worker'); return; end if;
  update creature set from_x = d.x + 0.5, from_y = d.y + 0.5, to_x = d.x + 0.5, to_y = d.y + 0.5,
                      post = null, settled_at = now(), until = now()
    where world_id = w.world_id and id = v_who.id returning * into v_who;

  select * into r from worker_store(w.world_id, v_who, 'ash', 1);
  insert into said values ('BIN|' || coalesce(r.kind, 'nowhere') || '|'
    || case when r.kind = 'furniture' and r.id = v_bin then 'the bin' else 'something else' end);
  select * into r from worker_store(w.world_id, v_who, 'plank', 1);
  insert into said values ('MADE|' || coalesce(r.kind, 'nowhere'));
end $$;

select * from said;
rollback;
`);

const said = (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

const [wasRows, wasUnits, wasQl] = said('WAS').split('|');
const [nowRows, nowUnits, nowQl] = said('NOW').split('|');
check('the six piles from the screenshot become one', wasRows === '6' && nowRows === '1',
  `${wasRows} rows before, ${nowRows} after — ${said('FOLDED')} folded away`);
check('with not a seed gained or lost by it', wasUnits === nowUnits, `${wasUnits} seeds, then ${nowUnits}`);
check('and the pile is worth the average of what went into it', wasQl === nowQl,
  `${wasQl} weighted before, ${nowQl} on the pile`);

const [lockedFolded, lockedRows] = said('LOCKED').split('|');
check('a locked pile stands apart, and asking again does not wear it down',
  lockedFolded === '0' && lockedRows === '2', `${lockedFolded} folded, ${lockedRows} rows left`);

let agreed = 0;
const disagreed: string[] = [];
for (const [i, [what, diff, want]] of PAIRS.entries()) {
  const island = said(`PAIR|${i}`) === 'one';
  const browser = sameStack({ ...base, ...diff } as Item, { ...base } as Item)
    && sameStack({ ...base } as Item, { ...base, ...diff } as Item);
  if (island === browser && island === want) agreed += 1;
  else disagreed.push(`${what}: island ${island ? 'one' : 'two'}, browser ${browser ? 'one' : 'two'}, wanted ${want ? 'one' : 'two'}`);
}
check('both sides answer the same on every way two things can differ',
  disagreed.length === 0, disagreed.length ? disagreed.join('; ') : `${agreed} of ${PAIRS.length} pairs`);

const [crateBefore, crateAfter, crateWhat] = said('CRATE').split('|');
check('five loads out of a crate arrive as one pile, not five',
  crateBefore === '0' && crateAfter === '1', `${crateBefore} in the pack before, ${crateAfter} after — ${crateWhat}`);
check('at the average of the five and the whole of the count', crateWhat === '30.00/10', crateWhat);

check('and adding to a pile writes to it rather than writing a new row and deleting it',
  said('IDS') === '0', `${said('IDS')} row numbers burnt over two goes that both went on the pile`);

const [ashRaw, ashBin] = said('ASH').split('|');
check('ash is a raw material on the island', ashRaw === 'true', `item_raw('ash') = ${ashRaw}`);
check('and the browser says the same', itemDef('ash').raw === true, `${itemDef('ash').raw}`);
check('so a raw material bin will take it', ashBin === 'takes it', ashBin);

const [binKind, binWhich] = said('BIN').split('|');
check('a worker carrying something raw walks past the crate under its feet to the bin',
  binKind === 'furniture' && binWhich === 'the bin', `${binKind}, ${binWhich}`);
check('and a worker carrying something a bench has touched goes where it always went',
  said('MADE') === 'crate', said('MADE'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`one pile and not six — ${ok.length} of ${ok.length}`);
