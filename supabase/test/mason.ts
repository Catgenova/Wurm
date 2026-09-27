/**
 * The Mason's eighteen perks, each measured where its rule is.
 *
 * `perks.ts` holds the two sides to each other for every trade on perks --
 * the rows, the tiers, the fold, the choosing -- and this asks the one thing
 * that is the Mason's own: that each perk does what its note says, on the
 * island, with the dice taken out wherever they can be. A chance is put at
 * one inside the transaction, or the skill check made to pass or to fail
 * outright, so that a go must show the rule; what is asked is that the rule
 * reads the perk, not that a random number fell a particular way.
 *
 *   * the chisel: Sure Chisel's failures, Three from a Shard's and Good Mix's
 *     count and the line that says it, Nothing Wasted's smelter and kiln, and
 *     Quick Chisel's time;
 *   * the trowel: Quick Mason's time on stone and not on timber, Two at a
 *     Time, Hod Carrier's chest, Salvage, Repoint, and Tall Walls' storeys;
 *   * the rock: Concrete Hand, Double Lift and the level it stops at, Wet
 *     Set, Steep Stone's slope, and Rubble Fill;
 *   * Bridge Mason's time and span, and Brick Porter's weight;
 *   * and the browser reads the same numbers where it asks or offers them.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, rockRaiseRefusal } from '../../src/game/actions';
import { layingBill, materialName, REPOINT_BACK, REPOINT_TIME } from '../../src/game/buildActions';
import { describeNeeds, MATERIAL_BY_ID, MAX_LEVELS, TALL_STOREYS, TOP_LEVELS } from '../../src/game/building';
import { BRIDGES } from '../../src/game/bridges';
import { ITEM_DEFS } from '../../src/game/items';
import { perksOf, type PerkDef } from '../../src/game/perks';
import { numberWord } from '../../src/game/words';

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
const near = (a: number, b: number, by = 1e-5): boolean => Math.abs(a - b) <= by * Math.max(1, Math.abs(b));

const MASON = perksOf('mason');
const P = (name: string): PerkDef => {
  const p = MASON.find((x) => x.name === name);
  if (!p) throw new Error(`the Mason has no perk called ${name}`);
  return p;
};
const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const hold = (...names: string[]): string =>
  `perform pg_temp.hold(w, u, array[${names.map((n) => q(P(n).id)).join(', ')}]::text[])`;
/** A perk's number put where a go must show it, for the length of the transaction. */
const patch = (name: string, fx: Record<string, number>): string =>
  `update class_perk set fx = fx || ${q(JSON.stringify(fx))}::jsonb where id = ${q(P(name).id)}`;
const count = (def: string): string =>
  `(select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = '${def}')`;
const clear = (...defs: string[]): string =>
  `delete from item where world_id = w and holder = 'player' and holder_uid = u and def in (${defs.map(q).join(', ')})`;
const last = (like: string): string =>
  `(select e.text from event e where e.world_id = w and e.uid = u and e.text like ${q(like)} order by e.n desc limit 1)`;
/** Every skill check passes, or every one fails, until it is said otherwise. */
const checks = (pass: boolean): string =>
  `create or replace function skill_check(p_skill double precision, p_difficulty double precision,
     p_tool_ql double precision default 0, p_ease double precision default 0)
     returns boolean language sql as 'select ${pass}'`;
/** A wall of `mat` on a side of the building's tile at 9,9, planned and, if `done`, finished. */
const wall = (side: string, mat: string, done: boolean): string => `
  delete from wall w2 using border_of(9, 9, '${side}') bd
   where w2.world_id = w and w2.level = 0 and w2.dir = bd.dir and w2.x = bd.x and w2.y = bd.y;
  insert into wall (world_id, level, dir, x, y, building, type, material, needed, total, planned_by)
  select w, 0, bd.dir, bd.x, bd.y, v_b, 'solid', '${mat}',
         ${done ? `(select jsonb_object_agg(jk, 0) from jsonb_object_keys(wall_bill('${mat}', 'solid')) jk)` : `wall_bill('${mat}', 'solid')`},
         wall_bill('${mat}', 'solid'), u
    from border_of(9, 9, '${side}') bd`;
const side = (s: string): string => `jsonb_build_object('kind', 'tile', 'x', 9, 'y', 9, 'side', '${s}')`;
const needed = (s: string, item: string): string => `coalesce(((wall_at(w, 9, 9, '${s}')).needed->>'${item}')::int, -1)`;
/** The corner at 4,4 of the rock face at 2..4. */
const CORNER = `jsonb_build_object('kind', 'tile', 'x', 3, 'y', 3, 'cx', 4, 'cy', 4)`;
const height = 'land_height(w, 4, 4)';
const refused = (action: string, target: string): string => `coalesce(act_refusal(w, u, '${action}', ${target}), 'ALLOWED')`;

