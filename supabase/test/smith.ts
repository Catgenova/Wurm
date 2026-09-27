/**
 * The Smith's eighteen perks, each measured where its rule is.
 *
 * `perks.ts` holds the two sides to each other for every trade on perks --
 * the rows, the tiers, the fold, the choosing -- and this asks the one thing
 * that is the Smith's own: that each perk does what its note says, on the
 * island, with the dice taken out wherever they can be. A skill check is made
 * to pass or to fail outright, the quality a pair of hands turns out is held
 * still, and a chance is put at one inside the transaction, so that a go must
 * show the rule.
 *
 *   * the smelter: Glassblower's glass, Sure Alloy's mix, Reclaimer's melt
 *     (and a half taken up, as the browser takes it), Hard Sand's mould and
 *     Clean Pour's pour;
 *   * the anvil: Sure Hammer, Second Heat, Nail Maker, Toolsmith, and the
 *     marks it beats into what it makes -- Keen Edge's and Balanced's blade,
 *     carried into the sword whoever fits it, Mail Maker's hauberk, Plate
 *     Maker's breastplate -- each read where its rule is;
 *   * Ingots: poured, weighed, and counted as their lumps by a mould, a mix, a
 *     strike and a pass of Improve, with the rest coming back as lumps;
 *   * Forge Reach's stores, Metal Polisher's pass, Long Shift's queue, and
 *     Temper Bath's quench, once, at water;
 *   * and the browser reads the same numbers where it asks or offers them.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game, queueCapAt } from '../../src/game/game';
import { ARMOUR_BY_ID, HIT_CAP, hitChance, pieceSoak, SOAK_CAP, WEAPON_BY_ID } from '../../src/game/gear';
import { improveStep, improveStepAt } from '../../src/game/improve';
import { ITEM_DEFS, makersMark, markSays, partsMark, rarityStep, temperOf, type Item } from '../../src/game/items';
import { MELT_KEEP, MELT_SHARE, meltLumps, meltQl } from '../../src/game/melt';
import { FORGE_WORK, INGOT_LUMPS, INGOT_WEIGHT, ingotOf, lumpsIn, METAL_BY_ID, MOULD_BY_ID, MOULD_DENT, mouldUsesLeft } from '../../src/game/metal';
import { perksOf, type PerkDef } from '../../src/game/perks';
import { CRAFT_REACH, RECIPE_BY_ID, RECIPES, recipeStatus } from '../../src/game/recipes';

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

const SMITH = perksOf('smith');
const P = (name: string): PerkDef => {
  const p = SMITH.find((x) => x.name === name);
  if (!p) throw new Error(`the Smith has no perk called ${name}`);
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
/** The quality a pair of hands turns out, held still. */
const HANDS = 40;
/** The skill the anvil beats a piece out with, put back where it was: a go that lands raises it. */
const skillAt = (piece: string, level = 30): string =>
  `insert into skill (world_id, uid, id, value) select w, u, md.skill, ${level} from mould_def md where md.makes = '${piece}'
     on conflict (world_id, uid, id) do update set value = ${level}`;
const craft = (recipe: string, uid = 'null'): string =>
  `perform perform_craft(w, u, '${recipe}', jsonb_build_object('kind', 'item', 'uid', ${uid}))`;
const atSmelter = (extra: string): string => `jsonb_build_object('kind', 'smelter', 'id', v_smelter${extra})`;
const atAnvil = (uid: string): string => `jsonb_build_object('kind', 'anvil', 'id', v_anvil, 'itemUid', ${uid})`;
const refused = (action: string, target: string): string => `coalesce(act_refusal(w, u, '${action}', ${target}), 'ALLOWED')`;
/** A casting of a piece, in the pack. */
const casting = (piece: string, n = 1, ql = 50, metal = 'Iron'): string =>
  `insert into item (world_id, holder, holder_uid, def, ql, count, extra, piece) values (w, 'player', u, 'casting', ${ql}, ${n}, '${metal}', '${piece}')
   returning id into v_cast`;
const jobs = `(select jsonb_array_length(state->'jobs') from placed where id = v_smelter)`;
const emptyFurnace = `update placed set state = jsonb_build_object('jobs', '[]'::jsonb, 'output', '[]'::jsonb) where id = v_smelter`;
const GLASS = RECIPE_BY_ID.get('make_glass')!;
const BRONZE = RECIPE_BY_ID.get('make_bronze')!;
const SHOVEL_MOULD = RECIPES.find((r) => r.result === 'shovel_head_mould')!;

