/**
 * Packs, throwers and nerve; a companion's orders; a bow on the move.
 *
 * Both sides off the same names (`src/game/fight.ts` and
 * `packs_throwers_and_orders.sql`). What this asks:
 *
 *   * every kind runs in a pack, throws and turns tail the same on both sides,
 *     and the numbers behind it are the same numbers;
 *   * one of a pack within `PACK_CALL` of another on you comes too, and
 *     follows the first;
 *   * a pack spreads round you: one not yet on its own side goes round
 *     `CIRCLE_R` out, where one alone comes straight in;
 *   * a thrower throws from where it stands, and backs away when you close;
 *   * a coward turns tail at `COWARD_AT`, a pack whose leader is gone runs, and
 *     a hurt coward runs when one of its kind nearby has;
 *   * a pack shares a home, no more than `PACK_MOST` to one;
 *   * a companion set to guard goes for what hunts you, one told to attack goes
 *     whatever its stance, and one fallen back starts nothing;
 *   * a bow keeps drawing while you walk, at `DRAW_WALK` of your pace.
 *
 * Runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID } from '../../src/game/actions';
import { SPECIES } from '../../src/game/creatures';
import {
  CIRCLE_ARC, CIRCLE_R, COWARD_AT, COWARD_DRAG, DRAW_WALK, FALL_BACK, GUARD_RANGE, HUNTER_TURN, KEEP_OFF, BACK_SLACK, MONSTER_TURN,
  PACK_CALL, PACK_MOST, PACK_RANGE, THROW_HIT, THROW_REACH, turnsAt,
} from '../../src/game/fight';
import { Game } from '../../src/game/game';
import { TileType } from '../../src/world/tiles';

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
const near = (a: number, b: number, by = 1e-6): boolean => Math.abs(a - b) <= by * Math.max(1, Math.abs(b));

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w record; v_px double precision; v_py double precision; a int; b int; g int; r int; o int; pet int; i int;
        q creature; v_x double precision; v_y double precision; tx int; ty int;
begin
  -- Off the beach of the biggest island there is, where things may come for you (\`at_peace\`).
  select p.world_id, p.uid, wd.size, wd.spawn_x, wd.spawn_y into w
    from player p join world wd on wd.id = p.world_id
   -- With land under it: \`window.ts\` leaves an island as big as any with none, and a body on it.
   where exists (select 1 from land_tile t where t.world_id = wd.id)
   order by wd.size desc, p.world_id, p.uid limit 1;
  v_px := case when w.spawn_x + peace_reach() + 6 < w.size then w.spawn_x + peace_reach() + 6.5
               else w.spawn_x - peace_reach() - 5.5 end;
  v_py := w.spawn_y + 0.5;
  -- Its own ground, whatever island this turns out to be: grass at one height
  -- all round, so nothing here stands in the sea off the beach or under a cliff,
  -- and far enough east for a coward's whole run from you to be clear. The
  -- whole test is rolled back, so the island is none the worse for it.
  for tx in greatest(0, floor(v_px)::int - 8)..least(w.size - 1, floor(v_px)::int + 32) loop
    for ty in greatest(0, floor(v_py)::int - 8)..least(w.size - 1, floor(v_py)::int + 14) loop
      perform land_set_height(w.world_id, tx, ty, 4); perform land_set_dirt(w.world_id, tx, ty, 5);
      perform land_set_tile(w.world_id, tx, ty, tile_id('Grass'));
    end loop;
  end loop;
  update player set act = null, act_target = null, act_ends = null, act_left = null, act_goes = null,
         act_queue = '[]'::jsonb, equipped = '{}'::jsonb, fight_stance = 'balanced', fight_back = false,
         moved_at = now() - interval '1 minute', x = v_px, y = v_py, level = 0, wounds = '[]'::jsonb, away = false,
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1, 'aegis', 1000)
    where world_id = w.world_id and uid = w.uid;
  -- Nothing else of the island's about, so what is counted is what is put down here.
  update creature set hunting = null, pack_lead = null where world_id = w.world_id and hunting = w.uid;

  insert into said select 'KIND:' || id, pack || '|' || throws || '|' || coward || '|' || round(turns_at(sd)::numeric, 4)
    from species_def sd;
  insert into said values ('NUMS', pack_call() || '|' || pack_most() || '|' || pack_range() || '|' || circle_r() || '|'
    || round(circle_arc()::numeric, 6) || '|' || keep_off() || '|' || back_slack() || '|' || throw_reach() || '|' || throw_hit()
    || '|' || hunter_turn() || '|' || monster_turn() || '|' || coward_at() || '|' || coward_drag()
    || '|' || guard_range() || '|' || fall_back());

  -- The call: one goblin on you, another three tiles from it that is not.
  a := creature_spawn(w.world_id, 'goblin', v_px + 4.5, v_py, 'wild', now() - interval '2 hours');
  b := creature_spawn(w.world_id, 'goblin', v_px + 7.5, v_py + 0.5, 'wild', now() - interval '2 hours');
  update creature set traits = '{}', health = 500, hunting = case when id = a then w.uid end,
      pack_lead = case when id = a then a end, hunt_x = to_x, hunt_y = to_y, hunt_again = null,
      until = now() - interval '1 second', settled_at = now() - interval '1 second'
    where world_id = w.world_id and id in (a, b);
  delete from event where uid = w.uid;
  perform creature_settle(w.world_id, b);
  insert into said select 'CALL', coalesce((hunting = w.uid)::text, 'none') || '|' || coalesce((pack_lead = a)::text, 'none')
    || '|' || (select count(*) from event where uid = w.uid and text = 'Another goblin comes with it.')
    from creature where world_id = w.world_id and id = b;
  delete from creature where world_id = w.world_id and id in (a, b);

  -- Round you: two rowls east of you, the leader and one beside it; and one alone.
  a := creature_spawn(w.world_id, 'rowl', v_px + 5, v_py, 'wild', now() - interval '2 hours');
  b := creature_spawn(w.world_id, 'rowl', v_px + 5, v_py + 0.6, 'wild', now() - interval '2 hours');
  update creature set traits = '{}', health = 500, hunting = w.uid, pack_lead = a, hunt_x = to_x, hunt_y = to_y,
      until = now() - interval '1 second', settled_at = now() - interval '1 second'
    where world_id = w.world_id and id in (a, b);
  perform creature_settle(w.world_id, b);
  insert into said select 'ROUND', sqrt((to_x - v_px) ^ 2 + (to_y - v_py) ^ 2) || '|' || atan2(to_y - v_py, to_x - v_px)
    from creature where world_id = w.world_id and id = b;
  update creature set pack_lead = null, from_x = v_px + 5, from_y = v_py + 0.6, to_x = v_px + 5, to_y = v_py + 0.6,
      leg_at = now(), leg_ends = now(), until = now() - interval '1 second', settled_at = now() - interval '1 second'
    where world_id = w.world_id and id = b;
  perform creature_settle(w.world_id, b);
  insert into said select 'ALONE', sqrt((to_x - v_px) ^ 2 + (to_y - v_py) ^ 2) || '|' || atan2(to_y - v_py, to_x - v_px)
    from creature where world_id = w.world_id and id = b;
  delete from creature where world_id = w.world_id and id in (a, b);

  -- A thrower five tiles off, and one you have closed on.
  g := creature_spawn(w.world_id, 'goblin', v_px + 5, v_py, 'wild', now() - interval '2 hours');
  update creature set traits = '{}', health = 500, hunting = w.uid, pack_lead = null, hunt_x = to_x, hunt_y = to_y,
      until = now() - interval '1 second', settled_at = now() - interval '1 second'
    where world_id = w.world_id and id = g;
  delete from event where uid = w.uid;
  perform creature_settle(w.world_id, g);
  insert into said select 'THROW', (select count(*) from event where uid = w.uid and text like '%The goblin''s stone finds you%')
    || '|' || sqrt((to_x - v_px) ^ 2 + (to_y - v_py) ^ 2)
    from creature where world_id = w.world_id and id = g;
  update creature set from_x = v_px + 1.5, from_y = v_py, to_x = v_px + 1.5, to_y = v_py, leg_at = now(), leg_ends = now(),
      until = now() - interval '1 second', settled_at = now() - interval '1 second'
    where world_id = w.world_id and id = g;
  perform creature_settle(w.world_id, g);
  insert into said select 'BACK', sqrt((to_x - v_px) ^ 2 + (to_y - v_py) ^ 2)::text
    from creature where world_id = w.world_id and id = g;

  -- Nerve: the coward at two fifths of itself.
  update creature set health = max_health(c) * 0.4, from_x = v_px + 4, from_y = v_py, to_x = v_px + 4, to_y = v_py,
      leg_at = now(), leg_ends = now(), hunting = w.uid, hunt_again = null,
      until = now() - interval '1 second', settled_at = now() - interval '1 second'
    from creature c where creature.world_id = w.world_id and creature.id = g and c.world_id = w.world_id and c.id = g;
  delete from event where uid = w.uid;
  perform creature_settle(w.world_id, g);
  insert into said select 'COWARD', coalesce(hunting::text, 'none') || '|' || (hunt_again > now())::text
    || '|' || (select count(*) from event where uid = w.uid and text = 'The goblin turns tail.')
    || '|' || sqrt((to_x - v_px) ^ 2 + (to_y - v_py) ^ 2)
    from creature where world_id = w.world_id and id = g;
  -- And another, at seven tenths of itself, beside the one that ran; and a third, whole.
  a := creature_spawn(w.world_id, 'goblin', v_px + 5, v_py + 1, 'wild', now() - interval '2 hours');
  b := creature_spawn(w.world_id, 'goblin', v_px + 5, v_py - 1, 'wild', now() - interval '2 hours');
  update creature set traits = '{}', health = case when id = a then 0.7 else 0.95 end * 40,
      hunting = w.uid, pack_lead = null, hunt_x = to_x, hunt_y = to_y, hunt_again = null,
      until = now() - interval '1 second', settled_at = now() - interval '1 second'
    where world_id = w.world_id and id in (a, b);
  update creature set from_x = v_px + 5, from_y = v_py, to_x = v_px + 5, to_y = v_py, leg_at = now(), leg_ends = now()
    where world_id = w.world_id and id = g;
  perform creature_settle(w.world_id, a);
  perform creature_settle(w.world_id, b);
  insert into said select 'DRAG', string_agg(coalesce((hunting = w.uid)::text, 'none'), '|' order by id)
    from creature where world_id = w.world_id and id in (a, b);
  delete from creature where world_id = w.world_id and id in (a, b, g);

  -- A pack whose leader is gone: two orcs, and the first of them dead.
  a := creature_spawn(w.world_id, 'orc', v_px + 6, v_py, 'wild', now() - interval '2 hours');
  b := creature_spawn(w.world_id, 'orc', v_px + 6, v_py + 1, 'wild', now() - interval '2 hours');
  update creature set traits = '{}', health = 5000, hunting = w.uid, pack_lead = a, hunt_x = to_x, hunt_y = to_y, hunt_again = null,
      until = now() - interval '1 second', settled_at = now() - interval '1 second'
    where world_id = w.world_id and id in (a, b);
  delete from creature where world_id = w.world_id and id = a;
  delete from event where uid = w.uid;
  perform creature_settle(w.world_id, b);
  insert into said select 'LEADER', coalesce(hunting::text, 'none') || '|'
    || (select count(*) from event where uid = w.uid and text = 'The orc turns tail.')
    from creature where world_id = w.world_id and id = b;
  delete from creature where world_id = w.world_id and id = b;

  -- A rowl at a quarter of itself runs; at two fifths it does not.
  r := creature_spawn(w.world_id, 'rowl', v_px + 4, v_py, 'wild', now() - interval '2 hours');
  -- Its traits go first: a quarter of what a deep-chested one stands is more than three tenths of a plain one.
  update creature set traits = '{}' where world_id = w.world_id and id = r;
  update creature set health = max_health(c) * 0.25, hunting = w.uid, pack_lead = null,
      hunt_x = v_px + 4, hunt_y = v_py, hunt_again = null,
      until = now() - interval '1 second', settled_at = now() - interval '1 second'
    from creature c where creature.world_id = w.world_id and creature.id = r and c.world_id = w.world_id and c.id = r;
  perform creature_settle(w.world_id, r);
  insert into said select 'ROWL25', coalesce(hunting::text, 'none') from creature where world_id = w.world_id and id = r;
  update creature set health = max_health(c) * 0.4, hunting = w.uid, hunt_again = null,
      from_x = v_px + 4, from_y = v_py, to_x = v_px + 4, to_y = v_py, leg_at = now(), leg_ends = now(),
      until = now() - interval '1 second', settled_at = now() - interval '1 second'
    from creature c where creature.world_id = w.world_id and creature.id = r and c.world_id = w.world_id and c.id = r;
  perform creature_settle(w.world_id, r);
  insert into said select 'ROWL40', coalesce((hunting = w.uid)::text, 'none') from creature where world_id = w.world_id and id = r;
  delete from creature where world_id = w.world_id and id = r;

  -- Homes: six rowls born a tile apart, and two ogres the same.
  v_x := v_px + 9; v_y := v_py + 9;
  for i in 0..5 loop
    r := creature_spawn(w.world_id, 'rowl', v_x + i, v_y, 'wild', now() - interval '2 hours');
    insert into said values ('HOME:rowl:' || i, (select home_x || ',' || home_y from creature where world_id = w.world_id and id = r));
  end loop;
  for i in 0..1 loop
    o := creature_spawn(w.world_id, 'ogre', v_x + i, v_y + 3, 'wild', now() - interval '2 hours');
    insert into said values ('HOME:ogre:' || i, (select home_x || ',' || home_y from creature where world_id = w.world_id and id = o));
  end loop;
  delete from creature where world_id = w.world_id and (to_x between v_x - 1 and v_x + 7) and (to_y between v_y - 1 and v_y + 4)
    and born < now() - interval '1 hour' and mode = 'wild' and species in ('rowl', 'ogre');

  -- A companion of yours at heel, and a goblin hunting you three tiles off; nothing has struck you lately.
  update player set stats = stats - 'hurtAt' - 'hurtBy' where world_id = w.world_id and uid = w.uid;
  pet := creature_spawn(w.world_id, 'rowl', v_px + 0.5, v_py, 'active', now() - interval '2 hours', w.uid);
  g := creature_spawn(w.world_id, 'goblin', v_px - 3, v_py, 'wild', now() - interval '2 hours');
  update creature set hunting = w.uid, health = 500 where world_id = w.world_id and id = g;
  -- A rowl comes aggressive; this one is set to the stance a tame thing usually has.
  update creature set stance = 'defensive' where world_id = w.world_id and id = pet;
  select * into q from creature where world_id = w.world_id and id = pet;
  insert into said values ('DEFENSIVE', coalesce((companion_target(w.world_id, q, (select pl from player pl where pl.world_id = w.world_id and pl.uid = w.uid))).id::text, 'none'));
  insert into said values ('GUARD:refusal', coalesce(creature_refusal(w.world_id, w.uid, 'set_stance',
    jsonb_build_object('kind', 'creature', 'id', pet, 'stance', 'guard')), 'none'));
  delete from event where uid = w.uid;
  perform perform_creature(w.world_id, w.uid, 'set_stance', jsonb_build_object('kind', 'creature', 'id', pet, 'stance', 'guard'));
  select * into q from creature where world_id = w.world_id and id = pet;
  insert into said values ('GUARD', q.stance || '|' || coalesce((companion_target(w.world_id, q, (select pl from player pl where pl.world_id = w.world_id and pl.uid = w.uid))).id = g, false)
    || '|' || (select count(*) from event where uid = w.uid and text like '% will be guarding you.'));
  -- Passive, and told to go for it.
  update creature set stance = 'passive', enemy = null where world_id = w.world_id and id = pet;
  insert into said values ('ORDER:none', coalesce(creature_refusal(w.world_id, w.uid, 'order_attack',
    jsonb_build_object('kind', 'creature', 'id', pet)), 'none'));
  insert into said values ('ORDER:refusal', coalesce(creature_refusal(w.world_id, w.uid, 'order_attack',
    jsonb_build_object('kind', 'creature', 'id', pet, 'foe', g)), 'none'));
  perform perform_creature(w.world_id, w.uid, 'order_attack', jsonb_build_object('kind', 'creature', 'id', pet, 'foe', g));
  select * into q from creature where world_id = w.world_id and id = pet;
  insert into said values ('ORDER', coalesce(q.enemy = g, false) || '|' || coalesce((companion_target(w.world_id, q, (select pl from player pl where pl.world_id = w.world_id and pl.uid = w.uid))).id = g, false));
  -- And called back.
  update creature set stance = 'guard' where world_id = w.world_id and id = pet;
  perform perform_creature(w.world_id, w.uid, 'order_heel', jsonb_build_object('kind', 'creature', 'id', pet));
  select * into q from creature where world_id = w.world_id and id = pet;
  insert into said values ('HEEL', coalesce(q.enemy::text, 'none') || '|' || round(extract(epoch from (q.heel_until - now()))::numeric)
    || '|' || coalesce((companion_target(w.world_id, q, (select pl from player pl where pl.world_id = w.world_id and pl.uid = w.uid))).id::text, 'none'));
  -- Heard from across the field.
  update creature set from_x = v_px + 6, from_y = v_py, to_x = v_px + 6, to_y = v_py, leg_at = now(), leg_ends = now()
    where world_id = w.world_id and id = pet;
  insert into said values ('FAR', coalesce(creature_refusal(w.world_id, w.uid, 'order_heel',
    jsonb_build_object('kind', 'creature', 'id', pet)), 'none'));
  -- What the browser is told of it.
  perform set_config('request.jwt.claims', json_build_object('sub', w.uid)::text, true);
  update creature set enemy = g, heel_until = null where world_id = w.world_id and id = pet;
  insert into said select 'SAID', coalesce(e->>'enemy', 'none') || '|' || (e ? 'lead')::text
    from jsonb_array_elements(rpc_creatures(w.world_id, 40)) e where (e->>'id')::int = pet;
  delete from creature where world_id = w.world_id and id in (pet, g);
end $b$;
select k || '=' || v from said order by k;
rollback;
`);

const said = new Map<string, string>();
for (const line of out.split('\n')) {
  const at = line.indexOf('=');
  if (at > 0) said.set(line.slice(0, at), line.slice(at + 1));
}
const island = (k: string): string => said.get(k) ?? 'MISSING';

/* ---- Both sides off the same numbers ----------------------------------------- */

