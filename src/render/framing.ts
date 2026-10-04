/**
 * Jetties, railings and columns, drawn.
 *
 * A **railing** is a run, not a row of pieces: its rail and its plinth go on
 * from section to section with nothing between them, its balusters are set at
 * one spacing the whole length of it, and a post stands once at each end of a
 * section -- at a corner, where the railing stops, and every tile along it --
 * except where it runs into a wall or a column, which is the post there. In
 * timber it is a handrail and a bottom rail with square spindles between them
 * on posts; round a log house, poles; in stone a balustrade: a plinth, turned
 * balusters and a coping, on pedestals.
 *
 * A **column** stands on its corner a storey tall: a squared post on a stone
 * pad with a bolster on its head in timber, sawn or hewn from the log, and in
 * stone a pillar -- a round shaft on a moulded base with a capital for cut
 * stone and the metals, a square pier with a base course and a cap for
 * rubble, brick and adobe. Where two walls of its storey meet on its corner it
 * is a **pilaster**, square and standing proud of the walls' faces, of which
 * only what stands clear of the walls is drawn. Between two columns carrying a
 * side with no wall on it lies a **beam**, just under the floor or the eaves
 * over it, so what is over the columns is seen resting on them.
 *
 * A **jetty** overhangs on what carries it: in timber the ends of its joists
 * under the front of the deck and a joist with a knee brace down to the wall
 * under each open side; in stone a moulded course with a row of corbels under
 * the front and a stepped corbel out of the wall under each side. Only the
 * sides turned to the camera are drawn, as a floor's own edge is.
 *
 * Everything is in the palettes the stairs are built in (`stairing.ts`), lit
 * the way a wall is lit (`litOf`), outlined in the material's own ink, and
 * drawn as plain shapes and colours when zoomed out.
 */
import type { Camera } from '../engine/camera';
import { borderPoints, FLOOR_DEEP, MATERIAL_BY_ID, RAILING_HEIGHT, WALL_HEIGHT, WALL_THICK, type Border, type Side } from '../game/building';
import { HALF_H, HALF_W } from './iso';
import { stairStyle } from './stairing';

type RGB = readonly [number, number, number];

const rgb = (c: RGB, k: number, a = 1): string =>
  `rgba(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0},${a})`;

/** Below this zoom a railing, a column or a bracket is its shapes and colours and nothing more. */
export const FRAME_DETAIL = 0.6;
/** How deep a beam between two columns is, in terrain units. */
export const BEAM_DEEP = 3;
/** How high a railing stands, in terrain units. */
const RAIL_H = WALL_HEIGHT * RAILING_HEIGHT;

/** How a face turned the way a run `ux, uy` runs is lit: the light walls are drawn in. */
export function litOf(cam: Camera, ux: number, uy: number): number {
  const vx = cam.rotateX(ux, uy);
  const along = Math.abs(vx);
  const into = Math.abs(cam.rotateY(ux, uy));
  const face = along / (along + into || 1);
  return 0.72 * (1 - face) + (vx > 0 ? 1 : 0.8) * face;
}

/** Whether a face whose outward normal is `nx, ny` is turned to the camera. */
const faces = (cam: Camera, nx: number, ny: number): boolean => cam.rotateX(nx, ny) + cam.rotateY(nx, ny) > 1e-6;

/** Whether a material is laid with a trowel rather than a mallet. */
const stony = (material: string): boolean => MATERIAL_BY_ID.get(material)?.kind === 'stone';

/** The colours a piece of a material is drawn in: its body, its light, its dressing, its dark and its ink. */
interface Palette { body: RGB; hi: RGB; dress: RGB; dressHi: RGB; dark: RGB; line: RGB; gilt?: RGB; giltHi?: RGB }

function palette(material: string, paint?: RGB): Palette {
  const st = stairStyle(material);
  const m = MATERIAL_BY_ID.get(material);
  let p: Palette;
  if (!stony(material)) {
    // Timber in the colour its walls are, which is what a post of it is cut from.
    const c = m?.color ?? st.string;
    const t = m?.trim ?? st.line;
    p = { body: c, hi: st.stringHi, dress: c, dressHi: st.barHi, dark: t, line: st.line };
  } else {
    p = { body: st.string, hi: st.stringHi, dress: st.tread, dressHi: st.nose, dark: st.joint, line: st.line };
    if (st.rail === 'gilt') { p.gilt = st.bar; p.giltHi = st.barHi; }
    // Brick is coped and capped in a pale stone: its stair's blue treads were a lilac coping on a balustrade.
    if (material === 'clay_bricks') { p.dress = [214, 200, 176]; p.dressHi = [230, 220, 200]; }
  }
  if (paint) {
    p.body = paint;
    p.dress = paint;
    p.hi = [Math.min(255, paint[0] * 1.15), Math.min(255, paint[1] * 1.15), Math.min(255, paint[2] * 1.15)];
    p.dressHi = p.hi;
    p.gilt = undefined;
  }
  return p;
}

/** A point projected: world `x`, `y` at height `h`. */
type Proj = (x: number, y: number, h: number) => [number, number];
const projector = (cam: Camera): Proj => (x, y, h) => [cam.worldToScreenX(x, y), cam.worldToScreenY(x, y, h)];

/* -------------------------------------------------------------------------- */
/* Boxes laid along a border                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A frame along a border: `t` along it from its first corner, `s` across it
 * toward the camera, both in tiles, and height in terrain units. What every
 * box of a railing, a beam or a bracket is laid in.
 */
interface Run {
  ctx: CanvasRenderingContext2D;
  at: (t: number, s: number, h: number) => [number, number];
  /** The near face's light, its top's, and an end's. */
  lit: number;
  top: number;
  end: number;
  /** Which end turns to the camera: +1 the far end (`t` = 1), -1 the near one. */
  endward: number;
  zoom: number;
}

function runOf(ctx: CanvasRenderingContext2D, cam: Camera, ax: number, ay: number, dx: number, dy: number, zoom: number): Run {
  // Across the run, toward the camera: the face we see.
  let nx = -dy, ny = dx;
  if (!faces(cam, nx, ny)) { nx = -nx; ny = -ny; }
  const P = projector(cam);
  const lit = litOf(cam, dx, dy);
  const toCam = cam.rotateX(dx, dy) + cam.rotateY(dx, dy);
  return {
    ctx,
    at: (t, s, h) => P(ax + dx * t + nx * s, ay + dy * t + ny * s, h),
    lit,
    top: Math.min(1.3, lit * 1.24),
    end: litOf(cam, dy, dx),
    endward: toCam > 1e-6 ? 1 : toCam < -1e-6 ? -1 : 0,
    zoom,
  };
}

const quad = (ctx: CanvasRenderingContext2D, pts: Array<[number, number]>): void => {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
};

