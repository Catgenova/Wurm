/**
 * The Mender's eighteen perks, each measured where its rule is.
 *
 * `perks.ts` holds the two sides to each other for every trade on perks; this
 * asks the one thing that is the Mender's own: that each perk does what its
 * note says, on the island. Where a perk is a chance, the island's dice are put
 * either side of its number inside the transaction (`dice.random`, first on the
 * search path), so a go shows the number itself:
 *
 *   * a go of Repair: Big Mend's more out, Light Touch's less quality for it,
 *     Clean Repair's none, and Quick Hands' time off the floor under it;
 *   * the wear: Tool Care on a tool and on the brush, Armour Care on armour,
 *     a shield and a weapon;
 *   * Post Keeper's post and trap, standing longer for their setter and for
 *     nobody else, and the post's own life now the browser's;
 *   * restoring: Quick Restore's time, Sure Restore's failing less, Gentle
 *     Hands' no harm, Fine Restore's and Age Undone's quality, and on a bauble
 *     Lucky Polish's rarity, Second Look's better roll and Tier Up's better
 *     tier; and what a go of it teaches Restoration, come off or not;
 *   * Handyman's floor under improving;
 *   * the repair kit and the sealant, refused without their perks, made with
 *     them, and used by anybody;
 *   * the Mender's tree gone;
 *   * and the browser reckons and says the same.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game, goSeconds } from '../../src/game/game';
import { ACTION_BY_ID, KIT_MEND, repairGo, type Target } from '../../src/game/actions';
import { RESTORE_AGE, RESTORE_HARM, RESTORE_HARM_SPREAD } from '../../src/game/archaeology';
import { DODGE_FROM } from '../../src/game/fight';
import { TRY_LEARN } from '../../src/game/learn';
import { MINOR_SKILLS } from '../../src/game/baubles';
import { IMPROVE_FLOOR, improveCeiling } from '../../src/game/improve';
import { groundDecayRate, markSays, partsMark, RARITIES, rollRarity, type Item } from '../../src/game/items';
import { ACTION_FLOOR } from '../../src/game/pace';
import { perksOf, type PerkDef } from '../../src/game/perks';
import { POST_LIFE_MAX, POST_LIFE_MIN, postDecayRate, postKeep, postLife } from '../../src/game/posts';
import { RECIPE_BY_ID, RECIPE_PERK_SAYS, recipeReason } from '../../src/game/recipes';
import { trapKeep, trapLife } from '../../src/game/traps';

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

const MENDER = perksOf('mender');
const P = (name: string): PerkDef => {
  const p = MENDER.find((x) => x.name === name);
  if (!p) throw new Error(`the Mender has no perk called ${name}`);
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
const last = (like: string): string =>
  `coalesce((select e.text from event e where e.world_id = w and e.uid = u and e.text like ${q(like)} order by e.n desc limit 1), 'unsaid')`;
const itemT = (id: string): string => `jsonb_build_object('kind', 'item', 'uid', ${id})`;
const refused = (a: string, id: string): string => `coalesce(act_refusal(w, u, '${a}', ${itemT(id)}), 'ALLOWED')`;
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
/** An item in the pack, at a quality and a damage, and its id. */
const thing = (def: string, ql: number, dmg: number, extra = 'null', n = 1): string =>
  `pg_temp.thing(w, u, '${def}', ${n}, ${ql}, ${dmg}, ${extra})`;
const row = (id: string): string => `(select i from item i where i.id = ${id})`;
const skillAt = (id: string, v: number): string =>
  `insert into skill (world_id, uid, id, value) values (w, u, '${id}', ${v}) on conflict (world_id, uid, id) do update set value = excluded.value`;

const HANDS = 40;
const SKILL = 70;
const QL = 50;
const DMG = 50;
const BAUBLE_QL = 50;
const BAUBLE_DMG = 40;
const BLOW = 2;
const PIECE = 'chain_hauberk';
const SHIELD = 'wooden_shield';
const SWORD = 'sword';
const AGO = 1000;
const LOW_SKILL = 5;
/** Dice for a Clean Repair: under its chance, and over it. */
const CLEAN_IN = fx('Clean Repair', 'keep:repair_item') * 0.8;
const CLEAN_OUT = fx('Clean Repair', 'keep:repair_item') * 1.2;
/** Dice for a failed restoring that a Sure Restore passes: over its share of failures. */
const SURE_ROLL = (1 + fx('Sure Restore', 'fail:restore_relic')) / 2;
const HARM_ROLL = 0.5;
/** Dice between the plain odds of a rare bauble and a Lucky Polish's. */
const RARE_ROLL = fx('Lucky Polish', 'rare:restore_relic') * 0.75;
const TIER_ROLL = fx('Tier Up', 'tier:restore_relic') / 2;
const PLAIN_ROLL = 0.5;
const LOCATION_ROLL = 0.2;
const BLOCK_ROLL = 0.001;
const SWING_ROLL = 0.01;
const ROLLS = [2, 4.5];

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
create function pg_temp.thing(w uuid, u uuid, d text, n int, ql double precision, dmg double precision, x text) returns bigint
  language plpgsql as $f$
declare v bigint;
begin
  v := give(w, u, d, n, ql, x);
  update item set dmg = thing.dmg where id = v;
  return v;
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
/*
 * What a bauble is rolled to give, one after another off a list, so that a
 * Second Look is seen keeping the better of two it was given.
 */
create or replace function bauble_roll(p_tier text, p_rare text) returns text language plpgsql as $f$
declare xs text[] := string_to_array(coalesce(nullif(current_setting('wurm.rolls', true), ''), '${ROLLS[0]}'), ',');
        n int := coalesce(nullif(current_setting('wurm.rolls_n', true), ''), '0')::int;
begin
  perform set_config('wurm.rolls_n', (n + 1)::text, true);
  return bauble_text('time', '${MINOR_SKILLS[0]}', xs[1 + n % array_length(xs, 1)]::double precision);
end $f$;

