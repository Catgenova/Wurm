/**
 * The Carpenter's eighteen perks, each measured where its rule is.
 *
 * `perks.ts` holds the two sides to each other for every trade on perks --
 * the rows, the tiers, the fold, the choosing -- and this asks the one thing
 * that is the Carpenter's own: that each perk does what its note says, on the
 * island, with the dice taken out wherever they can be. A chance is put at
 * one inside the transaction, or the skill check made to pass or to fail
 * outright, so that a go must show the rule.
 *
 *   * the saw and the bench: Quick Saw's and Shipwright's time, Clean
 *     Sawing's, Heavy Timber's and Thatcher's count, String Maker's one yarn
 *     and sure hand, Sure Hull, and Master Joiner's rarity;
 *   * the maker's mark: Deep Drawers' chest, made, set down, holding more and
 *     picked up again with its mark; Keel Layer's and Deep Hold's boat; Smooth
 *     Axle's wagon behind its team; Bowyer's Draw's and True Bow's bow;
 *   * the tool: the bench wears it now, and Saw Care's saw half as much;
 *   * Fence Builder's bill and time, Timber Salvage, and Bridge Wright's time
 *     and span;
 *   * and the browser reads the same numbers where it asks or offers them.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID } from '../../src/game/actions';
import { fenceScale } from '../../src/game/buildActions';
import { MATERIAL_BY_ID, wallBill } from '../../src/game/building';
import { BRIDGES } from '../../src/game/bridges';
import { furnitureCapacity, furnitureDef, type PlacedFurniture } from '../../src/game/furniture';
import { bowRange, WEAPON_BY_ID, weaponDamage } from '../../src/game/gear';
import { makersMark, sameMark, type Item } from '../../src/game/items';
import { perksOf, type PerkDef } from '../../src/game/perks';
import { needOf, RECIPE_BY_ID, recipeReason } from '../../src/game/recipes';

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

const CARPENTER = perksOf('carpenter');
const P = (name: string): PerkDef => {
  const p = CARPENTER.find((x) => x.name === name);
  if (!p) throw new Error(`the Carpenter has no perk called ${name}`);
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
/** Every skill check passes, or every one fails, until it is said otherwise. */
const checks = (pass: boolean): string =>
  `create or replace function skill_check(p_skill double precision, p_difficulty double precision,
     p_tool_ql double precision default 0, p_ease double precision default 0)
     returns boolean language sql as 'select ${pass}'`;
/** Give the inputs of a recipe, `times` over. */
const inputs = (recipe: string, times = 1, extra = 'null'): string =>
  (RECIPE_BY_ID.get(recipe)?.inputs ?? []).map((i) => `perform give(w, u, '${i.item}', ${(i.count ?? 1) * times}, 30, ${extra});`).join('\n  ');
const craft = (recipe: string, uid = 'null'): string =>
  `perform perform_craft(w, u, '${recipe}', jsonb_build_object('kind', 'item', 'uid', ${uid}))`;
/** A wall of `mat` on a side of the building's tile at 9,9, planned and, if `done`, finished. */
const wall = (side: string, mat: string, done: boolean): string => `
  delete from wall w2 using border_of(9, 9, '${side}') bd
   where w2.world_id = w and w2.level = 0 and w2.dir = bd.dir and w2.x = bd.x and w2.y = bd.y;
  insert into wall (world_id, level, dir, x, y, building, type, material, needed, total, planned_by)
  select w, 0, bd.dir, bd.x, bd.y, v_b, 'solid', '${mat}',
         ${done ? `(select jsonb_object_agg(jk, 0) from jsonb_object_keys(wall_bill('${mat}', 'solid')) jk)` : `wall_bill('${mat}', 'solid')`},
         wall_bill('${mat}', 'solid'), u
    from border_of(9, 9, '${side}') bd`;
const side = (x: number, y: number, s: string): string => `jsonb_build_object('kind', 'tile', 'x', ${x}, 'y', ${y}, 'side', '${s}')`;
const refused = (action: string, target: string): string => `coalesce(act_refusal(w, u, '${action}', ${target}), 'ALLOWED')`;
const FENCE = side(13, 13, 'n');
const PLAN_FENCE = `${FENCE} || jsonb_build_object('wallType', 'fence', 'material', 'plank')`;

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
  j := rpc_act(w, a, t);
  select extract(epoch from act_ends - act_started) into v from player where world_id = w and uid = u;
  update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null,
         act_goes = null, act_queue = '[]' where world_id = w and uid = u;
  return coalesce(v::text, 'none') || ':' || coalesce(j->>'why', '-');
