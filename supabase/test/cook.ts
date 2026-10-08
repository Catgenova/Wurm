/**
 * The Cook's eighteen perks, each measured where its rule is.
 *
 * `perks.ts` holds the two sides to each other for every trade on perks --
 * the rows, the tiers, the fold, the choosing -- and this asks the one thing
 * that is the Cook's own: that each perk does what its note says, on the
 * island, with the dice taken out wherever they can be. A skill check is made
 * to pass outright, the quality a pair of hands turns out is held still, and a
 * chance is put at one inside the transaction, so that a go must show the rule.
 *
 *   * the pot: Fine Fare's quality, Big Pot's one more, Frugal Cook's
 *     ingredient back, and the marks Hearty, Long-lasting, Flavoursome and
 *     Filling put on a dish, which stack it by them;
 *   * eating: what a marked dish fills, feeds and gives, and Balanced Diet's
 *     fuller table;
 *   * the ground: Long-lasting's slower rot, and a handful set down that
 *     keeps what the pile it came off had;
 *   * Quick Kitchen's time off every cooking recipe;
 *   * the knife: Full Carcass, Prime Cuts, Hide Keeper and Bait Maker;
 *   * the barrel: Strong Brew stamped, drawn off, drunk, poured together and
 *     emptied;
 *   * Pantry Reach; Broth and Distil, with their refusals; Taste;
 *   * and the browser says and reads the same where it asks or offers them.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, tasteSays } from '../../src/game/actions';
import type { Target } from '../../src/game/actions';
import { boonTime } from '../../src/game/boons';
import { ITEM_DEFS, markSays, type Item, type Mark } from '../../src/game/items';
import { helpingOf, NUTRIENTS, TABLE_BEST } from '../../src/game/nutrition';
import { perksOf, type PerkDef } from '../../src/game/perks';
import { CRAFT_REACH, RECIPE_PERK_SAYS, RECIPES, reachFor, recipeReason } from '../../src/game/recipes';

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

const COOK = perksOf('cook');
const P = (name: string): PerkDef => {
  const p = COOK.find((x) => x.name === name);
  if (!p) throw new Error(`the Cook has no perk called ${name}`);
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
const qls = (def: string): string =>
  `coalesce((select string_agg(distinct round(i.ql::numeric, 2)::text, ',') from item i
     where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = '${def}'), '-')`;
const newest = (def: string): string =>
  `(select i.id from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = '${def}' order by i.id desc limit 1)`;
const clear = (...defs: string[]): string =>
  `delete from item where world_id = w and holder = 'player' and holder_uid = u and def in (${defs.map(q).join(', ')})`;
const last = (like: string): string =>
  `(select e.text from event e where e.world_id = w and e.uid = u and e.text like ${q(like)} order by e.n desc limit 1)`;
const craft = (r: string): string => `perform perform_craft(w, u, '${r}', jsonb_build_object('kind', 'item', 'uid', null))`;
const refused = (r: string): string => `coalesce(craft_refusal(w, u, '${r}', null), 'ALLOWED')`;
const item = (a: string, id: string, more = ''): string =>
  `perform act_perform(w, u, '${a}', jsonb_build_object('kind', 'item', 'uid', ${id}${more}))`;
const barrel = (a: string): string => `perform act_perform(w, u, '${a}', jsonb_build_object('kind', 'furniture', 'id', v_barrel))`;
/** How long the one knack somebody has lasts from now. */
const knackFor = '(select coalesce(string_agg(round(((b->>\'until\')::double precision - world_time(w))::numeric)::text, \',\'), \'none\') '
  + 'from player p, jsonb_array_elements(p.boons) b where p.world_id = w and p.uid = u)';
const fresh = (hunger = 0): string =>
  `update player set boons = '[]'::jsonb, nutrition = '{}'::jsonb,
     stats = stats || jsonb_build_object('hunger', ${hunger}, 'thirst', 0.2) where world_id = w and uid = u`;
const hungerNow = "(select round(((stats->>'hunger')::double precision)::numeric, 6) from player where world_id = w and uid = u)";
const flesh = "(select round(coalesce((nutrition->>'flesh')::double precision, 0)::numeric, 6) from player where world_id = w and uid = u)";
const markOfRow = (id: string): string => `coalesce((select mark::text from item where id = ${id}), 'none')`;
/** Every skill check passes, until it is said otherwise. */
const checks = (pass: boolean): string =>
  `create or replace function skill_check(p_skill double precision, p_difficulty double precision,
     p_tool_ql double precision default 0, p_ease double precision default 0)
     returns boolean language sql as 'select ${pass}'`;
/** The quality a pair of hands turns out, held still. */
const HANDS = 40;
/** How much of a carcass a knife takes, held still: half. */
const SHARE = 0.5;
const SPACE = 'between 4 and 15';
const MARKED: Mark = { feed: 1.25, fill: 1.25, knack: 1.5, rot: 0.5 };
const MARKS: Array<Mark | null> = [
  { hold: 1.2 }, { speed: 1.1, damage: 1.15, range: 1.2 }, { soak: 1.1, aim: 1.05, last: 2 }, { temper: 5 }, MARKED, null,
];
const markSql = (m: Mark | null): string => (m ? `${q(JSON.stringify(m))}::jsonb` : 'null::jsonb');

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
create or replace function product_ql(p_skill double precision, p_tool_ql double precision default 0)
  returns double precision language sql as 'select ${HANDS}::double precision';
