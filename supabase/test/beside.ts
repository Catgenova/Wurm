/**
 * The wagon beside the furnace.
 *
 * Asked: "pouring a mould, as an action that requires ingredients, should be
 * pulling the iron from the adjacent wagon as it is within 3 tiles".
 *
 * A craft has reached into the stores around you since it was asked to; the
 * stations did not. So a smelter, a kiln, a campfire, an oven, an anvil and a
 * barrel of water are set round the body, with a mould, an anvil mould, a coin
 * die, a file, a whetstone and an iron hatchet carried, and nothing else to
 * work with in the pack. What is used up is in the stores:
 *
 *   * a wagon two tiles off that somebody else set down, off any settlement:
 *     iron lumps, iron ore, an iron shovel, shovel head castings, silver
 *     lumps, unfired bowls and apples -- a vehicle is anybody's to load and
 *     to empty, so it is anybody's to use;
 *   * a crate of logs of your own;
 *   * and three that are not to be reached: a chest somebody else set down,
 *     a wagon with a padlock on it and no key in the pack, and a wagon five
 *     tiles off.
 *
 * Asked of both sides, the same spread:
 *
 *   * the stores at hand are the wagon and the crate, and nothing else;
 *   * a mould is poured, an anvil cast, ore charged and scrap melted out of
 *     the wagon, and the smelter, the campfire, the kiln and the oven are fed
 *     out of the crate;
 *   * clay is packed into the kiln, a casting beaten out and coins struck,
 *     a hatchet bettered and a brew set going, all out of the wagon;
 *   * bettering works in what you carry before anything stored;
 *   * and the chest, the padlocked wagon and the far wagon are never touched,
 *     and a pour aimed at any of them says there is no metal.
 *
 * The island half runs against the database the suite leaves behind, in one
 * transaction that is rolled back.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import { Game } from '../../src/game/game';
import { furnitureName } from '../../src/game/furniture';
import type { Item } from '../../src/game/items';
import { CRAFT_REACH } from '../../src/game/recipes';
import { MOULD_BY_ID } from '../../src/game/metal';

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

check('the reach is the three tiles asked for, on both sides',
  CRAFT_REACH === 3 && Number(psql('select craft_reach();')) === CRAFT_REACH, `${CRAFT_REACH}`);

/* ---- the browser --------------------------------------------------------- */

const game = Game.create(4242);
// Dry land with room round it for the stations and the stores.
let spot: [number, number] | null = null;
for (let r = 0; r < 80 && !spot; r++) {
  for (let dx = -r; dx <= r && !spot; dx++) {
    for (const dy of [-r, r]) {
      const [x, y] = [64 + dx, 64 + dy];
      let dry = true;
      for (let j = -2; j <= 2 && dry; j++) {
        for (let i = -2; i <= 5 && dry; i++) dry = game.world.isPassable(x + i, y + j) && !game.world.hasWater(x + i, y + j);
      }
      if (dry) {
        spot = [x, y];
        break;
      }
    }
  }
}
const [px, py] = spot ?? [64, 64];
game.player.x = px + 0.5;
game.player.y = py + 0.5;
for (const c of [...game.crates.values()]) game.removeCrate(c.id);
for (const f of [...game.furniture.values()]) game.removeFurniture(f.id);

const pack = game.inventory;
const USED = ['iron_lump', 'iron_ore', 'log', 'shovel_head_mould', 'anvil_mould', 'casting', 'silver_lump', 'coin_die',
  'file', 'whetstone', 'hatchet', 'apple', 'unfired_clay_bowl', 'shovel', 'coin', 'plank', 'shaft', 'thatch', 'peat', 'coal', 'timber'];
for (const it of [...pack.items]) if (USED.includes(it.id) || it.inside) pack.remove(it.uid, it.count);
/* The lumps in the wagon: what an anvil takes off its mould, and ten over for the rest of it. */
const ANVIL_LUMPS = MOULD_BY_ID.get('anvil_mould')?.lumps ?? 0;
const LUMPS = ANVIL_LUMPS + 10;
const stack = (id: string, count: number, ql: number, extra?: string, piece?: string): Item => ({
  uid: pack.nextUid++, id, ql, dmg: 0, count, ...(extra ? { extra } : {}), ...(piece ? { piece } : {}),
});