end $f$;

do $$
declare w uuid; u uuid; tx int; ty int; v_b int; v_log bigint; v_t text; v_u text; n int; k int; v_mul jsonb;
        v_it bigint; v_p bigint; v_plain bigint; v_boat bigint; v_cart bigint; v_orse int; v_bow bigint; v_beast int;
        v_wood bigint; v_rope bigint; v_a double precision; v_c double precision;
begin
  -- The suite's own island and its first body, who founded Lambfold and may shape it.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  for tx in 0..15 loop for ty in 0..15 loop
    perform land_set_height(w, tx, ty, 40); perform land_set_dirt(w, tx, ty, 20);
    perform land_set_tile(w, tx, ty, tile_id('Dirt')); perform land_set_data(w, tx, ty, 0);
  end loop; end loop;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  delete from player_node where world_id = w and uid = u;
  delete from caller where uid = u;
  update placed set driver = null where world_id = w and driver = u;
  update placed set puller = null where world_id = w and puller = u;
  update player set x = 9.5, y = 9.5, act = null, act_target = null, act_started = null, act_ends = null,
         act_left = null, act_goes = null, act_queue = '[]', craft_class = 'carpenter', combat_class = null,
         class_mul = null, level_h = null, rested = 0, boons = '[]'::jsonb, body_at = now(), swim_at = now(),
         equipped = '{}'::jsonb,
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
   where world_id = w and uid = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  insert into skill (world_id, uid, id, value)
    select w, u, s, 60 from unnest(array['carpentry', 'fine_carpentry', 'bowyery', 'fletching', 'archery']) s
    on conflict (world_id, uid, id) do update set value = excluded.value;
  perform give(w, u, 'saw', 1, 100);
  perform give(w, u, 'carving_knife', 1, 100);
  perform give(w, u, 'mallet', 1, 100);
  ${checks(true)};

  /* ---- Quick Saw: a go of Saw into planks, as the doors start it. ---- */
  v_log := give(w, u, 'log', 5, 30);
  perform pg_temp.hold(w, u, '{}');
  v_t := pg_temp.secs(w, u, 'make_planks', jsonb_build_object('kind', 'item', 'uid', v_log));
  ${hold('Quick Saw')};
  insert into said values ('SAWTIME', v_t || '|' || pg_temp.secs(w, u, 'make_planks', jsonb_build_object('kind', 'item', 'uid', v_log)));

  /* ---- Clean Sawing, Heavy Timber and Thatcher: what a go makes, and what it says. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${craft('make_planks', 'v_log')};
  v_t := ${count('plank')}::text;
  ${clear('plank')};
  ${hold('Clean Sawing')};
  ${craft('make_planks', 'v_log')};
  insert into said values ('PLANKS', v_t || '|' || ${count('plank')} || '|' || coalesce(${last('You saw the log into % planks.%')}, 'unsaid'));
  ${clear('plank')};
  perform pg_temp.hold(w, u, '{}');
  ${craft('make_timbers', 'v_log')};
  v_t := ${count('timber')}::text;
  ${clear('timber')};
  ${hold('Heavy Timber')};
  ${craft('make_timbers', 'v_log')};
  insert into said values ('TIMBERS', v_t || '|' || ${count('timber')});
  ${clear('timber', 'log')};
  perform give(w, u, 'mixed_grass', 4, 30);
  perform pg_temp.hold(w, u, '{}');
  ${craft('make_thatch', newest('mixed_grass'))};
  v_t := ${count('thatch')}::text;
  ${clear('thatch')};
  ${hold('Thatcher')};
  ${craft('make_thatch', newest('mixed_grass'))};
  insert into said values ('THATCH', v_t || '|' || ${count('thatch')} || '|' || ${count('mixed_grass')});
  ${clear('thatch', 'mixed_grass')};

  /* ---- Saw Care: the bench wears the saw a go, and the perk half as much. ---- */
  update item set dmg = 0, ql = 50 where world_id = w and holder = 'player' and holder_uid = u and def = 'saw';
  v_log := give(w, u, 'log', 2, 30);
  perform pg_temp.hold(w, u, '{}');
  ${craft('make_planks', 'v_log')};
  select dmg into v_a from item where world_id = w and holder = 'player' and holder_uid = u and def = 'saw';
  update item set dmg = 0 where world_id = w and holder = 'player' and holder_uid = u and def = 'saw';
  ${hold('Saw Care')};
  ${craft('make_planks', 'v_log')};
  select dmg into v_c from item where world_id = w and holder = 'player' and holder_uid = u and def = 'saw';
  insert into said values ('SAWCARE', v_a || '|' || v_c);
  update item set dmg = 0, ql = 100 where world_id = w and holder = 'player' and holder_uid = u and def = 'saw';
  ${clear('plank', 'log')};

  /* ---- String Maker: one yarn, refused for want of the second without it, and never failing. ---- */
  ${checks(false)};
  perform give(w, u, 'yarn', 1, 30);
  perform pg_temp.hold(w, u, '{}');
  v_t := coalesce(craft_refusal(w, u, 'make_bow_string', null), 'ALLOWED');
  ${hold('String Maker')};
  v_u := coalesce(craft_refusal(w, u, 'make_bow_string', null), 'ALLOWED');
  ${craft('make_bow_string', newest('yarn'))};
  insert into said values ('STRING', v_t || '|' || v_u || '|' || ${count('bow_string')} || '|' || ${count('yarn')});
  ${clear('bow_string', 'yarn')};

  /* ---- Sure Hull: a cart that fails without it, and with its failures put at nought. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${inputs('make_cart', 1, "'Pine'")}
  ${craft('make_cart', newest('plank'))};
  v_t := ${count('cart')}::text;
  ${clear('plank', 'shaft', 'nail', 'cart')};
  ${patch('Sure Hull', { 'fail:make_cart': 0 })};
  ${hold('Sure Hull')};
  ${inputs('make_cart', 1, "'Pine'")}
  ${craft('make_cart', newest('plank'))};
  insert into said values ('HULL', v_t || '|' || ${count('cart')});
  ${clear('plank', 'shaft', 'nail', 'cart')};
  ${checks(true)};

  /* ---- Master Joiner: a stool at the first step's odds put at one. ---- */
  ${patch('Master Joiner', { 'rare:make_stool': 1 })};
  ${hold('Master Joiner')};
  ${inputs('make_stool', 1, "'Pine'")}
  ${craft('make_stool', newest('plank'))};
  insert into said values ('JOINER', coalesce((select rare from item where id = ${newest('stool')}), 'plain'));
  ${clear('plank', 'shaft', 'nail', 'stool')};

  /* ---- Deep Drawers: a chest made with its mark, set down, holding more, and picked up with it. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${inputs('make_chest', 1, "'Pine'")}
  ${craft('make_chest', newest('plank'))};
  v_plain := ${newest('chest')};
  ${hold('Deep Drawers')};
  ${inputs('make_chest', 1, "'Pine'")}
  ${craft('make_chest', newest('plank'))};
  v_it := ${newest('chest')};
  v_t := coalesce((select mark::text from item where id = v_plain), 'none') || '#' || coalesce((select mark::text from item where id = v_it), 'none');
  perform act_perform(w, u, 'place_furniture', jsonb_build_object('kind', 'item', 'uid', v_plain, 'x', 12, 'y', 9, 'sx', 0, 'sy', 0));
  select id into v_plain from placed where world_id = w and sub = 'chest' and x = 12 and y = 9 order by id desc limit 1;
  perform act_perform(w, u, 'place_furniture', jsonb_build_object('kind', 'item', 'uid', v_it, 'x', 12, 'y', 11, 'sx', 0, 'sy', 0));
  select id into v_p from placed where world_id = w and sub = 'chest' and x = 12 and y = 11 order by id desc limit 1;
  v_t := v_t || '#' || coalesce((select mark::text from placed where id = v_p), 'none')
    || '#' || (select furniture_capacity(pl) from placed pl where pl.id = v_plain)
    || '#' || (select furniture_capacity(pl) from placed pl where pl.id = v_p);
  perform act_perform(w, u, 'pick_up_furniture', jsonb_build_object('kind', 'furniture', 'id', v_p));
  insert into said values ('DRAWERS', v_t || '#' || coalesce((select mark::text from item where id = ${newest('chest')}), 'none')
    || '#' || (select count(*) from placed where id = v_p));
  delete from placed where id = v_plain;
  ${clear('chest', 'plank', 'timber', 'nail')};

  /* ---- Keel Layer and Deep Hold: a boat made with both, launched, driven and loaded. ---- */
  ${hold('Keel Layer', 'Deep Hold')};
  ${inputs('make_rowing_boat', 1, "'Pine'")}
  ${craft('make_rowing_boat', newest('plank'))};
  v_it := ${newest('rowing_boat')};
  v_t := coalesce((select mark->>'speed' from item where id = v_it), 'none') || ',' || coalesce((select mark->>'hold' from item where id = v_it), 'none');
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, mark)
    values (w, 'furniture', 'rowing_boat', 15, 15, 0, 0, 15.5, 15.5, 40, u, (select mark from item where id = v_it)) returning id into v_boat;
  update placed set driver = u where id = v_boat;
  v_a := travel_speed(w, u);
  update placed set mark = null where id = v_boat;
  insert into said values ('BOAT', v_t || '|' || v_a || '|' || travel_speed(w, u)
    || '|' || (select furniture_capacity(pl) from placed pl where pl.id = v_boat));
  update placed set mark = (select mark from item where id = v_it) where id = v_boat;
  insert into said values ('HOLD', (select furniture_capacity(pl) from placed pl where pl.id = v_boat)::text);
  delete from placed where id = v_boat;
  ${clear('rowing_boat', 'plank', 'timber', 'shaft', 'rope', 'nail')};

  /* ---- Smooth Axle: a wagon's mark, and a large cart behind an orse with it and without. ---- */
  ${hold('Smooth Axle')};
  select class_mul into v_mul from player where world_id = w and uid = u;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, mark)
    values (w, 'furniture', 'large_cart', 5, 15, 0, 0, 5.5, 15.5, 40, u, made_mark(v_mul, 'large_cart')) returning id into v_cart;
  v_orse := creature_spawn(w, 'orse', 5.6, 15.4, 'deed', now() - interval '1 day', u);
  update creature set hitched_to = v_cart, hunger = 1 where world_id = w and id = v_orse;
  v_a := vehicle_speed(w, v_cart);
  update placed set mark = null where id = v_cart;
  insert into said values ('AXLE', coalesce(made_mark(v_mul, 'wagon')::text, 'none') || '|' || coalesce(made_mark(v_mul, 'cart')::text, 'none')
    || '|' || v_a || '|' || vehicle_speed(w, v_cart));
  delete from creature where world_id = w and id = v_orse;
  delete from placed where id = v_cart;

  /* ---- Bowyer's Draw and True Bow: a short bow made with both, what it hits for and how far it throws. ---- */
  ${hold("Bowyer's Draw", 'True Bow')};
  perform give(w, u, 'shaft', 2, 30, 'Willow');
  perform give(w, u, 'bow_string', 1, 30);
  ${craft('make_short_bow', newest('shaft'))};
  v_bow := ${newest('short_bow')};
  v_t := coalesce((select mark::text from item where id = v_bow), 'none');
  select weapon_damage(w, u, wd, it) into v_a from weapon_def wd, item it where wd.id = 'short_bow' and it.id = v_bow;
  update item set mark = null where id = v_bow;
  select weapon_damage(w, u, wd, it) into v_c from weapon_def wd, item it where wd.id = 'short_bow' and it.id = v_bow;
  v_t := v_t || '|' || (v_a / v_c);
  update player set equipped = jsonb_build_object('weapon', v_bow), x = 9.5, y = 9.5 where world_id = w and uid = u;
  perform give(w, u, 'arrow', 5, 30);
  v_beast := creature_spawn(w, 'bevere', 9.5 + 6.3, 9.5, 'wild', now() - interval '1 day', null);
  v_u := ${refused('shoot_creature', "jsonb_build_object('kind', 'creature', 'id', v_beast)")};
  update item set mark = '{"range": 1.1}'::jsonb where id = v_bow;
  insert into said values ('BOW', v_t || '|' || v_u || '|' || ${refused('shoot_creature', "jsonb_build_object('kind', 'creature', 'id', v_beast)")});
  delete from creature where world_id = w and id = v_beast;
  update player set equipped = '{}'::jsonb where world_id = w and uid = u;
  ${clear('short_bow', 'arrow', 'shaft', 'bow_string')};

  /* ---- Fence Builder: a plank fence planned for half, and a go of Build wall on it. ---- */
  update player set x = 13.5, y = 13.5 where world_id = w and uid = u;
  perform pg_temp.hold(w, u, '{}');
  perform perform_building(w, u, 'plan_fence', ${PLAN_FENCE});
  v_t := (wall_at(w, 13, 13, 'n')).needed::text;
  perform give(w, u, 'plank', 10, 30); perform give(w, u, 'timber', 2, 30);
  v_t := v_t || '#' || pg_temp.secs(w, u, 'build_wall', ${FENCE});
  delete from wall w2 using border_of(13, 13, 'n') bd
   where w2.world_id = w and w2.level = 0 and w2.dir = bd.dir and w2.x = bd.x and w2.y = bd.y;
  ${hold('Fence Builder')};
  perform perform_building(w, u, 'plan_fence', ${PLAN_FENCE});
  insert into said values ('FENCE', v_t || '#' || (wall_at(w, 13, 13, 'n')).needed::text
    || '#' || pg_temp.secs(w, u, 'build_wall', ${FENCE}));
  delete from wall w2 using border_of(13, 13, 'n') bd
   where w2.world_id = w and w2.level = 0 and w2.dir = bd.dir and w2.x = bd.x and w2.y = bd.y;
  ${clear('plank', 'timber')};

  /* ---- Timber Salvage: a finished plank wall taken down, and what comes back. ---- */
  update player set x = 9.5, y = 9.5 where world_id = w and uid = u;
  select coalesce(max(id), 0) + 1 into v_b from building where world_id = w;
  insert into building (world_id, id, name, planned_by) values (w, v_b, 'Barn', u);
  insert into building_tile (world_id, building, x, y) values (w, v_b, 9, 9), (w, v_b, 10, 9);
  ${wall('s', 'plank', true)};
  perform pg_temp.hold(w, u, '{}');
  perform perform_building(w, u, 'remove_wall', ${side(9, 9, 's')});
  v_t := ${count('plank')}::text;
  ${wall('s', 'plank', true)};
  ${hold('Timber Salvage')};
  perform perform_building(w, u, 'remove_wall', ${side(9, 9, 's')});
  insert into said values ('SALVAGE', v_t || '|' || ${count('plank')});
  ${clear('plank')};

  /* ---- Bridge Wright: the time of a go on a wooden and a rope bridge, and how far each spans. ---- */
  insert into bridge (world_id, kind, ax, ay, bx, by, height, made_by, level)
    values (w, 'wood', 1, 14, 5, 14, 40, u, 0) returning id into v_wood;
  insert into bridge (world_id, kind, ax, ay, bx, by, height, made_by, level)
    values (w, 'rope', 1, 15, 5, 15, 40, u, 0) returning id into v_rope;
  perform pg_temp.hold(w, u, '{}');
  select class_mul into v_mul from player where world_id = w and uid = u;
  v_t := perk_time(v_mul, w, 'build_bridge', jsonb_build_object('kind', 'bridge', 'id', v_wood))
    || '#' || perk_time(v_mul, w, 'build_bridge', jsonb_build_object('kind', 'bridge', 'id', v_rope))
    || '#' || coalesce(bridge_reason(w, u, 'wood', 1, 13, 13, 13), 'ALLOWED');
  ${hold('Bridge Wright')};
  select class_mul into v_mul from player where world_id = w and uid = u;
  insert into said values ('BRIDGE', v_t || '|' || perk_time(v_mul, w, 'build_bridge', jsonb_build_object('kind', 'bridge', 'id', v_wood))
    || '#' || perk_time(v_mul, w, 'build_bridge', jsonb_build_object('kind', 'bridge', 'id', v_rope))
    || '#' || coalesce(bridge_reason(w, u, 'wood', 1, 13, 13, 13), 'ALLOWED')
    || '#' || coalesce(bridge_reason(w, u, 'wood', 1, 13, 15, 13), 'ALLOWED'));
  delete from bridge where world_id = w and id in (v_wood, v_rope);
