/**
 * Money that buys something: a deal, a stall, and a parcel in the post.
 *
 * Coins have existed on this island since there was an anvil to strike them
 * on. They are struck twenty to a lump from silver or gold, they go in a
 * pocket, they melt back into the lump they came from — and they have never
 * once bought anything, because there has never been anything to buy them
 * with or anybody to buy from. A currency nobody can spend is a metal with a
 * picture on it.
 *
 * One number settles the money: a gold coin is worth ten silver, every price
 * is named in silver, and change comes back in silver. Deliberately not a
 * market — a rate that moved would want a market to move it, and there is no
 * market, there are people.
 *
 * Three ways goods change hands, and they are three because they answer three
 * different questions:
 *
 *   **A deal** is two people standing together. Not a live two-window
 *   negotiation with ready flags that either side can pull out of at the last
 *   moment, but an offer with its terms written down: these things and these
 *   coins for that many, aimed at one person, held out of the pack while it
 *   stands. Accepting executes exactly what was read, which is the property
 *   the ready-flag dance exists to fake.
 *
 *   **A stall** is for when you are not there. The only thing on this island
 *   that does anything for you while you are asleep.
 *
 *   **A parcel** is for when you are not there *and* neither are they. In at
 *   one mailbox and out at any other.
 *
 * Runs against the database the suite leaves behind.
 */
