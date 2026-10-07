/**
 * The Skirmisher: twelve spells and six passives in six tiers that open on
 * the trade's own level, on the island (`the_skirmisher.sql`) and in the
 * browser's rulebook (`talents.ts`, `perks.ts`).
 *
 * What this asks:
 *
 *   * both sides hold the same twelve spells, field for field, what each wants
 *     in your hands included, and the same tiers;
 *   * every throw a spell makes is a swing's at its share -- the same roll
 *     asked twice, of two creatures alike -- as far as it says and no further;
 *     two throws one after the other; a creature staggered, bled, glanced on
 *     from, and every one near it thrown at; a leap back; a quicker walk, on
 *     the island's pace and in the answer the browser walks at; a creature
 *     marked so that every blow on it is critical more often; a blow on one
 *     fighting somebody else harder; and everything hunting you losing you;
 *   * a throw is refused without a javelin or a throwing axe in your hand, a
 *     Hit and Run without one of those or a knife;
 *   * the door charges its stamina and its rest;
 *   * and every passive moves the number it names at the rule it changes, on
 *     the island, with the browser's fold the island's.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { CLASS_TIER_AT } from '../../src/game/classes';
import { CRIT_HIT, KNIFE_BLEED, KNIFE_BLEED_SECS, reachOf, STAGGER_MAUL } from '../../src/game/fight';
import { WEAPON_BY_ID } from '../../src/game/gear';
import { SPELL_BAR } from '../../src/game/patrons';
import { foldPerks, perksOf, PERK_BY_ID, TIERS } from '../../src/game/perks';
import { CLASS_SPELL_BY_ID, classSpellsOf, NEEDS_SAID, type ClassSpellDef } from '../../src/game/talents';

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

const SPELLS = classSpellsOf('skirmisher');
const spell = (slug: string): ClassSpellDef => {
  const s = CLASS_SPELL_BY_ID.get(`skirmisher_${slug}`);
  if (!s) throw new Error(`no skirmisher_${slug}`);
  return s;
};
const fx = (slug: string, k: string): number => spell(slug).fx[k];
const PASSIVES = perksOf('skirmisher').filter((p) => !CLASS_SPELL_BY_ID.has(p.id));
/** What the six passives fold to, which is what the browser reads a Skirmisher's numbers from. */
const FOLD = foldPerks(PASSIVES.map((p) => p.id));
const FIRST_CLASS_SLOT = SPELL_BAR.indexOf('class');
/** The javelin the throws are made with, and how far it reaches before anybody's perks. */
const JAVELIN = WEAPON_BY_ID.get('javelin')!;
const REACH = reachOf(JAVELIN);

