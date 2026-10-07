/**
 * The Binder: twelve spells and six passives in six tiers that open on the
 * trade's own level, on the island (`the_binder.sql`) and in the browser's
 * rulebook (`talents.ts`, `perks.ts`).
 *
 * What this asks:
 *
 *   * both sides hold the same twelve spells, field for field, what each wants
 *     -- a sapphire or diamond focus in your pack -- included, and the same
 *     tiers;
 *   * a hold at 100% is a Snare out of the focus and a shatter at 100% an
 *     Ember's force out of it, at your binding, to the last bit on both sides;
 *   * a Bind and a Lock hold at their share, half as long on a monster, and
 *     no further off than they reach; a Shatter is its share, twice on a
 *     creature held; a blow that turns a held creature on you does not free
 *     it;
 *   * a rooted creature takes no step and still strikes what is in its reach,
 *     and a tethered one goes no further than its tether, where one tied to
 *     nothing walks on; a Heavy Limbs spaces its blows out, a Dull Claws
 *     makes them smaller on you and on anything else, and a Brittle makes it
 *     take more; a Mire slows and a Mass Root roots everything within their
 *     width and nothing beyond; a Still Skin takes its share off every blow;
 *     a Stillness stops every wound bleeding;
 *   * a Long Hold lengthens the holds and the reach;
 *   * the door charges its stamina and its rest, and the casts teach the
 *     trade and the school;
 *   * and every passive moves the number it names at the rule it changes.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
// The rulebook first: what the browser's half reads is a part of it and cannot be loaded on its own.
import '../../src/game/actions';
import { spellDef, spellForce, spellSecs } from '../../src/game/arcane';
import { CLASS_TIER_AT } from '../../src/game/classes';
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

const SPELLS = classSpellsOf('binder');
const spell = (slug: string): ClassSpellDef => {
  const s = CLASS_SPELL_BY_ID.get(`binder_${slug}`);
  if (!s) throw new Error(`no binder_${slug}`);
  return s;
};
const fx = (slug: string, k: string): number => spell(slug).fx[k];
const PASSIVES = perksOf('binder').filter((p) => !CLASS_SPELL_BY_ID.has(p.id));
/** What the six passives fold to, which is what the browser reads a Binder's numbers from. */
const FOLD = foldPerks(PASSIVES.map((p) => p.id));
const FIRST_CLASS_SLOT = SPELL_BAR.indexOf('class');
const EMBER = spellDef('ember')!;
const SNARE = spellDef('snare')!;
/** The binding the caster has, and the cut of the stone cast out of. */
const BINDING = 60;
const CUT = 80;
/** A Long Hold's numbers, put on by hand: the rite is asked of in its own suite, and here only what it does to a Binder's spells. */
const LONG = 1.4;

/** A spell's row as the island prints it and as the browser would: every field, the numbers by name. */
const rowOf = (s: ClassSpellDef): string =>
  [s.id, s.class, s.num, s.name, s.cost, s.rest, s.on.join('+'),
    Object.keys(s.fx).sort().map((k) => `${k}=${s.fx[k]}`).join(';'), s.note, s.needs ?? '-'].join('¦');

const ON_ME = `jsonb_build_object('kind', 'self', 'uid', w.uid)`;
const ON = (id: string): string => `jsonb_build_object('kind', 'enemy', 'id', ${id})`;
/** A wild creature put down at a spot, alike in everything that has a say in a fight, and doing nothing of its own. */
const SPAWN = (v: string, species: string, x: string, y: string): string => `
  ${v} := creature_spawn(w.world_id, '${species}', ${x}, ${y}, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = null, brawl = null, enemy = null, hunt_again = null, skills = '{}'::jsonb,
         settled_at = now(), until = now() + interval '1 hour', windup_at = null, bleed_rate = null, bleed_until = null,
         slow = null, slow_until = null, fight_blows = 0
   where world_id = w.world_id and id = ${v};
  update creature set health = max_health(creature) where world_id = w.world_id and id = ${v};`;
