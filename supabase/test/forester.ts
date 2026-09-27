/**
 * The Forester's eighteen perks, each measured where its rule is.
 *
 * `perks.ts` holds the two sides to each other for every trade on perks --
 * the rows, the tiers, the fold, the choosing -- and this asks the one thing
 * that is the Forester's own: that each perk does what its note says, on the
 * island, with the dice taken out wherever they can be. A skill check is made
 * to pass or to fail outright, the quality a pair of hands turns out is held
 * still, a chance is put at one inside the transaction, and a roll the rule
 * makes on its own is made twice from the same seed, so that a go must show
 * the rule.
 *
 *   * Cut down: Clean Stroke's time, Heavy Swing's stroke fewer (and Look
 *     counting the strokes the same way), Sure Hatchet's cut that lands, and a
 *     felled pine's logs -- Choice Logs' quality, Rare Heartwood's rarity,
 *     Clean Drop's grass, Nest Finder's feathers and Honey Hunter's honey --
 *     and Kindling's shafts out of a bush;
 *   * the ground: Sprout Picker's sprouts, Nursery's planted age, Master
 *     Grafter's graft and its time, Fruitful's and Hedge Harvest's one more;
 *   * the three jobs, with every refusal: Coppice, Tap Resin once a day, and
 *     Clear Brush's three by three;
 *   * and the browser reads the same numbers where it asks or offers them:
 *     Woodsman's Stride's pace and path, and the jobs' menus.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, PLANTED_AGE, plantedAge, RESIN_TREE } from '../../src/game/actions';
import type { Target } from '../../src/game/actions';
import { perksOf, STRIDE, type PerkDef } from '../../src/game/perks';
import { pathOptions } from '../../src/game/player';
import { packTreeData, TILE_DEFS, TileType, TREE_AGES, TREE_DEFS } from '../../src/world/tiles';
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

const FORESTER = perksOf('forester');
const P = (name: string): PerkDef => {
  const p = FORESTER.find((x) => x.name === name);
  if (!p) throw new Error(`the Forester has no perk called ${name}`);
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
const at = (x: number, y: number): string => `jsonb_build_object('kind', 'tile', 'x', ${x}, 'y', ${y})`;
const act = (a: string, x: number, y: number): string => `perform act_perform(w, u, '${a}', ${at(x, y)})`;
const refused = (a: string, x: number, y: number): string => `coalesce(act_refusal(w, u, '${a}', ${at(x, y)}), 'ALLOWED')`;
const tree = (x: number, y: number, species: string, age: number): string =>
  `perform land_set_tile(w, ${x}, ${y}, tile_id('Tree')); perform land_set_data(w, ${x}, ${y}, tree_pack(${species}, ${age}));
   delete from tree_notch where world_id = w and x = ${x} and y = ${y}`;
const ground = (x: number, y: number, tile: string, data = 0): string =>
  `perform land_set_tile(w, ${x}, ${y}, tile_id('${tile}')); perform land_set_data(w, ${x}, ${y}, ${data})`;
const tileAt = (x: number, y: number): string => `(select name from tile_def where id = land_tile(w, ${x}, ${y}))`;
const ageAt = (x: number, y: number): string => `tree_age(land_data(w, ${x}, ${y}))`;
const PINE = 'resin_tree()';
const OAK = "(select id from tree_def where name = 'Oak')";
const APPLE = "(select id from tree_def where name = 'Apple')";
const age = (name: string): number => TREE_AGES.findIndex((a) => a.name === name);
const [YOUNG, MATURE, SAPLING, SHRIVELLED] = ['Young', 'Mature', 'Sapling', 'Shrivelled'].map(age);

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
create or replace function product_ql(p_skill double precision, p_tool_ql double precision default 0)
  returns double precision language sql as 'select ${HANDS}::double precision';

do $$
declare w uuid; u uuid; tx int; ty int; v_t text; v_u text; v_it bigint;
begin
  -- The suite's own island and its first body, a Forester now, on flat dirt.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  for tx in 0..15 loop for ty in 0..15 loop
    perform land_set_height(w, tx, ty, 40); perform land_set_dirt(w, tx, ty, 20);
    perform land_set_tile(w, tx, ty, tile_id('Dirt')); perform land_set_data(w, tx, ty, 0);
  end loop; end loop;
  delete from tree_notch where world_id = w and x between 0 and 15 and y between 0 and 15;
  delete from foraged where world_id = w and x between 0 and 15 and y between 0 and 15;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  delete from player_node where world_id = w and uid = u;
  delete from placed where world_id = w and x between 6 and 15 and y between 6 and 13;
  delete from caller where uid = u;
  update player set x = 9.5, y = 9.5, act = null, act_target = null, act_started = null, act_ends = null,
         act_left = null, act_goes = null, act_queue = '[]', craft_class = 'forester', combat_class = null,
         class_mul = null, level_h = null, rested = 0, boons = '[]'::jsonb, body_at = now(), swim_at = now(),
         equipped = '{}'::jsonb,
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
   where world_id = w and uid = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  insert into skill (world_id, uid, id, value)
    select w, u, s, 60 from unnest(array['woodcutting', 'forestry', 'foraging']) s
    on conflict (world_id, uid, id) do update set value = excluded.value;
  perform give(w, u, 'hatchet', 1, 100);
  perform give(w, u, 'sickle', 1, 100);
  perform give(w, u, 'carving_knife', 1, 100);
  ${checks(true)};

  /* ---- Clean Stroke and Master Grafter: a go as the doors start it. ---- */
  ${tree(10, 9, 'resin_tree()', MATURE)};
  perform pg_temp.hold(w, u, '{}');
  v_t := pg_temp.secs(w, u, 'cut_down', ${at(10, 9)});
  ${hold('Clean Stroke')};
  insert into said values ('STROKE', v_t || '|' || pg_temp.secs(w, u, 'cut_down', ${at(10, 9)}));
  perform give(w, u, 'sprout', 1, 50, 'Apple');
  perform pg_temp.hold(w, u, '{}');
  v_t := pg_temp.secs(w, u, 'graft', ${at(10, 9)});
  ${hold('Master Grafter')};
  insert into said values ('GRAFTTIME', v_t || '|' || pg_temp.secs(w, u, 'graft', ${at(10, 9)}));
  ${clear('sprout')};

  /* ---- Heavy Swing: a mature pine felled in a stroke fewer, and Look counting the same. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${tree(10, 9, PINE, MATURE)};
  ${act('cut_down', 10, 9)}; ${act('cut_down', 10, 9)};
  v_t := ${tileAt(10, 9)} || ':' || tree_cuts(w, 10, 9);
  ${hold('Heavy Swing')};
  ${tree(10, 9, PINE, MATURE)};
  ${act('cut_down', 10, 9)};
  v_u := examine_tile_text(w, 10, 9, u) || '#' || examine_tile_text(w, 10, 9);
  ${act('cut_down', 10, 9)};
  insert into said values ('SWING', v_t || '|' || ${tileAt(10, 9)} || '|' || v_u);
  insert into said select 'HITS', string_agg(tree_hits(w, u, hits)::text, ',' order by id) from tree_age_def;

  /* ---- Sure Hatchet: every check failing, and a stroke that lands with its failure put at none. ---- */
  ${checks(false)};
  ${patch('Sure Hatchet', { 'fail:cut_down': 0 })};
  perform pg_temp.hold(w, u, '{}');
  ${tree(10, 9, PINE, MATURE)};
  ${act('cut_down', 10, 9)};
  v_t := tree_cuts(w, 10, 9)::text;
  ${hold('Sure Hatchet')};
  ${act('cut_down', 10, 9)};
  insert into said values ('SURE', v_t || '|' || tree_cuts(w, 10, 9));
  ${checks(true)};

  /* ---- A young pine felled: its logs, the ground it leaves, and what comes down with it. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${clear('log', 'feather', 'honey')};
  ${tree(10, 9, PINE, YOUNG)};
  ${act('cut_down', 10, 9)}; ${act('cut_down', 10, 9)};
  v_t := (select ql || ':' || coalesce(rare, '-') from item where id = ${newest('log')}) || ':' || ${count('log')} || ':'
    || ${tileAt(10, 9)} || ':' || ${count('feather')} || ':' || ${count('honey')};
  ${patch('Rare Heartwood', { 'rare:cut_down': 1 })};
  ${patch('Nest Finder', { 'nest:chance': 1 })};
  ${patch('Honey Hunter', { 'honey:chance': 1 })};
  ${hold('Choice Logs', 'Rare Heartwood', 'Clean Drop', 'Nest Finder', 'Honey Hunter')};
  ${clear('log', 'feather', 'honey')};
  ${tree(10, 9, PINE, YOUNG)};
  ${act('cut_down', 10, 9)}; ${act('cut_down', 10, 9)};
  insert into said values ('FELL', v_t || '|' || (select ql || ':' || coalesce(rare, '-') from item where id = ${newest('log')}) || ':'
    || ${count('log')} || ':' || ${tileAt(10, 9)} || ':' || ${count('feather')} || ':' || ${count('honey')}
    || ':' || (select ql from item where id = ${newest('feather')}) || ':' || (select ql from item where id = ${newest('honey')})
    || '|' || coalesce(${last('The young pine comes down.%')}, 'unsaid'));

  /* ---- Kindling: a bush cut down gives shafts. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${clear('shaft')};
  ${ground(10, 9, 'Bush')};
  ${act('cut_down', 10, 9)};
  v_t := ${count('shaft')} || ':' || ${tileAt(10, 9)};
  ${hold('Kindling')};
  ${ground(10, 9, 'Bush')};
  ${act('cut_down', 10, 9)};
  insert into said values ('KINDLING', v_t || '|' || ${count('shaft')} || ':' || ${tileAt(10, 9)} || ':'
    || (select ql from item where id = ${newest('shaft')}) || '|' || coalesce(${last('You trim % out of it.%')}, 'unsaid'));

  /* ---- Sprout Picker: every check failing, and two sprouts all the same. ---- */
  ${checks(false)};
  perform pg_temp.hold(w, u, '{}');
  ${clear('sprout')};
  ${tree(10, 9, PINE, MATURE)};
  ${act('pick_sprout', 10, 9)};
  v_t := ${count('sprout')}::text;
  ${hold('Sprout Picker')};
  ${act('pick_sprout', 10, 9)};
  insert into said values ('SPROUTS', v_t || '|' || ${count('sprout')} || '|' || coalesce(${last('You pick % sprouts.')}, 'unsaid'));
  ${checks(true)};

  /* ---- Nursery: a sprout planted comes up further on. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${clear('sprout')};
  ${ground(10, 9, 'Grass')};
  perform give(w, u, 'sprout', 1, 50, 'Pine');
  ${act('plant', 10, 9)};
  v_t := ${tileAt(10, 9)} || ':' || ${ageAt(10, 9)};
  ${hold('Nursery')};
  ${ground(10, 9, 'Grass')};
  perform give(w, u, 'sprout', 1, 50, 'Pine');
  ${act('plant', 10, 9)};
  insert into said values ('NURSERY', v_t || '|' || ${tileAt(10, 9)} || ':' || ${ageAt(10, 9)} || '|'
    || coalesce(${last('You plant the pine sprout.%')}, 'unsaid'));
  insert into said select 'PLANTED', string_agg(planted_age(n)::text, ',' order by n) from generate_series(0, 3) n;

  /* ---- Master Grafter: every check failing, and the graft takes. ---- */
  ${checks(false)};
  perform pg_temp.hold(w, u, '{}');
  ${clear('sprout')};
  ${tree(10, 9, OAK, MATURE)};
  perform give(w, u, 'sprout', 1, 50, 'Apple');
  ${act('graft', 10, 9)};
  v_t := (select name from tree_def where id = tree_species(land_data(w, 10, 9)));
  ${hold('Master Grafter')};
  perform give(w, u, 'sprout', 1, 50, 'Apple');
  ${act('graft', 10, 9)};
  insert into said values ('GRAFT', v_t || '|' || (select name from tree_def where id = tree_species(land_data(w, 10, 9))));
  ${checks(true)};

  /* ---- Fruitful and Hedge Harvest: the same roll twice, and one more with the perk. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${clear('apple')};
  ${tree(10, 9, APPLE, MATURE)};
  delete from foraged where world_id = w and x = 10 and y = 9;
  perform setseed(0.25);
  ${act('pick_fruit', 10, 9)};
  v_t := ${count('apple')}::text;
  ${clear('apple')};
  ${hold('Fruitful')};
  delete from foraged where world_id = w and x = 10 and y = 9;
  perform setseed(0.25);
  ${act('pick_fruit', 10, 9)};
  insert into said values ('FRUIT', v_t || '|' || ${count('apple')});
  perform pg_temp.hold(w, u, '{}');
  ${clear('rose_petals')};
  ${ground(10, 9, 'Bush')};
  delete from foraged where world_id = w and x = 10 and y = 9;
  perform setseed(0.25);
  ${act('harvest_bush', 10, 9)};
  v_t := ${count('rose_petals')}::text;
  ${clear('rose_petals')};
  ${hold('Hedge Harvest')};
  delete from foraged where world_id = w and x = 10 and y = 9;
  perform setseed(0.25);
  ${act('harvest_bush', 10, 9)};
  insert into said values ('HEDGE', v_t || '|' || ${count('rose_petals')});

  /* ---- Coppice: every refusal, and a mature pine back to young for its logs, standing. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${tree(10, 9, PINE, MATURE)};
  v_t := ${refused('coppice', 10, 9)};
  ${hold('Coppice')};
  ${tree(10, 9, PINE, YOUNG)};
  v_t := v_t || '#' || ${refused('coppice', 10, 9)};
  ${tree(10, 9, PINE, SHRIVELLED)};
  v_t := v_t || '#' || ${refused('coppice', 10, 9)};
  ${ground(10, 9, 'Grass')};
  v_t := v_t || '#' || ${refused('coppice', 10, 9)};
  ${tree(10, 9, PINE, MATURE)};
  perform tree_notch(w, 10, 9, 1);
  v_t := v_t || '#' || ${refused('coppice', 10, 9)};
  ${clear('log')};
  ${act('coppice', 10, 9)};
  insert into said values ('COPPICE', v_t || '|' || ${tileAt(10, 9)} || ':' || ${ageAt(10, 9)} || ':' || tree_cuts(w, 10, 9)
    || ':' || ${count('log')} || ':' || (select ql from item where id = ${newest('log')})
    || '|' || coalesce(${last('You cut the mature pine back to the stool%')}, 'unsaid'));

  /* ---- Tap Resin: every refusal, a pine tapped, refused the rest of the day, and again at dawn. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${tree(10, 9, PINE, MATURE)};
  v_t := ${refused('tap_resin', 10, 9)};
  ${hold('Tap Resin')};
  ${tree(10, 9, OAK, MATURE)};
  v_t := v_t || '#' || ${refused('tap_resin', 10, 9)};
  ${tree(10, 9, PINE, SAPLING)};
  v_t := v_t || '#' || ${refused('tap_resin', 10, 9)};
  ${tree(10, 9, PINE, SHRIVELLED)};
  v_t := v_t || '#' || ${refused('tap_resin', 10, 9)};
  ${ground(10, 9, 'Grass')};
  v_t := v_t || '#' || ${refused('tap_resin', 10, 9)};
  ${tree(10, 9, PINE, MATURE)};
  delete from foraged where world_id = w and x = 10 and y = 9;
  ${clear('tar')};
  v_t := v_t || '#' || ${refused('tap_resin', 10, 9)};
  ${act('tap_resin', 10, 9)};
  v_u := ${count('tar')} || ':' || (select ql from item where id = ${newest('tar')}) || '#' || ${refused('tap_resin', 10, 9)};
  update foraged set at = tree_last_dawn() - interval '1 second' where world_id = w and x = 10 and y = 9 and kind = 'resin';
  insert into said values ('RESIN', v_t || '|' || v_u || '#' || ${refused('tap_resin', 10, 9)}
    || '|' || coalesce(${last("You cut the pine's bark%")}, 'unsaid'));

  /* ---- Clear Brush: the bushes and reeds in the three by three, and nothing else. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${ground(10, 10, 'Bush')};
  v_t := ${refused('clear_brush', 10, 10)};
  ${hold('Clear Brush')};
  ${ground(9, 10, 'Reed')}; ${ground(11, 11, 'Bush')}; ${ground(11, 9, 'Reed')}; ${ground(10, 9, 'Grass')}; ${ground(12, 10, 'Bush')};
  v_t := v_t || '#' || ${refused('clear_brush', 10, 9)} || '#' || ${refused('clear_brush', 10, 10)};
  ${act('clear_brush', 10, 10)};
  insert into said values ('BRUSH', v_t || '|' || ${tileAt(10, 10)} || ':' || ${tileAt(9, 10)} || ':' || ${tileAt(11, 11)} || ':'
    || ${tileAt(11, 9)} || ':' || ${tileAt(10, 9)} || ':' || ${tileAt(12, 10)} || ':' || ${tileAt(9, 9)}
    || '|' || coalesce(${last('You clear the brush off%')}, 'unsaid'));

  /* ---- The three jobs as the island has them, and the one tree resin comes from. ---- */
  insert into said select 'JOBS', string_agg(id || ':' || base_time || ':' || coalesce(skill, '-') || ':' || coalesce(tool, '-')
    || ':' || coalesce(difficulty::text, '-') || ':' || ground_action(id), ',' order by id)
    from action_def where id in ('coppice', 'tap_resin', 'clear_brush');
  insert into said values ('RESINTREE', resin_tree()::text);
