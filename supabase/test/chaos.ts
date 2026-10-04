/**
 * Chaos's fifteen spells, on the island (`chaos_spells.sql`) and in the
 * browser's rulebook (`FAITH_SPELLS` in `src/game/patrons.ts`).
 *
 * Every spell is pointed through `spell_target` and cast through
 * `faith_spell_cast`, as the door does it, and what it did is read back: a
 * creature bleeding, running, cowering, struck or dead; health spent and
 * favour got; a thing unmade. What lasts is asked of the rule it works
 * through: a Cower and Undying through `hurt_player`, a Pact through
 * `faith_arms`, a Blood Feast through `faith_feast`, a Shroud through
 * `hunt_settle`. Every number asked after is the browser's own.
 */
import { execFileSync } from 'node:child_process';
import { BLOW_SHARE } from '../../src/game/creatures';
import { FAITH_SPELL_BY_ID, FAITH_SPELLS, FAITH_TIER_AT, SPELLS_PER_TIER, type FaithSpellDef } from '../../src/game/patrons';

const psql = (sql: string): string =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
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
const near = (a: number, b: number, by = 1e-6): boolean => Math.abs(a - b) <= by;
const spell = (id: string): FaithSpellDef => {
  const s = FAITH_SPELL_BY_ID.get(`chaos_${id}`);
  if (!s) throw new Error(`no chaos_${id}`);
  return s;
};
const fx = (id: string, k: string): number => spell(id).fx[k];
const pct = (x: number): string => `${Math.round(x * 1000) / 10}%`;

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w record; o uuid; v_px double precision; v_py double precision; r jsonb; c creature;
        a int; b int; g int; t int; k int; v_item bigint; v_bag bigint; h0 double precision; h1 double precision; v_f double precision;
