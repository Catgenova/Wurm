/**
 * Draw the survey chart's relief, from the shape of the islands outward.
 *
 * The chart's coastlines were traced from the reference map and are right. Its
 * elevation channel was not: it was very nearly a blurred distance-from-the-sea,
 * which carries an outline faithfully and carries no topography at all. The
 * volcano had no cone and no caldera, the northeast range had no spine, the
 * crescent had no escarpment, and every landmass came out the same height —
 * because the only thing deciding height was how far inland you were.
 *
 * So the outlines are kept, to the texel, and the relief inside them is built:
 * a cone with a crater lake, a ridge line with peaks along it, an escarpment
 * standing above the bay, and uplands with their own summits. The reference is
 * followed for where things are and how high they stand relative to each other.
 *
 * Run with `npm run atlas`. It rewrites `src/world/atlas-data.ts` in place and
 * prints the scale the config has to be set to, because the two are one
 * decision: `land` is *defined* as the height of the chart's highest ground.
 *
 *   npx esbuild tools/build-atlas.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/build-atlas.mjs && node node_modules/.cache/build-atlas.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { readAtlas } from './atlas-node';
import { mulberry32, Noise2D } from '../src/world/noise';
import { BAY } from '../src/world/regions';

/*
 * Resolved against the working directory rather than `import.meta.url`, for
 * the reason written down in `atlas-node.ts`: the bundle is written to
 * `node_modules/.cache`, so a path relative to the module is a path relative
 * to the cache. This is run from the repository root, by `npm run atlas`.
 */
const DATA = `${process.cwd()}/src/world/atlas-data.ts`;

const atlas = readAtlas();

/**
 * The chart is drawn at twice the resolution it is read at.
 *
 * Not for its own sake. A texel of a 512 chart is eight tiles of a 4096
 * island, and `sample` reads the chart bilinearly, so *no* transition written
 * into it — however abrupt — can arrive steeper than its drop spread over
 * eight tiles. That is the ceiling on every cliff on the map, and at 512 it
 * sits below the slope at which the classifier calls ground bare rock. The
 * crescent's plateau could have a vegetated top or it could have cliff edges,
 * and not both: the only way to have both was to make a texel four tiles
 * instead of eight.
 *
 * Everything measured in texels below is scaled by `T` so that it goes on
 * meaning the same distance on the ground.
 *
 * The size is written down rather than derived from the chart being read, and
 * that is not fussiness. This tool reads its own last output for the coastline,
 * so `atlas.n * 2` doubles the chart every single time it runs: 512, then
 * 1024, then 2048, each one quietly four times the file of the last, with the
 * relief constants meaning half as much ground each round. It had reached 2048
 * before anybody looked at the number.
 */
const N = 1024;
/** Texels per texel of the 512 chart the distances below were written against. */
const T = N / 512;
/** And from whatever the chart on disk happens to be, to what is emitted. */
const S = N / atlas.n;
const idx = (x: number, y: number): number => y * N + x;

// ---------------------------------------------------------------- the shapes
//
// Everything below is in chart coordinates: u and v from 0 to 1 across the
// whole archipelago, which is how the reference was read and how `regions.ts`
// already writes down where each island is.

/** Peak heights in dirt units, which is what sets the hierarchy of the place. */
const H = {
  /** The caldera rim. The tallest thing on the chart, and the scale's top. */
  volcano: 512,
  /** The floor of the crater, below the water line, so it holds a lake. */
  crater: -46,
  /** The northeast mountains: snow country, second only to the volcano. */
  alpine: 520,
  /** The northwest range, which the reference draws as bare rock. */
  steppe: 470,
  /** The crescent's tableland, walled by cliffs, standing over the bay. */
  plateau: 344,
  /**
   * The top bench of the staircase that steps down from it to the beach.
   *
   * Held well under the tableland on purpose. At 236 the benches came up so
   * close beneath it that the drop off its inner edge was a hundred and eight
   * over four tiles — under the slope at which ground goes bare, so the wall
   * the reference draws stopped being a wall and the rim went green. The gap
   * between the two is what makes the inner cliff a cliff.
   */
  terrace: 196,
  /**
   * And the bottom one, the coastal plain behind the beach.
   *
   * Not zero, which was the first try and put the whole interior under water.
   * The chart keeps 127 steps above the water line, so at this scale a step is
   * nearly five dirt units and anything under about ten rounds to sea level
   * and is then taken below it by the detail noise. A bench has to stand clear
   * of that to be a bench.
   */
  plain: 34,
  middle: 404,
  east: 336,
  skerry: 212,
  /** Anything with no massif of its own — the skerries and the islets. */
  islet: 46,
  /** How high the plain coastal shelf gets before a massif adds to it. */
  shelf: 17,
  /** And how high the inland body of any landmass stands, with no massif. */
  body: 112,
  /** The deepest ocean. */
  abyss: -205,
  /** The shelf that runs out from every shore before the ground falls away. */
  shallow: -26,
};