do $$
declare w uuid; u uuid; v_it bigint; v_b bigint; v_c int; v_pl placed; v_t text; v_a double precision; v_bb double precision;
begin
  -- The suite's own island and its first body, a Mender now.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  ${clearAll};
  delete from player_node where world_id = w and uid = u;
  delete from caller where uid = u;
  update player set x = 9.5, y = 9.5, act = null, act_target = null, act_started = null, act_ends = null,
         act_left = null, act_goes = null, act_queue = '[]', craft_class = 'mender', combat_class = null,
         class_mul = null, level_h = null, rested = 0, boons = '[]'::jsonb, body_at = now(), swim_at = now(),
         equipped = '{}'::jsonb, craft_from_stores = false, craft_spare_rare = false, wounds = '[]'::jsonb,
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1,
                                                                    'hurtSettled', now(), 'aegis', 0)
   where world_id = w and uid = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  ${skillAt('repair', SKILL)};
  ${skillAt('restoration', SKILL)};
  ${checks(true)};

  /* ---- A go of Repair: plain, Big Mend, Light Touch, and Clean Repair under its chance and over it. ---- */
  v_t := '';
  foreach v_t in array array['', ${q(P('Big Mend').id)}, ${q(P('Light Touch').id)}] loop
    perform pg_temp.hold(w, u, case when v_t = '' then '{}'::text[] else array[v_t] end);
    ${skillAt('repair', SKILL)};
    v_it := ${thing('shovel', QL, DMG)};
    perform perform_item(w, u, 'repair_item', ${itemT('v_it')});
    insert into said select 'REPAIR' || coalesce(nullif(v_t, ''), 'plain'), dmg || '|' || ql from item where id = v_it;
    delete from item where id = v_it;
  end loop;
  ${hold('Clean Repair')};
  ${skillAt('repair', SKILL)};
  v_it := ${thing('shovel', QL, DMG)};
  ${dice(CLEAN_IN)};
  perform perform_item(w, u, 'repair_item', ${itemT('v_it')});
  ${dice(CLEAN_OUT)};
  ${skillAt('repair', SKILL)};
  perform perform_item(w, u, 'repair_item', ${itemT('v_it')});
  ${nodice};
  insert into said select 'CLEAN', dmg || '|' || ql from item where id = v_it;
  ${clearAll};

  /* ---- Quick Hands and Quick Restore: a go of each started with their share of the time. ---- */
  ${skillAt('repair', SKILL)};
  v_it := ${thing('shovel', QL, DMG)};
  v_b := ${thing('tarnished_bauble', BAUBLE_QL, BAUBLE_DMG, "'minor'")};
  perform pg_temp.hold(w, u, '{}');
  v_t := pg_temp.secs(w, u, 'repair_item', ${itemT('v_it')}) || '|' || pg_temp.secs(w, u, 'restore_relic', ${itemT('v_b')});
  ${hold('Quick Hands', 'Quick Restore')};
  v_t := v_t || '|' || pg_temp.secs(w, u, 'repair_item', ${itemT('v_it')}) || '|' || pg_temp.secs(w, u, 'restore_relic', ${itemT('v_b')});
  insert into said values ('TIME', v_t || '|' || action_floor());
  ${clearAll};

  /* ---- Tool Care: a use's wear on a shovel and on a brush. ---- */
  perform pg_temp.hold(w, u, '{}');
  v_it := ${thing('shovel', QL, 0)};
  v_b := ${thing('brush', QL, 0)};
  perform wear_tool(v_it); perform wear_tool(v_b, 3);
  v_t := (select dmg from item where id = v_it) || ':' || (select dmg from item where id = v_b);
  update item set dmg = 0 where id in (v_it, v_b);
  ${hold('Tool Care')};
  perform wear_tool(v_it); perform wear_tool(v_b, 3);
  insert into said values ('WEAR', v_t || '|' || (select dmg from item where id = v_it) || ':' || (select dmg from item where id = v_b));
  ${clearAll};

  /* ---- Armour Care: a blow on the chest, one stopped on a shield, and one landed with a sword. ---- */
  -- Body control back where everyone starts, so no dodge takes the low roll meant for the shield (dodge_chance).
  ${skillAt('body_control', DODGE_FROM)};
  v_t := '';
  foreach v_t in array array['', ${q(P('Armour Care').id)}] loop
    perform pg_temp.hold(w, u, case when v_t = '' then '{}'::text[] else array[v_t] end);
    v_it := ${thing(PIECE, QL, 0)};
    update player set equipped = jsonb_build_object('chest', v_it), wounds = '[]'::jsonb where world_id = w and uid = u;
    ${dice(LOCATION_ROLL)};
    perform hurt_player(w, u, ${BLOW}, 'a test blow', 'bite');
    ${nodice};
    v_b := ${thing(SHIELD, QL, 0)};
    update player set equipped = jsonb_build_object('offhand', v_b), wounds = '[]'::jsonb where world_id = w and uid = u;
    ${dice(BLOCK_ROLL)};
    perform hurt_player(w, u, ${BLOW}, 'a test blow', 'bite');
    ${nodice};
    insert into said values ('ARMOUR' || coalesce(nullif(v_t, ''), 'plain'),
      (select dmg from item where id = v_it) || '|' || (select dmg from item where id = v_b));
    v_it := ${thing(SWORD, QL, 0)};
    update player set equipped = jsonb_build_object('weapon', v_it), wounds = '[]'::jsonb where world_id = w and uid = u;
    insert into creature (world_id, id, species, name, from_x, from_y, to_x, to_y, health, sex, mode)
      select w, coalesce(max(id), 0) + 1, 'seavic', 'Dummy', 9.5, 10.5, 9.5, 10.5, 500, 'female', 'wild'
      from creature where world_id = w
      returning id into v_c;
    ${dice(SWING_ROLL)};
    perform perform_fight(w, u, 'attack_creature', jsonb_build_object('kind', 'creature', 'id', v_c));
    ${nodice};
    insert into said values ('SWORD' || coalesce(nullif(v_t, ''), 'plain'), (select dmg from item where id = v_it)::text);
    delete from creature where world_id = w and id = v_c;
    update player set equipped = '{}'::jsonb, wounds = '[]'::jsonb where world_id = w and uid = u;
    ${clearAll};
  end loop;

  /* ---- Post Keeper: a post and a snare set a while ago, by this Mender and by nobody. ---- */
  perform pg_temp.hold(w, u, '{}');
  insert into placed (world_id, kind, x, y, sx, sy, cx, cy, ql, made_by, since, dmg)
    values (w, 'post', 3, 3, 0, 0, 3.125, 3.125, ${QL}, u, now() - interval '${AGO} seconds', 0) returning * into v_pl;
  v_t := post_dmg(v_pl) || ':' || post_left(v_pl);
  ${hold('Post Keeper')};
  v_t := v_t || '|' || post_dmg(v_pl) || ':' || post_left(v_pl);
  v_pl.made_by := null;
  v_t := v_t || '|' || post_dmg(v_pl) || ':' || post_left(v_pl);
  insert into said values ('POST', v_t);
  perform pg_temp.hold(w, u, '{}');
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, since, dmg)
    values (w, 'trap', 'snare', 3, 4, 0, 0, 3.125, 4.125, ${QL}, u, now() - interval '${AGO} seconds', 0) returning * into v_pl;
  v_t := trap_dmg(v_pl) || ':' || trap_left(v_pl);
  ${hold('Post Keeper')};
  v_t := v_t || '|' || trap_dmg(v_pl) || ':' || trap_left(v_pl);
  insert into said values ('TRAP', v_t);
  insert into said values ('POSTLIFE', post_life(1) || '|' || post_life(100));
  delete from placed where world_id = w and x = 3 and y in (3, 4);

  /* ---- Sure Restore and Gentle Hands: a restoring that fails, and one a Sure Restore passes under the same dice. ---- */
  ${checks(false)};
  perform pg_temp.hold(w, u, '{}');
  v_b := ${thing('tarnished_bauble', BAUBLE_QL, BAUBLE_DMG, "'minor'")};
  ${dice(SURE_ROLL)};
  perform restore_bauble(w, u, ${row('v_b')});
  v_t := ${count('tarnished_bauble')} || ':' || ${count('bauble_minor')};
  ${hold('Sure Restore')};
  ${dice(SURE_ROLL)};
  perform restore_bauble(w, u, ${row('v_b')});
  ${nodice};
  insert into said values ('SURE', v_t || '|' || ${count('tarnished_bauble')} || ':' || ${count('bauble_minor')});
  ${clearAll};
  perform pg_temp.hold(w, u, '{}');
  v_b := ${thing('tarnished_bauble', BAUBLE_QL, BAUBLE_DMG, "'minor'")};
  ${dice(HARM_ROLL)};
  perform restore_bauble(w, u, ${row('v_b')});
  v_t := (select dmg from item where id = v_b) || ':' || ${last('The tarnish will not lift%')};
  update item set dmg = ${BAUBLE_DMG} where id = v_b;
  ${hold('Gentle Hands')};
  ${dice(HARM_ROLL)};
  perform restore_bauble(w, u, ${row('v_b')});
  ${nodice};
  insert into said values ('GENTLE', v_t || '|' || (select dmg from item where id = v_b) || ':' || ${last('The tarnish will not lift%')});
  ${clearAll};
  ${checks(true)};

  /* ---- Fine Restore and Age Undone: what a bauble comes out at, plain and with each. ---- */
  v_t := '';
  foreach v_t in array array['', ${q(P('Fine Restore').id)}, ${q(P('Age Undone').id)}] loop
    perform pg_temp.hold(w, u, case when v_t = '' then '{}'::text[] else array[v_t] end);
    -- At the restorer's skill, which every go of restoring before this one has raised.
    ${skillAt('restoration', SKILL)};
    v_b := ${thing('tarnished_bauble', BAUBLE_QL, BAUBLE_DMG, "'minor'")};
    ${dice(PLAIN_ROLL)};
    perform restore_bauble(w, u, ${row('v_b')});
    ${nodice};
    insert into said select 'QL' || coalesce(nullif(v_t, ''), 'plain'), ql::text from item where id = ${newest('bauble_minor')};
    ${clearAll};
  end loop;

  /* ---- Lucky Polish: the dice between a rare bauble's plain odds and its. ---- */
  v_t := '';
  foreach v_t in array array['', ${q(P('Lucky Polish').id)}] loop
    perform pg_temp.hold(w, u, case when v_t = '' then '{}'::text[] else array[v_t] end);
    v_b := ${thing('tarnished_bauble', BAUBLE_QL, BAUBLE_DMG, "'minor'")};
    ${dice(RARE_ROLL)};
    perform restore_bauble(w, u, ${row('v_b')});
    ${nodice};
    insert into said select 'RARE' || coalesce(nullif(v_t, ''), 'plain'), coalesce(rare, 'none') from item where id = ${newest('bauble_minor')};
    ${clearAll};
  end loop;

  /* ---- Tier Up: under its chance, a minor bauble comes out major. ---- */
  v_t := '';
  foreach v_t in array array['', ${q(P('Tier Up').id)}] loop
    perform pg_temp.hold(w, u, case when v_t = '' then '{}'::text[] else array[v_t] end);
    v_b := ${thing('tarnished_bauble', BAUBLE_QL, BAUBLE_DMG, "'minor'")};
    ${dice(TIER_ROLL)};
    perform restore_bauble(w, u, ${row('v_b')});
    ${nodice};
    insert into said values ('TIER' || coalesce(nullif(v_t, ''), 'plain'),
      ${count('bauble_minor')} || ':' || ${count('bauble_major')} || ':' || ${last('The tarnish comes away%')});
    ${clearAll};
  end loop;

  /* ---- Second Look: two rolls, the smaller first and then the larger first; it keeps the larger. ---- */
  v_t := '';
  foreach v_t in array array['', ${q(P('Second Look').id)}] loop
    perform pg_temp.hold(w, u, case when v_t = '' then '{}'::text[] else array[v_t] end);
    perform set_config('wurm.rolls', '${ROLLS.join(',')}', true);
    perform set_config('wurm.rolls_n', '0', true);
    v_b := ${thing('tarnished_bauble', BAUBLE_QL, BAUBLE_DMG, "'minor'")};
    ${dice(PLAIN_ROLL)};
    perform restore_bauble(w, u, ${row('v_b')});
    perform set_config('wurm.rolls', '${[...ROLLS].reverse().join(',')}', true);
    perform set_config('wurm.rolls_n', '0', true);
    v_b := ${thing('tarnished_bauble', BAUBLE_QL, BAUBLE_DMG, "'minor'")};
    perform restore_bauble(w, u, ${row('v_b')});
    ${nodice};
    insert into said select 'LOOK' || coalesce(nullif(v_t, ''), 'plain'), string_agg(extra, '#' order by id)
      from item where world_id = w and holder = 'player' and holder_uid = u and def = 'bauble_minor';
    ${clearAll};
  end loop;
  perform set_config('wurm.rolls', '', true);

  /* ---- A relic: Gentle Hands on a failure, and Sure Restore, Fine Restore and Age Undone on a success. ---- */
  ${checks(false)};
  v_t := '';
  foreach v_t in array array['', ${q(P('Gentle Hands').id)}] loop
    perform pg_temp.hold(w, u, case when v_t = '' then '{}'::text[] else array[v_t] end);
    v_it := ${thing('fragment', BAUBLE_QL, BAUBLE_DMG, "'old pot 1/2'")};
    v_b := ${thing('fragment', BAUBLE_QL, BAUBLE_DMG, "'old pot 2/2'")};
    ${dice(HARM_ROLL)};
    perform perform_dig(w, u, 'restore_relic', ${itemT('v_it')});
    ${nodice};
    insert into said values ('PIECES' || coalesce(nullif(v_t, ''), 'plain'),
      (select dmg from item where id = v_it) || ':' || (select dmg from item where id = v_b) || ':' || ${last('The pieces of the%')});
    ${clearAll};
  end loop;
  perform pg_temp.hold(w, u, array[${q(P('Sure Restore').id)}, ${q(P('Fine Restore').id)}, ${q(P('Age Undone').id)}]::text[]);
  ${skillAt('restoration', SKILL)};
  v_it := ${thing('fragment', BAUBLE_QL, BAUBLE_DMG, "'old pot 1/2'")};
  v_b := ${thing('fragment', BAUBLE_QL, BAUBLE_DMG, "'old pot 2/2'")};
  ${dice(SURE_ROLL)};
  perform perform_dig(w, u, 'restore_relic', ${itemT('v_it')});
  ${nodice};
  insert into said values ('RELIC', coalesce((select ql::text from item where id = ${newest('clay_pot')}), 'none'));
  ${clearAll};
  ${checks(true)};

  /* ---- What a go of restoring teaches Restoration: a bauble and a relic, each come off and not. ---- */
  perform pg_temp.hold(w, u, '{}');
  v_t := '';
  foreach v_c in array array[1, 0, 1, 0] loop
    if v_c = 1 then ${checks(true)}; else ${checks(false)}; end if;
    ${skillAt('restoration', SKILL)};
    if length(v_t) - length(replace(v_t, '|', '')) < 2 then
      v_b := ${thing('tarnished_bauble', BAUBLE_QL, BAUBLE_DMG, "'minor'")};
      ${dice(PLAIN_ROLL)};
      perform restore_bauble(w, u, ${row('v_b')});
    else
      v_it := ${thing('fragment', BAUBLE_QL, BAUBLE_DMG, "'old pot 1/2'")};
      v_b := ${thing('fragment', BAUBLE_QL, BAUBLE_DMG, "'old pot 2/2'")};
      ${dice(PLAIN_ROLL)};
      perform perform_dig(w, u, 'restore_relic', ${itemT('v_it')});
    end if;
    ${nodice};
    v_t := v_t || ((select value from skill where world_id = w and uid = u and id = 'restoration') - ${SKILL}) || '|';
    ${clearAll};
  end loop;
  insert into said values ('LEARN', v_t);
  ${checks(true)};
  ${skillAt('restoration', SKILL)};

  /* ---- Handyman: the floor under improving, at a low skill and a high one. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${skillAt('carpentry', LOW_SKILL)};
  v_t := improve_ceiling(w, u, 'carpentry', null)::text;
  ${hold('Handyman')};
  v_t := v_t || '|' || improve_ceiling(w, u, 'carpentry', null);
  ${skillAt('carpentry', SKILL)};
  insert into said values ('FLOOR', v_t || '|' || improve_ceiling(w, u, 'carpentry', null));

  /* ---- The repair kit: refused without the perk, made with it, and used on a shovel by anybody. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${inputs('make_repair_kit')}
  perform give(w, u, 'hammer', 1, 30);
  v_t := ${craftRefused('make_repair_kit')};
  ${hold('Repair Kit')};
  v_t := v_t || '#' || ${craftRefused('make_repair_kit')};
  ${craft('make_repair_kit')};
  v_t := v_t || '#' || ${count('repair_kit')};
  perform pg_temp.hold(w, u, '{}');
  v_it := ${thing('shovel', QL, 80)};
  v_t := v_t || '#' || ${refused('mend_kit', 'v_it')};
  perform perform_item(w, u, 'mend_kit', ${itemT('v_it')});
  v_t := v_t || '#' || (select dmg || ':' || ql from item where id = v_it) || '#' || ${count('repair_kit')}
    || '#' || ${last('You mend the%')} || '#' || ${refused('mend_kit', 'v_it')};
  update item set dmg = 0 where id = v_it;
  perform give(w, u, 'repair_kit', 1, 30);
  insert into said values ('KIT', v_t || '#' || ${refused('mend_kit', 'v_it')});
  ${clearAll};

  /* ---- The sealant: refused without the perk, made with it, and worked over a pile of logs, one to a log. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${inputs('make_sealant')}
  v_t := ${craftRefused('make_sealant')};
  ${hold('Sealant')};
  v_t := v_t || '#' || ${craftRefused('make_sealant')};
  ${craft('make_sealant')};
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'sealant', 1, 30);
  v_it := ${thing('log', 30, 0, 'null', 3)};
  v_b := ${thing('plank', 30, 0)};
  v_t := v_t || '#' || ${count('sealant')} || '#' || ${refused('seal_item', 'v_it')};
  perform give(w, u, 'sealant', 1, 30);
  v_t := v_t || '#' || ${refused('seal_item', 'v_it')};
  perform perform_item(w, u, 'seal_item', ${itemT('v_it')});
  v_t := v_t || '#' || coalesce((select mark::text from item where id = v_it), 'none') || '#' || ${count('sealant')}
    || '#' || ${last('You work the sealant%')} || '#' || ${refused('seal_item', 'v_it')}
    || '#' || ground_decay_rate(${row('v_it')}) || '#' || ground_decay_rate(${row('v_b')})
    || '#' || mark_says((select mark from item where id = v_it));
  insert into said values ('SEAL', v_t);
  ${clearAll};

  /* ---- The numbers the island reads, and the tree. ---- */
  insert into said values ('CONSTS', post_life_min() || '|' || post_life_max() || '|' || improve_floor() || '|' || restore_harm()
    || '|' || restore_harm_spread() || '|' || restore_age() || '|' || kit_mend());
  insert into said values ('NODES', (select count(*) from class_node where id ~ '^mender_')::text || ':'
    || (select count(*) from player_node where node ~ '^mender_[0-9]_[0-9]$'));