end $$;

select k || E'\\t' || coalesce(v, '') from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const [k, ...v] = l.split('\t');
  return [k, v.join('\t')];
}));
const say = (k: string): string => said.get(k) ?? 'unsaid';
const pine = TREE_DEFS[RESIN_TREE].name.toLowerCase();

/* ---- Cut down --------------------------------------------------------------------------- */

const [strokeA, strokeB] = say('STROKE').split('|').map((s) => Number(s.split(':')[0]));
check(`${P('Clean Stroke').name}: a stroke of Cut down takes ${P('Clean Stroke').fx['time:cut_down']} of the time`,
  near(strokeB / strokeA, P('Clean Stroke').fx['time:cut_down'], 1e-3), say('STROKE'));
const [swingPlain, swingHeavy, swingLook] = say('SWING').split('|');
const [lookMine, lookAnyone] = swingLook.split('#');
check(`${P('Heavy Swing').name}: two strokes leave a mature pine standing without it, and fell it with it`,
  swingPlain === 'Tree:2' && swingHeavy === 'Stump', say('SWING'));
check('and Look counts the strokes as the one looking would fell it in',
  lookMine.includes('It has 1 of 2 strokes in it.') && lookAnyone.includes('It has 1 of 3 strokes in it.'), swingLook);
check('and every stage comes down in a stroke fewer, never under one, as the note says',
  say('HITS') === TREE_AGES.map((a) => Math.max(1, a.hits - P('Heavy Swing').fx['fewer:cut_down'])).join(','), say('HITS'));
