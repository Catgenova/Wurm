/**
 * A caravel, and the people she carries.
 *
 * Asked for: "Raise ship costs dramatically too. Add a caravel that is larger
 * and costs at least 3x sailboat. Can have 3 passengers and carry 5000 items".
 *
 * Asked of both sides, in a harbour cut into the land for the purpose: deep
 * water with a strip of dry ground two tiles off it.
 *
 *   * every line of her bill is at least three times the sailing boat's, she
 *     holds five thousand things, takes more ground and more water, and has
 *     three places for passengers;
 *   * a passenger comes aboard from beside her into the first free place,
 *     goes where she goes whatever their own feet are asked, is not in the
 *     water, and steps ashore only with land in reach;
 *   * the fourth to ask is told every place is taken;
 *   * a helm somebody present holds is not taken out of their hands, and one
 *     whose holder has gone away is taken over from her deck, the one who went
 *     away being put in the place that was left;
 *   * she is not picked up with anybody aboard;
 *   * and the island says who is aboard her, and in which place.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import { Game } from '../../src/game/game';
import { furnitureDef, furnitureFootprint, passengerPlaces, ridersOf } from '../../src/game/furniture';
import { RECIPES } from '../../src/game/recipes';
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

/* ---- her bill, her hold and her places -------------------------------------- */
console.log('--- the bills');
const SHIP = furnitureDef('caravel');
const SAIL = furnitureDef('sailing_boat');
const shipBill = new Map(SHIP.bill);
const short = SAIL.bill.filter(([item, n]) => (shipBill.get(item) ?? 0) < 3 * n);
check('every line of her bill is at least three times the sailing boat\'s',
  !short.length, short.map(([i, n]) => `${i}: ${shipBill.get(i) ?? 0} of ${3 * n}`).join(', ') || SHIP.bill.map(([i, n]) => `${n} ${i}`).join(', '));
check('she holds five thousand things, and carries three passengers besides the helm',
  SHIP.capacity === 5000 && passengerPlaces({ kind: 'caravel' }) === 3
    && passengerPlaces({ kind: 'sailing_boat' }) === 0 && passengerPlaces({ kind: 'rowing_boat' }) === 0,
  `hold ${SHIP.capacity}, places ${passengerPlaces({ kind: 'caravel' })}`);
const [sw, sh] = furnitureFootprint('caravel');
const [bw, bh] = furnitureFootprint('sailing_boat');
check('she is larger than the sailing boat and wants deeper water',
  sw * sh > bw * bh && (SHIP.boat?.draught ?? 0) > (SAIL.boat?.draught ?? 0),
  `${sw}×${sh} to ${bw}×${bh}, draught ${SHIP.boat?.draught} to ${SAIL.boat?.draught}`);
const recipe = RECIPES.find((r) => r.id === 'make_caravel');
const islandBill = psql(`select string_agg(count || ' ' || item, ', ' order by ord) from recipe_input where recipe = 'make_caravel';`);
check('the island builds her off the same bill', !!recipe && islandBill === SHIP.bill.map(([i, n]) => `${n} ${i}`).join(', '), islandBill);
check('and knows her places, her hold and her water',
  psql(`select passengers || ',' || draught::int from boat_def where id = 'caravel';`) === `3,${SHIP.boat?.draught}`
    && psql(`select capacity from furniture_def where id = 'caravel';`) === '5000',
  psql(`select passengers || ',' || draught from boat_def where id = 'caravel';`));

/* ---- the browser ------------------------------------------------------------ */
console.log('--- the browser');
const game = Game.create(4242);
const W0 = 100, WY = 100;
// Corners west of the line are dry ground and east of it deep water.
for (let x = W0 - 6; x <= W0 + 9; x++) {
  for (let y = WY - 3; y <= WY + 4; y++) game.world.setHeight(x, y, x <= W0 ? 10 : -10);
}
for (let x = W0 - 6; x < W0; x++) for (let y = WY - 3; y <= WY + 3; y++) game.world.setTile(x, y, TileType.Grass);
const SX = W0 + 1;
const ship = game.addFurniture('caravel', SX, WY, 0, 0, 50);
const at = { kind: 'furniture', id: ship.id } as Target;
const say = (id: string, t: Target = at): string => ACTION_BY_ID.get(id)?.check?.(t, game) ?? 'ALLOWED';
const does = (id: string, t: Target = at): boolean => !!ACTION_BY_ID.get(id)?.applies?.(t, game);
const act = (id: string, t: Target = at): void => {
  ACTION_BY_ID.get(id)?.perform?.(t, game);
};
const onShore = (): void => {
  game.player.x = W0 - 1.5;
  game.player.y = WY + 0.5;
};
onShore();
game.player.x = W0 - 0.5;
check('afloat where the water is deep enough', game.launchSpot('caravel', SX, WY));

