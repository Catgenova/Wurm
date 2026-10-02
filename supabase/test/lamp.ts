/**
 * A lantern post, on both sides.
 *
 * Asked for: "a timber post with an iron arm and a hanging lantern
 * (carpentry), and a stone pillar with a lantern in its top (masonry). A post
 * takes a fitted lantern and candles as a carried lantern does, is lit and put
 * out, burns its candle down at the lantern's rate, and at night lights the
 * ground round it out to the lantern's reach, for everyone."
 *
 * One post is set down in the browser and one on the island, beside a body
 * with a lantern, two candles and a lit torch, and taken through everything a
 * post does -- each refusal and each sentence held to the same words on both
 * sides, and the state after each step to the same numbers:
 *
 *   * nothing to take down, light, candle or put out before a lantern is in;
 *   * the lantern fitted, and not a second; no light without a candle;
 *   * a candle that burns what it would in that lantern in your hand, and not
 *     a second while the first lasts; not lifted with its lantern in it;
 *   * struck off the torch in hand, and not twice;
 *   * burned down, and dark: nothing to put out and nothing to light, and
 *     with no candle in the pack, what candles are made of -- the carried
 *     lantern's own sentence, off the candle's recipe -- and with a candle
 *     and nothing burning, every burning thing a light is taken off;
 *   * padlocked, the lantern is the key's: without it nothing is fitted,
 *     taken down, put out or given a candle, and the post is not lifted,
 *     and the lock is what is said; a light is anybody's to strike; with
 *     the key, all of it;
 *   * too far off to work it, how far;
 *   * not set down with its arm into a wall, and turned on round past one;
 *   * and no wall planned or raised across a standing post's arm, but for a
 *     waist-high one, which stays under it;
 *   * a second candle, lit and put out, and what was saved said;
 *   * taken down: the lantern back in the pack with the candle it had left;
 *
 * and then what it lights, which is the browser's to draw and see by: at night
 * a circle of the lantern's reach, where the lantern hangs, and the ground
 * round it in sight from far off. And the candle itself, which the island
 * burned two and a half times too fast before this: the same length on both
 * sides at every quality.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on
 * it. The island's half is one transaction, rolled back.
 */
import { execFileSync } from 'node:child_process';
import { Game, DAY_SECONDS } from '../../src/game/game';
import { ACTION_BY_ID } from '../../src/game/actions';
import { candleBurn, lanternReach } from '../../src/game/light';
import {
  burnLamps, LAMP_ARM_CROSSES, LAMP_HAS_ONE, LAMP_INTO_WALL, LAMP_NONE, LAMP_TAKE_FIRST, lampAt, lampFrom, lampReach, lampTooFar, noCandleLine, noFlameLine,
} from '../../src/game/lamps';
import { STORE_REACH } from '../../src/game/crates';
import { furnitureDef } from '../../src/game/furniture';
import { RECIPE_BY_ID } from '../../src/game/recipes';
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
const same = (what: string, mine: string | null | undefined, theirs: string | undefined, want?: string | null): void => {
  const m = mine ?? 'ALLOWED';
  const t = theirs ?? 'MISSING';
  check(what, m === t && (want === undefined || m === (want ?? 'ALLOWED')), `browser "${m}", island "${t}"`);
};

/* ---- the candle, on both sides --------------------------------------------- */
const QLS = [1, 20, 60, 100];
const theirBurn = psql(`select string_agg(round(candle_burn(q)::numeric, 3)::text || '/' || lantern_reach(q), ',' order by q)
  from unnest(array[${QLS.join(', ')}]::double precision[]) q;`);
const mineBurn = QLS.map((q) => `${(Math.round(candleBurn(q) * 1000) / 1000).toFixed(3)}/${lanternReach(q)}`).join(',');
check('a candle lasts as long, and a lantern throws as far, on both sides at every quality', theirBurn === mineBurn,
  `browser ${mineBurn}, island ${theirBurn}`);

/* ---- the two pieces --------------------------------------------------------- */
const post = RECIPE_BY_ID.get('make_lamp_post');
const pillar = RECIPE_BY_ID.get('make_lamp_pillar');
check('a lantern post is carpentry and a lantern pillar masonry, each with an iron arm or cage',
  post?.skill === 'carpentry' && pillar?.skill === 'masonry' && furnitureDef('lamp_post').lamp === 'arm' && furnitureDef('lamp_pillar').lamp === 'top'
  && !!post.inputs.find((i) => i.item === 'ribbon') && !!pillar.inputs.find((i) => i.item === 'ribbon'),
  `${post?.skill}, ${pillar?.skill}`);