const out = psql(`
begin;
create temp table said (k text, v text);

create function pg_temp.hold(w uuid, u uuid, ids text[]) returns jsonb language plpgsql as $f$
begin
  delete from player_node where world_id = w and uid = u;
  insert into player_node (world_id, uid, node) select w, u, x from unnest(ids) x;
  return class_fold(w, u);
end $f$;
/* A go of a job through the clock, as the heartbeat has it: a go's perks are its context there and nowhere else. */
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
declare w uuid; u uuid; tx int; ty int; v_smelter bigint; v_anvil bigint; v_chest bigint; v_barrel bigint;
        v_cast bigint; v_it bigint; v_mould bigint; v_sword bigint; v_t text; v_u text; v_a double precision;
        v_c double precision; v_row item; v_plain item; v_w weapon_def;
begin
  -- The suite's own island and its first body, a Smith now, on flat dirt with no water near.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  for tx in 0..15 loop for ty in 0..15 loop
    perform land_set_height(w, tx, ty, 40); perform land_set_dirt(w, tx, ty, 20);
    perform land_set_tile(w, tx, ty, tile_id('Dirt')); perform land_set_data(w, tx, ty, 0);
  end loop; end loop;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  delete from player_node where world_id = w and uid = u;
  delete from placed where world_id = w and x between 6 and 15 and y between 6 and 13;
  update player set x = 9.5, y = 9.5, act = null, act_target = null, act_started = null, act_ends = null,
         act_left = null, act_goes = null, act_queue = '[]', craft_class = 'smith', combat_class = null,
         class_mul = null, level_h = null, rested = 0, boons = '[]'::jsonb, body_at = now(), swim_at = now(),
         equipped = '{}'::jsonb, craft_from_stores = true, craft_spare_rare = false,
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
   where world_id = w and uid = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  insert into skill (world_id, uid, id, value)
    select w, u, s, 60 from unnest(array['blacksmithing', 'weaponsmithing', 'chainsmithing', 'platesmithing', 'smelting',
                                         'carpentry', 'swords']) s
    on conflict (world_id, uid, id) do update set value = excluded.value;
  insert into skill (world_id, uid, id, value)
    select w, u, s, 10 from unnest(array['fighting', 'body_control']) s
    on conflict (world_id, uid, id) do update set value = excluded.value;
  insert into placed (world_id, kind, x, y, sx, sy, cx, cy, ql, fuel, lit, state, made_by)
    values (w, 'smelter', 10, 9, 0, 0, 10.375, 9.25, 50, 600, true, '{"jobs": [], "output": []}'::jsonb, u)
    returning id into v_smelter;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'anvil', 'iron', 9, 10, 0, 0, 9.25, 10.25, 50, u) returning id into v_anvil;
  ${checks(true)};

  /* ---- Glassblower: a sheet of glass is three. ---- */
  perform give(w, u, 'sand', ${(GLASS.inputs[0].count ?? 1) * 2}, 30);
  perform pg_temp.hold(w, u, '{}');
  ${craft('make_glass', newest('sand'))};
  v_t := ${count('glass')}::text;
  ${clear('glass')};
  ${hold('Glassblower')};
  ${craft('make_glass', newest('sand'))};
  insert into said values ('GLASS', v_t || '|' || ${count('glass')});
  ${clear('glass', 'sand')};

  /* ---- Sure Alloy: a mix that fails every time without it, at a failure's share of nothing with it. ---- */
  ${checks(false)};
  ${patch('Sure Alloy', { [`fail:${BRONZE.id}`]: 0 })};
  perform give(w, u, 'copper_lump', 6, 30); perform give(w, u, 'tin_lump', 2, 30);
  perform pg_temp.hold(w, u, '{}');
  ${craft('make_bronze', newest('copper_lump'))};
  v_t := ${count('bronze_lump')}::text;
  ${hold('Sure Alloy')};
  ${craft('make_bronze', newest('copper_lump'))};
  insert into said values ('ALLOY', v_t || '|' || ${count('bronze_lump')});
  ${clear('bronze_lump', 'copper_lump', 'tin_lump')};
  ${checks(true)};

  /* ---- Reclaimer: a hauberk melted down, without and with. ---- */
  perform pg_temp.hold(w, u, '{}');
  v_it := give(w, u, 'chain_hauberk', 1, 50, 'Iron');
  perform act_perform(w, u, 'melt_down', ${atSmelter(", 'itemUid', v_it, 'count', 1")});
  v_t := ${jobs} || ':' || (select state->'jobs'->0->>'ql' from placed where id = v_smelter);
  ${emptyFurnace};
  ${hold('Reclaimer')};
  v_it := give(w, u, 'chain_hauberk', 1, 50, 'Iron');
  perform act_perform(w, u, 'melt_down', ${atSmelter(", 'itemUid', v_it, 'count', 1")});
  insert into said values ('MELT', v_t || '|' || ${jobs} || ':' || (select state->'jobs'->0->>'ql' from placed where id = v_smelter));
  ${emptyFurnace};

  /* ---- Hard Sand: a mould made with it lasts; one made without does not. ---- */
  perform give(w, u, 'sand', ${(SHOVEL_MOULD.inputs[0].count ?? 1) * 2}, 30);
  perform pg_temp.hold(w, u, '{}');
  ${craft(SHOVEL_MOULD.id, newest('sand'))};
  ${hold('Hard Sand')};
  ${craft(SHOVEL_MOULD.id, newest('sand'))};
  insert into said values ('MOULDS', (select string_agg(coalesce(mark::text, '-'), ',' order by id) from item
    where world_id = w and holder = 'player' and holder_uid = u and def = 'shovel_head_mould'));
  update item set ql = 50, dmg = 0 where world_id = w and holder = 'player' and holder_uid = u and def = 'shovel_head_mould';
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'copper_lump', 2, 40);
  for v_mould in select id from item where world_id = w and holder = 'player' and holder_uid = u
                   and def = 'shovel_head_mould' order by id loop
    perform act_perform(w, u, 'pour_mould', ${atSmelter(", 'mouldUid', v_mould, 'itemUid', " + newest('copper_lump'))});
  end loop;
  insert into said values ('WEAR', (select string_agg(dmg || ':' || mould_uses_left(ql, dmg, mark_of(mark, 'last')), ',' order by id)
    from item where world_id = w and holder = 'player' and holder_uid = u and def = 'shovel_head_mould')
    || '|' || coalesce(${last('You pour a lump of copper into the shovel head mould.%')}, 'unsaid'));
  ${emptyFurnace};

  /* ---- Clean Pour: a worn mould pours as a new one. ---- */
  update item set ql = 60, dmg = 40, mark = null where world_id = w and holder = 'player' and holder_uid = u and def = 'shovel_head_mould';
  perform give(w, u, 'copper_lump', 2, 40);
  v_mould := ${newest('shovel_head_mould')};
  perform act_perform(w, u, 'pour_mould', ${atSmelter(", 'mouldUid', v_mould, 'itemUid', " + newest('copper_lump'))});
  v_t := (select state->'jobs'->0->>'ql' from placed where id = v_smelter);
  ${emptyFurnace};
  update item set ql = 60, dmg = 40 where id = v_mould;
  ${hold('Clean Pour')};
  perform act_perform(w, u, 'pour_mould', ${atSmelter(", 'mouldUid', v_mould, 'itemUid', " + newest('copper_lump'))});
  insert into said values ('POUR', v_t || '|' || (select state->'jobs'->0->>'ql' from placed where id = v_smelter));
  ${emptyFurnace};
  ${clear('shovel_head_mould', 'copper_lump')};

  /* ---- Sure Hammer: Smith and Strike coins, failing every time without it and never with it. ---- */
  ${checks(false)};
  ${patch('Sure Hammer', { 'fail:smith': 0, 'fail:strike_coins': 0 })};
  perform pg_temp.hold(w, u, '{}');
  ${casting('rake_head', 2)};
  perform act_perform(w, u, 'smith', ${atAnvil('v_cast')});
  v_t := ${count('rake_head')} || ':' || ${count('casting')};
  perform give(w, u, 'coin_die', 1, 50); perform give(w, u, 'silver_lump', 2, 50);
  perform act_perform(w, u, 'strike_coins', ${atAnvil(newest('silver_lump'))});
  v_t := v_t || ':' || ${count('coin')};
  ${hold('Sure Hammer')};
  perform act_perform(w, u, 'smith', ${atAnvil('v_cast')});
  perform act_perform(w, u, 'strike_coins', ${atAnvil(newest('silver_lump'))});
  insert into said values ('HAMMER', v_t || '|' || ${count('rake_head')} || ':' || ${count('coin')});
  ${clear('rake_head', 'casting', 'coin', 'silver_lump')};

  /* ---- Second Heat: a failed go keeps its casting. ---- */
  ${hold('Second Heat')};
  ${casting('rake_head', 1)};
  perform act_perform(w, u, 'smith', ${atAnvil('v_cast')});
  insert into said values ('HEAT', ${count('casting')} || '|' || coalesce(${last('The rake head comes out misshapen%')}, 'unsaid'));
  ${clear('casting')};
  ${checks(true)};

  /* ---- Nail Maker: a filling of nails. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${casting('nail', 2)};
  perform act_perform(w, u, 'smith', ${atAnvil('v_cast')});
  v_t := ${count('nail')}::text;
  ${clear('nail')};
  ${hold('Nail Maker')};
  perform act_perform(w, u, 'smith', ${atAnvil('v_cast')});
  insert into said values ('NAILS', v_t || '|' || ${count('nail')} || '|' || coalesce(${last('You beat out % iron nails%')}, 'unsaid'));
  ${clear('nail', 'casting')};

  /* ---- Toolsmith: a rake head, with the hands held still -- and the skill, which the first go raises. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${casting('rake_head', 2)};
  ${skillAt('rake_head')};
  perform act_perform(w, u, 'smith', ${atAnvil('v_cast')});
  select ql into v_a from item where id = ${newest('rake_head')};
  ${clear('rake_head')};
  ${hold('Toolsmith')};
  ${skillAt('rake_head')};
  perform act_perform(w, u, 'smith', ${atAnvil('v_cast')});
  select ql into v_c from item where id = ${newest('rake_head')};
  insert into said values ('TOOLSMITH', v_a || '|' || v_c);
  ${clear('rake_head', 'casting')};

  /* ---- Keen Edge and Balanced: a blade beaten out marked, fitted by somebody without them, into a marked sword. ---- */
  ${hold('Keen Edge', 'Balanced')};
  ${casting('sword_blade', 1)};
  perform act_perform(w, u, 'smith', ${atAnvil('v_cast')});
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'sword_blade', 1, 50, 'Iron');
  insert into said values ('BLADES', (select string_agg(count || ':' || coalesce(mark::text, '-'), ';' order by coalesce(mark::text, '-'))
    from item where world_id = w and holder = 'player' and holder_uid = u and def = 'sword_blade'));
  perform give(w, u, 'shaft', 2, 40); perform give(w, u, 'nail', 4, 40);
  v_it := (select id from item where world_id = w and holder = 'player' and holder_uid = u and def = 'sword_blade' and mark is not null);
  ${craft('fit_sword_blade', 'v_it')};
  select * into v_row from item where id = ${newest('sword')};
  insert into said values ('SWORD', coalesce(v_row.mark::text, '-'));
  select * into v_w from weapon_def where id = 'sword';
  v_plain := v_row; v_plain.mark := null;
  insert into said values ('SWING', weapon_damage(w, u, v_w, v_row) || '|' || weapon_damage(w, u, v_w, v_plain)
    || '|' || hit_chance(w, u, 'swords', mark_of(v_row.mark, 'aim')) || '|' || hit_chance(w, u, 'swords'));

  /* ---- Temper Bath: a sword finished with it quenches once, at water. ---- */
  ${hold('Temper Bath')};
  v_it := (select id from item where world_id = w and holder = 'player' and holder_uid = u and def = 'sword_blade');
  ${craft('fit_sword_blade', 'v_it')};
  v_sword := ${newest('sword')};
  insert into said values ('TEMPERED', (select coalesce(mark::text, '-') from item where id = v_sword)
    || '|' || ${refused('quench_item', "jsonb_build_object('kind', 'item', 'uid', v_sword)")});
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, liquid, litres, material, made_by)
    values (w, 'furniture', 'barrel', 8, 9, 0, 0, 8.25, 9.25, 40, 'water', 20, 'Oak', u) returning id into v_barrel;
  select ql into v_a from item where id = v_sword;
  perform pg_temp.hold(w, u, '{}');
  v_t := ${refused('quench_item', "jsonb_build_object('kind', 'item', 'uid', v_sword)")};
  ${hold('Temper Bath')};
  v_u := ${refused('quench_item', "jsonb_build_object('kind', 'item', 'uid', v_sword)")};
  perform act_perform(w, u, 'quench_item', jsonb_build_object('kind', 'item', 'uid', v_sword));
  insert into said values ('QUENCH', v_t || '|' || v_u || '|' || v_a || '|' || (select ql from item where id = v_sword)
    || '|' || (select coalesce(mark::text, '-') from item where id = v_sword)
    || '|' || ${refused('quench_item', "jsonb_build_object('kind', 'item', 'uid', v_sword)")});
  delete from placed where id = v_barrel;
  ${clear('sword', 'sword_blade', 'shaft', 'nail', 'casting')};

  /* ---- Mail Maker and Plate Maker: a hauberk and a breastplate beaten out marked. ---- */
  ${hold('Mail Maker')};
  ${casting('chain_hauberk', 1)};
  perform act_perform(w, u, 'smith', ${atAnvil('v_cast')});
  select * into v_row from item where id = ${newest('chain_hauberk')};
  v_plain := v_row; v_plain.mark := null;
  insert into said values ('MAIL', coalesce(v_row.mark::text, '-') || '|' || piece_soak(v_row, 20) || '|' || piece_soak(v_plain, 20));
  ${hold('Plate Maker')};
  ${casting('plate_breastplate', 1)};
  perform act_perform(w, u, 'smith', ${atAnvil('v_cast')});
  select * into v_row from item where id = ${newest('plate_breastplate')};
  v_plain := v_row; v_plain.mark := null;
  insert into said values ('PLATE', coalesce(v_row.mark::text, '-') || '|' || piece_soak(v_row, 20) || '|' || piece_soak(v_plain, 20)
    || '|' || v_row.ql || '|' || coalesce(v_row.rare, '-'));
  ${clear('chain_hauberk', 'plate_breastplate', 'casting')};

  /* ---- Ingots: poured, weighed, and counted as their lumps. ---- */
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'iron_lump', 12, 45);
  v_t := ${refused('pour_ingot', atSmelter(", 'itemUid', " + newest('iron_lump')))};
  ${hold('Ingots')};
  v_u := ${refused('pour_ingot', atSmelter(", 'itemUid', " + newest('iron_lump')))};
  perform act_perform(w, u, 'pour_ingot', ${atSmelter(", 'itemUid', " + newest('iron_lump'))});
  insert into said values ('INGOT', v_t || '|' || v_u || '|' || ${count('iron_ingot')} || ':' || ${count('iron_lump')}
    || ':' || (select ql from item where id = ${newest('iron_ingot')})
    || ':' || (select unit_weight(i) from item i where i.id = ${newest('iron_ingot')})
    || ':' || (select unit_weight(i) from item i where i.id = ${newest('iron_lump')}));
  ${clear('iron_lump')};
  -- A mould poured from the bar: one bar broken, the rest back as lumps.
  v_mould := give(w, u, 'shovel_head_mould', 1, 50);
  v_t := ${refused('pour_mould', atSmelter(", 'mouldUid', v_mould, 'itemUid', " + newest('iron_ingot')))};
  perform act_perform(w, u, 'pour_mould', ${atSmelter(", 'mouldUid', v_mould, 'itemUid', " + newest('iron_ingot'))});
  insert into said values ('BARPOUR', v_t || '|' || ${count('iron_ingot')} || ':' || ${count('iron_lump')} || ':' || ${jobs});
  ${emptyFurnace};
  ${clear('iron_lump', 'iron_ingot', 'shovel_head_mould')};
  -- A mix from a copper bar and a tin lump.
  perform give(w, u, 'copper_ingot', 1, 40); perform give(w, u, 'tin_lump', 1, 40);
  v_t := coalesce(craft_refusal(w, u, 'make_bronze', null), 'ALLOWED');
  ${craft('make_bronze', newest('tin_lump'))};
  insert into said values ('BARMIX', v_t || '|' || ${count('bronze_lump')} || ':' || ${count('copper_lump')} || ':' || ${count('copper_ingot')});
  ${clear('bronze_lump', 'copper_lump', 'copper_ingot', 'tin_lump')};
  -- Coins from a silver bar.
  perform give(w, u, 'coin_die', 1, 50); perform give(w, u, 'silver_ingot', 1, 50);
  v_t := ${refused('strike_coins', atAnvil(newest('silver_ingot')))};
  perform act_perform(w, u, 'strike_coins', ${atAnvil(newest('silver_ingot'))});
  insert into said values ('BARCOIN', v_t || '|' || ${count('coin')} || ':' || ${count('silver_lump')} || ':' || ${count('silver_ingot')});
  ${clear('coin', 'silver_lump', 'silver_ingot', 'coin_die')};

  /* ---- Metal Polisher: a pass of Improve on an iron hatchet, from an iron bar. ---- */
  perform give(w, u, 'file', 1, 50); perform give(w, u, 'whetstone', 1, 50);
  update skill set value = 50 where world_id = w and uid = u and id = 'blacksmithing';
  v_it := give(w, u, 'hatchet', 1, 40, 'Iron');
  perform give(w, u, 'iron_lump', 2, 30);
  perform pg_temp.hold(w, u, '{}');
  perform act_perform(w, u, 'improve_item', jsonb_build_object('kind', 'item', 'uid', v_it));
  -- A pass is reckoned at the skill after what it taught.
  select ql into v_a from item where id = v_it;
  v_t := (select value from skill where world_id = w and uid = u and id = 'blacksmithing')::text;
  update item set ql = 40 where id = v_it;
  update skill set value = 50 where world_id = w and uid = u and id = 'blacksmithing';
  ${clear('iron_lump')};
  perform give(w, u, 'iron_ingot', 1, 30);
  ${hold('Metal Polisher')};
  perform act_perform(w, u, 'improve_item', jsonb_build_object('kind', 'item', 'uid', v_it));
  insert into said values ('POLISH', v_a || '|' || (select ql from item where id = v_it) || '|' || ${count('iron_lump')} || ':' || ${count('iron_ingot')}
    || '|' || v_t || '|' || (select value from skill where world_id = w and uid = u and id = 'blacksmithing'));
  ${clear('hatchet', 'iron_lump', 'iron_ingot', 'file', 'whetstone')};
  update skill set value = 60 where world_id = w and uid = u and id = 'blacksmithing';

  /* ---- Forge Reach: lumps in a chest five tiles off, for a mould; three for anything else. ---- */
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'chest', 14, 9, 0, 0, 14.25, 9.25, 40, 'Pine', u) returning id into v_chest;
  insert into item (world_id, holder, placed, def, ql, count) values (w, 'furniture', v_chest, 'iron_lump', 45, 3)
    returning id into v_it;
  v_mould := give(w, u, 'shovel_head_mould', 1, 50);
  perform pg_temp.hold(w, u, '{}');
  v_t := ${refused('pour_mould', atSmelter(", 'mouldUid', v_mould, 'itemUid', v_it"))} || ':' || craft_count(w, u, 'iron_lump');
  ${hold('Forge Reach')};
  v_u := ${refused('pour_mould', atSmelter(", 'mouldUid', v_mould, 'itemUid', v_it"))} || ':' || craft_count(w, u, 'iron_lump');
  perform pg_temp.go(w, u, 'pour_mould', ${atSmelter(", 'mouldUid', v_mould, 'itemUid', v_it")});
  insert into said values ('REACH', v_t || '|' || v_u || '|' || ${jobs} || ':' || (select count from item where id = v_it)
    || '|' || craft_reach());
  ${emptyFurnace};
  delete from placed where id = v_chest;
  ${clear('shovel_head_mould')};

  /* ---- Long Shift: two more jobs held in the head. ---- */
  perform pg_temp.hold(w, u, '{}');
  v_t := queue_capacity(w, u)::text;
  ${hold('Long Shift')};
  insert into said values ('SHIFT', v_t || '|' || queue_capacity(w, u));

  /* ---- The island's forge work, and its rounding. ---- */
  insert into said select 'FORGE', string_agg(a.id, ',' order by a.id) from action_def a where forge_work(a.id);
  insert into said select 'FORGE_RECIPES', string_agg(r.id, ',' order by r.id) from recipe r where forge_work(r.id);
  insert into said select 'USES', string_agg(mould_uses_left(ql::double precision, dmg::double precision, last::double precision)::text, ',' order by ql, dmg, last)
    from generate_series(0, 100, 10) ql, generate_series(0, 90, 15) dmg, unnest(array[1, 2, 3]) last;
  insert into said select 'KG', string_agg(id || ':' || weight::text::float8, ',' order by id) from item_def where id like '%\\_ingot';
end $$;

select k || E'\\t' || coalesce(v, '') from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const [k, ...v] = l.split('\t');
  return [k, v.join('\t')];
}));
const say = (k: string): string => said.get(k) ?? 'unsaid';

/* ---- the smelter --------------------------------------------------------------------- */

const [glassA, glassB] = say('GLASS').split('|').map(Number);
check(`${P('Glassblower').name}: a go of ${GLASS.label} makes ${P('Glassblower').fx['count:glass']} glass with it, ${GLASS.count} without`,
  glassA === GLASS.count && glassB === P('Glassblower').fx['count:glass'], say('GLASS'));
const [alloyA, alloyB] = say('ALLOY').split('|').map(Number);
check(`${P('Sure Alloy').name}: a mix that fails without it comes off with it (its failure put at none)`,
  alloyA === 0 && alloyB === BRONZE.count, say('ALLOY'));

const hauberk = { uid: 0, id: 'chain_hauberk', ql: 50, dmg: 0, count: 1, extra: 'Iron' } as Item;
const [meltA, meltB] = say('MELT').split('|').map((s) => s.split(':').map(Number));
check(`${P('Reclaimer').name}: a hauberk melts to ${meltLumps(hauberk, 1)} lumps at ${meltQl(hauberk)} without it, as the browser says (a half taken up)`,
  meltA[0] === meltLumps(hauberk, 1) && near(meltA[1], meltQl(hauberk)), say('MELT'));
check(`and to ${meltLumps(hauberk, 1, P('Reclaimer').fx['melt:share'])} at ${meltQl(hauberk, P('Reclaimer').fx['melt:keep'])} with it`,
  meltB[0] === meltLumps(hauberk, 1, P('Reclaimer').fx['melt:share']) && near(meltB[1], meltQl(hauberk, P('Reclaimer').fx['melt:keep'])),
  say('MELT'));

const moulds = say('MOULDS').split(',');
const lastBy = P('Hard Sand').fx['last:shovel_head_mould'];
check(`${P('Hard Sand').name}: a mould made with it is marked to last ${lastBy} times as long, one made without is not`,
  moulds.length === 2 && moulds[0] === '-' && JSON.parse(moulds[1]).last === lastBy, say('MOULDS'));
const [wearList, pourSaid] = say('WEAR').split('|');
const [plainWear, hardWear] = wearList.split(',').map((s) => s.split(':').map(Number));
check('and it takes that much less wear a filling, and has that many more fillings left',
  near(hardWear[0] * lastBy, plainWear[0], 1e-4) && hardWear[1] === mouldUsesLeft(50, hardWear[0], lastBy)
    && plainWear[1] === mouldUsesLeft(50, plainWear[0]), say('WEAR'));
check('and the pour says what is left of it', pourSaid.includes(`has ${hardWear[1]} fillings left`), pourSaid);

const [pourA, pourB] = say('POUR').split('|').map(Number);
check(`${P('Clean Pour').name}: a QL 60 mould at 40 damage pours as ${60 - 40 * MOULD_DENT} without it and 60 with it`,
  near(pourA, (40 + (60 - 40 * MOULD_DENT) + HANDS) / 3) && near(pourB, (40 + 60 + HANDS) / 3), say('POUR'));

/* ---- the anvil ---------------------------------------------------------------------------- */

const [hamA, hamB] = say('HAMMER').split('|').map((s) => s.split(':').map(Number));
check(`${P('Sure Hammer').name}: Smith and Strike coins fail every time without it, and come off with it (its failure put at none)`,
  hamA[0] === 0 && hamA[1] === 1 && hamA[2] === 0 && hamB[0] === 1 && hamB[1] > 0, say('HAMMER'));
const [heatLeft, heatSaid] = say('HEAT').split('|');
check(`${P('Second Heat').name}: a failed go keeps its casting, and says so`,
  Number(heatLeft) === 1 && heatSaid.includes('the casting is kept'), say('HEAT'));
const nailMould = MOULD_BY_ID.get('nail_mould')!;
const [nailsA, nailsB, nailsSaid] = say('NAILS').split('|');
check(`${P('Nail Maker').name}: a filling of nails is ${P('Nail Maker').fx['count:nail']} with it, ${nailMould.per} without, and the go says so`,
  Number(nailsA) === nailMould.per && Number(nailsB) === P('Nail Maker').fx['count:nail']
    && nailsSaid.startsWith(`You beat out ${P('Nail Maker').fx['count:nail']} iron nails`), say('NAILS'));
const [toolA, toolB] = say('TOOLSMITH').split('|').map(Number);
check(`${P('Toolsmith').name}: a rake head comes out ${P('Toolsmith').fx['ql:rake_head']} times as good with it`,
  near(toolB / toolA, P('Toolsmith').fx['ql:rake_head'], 1e-4), say('TOOLSMITH'));

const blades = say('BLADES').split(';');
check(`${P('Keen Edge').name} and ${P('Balanced').name}: the blade beaten out with them is marked, and piles apart from a plain one`,
  blades.length === 2 && blades[0] === '1:-' && JSON.parse(blades[1].slice(2)).damage === P('Keen Edge').fx['damage:sword_blade']
    && JSON.parse(blades[1].slice(2)).aim === P('Balanced').fx['aim:sword_blade'], say('BLADES'));
const swordMark = say('SWORD') === '-' ? {} : JSON.parse(say('SWORD'));
check('and a sword fitted from it by somebody without either carries both',
  swordMark.damage === P('Keen Edge').fx['damage:sword_blade'] && swordMark.aim === P('Balanced').fx['aim:sword_blade'] && !('temper' in swordMark),
  say('SWORD'));
const [dmgMarked, dmgPlain, hitMarked, hitPlain] = say('SWING').split('|').map(Number);
check('which hits that much harder and lands that much more often, as the island reckons it',
  near(dmgMarked / dmgPlain, P('Keen Edge').fx['damage:sword_blade'], 1e-6)
    && near(hitMarked / hitPlain, P('Balanced').fx['aim:sword_blade'], 1e-6) && hitMarked < HIT_CAP, say('SWING'));

const [temperMark, temperNoWater] = say('TEMPERED').split('|');
check(`${P('Temper Bath').name}: a sword finished with it carries a quench of +${P('Temper Bath').fx['temper:sword']} QL`,
  JSON.parse(temperMark).temper === P('Temper Bath').fx['temper:sword'], say('TEMPERED'));
check('which wants water', temperNoWater === 'You need water to quench it in: stand at the water, or beside a barrel or a well of it.', temperNoWater);
const [qNoPerk, qOk, qBefore, qAfter, qMark, qAgain] = say('QUENCH').split('|');
check('and the perk', qNoPerk === 'That wants a Smith who has learned to temper.' && qOk === 'ALLOWED', say('QUENCH'));
check(`and quenched at a barrel of water it is ${P('Temper Bath').fx['temper:sword']} QL better, once`,
  near(Number(qAfter) - Number(qBefore), P('Temper Bath').fx['temper:sword'], 1e-4) && !qMark.includes('temper')
    && qAgain === 'There is no quench left in it.', say('QUENCH'));

const [mailMark, mailSoak, mailPlain] = say('MAIL').split('|');
check(`${P('Mail Maker').name}: a hauberk beaten out with it turns aside ${P('Mail Maker').fx['soak:chain_hauberk']} times as much`,
  JSON.parse(mailMark).soak === P('Mail Maker').fx['soak:chain_hauberk']
    && near(Number(mailSoak) / Number(mailPlain), P('Mail Maker').fx['soak:chain_hauberk'], 1e-6) && Number(mailSoak) < SOAK_CAP, say('MAIL'));
const [plateMark, plateSoak, platePlain, plateQl, plateRare] = say('PLATE').split('|');
check(`${P('Plate Maker').name}: and a breastplate with it`,
  JSON.parse(plateMark).soak === P('Plate Maker').fx['soak:plate_breastplate']
    && near(Number(plateSoak) / Number(platePlain), P('Plate Maker').fx['soak:plate_breastplate'], 1e-6), say('PLATE'));

/* ---- Ingots ------------------------------------------------------------------------------------- */

const [barNo, barYes, bars] = say('INGOT').split('|');
const [ingots, lumpsLeft, barQl, barKg, lumpKg] = bars.split(':').map(Number);
check(`${P('Ingots').name}: pouring an ingot is refused without it, in the browser's words`,
  barNo === 'That wants a Smith who has learned to pour ingots.' && barYes === 'ALLOWED', `${barNo} / ${barYes}`);
