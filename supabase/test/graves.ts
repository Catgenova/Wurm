/**
 * A grave where you fell.
 *
 * Asked for: dying costs something. What you carry goes into a grave where
 * you fell, only you may open it for an hour of real time, and then it
 * crumbles with whatever is still in it.
 *
 * Asked of both sides, on a strip of dry ground with deep water off it:
 *
 *   * the hour and the reach are the island's numbers too, and said in the
 *     same words; nobody builds a grave;
 *   * a death buries the pack, what is in the hands, the toolbelt and a bag
 *     with what is in it, where the body fell, and says so in the words
 *     asked for; clothing, armour and a jewel stay on, and so does a crate
 *     with a wildermon in it and, on an island, whatever is held in a deal;
 *     a light goes out on the way in;
 *   * in water too deep to stand in the grave is on the nearest dry ground
 *     within reach, and where the body fell when there is none;
 *   * a second death on the same tile digs a second grave beside the first,
 *     and a death carrying nothing digs none;
 *   * its owner takes things out and nothing else; anybody else is told
 *     whose it is, whatever they try, and is not shown what is in it; and
 *     nobody takes a spadeful out of it, as out of any other piece beside you;
 *   * the hour up, it crumbles, takes what is in it and tells its owner;
 *   * it is marked on its owner's map until it goes, and it survives a save.
 *
 * Runs against the database the suite leaves behind: Hoarding. Everything the
 * island half does is rolled back.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID, spoilFrom, type Target } from '../../src/game/actions';
import { Game } from '../../src/game/game';
import { furnitureCovers, furnitureDef, furnitureFootprint, type PlacedFurniture } from '../../src/game/furniture';
import {
  crumbledSaid, deathSaid, GRAVE_KEEPS, GRAVE_MARK, GRAVE_REACH, GRAVE_SHUT, graveNotYours, graveRefusal, isGrave,
} from '../../src/game/graves';
import type { Item } from '../../src/game/items';
import { RECIPE_BY_ID } from '../../src/game/recipes';
import { packLand, packWorld, unpack } from '../../src/game/save';
import { spanWords } from '../../src/game/words';
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

/** The words asked for, as they were asked for. */
const ASKED = 'You have died. What you carried is in a grave where you fell; only you can open it, and it crumbles in an hour.';

/* ---- the rule and its words ---------------------------------------------------- */
console.log('--- the rule');
check('an hour of real time, said as an hour', GRAVE_KEEPS === 3600 && spanWords(GRAVE_KEEPS) === 'an hour', spanWords(GRAVE_KEEPS));
check('the death line is the one asked for, with the hour put in from the rule', deathSaid('here') === ASKED, deathSaid('here'));
check('nobody builds a grave', !RECIPE_BY_ID.has('make_grave') && !!furnitureDef('grave').grave);
const rule = psql(`select grave_keeps() || '|' || grave_keeps_said() || '|' || grave_reach() || '|'
  || (select w || 'x' || h from furniture_def where id = 'grave') || '|' || (select count(*) from recipe where id = 'make_grave');`);
const [w0, h0] = furnitureFootprint('grave');
check('the island keeps the same hour, says it the same way, reaches as far and lays out the same piece, and builds none',
  rule === `${GRAVE_KEEPS}|${spanWords(GRAVE_KEEPS)}|${GRAVE_REACH}|${w0}x${h0}|0`, rule);