/** The volcano: a cone with a crater bitten out of the top of it. */
const CONE: [number, number] = [0.5055, 0.1055];
const CRATER_R = 0.0225;
/** How many benches the crescent's interior falls through on its way down. */
const TIERS = 3;
const CONE_R = 0.1060;
/**
 * Which way the crater is breached. The reference draws the rim open to the
 * north, with the notch running down the flank as a valley — the one thing
 * that makes a volcano read as having erupted rather than been built.
 */
const BREACH = -Math.PI / 2;

/**
 * Mountains as the ground they cover, not lines they stand along.
 *
 * A segment with the height falling off to either side was the first attempt
 * at the northeast range, and it came out an embankment: one crest, two even
 * slopes, no summits. The reference draws every one of these as a *mass* — an
 * oval of high country with separate tops in it and saddles between them. So
 * each is an ellipse, tilted as drawn, and the summits come out of ridged
 * noise inside it rather than being placed.
 */
interface Range {
  key: string;
  at: [number, number];
  /** Semi-axes: `a` along `rot`, `b` across it. */
  a: number;
  b: number;
  rot: number;
  h: number;
  /** How sharply the ground climbs from the edge of the mass to its summits. */
  fall: number;
  /** How much of the height the ridged noise is allowed to take away. */
  relief: number;
  /** Frequency of that noise, which sets how far apart the summits are. */
  grain: number;
}

const RANGES: Range[] = [
  // The northeast: a compact knot of snow peaks, tilted down to the east.
  { key: 'alps', at: [0.8540, 0.2400], a: 0.0950, b: 0.0530, rot: 0.50, h: H.alpine, fall: 0.85, relief: 0.44, grain: 23 },
  // The northwest: a longer, lower range of bare rock across the top of the
  // island, running northwest to southeast as the reference draws it.
  { key: 'nw', at: [0.1610, 0.2130], a: 0.0990, b: 0.0560, rot: 0.72, h: H.steppe, fall: 0.95, relief: 0.40, grain: 21 },
  // And the hill mass in the south of the same island.
  { key: 'nw-south', at: [0.2120, 0.3380], a: 0.0460, b: 0.0380, rot: 0.20, h: 214, fall: 1.15, relief: 0.50, grain: 26 },
  // The middle isle, highest in its northwest quarter.
  { key: 'middle', at: [0.4780, 0.3430], a: 0.0760, b: 0.0620, rot: -0.35, h: H.middle, fall: 1.05, relief: 0.42, grain: 24 },
  // The east isle, lower again.
  { key: 'east', at: [0.7480, 0.4450], a: 0.0700, b: 0.0500, rot: 0.15, h: H.east, fall: 1.10, relief: 0.44, grain: 25 },
  // And the west skerry, which is hills and nothing more.
  { key: 'skerry', at: [0.0870, 0.4290], a: 0.0520, b: 0.0450, rot: 0, h: H.skerry, fall: 1.20, relief: 0.46, grain: 30 },
];

/**
 * The river, as the line it runs along, from the northern sea to the bay.
 *
 * It rises on the watershed in the middle of the interior and drains both
 * ways: south across the benches to the bay, and north straight at the
 * tableland, which it does not go round. It cuts through — a gorge in the
 * northern cliffs, spilling out to the sea on the far side.
 */
const RIVER: Array<[number, number]> = [
  [0.4770, 0.5075], [0.4785, 0.5290], [0.4800, 0.5460], [0.4815, 0.5640],
  [0.4835, 0.5830], [0.4930, 0.6120], [0.4880, 0.6410], [0.4985, 0.6700],
  [0.5065, 0.6930], [0.5015, 0.7150], [0.5140, 0.7330], [0.5215, 0.7470],
];
/*
 * The river is a bed the ground is held down to, rather than a shape
 * subtracted from it.
 *
 * Subtracting was the obvious way and it is wrong at the one place that
 * matters. A fixed depth taken off the ground makes a crease in a plain and
 * nothing at all in a cliff: the same eighty units that floods a lowland
 * leaves two hundred and sixty of tableland standing, so the river climbed the
 * escarpment instead of cutting it. Written as a surface — this is where the
 * water is, and the ground may not be below it — the river cuts whatever it
 * runs into, as deep as that happens to be, and touches nothing on either side
 * of itself. Which is what "break through without toning anything down" is.
 *
 * `RIVER_WIDE` is the half-width of the floodplain in soft ground and
 * `RIVER_TIGHT` the half-width in hard, chosen by how high the ground is: a
 * river spreads out across a plain and runs in a slot through a cliff, and one
 * number for both gave either a crease in the lowlands or a hole in the rim.
 */
