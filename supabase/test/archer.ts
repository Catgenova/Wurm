/**
 * The Archer: twelve spells and six passives in six tiers that open on the
 * trade's own level, on the island (`the_archer.sql`) and in the browser's
 * rulebook (`talents.ts`, `perks.ts`).
 *
 * What this asks:
 *
 *   * both sides hold the same twelve spells, field for field, what each wants
 *     in your hands included, and the same tiers;
 *   * every shot a spell looses is a draw's at its share -- the same roll asked
 *     twice, of two creatures alike -- as far as it says and no further, an
 *     arrow out of the pack for each; a creature slowed, held, exposed to
 *     everybody's blows; a decoy struck instead of you; a next shot that
 *     cannot miss; draws quicker;
 *   * a shot is refused without a bow, without arrows, too near or too far;
 *   * the door charges its stamina and its rest;
 *   * and every passive moves the number it names at the rule it changes, on
 *     the island, with the browser's fold the island's.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { CLASS_TIER_AT } from '../../src/game/classes';
import { DRAW_CLOSEST, DRAW_WALK } from '../../src/game/fight';
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

const SPELLS = classSpellsOf('archer');
const spell = (slug: string): ClassSpellDef => {
  const s = CLASS_SPELL_BY_ID.get(`archer_${slug}`);
  if (!s) throw new Error(`no archer_${slug}`);
  return s;
};
const fx = (slug: string, k: string): number => spell(slug).fx[k];
const PASSIVES = perksOf('archer').filter((p) => !CLASS_SPELL_BY_ID.has(p.id));
/** What the six passives fold to, which is what the browser reads an Archer's numbers from. */
const FOLD = foldPerks(PASSIVES.map((p) => p.id));
const FIRST_CLASS_SLOT = SPELL_BAR.indexOf('class');
/** The bow the shots are loosed from, and how far it reaches before anybody's perks. */
const BOW = 'long_bow';
const RANGE = WEAPON_BY_ID.get(BOW)!.range!;

/**
 * A shot spell and how its reference shot is asked: alike in all but its
 * share, the two creatures `dist` tiles off on either side of you; `sure` and
 * `steady` as the spell looses it.
 */