end $$;

select k || E'\\t' || coalesce(v, 'null') from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const i = l.indexOf('\t');
  return [l.slice(0, i), l.slice(i + 1)] as [string, string];
}));
const say = (k: string): string => said.get(k) ?? 'unsaid';
const secsOf = (s: string): number => Number(s.split(':')[0]);

/* ---- the island's half -------------------------------------------------------------- */

const [sawA, sawB] = say('SAWTIME').split('|');
check(`${P('Quick Saw').name}: a go of Saw into planks takes ${P('Quick Saw').fx['time:make_planks']} of the time with it`,
  near(secsOf(sawB) / secsOf(sawA), P('Quick Saw').fx['time:make_planks'], 1e-3), say('SAWTIME'));

const planks = RECIPE_BY_ID.get('make_planks')!;
const [pA, pB, pSaid] = say('PLANKS').split('|');
check(`${P('Clean Sawing').name}: a log saws into ${P('Clean Sawing').fx['count:plank']} planks with it, ${planks.count} without`,
  Number(pA) === planks.count && Number(pB) === P('Clean Sawing').fx['count:plank'], say('PLANKS'));
check('and the go says four', /^You saw the log into four planks\./.test(pSaid), pSaid);
const [tA, tB] = say('TIMBERS').split('|');
check(`${P('Heavy Timber').name}: a log saws into ${P('Heavy Timber').fx['count:timber']} timbers with it, ${RECIPE_BY_ID.get('make_timbers')!.count} without`,
  Number(tA) === RECIPE_BY_ID.get('make_timbers')!.count && Number(tB) === P('Heavy Timber').fx['count:timber'], say('TIMBERS'));
