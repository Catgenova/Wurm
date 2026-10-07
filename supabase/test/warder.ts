/**
 * The Warder: twelve spells and six passives in six tiers that open on the
 * trade's own level, on the island (`the_warder.sql`) and in the browser's
 * rulebook (`talents.ts`, `perks.ts`).
 *
 * What this asks:
 *
 *   * both sides hold the same twelve spells, field for field, what each wants
 *     -- a topaz or emerald focus in your pack -- included, and the same
 *     tiers;
 *   * a skin at 100% is an Aegis's force out of the focus at your warding, in
 *     hundredths of health, to the last bit on both sides, and the school's
 *     own Aegis lays one of its force in hundredths now;
 *   * a Ward, a Greater Ward and a Deep Ward lay their share over you, each
 *     over a smaller skin and none over a larger; a Ward Other and a Greater
 *     Ward Other over somebody within their reach and nobody beyond it; a
 *     Sanctuary over you and everybody within its reach and nobody beyond; a
 *     Thicken makes the next skin larger and is spent by it;
 *   * a Stoneskin and a Bastion of Stone take their share off every blow, the
 *     Bastion on everybody within its reach and nobody beyond; an Unbreakable
 *     lets no blow land; a Ward Burst breaks the skin for a point of damage a
 *     hundredth on every enemy within its reach and refuses with no skin or
 *     nothing near; a Ward Link lays a fresh skin over somebody whose skin of
 *     yours is used up, once;
 *   * the door charges its stamina and its rest, and the casts teach the
 *     trade and the school;
 *   * and every passive moves the number it names at the rule it changes.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
// The rulebook first: what the browser's half reads is a part of it and cannot be loaded on its own.
import '../../src/game/actions';
import { spellDef, spellForce } from '../../src/game/arcane';
import { CLASS_TIER_AT } from '../../src/game/classes';
import { SPELL_BAR } from '../../src/game/patrons';
import { foldPerks, perksOf, PERK_BY_ID, TIERS } from '../../src/game/perks';
import { CLASS_SPELL_BY_ID, classSpellsOf, NEEDS_SAID, skinOf, type ClassSpellDef } from '../../src/game/talents';

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

const SPELLS = classSpellsOf('warder');
const spell = (slug: string): ClassSpellDef => {
  const s = CLASS_SPELL_BY_ID.get(`warder_${slug}`);
  if (!s) throw new Error(`no warder_${slug}`);
  return s;
};
const fx = (slug: string, k: string): number => spell(slug).fx[k];
const PASSIVES = perksOf('warder').filter((p) => !CLASS_SPELL_BY_ID.has(p.id));
/** What the six passives fold to, which is what the browser reads a Warder's numbers from. */
const FOLD = foldPerks(PASSIVES.map((p) => p.id));
const FIRST_CLASS_SLOT = SPELL_BAR.indexOf('class');
const AEGIS = spellDef('aegis')!;
/** The warding the caster has, and the cut of the stone cast out of. */
const WARDING = 60;
const CUT = 80;
/** A blow of so much of somebody's health, as a creature's lands. */
const BLOW_RAW = 0.05;

/** A spell's row as the island prints it and as the browser would: every field, the numbers by name. */
const rowOf = (s: ClassSpellDef): string =>
  [s.id, s.class, s.num, s.name, s.cost, s.rest, s.on.join('+'),
    Object.keys(s.fx).sort().map((k) => `${k}=${s.fx[k]}`).join(';'), s.note, s.needs ?? '-'].join('¦');

const ON_ME = `jsonb_build_object('kind', 'self', 'uid', w.uid)`;
const ON = (uid: string): string => `jsonb_build_object('kind', 'player', 'uid', ${uid})`;
/** A wild creature put down at a spot, alike in everything that has a say in a fight, and doing nothing of its own. */
const SPAWN = (v: string, species: string, x: string, y: string): string => `
  ${v} := creature_spawn(w.world_id, '${species}', ${x}, ${y}, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = null, brawl = null, enemy = null, hunt_again = null, skills = '{}'::jsonb,
         settled_at = now(), until = now() + interval '1 hour', windup_at = null, bleed_rate = null, bleed_until = null,
         slow = null, slow_until = null, fight_blows = 0
   where world_id = w.world_id and id = ${v};
  update creature set health = max_health(creature) where world_id = w.world_id and id = ${v};`;