check(`and with it ${INGOT_LUMPS} lumps pour one bar at their quality, which weighs ${INGOT_WEIGHT} of what they did`,
  ingots === 1 && lumpsLeft === 12 - INGOT_LUMPS && near(barQl, 45) && near(barKg, lumpKg * INGOT_LUMPS * INGOT_WEIGHT), bars);
const [pourOk, pourAfter] = say('BARPOUR').split('|');
const [pBars, pLumps, pJobs] = pourAfter.split(':').map(Number);
check('a mould poured from a bar breaks it, and the rest comes back as lumps',
  pourOk === 'ALLOWED' && pBars === 0 && pLumps === INGOT_LUMPS - MOULD_BY_ID.get('shovel_head_mould')!.lumps && pJobs === 1, say('BARPOUR'));
const [mixOk, mixAfter] = say('BARMIX').split('|');
const [bronze, copperLeft, copperBars] = mixAfter.split(':').map(Number);
check('a mix counts a copper bar as its lumps, and gives back what it does not use',
  mixOk === 'ALLOWED' && bronze === BRONZE.count && copperLeft === INGOT_LUMPS - (BRONZE.inputs[0].count ?? 1) && copperBars === 0, say('BARMIX'));
const [coinOk, coinAfter] = say('BARCOIN').split('|');
const [coins, silverLeft, silverBars] = coinAfter.split(':').map(Number);
check('and a strike of coins a silver bar', coinOk === 'ALLOWED' && coins > 0 && silverLeft === INGOT_LUMPS - 1 && silverBars === 0,
  say('BARCOIN'));
