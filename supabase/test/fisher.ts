/**
 * The Fisher's eighteen perks, each measured where its rule is.
 *
 * `perks.ts` holds the two sides to each other for every trade on perks; this
 * asks the one thing that is the Fisher's own: that each perk does what its
 * note says, on the island. Where a perk is a chance, the island's dice are put
 * either side of its number inside the transaction (`dice.random`, first on the
 * search path), so a go shows the number itself:
 *
 *   * the reach: Long Cast's line and Wide Net's net, to water further off and
 *     to the deepest water in the whole tiles their reach spans;
 *   * a bite: Steady Hand's points on a fish staying on, Strong Bait's pull,
 *     Big Fish's weight on the rod, in the net and in a creel;
 *   * the bait: Bait Saver's bait left on the hook, Any Bait's food on the
 *     hook and in a creel, and its help keeping a fish on;
 *   * the catch: Rare Catch's rare ones, Full Net's more to a haul;
 *   * the time and the wear: Quick Cast, Quick Net, Rod Care and Net Care;
 *   * Deep Creel's creel holding more, Cool Pack's fish rotting slower where
 *     they lie, Smoke Fish's smoked fish, the Fishing Journal's line on the
 *     water, and a Fish Pond stocking itself on the clock's tidying round;
 *   * the Fisher's tree gone;
 *   * and the browser reckons and says the same.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import {
  BAIT_BY_ID, BAIT_PULL, BAIT_SHY, biteWeight, CAST, castAt, catchFish, FISH, fishJournal, HOOK_MOST, NET_HAUL, NET_LEAST, NET_REACH,
  netReach, staysOn, type FishDef, type PerkOf,
} from '../../src/game/fishing';
import { furnitureDef, furnitureRefuses, POND_EVERY, type PlacedFurniture } from '../../src/game/furniture';
import { makersMark, RARITIES } from '../../src/game/items';
import { perksOf, type Fx, type PerkDef } from '../../src/game/perks';
import { RECIPE_BY_ID, RECIPE_PERK_SAYS, recipeReason } from '../../src/game/recipes';
import { creelHold, TRAPS, type PlacedTrap } from '../../src/game/traps';

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

const FISHER = perksOf('fisher');
const P = (name: string): PerkDef => {
  const p = FISHER.find((x) => x.name === name);
  if (!p) throw new Error(`the Fisher has no perk called ${name}`);
  return p;
};
const fx = (name: string, key: string): number => {
  const v = P(name).fx[key];
  if (v === undefined) throw new Error(`${name} has no ${key}`);
  return v;
};
const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const hold = (...names: string[]): string =>
  `perform pg_temp.hold(w, u, array[${names.map((n) => q(P(n).id)).join(', ')}]::text[])`;
const count = (def: string): string =>
  `(select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = '${def}')`;
const newest = (def: string): string =>
  `(select i.id from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = '${def}' order by i.id desc limit 1)`;
const clearAll = `delete from item where world_id = w and holder = 'player' and holder_uid = u`;
const fishCount = `(select coalesce(sum(i.count), 0) from item i join fish_def f on f.id = i.def
  where i.world_id = w and i.holder = 'player' and i.holder_uid = u)`;
const fishIds = `(select coalesce(string_agg(i.def || coalesce('/' || i.rare, ''), ',' order by i.def), 'none') from item i join fish_def f on f.id = i.def
  where i.world_id = w and i.holder = 'player' and i.holder_uid = u)`;
const clearFish = `delete from item i using fish_def f where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = f.id`;
const last = (like: string): string =>
  `(select e.text from event e where e.world_id = w and e.uid = u and e.text like ${q(like)} order by e.n desc limit 1)`;
const tile = (x: number, y: number): string => `jsonb_build_object('kind', 'tile', 'x', ${x}, 'y', ${y}, 'cx', ${x + 0.5}, 'cy', ${y + 0.5})`;
const go = (a: string, x: number, y: number): string => `perform perform_fish(w, u, '${a}', ${tile(x, y)})`;
const refused = (a: string, x: number, y: number): string => `coalesce(act_refusal(w, u, '${a}', ${tile(x, y)}), 'ALLOWED')`;
const craft = (r: string): string => `perform perform_craft(w, u, '${r}', jsonb_build_object('kind', 'item', 'uid', null))`;
const craftRefused = (r: string): string => `coalesce(act_refusal(w, u, '${r}', jsonb_build_object('kind', 'item', 'uid', null)), 'ALLOWED')`;
const inputs = (recipe: string): string =>
  (RECIPE_BY_ID.get(recipe)?.inputs ?? []).map((i) => `perform give(w, u, '${i.item}', ${i.count ?? 1}, 30);`).join('\n  ');
const checks = (pass: boolean): string =>
  `create or replace function skill_check(p_skill double precision, p_difficulty double precision,
     p_tool_ql double precision default 0, p_ease double precision default 0)
     returns boolean language sql as 'select ${pass}'`;
const dice = (...xs: number[]): string => `perform pg_temp.dice('${xs.join(',')}')`;
const nodice = 'perform pg_temp.nodice()';
const mul = `(select class_mul from player where world_id = w and uid = u)`;
const markOfRow = (id: string): string => `coalesce((select mark::text from item where id = ${id}), 'none')`;

const HANDS = 40;
const SKILL = 70;
const ROD_QL = 40;
const NET_QL = 40;
const SPACE = 'between 4 and 15';
/** The pond the test fishes: whole tiles from here, thirty deep, where every fish runs. */
const DEEP = 30;
const WX = 11;
const WY = 9;
/** Dice for a pick: a bait's pull and a big fish's weight each move the fish these give. */
const PULL_ROLL = 0.9;
const BIG_ROLL = 0.2;
const RARE_BELOW = fx('Rare Catch', 'rare:fish') / 2;
const RARE_ABOVE = fx('Rare Catch', 'rare:fish') * 2;
const HAUL_ROLL = 0.1;
const CREEL_ROLLS = 20;
const POND_QL = 50;
const POND_STOCK = 0.95;
const POND_ROLL = 0.1;

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

create function pg_temp.hold(w uuid, u uuid, ids text[]) returns jsonb language plpgsql as $f$
begin
  delete from player_node where world_id = w and uid = u;
  insert into player_node (world_id, uid, node) select w, u, x from unnest(ids) x;
  return class_fold(w, u);
