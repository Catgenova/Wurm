/**
 * What somebody just said, in a bubble over their head.
 *
 * Its own module rather than a method on the renderer, for two reasons. It is
 * drawn rather than cached as a sprite — what is in one differs every time, so
 * a cache keyed on the words would hold one entry per thing anybody has ever
 * typed — and a thing that is drawn fresh every frame is a thing worth being
 * able to draw on its own and look at, which is how the nine ages of one were
 * checked rather than by hoping somebody typed something in a running game.
 *
 * It takes the age of a line rather than the moment it was said for the same
 * reason.
 */

/** Seconds a bubble hangs about before a word of it is counted. */
export const SAY_LIFE = 4;
/** And what each character of it is worth on top, so a long line is readable. */
export const SAY_LIFE_PER_CHAR = 0.055;
/** However long it is, it is gone by here. */
export const SAY_LIFE_CAP = 9;
/** Seconds it spends going. */
export const SAY_FADE = 0.9;
/** How wide a bubble gets at zoom 1 before it wraps. */
export const SAY_WIDTH = 116;
/** And how many lines it wraps to before the rest is an ellipsis. */
export const SAY_LINES = 3;

/** How long a bubble carrying these words lasts, in seconds. */
export const sayLife = (text: string): number =>
  Math.min(SAY_LIFE_CAP, SAY_LIFE + text.length * SAY_LIFE_PER_CHAR);

export function drawSpeech(ctx: CanvasRenderingContext2D, zoom: number, sx: number, sy: number, text: string, age: number): void {
  // Too small to read is not worth the clutter.
  if (zoom < 0.55) return;
  // Long enough to read what is in it, and no longer.
  const life = sayLife(text);
  if (age < 0 || age > life) return;
  const fade = Math.min(1, (life - age) / SAY_FADE);

  const size = Math.round(11 * zoom);
  ctx.save();
  ctx.font = `${size}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Wrapped by measuring, on words, to as many lines as a bubble is worth.
  const max = SAY_WIDTH * zoom;
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > max) {
      lines.push(line);
      line = word;
      if (lines.length === SAY_LINES) break;
    } else {
      line = next;
    }
  }
  if (lines.length < SAY_LINES && line) lines.push(line);
  if (!lines.length) {
    ctx.restore();
    return;
  }
  // Whatever would not fit says so on the last line rather than stopping mid
  // sentence as though the island had cut somebody off.
  const said = lines.join(' ');
  if (said.length < text.length) lines[lines.length - 1] = `${lines[lines.length - 1]}…`;

  const pad = 5 * zoom;
  const step = size * 1.25;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const h = lines.length * step + pad * 2 - (step - size);
  const left = sx - w / 2;
  const top = sy - h;
  const r = 5 * zoom;
  const tail = 5 * zoom;

  ctx.globalAlpha = fade;
  ctx.beginPath();
  ctx.moveTo(left + r, top);
  ctx.arcTo(left + w, top, left + w, top + h, r);
  ctx.arcTo(left + w, top + h, left, top + h, r);
  // The tail, cut out of the bottom edge on the way back along it.
  ctx.lineTo(sx + tail, top + h);
  ctx.lineTo(sx, top + h + tail);
  ctx.lineTo(sx - tail, top + h);
  ctx.arcTo(left, top + h, left, top, r);
  ctx.arcTo(left, top, left + w, top, r);
  ctx.closePath();
  ctx.fillStyle = 'rgba(248,246,238,0.94)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(28,30,36,0.55)';
  ctx.lineWidth = Math.max(1, zoom);
  ctx.stroke();

  ctx.fillStyle = '#20242c';
  lines.forEach((l, i) => ctx.fillText(l, left + pad, top + pad + size + i * step));
  ctx.restore();
}
