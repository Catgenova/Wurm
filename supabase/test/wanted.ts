/**
 * Buy orders on the board.
 *
 * Asked for: buy orders on the market board. Put one up at a settlement token
 * or a mailbox -- a kind of thing, the least quality if it matters, how many
 * and the price each, the whole price held; the board lists it; anybody else
 * fills it out of their pack, all or part, is paid at once, and the goods go
 * to the one who wanted them by the post; taken back for what it still holds,
 * and lapsing by itself after a week.
 *
 * The browser half: how long an order stands, against the island's own
 * number; what one asks for, in the same words as the island's; what in a
 * pack would go to one, which is what the Fill box offers; the line a count of
 * what was brought turns into; and the help saying all of it.
 *
 * The island half, through the doors, on the suite's Hoarding with Dane and
 * people new to it:
 *
 *   * nobody puts an order up away from a token or a mailbox, for coins, for
 *     a thing there is not, or for more than they carry; one put up takes the
 *     whole price out of the purse, change and all;
 *   * the board lists it, with who and where, to somebody at a mailbox and to
 *     nobody away from one -- and to its owner wherever they are;
 *   * nobody fills their own, nor more than it wants, nor with the wrong
 *     kind, the wrong quality, what is locked, what is worn, or a bag with
 *     something in it; what does fill it goes poorest first, out of a stack
 *     as far as is wanted, in the post from whoever brought it, and is paid
 *     for there and then;
 *   * the owner is told, and while they are away it is counted for them and
 *     handed over when they come back;
 *   * taken back for what it still holds, by its owner and nobody else, and
 *     lapsed by itself when the board is read or it is touched after a week;
 *   * the coins in it come to the same whatever happens to it;
 *   * the table is nobody's to read or write but the doors';
 *   * and two people filling the same order at the same moment are one after
 *     the other: the second waits for the first and is told what is left.
 *
 * Runs against the database the suite leaves behind: most of it in a
 * transaction that is rolled back, and the race -- which wants two sessions
 * to see the same order -- committed and tidied away after.
 */
import { execFileSync, spawn } from 'node:child_process';
import { AWAY_NAMED, awayLines, type Away } from '../../src/game/away';
import type { Item } from '../../src/game/items';
import { priceWords } from '../../src/game/money';
import { couldBring, fitsOrder, ORDER_LIFE, orderWords } from '../../src/game/orders';
import { spanWords } from '../../src/game/words';
import { helpText } from '../../src/ui/panels/help';
import type { Order } from '../../src/net/island';

const ENV = {
  ...process.env,
  PGHOST: process.env.PGHOST ?? '/var/run/postgresql',
  PGPORT: process.env.PGPORT ?? '5433',
  PGUSER: process.env.PGUSER ?? 'wurm',
  PGDATABASE: process.env.PGDATABASE ?? 'postgres',
};
const ARGS = ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'];
const psql = (sql: string): string => execFileSync('psql', ARGS, { input: sql, encoding: 'utf8', env: ENV }).trim();
/** The same, in a session of its own that runs alongside others. */
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

/* ---- the browser ------------------------------------------------------------ */
console.log('--- the browser');
check('an order stands a week', ORDER_LIFE === 7 * 24 * 3600 && spanWords(ORDER_LIFE) === 'seven days', spanWords(ORDER_LIFE));
check('and the island lets one stand exactly as long', psql('select order_life()::bigint;') === String(ORDER_LIFE),
  psql('select order_life();'));
check('what one asks for, in words', orderWords('iron_ore', 15, 30) === '15 × iron ore of quality 30 or better'
  && orderWords('pickaxe', 1, 0) === '1 × pickaxe', `${orderWords('iron_ore', 15, 30)} | ${orderWords('pickaxe', 1, 0)}`);
const islandWords = psql(`select order_words('iron_ore', 15, 30) || '|' || order_words('pickaxe', 1, 0);`);
check('and the island says it in the same words', islandWords === `${orderWords('iron_ore', 15, 30)}|${orderWords('pickaxe', 1, 0)}`,
  islandWords);

