/**
 * The Blessing's fifteen spells, on the island (`the_blessings_spells.sql`)
 * and in the browser's rulebook (`FAITH_SPELLS` in `src/game/patrons.ts`).
 *
 * Every spell is pointed at something through `spell_target` and cast through
 * `faith_spell_cast`, as `rpc_cast_spell` does, and what it did is read back:
 * health, wounds, a creature's hunt, a boon kept on somebody, a zone on the
 * ground, a tree a stage on. What lasts a while is then asked of the rule it
 * works through: a blow through `hurt_player`, healing through
 * `faith_renewal`, a monster through `faith_arms`, a job through
 * `faith_steady`, a taming through `tame_chance`, the beach through
 * `at_peace`, a hunter through `faith_radiance`. And one goes through the door
 * itself, taken, put on the bar, paid for and resting.
 *
 * Every number asked after is the browser's, off the spell's own `fx`.
 */
import { execFileSync } from 'node:child_process';
import { FAITH_SPELL_BY_ID, FAITH_SPELLS, FAITH_TIER_AT, LAND_GROWS, SPELLS_PER_TIER, type FaithSpellDef } from '../../src/game/patrons';
import { TREE_AGES } from '../../src/world/tiles';

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
  const s = FAITH_SPELL_BY_ID.get(`blessing_${id}`);
  if (!s) throw new Error(`no blessing_${id}`);
  return s;
};
const fx = (id: string, k: string): number => spell(id).fx[k];

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w record; o uuid; v_px double precision; v_py double precision; r jsonb; a int; g int; t int; v_item bigint; v_log bigint;
        h0 double precision; h1 double precision; h2 double precision; c creature; v_before double precision; v_tx int; v_ty int;
  -- One spell, pointed and cast as the door does it.
