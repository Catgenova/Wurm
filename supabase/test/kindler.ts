/**
 * The Kindler: twelve spells and six passives in six tiers that open on the
 * trade's own level, on the island (`the_kindler.sql`) and in the browser's
 * rulebook (`talents.ts`, `perks.ts`).
 *
 * What this asks:
 *
 *   * both sides hold the same twelve spells, field for field, what each wants
 *     -- a garnet or ruby focus in your pack -- included, and the same tiers;
 *   * the focus cast out of is the best of the school's stones you carry, and
 *     fire at 100% is an Ember out of it, to the last bit on both sides;
 *   * every spell's fire is that at the share it names, only within its reach
 *     and no further; a burn is its share of the creature's health a second
 *     for as long as it says, and marks it burning; a Scald slows it; a Heat
 *     Seeker finds the one with the least of its health left; a Stoke waits
 *     for the next fire and is spent by it; a Firebrand doubles a burn; a
 *     Combust takes what a burn had left at once and puts it out; a Blaze
 *     Aura burns a round at a time on the clock; a Meteor's splash and a
 *     Firestorm reach every enemy within them and nothing further;
 *   * the fire teaches the trade and the school;
 *   * the door charges its stamina and its rest;
 *   * and every passive moves the number it names at the rule it changes, on
 *     the island, with the browser's fold the island's and its burn the same.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
// The rulebook first: what the browser's half reads is a part of it and cannot be loaded on its own.
import '../../src/game/actions';
import { spellDef, spellForce } from '../../src/game/arcane';
import { CLASS_TIER_AT } from '../../src/game/classes';
import { SPECIES, type Creature } from '../../src/game/creatures';
import { Game } from '../../src/game/game';
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
const pct = (x: number): string => `${Number((x * 100).toFixed(1))}%`;

const SPELLS = classSpellsOf('kindler');
const spell = (slug: string): ClassSpellDef => {
  const s = CLASS_SPELL_BY_ID.get(`kindler_${slug}`);
  if (!s) throw new Error(`no kindler_${slug}`);
  return s;
};
const fx = (slug: string, k: string): number => spell(slug).fx[k];
const PASSIVES = perksOf('kindler').filter((p) => !CLASS_SPELL_BY_ID.has(p.id));
/** What the six passives fold to, which is what the browser reads a Kindler's numbers from. */
const FOLD = foldPerks(PASSIVES.map((p) => p.id));
const FIRST_CLASS_SLOT = SPELL_BAR.indexOf('class');
const EMBER = spellDef('ember')!;
/** The kindling the caster has, and the cut of the stone cast out of: a ruby, better than the garnet beside it. */
const KINDLING = 60;
const CUT = 80;
/** A creature with health enough that no spell here finishes it, measured in shares of an Ember. */
const FOE = 'ogre';

/** A spell's row as the island prints it and as the browser would: every field, the numbers by name. */
const rowOf = (s: ClassSpellDef): string =>
  [s.id, s.class, s.num, s.name, s.cost, s.rest, s.on.join('+'),
    Object.keys(s.fx).sort().map((k) => `${k}=${s.fx[k]}`).join(';'), s.note, s.needs ?? '-'].join('¦');

const ON_ME = `jsonb_build_object('kind', 'self', 'uid', w.uid)`;
const ON = (id: string): string => `jsonb_build_object('kind', 'enemy', 'id', ${id})`;
/** A wild creature put down at a spot, alike in everything that has a say in a fight, and doing nothing of its own. */
const SPAWN = (v: string, x: string, y: string): string => `
  ${v} := creature_spawn(w.world_id, '${FOE}', ${x}, ${y}, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = null, brawl = null, enemy = null, hunt_again = null,
         settled_at = now(), until = now() + interval '1 hour', windup_at = null, bleed_rate = null, bleed_until = null
   where world_id = w.world_id and id = ${v};
  update creature set health = max_health(creature) where world_id = w.world_id and id = ${v};`;
/** Creatures' health put back, their burns and slows gone and their turns pushed off again, between one spell and the next. */
const FRESH = (ids: string): string => `
  update creature set health = max_health(creature), settled_at = now(), until = now() + interval '1 hour', brawl = null,
         hunting = null, windup_at = null, bleed_rate = null, bleed_until = null, hurt_at = null, slow = null, slow_until = null
   where world_id = w.world_id and id in (${ids});
  delete from class_mark where world_id = w.world_id and creature_id in (${ids});`;
/**
 * Fire at 100% as it stands, read again before every spell measured: each cast teaches the school (`skill_raise`), so the
 * kindling a spell is cast at is a little more than the last one's.
 */
const FORCE_NOW = `v_force := spell_force(w.world_id, w.uid, (select d from spell_def d where id = 'ember'), kindler_focus(w.world_id, w.uid));`;
/** What a creature has lost, as a share of fire at 100%. */
const LOST = (id: string): string =>
  `(select (max_health(cr) - cr.health) / v_force from creature cr where cr.world_id = w.world_id and cr.id = ${id})`;
