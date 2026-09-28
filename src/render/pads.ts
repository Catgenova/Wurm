/**
 * Lily pads: the one painter every pad on the water is drawn with -- the wild
 * ones a spring's pond grows by itself (`./ponds`) and the lilies and lotus
 * somebody planted (`./waterplants`), so the planted ones are the same family
 * as the wild, only grander.
 *
 * A pad is a flat green round with a notch cut out of it, lying on the water
 * with its shadow under it: its green, a darker rim, a paler middle, and close
 * in the veins running out from it; now and then one with a flower out, pink
 * round a yellow heart. Pads are handed over as six numbers each -- where on
 * the screen, how wide and how deep, which way the notch faces, and whether
 * in flower -- and laid a layer at a time for the whole list, so a line of a
 * pond's pads is a handful of fills however many there are.
 */

/** How a pad is inked: its shadow on the water, its green, its rim and veins, its paler middle; a flower's petals and heart; and half the angle of its notch, nought for a whole round. */
export interface PadInk {
  shadow: string;
  green: string;
  rim: string;
  vein: string;
  light: string;
  petal: string;
  petalLight: string;
  heart: string;
  notch: number;
}

/** A lily pad as the wild ones are, and as a planted water lily's are. */
export const PAD: PadInk = {
  shadow: 'rgba(28,110,112,0.28)',
  green: 'rgb(126,186,102)',
  rim: 'rgb(78,140,72)',
  vein: 'rgba(78,140,72,0.55)',
  light: 'rgba(170,216,128,0.55)',
  petal: 'rgb(244,166,180)',
  petalLight: 'rgb(252,212,218)',
  heart: 'rgb(248,212,96)',
  notch: 0.32,
};

/** Numbers a pad is handed over as: x, y, half width, half height, the way its notch faces, and whether it is in flower. */
export const PAD_STRIDE = 6;

/**
 * Pads `at[from .. m)`, six numbers each (`PAD_STRIDE`), at zoom `z`: the
 * shadows, then the pads and their rims, the paler middles, the veins from
 * close enough to see them, and the flowers stood up off the pads that have
 * one. Each layer is laid for all of them at once, which is right for pads
 * lying apart; `lapping` pads, laid back to front, are each laid whole over
 * the ones behind, so a clump of them laps over itself rather than showing
 * every rim through every pad, and have no flowers of this sort.
 */
export function paintPads(ctx: CanvasRenderingContext2D, at: Float64Array, m: number, z: number, ink: PadInk = PAD, from = 0, lapping = false): void {
  if (m <= from) return;
  const notch = ink.notch;
  const shape = (grow: number, dy: number, notched: boolean, lo: number, hi: number): void => {
    ctx.beginPath();
    for (let i = lo; i < hi; i += PAD_STRIDE) {
      const x = at[i];
      const y = at[i + 1] + at[i + 3] * dy;
      if (notched) {
        ctx.moveTo(x, y);
        ctx.ellipse(x, y, at[i + 2] * grow, at[i + 3] * grow, 0, at[i + 4] + notch, at[i + 4] + Math.PI * 2 - notch);
        ctx.closePath();
      } else {
        ctx.moveTo(x + at[i + 2] * grow, y);
        ctx.ellipse(x, y, at[i + 2] * grow, at[i + 3] * grow, 0, 0, Math.PI * 2);
      }
    }
  };
  // The pads from `lo` to `hi`: their green and rims, their paler middles, and close in their veins.
  const lay = (lo: number, hi: number): void => {
    shape(1, 0, notch > 0, lo, hi);
    ctx.fillStyle = ink.green;
    ctx.fill();
    ctx.strokeStyle = ink.rim;
    ctx.lineWidth = Math.max(0.7, 0.8 * z);
    ctx.stroke();
    // The paler middle, and close in the veins running out from it.
    ctx.fillStyle = ink.light;
    ctx.beginPath();
    for (let i = lo; i < hi; i += PAD_STRIDE) {
      ctx.moveTo(at[i] - at[i + 2] * 0.1 + at[i + 2] * 0.5, at[i + 1] - at[i + 3] * 0.14);
      ctx.ellipse(at[i] - at[i + 2] * 0.1, at[i + 1] - at[i + 3] * 0.14, at[i + 2] * 0.5, at[i + 3] * 0.46, 0, 0, Math.PI * 2);
    }
    ctx.fill();
    if (z >= 1.8) {
      ctx.strokeStyle = ink.vein;
      ctx.lineWidth = Math.max(0.6, 0.55 * z);
      ctx.beginPath();
      for (let i = lo; i < hi; i += PAD_STRIDE) {
        for (let v = 1; v < 6; v++) {
          const a = at[i + 4] + notch + ((Math.PI * 2 - 2 * notch) * v) / 6;
          ctx.moveTo(at[i], at[i + 1]);
          ctx.lineTo(at[i] + Math.cos(a) * at[i + 2] * 0.85, at[i + 1] + Math.sin(a) * at[i + 3] * 0.85);
        }
      }
      ctx.stroke();
    }
  };
  shape(1.04, 0.24, false, from, m);
  ctx.fillStyle = ink.shadow;
  ctx.fill();
  if (lapping) {
    for (let i = from; i < m; i += PAD_STRIDE) lay(i, i + PAD_STRIDE);
    ctx.lineWidth = 1;
    return;
  }
  lay(from, m);
  // The flowers, stood up off the pad: an outer ring of petals, a paler inner one, and the heart.
  for (const [colour, reach, size] of [[ink.petal, 0.34, 0.3], [ink.petalLight, 0.17, 0.2], [ink.heart, 0, 0.1]] as const) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    for (let i = from; i < m; i += PAD_STRIDE) {
      if (!at[i + 5]) continue;
      const r = at[i + 2];
      const x = at[i];
      const y = at[i + 1] - r * 0.28;
      const petals = reach ? 6 : 1;
      for (let k = 0; k < petals; k++) {
        const a = (k / petals) * Math.PI * 2 + at[i + 4];
        const px = x + Math.cos(a) * r * reach;
        const py = y + Math.sin(a) * r * reach * 0.55 - (reach ? r * 0.06 : 0);
        ctx.moveTo(px + r * size, py);
        ctx.ellipse(px, py, r * size, r * size * (reach ? 0.62 : 0.8), 0, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }
  ctx.lineWidth = 1;
}
