/**
 * The Power path on its tiers (`src/game/meditation.ts`,
 * `love_and_power_move_onto_tiers.sql`): every one of its fifteen picks, on
 * the island and in the browser. What this asks:
 *
 *   * somebody who walked Power on its steps keeps the path, keeps none of
 *     the steps (no Strong back, Hard hands or Ironhide by a step, no Fury),
 *     and takes a pick at each tier their meditation has reached, refused at
 *     the others in the same words on both sides;
 *   * each technique costs its Calm and rests, and is refused short of Calm
 *     and while it rests; and does what it says -- Second Wind fills the wind,
 *     Deep Lungs makes deep water free for its minutes, Shrug stops every
 *     wound bleeding and takes the venom out (and is refused, for nothing,
 *     with none), Surge puts its share on a walk and lets nothing slow it,
 *     Unbroken makes work and water free;
 *   * each discipline does what it says where its rule is: Strong Back on a
 *     burden (the browser's alone, as it always was), Long Stride on a walk,
 *     Sure Feet and Sure Fall on a step between tiles, Hard Breath on deep
 *     water, Ironhide on a blow (counted on the island now, where it was not),
 *     Unshaken on a heavy blow, Pack Mule on a load, Hard to Kill on a killing
 *     blow, once in its hour, and Enduring on hunger and thirst.
 *
 * Every roll is seeded: `setseed` on the island and `mulberry32` here.
 */
import { execFileSync } from 'node:child_process';
// `game` first: the root of the module graph, so nothing below comes out half-built.
import { Game } from '../../src/game/game';
import {
  calmRefusal, deepLungsSaid, hardToKillSaid, MEDITATION, PATH_PICK_BY_ID, PATH_TIER_AT, PATHS, pathPickRefusal, picksOf, SECOND_WIND_SAID,
  SHRUG_NONE, SHRUG_SAID, surgeSaid, unbrokenSaid, type PathPickDef,
} from '../../src/game/meditation';
import { ARMOUR_BY_ID, ARMOUR_CLASSES, HIT_LOCATIONS, pieceSoak } from '../../src/game/gear';
import { ARMOUR_VS, HEAVY_HIT } from '../../src/game/fight';
import { groundStep, MAX_STEP, CLIMB_PER_LEVEL } from '../../src/game/player';
import { HUNGER_RATE, SWIM_WIND } from '../../src/game/body';
import { bodyForward } from '../../src/net/felt';
import { TileType } from '../../src/world/tiles';
import type { World } from '../../src/world/world';
import type { Slot } from '../../src/game/gear';
import { mulberry32 } from '../../src/world/noise';

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
const near = (a: number, b: number, by = 1e-6): boolean => Math.abs(a - b) <= by * Math.max(1, Math.abs(b));
const q = (v: string): string => `'${v.replace(/'/g, "''")}'`;
const P = (id: string): PathPickDef => {
  const k = PATH_PICK_BY_ID.get(`power_${id}`);
  if (!k) throw new Error(`no pick power_${id}`);
  return k;
};
const POWER = PATH_TIER_AT.flatMap((_, i) => picksOf('power', i + 1));
const TECHNIQUES = POWER.filter((k) => k.kind === 'technique');
const CALM = Math.max(...TECHNIQUES.map((k) => k.cost)) + 10;
/** Where the suite stands, off the spawn, on flat grass of its own. */
const AT: [number, number] = [9, 9];
/** A rise between tiles past the plain step and inside Sure Feet's (`walk_share`). */
const RISE = 36;
/** The pieces of chain worn on every place a blow lands, for Ironhide. */
const CHAIN: Record<string, string> = { head: 'chain_coif', chest: 'chain_hauberk', arms: 'chain_sleeves', legs: 'chain_leggings', feet: 'chain_boots' };

/* ---- On the island -------------------------------------------------------------- */

