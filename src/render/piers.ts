/**
 * Piers under a deck, as they are drawn (`src/game/piers.ts` for the rules).
 *
 * A deck of timber stands on square posts at the corners of its tiles, braced
 * across every open side with a girt under the deck and crossed diagonals in
 * as many tiers as its height asks for; a deck of logs stands on peeled poles.
 * A deck of stone stands on square piers of the stone, coursed, on a footing,
 * with a small round arch turned between each two along an open side and a
 * ring of dressed voussoirs round it -- flattened where the drop is too short
 * for a half circle, and a plain low wall where it is too short for any arch.
 * Every piece is in its material's own palette: the colours its stairs are
 * built in (`stairing.ts`), which are the colours of its walls.
 *
 * Each post is drawn once, by the last tile of the building drawn round its
 * corner -- after the ground of all of them, and kept off the decks of the
 * others, which stand over it -- and each side only where it is open to the
 * outside; the renderer works both out and hands them over. A side runs from
 * the inner face of one post to the inner face of the next, so whichever tile
 * draws a post, nothing of its neighbours' sides crosses it. Within a tile the far sides go first,
 * then the posts standing behind every near side, then the near sides, then
 * the rest of the posts: a post's near half stands in front of the braces that
 * run into it. The ground under the deck is in its shade from the first of
 * the deck to be built, laid over the edges the ground beside it was drawn
 * with, so that it is one shade from tile to tile with no seam between.
 *
 * A post standing in the water is drawn however little of it shows over the
 * water, with the water lapping round it; none is drawn where a pond has
 * risen over its top, and the deck then lies in the water.
 *
 * A foot in the water stands at the water's surface, dark and wet just over
 * it, with the water lapping round it: a breathing line of foam close in and,
 * close up, a ring going out now and then -- the stepping stones' water, in
 * the stones' own foam (`stones.ts`), and the sea's white where it is the sea.
 * The lapping is worked out in the pass that lays the ground and the water
 * (`pierFeetOf`), and laid with the water of the tile in front of the post,
 * over that water and under the post and anything standing on that tile
 * (`drawPierFeet`): never in among the posts and decks, whose drawing it
 * would break up. The swell and the wakes are laid over the water behind a
 * building on piers before it is drawn, and never under its decks
 * (`Renderer.layWater`); the wild pads and the ripples on a pond keep out
 * from under them (`WaterFrame.decked`).
 *
 * Below `DETAIL_FROM` it is shapes and colours: no courses, no rings.
 */
import type { Camera } from '../engine/camera';
import { FLOOR_DEEP } from '../game/building';
import { hash2 } from '../world/noise';
import { DETAIL_FROM } from './falls';
import { HALF_H, HALF_W, UNITS_PER_TILE } from './iso';
import { stairStyle } from './stairing';
import { SPRING_FOAM } from './water';

type RGB = readonly [number, number, number];

/** A tile on piers, as the renderer hands it over. */
export interface PierTile {
  x: number;
  y: number;
  /** The deck's height. */
  deck: number;
  /** The ground at the tile's four corners, in the world's order: (x, y), (x + 1, y), (x + 1, y + 1), (x, y + 1). */
  ground: readonly number[];
  /** The water standing over the tile, or null; and whether it is the sea's rather than a pond's. */
  water: number | null;
  sea: boolean;
  /** Which of its sides -- north, east, south, west -- stand open to the outside, and carry bracing or an arcade. */
  open: readonly boolean[];
  /** Which of its corners this tile draws the post at. */
  posts: readonly boolean[];
  /**
   * For each corner it draws the post at, the decks already laid round it on
   * the screen -- polygons, as x, y pairs -- which the post is not drawn over:
   * it stands under them. Null for none.
   */
  hide: ReadonlyArray<ReadonlyArray<readonly number[]> | null>;
  /** What the deck is laid in, or null while nothing is planned on the tile but the tile. */
  material: string | null;
  /** How much of the deck's bill is paid, 0 to 1. */
  progress: number;
  /** In sight, or only remembered: remembered water does not move. */
  lit: boolean;
  /** How far past the tile its shade is laid, in pixels: half the width the tile's ground was edged in (`Renderer`). */
  seam: number;
}

