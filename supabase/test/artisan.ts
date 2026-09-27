/**
 * The Artisan's eighteen perks, each measured where its rule is.
 *
 * `perks.ts` holds the two sides to each other for every trade on perks; this
 * asks the one thing that is the Artisan's own: that each perk does what its
 * note says, on the island. Where a perk is a chance, the island's dice are put
 * either side of its number inside the transaction (`dice.random`, first on the
 * search path), so a go shows the number itself:
 *
 *   * a stone set: Sure Setting's failing less, on a ring and in a circlet, and
 *     Keep the Stone's stone out of a failed focus whole;
 *   * a pot, a bowl and a jar: Deep Pot's serving more of a dish cooked in one
 *     and Sealed Jar's slower rot of what is put up in one, the shaper's mark
 *     carried through the kiln;
 *   * a jewel worn: Bright Stone's and Cut True's, on a ring and on a circlet
 *     on the head, each of a circlet's stones at its share;
 *   * the rock: Gem Eye's odds, and the stones More Stones lets out;
 *   * a focus: Focus Cutter's less wear and Keen Focus's stronger spell;
 *   * a book: Good Read's more out of a go of study and Sturdy Binding's less
 *     wear, and a trade book teaching its trade;
 *   * the new things: the amphora and what it will hold, and what is in a bag
 *     on the ground ageing with it; the potter's wheel and anybody's pottery
 *     beside it; the glaze; the trade book, refused below its trade; and the
 *     circlet and a stone set in it;
 *   * the Artisan's tree gone;
 *   * and the browser reckons and says the same.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, GLAZE_ASH, GLAZE_PERK, type Target } from '../../src/game/actions';
import { bookTeaches, LECTERN_GAIN, LECTERN_REACH, STUDY_WEAR, STUDY_WEAR_SPREAD } from '../../src/game/archaeology';
import { CIRCLET_SET, CIRCLET_SHARE, CIRCLET_STONES, GEM_ODDS, GEMS, JEWEL_BONUS, jewelGain, rollGem } from '../../src/game/gems';
import { furnitureDef } from '../../src/game/furniture';
import { slotOf } from '../../src/game/gear';
import { bagRefuses, groundDecayRate, markSays, partsMark, type Item } from '../../src/game/items';
import { perksOf, type PerkDef } from '../../src/game/perks';
import { RECIPE_BY_ID, RECIPE_PERK_SAYS, recipeAction, recipeReason, STONE_KEPT, TRADE_BOOK_AT } from '../../src/game/recipes';
import { gearFrom } from '../../src/game/worn';

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

const ARTISAN = perksOf('artisan');
const P = (name: string): PerkDef => {
  const p = ARTISAN.find((x) => x.name === name);
  if (!p) throw new Error(`the Artisan has no perk called ${name}`);
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
const markOfNewest = (def: string): string => `coalesce((select i.mark::text from item i where i.id = ${newest(def)}), 'none')`;
const clearAll = `delete from item where world_id = w and holder in ('player', 'bag') and holder_uid = u`;
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
const skillOf = (id: string): string =>
  `(select value from skill where world_id = w and uid = u and id = '${id}')`;
/** The go's perks, as the clock sets them for a go of `act`: what `pkx` reads. */
const goContext = (act: string): string => `perform set_config('wurm.pk', coalesce((select pl.class_mul->'fx' from player pl
    where pl.world_id = w and pl.uid = u), '{}'::jsonb)::text, true);
  perform set_config('wurm.pk_act', '${act}', true)`;

const HANDS = 40;
const SKILL = 70;
const QL = 50;
const RING_QL = 80;
const STUDY_FROM = 30;
/** Dice for a failed setting a Sure Setting passes: over its share of failures. */
const SURE_ROLL = (1 + fx('Sure Setting', 'fail:set_ring')) / 2;
/** Dice between the plain odds of a gem and a Gem Eye's, and a roll at the far end of the stones. */
const GEM_ROLL = (GEM_ODDS + fx('Gem Eye', 'gem:mine')) / 2;
const LAST_STONE = 0.999;
const STUDY_ROLL = 0.5;
const RUBY = GEMS.find((g) => g.id === 'ruby')!;
const OPAL = GEMS.find((g) => g.id === 'opal')!;
const KEEPS = fx('Sealed Jar', 'keeps:unfired_clay_jar');
const SERVE = fx('Deep Pot', 'serve:unfired_clay_pot');
const HOUR = 3600;