const smelter = game.addSmelter(px + 1, py, 0, 0, 50);
smelter.fuel = 600;
smelter.lit = true;
const kiln = game.addKiln(px - 1, py, 0, 0, 50);
const anvil = game.addAnvil(px, py + 1, 0, 0, 'iron', 50);
const fire = game.addCampfire(px, py - 1, 0, 0, 0, false);
const oven = game.addFurniture('oven', px - 1, py - 1, 0, 0, 40);
const barrel = game.addFurniture('barrel', px + 1, py + 1, 0, 0, 40);
barrel.liquid = 'water';
barrel.litres = 20;

const wagon = game.addFurniture('wagon', px + 2, py, 0, 0, 40, [
  stack('iron_lump', LUMPS, 45, 'Iron'), stack('iron_ore', 5, 35), stack('shovel', 1, 30, 'Iron'),
  stack('casting', 2, 50, 'Iron', 'shovel_head'), stack('silver_lump', 2, 40, 'Silver'),
  stack('unfired_clay_bowl', 3, 30), stack('apple', 20, 30),
], 'Pine');
// Somebody else's, off any settlement: a vehicle is anybody's all the same.
wagon.mine = false;
const crate = game.addCrate('plank', px - 2, py - 1, 0, 0, [stack('log', 10, 30, 'Pine')]);
const theirs = game.addFurniture('chest', px - 1, py + 2, 0, 0, 40, [stack('iron_lump', 5, 45, 'Iron')]);
theirs.mine = false;
const shut = game.addFurniture('wagon', px + 2, py + 2, 0, 0, 40, [stack('iron_lump', 7, 45, 'Iron')], 'Pine');
shut.lock = 424242;
const far = game.addFurniture('wagon', px + 5, py, 0, 0, 40, [stack('iron_lump', 9, 45, 'Iron')], 'Pine');

const mould = pack.add('shovel_head_mould', { ql: 50 });
const anvilMould = pack.add('anvil_mould', { ql: 50 });
pack.add('coin_die', { ql: 50 });
pack.add('file', { ql: 50 });
pack.add('whetstone', { ql: 50 });
const hatchet = pack.add('hatchet', { ql: 5, extra: 'Iron' });

const count = (items: Item[], id: string): number => items.filter((it) => it.id === id).reduce((n, it) => n + it.count, 0);
const first = (items: Item[], id: string): Item => items.find((it) => it.id === id) ?? ({ uid: -1 } as Item);
/** Ask, and do it when the answer is yes: the answer, or "done". */
const go = (id: string, t: Target): string => {
  const def = ACTION_BY_ID.get(id);
  if (!def) return `no ${id}`;
  game.player.stats.stamina = 1;
  const why = def.check?.(t, game) ?? null;
  if (why) return why;
  def.perform(t, game);
  return 'done';
};

console.log('--- the browser');
check(`at hand: the ${LUMPS} lumps in the wagon, and none of the chest's, the padlocked wagon's or the far wagon's`,
  game.stockCount('iron_lump') === LUMPS, `${game.stockCount('iron_lump')}`);
const lumpEntry = game.stockOf((it) => it.id === 'iron_lump')[0];
check('and a stack in the wagon says which store it is in', !lumpEntry?.carried && lumpEntry?.store === furnitureName(wagon),
  `${lumpEntry?.store}`);

const st = { kind: 'smelter', id: smelter.id } as const;
check('a mould is poured out of the wagon',
  go('pour_mould', { ...st, mouldUid: mould.uid, itemUid: first(wagon.items, 'iron_lump').uid } as Target) === 'done'
  && count(wagon.items, 'iron_lump') === LUMPS - 1 && smelter.jobs.length === 1 && smelter.jobs[0].piece === 'shovel_head',
  `${count(wagon.items, 'iron_lump')} lumps left in the wagon, ${smelter.jobs.length} in the furnace`);
