/**
 * A fight on its own clock.
 *
 * Both sides off the same names (`src/game/fight.ts` and
 * `a_fight_on_its_own_clock.sql`). What this asks:
 *
 *   * a swing takes the weapon's own swing, the same on both sides, and the
 *     same longer on tired arms;
 *   * a swing or a draw costs the same wind for every weapon there is;
 *   * the three stances deal and take the same;
 *   * every kind of creature lands its blows on the same clock;
 *   * whatever is struck that does not bolt comes after you, and a timid one
 *     does not;
 *   * a bite turns you round only with the setting on and your feet still;
 *   * walking off leaves a fight rather than keeping it for later;
 *   * and a fight asked for in the middle of work goes in hand at once, with
 *     the work first in line behind it.
 *
 * Runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID, type ActionDef } from '../../src/game/actions';
import { PLAYER_ATTACKER, SPECIES } from '../../src/game/creatures';
import { blowEvery, FIGHT_STANCES, fightBase, fightWind, STANCE_DEALT, STANCE_TAKEN } from '../../src/game/fight';
import { Game } from '../../src/game/game';
import { WEAPONS } from '../../src/game/gear';
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
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
const job = (id: string): ActionDef => {
  const def = ACTION_BY_ID.get(id);
  if (!def) throw new Error(`no ${id}`);
  return def;
};
const ATTACK = job('attack_creature');
const SHOOT = job('shoot_creature');
const TIRED = 0.1;

/* ---- The island's half, in one go ------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w record; v_id bigint; r record; v_job text; v_fresh double precision; v_wind double precision;
        v_tired double precision; v_crawler int; v_rabba int; v_act text; v_queue jsonb;
        v_px double precision; v_py double precision;
begin
  -- The biggest island there is, and a body well off its beach: nothing comes for you on the beach (\`at_peace\`).
  select p.world_id, p.uid, wd.size, wd.spawn_x, wd.spawn_y into w
    from player p join world wd on wd.id = p.world_id
   -- With land under it: \`window.ts\` leaves an island as big as any with none, and a body on it.
   where exists (select 1 from land_tile t where t.world_id = wd.id)
   order by wd.size desc, p.world_id, p.uid limit 1;
  v_px := case when w.spawn_x + peace_reach() + 6 < w.size then w.spawn_x + peace_reach() + 6.5
               else w.spawn_x - peace_reach() - 5.5 end;
  v_py := w.spawn_y + 0.5;
  update player set act = null, act_target = null, act_ends = null, act_left = null, act_goes = null,
         act_queue = '[]'::jsonb, equipped = '{}'::jsonb, fight_stance = 'balanced', fight_back = true,
         moved_at = now() - interval '1 minute', x = v_px, y = v_py, level = 0, wounds = '[]'::jsonb,
         stats = coalesce(stats, '{}'::jsonb)
           || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
    where world_id = w.world_id and uid = w.uid;
  perform set_config('request.jwt.claims', json_build_object('sub', w.uid)::text, false);

  -- Bare hands, then every weapon there is, fresh and on tired arms.
  insert into said values ('W:fist', act_base(w.world_id, w.uid, 'attack_creature', 2.5) || '|'
    || act_wind(w.world_id, w.uid, 'attack_creature', 0.07));
  for r in select id, ammo is not null as bow from weapon_def order by id loop
    v_id := give(w.world_id, w.uid, r.id, 1, 40);
    v_job := case when r.bow then 'shoot_creature' else 'attack_creature' end;
    update player set equipped = jsonb_build_object('weapon', v_id),
           stats = jsonb_set(stats, '{stamina}', '1')
      where world_id = w.world_id and uid = w.uid;
    v_fresh := act_base(w.world_id, w.uid, v_job, 2.6);
    v_wind := act_wind(w.world_id, w.uid, v_job, 0.05);
    update player set stats = jsonb_set(stats, '{stamina}', to_jsonb(${TIRED}::double precision))
      where world_id = w.world_id and uid = w.uid;
    v_tired := act_base(w.world_id, w.uid, v_job, 2.6);
    insert into said values ('W:' || r.id, v_fresh || '|' || v_wind || '|' || v_tired);
  end loop;
  update player set equipped = '{}'::jsonb, stats = jsonb_set(stats, '{stamina}', '1')
    where world_id = w.world_id and uid = w.uid;

  -- The stances, and every kind's clock.
  insert into said select 'S:' || s, stance_dealt(s) || '|' || stance_taken(s)
    from unnest(array['aggressive', 'balanced', 'defensive']) s;
  insert into said select 'B:' || sd.id, blow_every(sd)::text from species_def sd;

  -- Struck, a crawler comes for you and a rabba does not.
  v_crawler := creature_spawn(w.world_id, 'crawler', v_px + 0.7, v_py, 'wild', now() - interval '2 hours');
  v_rabba := creature_spawn(w.world_id, 'rabba', v_px - 0.7, v_py, 'wild', now() - interval '2 hours');
  update creature set health = 5000 where world_id = w.world_id and id in (v_crawler, v_rabba);
  perform perform_fight(w.world_id, w.uid, 'attack_creature', jsonb_build_object('kind', 'creature', 'id', v_crawler));
  perform perform_fight(w.world_id, w.uid, 'attack_creature', jsonb_build_object('kind', 'creature', 'id', v_rabba));
  insert into said select 'ENGAGED:' || species, coalesce((hunting = w.uid)::text, 'false')
    from creature where world_id = w.world_id and id in (v_crawler, v_rabba);

  -- Ten seconds of standing beside it: blows on its own clock, and you turn on it.
  delete from event where uid = w.uid;
  update creature set from_x = v_px + 0.7, from_y = v_py, to_x = v_px + 0.7, to_y = v_py, leg_at = now(), leg_ends = now(),
      until = now() - interval '10 seconds', settled_at = now() - interval '10 seconds'
    where world_id = w.world_id and id = v_crawler;
  perform creature_settle(w.world_id, v_crawler);
  insert into said values ('BLOWS', (select count(*) from event where uid = w.uid and text like '%is on you%')::text
    || '|' || (select coalesce(act, 'nothing') from player where world_id = w.world_id and uid = w.uid));

  -- A bite with the setting off, then with feet just moved, then with both right.
  update player set act = null, act_target = null, act_queue = '[]'::jsonb, fight_back = false
    where world_id = w.world_id and uid = w.uid;
  perform mark_attacker(w.world_id, w.uid, v_crawler);
  perform hurt_player(w.world_id, w.uid, 0.001, 'The crawler is on you', 'bite');
  select coalesce(act, 'nothing') into v_act from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('TURN:off', v_act);
  update player set fight_back = true, moved_at = now() where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.001, 'The crawler is on you', 'bite');
  select coalesce(act, 'nothing') into v_act from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('TURN:walking', v_act);
  update player set moved_at = now() - interval '1 minute' where world_id = w.world_id and uid = w.uid;
  perform hurt_player(w.world_id, w.uid, 0.001, 'The crawler is on you', 'bite');
  select coalesce(act, 'nothing') into v_act from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('TURN:still', v_act);

  -- A walk off leaves the fight, and keeps a dig.
  delete from caller where uid = w.uid;
  perform rpc_hold(w.world_id);
  select coalesce(act, 'nothing'), act_queue into v_act, v_queue from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('HOLD:fight', v_act || '|' || jsonb_array_length(v_queue));
  update player set act = 'dig', act_target = jsonb_build_object('kind', 'tile', 'x', floor(v_px)::int, 'y', floor(v_py)::int, 'cx', floor(v_px)::int, 'cy', floor(v_py)::int),
         act_started = now(), act_ends = now() + interval '5 seconds', act_left = 3, act_goes = 3,
         act_queue = '[]'::jsonb
    where world_id = w.world_id and uid = w.uid;
  delete from caller where uid = w.uid;
  perform rpc_hold(w.world_id);
  select coalesce(act, 'nothing'), act_queue into v_act, v_queue from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('HOLD:dig', v_act || '|' || coalesce(v_queue->0->>'action', 'none') || '|' || coalesce(v_queue->0->>'goes', '0'));

  -- A fight asked for in the middle of a dig goes in hand now, the dig first in line behind it.
  update player set act = 'dig', act_target = jsonb_build_object('kind', 'tile', 'x', floor(v_px)::int, 'y', floor(v_py)::int, 'cx', floor(v_px)::int, 'cy', floor(v_py)::int),
         act_started = now(), act_ends = now() + interval '5 seconds', act_left = 3, act_goes = 3,
         act_queue = '[]'::jsonb
    where world_id = w.world_id and uid = w.uid;
  delete from caller where uid = w.uid;
  perform rpc_act(w.world_id, 'attack_creature', jsonb_build_object('kind', 'creature', 'id', v_crawler), 100);
  select coalesce(act, 'nothing'), act_queue into v_act, v_queue from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('FIRST', v_act || '|' || coalesce(v_queue->0->>'action', 'none') || '|' || coalesce(v_queue->0->>'goes', '0')
    || '|' || jsonb_array_length(v_queue));
  -- And a second fight asked for gives the first up rather than lining it up.
  delete from caller where uid = w.uid;
  perform rpc_act(w.world_id, 'attack_creature', jsonb_build_object('kind', 'creature', 'id', v_crawler), 100);
  select coalesce(act, 'nothing'), act_queue into v_act, v_queue from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('AGAIN', v_act || '|' || jsonb_array_length(v_queue));
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

/* ---- The browser's half -------------------------------------------------- */

