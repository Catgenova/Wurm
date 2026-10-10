/**
 * The Love path on its tiers (`src/game/meditation.ts`,
 * `love_and_power_move_onto_tiers.sql`): every one of its fifteen picks, on
 * the island and in the browser. What this asks:
 *
 *   * somebody who walked Love on its steps keeps the path, keeps none of the
 *     steps, and takes a pick at each tier their meditation has reached,
 *     refused at the others in the same words on both sides;
 *   * each technique costs its Calm, rests its rest and is refused short of
 *     Calm and while it rests; and does what it says -- Refresh fills hunger
 *     and thirst, Bond mends the companion within reach (and is refused, for
 *     nothing, with none or a whole one), Gather brings every wildermon of
 *     yours within reach round you and leaves the one beyond it, Lull stops
 *     what is hunting you within reach and holds it off its hunt, and Heart
 *     of the Herd hardens the companion near you and nothing further;
 *   * each discipline does what it says where its rule is: Green Thumb on a
 *     founder's ground, Gentle Hand and Old Friend on a tame, Kin on an age,
 *     Abundance on a harvest and on fruit, Steady Herd on a fight its keeper
 *     has left behind, Long Table on a knack, Good Stock on a young one's
 *     blood, Season's Hand on a field in winter and Bloom on the trees round a
 *     sitting, once a day.
 *
 * Every roll is seeded: `setseed` on the island and `mulberry32` here.
 */
import { execFileSync } from 'node:child_process';
// `game` first: the root of the module graph, so nothing below comes out half-built.
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import {
  bondNone, bondSaid, bondWhole, calmRefusal, CHOOSE_AT, gatherNone, gatherSaid, HERD_NONE, herdSaid, LAND_GROWS, lullNone, lullSaid, MEDITATION,
  PATH_PICK_BY_ID, PATH_TIER_AT, PATHS, pathPickRefusal, picksOf, REFRESH_SAID, type PathPickDef,
} from '../../src/game/meditation';
import { ageOf, maxHealth, OLD_AT, setLocalKept, SPECIES, YOUNG_FOR } from '../../src/game/creatures';
import { tameChance } from '../../src/game/creatureActions';
import { cropYield, RIPE } from '../../src/game/farming';
import { fieldClock, fieldRate, HAND_WINTER, handClock, handMoment, handRate } from '../../src/game/growth';
import { seasonAt, YEAR_FROM, SEASON_DAYS } from '../../src/world/calendar';
import { boonTime } from '../../src/game/boons';
import { packTreeData, TileType, TREE_DEFS, treeVariant } from '../../src/world/tiles';
import { mulberry32 } from '../../src/world/noise';
import { DAY_SECONDS } from '../../src/game/pace';

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
  const k = PATH_PICK_BY_ID.get(`love_${id}`);
  if (!k) throw new Error(`no pick love_${id}`);
  return k;
};
const LOVE = PATH_TIER_AT.flatMap((_, i) => picksOf('love', i + 1));
const TECHNIQUES = LOVE.filter((k) => k.kind === 'technique');
/** Calm enough for any technique of the path and some over. */
const CALM = Math.max(...TECHNIQUES.map((k) => k.cost)) + 10;
/** Moments to hold the Season's Hand's clock to the browser's at: before the year, in each season, and years on. */
const SEASON_SECS = SEASON_DAYS * DAY_SECONDS;
const MOMENTS = [YEAR_FROM - 5000.25, YEAR_FROM + 1, YEAR_FROM + SEASON_SECS * 0.5, YEAR_FROM + SEASON_SECS * 1.7, YEAR_FROM + SEASON_SECS * 2.2,
  YEAR_FROM + SEASON_SECS * 3.4, YEAR_FROM + SEASON_SECS * 3.99, YEAR_FROM + SEASON_SECS * 9.3 + 12.5, YEAR_FROM + SEASON_SECS * 40.75];
/** Where the suite stands, on its own flat grass, and the wildermon round it. */
const AT: [number, number] = [9, 9];
/** A kind of tree that bears fruit. */
const FRUIT_TREE = TREE_DEFS.findIndex((d) => !!d.fruit);

/* ---- The numbers, on both sides ----------------------------------------------- */

const rules = psql(`
begin;
create temp table said (k text, v text);
insert into said select 'MOVED', moved::text from path_def where id = 'love';
insert into said select 'STEPS', count(*)::text from path_step where path = 'love';
insert into said select 'CLOCK', string_agg(hand_clock(to_timestamp(t)) || ':' || hand_moment(hand_clock(to_timestamp(t))), ',' order by o)
  from unnest(array[${MOMENTS.join(',')}]::double precision[]) with ordinality u(t, o);
insert into said values ('WINTER', hand_winter()::text);
select k || '=' || v from said order by k;
rollback;
`);
const said = new Map<string, string>();
for (const line of rules.split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) said.set(line.slice(0, i), line.slice(i + 1));
}
const rule = (k: string): string => said.get(k) ?? '(nothing)';
check('Love has moved onto tiers on both sides, and keeps no step', rule('MOVED') === 'true' && PATHS.love.moved && rule('STEPS') === '0' && !PATHS.love.steps.length,
  `${rule('MOVED')} ${rule('STEPS')}`);
check(`fifteen picks, a technique and two disciplines at each of ${PATH_TIER_AT.length} tiers`,
  LOVE.length === 15 && PATH_TIER_AT.every((_, i) => picksOf('love', i + 1)[0].kind === 'technique' && picksOf('love', i + 1).slice(1).every((k) => k.kind === 'discipline')));
{
  const got = rule('CLOCK').split(',').map((c) => c.split(':').map(Number));
  const wrong = MOMENTS.map((t, i) => (got[i] && got[i][0] === handClock(t) && near(got[i][1], handMoment(handClock(t)), 1e-12) ? null : `${t}: island ${got[i]}, browser ${handClock(t)}:${handMoment(handClock(t))}`))
    .filter((x) => x);
  check('a Season\'s Hand\'s clock is the same on both sides, bit for bit, and back', !wrong.length, wrong.slice(0, 2).join('; '));
  const winter = YEAR_FROM + SEASON_SECS * 3.5;
  check(`and grows in winter at ${HAND_WINTER} of a crop's pace, where a field stands still, on both sides`,
    Number(rule('WINTER')) === HAND_WINTER && seasonAt(winter).season === 'winter' && handRate(winter) === HAND_WINTER && fieldRate(winter) === 0
      && near(handClock(winter + 100) - handClock(winter), 100 * HAND_WINTER) && fieldClock(winter + 100) === fieldClock(winter), rule('WINTER'));
}

/* ---- On the island -------------------------------------------------------------- */