const bills = psql(`select string_agg(recipe || ':' || item || 'x' || count, ',' order by recipe, ord)
  from recipe_input where recipe in ('make_lamp_post', 'make_lamp_pillar');`);
const mineBills = [...(post?.inputs ?? []).map((i) => `make_lamp_post:${i.item}x${i.count ?? 1}`),
  ...(pillar?.inputs ?? []).map((i) => `make_lamp_pillar:${i.item}x${i.count ?? 1}`)].sort((a, b) => a.localeCompare(b)).join(',');
check('and they cost the same on both sides', bills.split(',').sort((a, b) => a.localeCompare(b)).join(',') === mineBills, `browser ${mineBills}, island ${bills}`);

/* ---- a post, in the browser -------------------------------------------------- */
const X = 30, Y = 30;
const game = Game.create(4242);
game.player.x = X + 0.5;
game.player.y = Y + 0.5;
const lamp = game.addFurniture('lamp_post', X, Y, 1, 1, 50);
const lantern = game.inventory.add('lantern', { ql: 60 });
game.inventory.add('candle', { count: 2, ql: 30 });
const torch = game.inventory.add('torch', { ql: 40 });
torch.lit = true;
torch.charges = 300;
const target = (extra: Record<string, unknown> = {}) => ({ kind: 'furniture' as const, id: lamp.id, ...extra });
const mineCheck = (id: string, extra: Record<string, unknown> = {}): string | null => ACTION_BY_ID.get(id)?.check?.(target(extra) as never, game) ?? null;
/*
 * Where the wall-and-post case goes: six tiles west of the post, clear of it
 * and of the sight line east of it, raised out of the water and grassed in
 * the browser's world, with the tile north of it for the house.
 */
const LX = X - 6;
for (let x = LX - 1; x <= LX + 2; x++) for (let y = Y - 2; y <= Y + 2; y++) game.world.setHeight(x, y, 40);
for (let x = LX - 1; x <= LX + 1; x++) for (let y = Y - 2; y <= Y + 1; y++) game.world.setTile(x, y, TileType.Grass);
const mineDo = (id: string, extra: Record<string, unknown> = {}): string => {
  game.log.length = 0;
  ACTION_BY_ID.get(id)?.perform?.(target(extra) as never, game);
  return game.log.map((l) => l.text).find((t) => t.startsWith('You ')) ?? 'NOTHING SAID';
};