create or replace function butcher_yield(p_skill double precision, p_knife_ql double precision)
  returns double precision language sql immutable as 'select ${SHARE}::double precision';

do $$
declare w uuid; u uuid; tx int; ty int; v_t text; v_u text; v_it bigint; v_row bigint; v_chest bigint; v_barrel bigint;
begin
  -- The suite's own island and its first body, a Cook now, on flat grass beside a lit fire.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  for tx in 0..15 loop for ty in 0..15 loop
    perform land_set_height(w, tx, ty, 40); perform land_set_dirt(w, tx, ty, 20);
    perform land_set_tile(w, tx, ty, tile_id('Grass')); perform land_set_data(w, tx, ty, 0);
  end loop; end loop;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  delete from item where world_id = w and holder = 'ground' and gx between 0 and 15 and gy between 0 and 15;
  -- A settlement's crates here fill with whatever its workers forage, and a craft reaches into them.
  delete from item where world_id = w and holder = 'crate'
     and crate in (select c.id from crate c where c.world_id = w and c.x between 0 and 15 and c.y between 0 and 15);
  delete from player_node where world_id = w and uid = u;
  delete from placed where world_id = w and x ${SPACE} and y ${SPACE};
  delete from creature where world_id = w and from_x between 4 and 16 and from_y between 4 and 16;
  delete from caller where uid = u;
  update player set way = null where world_id = w;
  update player set x = 9.5, y = 9.5, act = null, act_target = null, act_started = null, act_ends = null,
         act_left = null, act_goes = null, act_queue = '[]', craft_class = 'cook', combat_class = null,
         class_mul = null, level_h = null, rested = 0, boons = '[]'::jsonb, nutrition = '{}'::jsonb, body_at = now(), swim_at = now(),
         equipped = '{}'::jsonb,
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
   where world_id = w and uid = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  insert into skill (world_id, uid, id, value)
    select w, u, s, 60 from unnest(array['cooking', 'butchering', 'brewing']) s
    on conflict (world_id, uid, id) do update set value = excluded.value;
  insert into placed (world_id, kind, x, y, sx, sy, cx, cy, ql, made_by, lit, fuel, since)
    values (w, 'campfire', 10, 10, 0, 0, 10.25, 10.25, 40, u, true, 3600, now());
  ${checks(true)};
  insert into said values ('SEED', (select seed::text from world where id = w));

  /* ---- The pot: Fine Fare, Big Pot and the four marks, on a stew. ---- */
  perform give(w, u, 'clay_bowl', 1, 50);
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'cooked_meat', 1, 30); perform give(w, u, 'potato', 1, 30); perform give(w, u, 'onion', 1, 30);
  ${craft('make_stew')};
  v_t := ${count('stew')} || ':' || ${qls('stew')} || ':' || ${markOfRow(newest('stew'))};
  ${clear('stew')};
  ${hold('Fine Fare', 'Big Pot', 'Hearty', 'Long-lasting', 'Flavoursome', 'Filling')};
  perform give(w, u, 'cooked_meat', 1, 30); perform give(w, u, 'potato', 1, 30); perform give(w, u, 'onion', 1, 30);
  ${craft('make_stew')};
  v_t := v_t || '|' || ${count('stew')} || ':' || ${qls('stew')} || ':' || ${markOfRow(newest('stew'))};
  -- A second pot of the same goes on the same pile; a plain pot does not.
  perform give(w, u, 'cooked_meat', 1, 30); perform give(w, u, 'potato', 1, 30); perform give(w, u, 'onion', 1, 30);
  ${craft('make_stew')};
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'cooked_meat', 1, 30); perform give(w, u, 'potato', 1, 30); perform give(w, u, 'onion', 1, 30);
  ${craft('make_stew')};
  insert into said values ('POT', v_t || '|' || (select string_agg(i.count || ':' || coalesce(i.mark::text, 'none'), '#' order by i.id)
    from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = 'stew'));
  ${clear('stew')};

  /* ---- Frugal Cook: the first ingredient back at its own QL, with its chance put at one. ---- */
  ${patch('Frugal Cook', { 'keep:make_stew': 1, 'keep:make_broth': 1 })};
  perform give(w, u, 'cooked_meat', 1, 33); perform give(w, u, 'potato', 1, 30); perform give(w, u, 'onion', 1, 30);
  ${craft('make_stew')};
  v_t := ${count('cooked_meat')}::text;
  ${hold('Frugal Cook')};
  perform give(w, u, 'cooked_meat', 1, 33); perform give(w, u, 'potato', 1, 30); perform give(w, u, 'onion', 1, 30);
  ${craft('make_stew')};
  insert into said values ('FRUGAL', v_t || '|' || ${count('cooked_meat')} || ':' || ${qls('cooked_meat')} || ':' || ${count('potato')}
    || '|' || coalesce(${last('You save %')}, 'unsaid'));
  ${clear('stew', 'cooked_meat')};

  /* ---- Broth and Distil: refused without them, made with them; and Frugal Cook never gives back the water. ---- */
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'clay_pot', 1, 50);
  perform give(w, u, 'bone', 2, 35); perform give(w, u, 'water_bucket', 1, 30);
  perform give(w, u, 'ale_bucket', 3, 30);
  v_t := ${refused('make_broth')} || '#' || ${refused('distil_ale')};
  ${hold('Broth', 'Distil')};
  v_t := v_t || '#' || ${refused('make_broth')} || '#' || ${refused('distil_ale')};
  ${craft('make_broth')};
  ${craft('distil_ale')};
  insert into said values ('GATES', v_t || '|' || ${count('broth')} || ':' || ${count('bone')} || ':' || ${count('water_bucket')} || ':'
    || ${count('ale_bucket')} || ':' || ${count('spirit_bucket')} || ':' || ${count('bucket')} || ':'
    || coalesce((select charges::text from item where id = ${newest('spirit_bucket')}), 'none'));
  ${clear('broth', 'bucket', 'spirit_bucket')};
  ${hold('Broth', 'Frugal Cook')};
  perform give(w, u, 'bone', 2, 35); perform give(w, u, 'water_bucket', 1, 30);
  ${craft('make_broth')};
  insert into said values ('FRUGALBROTH', ${count('bone')} || ':' || ${qls('bone')} || ':' || ${count('water_bucket')} || ':' || ${count('bucket')}
    || '|' || coalesce(${last('You save %')}, 'unsaid'));
  ${clear('broth', 'bone', 'bucket', 'clay_pot', 'clay_bowl')};

  /* ---- Eating: a plain stew and a marked one, of the same QL, each on an empty stomach. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${fresh()};
  v_it := give(w, u, 'stew', 1, ${HANDS});
  ${item('eat', 'v_it')};
  v_t := ${hungerNow} || ':' || ${flesh} || ':' || ${knackFor};
  ${fresh()};
  v_it := give(w, u, 'stew', 1, ${HANDS}, null, null, null, null, ${markSql(MARKED)});
  ${item('eat', 'v_it')};
  insert into said values ('EAT', v_t || '|' || ${hungerNow} || ':' || ${flesh} || ':' || ${knackFor});
  ${clear('stew')};

  /* ---- Balanced Diet: a full table, and the helping that fills it. ---- */
  update player set boons = '[]'::jsonb, rested = 0,
         nutrition = '{"starch": 1, "flesh": 1, "fat": 1, "greens": 1}'::jsonb where world_id = w and uid = u;
  perform pg_temp.hold(w, u, '{}');
  v_t := skill_mult(w, u, 'cooking')::text;
  ${hold('Balanced Diet')};
  v_t := v_t || ':' || skill_mult(w, u, 'cooking');
  update player set boons = '[]'::jsonb, nutrition = '{"starch": 1, "flesh": 0.99, "fat": 1, "greens": 1}'::jsonb,
         stats = stats || '{"hunger": 0}'::jsonb where world_id = w and uid = u;
  v_it := give(w, u, 'stew', 1, ${HANDS});
  ${item('eat', 'v_it')};
  v_u := coalesce(${last('You eat the stew.%')}, 'unsaid');
  perform pg_temp.hold(w, u, '{}');
  update player set boons = '[]'::jsonb, nutrition = '{"starch": 1, "flesh": 0.99, "fat": 1, "greens": 1}'::jsonb,
         stats = stats || '{"hunger": 0}'::jsonb where world_id = w and uid = u;
  v_it := give(w, u, 'stew', 1, ${HANDS});
  ${item('eat', 'v_it')};
  insert into said values ('TABLE', v_t || '|' || v_u || '|' || coalesce(${last('You eat the stew.%')}, 'unsaid'));
  ${clear('stew')};
  update player set nutrition = '{}'::jsonb, boons = '[]'::jsonb where world_id = w and uid = u;

  /* ---- The ground: Long-lasting, and a handful set down. ---- */
  perform pg_temp.hold(w, u, '{}');
  v_it := give(w, u, 'stew', 1, ${HANDS});
  ${item('drop', 'v_it')};
  v_row := v_it;
  v_t := coalesce((select cool::text from item where id = v_it), 'none') || ':' || (select ground_decay_rate(i) from item i where i.id = v_it);
  -- Two of a marked pile of four.
  v_it := give(w, u, 'stew', 4, ${HANDS}, null, 'rare', null, null, '{"rot": 0.5}'::jsonb);
  ${item('drop', 'v_it', ", 'count', 2")};
  v_t := v_t || '|' || (select i.count || ':' || coalesce(i.mark::text, 'none') || ':' || coalesce(i.rare, '-') || ':'
      || coalesce(i.cool::text, 'none') || ':' || ground_decay_rate(i)
    from item i where i.world_id = w and i.holder = 'ground' and i.gx = 9 and i.gy = 9 and i.def = 'stew' and i.id <> v_row
    order by i.id desc limit 1) || ':' || (select count from item where id = v_it);
  -- Not food.
  v_it := give(w, u, 'bone', 1, ${HANDS});
  ${item('drop', 'v_it')};
  v_t := v_t || '|' || coalesce((select cool::text from item where id = v_it), 'none');
  -- Picked up again, and what kept it goes.
  ${clear('stew')};
  perform act_perform(w, u, 'pick_up', jsonb_build_object('kind', 'ground', 'x', 9, 'y', 9, 'uid', v_row));
  insert into said values ('GROUND', v_t || '|' || coalesce((select holder || ':' || coalesce(cool::text, 'none') from item where id = v_row), 'gone'));
  ${clear('stew', 'bone')};
  delete from item where world_id = w and holder = 'ground' and gx between 0 and 15 and gy between 0 and 15;

  /* ---- Quick Kitchen: a cooking recipe's time, and one that is not cooking. ---- */
  perform pg_temp.hold(w, u, '{}');
  v_t := pk(w, u, ${q(`time:${RECIPES.find((r) => r.skill === 'cooking')!.id}`)}, 1)::text;
  ${hold('Quick Kitchen')};
  insert into said values ('KITCHEN', v_t || '|' || pk(w, u, ${q(`time:${RECIPES.find((r) => r.skill === 'cooking')!.id}`)}, 1)
    || '|' || pk(w, u, ${q(`time:${RECIPES.find((r) => r.skill !== 'cooking')!.id}`)}, 1));

  /* ---- The knife: half a cobbe without the perks; all of it, finer and with bait, with them. ---- */
  perform give(w, u, 'butchering_knife', 1, 50);
  perform pg_temp.hold(w, u, '{}');
  perform drop_on_ground(w, 9, 9, 'corpse', 40, 'Cobbe');
  perform act_perform(w, u, 'butcher', jsonb_build_object('kind', 'ground', 'x', 9, 'y', 9));
  v_t := ${count('meat')} || ':' || ${count('bone')} || ':' || ${count('offal')} || ':' || ${qls('meat')} || ':' || ${qls('bone')};
  ${clear('meat', 'bone', 'hide', 'fur', 'offal')};
  ${patch('Full Carcass', { 'share:butcher': 2 })};
  ${hold('Full Carcass', 'Prime Cuts', 'Hide Keeper', 'Bait Maker')};
  perform drop_on_ground(w, 9, 9, 'corpse', 40, 'Cobbe');
  perform act_perform(w, u, 'butcher', jsonb_build_object('kind', 'ground', 'x', 9, 'y', 9));
  v_t := v_t || '|' || ${count('meat')} || ':' || ${count('bone')} || ':' || ${count('hide')} || ':' || ${count('fur')} || ':' || ${count('offal')}
    || '|' || ${qls('meat')} || ':' || ${qls('bone')} || ':' || ${qls('hide')} || ':' || ${qls('fur')} || ':' || ${qls('offal')}
    || '|' || coalesce(${last('You butcher the cobbe%')}, 'unsaid');
  ${clear('meat', 'bone', 'hide', 'fur', 'offal')};
  ${patch('Full Carcass', { 'share:butcher': 3 })};
  ${hold('Full Carcass')};
  perform drop_on_ground(w, 9, 9, 'corpse', 40, 'Cobbe');
  perform act_perform(w, u, 'butcher', jsonb_build_object('kind', 'ground', 'x', 9, 'y', 9));
  insert into said values ('KNIFE', v_t || '|' || ${count('meat')} || ':' || ${count('bone')});
  ${clear('meat', 'bone', 'hide', 'fur', 'offal', 'butchering_knife')};

  /* ---- Strong Brew: stamped, drawn off, drunk, poured together, drawn dry and tipped out. ---- */
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by, litres, liquid, since)
    values (w, 'furniture', 'barrel', 10, 9, 0, 0, 10.5, 9.5, 40, 'Oak', u, 20, 'water', now()) returning id into v_barrel;
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'wheat', 12, 55);
  perform act_perform(w, u, 'start_brew', jsonb_build_object('kind', 'furniture', 'id', v_barrel, 'brew', 'ale'));
  v_t := (select coalesce(liquid, 'none') || ':' || coalesce(knack::text, 'none') from placed where id = v_barrel);
  update placed set litres = 20, liquid = 'water', ferment = 0, knack = null where id = v_barrel;
  ${clear('wheat')};
  perform give(w, u, 'wheat', 12, 55);
  ${hold('Strong Brew')};
  perform act_perform(w, u, 'start_brew', jsonb_build_object('kind', 'furniture', 'id', v_barrel, 'brew', 'ale'));
  v_t := v_t || '|' || (select coalesce(liquid, 'none') || ':' || coalesce(knack::text, 'none') from placed where id = v_barrel);
  update placed set ferment = 0 where id = v_barrel;
  -- Drawn off into a bucket, which carries it.
  v_it := give(w, u, 'bucket', 1, 30);
  ${item('fill_bucket', 'v_it')};
  v_t := v_t || '|' || (select def || ':' || ${markOfRow('v_it')} from item where id = v_it);
  -- Drunk from the bucket, and from the barrel, by somebody without the perk.
  perform pg_temp.hold(w, u, '{}');
  ${fresh(1)};
  ${item('drink_skin', 'v_it')};
  v_t := v_t || '|' || ${knackFor} || ':' || round(boon_time('ale_bucket', (select ql from item where id = v_it), 1.5)::numeric);
  ${fresh(1)};
  ${barrel('drink_from_vessel')};
  v_t := v_t || ':' || ${knackFor} || ':' || round(boon_time('ale_bucket', (select ql from placed where id = v_barrel), 1.5)::numeric);
  -- A plain bucket of ale poured in, and the barrel is only as good as the worst of it.
  v_u := give(w, u, 'ale_bucket', 1, 30)::text;
  ${item('pour_into_barrel', 'v_u::bigint')};
  v_t := v_t || '|' || (select coalesce(knack::text, 'none') from placed where id = v_barrel)
    || ':' || (select def || ':' || ${markOfRow('v_u::bigint')} from item where id = v_u::bigint);
  -- The strong bucket into an empty barrel makes it strong again.
  update placed set litres = 0, liquid = null, knack = null where id = v_barrel;
  ${item('pour_into_barrel', 'v_it')};
  v_t := v_t || '|' || (select coalesce(liquid, 'none') || ':' || litres || ':' || coalesce(knack::text, 'none') from placed where id = v_barrel)
    || ':' || (select def || ':' || ${markOfRow('v_it')} from item where id = v_it);
  -- The last of it drawn off, and the barrel forgets it; the bucket keeps it.
  ${item('fill_bucket', 'v_it')};
  v_t := v_t || '|' || (select coalesce(liquid, 'none') || ':' || coalesce(knack::text, 'none') from placed where id = v_barrel)
    || ':' || (select def || ':' || ${markOfRow('v_it')} from item where id = v_it);
  -- Tipped out, and the bucket forgets it too.
  ${item('empty_bucket', 'v_it')};
  v_t := v_t || '|' || (select def || ':' || ${markOfRow('v_it')} from item where id = v_it);
  -- And a barrel emptied out.
  update placed set litres = 10, liquid = 'ale', knack = 1.5 where id = v_barrel;
  ${barrel('empty_vessel')};
  insert into said values ('BREW', v_t || '|' || (select coalesce(liquid, 'none') || ':' || coalesce(knack::text, 'none') from placed where id = v_barrel));
  delete from placed where id = v_barrel;
  ${clear('bucket', 'ale_bucket', 'wheat')};

  /* ---- Pantry Reach: a potato in a chest five tiles off, for a stew; and the reach of a job that is not cooking. ---- */
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'chest', 14, 9, 0, 0, 14.5, 9.5, 40, 'Pine', u) returning id into v_chest;
  insert into item (world_id, holder, placed, def, ql, count) values (w, 'furniture', v_chest, 'potato', 45, 3);
  perform give(w, u, 'clay_bowl', 1, 50); perform give(w, u, 'cooked_meat', 1, 30); perform give(w, u, 'onion', 1, 30);
  perform pg_temp.hold(w, u, '{}');
  v_t := coalesce(act_refusal(w, u, 'make_stew', jsonb_build_object('kind', 'item', 'uid', null)), 'ALLOWED');
  ${hold('Pantry Reach')};
  v_t := v_t || '#' || coalesce(act_refusal(w, u, 'make_stew', jsonb_build_object('kind', 'item', 'uid', null)), 'ALLOWED');
  perform set_config('wurm.pk', (select (class_mul->'fx')::text from player where world_id = w and uid = u), true);
  perform set_config('wurm.pk_act', 'make_stew', true);
  v_t := v_t || '|' || craft_reach();
  perform set_config('wurm.pk_act', 'make_planks', true);
  v_t := v_t || ':' || craft_reach();
  perform set_config('wurm.pk', '', true);
  perform set_config('wurm.pk_act', '', true);
  insert into said values ('PANTRY', v_t);
  delete from item where placed = v_chest;
  delete from placed where id = v_chest;
  ${clear('clay_bowl', 'cooked_meat', 'onion', 'potato', 'stew')};

  /* ---- Taste: a marked stew and a bucket of spirit examined, without it and with it. ---- */
  v_it := give(w, u, 'stew', 1, ${HANDS}, null, null, null, null, ${markSql(MARKED)});
  v_row := give(w, u, 'spirit_bucket', 1, 50);
  update item set charges = (select charges from item_def where id = 'spirit_bucket') where id = v_row;
  perform pg_temp.hold(w, u, '{}');
  ${item('examine_item', 'v_it')};
  insert into said values ('TASTE0', coalesce(${last('Stew: QL%')}, 'unsaid'));
  ${hold('Taste')};
  ${item('examine_item', 'v_it')};
  insert into said values ('TASTE1', coalesce(${last('Stew: QL%')}, 'unsaid'));
  ${item('examine_item', 'v_row')};
  insert into said values ('TASTE2', coalesce(${last('Bucket of spirit %: QL%')}, 'unsaid'));
  ${clear('stew', 'spirit_bucket')};

  /* ---- What the island says of a mark, and how long a knack lasts, beside the browser. ---- */
  insert into said select 'MARKSAYS', string_agg(mark_says(m), '#' order by n)
    from (values ${MARKS.map((m, i) => `(${i}, ${markSql(m)})`).join(', ')}) v(n, m);
  insert into said values ('BOONS', boon_time('stew', ${HANDS}) || ':' || boon_time('stew', ${HANDS}, 1.5) || ':'
    || boon_time('spirit_bucket', 50) || ':' || boon_time('ale_bucket', 30, 1.5));
  -- How much slower a rare thing rots, off the island's own rule.
  insert into said values ('RAREKEEP', rarity_keep('rare')::text);
  insert into said values ('NODES', (select count(*) from class_node where id ~ '^cook_')::text || ':'
    || (select count(*) from player_node where node ~ '^cook_[0-9]_[0-9]$'));
