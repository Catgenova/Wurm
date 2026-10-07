/**
 * The Berserker: twelve spells and six passives in six tiers that open on the
 * trade's own level, on the island (`the_berserker.sql`) and in the browser's
 * rulebook (`talents.ts`, `perks.ts`).
 *
 * What this asks:
 *
 *   * both sides hold the same twelve spells, field for field, what each wants
 *     in your hands included, and the same tiers;
 *   * every spell does what its note says, measured: a blow at its share of the
 *     one a swing would land -- the same roll asked twice, of two creatures
 *     alike -- a wound shrugged off, a creature held or bleeding, a body paying
 *     in health, a rage, an adrenaline, a whirlwind and an earthshaker on
 *     everything in reach and nothing past it, and every blow critical in a
 *     Last Rage;
 *   * a spell that wants an axe, a maul or your health is refused without it,
 *     and the door charges its stamina and its rest;
 *   * and every passive moves the number it names at the rule it changes, on
 *     the island, with the browser's fold the island's.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { CLASS_TIER_AT } from '../../src/game/classes';
import { KNIFE_BLEED, KNIFE_BLEED_SECS } from '../../src/game/fight';
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

const SPELLS = classSpellsOf('berserker');
const spell = (slug: string): ClassSpellDef => {
  const s = CLASS_SPELL_BY_ID.get(`berserker_${slug}`);
  if (!s) throw new Error(`no berserker_${slug}`);
  return s;
};
const fx = (slug: string, k: string): number => spell(slug).fx[k];
const PASSIVES = perksOf('berserker').filter((p) => !CLASS_SPELL_BY_ID.has(p.id));
/** What the six passives fold to, which is what the browser reads a Berserker's numbers from. */
const FOLD = foldPerks(PASSIVES.map((p) => p.id));
const FIRST_CLASS_SLOT = SPELL_BAR.indexOf('class');

/** A blow spell and how its reference swing is asked: alike in all but its share. */
interface Blow { slug: string; weapon: string; sure: boolean; kind: string; miss: number; low?: boolean }
const BLOWS: Blow[] = [
  { slug: 'wild_swing', weapon: 'hatchet', sure: false, kind: 'null', miss: fx('wild_swing', 'miss') },
  { slug: 'rending_chop', weapon: 'battle_axe', sure: false, kind: 'null', miss: 1 },
  { slug: 'skull_crack', weapon: 'maul', sure: false, kind: 'null', miss: 1 },
  { slug: 'blood_price', weapon: 'hatchet', sure: false, kind: 'null', miss: 1 },
  { slug: 'execute', weapon: 'hatchet', sure: false, kind: 'null', miss: 1, low: true },
  { slug: 'execute', weapon: 'hatchet', sure: false, kind: 'null', miss: 1, low: false },
  { slug: 'overhead_smash', weapon: 'hatchet', sure: true, kind: `'crush'`, miss: 1 },
];
const blowKey = (b: Blow): string => `BLOW:${b.slug}${b.low === undefined ? '' : b.low ? ':low' : ':whole'}`;
const blowWant = (b: Blow): number =>
  b.slug === 'execute' ? (b.low ? fx('execute', 'more') : fx('execute', 'whole')) : fx(b.slug, 'more');

