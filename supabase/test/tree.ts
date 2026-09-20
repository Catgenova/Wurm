/**
 * Nine nodes to a trade.
 *
 * Each of the fourteen trades carries three columns of three: two minor at a
 * point each and a major over them at three, which wants the two under it
 * first. A trade is worth two points at fifty and twelve at a hundred, so
 * twelve buys two whole columns and two over -- never all three.
 *
 * What this asks:
 *
 *   * both sides hold the same hundred and twenty-six nodes, field for field,
 *     and the same four channels;
 *   * the point rule is the same arithmetic on both sides, and the budget is
 *     deliberately smaller than the tree;
 *   * all four refusals are the same sentence on both sides -- the major
 *     before its minor, another trade's node, one you already have, and one
 *     you cannot afford;
 *   * the island's fold is the browser's `foldNodes` to the last bit, not to
 *     within a whisker;
 *   * a node tells on its own trade's skills and on nothing else;
 *   * and every one of the four channels actually moves the number it claims
 *     to, measured at the site that reads it: `skill_mult` for learning,
 *     `spend_wind` for wind, `act_duration` for hands, and a bench and a mend
 *     for fineness -- the last two with the roll taken out of them, so the
 *     ratio is the multiplier and nothing else.
 *
 * Runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';
import {
  CLASS_NODES, CHANNELS, CLASS_POINTS_MAX, COLUMN_COST, CRAFT_CLASSES,
  classPoints, foldNodes, nodeDef, nodeRefusal,
} from '../../src/game/classes';

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
/* An item's quality is a `real`, so a ratio drawn back out of one is close. */
const near = (a: number, b: number, by = 1e-6): boolean => Math.abs(a - b) <= by;

