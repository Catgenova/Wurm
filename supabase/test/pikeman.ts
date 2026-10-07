/**
 * The Pikeman: twelve spells and six passives in six tiers that open on the
 * trade's own level, on the island (`the_pikeman.sql`) and in the browser's
 * rulebook (`talents.ts`, `perks.ts`).
 *
 * What this asks:
 *
 *   * both sides hold the same twelve spells, field for field, and the same
 *     tiers;
 *   * every spell does what its note says, measured: a blow at its share of the
 *     one a swing would land -- the same roll asked twice, of two creatures
 *     alike -- as far past your reach as it says and no further, a creature
 *     slowed, warned off, dragged, pushed back, run through, met at the edge
 *     of your reach, and stamina back for everybody near;
 *   * the door charges its stamina and its rest;
 *   * and every passive moves the number it names at the rule it changes, on
 *     the island, with the browser's fold the island's.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { CLASS_TIER_AT } from '../../src/game/classes';
import { HUNT_REACH, reachOf, STAGGER_POLE } from '../../src/game/fight';
import { WEAPON_BY_ID } from '../../src/game/gear';
import { SPELL_BAR } from '../../src/game/patrons';
import { foldPerks, perksOf, PERK_BY_ID, TIERS } from '../../src/game/perks';
import { CLASS_SPELL_BY_ID, classSpellsOf, type ClassSpellDef } from '../../src/game/talents';

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
const near = (a: number, b: number, by = 1e-9): boolean => Math.abs(a - b) <= by;
const pct = (x: number): string => `${Math.round(x * 100)}%`;

const SPELLS = classSpellsOf('pikeman');
const spell = (slug: string): ClassSpellDef => {
  const s = CLASS_SPELL_BY_ID.get(`pikeman_${slug}`);
  if (!s) throw new Error(`no pikeman_${slug}`);
  return s;
};
const fx = (slug: string, k: string): number => spell(slug).fx[k];
const PASSIVES = perksOf('pikeman').filter((p) => !CLASS_SPELL_BY_ID.has(p.id));
/** What the six passives fold to, which is what the browser reads a Pikeman's numbers from. */
const FOLD = foldPerks(PASSIVES.map((p) => p.id));
const FIRST_CLASS_SLOT = SPELL_BAR.indexOf('class');
/** A spear's reach before anybody's perks. */
const SPEAR_REACH = reachOf(WEAPON_BY_ID.get('spear')!);
const SWORD_REACH = reachOf(WEAPON_BY_ID.get('sword')!);

/**
 * A blow spell and how its reference swing is asked: alike in all but its
 * share, the two creatures `dist` tiles off on either side of you so that
 * neither is behind the other, and `crit` the reference's critical share.
 */
interface Blow { slug: string; dist: number; crit: number; want: number; key: string }
const BLOWS: Blow[] = [
  { slug: 'overreach', dist: 2, crit: 1, want: fx('overreach', 'more'), key: 'overreach' },
  { slug: 'sweep_the_legs', dist: 2, crit: 1, want: fx('sweep_the_legs', 'more'), key: 'sweep_the_legs' },
  { slug: 'vital_thrust', dist: 2, crit: fx('vital_thrust', 'crit'), want: fx('vital_thrust', 'more'), key: 'vital_thrust' },
  { slug: 'reach_advantage', dist: 2, crit: 1, want: fx('reach_advantage', 'more'), key: 'reach_advantage:outside' },
  { slug: 'reach_advantage', dist: 0.8, crit: 1, want: fx('reach_advantage', 'whole'), key: 'reach_advantage:inside' },
  { slug: 'skewer', dist: 2, crit: 1, want: fx('skewer', 'more'), key: 'skewer' },
];

/** A spell's row as the island prints it and as the browser would: every field, the numbers by name. */
const rowOf = (s: ClassSpellDef): string =>
  [s.id, s.class, s.num, s.name, s.cost, s.rest, s.on.join('+'),
    Object.keys(s.fx).sort().map((k) => `${k}=${s.fx[k]}`).join(';'), s.note, s.needs ?? '-'].join('¦');

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w record; o uuid; v_px double precision; v_py double precision; r jsonb; c creature;
        a int; b int; t int; k int; n int; v_spear bigint; v_sword bigint;
        h0 double precision; d1 double precision; v_seed double precision;
        m0 double precision; m1 double precision; x int; y int; z int;