const thing = (uid: number, id: string, ql: number, count = 1, more: Partial<Item> = {}): Item => ({ uid, id, ql, dmg: 0, count, ...more });
const pack: Item[] = [
  thing(1, 'iron_ore', 40, 10),
  thing(2, 'iron_ore', 20, 5),
  thing(3, 'iron_ore', 80, 2, { locked: true }),
  thing(4, 'copper_ore', 60, 7),
  thing(5, 'pickaxe', 90),
  thing(6, 'pickaxe', 35),
  thing(7, 'satchel', 30, 1, { inside: [thing(70, 'rope', 30)] }),
  thing(8, 'satchel', 30),
  thing(9, 'creature_crate', 30, 1, { creature: 12 }),
  thing(10, 'creature_crate', 30),
];
const worn = (uid: number): boolean => uid === 5;
check('a pack brings what is of the kind and good enough, and nothing locked',
  couldBring(pack, { def: 'iron_ore', ql: 30 }, worn) === 10, String(couldBring(pack, { def: 'iron_ore', ql: 30 }, worn)));
check('any quality takes the poor stack too', couldBring(pack, { def: 'iron_ore', ql: 0 }, worn) === 15);
check('nothing worn or in the hand', couldBring(pack, { def: 'pickaxe', ql: 0 }, worn) === 1
  && !fitsOrder(pack[4], { def: 'pickaxe', ql: 0 }, true));
check('no bag with something in it, and no crate with a wildermon in it',
  couldBring(pack, { def: 'satchel', ql: 0 }, worn) === 1 && couldBring(pack, { def: 'creature_crate', ql: 0 }, worn) === 1);

const away: Away = { secs: 7200, tally: [
  { what: 'bought', def: 'iron_ore', n: 15, silver: 45 },
  { what: 'bought', def: 'pickaxe', n: 2, silver: 8 },
] };
const boughtLine = awayLines(away)[1];
check('what was brought to your orders while you were away, summed into one price',
  boughtLine === `Brought to your buy orders: 15 × iron ore and 2 × pickaxe, paid for with ${priceWords(53)} of what they held. `
    + 'It waits for you at any mailbox.', boughtLine);
check(`and it names ${AWAY_NAMED} sorts like every other line`, awayLines({ secs: 60, tally: Array.from({ length: AWAY_NAMED + 2 },
  (_, i) => ({ what: 'bought' as const, def: `thing${i}`, n: 1, silver: 1 })) })[1].includes('2 more sorts'));
const help = helpText().replace(/\s+/g, ' ');
check('the help says what an order does and how long one stands, and that it is counted while you are away',
  help.includes('<b>A buy order</b> is for what nobody has put out.')
    && help.includes(`one left open for <b>${spanWords(ORDER_LIFE)}</b> lapses`)
    && help.includes('everything brought to your buy orders and the silver it cost'));

/* ---- the island ------------------------------------------------------------- */
console.log('--- the island');
const CATO = 'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1';
const EDDA = 'd2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2';
const isle = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; dane uuid; ax double precision; ay double precision; ox double precision; tx int; ty int;
        cato uuid := '${CATO}'; edda uuid := '${EDDA}';
        v_got jsonb; v_ore bigint; v_pick bigint; v_bag bigint; v_order jsonb;
        a bigint; b bigint; c bigint; e bigint; f bigint; v_worn bigint; v_poor bigint; v_fine bigint; v_full bigint;
        v_empty bigint; v_before numeric; v_after numeric; v_join jsonb;
