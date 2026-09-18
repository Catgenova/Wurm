/**
 * An anvil off the island keeps its metal.
 *
 * Reported as "made a copper anvil and placed down an iron anvil". The island
 * puts what an anvil was poured from in `placed.sub` (`perform_forge`), and
 * names and rates it from there (`anvil_name`, `anvil_ql`); `material` is
 * never written for one. The browser's intake read `material`, found nothing,
 * and called every island anvil iron. This hands `sawGround` anvils shaped
 * exactly as the island's ground read hands them, and asks what they are.
 */
import { Game, type IslandGround } from '../../src/game/game';
import { anvilName } from '../../src/game/anvil';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const game = Game.create(4242);
const row = (id: number, sub: string, x: number) => ({
  id, kind: 'anvil', x, y: 10, sx: 0, sy: 0, ql: 70, mine: true, sub, material: null,
  ash: 0, dmg: 0, lit: false, fuel: 0, name: null, state: {}, facing: 's', liquid: null, litres: 0,
});
const off: IslandGround = {
  placed: [row(31, 'copper', 8), row(32, 'iron', 10), row(33, 'steel', 12)] as unknown as IslandGround['placed'],
  crates: [],
};
game.sawGround(off);

for (const [id, metal, name] of [[31, 'copper', 'Copper anvil'], [32, 'iron', 'Iron anvil'], [33, 'steel', 'Steel anvil']] as const) {
  const a = game.anvils.get(id);
  check(`anvil ${id} is the ${metal} one it was poured as`, !!a && a.metal === metal, a ? a.metal : 'missing');
  check(`and is called "${name}"`, !!a && anvilName(a) === name, a ? anvilName(a) : 'missing');
}

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} went wrong` : `\nall ${ok.length} right`);
process.exit(bad.length ? 1 : 0);