/* ---- the browser ------------------------------------------------------------- */
console.log('--- the browser');
const game = Game.create(4242);
const W0 = 110, WY = 103;
// Corners at or west of the line are dry ground and east of it deep water.
for (let x = W0 - 16; x <= W0 + 20; x++) for (let y = WY - 8; y <= WY + 8; y++) game.world.setHeight(x, y, x <= W0 ? 10 : -10);
for (let x = W0 - 16; x < W0; x++) for (let y = WY - 8; y < WY + 8; y++) game.world.setTile(x, y, TileType.Grass);
const die = (): void => (game as unknown as { die(): void }).die();
const said = (): string => game.log[game.log.length - 1]?.text ?? '';
const graves = (): PlacedFurniture[] => [...game.furniture.values()].filter(isGrave);
const at = (x: number, y: number): void => {
  game.player.x = x;
  game.player.y = y;
  game.player.stop();
};
const p = game.player;
const inv = game.inventory;
inv.items.length = 0;
inv.add('plank', { count: 5 });
inv.add('hatchet', { ql: 40 });
const torch = inv.add('torch');
torch.lit = true;
const pack = inv.add('backpack');
pack.inside = [{ uid: inv.nextUid++, id: 'plank', ql: 30, dmg: 0, count: 3 }];
const cap = inv.add('leather_cap');
const ring = inv.add('jewelled_ring');
const sword = inv.add('sword');
const belt = inv.add('toolbelt');
const crate = inv.add('creature_crate');
crate.creature = 77;
p.equipped.head = cap.uid;
p.equipped.jewel = ring.uid;
p.equipped.weapon = sword.uid;
p.equipped.belt = belt.uid;
at(W0 - 5.7, WY + 0.6);
const before = Date.now() / 1000;
die();
const [first] = graves();
const ids = (xs: Item[]): string => xs.map((it) => it.id).sort().join(',');
check('a death leaves one grave, on the tile where the body fell', graves().length === 1 && first.x === W0 - 6 && first.y === WY,
  graves().map((f) => `${f.x},${f.y}`).join(' '));
check('with the pack, the hands, the toolbelt and the bag in it', ids(first.items) === 'backpack,hatchet,plank,sword,toolbelt,torch', ids(first.items));
check('and the bag with what is in it', first.items.find((it) => it.id === 'backpack')?.inside?.[0]?.count === 3);
check('the light put out on the way in', first.items.find((it) => it.id === 'torch')?.lit === false);
check('clothing, armour and a jewel stay on, and so does a crate with a wildermon in it',
  ids(inv.items) === 'creature_crate,jewelled_ring,leather_cap' && p.equipped.head === cap.uid && p.equipped.jewel === ring.uid,
  ids(inv.items));
check('and nothing is in the hands or on the belt', p.equipped.weapon === null && p.equipped.belt === null);
check('it says so in the words asked for', said() === ASKED, said());
check('the body is on the shore it came in on', p.x === game.spawn.x + 0.5 && p.y === game.spawn.y + 0.5, `${p.x},${p.y}`);
check('the grave is its, for an hour of real time', !!first.grave && first.grave.who === game.actor.who
  && Math.abs(first.grave.crumbles - before - GRAVE_KEEPS) < 5, JSON.stringify(first.grave));
const mark = game.marks.find((m) => m.grave === first.id);
check('and marked on the map where it is', !!mark && mark.name === GRAVE_MARK && mark.x === first.x && mark.y === first.y, JSON.stringify(mark));

// What its owner may do, and what not.
const ft: Target = { kind: 'furniture', id: first.id };
const inIt: Target = { kind: 'item', uid: first.items[0].uid, count: first.items[0].count };
check('its owner may take everything, or one thing', graveRefusal(game, 'furniture_take_all', ft) === null && graveRefusal(game, 'take_from_store', inIt) === null);
check('and nothing else: not pick it up, turn it, name it, lock it or put anything in',
  ['pick_up_furniture', 'turn_furniture', 'name_thing', 'fit_lock'].every((id) => graveRefusal(game, id, ft) === GRAVE_SHUT)
    && graveRefusal(game, 'store_in_furniture', { kind: 'item', uid: cap.uid, into: first.id }) === GRAVE_SHUT,
  graveRefusal(game, 'pick_up_furniture', ft) ?? 'ALLOWED');
check('its menu offers nothing it would refuse', game.actionsFor(ft).every((a) => a.def.id === 'furniture_take_all'),
  game.actionsFor(ft).map((a) => a.def.id).join(', '));