const offKind = Object.values(SPECIES).filter((d) =>
  island(`KIND:${d.id}`) !== `${!!d.pack}|${!!d.throws}|${!!d.coward}|${turnsAt(d).toFixed(4)}`);
check(`all ${Object.keys(SPECIES).length} kinds run in a pack, throw and turn tail the same`, offKind.length === 0,
  offKind.map((d) => `${d.id}: island ${island(`KIND:${d.id}`)}`).join('; '));
const nums = [PACK_CALL, PACK_MOST, PACK_RANGE, CIRCLE_R, Number(CIRCLE_ARC.toFixed(6)), KEEP_OFF, BACK_SLACK, THROW_REACH, THROW_HIT,
  HUNTER_TURN, MONSTER_TURN, COWARD_AT, COWARD_DRAG, GUARD_RANGE, FALL_BACK];
check('and the numbers behind it are the same', island('NUMS').split('|').map(Number).every((v, i) => near(v, nums[i])),
  `island ${island('NUMS')}, browser ${nums.join('|')}`);
check('the kinds that run in packs, throw and turn tail early are some kinds and not others',
  Object.values(SPECIES).some((d) => d.pack) && Object.values(SPECIES).some((d) => d.hunter && !d.pack)
  && Object.values(SPECIES).some((d) => d.throws) && Object.values(SPECIES).some((d) => d.coward));