const out = psql(`
begin;
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

do $$
declare w uuid; u uuid; v_it bigint; v_b bigint; v_c bigint; v_pl bigint; v_t text; v_a double precision; v_bb double precision;
begin
  -- The suite's own island and its first body, an Artisan now.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  ${clearAll};
  delete from player_node where world_id = w and uid = u;
  delete from caller where uid = u;
  update player set x = 9.5, y = 9.5, act = null, act_target = null, act_started = null, act_ends = null,
         act_left = null, act_goes = null, act_queue = '[]', craft_class = 'artisan', combat_class = null,
         class_mul = null, level_h = null, rested = 0, boons = '[]'::jsonb, body_at = now(), swim_at = now(),
         equipped = '{}'::jsonb, craft_from_stores = false, craft_spare_rare = false, wounds = '[]'::jsonb,
         nutrition = '{}'::jsonb, knacks = '{}'::jsonb,
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1,
                                                                    'hurtSettled', now(), 'aegis', 0)
   where world_id = w and uid = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  ${skillAt('jewellery', SKILL)};
  ${skillAt('pottery', SKILL)};
  ${skillAt('papyrusmaking', SKILL)};
  ${skillAt('cooking', SKILL)};
  delete from placed where world_id = w and x between 8 and 10 and y between 8 and 10;

  /* ---- Sure Setting: a ring set under dice that fail it without the perk and pass it with, and a stone in a circlet. ---- */
  ${checks(false)};
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'file', 1, 30);
  v_it := ${thing('gem', QL, 0, `'${RUBY.name}'`)};
  perform give(w, u, 'ring', 1, 30);
  ${dice(SURE_ROLL)};
  ${craft('set_ring')};
  v_t := ${count('jewelled_ring')}::text;
  ${hold('Sure Setting')};
  ${dice(SURE_ROLL)};
  ${craft('set_ring')};
  v_t := v_t || '|' || ${count('jewelled_ring')};
  -- And a stone in a circlet under the same dice.
  v_c := ${thing('circlet', QL, 0)};
  v_it := ${thing('gem', QL, 0, `'${RUBY.name}'`)};
  perform pg_temp.hold(w, u, '{}');
  ${dice(SURE_ROLL)};
  perform perform_item(w, u, 'set_in_circlet', ${itemT('v_it')});
  v_t := v_t || '|' || coalesce((select extra from item where id = v_c), 'empty');
  ${hold('Sure Setting')};
  ${dice(SURE_ROLL)};
  perform perform_item(w, u, 'set_in_circlet', ${itemT('v_it')});
  ${nodice};
  insert into said values ('SURE', v_t || '|' || coalesce((select extra from item where id = v_c), 'empty'));
  ${clearAll};

  /* ---- Keep the Stone: a focus that fails, without it and with it. ---- */
  ${checks(false)};
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'file', 1, 30);
  perform ${thing('gem', QL, 0, `'${RUBY.name}'`)};
  perform give(w, u, 'silver_lump', 1, 30);
  ${craft('set_focus')};
  v_t := ${count('gem')} || ':' || ${count('silver_lump')} || ':' || ${last('The claw goes over%')};
  ${hold('Keep the Stone')};
  perform ${thing('gem', QL, 0, `'${RUBY.name}'`)};
  perform give(w, u, 'silver_lump', 1, 30);
  ${craft('set_focus')};
  insert into said values ('STONE', v_t || '|' || ${count('gem')} || ':' || ${count('silver_lump')} || ':' || ${last('The claw goes over%')});
  ${clearAll};

  /* ---- Deep Pot: a pot shaped with it, carried through the kiln, and a pottage cooked in it by anybody. ---- */
  ${checks(true)};
  ${hold('Deep Pot')};
  perform give(w, u, 'clay', 2, 30);
  ${craft('make_clay_pot')};
  v_t := ${markOfNewest('unfired_clay_pot')};
  insert into placed (world_id, kind, x, y, sx, sy, cx, cy, ql, made_by, state)
    values (w, 'kiln', 9, 9, 0, 0, 9.5, 9.5, 50, u, '{"jobs": [], "output": []}'::jsonb) returning id into v_pl;
  perform perform_firing(w, u, 'load_kiln', jsonb_build_object('kind', 'kiln', 'id', v_pl, 'itemUid', ${newest('unfired_clay_pot')}, 'count', 1));
  v_t := v_t || '#' || coalesce((select state->'jobs'->0->>'mark' from placed where id = v_pl), 'none');
  update placed set state = jsonb_set(state, '{output}', furnace_fold(state->'output', state->'jobs'->0)) || '{"jobs": []}'::jsonb
    where id = v_pl;
  perform perform_firing(w, u, 'kiln_take_all', jsonb_build_object('kind', 'kiln', 'id', v_pl));
  v_t := v_t || '#' || ${markOfNewest('clay_pot')};
  delete from placed where id = v_pl;
  perform pg_temp.hold(w, u, '{}');
  ${inputs('make_pottage')}
  ${craft('make_pottage')};
  v_t := v_t || '#' || ${count('pottage')};
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def in ('clay_pot', 'pottage');
  perform give(w, u, 'clay_pot', 1, 30);
  ${inputs('make_pottage')}
  ${craft('make_pottage')};
  insert into said values ('POT', v_t || '#' || ${count('pottage')});
  ${clearAll};

  /* ---- Sealed Jar: a jar shaped with it, and preserves put up in it by anybody, and in a plain one. ---- */
  ${hold('Sealed Jar')};
  perform give(w, u, 'clay', 1, 30);
  ${craft('make_clay_jar')};
  v_t := ${markOfNewest('unfired_clay_jar')};
  perform pg_temp.hold(w, u, '{}');
  v_it := ${thing('clay_jar', QL, 0)};
  update item set mark = jsonb_build_object('keeps', ${KEEPS}) where id = v_it;
  ${inputs('make_preserves')}
  ${craft('make_preserves')};
  v_t := v_t || '#' || ${markOfNewest('preserves')};
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def in ('clay_jar', 'preserves');
  perform give(w, u, 'clay_jar', 1, 30);
  ${inputs('make_preserves')}
  ${craft('make_preserves')};
  insert into said values ('JAR', v_t || '#' || ${markOfNewest('preserves')});
  ${clearAll};

  /* ---- Bright Stone and Cut True: a ring set with both, worn, and a circlet on the head. ---- */
  ${checks(true)};
  ${hold('Bright Stone', 'Cut True')};
  perform give(w, u, 'file', 1, 30);
  perform ${thing('gem', QL, 0, `'${RUBY.name}'`)};
  perform give(w, u, 'ring', 1, 30);
  ${craft('set_ring')};
  v_it := ${newest('jewelled_ring')};
  update item set ql = ${RING_QL} where id = v_it;
  v_t := coalesce((select mark::text from item where id = v_it), 'none');
  perform pg_temp.hold(w, u, '{}');
  v_bb := skill_mult(w, u, '${RUBY.skill}');
  update player set equipped = jsonb_build_object('jewel', v_it) where world_id = w and uid = u;
  v_a := skill_mult(w, u, '${RUBY.skill}');
  v_t := v_t || '#' || (v_a - v_bb) || '#' || jewel_gain(${row('v_it')}, '${RUBY.skill}') || '#' || jewel_gain(${row('v_it')}, 'masonry');
  v_c := ${thing('circlet', RING_QL, 0, `'${RUBY.name}, ${OPAL.name}, ${RUBY.name}'`)};
  update item set mark = jsonb_build_object('bright', ${fx('Bright Stone', 'bright:circlet')}) where id = v_c;
  update player set equipped = jsonb_build_object('head', v_c) where world_id = w and uid = u;
  v_a := skill_mult(w, u, '${RUBY.skill}');
  v_t := v_t || '#' || (v_a - v_bb) || '#' || jewel_gain(${row('v_c')}, '${RUBY.skill}') || '#' || jewel_gain(${row('v_c')}, '${OPAL.skill}')
    || '#' || coalesce(slot_of('circlet'), 'none');
  update player set equipped = '{}'::jsonb where world_id = w and uid = u;
  insert into said values ('JEWEL', v_t);
  ${clearAll};

  /* ---- Gem Eye and More Stones: the rock under dice between the two odds, and the stone at the far end of the draw. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${goContext('mine')};
  ${dice(GEM_ROLL, LAST_STONE)};
  perform maybe_gem(w, u, 50, 50);
  v_t := ${count('gem')}::text;
  ${hold('Gem Eye')};
  ${goContext('mine')};
  ${dice(GEM_ROLL, LAST_STONE)};
  perform maybe_gem(w, u, 50, 50);
  v_t := v_t || '|' || coalesce((select extra from item where id = ${newest('gem')}), 'none');
  ${clearAll};
  ${hold('Gem Eye', 'More Stones')};
  ${goContext('mine')};
  ${dice(GEM_ROLL, LAST_STONE)};
  perform maybe_gem(w, u, 50, 50);
  v_t := v_t || '|' || coalesce((select extra from item where id = ${newest('gem')}), 'none');
  ${dice(LAST_STONE)};
  v_t := v_t || '|' || roll_gem() || '|' || roll_gem(true);
  ${nodice};
  perform set_config('wurm.pk', '', true);
  perform set_config('wurm.pk_act', '', true);
  insert into said values ('GEMS', v_t);
  ${clearAll};

  /* ---- Focus Cutter and Keen Focus: a focus set with both, and what a spell cast from it wears and does. ---- */
  ${checks(true)};
  ${hold('Focus Cutter', 'Keen Focus')};
  perform give(w, u, 'file', 1, 30);
  perform ${thing('gem', QL, 0, `'${RUBY.name}'`)};
  perform give(w, u, 'silver_lump', 1, 30);
  ${craft('set_focus')};
  v_it := ${newest('focus')};
  v_b := ${thing('focus', QL, 0, `'${RUBY.name}'`)};
  update item set ql = ${QL} where id = v_it;
  v_t := coalesce((select mark::text from item where id = v_it), 'none')
    || '#' || spell_wear(w, u, (select d from spell_def d where d.id = 'pyre'), ${row('v_it')})
    || '#' || spell_wear(w, u, (select d from spell_def d where d.id = 'pyre'), ${row('v_b')})
    || '#' || spell_force(w, u, (select d from spell_def d where d.id = 'pyre'), ${row('v_it')})
    || '#' || spell_force(w, u, (select d from spell_def d where d.id = 'pyre'), ${row('v_b')});
  insert into said values ('FOCUS', v_t);
  ${clearAll};

  /* ---- Good Read and Sturdy Binding: a book bound with both, and a go of study in it and in a plain one. ---- */
  ${hold('Good Read', 'Sturdy Binding')};
  perform give(w, u, 'needle', 1, 30);
  ${inputs('make_book')}
  ${craft('make_book')};
  v_it := ${newest('book')};
  update item set ql = ${QL}, dmg = 0 where id = v_it;
  v_t := coalesce((select mark::text from item where id = v_it), 'none');
  perform pg_temp.hold(w, u, '{}');
  v_b := ${thing('book', QL, 0)};
  -- What a plain go and a go at a quarter more would teach, from the same place under the same dice.
  ${skillAt('mind_logic', STUDY_FROM)};
  ${dice(STUDY_ROLL)};
  v_a := skill_raise(w, u, 'mind_logic', 0.5 + ${QL} / 90.0);
  ${skillAt('mind_logic', STUDY_FROM)};
  ${dice(STUDY_ROLL)};
  v_bb := skill_raise(w, u, 'mind_logic', (0.5 + ${QL} / 90.0) * ${fx('Good Read', 'teach:book')});
  v_t := v_t || '#' || v_a || '#' || v_bb;
  ${skillAt('mind_logic', STUDY_FROM)};
  ${dice(STUDY_ROLL)};
  perform perform_dig(w, u, 'study_book', ${itemT('v_b')});
  v_t := v_t || '#' || (${skillOf('mind_logic')} - ${STUDY_FROM}) || '#' || (select dmg from item where id = v_b);
  ${skillAt('mind_logic', STUDY_FROM)};
  ${dice(STUDY_ROLL)};
  perform perform_dig(w, u, 'study_book', ${itemT('v_it')});
  v_t := v_t || '#' || (${skillOf('mind_logic')} - ${STUDY_FROM}) || '#' || (select dmg from item where id = v_it);
  -- And a trade book, which teaches its trade and not mind logic.
  v_c := ${thing('trade_book', QL, 0, "'Mining'")};
  ${skillAt('mind_logic', STUDY_FROM)};
  ${skillAt('mining', STUDY_FROM)};
  ${dice(STUDY_ROLL)};
  perform perform_dig(w, u, 'study_book', ${itemT('v_c')});
  ${nodice};
  insert into said values ('BOOK', v_t || '#' || (${skillOf('mining')} - ${STUDY_FROM}) || '#' || (${skillOf('mind_logic')} - ${STUDY_FROM})
    || '#' || coalesce(dig_refusal(w, u, 'study_book', ${itemT('v_c')}), 'ALLOWED'));
  ${clearAll};

  /* ---- The amphora: refused without it, shaped with it; what it will hold; what is in it set down. ---- */
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'clay', 4, 30);
  v_t := ${craftRefused('make_amphora')};
  ${hold('Amphora')};
  v_t := v_t || '#' || ${craftRefused('make_amphora')};
  ${craft('make_amphora')};
  v_t := v_t || '#' || ${count('unfired_amphora')} || '#' || coalesce((select fired from pottery_def where unfired = 'unfired_amphora'), 'none');
  perform pg_temp.hold(w, u, '{}');
  v_b := ${thing('amphora', QL, 0)};
  v_t := v_t || '#' || coalesce(bag_refuses(${row('v_b')}, 'log', 1), 'ALLOWED')
    || '#' || coalesce(bag_refuses(${row('v_b')}, 'strawberry', 5), 'ALLOWED');
  insert into item (world_id, holder, holder_uid, inside, def, ql, count) values (w, 'bag', u, v_b, 'strawberry', ${QL}, 5)
    returning id into v_c;
  v_t := v_t || '#' || coalesce(bag_refuses(${row('v_b')}, 'raspberry', 1), 'ALLOWED')
    || '#' || coalesce(bag_refuses(${row('v_b')}, 'strawberry', 16), 'ALLOWED')
    || '#' || coalesce(bag_refuses(${row('v_b')}, 'strawberry', 15), 'ALLOWED');
  -- Set down an hour ago: what is in it is charged with it, at half the weather.
  update item set holder = 'ground', holder_uid = null, gx = 9, gy = 9, rot_at = now() - interval '${HOUR} seconds' where id = v_b;
  v_a := ground_decay_rate(${row('v_c')}) * decay_multiplier(w, 9, 9) * (select shelter from item_def where id = 'amphora');
  perform ground_sweep(w);
  v_t := v_t || '#' || (select dmg from item where id = v_c) || '#' || v_a;
  delete from item where id in (v_b, v_c);
  -- And a thing charged long ago and set down again starts its clock afresh.
  v_it := ${thing('log', 30, 0)};
  update item set rot_at = now() - interval '10 hours' where id = v_it;
  perform perform_hands(w, u, 'drop', jsonb_build_object('kind', 'item', 'uid', v_it, 'count', 1));
  insert into said values ('AMPHORA', v_t || '#' || coalesce((select rot_at::text from item where id = v_it), 'fresh'));
  delete from item where id = v_it;
  ${clearAll};

  /* ---- The potter's wheel: refused without it, built with it, and a go at pottery beside one. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${inputs('make_potters_wheel')}
  perform give(w, u, 'mallet', 1, 30);
  v_t := ${craftRefused('make_potters_wheel')};
  ${hold("Potter's Wheel")};
  v_t := v_t || '#' || ${craftRefused('make_potters_wheel')};
  perform pg_temp.hold(w, u, '{}');
  ${clearAll};
  perform give(w, u, 'clay', 2, 30);
  v_it := ${newest('clay')};
  v_t := v_t || '#' || pg_temp.secs(w, u, 'make_clay_pot', ${itemT('v_it')}) || '#' || piece_pace(w, u, 'pottery');
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'furniture', 'potters_wheel', 9, 9, 0, 0, 9.5, 9.5, 50, null) returning id into v_pl;
  v_t := v_t || '#' || pg_temp.secs(w, u, 'make_clay_pot', ${itemT('v_it')}) || '#' || piece_pace(w, u, 'pottery')
    || '#' || piece_pace(w, u, 'carpentry');
  delete from placed where id = v_pl;
  insert into said values ('WHEEL', v_t);
  ${clearAll};

  /* ---- Glaze: refused without it, and a clay pot glazed with it. ---- */
  perform pg_temp.hold(w, u, '{}');
  v_it := ${thing('clay_pot', QL, 0)};
  perform give(w, u, 'ash', ${GLAZE_ASH}, 30);
  v_t := ${refused('glaze_item', 'v_it')};
  ${hold('Glaze')};
  v_t := v_t || '#' || ${refused('glaze_item', 'v_it')};
  perform perform_item(w, u, 'glaze_item', ${itemT('v_it')});
  v_t := v_t || '#' || coalesce((select mark::text from item where id = v_it), 'none') || '#' || ${count('ash')}
    || '#' || ${last('You brush an ash glaze%')} || '#' || ${refused('glaze_item', 'v_it')}
    || '#' || ground_decay_rate(${row('v_it')}) || '#' || mark_says((select mark from item where id = v_it));
  update item set mark = null where id = v_it;
  v_t := v_t || '#' || ${refused('glaze_item', 'v_it')};
  insert into said values ('GLAZE', v_t);
  ${clearAll};

  /* ---- The trade book: refused without it, and below the trade itself; written with it. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${inputs('write_trade_book_mining')}
  perform give(w, u, 'needle', 1, 30);
  ${skillAt('mining', TRADE_BOOK_AT - 20)};
  v_t := ${craftRefused('write_trade_book_mining')};
  ${hold('Trade Book')};
  v_t := v_t || '#' || ${craftRefused('write_trade_book_mining')};
  ${skillAt('mining', TRADE_BOOK_AT + 10)};
  v_t := v_t || '#' || ${craftRefused('write_trade_book_mining')};
  ${craft('write_trade_book_mining')};
  insert into said values ('TRADEBOOK', v_t || '#' || coalesce((select extra from item where id = ${newest('trade_book')}), 'none'));
  ${clearAll};

  /* ---- The circlet: refused without it, made with it; stones set in it, one that will not seat, and a full one. ---- */
  ${checks(true)};
  perform pg_temp.hold(w, u, '{}');
  ${inputs('make_circlet')}
  perform give(w, u, 'file', 1, 30);
  v_t := ${craftRefused('make_circlet')};
  ${hold('Circlet')};
  v_t := v_t || '#' || ${craftRefused('make_circlet')};
  ${craft('make_circlet')};
  v_c := ${newest('circlet')};
  perform pg_temp.hold(w, u, '{}');
  v_it := ${thing('gem', QL, 0, `'${RUBY.name}'`)};
  v_t := v_t || '#' || ${count('circlet')} || '#' || ${refused('set_in_circlet', 'v_it')};
  perform perform_item(w, u, 'set_in_circlet', ${itemT('v_it')});
  v_t := v_t || '#' || coalesce((select extra from item where id = v_c), 'empty') || '#' || ${count('gem')}
    || '#' || ${last('You seat the%')};
  ${checks(false)};
  v_it := ${thing('gem', QL, 0, `'${OPAL.name}'`)};
  perform perform_item(w, u, 'set_in_circlet', ${itemT('v_it')});
  v_t := v_t || '#' || coalesce((select extra from item where id = v_c), 'empty') || '#' || ${count('gem')}
    || '#' || ${last('The % will not seat%')};
  ${checks(true)};
  perform perform_item(w, u, 'set_in_circlet', ${itemT('v_it')});
  v_it := ${thing('gem', QL, 0, `'${RUBY.name}'`)};
  perform perform_item(w, u, 'set_in_circlet', ${itemT('v_it')});
  v_it := ${thing('gem', QL, 0, `'${RUBY.name}'`)};
  v_t := v_t || '#' || coalesce((select extra from item where id = v_c), 'empty') || '#' || ${refused('set_in_circlet', 'v_it')};
  delete from item where id = v_c;
  v_t := v_t || '#' || ${refused('set_in_circlet', 'v_it')};
  insert into said values ('CIRCLET', v_t);
  ${clearAll};

  /* ---- What the marks say, the numbers the island reads, and the tree. ---- */
  insert into said values ('SAYS', mark_says('{"bright": 1.5, "cut": 0.05, "thrift": 0.75, "force": 1.1, "serve": 1, "keeps": 0.5, "teach": 1.25, "sturdy": 0.5, "glaze": 0}'::jsonb));
  insert into said values ('CONSTS', circlet_stones() || '|' || circlet_share() || '|' || circlet_set() || '|' || trade_book_at()
    || '|' || glaze_ash() || '|' || lectern_gain() || '|' || lectern_reach() || '|' || study_wear() || '|' || study_wear_spread());
  insert into said values ('NODES', (select count(*) from class_node where id ~ '^artisan_')::text || ':'
    || (select count(*) from player_node where node ~ '^artisan_[0-9]_[0-9]$'));
end $$;

select k || E'\\t' || v from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const [k, ...v] = l.split('\t');
  return [k, v.join('\t')];
}));
const say = (k: string): string => said.get(k) ?? 'unsaid';
const mark = (s: string): Record<string, number> => (s === 'none' ? {} : JSON.parse(s));

/* ---- setting a stone -------------------------------------------------------------------- */

const [ringPlain, ringSure, circletPlain, circletSure] = say('SURE').split('|');
check(`${P('Sure Setting').name}: dice of ${SURE_ROLL} fail a ring without it and pass it with it`, ringPlain === '0' && ringSure === '1', say('SURE'));
check('and a stone in a circlet the same', circletPlain === 'empty' && circletSure === RUBY.name, say('SURE'));
const [stonePlain, stoneKept] = say('STONE').split('|');
const focusFail = RECIPE_BY_ID.get('set_focus')?.fail;
check('a focus that fails loses the stone and the silver',
  stonePlain === `0:0:${focusFail}`, stonePlain);
check(`${P('Keep the Stone').name}: with it the stone comes out whole, the silver does not, and it says so in the browser's words`,
  stoneKept === `1:0:${STONE_KEPT}`, stoneKept);

