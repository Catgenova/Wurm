/**
 * What the ground says about a cut it will not take, and about whose it is.
 *
 * Three rules written twice, and measured to agree word for word. A slope
 * refusal now carries its numbers: the slope the cut would leave, the slope
 * the skill allows, and the skill it would take. Ground inside a settlement
 * you are not of is refused outright, which nothing asked before. And
 * flattening steps round a corner of bare rock rather than stopping at it,
 * which only this side can be asked about here, since the island's own copy
 * is measured in the suite at 329b.
 *
 * The island is asked directly, the way the outlook test asks it, so the two
 * sentences are compared rather than described.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, foreignGround, slopeNeeds, slopeRefusal, tileCorners } from '../../src/game/actions';
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

const game = Game.create(4242);
const w = game.world;
for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) { w.setTile(x, y, TileType.Dirt); w.setHeight(x, y, 100); w.setDirt(x, y, 20); }
game.skills.values.set('digging', 20);
game.skills.values.set('masonry', 20);
game.player.x = 10.5;
game.player.y = 10.5;

// A corner with a cliff beside it: one step down leaves a slope of 62.
w.setHeight(20, 20, 100);
w.setHeight(21, 20, 39);
const said = slopeRefusal(game, 'digging', 20, 20, -1) ?? '';
const slope = Number(/slope of (\d+)/.exec(said)?.[1] ?? 0);
check('the slope refusal carries its numbers',
  /^That would leave a slope of \d+\. Your digging allows 60; it would take digging \d+\.\d\.$/.test(said), said || 'nothing said');
const islandSaid = psql(
  `select 'That would leave a slope of ' || ${slope} || '. Your digging allows 60; it would take digging '`
  + ` || to_char(slope_needs(${slope}), 'FM990.0') || '.'`);
check('and the island builds the same sentence', said === islandSaid, `island "${islandSaid}"`);
const islandNeeds = psql('select slope_needs(62) || \' \' || slope_needs(40) || \' \' || slope_needs(41)');
check('and the skill a slope takes is the same sum on both sides',
  islandNeeds === `${slopeNeeds(62)} ${slopeNeeds(40)} ${slopeNeeds(41)}`, `island ${islandNeeds} browser ${slopeNeeds(62)} ${slopeNeeds(40)} ${slopeNeeds(41)}`);
check('a slope inside the cap says nothing', slopeRefusal(game, 'digging', 10, 10, -1) === null, String(slopeRefusal(game, 'digging', 10, 10, -1)));

// Ground inside somebody else's stake.
game.neighbourDeeds = [{ name: 'Hildsmoor', x: 30, y: 30, radius: 1, level: 1, holder: 'Hild' } as never];
const dig = ACTION_BY_ID.get('dig')!;
const pack = ACTION_BY_ID.get('pack')!;
const cut = ACTION_BY_ID.get('cut_grass');
const THEIRS = 'That ground is part of Hildsmoor. Only its citizens may shape it.';
// Asked at the door, which is where the rule was hung, rather than of the rule.
const asked = (id: string, t: unknown): string => String(ACTION_BY_ID.get(id)?.check?.(t as never, game) ?? 'nothing');
check('a corner inside a stake of somebody else\'s is refused', asked('dig', { kind: 'tile', x: 30, y: 30, cx: 30, cy: 30 }) === THEIRS, asked('dig', { kind: 'tile', x: 30, y: 30, cx: 30, cy: 30 }));
check('and so is packing the tile', asked('pack', { kind: 'tile', x: 30, y: 30 }) === THEIRS, asked('pack', { kind: 'tile', x: 30, y: 30 }));
check('and so is mining it', asked('mine', { kind: 'tile', x: 30, y: 30, cx: 30, cy: 30 }) === THEIRS, asked('mine', { kind: 'tile', x: 30, y: 30, cx: 30, cy: 30 }));
check('a corner a step outside it is not', asked('dig', { kind: 'tile', x: 34, y: 34, cx: 34, cy: 34 }) !== THEIRS, asked('dig', { kind: 'tile', x: 34, y: 34, cx: 34, cy: 34 }));
check('a corner whose far tile is inside is refused all the same', asked('dig', { kind: 'tile', x: 32, y: 32, cx: 32, cy: 32 }) === THEIRS, asked('dig', { kind: 'tile', x: 32, y: 32, cx: 32, cy: 32 }));
check('and cutting its grass, which shapes nothing, is not on the list', asked('cut_grass', { kind: 'tile', x: 30, y: 30 }) !== THEIRS, asked('cut_grass', { kind: 'tile', x: 30, y: 30 }));
void pack; void dig; void cut; void foreignGround;
game.neighbourDeeds = [];

// A tile with one shoulder of bare rock, worked towards the ground underfoot.
for (const [cx, cy] of tileCorners(12, 12)) { w.setHeight(cx, cy, 100); w.setDirt(cx, cy, 20); }
w.setHeight(13, 12, 103); w.setDirt(13, 12, 0);
w.setHeight(14, 12, 102);
w.setHeight(13, 13, 98);
w.setHeight(14, 13, 100);
// Standing well clear of it: the tile you stand on is what flattening aims
// at, and a corner shared with the tile being worked would move the aim.
game.player.x = 10.5; game.player.y = 10.5;
const flatten = ACTION_BY_ID.get('flatten')!;
const before = game.log.length;
for (let i = 0; i < 8; i++) if (flatten.perform({ kind: 'tile', x: 13, y: 12 } as never, game) === false) break;
const heights = tileCorners(13, 12).map(([cx, cy]) => w.getHeight(cx, cy)).join(', ');
check('flattening steps round the rock and levels the rest', heights === '103, 100, 100, 100', heights);
const last = game.log.slice(before).filter((l) => l.kind === 'error').pop();
check('and names the rock when nothing else will move',
  last?.text === 'What is still standing high here is bare rock. Mine it down.', last?.text ?? 'nothing said');

/*
 * And what a piece of furniture holds, as the island hands it over.
 *
 * Reported as "i opened it and dragged my dirt into it and the dirt
 * vanished". This read filled `items` with a bare `[]` and nothing ever
 * filled it again, so every chest, bin and larder on an island was drawn
 * empty. The row is shaped exactly as `rpc_ground` builds it.
 */
game.sawGround({
  placed: [{ id: 91, kind: 'furniture', sub: 'bulk_bin', x: 20, y: 20, sx: 0, sy: 0, ql: 40, mine: true,
    things: [{ id: 771, def: 'dirt', ql: 30, dmg: 0, count: 3, extra: null }] },
    { id: 92, kind: 'furniture', sub: 'chest', x: 22, y: 20, sx: 0, sy: 0, ql: 40, mine: true, things: [] },
  ] as never,
  crates: [],
});
const binHere = game.furniture.get(91);
check('what the island says is in a bin reaches the browser',
  binHere?.items.length === 1 && binHere.items[0].id === 'dirt' && binHere.items[0].count === 3,
  binHere ? JSON.stringify(binHere.items) : 'no bin');
check('and an empty one is empty', game.furniture.get(92)?.items.length === 0, String(game.furniture.get(92)?.items.length));

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} went wrong` : `\nall ${ok.length} right`);
process.exit(bad.length ? 1 : 0);