const T = (id: string): string => q(P(id).id);
const out = psql(`
begin;
select setseed(0.53);
create temp table said (k text, v text);
create function pg_temp.hold(w uuid, u uuid, ids text[]) returns void language plpgsql as $f$
begin
  delete from path_taken where world_id = w and uid = u;
  insert into path_taken (world_id, uid, pick, took) select w, u, x, now() + make_interval(secs => o) from unnest(ids) with ordinality z(x, o);
end $f$;
create function pg_temp.med(w uuid, u uuid, v double precision) returns void language sql as $f$
  insert into skill (world_id, uid, id, value) values (w, u, meditation_skill(), v)
    on conflict (world_id, uid, id) do update set value = excluded.value
$f$;
create function pg_temp.cast(w uuid, u uuid, id text) returns text language plpgsql as $f$
declare r jsonb;
begin
  delete from caller where uid = u;
  perform rpc_spell_bar(w, 5, id);
  delete from caller where uid = u;
  r := rpc_cast_spell(w, 5, '{}'::jsonb);
  return coalesce(r->>'said', r->>'why') || '|' || (select calm from player where world_id = w and uid = u)
    || '|' || coalesce(r->'rest'->>id, 'none');
end $f$;
/* What deep water costs a body's wind over ten seconds, settled. */
create function pg_temp.swim(w uuid, u uuid) returns double precision language plpgsql as $f$
declare v double precision;
begin
  update player set body_at = now() - interval '10 seconds', swim_at = now(),
         stats = stats || '{"stamina": 1, "hunger": 1, "thirst": 1}'::jsonb where world_id = w and uid = u;
  perform body_settle(w, u);
  select 1 - (stats->>'stamina')::double precision into v from player where world_id = w and uid = u;
  return v;
end $f$;
/* What a hundred seconds on dry land takes off hunger. */
create function pg_temp.hunger(w uuid, u uuid) returns double precision language plpgsql as $f$
declare v double precision;
begin
  update player set body_at = now() - interval '100 seconds', nutrition = '{}'::jsonb,
         stats = stats || '{"stamina": 1, "hunger": 1, "thirst": 1}'::jsonb where world_id = w and uid = u;
  perform body_settle(w, u);
  select 1 - (stats->>'hunger')::double precision into v from player where world_id = w and uid = u;
  return v;
end $f$;
/* A blow of the same dice on the same chain: the health it took and what was soaked where it landed. */
create function pg_temp.blow(w uuid, u uuid) returns text language plpgsql as $f$
declare v_part text; v_soak double precision; v_left double precision; it item;
begin
  update item set dmg = 0 where world_id = w and holder_uid = u;
  update skill set value = 1 where world_id = w and uid = u and id in (select skill from armour_class_def);
  update player set wounds = '[]'::jsonb, stats = (coalesce(stats, '{}'::jsonb) - 'hurtBy') || '{"health": 1}'::jsonb where world_id = w and uid = u;
  perform setseed(0.123);
  perform hurt_player(w, u, 0.1, 'A test blow', 'bite');
  select (wounds->0->>'part'), 1 - (stats->>'health')::double precision into v_part, v_left from player where world_id = w and uid = u;
  update item set dmg = 0 where world_id = w and holder_uid = u;
  update skill set value = 1 where world_id = w and uid = u and id in (select skill from armour_class_def);
  it := worn(w, u, v_part);
  select piece_soak(it, 1) * armour_vs(a.cls, 'bite') into v_soak from armour_def a where a.id = it.def;
  return v_part || ':' || v_left || ':' || v_soak;
end $f$;
do $b$
declare w uuid; u uuid; tx int; ty int; v_t text; v_a double precision; v_b double precision; i int; j int; r jsonb; v_x double precision;
begin
  select wd.id, wd.spawn_x + ${AT[0]}, wd.spawn_y + ${AT[1]} into w, tx, ty from world wd order by wd.size desc, wd.id limit 1;
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  for i in tx - 12 .. tx + 25 loop for j in ty - 12 .. ty + 25 loop
    perform land_set_tile(w, i, j, tile_id('Grass')); perform land_set_data(w, i, j, 0);
  end loop; end loop;
  for i in tx - 12 .. tx + 26 loop for j in ty - 12 .. ty + 26 loop
    perform land_set_height(w, i, j, 40);
  end loop; end loop;
  delete from creature where world_id = w;
  delete from path_taken where world_id = w and uid = u;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  update player set way = 'power', calm = 0, spell_bar = '[]'::jsonb, used_at = '{}'::jsonb, blessings = '{}'::jsonb, equipped = '{}'::jsonb,
         x = tx + 0.5, y = ty + 0.5, level = 0, away = false, aboard = null, act = null, act_queue = '[]'::jsonb, wounds = '[]'::jsonb,
         class_mul = null, craft_class = null, combat_class = null, kill_saved_at = null, moved_at = now(),
         stats = (coalesce(stats, '{}'::jsonb) - 'hurtBy') || '{"hunger": 1, "thirst": 1, "health": 1, "stamina": 1}'::jsonb
   where world_id = w and uid = u;
  update player set way = null where world_id = w and uid <> u;
  insert into skill (world_id, uid, id, value) values (w, u, 'climbing', 1), (w, u, 'body_control', 1), (w, u, 'swimming', 1)
    on conflict (world_id, uid, id) do update set value = 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);

  -- An old walker of Power's steps, at seventy: no step and no Fury, and picks to the third tier and not the fourth.
  perform pg_temp.med(w, u, 70);
  v_a := carry_limit(w, u);
  insert into said values ('OLDSTEP', walks(w, u, 'power', 5)::text || '|' || coalesce((ability_of(w, u, 'fury')).name, 'none')
    || '|' || work_ability(w, u, 'fury'));
  delete from caller where uid = u;
  insert into said values ('TIER4', coalesce(rpc_take_path_pick(w, ${T('surge')})->>'why', 'TAKEN'));
  delete from caller where uid = u;
  insert into said values ('TOOK', coalesce(rpc_take_path_pick(w, ${T('ironhide')})->>'took', 'refused'));
  r := rpc_faith(w);
  insert into said values ('WHYS', (r->'path'->'picks')::text);

  /* ---- The techniques ---- */
  perform pg_temp.med(w, u, 99);
  perform pg_temp.hold(w, u, array[${TECHNIQUES.map((k) => q(k.id)).join(', ')}]);
  update player set calm = ${CALM}, stats = stats || '{"stamina": 0.1}'::jsonb where world_id = w and uid = u;
  v_t := pg_temp.cast(w, u, ${T('second_wind')});
  insert into said values ('WIND', v_t || '|' || (select stats->>'stamina' from player where world_id = w and uid = u));
  insert into said values ('RESTING', pg_temp.cast(w, u, ${T('second_wind')}));
  update player set used_at = '{}'::jsonb, calm = 2 where world_id = w and uid = u;
  insert into said values ('POOR', pg_temp.cast(w, u, ${T('second_wind')}));

  -- Shrug: none to shrug off; then a bleeding bite with venom in it and a bruise.
  update player set calm = ${CALM}, used_at = '{}'::jsonb, wounds = '[]'::jsonb where world_id = w and uid = u;
  insert into said values ('SHRUGNONE', pg_temp.cast(w, u, ${T('shrug')}));
  update player set wounds = '[{"kind": "bite", "part": "arms", "severity": 0.05, "bleeding": true, "infected": false, "dressing": null, "venom": 30, "at": "2026-01-01"},
                                {"kind": "crush", "part": "legs", "severity": 0.05, "bleeding": false, "infected": false, "dressing": null, "at": "2026-01-01"},
                                {"kind": "burn", "part": "chest", "severity": 0.05, "bleeding": true, "infected": false, "dressing": null, "at": "2026-01-01"}]'::jsonb,
         -- Settled just now, so nothing closes or runs out on the way to the cast.
         stats = stats || jsonb_build_object('hurtSettled', now())
   where world_id = w and uid = u;
  v_t := pg_temp.cast(w, u, ${T('shrug')});
  insert into said values ('SHRUG', v_t || '|' || (select jsonb_array_length(wounds) || ':'
      || (select count(*) from jsonb_array_elements(wounds) e where (e->>'bleeding')::boolean or e ? 'venom') from player where world_id = w and uid = u));

  -- Surge: its share on a walk, and a load half again over the limit slows nothing.
  update player set calm = ${CALM}, used_at = '{}'::jsonb where world_id = w and uid = u;
  perform pg_temp.hold(w, u, array[${T('surge')}]);
  v_a := travel_speed(w, u);
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'rock_shards', 10, 400);
  update player set moved_at = now() - interval '1 second', x = tx + 0.5, y = ty + 0.5 where world_id = w and uid = u;
  delete from caller where uid = u;
  r := rpc_move(w, tx + 2.5, ty + 0.5, 0);
  v_t := (r->>'x')::double precision - (tx + 0.5) || '|' || over_carry(w, u);
  v_t := pg_temp.cast(w, u, ${T('surge')}) || '|' || v_t;
  update player set moved_at = now() - interval '1 second', x = tx + 0.5, y = ty + 0.5 where world_id = w and uid = u;
  delete from caller where uid = u;
  r := rpc_move(w, tx + 2.5, ty + 0.5, 0);
  insert into said values ('SURGE', v_t || '|' || ((r->>'x')::double precision - (tx + 0.5)) || '|' || v_a || '|' || travel_speed(w, u)
    || '|' || round((path_beat(w, u)->>'surge')::numeric));
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  update player set blessings = '{}'::jsonb, x = tx + 0.5, y = ty + 0.5 where world_id = w and uid = u;

  -- Deep water, carved off to one side: what ten seconds of it cost, plain, for Hard Breath, in a Deep Lungs and in an Unbroken.
  for i in tx + 14 .. tx + 17 loop for j in ty + 14 .. ty + 17 loop perform land_set_height(w, i, j, -40); end loop; end loop;
  update player set x = tx + 15.5, y = ty + 15.5 where world_id = w and uid = u;
  perform pg_temp.hold(w, u, '{}');
  v_t := in_deep_water(w, u)::text || '|' || pg_temp.swim(w, u);
  perform pg_temp.hold(w, u, array[${T('hard_breath')}]);
  v_t := v_t || '|' || pg_temp.swim(w, u);
  perform pg_temp.hold(w, u, array[${T('deep_lungs')}]);
  update player set calm = ${CALM}, used_at = '{}'::jsonb where world_id = w and uid = u;
  v_t := v_t || '|' || pg_temp.cast(w, u, ${T('deep_lungs')}) || '|' || pg_temp.swim(w, u);
  update player set blessings = '{}'::jsonb where world_id = w and uid = u;
  perform pg_temp.hold(w, u, array[${T('unbroken')}]);
  update player set calm = ${CALM}, used_at = '{}'::jsonb where world_id = w and uid = u;
  v_t := v_t || '|' || pg_temp.cast(w, u, ${T('unbroken')}) || '|' || pg_temp.swim(w, u);
  insert into said values ('WATER', v_t);
  -- And Unbroken on a go of work, and on a fighting trade's spell refused for want of wind.
  update player set x = tx + 0.5, y = ty + 0.5, stats = stats || '{"stamina": 1}'::jsonb where world_id = w and uid = u;
  perform spend_wind(w, u, 'mine');
  v_a := (select (stats->>'stamina')::double precision from player where world_id = w and uid = u);
  update player set blessings = '{}'::jsonb, stats = stats || '{"stamina": 1}'::jsonb where world_id = w and uid = u;
  perform spend_wind(w, u, 'mine');
  insert into said values ('WORK', v_a || '|' || (select stats->>'stamina' from player where world_id = w and uid = u) || '|'
    || (pg_get_functiondef('spell_cast_refusal(uuid, uuid, text)'::regprocedure) ~ 'path_unbroken')::text);

  /* ---- The disciplines ---- */
  perform pg_temp.hold(w, u, '{}');
  -- Long Stride, and Pack Mule.
  v_a := travel_speed(w, u);
  v_b := carry_limit(w, u);
  perform pg_temp.hold(w, u, array[${T('long_stride')}, ${T('pack_mule')}]);
  insert into said values ('STRIDE', v_a || '|' || travel_speed(w, u) || '|' || v_b || '|' || carry_limit(w, u));

  -- Sure Feet and Sure Fall: a rise of ${RISE} between two tile centres, up and down.
  for j in ty + 6 .. ty + 7 loop
    perform land_set_height(w, tx + 3, j, 40 + ${RISE});
    perform land_set_height(w, tx + 4, j, 40 + ${2 * RISE});
  end loop;
  perform pg_temp.hold(w, u, '{}');
  -- Whole (1) or stopped at the step (0): a walk stopped part of the way is given back as the share it got.
  v_t := (walk_share(w, u, 0, tx + 2.5, ty + 6.5, tx + 3.5, ty + 6.5) = 1)::int || ':' || (walk_share(w, u, 0, tx + 3.5, ty + 6.5, tx + 2.5, ty + 6.5) = 1)::int
    || '|' || (centre_height(w, tx + 3, ty + 6) - centre_height(w, tx + 2, ty + 6));
  perform pg_temp.hold(w, u, array[${T('sure_feet')}]);
  v_t := v_t || '|' || (walk_share(w, u, 0, tx + 2.5, ty + 6.5, tx + 3.5, ty + 6.5) = 1)::int || ':' || (walk_share(w, u, 0, tx + 3.5, ty + 6.5, tx + 2.5, ty + 6.5) = 1)::int;
  perform pg_temp.hold(w, u, array[${T('sure_fall')}]);
  v_t := v_t || '|' || (walk_share(w, u, 0, tx + 2.5, ty + 6.5, tx + 3.5, ty + 6.5) = 1)::int || ':' || (walk_share(w, u, 0, tx + 3.5, ty + 6.5, tx + 2.5, ty + 6.5) = 1)::int;
  insert into said values ('STEP', v_t);

  -- Enduring: a hundred seconds on dry land.
  perform pg_temp.hold(w, u, '{}');
  v_a := pg_temp.hunger(w, u);
  perform pg_temp.hold(w, u, array[${T('enduring')}]);
  insert into said values ('ENDURING', v_a || '|' || pg_temp.hunger(w, u));

  -- Ironhide: the same blow on the same chain, with it and without.
  insert into item (world_id, holder, holder_uid, def, ql, count, extra)
    select w, 'player', u, d, 50, 1, 'Iron' from unnest(array[${Object.values(CHAIN).map(q).join(', ')}]) d;
  update player set equipped = (select jsonb_object_agg(a.slot, i.id) from item i join armour_def a on a.id = i.def
                                 where i.world_id = w and i.holder_uid = u) where world_id = w and uid = u;
  perform pg_temp.hold(w, u, '{}');
  v_t := pg_temp.blow(w, u);
  perform pg_temp.hold(w, u, array[${T('ironhide')}]);
  insert into said values ('IRONHIDE', v_t || '|' || pg_temp.blow(w, u));
  update player set equipped = '{}'::jsonb where world_id = w and uid = u;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;

  -- Unshaken: read where a heavy blow is struck.
  perform pg_temp.hold(w, u, array[${T('unshaken')}]);
  insert into said values ('UNSHAKEN', path_fx(w, u, 'heavy', 1) || '|'
    || (pg_get_functiondef('hunt_settle(uuid, creature, species_def, age_def)'::regprocedure)
          ~ '0\\.012 \\* \\(1 \\+ \\(heavy_hit\\(\\) - 1\\) \\* path_fx\\(p_world, p\\.uid, ''heavy'', 1\\)\\)')::text);

  -- Hard to Kill: a killing blow leaves you standing, and the next inside the hour does not.
  perform pg_temp.hold(w, u, array[${T('hard_to_kill')}]);
  update player set wounds = '[]'::jsonb, kill_saved_at = null, stats = (stats - 'hurtBy') || '{"health": 0.01}'::jsonb where world_id = w and uid = u;
  delete from event where uid = u;
  perform hurt_player(w, u, 0.5, 'A killing blow', 'bite');
  insert into said values ('KILL', (select (stats->>'health') || '|' || (kill_saved_at is not null)::text from player where world_id = w and uid = u)
    || '|' || coalesce((select text from event where uid = u and text like 'You should be dead%' order by n desc limit 1), 'nothing said')
    || '|' || round((path_beat(w, u)->>'hardToKill')::numeric));
  update player set stats = stats || '{"health": 0.01}'::jsonb where world_id = w and uid = u;
  delete from event where uid = u;
  perform hurt_player(w, u, 0.5, 'Another killing blow', 'bite');
  insert into said values ('KILLAGAIN', (select count(*) from event where uid = u and text like 'You should be dead%')::text);
end $b$;
select k || '=' || v from said order by k;
rollback;
`);
const isle = new Map<string, string>();
for (const line of out.split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) isle.set(line.slice(0, i), line.slice(i + 1));
}
const at = (k: string): string => isle.get(k) ?? '(nothing)';
const part = (k: string, n: number): string => at(k).split('|')[n] ?? '(nothing)';
const num = (k: string, n: number): number => Number(part(k, n));

