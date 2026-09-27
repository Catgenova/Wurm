/**
 * The Farmer's eighteen perks, each measured where its rule is.
 *
 * `perks.ts` holds the two sides to each other for every trade on perks --
 * the rows, the tiers, the fold, the choosing -- and this asks the one thing
 * that is the Farmer's own: that each perk does what its note says, on the
 * island, with the dice taken out wherever they can be. A skill check is made
 * to pass outright, the quality a pair of hands turns out is held still, and a
 * chance is put at one inside the transaction, so that a go must show the rule.
 *
 *   * Sowing: Seed Saver's seed kept, Fast Growth's and Crop Rotation's pace
 *     stamped on the crop and grown at, and the last crop a field was sown
 *     with, forgotten when it is broken up;
 *   * the harvest: Bumper Crop's one more, Herb Plot's, Grain Master's and
 *     Fibre Farmer's two more, Rare Harvest's rarity, Fodder's grass and Barn
 *     Reach's store;
 *   * the quern: More Meal's flour and Full Press's fruit; Milkmaid's time and
 *     second bucket; Sack Porter's load; Worn-in Rake's till;
 *   * the three patch jobs, with every refusal;
 *   * a worker's harvest the right way round;
 *   * and the browser reads the same numbers where it asks or offers them.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID } from '../../src/game/actions';
import type { Target } from '../../src/game/actions';
import { CROPS, cropTimeLeft, cropYield, RIPE } from '../../src/game/farming';
import { perksOf, type PerkDef } from '../../src/game/perks';
import { RECIPES } from '../../src/game/recipes';
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
const near = (a: number, b: number, by = 1e-5): boolean => Math.abs(a - b) <= by * Math.max(1, Math.abs(b));

const FARMER = perksOf('farmer');
const P = (name: string): PerkDef => {
  const p = FARMER.find((x) => x.name === name);
  if (!p) throw new Error(`the Farmer has no perk called ${name}`);
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
const newest = (def: string): string =>
  `(select i.id from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = '${def}' order by i.id desc limit 1)`;
const clear = (...defs: string[]): string =>
  `delete from item where world_id = w and holder = 'player' and holder_uid = u and def in (${defs.map(q).join(', ')})`;
const last = (like: string): string =>
  `(select e.text from event e where e.world_id = w and e.uid = u and e.text like ${q(like)} order by e.n desc limit 1)`;
/** Every skill check passes, until it is said otherwise. */
const checks = (pass: boolean): string =>
  `create or replace function skill_check(p_skill double precision, p_difficulty double precision,
     p_tool_ql double precision default 0, p_ease double precision default 0)
     returns boolean language sql as 'select ${pass}'`;
/** The quality a pair of hands turns out, held still. */
const HANDS = 40;
const at = (x: number, y: number, seed = 'null'): string =>
  `jsonb_build_object('kind', 'tile', 'x', ${x}, 'y', ${y}, 'itemUid', ${seed})`;
const act = (a: string, x: number, y: number, seed = 'null'): string => `perform act_perform(w, u, '${a}', ${at(x, y, seed)})`;
const refused = (a: string, x: number, y: number, seed = 'null'): string =>
  `coalesce(act_refusal(w, u, '${a}', ${at(x, y, seed)}), 'ALLOWED')`;
const field = (x: number, y: number): string => `perform land_set_tile(w, ${x}, ${y}, tile_id('Field'))`;
/** A crop standing on a field: its stage, how often it was tended, and whether at this stage. */
const crop = (x: number, y: number, id: string, stage: number, tended: number, now = false): string =>
  `${field(x, y)}; insert into crop (world_id, x, y, id, stage, stage_at, tended, tended_now, ql, pace)
     values (w, ${x}, ${y}, '${id}', ${stage}, now(), ${tended}, ${now}, ${HANDS}, 1)
     on conflict (world_id, x, y) do update set id = excluded.id, stage = excluded.stage, stage_at = excluded.stage_at,
       tended = excluded.tended, tended_now = excluded.tended_now, ql = excluded.ql, pace = 1`;
const unsow = (x: number, y: number): string => `delete from crop where world_id = w and x = ${x} and y = ${y}`;
const paceAt = (x: number, y: number): string =>
  `coalesce((select pace::text from crop where world_id = w and x = ${x} and y = ${y}), 'none')`;
const SPACE = 'between 4 and 15';