const out = psql(`
begin;
-- Nothing made or restored here comes up rare at the plain odds, one in a hundred, which is
-- what a craft or a restoring rolls with no perk to set them: a rare one is a pile of its own
-- and holds, wears and is marked otherwise, so a check that was not asking about it failed a
-- run in so many (runs 812 and 814). Odds a perk sets are rolled as ever, dice and all.
alter function perk_rare(double precision) rename to perk_rare_rolled;
create function perk_rare(p_chance double precision) returns text language sql volatile as $plain$
  select case when p_chance is distinct from (select d.odds from rarity_def d order by d.ord limit 1)
              then perk_rare_rolled(p_chance) end
$plain$;
create temp table said (k text, v text);

/* The rulebook's side of what the Mason reads. */
insert into said select 'CONSTS', max_levels() || '|' || top_levels() || '|' || repoint_back();
insert into said select 'JOBS', string_agg(id || ':' || base_time || ':' || skill || ':' || coalesce(tool, '-')
  || ':' || coalesce(difficulty::text, '-') || ':' || act_ported(id), ',' order by id)
  from action_def where id in ('repoint_wall', 'rubble_fill');

create function pg_temp.hold(w uuid, u uuid, ids text[]) returns jsonb language plpgsql as $f$
begin
  delete from player_node where world_id = w and uid = u;
  insert into player_node (world_id, uid, node) select w, u, x from unnest(ids) x;
  return class_fold(w, u);
end $f$;
/* How long a go of a job is started with: asked of the doors, then put down again. */
create function pg_temp.secs(w uuid, u uuid, a text, t jsonb) returns text language plpgsql as $f$
declare j jsonb; v double precision;
begin
  update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null,
         act_goes = null, act_queue = '[]' where world_id = w and uid = u;
  j := rpc_act(w, a, t);
  select extract(epoch from act_ends - act_started) into v from player where world_id = w and uid = u;
  update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null,
         act_goes = null, act_queue = '[]' where world_id = w and uid = u;
  return coalesce(v::text, 'none') || ':' || coalesce(j->>'why', '-');
end $f$;

do $$
declare w uuid; u uuid; tx int; ty int; v_b int; v_shard bigint; v_chest bigint; v_t text; v_u text; n int; k int;
        v_mul jsonb; v_a double precision; v_arch bigint; v_wood bigint;
begin
  -- The suite's own island and its first body, who founded Lambfold and may shape it.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  for tx in 0..15 loop for ty in 0..15 loop
    perform land_set_height(w, tx, ty, 40); perform land_set_dirt(w, tx, ty, 20);
    perform land_set_tile(w, tx, ty, tile_id('Dirt')); perform land_set_data(w, tx, ty, 0);
  end loop; end loop;
  -- A face of bare rock at 2..4, worked from its 4,4 corner.
  for tx in 2..4 loop for ty in 2..4 loop
    perform land_set_tile(w, tx, ty, 4); perform land_set_rock(w, tx, ty, 0);
  end loop; end loop;
  for tx in 2..5 loop for ty in 2..5 loop perform land_set_dirt(w, tx, ty, 0); end loop; end loop;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  delete from player_node where world_id = w and uid = u;
  delete from caller where uid = u;
  update placed set driver = null where world_id = w and driver = u;
  update placed set puller = null where world_id = w and puller = u;
  update player set x = 4.5, y = 4.5, act = null, act_target = null, act_started = null, act_ends = null,
         act_left = null, act_goes = null, act_queue = '[]', craft_class = 'mason', combat_class = null,
         class_mul = null, level_h = null, rested = 0, boons = '[]'::jsonb, body_at = now(), swim_at = now(),
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
   where world_id = w and uid = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  insert into skill (world_id, uid, id, value)
    select w, u, s, 60 from unnest(array['masonry', 'stonecutting', 'carpentry', 'paving']) s
    on conflict (world_id, uid, id) do update set value = excluded.value;
  perform give(w, u, 'chisel', 1, 100);
  perform give(w, u, 'trowel', 1, 100);
  perform give(w, u, 'mallet', 1, 100);

  /* ---- Sure Chisel, with its failures put at nought: no skill, the worst chisel. ---- */
  update item set ql = 1 where world_id = w and holder = 'player' and holder_uid = u and def = 'chisel';
  update skill set value = 0 where world_id = w and uid = u and id = 'stonecutting';
  perform pg_temp.hold(w, u, '{}');
  v_shard := give(w, u, 'rock_shards', 30, 30);
  for k in 1..30 loop
    update skill set value = 0 where world_id = w and uid = u and id = 'stonecutting';
    perform perform_craft(w, u, 'make_stone_brick', jsonb_build_object('kind', 'item', 'uid', v_shard));
  end loop;
  v_t := ${count('stone_brick')}::text;
  ${clear('stone_brick', 'rock_shards')};
  ${patch('Sure Chisel', { 'fail:make_stone_brick': 0 })};
  ${hold('Sure Chisel')};
  v_shard := give(w, u, 'rock_shards', 30, 30);
  for k in 1..30 loop
    update skill set value = 0 where world_id = w and uid = u and id = 'stonecutting';
    perform perform_craft(w, u, 'make_stone_brick', jsonb_build_object('kind', 'item', 'uid', v_shard));
  end loop;
  insert into said values ('CHISEL', v_t || '|' || ${count('stone_brick')});
  ${clear('stone_brick', 'rock_shards')};
  update item set ql = 100 where world_id = w and holder = 'player' and holder_uid = u and def = 'chisel';
  update skill set value = 60 where world_id = w and uid = u and id = 'stonecutting';

  /* ---- Nothing Wasted: a kiln that fails, its bricks and mortar kept with it and lost without. ---- */
  ${checks(false)};
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'stone_brick', 24, 30); perform give(w, u, 'mortar', 8, 30);
  perform perform_craft(w, u, 'make_kiln', '{}'::jsonb);
  v_t := ${count('stone_brick')} || ',' || ${count('mortar')};
  ${clear('stone_brick', 'mortar')};
  ${hold('Nothing Wasted')};
  perform give(w, u, 'stone_brick', 24, 30); perform give(w, u, 'mortar', 8, 30);
  perform perform_craft(w, u, 'make_kiln', '{}'::jsonb);
  insert into said values ('KILN', v_t || '|' || ${count('stone_brick')} || ',' || ${count('mortar')}
    || '|' || coalesce(${last('Nothing that went into it%')}, 'unsaid'));
  ${clear('stone_brick', 'mortar', 'kiln')};

  /* ---- From here every check passes: what is measured is what a go makes. ---- */
  ${checks(true)};

  /* ---- Three from a Shard: a go of Chisel stone brick, and what it says. ---- */
  perform pg_temp.hold(w, u, '{}');
  v_shard := give(w, u, 'rock_shards', 1, 30);
  perform perform_craft(w, u, 'make_stone_brick', jsonb_build_object('kind', 'item', 'uid', v_shard));
  v_t := ${count('stone_brick')} || ':' || coalesce(${last('You chisel % stone bricks%')}, 'unsaid');
  ${clear('stone_brick')};
  ${hold('Three from a Shard')};
  v_shard := give(w, u, 'rock_shards', 1, 30);
  perform perform_craft(w, u, 'make_stone_brick', jsonb_build_object('kind', 'item', 'uid', v_shard));
  insert into said values ('SHARD', v_t || '|' || ${count('stone_brick')} || ':' || coalesce(${last('You chisel % stone bricks%')}, 'unsaid'));
  ${clear('stone_brick', 'rock_shards')};

  /* ---- Good Mix: a go of Mix concrete. ---- */
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'mortar', 1, 30); perform give(w, u, 'ash', 1, 30);
  perform perform_craft(w, u, 'mix_concrete', '{}'::jsonb);
  v_t := ${count('concrete')}::text;
  ${clear('concrete', 'mortar', 'ash')};
  ${hold('Good Mix')};
  perform give(w, u, 'mortar', 1, 30); perform give(w, u, 'ash', 1, 30);
  perform perform_craft(w, u, 'mix_concrete', '{}'::jsonb);
  insert into said values ('MIX', v_t || '|' || ${count('concrete')});
  ${clear('concrete', 'mortar', 'ash')};

  /* ---- Quick Chisel: the time a go of Chisel stone brick is started with, at no skill. ---- */
  update skill set value = 1 where world_id = w and uid = u and id = 'stonecutting';
  v_shard := give(w, u, 'rock_shards', 5, 30);
  perform pg_temp.hold(w, u, '{}');
  v_t := pg_temp.secs(w, u, 'make_stone_brick', jsonb_build_object('kind', 'item', 'uid', v_shard));
  ${hold('Quick Chisel')};
  insert into said values ('CHISELTIME', v_t || '|' || pg_temp.secs(w, u, 'make_stone_brick', jsonb_build_object('kind', 'item', 'uid', v_shard)));
  ${clear('rock_shards')};
  update skill set value = 60 where world_id = w and uid = u and id = 'stonecutting';

  /* ---- Brick Porter: what ten stone bricks come to in the pack. ---- */
  perform pg_temp.hold(w, u, '{}');
  v_a := carried_weight(w, u);
  perform give(w, u, 'stone_brick', 10, 30);
  v_t := (carried_weight(w, u) - v_a)::text;
  ${hold('Brick Porter')};
  insert into said values ('PORTER', v_t || '|' || (carried_weight(w, u) - v_a));
  ${clear('stone_brick')};

  /* ---- A building of the Mason's at 9,9 and 10,9, on their own Lambfold. ---- */
  update player set x = 9.5, y = 9.5 where world_id = w and uid = u;
  select coalesce(max(id), 0) + 1 into v_b from building where world_id = w;
  insert into building (world_id, id, name, planned_by) values (w, v_b, 'Tower', u);
  insert into building_tile (world_id, building, x, y) values (w, v_b, 9, 9), (w, v_b, 10, 9);

  /* ---- Quick Mason: a go of Build wall on stone, and on timber. ---- */
  ${wall('n', 'stone_brick', false)};
  ${wall('w', 'log', false)};
  perform give(w, u, 'stone_brick', 4, 30); perform give(w, u, 'log', 2, 30);
  perform pg_temp.hold(w, u, '{}');
  v_t := pg_temp.secs(w, u, 'build_wall', ${side('n')}) || '|' || pg_temp.secs(w, u, 'build_wall', ${side('w')});
  ${hold('Quick Mason')};
  insert into said values ('MASONTIME', v_t || '|' || pg_temp.secs(w, u, 'build_wall', ${side('n')})
    || '|' || pg_temp.secs(w, u, 'build_wall', ${side('w')}));
  ${clear('stone_brick', 'log')};

  /* ---- Two at a Time: one go of Build wall on stone, and what it says. ---- */
  ${wall('n', 'stone_brick', false)};
  perform give(w, u, 'stone_brick', 10, 30);
  perform pg_temp.hold(w, u, '{}');
  perform perform_building(w, u, 'build_wall', ${side('n')});
  v_t := (24 - ${needed('n', 'stone_brick')})::text;
  ${hold('Two at a Time')};
  perform perform_building(w, u, 'build_wall', ${side('n')});
  insert into said values ('LAY', v_t || '|' || (24 - ${needed('n', 'stone_brick')} - v_t::int)
    || '|' || coalesce(${last('You fit % into the wall.%')}, 'unsaid'));
  ${clear('stone_brick')};

  /* ---- Hod Carrier: nothing in the pack, five bricks in a chest of the Mason's three tiles off. ---- */
  ${wall('n', 'stone_brick', false)};
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'chest', 12, 9, 0, 0, 12.5, 9.5, 40, 'Pine', u) returning id into v_chest;
  perform furniture_add(w, v_chest, 'stone_brick', 5, 30, null);
  perform pg_temp.hold(w, u, '{}');
  v_t := ${refused('build_wall', side('n'))};
  ${hold('Hod Carrier')};
  v_u := ${refused('build_wall', side('n'))};
  perform perform_building(w, u, 'build_wall', ${side('n')});
  insert into said values ('HOD', v_t || '|' || v_u || '|'
    || (select coalesce(sum(count), 0) from item where placed = v_chest) || '|' || (24 - ${needed('n', 'stone_brick')}));
  delete from item where placed = v_chest;
  delete from placed where id = v_chest;

  /* ---- Salvage: a finished stone-brick wall taken down, and what comes back. ---- */
  ${wall('s', 'stone_brick', true)};
  perform pg_temp.hold(w, u, '{}');
  perform perform_building(w, u, 'remove_wall', ${side('s')});
  v_t := ${count('stone_brick')}::text;
  ${wall('s', 'stone_brick', true)};
  ${hold('Salvage')};
  perform perform_building(w, u, 'remove_wall', ${side('s')});
  insert into said values ('SALVAGE', v_t || '|' || ${count('stone_brick')} || '|' || coalesce(${last('You take down the wall%')}, 'unsaid'));
  ${clear('stone_brick')};

  /* ---- Repoint: a finished stone-brick wall laid again in marble. ---- */
  ${wall('e', 'stone_brick', true)};
  ${wall('w', 'log', true)};
  perform pg_temp.hold(w, u, '{}');
  insert into said values ('RP_NO', ${refused('repoint_wall', `${side('e')} || jsonb_build_object('material', 'marble')`)});
  ${hold('Repoint')};
  insert into said values ('RP_SHORT', ${refused('repoint_wall', `${side('e')} || jsonb_build_object('material', 'marble')`)});
  insert into said values ('RP_SAME', ${refused('repoint_wall', `${side('e')} || jsonb_build_object('material', 'stone_brick')`)});
  insert into said values ('RP_LOG', ${refused('repoint_wall', `${side('w')} || jsonb_build_object('material', 'marble')`)});
  perform give(w, u, 'marble_brick', 32, 30); perform give(w, u, 'mortar', 16, 30);
  insert into said values ('RP_YES', ${refused('repoint_wall', `${side('e')} || jsonb_build_object('material', 'marble')`)});
  perform perform_building(w, u, 'repoint_wall', ${side('e')} || jsonb_build_object('material', 'marble'));
  insert into said select 'RP_DONE', (wall_at(w, 9, 9, 'e')).material || '|' || bill_done((wall_at(w, 9, 9, 'e')).needed)
    || '|' || ((wall_at(w, 9, 9, 'e')).total = wall_bill('marble', 'solid')) || '|' || ${count('marble_brick')}
    || ',' || ${count('mortar')} || ',' || ${count('stone_brick')} || '|' || coalesce(${last('You take the stone brick out%')}, 'unsaid');
  ${clear('stone_brick', 'marble_brick', 'mortar')};

  /* ---- Tall Walls: how tall the stone building may go, and what the doors say at ten. ---- */
  delete from wall where world_id = w and building = v_b;
  ${wall('n', 'stone_brick', true)};
  perform pg_temp.hold(w, u, '{}');
  update building set levels = 10, work_level = 9 where world_id = w and id = v_b;
  v_t := storey_cap(w, v_b) || ',' || ${refused('add_floor', "jsonb_build_object('kind', 'tile', 'x', 9, 'y', 9)")};
  ${hold('Tall Walls')};
  v_u := storey_cap(w, v_b) || ',' || ${refused('add_floor', "jsonb_build_object('kind', 'tile', 'x', 9, 'y', 9)")};
  ${wall('w', 'log', true)};
  update building set levels = 12, work_level = 11 where world_id = w and id = v_b;
  insert into said values ('TALL', v_t || '|' || v_u || '|' || storey_cap(w, v_b) || '|'
    || (select levels from building where world_id = w and id = v_b));
  delete from wall where world_id = w and building = v_b;
  delete from building_tile where world_id = w and building = v_b;
  delete from building where world_id = w and id = v_b;
  update player set x = 4.5, y = 4.5 where world_id = w and uid = u;

  /* ---- Bridge Mason: the time of a go on a stone arch and a wooden bridge, and the span. ---- */
  insert into bridge (world_id, kind, ax, ay, bx, by, height, made_by, level)
    values (w, 'stone', 1, 14, 5, 14, 40, u, 0) returning id into v_arch;
  insert into bridge (world_id, kind, ax, ay, bx, by, height, made_by, level)
    values (w, 'wood', 1, 15, 5, 15, 40, u, 0) returning id into v_wood;
  perform pg_temp.hold(w, u, '{}');
  v_mul := (select class_mul from player where world_id = w and uid = u);
  v_t := perk_time(v_mul, w, 'build_bridge', jsonb_build_object('kind', 'bridge', 'id', v_arch))
    || '#' || perk_time(v_mul, w, 'build_bridge', jsonb_build_object('kind', 'bridge', 'id', v_wood))
    || '#' || bridge_reason(w, u, 'stone', 1, 13, 11, 13);
  ${hold('Bridge Mason')};
  v_mul := (select class_mul from player where world_id = w and uid = u);
  insert into said values ('ARCH', v_t || '|' || perk_time(v_mul, w, 'build_bridge', jsonb_build_object('kind', 'bridge', 'id', v_arch))
    || '#' || perk_time(v_mul, w, 'build_bridge', jsonb_build_object('kind', 'bridge', 'id', v_wood))
    || '#' || coalesce(bridge_reason(w, u, 'stone', 1, 13, 11, 13), 'ALLOWED')
    || '#' || coalesce(bridge_reason(w, u, 'stone', 1, 13, 13, 13), 'ALLOWED'));
  delete from bridge where world_id = w and id in (v_arch, v_wood);

  /* ---- The rock: Concrete Hand with every check failing. ---- */
  ${checks(false)};
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'concrete', 2, 30);
  n := ${height};
  perform perform_ground(w, u, 'raise_rock', ${CORNER});
  v_t := (${height} - n) || ',' || ${count('concrete')};
  ${hold('Concrete Hand')};
  n := ${height};
  perform perform_ground(w, u, 'raise_rock', ${CORNER});
  insert into said values ('HAND', v_t || '|' || (${height} - n) || ',' || ${count('concrete')});
  ${clear('concrete')};
  perform land_set_height(w, 4, 4, 40);
  ${checks(true)};

  /* ---- Double Lift: two steps a concrete, and one where the level stands a step up. ---- */
  perform give(w, u, 'concrete', 3, 30);
  perform pg_temp.hold(w, u, '{}');
  n := ${height};
  perform perform_ground(w, u, 'raise_rock', ${CORNER});
  v_t := (${height} - n)::text;
  perform land_set_height(w, 4, 4, 40);
  ${hold('Double Lift')};
  n := ${height};
  perform perform_ground(w, u, 'raise_rock', ${CORNER});
  v_u := (${height} - n) || ',' || coalesce(${last('You lay concrete on the%')}, 'unsaid');
  perform land_set_height(w, 4, 4, 40);
  update player set level_h = 41 where world_id = w and uid = u;
  n := ${height};
  perform perform_ground(w, u, 'raise_rock', ${CORNER});
  insert into said values ('LIFT', v_t || '|' || v_u || '|' || (${height} - n));
  update player set level_h = null where world_id = w and uid = u;
  perform land_set_height(w, 4, 4, 40);
  ${clear('concrete')};

  /* ---- Wet Set: the corner under five of water, and under fifteen. ---- */
  perform give(w, u, 'concrete', 1, 30);
  for tx in 3..5 loop for ty in 3..5 loop perform land_set_height(w, tx, ty, -5); end loop; end loop;
  perform pg_temp.hold(w, u, '{}');
  v_t := ${refused('raise_rock', CORNER)};
  ${hold('Wet Set')};
  v_u := ${refused('raise_rock', CORNER)};
  for tx in 3..5 loop for ty in 3..5 loop perform land_set_height(w, tx, ty, -15); end loop; end loop;
  insert into said values ('WET', v_t || '|' || v_u || '|' || ${refused('raise_rock', CORNER)});
  for tx in 3..5 loop for ty in 3..5 loop perform land_set_height(w, tx, ty, 40); end loop; end loop;

  /* ---- Steep Stone: what a slope of ninety says the masonry allows, at masonry 20. ---- */
  update skill set value = 20 where world_id = w and uid = u and id = 'masonry';
  perform land_set_height(w, 4, 4, 129);
  perform pg_temp.hold(w, u, '{}');
  v_t := ${refused('raise_rock', CORNER)};
  ${hold('Steep Stone')};
  insert into said values ('STEEP', v_t || '|' || ${refused('raise_rock', CORNER)});
  perform land_set_height(w, 4, 4, 40);
  update skill set value = 60 where world_id = w and uid = u and id = 'masonry';
  ${clear('concrete')};

  /* ---- Rubble Fill: refused without, short of shards, and a step up for five. ---- */
  perform give(w, u, 'rock_shards', 2, 30);
  perform pg_temp.hold(w, u, '{}');
  v_t := ${refused('rubble_fill', CORNER)};
  ${hold('Rubble Fill')};
  v_u := ${refused('rubble_fill', CORNER)};
  perform give(w, u, 'rock_shards', 3, 30);
  insert into said values ('RUBBLE', v_t || '|' || v_u || '|' || ${refused('rubble_fill', CORNER)});
  n := ${height};
  perform perform_ground(w, u, 'rubble_fill', ${CORNER});
  insert into said values ('RUBBLED', (${height} - n) || '|' || ${count('rock_shards')} || '|'
    || coalesce(${last('You pack rubble%')}, 'unsaid'));
  perform land_set_height(w, 4, 4, 40);
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

check('the storeys and the share a Repoint gives back are the same numbers on both sides',
  say('CONSTS') === `${MAX_LEVELS}|${TOP_LEVELS}|${REPOINT_BACK}`, say('CONSTS'));
const job = (id: string): string => {
  const d = ACTION_BY_ID.get(id)!;
  return `${id}:${d.baseTime}:${d.skill}:${d.tool ?? '-'}:${d.difficulty ?? '-'}:true`;
};
check('Repoint and Raise the rock with rubble are jobs on both sides, and ported',
  say('JOBS') === `${job('repoint_wall')},${job('rubble_fill')}`, say('JOBS'));
check('and a Repoint is a go of the time its note says', ACTION_BY_ID.get('repoint_wall')?.baseTime === REPOINT_TIME);

/* ---- the chisel ------------------------------------------------------------------ */

const [chiselA, chiselB] = say('CHISEL').split('|').map(Number);
check(`${P('Sure Chisel').name}: thirty goes at no skill with the worst chisel all come off with its failures at nought, and not without`,
  chiselB === 60 && chiselA < 60, `${chiselA / 2} of 30 without, ${chiselB / 2} of 30 with`);
const [kilnA, kilnB, kilnSaid] = say('KILN').split('|');
check(`${P('Nothing Wasted').name}: a kiln that fails keeps its 24 bricks and 8 mortar with it, and loses them without`,
  kilnA === '0,0' && kilnB === '24,8' && kilnSaid !== 'unsaid', say('KILN'));
const three = P('Three from a Shard').fx['count:stone_brick'];
const [shardA, shardB] = say('SHARD').split('|');
check(`${P('Three from a Shard').name}: a shard chisels into ${three} stone bricks with it, and two without, and the go says so`,
  shardA.startsWith('2:You chisel two stone bricks') && shardB.startsWith(`${three}:You chisel ${numberWord(three)} stone bricks`),
  say('SHARD'));
check(`${P('Good Mix').name}: Mix concrete makes ${P('Good Mix').fx['count:concrete']} with it, one without`,
  say('MIX') === `1|${P('Good Mix').fx['count:concrete']}`, say('MIX'));
const [chA, chB] = say('CHISELTIME').split('|').map((s) => s.split(':'));
check(`${P('Quick Chisel').name}: a go of Chisel stone brick is started with ${P('Quick Chisel').fx['time:make_stone_brick']} of the time`,
  chA[1] === '-' && chB[1] === '-' && near(Number(chB[0]) / Number(chA[0]), P('Quick Chisel').fx['time:make_stone_brick']),
  say('CHISELTIME'));
const [portA, portB] = say('PORTER').split('|').map(Number);
check(`${P('Brick Porter').name}: ten stone bricks weigh ${10 * ITEM_DEFS.stone_brick.weight} kg without it, half with`,
  near(portA, 10 * ITEM_DEFS.stone_brick.weight) && near(portB, portA * P('Brick Porter').fx['weight:stone_brick']), say('PORTER'));

/* ---- the trowel -------------------------------------------------------------------- */

const times = say('MASONTIME').split('|').map((s) => s.split(':'));
const [stoneA, woodA, stoneB, woodB] = times.map((t) => Number(t[0]));
check(`${P('Quick Mason').name}: a go of Build wall on stone is started with ${P('Quick Mason').fx['time:build_stone']} of the time`,
  times.every((t) => t[1] === '-') && near(stoneB / stoneA, P('Quick Mason').fx['time:build_stone']), say('MASONTIME'));
check('and one on timber with all of it', near(woodB, woodA), `${woodA} s, then ${woodB} s`);
const [layA, layB, laid] = say('LAY').split('|');
check(`${P('Two at a Time').name}: a go lays ${P('Two at a Time').fx['lay:build_stone']} stone bricks with it, one without, and says so`,
  layA === '1' && Number(layB) === P('Two at a Time').fx['lay:build_stone'] && laid.startsWith('You fit two stone bricks into the wall.'),
  say('LAY'));
const [hodA, hodB, hodLeft, hodLaid] = say('HOD').split('|');
check(`${P('Hod Carrier').name}: with nothing in the pack, a wall is refused without it and built out of a chest three tiles off with it`,
  hodA.startsWith('You need ') && hodB === 'ALLOWED' && hodLeft === '4' && hodLaid === '1', say('HOD'));
const stoneWall = MATERIAL_BY_ID.get('stone_brick')!;
const back = Math.floor(stoneWall.bill[0][1] * P('Salvage').fx['salvage:build_stone']);
const [salA, salB, salSaid] = say('SALVAGE').split('|');
check(`${P('Salvage').name}: a stone-brick wall taken down gives back ${back} of its ${stoneWall.bill[0][1]} bricks with it, none without`,
  salA === '0' && Number(salB) === back && salSaid === `You take down the wall on the south side and save ${back} stone bricks.`,
  say('SALVAGE'));
check(`${P('Repoint').name}: refused without the perk, in the browser's words`,
  say('RP_NO') === 'That wants a Mason who has learned to repoint.', say('RP_NO'));