/* ---- a pot, a bowl and a jar ------------------------------------------------------------- */

const pot = say('POT').split('#');
const pottage = RECIPE_BY_ID.get('make_pottage')!;
check(`${P('Deep Pot').name}: a pot shaped with it carries the mark, through the kiln's job and out of it`,
  mark(pot[0]).serve === SERVE && mark(pot[1]).serve === SERVE && mark(pot[2]).serve === SERVE, pot.slice(0, 3).join(' / '));
check(`and a pottage cooked in it by anybody is ${SERVE} more than in a plain one (${pottage.count})`,
  pot[3] === String((pottage.count ?? 1) + SERVE) && pot[4] === String(pottage.count ?? 1), pot.slice(3).join(' / '));
const jar = say('JAR').split('#');
check(`${P('Sealed Jar').name}: a jar shaped with it is marked, and preserves put up in it by anybody rot ${KEEPS} as fast, in a plain one as they were`,
  mark(jar[0]).keeps === KEEPS && near(mark(jar[1]).rot ?? 1, KEEPS) && jar[2] === 'none', say('JAR'));

/* ---- a jewel worn ------------------------------------------------------------------------ */

const jewel = say('JEWEL').split('#');
const ringMark = mark(jewel[0]);
check(`${P('Bright Stone').name} and ${P('Cut True').name}: a ring set with both carries both`,
  ringMark.bright === fx('Bright Stone', 'bright:jewelled_ring') && ringMark.cut === fx('Cut True', 'cut:jewelled_ring'), jewel[0]);