/* ---- and on the island ------------------------------------------------------- */
const out = psql(`
begin;
create temp table said (k text);
do $b$
declare w uuid; a uuid; b uuid := 'c0ffee00-5e11-4c0e-a111-000000000071'; v_post bigint; v_lantern bigint; v_torch bigint; v_t jsonb; v_row jsonb;
  procedure_said text; v_key bigint; v_lone bigint; v_item bigint;
begin
  select id into w from world where name = 'Hoarding';
  select uid into a from player where world_id = w and name = 'Dane';
  update player set act = null, act_queue = '[]'::jsonb, x = ${X} + 0.5, y = ${Y} + 0.5 where world_id = w and uid = a;
  delete from item where world_id = w and holder = 'player' and holder_uid = a and def in ('lantern', 'candle', 'torch');
  delete from placed where world_id = w and x between ${X - 3} and ${X + 3} and y between ${Y - 3} and ${Y + 3};
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'furniture', 'lamp_post', ${X}, ${Y}, 1, 1, ${X} + 0.375, ${Y} + 0.375, 50, a) returning id into v_post;
  v_lantern := give(w, a, 'lantern', 1, 60);
  perform give(w, a, 'candle', 2, 30);
  v_torch := give(w, a, 'torch', 1, 40);
  update item set lit = true, lit_at = now(), charges = 300 where id = v_torch;
  v_t := jsonb_build_object('kind', 'furniture', 'id', v_post);

  -- Before a lantern is in.
  insert into said values ('NONE_TAKE|' || coalesce(act_refusal(w, a, 'take_lamp', v_t), 'ALLOWED'));
  insert into said values ('NONE_CANDLE|' || coalesce(act_refusal(w, a, 'candle_lamp', v_t), 'ALLOWED'));
  insert into said values ('NONE_LIGHT|' || coalesce(act_refusal(w, a, 'light_lamp', v_t), 'ALLOWED'));
  insert into said values ('NONE_DOUSE|' || coalesce(act_refusal(w, a, 'douse_lamp', v_t), 'ALLOWED'));

  -- The lantern in, and not a second.
  insert into said values ('FIT_CHECK|' || coalesce(act_refusal(w, a, 'fit_lamp', v_t), 'ALLOWED'));
  delete from event where world_id = w and uid = a;
  perform act_perform(w, a, 'fit_lamp', v_t);
  insert into said values ('FIT_SAID|' || coalesce((select text from event where world_id = w and uid = a and kind = 'event' order by n desc limit 1), 'NOTHING SAID'));
  insert into said values ('FIT_STATE|' || (select coalesce(state->'lamp'->>'ql', 'none') || ',' || placed_fuel(p) || ',' || placed_lit(p) from placed p where id = v_post)
    || ',' || (select count(*) from item where id = v_lantern));
  insert into said values ('FIT_AGAIN|' || coalesce(act_refusal(w, a, 'fit_lamp', v_t), 'ALLOWED'));
  insert into said values ('LIGHT_DRY|' || coalesce(act_refusal(w, a, 'light_lamp', v_t), 'ALLOWED'));

  -- A candle, and not a second while it lasts; not lifted with the lantern in.
  delete from event where world_id = w and uid = a;
  perform act_perform(w, a, 'candle_lamp', v_t);
  insert into said values ('CANDLE_SAID|' || coalesce((select text from event where world_id = w and uid = a and kind = 'event' order by n desc limit 1), 'NOTHING SAID'));
  insert into said values ('CANDLE_AGAIN|' || coalesce(act_refusal(w, a, 'candle_lamp', v_t), 'ALLOWED'));
  insert into said values ('LIFT|' || coalesce(act_refusal(w, a, 'pick_up_furniture', v_t), 'ALLOWED'));

  -- Struck off the torch, and not twice.
  insert into said values ('LIGHT_CHECK|' || coalesce(act_refusal(w, a, 'light_lamp', v_t), 'ALLOWED'));
  delete from event where world_id = w and uid = a;
  perform act_perform(w, a, 'light_lamp', v_t);
  insert into said values ('LIGHT_SAID|' || coalesce((select text from event where world_id = w and uid = a and kind = 'event' order by n desc limit 1), 'NOTHING SAID'));
  insert into said values ('LIGHT_AGAIN|' || coalesce(act_refusal(w, a, 'light_lamp', v_t), 'ALLOWED'));
  insert into said values ('LIT_STATE|' || (select round(placed_fuel(p)) || ',' || placed_lit(p) from placed p where id = v_post));

  -- Padlocked, without the key and then with it: asked by somebody who has founded nothing here, since a
  -- founder's deed opens every lock on it, and Dane's may have come to cover this spot by now.
  insert into player (world_id, uid, name, x, y) values (w, b, 'Bryn', ${X} + 0.5, ${Y} + 0.5)
    on conflict (world_id, uid) do update set x = excluded.x, y = excluded.y;
  delete from deed where world_id = w and founded_by = b;
  update placed set lock = 77 where id = v_post;
  insert into said values ('LOCK|' || (select string_agg(coalesce(act_refusal(w, b, x, v_t), 'ALLOWED'), ';' order by n)
    from (values (1, 'take_lamp'), (2, 'douse_lamp'), (3, 'candle_lamp'), (4, 'fit_lamp'), (5, 'light_lamp'), (6, 'pick_up_furniture')) v(n, x)));
  v_key := give(w, b, 'key', 1, 30);
  update item set keyed = 77 where id = v_key;
  insert into said values ('KEY|' || (select string_agg(coalesce(act_refusal(w, b, x, v_t), 'ALLOWED'), ';' order by n)
    from (values (1, 'take_lamp'), (2, 'douse_lamp'), (3, 'candle_lamp'), (4, 'fit_lamp'), (5, 'light_lamp'), (6, 'pick_up_furniture')) v(n, x)));
  delete from item where id = v_key;
  update placed set lock = null where id = v_post;

  -- Too far off to work it.
  update player set x = ${X} + 4.5 where world_id = w and uid = a;
  insert into said values ('FAR|' || coalesce(act_refusal(w, a, 'douse_lamp', v_t), 'ALLOWED'));
  update player set x = ${X} + 0.5 where world_id = w and uid = a;

  -- What a ground read sends of it: its lantern, its candle and whether it burns.
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  select r into v_row from jsonb_array_elements(rpc_ground(w, 40, false)->'placed') r where (r->>'id')::bigint = v_post;
  insert into said values ('GROUND|' || coalesce(v_row::text, '{}'));

  -- Burned down: an hour and more on, and dark.
  update placed set since = now() - interval '5000 seconds' where id = v_post;
  insert into said values ('BURNT|' || (select round(placed_fuel(p)) || ',' || placed_lit(p) from placed p where id = v_post));
  insert into said values ('BURNT_DOUSE|' || coalesce(act_refusal(w, a, 'douse_lamp', v_t), 'ALLOWED'));
  insert into said values ('BURNT_LIGHT|' || coalesce(act_refusal(w, a, 'light_lamp', v_t), 'ALLOWED'));
  -- With no candle in the pack either, it says what candles are made of; then one back.
  delete from item where world_id = w and holder = 'player' and holder_uid = a and def = 'candle';
  insert into said values ('NO_CANDLE|' || coalesce(act_refusal(w, a, 'candle_lamp', v_t), 'ALLOWED'));
  perform give(w, a, 'candle', 1, 30);

  -- The second candle; with the torch out there is nothing to strike a light off. Then lit, and put out again straight away.
  perform act_perform(w, a, 'candle_lamp', v_t);
  update item set lit = false where id = v_torch;
  insert into said values ('NO_FLAME|' || coalesce(act_refusal(w, a, 'light_lamp', v_t), 'ALLOWED'));
  update item set lit = true, lit_at = now() where id = v_torch;
  perform act_perform(w, a, 'light_lamp', v_t);
  delete from event where world_id = w and uid = a;
  perform act_perform(w, a, 'douse_lamp', v_t);
  insert into said values ('DOUSE_SAID|' || coalesce((select text from event where world_id = w and uid = a and kind = 'event' order by n desc limit 1), 'NOTHING SAID'));
  insert into said values ('STILL_IN|' || coalesce(act_refusal(w, a, 'candle_lamp', v_t), 'ALLOWED'));

  -- Down again: the lantern back, with the candle it had left.
  delete from event where world_id = w and uid = a;
  perform act_perform(w, a, 'take_lamp', v_t);
  insert into said values ('TAKE_SAID|' || coalesce((select text from event where world_id = w and uid = a and kind = 'event' order by n desc limit 1), 'NOTHING SAID'));
  insert into said values ('BACK|' || (select ql || ',' || charges || ',' || lit from item where world_id = w and holder = 'player' and holder_uid = a and def = 'lantern' order by id desc limit 1)
    || ',' || (select (state ? 'lamp') || ',' || fuel || ',' || lit from placed where id = v_post));
  insert into said values ('LIFT_EMPTY|' || coalesce(act_refusal(w, a, 'pick_up_furniture', v_t), 'ALLOWED'));

  -- A carried lantern with no candle for it says what the post says.
  delete from item where world_id = w and holder = 'player' and holder_uid = a and def = 'candle';
  update item set charges = 0, lit = false where world_id = w and holder = 'player' and holder_uid = a and def = 'lantern';
  insert into said values ('CARRIED_CANDLE|' || coalesce(act_refusal(w, a, 'candle_lantern', jsonb_build_object('kind', 'item',
    'uid', (select id from item where world_id = w and holder = 'player' and holder_uid = a and def = 'lantern' order by id desc limit 1))), 'ALLOWED'));

  -- A wall along the north edge of the tile beside it, a house's south wall: a post on that edge faces any way but into it.
  delete from wall where world_id = w and x between ${LX - 1} and ${LX + 1} and y between ${Y - 1} and ${Y + 1};
  delete from building_tile where world_id = w and x between ${LX - 1} and ${LX + 1} and y between ${Y - 2} and ${Y + 1};
  insert into building (world_id, id, name, levels, work_level, planned_by) values (w, 94, 'Lamp house', 1, 0, a);
  insert into building_tile (world_id, building, x, y) values (w, 94, ${LX}, ${Y - 1});
  insert into wall (world_id, level, dir, x, y, building, type, material, needed, total, planned_by)
    values (w, 0, 'h', ${LX}, ${Y}, 94, 'solid', 'plank', '{"plank":0}', '{"plank":24}', a);
  update player set x = ${LX} + 0.5, y = ${Y} + 0.5 where world_id = w and uid = a;
  v_item := give(w, a, 'lamp_post', 1, 40);
  insert into said values ('PLACE|' || (select string_agg(coalesce(act_refusal(w, a, 'place_furniture', jsonb_build_object('kind', 'item', 'uid', v_item,
      'x', ${LX}, 'y', ${Y}, 'sx', sx, 'sy', sy, 'facing', f)), 'ALLOWED'), ';' order by n)
    from (values (1, 1, 0, 'n'), (2, 1, 0, 'e'), (3, 1, 1, 'n'), (4, 0, 0, 'w'), (5, 1, 0, 's')) v(n, sx, sy, f)));
  -- Set down facing west on that edge, and turned: on round past north to east.
  perform act_perform(w, a, 'place_furniture', jsonb_build_object('kind', 'item', 'uid', v_item, 'x', ${LX}, 'y', ${Y}, 'sx', 1, 'sy', 0, 'facing', 'w'));
  select id into v_lone from placed where world_id = w and kind = 'furniture' and sub = 'lamp_post' and x = ${LX} and y = ${Y};
  insert into said values ('TURN_CHECK|' || coalesce(act_refusal(w, a, 'turn_furniture', jsonb_build_object('kind', 'furniture', 'id', v_lone)), 'ALLOWED'));
  perform act_perform(w, a, 'turn_furniture', jsonb_build_object('kind', 'furniture', 'id', v_lone));
  insert into said values ('TURNED|' || (select facing from placed where id = v_lone));

  -- A wall planned after a post stands, across its arm: the wall comes down again, the post is set facing it.
  delete from wall where world_id = w and level = 0 and dir = 'h' and x = ${LX} and y = ${Y};
  update placed set facing = 'n', sx = 1, sy = 0, cx = ${LX} + 0.375, cy = ${Y} + 0.125 where id = v_lone;
  perform give(w, a, 'mallet', 1, 40);
  insert into said values ('WALLS|' || coalesce(build_refusal(w, a, 'plan_wall',
      jsonb_build_object('x', ${LX}, 'y', ${Y - 1}, 'side', 's', 'wallType', 'solid', 'material', 'plank')), 'ALLOWED')
    || ';' || coalesce(build_refusal(w, a, 'plan_wall',
      jsonb_build_object('x', ${LX}, 'y', ${Y - 1}, 'side', 's', 'wallType', 'half_wall', 'material', 'plank')), 'ALLOWED'));
  -- Planned before the rule stood, it is not raised either; turned along the wall, the post lets it go up.
  insert into wall (world_id, level, dir, x, y, building, type, material, needed, total, planned_by)
    values (w, 0, 'h', ${LX}, ${Y}, 94, 'solid', 'plank', '{"plank":24}', '{"plank":24}', a);
  perform give(w, a, 'plank', 30, 30);
  insert into said values ('RAISE|' || coalesce(build_refusal(w, a, 'build_wall', jsonb_build_object('x', ${LX}, 'y', ${Y - 1}, 'side', 's')), 'ALLOWED'));
  update placed set facing = 'e' where id = v_lone;
  insert into said values ('RAISE_TURNED|' || coalesce(build_refusal(w, a, 'build_wall', jsonb_build_object('x', ${LX}, 'y', ${Y - 1}, 'side', 's')), 'ALLOWED'));
end $b$;
select k from said;
rollback;
`);
const said = (key: string): string => out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