/** A body on level grass with this in its hand, and this much wind. */
const body = (weapon: string | null, stamina = 1): Game => {
  const g = Game.create(4242);
  const w = g.world;
  for (let y = 16; y <= 26; y++) for (let x = 16; x <= 26; x++) { w.setHeight(x, y, 4); w.setDirt(x, y, 3); }
  for (let y = 16; y <= 25; y++) for (let x = 16; x <= 25; x++) w.setTile(x, y, TileType.Grass, 0);
  g.player.x = 20.5;
  g.player.y = 20.5;
  g.player.stats.stamina = stamina;
  g.player.stats.health = 1;
  if (weapon) g.equip('weapon', g.inventory.add(weapon, { ql: 40 }).uid);
  return g;
};

{
  const [base, wind] = island('W:fist').split('|').map(Number);
  const g = body(null);
  check('bare hands swing at the same pace and cost the same wind',
    near(base, fightBase(g, ATTACK) ?? -1) && near(wind, fightWind(g, ATTACK) ?? -1),
    `island ${base} / ${wind}, browser ${fightBase(g, ATTACK)} / ${fightWind(g, ATTACK)}`);
}
const armoury = body(null);
for (const w of WEAPONS) {
  const [fresh, wind, tired] = island(`W:${w.id}`).split('|').map(Number);
  const def = w.ammo ? SHOOT : ATTACK;
  const g = armoury;
  g.equip('weapon', g.inventory.add(w.id, { ql: 40 }).uid);
  g.player.stats.stamina = 1;
  const b = [fightBase(g, def) ?? -1, fightWind(g, def) ?? -1];
  g.player.stats.stamina = TIRED;
  b.push(fightBase(g, def) ?? -1);
  check(`${w.id}: its own swing, its own wind, and slower tired`,
    near(fresh, b[0]) && near(wind, b[1]) && near(tired, b[2]) && near(fresh, w.swing) && tired > fresh,
    `island ${fresh} / ${wind} / ${tired}, browser ${b.join(' / ')}`);
}

