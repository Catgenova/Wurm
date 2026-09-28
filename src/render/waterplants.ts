/**
 * Water lilies and lotus somebody planted, as they are drawn: the wild pads'
 * own family (`./pads`), grander.
 *
 * A planted water lily is a clump of the wild pads' round notched pads, the
 * same green, rim, paler middle and veins, and in its flowering seasons white
 * or pink cups standing up off them: an outer ring of pointed petals, a
 * paler inner ring, and a yellow heart. A lotus holds its round leaves up on
 * stalks over the water, one or two more floating, and in summer stands tall
 * pink flowers over them, and seed heads in autumn. The flowers open by day
 * and close at night into buds. What is picked is gone until its season comes
 * round again; in winter only the root is left, a shadow under the water.
 * Each is drawn from what `waterPlantState` says it is at this moment, the
 * same on every page and on the island, and laid out from its tile and
 * nothing else, so it never moves.
 *
 * What lies on the water -- the pads, a water lily's cups, a lotus's floating
 * leaves -- goes down after the water on its line of the ground (`flat`); a
 * lotus's stalks, raised leaves, flowers and seed heads stand up among
 * whatever else stands there, sorted with it (`upright`). Below `DETAIL_FROM`
 * they are their shapes and colours.
 */
import type { Camera } from '../engine/camera';
import { hash2 } from '../world/noise';
import { WATER_PLANT_BY_ID, WATER_ROOTING, waterPlantState, type WaterPlant, type WaterPlantState } from '../world/waterplants';
import { DETAIL_FROM } from './falls';
import { HALF_H, HALF_W } from './iso';
import { PAD, PAD_STRIDE, paintPads, type PadInk } from './pads';

/** How far a circle a tile in radius on the ground reaches on screen at zoom one, to either side and up and down. */
const DISC_W = HALF_W * Math.SQRT2;
const DISC_H = HALF_H * Math.SQRT2;

/** What a frame of them is drawn with. */
export interface PlantFrame {
  cam: Camera;
  /** The drawing clock, in seconds: what the pads ride and the flowers sway by. */
  t: number;
  /** The wall clock, in epoch seconds: what the island's year and the plants go by. */
  now: number;
  /** How dark it has got, nought to one: the flowers close as it comes on. */
  dark: number;
  /** The top of the water on a tile, as it is drawn, or null where there is none: a plant whose water has gone lies in the mud. */
  surface: (x: number, y: number) => number | null;
  /** The ground at a point, where the water has gone. */
  ground: (x: number, y: number) => number;
}

/** How open the flowers are at a darkness: wide by day, shut by night, closing through the dusk. */
export const openAt = (dark: number): number => Math.max(0, Math.min(1, (0.62 - dark) / 0.4));

/** A lotus leaf's colours, the bluer green of its family; and a pad in the autumn, going over. */
const LOTUS: PadInk = { ...PAD, green: 'rgb(122,182,124)', rim: 'rgb(72,134,86)', vein: 'rgba(72,134,86,0.5)', light: 'rgba(176,220,160,0.6)', notch: 0 };
const PAD_AUTUMN: PadInk = { ...PAD, green: 'rgb(164,176,92)', rim: 'rgb(118,122,62)', vein: 'rgba(118,122,62,0.5)', light: 'rgba(214,206,126,0.55)' };
const LOTUS_AUTUMN: PadInk = { ...LOTUS, green: 'rgb(156,168,100)', rim: 'rgb(112,114,68)', vein: 'rgba(112,114,68,0.5)', light: 'rgba(206,198,132,0.55)' };
/** Pads left lying in the mud where the water has gone. */
const PAD_MUD: PadInk = { ...PAD, shadow: 'rgba(60,48,30,0.25)', green: 'rgb(132,146,86)', rim: 'rgb(92,98,58)', light: 'rgba(170,176,112,0.5)', notch: PAD.notch };
/** The root in winter, a shadow under the water. */
const ROOT = 'rgba(40,62,40,0.26)';
/** A stalk, and a lotus leaf's shadow on the water under it. */
const STALK = 'rgb(96,140,82)';
const STALK_AUTUMN = 'rgb(140,134,78)';
const LEAF_SHADOW = 'rgba(28,110,112,0.22)';

