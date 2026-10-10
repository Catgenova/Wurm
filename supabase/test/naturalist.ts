/**
 * The Naturalist's eighteen perks, each measured where its rule is.
 *
 * `perks.ts` holds the two sides to each other for every trade on perks; this
 * asks the one thing that is the Naturalist's own: that each perk does what its
 * note says, on the island. Where a perk is a chance, the island's dice are put
 * either side of its number inside the transaction (`dice.random`, first on the
 * search path), so a go shows the number itself:
 *
 *   * a look over the ground: Keen Eye's one more pass, Sure Find's none empty
 *     by chance, and Rare Find's rare find, foraging and botanizing alike;
 *   * a cut: Hay Cutter's grass and Reed Cutter's reeds;
 *   * the pot: Quick Lye's time, Double Boil's litres, Thrifty Dyer's dyestuff,
 *     Sure Boil's fewer failures and Ink Maker's ink; Cover Maker's covers;
 *   * a dressing: Quick Dressing's time, Sure Hands' fewer slips, Quick Mend's
 *     faster closing, somebody else dressed by anybody, and Field Medic's more on them;
 *   * the remedies, made only with the perk and used by anybody: herb tea's
 *     stamina, a salve's wound that never goes bad, and a tincture's four
 *     trades, beside a dish's knack rather than in its place;
 *   * a hive filling at last on an island, which is where a salve's wax is;
 *   * the Naturalist's tree gone;
 *   * and the browser reckons and says the same.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, GRASS_PER_CUT, REED_CUT, type Target } from '../../src/game/actions';
import { TINCTURE_BONUS, TINCTURE_SECONDS, TINCTURE_SKILLS } from '../../src/game/boons';
import { DRESS_CHECK } from '../../src/game/firstaid';
import { COIN_FIND_ONE_IN, COIN_FINDS_A_DAY, EMPTY_CHANCE, rollsAt } from '../../src/game/forage';
import { hiveRate, HIVE_WAX } from '../../src/game/furniture';
import { ITEM_DEFS, RARITIES } from '../../src/game/items';
import { perksOf, type PerkDef } from '../../src/game/perks';
import { RECIPE_BY_ID, RECIPE_PERK_SAYS } from '../../src/game/recipes';
import { salveRefusal, TINCTURE_NAMES } from '../../src/game/remedies';
import { festerChance, woundClose, type Wound } from '../../src/game/wounds';
import { percent } from '../../src/game/words';
import { TileType } from '../../src/world/tiles';
import { DYE_BOIL_LITRES, dyeRecipeId } from '../../src/game/dyestuffs';

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

const NATURALIST = perksOf('naturalist');
const P = (name: string): PerkDef => {
  const p = NATURALIST.find((x) => x.name === name);
  if (!p) throw new Error(`the Naturalist has no perk called ${name}`);
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
  `(select e.text from event e where e.world_id = w and e.uid = u and e.text like ${q(like)} order by e.n desc limit 1)`;
const craft = (r: string): string => `perform perform_craft(w, u, '${r}', jsonb_build_object('kind', 'item', 'uid', null))`;
const craftRefused = (r: string): string => `coalesce(act_refusal(w, u, '${r}', jsonb_build_object('kind', 'item', 'uid', null)), 'ALLOWED')`;
const onTile = (a: string, x: number, y: number): string =>
  `perform act_perform(w, u, '${a}', jsonb_build_object('kind', 'tile', 'x', ${x}, 'y', ${y}, 'cx', ${x + 0.5}, 'cy', ${y + 0.5}))`;
const onItem = (a: string, id: string): string => `perform act_perform(w, u, '${a}', jsonb_build_object('kind', 'item', 'uid', ${id}))`;
const itemRefused = (a: string, id: string): string =>
  `coalesce(act_refusal(w, u, '${a}', jsonb_build_object('kind', 'item', 'uid', ${id})), 'ALLOWED')`;
const person = `jsonb_build_object('kind', 'person', 'uid', v_other::text, 'name', 'Hild')`;
const inputs = (recipe: string): string =>
  (RECIPE_BY_ID.get(recipe)?.inputs ?? []).map((i) => `perform give(w, u, '${i.item}', ${i.count ?? 1}, 30);`).join('\n  ');
const checks = (pass: boolean): string =>
  `create or replace function skill_check(p_skill double precision, p_difficulty double precision,
     p_tool_ql double precision default 0, p_ease double precision default 0)
     returns boolean language sql as 'select ${pass}'`;
const dice = (...xs: number[]): string => `perform pg_temp.dice('${xs.join(',')}')`;
const nodice = 'perform pg_temp.nodice()';
const HANDS = 40;
const SKILL = 40;
const SPACE = 'between 4 and 15';
/** A deep cut to an arm, open and undressed: deep enough that a dressing does not close it outright. */
const CUT = { id: 1, kind: 'cut', part: 'arms', severity: 0.6, bleeding: true, infected: false, dressing: null, at: 0 };
const jsonSql = (m: unknown): string => `${q(JSON.stringify(m))}::jsonb`;

/* What the dice are put at: either side of each perk's number. */
const EMPTY_BELOW = EMPTY_CHANCE - 0.01;
const EMPTY_ABOVE = EMPTY_CHANCE + 0.01;
const RARE_BELOW = fx('Rare Find', 'rare:forage') / 2;
const RARE_ABOVE = fx('Rare Find', 'rare:forage') * 2;
const SLIP = fx('Sure Hands', 'fail:bind_wound');
const BOIL = fx('Sure Boil', 'fail:make_ink');
const DYE = dyeRecipeId('blueberry');
/** The litres of dye in the bucket a boil leaves. */
const dyeLitres = `(select coalesce(sum((dye_in(i)).litres), 0) from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = 'dye_bucket')`;
const HIVE_QL = 50;
const HIVE_AGO = 600;

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
declare w uuid; u uuid; tx int; ty int; v_t text; v_u text; v_it bigint; v_n int; v_other uuid;
        v_hive bigint; v_c int; v_food text;