begin
  select id into w from world where name = 'Hoarding';
  select uid, x, y into dane, ax, ay from player where world_id = w and name = 'Dane';
  tx := floor(ax)::int; ty := floor(ay)::int;
  -- Twenty tiles off, towards the middle: Hoarding is sixty-four across, and
  -- whatever ran before may have left Dane anywhere on it.
  ox := case when ax < (select size from world where id = w) / 2 then ax + 20 else ax - 20 end;
  update player set act = null, act_queue = '[]'::jsonb, away = false where world_id = w and uid = dane;
  delete from away_tally where world_id = w and uid = dane;
  -- A purse of three gold and nothing else, so what comes back as change can be counted.
  delete from item where world_id = w and holder = 'player' and holder_uid = dane and def = 'coin';
  perform give_coins(w, dane, 30);
  insert into player (world_id, uid, name, x, y) values (w, cato, 'Cato', ax, ay), (w, edda, 'Edda', ax, ay);

  perform set_config('request.jwt.claims', json_build_object('sub', dane)::text, true);
  insert into said values ('DANE', folk_name(w, dane));
  insert into said values ('TILE', tx || ',' || ty);
  update player set x = ox where world_id = w and uid = dane;
  insert into said values ('NOBOARD', rpc_order(w, 'iron_ore', 5, 3, 30)->>'why');
  update player set x = ax where world_id = w and uid = dane;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by)
    values (w, 'furniture', 'mailbox', tx, ty, 2, 2, tx + 0.75, ty + 0.75, dane);
  insert into said values ('COIN', rpc_order(w, 'coin', 5, 3, 0)->>'why');
  insert into said values ('NOSUCH', rpc_order(w, 'no_such_thing', 5, 3, 0)->>'why');
  insert into said values ('ZERO', (rpc_order(w, 'iron_ore', 0, 3, 0)->>'why') || '|' || (rpc_order(w, 'iron_ore', 5, 0, 0)->>'why'));
  v_got := rpc_order(w, 'iron_ore', 100, 3, 30);
  insert into said values ('BROKE', (v_got->>'why') || '|' || purse(w, dane));

  -- Two orders up: five iron ore at three each, and two pickaxes at four.
  v_order := rpc_order(w, 'iron_ore', 5, 3, 30);
  a := (v_order->>'order')::bigint;
  insert into said values ('POSTED', coalesce(v_order->>'why', 'up') || '|' || (v_order->>'held'));
  insert into said values ('CHANGE', (select string_agg(extra || ' ' || count, ', ' order by extra) from item
    where world_id = w and holder = 'player' and holder_uid = dane and def = 'coin'));
  insert into said values ('TOLD', (select text from event where world_id = w and uid = dane order by n desc limit 1));
  b := (rpc_order(w, 'pickaxe', 2, 4, 30)->>'order')::bigint;
  insert into said values ('PURSE', purse(w, dane) || '|' || (select string_agg(extra || ' ' || count, ', ' order by extra) from item
    where world_id = w and holder = 'player' and holder_uid = dane and def = 'coin'));
  insert into said values ('OWN', rpc_order_fill(w, a, 1)->>'why');

  -- The board, to somebody at the mailbox, to somebody away from it, and to its owner wherever he is.
  perform set_config('request.jwt.claims', json_build_object('sub', cato)::text, true);
  v_got := rpc_orders(w);
  insert into said values ('BOARD', (v_got->>'board') || '|' || jsonb_array_length(v_got->'orders') || '|'
    || (select o->>'def' || ',' || (o->>'want') || ',' || (o->>'got') || ',' || (o->>'price') || ',' || (o->>'ql') || ','
          || (o->>'who' = folk_name(w, dane)) || ',' || (o->>'mine') || ',' || (o->>'x') || ',' || (o->>'y') || ','
          || ((o->>'left')::bigint between order_life() - 60 and order_life())
        from jsonb_array_elements(v_got->'orders') o where (o->>'n')::bigint = a));
  insert into said values ('KEYS', (select string_agg(k, ',' order by k)
    from jsonb_array_elements(v_got->'orders') o, jsonb_object_keys(o) k where (o->>'n')::bigint = a));
  update player set x = ox where world_id = w and uid = cato;
  v_got := rpc_orders(w);
  insert into said values ('AWAY', (v_got->>'board') || '|' || jsonb_array_length(v_got->'orders')
    || '|' || coalesce(rpc_order_fill(w, a, 1)->>'why', 'filled'));
  update player set x = ax where world_id = w and uid = cato;
  perform set_config('request.jwt.claims', json_build_object('sub', dane)::text, true);
  update player set x = ox where world_id = w and uid = dane;
  v_got := rpc_orders(w);
  insert into said values ('MINE', (v_got->>'board') || '|' || (select string_agg(o->>'mine', ',') from jsonb_array_elements(v_got->'orders') o));
  update player set x = ax where world_id = w and uid = dane;

  -- Nothing Cato has will do: too poor, the wrong ore, and a good stack he has put by.
  perform set_config('request.jwt.claims', json_build_object('sub', cato)::text, true);
  v_ore := give(w, cato, 'iron_ore', 4, 20);
  perform give(w, cato, 'copper_ore', 3, 60);
  insert into item (world_id, holder, holder_uid, def, ql, count, locked)
    values (w, 'player', cato, 'iron_ore', 80, 2, true);
  v_got := rpc_order_fill(w, a, 1);
  insert into said values ('NONE', (v_got->>'why') || '|'
    || (select count(*) from item where world_id = w and holder = 'post' and holder_uid = dane));
  insert into said values ('MORE', rpc_order_fill(w, a, 6)->>'why');

  -- Better ore comes in: a stack of ten, good enough. Three go, out of the stack, and seven stay.
  update item set ql = 45, count = 10 where id = v_ore;
  v_before := purse(w, dane) + purse(w, cato) + purse(w, edda)
    + (select coalesce(sum((want - got) * price), 0) from buy_order where world_id = w and closed_at is null and poster = dane);
  v_got := rpc_order_fill(w, a, 3);
  insert into said values ('FILL', coalesce(v_got->>'why', 'filled') || '|' || (v_got->>'paid') || '|' || (v_got->>'left'));
  insert into said values ('STACK', (select count || ' at ' || ql from item where id = v_ore) || '|'
    || (select string_agg(i.count || ' ' || i.def || ' at ' || i.ql || ' from ' || l.sender::text, ', ')
          from item i join letter l on l.world_id = i.world_id and l.n = i.letter
         where i.world_id = w and i.holder = 'post' and i.holder_uid = dane));
  insert into said values ('PAID', purse(w, cato)::text);
  insert into said values ('HALF', (select got || ' of ' || want || ',' || (closed_at is null) from buy_order where n = a));
  insert into said values ('HEARD', (select text from event where world_id = w and uid = dane order by n desc limit 1));
  insert into said values ('SAID', (select text from event where world_id = w and uid = cato order by n desc limit 1));

  -- Pickaxes: one too poor, one fine, one fine but in his hand -- only the fine one in his pack goes.
  insert into item (world_id, holder, holder_uid, def, ql) values (w, 'player', cato, 'pickaxe', 25) returning id into v_poor;
  insert into item (world_id, holder, holder_uid, def, ql) values (w, 'player', cato, 'pickaxe', 70) returning id into v_fine;
  insert into item (world_id, holder, holder_uid, def, ql) values (w, 'player', cato, 'pickaxe', 90) returning id into v_worn;
  update player set equipped = jsonb_build_object('weapon', v_worn) where world_id = w and uid = cato;
  v_order := rpc_order_fill(w, b, 2);
  v_got := rpc_order_fill(w, b, 1);
  insert into said values ('WORN', (v_order->>'why') || '|' || coalesce(v_got->>'why', 'filled')
    || '|' || (select holder from item where id = v_fine) || ',' || (select holder from item where id = v_worn)
    || ',' || (select holder from item where id = v_poor));
  -- And the poorest that will do goes first: Edda's thirty-one before her eighty.
  perform set_config('request.jwt.claims', json_build_object('sub', edda)::text, true);
  insert into item (world_id, holder, holder_uid, def, ql) values (w, 'player', edda, 'pickaxe', 80) returning id into v_full;
  insert into item (world_id, holder, holder_uid, def, ql) values (w, 'player', edda, 'pickaxe', 31) returning id into v_pick;
  v_got := rpc_order_fill(w, b, 1);
  insert into said values ('POOREST', coalesce(v_got->>'why', 'filled') || '|' || (select holder from item where id = v_pick)
    || ',' || (select holder from item where id = v_full) || '|' || (select closed from buy_order where n = b));
  -- Filled, it is off the board.
  v_got := rpc_order_fill(w, b, 1);
  v_order := rpc_orders(w);
  insert into said values ('GONE', coalesce(v_got->>'why', 'filled') || '|'
    || (select count(*) from jsonb_array_elements(v_order->'orders') o where (o->>'n')::bigint = b));

  -- A satchel, wanted: Edda's with a rope in it does not go, an empty one does.
  perform set_config('request.jwt.claims', json_build_object('sub', dane)::text, true);
  c := (rpc_order(w, 'satchel', 1, 1, 0)->>'order')::bigint;
  perform set_config('request.jwt.claims', json_build_object('sub', edda)::text, true);
  insert into item (world_id, holder, holder_uid, def, ql) values (w, 'player', edda, 'satchel', 30) returning id into v_bag;
  insert into item (world_id, holder, holder_uid, inside, def, ql) values (w, 'bag', edda, v_bag, 'rope', 30);
  insert into said values ('FULLBAG', rpc_order_fill(w, c, 1)->>'why');
  insert into item (world_id, holder, holder_uid, def, ql) values (w, 'player', edda, 'satchel', 20) returning id into v_empty;
  v_got := rpc_order_fill(w, c, 1);
  insert into said values ('EMPTYBAG', coalesce(v_got->>'why', 'filled') || '|'
    || (select holder from item where id = v_empty) || ',' || (select holder from item where id = v_bag));

  -- The coins: what the purses and the open orders hold together is what they held before.
  v_after := purse(w, dane) + purse(w, cato) + purse(w, edda)
    + (select coalesce(sum((want - got) * price), 0) from buy_order where world_id = w and closed_at is null and poster = dane);
  insert into said values ('KEPT', (v_before - v_after)::text);

  -- Taken back: not by somebody else, by its owner for what it still holds, and once.
  perform set_config('request.jwt.claims', json_build_object('sub', cato)::text, true);
  insert into said values ('NOTYOURS', rpc_order_cancel(w, a)->>'why');
  perform set_config('request.jwt.claims', json_build_object('sub', dane)::text, true);
  v_before := purse(w, dane);
  v_got := rpc_order_cancel(w, a);
  insert into said values ('BACK', coalesce(v_got->>'why', 'back') || '|' || (v_got->>'back') || '|' || (purse(w, dane) - v_before)
    || '|' || (select closed from buy_order where n = a));
  insert into said values ('BACKTOLD', (select text from event where world_id = w and uid = dane order by n desc limit 1));
  insert into said values ('TWICE', rpc_order_cancel(w, a)->>'why');

  -- A week and a day old: read off the board by anybody, it lapses and pays back.
  e := (rpc_order(w, 'plank', 4, 2, 0)->>'order')::bigint;
  f := (rpc_order(w, 'rope', 2, 1, 0)->>'order')::bigint;
  update buy_order set at = now() - make_interval(secs => order_life() + 86400) where n = e;
  v_before := purse(w, dane);
  perform set_config('request.jwt.claims', json_build_object('sub', cato)::text, true);
  v_got := rpc_orders(w);
  insert into said values ('LAPSED', (select count(*) from jsonb_array_elements(v_got->'orders') o where (o->>'n')::bigint = e)
    || '|' || (select closed from buy_order where n = e) || '|' || (purse(w, dane) - v_before)
    || '|' || (select closed_at is null from buy_order where n = f));
  -- One nobody has read the board since its week ran out: whoever touches it finds it lapsed.
  update buy_order set at = now() - make_interval(secs => order_life() + 1) where n = f;
  v_before := purse(w, dane);
  v_got := rpc_order_fill(w, f, 1);
  insert into said values ('LATE', (v_got->>'why') || '|' || (select closed from buy_order where n = f)
    || '|' || (purse(w, dane) - v_before));
  insert into said values ('LAPSETOLD', (select string_agg(text, ' / ' order by n) from event where world_id = w and uid = dane and text like '%has lapsed%'));

  -- Brought while Dane is away: counted for him, and handed over when he comes back.
  perform set_config('request.jwt.claims', json_build_object('sub', dane)::text, true);
  a := (rpc_order(w, 'iron_ore', 4, 2, 0)->>'order')::bigint;
  update player set away = true, left_at = now() - interval '2 hours', seen_at = now() - interval '2 hours'
    where world_id = w and uid = dane;
  perform set_config('request.jwt.claims', json_build_object('sub', cato)::text, true);
  perform rpc_order_fill(w, a, 3);
  perform set_config('request.jwt.claims', json_build_object('sub', dane)::text, true);
  v_join := rpc_join(w, null);
  insert into said values ('JOIN', coalesce(v_join->'away', 'null'::jsonb)::text);

  -- And what came by the post is in his post, from Cato, and in his pack once collected.
  insert into said values ('POST', (select string_agg((t->>'count') || ' ' || (t->>'def') || ' from ' || (t->>'from'), ', '
                                            order by t->>'def', t->>'from', (t->>'count')::int)
    from jsonb_array_elements(rpc_parcels(w)->'things') t));
  v_got := rpc_collect(w);
  insert into said values ('COLLECT', coalesce(v_got->>'why', 'collected') || '|'
    || (select count(*) from item where world_id = w and holder = 'post' and holder_uid = dane));

  -- Nobody reads or writes the table but the doors.
  insert into said values ('SHUT', (select relrowsecurity from pg_class where relname = 'buy_order')::text || '|'
    || has_table_privilege('authenticated', 'buy_order', 'select') || '|' || has_table_privilege('anon', 'buy_order', 'insert')
    || '|' || has_function_privilege('authenticated', 'rpc_order_fill(uuid, bigint, integer)', 'execute')
    || '|' || has_function_privilege('authenticated', 'order_sweep(uuid)', 'execute'));