same('before a lantern is in there is nothing to take down', mineCheck('take_lamp'), said('NONE_TAKE'), LAMP_NONE);
same('nothing to put a candle in', mineCheck('candle_lamp'), said('NONE_CANDLE'), LAMP_NONE);
same('nothing to light', mineCheck('light_lamp'), said('NONE_LIGHT'), LAMP_NONE);
same('and nothing to put out', mineCheck('douse_lamp'), said('NONE_DOUSE'), 'It is not lit.');

same('the lantern goes in', mineCheck('fit_lamp'), said('FIT_CHECK'), null);
same('said the same way on both sides', mineDo('fit_lamp'), said('FIT_SAID'));
check('and it is in the post, out of the pack, dark, with no candle, on both sides',
  `${lamp.lamp?.ql},${lamp.fuel},${!!lamp.lit},${game.inventory.get(lantern.uid) ? 1 : 0}` === said('FIT_STATE'),
  `browser ${lamp.lamp?.ql},${lamp.fuel},${!!lamp.lit}, island ${said('FIT_STATE')}`);
same('and not a second', mineCheck('fit_lamp'), said('FIT_AGAIN'), LAMP_HAS_ONE);
same('it will not light without a candle', mineCheck('light_lamp'), said('LIGHT_DRY'), 'There is no candle in it.');