end $f$;
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
create schema dice;
create function dice.random() returns double precision language plpgsql volatile as $f$
declare xs text[] := string_to_array(current_setting('wurm.dice'), ',');
        n int := coalesce(nullif(current_setting('wurm.dice_n', true), ''), '0')::int;
begin
  perform set_config('wurm.dice_n', (n + 1)::text, true);
  return xs[1 + n % array_length(xs, 1)]::double precision;
end $f$;
create function pg_temp.dice(v text) returns void language plpgsql as $f$
begin
  perform set_config('wurm.dice', v, true);
  perform set_config('wurm.dice_n', '0', true);
  perform set_config('search_path', 'dice, public, pg_catalog', true);
end $f$;
create function pg_temp.nodice() returns void language plpgsql as $f$
begin
  perform set_config('search_path', '"$user", public', true);
end $f$;
create or replace function product_ql(p_skill double precision, p_tool_ql double precision default 0)
  returns double precision language sql as 'select ${HANDS}::double precision';
-- Nothing a settlement's baubles do to a go's yield: this counts what a go gives.
create or replace function bauble_yield(p_world uuid, p_uid uuid, p_item text, p_n integer)
  returns integer language sql as 'select p_n';

do $$
declare w uuid; u uuid; tx int; ty int; v_t text; v_it bigint; v_p bigint; v_pond bigint;
        v_a double precision; v_b double precision; v_rod double precision; v_m1 jsonb; v_m2 jsonb; v_m3 jsonb;