const ringGives = JEWEL_BONUS * fx('Bright Stone', 'bright:jewelled_ring') + fx('Cut True', 'cut:jewelled_ring') * RING_QL / 100;
check(`worn at QL ${RING_QL}, it gives ${ringGives.toFixed(3)} more on ${RUBY.skill}, and nothing on another trade`,
  near(Number(jewel[1]), ringGives, 1e-4) && near(Number(jewel[2]), ringGives, 1e-4) && Number(jewel[3]) === 0, jewel.slice(1, 4).join(' / '));
const circletGives = 2 * JEWEL_BONUS * fx('Bright Stone', 'bright:circlet') * CIRCLET_SHARE;
check(`a circlet on the head with two rubies and an opal gives ${circletGives} on ${RUBY.skill} and half as much on ${OPAL.skill}`,
  near(Number(jewel[4]), circletGives, 1e-4) && near(Number(jewel[5]), circletGives, 1e-4) && near(Number(jewel[6]), circletGives / 2, 1e-4)
    && jewel[7] === 'head', jewel.slice(4).join(' / '));
const worn: Pick<Item, 'id' | 'extra' | 'ql' | 'mark'> = { id: 'jewelled_ring', extra: RUBY.name, ql: RING_QL, mark: ringMark };
const circletItem: Pick<Item, 'id' | 'extra' | 'ql' | 'mark'> = {
  id: 'circlet', extra: `${RUBY.name}, ${OPAL.name}, ${RUBY.name}`, ql: RING_QL, mark: { bright: fx('Bright Stone', 'bright:circlet') },
};
check('the browser\'s jewel gives what the island\'s does, a ring and a circlet',
  near(jewelGain(worn, RUBY.skill), Number(jewel[2]), 1e-4) && near(jewelGain(circletItem, RUBY.skill), Number(jewel[5]), 1e-4)
    && near(jewelGain(circletItem, OPAL.skill), Number(jewel[6]), 1e-4) && slotOf('circlet') === 'head',
  `${jewelGain(worn, RUBY.skill)} / ${jewelGain(circletItem, RUBY.skill)}`);
