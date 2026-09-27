/**
 * The Tailor's eighteen perks, each measured where its rule is.
 *
 * `perks.ts` holds the two sides to each other for every trade on perks --
 * the rows, the tiers, the fold, the choosing -- and this asks the one thing
 * that is the Tailor's own: that each perk does what its note says, on the
 * island. A skill check is made to pass or to fail outright and the quality a
 * pair of hands turns out is held still. Where a perk is a chance, the dice
 * are put either side of its number (`dice.random`, first on the search path
 * inside the transaction), so a go shows the number itself and not a patched
 * one:
 *
 *   * the shears: Full Fleece's more wool;
 *   * the spindle and the loom: Quick Spindle's time, Even Thread's third
 *     length and the words that say it, Tight Weave's two yarn;
 *   * the bench: Sure Needle, Sure Awl and Sure Tan against a failed check,
 *     Nothing Wasted's spared materials, Master Tailor's rare, Lye Saver's
 *     bucket, and the marks Sack Maker, Deep Pockets, Saddler and Fisher's
 *     Friend put on what is made, with what each mark then does: the room in
 *     a bag, the pace of a mount in marked tack and of a cart on marked yokes,
 *     a net's haul and a creel's odds;
 *   * Light Pack's weights, Workshop Reach, Patch with its refusals, and the
 *     tent: refused without the perk, built with it, and slept in;
 *   * and the browser says and reads the same where it asks or offers them.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game, MAX_MOUNT_SPEED } from '../../src/game/game';
import { ACTION_BY_ID, PATCH_PERK } from '../../src/game/actions';
import type { Target } from '../../src/game/actions';
import { SHEAR_WOOL } from '../../src/game/creatureActions';
import { tackSpeed } from '../../src/game/creatures';
import { furnitureDef } from '../../src/game/furniture';
import { bagRoom, ITEM_DEFS, markSays, RARITY_ODDS, type Item, type Mark } from '../../src/game/items';
import { perksOf, type PerkDef } from '../../src/game/perks';
import { CRAFT_REACH, needOf, RECIPE_BY_ID, RECIPE_PERK_SAYS, reachFor, recipeReason } from '../../src/game/recipes';
import { creelOdds, TRAPS } from '../../src/game/traps';
import { countSaid } from '../../src/game/words';

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

const TAILOR = perksOf('tailor');
const P = (name: string): PerkDef => {
  const p = TAILOR.find((x) => x.name === name);
  if (!p) throw new Error(`the Tailor has no perk called ${name}`);
  return p;
};
/** A perk's number for a key, which it must have. */
const fx = (name: string, key: string): number => {
  const v = P(name).fx[key];
  if (v === undefined) throw new Error(`${name} has no ${key}`);
  return v;
};
const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const hold = (...names: string[]): string =>
  `perform pg_temp.hold(w, u, array[${names.map((n) => q(P(n).id)).join(', ')}]::text[])`;
/** A perk's number put where a go must show it, for the length of the transaction. */
const patch = (name: string, more: Record<string, number>): string =>
  `update class_perk set fx = fx || ${q(JSON.stringify(more))}::jsonb where id = ${q(P(name).id)}`;
const count = (def: string): string =>
  `(select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = '${def}')`;
const newest = (def: string): string =>
  `(select i.id from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = '${def}' order by i.id desc limit 1)`;
const clear = (...defs: string[]): string =>
  `delete from item where world_id = w and holder = 'player' and holder_uid = u and def in (${defs.map(q).join(', ')})`;
const last = (like: string): string =>
  `(select e.text from event e where e.world_id = w and e.uid = u and e.text like ${q(like)} order by e.n desc limit 1)`;
const markOfRow = (id: string): string => `coalesce((select mark::text from item where id = ${id}), 'none')`;
const craft = (r: string, uid = 'null'): string => `perform perform_craft(w, u, '${r}', jsonb_build_object('kind', 'item', 'uid', ${uid}))`;
const refused = (r: string): string => `coalesce(act_refusal(w, u, '${r}', jsonb_build_object('kind', 'item', 'uid', null)), 'ALLOWED')`;
const beast = (a: string): string => `perform act_perform(w, u, '${a}', jsonb_build_object('kind', 'creature', 'id', v_c))`;
const onItem = (a: string, id: string): string => `perform act_perform(w, u, '${a}', jsonb_build_object('kind', 'item', 'uid', ${id}))`;
const patchRefused = (id: string): string =>
  `coalesce(item_refusal(w, u, 'patch_item', jsonb_build_object('kind', 'item', 'uid', ${id})), 'ALLOWED')`;
/** What is given in a wood, where a recipe takes one. */
const WOODEN = new Set(['plank', 'timber', 'shaft', 'log']);
/** Give the inputs of a recipe, the wooden ones in `wood`, but for the ones named. */
const inputs = (recipe: string, wood = 'null', but: string[] = []): string =>
  (RECIPE_BY_ID.get(recipe)?.inputs ?? []).filter((i) => !but.includes(i.item))
    .map((i) => `perform give(w, u, '${i.item}', ${i.count ?? 1}, 30, ${WOODEN.has(i.item) ? wood : 'null'});`).join('\n  ');
/** Every skill check passes, or every one fails, until it is said otherwise. */
const checks = (pass: boolean): string =>
  `create or replace function skill_check(p_skill double precision, p_difficulty double precision,
     p_tool_ql double precision default 0, p_ease double precision default 0)
     returns boolean language sql as 'select ${pass}'`;
/** The dice put at these numbers, in turn, over and over; and taken off again. */
const dice = (...xs: number[]): string => `perform pg_temp.dice('${xs.join(',')}')`;
const nodice = 'perform pg_temp.nodice()';
/** The quality a pair of hands turns out, held still. */
const HANDS = 40;
const SPACE = 'between 4 and 15';
const jsonSql = (m: unknown): string => `${q(JSON.stringify(m))}::jsonb`;