const out = psql(`
begin;
create temp table said (k text, v text);

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
  delete from caller where uid = u;
  j := rpc_act(w, a, t);
  select extract(epoch from act_ends - act_started) into v from player where world_id = w and uid = u;
  update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null,
         act_goes = null, act_queue = '[]' where world_id = w and uid = u;
  return coalesce(v::text, 'none') || ':' || coalesce(j->>'why', '-');
end $f$;
/* A go as the clock finishes one: through \`settle\`, which is where a go's job and perks are known. */
create function pg_temp.go(w uuid, u uuid, a text, t jsonb) returns void language plpgsql as $f$
begin
  update player set act = a, act_target = t, act_started = now() - interval '2 seconds',
         act_ends = now() - interval '1 second', act_left = 1, act_goes = 1, act_queue = '[]'
   where world_id = w and uid = u;
  perform settle(w, u);
end $f$;
create or replace function product_ql(p_skill double precision, p_tool_ql double precision default 0)
  returns double precision language sql as 'select ${HANDS}::double precision';

do $$
declare w uuid; u uuid; tx int; ty int; v_t text; v_u text; v_seed bigint; v_chest bigint; v_c int; v_j jsonb;
begin
  -- The suite's own island and its first body, a Farmer now, on flat grass,
  -- and nobody on the island walking the gardener's path.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  for tx in 0..15 loop for ty in 0..15 loop
    perform land_set_height(w, tx, ty, 40); perform land_set_dirt(w, tx, ty, 20);
    perform land_set_tile(w, tx, ty, tile_id('Grass')); perform land_set_data(w, tx, ty, 0);
  end loop; end loop;
  delete from crop where world_id = w and x between 0 and 15 and y between 0 and 15;
  delete from crop_last where world_id = w and x between 0 and 15 and y between 0 and 15;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  delete from item where world_id = w and holder = 'ground' and gx between 0 and 15 and gy between 0 and 15;
  delete from player_node where world_id = w and uid = u;
  delete from placed where world_id = w and x ${SPACE} and y ${SPACE};
  delete from creature where world_id = w and from_x between 4 and 16 and from_y between 4 and 16;
  delete from caller where uid = u;
  update player set way = null where world_id = w;
  update player set x = 9.5, y = 9.5, act = null, act_target = null, act_started = null, act_ends = null,
         act_left = null, act_goes = null, act_queue = '[]', craft_class = 'farmer', combat_class = null,
         class_mul = null, level_h = null, rested = 0, boons = '[]'::jsonb, body_at = now(), swim_at = now(),
         equipped = '{}'::jsonb,
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
   where world_id = w and uid = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  insert into skill (world_id, uid, id, value)
    select w, u, s, 60 from unnest(array['farming', 'milling']) s
    on conflict (world_id, uid, id) do update set value = excluded.value;
  ${checks(true)};

  /* ---- Seed Saver: a seed spent without it, and kept with its chance put at one. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${field(10, 9)};
  perform give(w, u, 'wheat_seed', 1, 50);
  v_seed := ${newest('wheat_seed')};
  ${act('plant_seed', 10, 9, 'v_seed')};
  v_t := ${count('wheat_seed')} || ':' || ${paceAt(10, 9)};
  ${unsow(10, 9)};
  delete from crop_last where world_id = w and x = 10 and y = 9;
  ${patch('Seed Saver', { 'keep:plant_seed': 1 })};
  ${hold('Seed Saver')};
  perform give(w, u, 'wheat_seed', 1, 50);
  v_seed := ${newest('wheat_seed')};
  ${act('plant_seed', 10, 9, 'v_seed')};
  insert into said values ('SAVER', v_t || '|' || ${count('wheat_seed')} || ':' || ${paceAt(10, 9)}
    || '|' || coalesce(${last('You sow wheat.%')}, 'unsaid'));
  ${clear('wheat_seed')};
  ${unsow(10, 9)};
  delete from crop_last where world_id = w and x = 10 and y = 9;

  /* ---- Fast Growth and Crop Rotation: the pace a crop is sown at, and the field's last crop. ---- */
  perform give(w, u, 'wheat_seed', 20, 50);
  perform give(w, u, 'carrot_seed', 20, 50);
  -- Never sown, nobody's perk: the crop's own pace.
  perform pg_temp.hold(w, u, '{}');
  ${act('plant_seed', 10, 9, newest('wheat_seed'))};
  v_t := ${paceAt(10, 9)} || ':' || coalesce((select id from crop_last where world_id = w and x = 10 and y = 9), 'none');
  ${unsow(10, 9)};
  ${hold('Fast Growth')};
  ${act('plant_seed', 10, 9, newest('wheat_seed'))};
  v_t := v_t || '#' || ${paceAt(10, 9)};
  ${unsow(10, 9)};
  ${hold('Crop Rotation')};
  -- Wheat after wheat is no rotation; carrots after wheat are.
  ${act('plant_seed', 10, 9, newest('wheat_seed'))};
  v_t := v_t || '#' || ${paceAt(10, 9)};
  ${unsow(10, 9)};
  ${act('plant_seed', 10, 9, newest('carrot_seed'))};
  v_t := v_t || '#' || ${paceAt(10, 9)};
  ${unsow(10, 9)};
  ${hold('Fast Growth', 'Crop Rotation')};
  ${act('plant_seed', 10, 9, newest('wheat_seed'))};
  v_t := v_t || '#' || ${paceAt(10, 9)};
  -- And a field never sown has no last crop, whatever is sown on it.
  ${field(11, 9)};
  ${act('plant_seed', 11, 9, newest('carrot_seed'))};
  v_t := v_t || '#' || ${paceAt(11, 9)};
  insert into said values ('PACE', v_t);
  -- Grown at: the fast crop a stage on, the plain one not yet, after nine tenths of a stage.
  update crop set pace = 1, stage = 0, stage_at = now() - make_interval(secs => 0.9 * (select stage_seconds from crop_def where id = 'carrot'))
   where world_id = w and x = 11 and y = 9;
  update crop set id = 'carrot', pace = 0.8, stage = 0,
         stage_at = now() - make_interval(secs => 0.9 * (select stage_seconds from crop_def where id = 'carrot'))
   where world_id = w and x = 10 and y = 9;
  perform crops_settle(w, 10.5, 9.5, 2);
  delete from caller where uid = u;
  v_j := rpc_ground(w, 40, true);
  insert into said values ('GROWN', (select stage from crop where world_id = w and x = 10 and y = 9) || ':'
    || (select stage from crop where world_id = w and x = 11 and y = 9) || '|'
    || coalesce((select c->>'pace' from jsonb_array_elements(v_j->'crops') c where (c->>'x')::int = 10 and (c->>'y')::int = 9), 'unsent'));
  -- Broken up, a field forgets its last crop.
  ${act('clear_field', 10, 9)};
  insert into said values ('FORGOT', (select count(*) from crop_last where world_id = w and x = 10 and y = 9)::text || ':'
    || (select count(*) from crop_last where world_id = w and x = 11 and y = 9));
  ${unsow(11, 9)};
  ${clear('wheat_seed', 'carrot_seed')};

  /* ---- The harvest: Bumper Crop, the two more of the three, and Fodder. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${crop(10, 9, 'wheat', RIPE, RIPE)};
  ${act('harvest_crop', 10, 9)};
  v_t := ${count('wheat')} || ':' || ${count('wheat_seed')} || ':' || ${count('mixed_grass')};
  ${clear('wheat', 'wheat_seed')};
  ${hold('Bumper Crop', 'Fodder')};
  ${crop(10, 9, 'wheat', RIPE, RIPE)};
  ${act('harvest_crop', 10, 9)};
  v_t := v_t || '|' || ${count('wheat')} || ':' || ${count('wheat_seed')} || ':' || ${count('mixed_grass')} || ':'
    || (select ql from item where id = ${newest('mixed_grass')});
  ${clear('wheat', 'wheat_seed', 'mixed_grass')};
  -- Tended at two stages of three: no bumper.
  ${crop(10, 9, 'wheat', RIPE, RIPE - 1)};
  ${act('harvest_crop', 10, 9)};
  v_t := v_t || '|' || ${count('wheat')};
  ${clear('wheat', 'wheat_seed', 'mixed_grass')};
  insert into said values ('BUMPER', v_t);
  -- And what tending says it will give, with the one tending it's own Bumper Crop.
  ${crop(10, 9, 'wheat', RIPE - 1, RIPE - 1)};
  ${act('tend_crop', 10, 9)};
  insert into said values ('TENDSAID', coalesce(${last('You weed and water the wheat.%')}, 'unsaid'));
  ${unsow(10, 9)};
  v_t := '';
  perform pg_temp.hold(w, u, '{}');
  ${crop(10, 9, 'sage', RIPE, 0)}; ${act('harvest_crop', 10, 9)};
  ${crop(10, 9, 'wheat', RIPE, 0)}; ${act('harvest_crop', 10, 9)};
  ${crop(10, 9, 'cotton', RIPE, 0)}; ${act('harvest_crop', 10, 9)};
  ${crop(10, 9, 'onion', RIPE, 0)}; ${act('harvest_crop', 10, 9)};
  v_t := ${count('sage')} || ':' || ${count('wheat')} || ':' || ${count('cotton')} || ':' || ${count('onion')};
  ${clear('sage', 'wheat', 'cotton', 'onion', 'sage_seed', 'wheat_seed', 'cotton_seed', 'onion_seed')};
  ${hold('Herb Plot', 'Grain Master', 'Fibre Farmer')};
  ${crop(10, 9, 'sage', RIPE, 0)}; ${act('harvest_crop', 10, 9)};
  ${crop(10, 9, 'wheat', RIPE, 0)}; ${act('harvest_crop', 10, 9)};
  ${crop(10, 9, 'cotton', RIPE, 0)}; ${act('harvest_crop', 10, 9)};
  ${crop(10, 9, 'onion', RIPE, 0)}; ${act('harvest_crop', 10, 9)};
  insert into said values ('PLUS', v_t || '|' || ${count('sage')} || ':' || ${count('wheat')} || ':' || ${count('cotton')}
    || ':' || ${count('onion')});
  ${clear('sage', 'wheat', 'cotton', 'onion', 'sage_seed', 'wheat_seed', 'cotton_seed', 'onion_seed')};

  /* ---- Rare Harvest: the produce rare with its chance put at one, and the seed not. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${crop(10, 9, 'wheat', RIPE, 0)}; ${act('harvest_crop', 10, 9)};
  v_t := (select coalesce(rare, '-') from item where id = ${newest('wheat')});
  ${clear('wheat', 'wheat_seed')};
  ${patch('Rare Harvest', { 'rare:harvest_crop': 1 })};
  ${hold('Rare Harvest')};
  ${crop(10, 9, 'wheat', RIPE, 0)}; ${act('harvest_crop', 10, 9)};
  insert into said values ('RARE', v_t || '|' || (select coalesce(rare, '-') from item where id = ${newest('wheat')}) || ':'
    || (select coalesce(rare, '-') from item where id = ${newest('wheat_seed')}) || '|'
    || coalesce(${last('You harvest %')}, 'unsaid'));
  ${clear('wheat', 'wheat_seed')};

  /* ---- Barn Reach: a chest of the farmer's three tiles off, and a go the clock finishes. ---- */
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'chest', 12, 9, 0, 0, 12.5, 9.5, 40, 'Pine', u) returning id into v_chest;
  perform pg_temp.hold(w, u, '{}');
  ${crop(10, 9, 'wheat', RIPE, 0)};
  perform pg_temp.go(w, u, 'harvest_crop', ${at(10, 9)});
  v_t := ${count('wheat')} || ',' || (select coalesce(sum(count), 0) from item where placed = v_chest);
  ${clear('wheat', 'wheat_seed')};
  ${hold('Barn Reach')};
  ${crop(10, 9, 'wheat', RIPE, 0)};
  perform pg_temp.go(w, u, 'harvest_crop', ${at(10, 9)});
  insert into said values ('BARN', v_t || '|' || ${count('wheat')} || ','
    || (select coalesce(sum(count), 0) from item where placed = v_chest and def = 'wheat') || ','
    || (select coalesce(sum(count), 0) from item where placed = v_chest and def = 'wheat_seed'));
  delete from item where placed = v_chest;
  delete from placed where id = v_chest;
  ${clear('wheat', 'wheat_seed')};

  /* ---- More Meal and Full Press, at the quern. ---- */
  perform give(w, u, 'quern', 1, 50);
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'wheat', 2, 30);
  perform perform_craft(w, u, 'make_flour', jsonb_build_object('kind', 'item', 'uid', null));
  v_t := ${count('flour')}::text;
  ${clear('flour', 'wheat')};
  ${hold('More Meal')};
  perform give(w, u, 'wheat', 2, 30);
  perform perform_craft(w, u, 'make_flour', jsonb_build_object('kind', 'item', 'uid', null));
  perform give(w, u, 'corn', 2, 30);
  perform perform_craft(w, u, 'make_cornmeal', jsonb_build_object('kind', 'item', 'uid', null));
  insert into said values ('MEAL', v_t || '|' || ${count('flour')} || ':' || ${count('cornmeal')});
  ${clear('flour', 'wheat', 'cornmeal', 'corn')};
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'apple', 8, 30);
  perform give(w, u, 'bucket', 1, 30);
  v_t := coalesce(craft_refusal(w, u, 'press_apple_juice', null), 'ALLOWED');
  ${hold('Full Press')};
  v_t := v_t || '#' || coalesce(craft_refusal(w, u, 'press_apple_juice', null), 'ALLOWED');
  perform perform_craft(w, u, 'press_apple_juice', jsonb_build_object('kind', 'item', 'uid', null));
  insert into said values ('PRESS', v_t || '|' || ${count('apple')} || ':' || ${count('bucket')} || ':' || ${count('juice_bucket')});
  insert into said select 'NEEDS', string_agg(r.id || '=' || recipe_need(w, u, r.id, 10) || ',' || recipe_need(w, u, r.id, 20)
    || ',' || recipe_need(w, u, r.id, 1), ';' order by r.id)
    from recipe r where r.id like 'press\\_%';
  ${clear('apple', 'bucket', 'juice_bucket', 'quern')};

  /* ---- Milkmaid: its time, and a second bucket with its chance put at one. ---- */
  perform pg_temp.hold(w, u, '{}');
  select creature_spawn(w, 'cudda', 10.5, 9.5, 'deed', now() - interval '3 hours', u) into v_c;
  update creature set sex = 'female', fleece = 1, hunger = 1, traits = '{}', mode = 'deed', keeper = u,
         from_x = 10.5, from_y = 9.5, to_x = 10.5, to_y = 9.5, leg_at = now(), leg_ends = now(),
         until = now() + interval '1 hour', settled_at = now()
   where world_id = w and id = v_c;
  perform give(w, u, 'bucket', 2, 30);
  v_t := pg_temp.secs(w, u, 'milk_creature', jsonb_build_object('kind', 'creature', 'id', v_c));
  perform act_perform(w, u, 'milk_creature', jsonb_build_object('kind', 'creature', 'id', v_c));
  v_u := ${count('milk_bucket')} || ':' || ${count('bucket')};
  ${clear('milk_bucket', 'bucket')};
  ${patch('Milkmaid', { 'more:milk_creature': 1 })};
  ${hold('Milkmaid')};
  update creature set fleece = 1 where world_id = w and id = v_c;
  perform give(w, u, 'bucket', 2, 30);
  v_t := v_t || '|' || pg_temp.secs(w, u, 'milk_creature', jsonb_build_object('kind', 'creature', 'id', v_c));
  perform act_perform(w, u, 'milk_creature', jsonb_build_object('kind', 'creature', 'id', v_c));
  v_u := v_u || '|' || ${count('milk_bucket')} || ':' || ${count('bucket')};
  ${clear('milk_bucket', 'bucket')};
  -- And with one bucket only, one bucket.
  update creature set fleece = 1 where world_id = w and id = v_c;
  perform give(w, u, 'bucket', 1, 30);
  perform act_perform(w, u, 'milk_creature', jsonb_build_object('kind', 'creature', 'id', v_c));
  v_u := v_u || '|' || ${count('milk_bucket')} || ':' || ${count('bucket')};
  insert into said values ('MILK', v_t || '#' || v_u || '#' || coalesce(${last('You milk %')}, 'unsaid'));
  ${clear('milk_bucket', 'bucket')};
  delete from creature where world_id = w and id = v_c;

  /* ---- Sack Porter: ten potatoes in an otherwise empty pack. ---- */
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'potato', 10, 30);
  v_t := carried_weight(w, u)::text;
  ${hold('Sack Porter')};
  insert into said values ('SACK', v_t || '|' || carried_weight(w, u));
  ${clear('potato')};

  /* ---- Worn-in Rake: Till's time with a rake of QL 50, and one of 90, on grass. ---- */
  perform land_set_tile(w, 10, 9, tile_id('Grass'));
  perform give(w, u, 'rake', 1, 50);
  perform pg_temp.hold(w, u, '{}');
  v_t := tool_ql(w, u, 'rake') || ':' || pg_temp.secs(w, u, 'till', ${at(10, 9)});
  ${hold('Worn-in Rake')};
  v_t := v_t || '|' || pg_temp.secs(w, u, 'till', ${at(10, 9)});
  ${clear('rake')};
  perform give(w, u, 'rake', 1, 90);
  perform pg_temp.hold(w, u, '{}');
  v_t := v_t || '|' || tool_ql(w, u, 'rake') || ':' || pg_temp.secs(w, u, 'till', ${at(10, 9)});
  ${hold('Worn-in Rake')};
  insert into said values ('RAKE', v_t || '|' || pg_temp.secs(w, u, 'till', ${at(10, 9)}));
  ${clear('rake')};

  /* ---- Sow a Patch: the three by three around (10, 9), with grass at one corner and a crop in another. ---- */
  for tx in 9..11 loop for ty in 8..10 loop perform land_set_tile(w, tx, ty, tile_id('Field')); end loop; end loop;
  perform land_set_tile(w, 11, 10, tile_id('Grass'));
  ${crop(9, 8, 'carrot', 1, 0)};
  perform give(w, u, 'wheat_seed', 10, 50);
  v_seed := ${newest('wheat_seed')};
  perform pg_temp.hold(w, u, '{}');
  v_t := ${refused('sow_patch', 10, 9, 'v_seed')};
  ${hold('Sow a Patch')};
  v_t := v_t || '#' || ${refused('sow_patch', 10, 9)} || '#' || ${refused('sow_patch', 10, 9, 'v_seed')};
  ${act('sow_patch', 10, 9, 'v_seed')};
  v_u := (select count(*) from crop where world_id = w and x between 9 and 11 and y between 8 and 10 and id = 'wheat') || ':'
    || ${count('wheat_seed')} || ':' || coalesce((select id from crop where world_id = w and x = 9 and y = 8), 'none') || ':'
    || (select count(*) from crop where world_id = w and x = 11 and y = 10);
  v_t := v_t || '#' || ${refused('sow_patch', 10, 9, 'v_seed')};
  insert into said values ('SOWPATCH', v_t || '|' || v_u || '|' || coalesce(${last('You sow % with wheat.%')}, 'unsaid'));
  -- With three seeds left for the seven fields: three sown, and the go stops.
  delete from crop where world_id = w and x between 9 and 11 and y between 8 and 10 and id = 'wheat';
  ${act('sow_patch', 10, 9, newest('wheat_seed'))};
  insert into said values ('SOWSHORT', (select count(*) from crop where world_id = w and x between 9 and 11 and y between 8 and 10
    and id = 'wheat') || ':' || ${count('wheat_seed')} || '|' || coalesce(${last('You sow % with wheat.%')}, 'unsaid'));
  delete from crop where world_id = w and x between 9 and 11 and y between 8 and 10;
  ${clear('wheat_seed')};

  /* ---- Tend a Patch: two that want it, one tended at its stage already, one ripe. ---- */
  ${hold('Tend a Patch')};
  v_u := ${refused('tend_patch', 10, 9)};
  ${crop(9, 8, 'wheat', 1, 0)}; ${crop(10, 8, 'wheat', 1, 0, true)}; ${crop(11, 8, 'wheat', RIPE, 1)}; ${crop(9, 10, 'carrot', 0, 0)};
  perform pg_temp.hold(w, u, '{}');
  v_t := ${refused('tend_patch', 10, 9)};
  ${hold('Tend a Patch')};
  v_t := v_t || '#' || ${refused('tend_patch', 10, 9)} || '#' || v_u;
  ${act('tend_patch', 10, 9)};
  insert into said values ('TENDPATCH', v_t || '|' || (select string_agg(x || ',' || y || '=' || tended || ':' || tended_now, ' ' order by y, x)
    from crop where world_id = w and x between 9 and 11 and y between 8 and 10) || '|' || ${refused('tend_patch', 10, 9)}
    || '|' || coalesce(${last('You weed and water % crops.')}, 'unsaid'));
  delete from crop where world_id = w and x between 9 and 11 and y between 8 and 10;

  /* ---- Harvest a Patch: three ripe, one not. ---- */
  ${hold('Harvest a Patch')};
  ${crop(9, 10, 'carrot', 1, 0)};
  v_u := ${refused('harvest_patch', 10, 9)};
  ${crop(9, 8, 'wheat', RIPE, RIPE)}; ${crop(10, 8, 'carrot', RIPE, RIPE)}; ${crop(11, 8, 'wheat', RIPE, 0)};
  perform pg_temp.hold(w, u, '{}');
  v_t := ${refused('harvest_patch', 10, 9)};
  ${hold('Harvest a Patch')};
  v_t := v_t || '#' || v_u || '#' || ${refused('harvest_patch', 10, 9)};
  ${act('harvest_patch', 10, 9)};
  insert into said values ('HARVESTPATCH', v_t || '|' || ${count('wheat')} || ':' || ${count('wheat_seed')} || ':' || ${count('carrot')}
    || ':' || ${count('carrot_seed')} || ':' || (select count(*) from crop where world_id = w and x between 9 and 11 and y between 8 and 10)
    || '|' || coalesce(${last('You harvest % fields:%')}, 'unsaid'));
  delete from crop where world_id = w and x between 9 and 11 and y between 8 and 10;
  ${clear('wheat', 'wheat_seed', 'carrot', 'carrot_seed')};

  /* ---- A worker's harvest: the produce home and the seed in the furrow. ---- */
  ${crop(12, 12, 'wheat', RIPE, RIPE)};
  insert into creature (world_id, id, species, name, from_x, from_y, to_x, to_y, health, sex, mode, job, work_x, work_y, keeper)
    select w, coalesce(max(id), 0) + 1, 'seavic', 'Reaper', 12.5, 12.5, 12.5, 12.5, 20, 'female', 'deed', 'farm', 12, 12, u
    from creature where world_id = w
    returning id into v_c;
  v_j := worker_do(w, v_c);
  insert into said values ('WORKER', coalesce(v_j->>'def', '-') || ':' || coalesce(v_j->>'count', '-') || ':'
    || (select coalesce(sum(count), 0) from item where world_id = w and holder = 'ground' and gx = 12 and gy = 12 and def = 'wheat_seed')
    || ':' || coalesce((select id from crop_last where world_id = w and x = 12 and y = 12), 'none'));
  delete from creature where world_id = w and id = v_c;

  /* ---- The jobs as the island has them, routed, and the tree gone. ---- */
  insert into said select 'JOBS', string_agg(id || ':' || base_time || ':' || stamina || ':' || coalesce(skill, '-') || ':'
    || coalesce(tool, '-') || ':' || farm_action(id) || ':' || act_ported(id), ',' order by id)
    from action_def where id in ('sow_patch', 'tend_patch', 'harvest_patch');
  insert into said values ('BAUBLE', bauble_plus(w, u, 'harvest_patch') || ':' || bauble_plus(w, u, 'harvest_crop'));
  insert into said values ('NODES', (select count(*) from class_node where id ~ '^farmer_')::text);
end $$;

select k || E'\\t' || coalesce(v, '') from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const [k, ...v] = l.split('\t');
  return [k, v.join('\t')];
}));
const say = (k: string): string => said.get(k) ?? 'unsaid';

/* ---- Sowing ------------------------------------------------------------------------------ */

const [saverPlain, saverPerk, saverSaid] = say('SAVER').split('|');
check(`${P('Seed Saver').name}: a sowing spends the seed without it, and keeps it with its chance put at one`,
  saverPlain === '0:1' && saverPerk === '1:1' && saverSaid.endsWith('It cost you no seed.'), say('SAVER'));
const [fresh, fast, same, rotated, both, never] = say('PACE').split('#');
const fg = P('Fast Growth').fx['grow:plant_seed'];
const cr = P('Crop Rotation').fx['rotate:plant_seed'];
check('a crop sown by nobody in particular on a field never sown grows at its own pace, and the field remembers it',
  fresh === '1:wheat', fresh);
check(`${P('Fast Growth').name}: a crop sown with it grows at ${fg} of the time a stage`, near(Number(fast), fg), fast);
check(`${P('Crop Rotation').name}: the same crop again is no rotation, another is, at ${cr} of the time`,
  near(Number(same), 1) && near(Number(rotated), cr), `${same} / ${rotated}`);
check('and the two together multiply', near(Number(both), fg * cr), both);
check('and a field never sown has no last crop to rotate from', near(Number(never), fg), never);
const [grownStages, grownSent] = say('GROWN').split('|');
check('a crop grows at the pace it was sown at: nine tenths of a stage on, the fast one has moved and the plain one not',
  grownStages === '1:0', say('GROWN'));
check('and the browser is told the pace', near(Number(grownSent), 0.8), grownSent);
check('a field broken up forgets its last crop, and the one beside it does not', say('FORGOT') === '0:1', say('FORGOT'));

/* ---- The harvest ------------------------------------------------------------------------- */

const [bumpPlain, bumpPerk, bumpTwo] = say('BUMPER').split('|');
const full = cropYield(RIPE);
const bumped = cropYield(RIPE, P('Bumper Crop').fx['bumper:harvest_crop']);
check('a wheat tended at every stage gives what the browser says, and no grass, without the perks',
  bumpPlain === `${full.produce}:${full.seeds}:0`, bumpPlain);
check(`${P('Bumper Crop').name}: ${bumped.produce} produce with it, the seed as it was`,
  bumpPerk.startsWith(`${bumped.produce}:${full.seeds}:`), bumpPerk);
check(`${P('Fodder').name}: ${P('Fodder').fx['fodder:harvest_crop']} mixed grass with the harvest, at its QL`,
  bumpPerk.endsWith(`:${P('Fodder').fx['fodder:harvest_crop']}:${HANDS}`), bumpPerk);
check('and a crop tended at two stages of three gets no bumper', bumpTwo === String(cropYield(RIPE - 1).produce), bumpTwo);
check('and tending says what the one tending it would harvest, their own Bumper Crop counted',
  say('TENDSAID').includes(`It should give ${bumped.produce} wheat`), say('TENDSAID'));
const [plusPlain, plusPerk] = say('PLUS').split('|');
const plus = (name: string, crop: string): number => P(name).fx[`plus:${crop}`];
check('untended sage, wheat, cotton and onion give one each without the perks', plusPlain === '1:1:1:1', plusPlain);
check(`${P('Herb Plot').name}, ${P('Grain Master').name} and ${P('Fibre Farmer').name}: sage, wheat and cotton give their two more, onion nothing more`,
  plusPerk === `${1 + plus('Herb Plot', 'sage')}:${1 + plus('Grain Master', 'wheat')}:${1 + plus('Fibre Farmer', 'cotton')}:1`, plusPerk);
const [rarePlain, rarePerk, rareSaid] = say('RARE').split('|');
const [rareProduce, rareSeed] = rarePerk.split(':');
check(`${P('Rare Harvest').name}: a harvest is never rare without it, and its produce rare with its chance put at one, the seed not`,
  rarePlain === '-' && ['rare', 'supreme', 'fantastic'].includes(rareProduce) && rareSeed === '-'
    && rareSaid.includes(`× ${rareProduce} wheat`), say('RARE'));
const [barnPlain, barnPerk] = say('BARN').split('|');
check(`${P('Barn Reach').name}: a harvest goes into the pack without it, and into the farmer's chest three tiles off with it`,
  barnPlain === '1,0' && barnPerk === '0,1,1', say('BARN'));

