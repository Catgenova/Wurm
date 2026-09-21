import { hash2 } from '../world/noise';

/**
 * Ore in the rock.
 *
 * A seam used to be a tile filled with the metal's colour, which says the one
 * thing about ore that is not true: that it comes in four-metre squares. A
 * copper vein was a terracotta rhombus, a coal seam a black one, and a
 * hillside with three kinds in it read as a chequerboard somebody had painted.
 *
 * What is drawn now is the stone with the metal *in* it: bands of lobes lying
 * along the strata, in the ore's own colour, with the plain rock of the tile
 * showing between them.
 *
 * The part that makes it a vein rather than a blot per tile is where the lobes
 * are placed. Every one of them sits at a world position on a lattice laid
 * along the bands, so the tile either side of a join works out the same lobe
 * from the same numbers and draws its own half of it, clipped to itself. Two
 * neighbouring tiles share their corners, so the map from a share of a tile to
 * a point on the screen agrees along the edge between them, and the two halves
 * meet without a seam of their own. A band runs the length of an outcrop.
 *
 * Which way the bands run is a slow noise over the map: one hillside's strata
 * lie one way and the next one's another, and neither of them changes its mind
 * halfway up.
 */

type Ctx = CanvasRenderingContext2D;

/** Tiles between one band of ore and the next. */
const PITCH = 1.8;
/**
 * And between one lobe and the next along a band, which is well under a
 * lobe's own width: they run into each other and fill as one path, so a band
 * is a ribbon with a lumpy edge rather than a string of beads. Spaced out far
 * enough to stand apart they came out as a line of pebbles, which is what is
 * lying *on* a floor and not what is *in* a wall.
 */
const STEP = 0.28;
/**
 * A lobe's radius, as a share of a tile, before its own roll.
 *
 * This and the pitch together are how much of a tile of ore is metal, and
 * that is what this costs to draw: every pass over a band is pixels filled,
 * and a hillside that is ore the whole way across is the one place where the
 * ground pass can run out of frame. A band a fifth of a tile wide, with three
 * tiles' width of stone between one and the next, is a vein.
 */
const LOBE = 0.115;
/** How far off the band's own line a lobe may wander. */
const WANDER = 0.1;
/** How many tiles of country share one answer about which way the rock lies. */
const BLOCK = 24;

/**
 * Which way the strata run here, in radians: one answer per block of country,
 * and the same answer for every tile in it.
 *
 * It has to be a step and not a slope. Everything below works out where the
 * lobes of a band are from world coordinates, so that the tile either side of
 * a join finds the same lobes and the band runs on through; and it can only do
 * that if both tiles agree about the angle to the last bit. Smoothed over
 * twenty tiles the angle moved by a few degrees from one tile to the next,
 * which is nothing to look at and quite enough to make two neighbours work out
 * two different sets of lobes -- the seams came out in rectangular blocks,
 * each tile's band shifted off its neighbour's.
 *
 * The step that is left shows up where two blocks meet, as a line along which
 * the rock lies one way on one side and another on the other. Which is a
 * fault, and is what country does.
 */
function strata(x: number, y: number): number {
  return hash2(Math.floor(x / BLOCK), Math.floor(y / BLOCK), 503) * Math.PI;
}

/** A colour as `rgb()`, lightened or darkened about the middle. */
const tone = (c: readonly number[], k: number): string => {
  const f = (v: number): number => Math.round(Math.max(0, Math.min(255, k < 1 ? v * k : v + (255 - v) * (k - 1))));
  return `rgb(${f(c[0])}, ${f(c[1])}, ${f(c[2])})`;
};

/**
 * The seam on one tile of ore, drawn over the stone already there.
 *
 * `pts` is the tile's four screen corners and `rot` says which of them holds
 * the tile's own (0, 0), so a lobe worked out in shares of a tile lands on the
 * same square foot of ground whichever way the camera is round.
 *
 * A share of a tile goes to a point on the screen by the bilinear map across
 * those four corners, which is where the squash and the lie of the ground come
 * from: a lobe is a ring of points in tile shares and the map makes an ellipse
 * of it, tilted the way the tile is tilted, without any of this knowing that
 * it is drawing an isometric picture at all.
 *
 * The map is four multiplies a point, written out rather than called. It was a
 * pair of closures, which reads far better and cost seventy-five milliseconds
 * a frame on a hillside that was ore the whole way across: two calls a point,
 * eleven points a lobe, a dozen lobes a tile and nine hundred tiles on the
 * screen is a million and a half calls to draw one hillside.
 */
