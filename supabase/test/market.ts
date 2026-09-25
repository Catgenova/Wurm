/**
 * Goods that change hands, through the island's own doors.
 *
 * Asked for: "A market board. List every merchant stall on the island at any
 * settlement token or post: what's for sale, where, and at what price", and
 * "Trade a wildermon in its crate. Face to face, at a stall, or by post."
 *
 * The stalls had never sold anything. `rpc_price` and `mailbox_at` looked a
 * piece up by `placed.kind`, which is 'furniture' for every piece anybody
 * builds, so a price was always refused and a mailbox never found; the test
 * beside this one put its rows down by hand with `kind` 'stall', which no
 * builder does, and passed. This one builds the pieces the way a builder
 * leaves them, and goes through the doors:
 *
 *   * a price set on your own stall, and refused on somebody else's;
 *   * a mailbox found at your feet;
 *   * the board read at a mailbox and not away from one, with what is for
 *     sale on it and nothing that is not; your own stall's till and unpriced
 *     goods for you alone, wherever you are;
 *   * a thing bought at the counter, its price in the till;
 *   * a thing on somebody else's stall not taken, and taken back by its owner,
 *     without its price;
 *   * a crate with a wildermon in it laid on the stall, priced, bought -- and
 *     the wildermon the buyer's;
 *   * the same crate into a chest refused, into a bag refused, priced in a
 *     pack refused;
 *   * offered in a deal: not to be opened, nor what is in it let go, while it
 *     stands, and the wildermon the taker's when it is taken;
 *   * posted: the recipient's from then on, named in their post, and in
 *     their pack when collected.
 *
 * Runs against the database the suite leaves behind, in a transaction that is
 * rolled back.
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
do $b$
declare w uuid; a uuid; b uuid := '66666666-6666-6666-6666-666666666666';
        ax double precision; ay double precision;
        v_stall bigint; v_box bigint; v_chest bigint; v_bag bigint;
        v_plank bigint; v_shaft bigint; v_crate bigint; v_pip int; v_deal bigint; v_got jsonb;
begin
  select id into w from world where name = 'Hoarding';
  select uid into a from player where world_id = w and name = 'Dane';
  select x, y into ax, ay from player where world_id = w and uid = a;
  update player set act = null, act_queue = '[]'::jsonb where world_id = w and uid = a;
  insert into player (world_id, uid, name, x, y) values (w, b, 'Bryn', ax + 1, ay);
  perform give_coins(w, b, 50);

  -- A's stall and a mailbox, as a builder leaves them: 'furniture', with the piece in sub.
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by)
    values (w, 'furniture', 'stall', floor(ax)::int, floor(ay)::int, 0, 0, floor(ax)::int + 0.5, floor(ay)::int + 0.5, a)
    returning id into v_stall;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by)
    values (w, 'furniture', 'mailbox', floor(ax)::int, floor(ay)::int, 2, 2, floor(ax)::int + 0.75, floor(ay)::int + 0.75, a)
    returning id into v_box;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by)
    values (w, 'furniture', 'chest', floor(ax)::int, floor(ay)::int, 1, 3, floor(ax)::int + 0.4, floor(ay)::int + 0.9, a)
    returning id into v_chest;
  insert into item (world_id, holder, def, ql, count, placed)
    values (w, 'furniture', 'plank', 30, 1, v_stall) returning id into v_plank;
  insert into item (world_id, holder, def, ql, count, placed)
    values (w, 'furniture', 'shaft', 30, 3, v_stall) returning id into v_shaft;

  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  insert into said values ('PRICE|' || rpc_price(w, v_plank, 5)::text);
  insert into said values ('ATBOX|' || ((mailbox_at(w, a)).id is not null)::text);
  v_got := rpc_market(w);
  insert into said values ('MINE|' || (v_got->'stalls'->0->>'mine') || ',' || (v_got->'stalls'->0->>'till')
    || ',' || jsonb_array_length(v_got->'stalls'->0->'goods'));

  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  insert into said values ('NOTYOURS|' || coalesce(rpc_price(w, v_shaft, 9)->>'why', 'priced'));
  -- Away from the mailbox and any token, no board.
  update player set x = ax + 60 where world_id = w and uid = b;
  v_got := rpc_market(w);
  insert into said values ('AWAY|' || (v_got->>'board') || ',' || jsonb_array_length(v_got->'stalls'));
  update player set x = ax + 1 where world_id = w and uid = b;
  v_got := rpc_market(w);
  insert into said values ('BOARD|' || (v_got->>'board') || ',' || ((v_got->'stalls'->0->>'owner') = folk_name(w, a))
    || ',' || jsonb_array_length(v_got->'stalls'->0->'goods') || ',' || (v_got->'stalls'->0->'goods'->0->>'price')
    || ',' || coalesce(v_got->'stalls'->0->>'till', 'no till'));
  insert into said values ('BUY|' || rpc_buy(w, v_plank)::text);
  insert into said values ('TILL|' || (select till from placed where id = v_stall)
    || ',' || (select holder_uid = b from item where id = v_plank));
  insert into said values ('THEFT|' || coalesce(act_refusal(w, b, 'take_from_store',
    jsonb_build_object('kind', 'item', 'uid', v_shaft)), 'allowed'));

  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  update item set price = 4 where id = v_shaft;
  insert into said values ('OWNERTAKES|' || coalesce(act_refusal(w, a, 'take_from_store',
    jsonb_build_object('kind', 'item', 'uid', v_shaft)), 'allowed'));
  perform move_part(v_shaft, 3, 'player', a, null, null);
  insert into said values ('UNPRICED|' || coalesce((select price::text from item
    where world_id = w and holder = 'player' and holder_uid = a and def = 'shaft' order by id desc limit 1), 'null'));

  -- A wildermon of A's, in a crate in A's pack.
  v_pip := creature_spawn(w, 'rabba', ax, ay, 'stored', now() - interval '3 hours', a);
  update creature set name = 'Pip' where world_id = w and id = v_pip;
  v_crate := give(w, a, 'creature_crate', 1, 30);
  update item set creature = v_pip where id = v_crate;
  insert into said values ('ONSTALL|' || coalesce(act_refusal(w, a, 'store_in_furniture',
    jsonb_build_object('kind', 'item', 'uid', v_crate, 'into', v_stall)), 'allowed'));
  insert into said values ('INCHEST|' || coalesce(furniture_refuses((select p from placed p where id = v_chest), 'creature_crate'), 'takes it'));
  begin
    update item set price = 7 where id = v_crate;
    insert into said values ('PACKPRICE|allowed');
  exception when others then insert into said values ('PACKPRICE|refused');
  end;
  v_bag := give(w, a, 'satchel', 1, 30);
  begin
    update item set inside = v_bag where id = v_crate;
    insert into said values ('INBAG|allowed');
  exception when others then insert into said values ('INBAG|refused');
  end;

  -- Offered to B: not opened, not let go, while the offer stands; B's when taken.
  v_got := rpc_deal(w, b, array[v_crate], 0, 0);
  select n into v_deal from deal where world_id = w and seller = a and buyer = b and closed_at is null;
  insert into said values ('OFFERED|' || coalesce(v_got->>'why', 'out'));
  insert into said values ('OPENDEAL|' || coalesce(crate_open_refusal(w, a, 'crate_follow',
    jsonb_build_object('kind', 'item', 'uid', v_crate)), 'allowed'));
  insert into said values ('LETGO|' || coalesce(creature_refusal(w, a, 'release_creature',
    jsonb_build_object('kind', 'creature', 'id', v_pip)), 'allowed'));
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  insert into said values ('DEALS|' || (select string_agg(t->'creature'->>'name', ',')
    from jsonb_array_elements(rpc_deals(w)) d, jsonb_array_elements(d->'things') t));
  v_got := rpc_deal_answer(w, v_deal, true);
  insert into said values ('TAKEN|' || coalesce(v_got->>'why', 'taken') || ','
    || (select keeper = b from creature where world_id = w and id = v_pip) || ','
    || (select holder_uid = b from item where id = v_crate));

  -- B posts it back to A: A's from the moment it goes in, named in A's post, and collected.
  v_got := rpc_parcel(w, a, 'Yours again.', array[v_crate]);
  insert into said values ('POSTED|' || coalesce(v_got->>'why', 'posted') || ','
    || (select keeper = a from creature where world_id = w and id = v_pip) || ','
    || (select holder from item where id = v_crate));
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  insert into said values ('INPOST|' || (select string_agg(t->'creature'->>'name', ',')
    from jsonb_array_elements(rpc_parcels(w)->'things') t));
  v_got := rpc_collect(w);
  insert into said values ('COLLECTED|' || coalesce(v_got->>'why', 'collected') || ','
    || (select holder || ':' || (holder_uid = a) from item where id = v_crate));

  -- On the stall, priced, and bought by B: the buyer keeps the wildermon.
  perform act_perform(w, a, 'store_in_furniture', jsonb_build_object('kind', 'item', 'uid', v_crate, 'into', v_stall));
  insert into said values ('LAID|' || (select holder || ':' || coalesce(placed = v_stall, false) from item where id = v_crate));
  insert into said values ('PRICED|' || coalesce(rpc_price(w, v_crate, 12)->>'why', 'priced'));
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  insert into said values ('STALLLETGO|' || coalesce(creature_refusal(w, a, 'release_creature',
    jsonb_build_object('kind', 'creature', 'id', v_pip)), 'allowed'));
  insert into said values ('BOARDPIP|' || (select string_agg(g->'creature'->>'name', ',')
    from jsonb_array_elements(rpc_market(w)->'stalls') s, jsonb_array_elements(s->'goods') g
    where g->'creature' is not null and g->'creature' <> 'null'::jsonb));
  v_got := rpc_buy(w, v_crate);
  insert into said values ('BOUGHT|' || coalesce(v_got->>'why', 'bought') || ','
    || (select keeper = b from creature where world_id = w and id = v_pip) || ','
    || (select holder || ':' || (holder_uid = b) from item where id = v_crate));
end $b$;
select k from said;
rollback;
`);

const said = (key: string): string => out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? '';

check('a price goes on your own stall', said('PRICE').includes('"priced": 5'), said('PRICE'));
check('a mailbox is found at your feet', said('ATBOX') === 'true', said('ATBOX'));
check('your own stall comes back to you with its till and everything on it', said('MINE') === 'true,0,2', said('MINE'));
check('a price is not somebody else\'s to set', said('NOTYOURS') === 'That is not your stall.', said('NOTYOURS'));
check('away from a mailbox and a token there is no board', said('AWAY') === 'false,0', said('AWAY'));
check('at a mailbox the board lists the stall under its owner\'s name, what is for sale on it, and no till',
  said('BOARD') === 'true,true,1,5,no till', said('BOARD'));
check('a thing is bought at the counter', said('BUY').includes('"paid": 5'), said('BUY'));
check('and its price is in the till, and the thing is the buyer\'s', said('TILL') === '5,true', said('TILL'));
check('a thing on somebody else\'s stall is not taken', said('THEFT') === 'That is on somebody else\'s stall. Buy it at the counter.', said('THEFT'));
check('its owner takes it back', said('OWNERTAKES') === 'allowed', said('OWNERTAKES'));
check('and it comes back without its price', said('UNPRICED') === 'null', said('UNPRICED'));
check('a crate with a wildermon in it goes on a stall', said('ONSTALL') === 'allowed', said('ONSTALL'));
check('and into no other store', said('INCHEST') === 'A creature crate goes on a stall, and in no other store.', said('INCHEST'));
check('it carries no price in a pack', said('PACKPRICE') === 'refused', said('PACKPRICE'));
check('it goes into no bag', said('INBAG') === 'refused', said('INBAG'));
check('it can be offered in a deal', said('OFFERED') === 'out', said('OFFERED'));
check('while it is on offer it is not opened', said('OPENDEAL') === 'That crate is offered in a deal. Take the offer back first.', said('OPENDEAL'));
check('nor what is in it let go', said('LETGO') === 'Pip\'s crate is on offer, on a stall or in the post. Take it back first.', said('LETGO'));
check('the deal names the wildermon in the crate', said('DEALS') === 'Pip', said('DEALS'));
check('taken, the wildermon is the taker\'s', said('TAKEN') === 'taken,true,true', said('TAKEN'));
check('posted, it is the recipient\'s from the moment it goes in', said('POSTED') === 'posted,true,post', said('POSTED'));
check('their post names the wildermon in it', said('INPOST') === 'Pip', said('INPOST'));
check('and it comes out into their pack', said('COLLECTED') === 'collected,player:true', said('COLLECTED'));
check('laid on the stall', said('LAID') === 'furniture:true', said('LAID'));
check('and priced there', said('PRICED') === 'priced', said('PRICED'));
check('while it is on the stall what is in it is not let go',
  said('STALLLETGO') === 'Pip\'s crate is on offer, on a stall or in the post. Take it back first.', said('STALLLETGO'));
check('the board names the wildermon on the stall', said('BOARDPIP') === 'Pip', said('BOARDPIP'));
check('bought, the wildermon is the buyer\'s', said('BOUGHT') === 'bought,true,player:true', said('BOUGHT'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`goods that change hands — ${ok.length} of ${ok.length}`);