const RIVER_WIDE = 0.0138;
const RIVER_TIGHT = 0.0026;
/** How fast the valley sides climb away from the water, in units per width. */
const RIVER_RISE = 300;
/**
 * The water's height at the two mouths, and on the watershed between them.
 *
 * Both low, because a bed at twenty-six is a dry valley: the marsh and reed
 * rules want ground under five and the sand rule under six, so a river whose
 * floor never gets there is a fold in a field. Both are also not zero, because
 * a continuous channel at sea level from the bay to the northern sea is not a
 * river, it is a strait, and there are no bridges on a fresh island. The
 * watershed between the two mouths is what you walk across.
 */
const RIVER_MOUTH = 1;
const RIVER_CREST = 15;

// ------------------------------------------------------------------- helpers
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** And to a polyline: `out[0]` the distance, `out[1]` how far along it, 0 to 1. */
const RIVER_RUN = (() => {
  const at: number[] = [0];
  let total = 0;
  for (let i = 1; i < RIVER.length; i++) {
    total += Math.hypot(RIVER[i][0] - RIVER[i - 1][0], RIVER[i][1] - RIVER[i - 1][1]);
    at.push(total);
  }
  return { at, total };
})();

function toPath(px: number, py: number, path: Array<[number, number]>, out?: number[]): number {
  let best = Infinity;
  let along = 0;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1][0];
    const ay = path[i - 1][1];
    const dx = path[i][0] - ax;
    const dy = path[i][1] - ay;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    const d = Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    if (d < best) {
      best = d;
      along = (RIVER_RUN.at[i - 1] + t * (RIVER_RUN.at[i] - RIVER_RUN.at[i - 1])) / RIVER_RUN.total;
    }
  }
  if (out) out[1] = along;
  return best;
}

/**
 * Distance in texels from every cell to the nearest cell the test accepts.
 *
 * True Euclidean distance, by the separable transform: a pass down the columns
 * and a pass along the rows, each taking the lower envelope of a set of
 * parabolas. A breadth-first flood was tried first and was wrong in a way that
 * was invisible until the ocean was drawn — counting steps through the grid
 * measures Manhattan distance, so every contour it produced was a diamond, and
 * the whole sea came out as a lattice of them radiating off the coasts.
 */
function distanceTo(accept: (i: number) => boolean): Float32Array {
  const INF = 1e12;
  const f = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) f[i] = accept(i) ? 0 : INF;

  const line = new Float64Array(N);
  const out = new Float64Array(N);
  const v = new Int32Array(N);
  const z = new Float64Array(N + 1);
  /** Lower envelope of the parabolas rooted at each sample of `line`. */
  const envelope = (): void => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < N; q++) {
      let s = 0;
      for (;;) {
        s = ((line[q] + q * q) - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        if (s > z[k]) break;
        k--;
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    for (let q = 0, j = 0; q < N; q++) {
      while (z[j + 1] < q) j++;
      out[q] = (q - v[j]) * (q - v[j]) + line[v[j]];
    }
  };

  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) line[y] = f[y * N + x];
    envelope();
    for (let y = 0; y < N; y++) f[y * N + x] = out[y];
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) line[x] = f[y * N + x];
    envelope();
    for (let x = 0; x < N; x++) f[y * N + x] = out[x];
  }
  const d = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) d[i] = Math.sqrt(f[i]);
  return d;
}