/** A foot standing in the water, for the water round it to be laid once the ground in front of it is down. */
export interface PierFoot {
  /** Where it stands in the world, at the water's height, and how wide it is, in tiles either way. */
  wx: number;
  wy: number;
  h: number;
  r: number;
  seed: number;
  sea: boolean;
  /** The post over it on the screen, which the water is not laid over: left, top, right, bottom. */
  box: [number, number, number, number];
  /**
   * The tiles on piers round its corner, on the screen at the water's height,
   * as four x, y pairs each: the water under a deck is in its shade, and no
   * ring goes out there. The renderer fills it in; the tile knows only itself.
   */
  under: number[][];
  lit: boolean;
}

/** The corners of a tile from its own, and out through side `i`, which runs from corner `i` to corner `i + 1`. */
const CORNER: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
const OUT: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
/** Half a timber post across, in tiles: a post a little over a third of a metre square. */
const POST = 0.045;
/** Half a stone pier across, in tiles, and how far its footing stands out past it. */
const PIER = 0.085;
const FOOTING = 0.014;
/** A course of a stone pier or spandrel, in height units; the masonry over an arch's crown; and the ring of voussoirs round it. */
const COURSE = 5;
const BAND = 3;
const RING = 2.4;
/** The plank a brace is sawn from, on the screen at zoom one; a girt is a size up. */
const BRACE = 2.3;
const GIRT = 3;
/** The shade the deck throws on what is under it. */
const UNDER = 'rgba(24, 26, 42, 0.36)';
/** What a set-out tile is staked with, before anything is planned on it. */
const STAKE: RGB = [196, 170, 124];
const STAKE_LINE: RGB = [104, 84, 56];