begin
  select p.world_id, p.uid, wd.spawn_x, wd.spawn_y into w from player p join world wd on wd.id = p.world_id
   where exists (select 1 from land_tile lt where lt.world_id = wd.id)
     and (select count(*) from player q where q.world_id = p.world_id) >= 2
   order by wd.size desc, p.world_id, p.uid limit 1;
  select uid into o from player where world_id = w.world_id and uid <> w.uid order by uid limit 1;
  v_px := w.spawn_x + peace_reach() + 20.5; v_py := w.spawn_y + 0.5;
  update player set x = v_px, y = v_py, away = false, act = null, act_target = null, equipped = '{}'::jsonb, wounds = '[]'::jsonb,
         fight_stance = 'balanced', blessings = '{}'::jsonb, used_at = '{}'::jsonb, body_at = now(),
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('health', 1, 'hunger', 1, 'thirst', 1, 'stamina', 1, 'aegis', 0)
   where world_id = w.world_id and uid in (w.uid, o);
  update player set x = v_px + 2 where world_id = w.world_id and uid = o;
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'body_control', 1)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  delete from event where uid in (w.uid, o);
  delete from creature where world_id = w.world_id and to_x between v_px - 30 and v_px + 30 and to_y between v_py - 30 and v_py + 30;

  insert into said select 'ROWS', count(*) || '|' || md5(string_agg(id || cost || rest || array_to_string(on_what, ',') || coalesce(radius, 0)
    || fx::text || note, '' order by id)) from faith_spell where patron = 'blessing';

  -- Soothe: the worse of two bleeding wounds stopped, and a share of health back; and then nothing to do.
  update player set stats = jsonb_set(stats, '{health}', '0.5'), wounds = jsonb_build_array(
      jsonb_build_object('kind', 'cut', 'part', 'arm', 'severity', 0.2, 'bleeding', true, 'infected', false, 'dressing', null),
      jsonb_build_object('kind', 'cut', 'part', 'leg', 'severity', 0.1, 'bleeding', true, 'infected', false, 'dressing', null))
    where world_id = w.world_id and uid = w.uid;
  r := faith_spell_cast(w.world_id, w.uid, 'blessing_soothe', spell_target(w.world_id, w.uid, 'blessing_soothe', '{}'::jsonb));
  insert into said select 'SOOTHE', (stats->>'health') || '|' || (wounds->0->>'bleeding') || '|' || (wounds->1->>'bleeding') || '|' || coalesce(r->>'said', r->>'why')
    from player where world_id = w.world_id and uid = w.uid;
  update player set stats = jsonb_set(stats, '{health}', '1'), wounds = '[]'::jsonb where world_id = w.world_id and uid = w.uid;
  insert into said values ('SOOTHE:WHOLE', faith_spell_cast(w.world_id, w.uid, 'blessing_soothe',
    spell_target(w.world_id, w.uid, 'blessing_soothe', '{}'::jsonb))->>'why');
  update player set stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid = o;
  r := faith_spell_cast(w.world_id, w.uid, 'blessing_soothe', spell_target(w.world_id, w.uid, 'blessing_soothe',
    jsonb_build_object('kind', 'player', 'uid', o)));
  insert into said select 'SOOTHE:OTHER', (stats->>'health') || '|' || (select count(*) from event where uid = o and text like '% casts Soothe on you.%')
    from player where world_id = w.world_id and uid = o;

  -- Ward: the next blow is cut by its share, and only the next.
  update player set stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = w.uid;
  perform faith_spell_cast(w.world_id, w.uid, 'blessing_ward', spell_target(w.world_id, w.uid, 'blessing_ward', '{}'::jsonb));
  perform hurt_player(w.world_id, w.uid, 0.2, 'A test blow', 'bite');
  select (stats->>'health')::double precision into h1 from player where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.2, 'A test blow', 'bite');
  select (stats->>'health')::double precision into h2 from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('WARD', round(((1 - h1) / (h1 - h2))::numeric, 4) || '|' || ((select blessings from player where world_id = w.world_id and uid = w.uid) ? 'ward'));

  -- Shield of Dawn: a blow it can hold, then one that breaks it and is only partly held.
  update player set stats = jsonb_set(stats, '{health}', '1'), wounds = '[]'::jsonb where world_id = w.world_id and uid = w.uid;
  perform faith_spell_cast(w.world_id, w.uid, 'blessing_shield', spell_target(w.world_id, w.uid, 'blessing_shield', '{}'::jsonb));
  perform hurt_player(w.world_id, w.uid, 0.2, 'A test blow', 'bite');
  select (stats->>'health')::double precision into h1 from player where world_id = w.world_id and uid = w.uid;
  insert into said select 'SHIELD:HELD', h1 || '|' || round((blessings->'shield'->>'left')::numeric, 4) from player where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.2, 'A test blow', 'bite');
  select (stats->>'health')::double precision into h2 from player where world_id = w.world_id and uid = w.uid;
  insert into said select 'SHIELD:BROKE', round((h1 - h2)::numeric, 4) || '|' || (blessings ? 'shield') from player where world_id = w.world_id and uid = w.uid;

  -- Second Life: the blow that would kill leaves its share instead, once.
  update player set stats = jsonb_set(stats, '{health}', '0.1'), wounds = '[]'::jsonb where world_id = w.world_id and uid = w.uid;
  perform faith_spell_cast(w.world_id, w.uid, 'blessing_second_life', spell_target(w.world_id, w.uid, 'blessing_second_life', '{}'::jsonb));
  perform hurt_player(w.world_id, w.uid, 0.5, 'A test blow', 'bite');
  insert into said select 'SECOND', (stats->>'health') || '|' || (blessings ? 'second_life') from player where world_id = w.world_id and uid = w.uid;

  -- Purify: venom drawn and burns closed; then nothing to draw.
  update player set wounds = jsonb_build_array(
      jsonb_build_object('kind', 'bite', 'part', 'arm', 'severity', 0.1, 'bleeding', true, 'infected', false, 'dressing', null, 'venom', 5),
      jsonb_build_object('kind', 'burn', 'part', 'chest', 'severity', 0.1, 'bleeding', true, 'infected', false, 'dressing', null))
    where world_id = w.world_id and uid = w.uid;
  perform faith_spell_cast(w.world_id, w.uid, 'blessing_purify', spell_target(w.world_id, w.uid, 'blessing_purify', '{}'::jsonb));
  insert into said select 'PURIFY', jsonb_array_length(wounds) || '|' || (wounds->0->>'venom') from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('PURIFY:NONE', faith_spell_cast(w.world_id, w.uid, 'blessing_purify',
    spell_target(w.world_id, w.uid, 'blessing_purify', '{}'::jsonb))->>'why');

  -- Renewal: refused at full health; and what it heals over a stretch it covered.
  update player set stats = jsonb_set(stats, '{health}', '1'), wounds = '[]'::jsonb where world_id = w.world_id and uid = w.uid;
  insert into said values ('RENEW:WHOLE', faith_spell_cast(w.world_id, w.uid, 'blessing_renewal',
    spell_target(w.world_id, w.uid, 'blessing_renewal', '{}'::jsonb))->>'why');
  update player set stats = jsonb_set(stats, '{health}', '0.5') where world_id = w.world_id and uid = w.uid;
  perform faith_spell_cast(w.world_id, w.uid, 'blessing_renewal', spell_target(w.world_id, w.uid, 'blessing_renewal', '{}'::jsonb));
  insert into said select 'RENEW', round(faith_renewal(jsonb_set(jsonb_set(blessings, '{renewal,at}', to_jsonb(now() - interval '1 hour')),
      '{renewal,until}', to_jsonb(now() - interval '1 hour' + make_interval(secs => (${fx('renewal', 'secs')})))), now() - interval '2 hours')::numeric, 4)
    || '|' || round(faith_renewal(blessings, now())::numeric, 4)
    from player where world_id = w.world_id and uid = w.uid;

  -- Bless Arms: harder on a monster, the same on anything else.
  perform faith_spell_cast(w.world_id, w.uid, 'blessing_arms', spell_target(w.world_id, w.uid, 'blessing_arms', '{}'::jsonb));
  insert into said select 'ARMS', faith_arms(w.world_id, w.uid, (select d from species_def d where id = 'goblin'))
    || '|' || faith_arms(w.world_id, w.uid, (select d from species_def d where id = 'rowl'))
    || '|' || faith_arms(w.world_id, o, (select d from species_def d where id = 'goblin'));

  -- Steady Hands: on a tool, the jobs wanting it are quicker; on anything else, refused.
  insert into item (world_id, holder, holder_uid, def, ql) values (w.world_id, 'player', w.uid, 'mallet', 30) returning id into v_item;
  insert into item (world_id, holder, holder_uid, def, ql) values (w.world_id, 'player', w.uid, 'log', 30) returning id into v_log;
  r := faith_spell_cast(w.world_id, w.uid, 'blessing_steady', spell_target(w.world_id, w.uid, 'blessing_steady', jsonb_build_object('kind', 'item', 'id', v_item)));
  insert into said values ('STEADY', faith_steady(w.world_id, w.uid, 'mallet') || '|' || faith_steady(w.world_id, w.uid, 'trowel')
    || '|' || faith_steady(w.world_id, w.uid, null) || '|' || coalesce(r->>'said', r->>'why'));
  insert into said values ('STEADY:LOG', faith_spell_cast(w.world_id, w.uid, 'blessing_steady',
    spell_target(w.world_id, w.uid, 'blessing_steady', jsonb_build_object('kind', 'item', 'id', v_log)))->>'why');

  -- Creatures: a rowl, a goblin, and a tame rowl.
  a := creature_spawn(w.world_id, 'rowl', v_px + 3, v_py, 'wild', now() - interval '2 hours');
  g := creature_spawn(w.world_id, 'goblin', v_px, v_py + 3, 'wild', now() - interval '2 hours');
  t := creature_spawn(w.world_id, 'rowl', v_px - 3, v_py, 'wild', now() - interval '2 hours');
  update creature set traits = '{}', hunting = null, hunt_again = null, settled_at = now(), until = now() + interval '1 hour'
    where world_id = w.world_id and id in (a, g, t);
  update creature set mode = 'active' where world_id = w.world_id and id = t;

  -- Tend: back by its share and no longer bleeding; then nothing to do.
  update creature set health = max_health(creature) * 0.5, bleed_until = now() + interval '1 minute', bleed_rate = 0.1
    where world_id = w.world_id and id = a;
  perform faith_spell_cast(w.world_id, w.uid, 'blessing_tend', spell_target(w.world_id, w.uid, 'blessing_tend', jsonb_build_object('kind', 'creature', 'id', a)));
  insert into said select 'TEND', round((health / max_health(cr))::numeric, 4) || '|' || (bleed_until is null) from creature cr where world_id = w.world_id and id = a;
  update creature set health = max_health(creature) where world_id = w.world_id and id = a;
  insert into said values ('TEND:WHOLE', faith_spell_cast(w.world_id, w.uid, 'blessing_tend',
    spell_target(w.world_id, w.uid, 'blessing_tend', jsonb_build_object('kind', 'creature', 'id', a)))->>'why');

  -- Kinship: the next taming of that one likelier, then spent; never on a monster or a tame one.
  select * into c from creature where world_id = w.world_id and id = a;
  v_before := tame_chance(w.world_id, w.uid, c);
  perform faith_spell_cast(w.world_id, w.uid, 'blessing_kinship', spell_target(w.world_id, w.uid, 'blessing_kinship', jsonb_build_object('kind', 'creature', 'id', a)));
  insert into said values ('KIN', round(v_before::numeric, 4) || '|' || round(tame_chance(w.world_id, w.uid, c)::numeric, 4));
  perform faith_kinship_spent(w.world_id, w.uid, a);
  insert into said values ('KIN:SPENT', round(tame_chance(w.world_id, w.uid, c)::numeric, 4));
  insert into said values ('KIN:MONSTER', faith_spell_cast(w.world_id, w.uid, 'blessing_kinship',
    spell_target(w.world_id, w.uid, 'blessing_kinship', jsonb_build_object('kind', 'creature', 'id', g)))->>'why');
  insert into said values ('KIN:TAME', faith_spell_cast(w.world_id, w.uid, 'blessing_kinship',
    spell_target(w.world_id, w.uid, 'blessing_kinship', jsonb_build_object('kind', 'creature', 'id', t)))->>'why');

  -- Calm: the hunt dropped and none started for its while; never a monster.
  update creature set hunting = w.uid where world_id = w.world_id and id = a;
  perform faith_spell_cast(w.world_id, w.uid, 'blessing_calm', spell_target(w.world_id, w.uid, 'blessing_calm', jsonb_build_object('kind', 'creature', 'id', a)));
  insert into said select 'CALM', coalesce(hunting::text, 'none') || '|' || round(extract(epoch from hunt_again - now())) from creature where world_id = w.world_id and id = a;
  insert into said values ('CALM:MONSTER', faith_spell_cast(w.world_id, w.uid, 'blessing_calm',
    spell_target(w.world_id, w.uid, 'blessing_calm', jsonb_build_object('kind', 'creature', 'id', g)))->>'why');

  -- Benediction: both people and the hurt tame rowl, but not the goblin hunting you.
  update player set stats = jsonb_set(stats, '{health}', '0.5'), wounds = '[]'::jsonb where world_id = w.world_id and uid in (w.uid, o);
  update creature set health = max_health(creature) * 0.5 where world_id = w.world_id and id in (t, g);
  update creature set hunting = w.uid where world_id = w.world_id and id = g;
  r := faith_spell_cast(w.world_id, w.uid, 'blessing_benediction', spell_target(w.world_id, w.uid, 'blessing_benediction', jsonb_build_object('kind', 'area')));
  insert into said select 'BENEDICT', (select string_agg(stats->>'health', '|' order by uid) from player where world_id = w.world_id and uid in (w.uid, o))
    || '|' || (select round((health / max_health(cr))::numeric, 4) from creature cr where world_id = w.world_id and id = t)
    || '|' || (select round((health / max_health(cr))::numeric, 4) from creature cr where world_id = w.world_id and id = g)
    || '|' || coalesce(r->>'said', r->>'why');

  -- Sanctuary: the ground round the spot is at peace while it lasts, and only there.
  insert into said values ('SANCT:BEFORE', at_peace(w.world_id, v_px, v_py)::text);
  perform faith_spell_cast(w.world_id, w.uid, 'blessing_sanctuary', spell_target(w.world_id, w.uid, 'blessing_sanctuary', jsonb_build_object('kind', 'area')));
  insert into said values ('SANCT', at_peace(w.world_id, v_px + 1, v_py) || '|' || at_peace(w.world_id, v_px + ${(spell('sanctuary').radius ?? 0) + 1}, v_py));

  -- Radiance: a hunter inside loses its share a second for the seconds it spent there, and never its last.
  perform faith_spell_cast(w.world_id, w.uid, 'blessing_radiance', spell_target(w.world_id, w.uid, 'blessing_radiance', jsonb_build_object('kind', 'area')));
  update faith_zone set at = now() - interval '10 seconds', until = now() + interval '20 seconds' where world_id = w.world_id and kind = 'radiance';
  select * into c from creature where world_id = w.world_id and id = g;
  c.health := max_health(c); c.settled_at := now() - interval '10 seconds';
  c := faith_radiance(w.world_id, c, v_px, v_py + 3);
  insert into said values ('RADIANCE', round((c.health / max_health(c))::numeric, 4)::text);
  c.health := 2; c.settled_at := now() - interval '10 seconds';
  c := faith_radiance(w.world_id, c, v_px, v_py + 3);
  insert into said values ('RADIANCE:LAST', c.health::text);
  c.health := max_health(c); c.settled_at := now() - interval '10 seconds';
  c := faith_radiance(w.world_id, c, v_px + ${(spell('radiance').radius ?? 0) + 2}, v_py);
  insert into said values ('RADIANCE:OUT', round((c.health / max_health(c))::numeric, 4)::text);

  -- Bless the Land: a sapling, a very old tree and a clipped one, side by side.
  v_tx := floor(v_px)::int + 1; v_ty := floor(v_py)::int + 1;
  for i in 0..2 loop
    perform land_set_tile(w.world_id, v_tx + i, v_ty, tile_id('Tree'));
  end loop;
  perform land_set_data(w.world_id, v_tx, v_ty, 3 << 4);
  perform land_set_data(w.world_id, v_tx + 1, v_ty, 4 << 4);
  perform land_set_data(w.world_id, v_tx + 2, v_ty, 6 << 4);
  r := faith_spell_cast(w.world_id, w.uid, 'blessing_land', spell_target(w.world_id, w.uid, 'blessing_land', jsonb_build_object('kind', 'area')));
  insert into said values ('LAND', tree_age(land_data(w.world_id, v_tx, v_ty)) || '|' || tree_age(land_data(w.world_id, v_tx + 1, v_ty))
    || '|' || tree_age(land_data(w.world_id, v_tx + 2, v_ty)) || '|' || (select count(*) from tile_change where world_id = w.world_id
      and x between v_tx and v_tx + 2 and y = v_ty) || '|' || coalesce(r->>'said', r->>'why'));

  -- And the door: Soothe taken, on the bar, paid for and resting.
  update player set patron = 'blessing', spell_bar = '[]'::jsonb, used_at = '{}'::jsonb, favour = 40, favour_at = now(),
         stats = jsonb_set(stats, '{health}', '0.5'), wounds = '[]'::jsonb
   where world_id = w.world_id and uid = w.uid;
  delete from player_spell where world_id = w.world_id and uid = w.uid;
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, faith_skill(), 25)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  perform set_config('request.jwt.claims', json_build_object('sub', w.uid)::text, true);
  delete from caller where uid = w.uid;
  r := rpc_take_faith_spell(w.world_id, 'blessing_soothe');
  r := rpc_cast_spell(w.world_id, 3, jsonb_build_object('kind', 'self'));
  insert into said values ('DOOR', coalesce(r->>'cast', r->>'why') || '|' || (r->>'favour') || '|' || coalesce(r->'rest'->>'blessing_soothe', 'none')
    || '|' || (select stats->>'health' from player where world_id = w.world_id and uid = w.uid));
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