const [thA, thB, grass] = say('THATCH').split('|');
check(`${P('Thatcher').name}: two mixed grass bundle into ${P('Thatcher').fx['count:thatch']} thatch with it, one without`,
  Number(thA) === 1 && Number(thB) === P('Thatcher').fx['count:thatch'] && Number(grass) === 0, say('THATCH'));

const [wearA, wearB] = say('SAWCARE').split('|').map(Number);
check('the bench wears the saw a go, as the browser always has', wearA > 0, say('SAWCARE'));
check(`${P('Saw Care').name}: and ${P('Saw Care').fx['wear:saw']} as much with it`,
  near(wearB / wearA, P('Saw Care').fx['wear:saw'], 1e-4), say('SAWCARE'));

const [strA, strB, strings, yarn] = say('STRING').split('|');
check(`${P('String Maker').name}: one yarn is refused without it, in the browser's words`, strA === 'Bowstring takes 2 yarns.', strA);
check('and allowed with it, and a go that cannot fail makes the string out of the one', strB === 'ALLOWED' && strings === '1' && yarn === '0',
  say('STRING'));

check(`${P('Sure Hull').name}: a cart that fails without it is made with its failures put at nought`, say('HULL') === '0|1', say('HULL'));
check(`${P('Master Joiner').name}: a stool comes out rare with the first step's odds put at one`, ['rare', 'supreme', 'fantastic'].includes(say('JOINER')),
  say('JOINER'));

