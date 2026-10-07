/**
 * The Sworn Blade: twelve spells and six passives in six tiers that open on
 * the trade's own level, on the island (`sworn_blade.sql`) and in the
 * browser's rulebook (`talents.ts`, `perks.ts`).
 *
 * What this asks:
 *
 *   * both sides hold the same twelve spells, field for field, the same six
 *     tiers at the same class levels, and the same constants;
 *   * the trade's own level: where it starts, what a blow and a kill teach
 *     (the curve every skill climbs), the tier it opens said when it does,
 *     and a tier not reached shut, in the same words on both sides;
 *   * a spell taken goes on the bar, is cast through `rpc_cast_spell` for its
 *     stamina and its rest, and is refused for want of either;
 *   * every spell does what its note says, measured: a blow at its share of
 *     the one a swing would land -- the same roll asked twice, of two
 *     creatures alike -- a creature turned, slowed, staggered or weakened, a
 *     blessing that holds for its while and does its work through the rule it
 *     changes;
 *   * every passive moves the number it names on the island, and where the
 *     browser draws the same number, the browser's is the island's;
 *   * and the trade put down takes its spells off the bar and its level back
 *     to where a new one starts, or to nothing when it is undone.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { CLASS_TIER_AT, CLASSES } from '../../src/game/classes';
import { BLOW_SHARE } from '../../src/game/creatures';
import { BLOCK_MOST, blockChance, STANCE_DEALT, STANCE_TAKEN, stanceDealt, stanceTaken, THREAT_HOLD } from '../../src/game/fight';
import { SHIELDS } from '../../src/game/gear';
import { SPELL_BAR } from '../../src/game/patrons';
import { foldPerks, perkRefusal, perksOf, PERK_BY_ID, TIERS } from '../../src/game/perks';
import {
  CLASS_LEARN_BLOW, CLASS_LEARN_KILL, CLASS_LEVEL_START, CLASS_SPELL_BY_ID, classSpellsOf, GUARDIAN_REACH, type ClassSpellDef,
} from '../../src/game/talents';

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

const SPELLS = classSpellsOf('blade');
const spell = (slug: string): ClassSpellDef => {
  const s = CLASS_SPELL_BY_ID.get(`blade_${slug}`);
  if (!s) throw new Error(`no blade_${slug}`);
  return s;
};
const fx = (slug: string, k: string): number => spell(slug).fx[k];
const PASSIVES = perksOf('blade').filter((p) => !CLASS_SPELL_BY_ID.has(p.id));
/** What the six passives fold to, which is what the browser reads a Sworn Blade's numbers from. */
const FOLD = foldPerks(PASSIVES.map((p) => p.id));
const perk = (k: string, d: number): number => FOLD[k] ?? d;
const none = (_k: string, d: number): number => d;
const BLADE = CLASSES.find((c) => c.id === 'blade')!;
const FIRST_CLASS_SLOT = SPELL_BAR.indexOf('class');
const FAITH_SLOT = SPELL_BAR.indexOf('faith');

/** Every blow a spell strikes, with what makes it its own: a blow that cannot miss, and a shield's crush. */
const BLOWS = SPELLS.filter((s) => s.fx.more !== undefined).map((s) => ({
  s, sure: s.id === 'blade_measured_cut', kind: s.id === 'blade_shield_bash' ? `'crush'` : 'null',
}));

/** A spell's row as the island prints it and as the browser would: every field, the numbers by name. */
const rowOf = (s: ClassSpellDef): string =>
  [s.id, s.class, s.num, s.name, s.cost, s.rest, s.on.join('+'),
    Object.keys(s.fx).sort().map((k) => `${k}=${s.fx[k]}`).join(';'), s.note].join('¦');

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w record; o uuid; v_px double precision; v_py double precision; r jsonb; c creature; sh shield_def;
        a int; b int; t int; n int; k int; v_sword bigint; v_shield bigint; v_axe bigint; v_metal bigint;
        h0 double precision; d1 double precision; d2 double precision; lv double precision; v_seed double precision;
        x0 double precision; y0 double precision; m0 double precision; m1 double precision;
        v_wind0 double precision; v_axe0 double precision; v_taken0 double precision; v_dealt0 double precision;
        v_block0 double precision; v_block1 double precision; v_name text;