begin
  -- The suite's own island and its first body, a Naturalist now, on flat grass on their settlement.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  select p.uid into v_other from player p where p.world_id = w order by p.uid offset 1 limit 1;
  for tx in 0..15 loop for ty in 0..15 loop
    perform land_set_height(w, tx, ty, 40); perform land_set_dirt(w, tx, ty, 20);
    perform land_set_tile(w, tx, ty, tile_id('Grass')); perform land_set_data(w, tx, ty, 0);
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
         act_left = null, act_goes = null, act_queue = '[]', craft_class = 'naturalist', combat_class = null,
         class_mul = null, level_h = null, rested = 0, boons = '[]'::jsonb, body_at = now(), swim_at = now(),
         equipped = '{}'::jsonb, craft_from_stores = true, craft_spare_rare = false, wounds = '[]'::jsonb,
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
   where world_id = w and uid = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  insert into skill (world_id, uid, id, value)
    select w, u, s, ${SKILL} from unnest(array['foraging', 'botanizing', 'alchemy', 'first_aid', 'chirurgy']) s
    on conflict (world_id, uid, id) do update set value = excluded.value;
  insert into said values ('DEED', coalesce((deed_at(w, 9, 10)).name, 'none'));

  /* ---- Keen Eye: the passes, told in the words for a go that found nothing (every look empty by chance). ---- */
  ${checks(true)};
  perform pg_temp.hold(w, u, '{}');
  ${dice(0.01)};
  ${onTile('forage', 1, 1)};
  ${onTile('botanize', 2, 1)};
  ${hold('Keen Eye')};
  ${onTile('forage', 3, 1)};
  ${onTile('botanize', 4, 1)};
  ${nodice};
  insert into said values ('PASSES', (select string_agg(e.text, '#' order by e.n) from (
    select text, n from event where world_id = w and uid = u and text like 'You go over the ground%' order by n desc limit 4) e));

  /* ---- Sure Find: a look empty by chance below its number, and not above it, and never for the perk. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${clearAll};
  ${dice(EMPTY_BELOW)};
  ${onTile('forage', 1, 2)};
  v_t := (select coalesce(sum(count), 0) from item where world_id = w and holder = 'player' and holder_uid = u)::text;
  ${dice(EMPTY_ABOVE)};
  ${onTile('forage', 2, 2)};
  v_t := v_t || ':' || (select coalesce(sum(count), 0) from item where world_id = w and holder = 'player' and holder_uid = u);
  ${clearAll};
  ${hold('Sure Find')};
  ${dice(EMPTY_BELOW)};
  ${onTile('forage', 3, 2)};
  ${onTile('botanize', 4, 2)};
  ${nodice};
  insert into said values ('EMPTY', v_t || ':' || (select coalesce(sum(count), 0) from item where world_id = w and holder = 'player' and holder_uid = u));

  /* ---- Rare Find: with the dice under its number a find comes up rare, and all the way; above it, not. ---- */
  ${clearAll};
  ${hold('Sure Find')};
  ${dice(RARE_BELOW)};
  ${onTile('forage', 1, 3)};
  v_t := (select count(*) from item where world_id = w and holder = 'player' and holder_uid = u and rare is not null)::text;
  ${clearAll};
  ${hold('Sure Find', 'Rare Find')};
  ${dice(RARE_BELOW)};
  ${onTile('forage', 2, 3)};
  v_t := v_t || ':' || (select coalesce(string_agg(distinct rare, ','), 'none') from item where world_id = w and holder = 'player' and holder_uid = u)
    || ':' || coalesce(${last('You find some %')}, 'unsaid');
  ${clearAll};
  ${dice(RARE_ABOVE)};
  ${onTile('botanize', 3, 3)};
  ${nodice};
  insert into said values ('RARE', v_t || '#' || (select count(*) from item where world_id = w and holder = 'player' and holder_uid = u and rare is not null));

  /* ---- Hay Cutter and Reed Cutter: a cut of grass, and of reeds with the dice against the third. ---- */
  ${clearAll};
  perform pg_temp.hold(w, u, '{}');
  ${onTile('cut_grass', 1, 4)};
  v_t := ${count('mixed_grass')} || ':' || coalesce(${last('You cut % bundles%')}, 'unsaid');
  ${clearAll};
  ${hold('Hay Cutter')};
  ${onTile('cut_grass', 2, 4)};
  v_t := v_t || '#' || ${count('mixed_grass')} || ':' || coalesce(${last('You cut % bundles%')}, 'unsaid');
  ${clearAll};
  perform land_set_tile(w, 3, 4, tile_id('Reed')); perform land_set_tile(w, 4, 4, tile_id('Reed'));
  perform give(w, u, 'carving_knife', 1, 40);
  perform pg_temp.hold(w, u, '{}');
  ${dice(0.99)};
  ${onTile('cut_reeds', 3, 4)};
  v_t := v_t || '#' || ${count('reed')};
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'reed';
  ${hold('Reed Cutter')};
  ${onTile('cut_reeds', 4, 4)};
  ${nodice};
  insert into said values ('CUT', v_t || ':' || ${count('reed')} || ':' || coalesce(${last('You cut % reeds%')}, 'unsaid'));
  ${clearAll};

  /* ---- The pot: Quick Lye's time; Double Boil's litres; Thrifty Dyer's dyestuff; Ink Maker; Cover Maker. ---- */
  ${inputs('make_lye')}
  perform pg_temp.hold(w, u, '{}');
  v_t := pg_temp.secs(w, u, 'make_lye', jsonb_build_object('kind', 'item', 'uid', null));
  ${hold('Quick Lye')};
  insert into said values ('LYE', v_t || '|' || pg_temp.secs(w, u, 'make_lye', jsonb_build_object('kind', 'item', 'uid', null)));
  ${clearAll};
  ${inputs(DYE)}
  perform pg_temp.hold(w, u, '{}');
  ${craft(DYE)};
  v_t := ${dyeLitres}::text;
  ${clearAll};
  ${inputs(DYE)}
  ${hold('Double Boil')};
  ${craft(DYE)};
  v_t := v_t || ':' || ${dyeLitres};
  ${clearAll};
  perform pg_temp.hold(w, u, '{}');
  v_t := v_t || '|' || recipe_need(w, u, '${DYE}', ${RECIPE_BY_ID.get(DYE)?.inputs[0].count ?? 0});
  ${hold('Thrifty Dyer')};
  v_t := v_t || ':' || recipe_need(w, u, '${DYE}', ${RECIPE_BY_ID.get(DYE)?.inputs[0].count ?? 0});
  perform give(w, u, '${RECIPE_BY_ID.get(DYE)?.inputs[0].item}', ${Math.ceil((RECIPE_BY_ID.get(DYE)?.inputs[0].count ?? 0) * fx('Thrifty Dyer', `need:${DYE}`))}, 30);
  perform give(w, u, 'lye_bucket', 1, 30);
  v_t := v_t || ':' || ${craftRefused(DYE)};
  perform pg_temp.hold(w, u, '{}');
  v_t := v_t || ':' || ${craftRefused(DYE)};
  insert into said values ('DYE', v_t);
  ${clearAll};
  ${inputs('make_ink')}
  ${craft('make_ink')};
  v_t := ${count('ink')}::text;
  ${clearAll};
  ${inputs('make_ink')}
  ${hold('Ink Maker')};
  ${craft('make_ink')};
  v_t := v_t || ':' || ${count('ink')};
  ${clearAll};
  ${inputs('make_cover_thyme')}
  perform pg_temp.hold(w, u, '{}');
  ${craft('make_cover_thyme')};
  v_t := v_t || '|' || ${count('cover')};
  ${clearAll};
  ${inputs('make_cover_thyme')}
  ${hold('Cover Maker')};
  ${craft('make_cover_thyme')};
  insert into said values ('MADE', v_t || ':' || ${count('cover')});
  ${clearAll};

  /* ---- Sure Boil: every check failed, the dice either side of its number. ---- */
  ${checks(false)};
  perform pg_temp.hold(w, u, '{}');
  ${inputs('make_ink')}
  ${dice(BOIL + 0.05)};
  ${craft('make_ink')};
  v_t := ${count('ink')}::text;
  ${clearAll};
  ${hold('Sure Boil')};
  ${inputs('make_ink')}
  ${craft('make_ink')};
  v_t := v_t || ':' || ${count('ink')};
  ${clearAll};
  ${inputs('make_ink')}
  ${dice(BOIL - 0.05)};
  ${craft('make_ink')};
  ${nodice};
  insert into said values ('BOIL', v_t || ':' || ${count('ink')});
  ${clearAll};

  /* ---- A dressing: Quick Dressing's time, Sure Hands with every check failed, Quick Mend's pace. ---- */
  ${checks(true)};
  perform pg_temp.hold(w, u, '{}');
  update player set wounds = jsonb_build_array(${jsonSql(CUT)}), stats = stats || jsonb_build_object('hurtSettled', now()) where world_id = w and uid = u;
  perform give(w, u, 'bandage', 5, 40);
  v_it := ${newest('bandage')};
  v_t := pg_temp.secs(w, u, 'bind_wound', jsonb_build_object('kind', 'item', 'uid', v_it));
  ${hold('Quick Dressing')};
  insert into said values ('DRESSTIME', v_t || '|' || pg_temp.secs(w, u, 'bind_wound', jsonb_build_object('kind', 'item', 'uid', v_it)));
  ${checks(false)};
  perform pg_temp.hold(w, u, '{}');
  ${dice(SLIP + 0.05)};
  ${onItem('bind_wound', 'v_it')};
  v_t := coalesce((select w0->>'dressing' from player, jsonb_array_elements(wounds) w0 where world_id = w and uid = u), 'none');
  update player set wounds = jsonb_build_array(${jsonSql(CUT)}), stats = stats || jsonb_build_object('hurtSettled', now()) where world_id = w and uid = u;
  ${hold('Sure Hands')};
  ${onItem('bind_wound', 'v_it')};
  v_t := v_t || ':' || coalesce((select w0->>'dressing' from player, jsonb_array_elements(wounds) w0 where world_id = w and uid = u), 'none');
  update player set wounds = jsonb_build_array(${jsonSql(CUT)}), stats = stats || jsonb_build_object('hurtSettled', now()) where world_id = w and uid = u;
  ${dice(SLIP - 0.05)};
  ${onItem('bind_wound', 'v_it')};
  ${nodice};
  insert into said values ('SLIP', v_t || ':' || coalesce((select w0->>'dressing' from player, jsonb_array_elements(wounds) w0 where world_id = w and uid = u), 'none'));
  ${checks(true)};
  update player set wounds = jsonb_build_array(${jsonSql(CUT)}), stats = stats || jsonb_build_object('hurtSettled', now()) where world_id = w and uid = u;
  ${hold('Quick Mend')};
  ${onItem('bind_wound', 'v_it')};
  v_t := coalesce((select w0->>'mend' from player, jsonb_array_elements(wounds) w0 where world_id = w and uid = u), 'none');
  v_t := v_t || ':' || (select wound_close(w0, ${SKILL}) from player, jsonb_array_elements(wounds) w0 where world_id = w and uid = u)
    || ':' || (select wound_close(w0 - 'mend', ${SKILL}) from player, jsonb_array_elements(wounds) w0 where world_id = w and uid = u);
  -- A dressing by somebody without it takes the quick hands off it.
  update player set wounds = jsonb_build_array(${jsonSql({ ...CUT, mend: 1.5 })}), stats = stats || jsonb_build_object('hurtSettled', now()) where world_id = w and uid = u;
  perform pg_temp.hold(w, u, '{}');
  ${onItem('bind_wound', 'v_it')};
  insert into said values ('MEND', v_t || ':' || coalesce((select w0->>'mend' from player, jsonb_array_elements(wounds) w0 where world_id = w and uid = u), 'none'));

  /* ---- Somebody else: Hild beside you with a cut, dressed by anybody, and more with Field Medic; too far away, refused. ---- */
  update player set x = 10.2, y = 9.5, wounds = jsonb_build_array(${jsonSql(CUT)}), body_at = now(),
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('health', 0.5, 'hurtSettled', now()) where world_id = w and uid = v_other;
  update player set wounds = '[]'::jsonb where world_id = w and uid = u;
  perform give(w, u, 'bandage', 3, 40);
  perform pg_temp.hold(w, u, '{}');
  v_t := coalesce(act_refusal(w, u, 'bind_wound', ${person}), 'ALLOWED');
  v_n := ${count('bandage')};
  -- The hand as it is now, put back before the second, so the first's practice does not count in it.
  perform set_config('wurm.first_aid', skill_of(w, u, 'first_aid')::text, true);
  perform act_perform(w, u, 'bind_wound', ${person});
  v_t := v_t || '#' || (v_n - ${count('bandage')}) || ':'
    || coalesce((select w0->>'dressing' || '/' || (w0->>'bleeding') from player, jsonb_array_elements(wounds) w0 where world_id = w and uid = v_other), 'none')
    || ':' || ((select (stats->>'health')::double precision from player where world_id = w and uid = v_other) > 0.5)
    || ':' || coalesce((select e.text from event e where e.world_id = w and e.uid = v_other order by e.n desc limit 1), 'unsaid');
  -- What it put back, and the same again under Field Medic.
  v_u := ((select (stats->>'health')::double precision from player where world_id = w and uid = v_other) - 0.5)::text;
  update player set wounds = jsonb_build_array(${jsonSql(CUT)}), stats = stats || jsonb_build_object('health', 0.5, 'hurtSettled', now())
   where world_id = w and uid = v_other;
  ${hold('Field Medic')};
  update skill set value = current_setting('wurm.first_aid')::double precision where world_id = w and uid = u and id = 'first_aid';
  perform act_perform(w, u, 'bind_wound', ${person});
  v_t := v_t || '#' || v_u || '|' || ((select (stats->>'health')::double precision from player where world_id = w and uid = v_other) - 0.5);
  update player set x = 15.5, y = 15.5 where world_id = w and uid = v_other;
  insert into said values ('MEDIC', v_t || '#' || coalesce(act_refusal(w, u, 'bind_wound', ${person}), 'ALLOWED'));
  update player set wounds = '[]'::jsonb where world_id = w and uid = v_other;
  ${clearAll};

  /* ---- The remedies: each refused without its perk and made with it. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${inputs('brew_tea_thyme')}
  ${inputs('make_salve_thyme')}
  ${inputs('make_tincture_thyme')}
  v_t := ${craftRefused('brew_tea_thyme')} || '#' || ${craftRefused('make_salve_thyme')} || '#' || ${craftRefused('make_tincture_thyme')};
  ${hold('Herb Tea', 'Salve', 'Tincture')};
  v_t := v_t || '#' || ${craftRefused('brew_tea_thyme')} || '#' || ${craftRefused('make_salve_thyme')} || '#' || ${craftRefused('make_tincture_thyme')};
  ${craft('brew_tea_thyme')};
  ${craft('make_salve_thyme')};
  ${craft('make_tincture_thyme')};
  insert into said values ('REMEDY', v_t || '|' || ${count('herb_tea')} || ':' || ${count('salve')} || ':' || ${count('tincture')} || ':' || ${count('bucket')});

  /* ---- Herb tea: stamina back, and refused when there is none to put back. ---- */
  perform pg_temp.hold(w, u, '{}');
  update player set stats = stats || jsonb_build_object('stamina', 1) where world_id = w and uid = u;
  v_t := ${itemRefused('drink_tea', newest('herb_tea'))};
  update player set stats = stats || jsonb_build_object('stamina', 0.5) where world_id = w and uid = u;
  ${onItem('drink_tea', newest('herb_tea'))};
  insert into said values ('TEA', v_t || '|' || (select stats->>'stamina' from player where world_id = w and uid = u)
    || '|' || coalesce(${last('You drink the %')}, 'unsaid'));

  /* ---- A salve: refused with nothing dressed, rubbed into a dressing under cloth, and it never goes bad. ---- */
  update player set wounds = jsonb_build_array(${jsonSql(CUT)}), stats = stats || jsonb_build_object('hurtSettled', now()) where world_id = w and uid = u;
  v_t := ${itemRefused('apply_salve', newest('salve'))};
  update player set wounds = jsonb_build_array(${jsonSql({ ...CUT, dressing: 'thyme', bleeding: false })}), stats = stats || jsonb_build_object('hurtSettled', now()) where world_id = w and uid = u;
  v_t := v_t || '#' || ${itemRefused('apply_salve', newest('salve'))};
  update player set wounds = jsonb_build_array(${jsonSql({ ...CUT, dressing: '', bleeding: false })}), stats = stats || jsonb_build_object('hurtSettled', now()) where world_id = w and uid = u;
  v_t := v_t || '#' || ${itemRefused('apply_salve', newest('salve'))}
    || '#' || (select fester_chance(w0) from player, jsonb_array_elements(wounds) w0 where world_id = w and uid = u);
  ${onItem('apply_salve', newest('salve'))};
  v_t := v_t || '#' || coalesce((select w0->>'salved' from player, jsonb_array_elements(wounds) w0 where world_id = w and uid = u), 'none')
    || '#' || (select fester_chance(w0) from player, jsonb_array_elements(wounds) w0 where world_id = w and uid = u)
    || '#' || coalesce(${last('You rub the salve%')}, 'unsaid');
  -- Gone bad anyway (it was salved after it turned, say), scoured out: no salve and no quick hands left on it.
  update player set wounds = jsonb_build_array(${jsonSql({ ...CUT, infected: true, salved: true, mend: 1.5 })}), stats = stats || jsonb_build_object('hurtSettled', now()) where world_id = w and uid = u;
  perform give(w, u, 'lye_bucket', 1, 40);
  ${onItem('clean_wound', newest('lye_bucket'))};
  insert into said values ('SALVE', v_t || '#' || (select (w0 ? 'salved') || '/' || (w0 ? 'mend') || '/' || (w0->>'infected')
    from player, jsonb_array_elements(wounds) w0 where world_id = w and uid = u));
  update player set wounds = '[]'::jsonb where world_id = w and uid = u;

  /* ---- A tincture: its four trades, beside a dish's knack on one of them, and a second puts the clock back. ---- */
  select i.id into v_food from item_def i where boon_of((select seed from world where id = w), i.id) = '${TINCTURE_SKILLS[0]}' limit 1;
  update player set boons = '[]'::jsonb where world_id = w and uid = u;
  perform grant_boon(w, u, v_food, 50);
  ${onItem('take_tincture', newest('tincture'))};
  insert into said values ('TINCTURE', (select string_agg(b->>'skill' || '/' || coalesce(b->>'kind', 'dish') || '/' || (b->>'bonus')
      || '/' || round(((b->>'until')::double precision - world_time(w))::numeric), ',' order by b->>'skill', coalesce(b->>'kind', 'dish'))
    from player, jsonb_array_elements(boons) b where world_id = w and uid = u)
    || '|' || skill_mult(w, u, '${TINCTURE_SKILLS[0]}') || '|' || coalesce(${last('You take the tincture%')}, 'unsaid'));
  -- And a dish of the same trade now puts the clock back on the dish's, not the tincture's.
  update player set boons = (select jsonb_agg(case when b->>'kind' = 'tincture' then b || jsonb_build_object('until', world_time(w) + 10) else b end)
    from player, jsonb_array_elements(boons) b where world_id = w and uid = u) where world_id = w and uid = u;
  perform grant_boon(w, u, v_food, 50);
  insert into said values ('DISH', (select round(((b->>'until')::double precision - world_time(w))::numeric)::text
    from player, jsonb_array_elements(boons) b where world_id = w and uid = u and b->>'kind' = 'tincture' and b->>'skill' = '${TINCTURE_SKILLS[0]}'));
  update player set boons = '[]'::jsonb where world_id = w and uid = u;
  ${clearAll};

  /* ---- A hive on the settlement with a Vesp kept by it, ten minutes on: wax under the dice, honey over. ---- */
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'hive', 9, 10, 0, 0, 9.5, 10.5, ${HIVE_QL}, 'Pine', u) returning id into v_hive;
  v_c := creature_spawn(w, 'vesp', 8.5, 10.5, 'deed', now() - interval '3 hours', u);
  update creature set hunger = 1, from_x = 8.5, from_y = 10.5, to_x = 8.5, to_y = 10.5, leg_at = now(), leg_ends = now(),
         settled_at = now() where world_id = w and id = v_c;
  update placed set state = jsonb_build_object('comb', 0, 'hive_at', now() - make_interval(secs => ${HIVE_AGO})) where id = v_hive;
  ${dice(HIVE_WAX / 2)};
  perform hive_sweep(w);
  v_t := (select coalesce(string_agg(def || ':' || count, ',' order by def), 'empty') from item where world_id = w and holder = 'furniture' and placed = v_hive);
  delete from item where world_id = w and holder = 'furniture' and placed = v_hive;
  update placed set state = jsonb_build_object('comb', 0, 'hive_at', now() - make_interval(secs => ${HIVE_AGO})) where id = v_hive;
  ${dice(HIVE_WAX + (1 - HIVE_WAX) / 2)};
  perform hive_sweep(w);
  ${nodice};
  v_t := v_t || '|' || (select coalesce(string_agg(def || ':' || count, ',' order by def), 'empty') from item where world_id = w and holder = 'furniture' and placed = v_hive);
  -- And none without a swarm kept by it.
  delete from item where world_id = w and holder = 'furniture' and placed = v_hive;
  update creature set keeper = null, mode = 'wild' where world_id = w and id = v_c;
  update placed set state = jsonb_build_object('comb', 0, 'hive_at', now() - make_interval(secs => ${HIVE_AGO})) where id = v_hive;
  perform hive_sweep(w);
  insert into said values ('HIVE', v_t || '|' || (select count(*) from item where world_id = w and holder = 'furniture' and placed = v_hive)
    || '|' || hive_rate(${HIVE_QL}) || '|' || sweep_every());
  delete from creature where world_id = w and id = v_c;
  delete from placed where id = v_hive;

  /* ---- Gold coins in the grass: found when the dice fall under the odds, no more than a day's worth for one person. ---- */
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'coin';
  delete from coin_found where world_id = w and uid = u;
  ${dice(0.001)};
  delete from foraged where world_id = w; ${onTile('forage', 1, 1)};
  delete from foraged where world_id = w; ${onTile('forage', 1, 1)};
  delete from foraged where world_id = w; ${onTile('forage', 1, 1)};
  delete from foraged where world_id = w; ${onTile('forage', 1, 1)};
  delete from foraged where world_id = w; ${onTile('forage', 1, 1)};
  v_t := (select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = 'coin' and i.extra = 'Gold')::text;
  -- The next dawn of the woods: the count starts again.
  update coin_found set dawn = dawn - 1 where world_id = w and uid = u;
  delete from foraged where world_id = w; ${onTile('forage', 1, 1)};
  v_t := v_t || ':' || (select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = 'coin' and i.extra = 'Gold');
  -- And over the odds, none.
  ${dice(0.5)};
  delete from foraged where world_id = w; ${onTile('forage', 1, 1)};
  insert into said values ('GOLD', v_t || ':' || (select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = 'coin' and i.extra = 'Gold') || '|' || coalesce((select e.text from event e where e.world_id = w and e.uid = u
    and e.text like 'Something glints%' order by e.n desc limit 1), 'unsaid'));
  ${nodice};
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'coin';

  insert into said values ('NODES', (select count(*) from class_node where id ~ '^naturalist_')::text || ':'
    || (select count(*) from player_node where node ~ '^naturalist_[0-9]_[0-9]$'));