begin
  select p.world_id, p.uid, wd.spawn_x, wd.spawn_y into w from player p join world wd on wd.id = p.world_id
   where exists (select 1 from land_tile lt where lt.world_id = wd.id)
     and (select count(*) from player q where q.world_id = p.world_id) >= 2
   order by wd.size desc, p.world_id, p.uid limit 1;
  select uid into o from player where world_id = w.world_id and uid <> w.uid order by uid limit 1;
  v_px := w.spawn_x + peace_reach() + 20.5; v_py := w.spawn_y + 0.5;
  update player set x = v_px, y = v_py, away = false, act = null, act_target = null, equipped = '{}'::jsonb, wounds = '[]'::jsonb,
         fight_stance = 'balanced', blessings = '{}'::jsonb, used_at = '{}'::jsonb, body_at = now(), favour = 0, favour_at = now(),
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('health', 1, 'hunger', 1, 'thirst', 1, 'stamina', 1, 'aegis', 0)
   where world_id = w.world_id and uid in (w.uid, o);
  update player set x = v_px + 40 where world_id = w.world_id and uid = o;
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'body_control', 1), (w.world_id, w.uid, faith_skill(), 50)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  delete from creature where world_id = w.world_id and to_x between v_px - 40 and v_px + 40 and to_y between v_py - 40 and v_py + 40;
  delete from faith_zone where world_id = w.world_id;
  delete from faith_mark where world_id = w.world_id;

  insert into said select 'ROWS', count(*)::text from faith_spell where patron = 'chaos';

  a := creature_spawn(w.world_id, 'rowl', v_px + 3, v_py, 'wild', now() - interval '2 hours');
  b := creature_spawn(w.world_id, 'rowl', v_px - 3, v_py, 'wild', now() - interval '2 hours');
  g := creature_spawn(w.world_id, 'goblin', v_px, v_py + 3, 'wild', now() - interval '2 hours');
  t := creature_spawn(w.world_id, 'rowl', v_px, v_py - 3, 'wild', now() - interval '2 hours');
  update creature set traits = '{}', hunting = null, hunt_again = null, settled_at = now(), until = now() + interval '1 hour'
    where world_id = w.world_id and id in (a, b, g, t);
  update creature set mode = 'active' where world_id = w.world_id and id = t;
  update creature set health = max_health(creature) where world_id = w.world_id and id in (a, b, g, t);

  -- Hex: its share of health a second, for its while.
  perform faith_spell_cast(w.world_id, w.uid, 'chaos_hex', spell_target(w.world_id, w.uid, 'chaos_hex', jsonb_build_object('kind', 'creature', 'id', a)));
  insert into said select 'HEX', round((bleed_rate / max_health(cr))::numeric, 4) || '|' || round(extract(epoch from bleed_until - now())::numeric)
    from creature cr where world_id = w.world_id and id = a;

  -- Fright: refused on a monster; a hunter drops it and runs, and hunts nobody meanwhile.
  insert into said values ('FRIGHT:MONSTER', faith_spell_cast(w.world_id, w.uid, 'chaos_fright',
    spell_target(w.world_id, w.uid, 'chaos_fright', jsonb_build_object('kind', 'creature', 'id', g)))->>'why');
  update creature set hunting = w.uid where world_id = w.world_id and id = b;
  perform faith_spell_cast(w.world_id, w.uid, 'chaos_fright', spell_target(w.world_id, w.uid, 'chaos_fright', jsonb_build_object('kind', 'creature', 'id', b)));
  insert into said select 'FRIGHT', coalesce(hunting::text, 'none') || '|' || round(extract(epoch from hunt_again - now())::numeric)
    || '|' || ((to_x - v_px) ^ 2 + (to_y - v_py) ^ 2 >= (from_x - v_px) ^ 2 + (from_y - v_py) ^ 2)
    from creature where world_id = w.world_id and id = b;

  -- Blood Price: refused short of its floor; health for favour; refused when favour is full.
  update player set stats = jsonb_set(stats, '{health}', '0.25') where world_id = w.world_id and uid = w.uid;
  insert into said values ('PRICE:LOW', faith_spell_cast(w.world_id, w.uid, 'chaos_blood_price',
    spell_target(w.world_id, w.uid, 'chaos_blood_price', '{}'::jsonb))->>'why');
  update player set stats = jsonb_set(stats, '{health}', '1'), favour = 0, favour_at = now() where world_id = w.world_id and uid = w.uid;
  perform faith_spell_cast(w.world_id, w.uid, 'chaos_blood_price', spell_target(w.world_id, w.uid, 'chaos_blood_price', '{}'::jsonb));
  insert into said select 'PRICE', (stats->>'health') || '|' || round(favour::numeric, 4) from player where world_id = w.world_id and uid = w.uid;
  update player set favour = 200, favour_at = now() where world_id = w.world_id and uid = w.uid;
  insert into said values ('PRICE:FULL', faith_spell_cast(w.world_id, w.uid, 'chaos_blood_price',
    spell_target(w.world_id, w.uid, 'chaos_blood_price', '{}'::jsonb))->>'why');

  -- Siphon: its share off the creature, and so much back as a share of a life.
  update creature set health = max_health(creature) * 0.5 where world_id = w.world_id and id = a;
  update player set stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid = w.uid;
  perform faith_spell_cast(w.world_id, w.uid, 'chaos_siphon', spell_target(w.world_id, w.uid, 'chaos_siphon', jsonb_build_object('kind', 'creature', 'id', a)));
  insert into said select 'SIPHON', round((cr.health / max_health(cr))::numeric, 4) || '|' || round(max_health(cr)::numeric, 4)
    || '|' || (select round((stats->>'health')::numeric, 4) from player where world_id = w.world_id and uid = w.uid)
    from creature cr where world_id = w.world_id and id = a;

  -- Cower: the goblin's blow lands its share less than the rowl's.
  perform faith_spell_cast(w.world_id, w.uid, 'chaos_cower', spell_target(w.world_id, w.uid, 'chaos_cower', jsonb_build_object('kind', 'creature', 'id', g)));
  update player set stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{hurtBy}', to_jsonb(g)), wounds = '[]'::jsonb where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.2, 'A test blow', 'bite');
  select (stats->>'health')::double precision into h0 from player where world_id = w.world_id and uid = w.uid;
  -- The first blow turned you on the goblin, which would make the rowl's a blow from the flank.
  update player set stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{hurtBy}', to_jsonb(a)), wounds = '[]'::jsonb, act = null, act_target = null
    where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.2, 'A test blow', 'bite');
  select (stats->>'health')::double precision into h1 from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('COWER', round(((1 - h0) / (1 - h1))::numeric, 4)::text);

  -- Pact: refused without the health; paid, it is harder on everything.
  update player set stats = (stats - 'hurtBy') || '{"health": 0.2}'::jsonb where world_id = w.world_id and uid = w.uid;
  insert into said values ('PACT:POOR', faith_spell_cast(w.world_id, w.uid, 'chaos_pact', spell_target(w.world_id, w.uid, 'chaos_pact', '{}'::jsonb))->>'why');
  update player set stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = w.uid;
  perform faith_spell_cast(w.world_id, w.uid, 'chaos_pact', spell_target(w.world_id, w.uid, 'chaos_pact', '{}'::jsonb));
  insert into said select 'PACT', (stats->>'health') || '|' || faith_arms(w.world_id, w.uid, (select d from species_def d where id = 'rowl'))
    || '|' || faith_arms(w.world_id, w.uid, (select d from species_def d where id = 'goblin')) from player where world_id = w.world_id and uid = w.uid;

  -- Plague: every wild creature inside bleeds; the tame one does not.
  update creature set bleed_rate = null, bleed_until = null where world_id = w.world_id and id in (a, b, g, t);
  perform faith_spell_cast(w.world_id, w.uid, 'chaos_plague', spell_target(w.world_id, w.uid, 'chaos_plague', jsonb_build_object('kind', 'area')));
  insert into said select 'PLAGUE', string_agg(coalesce(round((bleed_rate / max_health(cr))::numeric, 4)::text, 'none'), '|' order by (id = t), id)
    from creature cr where world_id = w.world_id and id in (a, g, t);

  -- Panic: the wild ones run, a monster for less; the tame one stays.
  update creature set hunting = null, hunt_again = null, settled_at = now() where world_id = w.world_id and id in (a, g, t);
  perform faith_spell_cast(w.world_id, w.uid, 'chaos_panic', spell_target(w.world_id, w.uid, 'chaos_panic', jsonb_build_object('kind', 'area')));
  insert into said select 'PANIC', string_agg(coalesce(round(extract(epoch from hunt_again - now())::numeric)::text, 'none'), '|' order by (id = t), id)
    from creature where world_id = w.world_id and id in (a, g, t);

  -- Unmake: a thing worn, locked, or a bag with something in it is refused; anything else is favour.
  update player set favour = 0, favour_at = now() where world_id = w.world_id and uid = w.uid;
  insert into item (world_id, holder, holder_uid, def, ql) values (w.world_id, 'player', w.uid, 'mallet', 40) returning id into v_item;
  update player set equipped = jsonb_build_object('mainhand', v_item) where world_id = w.world_id and uid = w.uid;
  insert into said values ('UNMAKE:WORN', faith_spell_cast(w.world_id, w.uid, 'chaos_unmake',
    spell_target(w.world_id, w.uid, 'chaos_unmake', jsonb_build_object('kind', 'item', 'id', v_item)))->>'why');
  update player set equipped = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  r := faith_spell_cast(w.world_id, w.uid, 'chaos_unmake', spell_target(w.world_id, w.uid, 'chaos_unmake', jsonb_build_object('kind', 'item', 'id', v_item)));
  insert into said select 'UNMAKE', round(favour::numeric, 4) || '|' || (select count(*) from item where id = v_item) from player where world_id = w.world_id and uid = w.uid;

  -- Soul Rend: a kill gives favour back; a creature that lives gives none.
  update player set favour = 0, favour_at = now() where world_id = w.world_id and uid = w.uid;
  k := creature_spawn(w.world_id, 'rowl', v_px + 2, v_py + 2, 'wild', now() - interval '2 hours');
  update creature set traits = '{}', settled_at = now(), until = now() + interval '1 hour' where world_id = w.world_id and id = k;
  update creature set health = max_health(creature) * 0.25 where world_id = w.world_id and id = k;
  perform faith_spell_cast(w.world_id, w.uid, 'chaos_soul_rend', spell_target(w.world_id, w.uid, 'chaos_soul_rend', jsonb_build_object('kind', 'creature', 'id', k)));
  insert into said select 'REND', (select count(*) from creature where world_id = w.world_id and id = k) || '|' || round(favour::numeric, 4)
    from player where world_id = w.world_id and uid = w.uid;
  update creature set health = max_health(creature), settled_at = now() where world_id = w.world_id and id = b;
  perform faith_spell_cast(w.world_id, w.uid, 'chaos_soul_rend', spell_target(w.world_id, w.uid, 'chaos_soul_rend', jsonb_build_object('kind', 'creature', 'id', b)));
  insert into said select 'REND:LIVES', round((health / max_health(cr))::numeric, 4)::text from creature cr where world_id = w.world_id and id = b;

  -- Shroud: its reach, and a hunter further off than that loses you when it is next settled.
  insert into said values ('SHROUD:BEFORE', faith_shroud(w.world_id, w.uid)::text);
  perform faith_spell_cast(w.world_id, w.uid, 'chaos_shroud', spell_target(w.world_id, w.uid, 'chaos_shroud', '{}'::jsonb));
  k := creature_spawn(w.world_id, 'rowl', v_px + ${fx('shroud', 'reach') + 3}, v_py, 'wild', now() - interval '2 hours');
  update creature set traits = '{}', hunting = w.uid, hunt_x = to_x, hunt_y = to_y, hunt_again = null,
      settled_at = now() - interval '1 second', until = now() - interval '1 second' where world_id = w.world_id and id = k;
  perform creature_settle(w.world_id, k);
  insert into said select 'SHROUD', faith_shroud(w.world_id, w.uid) || '|' || coalesce(hunting::text, 'none') from creature where world_id = w.world_id and id = k;

  -- Blood Feast: paid, a blow heals by its share of what it dealt.
  update player set stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid = w.uid;
  perform faith_spell_cast(w.world_id, w.uid, 'chaos_blood_feast', spell_target(w.world_id, w.uid, 'chaos_blood_feast', '{}'::jsonb));
  select (stats->>'health')::double precision into h0 from player where world_id = w.world_id and uid = w.uid;
  perform faith_feast(w.world_id, w.uid, 10);
  insert into said select 'FEAST', round(h0::numeric, 4) || '|' || round(((stats->>'health')::double precision - h0)::numeric, 6)
    from player where world_id = w.world_id and uid = w.uid;

  -- Cataclysm: every wild creature inside loses its share, one weak enough dies; the tame one is untouched.
  update creature set health = max_health(creature), settled_at = now() where world_id = w.world_id and id in (a, g, t);
  k := creature_spawn(w.world_id, 'rowl', v_px - 2, v_py - 2, 'wild', now() - interval '2 hours');
  update creature set traits = '{}', settled_at = now(), until = now() + interval '1 hour' where world_id = w.world_id and id = k;
  update creature set health = max_health(creature) * 0.3 where world_id = w.world_id and id = k;
  delete from faith_mark where world_id = w.world_id;
  perform faith_spell_cast(w.world_id, w.uid, 'chaos_cataclysm', spell_target(w.world_id, w.uid, 'chaos_cataclysm', jsonb_build_object('kind', 'area')));
  insert into said select 'CATA', (select string_agg(round((health / max_health(cr))::numeric, 4)::text, '|' order by (id = t), id)
      from creature cr where world_id = w.world_id and id in (a, g, t))
    || '|' || (select count(*) from creature where world_id = w.world_id and id = k);

  -- Abyssal Gaze: a monster too runs, and takes more while it does.
  update creature set hunting = w.uid, hunt_again = null, settled_at = now() where world_id = w.world_id and id = g;
  perform faith_spell_cast(w.world_id, w.uid, 'chaos_abyssal_gaze', spell_target(w.world_id, w.uid, 'chaos_abyssal_gaze', jsonb_build_object('kind', 'creature', 'id', g)));
  insert into said select 'GAZE', coalesce(hunting::text, 'none') || '|' || round(extract(epoch from hunt_again - now())::numeric)
    || '|' || round(faith_marked(w.world_id, g)::numeric, 4) from creature where world_id = w.world_id and id = g;

  -- Undying: paid, a killing blow leaves its floor, and again, for it is not spent.
  update player set stats = (stats - 'hurtBy') || '{"health": 1}'::jsonb, wounds = '[]'::jsonb, blessings = '{}'::jsonb
    where world_id = w.world_id and uid = w.uid;
  perform faith_spell_cast(w.world_id, w.uid, 'chaos_undying', spell_target(w.world_id, w.uid, 'chaos_undying', '{}'::jsonb));
  select (stats->>'health')::double precision into h0 from player where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 5, 'A test blow', 'bite');
  select (stats->>'health')::double precision into h1 from player where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 5, 'A test blow', 'bite');
  insert into said select 'UNDYING', round(h0::numeric, 4) || '|' || round(h1::numeric, 4) || '|' || round((stats->>'health')::numeric, 4)
    || '|' || (blessings ? 'undying') from player where world_id = w.world_id and uid = w.uid;
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