/** The seven, and where each is put down off from you. */
const SPOTS: [string, string, number, number][] = [
  ['a', 'ogre', 1.5, 0], ['b', 'roxxen', 3, 0], ['c', 'ogre', 9, 0], ['e', 'ogre', 5, 0],
  ['g', 'roxxen', 2, 2], ['h', 'ogre', 3, 3], ['j', 'ogre', -3, 3],
];
/** Creatures put back as they were spawned, where they were spawned, every mark on them gone, between one spell and the next. */
const FRESH = (ids: string): string => `
  update creature cr set health = max_health(cr), settled_at = now(), until = now() + interval '1 hour', brawl = null,
         hunting = null, windup_at = null, bleed_rate = null, bleed_until = null, hurt_at = null, slow = null, slow_until = null,
         fight_blows = 0, from_x = v_px + p.dx, to_x = v_px + p.dx, from_y = v_py + p.dy, to_y = v_py + p.dy, leg_at = now(), leg_ends = now()
    from (values ${SPOTS.map(([v, , dx, dy]) => `(${v}, ${dx}::double precision, ${dy}::double precision)`).join(', ')}) p(id, dx, dy)
   where cr.world_id = w.world_id and cr.id = p.id and cr.id in (${ids});
  delete from class_mark where world_id = w.world_id and creature_id in (${ids});`;
/** A hold and a shatter at 100% as they stand, read again before every spell measured: each cast teaches the school. */
const AT_NOW = `
  v_hold := binder_hold_at(w.world_id, w.uid);
  v_force := binder_shatter_at(w.world_id, w.uid);`;
/** How long a creature is held from now, by its turn. */
const HELD = (id: string): string =>
  `(select extract(epoch from cr.until - now()) from creature cr where cr.world_id = w.world_id and cr.id = ${id})`;
/** Somebody standing still, unhurt, out of any fight, with nothing on them. */
const WHOLE = `
  update player set act = null, act_target = null, act_ends = null, act_queue = '[]', wounds = '[]'::jsonb, blessings = '{}'::jsonb,
         stats = (stats - 'hurtBy' - 'hurtAt') || jsonb_build_object('health', 1)
   where world_id = w.world_id and uid = w.uid;`;
/** One blow of so much on them from a creature, and what of it came off their health. */
const BLOW = (from: string, into: string): string => `
  ${WHOLE}
  update player set stats = stats || jsonb_build_object('hurtBy', ${from}, 'hurtAt', now() - interval '1 hour')
   where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.05, 'The ogre bites you', 'bite');
  select 1 - (stats->>'health')::double precision into ${into} from player where world_id = w.world_id and uid = w.uid;
  ${WHOLE}`;