/** A box along a run: its near face, the end of it turned to the camera, and its top, filled each and outlined at once. */
function box(r: Run, t0: number, t1: number, h0: number, h1: number, s0: number, s1: number, body: RGB, line: RGB, topC: RGB = body, ends = true): void {
  const { ctx, at } = r;
  const near: Array<[number, number]> = [at(t0, s1, h0), at(t1, s1, h0), at(t1, s1, h1), at(t0, s1, h1)];
  const lid: Array<[number, number]> = [near[3], near[2], at(t1, s0, h1), at(t0, s0, h1)];
  const t = r.endward > 0 ? t1 : t0;
  const end: Array<[number, number]> | null = ends && r.endward ? [at(t, s1, h0), at(t, s0, h0), at(t, s0, h1), at(t, s1, h1)] : null;
  quad(ctx, near);
  ctx.fillStyle = rgb(body, r.lit);
  ctx.fill();
  if (end) {
    quad(ctx, end);
    ctx.fillStyle = rgb(body, r.end);
    ctx.fill();
  }
  quad(ctx, lid);
  ctx.fillStyle = rgb(topC, r.top);
  ctx.fill();
  if (r.zoom < FRAME_DETAIL) return;
  ctx.beginPath();
  for (const q of end ? [near, lid, end] : [near, lid]) {
    ctx.moveTo(q[0][0], q[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(q[i][0], q[i][1]);
    ctx.closePath();
  }
  ctx.lineWidth = Math.max(0.6, 0.8 * r.zoom);
  ctx.strokeStyle = rgb(line, 1, 0.5);
  ctx.stroke();
}

/* -------------------------------------------------------------------------- */
/* Railings                                                                    */
/* -------------------------------------------------------------------------- */

/** What stands at each end of a railing's section, which decides what is drawn there. */
export interface RailEnds {
  /** A post or a pedestal, drawn by this section. */
  post: [boolean, boolean];
  /** How far in from each end the rails stop: a wall's or a column's thickness, where one is the post. */
  cut: [number, number];
}

/**
 * The body of a section of railing between `c0` and `c1` along it: its rails,
 * its balusters or spindles and its plinth, without its posts.
 */
function railBody(r: Run, material: string, pal: Palette, c0: number, c1: number): void {
  const { ctx } = r;
  // The balusters stand at one spacing the whole run: the section's own, cut back where a wall or a column is the post.
  const stone = stony(material);
  const log = material === 'log';
  const n = stone ? (material === 'clay_adobe' ? 5 : 7) : log ? 4 : 8;
  const ts: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    if (t > c0 + 0.03 && t < c1 - 0.03) ts.push(t);
  }
  // Far end first, so a baluster seen past another is laid under it.
  if (r.endward < 0) ts.reverse();
  if (stone) {
    const plinth = 1.5, coping = 1.7;
    box(r, c0, c1, 0, plinth, -0.042, 0.042, pal.body, pal.line, pal.dress);
    balusters(r, ts, plinth, RAIL_H - coping, material, pal);
    // The coping stands proud of the balusters.
    box(r, c0, c1, RAIL_H - coping, RAIL_H, -0.048, 0.048, pal.dress, pal.line, pal.dressHi);
  } else if (log) {
    // Poles: a top rail and a middle one, peeled, on pole balusters.
    for (const t of ts) pole(r, t, 0.9, RAIL_H - 1.2, 0.014, pal);
    rail(r, c0, c1, RAIL_H * 0.5, 0.017, pal);
    rail(r, c0, c1, RAIL_H - 0.8, 0.021, pal);
  } else {
    // Sawn: a bottom rail, square spindles and a handrail with a top to it.
    box(r, c0, c1, 1.1, 2.1, -0.016, 0.016, pal.body, pal.line);
    // The spindles, all of them one path: their faces to the camera, filled and outlined at once.
    const spindles = new Path2D();
    for (const t of ts) {
      const a = r.at(t - 0.009, 0.009, 2.1), b = r.at(t + 0.009, 0.009, 2.1), c = r.at(t + 0.009, 0.009, RAIL_H - 1.3), d = r.at(t - 0.009, 0.009, RAIL_H - 1.3);
      spindles.moveTo(a[0], a[1]); spindles.lineTo(b[0], b[1]); spindles.lineTo(c[0], c[1]); spindles.lineTo(d[0], d[1]); spindles.closePath();
    }
    ctx.fillStyle = rgb(pal.body, r.lit);
    ctx.fill(spindles);
    ctx.lineWidth = Math.max(0.5, 0.6 * r.zoom);
    ctx.strokeStyle = rgb(pal.line, 1, 0.5);
    ctx.stroke(spindles);
    box(r, c0, c1, RAIL_H - 1.3, RAIL_H, -0.024, 0.024, pal.body, pal.line, pal.hi);
  }
}

/** The posts at the ends of a section that has them: a pedestal, a pole or a capped post. */
function railPosts(r: Run, material: string, pal: Palette, post: [boolean, boolean]): void {
  for (const i of [0, 1] as const) {
    if (!post[i]) continue;
    const t = i ? 1 : 0;
    if (stony(material)) pedestal(r, t, pal);
    else if (material === 'log') pole(r, t, 0, RAIL_H + 1.2, 0.03, pal, true);
    else {
      box(r, t - 0.03, t + 0.03, 0, RAIL_H + 1.3, -0.03, 0.03, pal.body, pal.line, pal.hi);
      // A cap on the post, a hair wider than it.
      box(r, t - 0.036, t + 0.036, RAIL_H + 1.3, RAIL_H + 1.9, -0.036, 0.036, pal.dark, pal.line, pal.hi);
    }
  }
}

/**
 * Every whole section of a railing of one material, running one way, seen at
 * one turn and one zoom, is the same picture in a different place: the
 * projection is linear. So it is painted once and laid down after that, the
 * oldest let go past `BODIES` of them, as the roofs' patterns are.
 */
interface Body { c: HTMLCanvasElement; x: number; y: number; w: number; h: number; key?: string }
const bodies = new Map<string, Body>();
const BODIES = 64;

function bodyOf(cam: Camera, dir: 'h' | 'v', material: string, pal: Palette, paint: RGB | undefined, dpr: number): Body {
  const key = `${material}|${paint ? paint.join(',') : ''}|${dir}|${cam.rotation}|${cam.zoom}|${dpr}`;
  const had = bodies.get(key);
  if (had) {
    bodies.delete(key);
    bodies.set(key, had);
    return had;
  }
  const [dx, dy] = dir === 'h' ? [1, 0] : [0, 1];
  const X0 = cam.worldToScreenX(0, 0), Y0 = cam.worldToScreenY(0, 0, 0);
  // The section at the origin, measured: where the picture of it falls round its first corner.
  const probe = runOf(null as unknown as CanvasRenderingContext2D, cam, 0, 0, dx, dy, cam.zoom);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of [-0.1, 1.1]) for (const sv of [-0.1, 0.1]) for (const h of [-1, RAIL_H + 2]) {
    const [px, py] = probe.at(t, sv, h);
    x0 = Math.min(x0, px - X0); x1 = Math.max(x1, px - X0);
    y0 = Math.min(y0, py - Y0); y1 = Math.max(y1, py - Y0);
  }
  x0 = Math.floor(x0) - 2; y0 = Math.floor(y0) - 2;
  const w = Math.ceil(x1) + 2 - x0, h = Math.ceil(y1) + 2 - y0;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * dpr));
  c.height = Math.max(1, Math.ceil(h * dpr));
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.lineJoin = 'round';
  const r = runOf(g, cam, 0, 0, dx, dy, cam.zoom);
  const at0 = r.at;
  r.at = (t, sv, hh) => { const [px, py] = at0(t, sv, hh); return [px - X0 - x0, py - Y0 - y0]; };
  railBody(r, material, pal, 0, 1);
  const body: Body = { c, x: x0, y: y0, w, h };
  bodies.set(key, body);
  while (bodies.size > BODIES) {
    const first = bodies.keys().next().value;
    if (first === undefined) break;
    bodies.delete(first);
  }
  return body;
}