for (const s of FIGHT_STANCES) {
  const [dealt, taken] = island(`S:${s}`).split('|').map(Number);
  check(`${s}: the same dealt and taken`, near(dealt, STANCE_DEALT[s]) && near(taken, STANCE_TAKEN[s]),
    `island ${dealt} / ${taken}, browser ${STANCE_DEALT[s]} / ${STANCE_TAKEN[s]}`);
}

const kinds = Object.values(SPECIES);
const offClock = kinds.filter((d) => !near(Number(island(`B:${d.id}`)), blowEvery(d)));
check(`all ${kinds.length} kinds land their blows on the same clock`, offClock.length === 0,
  offClock.map((d) => `${d.id}: island ${island(`B:${d.id}`)}, browser ${blowEvery(d)}`).join('; '));

check('on the island, a struck crawler comes after you and a struck rabba does not',
  island('ENGAGED:crawler') === 'true' && island('ENGAGED:rabba') === 'false',
  `crawler ${island('ENGAGED:crawler')}, rabba ${island('ENGAGED:rabba')}`);
{
  const g = body('sword');
  const crawler = g.creatures.spawn('crawler', 21.2, 20.5, 'wild', () => 0.5, 0);
  const rabba = g.creatures.spawn('rabba', 19.8, 20.5, 'wild', () => 0.5, 0);
  crawler.health = 5000;
  rabba.health = 5000;
  ATTACK.perform({ kind: 'creature', id: crawler.id }, g);
  ATTACK.perform({ kind: 'creature', id: rabba.id }, g);
  check('in the browser, the same', crawler.enemy === PLAYER_ATTACKER && rabba.enemy !== PLAYER_ATTACKER,
    `crawler ${crawler.enemy}, rabba ${rabba.enemy}`);
}

