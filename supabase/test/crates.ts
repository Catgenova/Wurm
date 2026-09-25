/**
 * Creature crates.
 *
 * Asked for: "Creature crates cost 8 planks and 4 nails, and 2 ribbons.
 * Wildermon can be tamed to be set to active if currently no active
 * wildermon, but any additional wildermon cannot be tamed unless the player
 * carries a creature crate. Creature crates can be placed on the ground and
 * display the wildermon inside them. They weigh 10kg. Wildermon can no longer
 * be Kept at Token. Interacting with a creature crate allows you to pick it up
 * / place it, assign the creature to active, or assign the creature to work
 * the deed."
 *
 * Asked of both sides:
 *
 *   * the crate is built of 8 planks, 4 nails and 2 ribbons, weighs 10 kg,
 *     and does not rot;
 *   * the first wildermon tamed follows you; the next is refused, in the same
 *     words on both sides, until an empty crate is in the pack, and then goes
 *     into the crate;
 *   * a crate with a wildermon in it is carried, set down or opened and
 *     nothing else: it is not dropped, and on the island nothing can move it
 *     anywhere else even past the door;
 *   * set down, the crate stands with the wildermon in it, which stands where
 *     the crate does -- the renderer draws it inside from that;
 *   * opened to follow you, the one inside comes out and the companion you
 *     had goes into the crate in its place;
 *   * picked up, the crate goes back in the pack with the wildermon in it;
 *   * opened to work the deed, the one inside is a worker;
 *   * Keep at token is gone;
 *   * a worker taken off the deed leaves your companion on the deed in its
 *     place;
 *   * a young one goes where a tamed one goes and then into a crate standing
 *     on the settlement -- asked for as "Else goes into an empty crate placed
 *     on deed": it follows you when nothing does, goes into an empty crate in
 *     your pack when something does, into an empty one of yours standing on
 *     your settlement when you carry none, and into the wild with none of
 *     those, with its keeper's name on it;
 *   * on the island your own in crates come down with the wildlife wherever
 *     they are, and a wildermon out of its crate by any road is out of it;
 *   * and in the browser, a wildermon kept at the token in an old save is put
 *     in a crate beside the token.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import { RECIPES } from '../../src/game/recipes';
import { itemDef, groundDecayRate } from '../../src/game/items';
import type { Creature } from '../../src/game/creatures';
import { CREATURE_CRATE, crateTheKept, emptyCrate, occupiedRefusal } from '../../src/game/creaturecrate';

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

/* ---- the browser ----------------------------------------------------------- */

console.log('--- the browser');
const game = Game.create(4242);
// Every roll lands, so a tame is a tame.
game.rand = () => 0;
game.skills.values.set('taming', 90);
for (const c of [...game.creatures.list.values()]) if (c.mode !== 'wild') c.mode = 'wild';
game.inventory.add('potato', { count: 40, ql: 30 });
const act = (id: string) => ACTION_BY_ID.get(id)!;
const at = (c: Creature): Target => ({ kind: 'creature', id: c.id });
const beside = (): Creature => game.creatures.spawn('rabba', game.player.x + 0.3, game.player.y, 'wild', game.rand, 0);

const recipe = RECIPES.find((r) => r.id === `make_${CREATURE_CRATE}`);
check('the crate is built of 8 planks, 4 nails and 2 ribbons',
  JSON.stringify(recipe?.inputs) === JSON.stringify([{ item: 'plank', count: 8 }, { item: 'nail', count: 4 }, { item: 'ribbon', count: 2 }]),
  JSON.stringify(recipe?.inputs));
check('it weighs 10 kg and does not rot', itemDef(CREATURE_CRATE).weight === 10
  && groundDecayRate({ uid: 0, id: CREATURE_CRATE, ql: 20, dmg: 0, count: 1 }) === 0);

