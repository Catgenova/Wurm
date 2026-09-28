/**
 * A tiered fountain's water: three stone basins one over another on a
 * column, the water welling up out of a spout over the top one and spilling
 * round the whole rim of each bowl into the next as a thin ring of falling
 * water, foaming and ringing where it lands; the lowest basin rippling.
 *
 * Every falling ring is the waterfall painter's own sheet (`./falls`), hung
 * from a round lip instead of a straight one (`Sheet.ring`), so the water of a
 * fountain and of a fall are the same water; the basins are coloured from the
 * one set of spring water colours (`./water`), and at night the dark comes
 * over them as it comes over every other water.
 *
 * The stone is the piece's baked model (`MODELS.fountain` in `./furniture`),
 * in three layers: the lowest basin; the column up through it and the middle
 * bowl; and the column over that and the top bowl with its spout. The water
 * goes in between them -- each ring's far half before the bowl it hangs from,
 * its near half after -- so the stone stands in front of the water behind it
 * and behind the water in front of it, from every turn of the view.
 */
import { DETAIL_FROM, drawFoot, drawLip, drawSheet, place, type FallView, type Placed, type Sheet } from './falls';
import { HALF_H, HALF_W, UNITS_PER_TILE } from './iso';
import { SPRING_DEEP, SPRING_EDGE, SPRING_FOAM, SPRING_PALE, SPRING_WATER } from './water';

/**
 * The fountain as it is built, in its own units (a tenth of a metre) from its
 * middle and the ground under it: each basin's radius and the height of its
 * rim, and for the lowest one the radius inside its rim and where its water
 * stands; how deep the bowls go under their rims; the spout's top. The water
 * in the upper two stands at their rims, going over.
 */
export const FOUNT = {
  low: { r: 13, lip: 13.5, rim: 4.4, inner: 11.8, water: 3.6 },
  mid: { r: 7.4, rim: 11.2, under: 8.8 },
  top: { r: 3.9, rim: 16.2, under: 14.4 },
  spout: 19.2,
} as const;
/** How wide the stone of a bowl's rim is, in units, that its water runs over going out to the edge. */
export const FOUNT_RIM = 0.9;

/** How far out from each rim its ring of water lands, in units, and how much it curls out on the way down. */
const REACH = { mid: 2.2, top: 1.5 };
const CURL = 0.4;
/** How far back from a rim the water drawn into it begins, in tiles: a hand's width. */
const BACK = 0.045;
/** How much water goes over a rim, against a stream going over a lip; and how much of the stone behind shows through the thin ring of it. */
const FLOW = 0.3;
const SHEER = 0.5;
/** How far a circle a tile in radius on the ground reaches on screen at zoom one, to either side and up and down. */
const DISC_W = HALF_W * Math.SQRT2;
const DISC_H = HALF_H * Math.SQRT2;

/** A fountain's water this frame. */
export interface FountainFrame {
  /** The ground's projection, as the falls are drawn with it, moved to wherever the piece is being drawn. */
  v: FallView;
  /** Its middle in the world, in tiles, and the height it stands at. */
  x: number;
  y: number;
  base: number;
  /** A number of its own, so the ropes and streaks of its water are its own. */
  key: number;
  /** Whether it has water to give: running while it holds a litre or more, standing dry below. */
  flowing: boolean;
  /** How dark it has got, nought to one. */
  dark: number;
  foamTex: CanvasImageSource | null;
}

const u2t = (units: number): number => units / UNITS_PER_TILE;

/** The ring of water going over a bowl's rim, as the falls painter takes one. */
function ringOf(f: FountainFrame, r: number, rim: number, lands: number, reach: number, salt: number): Sheet {
  const rt = u2t(r);
  return {
    axis: 0, line: f.key * 7 + salt, from: 0, to: Math.PI * 2 * rt, half: 0, way: 1,
    reach: u2t(reach), curl: CURL, top: f.base + rim, landFrom: 0, land: Float64Array.of(f.base + lands), wet: true, grow: 1,
    ring: { x: f.x, y: f.y, r: rt }, back: BACK, flow: FLOW,
  };
}