/* What the dice are put at: either side of each perk's number. */
const SURE: Array<[string, string, string]> = [
  ['Sure Needle', 'make_sack', 'sack'],
  ['Sure Awl', 'make_leather_cap', 'leather_cap'],
  ['Sure Tan', 'tan_hide', 'leather'],
];
const RARE_AT = (RARITY_ODDS[0] + fx('Master Tailor', 'rare:make_wool_cap')) / 2;
const LYE = fx('Lye Saver', 'lye:tan_hide');
const CATCH = fx("Fisher's Friend", 'catch:fishing_net');
const NET_QL = 40;
/** A net's haul on the island, off the one number the dice are put at. */
const netHaul = (r: number, ql: number, mark = 1): number => {
  const haul = 1 + Math.floor(r * (1 + 4 * (0.3 + Math.min(100, ql) / 160)));
  if (mark === 1) return haul;
  const more = haul * mark;
  return Math.floor(more) + (r < more - Math.floor(more) ? 1 : 0);
};
const NET_DICE = [0.1, 0.3];
const CREEL_QL = 40;
const CREEL_AT = (creelOdds(CREEL_QL) + creelOdds(CREEL_QL) * fx("Fisher's Friend", 'catch:creel')) / 2;
const CREEL_ROLLS = 10;
const PATCH_DMG = 50;
const PATCH_SMALL = 10;
const SADDLE: Mark = { speed: fx('Saddler', 'speed:saddle') };
const YOKE: Mark = { speed: fx('Saddler', 'speed:yoke') };
const OWN_PACE = 1.2;
const LIGHT: Array<[string, number]> = [['cloth', 10], ['leather', 2], ['yarn', 10], ['hide', 1], ['plank', 3]];

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
/*
 * The dice: every random() the island rolls, from here to the transaction's
 * end, comes up the numbers given, in turn. A schema of its own, put first on
 * the path, since pg_catalog's own is found before anything that is not.
 */
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
-- A mount as quick as a mount may be, so that whatever its tack adds is past the cap.
create or replace function mount_speed(c creature) returns double precision language sql stable as 'select max_mount_speed()';

do $$
declare w uuid; u uuid; tx int; ty int; v_t text; v_u text; v_it bigint; v_row bigint; v_chest bigint; v_c int;
        v_p bigint; v_bed bigint; v_n int;
begin
  -- The suite's own island and its first body, a Tailor now, on flat grass.
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
  delete from item where world_id = w and holder in ('trap', 'furniture')
     and placed in (select id from placed where world_id = w and x ${SPACE} and y ${SPACE});
  delete from placed where world_id = w and x ${SPACE} and y ${SPACE};
  update creature set rider = null where world_id = w and rider = u;
  delete from creature where world_id = w and from_x between 4 and 16 and from_y between 4 and 16;
  delete from caller where uid = u;
  update player set way = null where world_id = w;
  update player set x = 9.5, y = 9.5, act = null, act_target = null, act_started = null, act_ends = null,
         act_left = null, act_goes = null, act_queue = '[]', craft_class = 'tailor', combat_class = null,
         class_mul = null, level_h = null, rested = 0, boons = '[]'::jsonb, body_at = now(), swim_at = now(),
         equipped = '{}'::jsonb, craft_from_stores = true, craft_spare_rare = false,
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
   where world_id = w and uid = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  insert into skill (world_id, uid, id, value)
    select w, u, s, 60 from unnest(array['tailoring', 'leatherworking', 'ropemaking', 'carpentry']) s
    on conflict (world_id, uid, id) do update set value = excluded.value;
  insert into skill (world_id, uid, id, value) values (w, u, 'fishing', 40)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  ${checks(true)};

  /* ---- Full Fleece: a woola shorn without it and with it. ---- */
  v_c := creature_spawn(w, 'woola', 10.5, 9.5, 'deed', now() - interval '3 hours', u);
  update creature set fleece = 1, hunger = 1, keeper = u, from_x = 10.5, from_y = 9.5, to_x = 10.5, to_y = 9.5,
         leg_at = now(), leg_ends = now(), settled_at = now() where world_id = w and id = v_c;
  perform give(w, u, 'carving_knife', 1, 40);
  perform pg_temp.hold(w, u, '{}');
  ${beast('shear')};
  v_t := ${count('wool')}::text;
  ${clear('wool')};
  update creature set fleece = 1 where world_id = w and id = v_c;
  ${hold('Full Fleece')};
  ${beast('shear')};
  insert into said values ('SHEAR', v_t || '|' || ${count('wool')} || '|' || coalesce(${last('You shear %')}, 'unsaid'));
  ${clear('wool')};
  delete from creature where world_id = w and id = v_c;

  /* ---- The spindle: Quick Spindle's time and Even Thread's third length. ---- */
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'spindle', 10, 9, 0, 0, 10.5, 9.5, 40, 'Pine', u);
  perform give(w, u, 'wool', 2, 30);
  perform pg_temp.hold(w, u, '{}');
  v_t := pg_temp.secs(w, u, 'spin_wool', jsonb_build_object('kind', 'item', 'uid', null));
  ${hold('Quick Spindle')};
  v_t := v_t || '|' || pg_temp.secs(w, u, 'spin_wool', jsonb_build_object('kind', 'item', 'uid', null));
  insert into said values ('SPIN', v_t);
  perform pg_temp.hold(w, u, '{}');
  ${craft('spin_wool')};
  v_t := ${count('yarn')}::text;
  ${clear('yarn', 'wool')};
  perform give(w, u, 'wool', 2, 30);
  ${hold('Even Thread')};
  ${craft('spin_wool')};
  insert into said values ('THREAD', v_t || '|' || ${count('yarn')} || '|' || ${count('wool')}
    || '|' || coalesce((select e.text from event e where e.world_id = w and e.uid = u and e.kind = 'event' order by e.n desc limit 1), 'unsaid'));
  ${clear('yarn', 'wool')};

  /* ---- The loom: Tight Weave's two yarn to a cloth. ---- */
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'loom', 8, 9, 0, 0, 8.5, 9.5, 40, 'Pine', u);
  perform give(w, u, 'yarn', 2, 30);
  perform pg_temp.hold(w, u, '{}');
  v_t := ${refused('weave_cloth')} || '#' || recipe_need(w, u, 'weave_cloth', 3);
  ${hold('Tight Weave')};
  v_t := v_t || '#' || ${refused('weave_cloth')} || '#' || recipe_need(w, u, 'weave_cloth', 3);
  ${craft('weave_cloth')};
  insert into said values ('WEAVE', v_t || '|' || ${count('yarn')} || ':' || ${count('cloth')});
  ${clear('yarn', 'cloth')};
  delete from placed where world_id = w and sub in ('spindle', 'loom') and x ${SPACE} and y ${SPACE};

  /* ---- Sure Needle, Sure Awl and Sure Tan: a failed check, the dice either side of each one's number. ---- */
  ${checks(false)};
  perform give(w, u, 'needle', 1, 40); perform give(w, u, 'awl', 1, 40);