same('a candle goes in, and burns what it would in that lantern in the hand', mineDo('candle_lamp'), said('CANDLE_SAID'));
check('which is the lantern\'s own candle', lamp.fuel === Math.round(candleBurn(60)), `${lamp.fuel} against ${Math.round(candleBurn(60))}`);
same('and not a second while it lasts', mineCheck('candle_lamp'), said('CANDLE_AGAIN'), 'There is still a candle in it.');
same('a post is not lifted with its lantern in it', ACTION_BY_ID.get('pick_up_furniture')?.check?.(target() as never, game) ?? null, said('LIFT'), LAMP_TAKE_FIRST);

same('it is lit off the torch in hand', mineCheck('light_lamp'), said('LIGHT_CHECK'), null);
same('said the same way on both sides', mineDo('light_lamp'), said('LIGHT_SAID'));
same('and not lit twice', mineCheck('light_lamp'), said('LIGHT_AGAIN'), 'It is already lit.');
check('alight, with the whole candle in it, on both sides', `${Math.round(lamp.fuel ?? 0)},${!!lamp.lit}` === said('LIT_STATE'),
  `browser ${Math.round(lamp.fuel ?? 0)},${!!lamp.lit}, island ${said('LIT_STATE')}`);

/* ---- padlocked: the lantern is the key's ------------------------------------------ */
{
  const jobs = ['take_lamp', 'douse_lamp', 'candle_lamp', 'fit_lamp', 'light_lamp', 'pick_up_furniture'];
  const asked = (): string => jobs.map((id) => ACTION_BY_ID.get(id)?.check?.(target() as never, game) ?? 'ALLOWED').join(';');
  lamp.lock = 77;
  const locked = asked();
  const key = game.inventory.add('key', { ql: 30 });
  key.keyed = 77;
  const keyed = asked();
  game.inventory.remove(key.uid, 1);
  delete lamp.lock;
  const shut = 'It is locked, and you have no key to it.';
  check('padlocked, without its key nothing is taken down, put out, given a candle, fitted or lifted, and the lock is what is said; a light is anybody\'s to strike, on both sides',
    locked === said('LOCK') && locked === [shut, shut, shut, shut, 'It is already lit.', shut].join(';'),
    `browser ${locked}\n       island  ${said('LOCK')}`);
  check('and with the key, all of it, the post still not lifted with its lantern in, on both sides',
    keyed === said('KEY') && keyed === ['ALLOWED', 'ALLOWED', 'There is still a candle in it.', LAMP_HAS_ONE, 'It is already lit.', LAMP_TAKE_FIRST].join(';'),
    `browser ${keyed}\n       island  ${said('KEY')}`);
}
{
  game.player.x = X + 4.5;
  same(`too far off to work it, how far: ${STORE_REACH} tiles`, mineCheck('douse_lamp'), said('FAR'), lampTooFar('lantern post'));
  game.player.x = X + 0.5;
}