/**
 * The stretches of a ring's lip, in tiles round it, on the near side of it
 * from where it is seen (`near`) or the far: the half whose water falls
 * toward you, in `pieces` pieces, split where it goes round past nought.
 */
function halves(v: FallView, p: Placed, near: boolean, pieces: number): Array<[number, number]> {
  const r = p.ring?.r ?? 0;
  const whole = Math.PI * 2 * r;
  // The way out of the ring that goes most straight down the screen is the middle of its near side.
  const mid = Math.atan2(v.yy, v.yx);
  let a = (mid - Math.PI / 2 + (near ? 0 : Math.PI)) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  const u0 = a * r;
  const u1 = u0 + Math.PI * r;
  const out: Array<[number, number]> = [];
  const step = whole / 2 / pieces;
  for (let u = u0; u < u1 - 1e-9; u += step) {
    const b = Math.min(u1, u + step);
    if (b <= whole) out.push([u, b]);
    else if (u >= whole) out.push([u - whole, b - whole]);
    else out.push([u, whole], [0, b - whole]);
  }
  return out;
}

/** The screen place of a point of the fountain: `r` units out along `a` from its middle, at `h` units over its ground. */
function spot(f: FountainFrame, a: number, r: number, h: number): [number, number] {
  const v = f.v;
  const x = f.x + Math.cos(a) * u2t(r);
  const y = f.y + Math.sin(a) * u2t(r);
  return [v.ox + v.xx * x + v.xy * y, v.oy + v.yx * x + v.yy * y - (f.base + h) * v.hs];
}

/**
 * A basin's water: a round of it `r` units across at `h`, seen through the
 * opening of its rim `clipR` across at `clipH` where the rim stands over it,
 * deeper at the back than the front; the darker line where it meets the
 * stone; and, from close enough, the light moving on it -- rings going out
 * from the middle when `rings`, and glints.
 */