/** A position on whole device pixels, so a picture laid there is laid, not resampled. */
const snap = (v: number, dpr: number): number => Math.round(v * dpr) / dpr;

/** A railing's post, painted once for its stuff at a turn and a zoom: square, so the same whichever way the run goes. */
const posts = new Map<string, Body>();
function postOf(cam: Camera, material: string, pal: Palette, paint: RGB | undefined, dpr: number): Body {
  const key = `${material}|${paint ? paint.join(',') : ''}|${cam.rotation}|${cam.zoom}|${dpr}`;
  const had = posts.get(key);
  if (had) return had;
  const X0 = cam.worldToScreenX(0, 0), Y0 = cam.worldToScreenY(0, 0, 0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const u of [-0.09, 0.09]) for (const v of [-0.09, 0.09]) for (const h of [-1, RAIL_H + 3]) {
    const px = cam.worldToScreenX(u, v) - X0, py = cam.worldToScreenY(u, v, h) - Y0;
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  x0 = Math.floor(x0) - 2; y0 = Math.floor(y0) - 2;
  const w = Math.ceil(x1) + 2 - x0, h = Math.ceil(y1) + 2 - y0;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * dpr));
  c.height = Math.max(1, Math.ceil(h * dpr));
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.lineJoin = 'round';
  const r = runOf(g, cam, 0, 0, 1, 0, cam.zoom);
  const at0 = r.at;
  r.at = (t, sv, hh) => { const [px, py] = at0(t, sv, hh); return [px - X0 - x0, py - Y0 - y0]; };
  railPosts(r, material, pal, [true, false]);
  const pic: Body = { c, x: x0, y: y0, w, h };
  posts.set(key, pic);
  while (posts.size > PICTURES) {
    const first = posts.keys().next().value;
    if (first === undefined) break;
    posts.delete(first);
  }
  return pic;
}

/**
 * One section of railing on a border, standing at `h0`, in `material`, faded
 * to `alpha`. `ends` says what stands at its two ends. A whole section is laid
 * from a picture painted once (`bodyOf`); one cut short at a wall or a column,
 * or one still going up and railed only as far as it has got, is drawn as it
 * stands.
 */
export function drawRailing(ctx: CanvasRenderingContext2D, cam: Camera, border: Border, h0: number, material: string,
  ends: RailEnds, alpha: number, paint?: RGB, dpr = 1): void {
  const zoom = cam.zoom;
  const [ax, ay, bx, by] = borderPoints(border);
  const r = runOf(ctx, cam, ax, ay, bx - ax, by - ay, zoom);
  const at0 = r.at;
  r.at = (t, s, h) => at0(t, s, h0 + h);
  const pal = palette(material, paint);
  const [c0, c1] = [ends.cut[0], 1 - ends.cut[1]];
  // A section going up has its posts before it has a rail between them.
  const railed = c1 - c0 > 0.01;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  if (zoom < FRAME_DETAIL) {
    // From far off: a rail on a line of its posts; and going up, the posts.
    if (railed) {
      box(r, c0, c1, RAIL_H - 1.6, RAIL_H, -0.03, 0.03, pal.dress, pal.line);
      box(r, c0, c1, 0, 1.4, -0.03, 0.03, pal.body, pal.line);
      ctx.globalAlpha = alpha * 0.35;
      quad(ctx, [r.at(c0, 0, 1.4), r.at(c1, 0, 1.4), r.at(c1, 0, RAIL_H - 1.6), r.at(c0, 0, RAIL_H - 1.6)]);
      ctx.fillStyle = rgb(pal.body, r.lit);
      ctx.fill();
      ctx.globalAlpha = alpha;
    } else for (const i of [0, 1] as const) if (ends.post[i]) box(r, i - 0.03, i + 0.03, 0, RAIL_H + 1.3, -0.03, 0.03, pal.body, pal.line);
    ctx.restore();
    return;
  }
  if (railed && (c0 > 0 || c1 < 1)) railBody(r, material, pal, c0, c1);
  else if (railed) {
    const body = bodyOf(cam, border.dir, material, pal, paint, dpr);
    const [ox, oy] = r.at(0, 0, 0);
    ctx.drawImage(body.c, snap(ox + body.x, dpr), snap(oy + body.y, dpr), body.w, body.h);
  }
  // The posts, each the same picture of a post wherever it stands.
  for (const i of [0, 1] as const) {
    if (!ends.post[i]) continue;
    const pic = postOf(cam, material, pal, paint, dpr);
    const [px, py] = r.at(i, 0, 0);
    ctx.drawImage(pic.c, snap(px + pic.x, dpr), snap(py + pic.y, dpr), pic.w, pic.h);
  }
  ctx.restore();
}

/**
 * A section's turned balusters, standing at `ts` from `h0` to `h1`: vases,
 * round, lit down one side. All of them are one path, one fill, one light and
 * one outline, however many there are: a balustrade is a lot of balusters.
 */
