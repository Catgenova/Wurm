/**
 * A crop's plant, drawn flat: shared by the field it grows in (`cropSprite`,
 * nine to a tile) and the planter (`MODELS.planter`, a row along the box), so
 * a planter of wheat is wheat the way a field of it is.
 */
const TAU = Math.PI * 2;

/**
 * One plant of a crop at a stage, its foot at (px, py): the shape a field is
 * drawn with nine of and a planter with a row of. Roots keep their heads down
 * and swell late, leaves spread, grain runs up into ears, herbs stay low and
 * bushy, and fibre opens into bolls; a ripe one carries its produce. `u`
 * turns a rosette's leaves, and `s` is its size, one at a field's.
 */
export function cropPlant(ctx: CanvasRenderingContext2D, px: number, py: number, look: string, stage: number, leaf: string, fruit: string, u = 0, s = 1): void {
  const grown = stage / 3;
  const h = (look === 'grain' ? 10 : look === 'leaf' ? 6 : 5) * (0.45 + grown * 0.85) * s;
  const w = (look === 'leaf' ? 7 : 4.5) * (0.5 + grown * 0.7) * s;
  ctx.lineCap = 'round';
  ctx.strokeStyle = leaf;
  ctx.fillStyle = leaf;
  if (look === 'grain') {
    // A stalk with an ear on top once it is up.
    ctx.lineWidth = 1.3 * s;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(px + 1 * s, py - h * 0.6, px + 1.6 * s, py - h);
    ctx.stroke();
    if (stage >= 2) {
      ctx.fillStyle = stage === 3 ? fruit : leaf;
      ctx.beginPath();
      ctx.ellipse(px + 1.8 * s, py - h - 1.6 * s, 1.7 * s, 3.4 * (stage === 3 ? 1.15 : 0.8) * s, 0.2, 0, TAU);
      ctx.fill();
    }
  } else if (look === 'leaf') {
    // A rosette of broad leaves, closing into a head when ripe.
    const blades = 5;
    for (let i = 0; i < blades; i++) {
      const a = (i / blades) * TAU + u;
      ctx.beginPath();
      ctx.ellipse(px + Math.cos(a) * w * 0.35, py - h * 0.35 + Math.sin(a) * w * 0.18, w * 0.5, h * 0.32, a * 0.3, 0, TAU);
      ctx.fill();
    }
    if (stage === 3) {
      ctx.fillStyle = fruit;
      ctx.beginPath();
      ctx.ellipse(px, py - h * 0.55, w * 0.42, h * 0.42, 0, 0, TAU);
      ctx.fill();
    }
  } else if (look === 'fibre') {
    ctx.lineWidth = 1.2 * s;
    for (const d of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + d * 2 * s, py - h * 0.6, px + d * 3.4 * s, py - h);
      ctx.stroke();
    }
    if (stage === 3) {
      ctx.fillStyle = fruit;
      for (const d of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(px + d * 3.2 * s, py - h - 0.5 * s, 2.2 * s, 0, TAU);
        ctx.fill();
      }
    }
  } else {
    // Roots and herbs: a low tuft, with the crop showing at the soil when ripe.
    ctx.lineWidth = 1.4 * s;
    for (const d of [-1.2, 0, 1.2]) {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + d * 1.6 * s, py - h * 0.7, px + d * 2.6 * s, py - h);
      ctx.stroke();
    }
    if (stage === 3) {
      ctx.fillStyle = fruit;
      if (look === 'root') {
        ctx.beginPath();
        ctx.ellipse(px, py + 0.6 * s, 3.2 * s, 2.1 * s, 0, 0, TAU);
        ctx.fill();
      } else {
        for (const d of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(px + d * 2.2 * s, py - h * 0.75, 1.5 * s, 0, TAU);
          ctx.fill();
        }
      }
    }
  }
}