begin
  -- The suite's own island and its first body, a Fisher now, on flat grass on their settlement, a deep pond east of them.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  for tx in 0..15 loop for ty in 0..15 loop
    perform land_set_height(w, tx, ty, 40); perform land_set_dirt(w, tx, ty, 20);
    perform land_set_tile(w, tx, ty, tile_id('Grass')); perform land_set_data(w, tx, ty, 0);
  end loop; end loop;
  for tx in ${WX}..${WX + 4} loop for ty in ${WY - 1}..${WY + 3} loop
    perform land_set_height(w, tx, ty, -${DEEP});
  end loop; end loop;
  ${clearAll};
  delete from item where world_id = w and holder = 'ground' and gx between 0 and 15 and gy between 0 and 15;
  delete from item where world_id = w and holder = 'crate'
     and crate in (select c.id from crate c where c.world_id = w and c.x between 0 and 15 and c.y between 0 and 15);
  delete from player_node where world_id = w and uid = u;
  delete from item where world_id = w and holder in ('trap', 'furniture')
     and placed in (select id from placed where world_id = w and x ${SPACE} and y ${SPACE});
  delete from placed where world_id = w and x ${SPACE} and y ${SPACE};
  update creature set rider = null where world_id = w and rider = u;
  delete from creature where world_id = w and from_x between 0 and 16 and from_y between 0 and 16;
  delete from caller where uid = u;
  update player set way = null where world_id = w;
  update player set x = 9.5, y = 9.5, act = null, act_target = null, act_started = null, act_ends = null,
         act_left = null, act_goes = null, act_queue = '[]', craft_class = 'fisher', combat_class = null,
         class_mul = null, level_h = null, rested = 0, boons = '[]'::jsonb, body_at = now(), swim_at = now(),
         equipped = '{}'::jsonb, craft_from_stores = true, craft_spare_rare = false, wounds = '[]'::jsonb,
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1, 'hurtSettled', now())
   where world_id = w and uid = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  insert into skill (world_id, uid, id, value)
    select w, u, s, ${SKILL} from unnest(array['fishing', 'ropemaking']) s
    on conflict (world_id, uid, id) do update set value = excluded.value;
  -- A lit fire beside them, for the smoking.
  insert into placed (world_id, kind, x, y, sx, sy, cx, cy, ql, made_by, lit, fuel, since)
    values (w, 'campfire', 8, 10, 0, 0, 8.25, 10.25, 40, u, true, 3600, now());
  ${checks(true)};
  insert into said values ('DEED', coalesce((deed_at(w, 9, 10)).name, 'none'));
  insert into said values ('DEPTH', water_depth(w, ${WX}, ${WY})::text);

  /* ---- Long Cast: from five tiles off, water is too far and none is within the box a cast spans; with it, both reach. ---- */
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'fishing_rod', 1, ${ROD_QL});
  update player set x = ${WX - 5 + 0.5}, y = ${WY + 0.5} where world_id = w and uid = u;
  v_t := ${refused('fish', WX, WY)} || '#' || ${refused('fish', WX - 4, WY)};
  ${hold('Long Cast')};
  v_t := v_t || '#' || ${refused('fish', WX, WY)} || '#' || ${refused('fish', WX - 4, WY)};
  insert into said values ('CAST', v_t);
  ${clearAll};

  /* ---- Wide Net: from three tiles off, the same for a net. ---- */
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'fishing_net', 1, ${NET_QL});
  update player set x = ${WX - 3 + 0.5}, y = ${WY + 0.5} where world_id = w and uid = u;
  v_t := ${refused('drag_net', WX, WY)} || '#' || ${refused('drag_net', WX - 3, WY - 1)};
  ${hold('Wide Net')};
  v_t := v_t || '#' || ${refused('drag_net', WX, WY)} || '#' || ${refused('drag_net', WX - 3, WY - 1)};
  insert into said values ('NET', v_t);
  ${clearAll};
  update player set x = 9.5, y = 9.5 where world_id = w and uid = u;

  /* ---- Quick Cast and Quick Net: a go of each started with their share of the time. ---- */
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'fishing_rod', 1, ${ROD_QL});
  perform give(w, u, 'fishing_net', 1, ${NET_QL});
  v_t := pg_temp.secs(w, u, 'fish', ${tile(WX, WY)}) || '|' || pg_temp.secs(w, u, 'drag_net', ${tile(WX, WY)});
  ${hold('Quick Cast', 'Quick Net')};
  v_t := v_t || '|' || pg_temp.secs(w, u, 'fish', ${tile(WX, WY)}) || '|' || pg_temp.secs(w, u, 'drag_net', ${tile(WX, WY)});
  insert into said values ('TIME', v_t);
  ${clearAll};

  /* ---- Steady Hand: the dice between the chance a fish stays on without it and with it. ---- */
  perform give(w, u, 'fishing_rod', 1, ${ROD_QL});
  v_rod := tool_ql(w, u, 'fishing_rod');
  v_a := stays_on(skill_of(w, u, 'fishing'), v_rod, false, 0);
  v_b := stays_on(skill_of(w, u, 'fishing'), v_rod, false, ${fx('Steady Hand', 'hook:fish')});
  perform pg_temp.hold(w, u, '{}');
  perform pg_temp.dice(((v_a + v_b) / 2)::text);
  ${go('fish', WX, WY)};
  v_t := ${fishCount}::text;
  ${hold('Steady Hand')};
  perform pg_temp.dice(((v_a + v_b) / 2)::text);
  ${go('fish', WX, WY)};
  ${nodice};
  insert into said values ('HOOK', v_t || ':' || ${fishCount} || '|' || v_a || '|' || v_b || '|' || v_rod);
  ${clearFish};

  /* ---- Bait Saver: a fish that comes off takes the worm without it and leaves it with it; a landed one takes it. ---- */
  perform give(w, u, 'worm', 3, 30);
  perform pg_temp.hold(w, u, '{}');
  ${dice(0.99)};
  ${go('fish', WX, WY)};
  v_t := ${count('worm')}::text;
  ${hold('Bait Saver')};
  ${dice(0.99)};
  ${go('fish', WX, WY)};
  v_t := v_t || ':' || ${count('worm')};
  ${dice(0.01)};
  ${go('fish', WX, WY)};
  ${nodice};
  insert into said values ('SPARE', v_t || ':' || ${count('worm')} || ':' || ${fishCount});
  ${clearAll};

  /* ---- Any Bait: food with nothing that draws a fish, on the hook and for a creel; and it helps a fish stay on. ---- */
  perform give(w, u, 'fishing_rod', 1, ${ROD_QL});
  perform give(w, u, 'cooked_fish', 1, 30);
  perform pg_temp.hold(w, u, '{}');
  v_t := coalesce(bait_for(w, u, ${DEEP}, ${SKILL}), 'none') || ':' || coalesce((bait_in_pack(w, u, true)).def, 'none');
  v_a := stays_on(skill_of(w, u, 'fishing'), tool_ql(w, u, 'fishing_rod'), false, 0);
  v_b := stays_on(skill_of(w, u, 'fishing'), tool_ql(w, u, 'fishing_rod'), true, 0);
  perform pg_temp.dice(((v_a + v_b) / 2)::text);
  ${go('fish', WX, WY)};
  v_t := v_t || '|' || ${fishCount} || ':' || ${count('cooked_fish')};
  ${nodice};
  ${hold('Any Bait')};
  v_t := v_t || '|' || coalesce(bait_for(w, u, ${DEEP}, ${SKILL}), 'none') || ':' || coalesce((bait_in_pack(w, u, true)).def, 'none');
  perform pg_temp.dice(((v_a + v_b) / 2)::text);
  ${go('fish', WX, WY)};
  ${nodice};
  insert into said values ('ANY', v_t || '|' || ${fishCount} || ':' || ${count('cooked_fish')} || '|' || coalesce(${last('You land %')}, 'unsaid'));
  ${clearAll};

  /* ---- Strong Bait and Big Fish: the pick itself, the dice held, and the weights it is made of. ---- */
  perform pg_temp.hold(w, u, '{}');
  v_m1 := ${mul};
  ${hold('Strong Bait')};
  v_m2 := ${mul};
  ${hold('Big Fish')};
  v_m3 := ${mul};
  insert into said values ('PICK', pick_fish(${DEEP}, ${SKILL}, 'minnow', ${PULL_ROLL}, v_m1) || ':' || pick_fish(${DEEP}, ${SKILL}, 'minnow', ${PULL_ROLL}, v_m2)
    || '#' || pick_fish(${DEEP}, ${SKILL}, null, ${BIG_ROLL}, v_m1) || ':' || pick_fish(${DEEP}, ${SKILL}, null, ${BIG_ROLL}, v_m3));
  insert into said values ('WEIGHTS', (select string_agg(f.id || '=' || bite_weight(f.id, f.weight, 'minnow', v_m2) || '/'
    || bite_weight(f.id, f.weight, null, v_m3) || '/' || bite_weight(f.id, f.weight, 'cooked_fish', v_m1), ',' order by f.id) from fish_def f));
  -- And Big Fish in a net: the same dice, a minnow without it and a trout with it.
  perform give(w, u, 'fishing_net', 1, ${NET_QL});
  perform pg_temp.hold(w, u, '{}');
  ${dice(BIG_ROLL)};
  ${go('drag_net', WX, WY)};
  v_t := ${fishIds};
  ${clearFish};
  ${hold('Big Fish')};
  ${dice(BIG_ROLL)};
  ${go('drag_net', WX, WY)};
  ${nodice};
  insert into said values ('BIGNET', v_t || ':' || ${fishIds});
  ${clearAll};

  /* ---- Full Net: the same haul, and two more with it. ---- */
  perform give(w, u, 'fishing_net', 1, ${NET_QL});
  perform pg_temp.hold(w, u, '{}');
  ${dice(HAUL_ROLL)};
  ${go('drag_net', WX, WY)};
  v_t := ${fishCount}::text;
  ${clearFish};
  ${hold('Full Net')};
  ${dice(HAUL_ROLL)};
  ${go('drag_net', WX, WY)};
  ${nodice};
  insert into said values ('HAUL', v_t || ':' || ${fishCount});
  ${clearAll};

  /* ---- Rare Catch: the dice under its number, a rare fish all the way, rod and net; over it, none. ---- */
  perform give(w, u, 'fishing_rod', 1, ${ROD_QL});
  perform give(w, u, 'fishing_net', 1, ${NET_QL});
  perform pg_temp.hold(w, u, '{}');
  ${dice(RARE_BELOW)};
  ${go('fish', WX, WY)};
  v_t := ${fishIds};
  ${clearFish};
  ${hold('Rare Catch')};
  ${dice(RARE_BELOW)};
  ${go('fish', WX, WY)};
  v_t := v_t || '#' || ${fishIds} || '#' || coalesce(${last('You land %')}, 'unsaid');
  ${clearFish};
  ${dice(RARE_ABOVE)};
  ${go('fish', WX, WY)};
  v_t := v_t || '#' || ${fishIds};
  ${clearFish};
  ${dice(RARE_BELOW)};
  ${go('drag_net', WX, WY)};
  ${nodice};
  insert into said values ('RARE', v_t || '#' || ${fishIds} || '#' || coalesce(${last('You walk the net round%')}, 'unsaid'));
  ${clearAll};

  /* ---- Rod Care and Net Care: what a cast and a drag wear, without them and with them. ---- */
  perform give(w, u, 'fishing_rod', 1, ${ROD_QL});
  perform give(w, u, 'fishing_net', 1, ${NET_QL});
  perform pg_temp.hold(w, u, '{}');
  ${dice(0.99)};
  ${go('fish', WX, WY)};
  ${go('drag_net', WX, WY)};
  v_t := (select dmg from item where id = ${newest('fishing_rod')}) || ':' || (select dmg from item where id = ${newest('fishing_net')});
  update item set dmg = 0 where world_id = w and holder = 'player' and holder_uid = u and def in ('fishing_rod', 'fishing_net');
  ${hold('Rod Care', 'Net Care')};
  ${go('fish', WX, WY)};
  ${go('drag_net', WX, WY)};
  ${nodice};
  insert into said values ('WEAR', v_t || '|' || (select dmg from item where id = ${newest('fishing_rod')}) || ':' || (select dmg from item where id = ${newest('fishing_net')}));
  ${clearAll};

  /* ---- Deep Creel: a creel made with it is marked, says it holds more, and holds more. ---- */
  ${hold('Deep Creel')};
  ${inputs('make_creel')}
  ${craft('make_creel')};
  v_t := ${markOfRow(newest('creel'))};
  perform perform_trap(w, u, 'set_trap', ${tile(WX, WY)});
  select id into v_p from placed where world_id = w and kind = 'trap' and sub = 'creel' and x = ${WX} and y = ${WY} order by id desc limit 1;
  v_t := v_t || '|' || coalesce(${last('You sink the %')}, 'unsaid') || '|' || (select creel_hold(p) from placed p where p.id = v_p);
  update placed set bait = 'cooked_fish', bait_ql = 30, since = now() - make_interval(secs => ${CREEL_ROLLS} * trap_check_every()) where id = v_p;
  ${dice(BIG_ROLL)};
  perform trap_settle(v_p);
  ${nodice};
  v_t := v_t || '|' || (select coalesce(sum(count), 0) from item where holder = 'trap' and placed = v_p);
  delete from item where holder = 'trap' and placed = v_p;
  update placed set mark = null, bait = 'cooked_fish', bait_ql = 30,
         since = now() - make_interval(secs => ${CREEL_ROLLS} * trap_check_every()) where id = v_p;
  ${dice(BIG_ROLL)};
  perform trap_settle(v_p);
  ${nodice};
  insert into said values ('CREEL', v_t || ':' || (select coalesce(sum(count), 0) from item where holder = 'trap' and placed = v_p));

  /* ---- Big Fish in a creel: one roll with food in it, a minnow for its setter without it and a trout with it. ---- */
  perform pg_temp.hold(w, u, '{}');
  delete from item where holder = 'trap' and placed = v_p;
  update placed set bait = 'cooked_fish', since = now() - make_interval(secs => trap_check_every()) where id = v_p;
  ${dice(BIG_ROLL)};
  perform trap_settle(v_p);
  ${nodice};
  v_t := (select coalesce(string_agg(def, ','), 'none') from item where holder = 'trap' and placed = v_p);
  delete from item where holder = 'trap' and placed = v_p;
  ${hold('Big Fish')};
  update placed set bait = 'cooked_fish', since = now() - make_interval(secs => trap_check_every()) where id = v_p;
  ${dice(BIG_ROLL)};
  perform trap_settle(v_p);
  ${nodice};
  insert into said values ('BIGCREEL', v_t || ':' || (select coalesce(string_agg(def, ','), 'none') from item where holder = 'trap' and placed = v_p));
  delete from item where holder = 'trap' and placed = v_p;
  delete from placed where id = v_p;
  ${clearAll};

  /* ---- Cool Pack: a trout set down without it and with it. ---- */
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'trout', 1, 40);
  v_it := ${newest('trout')};
  perform act_perform(w, u, 'drop', jsonb_build_object('kind', 'item', 'uid', v_it));
  v_t := coalesce((select cool::text from item where id = v_it and holder = 'ground'), 'none')
    || ':' || (select ground_decay_rate(i) from item i where i.id = v_it);
  ${hold('Cool Pack')};
  perform give(w, u, 'trout', 1, 40);
  v_it := ${newest('trout')};
  perform act_perform(w, u, 'drop', jsonb_build_object('kind', 'item', 'uid', v_it));
  insert into said values ('COOL', v_t || ':' || coalesce((select cool::text from item where id = v_it and holder = 'ground'), 'none')
    || ':' || (select ground_decay_rate(i) from item i where i.id = v_it));
  delete from item where world_id = w and holder = 'ground' and gx between 0 and 15 and gy between 0 and 15;
  ${clearAll};

  /* ---- Smoke Fish: refused without it; smoked with it, a trout of its own marked to rot slower. ---- */
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'trout', 2, 30);
  v_t := ${craftRefused('smoke_trout')};
  ${hold('Smoke Fish')};
  v_t := v_t || '#' || ${craftRefused('smoke_trout')};
  ${craft('smoke_trout')};
  insert into said values ('SMOKE', v_t || '#' || ${count('trout')} || ':' || (select count(*) from item where world_id = w and holder = 'player' and holder_uid = u and def = 'trout')
    || '#' || coalesce((select mark::text from item where world_id = w and holder = 'player' and holder_uid = u and def = 'trout' and mark is not null limit 1), 'none'));
  ${clearAll};

  /* ---- Fishing Journal: examining the pond, without it and with it, with a worm and with a bare hook. ---- */
  -- At the fishing the browser's side has, which the casts above have taught past.
  update skill set value = ${SKILL} where world_id = w and uid = u and id = 'fishing';
  perform give(w, u, 'fishing_rod', 1, ${ROD_QL});
  perform give(w, u, 'worm', 2, 30);
  perform pg_temp.hold(w, u, '{}');
  v_t := examine_tile_text(w, ${WX}, ${WY}, u);
  ${hold('Fishing Journal')};
  v_t := v_t || '#' || examine_tile_text(w, ${WX}, ${WY}, u);
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'worm';
  v_t := v_t || '#' || examine_tile_text(w, ${WX}, ${WY}, u);
  perform give(w, u, 'worm', 2, 30);
  ${hold('Fishing Journal', 'Strong Bait', 'Big Fish', 'Steady Hand')};
  insert into said values ('JOURNAL', v_t || '#' || examine_tile_text(w, ${WX}, ${WY}, u));
  ${clearAll};

  /* ---- Fish Pond: refused without it; a pond stocking itself on the tidying round, and full, stocking no more. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${inputs('make_fish_pond')}
  perform give(w, u, 'shovel', 1, 40);
  v_t := ${craftRefused('make_fish_pond')};
  ${hold('Fish Pond')};
  v_t := v_t || '#' || ${craftRefused('make_fish_pond')};
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'furniture', 'fish_pond', 9, 10, 0, 0, 10, 11, ${POND_QL}, u) returning id into v_pond;
  update placed set state = jsonb_build_object('stock', ${POND_STOCK}, 'pond_at', now() - make_interval(secs => 2 * sweep_every())) where id = v_pond;
  ${dice(POND_ROLL)};
  perform pond_sweep(w);
  ${nodice};
  v_t := v_t || '#' || (select coalesce(string_agg(def || ':' || count || ':' || round(ql::numeric, 3), ','), 'empty') from item where holder = 'furniture' and placed = v_pond)
    || '#' || round((select (state->>'stock')::numeric from placed where id = v_pond), 4);
  delete from item where holder = 'furniture' and placed = v_pond;
  insert into item (world_id, holder, placed, def, ql, count) values (w, 'furniture', v_pond, 'perch', 30, 10);
  update placed set state = jsonb_build_object('stock', ${POND_STOCK}, 'pond_at', now() - make_interval(secs => 2 * sweep_every())) where id = v_pond;
  perform pond_sweep(w);
  insert into said values ('POND', v_t || '#' || (select sum(count) from item where holder = 'furniture' and placed = v_pond)
    || '#' || (select furniture_capacity(p) from placed p where p.id = v_pond) || '#' || (select furniture_refuses(p, 'trout') from placed p where p.id = v_pond)
    || '#' || sweep_every() || '#' || (select deed::text from recipe where id = 'make_fish_pond'));
  delete from item where holder = 'furniture' and placed = v_pond;
  delete from placed where id = v_pond;
  ${clearAll};

  insert into said values ('CONSTS', bait_pull() || '|' || bait_shy() || '|' || hook_most() || '|' || net_least() || '|' || net_haul()
    || '|' || pond_every() || '|' || cast_range() || '|' || net_range());
  insert into said values ('NODES', (select count(*) from class_node where id ~ '^fisher_')::text || ':'
    || (select count(*) from player_node where node ~ '^fisher_[0-9]_[0-9]$'));
end $$;

select k || E'\\t' || coalesce(v, '') from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const [k, ...v] = l.split('\t');
  return [k, v.join('\t')];
}));
const say = (k: string): string => said.get(k) ?? 'unsaid';

check('the Fisher stands on a settlement of theirs, beside a pond as deep as every fish swims', say('DEED') !== 'none' && Number(say('DEPTH')) === DEEP,
  `${say('DEED')} / ${say('DEPTH')}`);

/* ---- the reach --------------------------------------------------------------------------- */