const rgb = (c: RGB, k = 1, a = 1): string =>
  `rgba(${Math.min(255, Math.round(c[0] * k))},${Math.min(255, Math.round(c[1] * k))},${Math.min(255, Math.round(c[2] * k))},${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** The water's teal, which a wet foot takes a little of, as a wet stepping stone does. */
const WET: RGB = [38, 84, 92];

/** How a face turned the way a run `ux`, `uy` faces is lit: the light every wall is drawn in. */
export function faceLight(cam: Camera, ux: number, uy: number): number {
  const vx = cam.rotateX(ux, uy);
  const along = Math.abs(vx);
  const into = Math.abs(cam.rotateY(ux, uy));
  const face = along / (along + into || 1);
  return 0.72 * (1 - face) + (vx > 0 ? 1 : 0.8) * face;
}

/**
 * A convex outline on the screen pushed out by `d` pixels all round: each
 * side moved out along its normal, and each corner to where the two moved
 * sides beside it meet.
 */
function outset(pts: ReadonlyArray<readonly [number, number]>, d: number): Array<[number, number]> {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1];
  // Out is to the right of the way round it runs, or to the left: whichever its area says.
  const s = area >= 0 ? 1 : -1;
  const normal = (a: readonly [number, number], b: readonly [number, number]): [number, number] => {
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const l = Math.hypot(ex, ey) || 1;
    return [(s * ey) / l, (-s * ex) / l];
  };
  return pts.map((c, i) => {
    const [ax, ay] = normal(pts[(i + n - 1) % n], c);
    const [bx, by] = normal(c, pts[(i + 1) % n]);
    const k = d / Math.max(0.2, 1 + ax * bx + ay * by);
    return [c[0] + (ax + bx) * k, c[1] + (ay + by) * k];
  });
}

/** Which way a side faces the camera: 1 toward it, -1 away, 0 edge on. */
const facing = (cam: Camera, nx: number, ny: number): number => {
  const k = cam.rotateX(nx, ny) + cam.rotateY(nx, ny);
  return k > 1e-6 ? 1 : k < -1e-6 ? -1 : 0;
};

/** Where a tile's posts stand and what they stand on: the piers' painter and the water round their feet both ask it. */
function layoutOf(p: PierTile) {
  const X0 = p.x, Y0 = p.y;
  const [g0, g1, g2, g3] = p.ground;
  /** The ground at a point of the tile, off its four corners as the ground is drawn. */
  const groundAt = (wx: number, wy: number): number => {
    const fx = wx - X0, fy = wy - Y0;
    return (g0 * (1 - fx) + g1 * fx) * (1 - fy) + (g3 * (1 - fx) + g2 * fx) * fy;
  };
  const st = p.material ? stairStyle(p.material) : null;
  const stone = !!st && st.build === 'solid';
  const hw = stone ? PIER : POST;
  return {
    st, stone, hw,
    pole: !!st && st.build === 'log',
    /** The underside of the deck's joists, where the posts stop. */
    top: p.deck - FLOOR_DEEP,
    /** Where a post at a point stands: the ground, or the water over it; and whether that is the water. */
    footAt: (wx: number, wy: number): number => Math.max(groundAt(wx, wy), p.water ?? -Infinity),
    wetAt: (wx: number, wy: number): boolean => p.water !== null && groundAt(wx, wy) < p.water,
    /**
     * Where corner `i`'s post stands: drawn in off every open side it is on by
     * its own half-width, so that it stands flush under the deck's edge, and on
     * the corner along a side the building carries on across. A stake before
     * anything is planned stands on the corner itself.
     */
    postAt: (i: number): [number, number] => {
      let cx = X0 + CORNER[i][0], cy = Y0 + CORNER[i][1];
      if (!st) return [cx, cy];
      for (const s of [(i + 3) % 4, i]) {
        if (!p.open[s]) continue;
        cx -= OUT[s][0] * hw;
        cy -= OUT[s][1] * hw;
      }
      return [cx, cy];
    },
  };
}

/**
 * The feet of a tile's posts that stand in the water, for the water round
 * each to be laid -- before the post goes up, in the pass that lays the
 * ground and the water, so that it is never laid in among the posts and
 * decks. `under` is left for the renderer, which knows the tiles round them.
 */
export function pierFeetOf(cam: Camera, p: PierTile): PierFoot[] {
  if (cam.zoom < DETAIL_FROM || p.water === null) return [];
  const L = layoutOf(p);
  const z = cam.zoom;
  const feet: PierFoot[] = [];
  for (let i = 0; i < 4; i++) {
    if (!p.posts[i] || !L.st) continue;
    const [cx, cy] = L.postAt(i);
    const f = L.footAt(cx, cy);
    // Every post that stands in the water, however little of it shows; none where the water is over its top.
    if (f >= L.top || !L.wetAt(cx, cy)) continue;
    const hw = L.hw;
    const bx = [cam.worldToScreenX(cx - hw, cy - hw), cam.worldToScreenX(cx + hw, cy - hw), cam.worldToScreenX(cx + hw, cy + hw), cam.worldToScreenX(cx - hw, cy + hw)];
    feet.push({
      wx: cx, wy: cy, h: f, r: hw * (L.stone ? 1.5 : 1.9), seed: hash2(Math.round(cx * 8), Math.round(cy * 8), 57), sea: p.sea,
      box: [Math.min(...bx), cam.worldToScreenY(cx, cy, L.top) - hw * HALF_H * 2 * z, Math.max(...bx), cam.worldToScreenY(cx, cy, f) + 0.5],
      under: [], lit: p.lit,
    });
  }
  return feet;
}

/** One tile's piers, before its deck is laid over them; the water round their feet is laid before, by `pierFeetOf` and `drawPierFeet`. */
export function drawPierTile(ctx: CanvasRenderingContext2D, cam: Camera, p: PierTile): void {
  const z = cam.zoom;
  const detail = z >= DETAIL_FROM;
  const sx = (wx: number, wy: number): number => cam.worldToScreenX(wx, wy);
  const sy = (wx: number, wy: number, h: number): number => cam.worldToScreenY(wx, wy, h);
  const X0 = p.x, Y0 = p.y;
  const { st, stone, pole, hw, top, footAt, wetAt, postAt } = layoutOf(p);

  /*
   * The shade of the deck on the ground, or the water, under it, from the
   * first of it to be built. Pushed out all round by half the width this
   * tile's ground was edged in: every tile of ground is stroked in its own
   * colour round its edge (`Renderer`), which lays half the stroke over the
   * tiles beside it, the shade of the decks drawn before this one among them.
   * Coming back over exactly that much, a deck's shade is one shade from tile
   * to tile, with no light seam between and no dark one.
   */
  if (p.material && p.progress > 0) {
    const quad: Array<[number, number]> = CORNER.map(([cx, cy]) => [sx(X0 + cx, Y0 + cy), sy(X0 + cx, Y0 + cy, footAt(X0 + cx, Y0 + cy))]);
    const out = outset(quad, p.seam);
    ctx.beginPath();
    ctx.moveTo(out[0][0], out[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(out[i][0], out[i][1]);
    ctx.closePath();
    ctx.fillStyle = UNDER;
    ctx.fill();
  }

  /** How far up its post each one has got: posts go up first, and reach the deck at seven tenths of its bill. */
  const risen = p.material ? Math.min(1, p.progress / 0.7) : 1;
  const done = !!p.material && p.progress >= 1;

  /* ---- The posts and piers ---- */
  const post = (i: number): void => {
    if (!p.posts[i]) return;
    const hidden = p.hide[i];
    if (!hidden) {
      postUp(i);
      return;
    }
    // Everywhere but the decks over it: one clip a deck, so that two decks overlapping do not let it through.
    // Each clip is only as big as the post can reach, which is what keeps a clip cheap.
    ctx.save();
    const [cx, cy] = postAt(i);
    const reach = (stone ? PIER + FOOTING : POST) * HALF_W * Math.SQRT2 * z + 3;
    const x0 = sx(cx, cy) - reach, y0 = sy(cx, cy, p.deck) - reach, y1 = sy(cx, cy, Math.min(footAt(cx, cy), p.deck)) + reach;
    for (const q of hidden) {
      ctx.beginPath();
      ctx.rect(x0, y0, 2 * reach, y1 - y0);
      ctx.moveTo(q[0], q[1]);
      for (let k = 2; k < q.length; k += 2) ctx.lineTo(q[k], q[k + 1]);
      ctx.closePath();
      ctx.clip('evenodd');
    }
    postUp(i);
    ctx.restore();
  };
  const postUp = (i: number): void => {
    const [cx, cy] = postAt(i);
    const f = footAt(cx, cy);
    // A post standing in the water shows however little of it is over it, as far as the joists; none under the water.
    if (top - f < (wetAt(cx, cy) ? 0.05 : 1)) return;
    if (!st) {
      // Set out and nothing planned: a stake at the corner, up to where the deck will be.
      stake(cx, cy, f, p.deck);
      return;
    }
    const up = f + (top - f) * risen;
    if (risen < 1) {
      // The rest of it, to come: an outline to the deck.
      box(cx, cy, hw, up, top, null, 0.35);
    }
    if (up - f > Math.min(0.3, (top - f) * 0.5)) {
      if (pole) poleOf(cx, cy, hw, f, up);
      else box(cx, cy, hw, f, up, stone ? 'pier' : 'post', 1);
      if (stone && detail) footing(cx, cy, f);
    }
  };

  /** A square post or pier at (cx, cy), `hw` either way, from `h0` up to `h1`: its sides that face the camera. */
  const box = (cx: number, cy: number, hw: number, h0: number, h1: number, kind: 'post' | 'pier' | null, alpha: number): void => {
    const sides: Array<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    for (const [nx, ny] of sides) {
      if (facing(cam, nx, ny) <= 0) continue;
      // The side's two edges: a side facing +x runs along y.
      const [ax, ay, bx, by] = nx !== 0
        ? [cx + nx * hw, cy - hw, cx + nx * hw, cy + hw]
        : [cx - hw, cy + ny * hw, cx + hw, cy + ny * hw];
      ctx.beginPath();
      ctx.moveTo(sx(ax, ay), sy(ax, ay, h1));
      ctx.lineTo(sx(bx, by), sy(bx, by, h1));
      ctx.lineTo(sx(bx, by), sy(bx, by, h0));
      ctx.lineTo(sx(ax, ay), sy(ax, ay, h0));
      ctx.closePath();
      if (!kind || !st) {
        ctx.strokeStyle = rgb(st?.line ?? STAKE_LINE, 1, alpha);
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      const lit = faceLight(cam, bx - ax, by - ay);
      const body = kind === 'pier' ? st.riser : st.post;
      ctx.fillStyle = rgb(body, lit, alpha);
      ctx.fill();
      if (detail && kind === 'pier') {
        // Its courses, square across the face, from the footing up: every line already lies on the face, so nothing needs clipping to it.
        ctx.strokeStyle = rgb(st.joint, lit, 0.9);
        ctx.lineWidth = Math.max(0.6, 0.8 * z);
        ctx.beginPath();
        for (let h = h0 + COURSE; h < h1 - 0.8; h += COURSE) {
          ctx.moveTo(sx(ax, ay), sy(ax, ay, h));
          ctx.lineTo(sx(bx, by), sy(bx, by, h));
        }
        // And a joint down the middle of every other course, as the stones are laid.
        let k = 0;
        for (let h = h0; h < h1; h += COURSE, k++) {
          const t = k % 2 ? 0.3 : 0.7;
          const mx = ax + (bx - ax) * t, my = ay + (by - ay) * t;
          ctx.moveTo(sx(mx, my), sy(mx, my, h));
          ctx.lineTo(sx(mx, my), sy(mx, my, Math.min(h1, h + COURSE)));
        }
        ctx.stroke();
      } else if (detail && kind === 'post') {
        // The grain down a sawn post, and the light along its arris.
        ctx.strokeStyle = rgb(st.bar, lit * 0.92, 0.5);
        ctx.lineWidth = Math.max(0.5, 0.6 * z);
        ctx.beginPath();
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        ctx.moveTo(sx(mx, my), sy(mx, my, h1 - 1));
        ctx.lineTo(sx(mx, my), sy(mx, my, h0 + 1));
        ctx.stroke();
      }
      // Dark and wet just over the water, as far up as the post goes.
      if (p.water !== null && h0 <= p.water + 0.01) {
        const wet = Math.min(h1, h0 + 1.8);
        ctx.beginPath();
        ctx.moveTo(sx(ax, ay), sy(ax, ay, wet));
        ctx.lineTo(sx(bx, by), sy(bx, by, wet));
        ctx.lineTo(sx(bx, by), sy(bx, by, h0));
        ctx.lineTo(sx(ax, ay), sy(ax, ay, h0));
        ctx.closePath();
        ctx.fillStyle = rgb(mix(body, WET, 0.45), lit * 0.7, 0.85 * alpha);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(sx(ax, ay), sy(ax, ay, h1));
      ctx.lineTo(sx(bx, by), sy(bx, by, h1));
      ctx.lineTo(sx(bx, by), sy(bx, by, h0));
      ctx.lineTo(sx(ax, ay), sy(ax, ay, h0));
      ctx.closePath();
      ctx.strokeStyle = rgb(st.line, 1, 0.8 * alpha);
      ctx.lineWidth = Math.max(0.7, 0.9 * z);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  };

  /** A peeled pole at (cx, cy), round, from `h0` up to `h1`: lit down the side toward the light. */
  const poleOf = (cx: number, cy: number, r: number, h0: number, h1: number): void => {
    if (!st) return;
    const c = sx(cx, cy);
    const rx = r * HALF_W * Math.SQRT2 * z;
    const ry = r * HALF_H * Math.SQRT2 * z;
    const yt = sy(cx, cy, h1), yb = sy(cx, cy, h0);
    ctx.beginPath();
    ctx.moveTo(c - rx, yt);
    ctx.lineTo(c - rx, yb);
    ctx.ellipse(c, yb, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(c + rx, yt);
    ctx.closePath();
    const g = ctx.createLinearGradient(c - rx, 0, c + rx, 0);
    g.addColorStop(0, rgb(st.post, 0.78));
    g.addColorStop(0.42, rgb(st.barHi, 1.02));
    g.addColorStop(1, rgb(st.post, 0.66));
    ctx.fillStyle = g;
    ctx.fill();
    if (p.water !== null && h0 <= p.water + 0.01) {
      // Dark and wet just over the water: the foot of the pole's own outline, drawn as it is rather than clipped to it.
      const yw = Math.min(yb, sy(cx, cy, Math.min(h1, h0 + 1.8)));
      ctx.beginPath();
      ctx.moveTo(c - rx, yw);
      ctx.lineTo(c - rx, yb);
      ctx.ellipse(c, yb, rx, ry, 0, Math.PI, 0, true);
      ctx.lineTo(c + rx, yw);
      ctx.closePath();
      ctx.fillStyle = rgb(mix(st.post, WET, 0.45), 0.66, 0.85);
      ctx.fill();
      // And the outline again, which the wet band was laid over.
      ctx.beginPath();
      ctx.moveTo(c - rx, yt);
      ctx.lineTo(c - rx, yb);
      ctx.ellipse(c, yb, rx, ry, 0, Math.PI, 0, true);
      ctx.lineTo(c + rx, yt);
      ctx.closePath();
    }
    ctx.strokeStyle = rgb(st.line, 1, 0.8);
    ctx.lineWidth = Math.max(0.7, 0.9 * z);
    ctx.stroke();
    ctx.lineWidth = 1;
  };

  /** The course a stone pier stands on, a little wider than it, where it meets the ground or the water. */
  const footing = (cx: number, cy: number, f: number): void => {
    if (!st) return;
    const hw = PIER + FOOTING;
    for (const [nx, ny] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as Array<[number, number]>) {
      if (facing(cam, nx, ny) <= 0) continue;
      const [ax, ay, bx, by] = nx !== 0 ? [cx + nx * hw, cy - hw, cx + nx * hw, cy + hw] : [cx - hw, cy + ny * hw, cx + hw, cy + ny * hw];
      ctx.beginPath();
      ctx.moveTo(sx(ax, ay), sy(ax, ay, f + 2.2));
      ctx.lineTo(sx(bx, by), sy(bx, by, f + 2.2));
      ctx.lineTo(sx(bx, by), sy(bx, by, f));
      ctx.lineTo(sx(ax, ay), sy(ax, ay, f));
      ctx.closePath();
      ctx.fillStyle = rgb(p.water !== null && f <= p.water + 0.01 ? mix(st.riser, WET, 0.4) : st.riser, faceLight(cam, bx - ax, by - ay) * 0.86);
      ctx.fill();
      ctx.strokeStyle = rgb(st.line, 1, 0.75);
      ctx.lineWidth = Math.max(0.6, 0.8 * z);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  };

  /** A setting-out stake: a lath from the ground to the deck's height. */
  const stake = (cx: number, cy: number, f: number, h: number): void => {
    const w = Math.max(1, 1.6 * z);
    const x = sx(cx, cy);
    ctx.fillStyle = rgb(STAKE);
    ctx.strokeStyle = rgb(STAKE_LINE);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(x - w, sy(cx, cy, h), 2 * w, sy(cx, cy, f) - sy(cx, cy, h));
    ctx.fill();
    ctx.stroke();
  };

  /* ---- The sides: bracing, or an arcade ---- */
  const side = (i: number, back: boolean): void => {
    if (!p.open[i] || !st || !done) return;
    const a = i, b = (i + 1) % 4;
    const Ax = X0 + CORNER[a][0], Ay = Y0 + CORNER[a][1], Bx = X0 + CORNER[b][0], By = Y0 + CORNER[b][1];
    /** A point `t` along the side at height `h`, on the screen. */
    const P = (t: number, h: number): [number, number] => {
      const wx = Ax + (Bx - Ax) * t, wy = Ay + (By - Ay) * t;
      return [sx(wx, wy), sy(wx, wy, h)];
    };
    /** The ground, or the water, along the side. */
    const g = (t: number): number => footAt(Ax + (Bx - Ax) * t, Ay + (By - Ay) * t);
    /** Between the two posts, from the inner face of one to the inner face of the other. */
    const t0 = p.open[(i + 3) % 4] ? 2 * hw : hw, t1 = 1 - (p.open[(i + 1) % 4] ? 2 * hw : hw);
    const tall = top - Math.min(g(t0), g(t1));
    if (tall < 4) return;
    const lit = faceLight(cam, Bx - Ax, By - Ay) * (back ? 0.78 : 1);
    /** The side's outline down to the ground along it, for a clip. */
    const outline = (): void => {
      ctx.beginPath();
      const [x0, y0] = P(0, top);
      ctx.moveTo(x0, y0);
      const [x1, y1] = P(1, top);
      ctx.lineTo(x1, y1);
      for (let k = 8; k >= 0; k--) {
        const [x, y] = P(k / 8, g(k / 8));
        ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    if (stone) arcade(P, g, t0, t1, lit);
    else frame(P, g, outline, t0, t1, lit);
  };

  /** Timber: a girt under the deck and crossed braces below it, in as many tiers as the height asks for. */
  const frame = (P: (t: number, h: number) => [number, number], g: (t: number) => number, outline: () => void, t0: number, t1: number, lit: number): void => {
    if (!st) return;
    const tall = top - Math.min(g(t0), g(t1));
    const tiers = tall > 44 ? 3 : tall > 24 ? 2 : 1;
    const step = tall / tiers;
    ctx.save();
    outline();
    ctx.clip();
    const member = (x0: number, y0: number, x1: number, y1: number, width: number, hi: boolean): void => {
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = rgb(st.line, 1, 0.85);
      ctx.lineWidth = width + Math.max(1, 1.2 * z);
      ctx.stroke();
      ctx.strokeStyle = rgb(hi ? st.barHi : st.bar, lit);
      ctx.lineWidth = width;
      ctx.stroke();
    };
    const bw = Math.max(1.2, BRACE * z);
    const gw = Math.max(1.5, GIRT * z);
    for (let k = 0; k < tiers; k++) {
      const hi = top - k * step, lo = top - (k + 1) * step;
      for (const [a, b] of [[t0, t1], [t1, t0]] as Array<[number, number]>) {
        const h0 = hi - 1.2, h1 = Math.max(lo, g(b)) + 1;
        if (h0 - h1 < 3) continue;
        const [x0, y0] = P(a, h0), [x1, y1] = P(b, h1);
        member(x0, y0, x1, y1, bw, false);
      }
      // The girt the tier hangs from, post face to post face: under the deck at the top, and between each two tiers below.
      const [gx0, gy0] = P(t0, hi - (k ? 0 : 0.6)), [gx1, gy1] = P(t1, hi - (k ? 0 : 0.6));
      member(gx0, gy0, gx1, gy1, gw, true);
    }
    ctx.restore();
  };

  /** Stone: the wall carried over a round arch between the two piers, or a low wall where no arch fits. */
  const arcade = (P: (t: number, h: number) => [number, number], g: (t: number) => number, t0: number, t1: number, lit: number): void => {
    if (!st) return;
    const crown = top - BAND;
    const room = crown - Math.max(g(t0), g(t1));
    const mid = (t0 + t1) / 2, span = (t1 - t0) / 2;
    const half = span * UNITS_PER_TILE;
    const arched = room >= 6;
    const rise = arched ? Math.min(half, room - 3) : 0;
    const spring = crown - rise;
    /** The arch's curve, `u` from its right springing (0) over the crown to its left (1), `out` past its soffit. */
    const arc = (u: number, out = 0): [number, number] => {
      const th = u * Math.PI;
      return P(mid + (span + out / UNITS_PER_TILE) * Math.cos(th), spring + (rise + out) * Math.sin(th));
    };
    const N = 14;
    // The face: over the arch from pier to pier, or all the way down to the ground.
    const body = (): void => {
      ctx.beginPath();
      const [a0, b0] = P(t0, top);
      ctx.moveTo(a0, b0);
      const [a1, b1] = P(t1, top);
      ctx.lineTo(a1, b1);
      if (arched) {
        const [a2, b2] = P(t1, spring);
        ctx.lineTo(a2, b2);
        for (let k = 0; k <= N; k++) {
          const [x, y] = arc(k / N);
          ctx.lineTo(x, y);
        }
      } else {
        for (let k = 8; k >= 0; k--) {
          const t = t0 + (t1 - t0) * (k / 8);
          const [x, y] = P(t, g(t));
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
    };
    body();
    ctx.fillStyle = rgb(st.riser, lit);
    ctx.fill();
    if (detail && st.courses > 0) {
      ctx.save();
      body();
      ctx.clip();
      ctx.strokeStyle = rgb(st.joint, lit, 0.85);
      ctx.lineWidth = Math.max(0.6, 0.8 * z);
      ctx.beginPath();
      let k = 0;
      for (let h = top - COURSE; h > Math.min(g(t0), g(t1)); h -= COURSE, k++) {
        const [x0, y0] = P(t0, h), [x1, y1] = P(t1, h);
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        // The perpends, broken joint on each course.
        for (let q = (k % 2 ? 0.25 : 0.5); q < 1; q += 0.5) {
          const t = t0 + (t1 - t0) * q;
          const [px, py] = P(t, h), [, qy] = P(t, h + COURSE);
          ctx.moveTo(px, py);
          ctx.lineTo(px, qy);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
    if (arched) {
      // The ring of voussoirs round the opening, dressed, with the joints running to the arch's middle.
      ctx.beginPath();
      for (let k = 0; k <= N; k++) {
        const [x, y] = arc(k / N);
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (let k = N; k >= 0; k--) {
        const [x, y] = arc(k / N, RING);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = rgb(st.nose, lit * 0.94);
      ctx.fill();
      ctx.strokeStyle = rgb(st.line, 1, 0.8);
      ctx.lineWidth = Math.max(0.7, 0.9 * z);
      ctx.stroke();
      if (detail) {
        ctx.beginPath();
        const stones = 9;
        for (let k = 1; k < stones; k++) {
          const [x0, y0] = arc(k / stones), [x1, y1] = arc(k / stones, RING);
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
        }
        ctx.strokeStyle = rgb(st.joint, lit, 0.9);
        ctx.lineWidth = Math.max(0.6, 0.8 * z);
        ctx.stroke();
      }
    }
    // The face's outline, the line every block is drawn in.
    body();
    ctx.strokeStyle = rgb(st.line, 1, 0.8);
    ctx.lineWidth = Math.max(0.7, 0.9 * z);
    ctx.stroke();
    ctx.lineWidth = 1;
  };

  /* ---- In order, back to front ---- */
  const faces = [0, 1, 2, 3].map((i) => facing(cam, OUT[i][0], OUT[i][1]));
  for (let i = 0; i < 4; i++) if (faces[i] < 0) side(i, true);
  /** Whether a corner has a near side beside it: its post goes in front of that side. */
  const nearBeside = (i: number): boolean => faces[i] > 0 || faces[(i + 3) % 4] > 0;
  for (let i = 0; i < 4; i++) if (!nearBeside(i)) post(i);
  for (let i = 0; i < 4; i++) if (faces[i] > 0) side(i, false);
  const rest = [0, 1, 2, 3].filter((i) => nearBeside(i))
    .sort((a, b) => cam.worldToScreenY(X0 + CORNER[a][0], Y0 + CORNER[a][1], 0) - cam.worldToScreenY(X0 + CORNER[b][0], Y0 + CORNER[b][1], 0));
  for (const i of rest) post(i);
}

/**
 * A deck's slab on the screen, from its top down to the underside of its
 * joists: the outline of the eight corners of the tile at the two heights, as
 * x, y pairs, round the outside.
 */
export function slabOutline(cam: Camera, x: number, y: number, top: number, bottom: number): number[] {
  const pts: Array<[number, number]> = [];
  for (const h of [top, bottom]) {
    for (const [dx, dy] of CORNER) pts.push([cam.worldToScreenX(x + dx, y + dy), cam.worldToScreenY(x + dx, y + dy, h)]);
  }
  // Andrew's monotone chain: eight points, a handful of comparisons.
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].flat();
}

/**
 * The water round the feet of piers: the water darkened round each foot, a
 * line of foam close in, breathing, and now and then a ring going out --
 * laid round the post and never over it.
 */
export function drawPierFeet(ctx: CanvasRenderingContext2D, cam: Camera, feet: readonly PierFoot[], t: number): void {
  const z = cam.zoom;
  if (z < DETAIL_FROM) return;
  const W = HALF_W * Math.SQRT2, H = HALF_H * Math.SQRT2;
  for (const f of feet) {
    const x = cam.worldToScreenX(f.wx, f.wy);
    const y = cam.worldToScreenY(f.wx, f.wy, f.h);
    const [l, tp, r, b] = f.box;
    ctx.save();
    /*
     * Everything but the post itself and the water under the decks round it:
     * one hole a clip, so that holes overlapping do not fill each other in,
     * and each clip no bigger than the widest ring, which keeps them cheap.
     */
    const rx = f.r * 2.8 * W * z + 2, ry = f.r * 2.8 * H * z + 2;
    const hole = (cut: () => void): void => {
      ctx.beginPath();
      ctx.rect(x - rx, y - ry, 2 * rx, 2 * ry);
      cut();
      ctx.clip('evenodd');
    };
    hole(() => ctx.rect(l, tp, r - l, b - tp));
    for (const q of f.under) {
      hole(() => {
        ctx.moveTo(q[0], q[1]);
        for (let k = 2; k < q.length; k += 2) ctx.lineTo(q[k], q[k + 1]);
        ctx.closePath();
      });
    }
    const ring = (k: number): void => {
      ctx.beginPath();
      ctx.ellipse(x, y, f.r * k * W * z, f.r * k * H * z, 0, 0, Math.PI * 2);
    };
    ring(1.35);
    ctx.fillStyle = 'rgba(16,52,58,0.2)';
    ctx.fill();
    if (f.lit) {
      const foam = f.sea ? [240, 250, 255] : SPRING_FOAM;
      const lap = (a: number): string => `rgba(${foam[0]},${foam[1]},${foam[2]},${a.toFixed(3)})`;
      const breathe = Math.sin(t * 1.7 + f.seed * 17);
      ring(1.3 + 0.08 * breathe);
      ctx.strokeStyle = lap((f.sea ? 0.5 : 0.36) + 0.14 * breathe);
      ctx.lineWidth = Math.max(0.8, 1.2 * z);
      ctx.stroke();
      if (z >= 1) {
        const age = (t / (2.6 + 1.4 * f.seed) + f.seed * 5) % 1;
        ring(1.4 + 1.3 * age);
        ctx.strokeStyle = lap(0.32 * (1 - age) * (1 - age));
        ctx.lineWidth = Math.max(0.7, 0.9 * z);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  ctx.lineWidth = 1;
}