check(`${P('Sure Hatchet').name}: with every check failing, the stroke glances off without it and lands with it (its failure put at none)`,
  say('SURE') === '0|1', say('SURE'));

const [fellPlain, fellPerks, fellSaid] = say('FELL').split('|');
const [plainQl, plainRare, plainLogs, plainTile, plainFeathers, plainHoney] = fellPlain.split(':');
const [perkQl, perkRare, perkLogs, perkTile, perkFeathers, perkHoney, featherQl, honeyQl] = fellPerks.split(':');
check('a young pine felled without them: plain logs at the hands\' QL, a stump, and nothing else',
  Number(plainQl) === HANDS && plainRare === '-' && Number(plainLogs) === TREE_AGES[YOUNG].logs && plainTile === 'Stump'
    && plainFeathers === '0' && plainHoney === '0', fellPlain);
check(`${P('Choice Logs').name}: the logs come up at ${P('Choice Logs').fx['ql:cut_down']} times the QL`,
  near(Number(perkQl), HANDS * P('Choice Logs').fx['ql:cut_down'], 1e-4), fellPerks);
check(`${P('Rare Heartwood').name}: the logs rare, with its chance put at one`, ['rare', 'supreme', 'fantastic'].includes(perkRare)
  && Number(perkLogs) === TREE_AGES[YOUNG].logs, fellPerks);
