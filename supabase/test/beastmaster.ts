/**
 * The Beastmaster: twelve spells and six passives in six tiers that open on
 * the trade's own level, on the island (`the_beastmaster.sql`) and in the
 * browser's rulebook (`talents.ts`, `perks.ts`).
 *
 * What this asks:
 *
 *   * both sides hold the same twelve spells, field for field, what each wants
 *     -- a companion following you -- included, and the same tiers;
 *   * every blow a spell has your companion strike is its own blow at the
 *     share the spell names -- the same roll asked twice, of two creatures
 *     alike -- only within its reach, or as far as a Pounce leaps, and no
 *     further; a creature it leaps on put back, held, or bled; every wild
 *     thing near it, or everything hunting you, turned on it; its health back;
 *     its blows larger and quicker while a spell holds; a creature that
 *     strikes you answered; a blow on either of you split between you; and a
 *     wild creature tamed outright, into a crate when something follows you;
 *   * its blows teach a Beastmaster's trade, and nobody else's;
 *   * the door charges its stamina and its rest;
 *   * and every passive moves the number it names at the rule it changes, on
 *     the island, with the browser's fold the island's.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
// The rulebook first: what the browser's half reads is a part of it and cannot be loaded on its own.
import '../../src/game/actions';
import { CLASS_TIER_AT } from '../../src/game/classes';
import { companionMul, SPECIES } from '../../src/game/creatures';
import { COMPANION_BLOW, COMPANION_LEASH, COMPANION_SIGHT } from '../../src/game/fight';
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

const SPELLS = classSpellsOf('beastmaster');
const spell = (slug: string): ClassSpellDef => {
  const s = CLASS_SPELL_BY_ID.get(`beastmaster_${slug}`);
  if (!s) throw new Error(`no beastmaster_${slug}`);
  return s;
};
const fx = (slug: string, k: string): number => spell(slug).fx[k];
const PASSIVES = perksOf('beastmaster').filter((p) => !CLASS_SPELL_BY_ID.has(p.id));
/** What the six passives fold to, which is what the browser reads a Beastmaster's numbers from. */
const FOLD = foldPerks(PASSIVES.map((p) => p.id));
const FIRST_CLASS_SLOT = SPELL_BAR.indexOf('class');
/** The companion: a beast that is no monster and no prey, with health enough to measure a share of in whole numbers. */
const KIN = 'roxxen';

/** A spell's row as the island prints it and as the browser would: every field, the numbers by name. */
const rowOf = (s: ClassSpellDef): string =>
  [s.id, s.class, s.num, s.name, s.cost, s.rest, s.on.join('+'),
    Object.keys(s.fx).sort().map((k) => `${k}=${s.fx[k]}`).join(';'), s.note, s.needs ?? '-'].join('¦');

const ON_ME = `jsonb_build_object('kind', 'self', 'uid', w.uid)`;
const ON = (id: string): string => `jsonb_build_object('kind', 'enemy', 'id', ${id})`;
/** A wild creature put down at a spot, alike in everything that has a say in a fight, and doing nothing of its own. */
const SPAWN = (v: string, species: string, x: string, y: string): string => `
  ${v} := creature_spawn(w.world_id, '${species}', ${x}, ${y}, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = null, brawl = null, enemy = null, hunt_again = null,
         settled_at = now(), until = now() + interval '1 hour', windup_at = null, bleed_rate = null, bleed_until = null
   where world_id = w.world_id and id = ${v};
  update creature set health = max_health(creature) where world_id = w.world_id and id = ${v};`;
/** Two creatures' health put back and their turns pushed off again, between one blow and the next. */
const FRESH = (ids: string): string => `
  update creature set health = max_health(creature), settled_at = now(), until = now() + interval '1 hour', brawl = null,
         hunting = null, windup_at = null, bleed_rate = null, bleed_until = null, hurt_at = null
   where world_id = w.world_id and id in (${ids});`;
/** The companion at your heel, unhurt, with nothing to fight and its turn now. */
const HEEL = `
  update creature set from_x = v_px, from_y = v_py, to_x = v_px, to_y = v_py, leg_at = now(), leg_ends = now(), until = now(),
         settled_at = now(), phase = 'idle', enemy = null, heel_until = null, stance = 'defensive', hurt_at = null,
         health = max_health(creature)
   where world_id = w.world_id and id = k;`;

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w record; v_px double precision; v_py double precision; r jsonb; kc creature; pl player;
        k int; a int; b int; c int; e int; v_seed double precision;
        h0 double precision; h1 double precision; d1 double precision; m0 double precision; m1 double precision;