export function seam(g: Ctx, x: number, y: number, colour: readonly number[], pts: Float64Array, rot: number, zoom: number): void {
  const ang = strata(x, y);
  const nx = Math.cos(ang), ny = Math.sin(ang);
  // How far along the strata's normal this tile reaches, with room for a lobe
  // whose middle is outside it and whose edge is not.
  const here = x * nx + y * ny;
  const pad = LOBE * 2.2;
  const lo = here + Math.min(0, nx) + Math.min(0, ny) - pad;
  const hi = here + Math.max(0, nx) + Math.max(0, ny) + pad;
  // How far a band may sit off its own multiple of the pitch. Bands ruled at
  // exactly the pitch came out as a printed stripe; the scan below is widened
  // by this so a band that has wandered into the tile is still found.
  const DRIFT = PITCH * 0.22;

  const lobes: number[] = [];
  for (let b = Math.floor((lo - DRIFT) / PITCH); b <= Math.ceil((hi + DRIFT) / PITCH); b++) {
    const band = b * PITCH + (hash2(b, 0, 619) - 0.5) * 2 * DRIFT;
    if (band < lo || band > hi) continue;
    /*
     * Where along the band to start stepping, and how far the tile reaches
     * along it. Both are worked out in world terms and rounded to the lattice,
     * so the tile next door lands on the same lobes and not on its own set.
     */
    const t0 = -x * ny + y * nx;
    const reach = Math.abs(ny) + Math.abs(nx) + pad * 2;
    const from = Math.floor((t0 - reach) / STEP), to = Math.ceil((t0 + reach) / STEP);
    for (let i = from; i <= to; i++) {
      // A vein pinches out and picks up again: one lobe in eight is not there.
      if (hash2(b, i, 613) < 0.12) continue;
      const t = i * STEP;
      // Its own wander off the line, and its own size: a vein is not a pipe.
      const off = (hash2(b, i, 601) - 0.5) * 2 * WANDER;
      const r = LOBE * (0.55 + hash2(b, i, 607) * 1.05);
      const u = (band + off) * nx - t * ny - x;
      const v = (band + off) * ny + t * nx - y;
      if (u < -pad || u > 1 + pad || v < -pad || v > 1 + pad) continue;
      lobes.push(u, v, r);
    }
  }
  if (!lobes.length) return;

  // The bilinear map across the tile's four corners, as coefficients: a point
  // is ax + bx*u + cx*v + dx*u*v, and the same again for y.
  const A = (rot & 3) * 2, B = ((rot + 1) & 3) * 2, C = ((rot + 2) & 3) * 2, D = ((rot + 3) & 3) * 2;
  const ax = pts[A], bx = pts[B] - ax, cx = pts[D] - ax, dx = ax - pts[B] - pts[D] + pts[C];
  const ay = pts[A + 1], by = pts[B + 1] - ay, cy = pts[D + 1] - ay, dy = ay - pts[B + 1] - pts[D + 1] + pts[C + 1];

  /*
   * How many corners a lobe is worth, off how big it comes out on the screen.
   * A tile is ninety-six pixels at zoom one, so a lobe of a seventh of one is
   * about thirteen, and at the zoom somebody looks at the country from it is
   * seven -- at which a heptagon and a circle are the same picture.
   */
  const px = LOBE * 96 * zoom;
  const sides = px < 5 ? 6 : px < 11 ? 8 : 12;
  /*
   * Whether it is worth an outline at all. The outline is the widest of the
   * three passes and so the dearest, and what it buys is a lump reading as a
   * lump -- which wants a few pixels of line round a shape you can see the
   * shape of. Under about nine pixels across there is no shape to outline and
   * the line is most of the lobe.
   */
  const lined = px >= 9;

  /** Every lobe in one path, grown by `grow` and slid by `du, dv`. */
  const lay = (grow: number, du: number, dv: number): Path2D => {
    const path = new Path2D();
    for (let i = 0; i < lobes.length; i += 3) {
      const cu = lobes[i] + du, cv = lobes[i + 1] + dv, rr = lobes[i + 2] + grow;
      if (rr <= 0) continue;
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const u = cu + Math.cos(a) * rr, v = cv + Math.sin(a) * rr;
        const sx = ax + bx * u + cx * v + dx * u * v;
        const sy = ay + by * u + cy * v + dy * u * v;
        if (k === 0) path.moveTo(sx, sy);
        else path.lineTo(sx, sy);
      }
      path.closePath();
    }
    return path;
  };

  /*
   * The line round it and the metal. Every lobe goes into one path and the
   * path is filled once, because they overlap heavily and an overlap filled
   * twice is darker than the rest, which would show every lobe.
   */
  if (lined) {
    g.fillStyle = tone(colour, 0.62);
    g.fill(lay(LOBE * 0.18, 0, 0));
  }
  const body = lay(0, 0, 0);
  g.fillStyle = tone(colour, lined ? 1 : 0.88);
  g.fill(body);
  /*
   * And the light along the top of the band -- the whole band slid together,
   * not each lobe slid on its own. Lit a lobe at a time, every one of them got
   * its own crescent of shadow where the one before it ended, and a vein came
   * out as a string of beads: it is one ribbon of rock and it catches the
   * light like one thing.
   *
   * Below a few pixels a lobe has no room for a top and a side, and the two
   * extra paths it costs are the two most expensive things here.
   */
  if (px < 4) return;
  g.save();
  g.clip(body);
  g.fillStyle = tone(colour, 1.28);
  g.fill(lay(-LOBE * 0.13, -LOBE * 0.2, -LOBE * 0.34));
  g.restore();
}