{
  const [blows, inHand] = island('BLOWS').split('|');
  check('ten seconds beside it: it lands its own blows, and you turn on it', Number(blows) >= 2 && inHand === 'attack_creature',
    `${blows} blows, ${inHand} in hand`);
}

check('on the island, a bite turns you only with the setting on and your feet still',
  island('TURN:off') === 'nothing' && island('TURN:walking') === 'nothing' && island('TURN:still') === 'attack_creature',
  `off: ${island('TURN:off')}, walking: ${island('TURN:walking')}, still: ${island('TURN:still')}`);
{
  const turned = (setup: (g: Game) => void): string => {
    const g = body('sword');
    const c = g.creatures.spawn('crawler', 21.2, 20.5, 'wild', () => 0.5, 0);
    setup(g);
    g.player.attackedBy = c.id;
    g.player.attackedAt = g.time;
    g.hurtPlayer(0.001, 'The crawler is on you');
    return g.action?.def.id ?? 'nothing';
  };
  const off = turned((g) => (g.settings.fightBack = false));
  const walking = turned((g) => ((g as unknown as { movedAt: number }).movedAt = g.time));
  const still = turned(() => undefined);
  check('in the browser, the same', off === 'nothing' && walking === 'nothing' && still === 'attack_creature',
    `off: ${off}, walking: ${walking}, still: ${still}`);
}

check('on the island, a walk leaves a fight and keeps a dig',
  island('HOLD:fight') === 'nothing|0' && island('HOLD:dig') === 'nothing|dig|3',
  `fight: ${island('HOLD:fight')}, dig: ${island('HOLD:dig')}`);
{
  const g = body('sword');
  const c = g.creatures.spawn('crawler', 21.2, 20.5, 'wild', () => 0.5, 0);
  c.health = 5000;
  g.inventory.add('shovel', { ql: 40 });
  g.requestAction(ATTACK, { kind: 'creature', id: c.id });
  const fighting = g.action?.def.id ?? 'nothing';
  g.pauseAction();
  const fight = `${g.action?.def.id ?? 'nothing'}|${g.queue.length}`;
  g.requestAction(job('dig'), { kind: 'tile', x: 20, y: 20, cx: 20, cy: 20 }, 3);
  g.pauseAction();
  const dig = `${g.action?.def.id ?? 'nothing'}|${g.queue[0]?.def.id ?? 'none'}|${g.queue[0]?.goes ?? 0}`;
  check('in the browser, the same', fighting === 'attack_creature' && fight === 'nothing|0' && dig === 'nothing|dig|3',
    `fighting: ${fighting}, fight: ${fight}, dig: ${dig}`);
}

check('on the island, a fight asked for mid-dig goes in hand now with the dig first in line, and a second gives the first up',
  island('FIRST') === 'attack_creature|dig|3|1' && island('AGAIN') === 'attack_creature|1',
  `first: ${island('FIRST')}, again: ${island('AGAIN')}`);
{
  const g = body('sword');
  g.inventory.add('shovel', { ql: 40 });
  const c = g.creatures.spawn('crawler', 21.2, 20.5, 'wild', () => 0.5, 0);
  c.health = 5000;
  g.requestAction(job('dig'), { kind: 'tile', x: 20, y: 20, cx: 20, cy: 20 }, 3);
  const digging = g.action?.def.id ?? 'nothing';
  g.requestAction(ATTACK, { kind: 'creature', id: c.id });
  const first = `${g.action?.def.id ?? 'nothing'}|${g.queue[0]?.def.id ?? 'none'}|${g.queue[0]?.goes ?? 0}|${g.queue.length}`;
  g.requestAction(ATTACK, { kind: 'creature', id: c.id });
  const again = `${g.action?.def.id ?? 'nothing'}|${g.queue.length}`;
  check('in the browser, the same', digging === 'dig' && first === 'attack_creature|dig|3|1' && again === 'attack_creature|1',
    `digging: ${digging}, first: ${first}, again: ${again}`);
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a fight on its own clock — ${ok.length} of ${ok.length}`);