end $$;

select k || E'\\t' || coalesce(v, '') from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const [k, ...v] = l.split('\t');
  return [k, v.join('\t')];
}));
const say = (k: string): string => said.get(k) ?? 'unsaid';
const json = (s: string): Record<string, number> | null => (s === 'none' ? null : JSON.parse(s));
const sameMark = (a: Record<string, number> | null, b: Record<string, number> | null): boolean =>
  JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());

/* ---- The pot ------------------------------------------------------------------------------- */

const stew = RECIPES.find((r) => r.id === 'make_stew')!;
const [potPlain, potPerk, potPiles] = say('POT').split('|');
const [plainN, plainQl, plainMark] = potPlain.split(':');
check('a stew made without the perks: one, at the hands\' QL, unmarked',
  plainN === String(stew.count ?? 1) && Number(plainQl) === HANDS && plainMark === 'none', potPlain);
const [perkN, perkQl, ...perkMarkParts] = potPerk.split(':');
const fine = P('Fine Fare').fx['ql:make_stew'];
check(`${P('Fine Fare').name}: a stew comes up at ${fine} of the QL`, near(Number(perkQl), HANDS * fine, 1e-4), perkQl);
check(`${P('Big Pot').name}: ${P('Big Pot').fx['count:stew']} stews a go`, perkN === String(P('Big Pot').fx['count:stew']), perkN);
const madeMark = json(perkMarkParts.join(':'));
check(`${P('Hearty').name}, ${P('Long-lasting').name}, ${P('Flavoursome').name} and ${P('Filling').name}: the stew carries their four marks`,
  sameMark(madeMark, {
    feed: P('Hearty').fx['feed:stew'], rot: P('Long-lasting').fx['rot:stew'],
    knack: P('Flavoursome').fx['knack:stew'], fill: P('Filling').fx['fill:stew'],
  }), perkMarkParts.join(':'));
