/**
 * A cast says what it did (`a_cast_says_what_it_did.sql`), for the browser to
 * draw it as it went rather than from the spell's own numbers and whatever
 * stood near.
 *
 * What this asks, every cast made through the door a browser uses
 * (`rpc_cast_spell`):
 *
 *   * an area of fire (a Firestorm) says the creatures it burned, and no
 *     other, each with the seconds its burn runs;
 *   * an area hold (an Earthshaker) says the creatures its blow landed on,
 *     that it holds them, and for the hold's seconds; a Skull Crack the
 *     same on one, a monster for its own share of them;
 *   * a Fright is refused on a monster and says nothing, and on an animal
 *     says it and the seconds it flees; a Panic says a monster flees for its
 *     own seconds and an animal for the spell's;
 *   * a Stoke waiting is said to be spent by the fire that spends it, and
 *     not by a cast that deals none;
 *   * a Thicken waiting is said to be spent by the skin it makes larger, and
 *     that skin's size is said, larger by the Thicken's share;
 *   * a Ward Link laying a skin back over somebody tells the Warder's browser,
 *     with on whom and how large;
 *   * an Execute says when it was on a creature below its line;
 *   * and the telling ends with the cast: nothing a blow or a spell does
 *     after it is told to anybody.
 *
 * And the browser's half: what it works out for a cast drawn with no island
 * (`guessTold`, for the console and the preview) is what the island said,
 * for every cast here whose outcome is not a roll.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import '../../src/game/actions';
import { FAITH_SPELL_BY_ID, SPELL_BAR } from '../../src/game/patrons';
import { CLASS_SPELL_BY_ID } from '../../src/game/talents';
import { guessTold, type Standing } from '../../src/render/spells/guess';

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
const near = (a: number, b: number, by = 0.011): boolean => Math.abs(a - b) <= by;

const fx = (id: string, k: string): number => {
  const v = (CLASS_SPELL_BY_ID.get(id)?.fx ?? FAITH_SPELL_BY_ID.get(id)?.fx)?.[k];
  if (v === undefined) throw new Error(`no ${k} on ${id}`);
  return v;
};
const CLASS_SLOT = SPELL_BAR.indexOf('class');
const FAITH_SLOT = SPELL_BAR.indexOf('faith');
const MONSTER = 'ogre';
const ANIMAL = 'ulva';

/** A wild creature put down at a spot, doing nothing of its own. */
const SPAWN = (v: string, species: string, x: string, y: string): string => `
  ${v} := creature_spawn(w.world_id, '${species}', ${x}, ${y}, 'wild', now() - interval '2 hours', null);
  update creature set traits = '{}', rare = null, hunting = null, brawl = null, enemy = null, hunt_again = null, skills = '{}'::jsonb,
         settled_at = now(), until = now() + interval '1 hour', windup_at = null, bleed_rate = null, bleed_until = null,
         slow = null, slow_until = null, fight_blows = 0
   where world_id = w.world_id and id = ${v};
  update creature set health = max_health(creature) where world_id = w.world_id and id = ${v};`;
/** Every creature near gone, and every mark. */
const CLEAR = `
  delete from creature where world_id = w.world_id and to_x between v_px - 45 and v_px + 45 and to_y between v_py - 45 and v_py + 45;
  delete from class_mark where world_id = w.world_id;
  delete from faith_mark where world_id = w.world_id;`;
/** A cast through the door, as a browser makes it: the spell put in its slot, rested, paid for, and its answer kept. */
const CAST = (key: string, spell: string, target: string): string => {
  const slot = CLASS_SPELL_BY_ID.has(spell) ? CLASS_SLOT : FAITH_SLOT;
  return `
  update player set used_at = '{}'::jsonb, favour = 500, favour_at = now(), stats = jsonb_set(stats, '{stamina}', '1')
   where world_id = w.world_id and uid = w.uid;
  delete from caller where uid = w.uid;
  perform spell_bar_put(w.world_id, w.uid, ${slot}, '${spell}');
  r := rpc_cast_spell(w.world_id, ${slot}, ${target});
  insert into said values ('${key}', r::text);`;
};
const ON_ME = `jsonb_build_object('kind', 'self')`;
const AREA = `jsonb_build_object('kind', 'area')`;
const AT = (v: string): string => `jsonb_build_object('kind', 'creature', 'id', ${v})`;
const ON = (uid: string): string => `jsonb_build_object('kind', 'player', 'uid', ${uid})`;
/** Which of these creatures have lost health, as `id:true|false`. */
const HURT = (key: string, ids: string): string => `
  insert into said select '${key}', string_agg(cr.id || ':' || (cr.health < max_health(cr))::text, ',' order by cr.id)
    from creature cr where cr.world_id = w.world_id and cr.id in (${ids});`;
