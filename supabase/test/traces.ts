/**
 * A team stays in the traces.
 *
 * Asked: "hitching wildermon to the wagon doesn't seem to be working. fix so
 * that they are hitched until unhitched, that all permissions for vehicles are
 * open by default, and that hitched wildermon are free from enemy aggressive
 * targeting and do not get hungry as long as they're hitched".
 *
 * On an island the hitch was written and nothing read it: the once-a-second
 * settle walked a companion back to its keeper and sent a worker out to its
 * trade, its belly went on emptying, the bell called it off the shafts, and
 * the browser was never told it was hitched at all. So this asks, of both
 * sides:
 *
 *   * an hour after it goes in, with its keeper walked off, a beast in the
 *     traces is still in them, still at the vehicle and no hungrier -- while
 *     one beside it that is not in harness has eaten into its belly;
 *   * driving it ten seconds costs it nothing either;
 *   * nothing that would send it elsewhere is open to it, and each refusal
 *     says why -- the bell included;
 *   * no fight picks it, even one that is somehow wild;
 *   * the island tells the browser which traces it is in, and the browser
 *     builds the vehicle's team, the seat and the shafts from what it is told;
 *   * the only things that end a hitch are taking it out and the vehicle going,
 *     and taking it out does not bill its belly for the hours it stood there;
 *   * and a vehicle is anybody's to use: somebody who did not build it, on
 *     ground that is not theirs, may hitch to it, take a beast out of it, take
 *     the reins, load it, empty it, take hold of a cart and pick one up.
 *
 * The island half runs against the database the suite leaves behind, in one
 * transaction that is rolled back.
 */
import { execFileSync } from 'node:child_process';
import { Game, type IslandGround, type IslandPlaced } from '../../src/game/game';
import { CREATURE_ACTION_BY_ID } from '../../src/game/creatureActions';
import { quarry, type IslandCreature } from '../../src/game/creatures';
import { teamOf } from '../../src/game/furniture';
import { PLACEABLE_ACTION_BY_ID } from '../../src/game/placeables';

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

/* ---- the browser --------------------------------------------------------- */

const game = Game.create(4242);
/*
 * Open, dry, level ground with room to drive a dozen tiles east: a cart will
 * not stand in water or on a cliff, and a drive that stops at the first bank
 * measures the bank.
 */
let spot: [number, number] | null = null;
const clear = (x0: number, y0: number): boolean => {
  for (let y = y0 - 2; y <= y0 + 2; y++) {
    for (let x = x0 - 2; x <= x0 + 14; x++) {
      if (!game.world.isPassable(x, y) || game.world.hasWater(x, y) || game.world.slope(x, y) >= 12) return false;
    }
  }
  return true;
};
for (let r = 0; r < 200 && !spot; r++) {
  for (let dx = -r; dx <= r && !spot; dx++) {
    for (const dy of [-r, r]) {
      if (clear(96 + dx, 96 + dy)) {
        spot = [96 + dx, 96 + dy];
        break;
      }
    }
  }
}
check('a stretch of open ground to drive on', spot !== null, spot ? `${spot[0]}, ${spot[1]}` : 'none found');
const [px, py] = spot ?? [96, 96];
for (const f of [...game.furniture.values()]) game.removeFurniture(f.id);
game.player.x = px + 0.5;
game.player.y = py + 0.5;

const cart = game.addFurniture('large_cart', px + 1, py, 0, 0, 40, [], 'Pine');
const orse = game.creatures.spawn('orse', px + 1.5, py + 1.5, 'active', game.rand, game.time - 3600 * 24);
orse.name = 'Greyfell';
orse.hunger = 0.8;
const beast = { kind: 'creature' as const, id: orse.id };
const hitch = CREATURE_ACTION_BY_ID.get('hitch_creature');
const unhitch = CREATURE_ACTION_BY_ID.get('unhitch_creature');
const board = PLACEABLE_ACTION_BY_ID.get('board_vehicle');
if (!hitch || !unhitch || !board) throw new Error('an action is missing');