begin
  -- An island with land and two people on it.
  select p.world_id, p.uid, wd.spawn_x, wd.spawn_y into w from player p join world wd on wd.id = p.world_id
   where exists (select 1 from land_tile lt where lt.world_id = wd.id)
     and (select count(*) from player q where q.world_id = p.world_id) >= 2
   order by wd.size desc, p.world_id, p.uid limit 1;
  select uid into o from player where world_id = w.world_id and uid <> w.uid order by uid limit 1;
  -- Outside the peace round the spawn, where a body can walk four tiles east: a Lunge's stride.
  for n in 0..59 loop
    v_px := w.spawn_x + peace_reach() + 4.5 + (n % 20) * 3; v_py := w.spawn_y + 0.5 + (n / 20) * 5;
    exit when walk_share(w.world_id, w.uid, 0, v_px, v_py, v_px + 4, v_py) >= 0.999;
  end loop;
  update placed set driver = null where world_id = w.world_id and driver in (w.uid, o);
  update player set x = v_px, y = v_py, level = 0, aboard = null, away = false, act = null, act_target = null,
         equipped = '{}'::jsonb, wounds = '[]'::jsonb, fight_stance = 'balanced', blessings = '{}'::jsonb,
         used_at = '{}'::jsonb, body_at = now(), craft_class = null, combat_class = null, class_mul = null, class_level = 0,
         spell_bar = (select jsonb_agg('null'::jsonb) from spell_slot),
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('health', 1, 'hunger', 1, 'thirst', 1, 'stamina', 1, 'aegis', 0)
   where world_id = w.world_id and uid in (w.uid, o);
  -- The other person well out of the way until a Guardian is wanted.
  update player set x = v_px - 30 where world_id = w.world_id and uid = o;
  insert into skill (world_id, uid, id, value)
    select w.world_id, u, s, v from (values (w.uid), (o)) us(u),
      (values ('swords', 55::double precision), ('shields', 50), ('fighting', 10), ('body_control', 1), ('axes', 30)) sv(s, v)
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
  -- A sword in hand, and a shield, an axe and a better shield to hand.
  v_sword := give(w.world_id, w.uid, 'sword', 1, 40);
  v_shield := give(w.world_id, w.uid, 'wooden_shield', 1, 40);
  v_axe := give(w.world_id, w.uid, 'battle_axe', 1, 40);
  v_metal := give(w.world_id, w.uid, 'metal_shield', 1, 100);
  update player set equipped = jsonb_build_object('weapon', v_sword) where world_id = w.world_id and uid = w.uid;

  /* ---- The rows ---- */
  insert into said select 'SPELL:' || id, id || '¦' || class || '¦' || num || '¦' || name || '¦' || cost || '¦' || rest || '¦'
      || array_to_string(on_what, '+') || '¦' || coalesce((select string_agg(e.k || '=' || e.v, ';' order by e.k) from jsonb_each_text(fx) e(k, v)), '')
      || '¦' || note
    from class_spell where class = 'blade';
  insert into said select 'TIERS', string_agg(tier || ':' || at, ',' order by tier) from class_tier;
  insert into said values ('CONST', class_level_start() || '|' || class_learn_blow() || '|' || class_learn_kill()
    || '|' || guardian_reach() || '|' || block_most());

  /* ---- The level, and the door ---- */
  insert into said values ('TAKE', coalesce(rpc_take_class(w.world_id, 'blade')->>'why', 'took'));
  insert into said select 'START', class_level::text from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('SHUT', rpc_take_perk(w.world_id, 'blade_lunge')->>'why');
  insert into said values ('UNKNOWN', rpc_spell_bar(w.world_id, ${FIRST_CLASS_SLOT + 1}, 'blade_lunge')->>'why');
  r := rpc_take_perk(w.world_id, 'blade_measured_cut');
  insert into said select 'BAR', coalesce(r->>'took', r->>'why') || '|' || coalesce(spell_bar->>${FIRST_CLASS_SLOT}, 'empty')
    || '|' || (faith_said(w.world_id, w.uid)->'classSpells')::text from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('CLOSED', rpc_take_perk(w.world_id, 'blade_challenge')->>'why');
  insert into said values ('FAITHSLOT', rpc_spell_bar(w.world_id, ${FAITH_SLOT}, 'blade_measured_cut')->>'why');

  -- What a blow teaches: a step of the curve every skill climbs, rolled as a skill's is.
  select class_level into lv from player where world_id = w.world_id and uid = w.uid;
  perform class_learn(w.world_id, w.uid, class_learn_blow());
  insert into said select 'LEARN', (class_level - lv) || '|' || skill_gain_of(lv, class_learn_blow(), 0.6)
    || '|' || skill_gain_of(lv, class_learn_blow(), 1.4) from player where world_id = w.world_id and uid = w.uid;
  -- And the tier it opens, said when it does.
  update player set class_level = ${CLASS_TIER_AT[1]} - 0.0001 where world_id = w.world_id and uid = w.uid;
  delete from event where uid = w.uid;
  perform class_learn(w.world_id, w.uid, class_learn_kill());
  insert into said select 'OPENS', (class_level >= ${CLASS_TIER_AT[1]})::text || '|'
    || coalesce((select e.text from event e where e.world_id = w.world_id and e.uid = w.uid order by e.n desc limit 1), 'nothing said')
    from player where world_id = w.world_id and uid = w.uid;
  -- Somebody with no fighting trade learns nothing.
  perform class_learn(w.world_id, o, class_learn_kill());
  insert into said select 'NOBODY', class_level::text from player where world_id = w.world_id and uid = o;
  -- The tree the Trades window draws, at a level between the third tier and the fourth.
  update player set class_level = ${CLASS_TIER_AT[2]} + 5 where world_id = w.world_id and uid = w.uid;
  insert into said select 'TREE', (tr->>'level') || '|' || (select string_agg((x->>'tier') || ':' || (x->>'at') || ':' || (x->>'open'), ',' order by (x->>'tier')::int)
      from jsonb_array_elements(tr->'tiers') x)
    from jsonb_array_elements(rpc_tree(w.world_id)->'trades') tr where tr->>'class' = 'blade';

  /* ---- A blow with a spell, at its share of a swing's: the same roll, asked twice ---- */
  update skill set value = 100 where world_id = w.world_id and uid = w.uid and id in ('swords', 'fighting');
  update player set equipped = jsonb_build_object('weapon', v_sword, 'offhand', v_shield) where world_id = w.world_id and uid = w.uid;
  -- Every spell known from here, as though a tier had been taken six times over.
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, cs.id from class_spell cs where cs.class = 'blade'
    on conflict do nothing;
  ${BLOWS.map(({ s, sure, kind }) => `
  a := creature_spawn(w.world_id, 'rowl', v_px + 1.5, v_py + 1, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'rowl', v_px + 1.5, v_py - 1, 'wild', now() - interval '2 hours', null);
  -- Both already on you, as anything is that you are fighting.
  update creature set traits = '{}', rare = null, hunting = w.uid, enemy = null, hunt_again = null, settled_at = now(),
         until = now() + interval '1 hour', windup_at = null where world_id = w.world_id and id in (a, b);
  -- Both winding up a blow, a second from landing it: what a Shield Bash knocks off its stroke.
  update creature set health = max_health(creature), windup_at = now(), until = now() + interval '1 second'
    where world_id = w.world_id and id in (a, b);
  -- A roll that lands, the first of a few seeds that does.
  for k in 1..12 loop
    v_seed := k / 100.0;
    update item set dmg = 0 where id = v_sword;
    perform setseed(v_seed);
    perform creature_settle(w.world_id, a);
    r := class_blow(w.world_id, w.uid, a, 1, ${sure}, ${kind});
    exit when (r->>'landed')::boolean;
    update creature set health = max_health(creature), hunting = w.uid, enemy = null, hunt_again = null, settled_at = now(),
           windup_at = now(), until = now() + interval '1 second' where world_id = w.world_id and id = a;
  end loop;
  d1 := (r->>'dmg')::double precision;
  update item set dmg = 0 where id = v_sword;
  perform setseed(v_seed);
  r := class_spell_cast(w.world_id, w.uid, '${s.id}', jsonb_build_object('kind', 'enemy', 'id', b));
  insert into said values ('BLOW:${s.id}', ((r->'blow'->>'dmg')::double precision / d1) || '|' || coalesce(r->'blow'->>'landed', r->>'why'));
  select * into c from creature where world_id = w.world_id and id = b;
  ${s.id === 'blade_hamstring' ? `
  insert into said values ('HAM', c.slow || '|' || extract(epoch from c.slow_until - now()) || '|'
    || (beast_mul(c, 'speed') / beast_mul((select x from creature x where x.world_id = w.world_id and x.id = a), 'speed')));
  update creature set slow_until = now() - interval '1 second' where world_id = w.world_id and id = b;
  select * into c from creature where world_id = w.world_id and id = b;
  insert into said values ('HAM:OVER', (beast_mul(c, 'speed') / beast_mul((select x from creature x where x.world_id = w.world_id and x.id = a), 'speed'))::text);` : ''}
  ${s.id === 'blade_shield_bash' ? `
  insert into said values ('BASH', (c.windup_at is null)::text || '|' || extract(epoch from c.until - now()) || '|' || (r->>'said'));` : ''}
  ${s.id === 'blade_disarming_cut' ? `
  insert into said select 'DISARM', cm.val || '|' || cm.n || '|' || extract(epoch from cm.until - now()) from class_mark cm
    where cm.world_id = w.world_id and cm.creature_id = b and cm.kind = 'disarm';
  insert into said values ('DISARM:TAKE', class_disarm_take(w.world_id, b) || ',' || class_disarm_take(w.world_id, b) || ','
    || class_disarm_take(w.world_id, b) || ',' || class_disarm_take(w.world_id, b));
  -- Asked in a statement of its own, which sees what the four did.
  update said sd set v = sd.v || '|' || (select count(*) from class_mark where world_id = w.world_id and creature_id = b) where sd.k = 'DISARM:TAKE';` : ''}
  delete from creature where world_id = w.world_id and id in (a, b);`).join('')}
  delete from class_mark where world_id = w.world_id;

  -- A Measured Cut cannot miss, with a hand that would miss a swing more often than not.
  update skill set value = 0 where world_id = w.world_id and uid = w.uid and id in ('swords', 'fighting');
  a := creature_spawn(w.world_id, 'ogre', v_px + 1.5, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, settled_at = now(), until = now() + interval '1 hour' where world_id = w.world_id and id = a;
  t := 0; k := 0;
  for n in 1..30 loop
    update creature set health = max_health(creature), hunting = null where world_id = w.world_id and id = a;
    if (class_spell_cast(w.world_id, w.uid, 'blade_measured_cut', jsonb_build_object('kind', 'enemy', 'id', a))->'blow'->>'landed')::boolean then t := t + 1; end if;
    update creature set health = max_health(creature), hunting = null where world_id = w.world_id and id = a;
    if (class_blow(w.world_id, w.uid, a, 1)->>'landed')::boolean then k := k + 1; end if;
  end loop;
  insert into said values ('SURE', t || '|' || k);
  delete from creature where world_id = w.world_id and id = a;
  update skill set value = 100 where world_id = w.world_id and uid = w.uid and id in ('swords', 'fighting');

  /* ---- Lunge: a stride to it, through the door ---- */
  delete from caller where uid = w.uid;
  perform spell_bar_put(w.world_id, w.uid, ${FIRST_CLASS_SLOT + 1}, 'blade_lunge');
  a := creature_spawn(w.world_id, 'rowl', v_px + 3.5, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, settled_at = now(), until = now() + interval '1 hour' where world_id = w.world_id and id = a;
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  r := rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT + 1}, jsonb_build_object('kind', 'creature', 'id', a));
  -- Every place as tiles from where the body stood.
  insert into said select 'LUNGE', coalesce(r->>'why', 'cast') || '|' || ((r->'put'->>'x')::double precision - v_px)
    || '|' || ((r->'put'->>'y')::double precision - v_py) || '|' || (pl.x - v_px) || '|' || (pl.y - v_py)
    || '|' || melee_reach(w.world_id, w.uid) || '|' || (creature_x(c2) - v_px) || '|' || (creature_y(c2) - v_py)
    from player pl, creature c2 where pl.world_id = w.world_id and pl.uid = w.uid and c2.world_id = w.world_id and c2.id = a;
  update player set x = v_px, y = v_py, used_at = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  update creature set from_x = v_px + 5, to_x = v_px + 5, from_y = v_py, to_y = v_py, hunting = null, enemy = null, settled_at = now()
    where world_id = w.world_id and id = a;
  insert into said values ('LUNGE:FAR', rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT + 1}, jsonb_build_object('kind', 'creature', 'id', a))->>'why');
  delete from creature where world_id = w.world_id and id = a;

  /* ---- The door: stamina, rest, and a shield ---- */
  delete from caller where uid = w.uid;
  a := creature_spawn(w.world_id, 'ogre', v_px + 1.5, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, settled_at = now(), until = now() + interval '1 hour' where world_id = w.world_id and id = a;
  update player set used_at = '{}'::jsonb, stats = jsonb_set(stats, '{stamina}', '1') where world_id = w.world_id and uid = w.uid;
  r := rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'creature', 'id', a));
  insert into said select 'PAID', coalesce(r->>'cast', r->>'why') || '|' || (stats->>'stamina') || '|' || (r->'rest'->>'blade_measured_cut')
    || '|' || (r->>'stamina') from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('RESTING', rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'creature', 'id', a))->>'why');
  update player set used_at = '{}'::jsonb, stats = jsonb_set(stats, '{stamina}', '0.05') where world_id = w.world_id and uid = w.uid;
  insert into said values ('TIRED', rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT}, jsonb_build_object('kind', 'creature', 'id', a))->>'why');
  update player set equipped = jsonb_build_object('weapon', v_sword), stats = jsonb_set(stats, '{stamina}', '1') where world_id = w.world_id and uid = w.uid;
  insert into said values ('NOSHIELD', spell_cast_refusal(w.world_id, w.uid, 'blade_shield_bash'));
  update player set equipped = jsonb_build_object('weapon', v_sword, 'offhand', v_shield) where world_id = w.world_id and uid = w.uid;
  insert into said values ('SHIELD', coalesce(spell_cast_refusal(w.world_id, w.uid, 'blade_shield_bash'), 'ready'));

  -- Second Breath: no stamina, and its share of a bar back.
  perform spell_bar_put(w.world_id, w.uid, ${FIRST_CLASS_SLOT + 2}, 'blade_second_breath');
  update player set stats = jsonb_set(stats, '{stamina}', '0.3') where world_id = w.world_id and uid = w.uid;
  r := rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT + 2}, jsonb_build_object('kind', 'self'));
  insert into said select 'BREATH2', coalesce(r->>'cast', r->>'why') || '|' || (stats->>'stamina') from player where world_id = w.world_id and uid = w.uid;
  update player set used_at = '{}'::jsonb, stats = jsonb_set(stats, '{stamina}', '0.9') where world_id = w.world_id and uid = w.uid;
  perform rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT + 2}, jsonb_build_object('kind', 'self'));
  insert into said select 'BREATH2:FULL', stats->>'stamina' from player where world_id = w.world_id and uid = w.uid;

  /* ---- Challenge and Guardian's Call: turned on you ---- */
  update player set x = v_px - 3, y = v_py where world_id = w.world_id and uid = o;
  update creature set hunting = o, health = max_health(creature) where world_id = w.world_id and id = a;
  r := class_spell_cast(w.world_id, w.uid, 'blade_challenge', jsonb_build_object('kind', 'enemy', 'id', a));
  insert into said select 'CHALLENGE', (hunting = w.uid)::text || '|' || extract(epoch from threat_at - now()) || '|' || coalesce(r->>'said', r->>'why')
    from creature where world_id = w.world_id and id = a;
  -- A blow of your own on it after does not cut the hold short.
  perform engage_beast(w.world_id, a, w.uid);
  insert into said select 'CHALLENGE:HELD', extract(epoch from threat_at - now())::text from creature where world_id = w.world_id and id = a;
  b := creature_spawn(w.world_id, 'rabba', v_px + 1.5, v_py + 1, 'wild', now() - interval '2 hours', null);
  insert into said values ('TIMID', class_spell_cast(w.world_id, w.uid, 'blade_challenge', jsonb_build_object('kind', 'enemy', 'id', b))->>'why');
  delete from creature where world_id = w.world_id and id in (a, b);

  insert into said values ('CALL:NONE', class_spell_cast(w.world_id, w.uid, 'blade_guardians_call', jsonb_build_object('kind', 'self'))->>'why');
  a := creature_spawn(w.world_id, 'rowl', v_px + 2, v_py + 2, 'wild', now() - interval '2 hours', null);
  b := creature_spawn(w.world_id, 'rowl', v_px - 3, v_py + 1, 'wild', now() - interval '2 hours', null);
  t := creature_spawn(w.world_id, 'rowl', v_px + ${fx('guardians_call', 'reach')} + 2, v_py, 'wild', now() - interval '2 hours', null);
  k := creature_spawn(w.world_id, 'rowl', v_px + 1, v_py - 2, 'wild', now() - interval '2 hours', null);
  update creature set settled_at = now(), until = now() + interval '1 hour', hunting = case when id = k then null else o end
    where world_id = w.world_id and id in (a, b, t, k);
  r := class_spell_cast(w.world_id, w.uid, 'blade_guardians_call', jsonb_build_object('kind', 'self'));
  insert into said select 'CALL', string_agg(case when hunting = w.uid then 'you' when hunting = o then 'them' else 'nobody' end
      || ':' || coalesce(round(extract(epoch from threat_at - now())::numeric, 3)::text, '-'), ',' order by case id when a then 1 when b then 2 when t then 3 else 4 end)
      || '|' || coalesce(r->>'said', r->>'why')
    from creature where world_id = w.world_id and id in (a, b, t, k);
  delete from creature where world_id = w.world_id and id in (a, b, t, k);

  /* ---- The passives: each number, before and after ---- */
  update player set equipped = jsonb_build_object('weapon', v_sword, 'offhand', v_shield) where world_id = w.world_id and uid = w.uid;
  v_wind0 := act_wind(w.world_id, w.uid, 'attack_creature', 0);
  update player set equipped = jsonb_build_object('weapon', v_axe) where world_id = w.world_id and uid = w.uid;
  v_axe0 := act_wind(w.world_id, w.uid, 'attack_creature', 0);
  v_taken0 := my_stance_taken(w.world_id, w.uid, 'defensive');
  v_dealt0 := my_stance_dealt(w.world_id, w.uid, 'defensive');
  select * into sh from shield_def where id = 'wooden_shield';
  v_block0 := shield_block(w.world_id, w.uid, sh, 40);
  select * into sh from shield_def where id = 'metal_shield';
  update skill set value = 100 where world_id = w.world_id and uid = w.uid and id = 'shields';
  v_block1 := shield_block(w.world_id, w.uid, sh, 100);
  update skill set value = 50 where world_id = w.world_id and uid = w.uid and id = 'shields';
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, k2.id from class_perk k2
    where k2.class = 'blade' and not exists (select 1 from class_spell cs where cs.id = k2.id)
    on conflict do nothing;
  perform class_fold(w.world_id, w.uid);
  update player set equipped = jsonb_build_object('weapon', v_sword, 'offhand', v_shield) where world_id = w.world_id and uid = w.uid;
  insert into said values ('LIGHT', (act_wind(w.world_id, w.uid, 'attack_creature', 0) / v_wind0)::text);
  update player set equipped = jsonb_build_object('weapon', v_axe) where world_id = w.world_id and uid = w.uid;
  insert into said values ('LIGHT:AXE', (act_wind(w.world_id, w.uid, 'attack_creature', 0) / v_axe0)::text);
  insert into said values ('STALWART', v_taken0 || '|' || v_dealt0 || '|' || my_stance_taken(w.world_id, w.uid, 'defensive')
    || '|' || my_stance_dealt(w.world_id, w.uid, 'defensive') || '|' || my_stance_taken(w.world_id, w.uid, 'balanced'));
  select * into sh from shield_def where id = 'wooden_shield';
  insert into said values ('MASTERY', v_block0 || '|' || shield_block(w.world_id, w.uid, sh, 40));
  select * into sh from shield_def where id = 'metal_shield';
  update skill set value = 100 where world_id = w.world_id and uid = w.uid and id = 'shields';
  insert into said values ('MASTERY:BEST', v_block1 || '|' || shield_block(w.world_id, w.uid, sh, 100));
  sh.block := 0.9;
  insert into said values ('MASTERY:CAP', shield_block(w.world_id, w.uid, sh, 100)::text);
  update skill set value = 50 where world_id = w.world_id and uid = w.uid and id = 'shields';
  insert into said select 'FOLDED', coalesce((select string_agg(e.k || '=' || e.v, ';' order by e.k collate "C")
      from jsonb_each_text(class_mul->'fx') e(k, v) where e.k ~ '^(wind|stagger|severity|stance|cover|block|blockcap):'), 'none')
    from player where world_id = w.world_id and uid = w.uid;

  -- Battle-Hardened and Stalwart, through a blow that lands: no shield, no armour, nothing on you but the one.
  a := creature_spawn(w.world_id, 'rowl', v_px + 1.5, v_py, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, settled_at = now(), until = now() + interval '1 hour', hunting = w.uid where world_id = w.world_id and id = a;
  update player set equipped = jsonb_build_object('weapon', v_sword), wounds = '[]'::jsonb, act = null, act_target = null,
         stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{hurtBy}', to_jsonb(a)) where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.1, 'A test blow', 'cut');
  insert into said select 'HARDENED', (1 - (stats->>'health')::double precision) || '|' || (wounds->0->>'severity')
    from player where world_id = w.world_id and uid = w.uid;
  update player set fight_stance = 'defensive', wounds = '[]'::jsonb, act = null, act_target = null, stats = jsonb_set(stats, '{health}', '1')
    where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.1, 'A test blow', 'cut');
  insert into said select 'STALWART:BLOW', (1 - (stats->>'health')::double precision)::text from player where world_id = w.world_id and uid = w.uid;
  update player set fight_stance = 'balanced' where world_id = w.world_id and uid = w.uid;

  /* ---- Deflect and Counterweight: a blow blocked ---- */
  delete from caller where uid = w.uid;
  r := class_spell_cast(w.world_id, w.uid, 'blade_deflect', jsonb_build_object('kind', 'self'));
  insert into said select 'DEFLECT', (blessings->'deflect'->>'share') || '|' || extract(epoch from (blessings->'deflect'->>'until')::timestamptz - now())
    from player where world_id = w.world_id and uid = w.uid;
  update player set equipped = jsonb_build_object('weapon', v_sword, 'offhand', v_shield) where world_id = w.world_id and uid = w.uid;
  perform setseed(0.5);
  for n in 1..80 loop
    update player set wounds = '[]'::jsonb, act = null, act_target = null, stats = jsonb_set(stats, '{health}', '1')
      where world_id = w.world_id and uid = w.uid;
    perform hurt_player(w.world_id, w.uid, 0.1, 'A test blow', 'cut');
    exit when exists (select 1 from faith_owed where world_id = w.world_id and creature_id = a);
  end loop;
  insert into said select 'DEFLECTED', coalesce((select dmg::text from faith_owed where world_id = w.world_id and creature_id = a), 'never blocked')
    || '|' || (select stats->>'health' from player where world_id = w.world_id and uid = w.uid);
  insert into said select 'COUNTER', coalesce((select val::text from class_mark where world_id = w.world_id and creature_id = a and kind = 'stagger'), 'none')
    || '|' || extract(epoch from class_stagger_owed(w.world_id, a)) || '|' || extract(epoch from class_stagger_owed(w.world_id, a));
  -- And the turn that pays it: the creature's own, which writes its row back at the end.
  insert into said select 'COUNTER:PAID', count(*)::text from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'hunt_settle'
     and (length(pg_get_functiondef(p.oid)) - length(replace(pg_get_functiondef(p.oid), 'class_stagger_owed(p_world, c.id)', ''))) / length('class_stagger_owed(p_world, c.id)') = 3;
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;

  /* ---- Last Stand ---- */
  update player set equipped = jsonb_build_object('weapon', v_sword), wounds = '[]'::jsonb, act = null, act_target = null,
         used_at = '{}'::jsonb, stats = jsonb_set(jsonb_set(stats, '{health}', '0.5'), '{stamina}', '1') where world_id = w.world_id and uid = w.uid;
  insert into said values ('LAST:HIGH', spell_cast_refusal(w.world_id, w.uid, 'blade_last_stand'));
  update player set stats = jsonb_set(stats, '{health}', '0.2') where world_id = w.world_id and uid = w.uid;
  perform spell_bar_put(w.world_id, w.uid, ${FIRST_CLASS_SLOT + 2}, 'blade_last_stand');
  delete from caller where uid = w.uid;
  r := rpc_cast_spell(w.world_id, ${FIRST_CLASS_SLOT + 2}, jsonb_build_object('kind', 'self'));
  insert into said select 'LAST', coalesce(r->>'cast', r->>'why') || '|' || (stats->>'stamina') || '|'
    || extract(epoch from (blessings->'last_stand'->>'until')::timestamptz - now()) from player where world_id = w.world_id and uid = w.uid;
  -- And with the passives' blow measured off: Battle-Hardened changes the wound, not the health.
  perform hurt_player(w.world_id, w.uid, 0.1, 'A test blow', 'cut');
  insert into said select 'LAST:BLOW', (0.2 - (stats->>'health')::double precision)::text from player where world_id = w.world_id and uid = w.uid;
  update player set blessings = '{}'::jsonb, stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = w.uid;

  /* ---- Disarming Cut, through a blow that lands ---- */
  update player set equipped = jsonb_build_object('weapon', v_sword), wounds = '[]'::jsonb, act = null, act_target = null where world_id = w.world_id and uid = w.uid;
  insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
    values (w.world_id, a, 'disarm', ${fx('disarming_cut', 'cut')}, ${fx('disarming_cut', 'blows')}, now() + interval '30 seconds', w.uid);
  perform hurt_player(w.world_id, w.uid, 0.1, 'A test blow', 'cut');
  insert into said select 'DISARM:BLOW', (1 - (stats->>'health')::double precision)::text from player where world_id = w.world_id and uid = w.uid;
  delete from class_mark where world_id = w.world_id;

  /* ---- Hold the Line: a bleed cut, and an arm that does not slow the swing ---- */
  update player set blessings = '{}'::jsonb, wounds = jsonb_build_array(jsonb_build_object('kind', 'cut', 'part', 'arms', 'severity', 0.2,
         'bleeding', true, 'infected', false, 'dressing', null, 'at', now())),
         stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{hurtSettled}', to_jsonb(now() - interval '10 seconds'))
    where world_id = w.world_id and uid = w.uid;
  m0 := act_base(w.world_id, w.uid, 'attack_creature', 1);
  select wound_drain(wounds->0) into d1 from player where world_id = w.world_id and uid = w.uid;
  perform setseed(0.9);
  perform wounds_settle(w.world_id, w.uid);
  select 1 - (stats->>'health')::double precision into d2 from player where world_id = w.world_id and uid = w.uid;
  r := class_spell_cast(w.world_id, w.uid, 'blade_hold_the_line', jsonb_build_object('kind', 'self'));
  -- Held for all of the ten seconds being settled.
  update player set blessings = jsonb_set(blessings, '{hold_line,from}', to_jsonb(now() - interval '10 seconds')),
         wounds = jsonb_build_array(jsonb_build_object('kind', 'cut', 'part', 'arms', 'severity', 0.2,
         'bleeding', true, 'infected', false, 'dressing', null, 'at', now())),
         stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{hurtSettled}', to_jsonb(now() - interval '10 seconds'))
    where world_id = w.world_id and uid = w.uid;
  m1 := act_base(w.world_id, w.uid, 'attack_creature', 1);
  perform setseed(0.9);
  perform wounds_settle(w.world_id, w.uid);
  insert into said select 'HOLD', d1 || '|' || d2 || '|' || (1 - (stats->>'health')::double precision) || '|'
    || extract(epoch from (blessings->'hold_line'->>'until')::timestamptz - now()) || '|' || (blessings->'hold_line'->>'bleed')
    from player where world_id = w.world_id and uid = w.uid;
  update player set wounds = '[]'::jsonb where world_id = w.world_id and uid = w.uid;
  insert into said values ('HOLD:ARM', m0 || '|' || m1 || '|' || act_base(w.world_id, w.uid, 'attack_creature', 1));
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;

  /* ---- Measured Breathing ---- */
  r := class_spell_cast(w.world_id, w.uid, 'blade_measured_breathing', jsonb_build_object('kind', 'self'));
  insert into said values ('BREATHING', act_wind(w.world_id, w.uid, 'attack_creature', 0) || '|' || act_wind(w.world_id, w.uid, 'shoot_creature', 0)
    || '|' || act_wind(w.world_id, w.uid, 'mine', 0.25));
  update player set blessings = jsonb_set(blessings, '{breathing,until}', to_jsonb(now() - interval '1 second')) where world_id = w.world_id and uid = w.uid;
  insert into said values ('BREATHING:OVER', (act_wind(w.world_id, w.uid, 'attack_creature', 0) > 0)::text);
  update player set blessings = '{}'::jsonb where world_id = w.world_id and uid = w.uid;

  /* ---- Guardian: another person's blow on your shield ---- */
  select name into v_name from player where world_id = w.world_id and uid = w.uid;
  update player set equipped = jsonb_build_object('weapon', v_sword, 'offhand', v_shield) where world_id = w.world_id and uid = w.uid;
  update player set x = v_px + 1, y = v_py, equipped = '{}'::jsonb, wounds = '[]'::jsonb, act = null, act_target = null,
         stats = jsonb_set(stats, '{hurtBy}', to_jsonb(a)) where world_id = w.world_id and uid = o;
  delete from event where uid = o;
  perform setseed(0.3);
  t := 0;
  for n in 1..200 loop
    update player set stats = jsonb_set(stats, '{health}', '1'), wounds = '[]'::jsonb, act = null, act_target = null where world_id = w.world_id and uid = o;
    perform hurt_player(w.world_id, o, 0.05, 'A test blow', 'cut');
    if (select (stats->>'health')::double precision from player where world_id = w.world_id and uid = o) = 1 then t := t + 1; end if;
  end loop;
  insert into said values ('GUARDIAN', t || '|' || coalesce((select e.text from event e where e.world_id = w.world_id and e.uid = o
    and e.text like v_name || ' takes%' order by e.n desc limit 1), 'never said'));
  -- Beyond its reach, and without a shield, nobody's.
  update player set x = v_px + ${GUARDIAN_REACH} + 0.5 where world_id = w.world_id and uid = o;
  t := 0;
  for n in 1..60 loop
    update player set stats = jsonb_set(stats, '{health}', '1'), wounds = '[]'::jsonb where world_id = w.world_id and uid = o;
    perform hurt_player(w.world_id, o, 0.05, 'A test blow', 'cut');
    if (select (stats->>'health')::double precision from player where world_id = w.world_id and uid = o) = 1 then t := t + 1; end if;
  end loop;
  update player set x = v_px + 1 where world_id = w.world_id and uid = o;
  update player set equipped = jsonb_build_object('weapon', v_sword) where world_id = w.world_id and uid = w.uid;
  k := 0;
  for n in 1..60 loop
    update player set stats = jsonb_set(stats, '{health}', '1'), wounds = '[]'::jsonb where world_id = w.world_id and uid = o;
    perform hurt_player(w.world_id, o, 0.05, 'A test blow', 'cut');
    if (select (stats->>'health')::double precision from player where world_id = w.world_id and uid = o) = 1 then k := k + 1; end if;
  end loop;
  insert into said values ('GUARDIAN:NOT', t || '|' || k);
  -- And a companion, struck by a wild thing.
  update player set equipped = jsonb_build_object('weapon', v_sword, 'offhand', v_shield) where world_id = w.world_id and uid = w.uid;
  b := creature_spawn(w.world_id, 'rowl', v_px + 1, v_py + 1, 'active', now() - interval '2 hours', o);
  update creature set traits = '{}', rare = null, settled_at = now(), until = now() + interval '1 hour' where world_id = w.world_id and id = b;
  perform setseed(0.3);
  t := 0;
  for n in 1..200 loop
    update creature set health = max_health(creature) where world_id = w.world_id and id = b;
    select health into h0 from creature where world_id = w.world_id and id = b;
    perform creature_attack(w.world_id, a, b);
    if (select health from creature where world_id = w.world_id and id = b) = h0 then t := t + 1; end if;
  end loop;
  insert into said values ('GUARDIAN:BEAST', t::text);
  delete from creature where world_id = w.world_id and id in (a, b);

  /* ---- Put down ---- */
  delete from caller where uid = w.uid;
  update player set spell_bar = (select jsonb_agg(case when s.slot = ${FAITH_SLOT} then 'null'::jsonb
      when s.school = 'class' then to_jsonb('blade_measured_cut'::text) else 'null'::jsonb end order by s.slot) from spell_slot s)
    where world_id = w.world_id and uid = w.uid;
  perform spell_bar_put(w.world_id, w.uid, ${FIRST_CLASS_SLOT + 1}, 'blade_lunge');
  perform give_coins(w.world_id, w.uid, class_change_cost()::bigint);
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'axes', 60)
    on conflict (world_id, uid, id) do update set value = 60;
  r := rpc_take_class(w.world_id, 'berserker');
  insert into said select 'DOWN', coalesce(r->>'took', r->>'why') || '|' || class_level || '|'
    || (select count(*) from player_node pn where pn.world_id = w.world_id and pn.uid = w.uid and pn.node like 'blade\\_%') || '|'
    || (select count(*) from spell_slot s where s.school = 'class' and spell_bar->>s.slot is not null) || '|'
    || spell_known(w.world_id, w.uid, 'blade_measured_cut')
    from player where world_id = w.world_id and uid = w.uid;
  perform give(w.world_id, w.uid, 'bauble_regret', 1, 40);
  r := rpc_regret_class(w.world_id, 'combat');
  insert into said select 'UNDONE', coalesce(r->>'undone', r->>'why') || '|' || class_level || '|' || coalesce(combat_class, 'none')
    from player where world_id = w.world_id and uid = w.uid;
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