const [dPlain, dMarked, dPlaced, dCapA, dCapB, dBack, dGone] = say('DRAWERS').split('#');
const hold12 = P('Deep Drawers').fx['hold:chest'];
check(`${P('Deep Drawers').name}: a chest made without it has no mark, and with it one of ${hold12}`,
  dPlain === 'none' && JSON.parse(dMarked).hold === hold12, `${dPlain} / ${dMarked}`);
check('set down, the chest keeps its mark on the ground', dPlaced !== 'none' && JSON.parse(dPlaced).hold === hold12, dPlaced);
check(`and holds ${Math.round(Number(dCapA) * hold12)} where a plain pine chest holds ${dCapA}`,
  Number(dCapB) === Math.round(Number(dCapA) * hold12), `${dCapA} / ${dCapB}`);
check('and picked up again, the mark comes back into the pack with it', dBack !== 'none' && JSON.parse(dBack).hold === hold12 && dGone === '0',
  `${dBack} / ${dGone}`);

const [boatMark, boatFast, boatPlain, boatCap] = say('BOAT').split('|');
const rower = furnitureDef('rowing_boat');
check(`${P('Keel Layer').name} and ${P('Deep Hold').name}: a rowing boat made with both carries both`,
  boatMark === `${P('Keel Layer').fx['speed:rowing_boat']},${P('Deep Hold').fx['hold:rowing_boat']}`, boatMark);