const piles = potPiles.split('#').map((s) => {
  const [n, ...m] = s.split(':');
  return { n: Number(n), mark: json(m.join(':')) };
});
check('and a second marked pot goes on the same pile, and a plain one on a pile of its own',
  piles.length === 2 && piles[0].n === 2 * P('Big Pot').fx['count:stew'] && sameMark(piles[0].mark, madeMark)
    && piles[1].n === (stew.count ?? 1) && piles[1].mark === null, potPiles);
const [frugalPlain, frugalPerk, frugalSaid] = say('FRUGAL').split('|');
const meatName = ITEM_DEFS.cooked_meat.name.toLowerCase();
check(`${P('Frugal Cook').name}: a stew spends its meat without it, and gives one back at its own QL with its chance put at one`,
  frugalPlain === '0' && frugalPerk === '1:33.00:0'
    && frugalSaid === `You save ${/^[aeiou]/.test(meatName) ? 'an' : 'a'} ${meatName} from the pot.`, say('FRUGAL'));
const [gates, gatesMade] = say('GATES').split('|');
const [brothNo, distilNo, brothYes, distilYes] = gates.split('#');
check(`${P('Broth').name} and ${P('Distil').name}: refused without them, in the browser's words, and allowed with them`,
  brothNo === RECIPE_PERK_SAYS.broth && distilNo === RECIPE_PERK_SAYS.distil && brothYes === 'ALLOWED' && distilYes === 'ALLOWED', gates);