/* ---- The quern, the pail, the pack and the rake ------------------------------------------- */

const [mealPlain, mealPerk] = say('MEAL').split('|');
check(`${P('More Meal').name}: a go of flour makes one without it, and ${P('More Meal').fx['count:flour']} of flour and of cornmeal with it`,
  mealPlain === '1' && mealPerk === `${P('More Meal').fx['count:flour']}:${P('More Meal').fx['count:cornmeal']}`, say('MEAL'));
const [pressAsk, pressDone] = say('PRESS').split('|');
const [pressPlain, pressPerk] = pressAsk.split('#');
check(`${P('Full Press').name}: eight apples will not press into juice without it, and do with it, bucket and all`,
  pressPlain !== 'ALLOWED' && pressPerk === 'ALLOWED' && pressDone === '0:0:1', say('PRESS'));
const presses = RECIPES.filter((r) => `need:${r.id}` in P('Full Press').fx);
const needs = new Map(say('NEEDS').split(';').map((s) => s.split('=') as [string, string]));
check('and every press takes its share of the fruit, and still one bucket',
  presses.length > 0 && presses.every((r) => {
    const m = P('Full Press').fx[`need:${r.id}`];
    return needs.get(r.id) === [10, 20, 1].map((n) => Math.max(1, Math.ceil(n * m))).join(',');
  }), say('NEEDS'));