check(`${P('Clean Drop').name}: grass where the tree stood, and it says so`,
  perkTile === 'Grass' && fellSaid.includes('The ground is clear where it stood.'), fellSaid);
check(`${P('Nest Finder').name}: ${P('Nest Finder').fx['nest:feathers']} feathers at the logs' QL, with its chance put at one`,
  Number(perkFeathers) === P('Nest Finder').fx['nest:feathers'] && near(Number(featherQl), Number(perkQl), 1e-4), fellPerks);
check(`${P('Honey Hunter').name}: ${P('Honey Hunter').fx['honey:count']} honey at the logs' QL, with its chance put at one`,
  Number(perkHoney) === P('Honey Hunter').fx['honey:count'] && near(Number(honeyQl), Number(perkQl), 1e-4), fellPerks);
const [kindPlain, kindPerk, kindSaid] = say('KINDLING').split('|');
check(`${P('Kindling').name}: a bush cut down gives nothing without it and ${P('Kindling').fx['bush:shaft']} shafts with it`,
  kindPlain === '0:Grass' && kindPerk === `${P('Kindling').fx['bush:shaft']}:Grass:${HANDS}`
    && kindSaid === `You trim ${numberWord(P('Kindling').fx['bush:shaft'])} straight shafts out of it. (QL ${HANDS.toFixed(1)})`,
  say('KINDLING'));