const CHAOS = FAITH_SPELLS.filter((s) => s.patron === 'chaos');
check(`the island has Chaos's ${CHAOS.length} spells`, island('ROWS') === String(CHAOS.length), island('ROWS'));
check(`Hex: ${pct(fx('hex', 'each'))} a second for ${fx('hex', 'secs')} s`,
  near(Number(parts('HEX')[0]), fx('hex', 'each'), 1e-4) && Number(parts('HEX')[1]) === fx('hex', 'secs'), island('HEX'));
check('Fright is refused on a monster', island('FRIGHT:MONSTER') === 'Monsters are not frightened.', island('FRIGHT:MONSTER'));
check(`and a hunter drops it, hunts nobody for ${fx('fright', 'secs')} s, and runs away`, island('FRIGHT') === `none|${fx('fright', 'secs')}|true`, island('FRIGHT'));
check(`Blood Price is refused under ${pct(fx('blood_price', 'floor'))} of your health`,
  island('PRICE:LOW') === `Blood Price wants at least ${pct(fx('blood_price', 'floor'))} of your health.`, island('PRICE:LOW'));
check(`and takes ${pct(fx('blood_price', 'price'))} of your health for ${fx('blood_price', 'favour')} favour`,
  near(Number(parts('PRICE')[0]), 1 - fx('blood_price', 'price')) && near(Number(parts('PRICE')[1]), fx('blood_price', 'favour')), island('PRICE'));