const first = beside();
act('tame').perform(at(first), game);
check('the first one tamed follows you', first.mode === 'active', first.mode);
const second = beside();
const refused = act('tame').check?.(at(second), game) ?? null;
check('the next is refused without a crate', refused === 'Rabba already follows you. Carry an empty creature crate to tame another: it goes into the crate.', refused ?? 'allowed');
const crate = game.inventory.add(CREATURE_CRATE, { ql: 30 });
check('and allowed with one', (act('tame').check?.(at(second), game) ?? null) === null);
act('tame').perform(at(second), game);
check('and goes into the crate', second.mode === 'stored' && crate.creature === second.id, `${second.mode}, crate holds ${crate.creature}`);

const held: Target = { kind: 'item', uid: crate.uid };
const offered = game.actionsFor(held).map((a) => a.def.id);
check('an occupied crate is not offered to be dropped or put away', !offered.includes('drop') && !offered.includes('stow_item'), offered.join(','));
check('and says why when asked', occupiedRefusal(game, 'drop', held) === 'Rabba is in that crate. A crate with a wildermon in it can be carried, set down or opened, and nothing else.');
check('nothing takes it out of the pack', game.inventory.take(crate.uid) === null);

// Set down beside you, on the first spot that will have it.
let spot: Target | null = null;
for (let dy = -1; dy <= 1 && !spot; dy++) {
  for (let dx = -1; dx <= 1 && !spot; dx++) {
    const t: Target = { kind: 'tile', x: game.player.tileX + dx, y: game.player.tileY + dy, sx: 0, sy: 0, itemUid: crate.uid, facing: 's' } as Target;
    if (!act('place_furniture').check?.(t, game)) spot = t;
  }
}
act('place_furniture').perform(spot!, game);
const piece = [...game.furniture.values()].find((f) => f.kind === CREATURE_CRATE);
check('set down, the crate stands with the wildermon in it', piece?.creature === second.id && !game.inventory.get(crate.uid), `holds ${piece?.creature}`);
const cx = piece ? piece.x + (piece.sx + 1) / 4 : 0;
const cy = piece ? piece.y + (piece.sy + 1) / 4 : 0;
check('and the wildermon stands where the crate does', Math.hypot(second.x - cx, second.y - cy) < 0.01, `${second.x.toFixed(2)},${second.y.toFixed(2)}`);

const standing: Target = { kind: 'furniture', id: piece!.id };
check('the crate offers to let it out to follow you and to work the deed',
  ['crate_follow', 'crate_work', 'pick_up_furniture'].every((id) => game.actionsFor(standing).some((a) => a.def.id === id)));
act('crate_follow').perform(standing, game);
check('opened to follow you, it comes out and the one you had goes in', second.mode === 'active' && first.mode === 'stored' && piece?.creature === first.id,
  `${second.mode}, ${first.mode}, holds ${piece?.creature}`);

act('pick_up_furniture').perform(standing, game);
const back = game.inventory.items.find((it) => it.id === CREATURE_CRATE);
check('picked up, it goes back in the pack with the wildermon in it', !game.furniture.has(piece!.id) && back?.creature === first.id, `holds ${back?.creature}`);

const carried: Target = { kind: 'item', uid: back!.uid };
check('opened to work with no settlement, it is refused', (act('crate_work').check?.(carried, game) ?? null) === 'You have no settlement to set it to work on.');
game.deed = { name: 'Hearth', x: game.player.tileX + 4, y: game.player.tileY + 4, radius: 5, level: 3 };
act('crate_work').perform(carried, game);
check('opened to work the deed, it is a worker', first.mode === 'deed' && back?.creature === undefined, first.mode);
check('Keep at token is gone', !ACTION_BY_ID.has('store_creature'));

// A worker taken off the deed leaves the one following you in its place.
act('take_creature').perform(at(first), game);
check('a worker taken to follow you leaves your companion on the deed in its place', first.mode === 'active' && second.mode === 'deed', `${first.mode}, ${second.mode}`);

// Put into a crate from the menu of the one following you.
check('the one following you goes into an empty crate you carry', (act('crate_creature').check?.(at(first), game) ?? null) === null);
act('crate_creature').perform(at(first), game);
check('and is in it', first.mode === 'stored' && emptyCrate(game) === undefined, first.mode);

