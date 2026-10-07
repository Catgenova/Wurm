/**
 * The Chirurgeon: twelve spells and six passives in six tiers that open on
 * the trade's own level, on the island (`the_chirurgeon.sql`) and in the
 * browser's rulebook (`talents.ts`, `perks.ts`).
 *
 * What this asks:
 *
 *   * both sides hold the same twelve spells, field for field, what each wants
 *     in your hands included, and the same tiers;
 *   * every heal puts back the share it names on whoever it names, you or
 *     somebody within its reach, and no further; every wound it closes closes
 *     by the share it names, the worst one or every one; a heal over time
 *     comes back a second at a time; a dressing in a Surgeon's Hands puts back
 *     twice as much; a creature bled, one or all near you; a knife blow that
 *     gives back what it takes;
 *   * a heal teaches the trade while the one it is put on is in a fight, and
 *     not otherwise;
 *   * the door charges its stamina and its rest;
 *   * and every passive moves the number it names at the dressing it changes,
 *     on the island, with the browser's fold the island's.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
// The rulebook first: `firstaid` is a part of it and cannot be loaded on its own.
import '../../src/game/actions';
import { CLASS_TIER_AT } from '../../src/game/classes';
import { FIELD_MEDIC_SAYS } from '../../src/game/firstaid';
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

const SPELLS = classSpellsOf('chirurgeon');
const spell = (slug: string): ClassSpellDef => {
  const s = CLASS_SPELL_BY_ID.get(`chirurgeon_${slug}`);
  if (!s) throw new Error(`no chirurgeon_${slug}`);
  return s;
};
const fx = (slug: string, k: string): number => spell(slug).fx[k];
const PASSIVES = perksOf('chirurgeon').filter((p) => !CLASS_SPELL_BY_ID.has(p.id));
/** What the six passives fold to, which is what the browser reads a Chirurgeon's numbers from. */
const FOLD = foldPerks(PASSIVES.map((p) => p.id));
const FIRST_CLASS_SLOT = SPELL_BAR.indexOf('class');

/** A spell's row as the island prints it and as the browser would: every field, the numbers by name. */
const rowOf = (s: ClassSpellDef): string =>
  [s.id, s.class, s.num, s.name, s.cost, s.rest, s.on.join('+'),
    Object.keys(s.fx).sort().map((k) => `${k}=${s.fx[k]}`).join(';'), s.note, s.needs ?? '-'].join('¦');

/** Two wounds, both bleeding: a light cut and a deeper bite, the bite the worst. */
const WOUNDS = `jsonb_build_array(
    jsonb_build_object('id', 1, 'kind', 'cut', 'part', 'arms', 'severity', 0.1, 'bleeding', true, 'infected', false, 'dressing', null, 'at', 0),
    jsonb_build_object('id', 2, 'kind', 'bite', 'part', 'legs', 'severity', 0.2, 'bleeding', true, 'infected', false, 'dressing', null, 'at', 0))`;
/** A person as a spell aims at them, as `spell_target` hands them on. */
const ON_O = `jsonb_build_object('kind', 'player', 'uid', o)`;
const ON_ME = `jsonb_build_object('kind', 'self', 'uid', w.uid)`;
/** What a body's wounds read as: id, severity to the thousandth, bleeding. */
const WOUNDS_READ = `coalesce((select string_agg((wd->>'id') || ':' || round((wd->>'severity')::numeric, 3) || ':' || (wd->>'bleeding'), ',' order by (wd->>'id')::int)
  from jsonb_array_elements(pl.wounds) t(wd)), 'none')`;

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
/* How long a dressing of one fresh cut is set to take, as the queue starts it (rpc_act). */
create function pg_temp.dress_secs(w uuid, u uuid) returns double precision language plpgsql as $f$
declare v double precision;
begin
  update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_goes = null, act_queue = '[]',
         wounds = jsonb_build_array(jsonb_build_object('id', 9, 'kind', 'cut', 'part', 'arms', 'severity', 0.6, 'bleeding', true,
           'infected', false, 'dressing', null, 'at', 0))
   where world_id = w and uid = u;
  delete from caller where uid = u;
  perform rpc_act(w, 'bind_wound', jsonb_build_object('kind', 'self'));
  select extract(epoch from act_ends - act_started) into v from player where world_id = w and uid = u;
  update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_goes = null, act_queue = '[]',
         wounds = '[]'::jsonb
   where world_id = w and uid = u;
  return v;