/** Its burn: its share of its health a second, and how long it has left to run. */
const BURN = (id: string): string =>
  `(select coalesce((cr.bleed_rate / max_health(cr))::text, '-') || '|' || coalesce(extract(epoch from cr.bleed_until - now())::text, '-')
           || '|' || class_burning(w.world_id, ${id})::text
      from creature cr where cr.world_id = w.world_id and cr.id = ${id})`;
const ALL = 'a, b, c, e, g, h';

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w record; v_px double precision; v_py double precision; r jsonb; f bigint;
        a int; b int; c int; e int; g int; h int;
        v_force double precision; m0 double precision; m1 double precision; h0 double precision; h1 double precision;
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
      (values ('kindling', ${KINDLING}::double precision), ('fighting', 100), ('body_control', 1)) sv(s, v)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  delete from event where uid = w.uid;
  delete from player_node where world_id = w.world_id and uid = w.uid;
  delete from player_spell where world_id = w.world_id and uid = w.uid;
  delete from creature where world_id = w.world_id and to_x between v_px - 45 and v_px + 45 and to_y between v_py - 45 and v_py + 45;
  delete from creature where world_id = w.world_id and (hunting = w.uid or keeper = w.uid);
  delete from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def = 'focus';
  delete from class_mark where world_id = w.world_id;
  delete from faith_owed where world_id = w.world_id;
  delete from faith_zone where world_id = w.world_id;
  delete from caller where uid = w.uid;
  perform set_config('request.jwt.claims', json_build_object('sub', w.uid)::text, true);

  /* ---- The rows ---- */
  insert into said select 'SPELL:' || id, id || '¦' || class || '¦' || num || '¦' || name || '¦' || cost || '¦' || rest || '¦'
      || array_to_string(on_what, '+') || '¦' || coalesce((select string_agg(e2.k || '=' || e2.v, ';' order by e2.k) from jsonb_each_text(fx) e2(k, v)), '')
      || '¦' || note || '¦' || coalesce(needs, '-')
    from class_spell where class = 'kindler';

  insert into said values ('TAKE', coalesce(rpc_take_class(w.world_id, 'kindler')->>'why', 'took'));
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, cs.id from class_spell cs where cs.class = 'kindler'
    on conflict do nothing;

  /* ---- No focus of the school's stones, no spell; one worn through is none; and with one, the best of them ---- */
  insert into said values ('NEEDS:NONE', coalesce(spell_cast_refusal(w.world_id, w.uid, 'kindler_scorch'), 'ready'));
  perform give(w.world_id, w.uid, 'focus', 1, 95, 'Sapphire');
  insert into said values ('NEEDS:SAPPHIRE', coalesce(spell_cast_refusal(w.world_id, w.uid, 'kindler_scorch'), 'ready'));
  f := give(w.world_id, w.uid, 'focus', 1, 50, 'Garnet');
  update item set dmg = 100 where id = f;
  insert into said values ('NEEDS:SPENT', coalesce(spell_cast_refusal(w.world_id, w.uid, 'kindler_scorch'), 'ready'));
  update item set dmg = 20 where id = f;
  insert into said values ('NEEDS:GARNET', coalesce(spell_cast_refusal(w.world_id, w.uid, 'kindler_scorch'), 'ready'));
  perform give(w.world_id, w.uid, 'focus', 1, ${CUT}, 'Ruby');
  insert into said select 'FOCUS', lower((kindler_focus(w.world_id, w.uid)).extra) || '|' || (kindler_focus(w.world_id, w.uid)).ql;
  v_force := spell_force(w.world_id, w.uid, (select d from spell_def d where id = 'ember'), kindler_focus(w.world_id, w.uid));
  insert into said values ('FORCE', v_force::text);
  insert into said values ('FIRE_AT', kindler_fire_at(w.world_id, w.uid)::text);

  /* ---- With nothing near: a Heat Seeker and a Firestorm are refused ---- */
  insert into said values ('SEEK:NONE', class_spell_cast(w.world_id, w.uid, 'kindler_heat_seeker', ${ON_ME})->>'why');
  insert into said values ('STORM:NONE', class_spell_cast(w.world_id, w.uid, 'kindler_firestorm', ${ON_ME})->>'why');

  -- Six of them: within two tiles, within eight, within ten, beyond ten, and two beside the second.
  ${SPAWN('a', 'v_px + 1.5', 'v_py')}
  ${SPAWN('b', 'v_px + 3', 'v_py')}
  ${SPAWN('c', 'v_px + 9', 'v_py')}
  ${SPAWN('e', 'v_px + 11', 'v_py')}
  ${SPAWN('g', 'v_px + 3', 'v_py + 2.5')}
  ${SPAWN('h', 'v_px + 3', 'v_py + 3.5')}
  insert into said select 'IDS', a || ',' || b || ',' || c || ',' || e || ',' || g || ',' || h;

  /* ---- Flash Fire: its share of fire, within its reach and no further ---- */
  ${FORCE_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'kindler_flash_fire', ${ON('a')});
  insert into said select 'FLASH', ${LOST('a')} || '|' || coalesce(r->>'said', r->>'why');
  insert into said values ('FLASH:FAR', class_spell_cast(w.world_id, w.uid, 'kindler_flash_fire', ${ON('b')})->>'why');

  /* ---- The fire teaches the trade, and every spell the school ---- */
  ${FRESH(ALL)}
  select class_level into m0 from player where world_id = w.world_id and uid = w.uid;
  select value into h0 from skill where world_id = w.world_id and uid = w.uid and id = 'kindling';
  perform class_spell_cast(w.world_id, w.uid, 'kindler_flash_fire', ${ON('a')});
  insert into said select 'LEARN', (pl.class_level > m0)::text || '|'
      || ((select value from skill where world_id = w.world_id and uid = w.uid and id = 'kindling') > h0)::text
    from player pl where pl.world_id = w.world_id and pl.uid = w.uid;

  /* ---- Scorch: its share of fire, and a burn ---- */
  ${FRESH(ALL)}
  ${FORCE_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'kindler_scorch', ${ON('b')});
  insert into said select 'SCORCH', ${LOST('b')} || '|' || ${BURN('b')} || '|' || coalesce(r->>'said', r->>'why');
  insert into said values ('SCORCH:FAR', class_spell_cast(w.world_id, w.uid, 'kindler_scorch', ${ON('c')})->>'why');

  /* ---- Heat Seeker: on the one with the least of its health left within its reach, and not one beyond it ---- */
  ${FRESH(ALL)}
  update creature set health = max_health(creature) * 0.8 where world_id = w.world_id and id = a;
  update creature set health = max_health(creature) * 0.5 where world_id = w.world_id and id = b;
  update creature set health = max_health(creature) * 0.2 where world_id = w.world_id and id = e;
  ${FORCE_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'kindler_heat_seeker', ${ON_ME});
  insert into said select 'SEEK', (select (max_health(cr) * 0.5 - cr.health) / v_force from creature cr where cr.world_id = w.world_id and cr.id = b)
      || '|' || (select cr.health / max_health(cr) from creature cr where cr.world_id = w.world_id and cr.id = a)
      || '|' || (select cr.health / max_health(cr) from creature cr where cr.world_id = w.world_id and cr.id = e)
      || '|' || coalesce(r->>'said', r->>'why');

  /* ---- Scald: its share of fire, and slowed ---- */
  ${FRESH(ALL)}
  ${FORCE_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'kindler_scald', ${ON('b')});
  insert into said select 'SCALD', ${LOST('b')} || '|' || cr.slow || '|' || extract(epoch from cr.slow_until - now()) || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id = b;

  /* ---- Immolate: its burn and no fire; a Stoke waits through it, and the next fire spends it ---- */
  ${FRESH(ALL)}
  r := class_spell_cast(w.world_id, w.uid, 'kindler_stoke', ${ON_ME});
  insert into said values ('STOKE:SAID', coalesce(r->>'said', r->>'why'));
  r := class_spell_cast(w.world_id, w.uid, 'kindler_immolate', ${ON('b')});
  insert into said select 'IMMOLATE', ${LOST('b')} || '|' || ${BURN('b')} || '|' || coalesce(r->>'said', r->>'why');
  insert into said select 'STOKE:WAITS', (blessings ? 'stoke')::text from player where world_id = w.world_id and uid = w.uid;
  ${FORCE_NOW}
  perform class_spell_cast(w.world_id, w.uid, 'kindler_flash_fire', ${ON('a')});
  insert into said select 'STOKE', ${LOST('a')} || '|' || (blessings ? 'stoke')::text from player where world_id = w.world_id and uid = w.uid;

  /* ---- Combust: what the burn had left, at its share, at once; and out, bleeding and all ---- */
  r := class_spell_cast(w.world_id, w.uid, 'kindler_combust', ${ON('b')});
  insert into said select 'COMBUST', (max_health(cr) - cr.health) || '|' || coalesce(cr.bleed_rate::text, 'none') || '|'
      || class_burning(w.world_id, b)::text || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id = b;
  insert into said values ('COMBUST:COLD', class_spell_cast(w.world_id, w.uid, 'kindler_combust', ${ON('g')})->>'why');

  /* ---- Firebrand: every burn you start lasts its times as long ---- */
  ${FRESH(ALL)}
  r := class_spell_cast(w.world_id, w.uid, 'kindler_firebrand', ${ON_ME});
  perform class_spell_cast(w.world_id, w.uid, 'kindler_immolate', ${ON('b')});
  insert into said select 'BRAND', ${BURN('b')} || '|' || coalesce(r->>'said', r->>'why');
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;

  /* ---- Inferno Bolt: its share of fire as far as it says, and a burn ---- */
  ${FRESH(ALL)}
  ${FORCE_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'kindler_inferno_bolt', ${ON('c')});
  insert into said select 'INFERNO', ${LOST('c')} || '|' || ${BURN('c')} || '|' || coalesce(r->>'said', r->>'why');

  /* ---- Meteor: its share on the one cast at, its splash on every other within its width of it, and nothing further ---- */
  ${FRESH(ALL)}
  ${FORCE_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'kindler_meteor', ${ON('b')});
  insert into said select 'METEOR', ${LOST('b')} || '|' || ${LOST('a')} || '|' || ${LOST('g')} || '|' || ${LOST('h')} || '|' || ${LOST('c')}
      || '|' || coalesce(r->>'said', r->>'why');

  /* ---- Firestorm: its share of fire on every enemy within its reach of you, each burning; nothing further ---- */
  ${FRESH(ALL)}
  ${FORCE_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'kindler_firestorm', ${ON_ME});
  insert into said select 'STORM', string_agg(cr.id || ':' || ((max_health(cr) - cr.health) / v_force) || ':'
      || coalesce((cr.bleed_rate / max_health(cr))::text, '-'), ',' order by cr.id) || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id in (${ALL});

  /* ---- Blaze Aura: its fire a second on every enemy within its reach, a round at a time on the clock; gone when it is up ---- */
  ${FRESH(ALL)}
  ${FORCE_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'kindler_blaze_aura', ${ON_ME});
  insert into said values ('AURA:SAID', coalesce(r->>'said', r->>'why'));
  -- Two seconds on.
  update player set blessings = jsonb_set(jsonb_set(blessings, '{blaze_aura,at}', to_jsonb(now() - interval '2 seconds')),
                                          '{blaze_aura,from}', to_jsonb(now() - interval '2 seconds'))
   where world_id = w.world_id and uid = w.uid;
  insert into said values ('AURA:N', class_aura_tick(w.world_id)::text);
  insert into said select 'AURA', ${LOST('a')} || '|' || ${LOST('b')} || '|'
      || ((blessings->'blaze_aura'->>'at')::timestamptz = now())::text from player where world_id = w.world_id and uid = w.uid;
  -- And once its time is up, nothing more, and gone.
  update player set blessings = jsonb_set(blessings, '{blaze_aura,until}', to_jsonb(now() - interval '1 second'))
   where world_id = w.world_id and uid = w.uid;
  select health into h1 from creature where world_id = w.world_id and id = a;
  perform class_aura(w.world_id, w.uid);
  insert into said select 'AURA:GONE', (blessings ? 'blaze_aura')::text || '|'
      || ((select health from creature where world_id = w.world_id and id = a) = h1)::text
    from player where world_id = w.world_id and uid = w.uid;
  insert into said select 'AURA:CLOCK', (strpos(prosrc, 'class_aura_tick(w.id)') > 0)::text from pg_proc where proname = 'world_tick';
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;

  /* ---- The door: its stamina and its rest ---- */
  ${FRESH(ALL)}
  delete from caller where uid = w.uid;
  update player set used_at = '{}'::jsonb, stats = jsonb_set(stats, '{stamina}', '1') where world_id = w.world_id and uid = w.uid;
  perform spell_bar_put(w.world_id, w.uid, ${FIRST_CLASS_SLOT}, 'kindler_firebrand');
  r := rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'self'));
  insert into said select 'PAID', coalesce(r->>'cast', r->>'why') || '|' || (stats->>'stamina') || '|' || (blessings ? 'momentum')::text
    from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('RESTING', rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'self'))->>'why');
  update player set blessings = '{}'::jsonb, used_at = '{}'::jsonb, stats = jsonb_set(stats, '{stamina}', '1')
   where world_id = w.world_id and uid = w.uid;

  /* ---- The passives ---- */
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, k2.id from class_perk k2
    where k2.class = 'kindler' and not exists (select 1 from class_spell cs where cs.id = k2.id)
    on conflict do nothing;
  perform class_fold(w.world_id, w.uid);
  insert into said select 'FOLDED', coalesce((select string_agg(e2.k || '=' || e2.v, ';' order by e2.k collate "C")
      from jsonb_each_text(class_mul->'fx') e2(k, v) where e2.k ~ '^(retort|cast|momentum|burn|ward):'), 'none')
    from player where world_id = w.world_id and uid = w.uid;

  -- Searing Burn and Lingering Burn: an Immolate's burn hotter and longer.
  ${FRESH(ALL)}
  perform class_spell_cast(w.world_id, w.uid, 'kindler_immolate', ${ON('b')});
  insert into said select 'HOTTER', ${BURN('b')};

  -- Burning Retort: a creature that lands a blow on you is owed a burn, lit once its turn is written.
  ${FRESH(ALL)}
  update player set stats = stats || jsonb_build_object('hurtBy', c, 'hurtAt', now() - interval '1 hour', 'health', 1)
   where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.05, 'The ogre bites you', 'bite');
  insert into said select 'RETORT:OWED', coalesce((select val || '|' || (by_uid = w.uid)::text from class_mark
      where world_id = w.world_id and creature_id = c and kind = 'retort'), 'none');
  update player set act = null, act_target = null, act_ends = null, act_queue = '[]', wounds = '[]'::jsonb,
         stats = (stats - 'hurtBy' - 'hurtAt') || jsonb_build_object('health', 1)
   where world_id = w.world_id and uid = w.uid;
  perform class_owed_pay(w.world_id, c);
  insert into said select 'RETORT', ${BURN('c')} || '|'
      || (not exists (select 1 from class_mark where world_id = w.world_id and creature_id = c and kind = 'retort'))::text;

  -- Flame Ward: less from the one burning than from one that is not, the same blow.
  update player set stats = stats || jsonb_build_object('hurtBy', c, 'hurtAt', now() - interval '1 hour', 'health', 1)
   where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.05, 'The ogre bites you', 'bite');
  select 1 - (stats->>'health')::double precision into m0 from player where world_id = w.world_id and uid = w.uid;
  update player set act = null, act_target = null, act_ends = null, act_queue = '[]', wounds = '[]'::jsonb,
         stats = (stats - 'hurtBy' - 'hurtAt') || jsonb_build_object('health', 1, 'hurtBy', e, 'hurtAt', now() - interval '1 hour')
   where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.05, 'The ogre bites you', 'bite');
  select 1 - (stats->>'health')::double precision into m1 from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('WARD', m0 || '|' || m1);
  update player set act = null, act_target = null, act_ends = null, act_queue = '[]', wounds = '[]'::jsonb,
         stats = (stats - 'hurtBy' - 'hurtAt') || jsonb_build_object('health', 1)
   where world_id = w.world_id and uid = w.uid;

  -- Deep Breath: the door charges less, and a refusal says the less.
  ${FRESH(ALL)}
  delete from caller where uid = w.uid;
  update player set blessings = '{}'::jsonb, used_at = '{}'::jsonb, stats = jsonb_set(stats, '{stamina}', '1')
   where world_id = w.world_id and uid = w.uid;
  r := rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'self'));
  insert into said select 'BREATH', coalesce(r->>'cast', r->>'why') || '|' || (stats->>'stamina') from player where world_id = w.world_id and uid = w.uid;
  update player set stats = jsonb_set(stats, '{stamina}', '0.1'), used_at = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  insert into said values ('BREATH:SHORT', coalesce(spell_cast_refusal(w.world_id, w.uid, 'kindler_firebrand'), 'ready'));
  update player set stats = jsonb_set(stats, '{stamina}', '1') where world_id = w.world_id and uid = w.uid;

  -- Blaze Momentum: that cast built it; the next fire is larger by it; it stops at its most.
  ${FORCE_NOW}
  insert into said select 'MOMENTUM', (blessings->'momentum'->>'more') || '|'
      || extract(epoch from (blessings->'momentum'->>'until')::timestamptz - now()) || '|' || (kindler_fire_at(w.world_id, w.uid) / v_force)
    from player where world_id = w.world_id and uid = w.uid;
  perform class_spell_cast(w.world_id, w.uid, 'kindler_flash_fire', ${ON('a')});
  insert into said values ('MOMENTUM:FIRE', ${LOST('a')}::text);
  perform class_momentum(w.world_id, w.uid);
  perform class_momentum(w.world_id, w.uid);
  perform class_momentum(w.world_id, w.uid);
  insert into said select 'MOMENTUM:MOST', blessings->'momentum'->>'more' from player where world_id = w.world_id and uid = w.uid;
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
/** A burn as `BURN` prints it: its share a second, its seconds left, and whether it marks the creature burning. */
const burnOf = (k: string, at = 0): { each: number; secs: number; burning: boolean } => {
  const p = parts(k);
  return { each: Number(p[at]), secs: Number(p[at + 1]), burning: p[at + 2] === 'true' };
};