// Where a young one goes: where a tamed one goes, and then a crate standing on the settlement.
const born = (): { c: Creature | null; said: string } => {
  const seen = game.log.length;
  second.unborn = { traits: [], sex: 'female' };
  second.due = game.time;
  const c = game.creatures.giveBirth(game, second);
  return { c, said: game.log.slice(seen).map((l) => l.text).find((t) => t.includes('drops a young')) ?? '' };
};
const alone = born();
check('a young one follows you when nothing does', alone.c?.mode === 'active' && alone.said.endsWith('It follows you.'), `${alone.c?.mode}; ${alone.said}`);
const nursery = game.inventory.add(CREATURE_CRATE, { ql: 30 });
let standingSpot: Target | null = null;
for (let dy = -1; dy <= 1 && !standingSpot; dy++) {
  for (let dx = -1; dx <= 1 && !standingSpot; dx++) {
    const t: Target = { kind: 'tile', x: game.player.tileX + dx, y: game.player.tileY + dy, sx: 2, sy: 2, itemUid: nursery.uid, facing: 's' } as Target;
    if (!act('place_furniture').check?.(t, game)) standingSpot = t;
  }
}
act('place_furniture').perform(standingSpot!, game);
const onDeed = [...game.furniture.values()].find((f) => f.kind === CREATURE_CRATE && f.creature === undefined);
const crated2 = born();
check('with one following you and no empty crate in the pack, it goes into an empty crate standing on the settlement',
  crated2.c?.mode === 'stored' && onDeed?.creature === crated2.c.id
  && crated2.said.endsWith(`It goes into the empty creature crate at (${onDeed.x}, ${onDeed.y}) on Hearth.`), `${crated2.c?.mode}; ${crated2.said}`);
const spare = game.inventory.add(CREATURE_CRATE, { ql: 30 });
const packed2 = born();
check('an empty crate in the pack comes before one standing on the settlement', packed2.c?.mode === 'stored' && spare.creature === packed2.c.id,
  `${packed2.c?.mode}; ${packed2.said}`);
const lost = born();
check('and with none of those, it goes off into the wild', lost.c?.mode === 'wild'
  && lost.said.endsWith('Something already follows you and there is no empty creature crate in your pack or standing on your settlement, so it goes off into the wild.'),
  `${lost.c?.mode}; ${lost.said}`);

// An old save's wildermon kept at the token.
const kept = beside();
kept.mode = 'stored';
const crated = crateTheKept(game);
const keptIn = [...game.furniture.values()].find((f) => f.kind === CREATURE_CRATE && f.creature === kept.id);
check('a wildermon kept at the token in an old save is put in a crate beside the token', crated === 1 && !!keptIn
  && Math.max(Math.abs(keptIn.x - game.deed.x), Math.abs(keptIn.y - game.deed.y)) <= 1, `${crated} crated`);

/* ---- the island ------------------------------------------------------------ */

