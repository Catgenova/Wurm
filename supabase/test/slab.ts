/**
 * A foundation is the same slab on both sides.
 *
 * Asked for: "implement concrete foundations. A foundation can be Planned
 * using a mallet. Foundations require the tile to NOT be level. The plan would
 * provide a recipe that would be Concrete x5 per tile corner elevation raised
 * to bring the whole tile up to a chosen elevation."
 *
 * Two numbers decide everything about one: what it costs, which is the hole it
 * fills priced by the step, and how deep the deepest part of that pour is,
 * which is what it asks of your masonry. Both are worked out twice — once in
 * TypeScript for the browser's menu and once in Postgres for the island's
 * answer — so a plan the browser offers has to be a plan the island takes, to
 * the barrowful. That is what this puts to them: the same tiles, the same
 * questions, and the two answers held against each other.
 *
 * And asked for since: "Establish that all dirt must be dug from a tile before
 * planning a foundation. Remove the option from dirt/grass etc tiles.
 * Foundations can be planned on rocks or seams or ores." So every tile here is
 * dug bare first, and the soil rule is put to both sides on its own.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { concreteFor, foundationDone, liftFor, masonryFor, soilSays, CONCRETE_PER_STEP, FOUNDATION_ACTIONS, LIFT_PER_MASONRY } from '../../src/game/foundations';
import { isSeam, ROCK_VARIANTS, TileType } from '../../src/world/tiles';

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

const field = (tag: string, from: string): string =>
  from.split('\n').map((l) => l.trim()).find((l) => l.startsWith(`${tag}|`))?.slice(tag.length + 1) ?? '';

/* ---- the same corner heights, put to both sides -------------------------- */
/** A handful of tiles worth asking about: a step, a wedge, a cliff, a hollow, a flat. */
const SHAPES: Array<[string, number, number, number, number]> = [
  ['a single step', 10, 10, 4, 4],
  ['a wedge off one corner', 12, 12, 12, 3],
  ['a cliff face', 40, 40, 1, 1],
  ['a shallow tilt', 8, 7, 6, 5],
  ['a hollow under the sea', -6, -4, -9, -7],
  ['level ground', 9, 9, 9, 9],
];
/** Where on the island these are tried out, well clear of anything. */
const TX = 60;
const TY = 60;

const game = Game.create(4242);
/** The four corners' heights, and the soil on them: none unless it is said, since a foundation goes on bare rock. */
const setShape = (h: [number, number, number, number], soil: [number, number, number, number] = [0, 0, 0, 0]): void => {
  game.world.setHeight(TX, TY, h[0]);
  game.world.setHeight(TX + 1, TY, h[1]);
  game.world.setHeight(TX + 1, TY + 1, h[2]);
  game.world.setHeight(TX, TY + 1, h[3]);
  game.world.setDirt(TX, TY, soil[0]);
  game.world.setDirt(TX + 1, TY, soil[1]);
  game.world.setDirt(TX + 1, TY + 1, soil[2]);
  game.world.setDirt(TX, TY + 1, soil[3]);
};
/** The same corners bared on the island, in a block that has `w` in hand. */
const bareSql = (x: number, y: number): string =>
  [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].map(([cx, cy]) => `perform land_set_dirt(w, ${cx}, ${cy}, 0);`).join(' ');

const island = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid; s record;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  update player set x = ${TX}.5, y = ${TY}.5, level_h = null where world_id = w and uid = u;
  insert into skill (world_id, uid, id, value) values (w, u, 'masonry', 99)
    on conflict (world_id, uid, id) do update set value = 99;
  delete from foundation f where f.world_id = w;
  ${bareSql(TX, TY)}
  for s in select * from (values ${SHAPES.map(([, a, b, c, d], i) => `(${i}, ${a}, ${b}, ${c}, ${d})`).join(', ')})
             v(i, n, e, s, w2) loop
    perform land_set_height(w, ${TX}, ${TY}, s.n);
    perform land_set_height(w, ${TX + 1}, ${TY}, s.e);
    perform land_set_height(w, ${TX + 1}, ${TY + 1}, s.s);
    perform land_set_height(w, ${TX}, ${TY + 1}, s.w2);
    insert into said values ('SHAPE|' || s.i || '|' ||
      concrete_for(w, ${TX}, ${TY}, foundation_top(w, u, ${TX}, ${TY})) || '|' ||
      lift_for(w, ${TX}, ${TY}, foundation_top(w, u, ${TX}, ${TY})) || '|' ||
      coalesce(foundation_reason(w, u, ${TX}, ${TY}, foundation_top(w, u, ${TX}, ${TY})), 'ALLOWED'));
  end loop;