const broth = RECIPES.find((r) => r.id === 'make_broth')!;
const distil = RECIPES.find((r) => r.id === 'distil_ale')!;
check('a broth takes its two bones and the water, and gives back the bucket; a spirit takes three buckets of ale and gives back two, full',
  gatesMade === `${broth.count}:0:0:0:1:${(broth.returns?.[0]?.[1] ?? 0) + (distil.returns?.[0]?.[1] ?? 0)}:${ITEM_DEFS.spirit_bucket.charges}`,
  gatesMade);
const [frugalBroth, frugalBrothSaid] = say('FRUGALBROTH').split('|');
check('and Frugal Cook gives back a bone from a broth, never the water',
  frugalBroth === '1:35.00:0:1' && frugalBrothSaid === 'You save a bone from the pot.', say('FRUGALBROTH'));

/* ---- Eating ------------------------------------------------------------------------------ */

const [eatPlain, eatMarked] = say('EAT').split('|').map((s) => s.split(':').map(Number));
const food = ITEM_DEFS.stew.food ?? 0;
const fleshFeeds = ITEM_DEFS.stew.feeds?.flesh ?? 0;
check('a plain stew fills, feeds and gives a knack as the browser reckons it',
  near(eatPlain[0], food * (0.7 + HANDS / 200), 1e-4) && near(eatPlain[1], fleshFeeds * helpingOf(HANDS), 1e-4)
    && eatPlain[2] === boonTime('stew', HANDS), say('EAT'));