const TOO_FAR = 'You are too far away from that.';
const [castFar, castBox, castFarYes, castBoxYes] = say('CAST').split('#');
check(`${P('Long Cast').name}: from five tiles off, water is out of a cast's ${CAST} without it, and no water lies in the ${Math.floor(CAST)} tiles round you`,
  castFar === TOO_FAR && castBox === 'There is no water within reach deep enough to hold anything. Walk to the bank.', `${castFar} / ${castBox}`);
check(`and with it both reach, to ${fx('Long Cast', 'reach:fish')} tiles`, castFarYes === 'ALLOWED' && castBoxYes === 'ALLOWED', `${castFarYes} / ${castBoxYes}`);
const [netFar, netBox, netFarYes, netBoxYes] = say('NET').split('#');
check(`${P('Wide Net').name}: from three tiles off, water is out of a net's ${NET_REACH} without it, and none in the ${Math.floor(NET_REACH)} round you`,
  netFar === TOO_FAR && netBox === 'There is no water close enough to drag a net through. Wade in.', `${netFar} / ${netBox}`);
check(`and with it both reach, to ${fx('Wide Net', 'reach:drag_net')} tiles`, netFarYes === 'ALLOWED' && netBoxYes === 'ALLOWED', `${netFarYes} / ${netBoxYes}`);