/** A flower's petals, their deeper shade and tips, the line round them, and its heart. */
interface Bloom {
  petal: string;
  shade: string;
  tip: string;
  line: string;
  heart: string;
}
const WHITE: Bloom = { petal: 'rgb(250,248,240)', shade: 'rgb(226,220,204)', tip: 'rgb(255,255,252)', line: 'rgba(150,140,120,0.7)', heart: 'rgb(248,208,84)' };
const PINK: Bloom = { petal: 'rgb(246,170,188)', shade: 'rgb(226,122,152)', tip: 'rgb(252,214,222)', line: 'rgba(168,78,108,0.7)', heart: 'rgb(248,212,96)' };
const LOTUS_PINK: Bloom = { petal: 'rgb(248,196,210)', shade: 'rgb(232,112,150)', tip: 'rgb(222,84,128)', line: 'rgba(156,58,96,0.72)', heart: 'rgb(236,206,96)' };
/**
 * The shape of a flower: how many petals in its outer ring, how wide each is
 * and how far it stands up off the water as a share of its length, how long
 * the inner ring's are, and whether they are tipped too. A water lily's are
 * many, narrow and lying back; a lotus's fewer, broad and standing up in a cup.
 */
interface CupForm {
  petals: number;
  wide: number;
  lift: number;
  inner: number;
  innerTip: boolean;
}
const LILY_CUP: CupForm = { petals: 9, wide: 0.3, lift: 0.45, inner: 0.62, innerTip: false };
const LOTUS_CUP: CupForm = { petals: 8, wide: 0.44, lift: 1.05, inner: 0.72, innerTip: true };

/** A seed head: its side, its flat top, the holes in it; green going brown. */
const HEAD_SIDE = 'rgb(128,150,92)';
const HEAD_TOP = 'rgb(176,188,118)';
const HEAD_HOLE = 'rgb(92,96,58)';
const HEAD_LINE = 'rgba(70,76,44,0.8)';

/** Scratch: pads to paint, six numbers each; a plant's leaves, as where, how big, which way, a number of its own and how high. */
const PADS = new Float64Array(PAD_STRIDE * 64);
const LEAF = 6;
const LEAVES = new Float64Array(LEAF * 12);
/** Scratch: where on the water each stalk of a lotus stands. */
const STALKS = new Float64Array(2 * 16);

/**
 * Where a plant's leaves are, into `LEAVES` as x and y in the world, radius
 * in tiles, the way its notch faces, a number of its own and how high over
 * the water it is held, in height units (nought for one lying on it); and how
 * many. A water lily's lie in a clump; a lotus's two or so lie on the water
 * and the rest are held up round its middle.
 */
function leavesOf(p: WaterPlant): number {
  const { x, y } = p;
  const lily = p.kind === 'lily';
  const cx = x + 0.5 + (hash2(x, y, 101) - 0.5) * 0.12;
  const cy = y + 0.5 + (hash2(x, y, 102) - 0.5) * 0.12;
  const n = lily ? 4 + Math.floor(hash2(x, y, 103) * 2) : 5 + Math.floor(hash2(x, y, 103) * 2);
  const turn = hash2(x, y, 104) * Math.PI * 2;
  let m = 0;
  for (let i = 0; i < n; i++) {
    const h = hash2(x * 7 + i, y * 7 - i, 105);
    const a = turn + (i / n) * Math.PI * 2 + (h - 0.5) * 0.8;
    // A lotus holds its raised leaves round its middle and floats the rest further out.
    const floats = lily || i < 2;
    const d = floats ? 0.12 + 0.18 * hash2(x, y, 106 + i) : 0.04 + 0.16 * hash2(x, y, 106 + i);
    const r = lily ? 0.16 + 0.09 * hash2(x, y, 120 + i) : floats ? 0.14 + 0.05 * hash2(x, y, 120 + i) : 0.15 + 0.07 * hash2(x, y, 120 + i);
    // What lies on the water keeps to its own tile, so it never lies over the bank or the rim of a pool; what is held up may lean out.
    const keep = floats ? r * 0.95 : 0.16;
    LEAVES[m++] = Math.max(x + keep, Math.min(x + 1 - keep, cx + Math.cos(a) * d));
    LEAVES[m++] = Math.max(y + keep, Math.min(y + 1 - keep, cy + Math.sin(a) * d));
    LEAVES[m++] = r;
    LEAVES[m++] = hash2(x, y, 130 + i) * Math.PI * 2;
    LEAVES[m++] = hash2(x, y, 140 + i);
    LEAVES[m++] = floats ? 0 : 4 + 7 * hash2(x, y, 150 + i);
  }
  return n;
}