const BLESSING = FAITH_SPELLS.filter((s) => s.patron === 'blessing');
check(`the island has the Blessing's ${BLESSING.length} spells`, parts('ROWS')[0] === String(BLESSING.length), island('ROWS'));

{
  const [hp, worse, lesser, line] = parts('SOOTHE');
  check(`Soothe heals ${fx('soothe', 'heal') * 100}% and stops the worse of two bleeding wounds only`,
    near(Number(hp), 0.5 + fx('soothe', 'heal')) && worse === 'false' && lesser === 'true', island('SOOTHE'));
  check('and says so', line === `Soothe heals you by ${fx('soothe', 'heal') * 100}% and stops a wound bleeding.`, line);
}
check('and is refused on somebody whole', island('SOOTHE:WHOLE') === 'You are not hurt.', island('SOOTHE:WHOLE'));
check('cast on somebody else it heals them and tells them',
  near(Number(parts('SOOTHE:OTHER')[0]), 0.5 + fx('soothe', 'heal')) && parts('SOOTHE:OTHER')[1] === '1', island('SOOTHE:OTHER'));
check(`Ward cuts the next blow by ${fx('ward', 'cut') * 100}% and is gone after it`,
  near(Number(parts('WARD')[0]), 1 - fx('ward', 'cut'), 1e-3) && parts('WARD')[1] === 'false', island('WARD'));