/* ---- The ground -------------------------------------------------------------------------- */

const [sproutsPlain, sproutsPerk, sproutsSaid] = say('SPROUTS').split('|');
check(`${P('Sprout Picker').name}: with every check failing, no sprout without it and ${P('Sprout Picker').fx['count:sprout']} with it`,
  sproutsPlain === '0' && Number(sproutsPerk) === P('Sprout Picker').fx['count:sprout']
    && sproutsSaid === `You pick ${numberWord(P('Sprout Picker').fx['count:sprout'])} ${pine} sprouts.`,
  say('SPROUTS'));
const [nurseryPlain, nurseryPerk, nurserySaid] = say('NURSERY').split('|');
const grown = plantedAge(P('Nursery').fx['grown:plant']);
check(`${P('Nursery').name}: a sprout comes up ${TREE_AGES[PLANTED_AGE].name.toLowerCase()} without it and ${TREE_AGES[grown].name.toLowerCase()} with it`,
  nurseryPlain === `Tree:${PLANTED_AGE}` && nurseryPerk === `Tree:${grown}`
    && nurserySaid.endsWith(`It comes up a ${TREE_AGES[grown].name.toLowerCase()} ${pine}.`), say('NURSERY'));
check('and the stage a planting comes up at is the browser\'s, step by step',
  say('PLANTED') === [0, 1, 2, 3].map(plantedAge).join(','), say('PLANTED'));