check(`and goes ${P('Keel Layer').fx['speed:rowing_boat']} as fast as one without, as the island reckons it`,
  near(Number(boatFast), (rower.boat?.speed ?? 0) * P('Keel Layer').fx['speed:rowing_boat']) && near(Number(boatPlain), rower.boat?.speed ?? 0),
  `${boatFast} / ${boatPlain}`);
check(`and holds ${Math.round((rower.capacity ?? 0) * P('Deep Hold').fx['hold:rowing_boat'])} where one without holds ${rower.capacity}`,
  Number(boatCap) === rower.capacity && Number(say('HOLD')) === Math.round((rower.capacity ?? 0) * P('Deep Hold').fx['hold:rowing_boat']),
  `${boatCap} / ${say('HOLD')}`);

const [axWagon, axCart, axFast, axPlain] = say('AXLE').split('|');
const axle = P('Smooth Axle').fx['speed:large_cart'];
check(`${P('Smooth Axle').name}: a wagon made with it is marked, and a hand cart is not`,
  axWagon !== 'none' && JSON.parse(axWagon).speed === axle && axCart === 'none', `${axWagon} / ${axCart}`);
check(`and a large cart behind an orse goes ${axle} as fast with the mark`,
  Number(axPlain) > 0 && near(Number(axFast) / Number(axPlain), axle, 1e-6), `${axFast} / ${axPlain}`);