/* What a browser on the island is told of it, and makes of that. */
{
  const row = JSON.parse(said('GROUND')) as { state?: unknown; fuel?: number; lit?: boolean; sub?: string };
  const seen = { ...lamp, ...lampFrom(row.state), fuel: row.fuel, lit: row.lit };
  check('a browser is sent the lantern in it, its candle and that it burns, and throws what it throws',
    row.sub === 'lamp_post' && seen.lamp?.ql === 60 && !!row.lit && lampReach(seen) === lanternReach(60) && Math.round(row.fuel ?? 0) === Math.round(lamp.fuel ?? 0),
    `sub ${row.sub}, ql ${seen.lamp?.ql}, lit ${row.lit}, reach ${lampReach(seen)}, fuel ${row.fuel}`);
}

/* ---- what it lights, which is the browser's to draw and see by --------------- */
{
  game.time = 0; // midnight
  const light = game.lights().find((l) => Math.abs(l.x - lampAt(lamp)[0]) < 1e-9 && Math.abs(l.y - lampAt(lamp)[1]) < 1e-9);
  check(`at night it throws a circle of its lantern's reach, ${lanternReach(60)} tiles, from under the lantern on its arm`,
    !!light && light.radius === lanternReach(60) && lampAt(lamp)[1] > lamp.y + 0.375,
    light ? `radius ${light.radius} at ${light.x.toFixed(3)},${light.y.toFixed(3)}` : 'no light');
  // And somebody a long way off in the dark sees the ground round it.
  game.settings.fog = true;
  game.player.x = X + 30.5;
  game.player.y = Y + 0.5;
  const reach = lanternReach(60);
  const [lx, ly] = lampAt(lamp);
  const edge = { x: Math.floor(lx + reach - 1), y: Math.floor(ly) };
  game.vision.invalidate();
  game.vision.update();
  const litSeen = game.vision.isVisible(edge.x, edge.y);
  lamp.lit = false;
  game.vision.invalidate();
  game.vision.update();
  const darkSeen = game.vision.isVisible(edge.x, edge.y);
  lamp.lit = true;
  check('and from thirty tiles off in the dark, the ground at the edge of its reach is in sight while it burns and not once it is out',
    litSeen && !darkSeen, `lit ${litSeen}, out ${darkSeen}`);
  game.player.x = X + 0.5;
  game.player.y = Y + 0.5;
  game.time = DAY_SECONDS / 2;
  check('and by day it throws nothing: the sun is up', !game.lights().some((l) => l.radius === lanternReach(60)), 'noon');
}