const TECH = (id: string): string => q(P(id).id);
const out = psql(`
begin;
select setseed(0.31);
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
/* A technique cast off the bar's path slot, as the door does it: what it said or why not, Calm after, and its rest. */
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
do $b$
declare w uuid; u uuid; tx int; ty int; r jsonb; v_a double precision; v_b double precision; v_t text;
        c1 int; c2 int; c3 int; h1 int; h2 int; v_d int; v_n int; i int;
begin
  -- The biggest island and its first body, standing on flat grass of its own a little way off the spawn.
  select wd.id, wd.spawn_x + ${AT[0]}, wd.spawn_y + ${AT[1]} into w, tx, ty from world wd order by wd.size desc, wd.id limit 1;
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  for i in tx - 12 .. tx + 45 loop for v_n in ty - 12 .. ty + 45 loop
    perform land_set_tile(w, i, v_n, tile_id('Grass')); perform land_set_data(w, i, v_n, 0);
  end loop; end loop;
  for i in tx - 12 .. tx + 46 loop for v_n in ty - 12 .. ty + 46 loop
    perform land_set_height(w, i, v_n, 40);
  end loop; end loop;
  delete from creature where world_id = w;
  delete from crop where world_id = w and x between tx - 12 and tx + 45 and y between ty - 12 and ty + 45;
  delete from deed where world_id = w;
  delete from path_taken where world_id = w and uid = u;
  delete from guide where world_id = w and uid = u;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  update player set way = 'love', calm = 0, spell_bar = '[]'::jsonb, used_at = '{}'::jsonb, blessings = '{}'::jsonb, boons = '[]'::jsonb,
         x = tx + 0.5, y = ty + 0.5, level = 0, away = false, aboard = null, act = null, act_queue = '[]'::jsonb,
         bloom_day = null, sat_at = null, sat_spots = '[]'::jsonb, class_mul = null, craft_class = null, combat_class = null,
         stats = coalesce(stats, '{}'::jsonb) || '{"hunger": 1, "thirst": 1, "health": 1, "stamina": 1}'::jsonb
   where world_id = w and uid = u;
  update player set way = null where world_id = w and uid <> u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);

  -- An old walker of Love's steps, at twenty-five: no step, a pick at the first tier, refused at the second.
  perform pg_temp.med(w, u, 25);
  insert into said values ('OLDSTEP', walks(w, u, 'love', 3)::text || '|' || coalesce((ability_of(w, u, 'refresh')).name, 'none'));
  delete from caller where uid = u;
  insert into said values ('TIER2', coalesce(rpc_take_path_pick(w, ${TECH('bond')})->>'why', 'TAKEN'));
  delete from caller where uid = u;
  r := rpc_take_path_pick(w, ${TECH('refresh')});
  insert into said values ('TOOK', coalesce(r->>'took', r->>'why') || '|' || (r->'bar')::text);
  delete from caller where uid = u;
  insert into said values ('SHUT', coalesce(rpc_take_path_pick(w, ${TECH('green_thumb')})->>'why', 'TAKEN'));
  r := rpc_faith(w);
  insert into said values ('WHYS', (r->'path'->'picks')::text);

  /* ---- The techniques ---- */
  perform pg_temp.med(w, u, 99);
  perform pg_temp.hold(w, u, array[${TECHNIQUES.map((k) => q(k.id)).join(', ')}]);
  -- Refresh: hunger and thirst full; its Calm and rest; refused while it rests, and short of Calm.
  update player set calm = ${CALM}, stats = stats || '{"hunger": 0.2, "thirst": 0.1}'::jsonb where world_id = w and uid = u;
  -- Cast first and read after: a statement reads the rows as they stood when it began.
  v_t := pg_temp.cast(w, u, ${TECH('refresh')});
  insert into said values ('REFRESH', v_t || '|'
    || (select (stats->>'hunger') || ':' || (stats->>'thirst') from player where world_id = w and uid = u));
  insert into said values ('RESTING', pg_temp.cast(w, u, ${TECH('refresh')}));
  update player set used_at = '{}'::jsonb, calm = 2 where world_id = w and uid = u;
  insert into said values ('POOR', pg_temp.cast(w, u, ${TECH('refresh')}));

  -- Bond: none near; one hurt within reach; whole.
  update player set calm = ${CALM}, used_at = '{}'::jsonb where world_id = w and uid = u;
  insert into said values ('BONDNONE', pg_temp.cast(w, u, ${TECH('bond')}));
  c1 := creature_spawn(w, 'rabba', tx + 3.5, ty + 0.5, 'active', now() - interval '1 day', u);
  update creature set health = max_health(creature) / 2, name = 'Bun' where world_id = w and id = c1;
  update player set calm = ${CALM}, used_at = '{}'::jsonb where world_id = w and uid = u;
  v_a := (select health from creature where world_id = w and id = c1);
  -- Cast first and read after: a statement reads the rows as they stood when it began.
  v_t := pg_temp.cast(w, u, ${TECH('bond')});
  insert into said values ('BOND', v_t || '|' || v_a || '|'
    || (select health || ':' || max_health(c) from creature c where c.world_id = w and c.id = c1));
  update creature c set health = max_health(c) where world_id = w and id = c1;
  update player set calm = ${CALM}, used_at = '{}'::jsonb where world_id = w and uid = u;
  insert into said values ('BONDWHOLE', pg_temp.cast(w, u, ${TECH('bond')}));
  update creature set from_x = tx + ${P('bond').fx.reach + 3}, to_x = tx + ${P('bond').fx.reach + 3} where world_id = w and id = c1;
  update player set calm = ${CALM}, used_at = '{}'::jsonb where world_id = w and uid = u;
  insert into said values ('BONDFAR', pg_temp.cast(w, u, ${TECH('bond')}));

  -- Gather: the companion and a worker within reach, round you; a worker beyond it stays.
  update creature set from_x = tx + 12.5, to_x = tx + 12.5, from_y = ty + 0.5, to_y = ty + 0.5 where world_id = w and id = c1;
  c2 := creature_spawn(w, 'rabba', tx + 0.5, ty + 20.5, 'deed', now() - interval '1 day', u);
  c3 := creature_spawn(w, 'rabba', tx + 0.5, ty + ${P('gather').fx.reach + 5}.5, 'deed', now() - interval '1 day', u);
  update player set calm = ${CALM}, used_at = '{}'::jsonb where world_id = w and uid = u;
  -- Cast first and read after: a statement reads the rows as they stood when it began.
  v_t := pg_temp.cast(w, u, ${TECH('gather')});
  insert into said values ('GATHER', v_t || '|'
    || (select string_agg(round((creature_x(c) - tx)::numeric, 3) || ',' || round((creature_y(c) - ty)::numeric, 3), ';' order by c.id)
          from creature c where c.world_id = w and c.id in (c1, c2, c3)));
  delete from creature where world_id = w and id in (c2, c3);
  update creature set from_x = tx + 50, to_x = tx + 50 where world_id = w and id = c1;
  update player set calm = ${CALM}, used_at = '{}'::jsonb where world_id = w and uid = u;
  insert into said values ('GATHERNONE', pg_temp.cast(w, u, ${TECH('gather')}));
  update creature set from_x = tx + 3.5, to_x = tx + 3.5 where world_id = w and id = c1;

  -- Lull: one hunting you within reach stops and holds off; one beyond it hunts on.
  h1 := creature_spawn(w, 'rabba', tx + 4.5, ty + 0.5, 'wild', now() - interval '1 day');
  h2 := creature_spawn(w, 'rabba', tx + ${P('lull').fx.reach + 4}.5, ty + 0.5, 'wild', now() - interval '1 day');
  update creature set hunting = u where world_id = w and id in (h1, h2);
  update player set calm = ${CALM}, used_at = '{}'::jsonb where world_id = w and uid = u;
  -- Cast first and read after: a statement reads the rows as they stood when it began.
  v_t := pg_temp.cast(w, u, ${TECH('lull')});
  insert into said values ('LULL', v_t || '|'
    || (select coalesce(hunting::text, 'none') || ':' || round(extract(epoch from hunt_again - now())) from creature where world_id = w and id = h1) || '|'
    || (select coalesce((hunting = u)::text, 'none') from creature where world_id = w and id = h2));
  update creature set hunting = null where world_id = w and id = h2;
  update player set calm = ${CALM}, used_at = '{}'::jsonb where world_id = w and uid = u;
  insert into said values ('LULLNONE', pg_temp.cast(w, u, ${TECH('lull')}));
  delete from creature where world_id = w and id in (h1, h2);

  -- Heart of the Herd: none following; then the companion within reach and beyond it.
  update creature set mode = 'deed' where world_id = w and id = c1;
  update player set calm = ${CALM}, used_at = '{}'::jsonb where world_id = w and uid = u;
  insert into said values ('HERDNONE', pg_temp.cast(w, u, ${TECH('herd_heart')}));
  update creature set mode = 'active' where world_id = w and id = c1;
  v_a := herd_heart((select c from creature c where c.world_id = w and c.id = c1), 'taken');
  update player set calm = ${CALM}, used_at = '{}'::jsonb where world_id = w and uid = u;
  -- Cast first and read after: a statement reads the rows as they stood when it began.
  v_t := pg_temp.cast(w, u, ${TECH('herd_heart')});
  insert into said values ('HERD', v_t || '|' || v_a || '|'
    || herd_heart((select c from creature c where c.world_id = w and c.id = c1), 'taken') || '|'
    || herd_heart((select c from creature c where c.world_id = w and c.id = c1), 'dealt') || '|'
    || companion_dealt((select c from creature c where c.world_id = w and c.id = c1)) || '|'
    || round(path_left((select p from player p where p.world_id = w and p.uid = u), 'path_herd')));
  update creature set from_x = tx + ${P('herd_heart').fx.reach + 3}, to_x = tx + ${P('herd_heart').fx.reach + 3} where world_id = w and id = c1;
  insert into said values ('HERDFAR', herd_heart((select c from creature c where c.world_id = w and c.id = c1), 'taken')::text);
  insert into said values ('BEAT', (path_beat(w, u)->>'herd') || '|' || coalesce(path_beat(w, u)->>'surge', 'none'));
  update creature set from_x = tx + 3.5, to_x = tx + 3.5 where world_id = w and id = c1;

  /* ---- The disciplines ---- */
  perform pg_temp.hold(w, u, '{}');
  -- Green Thumb: a stage on ground you founded.
  insert into deed (world_id, name, x, y, radius, founded_by) values (w, 'Love''s Acre', tx, ty, 6, u);
  v_a := crop_per(w, 'wheat', 1, tx + 1, ty + 1);
  perform pg_temp.hold(w, u, array[${q(P('green_thumb').id)}]);
  insert into said values ('GREEN', v_a || '|' || crop_per(w, 'wheat', 1, tx + 1, ty + 1) || '|' || crop_per(w, 'wheat', 1, tx + 20, ty + 20));
  delete from deed where world_id = w;

  -- Gentle Hand and Old Friend: a tame's chance.
  insert into skill (world_id, uid, id, value) values (w, u, 'taming', 1) on conflict (world_id, uid, id) do update set value = 1;
  h1 := creature_spawn(w, 'rabba', tx + 1.5, ty + 0.5, 'wild', now() - interval '1 day');
  perform pg_temp.hold(w, u, '{}');
  v_a := tame_chance(w, u, (select c from creature c where c.world_id = w and c.id = h1));
  perform pg_temp.hold(w, u, array[${q(P('gentle_hand').id)}]);
  v_b := tame_chance(w, u, (select c from creature c where c.world_id = w and c.id = h1));
  perform pg_temp.hold(w, u, array[${q(P('old_friend').id)}]);
  insert into said values ('TAME', v_a || '|' || v_b || '|' || tame_chance(w, u, (select c from creature c where c.world_id = w and c.id = h1)));
  perform guide_mark(w, u, 'rabba', 'tamed');
  insert into said values ('FRIEND', tame_chance(w, u, (select c from creature c where c.world_id = w and c.id = h1))::text);
  delete from guide where world_id = w and uid = u;
  -- And tamed through the door, every time, a tamed kind: the companion set to work, so there is room for one more.
  update creature set mode = 'deed' where world_id = w and id = c1;
  perform guide_mark(w, u, 'rabba', 'tamed');
  v_n := 0;
  for i in 1..5 loop
    insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'potato', 30, 1);
    update creature set mode = 'wild', keeper = null where world_id = w and id = h1;
    perform act_perform(w, u, 'tame', jsonb_build_object('kind', 'creature', 'id', h1));
    if (select mode from creature where world_id = w and id = h1) <> 'wild' then v_n := v_n + 1; end if;
  end loop;
  insert into said values ('FRIENDTAMES', v_n::text);
  delete from creature where world_id = w and id = h1;
  update creature set mode = 'active' where world_id = w and id = c1;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;

  -- Kin: what keeping one comes to, stamped on the beast as the pick is taken, and an age read at it.
  perform pg_temp.hold(w, u, '{}');
  update creature set kept = kept_of(w, u), born = now() - make_interval(secs => young_for() * 1.2) where world_id = w and id = c1;
  v_t := (select coalesce(kept::text, 'none') || ':' || age_of(born, old_of(c), age_pace(c)) from creature c where c.world_id = w and c.id = c1);
  delete from path_taken where world_id = w and uid = u;
  delete from caller where uid = u;
  perform rpc_take_path_pick(w, ${q(P('kin').id)});
  insert into said values ('KIN', v_t || '|' || (select coalesce(kept::text, 'none') || ':' || age_of(born, old_of(c), age_pace(c)) from creature c where c.world_id = w and c.id = c1)
    || '|' || (select (age_row(born, old_of(c), age_pace(c))).id from creature c where c.world_id = w and c.id = c1));
  update creature set born = now() - make_interval(secs => old_at() * 1.1) where world_id = w and id = c1;
  insert into said values ('KINOLD', (select age_of(born, old_of(c)) || ':' || age_of(born, old_of(c), age_pace(c)) from creature c where c.world_id = w and c.id = c1));
  update creature set born = now() - interval '1 day', kept = null where world_id = w and id = c1;

  -- Abundance: a harvest tended at every stage, and fruit off a tree.
  insert into skill (world_id, uid, id, value) values (w, u, 'farming', 50), (w, u, 'forestry', 50)
    on conflict (world_id, uid, id) do update set value = 50;
  v_t := '';
  foreach v_n in array array[0, 1, 2, 3] loop
    perform pg_temp.hold(w, u, '{}');
    v_t := v_t || (reap_what(w, u, 'wheat', v_n, 30, 50)).o_got || ':';
    perform pg_temp.hold(w, u, array[${q(P('abundance').id)}]);
    v_t := v_t || (reap_what(w, u, 'wheat', v_n, 30, 50)).o_got || ',';
  end loop;
  insert into said values ('ABUNDANCE', v_t);
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  perform land_set_tile(w, tx + 1, ty, tile_id('Tree'));
  perform land_set_data(w, tx + 1, ty, ${packTreeData(FRUIT_TREE, 2)});
  v_a := 0; v_b := 0;
  for i in 1..20 loop
    perform pg_temp.hold(w, u, '{}');
    perform setseed(0.001 * i);
    delete from foraged where world_id = w;
    perform act_perform(w, u, 'pick_fruit', jsonb_build_object('kind', 'tile', 'x', tx + 1, 'y', ty));
    v_a := v_a + coalesce((select sum(count) from item where world_id = w and holder = 'player' and holder_uid = u), 0);
    delete from item where world_id = w and holder = 'player' and holder_uid = u;
    perform pg_temp.hold(w, u, array[${q(P('abundance').id)}]);
    perform setseed(0.001 * i);
    delete from foraged where world_id = w;
    perform act_perform(w, u, 'pick_fruit', jsonb_build_object('kind', 'tile', 'x', tx + 1, 'y', ty));
    v_b := v_b + coalesce((select sum(count) from item where world_id = w and holder = 'player' and holder_uid = u), 0);
    delete from item where world_id = w and holder = 'player' and holder_uid = u;
  end loop;
  insert into said values ('FRUIT', v_a || '|' || v_b);
  perform land_set_tile(w, tx + 1, ty, tile_id('Grass')); perform land_set_data(w, tx + 1, ty, 0);

  -- Steady Herd: a fight far past the leash, given up without it and kept with it.
  h1 := creature_spawn(w, 'rabba', tx + 25.5, ty + 0.5, 'wild', now() - interval '1 day');
  update creature set enemy = h1, stance = 'defensive', heel_until = null where world_id = w and id = c1;
  perform pg_temp.hold(w, u, '{}');
  v_t := coalesce((companion_target(w, (select c from creature c where c.world_id = w and c.id = c1),
                                    (select p from player p where p.world_id = w and p.uid = u))).id::text, 'none');
  perform pg_temp.hold(w, u, array[${q(P('steady_herd').id)}]);
  insert into said values ('STEADY', v_t || '|' || coalesce((companion_target(w, (select c from creature c where c.world_id = w and c.id = c1),
                                    (select p from player p where p.world_id = w and p.uid = u))).id::text, 'none') || '|' || h1);
  update creature set enemy = null where world_id = w and id = c1;
  delete from creature where world_id = w and id = h1;

  -- Long Table: a knack's time.
  perform pg_temp.hold(w, u, '{}');
  update player set boons = '[]'::jsonb where world_id = w and uid = u;
  perform grant_boon(w, u, 'baked_potato', 50, 1);
  v_a := (select (b->>'until')::double precision - world_time(w) from player, jsonb_array_elements(boons) b where world_id = w and uid = u limit 1);
  perform pg_temp.hold(w, u, array[${q(P('long_table').id)}]);
  update player set boons = '[]'::jsonb where world_id = w and uid = u;
  perform grant_boon(w, u, 'baked_potato', 50, 1);
  v_b := (select (b->>'until')::double precision - world_time(w) from player, jsonb_array_elements(boons) b where world_id = w and uid = u limit 1);
  insert into said values ('TABLE', v_a || '|' || v_b || '|' || boon_time('baked_potato', 50, 1));

  -- Good Stock: what a breeding passes to the blood, and what it adds to the dice.
  perform pg_temp.hold(w, u, array[${q(P('good_stock').id)}]);
  insert into said values ('STOCK', path_fx(w, u, 'up', 0) || '|'
    || (pg_get_functiondef('pair_them(uuid, integer, integer, double precision, uuid, text)'::regprocedure)
          ~ 'pk\\(p_world, p_uid, ''breed:upgrade'', 0\\) \\+ path_fx\\(p_world, p_uid, ''up'', 0\\)')::text);
  v_n := 0; v_d := 0;
  perform setseed(0.77);
  for i in 1..400 loop
    v_n := v_n + (select count(*) from jsonb_each_text(breed_traits(array['strong_back_1'], array['quick_1'], 20, 0.5, 0, 0)->'from') e where e.value = 'up');
  end loop;
  perform setseed(0.77);
  for i in 1..400 loop
    v_d := v_d + (select count(*) from jsonb_each_text(breed_traits(array['strong_back_1'], array['quick_1'], 20, 0.5, 0, path_fx(w, u, 'up', 0))->'from') e where e.value = 'up');
  end loop;
  insert into said values ('STOCKUP', v_n || '|' || v_d);
  -- And a pairing through the island's own door, read off the pick: the young one is carried.
  c2 := creature_spawn(w, 'rabba', tx + 1.3, ty + 0.5, 'deed', now() - interval '3 hours', u);
  c3 := creature_spawn(w, 'rabba', tx + 0.7, ty + 0.5, 'deed', now() - interval '3 hours', u);
  update creature set sex = 'female' where world_id = w and id = c2;
  update creature set sex = 'male' where world_id = w and id = c3;
  perform pair_them(w, c2, c3, 50, u);
  insert into said values ('PAIRED', ((select unborn from creature where world_id = w and id = c2) is not null)::text);
  delete from creature where world_id = w and id in (c2, c3);

  -- Season's Hand: stamped at sowing; and in winter its field grows, where another stands still.
  perform set_config('wurm.season', 'winter', true);
  perform pg_temp.hold(w, u, '{}');
  insert into crop (world_id, x, y, id, sown_by) values (w, tx + 2, ty + 2, 'wheat', u);
  perform pg_temp.hold(w, u, array[${q(P('seasons_hand').id)}]);
  insert into crop (world_id, x, y, id, sown_by) values (w, tx + 3, ty + 2, 'wheat', u);
  -- A stage and a quarter of growing at a Season's Hand's winter rate: one stage, and a quarter of the next.
  update crop set stage = 0, stage_at = now() - make_interval(secs => 1.25 * (select stage_seconds from crop_def where id = 'wheat') / hand_winter())
   where world_id = w and y = ty + 2 and x in (tx + 2, tx + 3);
  perform crops_settle(w, tx + 2.5, ty + 2.5, 3);
  insert into said values ('HAND', (select string_agg(hand::text || ':' || stage, ',' order by x) from crop where world_id = w and y = ty + 2 and x in (tx + 2, tx + 3)));
  delete from caller where uid = u;
  r := rpc_ground(w, 20, true);
  insert into said values ('HANDREAD', coalesce((select (c->>'hand') || ':' || round((c->>'grown')::numeric) from jsonb_array_elements(r->'crops') c
    where (c->>'x')::int = tx + 3 and (c->>'y')::int = ty + 2), 'unsent') || '|' || round(0.25 * (select stage_seconds from crop_def where id = 'wheat')));
  -- And sown through the door, which says when it sprouts on its own clock.
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'wheat_seed', 30, 1);
  perform land_set_tile(w, tx + 4, ty + 2, tile_id('Field'));
  delete from event where uid = u;
  perform act_perform(w, u, 'plant_seed', jsonb_build_object('kind', 'tile', 'x', tx + 4, 'y', ty + 2, 'itemUid',
    (select id from item where world_id = w and holder_uid = u and def = 'wheat_seed' order by id desc limit 1)));
  insert into said values ('SOWN', coalesce((select hand::text from crop where world_id = w and x = tx + 4 and y = ty + 2), 'not sown') || '|'
    || coalesce((select text from event where uid = u and text like 'You sow%' order by n desc limit 1), 'nothing said'));
  perform set_config('wurm.season', '', true);
  delete from crop where world_id = w and x between tx - 12 and tx + 45 and y between ty - 12 and ty + 45;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;

  -- Bloom: the trees round a sitting grow a stage, once a day; a dying one, a clipped one and one beyond reach do not.
  perform pg_temp.hold(w, u, array[${q(P('bloom').id)}]);
  perform land_set_tile(w, tx + 1, ty, tile_id('Tree')); perform land_set_data(w, tx + 1, ty, ${packTreeData(0, 3)});
  perform land_set_tile(w, tx, ty + 2, tile_id('Tree')); perform land_set_data(w, tx, ty + 2, ${packTreeData(0, 1)});
  perform land_set_tile(w, tx - 1, ty, tile_id('Tree')); perform land_set_data(w, tx - 1, ty, ${packTreeData(0, 4)});
  perform land_set_tile(w, tx, ty - 1, tile_id('Tree')); perform land_set_data(w, tx, ty - 1, ${packTreeData(0, 6)});
  perform land_set_tile(w, tx + ${P('bloom').fx.bloom + 2}, ty, tile_id('Tree')); perform land_set_data(w, tx + ${P('bloom').fx.bloom + 2}, ty, ${packTreeData(0, 3)});
  delete from event where uid = u;
  update player set sat_at = null, act = null, struck_at = null, bloom_day = null where world_id = w and uid = u;
  perform perform_faith(w, u, 'meditate', jsonb_build_object('kind', 'tile', 'x', tx, 'y', ty));
  insert into said values ('BLOOM', (select string_agg(tree_age(land_data(w, x, y))::text, ',' order by n)
      from unnest(array[tx + 1, tx, tx - 1, tx, tx + ${P('bloom').fx.bloom + 2}], array[ty, ty + 2, ty, ty - 1, ty]) with ordinality z(x, y, n))
    || '|' || coalesce((select text from event where uid = u and text like 'The trees round you%' order by n desc limit 1), 'nothing said')
    || '|' || ((select bloom_day from player where world_id = w and uid = u) = floor(world_time(w) / day_seconds()))::text);
  perform perform_faith(w, u, 'meditate', jsonb_build_object('kind', 'tile', 'x', tx, 'y', ty));
  insert into said values ('BLOOMAGAIN', (select string_agg(tree_age(land_data(w, x, y))::text, ',' order by n)
      from unnest(array[tx + 1, tx], array[ty, ty + 2]) with ordinality z(x, y, n)));
  update player set bloom_day = bloom_day - 1 where world_id = w and uid = u;
  perform perform_faith(w, u, 'meditate', jsonb_build_object('kind', 'tile', 'x', tx, 'y', ty));
  insert into said values ('BLOOMNEXT', (select string_agg(tree_age(land_data(w, x, y))::text, ',' order by n)
      from unnest(array[tx + 1, tx], array[ty, ty + 2]) with ordinality z(x, y, n)));
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

/* An old walker. */
check('an old walker of Love at 25 keeps the path and none of its steps: no Gentle hand by a step, no Refresh the old way',
  at('OLDSTEP') === 'false|none', at('OLDSTEP'));
check('and is refused a pick of the second tier, in the browser\'s words', at('TIER2') === pathPickRefusal(P('bond'), 'love', [], 25), at('TIER2'));
check('and takes one of the first, a technique onto the bar\'s path slot', at('TOOK') === `${P('refresh').id}|[null, null, null, null, null, "${P('refresh').id}"]`, at('TOOK'));
check('and the others of that tier close, ditto', at('SHUT') === pathPickRefusal(P('green_thumb'), 'love', [P('refresh').id], 25), at('SHUT'));
{
  const whys = JSON.parse(at('WHYS')) as Record<string, string | null>;
  const wrong = LOVE.filter((k) => (whys[k.id] ?? null) !== pathPickRefusal(k, 'love', [P('refresh').id], 25));
  check('the Faith window is told why each of Love\'s fifteen is refused, in the browser\'s words', !wrong.length && Object.keys(whys).length === 15,
    wrong.map((k) => `${k.id}: ${whys[k.id]}`).join('; '));
}

/* The techniques. */
{
  const k = P('refresh');
  check(`Refresh fills hunger and thirst, for ${k.cost} Calm, resting ${k.rest} seconds`, at('REFRESH') === `${REFRESH_SAID}|${CALM - k.cost}|${k.rest}|1:1`, at('REFRESH'));
  check('and is refused while it rests', part('RESTING', 0) === `${k.name} can be called again in ${k.rest} seconds.`, at('RESTING'));
  check('and short of Calm, in the browser\'s words', part('POOR', 0) === calmRefusal(k.name, k.cost, 2), at('POOR'));
}
{
  const k = P('bond');
  const [had, now, most] = [Number(part('BOND', 3)), ...part('BOND', 4).split(':').map(Number)];
  check(`Bond with no companion near is refused and costs nothing`, at('BONDNONE') === `${bondNone(k.fx.reach)}|${CALM}|none`, at('BONDNONE'));
  check(`Bond: a companion within ${k.fx.reach} tiles regains ${k.fx.heal} of its health, for ${k.cost} Calm, resting ${k.rest} seconds`,
    at('BOND').startsWith(`${bondSaid('Bun', k.fx.heal)}|${CALM - k.cost}|${k.rest}|`) && near(now, Math.min(most, had + most * k.fx.heal), 1e-3), at('BOND'));
  check('and one that is not hurt is refused, for nothing', at('BONDWHOLE') === `${bondWhole('Bun')}|${CALM}|none`, at('BONDWHOLE'));
  check(`and one further than ${k.fx.reach} tiles off is none near`, part('BONDFAR', 0) === bondNone(k.fx.reach), at('BONDFAR'));
}
{
  const k = P('gather');
  const spots = part('GATHER', 3).split(';').map((s) => s.split(',').map(Number));
  const [x, y] = [0.5, 0.5];
  const ring = (i: number, n: number): [number, number] => [x + Math.cos((2 * Math.PI * i) / n) * 0.8, y + Math.sin((2 * Math.PI * i) / n) * 0.8];
  check(`Gather brings the companion and a worker within ${k.fx.reach} tiles round you, in a ring, for ${k.cost} Calm, resting ${k.rest} seconds`,
    at('GATHER').startsWith(`${gatherSaid(2, 'Bun')}|${CALM - k.cost}|${k.rest}|`)
      && near(spots[0][0], ring(0, 2)[0], 1e-3) && near(spots[0][1], ring(0, 2)[1], 1e-3) && near(spots[1][0], ring(1, 2)[0], 1e-3) && near(spots[1][1], ring(1, 2)[1], 1e-3)
      && near(spots[2][1], k.fx.reach + 5.5, 1e-3), at('GATHER'));
  check('and with none of yours within reach it is refused, for nothing', at('GATHERNONE') === `${gatherNone(k.fx.reach)}|${CALM}|none`, at('GATHERNONE'));
}
{
  const k = P('lull');
  check(`Lull stops what is hunting you within ${k.fx.reach} tiles and holds it off ${k.fx.secs} seconds; one further off hunts on`,
    at('LULL') === `${lullSaid(1, k.fx.secs)}|${CALM - k.cost}|${k.rest}|none:${k.fx.secs}|true`, at('LULL'));
  check('and with nothing hunting you near it is refused, for nothing', at('LULLNONE') === `${lullNone(k.fx.reach)}|${CALM}|none`, at('LULLNONE'));
}
{
  const k = P('herd_heart');
  check('Heart of the Herd with nothing following you is refused, for nothing', at('HERDNONE') === `${HERD_NONE}|${CALM}|none`, at('HERDNONE'));
  check(`Heart of the Herd: for ${k.fx.secs} seconds the companion within ${k.fx.reach} tiles takes ${1 - k.fx.cut} of a blow and deals ${1 + k.fx.more} times, for ${k.cost} Calm, resting ${k.rest}`,
    at('HERD') === `${herdSaid('Bun', k.fx.secs, k.fx.cut, k.fx.more, k.fx.reach)}|${CALM - k.cost}|${k.rest}|1|${1 - k.fx.cut}|${1 + k.fx.more}|${1 + k.fx.more}|${k.fx.secs}`, at('HERD'));
  check('and nothing for one further off than its reach', at('HERDFAR') === '1', at('HERDFAR'));
  check('and the beat says how long it has left, and nothing of a Surge never cast', Number(part('BEAT', 0)) > k.fx.secs - 5 && part('BEAT', 1) === '0', at('BEAT'));
}

/* The disciplines. */
{
  const [plain, green, off] = at('GREEN').split('|').map(Number);
  check(`Green Thumb: a stage on your settlement takes ${P('green_thumb').fx.grow} of its time, and nowhere else`,
    near(green, plain * P('green_thumb').fx.grow) && near(off, plain), at('GREEN'));
  const [t0, t1, t2] = at('TAME').split('|').map(Number);
  check(`Gentle Hand: a tame's chance ${P('gentle_hand').fx.tame} times`, near(t1, t0 * P('gentle_hand').fx.tame) && t1 < 0.95, at('TAME'));
  check('Old Friend: a kind you never tamed at the plain chance, one you have at certain', near(t2, t0) && at('FRIEND') === '1', `${at('TAME')} / ${at('FRIEND')}`);
  check('and through the door, five offerings out of five are taken', at('FRIENDTAMES') === '5', at('FRIENDTAMES'));
  const fx = P('kin').fx['kept:age'];
  check(`Kin: taken, it is stamped on the beasts you keep (kept:age ${fx}), and one ${1.2} times as old as young is still young`,
    at('KIN') === `none:grown|{"kept:age": ${fx}}:young|young`, at('KIN'));
  check('and one past old is still grown', at('KINOLD') === 'old:grown', at('KINOLD'));
  const ab = at('ABUNDANCE').split(',').filter((x) => x).map((x) => x.split(':').map(Number));
  check(`Abundance: a harvest at every tending is ${P('abundance').fx.harvest} times, rounded as the browser rounds`,
    ab.length === 4 && ab.every(([plain, more], t) => plain === cropYield(t).produce && more === Math.max(1, Math.round(cropYield(t).produce * P('abundance').fx.harvest))), at('ABUNDANCE'));
  const [f0, f1] = at('FRUIT').split('|').map(Number);
  check(`and twenty pickings of fruit come to about ${P('abundance').fx.harvest} times, the same dice`, f1 > f0 && Math.abs(f1 / f0 - P('abundance').fx.harvest) < 0.12, at('FRUIT'));
  check('Steady Herd: a fight its keeper has left behind is given up without it and kept with it', at('STEADY') === `none|${part('STEADY', 2)}|${part('STEADY', 2)}`, at('STEADY'));
  const [b0, b1, knack] = at('TABLE').split('|').map(Number);
  check(`Long Table: a knack lasts ${P('long_table').fx.table} times as long`, near(b0, knack, 1e-3) && near(b1, knack * P('long_table').fx.table, 1e-3), at('TABLE'));
  check(`Good Stock: ${P('good_stock').fx.up} more on the chance a trait comes out a grade better, read where the breeding reads it`, at('STOCK') === `${P('good_stock').fx.up}|true`, at('STOCK'));
  const [u0, u1] = at('STOCKUP').split('|').map(Number);
  check('and four hundred young ones on the same dice come out a grade better more often with it', u1 > u0, at('STOCKUP'));
  check('and a pairing through the door goes, the pick read on the way', at('PAIRED') === 'true', at('PAIRED'));
  check('Season\'s Hand: stamped on what its taker sows and not before; in winter that field grows a stage where the other stands still',
    at('HAND') === 'false:0,true:1', at('HAND'));
  const [flag, grown] = part('HANDREAD', 0).split(':');
  check('and sown through the door it is stamped, and says when it sprouts on its clock, which never waits for spring',
    part('SOWN', 0) === 'true' && /^You sow wheat\. Sprouting in \d/.test(part('SOWN', 1)), at('SOWN'));
  check('and the ground read says so, with how far it has grown on its clock', flag === 'true' && Math.abs(Number(grown) - Number(part('HANDREAD', 1))) <= 1, at('HANDREAD'));
  const grows = new Map(LAND_GROWS);
  check(`Bloom: a sitting grows the trees within ${P('bloom').fx.bloom} tiles a stage, and not a very old one, a clipped one or one beyond reach`,
    at('BLOOM') === `${grows.get(3)},${grows.get(1)},4,6,3|The trees round you grow while you sit: 2 of them, a stage each.|true`, at('BLOOM'));
  check('and only once a day of the island\'s clock', at('BLOOMAGAIN') === `${grows.get(3)},${grows.get(1)}`, at('BLOOMAGAIN'));
  check('and again the next', at('BLOOMNEXT') === `${grows.get(grows.get(3) as number)},${grows.get(grows.get(1) as number)}`, at('BLOOMNEXT'));
}