check(`${P('Filling').name}: a marked stew fills ${MARKED.fill} as much of the food bar`,
  near(eatMarked[0], food * (0.7 + HANDS / 200) * MARKED.fill!, 1e-4), `${eatMarked[0]}`);
check(`${P('Hearty').name}: and feeds ${MARKED.feed} as much`, near(eatMarked[1], fleshFeeds * helpingOf(HANDS) * MARKED.feed!, 1e-4), `${eatMarked[1]}`);
check(`${P('Flavoursome').name}: and its knack lasts ${MARKED.knack} as long`,
  eatMarked[2] === boonTime('stew', HANDS, MARKED.knack), `${eatMarked[2]} (browser ${boonTime('stew', HANDS, MARKED.knack)})`);
const [tableMult, tableWith, tableWithout] = say('TABLE').split('|');
const [multPlain, multPerk] = tableMult.split(':').map(Number);
const best = P('Balanced Diet').fx['table:best'];
check(`${P('Balanced Diet').name}: a full table is worth ${best} on what you learn, where it was ${TABLE_BEST}`,
  near(multPerk / multPlain, (1 + best) / (1 + TABLE_BEST), 1e-6), tableMult);
check('and the helping that fills the table says what it is worth to the one eating it',
  tableWith.endsWith(`Everything you do goes in ${Math.round(best * 100)}% faster while it lasts.`)
    && tableWithout.endsWith(`Everything you do goes in ${Math.round(TABLE_BEST * 100)}% faster while it lasts.`),
  `${tableWith} / ${tableWithout}`);