function balusters(r: Run, ts: number[], h0: number, h1: number, material: string, pal: Palette): void {
  const { ctx } = r;
  if (!ts.length) return;
  // A tile's width across on the screen, for a round thing's radius.
  const perTile = Math.SQRT2 * HALF_W * r.zoom;
  const fat = material === 'clay_adobe' ? 1.35 : 1;
  // The profile, bottom to top: a square foot, a neck, the belly, a neck, a collar and a square head.
  const prof: Array<[number, number]> = [
    [0, 0.024], [0.1, 0.024], [0.12, 0.013], [0.2, 0.017], [0.38, 0.026], [0.55, 0.021], [0.72, 0.011],
    [0.8, 0.012], [0.84, 0.019], [0.88, 0.015], [0.9, 0.022], [1, 0.022],
  ];
  const col = pal.gilt ?? pal.dress;
  const colHi = pal.giltHi ?? pal.dressHi;
  const outline = new Path2D();
  const light = new Path2D();
  for (const t of ts) {
    const [x0, y0] = r.at(t, 0, h0);
    const H = y0 - r.at(t, 0, h1)[1];
    outline.moveTo(x0 - prof[0][1] * fat * perTile, y0);
    for (const [k, w] of prof) outline.lineTo(x0 - w * fat * perTile, y0 - k * H);
    for (let i = prof.length - 1; i >= 0; i--) outline.lineTo(x0 + prof[i][1] * fat * perTile, y0 - prof[i][0] * H);
    outline.closePath();
    // The light runs down the side a third of the way in from the left.
    light.moveTo(x0 - 0.5 * prof[0][1] * fat * perTile, y0);
    for (const [k, w] of prof) light.lineTo(x0 - 0.55 * w * fat * perTile, y0 - k * H);
    for (let i = prof.length - 1; i >= 0; i--) light.lineTo(x0 - 0.05 * prof[i][1] * fat * perTile, y0 - prof[i][0] * H);
    light.closePath();
  }
  ctx.fillStyle = rgb(col, 0.8);
  ctx.fill(outline);
  ctx.fillStyle = rgb(colHi, 1.02);
  ctx.fill(light);
  ctx.lineWidth = Math.max(0.5, 0.6 * r.zoom);
  ctx.strokeStyle = rgb(pal.line, 1, 0.5);
  ctx.stroke(outline);
}

/** A pedestal at one end of a balustrade: a square pier with a cap, a hair taller than the coping. */
function pedestal(r: Run, t: number, pal: Palette): void {
  box(r, t - 0.05, t + 0.05, 0, RAIL_H + 0.6, -0.05, 0.05, pal.body, pal.line, pal.dress);
  box(r, t - 0.06, t + 0.06, RAIL_H + 0.6, RAIL_H + 1.5, -0.06, 0.06, pal.dress, pal.line, pal.dressHi);
}

