/**
 * How high the chart's ground actually gets, against how high it has to get.
 *
 * `ATLAS_CONFIG.land` is documented as *dirt units at the highest ground the
 * chart shows*, and `depth` as *dirt units at the deepest water*. Both are
 * multipliers on `(R - 128) / 127`, and both would mean exactly what they say
 * if the chart's red channel used the whole of its range. It does not — so
 * `land: 300` delivers rather less than 300, and the shortfall is made up by
 * the ridged noise, which the chart only gates.
 *
 * That is worth a standing check because nothing else here would see it.
 * `agree.ts` checks that the founding generator and the joining generator
 * produce the same ground — and they would agree just as contentedly on ground
 * nobody drew. `landtrip.ts` checks that the ground survives the wire. This
 * checks that the ground is the one on the chart.
 *
 * It is deliberately two different kinds of check. The assertions are things
 * that are true by construction and must stay true: the water line sits at
 * exactly zero, the vertical scale cannot move a coastline, and neither clamp
 * is quietly flattening drawn relief. The rest is a report, because how much
 * of the island's high country the chart reaches unaided is a decision about
 * what the island should look like — not a rule to be failed in CI.
 */
import { generateAtlasWindow, ATLAS_CONFIG, BANDS } from '../../src/world/atlas-world';
import { readAtlas } from '../../tools/atlas-node';

const atlas = readAtlas();
const cfg = ATLAS_CONFIG;
const SIZE = 4096;
const SEED = 7;

let bad = 0;
const fail = (why: string): void => {
  console.log(`  FAIL ${why}`);
  bad++;
};
const say = (s = ''): void => console.log(s);
const pc = (n: number, of: number): string => (of ? `${((n / of) * 100).toFixed(2)}%` : '—');

// ---- The water line, which everything downstream is a comparison against.
//
// A tile is submerged when all four corners are below zero and a shore when
// any one of them is, so the whole classification of the island — and whether
// you may dig, build, walk or sail — hangs off this one number landing on it.
{
  const elevOf = (r: number): number => (r - 128) / 127;
  if (elevOf(128) !== 0) fail(`R = 128 should be sea level exactly, and is ${elevOf(128)}`);
  if (Math.sign(elevOf(129)) !== 1 || Math.sign(elevOf(127)) !== -1) fail('the water line does not separate 127 from 129');
}

// ---- What the chart draws, before a grain of noise is added to it.
let reach = 0;
let plumb = 0;
{
  let lo = Infinity;
  let hi = -Infinity;
  let loR = 255;
  let hiR = 0;
  for (const e of atlas.elev) {
    if (e < lo) lo = e;
    if (e > hi) hi = e;
  }
  loR = Math.round(lo * 127 + 128);
  hiR = Math.round(hi * 127 + 128);
  reach = hi * cfg.land;
  plumb = lo * cfg.depth;
  say('the chart');
  say(`  red channel runs ${loR} to ${hiR} of a possible 0 to 255`);
  say(`  highest ground ${reach.toFixed(0)} of the ${cfg.land} \`land\` is written for (${pc(reach, cfg.land)})`);
  say(`  deepest water ${plumb.toFixed(0)} of the ${-cfg.depth} \`depth\` is written for (${pc(-plumb, cfg.depth)})`);
}
say();

// ---- The ground, rolled twice: as it ships, and with the ridged noise off.
//
// Turning `ridge` down to zero leaves the chart's own ground plus the fine
// detail, through the same generator rather than through a copy of its
// arithmetic — so the difference between the two is exactly what the noise did.
const flat = { ...cfg, ridge: 0 };
const STEP = 256;
const W = 32;
const band = { hill: 0, alpine: 0, snow: 0 };
const drawn = { hill: 0, alpine: 0, snow: 0 };
let corners = 0;
let clamped = 0;
let lifted = 0;
let sunk = 0;
let top = -Infinity;
let floor = Infinity;
for (let oy = 0; oy < SIZE; oy += STEP) {
  for (let ox = 0; ox < SIZE; ox += STEP) {
    const on = generateAtlasWindow(SEED, atlas, ox, oy, W, W, SIZE, cfg);
    const off = generateAtlasWindow(SEED, atlas, ox, oy, W, W, SIZE, flat);
    for (let i = 0; i < on.heights.length; i++) {
      const h = on.heights[i];
      const g = off.heights[i];
      corners++;
      if (h <= -140 || h >= 480) clamped++;
      if (h > top) top = h;
      if (h < floor) floor = h;
      if (g < 0 && h >= 0) lifted++;
      if (g >= 0 && h < 0) sunk++;
      for (const k of ['hill', 'alpine', 'snow'] as const) {
        if (h > BANDS[k]) {
          band[k]++;
          if (g > BANDS[k]) drawn[k]++;
        }
      }
    }
  }
}

say(`the ground, ${corners} corners across the whole island`);
say(`  ${floor} at the seabed to ${top} at the summit`);
say();
say('  band            starts at   corners in it   the chart reaches unaided');
for (const [k, label] of [['hill', 'hill, forest'], ['alpine', 'rock, tundra'], ['snow', 'snow']] as const) {
  say(`  ${label.padEnd(14)}${String(BANDS[k]).padStart(10)}   ${pc(band[k], corners).padStart(13)}   ${pc(drawn[k], band[k]).padStart(25)}`);
}
if (reach < BANDS.snow) {
  say();
  say(`  note: the chart's highest ground is ${reach.toFixed(0)} and snow starts at ${BANDS.snow}, so no drawn`);
  say('        peak crosses the snow line on its own account. Every snowfield on the');
  say('        island is placed by the ridged noise, and moves when the seed does.');
}
say();

// ---- And the assertions.
//
// The clamp is the older generator's: `generate.ts` reaches -140, and this one
// comes nowhere near. If it ever starts biting, drawn relief is being flattened
// into a shelf and the config wants raising rather than the clamp.
if (clamped) fail(`${clamped} corners are pinned against the -140 / 480 clamp, flattening relief the chart drew`);

// The vertical scale multiplies each side of zero separately, so it cannot
// change the sign of a corner and cannot move a coastline. The ridged noise
// can, because it is added whatever the depth — a little of that is a rocky
// shore and a lot of it is islands nobody drew.
if (sunk) fail(`the ridged noise drowned ${sunk} corners, which it has no term able to do`);
//
// How much it lifts is reported and not asserted, and the reason is worth
// writing down: the number cannot run away. The lift is gated by the chart's
// own green channel, so the noise can only surface seabed the chart already
// drew as rocky country, and the share tops out near 0.8% however shallow the
// water is made. A threshold above that would never fire, which is a worse
// thing to have in a suite than no threshold at all.
say(`the ridged noise lifts ${pc(lifted, corners)} of corners out of water the chart drew them in`);

say();
// Deliberately not "the ground stands where the chart drew it": the report
// above may well say it does not, and that is a question for whoever drew the
// chart. What passing means is narrower — nothing between the chart and the
// ground is losing relief that was drawn.
say(bad ? `${bad} thing${bad > 1 ? 's' : ''} wrong with the relief` : 'no relief lost between the chart and the ground');
process.exit(bad ? 1 : 0);