/* ---- What came back: the rows ---------------------------------------------- */

{
  const wrong = SPELLS.filter((s) => island(`SPELL:${s.id}`) !== rowOf(s));
  check(`both sides hold the Sworn Blade's ${SPELLS.length} spells, field for field`,
    SPELLS.length === 12 && wrong.length === 0 && [...said.keys()].filter((k) => k.startsWith('SPELL:')).length === SPELLS.length,
    wrong.length ? `island ${island(`SPELL:${wrong[0].id}`)}, browser ${rowOf(wrong[0])}` : `${SPELLS.length} of them`);
}
check(`and the same ${CLASS_TIER_AT.length} tiers, at class levels ${CLASS_TIER_AT.join(', ')}`,
  island('TIERS') === CLASS_TIER_AT.map((at, i) => `${i + 1}:${at}`).join(','), island('TIERS'));
check('and the same constants: the level a trade starts at, what a blow and a kill teach, a Guardian\'s reach and the most a shield blocks',
  island('CONST') === [CLASS_LEVEL_START, CLASS_LEARN_BLOW, CLASS_LEARN_KILL, GUARDIAN_REACH, BLOCK_MOST].join('|'), island('CONST'));

/* ---- The level, and the door ------------------------------------------------- */

check('the trade is taken up', island('TAKE') === 'took', island('TAKE'));
check(`at class level ${CLASS_LEVEL_START}`, Number(island('START')) === CLASS_LEVEL_START, island('START'));
{
  const lunge = PERK_BY_ID.get('blade_lunge')!;
  const want = perkRefusal(lunge, 'blade', [], CLASS_LEVEL_START);
  check(`a tier not reached is shut, in the same words on both sides`, island('SHUT') === want, `island "${island('SHUT')}", browser "${want}"`);
}
check('a spell not taken cannot go on the bar', island('UNKNOWN') === 'You do not have that spell.', island('UNKNOWN'));
check(`a spell taken goes on the bar's first slot for the trade's spells, and is among the ones you know`,
  island('BAR') === `blade_measured_cut|blade_measured_cut|["blade_measured_cut"]`, island('BAR'));
{
  const want = perkRefusal(PERK_BY_ID.get('blade_challenge')!, 'blade', ['blade_measured_cut'], CLASS_LEVEL_START);
  check('and the other two at its tier close, in the same words on both sides', island('CLOSED') === want,
    `island "${island('CLOSED')}", browser "${want}"`);
}
check('a trade\'s spell does not go in a patron\'s slot', island('FAITHSLOT') === 'That slot is for faith spells.', island('FAITHSLOT'));
{
  const [rose, lo, hi] = parts('LEARN').map(Number);
  check(`a blow that lands teaches the trade a step of the skill curve, at ${CLASS_LEARN_BLOW} a blow`,
    rose >= lo - 1e-12 && rose <= hi + 1e-12 && rose > 0, `rose ${rose}, between ${lo} and ${hi}`);
}
{
  const [opened, line] = parts('OPENS');
  const want = `Your ${BLADE.name.toLowerCase()} level reaches ${CLASS_TIER_AT[1]}, and a new tier opens in the Trades window.`;
  check(`and a kill that takes it over ${CLASS_TIER_AT[1]} says the tier it opens`, opened === 'true' && line === want, island('OPENS'));
}
check('somebody with no fighting trade learns nothing', Number(island('NOBODY')) === 0, island('NOBODY'));
{
  const level = CLASS_TIER_AT[2] + 5;
  const want = `${level}|${CLASS_TIER_AT.map((at, i) => `${i + 1}:${at}:${i === 0 || level >= at}`).join(',')}`;
  check('the Trades window is told the level and which tiers it opens', island('TREE') === want, `island ${island('TREE')}, want ${want}`);
}