${SURE.map(([name, recipe, makes], i) => `
  perform pg_temp.hold(w, u, '{}');
  ${inputs(recipe)}
  ${dice(0.99)};
  ${craft(recipe)};
  v_t := ${count(makes)}::text;
  ${nodice};
  ${clear(makes, 'bucket', ...(RECIPE_BY_ID.get(recipe)?.inputs ?? []).map((x) => x.item))};
  ${hold(name)};
  ${inputs(recipe)}
  ${dice(fx(name, `fail:${recipe}`))};
  ${craft(recipe)};
  v_t := v_t || ':' || ${count(makes)};
  ${nodice};
  ${clear(makes, 'bucket', ...(RECIPE_BY_ID.get(recipe)?.inputs ?? []).map((x) => x.item))};
  ${inputs(recipe)}
  ${dice(fx(name, `fail:${recipe}`) - 0.01)};
  ${craft(recipe)};
  insert into said values ('SURE${i}', v_t || ':' || ${count(makes)});
  ${nodice};
  ${clear(makes, 'bucket', ...(RECIPE_BY_ID.get(recipe)?.inputs ?? []).map((x) => x.item))};`).join('\n')}

  /* ---- Nothing Wasted: a failed sack, with the dice as high as they go under one. ---- */
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'cloth', 2, 30);
  ${dice(0.99)};
  ${craft('make_sack')};
  v_t := ${count('cloth')}::text;
  ${nodice};
  ${clear('cloth')};
  ${hold('Nothing Wasted')};
  perform give(w, u, 'cloth', 2, 30);
  ${dice(0.99)};
  ${craft('make_sack')};
  insert into said values ('SPARE', v_t || '|' || ${count('cloth')} || ':' || ${count('sack')}
    || '|' || coalesce(${last('Nothing that went into it%')}, 'unsaid'));
  ${nodice};
  ${clear('cloth', 'sack')};
  ${checks(true)};

  /* ---- Master Tailor: a wool cap with the dice between the plain odds and the perk's. ---- */
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'cloth', 2, 30);
  ${dice(RARE_AT, 0.5)};
  ${craft('make_wool_cap')};
  v_t := coalesce((select rare from item where id = ${newest('wool_cap')}), 'plain');
  ${nodice};
  ${clear('wool_cap', 'cloth')};
  ${hold('Master Tailor')};
  perform give(w, u, 'cloth', 2, 30);
  ${dice(RARE_AT, 0.5)};
  ${craft('make_wool_cap')};
  insert into said values ('RARE', v_t || '|' || coalesce((select rare from item where id = ${newest('wool_cap')}), 'plain'));
  ${nodice};
  ${clear('wool_cap', 'cloth')};

  /* ---- Sack Maker and Deep Pockets: the marks, and the room each bag then has. ---- */
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'cloth', 2, 30); perform give(w, u, 'leather', 9, 30); perform give(w, u, 'ribbon', 3, 30);
  ${craft('make_sack')}; ${craft('make_satchel')}; ${craft('make_backpack')};
  insert into said select 'BAGS0', string_agg(i.def || '=' || coalesce(i.mark::text, 'none') || '=' || bag_room(i), '#' order by i.def)
    from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def in ('sack', 'satchel', 'backpack');
  ${clear('sack', 'satchel', 'backpack')};
  ${hold('Sack Maker', 'Deep Pockets')};
  perform give(w, u, 'cloth', 2, 30); perform give(w, u, 'leather', 9, 30); perform give(w, u, 'ribbon', 3, 30);
  ${craft('make_sack')}; ${craft('make_satchel')}; ${craft('make_backpack')};
  insert into said select 'BAGS1', string_agg(i.def || '=' || coalesce(i.mark::text, 'none') || '=' || bag_room(i), '#' order by i.def)
    from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def in ('sack', 'satchel', 'backpack');
  ${clear('sack', 'satchel', 'backpack', 'cloth', 'leather', 'ribbon')};

  /* ---- Lye Saver: a hide tanned without it, and with the dice either side of its number. ---- */
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'hide', 1, 30); perform give(w, u, 'lye_bucket', 1, 30);
  ${craft('tan_hide')};
  v_t := ${count('leather')} || ':' || ${count('lye_bucket')} || ':' || ${count('bucket')};
  ${clear('leather', 'lye_bucket', 'bucket', 'hide')};
  ${hold('Lye Saver')};
  perform give(w, u, 'hide', 1, 30); perform give(w, u, 'lye_bucket', 1, 30);
  ${dice(LYE - 0.01)};
  ${craft('tan_hide')};
  v_t := v_t || '|' || ${count('leather')} || ':' || ${count('lye_bucket')} || ':' || ${count('bucket')}
    || '|' || coalesce(${last('There is enough left%')}, 'unsaid');
  ${nodice};
  ${clear('leather', 'lye_bucket', 'bucket', 'hide')};
  perform give(w, u, 'hide', 1, 30); perform give(w, u, 'lye_bucket', 1, 30);
  ${dice(LYE)};
  ${craft('tan_hide')};
  insert into said values ('LYE', v_t || '|' || ${count('leather')} || ':' || ${count('lye_bucket')} || ':' || ${count('bucket')});
  ${nodice};
  ${clear('leather', 'lye_bucket', 'bucket', 'hide')};

  /* ---- Saddler: a saddle made with it, on an orse at the cap, and off it again. ---- */
  ${hold('Saddler')};
  ${inputs('make_saddle', "'Pine'")}
  ${craft('make_saddle', newest('plank'))};
  v_t := ${markOfRow(newest('saddle'))};
  ${clear('leather', 'plank', 'ribbon', 'nail')};
  perform give(w, u, 'bridle', 1, 40);
  v_c := creature_spawn(w, 'orse', 10.5, 9.5, 'active', now() - interval '1 day', u);
  update creature set keeper = u, hunger = 1, from_x = 10.5, from_y = 9.5, to_x = 10.5, to_y = 9.5,
         leg_at = now(), leg_ends = now(), settled_at = now(), name = 'Greyfell' where world_id = w and id = v_c;
  perform pg_temp.hold(w, u, '{}');
  ${beast('tack_creature')};
  v_t := v_t || '|' || coalesce((select tack::text from creature where world_id = w and id = v_c), 'none')
    || '|' || ${count('saddle')} || ':' || ${count('bridle')};
  ${beast('mount_creature')};
  v_t := v_t || '|' || travel_speed(w, u) || ':' || (select tack_speed(c) from creature c where c.world_id = w and c.id = v_c)
    || '|' || coalesce((select (x->'tack')::text from jsonb_array_elements(rpc_creatures(w, 20)) x where (x->>'id')::int = v_c), 'unsent');
  ${beast('dismount_creature')};
  ${beast('untack_creature')};
  v_t := v_t || '|' || coalesce((select tack::text from creature where world_id = w and id = v_c), 'none')
    || '|' || (select string_agg(i.def || '=' || coalesce(i.mark::text, 'none'), '#' order by i.def)
               from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def in ('saddle', 'bridle'));
  -- And plain tack, on the same orse.
  ${clear('saddle', 'bridle')};
  perform give(w, u, 'saddle', 1, 40); perform give(w, u, 'bridle', 1, 40);
  ${beast('tack_creature')};
  ${beast('mount_creature')};
  insert into said values ('SADDLE', v_t || '|' || travel_speed(w, u) || ':' || (select tack_speed(c) from creature c where c.world_id = w and c.id = v_c)
    || '|' || max_mount_speed()
    || '|' || coalesce((select tack::text from creature where world_id = w and id = v_c), 'none'));
  ${beast('dismount_creature')};
  update creature set rider = null where world_id = w and rider = u;
  delete from creature where world_id = w and id = v_c;
  ${clear('saddle', 'bridle')};

  /* ---- And a yoke's pace into the cart it goes on, with the builder's own over it. ---- */
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'mallet', 1, 40);
  ${inputs('make_large_cart', "'Pine'", ['yoke'])}
  perform give(w, u, 'yoke', 2, 30, null, null, null, null, ${jsonSql(YOKE)});
  ${craft('make_large_cart', newest('plank'))};
  v_t := ${markOfRow(newest('large_cart'))};
  ${clear('large_cart')};
  ${patch('Saddler', { 'speed:large_cart': OWN_PACE })};
  ${hold('Saddler')};
  ${inputs('make_large_cart', "'Pine'", ['yoke'])}
  perform give(w, u, 'yoke', 2, 30, null, null, null, null, ${jsonSql(YOKE)});
  ${craft('make_large_cart', newest('plank'))};
  insert into said values ('YOKE', v_t || '|' || ${markOfRow(newest('large_cart'))});
  ${clear('large_cart', 'mallet', ...(RECIPE_BY_ID.get('make_large_cart')?.inputs ?? []).map((x) => x.item))};

  /* ---- Fisher's Friend: the marks, a net's haul and a creel's odds with the dice held. ---- */
  ${hold("Fisher's Friend")};
  ${inputs('make_net')}
  ${craft('make_net')};
  ${inputs('make_creel')}
  ${craft('make_creel')};
  insert into said values ('NETMARK', ${markOfRow(newest('fishing_net'))} || '|' || ${markOfRow(newest('creel'))});
  ${clear('fishing_net', 'creel', ...[...(RECIPE_BY_ID.get('make_net')?.inputs ?? []), ...(RECIPE_BY_ID.get('make_creel')?.inputs ?? [])].map((x) => x.item))};
  -- A pond, one tile off.
  perform land_set_height(w, 11, 9, -10); perform land_set_height(w, 12, 9, -10);
  perform land_set_height(w, 11, 10, -10); perform land_set_height(w, 12, 10, -10);
  perform pg_temp.hold(w, u, '{}');