check('and is refused when favour is full', island('PRICE:FULL') === 'Your favour is full.', island('PRICE:FULL'));
{
  const [ratio, top, hp] = parts('SIPHON').map(Number);
  check(`Siphon takes ${pct(fx('siphon', 'share'))} of the creature and heals you by as much as a blow of it`,
    near(ratio, 0.5 - fx('siphon', 'share'), 1e-3) && near(hp, Math.min(1, 0.5 + top * fx('siphon', 'share') * BLOW_SHARE), 1e-3), island('SIPHON'));
}
check(`Cower: its blows land ${pct(fx('cower', 'cut'))} less`, near(Number(island('COWER')), 1 - fx('cower', 'cut'), 1e-3), island('COWER'));
check('Pact is refused without the health to pay', island('PACT:POOR') === `You have not got ${pct(fx('pact', 'price'))} of your health to spend.`, island('PACT:POOR'));
{
  const [hp, rowl, goblin] = parts('PACT').map(Number);
  check(`and paid, every blow lands ${pct(fx('pact', 'more'))} harder, on anything`,
    near(hp, 1 - fx('pact', 'price')) && near(rowl, 1 + fx('pact', 'more')) && near(goblin, 1 + fx('pact', 'more')), island('PACT'));
}
{
  const [rowl, goblin, tame] = parts('PLAGUE');
  check(`Plague: every wild creature inside bleeds ${pct(fx('plague', 'each'))} a second, the tame one not`,
    near(Number(rowl), fx('plague', 'each'), 1e-4) && near(Number(goblin), fx('plague', 'each'), 1e-4) && tame === 'none', island('PLAGUE'));
}
check(`Panic: wild ones run ${fx('panic', 'secs')} s, a monster ${fx('panic', 'monster')} s, the tame one stays`,
  island('PANIC') === `${fx('panic', 'secs')}|${fx('panic', 'monster')}|none`, island('PANIC'));