// ------------------------------------------------------- the mask, as traced
//
// The one thing that is kept exactly. Regions are matched to connected land
// components by centroid, the spawn is a beach texel on the bay, and every
// islet in the archipelago is where somebody drew it — all of that is the
// outline, and none of it is what was wrong.
const land = new Uint8Array(N * N);
{
  // Carried up through a signed distance rather than by repeating texels: a
  // nearest-neighbour mask at twice the size is the same coastline with square
  // corners on it, and this is the same coastline drawn finer.
  const n0 = atlas.n;
  const was = new Uint8Array(n0 * n0);
  for (let i = 0; i < n0 * n0; i++) was[i] = atlas.elev[i] >= 0 ? 1 : 0;
  const near = (accept: (i: number) => boolean): Float32Array => {
    const d = new Float32Array(n0 * n0).fill(Infinity);
    let front: number[] = [];
    for (let i = 0; i < n0 * n0; i++) if (accept(i)) { d[i] = 0; front.push(i); }
    for (let step = 1; front.length; step++) {
      const next: number[] = [];
      for (const i of front) {
        const x = i % n0;
        const y = (i / n0) | 0;
        const put = (j: number): void => { if (d[j] === Infinity) { d[j] = step; next.push(j); } };
        if (x > 0) put(i - 1);
        if (x < n0 - 1) put(i + 1);
        if (y > 0) put(i - n0);
        if (y < n0 - 1) put(i + n0);
      }
      front = next;
    }
    return d;
  };
  const toWater = near((i) => was[i] === 0);
  const toLand = near((i) => was[i] === 1);
  const sd = new Float32Array(n0 * n0);
  for (let i = 0; i < n0 * n0; i++) sd[i] = was[i] ? toWater[i] - 0.5 : 0.5 - toLand[i];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const fx = Math.min(n0 - 1, Math.max(0, (x + 0.5) / S - 0.5));
      const fy = Math.min(n0 - 1, Math.max(0, (y + 0.5) / S - 0.5));
      const x0 = fx | 0;
      const y0 = fy | 0;
      const x1 = Math.min(n0 - 1, x0 + 1);
      const y1 = Math.min(n0 - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      const v = (sd[y0 * n0 + x0] * (1 - tx) + sd[y0 * n0 + x1] * tx) * (1 - ty)
        + (sd[y1 * n0 + x0] * (1 - tx) + sd[y1 * n0 + x1] * tx) * ty;
      land[idx(x, y)] = v > 0 ? 1 : 0;
    }
  }
}

// With one exception: the volcano is given its crater back. The cone is a ring
// of land either way, so the landmass stays one connected component and the
// region map does not shift.
let carved = 0;
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const r = Math.hypot(x / N - CONE[0], y / N - CONE[1]);
    if (r < CRATER_R * 0.66 && land[idx(x, y)]) { land[idx(x, y)] = 0; carved++; }
  }
}

/**
 * Two different questions that a single distance-to-water conflates.
 *
 * `dShore` is how far it is to any water at all, which is what decides where
 * a beach is — a lake has a shore like anything else. `dInland` is how far it
 * is to the open sea, and that is what the escarpment is keyed to. Built off
 * the same field at first, and the lakes on the crescent came out ringed by
 * their own escarpments, like a row of little craters.
 */
const ocean = new Uint8Array(N * N);
{
  // Marked when it goes on the stack, not when it comes off. Marking on the
  // way out lets a cell be pushed once for every neighbour that reaches it,
  // and on a million-cell grid with an ocean this size that is enough pushes
  // to take the array past what an array may hold: `Invalid array length`,
  // four hundred lines from anything to do with rivers.
  const stack: number[] = [];
  const put = (j: number): void => { if (!ocean[j] && !land[j]) { ocean[j] = 1; stack.push(j); } };
  for (let x = 0; x < N; x++) { put(x); put((N - 1) * N + x); }
  for (let y = 0; y < N; y++) { put(y * N); put(y * N + N - 1); }
  while (stack.length) {
    const k = stack.pop() as number;
    const x = k % N;
    const y = (k / N) | 0;
    if (x > 0) put(k - 1);
    if (x < N - 1) put(k + 1);
    if (y > 0) put(k - N);
    if (y < N - 1) put(k + N);
  }
}
const dShore = distanceTo((i) => !land[i]);
const dInland = distanceTo((i) => ocean[i] === 1);
const dLand = distanceTo((i) => land[i] === 1);

// --------------------------------------------------------------- the profile
const rng = mulberry32(20260915);
const warp = new Noise2D(rng);
const rough = new Noise2D(rng);
const roll = new Noise2D(rng);
/**
 * The river's wander. Taken last out of the stream on purpose: a `Noise2D`
 * drawn earlier would shift every field after it and redraw the whole
 * archipelago for the sake of one meander.
 */
const wind = new Noise2D(rng);

/**
 * Hill country: ridged fractal noise in 0..1, with valleys between spurs
 * rather than the rounded lumps plain fbm gives. This is the ground between
 * the named features — most of every island, and most of where anybody walks.
 */
function hills(u: number, v: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 6.5;
  for (let o = 0; o < 4; o++) {
    const r = 1 - Math.abs(roll.noise(u * f + o * 17.3, v * f - o * 9.1));
    sum += r * r * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.07;
  }
  return sum / norm;
}

