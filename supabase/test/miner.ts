/**
 * The Miner's eighteen perks, each measured where its rule is.
 *
 * `perks.ts` holds the two sides to each other for every trade on perks --
 * the rows, the tiers, the fold, the choosing -- and this asks the one thing
 * that is the Miner's own: that each perk does what its note says, on the
 * island, with the dice taken out wherever they can be. A chance is put at
 * one (or its rule's at nought) inside the transaction, so that a go must
 * show it; what is asked is that the rule reads the perk, not that a random
 * number fell a particular way.
 *
 *   * the face: Quick Pick's time, Sure Swing's failures, Rich Seam's and
 *     Coal Hand's count, Rare Ore, Rock Slide, Gem Eye and Treasure in the
 *     Rock, Ore Cart's container, all through the clock where a go's perks
 *     are its context;
 *   * what the face asks: Wet Work's water and Ore Sense's gold at forty,
 *     which Prospect's sample says too, and Far Reader's reach;
 *   * Chip corner: Chipper's odds and Face Shaper's two steps, stopped at a
 *     level taken;
 *   * the trowel: Keen Trowel, Bauble Hunter, and Pieces that Fit bringing
 *     up a piece of a relic too hard to be found any other way;
 *   * and Pan: asked, refused in the browser's words, and done;
 *   * and the browser reads the same numbers where it draws or asks them.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, mineDepth, MINE_DEPTH, oreNeeds, PAN_ORES, prospectRadius, prospectReach } from '../../src/game/actions';
import { FIND_BASE, FIND_CAP, FIND_PER_SKILL, FIND_PER_TOOL, findChance } from '../../src/game/archaeology';
import { perksOf, type PerkDef } from '../../src/game/perks';
import { TileType } from '../../src/world/tiles';

const psql = (sql: string): string =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
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
const near = (a: number, b: number, by = 1e-6): boolean => Math.abs(a - b) <= by;

const MINER = perksOf('miner');
const P = (name: string): PerkDef => {
  const p = MINER.find((x) => x.name === name);
  if (!p) throw new Error(`the Miner has no perk called ${name}`);
  return p;
};
const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const hold = (...names: string[]): string =>
  `perform pg_temp.hold(w, u, array[${names.map((n) => q(P(n).id)).join(', ')}]::text[])`;
/** A perk's number put where a go must show it, for the length of the transaction. */
const patch = (name: string, fx: Record<string, number>): string =>
  `update class_perk set fx = fx || ${q(JSON.stringify(fx))}::jsonb where id = ${q(P(name).id)}`;
/** The face at 3,3, worked from its 4,4 corner. */
const FACE = `jsonb_build_object('kind', 'tile', 'x', 3, 'y', 3, 'cx', 4, 'cy', 4)`;
const mine = `perform pg_temp.go(w, u, 'mine', ${FACE})`;
/* Until a go comes off: a skill check fails now and again however good the hand. */
const until = (what: string, done: string): string => `
  for k in 1..12 loop
    update item set dmg = 0 where id = v_pick;
    update skill set value = 60 where world_id = w and uid = u and id = 'mining';
    ${what};
    exit when ${done};
  end loop;`;
const count = (def: string): string =>
  `(select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = '${def}')`;
const clear = (...defs: string[]): string =>
  `delete from item where world_id = w and holder = 'player' and holder_uid = u and def in (${defs.map(q).join(', ')})`;
const told = (like: string): string =>
  `(select count(*) from event e where e.world_id = w and e.uid = u and e.text like ${q(like)})`;

const RELIC = 'ancient helm';