/* ---- The ground -------------------------------------------------------------------------- */

const [gPlain, gHandful, gBone, gPicked] = say('GROUND').split('|');
const [plainCool, plainRate] = gPlain.split(':');
check('food set down rots at its own pace, with nothing to cool it', plainCool === 'none' && Number(plainRate) > 0, gPlain);
const handful = gHandful.split(':');
const handfulMark = json(handful.slice(1, -4).join(':'));
const [hRare, hCool, hRate, hLeft] = handful.slice(-4);
check(`${P('Long-lasting').name}: two of a marked, rare pile of four set down keep the mark and the rarity, and rot at the mark's pace`,
  handful[0] === '2' && sameMark(handfulMark, { rot: 0.5 }) && hRare === 'rare' && hCool === 'none'
    && near(Number(hRate), Number(plainRate) * 0.5 * Number(say('RAREKEEP')), 1e-6) && hLeft === '2', `${gHandful} (rare keeps ${say('RAREKEEP')})`);
check('what is not food is set down as it was', gBone === 'none', gBone);
check('and picked up again, it keeps nothing of how it lay', gPicked === 'player:none', gPicked);

/* ---- The knife --------------------------------------------------------------------------- */

const [kPlain, kCounts, kQls, kSaid, kAll] = say('KNIFE').split('|');
check(`half a cobbe without the perks: three meat and three bone, at the hands' QL, and no bait`,
  kPlain === `3:3:0:${HANDS}.00:${HANDS}.00`, kPlain);
check(`${P('Full Carcass').name}: with the share over all of it, all of it`, kCounts.startsWith('6:6:5:1:'), kCounts);
const prime = P('Prime Cuts').fx['ql:meat'];
const hides = P('Hide Keeper').fx['ql:hide'];
check(`${P('Prime Cuts').name} and ${P('Hide Keeper').name}: meat, bone, hide and fur come up at their QL, and the bait at the hands'`,
  kQls === [HANDS * prime, HANDS * hides, HANDS * hides, HANDS * hides, HANDS].map((n) => n.toFixed(2)).join(':'), kQls);
check(`${P('Bait Maker').name}: ${P('Bait Maker').fx['bait:butcher']} ${ITEM_DEFS.offal.name.toLowerCase()} with every carcass, and said`,
  kCounts.endsWith(`:${P('Bait Maker').fx['bait:butcher']}`) && kSaid.includes(`${P('Bait Maker').fx['bait:butcher']} × ${ITEM_DEFS.offal.name.toLowerCase()}`),
  `${kCounts} | ${kSaid}`);
check('and never more than all of a carcass, however far over it the share goes', kAll === '6:6', kAll);

/* ---- The barrel -------------------------------------------------------------------------- */

const brew = say('BREW').split('|');
const strong = P('Strong Brew').fx['brewed:ale'];
check(`${P('Strong Brew').name}: a brew set going without it is plain, and with it carries ${strong}`,
  brew[0] === 'ale:none' && brew[1] === `ale:${strong}`, `${brew[0]} / ${brew[1]}`);
check('a bucket drawn off it carries it', sameMark(json(brew[2].split(':').slice(1).join(':')), { knack: strong }) && brew[2].startsWith('ale_bucket:'), brew[2]);
const [skinKnack, skinWant, barrelKnack, barrelWant] = brew[3].split(':');
check('and the knack from a drink of it lasts that much longer, from the bucket and from the barrel, whoever drinks it',
  skinKnack === skinWant && barrelKnack === barrelWant && Number(skinKnack) > 0, brew[3]);
check('a plain bucket poured in leaves the barrel plain, and the bucket empty and unmarked',
  brew[4] === 'none:bucket:none', brew[4]);
check('the strong bucket poured into an empty barrel makes it strong', brew[5].startsWith(`ale:5:${strong}:bucket:none`), brew[5]);
check('the last of it drawn off leaves the barrel empty and forgetting, and the bucket strong',
  brew[6].startsWith('none:none:ale_bucket:') && sameMark(json(brew[6].split(':').slice(3).join(':')), { knack: strong }), brew[6]);
check('a bucket tipped out forgets it', brew[7] === 'bucket:none', brew[7]);
check('and so does a barrel emptied out', brew[8] === 'none:none', brew[8]);

/* ---- Pantry Reach ------------------------------------------------------------------------ */

const [pantryAsk, pantryReach] = say('PANTRY').split('|');
const [pantryNo, pantryYes] = pantryAsk.split('#');
const reach = P('Pantry Reach').fx['reach:cook'];
check(`${P('Pantry Reach').name}: a potato five tiles off is out of reach for a stew without it, and in reach with it`,
  pantryNo === 'Stew takes 1 potato.' && pantryYes === 'ALLOWED', pantryAsk);