${NET_DICE.map((r, i) => `
  perform give(w, u, 'fishing_net', 1, ${NET_QL});
  ${dice(r)};
  perform perform_fish(w, u, 'drag_net', jsonb_build_object('kind', 'tile', 'x', 11, 'y', 9));
  v_t := (select coalesce(sum(i.count), 0) from item i join fish_def f on f.id = i.def
           where i.world_id = w and i.holder = 'player' and i.holder_uid = u)::text;
  ${nodice};
  delete from item i using fish_def f where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = f.id;
  ${clear('fishing_net')};
  perform give(w, u, 'fishing_net', 1, ${NET_QL}, null, null, null, null, ${jsonSql({ catch: CATCH })});
  ${dice(r)};
  perform perform_fish(w, u, 'drag_net', jsonb_build_object('kind', 'tile', 'x', 11, 'y', 9));
  insert into said values ('NET${i}', v_t || ':' || (select coalesce(sum(i.count), 0) from item i join fish_def f on f.id = i.def
           where i.world_id = w and i.holder = 'player' and i.holder_uid = u));
  ${nodice};
  delete from item i using fish_def f where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = f.id;
  ${clear('fishing_net')};`).join('\n')}
  -- A marked creel set in the pond, baited and left, then the same creel plain.
  perform give(w, u, 'creel', 1, ${CREEL_QL}, null, null, null, null, ${jsonSql({ catch: fx("Fisher's Friend", 'catch:creel') })});
  perform perform_trap(w, u, 'set_trap', jsonb_build_object('kind', 'tile', 'x', 11, 'y', 9));
  select id into v_p from placed where world_id = w and kind = 'trap' and sub = 'creel' and x = 11 and y = 9 order by id desc limit 1;
  v_t := coalesce((select mark::text from placed where id = v_p), 'none') || '|' || ${count('creel')};
  update placed set bait = 'worm', bait_ql = 30, since = now() - make_interval(secs => ${CREEL_ROLLS} * trap_check_every()) where id = v_p;
  ${dice(CREEL_AT)};
  perform trap_settle(v_p);
  ${nodice};
  v_t := v_t || '|' || (select coalesce(sum(count), 0) from item where holder = 'trap' and placed = v_p);
  delete from item where holder = 'trap' and placed = v_p;
  update placed set mark = null, bait = 'worm', bait_ql = 30,
         since = now() - make_interval(secs => ${CREEL_ROLLS} * trap_check_every()) where id = v_p;
  ${dice(CREEL_AT)};
  perform trap_settle(v_p);
  ${nodice};
  v_t := v_t || ':' || (select coalesce(sum(count), 0) from item where holder = 'trap' and placed = v_p);
  delete from item where holder = 'trap' and placed = v_p;
  -- Taken up again, marked, and it comes back with its mark.
  update placed set mark = ${jsonSql({ catch: fx("Fisher's Friend", 'catch:creel') })}, bait = null, bait_ql = null where id = v_p;
  perform perform_trap(w, u, 'pick_up_trap', jsonb_build_object('kind', 'trap', 'id', v_p));
  insert into said values ('CREEL', v_t || '|' || ${markOfRow(newest('creel'))} || ':' || (select count(*) from placed where id = v_p));
  ${clear('creel', 'worm')};
  for tx in 11..12 loop for ty in 9..10 loop perform land_set_height(w, tx, ty, 40); end loop; end loop;

  /* ---- Light Pack: what the same pack weighs without it and with it. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${clear('carving_knife', 'needle', 'awl')};
  ${LIGHT.map(([id, n]) => `perform give(w, u, '${id}', ${n}, 30);`).join(' ')}
  v_t := carried_weight(w, u)::text;
  ${hold('Light Pack')};
  insert into said values ('LIGHT', v_t || '|' || carried_weight(w, u));
  ${clear(...LIGHT.map(([id]) => id))};

  /* ---- Workshop Reach: cloth in a chest five tiles off, for a sack; three for anything else. ---- */
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'chest', 14, 9, 0, 0, 14.5, 9.5, 40, 'Pine', u) returning id into v_chest;
  insert into item (world_id, holder, placed, def, ql, count) values (w, 'furniture', v_chest, 'cloth', 45, 2);
  perform give(w, u, 'needle', 1, 40);
  perform pg_temp.hold(w, u, '{}');
  v_t := ${refused('make_sack')};
  ${hold('Workshop Reach')};
  v_t := v_t || '#' || ${refused('make_sack')};
  perform set_config('wurm.pk', (select (class_mul->'fx')::text from player where world_id = w and uid = u), true);
  perform set_config('wurm.pk_act', 'make_sack', true);
  v_t := v_t || '|' || craft_reach();
  perform set_config('wurm.pk_act', 'make_planks', true);
  v_t := v_t || ':' || craft_reach();
  perform set_config('wurm.pk', '', true);
  perform set_config('wurm.pk_act', '', true);
  insert into said values ('REACH', v_t);
  delete from item where placed = v_chest;
  delete from placed where id = v_chest;
  ${clear('needle')};

  /* ---- Patch: refused without it; with it, what it takes and what it mends. ---- */
  v_it := give(w, u, 'cloth_tunic', 1, 40);
  update item set dmg = ${PATCH_DMG} where id = v_it;
  v_row := give(w, u, 'plank', 1, 40, 'Pine');
  update item set dmg = ${PATCH_DMG} where id = v_row;
  perform pg_temp.hold(w, u, '{}');
  v_t := ${patchRefused('v_it')};
  ${hold('Patch')};
  v_t := v_t || '#' || ${patchRefused('v_row')} || '#' || ${patchRefused('v_it')};
  perform give(w, u, 'cloth', 1, 30);
  v_t := v_t || '#' || ${patchRefused('v_it')};
  ${onItem('patch_item', 'v_it')};
  v_t := v_t || '|' || (select round(dmg::numeric, 2) || ':' || round(ql::numeric, 2) from item where id = v_it) || ':' || ${count('cloth')}
    || '|' || coalesce(${last('You patch the %')}, 'unsaid');
  update item set dmg = 0 where id = v_it;
  v_t := v_t || '|' || ${patchRefused('v_it')};
  -- A leather cap less worn than a patch mends, with leather.
  v_u := give(w, u, 'leather_cap', 1, 40)::text;
  update item set dmg = ${PATCH_SMALL} where id = v_u::bigint;
  perform give(w, u, 'leather', 1, 30);
  ${onItem('patch_item', 'v_u::bigint')};
  insert into said values ('PATCH', v_t || '|' || (select round(dmg::numeric, 2) from item where id = v_u::bigint) || ':' || ${count('leather')});
  ${clear('cloth_tunic', 'leather_cap', 'plank', 'cloth', 'leather')};

  /* ---- Tent: refused without it, built and set down with it, and a night in it beside a night in a bed. ---- */
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'needle', 1, 40);
  ${inputs('make_tent', "'Pine'")}
  v_t := ${refused('make_tent')};
  ${hold('Tent')};
  v_t := v_t || '#' || ${refused('make_tent')};
  ${craft('make_tent')};
  v_it := ${newest('tent')};
  v_t := v_t || '|' || ${count('tent')} || ':' || ${count('cloth')} || ':' || coalesce((select round(ql::numeric, 2)::text from item where id = v_it), 'none');
  perform act_perform(w, u, 'place_furniture', jsonb_build_object('kind', 'item', 'uid', v_it, 'x', 10, 'y', 10, 'sx', 0, 'sy', 0));
  select id into v_p from placed where world_id = w and sub = 'tent' order by id desc limit 1;
  v_t := v_t || '|' || coalesce((select sub || ':' || round(ql::numeric, 2) from placed where id = v_p), 'unplaced');
  insert into said values ('TENT', v_t);
  -- Noon, by moving the island's memory rather than waiting for it.
  update world set epoch = now() - make_interval(secs => 12 / 24.0 * day_seconds()) where id = w;
  insert into said values ('NOON', coalesce(act_refusal(w, u, 'sleep', jsonb_build_object('kind', 'furniture', 'id', v_p)), 'ALLOWED'));
  -- Ten at night, rested to nothing, and asleep in the tent.
  update world set epoch = now() - make_interval(secs => 22 / 24.0 * day_seconds()) where id = w;
  update player set rested = 0, rested_at = now() where world_id = w and uid = u;
  perform act_perform(w, u, 'sleep', jsonb_build_object('kind', 'furniture', 'id', v_p));
  v_t := (select round(rested::numeric, 4)::text from player where world_id = w and uid = u)
    || '|' || coalesce(${last('You sleep in the %')}, 'unsaid');
  -- And the same night in a bed of the same QL beside it.
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'bed', 8, 9, 0, 0, 8.5, 10, ${HANDS}, 'Pine', u) returning id into v_bed;
  update world set epoch = now() - make_interval(secs => 22 / 24.0 * day_seconds()) where id = w;
  update player set rested = 0, rested_at = now() where world_id = w and uid = u;
  perform act_perform(w, u, 'sleep', jsonb_build_object('kind', 'furniture', 'id', v_bed));
  insert into said values ('NIGHT', v_t || '|' || (select round(rested::numeric, 4)::text from player where world_id = w and uid = u)
    || '|' || coalesce(${last('You sleep in the %')}, 'unsaid'));
  delete from placed where id in (v_p, v_bed);
  ${clear('needle', 'tent')};

  /* ---- What the island says of a catch mark, and what it keeps of the old tree. ---- */
  insert into said values ('MARKSAYS', mark_says(${jsonSql({ catch: CATCH })}));
  insert into said values ('NODES', (select count(*) from class_node where id ~ '^tailor_')::text || ':'
    || (select count(*) from player_node where node ~ '^tailor_[0-9]_[0-9]$'));