check('and, with it, refused short of the new stone, saying what it takes',
  say('RP_SHORT') === `You need ${describeNeeds(layingBill('marble', 'solid'), materialName)}.`, say('RP_SHORT'));
check('and in the stone it is already, and on timber',
  say('RP_SAME') === 'It is stone brick already.' && say('RP_LOG') === 'Only a wall of stone is repointed.',
  `${say('RP_SAME')} / ${say('RP_LOG')}`);
check('and allowed with the marble to hand', say('RP_YES') === 'ALLOWED', say('RP_YES'));
const repBack = Math.floor(stoneWall.bill[0][1] * REPOINT_BACK);
const [rpMat, rpDone, rpBill, rpPack, rpSaid] = say('RP_DONE').split('|');
check(`and the wall is marble, finished, with marble's bill; the marble and mortar are spent and ${repBack} stone bricks come back`,
  rpMat === 'marble' && rpDone === 'true' && rpBill === 'true' && rpPack === `0,0,${repBack}`
    && rpSaid === `You take the stone brick out of the wall on the east side and lay it again in marble, and save ${repBack} stone bricks.`,
  say('RP_DONE'));
const tall = P('Tall Walls').fx['storeys:build_stone'];
const [tallA, tallB, tallLog, tallLevels] = say('TALL').split('|');
check(`${P('Tall Walls').name}: a stone-brick building stands ${MAX_LEVELS} storeys without it, and a ${MAX_LEVELS + 1}th is refused`,
  tallA === `${MAX_LEVELS},Buildings cannot be taller than ${MAX_LEVELS} storeys.`, tallA);