const IDS = (key: string, ids: string): string => `insert into said select '${key}', concat_ws(',', ${ids});`;

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w record; o uuid; v_px double precision; v_py double precision; r jsonb; i int;
        a int; b int; e int; g int; v_maul bigint; v_axe bigint;
begin
  -- An island with land and two people on it: the caster, and somebody two tiles off.
  select p.world_id, p.uid, wd.spawn_x, wd.spawn_y into w from player p join world wd on wd.id = p.world_id
   where exists (select 1 from land_tile lt where lt.world_id = wd.id)
     and (select count(*) from player q2 where q2.world_id = p.world_id) >= 2
   order by wd.size desc, p.world_id, p.uid limit 1;
  select uid into o from player where world_id = w.world_id and uid <> w.uid order by uid limit 1;
  v_px := w.spawn_x + peace_reach() + 10.5; v_py := w.spawn_y + 0.5;
  update placed set driver = null where world_id = w.world_id and driver in (w.uid, o);
  update player set x = v_px, y = v_py, level = 0, aboard = null, away = false, act = null, act_target = null,
         act_ends = null, act_queue = '[]', equipped = '{}'::jsonb, wounds = '[]'::jsonb, fight_stance = 'balanced', blessings = '{}'::jsonb,
         used_at = '{}'::jsonb, body_at = now(), craft_class = null, combat_class = null, class_mul = null, class_level = 0,
         moved_at = now(), fight_back = false,
         spell_bar = (select jsonb_agg('null'::jsonb) from spell_slot),
         stats = (coalesce(stats, '{}'::jsonb) - 'hurtAt' - 'hurtBy' - 'aegisBy')
                 || jsonb_build_object('health', 1, 'hunger', 1, 'thirst', 1, 'stamina', 1, 'aegis', 0, 'hurtSettled', now())
   where world_id = w.world_id and uid in (w.uid, o);
  update player set x = v_px + 2 where world_id = w.world_id and uid = o;
  update player set x = v_px - 60 where world_id = w.world_id and uid not in (w.uid, o);
  insert into skill (world_id, uid, id, value)
    select w.world_id, pp.uid, sv.s, sv.v
      from (values ('kindling', 60::double precision), ('warding', 60), ('fighting', 100), ('mauls', 100), ('axes', 100),
                   ('body_control', 1), ('prayer', 100)) sv(s, v)
     cross join (select unnest(array[w.uid, o]) as uid) pp
    on conflict (world_id, uid, id) do update set value = excluded.value;
  delete from event where uid in (w.uid, o);
  delete from player_node where world_id = w.world_id and uid in (w.uid, o);
  delete from player_spell where world_id = w.world_id and uid in (w.uid, o);
  ${CLEAR}
  delete from creature where world_id = w.world_id and (hunting in (w.uid, o) or keeper in (w.uid, o));
  delete from item where world_id = w.world_id and holder = 'player' and holder_uid = w.uid and def = 'focus';
  delete from faith_owed where world_id = w.world_id;
  delete from faith_zone where world_id = w.world_id;
  delete from realtime.messages;
  perform set_config('request.jwt.claims', json_build_object('sub', w.uid)::text, true);
  insert into player_node (world_id, uid, node) select w.world_id, w.uid, cs.id from class_spell cs
   where cs.class in ('kindler', 'berserker', 'warder') on conflict do nothing;
  insert into player_spell (world_id, uid, spell) values (w.world_id, w.uid, 'chaos_fright'), (w.world_id, w.uid, 'chaos_panic');
  perform give(w.world_id, w.uid, 'focus', 1, 80, 'Ruby');
  perform give(w.world_id, w.uid, 'focus', 1, 80, 'Topaz');
  v_maul := give(w.world_id, w.uid, 'maul', 1, 40);
  v_axe := give(w.world_id, w.uid, 'hatchet', 1, 40);
  insert into said values ('O', o::text);

  /* ---- A Firestorm: the creatures it burned, each for its burn's seconds, and none past its reach ---- */
  update player set combat_class = 'kindler' where world_id = w.world_id and uid = w.uid;
  ${SPAWN('a', MONSTER, 'v_px + 1.5', 'v_py')}
  ${SPAWN('b', MONSTER, 'v_px', 'v_py + 3')}
  ${SPAWN('e', MONSTER, `v_px + ${fx('kindler_firestorm', 'reach')} + 2`, 'v_py')}
  ${IDS('STORM:IDS', 'a, b, e')}
  ${CAST('STORM', 'kindler_firestorm', ON_ME)}
  ${HURT('STORM:HURT', 'a, b, e')}
  insert into said select 'STORM:BURN', string_agg(m.creature_id || ':' || round(extract(epoch from m.until - now())::numeric, 2), ',' order by m.creature_id)
    from class_mark m where m.world_id = w.world_id and m.kind = 'burn';

  /* ---- A Stoke: not spent by a cast that deals no fire, and spent by the next that does ---- */
  ${CLEAR}
  ${SPAWN('a', MONSTER, 'v_px + 1.5', 'v_py')}
  ${CAST('STOKE', 'kindler_stoke', ON_ME)}
  ${CAST('STOKE:BRAND', 'kindler_firebrand', ON_ME)}
  ${CAST('STOKE:SCORCH', 'kindler_scorch', AT('a'))}
  insert into said select 'STOKE:LEFT', (blessings ? 'stoke')::text from player where world_id = w.world_id and uid = w.uid;
  ${CAST('STOKE:AGAIN', 'kindler_scorch', AT('a'))}

  /* ---- An Earthshaker: the creatures its blow landed on, held, for its seconds; none past its reach ---- */
  ${CLEAR}
  update player set combat_class = 'berserker', blessings = '{}'::jsonb, equipped = jsonb_build_object('weapon', v_maul)
   where world_id = w.world_id and uid = w.uid;
  -- Each blow is a roll; tried until one lands, the three put down afresh each time.
  for i in 1 .. 12 loop
    ${CLEAR}
    delete from said where k in ('SHAKE', 'SHAKE:IDS');
    ${SPAWN('a', MONSTER, 'v_px + 1.5', 'v_py')}
    ${SPAWN('b', ANIMAL, 'v_px', 'v_py + 1.5')}
    ${SPAWN('e', MONSTER, `v_px + ${fx('berserker_earthshaker', 'reach')} + 2`, 'v_py')}
    ${IDS('SHAKE:IDS', 'a, b, e')}
    ${CAST('SHAKE', 'berserker_earthshaker', ON_ME)}
    exit when r ? 'held';
  end loop;
  ${HURT('SHAKE:HURT', 'a, b, e')}
  insert into said select 'SHAKE:HELD', string_agg(cr.id || ':' || class_held(w.world_id, cr.id)::text, ',' order by cr.id)
    from creature cr where cr.world_id = w.world_id and cr.id in (a, b, e);

  /* ---- A Skull Crack on a monster and on an animal: each held for its own seconds; tried until it lands ---- */
  ${CLEAR}
  ${SPAWN('a', MONSTER, 'v_px + 1.5', 'v_py')}
  ${SPAWN('b', ANIMAL, 'v_px', 'v_py + 1.5')}
  ${IDS('CRACK:IDS', 'a, b')}
  for i in 1 .. 12 loop
    ${CAST('CRACK:MONSTER', 'berserker_skull_crack', AT('a'))}
    exit when r ? 'held';
    delete from said where k = 'CRACK:MONSTER';
    update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  end loop;
  for i in 1 .. 12 loop
    ${CAST('CRACK:ANIMAL', 'berserker_skull_crack', AT('b'))}
    exit when r ? 'held';
    delete from said where k = 'CRACK:ANIMAL';
    update creature set health = max_health(creature) where world_id = w.world_id and id = b;
  end loop;

  /* ---- An Execute: said to be on one below its line, and not on one above it ---- */
  ${CLEAR}
  update player set equipped = jsonb_build_object('weapon', case when (select needs from class_spell where id = 'berserker_execute') = 'mauls'
                                                                 then v_maul else v_axe end)
   where world_id = w.world_id and uid = w.uid;
  ${SPAWN('a', MONSTER, 'v_px + 1.5', 'v_py')}
  ${CAST('EXECUTE:WHOLE', 'berserker_execute', AT('a'))}
  update creature set health = max_health(creature) * ${fx('berserker_execute', 'low')} * 0.5 where world_id = w.world_id and id = a;
  ${CAST('EXECUTE:LOW', 'berserker_execute', AT('a'))}

  /* ---- A Fright: refused on a monster, saying nothing; on an animal, the seconds it flees ---- */
  ${CLEAR}
  update player set combat_class = null, equipped = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  ${SPAWN('a', MONSTER, 'v_px + 1.5', 'v_py')}
  ${SPAWN('b', ANIMAL, 'v_px', 'v_py + 1.5')}
  ${IDS('FRIGHT:IDS', 'a, b')}
  ${CAST('FRIGHT:MONSTER', 'chaos_fright', AT('a'))}
  ${CAST('FRIGHT:ANIMAL', 'chaos_fright', AT('b'))}

  /* ---- A Panic: a monster flees for its own seconds, an animal for the spell's ---- */
  ${CLEAR}
  ${SPAWN('a', MONSTER, 'v_px + 1.5', 'v_py')}
  ${SPAWN('b', ANIMAL, 'v_px', 'v_py + 1.5')}
  ${IDS('PANIC:IDS', 'a, b')}
  ${CAST('PANIC', 'chaos_panic', AREA)}

  /* ---- A Thicken: spent by the skin it makes larger, and the skin said as large as it is ---- */
  ${CLEAR}
  update player set combat_class = 'warder', stats = stats || '{"aegis": 0}'::jsonb, blessings = '{}'::jsonb
   where world_id = w.world_id and uid = w.uid;
  ${CAST('WARD', 'warder_ward', ON_ME)}
  update player set stats = stats || '{"aegis": 0}'::jsonb where world_id = w.world_id and uid = w.uid;
  ${CAST('THICKEN', 'warder_thicken', ON_ME)}
  ${CAST('WARD:THICK', 'warder_ward', ON_ME)}
  insert into said select 'WARD:SKIN', (stats->>'aegis') || '|' || (blessings ? 'thicken')::text
    from player where world_id = w.world_id and uid = w.uid;

  /* ---- A Ward Link: the skin it lays back over somebody, told to the Warder's browser ---- */
  update player set stats = stats || '{"aegis": 0}'::jsonb - 'aegisBy', blessings = '{}'::jsonb where world_id = w.world_id and uid in (w.uid, o);
  ${SPAWN('a', MONSTER, 'v_px + 1.5', 'v_py')}
  ${CAST('LINK', 'warder_ward_link', ON_ME)}
  ${CAST('LINK:OTHER', 'warder_ward_other', ON('o'))}
  update player set stats = stats || jsonb_build_object('hurtBy', a, 'hurtAt', now() - interval '1 hour'), act = null
   where world_id = w.world_id and uid = o;
  perform hurt_player(w.world_id, o, 0.9, 'The ogre bites you', 'bite');
  insert into said select 'LINK:SKIN', coalesce(stats->>'aegis', '0') from player where world_id = w.world_id and uid = o;
  insert into said select 'LINK:SENT', coalesce(string_agg(m.topic || '¦' || m.event || '¦' || m.payload::text, '‖'), '-')
    from realtime.messages m where m.event = 'fx';
  insert into said select 'LINK:OWN', 'own:' || w.world_id || ':' || w.uid;

  -- And the telling ends with the cast: a blow after it is told to nobody.
  insert into said values ('AFTER', coalesce(nullif(current_setting('wurm.fx', true), ''), '-'));
  insert into said select 'OPEN', count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'fx\\_%' and has_function_privilege('authenticated', p.oid, 'execute');