end $$;

select k || E'\\t' || v from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const [k, ...v] = l.split('\t');
  return [k, v.join('\t')];
}));
const say = (k: string): string => said.get(k) ?? 'unsaid';
const pair = (k: string): [number, number] => {
  const [a, b] = say(k).split('|').map(Number);
  return [a, b];
};

/* ---- a go of Repair ------------------------------------------------------------------------ */

const go = repairGo(SKILL);
const [plainDmg, plainQl] = pair('REPAIRplain');
check(`a plain go of Repair at repair ${SKILL} takes ${go.healed.toFixed(1)} out and ${(go.healed * go.cost).toFixed(4)} QL with it`,
  near(plainDmg, DMG - go.healed, 1e-4) && near(plainQl, QL - go.healed * go.cost, 1e-4), say('REPAIRplain'));
const [bigDmg, bigQl] = pair(`REPAIR${P('Big Mend').id}`);
check(`${P('Big Mend').name}: ${fx('Big Mend', 'mend:repair_item')} as much out, at the same quality for each point`,
  near(DMG - bigDmg, go.healed * fx('Big Mend', 'mend:repair_item'), 1e-4) && near(QL - bigQl, (DMG - bigDmg) * go.cost, 1e-4),
  say(`REPAIR${P('Big Mend').id}`));