end $$;
select k from said;
rollback;
`).split('\n').map((l) => l.trim());

let agreed = 0;
for (let i = 0; i < SHAPES.length; i++) {
  const [name, ...h] = SHAPES[i];
  setShape(h as [number, number, number, number]);
  const corners = game.world.tileCorners(TX, TY);
  const top = Math.max(...corners);
  const mine = { want: concreteFor(corners, top), lift: liftFor(corners, top) };
  const row = island.find((l) => l.startsWith(`SHAPE|${i}|`))?.split('|') ?? [];
  const theirs = { want: Number(row[2]), lift: Number(row[3]) };
  const same = mine.want === theirs.want && mine.lift === theirs.lift;
  if (same) agreed++;
  check(`${name} costs the same on both sides`, same,
    `${mine.want} concrete over a lift of ${mine.lift}, the island ${theirs.want} over ${theirs.lift}`);
}
check('and that is every shape put to them', agreed === SHAPES.length, `${agreed} of ${SHAPES.length}`);

/* ---- the price is the hole, by the step ---------------------------------- */
setShape([10, 10, 4, 4]);
check('a step of six over half a tile is twelve steps of concrete',
  concreteFor(game.world.tileCorners(TX, TY), 10) === 12 * CONCRETE_PER_STEP,
  `${concreteFor(game.world.tileCorners(TX, TY), 10)} at ${CONCRETE_PER_STEP} a step`);
check('and pouring a course higher costs four steps more, one a corner',
  concreteFor(game.world.tileCorners(TX, TY), 11) - concreteFor(game.world.tileCorners(TX, TY), 10) === 4 * CONCRETE_PER_STEP);

/* ---- what the deepest part of it asks of you ----------------------------- */
const deep = liftFor(game.world.tileCorners(TX, TY), 10);
const want = masonryFor(deep);
check('three units of lift a point of masonry', Math.abs(want * LIFT_PER_MASONRY - deep) < 1e-9,
  `a pour ${deep} deep wants ${want.toFixed(1)}`);
const gate = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  update player set level_h = null where world_id = w and uid = u;
  delete from foundation f where f.world_id = w;
  perform land_set_height(w, ${TX}, ${TY}, 10);
  perform land_set_height(w, ${TX + 1}, ${TY}, 10);
  perform land_set_height(w, ${TX + 1}, ${TY + 1}, 4);
  perform land_set_height(w, ${TX}, ${TY + 1}, 4);
  ${bareSql(TX, TY)}
  insert into skill (world_id, uid, id, value) values (w, u, 'masonry', ${(want - 0.1).toFixed(4)})
    on conflict (world_id, uid, id) do update set value = ${(want - 0.1).toFixed(4)};
  insert into said values ('SHORT|' || coalesce(foundation_reason(w, u, ${TX}, ${TY}, 10), 'ALLOWED'));
  update skill set value = ${want.toFixed(4)} where world_id = w and uid = u and id = 'masonry';
  insert into said values ('ENOUGH|' || coalesce(foundation_reason(w, u, ${TX}, ${TY}, 10), 'ALLOWED'));
end $$;
select k from said;
rollback;
`);
game.skills.values.set('masonry', want - 0.1);
const hereShort = game.foundationReason(TX, TY, 10) ?? 'ALLOWED';
game.skills.values.set('masonry', want);
const hereEnough = game.foundationReason(TX, TY, 10) ?? 'ALLOWED';
check('a hand short of the masonry is refused on both sides, in the same sentence',
  hereShort === field('SHORT', gate) && hereShort !== 'ALLOWED', `"${hereShort}" against "${field('SHORT', gate)}"`);