const ALL = 'a, b, c, e, g, h, j';

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w record; v_px double precision; v_py double precision; r jsonb;
        a int; b int; c int; e int; g int; h int; j int;
        v_hold double precision; v_force double precision; v_seed double precision;
        m0 double precision; m1 double precision; h0 double precision; h1 double precision; d1 double precision;
        x0 double precision; y0 double precision;
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
      (values ('binding', ${BINDING}::double precision), ('fighting', 100), ('body_control', 1)) sv(s, v)
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
    from class_spell where class = 'binder';

  insert into said values ('TAKE', coalesce(rpc_take_class(w.world_id, 'binder')->>'why', 'took'));
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, cs.id from class_spell cs where cs.class = 'binder'
    on conflict do nothing;

  /* ---- No focus of the school's stones, no spell; and with one ---- */
  insert into said values ('NEEDS:NONE', coalesce(spell_cast_refusal(w.world_id, w.uid, 'binder_bind'), 'ready'));
  perform give(w.world_id, w.uid, 'focus', 1, 95, 'Garnet');
  insert into said values ('NEEDS:GARNET', coalesce(spell_cast_refusal(w.world_id, w.uid, 'binder_bind'), 'ready'));
  perform give(w.world_id, w.uid, 'focus', 1, ${CUT}, 'Sapphire');
  insert into said values ('NEEDS:SAPPHIRE', coalesce(spell_cast_refusal(w.world_id, w.uid, 'binder_bind'), 'ready'));
  insert into said select 'AT', skill_of(w.world_id, w.uid, 'binding') || '|' || binder_hold_at(w.world_id, w.uid) || '|'
      || binder_shatter_at(w.world_id, w.uid) || '|' || lower((school_focus(w.world_id, w.uid, 'binding')).extra);

  -- Seven of them (SPOTS): an ogre at a pace and a half, a roxxen at three, an ogre at nine, an ogre at five, a roxxen
  -- beside you, and two ogres off to either side for a hunt.
  ${SPOTS.map(([v, species, dx, dy]) => SPAWN(v, species, `v_px + ${dx}`, `v_py + ${dy}`)).join('')}

  /* ---- Bind: held at its share, half as long on a monster, and no further off than it reaches ---- */
  ${AT_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'binder_bind', ${ON('b')});
  insert into said select 'BIND', (${HELD('b')} / v_hold) || '|' || class_held(w.world_id, b)::text || '|' || coalesce(r->>'said', r->>'why');
  ${AT_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'binder_bind', ${ON('a')});
  insert into said select 'BIND:MONSTER', (${HELD('a')} / v_hold)::text;
  insert into said values ('BIND:FAR', class_spell_cast(w.world_id, w.uid, 'binder_bind', ${ON('c')})->>'why');

  -- A blow that turns a held creature on you does not free it.
  update creature set hunting = null where world_id = w.world_id and id = b;
  select ${HELD('b')} into h0;
  perform engage_beast(w.world_id, b, w.uid);
  insert into said select 'BIND:ENGAGED', (${HELD('b')} - h0)::text || '|' || (select hunting = w.uid from creature where world_id = w.world_id and id = b)::text;

  /* ---- Lock: held at its share ---- */
  ${FRESH(ALL)}
  ${AT_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'binder_lock', ${ON('b')});
  insert into said select 'LOCK', (${HELD('b')} / v_hold) || '|' || coalesce(r->>'said', r->>'why');

  /* ---- Shatter: its share, and twice its share on one held ---- */
  ${FRESH(ALL)}
  ${AT_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'binder_shatter', ${ON('a')});
  insert into said select 'SHATTER', ((max_health(cr) - cr.health) / v_force) || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id = a;
  ${FRESH(ALL)}
  perform class_spell_cast(w.world_id, w.uid, 'binder_bind', ${ON('a')});
  ${AT_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'binder_shatter', ${ON('a')});
  insert into said select 'SHATTER:HELD', ((max_health(cr) - cr.health) / v_force)::text
    from creature cr where cr.world_id = w.world_id and cr.id = a;

  /* ---- The casts teach the trade and the school ---- */
  ${FRESH(ALL)}
  select class_level into m0 from player where world_id = w.world_id and uid = w.uid;
  select value into h0 from skill where world_id = w.world_id and uid = w.uid and id = 'binding';
  perform class_spell_cast(w.world_id, w.uid, 'binder_root', ${ON('b')});
  insert into said select 'LEARN', (pl.class_level > m0)::text || '|'
      || ((select value from skill where world_id = w.world_id and uid = w.uid and id = 'binding') > h0)::text
    from player pl where pl.world_id = w.world_id and pl.uid = w.uid;

  /* ---- Root: no step taken, where an ogre tied to nothing walks on; and it strikes what is in its reach ---- */
  ${FRESH(ALL)}
  r := class_spell_cast(w.world_id, w.uid, 'binder_root', ${ON('h')});
  insert into said values ('ROOT:SAID', coalesce(r->>'said', r->>'why'));
  update creature set hunting = w.uid, hunt_x = to_x, hunt_y = to_y where world_id = w.world_id and id = j;
  update creature set until = now() - interval '1 second', settled_at = now() - interval '1 second' where world_id = w.world_id and id in (h, j);
  perform creature_settle(w.world_id, h);
  perform creature_settle(w.world_id, j);
  insert into said select 'ROOT', string_agg(sqrt((creature_x(cr) - v_px) ^ 2 + (creature_y(cr) - v_py) ^ 2)::text, '|' order by cr.id)
    from creature cr where cr.world_id = w.world_id and cr.id in (h, j);
  ${WHOLE}
  ${FRESH('a')}
  update creature set from_x = v_px + 1, to_x = v_px + 1, from_y = v_py, to_y = v_py where world_id = w.world_id and id = a;
  perform class_spell_cast(w.world_id, w.uid, 'binder_root', ${ON('a')});
  update creature set until = now() - interval '1 second', settled_at = now() - interval '1 second' where world_id = w.world_id and id = a;
  perform creature_settle(w.world_id, a);
  insert into said select 'ROOT:STRIKES', ((stats->>'health')::double precision < 1)::text || '|'
      || (select (creature_x(cr) = v_px + 1)::text from creature cr where cr.world_id = w.world_id and cr.id = a)
    from player where world_id = w.world_id and uid = w.uid;
  ${WHOLE}

  /* ---- Tether: no further than its tether from where it stood, an ogre at five hunting you for long enough to come all the way ---- */
  ${FRESH(ALL)}
  select creature_x(cr), creature_y(cr) into x0, y0 from creature cr where cr.world_id = w.world_id and cr.id = e;
  r := class_spell_cast(w.world_id, w.uid, 'binder_tether', ${ON('e')});
  update creature set hunting = w.uid, hunt_x = to_x, hunt_y = to_y, until = now() - interval '3 seconds',
         settled_at = now() - interval '3 seconds'
   where world_id = w.world_id and id = e;
  perform creature_settle(w.world_id, e);
  insert into said select 'TETHER', sqrt((creature_x(cr) - x0) ^ 2 + (creature_y(cr) - y0) ^ 2) || '|'
      || coalesce(r->>'said', r->>'why') from creature cr where cr.world_id = w.world_id and cr.id = e;
  ${WHOLE}

  /* ---- Heavy Limbs: its next blow so much later, the same ogre's blow measured with and without ---- */
  ${FRESH(ALL)}
  update creature set from_x = v_px + 1, to_x = v_px + 1, from_y = v_py, to_y = v_py, hunting = w.uid, hunt_x = v_px + 1, hunt_y = v_py
   where world_id = w.world_id and id = a;
  update creature set until = now() - interval '10 milliseconds', settled_at = now() - interval '1 second' where world_id = w.world_id and id = a;
  perform creature_settle(w.world_id, a);
  select extract(epoch from until - (now() - interval '10 milliseconds')) into d1 from creature where world_id = w.world_id and id = a;
  ${WHOLE}
  r := class_spell_cast(w.world_id, w.uid, 'binder_heavy_limbs', ${ON('a')});
  update creature set fight_blows = 0, windup_at = null, until = now() - interval '10 milliseconds', settled_at = now() - interval '1 second'
   where world_id = w.world_id and id = a;
  perform creature_settle(w.world_id, a);
  insert into said select 'LIMBS', (extract(epoch from until - (now() - interval '10 milliseconds')) / d1) || '|' || coalesce(r->>'said', r->>'why')
    from creature where world_id = w.world_id and id = a;
  ${WHOLE}

  /* ---- Dull Claws: less on you, and less on anything else, the same roll asked of two roxxen alike ---- */
  ${FRESH(ALL)}
  ${BLOW('a', 'm0')}
  r := class_spell_cast(w.world_id, w.uid, 'binder_dull_claws', ${ON('a')});
  ${BLOW('a', 'm1')}
  insert into said values ('DULL', m0 || '|' || m1 || '|' || coalesce(r->>'said', r->>'why'));
  ${FRESH('b, g')}
  delete from class_mark where world_id = w.world_id and creature_id = a and kind = 'dull';
  v_seed := 0.37;
  perform setseed(v_seed);
  perform creature_attack(w.world_id, a, b);
  select max_health(cr) - cr.health into d1 from creature cr where cr.world_id = w.world_id and cr.id = b;
  perform class_spell_cast(w.world_id, w.uid, 'binder_dull_claws', ${ON('a')});
  perform setseed(v_seed);
  perform creature_attack(w.world_id, a, g);
  insert into said select 'DULL:BEAST', ((max_health(cr) - cr.health) / d1)::text from creature cr where cr.world_id = w.world_id and cr.id = g;
  ${WHOLE}

  /* ---- Brittle: more from what strikes it ---- */
  ${FRESH(ALL)}
  r := class_spell_cast(w.world_id, w.uid, 'binder_brittle', ${ON('b')});
  perform wound_beast(w.world_id, b, 10, v_px, v_py, null, null);
  insert into said select 'BRITTLE', (max_health(cr) - cr.health) || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id = b;
  -- And a shatter and a blow on it say what came off and what it is down to, the Brittle's share in both.
  ${FRESH(ALL)}
  perform class_spell_cast(w.world_id, w.uid, 'binder_brittle', ${ON('b')});
  ${AT_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'binder_shatter', ${ON('b')});
  insert into said select 'BRITTLE:SAID', ((max_health(cr) - cr.health) / v_force) || '|' || (max_health(cr) - cr.health) || '|'
      || coalesce(r->>'said', r->>'why') from creature cr where cr.world_id = w.world_id and cr.id = b;
  r := class_blow(w.world_id, w.uid, b, 1, true);
  insert into said select 'BRITTLE:BLOW', (r->>'left') || '|' || ceil(cr.health) || '|' || (r->>'dmg')
    from creature cr where cr.world_id = w.world_id and cr.id = b;

  /* ---- A Snare out of the school is a hold too, which a Shatter is the larger on ---- */
  ${FRESH(ALL)}
  perform do_spell(w.world_id, w.uid, 'snare', jsonb_build_object('id', a));
  insert into said select 'SNARED', class_held(w.world_id, a)::text;
  ${AT_NOW}
  r := class_spell_cast(w.world_id, w.uid, 'binder_shatter', ${ON('a')});
  insert into said select 'SNARED:SHATTER', ((max_health(cr) - cr.health) / v_force)::text
    from creature cr where cr.world_id = w.world_id and cr.id = a;

  /* ---- Still Skin: its share off every blow on you ---- */
  ${FRESH(ALL)}
  ${BLOW('e', 'm0')}
  r := class_spell_cast(w.world_id, w.uid, 'binder_still_skin', ${ON_ME});
  update player set stats = stats || jsonb_build_object('hurtBy', e, 'hurtAt', now() - interval '1 hour'), act = null
   where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.05, 'The ogre bites you', 'bite');
  insert into said select 'SKIN', m0 || '|' || (1 - (stats->>'health')::double precision) || '|' || coalesce(r->>'said', r->>'why')
    from player where world_id = w.world_id and uid = w.uid;
  ${WHOLE}

  /* ---- Stillness: every wound stops bleeding; refused with none bleeding ---- */
  update player set wounds = jsonb_build_array(
      jsonb_build_object('kind', 'cut', 'part', 'chest', 'severity', 0.05, 'bleeding', true, 'infected', false, 'dressing', null, 'at', now()),
      jsonb_build_object('kind', 'bite', 'part', 'left_arm', 'severity', 0.05, 'bleeding', true, 'infected', false, 'dressing', null, 'at', now()))
   where world_id = w.world_id and uid = w.uid;
  r := class_spell_cast(w.world_id, w.uid, 'binder_stillness', ${ON_ME});
  insert into said select 'STILL', (select count(*) from jsonb_array_elements(wounds) t(wd) where (wd->>'bleeding')::boolean)
      || '|' || jsonb_array_length(wounds) || '|' || coalesce(r->>'said', r->>'why')
    from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('STILL:NONE', class_spell_cast(w.world_id, w.uid, 'binder_stillness', ${ON_ME})->>'why');
  ${WHOLE}

  /* ---- Mire and Mass Root: everything within their width, and nothing beyond ---- */
  ${FRESH(ALL)}
  r := class_spell_cast(w.world_id, w.uid, 'binder_mire', ${ON_ME});
  insert into said select 'MIRE', string_agg(cr.id || ':' || coalesce(cr.slow::text, '-') || ':'
      || coalesce(extract(epoch from cr.slow_until - now())::text, '-'), ',' order by cr.id) || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id in (a, b, e, g);
  ${FRESH(ALL)}
  r := class_spell_cast(w.world_id, w.uid, 'binder_mass_root', ${ON_ME});
  insert into said select 'MASS', string_agg(cr.id || ':' || coalesce((select (m.val = 0 and m.until > now())::text from class_mark m
        where m.world_id = w.world_id and m.creature_id = cr.id and m.kind = 'root'), 'false'), ',' order by cr.id)
      || '|' || coalesce(r->>'said', r->>'why')
    from creature cr where cr.world_id = w.world_id and cr.id in (a, b, e, g);
  insert into said select 'IDS', a || ',' || b || ',' || e || ',' || g;

  /* ---- A Long Hold: its holds and its reach the longer ---- */
  ${FRESH(ALL)}
  ${AT_NOW}
  update player set class_mul = jsonb_set(class_mul, '{rite}', jsonb_build_object('until', now() + interval '1 minute',
         'muls', jsonb_build_object('force', ${LONG}, 'reach', ${LONG})))
   where world_id = w.world_id and uid = w.uid;
  insert into said select 'LONG', (binder_hold_at(w.world_id, w.uid) / v_hold) || '|'
      || coalesce(class_spell_cast(w.world_id, w.uid, 'binder_bind', ${ON('c')})->>'why', 'cast');
  perform class_fold(w.world_id, w.uid);

  /* ---- The door: its stamina and its rest ---- */
  ${FRESH(ALL)}
  ${WHOLE}
  delete from caller where uid = w.uid;
  update player set used_at = '{}'::jsonb, stats = jsonb_set(stats, '{stamina}', '1') where world_id = w.world_id and uid = w.uid;
  perform spell_bar_put(w.world_id, w.uid, ${FIRST_CLASS_SLOT}, 'binder_still_skin');
  r := rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'self'));
  insert into said select 'PAID', coalesce(r->>'cast', r->>'why') || '|' || (stats->>'stamina')
    from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('RESTING', rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'self'))->>'why');
  ${WHOLE}

  /* ---- The passives ---- */
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, k2.id from class_perk k2
    where k2.class = 'binder' and not exists (select 1 from class_spell cs where cs.id = k2.id)
    on conflict do nothing;
  perform class_fold(w.world_id, w.uid);
  insert into said select 'FOLDED', coalesce((select string_agg(e2.k || '=' || e2.v, ';' order by e2.k collate "C")
      from jsonb_each_text(class_mul->'fx') e2(k, v) where e2.k ~ '^(reach|chill|bind|still|ward):'), 'none')
    from player where world_id = w.world_id and uid = w.uid;

  -- Far Reach: a Bind as far as the ogre at nine.
  ${FRESH(ALL)}
  insert into said values ('FAR', coalesce(class_spell_cast(w.world_id, w.uid, 'binder_bind', ${ON('c')})->>'why', 'cast'));

  -- Firm Grip, Lingering Chill and Brittle Hold, on a Bind.
  ${FRESH(ALL)}
  ${AT_NOW}
  perform class_spell_cast(w.world_id, w.uid, 'binder_bind', ${ON('b')});
  perform wound_beast(w.world_id, b, 10, v_px, v_py, null, null);
  insert into said select 'GRIP', (${HELD('b')} / v_hold) || '|' || cr.slow || '|' || extract(epoch from cr.slow_until - now()) || '|'
      || (max_health(cr) - cr.health) || '|' || ${HELD('b')}
    from creature cr where cr.world_id = w.world_id and cr.id = b;

  -- Unmoved, on a blow from one tied to nothing; and Frost Ward besides, on one slowed.
  ${BLOW('e', 'm0')}
  ${BLOW('b', 'm1')}
  insert into said values ('WARD', m0 || '|' || m1);
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
  check(`both sides hold the Binder's ${SPELLS.length} spells, field for field, what each wants included`,
    SPELLS.length === 12 && wrong.length === 0 && [...said.keys()].filter((k) => k.startsWith('SPELL:')).length === SPELLS.length,
    wrong.length ? `island ${island(`SPELL:${wrong[0].id}`)}, browser ${rowOf(wrong[0])}` : `${SPELLS.length} of them`);
}
check('the trade is taken up', island('TAKE') === 'took', island('TAKE'));
check('a Binder spell is refused with no focus of its stones in your pack, in the words its note uses',
  island('NEEDS:NONE') === `Bind wants ${NEEDS_SAID.binding.wants}.` && island('NEEDS:GARNET') === island('NEEDS:NONE'),
  `${island('NEEDS:NONE')} / ${island('NEEDS:GARNET')}`);