const [milkTimes, milkCounts, milkSaid] = say('MILK').split('#');
const [milkA, milkB] = milkTimes.split('|').map((s) => Number(s.split(':')[0]));
check(`${P('Milkmaid').name}: milking takes ${P('Milkmaid').fx['time:milk_creature']} of the time`,
  near(milkB / milkA, P('Milkmaid').fx['time:milk_creature'], 1e-3), milkTimes);
check('and fills a second bucket with its chance put at one, and one with only the one bucket',
  milkCounts === '1:1|2:0|1:0' && milkSaid.includes('into the bucket.'), `${milkCounts} | ${milkSaid}`);
const [sackPlain, sackPerk] = say('SACK').split('|').map(Number);
check(`${P('Sack Porter').name}: ten potatoes weigh ${P('Sack Porter').fx['weight:potato']} of what they did`,
  near(sackPerk, sackPlain * P('Sack Porter').fx['weight:potato']), say('SACK'));
const [rake50, rake50perk, rake90, rake90perk] = say('RAKE').split('|');
const [ql50, secs50] = rake50.split(':').map(Number);
const [ql90, secs90] = rake90.split(':').map(Number);
const up = P('Worn-in Rake').fx['tool:till'];
const factor = (ql: number): number => 1 - Math.min(100, ql) / 400;
check(`${P('Worn-in Rake').name}: Till goes as with a rake ${up} QL better`,
  near(Number(rake50perk.split(':')[0]) / secs50, factor(ql50 + up) / factor(ql50), 1e-3), `${rake50} → ${rake50perk}`);