/** A spell whose one throw is measured at its share of a swing's: the two creatures alike, `dist` tiles off on either side of you. */
interface Throw { slug: string; dist: number; want: number }
const THROWS: Throw[] = ['snap_throw', 'long_throw', 'hit_and_run', 'heavy_throw', 'gut_throw', 'parting_throw']
  .map((slug) => ({ slug, dist: 4, want: fx(slug, 'more') }));

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
        a int; b int; t int; f int; u int; a2 int; k int; n int; v_jav bigint; v_axe bigint; v_knife bigint; v_sword bigint;
        h0 double precision; d1 double precision; d2 double precision; v_seed double precision;
        m0 double precision; m1 double precision; n1 int; n2 int; n3 int;
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
      (values ('throwing', 100::double precision), ('knives', 100), ('fighting', 100), ('swords', 100), ('body_control', 1), ('shields', 1)) sv(s, v)
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
  v_jav := give(w.world_id, w.uid, 'javelin', 1, 40);
  v_axe := give(w.world_id, w.uid, 'throwing_axe', 1, 40);
  v_knife := give(w.world_id, w.uid, 'hunting_knife', 1, 40);
  v_sword := give(w.world_id, w.uid, 'sword', 1, 40);
  update player set equipped = jsonb_build_object('weapon', v_jav) where world_id = w.world_id and uid = w.uid;

  /* ---- The rows ---- */
  insert into said select 'SPELL:' || id, id || '¦' || class || '¦' || num || '¦' || name || '¦' || cost || '¦' || rest || '¦'
      || array_to_string(on_what, '+') || '¦' || coalesce((select string_agg(e.k || '=' || e.v, ';' order by e.k) from jsonb_each_text(fx) e(k, v)), '')
      || '¦' || note || '¦' || coalesce(needs, '-')
    from class_spell where class = 'skirmisher';

  insert into said values ('TAKE', coalesce(rpc_take_class(w.world_id, 'skirmisher')->>'why', 'took'));
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, cs.id from class_spell cs where cs.class = 'skirmisher'
    on conflict do nothing;

  /* ---- A throw with a spell, at its share of a swing's: the same roll, asked twice ---- */
  ${THROWS.map((th) => `
  a := creature_spawn(w.world_id, 'ogre', v_px - ${th.dist}, v_py, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'ogre', v_px + ${th.dist}, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, enemy = null, hunt_again = null,
         settled_at = now(), until = now() + interval '1 hour', windup_at = null where world_id = w.world_id and id in (a, b);
  update creature set health = max_health(creature) where world_id = w.world_id and id in (a, b);
  for k in 1..12 loop
    v_seed := k / 100.0;
    update item set dmg = 0 where id = v_jav;
    perform setseed(v_seed);
    perform creature_settle(w.world_id, a);
    r := class_blow(w.world_id, w.uid, a, 1);
    exit when (r->>'landed')::boolean;
    update creature set health = max_health(creature), hunting = w.uid, enemy = null,
           settled_at = now(), until = now() + interval '1 hour', windup_at = null where world_id = w.world_id and id = a;
  end loop;
  d1 := (r->>'dmg')::double precision;
  update item set dmg = 0 where id = v_jav;
  perform setseed(v_seed);
  r := class_spell_cast(w.world_id, w.uid, 'skirmisher_${th.slug}', jsonb_build_object('kind', 'enemy', 'id', b));
  insert into said values ('THROW:${th.slug}', ((r->'blow'->>'dmg')::double precision / d1) || '|' || coalesce(r->'blow'->>'landed', r->>'why')
    || '|' || coalesce(r->>'said', ''));
  ${th.slug === 'gut_throw' ? `
  insert into said select 'GUT', (bleed_rate / d1) || '|' || extract(epoch from bleed_until - now()) from creature where world_id = w.world_id and id = b;` : ''}
  ${th.slug === 'parting_throw' ? `
  insert into said select 'LEAP', (pl.x - v_px) || '|' || (pl.y - v_py) || '|' || coalesce(r->'put'->>'by', 'none') || '|' || coalesce(r->'put'->>'x', 'none')
    from player pl where pl.world_id = w.world_id and pl.uid = w.uid;` : ''}
  ${th.slug === 'hit_and_run' ? `
  insert into said select 'RUN', extract(epoch from (pl.blessings->'hit_and_run'->>'until')::timestamptz - now()) || '|' || (pl.blessings->'hit_and_run'->>'pace')
    from player pl where pl.world_id = w.world_id and pl.uid = w.uid;` : ''}
  update player set x = v_px, y = v_py, blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  delete from creature where world_id = w.world_id and id in (a, b);`).join('')}

  /* ---- Heavy Throw: a heavy blow knocked off its stroke, and its next blow put back ---- */
  a := creature_spawn(w.world_id, 'ogre', v_px + 4, v_py, 'wild', now() - interval '2 hours', null);
  for k in 1..12 loop
    update creature set traits = '{}', rare = null, hunting = w.uid, enemy = null, settled_at = now(), until = now() + interval '5 seconds',
           windup_at = now(), health = max_health(creature) where world_id = w.world_id and id = a;
    update item set dmg = 0 where id = v_jav;
    perform setseed(k / 100.0);
    r := class_spell_cast(w.world_id, w.uid, 'skirmisher_heavy_throw', jsonb_build_object('kind', 'enemy', 'id', a));
    exit when (r->'blow'->>'landed')::boolean;
  end loop;
  insert into said select 'STAGGER', extract(epoch from until - now()) || '|' || (windup_at is null)::text || '|' || (r->>'said')
    from creature where world_id = w.world_id and id = a;
  delete from creature where world_id = w.world_id and id = a;

  /* ---- How far a throw goes ---- */
  a := creature_spawn(w.world_id, 'ogre', v_px + melee_reach(w.world_id, w.uid) + ${fx('long_throw', 'past')} - 0.5, v_py, 'wild',
                      now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, until = now() + interval '1 hour', health = max_health(creature)
   where world_id = w.world_id and id = a;
  insert into said values ('RANGE:LONG', coalesce(class_spell_cast(w.world_id, w.uid, 'skirmisher_long_throw', jsonb_build_object('kind', 'enemy', 'id', a))->>'why', 'thrown')
    || '|' || coalesce(class_spell_cast(w.world_id, w.uid, 'skirmisher_snap_throw', jsonb_build_object('kind', 'enemy', 'id', a))->>'why', 'thrown'));
  update creature set to_x = v_px + melee_reach(w.world_id, w.uid) + ${fx('long_throw', 'past')} + 0.5,
         from_x = v_px + melee_reach(w.world_id, w.uid) + ${fx('long_throw', 'past')} + 0.5, health = max_health(creature)
   where world_id = w.world_id and id = a;
  insert into said values ('RANGE:BEYOND', coalesce(class_spell_cast(w.world_id, w.uid, 'skirmisher_long_throw', jsonb_build_object('kind', 'enemy', 'id', a))->>'why', 'thrown'));
  delete from creature where world_id = w.world_id and id = a;

  /* ---- Snap Throw puts your own swing forward ---- */
  a := creature_spawn(w.world_id, 'ogre', v_px + 4, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, until = now() + interval '1 hour', health = max_health(creature)
   where world_id = w.world_id and id = a;
  update player set act = 'attack_creature', act_target = jsonb_build_object('kind', 'creature', 'id', a),
         act_ends = now() + interval '2 seconds' where world_id = w.world_id and uid = w.uid;
  r := class_spell_cast(w.world_id, w.uid, 'skirmisher_snap_throw', jsonb_build_object('kind', 'enemy', 'id', a));
  insert into said select 'SOONER', extract(epoch from act_ends - now()) || '|' || (r->>'said') from player where world_id = w.world_id and uid = w.uid;
  update player set act = null, act_target = null, act_ends = null where world_id = w.world_id and uid = w.uid;

  /* ---- Double Throw: two throws, the very rolls of two swings, and the creature down by both ---- */
  update creature set health = max_health(creature), enemy = null where world_id = w.world_id and id = a;
  update item set dmg = 0 where id = v_jav;
  perform setseed(0.06);
  select health into h0 from creature where world_id = w.world_id and id = a;
  perform creature_settle(w.world_id, a);
  d1 := 0;
  for n in 1..${fx('double_throw', 'throws')} loop
    d1 := d1 + (class_blow(w.world_id, w.uid, a, ${fx('double_throw', 'more')})->>'dmg')::double precision;
  end loop;
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  update item set dmg = 0 where id = v_jav;
  perform setseed(0.06);
  r := class_spell_cast(w.world_id, w.uid, 'skirmisher_double_throw', jsonb_build_object('kind', 'enemy', 'id', a));
  insert into said select 'DOUBLE', round(((h0 - health) / greatest(d1, 1e-9))::numeric, 6)::text || '|' || (r->>'said')
    from creature where world_id = w.world_id and id = a;
  delete from creature where world_id = w.world_id and id = a;

  /* ---- Ricochet: the first, and the nearest other within its reach of it, the very rolls of two swings ---- */
  a := creature_spawn(w.world_id, 'ogre', v_px - 4, v_py, 'wild', now() - interval '2 hours', null);
  a2 := creature_spawn(w.world_id, 'ogre', v_px - 4, v_py - 3, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'ogre', v_px + 4, v_py, 'wild', now() - interval '2 hours', null);
  t := creature_spawn(w.world_id, 'ogre', v_px + 4, v_py + ${fx('ricochet', 'reach')} - 1, 'wild', now() - interval '2 hours', null);
  f := creature_spawn(w.world_id, 'ogre', v_px + 4 + ${fx('ricochet', 'reach')} + 0.6, v_py, 'wild', now() - interval '2 hours', null);
  for k in 1..30 loop
    update creature set traits = '{}', rare = null, hunting = w.uid, enemy = null, settled_at = now(), until = now() + interval '1 hour',
           windup_at = null where world_id = w.world_id and id in (a, a2, b, t, f);
    update creature set health = max_health(creature) where world_id = w.world_id and id in (a, a2, b, t, f);
    update item set dmg = 0 where id = v_jav;
    perform setseed(k / 100.0);
    perform creature_settle(w.world_id, a);
    r := class_blow(w.world_id, w.uid, a, ${fx('ricochet', 'more')});
    continue when not (r->>'landed')::boolean;
    d1 := (r->>'dmg')::double precision;
    perform creature_settle(w.world_id, a2);
    r := class_blow(w.world_id, w.uid, a2, ${fx('ricochet', 'glance')});
    continue when not (r->>'landed')::boolean;
    d2 := (r->>'dmg')::double precision;
    update item set dmg = 0 where id = v_jav;
    perform setseed(k / 100.0);
    r := class_spell_cast(w.world_id, w.uid, 'skirmisher_ricochet', jsonb_build_object('kind', 'enemy', 'id', b));
    exit;
  end loop;
  insert into said select 'RICOCHET', ((r->'blow'->>'dmg')::double precision / d1) || '|'
      || ((select max_health(cr) - cr.health from creature cr where cr.world_id = w.world_id and cr.id = t) / d2) || '|'
      || (select (cr.health = max_health(cr))::text from creature cr where cr.world_id = w.world_id and cr.id = f) || '|' || (r->>'said')
    from creature where world_id = w.world_id and id = b;

  /* ---- Fan of Blades: the one aimed at and every other within its reach of it, at its share; none past it ---- */
  u := creature_spawn(w.world_id, 'ogre', v_px + 4 + ${fx('fan_of_blades', 'reach')} - 0.5, v_py, 'wild', now() - interval '2 hours', null);
  for k in 1..30 loop
    update creature set traits = '{}', rare = null, hunting = w.uid, enemy = null, settled_at = now(), until = now() + interval '1 hour',
           windup_at = null where world_id = w.world_id and id in (a, b, t, f, u);
    update creature set health = max_health(creature) where world_id = w.world_id and id in (a, b, t, f, u);
    update item set dmg = 0 where id = v_jav;
    perform setseed(k / 100.0);
    perform creature_settle(w.world_id, a);
    r := class_blow(w.world_id, w.uid, a, ${fx('fan_of_blades', 'more')});
    continue when not (r->>'landed')::boolean;
    d1 := (r->>'dmg')::double precision;
    update item set dmg = 0 where id = v_jav;
    perform setseed(k / 100.0);
    r := class_spell_cast(w.world_id, w.uid, 'skirmisher_fan_of_blades', jsonb_build_object('kind', 'enemy', 'id', b));
    exit;
  end loop;
  insert into said select 'FAN', ((max_health(creature) - health) / d1) || '|'
      || (select string_agg((cr.health < max_health(cr))::text, ',' order by case cr.id when t then 1 when u then 2 else 3 end)
            from creature cr where cr.world_id = w.world_id and cr.id in (t, u, f)) || '|' || (r->>'said')
    from creature where world_id = w.world_id and id = b;
  delete from creature where world_id = w.world_id and id in (a, a2, b, t, f, u);

  /* ---- Opportunist: harder on one fighting somebody else, and only on that ---- */
  a := creature_spawn(w.world_id, 'ogre', v_px + 3, v_py, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'ogre', v_px - 3, v_py, 'wild', now() - interval '2 hours', null);
  t := creature_spawn(w.world_id, 'ogre', v_px, v_py + 3, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, settled_at = now(), until = now() + interval '1 hour', windup_at = null,
         health = max_health(creature), enemy = null where world_id = w.world_id and id in (a, b, t);
  update creature set hunting = w.uid where world_id = w.world_id and id = a;
  update creature set hunting = o where world_id = w.world_id and id = b;
  update creature set hunting = null, enemy = a where world_id = w.world_id and id = t;
  m0 := 0;
  for c in select * from creature where world_id = w.world_id and id in (a, b, t) order by id loop
    m0 := m0 + class_dealt(w.world_id, w.uid, c);
  end loop;
  r := class_spell_cast(w.world_id, w.uid, 'skirmisher_opportunist', jsonb_build_object('kind', 'self'));
  insert into said select 'OPPORTUNIST', m0 || '|' || string_agg(class_dealt(w.world_id, w.uid, cr)::text, ',' order by case cr.id when a then 1 when b then 2 else 3 end)
      || '|' || (r->>'said')
    from creature cr where cr.world_id = w.world_id and cr.id in (a, b, t);
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;

  /* ---- Fade: everything hunting you loses you, and nothing else; and none takes you up again ---- */
  update creature set hunting = w.uid, enemy = null where world_id = w.world_id and id in (a, t);
  r := class_spell_cast(w.world_id, w.uid, 'skirmisher_fade', jsonb_build_object('kind', 'self'));
  insert into said select 'FADE', string_agg(coalesce(cr.hunting::text = w.uid::text, false)::text || ':' || coalesce(cr.hunting::text = o::text, false)::text, ','
        order by case cr.id when a then 1 when t then 2 else 3 end)
      || '|' || (select string_agg(round(extract(epoch from cm.until - now()))::text, ',' order by cm.creature_id)
                   from class_mark cm where cm.world_id = w.world_id and cm.kind = 'warned' and cm.by_uid = w.uid)
      || '|' || (r->>'said')
    from creature cr where cr.world_id = w.world_id and cr.id in (a, t, b);
  update creature set until = now() - interval '1 second', settled_at = now() - interval '1 second' where world_id = w.world_id and id = a;
  perform creature_settle(w.world_id, a);
  insert into said select 'FADE:AFTER', coalesce(hunting::text = w.uid::text, false)::text from creature where world_id = w.world_id and id = a;
  update creature set hunting = null where world_id = w.world_id and id in (a, t);
  insert into said values ('FADE:NONE', class_spell_cast(w.world_id, w.uid, 'skirmisher_fade', jsonb_build_object('kind', 'self'))->>'why');
  delete from class_mark where world_id = w.world_id;

  /* ---- Marked for Death: twice as often critical, the same rolls asked of both, and as far as any spell ---- */
  update creature set hunting = w.uid, until = now() + interval '1 hour' where world_id = w.world_id and id = a;
  n1 := 0; n2 := 0; n3 := 0;
  for n in 1..1500 loop
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    update item set dmg = 0 where id = v_jav;
    delete from class_mark where world_id = w.world_id and creature_id = a;
    perform setseed(n / 1600.0);
    r := class_blow(w.world_id, w.uid, a, 1, true);
    if (r->>'crit')::boolean then n1 := n1 + 1; end if;
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    update item set dmg = 0 where id = v_jav;
    insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
      values (w.world_id, a, 'marked', ${fx('marked_for_death', 'crit')}, 0, now() + interval '15 seconds', o);
    perform setseed(n / 1600.0);
    if (class_blow(w.world_id, w.uid, a, 1, true)->>'crit')::boolean then n2 := n2 + 1;
    elsif (r->>'crit')::boolean then n3 := n3 + 1; end if;
  end loop;
  insert into said values ('MARKED:CRIT', n1 || '|' || n2 || '|' || n3);
  delete from class_mark where world_id = w.world_id;
  r := class_spell_cast(w.world_id, w.uid, 'skirmisher_marked_for_death', jsonb_build_object('kind', 'enemy', 'id', b));
  insert into said values ('MARKED', class_marked(w.world_id, b) || '|' || class_marked(w.world_id, a) || '|'
    || (select extract(epoch from until - now()) from class_mark where world_id = w.world_id and creature_id = b and kind = 'marked')
    || '|' || coalesce(r->>'said', r->>'why'));
  f := creature_spawn(w.world_id, 'ogre', v_px + spell_reach() + 1, v_py, 'wild', now() - interval '2 hours', null);
  insert into said values ('MARKED:FAR', class_spell_cast(w.world_id, w.uid, 'skirmisher_marked_for_death', jsonb_build_object('kind', 'enemy', 'id', f))->>'why');
  delete from creature where world_id = w.world_id and id in (a, b, t, f);
  delete from class_mark where world_id = w.world_id;

  /* ---- Hit and Run: a quicker walk on foot, on the island's pace ---- */
  m0 := travel_speed(w.world_id, w.uid);
  perform blessing_put(w.world_id, w.uid, 'hit_and_run', jsonb_build_object('until', now() + interval '5 seconds', 'pace', ${fx('hit_and_run', 'pace')}));
  insert into said values ('PACE', (travel_speed(w.world_id, w.uid) / m0)::text);
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;

  /* ---- The door: what is in your hands, stamina and rest, and the walk handed on ---- */
  delete from caller where uid = w.uid;
  update player set equipped = jsonb_build_object('weapon', v_sword) where world_id = w.world_id and uid = w.uid;
  insert into said values ('NEEDS:SWORD', spell_cast_refusal(w.world_id, w.uid, 'skirmisher_snap_throw') || '|'
    || spell_cast_refusal(w.world_id, w.uid, 'skirmisher_hit_and_run'));
  update player set equipped = jsonb_build_object('weapon', v_knife) where world_id = w.world_id and uid = w.uid;
  insert into said values ('NEEDS:KNIFE', coalesce(spell_cast_refusal(w.world_id, w.uid, 'skirmisher_snap_throw'), 'ready') || '|'
    || coalesce(spell_cast_refusal(w.world_id, w.uid, 'skirmisher_hit_and_run'), 'ready'));
  update player set equipped = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  insert into said values ('NEEDS:HANDS', spell_cast_refusal(w.world_id, w.uid, 'skirmisher_hit_and_run'));
  update player set equipped = jsonb_build_object('weapon', v_axe) where world_id = w.world_id and uid = w.uid;
  insert into said values ('NEEDS:AXE', coalesce(spell_cast_refusal(w.world_id, w.uid, 'skirmisher_snap_throw'), 'ready') || '|'
    || coalesce(spell_cast_refusal(w.world_id, w.uid, 'skirmisher_hit_and_run'), 'ready'));
  update player set equipped = jsonb_build_object('weapon', v_jav) where world_id = w.world_id and uid = w.uid;
  a := creature_spawn(w.world_id, 'ogre', v_px + 3, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, until = now() + interval '1 hour', health = max_health(creature)
   where world_id = w.world_id and id = a;
  update player set used_at = '{}'::jsonb, stats = jsonb_set(stats, '{stamina}', '1') where world_id = w.world_id and uid = w.uid;
  perform spell_bar_put(w.world_id, w.uid, ${FIRST_CLASS_SLOT}, 'skirmisher_hit_and_run');
  r := rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'creature', 'id', a));
  insert into said select 'PAID', coalesce(r->>'cast', r->>'why') || '|' || (stats->>'stamina') || '|' || (r->'rest'->>'skirmisher_hit_and_run')
      || '|' || coalesce(r->'pace'->>'mul', 'none') || '|' || coalesce(r->'pace'->>'secs', 'none')
    from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('RESTING', rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'creature', 'id', a))->>'why');
  update player set used_at = '{}'::jsonb, blessings = '{}'::jsonb, stats = jsonb_set(stats, '{stamina}', '1') where world_id = w.world_id and uid = w.uid;

  /* ---- A dodge before the passive: nothing answered ---- */
  update skill set value = 100 where world_id = w.world_id and uid = w.uid and id = 'body_control';
  update player set stats = jsonb_set(stats, '{hurtBy}', to_jsonb(a)) where world_id = w.world_id and uid = w.uid;
  perform setseed(0.41);
  for n in 1..30 loop
    update player set stats = jsonb_set(stats, '{health}', '1'), wounds = '[]'::jsonb where world_id = w.world_id and uid = w.uid;
    perform hurt_player(w.world_id, w.uid, 0.01, 'A test blow', 'bite');
  end loop;
  insert into said values ('RIPOSTE:NONE', (select count(*) from class_mark where world_id = w.world_id and kind = 'riposte')::text);

  /* ---- The passives: each number, before and after ---- */
  m0 := melee_reach(w.world_id, w.uid);
  m1 := act_wind(w.world_id, w.uid, 'attack_creature', 0);
  update creature set to_x = v_px + ${REACH} + 0.5, from_x = v_px + ${REACH} + 0.5 where world_id = w.world_id and id = a;
  insert into said values ('REACH:BEFORE', coalesce(fight_refusal(w.world_id, w.uid, 'attack_creature', jsonb_build_object('kind', 'creature', 'id', a)), 'struck'));
  insert into said select 'CRIT:BEFORE', my_crit_chance(w.world_id, w.uid, (select x3 from weapon_def x3 where id = 'javelin'))
      || '|' || crit_mul(w.world_id, w.uid, (select x3 from weapon_def x3 where id = 'hunting_knife'));
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, k2.id from class_perk k2
    where k2.class = 'skirmisher' and not exists (select 1 from class_spell cs where cs.id = k2.id)
    on conflict do nothing;
  perform class_fold(w.world_id, w.uid);
  insert into said select 'FOLDED', coalesce((select string_agg(e.k || '=' || e.v, ';' order by e.k collate "C")
      from jsonb_each_text(class_mul->'fx') e(k, v) where e.k ~ '^(wind|crit|crithit|bleed|riposte|length):'), 'none')
    from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('LONG', m0 || '|' || melee_reach(w.world_id, w.uid)
    || '|' || coalesce(fight_refusal(w.world_id, w.uid, 'attack_creature', jsonb_build_object('kind', 'creature', 'id', a)), 'struck'));
  insert into said values ('LIGHT', (act_wind(w.world_id, w.uid, 'attack_creature', 0) / m1)::text);
  insert into said select 'CRIT', (my_crit_chance(w.world_id, w.uid, (select x3 from weapon_def x3 where id = 'javelin'))
        - crit_chance(skill_of(w.world_id, w.uid, 'throwing'), 'javelin', 'throwing'))
      || '|' || (my_crit_chance(w.world_id, w.uid, (select x3 from weapon_def x3 where id = 'hunting_knife'))
        - crit_chance(skill_of(w.world_id, w.uid, 'knives'), 'hunting_knife', 'knives'))
      || '|' || crit_mul(w.world_id, w.uid, (select x3 from weapon_def x3 where id = 'hunting_knife'))
      || '|' || crit_mul(w.world_id, w.uid, (select x3 from weapon_def x3 where id = 'javelin'))
      || '|' || crit_mul(w.world_id, w.uid, (select x3 from weapon_def x3 where id = 'sword'));
  -- Long Bleed on a knife's bleed, and on a Gut Throw's.
  update creature set to_x = v_px + 1, from_x = v_px + 1, health = max_health(creature), bleed_rate = null, bleed_until = null
   where world_id = w.world_id and id = a;
  perform side_blow(w.world_id, w.uid, a, 'knives', 10);
  insert into said select 'BLEED', (bleed_rate / 10) || '|' || extract(epoch from bleed_until - now()) from creature where world_id = w.world_id and id = a;
  -- Riposte: every blow dodged answered, once the creature's row is written.
  update creature set health = max_health(creature), bleed_rate = null, bleed_until = null, hunting = w.uid where world_id = w.world_id and id = a;
  delete from event where uid = w.uid;
  perform setseed(0.41);
  for n in 1..30 loop
    update player set stats = jsonb_set(stats, '{health}', '1'), wounds = '[]'::jsonb where world_id = w.world_id and uid = w.uid;
    perform hurt_player(w.world_id, w.uid, 0.01, 'A test blow', 'bite');
  end loop;
  select count(*) into n1 from event where uid = w.uid and text like 'You dodge the%';
  select coalesce((select cm.n from class_mark cm where cm.world_id = w.world_id and cm.creature_id = a and cm.kind = 'riposte'), 0) into n2;
  select health into h0 from creature where world_id = w.world_id and id = a;
  update item set dmg = 0 where id = v_jav;
  perform class_owed_pay(w.world_id, a);
  select count(*) into n3 from event where uid = w.uid and text like 'You answer the%';
  insert into said select 'RIPOSTE', n1 || '|' || n2 || '|' || n3 || '|' || (h0 - health)::text || '|'
      || (select count(*) from class_mark cm where cm.world_id = w.world_id and cm.kind = 'riposte')
    from creature where world_id = w.world_id and id = a;
  delete from creature where world_id = w.world_id and id = a;
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
  check(`both sides hold the Skirmisher's ${SPELLS.length} spells, field for field, what each wants in your hands included`,
    SPELLS.length === 12 && wrong.length === 0 && [...said.keys()].filter((k) => k.startsWith('SPELL:')).length === SPELLS.length,
    wrong.length ? `island ${island(`SPELL:${wrong[0].id}`)}, browser ${rowOf(wrong[0])}` : `${SPELLS.length} of them`);
}
check('the trade is taken up', island('TAKE') === 'took', island('TAKE'));