const out = psql(`
begin;
create temp table said (k text, v text);

/* The rulebook's side of what the Miner reads. */
insert into said select 'FINDS', find_base() || '|' || find_per_skill() || '|' || find_per_tool() || '|' || find_cap();
insert into said select 'PANORES', string_agg(item, ',' order by item) from pan_ore;
insert into said select 'PANJOB', base_time || '|' || skill || '|' || coalesce(tool, '-') || '|' || stamina || '|' || act_ported('pan')
  from action_def where id = 'pan';
insert into said select 'CHANCES', string_agg(round(find_chance(s, t, m, c)::numeric, 9)::text, ',' order by o)
  from (values (1, 0, 0, 0, 0.7), (2, 50, 50, 0, 0.7), (3, 100, 100, 0, 0.7), (4, 50, 50, 0.15, 0.85), (5, 100, 100, 0.15, 0.85))
       v(o, s, t, m, c);
insert into said select 'PASS', count(*) filter (where perk_pass(false, 0.5))::text from generate_series(1, 4000);

create function pg_temp.hold(w uuid, u uuid, ids text[]) returns jsonb language plpgsql as $f$
begin
  delete from player_node where world_id = w and uid = u;
  insert into player_node (world_id, uid, node) select w, u, x from unnest(ids) x;
  return class_fold(w, u);
end $f$;
create function pg_temp.go(w uuid, u uuid, a text, t jsonb) returns void language plpgsql as $f$
begin
  update player set act = a, act_target = t, act_started = now() - interval '2 seconds',
         act_ends = now() - interval '1 second', act_left = 1, act_goes = 1, act_queue = '[]'
   where world_id = w and uid = u;
  perform settle(w, u);
end $f$;

do $$
declare w uuid; u uuid; tx int; ty int; j jsonb; v_a double precision; v_b double precision;
        v_pick bigint; v_chest bigint; n int; k int; v_t text; v_u text; v_e bigint;
begin
  -- The suite's own island, and its first body, on flat dirt with a rock face at 2..4.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  for tx in 0..15 loop for ty in 0..15 loop
    perform land_set_height(w, tx, ty, 40); perform land_set_dirt(w, tx, ty, 20);
    perform land_set_tile(w, tx, ty, tile_id('Dirt')); perform land_set_data(w, tx, ty, 0);
  end loop; end loop;
  for tx in 2..4 loop for ty in 2..4 loop
    perform land_set_tile(w, tx, ty, 4); perform land_set_rock(w, tx, ty, 0);
  end loop; end loop;
  for tx in 2..5 loop for ty in 2..5 loop perform land_set_dirt(w, tx, ty, 0); end loop; end loop;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  delete from player_node where world_id = w and uid = u;
  delete from caller where uid = u;
  update placed set driver = null where world_id = w and driver = u;
  update placed set puller = null where world_id = w and puller = u;
  update player set x = 3.5, y = 3.5, act = null, act_target = null, act_started = null, act_ends = null,
         act_left = null, act_goes = null, act_queue = '[]', craft_class = 'miner', combat_class = null,
         class_mul = null, level_h = null, rested = 0, boons = '[]'::jsonb, body_at = now(), swim_at = now(),
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
   where world_id = w and uid = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  insert into skill (world_id, uid, id, value) values (w, u, 'mining', 60)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  v_pick := give(w, u, 'pickaxe', 1, 100);

  /* ---- Ore Sense: gold at forty, and Prospect's sample says so. ---- */
  perform land_set_rock(w, 3, 3, 10);
  update skill set value = 45 where world_id = w and uid = u and id = 'mining';
  perform pg_temp.hold(w, u, '{}');
  insert into said values ('GOLD', coalesce(act_refusal(w, u, 'mine', ${FACE}), 'ALLOWED'));
  perform perform_ground(w, u, 'prospect', jsonb_build_object('kind', 'tile', 'x', 3, 'y', 3));
  insert into said select 'SAMPLE', e.text from event e where e.world_id = w and e.uid = u and e.text like 'You sample%'
    order by e.n desc limit 1;
  ${hold('Ore Sense')};
  insert into said values ('GOLDSENSE', coalesce(act_refusal(w, u, 'mine', ${FACE}), 'ALLOWED'));
  perform perform_ground(w, u, 'prospect', jsonb_build_object('kind', 'tile', 'x', 3, 'y', 3));
  insert into said select 'SAMPLESENSE', e.text from event e where e.world_id = w and e.uid = u and e.text like 'You sample%'
    order by e.n desc limit 1;
  perform land_set_rock(w, 3, 3, 0);

  /* ---- Far Reader: Prospect's reach, out of what it says. ---- */
  insert into skill (world_id, uid, id, value) values (w, u, 'prospecting', 0)
    on conflict (world_id, uid, id) do update set value = 0;
  perform pg_temp.hold(w, u, '{}');
  perform perform_ground(w, u, 'prospect', jsonb_build_object('kind', 'tile', 'x', 3, 'y', 3));
  insert into said select 'REACH', e.text from event e where e.world_id = w and e.uid = u
    and (e.text like 'Within %' or e.text like 'You read the ground %') order by e.n desc limit 1;
  update skill set value = 0 where world_id = w and uid = u and id = 'prospecting';
  ${hold('Far Reader')};
  perform perform_ground(w, u, 'prospect', jsonb_build_object('kind', 'tile', 'x', 3, 'y', 3));
  insert into said select 'REACHED', e.text from event e where e.world_id = w and e.uid = u
    and (e.text like 'Within %' or e.text like 'You read the ground %') order by e.n desc limit 1;

  /* ---- Wet Work: the face at fifteen deep. ---- */
  perform land_set_height(w, 4, 4, -15);
  perform pg_temp.hold(w, u, '{}');
  insert into said values ('WET', coalesce(act_refusal(w, u, 'mine', ${FACE}), 'ALLOWED')
    || '|' || coalesce(act_refusal(w, u, 'chip_corner', ${FACE}), 'ALLOWED'));
  ${hold('Wet Work')};
  insert into said values ('WETTER', coalesce(act_refusal(w, u, 'mine', ${FACE}), 'ALLOWED')
    || '|' || coalesce(act_refusal(w, u, 'chip_corner', ${FACE}), 'ALLOWED'));
  perform land_set_height(w, 4, 4, 40);

  /* ---- Quick Pick: the time a go of Mine is started with. ---- */
  update skill set value = 1 where world_id = w and uid = u and id = 'mining';
  update item set ql = 1, dmg = 0 where id = v_pick;
  perform pg_temp.hold(w, u, '{}');
  j := rpc_act(w, 'mine', ${FACE});
  select extract(epoch from act_ends - act_started) into v_a from player where world_id = w and uid = u;
  v_t := coalesce(j->>'why', '-');
  update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_goes = null
   where world_id = w and uid = u;
  ${hold('Quick Pick')};
  j := rpc_act(w, 'mine', ${FACE});
  select extract(epoch from act_ends - act_started) into v_b from player where world_id = w and uid = u;
  insert into said values ('TIME', coalesce(v_a::text, 'none') || '|' || coalesce(v_b::text, 'none')
    || '|' || v_t || '|' || coalesce(j->>'why', '-'));
  update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_goes = null
   where world_id = w and uid = u;
  update item set ql = 100, dmg = 0 where id = v_pick;

  /* ---- Sure Swing, with its failures put at nought: no skill, the worst pickaxe. ---- */
  update item set ql = 1 where id = v_pick;
  perform pg_temp.hold(w, u, '{}');
  for k in 1..30 loop
    update skill set value = 0 where world_id = w and uid = u and id = 'mining';
    update item set dmg = 0 where id = v_pick;
    perform perform_terrain(w, u, 'mine', ${FACE});
  end loop;
  n := ${count('rock_shards')};
  ${clear('rock_shards')};
  ${patch('Sure Swing', { 'fail:mine': 0 })};
  ${hold('Sure Swing')};
  for k in 1..30 loop
    update skill set value = 0 where world_id = w and uid = u and id = 'mining';
    update item set dmg = 0 where id = v_pick;
    perform perform_terrain(w, u, 'mine', ${FACE});
  end loop;
  insert into said values ('SWING', n || '|' || ${count('rock_shards')});
  ${clear('rock_shards')};
  update item set ql = 100 where id = v_pick;
  perform land_set_height(w, 4, 4, 40);

  /* ---- Coal Hand: a coal seam's go. ---- */
  perform land_set_rock(w, 3, 3, 5);
  perform pg_temp.hold(w, u, '{}');
  ${until(mine, `${count('coal')} > 0`)}
  v_t := ${count('coal')}::text;
  ${clear('coal')};
  ${hold('Coal Hand')};
  ${until(mine, `${count('coal')} > 0`)}
  insert into said values ('COAL', v_t || '|' || ${count('coal')});
  ${clear('coal')};
  perform land_set_rock(w, 3, 3, 0);

  /* ---- Rich Seam and Rare Ore, their chances put at one. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${until(mine, `${count('rock_shards')} > 0`)}
  v_t := ${count('rock_shards')} || ':' || coalesce((select string_agg(coalesce(rare, 'plain'), ',') from item
    where world_id = w and holder = 'player' and holder_uid = u and def = 'rock_shards'), 'none');
  ${clear('rock_shards')};
  ${patch('Rich Seam', { 'more:mine': 1 })};
  ${hold('Rich Seam')};
  ${until(mine, `${count('rock_shards')} > 0`)}
  v_u := ${count('rock_shards')}::text;
  ${clear('rock_shards')};
  ${patch('Rare Ore', { 'rare:mine': 1 })};
  ${hold('Rare Ore')};
  ${until(mine, `${count('rock_shards')} > 0`)}
  insert into said select 'SEAM', v_t || '|' || v_u || '|' || coalesce((select string_agg(coalesce(rare, 'plain'), ',')
    from item where world_id = w and holder = 'player' and holder_uid = u and def = 'rock_shards'), 'none');
  ${clear('rock_shards')};

  /* ---- Gem Eye and Treasure in the Rock: none without, one a go with, at one. ---- */
  create or replace function gem_odds() returns double precision language sql immutable as 'select 0::double precision';
  create or replace function map_odds() returns double precision language sql immutable as 'select 0::double precision';
  -- Nothing left over from the goes before, and the miner off every settlement:
  -- a map is never buried on one, and a map with nowhere to point is no map.
  ${clear('gem', 'treasure_map')};
  update player set x = 12.5, y = 7.5 where world_id = w and uid = u;
  perform pg_temp.hold(w, u, '{}');
  ${until(mine, `${count('rock_shards')} > 0`)}
  v_t := ${count('gem')} || ',' || ${count('treasure_map')};
  ${clear('rock_shards')};
  ${patch('Gem Eye', { 'gem:mine': 1 })};
  ${patch('Treasure in the Rock', { 'map:mine': 1 })};
  ${hold('Gem Eye', 'Treasure in the Rock')};
  ${until(mine, `${count('rock_shards')} > 0`)}
  insert into said values ('FINDS2', v_t || '|' || ${count('gem')} || ',' || ${count('treasure_map')});
  ${clear('rock_shards', 'gem', 'treasure_map')};
  update player set x = 3.5, y = 3.5 where world_id = w and uid = u;

  /* ---- Ore Cart: a chest of the miner's four tiles off. ---- */
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'chest', 7, 3, 0, 0, 7.5, 3.5, 40, 'Pine', u) returning id into v_chest;
  perform pg_temp.hold(w, u, '{}');
  ${until(mine, `${count('rock_shards')} > 0`)}
  v_t := ${count('rock_shards')} || ',' || (select coalesce(sum(count), 0) from item where placed = v_chest);
  ${clear('rock_shards')};
  ${hold('Ore Cart')};
  ${until(mine, `(select coalesce(sum(count), 0) from item where placed = v_chest) > 0`)}
  insert into said select 'CART', v_t || '|' || ${count('rock_shards')} || ','
    || (select coalesce(sum(count), 0) from item where placed = v_chest);
  delete from item where placed = v_chest;

  /* ---- Rock Slide, with the face made to drop every go. ---- */
  create or replace function mine_collapse() returns double precision language sql immutable as 'select 1::double precision';
  perform pg_temp.hold(w, u, '{}');
  ${until(mine, `${count('rock_shards')} > 0`)}
  v_t := ${count('rock_shards')}::text;
  ${clear('rock_shards')};
  ${hold('Rock Slide')};
  ${until(mine, `${count('rock_shards')} > 0`)}
  insert into said values ('SLIDE', v_t || '|' || ${count('rock_shards')});
  ${clear('rock_shards')};
  perform land_set_height(w, 4, 4, 40);

  /* ---- Chipper, at one, and Face Shaper's two steps, stopped at a level. ---- */
  perform pg_temp.hold(w, u, '{}');
  for k in 1..20 loop perform perform_terrain(w, u, 'chip_corner', ${FACE}); end loop;
  v_t := (40 - land_height(w, 4, 4))::text;
  perform land_set_height(w, 4, 4, 40);
  ${patch('Chipper', { 'chip:chance': 1 })};
  ${hold('Chipper')};
  for k in 1..20 loop perform perform_terrain(w, u, 'chip_corner', ${FACE}); end loop;
  v_t := v_t || '|' || (40 - land_height(w, 4, 4));
  perform land_set_height(w, 4, 4, 40);
  ${hold('Chipper', 'Face Shaper')};
  perform perform_terrain(w, u, 'chip_corner', ${FACE});
  v_t := v_t || '|' || (40 - land_height(w, 4, 4));
  update player set level_h = land_height(w, 4, 4) - 1 where world_id = w and uid = u;
  perform perform_terrain(w, u, 'chip_corner', ${FACE});
  insert into said values ('CHIP', v_t || '|' || (land_height(w, 4, 4) - (select level_h from player where world_id = w and uid = u)));
  update player set level_h = null where world_id = w and uid = u;
  perform land_set_height(w, 4, 4, 40);
  ${clear('rock_shards')};

  /* ---- The trowel, at no skill with the worst trowel. ---- */
  update player set x = 8.5, y = 8.5 where world_id = w and uid = u;
  insert into skill (world_id, uid, id, value) values (w, u, 'archaeology', 0)
    on conflict (world_id, uid, id) do update set value = 0;
  perform give(w, u, 'trowel', 1, 1);
  perform pg_temp.hold(w, u, '{}');
  v_e := ${told('You go through the soil and turn up nothing%')};
  for k in 1..20 loop
    update skill set value = 0 where world_id = w and uid = u and id = 'archaeology';
    perform perform_dig(w, u, 'investigate', jsonb_build_object('kind', 'tile', 'x', 8, 'y', 8));
  end loop;
  v_t := (${told('You go through the soil and turn up nothing%')} - v_e)::text;
  ${patch('Keen Trowel', { 'find:investigate': 1, 'cap:investigate': 1 })};
  ${hold('Keen Trowel')};
  v_e := ${told('You go through the soil and turn up nothing%')};
  for k in 1..20 loop
    update skill set value = 0 where world_id = w and uid = u and id = 'archaeology';
    perform perform_dig(w, u, 'investigate', jsonb_build_object('kind', 'tile', 'x', 8, 'y', 8));
  end loop;
  insert into said values ('TROWEL', v_t || '|' || (${told('You go through the soil and turn up nothing%')} - v_e));

  -- Bauble Hunter, every find a find, the Bauble of Regret's share put at nought.
  create or replace function regret_share() returns double precision language sql immutable as 'select 0::double precision';
  ${clear('tarnished_bauble', 'fragment', 'bauble_regret')};
  for k in 1..10 loop perform perform_dig(w, u, 'investigate', jsonb_build_object('kind', 'tile', 'x', 8, 'y', 8)); end loop;
  v_t := ${count('tarnished_bauble')}::text;
  ${clear('tarnished_bauble', 'fragment')};
  ${patch('Bauble Hunter', { 'share:bauble': 1 })};
  ${hold('Keen Trowel', 'Bauble Hunter')};
  for k in 1..10 loop perform perform_dig(w, u, 'investigate', jsonb_build_object('kind', 'tile', 'x', 8, 'y', 8)); end loop;
  insert into said values ('BAUBLES', v_t || '|' || ${count('tarnished_bauble')});
  ${clear('tarnished_bauble', 'fragment')};

  -- Pieces that Fit: a relic far past the skill, begun, and every find a relic.
  create or replace function bauble_share() returns double precision language sql immutable as 'select 0::double precision';
  perform give(w, u, 'fragment', 1, 50, ${q(`${RELIC} 1/`)} || (select parts from relic_def where name = ${q(RELIC)}));
  ${hold('Keen Trowel')};
  perform perform_dig(w, u, 'investigate', jsonb_build_object('kind', 'tile', 'x', 8, 'y', 8));
  v_t := (select count(*) from item where world_id = w and holder = 'player' and holder_uid = u and def = 'fragment'
          and fragment_relic(extra) = ${q(RELIC)})::text;
  -- Only the one relic begun, so that the piece the perk brings can only be of it.
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'fragment'
    and fragment_relic(extra) <> ${q(RELIC)};
  ${patch('Pieces that Fit', { 'fit:relic': 1 })};
  ${hold('Keen Trowel', 'Pieces that Fit')};
  perform perform_dig(w, u, 'investigate', jsonb_build_object('kind', 'tile', 'x', 8, 'y', 8));
  insert into said select 'FIT', v_t || '|' || count(*) || '|' || count(distinct fragment_part(extra))
    from item where world_id = w and holder = 'player' and holder_uid = u and def = 'fragment'
     and fragment_relic(extra) = ${q(RELIC)};
  ${clear('fragment', 'trowel')};

  /* ---- Pan: asked, and done, at one. ---- */
  perform pg_temp.hold(w, u, '{}');
  insert into said values ('PAN_NO', coalesce(act_refusal(w, u, 'pan', jsonb_build_object('kind', 'tile', 'x', 8, 'y', 8)), 'ALLOWED'));
  ${hold('Pan')};
  insert into said values ('PAN_DIRT', coalesce(act_refusal(w, u, 'pan', jsonb_build_object('kind', 'tile', 'x', 8, 'y', 8)), 'ALLOWED'));
  perform land_set_tile(w, 8, 8, tile_id('Sand'));
  insert into said values ('PAN_DRY', coalesce(act_refusal(w, u, 'pan', jsonb_build_object('kind', 'tile', 'x', 8, 'y', 8)), 'ALLOWED'));
  perform land_set_height(w, 9, 9, -2);
  insert into said values ('PAN_YES', coalesce(act_refusal(w, u, 'pan', jsonb_build_object('kind', 'tile', 'x', 8, 'y', 8)), 'ALLOWED'));
  perform pg_temp.hold(w, u, '{}');
  perform pg_temp.go(w, u, 'pan', jsonb_build_object('kind', 'tile', 'x', 8, 'y', 8));
  v_t := (select count(*) from item i join pan_ore o on o.item = i.def
           where i.world_id = w and i.holder = 'player' and i.holder_uid = u)::text;
  ${patch('Pan', { pan: 1 })};
  ${hold('Pan')};
  perform pg_temp.go(w, u, 'pan', jsonb_build_object('kind', 'tile', 'x', 8, 'y', 8));
  insert into said select 'PANNED', v_t || '|' || count(*) || '|' || coalesce(string_agg(i.def, ','), 'none')
    from item i join pan_ore o on o.item = i.def where i.world_id = w and i.holder = 'player' and i.holder_uid = u;
end $$;

select k || E'\\t' || coalesce(v, 'null') from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const at = l.indexOf('\t');
  return [l.slice(0, at), l.slice(at + 1)] as [string, string];
}));
const say = (k: string): string => said.get(k) ?? '(nothing)';

/* ---- the rulebook ------------------------------------------------------------ */

check('a turn of the trowel finds on the same numbers on both sides',
  say('FINDS') === [FIND_BASE, FIND_PER_SKILL, FIND_PER_TOOL, FIND_CAP].join('|'), say('FINDS'));
const island = say('CHANCES').split(',').map(Number);
const browser = [[0, 0, 0, 0.7], [50, 50, 0, 0.7], [100, 100, 0, 0.7], [50, 50, 0.15, 0.85], [100, 100, 0.15, 0.85]]
  .map(([s, t, m, c]) => findChance(s, t, m, c));
check('and the same chance comes of them, with a perk and without', island.length === browser.length
  && island.every((v, i) => near(v, browser[i], 1e-8)), `island ${island.join(', ')}; browser ${browser.join(', ')}`);
check('the pan washes out the same ores', say('PANORES') === [...PAN_ORES].sort().join(','), say('PANORES'));
const pan = ACTION_BY_ID.get('pan')!;
check('and Pan is a job on both sides, and ported', say('PANJOB') === `${pan.baseTime}|${pan.skill}|-|${pan.stamina}|true`, say('PANJOB'));
const passed = Number(say('PASS'));
check('a failure passed at a perk\'s rate passes about that share', Math.abs(passed / 4000 - 0.5) < 0.05, `${passed} of 4000 at a half`);

/* ---- the face ------------------------------------------------------------------ */

const below = P('Ore Sense').fx['ore:below'];
check(`${P('Ore Sense').name}: a gold vein wants mining 50 without it`,
  say('GOLD') === 'Gold vein needs mining 50 to work. Yours is 45.0.', say('GOLD'));
check(`and ${50 - below} with it, so 45 works it`, say('GOLDSENSE') === 'ALLOWED', say('GOLDSENSE'));
check('and Prospect\'s sample says the mining it wants of you',
  say('SAMPLE').includes('It needs mining 50 to work,') && say('SAMPLESENSE').includes(`It needs mining ${50 - below} to work, which you have,`),
  `${say('SAMPLE')} / ${say('SAMPLESENSE')}`);
const reach = (s: string): number => Number(s.match(/(\d+) tiles/)?.[1] ?? NaN);
check(`${P('Far Reader').name}: Prospect reads ${P('Far Reader').fx['further:prospect']} tiles further`,
  reach(say('REACH')) === prospectRadius(0) && reach(say('REACHED')) === prospectRadius(0) + P('Far Reader').fx['further:prospect'],
  `${reach(say('REACH'))} then ${reach(say('REACHED'))}`);
const deep = 'The water is too deep here to work in.';
check(`${P('Wet Work').name}: a face at fifteen deep is refused to Mine and Chip corner without it`,
  say('WET') === `${deep}|${deep}`, say('WET'));
check(`and worked with it, to ${P('Wet Work').fx['depth:mine']}`, say('WETTER') === 'ALLOWED|ALLOWED', say('WETTER'));
const [tA, tB, tWhyA, tWhyB] = say('TIME').split('|');
check(`${P('Quick Pick').name}: a go of Mine is started with ${P('Quick Pick').fx['time:mine']} of the time`,
  tWhyA === '-' && tWhyB === '-' && near(Number(tB) / Number(tA), P('Quick Pick').fx['time:mine'], 1e-5),
  `${tA} s, then ${tB} s${tWhyA !== '-' ? `; ${tWhyA}` : ''}${tWhyB !== '-' ? `; ${tWhyB}` : ''}`);
const [swingA, swingB] = say('SWING').split('|').map(Number);
check(`${P('Sure Swing').name}: thirty swings at no skill with the worst pick all come off with its failures at nought, and not without`,
  swingB === 30 && swingA < 30, `${swingA} of 30 without, ${swingB} of 30 with`);
check(`${P('Coal Hand').name}: a coal seam gives ${P('Coal Hand').fx['count:coal']} coal a go with it, one without`,
  say('COAL') === `1|${P('Coal Hand').fx['count:coal']}`, say('COAL'));
const [seamA, seamB, rareB] = say('SEAM').split('|');
check(`${P('Rich Seam').name}: a go at its chance brings up one more, and a plain go one`,
  seamA === '1:plain' && seamB === '2', `${seamA} / ${seamB}`);
check(`${P('Rare Ore').name}: a go at its chance brings it up rare, where nothing mined is rare without it`,
  ['rare', 'supreme', 'fantastic'].includes(rareB) && seamA.endsWith(':plain'), `${seamA} / ${rareB}`);
check(`${P('Gem Eye').name} and ${P('Treasure in the Rock').name}: a go at their odds finds a gem and a map, and at the rule's none`,
  say('FINDS2') === '0,0|1,1', say('FINDS2'));