end $b$;
select k || '|' || coalesce(v, 'NULL') from said;
rollback;
`);
const said = (key: string): string => isle.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

check('nobody puts an order up away from a token or a mailbox',
  said('NOBOARD') === 'Stand at a settlement token or a mailbox to put up an order.', said('NOBOARD'));
check('nor asks for coins', said('COIN') === 'Coins are what an order pays with, not something it can ask for.', said('COIN'));
check('nor for a thing there is not', said('NOSUCH') === 'There is no such thing to ask for.', said('NOSUCH'));
check('nor for none, nor for nothing each', said('ZERO') === 'Ask for at least one.|Offer at least a silver for each.', said('ZERO'));
check('nor with coins they do not have, and nothing is taken', said('BROKE') === 'That holds 300 silver, and you are carrying 30.|30', said('BROKE'));
check('one put up holds its whole price', said('POSTED') === 'up|15', said('POSTED'));
check('taken out of the purse gold first, with the change in silver', said('CHANGE') === 'Gold 1, Silver 5', said('CHANGE'));
check('and its owner is told', said('TOLD') === 'Your order is up: 5 × iron ore of quality 30 or better at 3 silver each, with 15 silver held against it.',
  said('TOLD'));
check('a second one takes the last gold and gives the change', said('PURSE') === '7|Silver 7', said('PURSE'));
check('nobody fills their own', said('OWN') === 'It is your own order. Take it back instead.', said('OWN'));
check('at a mailbox the board lists it: what, how many, for how much, how good, who, and where, with a week to go',
  /^true\|\d+\|/.test(said('BOARD')) && said('BOARD').endsWith(`|iron_ore,5,0,3,30,true,false,${said('TILE')},true`), said('BOARD'));
const ORDER_KEYS: Array<keyof Order> = ['n', 'def', 'ql', 'want', 'got', 'price', 'who', 'mine', 'x', 'y', 'deed', 'left'];
check('and says every field the window reads, and nothing else', said('KEYS') === [...ORDER_KEYS].sort().join(','), said('KEYS'));
check('away from one there is no board, and nothing is filled from there',
  said('AWAY') === 'false|0|Stand at a settlement token or a mailbox to fill an order.', said('AWAY'));
check('its owner sees his own wherever he is', said('MINE') === 'false|true,true', said('MINE'));
check('the wrong kind, the wrong quality and a stack put by do not fill it, and nothing goes',
  said('NONE') === 'You have none in your pack that will do.|0', said('NONE'));
check('nor does more than it wants', said('MORE') === 'It wants only 5 more.', said('MORE'));
check('three of a good stack fill it in part, paid three times three', said('FILL') === 'filled|9|2', said('FILL'));
check('out of the stack, the rest left in the pack, and in the post from whoever brought them',
  said('STACK') === `7 at 45|3 iron_ore at 45 from ${CATO}`, said('STACK'));
check('paid in coin into the pack', said('PAID') === '9', said('PAID'));
check('three of five brought, and still open', said('HALF') === '3 of 5,true', said('HALF'));
check('its owner is told who brought what, for how much, and what is still wanted',
  said('HEARD') === 'Cato brings 3 × iron ore to your order, for 9 silver of what it held. It still wants 2. It waits for you at any mailbox.',
  said('HEARD'));
check('and whoever brought it is told what they were paid',
  said('SAID') === `You bring 3 × iron ore to ${said('DANE')}'s order and are paid 9 silver. It goes to them by the post.`, said('SAID'));