const kgs = say('KG').split(',').map((s) => s.split(':'));
check('every metal has an ingot on the island, weighing what the browser says',
  kgs.length === Object.keys(ITEM_DEFS).filter((id) => id.endsWith('_ingot')).length
    && kgs.every(([id, kg]) => near(Number(kg), ITEM_DEFS[id].weight)), say('KG'));

/* ---- the file, the stores and the queue ------------------------------------------------------------ */

const [polA, polB, polLeft, skillA, skillB] = say('POLISH').split('|');
check(`${P('Metal Polisher').name}: a pass on an iron hatchet adds ${P('Metal Polisher').fx['improve:metal']} times as much with it`,
  near(Number(polA) - 40, improveStepAt(Number(skillA), 40), 1e-4)
    && near(Number(polB) - 40, improveStepAt(Number(skillB), 40) * P('Metal Polisher').fx['improve:metal'], 1e-4),
  say('POLISH'));
check('and a pass from an iron bar breaks it for its one lump', polLeft === `${INGOT_LUMPS - 1}:0`, polLeft);

const [reachNo, reachYes, reachGo, reachNow] = say('REACH').split('|');
check(`${P('Forge Reach').name}: lumps in a chest five tiles off are out of reach for a mould without it`,
  reachNo.startsWith('You have no metal to pour.:0'), reachNo);