import { Game } from '../../src/game/game';
import { execFileSync } from 'node:child_process';
import { CHANGE_METAL, COIN_WORTH, pay, priceWords, purse, stackWorth } from '../../src/game/money';
import { FURNITURE_BY_ID } from '../../src/game/furniture';
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
const saidBy = (out: string) => (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

/* ---- what a coin is worth ------------------------------------------------- */

const coin = (metal: string, n: number, uid = n): Item =>
  ({ uid, id: 'coin', extra: metal, count: n, ql: 50, dmg: 0 } as Item);

check('a gold coin is worth ten silver, and nothing else is worth anything',
  COIN_WORTH.Gold === 10 * COIN_WORTH.Silver && stackWorth({ uid: 1, id: 'plank', count: 9, ql: 1, dmg: 0 } as Item) === 0,
  `gold ${COIN_WORTH.Gold}, silver ${COIN_WORTH.Silver}`);
check('and a purse is counted across every coin in it',
  purse([coin('Gold', 2, 1), coin('Silver', 5, 2)]) === 25, String(purse([coin('Gold', 2, 1), coin('Silver', 5, 2)])));
check('a price is said the way anybody would say it', priceWords(25) === '2 gold and 5 silver', priceWords(25));
check('and the small ones are said on their own', priceWords(7) === '7 silver' && priceWords(0) === 'nothing',
  `${priceWords(7)}, ${priceWords(0)}`);

/*
 * Largest coin first, which is what a person does and also what keeps a purse
 * usable: paying eleven out of a gold and five silver should leave you the
 * four silver rather than spending the five and breaking the gold.
 */
{
  const pack = [coin('Gold', 1, 1), coin('Silver', 5, 2)];
  const paid = pay(pack, 11);
  check('paying takes the largest coins first',
    !!paid && paid.take[0].uid === 1 && paid.take[0].count === 1,
    paid ? `${paid.take.length} stacks, the gold first` : 'could not pay');
  check('and gives change back rather than overpaying',
    !!paid && paid.change === 0 && paid.take.reduce((n, t) => n + t.count, 0) === 2,
    paid ? `change ${paid.change}` : '');
  const broken = pay([coin('Gold', 1, 1)], 3);
  check('a gold coin covers three silver and comes back as seven',
    !!broken && broken.change === 7, broken ? `change ${broken.change}` : 'could not pay');
  check('and a purse that cannot cover it pays nothing at all',
    pay([coin('Silver', 2, 1)], 5) === null, 'no part payment');
  check('while nothing owed is always payable',
    pay([], 0)?.take.length === 0, 'an empty bill');
}

/* ---- the two pieces that exist for other people --------------------------- */

const stall = FURNITURE_BY_ID.get('stall');
const box = FURNITURE_BY_ID.get('mailbox');
check('there is a stall to sell from and a mailbox to post at',
  !!stall?.stall && !!box?.post, `${stall?.name} and ${box?.name}`);
check('and both of them hold things, since neither is any use empty',
  (stall?.capacity ?? 0) > 0 && (box?.capacity ?? 0) > 0,
  `${stall?.capacity} and ${box?.capacity}`);
check('and the change metal is one a coin is actually struck from',
  COIN_WORTH[CHANGE_METAL] === 1, CHANGE_METAL);

/* A game played by yourself has no second person, and should say so plainly. */
{
  const g = Game.create(4242);
  check('the solo game knows what coins are worth without an island to ask',
    purse(g.inventory.items) === 0, 'an empty purse, which is what you wash ashore with');
}

/* ---- and the island, where all three of them actually happen -------------- */

const isle = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; a uuid; b uuid; ax double precision; ay double precision;
        v_item bigint; v_deal bigint; v_stall bigint; v_box bigint; v_goods bigint; r jsonb;
begin
  select id into w from world where name = 'Hoarding';
  select uid into a from player where world_id = w order by uid limit 1;
  select uid into b from player where world_id = w and uid <> a order by uid limit 1;
  select x, y into ax, ay from player where world_id = w and uid = a;
  -- Stand them together, because a deal is a handshake.
  update player set x = ax, y = ay where world_id = w and uid = b;
  delete from item where world_id = w and holder in ('player', 'post')
    and holder_uid in (a, b) and def in ('coin', 'plank', 'hatchet', 'shaft');

  -- A has a hatchet and no money; B has a gold coin.
  insert into item (world_id, holder, holder_uid, def, ql, count)
    values (w, 'player', a, 'hatchet', 60, 1) returning id into v_item;
  insert into item (world_id, holder, holder_uid, def, ql, count, extra)
    values (w, 'player', b, 'coin', 50, 2, 'Gold');
  insert into said select 'PURSE_A|' || purse(w, a)::text;
  insert into said select 'PURSE_B|' || purse(w, b)::text;

  -- A offers the hatchet for eight silver, which a gold coin covers with two
  -- to come back.
  insert into deal (world_id, seller, buyer, want) values (w, a, b, 8) returning n into v_deal;
  update item set deal = v_deal where world_id = w and id = v_item;
  -- What is offered is held out of the pack: it is not A's to spend meanwhile.
  insert into said select 'HELD|' || (select (deal = v_deal)::text from item where id = v_item);

  -- B takes it: twelve out of a gold, eight back in change.
  perform take_coins(w, b, 8);
  perform give_coins(w, a, 8);
  update item set holder_uid = b, deal = null where world_id = w and deal = v_deal;
  update deal set closed_at = now(), taken = true where world_id = w and n = v_deal;
  insert into said select 'AFTER_A|' || purse(w, a)::text;
  insert into said select 'AFTER_B|' || purse(w, b)::text;
  insert into said select 'HATCHET|' || (select (holder_uid = b)::text from item where id = v_item);
  -- Change comes back in the fewest coins, which is how anybody counts money.
  insert into said select 'CHANGE|' || (select string_agg(extra || ':' || count, ',' order by extra)
    from item where world_id = w and holder_uid = b and def = 'coin');

  -- A stall of A's, as a builder leaves one, with a plank on it at five silver.
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by)
    values (w, 'furniture', 'stall', floor(ax)::int, floor(ay)::int, 0, 0,
            floor(ax)::int + 0.5, floor(ay)::int + 0.5, a) returning id into v_stall;
  insert into item (world_id, holder, holder_uid, def, ql, count, placed, price)
    values (w, 'furniture', a, 'plank', 30, 1, v_stall, 5) returning id into v_goods;
  perform take_coins(w, b, 5);
  update placed set till = till + 5 where world_id = w and id = v_stall;
  update item set holder = 'player', holder_uid = b, placed = null, price = null
    where world_id = w and id = v_goods;
  insert into said select 'TILL|' || (select till::text from placed where world_id = w and id = v_stall);
  insert into said select 'SOLD|' || (select (holder_uid = b and price is null)::text
    from item where world_id = w and id = v_goods);
  -- And the takings, which wait until A next comes by.
  perform give_coins(w, a, (select till from placed where world_id = w and id = v_stall));
  update placed set till = 0 where world_id = w and id = v_stall;
  insert into said select 'TOOK|' || purse(w, a)::text;

  -- A mailbox, as a builder leaves one, and a parcel through it.
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by)
    values (w, 'furniture', 'mailbox', floor(ax)::int, floor(ay)::int, 1, 1,
            floor(ax)::int + 0.5, floor(ay)::int + 0.5, a) returning id into v_box;
  insert into said select 'ATBOX|' || ((mailbox_at(w, a)).id is not null)::text;
  -- Shafts, because B already holds a plank bought off the stall and a count
  -- that could mean either is a count that measures nothing.
  insert into item (world_id, holder, holder_uid, def, ql, count)
    values (w, 'player', a, 'shaft', 30, 4) returning id into v_goods;
  update item set holder = 'post', holder_uid = b where world_id = w and id = v_goods;
  insert into said select 'POSTED|' || (select coalesce(sum(count), 0)::text from item
    where world_id = w and holder = 'post' and holder_uid = b);
  -- Nothing in the post is in anybody's pack until it is collected.
  insert into said select 'NOTYET|' || (select coalesce(sum(count), 0)::text from item
    where world_id = w and holder = 'player' and holder_uid = b and def = 'shaft');
  update item set holder = 'player', letter = null
    where world_id = w and holder = 'post' and holder_uid = b;
  insert into said select 'COLLECTED|' || (select coalesce(sum(count), 0)::text from item
    where world_id = w and holder = 'player' and holder_uid = b and def = 'shaft');
  insert into said select 'EMPTIED|' || (select count(*)::text from item
    where world_id = w and holder = 'post' and holder_uid = b);
  -- And a body nowhere near a box is not at one.
  update player set x = ax + 60, y = ay + 60 where world_id = w and uid = b;
  insert into said select 'AWAY|' || ((mailbox_at(w, b)).id is not null)::text;