/* ---- In the browser -------------------------------------------------------------- */

const g = Game.create(4243);
g.rand = mulberry32(4243);
// Late enough in the game's own clock that a creature can be born before it.
g.time = 1e7;
const p = g.player;
p.way = 'love';
g.skills.values.set(MEDITATION, 99);
const hold = (...ids: string[]): void => {
  p.picks = ids.map((id) => P(id).id);
  g.refreshKept();
};
{
  // An old walker: a pick at the first tier, refused at the second.
  g.skills.values.set(MEDITATION, 25);
  hold();
  check('the browser: an old walker at 25 is refused the second tier and takes the first, in the island\'s words',
    g.takePathPick(P('bond').id) === pathPickRefusal(P('bond'), 'love', [], 25) && g.takePathPick(P('refresh').id) === null
      && p.picks.includes(P('refresh').id), p.picks.join(','));
  check(`and the first tier is the one ${CHOOSE_AT} opens`, PATH_TIER_AT[0] === CHOOSE_AT);
  g.skills.values.set(MEDITATION, 99);
}
{
  hold(...TECHNIQUES.map((k) => k.id.slice('love_'.length)));
  p.calm = CALM;
  p.stats.hunger = 0.2;
  p.stats.thirst = 0.1;
  const why = g.castTechnique(P('refresh').id);
  check('Refresh in the browser: hunger and thirst full, its Calm paid and its rest begun', why === null && p.stats.hunger === 1 && p.stats.thirst === 1
    && p.calm === CALM - P('refresh').cost && g.techniqueRefusal(P('refresh').id) === `Refresh can be called again in ${P('refresh').rest} seconds.`, `${why}`);
  p.calm = 3;
  p.usedAt = {};
  check('and short of Calm it is refused in the island\'s words', g.techniqueRefusal(P('bond').id) === calmRefusal('Bond', P('bond').cost, 3));
  p.calm = CALM;
  // Bond: none near, then one hurt, then whole.
  check('Bond with none near: the island\'s words, and nothing paid', g.castTechnique(P('bond').id) === bondNone(P('bond').fx.reach) && p.calm === CALM);
  const c = g.creatures.spawn('rabba', p.x + 3, p.y, 'active', g.rand, g.time - 1e6);
  c.name = 'Bun';
  const most = maxHealth(c, SPECIES.rabba);
  c.health = most / 2;
  const said: string[] = [];
  const log = g.logMsg.bind(g);
  g.logMsg = (m: string, k?: never) => { said.push(m); log(m, k); };
  g.castTechnique(P('bond').id);
  check(`Bond in the browser: ${P('bond').fx.heal} of its health back, said in the island's words`, near(c.health, most / 2 + most * P('bond').fx.heal)
    && said.includes(bondSaid('Bun', P('bond').fx.heal)), `${c.health} of ${most}`);
  p.usedAt = {};
  c.health = most;
  check('and a whole one is refused', g.castTechnique(P('bond').id) === bondWhole('Bun'));
  // Gather: the companion and a worker within reach, round you; one beyond it stays.
  c.x = p.x + 12;
  p.calm = CALM;
  p.usedAt = {};
  const near1 = g.creatures.spawn('rabba', p.x, p.y + 20, 'deed', g.rand, g.time - 1e6);
  const far1 = g.creatures.spawn('rabba', p.x, p.y + P('gather').fx.reach + 5, 'deed', g.rand, g.time - 1e6);
  const farY = far1.y;
  said.length = 0;
  g.castTechnique(P('gather').id);
  const ids = [c, near1].sort((a, b) => a.id - b.id);
  check('Gather in the browser: the two within reach in a ring round you, the one beyond left, said as the island says it',
    near(ids[0].x, p.x + 0.8, 1e-9) && near(ids[0].y, p.y, 1e-9) && near(ids[1].x, p.x - 0.8, 1e-9) && far1.y === farY
      && said.includes(gatherSaid(2, ids[0].name)), `${ids.map((k) => `${k.x},${k.y}`).join(' ')} ${said.join(' / ')}`);
  g.creatures.list.delete(near1.id);
  g.creatures.list.delete(far1.id);
  // Lull: one hunting within reach stops and rests; one beyond hunts on.
  p.calm = CALM;
  p.usedAt = {};
  const h1 = g.creatures.spawn('rabba', p.x + 4, p.y, 'wild', g.rand, g.time - 1e6);
  const h2 = g.creatures.spawn('rabba', p.x + P('lull').fx.reach + 4, p.y, 'wild', g.rand, g.time - 1e6);
  h1.enemy = -1;
  h2.enemy = -1;
  said.length = 0;
  const lullWhy = g.castTechnique(P('lull').id);
  check('Lull in the browser: the near one stops and takes no interest for its seconds, the far one hunts on',
    lullWhy === null && h1.enemy === null && near(h1.huntRest, g.time + P('lull').fx.secs) && h2.enemy === -1 && said.includes(lullSaid(1, P('lull').fx.secs)),
    `${lullWhy} ${h1.enemy} ${h2.enemy}`);
  h2.enemy = null;
  p.usedAt = {};
  p.calm = CALM;
  check('and with none near it is refused', g.castTechnique(P('lull').id) === lullNone(P('lull').fx.reach));
  g.creatures.list.delete(h1.id);
  g.creatures.list.delete(h2.id);
  // Heart of the Herd: on the companion near you, and nothing on it beyond reach.
  c.x = p.x + 2;
  p.calm = CALM;
  p.usedAt = {};
  g.castTechnique(P('herd_heart').id);
  const k = P('herd_heart');
  const inside = [g.herdMul(c, 'taken'), g.herdMul(c, 'dealt')];
  c.x = p.x + k.fx.reach + 3;
  check('Heart of the Herd in the browser: the same two numbers on the companion near you, one beyond reach',
    near(inside[0], 1 - k.fx.cut) && near(inside[1], 1 + k.fx.more) && g.herdMul(c, 'taken') === 1, inside.join(','));
  c.x = p.x + 2;
  g.logMsg = log;
}
{
  // The disciplines, read where the browser reads them.
  const c = [...g.creatures.list.values()].find((k) => k.mode === 'active');
  if (!c) throw new Error('no companion');
  g.deed = { name: 'Love\'s Acre', x: p.tileX, y: p.tileY, radius: 6 };
  const crop = g.plantCrop(p.tileX + 1, p.tileY + 1, 'wheat', 30);
  hold();
  const plain = g.cropPer(crop);
  hold('green_thumb');
  check('Green Thumb in the browser: the island\'s share', near(g.cropPer(crop), plain * P('green_thumb').fx.grow));
  g.deed = null;
  g.crops.clear();
  const wild = g.creatures.spawn('rabba', p.x + 1, p.y, 'wild', g.rand, g.time - 1e6);
  g.skills.values.set('taming', 1);
  hold();
  const t0 = tameChance(g, wild);
  hold('gentle_hand');
  const t1 = tameChance(g, wild);
  hold('old_friend');
  const t2 = tameChance(g, wild);
  g.guide.mark('rabba', 'tamed');
  check('Gentle Hand and Old Friend in the browser: the same share, and certain for a tamed kind',
    near(t1, t0 * P('gentle_hand').fx.tame) && near(t2, t0) && tameChance(g, wild) === 1, `${t0} ${t1} ${t2} ${tameChance(g, wild)}`);
  g.creatures.list.delete(wild.id);
  // Kin: an age read at the pace, offline off your own pick.
  hold();
  c.born = g.time - YOUNG_FOR * 1.2;
  const before = ageOf(c, g.time);
  hold('kin');
  const after = ageOf(c, g.time);
  c.born = g.time - OLD_AT * 1.1;
  check('Kin in the browser: one 1.2 times as old as young is still young, and one past old still grown',
    before === 'grown' && after === 'young' && ageOf(c, g.time) === 'grown', `${before} ${after} ${ageOf(c, g.time)}`);
  setLocalKept({});
  c.born = g.time - 1e6;
  // Abundance: a harvest off a field, through the job.
  const harvest = ACTION_BY_ID.get('harvest_crop');
  const reap = (): number => {
    const cr = g.plantCrop(p.tileX + 1, p.tileY, 'wheat', 30);
    cr.stage = RIPE;
    cr.tended = RIPE;
    const tgt: Target = { kind: 'tile', x: cr.x, y: cr.y, cx: cr.x, cy: cr.y };
    const was = g.inventory.items.filter((it) => it.id === 'wheat').reduce((n, it) => n + it.count, 0);
    harvest?.perform(tgt, g);
    return g.inventory.items.filter((it) => it.id === 'wheat').reduce((n, it) => n + it.count, 0) - was;
  };
  hold();
  const r0 = reap();
  hold('abundance');
  const r1 = reap();
  check('Abundance in the browser: a harvest at every tending the island\'s number', r0 === cropYield(RIPE).produce
    && r1 === Math.max(1, Math.round(cropYield(RIPE).produce * P('abundance').fx.harvest)), `${r0} ${r1}`);
  // Long Table.
  hold();
  p.boons = [];
  g.grantBoon('baked_potato', 50, 1);
  const b0 = (p.boons[0]?.until ?? 0) - g.time;
  hold('long_table');
  p.boons = [];
  g.grantBoon('baked_potato', 50, 1);
  const b1 = (p.boons[0]?.until ?? 0) - g.time;
  check('Long Table in the browser: the island\'s share longer', near(b0, boonTime('baked_potato', 50, 1)) && near(b1, b0 * P('long_table').fx.table), `${b0} ${b1}`);
  // Good Stock: the young of a pairing, the same dice with it and without.
  const dam = g.creatures.spawn('rabba', p.x + 1, p.y, 'deed', g.rand, g.time - 1e6);
  const sire = g.creatures.spawn('rabba', p.x - 1, p.y, 'deed', g.rand, g.time - 1e6);
  const ups = (picks: string[]): number => {
    hold(...picks);
    g.rand = mulberry32(99);
    let n = 0;
    for (let i = 0; i < 400; i++) {
      g.creatures.pair(g, dam, sire, 20);
      n += Object.values(dam.unborn?.from ?? {}).filter((s) => s === 'up').length;
    }
    return n;
  };
  const u0 = ups([]);
  const u1 = ups(['good_stock']);
  check('Good Stock in the browser: more come out a grade better on the same dice', u1 > u0 && g.pathFx('up', 0) === P('good_stock').fx.up, `${u0} ${u1}`);
  g.rand = mulberry32(4243);
  // Season's Hand: what you sow is stamped, and grows on its clock.
  hold();
  const plainCrop = g.plantCrop(p.tileX + 2, p.tileY + 2, 'wheat', 30);
  hold('seasons_hand');
  const handCrop = g.plantCrop(p.tileX + 3, p.tileY + 2, 'wheat', 30);
  check('Season\'s Hand in the browser: stamped on what its taker sows, on its clock', !plainCrop.hand && handCrop.hand === true && handCrop.stageAt === g.handNow());
  g.crops.clear();
  // Steady Herd: read where a companion asks whether to give a fight up.
  hold('steady_herd');
  check('Steady Herd in the browser: the discipline a companion\'s leash is read past', g.pathFx('steady', 0) === P('steady_herd').fx.steady);
  // Bloom: the trees round you, once a day.
  hold('bloom');
  const tree = (dx: number, dy: number, age: number): [number, number] => {
    g.world.setTile(p.tileX + dx, p.tileY + dy, TileType.Tree, packTreeData(0, age));
    return [p.tileX + dx, p.tileY + dy];
  };
  // The ground round you cleared of what the island grew there, and five trees put down.
  for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) g.world.setTile(p.tileX + dx, p.tileY + dy, TileType.Grass, 0);
  const spots = [tree(1, 0, 3), tree(0, 2, 1), tree(-1, 0, 4), tree(0, -1, 6), tree(P('bloom').fx.bloom + 2, 0, 3)];
  p.pathTimes = {};
  const n1 = g.bloomSitting();
  const ages = spots.map(([x, y]) => treeVariant(g.world.getData(x, y))).join(',');
  const n2 = g.bloomSitting();
  check('Bloom in the browser: the same trees grow, once a day', n1 === 2 && n2 === 0 && ages === at('BLOOM').split('|')[0], `${n1} ${n2} ${ages}`);
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Love path on its tiers, the same on both sides — ${ok.length} of ${ok.length}`);