check('an anvil is cast out of it',
  go('cast_anvil', { ...st, itemUid: first(wagon.items, 'iron_lump').uid } as Target) === 'done'
  && count(wagon.items, 'iron_lump') === 9 && !pack.get(anvilMould.uid) && smelter.jobs.length === 2,
  `${count(wagon.items, 'iron_lump')} lumps left`);
check('ore is charged out of it',
  go('smelt_ore', { ...st, itemUid: first(wagon.items, 'iron_ore').uid, count: 5 } as Target) === 'done'
  && count(wagon.items, 'iron_ore') === 0 && smelter.jobs.length === 7, `${smelter.jobs.length} in the furnace`);
const jobs = smelter.jobs.length;
check('and scrap melted down out of it',
  go('melt_down', { ...st, itemUid: first(wagon.items, 'shovel').uid, count: 1 } as Target) === 'done'
  && count(wagon.items, 'shovel') === 0 && smelter.jobs.length > jobs, `${smelter.jobs.length - jobs} lumps to come`);

const logs = (): number => count(crate.items, 'log');
const fuel = smelter.fuel;
check('the smelter is fed out of the crate',
  go('fuel_smelter', { ...st, itemUid: first(crate.items, 'log').uid, count: 2 } as Target) === 'done' && logs() === 8 && smelter.fuel > fuel,
  `${logs()} logs left`);
check('and the campfire',
  go('fuel_campfire', { kind: 'campfire', id: fire.id, itemUid: first(crate.items, 'log').uid, count: 1 } as Target) === 'done'
  && logs() === 7 && fire.fuel > 0, `${logs()} logs left`);
check('and the kiln',
  go('fuel_kiln', { kind: 'kiln', id: kiln.id, itemUid: first(crate.items, 'log').uid, count: 1 } as Target) === 'done'
  && logs() === 6 && kiln.fuel > 0, `${logs()} logs left`);
check('and the oven',
  go('fuel_oven', { kind: 'furniture', id: oven.id, itemUid: first(crate.items, 'log').uid, count: 1 } as Target) === 'done'
  && logs() === 5 && (oven.fuel ?? 0) > 0, `${logs()} logs left`);
const armful = pack.add('log', { count: 1, ql: 30, extra: 'Pine' });
check('a fire fed with nothing named burns what is carried before anything stored',
  go('fuel_campfire', { kind: 'campfire', id: fire.id, count: 1 } as Target) === 'done' && !pack.get(armful.uid) && logs() === 5,
  `${logs()} logs left in the crate`);

check('clay is packed into the kiln out of the wagon',
  go('load_kiln', { kind: 'kiln', id: kiln.id, itemUid: first(wagon.items, 'unfired_clay_bowl').uid, count: 3 } as Target) === 'done'
  && count(wagon.items, 'unfired_clay_bowl') === 0 && kiln.jobs.length === 3, `${kiln.jobs.length} in the kiln`);
check('a casting is beaten out at the anvil out of the wagon',
  go('smith', { kind: 'anvil', id: anvil.id, itemUid: first(wagon.items, 'casting').uid } as Target) === 'done'
  && count(wagon.items, 'casting') === 1, `${count(wagon.items, 'casting')} castings left`);
check('and coins are struck out of it',
  go('strike_coins', { kind: 'anvil', id: anvil.id, itemUid: first(wagon.items, 'silver_lump').uid } as Target) === 'done'
  && count(wagon.items, 'silver_lump') === 1, `${count(wagon.items, 'silver_lump')} silver left`);

const better = { kind: 'item', uid: hatchet.uid } as Target;
check('a hatchet is bettered with a lump out of the wagon',
  go('improve_item', better) === 'done' && count(wagon.items, 'iron_lump') === 8, `${count(wagon.items, 'iron_lump')} lumps left`);
