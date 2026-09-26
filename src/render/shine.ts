import { rarityOf } from '../game/items';

/**
 * The shine on something rare, lying where anybody can walk past it.
 *
 * A rare thing has been written in its own colour in every list since the day
 * rarity went in, and on the ground it was a brown heap like any other. You
 * could walk over a fantastic hatchet and never know. So the ground says it
 * too, and says which of the three it is without anybody having to click:
 *
 *   rare        a few slow motes, and nothing else
 *   supreme     more of them, faster, over a faint bloom
 *   fantastic   more again, a bloom you can see across a field, and a slow
 *               turning star on the thing itself
 *
 * The colours are the ones the lists use, read off `RARITIES` rather than
 * written out here, so a change to one is a change to both.
 *
 * Nothing is kept between frames. Every mote's place, size and moment in its
 * own cycle comes out of a hash of where the thing is standing and which mote
 * it is, so a pile shines the same way on every machine looking at it, two
 * piles a tile apart shine differently, and there is no particle list to grow.
 */

/** How each of the three is drawn. Index by `rare`; 0 is the ordinary run of things. */
const LOOKS = [
  null,
  /** Motes, their cycle in seconds, how big they get, how far the bloom reaches, how bright it is, and whether it wears a star. */
  { motes: 4, period: 2.4, mote: 2.0, bloom: 0.95, glow: 0.13, star: 0 },
  { motes: 6, period: 1.9, mote: 2.4, bloom: 1.2, glow: 0.19, star: 0 },
  { motes: 8, period: 1.5, mote: 2.8, bloom: 1.5, glow: 0.28, star: 1 },
] as const;

/** Whether this is worth drawing a shine for at all. */
export const shines = (rare: number | undefined): boolean => !!rare && rare > 0 && rare < LOOKS.length;