console.log('--- the browser');
check('a grown orse beside a large cart can be hitched', hitch.applies(beast, game) && !hitch.check?.(beast, game),
  hitch.check?.(beast, game) ?? 'nothing in the way');
hitch.perform(beast, game);
check('and is in its traces', orse.hitchedTo === cart.id && teamOf(cart).includes(orse.id));
const heard = game.log.length;
hitch.perform(beast, game);
const again = game.log.slice(heard).map((l) => l.text);
check('hitched again when it already is, it says so rather than nothing',
  again.includes('Greyfell is already in the traces.'), again.join(' | ') || 'nothing');
const fed = orse.hunger;
const [hx, hy] = [orse.x, orse.y];

// A minute on foot, twelve tiles off.
game.moveTo(px + 12, py);
for (let t = 0; t < 300; t++) game.update(0.2);
check('a minute later, walked away from, it is still in the traces and where it was hitched',
  orse.hitchedTo === cart.id && Math.hypot(orse.x - hx, orse.y - hy) < 0.01,
  `hitched to ${orse.hitchedTo}, ${Math.hypot(orse.x - hx, orse.y - hy).toFixed(2)} tiles from where it went in, the player ${Math.hypot(game.player.x - hx, game.player.y - hy).toFixed(1)} off`);
check('and no hungrier', orse.hunger === fed, `${fed} → ${orse.hunger}`);
check('nothing offers to hitch it again, and it can be taken out',
  !hitch.applies(beast, game) && unhitch.applies(beast, game));

// Back to the cart, and a dozen tiles east on the seat.
game.moveTo(px + 1, py + 1);
for (let t = 0; t < 100 && game.player.path; t++) game.update(0.2);
const reins = { kind: 'furniture' as const, id: cart.id };
check('back at the cart the reins are there to take', board.applies(reins, game) && !board.check?.(reins, game),
  board.check?.(reins, game) ?? 'nothing in the way');
board.perform(reins, game);
const from = cart.x;
check('and the reins take us somewhere', game.moveTo(px + 12, py + 1));
let drove = 0;
for (let t = 0; t < 300 && game.player.path; t++) {
  game.update(0.2);
  drove += 0.2;
}
check('driven, the cart comes along', game.driving() === cart && cart.x > from + 4,
  `${cart.x - from} tiles in ${drove.toFixed(1)}s`);
check('and hauling it cost the team nothing', orse.hunger === fed, `${fed} → ${orse.hunger} after ${drove.toFixed(1)}s in the traces`);

// Nothing picks it, even one that is somehow wild.
orse.mode = 'wild';
check('a beast in the traces is nobody\'s quarry, even one gone wild', !quarry(orse));
orse.mode = 'active';
const loose = game.creatures.spawn('orse', px + 20.5, py + 0.5, 'wild', game.rand, game.time - 3600 * 24);
check('while one that is wild and loose still is', quarry(loose));

unhitch.perform(beast, game);
check('taking it out is what ends it', orse.hitchedTo === null && !teamOf(cart).includes(orse.id));

/* ---- the browser on an island -------------------------------------------- */