for (const th of THROWS) {
  const [ratio, landed] = parts(`THROW:${th.slug}`);
  check(`${spell(th.slug).name}: a throw at ${pct(th.want)} of a swing's`, landed === 'true' && near(Number(ratio), th.want, 1e-9),
    island(`THROW:${th.slug}`));
}
{
  const [rate, secs] = parts('GUT').map(Number);
  check(`Gut Throw bleeds it as a knife does: ${pct(KNIFE_BLEED)} of the throw a second for ${KNIFE_BLEED_SECS} s`,
    near(rate, KNIFE_BLEED * fx('gut_throw', 'more'), 1e-6) && near(secs, KNIFE_BLEED_SECS, 1e-6), island('GUT'));
}
{
  const [dx, dy, by] = parts('LEAP').map(Number);
  check(`Parting Throw leaps you ${fx('parting_throw', 'leap')} tiles straight back from it, and the browser is told where`,
    near(dx, -fx('parting_throw', 'leap'), 1e-9) && near(dy, 0, 1e-9) && near(by, fx('parting_throw', 'leap')), island('LEAP'));
}
{
  const [secs, pace] = parts('RUN').map(Number);
  const line = parts('THROW:hit_and_run')[2];
  check(`Hit and Run: for ${fx('hit_and_run', 'secs')} s a walk ${pct(fx('hit_and_run', 'pace') - 1)} faster, and it says so`,
    near(secs, fx('hit_and_run', 'secs'), 1e-6) && near(pace, fx('hit_and_run', 'pace'))
      && line.endsWith(`For ${fx('hit_and_run', 'secs')} s you walk ${pct(fx('hit_and_run', 'pace') - 1)} faster.`), island('RUN'));
  check('on the island\'s pace for a walk on foot', near(Number(island('PACE')), fx('hit_and_run', 'pace'), 1e-9), island('PACE'));
}
{
  const [secs, knocked, line] = parts('STAGGER');
  check(`Heavy Throw knocks a heavy blow off its stroke and puts its next blow back ${STAGGER_MAUL} s`,
    near(Number(secs), 5 + STAGGER_MAUL, 1e-6) && knocked === 'true' && line.endsWith(`Its next blow is put back ${STAGGER_MAUL} s.`), island('STAGGER'));
}
{
  const [long, snap] = parts('RANGE:LONG');
  check(`Long Throw reaches ${fx('long_throw', 'past')} tiles past your reach, where another throw is refused`,
    long === 'thrown' && snap === `The ogre is more than ${REACH} tiles away.`, island('RANGE:LONG'));
  check('and no further', island('RANGE:BEYOND') === `The ogre is more than ${REACH + fx('long_throw', 'past')} tiles away.`, island('RANGE:BEYOND'));
}
{
  const [secs, line] = parts('SOONER');
  check(`Snap Throw puts your own next swing ${fx('snap_throw', 'sooner')} s sooner`,
    near(Number(secs), 2 - fx('snap_throw', 'sooner'), 1e-6) && line.endsWith(`Your next swing comes ${fx('snap_throw', 'sooner')} s sooner.`),
    island('SOONER'));
}
{
  const [ratio, line] = parts('DOUBLE');
  check(`Double Throw: ${fx('double_throw', 'throws')} throws at ${pct(fx('double_throw', 'more'))} each, the very rolls of two swings`,
    near(Number(ratio), 1, 1e-5) && /^Double Throw: \d of 2 throws land/.test(line), island('DOUBLE'));
}
{
  const [first, glance, spared, line] = parts('RICOCHET');
  check(`Ricochet: a throw at ${pct(fx('ricochet', 'more'))}, glancing on at ${pct(fx('ricochet', 'glance'))} to the nearest other within `
    + `${fx('ricochet', 'reach')} tiles, and no further`,
  near(Number(first), 1, 1e-9) && near(Number(glance), 1, 1e-5) && spared === 'true' && /It glances on to the ogre/.test(line), island('RICOCHET'));
}
{
  const [ratio, hit, line] = parts('FAN');
  check(`Fan of Blades: a throw at ${pct(fx('fan_of_blades', 'more'))} at the one aimed at and at every other within ${fx('fan_of_blades', 'reach')} tiles of it, `
    + 'and none past',
  near(Number(ratio), 1, 1e-5) && hit === 'true,true,false' && line === 'Fan of Blades: you throw at 3 creatures.', island('FAN'));
}
{
  const [before, after, line] = parts('OPPORTUNIST');
  const [mine, theirs, brawl] = after.split(',').map(Number);
  check(`Opportunist: a blow ${pct(fx('opportunist', 'more') - 1)} harder on one fighting somebody else, a person or a creature, and not on one after you`,
    near(Number(before), 3) && near(mine, 1) && near(theirs, fx('opportunist', 'more')) && near(brawl, fx('opportunist', 'more'))
      && line.startsWith(`Opportunist: for ${fx('opportunist', 'secs')} s`), island('OPPORTUNIST'));
}
{
  const [who, marks, line] = parts('FADE');
  check(`Fade: everything hunting you loses you and is warned off you for ${fx('fade', 'secs')} s, and one after somebody else is left be`,
    who === 'false:false,false:false,false:true' && marks === `${fx('fade', 'secs')},${fx('fade', 'secs')}`
      && line === `Fade: 2 creatures lose you, and will not come for you again for ${fx('fade', 'secs')} s unless you strike them.`, island('FADE'));
  check('and none takes you up again while it holds', island('FADE:AFTER') === 'false', island('FADE:AFTER'));
  check('and it is refused when nothing is hunting you', island('FADE:NONE') === 'Nothing is hunting you.', island('FADE:NONE'));
}
{
  const [plain, marked, lost] = parts('MARKED:CRIT').map(Number);
  check(`Marked for Death: a blow on it critical ${fx('marked_for_death', 'crit')} times as often, the same rolls asked of both, whoever marked it`,
    plain > 10 && lost === 0 && marked / plain > fx('marked_for_death', 'crit') * 0.8 && marked / plain < fx('marked_for_death', 'crit') * 1.2,
    `${plain} and ${marked} criticals of 1500, ${lost} lost`);
  const [on, off, secs, line] = parts('MARKED');
  check(`and the spell marks it for ${fx('marked_for_death', 'secs')} s, it alone`,
    near(Number(on), fx('marked_for_death', 'crit')) && near(Number(off), 1) && near(Number(secs), fx('marked_for_death', 'secs'), 1e-6)
      && line.startsWith('Marked for Death: for 15 s'), island('MARKED'));
  check('as far as any spell and no further', island('MARKED:FAR') === 'The ogre is more than 12 tiles away.', island('MARKED:FAR'));
}
{
  const [snap, run] = parts('NEEDS:SWORD');
  check('a throw is refused with a sword in your hand, and a Hit and Run too',
    snap === `Snap Throw wants ${NEEDS_SAID.throwing.wants}.` && run === `Hit and Run wants ${NEEDS_SAID.skirmish.wants}.`, island('NEEDS:SWORD'));
  const [snapKnife, runKnife] = parts('NEEDS:KNIFE');
  check('with a knife a Hit and Run is made, and a throw still refused',
    snapKnife === `Snap Throw wants ${NEEDS_SAID.throwing.wants}.` && runKnife === 'ready', island('NEEDS:KNIFE'));
  check('and with bare hands, a Hit and Run is refused', island('NEEDS:HANDS') === `Hit and Run wants ${NEEDS_SAID.skirmish.wants}.`, island('NEEDS:HANDS'));
  check('a throwing axe throws as a javelin does', island('NEEDS:AXE') === 'ready|ready', island('NEEDS:AXE'));
}
{
  const [cast, stamina, rest, mul, secs] = parts('PAID');
  const s = spell('hit_and_run');
  check(`a spell called through the door costs its ${pct(s.cost)} of a full bar and rests ${s.rest} s`,
    cast === s.id && near(Number(stamina), 1 - s.cost) && near(Number(rest), s.rest, 1e-6), island('PAID'));
  check('and hands the browser the quicker walk to walk at', near(Number(mul), s.fx.pace) && near(Number(secs), s.fx.secs), island('PAID'));
  check('and is refused while it rests', island('RESTING') === `${s.name} can be called again in ${s.rest} seconds.`, island('RESTING'));
}