check(`${P('Master Grafter').name}: with every check failing, the graft does not take without it and takes with it`,
  say('GRAFT') === 'Oak|Apple', say('GRAFT'));
const [graftA, graftB] = say('GRAFTTIME').split('|').map((s) => Number(s.split(':')[0]));
check('and a graft takes its share of the time', near(graftB / graftA, P('Master Grafter').fx['time:graft'], 1e-3), say('GRAFTTIME'));
const [fruitPlain, fruitPerk] = say('FRUIT').split('|').map(Number);
check(`${P('Fruitful').name}: the same pick from the same roll gives one more with it`,
  fruitPlain > 0 && fruitPerk === fruitPlain + 1, say('FRUIT'));
const [hedgePlain, hedgePerk] = say('HEDGE').split('|').map(Number);
check(`${P('Hedge Harvest').name}: the same harvest from the same roll gives one more with it`,
  hedgePlain > 0 && hedgePerk === hedgePlain + 1, say('HEDGE'));

/* ---- The three jobs ---------------------------------------------------------------------- */

const [copRefused, copAfter, copSaid] = say('COPPICE').split('|');
const [copNoPerk, copYoung, copDead, copGrass, copOk] = copRefused.split('#');
check(`${P('Coppice').name}: refused without the perk, a young pine, a dead one and bare ground, each in its own words`,
  copNoPerk === 'That wants a Forester who has learned to coppice.' && copYoung === `The ${pine} is too young to coppice. Let it grow.`
    && copDead === 'There is no coppicing a dead tree.' && copGrass === 'There is no tree here to coppice.' && copOk === 'ALLOWED',
  copRefused);
