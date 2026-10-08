/**
 * Driving and sailing (`travel.ts`), on both sides.
 *
 * Each makes what it steers go faster -- a cart or a wagon under Driving, a
 * boat under Sailing -- and each is learned by going: a go for every tile the
 * cart or the hull goes into. The island pays both off the walk it is told
 * about (`rpc_move`), as it pays climbing, and lets the faster pace stand
 * because `travel_speed` has the same skill in it the browser's pace has.
 *
 * Runs against the database the suite leaves behind: Faraway, and Ivar on it.
 * Everything the island half does is rolled back.
 *
 *   npx esbuild supabase/test/travel.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/travel.mjs && node node_modules/.cache/travel.mjs
 */
import { execFileSync } from 'node:child_process';
import { isQuiet, SKILL_BY_ID } from '../../src/game/skills';
import { DRIVING, DRIVING_LEARN, DRIVING_TOP, drivingPace, SAILING, SAILING_LEARN, SAILING_TOP, sailingPace, VEHICLE_QL_TOP, vehicleQlPace } from '../../src/game/travel';

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
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

/* ---- the numbers, on both sides ------------------------------------------- */

const said = psql(`select driving_skill() || '|' || sailing_skill() || '|' || driving_top() || '|' || sailing_top()
  || '|' || driving_learn() || '|' || sailing_learn()`);
check('both sides name the two skills and price them the same',
  said === [DRIVING, SAILING, DRIVING_TOP, SAILING_TOP, DRIVING_LEARN, SAILING_LEARN].join('|'),
  `island ${said}, browser ${[DRIVING, SAILING, DRIVING_TOP, SAILING_TOP, DRIVING_LEARN, SAILING_LEARN].join('|')}`);
const defs = psql(`select string_agg(id || ':' || start || ':' || quiet, ',' order by id) from skill_def where id in (driving_skill(), sailing_skill())`);
check('both are skills of their own, begin at one, and speak only on a whole point, on both sides',
  defs === `${DRIVING}:1:true,${SAILING}:1:true`
    && [DRIVING, SAILING].every((id) => SKILL_BY_ID.get(id)?.start === 1 && isQuiet(id)),
  defs);

const LEVELS = [1, 25, 50, 100, 120];
const paces = psql(`select string_agg(driving_pace(v) || '/' || sailing_pace(v), ' ' order by v)
  from unnest(array[${LEVELS.join(', ')}]::double precision[]) v`).split(' ').map((s) => s.split('/').map(Number));
check(`each skill makes the same of the pace on both sides, ${DRIVING_TOP * 100}% more at 100 and no more past it`,
  paces.length === LEVELS.length
    && LEVELS.every((v, i) => near(paces[i][0], drivingPace(v)) && near(paces[i][1], sailingPace(v)))
    && near(drivingPace(100), 1 + DRIVING_TOP) && near(sailingPace(100), 1 + SAILING_TOP)
    && drivingPace(120) === drivingPace(100),
  `island ${paces.map((p) => p.map((n) => n.toFixed(4)).join('/')).join(' ')}`);

/* ---- on the island -------------------------------------------------------- */

