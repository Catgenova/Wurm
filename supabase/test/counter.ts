/**
 * A shop counter: a stall set into the wall of a house, on both sides.
 *
 * Asked for: "A counter is a waist-high wall type set in a building's wall
 * (ground floor), and it works as a stall: its keeper sets goods out on it at
 * prices; anyone on the street side within reach can look and buy exactly as
 * at a stall; nobody passes through it; its takings are kept for its keeper
 * as a stall's are."
 *
 * The same shop is put up in the browser and on the island -- two tiles, the
 * counter in the north wall of the western one -- and every question a
 * counter answers is asked of both and held to the same answer:
 *
 *   * where a counter may be planned: the ground floor, on the outline, with
 *     open ground across it, and not between two rooms or two houses;
 *   * that finishing it opens its store, keyed to its wall, and that nobody
 *     walks through it and the eye does not stop at it;
 *   * its keeper sets goods out, and nobody else does; furniture is set down
 *     rather than laid out, but for a creature crate;
 *   * a price, the keeper's alone;
 *   * a buyer looking at it from the street is sent what is on it and at what
 *     price, and buys it there -- and not from inside, not from beside the
 *     house, not from another wing of the same house that reaches round into
 *     the street, not from across the road, not short of the coins, and not
 *     their own; the coins go into the till; and from further off than it is
 *     seen, what is on it is not sent at all;
 *   * finished by a hod worker rather than by hand, its store opens the same,
 *     on both sides;
 *   * what is on it comes back off it for its keeper and nobody else, and it
 *     holds what a stall holds and says so when it is full;
 *   * the board lists it with the stalls, and the keeper takes the takings;
 *   * and it comes down only empty, its store with it.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on
 * it. The island's half is one transaction, rolled back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID } from '../../src/game/actions';
import { BUILD_ACTION_BY_ID } from '../../src/game/buildActions';
import { WALL_TYPE_BY_ID, wallBill, type Side } from '../../src/game/building';
import {
  buyRefusal, COUNTER_BOUGHT_NOT_TAKEN, COUNTER_EMPTY_FIRST, COUNTER_FROM_STREET, COUNTER_FULL, COUNTER_GROUND, COUNTER_HOLDS,
  COUNTER_NO_PIECES, COUNTER_NOT_KEEPER, COUNTER_REACH, COUNTER_SEEN, COUNTER_STREET_ONLY, COUNTER_STREET_TAKEN, COUNTER_TOO_FAR,
  counterReach, counterStreetRefusal,
  type CounterWire,
} from '../../src/game/counters';

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
const same = (what: string, mine: string | null | undefined, theirs: string | null | undefined, want?: string | null): void => {
  const m = mine ?? 'ALLOWED';
  const t = theirs ?? 'ALLOWED';
  check(what, m === t && (want === undefined || m === (want ?? 'ALLOWED')), `browser "${m}", island "${t}"`);
};

/* ---- the shop, in the browser --------------------------------------------- */
/*
 * Two tiles at (20, 20) and (21, 20). The counter goes in the north wall of
 * the western one: its border is the north edge of (20, 20), the street is
 * (20, 19), and it is reached from the middle of that edge, (20.5, 20).
 */
const X = 20, Y = 20;
const game = Game.create(4242);
const bld = game.buildings;
const shop = bld.create('Shop', X, Y);
bld.addTile(shop, X + 1, Y);
// A neighbour hard up against the east end, for a border with a house either side.
const next = bld.create('Next door', X + 2, Y);
game.inventory.add('mallet', { ql: 40 });
game.player.x = X + 0.5;
game.player.y = Y + 0.5;
const plan = ACTION_BY_ID.get('plan_wall');
const tile = (x: number, y: number, side: Side, extra: Record<string, unknown> = {}) =>
  ({ kind: 'tile' as const, x, y, cx: x, cy: y, side, wallType: 'counter' as const, material: 'plank', ...extra });

const minePlan = {
  street: plan?.check?.(tile(X, Y, 'n'), game) ?? null,
  between: plan?.check?.(tile(X, Y, 'e'), game) ?? null,
  nextDoor: plan?.check?.(tile(X + 1, Y, 'e'), game) ?? null,
};
void next;

/* The counter itself, planned and built to its last unit. */
const counterWall = bld.setWall(shop, 0, X, Y, 'n', 'counter', 'plank');
for (const k of Object.keys(counterWall.needed)) counterWall.needed[k] = k === 'plank' ? 1 : 0;
game.inventory.add('plank', { count: 1, ql: 30 });
ACTION_BY_ID.get('build_wall')?.perform?.(tile(X, Y, 'n') as never, game);
const store = game.counters.at(X, Y, 'n');