check(`${P('Ore Cart').name}: what Mine brings up goes into a chest of the miner's four tiles off with it, the pack without`,
  say('CART') === '1,0|0,1', say('CART'));
check(`${P('Rock Slide').name}: when the face drops, ${P('Rock Slide').fx['slide:more']} more come down with it`,
  say('SLIDE') === `1|${1 + P('Rock Slide').fx['slide:more']}`, say('SLIDE'));
const [chipA, chipB, shaped, stopped] = say('CHIP').split('|').map(Number);
check(`${P('Chipper').name}: twenty chips at its chance take the corner down twenty, and fewer at the rule's`,
  chipB === 20 && chipA < 20, `${chipA} then ${chipB}`);
check(`${P('Face Shaper').name}: a chip that works drops ${P('Face Shaper').fx['chip:step']} steps, and stops at a level taken`,
  shaped === P('Face Shaper').fx['chip:step'] && stopped === 0, `${shaped} steps; ${stopped} over the level`);

/* ---- the trowel ------------------------------------------------------------------ */

const [emptyA, emptyB] = say('TROWEL').split('|').map(Number);
check(`${P('Keen Trowel').name}: at its chance every turn finds something, and at no skill most find nothing`,
  emptyB === 0 && emptyA > 10, `${emptyA} of 20 empty without, ${emptyB} of 20 with`);