/** The four, and where each is put down off from you: two within a Ward Burst's reach and two beyond it. */
const SPOTS: [string, string, number, number][] = [
  ['a', 'ogre', 1.5, 0], ['b', 'roxxen', 2, 2], ['c', 'ogre', 9, 0], ['e', 'ogre', 5, 0],
];
const ALL = 'a, b, c, e';
/** Creatures put back as they were spawned, where they were spawned, every mark on them gone. */
const FRESH = `
  update creature cr set health = max_health(cr), settled_at = now(), until = now() + interval '1 hour', brawl = null,
         hunting = null, windup_at = null, bleed_rate = null, bleed_until = null, hurt_at = null, slow = null, slow_until = null,
         fight_blows = 0, from_x = v_px + p.dx, to_x = v_px + p.dx, from_y = v_py + p.dy, to_y = v_py + p.dy, leg_at = now(), leg_ends = now()
    from (values ${SPOTS.map(([v, , dx, dy]) => `(${v}, ${dx}::double precision, ${dy}::double precision)`).join(', ')}) p(id, dx, dy)
   where cr.world_id = w.world_id and cr.id = p.id;
  delete from class_mark where world_id = w.world_id and creature_id in (${ALL});`;
/** People standing still, unhurt, out of any fight, with nothing over them and nothing on them. */
const BARE = (uids: string): string => `
  update player set act = null, act_target = null, act_ends = null, act_queue = '[]', wounds = '[]'::jsonb, blessings = '{}'::jsonb,
         stats = (stats - 'hurtBy' - 'hurtAt' - 'aegisBy') || jsonb_build_object('health', 1, 'stamina', 1, 'aegis', 0)
   where world_id = w.world_id and uid in (${uids});`;
/** The skin over somebody, in hundredths of health. */
const SKIN = (uid: string): string =>
  `(select coalesce((stats->>'aegis')::double precision, 0) from player where world_id = w.world_id and uid = ${uid})`;
/** One blow of so much on somebody from a creature, and what of it came off their health. */
const BLOW = (on: string, from: string, raw: string, into: string): string => `
  update player set stats = stats || jsonb_build_object('hurtBy', ${from}, 'hurtAt', now() - interval '1 hour'), act = null
   where world_id = w.world_id and uid = ${on};
  select (stats->>'health')::double precision into h0 from player where world_id = w.world_id and uid = ${on};
  perform hurt_player(w.world_id, ${on}, ${raw}, 'The ogre bites you', 'bite');
  select h0 - (stats->>'health')::double precision into ${into} from player where world_id = w.world_id and uid = ${on};`;
/** A skin at 100% as it stands, read again before every spell measured: each cast teaches the school. */
const AT_NOW = `
  v_skin := warder_skin_at(w.world_id, w.uid);`;

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w record; o uuid; q uuid; v_px double precision; v_py double precision; r jsonb; v_t text;
        a int; b int; c int; e int;
        v_skin double precision; h0 double precision; m0 double precision; m1 double precision; m2 double precision;
