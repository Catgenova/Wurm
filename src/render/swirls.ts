/**
 * A mote swirl: a small knot of motes turning slowly over one spot (`game/motes.ts`).
 *
 * Nine motes go round an upright ellipse about half a tile across, flattened
 * as the ground is, at heights of their own and each at its own pace, so the
 * knot never settles into a ring. What a mote is depends on the element:
 *
 *   earth  ochre and brown grains, tumbling, slow;
 *   wind   pale streaks drawn along the way they are going, quick;
 *   fire   ember sparks that rise through the knot and go out at its top;
 *   ice    pale blue splinters, standing upright;
 *   dark   violet-black wisps with a violet edge, slow;
 *   light  warm white glints that twinkle;
 *   water  blue droplets bobbing over the water's surface;
 *   life   green flecks the shape of leaves, fluttering.
 *
 * Under them a faint pool of the element's colour on the ground, and after
 * dark (`glowSwirl`) a soft glow round the knot and a glint on every mote,
 * added over the night as the fireflies are. Everything is a handful of small
 * fills: no gradient is made in a frame, the glows are pictures made once a
 * zoom and an element and stamped.
 */
import type { MoteElement } from '../game/motes';
import { SWIRL_CAST } from '../game/motes';

/** How many motes are in a knot. */
const MOTES = 9;
/** The knot's half width at zoom 1, in pixels, how far its middle floats over the ground, and how tall it is. */
const RADIUS = 15;
const LIFT = 14;
const HEIGHT = 12;
/** How the ground flattens a circle: the iso view's two to one. */
const FLAT = 0.5;

/** How each element goes round: radians a second, how much a mote bobs, and how big one is at zoom 1. */
const PACE: Record<MoteElement, { spin: number; bob: number; size: number }> = {
  earth: { spin: 0.7, bob: 1.2, size: 1.9 },
  wind: { spin: 2.1, bob: 2.2, size: 1.4 },
  fire: { spin: 1.3, bob: 0, size: 1.7 },
  ice: { spin: 0.8, bob: 1, size: 2.1 },
  dark: { spin: 0.55, bob: 2.4, size: 2.6 },
  light: { spin: 1.1, bob: 1.6, size: 2.2 },
  water: { spin: 0.9, bob: 2, size: 2 },
  life: { spin: 1, bob: 2.6, size: 2.2 },
};

/** The two tones each element's motes are drawn in, a lighter and a deeper, taken in turn. */
const TONES: Record<MoteElement, [string, string]> = {
  earth: ['#d9a654', '#8a5a2b'],
  wind: ['rgba(240,248,250,0.85)', 'rgba(200,222,232,0.75)'],
  fire: ['#ffd65e', '#ff7a1c'],
  ice: ['#e6f6ff', '#9fd2f5'],
  dark: ['rgba(58,30,84,0.92)', 'rgba(34,18,52,0.92)'],
  light: ['#fffaf0', '#ffe7a8'],
  water: ['#8fd2ff', '#3f97de'],
  life: ['#b4e27a', '#5fae3e'],
};

/**
 * How big a mote is drawn for the zoom: a little bigger than the zoom alone
 * would make it when the view is far out, so a knot at zoom 1 is still motes
 * and not a smudge, and no bigger than that close up.
 */
const moteScale = (z: number): number => 1.25 * z ** 0.8;

/**
 * How strong each element's light is after dark: the glow round the knot at
 * its middle, and a mote's glint. The whites are kept down, or a knot of them
 * is a lamp; dark adds only a little violet.
 */
const GLOW: Record<MoteElement, [number, number]> = {
  earth: [0.24, 0.75],
  wind: [0.16, 0.5],
  fire: [0.28, 0.85],
  ice: [0.2, 0.7],
  dark: [0.14, 0.45],
  light: [0.2, 0.6],
  water: [0.22, 0.75],
  life: [0.22, 0.75],
};