/* ---- burned down, and dark ------------------------------------------------------ */
game.log.length = 0;
burnLamps(game, 5000, true);
check('an hour and more on, the candle is burned down and it is dark, on both sides',
  `${Math.round(lamp.fuel ?? 0)},${!!lamp.lit}` === said('BURNT') && said('BURNT') === '0,false', `browser ${Math.round(lamp.fuel ?? 0)},${!!lamp.lit}, island ${said('BURNT')}`);
check('and the browser says so', game.log.some((l) => l.text === 'The candle gutters out and the lantern on the lantern post goes dark.'), game.log.map((l) => l.text).join(' | '));
same('there is nothing to put out', mineCheck('douse_lamp'), said('BURNT_DOUSE'), 'It is not lit.');
same('nor anything to light', mineCheck('light_lamp'), said('BURNT_LIGHT'), 'There is no candle in it.');
{
  const left = game.inventory.find('candle');
  if (left) game.inventory.remove(left.uid, left.count);
  same('with no candle in the pack either, it says what candles are made of, off their recipe', mineCheck('candle_lamp'), said('NO_CANDLE'), noCandleLine());
  check('which is what the carried lantern says', noCandleLine() === 'You have no candles. Two are drawn from two beeswax and a yarn.', noCandleLine());
  game.inventory.add('candle', { count: 1, ql: 30 });
}

mineDo('candle_lamp');
torch.lit = false;
same('with a candle in and nothing burning, it says every burning thing a light is taken off', mineCheck('light_lamp'), said('NO_FLAME'), noFlameLine());
check('a brazier and a lantern post among them', /brazier/.test(noFlameLine()) && /lantern post/.test(noFlameLine()), noFlameLine());
torch.lit = true;
mineDo('light_lamp');
same('a second candle, lit and put out: what was saved is said the same way', mineDo('douse_lamp'), said('DOUSE_SAID'));
same('and what is left of that candle is still a candle: not another on top of it', mineCheck('candle_lamp'), said('STILL_IN'), 'There is still a candle in it.');

same('taken down', mineDo('take_lamp'), said('TAKE_SAID'));
const back = game.inventory.items.find((it) => it.id === 'lantern');
check('the lantern is back in the pack with the candle it had left, dark, and the post empty, on both sides',
  `${back?.ql},${back?.charges},${!!back?.lit},${!!lamp.lamp},${lamp.fuel},${!!lamp.lit}` === said('BACK'),
  `browser ${back?.ql},${back?.charges},${!!back?.lit},${!!lamp.lamp},${lamp.fuel},${!!lamp.lit}, island ${said('BACK')}`);
same('and the post lifts once its lantern is down', ACTION_BY_ID.get('pick_up_furniture')?.check?.(target() as never, game) ?? null, said('LIFT_EMPTY'), null);
{
  const carried = game.inventory.items.find((it) => it.id === 'lantern');
  for (const c of game.inventory.items.filter((it) => it.id === 'candle')) game.inventory.remove(c.uid, c.count);
  if (carried) { carried.charges = 0; carried.lit = false; }
  same('a carried lantern with no candle says the same', carried ? ACTION_BY_ID.get('candle_lantern')?.check?.({ kind: 'item', uid: carried.uid } as never, game) ?? null : 'NO LANTERN',
    said('CARRIED_CANDLE'), noCandleLine());
}