/* ---- the time ---------------------------------------------------------------------------- */

const [castPlain, netPlain, castQuick, netQuick] = say('TIME').split('|').map((s) => Number(s.split(':')[0]));
check(`${P('Quick Cast').name}: a cast is started with ${fx('Quick Cast', 'time:fish')} of the time`,
  castPlain > 0 && near(castQuick / castPlain, fx('Quick Cast', 'time:fish'), 1e-4), say('TIME'));
check(`${P('Quick Net').name}: a drag is started with ${fx('Quick Net', 'time:drag_net')} of the time`,
  netPlain > 0 && near(netQuick / netPlain, fx('Quick Net', 'time:drag_net'), 1e-4), say('TIME'));

/* ---- a bite ------------------------------------------------------------------------------ */

const [hooked, hookPlain, hookPerk, rodQl] = say('HOOK').split('|');
check(`${P('Steady Hand').name}: with the dice between a fish staying on without it and with it, it comes off without and is landed with`,
  hooked === '0:1', say('HOOK'));
check(`and the chance is the browser's, ${fx('Steady Hand', 'hook:fish')} over it, under the ${HOOK_MOST} ceiling`,
  near(Number(hookPlain), staysOn(SKILL, Number(rodQl), false)) && near(Number(hookPerk), staysOn(SKILL, Number(rodQl), false, fx('Steady Hand', 'hook:fish'))),
  `${hookPlain} / ${hookPerk}`);