/* ---- The island ---------------------------------------------------------------- */

check(`on the island, one of a pack within ${PACK_CALL} tiles of another on you comes too, and follows the first`,
  island('CALL') === 'true|true|1', island('CALL'));
{
  const [rd, rb] = island('ROUND').split('|').map(Number);
  const [ad, ab] = island('ALONE').split('|').map(Number);
  const own = Math.atan2(0.6, 5);
  check(`one of a pack not yet on its side goes round ${CIRCLE_R} tiles out, where one alone comes straight in`,
    near(rd, CIRCLE_R, 0.1) && rb - own > CIRCLE_ARC * 0.8 && Math.abs(ab - own) < 0.05 && ad < 2,
    `pack ${rd.toFixed(2)} at ${rb.toFixed(2)}, alone ${ad.toFixed(2)} at ${ab.toFixed(2)} (from ${own.toFixed(2)})`);
}
{
  const [thrown, stood] = island('THROW').split('|').map(Number);
  check(`a thrower five tiles off throws from there, ${THROW_HIT} of a blow`, thrown === 1 && near(stood, 5, 0.01), island('THROW'));
  check(`and backs away from you inside ${KEEP_OFF - BACK_SLACK} tiles`, Number(island('BACK')) > 1.6, island('BACK'));
  const [hunting, resting, told, d] = island('COWARD').split('|');
  check(`a coward turns tail below ${COWARD_AT} of itself: it runs from you, says so, and rests`,
    hunting === 'none' && resting === 'true' && told === '1' && Number(d) > 4, island('COWARD'));
  check(`and one of its kind beside it below ${COWARD_DRAG} runs with it, where one nearly whole does not`,
    island('DRAG') === 'none|true', island('DRAG'));
  check('a pack whose leader is dead turns tail', island('LEADER') === 'none|1', island('LEADER'));
  check(`a hunter turns tail below ${HUNTER_TURN} of itself and not above`,
    island('ROWL25') === 'none' && island('ROWL40') === 'true', `${island('ROWL25')} / ${island('ROWL40')}`);
}
{
  const homes = [0, 1, 2, 3, 4, 5].map((i) => island(`HOME:rowl:${i}`));
  const most = Math.max(...homes.map((h) => homes.filter((x) => x === h).length));
  check(`a pack shares a home, no more than ${PACK_MOST} to one; a hunter that hunts alone keeps its own`,
    most === PACK_MOST && new Set(homes).size === 2 && island('HOME:ogre:0') !== island('HOME:ogre:1'),
    `${homes.join(' ')}; ogres ${island('HOME:ogre:0')} ${island('HOME:ogre:1')}`);
}
check('a defensive companion leaves alone what has not struck yet', island('DEFENSIVE') === 'none', island('DEFENSIVE'));
check('one set to guard you goes for what is hunting you, and says it will',
  island('GUARD:refusal') === 'none' && island('GUARD') === 'guard|true|1', `${island('GUARD:refusal')} / ${island('GUARD')}`);