check('and a circlet is drawn with its stones',
  gearFrom({ head: ['circlet', 0, `${RUBY.name}, ${OPAL.name}`, null] })?.head?.material === `${RUBY.id},${OPAL.id}`,
  JSON.stringify(gearFrom({ head: ['circlet', 0, `${RUBY.name}, ${OPAL.name}`, null] })));

/* ---- the rock ---------------------------------------------------------------------------- */

const [gemPlain, gemEye, gemMore, rollPlain, rollMore] = say('GEMS').split('|');
const lastPlain = rollGem(() => LAST_STONE, false).name;
const lastMore = rollGem(() => LAST_STONE, true).name;
check(`${P('Gem Eye').name}: dice of ${GEM_ROLL} find no gem at the plain odds and one at its`, gemPlain === '0' && gemEye === lastPlain, say('GEMS'));
check(`${P('More Stones').name}: the far end of the draw is ${lastMore} with it and ${lastPlain} without, on both sides`,
  gemMore === lastMore && rollPlain === lastPlain && rollMore === lastMore && lastMore !== lastPlain
    && GEMS.filter((g) => g.perk).every((g) => g.perk === 'more_stones'), say('GEMS'));

/* ---- a focus ----------------------------------------------------------------------------- */

const focus = say('FOCUS').split('#');
const focusMark = mark(focus[0]);
check(`${P('Focus Cutter').name} and ${P('Keen Focus').name}: a focus set with both carries both`,
  focusMark.thrift === fx('Focus Cutter', 'thrift:focus') && focusMark.force === fx('Keen Focus', 'force:focus'), focus[0]);