check('and exactly enough of it goes through on both',
  hereEnough === 'ALLOWED' && field('ENOUGH', gate) === 'ALLOWED');

/* ---- the refusals that are not about skill ------------------------------- */
setShape([9, 9, 9, 9]);
check('level ground has nothing to fill, and both sides say so',
  (game.foundationReason(TX, TY, 9) ?? '') === 'That tile is already level. A foundation is for ground that is not.',
  `"${game.foundationReason(TX, TY, 9)}"`);
setShape([10, 10, 4, 4]);
check('and a foundation fills a tile up, never down',
  (game.foundationReason(TX, TY, 7) ?? '').startsWith('A foundation fills a tile up, never down.'),
  `"${game.foundationReason(TX, TY, 7)}"`);

/* A building a tile away, which is exactly one tile too close. */
game.buildings.list.clear();
game.buildings.tileIndex.clear();
game.buildings.create('Oceanport', TX + 1, TY);
const nextDoor = game.foundationReason(TX, TY, 10) ?? 'ALLOWED';
game.buildings.list.clear();
game.buildings.tileIndex.clear();
game.buildings.create('Oceanport', TX + 2, TY);
const twoOff = game.foundationReason(TX, TY, 10) ?? 'ALLOWED';
game.buildings.list.clear();
game.buildings.tileIndex.clear();
check('a building one tile off is too close, and the refusal names it',
  nextDoor.startsWith('Oceanport is too close.'), `"${nextDoor}"`);
check('and two tiles off is far enough', twoOff === 'ALLOWED', `"${twoOff}"`);

/* ---- bare rock, a seam or an ore, and nothing with soil left on it -------- */
const plan = FOUNDATION_ACTIONS.find((a) => a.id === 'plan_foundation')!;
const here = { kind: 'tile' as const, x: TX, y: TY, cx: TX, cy: TY };
const SOIL: [number, number, number, number] = [3, 0, 2, 0];
const soilLeft = SOIL.reduce((n, d) => n + d, 0);
const COAL = ROCK_VARIANTS.findIndex((r) => isSeam(r) && !r.yields.endsWith('_ore'));
const IRON = ROCK_VARIANTS.findIndex((r) => r.yields === 'iron_ore');
game.skills.values.set('masonry', 99);
setShape([10, 10, 4, 4], SOIL);
game.world.setTile(TX, TY, TileType.Grass);
const onGrass = { offered: plan.applies(here, game), said: game.foundationReason(TX, TY, 10) ?? 'ALLOWED' };
setShape([10, 10, 4, 4], [0, 0, 1, 0]);
game.world.setTile(TX, TY, TileType.Dirt);
const oneLeft = { offered: plan.applies(here, game), said: game.foundationReason(TX, TY, 10) ?? 'ALLOWED' };
setShape([10, 10, 4, 4]);
game.world.reconcile(TX, TY);
const bared = game.world.getTile(TX, TY);
const onRock = { offered: plan.applies(here, game), said: game.foundationReason(TX, TY, 10) ?? 'ALLOWED' };
game.world.setTile(TX, TY, TileType.Rock, COAL);
const onSeam = { offered: plan.applies(here, game), said: game.foundationReason(TX, TY, 10) ?? 'ALLOWED' };
game.world.setTile(TX, TY, TileType.Rock, IRON);
const onOre = { offered: plan.applies(here, game), said: game.foundationReason(TX, TY, 10) ?? 'ALLOWED' };