/**
 * A staircase in `t`: flat treads with the riser between them as sharp as the
 * chart can hold, which is one texel, which is four tiles.
 *
 * `wobble` moves the riser rather than the tread, so the scarp between two
 * benches wanders instead of following a contour of the distance field — a
 * terrace drawn with compasses reads as a contour line, not as ground.
 */
function tier(t: number, steps: number, wobble: number): number {
  const s = clamp(t, 0, 1) * steps;
  const k = Math.min(steps - 1, Math.floor(s));
  const f = s - k;
  return Math.min(1, (k + (f > 0.84 + wobble ? 1 : 0)) / steps);
}

/**
 * The relief this texel stands on, in dirt units above the coastal shelf.
 *
 * `out[0]` is that height. `out[1]` is how much of the landmass's own hill
 * country to keep underneath it — one everywhere except on the crescent's
 * benches, where rolling ground would fill the treads back in and there would
 * be no terrace left to see.
 */
function massif(u: number, v: number, inland: number, out: number[]): void {
  // A little domain warp so nothing reads as a circle drawn with compasses.
  const wu = u + warp.fbm(u * 9 + 11, v * 9 - 4, 3) * 0.016;
  const wv = v + warp.fbm(u * 9 - 7, v * 9 + 13, 3) * 0.016;

  // ---- The volcano. Steep near the rim and flaring at the base, which is the
  // shape a cone of ash and lava actually takes, then a crater sunk into it.
  const rc = Math.hypot(wu - CONE[0], wv - CONE[1]);
  if (rc < CONE_R) {
    const th = Math.atan2(wv - CONE[1], wu - CONE[0]);
    // Barrancas: the deep radial gullies a stratovolcano wears down its flanks.
    const gully = 1 + rough.fbm(Math.cos(th) * 2.6, Math.sin(th) * 2.6, 3) * 0.16
      + Math.cos((th - BREACH) * 9) * 0.045;
    // And the breach, a notch cut through the rim and down the flank.
    let off = ((th - BREACH + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const notch = Math.exp(-((off / 0.30) ** 2)) * smooth(CONE_R * 0.75, CRATER_R * 0.8, rc);
    if (rc <= CRATER_R) {
      const wall = mix(H.crater, H.volcano, smooth(0, 1, rc / CRATER_R) ** 0.8);
      out[0] = wall * (1 - 0.72 * notch);
      out[1] = 1;
      return;
    }
    /*
     * Very nearly a straight cone. The exponent was 1.45, which falls away so
     * fast that only the innermost fifth of the cone cleared the line at which
     * ground goes bare — a grey ring round the crater on a green hill, where
     * the reference draws a mountain of ash with green only at its foot. What
     * decides that is the ratio of the rock line to the top of the scale, and
     * raising the volcano cannot change it, because the top of the scale *is*
     * the volcano. Only the shape of the flank can.
     */
    const t = (rc - CRATER_R) / (CONE_R - CRATER_R);
    out[0] = H.volcano * (1 - t) ** 1.05 * gully * (1 - 0.34 * notch);
    out[1] = 1;
    return;
  }

  // ---- The crescent, which is the one everybody lives on.
  //
  // A tableland running round the outer rim with a cliff at each edge of it:
  // up from the sea outside, down to the interior inside, and level between
  // them. The reference is unambiguous — two lines of hatching, and contours
  // lying quiet in the band between.
  //
  // Two earlier attempts were wrong in instructive ways. Keyed to distance
  // from the bay, the whole continent became one brown dome, because distance
  // from the bay only ever goes up. Keyed to distance inland but as a single
  // crest, it was a ridge: one summit line falling away both ways, with no top
  // to stand on. Two edges and a level middle is the whole of the difference.
  const db = Math.hypot(wu - BAY[0], wv - BAY[1]);
  if (wv > 0.500) {
    const seaward = smooth(0.185, 0.248, db);
    const outer = smooth(0, 1.7 * T, inland);
    /*
     * A step, not a slope — and this is the sharpest edge the chart can hold.
     *
     * A texel of chart is eight tiles of island and `sample` reads it
     * bilinearly, so any transition, however abrupt it is written here, arrives
     * as a ramp at least eight tiles long. Written as a smoothstep over three
     * and a half texels it arrived as fifty tiles of hillside, and the section
     * through the rim showed a ramp where the reference draws a wall. Written
     * as a step it arrives as the eight, which is the floor.
     *
     * The line is given a wander of its own so that it follows something other
     * than a contour of the distance field, which would be visibly drawn with
     * a compass.
     */
    const edge = (18.4 + 3.6 * rough.fbm(wu * 11 + 41, wv * 11 - 23, 3)) * T;
    const inner = inland < edge ? 1 : 0;
    // The top is not glass, and where the noise dips the rim is a pass rather
    // than a wall — the bay would otherwise be walled in but for the river.
    const pass = smooth(-0.34, 0.30, roll.fbm(wu * 7.5 + 21, wv * 7.5 - 13, 3));
    const cap = 0.88 + 0.12 * (rough.fbm(wu * 26 + 17, wv * 26 - 5, 4) * 0.5 + 0.5);
    const plateau = H.plateau * seaward * outer * inner * cap * (0.52 + 0.48 * pass);

    /*
     * And below the tableland, benches stepping down to the beach.
     *
     * Keyed to distance from the bay rather than distance inland, because that
     * is the direction they descend: the tableland is set by how far it is
     * from the outer coast, the staircase by how far it is from the water
     * everybody lands on. `reach` fades them out where the crescent's arms run
     * away from the bay, so the arms stay the upland the reference draws
     * rather than becoming a second tableland.
     */
    const wobble = rough.fbm(wu * 13 + 61, wv * 13 - 29, 3) * 0.11;
    const reach = 1 - smooth(0.305, 0.430, db);
    const ladder = mix(H.plain, H.terrace, tier(smooth(0.170, 0.300, db), TIERS, wobble));
    const bench = ladder * reach;

    out[0] = Math.max(plateau, bench);
    // Hill country would fill the treads straight back in. A little is left so
    // that a bench rolls rather than lying like a floor.
    out[1] = 1 - 0.85 * reach;
    return;
  }

  // ---- And the ranges, each inside its own ellipse.
  let best = 0;
  out[1] = 1;
  for (const R of RANGES) {
    const ax = wu - R.at[0];
    const ay = wv - R.at[1];
    const cs = Math.cos(R.rot);
    const sn = Math.sin(R.rot);
    const r = Math.hypot((ax * cs + ay * sn) / R.a, (-ax * sn + ay * cs) / R.b);
    if (r >= 1) continue;
    const rv = 1 - Math.abs(rough.fbm(wu * R.grain + 31, wv * R.grain - 17, 4));
    const knot = 1 - R.relief + R.relief * rv ** 1.2;
    best = Math.max(best, R.h * (1 - r) ** R.fall * knot);
  }
  out[0] = best;
}

// ------------------------------------------------------------- and the chart
const height = new Float32Array(N * N);
const mo = [0, 1];
const riv = [0, 0];
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const i = idx(x, y);
    const u = x / N;
    const v = y / N;
    if (!land[i]) {
      // Bathymetry: a shelf that runs out from every shore, then the floor
      // drops away. Inland water is surrounded by land, so it stays a lake.
      const d = dLand[i];
      height[i] = H.shallow * smooth(0, 3.5 * T, d) + (H.abyss - H.shallow) * smooth(3.5 * T, 46 * T, d);
      continue;
    }
    massif(u, v, dInland[i], mo);
    const m = mo[0];
    /*
     * Every landmass has a body to it before any named relief stands on it.
     * Without this the islands were a coastal shelf with a hill in the middle
     * and a wide flat apron between the two — 82% of the land came out below
     * the height at which anything but open ground grows. A flat body was the
     * next thing tried and was as bad the other way: seven green tables with a
     * nub in the middle of each. So the body is itself hill country, ridged,
     * and the named massifs stand above it. It is taken as the greater of the
     * two rather than added, so a peak still stands at its designed height;
     * and it fades out on its own over an islet, which is never more than a
     * texel or two from open water.
     */
    const body = (H.body * 0.52 + H.body * 0.78 * hills(u, v)) * smooth(0.5 * T, 24 * T, dInland[i]) * mo[1];
    /*
     * The river is applied after the two are resolved and not before. Carved
     * inside the massif it was carved into a number the `max` below then threw
     * away for being smaller than the body of the continent, and the valley
     * did not exist. A river is a thing that happens to whatever ground is
     * there, which is exactly what applying it last means.
     */
    const ground = Math.max(body, m);
    /*
     * The river is measured against a warped copy of the ground rather than
     * the ground itself, which is what makes it meander. Written straight from
     * waypoint to waypoint it arrived as a ruled line — worst of all through
     * the gorge, where a slot cut dead straight through a cliff reads as a
     * canal somebody dug. Warping the point before measuring bends the whole
     * course, at every scale at once, without any waypoint having to move.
     */
    const ru = u + wind.fbm(u * 17 + 5, v * 17 - 11, 3) * 0.0075;
    const rv = v + wind.fbm(u * 17 - 9, v * 17 + 4, 3) * 0.0075;
    const dr = toPath(ru, rv, RIVER, riv);
    // Its bed: low at both mouths, up over the watershed in between, so the
    // interior drains north through the gorge and south to the bay.
    const bed = RIVER_MOUTH + (RIVER_CREST - RIVER_MOUTH) * Math.sin(Math.PI * riv[1]);
    // A slot where the ground is hard and high, a floodplain where it is low.
    const tight = smooth(120, 300, ground);
    const width = mix(RIVER_WIDE, RIVER_TIGHT, tight);
    const water = bed + RIVER_RISE * (dr / width) ** 2;
    const relief = Math.min(ground, water);
    // How far the ground takes to climb out of the sea. Gentle where the
    // relief is low, which is every beach and the whole of the bay shore;
    // short where it is high, which is where the reference draws sea cliffs.
    /*
     * How far the ground takes to climb out of the sea. Gentle where the
     * relief is low and short where it is high, so a lowland coast gets a
     * strand and a tableland gets a sea cliff.
     *
     * The gentle end was 4.6 texels, which put the shore band — everything the
     * classifier calls sand, being ground under six with water in sight —
     * inside about eight tiles of the water. That is a waterline, not a beach,
     * and on a plate drawn at four tiles to the cell it very nearly is not
     * there at all. At 8.4 the strand is twenty-odd tiles of it, which is what
     * the reference draws round the bay.
     */
    const steep = clamp(relief / 240, 0, 1);
    const ramp = mix(8.4, 0.9, steep) * T;
    const rise = smooth(0, ramp, dShore[i]);
    const base = H.shelf * smooth(0, 5.0 * T, dShore[i]);
    // A slow roll over the lowlands so that flat is never quite flat.
    const lump = roll.fbm(u * 14 + 5, v * 14 + 2, 4) * 13;
    height[i] = Math.max(0.5, base + relief * rise + lump * smooth(0, 4 * T, dShore[i]));
  }
}

