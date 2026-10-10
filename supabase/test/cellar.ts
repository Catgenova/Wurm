/**
 * A cellar: the storey under the ground floor, on both sides.
 *
 * A finished building's ground-floor tile is dug out from under it a slice at
 * a time -- the soil with a shovel, then the rock under it with a pick -- and
 * gives what digging and mining that ground would: a spadeful of dirt a slice
 * down through the soil, and the rock's own yield a slice down through the
 * rock, the ore of a seam where there is one, by somebody inside the
 * building. A flight down from the ground floor is the way in; a body walks it
 * down and up, from its foot and from no other side, and nowhere else, and
 * walks the cellar's floor and not the earth round it -- nor into the cellar
 * of the building next door, which is the far side of solid ground for
 * walking, reaching and digging alike. What lies down there rots at a
 * twentieth of the rate out of doors, and a bed down there rests as one
 * indoors does, roof or none. The ground over it is left as it was, and is
 * not dug while the cellar is there; a building with a cellar under it comes
 * down only once the cellar is filled in. And where the other things a
 * building can be meet it: no cellar under a deck on piers, no way down over a
 * glasshouse's field, no lantern post down there, no shop counter tended from
 * down there, and no altar down there glowing on the floor over it.
 *
 * Every rule here is asked of both sides, in the same words: a refusal the
 * island gives and the browser does not is a button that works until it
 * doesn't, and a cellar that keeps food in one and not the other eats it.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { DAY_SECONDS } from '../../src/game/pace';
import { ACTION_BY_ID } from '../../src/game/actions';
import { CELLAR_DECAY, CELLAR_DEPTH, CELLAR_LEVEL, CELLAR_SOIL, INDOORS_DECAY, INDOORS_REST, type Side } from '../../src/game/building';
import { cellarGate, cellarSoil } from '../../src/game/cellar';
import { furnitureCentre, furnitureDef } from '../../src/game/furniture';
import { bedrockAt } from '../../src/world/ore';
import { ROCK_VARIANTS, TileType } from '../../src/world/tiles';
import { groundDecayRate, type Item } from '../../src/game/items';
import { ALTAR_CAST, ALTAR_REACH } from '../../src/game/light';

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
const W = `(select id from world where name = 'Hoarding')`;
const DANE = `(select uid from player where world_id = ${W} and name = 'Dane')`;
/** A block run with `w` the island and `u` Dane. */
const island = (body: string): string => psql(`
do $$
declare w uuid; u uuid;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  ${body}
end $$;`);
const val = (sql: string): string => psql(`select ${sql};`).split('\n').pop()?.trim() ?? '';

/* ---- the numbers ----------------------------------------------------------- */
check('a cellar is the same storey, the same depth, the same keeping and the same soil on both sides',
  Number(val('cellar_level()')) === CELLAR_LEVEL && Number(val('cellar_depth()')) === CELLAR_DEPTH
    && Number(val('cellar_decay()')) === CELLAR_DECAY && Number(val('cellar_least_soil()')) === CELLAR_SOIL,
  `storey ${CELLAR_LEVEL}, ${CELLAR_DEPTH} deep, ${CELLAR_DECAY} of the outdoor rate, ${CELLAR_SOIL} of soil`);
check('and a cellar keeps things longer than anywhere else: a twentieth against a room\'s tenth',
  CELLAR_DECAY < INDOORS_DECAY, `${CELLAR_DECAY} against ${INDOORS_DECAY}`);

/* ---- the ground, and four buildings on it, on both sides --------------------
 *
 * Flat at 60 with 8 of soil at every corner, plain rock under, and a tin vein
 * under the third tile of the house; packed dirt, but for a patch of dirt to
 * dig at outside its south wall. The house is three tiles in a row, walled
 * all round, with no roof; a hut with a corner of shallow soil; a hut down at
 * 20 by the water; and a hut with no walls at all. And next door to the house,
 * hard up against its east wall, a square of four tiles with a cellar under
 * all of it already and a staircase down on its north-east tile, climbed from
 * the west: its foot is the tile beside the house's cellar, and the tiles
 * south of it and on the slant from it are cellar too, beside the flight and
 * not at its foot.
 */
const H = 60;
const S = 8;
const TIN = ROCK_VARIANTS.findIndex((r) => r.yields === 'tin_ore');
const HOUSE: Array<[number, number]> = [[20, 44], [21, 44], [22, 44]];
const SHALLOW: [number, number] = [26, 44];
const LOW: [number, number] = [30, 44];
const OPEN: [number, number] = [34, 44];
const NEXT: Array<[number, number]> = [[23, 44], [24, 44], [23, 45], [24, 45]];
/** A hut whose one tile stands on piers, its deck at the ground's height. */
const PIER: [number, number] = [28, 47];
const LOW_H = 20;

const game = Game.create(4242);
const w = game.world;
const bld = game.buildings;
for (let cy = 42; cy <= 48; cy++) for (let cx = 18; cx <= 40; cx++) { w.setHeight(cx, cy, H); w.setDirt(cx, cy, S); }
for (let y = 42; y < 48; y++) for (let x = 18; x < 40; x++) { w.setTile(x, y, TileType.PackedDirt); w.setRockKind(x, y, 0); }
w.setRockKind(22, 44, TIN);
w.setTile(21, 45, TileType.Dirt);
w.setDirt(27, 45, 2);
for (const [cx, cy] of [[30, 44], [31, 44], [31, 45], [30, 45]]) w.setHeight(cx, cy, LOW_H);

const walls: Array<[number, number, number, Side]> = [];
const house = bld.create('Cellar house', 20, 44);
for (const [x, y] of HOUSE.slice(1)) bld.addTile(house, x, y);
const huts = [SHALLOW, LOW, OPEN].map(([x, y], i) => bld.create(['Shallow hut', 'Low hut', 'Open hut'][i], x, y));
const next = bld.create('Next door', NEXT[0][0], NEXT[0][1]);
const pierHut = bld.create('Pier hut', PIER[0], PIER[1], H);
for (const [x, y] of NEXT.slice(1)) bld.addTile(next, x, y);
for (const [x, y] of NEXT) bld.setCellar(next.id, x, y, CELLAR_DEPTH);
const nextFlight = bld.setFloor(next, 0, 24, 44, 'plank', 'stairs', 'w');
for (const k of Object.keys(nextFlight.needed)) nextFlight.needed[k] = 0;
const wallUp = (b: number, x: number, y: number, side: Side): void => {
  const ww = bld.setWall(bld.list.get(b)!, 0, x, y, side, 'solid', 'log');
  for (const k of Object.keys(ww.needed)) ww.needed[k] = 0;
  walls.push([b, x, y, side]);
};
wallUp(house.id, 20, 44, 'w');
wallUp(house.id, 22, 44, 'e');
for (const [x, y] of HOUSE) { wallUp(house.id, x, y, 'n'); wallUp(house.id, x, y, 's'); }
for (const hut of huts.slice(0, 2)) for (const side of ['n', 'e', 's', 'w'] as Side[]) {
  const [x, y] = hut.tiles[0].split(',').map(Number);
  wallUp(hut.id, x, y, side);
}