/* ---- The passives ------------------------------------------------------------ */

check('the six passives fold on the island to what they fold to in the browser',
  island('FOLDED') === Object.keys(FOLD).filter((k) => /^(wind|crit|crithit|bleed|riposte|length):/.test(k)).sort()
    .map((k) => `${k}=${FOLD[k]}`).join(';'), island('FOLDED'));
{
  const [before, after, struck] = parts('LONG');
  check(`Long Arm: a javelin reaches ${FOLD['length:throwing']} tile further, ${REACH} tiles to ${REACH + FOLD['length:throwing']}`,
    near(Number(before), REACH, 1e-9) && near(Number(after), REACH + FOLD['length:throwing'], 1e-9) && struck === 'struck'
      && island('REACH:BEFORE') === 'It is out of reach.', `${island('REACH:BEFORE')} ${island('LONG')}`);
}
check(`Light Throw: a swing of a javelin costs ${pct(1 - FOLD['wind:throwing'])} less stamina`, near(Number(island('LIGHT')), FOLD['wind:throwing'], 1e-9),
  island('LIGHT'));
{
  const [jav, knife, lethal, javMul, swordMul] = parts('CRIT').map(Number);
  const [javBefore, knifeBefore] = parts('CRIT:BEFORE').map(Number);
  check(`Keen Edge: a javelin critical ${Math.round(FOLD['crit:throwing'] * 100)} percentage points more often, and a knife as it was`,
    near(jav, FOLD['crit:throwing'], 1e-12) && near(knife, 0, 1e-12) && javBefore > 0, island('CRIT'));
  check(`Lethal: a knife's critical blow ${FOLD['crithit:knives']} times as hard instead of ${CRIT_HIT}, and a javelin's and a sword's as they were`,
    near(lethal, FOLD['crithit:knives']) && near(javMul, CRIT_HIT) && near(swordMul, CRIT_HIT) && near(knifeBefore, CRIT_HIT), island('CRIT'));
}
{
  const [rate, secs] = parts('BLEED').map(Number);
  check(`Long Bleed: a bleed you open lasts ${KNIFE_BLEED_SECS * FOLD['bleed:secs']} s instead of ${KNIFE_BLEED_SECS}, at the same rate`,
    near(rate, KNIFE_BLEED, 1e-9) && near(secs, KNIFE_BLEED_SECS * FOLD['bleed:secs'], 1e-6), island('BLEED'));
}
{
  const [dodged, owed, answered, lost, left] = parts('RIPOSTE').map(Number);
  check(`Riposte: every blow you dodge answered with a blow at ${pct(FOLD['riposte:blow'])} of a swing's, and nothing answered without it`,
    island('RIPOSTE:NONE') === '0' && dodged > 2 && owed === dodged && answered === dodged && lost > 0 && left === 0,
    `${island('RIPOSTE:NONE')} owed before; ${dodged} dodged, ${owed} owed, ${answered} answered, ${lost} off it, ${left} left owing`);
}
check('no function is open to a player but the doors', island('OPEN') === '0', island('OPEN'));

/* ---- The browser's half ----------------------------------------------------- */

check(`each of the ${CLASS_TIER_AT.length} tiers offers two spells and a passive`,
  TIERS.skirmisher.length === CLASS_TIER_AT.length && TIERS.skirmisher.every((row) => row.length === 3
    && row.filter((num) => SPELLS.some((s) => s.num === num)).length === 2), JSON.stringify(TIERS.skirmisher));
check('every spell that wants something in your hands says so first, in the words its refusal uses',
  SPELLS.every((s) => !s.needs || s.note.startsWith(`${NEEDS_SAID[s.needs].has}: `)));
check('and every spell\'s perk says what it costs before what it does',
  SPELLS.every((s) => PERK_BY_ID.get(s.id)!.note.startsWith('Spell') && PERK_BY_ID.get(s.id)!.note.endsWith(s.note)));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Skirmisher — ${ok.length} of ${ok.length}`);