end $b$;
select k || '=' || coalesce(v, '') from said;
rollback;
`);

const said = new Map<string, string>();
for (const line of out.split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) said.set(line.slice(0, i), line.slice(i + 1));
}
const island = (k: string): string => said.get(k) ?? '';
interface Told {
  why?: string; said?: string; hit?: Array<number | string>; secs?: Array<number | null>; held?: Array<number | string>;
  used?: string[]; size?: number; low?: boolean;
}
const told = (k: string): Told => {
  try {
    return JSON.parse(island(k)) as Told;
  } catch {
    return { why: `unreadable: ${island(k)}` };
  }
};
const ids = (k: string): number[] => island(k).split(',').map(Number);
const hurt = (k: string): number[] => island(k).split(',').filter((s) => s.endsWith(':true')).map((s) => Number(s.split(':')[0]));
const same = (a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const brief = (t: Told): string => JSON.stringify({ why: t.why, said: t.said, hit: t.hit, secs: t.secs, held: t.held, used: t.used, size: t.size, low: t.low });

{
  const t = told('STORM');
  const [a, b, e] = ids('STORM:IDS');
  const burnt = hurt('STORM:HURT');
  const burns = new Map(island('STORM:BURN').split(',').map((s) => s.split(':').map(Number) as [number, number]));
  check('a Firestorm says the creatures it burned, in the order it reached them, and none past its reach',
    !t.why && same(t.hit ?? [], [a, b]) && same(burnt, [a, b]) && !(t.hit ?? []).includes(e), `${brief(t)} burnt ${burnt}`);
  check(`and each for the seconds its burn runs (${fx('kindler_firestorm', 'secs')} s)`,
    (t.secs ?? []).length === 2 && (t.secs ?? []).every((s, i) => s !== null && near(s, fx('kindler_firestorm', 'secs'))
      && near(s, burns.get((t.hit ?? [])[i] as number) ?? -1, 0.2)), `${JSON.stringify(t.secs)} / ${island('STORM:BURN')}`);
  check('and holds nothing', t.held === undefined, brief(t));
}
{
  const stoke = told('STOKE'), brand = told('STOKE:BRAND'), scorch = told('STOKE:SCORCH'), again = told('STOKE:AGAIN');
  check('a Stoke is not said spent by its own cast, nor by a cast that deals no fire',
    !stoke.why && stoke.used === undefined && !brand.why && brand.used === undefined, `${brief(stoke)} / ${brief(brand)}`);
  check('and is said spent by the fire that spends it, and then by nothing more',
    !scorch.why && same(scorch.used ?? [], ['kindler_stoke']) && island('STOKE:LEFT') === 'false' && again.used === undefined,
    `${brief(scorch)} / ${island('STOKE:LEFT')} / ${brief(again)}`);
}
{
  const t = told('SHAKE');
  const [a, b, e] = ids('SHAKE:IDS');
  const landed = hurt('SHAKE:HURT');
  const held = island('SHAKE:HELD').split(',').filter((s) => s.endsWith(':true')).map((s) => Number(s.split(':')[0]));
  check('an Earthshaker says the creatures its blow landed on, and none past its reach',
    !t.why && landed.length > 0 && same([...(t.hit ?? [])].sort(), [...landed].sort()) && !(t.hit ?? []).includes(e)
      && (t.hit ?? []).every((id) => id === a || id === b), `${brief(t)} landed ${landed}`);
  check(`that it holds each of them, for ${fx('berserker_earthshaker', 'hold')} s`,
    same([...(t.held ?? [])].sort(), [...held].sort()) && same([...held].sort(), [...landed].sort())
      && (t.secs ?? []).length === (t.hit ?? []).length && (t.secs ?? []).every((s) => s !== null && near(s, fx('berserker_earthshaker', 'hold'))),
    `${brief(t)} held ${held}`);
}
{
  const [a, b] = ids('CRACK:IDS');
  const m = told('CRACK:MONSTER'), n = told('CRACK:ANIMAL');
  const hold = fx('berserker_skull_crack', 'hold'), monster = hold * fx('berserker_skull_crack', 'monster');
  check(`a Skull Crack says it holds a monster for ${monster} s`,
    same(m.hit ?? [], [a]) && same(m.held ?? [], [a]) && near(m.secs?.[0] ?? -1, monster), brief(m));
  check(`and an animal for ${hold} s`, same(n.hit ?? [], [b]) && same(n.held ?? [], [b]) && near(n.secs?.[0] ?? -1, hold), brief(n));
}
{
  const whole = told('EXECUTE:WHOLE'), low = told('EXECUTE:LOW');
  check(`an Execute says when it was on a creature below ${fx('berserker_execute', 'low') * 100}% of its health, and only then`,
    !whole.why && whole.low === undefined && !low.why && low.low === true, `${brief(whole)} / ${brief(low)}`);
}
{
  const [, b] = ids('FRIGHT:IDS');
  const m = told('FRIGHT:MONSTER'), n = told('FRIGHT:ANIMAL');
  check('a Fright on a monster is refused, and says it reached nothing', m.why === 'Monsters are not frightened.' && m.hit === undefined, brief(m));
  check(`and on an animal says it flees, for ${fx('chaos_fright', 'secs')} s`,
    !n.why && same(n.hit ?? [], [b]) && near(n.secs?.[0] ?? -1, fx('chaos_fright', 'secs')) && n.held === undefined, brief(n));
}
{
  const [a, b] = ids('PANIC:IDS');
  const t = told('PANIC');
  const secs = new Map((t.hit ?? []).map((id, i) => [id, t.secs?.[i] ?? null]));
  check(`a Panic says a monster flees for ${fx('chaos_panic', 'monster')} s and an animal for ${fx('chaos_panic', 'secs')} s`,
    !t.why && (t.hit ?? []).length === 2 && near(secs.get(a) ?? -1, fx('chaos_panic', 'monster')) && near(secs.get(b) ?? -1, fx('chaos_panic', 'secs')),
    brief(t));
}
{
  const o = island('O');
  const plain = told('WARD'), thicken = told('THICKEN'), thick = told('WARD:THICK');
  const [skin, waiting] = island('WARD:SKIN').split('|');
  check('a skin says whom it was laid over and how large, and spends no Thicken that is not waiting',
    !plain.why && (plain.hit ?? []).length === 1 && typeof plain.hit?.[0] === 'string' && (plain.size ?? 0) > 0 && plain.used === undefined, brief(plain));
  check(`a Thicken waiting is said spent by the next skin, which is said ${fx('warder_thicken', 'more')} times as large`,
    !thicken.why && thicken.used === undefined && same(thick.used ?? [], ['warder_thicken']) && waiting === 'false'
      && near(thick.size ?? 0, (plain.size ?? 0) * fx('warder_thicken', 'more'), 1e-3) && near(thick.size ?? 0, Number(skin), 1e-3),
    `${brief(plain)} / ${brief(thick)} / ${island('WARD:SKIN')}`);
  const other = told('LINK:OTHER');
  check('a skin over somebody else says it was laid over them', same(other.hit ?? [], [o]), brief(other));
  const sent = island('LINK:SENT').split('‖').filter((s) => s !== '-').map((s) => s.split('¦'));
  const msg = sent.length === 1 ? (JSON.parse(sent[0][2]) as { spell?: string; on?: string; size?: number }) : {};
  check('a Ward Link laying a skin back over somebody tells the Warder\'s browser, once: on whom, and how large',
    sent.length === 1 && sent[0][0] === island('LINK:OWN') && sent[0][1] === 'fx' && msg.spell === 'warder_ward_link' && msg.on === o
      && near(msg.size ?? 0, Number(island('LINK:SKIN')), 1e-3) && (msg.size ?? 0) > 0, `${island('LINK:SENT')} / skin ${island('LINK:SKIN')}`);
}
check('the telling ends with the cast', island('AFTER') === '-', island('AFTER'));

/* ---- The browser's half ----------------------------------------------------- */

{
  // The scenes above, as the browser would stand them: the caster at nought, the creatures where they were put down.
  const me: Standing = { who: { kind: 'player' }, x: 0, y: 0, kind: 'player' };
  const beast = (id: number, species: string, x: number, y: number): Standing => ({ who: { kind: 'creature', id }, x, y, kind: 'creature', species, hostile: true });
  const wire = (t: ReturnType<typeof guessTold>): { hit: number[]; secs: Array<number | null>; held: number[] } | null => (t ? {
    hit: t.hit.map((h) => (h.who.kind === 'creature' ? h.who.id : -1)),
    secs: t.hit.map((h) => h.secs ?? null),
    held: t.hit.filter((h) => h.held).map((h) => (h.who.kind === 'creature' ? h.who.id : -1)),
  } : null);
  const agree = (what: string, guess: ReturnType<typeof wire>, t: Told, sorted = false): void => {
    const order = (xs: ReadonlyArray<unknown>): unknown[] => (sorted ? [...xs].sort() : [...xs]);
    check(`the browser works out what the island said of ${what}`, !!guess && same(order(guess.hit), order(t.hit ?? []))
      && guess.secs.every((s, i) => s === null ? (t.secs?.[i] ?? null) === null : near(s, t.secs?.[i] ?? -1))
      && same(order(guess.held), order(t.held ?? [])), `${JSON.stringify(guess)} / ${brief(t)}`);
  };
  {
    const [a, b, e] = ids('STORM:IDS');
    const r = fx('kindler_firestorm', 'reach');
    agree('a Firestorm', wire(guessTold('kindler_firestorm', me, null, [me, beast(a, MONSTER, 1.5, 0), beast(b, MONSTER, 0, 3), beast(e, MONSTER, r + 2, 0)])), told('STORM'));
  }
  {
    const [a, b, e] = ids('SHAKE:IDS');
    const r = fx('berserker_earthshaker', 'reach');
    // Whether the blow lands on each is a roll the browser cannot make: it
    // draws everything in reach, so it agrees when the island's landings are
    // among those, each held for the same seconds.
    const guess = wire(guessTold('berserker_earthshaker', me, null, [me, beast(a, MONSTER, 1.5, 0), beast(b, ANIMAL, 0, 1.5), beast(e, MONSTER, r + 2, 0)]));
    const t = told('SHAKE');
    const hold = fx('berserker_earthshaker', 'hold');
    check('the browser works out what the island said of an Earthshaker, the blows that missed aside',
      !!guess && same([...guess.hit].sort(), [a, b].sort()) && same([...guess.held].sort(), [a, b].sort())
        && guess.secs.every((s) => s !== null && near(s, hold))
        && (t.hit ?? []).length > 0 && (t.hit ?? []).every((id) => (guess.hit as ReadonlyArray<unknown>).includes(id))
        && same([...(t.held ?? [])].sort(), [...(t.hit ?? [])].sort()),
      `${JSON.stringify(guess)} / ${brief(t)}`);
  }
  {
    const [a, b] = ids('CRACK:IDS');
    agree('a Skull Crack on a monster', wire(guessTold('berserker_skull_crack', me, beast(a, MONSTER, 1.5, 0), [])), told('CRACK:MONSTER'));
    agree('a Skull Crack on an animal', wire(guessTold('berserker_skull_crack', me, beast(b, ANIMAL, 0, 1.5), [])), told('CRACK:ANIMAL'));
  }
  {
    const [a, b] = ids('FRIGHT:IDS');
    check('the browser refuses a Fright on a monster as the island does', guessTold('chaos_fright', me, beast(a, MONSTER, 1.5, 0), []) === null);
    agree('a Fright on an animal', wire(guessTold('chaos_fright', me, beast(b, ANIMAL, 0, 1.5), [])), told('FRIGHT:ANIMAL'));
  }
  {
    const [a, b] = ids('PANIC:IDS');
    agree('a Panic', wire(guessTold('chaos_panic', me, { x: 0, y: 0 }, [me, beast(a, MONSTER, 1.5, 0), beast(b, ANIMAL, 0, 1.5)])), told('PANIC'));
  }
}
check('and none of it is a door anybody may knock on', island('OPEN') === '0', island('OPEN'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`what a cast did — ${ok.length} of ${ok.length}`);