check('nothing in the hand goes, and nothing too poor', said('WORN') === 'You have only 1 in your pack that will do.|filled|post,player,player',
  said('WORN'));
check('the poorest that will do goes first, and the last one closes it', said('POOREST') === 'filled|post,player|filled', said('POOREST'));
check('filled, it is off the board', said('GONE') === 'That order is gone.|0', said('GONE'));
check('a bag with something in it does not go', said('FULLBAG') === 'You have none in your pack that will do.', said('FULLBAG'));
check('an empty one does', said('EMPTYBAG') === 'filled|post,player', said('EMPTYBAG'));
check('the purses and the orders hold what they held, coin for coin', said('KEPT') === '0', said('KEPT'));
check('nobody takes back somebody else\'s', said('NOTYOURS') === 'That order is not yours to take back.', said('NOTYOURS'));
check('its owner takes it back for what it still holds', said('BACK') === 'back|6|6|withdrawn', said('BACK'));
check('and is told', said('BACKTOLD') === 'You take back your order for 2 × iron ore of quality 30 or better, and the 6 silver it still held.',
  said('BACKTOLD'));
check('and it is gone after', said('TWICE') === 'That order is gone.', said('TWICE'));
check('a week old, it lapses when the board is read, and pays back; one younger stands', said('LAPSED') === '0|lapsed|8|true', said('LAPSED'));
check('one touched after its week is found lapsed by whoever touches it, and pays back', said('LATE') === 'That order has lapsed.|lapsed|2',
  said('LATE'));