/** A spell's row as the island prints it and as the browser would: every field, the numbers by name. */
const rowOf = (s: ClassSpellDef): string =>
  [s.id, s.class, s.num, s.name, s.cost, s.rest, s.on.join('+'),
    Object.keys(s.fx).sort().map((k) => `${k}=${s.fx[k]}`).join(';'), s.note, s.needs ?? '-'].join('¦');

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w record; o uuid; v_px double precision; v_py double precision; r jsonb; c creature; sh shield_def;
        a int; b int; t int; k int; n int; v_hatchet bigint; v_axe bigint; v_maul bigint; v_sword bigint;
        h0 double precision; d1 double precision; lv double precision; v_seed double precision;
        m0 double precision; m1 double precision; v_wind0 double precision; v_axe0 double precision; v_maul0 double precision;
        v_sword0 double precision; v_base_axe double precision; v_base_hatchet double precision; v_dealt0 double precision;
        x int; y int; z int; q int;
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
         spell_bar = (select jsonb_agg('null'::jsonb) from spell_slot),
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('health', 1, 'hunger', 1, 'thirst', 1, 'stamina', 1, 'aegis', 0)
   where world_id = w.world_id and uid in (w.uid, o);
  update player set x = v_px - 30 where world_id = w.world_id and uid = o;
  insert into skill (world_id, uid, id, value)
    select w.world_id, w.uid, s, v from
      (values ('axes', 100::double precision), ('mauls', 100), ('swords', 100), ('fighting', 100), ('body_control', 1), ('shields', 1)) sv(s, v)
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
  v_hatchet := give(w.world_id, w.uid, 'hatchet', 1, 40);
  v_axe := give(w.world_id, w.uid, 'battle_axe', 1, 40);
  v_maul := give(w.world_id, w.uid, 'maul', 1, 40);
  v_sword := give(w.world_id, w.uid, 'sword', 1, 40);
  update player set equipped = jsonb_build_object('weapon', v_hatchet) where world_id = w.world_id and uid = w.uid;

  /* ---- The rows ---- */
  insert into said select 'SPELL:' || id, id || '¦' || class || '¦' || num || '¦' || name || '¦' || cost || '¦' || rest || '¦'
      || array_to_string(on_what, '+') || '¦' || coalesce((select string_agg(e.k || '=' || e.v, ';' order by e.k) from jsonb_each_text(fx) e(k, v)), '')
      || '¦' || note || '¦' || coalesce(needs, '-')
    from class_spell where class = 'berserker';

  insert into said values ('TAKE', coalesce(rpc_take_class(w.world_id, 'berserker')->>'why', 'took'));
  -- Every spell known from here, as though a tier had been taken six times over; the passives come later.
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, cs.id from class_spell cs where cs.class = 'berserker'
    on conflict do nothing;

  /* ---- A blow with a spell, at its share of a swing's: the same roll, asked twice ---- */
  ${BLOWS.map((bl) => `
  update player set equipped = jsonb_build_object('weapon', ${bl.weapon === 'maul' ? 'v_maul' : bl.weapon === 'battle_axe' ? 'v_axe' : 'v_hatchet'}),
         stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = w.uid;
  a := creature_spawn(w.world_id, 'rowl', v_px + 1.5, v_py + 1, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'rowl', v_px + 1.5, v_py - 1, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, enemy = null, hunt_again = null, settled_at = now(),
         until = now() + interval '1 hour', windup_at = null where world_id = w.world_id and id in (a, b);
  update creature set health = max_health(creature) * ${bl.low ? 0.2 : bl.low === false ? 0.5 : 1}, until = now() + interval '1 second'
    where world_id = w.world_id and id in (a, b);
  for k in 1..12 loop
    v_seed := k / 100.0;
    update item set dmg = 0 where id in (v_hatchet, v_axe, v_maul);
    perform setseed(v_seed);
    perform creature_settle(w.world_id, a);
    r := class_blow(w.world_id, w.uid, a, 1, ${bl.sure}, ${bl.kind}, ${bl.miss});
    exit when (r->>'landed')::boolean;
    update creature set health = max_health(creature) * ${bl.low ? 0.2 : bl.low === false ? 0.5 : 1}, hunting = w.uid, enemy = null,
           settled_at = now(), until = now() + interval '1 second', windup_at = null where world_id = w.world_id and id = a;
  end loop;
  d1 := (r->>'dmg')::double precision;
  update item set dmg = 0 where id in (v_hatchet, v_axe, v_maul);
  perform setseed(v_seed);
  r := class_spell_cast(w.world_id, w.uid, 'berserker_${bl.slug}', jsonb_build_object('kind', 'enemy', 'id', b));
  insert into said values ('${blowKey(bl)}', ((r->'blow'->>'dmg')::double precision / d1) || '|' || coalesce(r->'blow'->>'landed', r->>'why'));
  ${bl.slug === 'rending_chop' ? `
  insert into said select 'RENDING', (bleed_rate / (r->'blow'->>'dmg')::double precision) || '|' || extract(epoch from bleed_until - now())
    from creature where world_id = w.world_id and id = b;` : ''}
  ${bl.slug === 'blood_price' ? `
  insert into said select 'PRICE', (stats->>'health') || '|' || (r->>'said') from player where world_id = w.world_id and uid = w.uid;` : ''}
  delete from creature where world_id = w.world_id and id in (a, b);`).join('')}

  /* ---- Overhead Smash cannot miss, and pays its wind-up out of your next swing ---- */
  update skill set value = 0 where world_id = w.world_id and uid = w.uid and id in ('axes', 'fighting');
  update player set equipped = jsonb_build_object('weapon', v_hatchet) where world_id = w.world_id and uid = w.uid;
  a := creature_spawn(w.world_id, 'ogre', v_px + 1.5, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, settled_at = now(), until = now() + interval '1 hour' where world_id = w.world_id and id = a;
  t := 0; k := 0;
  for n in 1..30 loop
    update creature set health = max_health(creature), hunting = null where world_id = w.world_id and id = a;
    if (class_spell_cast(w.world_id, w.uid, 'berserker_overhead_smash', jsonb_build_object('kind', 'enemy', 'id', a))->'blow'->>'landed')::boolean then t := t + 1; end if;
    update creature set health = max_health(creature), hunting = null where world_id = w.world_id and id = a;
    if (class_blow(w.world_id, w.uid, a, 1)->>'landed')::boolean then k := k + 1; end if;
  end loop;
  -- And a Wild Swing misses twice as often as a swing, the same rolls asked of both.
  perform setseed(0.4);
  x := 0;
  for n in 1..300 loop
    update creature set health = max_health(creature), hunting = null where world_id = w.world_id and id = a;
    if not (class_blow(w.world_id, w.uid, a, 1)->>'landed')::boolean then x := x + 1; end if;
  end loop;
  perform setseed(0.4);
  y := 0;
  for n in 1..300 loop
    update creature set health = max_health(creature), hunting = null where world_id = w.world_id and id = a;
    if not (class_blow(w.world_id, w.uid, a, 1, false, null, ${fx('wild_swing', 'miss')})->>'landed')::boolean then y := y + 1; end if;
  end loop;
  insert into said values ('SURE', t || '|' || k || '|' || x || '|' || y);
  update skill set value = 100 where world_id = w.world_id and uid = w.uid and id in ('axes', 'fighting');
  update player set act = 'attack_creature', act_target = jsonb_build_object('kind', 'creature', 'id', a),
         act_ends = now() + interval '1 second' where world_id = w.world_id and uid = w.uid;
  r := class_spell_cast(w.world_id, w.uid, 'berserker_overhead_smash', jsonb_build_object('kind', 'enemy', 'id', a));
  insert into said select 'WINDUP', extract(epoch from act_ends - now()) || '|' || (r->>'said') from player where world_id = w.world_id and uid = w.uid;
  update player set act = null, act_target = null, act_ends = null where world_id = w.world_id and uid = w.uid;

  /* ---- Skull Crack and Earthshaker hold it where it stands ---- */
  update player set equipped = jsonb_build_object('weapon', v_maul) where world_id = w.world_id and uid = w.uid;
  delete from creature where world_id = w.world_id and id = a;
  a := creature_spawn(w.world_id, 'rowl', v_px + 1.5, v_py, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'goblin', v_px - 1.5, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, settled_at = now(), hunting = null, until = now() - interval '1 second', windup_at = null
    where world_id = w.world_id and id in (a, b);
  update creature set health = max_health(creature) where world_id = w.world_id and id in (a, b);
  perform setseed(0.02);
  r := class_spell_cast(w.world_id, w.uid, 'berserker_skull_crack', jsonb_build_object('kind', 'enemy', 'id', a));
  insert into said select 'CRACK', coalesce(r->'blow'->>'landed', r->>'why') || '|' || extract(epoch from until - now()) || '|'
      || (from_x = to_x and from_y = to_y) from creature where world_id = w.world_id and id = a;
  perform setseed(0.02);
  r := class_spell_cast(w.world_id, w.uid, 'berserker_skull_crack', jsonb_build_object('kind', 'enemy', 'id', b));
  insert into said select 'CRACK:MONSTER', coalesce(r->'blow'->>'landed', r->>'why') || '|' || extract(epoch from until - now())
    from creature where world_id = w.world_id and id = b;
  delete from creature where world_id = w.world_id and id in (a, b);

  insert into said values ('SHAKE:NONE', class_spell_cast(w.world_id, w.uid, 'berserker_earthshaker', jsonb_build_object('kind', 'self'))->>'why');
  a := creature_spawn(w.world_id, 'rowl', v_px + 2, v_py, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'rowl', v_px, v_py + 2.5, 'wild', now() - interval '2 hours', null);
  t := creature_spawn(w.world_id, 'rowl', v_px - ${fx('earthshaker', 'reach')} - 1, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, settled_at = now(), hunting = null, until = now() - interval '1 second', windup_at = null
    where world_id = w.world_id and id in (a, b, t);
  update creature set health = max_health(creature) where world_id = w.world_id and id in (a, b, t);
  perform setseed(0.03);
  r := class_spell_cast(w.world_id, w.uid, 'berserker_earthshaker', jsonb_build_object('kind', 'self'));
  insert into said select 'SHAKE', string_agg((health < max_health(cr))::text || ':' || (until > now())::text, ',' order by case id when a then 1 when b then 2 else 3 end)
      || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where world_id = w.world_id and id in (a, b, t);
  delete from creature where world_id = w.world_id and id in (a, b, t);

  /* ---- Whirlwind: every enemy in reach, twice, and nothing past it ---- */
  update player set equipped = jsonb_build_object('weapon', v_hatchet) where world_id = w.world_id and uid = w.uid;
  insert into said values ('WHIRL:NONE', class_spell_cast(w.world_id, w.uid, 'berserker_whirlwind', jsonb_build_object('kind', 'self'))->>'why');
  a := creature_spawn(w.world_id, 'ogre', v_px + 1.5, v_py, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'ogre', v_px - 1, v_py + 1, 'wild', now() - interval '2 hours', null);
  t := creature_spawn(w.world_id, 'ogre', v_px + ${fx('whirlwind', 'reach')} + 1, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, settled_at = now(), hunting = null, until = now() + interval '1 hour', windup_at = null
    where world_id = w.world_id and id in (a, b, t);
  update creature set health = max_health(creature) where world_id = w.world_id and id in (a, b, t);
  perform setseed(0.05);
  r := class_spell_cast(w.world_id, w.uid, 'berserker_whirlwind', jsonb_build_object('kind', 'self'));
  insert into said select 'WHIRL', string_agg((health < max_health(cr))::text, ',' order by case id when a then 1 when b then 2 else 3 end)
      || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where world_id = w.world_id and id in (a, b, t);
  -- Its two blows: the very rolls of two swings, and the creature down by both.
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  delete from creature where world_id = w.world_id and id in (b, t);
  update item set dmg = 0 where id = v_hatchet;
  perform setseed(0.06);
  select health into h0 from creature where world_id = w.world_id and id = a;
  d1 := 0;
  for n in 1..${fx('whirlwind', 'blows')} loop
    perform creature_settle(w.world_id, a);
    d1 := d1 + (class_blow(w.world_id, w.uid, a, ${fx('whirlwind', 'more')})->>'dmg')::double precision;
  end loop;
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  update item set dmg = 0 where id = v_hatchet;
  perform setseed(0.06);
  perform class_spell_cast(w.world_id, w.uid, 'berserker_whirlwind', jsonb_build_object('kind', 'self'));
  insert into said select 'WHIRL:TWICE', round(((h0 - health) / greatest(d1, 1e-9))::numeric, 6)::text from creature where world_id = w.world_id and id = a;
  delete from creature where world_id = w.world_id and id = a;

  /* ---- Shrug It Off ---- */
  insert into said values ('SHRUG:NONE', class_spell_cast(w.world_id, w.uid, 'berserker_shrug_it_off', jsonb_build_object('kind', 'self'))->>'why');
  update player set wounds = jsonb_build_array(
      jsonb_build_object('kind', 'cut', 'part', 'legs', 'severity', 0.1, 'bleeding', true, 'infected', false, 'dressing', null, 'at', now()),
      jsonb_build_object('kind', 'cut', 'part', 'arms', 'severity', 0.3, 'bleeding', true, 'infected', false, 'dressing', null, 'at', now()))
    where world_id = w.world_id and uid = w.uid;
  r := class_spell_cast(w.world_id, w.uid, 'berserker_shrug_it_off', jsonb_build_object('kind', 'self'));
  insert into said select 'SHRUG', string_agg((x2->>'part') || ':' || (x2->>'severity') || ':' || (x2->>'bleeding'), ',' order by x2->>'part')
      || '|' || coalesce(r->>'said', r->>'why')
    from player, jsonb_array_elements(wounds) x2 where world_id = w.world_id and uid = w.uid;
  update player set wounds = '[]'::jsonb where world_id = w.world_id and uid = w.uid;

  /* ---- Battle Rage, Adrenaline and Last Rage ---- */
  a := creature_spawn(w.world_id, 'rowl', v_px + 1.5, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, settled_at = now(), hunting = w.uid, until = now() + interval '1 hour' where world_id = w.world_id and id = a;
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  select * into c from creature where world_id = w.world_id and id = a;
  v_dealt0 := class_dealt(w.world_id, w.uid, c);
  perform class_spell_cast(w.world_id, w.uid, 'berserker_battle_rage', jsonb_build_object('kind', 'self'));
  update player set stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{hurtBy}', to_jsonb(a)), wounds = '[]'::jsonb, act = null, act_target = null
    where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.1, 'A test blow', 'cut');
  insert into said select 'RAGE', v_dealt0 || '|' || class_dealt(w.world_id, w.uid, c) || '|' || (1 - (stats->>'health')::double precision)
      || '|' || extract(epoch from (blessings->'battle_rage'->>'until')::timestamptz - now())
    from player where world_id = w.world_id and uid = w.uid;
  update player set blessings = '{}'::jsonb, wounds = '[]'::jsonb, stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = w.uid;

  m0 := act_base(w.world_id, w.uid, 'attack_creature', 1);
  r := class_spell_cast(w.world_id, w.uid, 'berserker_adrenaline', jsonb_build_object('kind', 'self'));
  insert into said values ('ADRENALINE', (act_base(w.world_id, w.uid, 'attack_creature', 1) / m0) || '|' || act_wind(w.world_id, w.uid, 'attack_creature', 0)
    || '|' || act_wind(w.world_id, w.uid, 'mine', 0.25));
  update player set blessings = jsonb_set(blessings, '{adrenaline,until}', to_jsonb(now() - interval '1 second')) where world_id = w.world_id and uid = w.uid;
  insert into said values ('ADRENALINE:OVER', (act_base(w.world_id, w.uid, 'attack_creature', 1) / m0) || '|' || (act_wind(w.world_id, w.uid, 'attack_creature', 0) > 0));
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;

  update player set stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid = w.uid;
  insert into said values ('LAST:HIGH', spell_cast_refusal(w.world_id, w.uid, 'berserker_last_rage'));
  update player set stats = jsonb_set(stats, '{health}', '0.2') where world_id = w.world_id and uid = w.uid;
  r := class_spell_cast(w.world_id, w.uid, 'berserker_last_rage', jsonb_build_object('kind', 'self'));
  t := 0; k := 0;
  for n in 1..20 loop
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    r := class_blow(w.world_id, w.uid, a, 1, true);
    if (r->>'crit')::boolean then t := t + 1; end if;
  end loop;
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  for n in 1..20 loop
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    r := class_blow(w.world_id, w.uid, a, 1, true);
    if (r->>'crit')::boolean then k := k + 1; end if;
  end loop;
  insert into said values ('LAST', t || '|' || k);
  update player set stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = w.uid;

  /* ---- The door: what a spell wants in your hands, your health, stamina and rest ---- */
  delete from caller where uid = w.uid;
  update player set equipped = jsonb_build_object('weapon', v_maul) where world_id = w.world_id and uid = w.uid;
  insert into said values ('NEEDS:AXE', spell_cast_refusal(w.world_id, w.uid, 'berserker_rending_chop'));
  update player set equipped = jsonb_build_object('weapon', v_hatchet) where world_id = w.world_id and uid = w.uid;
  insert into said values ('NEEDS:MAUL', spell_cast_refusal(w.world_id, w.uid, 'berserker_skull_crack') || '|' || spell_cast_refusal(w.world_id, w.uid, 'berserker_earthshaker'));
  insert into said values ('NEEDS:HAS', coalesce(spell_cast_refusal(w.world_id, w.uid, 'berserker_rending_chop'), 'ready'));
  update player set stats = jsonb_set(stats, '{health}', to_jsonb(${fx('blood_price', 'health')})) where world_id = w.world_id and uid = w.uid;
  insert into said values ('PRICE:LOW', spell_cast_refusal(w.world_id, w.uid, 'berserker_blood_price'));
  update player set stats = jsonb_set(stats, '{health}', '1'), used_at = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  perform spell_bar_put(w.world_id, w.uid, ${FIRST_CLASS_SLOT}, 'berserker_wild_swing');
  r := rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'creature', 'id', a));
  insert into said select 'PAID', coalesce(r->>'cast', r->>'why') || '|' || (stats->>'stamina') || '|' || (r->'rest'->>'berserker_wild_swing')
    from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('RESTING', rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'creature', 'id', a))->>'why');

  /* ---- The passives: each number, before and after ---- */
  update player set used_at = '{}'::jsonb, blessings = '{}'::jsonb, stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = w.uid;
  v_axe0 := weapon_damage(w.world_id, w.uid, (select x3 from weapon_def x3 where id = 'battle_axe'), null::item);
  v_maul0 := weapon_damage(w.world_id, w.uid, (select x3 from weapon_def x3 where id = 'maul'), null::item);
  v_sword0 := weapon_damage(w.world_id, w.uid, (select x3 from weapon_def x3 where id = 'sword'), null::item);
  update player set equipped = jsonb_build_object('weapon', v_axe) where world_id = w.world_id and uid = w.uid;
  v_base_axe := act_base(w.world_id, w.uid, 'attack_creature', 1);
  update player set equipped = jsonb_build_object('weapon', v_hatchet) where world_id = w.world_id and uid = w.uid;
  v_base_hatchet := act_base(w.world_id, w.uid, 'attack_creature', 1);
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, k2.id from class_perk k2
    where k2.class = 'berserker' and not exists (select 1 from class_spell cs where cs.id = k2.id)
    on conflict do nothing;
  perform class_fold(w.world_id, w.uid);
  insert into said select 'FOLDED', coalesce((select string_agg(e.k || '=' || e.v, ';' order by e.k collate "C")
      from jsonb_each_text(class_mul->'fx') e(k, v) where e.k ~ '^(dmg|swing|finish|pain|leech):'), 'none')
    from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('MASTERY', (weapon_damage(w.world_id, w.uid, (select x3 from weapon_def x3 where id = 'battle_axe'), null::item) / v_axe0)
    || '|' || (weapon_damage(w.world_id, w.uid, (select x3 from weapon_def x3 where id = 'maul'), null::item) / v_maul0)
    || '|' || (weapon_damage(w.world_id, w.uid, (select x3 from weapon_def x3 where id = 'sword'), null::item) / v_sword0));
  update player set equipped = jsonb_build_object('weapon', v_axe) where world_id = w.world_id and uid = w.uid;
  m0 := act_base(w.world_id, w.uid, 'attack_creature', 1) / v_base_axe;
  update player set equipped = jsonb_build_object('weapon', v_hatchet) where world_id = w.world_id and uid = w.uid;
  insert into said values ('WILD', m0 || '|' || (act_base(w.world_id, w.uid, 'attack_creature', 1) / v_base_hatchet));
  -- Executioner on a creature far gone, Pain Fuels on a body far gone.
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  select * into c from creature where world_id = w.world_id and id = a;
  m0 := class_dealt(w.world_id, w.uid, c);
  update creature set health = max_health(creature) * 0.2 where world_id = w.world_id and id = a;
  select * into c from creature where world_id = w.world_id and id = a;
  m1 := class_dealt(w.world_id, w.uid, c);
  insert into said values ('FINISH', m0 || '|' || m1);
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  select * into c from creature where world_id = w.world_id and id = a;
  update player set stats = jsonb_set(stats, '{health}', '0.8') where world_id = w.world_id and uid = w.uid;
  m0 := class_dealt(w.world_id, w.uid, c);
  update player set stats = jsonb_set(stats, '{health}', '0.4') where world_id = w.world_id and uid = w.uid;
  m1 := class_dealt(w.world_id, w.uid, c);
  update player set stats = jsonb_set(stats, '{health}', '0.2') where world_id = w.world_id and uid = w.uid;
  insert into said values ('PAIN', m0 || '|' || m1 || '|' || class_dealt(w.world_id, w.uid, c));
  -- Thirst for Blood: a spell's blow and a swing's alike.
  update player set stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid = w.uid;
  r := class_blow(w.world_id, w.uid, a, 1, true);
  insert into said select 'THIRST', (stats->>'health') from player where world_id = w.world_id and uid = w.uid;
  update player set stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid = w.uid;
  for k in 1..12 loop
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    select health into h0 from creature where world_id = w.world_id and id = a;
    perform perform_fight(w.world_id, w.uid, 'attack_creature', jsonb_build_object('kind', 'creature', 'id', a));
    exit when (select health from creature where world_id = w.world_id and id = a) < h0;
  end loop;
  insert into said select 'THIRST:SWING', (stats->>'health') from player where world_id = w.world_id and uid = w.uid;
  -- And every swing and shot goes through the same three, in the rule that strikes them.
  insert into said select 'SWUNG', (length(pg_get_functiondef(p.oid)) - length(replace(pg_get_functiondef(p.oid), 'class_dealt(p_world, p_uid, c)', ''))) / length('class_dealt(p_world, p_uid, c)')
      || '|' || (length(pg_get_functiondef(p.oid)) - length(replace(pg_get_functiondef(p.oid), 'class_crit(p_world, p_uid)', ''))) / length('class_crit(p_world, p_uid)')
      || '|' || (length(pg_get_functiondef(p.oid)) - length(replace(pg_get_functiondef(p.oid), 'class_leech(p_world, p_uid)', ''))) / length('class_leech(p_world, p_uid)')
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = 'perform_fight';
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
  check(`both sides hold the Berserker's ${SPELLS.length} spells, field for field, what each wants in your hands included`,
    SPELLS.length === 12 && wrong.length === 0 && [...said.keys()].filter((k) => k.startsWith('SPELL:')).length === SPELLS.length,
    wrong.length ? `island ${island(`SPELL:${wrong[0].id}`)}, browser ${rowOf(wrong[0])}` : `${SPELLS.length} of them`);
}
check('the trade is taken up', island('TAKE') === 'took', island('TAKE'));