check(`and ${MAX_LEVELS + tall} with it, where the ${MAX_LEVELS + 1}th is not refused for its height`,
  tallB.startsWith(`${MAX_LEVELS + tall},`) && !tallB.includes('taller than') && !tallB.includes('will not stand'), tallB);
check('and timber in it still stops it where the timber does, whose storeys it does not raise',
  tallLog === String(MATERIAL_BY_ID.get('log')!.storeys), tallLog);
check(`and the island keeps a building of ${TOP_LEVELS} storeys`, tallLevels === String(TOP_LEVELS), tallLevels);

/* ---- the stone arch -------------------------------------------------------------------- */

const [archA, archB] = say('ARCH').split('|').map((s) => s.split('#'));
const bm = P('Bridge Mason');
check(`${bm.name}: a go on a stone arch takes ${bm.fx['time:bridge_stone']} of the time with it, and a wooden bridge all of it`,
  archA[0] === '1' && archA[1] === '1' && near(Number(archB[0]), bm.fx['time:bridge_stone']) && archB[1] === '1', say('ARCH'));
check(`and a stone arch spans ${bm.fx['span:bridge_stone']} tiles with it, ${BRIDGES.stone.span} without`,
  archA[2] === `A stone arch spans ${BRIDGES.stone.span} tiles; that is 9.` && !archB[2].includes('spans')
    && archB[3] === `A stone arch spans ${bm.fx['span:bridge_stone']} tiles; that is 11.`, say('ARCH'));