begin
  -- An island with land, and somebody on it.
  select p.world_id, p.uid, wd.spawn_x, wd.spawn_y into w from player p join world wd on wd.id = p.world_id
   where exists (select 1 from land_tile lt where lt.world_id = wd.id)
   order by wd.size desc, p.world_id, p.uid limit 1;
  v_px := w.spawn_x + peace_reach() + 10.5; v_py := w.spawn_y + 0.5;
  update placed set driver = null where world_id = w.world_id and driver = w.uid;
  update player set x = v_px, y = v_py, level = 0, aboard = null, away = false, act = null, act_target = null,
         act_ends = null, act_queue = '[]', equipped = '{}'::jsonb, wounds = '[]'::jsonb, fight_stance = 'balanced', blessings = '{}'::jsonb,
         used_at = '{}'::jsonb, body_at = now(), craft_class = null, combat_class = null, class_mul = null, class_level = 0,
         moved_at = now() - interval '1 hour', fight_back = false,
         spell_bar = (select jsonb_agg('null'::jsonb) from spell_slot),
         stats = (coalesce(stats, '{}'::jsonb) - 'hurtAt' - 'hurtBy')
                 || jsonb_build_object('health', 1, 'hunger', 1, 'thirst', 1, 'stamina', 1, 'aegis', 0, 'hurtSettled', now())
   where world_id = w.world_id and uid = w.uid;
  -- Everybody else on the island well away.
  update player set x = v_px - 60 where world_id = w.world_id and uid <> w.uid;
  insert into skill (world_id, uid, id, value)
    select w.world_id, w.uid, s, v from
      (values ('soul_strength', 100::double precision), ('taming', 100), ('fighting', 100), ('body_control', 1)) sv(s, v)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  delete from event where uid = w.uid;
  delete from player_node where world_id = w.world_id and uid = w.uid;
  delete from player_spell where world_id = w.world_id and uid = w.uid;
  delete from creature where world_id = w.world_id and to_x between v_px - 45 and v_px + 45 and to_y between v_py - 45 and v_py + 45;
  delete from creature where world_id = w.world_id and (hunting = w.uid or keeper = w.uid);
  delete from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def = 'creature_crate';
  delete from class_mark where world_id = w.world_id;
  delete from faith_owed where world_id = w.world_id;
  delete from faith_zone where world_id = w.world_id;
  delete from caller where uid = w.uid;
  perform set_config('request.jwt.claims', json_build_object('sub', w.uid)::text, true);

  /* ---- The rows ---- */
  insert into said select 'SPELL:' || id, id || '¦' || class || '¦' || num || '¦' || name || '¦' || cost || '¦' || rest || '¦'
      || array_to_string(on_what, '+') || '¦' || coalesce((select string_agg(e2.k || '=' || e2.v, ';' order by e2.k) from jsonb_each_text(fx) e2(k, v)), '')
      || '¦' || note || '¦' || coalesce(needs, '-')
    from class_spell where class = 'beastmaster';

  insert into said values ('TAKE', coalesce(rpc_take_class(w.world_id, 'beastmaster')->>'why', 'took'));
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, cs.id from class_spell cs where cs.class = 'beastmaster'
    on conflict do nothing;

  /* ---- No companion, no spell; and with one ---- */
  insert into said values ('NEEDS:NONE', coalesce(spell_cast_refusal(w.world_id, w.uid, 'beastmaster_sic'), 'ready'));
  k := creature_spawn(w.world_id, '${KIN}', v_px, v_py, 'active', now() - interval '2 hours', w.uid);
  update creature set traits = '{}', rare = null, skills = '{}'::jsonb where world_id = w.world_id and id = k;
  ${HEEL}
  insert into said values ('NEEDS:KIN', coalesce(spell_cast_refusal(w.world_id, w.uid, 'beastmaster_sic'), 'ready'));
  insert into said values ('NEEDS:WILD', coalesce(spell_cast_refusal(w.world_id, w.uid, 'beastmaster_call_of_the_wild'), 'ready'));

  /* ---- Sic: its own blow at its share, the same roll asked of two ogres alike, and only within its reach ---- */
  ${SPAWN('a', 'ogre', 'v_px + 0.5', 'v_py')}
  ${SPAWN('b', 'ogre', 'v_px - 0.5', 'v_py')}
  v_seed := 0.21;
  perform setseed(v_seed);
  perform creature_attack(w.world_id, k, a);
  select max_health(cr) - cr.health into d1 from creature cr where cr.world_id = w.world_id and cr.id = a;
  ${HEEL}
  perform setseed(v_seed);
  r := class_spell_cast(w.world_id, w.uid, 'beastmaster_sic', ${ON('b')});
  insert into said select 'SIC', ((max_health(cr) - cr.health) / d1) || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id = b;
  ${FRESH('a, b')}
  ${SPAWN('c', 'ogre', 'v_px + 3', 'v_py')}
  insert into said values ('SIC:FAR', class_spell_cast(w.world_id, w.uid, 'beastmaster_sic', ${ON('c')})->>'why');

  /* ---- Its blows teach a Beastmaster's trade, and nobody else's ---- */
  select class_level into m0 from player where world_id = w.world_id and uid = w.uid;
  perform creature_attack(w.world_id, k, a);
  select class_level into m1 from player where world_id = w.world_id and uid = w.uid;
  update player set combat_class = 'blade' where world_id = w.world_id and uid = w.uid;
  perform creature_attack(w.world_id, k, a);
  insert into said select 'LEARN', (m1 > m0)::text || '|' || (class_level = m1)::text from player where world_id = w.world_id and uid = w.uid;
  update player set combat_class = 'beastmaster' where world_id = w.world_id and uid = w.uid;
  ${FRESH('a, b, c')}

  /* ---- Lick Wounds: its share of its health back; refused on one unhurt ---- */
  ${HEEL}
  update creature set health = max_health(creature) / 2 where world_id = w.world_id and id = k;
  r := class_spell_cast(w.world_id, w.uid, 'beastmaster_lick_wounds', ${ON_ME});
  insert into said select 'LICK', (cr.health / max_health(cr)) || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id = k;
  ${HEEL}
  insert into said values ('LICK:WHOLE', class_spell_cast(w.world_id, w.uid, 'beastmaster_lick_wounds', ${ON_ME})->>'why');

  /* ---- Pounce: a leap onto it, its own blow, its next blow put back; and no further than it leaps ---- */
  ${HEEL}
  ${FRESH('a, c')}
  v_seed := 0.33;
  perform setseed(v_seed);
  perform creature_attack(w.world_id, k, a);
  select max_health(cr) - cr.health into d1 from creature cr where cr.world_id = w.world_id and cr.id = a;
  ${HEEL}
  select until into h0 from (select extract(epoch from until) as until from creature where world_id = w.world_id and id = c) u;
  perform setseed(v_seed);
  r := class_spell_cast(w.world_id, w.uid, 'beastmaster_pounce', ${ON('c')});
  insert into said select 'POUNCE', ((max_health(cc) - cc.health) / d1) || '|'
      || (sqrt((creature_x(cc) - creature_x(kk)) ^ 2 + (creature_y(cc) - creature_y(kk)) ^ 2) <= companion_reach())::text || '|'
      || (kk.enemy = c)::text || '|' || (extract(epoch from cc.until) - h0) || '|' || coalesce(r->>'said', r->>'why')
    from creature cc, creature kk where cc.world_id = w.world_id and cc.id = c and kk.world_id = w.world_id and kk.id = k;
  ${FRESH('a, c')}
  ${HEEL}
  ${SPAWN('e', 'ogre', `v_px + ${fx('pounce', 'reach')} + 1`, 'v_py')}
  insert into said values ('POUNCE:FAR', class_spell_cast(w.world_id, w.uid, 'beastmaster_pounce', ${ON('e')})->>'why');
  delete from creature where world_id = w.world_id and id = e;

  /* ---- Drag Down: its own blow at its share, and held where it stands ---- */
  ${HEEL}
  v_seed := 0.45;
  perform setseed(v_seed);
  perform creature_attack(w.world_id, k, a);
  select max_health(cr) - cr.health into d1 from creature cr where cr.world_id = w.world_id and cr.id = a;
  ${HEEL}
  update creature set until = now() where world_id = w.world_id and id = b;
  perform setseed(v_seed);
  r := class_spell_cast(w.world_id, w.uid, 'beastmaster_drag_down', ${ON('b')});
  insert into said select 'DRAG', ((max_health(cr) - cr.health) / d1) || '|' || extract(epoch from cr.until - now()) || '|'
      || (cr.from_x = cr.to_x and cr.from_y = cr.to_y)::text || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id = b;
  ${FRESH('a, b')}

  /* ---- Disembowel: its own blow, and a bleed of its share of the blow a second, for as long as it says ---- */
  ${HEEL}
  v_seed := 0.57;
  perform setseed(v_seed);
  perform creature_attack(w.world_id, k, a);
  select max_health(cr) - cr.health into d1 from creature cr where cr.world_id = w.world_id and cr.id = a;
  ${HEEL}
  perform setseed(v_seed);
  r := class_spell_cast(w.world_id, w.uid, 'beastmaster_disembowel', ${ON('b')});
  insert into said select 'GUT', ((max_health(cr) - cr.health) / d1) || '|' || (cr.bleed_rate / (r->'blow'->>'dmg')::double precision) || '|'
      || extract(epoch from cr.bleed_until - now()) || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id = b;
  ${FRESH('a, b')}

  /* ---- Bloodlust and Primal Fury: its blows larger, the same roll asked with and without; and quicker ---- */
  ${HEEL}
  v_seed := 0.69;
  perform setseed(v_seed);
  perform creature_attack(w.world_id, k, a);
  select max_health(cr) - cr.health into d1 from creature cr where cr.world_id = w.world_id and cr.id = a;
  ${FRESH('a')}
  r := class_spell_cast(w.world_id, w.uid, 'beastmaster_bloodlust', ${ON_ME});
  perform setseed(v_seed);
  perform creature_attack(w.world_id, k, a);
  insert into said select 'LUST', ((max_health(cr) - cr.health) / d1) || '|'
      || extract(epoch from (pl2.blessings->'bloodlust'->>'until')::timestamptz - now()) || '|' || coalesce(r->>'said', r->>'why')
    from creature cr, player pl2 where cr.world_id = w.world_id and cr.id = a and pl2.world_id = w.world_id and pl2.uid = w.uid;
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  ${FRESH('a')}
  r := class_spell_cast(w.world_id, w.uid, 'beastmaster_primal_fury', ${ON_ME});
  perform setseed(v_seed);
  perform creature_attack(w.world_id, k, a);
  ${HEEL}
  update creature set enemy = a where world_id = w.world_id and id = k;
  perform companion_settle(w.world_id, k);
  insert into said select 'FURY', ((max_health(cr) - cr.health) / d1) || '|' || extract(epoch from kk.until - now()) || '|'
      || extract(epoch from (pl2.blessings->'primal_fury'->>'until')::timestamptz - now()) || '|' || coalesce(r->>'said', r->>'why')
    from creature cr, creature kk, player pl2
   where cr.world_id = w.world_id and cr.id = a and kk.world_id = w.world_id and kk.id = k and pl2.world_id = w.world_id and pl2.uid = w.uid;
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  ${FRESH('a')}
  ${HEEL}
  update creature set enemy = a where world_id = w.world_id and id = k;
  perform companion_settle(w.world_id, k);
  insert into said select 'PACE', extract(epoch from until - now())::text from creature where world_id = w.world_id and id = k;
  ${HEEL}

  /* ---- Snarl: every wild thing within its reach of your companion turns on it, and nothing further ---- */
  ${SPAWN('e', 'ogre', `v_px + ${fx('snarl', 'reach')} + 2`, 'v_py')}
  r := class_spell_cast(w.world_id, w.uid, 'beastmaster_snarl', ${ON_ME});
  insert into said select 'SNARL', string_agg(cr.id::text || ':' || coalesce((cr.brawl = k)::text, 'false'), ',' order by cr.id) || '|'
      || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id in (a, b, c, e);
  update creature set brawl = null where world_id = w.world_id and id in (a, b, c, e);
  delete from creature where world_id = w.world_id and id in (a, b, c, e);
  insert into said values ('SNARL:NONE', class_spell_cast(w.world_id, w.uid, 'beastmaster_snarl', ${ON_ME})->>'why');

  /* ---- Guard Me: to your side, and everything hunting you within its reach of you on it; refused with nothing on you ---- */
  insert into said values ('GUARD:NONE', class_spell_cast(w.world_id, w.uid, 'beastmaster_guard_me', ${ON_ME})->>'why');
  ${SPAWN('a', 'ogre', 'v_px - 3', 'v_py')}
  ${SPAWN('b', 'ogre', 'v_px', 'v_py + 4')}
  ${SPAWN('c', 'ogre', `v_px - ${fx('guard_me', 'reach')} - 2`, 'v_py')}
  ${SPAWN('e', 'ogre', 'v_px + 5.5', 'v_py')}
  update creature set hunting = w.uid where world_id = w.world_id and id in (a, b, c);
  -- Off at a fight of its own, so that it is the leap that brings it to you and not its heel.
  update creature set from_x = v_px + 5, from_y = v_py, to_x = v_px + 5, to_y = v_py, enemy = e, until = now() + interval '1 second'
   where world_id = w.world_id and id = k;
  r := class_spell_cast(w.world_id, w.uid, 'beastmaster_guard_me', ${ON_ME});
  insert into said select 'GUARD', (select (creature_x(kk) = v_px and creature_y(kk) = v_py)::text from creature kk where kk.world_id = w.world_id and kk.id = k)
      || '|' || string_agg(cr.id::text || ':' || coalesce((cr.brawl = k)::text, 'false'), ',' order by cr.id) || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id in (a, b, c, e);
  insert into said select 'GUARD:IDS', a || ',' || b || ',' || c || ',' || e;
  update creature set brawl = null where world_id = w.world_id and id in (a, b, c, e);
  delete from creature where world_id = w.world_id and id in (a, b, c, e);
  ${HEEL}

  /* ---- Vengeance: a creature that lands a blow on you is answered at its share, once its turn is written ---- */
  ${SPAWN('a', 'ogre', 'v_px + 0.5', 'v_py')}
  ${SPAWN('b', 'ogre', 'v_px - 0.5', 'v_py')}
  r := class_spell_cast(w.world_id, w.uid, 'beastmaster_vengeance', ${ON_ME});
  update player set stats = stats || jsonb_build_object('hurtBy', b, 'hurtAt', now() - interval '1 hour') where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.05, 'The ogre bites you', 'bite');
  insert into said select 'VENGE:OWED', coalesce((select n || '|' || val from class_mark where world_id = w.world_id and creature_id = b and kind = 'vengeance'), 'none');
  update player set act = null, act_target = null, act_ends = null, act_queue = '[]', stats = (stats - 'hurtBy' - 'hurtAt') || jsonb_build_object('health', 1)
   where world_id = w.world_id and uid = w.uid;
  ${HEEL}
  v_seed := 0.77;
  perform setseed(v_seed);
  perform creature_attack(w.world_id, k, a);
  select max_health(cr) - cr.health into d1 from creature cr where cr.world_id = w.world_id and cr.id = a;
  ${HEEL}
  update creature set settled_at = now() where world_id = w.world_id and id = b;
  perform setseed(v_seed);
  perform class_owed_pay(w.world_id, b);
  insert into said select 'VENGE', ((max_health(cr) - cr.health) / d1) || '|'
      || extract(epoch from (pl2.blessings->'vengeance'->>'until')::timestamptz - now()) || '|' || coalesce(r->>'said', r->>'why')
    from creature cr, player pl2 where cr.world_id = w.world_id and cr.id = b and pl2.world_id = w.world_id and pl2.uid = w.uid;
  -- And not past its reach: the companion further from the striker than the spell says.
  ${FRESH('b')}
  update creature set from_x = v_px - 0.5 - ${fx('vengeance', 'reach')} - 1, to_x = v_px - 0.5 - ${fx('vengeance', 'reach')} - 1
   where world_id = w.world_id and id = k;
  insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
    values (w.world_id, b, 'vengeance', ${fx('vengeance', 'more')}, 1, now(), w.uid);
  perform class_owed_pay(w.world_id, b);
  insert into said select 'VENGE:FAR', (max_health(cr) - cr.health)::text from creature cr where cr.world_id = w.world_id and cr.id = b;
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  ${FRESH('a, b')}
  ${HEEL}

  /* ---- Feral Bond: a blow on you split with it, and a blow on it split with you ---- */
  r := class_spell_cast(w.world_id, w.uid, 'beastmaster_feral_bond', ${ON_ME});
  h0 := class_bond_take(w.world_id, w.uid, 0.1, b);
  insert into said select 'BOND:ME', h0 || '|' || (max_health(cr) - cr.health) || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id = k;
  ${HEEL}
  update player set stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = w.uid;
  perform wound_beast(w.world_id, k, 10, v_px + 0.5, v_py, null, a);
  insert into said select 'BOND:IT', (max_health(cr) - cr.health) || '|' || (1 - (pl2.stats->>'health')::double precision)
    from creature cr, player pl2 where cr.world_id = w.world_id and cr.id = k and pl2.world_id = w.world_id and pl2.uid = w.uid;
  update player set blessings = '{}'::jsonb, stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = w.uid;
  ${HEEL}

  /* ---- Long Leash, before: what it looks for and how far it follows a fight ---- */
  delete from creature where world_id = w.world_id and id in (a, b);
  ${SPAWN('a', 'ogre', `v_px + ${(COMPANION_SIGHT + 8) / 2}`, 'v_py')}
  ${SPAWN('b', 'ogre', `v_px - ${(COMPANION_LEASH + 14) / 2}`, 'v_py')}
  ${SPAWN('c', 'ogre', `v_px`, `v_py + 16`)}
  update creature set stance = 'aggressive' where world_id = w.world_id and id = k;
  select * into kc from creature where world_id = w.world_id and id = k;
  select * into pl from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('SIGHT:BEFORE', coalesce((companion_target(w.world_id, kc, pl)).id::text, 'none'));
  kc.enemy := b;
  insert into said values ('LEASH:BEFORE', coalesce((companion_target(w.world_id, kc, pl)).id::text, 'none'));
  insert into said values ('ORDER:BEFORE', coalesce(creature_refusal(w.world_id, w.uid, 'order_attack',
    jsonb_build_object('kind', 'creature', 'id', k, 'foe', c)), 'ordered'));
  update creature set stance = 'defensive' where world_id = w.world_id and id = k;

  /* ---- The passives: each number, before and after ---- */
  select max_health(cr) into m0 from creature cr where cr.world_id = w.world_id and cr.id = k;
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, k2.id from class_perk k2
    where k2.class = 'beastmaster' and not exists (select 1 from class_spell cs where cs.id = k2.id)
    on conflict do nothing;
  perform class_fold(w.world_id, w.uid);
  insert into said select 'FOLDED', coalesce((select string_agg(e2.k || '=' || e2.v, ';' order by e2.k collate "C")
      from jsonb_each_text(class_mul->'fx') e2(k, v) where e2.k ~ '^(kept|leash|sight|bond):'), 'none')
    from player where world_id = w.world_id and uid = w.uid;
  insert into said select 'KEPT', cr.kept::text from creature cr where cr.world_id = w.world_id and cr.id = k;
  insert into said select 'HIDE', m0 || '|' || max_health(cr) from creature cr where cr.world_id = w.world_id and cr.id = k;
  insert into said select 'MULS', beast_mul(cr, 'soak') || '|' || beast_mul(cr, 'speed') || '|' || beast_mul(cr, 'haste') || '|' || beast_mul(cr, 'tough')
    from creature cr where cr.world_id = w.world_id and cr.id = k;
  -- Only while it follows you: the same beast crated has none of it.
  select * into kc from creature where world_id = w.world_id and id = k;
  kc.mode := 'stored';
  insert into said values ('CRATED', max_health(kc) || '|' || beast_mul(kc, 'soak') || '|' || beast_mul(kc, 'speed') || '|' || beast_mul(kc, 'haste'));
  ${HEEL}
  update creature set enemy = null where world_id = w.world_id and id = k;
  -- Quick Paws: its next blow sooner.
  ${SPAWN('e', 'ogre', 'v_px + 0.5', 'v_py')}
  update creature set enemy = e where world_id = w.world_id and id = k;
  perform companion_settle(w.world_id, k);
  insert into said select 'QUICK', extract(epoch from until - now())::text from creature where world_id = w.world_id and id = k;
  delete from creature where world_id = w.world_id and id = e;
  ${HEEL}
  -- Long Leash, after.
  update creature set stance = 'aggressive' where world_id = w.world_id and id = k;
  select * into kc from creature where world_id = w.world_id and id = k;
  select * into pl from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('SIGHT', coalesce((companion_target(w.world_id, kc, pl)).id::text, 'none') || '|' || a);
  kc.enemy := b;
  insert into said values ('LEASH', coalesce((companion_target(w.world_id, kc, pl)).id::text, 'none') || '|' || b);
  insert into said values ('ORDER', coalesce(creature_refusal(w.world_id, w.uid, 'order_attack',
    jsonb_build_object('kind', 'creature', 'id', k, 'foe', c)), 'ordered'));
  update creature set stance = 'defensive' where world_id = w.world_id and id = k;
  delete from creature where world_id = w.world_id and id in (a, b, c);
  ${HEEL}
  -- Shared Wounds: within its reach of you, its share of a blow that lands on you; beyond it, none.
  ${SPAWN('a', 'ogre', 'v_px + 0.5', 'v_py')}
  h0 := class_bond_take(w.world_id, w.uid, 0.1, a);
  insert into said select 'SHARED', h0 || '|' || (max_health(cr) - cr.health) from creature cr where cr.world_id = w.world_id and cr.id = k;
  ${HEEL}
  update creature set from_x = v_px + ${FOLD['bond:reach']} + 1, to_x = v_px + ${FOLD['bond:reach']} + 1 where world_id = w.world_id and id = k;
  h0 := class_bond_take(w.world_id, w.uid, 0.1, a);
  insert into said select 'SHARED:FAR', h0 || '|' || (max_health(cr) - cr.health) from creature cr where cr.world_id = w.world_id and cr.id = k;
  ${HEEL}
  -- And on the way in: a blow that lands on you, a share of it off your companion.
  update player set stats = stats || jsonb_build_object('hurtBy', a, 'health', 1) where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.05, 'The ogre bites you', 'bite');
  insert into said select 'SHARED:BLOW', (cr.health < max_health(cr))::text || '|' || ((pl2.stats->>'health')::double precision < 1)::text
    from creature cr, player pl2 where cr.world_id = w.world_id and cr.id = k and pl2.world_id = w.world_id and pl2.uid = w.uid;
  update player set act = null, act_target = null, act_ends = null, act_queue = '[]', wounds = '[]'::jsonb,
         stats = (stats - 'hurtBy' - 'hurtAt') || jsonb_build_object('health', 1)
   where world_id = w.world_id and uid = w.uid;
  delete from creature where world_id = w.world_id and id = a;
  ${HEEL}

  /* ---- Call of the Wild: never a monster, never above your taming, never without room; into the crate, or to follow ---- */
  ${SPAWN('a', 'ogre', 'v_px + 2', 'v_py')}
  ${SPAWN('b', 'rowl', 'v_px - 2', 'v_py')}
  ${SPAWN('c', 'ulva', 'v_px', 'v_py + 2')}
  ${SPAWN('e', 'rowl', `v_px + ${fx('call_of_the_wild', 'reach')} + 2`, 'v_py')}
  insert into said values ('WILD:MONSTER', class_spell_cast(w.world_id, w.uid, 'beastmaster_call_of_the_wild', ${ON('a')})->>'why');
  insert into said values ('WILD:FAR', class_spell_cast(w.world_id, w.uid, 'beastmaster_call_of_the_wild', ${ON('e')})->>'why');
  update skill set value = 10 where world_id = w.world_id and uid = w.uid and id = 'taming';
  insert into said values ('WILD:SKILL', class_spell_cast(w.world_id, w.uid, 'beastmaster_call_of_the_wild', ${ON('b')})->>'why');
  update skill set value = 100 where world_id = w.world_id and uid = w.uid and id = 'taming';
  insert into said values ('WILD:ROOM', class_spell_cast(w.world_id, w.uid, 'beastmaster_call_of_the_wild', ${ON('b')})->>'why');
  perform give(w.world_id, w.uid, 'creature_crate', 1, 50);
  r := class_spell_cast(w.world_id, w.uid, 'beastmaster_call_of_the_wild', ${ON('b')});
  insert into said select 'WILD:CRATED', cr.mode || '|' || (cr.keeper = w.uid)::text || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id = b;
  update creature set mode = 'stored' where world_id = w.world_id and id = k;
  r := class_spell_cast(w.world_id, w.uid, 'beastmaster_call_of_the_wild', ${ON('c')});
  insert into said select 'WILD:FOLLOWS', cr.mode || '|' || (cr.keeper = w.uid)::text || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id = c;
  delete from creature where world_id = w.world_id and id in (a, b, c, e);
  update creature set mode = 'active' where world_id = w.world_id and id = k;
  ${HEEL}

  /* ---- The door: its stamina and its rest ---- */
  delete from caller where uid = w.uid;
  update creature set health = max_health(creature) / 2 where world_id = w.world_id and id = k;
  update player set used_at = '{}'::jsonb, stats = jsonb_set(stats, '{stamina}', '1') where world_id = w.world_id and uid = w.uid;
  perform spell_bar_put(w.world_id, w.uid, ${FIRST_CLASS_SLOT}, 'beastmaster_lick_wounds');
  r := rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'self'));
  insert into said select 'PAID', coalesce(r->>'cast', r->>'why') || '|' || (stats->>'stamina') || '|'
      || coalesce(r->'rest'->>'beastmaster_lick_wounds', 'none')
    from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('RESTING', rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'self'))->>'why');
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
  check(`both sides hold the Beastmaster's ${SPELLS.length} spells, field for field, what each wants included`,
    SPELLS.length === 12 && wrong.length === 0 && [...said.keys()].filter((k) => k.startsWith('SPELL:')).length === SPELLS.length,
    wrong.length ? `island ${island(`SPELL:${wrong[0].id}`)}, browser ${rowOf(wrong[0])}` : `${SPELLS.length} of them`);
}
check('the trade is taken up', island('TAKE') === 'took', island('TAKE'));
check('a spell through a companion is refused with none following you, in the words its note uses',
  island('NEEDS:NONE') === `Sic wants ${NEEDS_SAID.companion.wants}.`, island('NEEDS:NONE'));