check('and made with a sapphire', island('NEEDS:SAPPHIRE') === 'ready', island('NEEDS:SAPPHIRE'));
{
  const [skill, hold, force, stone] = parts('AT');
  check(`a hold at 100% is a Snare and a shatter at 100% an Ember's force, out of the sapphire at your binding, to the last bit`,
    near(Number(hold), spellSecs(SNARE, Number(skill), 1)) && near(Number(force), spellForce(EMBER, Number(skill), CUT, 1)) && stone === 'sapphire',
    `${island('AT')}; browser ${spellSecs(SNARE, Number(skill), 1)} / ${spellForce(EMBER, Number(skill), CUT, 1)}`);
}
{
  const [share, held, line] = parts('BIND');
  check(`Bind: held at ${pct(fx('bind', 'hold'))} of a Snare's hold`,
    near(Number(share), fx('bind', 'hold'), 1e-6) && held === 'true' && /^Bind: the roxxen is held where it stands for [\d.]+ s\.$/.test(line),
    island('BIND'));
  check(`and ${pct(fx('bind', 'monster'))} of that on a monster`,
    near(Number(island('BIND:MONSTER')), fx('bind', 'hold') * fx('bind', 'monster'), 1e-6), island('BIND:MONSTER'));
  check(`and no further than ${fx('bind', 'reach')} tiles`, island('BIND:FAR') === `The ogre is more than ${fx('bind', 'reach')} tiles away.`,
    island('BIND:FAR'));
  const [moved, hunting] = parts('BIND:ENGAGED');
  check('a blow that turns a held creature on you does not free it', Number(moved) === 0 && hunting === 'true', island('BIND:ENGAGED'));
}
check(`Lock: held at ${pct(fx('lock', 'hold'))} of a Snare's hold`, near(Number(parts('LOCK')[0]), fx('lock', 'hold'), 1e-6), island('LOCK'));
{
  const [ratio, line] = parts('SHATTER');
  check(`Shatter: shatter at ${pct(fx('shatter', 'shatter'))}, and ${pct(fx('shatter', 'held'))} on one held`,
    near(Number(ratio), fx('shatter', 'shatter'), 1e-4) && near(Number(island('SHATTER:HELD')), fx('shatter', 'held'), 1e-4)
      && /^Shatter: the shatter takes \d+ off the ogre\. It is down to \d+ of 170\.$/.test(line),
    `${island('SHATTER')} / ${island('SHATTER:HELD')}`);
}
check('the casts teach the Binder\'s trade and binding', island('LEARN') === 'true|true', island('LEARN'));
{
  const [rooted, loose] = parts('ROOT').map(Number);
  const [struck, stood] = parts('ROOT:STRIKES');
  check(`Root: an ogre rooted takes no step towards you, where one tied to nothing walks on`,
    near(rooted, Math.hypot(3, 3), 1e-6) && loose < Math.hypot(3, 3) - 0.5
      && /^Root: the ogre is rooted where it stands for 8 s\.$/.test(island('ROOT:SAID')), `${island('ROOT')} / ${island('ROOT:SAID')}`);
  check('and still strikes what is within its reach', struck === 'true' && stood === 'true', island('ROOT:STRIKES'));
}
{
  const [went, line] = parts('TETHER');
  check(`Tether: no further than ${fx('tether', 'leash')} tiles from where it stood, and as far as that`,
    Number(went) <= fx('tether', 'leash') + 1e-6 && Number(went) > fx('tether', 'leash') - 0.5
      && line === 'Tether: for 15 s the ogre cannot go more than 3 tiles from where it stands.', island('TETHER'));
}
{
  const [ratio, line] = parts('LIMBS');
  check(`Heavy Limbs: its next blow ${(1 / fx('heavy_limbs', 'often')).toFixed(3)} times as far off`,
    near(Number(ratio), 1 / fx('heavy_limbs', 'often'), 1e-6) && line === 'Heavy Limbs: for 10 s the ogre strikes 30% less often.', island('LIMBS'));
}
{
  const [plain, dulled, line] = parts('DULL');
  check(`Dull Claws: its blows on you ${pct(1 - fx('dull_claws', 'dealt'))} smaller`,
    near(Number(plain), 0.05, 1e-9) && near(Number(dulled), 0.05 * fx('dull_claws', 'dealt'), 1e-9)
      && line === 'Dull Claws: for 10 s the ogre\'s blows land 30% smaller.', island('DULL'));
  check('and on anything else, the same roll asked of two roxxen alike', near(Number(island('DULL:BEAST')), fx('dull_claws', 'dealt'), 1e-4),
    island('DULL:BEAST'));
}
{
  const [took, line] = parts('BRITTLE');
  check(`Brittle: ${pct(fx('brittle', 'taken') - 1)} more from what strikes it`, near(Number(took), 10 * fx('brittle', 'taken'), 1e-4)
    && line === 'Brittle: for 10 s the roxxen takes 25% more from everything that strikes it.', island('BRITTLE'));
}
{
  const [ratio, took, line] = parts('BRITTLE:SAID');
  check(`and a shatter on it says what came off, ${pct(fx('brittle', 'taken') - 1)} more included, and what it is down to`,
    near(Number(ratio), fx('brittle', 'taken'), 1e-4)
      && line === `Shatter: the shatter takes ${Math.round(Number(took))} off the roxxen. It is down to ${Math.ceil(80 - Number(took))} of 80.`,
    island('BRITTLE:SAID'));
  const [left, health, dmg] = parts('BRITTLE:BLOW');
  check('and so does a blow: what it is down to is what it has left, not what the blow was', left === health && Number(dmg) > 0,
    island('BRITTLE:BLOW'));
}
check(`a Snare out of the school holds as the trade's do, and a Shatter is ${pct(fx('shatter', 'held'))} on it`,
  island('SNARED') === 'true' && near(Number(island('SNARED:SHATTER')), fx('shatter', 'held'), 1e-4),
  `${island('SNARED')} / ${island('SNARED:SHATTER')}`);
{
  const [plain, skin, line] = parts('SKIN');
  check(`Still Skin: ${pct(fx('still_skin', 'cut'))} less from every blow`, near(Number(plain), 0.05, 1e-9)
    && near(Number(skin), 0.05 * (1 - fx('still_skin', 'cut')), 1e-9) && line === 'Still Skin: for 10 s you take 20% less from every blow.',
    island('SKIN'));
}
{
  const [bleeding, wounds, line] = parts('STILL');
  check('Stillness: every wound stops bleeding, and stays open', bleeding === '0' && wounds === '2'
    && line === 'Stillness: every wound on you stops bleeding.', island('STILL'));
  check('and it is refused with nothing bleeding', island('STILL:NONE') === 'Nothing on you is bleeding.', island('STILL:NONE'));
}
{
  const [A, B, E, G] = island('IDS').split(',');
  const mire = new Map(parts('MIRE')[0].split(',').map((x) => { const [id, slow, secs] = x.split(':'); return [id, { slow, secs }]; }));
  const slowed = (id: string): boolean => near(Number(mire.get(id)!.slow), fx('mire', 'pace'), 1e-6) && near(Number(mire.get(id)!.secs), fx('mire', 'secs'), 1e-6);
  check(`Mire: everything within ${fx('mire', 'reach')} tiles at ${pct(fx('mire', 'pace'))} of its pace for ${fx('mire', 'secs')} s, and nothing beyond`,
    [A, B, G].every(slowed) && mire.get(E)!.slow === '-' && parts('MIRE')[1] === 'Mire: 3 creatures go at 60% of their pace for 10 s.',
    island('MIRE'));
  const mass = new Map(parts('MASS')[0].split(',').map((x) => x.split(':') as [string, string]));
  check(`Mass Root: everything within ${fx('mass_root', 'reach')} tiles rooted, and nothing beyond`,
    [A, B, G].every((id) => mass.get(id) === 'true') && mass.get(E) === 'false'
      && parts('MASS')[1] === 'Mass Root: 3 creatures are rooted where they stand for 6 s.', island('MASS'));
}
{
  const [longer, cast] = parts('LONG');
  check(`a Long Hold: holds ${LONG} times as long, and a Bind reaching ${fx('bind', 'reach') * LONG} tiles`,
    near(Number(longer), LONG, 1e-9) && cast === 'cast', island('LONG'));
}
{
  const [cast, stamina] = parts('PAID');
  check(`the door charges ${pct(spell('still_skin').cost)} of your stamina and rests it ${spell('still_skin').rest} s`,
    cast === 'binder_still_skin' && near(Number(stamina), 1 - spell('still_skin').cost, 1e-9), island('PAID'));
  check('and will not call it again until it has rested', /can be called again in \d+ seconds\.$/.test(island('RESTING')), island('RESTING'));
}
check('the six passives fold on the island to what they fold to in the browser',
  island('FOLDED') === Object.keys(FOLD).filter((k) => /^(reach|chill|bind|still|ward):/.test(k)).sort()
    .map((k) => `${k}=${FOLD[k]}`).join(';'), island('FOLDED'));