check('and its owner is told each time', said('LAPSETOLD') === 'Your order for 4 × plank has lapsed. The 8 silver it still held is back in your pack. / '
  + 'Your order for 2 × rope has lapsed. The 2 silver it still held is back in your pack.', said('LAPSETOLD'));
let tally: Away | null = null;
try {
  tally = JSON.parse(said('JOIN')) as Away | null;
} catch {
  tally = null;
}
const row = tally?.tally.find((t) => t.what === 'bought' && t.def === 'iron_ore');
check('brought while he was away is counted for him, with what it cost, and handed over',
  !!row && row.n === 3 && row.silver === 6 && tally?.tally.length === 1, said('JOIN'));
check('and the browser says so', !!tally && awayLines(tally).includes(
  `Brought to your buy orders: 3 × iron ore, paid for with ${priceWords(6)} of what they held. It waits for you at any mailbox.`),
  tally ? awayLines(tally).join(' / ') : '');
check('what was brought is in his post, from whoever brought it',
  said('POST') === '3 iron_ore from Cato, 3 iron_ore from Cato, 1 pickaxe from Cato, 1 pickaxe from Edda, 1 satchel from Edda', said('POST'));
check('and in his pack once collected', said('COLLECT') === 'collected|0', said('COLLECT'));
check('the table is nobody\'s to read or write but the doors\'', said('SHUT') === 'true|false|false|true|false', said('SHUT'));