check('and made with one', island('NEEDS:KIN') === 'ready' && island('NEEDS:WILD') === 'ready',
  `${island('NEEDS:KIN')} / ${island('NEEDS:WILD')}`);
{
  const [ratio, line] = parts('SIC');
  check(`Sic: its own blow at ${pct(fx('sic', 'more'))}, the same roll asked of two ogres alike`,
    near(Number(ratio), fx('sic', 'more'), 1e-4) && /^Sic: .+ strikes the ogre\. It is down to \d+ of 170\.$/.test(line), island('SIC'));
  check('and only on what is within its reach', /is not close enough to the ogre to strike it\.$/.test(island('SIC:FAR')), island('SIC:FAR'));
}
{
  const [learned, others] = parts('LEARN');
  check('a blow your companion lands teaches the Beastmaster’s trade, and not another trade', learned === 'true' && others === 'true',
    island('LEARN'));
}
{
  const [share, line] = parts('LICK');
  check(`Lick Wounds: ${pct(fx('lick_wounds', 'heal'))} of its health back`, near(Number(share), 0.5 + fx('lick_wounds', 'heal'), 0.02)
    && /^Lick Wounds heals .+ by 15%\.$/.test(line), island('LICK'));
  check('and refused on one unhurt', / is not hurt\.$/.test(island('LICK:WHOLE')), island('LICK:WHOLE'));
}
{
  const [ratio, beside, onIt, back, line] = parts('POUNCE');
  check(`Pounce: a leap onto it, its own blow at ${pct(fx('pounce', 'more'))}, and its next blow put back ${fx('pounce', 'back')} s`,
    near(Number(ratio), fx('pounce', 'more'), 1e-4) && beside === 'true' && onIt === 'true' && near(Number(back), fx('pounce', 'back'), 1e-6)
      && / Its next blow is put back 0\.5 s\.$/.test(line), island('POUNCE'));
  check(`and no further than ${fx('pounce', 'reach')} tiles`, / is more than 5 tiles from the ogre\.$/.test(island('POUNCE:FAR')), island('POUNCE:FAR'));
}
{
  const [ratio, held, still, line] = parts('DRAG');
  check(`Drag Down: its own blow at ${pct(fx('drag_down', 'more'))}, and held where it stands for ${fx('drag_down', 'hold')} s`,
    near(Number(ratio), fx('drag_down', 'more'), 1e-4) && near(Number(held), fx('drag_down', 'hold'), 1e-6) && still === 'true'
      && / It is held where it stands for 4 s\.$/.test(line), island('DRAG'));
}
{
  const [ratio, bleed, secs, line] = parts('GUT');
  check(`Disembowel: its own blow, and ${pct(fx('disembowel', 'each'))} of the blow a second for ${fx('disembowel', 'secs')} s`,
    near(Number(ratio), fx('disembowel', 'more'), 1e-4) && near(Number(bleed), fx('disembowel', 'each'), 1e-6)
      && near(Number(secs), fx('disembowel', 'secs'), 1e-6) && / It bleeds 30% of the blow a second for 8 s\.$/.test(line), island('GUT'));
}
{
  const [ratio, secs, line] = parts('LUST');
  check(`Bloodlust: its blows ${pct(fx('bloodlust', 'more') - 1)} larger for ${fx('bloodlust', 'secs')} s, the same roll asked with and without`,
    near(Number(ratio), fx('bloodlust', 'more'), 1e-4) && near(Number(secs), fx('bloodlust', 'secs'), 1e-6)
      && /blows are 40% larger\.$/.test(line), island('LUST'));
}
{
  const [ratio, next, secs, line] = parts('FURY');
  check(`Primal Fury: its blows ${pct(fx('primal_fury', 'more') - 1)} larger, and its next one ${COMPANION_BLOW / fx('primal_fury', 'quick')} s off `
    + `rather than ${COMPANION_BLOW}`,
    near(Number(ratio), fx('primal_fury', 'more'), 1e-4) && near(Number(next), COMPANION_BLOW / fx('primal_fury', 'quick'), 1e-6)
      && near(Number(secs), fx('primal_fury', 'secs'), 1e-6) && /larger and come 50% more often\.$/.test(line), island('FURY'));
  check('and as often as ever once it is over', near(Number(island('PACE')), COMPANION_BLOW, 1e-6), island('PACE'));
}
{
  const [snarlLine, said2] = [island('SNARL').split('|'), island('SNARL')];
  const turned = snarlLine[0].split(',').map((x) => x.split(':')[1]);
  check(`Snarl: every wild thing within ${fx('snarl', 'reach')} tiles of your companion turns on it, and nothing further`,
    turned.join() === 'true,true,true,false' && /3 creatures turn on .+\.$/.test(snarlLine[1] ?? ''), said2);
  check('and it is refused with nothing near it', /^Nothing wild is within 4 tiles of .+\.$/.test(island('SNARL:NONE')), island('SNARL:NONE'));
}
{
  const [atSide, turnedAll, line] = parts('GUARD');
  const turned = turnedAll.split(',').map((x) => x.split(':')[1]);
  check(`Guard Me: at your side, and everything hunting you within ${fx('guard_me', 'reach')} tiles on it -- not one further, not one not hunting you`,
    atSide === 'true' && turned.join() === 'true,true,false,false' && /is at your side, and 2 creatures turn on it\.$/.test(line), island('GUARD'));
  check('and it is refused with nothing hunting you', island('GUARD:NONE') === 'Nothing within 6 tiles of you is hunting you.', island('GUARD:NONE'));
}
{
  const [owed, val] = parts('VENGE:OWED');
  const [ratio, secs, line] = parts('VENGE');
  check(`Vengeance: a blow that lands on you is owed an answer, and paid at ${pct(fx('vengeance', 'more'))} of its own blow once its turn is written`,
    owed === '1' && near(Number(val), fx('vengeance', 'more'), 1e-9) && near(Number(ratio), fx('vengeance', 'more'), 1e-4)
      && near(Number(secs), fx('vengeance', 'secs'), 1e-6) && /answers every creature that lands a blow on you\.$/.test(line),
    `${island('VENGE:OWED')} / ${island('VENGE')}`);
  check(`and not from more than ${fx('vengeance', 'reach')} tiles off`, island('VENGE:FAR') === '0', island('VENGE:FAR'));
}
{
  const [left, took, line] = parts('BOND:ME');
  const [itTook, youTook] = parts('BOND:IT');
  check(`Feral Bond: a blow on you, ${pct(fx('feral_bond', 'share'))} of it on your companion, in its own health at what a blow is to yours`,
    near(Number(left), 0.1 * (1 - fx('feral_bond', 'share')), 1e-9) && near(Number(took), (0.1 * fx('feral_bond', 'share')) / 0.012, 1e-4)
      && /every blow on you or on .+ is split between you\.$/.test(line), island('BOND:ME'));
  check('and a blow on it, your share of it off your health', near(Number(itTook), 10 * (1 - fx('feral_bond', 'share')), 1e-4)
    && near(Number(youTook), 10 * fx('feral_bond', 'share') * 0.012, 1e-9), island('BOND:IT'));
}
check('the six passives fold on the island to what they fold to in the browser',
  island('FOLDED') === Object.keys(FOLD).filter((k) => /^(kept|leash|sight|bond):/.test(k)).sort()
    .map((k) => `${k}=${FOLD[k]}`).join(';'), island('FOLDED'));
{
  const kept = JSON.parse(island('KEPT')) as Record<string, number>;
  check('and the companion wears its keeper’s numbers', ['kept:hardy', 'kept:soak', 'kept:speed', 'kept:haste'].every((key) => kept[key] === FOLD[key]),
    island('KEPT'));
}
{
  const [before, after] = parts('HIDE').map(Number);
  check(`Thick Hide: ${pct(FOLD['kept:hardy'] - 1)} more health, as the browser counts it`,
    before === SPECIES[KIN].health && after === Math.round(SPECIES[KIN].health * FOLD['kept:hardy']), island('HIDE'));
}
{
  const [soak, speed, haste, tough] = parts('MULS').map(Number);
  check(`Hardy Stock ${pct(1 - FOLD['kept:soak'])} less taken, Fleet ${pct(FOLD['kept:speed'] - 1)} faster, Quick Paws ${pct(FOLD['kept:haste'] - 1)} `
    + 'more often, and nothing else moved',
    near(soak, FOLD['kept:soak']) && near(speed, FOLD['kept:speed']) && near(haste, FOLD['kept:haste']) && tough === 1, island('MULS'));
  const [hp, s2, sp2, h2] = parts('CRATED').map(Number);
  check('and none of it on the same beast in a crate', hp === SPECIES[KIN].health && s2 === 1 && sp2 === 1 && h2 === 1, island('CRATED'));
  check(`Quick Paws: its next blow ${(COMPANION_BLOW / FOLD['kept:haste']).toFixed(3)} s off rather than ${COMPANION_BLOW}`,
    near(Number(island('QUICK')), COMPANION_BLOW / FOLD['kept:haste'], 1e-6), island('QUICK'));
}
{
  const [found, wanted] = parts('SIGHT');
  const [kept, fighting] = parts('LEASH');
  check(`Long Leash: on the attack, it goes for a creature ${(COMPANION_SIGHT + 8) / 2} tiles from you, which it did not`,
    island('SIGHT:BEFORE') === 'none' && found === wanted, `${island('SIGHT:BEFORE')} / ${island('SIGHT')}`);
  check(`and keeps up a fight ${(COMPANION_LEASH + 14) / 2} tiles from you, which it gave up`,
    island('LEASH:BEFORE') === 'none' && kept === fighting, `${island('LEASH:BEFORE')} / ${island('LEASH')}`);
  check('and an order says the new reach', island('ORDER:BEFORE') === `It is more than ${COMPANION_LEASH} tiles from you.`
    && island('ORDER') === `It is more than ${FOLD['leash:companion']} tiles from you.`, `${island('ORDER:BEFORE')} / ${island('ORDER')}`);
}
{
  const [left, took] = parts('SHARED').map(Number);
  const [leftFar, tookFar] = parts('SHARED:FAR').map(Number);
  check(`Shared Wounds: ${pct(FOLD['bond:share'])} of a blow on you taken by it within ${FOLD['bond:reach']} tiles, as any blow on it is taken`,
    near(left, 0.1 * (1 - FOLD['bond:share']), 1e-9) && near(took, ((0.1 * FOLD['bond:share']) / 0.012) * FOLD['kept:soak'], 1e-4),
    island('SHARED'));
  check('and none beyond them', near(leftFar, 0.1, 1e-12) && tookFar === 0, island('SHARED:FAR'));
  check('and on the way in, a blow that lands on you', island('SHARED:BLOW') === 'true|true', island('SHARED:BLOW'));
}
check('Call of the Wild: never a monster', island('WILD:MONSTER') === 'The ogre cannot be tamed.', island('WILD:MONSTER'));
check(`and no further than ${fx('call_of_the_wild', 'reach')} tiles`, island('WILD:FAR') === 'The rowl is more than 4 tiles away.', island('WILD:FAR'));
check('and never above your taming', island('WILD:SKILL') === 'The rowl wants 35 taming; you have 10.', island('WILD:SKILL'));
check('and never without room for it', /already follows you\. Carry an empty creature crate to tame another: it goes into the crate\.$/.test(island('WILD:ROOM')),
  island('WILD:ROOM'));
{
  const [mode, mine, line] = parts('WILD:CRATED');
  check('into the crate in your pack when something follows you already', mode === 'stored' && mine === 'true'
    && /the rowl trusts you\. It goes into the creature crate in your pack\.$/.test(line), island('WILD:CRATED'));
  const [mode2, mine2, line2] = parts('WILD:FOLLOWS');
  check('and to follow you when nothing does', mode2 === 'active' && mine2 === 'true' && /the ulva trusts you\. .+ now follows you\.$/.test(line2),
    island('WILD:FOLLOWS'));
}
{
  const [cast, stamina, rest] = parts('PAID');
  check(`the door charges ${pct(spell('lick_wounds').cost)} of your stamina and rests it ${spell('lick_wounds').rest} s`,
    cast === 'beastmaster_lick_wounds' && near(Number(stamina), 1 - spell('lick_wounds').cost, 1e-9) && rest !== 'none', island('PAID'));
  check('and will not call it again until it has rested', /can be called again in \d+ seconds\.$/.test(island('RESTING')), island('RESTING'));
}
check('no function is open to a player but the doors', island('OPEN') === '0', island('OPEN'));