const carried = pack.add('iron_lump', { count: 2, ql: 60, extra: 'Iron' });
const answer = go('improve_item', better);
check('and with lumps in the pack as well, the pack\'s go first, however good they are',
  answer === 'done' && carried.count === 1 && count(wagon.items, 'iron_lump') === 8,
  `${answer}; ${carried.count} carried, ${count(wagon.items, 'iron_lump')} in the wagon`);
pack.remove(carried.uid, carried.count);

check('a brew is set going out of the wagon',
  go('start_brew', { kind: 'furniture', id: barrel.id, brew: 'cider' } as Target) === 'done' && count(wagon.items, 'apple') === 0,
  `${count(wagon.items, 'apple')} apples left`);

check('the chest somebody else set down, the padlocked wagon and the far wagon are untouched',
  count(theirs.items, 'iron_lump') === 5 && count(shut.items, 'iron_lump') === 7 && count(far.items, 'iron_lump') === 9,
  `${count(theirs.items, 'iron_lump')}, ${count(shut.items, 'iron_lump')}, ${count(far.items, 'iron_lump')}`);
const aimed = [theirs, shut, far].map((f) => go('pour_mould', { ...st, mouldUid: mould.uid, itemUid: first(f.items, 'iron_lump').uid } as Target));
check('and a pour aimed at any of them says there is no metal', aimed.every((a) => a === 'You have no metal to pour.'), aimed.join(' | '));

/* ---- the island ---------------------------------------------------------- */

const isle = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; me uuid; them uuid := gen_random_uuid(); v_x int; v_y int;
        v_smelter bigint; v_kiln bigint; v_anvil bigint; v_fire bigint; v_oven bigint; v_barrel bigint;
        v_wagon bigint; v_theirs bigint; v_shut bigint; v_far bigint; v_crate int;
        v_mould bigint; v_hatchet bigint; v_carried bigint; v_log bigint; v_jobs int;
