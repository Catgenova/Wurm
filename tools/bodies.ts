/**
 * Is a body kept as a picture the same body drawn out of paths?
 *
 *   npx esbuild tools/bodies.ts --bundle --format=iife --outfile=/tmp/bodies.js
 *   cp tools/bodies.html /tmp/ && chromium --headless --dump-dom file:///tmp/bodies.html
 *
 * A standing animal is drawn once into a canvas of its own and blitted
 * thereafter, which is the difference between fifty path operations a frame
 * per animal and one. The failure that would come of getting it wrong is
 * silent and visual: a box a few units too small clips a tall beast's head off
 * and nothing in the code says so. That is exactly what this caught when it
 * was first run — the ogre and the dragon were losing twenty-six pixels
 * apiece off the top, because the pad the box is measured on was shorter than
 * they are.
 *
 * So: every species, four ways round, drawn both roads and compared. The two
 * poses differ only in gait — three hundredths, which is under the threshold
 * that sends a body to the cache and lifts it by a fraction of a pixel, so the
 * drawings are the same drawing and any difference is the cache's.
 *
 * It wants a browser because it wants a canvas and the pixels back off it,
 * which is why it is a tool rather than one of the tests in `supabase/test`.
 */
import { drawCreature, spriteScaleFor } from '../src/render/sprites';
import { SPECIES } from '../src/game/creatures';

const ZOOM = 2;
const W = 420;
const H = 420;
const FOOT_X = 210;
const FOOT_Y = 330;

function shot(draw: (ctx: CanvasRenderingContext2D) => void): ImageData {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  draw(ctx);
  return ctx.getImageData(0, 0, W, H);
}

/** Where a drawing put ink, and how much of it there was. */
function box(d: ImageData): { x0: number; y0: number; x1: number; y1: number; ink: number } {
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  let ink = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d.data[(y * W + x) * 4 + 3] < 8) continue;
      ink++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1, ink };
}

const lines: string[] = [];
let worst = 0;
let off = 0;
let missing = 0;
spriteScaleFor(ZOOM);

for (const def of Object.values(SPECIES)) {
  for (const facing of [0, 2, 4, 6]) {
    const colors = def.variants[0];
    const drawn = { species: def.id, facing, phase: 0, moving: false, gait: 0.03, colors, health: 1, fleece: 1, scale: 1 } as never;
    const live = shot((ctx) => drawCreature(ctx, FOOT_X, FOOT_Y, ZOOM, drawn));
    const still = { ...(drawn as object), gait: 0 } as never;
    // Twice, so the second is certainly the picture rather than the first draw.
    shot((ctx) => drawCreature(ctx, FOOT_X, FOOT_Y, ZOOM, still));
    const kept = shot((ctx) => drawCreature(ctx, FOOT_X, FOOT_Y, ZOOM, still));
    const a = box(live);
    const b = box(kept);
    if (b.ink === 0) {
      missing++;
      lines.push(`MISSING ${def.id} f${facing}`);
      continue;
    }
    const slip = Math.max(Math.abs(a.x0 - b.x0), Math.abs(a.x1 - b.x1), Math.abs(a.y0 - b.y0), Math.abs(a.y1 - b.y1));
    const share = b.ink / Math.max(1, a.ink);
    if (slip > worst) worst = slip;
    if (slip > 1 || share < 0.97 || share > 1.03) {
      off++;
      lines.push(`OFF ${def.id} f${facing}: drawn ${a.x0},${a.y0}-${a.x1},${a.y1} kept ${b.x0},${b.y0}-${b.x1},${b.y1} ink ${(share * 100).toFixed(0)}%`);
    }
  }
}

lines.unshift(`${Object.keys(SPECIES).length} species, four ways round each; worst edge ${worst}px, ${off} off, ${missing} missing`);
document.getElementById('out')!.textContent = lines.join('\n');