check('and never better than the best a rake can be', near(Number(rake90perk.split(':')[0]) / secs90, factor(100) / factor(ql90), 1e-3),
  `${rake90} → ${rake90perk}`);

/* ---- The patch jobs ---------------------------------------------------------------------- */

const [sowAsk, sowAfter, sowSaid] = say('SOWPATCH').split('|');
const [sowNoPerk, sowNoSeed, sowOk, sowFull] = sowAsk.split('#');
check(`${P('Sow a Patch').name}: refused without the perk and without a seed, and refused once every field is sown, in its own words`,
  sowNoPerk === 'That wants a Farmer who has learned to sow a patch.' && sowNoSeed === 'Choose a seed to sow.' && sowOk === 'ALLOWED'
    && sowFull === 'There is no empty field in the patch to sow.', sowAsk);
check('and every empty field in the three by three is sown, one seed each, and the crop and the grass left alone',
  sowAfter === '7:3:carrot:0' && sowSaid === 'You sow 7 fields with wheat.', `${sowAfter} | ${sowSaid}`);
const [shortAfter, shortSaid] = say('SOWSHORT').split('|');
check('and with seed for three of seven, three are sown and the go stops there', shortAfter === '3:0' && shortSaid === 'You sow 3 fields with wheat.',
  say('SOWSHORT'));