function basin(ctx: CanvasRenderingContext2D, f: FountainFrame, r: number, h: number, clipR: number, clipH: number, rings: number, t: number): void {
  const v = f.v;
  const z = v.zoom;
  const [cx, cy] = spot(f, 0, 0, h);
  const rx = u2t(r) * DISC_W * z;
  const ry = u2t(r) * DISC_H * z;
  ctx.save();
  if (clipR > 0) {
    const [ox, oy] = spot(f, 0, 0, clipH);
    ctx.beginPath();
    ctx.ellipse(ox, oy, u2t(clipR) * DISC_W * z, u2t(clipR) * DISC_H * z, 0, 0, Math.PI * 2);
    ctx.clip();
  }
  const g = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
  g.addColorStop(0, WATER_BACK);
  g.addColorStop(0.55, WATER_MID);
  g.addColorStop(1, WATER_FRONT);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = Math.max(0.8, 1.1 * z);
  ctx.stroke();
  if (z >= DETAIL_FROM) {
    // Rings going out over it from the middle, where the water comes down the column or the spout.
    ctx.lineWidth = Math.max(0.7, 0.9 * z);
    for (let k = 0; k < rings; k++) {
      const age = ((t / 2.4 + k / rings + f.key * 0.37) % 1 + 1) % 1;
      const rr = 0.22 + 0.72 * age;
      ctx.strokeStyle = `rgba(${SPRING_FOAM[0]},${SPRING_FOAM[1]},${SPRING_FOAM[2]},${(0.42 * (1 - age) * Math.min(1, age * 5)).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * rr, ry * rr, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Glints: short bright strokes that come and go.
    ctx.strokeStyle = GLINT;
    ctx.lineWidth = Math.max(0.8, 1 * z);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const s = Math.sin(t * (1.3 + 0.37 * k) + k * 2.1 + f.key);
      if (s < 0.35) continue;
      const a = k * 2.39996 + f.key * 0.7;
      const d = 0.3 + 0.55 * ((k * 0.618) % 1);
      const gx = cx + Math.cos(a) * rx * d;
      const gy = cy + Math.sin(a) * ry * d;
      const len = (1.5 + 2.5 * (s - 0.35)) * z;
      ctx.moveTo(gx - len, gy);
      ctx.lineTo(gx + len, gy);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  ctx.restore();
}

/**
 * The water coming up out of the spout: a dome of it over the top, bubbles
 * breaking on it, and a sheath of it running down the spout's sides into the
 * top bowl.
 */
function welling(ctx: CanvasRenderingContext2D, f: FountainFrame, t: number): void {
  const v = f.v;
  const z = v.zoom;
  const [tx, ty] = spot(f, 0, 0, FOUNT.spout + 0.5);
  const [bx, by] = spot(f, 0, 0, FOUNT.top.rim);
  const w = u2t(1.05) * DISC_W * z;
  // The sheath down the spout.
  ctx.fillStyle = SHEATH;
  ctx.beginPath();
  ctx.moveTo(tx - w * 0.9, ty);
  ctx.lineTo(bx - w * 1.15, by);
  ctx.ellipse(bx, by, w * 1.15, w * 0.5, 0, Math.PI, 0, true);
  ctx.lineTo(tx + w * 0.9, ty);
  ctx.closePath();
  ctx.fill();
  if (z >= DETAIL_FROM) {
    ctx.strokeStyle = STREAK;
    ctx.lineWidth = Math.max(0.7, 0.8 * z);
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const age = ((t * 1.6 + k / 3) % 1 + 1) % 1;
      const s = (k - 1) * 0.55;
      const y0 = ty + (by - ty) * age;
      const y1 = Math.min(by, y0 + (by - ty) * 0.3);
      ctx.moveTo(tx + w * s * 0.9, y0);
      ctx.lineTo(tx + w * s, y1);
    }
    ctx.stroke();
  }
  // The dome, swelling and settling.
  const swell = 1 + 0.08 * Math.sin(t * 5.3);
  ctx.fillStyle = DOME;
  ctx.beginPath();
  ctx.ellipse(tx, ty - w * 0.1, w * 1.05 * swell, w * 0.62 * swell, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = GLINT;
  ctx.beginPath();
  ctx.ellipse(tx - w * 0.3, ty - w * 0.3, w * 0.32, w * 0.16, -0.3, 0, Math.PI * 2);
  ctx.fill();
  if (z < DETAIL_FROM) return;
  // Bubbles coming up through it and breaking.
  ctx.strokeStyle = STREAK;
  ctx.lineWidth = Math.max(0.6, 0.7 * z);
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    const age = (t / (0.9 + 0.2 * k) + k / 4) % 1;
    const a = k * 2.4 + Math.floor(t / 0.9 + k / 4) * 1.7;
    const bx2 = tx + Math.cos(a) * w * 0.6 * age;
    const by2 = ty - w * 0.1 + Math.sin(a) * w * 0.35 * age;
    const br = (0.5 + 1.1 * age) * z * (age < 0.85 ? 1 : 0);
    if (br <= 0) continue;
    ctx.moveTo(bx2 + br, by2);
    ctx.arc(bx2, by2, br, 0, Math.PI * 2);
  }
  ctx.stroke();
}

/**
 * The whole fountain, its stone and its water in the order they stand:
 * `bake(i)` draws layer `i` of its model where it is being drawn. Standing
 * dry it is its stone and nothing more.
 */
export function drawFountain(ctx: CanvasRenderingContext2D, f: FountainFrame, bake: (layer: number) => void): void {
  bake(0);
  if (!f.flowing) {
    bake(1);
    bake(2);
    return;
  }
  const v = f.v;
  const t = v.t;
  const detail = v.zoom >= DETAIL_FROM;
  const lower = place(v, ringOf(f, FOUNT.mid.r, FOUNT.mid.rim, FOUNT.low.water, REACH.mid, 1));
  const upper = place(v, ringOf(f, FOUNT.top.r, FOUNT.top.rim, FOUNT.mid.rim, REACH.top, 2));
  const tex = detail ? f.foamTex : null;
  /*
   * Each half of a ring: the sheet sheer enough that the stone shows through
   * it, a quarter of the ring at a time so each piece is shaded square to its own
   * stretch of the rim; and its foot, kept inside the basin it lands in.
   */
  const fall = (p: Placed, near: boolean, into: number, at: number): void => {
    ctx.globalAlpha = SHEER;
    for (const [a, b] of halves(v, p, near, 2)) drawSheet(ctx, v, p, a, b);
    ctx.globalAlpha = 1;
    ctx.save();
    const [cx, cy] = spot(f, 0, 0, at);
    ctx.beginPath();
    ctx.ellipse(cx, cy, u2t(into) * DISC_W * v.zoom, u2t(into) * DISC_H * v.zoom, 0, 0, Math.PI * 2);
    ctx.clip();
    for (const [a, b] of halves(v, p, near, 1)) drawFoot(ctx, v, p, a, b, tex);
    ctx.restore();
  };
  // The lowest basin's water, seen through its rim, rings going out from the column; and the far half of the ring coming down into it.
  basin(ctx, f, FOUNT.low.inner, FOUNT.low.water, FOUNT.low.inner, FOUNT.low.rim, 3, t);
  fall(lower, false, FOUNT.low.inner, FOUNT.low.rim);
  bake(1);
  // The middle bowl full to its rim and going over all the way round; the far half of the ring from the top bowl landing in it; the near half of its own falling in front.
  basin(ctx, f, FOUNT.mid.r - FOUNT_RIM, FOUNT.mid.rim, 0, 0, 2, t);
  drawLip(ctx, v, lower, 0, lower.sheet.to);
  fall(upper, false, FOUNT.mid.r, FOUNT.mid.rim + 2);
  fall(lower, true, FOUNT.low.inner, FOUNT.low.rim);
  bake(2);
  basin(ctx, f, FOUNT.top.r - FOUNT_RIM, FOUNT.top.rim, 0, 0, 0, t);
  drawLip(ctx, v, upper, 0, upper.sheet.to);
  fall(upper, true, FOUNT.mid.r, FOUNT.mid.rim + 2);
  welling(ctx, f, t);
}

const rgb = (c: readonly number[]): string => `rgb(${c[0]},${c[1]},${c[2]})`;
const mix = (a: readonly number[], b: readonly number[], k: number): number[] => a.map((x, i) => Math.round(x + (b[i] - x) * k));
/** A basin's water, deeper at the back where the stone shades it, and the line where it meets the stone. */
const WATER_BACK = rgb(mix(SPRING_DEEP, SPRING_EDGE, 0.25));
const WATER_MID = rgb(SPRING_WATER);
const WATER_FRONT = rgb(mix(SPRING_WATER, SPRING_PALE, 0.3));
const EDGE = `rgba(${SPRING_EDGE[0]},${SPRING_EDGE[1]},${SPRING_EDGE[2]},0.55)`;
const GLINT = `rgba(${SPRING_FOAM[0]},${SPRING_FOAM[1]},${SPRING_FOAM[2]},0.85)`;
/** The water welling over the spout, and running down it. */
const DOME = `rgba(${SPRING_PALE[0]},${SPRING_PALE[1]},${SPRING_PALE[2]},0.92)`;
const SHEATH = `rgba(${SPRING_PALE[0]},${SPRING_PALE[1]},${SPRING_PALE[2]},0.5)`;
const STREAK = `rgba(${SPRING_FOAM[0]},${SPRING_FOAM[1]},${SPRING_FOAM[2]},0.8)`;