check(`${P('Bait Saver').name}: a fish that comes off takes the worm without it, leaves it with it, and a landed one takes it`,
  say('SPARE') === '2:2:1:1', say('SPARE'));
const [anyNone, anyPlainGo, anyWith, anyGo, anySaid] = say('ANY').split('|');
check(`${P('Any Bait').name}: food is no bait without it, on the hook or in a creel, and is with it`,
  anyNone === 'none:none' && anyWith === 'cooked_fish:cooked_fish', `${anyNone} / ${anyWith}`);
check('and with the dice between the chance with no bait and with some, the fish comes off on a bare hook and stays on the food',
  anyPlainGo === '0:1' && anyGo === '1:0' && anySaid.includes('on the cooked fish'), `${anyPlainGo} / ${anyGo} / ${anySaid}`);

/* What the island picks for a roll: the fish by weight, heaviest first, as `pick_fish` walks them. */
const islandPick = (pool: FishDef[], bait: string | null, perk: PerkOf, roll: number): string => {
  const b = bait ? BAIT_BY_ID.get(bait) : undefined;
  const w = pool.map((f) => ({ id: f.id, w: biteWeight(f, b, perk) })).sort((a, c) => c.w - a.w || (a.id < c.id ? -1 : 1));
  const total = w.reduce((n, x) => n + x.w, 0);
  let upto = 0;
  for (const x of w) {
    upto += x.w;
    if (upto >= roll * total) return x.id;
  }
  return w[w.length - 1].id;
};
const perkOf = (f: Fx): PerkOf => (k, d) => f[k] ?? d;
const plain = perkOf({});
const pulled = perkOf(P('Strong Bait').fx);
const big = perkOf(P('Big Fish').fx);
const ALL = FISH.filter((f) => f.depth <= DEEP && f.level <= SKILL);
const [pullPick, bigPick] = say('PICK').split('#');
const wantPull = `${islandPick(ALL, 'minnow', plain, PULL_ROLL)}:${islandPick(ALL, 'minnow', pulled, PULL_ROLL)}`;
check(`${P('Strong Bait').name}: on a minnow, the dice at ${PULL_ROLL} give ${wantPull.replace(':', ' without it and ')} with it`,
  pullPick === wantPull && wantPull.split(':')[0] !== wantPull.split(':')[1], `${pullPick} / ${wantPull}`);
const wantBig = `${islandPick(ALL, null, plain, BIG_ROLL)}:${islandPick(ALL, null, big, BIG_ROLL)}`;
check(`${P('Big Fish').name}: on a bare hook, the dice at ${BIG_ROLL} give ${wantBig.replace(':', ' without it and ')} with it`,
  bigPick === wantBig && wantBig.split(':')[0] !== wantBig.split(':')[1], `${bigPick} / ${wantBig}`);
const weights = new Map(say('WEIGHTS').split(',').map((s) => {
  const [id, v] = s.split('=');
  return [id, v.split('/').map(Number)];
}));
check(`and every fish weighs what the browser weighs it at: ${BAIT_PULL * fx('Strong Bait', 'bait:pull')} times for a bait's first, ${BAIT_SHY} for the rest, twice for a big one, plain on food`,
  FISH.every((f) => {
    const [pull, heavy, food] = weights.get(f.id) ?? [];
    return near(pull, biteWeight(f, BAIT_BY_ID.get('minnow'), pulled)) && near(heavy, biteWeight(f, undefined, big)) && near(food, f.weight);
  }), say('WEIGHTS'));
check('and in a net the same dice haul the same change', say('BIGNET') === wantBig.split(':').join(':'), `${say('BIGNET')} / ${wantBig}`);
const CREEL_POOL = FISH.filter((f) => f.depth <= DEEP && f.level <= 40);
const wantCreel = `${islandPick(CREEL_POOL, null, plain, BIG_ROLL)}:${islandPick(CREEL_POOL, null, big, BIG_ROLL)}`;
check('and in a creel with food in it, by its setter\'s perks', say('BIGCREEL') === wantCreel, `${say('BIGCREEL')} / ${wantCreel}`);

/* ---- the catch --------------------------------------------------------------------------- */

const haul = (r: number, more = 0): number => NET_LEAST + Math.floor(r * (1 + (NET_HAUL - NET_LEAST) * (0.3 + NET_QL / 160))) + more;
check(`${P('Full Net').name}: with the dice at ${HAUL_ROLL} a QL ${NET_QL} net hauls ${haul(HAUL_ROLL)}, and ${haul(HAUL_ROLL, fx('Full Net', 'haul:drag_net'))} with it`,
  say('HAUL') === `${haul(HAUL_ROLL)}:${haul(HAUL_ROLL, fx('Full Net', 'haul:drag_net'))}`, say('HAUL'));
const [rarePlain, rareRod, rareSaid, rareAbove, rareNet, rareNetSaid] = say('RARE').split('#');
const TOP = RARITIES[RARITIES.length - 1].name;
check(`${P('Rare Catch').name}: with the dice under ${fx('Rare Catch', 'rare:fish')} a fish is not rare without it, and is ${TOP} with it, and says so`,
  !rarePlain.includes('/') && rareRod.endsWith(`/${TOP}`) && rareSaid.includes(`a ${TOP} `), `${rarePlain} / ${rareRod} / ${rareSaid}`);
check('and over it, none', !rareAbove.includes('/') && rareAbove !== 'none', rareAbove);
check('and in a net the same, on a pile of its own, said', rareNet.endsWith(`/${TOP}`) && rareNetSaid.includes(`× ${TOP} `), `${rareNet} / ${rareNetSaid}`);

/* ---- the wear ---------------------------------------------------------------------------- */

const [wearPlain, wearPerk] = say('WEAR').split('|').map((s) => s.split(':').map(Number));
check(`${P('Rod Care').name} and ${P('Net Care').name}: a cast and a drag wear their tool ${fx('Rod Care', 'wear:fishing_rod')} and ${fx('Net Care', 'wear:fishing_net')} as much`,
  wearPlain[0] > 0 && wearPlain[1] > 0 && near(wearPerk[0] / wearPlain[0], fx('Rod Care', 'wear:fishing_rod'), 1e-6)
    && near(wearPerk[1] / wearPlain[1], fx('Net Care', 'wear:fishing_net'), 1e-6), say('WEAR'));