/* ---- and on the island ------------------------------------------------------ */
const out = psql(`
begin;
create temp table said (k text);
do $b$
declare w uuid; a uuid; b uuid := 'c0ffee00-5e11-4c0e-a111-000000000070';
        v_w wall; v_c placed; v_plank bigint; v_chest bigint; v_crate bigint; v_pip int; v_got jsonb; v_row jsonb;
        v_box bigint;
begin
  select id into w from world where name = 'Hoarding';
  select uid into a from player where world_id = w and name = 'Dane';
  update player set act = null, act_queue = '[]'::jsonb, x = ${X} + 0.5, y = ${Y} + 0.5 where world_id = w and uid = a;
  insert into player (world_id, uid, name, x, y) values (w, b, 'Bryn', ${X} + 0.5, ${Y} - 0.5)
    on conflict (world_id, uid) do update set x = excluded.x, y = excluded.y;
  delete from wall where world_id = w and ((x between ${X - 2} and ${X + 4}) and (y between ${Y - 2} and ${Y + 2}));
  delete from building_tile where world_id = w and (x between ${X - 2} and ${X + 4}) and (y between ${Y - 2} and ${Y + 2});
  insert into building (world_id, id, name, levels, work_level, planned_by) values (w, 91, 'Shop', 1, 0, a), (w, 92, 'Next door', 1, 0, b);
  insert into building_tile (world_id, building, x, y) values (w, 91, ${X}, ${Y}), (w, 91, ${X + 1}, ${Y}), (w, 92, ${X + 2}, ${Y});
  perform give(w, a, 'mallet', 1, 40);

  -- Where one may be planned.
  insert into said values ('PLAN_STREET|' || coalesce(build_refusal(w, a, 'plan_wall',
    '{"x":${X},"y":${Y},"side":"n","wallType":"counter","material":"plank"}'::jsonb), 'ALLOWED'));
  insert into said values ('PLAN_BETWEEN|' || coalesce(build_refusal(w, a, 'plan_wall',
    '{"x":${X},"y":${Y},"side":"e","wallType":"counter","material":"plank"}'::jsonb), 'ALLOWED'));
  insert into said values ('PLAN_NEXTDOOR|' || coalesce(build_refusal(w, a, 'plan_wall',
    '{"x":${X + 1},"y":${Y},"side":"e","wallType":"counter","material":"plank"}'::jsonb), 'ALLOWED'));

  -- Planned, as a builder plans it, and built to its last unit.
  perform perform_building(w, a, 'plan_wall', '{"x":${X},"y":${Y},"side":"n","wallType":"counter","material":"plank"}'::jsonb);
  update wall set needed = (select jsonb_object_agg(k, case when k = 'plank' then 1 else 0 end) from jsonb_object_keys(needed) k)
   where world_id = w and level = 0 and dir = 'h' and x = ${X} and y = ${Y};
  perform give(w, a, 'plank', 1, 30);
  insert into said values ('BILL|' || (select total::text from wall where world_id = w and level = 0 and dir = 'h' and x = ${X} and y = ${Y}));
  perform perform_building(w, a, 'build_wall', '{"x":${X},"y":${Y},"side":"n"}'::jsonb);
  select * into v_c from placed where world_id = w and kind = 'counter' and x = ${X} and y = ${Y} and sub = 'n';
  insert into said values ('STORE|' || coalesce(v_c.id::text, 'NONE') || ',' || coalesce((v_c.made_by = a)::text, 'null')
    || ',' || v_c.cx || ',' || v_c.cy);
  insert into said values ('FLAGS|' || (select passable || ',' || wide || ',' || low from wall_type_def where id = 'counter'));
  -- Its street stays open ground: no building is planned or pushed onto it, and anywhere else is not its business.
  insert into said values ('ON_STREET|' || coalesce(counter_street_refusal(w, ${X}, ${Y - 1}), 'ALLOWED'));
  insert into said values ('OFF_STREET|' || coalesce(counter_street_refusal(w, ${X + 1}, ${Y - 1}), 'ALLOWED'));
  insert into said values ('STREET_HOOKED|' || (select count(*) from pg_proc where proname = 'build_refusal'
    and prosrc like '%counter_street_refusal(p_world, tx, ty)%counter_street_refusal(p_world, tx, ty)%'));

  -- Goods out on it: a stack of planks, part of it, and a chest that is set down instead.
  delete from item where world_id = w and holder = 'player' and holder_uid in (a, b) and def in ('plank', 'chest', 'coin');
  v_plank := give(w, a, 'plank', 5, 30);
  v_chest := give(w, a, 'chest', 1, 30);
  insert into said values ('OUT_NOTKEEPER|' || coalesce(act_refusal(w, b, 'set_out_goods',
    jsonb_build_object('kind', 'item', 'uid', give(w, b, 'plank', 2, 30), 'count', 2, 'into', v_c.id)), 'ALLOWED'));
  insert into said values ('KEEPER|' || folk_name(w, a));
  insert into said values ('OUT_CHEST|' || coalesce(act_refusal(w, a, 'set_out_goods',
    jsonb_build_object('kind', 'item', 'uid', v_chest, 'count', 1, 'into', v_c.id)), 'ALLOWED'));
  insert into said values ('OUT_OK|' || coalesce(act_refusal(w, a, 'set_out_goods',
    jsonb_build_object('kind', 'item', 'uid', v_plank, 'count', 3, 'into', v_c.id)), 'ALLOWED'));
  delete from event where world_id = w and uid = a;
  perform act_perform(w, a, 'set_out_goods', jsonb_build_object('kind', 'item', 'uid', v_plank, 'count', 3, 'into', v_c.id));
  insert into said values ('OUT_SAID|' || coalesce((select text from event where world_id = w and uid = a and kind = 'event' order by n desc limit 1), 'NOTHING'));
  insert into said values ('ON_IT|' || (select coalesce(sum(count), 0) from item where placed = v_c.id and holder = 'counter')
    || ',' || (select coalesce(sum(count), 0) from item where world_id = w and holder = 'player' and holder_uid = a and def = 'plank'));
  select id into v_plank from item where placed = v_c.id and holder = 'counter' and def = 'plank';

  -- A price: the keeper's, and nobody else's.
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  insert into said values ('PRICE_THEIRS|' || coalesce(rpc_price(w, v_plank, 9)->>'why', 'priced'));
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  insert into said values ('PRICE_MINE|' || coalesce(rpc_price(w, v_plank, 5)->>'why', 'priced'));

  -- What a buyer on the street is sent: the store's row, with what is on it and for how much.
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  select r into v_row from jsonb_array_elements(rpc_ground(w, 40, false)->'placed') r where r->>'kind' = 'counter' and (r->>'id')::bigint = v_c.id;
  insert into said values ('GROUND|' || coalesce(v_row::text, '{}'));

  -- Buying: from inside, from beside the house, from across the road, short of coins, and then as it should be.
  update player set x = ${X} + 1.5, y = ${Y} + 0.5 where world_id = w and uid = b;
  insert into said values ('BUY_INSIDE|' || coalesce(rpc_buy(w, v_plank)->>'why', 'bought'));
  update player set x = ${X} - 1.5, y = ${Y} + 0.5 where world_id = w and uid = b;
  insert into said values ('BUY_BESIDE|' || coalesce(rpc_buy(w, v_plank)->>'why', 'bought'));
  update player set x = ${X} + 0.5, y = ${Y} - 4.5 where world_id = w and uid = b;
  insert into said values ('BUY_FAR|' || coalesce(rpc_buy(w, v_plank)->>'why', 'bought'));
  update player set x = ${X} + 0.5, y = ${Y} - 0.5 where world_id = w and uid = b;
  insert into said values ('BUY_BROKE|' || coalesce(rpc_buy(w, v_plank)->>'why', 'bought'));
  -- A wing of the same house reaching round into the street: on the street side of the wall's line, and indoors.
  insert into building_tile (world_id, building, x, y) values (w, 91, ${X + 1}, ${Y - 1});
  update player set x = ${X} + 1.5, y = ${Y} - 0.5 where world_id = w and uid = b;
  insert into said values ('BUY_WING|' || coalesce(rpc_buy(w, v_plank)->>'why', 'bought'));
  delete from building_tile where world_id = w and building = 91 and x = ${X + 1} and y = ${Y - 1};
  -- From further off than it is seen, what is on it is not sent; just short of that, it is.
  update player set x = ${X} + 0.5, y = ${Y} - ${COUNTER_SEEN} - 0.5 where world_id = w and uid = b;
  select r into v_row from jsonb_array_elements(rpc_ground(w, 40, false)->'placed') r where r->>'kind' = 'counter' and (r->>'id')::bigint = v_c.id;
  insert into said values ('SEEN_FAR|' || jsonb_array_length(v_row->'goods') || ',' || (v_row->>'units'));
  update player set x = ${X} + 0.5, y = ${Y} - ${COUNTER_SEEN} + 0.5 where world_id = w and uid = b;
  select r into v_row from jsonb_array_elements(rpc_ground(w, 40, false)->'placed') r where r->>'kind' = 'counter' and (r->>'id')::bigint = v_c.id;
  insert into said values ('SEEN_NEAR|' || jsonb_array_length(v_row->'goods') || ',' || (v_row->>'units'));
  update player set x = ${X} + 0.5, y = ${Y} - 0.5 where world_id = w and uid = b;
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  update player set x = ${X} + 0.5, y = ${Y} - 0.5 where world_id = w and uid = a;
  insert into said values ('BUY_OWN|' || coalesce(rpc_buy(w, v_plank)->>'why', 'bought'));
  update player set x = ${X} + 0.5, y = ${Y} + 0.5 where world_id = w and uid = a;
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  perform give_coins(w, b, 20);
  v_got := rpc_buy(w, v_plank);
  insert into said values ('BUY_OK|' || coalesce(v_got->>'why', 'bought') || ',' || coalesce(v_got->>'paid', '-'));
  -- The three bought, beside the two the buyer came with.
  insert into said values ('TILL|' || (select till from placed where id = v_c.id) || ',' || purse(w, b)
    || ',' || (select coalesce(sum(count), 0) from item where world_id = w and holder = 'player' and holder_uid = b and def = 'plank'));

  -- Its keeper takes things back off it; nobody else does.
  v_plank := give(w, a, 'plank', 2, 30);
  perform act_perform(w, a, 'set_out_goods', jsonb_build_object('kind', 'item', 'uid', v_plank, 'count', 2, 'into', v_c.id));
  select id into v_plank from item where placed = v_c.id and holder = 'counter' and def = 'plank';
  insert into said values ('BACK_THEIRS|' || coalesce(act_refusal(w, b, 'take_off_counter',
    jsonb_build_object('kind', 'item', 'uid', v_plank, 'count', 1)), 'ALLOWED'));
  insert into said values ('BACK_MINE|' || coalesce(act_refusal(w, a, 'take_off_counter',
    jsonb_build_object('kind', 'item', 'uid', v_plank, 'count', 1)), 'ALLOWED'));

  -- Full: what a stall holds, and no more.
  update item set count = count + ${COUNTER_HOLDS} where id = v_plank;
  v_box := give(w, a, 'plank', 1, 30);
  insert into said values ('FULL|' || coalesce(act_refusal(w, a, 'set_out_goods',
    jsonb_build_object('kind', 'item', 'uid', v_box, 'count', 1, 'into', v_c.id)), 'ALLOWED'));
  update item set count = count - ${COUNTER_HOLDS} where id = v_plank;
  delete from item where id = v_box;

  -- It comes down only empty.
  insert into said values ('DOWN_FULL|' || coalesce(build_refusal(w, a, 'remove_wall', '{"x":${X},"y":${Y},"side":"n"}'::jsonb), 'ALLOWED'));

  -- The board, at a mailbox: the counter among the stalls, under its keeper's name.
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by)
    values (w, 'furniture', 'mailbox', ${X}, ${Y - 1}, 0, 0, ${X} + 0.125, ${Y - 1} + 0.125, a) returning id into v_box;
  update item set price = 4 where id = v_plank;
  v_got := rpc_market(w);
  insert into said values ('BOARD|' || coalesce((select s->>'what' || ',' || (s->>'owner' = folk_name(w, a)) || ',' || jsonb_array_length(s->'goods')
    from jsonb_array_elements(v_got->'stalls') s where (s->>'id')::bigint = v_c.id), 'NOT LISTED'));

  -- A wildermon in its crate goes on a counter as it goes on a stall, and nowhere else it did not before.
  v_pip := creature_spawn(w, 'rabba', ${X} + 0.5, ${Y} + 0.5, 'stored', now() - interval '3 hours', a);
  v_crate := give(w, a, 'creature_crate', 1, 30);
  update item set creature = v_pip where id = v_crate;
  insert into said values ('CRATE_CHECK|' || coalesce(act_refusal(w, a, 'set_out_goods',
    jsonb_build_object('kind', 'item', 'uid', v_crate, 'count', 1, 'into', v_c.id)), 'ALLOWED'));
  begin
    perform act_perform(w, a, 'set_out_goods', jsonb_build_object('kind', 'item', 'uid', v_crate, 'count', 1, 'into', v_c.id));
    update item set price = 7 where id = v_crate;
    insert into said values ('CRATE_ON|' || (select holder || ':' || coalesce(price::text, 'null') from item where id = v_crate));
  exception when others then insert into said values ('CRATE_ON|refused: ' || sqlerrm);
  end;

  -- The keeper takes the takings, from either side.
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  v_got := rpc_takings(w, v_c.id);
  insert into said values ('TAKINGS|' || coalesce(v_got->>'why', 'took ' || (v_got->>'took')));

  -- Emptied, it comes down, and its store with it.
  perform act_perform(w, a, 'take_off_counter', jsonb_build_object('kind', 'item', 'uid', v_plank));
  perform act_perform(w, a, 'take_off_counter', jsonb_build_object('kind', 'item', 'uid', v_crate));
  insert into said values ('DOWN_EMPTY|' || coalesce(build_refusal(w, a, 'remove_wall', '{"x":${X},"y":${Y},"side":"n"}'::jsonb), 'ALLOWED'));
  perform perform_building(w, a, 'remove_wall', '{"x":${X},"y":${Y},"side":"n"}'::jsonb);
  insert into said values ('GONE|' || (select count(*) from placed where id = v_c.id));

  -- A hod worker laying the last of a second counter, on the other shop tile: its store opens as one laid by hand does.
  insert into wall (world_id, level, dir, x, y, building, type, material, needed, total, planned_by)
    values (w, 0, 'h', ${X + 1}, ${Y}, 91, 'counter', 'plank', '{"plank":1,"timber":0,"hinge":0}', '{"plank":18,"timber":3,"hinge":2}', a);
  insert into creature (world_id, id, species, name, from_x, from_y, to_x, to_y, health, sex, mode, job, work_x, work_y, keeper, carrying)
    select w, coalesce(max(id), 0) + 1, 'cobbe', 'Hoddy', ${X} + 1.5, ${Y} - 0.5, ${X} + 1.5, ${Y} - 0.5, 20, 'female', 'deed', 'hod', ${X + 1}, ${Y}, a, '{"def":"plank"}'::jsonb
    from creature where world_id = w
    returning id into v_pip;
  -- The errand on its own: what it changes is seen by the statements after it, not by one it is part of.
  insert into said values ('HOD_DID|' || errand_do(w, v_pip));
  insert into said values ('HOD|' || (select substr(k, 9) from said where k like 'HOD_DID|%') || ',' || (select bill_done(needed) from wall where world_id = w and level = 0 and dir = 'h' and x = ${X + 1} and y = ${Y})
    || ',' || (select count(*) from placed where world_id = w and kind = 'counter' and x = ${X + 1} and y = ${Y} and sub = 'n' and made_by = a));

  -- And the reach rule itself, point by point, against the browser's.
  insert into said values ('REACH|' || (select string_agg(coalesce(sells_reach_refusal(v_c, px, py, st), 'ok'), ';' order by n)
    from (values (1, ${X} + 0.5, ${Y} - 0.5, true), (2, ${X} + 0.5, ${Y} + 0.5, true), (3, ${X} + 0.5, ${Y} + 0.5, false),
                 (4, ${X} + 2.8, ${Y} - 0.5, true), (5, ${X} + 2.8, ${Y} - 0.5, false), (6, ${X} - 1.9, ${Y} - 2.3, true),
                 (7, ${X} - 1.9, ${Y} - 2.5, true), (8, ${X} + 0.5, ${Y} + 2.3, false)) v(n, px, py, st)));
end $b$;
select k from said;
rollback;
`);
const said = (key: string): string => out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

