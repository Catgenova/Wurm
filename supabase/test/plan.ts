/**
 * A plan that looks like a plan.
 *
 * Reported, with a picture of a tile whose tooltip read `Part of Oceanport ·
 * House · one storey`: "create a scaffold model for planned buildings like in
 * wurm. there's currently nothing at all to show it's a plan."
 *
 * There was not. Everything drawn for a building hangs off a wall or a floor
 * — a planned wall is a dashed quad, a planned floor a dashed lozenge — and a
 * building that has just been planned has neither. The footprint was ground
 * like any other ground.
 *
 * So the footprint is marked out: a stake at each end of every border on the
 * outline, a string between them and a chalk line along the ground. Which
 * borders those are is `Buildings.edgeOf`, and it is the whole of the rule —
 * an outline rather than a grid, so a four-tile plan is marked round the
 * outside and not across the middle. That is what this measures.
 */
import { Buildings, borderOf, type Border } from '../../src/game/building';

let bad = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) bad++;
  console.log(`${ok ? '  ' : 'X '}${line}`);
};

const bld = new Buildings();

/* One tile: four borders, every one of them an edge. */
const one = bld.create('Hut', 10, 10);
const sides = ['n', 'e', 's', 'w'] as const;
const edgesOf = (x: number, y: number): Border[] => sides.map((s) => borderOf(x, y, s)).filter((b) => bld.edgeOf(b));
say(edgesOf(10, 10).length === 4, `a one-tile plan is marked out on all four sides: ${edgesOf(10, 10).length}`);
say(bld.edgeOf(borderOf(12, 12, 'n')) === undefined, 'and ground with no plan on it is marked out on none');

/* Two by two: eight borders round the outside, four inside it. */
bld.addTile(one, 11, 10);
bld.addTile(one, 10, 11);
bld.addTile(one, 11, 11);
const all = new Map<string, Border>();
for (const [x, y] of [[10, 10], [11, 10], [10, 11], [11, 11]] as Array<[number, number]>) {
  for (const s of sides) {
    const b = borderOf(x, y, s);
    all.set(`${b.dir}:${b.x},${b.y}`, b);
  }
}
const outline = [...all.values()].filter((b) => bld.edgeOf(b));
const inside = [...all.values()].filter((b) => !bld.edgeOf(b));
say(all.size === 12, `a two by two footprint has ${all.size} borders in all`);
say(outline.length === 8, `eight of them are the outline: ${outline.length}`);
say(inside.length === 4, `and four are inside it, marked out by nothing: ${inside.length}`);
say(outline.every((b) => bld.edgeOf(b)?.id === one.id), 'every one of the eight belongs to the plan that owns the tile');

/* Two plans side by side: the border between them is an edge of both, and the
 * near one owns it, so it is marked out once rather than twice. */
const two = bld.create('Shed', 12, 10);
const between = borderOf(12, 10, 'w');
say(bld.edgeOf(between)?.id === two.id, `the border between two plans belongs to the near one: ${bld.edgeOf(between)?.name}`);
say(bld.edgeOf(borderOf(11, 10, 'e'))?.id === two.id, 'and asking for it from the other side gives the same answer, so it is marked out once');

/* A plan does not stop being a plan when a wall goes on it — the drawing
 * simply has something better to draw there. */
bld.setWall(one, 0, 10, 10, 'n', 'solid', 'log');
const walled = borderOf(10, 10, 'n');
say(!!bld.wallOnBorder(0, walled), 'a wall planned on an outline border is a wall');
say(bld.edgeOf(walled)?.id === one.id, 'and the border is still the edge of the plan underneath it');

if (bad) {
  console.error(`${bad} of them are not what they should be`);
  process.exit(1);
}
console.log('a plan is marked out round its outline, once per border, whether or not anything stands on it yet');