end $$;

select k || E'\\t' || coalesce(v, '') from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const [k, ...v] = l.split('\t');
  return [k, v.join('\t')];
}));
const say = (k: string): string => said.get(k) ?? 'unsaid';

check('the Naturalist stands on a settlement of theirs, where a hive fills', say('DEED') !== 'none', say('DEED'));

/* ---- a look over the ground ------------------------------------------------------------ */

const plainPasses = rollsAt(SKILL);
const keen = fx('Keen Eye', 'passes:forage');
const passes = say('PASSES').split('#');
check(`${P('Keen Eye').name}: at ${SKILL} a go looks ${plainPasses} times, and ${plainPasses + keen} with it, foraging and botanizing`,
  passes.length === 4 && passes[0].includes(`${plainPasses} times`) && passes[1].includes(`${plainPasses} times`)
    && passes[2].includes(`${plainPasses + keen} times`) && passes[3].includes(`${plainPasses + keen} times`), passes.join(' / '));
const [emptyBelow, emptyAbove, emptyPerk] = say('EMPTY').split(':').map(Number);
check(`${P('Sure Find').name}: under ${EMPTY_CHANCE} every look is empty by chance, over it none is, and with it none is`,
  emptyBelow === 0 && emptyAbove === plainPasses && emptyPerk === 2 * plainPasses, say('EMPTY'));