const IVAR = `(select uid from player where world_id = (select id from world where name = 'Faraway') and name = 'Ivar')`;
const out = psql(`
begin;
create temp table said (k text, v text);
select set_config('request.jwt.claims', json_build_object('sub', ${IVAR})::text, true) \\g /dev/null
do $t$
declare w uuid; u uuid; gx int; gy int; v_boat bigint; v_cart bigint; v_beast int;
begin
  select id into w from world where name = 'Faraway';
  select uid into u from player where world_id = w and name = 'Ivar';
  -- Flat grass to go over, and nothing of Ivar's under him or in his hands.
  for gx in 18..30 loop for gy in 19..23 loop
    perform land_set_height(w, gx, gy, 4); perform land_set_tile(w, gx, gy, tile_id('Grass'));
  end loop; end loop;
  update creature set rider = null where world_id = w and rider = u;
  delete from placed where world_id = w and driver = u;
  delete from skill where world_id = w and uid = u and id in (driving_skill(), sailing_skill());
  update player set x = 20.5, y = 21.5, level = 0, aboard = null, away = false,
         moved_at = now() - interval '10 seconds' where world_id = w and uid = u;

  -- At the helm of a rowing boat: what Sailing makes of how far a walk may go.
  insert into placed (world_id, kind, sub, x, y, cx, cy, ql, driver)
    values (w, 'furniture', 'rowing_boat', 20, 21, 20.5, 21.5, 50, u) returning id into v_boat;
  insert into said values ('BOAT', travel_speed(w, u)::text);
  insert into skill (world_id, uid, id, value) values (w, u, sailing_skill(), 100);
  insert into said values ('BOAT100', travel_speed(w, u)::text);
  delete from skill where world_id = w and uid = u and id = sailing_skill();
  -- And three tiles east under way, from Sailing 1.
  perform rpc_move(w, 23.5, 21.5, 0);
  insert into said select 'SAILED', skill_of(w, u, sailing_skill()) || '|' || skill_of(w, u, driving_skill())
    || '|' || x from player where world_id = w and uid = u;
  delete from placed where id = v_boat;

  -- At the reins of a large cart with a beast in the traces.
  insert into placed (world_id, kind, sub, x, y, cx, cy, ql, driver)
    values (w, 'furniture', 'large_cart', 23, 21, 23.5, 21.5, 50, u) returning id into v_cart;
  v_beast := creature_spawn(w, 'roxxen', 24.5, 21.5, 'active', now() - interval '2 years', u);
  update creature set hitched_to = v_cart, hunger = 1, traits = '{}' where world_id = w and id = v_beast;
  insert into said values ('CART', travel_speed(w, u) || '|' || vehicle_speed(w, v_cart));
  -- And the same cart badly made and made as well as it can be.
  update placed set ql = 0 where id = v_cart;
  insert into said values ('QL', vehicle_speed(w, v_cart)::text);
  update placed set ql = 100 where id = v_cart;
  update said set v = vehicle_speed(w, v_cart) || '|' || split_part(v, '|', 1) || '|' || vehicle_ql_top() where k = 'QL';
  update placed set ql = 50 where id = v_cart;
  insert into skill (world_id, uid, id, value) values (w, u, driving_skill(), 100);
  insert into said values ('CART100', travel_speed(w, u)::text);
  delete from skill where world_id = w and uid = u and id = driving_skill();
  update player set moved_at = now() - interval '10 seconds' where world_id = w and uid = u;
  perform rpc_move(w, 26.5, 21.5, 0);
  insert into said select 'DROVE', skill_of(w, u, sailing_skill()) || '|' || skill_of(w, u, driving_skill())
    || '|' || x from player where world_id = w and uid = u;

  -- And with the beast out of the traces the cart goes nowhere, and teaches nothing.
  update creature set hitched_to = null where world_id = w and id = v_beast;
  update player set moved_at = now() - interval '10 seconds' where world_id = w and uid = u;
  perform rpc_move(w, 23.5, 21.5, 0);
  insert into said select 'IDLE', skill_of(w, u, driving_skill())::text;
  insert into said select 'BOUNDS', string_agg(b, '|' order by r) from (
    select r, (1 + skill_gain_of(1, sailing_learn() * skill_mult(w, u, sailing_skill()), r))::text as b
      from unnest(array[0.6, 1.4]) r) x;
end $t$;
select k || '=' || v from said order by k;
rollback;`);
const isle = new Map(out.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)] as [string, string]));
const num = (k: string, i = 0): number => Number((isle.get(k) ?? '').split('|')[i]);

check('at the helm, Sailing 100 lets a walk go as much further as it makes the boat go faster',
  num('BOAT') > 0 && near(num('BOAT100') / num('BOAT'), sailingPace(100) / sailingPace(1), 1e-9),
  `${num('BOAT').toFixed(3)} at Sailing 1, ${num('BOAT100').toFixed(3)} at 100: ${(num('BOAT100') / num('BOAT')).toFixed(4)} against ${(sailingPace(100) / sailingPace(1)).toFixed(4)}`);
check(`a cart made at quality 100 goes ${(VEHICLE_QL_TOP * 100).toFixed(0)}% faster than one made at 0, as the browser has it`,
  num('QL', 1) > 0 && near(num('QL', 0) / num('QL', 1), vehicleQlPace(100) / vehicleQlPace(0), 1e-9) && num('QL', 2) === VEHICLE_QL_TOP,
  isle.get('QL') ?? 'unsaid');
check('at the reins, Driving 100 does the same for a cart a beast is pulling',
  num('CART', 1) > 0 && near(num('CART100') / num('CART'), drivingPace(100) / drivingPace(1), 1e-9),
  `team ${num('CART', 1).toFixed(3)}, ${num('CART').toFixed(3)} at Driving 1, ${num('CART100').toFixed(3)} at 100`);

{
  // Three tiles of the same go each, paid one after another: at a roll of 0.6 each at the least, 1.4 at the most.
  const [lo1, hi1] = [num('BOUNDS', 0), num('BOUNDS', 1)];
  const sailed = num('SAILED');
  check('three tiles rowed teach Sailing, about three goes of it, and Driving nothing',
    num('SAILED', 2) === 23.5 && sailed > lo1 && sailed < 1 + 3 * (hi1 - 1) + 1e-6 && num('SAILED', 1) === 1,
    `Sailing ${sailed.toFixed(4)}, Driving ${num('SAILED', 1)}, at x ${num('SAILED', 2)}`);
}
check('three tiles driven teach Driving, and Sailing nothing more',
  num('DROVE', 2) === 26.5 && num('DROVE', 1) > 1 && num('DROVE') === num('SAILED'),
  `Driving ${num('DROVE', 1).toFixed(4)}, Sailing ${num('DROVE').toFixed(4)}, at x ${num('DROVE', 2)}`);
check('a cart nothing is pulling teaches nothing',
  Number(isle.get('IDLE')) === num('DROVE', 1), `Driving ${isle.get('IDLE')} after, ${num('DROVE', 1)} before`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`driving and sailing — ${ok.length} of ${ok.length}`);