for (const bl of BLOWS) {
  const [ratio, landed] = parts(blowKey(bl));
  const s = spell(bl.slug);
  const what = bl.slug === 'execute'
    ? `${s.name}: a blow at ${pct(blowWant(bl))} on a creature ${bl.low ? `below ${pct(fx('execute', 'low'))} of its health` : 'above that'}`
    : `${s.name}: a blow at ${pct(blowWant(bl))} of a swing's`;
  check(what, landed === 'true' && near(Number(ratio), blowWant(bl), 1e-9), island(blowKey(bl)));
}
{
  const [share, secs] = parts('RENDING').map(Number);
  check(`Rending Chop bleeds it as a knife does: ${pct(KNIFE_BLEED)} of the blow a second for ${KNIFE_BLEED_SECS} s`,
    // To within what a bleed rate holds as a real.
    near(share, KNIFE_BLEED, 1e-6) && near(secs, KNIFE_BLEED_SECS, 1e-6), island('RENDING'));
}
{
  const [health, line] = parts('PRICE');
  check(`Blood Price takes ${pct(fx('blood_price', 'health'))} of your health, and says so`,
    near(Number(health), 1 - fx('blood_price', 'health')) && line.endsWith(`It costs you ${pct(fx('blood_price', 'health'))} of your health.`), island('PRICE'));
}
{
  const [smash, swing, plain, wild] = parts('SURE').map(Number);
  check('Overhead Smash cannot miss, with a hand that misses a swing often', smash === 30 && swing < 30, `${smash} of 30 smashes, ${swing} of 30 swings`);
  check(`and a Wild Swing misses ${fx('wild_swing', 'miss')} times as often as a swing, the same rolls asked of both`,
    plain > 30 && wild >= plain * fx('wild_swing', 'miss') * 0.85 && wild <= plain * fx('wild_swing', 'miss') * 1.15, `${plain} and ${wild} misses of 300`);
}
{
  const [secs, line] = parts('WINDUP');
  check(`and its wind-up puts your own next swing back ${fx('overhead_smash', 'wind')} s`,
    near(Number(secs), 1 + fx('overhead_smash', 'wind'), 1e-6) && line.endsWith(`Your next swing comes ${fx('overhead_smash', 'wind')} s later.`), island('WINDUP'));
}
{
  const [landed, secs, still] = parts('CRACK');
  check(`Skull Crack holds it where it stands, neither moving nor striking, for ${fx('skull_crack', 'hold')} s`,
    landed === 'true' && near(Number(secs), fx('skull_crack', 'hold'), 1e-6) && still === 'true', island('CRACK'));
  const [mLanded, mSecs] = parts('CRACK:MONSTER');
  check(`and a monster for ${fx('skull_crack', 'hold') * fx('skull_crack', 'monster')} s`,
    mLanded === 'true' && near(Number(mSecs), fx('skull_crack', 'hold') * fx('skull_crack', 'monster'), 1e-6), island('CRACK:MONSTER'));
}
{
  const [who, line] = parts('SHAKE');
  check(`Earthshaker strikes and holds everything within ${fx('earthshaker', 'reach')} tiles, and nothing past them`,
    who === 'true:true,true:true,false:false' && line === `Earthshaker: you strike at 2 creatures; 2 held where they stand for ${fx('earthshaker', 'hold')} s.`,
    island('SHAKE'));
  check('and with nothing in reach it is refused', island('SHAKE:NONE') === `Nothing is within ${fx('earthshaker', 'reach')} tiles of you to strike.`, island('SHAKE:NONE'));
}
{
  const [who, line] = parts('WHIRL');
  check(`Whirlwind strikes everything within ${fx('whirlwind', 'reach')} tiles, and nothing past them`,
    who === 'true,true,false' && line === 'Whirlwind: you strike at 2 creatures.', island('WHIRL'));
  check(`with ${fx('whirlwind', 'blows')} blows at ${pct(fx('whirlwind', 'more'))} each`, near(Number(island('WHIRL:TWICE')), 1, 1e-6), island('WHIRL:TWICE'));
  check('and with nothing in reach it is refused', island('WHIRL:NONE') === `Nothing is within ${fx('whirlwind', 'reach')} tiles of you to strike.`, island('WHIRL:NONE'));
}
{
  const [wounds, line] = parts('SHRUG');
  check(`Shrug It Off: the worst wound ${pct(1 - fx('shrug_it_off', 'severity'))} less severe and bleeding no more, and the others as they were`,
    wounds === `arms:${0.3 * fx('shrug_it_off', 'severity')}:false,legs:0.1:true` && /on your arm, is 50% less severe/.test(line), island('SHRUG'));
  check('and with no wound it is refused', island('SHRUG:NONE') === 'You have no wound to shrug off.', island('SHRUG:NONE'));
}
{
  const [before, during, lost, secs] = parts('RAGE').map(Number);
  check(`Battle Rage: for ${fx('battle_rage', 'secs')} s you deal ${pct(fx('battle_rage', 'dealt') - 1)} more and take ${pct(fx('battle_rage', 'taken') - 1)} more`,
    near(before, 1) && near(during, fx('battle_rage', 'dealt')) && near(lost, 0.1 * fx('battle_rage', 'taken'), 1e-9)
      && near(secs, fx('battle_rage', 'secs'), 1e-6), island('RAGE'));
}
{
  const [time, swing, dig] = parts('ADRENALINE').map(Number);
  check(`Adrenaline: a swing ${pct(1 - fx('adrenaline', 'time'))} quicker and costing no stamina, and nothing else free`,
    near(time, fx('adrenaline', 'time')) && swing === 0 && dig === 0.25, island('ADRENALINE'));
  const [after, costs] = parts('ADRENALINE:OVER');
  check('and after it, a swing as it was', near(Number(after), 1) && costs === 'true', island('ADRENALINE:OVER'));
}
{
  const [crits, plain] = parts('LAST').map(Number);
  check(`Last Rage: only below ${pct(fx('last_rage', 'below'))} of your health`,
    island('LAST:HIGH') === `Last Rage is only for below ${pct(fx('last_rage', 'below'))} of your health.`, island('LAST:HIGH'));
  check('and then every blow you land is critical', crits === 20 && plain < 20, island('LAST'));
}
check('a spell that wants an axe is refused with a maul in your hand',
  island('NEEDS:AXE') === `Rending Chop wants ${NEEDS_SAID.axes.wants}.`, island('NEEDS:AXE'));
