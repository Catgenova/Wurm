/**
 * A Runestone, drawn: the one door the renderer goes through for each of the
 * five (`src/game/runestones.ts`).
 *
 * What stands behind the door is a stand-in until the finished stones are
 * put behind it: a low mossy plinth over the three by three and a tall grey
 * stone with the first letter of its name cut into it, which breathes a
 * little light after dark. It is drawn where the finished one will be, at the
 * same size, sorted the same way and leaning with the camera's turn, so that
 * swapping the art in changes nothing else.
 *
 * The renderer takes a stone as one thing on the line of ground its front
 * tile is drawn on (the tile of the nine nearest the viewer), so everything
 * standing behind it is drawn before it and everything in front of it after.
 */
import { RUNESTONE_BY_ID, RUNESTONE_IDS, type RunestoneId } from '../game/runestones';
import { HALF_H, HALF_W } from './iso';

/** How tall the stone stands over its footprint's middle, and how wide it is, at zoom one, in screen pixels. */
export const RUNESTONE_TALL = 250;
export const RUNESTONE_WIDE = 78;

/** Where a stone was drawn on the screen, for the cursor to find it by (`pick`). */
export interface RunestoneBox {
  left: number;
  top: number;
  w: number;
  h: number;
}

/**
 * Draw one Runestone.
 *
 * - `id`: which of the five (`crownstone`, `mossmere`, `harrowmark`, `wardenfall`, `sunreach`).
 * - `ctx`: the canvas, as the renderer has it this frame.
 * - `sx`, `sy`: the screen point under the middle of its three by three -- the
 *   centre of its centre tile, at that tile's ground height.
 * - `zoom`: the camera's zoom, pixels to a zoom-one pixel.
 * - `turn`: the camera's turn, 0..7, an eighth of the way round each (`Camera.rotation`).
 * - `time`: seconds, for whatever moves (the runes' glow).
 * - `night`: how dark it is, 0 at noon to 1 at midnight (`Game.darkness`).
 *
 * Returns the box the standing stone covers on the screen.
 */
export function drawRunestonePiece(
  id: RunestoneId,
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  zoom: number,
  turn: number,
  time: number,
  night: number,
): RunestoneBox {
  const k = Math.max(0, RUNESTONE_IDS.indexOf(id));
  // The plinth: a low mound over the nine tiles, a little under their outline.
  const rx = HALF_W * 2.6 * zoom;
  const ry = HALF_H * 2.6 * zoom;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#8f9a78';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(sx, sy - 4 * zoom, rx * 0.82, ry * 0.82, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#a3ad8b';
  ctx.fill();
  // The stone: tall, a little narrower at the top, leaning one way or the other as the camera goes round.
  const tall = RUNESTONE_TALL * zoom * (0.92 + 0.04 * k);
  const wide = RUNESTONE_WIDE * zoom;
  const lean = ((turn % 4) - 1.5) * 4 * zoom * (k % 2 ? 1 : -1);
  const foot = sy - 6 * zoom;
  ctx.beginPath();
  ctx.moveTo(sx - wide / 2, foot);
  ctx.lineTo(sx - wide * 0.38 + lean, foot - tall * 0.94);
  ctx.quadraticCurveTo(sx + lean, foot - tall * 1.04, sx + wide * 0.38 + lean, foot - tall * 0.94);
  ctx.lineTo(sx + wide / 2, foot);
  ctx.closePath();
  const face = ctx.createLinearGradient(sx - wide / 2, 0, sx + wide / 2, 0);
  face.addColorStop(0, '#9a9a9e');
  face.addColorStop(0.55, '#b9b8bc');
  face.addColorStop(1, '#7d7c82');
  ctx.fillStyle = face;
  ctx.fill();
  ctx.lineWidth = Math.max(1, 1.5 * zoom);
  ctx.strokeStyle = 'rgba(40, 40, 48, 0.55)';
  ctx.stroke();
  // Its letter, cut in, glowing softly after dark.
  const name = RUNESTONE_BY_ID.get(id)?.name.replace(/^The /, '') ?? '?';
  const glow = 0.35 + 0.65 * Math.max(0, Math.min(1, night)) * (0.75 + 0.25 * Math.sin(time * 1.3 + k));
  ctx.font = `bold ${Math.round(46 * zoom)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgba(170, 220, 255, ${glow.toFixed(3)})`;
  ctx.shadowColor = 'rgba(140, 200, 255, 0.9)';
  ctx.shadowBlur = 12 * zoom * glow;
  ctx.fillText(name[0], sx + lean * 0.5, foot - tall * 0.55);
  ctx.restore();
  return { left: sx - wide / 2 - Math.abs(lean), top: foot - tall * 1.04, w: wide + 2 * Math.abs(lean), h: tall * 1.04 + 6 * zoom };
}