check('and a net wears as much as the island says for a drag against a cast, the browser\'s own number for each',
  near(wearPlain[1] / wearPlain[0], (ACTION_BY_ID.get('drag_net')?.wear ?? 0) / (ACTION_BY_ID.get('fish')?.wear ?? 1), 1e-6), say('WEAR'));

/* ---- the creel, the pack, the smoke ------------------------------------------------------ */

const deep = Math.round((TRAPS.creel.hold ?? 0) * fx('Deep Creel', 'hold:creel'));
const [creelMark, creelSaid, creelHeld, creelFilled] = say('CREEL').split('|');
check(`${P('Deep Creel').name}: a creel made with it carries its mark, is set saying it holds ${deep}, and holds ${deep}`,
  JSON.parse(creelMark).hold === fx('Deep Creel', 'hold:creel') && creelSaid.includes(`holds ${deep}.`) && Number(creelHeld) === deep, `${creelMark} / ${creelSaid} / ${creelHeld}`);
check(`and fills to ${deep} where a plain one fills to ${TRAPS.creel.hold}`, creelFilled === `${deep}:${TRAPS.creel.hold}`, creelFilled);
const [coolPlain, ratePlain, coolPerk, rateCool] = say('COOL').split(':');
check(`${P('Cool Pack').name}: a trout set down is cooled ${fx('Cool Pack', 'cool:trout')} with it and not without, and rots that much slower`,
  coolPlain === 'none' && Number(coolPerk) === fx('Cool Pack', 'cool:trout') && near(Number(rateCool) / Number(ratePlain), fx('Cool Pack', 'cool:trout')), say('COOL'));
const [smokeNo, smokeYes, smokeCounts, smokeMark] = say('SMOKE').split('#');
check(`${P('Smoke Fish').name}: refused without it in the browser's words, and smoked with it`,
  smokeNo === RECIPE_PERK_SAYS.smoke_fish && smokeYes === 'ALLOWED', `${smokeNo} / ${smokeYes}`);
check(`and the smoked trout lies apart from the other, marked to rot ${fx('Smoke Fish', 'rot:trout')} as fast`,
  smokeCounts === '2:2' && JSON.parse(smokeMark).rot === fx('Smoke Fish', 'rot:trout'), `${smokeCounts} / ${smokeMark}`);

/* ---- the browser's half ------------------------------------------------------------------ */

const game = Game.create(4401);
game.setPerks({});
game.skills.values.set('fishing', SKILL);
const px = game.player.tileX;
const py = game.player.tileY;
// Dry ground round the player, and the same pond five tiles east, as deep.
for (let x = px - 8; x <= px + 12; x++) for (let y = py - 8; y <= py + 8; y++) game.world.setHeight(x, y, 40);
for (let x = px + 5; x <= px + 9; x++) for (let y = py - 2; y <= py + 3; y++) game.world.setHeight(x, y, -DEEP);
const tileAt = (x: number, y: number): Target => ({ kind: 'tile', x, y, cx: x + 0.5, cy: y + 0.5 });
const stand = (x: number, y: number): void => {
  game.player.x = x + 0.5;
  game.player.y = y + 0.5;
};
const fishDef = ACTION_BY_ID.get('fish')!;
const netDef = ACTION_BY_ID.get('drag_net')!;
check('the browser\'s Long Cast reaches water five tiles off, and the deepest water within six, as the island\'s does',
  !game.inRange(fishDef, tileAt(px + 5, py)) && castAt(game, px, py) === null
    && (game.setPerks(P('Long Cast').fx), game.inRange(fishDef, tileAt(px + 5, py)) && castAt(game, px, py)?.depth === DEEP));
game.setPerks({});
stand(px + 2, py);
check('and its Wide Net the same for a net from three tiles off',
  !game.inRange(netDef, tileAt(px + 5, py)) && castAt(game, px + 2, py - 1, netReach(game)) === null
    && (game.setPerks(P('Wide Net').fx), game.inRange(netDef, tileAt(px + 5, py)) && castAt(game, px + 2, py - 1, netReach(game))?.depth === DEEP));
game.setPerks({});
stand(px + 4, py);
const hookAt = (staysOn(SKILL, ROD_QL, false) + staysOn(SKILL, ROD_QL, false, fx('Steady Hand', 'hook:fish'))) / 2;
game.rand = () => hookAt;
const offHook = catchFish(game, DEEP, ROD_QL, null);
game.setPerks(P('Steady Hand').fx);
check('its Steady Hand lands what comes off without it under the same dice', offHook === null && catchFish(game, DEEP, ROD_QL, null) !== null);
game.setPerks({});
game.inventory.add('fishing_rod', { ql: ROD_QL });
game.inventory.add('worm', { ql: 30, count: 3 });
const fishIn = (): number => game.inventory.items.filter((it) => FISH.some((f) => f.id === it.id)).reduce((n, it) => n + it.count, 0);
game.rand = () => 0.99;
fishDef.perform(tileAt(px + 5, py), game);
const wormsPlain = game.inventory.count('worm');
game.setPerks(P('Bait Saver').fx);
fishDef.perform(tileAt(px + 5, py), game);
const wormsSaved = game.inventory.count('worm');
game.rand = () => 0.01;
fishDef.perform(tileAt(px + 5, py), game);
check('its Bait Saver keeps the worm on a fish that comes off and not on a landed one, as the island\'s does',
  `${wormsPlain}:${wormsSaved}:${game.inventory.count('worm')}:${fishIn()}` === say('SPARE'), `${wormsPlain}:${wormsSaved}:${game.inventory.count('worm')}:${fishIn()}`);
game.setPerks(P('Rare Catch').fx);
game.rand = () => RARE_BELOW;
fishDef.perform(tileAt(px + 5, py), game);
check('its Rare Catch lands a rare fish all the way under the same dice',
  game.inventory.items.some((it) => FISH.some((f) => f.id === it.id) && it.rare === RARITIES.length - 1));