begin
  -- An island with land and three people on it: the Warder, somebody two tiles off and somebody five.
  select p.world_id, p.uid, wd.spawn_x, wd.spawn_y into w from player p join world wd on wd.id = p.world_id
   where exists (select 1 from land_tile lt where lt.world_id = wd.id)
     and (select count(*) from player q2 where q2.world_id = p.world_id) >= 3
   order by wd.size desc, p.world_id, p.uid limit 1;
  select uid into o from player where world_id = w.world_id and uid <> w.uid order by uid limit 1;
  select uid into q from player where world_id = w.world_id and uid not in (w.uid, o) order by uid limit 1;
  v_px := w.spawn_x + peace_reach() + 10.5; v_py := w.spawn_y + 0.5;
  update placed set driver = null where world_id = w.world_id and driver in (w.uid, o, q);
  update player set x = v_px, y = v_py, level = 0, aboard = null, away = false, act = null, act_target = null,
         act_ends = null, act_queue = '[]', equipped = '{}'::jsonb, wounds = '[]'::jsonb, fight_stance = 'balanced', blessings = '{}'::jsonb,
         used_at = '{}'::jsonb, body_at = now(), craft_class = null, combat_class = null, class_mul = null, class_level = 0,
         moved_at = now(), fight_back = false,
         spell_bar = (select jsonb_agg('null'::jsonb) from spell_slot),
         stats = (coalesce(stats, '{}'::jsonb) - 'hurtAt' - 'hurtBy' - 'aegisBy')
                 || jsonb_build_object('health', 1, 'hunger', 1, 'thirst', 1, 'stamina', 1, 'aegis', 0, 'hurtSettled', now())
   where world_id = w.world_id and uid in (w.uid, o, q);
  update player set x = v_px + 2 where world_id = w.world_id and uid = o;
  update player set x = v_px + 5 where world_id = w.world_id and uid = q;
  -- Everybody else on the island well away.
  update player set x = v_px - 60 where world_id = w.world_id and uid not in (w.uid, o, q);
  insert into skill (world_id, uid, id, value)
    select w.world_id, pp.uid, sv.s, sv.v
      from (values ('warding', ${WARDING}::double precision), ('fighting', 100), ('body_control', 1)) sv(s, v)
     cross join (select unnest(array[w.uid, o, q]) as uid) pp
    on conflict (world_id, uid, id) do update set value = excluded.value;
  delete from event where uid in (w.uid, o, q);
  delete from player_node where world_id = w.world_id and uid in (w.uid, o, q);
  delete from player_spell where world_id = w.world_id and uid in (w.uid, o, q);
  delete from creature where world_id = w.world_id and to_x between v_px - 45 and v_px + 45 and to_y between v_py - 45 and v_py + 45;
  delete from creature where world_id = w.world_id and (hunting in (w.uid, o, q) or keeper in (w.uid, o, q));
  delete from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def = 'focus';
  delete from class_mark where world_id = w.world_id;
  delete from faith_owed where world_id = w.world_id;
  delete from faith_zone where world_id = w.world_id;
  delete from caller where uid = w.uid;
  perform set_config('request.jwt.claims', json_build_object('sub', w.uid)::text, true);
  insert into said select 'NAMES', (select name from player where world_id = w.world_id and uid = o) || '|'
    || (select name from player where world_id = w.world_id and uid = q);

  /* ---- The rows ---- */
  insert into said select 'SPELL:' || id, id || '¦' || class || '¦' || num || '¦' || name || '¦' || cost || '¦' || rest || '¦'
      || array_to_string(on_what, '+') || '¦' || coalesce((select string_agg(e2.k || '=' || e2.v, ';' order by e2.k) from jsonb_each_text(fx) e2(k, v)), '')
      || '¦' || note || '¦' || coalesce(needs, '-')
    from class_spell where class = 'warder';

  insert into said values ('TAKE', coalesce(rpc_take_class(w.world_id, 'warder')->>'why', 'took'));
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, cs.id from class_spell cs where cs.class = 'warder'
    on conflict do nothing;

  /* ---- No focus of the school's stones, no spell; and with one ---- */
  insert into said values ('NEEDS:NONE', coalesce(spell_cast_refusal(w.world_id, w.uid, 'warder_ward'), 'ready'));
  perform give(w.world_id, w.uid, 'focus', 1, 95, 'Sapphire');
  insert into said values ('NEEDS:SAPPHIRE', coalesce(spell_cast_refusal(w.world_id, w.uid, 'warder_ward'), 'ready'));
  perform give(w.world_id, w.uid, 'focus', 1, ${CUT}, 'Topaz');
  insert into said values ('NEEDS:TOPAZ', coalesce(spell_cast_refusal(w.world_id, w.uid, 'warder_ward'), 'ready'));
  insert into said select 'AT', skill_of(w.world_id, w.uid, 'warding') || '|' || warder_skin_at(w.world_id, w.uid) || '|'
      || lower((school_focus(w.world_id, w.uid, 'warding')).extra);

  /* ---- The school's Aegis: a skin of its force in hundredths of health ---- */
  ${BARE('w.uid')}
  select skill_of(w.world_id, w.uid, 'warding') into m0;
  v_t := do_spell(w.world_id, w.uid, 'aegis', ${ON_ME});
  insert into said select 'AEGIS', m0 || '|' || ${SKIN('w.uid')} || '|' || v_t;

  /* ---- Ward, Greater Ward and Deep Ward: each over a smaller skin, and none over a larger ---- */
  ${BARE('w.uid')}
  ${AT_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'warder_ward', ${ON_ME});
  insert into said select 'WARD', (${SKIN('w.uid')} / v_skin) || '|' || coalesce(r->>'said', r->>'why');
  ${AT_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'warder_greater_ward', ${ON_ME});
  insert into said select 'GREATER', (${SKIN('w.uid')} / v_skin) || '|' || coalesce(r->>'said', r->>'why');
  ${AT_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'warder_deep_ward', ${ON_ME});
  insert into said select 'DEEP', (${SKIN('w.uid')} / v_skin) || '|' || coalesce(r->>'said', r->>'why');
  insert into said values ('SMALLER', coalesce(class_spell_cast(w.world_id, w.uid, 'warder_ward', ${ON_ME})->>'why', 'cast'));

  /* ---- Ward Other and Greater Ward Other: over somebody within their reach, and nobody beyond ---- */
  ${BARE('w.uid, o, q')}
  ${AT_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'warder_ward_other', ${ON('o')});
  insert into said select 'OTHER', (${SKIN('o')} / v_skin) || '|' || coalesce(r->>'said', r->>'why') || '|'
      || coalesce((select stats->>'aegisBy' from player where world_id = w.world_id and uid = o), '-') || '|' || w.uid;
  ${AT_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'warder_greater_ward_other', ${ON('q')});
  insert into said select 'OTHER:GREATER', (${SKIN('q')} / v_skin) || '|' || coalesce(r->>'said', r->>'why');
  update player set x = v_px + 7 where world_id = w.world_id and uid = q;
  insert into said values ('OTHER:FAR', coalesce(class_spell_cast(w.world_id, w.uid, 'warder_ward_other', ${ON('q')})->>'why', 'cast'));

  /* ---- Sanctuary: over you and everybody within its reach, and nobody beyond ---- */
  ${BARE('w.uid, o, q')}
  ${AT_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'warder_sanctuary', ${ON_ME});
  insert into said select 'SANCTUARY', (${SKIN('w.uid')} / v_skin) || '|' || (${SKIN('o')} / v_skin) || '|' || ${SKIN('q')} || '|'
      || coalesce(r->>'said', r->>'why');
  update player set x = v_px + 5 where world_id = w.world_id and uid = q;

  /* ---- Thicken: the next skin the larger, and spent by it ---- */
  ${BARE('w.uid')}
  r := class_spell_cast(w.world_id, w.uid, 'warder_thicken', ${ON_ME});
  insert into said values ('THICKEN:SAID', coalesce(r->>'said', r->>'why'));
  ${AT_NOW}
  perform class_spell_cast(w.world_id, w.uid, 'warder_ward', ${ON_ME});
  insert into said select 'THICKEN', (${SKIN('w.uid')} / v_skin) || '|'
      || ((select blessings from player where world_id = w.world_id and uid = w.uid) ? 'thicken')::text;

  /* ---- Ward Burst: refused with no skin over you, and with nothing near enough to take it ---- */
  ${BARE('w.uid')}
  insert into said values ('BURST:BARE', coalesce(class_spell_cast(w.world_id, w.uid, 'warder_ward_burst', ${ON_ME})->>'why', 'cast'));
  update player set stats = stats || jsonb_build_object('aegis', 0.2) where world_id = w.world_id and uid = w.uid;
  insert into said values ('BURST:EMPTY', coalesce(class_spell_cast(w.world_id, w.uid, 'warder_ward_burst', ${ON_ME})->>'why', 'cast'));

  -- Four of them (SPOTS): an ogre at a pace and a half and a roxxen beside you, within a burst's reach; an ogre at nine and one at five.
  ${SPOTS.map(([v, species, dx, dy]) => SPAWN(v, species, `v_px + ${dx}`, `v_py + ${dy}`)).join('')}

  /* ---- Ward Burst: a point of damage for every hundredth of the skin, on everything within its reach and nothing beyond ---- */
  ${BARE('w.uid')}
  ${FRESH}
  update player set stats = stats || jsonb_build_object('aegis', 0.2) where world_id = w.world_id and uid = w.uid;
  r := class_spell_cast(w.world_id, w.uid, 'warder_ward_burst', ${ON_ME});
  insert into said select 'BURST', string_agg(cr.id || ':' || (max_health(cr) - cr.health), ',' order by cr.id) || '|' || ${SKIN('w.uid')}
      || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id in (a, b, c);
  insert into said select 'IDS', a || ',' || b || ',' || c || ',' || e;

  /* ---- Stoneskin: its share off every blow on you ---- */
  ${BARE('w.uid')}
  ${FRESH}
  r := class_spell_cast(w.world_id, w.uid, 'warder_stoneskin', ${ON_ME});
  ${BLOW('w.uid', 'a', String(BLOW_RAW), 'm0')}
  insert into said values ('STONESKIN', m0 || '|' || coalesce(r->>'said', r->>'why'));

  /* ---- Bastion of Stone: its share off every blow on you and on everybody within its reach, and nobody beyond ---- */
  ${BARE('w.uid, o, q')}
  r := class_spell_cast(w.world_id, w.uid, 'warder_bastion_of_stone', ${ON_ME});
  ${BLOW('w.uid', 'a', String(BLOW_RAW), 'm0')}
  ${BLOW('o', 'a', String(BLOW_RAW), 'm1')}
  ${BLOW('q', 'a', String(BLOW_RAW), 'm2')}
  insert into said values ('BASTION', m0 || '|' || m1 || '|' || m2 || '|' || coalesce(r->>'said', r->>'why'));

  /* ---- Unbreakable: no blow lands ---- */
  ${BARE('w.uid')}
  r := class_spell_cast(w.world_id, w.uid, 'warder_unbreakable', ${ON_ME});
  ${BLOW('w.uid', 'a', String(BLOW_RAW), 'm0')}
  insert into said values ('UNBREAKABLE', m0 || '|' || coalesce(r->>'said', r->>'why'));

  /* ---- Ward Link: a skin of yours over somebody used up goes back over them, once ---- */
  ${BARE('w.uid, o, q')}
  ${FRESH}
  r := class_spell_cast(w.world_id, w.uid, 'warder_ward_link', ${ON_ME});
  insert into said values ('LINK:SAID', coalesce(r->>'said', r->>'why'));
  perform class_spell_cast(w.world_id, w.uid, 'warder_ward_other', ${ON('o')});
  ${AT_NOW}
  ${BLOW('o', 'a', '0.2', 'm0')}
  select ${SKIN('o')} into m1;
  ${BLOW('o', 'a', '0.2', 'm2')}
  insert into said select 'LINK', (m1 / v_skin) || '|' || ${SKIN('o')};

  /* ---- The casts teach the trade and the school ---- */
  ${BARE('w.uid, o, q')}
  ${FRESH}
  update creature set hunting = w.uid where world_id = w.world_id and id = a;
  select class_level into m0 from player where world_id = w.world_id and uid = w.uid;
  select value into m1 from skill where world_id = w.world_id and uid = w.uid and id = 'warding';
  perform class_spell_cast(w.world_id, w.uid, 'warder_stoneskin', ${ON_ME});
  insert into said select 'LEARN', (pl.class_level > m0)::text || '|'
      || ((select value from skill where world_id = w.world_id and uid = w.uid and id = 'warding') > m1)::text
    from player pl where pl.world_id = w.world_id and pl.uid = w.uid;

  /* ---- The door: its stamina and its rest ---- */
  ${FRESH}
  ${BARE('w.uid')}
  delete from caller where uid = w.uid;
  update player set used_at = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  perform spell_bar_put(w.world_id, w.uid, ${FIRST_CLASS_SLOT}, 'warder_stoneskin');
  r := rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'self'));
  insert into said select 'PAID', coalesce(r->>'cast', r->>'why') || '|' || (stats->>'stamina')
    from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('RESTING', rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'self'))->>'why');

  /* ---- The passives ---- */
  ${BARE('w.uid, o, q')}
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, k2.id from class_perk k2
    where k2.class = 'warder' and not exists (select 1 from class_spell cs where cs.id = k2.id)
    on conflict do nothing;
  perform class_fold(w.world_id, w.uid);
  insert into said select 'FOLDED', coalesce((select string_agg(e2.k || '=' || e2.v, ';' order by e2.k collate "C")
      from jsonb_each_text(class_mul->'fx') e2(k, v) where e2.k ~ '^(skin|stamina|watch|thorns):'), 'none')
    from player where world_id = w.world_id and uid = w.uid;

  -- Thick Skin on a Ward of your own, and Protector besides on one over somebody else.
  ${AT_NOW}
  perform class_spell_cast(w.world_id, w.uid, 'warder_ward', ${ON_ME});
  insert into said select 'THICK', (${SKIN('w.uid')} / v_skin)::text;
  ${AT_NOW}
  perform class_spell_cast(w.world_id, w.uid, 'warder_ward_other', ${ON('o')});
  insert into said select 'PROTECTOR', (${SKIN('o')} / v_skin)::text;

  -- Overcharge: a Greater Ward over the Ward adds to it, up to its share of the larger.
  ${AT_NOW}
  select ${SKIN('w.uid')} into m0;
  r := class_spell_cast(w.world_id, w.uid, 'warder_greater_ward', ${ON_ME});
  insert into said select 'OVERCHARGE', m0 || '|' || v_skin || '|' || ${SKIN('w.uid')} || '|' || coalesce(r->>'said', r->>'why');

  -- The school's Aegis, laid as a Warder lays a skin: Thick Skin on it too.
  ${BARE('w.uid')}
  select skill_of(w.world_id, w.uid, 'warding') into m0;
  perform do_spell(w.world_id, w.uid, 'aegis', ${ON_ME});
  insert into said select 'AEGIS:THICK', m0 || '|' || ${SKIN('w.uid')};

  -- Second Wind: a blow that uses up the skin over you gives stamina back.
  ${BARE('w.uid')}
  update player set stats = stats || jsonb_build_object('aegis', 0.03, 'stamina', 0.5) where world_id = w.world_id and uid = w.uid;
  ${BLOW('w.uid', 'a', String(BLOW_RAW), 'm0')}
  insert into said select 'WIND', (stats->>'stamina') || '|' || m0 from player where world_id = w.world_id and uid = w.uid;

  -- Thorns: a blow on you answered with its share of the creature's own attack, once its row is written.
  ${FRESH}
  ${BARE('w.uid')}
  ${BLOW('w.uid', 'a', String(BLOW_RAW), 'm0')}
  perform class_owed_pay(w.world_id, a);
  insert into said select 'THORNS', (max_health(cr) - cr.health) || '|' || attack_of(cr) from creature cr where cr.world_id = w.world_id and cr.id = a;

  -- Watchful: a blow on somebody within its reach of you turns the creature on you; one on somebody beyond it does not.
  ${FRESH}
  ${BARE('w.uid, o, q')}
  update creature set hunting = o where world_id = w.world_id and id = e;
  update creature set hunting = q where world_id = w.world_id and id = c;
  ${BLOW('o', 'e', String(BLOW_RAW), 'm0')}
  ${BLOW('q', 'c', String(BLOW_RAW), 'm1')}
  perform class_owed_pay(w.world_id, e);
  perform class_owed_pay(w.world_id, c);
  insert into said select 'WATCHFUL', (select (hunting = w.uid)::text from creature where world_id = w.world_id and id = e) || '|'
      || (select (hunting = q)::text from creature where world_id = w.world_id and id = c);
  ${BARE('w.uid, o, q')}
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
const [O_NAME, Q_NAME] = parts('NAMES');