/* ---- where one may be planned ---------------------------------------------- */
same('a counter goes in the ground-floor wall with the street on its far side', minePlan.street, said('PLAN_STREET'), null);
same('and not in a wall between two rooms of one house', minePlan.between, said('PLAN_BETWEEN'), COUNTER_STREET_ONLY);
same('nor in a wall between two houses', minePlan.nextDoor, said('PLAN_NEXTDOOR'), COUNTER_STREET_ONLY);
{
  // And not upstairs: the storey over the ground floor, floored, is asked on both sides.
  const up = Game.create(4242);
  const house = up.buildings.create('Tall', 40, 40);
  house.levels = 2;
  house.workLevel = 1;
  const f = up.buildings.setFloor(house, 1, 40, 40, 'plank');
  for (const k of Object.keys(f.needed)) f.needed[k] = 0;
  up.inventory.add('mallet', { ql: 40 });
  const mine = plan?.check?.(tile(40, 40, 'n'), up) ?? null;
  const theirs = psql(`
begin;
do $$
declare w uuid; a uuid;
begin
  select id into w from world where name = 'Hoarding';
  select uid into a from player where world_id = w and name = 'Dane';
  delete from building_tile where world_id = w and x = 40 and y = 40;
  delete from wall where world_id = w and x between 39 and 41 and y between 39 and 41;
  delete from floor_tile where world_id = w and x = 40 and y = 40;
  insert into building (world_id, id, name, levels, work_level, planned_by) values (w, 93, 'Tall', 2, 1, a);
  insert into building_tile (world_id, building, x, y) values (w, 93, 40, 40);
  insert into floor_tile (world_id, level, x, y, building, material, kind, needed, total, planned_by)
    values (w, 1, 40, 40, 93, 'plank', 'floor', '{"plank": 0}', '{"plank": 12}', a);
  perform give(w, a, 'mallet', 1, 40);
  create temp table up_said as select coalesce(build_refusal(w, a, 'plan_wall',
    '{"x":40,"y":40,"side":"n","wallType":"counter","material":"plank"}'::jsonb), 'ALLOWED') as k;
end $$;
select k from up_said;
rollback;`);
  same('nor on a storey over the ground floor', mine, theirs, COUNTER_GROUND);
}