check(`and in reach with it, for the refusal and the go, while anything else still reaches ${CRAFT_REACH}`,
  reachYes.startsWith('ALLOWED:0') && reachGo === `1:${3 - MOULD_BY_ID.get('shovel_head_mould')!.lumps}` && Number(reachNow) === CRAFT_REACH,
  say('REACH'));
const forge = say('FORGE').split(',');
const forgeRecipes = say('FORGE_RECIPES').split(',');
check('the island\'s forge work is the browser\'s, with every recipe at the smelter',
  [...FORGE_WORK].sort().every((id) => forge.includes(id))
    && RECIPES.filter((r) => r.station === 'smelter').every((r) => forgeRecipes.includes(r.id)),
  `${say('FORGE')} / ${forgeRecipes.length} recipes`);

const [shiftA, shiftB] = say('SHIFT').split('|').map(Number);
check(`${P('Long Shift').name}: ${P('Long Shift').fx.jobs} more jobs in the head`, shiftB - shiftA === P('Long Shift').fx.jobs, say('SHIFT'));

const uses = say('USES').split(',').map(Number);
const usesWanted: number[] = [];
for (let ql = 0; ql <= 100; ql += 10) for (let dmg = 0; dmg <= 90; dmg += 15) for (const lastN of [1, 2, 3]) usesWanted.push(mouldUsesLeft(ql, dmg, lastN));
check('the fillings a mould has left are the browser\'s, at every quality, damage and mark',
  uses.length === usesWanted.length && uses.every((n, i) => n === usesWanted[i]), `${uses.length}`);