end $f$;
do $b$
declare w record; o uuid; v_px double precision; v_py double precision; r jsonb; c creature;
        a int; b int; t int; k int; n int; v_knife bigint;
        h0 double precision; h1 double precision; d1 double precision; m0 double precision; m1 double precision;
        n1 int; n2 int; v_seed double precision;
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
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('health', 1, 'hunger', 1, 'thirst', 1, 'stamina', 1, 'aegis', 0,
                                                                    'hurtSettled', now())
   where world_id = w.world_id and uid in (w.uid, o);
  update player set x = v_px + 1.5 where world_id = w.world_id and uid = o;
  -- Everybody else on the island well away, so the circle has two in it.
  update player set x = v_px - 60 where world_id = w.world_id and uid not in (w.uid, o);
  insert into skill (world_id, uid, id, value)
    select w.world_id, w.uid, s, v from
      (values ('chirurgy', 100::double precision), ('knives', 100), ('fighting', 100), ('first_aid', 100)) sv(s, v)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  delete from event where uid in (w.uid, o);
  delete from player_node where world_id = w.world_id and uid in (w.uid, o);
  delete from player_spell where world_id = w.world_id and uid in (w.uid, o);
  delete from creature where world_id = w.world_id and to_x between v_px - 45 and v_px + 45 and to_y between v_py - 45 and v_py + 45;
  delete from creature where world_id = w.world_id and hunting in (w.uid, o);
  delete from class_mark where world_id = w.world_id;
  delete from faith_owed where world_id = w.world_id;
  delete from faith_zone where world_id = w.world_id;
  delete from caller where uid in (w.uid, o);
  perform set_config('request.jwt.claims', json_build_object('sub', w.uid)::text, true);
  v_knife := give(w.world_id, w.uid, 'hunting_knife', 1, 40);
  perform give(w.world_id, w.uid, 'bandage', 200, 50);

  /* ---- The rows ---- */
  insert into said select 'SPELL:' || id, id || '¦' || class || '¦' || num || '¦' || name || '¦' || cost || '¦' || rest || '¦'
      || array_to_string(on_what, '+') || '¦' || coalesce((select string_agg(e.k || '=' || e.v, ';' order by e.k) from jsonb_each_text(fx) e(k, v)), '')
      || '¦' || note || '¦' || coalesce(needs, '-')
    from class_spell where class = 'chirurgeon';

  insert into said values ('TAKE', coalesce(rpc_take_class(w.world_id, 'chirurgeon')->>'why', 'took'));
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, cs.id from class_spell cs where cs.class = 'chirurgeon'
    on conflict do nothing;

  /* ---- Field Dressing: its share back, the worst bleeding wound stopped; not on one unhurt; no further than it reaches ---- */
  update player set wounds = ${WOUNDS}, stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid = o;
  r := class_spell_cast(w.world_id, w.uid, 'chirurgeon_field_dressing', ${ON_O});
  insert into said select 'FIELD', (pl.stats->>'health') || '|' || ${WOUNDS_READ} || '|' || coalesce(r->>'said', r->>'why')
    from player pl where pl.world_id = w.world_id and pl.uid = o;
  update player set wounds = '[]'::jsonb, stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = o;
  insert into said values ('FIELD:WHOLE', class_spell_cast(w.world_id, w.uid, 'chirurgeon_field_dressing', ${ON_O})->>'why');
  update player set x = v_px + ${fx('field_dressing', 'reach')} + 1, stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid = o;
  insert into said values ('FIELD:FAR', class_spell_cast(w.world_id, w.uid, 'chirurgeon_field_dressing', ${ON_O})->>'why');
  update player set x = v_px + 1.5, stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = o;

  /* ---- Quick Stitch: the worst wound by its share, and nothing else ---- */
  update player set wounds = ${WOUNDS} where world_id = w.world_id and uid = o;
  r := class_spell_cast(w.world_id, w.uid, 'chirurgeon_quick_stitch', ${ON_O});
  insert into said select 'STITCH', ${WOUNDS_READ} || '|' || coalesce(r->>'said', r->>'why') from player pl where pl.world_id = w.world_id and pl.uid = o;
  update player set wounds = '[]'::jsonb where world_id = w.world_id and uid = o;
  insert into said values ('STITCH:NONE', class_spell_cast(w.world_id, w.uid, 'chirurgeon_quick_stitch', ${ON_O})->>'why');

  /* ---- Battlefield Surgery: every wound by its share, and health back ---- */
  update player set wounds = ${WOUNDS}, stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid = o;
  r := class_spell_cast(w.world_id, w.uid, 'chirurgeon_battlefield_surgery', ${ON_O});
  insert into said select 'SURGERY', (pl.stats->>'health') || '|' || ${WOUNDS_READ} || '|' || coalesce(r->>'said', r->>'why')
    from player pl where pl.world_id = w.world_id and pl.uid = o;

  /* ---- Miracle Worker: every wound gone, the bad one too, and health back ---- */
  update player set wounds = ${WOUNDS} || jsonb_build_array(jsonb_build_object('id', 3, 'kind', 'pierce', 'part', 'chest', 'severity', 0.05,
           'bleeding', false, 'infected', true, 'dressing', null, 'at', 0, 'venom', 4)),
         stats = jsonb_set(stats, '{health}', '0.3') where world_id = w.world_id and uid = o;
  r := class_spell_cast(w.world_id, w.uid, 'chirurgeon_miracle_worker', ${ON_O});
  insert into said select 'MIRACLE', (pl.stats->>'health') || '|' || ${WOUNDS_READ} || '|' || coalesce(r->>'said', r->>'why')
    from player pl where pl.world_id = w.world_id and pl.uid = o;
  update player set stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = o;

  /* ---- Restoration: on you, every wound gone, and health back; refused unhurt ---- */
  update player set wounds = ${WOUNDS}, stats = jsonb_set(stats, '{health}', '0.4') where world_id = w.world_id and uid = w.uid;
  r := class_spell_cast(w.world_id, w.uid, 'chirurgeon_restoration', ${ON_ME});
  insert into said select 'RESTORE', (pl.stats->>'health') || '|' || ${WOUNDS_READ} || '|' || coalesce(r->>'said', r->>'why')
    from player pl where pl.world_id = w.world_id and pl.uid = w.uid;
  update player set wounds = '[]'::jsonb, stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = w.uid;
  insert into said values ('RESTORE:WHOLE', class_spell_cast(w.world_id, w.uid, 'chirurgeon_restoration', ${ON_ME})->>'why');

  /* ---- Healing Circle and Mass Dressing: you and everybody within reach ---- */
  update player set stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid in (w.uid, o);
  r := class_spell_cast(w.world_id, w.uid, 'chirurgeon_healing_circle', ${ON_ME});
  insert into said select 'CIRCLE', string_agg(pl.stats->>'health', ',' order by pl.uid = w.uid desc) || '|' || coalesce(r->>'said', r->>'why')
    from player pl where pl.world_id = w.world_id and pl.uid in (w.uid, o);
  update player set stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid in (w.uid, o);
  insert into said values ('CIRCLE:WHOLE', class_spell_cast(w.world_id, w.uid, 'chirurgeon_healing_circle', ${ON_ME})->>'why');
  update player set wounds = ${WOUNDS} where world_id = w.world_id and uid in (w.uid, o);
  r := class_spell_cast(w.world_id, w.uid, 'chirurgeon_mass_dressing', ${ON_ME});
  insert into said select 'MASS', string_agg(${WOUNDS_READ}, ';' order by pl.uid = w.uid desc) || '|' || coalesce(r->>'said', r->>'why')
    from player pl where pl.world_id = w.world_id and pl.uid in (w.uid, o);
  update player set wounds = '[]'::jsonb where world_id = w.world_id and uid in (w.uid, o);
  insert into said values ('MASS:NONE', class_spell_cast(w.world_id, w.uid, 'chirurgeon_mass_dressing', ${ON_ME})->>'why');

  /* ---- Regenerate: a second at a time, from the cast, for as long as it says ---- */
  update player set stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid = o;
  r := class_spell_cast(w.world_id, w.uid, 'chirurgeon_regenerate', ${ON_O});
  insert into said select 'REGEN', extract(epoch from (pl.blessings->'regenerate'->>'until')::timestamptz - now()) || '|'
      || (pl.blessings->'regenerate'->>'each') || '|'
      -- Ten seconds of it, and the whole of it however long the body went unsettled.
      || class_regen(jsonb_set(pl.blessings, '{regenerate,at}', to_jsonb(now() - interval '10 seconds')), now() - interval '10 seconds') || '|'
      || class_regen(jsonb_set(jsonb_set(pl.blessings, '{regenerate,at}', to_jsonb(now() - interval '60 seconds')),
                               '{regenerate,until}', to_jsonb(now() - interval '45 seconds')), now() - interval '120 seconds') || '|'
      || (select (strpos(pg_get_functiondef('body_settle'::regproc), 'class_regen(') > 0)::text) || '|' || coalesce(r->>'said', r->>'why')
    from player pl where pl.world_id = w.world_id and pl.uid = o;
  update player set blessings = '{}'::jsonb, stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = o;

  /* ---- Surgeon's Hands: a dressing puts back twice as much, the same roll asked of both ---- */
  r := class_spell_cast(w.world_id, w.uid, 'chirurgeon_surgeons_hands', ${ON_ME});
  insert into said select 'HANDS:SAID', extract(epoch from (pl.blessings->'surgeons_hands'->>'until')::timestamptz - now()) || '|' || coalesce(r->>'said', r->>'why')
    from player pl where pl.world_id = w.world_id and pl.uid = w.uid;
  update player set wounds = jsonb_build_array(jsonb_build_object('id', 9, 'kind', 'cut', 'part', 'arms', 'severity', 0.6, 'bleeding', true,
           'infected', false, 'dressing', null, 'at', 0)), stats = jsonb_set(stats, '{health}', '0.1') where world_id = w.world_id and uid = w.uid;
  perform setseed(0.37);
  perform perform_fight(w.world_id, w.uid, 'bind_wound', jsonb_build_object('kind', 'self'));
  select (stats->>'health')::double precision - 0.1 into m1 from player where world_id = w.world_id and uid = w.uid;
  update player set blessings = '{}'::jsonb, wounds = jsonb_build_array(jsonb_build_object('id', 9, 'kind', 'cut', 'part', 'arms', 'severity', 0.6,
           'bleeding', true, 'infected', false, 'dressing', null, 'at', 0)), stats = jsonb_set(stats, '{health}', '0.1')
   where world_id = w.world_id and uid = w.uid;
  perform setseed(0.37);
  perform perform_fight(w.world_id, w.uid, 'bind_wound', jsonb_build_object('kind', 'self'));
  select (stats->>'health')::double precision - 0.1 into m0 from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('HANDS', (m1 / m0)::text);
  update player set wounds = '[]'::jsonb, stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = w.uid;

  /* ---- Toxin and Plague: a bleed of its share of its full health, as far as each reaches ---- */
  a := creature_spawn(w.world_id, 'ogre', v_px + ${fx('toxin', 'reach')} - 0.5, v_py, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'ogre', v_px, v_py - ${fx('plague', 'reach')} + 0.5, 'wild', now() - interval '2 hours', null);
  t := creature_spawn(w.world_id, 'ogre', v_px - ${fx('plague', 'reach')} - 1, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = null, settled_at = now(), until = now() + interval '1 hour', windup_at = null,
         bleed_rate = null, bleed_until = null, health = max_health(creature) where world_id = w.world_id and id in (a, b, t);
  r := class_spell_cast(w.world_id, w.uid, 'chirurgeon_toxin', jsonb_build_object('kind', 'enemy', 'id', a));
  insert into said select 'TOXIN', (bleed_rate / max_health(creature)) || '|' || extract(epoch from bleed_until - now()) || '|' || coalesce(r->>'said', r->>'why')
    from creature where world_id = w.world_id and id = a;
  insert into said values ('TOXIN:FAR', class_spell_cast(w.world_id, w.uid, 'chirurgeon_toxin', jsonb_build_object('kind', 'enemy', 'id', t))->>'why');
  update creature set bleed_rate = null, bleed_until = null where world_id = w.world_id and id = a;
  r := class_spell_cast(w.world_id, w.uid, 'chirurgeon_plague', ${ON_ME});
  insert into said select 'PLAGUE', string_agg(coalesce(round((bleed_rate / max_health(creature))::numeric, 6)::text || '@'
        || round(extract(epoch from bleed_until - now()))::text, 'none'), ',' order by case id when a then 1 when b then 2 else 3 end)
      || '|' || coalesce(r->>'said', r->>'why')
    from creature where world_id = w.world_id and id in (a, b, t);
  delete from creature where world_id = w.world_id and id in (a, b, t);

  /* ---- Leech: a knife blow at its share of a swing's, the same roll asked twice, and what it takes back ---- */
  update player set equipped = jsonb_build_object('weapon', v_knife) where world_id = w.world_id and uid = w.uid;
  a := creature_spawn(w.world_id, 'ogre', v_px - 1.5, v_py, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'ogre', v_px + 1.5, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, enemy = null, hunt_again = null, settled_at = now(),
         until = now() + interval '1 hour', windup_at = null where world_id = w.world_id and id in (a, b);
  update creature set health = max_health(creature) where world_id = w.world_id and id in (a, b);
  -- Down to what the Leech is cast on, for the swing as well, so that the two are asked alike.
  update player set stats = jsonb_set(stats, '{health}', '0.4') where world_id = w.world_id and uid = w.uid;
  for k in 1..12 loop
    -- Kept past the loop: the loop's own k is gone once it ends.
    v_seed := k / 100.0;
    update item set dmg = 0 where id = v_knife;
    perform setseed(v_seed);
    perform creature_settle(w.world_id, a);
    r := class_blow(w.world_id, w.uid, a, 1);
    exit when (r->>'landed')::boolean;
    -- The other one missed the same way, so that the two are alike when the Leech comes.
    perform setseed(v_seed);
    perform creature_settle(w.world_id, b);
    perform class_blow(w.world_id, w.uid, b, 1);
    update creature set health = max_health(creature), bleed_rate = null, bleed_until = null where world_id = w.world_id and id in (a, b);
  end loop;
  d1 := (r->>'dmg')::double precision;
  update item set dmg = 0 where id = v_knife;
  update player set stats = jsonb_set(stats, '{health}', '0.4') where world_id = w.world_id and uid = w.uid;
  select max_health(cr) into m0 from creature cr where cr.world_id = w.world_id and cr.id = b;
  perform setseed(v_seed);
  r := class_spell_cast(w.world_id, w.uid, 'chirurgeon_leech', jsonb_build_object('kind', 'enemy', 'id', b));
  insert into said select 'LEECH', ((r->'blow'->>'dmg')::double precision / d1) || '|' || coalesce(r->'blow'->>'landed', r->>'why') || '|'
      || ((pl.stats->>'health')::double precision - 0.4) || '|' || ((r->'blow'->>'dmg')::double precision / m0) || '|' || coalesce(r->>'said', '')
    from player pl where pl.world_id = w.world_id and pl.uid = w.uid;
  update player set stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = w.uid;
  delete from creature where world_id = w.world_id and id in (a, b);

  /* ---- A heal teaches the trade while the one it is on is in a fight, and not otherwise ---- */
  update player set stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid = o;
  select class_level into m0 from player where world_id = w.world_id and uid = w.uid;
  perform class_spell_cast(w.world_id, w.uid, 'chirurgeon_field_dressing', ${ON_O});
  select class_level into m1 from player where world_id = w.world_id and uid = w.uid;
  a := creature_spawn(w.world_id, 'ogre', v_px + 20, v_py, 'wild', now() - interval '2 hours', null);
  update creature set hunting = o, until = now() + interval '1 hour', settled_at = now() where world_id = w.world_id and id = a;
  update player set stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid = o;
  perform class_spell_cast(w.world_id, w.uid, 'chirurgeon_field_dressing', ${ON_O});
  insert into said select 'LEARN', (m1 = m0)::text || '|' || (class_level > m1)::text from player where world_id = w.world_id and uid = w.uid;
  delete from creature where world_id = w.world_id and id = a;
  update player set stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = o;

  /* ---- The door: what is in your hands, stamina and rest ---- */
  delete from caller where uid = w.uid;
  update player set equipped = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  insert into said values ('NEEDS:HANDS', spell_cast_refusal(w.world_id, w.uid, 'chirurgeon_leech'));
  update player set equipped = jsonb_build_object('weapon', v_knife) where world_id = w.world_id and uid = w.uid;
  insert into said values ('NEEDS:KNIFE', coalesce(spell_cast_refusal(w.world_id, w.uid, 'chirurgeon_leech'), 'ready'));
  update player set used_at = '{}'::jsonb, stats = jsonb_set(jsonb_set(stats, '{stamina}', '1'), '{health}', '0.5')
   where world_id = w.world_id and uid = w.uid;
  perform spell_bar_put(w.world_id, w.uid, ${FIRST_CLASS_SLOT}, 'chirurgeon_field_dressing');
  r := rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'self'));
  insert into said select 'PAID', coalesce(r->>'cast', r->>'why') || '|' || (stats->>'stamina') || '|' || (r->'rest'->>'chirurgeon_field_dressing')
      || '|' || (stats->>'health')
    from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('RESTING', rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'self'))->>'why');
  update player set used_at = '{}'::jsonb, blessings = '{}'::jsonb, stats = jsonb_set(jsonb_set(stats, '{stamina}', '1'), '{health}', '1')
   where world_id = w.world_id and uid = w.uid;

  /* ---- Before the passives: somebody else refused, and slips on a poor hand ---- */
  insert into said values ('OTHERS:BEFORE', coalesce(fight_refusal(w.world_id, w.uid, 'bind_wound', jsonb_build_object('kind', 'person', 'uid', o)), 'dressed'));
  update skill set value = 1 where world_id = w.world_id and uid = w.uid and id = 'first_aid';
  delete from event where uid = w.uid;
  perform setseed(0.53);
  for n in 1..30 loop
    update player set wounds = jsonb_build_array(jsonb_build_object('id', 9, 'kind', 'cut', 'part', 'arms', 'severity', 0.6, 'bleeding', true,
             'infected', false, 'dressing', null, 'at', 0)), stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid = w.uid;
    perform perform_fight(w.world_id, w.uid, 'bind_wound', jsonb_build_object('kind', 'self'));
  end loop;
  select count(*) into n1 from event where uid = w.uid and text like 'The dressing slips%';
  m0 := pg_temp.dress_secs(w.world_id, w.uid);

  /* ---- The passives: each number, before and after ---- */
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, k2.id from class_perk k2
    where k2.class = 'chirurgeon' and not exists (select 1 from class_spell cs where cs.id = k2.id)
    on conflict do nothing;
  perform class_fold(w.world_id, w.uid);
  insert into said select 'FOLDED', coalesce((select string_agg(e.k || '=' || e.v, ';' order by e.k collate "C")
      from jsonb_each_text(class_mul->'fx') e(k, v) where e.k ~ '^(dress_others|fail|fester|stamina|time|triage)'), 'none')
    from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('QUICK', (pg_temp.dress_secs(w.world_id, w.uid) / m0)::text);
  delete from event where uid = w.uid;
  perform setseed(0.53);
  for n in 1..30 loop
    update player set wounds = jsonb_build_array(jsonb_build_object('id', 9, 'kind', 'cut', 'part', 'arms', 'severity', 0.6, 'bleeding', true,
             'infected', false, 'dressing', null, 'at', 0)), stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid = w.uid;
    perform perform_fight(w.world_id, w.uid, 'bind_wound', jsonb_build_object('kind', 'self'));
  end loop;
  select count(*) into n2 from event where uid = w.uid and text like 'The dressing slips%';
  insert into said values ('SURE', n1 || '|' || n2);
  update skill set value = 100 where world_id = w.world_id and uid = w.uid and id = 'first_aid';
  -- Clean Cloth: the wound under it marked, and half as likely to go bad as the same wound without the mark.
  update player set wounds = jsonb_build_array(jsonb_build_object('id', 9, 'kind', 'cut', 'part', 'arms', 'severity', 0.6, 'bleeding', true,
           'infected', false, 'dressing', null, 'at', 0)), stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid = w.uid;
  delete from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def = 'cover';
  perform perform_fight(w.world_id, w.uid, 'bind_wound', jsonb_build_object('kind', 'self'));
  insert into said select 'CLEAN', coalesce(wd->>'fester', 'none') || '|' || coalesce(wd->>'dressing', 'none') || '|'
      || (fester_chance(wd) / fester_chance(wd - 'fester'))
    from player pl, jsonb_array_elements(pl.wounds) t(wd) where pl.world_id = w.world_id and pl.uid = w.uid;
  update player set wounds = '[]'::jsonb, stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = w.uid;
  -- Field Surgeon, Bedside Manner and Triage Instinct: somebody else dressed, their wind back, and more on one far gone.
  update player set wounds = jsonb_build_array(jsonb_build_object('id', 9, 'kind', 'cut', 'part', 'arms', 'severity', 0.6, 'bleeding', true,
           'infected', false, 'dressing', null, 'at', 0)), stats = jsonb_set(jsonb_set(stats, '{health}', '0.5'), '{stamina}', '0.5')
   where world_id = w.world_id and uid = o;
  insert into said values ('OTHERS', coalesce(fight_refusal(w.world_id, w.uid, 'bind_wound', jsonb_build_object('kind', 'person', 'uid', o)), 'dressed'));
  perform setseed(0.61);
  perform perform_fight(w.world_id, w.uid, 'bind_wound', jsonb_build_object('kind', 'person', 'uid', o));
  select (stats->>'health')::double precision - 0.5 into m0 from player where world_id = w.world_id and uid = o;
  insert into said select 'BEDSIDE', (stats->>'stamina') || '|' || ${WOUNDS_READ.replace('pl.wounds', 'player.wounds')} from player where world_id = w.world_id and uid = o;
  update player set wounds = jsonb_build_array(jsonb_build_object('id', 9, 'kind', 'cut', 'part', 'arms', 'severity', 0.6, 'bleeding', true,
           'infected', false, 'dressing', null, 'at', 0)), stats = jsonb_set(stats, '{health}', '0.2')
   where world_id = w.world_id and uid = o;
  perform setseed(0.61);
  perform perform_fight(w.world_id, w.uid, 'bind_wound', jsonb_build_object('kind', 'person', 'uid', o));
  select (stats->>'health')::double precision - 0.2 into m1 from player where world_id = w.world_id and uid = o;
  insert into said values ('TRIAGE', coalesce((m1 / nullif(m0, 0))::text, 'nothing healed'));
  update player set wounds = '[]'::jsonb, stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{stamina}', '1') where world_id = w.world_id and uid = o;
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
  check(`both sides hold the Chirurgeon's ${SPELLS.length} spells, field for field, what each wants in your hands included`,
    SPELLS.length === 12 && wrong.length === 0 && [...said.keys()].filter((k) => k.startsWith('SPELL:')).length === SPELLS.length,
    wrong.length ? `island ${island(`SPELL:${wrong[0].id}`)}, browser ${rowOf(wrong[0])}` : `${SPELLS.length} of them`);
}
check('the trade is taken up', island('TAKE') === 'took', island('TAKE'));
{
  const [health, wounds, line] = parts('FIELD');
  check(`Field Dressing: ${pct(fx('field_dressing', 'heal'))} of their health back, and the worst bleeding wound stopped, and only it`,
    near(Number(health), 0.5 + fx('field_dressing', 'heal'), 1e-9) && wounds === '1:0.100:true,2:0.200:false'
      && /heals [^ ]+ by 10% and stops a wound bleeding\.$/.test(line), island('FIELD'));
  check('and it is refused on somebody unhurt', / is not hurt\.$/.test(island('FIELD:WHOLE')), island('FIELD:WHOLE'));
  check(`and on somebody more than ${fx('field_dressing', 'reach')} tiles off`,
    island('FIELD:FAR').endsWith(` is more than ${fx('field_dressing', 'reach')} tiles away.`), island('FIELD:FAR'));
}
{
  const [wounds, line] = parts('STITCH');
  check(`Quick Stitch: the worst wound ${pct(fx('quick_stitch', 'close'))} closed, and the other as it was`,
    wounds === `1:0.100:true,2:${(0.2 * (1 - fx('quick_stitch', 'close'))).toFixed(3)}:true` && /closes the worst wound on/.test(line), island('STITCH'));
  check('and it is refused on somebody with no wound', / has no wound\.$/.test(island('STITCH:NONE')), island('STITCH:NONE'));
}
{
  const [health, wounds] = parts('SURGERY');
  const f = 1 - fx('battlefield_surgery', 'close');
  check(`Battlefield Surgery: every wound ${pct(fx('battlefield_surgery', 'close'))} closed, and ${pct(fx('battlefield_surgery', 'heal'))} of their health back`,
    near(Number(health), 0.5 + fx('battlefield_surgery', 'heal'), 1e-9) && wounds === `1:${(0.1 * f).toFixed(3)}:true,2:${(0.2 * f).toFixed(3)}:true`,
    island('SURGERY'));
}
{
  const [health, wounds] = parts('MIRACLE');
  check(`Miracle Worker: every wound gone, the bad one with its venom too, and ${pct(fx('miracle_worker', 'heal'))} of their health back`,
    near(Number(health), 0.3 + fx('miracle_worker', 'heal'), 1e-9) && wounds === 'none', island('MIRACLE'));
}
{
  const [health, wounds] = parts('RESTORE');
  check(`Restoration: every wound on you gone, and ${pct(fx('restoration', 'heal'))} of your health back`,
    near(Number(health), 0.4 + fx('restoration', 'heal'), 1e-9) && wounds === 'none', island('RESTORE'));
  check('and it is refused on you unhurt', island('RESTORE:WHOLE') === 'You are not hurt.', island('RESTORE:WHOLE'));
}
{
  const [both, line] = parts('CIRCLE');
  const want = String(0.5 + fx('healing_circle', 'heal'));
  check(`Healing Circle: you and everybody within ${fx('healing_circle', 'reach')} tiles get ${pct(fx('healing_circle', 'heal'))} back`,
    both === `${want},${want}` && line === `Healing Circle heals 2 people by ${pct(fx('healing_circle', 'heal'))}.`, island('CIRCLE'));
  check('and it is refused when nobody is hurt',
    island('CIRCLE:WHOLE') === `Nobody within ${fx('healing_circle', 'reach')} tiles of you is hurt, you included.`, island('CIRCLE:WHOLE'));
}
{
  const [both, line] = parts('MASS');
  const each = `1:0.100:true,2:${(0.2 * (1 - fx('mass_dressing', 'close'))).toFixed(3)}:false`;
  check(`Mass Dressing: the worst wound on you and on everybody near stopped and ${pct(fx('mass_dressing', 'close'))} closed`,
    both === `${each};${each}` && /on 2 people\.$/.test(line), island('MASS'));
  check('and it is refused when nobody has a wound', /has a wound, you included\.$/.test(island('MASS:NONE')), island('MASS:NONE'));
}
{
  const [secs, each, ten, all, wired, line] = parts('REGEN');
  check(`Regenerate: ${pct(fx('regenerate', 'each'))} of their health a second for ${fx('regenerate', 'secs')} s, settled with the body`,
    near(Number(secs), fx('regenerate', 'secs'), 1e-6) && near(Number(each), fx('regenerate', 'each'))
      && near(Number(ten), 10 * fx('regenerate', 'each'), 1e-9) && near(Number(all), fx('regenerate', 'secs') * fx('regenerate', 'each'), 1e-9)
      && wired === 'true' && line.endsWith(`a second for ${fx('regenerate', 'secs')} s.`), island('REGEN'));
}
{
  const [secs, line] = parts('HANDS:SAID');
  check(`Surgeon's Hands: for ${fx('surgeons_hands', 'secs')} s a dressing puts back ${fx('surgeons_hands', 'more')} times as much, the same roll asked of both`,
    near(Number(island('HANDS')), fx('surgeons_hands', 'more'), 1e-6) && near(Number(secs), fx('surgeons_hands', 'secs'), 1e-6)
      && line.startsWith('Surgeon’s Hands: for 20 s'), `${island('HANDS')} — ${island('HANDS:SAID')}`);
}
{
  const [rate, secs, line] = parts('TOXIN');
  check(`Toxin: ${pct(fx('toxin', 'each'))} of its full health a second for ${fx('toxin', 'secs')} s`,
    near(Number(rate), fx('toxin', 'each'), 1e-6) && near(Number(secs), fx('toxin', 'secs'), 1e-6) && line.startsWith('Toxin: the ogre bleeds'),
    island('TOXIN'));
  check(`and no further than ${fx('toxin', 'reach')} tiles`, island('TOXIN:FAR') === `The ogre is more than ${fx('toxin', 'reach')} tiles away.`,
    island('TOXIN:FAR'));
  const [bled, line2] = parts('PLAGUE');
  const one = `${fx('plague', 'each').toFixed(6)}@${fx('plague', 'secs')}`;
  check(`Plague: everything within ${fx('plague', 'reach')} tiles of you bleeds ${pct(fx('plague', 'each'))} for ${fx('plague', 'secs')} s, and nothing past`,
    bled === `${one},${one},none` && line2.startsWith('Plague: 2 creatures bleed'), island('PLAGUE'));
}
{
  const [ratio, landed, gained, took, line] = parts('LEECH');
  check(`Leech: a knife blow at ${pct(fx('leech', 'more'))} of a swing's, and back as large a share of your health as it takes of the creature's`,
    landed === 'true' && near(Number(ratio), fx('leech', 'more'), 1e-9) && near(Number(gained), Number(took), 1e-6)
      && / You get back \d+% of your health\.$/.test(line), island('LEECH'));
}
{
  const [quiet, fought] = parts('LEARN');
  check('a heal teaches the trade while the one it is on is hunted, and not otherwise', quiet === 'true' && fought === 'true', island('LEARN'));
}
check('a Leech is refused with bare hands', island('NEEDS:HANDS') === `Leech wants ${NEEDS_SAID.knives.wants}.`, island('NEEDS:HANDS'));
check('and made with a knife', island('NEEDS:KNIFE') === 'ready', island('NEEDS:KNIFE'));
{
  const [cast, stamina, rest, health] = parts('PAID');
  const s = spell('field_dressing');
  check(`a spell called through the door costs its ${pct(s.cost)} of a full bar and rests ${s.rest} s`,
    cast === s.id && near(Number(stamina), 1 - s.cost) && near(Number(rest), s.rest, 1e-6) && near(Number(health), 0.5 + s.fx.heal), island('PAID'));
  check('and is refused while it rests', island('RESTING') === `${s.name} can be called again in ${s.rest} seconds.`, island('RESTING'));
}