check('a passenger may come aboard from beside her', does('board_passenger') && say('board_passenger') === 'ALLOWED', say('board_passenger'));
act('board_passenger');
check('and has the first place on her deck', game.player.aboard === ship.id && game.player.seat === 1
  && ridersOf(ship).length === 1 && ridersOf(ship)[0].who === game.riderId(), JSON.stringify(ridersOf(ship)));
const [px, py] = game.passengerSpot(ship, 1);
game.update(0.1);
check('stands at that place, and is not in the water', Math.hypot(game.player.x - px, game.player.y - py) < 1e-6 && !game.player.swimming,
  `${game.player.x.toFixed(2)},${game.player.y.toFixed(2)} for ${px.toFixed(2)},${py.toFixed(2)}`);
game.log.length = 0;
const walked = game.moveTo(W0 - 4, WY);
check('and goes nowhere on their own feet', !walked && game.log.some((l) => l.text === 'You are aboard as a passenger. Step ashore first.'),
  game.log.map((l) => l.text).join(' | '));
check('is not offered the same place twice', !does('board_passenger') && say('board_passenger') === 'You are aboard her already.', say('board_passenger'));
check('and may step ashore, with land in reach', does('leave_passenger') && say('leave_passenger') === 'ALLOWED', say('leave_passenger'));
act('leave_passenger');
check('onto the dry ground, and off her list', game.player.aboard === null && !ridersOf(ship).length
  && !game.world.hasWater(Math.floor(game.player.x), Math.floor(game.player.y)),
  `${game.player.x},${game.player.y}`);

onShore();
game.player.x = W0 - 0.5;
ship.riders = [{ who: 'a', seat: 1 }, { who: 'b', seat: 2 }, { who: 'c', seat: 3 }];
check('the fourth is told every place is taken', say('board_passenger') === 'Every one of her 3 places is taken.', say('board_passenger'));
check('and nobody picks her up with people aboard', say('pick_up_furniture') === 'There are people aboard her.', say('pick_up_furniture'));
ship.riders = [];
ship.helm = 'somebody';
check('a helm somebody else holds is theirs', !does('board_vehicle') && say('board_vehicle') === 'Somebody else has the helm.', say('board_vehicle'));
ship.helm = undefined;
ship.helmAway = 'somebody';
check('a helm whose holder went away is not taken from the shore', say('board_vehicle') === 'Somebody else has the helm.', say('board_vehicle'));
ship.helmAway = undefined;
act('board_passenger');
game.player.x = W0 + 5;
check('an empty helm is taken from her deck, without standing beside her', say('board_vehicle') === 'ALLOWED', say('board_vehicle'));
act('board_vehicle');
check('and the place on deck is given up for it', !!ship.driven && game.player.aboard === null && !ridersOf(ship).length,
  `driven ${ship.driven}, aboard ${game.player.aboard}`);

/*
 * And on an island, where stepping ashore is the island's to do: the read that
 * no longer has us aboard her lands the body on the dry ground the island put
 * it on, found by the same rule from the same tile, rather than in the water.
 */
game.leaveAsPassenger(W0 - 1.5, WY + 0.5);
ship.driven = false;
ship.riders = [];
game.player.aboard = ship.id;
game.player.seat = 1;
[game.player.x, game.player.y] = game.passengerSpot(ship, 1);
const row = { id: ship.id, kind: 'furniture', sub: 'caravel', x: SX, y: WY, sx: 0, sy: 0, ql: 50, facing: 's', driver: null, mine: true };
game.sawGround({ placed: [row], crates: [] } as unknown as Parameters<Game['sawGround']>[0], undefined, 'my-uid');
check('stepped ashore on an island, the body is where the island put it',
  game.player.aboard === null && !game.world.hasWater(Math.floor(game.player.x), Math.floor(game.player.y)),
  `${game.player.x},${game.player.y}`);

/* ---- the island ------------------------------------------------------------- */
console.log('--- the island');
const PASSENGERS = ['c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2',
  'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', 'c4c4c4c4-c4c4-c4c4-c4c4-c4c4c4c4c4c4'];