const [rareArgs, rareAbove] = say('RARE').split('#');
const [rareNone, rareWhat, ...rareSaid] = rareArgs.split(':');
check(`${P('Rare Find').name}: with the dice under ${fx('Rare Find', 'rare:forage')} a find comes up rare, and all the way for the steps after it; never without it`,
  rareNone === '0' && rareWhat === RARITIES[RARITIES.length - 1].name && rareSaid.join(':').includes(`${RARITIES[RARITIES.length - 1].name} `),
  rareArgs);
check('and over it, none', rareAbove === '0', rareAbove);

/* ---- a cut ----------------------------------------------------------------------------- */

const [grassPlain, grassPerk, reeds] = say('CUT').split('#');
check(`a cut of grass gives ${GRASS_PER_CUT} bundles, and says so`, grassPlain.startsWith(`${GRASS_PER_CUT}:`) && grassPlain.includes('two bundles'), grassPlain);
check(`${P('Hay Cutter').name}: ${fx('Hay Cutter', 'count:mixed_grass')} with it, and says so`,
  grassPerk.startsWith(`${fx('Hay Cutter', 'count:mixed_grass')}:`) && grassPerk.includes('three bundles'), grassPerk);
const [reedPlain, reedPerk, ...reedSaid] = reeds.split(':');
check(`${P('Reed Cutter').name}: with the dice against a third, ${REED_CUT} reeds without it and ${fx('Reed Cutter', 'count:reed')} with it`,
  Number(reedPlain) === REED_CUT && Number(reedPerk) === fx('Reed Cutter', 'count:reed')
    && reedSaid.join(':').includes(`${fx('Reed Cutter', 'count:reed')} reeds`), reeds);