check('Power has moved onto tiers, and keeps no step', PATHS.power.moved && !PATHS.power.steps.length);
check(`fifteen picks, a technique and two disciplines at each of ${PATH_TIER_AT.length} tiers`,
  POWER.length === 15 && PATH_TIER_AT.every((_, i) => picksOf('power', i + 1)[0].kind === 'technique' && picksOf('power', i + 1).slice(1).every((k) => k.kind === 'discipline')));
check('an old walker of Power at 70 keeps the path and none of its steps: no Ironhide by a step, no Fury', at('OLDSTEP') === 'false|none|Nothing happens.', at('OLDSTEP'));
check('and is refused the fourth tier, in the browser\'s words', at('TIER4') === pathPickRefusal(P('surge'), 'power', [], 70), at('TIER4'));
check('and takes a pick of the third', at('TOOK') === P('ironhide').id, at('TOOK'));
{
  const whys = JSON.parse(at('WHYS')) as Record<string, string | null>;
  const wrong = POWER.filter((k) => (whys[k.id] ?? null) !== pathPickRefusal(k, 'power', [P('ironhide').id], 70));
  check('the Faith window is told why each of Power\'s fifteen is refused, in the browser\'s words', !wrong.length && Object.keys(whys).length === 15,
    wrong.map((k) => `${k.id}: ${whys[k.id]}`).join('; '));
}
{
  const k = P('second_wind');
  check(`Second Wind fills the wind, for ${k.cost} Calm, resting ${k.rest} seconds`, at('WIND') === `${SECOND_WIND_SAID}|${CALM - k.cost}|${k.rest}|1`, at('WIND'));
  check('and is refused while it rests', part('RESTING', 0) === `${k.name} can be called again in ${k.rest} seconds.`, at('RESTING'));
  check('and short of Calm, in the browser\'s words', part('POOR', 0) === calmRefusal(k.name, k.cost, 2), at('POOR'));
}
{
  const k = P('shrug');
  check('Shrug with nothing bleeding or venomed is refused, for nothing', at('SHRUGNONE') === `${SHRUG_NONE}|${CALM}|none`, at('SHRUGNONE'));
  check(`Shrug stops every wound bleeding and weeping and takes the venom out, and closes none, for ${k.cost} Calm, resting ${k.rest}`,
    at('SHRUG') === `${SHRUG_SAID}|${CALM - k.cost}|${k.rest}|3:0`, at('SHRUG'));
}
{
  const k = P('surge');
  const [crawl, over] = [num('SURGE', 3), num('SURGE', 4)];
  check(`Surge: for ${k.fx.secs} seconds a walk ${k.fx.pace} times as quick, for ${k.cost} Calm, resting ${k.rest}`,
    at('SURGE').startsWith(`${surgeSaid(k.fx.secs, k.fx.pace)}|${CALM - k.cost}|${k.rest}|`) && near(num('SURGE', 7), num('SURGE', 6) * k.fx.pace)
      && Math.abs(num('SURGE', 8) - k.fx.secs) <= 2, at('SURGE'));
  check('and a load half again over the limit, which holds a walk to a crawl, slows nothing inside it', over > 1.5 && crawl < 0.5 && near(num('SURGE', 5), 2, 1e-6),
    at('SURGE'));
}
{
  const [deep, plain, hard, lungsSaid, , lungsRest, lungs, brokeSaid, , , broke] = at('WATER').split('|');
  check('ten seconds in deep water cost wind, plain', deep === 'true' && Number(plain) > 0, at('WATER'));
  check(`Hard Breath: ${P('hard_breath').fx.swim} of it`, near(Number(hard), Number(plain) * P('hard_breath').fx.swim), at('WATER'));
  check(`Deep Lungs: none of it for ${P('deep_lungs').fx.secs} seconds, for ${P('deep_lungs').cost} Calm`,
    lungsSaid === deepLungsSaid(P('deep_lungs').fx.secs) && Number(lungsRest) === P('deep_lungs').rest && Number(lungs) === 0, at('WATER'));
  check('Unbroken: none of it either', brokeSaid === unbrokenSaid(P('unbroken').fx.secs) && Number(broke) === 0, at('WATER'));
  const [free, paid, door] = at('WORK').split('|');
  check('and a go of work costs nothing inside it and its wind outside it, and a fighting trade\'s spell is not refused for want of wind inside it',
    Number(free) === 1 && Number(paid) < 1 && door === 'true', at('WORK'));
}
{
  const [s0, s1, c0, c1] = at('STRIDE').split('|').map(Number);
  check(`Long Stride: a walk ${P('long_stride').fx.stride} times`, near(s1, s0 * P('long_stride').fx.stride), at('STRIDE'));
  check(`Pack Mule: ${P('pack_mule').fx.mule} kg more before a load weighs`, near(c1, c0 + P('pack_mule').fx.mule), at('STRIDE'));
  const [plain, rise, feet, fall] = at('STEP').split('|');
  check(`a rise of ${RISE} is past the plain step, up and down`, plain === '0:0' && Number(rise) === RISE, at('STEP'));
  check(`Sure Feet: up it and down it, ${P('sure_feet').fx.climb} times the step either way`, feet === '1:1', at('STEP'));
  check('Sure Fall: down it, any drop; and not up it', fall === '0:1', at('STEP'));
  const [h0, h1] = at('ENDURING').split('|').map(Number);
  check(`Enduring: hunger falls ${P('enduring').fx.upkeep} as fast`, h0 > 0 && near(h1, h0 * P('enduring').fx.upkeep, 1e-6), at('ENDURING'));
  const [a, b] = [part('IRONHIDE', 0).split(':'), part('IRONHIDE', 1).split(':')];
  const soak = Number(a[2]);
  check(`Ironhide: the same blow on the same chain turns ${P('ironhide').fx.hide} times the share, on the island too`,
    a[0] === b[0] && soak > 0 && near(Number(b[1]) / Number(a[1]), (1 - Math.min(0.92, soak * P('ironhide').fx.hide)) / (1 - Math.min(0.92, soak)), 1e-4),
    at('IRONHIDE'));
  check(`Unshaken: a heavy blow's extra at ${P('unshaken').fx.heavy}, read where the island strikes one`, at('UNSHAKEN') === `${P('unshaken').fx.heavy}|true`, at('UNSHAKEN'));
  const k = P('hard_to_kill');
  check(`Hard to Kill: a killing blow leaves you at ${k.fx.kill} of your health, and says so in the browser's words`,
    at('KILL').startsWith(`${k.fx.kill}|true|${hardToKillSaid(k.fx.kill)}|`) && Math.abs(num('KILL', 3) - k.fx.every) <= 2, at('KILL'));
  check(`and the next inside ${k.fx.every} seconds is not turned`, at('KILLAGAIN') === '0', at('KILLAGAIN'));
}

