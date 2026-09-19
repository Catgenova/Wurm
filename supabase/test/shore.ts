/**
 * A mola may work a shore face, and may not work the sea floor.
 *
 * "Allow mola to mine ore, seams and rock at up to -10 water level just like
 * players." It could not, and the two sides were wrong in opposite directions
 * for the same reason: the only question either ever asked about a mining tile
 * was whether a body could stand on it.
 *
 * A person may put a pick to a corner under ten units of water — `MINE_DEPTH`,
 * about waist deep, and the note on it says in as many words that you work
 * standing in it. The browser let a worker reach one unit down, which is the
 * tide line rather than the shore. This island asked nothing at all: neither
 * mining trade had any reach test on it, so a worker here would set about the
 * sea floor at forty fathoms.
 *
 * So the person's rule is put to both of them over the same stretch of shore:
 * dry rock, rock at five under, rock at twelve under, and rock at five under
 * with nowhere to stand beside it. And then a mola is actually set to work on
 * a face it used to walk past, to check the answer is worth something.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { Game } from '../../src/game/game';
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID, MINE_DEPTH } from '../../src/game/actions';
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

const W = `(select id from world where name = 'Hoarding')`;
const DANE = `(select uid from player where world_id = ${W} and name = 'Dane')`;
const HAND = `(select c from creature c where c.world_id = ${W} and c.keeper = ${DANE} and c.species = 'mola' order by c.id desc limit 1)`;
const HAND_ID = `(select c.id from creature c where c.world_id = ${W} and c.keeper = ${DANE} and c.species = 'mola' order by c.id desc limit 1)`;

check('both sides work to the same depth', MINE_DEPTH === Number(psql('select mine_depth()')),
  `${MINE_DEPTH} here, ${psql('select mine_depth()')} there`);

/* ---- the same stretch of shore on both sides ------------------------------
 * Dane's deed at 30,30. A bank at height 4 running down to water, and four
 * rock faces standing in it: dry, five under, twelve under, and five under
 * with deep water all round so there is nowhere to put your feet.
 */
const DRY: [number, number] = [28, 30];
const WADE: [number, number] = [32, 30];
const DEEP: [number, number] = [34, 30];
const ADRIFT: [number, number] = [26, 26];
/** Flat seabed three under, with dry land touching it only on the diagonal. */
const SEABED: [number, number] = [36, 26];
/**
 * How high the landward corner of every face stands — rock, well clear of the
 * water — and how deep the other three drop to. The tile's middle is the
 * average of the four, so six and minus six is a middle three under, which is
 * wading depth; six and minus twenty is thirteen and a half under, which is
 * over everybody's head. Whole numbers, because a corner's height is one.
 */
const TOP = 6;
const WET = -6;
const SUNK = -20;

const game = Game.create(4242);
const w = game.world;
for (let y = 22; y <= 38; y++) {
  for (let x = 22; x <= 38; x++) {
    w.setHeight(x, y, 4);
    w.setDirt(x, y, 5);
    w.setTile(x, y, TileType.Grass, 0);
  }
}
/*
 * A rock face: its landward corner standing above the water, so there is rock
 * to cut, and its other three dropping away so that the tile's middle — which
 * is what decides whether a body can stand on it — sits `under` below the
 * surface. That shape is the whole of what a shore face is, and it is why the
 * old rule missed them: a tile can have rock well clear of the water and still
 * be a tile nothing can stand in the middle of.
 */
const face = (x: number, y: number, away: number): void => {
  for (const [cx, cy] of [[x + 1, y], [x, y + 1], [x + 1, y + 1]] as Array<[number, number]>) {
    w.setHeight(cx, cy, away);
    w.setDirt(cx, cy, 0);
  }
  w.setHeight(x, y, TOP);
  w.setDirt(x, y, 0);
  w.setTile(x, y, TileType.Rock, 0);
};
face(...DRY, TOP);
face(...WADE, WET);
face(...DEEP, SUNK);
// The sea all round the last one first, then the face cut into it, so there
// is no bank anywhere beside it — not even a diagonal with three corners
// still on dry land, which is what `beside` would have found.
for (let y = 24; y <= 29; y++) for (let x = 24; x <= 29; x++) w.setHeight(x, y, -14);
face(...ADRIFT, WET);
/*
 * And the case that was reported: not a face at all but flat bottom, three
 * under, with the only dry ground touching it on a corner. Every one of the
 * three rules that used to be in the way is in this one tile — the depth, the
 * bedrock's own height, and a bank that is not north, south, east or west.
 */