const [copTile, copAge, copCuts, copLogs, copQl] = copAfter.split(':');
check(`and a mature pine is cut back to young, notch and all, for ${P('Coppice').fx.coppice} logs, and stays standing`,
  copTile === 'Tree' && Number(copAge) === PLANTED_AGE && copCuts === '0' && Number(copLogs) === P('Coppice').fx.coppice
    && Number(copQl) === HANDS && copSaid.endsWith(`It stands as a ${TREE_AGES[PLANTED_AGE].name.toLowerCase()} ${pine} now.`),
  `${copAfter} | ${copSaid}`);
const [resRefused, resAfter, resSaid] = say('RESIN').split('|');
const [resNoPerk, resOak, resSapling, resDead, resGrass, resOk] = resRefused.split('#');
check(`${P('Tap Resin').name}: refused without the perk, an oak, a sapling, a dead pine and bare ground, each in its own words`,
  resNoPerk === 'That wants a Forester who has learned to tap resin.' && resOak === `Only a ${pine} gives resin.`
    && resSapling === `The ${pine} is too small to tap. Let it grow.` && resDead === `A dead ${pine} gives no resin.`
    && resGrass === 'There is no tree here to tap.' && resOk === 'ALLOWED', resRefused);
const [resGot, resAgain, resDawn] = resAfter.split('#');
check(`and a pine gives ${P('Tap Resin').fx.tap_resin} tar, is refused the rest of the day, and gives again once the woods have turned`,
  resGot === `${P('Tap Resin').fx.tap_resin}:${HANDS}` && resAgain === `This ${pine} has given its resin today. It runs again at dawn.`
    && resDawn === 'ALLOWED' && resSaid.startsWith(`You cut the ${pine}'s bark and collect ${P('Tap Resin').fx.tap_resin} tar from it.`),
  `${resAfter} | ${resSaid}`);
const [brushRefused, brushAfter, brushSaid] = say('BRUSH').split('|');
const [brushNoPerk, brushGrass, brushOk] = brushRefused.split('#');
check(`${P('Clear Brush').name}: refused without the perk and on ground with no brush, each in its own words`,
  brushNoPerk === 'That wants a Forester who has learned to clear brush.' && brushGrass === 'There is no brush here to clear.'
    && brushOk === 'ALLOWED', brushRefused);
check(`and every bush and reed in the ${2 * P('Clear Brush').fx.clear_brush + 1}×${2 * P('Clear Brush').fx.clear_brush + 1} is cleared -- bushes to grass, reeds to dirt -- and nothing past it`,
  brushAfter === 'Grass:Dirt:Grass:Dirt:Grass:Bush:Dirt' && brushSaid === 'You clear the brush off 4 tiles.', `${brushAfter} | ${brushSaid}`);
check('the three jobs are the browser\'s, and the ground\'s',
  say('JOBS') === ['clear_brush', 'coppice', 'tap_resin'].map((id) => {
    const d = ACTION_BY_ID.get(id)!;
    return `${id}:${d.baseTime}:${d.skill ?? '-'}:${d.tool ?? '-'}:${d.difficulty ?? '-'}:true`;
  }).join(','), say('JOBS'));