const [ANNA, BRAN, COLL, DUNN] = PASSENGERS;
const isle = psql(`
begin;
create temp table said (k text, v text);
do $$
declare w uuid; dane uuid; v_ship bigint; v_row jsonb; t jsonb;
begin
  select id into w from world where name = 'Hoarding';
  select uid into dane from player where world_id = w and name = 'Dane';
  -- The harbour: dry ground west of corner 54, deep water from corner 55 east.
  delete from placed where world_id = w and x between 44 and 63 and y between 52 and 63;
  for i in 44..63 loop
    for j in 52..63 loop
      perform land_set_height(w, i, j, case when i <= 54 then 10 else -10 end);
    end loop;
  end loop;
  for i in 44..53 loop
    for j in 52..62 loop
      perform land_set_tile(w, i, j, tile_id('Grass'));
    end loop;
  end loop;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'furniture', 'caravel', 55, 58, 0, 0, 55.5, 58.5, 50, dane) returning id into v_ship;
  t := jsonb_build_object('kind', 'furniture', 'id', v_ship);
  delete from player where world_id = w and uid in ('${ANNA}', '${BRAN}', '${COLL}', '${DUNN}');
  insert into player (world_id, uid, name, x, y) values
    (w, '${ANNA}', 'Anna', 48.5, 58.5), (w, '${BRAN}', 'Bran', 48.5, 58.5),
    (w, '${COLL}', 'Coll', 48.5, 58.5), (w, '${DUNN}', 'Dunn', 48.5, 58.5);
  update player set x = 48.5, y = 58.5, stats = '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb
    where world_id = w and uid = dane;

  insert into said values ('FAR', coalesce(act_refusal(w, '${ANNA}', 'board_passenger',
    jsonb_build_object('kind', 'furniture', 'id', v_ship)), 'ALLOWED'));
  update player set x = 53.6, y = 58.5 where world_id = w and uid in ('${ANNA}', '${BRAN}', '${COLL}', '${DUNN}');
  update player set x = 53.6, y = 58.5 where world_id = w and uid = dane;
  insert into said values ('ASK', coalesce(act_refusal(w, '${ANNA}', 'board_passenger', t), 'ALLOWED'));
  perform act_perform(w, '${ANNA}', 'board_passenger', t);
  insert into said values ('SAID', (select text from event where world_id = w and uid = '${ANNA}' order by n desc limit 1));
  insert into said values ('ANNA', (select coalesce(aboard = v_ship, false) || ',' || seat || ',' || x || ',' || y
    from player where world_id = w and uid = '${ANNA}'));
  insert into said values ('DEEP', in_deep_water(w, '${ANNA}')::text);
  perform act_perform(w, '${BRAN}', 'board_passenger', t);
  perform act_perform(w, '${COLL}', 'board_passenger', t);
  insert into said values ('FULL', coalesce(act_refusal(w, '${DUNN}', 'board_passenger', t), 'ALLOWED'));
  insert into said values ('SEATS', (select string_agg(name || ' ' || seat, ', ' order by seat) from player
    where world_id = w and aboard = v_ship));
  insert into said values ('LIFT', coalesce(act_refusal(w, dane, 'pick_up_furniture', t), 'ALLOWED'));

  -- Dane takes the helm and takes her out: everybody aboard goes too, and a passenger's own walk goes nowhere.
  perform act_perform(w, dane, 'board_vehicle', t);
  insert into said values ('HELD', coalesce(act_refusal(w, '${ANNA}', 'board_vehicle', t), 'ALLOWED'));
  perform drag_along(w, dane, 60.5, 58.5);
  insert into said values ('WENT', (select string_agg(name || ' ' || x || ',' || y, '; ' order by seat) from player
    where world_id = w and aboard = v_ship));
  perform set_config('request.jwt.claims', json_build_object('sub', '${BRAN}')::text, true);
  v_row := rpc_move(w, 50.5, 58.5, 0);
  insert into said values ('PINNED', (v_row->>'x') || ',' || (v_row->>'y') || ',' || (v_row->>'pulled'));
  v_row := rpc_ground(w, 40, false);
  insert into said values ('GROUND', (select (e->'riders')::text || '|' || coalesce(e->>'helm_open', 'none')
    from jsonb_array_elements(v_row->'placed') e where (e->>'id')::bigint = v_ship));
  insert into said values ('AFAR', coalesce(act_refusal(w, '${BRAN}', 'leave_passenger', t), 'ALLOWED'));

  -- Dane goes away at sea; a passenger takes the empty helm, and Dane is given the place she left.
  update player set away = true where world_id = w and uid = dane;
  insert into said values ('SHORE', coalesce(act_refusal(w, '${DUNN}', 'board_vehicle', t), 'ALLOWED'));
  insert into said values ('OPEN', coalesce(act_refusal(w, '${ANNA}', 'board_vehicle', t), 'ALLOWED'));
  perform act_perform(w, '${ANNA}', 'board_vehicle', t);
  insert into said values ('SWAP', (select driver = '${ANNA}' from placed where id = v_ship) || ','
    || (select coalesce(aboard = v_ship, false) || ',' || coalesce(seat, 0) from player where world_id = w and uid = dane)
    || ',' || (select coalesce(aboard::text, 'none') from player where world_id = w and uid = '${ANNA}'));
  update player set away = false where world_id = w and uid = dane;

  -- Brought in: Bran steps ashore onto dry ground.
  perform drag_along(w, '${ANNA}', 55.5, 58.5);
  insert into said values ('NEAR', coalesce(act_refusal(w, '${BRAN}', 'leave_passenger', t), 'ALLOWED'));
  perform act_perform(w, '${BRAN}', 'leave_passenger', t);
  insert into said values ('ASHORE', (select coalesce(aboard::text, 'none') || ',' || has_water(w, floor(x)::int, floor(y)::int)
    from player where world_id = w and uid = '${BRAN}') || '|'
    || (select text from event where world_id = w and uid = '${BRAN}' order by n desc limit 1));

  -- Death takes you off her.
  perform player_die(w, '${COLL}');
  insert into said values ('DIED', (select coalesce(aboard::text, 'none') from player where world_id = w and uid = '${COLL}'));

  -- Tidy up after ourselves.
  update placed set driver = null where id = v_ship;
  delete from player where world_id = w and uid in ('${ANNA}', '${BRAN}', '${COLL}', '${DUNN}');
  update player set aboard = null, seat = null where world_id = w and uid = dane;
  delete from placed where id = v_ship;
end $$;
select k || '|' || coalesce(v, 'NULL') from said;
commit;
`);
const said = (key: string): string =>
  isle.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