const rock = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid; v_at jsonb := jsonb_build_object('kind', 'tile', 'x', ${TX}, 'y', ${TY});
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  update player set x = ${TX}.5, y = ${TY}.5, level_h = null where world_id = w and uid = u;
  insert into skill (world_id, uid, id, value) values (w, u, 'masonry', 99)
    on conflict (world_id, uid, id) do update set value = 99;
  delete from foundation f where f.world_id = w;
  perform give(w, u, 'mallet', 1, 30);
  perform land_set_height(w, ${TX}, ${TY}, 10);
  perform land_set_height(w, ${TX + 1}, ${TY}, 10);
  perform land_set_height(w, ${TX + 1}, ${TY + 1}, 4);
  perform land_set_height(w, ${TX}, ${TY + 1}, 4);
  perform land_set_tile(w, ${TX}, ${TY}, tile_id('Grass'));
  perform land_set_dirt(w, ${TX}, ${TY}, ${SOIL[0]});
  perform land_set_dirt(w, ${TX + 1}, ${TY}, ${SOIL[1]});
  perform land_set_dirt(w, ${TX + 1}, ${TY + 1}, ${SOIL[2]});
  perform land_set_dirt(w, ${TX}, ${TY + 1}, ${SOIL[3]});
  insert into said values ('SOIL|' || coalesce(foundation_reason(w, u, ${TX}, ${TY}, 10), 'ALLOWED'));
  -- Asked for the way a page asks, mallet in hand, and done anyway.
  insert into said values ('ASKED|' || coalesce(foundation_refusal(w, u, 'plan_foundation', v_at), 'ALLOWED'));
  perform perform_foundation(w, u, 'plan_foundation', v_at);
  insert into said values ('SENT|' || (select count(*) from foundation f where f.world_id = w));
  ${bareSql(TX, TY)}
  perform land_set_dirt(w, ${TX + 1}, ${TY + 1}, 1);
  insert into said values ('ONE|' || coalesce(foundation_reason(w, u, ${TX}, ${TY}, 10), 'ALLOWED'));
  perform land_set_dirt(w, ${TX + 1}, ${TY + 1}, 0);
  perform reconcile(w, ${TX}, ${TY});
  insert into said values ('BARED|' || land_tile(w, ${TX}, ${TY}));
  perform land_set_data(w, ${TX}, ${TY}, ${COAL});
  insert into said values ('SEAM|' || coalesce(foundation_refusal(w, u, 'plan_foundation', v_at), 'ALLOWED'));
  perform land_set_data(w, ${TX}, ${TY}, ${IRON});
  insert into said values ('ORE|' || coalesce(foundation_refusal(w, u, 'plan_foundation', v_at), 'ALLOWED'));
  perform perform_foundation(w, u, 'plan_foundation', v_at);
  insert into said values ('PLANNED|' || (select count(*) from foundation f where f.world_id = w));
