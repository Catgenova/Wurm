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
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { concreteFor, foundationDone, liftFor, masonryFor, CONCRETE_PER_STEP, LIFT_PER_MASONRY } from '../../src/game/foundations';
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
const setShape = (h: [number, number, number, number]): void => {
  game.world.setHeight(TX, TY, h[0]);
  game.world.setHeight(TX + 1, TY, h[1]);
  game.world.setHeight(TX + 1, TY + 1, h[2]);
  game.world.setHeight(TX, TY + 1, h[3]);
};

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
game.skills.values.set('masonry', 99);
const beside = game.foundationReason(TX + 1, TY, 10) ?? 'ALLOWED';
check('and a foundation may be set out next to another one', beside === 'ALLOWED', `"${beside}"`);
f.needed.concrete = 0;
check('poured, it is the top of the tile', game.slabAt(TX, TY) !== undefined && game.surfaceHeight(TX, TY) === 10,
  `surface ${game.surfaceHeight(TX, TY)} against ground ${game.world.centerHeight(TX, TY)}`);
check('and it is the thing you stand on rather than the ground under it',
  game.laidOver(TX, TY) === 10 && game.standable(TX, TY, 0));

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
  insert into said values ('BARE|' || coalesce(plan_reason(w, u, ${TX}, ${TY}), 'ALLOWED'));
  select coalesce(max(fo.id), 0) + 1 into v_id from foundation fo where fo.world_id = w;
  insert into foundation (world_id, id, x, y, top, needed, total, made_by)
    values (w, v_id, ${TX}, ${TY}, 10, '{"concrete": 3}'::jsonb, '{"concrete": 3}'::jsonb, u);
  insert into said values ('SHUTTERED|' || coalesce(plan_reason(w, u, ${TX}, ${TY}), 'ALLOWED'));
  update foundation fo set needed = '{"concrete": 0}'::jsonb where fo.world_id = w and fo.id = v_id;
  insert into said values ('POURED|' || coalesce(plan_reason(w, u, ${TX}, ${TY}), 'ALLOWED'));
  insert into said values ('SURFACE|' || surface_height(w, ${TX}, ${TY}) || '|' || centre_height(w, ${TX}, ${TY}));
end $$;
select k from said;
rollback;
`);
check('a sloping tile refuses a building on the island, as it always has',
  field('BARE', island2) === 'The tile must be perfectly flat. Flatten it first.', `"${field('BARE', island2)}"`);
check('shuttering over it is not enough',
  field('SHUTTERED', island2) === 'The foundation here is only shuttered. Pour it first.', `"${field('SHUTTERED', island2)}"`);
check('and the poured slab takes the building', field('POURED', island2) === 'ALLOWED', `"${field('POURED', island2)}"`);
const [slabTop, groundTop] = field('SURFACE', island2).split('|');
check('the island stands you on the slab, not on what is under it',
  Number(slabTop) === 10 && Number(groundTop) < 10, `${slabTop} against ${groundTop}`);

/* ---- and nothing takes one away again ------------------------------------ */
const swept = psql(`
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind = 'f'
     and p.prosrc like '%delete from foundation%' and p.proname <> 'perform_foundation';
`);
check('foundations do not decay: nothing but striking the shuttering ever deletes one', swept === '0',
  `${swept} other functions delete from foundation`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log('a foundation costs the hole it fills, asks the masonry the deepest part of it wants, and is the same slab on both sides');