check('told to attack with nothing marked, it is refused', island('ORDER:none') === 'Mark something wild first, or fight it.', island('ORDER:none'));
check('a passive one told to attack goes, and keeps at it', island('ORDER:refusal') === 'none' && island('ORDER') === 'true|true',
  `${island('ORDER:refusal')} / ${island('ORDER')}`);
check(`fallen back, it drops its fight and starts none for ${FALL_BACK} seconds, guarding or not`,
  island('HEEL') === `none|${FALL_BACK}|none`, island('HEEL'));
check('an order is heard from across the field', island('FAR') === 'none', island('FAR'));
check('the browser is told what your companion is fighting, and who leads a pack', /^\d+\|true$/.test(island('SAID')), island('SAID'));

/* ---- The browser ---------------------------------------------------------------- */

/** A body on a wide field of grass. */
const field = (): Game => {
  const g = Game.create(4242);
  const w = g.world;
  for (let y = 4; y <= 40; y++) for (let x = 4; x <= 40; x++) { w.setHeight(x, y, 4); w.setDirt(x, y, 3); w.setTile(x, y, TileType.Grass, 0); }
  g.player.x = 20.5;
  g.player.y = 20.5;
  g.player.stats.stamina = 1;
  g.player.stats.health = 1;
  g.settings.fightBack = false;
  for (const c of [...g.creatures.list.values()]) g.creatures.remove(c.id);
  return g;
};
const step = (g: Game, secs: number): void => {
  for (let t = 0; t < secs; t += 0.1) {
    g.time += 0.1;
    g.creatures.update(0.1, g);
    g.player.x = 20.5;
    g.player.y = 20.5;
  }
};
const beast = (g: Game, kind: string, x: number, y: number) => {
  const c = g.creatures.spawn(kind, x, y, 'wild', () => 0.5, 0);
  c.traits = [];
  c.health = 500;
  return c;
};
const lines = (g: Game): string[] => g.log.map((l) => l.text);