/** How grown a plant is: from half its size when it goes in to all of it once it has rooted. */
const grownAt = (p: WaterPlant, now: number): number => 0.5 + 0.5 * Math.max(0, Math.min(1, (now - p.at) / WATER_ROOTING));

/** The linear map from the world to the screen this frame. */
interface Proj { ox: number; oy: number; xx: number; xy: number; yx: number; yy: number; hs: number; z: number }
const projOf = (cam: Camera): Proj => {
  const ox = cam.worldToScreenX(0, 0);
  const oy = cam.worldToScreenY(0, 0, 0);
  return {
    ox, oy, xx: cam.worldToScreenX(1, 0) - ox, xy: cam.worldToScreenX(0, 1) - ox,
    yx: cam.worldToScreenY(1, 0, 0) - oy, yy: cam.worldToScreenY(0, 1, 0) - oy, hs: oy - cam.worldToScreenY(0, 0, 1), z: cam.zoom,
  };
};
const sx = (q: Proj, x: number, y: number): number => q.ox + q.xx * x + q.xy * y;
const sy = (q: Proj, x: number, y: number, h: number): number => q.oy + q.yx * x + q.yy * y - h * q.hs;

/** Where a plant's flowers or seed heads stand: on its pads for a water lily, up among its leaves for a lotus. Into `out` as x, y, a number of its own and how high; how many. */
function bloomsOf(p: WaterPlant, n: number, out: Float64Array): number {
  const { x, y } = p;
  const many = p.kind === 'lily' ? 1 + (hash2(x, y, 161) < 0.6 ? 1 : 0) + (hash2(x, y, 162) < 0.25 ? 1 : 0) : 1 + (hash2(x, y, 161) < 0.45 ? 1 : 0);
  let m = 0;
  for (let i = 0; i < many; i++) {
    const k = Math.floor(hash2(x, y, 163 + i) * n) * LEAF;
    const h = hash2(x, y, 170 + i);
    if (p.kind === 'lily') {
      out[m++] = LEAVES[k] + (h - 0.5) * LEAVES[k + 2] * 0.5;
      out[m++] = LEAVES[k + 1] + (hash2(x, y, 175 + i) - 0.5) * LEAVES[k + 2] * 0.5;
      out[m++] = h;
      out[m++] = 0.6;
    } else {
      const a = (i + 0.3 + h * 0.4) * Math.PI;
      out[m++] = x + 0.5 + Math.cos(a) * (0.05 + 0.1 * h);
      out[m++] = y + 0.5 + Math.sin(a) * (0.05 + 0.1 * h);
      out[m++] = h;
      out[m++] = 12 + 5 * hash2(x, y, 180 + i);
    }
  }
  return m / 4;
}
const BLOOMS = new Float64Array(4 * 4);

/**
 * Everything of the plants on one line of the ground that lies on the water:
 * a water lily's pads and cups, a lotus's floating leaves, and the root of
 * either under the water in winter.
 */