// Somebody else's grave.
first.grave!.who = 'somebody-else';
first.grave!.name = 'Dane';
const notYours = graveNotYours('Dane');
check('anybody else is told whose it is, whatever they try',
  ['furniture_take_all', 'pick_up_furniture', 'turn_furniture'].every((id) => graveRefusal(game, id, ft) === notYours)
    && graveRefusal(game, 'take_from_store', inIt) === notYours,
  graveRefusal(game, 'furniture_take_all', ft) ?? 'ALLOWED');
check('in plain words', notYours === "That is Dane's grave. Nobody but Dane can open it, take from it or move it.", notYours);
check('and is offered nothing at it', game.actionsFor(ft).length === 0, game.actionsFor(ft).map((a) => a.def.id).join(', '));
at(first.x + 0.5, first.y + 1.5);
const takeAll = ACTION_BY_ID.get('furniture_take_all')!;
const had = first.items.length;
game.requestAction(takeAll, ft);
check('and asking anyway takes nothing, and says why', first.items.length === had && said() === notYours, said());
first.grave!.who = game.actor.who;
first.grave!.name = p.name;

// Its owner takes everything.
check('its owner, beside it, may take everything', takeAll.check?.(ft, game) === null, takeAll.check?.(ft, game) ?? 'ALLOWED');
takeAll.perform(ft, game);
check('and has it back, the bag with what is in it', !first.items.length
  && ids(inv.items) === 'backpack,creature_crate,hatchet,jewelled_ring,leather_cap,plank,sword,toolbelt,torch'
  && inv.items.find((it) => it.id === 'backpack')?.inside?.[0]?.count === 3, ids(inv.items));
check('the grave stands until its hour is up', game.furniture.has(first.id));

// A second death on the same tile.
for (const it of [...inv.items]) if (it.uid !== cap.uid && it.uid !== ring.uid) inv.remove(it.uid, it.count);
inv.add('plank', { count: 2 });
at(W0 - 5.7, WY + 0.6);
die();
const second = graves().find((f) => f.id !== first.id);
const clash = !!second && [0, 1, 2, 3].some((sx) => [0, 1, 2, 3].some((sy) => furnitureCovers(first, sx, sy) && furnitureCovers(second, sx, sy)));
check('a second death on the same tile digs a second grave beside the first, not into it',
  !!second && second.x === first.x && second.y === first.y && !clash, second ? `${second.sx},${second.sy} beside ${first.sx},${first.sy}` : 'none');

// A spadeful is taken from anything beside you, and not from a grave.
second!.items.push({ uid: inv.nextUid++, id: 'dirt', ql: 20, dmg: 0, count: 2 });
at(second!.x + 0.5, second!.y + 1.5);
const fromGrave = spoilFrom(game, ['dirt']);
const chest = game.addFurniture('chest', second!.x, second!.y + 1, 0, 0, 30, [{ uid: inv.nextUid++, id: 'dirt', ql: 20, dmg: 0, count: 1 }]);
const fromChest = spoilFrom(game, ['dirt']);
game.removeFurniture(chest.id);
second!.items.pop();
check('a spadeful is taken from a chest beside you, and never from a grave', !fromGrave && fromChest?.id === 'dirt',
  `grave ${fromGrave?.id ?? 'none'}, chest ${fromChest?.id ?? 'none'}`);

// Carrying nothing.
const count = graves().length;
at(W0 - 3.5, WY + 3.5);
die();
check('a death carrying nothing but what it wears digs no grave, and says the old words',
  graves().length === count && said() === deathSaid(null), said());

// Deep water, with land in reach and without.
inv.add('hatchet');
at(W0 + 1.5, WY + 0.5);
die();
const shore = graves().find((f) => f.items.some((it) => it.id === 'hatchet'));
check('in water too deep to stand in, the grave is on the nearest dry ground in reach',
  !!shore && !game.world.hasWater(shore.x, shore.y) && Math.abs(shore.x - (W0 + 1)) <= GRAVE_REACH && shore.x === W0 - 1,
  shore ? `${shore.x},${shore.y}` : 'none');