/* ---- two at once ------------------------------------------------------------ */
console.log('--- two at once');
const FENN = 'd3d3d3d3-d3d3-d3d3-d3d3-d3d3d3d3d3d3';
const GWEN = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
const HALE = 'd5d5d5d5-d5d5-d5d5-d5d5-d5d5d5d5d5d5';
const FOLK = `'${FENN}', '${GWEN}', '${HALE}'`;
const as = (uid: string): string => `select set_config('request.jwt.claims', json_build_object('sub', '${uid}')::text, false) \\g /dev/null`;
const world = psql(`select id from world where name = 'Hoarding';`);
const tidy = `
delete from item where world_id = '${world}' and holder_uid in (${FOLK});
delete from letter where world_id = '${world}' and (sender in (${FOLK}) or reader in (${FOLK}));
delete from event where world_id = '${world}' and uid in (${FOLK});
delete from placed where world_id = '${world}' and made_by in (${FOLK});
delete from player where world_id = '${world}' and uid in (${FOLK});
delete from caller where uid in (${FOLK});
`;
let order = 0;
try {
  order = Number(psql(`
${tidy}
insert into player (world_id, uid, name, x, y) values
  ('${world}', '${FENN}', 'Fenn', 8.5, 8.5), ('${world}', '${GWEN}', 'Gwen', 8.5, 8.5), ('${world}', '${HALE}', 'Hale', 8.5, 8.5);
insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by)
  values ('${world}', 'furniture', 'mailbox', 8, 8, 2, 2, 8.75, 8.75, '${FENN}');
select give_coins('${world}', '${FENN}', 10) \\g /dev/null
select give('${world}', '${GWEN}', 'plank', 4, 30) \\g /dev/null
select give('${world}', '${HALE}', 'plank', 4, 30) \\g /dev/null
${as(FENN)}
select rpc_order('${world}', 'plank', 5, 2, 0)->>'order';
`));
  /*
   * Gwen fills four and holds on to the order for a second and a half; Hale
   * asks for four in the middle of it. He asks only once she is sitting on
   * it -- her session is seen asleep after the fill -- so which of them is
   * first is settled by the test and not by how fast a machine starts psql.
   */
  const started = Date.now();
  const [gwen, hale] = await Promise.all([
    session(`${as(GWEN)}
begin;
select coalesce(rpc_order_fill('${world}', ${order}, 4)->>'why', 'filled');
select 'gwen holds it', pg_sleep(1.5);
commit;`),
    session(`${as(HALE)}
do $$
declare tries int := 0;
begin
  while tries < 200 and not exists (select 1 from pg_stat_activity where pid <> pg_backend_pid()
                                       and state = 'active' and query like '%gwen holds it%') loop
    perform pg_sleep(0.05);
    -- The view is read once a transaction and kept, and this whole loop is one.
    perform pg_stat_clear_snapshot();
    tries := tries + 1;
  end loop;
end $$;
select coalesce(rpc_order_fill('${world}', ${order}, 4)->>'why', 'filled') || '|'
  || round(extract(epoch from clock_timestamp() - statement_timestamp())::numeric, 1);`),
  ]);
  const waited = Number(hale.split('|')[1]);
  check('the first to reach an order fills it', gwen.split('\n')[0] === 'filled', gwen.split('\n')[0]);
  check('the second waits for the first to be done, and is then told what is left',
    hale.startsWith('It wants only 1 more.|') && waited >= 0.8, `${hale} (seconds waited), ${Date.now() - started} ms in all`);
  const after = psql(`
${as(HALE)}
select coalesce(rpc_order_fill('${world}', ${order}, 1)->>'why', 'filled');
select got || ' of ' || want || ',' || closed from buy_order where n = ${order};
select purse('${world}', '${GWEN}') || ',' || purse('${world}', '${HALE}') || ','
  || (select sum(count) from item where world_id = '${world}' and holder = 'post' and holder_uid = '${FENN}');
`);
  check('and fills what is left, which closes it with nothing brought twice', after === 'filled\n5 of 5,filled\n8,2,5', after.replace(/\n/g, ' | '));
} finally {
  psql(tidy);
}

for (const line of [...ok, ...bad]) console.log(line);
console.log(`buy orders on the board — ${ok.length} of ${ok.length + bad.length}`);
if (bad.length) process.exit(1);