/* ---- The spells ------------------------------------------------------------- */

for (const { s } of BLOWS) {
  const [ratio, landed] = parts(`BLOW:${s.id}`);
  check(`${s.name}: a blow at ${pct(s.fx.more)} of a swing's`, landed === 'true' && near(Number(ratio), s.fx.more, 1e-9), island(`BLOW:${s.id}`));
}
{
  const [cut, swung] = parts('SURE').map(Number);
  check('Measured Cut cannot miss, with a hand that misses a swing often', cut === 30 && swung < 30, `${cut} of 30 cuts, ${swung} of 30 swings`);
}
{
  const [slow, secs, pace] = parts('HAM').map(Number);
  check(`Hamstring: it goes at ${pct(fx('hamstring', 'pace'))} of its pace for ${fx('hamstring', 'secs')} s`,
    near(slow, fx('hamstring', 'pace')) && near(secs, fx('hamstring', 'secs'), 1e-6) && near(pace, fx('hamstring', 'pace')), island('HAM'));
  check('and its own pace after', near(Number(island('HAM:OVER')), 1), island('HAM:OVER'));
}
{
  const [off, secs, line] = parts('BASH');
  check(`Shield Bash: a heavy blow knocked off its stroke, and its next blow put back ${fx('shield_bash', 'back')} s`,
    off === 'true' && near(Number(secs), 1 + fx('shield_bash', 'back'), 1e-6) && /knocked off its stroke/.test(line), island('BASH'));
}
check('and it wants a shield', island('NOSHIELD') === 'Shield Bash wants a shield in your off hand.' && island('SHIELD') === 'ready',
  `${island('NOSHIELD')} / ${island('SHIELD')}`);
{
  const [val, n, secs] = parts('DISARM').map(Number);
  const take = 1 - fx('disarming_cut', 'cut');
  check(`Disarming Cut: its next ${fx('disarming_cut', 'blows')} blows within ${fx('disarming_cut', 'secs')} s do ${pct(fx('disarming_cut', 'cut'))} less`,
    near(val, fx('disarming_cut', 'cut')) && n === fx('disarming_cut', 'blows') && near(secs, fx('disarming_cut', 'secs'), 1e-6)
      && island('DISARM:TAKE') === `${[take, take, take, 1].join(',')}|0`, `${island('DISARM')} / ${island('DISARM:TAKE')}`);
  check('and a blow of it that lands takes that much less off you', near(Number(island('DISARM:BLOW')), 0.1 * take, 1e-9), island('DISARM:BLOW'));
}
{
  const [cast, putX, putY, atX, atY, reach, cx, cy] = parts('LUNGE');
  // To a pace inside the sword's reach of it, on the line between.
  const short = Number(reach) - 0.4;
  check(`Lunge: a stride to ${short.toFixed(1)} tiles short of a creature ${cx} tiles off, and the browser told where`,
    cast === 'cast' && near(Number(putX), Number(cx) - short) && near(Number(putY), Number(cy)) && putX === atX && putY === atY,
    island('LUNGE'));
  check(`and no further than ${fx('lunge', 'reach')} tiles`, island('LUNGE:FAR') === `The rowl is more than ${fx('lunge', 'reach')} tiles away.`, island('LUNGE:FAR'));
}
{
  const [cast, stamina, rest, told] = parts('PAID');
  const s = spell('measured_cut');
  check(`a spell called through the door costs its ${pct(s.cost)} of a full bar, rests ${s.rest} s, and says what is left`,
    cast === s.id && near(Number(stamina), 1 - s.cost) && near(Number(rest), s.rest, 1e-6) && near(Number(told), 1 - s.cost), island('PAID'));
  check('and is refused while it rests', island('RESTING') === `${s.name} can be called again in ${s.rest} seconds.`, island('RESTING'));
  check('or without the stamina for it', island('TIRED') === `${s.name} costs ${pct(s.cost)} of your stamina; you have 5%.`, island('TIRED'));
}
{
  const [cast, stamina] = parts('BREATH2');
  check(`Second Breath: no stamina, and ${pct(fx('second_breath', 'stamina'))} of a full bar back`,
    cast === 'blade_second_breath' && near(Number(stamina), 0.3 + fx('second_breath', 'stamina'), 1e-9), island('BREATH2'));
  check('and never past a full bar', near(Number(island('BREATH2:FULL')), 1), island('BREATH2:FULL'));
}
{
  const [turned, secs] = parts('CHALLENGE');
  // A creature turns on whoever hurts it most after THREAT_HOLD, so it is held from turning for the rest of the while.
  check(`Challenge: it turns on you, and is not turned off you for ${fx('challenge', 'secs')} s`,
    turned === 'true' && near(Number(secs), fx('challenge', 'secs') - THREAT_HOLD, 1e-6), island('CHALLENGE'));
  check('and a blow of your own on it after does not cut that short', near(Number(island('CHALLENGE:HELD')), Number(secs), 1e-6), island('CHALLENGE:HELD'));
  check('and something that fights nobody is refused', island('TIMID') === 'The rabba will not fight anybody.', island('TIMID'));
}
{
  const [who, line] = parts('CALL');
  const hold = (fx('guardians_call', 'secs') - THREAT_HOLD).toFixed(3);
  check(`Guardian's Call: everything within ${fx('guardians_call', 'reach')} tiles hunting somebody turns on you for ${fx('guardians_call', 'secs')} s, and nothing else`,
    who === `you:${hold},you:${hold},them:-,nobody:-` && line === `${spell('guardians_call').name}: 2 creatures turn on you, and hunt only you for ${fx('guardians_call', 'secs')} s.`,
    island('CALL'));
  check('and with nothing to call it is refused', island('CALL:NONE') === `Nothing within ${fx('guardians_call', 'reach')} tiles of you is hunting anybody.`,
    island('CALL:NONE'));
}
{
  const [share, secs] = parts('DEFLECT').map(Number);
  const [owed] = parts('DEFLECTED').map(Number);
  check(`Deflect: for ${fx('deflect', 'secs')} s a blocked blow goes back at ${pct(fx('deflect', 'share'))} of itself, in the striker's own health`,
    near(share, fx('deflect', 'share')) && near(secs, fx('deflect', 'secs'), 1e-6) && near(owed, 0.1 * fx('deflect', 'share') / BLOW_SHARE, 1e-9),
    `${island('DEFLECT')} / ${island('DEFLECTED')}`);
}
{
  const [cast, stamina, secs] = parts('LAST');
  check(`Last Stand: only below ${pct(fx('last_stand', 'below'))} of your health`, island('LAST:HIGH') === `Last Stand is only for below ${pct(fx('last_stand', 'below'))} of your health.`,
    island('LAST:HIGH'));
  check(`and then for ${fx('last_stand', 'secs')} s, for no stamina, ${pct(fx('last_stand', 'cut'))} less off you`,
    cast === 'blade_last_stand' && near(Number(stamina), 1) && near(Number(secs), fx('last_stand', 'secs'), 1e-6)
      && near(Number(island('LAST:BLOW')), 0.1 * (1 - fx('last_stand', 'cut')), 1e-9), `${island('LAST')} / ${island('LAST:BLOW')}`);
}
{
  const [drain, plain, held, secs, bleed] = parts('HOLD').map(Number);
  check(`Hold the Line: for ${fx('hold_the_line', 'secs')} s your wounds bleed ${pct(1 - fx('hold_the_line', 'bleed'))} less`,
    near(plain, drain * 10, 1e-9) && near(held, drain * 10 * fx('hold_the_line', 'bleed'), 1e-9)
      && near(secs, fx('hold_the_line', 'secs'), 1e-6) && near(bleed, fx('hold_the_line', 'bleed')), island('HOLD'));
  const [hurt, holding, whole] = parts('HOLD:ARM').map(Number);
  check('and an arm wound does not slow your swing while it holds', hurt > whole && near(holding, whole), island('HOLD:ARM'));
}
{
  const [swing, draw, dig] = parts('BREATHING').map(Number);
  check(`Measured Breathing: for ${fx('measured_breathing', 'secs')} s a swing or a draw costs no stamina, and nothing else is free`,
    swing === 0 && draw === 0 && dig === 0.25, island('BREATHING'));
  check('and after it, a swing costs again', island('BREATHING:OVER') === 'true', island('BREATHING:OVER'));
}