check(`and it reaches ${reach} for cooking and ${CRAFT_REACH} for anything else`, pantryReach === `${reach}:${CRAFT_REACH}`, pantryReach);

/* ---- Taste ------------------------------------------------------------------------------- */

const seed = Number(say('SEED'));
const tongue = { seed } as unknown as Game;
const taste = (id: string, ql: number, mark?: Mark): string =>
  tasteSays(tongue, { uid: 0, id, ql, dmg: 0, count: 1, ...(mark ? { mark } : {}) } as Item);
check('a marked stew examined says its maker\'s hand in it, in the browser\'s words, and nothing of its taste without Taste',
  say('TASTE0').includes(markSays(MARKED)) && !say('TASTE0').includes('To your taste'), say('TASTE0'));
check(`${P('Taste').name}: and with it, what a helping does, in the browser's words`,
  say('TASTE1').endsWith(taste('stew', HANDS, MARKED)), `${say('TASTE1')} // ${taste('stew', HANDS, MARKED)}`);
check('and a drink says what it quenches', say('TASTE2').endsWith(taste('spirit_bucket', 50)) && taste('spirit_bucket', 50).includes('quenches'),
  `${say('TASTE2')} // ${taste('spirit_bucket', 50)}`);
check('the island says every maker\'s mark as the browser does', say('MARKSAYS') === MARKS.map((m) => markSays(m)).join('#'),
  `${say('MARKSAYS')} // ${MARKS.map((m) => markSays(m)).join('#')}`);
check('and reckons a knack\'s length as the browser does, a spirit\'s and a strong brew\'s with it',
  say('BOONS') === [boonTime('stew', HANDS), boonTime('stew', HANDS, 1.5), boonTime('spirit_bucket', 50), boonTime('ale_bucket', 30, 1.5)].join(':'),
  say('BOONS'));
check('and the Cook\'s tree is gone', say('NODES') === '0:0', say('NODES'));

/* ---- the browser's half ------------------------------------------------------------------ */

const game = Game.create(2718);
game.setPerks({});
const makeBroth = RECIPES.find((r) => r.id === 'make_broth')!;
const planks = RECIPES.find((r) => r.id === 'make_planks')!;
check('the browser refuses a broth without the perk in the island\'s words', recipeReason(makeBroth, game) === brothNo, String(recipeReason(makeBroth, game)));
game.setPerks(P('Broth').fx);
check('and not for the perk with it', recipeReason(makeBroth, game) !== brothNo, String(recipeReason(makeBroth, game)));
game.setPerks({});
const reachPlain = reachFor(game, stew);
game.setPerks(P('Pantry Reach').fx);
check('the browser\'s cooking reaches as far as the island\'s', reachPlain === CRAFT_REACH && reachFor(game, stew) === reach && reachFor(game, planks) === CRAFT_REACH,
  `${reachPlain} → ${reachFor(game, stew)}, planks ${reachFor(game, planks)}`);
game.setPerks({});
const bestPlain = game.tableBest();
game.setPerks(P('Balanced Diet').fx);
check('and its table is worth what the island\'s is', bestPlain === TABLE_BEST && game.tableBest() === best, `${bestPlain} → ${game.tableBest()}`);
// A marked stew eaten in the browser.
game.setPerks({});
game.player.stats.hunger = 0;
for (const k of NUTRIENTS) game.player.nutrition[k] = 0;
game.player.boons = [];
const bowl = game.inventory.add('stew', { count: 1, ql: HANDS, mark: MARKED });
ACTION_BY_ID.get('eat')!.perform({ kind: 'item', uid: bowl.uid } as Target, game);
const knackLeft = game.player.boons.map((b) => b.until - game.time)[0];
check('the browser fills, feeds and gives a knack off a marked stew as the island does',
  near(game.player.stats.hunger, eatMarked[0], 1e-4) && near(game.player.nutrition.flesh, eatMarked[1], 1e-4)
    && (knackLeft === undefined || near(knackLeft, eatMarked[2], 1e-6)),
  `${game.player.stats.hunger} ${game.player.nutrition.flesh} ${knackLeft}`);
// Quick Kitchen: every cooking recipe, on both sides, and nothing that is not cooking.
const quick = P('Quick Kitchen');
const [kitchenPlain, kitchenWith, kitchenOff] = say('KITCHEN').split('|');
const cookedIds = RECIPES.filter((r) => r.skill === 'cooking').map((r) => r.id);
game.setPerks(quick.fx);
check(`${quick.name}: all ${cookedIds.length} cooking recipes take ${quick.fx[`time:${cookedIds[0]}`]} of the time on both sides, and nothing else does`,
  cookedIds.every((id) => quick.fx[`time:${id}`] === quick.fx[`time:${cookedIds[0]}`] && game.perk(`time:${id}`, 1) === quick.fx[`time:${id}`])
    && Object.keys(quick.fx).length === cookedIds.length
    && kitchenPlain === '1' && near(Number(kitchenWith), quick.fx[`time:${cookedIds[0]}`]) && kitchenOff === '1',
  say('KITCHEN'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Cook's perks — ${ok.length} of ${ok.length}`);