begin
  select id into w from world where name = 'Hoarding';
  select uid into me from player where world_id = w and name = 'Dane';
  -- Somewhere no settlement covers, with room round it.
  select gx, gy into v_x, v_y
    from generate_series(20, 200, 7) gx, generate_series(20, 200, 7) gy
   where not exists (select 1 from deed d where d.world_id = w
                      and abs(d.x - gx) <= d.radius + 8 and abs(d.y - gy) <= d.radius + 8)
   order by gx, gy limit 1;
  update player set x = v_x + 0.5, y = v_y + 0.5, act = null, act_queue = '[]'::jsonb,
      stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1')
   where world_id = w and uid = me;
  delete from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = me
    and (i.def in ('iron_lump', 'iron_ore', 'log', 'shovel_head_mould', 'anvil_mould', 'casting', 'silver_lump',
                   'coin_die', 'file', 'whetstone', 'hatchet', 'apple', 'unfired_clay_bowl', 'shovel', 'coin',
                   'plank', 'shaft', 'thatch', 'peat', 'coal', 'timber') or is_bag(i.def));

  insert into placed (world_id, kind, x, y, sx, sy, cx, cy, ql, fuel, lit, state, made_by)
    values (w, 'smelter', v_x + 1, v_y, 0, 0, v_x + 1.375, v_y + 0.25, 50, 600, true,
            '{"jobs": [], "output": []}'::jsonb, me) returning id into v_smelter;
  insert into placed (world_id, kind, x, y, sx, sy, cx, cy, ql, state, made_by)
    values (w, 'kiln', v_x - 1, v_y, 0, 0, v_x - 0.75, v_y + 0.25, 50, '{"jobs": [], "output": []}'::jsonb, me)
    returning id into v_kiln;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'anvil', 'iron', v_x, v_y + 1, 0, 0, v_x + 0.25, v_y + 1.25, 50, me) returning id into v_anvil;
  insert into placed (world_id, kind, x, y, sx, sy, cx, cy, fuel, made_by)
    values (w, 'campfire', v_x, v_y - 1, 0, 0, v_x + 0.25, v_y - 0.75, 0, me) returning id into v_fire;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'furniture', 'oven', v_x - 1, v_y - 1, 0, 0, v_x - 0.75, v_y - 0.75, 40, me) returning id into v_oven;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, liquid, litres, made_by)
    values (w, 'furniture', 'barrel', v_x + 1, v_y + 1, 0, 0, v_x + 1.125, v_y + 1.125, 40, 'water', 20, me)
    returning id into v_barrel;

  -- The wagon: somebody else's, off any settlement.
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'wagon', v_x + 2, v_y, 0, 0, v_x + 2.5, v_y + 0.5, 40, 'Pine', them) returning id into v_wagon;
  insert into item (world_id, holder, placed, def, ql, count, extra, piece) values
    (w, 'furniture', v_wagon, 'iron_lump', 45, ${LUMPS}, 'Iron', null),
    (w, 'furniture', v_wagon, 'iron_ore', 35, 5, null, null),
    (w, 'furniture', v_wagon, 'shovel', 30, 1, 'Iron', null),
    (w, 'furniture', v_wagon, 'casting', 50, 2, 'Iron', 'shovel_head'),
    (w, 'furniture', v_wagon, 'silver_lump', 40, 2, 'Silver', null),
    (w, 'furniture', v_wagon, 'unfired_clay_bowl', 30, 3, null, null),
    (w, 'furniture', v_wagon, 'apple', 30, 20, null, null);
  select coalesce(max(id), 0) + 1 into v_crate from crate where world_id = w;
  insert into crate (world_id, id, kind, x, y, sx, sy, made_by) values (w, v_crate, 'plank', v_x - 2, v_y - 1, 0, 0, me);
  insert into item (world_id, holder, crate, gx, gy, def, ql, count, extra)
    values (w, 'crate', v_crate, v_x - 2, v_y - 1, 'log', 30, 10, 'Pine');
  -- And the three that are not to be reached.
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'furniture', 'chest', v_x - 1, v_y + 2, 0, 0, v_x - 0.75, v_y + 2.25, 40, them) returning id into v_theirs;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by, lock)
    values (w, 'furniture', 'wagon', v_x + 2, v_y + 2, 0, 0, v_x + 2.5, v_y + 2.5, 40, 'Pine', me, 424242)
    returning id into v_shut;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'wagon', v_x + 5, v_y, 0, 0, v_x + 5.5, v_y + 0.5, 40, 'Pine', me) returning id into v_far;
  insert into item (world_id, holder, placed, def, ql, count, extra) values
    (w, 'furniture', v_theirs, 'iron_lump', 45, 5, 'Iron'),
    (w, 'furniture', v_shut, 'iron_lump', 45, 7, 'Iron'),
    (w, 'furniture', v_far, 'iron_lump', 45, 9, 'Iron');

  v_mould := give(w, me, 'shovel_head_mould', 1, 50);
  perform give(w, me, 'anvil_mould', 1, 50);
  perform give(w, me, 'coin_die', 1, 50);
  perform give(w, me, 'file', 1, 50);
  perform give(w, me, 'whetstone', 1, 50);
  v_hatchet := give(w, me, 'hatchet', 1, 5, 'Iron');

  insert into said values ('AT|' || craft_count(w, me, 'iron_lump'));

  -- The furnace, out of the wagon.
  insert into said values ('POUR?|' || coalesce(act_refusal(w, me, 'pour_mould', jsonb_build_object('kind', 'smelter',
    'id', v_smelter, 'mouldUid', v_mould, 'itemUid', (select id from item where placed = v_wagon and def = 'iron_lump'))), 'none'));
  perform act_perform(w, me, 'pour_mould', jsonb_build_object('kind', 'smelter', 'id', v_smelter, 'mouldUid', v_mould,
    'itemUid', (select id from item where placed = v_wagon and def = 'iron_lump')));
  insert into said values ('POUR|' || (select coalesce(sum(count), 0) from item where placed = v_wagon and def = 'iron_lump')
    || ',' || (select jsonb_array_length(state->'jobs') from placed where id = v_smelter)
    || ',' || coalesce((select state->'jobs'->0->>'piece' from placed where id = v_smelter), 'none'));
  insert into said values ('CAST?|' || coalesce(act_refusal(w, me, 'cast_anvil', jsonb_build_object('kind', 'smelter',
    'id', v_smelter, 'itemUid', (select id from item where placed = v_wagon and def = 'iron_lump'))), 'none'));
  perform act_perform(w, me, 'cast_anvil', jsonb_build_object('kind', 'smelter', 'id', v_smelter,
    'itemUid', (select id from item where placed = v_wagon and def = 'iron_lump')));
  insert into said values ('CAST|' || (select coalesce(sum(count), 0) from item where placed = v_wagon and def = 'iron_lump')
    || ',' || pack_count(w, me, 'anvil_mould') || ',' || (select jsonb_array_length(state->'jobs') from placed where id = v_smelter));
  insert into said values ('ORE?|' || coalesce(act_refusal(w, me, 'smelt_ore', jsonb_build_object('kind', 'smelter',
    'id', v_smelter, 'count', 5, 'itemUid', (select id from item where placed = v_wagon and def = 'iron_ore'))), 'none'));
  perform act_perform(w, me, 'smelt_ore', jsonb_build_object('kind', 'smelter', 'id', v_smelter, 'count', 5,
    'itemUid', (select id from item where placed = v_wagon and def = 'iron_ore')));
  insert into said values ('ORE|' || (select coalesce(sum(count), 0) from item where placed = v_wagon and def = 'iron_ore')
    || ',' || (select jsonb_array_length(state->'jobs') from placed where id = v_smelter));
  select jsonb_array_length(state->'jobs') into v_jobs from placed where id = v_smelter;
  insert into said values ('MELT?|' || coalesce(act_refusal(w, me, 'melt_down', jsonb_build_object('kind', 'smelter',
    'id', v_smelter, 'count', 1, 'itemUid', (select id from item where placed = v_wagon and def = 'shovel'))), 'none'));
  perform act_perform(w, me, 'melt_down', jsonb_build_object('kind', 'smelter', 'id', v_smelter, 'count', 1,
    'itemUid', (select id from item where placed = v_wagon and def = 'shovel')));
  insert into said values ('MELT|' || (select coalesce(sum(count), 0) from item where placed = v_wagon and def = 'shovel')
    || ',' || ((select jsonb_array_length(state->'jobs') from placed where id = v_smelter) > v_jobs));

  -- The fires, out of the crate.
  select id into v_log from item where holder = 'crate' and crate = v_crate and world_id = w;
  insert into said values ('FEED?|' || coalesce(act_refusal(w, me, 'fuel_smelter',
    jsonb_build_object('kind', 'smelter', 'id', v_smelter, 'itemUid', v_log, 'count', 2)), 'none')
    || ',' || coalesce(act_refusal(w, me, 'fuel_campfire',
    jsonb_build_object('kind', 'campfire', 'id', v_fire, 'itemUid', v_log, 'count', 1)), 'none')
    || ',' || coalesce(act_refusal(w, me, 'fuel_kiln',
    jsonb_build_object('kind', 'kiln', 'id', v_kiln, 'itemUid', v_log, 'count', 1)), 'none')
    || ',' || coalesce(act_refusal(w, me, 'fuel_oven',
    jsonb_build_object('kind', 'furniture', 'id', v_oven, 'itemUid', v_log, 'count', 1)), 'none'));
  perform act_perform(w, me, 'fuel_smelter', jsonb_build_object('kind', 'smelter', 'id', v_smelter, 'itemUid', v_log, 'count', 2));
  perform act_perform(w, me, 'fuel_campfire', jsonb_build_object('kind', 'campfire', 'id', v_fire, 'itemUid', v_log, 'count', 1));
  perform act_perform(w, me, 'fuel_kiln', jsonb_build_object('kind', 'kiln', 'id', v_kiln, 'itemUid', v_log, 'count', 1));
  perform act_perform(w, me, 'fuel_oven', jsonb_build_object('kind', 'furniture', 'id', v_oven, 'itemUid', v_log, 'count', 1));
  insert into said values ('FEED|' || (select coalesce(sum(count), 0) from item where holder = 'crate' and crate = v_crate and world_id = w)
    || ',' || ((select fuel from placed where id = v_smelter) > 600)
    || ',' || ((select fuel from placed where id = v_fire) > 0)
    || ',' || ((select fuel from placed where id = v_kiln) > 0)
    || ',' || ((select fuel from placed where id = v_oven) > 0));
  -- An armful carried, and a fire fed with nothing named: the armful goes.
  insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (w, 'player', me, 'log', 30, 1, 'Pine');
  perform act_perform(w, me, 'fuel_campfire', jsonb_build_object('kind', 'campfire', 'id', v_fire, 'count', 1));
  insert into said values ('ARMFUL|' || pack_count(w, me, 'log')
    || ',' || (select coalesce(sum(count), 0) from item where holder = 'crate' and crate = v_crate and world_id = w));

  -- The kiln, the anvil, the file and the barrel, out of the wagon.
  insert into said values ('CLAY?|' || coalesce(act_refusal(w, me, 'load_kiln', jsonb_build_object('kind', 'kiln', 'id', v_kiln,
    'count', 3, 'itemUid', (select id from item where placed = v_wagon and def = 'unfired_clay_bowl'))), 'none'));
  perform act_perform(w, me, 'load_kiln', jsonb_build_object('kind', 'kiln', 'id', v_kiln, 'count', 3,
    'itemUid', (select id from item where placed = v_wagon and def = 'unfired_clay_bowl')));
  insert into said values ('CLAY|' || (select coalesce(sum(count), 0) from item where placed = v_wagon and def = 'unfired_clay_bowl')
    || ',' || (select jsonb_array_length(state->'jobs') from placed where id = v_kiln));
  insert into said values ('SMITH?|' || coalesce(act_refusal(w, me, 'smith', jsonb_build_object('kind', 'anvil', 'id', v_anvil,
    'itemUid', (select id from item where placed = v_wagon and def = 'casting'))), 'none'));
  perform act_perform(w, me, 'smith', jsonb_build_object('kind', 'anvil', 'id', v_anvil,
    'itemUid', (select id from item where placed = v_wagon and def = 'casting')));
  insert into said values ('SMITH|' || (select coalesce(sum(count), 0) from item where placed = v_wagon and def = 'casting'));
  insert into said values ('COIN?|' || coalesce(act_refusal(w, me, 'strike_coins', jsonb_build_object('kind', 'anvil', 'id', v_anvil,
    'itemUid', (select id from item where placed = v_wagon and def = 'silver_lump'))), 'none'));
  perform act_perform(w, me, 'strike_coins', jsonb_build_object('kind', 'anvil', 'id', v_anvil,
    'itemUid', (select id from item where placed = v_wagon and def = 'silver_lump')));
  insert into said values ('COIN|' || (select coalesce(sum(count), 0) from item where placed = v_wagon and def = 'silver_lump'));
  insert into said values ('BETTER?|' || coalesce(act_refusal(w, me, 'improve_item',
    jsonb_build_object('kind', 'item', 'uid', v_hatchet)), 'none'));
  perform act_perform(w, me, 'improve_item', jsonb_build_object('kind', 'item', 'uid', v_hatchet));
  insert into said values ('BETTER|' || (select coalesce(sum(count), 0) from item where placed = v_wagon and def = 'iron_lump'));
  insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (w, 'player', me, 'iron_lump', 60, 2, 'Iron')
    returning id into v_carried;
  insert into said values ('CARRIED?|' || coalesce(act_refusal(w, me, 'improve_item',
    jsonb_build_object('kind', 'item', 'uid', v_hatchet)), 'none'));
  perform act_perform(w, me, 'improve_item', jsonb_build_object('kind', 'item', 'uid', v_hatchet));
  insert into said values ('CARRIED|' || coalesce((select count from item where id = v_carried), 0)
    || ',' || (select coalesce(sum(count), 0) from item where placed = v_wagon and def = 'iron_lump'));
  delete from item where id = v_carried;
  insert into said values ('BREW?|' || coalesce(act_refusal(w, me, 'start_brew',
    jsonb_build_object('kind', 'furniture', 'id', v_barrel, 'brew', 'cider')), 'none'));
  perform act_perform(w, me, 'start_brew', jsonb_build_object('kind', 'furniture', 'id', v_barrel, 'brew', 'cider'));
  insert into said values ('BREW|' || (select coalesce(sum(count), 0) from item where placed = v_wagon and def = 'apple'));

  -- And the three that are not to be reached.
  insert into said values ('UNTOUCHED|' || concat_ws(',',
    (select coalesce(sum(count), 0) from item where placed = v_theirs and def = 'iron_lump'),
    (select coalesce(sum(count), 0) from item where placed = v_shut and def = 'iron_lump'),
    (select coalesce(sum(count), 0) from item where placed = v_far and def = 'iron_lump')));
  insert into said select 'AIMED|' || string_agg(coalesce(act_refusal(w, me, 'pour_mould', jsonb_build_object('kind', 'smelter',
    'id', v_smelter, 'mouldUid', v_mould, 'itemUid', i.id)), 'none'), ' | ' order by i.placed)
    from item i where i.placed in (v_theirs, v_shut, v_far) and i.def = 'iron_lump';