const [lightDmg, lightQl] = pair(`REPAIR${P('Light Touch').id}`);
check(`${P('Light Touch').name}: the same out for ${fx('Light Touch', 'cost:repair_item')} of the quality`,
  near(lightDmg, plainDmg, 1e-4) && near(QL - lightQl, (QL - plainQl) * fx('Light Touch', 'cost:repair_item'), 1e-4),
  say(`REPAIR${P('Light Touch').id}`));
const [cleanDmg, cleanQl] = pair('CLEAN');
check(`${P('Clean Repair').name}: a go under its ${fx('Clean Repair', 'keep:repair_item')} costs nothing and one over it costs what a go does`,
  near(cleanDmg, DMG - 2 * go.healed, 1e-3) && near(cleanQl, QL - go.healed * go.cost, 1e-3), say('CLEAN'));

/* ---- the time ------------------------------------------------------------------------------ */

const [repairPlain, restorePlain, repairQuick, restoreQuick, floor] = say('TIME').split('|').map((s) => Number(s.split(':')[0]));
check('a go of Repair is on the floor under every job, the browser\'s', near(repairPlain, floor) && near(floor, ACTION_FLOOR), say('TIME'));
check(`${P('Quick Hands').name}: it takes ${fx('Quick Hands', 'time:repair_item')} of that, the perk coming off after the floor`,
  near(repairQuick, floor * fx('Quick Hands', 'time:repair_item'), 1e-4), say('TIME'));