/** A number from 0 to 1 that a mote keeps for good: where it starts, how high it goes. */
const keep = (n: number): number => {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

/** Where a knot's mote `i` is at `t`, and how near the front of the knot it is (0 behind, 1 in front). */
interface At {
  x: number;
  y: number;
  /** Its way round, for a streak or a leaf to be drawn along, and how far out from the middle it goes, in pixels. */
  a: number;
  r: number;
  front: number;
  /** For fire, how far up its rise it is; 0..1. */
  rise: number;
}
const at: At = { x: 0, y: 0, a: 0, r: 0, front: 0, rise: 0 };

function moteAt(e: MoteElement, sx: number, sy: number, z: number, t: number, seed: number, i: number): At {
  const p = PACE[e];
  const k1 = keep(seed * 0.731 + i * 1.37);
  const k2 = keep(seed * 0.173 + i * 2.91);
  const pace = p.spin * (0.75 + 0.5 * k2);
  const a = k1 * Math.PI * 2 + t * pace;
  const r = RADIUS * z * (0.45 + 0.55 * keep(seed + i * 0.61));
  let h: number;
  at.rise = 0;
  if (e === 'fire') {
    // Sparks rise through the knot and go out at its top, each on a clock of its own.
    const u = (t * (0.35 + 0.25 * k2) + k1) % 1;
    at.rise = u;
    h = HEIGHT * z * (u * 1.5 - 0.3);
  } else {
    h = HEIGHT * z * (k2 - 0.5) + Math.sin(t * (1.3 + k1) + i) * p.bob * z;
  }
  at.x = sx + Math.cos(a) * r;
  at.y = sy - LIFT * z - h + Math.sin(a) * r * FLAT;
  at.a = a;
  at.r = r;
  at.front = 0.5 + 0.5 * Math.sin(a);
  return at;
}

/**
 * One swirl, drawn where it stands: `sx`, `sy` the ground at the middle of its
 * tile (the water's surface over water), `t` the clock in seconds, `seed`
 * anything that keeps one swirl's motes from turning in step with another's.
 */
export function drawSwirl(ctx: CanvasRenderingContext2D, sx: number, sy: number, z: number, e: MoteElement, t: number, seed: number): void {
  const [light, deep] = TONES[e];
  const p = PACE[e];
  // The faint pool of its colour under it, flat on the ground.
  ctx.fillStyle = `rgba(${SWIRL_CAST[e]}, ${e === 'dark' ? 0.16 : 0.12})`;
  ctx.beginPath();
  ctx.ellipse(sx, sy, RADIUS * z * 0.9, RADIUS * z * 0.9 * FLAT, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < MOTES; i++) {
    const m = moteAt(e, sx, sy, z, t, seed, i);
    const s = p.size * moteScale(z) * (0.7 + 0.45 * m.front);
    const tone = i % 2 ? deep : light;
    ctx.globalAlpha = 0.55 + 0.45 * m.front;
    switch (e) {
      case 'earth': {
        // A grain, turned as it tumbles.
        const q = t * 1.7 + i;
        const cx = Math.cos(q) * s, cy = Math.sin(q) * s;
        ctx.fillStyle = tone;
        ctx.beginPath();
        ctx.moveTo(m.x + cx, m.y + cy * 0.8);
        ctx.lineTo(m.x - cy, m.y + cx * 0.8);
        ctx.lineTo(m.x - cx, m.y - cy * 0.8);
        ctx.lineTo(m.x + cy, m.y - cx * 0.8);
        ctx.fill();
        break;
      }
      case 'wind': {
        // A streak trailing back along its way round, the length of a third of a turn's arc.
        const back = 0.9;
        ctx.strokeStyle = tone;
        ctx.lineWidth = Math.max(0.8, 0.7 * s);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.quadraticCurveTo(
          m.x + (Math.cos(m.a - back / 2) - Math.cos(m.a)) * m.r, m.y + (Math.sin(m.a - back / 2) - Math.sin(m.a)) * m.r * FLAT,
          m.x + (Math.cos(m.a - back) - Math.cos(m.a)) * m.r, m.y + (Math.sin(m.a - back) - Math.sin(m.a)) * m.r * FLAT);
        ctx.stroke();
        break;
      }
      case 'fire': {
        // An ember, going out as it reaches the top.
        const fade = m.rise < 0.75 ? 1 : 1 - (m.rise - 0.75) / 0.25;
        ctx.globalAlpha = fade;
        ctx.fillStyle = deep;
        ctx.beginPath();
        ctx.arc(m.x, m.y, s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.arc(m.x, m.y, s * 0.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'ice': {
        // A splinter, standing up, with a pale edge.
        ctx.fillStyle = tone;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y - s * 1.6);
        ctx.lineTo(m.x + s * 0.6, m.y);
        ctx.lineTo(m.x, m.y + s * 1.6);
        ctx.lineTo(m.x - s * 0.6, m.y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,180,230,0.9)';
        ctx.lineWidth = Math.max(0.6, 0.3 * z);
        ctx.stroke();
        break;
      }
      case 'dark': {
        // A wisp: a dark round trailing a little behind it, edged in violet.
        const tx = (Math.cos(m.a - 0.5) - Math.cos(m.a)) * RADIUS * z * 0.5;
        const ty = (Math.sin(m.a - 0.5) - Math.sin(m.a)) * RADIUS * z * 0.5 * FLAT;
        ctx.fillStyle = tone;
        ctx.beginPath();
        ctx.ellipse(m.x + tx * 0.5, m.y + ty * 0.5, s * 1.3, s * 0.85, m.a, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(160,110,220,0.75)';
        ctx.lineWidth = Math.max(0.6, 0.35 * z);
        ctx.stroke();
        break;
      }
      case 'light': {
        // A glint: four points, twinkling.
        const tw = 0.55 + 0.45 * Math.sin(t * 5 + i * 1.7 + seed);
        const l = s * (1.1 + tw);
        ctx.globalAlpha = 0.5 + 0.5 * tw;
        ctx.strokeStyle = tone;
        ctx.lineWidth = Math.max(0.7, 0.35 * z);
        ctx.beginPath();
        ctx.moveTo(m.x - l, m.y);
        ctx.lineTo(m.x + l, m.y);
        ctx.moveTo(m.x, m.y - l);
        ctx.lineTo(m.x, m.y + l);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(m.x, m.y, s * 0.45, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'water': {
        // A droplet, its point up, with a glint on it.
        ctx.fillStyle = tone;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y - s * 1.7);
        ctx.quadraticCurveTo(m.x + s * 1.1, m.y - s * 0.1, m.x, m.y + s * 0.9);
        ctx.quadraticCurveTo(m.x - s * 1.1, m.y - s * 0.1, m.x, m.y - s * 1.7);
        ctx.fill();
        ctx.fillStyle = 'rgba(230,248,255,0.9)';
        ctx.fillRect(m.x - s * 0.35, m.y - s * 0.5, Math.max(0.6, s * 0.35), Math.max(0.6, s * 0.35));
        break;
      }
      case 'life': {
        // A leaf, along the way it is going, fluttering.
        const flutter = Math.sin(t * 6 + i * 2.3) * 0.5;
        ctx.fillStyle = tone;
        ctx.beginPath();
        ctx.ellipse(m.x, m.y, s * 1.4, s * (0.55 + 0.25 * flutter), m.a + Math.PI / 2 + flutter, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }
  ctx.globalAlpha = 1;
}

/* ---- after dark ------------------------------------------------------------ */

/** The glow round a knot, and a mote's glint, as pictures made once a zoom and an element. */
const glowPics = new Map<string, HTMLCanvasElement>();
function glowPic(e: MoteElement, r: number, core: number): HTMLCanvasElement {
  const key = `${e}:${r}:${core}`;
  let cv = glowPics.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = r * 2;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  const c = SWIRL_CAST[e];
  // Falling off as a spell's light does at night: flat at the heart, nothing at the edge (`lightFall` in `spells/kit`).
  for (let s = 0; s <= 6; s++) {
    const f = s / 6;
    const u = 1 - f * f;
    grad.addColorStop(f, `rgba(${c}, ${(core * u * u).toFixed(3)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, r * 2, r * 2);
  glowPics.set(key, cv);
  return cv;
}

/**
 * One swirl's light over the night, added rather than painted: a soft glow
 * round the knot and a glint on each mote, as strong as it is dark (`dark`,
 * 0 to 1), each element as strong as `GLOW` has it. Drawn after the night is
 * laid, at the same place and clock as `drawSwirl`.
 */
export function glowSwirl(ctx: CanvasRenderingContext2D, sx: number, sy: number, z: number, e: MoteElement, t: number, seed: number, dark: number): void {
  if (dark <= 0.02) return;
  const zr = Math.round(z * 4) / 4;
  const [core, glint] = GLOW[e];
  const big = glowPic(e, Math.max(8, Math.round(RADIUS * 1.4 * zr)), core);
  const dot = glowPic(e, Math.max(3, Math.round(2.6 * moteScale(zr))), glint);
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = dark;
  ctx.drawImage(big, sx - big.width / 2, sy - LIFT * z - big.height / 2);
  for (let i = 0; i < MOTES; i++) {
    const m = moteAt(e, sx, sy, z, t, seed, i);
    let a = 0.55 + 0.45 * m.front;
    if (e === 'fire' && m.rise > 0.75) a *= 1 - (m.rise - 0.75) / 0.25;
    ctx.globalAlpha = dark * a;
    ctx.drawImage(dot, m.x - dot.width / 2, m.y - dot.height / 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prev;
}