/* ---- In the browser -------------------------------------------------------------- */

const g = Game.create(4243);
g.rand = mulberry32(4243);
g.time = 1e7;
const p = g.player;
p.way = 'power';
g.skills.values.set(MEDITATION, 99);
g.skills.values.set('climbing', 1);
g.skills.values.set('swimming', 1);
const hold = (...ids: string[]): void => {
  p.picks = ids.map((id) => P(id).id);
};
const body = (): void => (g as unknown as { updateBody(dt: number): void }).updateBody(0.001);
{
  g.skills.values.set(MEDITATION, 70);
  hold();
  check('the browser: an old walker at 70 is refused the fourth tier and takes the third, in the island\'s words',
    g.takePathPick(P('surge').id) === pathPickRefusal(P('surge'), 'power', [], 70) && g.takePathPick(P('ironhide').id) === null);
  g.skills.values.set(MEDITATION, 99);
}
{
  hold(...TECHNIQUES.map((k) => k.id.slice('power_'.length)));
  p.calm = CALM;
  p.stats.stamina = 0.1;
  check('Second Wind in the browser: the wind full, its Calm paid', g.castTechnique(P('second_wind').id) === null && p.stats.stamina === 1 && p.calm === CALM - P('second_wind').cost);
  p.calm = 3;
  check('and short of Calm the next is refused in the island\'s words', g.techniqueRefusal(P('shrug').id) === calmRefusal('Shrug', P('shrug').cost, 3));
  p.calm = CALM;
  p.wounds = [];
  check('Shrug with nothing on you: the island\'s words', g.castTechnique(P('shrug').id) === SHRUG_NONE);
  p.wounds = [
    { id: 1, kind: 'bite', part: 'arms', severity: 0.05, bleeding: true, infected: false, dressing: null, at: 0, venom: 30 },
    { id: 2, kind: 'crush', part: 'legs', severity: 0.05, bleeding: false, infected: false, dressing: null, at: 0 },
    { id: 3, kind: 'burn', part: 'chest', severity: 0.05, bleeding: true, infected: false, dressing: null, at: 0 },
  ];
  check('Shrug in the browser: nothing bleeding, weeping or venomed, and every wound still open',
    g.castTechnique(P('shrug').id) === null && p.wounds.length === 3 && p.wounds.every((w) => !w.bleeding && w.venom === undefined));
  // Swimming: plain, Hard Breath, and nothing inside a Deep Lungs or an Unbroken.
  hold(...TECHNIQUES.map((k) => k.id.slice('power_'.length)));
  const plain = g.swimWind();
  hold('hard_breath', ...TECHNIQUES.map((k) => k.id.slice('power_'.length)));
  const hard = g.swimWind();
  p.calm = CALM;
  g.castTechnique(P('deep_lungs').id);
  const lungs = g.swimWind();
  p.pathTimes = {};
  p.calm = CALM;
  const cost = g.staminaCost(0.1);
  g.castTechnique(P('unbroken').id);
  check(`deep water in the browser: ${SWIM_WIND} plain, ${P('hard_breath').fx.swim} of it for Hard Breath, nothing in a Deep Lungs or an Unbroken`,
    near(plain, SWIM_WIND * Math.max(0.4, 1 - 1 / 200)) && near(hard, plain * P('hard_breath').fx.swim) && lungs === 0 && g.swimWind() === 0
      && cost > 0 && g.staminaCost(0.1) === 0, `${plain} ${hard} ${lungs} ${g.swimWind()}`);
  check('and the bar the browser draws spends nothing on a job inside an Unbroken', bodyForward({ health: 1, stamina: 1, hunger: 1, thirst: 1 }, 10, { acting: true, wind: 1, spend: 0 }).stamina === 1);
  p.pathTimes = {};
  // Surge and Long Stride: what a walk on foot is worth, and nothing slowing it.
  hold();
  body();
  const pace0 = p.pathPace;
  hold('long_stride', 'surge');
  p.calm = CALM;
  p.usedAt = {};
  g.castTechnique(P('surge').id);
  body();
  check('Long Stride and a Surge in the browser: the island\'s share on a walk, and nothing slowing it while the Surge holds',
    pace0 === 1 && near(p.pathPace, P('long_stride').fx.stride * P('surge').fx.pace) && p.unslowed, `${pace0} ${p.pathPace} ${p.unslowed}`);
  p.pathTimes = {};
  body();
  check('and once it is over, the stride and nothing more', near(p.pathPace, P('long_stride').fx.stride) && !p.unslowed);
}
{
  // The disciplines.
  hold();
  const c0 = g.carryLimit();
  const step0 = g.climbStep();
  hold('pack_mule', 'sure_feet');
  check(`Pack Mule in the browser: ${P('pack_mule').fx.mule} kg more`, near(g.carryLimit(), c0 + P('pack_mule').fx.mule));
  check(`Sure Feet in the browser: the step up ${P('sure_feet').fx.climb} times, and the drop the same as the step`,
    near(step0, MAX_STEP + CLIMB_PER_LEVEL) && near(g.climbStep(), step0 * P('sure_feet').fx.climb) && g.dropStep() === g.climbStep());
  // The same rise as the island's, between two tiles of a world that is nothing else.
  const ground = { getTile: () => TileType.Grass, centerHeight: (x: number) => (x === 1 ? RISE : 0) } as unknown as World;
  const up = (s: number, d: number): string => `${groundStep(ground, 0, 0, 1, 0, s, d) ? 1 : 0}:${groundStep(ground, 1, 0, 0, 0, s, d) ? 1 : 0}`;
  hold();
  const plain = up(g.climbStep(), g.dropStep());
  hold('sure_feet');
  const feet = up(g.climbStep(), g.dropStep());
  hold('sure_fall');
  const fall = up(g.climbStep(), g.dropStep());
  check('Sure Feet and Sure Fall in the browser: the island\'s answers on the same rise', plain === '0:0' && feet === '1:1' && fall === '0:1' && g.dropStep() === Infinity,
    `${plain} ${feet} ${fall}`);
  // Strong Back: what armour and a load past the limit weigh on you, which only the browser counts.
  hold();
  g.inventory.add('rock_shards', { count: 400, ql: 10 });
  const b0 = g.burden();
  hold('strong_back');
  check(`Strong Back in the browser: a burden ${P('strong_back').fx.burden} of itself`, b0 > 0 && near(g.burden(), b0 * P('strong_back').fx.burden), `${b0} ${g.burden()}`);
  g.inventory.items.splice(0, g.inventory.items.length, ...g.inventory.items.filter((it) => it.id !== 'rock_shards'));
  // Enduring: offline, and the bar drawn on an island.
  hold();
  p.stats.hunger = 1;
  (g as unknown as { updateBody(dt: number): void }).updateBody(10);
  const h0 = 1 - p.stats.hunger;
  hold('enduring');
  p.stats.hunger = 1;
  (g as unknown as { updateBody(dt: number): void }).updateBody(10);
  const h1 = 1 - p.stats.hunger;
  const drawn = 1 - bodyForward({ health: 1, stamina: 1, hunger: 1, thirst: 1 }, 10, { acting: false, wind: 1, upkeep: P('enduring').fx.upkeep }).hunger;
  check(`Enduring in the browser: hunger falls ${P('enduring').fx.upkeep} as fast, by yourself and as the island's bar is drawn`,
    h0 > 0 && near(h1, h0 * P('enduring').fx.upkeep, 1e-6) && near(drawn, 10 * HUNGER_RATE * P('enduring').fx.upkeep), `${h0} ${h1} ${drawn}`);
  // Ironhide: what a blow would leave you with on the same chain.
  const worn: Record<string, number> = {};
  for (const [slot, id] of Object.entries(CHAIN)) worn[slot] = g.inventory.add(id, { ql: 50, extra: 'Iron' }).uid;
  for (const [slot, uid] of Object.entries(worn)) p.equipped[slot] = uid;
  hold();
  const e0 = g.expectedBlow(1, 'bite');
  hold('ironhide');
  const e1 = g.expectedBlow(1, 'bite');
  let want0 = 0;
  let want1 = 0;
  for (const [slot, share] of HIT_LOCATIONS) {
    const it = g.worn(slot as Slot);
    const def = it && ARMOUR_BY_ID.get(it.id);
    if (!it || !def) continue;
    const s = pieceSoak(def, it, g.skills.get(ARMOUR_CLASSES[def.cls].skill)) * ARMOUR_VS[def.cls].bite;
    want0 += share * Math.min(0.92, s);
    want1 += share * Math.min(0.92, s * P('ironhide').fx.hide);
  }
  check(`Ironhide in the browser: ${P('ironhide').fx.hide} times what the chain turns`, e1 < e0 && near(e1 / e0, (1 - want1) / (1 - want0), 1e-6), `${e0} ${e1}`);
  for (const slot of Object.keys(CHAIN)) p.equipped[slot] = null;
  // Unshaken: a heavy blow's weight on you, as a hunter's is struck (`creatures.ts`).
  hold('unshaken');
  check(`Unshaken in the browser: a heavy blow ${1 + (HEAVY_HIT - 1) * P('unshaken').fx.heavy} times an ordinary one, not ${HEAVY_HIT}`,
    g.pathFx('heavy', 1) === P('unshaken').fx.heavy && 1 + (HEAVY_HIT - 1) * g.pathFx('heavy', 1) < HEAVY_HIT);
  // Hard to Kill: a killing blow, and the next.
  hold('hard_to_kill');
  p.pathTimes = {};
  p.stats.health = 0.01;
  p.attackedBy = null;
  const said: string[] = [];
  const log = g.logMsg.bind(g);
  g.logMsg = (m: string, k?: never) => { said.push(m); log(m, k); };
  g.hurtPlayer(0.5, 'A killing blow');
  const after = p.stats.health;
  p.stats.health = 0.01;
  g.hurtPlayer(0.5, 'Another killing blow');
  g.logMsg = log;
  check(`Hard to Kill in the browser: at ${P('hard_to_kill').fx.kill} of your health, said in the island's words, and not twice in the hour`,
    after === P('hard_to_kill').fx.kill && p.stats.health === 0 && said.filter((m) => m === hardToKillSaid(P('hard_to_kill').fx.kill)).length === 1, `${after} ${p.stats.health}`);
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Power path on its tiers, the same on both sides — ${ok.length} of ${ok.length}`);