check('and says so', said() === deathSaid('shore'), said());
inv.add('sword');
at(W0 + 10.5, WY + 0.5);
die();
const sunk = graves().find((f) => f.items.some((it) => it.id === 'sword'));
check('with no dry ground in reach, it is where the body fell', !!sunk && sunk.x === W0 + 10 && sunk.y === WY && said() === ASKED,
  sunk ? `${sunk.x},${sunk.y}: ${said()}` : 'none');

// It survives a save, and its hour is still its hour.
const back = await unpack(await packLand(game), JSON.parse(JSON.stringify(packWorld(game))));
const kept = back ? [...back.furniture.values()].filter(isGrave) : [];
const keptShore = kept.find((f) => f.id === shore?.id);
check('the graves come back from a save, with what is in them, whose they are and when they crumble',
  kept.length === graves().length && !!keptShore && ids(keptShore.items) === ids(shore?.items ?? [])
    && keptShore.grave?.crumbles === shore?.grave?.crumbles && keptShore.grave?.who === shore?.grave?.who,
  `${kept.length} of ${graves().length}`);
check('and so do their marks', !!back && back.marks.filter((m) => m.grave !== undefined).length === game.marks.filter((m) => m.grave !== undefined).length);

// The hour up.
shore!.grave!.crumbles = Date.now() / 1000 - 1;
game.update(0.05);
check('its hour up, it crumbles with what is in it', !game.furniture.has(shore!.id));
check('its owner is told what was lost', game.log.some((l) => l.text === crumbledSaid(shore!.x, shore!.y, 1)), crumbledSaid(shore!.x, shore!.y, 1));
check('and the mark comes off the map', !game.marks.some((m) => m.grave === shore!.id));
check('the others stand', graves().length === kept.length - 1, `${graves().length}`);