// --------------------------------------------------------- the other channels
//
// Green gates the generator's ridged noise, which is now only surface texture:
// the chart carries the mountains itself. So it opens where the ground is
// steep or high and stays shut over the lowlands, instead of standing open
// across 98% of the land as it did when it was doing the mountains' work.
const ridge = new Float32Array(N * N);
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const i = idx(x, y);
    if (!land[i]) { ridge[i] = 0; continue; }
    const gx = height[idx(Math.min(N - 1, x + 1), y)] - height[idx(Math.max(0, x - 1), y)];
    const gy = height[idx(x, Math.min(N - 1, y + 1))] - height[idx(x, Math.max(0, y - 1))];
    const slope = Math.hypot(gx, gy) / 2;
    // The gradient is per texel, so it halves when a texel halves.
    ridge[i] = clamp(smooth(2 / T, 26 / T, slope) * 0.72 + smooth(90, 330, height[i]) * 0.55, 0, 1);
  }
}
// Smoothed, so the gate does not flicker texel to texel and leave the noise
// switching on and off across a hillside.
const soft = new Float32Array(N * N);
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    let s = 0;
    let k = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        s += ridge[idx(nx, ny)];
        k++;
      }
    }
    soft[idx(x, y)] = s / k;
  }
}

// ------------------------------------------------------------- write it back
/** Moisture, unchanged in substance and carried up to the finer grid. */
const moist = new Float32Array(N * N);
{
  const n0 = atlas.n;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const fx = Math.min(n0 - 1, Math.max(0, (x + 0.5) / S - 0.5));
      const fy = Math.min(n0 - 1, Math.max(0, (y + 0.5) / S - 0.5));
      const x0 = fx | 0;
      const y0 = fy | 0;
      const x1 = Math.min(n0 - 1, x0 + 1);
      const y1 = Math.min(n0 - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      moist[idx(x, y)] = (atlas.moist[y0 * n0 + x0] * (1 - tx) + atlas.moist[y0 * n0 + x1] * tx) * (1 - ty)
        + (atlas.moist[y1 * n0 + x0] * (1 - tx) + atlas.moist[y1 * n0 + x1] * tx) * ty;
    }
  }
}