/* ---- what it costs, and what it is ------------------------------------------ */
const bill = wallBill('plank', 'counter').total;
check('it costs the same on both sides: its share of a wall of its material, and its hinges',
  JSON.stringify(Object.fromEntries(Object.entries(bill).sort())) === JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(said('BILL')) as Record<string, number>).sort())),
  `browser ${JSON.stringify(bill)}, island ${said('BILL')}`);
const type = WALL_TYPE_BY_ID.get('counter');
check('finished, its store opens behind it, kept by whoever planned it, reached from the middle of its border',
  !!store && store.x === X && store.y === Y && store.side === 'n' && /^\d+,true,20\.5,20$/.test(said('STORE')),
  `browser ${store ? `${store.x},${store.y},${store.side}` : 'none'}, island ${said('STORE')}`);
{
  // A worker fitting the last of it opens the store as a builder does.
  const w2 = Game.create(4242);
  const house = w2.buildings.create('Workshop', 60, 60);
  const wl = w2.buildings.setWall(house, 0, 60, 60, 'n', 'counter', 'log');
  for (const k of Object.keys(wl.needed)) wl.needed[k] = k === 'log' ? 1 : 0;
  w2.fitIntoWall(wl, 'log');
  check('finished by a hod worker instead, it opens the same, on both sides', !!w2.counters.at(60, 60, 'n') && said('HOD') === 'true,true,1',
    `browser ${w2.counters.list.size} store, island errand done, wall finished, stores kept by its planner: ${said('HOD')}`);
}
check('nobody walks through it, carts included, on both sides',
  bld.blocks(X, Y, X, Y - 1) && bld.blocksVehicle(X, Y, X, Y - 1) && !type?.passable && said('FLAGS') === 'false,false,false',
  `browser blocks ${bld.blocks(X, Y, X, Y - 1)}, island passable,wide,low ${said('FLAGS')}`);