end $$;

select k || E'\\t' || coalesce(v, '') from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const [k, ...v] = l.split('\t');
  return [k, v.join('\t')];
}));
const say = (k: string): string => said.get(k) ?? 'unsaid';
const json = (s: string | undefined): Record<string, number> | null => (!s || s === 'none' ? null : JSON.parse(s));
const sameMark = (a: Record<string, number> | null, b: Record<string, number> | null): boolean =>
  JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());
const nearMark = (a: Record<string, number> | null, b: Record<string, number>): boolean =>
  !!a && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([k, v]) => near(a[k] ?? NaN, v, 1e-9));

/* ---- The shears ---------------------------------------------------------------------------- */

const [shorn0, shorn1, shornSaid] = say('SHEAR').split('|');
const fleece = Math.max(1, Math.round(1 * SHEAR_WOOL));
const plusWool = fx('Full Fleece', 'plus:wool');
check(`a full fleece is ${fleece} wool without the perk`, shorn0 === String(fleece), shorn0);
check(`${P('Full Fleece').name}: ${plusWool} more with it, and said`, shorn1 === String(fleece + plusWool)
  && shornSaid.includes(`come away with ${fleece + plusWool} wool`), `${shorn1} | ${shornSaid}`);

/* ---- The spindle and the loom -------------------------------------------------------------- */