let top = 0;
let deep = 0;
for (let i = 0; i < N * N; i++) {
  if (height[i] > top) top = height[i];
  if (height[i] < deep) deep = height[i];
}
const LAND = Math.ceil(top);
const DEPTH = Math.ceil(-deep);

const px = new Uint8Array(N * N * 3);
for (let i = 0; i < N * N; i++) {
  /*
   * Land stays at or above 128 and water stays below it, whatever the rounding
   * would otherwise do.
   *
   * This tool reads its own last output for the coastline — that is how the
   * outlines are kept to the texel — so the mask has to be a fixed point, and
   * without these two clamps it is not. A water texel half a texel off the
   * shore works out to a depth of about half a unit, which rounds to exactly
   * 128, which reads back as land. Run it again and the shore has moved a
   * texel. Run it ten times, as this was, and the coastline has been quietly
   * redrawn while nobody was looking at it.
   */
  const e = height[i] >= 0 ? height[i] / LAND : height[i] / DEPTH;
  const r = Math.round(128 + e * 127);
  px[i * 3] = land[i] ? clamp(Math.max(128, r), 128, 255) : clamp(Math.min(127, r), 1, 127);
  /*
   * Green and blue are quantised, and that is what pays for the finer grid.
   *
   * Doubling the chart took it from 321 KB to 2.0 MB, which is not a price
   * worth paying for a map on a phone. But of those two megabytes only 418 KB
   * were elevation: the other channels were costing four times what they were
   * worth, because both were being stored to a precision neither can use.
   * Green *gates* the ridged noise — at `ridge: 85` a step of sixteen moves
   * the ground by a third of a dirt unit. Blue is compared against a handful
   * of thresholds after a fbm twice its size is added to it. Sixteen levels
   * and thirty-two, and the chart comes back under 800 KB with every bit of
   * the elevation it had.
   */
  px[i * 3 + 1] = Math.round(clamp(soft[i], 0, 1) * 15) * 17;
  // Moisture is left as it was in substance: it decides forest, steppe and
  // marsh, and none of that was what the relief got wrong.
  px[i * 3 + 2] = Math.round(clamp(moist[i], 0, 1) * 31) * 8.226;
}