const out = psql(`
begin;
create temp table said (k text);

-- 1. The trees, as the island holds them.
insert into said select 'NODES|' || string_agg(n.id || ':' || n.class || ':' || n.col || ':' || n.rank
  || ':' || n.name || ':' || n.channel || ':' || n.cost || ':' || coalesce(n.needs, '-')
  || ':' || n.mul, '|' order by n.id) from class_node n;
insert into said select 'CHANNELS|' || string_agg(ch.id || ':' || ch.name || ':' || ch.note
  || ':' || ch.downward, '|' order by ch.id) from class_channel ch;
insert into said select 'POINTS|' || string_agg(class_points_for(v)::text, '|' order by v)
  from unnest(array[0, 39, 40, 44, 45, 50, 99, 100, 140]::double precision[]) v;

-- Every channel is read somewhere: a channel nothing is wired to is a column
-- of nine nodes that quietly does nothing, and the browser cannot see that.
insert into said select 'WIRED|' || string_agg(ch.id || ':' || (
    select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.prokind = 'f'
       and strpos(pg_get_functiondef(p.oid), concat(', ', quote_literal(ch.id), ', ')) > 0
       and strpos(pg_get_functiondef(p.oid), 'class_mul(') > 0), '|' order by ch.id)
  from class_channel ch;

-- 2. Somebody to hand a tree to.
do $$
declare w record; v jsonb; v_a double precision; v_b double precision;
        v_c double precision; v_d double precision; v_it bigint;
begin
  /*
   * A named body rather than whichever row the heap hands over first, and a
   * quiet one.
   *
   * Four of these measurements are ratios taken a moment apart, so anything
   * that moves on its own between the two readings is a flake waiting to
   * happen: a boon running out, the rest banked from a bed burning down, and
   * above all the body settling, which charges a swimmer for every second
   * since it last looked and would hand the first reading an empty body and
   * the second a full one. Setting body_at to now is what takes that out: the
   * stretch being settled is a fraction of a second in both readings, so
   * whatever the body is doing, it does the same amount of it either side of
   * the node.
   */
  select p.world_id, p.uid into w from player p order by p.world_id, p.uid limit 1;
  update player set craft_class = null, combat_class = null, class_mul = null,
         act = null, act_target = null, act_ends = null, act_left = null, act_queue = '[]'::jsonb,
         rested = 0, boons = '[]'::jsonb, body_at = now(), swim_at = now(),
         stats = coalesce(stats, '{}'::jsonb)
           || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
    where world_id = w.world_id and uid = w.uid;
  -- And the rate limiter, which counts every door this test knocks on and is
  -- not what any of it is about.
  delete from caller where uid = w.uid;
  delete from player_node where world_id = w.world_id and uid = w.uid;
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'mining', 100)
    on conflict (world_id, uid, id) do update set value = 100;
  perform set_config('request.jwt.claims', json_build_object('sub', w.uid)::text, false);
  perform rpc_take_class(w.world_id, 'miner');
  insert into said values ('BUDGET|' || class_points(w.world_id, w.uid, 'miner')
    || '|' || class_spent(w.world_id, w.uid, 'miner'));

  -- The four refusals, in the island's words.
  insert into said values ('ORDER|' || coalesce(rpc_take_node(w.world_id, 'miner_1_3')->>'why', 'IT WENT THROUGH'));
  insert into said values ('THEIRS|' || coalesce(rpc_take_node(w.world_id, 'mason_1_1')->>'why', 'IT WENT THROUGH'));
  perform rpc_take_node(w.world_id, 'miner_1_1');
  insert into said values ('TWICE|' || coalesce(rpc_take_node(w.world_id, 'miner_1_1')->>'why', 'IT WENT THROUGH'));

  -- A whole column, and what it comes to.
  perform rpc_take_node(w.world_id, 'miner_1_2');
  v := rpc_take_node(w.world_id, 'miner_1_3');
  insert into said values ('COLUMN|' || coalesce(v->>'took', 'nothing') || '|' || (v->>'left'));
  insert into said select 'FOLD|' || (class_mul->>'hands') from player
    where world_id = w.world_id and uid = w.uid;
  insert into said values ('SCOPE|' || class_mul(w.world_id, w.uid, 'hands', 'mining')
    || '|' || class_mul(w.world_id, w.uid, 'hands', 'masonry')
    || '|' || class_mul(w.world_id, w.uid, 'hands', null));

  -- Hands, at the arithmetic every one of its three sites hands to act_duration.
  insert into said values ('HANDS|' || act_duration(8, 100, 0, control_speed(w.world_id, w.uid))
    || '|' || act_duration(8, 100, 0, control_speed(w.world_id, w.uid)
                * class_mul(w.world_id, w.uid, 'hands', 'mining')));

  /*
   * Learning, at the one site that reads it -- and the other trade measured
   * the same way rather than against this one.
   *
   * Both skills are read before and after, because the only thing this can
   * honestly claim is that the node moved one of them and left the other
   * where it was. An earlier version asked masonry to equal mining's starting
   * figure, which is true only of a body with no knack, no stone, no path and
   * an empty table -- and false the moment the suite hands over one that has
   * been used. Every measurement in this file is a ratio across one change on
   * one body for that reason: whatever else is true of the body cancels.
   */
  v_a := skill_mult(w.world_id, w.uid, 'mining');
  v_c := skill_mult(w.world_id, w.uid, 'masonry');
  perform rpc_take_node(w.world_id, 'miner_3_1');
  v_b := skill_mult(w.world_id, w.uid, 'mining');
  v_d := skill_mult(w.world_id, w.uid, 'masonry');
  insert into said values ('LEARN|' || v_a || '|' || v_b || '|' || v_c || '|' || v_d);

  -- Wind, ditto, with the body pinned so the only thing that moved is the node.
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'body_stamina', 20)
    on conflict (world_id, uid, id) do update set value = 20;
  update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', to_jsonb(1.0::double precision))
    where world_id = w.world_id and uid = w.uid;
  perform spend_wind(w.world_id, w.uid, 'mine');
  select 1 - (stats->>'stamina')::double precision into v_a from player
    where world_id = w.world_id and uid = w.uid;
  perform rpc_take_node(w.world_id, 'miner_2_1');
  update skill set value = 20 where world_id = w.world_id and uid = w.uid and id = 'body_stamina';
  update player set stats = jsonb_set(stats, '{stamina}', to_jsonb(1.0::double precision))
    where world_id = w.world_id and uid = w.uid;
  perform spend_wind(w.world_id, w.uid, 'mine');
  select 1 - (stats->>'stamina')::double precision into v_b from player
    where world_id = w.world_id and uid = w.uid;
  insert into said values ('WIND|' || coalesce(v_a::text, 'none') || '|' || coalesce(v_b::text, 'none'));

  -- And the twelfth point, which does not stretch to a third column.
  perform rpc_take_node(w.world_id, 'miner_2_2');
  perform rpc_take_node(w.world_id, 'miner_2_3');
  perform rpc_take_node(w.world_id, 'miner_3_2');
  insert into said values ('SPENT|' || class_spent(w.world_id, w.uid, 'miner')
    || '|' || coalesce(rpc_take_node(w.world_id, 'miner_3_3')->>'why', 'IT WENT THROUGH'));

  -- 3. Putting the trade down puts the tree down, which is the only undo.
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'smelting', 60)
    on conflict (world_id, uid, id) do update set value = 60;
  perform give_coins(w.world_id, w.uid, class_change_cost()::bigint * 3);
  perform rpc_take_class(w.world_id, 'smith');
  insert into said select 'CLEARED|' || count(*) || '|'
    || coalesce((select class_mul->>'hands' from player
                  where world_id = w.world_id and uid = w.uid), 'gone')
    from player_node where world_id = w.world_id and uid = w.uid;

  -- 4. Fineness at the bench, with the roll taken out so the ratio is the node.
  update recipe set difficulty = null where id = 'make_bronze';
  delete from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid
    and def in ('bronze_lump', 'copper_lump', 'tin_lump');
  perform give(w.world_id, w.uid, 'copper_lump', 3, 50);
  perform give(w.world_id, w.uid, 'tin_lump', 1, 50);
  perform perform_craft(w.world_id, w.uid, 'make_bronze', '{}'::jsonb);
  select ql into v_a from item where world_id = w.world_id and holder = 'player'
    and holder_uid = w.uid and def = 'bronze_lump';
  perform rpc_take_node(w.world_id, 'smith_2_1');
  update skill set value = 60 where world_id = w.world_id and uid = w.uid and id = 'smelting';
  delete from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid
    and def in ('bronze_lump', 'copper_lump', 'tin_lump');
  perform give(w.world_id, w.uid, 'copper_lump', 3, 50);
  perform give(w.world_id, w.uid, 'tin_lump', 1, 50);
  perform perform_craft(w.world_id, w.uid, 'make_bronze', '{}'::jsonb);
  select ql into v_b from item where world_id = w.world_id and holder = 'player'
    and holder_uid = w.uid and def = 'bronze_lump';
  insert into said values ('BENCH|' || coalesce(v_a::text, 'none') || '|' || coalesce(v_b::text, 'none'));

  -- 5. And at a mend, where the same number runs the other way.
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'repair', 60)
    on conflict (world_id, uid, id) do update set value = 60;
  perform rpc_take_class(w.world_id, 'mender');
  v_it := give(w.world_id, w.uid, 'hammer', 1, 50);
  update item set dmg = 30, ql = 50 where id = v_it;
  perform perform_item(w.world_id, w.uid, 'repair_item', jsonb_build_object('uid', v_it));
  select 50 - ql into v_a from item where id = v_it;
  perform rpc_take_node(w.world_id, 'mender_2_1');
  update skill set value = 60 where world_id = w.world_id and uid = w.uid and id = 'repair';
  update item set dmg = 30, ql = 50 where id = v_it;
  perform perform_item(w.world_id, w.uid, 'repair_item', jsonb_build_object('uid', v_it));
  select 50 - ql into v_b from item where id = v_it;
  insert into said values ('MEND|' || coalesce(v_a::text, 'none') || '|' || coalesce(v_b::text, 'none'));
end $$;

select * from said;
rollback;
`);