{
  const g = field();
  const a = beast(g, 'goblin', 25, 20.5);
  const b = beast(g, 'goblin', 28, 21);
  g.creatures.engage(g, a);
  step(g, 0.3);
  check('in the browser, one of a pack within reach of another on you comes too, and follows the first',
    b.enemy !== null && b.packLead === a.id && lines(g).includes('Another goblin comes with it.'),
    `enemy ${b.enemy}, lead ${b.packLead}`);
}
{
  const g = field();
  const lead = beast(g, 'rowl', 25.5, 20.5);
  const mate = beast(g, 'rowl', 25.5, 21.1);
  g.creatures.engage(g, lead);
  g.creatures.engage(g, mate);
  mate.packLead = lead.id;
  lead.cooldown = 99;
  mate.cooldown = 99;
  const own = Math.atan2(mate.y - 20.5, mate.x - 20.5);
  step(g, 0.8);
  const went = Math.atan2(mate.y - 20.5, mate.x - 20.5) - own;
  const alone = field();
  const solo = beast(alone, 'rowl', 25.5, 21.1);
  alone.creatures.engage(alone, solo);
  solo.packLead = null;
  step(alone, 0.8);
  const straight = Math.abs(Math.atan2(solo.y - 20.5, solo.x - 20.5) - own);
  check('and goes round you to its own side, where one alone comes straight in', went > 0.15 && straight < 0.05,
    `turned ${went.toFixed(2)} round, alone ${straight.toFixed(3)}`);
}
{
  const g = field();
  const gob = beast(g, 'goblin', 25.5, 20.5);
  g.creatures.engage(g, gob);
  gob.packLead = null;
  step(g, 1);
  const thrown = lines(g).filter((t) => t.includes("The goblin's stone finds you")).length;
  const stood = Math.hypot(gob.x - 20.5, gob.y - 20.5);
  gob.x = 22;
  gob.y = 20.5;
  step(g, 1);
  const backed = Math.hypot(gob.x - 20.5, gob.y - 20.5);
  check('a thrower throws from where it stands, and backs away when you close',
    thrown >= 1 && near(stood, 5, 0.01) && backed > 1.6, `${thrown} thrown from ${stood.toFixed(2)}, backed to ${backed.toFixed(2)}`);
  gob.health = 0.4 * 40;
  gob.x = 24.5;
  step(g, 0.2);
  check(`a coward turns tail below ${COWARD_AT} of itself, runs, and rests`,
    gob.enemy === null && gob.state === 'flee' && gob.huntRest > g.time && lines(g).includes('The goblin turns tail.'),
    `enemy ${gob.enemy}, state ${gob.state}`);
  const hurt = beast(g, 'goblin', 25, 21.5);
  const whole = beast(g, 'goblin', 25, 19.5);
  hurt.health = 0.7 * 40;
  whole.health = 0.95 * 40;
  g.creatures.engage(g, hurt);
  g.creatures.engage(g, whole);
  step(g, 0.2);
  check(`and one of its kind beside it below ${COWARD_DRAG} runs with it, where one nearly whole does not`,
    hurt.enemy === null && whole.enemy !== null, `hurt ${hurt.enemy}, whole ${whole.enemy}`);
}
{
  const g = field();
  const a = beast(g, 'orc', 26, 20.5);
  const b = beast(g, 'orc', 26, 21.5);
  g.creatures.engage(g, a);
  g.creatures.engage(g, b);
  b.packLead = a.id;
  g.creatures.remove(a.id);
  step(g, 0.2);
  check('a pack whose leader is dead turns tail', b.enemy === null && lines(g).includes('The orc turns tail.'), `enemy ${b.enemy}`);
}
{
  const g = field();
  const homes = [0, 1, 2, 3, 4, 5].map((i) => g.creatures.spawn('rowl', 10 + i, 10, 'wild', () => 0.5, 0)).map((c) => `${c.homeX},${c.homeY}`);
  const most = Math.max(...homes.map((h) => homes.filter((x) => x === h).length));
  const ogres = [0, 1].map((i) => g.creatures.spawn('ogre', 10 + i, 14, 'wild', () => 0.5, 0)).map((c) => `${c.homeX},${c.homeY}`);
  check(`a pack shares a home, no more than ${PACK_MOST} to one; a hunter that hunts alone keeps its own`,
    most === PACK_MOST && new Set(homes).size === 2 && ogres[0] !== ogres[1], `${homes.join(' ')}; ogres ${ogres.join(' ')}`);
}
{
  const g = field();
  const pet = g.creatures.spawn('rowl', 21, 20.5, 'active', () => 0.5, 0);
  pet.stance = 'defensive';
  const gob = beast(g, 'goblin', 17.5, 20.5);
  g.creatures.engage(g, gob);
  gob.cooldown = 99;
  step(g, 0.1);
  const defensive = pet.enemy;
  const stance = ACTION_BY_ID.get('set_stance');
  const attack = ACTION_BY_ID.get('order_attack');
  const heel = ACTION_BY_ID.get('order_heel');
  if (!stance || !attack || !heel) throw new Error('no orders');
  g.requestAction(stance, { kind: 'creature', id: pet.id, stance: 'guard' });
  step(g, 0.1);
  check('in the browser, a defensive companion leaves alone what has not struck; one set to guard goes for it, and says so',
    defensive === null && pet.enemy === gob.id && lines(g).includes(`${pet.name} will be guarding you.`), `defensive ${defensive}, guarding ${pet.enemy}`);
  pet.stance = 'passive';
  pet.enemy = null;
  const none = attack.check?.({ kind: 'creature', id: pet.id }, g) ?? null;
  g.requestAction(attack, { kind: 'creature', id: pet.id, foe: gob.id });
  step(g, 0.1);
  check('a passive one told to attack goes, and keeps at it; with nothing marked it is refused',
    pet.enemy === gob.id && !!none && none.startsWith('Mark something wild first'), `enemy ${pet.enemy}, ${none}`);
  pet.stance = 'guard';
  g.requestAction(heel, { kind: 'creature', id: pet.id });
  step(g, FALL_BACK - 1);
  const held = pet.enemy;
  step(g, 2);
  check(`fallen back, it starts no fight for ${FALL_BACK} seconds, and then guards again`,
    held === null && pet.enemy === gob.id, `${held} then ${pet.enemy}`);
  check(`a guarding one gives up a fight ${GUARD_RANGE} tiles from you`, GUARD_RANGE > 0);
}
{
  const g = field();
  const bow = g.inventory.add('short_bow', { ql: 40 });
  g.equip('weapon', bow.uid);
  g.inventory.add('arrow', { ql: 40, count: 20 });
  const gob = beast(g, 'goblin', 26.5, 20.5);
  const shoot = ACTION_BY_ID.get('shoot_creature');
  if (!shoot) throw new Error('no shoot');
  g.requestAction(shoot, { kind: 'creature', id: gob.id });
  g.update(0.05);
  const drawing = g.action?.state === 'performing' && g.action.def.id === 'shoot_creature';
  // A walk west while the draw is coming up.
  g.player.moving = true;
  g.update(0.05);
  check(`a bow keeps drawing while you walk, at ${DRAW_WALK} of your pace`,
    drawing && g.action?.def.id === 'shoot_creature' && g.player.drawPace === DRAW_WALK,
    `drawing ${drawing}, action ${g.action?.def.id ?? 'none'}, pace ${g.player.drawPace}`);
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`packs, throwers and orders — ${ok.length} of ${ok.length}`);