check(`${P('Quick Restore').name}: a restoring is started with ${fx('Quick Restore', 'time:restore_relic')} of the time`,
  restorePlain > floor && near(restoreQuick / restorePlain, fx('Quick Restore', 'time:restore_relic'), 1e-4), say('TIME'));

/* ---- the wear ------------------------------------------------------------------------------ */

const [wearPlain, wearCare] = say('WEAR').split('|').map((s) => s.split(':').map(Number));
check(`${P('Tool Care').name}: a use wears a shovel and a brush ${fx('Tool Care', 'wear:shovel')} as much`,
  wearPlain[0] > 0 && near(wearCare[0] / wearPlain[0], fx('Tool Care', 'wear:shovel'), 1e-4)
    && wearPlain[1] > 0 && near(wearCare[1] / wearPlain[1], fx('Tool Care', 'wear:brush'), 1e-4), say('WEAR'));
const [chestPlain, shieldPlain] = pair('ARMOURplain');
const [chestCare, shieldCare] = pair(`ARMOUR${P('Armour Care').id}`);
check(`a blow of ${BLOW} marks the armour it lands on by four times that and a shield that stops it by three`,
  near(chestPlain, BLOW * 4) && near(shieldPlain, BLOW * 3), say('ARMOURplain'));
check(`${P('Armour Care').name}: ${fx('Armour Care', 'worn:armour')} of each`,
  near(chestCare, chestPlain * fx('Armour Care', 'worn:armour')) && near(shieldCare, shieldPlain * fx('Armour Care', 'worn:shield')),
  say(`ARMOUR${P('Armour Care').id}`));
const swordPlain = Number(say('SWORDplain'));
const swordCare = Number(say(`SWORD${P('Armour Care').id}`));
check(`and a sword that lands a blow ${fx('Armour Care', 'worn:weapon')} of what it takes without`,
  swordPlain > 0 && near(swordCare / swordPlain, fx('Armour Care', 'worn:weapon'), 1e-4), `${swordPlain} / ${swordCare}`);

/* ---- Post Keeper --------------------------------------------------------------------------- */

const keep = fx('Post Keeper', 'life:work_post');
const [postPlain, postKept, postNobody] = say('POST').split('|').map((s) => s.split(':').map(Number));
check(`a post ${AGO} seconds in the ground has taken the browser's damage for it`,
  near(postPlain[0], postDecayRate(QL) * AGO, 1e-4) && near(postPlain[1], postLife(QL) * (1 - postPlain[0] / 100), 1e-4), say('POST'));
check(`${P('Post Keeper').name}: its setter's post takes ${1 / keep} of that and has ${keep} times the life left in it`,
  near(postKept[0], postPlain[0] / keep, 1e-4) && near(postKept[1], postLife(QL) * keep * (1 - postKept[0] / 100), 1e-4), say('POST'));
