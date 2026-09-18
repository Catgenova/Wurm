/**
 * What a go teaches the body, and what it does not.
 *
 * Asked for: "no stats should be gained by eating, drinking, or moving items".
 * Every go trained the hands a little and every go that cost wind trained the
 * chest, which is right for work and wrong for the three things that are not
 * work. Twenty-five jobs are named, and the name has to be the same name on
 * both sides or a body would learn different things depending where it stood.
 * So the browser's list is put to the island and the two are compared, and
 * then a body in a game of its own eats a loaf and is measured for it.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, TEACHES_NOTHING } from '../../src/game/actions';
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
  }).replace(/\n$/, '');

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const mine = [...TEACHES_NOTHING].sort().join(',');
const theirs = psql("select coalesce(string_agg(id, ',' order by id), '') from action_def where teaches_nothing(id)");
check('both sides name the same jobs', mine === theirs, mine === theirs ? `${TEACHES_NOTHING.size} of them` : `browser ${mine}\n        island  ${theirs}`);
check('and every one of them is a job the island has', theirs.split(',').length === TEACHES_NOTHING.size,
  `${theirs.split(',').length} on the island, ${TEACHES_NOTHING.size} here`);
for (const id of ['eat', 'drink', 'pick_up', 'take_from_store', 'fill_bucket']) {
  check(`${id} is on the list`, TEACHES_NOTHING.has(id), TEACHES_NOTHING.has(id) ? 'yes' : 'MISSING');
}
for (const id of ['dig', 'mine', 'build_wall', 'pick_up_anvil']) {
  check(`${id} is not`, !TEACHES_NOTHING.has(id), !TEACHES_NOTHING.has(id) ? 'right' : 'ON THE LIST');
}

// And a body in a game of its own, which is where the gains are actually paid.
const game = Game.create(4242);
const body = (): string => ['body_control', 'body_stamina', 'body_strength']
  .map((id) => `${id} ${game.skills.get(id).toFixed(4)}`).join(', ');
const run = (id: string, target: unknown): void => {
  const def = ACTION_BY_ID.get(id);
  if (!def) return;
  game.player.stats.stamina = 1;
  game.requestAction(def, target as never, 1);
  // Long enough for a slow go: a first dig takes twenty seconds at a beginner's skill.
  for (let i = 0; i < 400 && game.action; i++) game.update(0.2);
};

game.inventory.add('bread', { ql: 50, count: 3 });
game.player.stats.hunger = 0.2;
const before = body();
const loaf = game.inventory.items.find((it) => it.id === 'bread');
run('eat', { kind: 'item', uid: loaf?.uid ?? 0 });
check('eating a loaf teaches the body nothing', body() === before, `${before} → ${body()}`);
check('and it was eaten all the same', game.player.stats.hunger > 0.2, game.player.stats.hunger.toFixed(3));

// Flat dirt underfoot with soil in it, so the spadeful is not refused for the
// ground it is asked of.
const w = game.world;
for (let y = game.player.tileY - 2; y <= game.player.tileY + 3; y++) {
  for (let x = game.player.tileX - 2; x <= game.player.tileX + 3; x++) {
    w.setTile(x, y, TileType.Dirt);
    w.setHeight(x, y, 100);
    w.setDirt(x, y, 20);
  }
}
game.inventory.add('shovel', { ql: 50 });
const spot = { kind: 'tile', x: game.player.tileX, y: game.player.tileY, cx: game.player.tileX, cy: game.player.tileY };
check('and a spadeful there is allowed', !ACTION_BY_ID.get('dig')?.check?.(spot as never, game),
  String(ACTION_BY_ID.get('dig')?.check?.(spot as never, game) ?? 'allowed'));
run('dig', spot);
check('and a spadeful of dirt teaches it three things', body() !== before, `${before} → ${body()}`);

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} went wrong` : `\nall ${ok.length} right`);
process.exit(bad.length ? 1 : 0);