check(`Shield of Dawn holds a blow within its ${fx('shield', 'share') * 100}% and keeps the rest`,
  near(Number(parts('SHIELD:HELD')[0]), 1) && near(Number(parts('SHIELD:HELD')[1]), fx('shield', 'share') - 0.2, 1e-4), island('SHIELD:HELD'));
check('and a blow past what is left breaks it, the rest getting through',
  near(Number(parts('SHIELD:BROKE')[0]), 0.2 - (fx('shield', 'share') - 0.2), 1e-3) && parts('SHIELD:BROKE')[1] === 'false', island('SHIELD:BROKE'));
check(`Second Life takes the killing blow and leaves ${fx('second_life', 'heal') * 100}%, once`,
  near(Number(parts('SECOND')[0]), fx('second_life', 'heal')) && parts('SECOND')[1] === 'false', island('SECOND'));
check('Purify closes the burn and draws the venom', island('PURIFY') === '1|0', island('PURIFY'));
check('and is refused with neither', island('PURIFY:NONE') === 'You carry no venom and no burns.', island('PURIFY:NONE'));
check('Renewal is refused on somebody whole', island('RENEW:WHOLE') === 'You are not hurt.', island('RENEW:WHOLE'));
check(`and heals ${fx('renewal', 'each') * 100}% every ${fx('renewal', 'every')} s over its ${fx('renewal', 'secs')} s, nothing before`,
  near(Number(parts('RENEW')[0]), fx('renewal', 'each') * fx('renewal', 'secs') / fx('renewal', 'every'), 1e-4) && near(Number(parts('RENEW')[1]), 0),
  island('RENEW'));
