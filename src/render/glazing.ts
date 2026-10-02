/**
 * A roof of glass, painted: panes lapped down the slope between glazing bars.
 *
 * Laid on a roof's faces the way a covering is (`roofing.ts`): a picture two
 * tiles by two, repeating both ways, fixed to the world with its courses
 * counted up from the eave -- so its bars run straight down every slope from
 * the ridge to the gutter and a hip or a valley cuts across them the way it
 * does on a glasshouse. What is different is that most of it is not there:
 * a pane is a pale tint over whatever stands under it, so the crops and the
 * floor show through, and only the frame is solid.
 *
 * Four pictures, each at the three sizes the zoom chooses from:
 *
 *   * the panes, a tint of pale sea-green glass with the sky in the head of
 *     each pane and a lap line at its foot, laid more or less thick by how
 *     squarely a face takes the light (`glassFace`);
 *   * the frame: a glazing bar every sixth of a tile, painted timber, lit
 *     along one edge and shaded along the other, and a purlin every tile seen
 *     through the glass under them;
 *   * the glint: bright streaks across the panes along one diagonal, laid
 *     over a face as strongly as it throws the sun back at the eye;
 *   * the glow: the panes lit warm from inside, laid over at night where a
 *     light burns under them, the bars left dark across it.
 */
import { COVER_PPT, COVER_TILES, mipsOf } from './roofing';

type Ctx = CanvasRenderingContext2D;

/** The picture's side, in pixels at the finest size. */
const S = COVER_PPT * COVER_TILES;
/** Glazing bars across the picture: six to a tile, about two thirds of a metre apart. */
const BARS = 6 * COVER_TILES;
/** How wide a bar is, in pixels at the finest size: some seven centimetres. */
const BAR_W = 6;
/** Panes down the slope: lapped every third of a tile. */
const LAPS = 3 * COVER_TILES;
/** The painted timber of the frame, and its two edges. */
const FRAME: readonly [number, number, number] = [239, 236, 227];
const FRAME_LIT: readonly [number, number, number] = [255, 255, 252];
const FRAME_INK: readonly [number, number, number] = [112, 116, 112];
/** Glass: four tints of it, a pane of each here and there, and the sky it throws back. */
const TINTS: ReadonlyArray<readonly [number, number, number]> = [[226, 241, 238], [232, 243, 243], [221, 237, 230], [236, 243, 241]];
const SKY: readonly [number, number, number] = [246, 251, 252];
/** The warm of a light behind the glass. */
const WARM: readonly [number, number, number] = [255, 166, 78];