/* ---- the pot --------------------------------------------------------------------------- */

const [lyePlain, lyePerk] = say('LYE').split('|').map((s) => Number(s.split(':')[0]));
check(`${P('Quick Lye').name}: making lye is started with ${fx('Quick Lye', 'time:make_lye')} of the time`,
  lyePlain > 0 && near(lyePerk / lyePlain, fx('Quick Lye', 'time:make_lye'), 1e-4), say('LYE'));
const [dyeMade, dyeNeed] = say('DYE').split('|');
const dyeRecipe = RECIPE_BY_ID.get(DYE)!;
check(`${P('Double Boil').name}: a boil leaves ${fx('Double Boil', 'litres:dye')} litres of dye in the bucket where it left ${DYE_BOIL_LITRES}`,
  dyeMade === `${DYE_BOIL_LITRES}:${fx('Double Boil', 'litres:dye')}`, dyeMade);
const thrifty = Math.ceil((dyeRecipe.inputs[0].count ?? 0) * fx('Thrifty Dyer', `need:${DYE}`));
const [needPlain, needPerk, dyeYes, ...dyeNo] = dyeNeed.split(':');
check(`${P('Thrifty Dyer').name}: a boil wants ${thrifty} of its dyestuff where it wanted ${dyeRecipe.inputs[0].count}, and ${thrifty} is enough with it and not without`,
  Number(needPlain) === dyeRecipe.inputs[0].count && Number(needPerk) === thrifty && dyeYes === 'ALLOWED' && dyeNo.join(':') !== 'ALLOWED', dyeNeed);