check('and a storey stands on it, the eye goes over it', !type?.low && !type?.opaque, `low ${type?.low}, opaque ${type?.opaque}`);
same('its street is not built over: no building is planned or added onto it', counterStreetRefusal(game, X, Y - 1), said('ON_STREET'), COUNTER_STREET_TAKEN);
same('and the tile beside its street is no business of its', counterStreetRefusal(game, X + 1, Y - 1), said('OFF_STREET'), null);
{
  // Asked by planning a building there and by adding the tile to one, once the ground itself would do.
  const ground = game.planReason;
  game.planReason = () => null;
  const street = { kind: 'tile' as const, x: X, y: Y - 1, cx: X, cy: Y - 1 };
  const planned = BUILD_ACTION_BY_ID.get('plan_building')?.check?.(street, game) ?? null;
  const added = BUILD_ACTION_BY_ID.get('add_to_building')?.check?.(street, game) ?? null;
  game.planReason = ground;
  check('planning a building on it and adding it to one are both refused so, on both sides',
    planned === COUNTER_STREET_TAKEN && added === COUNTER_STREET_TAKEN && said('STREET_HOOKED') === '1',
    `browser "${planned}" / "${added}", island build_refusal asks it: ${said('STREET_HOOKED')}`);
}

/* ---- goods out on it, as its keeper, and as nobody else --------------------- */
const plankStack = game.inventory.add('plank', { count: 5, ql: 30 });
const chest = game.inventory.add('chest', { ql: 30 });
const setOut = ACTION_BY_ID.get('set_out_goods');
const into = { kind: 'item' as const, uid: plankStack.uid, count: 3, into: store?.id };
if (store) store.mine = false;
const mineNotKeeper = setOut?.check?.(into, game) ?? null;
if (store) delete store.mine;
same('only whoever planned it sets goods out on it', mineNotKeeper, said('OUT_NOTKEEPER'), COUNTER_NOT_KEEPER);
same('a piece of furniture is set down, not laid out', setOut?.check?.({ ...into, uid: chest.uid, count: 1 }, game) ?? null, said('OUT_CHEST'), COUNTER_NO_PIECES);
same('its keeper sets goods out from behind it', setOut?.check?.(into, game) ?? null, said('OUT_OK'), null);
game.log.length = 0;
setOut?.perform?.(into, game);
const mineSaid = game.log.map((l) => l.text).find((t) => t.startsWith('You set')) ?? 'NOTHING';
check('and it is said the same way on both sides', mineSaid === said('OUT_SAID'), `browser "${mineSaid}", island "${said('OUT_SAID')}"`);
const onIt = store?.items.reduce((n, it) => n + it.count, 0) ?? 0;
check('three on the counter and two left in the pack, on both sides',
  `${onIt},${game.inventory.count('plank')}` === said('ON_IT') && onIt === 3, `browser ${onIt},${game.inventory.count('plank')}, island ${said('ON_IT')}`);