const isle = psql(`
begin;
create temp table said (k text);
do $b$
declare w uuid; me uuid; v_x double precision; v_y double precision; v_first int; v_second int; v_third int;
        v_crate bigint; v_placed bigint; v_tries int; v_spot record; v_young int; v_seen jsonb;
begin
  select id into w from world where name = 'Hoarding';
  select uid into me from player where world_id = w and name = 'Dane';
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  update player set act = null, act_queue = '[]'::jsonb where world_id = w and uid = me;
  select x, y into v_x, v_y from player where world_id = w and uid = me;
  update creature set mode = 'wild', keeper = null where world_id = w and keeper = me and mode in ('active', 'stored', 'deed');
  delete from item where world_id = w and holder = 'player' and holder_uid = me and def = 'creature_crate';
  -- Work enough for what is below, so nothing is refused for want of it.
  update deed set level = 5 where world_id = w and founded_by = me;
  insert into said values ('DEED|' || (my_deed(w, me)).name);
  perform give(w, me, 'potato', 80, 30);
  insert into skill (world_id, uid, id, value) values (w, me, 'taming', 90)
    on conflict (world_id, uid, id) do update set value = 90;
  v_first := creature_spawn(w, 'rabba', v_x + 0.3, v_y, 'wild', now() - interval '3 hours');
  v_second := creature_spawn(w, 'rabba', v_x - 0.3, v_y, 'wild', now() - interval '3 hours');

  for v_tries in 1..60 loop
    exit when (select mode from creature where world_id = w and id = v_first) <> 'wild';
    perform act_perform(w, me, 'tame', jsonb_build_object('kind', 'creature', 'id', v_first));
  end loop;
  insert into said values ('FIRST|' || (select mode from creature where world_id = w and id = v_first));
  insert into said values ('NOCRATE|' || coalesce(act_refusal(w, me, 'tame', jsonb_build_object('kind', 'creature', 'id', v_second)), 'allowed'));
  v_crate := give(w, me, 'creature_crate', 1, 30);
  insert into said values ('WITHCRATE|' || coalesce(act_refusal(w, me, 'tame', jsonb_build_object('kind', 'creature', 'id', v_second)), 'allowed'));
  for v_tries in 1..60 loop
    exit when (select mode from creature where world_id = w and id = v_second) <> 'wild';
    perform act_perform(w, me, 'tame', jsonb_build_object('kind', 'creature', 'id', v_second));
  end loop;
  insert into said values ('CRATED|' || (select mode from creature where world_id = w and id = v_second)
    || ',' || coalesce((select creature from item where id = v_crate) = v_second, false));

  insert into said values ('DROP|' || coalesce(act_refusal(w, me, 'drop', jsonb_build_object('kind', 'item', 'uid', v_crate)), 'allowed'));
  begin
    update item set holder = 'ground', holder_uid = null, gx = floor(v_x)::int, gy = floor(v_y)::int where id = v_crate;
    insert into said values ('STAYS|moved');
  exception when others then
    insert into said values ('STAYS|' || sqlerrm);
  end;

  select * into v_spot from crate_spot_near(w, floor(v_x)::int, floor(v_y)::int, 2);
  insert into said values ('PLACEOK|' || coalesce(act_refusal(w, me, 'place_furniture', jsonb_build_object('kind', 'tile',
    'x', v_spot.x, 'y', v_spot.y, 'sx', v_spot.sx, 'sy', v_spot.sy, 'itemUid', v_crate, 'facing', 's')), 'allowed'));
  perform act_perform(w, me, 'place_furniture', jsonb_build_object('kind', 'tile',
    'x', v_spot.x, 'y', v_spot.y, 'sx', v_spot.sx, 'sy', v_spot.sy, 'itemUid', v_crate, 'facing', 's'));
  select id into v_placed from placed where world_id = w and sub = 'creature_crate' and creature = v_second;
  insert into said values ('PLACED|' || (v_placed is not null) || ',' || (not exists (select 1 from item where id = v_crate))
    || ',' || coalesce((select round(sqrt((creature_x(c) - pl.cx) ^ 2 + (creature_y(c) - pl.cy) ^ 2)::numeric, 2)::text
                        from creature c, placed pl where c.world_id = w and c.id = v_second and pl.id = v_placed), 'none'));
  v_seen := rpc_ground(w, 20, false);
  insert into said values ('GROUND|' || coalesce((select (e->>'creature') from jsonb_array_elements(v_seen->'placed') e
                                                   where (e->>'id')::bigint = v_placed), 'none'));

  insert into said values ('FOLLOWOK|' || coalesce(act_refusal(w, me, 'crate_follow', jsonb_build_object('kind', 'furniture', 'id', v_placed)), 'allowed'));
  perform act_perform(w, me, 'crate_follow', jsonb_build_object('kind', 'furniture', 'id', v_placed));
  insert into said values ('SWAP|' || (select mode from creature where world_id = w and id = v_second)
    || ',' || (select mode from creature where world_id = w and id = v_first)
    || ',' || coalesce((select creature from placed where id = v_placed) = v_first, false));

  perform act_perform(w, me, 'pick_up_furniture', jsonb_build_object('kind', 'furniture', 'id', v_placed));
  select id into v_crate from item where world_id = w and holder = 'player' and holder_uid = me and def = 'creature_crate';
  insert into said values ('PICKED|' || (not exists (select 1 from placed where id = v_placed))
    || ',' || coalesce((select creature from item where id = v_crate) = v_first, false));

  insert into said values ('WORKOK|' || coalesce(act_refusal(w, me, 'crate_work', jsonb_build_object('kind', 'item', 'uid', v_crate)), 'allowed'));
  perform act_perform(w, me, 'crate_work', jsonb_build_object('kind', 'item', 'uid', v_crate));
  insert into said values ('WORK|' || (select mode || ',' || coalesce(job, 'none') from creature where world_id = w and id = v_first)
    || ',' || ((select creature from item where id = v_crate) is null));
  insert into said values ('STORE|' || coalesce(act_refusal(w, me, 'store_creature', jsonb_build_object('kind', 'creature', 'id', v_second)), 'allowed'));

  -- A third following him, and the worker taken off the deed.
  v_third := creature_spawn(w, 'rabba', v_x, v_y + 0.3, 'active', now() - interval '3 hours', me);
  update creature set mode = 'stored' where world_id = w and id = v_second;
  insert into said values ('TAKEOK|' || coalesce(act_refusal(w, me, 'take_creature', jsonb_build_object('kind', 'creature', 'id', v_first)), 'allowed'));
  perform act_perform(w, me, 'take_creature', jsonb_build_object('kind', 'creature', 'id', v_first));
  insert into said values ('TAKE|' || (select mode from creature where world_id = w and id = v_first)
    || ',' || (select mode from creature where world_id = w and id = v_third));

  -- Into the empty crate, and seen from anywhere.
  update creature set mode = 'wild', keeper = null where world_id = w and id = v_second;
  insert into said values ('CRATEOK|' || coalesce(act_refusal(w, me, 'crate_creature', jsonb_build_object('kind', 'creature', 'id', v_first)), 'allowed'));
  perform act_perform(w, me, 'crate_creature', jsonb_build_object('kind', 'creature', 'id', v_first));
  update player set x = v_x + 150, y = v_y + 150 where world_id = w and uid = me;
  insert into said values ('FAR|' || coalesce((select e->>'mode' from jsonb_array_elements(rpc_creatures(w, 40)) e
                                               where (e->>'id')::int = v_first), 'not sent'));
  update player set x = v_x, y = v_y where world_id = w and uid = me;
  -- Out of its crate by any road, and the crate forgets it.
  update creature set mode = 'wild', keeper = null where world_id = w and id = v_first;
  insert into said values ('LEFT|' || ((select creature from item where id = v_crate) is null));

  -- Where a young one goes: nothing follows him now, so the first follows him.
  update creature set unborn = jsonb_build_object('traits', '[]'::jsonb, 'sex', 'female'), due = now() - interval '1 second'
    where world_id = w and id = v_third;
  v_young := give_birth(w, v_third);
  insert into said values ('BORN|' || (select mode || ',' || (keeper = me) from creature where world_id = w and id = v_young));
  insert into said values ('BORNSAID|' || coalesce((select e.text from event e where e.world_id = w and e.uid = me
    and e.text like '%drops a young%' order by e.n desc limit 1), 'nothing'));
  -- Then, with that one following him and his only crate set down on his settlement, into the crate.
  select * into v_spot from crate_spot_near(w, (my_deed(w, me)).x, (my_deed(w, me)).y, (my_deed(w, me)).radius);
  perform act_perform(w, me, 'place_furniture', jsonb_build_object('kind', 'tile',
    'x', v_spot.x, 'y', v_spot.y, 'sx', v_spot.sx, 'sy', v_spot.sy, 'itemUid', v_crate, 'facing', 's'));
  select id into v_placed from placed where world_id = w and sub = 'creature_crate' and made_by = me and creature is null
    order by id desc limit 1;
  update creature set unborn = jsonb_build_object('traits', '[]'::jsonb, 'sex', 'male'), due = now() - interval '1 second'
    where world_id = w and id = v_third;
  v_young := give_birth(w, v_third);
  insert into said values ('NURSERY|' || (select mode from creature where world_id = w and id = v_young)
    || ',' || coalesce((select creature from placed where id = v_placed) = v_young, false));
  insert into said values ('NURSERYSAID|' || coalesce((select e.text from event e where e.world_id = w and e.uid = me
    and e.text like '%drops a young%' order by e.n desc limit 1), 'nothing')
    || '|' || v_spot.x || ',' || v_spot.y);
  -- And with no crate anywhere, into the wild.
  update creature set unborn = jsonb_build_object('traits', '[]'::jsonb, 'sex', 'male'), due = now() - interval '1 second'
    where world_id = w and id = v_third;
  v_young := give_birth(w, v_third);
  insert into said values ('WILD|' || (select mode || ',' || (keeper is null) from creature where world_id = w and id = v_young));
end $b$;
select string_agg(k, E'\\n') from said;
rollback;
`);
const said = (key: string): string => isle.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? '(nothing)';