game.player.x = 20.5;
game.player.y = 44.5;
game.player.level = 0;
for (const id of ['shovel', 'pickaxe', 'mallet']) game.inventory.add(id, { ql: 50 });
game.skills.values.set('digging', 90);
game.skills.values.set('mining', 90);

const wallRow = ([b, x, y, side]: [number, number, number, Side]): string => {
  const bx = side === 'e' ? x + 1 : x;
  const by = side === 's' ? y + 1 : y;
  const dir = side === 'n' || side === 's' ? 'h' : 'v';
  return `(w, 0, '${dir}', ${bx}, ${by}, ${b}, 'solid', 'log', '{"log": 0}', '{"log": 4}')`;
};
island(`
  delete from cellar_tile where world_id = w;
  delete from wall where world_id = w;
  delete from floor_tile where world_id = w;
  delete from building_tile where world_id = w;
  delete from building where world_id = w;
  delete from item where world_id = w and holder in ('cellar', 'ground') and gx between 18 and 40 and gy between 42 and 48;
  delete from crate where world_id = w and x between 18 and 40 and y between 42 and 48;
  delete from placed where world_id = w and x between 18 and 40 and y between 42 and 48;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  for gx in 18..40 loop for gy in 42..48 loop
    perform land_set_height(w, gx, gy, ${H});
    perform land_set_dirt(w, gx, gy, ${S});
    if gx < 40 and gy < 48 then
      perform land_set_tile(w, gx, gy, tile_id('Packed dirt'));
      perform land_set_rock(w, gx, gy, 0);
    end if;
  end loop; end loop;
  perform land_set_rock(w, 22, 44, ${TIN});
  perform land_set_tile(w, 21, 45, tile_id('Dirt'));
  perform land_set_dirt(w, 27, 45, 2);
  perform land_set_height(w, 30, 44, ${LOW_H}); perform land_set_height(w, 31, 44, ${LOW_H});
  perform land_set_height(w, 31, 45, ${LOW_H}); perform land_set_height(w, 30, 45, ${LOW_H});
  insert into building (world_id, id, name, levels, work_level, planned_by) values
    (w, ${house.id}, 'Cellar house', 1, 0, u), (w, ${huts[0].id}, 'Shallow hut', 1, 0, u),
    (w, ${huts[1].id}, 'Low hut', 1, 0, u), (w, ${huts[2].id}, 'Open hut', 1, 0, u), (w, ${next.id}, 'Next door', 1, 0, u);
  insert into building_tile (world_id, building, x, y) values
    ${HOUSE.map(([x, y]) => `(w, ${house.id}, ${x}, ${y})`).join(', ')},
    (w, ${huts[0].id}, ${SHALLOW[0]}, ${SHALLOW[1]}), (w, ${huts[1].id}, ${LOW[0]}, ${LOW[1]}), (w, ${huts[2].id}, ${OPEN[0]}, ${OPEN[1]}),
    ${NEXT.map(([x, y]) => `(w, ${next.id}, ${x}, ${y})`).join(', ')};
  insert into building (world_id, id, name, levels, work_level, planned_by, deck) values (w, ${pierHut.id}, 'Pier hut', 1, 0, u, ${H});
  insert into building_tile (world_id, building, x, y, pier) values (w, ${pierHut.id}, ${PIER[0]}, ${PIER[1]}, true);
  insert into cellar_tile (world_id, x, y, building, dug) values ${NEXT.map(([x, y]) => `(w, ${x}, ${y}, ${next.id}, ${CELLAR_DEPTH})`).join(', ')};
  insert into floor_tile (world_id, level, x, y, building, material, kind, facing, needed, total)
    values (w, 0, 24, 44, ${next.id}, 'plank', 'stairs', 'w', '{"plank": 0}', '{"plank": 12}');
  insert into wall (world_id, level, dir, x, y, building, type, material, needed, total) values
    ${walls.map(wallRow).join(',\n    ')};
  insert into item (world_id, holder, holder_uid, def, ql, count) values
    (w, 'player', u, 'shovel', 50, 1), (w, 'player', u, 'pickaxe', 50, 1), (w, 'player', u, 'mallet', 50, 1);
  insert into skill (world_id, uid, id, value) values (w, u, 'digging', 90), (w, u, 'mining', 90)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  update player set x = 20.5, y = 44.5, level = 0, aboard = null, act = null, act_queue = '[]'::jsonb,
         stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'::jsonb)
   where world_id = w and uid = u;
`);

check('the ground is the same ground, and so is the rock under it',
  [[20, 44], [27, 45], [31, 44]].every(([cx, cy]) => Number(val(`land_height(${W}, ${cx}, ${cy})`)) === w.getHeight(cx, cy)
    && Number(val(`land_dirt(${W}, ${cx}, ${cy})`)) === w.getDirt(cx, cy))
    && Number(val(`land_rock(${W}, 22, 44)`)) === w.rockKind(22, 44),
  `soil ${S} under the house, ${cellarSoil(w, 20, 44)} as a cellar reckons it; ${bedrockAt(w, 22, 44).name.toLowerCase()} under its third tile`);

/* ---- asked on both sides ----------------------------------------------------- */
const put = (x: number, y: number, level: number): void => {
  game.player.x = x + 0.5;
  game.player.y = y + 0.5;
  game.player.level = level;
  psql(`update player set x = ${x + 0.5}, y = ${y + 0.5}, level = ${level} where world_id = ${W} and uid = ${DANE};`);
};
const tile = (x: number, y: number, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ kind: 'tile', x, y, cx: x, cy: y, ...extra });
const mineSay = (id: string, t: Record<string, unknown>): string => {
  const gate = cellarGate(game, id, t as never);
  if (gate) return gate;
  return ACTION_BY_ID.get(id)?.check?.(t as never, game) ?? 'ALLOWED';
};
const theirSay = (id: string, t: Record<string, unknown>): string =>
  val(`coalesce(act_refusal(${W}, ${DANE}, '${id}', '${JSON.stringify(t)}'::jsonb), 'ALLOWED')`);
const same = (what: string, id: string, t: Record<string, unknown>, want?: string): void => {
  const mine = mineSay(id, t);
  const theirs = theirSay(id, t);
  check(what, mine === theirs && (want === undefined || mine === want), `browser "${mine}", island "${theirs}"`);
};

/* ---- what stops one being dug --------------------------------------------- */
put(25, 47, 0);
same('a cellar is dug out under a building, and nowhere else', 'dig_cellar', tile(25, 46),
  'A cellar is dug out under a building.');
put(34, 44, 0);
same('nor under one that is not closed in: the ground floor is not a floor yet', 'dig_cellar', tile(34, 44));
put(26, 44, 0);
same(`nor where the rock comes within ${CELLAR_SOIL} of the ground floor at a corner`, 'dig_cellar', tile(26, 44),
  `The rock lies 2 under the ground floor at the shallowest corner here. A cellar is begun in soil, ${CELLAR_SOIL} of it at every corner.`);
put(30, 44, 0);
same(`nor where a cellar ${CELLAR_DEPTH} down would lie under the sea`, 'dig_cellar', tile(30, 44));
put(20, 45, 0);
same('nor by anybody outside the building, through its wall', 'dig_cellar', tile(20, 44),
  'Dig it out from inside that building, on its ground floor or down in its cellar.');