const [bowMark, bowHit, bowFar, bowNear] = say('BOW').split('|');
check(`${P("Bowyer's Draw").name} and ${P('True Bow').name}: a short bow made with both carries both`,
  bowMark !== 'none' && JSON.parse(bowMark).damage === P("Bowyer's Draw").fx['damage:short_bow']
    && JSON.parse(bowMark).range === P('True Bow').fx['range:short_bow'], bowMark);
check(`and hits ${P("Bowyer's Draw").fx['damage:short_bow']} as hard, as the island reckons it`,
  near(Number(bowHit), P("Bowyer's Draw").fx['damage:short_bow'], 1e-6), bowHit);
check(`and reaches a beast at 6.3 tiles, which a plain one's ${WEAPON_BY_ID.get('short_bow')!.range} do not`,
  bowFar === 'Too far for a short bow.' && bowNear === 'ALLOWED', `${bowFar} / ${bowNear}`);

const [fBillA, fTimeA, fBillB, fTimeB] = say('FENCE').split('#');
const halfFence = wallBill('plank', 'fence', P('Fence Builder').fx['bill:fence']).needed;
check(`${P('Fence Builder').name}: a plank fence is planned for ${JSON.stringify(halfFence)} with it, as the browser bills it`,
  JSON.stringify(JSON.parse(fBillA)) === JSON.stringify(wallBill('plank', 'fence').needed)
    && JSON.stringify(JSON.parse(fBillB)) === JSON.stringify(halfFence), `${fBillA} / ${fBillB}`);
check(`and a go of Build wall on it takes ${P('Fence Builder').fx['time:fence']} of the time`,
  near(secsOf(fTimeB) / secsOf(fTimeA), P('Fence Builder').fx['time:fence'], 1e-3), `${fTimeA} / ${fTimeB}`);

const plankWall = MATERIAL_BY_ID.get('plank')!;
const back = Math.floor(plankWall.bill[0][1] * P('Timber Salvage').fx['salvage:build_wood']);
check(`${P('Timber Salvage').name}: a plank wall taken down gives back ${back} of its ${plankWall.bill[0][1]} planks with it, none without`,
  say('SALVAGE') === `0|${back}`, say('SALVAGE'));

const [brA, brB] = say('BRIDGE').split('|');
const [wA, rA, spanA] = brA.split('#');
const [wB, rB, spanB, spanC] = brB.split('#');
const bw = P('Bridge Wright').fx;
check(`${P('Bridge Wright').name}: a go on a wooden and a rope bridge takes ${bw['time:bridge_wood']} of the time with it`,
  wA === '1' && rA === '1' && near(Number(wB), bw['time:bridge_wood']) && near(Number(rB), bw['time:bridge_rope']), say('BRIDGE'));