/* ---- the browser's half ------------------------------------------------------------ */

const game = Game.create(2718);
const perkOf = (fx: Record<string, number>) => (key: string, otherwise: number): number => fx[key] ?? otherwise;
const bladeMark = makersMark(perkOf({ ...P('Keen Edge').fx, ...P('Balanced').fx }), 'sword_blade');
check('the browser marks a blade as the island does', bladeMark?.damage === swordMark.damage && bladeMark?.aim === swordMark.aim,
  JSON.stringify(bladeMark));
check('and a thing fitted from marked parts keeps the larger of each, and never their temper',
  JSON.stringify(partsMark([{ mark: { damage: 1.1, temper: 5 } }, { mark: { damage: 1.2, aim: 1.05 } }])) === JSON.stringify({ damage: 1.2, aim: 1.05 }));
check('the browser says each new mark', /turns aside 10% more of a blow/.test(markSays({ soak: 1.1 }))
  && /lands 5% more often/.test(markSays({ aim: 1.05 })) && /lasts twice as many fillings/.test(markSays({ last: 2 }))
  && /can be quenched once, for \+5 QL/.test(markSays({ temper: 5 })) && temperOf({}) === 0,
  markSays({ soak: 1.1, aim: 1.05, last: 2, temper: 5 }));
const sword = WEAPON_BY_ID.get('sword')!;
const swordItem = (mark?: Item['mark']): Item => ({ uid: 5, id: 'sword', ql: 50, dmg: 0, count: 1, extra: 'Iron', mark });
check('the browser\'s hit chance reads the aim mark inside the ceiling',
  near(hitChance(game, sword, swordItem({ aim: 1.05 })) / hitChance(game, sword, swordItem()), 1.05, 1e-9)
    && hitChance(game, sword, swordItem({ aim: 99 })) === HIT_CAP);