check(`a counter holds what a stall does: ${COUNTER_HOLDS} things`, COUNTER_HOLDS > 0, `${COUNTER_HOLDS}`);

/* ---- a price, the keeper's alone -------------------------------------------- */
check('a price on a counter is not somebody else\'s to set', said('PRICE_THEIRS') === 'That is not your counter.', said('PRICE_THEIRS'));
check('its keeper prices what is on it', said('PRICE_MINE') === 'priced', said('PRICE_MINE'));

/* ---- a buyer on the street, looking, and buying ----------------------------- */
/*
 * What the island sent the buyer is laid into a browser of their own, and
 * that browser asks the same questions of what it was sent as the island asks
 * of the rows: which is the whole of "looked at on both sides".
 */
const row = JSON.parse(said('GROUND')) as CounterWire & { kind?: string };
const buyer = Game.create(4242);
buyer.counters.saw(row);
const seen = buyer.counters.list.get(row.id);
const good = seen?.items.find((it) => it.id === 'plank');
check('a buyer near it is sent what is on it, at its price, and whose it is',
  !!seen && seen.side === 'n' && good?.price === 5 && good.count === 3 && seen.keeper === said('KEEPER') && seen.mine === false && seen.till === undefined,
  `side ${seen?.side}, ${good?.count} at ${good?.price}, keeper ${seen?.keeper}, mine ${seen?.mine}, till ${seen?.till}`);