/* ---- the rock ------------------------------------------------------------------------ */

check(`${P('Concrete Hand').name}: with every check failing, the concrete is lost without it and the rock rises with it`,
  say('HAND') === '0,1|1,0', say('HAND'));
const lift = P('Double Lift').fx['lift:raise_rock'];
const [liftA, liftB, liftC] = say('LIFT').split('|');
check(`${P('Double Lift').name}: a concrete raises the corner ${lift} steps with it, one without, and says so`,
  liftA === '1' && liftB === `${lift},You lay concrete on the south-east corner and the rock stands ${numberWord(lift)} steps higher.`,
  say('LIFT'));
check('and one where the level stands a step up', liftC === '1', liftC);
const deep = P('Wet Set').fx['depth:raise_rock'];
const [wetA, wetB, wetC] = say('WET').split('|');
check(`${P('Wet Set').name}: rock under five of water is refused without it and not for the water with it`,
  wetA === 'Concrete will not set under water.' && !wetB.includes('water'), say('WET'));
check(`and under fifteen, past its ${deep}, refused with it in its own words`,
  wetC === `Concrete will not set under more than ${deep} of water.`, wetC);
const [steepA, steepB] = say('STEEP').split('|');
const allows = (s: string): number => Number(s.match(/allows (\d+)/)?.[1] ?? NaN);
check(`${P('Steep Stone').name}: at masonry 20 the steepest slope is ${20 * P('Steep Stone').fx['slope:masonry']} with it, 60 without`,
  allows(steepA) === 60 && allows(steepB) === 20 * P('Steep Stone').fx['slope:masonry'], say('STEEP'));