const [tendAsk, tendAfter, tendAgain, tendSaid] = say('TENDPATCH').split('|');
const [tendNoPerk, tendOk, tendNone] = tendAsk.split('#');
check(`${P('Tend a Patch').name}: refused without the perk and where nothing wants it, in its own words`,
  tendNoPerk === 'That wants a Farmer who has learned to tend a patch.' && tendOk === 'ALLOWED'
    && tendNone === 'Nothing in the patch wants tending.', tendAsk);
check('and the two that wanted it are tended, the one tended already and the ripe one not',
  tendAfter === '9,8=1:true 10,8=0:true 11,8=1:false 9,10=1:true' && tendAgain === 'Nothing in the patch wants tending.'
    && tendSaid === 'You weed and water 2 crops.', `${tendAfter} | ${tendAgain} | ${tendSaid}`);
const [harvAsk, harvAfter, harvSaid] = say('HARVESTPATCH').split('|');
const [harvNoPerk, harvNone, harvOk] = harvAsk.split('#');
check(`${P('Harvest a Patch').name}: refused without the perk and where nothing is ripe, in its own words`,
  harvNoPerk === 'That wants a Farmer who has learned to harvest a patch.' && harvNone === 'Nothing in the patch is ripe.'
    && harvOk === 'ALLOWED', harvAsk);