buyer.buildings.sawIsland(game.buildings.toJSON());
const at = (x: number, y: number): string | null => {
  buyer.player.x = x;
  buyer.player.y = y;
  return seen && good ? buyRefusal(buyer, seen, good) : 'NO COUNTER';
};
same('not bought from inside the shop', at(X + 1.5, Y + 0.5), said('BUY_INSIDE'), COUNTER_FROM_STREET);
same('nor from beside the house', at(X - 1.5, Y + 0.5), said('BUY_BESIDE'), COUNTER_FROM_STREET);
same('nor from across the road', at(X + 0.5, Y - 4.5), said('BUY_FAR'), COUNTER_TOO_FAR);
same('nor short of the coins', at(X + 0.5, Y - 0.5), said('BUY_BROKE'), 'You cannot afford it. It is 5 silver.');
{
  // A wing of the same house reaching round into the street: past the wall's line, and indoors.
  const shopCopy = [...buyer.buildings.list.values()].find((b) => b.name === 'Shop');
  if (shopCopy) buyer.buildings.addTile(shopCopy, X + 1, Y - 1);
  same('nor from another wing of the house that reaches round into the street', at(X + 1.5, Y - 0.5), said('BUY_WING'), COUNTER_FROM_STREET);
  if (shopCopy) buyer.buildings.removeTile(shopCopy, X + 1, Y - 1);
}
check(`from further off than ${COUNTER_SEEN} tiles a buyer is sent how many things are on it and not what they are; from within, what they are`,
  said('SEEN_FAR') === '0,3' && said('SEEN_NEAR') === '1,3', `beyond ${said('SEEN_FAR')}, within ${said('SEEN_NEAR')} (rows sent, things on it)`);
{
  // Its keeper does not buy off their own counter, on either side.
  if (seen) seen.mine = true;
  same('nor by its keeper', at(X + 0.5, Y - 0.5), said('BUY_OWN'), 'It is your own counter. Take it back off the counter instead.');
  if (seen) seen.mine = false;
}
buyer.inventory.add('coin', { count: 20, extra: 'Silver' });
same('but from the street, with the coins', at(X + 0.5, Y - 0.5), said('BUY_OK').startsWith('bought') ? null : said('BUY_OK'), null);
check('bought on the island: the price paid, into the till, and the planks the buyer\'s',
  said('BUY_OK') === 'bought,5' && said('TILL') === '5,15,5', `${said('BUY_OK')} / ${said('TILL')}`);