/* ---- The passives ------------------------------------------------------------ */

check('the six passives fold on the island to what they fold to in the browser',
  island('FOLDED') === Object.keys(FOLD).filter((k) => /^(wind|stagger|severity|stance|cover|block|blockcap):/.test(k)).sort()
    .map((k) => `${k}=${FOLD[k]}`).join(';'), island('FOLDED'));
check(`Light Sword: a swing of a sword ${pct(1 - FOLD['wind:swords'])} cheaper`, near(Number(island('LIGHT')), FOLD['wind:swords']), island('LIGHT'));
check('and of an axe, no cheaper', near(Number(island('LIGHT:AXE')), 1), island('LIGHT:AXE'));
{
  const [owed, after, again] = parts('COUNTER');
  check(`Counterweight: a blocked blow puts the striker's next one back ${FOLD['stagger:block']} s, paid once`,
    near(Number(owed), FOLD['stagger:block']) && near(Number(after), FOLD['stagger:block']) && Number(again) === 0, island('COUNTER'));
  check('by the striker\'s own turn, at every blow it strikes', island('COUNTER:PAID') === '1', island('COUNTER:PAID'));
}
{
  const [lost, sev] = parts('HARDENED').map(Number);
  check(`Battle-Hardened: a wound opened ${pct(1 - FOLD['severity:wound'])} less deep, and the same health off`,
    near(lost, 0.1) && near(sev, 0.1 * FOLD['severity:wound'], 1e-9), island('HARDENED'));
}
{
  const [taken0, dealt0, taken1, dealt1, balanced] = parts('STALWART').map(Number);
  check('Stalwart: the defensive stance takes and deals what the browser says, on both sides',
    near(taken0, STANCE_TAKEN.defensive) && near(dealt0, STANCE_DEALT.defensive)
      && near(taken1, stanceTaken('defensive', perk)) && near(dealt1, stanceDealt('defensive', perk))
      && near(taken1, FOLD['stance:defensive_taken']) && near(dealt1, FOLD['stance:defensive_dealt'])
      && near(balanced, stanceTaken('balanced', perk)) && near(balanced, STANCE_TAKEN.balanced), island('STALWART'));
  check('and a blow that lands in it takes that much off you', near(Number(island('STALWART:BLOW')), 0.1 * FOLD['stance:defensive_taken'], 1e-9),
    island('STALWART:BLOW'));
}
{
  const [before, after] = parts('MASTERY').map(Number);
  const [best0, best1] = parts('MASTERY:BEST').map(Number);
  const wood = SHIELDS.wooden_shield.block;
  const metal = SHIELDS.metal_shield.block;
  // To within what a shield's block holds as a real.
  check(`Shield Mastery: ${Math.round(FOLD['block:shield'] * 100)} points more blocks, the same sum on both sides`,
    near(before, blockChance(wood, 40, 50, none), 1e-6) && near(after, blockChance(wood, 40, 50, perk), 1e-6)
      && near(after - before, FOLD['block:shield']) && near(best0, blockChance(metal, 100, 100, none), 1e-6)
      && near(best1, blockChance(metal, 100, 100, perk), 1e-6), `${island('MASTERY')} / ${island('MASTERY:BEST')}`);
  check(`and the most a shield blocks rises from ${pct(BLOCK_MOST)} to ${pct(FOLD['blockcap:shield'])}`,
    near(Number(island('MASTERY:CAP')), FOLD['blockcap:shield']) && near(blockChance(0.9, 100, 100, perk), FOLD['blockcap:shield'])
      && near(blockChance(0.9, 100, 100, none), BLOCK_MOST), island('MASTERY:CAP'));
}
{
  const [guarded, line] = parts('GUARDIAN');
  const share = FOLD['cover:share'];
  check(`Guardian: about ${pct(share)} of the blows at somebody within ${GUARDIAN_REACH} tiles land on your shield instead`,
    Number(guarded) >= 200 * share * 0.5 && Number(guarded) <= 200 * share * 1.6, `${guarded} of 200`);
  check('and they are told whose shield', /^.+ takes the rowl’s blow on a shield\.$/.test(line), line);
  const [far, bare] = parts('GUARDIAN:NOT').map(Number);
  check(`but none beyond ${GUARDIAN_REACH} tiles, and none without a shield`, far === 0 && bare === 0, island('GUARDIAN:NOT'));
  const beast = Number(island('GUARDIAN:BEAST'));
  check('and a companion\'s too', beast >= 200 * share * 0.5 && beast <= 200 * share * 1.6, `${beast} of 200`);
}