console.log('--- the island');
check('the first one tamed follows you', said('FIRST') === 'active', said('FIRST'));
check('the next is refused without a crate, in the browser\'s words', said('NOCRATE') === refused, said('NOCRATE'));
check('and allowed with one', said('WITHCRATE') === 'allowed', said('WITHCRATE'));
check('and goes into the crate', said('CRATED') === 'stored,true', said('CRATED'));
check('an occupied crate is not dropped, in the browser\'s words',
  said('DROP') === 'Rabba is in that crate. A crate with a wildermon in it can be carried, set down or opened, and nothing else.', said('DROP'));
check('and nothing moves it anywhere else, past any door', said('STAYS') === 'A creature crate with a wildermon in it is carried or set down, and nothing else.', said('STAYS'));
check('it may be set down', said('PLACEOK') === 'allowed', said('PLACEOK'));
check('set down, it stands with the wildermon in it, which stands where it does', said('PLACED') === 'true,true,0.00', said('PLACED'));
check('and the ground the browser is sent says who is in it', said('GROUND') !== 'none' && said('GROUND') !== '', said('GROUND'));
check('opened to follow you, it comes out and the one you had goes in', said('FOLLOWOK') === 'allowed' && said('SWAP') === 'active,stored,true', `${said('FOLLOWOK')}; ${said('SWAP')}`);
check('picked up, it goes back in the pack with the wildermon in it', said('PICKED') === 'true,true', said('PICKED'));
check('opened to work the deed, it is a worker at its trade', said('WORKOK') === 'allowed' && said('WORK') === 'deed,forage,true', `${said('WORKOK')}; ${said('WORK')}`);
check('Keep at token is gone', said('STORE') === 'There is no such thing as store_creature.', said('STORE'));
check('a worker taken to follow you leaves your companion on the deed in its place', said('TAKEOK') === 'allowed' && said('TAKE') === 'active,deed', `${said('TAKEOK')}; ${said('TAKE')}`);
check('the one following you goes into an empty crate you carry', said('CRATEOK') === 'allowed', said('CRATEOK'));
check('your own in a crate come down with the wildlife wherever they are', said('FAR') === 'stored', said('FAR'));
check('out of its crate by any road, the crate forgets it', said('LEFT') === 'true', said('LEFT'));
check('a young one follows its keeper when nothing does, with the keeper\'s name on it', said('BORN') === 'active,true', said('BORN'));
check('and its keeper is told where it went', said('BORNSAID').endsWith('It follows you.'), said('BORNSAID'));
const [nurserySaid, nurseryAt] = said('NURSERYSAID').split('|');
const [nx, ny] = (nurseryAt ?? ',').split(',');
check('with one following and no empty crate in the pack, it goes into an empty crate standing on the settlement', said('NURSERY') === 'stored,true', said('NURSERY'));
check('in the browser\'s words', nurserySaid.endsWith(`It goes into the empty creature crate at (${nx}, ${ny}) on ${said('DEED')}.`), nurserySaid);
check('and with none of those, it goes off into the wild, nobody\'s', said('WILD') === 'wild,true', said('WILD'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`creature crates — ${ok.length} of ${ok.length}`);