const plate = ARMOUR_BY_ID.get('plate_breastplate')!;
// The island's breastplate as it came off the anvil: its quality, and its rarity, which the anvil rolls for.
const plateItem = (mark?: Item['mark']): Item =>
  ({ uid: 6, id: 'plate_breastplate', ql: Number(plateQl), dmg: 0, count: 1, extra: 'Iron', mark, rare: rarityStep(plateRare) });
check('and its soak the soak mark inside the ceiling',
  near(pieceSoak(plate, plateItem({ soak: 1.1 }), 20) / pieceSoak(plate, plateItem(), 20), 1.1, 1e-9)
    // The island keeps a quality as a four-byte real, which is the last few places of it.
    && near(pieceSoak(plate, plateItem({ soak: 1.1 }), 20), Number(plateSoak), 1e-6) && pieceSoak(plate, plateItem({ soak: 99 }), 20) === SOAK_CAP);
game.inventory.add('copper_ingot', { count: 1, ql: 40 });
game.inventory.add('tin_lump', { count: 1, ql: 40 });
game.player.x = 1e6;
check('the browser counts a copper bar as its lumps toward a mix',
  recipeStatus(BRONZE, game).inputs[0].have === INGOT_LUMPS && lumpsIn({ id: ingotOf(METAL_BY_ID.get('copper')!), count: 2 }) === 2 * INGOT_LUMPS,
  JSON.stringify(recipeStatus(BRONZE, game).inputs));