begin
  -- An island with land and two people on it.
  select p.world_id, p.uid, wd.spawn_x, wd.spawn_y into w from player p join world wd on wd.id = p.world_id
   where exists (select 1 from land_tile lt where lt.world_id = wd.id)
     and (select count(*) from player q2 where q2.world_id = p.world_id) >= 2
   order by wd.size desc, p.world_id, p.uid limit 1;
  select uid into o from player where world_id = w.world_id and uid <> w.uid order by uid limit 1;
  v_px := w.spawn_x + peace_reach() + 10.5; v_py := w.spawn_y + 0.5;
  update placed set driver = null where world_id = w.world_id and driver in (w.uid, o);
  update player set x = v_px, y = v_py, level = 0, aboard = null, away = false, act = null, act_target = null,
         act_ends = null, equipped = '{}'::jsonb, wounds = '[]'::jsonb, fight_stance = 'balanced', blessings = '{}'::jsonb,
         used_at = '{}'::jsonb, body_at = now(), craft_class = null, combat_class = null, class_mul = null, class_level = 0,
         moved_at = now() - interval '1 hour',
         spell_bar = (select jsonb_agg('null'::jsonb) from spell_slot),
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('health', 1, 'hunger', 1, 'thirst', 1, 'stamina', 1, 'aegis', 0)
   where world_id = w.world_id and uid in (w.uid, o);
  update player set x = v_px - 30 where world_id = w.world_id and uid = o;
  insert into skill (world_id, uid, id, value)
    select w.world_id, w.uid, s, v from
      (values ('polearms', 100::double precision), ('swords', 100), ('fighting', 100), ('body_control', 1), ('shields', 1)) sv(s, v)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  delete from event where uid in (w.uid, o);
  delete from player_node where world_id = w.world_id and uid in (w.uid, o);
  delete from player_spell where world_id = w.world_id and uid in (w.uid, o);
  delete from creature where world_id = w.world_id and to_x between v_px - 45 and v_px + 45 and to_y between v_py - 45 and v_py + 45;
  delete from class_mark where world_id = w.world_id;
  delete from faith_owed where world_id = w.world_id;
  delete from faith_zone where world_id = w.world_id;
  delete from caller where uid in (w.uid, o);
  perform set_config('request.jwt.claims', json_build_object('sub', w.uid)::text, true);
  v_spear := give(w.world_id, w.uid, 'spear', 1, 40);
  v_sword := give(w.world_id, w.uid, 'sword', 1, 40);
  update player set equipped = jsonb_build_object('weapon', v_spear) where world_id = w.world_id and uid = w.uid;

  /* ---- The rows ---- */
  insert into said select 'SPELL:' || id, id || '¦' || class || '¦' || num || '¦' || name || '¦' || cost || '¦' || rest || '¦'
      || array_to_string(on_what, '+') || '¦' || coalesce((select string_agg(e.k || '=' || e.v, ';' order by e.k) from jsonb_each_text(fx) e(k, v)), '')
      || '¦' || note || '¦' || coalesce(needs, '-')
    from class_spell where class = 'pikeman';

  insert into said values ('TAKE', coalesce(rpc_take_class(w.world_id, 'pikeman')->>'why', 'took'));
  -- Every spell known from here, as though a tier had been taken six times over; the passives come later.
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, cs.id from class_spell cs where cs.class = 'pikeman'
    on conflict do nothing;

  /* ---- A blow with a spell, at its share of a swing's: the same roll, asked twice ---- */
  ${BLOWS.map((bl) => `
  a := creature_spawn(w.world_id, 'ogre', v_px - ${bl.dist}, v_py, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'ogre', v_px + ${bl.dist}, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, enemy = null, hunt_again = null, settled_at = now(),
         until = now() + interval '1 hour', windup_at = null where world_id = w.world_id and id in (a, b);
  update creature set health = max_health(creature) where world_id = w.world_id and id in (a, b);
  for k in 1..12 loop
    v_seed := k / 100.0;
    update item set dmg = 0 where id = v_spear;
    perform setseed(v_seed);
    perform creature_settle(w.world_id, a);
    r := class_blow(w.world_id, w.uid, a, 1, false, null, 1, ${bl.crit});
    exit when (r->>'landed')::boolean;
    update creature set health = max_health(creature), hunting = w.uid, enemy = null,
           settled_at = now(), until = now() + interval '1 hour', windup_at = null where world_id = w.world_id and id = a;
  end loop;
  d1 := (r->>'dmg')::double precision;
  update item set dmg = 0 where id = v_spear;
  perform setseed(v_seed);
  r := class_spell_cast(w.world_id, w.uid, 'pikeman_${bl.slug}', jsonb_build_object('kind', 'enemy', 'id', b));
  insert into said values ('BLOW:${bl.key}', ((r->'blow'->>'dmg')::double precision / d1) || '|' || coalesce(r->'blow'->>'landed', r->>'why'));
  ${bl.slug === 'sweep_the_legs' ? `
  insert into said select 'SWEEP', slow || '|' || extract(epoch from slow_until - now()) || '|' || (r->>'said')
    from creature where world_id = w.world_id and id = b;` : ''}
  delete from creature where world_id = w.world_id and id in (a, b);`).join('')}

  /* ---- Overreach: past your reach as far as it says, and no further ---- */
  a := creature_spawn(w.world_id, 'ogre', v_px + ${SPEAR_REACH} + ${fx('overreach', 'past')} - 0.5, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, until = now() + interval '1 hour' where world_id = w.world_id and id = a;
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  insert into said values ('REACH:PAST', coalesce(class_spell_cast(w.world_id, w.uid, 'pikeman_overreach', jsonb_build_object('kind', 'enemy', 'id', a))->>'why', 'struck')
    || '|' || coalesce(class_spell_cast(w.world_id, w.uid, 'pikeman_vital_thrust', jsonb_build_object('kind', 'enemy', 'id', a))->>'why', 'struck'));
  update creature set to_x = v_px + ${SPEAR_REACH} + ${fx('overreach', 'past')} + 0.5, from_x = v_px + ${SPEAR_REACH} + ${fx('overreach', 'past')} + 0.5
    where world_id = w.world_id and id = a;
  insert into said values ('REACH:BEYOND', coalesce(class_spell_cast(w.world_id, w.uid, 'pikeman_overreach', jsonb_build_object('kind', 'enemy', 'id', a))->>'why', 'struck'));
  -- And it pays for the reach out of your own next swing.
  update creature set to_x = v_px + 2, from_x = v_px + 2, health = max_health(creature) where world_id = w.world_id and id = a;
  update player set act = 'attack_creature', act_target = jsonb_build_object('kind', 'creature', 'id', a),
         act_ends = now() + interval '1 second' where world_id = w.world_id and uid = w.uid;
  r := class_spell_cast(w.world_id, w.uid, 'pikeman_overreach', jsonb_build_object('kind', 'enemy', 'id', a));
  insert into said select 'REACH:WIND', extract(epoch from act_ends - now()) || '|' || (r->>'said') from player where world_id = w.world_id and uid = w.uid;
  update player set act = null, act_target = null, act_ends = null where world_id = w.world_id and uid = w.uid;
  delete from creature where world_id = w.world_id and id = a;

  /* ---- Vital Thrust: critical twice as often, the same rolls asked of both ---- */
  a := creature_spawn(w.world_id, 'ogre', v_px + 2, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, until = now() + interval '1 hour' where world_id = w.world_id and id = a;
  x := 0; y := 0; z := 0;
  for n in 1..2500 loop
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    -- And a spear that does not wear through in two and a half thousand blows.
    update item set dmg = 0 where id = v_spear;
    perform setseed(n / 2600.0);
    r := class_blow(w.world_id, w.uid, a, 1, true);
    if (r->>'crit')::boolean then x := x + 1; end if;
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    update item set dmg = 0 where id = v_spear;
    perform setseed(n / 2600.0);
    if (class_blow(w.world_id, w.uid, a, 1, true, null, 1, ${fx('vital_thrust', 'crit')})->>'crit')::boolean then
      y := y + 1;
    elsif (r->>'crit')::boolean then
      z := z + 1;
    end if;
  end loop;
  insert into said values ('VITAL', x || '|' || y || '|' || z);
  delete from creature where world_id = w.world_id and id = a;

  /* ---- Twin Thrust: two blows, the very rolls of two swings, and the creature down by both ---- */
  a := creature_spawn(w.world_id, 'ogre', v_px + 2, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, enemy = null, until = now() + interval '1 hour' where world_id = w.world_id and id = a;
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  update item set dmg = 0 where id = v_spear;
  perform setseed(0.06);
  select health into h0 from creature where world_id = w.world_id and id = a;
  perform creature_settle(w.world_id, a);
  d1 := 0;
  for n in 1..${fx('twin_thrust', 'blows')} loop
    d1 := d1 + (class_blow(w.world_id, w.uid, a, ${fx('twin_thrust', 'more')})->>'dmg')::double precision;
  end loop;
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  update item set dmg = 0 where id = v_spear;
  perform setseed(0.06);
  r := class_spell_cast(w.world_id, w.uid, 'pikeman_twin_thrust', jsonb_build_object('kind', 'enemy', 'id', a));
  insert into said select 'TWIN', round(((h0 - health) / greatest(d1, 1e-9))::numeric, 6)::text || '|' || (r->>'said')
    from creature where world_id = w.world_id and id = a;
  delete from creature where world_id = w.world_id and id = a;

  /* ---- Skewer: through the one struck into what is behind it in the line, and nothing else ---- */
  t := creature_spawn(w.world_id, 'ogre', v_px + 2, v_py, 'wild', now() - interval '2 hours', null);
  a := creature_spawn(w.world_id, 'ogre', v_px + 2 + ${fx('skewer', 'behind')} - 0.5, v_py + ${fx('skewer', 'width')} - 0.2, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'ogre', v_px + 3, v_py - ${fx('skewer', 'width')} - 0.3, 'wild', now() - interval '2 hours', null);
  k := creature_spawn(w.world_id, 'ogre', v_px + 2 + ${fx('skewer', 'behind')} + 0.6, v_py, 'wild', now() - interval '2 hours', null);
  n := creature_spawn(w.world_id, 'ogre', v_px + 1, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, enemy = null, until = now() + interval '1 hour', windup_at = null
    where world_id = w.world_id and id in (t, a, b, k, n);
  update creature set health = max_health(creature) where world_id = w.world_id and id in (t, a, b, k, n);
  perform setseed(0.07);
  r := class_spell_cast(w.world_id, w.uid, 'pikeman_skewer', jsonb_build_object('kind', 'enemy', 'id', t));
  insert into said select 'SKEWER', string_agg((health < max_health(cr))::text, ',' order by case id when t then 1 when a then 2 when b then 3 when k then 4 else 5 end)
      || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where world_id = w.world_id and id in (t, a, b, k, n);
  delete from creature where world_id = w.world_id and id in (t, a, b, k, n);

  /* ---- Warning Thrust: a hunter warned off does not come for you, alone or with its pack ---- */
  a := creature_spawn(w.world_id, 'ulva', v_px + 2, v_py, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'ulva', v_px - 2, v_py, 'wild', now() - interval '2 hours', null);
  t := creature_spawn(w.world_id, 'bura', v_px, v_py + 2, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = null, hunt_again = null, settled_at = now(), until = now() + interval '1 hour',
         home_x = to_x, home_y = to_y where world_id = w.world_id and id in (a, b, t);
  update creature set hunting = w.uid where world_id = w.world_id and id = a;
  insert into said values ('WARN:FIGHTING', class_spell_cast(w.world_id, w.uid, 'pikeman_warning_thrust', jsonb_build_object('kind', 'enemy', 'id', a))->>'why');
  insert into said values ('WARN:PREY', class_spell_cast(w.world_id, w.uid, 'pikeman_warning_thrust', jsonb_build_object('kind', 'enemy', 'id', t))->>'why');
  update creature set hunting = null where world_id = w.world_id and id = a;
  r := class_spell_cast(w.world_id, w.uid, 'pikeman_warning_thrust', jsonb_build_object('kind', 'enemy', 'id', a));
  update creature set until = now() - interval '1 second', settled_at = now() - interval '1 second' where world_id = w.world_id and id in (a, b);
  perform creature_settle(w.world_id, a);
  perform creature_settle(w.world_id, b);
  insert into said select 'WARN', string_agg(coalesce((hunting = w.uid)::text, 'none'), ',' order by case id when a then 1 else 2 end)
      || '|' || (select extract(epoch from until - now()) from class_mark where world_id = w.world_id and creature_id = a and kind = 'warned')
      || '|' || coalesce(r->>'said', r->>'why')
    from creature where world_id = w.world_id and id in (a, b);
  delete from creature where world_id = w.world_id and id in (a, b, t);

  /* ---- Hook: dragged its share nearer, never nearer than its least, and on you ---- */
  a := creature_spawn(w.world_id, 'ulva', v_px + 3.5, v_py, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'ulva', v_px, v_py - 2, 'wild', now() - interval '2 hours', null);
  t := creature_spawn(w.world_id, 'ulva', v_px - ${fx('hook', 'reach')} - 1, v_py, 'wild', now() - interval '2 hours', null);
  k := creature_spawn(w.world_id, 'ulva', v_px + 0.6, v_py + 0.6, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = null, hunt_again = now() + interval '1 hour', settled_at = now(),
         until = now() + interval '1 hour' where world_id = w.world_id and id in (a, b, t, k);
  insert into said values ('HOOK:FAR', class_spell_cast(w.world_id, w.uid, 'pikeman_hook', jsonb_build_object('kind', 'enemy', 'id', t))->>'why');
  insert into said values ('HOOK:FEET', class_spell_cast(w.world_id, w.uid, 'pikeman_hook', jsonb_build_object('kind', 'enemy', 'id', k))->>'why');
  r := class_spell_cast(w.world_id, w.uid, 'pikeman_hook', jsonb_build_object('kind', 'enemy', 'id', a));
  insert into said select 'HOOK', sqrt((to_x - v_px) ^ 2 + (to_y - v_py) ^ 2) || '|' || coalesce((hunting = w.uid)::text, 'none') || '|' || coalesce(r->>'said', r->>'why')
    from creature where world_id = w.world_id and id = a;
  r := class_spell_cast(w.world_id, w.uid, 'pikeman_hook', jsonb_build_object('kind', 'enemy', 'id', b));
  insert into said select 'HOOK:LEAST', sqrt((to_x - v_px) ^ 2 + (to_y - v_py) ^ 2) || '|' || coalesce(r->>'said', r->>'why')
    from creature where world_id = w.world_id and id = b;
  delete from creature where world_id = w.world_id and id in (a, b, t, k);

  /* ---- Rally the Line: stamina back for everybody near, you among them, and nobody further ---- */
  update player set x = v_px + ${fx('rally_the_line', 'reach')} - 1, stats = jsonb_set(stats, '{stamina}', '0.5') where world_id = w.world_id and uid = o;
  update player set stats = jsonb_set(stats, '{stamina}', '0.5') where world_id = w.world_id and uid = w.uid;
  r := class_spell_cast(w.world_id, w.uid, 'pikeman_rally_the_line', jsonb_build_object('kind', 'self'));
  insert into said select 'RALLY', string_agg(stats->>'stamina', ',' order by uid = w.uid desc) || '|' || coalesce(r->>'said', r->>'why')
    from player where world_id = w.world_id and uid in (w.uid, o);
  update player set x = v_px + ${fx('rally_the_line', 'reach')} + 1, stats = jsonb_set(stats, '{stamina}', '0.5') where world_id = w.world_id and uid = o;
  perform class_spell_cast(w.world_id, w.uid, 'pikeman_rally_the_line', jsonb_build_object('kind', 'self'));
  insert into said select 'RALLY:FAR', stats->>'stamina' from player where world_id = w.world_id and uid = o;
  update player set x = v_px - 30, stats = jsonb_set(stats, '{stamina}', '1') where world_id = w.world_id and uid in (o, w.uid);
  update player set x = v_px where world_id = w.world_id and uid = w.uid;

  /* ---- Keep Away: every blow that lands pushes it its share further off, swing or spell ---- */
  a := creature_spawn(w.world_id, 'ogre', v_px + 2, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, enemy = null, settled_at = now(), until = now() + interval '1 hour', windup_at = null
    where world_id = w.world_id and id = a;
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  r := class_blow(w.world_id, w.uid, a, 1, true);
  insert into said select 'KEEP:NONE', sqrt((to_x - v_px) ^ 2 + (to_y - v_py) ^ 2) from creature where world_id = w.world_id and id = a;
  r := class_spell_cast(w.world_id, w.uid, 'pikeman_keep_away', jsonb_build_object('kind', 'self'));
  insert into said values ('KEEP:SAID', r->>'said');
  r := class_blow(w.world_id, w.uid, a, 1, true);
  insert into said select 'KEEP:SPELL', sqrt((to_x - v_px) ^ 2 + (to_y - v_py) ^ 2) from creature where world_id = w.world_id and id = a;
  update creature set from_x = v_px + 2, to_x = v_px + 2, from_y = v_py, to_y = v_py, leg_at = now(), leg_ends = now(),
         until = now() + interval '1 hour' where world_id = w.world_id and id = a;
  for k in 1..12 loop
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    select health into h0 from creature where world_id = w.world_id and id = a;
    perform perform_fight(w.world_id, w.uid, 'attack_creature', jsonb_build_object('kind', 'creature', 'id', a));
    exit when (select health from creature where world_id = w.world_id and id = a) < h0;
  end loop;
  insert into said select 'KEEP:SWING', sqrt((to_x - v_px) ^ 2 + (to_y - v_py) ^ 2) from creature where world_id = w.world_id and id = a;
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  delete from creature where world_id = w.world_id and id = a;

  /* ---- Fend Off: whatever comes into its reach of you to strike is pushed back instead ---- */
  a := creature_spawn(w.world_id, 'ulva', v_px + 1, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, enemy = null, hunt_again = null, windup_at = null, fight_blows = 0,
         from_x = v_px + 1, to_x = v_px + 1, from_y = v_py, to_y = v_py, hunt_x = v_px + 1, hunt_y = v_py, home_x = v_px + 1, home_y = v_py,
         leg_at = now() - interval '1 second', leg_ends = now() - interval '1 second', until = now(), settled_at = now() - interval '1 second'
    where world_id = w.world_id and id = a;
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  update player set stats = jsonb_set(stats, '{health}', '1'), wounds = '[]'::jsonb where world_id = w.world_id and uid = w.uid;
  perform creature_settle(w.world_id, a);
  insert into said select 'FEND:NONE', (1 - (stats->>'health')::double precision > 0)::text from player where world_id = w.world_id and uid = w.uid;
  r := class_spell_cast(w.world_id, w.uid, 'pikeman_fend_off', jsonb_build_object('kind', 'self'));
  update creature set from_x = v_px + 1, to_x = v_px + 1, from_y = v_py, to_y = v_py, windup_at = null,
         leg_at = now() - interval '1 second', leg_ends = now() - interval '1 second', until = now(), settled_at = now() - interval '1 second'
    where world_id = w.world_id and id = a;
  update player set stats = jsonb_set(stats, '{health}', '1'), wounds = '[]'::jsonb where world_id = w.world_id and uid = w.uid;
  perform creature_settle(w.world_id, a);
  insert into said select 'FEND', (1 - (stats->>'health')::double precision)
      || '|' || (select sqrt((cr.to_x - v_px) ^ 2 + (cr.to_y - v_py) ^ 2) from creature cr where cr.world_id = w.world_id and cr.id = a)
      || '|' || (select count(*) from event e where e.world_id = w.world_id and e.uid = w.uid and e.text = '${spell('fend_off').name}: you push the ulva back.')
      || '|' || (r->>'said')
    from player where world_id = w.world_id and uid = w.uid;
  update player set blessings = '{}'::jsonb, stats = jsonb_set(stats, '{health}', '1'), wounds = '[]'::jsonb where world_id = w.world_id and uid = w.uid;
  delete from creature where world_id = w.world_id and id = a;

  /* ---- Brace for the Charge: met at the edge of your reach, coming from outside it ---- */
  -- One already inside your reach is not what it waits for.
  a := creature_spawn(w.world_id, 'ulva', v_px + 2, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, enemy = null, hunt_again = null, windup_at = null, fight_blows = 0,
         hunt_x = v_px + 2, hunt_y = v_py, home_x = v_px + 2, home_y = v_py,
         leg_at = now() - interval '1 second', leg_ends = now() - interval '1 second', until = now(), settled_at = now() - interval '1 second'
    where world_id = w.world_id and id = a;
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  r := class_spell_cast(w.world_id, w.uid, 'pikeman_brace_for_the_charge', jsonb_build_object('kind', 'self'));
  insert into said values ('BRACE:SAID', r->>'said');
  perform creature_settle(w.world_id, a);
  insert into said values ('BRACE:INSIDE', (select count(*) from class_mark where world_id = w.world_id and kind = 'brace')
    || '|' || (select (blessings ? 'brace')::text from player where world_id = w.world_id and uid = w.uid));
  delete from creature where world_id = w.world_id and id = a;
  -- One coming from outside it stops at the edge, and the brace is spent on it.
  a := creature_spawn(w.world_id, 'ulva', v_px + 6, v_py, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'ulva', v_px - 6, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, enemy = null, hunt_again = null, windup_at = null, fight_blows = 0,
         hunt_x = to_x, hunt_y = to_y, home_x = to_x, home_y = to_y,
         leg_at = now() - interval '1 second', leg_ends = now() - interval '1 second', until = now(), settled_at = now() - interval '1 second'
    where world_id = w.world_id and id in (a, b);
  update creature set health = max_health(creature) where world_id = w.world_id and id in (a, b);
  perform creature_settle(w.world_id, a);
  perform creature_settle(w.world_id, b);
  insert into said select 'BRACE', string_agg(round(sqrt((to_x - v_px) ^ 2 + (to_y - v_py) ^ 2)::numeric, 6)::text, ',' order by case id when a then 1 else 2 end)
      || '|' || (select count(*) from class_mark where world_id = w.world_id and kind = 'brace' and creature_id = a and by_uid = w.uid)
      || '|' || (select count(*) from class_mark where world_id = w.world_id and kind = 'brace')
      || '|' || (select (blessings ? 'brace')::text from player where world_id = w.world_id and uid = w.uid)
    from creature where world_id = w.world_id and id in (a, b);
  delete from creature where world_id = w.world_id and id = b;
  -- And when it gets there, the blow: at its share of a swing's, the same roll asked of one alike, and its next blow put back.
  b := creature_spawn(w.world_id, 'ulva', v_px - 3, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, enemy = null, until = now() + interval '1 hour', windup_at = null
    where world_id = w.world_id and id = b;
  update creature set health = max_health(creature) where world_id = w.world_id and id in (a, b);
  update creature set leg_at = now() - interval '2 seconds', leg_ends = now() - interval '1 second', until = now() - interval '1 second',
         settled_at = now() - interval '1 second' where world_id = w.world_id and id = a;
  update class_mark set until = now() - interval '1 second' where world_id = w.world_id and creature_id = a and kind = 'brace';
  update item set dmg = 0 where id = v_spear;
  perform setseed(0.11);
  r := class_blow(w.world_id, w.uid, b, 1);
  d1 := (r->>'dmg')::double precision;
  update item set dmg = 0 where id = v_spear;
  select health into h0 from creature where world_id = w.world_id and id = a;
  perform setseed(0.11);
  perform creature_settle(w.world_id, a);
  insert into said select 'BRACE:BLOW', round(((h0 - health) / greatest(d1, 1e-9))::numeric, 6)::text
      || '|' || (r->>'landed') || '|' || (select count(*) from class_mark where world_id = w.world_id and kind = 'brace')
    from creature where world_id = w.world_id and id = a;
  -- Its next blow put back: one waiting five seconds on its next blow, met by a blow that lands, waits that much longer past
  -- what the spear's own blow puts it back.
  update creature set health = max_health(creature), from_x = v_px + 3, to_x = v_px + 3, from_y = v_py, to_y = v_py,
         leg_at = now() - interval '1 second', leg_ends = now() - interval '1 second', until = now() + interval '5 seconds'
    where world_id = w.world_id and id = a;
  insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid) values (w.world_id, a, 'brace', 1, 0, now() - interval '1 second', w.uid);
  for k in 1..12 loop
    update item set dmg = 0 where id = v_spear;
    perform setseed(k / 50.0);
    perform class_owed_pay(w.world_id, a);
    exit when (select health < max_health(cr) from creature cr where cr.world_id = w.world_id and cr.id = a);
    update creature set until = now() + interval '5 seconds' where world_id = w.world_id and id = a;
    insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid) values (w.world_id, a, 'brace', 1, 0, now() - interval '1 second', w.uid);
  end loop;
  insert into said select 'BRACE:BACK', extract(epoch from until - now()) || '|' || (health < max_health(creature))::text
    from creature where world_id = w.world_id and id = a;
  delete from creature where world_id = w.world_id and id in (a, b);

  /* ---- The door: stamina and rest ---- */
  update player set used_at = '{}'::jsonb, blessings = '{}'::jsonb, stats = jsonb_set(stats, '{stamina}', '1') where world_id = w.world_id and uid = w.uid;
  delete from caller where uid = w.uid;
  perform spell_bar_put(w.world_id, w.uid, ${FIRST_CLASS_SLOT}, 'pikeman_keep_away');
  r := rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'self'));
  insert into said select 'PAID', coalesce(r->>'cast', r->>'why') || '|' || (stats->>'stamina') || '|' || (r->'rest'->>'pikeman_keep_away')
    from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('RESTING', rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'self'))->>'why');

  /* ---- The passives: each number, before and after ---- */
  update player set used_at = '{}'::jsonb, blessings = '{}'::jsonb, wounds = '[]'::jsonb,
         stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{stamina}', '1') where world_id = w.world_id and uid = w.uid;
  update player set equipped = jsonb_build_object('weapon', v_spear) where world_id = w.world_id and uid = w.uid;
  m0 := melee_reach(w.world_id, w.uid);
  d1 := act_wind(w.world_id, w.uid, 'attack_creature', 0);
  update player set equipped = jsonb_build_object('weapon', v_sword) where world_id = w.world_id and uid = w.uid;
  m1 := melee_reach(w.world_id, w.uid);
  h0 := act_wind(w.world_id, w.uid, 'attack_creature', 0);
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, k2.id from class_perk k2
    where k2.class = 'pikeman' and not exists (select 1 from class_spell cs where cs.id = k2.id)
    on conflict do nothing;
  perform class_fold(w.world_id, w.uid);
  insert into said select 'FOLDED', coalesce((select string_agg(e.k || '=' || e.v, ';' order by e.k collate "C")
      from jsonb_each_text(class_mul->'fx') e(k, v) where e.k ~ '^(length|wind|monster|gap|still|severity):'), 'none')
    from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('LONG', m1 || '|' || melee_reach(w.world_id, w.uid));
  insert into said values ('LIGHT', (act_wind(w.world_id, w.uid, 'attack_creature', 0) / h0)::text);
  update player set equipped = jsonb_build_object('weapon', v_spear) where world_id = w.world_id and uid = w.uid;
  insert into said values ('LONG:SPEAR', m0 || '|' || melee_reach(w.world_id, w.uid));
  insert into said values ('LIGHT:SPEAR', (act_wind(w.world_id, w.uid, 'attack_creature', 0) / d1)::text);
  -- Monster Hunter on a monster, and Reach Discipline on what is inside your reach and not yet inside its own.
  a := creature_spawn(w.world_id, 'rowl', v_px + 1, v_py, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'ogre', v_px - 1, v_py, 'wild', now() - interval '2 hours', null);
  t := creature_spawn(w.world_id, 'rowl', v_px, v_py + 2, 'wild', now() - interval '2 hours', null);
  k := creature_spawn(w.world_id, 'goblin', v_px, v_py - 2, 'wild', now() - interval '2 hours', null);
  n := creature_spawn(w.world_id, 'rowl', v_px + 5, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, settled_at = now(), until = now() + interval '1 hour' where world_id = w.world_id and id in (a, b, t, k, n);
  update creature set health = max_health(creature) where world_id = w.world_id and id in (a, b, t, k, n);
  insert into said select 'DEALT', string_agg(class_dealt(w.world_id, w.uid, cr)::text, ',' order by case cr.id when a then 1 when b then 2 when t then 3 when k then 4 else 5 end)
    from creature cr where cr.world_id = w.world_id and cr.id in (a, b, t, k, n);
  -- Bastion on feet that have not moved, and not on feet that have.
  update player set stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{hurtBy}', to_jsonb(a)), wounds = '[]'::jsonb, act = null, act_target = null,
         equipped = jsonb_build_object('weapon', v_spear), moved_at = now() - interval '1 minute' where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.1, 'A test blow', 'cut');
  insert into said select 'STILL', (1 - (stats->>'health')::double precision)::text
      || '|' || (select (x2->>'severity') from jsonb_array_elements(wounds) x2 limit 1)
    from player where world_id = w.world_id and uid = w.uid;
  update player set stats = jsonb_set(stats, '{health}', '1'), wounds = '[]'::jsonb, moved_at = now() where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.1, 'A test blow', 'cut');
  insert into said select 'MOVING', (1 - (stats->>'health')::double precision)::text from player where world_id = w.world_id and uid = w.uid;
  -- Scarred on a fresh wound and not on one already open: a cut open in every place a blow can land, deepened by the whole of it.
  update player set stats = jsonb_set(stats, '{health}', '1'), moved_at = now(),
         wounds = (select jsonb_agg(jsonb_build_object('kind', 'cut', 'part', h.slot, 'severity', 0.05, 'bleeding', true, 'infected', false,
                                                     'dressing', null, 'at', now())) from hit_location h)
    where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.1, 'A test blow', 'cut');
  insert into said select 'SCARRED:OPEN', (1 - (stats->>'health')::double precision)::text
      || '|' || (select sum((x2->>'severity')::double precision) - 0.05 * count(*) from jsonb_array_elements(wounds) x2)
    from player where world_id = w.world_id and uid = w.uid;
  update player set stats = jsonb_set(stats, '{health}', '1'), wounds = '[]'::jsonb where world_id = w.world_id and uid = w.uid;
  delete from creature where world_id = w.world_id and id in (a, b, t, k, n);
end $b$;
insert into said select 'OPEN', count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname <> 'rpc_name_free'
    and (has_function_privilege('anon', p.oid, 'execute')
         or (p.proname not like 'rpc\\_%' and has_function_privilege('authenticated', p.oid, 'execute')));
select k || '=' || v from said order by k;
rollback;
`);
const said = new Map<string, string>();
for (const line of out.split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) said.set(line.slice(0, i), line.slice(i + 1));
}
const island = (k: string): string => said.get(k) ?? '(nothing)';
const parts = (k: string): string[] => island(k).split('|');

/* ---- What came back ------------------------------------------------------ */

{
  const wrong = SPELLS.filter((s) => island(`SPELL:${s.id}`) !== rowOf(s));
  check(`both sides hold the Pikeman's ${SPELLS.length} spells, field for field`,
    SPELLS.length === 12 && wrong.length === 0 && [...said.keys()].filter((k) => k.startsWith('SPELL:')).length === SPELLS.length,
    wrong.length ? `island ${island(`SPELL:${wrong[0].id}`)}, browser ${rowOf(wrong[0])}` : `${SPELLS.length} of them`);
}
check('the trade is taken up', island('TAKE') === 'took', island('TAKE'));

for (const bl of BLOWS) {
  const [ratio, landed] = parts(`BLOW:${bl.key}`);
  const s = spell(bl.slug);
  const what = bl.slug === 'reach_advantage'
    ? `${s.name}: a blow at ${pct(bl.want)} on a creature ${bl.dist > HUNT_REACH ? 'not yet within' : 'within'} its own reach of you`
    : `${s.name}: a blow at ${pct(bl.want)} of a swing's`;
  check(what, landed === 'true' && near(Number(ratio), bl.want, 1e-9), island(`BLOW:${bl.key}`));
}
{
  const [slow, secs, line] = parts('SWEEP');
  check(`Sweep the Legs: for ${fx('sweep_the_legs', 'secs')} s it goes at ${pct(fx('sweep_the_legs', 'pace'))} of its pace`,
    near(Number(slow), fx('sweep_the_legs', 'pace'), 1e-6) && near(Number(secs), fx('sweep_the_legs', 'secs'), 1e-6)
      && line.endsWith(`it goes at ${pct(fx('sweep_the_legs', 'pace'))} of its pace.`), island('SWEEP'));
}
{
  const [over, vital] = parts('REACH:PAST');
  check(`Overreach strikes up to ${fx('overreach', 'past')} tiles past your reach, where a blow within it is refused`,
    over === 'struck' && vital === `The ogre is more than ${SPEAR_REACH} tiles away.`, island('REACH:PAST'));
  check('and no further', island('REACH:BEYOND') === `The ogre is more than ${SPEAR_REACH + fx('overreach', 'past')} tiles away.`, island('REACH:BEYOND'));
  const [secs, line] = parts('REACH:WIND');
  check(`and puts your own next swing back ${fx('overreach', 'wind')} s`,
    near(Number(secs), 1 + fx('overreach', 'wind'), 1e-6) && line.endsWith(`Your next swing comes ${fx('overreach', 'wind')} s later.`), island('REACH:WIND'));
}
{
  const [plain, vital, lost] = parts('VITAL').map(Number);
  check(`Vital Thrust is critical ${fx('vital_thrust', 'crit')} times as often as a swing, the same rolls asked of both`,
    plain > 10 && lost === 0 && vital / plain > fx('vital_thrust', 'crit') * 0.8 && vital / plain < fx('vital_thrust', 'crit') * 1.2,
    `${plain} and ${vital} criticals of 2500, ${lost} lost`);
}
{
  const [ratio, line] = parts('TWIN');
  check(`Twin Thrust: ${fx('twin_thrust', 'blows')} blows at ${pct(fx('twin_thrust', 'more'))} each, the very rolls of two swings`,
    // To within what a creature's health holds as a real.
    near(Number(ratio), 1, 1e-5) && /^Twin Thrust: \d of 2 blows land/.test(line), island('TWIN'));
}
{
  const [who, line] = parts('SKEWER');
  check(`Skewer goes through into what is up to ${fx('skewer', 'behind')} tiles behind it within ${fx('skewer', 'width')} of the line, and nothing else`,
    who.split(',')[0] === 'true' && who.split(',').slice(2).every((x) => x === 'false') && /It goes through into 1 more behind/.test(line),
    island('SKEWER'));
}
check('Warning Thrust is refused on a creature already fighting you', island('WARN:FIGHTING') === 'The ulva is already fighting you.', island('WARN:FIGHTING'));
check('and on one that never goes looking for a fight', island('WARN:PREY') === 'The bura never comes for anybody unless it is struck.', island('WARN:PREY'));
{
  const [who, secs, line] = parts('WARN');
  check(`and a hunter warned off does not come for you for ${fx('warning_thrust', 'secs')} s, where one alike does`,
    who === 'none,true' && near(Number(secs), fx('warning_thrust', 'secs'), 1e-6) && /will not come for you for 30 s/.test(line), island('WARN'));
}
check(`Hook is refused past ${fx('hook', 'reach')} tiles`, island('HOOK:FAR') === `The ulva is more than ${fx('hook', 'reach')} tiles away.`, island('HOOK:FAR'));
check('and on a creature at your feet', island('HOOK:FEET') === 'The ulva is already at your feet.', island('HOOK:FEET'));
{
  const [dist, on, line] = parts('HOOK');
  check(`Hook drags it ${fx('hook', 'pull')} tiles towards you, and it turns on you`,
    near(Number(dist), 3.5 - fx('hook', 'pull'), 1e-6) && on === 'true' && line === `Hook: you drag the ulva ${fx('hook', 'pull')} tiles towards you.`, island('HOOK'));
  const [least] = parts('HOOK:LEAST');
  check(`and never nearer than ${fx('hook', 'least')} tile`, near(Number(least), fx('hook', 'least'), 1e-6), island('HOOK:LEAST'));
}
{
  const [both, line] = parts('RALLY');
  const [mine, theirs] = both.split(',').map(Number);
  check(`Rally the Line gives you and everybody within ${fx('rally_the_line', 'reach')} tiles ${pct(fx('rally_the_line', 'stamina'))} of a bar of stamina`,
    near(mine, 0.5 + fx('rally_the_line', 'stamina'), 1e-9) && near(theirs, 0.5 + fx('rally_the_line', 'stamina'), 1e-9)
      && line.endsWith('back for you and 1 other.'), island('RALLY'));
  check('and nobody further', near(Number(island('RALLY:FAR')), 0.5), island('RALLY:FAR'));
}
{
  const none = Number(island('KEEP:NONE'));
  const spellBlow = Number(island('KEEP:SPELL'));
  const swing = Number(island('KEEP:SWING'));
  check(`Keep Away pushes what a blow lands on ${fx('keep_away', 'push')} tile further off, a spell's or a swing's, and nothing without it`,
    near(none, 2, 1e-6) && near(spellBlow, 2 + fx('keep_away', 'push'), 1e-6) && near(swing, 2 + fx('keep_away', 'push'), 1e-6),
    `${none}, ${spellBlow}, ${swing}; ${island('KEEP:SAID')}`);
}
{
  const [lost, dist, told, line] = parts('FEND');
  check(`Fend Off: what comes within ${HUNT_REACH} tiles to strike is pushed ${fx('fend_off', 'push')} tiles back instead, and you are told`,
    island('FEND:NONE') === 'true' && near(Number(lost), 0) && near(Number(dist), 1 + fx('fend_off', 'push'), 1e-6) && told === '1'
      && line.startsWith('Fend Off: for 8 s'), `${island('FEND:NONE')} ${island('FEND')}`);
}
check('Brace for the Charge waits for nothing already inside your reach',
  island('BRACE:INSIDE') === '0|true' && island('BRACE:SAID').startsWith('Brace for the Charge: for 6 s'), `${island('BRACE:INSIDE')} ${island('BRACE:SAID')}`);
{
  const [dists, mine, all, still] = parts('BRACE');
  const [first, second] = dists.split(',').map(Number);
  check('and stops the first that comes at you from outside at the edge of your reach, and is spent on it',
    near(first, SPEAR_REACH, 1e-6) && second < SPEAR_REACH - 1 && mine === '1' && all === '1' && still === 'false', island('BRACE'));
  const [ratio, landed, left] = parts('BRACE:BLOW');
  check(`and when it gets there a blow at ${pct(fx('brace_for_the_charge', 'more'))} meets it, the same roll as a swing's, once`,
    landed === 'true' && near(Number(ratio), fx('brace_for_the_charge', 'more'), 1e-6) && left === '0', island('BRACE:BLOW'));
  const [back, struck] = parts('BRACE:BACK');
  check(`and its next blow is put back ${fx('brace_for_the_charge', 'back')} s, past the spear's own ${STAGGER_POLE} s`,
    struck === 'true' && near(Number(back), 5 + STAGGER_POLE + fx('brace_for_the_charge', 'back'), 1e-6), island('BRACE:BACK'));
}
{
  const [cast, stamina, rest] = parts('PAID');
  const s = spell('keep_away');
  check(`a spell called through the door costs its ${pct(s.cost)} of a full bar and rests ${s.rest} s`,
    cast === s.id && near(Number(stamina), 1 - s.cost) && near(Number(rest), s.rest, 1e-6), island('PAID'));
  check('and is refused while it rests', island('RESTING') === `${s.name} can be called again in ${s.rest} seconds.`, island('RESTING'));
}

/* ---- The passives ------------------------------------------------------------ */

check('the six passives fold on the island to what they fold to in the browser',
  island('FOLDED') === Object.keys(FOLD).filter((k) => /^(length|wind|monster|gap|still|severity):/.test(k)).sort()
    .map((k) => `${k}=${FOLD[k]}`).join(';'), island('FOLDED'));
{
  const [before, after] = parts('LONG:SPEAR').map(Number);
  const [sword0, sword1] = parts('LONG').map(Number);
  check(`Long Reach: a spear reaches ${FOLD['length:polearms']} tiles further, ${SPEAR_REACH} to ${SPEAR_REACH + FOLD['length:polearms']}, and a sword as it was`,
    near(before, SPEAR_REACH) && near(after, SPEAR_REACH + FOLD['length:polearms']) && near(sword0, SWORD_REACH) && near(sword1, SWORD_REACH),
    `${island('LONG:SPEAR')} ${island('LONG')}`);
}
check(`Light Haft: a swing of a spear ${pct(1 - FOLD['wind:polearms'])} cheaper, and a sword's as it was`,
  near(Number(island('LIGHT:SPEAR')), FOLD['wind:polearms']) && near(Number(island('LIGHT')), 1), `${island('LIGHT:SPEAR')} ${island('LIGHT')}`);
{
  const [rowl, ogre, gap, goblin, far] = parts('DEALT')[0].split(',').map(Number);
  check(`Monster Hunter: ${pct(FOLD['monster:dmg'] - 1)} more on a monster, and nothing on anything else`,
    near(rowl, 1) && near(ogre, FOLD['monster:dmg']), island('DEALT'));
  check(`Reach Discipline: ${pct(FOLD['gap:dmg'] - 1)} more inside your reach and outside its own, and not inside its own nor outside yours`,
    near(gap, FOLD['gap:dmg']) && near(far, 1) && near(goblin, FOLD['monster:dmg']), island('DEALT'));
}
{
  const [still, severity] = parts('STILL').map(Number);
  const moving = Number(island('MOVING'));
  check(`Bastion: ${pct(1 - FOLD['still:taken'])} less on feet that have not moved, and nothing on feet that have`,
    near(still, 0.1 * FOLD['still:taken'], 1e-9) && near(moving, 0.1, 1e-9), `${island('STILL')} ${island('MOVING')}`);
  check(`Scarred: a fresh wound ${pct(1 - FOLD['severity:new'])} less severe than the blow`,
    near(severity, still * FOLD['severity:new'], 1e-9), island('STILL'));
  const [lost, deepened] = parts('SCARRED:OPEN').map(Number);
  check('and one already open deepened by the whole of it', lost > 0 && near(deepened, lost, 1e-9), island('SCARRED:OPEN'));
}
check('no function is open to a player but the doors', island('OPEN') === '0', island('OPEN'));

/* ---- The browser's half ----------------------------------------------------- */

check(`each of the ${CLASS_TIER_AT.length} tiers offers two spells and a passive`,
  TIERS.pikeman.length === CLASS_TIER_AT.length && TIERS.pikeman.every((row) => row.length === 3
    && row.filter((num) => SPELLS.some((s) => s.num === num)).length === 2), JSON.stringify(TIERS.pikeman));
check('and every spell\'s perk says what it costs before what it does',
  SPELLS.every((s) => PERK_BY_ID.get(s.id)!.note.startsWith('Spell') && PERK_BY_ID.get(s.id)!.note.endsWith(s.note)));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Pikeman — ${ok.length} of ${ok.length}`);