check(`a spell cast from it wears it ${fx('Focus Cutter', 'thrift:focus')} as much and is ${fx('Keen Focus', 'force:focus')} as strong`,
  near(Number(focus[1]) / Number(focus[2]), fx('Focus Cutter', 'thrift:focus'), 1e-4)
    && near(Number(focus[3]) / Number(focus[4]), fx('Keen Focus', 'force:focus'), 1e-4), focus.slice(1).join(' / '));

/* ---- a book ------------------------------------------------------------------------------ */

const book = say('BOOK').split('#');
const bookMark = mark(book[0]);
check(`${P('Good Read').name} and ${P('Sturdy Binding').name}: a book bound with both carries both`,
  bookMark.teach === fx('Good Read', 'teach:book') && bookMark.sturdy === fx('Sturdy Binding', 'sturdy:book'), book[0]);
const [plainOught, readOught, plainGain, plainWear, readGain, readWear, tradeGain, tradeLogic, tradeOk] = book.slice(1).map(Number);
check('a go of study in a plain book teaches what its quality says, and wears it what the dice say',
  near(plainGain, plainOught, 1e-4) && near(plainWear, STUDY_WEAR + STUDY_ROLL * STUDY_WEAR_SPREAD, 1e-4), book.slice(1).join(' / '));
check(`in one bound with them, what ${fx('Good Read', 'teach:book')} times as much teaches, and ${fx('Sturdy Binding', 'sturdy:book')} the wear`,
  near(readGain, readOught, 1e-4) && readGain > plainGain
    && near(readWear, (STUDY_WEAR + STUDY_ROLL * STUDY_WEAR_SPREAD) * fx('Sturdy Binding', 'sturdy:book'), 1e-4), book.slice(1).join(' / '));
check(`${P('Trade Book').name}: a trade book teaches its trade and not mind logic, and is a book to study`,
  tradeGain > 0 && tradeLogic === 0 && Number.isNaN(tradeOk) && book[9] === 'ALLOWED', book.slice(7).join(' / '));
check('the browser reads a trade book\'s trade off its spine', bookTeaches({ id: 'trade_book', extra: 'Mining' }) === 'mining'
  && bookTeaches({ id: 'book' }) === 'mind_logic');

/* ---- the amphora ------------------------------------------------------------------------- */

const amph = say('AMPHORA').split('#');
check(`${P('Amphora').name}: refused without it in the browser's words, shaped with it, and fired into an amphora`,
  amph[0] === RECIPE_PERK_SAYS.amphora && amph[1] === 'ALLOWED' && amph[2] === '1' && amph[3] === 'amphora', amph.slice(0, 4).join(' / '));
const amphora: Item = { uid: 1, id: 'amphora', ql: QL, dmg: 0, count: 1, inside: [] };
const berries: Item = { uid: 2, id: 'strawberry', ql: QL, dmg: 0, count: 5 };
check('it holds food and drink and nothing else, in the browser\'s words',
  amph[4] === bagRefuses(amphora, { uid: 3, id: 'log', ql: 30, dmg: 0, count: 1 }) && amph[5] === 'ALLOWED'
    && bagRefuses(amphora, berries) === null, `${amph[4]} / ${amph[5]}`);
amphora.inside = [berries];
check('and one kind of it at a time, to twenty',
  amph[6] === bagRefuses(amphora, { uid: 4, id: 'raspberry', ql: 30, dmg: 0, count: 1 })
    && amph[7] === bagRefuses(amphora, { ...berries, uid: 5, count: 16 }) && amph[8] === 'ALLOWED'
    && bagRefuses(amphora, { ...berries, uid: 6, count: 15 }) === null, amph.slice(6, 9).join(' / '));
check('set down, what is in it ages with it at the share of the weather it keeps off', near(Number(amph[9]), Number(amph[10]), 1e-4)
  && Number(amph[9]) > 0, amph.slice(9, 11).join(' / '));