for (let y = 24; y <= 28; y++) {
  for (let x = 34; x <= 38; x++) {
    w.setHeight(x, y, -3);
    w.setDirt(x, y, 0);
    w.setTile(x, y, TileType.Rock, 0);
  }
}
for (const [cx, cy] of [[37, 27], [38, 27], [37, 28], [38, 28]] as Array<[number, number]>) w.setHeight(cx, cy, 4);
w.setTile(37, 27, TileType.Grass, 0);
w.setDirt(37, 27, 5);
game.deed = { name: 'Hoarding', x: 30, y: 30, radius: 8, level: 1, mine: true };

psql(`
do $$
declare w uuid; u uuid; tx int; ty int;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  for tx in 22..38 loop for ty in 22..38 loop
    perform land_set_height(w, tx, ty, 4); perform land_set_dirt(w, tx, ty, 5);
    perform land_set_tile(w, tx, ty, tile_id('Grass'));
    perform land_set_rock(w, tx, ty, 0);
  end loop; end loop;
end $$;`);
const islandFace = (x: number, y: number, away: number): void => {
  psql(`
do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  perform land_set_height(w, ${x + 1}, ${y}, ${away});
  perform land_set_height(w, ${x}, ${y + 1}, ${away});
  perform land_set_height(w, ${x + 1}, ${y + 1}, ${away});
  perform land_set_dirt(w, ${x + 1}, ${y}, 0);
  perform land_set_dirt(w, ${x}, ${y + 1}, 0);
  perform land_set_dirt(w, ${x + 1}, ${y + 1}, 0);
  perform land_set_height(w, ${x}, ${y}, ${TOP});
  perform land_set_dirt(w, ${x}, ${y}, 0);
  perform land_set_tile(w, ${x}, ${y}, tile_id('Rock'));
end $$;`);
};
islandFace(...DRY, TOP);
islandFace(...WADE, WET);
islandFace(...DEEP, SUNK);
psql(`
do $$
declare w uuid; tx int; ty int;
begin
  select id into w from world where name = 'Hoarding';
  for tx in 24..29 loop for ty in 24..29 loop
    perform land_set_height(w, tx, ty, -14);
  end loop; end loop;
end $$;`);
islandFace(...ADRIFT, WET);
psql(`
do $$
declare w uuid; tx int; ty int;
begin
  select id into w from world where name = 'Hoarding';
  for tx in 34..38 loop for ty in 24..28 loop
    perform land_set_height(w, tx, ty, -3); perform land_set_dirt(w, tx, ty, 0);
    perform land_set_tile(w, tx, ty, tile_id('Rock'));
  end loop; end loop;
  perform land_set_height(w, 37, 27, 4); perform land_set_height(w, 38, 27, 4);
  perform land_set_height(w, 37, 28, 4); perform land_set_height(w, 38, 28, 4);
  perform land_set_tile(w, 37, 27, tile_id('Grass')); perform land_set_dirt(w, 37, 27, 5);
end $$;`);

/* ---- what a person may put a pick to, which is the rule being matched ---- */
const mine = ACTION_BY_ID.get('mine');
if (!mine) throw new Error('no mine action');
game.inventory.addItem({ uid: game.inventory.nextUid++, id: 'pickaxe', ql: 40, dmg: 0, count: 1 });
/*
 * Aimed at the seaward corner, which is the one under the water. A person
 * works a named corner and a worker takes the whole tile, so the corner that
 * stands for the worker's answer is the deep one rather than the dry one it
 * is standing next to.
 */
const why = (at: [number, number]): string | null =>
  mine.check?.({ kind: 'tile', x: at[0], y: at[1], cx: at[0] + 1, cy: at[1] + 1 }, game) ?? null;
const canPerson = (at: [number, number]): boolean => why(at) === null;
check('a person works dry rock', canPerson(DRY), `${why(DRY)}`);
check('and the wet corner of a shore face', canPerson(WADE), `${why(WADE)}`);
check('and not one twenty under', !canPerson(DEEP), `${why(DEEP)}`);