for (const it of [...game.inventory.items]) if (FISH.some((f) => f.id === it.id) || it.id === 'worm') game.inventory.remove(it.uid, it.count);
game.inventory.add('cooked_fish', { ql: 30 });
game.setPerks({});
const foodPlain = fishDef.labelFor?.(tileAt(px + 5, py), game);
game.setPerks(P('Any Bait').fx);
check('its Any Bait puts the food on the hook, and says so on the menu', foodPlain === 'Fish'
  && fishDef.labelFor?.(tileAt(px + 5, py), game) === 'Fish with cooked fish', `${foodPlain} / ${fishDef.labelFor?.(tileAt(px + 5, py), game)}`);
game.inventory.remove(game.inventory.find('cooked_fish')!.uid, 1);
// The net, a drag at a time.
game.setPerks({});
game.inventory.add('fishing_net', { ql: NET_QL });
game.rand = () => HAUL_ROLL;
netDef.perform(tileAt(px + 5, py), game);
const hauledPlain = fishIn();
game.setPerks(P('Full Net').fx);
netDef.perform(tileAt(px + 5, py), game);
check('its Full Net hauls as many as the island\'s under the same dice', `${hauledPlain}:${fishIn() - hauledPlain}` === say('HAUL'), `${hauledPlain}:${fishIn() - hauledPlain}`);
check('its rod and net wear their tools by the island\'s numbers, and nothing more on top',
  fishDef.wear === 0.5 && netDef.wear === 1.4, `${fishDef.wear} / ${netDef.wear}`);
// The journal, off the same pond, the same pack and the same perks.
for (const it of [...game.inventory.items]) if (FISH.some((f) => f.id === it.id)) game.inventory.remove(it.uid, it.count);
const journal = say('JOURNAL').split('#');
const tail = (s: string): string => s.split('Water laps over it.')[1] ?? 'no water';
game.setPerks({});
game.inventory.add('worm', { ql: 30, count: 2 });
check('the Fishing Journal says nothing without it, on either side', tail(journal[0]).startsWith(' Depth') === false && fishJournal(game, px + 5, py) === '',
  journal[0]);
game.setPerks(P('Fishing Journal').fx);
check(`${P('Fishing Journal').name}: the water's depth, each fish's share of the bites on the worm, and how often they stay on, in the browser's words`,
  tail(journal[1]) === fishJournal(game, px + 5, py) && tail(journal[1]).startsWith(` Depth ${DEEP}. With the worms you carry,`), `${tail(journal[1])} // ${fishJournal(game, px + 5, py)}`);
game.inventory.remove(game.inventory.find('worm')!.uid, 2);
check('and on a bare hook', tail(journal[2]) === fishJournal(game, px + 5, py), `${tail(journal[2])} // ${fishJournal(game, px + 5, py)}`);
game.inventory.add('worm', { ql: 30, count: 2 });
game.setPerks({ ...P('Fishing Journal').fx, ...P('Strong Bait').fx, ...P('Big Fish').fx, ...P('Steady Hand').fx });
check('and with a Fisher\'s other perks counted in', tail(journal[3]) === fishJournal(game, px + 5, py), `${tail(journal[3])} // ${fishJournal(game, px + 5, py)}`);
// The creel and the smoke.
check('its Deep Creel holds as many', creelHold({ kind: 'creel', mark: { hold: fx('Deep Creel', 'hold:creel') } } as unknown as PlacedTrap) === deep);
game.setPerks({});
const smoke = RECIPE_BY_ID.get('smoke_trout')!;
check('its Smoke Fish is refused in the island\'s words, and marks what it smokes', recipeReason(smoke, game) === RECIPE_PERK_SAYS.smoke_fish
  && makersMark((k, d) => P('Smoke Fish').fx[k] ?? d, smoke.result)?.rot === fx('Smoke Fish', 'rot:trout'), String(recipeReason(smoke, game)));

/* ---- the pond ---------------------------------------------------------------------------- */

const [pondNo, pondYes, pondFish, pondStock, pondFull, pondCap, pondRefuses, sweep, pondDeed] = say('POND').split('#');
check(`${P('Fish Pond').name}: refused without it in the browser's words, and built with it`,
  pondNo === RECIPE_PERK_SAYS.fish_pond && pondYes === 'ALLOWED' && pondDeed === 'true', `${pondNo} / ${pondYes} / ${pondDeed}`);
const since = 2 * Number(sweep);
const pondQl = Math.min(100, Math.max(1, POND_QL * (0.7 + POND_ROLL * 0.6)));
check(`a pond ${POND_STOCK} of the way to a fish, ${since} seconds on, stocks a ${FISH[0].name.toLowerCase()} under the dice at about its quality`,
  pondFish === `${FISH[0].id}:1:${pondQl.toFixed(3)}` && near(Number(pondStock), POND_STOCK + since / POND_EVERY - 1, 1e-3), `${pondFish} / ${pondStock}`);
const f = { kind: 'fish_pond', ql: POND_QL, items: [], x: 0, y: 0, stock: POND_STOCK } as unknown as PlacedFurniture;
game.rand = () => POND_ROLL;
(game as unknown as { stockPond(p: PlacedFurniture, dt: number): void }).stockPond(f, since);
check('and the browser\'s pond stocks the same', f.items.length === 1 && f.items[0].id === FISH[0].id && near(f.items[0].ql, pondQl)
  && near(f.stock ?? 0, POND_STOCK + since / POND_EVERY - 1), JSON.stringify(f.items));
check(`and full at ${pondCap}, it stocks no more`, Number(pondFull) === Number(pondCap) && Number(pondCap) === furnitureDef('fish_pond').pond, `${pondFull} / ${pondCap}`);
check('and it takes nothing from anybody\'s hands, in the browser\'s words',
  pondRefuses === furnitureRefuses(f, { uid: 1, id: 'trout', ql: 20, dmg: 0, count: 1 }), pondRefuses);

/* ---- what the island says the numbers are ------------------------------------------------ */

check('the island\'s numbers for a bite, a haul, a pond and a reach are the browser\'s',
  say('CONSTS') === [BAIT_PULL, BAIT_SHY, HOOK_MOST, NET_LEAST, NET_HAUL, POND_EVERY, CAST, NET_REACH].join('|'), say('CONSTS'));
check('and the Fisher\'s tree is gone', say('NODES') === '0:0', say('NODES'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Fisher's perks — ${ok.length} of ${ok.length}`);