/* ---- What came back ------------------------------------------------------ */

{
  const wrong = SPELLS.filter((s) => island(`SPELL:${s.id}`) !== rowOf(s));
  check(`both sides hold the Kindler's ${SPELLS.length} spells, field for field, what each wants included`,
    SPELLS.length === 12 && wrong.length === 0 && [...said.keys()].filter((k) => k.startsWith('SPELL:')).length === SPELLS.length,
    wrong.length ? `island ${island(`SPELL:${wrong[0].id}`)}, browser ${rowOf(wrong[0])}` : `${SPELLS.length} of them`);
}
check('the trade is taken up', island('TAKE') === 'took', island('TAKE'));
check('a Kindler spell is refused with no focus in your pack, in the words its note uses',
  island('NEEDS:NONE') === `Scorch wants ${NEEDS_SAID.kindling.wants}.`, island('NEEDS:NONE'));
check('and with a focus of another school\'s stone, or one worn through',
  island('NEEDS:SAPPHIRE') === island('NEEDS:NONE') && island('NEEDS:SPENT') === island('NEEDS:NONE'),
  `${island('NEEDS:SAPPHIRE')} / ${island('NEEDS:SPENT')}`);
check('and made with a garnet', island('NEEDS:GARNET') === 'ready', island('NEEDS:GARNET'));
check('the focus cast out of is the best cut of the school\'s stones you carry', island('FOCUS') === `ruby|${CUT}`, island('FOCUS'));
check(`fire at 100% is an Ember out of it, to the last bit on both sides (${KINDLING} kindling, QL ${CUT})`,
  near(Number(island('FORCE')), spellForce(EMBER, KINDLING, CUT, 1)) && near(Number(island('FIRE_AT')), Number(island('FORCE'))),
  `island ${island('FORCE')}, browser ${spellForce(EMBER, KINDLING, CUT, 1)}`);