check('and a post nobody set is as it was', near(postNobody[0], postPlain[0]) && near(postNobody[1], postPlain[1]), say('POST'));
const [trapPlain, trapKept] = say('TRAP').split('|').map((s) => s.split(':').map(Number));
check('and a snare the same',
  trapPlain[0] > 0 && near(trapKept[0], trapPlain[0] / fx('Post Keeper', 'life:snare'), 1e-4)
    && near(trapKept[1], trapLife('snare', QL) * fx('Post Keeper', 'life:snare') * (1 - trapKept[0] / 100), 1e-4), say('TRAP'));
check('a post stands the browser\'s time, the roughest a world half hour where it had stood thirty minutes',
  say('POSTLIFE') === `${POST_LIFE_MIN}|${POST_LIFE_MAX}`, say('POSTLIFE'));

/* ---- restoring ----------------------------------------------------------------------------- */

check(`${P('Sure Restore').name}: the dice that fail a restoring without it pass it with it`, say('SURE') === '1:0|0:1', say('SURE'));
const [harmedAt, harmedSaid] = say('GENTLE').split('|')[0].split(':');
const [gentleAt, gentleSaid] = say('GENTLE').split('|')[1].split(':');
check(`a restoring that fails marks the bauble by ${RESTORE_HARM} and up to ${RESTORE_HARM_SPREAD} more`,
  near(Number(harmedAt), BAUBLE_DMG + RESTORE_HARM + HARM_ROLL * RESTORE_HARM_SPREAD) && harmedSaid === 'The tarnish will not lift from the minor bauble and you mark it trying.',
  say('GENTLE'));
check(`${P('Gentle Hands').name}: and not at all with it, and says so`,
  near(Number(gentleAt), BAUBLE_DMG) && gentleSaid === 'The tarnish will not lift from the minor bauble, and it takes no harm from the trying.', say('GENTLE'));
const restored = BAUBLE_QL * (1 - BAUBLE_DMG / RESTORE_AGE) * (0.72 + SKILL / 260);
check('a bauble comes out at its quality, less what its damage took, at the restorer\'s skill', near(Number(say('QLplain')), restored, 1e-4), say('QLplain'));
check(`${P('Fine Restore').name}: ${fx('Fine Restore', 'ql:restore_relic')} of that`,
  near(Number(say(`QL${P('Fine Restore').id}`)), restored * fx('Fine Restore', 'ql:restore_relic'), 1e-4), say(`QL${P('Fine Restore').id}`));
check(`${P('Age Undone').name}: nothing taken off it for its damage`,
  near(Number(say(`QL${P('Age Undone').id}`)), BAUBLE_QL * (0.72 + SKILL / 260), 1e-4), say(`QL${P('Age Undone').id}`));
// Dice that low go on up past rare, as far as the browser's own roll goes on them.
const lucky = RARITIES[rollRarity(() => RARE_ROLL, fx('Lucky Polish', 'rare:restore_relic'))].name;
check(`${P('Lucky Polish').name}: dice of ${RARE_ROLL} make nothing rare without it, and with it what the browser's roll makes of them (${lucky})`,
  say('RAREplain') === 'none' && lucky !== '' && say(`RARE${P('Lucky Polish').id}`) === lucky, `${say('RAREplain')} / ${say(`RARE${P('Lucky Polish').id}`)}`);
const tierPlain = say('TIERplain').split(':');
const tierUp = say(`TIER${P('Tier Up').id}`).split(':');
check(`${P('Tier Up').name}: under its ${fx('Tier Up', 'tier:restore_relic')} a minor bauble comes out major, and says so`,
  tierPlain.slice(0, 2).join(':') === '1:0' && tierUp.slice(0, 2).join(':') === '0:1'
    && tierUp.slice(2).join(':').startsWith('The tarnish comes away and the minor bauble is a major one: '), `${say('TIERplain')} / ${say(`TIER${P('Tier Up').id}`)}`);
const [lookFirst, lookSecond] = say('LOOKplain').split('#');
const [keptFirst, keptSecond] = say(`LOOK${P('Second Look').id}`).split('#');
check(`${P('Second Look').name}: without it a bauble keeps the one roll it had, the smaller or the larger`,
  lookFirst.includes(ROLLS[0].toFixed(1)) && lookSecond.includes(ROLLS[1].toFixed(1)), say('LOOKplain'));
check('with it, the larger of two, whichever came first', keptFirst.includes(ROLLS[1].toFixed(1)) && keptSecond.includes(ROLLS[1].toFixed(1)),
  say(`LOOK${P('Second Look').id}`));
const [piecePlain1, piecePlain2, pieceSaid] = say('PIECESplain').split(':');
const [pieceGentle1, pieceGentle2, pieceGentleSaid] = say(`PIECES${P('Gentle Hands').id}`).split(':');
check('a relic that will not go together marks each piece, and not with Gentle Hands',
  near(Number(piecePlain1), BAUBLE_DMG + RESTORE_HARM + HARM_ROLL * RESTORE_HARM_SPREAD) && near(Number(piecePlain2), Number(piecePlain1))
    && pieceSaid === 'The pieces of the old pot will not sit together and you mark them trying.'
    && near(Number(pieceGentle1), BAUBLE_DMG) && near(Number(pieceGentle2), BAUBLE_DMG)
    && pieceGentleSaid === 'The pieces of the old pot will not sit together, and they take no harm from the trying.',
  `${say('PIECESplain')} / ${say(`PIECES${P('Gentle Hands').id}`)}`);
check('and a relic Sure Restore puts together comes out finer and with nothing off for its damage',
  near(Number(say('RELIC')), BAUBLE_QL * (0.72 + SKILL / 260) * fx('Fine Restore', 'ql:restore_relic'), 1e-4), say('RELIC'));
const [baubleOn, baubleOff, relicOn, relicOff] = say('LEARN').split('|').map(Number);
check(`a bauble restored teaches Restoration, and one whose tarnish will not lift ${TRY_LEARN} of that`,
  // A skill is kept to a real's precision on the island, which at seventy is a few hundred-thousandths.
  baubleOn > 0 && near(baubleOff / baubleOn, TRY_LEARN, 2e-3), say('LEARN'));
check(`a relic put back together teaches Restoration, and one whose pieces will not sit ${TRY_LEARN} of that`,
  relicOn > 0 && near(relicOff / relicOn, TRY_LEARN, 2e-3) && near(relicOn, baubleOn, 1e-4), say('LEARN'));

/* ---- Handyman ------------------------------------------------------------------------------ */