/** A number in [0, 1) from three whole numbers, stable everywhere. */
function hash(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2246822519) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** '#rrggbb' to 'r, g, b', so an alpha can be put behind it. */
function channels(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/**
 * The same colour, further from grey.
 *
 * The three rarity inks are pastels, chosen to be read as text on a dark
 * panel. Out of doors they are nearly white, and a nearly white light on
 * grass is a white light: the blue one and the violet one were the same
 * sparkle. So each channel is pushed away from the brightest one, which holds
 * the hue and takes out the wash -- the pale blue comes out a real blue, the
 * lilac a violet, the sand an amber -- and the pastel is kept for the middle
 * of a mote, where it belongs.
 */
function deepen(hex: string, spread: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const top = Math.max(c[0], c[1], c[2]);
  return c.map((v) => Math.max(0, Math.round(top - (top - v) * spread))).join(', ');
}

/** A four-pointed star, tapered, centred on the origin: the one a rare thing wears, and the altar's stars (`render/furniture.ts`). */
export function star(g: CanvasRenderingContext2D, r: number, waist: number): void {
  g.beginPath();
  g.moveTo(0, -r);
  g.quadraticCurveTo(waist * 0.3, -waist * 0.3, waist, 0);
  g.quadraticCurveTo(waist * 0.3, waist * 0.3, 0, r);
  g.quadraticCurveTo(-waist * 0.3, waist * 0.3, -waist, 0);
  g.quadraticCurveTo(-waist * 0.3, -waist * 0.3, 0, -r);
  g.closePath();
}

/**
 * Lay the shine over something already drawn.
 *
 * `px`, `py` is where it stands on the ground, `w` and `h` how much room it
 * takes on screen — the motes rise through that box rather than hanging in
 * one spot, because a thing on the ground is a thing with a size.
 *
 * Drawn in `lighter`, so it adds light to whatever is under it instead of
 * painting over it: a mote crossing a dark chest brightens the chest, which
 * is what light does and what a flat dab of colour does not.
 */
export function drawShine(
  g: CanvasRenderingContext2D,
  px: number,
  py: number,
  zoom: number,
  rare: number,
  seed: number,
  time: number,
  w: number,
  h: number,
): void {
  const look = LOOKS[rare];
  if (!look) return;
  const hex = rarityOf({ rare }).colour;
  const pale = channels(hex);
  const deep = deepen(hex, 2);
  const rx = Math.max(6, w * 0.42);
  const ry = Math.max(6, h * 0.5);
  g.save();
  /*
   * The bloom, breathing, in two passes.
   *
   * One in the ordinary way, in the deep colour, which is what puts the hue on
   * the ground; one added on top in the pale colour, which is what makes it
   * light rather than paint. Either on its own is wrong: added light alone on
   * a bright field washes to white and all three rarities look the same, and
   * colour alone darkens the grass it is meant to be lighting.
   *
   * It sits at the middle of the thing's height rather than at its feet, so a
   * chest glows about its body and not about the ground it stands on.
   */
  if (look.glow > 0) {
    const breath = 0.78 + 0.22 * Math.sin(time * 1.7 + seed);
    const cy = py - ry;
    const reach = Math.max(rx, ry) * 2 * look.bloom;
    const wash = (ink: string, a: number): void => {
      const bloom = g.createRadialGradient(px, cy, 0, px, cy, reach);
      bloom.addColorStop(0, `rgba(${ink}, ${a.toFixed(3)})`);
      bloom.addColorStop(0.5, `rgba(${ink}, ${(a * 0.4).toFixed(3)})`);
      bloom.addColorStop(1, `rgba(${ink}, 0)`);
      g.fillStyle = bloom;
      g.beginPath();
      g.arc(px, cy, reach, 0, Math.PI * 2);
      g.fill();
    };
    g.globalCompositeOperation = 'source-over';
    // Weighted toward the added light, so what is under the bloom still looks
    // like itself: a supreme chest is a chest in violet light, not a violet chest.
    wash(deep, look.glow * breath * 0.55);
    g.globalCompositeOperation = 'lighter';
    wash(pale, look.glow * breath * 0.9);
  }
  /*
   * And the motes. Each one keeps its own place in the box and its own moment
   * in the cycle, drifts up through a third of the height over its life, and
   * is brightest halfway through it -- so they come and go rather than
   * blinking on and off together.
   *
   * Three stars to a mote: long spikes in the deep colour, a shorter body in
   * the pale one, and a white heart added on top, which is the only part of
   * it that is allowed to wash out, because the middle of a light is white.
   */
  for (let i = 0; i < look.motes; i++) {
    const ax = hash(seed, i, 1) * 2 - 1;
    const ay = hash(seed, i, 2);
    const phase = (time / look.period + hash(seed, i, 3)) % 1;
    // Bright in the middle of its life and gone at both ends.
    const life = Math.sin(phase * Math.PI);
    if (life <= 0.02) continue;
    const mx = px + ax * rx;
    const my = py - ay * ry - phase * ry * 0.34;
    const r = look.mote * zoom * (0.45 + life * 0.55);
    g.save();
    g.translate(mx, my);
    // A quarter turn over the life of it, so the points are never a grid.
    g.rotate(hash(seed, i, 4) * Math.PI + phase * 1.2);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgba(${deep}, ${(life * 0.9).toFixed(3)})`;
    star(g, r * 3.1, r * 0.55);
    g.fill();
    g.fillStyle = `rgba(${pale}, ${(life * 0.95).toFixed(3)})`;
    star(g, r * 1.7, r * 0.38);
    g.fill();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = `rgba(255, 255, 255, ${(life * 0.75).toFixed(3)})`;
    star(g, r * 0.85, r * 0.2);
    g.fill();
    g.restore();
  }
  /*
   * The fantastic one wears a star as well: one slow turn every eight seconds,
   * on the thing rather than around it, so across a field you see the flare
   * before you can make out what is under it.
   */
  if (look.star) {
    const breath = 0.55 + 0.45 * Math.sin(time * 1.1 + seed * 0.7);
    const r = Math.max(rx, ry) * 0.95;
    g.save();
    g.globalCompositeOperation = 'source-over';
    g.translate(px, py - ry);
    g.rotate(time * (Math.PI / 4));
    g.fillStyle = `rgba(${deep}, ${(0.4 * breath).toFixed(3)})`;
    star(g, r, r * 0.1);
    g.fill();
    g.rotate(Math.PI / 4);
    g.fillStyle = `rgba(${pale}, ${(0.28 * breath).toFixed(3)})`;
    star(g, r * 0.62, r * 0.07);
    g.fill();
    g.restore();
  }
  g.restore();
}