end $$;
select k from said;
rollback;
`);
const soilWords = soilSays(soilLeft);
check('grass with soil on its corners is not offered a foundation', !onGrass.offered);
check(`and the soil left is said on both sides in the same words: ${soilLeft}, one spadeful each`,
  onGrass.said === soilWords && field('SOIL', rock) === soilWords, `"${onGrass.said}" against "${field('SOIL', rock)}"`);
check('a plan asked for over it anyway, mallet in hand, is refused and nothing is shuttered',
  field('ASKED', rock) === soilWords && field('SENT', rock) === '0', `"${field('ASKED', rock)}", ${field('SENT', rock)} shuttered`);
check('one spadeful left on one corner is still soil, on both sides',
  !oneLeft.offered && oneLeft.said === soilSays(1) && field('ONE', rock) === soilSays(1), `"${oneLeft.said}" against "${field('ONE', rock)}"`);
check('dug bare, the tile is rock on both sides',
  bared === TileType.Rock && field('BARED', rock) === String(TileType.Rock), `${bared} and ${field('BARED', rock)}`);
check('and bare rock is offered one and takes it',
  onRock.offered && onRock.said === 'ALLOWED', `"${onRock.said}"`);
check(`a ${ROCK_VARIANTS[COAL].name.toLowerCase()} takes one, on both sides`,
  onSeam.offered && onSeam.said === 'ALLOWED' && field('SEAM', rock) === 'ALLOWED', `"${onSeam.said}" against "${field('SEAM', rock)}"`);
check(`and so does an ${ROCK_VARIANTS[IRON].name.toLowerCase()}, and the island shutters it`,
  onOre.offered && onOre.said === 'ALLOWED' && field('ORE', rock) === 'ALLOWED' && field('PLANNED', rock) === '1',
  `"${onOre.said}" against "${field('ORE', rock)}", ${field('PLANNED', rock)} shuttered`);

/* ---- poured, and what it is then ----------------------------------------- */
setShape([10, 10, 4, 4]);
game.world.setTile(TX, TY, TileType.Dirt);
game.foundations.clear();
const f = game.addFoundation(TX, TY, 10);
check('shuttering is not ground you can stand on', !foundationDone(f) && game.slabAt(TX, TY) === undefined
  && game.surfaceHeight(TX, TY) === game.world.centerHeight(TX, TY));
/*
 * And one may go next to another. A building a tile off is too close and a
 * foundation a tile off is not, which is the difference the ask draws: a wall
 * was planned against the ground as it was, and a slab was not.
 */
game.world.setHeight(TX + 2, TY, 10);
game.world.setHeight(TX + 2, TY + 1, 4);
game.world.setDirt(TX + 2, TY, 0);
game.world.setDirt(TX + 2, TY + 1, 0);
game.skills.values.set('masonry', 99);
const beside = game.foundationReason(TX + 1, TY, 10) ?? 'ALLOWED';
check('and a foundation may be set out next to another one', beside === 'ALLOWED', `"${beside}"`);
f.needed.concrete = 0;
check('poured, it is the top of the tile', game.slabAt(TX, TY) !== undefined && game.surfaceHeight(TX, TY) === 10,
  `surface ${game.surfaceHeight(TX, TY)} against ground ${game.world.centerHeight(TX, TY)}`);
check('and it is the thing you stand on rather than the ground under it',
  game.laidOver(TX, TY) === 10 && game.standable(TX, TY, 0));

/*
 * And it stays packed ground when a corner it shares is worked. Every corner
 * under a slab is bare rock now, and the rule that shows the rock when the last
 * spadeful goes would otherwise turn the slab's top to rock, which takes no
 * building and no paving.
 */
game.world.setTile(TX, TY, TileType.PackedDirt);
game.world.setTile(TX + 1, TY, TileType.Grass);
game.exposeRock(TX + 1, TY);
check('a poured slab stays packed ground when a corner it shares is dug bare, and the grass beside it goes to rock',
  game.world.getTile(TX, TY) === TileType.PackedDirt && game.world.getTile(TX + 1, TY) === TileType.Rock,
  `${game.world.getTile(TX, TY)} and ${game.world.getTile(TX + 1, TY)}`);
const kept = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  delete from foundation f where f.world_id = w;
  ${bareSql(TX, TY)} ${bareSql(TX + 1, TY)}
  perform land_set_tile(w, ${TX}, ${TY}, tile_id('Packed dirt'));
  perform land_set_tile(w, ${TX + 1}, ${TY}, tile_id('Grass'));
  insert into foundation (world_id, id, x, y, top, needed, total, made_by)
    values (w, 1, ${TX}, ${TY}, 10, '{"concrete": 0}'::jsonb, '{"concrete": 3}'::jsonb, u);
  perform reconcile_around(w, ${TX + 1}, ${TY});
  insert into said values ('POURED|' || land_tile(w, ${TX}, ${TY}) || '|' || land_tile(w, ${TX + 1}, ${TY}));
  -- Shuttering is boards round a hole, and the rule goes on under it.
  update foundation f set needed = '{"concrete": 3}'::jsonb where f.world_id = w;
  perform reconcile_around(w, ${TX + 1}, ${TY});
  insert into said values ('SHUTTERED|' || land_tile(w, ${TX}, ${TY}));
end $$;
select k from said;
rollback;
`);
check('and so on the island, where shuttering is still just the ground',
  field('POURED', kept) === `${TileType.PackedDirt}|${TileType.Rock}` && field('SHUTTERED', kept) === String(TileType.Rock),
  `poured ${field('POURED', kept)}, shuttered ${field('SHUTTERED', kept)}`);