check(`${P('Handyman').name}: at carpentry ${LOW_SKILL} a thing is bettered to ${IMPROVE_FLOOR} without it and to ${fx('Handyman', 'floor:improve')} with it, `
  + `and at ${SKILL} to ${SKILL} either way`, say('FLOOR') === `${IMPROVE_FLOOR}|${fx('Handyman', 'floor:improve')}|${SKILL}`, say('FLOOR'));

/* ---- the kit ------------------------------------------------------------------------------- */

const kit = say('KIT').split('#');
check(`${P('Repair Kit').name}: refused without it in the browser's words, made with it`,
  kit[0] === RECIPE_PERK_SAYS.repair_kit && kit[1] === 'ALLOWED' && kit[2] === '1', kit.slice(0, 3).join(' / '));
check(`anybody may use one: it takes ${KIT_MEND} off a shovel and none of its quality, and is used up`,
  kit[3] === 'ALLOWED' && kit[4] === `${80 - KIT_MEND}:${QL}` && kit[5] === '0' && kit[6] === `You mend the shovel with a repair kit. (damage ${(80 - KIT_MEND).toFixed(2)})`,
  kit.slice(3, 7).join(' / '));
check('and is refused with none left, and on a thing that wants nothing, in the browser\'s words',
  kit[7] === 'You have no repair kit.' && kit[8] === 'There is nothing wrong with it.', kit.slice(7).join(' / '));

/* ---- the sealant --------------------------------------------------------------------------- */

const seal = say('SEAL').split('#');
check(`${P('Sealant').name}: refused without it in the browser's words, made with it`,
  seal[0] === RECIPE_PERK_SAYS.sealant && seal[1] === 'ALLOWED' && seal[2] === '2', seal.slice(0, 3).join(' / '));
check('a pile of three logs wants three', seal[3] === 'You need 3 sealant to seal all 3 of them; you have 2.' && seal[4] === 'ALLOWED', seal.slice(3, 5).join(' / '));
check('and sealed, it carries the seal, the sealant is spent, and it will not be sealed twice',
  seal[5] === '{"seal": 0}' && seal[6] === '0' && seal[7] === 'You work the sealant over the log. It will not decay now.' && seal[8] === 'It is sealed already.',
  seal.slice(5, 9).join(' / '));
check('a sealed pile never decays on the ground, where a plank does', Number(seal[9]) === 0 && Number(seal[10]) > 0, seal.slice(9, 11).join(' / '));
check('and says so in the browser\'s words', seal[11] === markSays({ seal: 0 }), `${seal[11]} // ${markSays({ seal: 0 })}`);

/* ---- the browser --------------------------------------------------------------------------- */

const game = Game.create(4402);
game.setPerks({});
game.skills.values.set('repair', SKILL);
game.skills.values.set('restoration', SKILL);
const itemTarget = (it: Item): Target => ({ kind: 'item', uid: it.uid });
const repairDef = ACTION_BY_ID.get('repair_item')!;
const shovelAt = (dmg: number): Item => {
  const it = game.inventory.add('shovel', { ql: QL });
  it.dmg = dmg;
  return it;
};
const mended = (fxs: Record<string, number>): string => {
  game.setPerks(fxs);
  game.skills.values.set('repair', SKILL);
  const it = shovelAt(DMG);
  repairDef.perform(itemTarget(it), game);
  game.inventory.remove(it.uid, 1);
  return `${it.dmg}|${it.ql}`;
};
const same = (a: string, b: string): boolean => {
  const [x, y] = a.split('|').map(Number);
  const [z, t] = b.split('|').map(Number);
  return near(x, z, 1e-4) && near(y, t, 1e-4);
};
check('the browser\'s go of Repair is the island\'s, plain, with Big Mend and with Light Touch',
  same(mended({}), say('REPAIRplain')) && same(mended(P('Big Mend').fx), say(`REPAIR${P('Big Mend').id}`))
    && same(mended(P('Light Touch').fx), say(`REPAIR${P('Light Touch').id}`)), `${mended({})} / ${mended(P('Big Mend').fx)} / ${mended(P('Light Touch').fx)}`);
game.setPerks({});
check('its go of Repair is on the same floor, and Quick Hands takes the same off it',
  near(game.duration(repairDef), repairPlain) && (game.setPerks(P('Quick Hands').fx), near(game.duration(repairDef), repairQuick)),
  `${game.duration(repairDef)}`);
game.setPerks({});
check('and every job\'s floor is the shortest a job takes without a perk', near(goSeconds(repairDef.baseTime, 100, 100), ACTION_FLOOR));
const shovel = shovelAt(0);
game.wearTool('shovel');
const wornPlain = shovel.dmg;
shovel.dmg = 0;
game.setPerks(P('Tool Care').fx);
game.wearTool('shovel');
check('its Tool Care wears a shovel as the island\'s does', near(shovel.dmg / wornPlain, wearCare[0] / wearPlain[0], 1e-4), `${wornPlain} / ${shovel.dmg}`);
game.inventory.remove(shovel.uid, 1);
const piece = game.inventory.add(PIECE, { ql: QL });
game.player.equipped.chest = piece.uid;
game.setPerks({});
game.rand = () => LOCATION_ROLL;
game.absorb(BLOW);
const chestB = piece.dmg;
piece.dmg = 0;
game.setPerks(P('Armour Care').fx);
game.absorb(BLOW);
check('its armour takes the island\'s damage from a blow, plain and with Armour Care', near(chestB, chestPlain) && near(piece.dmg, chestCare),
  `${chestB} / ${piece.dmg}`);
game.player.equipped.chest = null;
game.inventory.remove(piece.uid, 1);
game.setPerks({});
check('its post decays as the island\'s does, and slower for a Post Keeper',
  near(postDecayRate(QL) / postKeep(game) * AGO, postPlain[0], 1e-4)
    && (game.setPerks(P('Post Keeper').fx), near(postDecayRate(QL) / postKeep(game) * AGO, postKept[0], 1e-4)
      && trapKeep(game, 'snare') === fx('Post Keeper', 'life:snare')));