interface Shot { slug: string; dist: number; sure: boolean; steady: boolean; want: number }
const SHOTS: Shot[] = [
  { slug: 'quick_shot', dist: 4, sure: false, steady: false, want: fx('quick_shot', 'more') },
  { slug: 'aimed_shot', dist: 4, sure: true, steady: false, want: fx('aimed_shot', 'more') },
  { slug: 'long_shot', dist: 4, sure: false, steady: true, want: fx('long_shot', 'more') },
  { slug: 'crippling_shot', dist: 4, sure: false, steady: false, want: fx('crippling_shot', 'more') },
  { slug: 'point_blank', dist: 1, sure: false, steady: false, want: fx('point_blank', 'more') },
  { slug: 'pinning_shot', dist: 4, sure: false, steady: false, want: fx('pinning_shot', 'more') },
  { slug: 'snipe', dist: 4, sure: false, steady: false, want: fx('snipe', 'more') },
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
        a int; b int; t int; k int; n int; v_bow bigint; v_sword bigint; v_arrows bigint;
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
      (values ('archery', 100::double precision), ('swords', 100), ('fighting', 100), ('body_control', 1), ('shields', 1)) sv(s, v)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  delete from event where uid in (w.uid, o);
  delete from player_node where world_id = w.world_id and uid in (w.uid, o);
  delete from player_spell where world_id = w.world_id and uid in (w.uid, o);
  delete from creature where world_id = w.world_id and to_x between v_px - 45 and v_px + 45 and to_y between v_py - 45 and v_py + 45;
  delete from class_mark where world_id = w.world_id;
  delete from faith_owed where world_id = w.world_id;
  delete from faith_zone where world_id = w.world_id;
  delete from caller where uid in (w.uid, o);
  delete from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and arrow_head_of(def) is not null;
  perform set_config('request.jwt.claims', json_build_object('sub', w.uid)::text, true);
  v_bow := give(w.world_id, w.uid, '${BOW}', 1, 40);
  v_sword := give(w.world_id, w.uid, 'sword', 1, 40);
  v_arrows := give(w.world_id, w.uid, 'arrow', 500, 40);
  update player set equipped = jsonb_build_object('weapon', v_bow) where world_id = w.world_id and uid = w.uid;

  /* ---- The rows ---- */
  insert into said select 'SPELL:' || id, id || '¦' || class || '¦' || num || '¦' || name || '¦' || cost || '¦' || rest || '¦'
      || array_to_string(on_what, '+') || '¦' || coalesce((select string_agg(e.k || '=' || e.v, ';' order by e.k) from jsonb_each_text(fx) e(k, v)), '')
      || '¦' || note || '¦' || coalesce(needs, '-')
    from class_spell where class = 'archer';

  insert into said values ('TAKE', coalesce(rpc_take_class(w.world_id, 'archer')->>'why', 'took'));
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, cs.id from class_spell cs where cs.class = 'archer'
    on conflict do nothing;

  /* ---- A shot with a spell, at its share of a draw's: the same roll, asked twice ---- */
  ${SHOTS.map((sh) => `
  a := creature_spawn(w.world_id, 'ogre', v_px - ${sh.dist}, v_py, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'ogre', v_px + ${sh.dist}, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = ${sh.slug === 'snipe' ? 'null' : 'w.uid'}, enemy = null, hunt_again = null,
         settled_at = now(), until = now() + interval '1 hour', windup_at = null where world_id = w.world_id and id in (a, b);
  update creature set health = max_health(creature) where world_id = w.world_id and id in (a, b);
  for k in 1..12 loop
    v_seed := k / 100.0;
    update item set dmg = 0 where id = v_bow;
    perform setseed(v_seed);
    perform creature_settle(w.world_id, a);
    r := class_shot(w.world_id, w.uid, a, 1, ${sh.sure}, 1, ${sh.steady});
    exit when (r->>'landed')::boolean;
    update creature set health = max_health(creature), hunting = ${sh.slug === 'snipe' ? 'null' : 'w.uid'}, enemy = null,
           settled_at = now(), until = now() + interval '1 hour', windup_at = null where world_id = w.world_id and id = a;
  end loop;
  d1 := (r->>'dmg')::double precision;
  update item set dmg = 0 where id = v_bow;
  select sum(count) into m0 from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def = 'arrow';
  perform setseed(v_seed);
  r := class_spell_cast(w.world_id, w.uid, 'archer_${sh.slug}', jsonb_build_object('kind', 'enemy', 'id', b));
  insert into said select 'SHOT:${sh.slug}', ((r->'blow'->>'dmg')::double precision / d1) || '|' || coalesce(r->'blow'->>'landed', r->>'why')
      || '|' || (m0 - sum(count))
    from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def = 'arrow';
  ${sh.slug === 'crippling_shot' ? `
  insert into said select 'CRIPPLE', slow || '|' || extract(epoch from slow_until - now()) || '|' || (r->>'said')
    from creature where world_id = w.world_id and id = b;` : ''}
  delete from creature where world_id = w.world_id and id in (a, b);`).join('')}

  /* ---- Pinning Shot holds one where it stands: on one idling, which a hold keeps from setting off ---- */
  a := creature_spawn(w.world_id, 'ogre', v_px + 4, v_py, 'wild', now() - interval '2 hours', null);
  for k in 1..12 loop
    update creature set traits = '{}', rare = null, settled_at = now(), hunting = null, enemy = null, until = now() - interval '1 second',
           windup_at = null, health = max_health(creature) where world_id = w.world_id and id = a;
    perform setseed(k / 100.0);
    r := class_spell_cast(w.world_id, w.uid, 'archer_pinning_shot', jsonb_build_object('kind', 'enemy', 'id', a));
    exit when (r->'blow'->>'landed')::boolean;
  end loop;
  insert into said select 'PIN', extract(epoch from until - now()) || '|' || (from_x = to_x and from_y = to_y) || '|' || (r->>'said')
    from creature where world_id = w.world_id and id = a;
  delete from creature where world_id = w.world_id and id = a;

  /* ---- How far a shot goes, and how near ---- */
  a := creature_spawn(w.world_id, 'ogre', v_px + ${RANGE} * ${fx('long_shot', 'range')} - 0.5, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, until = now() + interval '1 hour' where world_id = w.world_id and id = a;
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  insert into said values ('RANGE:LONG', coalesce(class_spell_cast(w.world_id, w.uid, 'archer_long_shot', jsonb_build_object('kind', 'enemy', 'id', a))->>'why', 'loosed')
    || '|' || coalesce(class_spell_cast(w.world_id, w.uid, 'archer_aimed_shot', jsonb_build_object('kind', 'enemy', 'id', a))->>'why', 'loosed'));
  update creature set to_x = v_px + ${RANGE} * ${fx('long_shot', 'range')} + 0.5, from_x = v_px + ${RANGE} * ${fx('long_shot', 'range')} + 0.5
    where world_id = w.world_id and id = a;
  insert into said values ('RANGE:BEYOND', coalesce(class_spell_cast(w.world_id, w.uid, 'archer_long_shot', jsonb_build_object('kind', 'enemy', 'id', a))->>'why', 'loosed'));
  update creature set to_x = v_px + 1, from_x = v_px + 1, health = max_health(creature) where world_id = w.world_id and id = a;
  insert into said values ('RANGE:NEAR', coalesce(class_spell_cast(w.world_id, w.uid, 'archer_point_blank', jsonb_build_object('kind', 'enemy', 'id', a))->>'why', 'loosed')
    || '|' || coalesce(class_spell_cast(w.world_id, w.uid, 'archer_aimed_shot', jsonb_build_object('kind', 'enemy', 'id', a))->>'why', 'loosed'));
  update creature set to_x = v_px + ${fx('point_blank', 'reach')} + 0.5, from_x = v_px + ${fx('point_blank', 'reach')} + 0.5 where world_id = w.world_id and id = a;
  insert into said values ('RANGE:BLANK', coalesce(class_spell_cast(w.world_id, w.uid, 'archer_point_blank', jsonb_build_object('kind', 'enemy', 'id', a))->>'why', 'loosed'));
  delete from creature where world_id = w.world_id and id = a;

  /* ---- A Long Shot lands as often at the far end as at the near: the same rolls asked of both ---- */
  update skill set value = 30 where world_id = w.world_id and uid = w.uid and id = 'archery';
  a := creature_spawn(w.world_id, 'ogre', v_px + ${RANGE} - 0.5, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, until = now() + interval '1 hour' where world_id = w.world_id and id = a;
  x := 0; y := 0; z := 0;
  for n in 1..300 loop
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    update item set dmg = 0 where id = v_bow;
    update item set count = 500 where id = v_arrows;
    perform setseed(n / 400.0);
    r := class_shot(w.world_id, w.uid, a, 1);
    if (r->>'landed')::boolean then x := x + 1; end if;
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    perform setseed(n / 400.0);
    if (class_shot(w.world_id, w.uid, a, 1, false, 1, true)->>'landed')::boolean then y := y + 1;
    elsif (r->>'landed')::boolean then z := z + 1; end if;
  end loop;
  insert into said values ('STEADY', x || '|' || y || '|' || z);
  update skill set value = 100 where world_id = w.world_id and uid = w.uid and id = 'archery';
  delete from creature where world_id = w.world_id and id = a;

  /* ---- Twin Arrows: two arrows, the very rolls of two draws, and the creature down by both ---- */
  a := creature_spawn(w.world_id, 'ogre', v_px + 4, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, enemy = null, until = now() + interval '1 hour' where world_id = w.world_id and id = a;
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  update item set dmg = 0 where id = v_bow;
  update item set count = 500 where id = v_arrows;
  perform setseed(0.06);
  select health into h0 from creature where world_id = w.world_id and id = a;
  perform creature_settle(w.world_id, a);
  d1 := 0;
  for n in 1..${fx('twin_arrows', 'arrows')} loop
    d1 := d1 + (class_shot(w.world_id, w.uid, a, ${fx('twin_arrows', 'more')})->>'dmg')::double precision;
  end loop;
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  update item set dmg = 0 where id = v_bow;
  select sum(count) into m0 from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def = 'arrow';
  perform setseed(0.06);
  r := class_spell_cast(w.world_id, w.uid, 'archer_twin_arrows', jsonb_build_object('kind', 'enemy', 'id', a));
  insert into said select 'TWIN', round(((h0 - health) / greatest(d1, 1e-9))::numeric, 6)::text || '|' || (r->>'said')
      || '|' || (m0 - (select sum(count) from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def = 'arrow'))
    from creature where world_id = w.world_id and id = a;
  delete from creature where world_id = w.world_id and id = a;

  /* ---- Quick Shot puts your own draw forward ---- */
  a := creature_spawn(w.world_id, 'ogre', v_px + 4, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, until = now() + interval '1 hour' where world_id = w.world_id and id = a;
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  update player set act = 'shoot_creature', act_target = jsonb_build_object('kind', 'creature', 'id', a),
         act_ends = now() + interval '2 seconds' where world_id = w.world_id and uid = w.uid;
  r := class_spell_cast(w.world_id, w.uid, 'archer_quick_shot', jsonb_build_object('kind', 'enemy', 'id', a));
  insert into said select 'SOONER', extract(epoch from act_ends - now()) || '|' || (r->>'said') from player where world_id = w.world_id and uid = w.uid;
  update player set act = null, act_target = null, act_ends = null where world_id = w.world_id and uid = w.uid;

  /* ---- Read the Wind: the next shot sure and critical twice as often, a spell's or a draw's, and spent on it ---- */
  x := 0; y := 0; z := 0;
  for n in 1..2500 loop
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    update item set dmg = 0 where id = v_bow;
    update item set count = 500 where id = v_arrows;
    perform setseed(n / 2600.0);
    r := class_shot(w.world_id, w.uid, a, 1, true);
    if (r->>'crit')::boolean then x := x + 1; end if;
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    update item set dmg = 0 where id = v_bow;
    perform blessing_put(w.world_id, w.uid, 'read_wind', jsonb_build_object('until', now() + interval '30 seconds', 'crit', ${fx('read_the_wind', 'crit')}));
    perform setseed(n / 2600.0);
    if (class_shot(w.world_id, w.uid, a, 1)->>'crit')::boolean then y := y + 1;
    elsif (r->>'crit')::boolean then z := z + 1; end if;
  end loop;
  insert into said values ('WIND:CRIT', x || '|' || y || '|' || z);
  update skill set value = 0 where world_id = w.world_id and uid = w.uid and id in ('archery', 'fighting');
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  r := class_spell_cast(w.world_id, w.uid, 'archer_read_the_wind', jsonb_build_object('kind', 'self'));
  insert into said values ('WIND:SAID', r->>'said');
  x := 0;
  for n in 1..20 loop
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    update item set count = 500 where id = v_arrows;
    perform blessing_put(w.world_id, w.uid, 'read_wind', jsonb_build_object('until', now() + interval '30 seconds', 'crit', ${fx('read_the_wind', 'crit')}));
    if (class_shot(w.world_id, w.uid, a, 1)->>'landed')::boolean then x := x + 1; end if;
  end loop;
  insert into said values ('WIND:SURE', x || '|' || (select (pl.blessings ? 'read_wind')::text from player pl where pl.world_id = w.world_id and pl.uid = w.uid));
  -- And a draw that spends it lands too, with a hand that misses most draws.
  y := 0; z := 0;
  for n in 1..20 loop
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    update item set count = 500 where id = v_arrows;
    perform blessing_put(w.world_id, w.uid, 'read_wind', jsonb_build_object('until', now() + interval '30 seconds', 'crit', ${fx('read_the_wind', 'crit')}));
    perform perform_fight(w.world_id, w.uid, 'shoot_creature', jsonb_build_object('kind', 'creature', 'id', a));
    if (select health < max_health(cr) from creature cr where cr.world_id = w.world_id and cr.id = a) then y := y + 1; end if;
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
    perform perform_fight(w.world_id, w.uid, 'shoot_creature', jsonb_build_object('kind', 'creature', 'id', a));
    if (select health < max_health(cr) from creature cr where cr.world_id = w.world_id and cr.id = a) then z := z + 1; end if;
  end loop;
  insert into said values ('WIND:DRAW', y || '|' || z);
  update skill set value = 100 where world_id = w.world_id and uid = w.uid and id in ('archery', 'fighting');
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;

  /* ---- Expose: every blow and shot on it harder, anybody's, and no further than a spell reaches ---- */
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  select * into c from creature where world_id = w.world_id and id = a;
  m0 := class_dealt(w.world_id, w.uid, c);
  r := class_spell_cast(w.world_id, w.uid, 'archer_expose', jsonb_build_object('kind', 'enemy', 'id', a));
  insert into said values ('EXPOSE', m0 || '|' || class_dealt(w.world_id, w.uid, c) || '|' || class_dealt(w.world_id, o, c)
    || '|' || (select extract(epoch from until - now()) from class_mark where world_id = w.world_id and creature_id = a and kind = 'exposed')
    || '|' || coalesce(r->>'said', r->>'why'));
  b := creature_spawn(w.world_id, 'ogre', v_px + spell_reach() + 1, v_py, 'wild', now() - interval '2 hours', null);
  insert into said values ('EXPOSE:FAR', class_spell_cast(w.world_id, w.uid, 'archer_expose', jsonb_build_object('kind', 'enemy', 'id', b))->>'why');
  delete from creature where world_id = w.world_id and id = b;

  /* ---- Snipe: only on one that is after nobody ---- */
  insert into said values ('SNIPE:HUNTING', class_spell_cast(w.world_id, w.uid, 'archer_snipe', jsonb_build_object('kind', 'enemy', 'id', a))->>'why');

  /* ---- Decoy: a creature's blow lands on it instead of you ---- */
  update player set stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{hurtBy}', to_jsonb(a)), wounds = '[]'::jsonb where world_id = w.world_id and uid = w.uid;
  r := class_spell_cast(w.world_id, w.uid, 'archer_decoy', jsonb_build_object('kind', 'self'));
  perform hurt_player(w.world_id, w.uid, 0.1, 'A test blow', 'cut');
  insert into said select 'DECOY', (stats->>'health') || '|' || (select count(*) from event e where e.world_id = w.world_id and e.uid = w.uid
      and e.text = 'The ogre strikes your decoy.') || '|' || extract(epoch from (blessings->'decoy'->>'until')::timestamptz - now())
    from player where world_id = w.world_id and uid = w.uid;
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.1, 'A test blow', 'cut');
  insert into said select 'DECOY:OVER', (stats->>'health') from player where world_id = w.world_id and uid = w.uid;
  update player set stats = jsonb_set(stats, '{health}', '1'), wounds = '[]'::jsonb where world_id = w.world_id and uid = w.uid;

  /* ---- Deadeye: a draw quicker, and a swing as it was ---- */
  m0 := act_base(w.world_id, w.uid, 'shoot_creature', 1);
  m1 := act_base(w.world_id, w.uid, 'attack_creature', 1);
  r := class_spell_cast(w.world_id, w.uid, 'archer_deadeye', jsonb_build_object('kind', 'self'));
  insert into said values ('DEADEYE', (act_base(w.world_id, w.uid, 'shoot_creature', 1) / m0) || '|' || (act_base(w.world_id, w.uid, 'attack_creature', 1) / m1)
    || '|' || (r->>'said'));
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  delete from creature where world_id = w.world_id and id = a;

  /* ---- The door: a bow, arrows, stamina and rest ---- */
  delete from caller where uid = w.uid;
  update player set equipped = jsonb_build_object('weapon', v_sword) where world_id = w.world_id and uid = w.uid;
  insert into said values ('NEEDS:BOW', spell_cast_refusal(w.world_id, w.uid, 'archer_aimed_shot'));
  update player set equipped = jsonb_build_object('weapon', v_bow) where world_id = w.world_id and uid = w.uid;
  insert into said values ('NEEDS:HAS', coalesce(spell_cast_refusal(w.world_id, w.uid, 'archer_aimed_shot'), 'ready'));
  update item set count = 1 where id = v_arrows;
  delete from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and arrow_head_of(def) is not null and id <> v_arrows;
  a := creature_spawn(w.world_id, 'ogre', v_px + 4, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = w.uid, until = now() + interval '1 hour' where world_id = w.world_id and id = a;
  insert into said values ('NEEDS:TWO', class_spell_cast(w.world_id, w.uid, 'archer_twin_arrows', jsonb_build_object('kind', 'enemy', 'id', a))->>'why');
  delete from item where id = v_arrows;
  insert into said values ('NEEDS:ARROWS', spell_cast_refusal(w.world_id, w.uid, 'archer_aimed_shot'));
  v_arrows := give(w.world_id, w.uid, 'arrow', 500, 40);
  update player set used_at = '{}'::jsonb, stats = jsonb_set(stats, '{stamina}', '1') where world_id = w.world_id and uid = w.uid;
  perform spell_bar_put(w.world_id, w.uid, ${FIRST_CLASS_SLOT}, 'archer_read_the_wind');
  r := rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'self'));
  insert into said select 'PAID', coalesce(r->>'cast', r->>'why') || '|' || (stats->>'stamina') || '|' || (r->'rest'->>'archer_read_the_wind')
    from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('RESTING', rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'self'))->>'why');

  /* ---- Arrows back before the passive: none ---- */
  update player set used_at = '{}'::jsonb, blessings = '{}'::jsonb, stats = jsonb_set(stats, '{stamina}', '1') where world_id = w.world_id and uid = w.uid;
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  update item set count = 500 where id = v_arrows;
  select sum(count) into m0 from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def = 'arrow';
  perform setseed(0.21);
  for n in 1..200 loop
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    update item set dmg = 0 where id = v_bow;
    perform class_shot(w.world_id, w.uid, a, 1, true);
  end loop;
  insert into said select 'SAVED:NONE', (m0 - sum(count))::text from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def = 'arrow';

  /* ---- The passives: each number, before and after ---- */
  m0 := held_bow_range(w.world_id, w.uid);
  m1 := weapon_damage(w.world_id, w.uid, (select x3 from weapon_def x3 where id = '${BOW}'), null::item);
  d1 := weapon_damage(w.world_id, w.uid, (select x3 from weapon_def x3 where id = 'sword'), null::item);
  update creature set to_x = v_px + ${RANGE} + 0.5, from_x = v_px + ${RANGE} + 0.5 where world_id = w.world_id and id = a;
  insert into said values ('REFUSED:FAR', coalesce(fight_refusal(w.world_id, w.uid, 'shoot_creature', jsonb_build_object('kind', 'creature', 'id', a)), 'drawn'));
  update creature set to_x = v_px + 0.8, from_x = v_px + 0.8 where world_id = w.world_id and id = a;
  insert into said values ('REFUSED:NEAR', coalesce(fight_refusal(w.world_id, w.uid, 'shoot_creature', jsonb_build_object('kind', 'creature', 'id', a)), 'drawn'));
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, k2.id from class_perk k2
    where k2.class = 'archer' and not exists (select 1 from class_spell cs where cs.id = k2.id)
    on conflict do nothing;
  perform class_fold(w.world_id, w.uid);
  insert into said select 'FOLDED', coalesce((select string_agg(e.k || '=' || e.v, ';' order by e.k collate "C")
      from jsonb_each_text(class_mul->'fx') e(k, v) where e.k ~ '^(save|closest|ambush|pace|dmg|far):'), 'none')
    from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('LONG', m0 || '|' || held_bow_range(w.world_id, w.uid)
    || '|' || coalesce(fight_refusal(w.world_id, w.uid, 'shoot_creature', jsonb_build_object('kind', 'creature', 'id', a)), 'drawn'));
  update creature set to_x = v_px + ${RANGE} + 0.5, from_x = v_px + ${RANGE} + 0.5 where world_id = w.world_id and id = a;
  insert into said values ('LONG:FAR', coalesce(fight_refusal(w.world_id, w.uid, 'shoot_creature', jsonb_build_object('kind', 'creature', 'id', a)), 'drawn'));
  update creature set to_x = v_px + 0.8, from_x = v_px + 0.8 where world_id = w.world_id and id = a;
  insert into said values ('CLOSE', draw_nearest(w.world_id, w.uid) || '|'
    || coalesce(fight_refusal(w.world_id, w.uid, 'shoot_creature', jsonb_build_object('kind', 'creature', 'id', a)), 'drawn'));
  insert into said values ('MASTERY', (weapon_damage(w.world_id, w.uid, (select x3 from weapon_def x3 where id = '${BOW}'), null::item) / m1)
    || '|' || (weapon_damage(w.world_id, w.uid, (select x3 from weapon_def x3 where id = 'sword'), null::item) / d1));
  -- Ambush on one that is not after you, and not on one that is: the same roll asked of both.
  update creature set to_x = v_px + 4, from_x = v_px + 4, health = max_health(creature), hunting = null where world_id = w.world_id and id = a;
  update item set dmg = 0 where id = v_bow;
  perform setseed(0.31);
  d1 := (class_shot(w.world_id, w.uid, a, 1, true)->>'dmg')::double precision;
  update creature set health = max_health(creature), hunting = w.uid, settled_at = now(), until = now() + interval '1 hour' where world_id = w.world_id and id = a;
  update item set dmg = 0 where id = v_bow;
  perform setseed(0.31);
  insert into said values ('AMBUSH', (d1 / (class_shot(w.world_id, w.uid, a, 1, true)->>'dmg')::double precision)::text);
  -- Arrow Saver: a share of the arrows that land back in the pack.
  update item set count = 500 where id = v_arrows;
  select sum(count) into m0 from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def = 'arrow';
  perform setseed(0.21);
  for n in 1..400 loop
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    update item set dmg = 0 where id = v_bow;
    perform class_shot(w.world_id, w.uid, a, 1, true);
  end loop;
  insert into said select 'SAVED', (400 - (m0 - sum(count)))::text from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def = 'arrow';
  -- And a draw's arrows too.
  update item set count = 500 where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def = 'arrow' and id = v_arrows;
  select sum(count) into m0 from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def = 'arrow';
  x := 0;
  for n in 1..200 loop
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
    update item set dmg = 0 where id = v_bow;
    perform perform_fight(w.world_id, w.uid, 'shoot_creature', jsonb_build_object('kind', 'creature', 'id', a));
    if (select health < max_health(cr) from creature cr where cr.world_id = w.world_id and cr.id = a) then x := x + 1; end if;
  end loop;
  insert into said select 'SAVED:DRAW', x || '|' || (200 - (m0 - sum(count))) from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def = 'arrow';
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
  check(`both sides hold the Archer's ${SPELLS.length} spells, field for field, what each wants in your hands included`,
    SPELLS.length === 12 && wrong.length === 0 && [...said.keys()].filter((k) => k.startsWith('SPELL:')).length === SPELLS.length,
    wrong.length ? `island ${island(`SPELL:${wrong[0].id}`)}, browser ${rowOf(wrong[0])}` : `${SPELLS.length} of them`);
}
check('the trade is taken up', island('TAKE') === 'took', island('TAKE'));