const isle = Game.create(4243);
isle.creatures.fromIsland = true;
const me = '11111111-1111-1111-1111-111111111111';
const piece = (over: Partial<IslandPlaced>): IslandPlaced => ({
  id: 0, kind: 'furniture', sub: 'large_cart', x: 10, y: 10, sx: 0, sy: 0, ql: 40, fuel: null, ash: null,
  lit: null, dmg: 0, name: null, material: 'Pine', litres: null, liquid: null, ferment: null, bait: null,
  bait_ql: null, caught: null, state: null, mine: false, ...over,
});
const beastRow = (id: number, hitchedTo: number | null): IslandCreature => ({
  id, species: 'orse', name: `Orse ${id}`, variant: 0, mode: 'active', stance: 'defensive',
  x: 11.5, y: 10.5, health: 40, hunger: 0.9, hitchedTo,
});
isle.creatures.sawAll([beastRow(7, 501), beastRow(8, null)]);
isle.sawGround({
  placed: [
    piece({ id: 501, driver: me }),
    piece({ id: 502, x: 20, driver: '22222222-2222-2222-2222-222222222222' }),
    piece({ id: 503, sub: 'cart', x: 30, puller: me }),
  ],
  crates: [],
} as IslandGround, undefined, me);
console.log('--- the browser, told by an island');
check('the island saying which traces it is in puts it in the vehicle\'s team',
  JSON.stringify(teamOf(isle.furniture.get(501) ?? { kind: '' } as never)) === '[7]',
  JSON.stringify(isle.furniture.get(501)?.team));
check('the seat the island says is ours is the one we are driving', isle.driving()?.id === 501, `${isle.driving()?.id}`);
check('and one somebody else is driving is not ours to move', !isle.furniture.get(502)?.driven);
check('a cart the island says we have by the shafts follows us', isle.furniture.get(503)?.hitched === true);
check('its menu offers to take it out, and not to hitch it again',
  !!CREATURE_ACTION_BY_ID.get('unhitch_creature')?.applies({ kind: 'creature', id: 7 }, isle)
  && !CREATURE_ACTION_BY_ID.get('hitch_creature')?.applies({ kind: 'creature', id: 7 }, isle));
isle.creatures.sawAll([beastRow(7, 501), beastRow(8, 501)]);
isle.teamsFromCreatures();
check('and a creature read after the ground read keeps the team up to date',
  JSON.stringify(isle.furniture.get(501)?.team) === '[7,8]', JSON.stringify(isle.furniture.get(501)?.team));