check('and a thing set down starts its clock afresh', amph[11] === 'fresh', amph[11]);

/* ---- the potter's wheel ------------------------------------------------------------------ */

const wheel = say('WHEEL').split('#');
check(`${P("Potter's Wheel").name}: refused without it in the browser's words, built with it`,
  wheel[0] === RECIPE_PERK_SAYS.potters_wheel && wheel[1] === 'ALLOWED', wheel.slice(0, 2).join(' / '));
const wheelBy = furnitureDef('potters_wheel').pace?.by ?? 1;
const [potAlone] = wheel[2].split(':').map(Number);
const [potWheel] = wheel[4].split(':').map(Number);
check(`a go at pottery beside one, anybody's, takes ${wheelBy} of the time, and nothing else is quicker for it`,
  near(potWheel / potAlone, wheelBy, 1e-4) && wheel[3] === '1' && near(Number(wheel[5]), wheelBy) && wheel[6] === '1', wheel.slice(2).join(' / '));
const game = Game.create(4403);
game.setPerks({});
game.skills.values.set('pottery', SKILL);
const potDef = recipeAction(RECIPE_BY_ID.get('make_clay_pot')!);
const aloneB = game.duration(potDef);
const placedWheel = game.addFurniture('potters_wheel', game.player.tileX, game.player.tileY, 0, 0, 50);
check('the browser\'s wheel takes the same off', near(game.duration(potDef) / aloneB, wheelBy, 1e-4) && game.pieceSpeed('carpentry') === 1,
  `${aloneB} → ${game.duration(potDef)}`);
game.removeFurniture(placedWheel.id);

/* ---- the glaze --------------------------------------------------------------------------- */

const glaze = say('GLAZE').split('#');
check(`${P('Glaze').name}: refused without it in the browser's words`, glaze[0] === GLAZE_PERK && glaze[1] === 'ALLOWED', glaze.slice(0, 2).join(' / '));
check('glazed, the pot carries it, the ashes are spent, and it will not be glazed twice',
  mark(glaze[2]).glaze === 0 && glaze[3] === '0' && glaze[4] === 'You brush an ash glaze over the clay pot and it takes. It will not decay now.'
    && glaze[5] === 'It is glazed already.', glaze.slice(2, 6).join(' / '));
check('a glazed pot never decays on the ground, and says so in the browser\'s words',
  Number(glaze[6]) === 0 && glaze[7] === markSays({ glaze: 0 }), glaze.slice(6, 8).join(' / '));
check('and with no ashes left, it says so', glaze[8] === 'You need ashes to make a glaze of.', glaze[8]);

/* ---- the trade book ---------------------------------------------------------------------- */

const tbook = say('TRADEBOOK').split('#');
const tbookRecipe = RECIPE_BY_ID.get('write_trade_book_mining')!;
check(`${P('Trade Book').name}: refused without it, and below ${TRADE_BOOK_AT} in the trade, in the browser's words; written with both`,
  tbook[0] === RECIPE_PERK_SAYS.trade_book && tbook[1] === `You know too little of mining to write a book on it: that wants ${TRADE_BOOK_AT}.`
    && tbook[2] === 'ALLOWED' && tbook[3] === 'Mining', say('TRADEBOOK'));

/* ---- the circlet ------------------------------------------------------------------------- */

const circ = say('CIRCLET').split('#');
check(`${P('Circlet').name}: refused without it in the browser's words, made with it`,
  circ[0] === RECIPE_PERK_SAYS.circlet && circ[1] === 'ALLOWED' && circ[2] === '1', circ.slice(0, 3).join(' / '));
check('a stone set in it by anybody goes in, and says how many settings are filled',
  circ[3] === 'ALLOWED' && circ[4] === RUBY.name && circ[5] === '0'
    && circ[6] === `You seat the ruby in the circlet and close the claws over it: 1 of its ${CIRCLET_STONES} settings are filled.`, circ.slice(3, 7).join(' / '));
check('one that will not seat comes out again whole',
  circ[7] === RUBY.name && circ[8] === '1' && circ[9] === 'The opal will not seat, and you take it out again whole.', circ.slice(7, 10).join(' / '));
check(`and a full one takes no more, and none carried is refused, in the browser's words`,
  circ[10] === `${RUBY.name}, ${OPAL.name}, ${RUBY.name}` && circ[11] === `You have no circlet with a setting empty: each takes ${CIRCLET_STONES} stones.`
    && circ[12] === circ[11], circ.slice(10).join(' / '));

/* ---- the browser ------------------------------------------------------------------------- */

const itemTarget = (it: Item): Target => ({ kind: 'item', uid: it.uid });
game.setPerks({});
check('its circlet, amphora, wheel and trade books are refused in the island\'s words without the perks',
  recipeReason(RECIPE_BY_ID.get('make_circlet')!, game) === circ[0] && recipeReason(RECIPE_BY_ID.get('make_amphora')!, game) === amph[0]
    && recipeReason(RECIPE_BY_ID.get('make_potters_wheel')!, game) === wheel[0] && recipeReason(tbookRecipe, game) === tbook[0]);
game.setPerks(P('Trade Book').fx);
game.skills.values.set('mining', TRADE_BOOK_AT - 20);
check('and a trade book below its trade the same', recipeReason(tbookRecipe, game) === tbook[1], String(recipeReason(tbookRecipe, game)));
game.setPerks({});
const glazeDef = ACTION_BY_ID.get('glaze_item')!;
const setDef = ACTION_BY_ID.get('set_in_circlet')!;
const plainPot = game.inventory.add('clay_pot', { ql: QL });
check('its glaze is refused in the island\'s words without the perk', glazeDef.check?.(itemTarget(plainPot), game) === glaze[0]);
game.setPerks(P('Glaze').fx);
game.inventory.add('ash', { ql: 30, count: GLAZE_ASH });
game.log.length = 0;
glazeDef.perform(itemTarget(plainPot), game);
check('and with it glazes the pot and says the same', plainPot.mark?.glaze === 0 && game.log.some((l) => l.text === glaze[4])
  && groundDecayRate(plainPot) === 0 && glazeDef.check?.(itemTarget(plainPot), game) === glaze[5], game.log.map((l) => l.text).join(' | '));