const [inkMade, coverMade] = say('MADE').split('|');
check(`${P('Ink Maker').name}: grinding ink makes ${fx('Ink Maker', 'count:ink')} where it made ${RECIPE_BY_ID.get('make_ink')?.count}`,
  inkMade === `${RECIPE_BY_ID.get('make_ink')?.count}:${fx('Ink Maker', 'count:ink')}`, inkMade);
check(`${P('Cover Maker').name}: ${fx('Cover Maker', 'count:cover')} covers where it made ${RECIPE_BY_ID.get('make_cover_thyme')?.count}`,
  coverMade === `${RECIPE_BY_ID.get('make_cover_thyme')?.count}:${fx('Cover Maker', 'count:cover')}`, coverMade);
check(`${P('Sure Boil').name}: every check failed, it fails with the dice under ${BOIL} and not over it; always without it`,
  say('BOIL') === `0:${RECIPE_BY_ID.get('make_ink')?.count}:0`, say('BOIL'));

/* ---- a dressing ------------------------------------------------------------------------ */

const [dressPlain, dressPerk] = say('DRESSTIME').split('|').map((s) => Number(s.split(':')[0]));
check(`${P('Quick Dressing').name}: dressing a wound is started with ${fx('Quick Dressing', 'time:bind_wound')} of the time`,
  dressPlain > 0 && near(dressPerk / dressPlain, fx('Quick Dressing', 'time:bind_wound'), 1e-4), say('DRESSTIME'));
