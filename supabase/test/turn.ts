/**
 * You turn on whatever bites you.
 *
 * Asked for: "players automatically attack back when attacked". A bite marked
 * you as struck and hurt you, and that was all: you stood there being eaten
 * until you clicked. This bites a body in a game of its own and asks what it
 * is doing afterwards: swinging at the thing, with what it had been doing
 * first in line behind it; a second bite changes nothing; a nip from a tame
 * one is no fight; and the log says so on the Combat tab.
 */
import { ACTION_BY_ID } from '../../src/game/actions';
import { FIGHT_BACK_GOES } from '../../src/game/creatures';
import { Game } from '../../src/game/game';
import { TileType } from '../../src/world/tiles';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const game = Game.create(4242);
const w = game.world;
// Level grass under everybody, so nothing about the ground gets in the way.
for (let y = 18; y <= 26; y++) for (let x = 18; x <= 26; x++) { w.setHeight(x, y, 4); w.setDirt(x, y, 3); }
for (let y = 18; y <= 25; y++) for (let x = 18; x <= 25; x++) w.setTile(x, y, TileType.Grass, 0);
game.player.x = 21.5; game.player.y = 21.5;
game.player.stats.stamina = 1;
game.player.stats.health = 1;

const ulva = game.creatures.spawn('ulva', 22.5, 21.5, 'wild', () => 0.5, 0);
const dig = ACTION_BY_ID.get('dig');
if (!dig) throw new Error('no dig');
// A hole half dug when it starts.
game.inventory.add('shovel', { ql: 40 });
game.requestAction(dig, { kind: 'tile', x: 21, y: 21, cx: 21, cy: 21 }, 3);
check('he is digging when it starts', game.action?.def.id === 'dig', game.action?.def.id ?? 'nothing');

game.player.attackedBy = ulva.id;
game.player.attackedAt = game.time;
game.hurtPlayer(0.05, 'The ulva is on you');
check('bitten, he turns on it', game.action?.def.id === 'attack_creature' && game.action.target.kind === 'creature' && game.action.target.id === ulva.id,
  `${game.action?.def.id} on ${JSON.stringify(game.action?.target)}`);
check(`with ${FIGHT_BACK_GOES} swings in hand`, game.action?.goes === FIGHT_BACK_GOES, String(game.action?.goes));
check('and the hole first in line behind it', game.queue[0]?.def.id === 'dig' && game.queue[0]?.goes === 3, `${game.queue[0]?.def.id} ×${game.queue[0]?.goes}`);
const said = game.log.filter((l) => l.text.startsWith('You turn on'));
check('and says so on the Combat tab', said.length === 1 && said[0].kind === 'fight' && said[0].text === 'You turn on the ulva.', JSON.stringify(said.map((l) => [l.kind, l.text])));

game.hurtPlayer(0.05, 'The ulva is on you');
check('a second bite changes nothing', game.action?.def.id === 'attack_creature' && game.queue.length === 1 && game.log.filter((l) => l.text.startsWith('You turn on')).length === 1,
  `${game.action?.def.id}, ${game.queue.length} in line`);

const pet = game.creatures.spawn('crawler', 21.5, 22.5, 'active', () => 0.5, 0);
game.action = null;
game.queue.length = 0;
game.player.attackedBy = pet.id;
game.hurtPlayer(0.05, 'Crawler rounds on you and gets a claw in');
// Read through a call: the assignment above narrowed the field to null for the checker.
const inHand = (): string => game.action?.def.id ?? 'nothing in hand';
check('a nip from a tame one is no fight', inHand() === 'nothing in hand', inHand());

const wind = game.player.stats.stamina;
game.player.stats.stamina = 0.01;
game.player.attackedBy = ulva.id;
game.hurtPlayer(0.05, 'The ulva is on you');
check('and with no wind left there is no turning on it', inHand() === 'nothing in hand', inHand());
game.player.stats.stamina = wind;

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} went wrong` : `\nall ${ok.length} right`);
process.exit(bad.length ? 1 : 0);