check(`Far Reach: a Bind as far as ${fx('bind', 'reach') + FOLD['reach:spell']} tiles`, island('FAR') === 'cast', island('FAR'));
{
  const [share, slow, slowFor, took, heldFor] = parts('GRIP').map(Number);
  check(`Firm Grip: a hold ${pct(FOLD['bind:secs'] - 1)} longer`, near(share, fx('bind', 'hold') * FOLD['bind:secs'], 1e-6), island('GRIP'));
  check(`Lingering Chill: ${pct(FOLD['chill:pace'])} of its pace for ${FOLD['chill:secs']} s once the hold is over`,
    near(slow, FOLD['chill:pace'], 1e-6) && near(slowFor, heldFor + FOLD['chill:secs'], 1e-6), island('GRIP'));
  check(`Brittle Hold: ${pct(FOLD['bind:brittle'] - 1)} more from what strikes it while you hold it`, near(took, 10 * FOLD['bind:brittle'], 1e-4),
    island('GRIP'));
}
{
  const [still, chilled] = parts('WARD').map(Number);
  check(`Unmoved: ${pct(1 - FOLD['still:taken'])} less standing still, and Frost Ward ${pct(1 - FOLD['ward:stilled'])} less again from one slowed`,
    near(still, 0.05 * FOLD['still:taken'], 1e-9) && near(chilled, 0.05 * FOLD['still:taken'] * FOLD['ward:stilled'], 1e-9), island('WARD'));
}
check('no function is open to a player but the doors', island('OPEN') === '0', island('OPEN'));

/* ---- The browser's half ----------------------------------------------------- */

check(`each of the ${CLASS_TIER_AT.length} tiers offers two spells and a passive`,
  TIERS.binder.length === CLASS_TIER_AT.length && TIERS.binder.every((row) => row.length === 3
    && row.filter((num) => SPELLS.some((s) => s.num === num)).length === 2), JSON.stringify(TIERS.binder));
check('every spell says first that it wants a focus, in the words its refusal uses',
  SPELLS.every((s) => s.needs === 'binding' && s.note.startsWith(`${NEEDS_SAID.binding.has}: `)));
check('and every spell\'s perk says what it costs before what it does',
  SPELLS.every((s) => PERK_BY_ID.get(s.id)!.note.startsWith('Spell') && PERK_BY_ID.get(s.id)!.note.endsWith(s.note)));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Binder — ${ok.length} of ${ok.length}`);