for (const sh of SHOTS) {
  const [ratio, landed, used] = parts(`SHOT:${sh.slug}`);
  check(`${spell(sh.slug).name}: a shot at ${pct(sh.want)} of a draw's, and an arrow out of the pack for it`,
    landed === 'true' && near(Number(ratio), sh.want, 1e-9) && used === '1', island(`SHOT:${sh.slug}`));
}
{
  const [slow, secs, line] = parts('CRIPPLE');
  check(`Crippling Shot: for ${fx('crippling_shot', 'secs')} s it goes at ${pct(fx('crippling_shot', 'pace'))} of its pace`,
    near(Number(slow), fx('crippling_shot', 'pace'), 1e-6) && near(Number(secs), fx('crippling_shot', 'secs'), 1e-6)
      && line.endsWith(`it goes at ${pct(fx('crippling_shot', 'pace'))} of its pace.`), island('CRIPPLE'));
}
{
  const [secs, still, line] = parts('PIN');
  check(`Pinning Shot holds it where it stands for ${fx('pinning_shot', 'hold') * fx('pinning_shot', 'monster')} s, a monster as an ogre is`,
    near(Number(secs), fx('pinning_shot', 'hold') * fx('pinning_shot', 'monster'), 1e-6) && still === 'true' && /held where it stands/.test(line), island('PIN'));
}
{
  const [long, aimed] = parts('RANGE:LONG');
  check(`Long Shot reaches ${fx('long_shot', 'range')} times your bow's range, where a shot within it is refused`,
    long === 'loosed' && aimed === `The ogre is more than ${RANGE} tiles away.`, island('RANGE:LONG'));
  check('and no further', island('RANGE:BEYOND') === `The ogre is more than ${RANGE * fx('long_shot', 'range')} tiles away.`, island('RANGE:BEYOND'));
  const [blank, near1] = parts('RANGE:NEAR');
  check(`Point Blank looses nearer than a draw can be made (${DRAW_CLOSEST} tiles), where another shot is refused`,
    blank === 'loosed' && near1 === 'The ogre is too close to draw on.', island('RANGE:NEAR'));
  check(`and no further than ${fx('point_blank', 'reach')} tiles`, island('RANGE:BLANK') === `The ogre is more than ${fx('point_blank', 'reach')} tiles away.`,
    island('RANGE:BLANK'));
}
{
  const [plain, steady, lost] = parts('STEADY').map(Number);
  check('Long Shot lands as often at the far end of the range as at the near end, where a draw lands less often',
    lost === 0 && steady > plain, `${plain} and ${steady} of 300 land, ${lost} lost`);
}
{
  const [ratio, line, used] = parts('TWIN');
  check(`Twin Arrows: ${fx('twin_arrows', 'arrows')} arrows at ${pct(fx('twin_arrows', 'more'))} each, the very rolls of two draws, an arrow for each`,
    near(Number(ratio), 1, 1e-5) && /^Twin Arrows: \d of 2 arrows land/.test(line) && used === '2', island('TWIN'));
}
{
  const [secs, line] = parts('SOONER');
  check(`Quick Shot puts your own next draw ${fx('quick_shot', 'sooner')} s sooner`,
    near(Number(secs), 2 - fx('quick_shot', 'sooner'), 1e-6) && line.endsWith(`Your next draw comes ${fx('quick_shot', 'sooner')} s sooner.`), island('SOONER'));
}
{
  const [plain, wind, lost] = parts('WIND:CRIT').map(Number);
  check(`Read the Wind: the next shot critical ${fx('read_the_wind', 'crit')} times as often, the same rolls asked of both`,
    plain > 10 && lost === 0 && wind / plain > fx('read_the_wind', 'crit') * 0.8 && wind / plain < fx('read_the_wind', 'crit') * 1.2,
    `${plain} and ${wind} criticals of 2500, ${lost} lost`);
  const [sure, left] = parts('WIND:SURE');
  check('and sure, with a hand that misses most shots, and spent on it', sure === '20' && left === 'false', island('WIND:SURE'));
  const [drawn, plainDraw] = parts('WIND:DRAW').map(Number);
  check('a draw spends it as a spell\'s shot does', drawn === 20 && plainDraw < 20, island('WIND:DRAW'));
  check('and it says so', island('WIND:SAID') === `Read the Wind: your next shot within ${fx('read_the_wind', 'secs')} s cannot miss, and is critical twice as often.`,
    island('WIND:SAID'));
}
{
  const [before, mine, theirs, secs, line] = parts('EXPOSE');
  check(`Expose: for ${fx('expose', 'secs')} s every blow and shot on it ${pct(fx('expose', 'more') - 1)} harder, yours and anybody's`,
    near(Number(before), 1) && near(Number(mine), fx('expose', 'more'), 1e-9) && near(Number(theirs), fx('expose', 'more'), 1e-9)
      && near(Number(secs), fx('expose', 'secs'), 1e-6) && line.startsWith('Expose: for 15 s'), island('EXPOSE'));
  check('and no further than a spell reaches', island('EXPOSE:FAR') === 'The ogre is more than 12 tiles away.', island('EXPOSE:FAR'));
}
check('Snipe is refused on a creature already after somebody', island('SNIPE:HUNTING') === 'The ogre is already after somebody.', island('SNIPE:HUNTING'));
{
  const [health, told, secs] = parts('DECOY');
  check(`Decoy: for ${fx('decoy', 'secs')} s a creature's blow lands on the decoy and not on you, and you are told`,
    near(Number(health), 1) && told === '1' && near(Number(secs), fx('decoy', 'secs'), 1e-6), island('DECOY'));
  check('and after it, on you', Number(island('DECOY:OVER')) < 1, island('DECOY:OVER'));
}
{
  const [draw, swing, line] = parts('DEADEYE');
  check(`Deadeye: a draw ${pct(1 - fx('deadeye', 'time'))} quicker, and a swing as it was`,
    near(Number(draw), fx('deadeye', 'time')) && near(Number(swing), 1) && line.startsWith('Deadeye: for 10 s'), island('DEADEYE'));
}
check('a shot is refused without a bow in your hands', island('NEEDS:BOW') === `Aimed Shot wants ${NEEDS_SAID.archery.wants}.`, island('NEEDS:BOW'));
check('and loosed with one', island('NEEDS:HAS') === 'ready', island('NEEDS:HAS'));
check('Twin Arrows is refused with one arrow in the pack', island('NEEDS:TWO') === `Twin Arrows wants ${fx('twin_arrows', 'arrows')} arrows in your pack.`, island('NEEDS:TWO'));
check('and a shot with none', island('NEEDS:ARROWS') === 'You are out of arrows.', island('NEEDS:ARROWS'));
{
  const [cast, stamina, rest] = parts('PAID');
  const s = spell('read_the_wind');
  check(`a spell called through the door costs its ${pct(s.cost)} of a full bar and rests ${s.rest} s`,
    cast === s.id && near(Number(stamina), 1 - s.cost) && near(Number(rest), s.rest, 1e-6), island('PAID'));
  check('and is refused while it rests', island('RESTING') === `${s.name} can be called again in ${s.rest} seconds.`, island('RESTING'));
}