check('and one that wants a maul with an axe',
  island('NEEDS:MAUL') === `Skull Crack wants ${NEEDS_SAID.mauls.wants}.|Earthshaker wants ${NEEDS_SAID.mauls.wants}.`, island('NEEDS:MAUL'));
check('and is called with it', island('NEEDS:HAS') === 'ready', island('NEEDS:HAS'));
check(`Blood Price is refused when it would take the last of your health`,
  island('PRICE:LOW') === `Blood Price costs ${pct(fx('blood_price', 'health'))} of your health; you have ${pct(fx('blood_price', 'health'))}.`, island('PRICE:LOW'));
{
  const [cast, stamina, rest] = parts('PAID');
  const s = spell('wild_swing');
  check(`a spell called through the door costs its ${pct(s.cost)} of a full bar and rests ${s.rest} s`,
    cast === s.id && near(Number(stamina), 1 - s.cost) && near(Number(rest), s.rest, 1e-6), island('PAID'));
  check('and is refused while it rests', island('RESTING') === `${s.name} can be called again in ${s.rest} seconds.`, island('RESTING'));
}

/* ---- The passives ------------------------------------------------------------ */

check('the six passives fold on the island to what they fold to in the browser',
  island('FOLDED') === Object.keys(FOLD).filter((k) => /^(dmg|swing|finish|pain|leech):/.test(k)).sort()
    .map((k) => `${k}=${FOLD[k]}`).join(';'), island('FOLDED'));
{
  const [axe, maul, sword] = parts('MASTERY').map(Number);
  check(`Axe Mastery and Maul Mastery: ${pct(FOLD['dmg:axes'] - 1)} and ${pct(FOLD['dmg:mauls'] - 1)} more from each, and nothing on a sword`,
    near(axe, FOLD['dmg:axes']) && near(maul, FOLD['dmg:mauls']) && near(sword, 1), island('MASTERY'));
}
{
  const [two, one] = parts('WILD').map(Number);
  check(`Wild Strength: a two-handed swing ${pct(1 - FOLD['swing:two_handed'])} quicker, and a one-handed one as it was`,
    near(two, FOLD['swing:two_handed']) && near(one, 1), island('WILD'));
}
{
  const [whole, low] = parts('FINISH').map(Number);
  check(`Executioner: ${pct(FOLD['finish:dmg'] - 1)} more on a creature below ${pct(FOLD['finish:below'])} of its health`,
    near(whole, 1) && near(low, FOLD['finish:dmg']), island('FINISH'));
}
{
  const [fine, half, quarter] = parts('PAIN').map(Number);
  check(`Pain Fuels: ${pct(FOLD['pain:dmg'] - 1)} more below ${pct(FOLD['pain:below'])} of your health, ${pct(FOLD['pain:deeper'] - 1)} below ${pct(FOLD['pain:deep'])}`,
    near(fine, 1) && near(half, FOLD['pain:dmg']) && near(quarter, FOLD['pain:deeper']), island('PAIN'));
}
check(`Thirst for Blood: ${pct(FOLD['leech:blow'])} of your health back for a spell's blow that lands`,
  near(Number(island('THIRST')), 0.5 + FOLD['leech:blow']), island('THIRST'));