/** A round pole standing at `t`, peeled: the log railing's balusters and posts. */
function pole(r: Run, t: number, h0: number, h1: number, rad: number, pal: Palette, cap = false): void {
  const { ctx } = r;
  const [x0, y0] = r.at(t, 0, h0);
  const [, y1] = r.at(t, 0, h1);
  const w = rad * Math.SQRT2 * HALF_W * r.zoom;
  const e = w * (HALF_H / HALF_W);
  ctx.beginPath();
  ctx.moveTo(x0 - w, y1);
  ctx.lineTo(x0 - w, y0);
  ctx.ellipse(x0, y0, w, e, 0, Math.PI, 0, true);
  ctx.lineTo(x0 + w, y1);
  ctx.closePath();
  const g = ctx.createLinearGradient(x0 - w, 0, x0 + w, 0);
  g.addColorStop(0, rgb(pal.body, 0.9));
  g.addColorStop(0.35, rgb(pal.hi, 1));
  g.addColorStop(1, rgb(pal.body, 0.64));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(0.5, 0.7 * r.zoom);
  ctx.strokeStyle = rgb(pal.line, 1, 0.55);
  ctx.stroke();
  if (cap) {
    // The sawn top of a post: its rings.
    ctx.beginPath();
    ctx.ellipse(x0, y1, w, e, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgb(pal.hi, 1.05);
    ctx.fill();
    ctx.stroke();
  }
}

/** A round rail along a run at height `h`, peeled: the log railing's rails. */
function rail(r: Run, t0: number, t1: number, h: number, rad: number, pal: Palette): void {
  const { ctx } = r;
  const dh = rad * 40;
  const a0 = r.at(t0, 0, h + dh), a1 = r.at(t1, 0, h + dh), b1 = r.at(t1, 0, h - dh), b0 = r.at(t0, 0, h - dh);
  quad(ctx, [a0, a1, b1, b0]);
  const g = ctx.createLinearGradient(0, Math.min(a0[1], a1[1]), 0, Math.max(b0[1], b1[1]));
  g.addColorStop(0, rgb(pal.hi, 1.05));
  g.addColorStop(0.5, rgb(pal.body, 0.95));
  g.addColorStop(1, rgb(pal.body, 0.7));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(0.5, 0.7 * r.zoom);
  ctx.strokeStyle = rgb(pal.line, 1, 0.5);
  ctx.stroke();
}

/* -------------------------------------------------------------------------- */
/* Columns                                                                     */
/* -------------------------------------------------------------------------- */

/** The cut stones and the metals stand on round shafts; rubble, brick and adobe on square piers. */
const ROUND = new Set(['marble', 'sandstone', 'stone_brick', 'slate', 'ornate_silver', 'ornate_gold', 'mosaic']);

/** A square block round a corner, from `h0` to `h1`, `r` tiles either side of it: its faces turned to the camera and its top. */
function block(ctx: CanvasRenderingContext2D, cam: Camera, cx: number, cy: number, r: number, h0: number, h1: number, body: RGB, top: RGB, line: RGB, zoom: number): void {
  const P = projector(cam);
  const sides: Array<[number, number, number, number, number, number]> = [
    // outward normal, and the two corners of the face in order
    [0, -1, -r, -r, r, -r], [1, 0, r, -r, r, r], [0, 1, r, r, -r, r], [-1, 0, -r, r, -r, -r],
  ];
  const lw = Math.max(0.6, 0.8 * zoom);
  for (const [nx, ny, u0, v0, u1, v1] of sides) {
    if (!faces(cam, nx, ny)) continue;
    quad(ctx, [P(cx + u0, cy + v0, h0), P(cx + u1, cy + v1, h0), P(cx + u1, cy + v1, h1), P(cx + u0, cy + v0, h1)]);
    ctx.fillStyle = rgb(body, litOf(cam, -ny, nx));
    ctx.fill();
    if (zoom >= FRAME_DETAIL) { ctx.lineWidth = lw; ctx.strokeStyle = rgb(line, 1, 0.55); ctx.stroke(); }
  }
  quad(ctx, [P(cx - r, cy - r, h1), P(cx + r, cy - r, h1), P(cx + r, cy + r, h1), P(cx - r, cy + r, h1)]);
  ctx.fillStyle = rgb(top, 1.18);
  ctx.fill();
  if (zoom >= FRAME_DETAIL) { ctx.lineWidth = lw; ctx.strokeStyle = rgb(line, 1, 0.45); ctx.stroke(); }
}

/** A round drum round a corner from `h0` to `h1`, `r0` at its foot and `r1` at its head, lit across. */
function drum(ctx: CanvasRenderingContext2D, cam: Camera, cx: number, cy: number, r0: number, r1: number, h0: number, h1: number, body: RGB, hi: RGB, line: RGB, zoom: number, topShows = false, flat = false): void {
  const [x, y0] = [cam.worldToScreenX(cx, cy), cam.worldToScreenY(cx, cy, h0)];
  const y1 = cam.worldToScreenY(cx, cy, h1);
  const k = Math.SQRT2 * HALF_W * zoom;
  const w0 = r0 * k, w1 = r1 * k, e0 = w0 * (HALF_H / HALF_W), e1 = w1 * (HALF_H / HALF_W);
  ctx.beginPath();
  ctx.moveTo(x - w1, y1);
  ctx.lineTo(x - w0, y0);
  ctx.ellipse(x, y0, w0, e0, 0, Math.PI, 0, true);
  ctx.lineTo(x + w1, y1);
  ctx.ellipse(x, y1, w1, e1, 0, 0, Math.PI, false);
  ctx.closePath();
  const w = Math.max(w0, w1);
  if (flat) ctx.fillStyle = rgb(hi, 0.96);
  else {
    const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
    g.addColorStop(0, rgb(body, 0.84));
    g.addColorStop(0.34, rgb(hi, 1.04));
    g.addColorStop(0.62, rgb(body, 0.9));
    g.addColorStop(1, rgb(body, 0.62));
    ctx.fillStyle = g;
  }
  ctx.fill();
  if (zoom >= FRAME_DETAIL) { ctx.lineWidth = Math.max(0.6, 0.8 * zoom); ctx.strokeStyle = rgb(line, 1, 0.55); ctx.stroke(); }
  if (topShows) {
    ctx.beginPath();
    ctx.ellipse(x, y1, w1, e1, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgb(hi, 1.12);
    ctx.fill();
    if (zoom >= FRAME_DETAIL) ctx.stroke();
  }
}

/**
 * A column on corner `cx, cy`, from the floor it stands on at `h0` to the
 * underside of what it carries at `h1`, faded to `alpha`. Planned and not yet
 * built it is its outline, filling as the materials go in (`done`). Engaged
 * in walls of half thickness `engaged` it is a pilaster, drawn with `cuts`,
 * whatever stands in front of it or over it, left out.
 */
export function drawColumn(ctx: CanvasRenderingContext2D, cam: Camera, cx: number, cy: number, h0: number, h1: number,
  material: string, done: number, alpha: number, planInk: string, paint?: RGB, dpr = 1, grounded = true, engaged = 0, cuts: readonly Cut[] = []): void {
  const zoom = cam.zoom;
  const pal = palette(material, paint);
  const r = engaged > 0 ? engaged + PILASTER_PROUD : 0.05;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  // A finished column is the same picture wherever it stands, for its stuff, its height, the turn and the zoom;
  // a pilaster the same again for the walls round it, which are cut out of it once (`cutPictureOf`).
  if (done >= 1 && zoom >= FRAME_DETAIL) {
    const pic = pictureOf(cam, material, pal, paint, h1 - h0, dpr, grounded, engaged);
    const laid = cuts.length ? cutPictureOf(cam, pic, cuts, cx, cy, h0, dpr) : pic;
    ctx.drawImage(laid.c, snap(cam.worldToScreenX(cx, cy) + pic.x, dpr), snap(cam.worldToScreenY(cx, cy, h0) + pic.y, dpr), pic.w, pic.h);
    ctx.restore();
    return;
  }
  if (cuts.length) clipOut(ctx, cam, cuts, columnBox(cam, cx, cy, h0, h1));
  if (done < 1) {
    // A plan: the post's outline, and as much of it as is up.
    ctx.globalAlpha = alpha * 0.9;
    if (done > 0) block(ctx, cam, cx, cy, r, h0, h0 + (h1 - h0) * done, pal.body, pal.hi, pal.line, zoom);
    const P = projector(cam);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = planInk;
    ctx.lineWidth = 1.2;
    for (const [u, v] of [[-r, -r], [r, -r], [r, r], [-r, r]]) {
      const a = P(cx + u, cy + v, h0), b = P(cx + u, cy + v, h1);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }
  // From far off: a block.
  block(ctx, cam, cx, cy, engaged > 0 ? r : stony(material) ? 0.065 : 0.05, h0, h1, pal.body, pal.hi, pal.line, zoom);
  ctx.restore();
}

/** The light down a squared post's two arrises nearest the camera, where its chamfers catch it. */
function chamferLights(ctx: CanvasRenderingContext2D, cam: Camera, cx: number, cy: number, r: number, h0: number, h1: number, pal: Palette): void {
  const P = projector(cam);
  const near: [number, number] = cam.rotateX(1, 1) + cam.rotateY(1, 1) > 0 ? [r, r] : [-r, -r];
  const n2: [number, number] = cam.rotateX(1, -1) + cam.rotateY(1, -1) > 0 ? [r, -r] : [-r, r];
  ctx.strokeStyle = rgb(pal.hi, 1.1, 0.7);
  ctx.lineWidth = Math.max(0.6, 0.8 * cam.zoom);
  for (const [u, v] of [near, n2]) {
    const a = P(cx + u, cy + v, h0), b = P(cx + u, cy + v, h1);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
}

/** A brick or cobble pier's courses, a hand apart, round the faces of it turned to the camera. */
function coursesOn(ctx: CanvasRenderingContext2D, cam: Camera, cx: number, cy: number, r: number, h0: number, h1: number, material: string, pal: Palette): void {
  if (material !== 'clay_bricks' && material !== 'cobblestone') return;
  const P = projector(cam);
  ctx.strokeStyle = rgb(pal.dark, 1, 0.45);
  ctx.lineWidth = Math.max(0.5, 0.6 * cam.zoom);
  for (let h = h0; h < h1; h += material === 'clay_bricks' ? 1.1 : 1.8) {
    for (const [nx, ny, u0, v0, u1, v1] of [[1, 0, r, -r, r, r], [0, 1, r, r, -r, r],
      [-1, 0, -r, r, -r, -r], [0, -1, -r, -r, r, -r]] as Array<[number, number, number, number, number, number]>) {
      if (!faces(cam, nx, ny)) continue;
      const a = P(cx + u0, cy + v0, h), b = P(cx + u1, cy + v1, h);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
}

/** How far a pilaster's shaft stands proud of the faces of the walls it is engaged in, in tiles. */
export const PILASTER_PROUD = 0.025;
/** How much further out than its shaft a pilaster's base and head stand, in tiles. */
const PILASTER_DRESS = 0.016;
/** How far out from its corner the widest piece of a column standing free reaches, in tiles: a pillar's abacus. */
const COLUMN_REACH = 0.088;

/**
 * A finished column on corner `cx, cy` from `h0` to `h1`, drawn piece by
 * piece: what `pictureOf` paints once. A post on the ground stands on a stone
 * pad; one up on a floor on a sole block of its own timber. Engaged in the
 * walls meeting on its corner (`engaged`, half their thickness) it is a
 * pilaster instead.
 */
function columnBody(ctx: CanvasRenderingContext2D, cam: Camera, cx: number, cy: number, h0: number, h1: number, material: string, pal: Palette, grounded = true, engaged = 0): void {
  const zoom = cam.zoom;
  if (engaged > 0) {
    pilasterBody(ctx, cam, cx, cy, h0, h1, material, pal, engaged + PILASTER_PROUD, grounded);
    return;
  }
  if (!stony(material)) {
    // A squared post, sawn or hewn: a log is hewn square for a post, and keeps its colour.
    const pad = MATERIAL_BY_ID.get('cobblestone')?.color ?? [140, 136, 128];
    // A stone pad under the foot, which keeps the post out of the wet; a sole block on a floor.
    if (grounded) block(ctx, cam, cx, cy, 0.07, h0, h0 + 1.2, pad, pad, [72, 70, 66], zoom);
    else block(ctx, cam, cx, cy, 0.064, h0, h0 + 1.2, pal.dark, pal.body, pal.line, zoom);
    block(ctx, cam, cx, cy, 0.047, h0 + 1.2, h1 - 2.4, pal.body, pal.hi, pal.line, zoom);
    // The chamfer down its near arris, where the light runs.
    chamferLights(ctx, cam, cx, cy, 0.047, h0 + 1.6, h1 - 2.8, pal);
    // A bolster on its head, a hand wider than the post, that the beam sits on.
    block(ctx, cam, cx, cy, 0.068, h1 - 2.4, h1, pal.dark, pal.body, pal.line, zoom);
    return;
  }
  if (ROUND.has(material)) {
    // A pillar: a square plinth, a round moulding, the shaft, a cushion, and a square slab on its head.
    block(ctx, cam, cx, cy, 0.085, h0, h0 + 1.5, pal.dress, pal.dressHi, pal.line, zoom);
    drum(ctx, cam, cx, cy, 0.074, 0.066, h0 + 1.5, h0 + 2.4, pal.dress, pal.dressHi, pal.line, zoom, false, true);
    drum(ctx, cam, cx, cy, 0.056, 0.052, h0 + 2.4, h1 - 3, pal.gilt ?? pal.body, pal.giltHi ?? pal.hi, pal.line, zoom);
    drum(ctx, cam, cx, cy, 0.054, 0.078, h1 - 3, h1 - 1.6, pal.dress, pal.dressHi, pal.line, zoom, false, true);
    // The abacus, its top in the dressing's own colour rather than its light: pale squares along a row of lintels otherwise.
    block(ctx, cam, cx, cy, COLUMN_REACH, h1 - 1.6, h1, pal.dress, pal.dress, pal.line, zoom);
  } else {
    // A pier: a base course, the pier, and a cap.
    block(ctx, cam, cx, cy, 0.084, h0, h0 + 1.4, pal.dress, pal.dressHi, pal.line, zoom);
    block(ctx, cam, cx, cy, 0.066, h0 + 1.4, h1 - 1.6, pal.body, pal.hi, pal.line, zoom);
    coursesOn(ctx, cam, cx, cy, 0.066, h0 + 2.4, h1 - 2, material, pal);
    block(ctx, cam, cx, cy, 0.084, h1 - 1.6, h1, pal.dress, pal.dressHi, pal.line, zoom);
  }
}

/**
 * A column engaged in the walls that meet on its corner: a pilaster, square,
 * `r` either side of the corner, so that it stands `PILASTER_PROUD` out from
 * the face of each wall, and its base and its head prouder again. In timber a
 * corner post; in cut stone and the metals a fluted shaft on a moulded base
 * under a capital; in rubble, brick and adobe a pier with a base course and a
 * cap. Only what stands clear of the walls is seen of it: they are cut out of
 * it when it is drawn (`drawColumn`).
 */
function pilasterBody(ctx: CanvasRenderingContext2D, cam: Camera, cx: number, cy: number, h0: number, h1: number, material: string, pal: Palette, r: number, grounded: boolean): void {
  const zoom = cam.zoom;
  if (!stony(material)) {
    const pad = MATERIAL_BY_ID.get('cobblestone')?.color ?? [140, 136, 128];
    if (grounded) block(ctx, cam, cx, cy, r + PILASTER_DRESS, h0, h0 + 1.2, pad, pad, [72, 70, 66], zoom);
    else block(ctx, cam, cx, cy, r + 0.012, h0, h0 + 1.2, pal.dark, pal.body, pal.line, zoom);
    block(ctx, cam, cx, cy, r, h0 + 1.2, h1 - 2.4, pal.body, pal.hi, pal.line, zoom);
    chamferLights(ctx, cam, cx, cy, r, h0 + 1.6, h1 - 2.8, pal);
    block(ctx, cam, cx, cy, r + 0.014, h1 - 2.4, h1, pal.dark, pal.body, pal.line, zoom);
    return;
  }
  if (ROUND.has(material)) {
    block(ctx, cam, cx, cy, r + PILASTER_DRESS, h0, h0 + 1.5, pal.dress, pal.dressHi, pal.line, zoom);
    block(ctx, cam, cx, cy, r + 0.008, h0 + 1.5, h0 + 2.4, pal.dress, pal.dressHi, pal.line, zoom);
    block(ctx, cam, cx, cy, r, h0 + 2.4, h1 - 3, pal.gilt ?? pal.body, pal.giltHi ?? pal.hi, pal.line, zoom);
    // Its flutes, three to a face, where a face stands clear of a wall to show them.
    if (zoom >= FRAME_DETAIL) {
      const P = projector(cam);
      ctx.strokeStyle = rgb(pal.dark, 1, 0.5);
      ctx.lineWidth = Math.max(0.5, 0.7 * zoom);
      for (const [nx, ny] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as Array<[number, number]>) {
        if (!faces(cam, nx, ny)) continue;
        for (const k of [-0.5, 0, 0.5]) {
          const u = nx ? nx * r : k * r, v = ny ? ny * r : k * r;
          const a = P(cx + u, cy + v, h0 + 3), b = P(cx + u, cy + v, h1 - 3.6);
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        }
      }
    }
    block(ctx, cam, cx, cy, r + 0.008, h1 - 3, h1 - 1.6, pal.dress, pal.dressHi, pal.line, zoom);
    block(ctx, cam, cx, cy, r + PILASTER_DRESS, h1 - 1.6, h1, pal.dress, pal.dress, pal.line, zoom);
  } else {
    block(ctx, cam, cx, cy, r + PILASTER_DRESS, h0, h0 + 1.4, pal.dress, pal.dressHi, pal.line, zoom);
    block(ctx, cam, cx, cy, r, h0 + 1.4, h1 - 1.6, pal.body, pal.hi, pal.line, zoom);
    coursesOn(ctx, cam, cx, cy, r, h0 + 2.4, h1 - 2, material, pal);
    block(ctx, cam, cx, cy, r + PILASTER_DRESS, h1 - 1.6, h1, pal.dress, pal.dressHi, pal.line, zoom);
  }
}

/**
 * A box along a run from a corner, standing in front of a pilaster on it or
 * over it: a wall, a beam, the storey's walls over it. `t` runs along from
 * the corner `x, y` the way `dx, dy` goes, `half` across either side, from
 * `h0` to `h1`.
 */
export interface Cut { x: number; y: number; dx: number; dy: number; t0: number; t1: number; half: number; h0: number; h1: number }

/** A cut's outline on the screen: the hull of its eight corners. */
function hullOf(cam: Camera, c: Cut): Array<[number, number]> {
  const P = projector(cam);
  const nx = -c.dy, ny = c.dx;
  const pts: Array<[number, number]> = [];
  for (const t of [c.t0, c.t1]) for (const s of [-c.half, c.half]) for (const h of [c.h0, c.h1]) {
    pts.push(P(c.x + c.dx * t + nx * s, c.y + c.dy * t + ny * s, h));
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [], upper: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Leaves everything on the screen inside any of `cuts` out of what is drawn
 * next, inside `box` (x0, y0, x1, y1 on the screen), which what is drawn next
 * stays within. Each cut is wholly in front of what is drawn, or over it,
 * wherever the two overlap on the screen, so what it covers is hidden, and
 * hidden exactly. A clip is as dear as the ground it spans, so each spans the
 * box and no more, and a cut that misses the box is no clip at all.
 */
export function clipOut(ctx: CanvasRenderingContext2D, cam: Camera, cuts: readonly Cut[], box: readonly [number, number, number, number]): void {
  const [x0, y0, x1, y1] = box;
  for (const c of cuts) {
    const hull = hullOf(cam, c);
    if (hull.length < 3) continue;
    let hx0 = Infinity, hy0 = Infinity, hx1 = -Infinity, hy1 = -Infinity;
    for (const [hx, hy] of hull) { hx0 = Math.min(hx0, hx); hx1 = Math.max(hx1, hx); hy0 = Math.min(hy0, hy); hy1 = Math.max(hy1, hy); }
    if (hx0 >= x1 || hx1 <= x0 || hy0 >= y1 || hy1 <= y0) continue;
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.moveTo(hull[0][0], hull[0][1]);
    for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i][0], hull[i][1]);
    ctx.closePath();
    ctx.clip('evenodd');
  }
}

/** The screen box round a column on `cx, cy` from `h0` to `h1`, as far out as any piece of one reaches. */
function columnBox(cam: Camera, cx: number, cy: number, h0: number, h1: number): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const u of [-0.13, 0.13]) for (const v of [-0.13, 0.13]) for (const h of [h0 - 1, h1 + 1]) {
    const px = cam.worldToScreenX(cx + u, cy + v), py = cam.worldToScreenY(cx + u, cy + v, h);
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  return [Math.floor(x0) - 2, Math.floor(y0) - 2, Math.ceil(x1) + 2, Math.ceil(y1) + 2];
}

/** The pictures of finished columns, painted once each, the oldest let go past `PICTURES` of them. */
const pictures = new Map<string, Body>();
const PICTURES = 48;

function pictureOf(cam: Camera, material: string, pal: Palette, paint: RGB | undefined, height: number, dpr: number, grounded: boolean, engaged: number): Body {
  const key = `${material}|${paint ? paint.join(',') : ''}|${cam.rotation}|${cam.zoom}|${height.toFixed(2)}|${dpr}|${grounded ? 1 : 0}|${engaged.toFixed(3)}`;
  const had = pictures.get(key);
  if (had) {
    pictures.delete(key);
    pictures.set(key, had);
    return had;
  }
  const X0 = cam.worldToScreenX(0, 0), Y0 = cam.worldToScreenY(0, 0, 0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const u of [-0.13, 0.13]) for (const v of [-0.13, 0.13]) for (const h of [-1, height + 1]) {
    const px = cam.worldToScreenX(u, v) - X0, py = cam.worldToScreenY(u, v, h) - Y0;
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  x0 = Math.floor(x0) - 2; y0 = Math.floor(y0) - 2;
  const w = Math.ceil(x1) + 2 - x0, h = Math.ceil(y1) + 2 - y0;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * dpr));
  c.height = Math.max(1, Math.ceil(h * dpr));
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.lineJoin = 'round';
  // The camera, moved so the column's foot falls inside the picture.
  const shifted = Object.create(cam) as Camera;
  shifted.worldToScreenX = (x: number, y: number): number => cam.worldToScreenX(x, y) - X0 - x0;
  shifted.worldToScreenY = (x: number, y: number, hh: number): number => cam.worldToScreenY(x, y, hh) - Y0 - y0;
  columnBody(g, shifted, 0, 0, 0, height, material, pal, grounded, engaged);
  const pic: Body = { c, x: x0, y: y0, w, h, key };
  pictures.set(key, pic);
  while (pictures.size > PICTURES) {
    const first = pictures.keys().next().value;
    if (first === undefined) break;
    pictures.delete(first);
  }
  return pic;
}

/**
 * A pilaster's picture with what hides it taken out of it (`Cut`): the walls
 * round a corner stand the same way round every corner they stand round alike,
 * and the projection is linear, so this too is painted once, for the picture
 * and the cuts as they lie from its foot, and laid down after that. The oldest
 * are let go past `PICTURES` of them.
 */
const cutPictures = new Map<string, Body>();
function cutPictureOf(cam: Camera, pic: Body, cuts: readonly Cut[], cx: number, cy: number, h0: number, dpr: number): Body {
  const from = cuts.map((c) => [c.x - cx, c.y - cy, c.dx, c.dy, c.t0, c.t1, c.half, c.h0 - h0, c.h1 - h0].map((v) => Math.round(v * 1000)).join(','));
  const key = `${pic.key}|${from.join(';')}`;
  const had = cutPictures.get(key);
  if (had) {
    cutPictures.delete(key);
    cutPictures.set(key, had);
    return had;
  }
  const c = document.createElement('canvas');
  c.width = pic.c.width;
  c.height = pic.c.height;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.drawImage(pic.c, 0, 0);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.globalCompositeOperation = 'destination-out';
  // The picture's own frame: the column's foot at the origin, as `pictureOf` painted it.
  const X0 = cam.worldToScreenX(0, 0), Y0 = cam.worldToScreenY(0, 0, 0);
  const shifted = Object.create(cam) as Camera;
  shifted.worldToScreenX = (x: number, y: number): number => cam.worldToScreenX(x, y) - X0 - pic.x;
  shifted.worldToScreenY = (x: number, y: number, hh: number): number => cam.worldToScreenY(x, y, hh) - Y0 - pic.y;
  g.beginPath();
  for (const cut of cuts) {
    const hull = hullOf(shifted, { ...cut, x: cut.x - cx, y: cut.y - cy, h0: cut.h0 - h0, h1: cut.h1 - h0 });
    if (hull.length < 3) continue;
    g.moveTo(hull[0][0], hull[0][1]);
    for (let i = 1; i < hull.length; i++) g.lineTo(hull[i][0], hull[i][1]);
    g.closePath();
  }
  // Each hull wound the same way, so where two overlap they are taken out once.
  g.fill('nonzero');
  const out: Body = { c, x: pic.x, y: pic.y, w: pic.w, h: pic.h, key };
  cutPictures.set(key, out);
  while (cutPictures.size > PICTURES) {
    const first = cutPictures.keys().next().value;
    if (first === undefined) break;
    cutPictures.delete(first);
  }
  return out;
}

/**
 * The beam along a side carried by two columns, under what is over it: a
 * squared timber, or a stone lintel with a fillet along its face.
 */
export function drawBeam(ctx: CanvasRenderingContext2D, cam: Camera, border: Border, top: number, material: string, alpha: number, paint?: RGB): void {
  const zoom = cam.zoom;
  const [ax, ay, bx, by] = borderPoints(border);
  const r = runOf(ctx, cam, ax, ay, bx - ax, by - ay, zoom);
  const pal = palette(material, paint);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  const stone = stony(material);
  const half = stone ? 0.05 : 0.042;
  box(r, 0, 1, top - BEAM_DEEP, top, -half, half, stone ? pal.dress : pal.body, pal.line, stone ? pal.dressHi : pal.hi, false);
  if (stone && zoom >= FRAME_DETAIL) {
    // The fillet a lintel is dressed with, a third of the way down its face.
    const a = r.at(0.02, half, top - BEAM_DEEP * 0.36), b = r.at(0.98, half, top - BEAM_DEEP * 0.36);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = rgb(pal.dark, 1, 0.6);
    ctx.lineWidth = Math.max(0.6, 0.8 * zoom);
    ctx.stroke();
  }
  ctx.restore();
}

/* -------------------------------------------------------------------------- */
/* Jetties                                                                     */
/* -------------------------------------------------------------------------- */

const STEP: Record<Side, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
/** A side of a tile as a run, from its first corner to its second going round clockwise, and which way is out. */
const EDGE: Record<Side, [number, number, number, number]> = {
  n: [0, 0, 1, 0], e: [1, 0, 1, 1], s: [1, 1, 0, 1], w: [0, 1, 0, 0],
};

/**
 * What carries a jetty, under its deck at `deck` (the top of the floor): on
 * `bears`, the side it goes into the wall on, and along each of `open`, the
 * sides of it turned to the camera with nothing carrying on past them.
 */
/** How deep a jetty's joists stand under its deck, as their ends show under the front of it. */
export const JOIST_DEEP = 2.6;

export function drawJettySupports(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, deck: number, material: string,
  bears: Side, open: Side[], alpha: number): void {
  const zoom = cam.zoom;
  const pal = palette(material);
  const under = deck - FLOOR_DEEP;
  const stone = stony(material);
  const [ox, oy] = STEP[bears];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  for (const side of open) {
    const [u0, v0, u1, v1] = EDGE[side];
    const [sx, sy] = STEP[side];
    if (!faces(cam, sx, sy)) continue;
    const r = runOf(ctx, cam, x + u0, y + v0, u1 - u0, v1 - v0, zoom);
    // Across the side: toward the wall it goes into, or out along it.
    const front = sx === -ox && sy === -oy;
    if (front) {
      if (stone) {
        // A moulded course, and a row of corbels under it.
        box(r, 0, 1, under - 1.5, under, -0.02, 0.022, pal.dress, pal.line, pal.dressHi, false);
        if (zoom >= FRAME_DETAIL) for (let i = 0; i < 6; i++) {
          const t = (i + 0.5) / 6;
          box(r, t - 0.03, t + 0.03, under - 3, under - 1.5, -0.01, 0.016, pal.body, pal.line, pal.dress);
        }
      } else {
        // The ends of the joists, under the front of the deck.
        for (let i = 0; i < 5; i++) {
          const t = (i + 0.5) / 5;
          box(r, t - 0.024, t + 0.024, under - JOIST_DEEP, under, -0.02, 0.018, pal.dark, pal.line, pal.body);
        }
      }
      continue;
    }
    // A side running out from the wall: `along` is how far out from the wall's line, as `t` along the run.
    const [px, py] = [x + u0, y + v0];
    const first = bears === 'n' ? py === y : bears === 's' ? py === y + 1 : bears === 'w' ? px === x : px === x + 1;
    const along = (a: number): number => (first ? a : 1 - a);
    const t0 = WALL_THICK;
    if (stone) {
      box(r, 0, 1, under - 1.5, under, -0.02, 0.022, pal.dress, pal.line, pal.dressHi, false);
      // A stepped corbel out of the wall: three courses, each standing further out than the one under it.
      for (let j = 0; j < 3; j++) {
        const reach = 0.12 * (3 - j) + t0;
        const hTop = under - 1.5 - 2.6 * j, hBot = hTop - 2.6;
        const a = along(t0 - 0.02), b = along(reach);
        box(r, Math.min(a, b), Math.max(a, b), hBot, hTop, -0.05, 0.02, pal.body, pal.line, pal.dress);
      }
    } else {
      // The outer joist, and a knee brace down to the wall under it.
      box(r, 0, 1, under - JOIST_DEEP, under, -0.045, 0.012, pal.body, pal.line, pal.hi, false);
      const b0 = along(t0), b1 = along(0.46);
      const lo = under - JOIST_DEEP - 12, hi = under - JOIST_DEEP;
      const w = 0.028;
      const P = (t: number, h: number): [number, number] => r.at(t, 0.006, h);
      ctx.beginPath();
      const d = b1 > b0 ? 1 : -1;
      ctx.moveTo(...P(b0, lo + 2));
      ctx.lineTo(...P(b0, lo - 1));
      ctx.lineTo(...P(b1 + d * w, hi));
      ctx.lineTo(...P(b1 - d * w * 2.5, hi));
      ctx.closePath();
      ctx.fillStyle = rgb(pal.body, r.lit * 0.95);
      ctx.fill();
      if (zoom >= FRAME_DETAIL) { ctx.lineWidth = Math.max(0.6, 0.8 * zoom); ctx.strokeStyle = rgb(pal.line, 1, 0.6); ctx.stroke(); }
    }
  }
  ctx.restore();
}