/* ---- What came back ------------------------------------------------------ */

{
  const wrong = SPELLS.filter((s) => island(`SPELL:${s.id}`) !== rowOf(s));
  check(`both sides hold the Warder's ${SPELLS.length} spells, field for field, what each wants included`,
    SPELLS.length === 12 && wrong.length === 0 && [...said.keys()].filter((k) => k.startsWith('SPELL:')).length === SPELLS.length,
    wrong.length ? `island ${island(`SPELL:${wrong[0].id}`)}, browser ${rowOf(wrong[0])}` : `${SPELLS.length} of them`);
}
check('the trade is taken up', island('TAKE') === 'took', island('TAKE'));
check('a Warder spell is refused with no focus of its stones in your pack, in the words its note uses',
  island('NEEDS:NONE') === `Ward wants ${NEEDS_SAID.warding.wants}.` && island('NEEDS:SAPPHIRE') === island('NEEDS:NONE'),
  `${island('NEEDS:NONE')} / ${island('NEEDS:SAPPHIRE')}`);
check('and made with a topaz', island('NEEDS:TOPAZ') === 'ready', island('NEEDS:TOPAZ'));
{
  const [skill, at, stone] = parts('AT');
  check('a skin at 100% is an Aegis\'s force out of the topaz at your warding, in hundredths of health, to the last bit',
    near(Number(at), skinOf(spellForce(AEGIS, Number(skill), CUT, 1))) && stone === 'topaz',
    `${island('AT')}; browser ${skinOf(spellForce(AEGIS, Number(skill), CUT, 1))}`);
}
{
  const [skill, skin, line] = parts('AEGIS');
  check('the school\'s Aegis lays a skin of its force in hundredths of health, and says how large',
    near(Number(skin), skinOf(spellForce(AEGIS, Number(skill), CUT, 1))) && line.endsWith(`(${Math.round(Number(skin) * 100)})`),
    island('AEGIS'));
}
{
  const [ward, wardSaid] = parts('WARD');
  const [greater, greaterSaid] = parts('GREATER');
  const [deep, deepSaid] = parts('DEEP');
  check(`Ward, Greater Ward and Deep Ward: skins of ${pct(fx('ward', 'skin'))}, ${pct(fx('greater_ward', 'skin'))} and `
    + `${pct(fx('deep_ward', 'skin'))}, each over a smaller one`,
    near(Number(ward), fx('ward', 'skin')) && near(Number(greater), fx('greater_ward', 'skin')) && near(Number(deep), fx('deep_ward', 'skin'))
      && /^Ward: a skin of \d+% goes over you\.$/.test(wardSaid)
      && /^Greater Ward: a skin of \d+% goes over you, in place of a smaller one\.$/.test(greaterSaid)
      && /^Deep Ward: a skin of \d+% goes over you, in place of a smaller one\.$/.test(deepSaid),
    `${island('WARD')} / ${island('GREATER')} / ${island('DEEP')}`);
  check('and none over a larger, refused before anything is spent', island('SMALLER') === 'The skin over you is larger already.',
    island('SMALLER'));
}
{
  const [share, line, by, me] = parts('OTHER');
  check(`Ward Other: a skin of ${pct(fx('ward_other', 'skin'))} over somebody within ${fx('ward_other', 'reach')} tiles, marked yours`,
    near(Number(share), fx('ward_other', 'skin')) && by === me
      && new RegExp(`^Ward Other: a skin of \\d+% goes over ${O_NAME}\\.$`).test(line), island('OTHER'));
  check(`Greater Ward Other: ${pct(fx('greater_ward_other', 'skin'))}`, near(Number(parts('OTHER:GREATER')[0]), fx('greater_ward_other', 'skin')),
    island('OTHER:GREATER'));
  check('and nobody further off than it reaches', island('OTHER:FAR') === `${Q_NAME} is more than ${fx('ward_other', 'reach')} tiles away.`,
    island('OTHER:FAR'));
}
{
  const [mine, theirs, beyond, line] = parts('SANCTUARY');
  check(`Sanctuary: ${pct(fx('sanctuary', 'skin'))} over you and everybody within ${fx('sanctuary', 'reach')} tiles, and nobody beyond`,
    near(Number(mine), fx('sanctuary', 'skin')) && near(Number(theirs), fx('sanctuary', 'skin')) && Number(beyond) === 0
      && /^Sanctuary: a skin of \d+% goes over you, and a skin of \d+% goes over 1 other\.$/.test(line), island('SANCTUARY'));
}
{
  const [share, still] = parts('THICKEN');
  check(`Thicken: the next skin ${pct(fx('thicken', 'more') - 1)} larger, and spent by it`,
    near(Number(share), fx('ward', 'skin') * fx('thicken', 'more')) && still === 'false'
      && island('THICKEN:SAID') === 'Thicken: the next skin you lay within 60 s is 50% larger.', `${island('THICKEN')} / ${island('THICKEN:SAID')}`);
}
check('Ward Burst is refused with no skin over you, and with nothing near enough to take it',
  island('BURST:BARE') === 'There is no skin over you to break.'
    && island('BURST:EMPTY') === `Nothing is within ${fx('ward_burst', 'reach')} tiles of you to strike.`,
  `${island('BURST:BARE')} / ${island('BURST:EMPTY')}`);
{
  const [A, B, C] = island('IDS').split(',');
  const [took, left, line] = parts('BURST');
  const lost = new Map(took.split(',').map((x) => x.split(':') as [string, string]));
  const each = 0.2 * 100 * fx('ward_burst', 'dmg');
  check(`Ward Burst: ${fx('ward_burst', 'dmg')} damage a hundredth of the skin on everything within ${fx('ward_burst', 'reach')} tiles, `
    + 'nothing beyond, and the skin gone',
    near(Number(lost.get(A)), each, 1e-4) && near(Number(lost.get(B)), each, 1e-4) && Number(lost.get(C)) === 0 && Number(left) === 0
      && line === `Ward Burst: the skin of 20% over you breaks for ${each} damage on 2 creatures.`, island('BURST'));
}
{
  const [taken, line] = parts('STONESKIN');
  check(`Stoneskin: ${pct(fx('stoneskin', 'cut'))} less from every blow`, near(Number(taken), BLOW_RAW * (1 - fx('stoneskin', 'cut')))
    && line === 'Stoneskin: for 10 s you take 25% less from every blow.', island('STONESKIN'));
}
{
  const [mine, near2, far, line] = parts('BASTION');
  const cut = BLOW_RAW * (1 - fx('bastion_of_stone', 'cut'));
  check(`Bastion of Stone: ${pct(fx('bastion_of_stone', 'cut'))} less on you and on everybody within ${fx('bastion_of_stone', 'reach')} tiles, `
    + 'and nobody beyond',
    near(Number(mine), cut) && near(Number(near2), cut) && near(Number(far), BLOW_RAW)
      && line === 'Bastion of Stone: for 10 s you and one other take 40% less from every blow.', island('BASTION'));
}
{
  const [taken, line] = parts('UNBREAKABLE');
  check('Unbreakable: no blow lands', Number(taken) === 0 && line === 'Unbreakable: for 6 s no blow aimed at you lands.', island('UNBREAKABLE'));
}
{
  const [share, after] = parts('LINK');
  check(`Ward Link: a skin of ${pct(fx('ward_link', 'skin'))} back over somebody whose skin of yours is used up, and only once`,
    near(Number(share), fx('ward_link', 'skin')) && Number(after) === 0
      && island('LINK:SAID') === 'Ward Link: for 30 s, when a skin of yours over somebody within 8 tiles of you is used up, a skin of 30% '
        + 'goes back over them, once each.', `${island('LINK')} / ${island('LINK:SAID')}`);
}
check('the casts teach the Warder\'s trade and warding', island('LEARN') === 'true|true', island('LEARN'));
{
  const [cast, stamina] = parts('PAID');
  check(`the door charges ${pct(spell('stoneskin').cost)} of your stamina and rests it ${spell('stoneskin').rest} s`,
    cast === 'warder_stoneskin' && near(Number(stamina), 1 - spell('stoneskin').cost), island('PAID'));
  check('and will not call it again until it has rested', /can be called again in \d+ seconds\.$/.test(island('RESTING')), island('RESTING'));
}
check('the six passives fold on the island to what they fold to in the browser',
  island('FOLDED') === Object.keys(FOLD).filter((k) => /^(skin|stamina|watch|thorns):/.test(k)).sort()
    .map((k) => `${k}=${FOLD[k]}`).join(';'), island('FOLDED'));