const [baublesA, baublesB] = say('BAUBLES').split('|').map(Number);
check(`${P('Bauble Hunter').name}: at its share every find is a tarnished bauble, and not without`,
  baublesB === 10 && baublesA < 10, `${baublesA} of 10 without, ${baublesB} of 10 with`);
const [fitA, fitB, fitParts] = say('FIT').split('|').map(Number);
check(`${P('Pieces that Fit').name}: a relic too hard to find at no skill comes up, a piece of it you are missing, with it and not without`,
  fitA === 1 && fitB === 2 && fitParts === 2, say('FIT'));

/* ---- Pan -------------------------------------------------------------------------- */

check('Pan is refused without the perk, in the island\'s words', say('PAN_NO') === 'That wants a Miner who has learned to pan.', say('PAN_NO'));
check('and anywhere but sand', say('PAN_DIRT') === 'Panning is done on sand.', say('PAN_DIRT'));
check('and on sand with no water at a corner', say('PAN_DRY') === 'There is no water at this sand to wash it in.', say('PAN_DRY'));
check('and allowed on sand with water at a corner', say('PAN_YES') === 'ALLOWED', say('PAN_YES'));
const [panA, panB, panned] = say('PANNED').split('|');
check('a go at its chance washes out one of the pan\'s ores, and without it nothing',
  panA === '0' && panB === '1' && PAN_ORES.includes(panned), say('PANNED'));