/* ---- The passives ------------------------------------------------------------ */

check('the six passives fold on the island to what they fold to in the browser',
  island('FOLDED') === Object.keys(FOLD).filter((k) => /^(save|closest|ambush|pace|dmg|far):/.test(k)).sort()
    .map((k) => `${k}=${FOLD[k]}`).join(';'), island('FOLDED'));
{
  const [before, after, nearDraw] = parts('LONG');
  check(`Long Draw: your bow reaches ${pct(FOLD['far:archery'] - 1)} further, ${RANGE} tiles to ${RANGE * FOLD['far:archery']}`,
    near(Number(before), RANGE) && near(Number(after), RANGE * FOLD['far:archery'], 1e-9) && nearDraw === 'drawn', island('LONG'));
  check('and a draw past where it reached is made', island('REFUSED:FAR') === 'Too far for a long bow.' && island('LONG:FAR') === 'drawn',
    `${island('REFUSED:FAR')} ${island('LONG:FAR')}`);
}
{
  const [nearest, drawn] = parts('CLOSE');
  check(`Close Quarters: a draw from ${DRAW_CLOSEST * FOLD['closest:draw']} tiles instead of ${DRAW_CLOSEST}`,
    near(Number(nearest), DRAW_CLOSEST * FOLD['closest:draw'], 1e-9) && drawn === 'drawn' && island('REFUSED:NEAR') === 'It is too close to draw on.',
    `${island('REFUSED:NEAR')} ${island('CLOSE')}`);
}
{
  const [bow, sword] = parts('MASTERY').map(Number);
  check(`Bow Mastery: a shot ${pct(FOLD['dmg:archery'] - 1)} harder, and a sword as it was`,
    near(bow, FOLD['dmg:archery']) && near(sword, 1), island('MASTERY'));
}
check(`Ambush: a shot on one not after you ${pct(FOLD['ambush:dmg'] - 1)} harder than on one that is, the same roll asked of both`,
  near(Number(island('AMBUSH')), FOLD['ambush:dmg'], 1e-9), island('AMBUSH'));
{
  const none = Number(island('SAVED:NONE'));
  const saved = Number(island('SAVED'));
  const [landed, drawSaved] = parts('SAVED:DRAW').map(Number);
  check(`Arrow Saver: ${oneInSaid(FOLD['save:arrow'])} of the arrows that land come back, and none without it`,
    none === 200 && saved > 400 * FOLD['save:arrow'] * 0.6 && saved < 400 * FOLD['save:arrow'] * 1.4,
    `${200 - none} of 200 back without it, ${saved} of 400 with it`);
  check('a draw\'s as well', landed > 50 && drawSaved > landed * FOLD['save:arrow'] * 0.5 && drawSaved < landed * FOLD['save:arrow'] * 1.6,
    `${drawSaved} back of ${landed} landed`);
}
check(`Mobile Archer: a walk at ${pct(FOLD['pace:draw'])} of your pace while you draw, instead of ${pct(DRAW_WALK)}`,
  FOLD['pace:draw'] === 0.8 && island('FOLDED').includes('pace:draw=0.8'), island('FOLDED'));
check('no function is open to a player but the doors', island('OPEN') === '0', island('OPEN'));

/* ---- The browser's half ----------------------------------------------------- */

check(`each of the ${CLASS_TIER_AT.length} tiers offers two spells and a passive`,
  TIERS.archer.length === CLASS_TIER_AT.length && TIERS.archer.every((row) => row.length === 3
    && row.filter((num) => SPELLS.some((s) => s.num === num)).length === 2), JSON.stringify(TIERS.archer));
check('every spell that wants a bow says so first, in the words its refusal uses',
  SPELLS.every((s) => !s.needs || s.note.startsWith(`${NEEDS_SAID[s.needs].has}: `)));
check('and every spell\'s perk says what it costs before what it does',
  SPELLS.every((s) => PERK_BY_ID.get(s.id)!.note.startsWith('Spell') && PERK_BY_ID.get(s.id)!.note.endsWith(s.note)));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Archer — ${ok.length} of ${ok.length}`);

/** "1 in 4", from a chance of 0.25. */
function oneInSaid(p: number): string {
  return `1 in ${Math.round(1 / p)}`;
}