const [spinPlain, spinQuick] = say('SPIN').split('|').map((s) => Number(s.split(':')[0]));
check(`${P('Quick Spindle').name}: spinning wool takes ${fx('Quick Spindle', 'time:spin_wool')} of the time`,
  spinPlain > 0 && near(spinQuick / spinPlain, fx('Quick Spindle', 'time:spin_wool'), 1e-4), say('SPIN'));
const spin = RECIPE_BY_ID.get('spin_wool')!;
const [yarn0, yarn1, woolLeft, spunSaid] = say('THREAD').split('|');
const thread = fx('Even Thread', 'count:yarn');
check(`${P('Even Thread').name}: ${thread} yarn from the two wool, where it was ${spin.count}`,
  yarn0 === String(spin.count) && yarn1 === String(thread) && woolLeft === '0', say('THREAD'));
check('and the words say the count made, as the browser says them', spunSaid.startsWith(countSaid(spin.done, spin.count ?? 1, thread))
  && spunSaid !== spin.done, `${spunSaid} // ${countSaid(spin.done, spin.count ?? 1, thread)}`);
const [weaveAsk, weaveLeft] = say('WEAVE').split('|');
const [weaveNo, needPlain, weaveYes, needPerk] = weaveAsk.split('#');
const weave = RECIPE_BY_ID.get('weave_cloth')!;
const game = Game.create(2718);
game.setPerks(P('Tight Weave').fx);
const browserNeed = needOf(game, weave, weave.inputs[0]);
game.setPerks({});
check(`${P('Tight Weave').name}: two yarn are too few without it and enough with it`,
  weaveNo !== 'ALLOWED' && weaveYes === 'ALLOWED' && needPlain === String(weave.inputs[0].count) && needPerk === String(browserNeed)
    && browserNeed === 2, `${weaveAsk} (browser ${browserNeed})`);
check('and a cloth is woven from the two', weaveLeft === '0:1', weaveLeft);

/* ---- The bench ----------------------------------------------------------------------------- */

SURE.forEach(([name, recipe, makes], i) => {
  const [plain, at, under] = say(`SURE${i}`).split(':');
  check(`${name}: ${ITEM_DEFS[makes].name.toLowerCase()} whose check failed is lost without it, made with it with the dice at ${fx(name, `fail:${recipe}`)}, and lost with them under`,
    plain === '0' && at !== '0' && under === '0', say(`SURE${i}`));
});
const [sparePlain, spareKept, spareSaid] = say('SPARE').split('|');
check(`${P('Nothing Wasted').name}: a failed sack loses its cloth without it and keeps it with it, and says so`,
  sparePlain === '0' && spareKept === '2:0' && spareSaid === 'Nothing that went into it is lost.', say('SPARE'));
const [rarePlain, rarePerk] = say('RARE').split('|');
check(`${P('Master Tailor').name}: with the dice at ${RARE_AT}, a wool cap is plain without it and rare with it`,
  rarePlain === 'plain' && rarePerk === 'rare', say('RARE'));
const bags = (k: string): Record<string, { mark: Record<string, number> | null; room: number }> =>
  Object.fromEntries(say(k).split('#').map((s) => {
    const [def, mark, room] = s.split('=');
    return [def, { mark: json(mark), room: Number(room) }];
  }));
const bags0 = bags('BAGS0');
const bags1 = bags('BAGS1');
const roomOf = (id: string, mark: Mark | null): number =>
  bagRoom({ uid: 0, id, ql: HANDS, dmg: 0, count: 1, ...(mark ? { mark } : {}) } as Item);
check('a sack, a satchel and a backpack made without the perks hold what their makes hold, unmarked',
  ['sack', 'satchel', 'backpack'].every((b) => bags0[b]?.mark === null && bags0[b]?.room === (ITEM_DEFS[b].holds ?? 0)), say('BAGS0'));
const sackHold = fx('Sack Maker', 'hold:sack');
const pocket = fx('Deep Pockets', 'hold:satchel');
check(`${P('Sack Maker').name} and ${P('Deep Pockets').name}: marked ${sackHold} and ${pocket}, and each holds what the browser says a bag so marked holds`,
  sameMark(bags1.sack?.mark ?? null, { hold: sackHold }) && sameMark(bags1.satchel?.mark ?? null, { hold: pocket })
    && sameMark(bags1.backpack?.mark ?? null, { hold: fx('Deep Pockets', 'hold:backpack') })
    && ['sack', 'satchel', 'backpack'].every((b) => bags1[b]?.room === roomOf(b, bags1[b]?.mark ?? null))
    && bags1.sack?.room === Math.round((ITEM_DEFS.sack.holds ?? 0) * sackHold),
  `${say('BAGS1')} (browser ${['sack', 'satchel', 'backpack'].map((b) => roomOf(b, bags1[b]?.mark ?? null)).join(',')})`);
