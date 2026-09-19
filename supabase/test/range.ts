/**
 * Herds, and a territory rather than a leash.
 *
 * Nothing kept a wild animal anywhere. A wander target was drawn a tile and a
 * half from wherever it was standing, from wherever it had got to last time,
 * for ever — a random walk with nothing pulling on it. So an island's
 * wildlife had no geography at all: a thing that spawned in the tundra was as
 * likely to be on the south beach an hour later, and the places you learned
 * to go for a particular animal were places only until you next looked.
 *
 * Everything wild has a home now, and a herd is not a list anywhere — it is a
 * shared home. A grazer arriving near another of its species takes that one's
 * ground for its own, so the pair are found together ever after, and the next
 * one joins whichever it lands nearest. One look round at birth and no
 * bookkeeping at all.
 *
 * And the leash was tied where a chase began, which is right for a hunter you
 * walked in on and wrong for one that had already wandered halfway to the
 * next valley: that one would take you thirty tiles further still. Both
 * measures are asked now and the first to run out ends it.
 *
 * Put to both sides, because the wild is simulated on whichever of them is
 * doing the thinking, and a herd that holds together in one browser and
 * scatters on an island is worse than no herd at all.
 */
import { Game } from '../../src/game/game';
import { execFileSync } from 'node:child_process';
import { HERD_REACH, HUNT_HOME, HUNT_LEASH, PLAYER_ATTACKER, SPECIES, WILD_RANGE } from '../../src/game/creatures';

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
const saidBy = (out: string) => (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

/* ---- a herd is a shared home --------------------------------------------- */

const grazer = Object.values(SPECIES).find((s) => !s.hunter)?.id ?? 'rabba';
const hunter = Object.values(SPECIES).find((s) => s.hunter)?.id ?? 'orse';
check('there is a grazer and a hunter to tell apart', grazer !== hunter, `${grazer} against ${hunter}`);

{
  const g = Game.create(4242);
  const first = g.creatures.spawn(grazer, 100, 100, 'wild', g.rand);
  /*
   * Three more about it, each within reach of the first one's *home* rather
   * than merely of another animal. That is the rule on purpose: joining by
   * the nearest neighbour would let a herd sprawl across an island one animal
   * at a time, each one a few tiles past the last, and a herd fifty tiles
   * across is not a herd.
   */
  const near = [
    g.creatures.spawn(grazer, 106, 100, 'wild', g.rand),
    g.creatures.spawn(grazer, 112, 103, 'wild', g.rand),
    g.creatures.spawn(grazer, 96, 110, 'wild', g.rand),
  ];
  check('a grazer put down near its own kind takes their ground for its own',
    near.every((c) => c.homeX === first.homeX && c.homeY === first.homeY),
    `four of them on one home at ${first.homeX},${first.homeY}`);
  const sprawl = g.creatures.spawn(grazer, 112 + HERD_REACH, 103, 'wild', g.rand);
  check('but not one a herd\u2019s width past the edge of it, or a herd would cross an island',
    sprawl.homeX !== first.homeX,
    `its own ground at ${sprawl.homeX},${sprawl.homeY}, ${Math.hypot(sprawl.homeX - first.homeX, sprawl.homeY - first.homeY).toFixed(0)} tiles off`);

  // And one dropped well clear of all that is its own animal.
  const away = g.creatures.spawn(grazer, 100 + HERD_REACH * 4, 100, 'wild', g.rand);
  check('and one put down well clear of them keeps its own',
    away.homeX !== first.homeX, `home at ${away.homeX},${away.homeY}`);

  // Hunters do not throw in together: six of them on one range is a pack.
  const h1 = g.creatures.spawn(hunter, 200, 200, 'wild', g.rand);
  const h2 = g.creatures.spawn(hunter, 203, 200, 'wild', g.rand);
  check('while two hunters standing together keep their own ground apiece',
    h1.homeX !== h2.homeX || h1.homeY !== h2.homeY,
    `${h1.homeX},${h1.homeY} against ${h2.homeX},${h2.homeY}`);

  // And nothing tame joins anything: a kept animal's home is its keeper.
  const tame = g.creatures.spawn(grazer, 106, 100, 'active', g.rand);
  check('and a tame one is nobody’s herd',
    tame.homeX === 106 && tame.homeY === 100, `${tame.homeX},${tame.homeY}`);
}

/* ---- and a wild thing keeps to its own country --------------------------- */

{
  /*
   * Driven rather than reasoned about: one grazer, left to itself for what
   * would once have been long enough to walk clean off the map. A wander step
   * is a tile and a half every twenty seconds or so, so an hour of game time
   * is a couple of hundred steps of drift with nothing to stop it.
   */
  const g = Game.create(4242);
  const c = g.creatures.spawn(grazer, 512, 508, 'wild', g.rand);
  const home = { x: c.homeX, y: c.homeY };
  let furthest = 0;
  for (let t = 0; t < 12000; t++) {
    g.update(0.5);
    furthest = Math.max(furthest, Math.hypot(c.x - home.x, c.y - home.y));
  }
  check('a wild thing left alone for an hour stays in its own country',
    furthest <= WILD_RANGE + 4,
    `wandered ${furthest.toFixed(1)} tiles from home at most, against a range of ${WILD_RANGE}`);
  check('and it does wander, rather than standing still to pass the test',
    furthest > 3, `${furthest.toFixed(1)} tiles`);
}

/* ---- the leash is the shorter of two ------------------------------------- */

check('a hunter met at its den has the full leash to chase you with',
  HUNT_HOME > HUNT_LEASH, `${HUNT_LEASH} from where it started, ${HUNT_HOME} from home`);
check('and one at the edge of its range has a dozen tiles and no more',
  HUNT_HOME - WILD_RANGE > 4 && HUNT_HOME - WILD_RANGE < HUNT_LEASH,
  `${(HUNT_HOME - WILD_RANGE).toFixed(0)} tiles left to it out there`);

/*
 * The rule itself, rather than a chase driven end to end.
 *
 * A whole chase is the wrong instrument: the body gets caught and killed and
 * wakes on the beach, the hunter drops it on distance rather than on the
 * leash, and what comes out measures the fight instead of the rule. So the
 * hunter is put exactly where each rule is meant to fire and nowhere near the
 * other two — the gap to its quarry small, the ground it has covered since
 * the chase began nothing at all — and the only thing that can end it is how
 * far it is from home.
 */
const chasing = (fromHome: number): { g: Game; c: ReturnType<Game['creatures']['spawn']> } => {
  const g = Game.create(4242);
  const c = g.creatures.spawn(hunter, g.player.x + 1, g.player.y, 'wild', g.rand);
  c.homeX = c.x - fromHome;
  c.homeY = c.y;
  // Already in the chase, and no ground covered since it began.
  c.enemy = PLAYER_ATTACKER;
  c.huntX = c.x;
  c.huntY = c.y;
  c.tx = c.x;
  c.ty = c.y;
  return { g, c };
};

{
  const { g, c } = chasing(HUNT_HOME + 5);
  g.update(0.2);
  check('a hunter further from home than it is willing to be drops the chase',
    c.enemy === null, `${HUNT_HOME + 5} tiles out, against a bound of ${HUNT_HOME}`);
  check('and turns for its own ground rather than standing where it stopped',
    Math.abs(c.tx - c.homeX) < 1e-6 && Math.abs(c.ty - c.homeY) < 1e-6,
    `heading for ${c.tx.toFixed(0)},${c.ty.toFixed(0)}, home is ${c.homeX.toFixed(0)},${c.homeY.toFixed(0)}`);
  check('and wants nothing to do with hunting for a while',
    c.huntRest > g.time, `quiet for ${(c.huntRest - g.time).toFixed(0)} more seconds of game time`);
}
{
  const { g, c } = chasing(HUNT_HOME - 10);
  g.update(0.2);
  check('while one still inside that bound keeps coming, though it is a long way out',
    c.enemy === PLAYER_ATTACKER, `${HUNT_HOME - 10} tiles from home and still on you`);
}
{
  // And the other measure is still there: ground covered since the chase
  // began, which is the one that catches a hunter you walked in on at its den.
  const { g, c } = chasing(0);
  c.huntX = c.x - (HUNT_LEASH + 5);
  c.huntY = c.y;
  g.update(0.2);
  check('and a hunter that has run the whole leash gives up at its end, at home or not',
    c.enemy === null, `${HUNT_LEASH + 5} tiles run against a leash of ${HUNT_LEASH}`);
}

/* ---- and the island says the same ---------------------------------------- */

const isle = psql(`
begin;
do $$
declare w uuid; a int; b int; c int; h1 int; h2 int; far int;
begin
  select id into w from world where name = 'Hoarding';
  delete from creature where world_id = w and species in ('${grazer}', '${hunter}');
  a := creature_spawn(w, '${grazer}', 300, 300, 'wild');
  b := creature_spawn(w, '${grazer}', 306, 300, 'wild');
  c := creature_spawn(w, '${grazer}', 312, 303, 'wild');
  far := creature_spawn(w, '${grazer}', 300 + herd_reach() * 4, 300, 'wild');
  h1 := creature_spawn(w, '${hunter}', 400, 400, 'wild');
  h2 := creature_spawn(w, '${hunter}', 403, 400, 'wild');
  create temp table said (k text);
  insert into said
    select 'HERD|' || (select count(distinct (home_x, home_y))::text from creature
                        where world_id = w and id in (a, b, c));
  insert into said
    select 'APART|' || (select case when (select home_x from creature where world_id = w and id = far)
                                  = (select home_x from creature where world_id = w and id = a)
                               then 'same' else 'own' end);
  insert into said
    select 'HUNTERS|' || (select count(distinct (home_x, home_y))::text from creature
                           where world_id = w and id in (h1, h2));
  insert into said select 'RANGE|' || wild_range()::text;
  insert into said select 'REACH|' || herd_reach()::text;
  insert into said select 'HOME|' || hunt_home()::text;
  insert into said select 'NULLS|' || (select count(*)::text from creature
                                        where world_id = w and mode = 'wild' and home_x is null);
end $$;
select k from said;
rollback;
`);
const said = saidBy(isle);

check('the island puts three grazers standing together on one home',
  said('HERD') === '1', `${said('HERD')} distinct homes among three`);
check('and the one well clear of them on its own',
  said('APART') === 'own', said('APART'));
check('and two hunters on two',
  said('HUNTERS') === '2', `${said('HUNTERS')} distinct homes among two`);
check('and nothing wild on the island is without one',
  said('NULLS') === '0', `${said('NULLS')} homeless`);

check('and both sides are working from the same three numbers',
  Number(said('RANGE')) === WILD_RANGE && Number(said('REACH')) === HERD_REACH && Number(said('HOME')) === HUNT_HOME,
  `range ${said('RANGE')}/${WILD_RANGE}, reach ${said('REACH')}/${HERD_REACH}, home ${said('HOME')}/${HUNT_HOME}`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a herd keeps together and a hunter keeps to its country — ${ok.length} of ${ok.length}`);