/* And a slab is buildable ground, which is the point of pouring one. */
const island2 = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid; v_id bigint; v_before text; v_after text;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  perform land_set_height(w, ${TX}, ${TY}, 10);
  perform land_set_height(w, ${TX + 1}, ${TY}, 10);
  perform land_set_height(w, ${TX + 1}, ${TY + 1}, 4);
  perform land_set_height(w, ${TX}, ${TY + 1}, 4);
  perform land_set_tile(w, ${TX}, ${TY}, tile_id('Packed dirt'));
  delete from foundation f where f.world_id = w;
  delete from deed d where d.world_id = w;
  -- The token itself stands three tiles off: a tile with a token on it is not
  -- a tile anybody may build on, and that is not what is being asked here.
  insert into deed (world_id, name, x, y, radius, level, founded_by)
    values (w, 'Slabtown', ${TX + 3}, ${TY + 3}, 5, 1, u);
  insert into said values ('BARE|' || coalesce(plan_reason(w, u, ${TX}, ${TY}), 'ALLOWED')
    || '|' || coalesce(pier_deck_for(w, u, ${TX}, ${TY}, null)::text, 'on its ground'));
  select coalesce(max(fo.id), 0) + 1 into v_id from foundation fo where fo.world_id = w;
  insert into foundation (world_id, id, x, y, top, needed, total, made_by)
    values (w, v_id, ${TX}, ${TY}, 10, '{"concrete": 3}'::jsonb, '{"concrete": 3}'::jsonb, u);
  insert into said values ('SHUTTERED|' || coalesce(plan_reason(w, u, ${TX}, ${TY}), 'ALLOWED'));
  update foundation fo set needed = '{"concrete": 0}'::jsonb where fo.world_id = w and fo.id = v_id;
  insert into said values ('POURED|' || coalesce(plan_reason(w, u, ${TX}, ${TY}), 'ALLOWED'));
  insert into said values ('SURFACE|' || surface_height(w, ${TX}, ${TY}) || '|' || centre_height(w, ${TX}, ${TY}));
  -- And planned, it stands on the slab, not on piers.
  perform perform_building(w, u, 'plan_building', jsonb_build_object('kind', 'tile', 'x', ${TX}, 'y', ${TY}, 'cx', ${TX}, 'cy', ${TY}, 'name', 'Slab house'));
  insert into said select 'ONSLAB|' || bt.pier || '|' || coalesce(b.deck::text, 'no deck')
    from building_tile bt join building b on b.world_id = bt.world_id and b.id = bt.building
   where bt.world_id = w and bt.x = ${TX} and bt.y = ${TY};
end $$;
select k from said;
rollback;
`);
// A sloping tile used to refuse a building outright; now it takes one on piers, under a deck at its highest corner (`piers.ts`).
check('a sloping tile takes a building on the island only on piers, under a deck at its top',
  field('BARE', island2) === 'ALLOWED|10', `"${field('BARE', island2)}"`);
check('shuttering over it is not enough',
  field('SHUTTERED', island2) === 'The foundation here is only shuttered. Pour it first.', `"${field('SHUTTERED', island2)}"`);
check('and the poured slab takes the building', field('POURED', island2) === 'ALLOWED', `"${field('POURED', island2)}"`);
check('on the slab itself, not on piers', field('ONSLAB', island2) === 'false|no deck', `"${field('ONSLAB', island2)}"`);
const [slabTop, groundTop] = field('SURFACE', island2).split('|');
check('the island stands you on the slab, not on what is under it',
  Number(slabTop) === 10 && Number(groundTop) < 10, `${slabTop} against ${groundTop}`);

/* ---- and nothing takes one away again ------------------------------------ */
// Bar the one clearing of a Runestone's nine tiles (`runestone_clear`), which takes
// everything a player made there, a foundation with the rest, so the stone can stand.
const swept = psql(`
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind = 'f'
     and p.prosrc like '%delete from foundation%' and p.proname not in ('perform_foundation', 'runestone_clear');
`);
check('foundations do not decay: nothing but striking the shuttering, or a Runestone clearing its ground, ever deletes one', swept === '0',
  `${swept} other functions delete from foundation`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log('a foundation costs the hole it fills, asks the masonry the deepest part of it wants, and is the same slab on both sides');