game.setPerks({});
const restoreDef = ACTION_BY_ID.get('restore_relic')!;
const restoredWith = (fxs: Record<string, number>): number => {
  game.setPerks(fxs);
  const b = game.inventory.add('tarnished_bauble', { ql: BAUBLE_QL, extra: 'minor' });
  b.dmg = BAUBLE_DMG;
  game.rand = () => PLAIN_ROLL;
  restoreDef.perform(itemTarget(b), game);
  const made = game.inventory.items.filter((it) => it.id === 'bauble_minor').pop();
  if (made) game.inventory.remove(made.uid, 1);
  return made?.ql ?? -1;
};
check('its restored bauble comes out at the island\'s quality, plain, with Fine Restore and with Age Undone',
  near(restoredWith({}), Number(say('QLplain')), 1e-4) && near(restoredWith(P('Fine Restore').fx), Number(say(`QL${P('Fine Restore').id}`)), 1e-4)
    && near(restoredWith(P('Age Undone').fx), Number(say(`QL${P('Age Undone').id}`)), 1e-4),
  `${restoredWith({})} / ${restoredWith(P('Fine Restore').fx)} / ${restoredWith(P('Age Undone').fx)}`);
// A go of restoring that does not come off is a missed go, which the browser's runner pays at `TRY_LEARN` of Restoration,
// as the island's `try_gain` does; one that comes off is a whole go.
const own = game as unknown as { swingMissed: boolean; sureCheck: () => boolean };
const missedOn = (pass: boolean, what: 'bauble' | 'relic'): boolean => {
  game.setPerks({});
  own.swingMissed = false;
  own.sureCheck = () => pass;
  const first = what === 'bauble'
    ? Object.assign(game.inventory.add('tarnished_bauble', { ql: BAUBLE_QL, extra: 'minor' }), { dmg: BAUBLE_DMG })
    : Object.assign(game.inventory.add('fragment', { ql: BAUBLE_QL, extra: 'old pot 1/2' }), { dmg: BAUBLE_DMG });
  if (what === 'relic') Object.assign(game.inventory.add('fragment', { ql: BAUBLE_QL, extra: 'old pot 2/2' }), { dmg: BAUBLE_DMG });
  restoreDef.perform(itemTarget(first), game);
  const was = own.swingMissed;
  delete (own as { sureCheck?: unknown }).sureCheck;
  own.swingMissed = false;
  for (const it of [...game.inventory.items]) if (['tarnished_bauble', 'fragment', 'bauble_minor', 'clay_pot'].includes(it.id)) game.inventory.remove(it.uid, it.count);
  return was;
};
check('its restoring pays Restoration as the island does: a whole go when it comes off, a missed one when it does not',
  !missedOn(true, 'bauble') && missedOn(false, 'bauble') && !missedOn(true, 'relic') && missedOn(false, 'relic'),
  `${missedOn(true, 'bauble')} ${missedOn(false, 'bauble')} ${missedOn(true, 'relic')} ${missedOn(false, 'relic')}`);
game.setPerks(P('Tier Up').fx);
const tarnished = game.inventory.add('tarnished_bauble', { ql: BAUBLE_QL, extra: 'minor' });
tarnished.dmg = BAUBLE_DMG;
game.rand = () => TIER_ROLL;
game.log.length = 0;
restoreDef.perform(itemTarget(tarnished), game);
check('its Tier Up makes a major bauble of a minor one under the same dice, and says so in the island\'s words',
  game.inventory.count('bauble_major') === 1 && game.log.some((l) => l.text.startsWith('The tarnish comes away and the minor bauble is a major one: ')),
  game.log.map((l) => l.text).join(' | '));
game.setPerks({});
game.skills.values.set('carpentry', LOW_SKILL);
check('its Handyman\'s floor is the island\'s', improveCeiling(game, 'carpentry') === IMPROVE_FLOOR
  && (game.setPerks(P('Handyman').fx), improveCeiling(game, 'carpentry') === fx('Handyman', 'floor:improve')));
game.setPerks({});
check('its repair kit and sealant are refused in the island\'s words without the perks',
  recipeReason(RECIPE_BY_ID.get('make_repair_kit')!, game) === RECIPE_PERK_SAYS.repair_kit
    && recipeReason(RECIPE_BY_ID.get('make_sealant')!, game) === RECIPE_PERK_SAYS.sealant);
const kitDef = ACTION_BY_ID.get('mend_kit')!;
const sealDef = ACTION_BY_ID.get('seal_item')!;
const worn = shovelAt(80);
check('its kit is refused with none carried, in the island\'s words', kitDef.check?.(itemTarget(worn), game) === 'You have no repair kit.');
game.inventory.add('repair_kit', { ql: 30 });
game.log.length = 0;
kitDef.perform(itemTarget(worn), game);
check('and used by anybody, it takes the same off and says the same', worn.dmg === 80 - KIT_MEND && worn.ql === QL
  && game.inventory.count('repair_kit') === 0 && game.log.some((l) => l.text === kit[6]), game.log.map((l) => l.text).join(' | '));
const logs = game.inventory.add('log', { ql: 30, count: 3 });
game.inventory.add('sealant', { ql: 30, count: 2 });
check('its sealant is refused on a pile it is short for, in the island\'s words', sealDef.check?.(itemTarget(logs), game) === seal[3],
  String(sealDef.check?.(itemTarget(logs), game)));
game.inventory.add('sealant', { ql: 30 });
game.log.length = 0;
sealDef.perform(itemTarget(logs), game);
check('and worked over it, it seals the pile, spends one to a log and says the same', logs.mark?.seal === 0 && game.inventory.count('sealant') === 0
  && game.log.some((l) => l.text === seal[7]) && groundDecayRate(logs) === 0 && sealDef.check?.(itemTarget(logs), game) === seal[8],
  game.log.map((l) => l.text).join(' | '));
check('and a seal is not carried from a part into what it goes into, on either side', partsMark([{ mark: { seal: 0 } }]).seal === undefined);

/* ---- what the island says the numbers are ------------------------------------------------ */

check('the island\'s numbers for a post, the floor, a restoring and a kit are the browser\'s',
  say('CONSTS') === [POST_LIFE_MIN, POST_LIFE_MAX, IMPROVE_FLOOR, RESTORE_HARM, RESTORE_HARM_SPREAD, RESTORE_AGE, KIT_MEND].join('|'), say('CONSTS'));
check('and the Mender\'s tree is gone', say('NODES') === '0:0', say('NODES'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Mender's perks — ${ok.length} of ${ok.length}`);