const [lyePlain, lyeKept, lyeSaid, lyeOver] = say('LYE').split('|');
check('a hide tanned without it takes the lye and gives back the bucket', lyePlain === '1:0:1', lyePlain);
check(`${P('Lye Saver').name}: with the dice under ${LYE}, the lye is still in the bucket, and said; at ${LYE}, it is spent`,
  lyeKept === '1:1:0' && lyeSaid === 'There is enough left in the bucket for another.' && lyeOver === '1:0:1', say('LYE'));

/* ---- Tack and yokes ------------------------------------------------------------------------ */

const saddle = say('SADDLE').split('|');
/** Tack as the island keeps it: each piece's mark, by the piece. */
const tackJson = (s: string | undefined): Record<string, Record<string, number>> | null => (!s || s === 'none' || s === 'unsent' ? null : JSON.parse(s));
const [saddleMade, tackOn, tackLeft, markedPace, tackSent, tackOff, tackBack, plainPace, cap, plainTack] = saddle;
check(`${P('Saddler').name}: a saddle made with it is marked ${SADDLE.speed}`, sameMark(json(saddleMade), SADDLE), saddleMade);
check('and its mark goes onto the orse with it, the plain bridle\'s none, and both out of the pack',
  sameMark(tackJson(tackOn)?.saddle ?? null, SADDLE) && Object.keys(tackJson(tackOn) ?? {}).length === 1 && tackLeft === '0:0', `${tackOn} ${tackLeft}`);
const [markedGoes, markedTack] = markedPace.split(':').map(Number);
const [plainGoes, plainTackSpeed] = plainPace.split(':').map(Number);
check(`and the orse goes ${SADDLE.speed} as fast past the cap (${MAX_MOUNT_SPEED}), where plain tack is at the cap`,
  near(markedGoes, Number(cap) * SADDLE.speed!, 1e-9) && near(plainGoes, Number(cap)) && Number(cap) === MAX_MOUNT_SPEED,
  `${markedPace} / ${plainPace} (cap ${cap})`);
check('and the island reckons the tack\'s pace as the browser does', near(markedTack, tackSpeed({ tack: { saddle: SADDLE } })) && plainTackSpeed === tackSpeed({}),
  `${markedTack} ${plainTackSpeed}`);
check('and a browser is handed the tack with the beast', sameMark(tackJson(tackSent)?.saddle ?? null, SADDLE), tackSent);
check('and stripped off, the orse forgets it and the saddle comes back marked, the bridle plain',
  tackOff === 'none' && tackBack === `bridle=none#saddle=${saddleMade}`, `${tackOff} | ${tackBack}`);
check('and plain tack carries nothing', plainTack === 'none', plainTack);
check('the browser reckons tack as the island does', tackSpeed({ tack: { saddle: SADDLE } }) === SADDLE.speed
  && tackSpeed({}) === 1 && tackSpeed({ tack: { saddle: SADDLE, bridle: { speed: 1.05 } } }) === SADDLE.speed, String(tackSpeed({ tack: { saddle: SADDLE } })));
const [cartPlainBuilder, cartOwn] = say('YOKE').split('|');
check('a large cart built on marked yokes carries their pace', nearMark(json(cartPlainBuilder), { speed: YOKE.speed! }), cartPlainBuilder);
check('and a builder\'s own pace multiplies it, not stands over it', nearMark(json(cartOwn), { speed: YOKE.speed! * OWN_PACE }), cartOwn);

/* ---- Nets and creels ----------------------------------------------------------------------- */

const [netMark, creelMark] = say('NETMARK').split('|');
check(`${P("Fisher's Friend").name}: a net and a creel made with it are marked ${CATCH}`,
  sameMark(json(netMark), { catch: CATCH }) && sameMark(json(creelMark), { catch: fx("Fisher's Friend", 'catch:creel') }), say('NETMARK'));
NET_DICE.forEach((r, i) => {
  const [plain, marked] = say(`NET${i}`).split(':').map(Number);
  check(`with the dice at ${r}, a QL ${NET_QL} net hauls ${netHaul(r, NET_QL)} plain and ${netHaul(r, NET_QL, CATCH)} marked, the share over a whole fish a chance at one more`,
    plain === netHaul(r, NET_QL) && marked === netHaul(r, NET_QL, CATCH), say(`NET${i}`));
});
const [, , creelCaught, creelBack] = say('CREEL').split('|');
const creelHold = TRAPS.creel.hold ?? 8;
const [creelSetMark, creelSetLeft] = say('CREEL').split('|');
check('a marked creel set in the water keeps its mark, and leaves the pack',
  sameMark(json(creelSetMark), { catch: fx("Fisher's Friend", 'catch:creel') }) && creelSetLeft === '0', `${creelSetMark} ${creelSetLeft}`);
check(`and with the dice at ${CREEL_AT.toFixed(4)}, between a QL ${CREEL_QL} creel's odds plain and marked, it fills where a plain one takes nothing`,
  creelCaught === `${Math.min(CREEL_ROLLS, creelHold)}:0`, creelCaught);
check('and taken up, it comes back with its mark', creelBack.startsWith('{') && sameMark(json(creelBack.split(':').slice(0, -1).join(':')), { catch: fx("Fisher's Friend", 'catch:creel') })
  && creelBack.endsWith(':0'), creelBack);
check('the island says a catch mark as the browser does', say('MARKSAYS') === markSays({ catch: CATCH }), `${say('MARKSAYS')} // ${markSays({ catch: CATCH })}`);

/* ---- The pack, the reach, the patch and the tent ------------------------------------------- */

const [lightPlain, lightPerk] = say('LIGHT').split('|').map(Number);
const halved = LIGHT.reduce((s, [id, n]) => s + ITEM_DEFS[id].weight * n * (1 - (P('Light Pack').fx[`weight:${id}`] ?? 1)), 0);
check(`${P('Light Pack').name}: cloth, leather, yarn and hide weigh half in the pack, and a plank what it did`,
  near(lightPlain - lightPerk, halved, 1e-6), `${lightPlain} → ${lightPerk} (${halved} off)`);