// Eleven tiles between the ends: too long for a plain wooden bridge, and past the span with the perk
// (the ground under it is what refuses it then); thirteen is too long either way.
check(`and a wooden bridge spans ${bw['span:bridge_wood']} tiles with it, ${BRIDGES.wood.span} without`,
  spanA === `A wooden bridge spans ${BRIDGES.wood.span} tiles; that is 11.` && !spanB.includes('spans')
    && spanC === `A wooden bridge spans ${bw['span:bridge_wood']} tiles; that is 13.`, say('BRIDGE'));

/* ---- the browser's half ------------------------------------------------------------ */

const game = Game.create(2718);
const bowstring = RECIPE_BY_ID.get('make_bow_string')!;
game.inventory.add('yarn', { count: 1, ql: 30 });
check('the browser refuses a bowstring from one yarn without String Maker',
  recipeReason(bowstring, game) === 'Bowstring takes 2 yarns.', String(recipeReason(bowstring, game)));
game.setPerks(P('String Maker').fx);
check('and offers it with the perk, for one', recipeReason(bowstring, game) === null && needOf(game, bowstring, bowstring.inputs[0]) === 1,
  String(recipeReason(bowstring, game)));
game.setPerks({});
const sawGo = game.duration(ACTION_BY_ID.get('make_planks')!);
game.setPerks({ ...P('Quick Saw').fx, ...P('Clean Sawing').fx });
check('the browser times a go of Saw into planks and counts its planks with the perks',
  near(game.duration(ACTION_BY_ID.get('make_planks')!) / sawGo, P('Quick Saw').fx['time:make_planks'], 1e-6) && game.madeAGo(planks) === 4,
  `${game.duration(ACTION_BY_ID.get('make_planks')!)} / ${sawGo}, ${game.madeAGo(planks)}`);
game.setPerks(P('Fence Builder').fx);
check('the browser plans a fence type for half its material with Fence Builder, and a solid wall whole',
  fenceScale(game, 'fence') === P('Fence Builder').fx['bill:fence'] && fenceScale(game, 'half_wall') === P('Fence Builder').fx['bill:fence']
    && fenceScale(game, 'solid') === 1);
const perkOf = (fx: Record<string, number>) => (key: string, otherwise: number): number => fx[key] ?? otherwise;
const chestMark = makersMark(perkOf(P('Deep Drawers').fx), 'chest');
check('the browser marks a chest as the island does, and nothing for a thing the perk does not name',
  chestMark?.hold === hold12 && makersMark(perkOf(P('Deep Drawers').fx), 'stool') === undefined, JSON.stringify(chestMark));
const chest = (mark?: { hold: number }): PlacedFurniture => ({ id: 1, x: 0, y: 0, sx: 0, sy: 0, kind: 'chest', ql: 40, items: [], material: 'Pine', mark });
check('and a marked chest holds what the island says it holds', furnitureCapacity(chest(chestMark as { hold: number })) === Number(dCapB)
  && furnitureCapacity(chest()) === Number(dCapA), `${furnitureCapacity(chest(chestMark as { hold: number }))} / ${dCapB}`);
const shortBow = WEAPON_BY_ID.get('short_bow')!;
const bowItem = (mark?: Item['mark']): Item => ({ uid: 9, id: 'short_bow', ql: 50, dmg: 0, count: 1, extra: 'Willow', mark });
const marked = bowItem({ damage: P("Bowyer's Draw").fx['damage:short_bow'], range: P('True Bow').fx['range:short_bow'] });
check('the browser reckons a marked bow\'s damage and range as the island does',
  near(weaponDamage(game, shortBow, marked) / weaponDamage(game, shortBow, bowItem()), P("Bowyer's Draw").fx['damage:short_bow'], 1e-9)
    && near(bowRange(shortBow, marked), (shortBow.range ?? 0) * P('True Bow').fx['range:short_bow']) && bowRange(shortBow, bowItem()) === shortBow.range);
check('and two things of different marks are not one pile', !sameMark(marked, bowItem()) && sameMark(bowItem(), bowItem()));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Carpenter's perks — ${ok.length} of ${ok.length}`);