put(21, 44, 0);
same('and a pick has nothing to cut while there is soil over the rock', 'mine_cellar', tile(20, 44),
  `There is soil to dig out here first, ${S} of it, for a shovel.`);
same('and nothing to fill in where nothing is dug', 'fill_cellar', tile(20, 44), 'There is no cellar dug out under this tile.');
same('and no flight goes down where there is no cellar to go down to', 'plan_floor',
  tile(20, 44, { material: 'plank', floorKind: 'stairs', side: 'e', down: true }),
  `Dig the cellar out under it first: it is 0 of ${CELLAR_DEPTH} down.`);
put(PIER[0], PIER[1] - 1, 0);
same('nor is one dug under a deck on piers, whose ground is not dug while the building stands', 'dig_cellar', tile(PIER[0], PIER[1]),
  'A cellar is not dug out under a deck on piers.');
// Next door's cellar is dug out; one of its tiles is raked into a field for as long as this asks, as a glasshouse's is.
w.setTile(24, 45, TileType.Field);
psql(`select land_set_tile(${W}, 24, 45, tile_id('Field'));`);
put(23, 45, 0);
same('and no way down goes in over a field until the field is cleared', 'plan_floor',
  tile(24, 45, { material: 'plank', floorKind: 'stairs', side: 'w', down: true }),
  'There is a field here: clear the field before you plan a way down through it.');
w.setTile(24, 45, TileType.PackedDirt);
psql(`select land_set_tile(${W}, 24, 45, tile_id('Packed dirt'));`);

/* ---- digging one out: the soil, then the rock --------------------------------
 * A go is a slice off the whole tile, one of what that ground gives. Goes are
 * rolled, so each side is run until the tile is through, and what came out of
 * it is counted rather than the goes.
 */
const heightsBefore = [[20, 44], [21, 44], [21, 45], [22, 44], [23, 45]].map(([cx, cy]) => `${w.getHeight(cx, cy)}/${w.getDirt(cx, cy)}`).join(' ');
const theirGround = (): string => [[20, 44], [21, 44], [21, 45], [22, 44], [23, 45]]
  .map(([cx, cy]) => `${val(`land_height(${W}, ${cx}, ${cy})`)}/${val(`land_dirt(${W}, ${cx}, ${cy})`)}`).join(' ');
const theirGroundBefore = theirGround();