check(`${P('Sure Hands').name}: every check failed at difficulty ${DRESS_CHECK}, it slips without it, holds with the dice over ${SLIP} and slips under it`,
  say('SLIP') === 'none::none', say('SLIP'));
const [mendOn, closeMend, closePlain, mendOff] = say('MEND').split(':');
check(`${P('Quick Mend').name}: a wound it dresses closes ${fx('Quick Mend', 'mend:bind_wound')} times as fast`,
  Number(mendOn) === fx('Quick Mend', 'mend:bind_wound') && near(Number(closeMend) / Number(closePlain), fx('Quick Mend', 'mend:bind_wound'), 1e-6),
  say('MEND'));
check('and a dressing by hands without it takes the quick hands off', mendOff === 'none', mendOff);
const [medicYes, medicDone, medicMore, medicFar] = say('MEDIC').split('#');
const [used, theirs, better, ...told] = medicDone.split(':');
check('somebody else\'s wounds are dressed by anybody, out of your pack, and they are told who did it',
  medicYes === 'ALLOWED' && used === '1' && theirs === '/false' && better === 'true' && told.join(':').includes('dresses the cut on your arm'),
  `${medicYes} / ${medicDone}`);
const [healPlain, healMedic] = medicMore.split('|').map(Number);
check(`${P('Field Medic').name}: a dressing on somebody else puts back ${fx('Field Medic', 'heal:others')} times as much`,
  healPlain > 0 && near(healMedic / healPlain, fx('Field Medic', 'heal:others'), 1e-9), medicMore);
check('and not from across the yard', medicFar === 'You need to be beside them.', medicFar);

/* ---- the remedies ---------------------------------------------------------------------- */

const [refusals, made] = say('REMEDY').split('|');
const r = refusals.split('#');
check('the three remedies are refused without their perks, in the browser\'s words',
  r[0] === RECIPE_PERK_SAYS.herb_tea && r[1] === RECIPE_PERK_SAYS.salve && r[2] === RECIPE_PERK_SAYS.tincture, r.slice(0, 3).join(' / '));
check(`${P('Herb Tea').name}, ${P('Salve').name}, ${P('Tincture').name}: and made with them, the tea's bucket back`,
  r[3] === 'ALLOWED' && r[4] === 'ALLOWED' && r[5] === 'ALLOWED'
    && made === `${RECIPE_BY_ID.get('brew_tea_thyme')?.count}:1:1:1`, `${r.slice(3).join(' / ')} | ${made}`);
const stamina = ITEM_DEFS.herb_tea.stamina ?? 0;
const [teaFull, teaAfter, teaSaid] = say('TEA').split('|');
check(`a cup of herb tea puts back ${percent(stamina)} of your stamina, and is refused when you are not tired`,
  teaFull === 'You are not tired.' && near(Number(teaAfter), 0.5 + stamina) && teaSaid === `You drink the herb tea. It puts back ${percent(stamina)} of your stamina.`,
  say('TEA'));
const salve = say('SALVE').split('#');
check('a salve is refused on an undressed wound and on one the right herb covers, in the browser\'s words',
  salve[0] === salveRefusal([{ ...CUT, dressing: null } as unknown as Wound]) && salve[1] === salveRefusal([{ ...CUT, dressing: 'thyme', bleeding: false } as unknown as Wound]),
  `${salve[0]} / ${salve[1]}`);
check('and rubbed in over cloth, the wound under it never goes bad',
  salve[2] === 'ALLOWED' && Number(salve[3]) > 0 && salve[4] === 'true' && Number(salve[5]) === 0 && salve[6].startsWith('You rub the salve into the cut'),
  salve.slice(2, 7).join(' / '));
check('and a wound scoured out has neither salve nor quick hands left on it', salve[7] === 'false/false/false', salve[7]);
const [boons, mult, tinctureSaid] = say('TINCTURE').split('|');
const secs = Math.round(TINCTURE_SECONDS);
const want = [...TINCTURE_SKILLS.map((s) => `${s}/tincture/${TINCTURE_BONUS}/${secs}`)];
check(`${P('Tincture').name}: taken, ${TINCTURE_NAMES} each go in ${percent(TINCTURE_BONUS)} faster for ${secs} seconds, beside a dish's knack on one of them`,
  TINCTURE_SKILLS.every((s) => boons.includes(`${s}/tincture/${TINCTURE_BONUS}/${secs}`)) && boons.includes(`${TINCTURE_SKILLS[0]}/dish/`), boons);
check('and both count', Number(mult) >= 1 + TINCTURE_BONUS + 0.5 - 1e-6, mult);
check('and it says so, in the browser\'s words',
  tinctureSaid.startsWith(`You take the tincture. ${TINCTURE_NAMES.charAt(0).toUpperCase()}${TINCTURE_NAMES.slice(1)} each go in ${percent(TINCTURE_BONUS)} faster for the next `),
  tinctureSaid);
check('and a dish of one of its trades puts back the clock on the dish\'s knack, not on the tincture\'s', Number(say('DISH')) <= 10, say('DISH'));
void want;

/* ---- the hive -------------------------------------------------------------------------- */

const [hiveWax, hiveHoney, hiveNone, rate, every] = say('HIVE').split('|');
const combs = Math.floor(hiveRate(HIVE_QL) * Math.min(HIVE_AGO, 2 * Number(every)));
check(`a hive of QL ${HIVE_QL} with one swarm kept by it draws ${combs} comb in ${HIVE_AGO} seconds, as the browser reckons it`,
  near(Number(rate), hiveRate(HIVE_QL)) && hiveWax === `wax:${combs}` && hiveHoney === `honey:${combs}`, say('HIVE'));