const said = (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

/* The island's nodes, in the shape the browser's make. */
const island = said('NODES').split('|').sort();
const browser = CLASS_NODES.map((n) => [n.id, n.class, n.col, n.rank, n.name, n.channel,
  n.cost, n.needs ?? '-', n.mul].join(':')).sort();
check('both sides hold the same hundred and twenty-six nodes, field for field',
  island.join() === browser.join(),
  island.join() === browser.join() ? `${island.length} of them`
    : `island ${island.length}, browser ${browser.length}; first difference ${
      island.find((s, i) => s !== browser[i]) ?? '-'} vs ${browser.find((s, i) => s !== island[i]) ?? '-'}`);

const islandCh = said('CHANNELS').split('|').sort();
const browserCh = Object.entries(CHANNELS)
  .map(([id, c]) => [id, c.name, c.note, c.lower].join(':')).sort();
check('and the same four channels', islandCh.join() === browserCh.join(),
  islandCh.join(' / '));

check('nine nodes to a trade, in three columns of three',
  CRAFT_CLASSES.every((c) => {
    const mine = CLASS_NODES.filter((n) => n.class === c.id);
    return mine.length === 9 && [1, 2, 3].every((col) =>
      mine.filter((n) => n.col === col).map((n) => n.rank).sort().join() === '1,2,3');
  }), `${CLASS_NODES.length} over ${CRAFT_CLASSES.length} trades`);
check('a minor is a point, a major is three, and a major wants the one under it',
  CLASS_NODES.every((n) => n.cost === (n.rank === 3 ? 3 : 1)
    && (n.rank === 1 ? n.needs === null : nodeDef(n.needs ?? '')?.rank === n.rank - 1)));

const points = said('POINTS').split('|').map(Number);
const want = [0, 39, 40, 44, 45, 50, 99, 100, 140].sort((a, b) => a - b).map(classPoints);
check('the point rule is the same arithmetic on both sides',
  points.join() === want.join(), `island ${points.join()}, browser ${want.join()}`);
check('a trade is worth two points at fifty and twelve at the top',
  classPoints(50) === 2 && CLASS_POINTS_MAX === 12, `${classPoints(50)} and ${CLASS_POINTS_MAX}`);
check('and twelve buys two whole columns and two over, never three',
  CLASS_POINTS_MAX >= 2 * COLUMN_COST && CLASS_POINTS_MAX < 3 * COLUMN_COST,
  `a column is ${COLUMN_COST}, the budget is ${CLASS_POINTS_MAX}`);

const wired = said('WIRED').split('|');
check('every channel is read by something, so no column is quietly dead',
  wired.length === Object.keys(CHANNELS).length && wired.every((w) => Number(w.split(':')[1]) > 0),
  wired.join(' '));

check('a fresh trade is twelve points with none of them spent', said('BUDGET') === '12|0', said('BUDGET'));

const mine = (taken: string[], id: string): string =>
  nodeRefusal(nodeDef(id)!, 'miner', taken, 12) ?? 'open';
check('the major wants the minor under it, in the same words on both sides',
  said('ORDER') === mine([], 'miner_1_3') && said('ORDER') === 'Swing II comes first.', said('ORDER'));
check('another trade’s node is not yours, ditto',
  said('THEIRS') === mine([], 'mason_1_1'), said('THEIRS'));
check('one you already have, ditto',
  said('TWICE') === mine(['miner_1_1'], 'miner_1_1'), said('TWICE'));

check('a column taken in order leaves seven of the twelve', said('COLUMN') === 'miner_1_3|7', said('COLUMN'));
check('and the island’s fold is the browser’s, to the last bit',
  said('FOLD') === String(foldNodes(['miner_1_1', 'miner_1_2', 'miner_1_3']).hands),
  `island ${said('FOLD')}, browser ${foldNodes(['miner_1_1', 'miner_1_2', 'miner_1_3']).hands}`);

const [onMine, onStone, onNeither] = said('SCOPE').split('|').map(Number);
check('a node tells on its own trade’s skills and on nothing else',
  onMine < 1 && onStone === 1 && onNeither === 1,
  `mining ${onMine}, masonry ${onStone}, no trade at all ${onNeither}`);

const [handsPlain, handsTree] = said('HANDS').split('|').map(Number);
check('hands: a whole column takes a sixth off the time a go takes',
  near(handsTree / handsPlain, 0.97 * 0.96 * 0.9), `${handsPlain} → ${handsTree}`);

const [learnPlain, learnTree, stonePlain, stoneTree] = said('LEARN').split('|').map(Number);
check('learning: one minor is three per cent more out of every go, and nothing on another trade',
  near(learnTree / learnPlain, 1.03) && stoneTree === stonePlain,
  `mining ${learnPlain} → ${learnTree}, masonry ${stonePlain} → ${stoneTree}`);

const [windPlain, windTree] = said('WIND').split('|').map(Number);
check('wind: one minor is three per cent less out of you',
  near(windTree / windPlain, 0.97, 1e-5), `${windPlain} → ${windTree}`);

const [spent, broke] = said('SPENT').split('|');
check('twelve spent, and the thirteenth point is refused in the same words',
  spent === '12' && broke === nodeRefusal(nodeDef('miner_3_3')!, 'miner',
    ['miner_1_1', 'miner_1_2', 'miner_1_3', 'miner_2_1', 'miner_2_2', 'miner_2_3', 'miner_3_1', 'miner_3_2'], 12),
  broke);

check('putting the trade down puts the whole tree down with it',
  said('CLEARED') === '0|gone', said('CLEARED'));

const [benchPlain, benchTree] = said('BENCH').split('|').map(Number);
check('fineness: a minor is two per cent on what comes off the bench',
  near(benchTree / benchPlain, 1.02, 1e-5), `QL ${benchPlain} → ${benchTree}`);

const [mendPlain, mendTree] = said('MEND').split('|').map(Number);
check('and two per cent less quality off what you mend, the same number backwards',
  near(mendTree / mendPlain, 1 / 1.02, 1e-5), `${mendPlain} lost → ${mendTree}`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`nine nodes to a trade — ${ok.length} of ${ok.length}`);