end $$;
select * from said;
rollback;
`);
const said = (key: string): string =>
  isle.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

console.log('--- the island');
check(`at hand: the ${LUMPS} lumps in the wagon, and none of the chest's, the padlocked wagon's or the far wagon's`,
  said('AT') === String(LUMPS), said('AT'));
check('a mould is poured out of the wagon', said('POUR?') === 'none' && said('POUR') === `${LUMPS - 1},1,shovel_head`, `${said('POUR?')}; ${said('POUR')}`);
check('an anvil is cast out of it', said('CAST?') === 'none' && said('CAST') === '9,0,2', `${said('CAST?')}; ${said('CAST')}`);
check('ore is charged out of it', said('ORE?') === 'none' && said('ORE') === '0,7', `${said('ORE?')}; ${said('ORE')}`);
check('and scrap melted down out of it', said('MELT?') === 'none' && said('MELT') === '0,true', `${said('MELT?')}; ${said('MELT')}`);
check('the smelter, the campfire, the kiln and the oven are fed out of the crate',
  said('FEED?') === 'none,none,none,none' && said('FEED') === '5,true,true,true,true', `${said('FEED?')}; ${said('FEED')}`);
check('a fire fed with nothing named burns what is carried before anything stored', said('ARMFUL') === '0,5', said('ARMFUL'));
check('clay is packed into the kiln out of the wagon', said('CLAY?') === 'none' && said('CLAY') === '0,3', `${said('CLAY?')}; ${said('CLAY')}`);
check('a casting is beaten out at the anvil out of the wagon', said('SMITH?') === 'none' && said('SMITH') === '1', `${said('SMITH?')}; ${said('SMITH')}`);
check('and coins are struck out of it', said('COIN?') === 'none' && said('COIN') === '1', `${said('COIN?')}; ${said('COIN')}`);
check('a hatchet is bettered with a lump out of the wagon', said('BETTER?') === 'none' && said('BETTER') === '8', `${said('BETTER?')}; ${said('BETTER')}`);
check('and with lumps in the pack as well, the pack\'s go first, however good they are',
  said('CARRIED?') === 'none' && said('CARRIED') === '1,8', `${said('CARRIED?')}; ${said('CARRIED')}`);
check('a brew is set going out of the wagon', said('BREW?') === 'none' && said('BREW') === '0', `${said('BREW?')}; ${said('BREW')}`);
check('the chest somebody else set down, the padlocked wagon and the far wagon are untouched',
  said('UNTOUCHED') === '5,7,9', said('UNTOUCHED'));
check('and a pour aimed at any of them says there is no metal',
  said('AIMED') === 'You have no metal to pour. | You have no metal to pour. | You have no metal to pour.', said('AIMED'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`what the work uses up is at hand — ${ok.length} of ${ok.length}`);