const cap = game.queueCapacity();
const hatchet: Item = { uid: 7, id: 'hatchet', ql: 40, dmg: 0, count: 1, extra: 'Iron' };
game.skills.values.set('blacksmithing', 50);
const plainStep = improveStep(game, hatchet, 'blacksmithing');
game.setPerks({ ...P('Long Shift').fx, ...P('Forge Reach').fx, ...P('Metal Polisher').fx });
check('the browser holds more jobs, reaches further at the forge and polishes faster with the perks',
  game.queueCapacity() - cap === P('Long Shift').fx.jobs && game.forgeReach() === P('Forge Reach').fx['reach:forge']
    && near(improveStep(game, hatchet, 'blacksmithing') / plainStep, P('Metal Polisher').fx['improve:metal'], 1e-9)
    && cap === queueCapAt(game.skills.get('mind_logic')),
  `${game.queueCapacity()} / ${cap}, ${game.forgeReach()}`);
check('and the ingots weigh what the rule says', Object.entries(ITEM_DEFS).filter(([id]) => id.endsWith('_ingot')).every(([id, d]) =>
  near(d.weight, ITEM_DEFS[id.replace('_ingot', '_lump')].weight * INGOT_LUMPS * INGOT_WEIGHT)));
check('and a melt reckons Reclaimer\'s share and keep as the island does', meltLumps(hauberk, 1, MELT_SHARE) === meltA[0]
  && near(meltQl(hauberk, MELT_KEEP), meltA[1]));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Smith's perks — ${ok.length} of ${ok.length}`);
