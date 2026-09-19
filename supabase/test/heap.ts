/**
 * Dirt goes down as a heap, and comes back up.
 *
 * The island had one thing to say about a spadeful in the pack — *Dirt goes
 * back in a hole, not on the grass* — and it made a trap. Dirt is twenty
 * kilos; three of them is most of what a body can carry; and the one door out
 * of the pack was the terraforming drop, which refuses ground under a
 * building, ground steeper than the digging skill will hold, and ground that
 * belongs to somebody else. On a stranger's deed, overburdened, there was no
 * door at all — while the crawl's own message said *you can still work what
 * is beside you, or put something down*.
 *
 * So both sides are asked here: the browser offers the plain drop on a
 * spadeful and still offers the raising one beside it, and the island lets the
 * heap land on the tile and be picked up again. What the change did not touch
 * is asked too — a thing set aside is still not droppable, which is the rule
 * that sat on the line below.
 *
 * Runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID } from '../../src/game/actions';
import { Game } from '../../src/game/game';

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

/* ---- the browser's menu --------------------------------------------------- */

const game = Game.create(4242);
const dirt = game.inventory.add('dirt', { count: 3 });
const plain = ACTION_BY_ID.get('drop')!;
const raising = ACTION_BY_ID.get('drop_dirt_here')!;
const target = { kind: 'item', uid: dirt.uid } as never;

check('the plain drop offers itself on a spadeful of dirt', plain.applies(target, game));
check('and the raising one is still there beside it, so the player picks',
  raising.applies(target, game));
const offered = game.actionsFor(target).map((a) => a.def.id);
check('both are in the menu the player actually sees',
  offered.includes('drop') && offered.includes('drop_dirt_here'), offered.join(', '));

const [fx, fy] = [game.player.tileX, game.player.tileY];
const before = game.groundAt(fx, fy).length;
plain.perform({ kind: 'item', uid: dirt.uid, count: 2 } as never, game);
const heap = game.groundAt(fx, fy).find((it) => it.id === 'dirt');
check('two of the three land at your feet as a heap',
  !!heap && heap.count === 2, `${game.groundAt(fx, fy).length - before} new pile(s), ${heap?.count ?? 0} dirt`);
check('and the third stays in the pack',
  game.inventory.items.filter((it) => it.id === 'dirt').reduce((n, it) => n + it.count, 0) === 1);

/* A thing set aside is still not droppable: the rule below the one removed. */
const spade = game.inventory.add('shovel', { ql: 40 });
spade.locked = true;
check('a thing set aside is still refused, dirt or not',
  !plain.applies({ kind: 'item', uid: spade.uid } as never, game));

/* ---- and the island ------------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid; v_dirt bigint; v_lock bigint; p player;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  delete from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = 'dirt';
  select * into p from player where world_id = w and uid = u;
  delete from item i where i.world_id = w and i.holder = 'ground'
    and i.gx = floor(p.x)::int and i.gy = floor(p.y)::int;

  insert into item (world_id, holder, holder_uid, def, ql, count)
    values (w, 'player', u, 'dirt', 10, 3) returning id into v_dirt;
  insert into item (world_id, holder, holder_uid, def, ql, count, locked)
    values (w, 'player', u, 'shovel', 40, 1, true) returning id into v_lock;

  insert into said values ('DIRT|' || coalesce(
    hands_refusal(w, u, 'drop', jsonb_build_object('uid', v_dirt)), 'ALLOWED'));
  insert into said values ('LOCKED|' || coalesce(
    hands_refusal(w, u, 'drop', jsonb_build_object('uid', v_lock)), 'ALLOWED'));

  -- two of the three down, one kept back, exactly as the browser did it
  perform perform_hands(w, u, 'drop', jsonb_build_object('uid', v_dirt, 'count', 2));
  insert into said values ('HEAP|' || coalesce((select count || ' at ' || gx || ',' || gy
    from item where world_id = w and holder = 'ground' and def = 'dirt'
      and gx = floor(p.x)::int and gy = floor(p.y)::int), 'NOTHING'));
  insert into said values ('KEPT|' || coalesce((select sum(count)::text from item
    where world_id = w and holder = 'player' and holder_uid = u and def = 'dirt'), '0'));

  -- and up again
  perform perform_hands(w, u, 'pick_up', jsonb_build_object(
    'x', floor(p.x)::int, 'y', floor(p.y)::int));
  insert into said values ('BACK|' || coalesce((select sum(count)::text from item
    where world_id = w and holder = 'player' and holder_uid = u and def = 'dirt'), '0'));
  insert into said values ('LEFT|' || (select count(*) from item
    where world_id = w and holder = 'ground' and def = 'dirt'
      and gx = floor(p.x)::int and gy = floor(p.y)::int));
end $$;
select * from said;
rollback;
`);
const said = (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

check('the island no longer refuses a spadeful at the door', said('DIRT') === 'ALLOWED', said('DIRT'));
check('and still refuses a thing set aside',
  said('LOCKED').startsWith('You have set that aside'), said('LOCKED'));
check('two of the three land on the tile under the body', said('HEAP').startsWith('2 at '), said('HEAP'));
check('and the third is still in the pack', said('KEPT') === '1', said('KEPT'));
check('picking the heap up again brings all three back', said('BACK') === '3', said('BACK'));
check('leaving the ground clean', said('LEFT') === '0', said('LEFT'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a spadeful can be put down and picked up again — ${ok.length} of ${ok.length}`);