check('and none with no swarm kept by it', hiveNone === '0', hiveNone);
check('and the Naturalist\'s tree is gone', say('NODES') === '0:0', say('NODES'));

/* ---- the browser's half ---------------------------------------------------------------- */

const game = Game.create(4401);
game.setPerks({});
for (const s of ['foraging', 'botanizing', 'alchemy', 'first_aid', 'chirurgy']) game.skills.values.set(s, SKILL);
const px = game.player.tileX;
const py = game.player.tileY;
const tileAt = (x: number, y: number): Target => ({ kind: 'tile', x, y, cx: x + 0.5, cy: y + 0.5 });
const forage = ACTION_BY_ID.get('forage')!;
const found = (): number => game.inventory.items.reduce((n, it) => n + (['blueberry', 'raspberry', 'strawberry', 'lingonberry', 'acorn', 'nuts', 'potato', 'onion'].includes(it.id) || it.id.endsWith('_seed') ? it.count : 0), 0);
check('the browser\'s Keen Eye says the passes as the island counts them',
  forage.labelFor?.(tileAt(px, py), game) === `Forage (${plainPasses} passes)`
    && (game.setPerks(P('Keen Eye').fx), forage.labelFor?.(tileAt(px, py), game) === `Forage (${plainPasses + keen} passes)`),
  String(forage.labelFor?.(tileAt(px, py), game)));
game.setPerks({});
game.rand = () => EMPTY_BELOW;
const before = found();
forage.perform?.(tileAt(px + 1, py), game);
const plainFound = found() - before;
game.setPerks({ ...P('Sure Find').fx, ...P('Rare Find').fx });
game.rand = () => RARE_BELOW;
forage.perform?.(tileAt(px + 2, py), game);
const rare = game.inventory.items.filter((it) => (it.rare ?? 0) > 0);
check('and its Sure Find and Rare Find find what the island\'s do under the same dice',
  plainFound === 0 && rare.length > 0 && rare.every((it) => it.rare === RARITIES.length - 1), `${plainFound} / ${rare.map((it) => `${it.id}:${it.rare}`).join(',')}`);
game.setPerks(P('Hay Cutter').fx);
const grass0 = game.inventory.count('mixed_grass');
ACTION_BY_ID.get('cut_grass')!.perform?.(tileAt(px + 3, py), game);
check('and its Hay Cutter cuts as many', game.inventory.count('mixed_grass') - grass0 === fx('Hay Cutter', 'count:mixed_grass'),
  String(game.inventory.count('mixed_grass') - grass0));
game.world.setTile(px + 4, py, TileType.Reed);
game.inventory.add('carving_knife', { ql: 40 });
game.setPerks(P('Reed Cutter').fx);
game.rand = () => 0.99;
const reed0 = game.inventory.count('reed');
ACTION_BY_ID.get('cut_reeds')!.perform?.(tileAt(px + 4, py), game);
check('and its Reed Cutter as many reeds', game.inventory.count('reed') - reed0 === fx('Reed Cutter', 'count:reed'), String(game.inventory.count('reed') - reed0));
// Wounds: the pace and the salve, and a dressing's stamp.
const cut = { ...CUT, dressing: '' } as unknown as Wound;
check('the browser\'s Quick Mend closes a wound as the island\'s does',
  near(woundClose({ ...cut, mend: fx('Quick Mend', 'mend:bind_wound') }, SKILL) / woundClose(cut, SKILL), fx('Quick Mend', 'mend:bind_wound')));
check('and a salved wound never goes bad there either', festerChance(cut) > 0 && festerChance({ ...cut, salved: true }) === 0);
game.player.wounds = [{ ...CUT } as unknown as Wound];
game.inventory.add('bandage', { ql: 40, count: 3 });
game.setPerks(P('Quick Mend').fx);
game.rand = () => 0.01;
const bandage = game.inventory.find('bandage')!;
ACTION_BY_ID.get('bind_wound')!.perform?.({ kind: 'item', uid: bandage.uid }, game);
check('and a dressing stamps its quick hands on the wound', game.player.wounds[0]?.mend === fx('Quick Mend', 'mend:bind_wound'), JSON.stringify(game.player.wounds[0]));
game.setPerks({});
check('the browser offers to dress somebody else without any perk', ACTION_BY_ID.get('bind_wound')!.applies({ kind: 'person', uid: 'x' }, game));
// The remedies in the browser, in the island's words.
game.player.stats.stamina = 0.5;
const tea = game.inventory.add('herb_tea', { ql: 40 });
ACTION_BY_ID.get('drink_tea')!.perform?.({ kind: 'item', uid: tea.uid }, game);
const [goldNums, goldSaid] = say('GOLD').split('|');
const [goldDay, goldNext, goldOver] = goldNums.split(':').map(Number);
check(`foraging finds a gold coin one go in ${COIN_FIND_ONE_IN}, no more than ${COIN_FINDS_A_DAY} a day, and the count starts again at the next dawn`,
  goldDay === COIN_FINDS_A_DAY && goldNext === COIN_FINDS_A_DAY + 1 && goldOver === COIN_FINDS_A_DAY + 1 && goldSaid.startsWith('Something glints'), say('GOLD'));
check('its herb tea puts back as much', near(game.player.stats.stamina, 0.5 + stamina));
game.player.boons = [];
const drop = game.inventory.add('tincture', { ql: 40 });
ACTION_BY_ID.get('take_tincture')!.perform?.({ kind: 'item', uid: drop.uid }, game);
check('its tincture lifts the same four by as much for as long',
  TINCTURE_SKILLS.every((s) => game.player.boons.some((b) => b.skill === s && b.kind === 'tincture' && b.bonus === TINCTURE_BONUS
    && near(b.until - game.time, TINCTURE_SECONDS))),
  JSON.stringify(game.player.boons));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Naturalist's perks — ${ok.length} of ${ok.length}`);