check('Unmake is refused on a thing worn', island('UNMAKE:WORN') === 'Take the mallet off first.', island('UNMAKE:WORN'));
check(`and turns a thing of quality forty into ${40 * fx('unmake', 'per')} favour, the thing gone`,
  island('UNMAKE') === `${(40 * fx('unmake', 'per')).toFixed(4)}|0`, island('UNMAKE'));
check(`Soul Rend's kill gives ${fx('soul_rend', 'favour')} favour back`, island('REND') === `0|${fx('soul_rend', 'favour').toFixed(4)}`, island('REND'));
check(`and one that lives loses ${pct(fx('soul_rend', 'share'))}`, island('REND:LIVES') === (1 - fx('soul_rend', 'share')).toFixed(4), island('REND:LIVES'));
check('no Shroud, no limit', Number(island('SHROUD:BEFORE')) >= 1e9, island('SHROUD:BEFORE'));
check(`a Shroud reaches ${fx('shroud', 'reach')} tiles, and a hunter further off loses you`,
  island('SHROUD') === `${fx('shroud', 'reach')}|none`, island('SHROUD'));
{
  const [hp, healed] = parts('FEAST').map(Number);
  check(`Blood Feast costs ${pct(fx('blood_feast', 'price'))} and heals ${pct(fx('blood_feast', 'share'))} of what a blow dealt`,
    near(hp, 0.5 - fx('blood_feast', 'price')) && near(healed, 10 * fx('blood_feast', 'share') * BLOW_SHARE, 1e-5), island('FEAST'));
}
{
  const [rowl, goblin, tame, weak] = parts('CATA');
  const left = (1 - fx('cataclysm', 'share')).toFixed(4);
  check(`Cataclysm takes ${pct(fx('cataclysm', 'share'))} off every wild creature inside, the tame one untouched`,
    rowl === left && goblin === left && tame === '1.0000', island('CATA'));
  check('and kills one weak enough', weak === '0', island('CATA'));
}
check(`Abyssal Gaze: a monster runs ${fx('abyssal_gaze', 'secs')} s and takes ${pct(fx('abyssal_gaze', 'more'))} more`,
  island('GAZE') === `none|${fx('abyssal_gaze', 'secs')}|${(1 + fx('abyssal_gaze', 'more')).toFixed(4)}`, island('GAZE'));
{
  const [paid, first, second, kept] = parts('UNDYING');
  const floor = fx('undying', 'floor').toFixed(4);
  check(`Undying costs ${pct(fx('undying', 'price'))} and leaves ${pct(fx('undying', 'floor'))} after a killing blow, every time`,
    near(Number(paid), 1 - fx('undying', 'price')) && first === floor && second === floor && kept === 'true', island('UNDYING'));
}
check('no function is open to a player but the doors', island('OPEN') === '0', island('OPEN'));

/* ---- The browser's half --------------------------------------------------- */

check(`Chaos offers ${SPELLS_PER_TIER} spells at each of its ${FAITH_TIER_AT.length} tiers`,
  FAITH_TIER_AT.every((_, i) => CHAOS.filter((s) => s.tier === i + 1).length === SPELLS_PER_TIER), CHAOS.map((s) => s.tier).join(','));
check('no Chaos spell is cast on another person', CHAOS.every((s) => !s.on.includes('player')));
check('every spell on the ground has a radius, and no other does', CHAOS.every((s) => s.on.includes('area') === (s.radius !== undefined && s.radius > 0)));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`Chaos's spells — ${ok.length} of ${ok.length}`);