const [reachAsk, reachSaid] = say('REACH').split('|');
const [reachNo, reachYes] = reachAsk.split('#');
const reach = fx('Workshop Reach', 'reach:tailor');
check(`${P('Workshop Reach').name}: cloth five tiles off is out of reach for a sack without it, and in reach with it`,
  reachNo !== 'ALLOWED' && reachYes === 'ALLOWED', reachAsk);
check(`and it reaches ${reach} for tailoring and ${CRAFT_REACH} for anything else`, reachSaid === `${reach}:${CRAFT_REACH}`, reachSaid);
const [patchAsk, patched, patchSaid, patchWhole, patchLeather] = say('PATCH').split('|');
const [patchNo, patchPlank, patchNoCloth, patchYes] = patchAsk.split('#');
const mends = fx('Patch', 'patch_item');
check(`${P('Patch').name}: refused without it, in the browser's words`, patchNo === PATCH_PERK, patchNo);
check('and with it, a plank is not cloth, and a tunic wants cloth to mend it with until there is some',
  patchPlank === 'Only cloth or leather takes a patch.' && patchNoCloth === 'You need cloth to patch it with.' && patchYes === 'ALLOWED', patchAsk);
check(`a tunic at damage ${PATCH_DMG} comes off it at ${PATCH_DMG - mends}, for one cloth, and nothing off its QL`,
  patched === `${(PATCH_DMG - mends).toFixed(2)}:${HANDS.toFixed(2)}:0`, patched);
check('and a whole one has nothing to patch', patchWhole === 'There is nothing wrong with it.', patchWhole);
check(`a leather cap at ${PATCH_SMALL} is mended whole, with leather`, patchLeather === '0.00:0', patchLeather);
const [tentAsk, tentMade, tentPlaced] = say('TENT').split('|');
const [tentNo, tentYes] = tentAsk.split('#');
check(`${P('Tent').name}: refused without it in the browser's words, and allowed with it`,
  tentNo === RECIPE_PERK_SAYS.tent && tentYes === 'ALLOWED', tentAsk);
check('and made of its bill, and set down', tentMade === `1:0:${HANDS.toFixed(2)}` && tentPlaced === `tent:${HANDS.toFixed(2)}`, `${tentMade} | ${tentPlaced}`);
check('at noon it will not be slept in, as a bed will not', say('NOON').includes('broad daylight'), say('NOON'));
const [tentRest, tentSaid, bedRest, bedSaid] = say('NIGHT').split('|');
const ofBed = (furnitureDef('tent').bed ?? 0) / (furnitureDef('bed').bed ?? 1);
check(`and a night in it rests ${ofBed} of what the same night in a bed of its QL does`,
  Number(bedRest) > 0 && near(Number(tentRest) / Number(bedRest), ofBed, 1e-3) && tentSaid.startsWith('You sleep in the tent') && bedSaid.startsWith('You sleep in the bed'),
  say('NIGHT'));
check('and the Tailor\'s tree is gone', say('NODES') === '0:0', say('NODES'));

/* ---- the browser's half ------------------------------------------------------------------ */

game.setPerks({});
const tent = RECIPE_BY_ID.get('make_tent')!;
const sack = RECIPE_BY_ID.get('make_sack')!;
const planks = RECIPE_BY_ID.get('make_planks')!;
check('the browser refuses a tent without the perk in the island\'s words', recipeReason(tent, game) === tentNo, String(recipeReason(tent, game)));
game.setPerks(P('Tent').fx);
check('and not for the perk with it', recipeReason(tent, game) !== tentNo, String(recipeReason(tent, game)));
game.setPerks({});
const reachPlain = reachFor(game, sack);
game.setPerks(P('Workshop Reach').fx);
check('the browser\'s tailoring reaches as far as the island\'s', reachPlain === CRAFT_REACH && reachFor(game, sack) === reach && reachFor(game, planks) === CRAFT_REACH,
  `${reachPlain} → ${reachFor(game, sack)}, planks ${reachFor(game, planks)}`);
// The same pack, weighed in the browser.
game.setPerks({});
for (const it of [...game.inventory.items]) game.inventory.remove(it.uid, it.count);
for (const [id, n] of LIGHT) game.inventory.add(id, { count: n, ql: 30 });
const browserPlain = game.inventory.totalWeight();
game.setPerks(P('Light Pack').fx);
check('the browser weighs the same pack as the island does, with it and without', near(browserPlain - game.inventory.totalWeight(), lightPlain - lightPerk, 1e-6),
  `${browserPlain} → ${game.inventory.totalWeight()}`);
// A tunic patched in the browser.
for (const it of [...game.inventory.items]) game.inventory.remove(it.uid, it.count);
game.setPerks({});
const tunic = game.inventory.add('cloth_tunic', { count: 1, ql: HANDS });
tunic.dmg = PATCH_DMG;
game.inventory.add('cloth', { count: 1, ql: 30 });
const patchAct = ACTION_BY_ID.get('patch_item')!;
const patchTarget = { kind: 'item', uid: tunic.uid } as Target;
check('the browser refuses a patch without the perk as the island does', patchAct.check?.(patchTarget, game) === patchNo, String(patchAct.check?.(patchTarget, game)));
game.setPerks(P('Patch').fx);
check('and allows it with it', patchAct.check?.(patchTarget, game) === null, String(patchAct.check?.(patchTarget, game)));
patchAct.perform(patchTarget, game);
const browserPatchSaid = game.log[game.log.length - 1]?.text ?? '';
check('and mends it as the island does, in the same words', tunic.dmg === PATCH_DMG - mends && !game.inventory.has('cloth') && browserPatchSaid === patchSaid,
  `${tunic.dmg} ${browserPatchSaid} // ${patchSaid}`);
// A check that fails, held up by Sure Needle in the browser as on the island.
game.setPerks(P('Sure Needle').fx);
game.skillCheck = () => false;
game.rand = () => fx('Sure Needle', 'fail:make_sack');
const sureAt = game.sureCheck('make_sack', 'tailoring', sack.difficulty);
game.rand = () => fx('Sure Needle', 'fail:make_sack') - 0.01;
const sureUnder = game.sureCheck('make_sack', 'tailoring', sack.difficulty);
game.setPerks({});
game.rand = () => 0.99;
const surePlain = game.sureCheck('make_sack', 'tailoring', sack.difficulty);
check('the browser\'s failed check stands or falls on the same dice as the island\'s', sureAt && !sureUnder && !surePlain, `${sureAt} ${sureUnder} ${surePlain}`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Tailor's perks — ${ok.length} of ${ok.length}`);