check('a Heat Seeker and a Firestorm with nothing near are refused',
  island('SEEK:NONE') === `Nothing is within ${fx('heat_seeker', 'reach')} tiles of you to strike.`
    && island('STORM:NONE') === `Nothing is within ${fx('firestorm', 'reach')} tiles of you to strike.`,
  `${island('SEEK:NONE')} / ${island('STORM:NONE')}`);
const [A, B, C, E, G, H] = island('IDS').split(',');
{
  const [ratio, line] = parts('FLASH');
  check(`Flash Fire: fire at ${pct(fx('flash_fire', 'fire'))}`,
    near(Number(ratio), fx('flash_fire', 'fire'), 1e-4) && /^Flash Fire: the fire takes \d+ off the ogre\. It is down to \d+ of 170\.$/.test(line),
    island('FLASH'));
  check(`and no further than ${fx('flash_fire', 'reach')} tiles`, island('FLASH:FAR') === `The ogre is more than ${fx('flash_fire', 'reach')} tiles away.`,
    island('FLASH:FAR'));
}
check('the fire teaches the Kindler\'s trade, and the cast the school', island('LEARN') === 'true|true', island('LEARN'));
{
  const ratio = Number(parts('SCORCH')[0]);
  const burn = burnOf('SCORCH', 1);
  check(`Scorch: fire at ${pct(fx('scorch', 'fire'))}, and a burn of ${pct(fx('scorch', 'each'))} of its health a second for ${fx('scorch', 'secs')} s `
    + 'that marks it burning',
    near(ratio, fx('scorch', 'fire'), 1e-4) && near(burn.each, fx('scorch', 'each'), 1e-6) && near(burn.secs, fx('scorch', 'secs'), 1e-6) && burn.burning
      && / It burns 1% of its health a second for 8 s\.$/.test(parts('SCORCH')[4]), island('SCORCH'));
  check(`and no further than ${fx('scorch', 'reach')} tiles`, island('SCORCH:FAR') === `The ogre is more than ${fx('scorch', 'reach')} tiles away.`,
    island('SCORCH:FAR'));
}
{
  const [ratio, aLeft, eLeft, line] = parts('SEEK');
  check(`Heat Seeker: fire at ${pct(fx('heat_seeker', 'fire'))} on the one with the least of its health left within ${fx('heat_seeker', 'reach')} tiles, `
    + 'and not a worse-hurt one beyond them',
    near(Number(ratio), fx('heat_seeker', 'fire'), 1e-4) && near(Number(aLeft), 0.8, 1e-6) && near(Number(eLeft), 0.2, 1e-6)
      && /^Heat Seeker: the fire takes \d+ off the ogre\./.test(line), island('SEEK'));
}
{
  const [ratio, slow, secs, line] = parts('SCALD');
  check(`Scald: fire at ${pct(fx('scald', 'fire'))}, and ${pct(fx('scald', 'pace'))} of its pace for ${fx('scald', 'secs')} s`,
    near(Number(ratio), fx('scald', 'fire'), 1e-4) && near(Number(slow), fx('scald', 'pace'), 1e-6) && near(Number(secs), fx('scald', 'secs'), 1e-6)
      && / For 6 s it goes at 60% of its pace\.$/.test(line), island('SCALD'));
}
{
  const lost = Number(parts('IMMOLATE')[0]);
  const burn = burnOf('IMMOLATE', 1);
  check(`Immolate: no fire, and a burn of ${pct(fx('immolate', 'each'))} of its health a second for ${fx('immolate', 'secs')} s`,
    lost === 0 && near(burn.each, fx('immolate', 'each'), 1e-6) && near(burn.secs, fx('immolate', 'secs'), 1e-6) && burn.burning
      && parts('IMMOLATE')[4] === 'Immolate: the ogre catches. It burns 2% of its health a second for 15 s.', island('IMMOLATE'));
}
{
  const [ratio, waiting] = parts('STOKE');
  check(`Stoke: the next fire ${pct(fx('stoke', 'more') - 1)} larger, waiting through a spell with no fire and spent by the one with`,
    island('STOKE:WAITS') === 'true' && near(Number(ratio), fx('flash_fire', 'fire') * fx('stoke', 'more'), 1e-4) && waiting === 'false'
      && island('STOKE:SAID') === 'Stoke: the next spell of yours within 60 s that deals fire deals 50% more of it.',
    `${island('STOKE:SAID')} / ${island('STOKE:WAITS')} / ${island('STOKE')}`);
}
{
  const [lost, bleed, burning, line] = parts('COMBUST');
  const left = SPECIES[FOE].health * fx('immolate', 'each') * fx('immolate', 'secs');
  check(`Combust: ${pct(fx('combust', 'more'))} of what the burn had left (${left} of ${SPECIES[FOE].health}) at once, and out, bleeding and all`,
    near(Number(lost), left * fx('combust', 'more'), 1e-3) && bleed === 'none' && burning === 'false'
      && /^Combust: the burn on the ogre goes up at once, \d+ of it\. It is down to \d+ of 170\.$/.test(line), island('COMBUST'));
  check('and refused on one not burning', island('COMBUST:COLD') === 'The ogre is not burning.', island('COMBUST:COLD'));
}
{
  const burn = burnOf('BRAND');
  check(`Firebrand: a burn you start lasts ${fx('firebrand', 'long')} times as long while it holds`,
    near(burn.secs, fx('immolate', 'secs') * fx('firebrand', 'long'), 1e-6)
      && parts('BRAND')[3] === 'Firebrand: for 30 s every burn you start lasts twice as long.', island('BRAND'));
}
{
  const ratio = Number(parts('INFERNO')[0]);
  const burn = burnOf('INFERNO', 1);
  check(`Inferno Bolt: fire at ${pct(fx('inferno_bolt', 'fire'))} as far as ${fx('inferno_bolt', 'reach')} tiles, and a burn of `
    + `${pct(fx('inferno_bolt', 'each'))} for ${fx('inferno_bolt', 'secs')} s`,
    near(ratio, fx('inferno_bolt', 'fire'), 1e-4) && near(burn.each, fx('inferno_bolt', 'each'), 1e-6)
      && near(burn.secs, fx('inferno_bolt', 'secs'), 1e-6) && burn.burning, island('INFERNO'));
}
{
  const [onIt, nearA, nearG, farH, farC, line] = parts('METEOR');
  check(`Meteor: fire at ${pct(fx('meteor', 'fire'))} on the one cast at, ${pct(fx('meteor', 'splash'))} on every other within `
    + `${fx('meteor', 'wide')} tiles of it, and none further`,
    near(Number(onIt), fx('meteor', 'fire'), 1e-4) && near(Number(nearA), fx('meteor', 'splash'), 1e-4) && near(Number(nearG), fx('meteor', 'splash'), 1e-4)
      && Number(farH) === 0 && Number(farC) === 0 && / 2 more creatures are caught in it\.$/.test(line), island('METEOR'));
}
{
  const [list, line] = [island('STORM').split('|')[0], island('STORM').split('|')[1]];
  const by = new Map(list.split(',').map((x) => { const [id, ratio, each] = x.split(':'); return [id, { ratio: Number(ratio), each }]; }));
  const inside = [A, B, G, H].every((id) => near(by.get(id)!.ratio, fx('firestorm', 'fire'), 1e-4) && near(Number(by.get(id)!.each), fx('firestorm', 'each'), 1e-6));
  const outside = [C, E].every((id) => by.get(id)!.ratio === 0 && by.get(id)!.each === '-');
  check(`Firestorm: fire at ${pct(fx('firestorm', 'fire'))} and a burn of ${pct(fx('firestorm', 'each'))} on every enemy within `
    + `${fx('firestorm', 'reach')} tiles of you, and on nothing further`,
    inside && outside && line === 'Firestorm: 4 creatures are caught in it. They burn 2% of their health a second for 10 s.', island('STORM'));
}
{
  const [inside, outside, written] = parts('AURA');
  const [gone, still] = parts('AURA:GONE');
  check(`Blaze Aura: fire at ${pct(fx('blaze_aura', 'fire'))} a second on every enemy within ${fx('blaze_aura', 'reach')} tiles, `
    + 'a round at a time on the clock',
    island('AURA:N') === '1' && near(Number(inside), fx('blaze_aura', 'fire') * 2, 1e-4) && Number(outside) === 0 && written === 'true'
      && island('AURA:CLOCK') === 'true' && /^Blaze Aura: for 15 s everything wild within 2 tiles of you takes [\d.]+ of fire a second\.$/.test(island('AURA:SAID')),
    `${island('AURA:SAID')} / ${island('AURA:N')} / ${island('AURA')} / clock ${island('AURA:CLOCK')}`);
  check('and nothing once its time is up, and gone', gone === 'false' && still === 'true', island('AURA:GONE'));
}
{
  const [cast, stamina, momentum] = parts('PAID');
  check(`the door charges ${pct(spell('firebrand').cost)} of your stamina and rests it ${spell('firebrand').rest} s, with no momentum but a Kindler's`,
    cast === 'kindler_firebrand' && near(Number(stamina), 1 - spell('firebrand').cost, 1e-9) && momentum === 'false', island('PAID'));
  check('and will not call it again until it has rested', /can be called again in \d+ seconds\.$/.test(island('RESTING')), island('RESTING'));
}
check('the six passives fold on the island to what they fold to in the browser',
  island('FOLDED') === Object.keys(FOLD).filter((k) => /^(retort|cast|momentum|burn|ward):/.test(k)).sort()
    .map((k) => `${k}=${FOLD[k]}`).join(';'), island('FOLDED'));
{
  const burn = burnOf('HOTTER');
  check(`Searing Burn and Lingering Burn: an Immolate's burn ${pct(FOLD['burn:rate'] - 1)} more a second and ${pct(FOLD['burn:secs'] - 1)} longer`,
    near(burn.each, fx('immolate', 'each') * FOLD['burn:rate'], 1e-6) && near(burn.secs, fx('immolate', 'secs') * FOLD['burn:secs'], 1e-6),
    island('HOTTER'));
}
{
  const [owed, mine] = parts('RETORT:OWED');
  const burn = burnOf('RETORT');
  check(`Burning Retort: a creature that lands a blow on you is owed a burn, lit once its turn is written: ${pct(FOLD['retort:each'])} a second `
    + `for ${FOLD['retort:secs']} s, as a burn of yours`,
    near(Number(owed), FOLD['retort:each'], 1e-9) && mine === 'true' && near(burn.each, FOLD['retort:each'] * FOLD['burn:rate'], 1e-6)
      && near(burn.secs, FOLD['retort:secs'] * FOLD['burn:secs'], 1e-6) && burn.burning && parts('RETORT')[3] === 'true',
    `${island('RETORT:OWED')} / ${island('RETORT')}`);
}
{
  const [burning, cold] = parts('WARD').map(Number);
  check(`Flame Ward: ${pct(1 - FOLD['ward:burning'])} less from a blow of a creature that is burning, and the whole of one that is not`,
    near(burning, 0.05 * FOLD['ward:burning'], 1e-9) && near(cold, 0.05, 1e-9), island('WARD'));
}
{
  const [cast, stamina] = parts('BREATH');
  const cost = spell('firebrand').cost * FOLD['cast:cost'];
  check(`Deep Breath: the door charges ${pct(cost)} rather than ${pct(spell('firebrand').cost)}, and a refusal says so`,
    cast === 'kindler_firebrand' && near(Number(stamina), 1 - cost, 1e-9)
      && island('BREATH:SHORT') === `Firebrand costs ${pct(cost)} of your stamina; you have 10%.`, `${island('BREATH')} / ${island('BREATH:SHORT')}`);
}
{
  const [more, secs, fireAt] = parts('MOMENTUM').map(Number);
  check(`Blaze Momentum: a spell cast makes your fire ${pct(FOLD['momentum:step'])} larger for ${FOLD['momentum:secs']} s`,
    near(more, FOLD['momentum:step'], 1e-9) && near(secs, FOLD['momentum:secs'], 1e-6) && near(fireAt, 1 + FOLD['momentum:step'], 1e-9),
    island('MOMENTUM'));
  check('and the next fire is that much larger', near(Number(island('MOMENTUM:FIRE')), fx('flash_fire', 'fire') * (1 + FOLD['momentum:step']), 1e-4),
    island('MOMENTUM:FIRE'));
  check(`and it stops at ${pct(FOLD['momentum:most'])}`, near(Number(island('MOMENTUM:MOST')), FOLD['momentum:most'], 1e-9), island('MOMENTUM:MOST'));
}
check('no function is open to a player but the doors', island('OPEN') === '0', island('OPEN'));