check(`Thick Skin: every skin ${pct(FOLD['skin:size'] - 1)} larger`, near(Number(island('THICK')), fx('ward', 'skin') * FOLD['skin:size']),
  island('THICK'));
check(`Protector: ${pct(FOLD['skin:other'] - 1)} larger again over somebody else`,
  near(Number(island('PROTECTOR')), fx('ward_other', 'skin') * FOLD['skin:size'] * FOLD['skin:other']), island('PROTECTOR'));
{
  const [was, at, now, line] = parts('OVERCHARGE').map((x, i) => (i < 3 ? Number(x) : x)) as [number, number, number, string];
  const laid = fx('greater_ward', 'skin') * FOLD['skin:size'] * at;
  check(`Overcharge: a skin over one adds to it, up to ${pct(FOLD['skin:over'])} of the larger`,
    near(now, Math.min(was + laid, FOLD['skin:over'] * Math.max(was, laid)))
      && /^Greater Ward: a skin of \d+% goes over you, added to the one there: \d+% now\.$/.test(line), island('OVERCHARGE'));
}
{
  const [skill, skin] = parts('AEGIS:THICK').map(Number);
  check('and the school\'s Aegis is laid as a Warder lays a skin', near(skin, skinOf(spellForce(AEGIS, skill, CUT, 1)) * FOLD['skin:size']),
    island('AEGIS:THICK'));
}
{
  const [stamina, taken] = parts('WIND').map(Number);
  check(`Second Wind: ${pct(FOLD['stamina:skin'])} of your stamina back when a blow uses up the skin over you`,
    near(stamina, 0.5 + FOLD['stamina:skin']) && near(taken, BLOW_RAW - 0.03), island('WIND'));
}
{
  const [lost, attack] = parts('THORNS').map(Number);
  check(`Thorns: ${pct(FOLD['thorns:attack'])} of its own attack back on whatever strikes you`, near(lost, attack * FOLD['thorns:attack'], 1e-4),
    island('THORNS'));
}
check(`Watchful: a creature that strikes somebody within ${FOLD['watch:reach']} tiles of you turns on you, and one beyond does not`,
  island('WATCHFUL') === 'true|true', island('WATCHFUL'));
check('no function is open to a player but the doors', island('OPEN') === '0', island('OPEN'));

/* ---- The browser's half ----------------------------------------------------- */

check(`each of the ${CLASS_TIER_AT.length} tiers offers two spells and a passive`,
  TIERS.warder.length === CLASS_TIER_AT.length && TIERS.warder.every((row) => row.length === 3
    && row.filter((num) => SPELLS.some((s) => s.num === num)).length === 2), JSON.stringify(TIERS.warder));
check('every spell says first that it wants a focus, in the words its refusal uses',
  SPELLS.every((s) => s.needs === 'warding' && s.note.startsWith(`${NEEDS_SAID.warding.has}: `)));
check('and every spell\'s perk says what it costs before what it does',
  SPELLS.every((s) => PERK_BY_ID.get(s.id)!.note.startsWith('Spell') && PERK_BY_ID.get(s.id)!.note.endsWith(s.note)));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Warder — ${ok.length} of ${ok.length}`);