/* ---- the browser's half ------------------------------------------------------------ */

const game = Game.create(2718);
check('the browser asks for the same mining of an ore without the perk', oreNeeds(game, 50) === 50);
game.setPerks({ 'ore:below': below, 'depth:mine': P('Wet Work').fx['depth:mine'], 'further:prospect': P('Far Reader').fx['further:prospect'] });
check('and less with it', oreNeeds(game, 50) === 50 - below && oreNeeds(game, 5) === 0, `${oreNeeds(game, 50)}, ${oreNeeds(game, 5)}`);
check('and works water as deep', mineDepth(game) === P('Wet Work').fx['depth:mine'] && MINE_DEPTH < mineDepth(game), String(mineDepth(game)));
check('and reads as far', prospectReach(game) === prospectRadius(game.skills.get('prospecting')) + P('Far Reader').fx['further:prospect'],
  String(prospectReach(game)));
const px = Math.floor(game.player.x);
const py = Math.floor(game.player.y);
game.world.setTile(px, py, TileType.Sand);
game.world.setHeight(px + 1, py + 1, -2);
const shore = { kind: 'tile' as const, x: px, y: py, cx: px, cy: py };
check('Pan is not offered without the perk', pan.applies?.(shore, game) === false);
game.setPerks({ pan: P('Pan').fx.pan });
check('and is on sand with water at a corner, with it', pan.applies?.(shore, game) === true);
game.world.setTile(px, py, TileType.Dirt);
check('and not on dirt', pan.applies?.(shore, game) === false);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Miner's perks — ${ok.length} of ${ok.length}`);