check(`Bless Arms is ${fx('arms', 'more') * 100}% on a monster, nothing on anything else or anybody else`,
  near(Number(parts('ARMS')[0]), 1 + fx('arms', 'more')) && parts('ARMS')[1] === '1' && parts('ARMS')[2] === '1', island('ARMS'));
check(`Steady Hands takes ${fx('steady', 'cut') * 100}% off a job wanting that tool, and nothing off another`,
  near(Number(parts('STEADY')[0]), 1 - fx('steady', 'cut')) && parts('STEADY')[1] === '1' && parts('STEADY')[2] === '1', island('STEADY'));
check('and is refused on what no job wants', island('STEADY:LOG') === 'The log is not a tool any job wants.', island('STEADY:LOG'));
check(`Tend heals a wildermon ${fx('tend', 'heal') * 100}% and stops it bleeding`,
  near(Number(parts('TEND')[0]), 0.5 + fx('tend', 'heal'), 1e-3) && parts('TEND')[1] === 'true', island('TEND'));
check('and is refused on one that is whole', island('TEND:WHOLE') === 'The rowl is not hurt.', island('TEND:WHOLE'));
check(`Kinship adds its ${Math.round(fx('kinship', 'points') * 100)} points to the next taming`,
  near(Number(parts('KIN')[1]), Math.min(0.95, Number(parts('KIN')[0]) + fx('kinship', 'points')), 1e-4), island('KIN'));