/* ---- the island ------------------------------------------------------------- */
console.log('--- the island');
const ANNA = 'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1';
const BRAN = 'd2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2';
const isle = psql(`
begin;
create temp table said (k text, v text);
do $$
declare w uuid; v_g bigint; v_g2 bigint; v_cap bigint; v_ring bigint; v_sword bigint; v_belt bigint; v_bag bigint;
        v_torch bigint; v_crate bigint; v_dealt bigint; v_in bigint; t jsonb; v_row jsonb; v_it bigint;
        v_full jsonb := '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb;
begin
  select id into w from world where name = 'Hoarding';
  -- Dry ground west of corner 14, deep water from corner 15 east.
  delete from placed where world_id = w and x between 0 and 30 and y between 38 and 52;
  for i in 0..30 loop
    for j in 38..52 loop
      perform land_set_height(w, i, j, case when i <= 14 then 10 else -10 end);
    end loop;
  end loop;
  for i in 0..13 loop
    for j in 38..51 loop
      perform land_set_tile(w, i, j, tile_id('Grass'));
    end loop;
  end loop;
  delete from player where world_id = w and uid in ('${ANNA}', '${BRAN}');
  insert into player (world_id, uid, name, x, y, stats) values
    (w, '${ANNA}', 'Anna', 8.3, 44.6, v_full), (w, '${BRAN}', 'Bran', 9.5, 45.5, v_full);

  -- What Anna carries, wears, has shut in a crate and has offered in a deal.
  perform give(w, '${ANNA}', 'plank', 5, 30);
  perform give(w, '${ANNA}', 'hatchet', 1, 40);
  v_cap := give(w, '${ANNA}', 'leather_cap', 1, 30);
  v_ring := give(w, '${ANNA}', 'jewelled_ring', 1, 30);
  v_sword := give(w, '${ANNA}', 'sword', 1, 30);
  v_belt := give(w, '${ANNA}', 'toolbelt', 1, 30);
  v_bag := give(w, '${ANNA}', 'backpack', 1, 30);
  insert into item (world_id, holder, holder_uid, inside, def, ql, count)
    values (w, 'bag', '${ANNA}', v_bag, 'plank', 30, 3) returning id into v_in;
  v_torch := give(w, '${ANNA}', 'torch', 1, 30);
  update item set lit = true, lit_at = now() - interval '100 seconds', charges = 600 where id = v_torch;
  insert into item (world_id, holder, holder_uid, def, ql, count, creature)
    values (w, 'player', '${ANNA}', 'creature_crate', 30, 1, 999999) returning id into v_crate;
  insert into item (world_id, holder, holder_uid, def, ql, count, deal)
    values (w, 'player', '${ANNA}', 'hatchet', 55, 1, 999999) returning id into v_dealt;
  update player set equipped = jsonb_build_object('head', v_cap, 'jewel', v_ring, 'weapon', v_sword, 'belt', v_belt)
    where world_id = w and uid = '${ANNA}';

  perform player_die(w, '${ANNA}');
  select id into v_g from placed where world_id = w and made_by = '${ANNA}' and crumbles_at is not null;
  t := jsonb_build_object('kind', 'furniture', 'id', v_g);
  insert into said values ('GRAVE', (select kind || ',' || sub || ',' || x || ',' || y || ','
    || (abs(extract(epoch from (crumbles_at - now())) - grave_keeps()) < 1) from placed where id = v_g));
  insert into said values ('IN', (select string_agg(def, ',' order by def) from item where placed = v_g and holder = 'furniture'));
  insert into said values ('BAG', (select holder || ',' || coalesce(holder_uid::text, 'nobody') || ',' || (inside = v_bag)
    from item where id = v_in));
  insert into said values ('LIGHT', (select lit || ',' || (charges < 600) from item where id = v_torch));
  insert into said values ('KEPT', (select string_agg(def, ',' order by def) from item
    where world_id = w and holder = 'player' and holder_uid = '${ANNA}'));
  insert into said values ('WORN', (select string_agg(k, ',' order by k) from player, jsonb_object_keys(equipped) k
    where world_id = w and uid = '${ANNA}'));
  insert into said values ('SAID', (select text from event where world_id = w and uid = '${ANNA}' order by n desc limit 1));
  insert into said values ('SHORE', (select x || ',' || y from player where world_id = w and uid = '${ANNA}'));

  -- What each of them is shown of it.
  update player set x = 8.5, y = 46.0 where world_id = w and uid = '${ANNA}';
  perform set_config('request.jwt.claims', json_build_object('sub', '${ANNA}')::text, true);
  v_row := rpc_ground(w, 40, true);
  insert into said values ('HERS', (select (e->>'mine') || ',' || jsonb_array_length(e->'things') || ',' || (e->'grave'->>'name')
      || ',' || ((e->'grave'->>'left')::float > grave_keeps() - 5) || ',' || (e ? 'crumbles_at') || ',' || (e->'grave'->>'units')
    from jsonb_array_elements(v_row->'placed') e where (e->>'id')::bigint = v_g));
  insert into said values ('LISTED', (select string_agg((g->>'id') || '@' || (g->>'x') || ',' || (g->>'y'), ' ')
    from jsonb_array_elements(v_row->'graves') g) || '|' || v_g || '@8,44');
  -- Out of reach of what is in it, and still told how much there is.
  update player set x = 8.5, y = 52.0 where world_id = w and uid = '${ANNA}';
  v_row := rpc_ground(w, 40, false);
  insert into said values ('FAR', (select jsonb_array_length(e->'things') || ',' || (e->'grave'->>'units')
    from jsonb_array_elements(v_row->'placed') e where (e->>'id')::bigint = v_g));
  update player set x = 8.5, y = 46.0 where world_id = w and uid = '${ANNA}';
  perform set_config('request.jwt.claims', json_build_object('sub', '${BRAN}')::text, true);
  v_row := rpc_ground(w, 40, true);
  insert into said values ('HIS', (select (e->>'mine') || ',' || jsonb_array_length(e->'things') || ',' || (e->'grave'->>'name')
      || ',' || coalesce(e->'grave'->>'units', 'untold')
    from jsonb_array_elements(v_row->'placed') e where (e->>'id')::bigint = v_g) || '|'
    || jsonb_array_length(v_row->'graves'));

  -- What each of them may do.
  select id into v_it from item where placed = v_g and def = 'plank';
  insert into said values ('B_ALL', coalesce(act_refusal(w, '${BRAN}', 'furniture_take_all', t), 'ALLOWED'));
  insert into said values ('B_ONE', coalesce(act_refusal(w, '${BRAN}', 'take_from_store',
    jsonb_build_object('kind', 'item', 'uid', v_it, 'count', 5)), 'ALLOWED'));
  insert into said values ('B_LIFT', coalesce(act_refusal(w, '${BRAN}', 'pick_up_furniture', t), 'ALLOWED'));
  -- A spadeful is taken from anything beside you, and not from a grave.
  insert into item (world_id, holder, placed, def, ql, count) values (w, 'furniture', v_g, 'dirt', 20, 2);
  insert into said values ('SPADE', coalesce(spoil_near(w, '${BRAN}', null), 'none') || ',' || take_spoil(w, '${BRAN}', 'dirt')
    || ',' || coalesce(spoil_near(w, '${ANNA}', null), 'none') || ',' || take_spoil(w, '${ANNA}', 'dirt')
    || ',' || (select sum(count) from item where placed = v_g and def = 'dirt'));
  delete from item where placed = v_g and def = 'dirt';
  insert into said values ('A_LIFT', coalesce(act_refusal(w, '${ANNA}', 'pick_up_furniture', t), 'ALLOWED'));
  insert into said values ('A_NAME', coalesce(act_refusal(w, '${ANNA}', 'name_thing', t || '{"name":"Mine"}'), 'ALLOWED'));
  insert into said values ('A_PUT', coalesce(act_refusal(w, '${ANNA}', 'store_in_furniture',
    jsonb_build_object('kind', 'item', 'uid', v_cap, 'count', 1, 'into', v_g)), 'ALLOWED'));
  insert into said values ('A_ONE', coalesce(act_refusal(w, '${ANNA}', 'take_from_store',
    jsonb_build_object('kind', 'item', 'uid', v_it, 'count', 5)), 'ALLOWED'));
  insert into said values ('A_ALL', coalesce(act_refusal(w, '${ANNA}', 'furniture_take_all', t), 'ALLOWED'));
  perform act_perform(w, '${ANNA}', 'furniture_take_all', t);
  insert into said values ('BACK', (select count(*) from item where placed = v_g) || ',' || (select string_agg(def, ',' order by def)
    from item where world_id = w and holder = 'player' and holder_uid = '${ANNA}') || ','
    || (select holder || ':' || (holder_uid = '${ANNA}') from item where id = v_in));
  insert into said values ('STANDS', (select count(*) from placed where id = v_g)::text);

  -- A second death on the same tile, then one carrying nothing but what is worn.
  delete from item where world_id = w and holder = 'player' and holder_uid = '${ANNA}' and id not in (v_cap, v_ring);
  perform give(w, '${ANNA}', 'plank', 2, 30);
  update player set x = 8.3, y = 44.6 where world_id = w and uid = '${ANNA}';
  update player set equipped = jsonb_build_object('head', v_cap, 'jewel', v_ring) where world_id = w and uid = '${ANNA}';
  perform player_die(w, '${ANNA}');
  select id into v_g2 from placed where world_id = w and made_by = '${ANNA}' and crumbles_at is not null and id <> v_g;
  insert into said values ('TWO', (select a.x || ',' || a.y || ':' || a.sx || ',' || a.sy || ' ' || b.x || ',' || b.y || ':'
    || b.sx || ',' || b.sy from placed a, placed b where a.id = v_g and b.id = v_g2));
  update player set x = 5.5, y = 47.5 where world_id = w and uid = '${ANNA}';
  perform player_die(w, '${ANNA}');
  insert into said values ('BARE', (select count(*) from placed where world_id = w and made_by = '${ANNA}' and crumbles_at is not null)
    || '|' || (select text from event where world_id = w and uid = '${ANNA}' order by n desc limit 1));

  -- Deep water, with land in reach and without.
  perform give(w, '${ANNA}', 'hatchet', 1, 30);
  update player set x = 15.5, y = 44.5 where world_id = w and uid = '${ANNA}';
  perform player_die(w, '${ANNA}');
  insert into said values ('DRY', (select x || ',' || y || ',' || has_water(w, x, y) from placed
      where world_id = w and made_by = '${ANNA}' and crumbles_at is not null order by id desc limit 1)
    || '|' || (select text from event where world_id = w and uid = '${ANNA}' order by n desc limit 1));
  perform give(w, '${ANNA}', 'sword', 1, 30);
  update player set x = 25.5, y = 44.5 where world_id = w and uid = '${ANNA}';
  perform player_die(w, '${ANNA}');
  insert into said values ('WET', (select x || ',' || y from placed
      where world_id = w and made_by = '${ANNA}' and crumbles_at is not null order by id desc limit 1)
    || '|' || (select text from event where world_id = w and uid = '${ANNA}' order by n desc limit 1));

  -- The hour up on the one by the shore: the heartbeat's sweep takes it and what is in it.
  update placed set crumbles_at = now() - interval '1 second'
   where world_id = w and made_by = '${ANNA}' and crumbles_at is not null and x = 13;
  insert into said values ('DUE', (select count(*) from placed where world_id = w and crumbles_at <= now())::text);
  perform ground_sweep(w);
  insert into said values ('SWEPT', (select count(*) from placed where world_id = w and made_by = '${ANNA}' and crumbles_at is not null)
    || ',' || (select count(*) from item where world_id = w and def = 'hatchet' and placed is null and holder = 'furniture')
    || '|' || (select text from event where world_id = w and uid = '${ANNA}' order by n desc limit 1));
end $$;
-- And how the sweep finds them: by when they crumble, on an index of nothing else. A
-- test island's handful of pieces is cheaper to scan than to look anything up in, so
-- this one is given the few thousand a lived-on island has, a handful of graves among them.
insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy)
  select w.id, 'furniture', 'chest', 40 + n % 20, 40 + n / 200, 0, 0, 40.5 + n % 20, 40.5 + n / 200
    from world w, generate_series(1, 4000) n where w.name = 'Hoarding';
analyze placed;
do $$
declare w uuid; r record; v text := '';
begin
  select id into w from world where name = 'Hoarding';
  for r in execute format('explain select pl.id from placed pl where pl.world_id = %L and pl.crumbles_at is not null
                             and pl.crumbles_at <= now() order by pl.crumbles_at', w) loop
    v := v || r."QUERY PLAN" || ' ';
  end loop;
  insert into said values ('PLAN', v);
end $$;
-- An analyse writes the size of a table where no rollback reaches, so the island is
-- measured again without them before everything here is undone.
delete from placed where world_id = (select id from world where name = 'Hoarding') and sub = 'chest' and y between 40 and 60 and x between 40 and 59;
analyze placed;
select k || '|' || coalesce(v, 'NULL') from said;
rollback;
`);
const isl = (key: string): string =>
  isle.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