const mineDig = (x: number, y: number): { dirt: number; rock: number; refused: string } => {
  const dirt0 = game.inventory.count('dirt');
  const rocky = bedrockAt(w, x, y).yields;
  const rock0 = game.inventory.count(rocky);
  let refused = '';
  for (let go = 0; go < 400; go++) {
    const id = (game.buildings.cellar(x, y)?.dug ?? 0) >= cellarSoil(w, x, y) ? 'mine_cellar' : 'dig_cellar';
    const why = mineSay(id, tile(x, y));
    if (why !== 'ALLOWED') { refused = why; break; }
    ACTION_BY_ID.get(id)?.perform(tile(x, y) as never, game);
  }
  return { dirt: game.inventory.count('dirt') - dirt0, rock: game.inventory.count(rocky) - rock0, refused };
};
const theirDig = (x: number, y: number): { dirt: number; rock: number; refused: string } => {
  const out = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid; go int; why text; act text; dirt0 int; rock0 int; rocky text;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  rocky := (bedrock_at(w, ${x}, ${y})).yields;
  dirt0 := pack_count(w, u, 'dirt'); rock0 := pack_count(w, u, rocky);
  for go in 1..400 loop
    act := case when cellar_rock_next(w, ${x}, ${y}) then 'mine_cellar' else 'dig_cellar' end;
    why := act_refusal(w, u, act, '{"kind":"tile","x":${x},"y":${y},"cx":${x},"cy":${y}}'::jsonb);
    exit when why is not null;
    perform act_perform(w, u, act, '{"kind":"tile","x":${x},"y":${y},"cx":${x},"cy":${y}}'::jsonb);
    update player set stats = jsonb_set(stats, '{stamina}', '1'::jsonb) where world_id = w and uid = u;
  end loop;
  insert into said values ((pack_count(w, u, 'dirt') - dirt0) || '|' || (pack_count(w, u, rocky) - rock0) || '|' || coalesce(why, ''));
end $$;
select k from said;
commit;`).split('\n').pop()!.split('|');
  return { dirt: Number(out[0]), rock: Number(out[1]), refused: out.slice(2).join('|') };
};
// Nothing to carry it away in: the pack takes it all, as much as a test needs. From inside, on the ground floor.
put(21, 44, 0);
const mineFirst = mineDig(20, 44);
const theirFirst = theirDig(20, 44);
check(`a tile dug out gives ${S} dirt for the soil and ${CELLAR_DEPTH - S} rock shards for the rock, on both sides`,
  mineFirst.dirt === S && mineFirst.rock === CELLAR_DEPTH - S && theirFirst.dirt === S && theirFirst.rock === CELLAR_DEPTH - S,
  `browser ${mineFirst.dirt} dirt and ${mineFirst.rock} shards, island ${theirFirst.dirt} and ${theirFirst.rock}`);
check('and then it is a cellar, the whole storey down, on both sides',
  game.buildings.cellarDone(20, 44) && val(`cellar_done(${W}, 20, 44)`) === 't'
    && mineFirst.refused === theirFirst.refused && mineFirst.refused === `The cellar is dug out here, the whole ${CELLAR_DEPTH} down.`,
  `browser "${mineFirst.refused}", island "${theirFirst.refused}"`);

mineDig(21, 44);
theirDig(21, 44);
// The third, over the tin: a pick that cannot work the vein stops at the rock.
game.skills.values.set('mining', 5);
psql(`update skill set value = 5 where world_id = ${W} and uid = ${DANE} and id = 'mining';`);
const mineTin = mineDig(22, 44);
const theirTin = theirDig(22, 44);
check('a seam under the house stops a pick that cannot work it, at the rock, in the same words',
  mineTin.refused === theirTin.refused && mineTin.refused === 'Tin vein needs mining 10 to work. Yours is 5.0.' && mineTin.dirt === S,
  `browser "${mineTin.refused}" after ${mineTin.dirt} dirt, island "${theirTin.refused}" after ${theirTin.dirt}`);
same('and a shovel says where the soil gives out', 'dig_cellar', tile(22, 44),
  `The soil is dug through here, ${S} down. The rest is rock, for a pickaxe.`);
game.skills.values.set('mining', 90);
psql(`update skill set value = 90 where world_id = ${W} and uid = ${DANE} and id = 'mining';`);
const mineOre = mineDig(22, 44);
const theirOre = theirDig(22, 44);
check(`and a pick that can, cuts the rest out as tin ore: ${CELLAR_DEPTH - S} of it, on both sides`,
  mineOre.rock === CELLAR_DEPTH - S && theirOre.rock === CELLAR_DEPTH - S,
  `browser ${mineOre.rock}, island ${theirOre.rock}`);

check('and the ground over the cellar is left exactly as it was, on both sides',
  [[20, 44], [21, 44], [21, 45], [22, 44], [23, 45]].map(([cx, cy]) => `${w.getHeight(cx, cy)}/${w.getDirt(cx, cy)}`).join(' ') === heightsBefore
    && theirGround() === theirGroundBefore && heightsBefore === theirGroundBefore,
  `corners ${heightsBefore}`);
put(20, 45, 0);
same('nor is it dug while the cellar is there', 'dig', tile(21, 45),
  'There is a cellar dug out under that ground. The ground over a cellar is not dug, raised or levelled while the cellar is there.');
same('nor is a building with a cellar under it taken off the plan', 'remove_from_plan', tile(20, 44),
  'Fill in the cellar under it first.');

/* ---- a way down ------------------------------------------------------------- */
// The house's tile at the west end takes a flight climbed from the east: its foot is on the middle tile.
same('a flight down whose foot would come down on solid ground is refused', 'plan_floor',
  tile(21, 44, { material: 'plank', floorKind: 'stairs', side: 's', down: true }),
  'Its foot would come down on 21,45, and there is no cellar dug out there to come down on.');
same('and one coming down on the cellar floor is not', 'plan_floor',
  tile(20, 44, { material: 'plank', floorKind: 'stairs', side: 'e', down: true }), 'ALLOWED');
const flight = bld.setFloor(house, 0, 20, 44, 'plank', 'stairs', 'e');
for (const k of Object.keys(flight.needed)) flight.needed[k] = 0;
psql(`insert into floor_tile (world_id, level, x, y, building, material, kind, facing, needed, total)
      values (${W}, 0, 20, 44, ${house.id}, 'plank', 'stairs', 'e', '{"plank": 0}', '{"plank": 12}');`);
check('a finished flight down is the way in, on both sides',
  !!bld.flightDown(20, 44) && val(`(flight_down(${W}, 20, 44)).kind`) === 'stairs', 'a plank staircase over 20,44, climbed from the east');

/* ---- going down, walking about, coming up ------------------------------------- */
const steps: Array<[string, number, number, number, number, number, number | null]> = [
  ['off the head of the flight toward its foot is down', 20, 44, 0, 21, 44, CELLAR_LEVEL],
  ['along the cellar floor is along it', 21, 44, CELLAR_LEVEL, 22, 44, CELLAR_LEVEL],
  ['into the earth round it is nowhere', 21, 44, CELLAR_LEVEL, 21, 45, null],
  ['nor out of it on the slant', 21, 44, CELLAR_LEVEL, 22, 45, null],
  ['onto the flight from below is up', 21, 44, CELLAR_LEVEL, 20, 44, 0],
  ['onto the open stairwell from its foot, up top, is nowhere', 21, 44, 0, 20, 44, null],
  ['and over the floor up top past it is the ground floor still', 22, 44, 0, 21, 44, 0],
  ['into the cellar of the building next door, across the line between them, is nowhere', 22, 44, CELLAR_LEVEL, 23, 44, null],
  ['nor back out of it', 23, 44, CELLAR_LEVEL, 22, 44, null],
  ['onto a flight from its side is nowhere', 24, 45, CELLAR_LEVEL, 24, 44, null],
  ['nor on the slant', 23, 45, CELLAR_LEVEL, 24, 44, null],
  ['while onto it from its foot is up', 23, 44, CELLAR_LEVEL, 24, 44, 0],
  ['and off it up top across its other sides is the ground floor', 24, 44, 0, 24, 45, 0],
];
const wrongSteps = steps.filter(([, x0, y0, l0, x1, y1, want]) => game.stepRule(x0, y0, l0, x1, y1) !== want);
check('a body goes down the flight, about the cellar floor, and up again, and nowhere else', wrongSteps.length === 0,
  wrongSteps.length ? wrongSteps.map(([s, x0, y0, l0, x1, y1]) => `${s}: ${game.stepRule(x0, y0, l0, x1, y1)}`).join('; ')
    : steps.map(([s]) => s).join('; '));
game.player.x = 20.5;
game.player.y = 44.5;
game.player.level = 0;
const walked = game.player.walkTo(w, 22, 44, game.stepRule, game.movement().levels, game.movement().below, CELLAR_LEVEL);
const route = (game.player.path ?? []).map((p) => `${p.x},${p.y}@${p.level}`).join(' ');
check('and a walk to the far end of the cellar goes down the flight to get there', walked && route === `21,44@${CELLAR_LEVEL} 22,44@${CELLAR_LEVEL}`, route);
game.player.path = null;

/** Where the island leaves a body that says it walked from here to there, and on which storey. */
const theirMove = (x0: number, y0: number, l0: number, x1: number, y1: number, l1: number): string => {
  psql(`update player set x = ${x0}, y = ${y0}, level = ${l0}, moved_at = now() - interval '10 seconds', away = false
          where world_id = ${W} and uid = ${DANE};`);
  psql(`select set_config('request.jwt.claims', json_build_object('sub', ${DANE})::text, false) \\g /dev/null
        select rpc_move(${W}, ${x1}, ${y1}, ${l1});`);
  return val(`(select floor(x) || ',' || floor(y) || '@' || level from player where world_id = ${W} and uid = ${DANE})`);
};
const moves: Array<[string, number, number, number, number, number, number, string]> = [
  ['a walk down the flight is taken', 20.5, 44.5, 0, 21.5, 44.5, -1, '21,44@-1'],
  ['and along the cellar floor', 21.5, 44.5, -1, 22.5, 44.5, -1, '22,44@-1'],
  ['but not into the earth round it', 21.5, 44.5, -1, 21.5, 45.5, -1, '21,44@-1'],
  ['nor down into a cellar anywhere but beside the way down', 22.5, 44.5, 0, 22.6, 44.5, -1, '22,44@0'],
  ['nor into a cellar that is not there', 24.5, 46.5, 0, 24.6, 46.5, -1, '24,46@0'],
  ['and a walk up the flight is taken', 21.5, 44.5, -1, 20.5, 44.5, 0, '20,44@0'],
  ['but not up off the foot of it without stepping onto it', 21.5, 44.5, -1, 21.6, 44.5, 0, '21,44@-1'],
  ['nor down onto its foot from anywhere but off the flight', 22.5, 44.5, 0, 21.5, 44.5, -1, '22,44@0'],
  ['nor into the cellar of the building next door', 22.5, 44.5, -1, 23.5, 44.5, -1, '22,44@-1'],
  ['nor up onto a flight from its side', 24.5, 45.5, -1, 24.5, 44.5, 0, '24,45@-1'],
  ['nor down off a flight across a side it is not climbed from', 24.5, 44.5, 0, 24.5, 45.5, -1, '24,44@0'],
  ['while up onto it from its foot is taken', 23.5, 44.5, -1, 24.5, 44.5, 0, '24,44@0'],
  ['and down off it onto its foot', 24.5, 44.5, 0, 23.5, 44.5, -1, '23,44@-1'],
];
/*
 * By now Dane has the whole of the cellar's dirt and rock in his pack, half
 * again past what his back takes, and a body that laden creeps at a twentieth
 * of a walk (`carry_crawl`): at the pace his legs carry him that is less than a
 * tile in the ten seconds the island counts at most, and every step below would
 * be pulled short of the flight. These are about the way down and not the
 * load, so his back is made strong enough for them, and put back after.
 */
const strength = val(`coalesce((select value::text from skill where world_id = ${W} and uid = ${DANE} and id = 'body_strength'), 'none')`);
psql(`delete from skill where world_id = ${W} and uid = ${DANE} and id = 'body_strength';
      insert into skill (world_id, uid, id, value) values (${W}, ${DANE}, 'body_strength', 10000);`);
const wrongMoves = moves.filter(([, x0, y0, l0, x1, y1, l1, want]) => theirMove(x0, y0, l0, x1, y1, l1) !== want);
check('the island holds a body to the cellar floor and its way down the same way', wrongMoves.length === 0,
  wrongMoves.length ? wrongMoves.map(([s, x0, y0, l0, x1, y1, l1]) => `${s}: ${theirMove(x0, y0, l0, x1, y1, l1)}`).join('; ')
    : moves.map(([s]) => s).join('; '));
psql(`delete from skill where world_id = ${W} and uid = ${DANE} and id = 'body_strength';
      ${strength === 'none' ? '' : `insert into skill (world_id, uid, id, value) values (${W}, ${DANE}, 'body_strength', ${strength});`}`);

/* ---- nothing let go of over the stairwell ------------------------------------------ */
const plank = { kind: 'item', uid: Number(psql(`insert into item (world_id, holder, holder_uid, def, ql, count)
  values (${W}, 'player', ${DANE}, 'plank', 10, 1) returning id;`).split('\n')[0]) };
put(20, 44, 0);
same('nothing is dropped standing on the head of a flight down, up top, where it would lie over the stairwell, on both sides',
  'drop', plank, 'Not on the stairs: step off them first.');
put(21, 44, 0);
same('and a step off it onto the floor beside it, it is', 'drop', plank, 'ALLOWED');
psql(`delete from item where id = ${plank.uid};`);

/* ---- what is kept down there ---------------------------------------------------- */
put(21, 44, CELLAR_LEVEL);
const bread = (): Item => game.inventory.add('bread', { ql: 40, count: 3 });
const loaf = bread();
ACTION_BY_ID.get('drop')?.perform({ kind: 'item', uid: loaf.uid, count: 3 } as never, game);
const downHere = game.groundAt(21, 44, CELLAR_LEVEL);
island(`
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'bread', 40, 3);
  perform act_perform(w, u, 'drop', jsonb_build_object('kind', 'item', 'uid',
    (select id from item where world_id = w and holder = 'player' and holder_uid = u and def = 'bread' limit 1), 'count', 3));`);
const theirDown = val(`(select count(*) || '|' || coalesce(sum(count), 0) from item where world_id = ${W} and holder = 'cellar' and gx = 21 and gy = 44 and def = 'bread')`);
check('what is dropped down there lies on the cellar floor, and not on the ground over it, on both sides',
  downHere.length === 1 && downHere[0].count === 3 && game.groundAt(21, 44).length === 0 && theirDown === '1|3'
    && val(`(select count(*) from item where world_id = ${W} and holder = 'ground' and gx = 21 and gy = 44)`) === '0',
  `browser ${downHere.map((it) => `${it.count} ${it.id}`).join(', ')}, island ${theirDown}`);
check('and a cellar keeps it at a twentieth of the rate out of doors, on both sides',
  Math.abs(game.decayMultiplier(21, 44, CELLAR_LEVEL) - CELLAR_DECAY) < 1e-12
    && Math.abs(Number(val(`cellar_decay_multiplier(${W}, 21, 44)`)) - CELLAR_DECAY) < 1e-12
    && Math.abs(game.decayMultiplier(24, 46) - 1) < 1e-12,
  `browser ${game.decayMultiplier(21, 44, CELLAR_LEVEL)} against ${game.decayMultiplier(24, 46)} out of doors, island ${val(`cellar_decay_multiplier(${W}, 21, 44)`)}`);

// An hour on both sides: the browser's rot, and the island's sweep over the same hour.
const before = downHere[0].dmg;
game.applyDecay(3600);
const mineRot = (game.groundAt(21, 44, CELLAR_LEVEL)[0]?.dmg ?? 100) - before;
psql(`update item set dmg = 0, rot_at = now() - interval '1 hour' where world_id = ${W} and holder = 'cellar' and def = 'bread';`);
psql(`select cellar_sweep(${W});`);
const theirRot = Number(val(`(select dmg from item where world_id = ${W} and holder = 'cellar' and def = 'bread' limit 1)`));
const want = groundDecayRate(downHere[0]) * CELLAR_DECAY;
check('and an hour down there takes off it what a twentieth of an hour out of doors would, on both sides',
  Math.abs(mineRot - want) < 1e-6 && Math.abs(theirRot - want) < 1e-3,
  `browser ${mineRot.toFixed(4)}, island ${theirRot.toFixed(4)}, a twentieth of ${groundDecayRate(downHere[0]).toFixed(4)}`);
const bedTarget = tile(22, 44, { itemUid: 0, sx: 0, sy: 0, facing: 's' });
game.inventory.add('oven', { ql: 30 });
const oven = game.inventory.items.find((it) => it.id === 'oven')!;
island(`insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'oven', 30, 1);`);
const theirOven = val(`(select id from item where world_id = ${W} and holder = 'player' and holder_uid = ${DANE} and def = 'oven' limit 1)`);
const mineOvenSay = mineSay('place_furniture', { ...bedTarget, itemUid: oven.uid });
const theirOvenSay = theirSay('place_furniture', { ...bedTarget, itemUid: Number(theirOven) });
check('nothing that burns an open fire is set down in a cellar, in the same words',
  mineOvenSay === theirOvenSay && mineOvenSay === 'Nothing that burns an open fire goes down into a cellar.',
  `browser "${mineOvenSay}", island "${theirOvenSay}"`);
game.inventory.add('chest', { ql: 30 });
const chest = game.inventory.items.find((it) => it.id === 'chest')!;
island(`insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'chest', 30, 1);`);
const theirChest = val(`(select id from item where world_id = ${W} and holder = 'player' and holder_uid = ${DANE} and def = 'chest' limit 1)`);
const chestAt = { ...bedTarget, itemUid: chest.uid };
const mineChestSay = mineSay('place_furniture', chestAt);
const theirChestSay = theirSay('place_furniture', { ...bedTarget, itemUid: Number(theirChest) });
check('while a chest is', mineChestSay === theirChestSay && mineChestSay === 'ALLOWED', `browser "${mineChestSay}", island "${theirChestSay}"`);
// Every piece goes down, but for what burns, what rolls or floats, and the pieces named: as a table does, and a stall does not.
const pieceSay = (id: string): [string, string] => {
  const mine = game.inventory.add(id, { ql: 30 });
  const theirs = Number(psql(`insert into item (world_id, holder, holder_uid, def, ql, count)
    values (${W}, 'player', ${DANE}, '${id}', 30, 1) returning id;`).split('\n').pop());
  const said: [string, string] = [mineSay('place_furniture', { ...bedTarget, itemUid: mine.uid }), theirSay('place_furniture', { ...bedTarget, itemUid: theirs })];
  game.inventory.remove(mine.uid, 1);
  psql(`delete from item where id = ${theirs};`);
  return said;
};
const pieces: Array<[string, string]> = [
  ['table', 'ALLOWED'], ['chair', 'ALLOWED'], ['crate_shelf', 'ALLOWED'],
  ['stall', 'A market stall does not go down into a cellar.'],
  ['lamp_post', 'A lantern post does not go down into a cellar.'],
  ['lamp_pillar', 'A lantern pillar does not go down into a cellar.'],
  ['cart', 'Nothing on wheels or afloat goes down into a cellar.'],
];
const piecesSaid = pieces.map(([id]) => [id, ...pieceSay(id)]);
check('every piece goes down into a cellar but those named, in the same words: a table and a chair do; a stall, a lantern post or pillar and a cart do not',
  piecesSaid.every(([id, mine, theirs], i) => mine === theirs && mine === pieces[i][1] && id === pieces[i][0]),
  piecesSaid.map(([id, mine, theirs]) => `${id}: browser "${mine}", island "${theirs}"`).join('; '));
ACTION_BY_ID.get('place_furniture')?.perform(chestAt as never, game);
const mineChest = [...game.furniture.values()].find((f) => f.kind === 'chest');
// On the island through the door everybody uses: asked, and settled when its time is up.
psql(`select set_config('request.jwt.claims', json_build_object('sub', ${DANE})::text, false) \\g /dev/null
      select rpc_act(${W}, 'place_furniture', '${JSON.stringify({ ...bedTarget, itemUid: Number(theirChest) })}'::jsonb) \\g /dev/null
      update player set act_ends = now() - interval '1 second' where world_id = ${W} and uid = ${DANE};
      select settle(${W}, ${DANE});`);
const theirPiece = val(`(select coalesce(max(level), 99) from placed where world_id = ${W} and sub = 'chest' and x = 22 and y = 44)`);
check('and set down from down there, it is down there, on both sides',
  mineChest?.level === CELLAR_LEVEL && theirPiece === String(CELLAR_LEVEL), `browser ${mineChest?.level}, island ${theirPiece}`);
// And a crate, in the far corner of the same tile.
const myCrate = game.inventory.add('crate_plank', { ql: 30 });
island(`insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'crate_plank', 30, 1);`);
const theirCrateItem = Number(val(`(select id from item where world_id = ${W} and holder = 'player' and holder_uid = ${DANE} and def = 'crate_plank' limit 1)`));
const crateSpot = tile(22, 44, { sx: 3, sy: 3, itemUid: myCrate.uid });
const mineCrateSay = mineSay('place_crate', crateSpot);
const theirCrateSay = theirSay('place_crate', { ...crateSpot, itemUid: theirCrateItem });
ACTION_BY_ID.get('place_crate')?.perform(crateSpot as never, game);
psql(`select set_config('request.jwt.claims', json_build_object('sub', ${DANE})::text, false) \\g /dev/null
      select rpc_act(${W}, 'place_crate', '${JSON.stringify({ ...crateSpot, itemUid: theirCrateItem })}'::jsonb) \\g /dev/null
      update player set act_ends = now() - interval '1 second' where world_id = ${W} and uid = ${DANE};
      select settle(${W}, ${DANE});`);
const mineCrateLevel = game.cratesOnTile(22, 44).map((k) => k.level ?? 0).join(',');
const theirCrateLevel = val(`(select coalesce(string_agg(level::text, ','), '') from crate where world_id = ${W} and x = 22 and y = 44)`);
check('and a crate set down from down there is down there too, on both sides',
  mineCrateSay === 'ALLOWED' && theirCrateSay === 'ALLOWED' && mineCrateLevel === String(CELLAR_LEVEL) && theirCrateLevel === String(CELLAR_LEVEL),
  `browser "${mineCrateSay}" at ${mineCrateLevel}, island "${theirCrateSay}" at ${theirCrateLevel}`);

// A night in a bed down there, under a house with walls and no roof: a cellar is indoors, roof or none, on both sides.
const bedItem = game.inventory.add('bed', { ql: 50 });
ACTION_BY_ID.get('place_furniture')?.perform(tile(21, 44, { itemUid: bedItem.uid, sx: 0, sy: 0, facing: 's' }) as never, game);
const myBed = [...game.furniture.values()].find((f) => f.kind === 'bed');
const theirBed = Number(psql(`insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, level)
  values (${W}, 'furniture', 'bed', 21, 44, 0, 0, 21.375, 44.25, 50, -1) returning id;`).split('\n').pop());
game.player.stats.health = 0;
if (myBed) ACTION_BY_ID.get('sleep')?.perform({ kind: 'furniture', id: myBed.id } as never, game);
const mineRest = game.player.stats.health;
island(`update player set stats = jsonb_set(stats, '{health}', '0'::jsonb) where world_id = w and uid = u;
  perform perform_last(w, u, 'sleep', jsonb_build_object('kind', 'furniture', 'id', ${theirBed}));`);
const theirRest = Number(val(`(select (stats->>'health')::double precision from player where world_id = ${W} and uid = ${DANE})`));
const wantRest = 0.25 * (furnitureDef('bed').bed ?? 1) * (0.6 + 50 / 250) * INDOORS_REST;
check('a night in a bed down there rests as a night indoors does, though the house over it has no roof, on both sides',
  myBed?.level === CELLAR_LEVEL && Math.abs(mineRest - wantRest) < 1e-9 && Math.abs(theirRest - wantRest) < 1e-6,
  `health back ${mineRest.toFixed(3)} in the browser, ${theirRest.toFixed(3)} on the island, ${wantRest.toFixed(3)} with the indoor ${INDOORS_REST}`);
if (myBed) game.removeFurniture(myBed.id);
psql(`delete from placed where id = ${theirBed};`);

/* ---- reached from down there, and only from down there ------------------------------ */
const mineChestTarget = { kind: 'furniture', id: mineChest?.id ?? -1 };
const theirChestTarget = { kind: 'furniture', id: Number(val(`(select id from placed where world_id = ${W} and sub = 'chest' and x = 22 and y = 44 limit 1)`)) };
put(22, 44, 0);
const upMine = cellarGate(game, 'pick_up_furniture', mineChestTarget as never);
const upTheirs = theirSay('pick_up_furniture', theirChestTarget);
check('a piece down in the cellar is not reached from the floor over it, in the same words',
  upMine === upTheirs && upMine === 'That is down in the cellar.', `browser "${upMine}", island "${upTheirs}"`);
const pileMine = mineSay('pick_up', { kind: 'ground', x: 21, y: 44, uid: null, down: true });
const pileTheirs = theirSay('pick_up', { kind: 'ground', x: 21, y: 44, uid: null, down: true });
check('nor what lies down there', pileMine === pileTheirs && pileMine === 'That is down in the cellar.', `browser "${pileMine}", island "${pileTheirs}"`);
put(21, 44, CELLAR_LEVEL);
same('and from down there a tree up top is out of reach too', 'cut_down', tile(21, 45), 'You are down in the cellar. Go up to do that.');
// A shop counter is set in a wall of the ground floor: whatever is in reach of it, nothing goes onto it or comes off it from down here.
same('and so is a shop counter, to set goods out on', 'set_out_goods', { kind: 'item', uid: 1, into: 1 }, 'You are down in the cellar. Go up to do that.');
same('or to take them back off it', 'take_off_counter', { kind: 'item', uid: 1 }, 'You are down in the cellar. Go up to do that.');
same('while what lies down there is picked up from down there', 'pick_up', { kind: 'ground', x: 21, y: 44, uid: null, down: true }, 'ALLOWED');

// The cellar of the building next door is the far side of solid ground: nothing in it is reached, swept or dug from this one.
const nextLoaf = game.inventory.add('bread', { ql: 40, count: 2 });
game.inventory.remove(nextLoaf.uid, 2);
game.dropOnGround(23, 44, { ...nextLoaf, count: 2 }, CELLAR_LEVEL);
psql(`insert into item (world_id, holder, gx, gy, def, ql, count) values (${W}, 'cellar', 23, 44, 'bread', 40, 2);`);
put(22, 44, CELLAR_LEVEL);
same('from the cellar beside it, nothing lying in the cellar next door is picked up', 'pick_up', { kind: 'ground', x: 23, y: 44, uid: null, down: true },
  "That is in another building's cellar.");
same('nor swept up with what lies in this one', 'pick_up_all', tile(23, 44), 'There is nothing lying about here.');
same('nor is a tile of it dug out from this one', 'dig_cellar', tile(23, 44), 'Dig it out from inside that building, on its ground floor or down in its cellar.');
const sideMine = [game.onMySide(CELLAR_LEVEL, 23, 44), game.onMySide(CELLAR_LEVEL, 22, 44)].join(',');
const sideTheirs = psql(`select set_config('wurm.floor', floor_said(${W}, -1, 22.5, 44.5), false) \\g /dev/null
  select same_floor(-1, ${W}, 23, 44)::text || ',' || same_floor(-1, ${W}, 22, 44)::text;`).split('\n').pop();
check('and what stands in it is out of reach of this one: a store there is not on your side of the ground, on both sides',
  sideMine === 'false,true' && sideTheirs === 'false,true', `browser ${sideMine}, island ${sideTheirs}`);
game.takeFromGround(23, 44, null, CELLAR_LEVEL);
psql(`delete from item where world_id = ${W} and holder = 'cellar' and gx = 23 and gy = 44;`);

/* ---- filling one in ---------------------------------------------------------------- */
put(21, 44, 0);
same('a cellar tile with something lying on it is not filled in', 'fill_cellar', tile(21, 44), 'Clear away what is lying down there first.');
same('nor one with a piece standing on it', 'fill_cellar', tile(22, 44), 'Carry out what stands down there first.');
game.takeFromGround(21, 44, null, CELLAR_LEVEL);
psql(`delete from item where world_id = ${W} and holder = 'cellar' and gx = 21 and gy = 44;`);
same('and once it is cleared, the flight down that comes down on it still holds it', 'fill_cellar', tile(21, 44),
  'The staircase down to the cellar stands on it. Take it out first.');
// Somebody else down there, on both sides: the way up is not taken out from over them.
const crowdWas = val(`(select x || ', y = ' || y || ', level = ' || level from player where world_id = ${W} and name = 'Crowd1')`);
put(19, 44, 0);
game.roster.saw({ id: 9001, name: 'Crowd1', x: 21.5, y: 44.5, dirX: 1, dirY: 0, level: CELLAR_LEVEL,
  moving: false, swimming: false, working: false } as never);
psql(`update player set x = 21.5, y = 44.5, level = -1 where world_id = ${W} and name = 'Crowd1';`);
same('nobody takes the way up out from over somebody down there', 'remove_floor',
  tile(20, 44, { floorKind: 'stairs', down: true }), 'Somebody is down in the cellar, and this is a way up out of it.');

// The far tile: the chest carried out, and filled back in a slice at a time out of the dirt dug from it.
for (const f of [...game.furniture.values()].filter((p) => p.kind === 'chest')) game.removeFurniture(f.id);
for (const k of game.cratesOnTile(22, 44)) game.removeCrate(k.id);
psql(`delete from placed where world_id = ${W} and sub = 'chest' and x = 22 and y = 44;
      delete from crate where world_id = ${W} and x = 22 and y = 44;`);
put(21, 44, 0);
game.roster.saw({ id: 9001, name: 'Crowd1', x: 22.5, y: 44.5, dirX: 1, dirY: 0, level: CELLAR_LEVEL,
  moving: false, swimming: false, working: false } as never);
psql(`update player set x = 22.5, y = 44.5, level = -1 where world_id = ${W} and name = 'Crowd1';`);
same('nor is a tile filled in over somebody standing on it down there', 'fill_cellar', tile(22, 44), 'Somebody is standing down there.');
game.roster.sawAll([]);
psql(`update player set x = ${crowdWas} where world_id = ${W} and name = 'Crowd1';`);
// Ten more dirt than the soil gave back: the rock dug out of a tile is not put back as rock.
game.inventory.add('dirt', { ql: 20, count: 10 });
island(`insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', u, 'dirt', 20, 10);`);
const mineFill = (): number => {
  let n = 0;
  while (mineSay('fill_cellar', tile(22, 44)) === 'ALLOWED' && n < 100) {
    ACTION_BY_ID.get('fill_cellar')?.perform(tile(22, 44) as never, game);
    n++;
  }
  return n;
};
const filledMine = mineFill();
const filledTheirs = Number(psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid; n int := 0;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  while act_refusal(w, u, 'fill_cellar', '{"kind":"tile","x":22,"y":44,"cx":22,"cy":44}'::jsonb) is null and n < 100 loop
    perform act_perform(w, u, 'fill_cellar', '{"kind":"tile","x":22,"y":44,"cx":22,"cy":44}'::jsonb);
    update player set stats = jsonb_set(stats, '{stamina}', '1'::jsonb) where world_id = w and uid = u;
    n := n + 1;
  end loop;
  insert into said values (n::text);
end $$;
select k from said;
commit;`).split('\n').pop());
check(`a tile is filled back in a slice a go, ${CELLAR_DEPTH} of them, and is ground again, on both sides`,
  filledMine === CELLAR_DEPTH && filledTheirs === CELLAR_DEPTH && !game.buildings.cellar(22, 44)
    && val(`(cellar_at(${W}, 22, 44)).world_id is null`) === 't',
  `browser ${filledMine} goes, island ${filledTheirs}`);

/* ---- what is said, and what a browser is told ----------------------------------------- */
game.log.length = 0;
ACTION_BY_ID.get('examine')?.perform(tile(20, 44) as never, game);
const mineLook = game.log.map((l) => l.text).find((t) => t.startsWith('You see')) ?? '';
const theirLook = val(`examine_tile_text(${W}, 20, 44, ${DANE})`);
check('an examine says a cellar is dug out under the tile, in the same words',
  mineLook.includes(`A cellar is dug out under it, ${CELLAR_DEPTH} deep.`) && theirLook.includes(`A cellar is dug out under it, ${CELLAR_DEPTH} deep.`),
  theirLook);

island(`insert into item (world_id, holder, gx, gy, def, ql, count) values (w, 'cellar', 21, 44, 'bread', 40, 2);`);
put(21, 44, CELLAR_LEVEL);
const ground = JSON.parse(psql(`select set_config('request.jwt.claims', json_build_object('sub', ${DANE})::text, false) \\g /dev/null
  select rpc_ground(${W}, 40, true)::text;`).split('\n').pop()!);
game.sawGround(ground);
check('a browser told about the island hears of the cellar and what lies in it',
  game.buildings.cellarDone(20, 44) && game.buildings.cellarDone(21, 44) && !game.buildings.cellar(22, 44)
    && game.groundAt(21, 44, CELLAR_LEVEL).length === 1 && game.groundAt(21, 44).length === 0,
  `${(ground.buildings?.cellars ?? []).length} cellar tiles, ${(ground.cellarLying ?? []).length} thing on a cellar floor`);

// And from down there, a tile of the cellar is its floor: what it is cut in, how deep, and what lies on it.
game.log.length = 0;
ACTION_BY_ID.get('examine')?.perform(tile(21, 44) as never, game);
const mineBelow = game.log.map((l) => l.text).find((t) => t.startsWith('You see')) ?? '';
const theirBelow = psql(`select set_config('wurm.floor', floor_said(${W}, -1, 21.5, 44.5), false) \\g /dev/null
  select examine_tile_text(${W}, 21, 44, ${DANE});`).split('\n').pop() ?? '';
check('an examine from down in the cellar says its floor, in the same words',
  mineBelow === theirBelow && mineBelow === `You see the floor of the cellar under Cellar house at (21, 44): rock, ${CELLAR_DEPTH} under the ground floor, at height ${(H - CELLAR_DEPTH).toFixed(1)}. 2 things lie on it.`,
  `browser "${mineBelow}", island "${theirBelow}"`);

/* ---- a way down where the ground floor is floored ------------------------------------------ */
// It takes the flooring up, as taking the flooring up would -- which on a walled tile is not to be had while the wall stands.
put(21, 45, 0);
const boards = bld.setFloor(house, 0, 21, 44, 'plank', 'floor');
for (const k of Object.keys(boards.needed)) boards.needed[k] = 0;
psql(`insert into floor_tile (world_id, level, x, y, building, material, kind, facing, needed, total)
      values (${W}, 0, 21, 44, ${house.id}, 'plank', 'floor', null, '{"plank": 0}', '{"plank": 6}');`);
const ladderDown = tile(21, 44, { material: 'plank', floorKind: 'ladder', side: 'w', down: true });
same('a ladder down goes in over the flooring of the ground floor', 'plan_floor', ladderDown, 'ALLOWED');
ACTION_BY_ID.get('plan_floor')?.perform(ladderDown as never, game);
island(`perform act_perform(w, u, 'plan_floor', '${JSON.stringify(ladderDown)}'::jsonb);`);
const theirKind = val(`(select kind from floor_tile where world_id = ${W} and level = 0 and x = 21 and y = 44)`);
check('and takes the flooring up where it goes, on both sides',
  bld.floor(0, 21, 44)?.kind === 'ladder' && theirKind === 'ladder', `browser ${bld.floor(0, 21, 44)?.kind}, island ${theirKind}`);
bld.removeFloor(0, 21, 44);

/* ---- and what stands down there lights nothing up top ------------------------------------ */
// An altar glows at night where it stands: set down in a cellar, it does not glow on the ground floor over it.
game.time = 0;
const altar = { id: 99001, kind: 'altar', x: 21, y: 44, sx: 0, sy: 0, ql: 40, items: [] as Item[], level: CELLAR_LEVEL as number | undefined };
game.furniture.set(altar.id, altar as never);
const altarGlows = (): number => {
  const [ax, ay] = furnitureCentre(altar as never);
  return game.lights().filter((l) => l.x === ax && l.y === ay && l.radius === ALTAR_REACH && l.cast === ALTAR_CAST).length;
};
const glowDown = altarGlows();
altar.level = undefined;
const glowUp = altarGlows();
game.furniture.delete(altar.id);
check('an altar down in a cellar throws no glow on the ground over it at night, where one up top does',
  game.darkness() > 0.5 && glowDown === 0 && glowUp === 1, `${glowDown} glow from down there, ${glowUp} from up top`);

/* ---- a fight down there ------------------------------------------------------------------ */
// It is the dead of night down there at every hour, for what a fight teaches of Awareness as for the eye: a blow at noon
// down there teaches it, and one at noon up top does not, on both sides.
game.time = DAY_SECONDS / 2;
put(21, 44, CELLAR_LEVEL);
const awareMine = (): number => game.skills.get('awareness');
let aware0 = awareMine();
game.fought(1);
const mineBelowGain = awareMine() - aware0;
put(21, 44, 0);
aware0 = awareMine();
game.fought(1);
const mineAboveGain = awareMine() - aware0;
const awareTheirs = (): number => Number(val(`coalesce((select value from skill where world_id = ${W} and uid = ${DANE} and id = 'awareness'), 0)`));
put(21, 44, CELLAR_LEVEL);
const theirs0 = awareTheirs();
psql(`select fought_in_dark(${W}, ${DANE}, 1);`);
const theirBelowGain = awareTheirs() - theirs0;
check('a fight down in a cellar teaches Awareness at noon, as the dead of night does, and one up top at noon does not, on both sides',
  mineBelowGain > 0 && mineAboveGain === 0 && theirBelowGain > 0,
  `browser ${mineBelowGain.toFixed(4)} down there and ${mineAboveGain} up top, island ${theirBelowGain.toFixed(4)} down there`);

/* ---- one way off the ground floor a tile ------------------------------------------------- */
// Next door goes up a storey: no staircase up stands over its way down, and no way down under a staircase up.
// (The browser's buildings are the island's since it was told about them: the one in its list, not the one made here.)
const nextNow = bld.list.get(next.id) ?? next;
nextNow.levels = 2;
nextNow.workLevel = 1;
psql(`update building set levels = 2, work_level = 1 where world_id = ${W} and id = ${next.id};`);
put(24, 45, 0);
same('a staircase up is not planned over the way down to the cellar', 'plan_floor',
  tile(24, 44, { material: 'plank', floorKind: 'stairs', side: 'w' }), 'The staircase down to the cellar is there.');
const upstairs = bld.setFloor(nextNow, 1, 24, 45, 'plank', 'stairs', 'n');
psql(`insert into floor_tile (world_id, level, x, y, building, material, kind, facing, needed, total)
      values (${W}, 1, 24, 45, ${next.id}, 'plank', 'stairs', 'n', '{"plank": 12}', '{"plank": 12}');`);
same('nor a way down under a staircase up', 'plan_floor',
  tile(24, 45, { material: 'plank', floorKind: 'stairs', side: 'n', down: true }), 'The staircase up to the next storey is there.');
bld.removeFloor(1, upstairs.x, upstairs.y);

/* ---- and tidied away, so nothing after this finds a cellar under it ---------------------- */
island(`
  delete from item where world_id = w and holder in ('cellar', 'ground') and gx between 18 and 40 and gy between 42 and 48;
  delete from cellar_tile where world_id = w;
  delete from floor_tile where world_id = w;
  delete from wall where world_id = w;
  delete from building_tile where world_id = w;
  delete from building where world_id = w;
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def in ('dirt', 'rock_shards', 'tin_ore', 'oven', 'chest', 'bread', 'crate_plank');
  update player set level = 0, x = 32.5, y = 32.5 where world_id = w and uid = u;`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a cellar is dug out, walked down into and filled in the same way on both sides, and keeps what lies in it longest — ${ok.length} of ${ok.length}`);