/* ---- its arm, and the wall beside it ------------------------------------------------- */
{
  // A house on the tile north of (LX, Y): its south wall is the north edge of the tile the post goes on.
  const house = game.buildings.create('Lamp house', LX, Y - 1);
  game.buildings.setWall(house, 0, LX, Y - 1, 's', 'solid', 'plank');
  game.player.x = LX + 0.5;
  game.player.y = Y + 0.5;
  const item = game.inventory.add('lamp_post', { ql: 40 });
  const place = ACTION_BY_ID.get('place_furniture');
  const at = (sx: number, sy: number, facing: string): string =>
    place?.check?.({ kind: 'tile', x: LX, y: Y, cx: LX, cy: Y, itemUid: item.uid, sx, sy, facing } as never, game) ?? 'ALLOWED';
  const mine = [at(1, 0, 'n'), at(1, 0, 'e'), at(1, 1, 'n'), at(0, 0, 'w'), at(1, 0, 's')].join(';');
  check('a post on the edge of a wall is not set down with its arm into it, and is any other way, nor one a subtile further off, on both sides',
    mine === said('PLACE') && mine === [LAMP_INTO_WALL, 'ALLOWED', 'ALLOWED', 'ALLOWED', 'ALLOWED'].join(';'), `browser ${mine}\n       island  ${said('PLACE')}`);
  place?.perform?.({ kind: 'tile', x: LX, y: Y, cx: LX, cy: Y, itemUid: item.uid, sx: 1, sy: 0, facing: 'w' } as never, game);
  const set = [...game.furniture.values()].find((f) => f.kind === 'lamp_post' && f.x === LX && f.y === Y);
  const turn = ACTION_BY_ID.get('turn_furniture');
  const turnCheck = set ? turn?.check?.({ kind: 'furniture', id: set.id } as never, game) ?? 'ALLOWED' : 'NOT SET DOWN';
  if (set) turn?.perform?.({ kind: 'furniture', id: set.id } as never, game);
  same('set down facing west along it, it turns', turnCheck, said('TURN_CHECK'), null);
  check('and on round past north, into the wall, to face east, on both sides', set?.facing === 'e' && said('TURNED') === 'e', `browser ${set?.facing}, island ${said('TURNED')}`);

  // A wall planned after a post stands, across its arm: the wall comes down again, the post is set facing it.
  game.buildings.removeWall(0, LX, Y - 1, 's');
  if (set) { set.facing = 'n'; set.sx = 1; set.sy = 0; }
  game.inventory.add('mallet', { ql: 40 });
  const plan = ACTION_BY_ID.get('plan_wall');
  const planOf = (type: string): string =>
    plan?.check?.({ kind: 'tile', x: LX, y: Y - 1, cx: LX, cy: Y - 1, side: 's', wallType: type, material: 'plank' } as never, game) ?? 'ALLOWED';
  const walls = `${planOf('solid')};${planOf('half_wall')}`;
  check('nor is a wall planned across a standing post\'s arm, though a waist-high one stays under it, on both sides',
    walls === said('WALLS') && walls === `${LAMP_ARM_CROSSES};ALLOWED`, `browser ${walls}\n       island  ${said('WALLS')}`);
  // Planned before the rule stood, it is not raised either; turned along the wall, the post lets it go up.
  game.buildings.setWall(house, 0, LX, Y - 1, 's', 'solid', 'plank');
  game.inventory.add('plank', { count: 30, ql: 30 });
  const build = ACTION_BY_ID.get('build_wall');
  const raise = (): string => build?.check?.({ kind: 'tile', x: LX, y: Y - 1, cx: LX, cy: Y - 1, side: 's' } as never, game) ?? 'ALLOWED';
  const raised = raise();
  if (set) set.facing = 'e';
  const turned = raise();
  check('nor raised, and turned along it the wall goes up, on both sides',
    `${raised};${turned}` === `${said('RAISE')};${said('RAISE_TURNED')}` && raised === LAMP_ARM_CROSSES && turned === 'ALLOWED',
    `browser ${raised};${turned}\n       island  ${said('RAISE')};${said('RAISE_TURNED')}`);
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a lantern post, on both sides — ${ok.length} of ${ok.length}`);