check('a death on the island digs one grave, a piece, on the tile where the body fell, for an hour',
  isl('GRAVE') === 'furniture,grave,8,44,true', isl('GRAVE'));
check('with the pack, the hands, the toolbelt and the bag in it', isl('IN') === 'backpack,hatchet,plank,sword,toolbelt,torch', isl('IN'));
check('the bag with what is in it, which is nobody\'s while it lies there', isl('BAG') === 'bag,nobody,true', isl('BAG'));
check('the light put out, what it burned taken off it', isl('LIGHT') === 'false,true', isl('LIGHT'));
check('clothing, armour, a jewel, a crate with a wildermon in it and what is held in a deal stay with the body',
  isl('KEPT') === 'creature_crate,hatchet,jewelled_ring,leather_cap', isl('KEPT'));
check('nothing in the hands or on the belt', isl('WORN') === 'head,jewel', isl('WORN'));
check('in the browser\'s words', isl('SAID') === ASKED, isl('SAID'));
check('and the body on the shore it came in on', isl('SHORE') === '32.5,32.5', isl('SHORE'));
check('its owner is shown what is in it, whose it is and how long it has, with no timestamp of the island\'s',
  isl('HERS') === 'true,6,Anna,true,false,10', isl('HERS'));
check('and from out of reach, how much is in it', isl('FAR') === '0,10', isl('FAR'));
check('and every grave of hers, however far off', isl('LISTED').split('|')[0] === isl('LISTED').split('|')[1], isl('LISTED'));
check('anybody else is shown a grave they cannot open, whose it is, not what or how much is in it, and none of theirs',
  isl('HIS') === 'false,0,Anna,untold|0', isl('HIS'));