/**
 * PNG, with the row filters actually used.
 *
 * Every row went out as filter 0 — store the bytes as they are — which is the
 * easy thing to write and the worst thing to do to a height field. Elevation
 * is a smooth gradient: neighbouring bytes differ by one or two, and telling
 * deflate to compress the *differences* instead of the values is most of what
 * PNG is for. The standard heuristic, pick per row whichever filter gives the
 * smallest sum of absolute differences, is four lines and pays for the finer
 * chart twice over.
 */
function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const stride = w * 3;
  const BPP = 3;
  const raw = Buffer.alloc((stride + 1) * h);
  const line = Buffer.alloc(stride);
  const best = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgb.subarray((y - 1) * stride, y * stride) : null;
    let bestKind = 0;
    let bestScore = Infinity;
    for (let kind = 0; kind < 5; kind++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= BPP ? row[x - BPP] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= BPP ? prev[x - BPP] : 0;
        let v: number;
        if (kind === 0) v = row[x];
        else if (kind === 1) v = row[x] - a;
        else if (kind === 2) v = row[x] - b;
        else if (kind === 3) v = row[x] - ((a + b) >> 1);
        else {
          const pp = a + b - c;
          const pa = Math.abs(pp - a);
          const pb = Math.abs(pp - b);
          const pc = Math.abs(pp - c);
          v = row[x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        v &= 0xff;
        line[x] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; bestKind = kind; line.copy(best); }
    }
    raw[y * (stride + 1)] = bestKind;
    best.copy(raw, y * (stride + 1) + 1);
  }
  let table: Int32Array | null = null;
  const crc32 = (buf: Buffer): number => {
    if (!table) {
      table = new Int32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return c ^ 0xffffffff;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const b64 = png(N, N, px).toString('base64');
const src = readFileSync(DATA, 'utf8');
const shape = /'data:image\/png;base64,[A-Za-z0-9+\/=]+'/;
if (!shape.test(src)) throw new Error('the chart in atlas-data.ts is not the shape this replaces');
const out = src.replace(shape, `'data:image/png;base64,${b64}'`);
/*
 * Unchanged is the expected answer on a second run and not a failure. This
 * used to be `if (out === src) throw`, which conflated "nothing matched" with
 * "nothing moved" — and now that the mask is a fixed point, nothing moving is
 * the whole point. The shape is tested separately, above, which is the thing
 * that guard was actually for.
 */
const same = out === src;
writeFileSync(DATA, out);

let lake = 0;
for (let i = 0; i < N * N; i++) if (!land[i] && dLand[i] <= 2 && height[i] > -30) lake++;
console.log(`chart ${same ? 'unchanged' : 'rebuilt'}: ${N} x ${N}, ${carved} texels carved for the crater`);
console.log(`highest ground ${top.toFixed(0)}, deepest water ${deep.toFixed(0)}`);
console.log(`set ATLAS_CONFIG.land = ${LAND} and depth = ${DEPTH}`);
console.log(`green open on ${((soft.filter((v) => v > 0.02).length / (N * N)) * 100).toFixed(1)}% of the chart`);