/* ---- and what a worker may, which used to be a different rule ------------ */
const cases: Array<[string, [number, number], boolean]> = [
  ['dry rock', DRY, true],
  ['rock five under', WADE, true],
  ['rock twelve under', DEEP, false],
  ['rock five under with nowhere to stand', ADRIFT, false],
  ['flat bottom three under with a bank on the diagonal', SEABED, true],
];
for (const [what, at, want] of cases) {
  const here = game.creatures.reachableFace(game, at[0], at[1]);
  check(`a worker can${want ? '' : 'not'} reach ${what}, in the browser`, here === want, `${here}`);
  const there = psql(`select face_reach(${W}, ${at[0]}, ${at[1]})`) === 't';
  check(`and the island says the same of ${what}`, there === want, `${there}`);
}

/* ---- the floor under a pick, which used to be the waterline -------------- */
check('the bedrock floor is the depth a person works to, in the browser',
  game.world.rockHeight(SEABED[0], SEABED[1]) === -3 && -3 > -MINE_DEPTH,
  `bedrock at ${game.world.rockHeight(SEABED[0], SEABED[1])}, floor at ${-MINE_DEPTH}`);
check('and on the island',
  psql(`select rock_height(${W}, ${SEABED[0]}, ${SEABED[1]}) > -mine_depth()`) === 't',
  psql(`select rock_height(${W}, ${SEABED[0]}, ${SEABED[1]})`));

/* ---- and the rule that is not a bug: a seam beyond its skill ------------- */
const ironLevel = Number(psql(`select level from rock_def where yields = 'iron_ore'`));
const copperLevel = Number(psql(`select level from rock_def where yields = 'copper_ore'`));
check('iron wants more of a miner than a fresh one has', ironLevel === 5 && copperLevel === 1,
  `iron ${ironLevel}, copper ${copperLevel}`);
check('so a mola is level one until its mining reaches five',
  psql(`select creature_level(jsonb_build_object('mining', 4.9))`) === '1'
    && psql(`select creature_level(jsonb_build_object('mining', 5))`) === '2',
  `4.9 is level ${psql(`select creature_level(jsonb_build_object('mining', 4.9))`)}, 5 is level ${psql(`select creature_level(jsonb_build_object('mining', 5))`)}`);

/* ---- and the trades that use it ------------------------------------------ */
psql(`
do $$
declare w uuid; u uuid;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  delete from crop where world_id = w;
  delete from item i where i.world_id = w and i.holder = 'crate';
  delete from crate where world_id = w;
  delete from deed where world_id = w;
  insert into deed (world_id, name, x, y, radius, level, founded_by) values (w, 'Hoarding', 30, 30, 8, 1, u);
  insert into crate (world_id, id, kind, x, y, sx, sy, deed, made_by) values (w, 1, 'plank', 30, 31, 1, 1, true, u);
  delete from creature where world_id = w and keeper = u and species = 'mola';
  perform creature_spawn(w, 'mola', 30.5, 30.5, 'deed', now() - interval '3 hours', u);
  update creature set job = 'quarry', mode = 'deed', phase = 'idle',
      until = now() - interval '600 seconds', leg_at = now() - interval '600 seconds',
      leg_ends = now() - interval '600 seconds', settled_at = now() - interval '600 seconds'
    where world_id = w and keeper = u and species = 'mola';
end $$;`);
check('the island calls a wadeable face quarry work',
  psql(`select worker_gatherable(${W}, ${WADE[0]}, ${WADE[1]}, 'quarry', ${HAND})`) === 't');
check('and the sea floor none',
  psql(`select worker_gatherable(${W}, ${DEEP[0]}, ${DEEP[1]}, 'quarry', ${HAND})`) === 'f');

// Ten minutes of it, on a deed whose only rock is standing in the water.
psql(`select worker_settle(${W}, ${HAND_ID})`);
const cut = psql(`select coalesce(sum(count), 0) from item where world_id = ${W} and holder = 'crate'`);
const stood = psql(`select round(creature_x((select c from creature c where c.world_id = ${W} and c.id = ${HAND_ID})))::text || ',' || round(creature_y((select c from creature c where c.world_id = ${W} and c.id = ${HAND_ID})))::text`);
check('ten minutes of a mola cuts the shore face it used to walk past', Number(cut) > 0,
  `${cut} in the crate, and it is standing at ${stood}`);
check('and it stood on the bank to do it rather than in the water',
  psql(`select creature_tile_ok(${W}, floor(creature_x(${HAND}))::int, floor(creature_y(${HAND}))::int)`) === 't');

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not the same on both sides`);
  process.exit(1);
}
console.log(`a shore face is work and the sea floor is not, the same on both sides — ${ok.length} of ${ok.length}`);