check('and for a swing\'s', near(Number(island('THIRST:SWING')), 0.5 + FOLD['leech:blow']), island('THIRST:SWING'));
check('and a swing and a shot each go through what the trade makes of a blow, Last Rage and Thirst for Blood',
  island('SWUNG') === '2|2|2', island('SWUNG'));
check('no function is open to a player but the doors', island('OPEN') === '0', island('OPEN'));

/* ---- The browser's half ----------------------------------------------------- */

check(`each of the ${CLASS_TIER_AT.length} tiers offers two spells and a passive`,
  TIERS.berserker.length === CLASS_TIER_AT.length && TIERS.berserker.every((row) => row.length === 3
    && row.filter((num) => SPELLS.some((s) => s.num === num)).length === 2), JSON.stringify(TIERS.berserker));
check('every spell that wants a weapon says so first, in the words its refusal uses',
  SPELLS.every((s) => !s.needs || s.note.startsWith(`${NEEDS_SAID[s.needs].has}: `)));
check('and every spell\'s perk says what it costs before what it does',
  SPELLS.every((s) => PERK_BY_ID.get(s.id)!.note.startsWith('Spell') && PERK_BY_ID.get(s.id)!.note.endsWith(s.note)));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Berserker — ${ok.length} of ${ok.length}`);