/* ---- back off it, the keeper's alone ----------------------------------------- */
const back = ACTION_BY_ID.get('take_off_counter');
const onCounter = store?.items[0];
if (store) store.mine = false;
const mineBackTheirs = onCounter ? back?.check?.({ kind: 'item', uid: onCounter.uid, count: 1 }, game) ?? null : 'NOTHING ON IT';
if (store) delete store.mine;
same('what is on somebody else\'s counter is bought, not taken', mineBackTheirs, said('BACK_THEIRS'), COUNTER_BOUGHT_NOT_TAKEN);
same('its keeper takes it back', onCounter ? back?.check?.({ kind: 'item', uid: onCounter.uid, count: 1 }, game) ?? null : 'NOTHING ON IT', said('BACK_MINE'), null);
{
  // Full: what a stall holds and no more, said with how much that is.
  const heap = { uid: 990001, id: 'plank', ql: 30, dmg: 0, count: COUNTER_HOLDS };
  store?.items.push(heap);
  const one = game.inventory.add('plank', { count: 1, ql: 30 });
  same(`and it holds ${COUNTER_HOLDS} things and no more, and says so`, setOut?.check?.({ kind: 'item', uid: one.uid, count: 1, into: store?.id }, game) ?? null,
    said('FULL'), COUNTER_FULL);
  store?.items.pop();
  game.inventory.remove(one.uid, 1);
}

/* ---- down only empty ------------------------------------------------------- */
const down = ACTION_BY_ID.get('remove_wall');
same('it will not come down with goods on it', down?.check?.(tile(X, Y, 'n'), game) ?? null, said('DOWN_FULL'), COUNTER_EMPTY_FIRST);
game.log.length = 0;
if (onCounter) back?.perform?.({ kind: 'item', uid: onCounter.uid }, game);
same('emptied, it comes down', down?.check?.(tile(X, Y, 'n'), game) ?? null, said('DOWN_EMPTY'), null);
down?.perform?.(tile(X, Y, 'n'), game);
check('and its store goes with it, on both sides', !game.counters.at(X, Y, 'n') && said('GONE') === '0', `island rows left ${said('GONE')}`);

/* ---- the board, a crate, the till ------------------------------------------- */
check('the board lists it among the stalls, as a counter, under its keeper\'s name, with what is for sale',
  said('BOARD') === 'counter,true,1', said('BOARD'));
check('a wildermon in its crate may go out on a counter', said('CRATE_CHECK') === 'ALLOWED', said('CRATE_CHECK'));
check('and there be priced, as on a stall', said('CRATE_ON') === 'counter:7', said('CRATE_ON'));
check('its keeper takes the takings out of its till', said('TAKINGS') === 'took 5', said('TAKINGS'));

/* ---- the reach, point by point ------------------------------------------------ */
const points: Array<[number, number, boolean]> = [
  [X + 0.5, Y - 0.5, true], [X + 0.5, Y + 0.5, true], [X + 0.5, Y + 0.5, false],
  [X + 2.8, Y - 0.5, true], [X + 2.8, Y - 0.5, false], [X - 1.9, Y - 2.3, true],
  [X - 1.9, Y - 2.5, true], [X + 0.5, Y + 2.3, false],
];
const mineReach = points.map(([x, y, st]) => counterReach(game, { x: X, y: Y, side: 'n' }, x, y, st) ?? 'ok').join(';');
check(`reached from within ${COUNTER_REACH} tiles of its middle, and bought from out in its street only: the same answer at every point`,
  mineReach === said('REACH'), `browser ${mineReach}\n       island  ${said('REACH')}`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a shop counter, on both sides — ${ok.length} of ${ok.length}`);