check('and the taming spends it', near(Number(island('KIN:SPENT')), Number(parts('KIN')[0]), 1e-4), island('KIN:SPENT'));
check('not on a monster', island('KIN:MONSTER') === 'Monsters cannot be tamed.', island('KIN:MONSTER'));
check('nor on a tame one', island('KIN:TAME') === 'The rowl is tame already.', island('KIN:TAME'));
check(`Calm drops the hunt and keeps it off ${fx('calm', 'secs')} s`, island('CALM') === `none|${fx('calm', 'secs')}`, island('CALM'));
check('and is refused on a monster', island('CALM:MONSTER') === 'Monsters are not calmed.', island('CALM:MONSTER'));
{
  const [me, other, tame, goblin, line] = parts('BENEDICT');
  const h = fx('benediction', 'heal');
  check(`Benediction heals both people and the hurt tame rowl ${h * 100}%, not the goblin after you`,
    near(Number(me), 0.5 + h) && near(Number(other), 0.5 + h) && near(Number(tame), 0.5 + h, 1e-3) && near(Number(goblin), 0.5, 1e-3), island('BENEDICT'));
  check('and says so', line === `Benediction heals 2 people and 1 wildermon by ${h * 100}%.`, line);
}
check('Sanctuary: not at peace off the beach before it', island('SANCT:BEFORE') === 'false', island('SANCT:BEFORE'));
check('at peace inside it, and not past its edge', island('SANCT') === 'true|false', island('SANCT'));
check(`Radiance burns a hunter inside ${fx('radiance', 'each') * 100}% a second`,
  near(Number(island('RADIANCE')), 1 - fx('radiance', 'each') * 10, 1e-4), island('RADIANCE'));