/* ---- The passives ------------------------------------------------------------ */

check('the six passives fold on the island to what they fold to in the browser',
  island('FOLDED') === Object.keys(FOLD).filter((k) => /^(dress_others|fail|fester|stamina|time|triage)/.test(k)).sort()
    .map((k) => `${k}=${FOLD[k]}`).join(';'), island('FOLDED'));
check('Field Surgeon: somebody else\'s wounds refused without it, in the browser\'s words, and dressed with it',
  island('OTHERS:BEFORE') === FIELD_MEDIC_SAYS && island('OTHERS') === 'dressed', `${island('OTHERS:BEFORE')} / ${island('OTHERS')}`);
check(`Quick Bandage: a dressing ${pct(1 - FOLD['time:bind_wound'])} quicker`, near(Number(island('QUICK')), FOLD['time:bind_wound'], 1e-4),
  island('QUICK'));
{
  const [before, after] = parts('SURE').map(Number);
  check('Sure Dressing: a poor hand slips, and never with it', before > 3 && after === 0, `${before} slips of 30 before, ${after} after`);
}
{
  const [mark, dressing, ratio] = parts('CLEAN');
  check(`Clean Cloth: a wound you dress goes bad ${FOLD['fester:bind_wound']} as often`,
    near(Number(mark), FOLD['fester:bind_wound']) && dressing === '' && near(Number(ratio), FOLD['fester:bind_wound'], 1e-9), island('CLEAN'));
}
{
  const [stamina] = parts('BEDSIDE');
  check(`Bedside Manner: whoever you dress gets ${pct(FOLD['stamina:bind_wound'])} of their stamina back`,
    near(Number(stamina), 0.5 + FOLD['stamina:bind_wound'], 1e-9), island('BEDSIDE'));
}
check(`Triage Instinct: a dressing on somebody below ${pct(FOLD['triage:below'])} of their health puts back ${pct(FOLD['triage:heal'] - 1)} more, the same roll asked of both`,
  near(Number(island('TRIAGE')), FOLD['triage:heal'], 1e-6), island('TRIAGE'));
check('no function is open to a player but the doors', island('OPEN') === '0', island('OPEN'));

/* ---- The browser's half ----------------------------------------------------- */

check(`each of the ${CLASS_TIER_AT.length} tiers offers two spells and a passive`,
  TIERS.chirurgeon.length === CLASS_TIER_AT.length && TIERS.chirurgeon.every((row) => row.length === 3
    && row.filter((num) => SPELLS.some((s) => s.num === num)).length === 2), JSON.stringify(TIERS.chirurgeon));
check('every spell that wants something in your hands says so first, in the words its refusal uses',
  SPELLS.every((s) => !s.needs || s.note.startsWith(`${NEEDS_SAID[s.needs].has}: `)));
check('and every spell\'s perk says what it costs before what it does',
  SPELLS.every((s) => PERK_BY_ID.get(s.id)!.note.startsWith('Spell') && PERK_BY_ID.get(s.id)!.note.endsWith(s.note)));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Chirurgeon — ${ok.length} of ${ok.length}`);