const wheatFull = cropYield(RIPE);
const wheatBare = cropYield(0);
check('and the three ripe ones are harvested, each for its own tending, and the green one left',
  harvAfter === `${wheatFull.produce + wheatBare.produce}:${wheatFull.seeds + wheatBare.seeds}:${wheatFull.produce}:${wheatFull.seeds}:1`
    && harvSaid === `You harvest 3 fields: ${wheatFull.produce + wheatBare.produce} × wheat, ${wheatFull.seeds + wheatBare.seeds} × wheat seeds, `
      + `${wheatFull.produce} × carrot, ${wheatFull.seeds} × carrot seeds. The fields are ready to sow again.`,
  `${harvAfter} | ${harvSaid}`);
check('a worker brings home the produce and leaves the seed in the furrow, and the field remembers nothing it did not sow',
  say('WORKER') === `wheat:${cropYield(RIPE).produce}:${cropYield(RIPE).seeds}:none`, say('WORKER'));
check('the three jobs are the browser\'s, and the farm\'s',
  say('JOBS') === ['harvest_patch', 'sow_patch', 'tend_patch'].map((id) => {
    const d = ACTION_BY_ID.get(id)!;
    return `${id}:${d.baseTime}:${d.stamina}:${d.skill ?? '-'}:${d.tool ?? '-'}:true:true`;
  }).join(','), say('JOBS'));