check('and resin comes from the browser\'s tree', Number(say('RESINTREE')) === RESIN_TREE, say('RESINTREE'));

/* ---- the browser's half ------------------------------------------------------------------ */

const game = Game.create(2718);
const stride = P("Woodsman's Stride").fx;
game.setPerks(stride);
check(`${P("Woodsman's Stride").name}: the browser walks every tile it names at full pace, and nothing else faster`,
  STRIDE.every((t) => near((game.player.tilePace[t] ?? 1) * TILE_DEFS[t].speed, 1, 1e-9))
    && Object.keys(game.player.tilePace).length === STRIDE.length,
  JSON.stringify(game.player.tilePace));
game.world.setTile(5, 5, TileType.Bush);
const withPace = pathOptions(game.world, undefined, 1, 0, game.player.tilePace).cost(5, 5);
const without = pathOptions(game.world).cost(5, 5);
check('and a path through a bush costs what the pace takes off it',
  near(without / withPace, 1 / TILE_DEFS[TileType.Bush].speed, 1e-9), `${withPace} against ${without}`);
game.setPerks({});
check('and without it the pace is the tile\'s own', Object.keys(game.player.tilePace).length === 0);

// The jobs' menus, asked the same questions as the island.
const tile = (x: number, y: number): Target => ({ kind: 'tile', x, y } as Target);
const ask = (id: string, x: number, y: number): string => ACTION_BY_ID.get(id)!.check?.(tile(x, y), game) ?? 'ALLOWED';
for (const tool of ['hatchet', 'sickle', 'carving_knife']) if (!game.inventory.has(tool)) game.inventory.add(tool, { count: 1, ql: 50 });
game.world.setTile(6, 6, TileType.Tree, packTreeData(RESIN_TREE, MATURE));
check('the browser refuses the three jobs without the perks in the island\'s words',
  ask('coppice', 6, 6) === copNoPerk && ask('tap_resin', 6, 6) === resNoPerk && ask('clear_brush', 5, 5) === brushNoPerk);
game.setPerks({ ...P('Coppice').fx, ...P('Tap Resin').fx, ...P('Clear Brush').fx });
game.world.setTile(6, 6, TileType.Tree, packTreeData(RESIN_TREE, YOUNG));
const bYoung = ask('coppice', 6, 6);
game.world.setTile(6, 6, TileType.Tree, packTreeData(RESIN_TREE, SHRIVELLED));
const bDead = ask('coppice', 6, 6);
const bDeadTap = ask('tap_resin', 6, 6);
game.world.setTile(6, 6, TileType.Tree, packTreeData(RESIN_TREE, SAPLING));
const bSapling = ask('tap_resin', 6, 6);
game.world.setTile(6, 6, TileType.Tree, packTreeData(TREE_DEFS.findIndex((d) => d.name === 'Oak'), MATURE));
const bOak = ask('tap_resin', 6, 6);
game.world.setTile(6, 6, TileType.Grass);
const bGrass = [ask('coppice', 6, 6), ask('tap_resin', 6, 6), ask('clear_brush', 6, 6)];
check('and with them, a young pine, a dead one, a sapling, an oak and bare ground, in the island\'s words',
  bYoung === copYoung && bDead === copDead && bDeadTap === resDead && bSapling === resSapling && bOak === resOak
    && bGrass[0] === copGrass && bGrass[1] === resGrass && bGrass[2] === brushGrass,
  [bYoung, bDead, bDeadTap, bSapling, bOak, ...bGrass].join(' / '));
game.world.setTile(6, 6, TileType.Tree, packTreeData(RESIN_TREE, MATURE));
check('and a mature pine may be coppiced and tapped, and a bush cleared',
  ask('coppice', 6, 6) === 'ALLOWED' && ask('tap_resin', 6, 6) === 'ALLOWED' && ask('clear_brush', 5, 5) === 'ALLOWED');
game.markTapped(6, 6);
check('and a pine tapped today is refused in the island\'s words', ask('tap_resin', 6, 6) === resAgain, ask('tap_resin', 6, 6));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Forester's perks — ${ok.length} of ${ok.length}`);