const rand = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const canvas = (w: number, h: number): [HTMLCanvasElement, Ctx] => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as Ctx];
};
const rgba = (c: readonly number[], a: number): string => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a.toFixed(3)})`;

/** The left edge of bar `i`, and of the pane to its right. */
const barX = (i: number): number => (i * S) / BARS - BAR_W / 2;
const PANE_W = S / BARS - BAR_W;
const PANE_H = S / LAPS;

/** Every pane of the picture: its box, and a roll of its own. */
function eachPane(draw: (x: number, y: number, w: number, h: number, r: () => number) => void): void {
  for (let j = 0; j < LAPS; j++) {
    for (let i = 0; i < BARS; i++) draw(barX(i) + BAR_W, j * PANE_H, PANE_W, PANE_H, rand(i * 7919 + j * 104729 + 17));
  }
}

/**
 * The panes: pale glass, the head of each in the sky it throws back, a line of
 * light along its lapped foot and the shadow of the pane over it under that.
 * Drawn at full strength; a face lays it at the share its light gives it.
 */
function panes(): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  eachPane((x, y, w, h, r) => {
    const tint = TINTS[Math.floor(r() * TINTS.length)];
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, rgba(SKY, 0.85));
    grad.addColorStop(0.35, rgba(tint, 0.5));
    grad.addColorStop(1, rgba(tint, 0.34));
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    // An old pane is never quite flat: a faint ripple of light across one here and there.
    if (r() < 0.3) {
      g.fillStyle = rgba(SKY, 0.35);
      const yy = y + h * (0.2 + r() * 0.5);
      g.beginPath();
      g.moveTo(x, yy + 6);
      g.lineTo(x + w, yy - 4);
      g.lineTo(x + w, yy + 1);
      g.lineTo(x, yy + 11);
      g.closePath();
      g.fill();
    }
    // The lap: the pane above lies over this one's head, a line of light along its edge and its shadow under that.
    g.fillStyle = rgba([255, 255, 255], 0.75);
    g.fillRect(x, y, w, 2);
    g.fillStyle = rgba([60, 84, 92], 0.35);
    g.fillRect(x, y + 2, w, 2);
  });
  return c;
}

/**
 * The frame: a purlin every tile, seen through the glass, and over it a
 * glazing bar every sixth of a tile down the slope, lit along its left edge.
 * Unshaded; a face shades it as it shades the panes.
 */
function frame(): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  // Purlins, under the glass, so paler and softer than the bars over them.
  for (let k = 0; k < COVER_TILES; k++) {
    const y = k * COVER_PPT + COVER_PPT * 0.5 - 4;
    g.fillStyle = rgba(FRAME, 0.55);
    g.fillRect(0, y, S, 8);
    g.fillStyle = rgba(FRAME_INK, 0.3);
    g.fillRect(0, y + 8, S, 2);
  }
  for (let i = 0; i <= BARS; i++) {
    const x = barX(i);
    g.fillStyle = rgba(FRAME, 1);
    g.fillRect(x, 0, BAR_W, S);
    g.fillStyle = rgba(FRAME_LIT, 1);
    g.fillRect(x + 0.8, 0, 1.6, S);
    g.fillStyle = rgba(FRAME_INK, 0.45);
    g.fillRect(x + BAR_W - 1.8, 0, 1.8, S);
    // The dark line round it, as everything in the world has one.
    g.fillStyle = rgba(FRAME_INK, 0.6);
    g.fillRect(x - 1, 0, 1.1, S);
    g.fillRect(x + BAR_W - 0.1, 0, 1.1, S);
  }
  return c;
}

/**
 * The glint: streaks of sun across the panes along one diagonal of the
 * picture, where the sun comes off a slope into the eye. A band of them, so a
 * run of panes lights up together as a pane of a real roof does.
 */
function glint(): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  eachPane((x, y, w, h, r) => {
    // How near the pane is to the band, which crosses the picture corner to corner and repeats with it.
    const u = ((x + w / 2 + (y + h / 2) * 0.75) / S) % 1;
    const near = Math.max(0, 1 - Math.min(Math.abs(u - 0.35), Math.abs(u - 0.35 + 1), Math.abs(u - 0.35 - 1)) / 0.2);
    if (near <= 0) return;
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    // The whole pane brightens with the sun on it, most in the middle of the band.
    g.fillStyle = rgba([255, 255, 255], 0.5 * near * near);
    g.fillRect(x, y, w, h);
    for (let k = 0; k < 2; k++) {
      if (r() > 0.8) continue;
      const off = h * (0.15 + 0.45 * k + r() * 0.2);
      const t = 9 + r() * 10;
      const grad = g.createLinearGradient(x, y + off, x + w, y + off - w * 0.8);
      grad.addColorStop(0, rgba([255, 255, 255], 0.2 * near));
      grad.addColorStop(0.5, rgba([255, 255, 255], near));
      grad.addColorStop(1, rgba([255, 255, 255], 0.35 * near));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x, y + off + t);
      g.lineTo(x + w, y + off - w * 0.8 + t);
      g.lineTo(x + w, y + off - w * 0.8);
      g.lineTo(x, y + off);
      g.closePath();
      g.fill();
    }
    g.restore();
  });
  return c;
}

/** The glow: every pane lit warm from inside, brightest at its middle; the bars and laps left out, dark across it. */
function glow(): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  eachPane((x, y, w, h, r) => {
    const grad = g.createRadialGradient(x + w / 2, y + h * 0.55, 0, x + w / 2, y + h * 0.55, Math.max(w, h) * 0.75);
    const a = 0.8 + r() * 0.2;
    grad.addColorStop(0, rgba(WARM, a));
    grad.addColorStop(1, rgba(WARM, a * 0.35));
    g.fillStyle = grad;
    g.fillRect(x, y + 4, w, h - 4);
  });
  return c;
}

interface Glass {
  panes: HTMLCanvasElement[];
  frame: HTMLCanvasElement[];
  glint: HTMLCanvasElement[];
  glow: HTMLCanvasElement[];
}
let made: Glass | null = null;
/** The four pictures, each at its three sizes, made the first time glass is drawn. */
export function glass(): Glass {
  if (!made) made = { panes: mipsOf(panes()), frame: mipsOf(frame()), glint: mipsOf(glint()), glow: mipsOf(glow()) };
  return made;
}

/**
 * How thick the glass lies on a face lit at `lit`, on the scale the roof's
 * faces are lit on (about 0.55 turned away to 1.1 square to the light): a pane
 * throws back more of the sky the more squarely it faces it, and one turned
 * away is nearly clear.
 */
export const glassReflects = (lit: number): number => Math.max(0.18, Math.min(0.5, 0.18 + (lit - 0.6) * 0.64));

/**
 * A slope seen from under it, through the glass in front of it: its frame
 * alone, in the shade its underside is in. The renderer lays it thinner still.
 */
export function glassBack(lit: number, mip: number): HTMLCanvasElement {
  const src = glass().frame[mip];
  const [c, g] = canvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = `rgba(52, 64, 82, ${Math.min(0.6, 0.3 + Math.max(0, 1 - lit) * 0.6).toFixed(3)})`;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/** How much thicker the panes are laid at each size: shrunk, a pane's tint averages out against the clear laps and bars, so the two smaller sizes lay it on thicker to read as glass. */
const MIP_TINT = [1, 1.2, 1.45];

/**
 * One face's glass, at size `mip`: its panes as thick as its light lays them,
 * and its frame in its light. What the renderer makes a pattern of and lays on
 * the face's plane.
 */
export function glassFace(lit: number, mip: number): HTMLCanvasElement {
  const pics = glass();
  const src = pics.panes[mip];
  const [c, g] = canvas(src.width, src.height);
  g.globalAlpha = Math.min(0.8, glassReflects(lit) * (MIP_TINT[mip] ?? 1));
  g.drawImage(src, 0, 0);
  g.globalAlpha = 1;
  // The frame, shaded as a wall facing that way is: toward white in the light, toward slate in the shade.
  const [f, fg] = canvas(src.width, src.height);
  fg.drawImage(pics.frame[mip], 0, 0);
  fg.globalCompositeOperation = 'source-atop';
  if (lit < 1) {
    fg.fillStyle = `rgba(52, 64, 82, ${Math.min(0.5, (1 - lit) * 0.9).toFixed(3)})`;
    fg.fillRect(0, 0, f.width, f.height);
  } else {
    fg.fillStyle = `rgba(255, 252, 240, ${Math.min(0.3, (lit - 1) * 1.2).toFixed(3)})`;
    fg.fillRect(0, 0, f.width, f.height);
  }
  g.drawImage(f, 0, 0);
  return c;
}