check('a patch harvest counts for the settlement\'s harvest bauble as a harvest does', say('BAUBLE') === '0:0', say('BAUBLE'));
check('and the Farmer\'s tree is gone', say('NODES') === '0', say('NODES'));

/* ---- the browser's half ------------------------------------------------------------------ */

const game = Game.create(3141);
const tile = (x: number, y: number, itemUid?: number): Target => ({ kind: 'tile', x, y, ...(itemUid !== undefined ? { itemUid } : {}) } as Target);
const ask = (id: string, x: number, y: number, itemUid?: number): string =>
  ACTION_BY_ID.get(id)!.check?.(tile(x, y, itemUid), game) ?? 'ALLOWED';
const run = (id: string, x: number, y: number, itemUid?: number): void => {
  ACTION_BY_ID.get(id)!.perform(tile(x, y, itemUid), game);
};
for (let x = 20; x <= 22; x++) for (let y = 20; y <= 22; y++) game.world.setTile(x, y, TileType.Field);
const seeds = game.inventory.add('wheat_seed', { count: 20, ql: 50 });
check('the browser refuses the three patch jobs without the perks in the island\'s words',
  ask('sow_patch', 21, 21, seeds.uid) === sowNoPerk && ask('tend_patch', 21, 21) === tendNoPerk && ask('harvest_patch', 21, 21) === harvNoPerk);
game.setPerks({ ...P('Sow a Patch').fx, ...P('Tend a Patch').fx, ...P('Harvest a Patch').fx });
check('and with them, no seed, and nothing to tend or harvest, in the island\'s words',
  ask('sow_patch', 21, 21) === sowNoSeed && ask('tend_patch', 21, 21) === tendNone && ask('harvest_patch', 21, 21) === harvNone);
run('sow_patch', 21, 21, seeds.uid);
check('and a patch sown in the browser sows the nine, one seed each',
  [...game.crops.values()].filter((c) => c.x >= 20 && c.x <= 22 && c.y >= 20 && c.y <= 22).length === 9
    && game.inventory.count('wheat_seed') === 11 && ask('sow_patch', 21, 21, seeds.uid) === sowFull,
  `${game.inventory.count('wheat_seed')} seeds left`);
for (const c of game.crops.values()) { c.stage = RIPE; c.tended = RIPE; }
check('and a ripe patch wants no tending and may be harvested', ask('tend_patch', 21, 21) === tendNone && ask('harvest_patch', 21, 21) === 'ALLOWED');
game.setPerks({ ...P('Harvest a Patch').fx, ...P('Bumper Crop').fx, ...P('Grain Master').fx, ...P('Fodder').fx });
const before = game.inventory.count('wheat');
run('harvest_patch', 21, 21);
const each = cropYield(RIPE, P('Bumper Crop').fx['bumper:harvest_crop']).produce + P('Grain Master').fx['plus:wheat'];
check('and harvested in the browser, each field gives its bumper and its two more, and its grass',
  game.inventory.count('wheat') - before === 9 * each && game.inventory.count('mixed_grass') === 9 * P('Fodder').fx['fodder:harvest_crop']
    && game.crops.size === 0,
  `${game.inventory.count('wheat') - before} wheat, ${game.inventory.count('mixed_grass')} grass`);
// Sowing's pace, and the field's last crop.
game.setPerks({ ...P('Fast Growth').fx, ...P('Crop Rotation').fx });
const carrots = game.inventory.add('carrot_seed', { count: 5, ql: 50 });
run('plant_seed', 21, 21, seeds.uid);
const wheatPace = game.cropAt(21, 21)?.pace ?? 1;
game.removeCrop(21, 21);
run('plant_seed', 21, 21, carrots.uid);
const carrotPace = game.cropAt(21, 21)?.pace ?? 1;
check('the browser stamps the same pace: Fast Growth on wheat after wheat, and Crop Rotation too on carrots after it',
  near(wheatPace, fg) && near(carrotPace, fg * cr), `${wheatPace} / ${carrotPace}`);
const c = game.cropAt(21, 21)!;
check('and counts the stage down at that pace', near(cropTimeLeft(c, c.stageAt) ?? 0, CROPS.carrot.stageSeconds * fg * cr), String(cropTimeLeft(c, c.stageAt)));
run('clear_field', 21, 21);
check('and forgets the last crop of a field broken up', game.lastSown(21, 21) === undefined && game.lastSown(20, 20) === 'wheat');
// The rake.
const rake = game.inventory.find('rake') ?? game.inventory.add('rake', { count: 1, ql: 20 });
const till = ACTION_BY_ID.get('till')!;
game.setPerks({});
const plainTill = game.duration(till);
game.setPerks(P('Worn-in Rake').fx);
const rakeTill = game.duration(till);
check(`and the browser's Till goes as with a rake ${up} QL better`,
  near(rakeTill / plainTill, factor(game.toolQl('rake') + up) / factor(game.toolQl('rake')), 1e-6), `${plainTill} → ${rakeTill} (QL ${rake.ql})`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Farmer's perks — ${ok.length} of ${ok.length}`);