/* ---- the island ---------------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
do $$
declare w uuid; a uuid := '11111111-1111-1111-1111-111111111111'; b uuid := '22222222-2222-2222-2222-222222222222';
        v_cart placed; v_small placed; v_item bigint; v_pet int; v_hand int; v_free int; v_rival int;
        v_post bigint; v_bell bigint; v_log bigint; h_pet double precision; h_hand double precision;
        h_free double precision; c creature; v_js jsonb; v_q creature;
begin
  select id into w from world where name = 'Bigness';
  -- Ivar on his own settlement, Hild a stranger on it.
  update player set x = 2041.5, y = 2040.5, away = false, seen_at = now() where world_id = w and uid = a;
  update player set x = 2042.5, y = 2041.5, away = false, seen_at = now() where world_id = w and uid = b;
  delete from creature where world_id = w and keeper in (a, b);

  perform give(w, a, 'large_cart', 1, 50, 'Pine');
  select id into v_item from item where world_id = w and holder = 'player' and holder_uid = a and def = 'large_cart'
    order by id desc limit 1;
  perform act_perform(w, a, 'place_furniture',
    jsonb_build_object('kind', 'item', 'uid', v_item, 'x', 2042, 'y', 2040, 'sx', 0, 'sy', 0));
  select * into v_cart from placed where world_id = w and sub = 'large_cart' and made_by = a order by id desc limit 1;

  v_pet := creature_spawn(w, 'orse', 2042.4, 2040.6, 'active', now() - interval '1 day', a);
  v_hand := creature_spawn(w, 'orse', 2042.6, 2040.4, 'deed', now() - interval '1 day', a);
  v_free := creature_spawn(w, 'orse', 2041.6, 2041.4, 'deed', now() - interval '1 day', a);
  update creature set hunger = 0.9, name = case id when v_pet then 'Greyfell' when v_hand then 'Dunn' else 'Loose' end,
      settled_at = now(), until = now(), leg_at = now(), leg_ends = now(), from_x = to_x, from_y = to_y
    where world_id = w and id in (v_pet, v_hand, v_free);

  insert into said values ('refusal-hitch', coalesce(act_refusal(w, a, 'hitch_creature',
    jsonb_build_object('kind', 'creature', 'id', v_pet)), 'none'));
  -- Through the door a browser uses: asked, and finished by the settle when
  -- the time is up, which is where a hitch used to go quiet. Nothing that
  -- hunts about, and a body in good heart, so the settle is the job's alone.
  delete from creature cr using species_def sd
    where cr.world_id = w and cr.mode = 'wild' and sd.id = cr.species and sd.hunter;
  update player set stats = jsonb_build_object('health', 1, 'hunger', 1, 'thirst', 1, 'stamina', 1),
      body_at = now(), act = null, act_queue = '[]'::jsonb
    where world_id = w and uid = a;
  delete from event where world_id = w and uid = a;
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  insert into said values ('asked', rpc_act(w, 'hitch_creature', jsonb_build_object('kind', 'creature', 'id', v_pet), 1)->>'started');
  update player set act_ends = now() - interval '1 second' where world_id = w and uid = a and act is not null;
  perform settle(w, a);
  insert into said select 'told', coalesce(string_agg(text, ' / ' order by n), 'nothing')
    from event where world_id = w and uid = a and kind in ('info', 'event', 'error');
  perform act_perform(w, a, 'hitch_creature', jsonb_build_object('kind', 'creature', 'id', v_hand));
  -- And a hitch that cannot happen by the time it is done says why.
  delete from event where world_id = w and uid = a;
  perform act_perform(w, a, 'hitch_creature', jsonb_build_object('kind', 'creature', 'id', v_pet));
  insert into said select 'twice', coalesce(string_agg(kind || ': ' || text, ' / ' order by n), 'nothing')
    from event where world_id = w and uid = a;
  insert into said select 'hitched', count(*)::text from creature where world_id = w and hitched_to = v_cart.id;

  -- An hour gone, and Ivar walked off to the far side of his settlement.
  select hunger into h_pet from creature where world_id = w and id = v_pet;
  select hunger into h_hand from creature where world_id = w and id = v_hand;
  select hunger into h_free from creature where world_id = w and id = v_free;
  update creature set settled_at = now() - interval '1 hour' where world_id = w and id in (v_pet, v_hand, v_free);
  update player set x = 2045.5, y = 2044.5 where world_id = w and uid = a;
  perform creature_settle(w, v_pet);
  perform creature_settle(w, v_hand);
  perform creature_settle(w, v_free);
  for c in select * from creature where world_id = w and id in (v_pet, v_hand) order by id loop
    insert into said values ('held-' || c.name,
      coalesce(c.hitched_to::text, 'free') || '|' || round(sqrt((creature_x(c) - v_cart.cx) ^ 2 + (creature_y(c) - v_cart.cy) ^ 2)::numeric, 2)
      || '|' || round(c.hunger::numeric, 4) || '|' || round((case when c.id = v_pet then h_pet else h_hand end)::numeric, 4));
  end loop;
  insert into said select 'loose', round(h_free::numeric, 4) || '|' || round(hunger::numeric, 4)
    from creature where world_id = w and id = v_free;

  -- Everything that would send one in harness somewhere else.
  insert into said values ('again', coalesce(act_refusal(w, a, 'hitch_creature', jsonb_build_object('kind', 'creature', 'id', v_pet)), 'none'));
  insert into said values ('store', coalesce(act_refusal(w, a, 'store_creature', jsonb_build_object('kind', 'creature', 'id', v_pet)), 'none'));
  insert into said values ('take', coalesce(act_refusal(w, a, 'take_creature', jsonb_build_object('kind', 'creature', 'id', v_hand)), 'none'));
  insert into said values ('release', coalesce(act_refusal(w, a, 'release_creature', jsonb_build_object('kind', 'creature', 'id', v_pet)), 'none'));
  insert into said values ('assign', coalesce(act_refusal(w, a, 'assign_deed', jsonb_build_object('kind', 'creature', 'id', v_pet)), 'none'));
  -- The knife wants him beside it, so he walks back for that one.
  update player set x = 2041.5, y = 2040.5 where world_id = w and uid = a;
  insert into said values ('cull', coalesce(act_refusal(w, a, 'cull_creature', jsonb_build_object('kind', 'creature', 'id', v_pet)), 'none'));
  update player set x = 2045.5, y = 2044.5 where world_id = w and uid = a;
  insert into placed (world_id, kind, x, y, cx, cy, ql, made_by)
    values (w, 'post', 2044, 2043, 2044.3, 2043.3, 40, a) returning id into v_post;
  insert into said values ('post', coalesce(act_refusal(w, a, 'assign_post',
    jsonb_build_object('kind', 'post', 'id', v_post, 'creature', v_pet)), 'none'));
  insert into said values ('unhitch-free', coalesce(act_refusal(w, a, 'unhitch_creature', jsonb_build_object('kind', 'creature', 'id', v_free)), 'none'));

  -- The bell, rung beside Ivar.
  insert into placed (world_id, kind, sub, x, y, cx, cy, ql, made_by)
    values (w, 'furniture', 'bell', 2045, 2045, 2045.5, 2045.5, 40, a) returning id into v_bell;
  insert into said values ('bell', coalesce(act_refusal(w, a, 'ring_bell', jsonb_build_object('kind', 'furniture', 'id', v_bell)), 'none'));
  perform perform_last(w, a, 'ring_bell', jsonb_build_object('kind', 'furniture', 'id', v_bell));
  for c in select * from creature where world_id = w and id in (v_hand, v_free) order by id loop
    insert into said values ('bell-' || c.name, round(c.to_x::numeric, 1) || ',' || round(c.to_y::numeric, 1));
  end loop;

  -- No fight picks it, even one that is somehow wild; and a companion of
  -- Hild's set on anything wild, standing at the cart.
  update creature set mode = 'wild' where world_id = w and id = v_pet;
  v_q := wild_quarry(w, v_cart.cx, v_cart.cy, 1.5, v_cart.cx, v_cart.cy);
  insert into said values ('quarry', coalesce(v_q.id::text, 'none') || '|' || v_pet);
  v_rival := creature_spawn(w, 'orse', 2042.5, 2041.2, 'active', now() - interval '1 day', b);
  update creature set stance = 'aggressive', name = 'Hild''s', settled_at = now(), until = now(),
      leg_at = now(), leg_ends = now(), from_x = to_x, from_y = to_y
    where world_id = w and id = v_rival;
  update player set x = 2042.5, y = 2040.9 where world_id = w and uid = b;
  select * into c from creature where world_id = w and id = v_rival;
  v_q := companion_target(w, c, (select pl from player pl where pl.world_id = w and pl.uid = b));
  insert into said values ('companion', coalesce(v_q.id::text, 'none') || '|' || v_pet);
  update creature set mode = 'active' where world_id = w and id = v_pet;

  -- What the browser is told.
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  v_js := rpc_creatures(w, 40);
  insert into said select 'payload', coalesce(x->>'hitchedTo', 'absent') || '|' || v_cart.id
    from jsonb_array_elements(v_js) x where (x->>'id')::int = v_pet;

  -- Anybody's to use: Hild, on Ivar's settlement, with Ivar's cart.
  perform act_perform(w, a, 'unhitch_creature', jsonb_build_object('kind', 'creature', 'id', v_hand));
  insert into said values ('b-hitch', coalesce(act_refusal(w, b, 'hitch_creature', jsonb_build_object('kind', 'creature', 'id', v_rival)), 'none'));
  perform act_perform(w, b, 'hitch_creature', jsonb_build_object('kind', 'creature', 'id', v_rival));
  insert into said values ('b-unhitch', coalesce(act_refusal(w, b, 'unhitch_creature', jsonb_build_object('kind', 'creature', 'id', v_pet)), 'none'));
  -- Taken out an hour after anything last settled it, and settled again at
  -- once: the hour was spent in the traces, so it costs nothing.
  update creature set settled_at = now() - interval '1 hour' where world_id = w and id = v_pet;
  select hunger into h_pet from creature where world_id = w and id = v_pet;
  perform act_perform(w, b, 'unhitch_creature', jsonb_build_object('kind', 'creature', 'id', v_pet));
  perform creature_settle(w, v_pet);
  insert into said select 'came-out', round(h_pet::numeric, 4) || '|' || round(hunger::numeric, 4)
    from creature where world_id = w and id = v_pet;
  insert into said values ('b-board', coalesce(act_refusal(w, b, 'board_vehicle', jsonb_build_object('kind', 'furniture', 'id', v_cart.id)), 'none'));
  perform act_perform(w, b, 'board_vehicle', jsonb_build_object('kind', 'furniture', 'id', v_cart.id));
  insert into said select 'b-driving', coalesce((driver = b)::text, 'nobody') from placed where id = v_cart.id;
  perform act_perform(w, b, 'leave_vehicle', jsonb_build_object('kind', 'furniture', 'id', v_cart.id));
  perform give(w, b, 'log', 1, 30, 'Oak');
  select id into v_log from item where world_id = w and holder = 'player' and holder_uid = b and def = 'log'
    order by id desc limit 1;
  insert into said values ('b-load', coalesce(act_refusal(w, b, 'store_in_furniture',
    jsonb_build_object('kind', 'item', 'uid', v_log, 'count', 1, 'into', v_cart.id)), 'none'));
  perform act_perform(w, b, 'store_in_furniture', jsonb_build_object('kind', 'item', 'uid', v_log, 'count', 1, 'into', v_cart.id));
  insert into said values ('b-empty', coalesce(act_refusal(w, b, 'furniture_take_all', jsonb_build_object('kind', 'furniture', 'id', v_cart.id)), 'none'));
  perform give(w, a, 'cart', 1, 50, 'Pine');
  select id into v_item from item where world_id = w and holder = 'player' and holder_uid = a and def = 'cart'
    order by id desc limit 1;
  perform act_perform(w, a, 'place_furniture',
    jsonb_build_object('kind', 'item', 'uid', v_item, 'x', 2043, 'y', 2041, 'sx', 0, 'sy', 0));
  select * into v_small from placed where world_id = w and sub = 'cart' and made_by = a order by id desc limit 1;
  insert into said values ('b-pull', coalesce(act_refusal(w, b, 'pull_cart', jsonb_build_object('kind', 'furniture', 'id', v_small.id)), 'none'));
  insert into said values ('b-lift', coalesce(act_refusal(w, b, 'pick_up_furniture', jsonb_build_object('kind', 'furniture', 'id', v_small.id)), 'none'));

  -- Taken out, it is a companion again: at its keeper's heels on the next beat.
  update creature set settled_at = now() - interval '10 seconds' where world_id = w and id = v_pet;
  perform creature_settle(w, v_pet);
  select * into c from creature where world_id = w and id = v_pet;
  insert into said values ('out', coalesce(c.hitched_to::text, 'free') || '|'
    || round(sqrt((c.to_x - 2045.5) ^ 2 + (c.to_y - 2044.5) ^ 2)::numeric, 2));

  -- And the vehicle going is the other thing that ends one.
  delete from placed where world_id = w and id = v_cart.id;
  update creature set settled_at = now() - interval '10 seconds' where world_id = w and id = v_rival;
  perform creature_settle(w, v_rival);
  insert into said select 'gone', coalesce(hitched_to::text, 'free') from creature where world_id = w and id = v_rival;
end $$;
select k || '|' || v from said;
rollback;
`);
const said = (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

console.log('--- the island');
check('a grown orse beside a large cart can be hitched', said('refusal-hitch') === 'none', said('refusal-hitch'));
check('asked through the door a browser uses, the hitch starts', said('asked') === 'true', said('asked'));
check('and when it is done it says so', said('told') === 'You start hitching it up. / You back Greyfell into a yoke of the large cart (pine). 1 of 2 filled.',
  said('told'));
check('and the cart takes two', said('hitched') === '2', said('hitched'));
check('hitched again when it already is, it says so rather than nothing',
  said('twice') === 'error: Greyfell is already in the traces.', said('twice'));
for (const name of ['Greyfell', 'Dunn']) {
  const [to, off, now, was] = said(`held-${name}`).split('|');
  check(`an hour later, its keeper walked off, ${name} is still in the traces and at the cart`,
    to !== 'free' && Number(off) < 0.01, `hitched to ${to}, ${off} tiles off`);
  check(`and no hungrier`, now === was, `${was} → ${now}`);
}
const [loose0, loose1] = said('loose').split('|');
check('while one beside it that is not in harness has eaten into its belly',
  Number(loose1) < Number(loose0), `${loose0} → ${loose1}`);

check('asked to hitch one already in, the island says so', said('again') === 'Greyfell is already in the traces.', said('again'));
for (const [key, what] of [['store', 'to the token'], ['take', 'back to you'], ['release', 'back to the wild'], ['assign', 'to work'], ['cull', 'to the knife']]) {
  check(`and nothing sends one in harness ${what}`, said(key).endsWith('is in the traces. Take it out first.'), said(key));
}
check('or to a post, in the browser\'s words', said('post') === 'Greyfell is in harness.', said('post'));
check('and taking out one that is not in says that', said('unhitch-free') === 'Loose is not in the traces.', said('unhitch-free'));

check('the bell is Ivar\'s to ring', said('bell') === 'none', said('bell'));
check('and it leaves the one in the traces where it is', said('bell-Dunn') !== '2045.5,2044.5', said('bell-Dunn'));
check('while it calls the one that is free to whoever rang', said('bell-Loose') === '2045.5,2044.5', said('bell-Loose'));

const [q, pet] = said('quarry').split('|');
check('no fight picks one in the traces, even one gone wild', q !== pet, `${q === 'none' ? 'nothing' : q} picked, not ${pet}`);
const [cq, cpet] = said('companion').split('|');
check('not even a companion set on anything wild, standing beside it', cq !== cpet, `${cq === 'none' ? 'nothing' : cq} picked`);

const [tells, cartId] = said('payload').split('|');
check('the island tells the browser which traces it is in', tells === cartId, `${tells} for cart ${cartId}`);

for (const [key, what] of [['b-hitch', 'hitch her own to his cart'], ['b-unhitch', 'take his out of it'],
  ['b-board', 'take the reins'], ['b-load', 'load it'], ['b-empty', 'empty it'],
  ['b-pull', 'take his small cart by the shafts'], ['b-lift', 'and pick it up']] as const) {
  check(`somebody who did not build it, on his settlement, may ${what}`, said(key) === 'none', said(key));
}
check('and she is the one driving it', said('b-driving') === 'true', said('b-driving'));

const [outWas, outNow] = said('came-out').split('|');
check('an hour in the traces nothing settled is not billed to its belly when it comes out', outWas === outNow,
  `${outWas} → ${outNow}`);
const [outTo, outOff] = said('out').split('|');
check('taken out, it is a companion again, at its keeper\'s heels', outTo === 'free' && Number(outOff) < 0.01,
  `${outTo}, ${outOff} tiles from Ivar`);
check('and the vehicle going is the other thing that ends a hitch', said('gone') === 'free', said('gone'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a team stays in the traces until it is taken out — ${ok.length} of ${ok.length}`);
