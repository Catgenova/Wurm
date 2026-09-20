/**
 * A worker that can reach the larder.
 *
 * `worker_feed` looked in crates and nowhere else, so a wildermon could stand
 * beside a larder holding a hundred and fifty of exactly what it eats and
 * starve. The browser never had that fault -- `foodCrate` walks every store on
 * the deed -- so this is the island catching up, and the set is defined the
 * same way on both sides: it holds things, and it is not the trash crate.
 *
 * Widening where a worker may look is also the moment to say what it may not
 * take, so this asks about all of it:
 *
 *   * it eats out of a larder when no crate has anything;
 *   * it still eats out of a crate, the plainest thing first;
 *   * it will not touch a locked stack, stock with a price on it, post, or
 *     goods under a deal -- none of which were checked before;
 *   * a trash crate is not a larder;
 *   * and the two sides agree on which pieces of furniture count.
 *
 * Runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';
import { FURNITURE, furnitureDef } from '../../src/game/furniture';
import { mayEat, SPECIES } from '../../src/game/creatures';
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

const out = psql(`
begin;
create temp table said (k text);
do $$
declare d record; c record; v_larder bigint; v_crate int; v_food text; v_ate text; v_left int;
begin
  select dd.* into d from deed dd
   where exists (select 1 from creature cr where cr.world_id = dd.world_id
                   and cr.keeper = dd.founded_by and cr.mode = 'deed')
   order by dd.founded_by limit 1;
  if d is null then insert into said values ('WHO|no deed with a worker on it'); return; end if;
  select * into c from creature cr where cr.world_id = d.world_id and cr.keeper = d.founded_by
     and cr.mode = 'deed' limit 1;
  select sd.item into v_food from species_diet sd where sd.species = c.species limit 1;
  insert into said values ('WHO|' || c.species || '|' || v_food);

  -- Nothing in any crate on the deed, and a larder with three of what it eats.
  delete from item i where i.world_id = d.world_id and i.holder = 'crate';
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by)
    values (d.world_id, 'furniture', 'larder', d.x, d.y, 0, 0, d.x + 0.5, d.y + 0.5, d.founded_by)
    returning id into v_larder;
  insert into item (world_id, holder, placed, def, ql, count)
    values (d.world_id, 'furniture', v_larder, v_food, 30, 3);
  update creature set hunger = 0.1, from_x = d.x + 0.5, from_y = d.y + 0.5,
                      to_x = d.x + 0.5, to_y = d.y + 0.5, settled_at = now()
    where world_id = d.world_id and id = c.id;

  v_ate := worker_feed(d.world_id, c.id);
  select coalesce(sum(count), 0) into v_left from item where placed = v_larder;
  insert into said values ('LARDER|' || coalesce(v_ate, 'nothing') || '|' || v_left || '|'
    || (select round(hunger::numeric, 2) from creature where world_id = d.world_id and id = c.id));

  -- Locked is not lunch.
  update item set locked = true where placed = v_larder;
  update creature set hunger = 0.1 where world_id = d.world_id and id = c.id;
  insert into said values ('LOCKED|' || coalesce(worker_feed(d.world_id, c.id), 'nothing'));
  -- Nor is stock on a stall, nor post, nor goods under a deal.
  update item set locked = false, price = 10 where placed = v_larder;
  insert into said values ('PRICED|' || coalesce(worker_feed(d.world_id, c.id), 'nothing'));
  update item set price = null, letter = 1 where placed = v_larder;
  insert into said values ('POSTED|' || coalesce(worker_feed(d.world_id, c.id), 'nothing'));
  update item set letter = null, deal = 1 where placed = v_larder;
  insert into said values ('DEALT|' || coalesce(worker_feed(d.world_id, c.id), 'nothing'));
  update item set deal = null where placed = v_larder;

  -- A trash crate is not a larder.
  update placed set sub = 'trash_crate' where id = v_larder;
  insert into said values ('TRASH|' || coalesce(worker_feed(d.world_id, c.id), 'nothing'));
  update placed set sub = 'larder' where id = v_larder;

  -- And a crate still works, the plainest thing in it first.
  delete from item where placed = v_larder;
  select coalesce(max(id), 0) + 1 into v_crate from crate where world_id = d.world_id;
  insert into crate (world_id, id, kind, x, y, sx, sy)
    select d.world_id, v_crate, kind, d.x, d.y, 0, 0 from crate_def limit 1;
  insert into item (world_id, holder, crate, def, ql, count)
    values (d.world_id, 'crate', v_crate, v_food, 70, 1), (d.world_id, 'crate', v_crate, v_food, 12, 1);
  update creature set hunger = 0.1 where world_id = d.world_id and id = c.id;
  v_ate := worker_feed(d.world_id, c.id);
  insert into said values ('CRATE|' || coalesce(v_ate, 'nothing') || '|'
    || coalesce((select string_agg(round(ql::numeric, 0)::text, ',' order by ql)
                   from item where crate = v_crate and world_id = d.world_id), 'none'));
end $$;

-- Which pieces of furniture the island counts as somewhere to look.
insert into said select 'HOLDS|' || coalesce(string_agg(id, ',' order by id), 'none')
  from furniture_def where coalesce(capacity, 0) > 0 and coalesce(trash, 0) = 0;
select * from said;
rollback;
`);

const said = (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

const [species, food] = said('WHO').split('|');
check('there is a worker on a deed to feed', species !== 'MISSING' && !!food, said('WHO'));

const [ate, left, hunger] = said('LARDER').split('|');
check('with every crate empty, it helps itself to the larder',
  ate === food && left === '2', `ate ${ate}, ${left} left of three`);
check('and it is less hungry for it', Number(hunger) > 0.1, `hunger ${hunger}`);

check('a locked stack is not lunch, however hungry it is', said('LOCKED') === 'nothing', said('LOCKED'));
check('nor is stock with a price on it', said('PRICED') === 'nothing', said('PRICED'));
check('nor is somebody’s post', said('POSTED') === 'nothing', said('POSTED'));
check('nor goods promised under a deal', said('DEALT') === 'nothing', said('DEALT'));
check('and a trash crate is not a larder', said('TRASH') === 'nothing', said('TRASH'));

const [crateAte, crateLeft] = said('CRATE').split('|');
check('a crate still feeds it, and the plainest thing in it goes first',
  crateAte === food && crateLeft === '70', `ate ${crateAte}, leaving QL ${crateLeft}`);

/*
 * And the set itself, against the browser's. `deedStores` keeps a piece of
 * furniture when it has capacity and is not the trash crate, which is the
 * same two words the island's query uses; a difference here is a larder a
 * worker can reach on one side and not the other.
 */
const islandHolds = said('HOLDS').split(',').sort();
const browserHolds = FURNITURE.filter((f) => furnitureDef(f.id).capacity && !furnitureDef(f.id).trash)
  .map((f) => f.id).sort();
check('both sides count the same pieces of furniture as somewhere to look',
  islandHolds.join() === browserHolds.join(),
  islandHolds.join() === browserHolds.join() ? `${islandHolds.length} of them`
    : `island ${islandHolds.join()} / browser ${browserHolds.join()}`);
check('and a larder is among them', islandHolds.includes('larder'), islandHolds.join());

/* The browser's half of what may be taken, on the two it can express. */
const beast = SPECIES[species];
if (beast) {
  const plain = { uid: 1, id: food, ql: 30, dmg: 0, count: 1 } as Item;
  check('the browser agrees on what a worker may help itself to',
    mayEat(beast, plain)
      && !mayEat(beast, { ...plain, locked: true } as Item)
      && !mayEat(beast, { ...plain, price: 10 } as Item)
      && !mayEat(beast, { ...plain, id: 'iron_lump' } as Item),
    `${food} yes, locked no, priced no, iron no`);
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a worker that can reach the larder — ${ok.length} of ${ok.length}`);