const annas = graveNotYours('Anna');
check('anybody else is told whose it is when they try to open it, in the browser\'s words', isl('B_ALL') === annas, isl('B_ALL'));
check('or take one thing from it', isl('B_ONE') === annas, isl('B_ONE'));
check('or pick it up', isl('B_LIFT') === annas, isl('B_LIFT'));
check('nobody takes a spadeful out of a grave, whoever\'s it is', isl('SPADE') === 'none,false,none,false,2', isl('SPADE'));
check('its owner does not pick it up, name it or put anything in it, in the browser\'s words',
  isl('A_LIFT') === GRAVE_SHUT && isl('A_NAME') === GRAVE_SHUT && isl('A_PUT') === GRAVE_SHUT, `${isl('A_LIFT')} / ${isl('A_NAME')} / ${isl('A_PUT')}`);
check('and takes one thing out, or everything', isl('A_ONE') === 'ALLOWED' && isl('A_ALL') === 'ALLOWED', `${isl('A_ONE')} / ${isl('A_ALL')}`);
check('everything comes back, the bag with what is in it', isl('BACK')
  === '0,backpack,creature_crate,hatchet,hatchet,jewelled_ring,leather_cap,plank,sword,toolbelt,torch,bag:true', isl('BACK'));
check('and the grave stands until its hour is up', isl('STANDS') === '1', isl('STANDS'));
const [one, two] = isl('TWO').split(' ');
check('a second death on the same tile digs a second grave beside the first, where the browser digs it',
  !!one && !!two && one.split(':')[0] === two.split(':')[0] && two.split(':')[1] === `${second?.sx},${second?.sy}`
    && one.split(':')[1] === `${first.sx},${first.sy}`, isl('TWO'));
check('a death carrying nothing but what it wears digs none, and says the old words',
  isl('BARE') === `2|${deathSaid(null)}`, isl('BARE'));
check('in deep water the grave is on the nearest dry ground in reach, and says so',
  isl('DRY') === `13,44,false|${deathSaid('shore')}`, isl('DRY'));
check('and where the body fell with none in reach', isl('WET') === `25,44|${ASKED}`, isl('WET'));
check('its hour up, the heartbeat\'s sweep takes it and what is in it, and tells its owner in the browser\'s words',
  isl('DUE') === '1' && isl('SWEPT') === `3,0|${crumbledSaid(13, 44, 1)}`, `${isl('DUE')} / ${isl('SWEPT')}`);
check('and finds the graves that are due off the index of when they crumble', isl('PLAN').includes('placed_crumbles'), isl('PLAN'));

for (const line of [...ok, ...bad]) console.log(line);
console.log(`a grave where you fell — ${ok.length} of ${ok.length + bad.length}`);
if (bad.length) process.exit(1);