const shards = P('Rubble Fill').fx.rubble;
const [rubA, rubB, rubC] = say('RUBBLE').split('|');
check(`${P('Rubble Fill').name}: refused without the perk, short of ${shards} shards with it, and allowed with them`,
  rubA === 'That wants a Mason who has learned to fill with rubble.' && rubB === `You need ${numberWord(shards)} rock shards.`
    && rubC === 'ALLOWED', say('RUBBLE'));
check('and a go spends them and raises the corner a step',
  say('RUBBLED') === '1|0|You pack rubble into the south-east corner and the rock stands a step higher.', say('RUBBLED'));

/* ---- the browser's half ------------------------------------------------------------ */

const game = Game.create(2718);
const rubble = ACTION_BY_ID.get('rubble_fill')!;
const px = Math.floor(game.player.x);
const py = Math.floor(game.player.y);
const at = { kind: 'tile' as const, x: px, y: py, cx: px, cy: py };
game.inventory.add('rock_shards', { count: shards, ql: 30 });
check('Raise the rock with rubble is not offered without the perk', rubble.applies(at, game) === false);
game.setPerks({ rubble: shards });
check('and is with it, and the shards', rubble.applies(at, game) === true);
game.world.setDirt(px, py, 0);
game.world.setHeight(px, py, -5);
check('the browser refuses concrete under water without Wet Set', rockRaiseRefusal(game, px, py, 'Concrete') === 'Concrete will not set under water.',
  String(rockRaiseRefusal(game, px, py, 'Concrete')));
game.setPerks({ 'depth:raise_rock': deep });
check('and not for the water with it', !String(rockRaiseRefusal(game, px, py, 'Concrete')).includes('water'),
  String(rockRaiseRefusal(game, px, py, 'Concrete')));
const b = game.buildings.create('Tower', px, py);
game.buildings.setWall(b, 0, px, py, 'n', 'solid', 'stone_brick');
check(`the browser's storey cap is ${MAX_LEVELS} for stone brick, and ${MAX_LEVELS + TALL_STOREYS} with Tall Walls`,
  game.buildings.storeyCap(b) === MAX_LEVELS && game.buildings.storeyCap(b, tall) === MAX_LEVELS + tall,
  `${game.buildings.storeyCap(b)}, ${game.buildings.storeyCap(b, tall)}`);
game.buildings.setWall(b, 0, px, py, 'e', 'solid', 'log');
check('and timber caps it as it stands', game.buildings.storeyCap(b, tall) === MATERIAL_BY_ID.get('log')!.storeys,
  String(game.buildings.storeyCap(b, tall)));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Mason's perks — ${ok.length} of ${ok.length}`);