export function drawPlantsFlat(ctx: CanvasRenderingContext2D, plants: readonly WaterPlant[], f: PlantFrame): void {
  const q = projOf(f.cam);
  const z = q.z;
  const detail = z >= DETAIL_FROM;
  const open = openAt(f.dark);
  for (const p of plants) {
    const def = WATER_PLANT_BY_ID.get(p.kind);
    if (!def) continue;
    const st = waterPlantState(def, p.at, p.picked, f.now);
    const top = f.surface(p.x, p.y);
    const wet = top !== null;
    const level = top ?? f.ground(p.x + 0.5, p.y + 0.5);
    if (!st.leaves) {
      // Winter: the root, a shadow under the water, and nothing else.
      if (!detail) continue;
      ctx.fillStyle = ROOT;
      ctx.beginPath();
      const x = sx(q, p.x + 0.5, p.y + 0.5);
      const y = sy(q, p.x + 0.5, p.y + 0.5, level - 1.5);
      ctx.ellipse(x, y, 0.16 * DISC_W * z, 0.16 * DISC_H * z, 0, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    const grow = grownAt(p, f.now);
    const n = leavesOf(p);
    const autumn = st.season === 'autumn';
    const ink = !wet ? PAD_MUD : p.kind === 'lily' ? (autumn ? PAD_AUTUMN : PAD) : autumn ? LOTUS_AUTUMN : LOTUS;
    // Back to front, each pad whole, so a clump laps over itself rather than showing every rim through every pad.
    let m = 0;
    for (let i = 0; i < n; i++) {
      const k = i * LEAF;
      if (LEAVES[k + 5] > 0) continue;
      const bob = wet ? Math.sin(f.t * 0.9 + LEAVES[k + 4] * 6) * 0.35 * z : 0;
      PADS[m++] = sx(q, LEAVES[k], LEAVES[k + 1]);
      PADS[m++] = sy(q, LEAVES[k], LEAVES[k + 1], level) + bob;
      PADS[m++] = LEAVES[k + 2] * grow * DISC_W * z;
      PADS[m++] = LEAVES[k + 2] * grow * DISC_H * z;
      PADS[m++] = LEAVES[k + 3] + (wet ? 0.14 * Math.sin(f.t * 0.21 + LEAVES[k + 4] * 9) : 0);
      PADS[m++] = 0;
    }
    sortPads(m);
    paintPads(ctx, PADS, m, z, ink, 0, true);
    // A water lily's cups, stood on its pads.
    if (p.kind === 'lily' && st.bears === 'flower' && st.ripe && wet) {
      const b = bloomsOf(p, n, BLOOMS);
      const pink = hash2(p.x, p.y, 160) < 0.5;
      for (let i = 0; i < b; i++) {
        const k = i * 4;
        const x = sx(q, BLOOMS[k], BLOOMS[k + 1]);
        const y = sy(q, BLOOMS[k], BLOOMS[k + 1], level + BLOOMS[k + 3]) + Math.sin(f.t * 0.9 + BLOOMS[k + 2] * 6) * 0.35 * z;
        const r = (0.09 + 0.022 * BLOOMS[k + 2]) * DISC_W * z;
        const bloom = (hash2(p.x * 3 + i, p.y, 166) < 0.25) !== pink ? PINK : WHITE;
        if (detail) cup(ctx, x, y, r, open, bloom, BLOOMS[k + 2], z, LILY_CUP);
        else dot(ctx, x, y, r * 0.6, bloom.petal);
      }
    }
  }
  ctx.lineWidth = 1;
}

/** Pads in `PADS` back to front, by where they are on the screen. */
function sortPads(m: number): void {
  for (let i = PAD_STRIDE; i < m; i += PAD_STRIDE) {
    for (let j = i; j > 0 && PADS[j + 1] < PADS[j - PAD_STRIDE + 1]; j -= PAD_STRIDE) {
      for (let k = 0; k < PAD_STRIDE; k++) {
        const s = PADS[j + k];
        PADS[j + k] = PADS[j - PAD_STRIDE + k];
        PADS[j - PAD_STRIDE + k] = s;
      }
    }
  }
}

/** Where on the screen a plant stands, for sorting what of it stands up among everything else. */
export function plantFoot(p: WaterPlant, f: PlantFrame): [number, number] {
  const q = projOf(f.cam);
  const level = f.surface(p.x, p.y) ?? f.ground(p.x + 0.5, p.y + 0.5);
  return [sx(q, p.x + 0.5, p.y + 0.5), sy(q, p.x + 0.5, p.y + 0.5, level)];
}

/** Whether anything of a plant stands up off the water now: a lotus with its leaves up. */
export function standsUp(p: WaterPlant, now: number): boolean {
  const def = WATER_PLANT_BY_ID.get(p.kind);
  return p.kind === 'lotus' && !!def && waterPlantState(def, p.at, p.picked, now).leaves;
}

/**
 * What of a lotus stands up off the water: its raised leaves on their
 * stalks, and over them its flowers or seed heads on theirs, back to front.
 */
export function drawPlantUpright(ctx: CanvasRenderingContext2D, p: WaterPlant, f: PlantFrame): void {
  const def = WATER_PLANT_BY_ID.get(p.kind);
  if (!def) return;
  const st: WaterPlantState = waterPlantState(def, p.at, p.picked, f.now);
  if (!st.leaves) return;
  const q = projOf(f.cam);
  const z = q.z;
  const detail = z >= DETAIL_FROM;
  const top = f.surface(p.x, p.y);
  const wet = top !== null;
  const level = top ?? f.ground(p.x + 0.5, p.y + 0.5);
  const grow = grownAt(p, f.now);
  const autumn = st.season === 'autumn';
  const n = leavesOf(p);
  const ink = !wet ? PAD_MUD : autumn ? LOTUS_AUTUMN : LOTUS;
  const b = st.bears && st.ripe ? bloomsOf(p, n, BLOOMS) : 0;
  const sway = (seed: number, tall: number): number => Math.sin(f.t * 1.1 + seed * 7) * 0.012 * tall * z;
  // Where each raised leaf is on the screen, on the water and held up, into `PADS`; and its stalk into `STALKS`.
  let m = 0;
  let k2 = 0;
  for (let i = 0; i < n; i++) {
    const k = i * LEAF;
    if (LEAVES[k + 5] <= 0) continue;
    const lift = LEAVES[k + 5] * grow;
    const x0 = sx(q, LEAVES[k], LEAVES[k + 1]);
    const y0 = sy(q, LEAVES[k], LEAVES[k + 1], level);
    STALKS[k2++] = x0;
    STALKS[k2++] = y0;
    PADS[m++] = x0 + sway(LEAVES[k + 4], lift);
    PADS[m++] = y0 - lift * q.hs;
    PADS[m++] = LEAVES[k + 2] * grow * DISC_W * z;
    PADS[m++] = LEAVES[k + 2] * grow * DISC_H * z;
    PADS[m++] = LEAVES[k + 3];
    PADS[m++] = 0;
  }
  const leaves = m;
  for (let i = 0; i < b; i++) {
    const k = i * 4;
    const tall = BLOOMS[k + 3] * grow;
    const x0 = sx(q, BLOOMS[k], BLOOMS[k + 1]);
    const y0 = sy(q, BLOOMS[k], BLOOMS[k + 1], level);
    STALKS[k2++] = x0;
    STALKS[k2++] = y0;
    PADS[m++] = x0 + sway(BLOOMS[k + 2], tall) * 1.4;
    PADS[m++] = y0 - tall * q.hs;
    PADS[m++] = (0.1 + 0.025 * BLOOMS[k + 2]) * DISC_W * z;
    PADS[m++] = BLOOMS[k + 2];
    PADS[m++] = 0;
    PADS[m++] = 0;
  }
  if (detail) {
    // The leaves' shadows on the water under them, and every stalk, leaves' and flowers', bowed a little.
    if (wet) {
      ctx.fillStyle = LEAF_SHADOW;
      ctx.beginPath();
      for (let i = 0, j = 0; i < leaves; i += PAD_STRIDE, j += 2) {
        const rx = PADS[i + 2];
        const ry = PADS[i + 3];
        ctx.moveTo(STALKS[j] + rx * 0.98, STALKS[j + 1] + ry * 0.1);
        ctx.ellipse(STALKS[j] + rx * 0.08, STALKS[j + 1] + ry * 0.1, rx * 0.9, ry * 0.9, 0, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.strokeStyle = autumn ? STALK_AUTUMN : STALK;
    ctx.lineWidth = Math.max(0.8, 1.15 * z);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0, j = 0; i < m; i += PAD_STRIDE, j += 2) {
      const x0 = STALKS[j];
      const y0 = STALKS[j + 1];
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0 + (PADS[i] - x0) * 0.2 + 1.2 * z, (y0 + PADS[i + 1]) / 2, PADS[i], PADS[i + 1]);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  // The leaves, back to front, each lapping the one behind.
  sortPads(leaves);
  paintPads(ctx, PADS, leaves, z, ink, 0, true);
  if (detail && leaves) {
    // A lotus leaf is a shallow bowl: its near edge turned up, catching the light, and a pale eye in its middle.
    ctx.strokeStyle = ink.light;
    ctx.lineWidth = Math.max(0.8, 1.2 * z);
    ctx.beginPath();
    for (let i = 0; i < leaves; i += PAD_STRIDE) {
      const x = PADS[i];
      const y = PADS[i + 1];
      ctx.moveTo(x + Math.cos(0.25) * PADS[i + 2] * 0.86, y + Math.sin(0.25) * PADS[i + 3] * 0.8);
      ctx.ellipse(x, y, PADS[i + 2] * 0.86, PADS[i + 3] * 0.8, 0, 0.25, Math.PI - 0.25);
    }
    ctx.stroke();
    ctx.fillStyle = ink.light;
    ctx.beginPath();
    for (let i = 0; i < leaves; i += PAD_STRIDE) {
      const r = Math.max(0.8, PADS[i + 2] * 0.07);
      ctx.moveTo(PADS[i] + r, PADS[i + 1] - PADS[i + 3] * 0.05);
      ctx.ellipse(PADS[i], PADS[i + 1] - PADS[i + 3] * 0.05, r, r * 0.8, 0, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  // Over them, its flowers or its seed heads.
  const open = openAt(f.dark);
  for (let i = leaves; i < m; i += PAD_STRIDE) {
    const r = PADS[i + 2];
    if (st.bears === 'seed') seedHead(ctx, PADS[i], PADS[i + 1], r * 0.8, z, detail);
    else if (detail) cup(ctx, PADS[i], PADS[i + 1], r, open, LOTUS_PINK, PADS[i + 3], z, LOTUS_CUP);
    else dot(ctx, PADS[i], PADS[i + 1], r * 0.6, LOTUS_PINK.petal);
  }
  ctx.lineWidth = 1;
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ink: string): void {
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * A flower of `petals` pointed petals round a yellow heart, `r` across at its
 * widest, `open` of the way open: wide open it is a cup, the petals behind the
 * heart drawn first and those in front over it, and an inner ring paler and
 * more upright; shut, a bud standing up, its petals folded round it.
 */
function cup(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, open: number, b: Bloom, seed: number, z: number, form: CupForm): void {
  const petals = form.petals;
  const line = Math.max(0.6, 0.7 * z);
  if (open < 0.3) {
    // A bud: a pointed round standing on the water, two petals drawn down it.
    const h = r * 1.15;
    const w = r * 0.5;
    ctx.fillStyle = b.shade;
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.bezierCurveTo(x + w * 1.3, y - h * 0.45, x + w, y, x, y);
    ctx.bezierCurveTo(x - w, y, x - w * 1.3, y - h * 0.45, x, y - h);
    ctx.fill();
    ctx.strokeStyle = b.line;
    ctx.lineWidth = line;
    ctx.stroke();
    ctx.fillStyle = b.petal;
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.bezierCurveTo(x + w * 0.7, y - h * 0.5, x + w * 0.5, y - h * 0.05, x - w * 0.1, y);
    ctx.bezierCurveTo(x - w * 0.6, y - h * 0.25, x - w * 0.5, y - h * 0.6, x, y - h);
    ctx.fill();
    ctx.fillStyle = b.tip;
    dot(ctx, x, y - h * 0.9, Math.max(0.6, w * 0.18), b.tip);
    return;
  }
  const spread = 0.35 + 0.65 * open;
  const turn = seed * Math.PI * 2;
  // A petal from the heart out along `a` onto the path, lying back as the flower opens and standing up as it closes; or just its tip.
  const petal = (a: number, len: number, wide: number, lift: number, tip: boolean): void => {
    const ex = Math.cos(a) * len * spread;
    const ey = Math.sin(a) * len * spread * 0.55 - lift * len * (1 - spread * 0.6);
    const nx = -Math.sin(a) * wide;
    const ny = Math.cos(a) * wide * 0.55;
    if (tip) {
      ctx.moveTo(x + ex * 0.7 + nx * 0.4, y + ey * 0.7 + ny * 0.4);
      ctx.quadraticCurveTo(x + ex * 0.9, y + ey * 0.9, x + ex, y + ey);
      ctx.quadraticCurveTo(x + ex * 0.9, y + ey * 0.9, x + ex * 0.7 - nx * 0.4, y + ey * 0.7 - ny * 0.4);
      return;
    }
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + ex * 0.55 + nx, y + ey * 0.55 + ny, x + ex, y + ey);
    ctx.quadraticCurveTo(x + ex * 0.55 - nx, y + ey * 0.55 - ny, x, y);
  };
  // The outer ring a half at a time, those behind the heart first and in shade; their tips; the inner ring, paler and more
  // upright; and the heart. A few fills a flower, however many petals.
  const ring = (len: number, wide: number, lift: number, behind: boolean | null, count: number, off: number, tip: boolean): void => {
    ctx.beginPath();
    for (let k = 0; k < count; k++) {
      const a = turn + ((k + off) / count) * Math.PI * 2;
      if (behind !== null && Math.sin(a) < 0 !== behind) continue;
      petal(a, len, wide, lift, tip);
    }
  };
  ctx.lineWidth = line;
  ctx.strokeStyle = b.line;
  for (const behind of [true, false]) {
    ring(r, r * form.wide, form.lift, behind, petals, 0, false);
    ctx.fillStyle = behind ? b.shade : b.petal;
    ctx.fill();
    ctx.stroke();
  }
  ring(r, r * form.wide, form.lift, null, petals, 0, true);
  ctx.fillStyle = b.tip;
  ctx.fill();
  const inner = Math.max(5, petals - 3);
  ring(r * form.inner, r * form.wide * 0.8, form.lift + 0.6, null, inner, 0.5, false);
  ctx.fillStyle = b.petal;
  ctx.fill();
  ctx.stroke();
  if (form.innerTip) {
    ring(r * form.inner, r * form.wide * 0.8, form.lift + 0.6, null, inner, 0.5, true);
    ctx.fillStyle = b.tip;
    ctx.fill();
  }
  ctx.fillStyle = b.heart;
  ctx.beginPath();
  ctx.ellipse(x, y - r * 0.08, r * 0.16, r * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** A lotus seed head: a flat-topped cone, green going brown, the holes its seeds sit in across its top. */
function seedHead(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, z: number, detail: boolean): void {
  const tall = r * 0.7;
  ctx.fillStyle = HEAD_SIDE;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.45, y + tall * 0.5);
  ctx.lineTo(x - r, y - tall * 0.5);
  ctx.ellipse(x, y - tall * 0.5, r, r * 0.42, 0, Math.PI, 0, true);
  ctx.lineTo(x + r * 0.45, y + tall * 0.5);
  ctx.ellipse(x, y + tall * 0.5, r * 0.45, r * 0.2, 0, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
  if (detail) {
    ctx.strokeStyle = HEAD_LINE;
    ctx.lineWidth = Math.max(0.6, 0.7 * z);
    ctx.stroke();
  }
  ctx.fillStyle = HEAD_TOP;
  ctx.beginPath();
  ctx.ellipse(x, y - tall * 0.5, r, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!detail) return;
  ctx.stroke();
  ctx.fillStyle = HEAD_HOLE;
  ctx.beginPath();
  for (let k = 0; k < 7; k++) {
    const a = (k / 6) * Math.PI * 2;
    const d = k === 6 ? 0 : 0.55;
    const hx = x + Math.cos(a) * r * d;
    const hy = y - tall * 0.5 + Math.sin(a) * r * 0.42 * d;
    const hr = Math.max(0.6, r * 0.12);
    ctx.moveTo(hx + hr, hy);
    ctx.ellipse(hx, hy, hr, hr * 0.6, 0, 0, Math.PI * 2);
  }
  ctx.fill();
}