/* ---- The browser's half ----------------------------------------------------- */

check(`each of the ${CLASS_TIER_AT.length} tiers offers two spells and a passive`,
  TIERS.beastmaster.length === CLASS_TIER_AT.length && TIERS.beastmaster.every((row) => row.length === 3
    && row.filter((num) => SPELLS.some((s) => s.num === num)).length === 2), JSON.stringify(TIERS.beastmaster));
check('every spell that wants a companion says so first, in the words its refusal uses',
  SPELLS.every((s) => !s.needs || s.note.startsWith(`${NEEDS_SAID[s.needs].has}: `))
    && SPELLS.filter((s) => s.needs === 'companion').length === 11);
check('and every spell\'s perk says what it costs before what it does',
  SPELLS.every((s) => PERK_BY_ID.get(s.id)!.note.startsWith('Spell') && PERK_BY_ID.get(s.id)!.note.endsWith(s.note)));
check('the browser reads the keeper’s numbers on a companion following them, and on no other beast',
  ['hardy', 'soak', 'speed', 'haste'].every((ch) => companionMul({ mode: 'active', kept: FOLD }, ch as 'hardy') === FOLD[`kept:${ch}`])
    && companionMul({ mode: 'stored', kept: FOLD }, 'hardy') === 1 && companionMul({ mode: 'active', kept: FOLD }, 'tough') === 1);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Beastmaster — ${ok.length} of ${ok.length}`);