/* ---- The browser's half ----------------------------------------------------- */

check(`each of the ${CLASS_TIER_AT.length} tiers offers two spells and a passive`,
  TIERS.kindler.length === CLASS_TIER_AT.length && TIERS.kindler.every((row) => row.length === 3
    && row.filter((num) => SPELLS.some((s) => s.num === num)).length === 2), JSON.stringify(TIERS.kindler));
check('every spell says first that it wants a focus, in the words its refusal uses',
  SPELLS.every((s) => s.needs === 'kindling' && s.note.startsWith(`${NEEDS_SAID.kindling.has}: `)));
check('and every spell\'s perk says what it costs before what it does',
  SPELLS.every((s) => PERK_BY_ID.get(s.id)!.note.startsWith('Spell') && PERK_BY_ID.get(s.id)!.note.endsWith(s.note)));
{
  // A burn of yours as the browser starts one (`Game.burn`): the island's `class_burn`, over the stronger of a bleed already running.
  const def = SPECIES[FOE];
  const at = { time: 100, perk: (k: string, d: number): number => FOLD[k] ?? d, creatures: { species: () => def } };
  const c = { health: def.health, traits: [], rare: null, mode: 'wild', bleedRate: 0, bleedUntil: 0 } as unknown as Creature;
  (Game.prototype.burn as (this: unknown, c: Creature, each: number, secs: number) => void).call(at, c, 0.01, 3);
  const fresh = { rate: c.bleedRate, until: c.bleedUntil, burn: c.burnUntil };
  c.bleedRate = def.health;
  c.bleedUntil = 101;
  (Game.prototype.burn as (this: unknown, c: Creature, each: number, secs: number) => void).call(at, c, 0.01, 3);
  check('the browser starts a burn as the island does: hotter and longer for its passives, the stronger bleed kept, to the later end',
    near(fresh.rate, def.health * 0.01 * FOLD['burn:rate'], 1e-9) && near(fresh.until, 100 + 3 * FOLD['burn:secs'], 1e-9) && fresh.burn === fresh.until
      && c.bleedRate === def.health && near(c.bleedUntil, 100 + 3 * FOLD['burn:secs'], 1e-9),
    JSON.stringify({ fresh, after: { rate: c.bleedRate, until: c.bleedUntil } }));
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Kindler — ${ok.length} of ${ok.length}`);