check('too far off to come aboard, in the same words', said('FAR') === 'Stand beside her first.', said('FAR'));
check('beside her, a passenger may come aboard', said('ASK') === 'ALLOWED', said('ASK'));
check('and is told where they are', said('SAID') === 'You climb aboard the caravel and find a place on deck. 1 of 3 places are taken.', said('SAID'));
check('in the first place, where she is', said('ANNA') === 'true,1,55.5,58.5', said('ANNA'));
check('and not in the water', said('DEEP') === 'false', said('DEEP'));
check('the fourth is told every place is taken, in the same words', said('FULL') === 'Every one of her 3 places is taken.', said('FULL'));
check('the three have a place each', said('SEATS') === 'Anna 1, Bran 2, Coll 3', said('SEATS'));
check('nobody picks her up with people aboard, in the same words', said('LIFT') === 'There are people aboard her.', said('LIFT'));
check('a helm somebody present holds is theirs, in the same words', said('HELD') === 'Somebody else has the helm.', said('HELD'));
check('where the helm takes her, everybody aboard goes', said('WENT') === 'Anna 60.5,58.5; Bran 60.5,58.5; Coll 60.5,58.5', said('WENT'));
check('and a passenger\'s own walk puts them where she is', said('PINNED') === '60.5,58.5,false', said('PINNED'));
check('the island says who is aboard her and in which place',
  said('GROUND') === `[{"uid": "${ANNA}", "seat": 1}, {"uid": "${BRAN}", "seat": 2}, {"uid": "${COLL}", "seat": 3}]|false`, said('GROUND'));
check('with no land in reach, nobody steps ashore, in the same words',
  said('AFAR') === 'There is no shore within reach. Wait until she comes in close.', said('AFAR'));
check('a helm whose holder has gone away is not taken from the shore, in the same words', said('SHORE') === 'Somebody else has the helm.', said('SHORE'));
check('a helm whose holder has gone away is taken from her deck', said('OPEN') === 'ALLOWED', said('OPEN'));
check('and the one who went away has the place that was left', said('SWAP') === 'true,true,1,none', said('SWAP'));
check('brought in, a passenger may step ashore', said('NEAR') === 'ALLOWED', said('NEAR'));
check('onto dry ground, in the same words', said('ASHORE') === 'none,false|You step ashore from the caravel.', said('ASHORE'));
check('and dying takes you off her', said('DIED') === 'none', said('DIED'));

for (const line of [...ok, ...bad]) console.log(line);
console.log(`a caravel and her passengers — ${ok.length} of ${ok.length + bad.length}`);
if (bad.length) process.exit(1);