/* ---- Put down ---------------------------------------------------------------- */

{
  const [took, level, nodes, onBar, known] = parts('DOWN');
  check('another fighting trade taken up starts at its own first level, and the Sworn Blade\'s spells leave the bar and the hand',
    took === 'berserker' && Number(level) === CLASS_LEVEL_START && nodes === '0' && onBar === '0' && known === 'false', island('DOWN'));
}
check('and a fighting trade undone leaves no level at all', island('UNDONE') === 'berserker|0|none', island('UNDONE'));
check('no function is open to a player but the doors', island('OPEN') === '0', island('OPEN'));

/* ---- The browser's half ----------------------------------------------------- */

check(`each of the ${CLASS_TIER_AT.length} tiers offers two spells and a passive`,
  TIERS.blade.length === CLASS_TIER_AT.length && TIERS.blade.every((row) => row.length === 3
    && row.filter((num) => SPELLS.some((s) => s.num === num)).length === 2), JSON.stringify(TIERS.blade));
check('every passive has numbers to fold and every spell none, its numbers being the spell\'s own',
  perksOf('blade').every((p) => (CLASS_SPELL_BY_ID.has(p.id) ? Object.keys(p.fx).length === 0 : Object.keys(p.fx).length > 0)));
check('and every spell\'s perk says what it costs before what it does',
  SPELLS.every((s) => PERK_BY_ID.get(s.id)!.note.startsWith('Spell') && PERK_BY_ID.get(s.id)!.note.endsWith(s.note)));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Sworn Blade — ${ok.length} of ${ok.length}`);