game.setPerks({});
const ruby = game.inventory.add('gem', { ql: QL, extra: RUBY.name });
game.inventory.add('file', { ql: 30 });
check('its circlet is refused with none carried, in the island\'s words', setDef.check?.(itemTarget(ruby), game) === circ[12],
  String(setDef.check?.(itemTarget(ruby), game)));
const circlet = game.inventory.add('circlet', { ql: QL });
game.skillCheck = () => true;
game.log.length = 0;
setDef.perform(itemTarget(ruby), game);
check('and a stone set in it goes in and says the same', circlet.extra === RUBY.name && game.inventory.count('gem') === 0
  && game.log.some((l) => l.text === circ[6]), game.log.map((l) => l.text).join(' | '));
const opal = game.inventory.add('gem', { ql: QL, extra: OPAL.name });
game.skillCheck = () => false;
game.rand = () => 0.99;
game.log.length = 0;
setDef.perform(itemTarget(opal), game);
check('one that will not seat comes out whole, in the same words', circlet.extra === RUBY.name && game.inventory.count('gem') === 1
  && game.log.some((l) => l.text === circ[9]), game.log.map((l) => l.text).join(' | '));
check(`a circlet takes ${CIRCLET_STONES} stones, each at ${CIRCLET_SHARE} of a ring's, set at ${CIRCLET_SET}`,
  CIRCLET_STONES === Number(say('CONSTS').split('|')[0]) && CIRCLET_SHARE === Number(say('CONSTS').split('|')[1])
    && CIRCLET_SET === Number(say('CONSTS').split('|')[2]));

// Deep Pot and Sealed Jar at the browser's bench, and Keep the Stone.
game.skillCheck = () => true;
game.rand = () => 0.5;
const markedPot = game.inventory.add('clay_pot', { ql: QL, mark: { serve: SERVE } });
game.inventory.remove(plainPot.uid, 1);
for (const i of pottage.inputs) game.inventory.add(i.item, { ql: 30, count: i.count ?? 1 });
recipeAction(pottage).perform({ kind: 'item', uid: game.inventory.find(pottage.inputs[0].item)!.uid }, game);
check('the browser\'s pottage in a Deep Pot is the island\'s', String(game.inventory.count('pottage')) === pot[3], `${game.inventory.count('pottage')}`);
game.inventory.remove(markedPot.uid, 1);
const preserves = RECIPE_BY_ID.get('make_preserves')!;
game.inventory.add('clay_jar', { ql: QL, mark: { keeps: KEEPS } });
for (const i of preserves.inputs) game.inventory.add(i.item, { ql: 30, count: i.count ?? 1 });
recipeAction(preserves).perform({ kind: 'item', uid: game.inventory.find(preserves.inputs[0].item)!.uid }, game);
check('and its preserves in a Sealed Jar', near(game.inventory.find('preserves')?.mark?.rot ?? 1, KEEPS), JSON.stringify(game.inventory.find('preserves')?.mark));
game.setPerks(P('Keep the Stone').fx);
game.skillCheck = () => false;
const setFocus = RECIPE_BY_ID.get('set_focus')!;
game.inventory.add('gem', { ql: QL, extra: RUBY.name });
game.inventory.add('silver_lump', { ql: 30 });
const gemsBefore = game.inventory.count('gem');
game.log.length = 0;
recipeAction(setFocus).perform({ kind: 'item', uid: game.inventory.find('silver_lump')!.uid }, game);
check('its Keep the Stone keeps the stone and says the same', game.inventory.count('gem') === gemsBefore && game.inventory.count('silver_lump') === 0
  && game.log.some((l) => l.text === STONE_KEPT), game.log.map((l) => l.text).join(' | '));
game.setPerks({});

// The kiln carries the shaper's mark in the browser too.
game.kilns.set(99, {
  id: 99, x: game.player.tileX, y: game.player.tileY, sx: 0, sy: 0, ql: 50, fuel: 1000, lit: true, output: [],
  jobs: [{ item: { uid: 0, id: 'unfired_clay_pot', ql: QL, dmg: 0, count: 1, mark: { serve: SERVE } }, makes: 'clay_pot', left: 1, total: 1, ql: QL }],
});
(game as unknown as { runKilns(dt: number): void }).runKilns(5);
check('its kiln carries the shaper\'s mark into the pot', game.kilns.get(99)?.output[0]?.mark?.serve === SERVE,
  JSON.stringify(game.kilns.get(99)?.output));
game.kilns.delete(99);

check('what the marks say is the browser\'s, word for word',
  say('SAYS') === markSays({ bright: 1.5, cut: 0.05, thrift: 0.75, force: 1.1, serve: 1, keeps: 0.5, teach: 1.25, sturdy: 0.5, glaze: 0 }),
  `${say('SAYS')} // ${markSays({ bright: 1.5, cut: 0.05, thrift: 0.75, force: 1.1, serve: 1, keeps: 0.5, teach: 1.25, sturdy: 0.5, glaze: 0 })}`);
check('and a glaze is not carried from a part into what it goes into', partsMark([{ mark: { glaze: 0 } }]).glaze === undefined);

/* ---- what the island says the numbers are ------------------------------------------------ */

check('the island\'s numbers for a circlet, a trade book, a glaze and a go of study are the browser\'s',
  say('CONSTS') === [CIRCLET_STONES, CIRCLET_SHARE, CIRCLET_SET, TRADE_BOOK_AT, GLAZE_ASH, LECTERN_GAIN, LECTERN_REACH, STUDY_WEAR,
    STUDY_WEAR_SPREAD].join('|'), say('CONSTS'));
check('and the Artisan\'s tree is gone', say('NODES') === '0:0', say('NODES'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Artisan's perks — ${ok.length} of ${ok.length}`);