end $$;
select k from said;
rollback;
`);
const said = saidBy(isle);

check('the island counts gold as ten silver apiece too',
  said('PURSE_B') === '20' && said('PURSE_A') === '0', `${said('PURSE_A')} and ${said('PURSE_B')}`);
check('what is offered in a deal is held out of the pack while it stands',
  said('HELD') === 'true', said('HELD'));
check('taking a deal moves the goods one way and the coins the other',
  said('HATCHET') === 'true' && said('AFTER_A') === '8' && said('AFTER_B') === '12',
  `seller ${said('AFTER_A')}, buyer ${said('AFTER_B')}, hatchet moved ${said('HATCHET')}`);
check('and the change comes back in the fewest coins it can',
  said('CHANGE') === 'Gold:1,Silver:2', `${said('CHANGE')} — a gold went in and two silver came back`);
check('a stall takes the money into its till rather than into an absent pocket',
  said('TILL') === '5' && said('SOLD') === 'true', `till ${said('TILL')}, sold ${said('SOLD')}`);
check('and the takings wait there until whoever set it up comes by',
  said('TOOK') === '13', `${said('TOOK')} silver: eight for the hatchet and five for the plank`);
check('a body standing at a mailbox is at one, and one sixty tiles off is not',
  said('ATBOX') === 'true' && said('AWAY') === 'false', `${said('ATBOX')} and ${said('AWAY')}`);
check('a parcel waits in the post rather than in anybody’s pack',
  said('POSTED') === '4' && said('NOTYET') === '0', `${said('POSTED')} waiting, ${said('NOTYET')} carried`);
check('and comes out whole when it is collected, leaving the post empty',
  said('COLLECTED') === '4' && said('EMPTIED') === '0',
  `${said('COLLECTED')} collected, ${said('EMPTIED')} left behind`);

/* ---- and the doors are all there ------------------------------------------ */

const doors = psql(`select string_agg(p.proname, ',' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in
   ('rpc_deal','rpc_deals','rpc_deal_answer','rpc_price','rpc_buy','rpc_takings',
    'rpc_parcel','rpc_parcels','rpc_collect');`);
check('every door the browser will knock on is open',
  doors.split(',').filter(Boolean).length === 9, doors);

const grants = psql(`select count(*)::text from information_schema.routine_privileges
  where grantee = 'authenticated' and routine_name in
    ('rpc_deal','rpc_deals','rpc_deal_answer','rpc_price','rpc_buy','rpc_takings',
     'rpc_parcel','rpc_parcels','rpc_collect');`);
check('and every one of them is one a signed-in body may knock on',
  grants === '9', `${grants} of 9 granted`);

/*
 * And the ones that move money are not. `take_coins` and `give_coins` mint and
 * destroy coins: a door onto either of them would be a door onto making money,
 * so they are for the island's own use and `lock_doors` keeps them that way.
 */
const inner = psql(`select count(*)::text from information_schema.routine_privileges
  where grantee = 'authenticated' and routine_name in ('take_coins', 'give_coins');`);
check('while the two that mint and destroy coins are the island’s alone',
  inner === '0', `${inner} granted, which must be none`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`coins buy something, three ways — ${ok.length} of ${ok.length}`);