check('never its last point of health', island('RADIANCE:LAST') === '1', island('RADIANCE:LAST'));
check('and nothing outside it', island('RADIANCE:OUT') === '1.0000', island('RADIANCE:OUT'));
{
  const [sapling, veryOld, clipped, told, line] = parts('LAND');
  const step = new Map(LAND_GROWS);
  const id = (name: string): number => TREE_AGES.find((a) => a.name === name)?.id ?? -1;
  check('Bless the Land grows a sapling a stage', Number(sapling) === step.get(id('Sapling')), island('LAND'));
  check('but not a very old tree into dying, nor a clipped one', Number(veryOld) === id('Very old') && Number(clipped) === id('Clipped'), island('LAND'));
  check('and the browsers are told of the one it grew', told === '1' && line === 'Bless the Land grows 1 tree a stage.', island('LAND'));
}
{
  const [cast, favour, rest, hp] = parts('DOOR');
  check('through the door: taken, cast off the bar, paid for and resting',
    cast === 'blessing_soothe' && favour === String(40 - spell('soothe').cost) && near(Number(rest), spell('soothe').rest, 1)
      && near(Number(hp), 0.5 + fx('soothe', 'heal')), island('DOOR'));
}
check('no function is open to a player but the doors', island('OPEN') === '0', island('OPEN'));

/* ---- The browser's half --------------------------------------------------- */

check(`the Blessing offers ${SPELLS_PER_TIER} spells at each of its ${FAITH_TIER_AT.length} tiers`,
  FAITH_TIER_AT.every((_, i) => BLESSING.filter((s) => s.tier === i + 1).length === SPELLS_PER_TIER), BLESSING.map((s) => s.tier).join(','));
check('every spell on the ground has a radius, and no other does', BLESSING.every((s) => s.on.includes('area') === (s.radius !== undefined && s.radius > 0)));
check('Bless the Land grows nothing into dying', LAND_GROWS.every(([, b]) => TREE_AGES.find((a) => a.id === b)?.alive));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Blessing's spells — ${ok.length} of ${ok.length}`);
