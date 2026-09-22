import { mulberry32 } from '../world/noise';
import { emotePose } from '../game/emotes';
import {
  BUILDS, DEFAULT_LOOK, darken, eyeColour, hairColour, shirtColour, skinColour, trouserColour,
  type Gender, type Look,
} from '../game/look';
import { BUSH_DEFS, TREE_AGES, TREE_DEFS } from '../world/tiles';

/** A pre-rendered sprite. Sizes are in zoom-1 pixels; the canvas is drawn at SPRITE_SCALE for crispness. */
export interface Sprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  /** Anchor (feet) offset from the top-left corner. */
  ax: number;
  ay: number;
}

/**
 * How many pixels of sprite are held per pixel at zoom 1.
 *
 * A tree or a body is drawn once into a little canvas and then blitted, so
 * this is the resolution it has for ever. Two was right when the camera
 * stopped at 2.5×; asked to go to five, a body is being blown up two and a
 * half times and the head goes soft, which is the one thing zooming in was
 * for.
 *
 * So it follows the camera instead of being a constant. Three steps, and a
 * gap between going up and coming back down: crossing a step throws the cache
 * away and everything on screen is drawn again, which is a handful of
 * milliseconds and not something to do twice a frame because the wheel is
 * wobbling between 2.19 and 2.21.
 *
 * Nothing is paid until somebody zooms in. A sprite is made when it is first
 * wanted, so the far-away island that never leaves 1× holds the same small
 * canvases it always did.
 */
const SPRITE_STEPS = [2, 3, 5];
/** How far past a step you must go before it takes, and how far back to drop. */
const STEP_SLACK = 0.15;
let SPRITE_SCALE = SPRITE_STEPS[0];

/**
 * Tell the sprites how close the camera is. Called once a frame by the
 * renderer; does nothing at all unless the step has actually changed.
 */
export function spriteScaleFor(zoom: number): void {
  let want = SPRITE_STEPS[0];
  for (const step of SPRITE_STEPS) {
    // A nudge past the step going up and a nudge under it coming back down,
    // so the boundary is not a place where one notch of the wheel redraws
    // everything and the next notch redraws it again.
    if (zoom > step + (SPRITE_SCALE > step ? -STEP_SLACK : STEP_SLACK)) want = nextStep(step);
  }
  if (want === SPRITE_SCALE) return;
  SPRITE_SCALE = want;
  /*
   * The step a sprite was drawn at is part of its name now, so stepping in and
   * straight out again finds what was drawn a second ago rather than drawing
   * the whole island twice. Two steps are kept — the one in use and the one
   * most recently left — because a zoom is nearly always a wobble between two
   * of them; a third pushes the oldest out, since a sprite at 5× is a canvas
   * fifty-odd times the area of the same sprite at 2× and three of every one
   * of them is not worth the memory.
   */
  const tag = `${want}|`;
  const i = LIVE.indexOf(tag);
  if (i >= 0) LIVE.splice(i, 1);
  LIVE.push(tag);
  while (LIVE.length > 2) {
    const dead = LIVE.shift()!;
    for (const k of cache.keys()) if (k.startsWith(dead)) cache.delete(k);
  }
}

/** The scale tags with sprites still cached under them, oldest first. */
const LIVE: string[] = [`${SPRITE_STEPS[0]}|`];

const nextStep = (step: number): number => SPRITE_STEPS[Math.min(SPRITE_STEPS.length - 1, SPRITE_STEPS.indexOf(step) + 1)];

/** World objects were designed for a 64 px tile; tiles are 96 px now. */
export const WORLD_SCALE = 1.5;
const TAU = Math.PI * 2;
const cache = new Map<string, Sprite>();

function makeSprite(w: number, h: number, ax: number, ay: number, draw: (ctx: CanvasRenderingContext2D) => void, k = WORLD_SCALE): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * k * SPRITE_SCALE);
  canvas.height = Math.ceil(h * k * SPRITE_SCALE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.scale(SPRITE_SCALE * k, SPRITE_SCALE * k);
  draw(ctx);
  return { canvas, w: w * k, h: h * k, ax: ax * k, ay: ay * k };
}

/**
 * What a thing standing up puts on the ground right under itself.
 *
 * Not black at any alpha. Black over a colour is that colour with the life
 * taken out of it, and the ground is what this whole look rests on; a cool
 * blue-green laid on thin reads as shade instead of as dirt. Two ellipses
 * rather than one, so it falls off at its edge without costing a blur.
 */
function contact(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry = rx * 0.34): void {
  // One flat shape at one alpha. Two of them stacked made a soft middle and
  // a soft edge, which is an airbrush, and an airbrush is the one thing a
  // picture made entirely of flat fields cannot have in it.
  ctx.fillStyle = 'rgba(44,74,78,0.17)';
  ctx.beginPath();
  ctx.ellipse(x - LIT.x * rx * 0.3, y - LIT.y * ry * 0.34, rx, ry, 0, 0, TAU);
  ctx.fill();
}

/** The same, for everything that is not a tree. */
function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  contact(ctx, x, y, rx, ry);
}

/**
 * Where the light on a baked sprite comes from, in screen space.
 *
 * Over the viewer's left shoulder, and a fixed direction rather than the sun's:
 * a tree is drawn once into its own little canvas and then blitted, so it
 * cannot turn with the day the way the shadow it throws on the ground does.
 * What matters is that everything baked agrees, because a wood lit from two
 * directions is the sort of thing nobody can name and nobody can unsee.
 */
const LIT = { x: -1, y: -0.78 };

/** Deterministic 0..1 from a seed and an index; for a shape's own wobble. */
function wob(seed: number, i: number): number {
  const s = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * A closed loop of lobes, curved through the midpoints of a seeded profile.
 *
 * Nothing that grows has a true arc anywhere on it, and a canopy built out of
 * `ctx.arc` says so from across the room -- it was five overlapping circles,
 * and five overlapping circles is a cartoon cloud whatever colour you paint
 * it. This is the same idea as a cloud, drawn as one outline that bulges
 * instead: `lobes` is how many bulges go round it, `rough` how far they carry.
 *
 * The step count is not a taste: it has to clear twice the highest frequency
 * in the profile or the lobes alias, and an aliased lobe is a corner. Drawn
 * at twenty steps the six-lobe crowns came out as flat-topped slabs with
 * square notches cut in them, which read as torn cardboard.
 */
const CROWN_STEPS = 48;
function lobed(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number,
  seed: number, lobes = 5, rough = 0.17, cut = 0, notch = 0): void {
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i < CROWN_STEPS; i++) {
    const a = (i / CROWN_STEPS) * TAU;
    let k = 1
      + rough * Math.sin(lobes * a + seed * 1.7)
      + rough * 0.52 * Math.sin((lobes + 3) * a - seed * 2.9)
      + rough * 0.33 * Math.sin(2 * a + seed * 0.7);
    // `cut` pulls the underside up into the crown, hardest straight down and
    // not at all at the sides, so the lowest thing on the tree is the rim and
    // there is a hollow under the middle of it. That is the difference
    // between an umbrella and a bun, and it is most of what makes a crown
    // read as held up rather than as sat on top.
    if (cut > 0) k *= 1 - cut * Math.pow(Math.max(0, Math.sin(a)), 2.4);
    // A bite out of one side, taken out of the radius over a narrow run of
    // angle. Punched instead with a second loop it left a crumb of itself
    // floating beside the tree wherever it reached past the edge.
    if (notch > 0) {
      const off = Math.abs(((a - notch * TAU + Math.PI) % TAU + TAU) % TAU - Math.PI);
      if (off < 0.9) k *= 1 - 0.42 * Math.cos((off / 0.9) * Math.PI * 0.5) ** 2;
    }
    px.push(cx + Math.cos(a) * rx * k);
    py.push(cy + Math.sin(a) * ry * k);
  }
  const n = CROWN_STEPS;
  ctx.moveTo((px[n - 1] + px[0]) / 2, (py[n - 1] + py[0]) / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    ctx.quadraticCurveTo(px[i], py[i], (px[i] + px[j]) / 2, (py[i] + py[j]) / 2);
  }
  ctx.closePath();
}

/** A shape that can be laid down again shifted; what `lightOn` works on. */
type Mass = (dx: number, dy: number) => void;

/**
 * Three flat tones laid on a mass as shapes that follow the one light.
 *
 * The lit edge is what the mass has that the same mass slid away from the
 * light has not; the shaded edge is the same the other way about. Both come
 * out as crescents hugging an edge, which is what light on a solid thing
 * does. A smaller copy of the shape stamped in the middle is what a sticker
 * does, and that is what was there before: every broadleaf on the island wore
 * the same pale badge in the same place.
 */
function lightOn(ctx: CanvasRenderingContext2D, mass: Mass,
  pal: readonly [string, string, string], cx: number, cy: number,
  rx: number, ry: number, seed: number): void {
  ctx.save();
  ctx.beginPath();
  mass(0, 0);
  ctx.clip();
  ctx.fillStyle = pal[1];
  ctx.beginPath();
  mass(0, 0);
  ctx.fill();
  /*
   * Both tones are cut from the crown's own outline, offset along each axis
   * by a share of that axis rather than by a number of pixels -- shifted the
   * same distance both ways, a crown three times wider than it is tall got a
   * band that was thin at the sides and fat at the top, and on a lobed edge
   * it would come away from the rim altogether and wander about inside.
   *
   * The shade is that crescent taken deep: its outer edge is the crown's own
   * silhouette on the away side, and its inner edge is the same silhouette
   * again, sunward, which arrives as one concave sweep across the mass. So
   * the dark is a real underside, bounded by the shape it belongs to. Laid
   * instead as a separate loop set down-sun it was a lozenge floating in the
   * middle of the crown -- and, printed on every tree, the same lozenge.
   */
  const deep = 0.26 + 0.09 * wob(seed, 34);
  ctx.fillStyle = pal[2];
  ctx.beginPath();
  mass(0, 0);
  mass(LIT.x * rx * deep, LIT.y * ry * deep);
  ctx.fill('evenodd');
  /*
   * The lit tone is a rim riding the edge, but only round the arc that faces
   * the light: a crescent, cut by a loop set up-sun, so the band is widest
   * where the crown is square-on to the light and runs out to nothing at
   * either end of it.
   *
   * Both halves of that are load-bearing, and each on its own was tried and
   * thrown out. The crescent alone is a band of one width the whole way
   * round, which is a keyline. The loop alone is a pale shape floating in
   * the middle of the crown, which is a decal -- and stamped on a hundred
   * crowns in a wood, it is the same decal a hundred times.
   *
   * No outline anywhere. One went on when crowns at the same value would not
   * come apart from each other, and it worked, which was the trouble: it did
   * all the separating, so the value range behind it went for nothing and a
   * wood read as vector stickers. Tone does that job now.
   */
  const reach = 1.1 + 0.18 * wob(seed, 31);
  const band = 0.2 + 0.08 * wob(seed, 33);
  ctx.save();
  ctx.beginPath();
  lobed(ctx, cx + LIT.x * rx * reach, cy + LIT.y * ry * (reach + 0.06), rx * 1.1, ry * 1.1, seed + 3.1, 4, 0.14);
  ctx.clip();
  ctx.fillStyle = pal[0];
  ctx.beginPath();
  mass(0, 0);
  mass(-LIT.x * rx * band, -LIT.y * ry * band);
  ctx.fill('evenodd');
  ctx.restore();
  ctx.restore();
}

/**
 * A stem: tapered, leaning a little, flared where it goes into the ground.
 *
 * The shaded side is the wood's own colour taken down, not black laid over
 * the top of it. Black over a colour is grey, and grey is the one thing this
 * palette has none of.
 */
function stem(ctx: CanvasRenderingContext2D, x: number, baseY: number, w: number, h: number,
  lean: number, color: string): void {
  const tx = x + lean;
  // Barely tapered, and bent. Taken from a wide foot to a point it read as an
  // isoceles triangle, which is the same tell as the conifer that used to be
  // three of them: a straight-sided thing that narrows evenly is a drawn
  // shape, not a grown one.
  const tw = w * 0.74;
  const flare = w * 0.9;
  const bowX = lean * 0.35 - w * 0.3;
  const wall = (): void => {
    ctx.moveTo(x - flare, baseY);
    ctx.bezierCurveTo(x - w * 0.5, baseY - h * 0.3, tx + bowX - tw * 0.5, baseY - h * 0.7, tx - tw / 2, baseY - h);
    ctx.lineTo(tx + tw / 2, baseY - h);
    ctx.bezierCurveTo(tx + bowX + tw * 0.5, baseY - h * 0.7, x + w * 0.5, baseY - h * 0.3, x + flare, baseY);
    ctx.closePath();
  };
  ctx.beginPath();
  wall();
  ctx.fillStyle = color;
  ctx.fill();
  // The shaded side is the stem's own outline slid toward the light and cut
  // away, so the shade narrows as the stem narrows and there is no seam that
  // does not belong to the wood. Drawn as a wedge instead it came out as a
  // hard black stripe up every trunk on the island -- a stem is a small thing
  // and a straight edge across a small thing is all you see.
  ctx.save();
  ctx.beginPath();
  wall();
  ctx.clip();
  // Squeezed toward the away side rather than slid, so the shade is the same
  // share of the stem at the top as at the foot. Slid, it took three fifths
  // of a narrow crown-end and a quarter of a wide flared one, which drew a
  // dark wedge up the middle of every trunk.
  ctx.fillStyle = shade(color, -0.15);
  ctx.translate(x + flare, 0);
  ctx.scale(0.42, 1);
  ctx.translate(-(x + flare), 0);
  ctx.beginPath();
  wall();
  ctx.fill();
  ctx.restore();
}

/**
 * What the crown drops on the stem underneath it. A tree with a lit trunk all
 * the way up to a canopy is a tree with a hole in its light.
 */
function underCrown(ctx: CanvasRenderingContext2D, x: number, baseY: number, w: number, h: number,
  lean: number, color: string, drop: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - w * 1.2, baseY - h, w * 2.4, drop);
  ctx.clip();
  ctx.globalAlpha = 0.5;
  stem(ctx, x, baseY, w, h, lean, shade(color, -0.26));
  ctx.restore();
}

/**
 * The fork a broadleaf crown is carried on: bare limbs splaying off the top
 * of the stem, drawn before the crown and reaching wider than it.
 *
 * This is the thing that was missing from every broadleaf here for six goes
 * at it. A mass of foliage sitting straight on the end of a pole is a
 * lollipop however the mass is shaped -- the crown has to be held up off
 * something, with daylight under it and wood showing through, before it
 * reads as a tree rather than as a shape on a stick. Everything else about
 * the outline is downstream of that.
 */
function fork(ctx: CanvasRenderingContext2D, x: number, top: number, spread: number, rise: number,
  seed: number, color: string, n: number): void {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const dir = (t - 0.5) * 2 + (wob(seed, i + 50) - 0.5) * 0.5;
    const len = spread * (0.5 + 0.5 * wob(seed, i + 60));
    const up = rise * (0.72 + 0.5 * wob(seed, i + 70));
    ctx.lineWidth = Math.max(1, spread * 0.16 * (1 - 0.25 * t));
    ctx.beginPath();
    ctx.moveTo(x, top + rise * 0.3);
    ctx.quadraticCurveTo(x + dir * len * 0.4, top - up * 0.5, x + dir * len, top - up);
    ctx.stroke();
  }
}

/** Bare wood: a few branches off the top of the stem, in the stem's colour. */
function branches(ctx: CanvasRenderingContext2D, bx: number, top: number, size: number, color: string, n: number): void {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const dir = (t - 0.5) * 2;
    const len = (22 + ((i * 5) % 3) * 4) * size;
    ctx.lineWidth = Math.max(1, 2.6 * size - i * 0.2);
    ctx.beginPath();
    ctx.moveTo(bx, top + 4 * size);
    ctx.quadraticCurveTo(bx + dir * len * 0.35, top - len * 0.55, bx + dir * len * 0.8, top - len * (0.75 + 0.25 * (1 - Math.abs(dir))));
    ctx.stroke();
    ctx.lineWidth = Math.max(0.8, 1.4 * size);
    ctx.beginPath();
    ctx.moveTo(bx + dir * len * 0.45, top - len * 0.5);
    ctx.lineTo(bx + dir * len * 0.3, top - len * 0.9);
    ctx.stroke();
  }
}

const SPRITE_W = 88;
const SPRITE_H = 120;
const AX = SPRITE_W / 2;
const AY = SPRITE_H - 8;

/**
 * What hangs in each of the bearing trees, chalked to sit in this palette.
 *
 * They used to be three colours for eleven trees and drawn as nine pinpricks
 * scattered over the crown, which at the size a tree is actually looked at
 * came to a faint rash. They hang in bunches at the rim now, where fruit
 * hangs, and each tree's is its own.
 */
const FRUIT_COLOUR: Record<string, string> = {
  apple: '#a8665f', cherry: '#8e5160', olive: '#6b7357', pear: '#ab9a70', plum: '#756a86',
  peach: '#bb8c74', fig: '#705f78', lemon: '#b7a874', pomegranate: '#8d5a52',
  apricot: '#b78f72', quince: '#ad9c79',
};

/**
 * A colour gone some of the way to dead leaf: `t` of the way, 0 to 1. Below
 * nought it goes the other way, towards pale cut wood, which is what the face
 * of a stump is.
 */
function dulled(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const to: [number, number, number] = t < 0 ? [226, 214, 190] : [146, 134, 108];
  const k = Math.abs(t);
  const mix = (c: number, target: number): number => Math.round(c + (target - c) * k);
  const pair = (v: number): string => v.toString(16).padStart(2, '0');
  return `#${pair(mix((n >> 16) & 255, to[0]))}${pair(mix((n >> 8) & 255, to[1]))}${pair(mix(n & 255, to[2]))}`;
}

/**
 * Fruit, in bunches hung off the lower rim of a crown.
 *
 * Three clusters rather than nine specks, each of two or three, sitting where
 * the crown's underside is -- which is both where fruit hangs and the one
 * part of a canopy that is in shadow, so a warm cluster has something to be
 * warm against.
 */
function fruiting(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number,
  seed: number, colour: string): void {
  const r = Math.max(1, Math.min(rx, ry) * 0.2);
  // Two bunches, not three at even spacing, each one somewhere of its own and
  // each fruit its own size and not a circle. Evenly spaced clusters of equal
  // round dots came out as a string of beads hung on the crown, which is a
  // decoration rather than a crop.
  // Both bunches on the same side, and that side the crown's own: fruit
  // hangs where the wood carries it, not spaced evenly round a rim.
  const swing = wob(seed, 41) > 0.5 ? 1 : -1;
  for (let c = 0; c < 2; c++) {
    const a = Math.PI * 0.5 - swing * (0.18 + 0.34 * c + wob(seed, c) * 0.24);
    const hx = cx + Math.cos(a) * rx * (0.6 + 0.28 * wob(seed, c + 4));
    const hy = cy + Math.sin(a) * ry * (0.64 + 0.26 * wob(seed, c + 6));
    const n = 2 + Math.floor(wob(seed, c + 9) * 2);
    for (let i = 0; i < n; i++) {
      const dx = (wob(seed, c * 5 + i) - 0.5) * r * 2.4;
      const dy = (wob(seed, c * 5 + i + 3) - 0.3) * r * 2;
      const rr = r * (0.76 + 0.4 * wob(seed, c * 7 + i));
      ctx.fillStyle = shade(colour, -0.2);
      ctx.beginPath();
      lobed(ctx, hx + dx, hy + dy + rr * 0.2, rr, rr, seed + c * 3 + i, 3, 0.16);
      ctx.fill();
      ctx.fillStyle = colour;
      ctx.beginPath();
      lobed(ctx, hx + dx - rr * 0.14, hy + dy - rr * 0.12, rr * 0.76, rr * 0.76, seed + c * 3 + i + 1, 3, 0.16);
      ctx.fill();
    }
  }
}

export function treeSprite(species: number, variant: number): Sprite {
  const key = `${SPRITE_SCALE}|tree:${species}:${variant}`;
  let spr = cache.get(key);
  if (spr) return spr;
  const def = TREE_DEFS[species];
  // The age's size and look are the table's, so a stage added there is drawn
  // here without anybody remembering to. A value off the table draws as young.
  const age = TREE_AGES[variant] ?? TREE_AGES[0];
  const size = def.size * age.size;
  // A worn crown has gone a third of the way to dead leaf.
  const canopy = (age.look === 'worn' ? def.canopy.map((c) => dulled(c, 0.34)) : def.canopy) as [string, string, string];
  // One seed per species, so every oak on the island is the same oak and no
  // two species wear the same wobble.
  const seed = species * 7.13 + 1.7;
  // Which way this species grows out of true. Small, but it is the difference
  // between a wood and a wallpaper of one motif repeated.
  const tilt = (wob(seed, 2) - 0.5) * 2;
  // How thick this species runs in the trunk. One bark at one width across
  // seventeen species was a fair part of what made them look like one tree.
  const girth = 0.78 + 0.5 * wob(seed, 100);
  spr = makeSprite(SPRITE_W, SPRITE_H, AX, AY, (ctx) => {
    const bx = AX;
    const by = AY;
    if (age.look === 'bare') {
      // Dead wood standing up: the stem, a few branches, no crown at all.
      const th = 38 * size;
      contact(ctx, bx, by, 11 * size);
      stem(ctx, bx, by, 6 * size, th, tilt * 2 * size, dulled(def.trunk, 0.35));
      branches(ctx, bx, by - th, size, dulled(def.trunk, 0.45), 4);
      return;
    }
    if (age.look === 'clipped') {
      // A sapling pruned back: low, wide and flat across the top for good.
      const rx = 26 * size;
      const ry = 10 * size;
      const cy = by - 10 * size - ry;
      contact(ctx, bx, by, rx * 0.8);
      stem(ctx, bx, by, 4.4 * size, 12 * size, 0, def.trunk);
      lightOn(ctx, (dx, dy) => lobed(ctx, bx + dx, cy + dy, rx, ry, seed, 5, 0.12), canopy, bx, cy, rx, ry, seed);
      return;
    }
    const grown = age.look !== 'worn';
    const fruit = def.fruit && age.bears ? FRUIT_COLOUR[def.fruit] ?? '#c8675c' : null;

    if (def.shape === 'spire') {
      /*
       * A conifer as tiers that sag, hung off a leader that is not straight.
       *
       * It was three isoceles triangles stacked up, which is the shape a
       * child draws and the second-clearest tell in the set after the cloud.
       * Every number below is off the seed, so the tiers are uneven, they
       * lean, and one of them somewhere up the tree is stunted.
       */
      const th = 15 * size;
      // Two species share this outline, so the two have to be told apart by
      // it: a tight tall one with many short tiers, or an open one with three
      // long drooping ones and sky between them.
      const open = wob(seed, 21) > 0.5;
      const tiers = open ? 3 : 5;
      const step = open ? 19 * size : 12.5 * size;
      const top = by - th - step * tiers;
      contact(ctx, bx, by, 15 * size);
      stem(ctx, bx, by, 5.2 * size, th + step * 0.7, tilt * 1.5 * size, def.trunk);
      for (let i = tiers - 1; i >= 0; i--) {
        const t = i / (tiers - 1);
        // The leader wanders; the tiers hang off wherever it has got to.
        const ax = bx + tilt * 5 * size * t * t;
        const ly = top + (tiers - 1 - i) * step + step;
        // One tier somewhere up the tree is stunted, and which one is the seed's.
        const runt = i === 1 + Math.floor(wob(seed, 11) * (tiers - 2)) ? 0.62 : 1;
        for (const side of [-1, 1]) {
          // Left and right offset down the leader, so the tiers alternate
          // instead of pairing off into chevrons.
          const stagger = side > 0 ? step * 0.42 : 0;
          // The two sides of a tier are never the same length. Up to half as
          // long again one way as the other, which is what stops a conifer
          // reading as a folded paper chevron.
          const swing = 0.68 + 0.64 * wob(seed, i * 2 + (side > 0 ? 1 : 0));
          // The open one takes its blades in toward the top; the tight one
          // keeps them even the whole way down. One of the two structural
          // differences that stop the pair being one tree.
          const taper = open ? 1.25 - 0.55 * t : 1;
          const lw = (open ? 12 + 18 * t : 9 + 13 * t) * size * runt * swing * taper;
          // The open one drops its tiers below the horizontal and takes them
          // out to a thread; the tight one holds them out stiff and flat. Two
          // species share this outline and that is the whole of what tells
          // them apart.
          const sag = (open ? 11 + 15 * t : 1.5 + 2 * t) * size * (0.8 + 0.5 * swing);
          const mass: Mass = (dx, dy) => {
            const tip = (open ? 0.99 : 0.94) * (0.9 + 0.2 * wob(seed, i * 6 + side + 2));
            // A hand-cut edge on the blade too: it was the one shape left on
            // screen with a true vector outline, and it repeated unchanged at
            // every scale.
            const kink = (wob(seed, i * 5 + side) - 0.5) * lw * 0.18;
            ctx.moveTo(ax + dx, ly + stagger - step * (open ? 0.62 : 0.5) + dy);
            ctx.quadraticCurveTo(ax + side * lw * 0.5 + dx, ly + stagger - step * (open ? 0.42 : 0.34) + dy,
              ax + side * lw * tip + dx, ly + stagger + sag * 0.9 + kink + dy);
            ctx.quadraticCurveTo(ax + side * lw * (open ? 0.86 : 0.9) + dx, ly + stagger + sag * 1.15 + (open ? 0 : step * 0.3) + dy,
              ax + side * lw * 0.5 + dx, ly + stagger + sag * 0.5 + (open ? 0 : step * 0.26) - kink * 0.6 + dy);
            ctx.quadraticCurveTo(ax + side * lw * 0.3 + dx, ly + stagger + sag * 0.2 + dy, ax + side * lw * 0.08 + dx, ly + stagger + dy);
            ctx.closePath();
          };
          // Sunward blades take the light tone whole and shaded ones the deep
          // tone whole -- a blade is small enough to be one plane. Only the
          // top of the tree gets the palest of the three, so the crown still
          // falls away into its own shade going down.
          /*
           * Which side of the leader a blade is on decides its tone, but not
           * on its own: about one blade in six goes the other way. Hinged
           * strictly down the middle the crown came out as two flat halves
           * with a seam between them, rather than as a thing turning through
           * the light.
           */
          const flip = wob(seed, i * 4 + (side > 0 ? 2 : 1)) > 0.83;
          const sunward = (side * LIT.x > 0) !== flip;
          ctx.fillStyle = sunward ? (t > 0.72 ? canopy[0] : canopy[1]) : canopy[2];
          ctx.beginPath();
          mass(0, 0);
          ctx.fill();
        }
      }
      if (!grown) branches(ctx, bx, top, size * 0.7, dulled(def.trunk, 0.3), 2);
      return;
    }

    if (def.shape === 'weeping') {
      /* A willow: a high crown with the whole of it falling off the rim. */
      const th = 36 * size;
      const rx = 22 * size;
      const ry = 13 * size;
      const cy = by - th - ry * 0.5;
      contact(ctx, bx, by, rx * 0.8);
      stem(ctx, bx, by, 6.5 * size * girth, th, tilt * 2.5 * size, def.trunk);
      underCrown(ctx, bx, by, 6.5 * size, th, tilt * 2.5 * size, def.trunk, ry * 1.5);
      // The fronds first, so the crown sits on top of where they leave it.
      ctx.lineCap = 'round';
      for (let k = 0; k <= 15; k++) {
        const t = k / 15;
        // Not on a comb: a fall starts where it starts, and two of them
        // crossing is what a willow looks like.
        const x = bx - rx * 1.02 + t * rx * 2.04 + (wob(seed, k + 40) - 0.5) * rx * 0.26;
        const edge = Math.sin(t * Math.PI);
        // Longest at the sides, and measured off the stem so no frond ever
        // reaches past the foot of the tree it is hanging from.
        const fall = (ry + th * (0.42 + 0.36 * (1 - edge))) * (0.78 + 0.34 * wob(seed, k));
        const sway = (wob(seed, k + 20) - 0.5) * 6 * size + tilt * 3 * size;
        // Drawn as a closed sliver rather than a stroke, so a strand can be
        // thick where it leaves the crown and come to nothing at its end. A
        // line of even width all the way down is a stick, and a willow of
        // sticks is a mop.
        ctx.fillStyle = t < 0.42 ? canopy[0] : canopy[2];
        const wTop = Math.max(0.8, 2.2 * size);
        ctx.beginPath();
        const from = cy + ry * (0.05 + 0.3 * wob(seed, k + 55));
        ctx.moveTo(x - wTop / 2, from);
        ctx.quadraticCurveTo(x + sway - wTop * 0.3, cy + fall * 0.55, x + sway * 1.5, cy + fall);
        ctx.quadraticCurveTo(x + sway + wTop * 0.5, cy + fall * 0.5, x + wTop / 2, from);
        ctx.closePath();
        ctx.fill();
      }
      lightOn(ctx, (dx, dy) => lobed(ctx, bx + dx, cy + dy, rx, ry, seed, 6, 0.15, 0.3), canopy, bx, cy, rx, ry, seed);
      if (!grown) branches(ctx, bx, cy - ry, size * 0.8, dulled(def.trunk, 0.3), 3);
      if (fruit) fruiting(ctx, bx, cy, rx, ry, seed, fruit);
      return;
    }

    if (def.shape === 'shelf') {
      /*
       * Three plates on one stem, with air between them.
       *
       * The one shape in the set that could not be a tree on this planet, and
       * the one that does the most work: a stand of them reads as a stand
       * rather than as a texture, because the gaps let the ground through.
       */
      const th = 30 * size;
      const plates = wob(seed, 81) > 0.5 ? 3 : 4;
      contact(ctx, bx, by, 18 * size);
      stem(ctx, bx, by, 5.4 * size * girth, th + plates * 10 * size, tilt * 5 * size, def.trunk);
      for (let i = 0; i < plates; i++) {
        const t = i / (plates - 1);
        // Each plate its own reach, rather than a clean taper down the stem.
        const rx = (20 - 6 * t) * size * (0.78 + 0.42 * wob(seed, i + 90));
        const ry = (5.4 - 1 * t) * size;
        // Thrown alternately either side of the stem rather than threaded on
        // it, so the stem shows through between the plates and each one
        // reaches out over nothing. Stacked concentric they were a totem.
        const cx = bx + (i % 2 ? 1 : -1) * rx * 0.36 + tilt * 5 * size * t;
        const cy = by - th - i * (plates > 3 ? 8 : 13) * size;
        lightOn(ctx, (dx, dy) => lobed(ctx, cx + dx, cy + dy, rx, ry, seed + i, 5, 0.14), canopy, cx, cy, rx, ry, seed + i);
      }
      if (!grown) branches(ctx, bx, by - th - plates * 10 * size, size * 0.7, dulled(def.trunk, 0.3), 2);
      if (fruit) fruiting(ctx, bx, by - th, 21 * size, 5 * size, seed, fruit);
      return;
    }

    if (def.shape === 'bulb') {
      /* A heavy head low on a long bare stem, overhanging the way fruit wood does. */
      /*
       * A small dense head sitting down inside an open fork of bare wood, on
       * a long clean stem. The arms have to reach out past the head or the
       * whole thing is a ball on a pole again -- the wood in the outline is
       * the entire point of this one.
       */
      const th = 44 * size;
      const rx = 12 * size;
      const ry = 10 * size;
      const lean = tilt * 4 * size;
      const hx = bx + lean + tilt * rx * 0.3;
      const cy = by - th - ry * 0.55;
      contact(ctx, bx, by, rx * 0.95);
      stem(ctx, bx, by, 4.6 * size * girth, th, lean, def.trunk);
      fork(ctx, bx + lean, by - th, rx * 1.05, 11 * size, seed, def.trunk, 4);
      const split = wob(seed, 84) > 0.5;
      lightOn(ctx, (dx, dy) => {
        lobed(ctx, hx + dx, cy + dy, rx * (split ? 0.78 : 1), ry * (split ? 0.86 : 1), seed, 4, 0.22, 0.1);
        // Half of them carry the head in two pieces with sky between.
        if (split) lobed(ctx, hx - tilt * rx * 0.95 + dx, cy + ry * 0.5 + dy, rx * 0.5, ry * 0.42, seed + 7.7, 3, 0.2);
      }, canopy, hx, cy, rx, ry, seed);
      if (fruit) fruiting(ctx, hx, cy, rx, ry, seed, fruit);
      return;
    }

    if (def.shape === 'column') {
      /*
       * A tall narrow spindle, twice as high as it is wide, with almost no
       * stem showing. The one thing in the set whose bounding box is upright
       * -- a wood needs a vertical in it or every outline in it is a disc on
       * a stick at a different scale.
       */
      const waisted = wob(seed, 82);
      const th = 12 * size;
      const rx = 9 * size;
      const ry = (waisted > 0.66 ? 13 : 23) * size;
      const lean = tilt * 4 * size;
      const cx = bx + lean * 0.6;
      const cy = by - th - ry * 0.86 - (waisted > 0.66 ? 18 : 0) * size;
      contact(ctx, bx, by, rx * 1.2);
      stem(ctx, bx, by, 5 * size * (0.8 + 0.5 * wob(seed, 100)),
        th + ry * (waisted > 0.66 ? 2.1 : 0.7), lean, def.trunk);
      if (waisted > 0.66) {
        // Two masses with a waist of bare stem between them.
        const ly = cy + ry * 1.5;
        lightOn(ctx, (dx, dy) => lobed(ctx, cx + dx, ly + dy, rx * 0.86, ry * 0.8, seed + 5.5, 6, 0.17),
          canopy, cx, ly, rx * 0.86, ry * 0.8, seed + 5.5);
      }
      lightOn(ctx, (dx, dy) => lobed(ctx, cx + dx, cy + dy, rx, ry, seed, 6, 0.17,
        waisted < 0.33 ? 0.45 : 0), canopy, cx, cy, rx, ry, seed);
      if (!grown) branches(ctx, cx, cy + ry * 0.5, size * 0.6, dulled(def.trunk, 0.3), 2);
      if (fruit) fruiting(ctx, cx, cy + ry * 0.3, rx, ry * 0.5, seed, fruit);
      return;
    }

    if (def.shape === 'plate') {
      /*
       * One wide shallow plate with a bite taken out of one side, carried
       * high. No second layer, no dome: the whole tree is a single flat
       * lamina, and the notch is what keeps it from being a lozenge.
       */
      const th = 42 * size;
      const rx = 22 * size;
      const ry = 6.5 * size;
      const lean = tilt * 4 * size;
      const cx = bx + lean + tilt * rx * 0.2;
      const cy = by - th - 15 * size;
      const bite = tilt >= 0 ? 1 : -1;
      contact(ctx, bx, by, rx * 0.72);
      stem(ctx, bx, by, 6 * size * girth, th, lean, def.trunk);
      fork(ctx, bx + lean, by - th, rx * 0.46, 15 * size, seed, def.trunk, 3);
      const nick = bite > 0 ? 0.02 : 0.48;
      lightOn(ctx, (dx, dy) => lobed(ctx, cx + dx, cy + dy, rx, ry, seed, 4, 0.2, 0, nick),
        canopy, cx, cy, rx, ry, seed);
      if (!grown) branches(ctx, cx, cy, size * 0.8, dulled(def.trunk, 0.3), 3);
      if (fruit) fruiting(ctx, cx, cy, rx, ry, seed, fruit);
      return;
    }

    if (def.shape === 'fan') {
      /* A crown shouldered over to one side, the way a tree on a windward slope goes. */
      /*
       * The crown hung off to one side of the stem rather than balanced on
       * top of it: the stem comes up into its lower corner and better than
       * half the mass reaches out over open ground. A tree grown against a
       * prevailing wind, and the one outline here that is not symmetrical
       * about anything.
       */
      const th = 34 * size;
      const rx = 13 * size;
      const ry = 20 * size;
      const out = tilt >= 0 ? 1 : -1;
      const lean = out * 8 * size;
      const cx = bx + lean + out * rx * 0.86;
      const cy = by - th - ry * 0.32;
      const skew = out * 0.42;
      contact(ctx, bx + lean * 0.5, by, rx * 0.88);
      stem(ctx, bx, by, 6 * size * girth, th, lean, def.trunk);
      fork(ctx, bx + lean, by - th, rx * 0.74, 12 * size, seed, def.trunk, 3);
      /*
       * Ribs, splayed from where the stem lets go of them and cut off square
       * underneath. The single skewed lobe this replaces had no edge rule at
       * all -- it was an unarticulated lump billed as a fan, and pitched
       * close enough to the meadow's own green that a stand of them turned
       * the wood to mottle.
       */
      const ribs = 4;
      const mass: Mass = (dx, dy) => {
        ctx.save();
        ctx.translate(cx + dx, cy + dy);
        ctx.transform(1, 0, skew, 1, 0, 0);
        for (let k = 0; k < ribs; k++) {
          const u = (k + 0.5) / ribs;
          const spin = (u - 0.5) * 1.5;
          lobed(ctx, Math.sin(spin) * rx * 0.62, -Math.cos(spin) * ry * 0.34,
            rx * (0.46 + 0.16 * wob(seed, k + 30)), ry * (0.5 + 0.2 * wob(seed, k + 35)),
            seed + k * 2.3, 3, 0.2, 0.35);
        }
        ctx.restore();
      };
      lightOn(ctx, mass, canopy, cx, cy, rx, ry, seed);
      // A small counterweight low on the other side, so the tree is off
      // balance rather than simply pointing.
      const kx = bx + lean - out * rx * 0.55;
      const ky = cy + ry * 0.52;
      lightOn(ctx, (dx, dy) => lobed(ctx, kx + dx, ky + dy, rx * 0.5, ry * 0.3, seed + 9.2, 3, 0.24),
        canopy, kx, ky, rx * 0.5, ry * 0.3, seed + 9.2);
      if (!grown) branches(ctx, bx + lean, cy + ry * 0.3, size * 0.8, dulled(def.trunk, 0.3), 3);
      if (fruit) fruiting(ctx, cx, cy, rx, ry, seed, fruit);
      return;
    }

    /*
     * Parasol: two wide flat layers of foliage rather than one mass.
     *
     * In silhouette-only black the one-mass version was a mushroom cap, and a
     * mushroom cap is a lollipop -- it read as the same tree as the bulb and
     * as every fruit tree on the island. Two layers with a gap of sky between
     * them is a different animal: it is wide, it is flat, it is stacked, and
     * you can tell it from anything else here with the colour taken out.
     */
    const th = 40 * size;
    const rx = 18 * size;
    const lean = tilt * 3 * size;
    const cx = bx + lean;
    const cy = by - th - 17 * size;
    contact(ctx, bx, by, rx * 0.8);
    stem(ctx, bx, by, 7 * size * girth, th, lean, def.trunk);
    fork(ctx, bx + lean, by - th, rx * 0.56, 14 * size, seed, def.trunk, 4);
    // How many plates, and how high they ride over the fork, both off the
    // seed: three species wear this outline and this is what parts them.
    const decks = wob(seed, 80) > 0.6 ? 3 : 2;
    // And which way the whole stack is thrown, so two species with the same
    // number of plates still do not draw the same tree.
    const throwOff = (wob(seed, 85) - 0.5) * rx * 0.5;
    for (let i = 0; i < decks; i++) {
      const lx = cx + throwOff * (i ? 1 : -0.6) + (i ? tilt * 7 * size - 2 * size : 1.5 * size);
      const ly = cy - i * 10 * size;
      const lrx = rx * (i ? 0.66 : 1);
      const lry = (7.5 - i * 1.3) * size;
      lightOn(ctx, (dx, dy) => lobed(ctx, lx + dx, ly + dy, lrx, lry, seed + i * 2.4, 4, 0.2, 0.34),
        canopy, lx, ly, lrx, lry, seed + i * 2.4);
    }
    if (!grown) branches(ctx, cx, cy - 4 * size, size * 0.85, dulled(def.trunk, 0.3), 3);
    if (fruit) fruiting(ctx, cx, cy, rx, 7 * size, seed, fruit);
  });
  cache.set(key, spr);
  return spr;
}

/** What a felled tree leaves: a short wide stub of its trunk, cut flat. */
export function stumpSprite(species: number): Sprite {
  const key = `${SPRITE_SCALE}|stump:${species}`;
  let spr = cache.get(key);
  if (spr) return spr;
  const def = TREE_DEFS[species];
  spr = makeSprite(48, 40, 24, 36, (ctx) => {
    const bx = 24;
    const by = 36;
    const w = 11;
    const h = 7;
    contact(ctx, bx, by, 10);
    // The stub, flared and shaded the same way the standing stem was, so what
    // is left of a tree is recognisably what the tree was standing on.
    stem(ctx, bx, by, w, h, 0, def.trunk);
    ctx.fillStyle = def.trunk;
    ctx.beginPath();
    ctx.ellipse(bx - w * 0.62, by - 1, 3.4, 1.6, 0, 0, TAU);
    ctx.ellipse(bx + w * 0.58, by - 0.5, 2.9, 1.4, 0, 0, TAU);
    ctx.fill();
    // The cut face, pale, with the rings in it.
    ctx.fillStyle = dulled(def.trunk, -0.55);
    ctx.beginPath();
    ctx.ellipse(bx, by - h, w * 0.29, w * 0.15, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = dulled(def.trunk, -0.12);
    ctx.lineWidth = 0.7;
    for (const r of [0.34, 0.66, 0.92]) {
      ctx.beginPath();
      ctx.ellipse(bx + 0.3, by - h, w * 0.29 * r, w * 0.15 * r, 0, 0, TAU);
      ctx.stroke();
    }
  });
  cache.set(key, spr);
  return spr;
}

export function bushSprite(species: number): Sprite {
  const key = `${SPRITE_SCALE}|bush:${species}`;
  let spr = cache.get(key);
  if (spr) return spr;
  const def = BUSH_DEFS[species];
  spr = makeSprite(48, 40, 24, 36, (ctx) => {
    const bx = 24;
    const by = 36;
    // The same lobes and the same light as the trees above them, at a
    // hand's height: a bush that is drawn by different rules reads as a
    // different game's art sitting in this one.
    const seed = species * 5.9 + 3.3;
    const pal: [string, string, string] = [shade(def.foliage[0], 0.2), def.foliage[0], def.foliage[1]];
    contact(ctx, bx, by, 12);
    lightOn(ctx, (dx, dy) => {
      lobed(ctx, bx + dx, by - 9 + dy, 11, 8, seed, 3, 0.15);
      lobed(ctx, bx - 4 + dx, by - 13 + dy, 6.5, 5.5, seed + 2.2, 3, 0.18);
    }, pal, bx, by - 9.5, 11, 8, seed);
    if (def.flowers) {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU + seed;
        const d = 5 + wob(seed, i) * 4.5;
        ctx.fillStyle = i % 3 === 0 ? shade(def.flowers, -0.22) : def.flowers;
        ctx.beginPath();
        ctx.arc(bx + Math.cos(a) * d, by - 9.5 + Math.sin(a) * d * 0.72, 1.5, 0, TAU);
        ctx.fill();
      }
    }
  });
  cache.set(key, spr);
  return spr;
}

/** A small heap of dropped goods. */
export function pileSprite(): Sprite {
  const key = `${SPRITE_SCALE}|pile`;
  let spr = cache.get(key);
  if (spr) return spr;
  spr = makeSprite(36, 30, 18, 27, (ctx) => {
    const bx = 18;
    const by = 27;
    shadow(ctx, bx, by, 11, 4);
    ctx.fillStyle = '#8a6a42';
    ctx.beginPath();
    ctx.moveTo(bx - 9, by);
    ctx.quadraticCurveTo(bx - 10, by - 12, bx - 3, by - 14);
    ctx.quadraticCurveTo(bx + 1, by - 18, bx + 4, by - 14);
    ctx.quadraticCurveTo(bx + 11, by - 11, bx + 9, by);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5e4630';
    ctx.fillRect(bx - 3, by - 15, 7, 2.5);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.moveTo(bx + 2, by - 13);
    ctx.quadraticCurveTo(bx + 11, by - 10, bx + 9, by);
    ctx.lineTo(bx + 2, by);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c9a15c';
    ctx.beginPath();
    ctx.arc(bx - 4, by - 6, 2.2, 0, TAU);
    ctx.fill();
  });
  cache.set(key, spr);
  return spr;
}

/** The settlement token: a carved stone pillar with a gilded cap. */
export function tokenSprite(): Sprite {
  const key = `${SPRITE_SCALE}|token`;
  let spr = cache.get(key);
  if (spr) return spr;
  spr = makeSprite(40, 76, 20, 72, (ctx) => {
    const bx = 20;
    const by = 72;
    shadow(ctx, bx, by, 13, 5);
    // plinth
    ctx.fillStyle = '#6f6a62';
    ctx.beginPath();
    ctx.moveTo(bx - 12, by - 4);
    ctx.lineTo(bx, by + 2);
    ctx.lineTo(bx + 12, by - 4);
    ctx.lineTo(bx, by - 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5a554e';
    ctx.beginPath();
    ctx.moveTo(bx, by + 2);
    ctx.lineTo(bx + 12, by - 4);
    ctx.lineTo(bx + 12, by - 8);
    ctx.lineTo(bx, by - 2);
    ctx.closePath();
    ctx.fill();
    // column
    ctx.fillStyle = '#9a948a';
    ctx.beginPath();
    ctx.moveTo(bx - 6, by - 8);
    ctx.lineTo(bx - 4, by - 56);
    ctx.lineTo(bx + 4, by - 56);
    ctx.lineTo(bx + 6, by - 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.moveTo(bx, by - 8);
    ctx.lineTo(bx, by - 56);
    ctx.lineTo(bx + 4, by - 56);
    ctx.lineTo(bx + 6, by - 8);
    ctx.closePath();
    ctx.fill();
    // runes
    ctx.fillStyle = '#4e4942';
    for (let i = 0; i < 4; i++) ctx.fillRect(bx - 3, by - 18 - i * 9, 5, 2);
    // gilded cap
    ctx.fillStyle = '#e3b657';
    ctx.beginPath();
    ctx.moveTo(bx - 6, by - 56);
    ctx.lineTo(bx, by - 68);
    ctx.lineTo(bx + 6, by - 56);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#b48a2e';
    ctx.beginPath();
    ctx.moveTo(bx, by - 68);
    ctx.lineTo(bx + 6, by - 56);
    ctx.lineTo(bx, by - 58);
    ctx.closePath();
    ctx.fill();
  });
  cache.set(key, spr);
  return spr;
}

/** A crate sized to one subtile (a quarter of a tile each way). */
export function crateSprite(kind: 'log' | 'plank' = 'plank'): Sprite {
  const key = `${SPRITE_SCALE}|crate:${kind}`;
  let spr = cache.get(key);
  if (spr) return spr;
  const left = kind === 'log' ? '#7d5c38' : '#8a6a42';
  const right = kind === 'log' ? '#5c4228' : '#6a4f30';
  const top = kind === 'log' ? '#a17a4a' : '#b08850';
  spr = makeSprite(30, 32, 15, 29, (ctx) => {
    const bx = 15;
    const by = 29;
    shadow(ctx, bx, by, 11, 5);
    const w = 11;
    const h = 11;
    // left face, right face, top
    ctx.fillStyle = left;
    ctx.beginPath();
    ctx.moveTo(bx - w, by - w / 2);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx, by - h);
    ctx.lineTo(bx - w, by - w / 2 - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = right;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + w, by - w / 2);
    ctx.lineTo(bx + w, by - w / 2 - h);
    ctx.lineTo(bx, by - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.moveTo(bx - w, by - w / 2 - h);
    ctx.lineTo(bx, by - h);
    ctx.lineTo(bx + w, by - w / 2 - h);
    ctx.lineTo(bx, by - w - h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#4a3520';
    ctx.lineWidth = 1;
    const bands = kind === 'log' ? [0.25, 0.5, 0.75] : [0.35, 0.7];
    for (const k of bands) {
      ctx.beginPath();
      ctx.moveTo(bx - w, by - w / 2 - h * k);
      ctx.lineTo(bx, by - h * k);
      ctx.lineTo(bx + w, by - w / 2 - h * k);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx, by - h);
    ctx.stroke();
  }, 1);
  cache.set(key, spr);
  return spr;
}

/**
 * A crop growing on a tilled field. Each of the four stages gets its own
 * model, and each family of crop its own shape: roots keep their heads down
 * and swell late, leaves spread, grain runs up into ears, herbs stay low and
 * bushy, and fibre opens into bolls. Ripe plants carry their produce.
 */
export function cropSprite(cropId: string, stage: number, look: string, leaf: string, fruit: string): Sprite {
  const key = `${SPRITE_SCALE}|crop:${cropId}:${stage}`;
  let spr = cache.get(key);
  if (spr) return spr;
  const rng = mulberry32(hashString(cropId) + stage * 7919);
  // How far out of the tile centre anything drawn on the field may reach, as a
  // share of the tile. A hair inside the half-tile, so nothing touches the edge.
  const EDGE = 0.46;
  // A tile's worth of furrows, anchored at the tile centre.
  spr = makeSprite(96, 72, 48, 54, (ctx) => {
    const cx = 48;
    const cy = 52;
    const iso = (u: number, v: number): [number, number] => [cx + (u - v) * 44, cy + (u + v) * 22];
    ctx.lineCap = 'round';
    /*
     * Furrows run across the field under the plants. The ground they have to
     * stay on is a diamond, so a furrow further from the middle is a shorter
     * furrow: at the widest the full width of the tile, and at the last one
     * before the corner barely more than a nick. Drawing them all the same
     * length ran them a third of a tile out over the grass on either side.
     */
    ctx.strokeStyle = 'rgba(70,50,32,0.45)';
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      const f = i * 0.19;
      const half = EDGE - Math.abs(f);
      if (half <= 0.03) continue;
      const [ax, ay] = iso(f - half, f + half);
      const [bx, by] = iso(f + half, f - half);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    if (stage === 0) {
      // Sown: only the seed and the disturbed earth show.
      ctx.fillStyle = 'rgba(58,42,26,0.7)';
      for (let i = 0; i < 14; i++) {
        const [px, py] = iso((rng() - 0.5) * 0.8, (rng() - 0.5) * 0.8);
        ctx.beginPath();
        ctx.ellipse(px, py, 1.5, 1, 0, 0, TAU);
        ctx.fill();
      }
      cache.set(key, spr!);
      return;
    }
    const grown = stage / 3;
    const plants: Array<[number, number]> = [];
    for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) plants.push([u * 0.26 + (rng() - 0.5) * 0.08, v * 0.26 + (rng() - 0.5) * 0.08]);
    plants.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
    for (const [u, v] of plants) {
      const [px, py] = iso(u, v);
      const h = (look === 'grain' ? 10 : look === 'leaf' ? 6 : 5) * (0.45 + grown * 0.85);
      const w = (look === 'leaf' ? 7 : 4.5) * (0.5 + grown * 0.7);
      ctx.strokeStyle = leaf;
      ctx.fillStyle = leaf;
      if (look === 'grain') {
        // A stalk with an ear on top once it is up.
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px + 1, py - h * 0.6, px + 1.6, py - h);
        ctx.stroke();
        if (stage >= 2) {
          ctx.fillStyle = stage === 3 ? fruit : leaf;
          ctx.beginPath();
          ctx.ellipse(px + 1.8, py - h - 1.6, 1.7, 3.4 * (stage === 3 ? 1.15 : 0.8), 0.2, 0, TAU);
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
        ctx.lineWidth = 1.2;
        for (const d of [-1, 0, 1]) {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(px + d * 2, py - h * 0.6, px + d * 3.4, py - h);
          ctx.stroke();
        }
        if (stage === 3) {
          ctx.fillStyle = fruit;
          for (const d of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(px + d * 3.2, py - h - 0.5, 2.2, 0, TAU);
            ctx.fill();
          }
        }
      } else {
        // Roots and herbs: a low tuft, with the crop showing at the soil when ripe.
        ctx.lineWidth = 1.4;
        for (const d of [-1.2, 0, 1.2]) {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(px + d * 1.6, py - h * 0.7, px + d * 2.6, py - h);
          ctx.stroke();
        }
        if (stage === 3) {
          ctx.fillStyle = fruit;
          if (look === 'root') {
            ctx.beginPath();
            ctx.ellipse(px, py + 0.6, 3.2, 2.1, 0, 0, TAU);
            ctx.fill();
          } else {
            for (const d of [-1, 1]) {
              ctx.beginPath();
              ctx.arc(px + d * 2.2, py - h * 0.75, 1.5, 0, TAU);
              ctx.fill();
            }
          }
        }
      }
    }
  });
  cache.set(key, spr);
  return spr;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A campfire filling a two by two block of subtiles: a ring of stones, logs
 * laid across it, and flames that flicker while it burns. Drawn live rather
 * than cached so the fire moves.
 */
export function drawCampfire(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, lit: boolean, fuel: number, time: number): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  // The ring of stones, an iso diamond two subtiles across.
  const rx = 22;
  const ry = 11;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2a2420';
  ctx.beginPath();
  ctx.ellipse(0, -1, rx - 4, ry - 2, 0, 0, TAU);
  ctx.fill();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + 0.2;
    const stx = Math.cos(a) * (rx - 2);
    const sty = Math.sin(a) * (ry - 1) - 1;
    ctx.fillStyle = i % 2 ? '#8b8781' : '#6f6b66';
    ctx.beginPath();
    ctx.ellipse(stx, sty, 3.6, 2.6, a, 0, TAU);
    ctx.fill();
  }
  // Logs laid across the pit, shrinking as the fuel goes.
  const load = Math.max(0.25, Math.min(1, fuel / 900));
  ctx.strokeStyle = lit ? '#3a2a1c' : '#6b5236';
  ctx.lineCap = 'round';
  for (const [a, len] of [
    [0.5, 15],
    [-0.6, 13],
    [2.4, 12],
  ] as Array<[number, number]>) {
    const l = len * load;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * -l, Math.sin(a) * -l * 0.5 - 2);
    ctx.lineTo(Math.cos(a) * l, Math.sin(a) * l * 0.5 - 2);
    ctx.stroke();
  }
  if (lit) {
    // Embers under the flames.
    ctx.fillStyle = 'rgba(226,106,40,0.55)';
    ctx.beginPath();
    ctx.ellipse(0, -2, rx - 8, ry - 4, 0, 0, TAU);
    ctx.fill();
    // Three tongues of flame on their own rhythms.
    const flames: Array<[number, number, number, string]> = [
      [0, 1, 0.9, '#f0c23c'],
      [-5, 1.7, 0.7, '#e8863a'],
      [5, 2.6, 0.65, '#e06a2c'],
    ];
    for (const [ox, speed, scale, color] of flames) {
      const wob = Math.sin(time * speed * 3.1 + ox) * 1.6;
      const h = (16 + Math.sin(time * speed * 4.3 + ox) * 4) * scale;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(ox - 5 * scale, -3);
      ctx.quadraticCurveTo(ox - 6 * scale + wob, -h * 0.55, ox + wob * 0.6, -h);
      ctx.quadraticCurveTo(ox + 6 * scale + wob, -h * 0.55, ox + 5 * scale, -3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,240,190,0.85)';
    const ih = 7 + Math.sin(time * 5.5) * 2;
    ctx.beginPath();
    ctx.moveTo(-2.4, -3);
    ctx.quadraticCurveTo(-2.6, -ih * 0.6, 0, -ih);
    ctx.quadraticCurveTo(2.6, -ih * 0.6, 2.4, -3);
    ctx.closePath();
    ctx.fill();
  } else if (fuel > 0) {
    ctx.fillStyle = 'rgba(120,110,96,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, -2, rx - 9, ry - 5, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** A stone smelter: a squat chimney with a firebox that glows when hot. */
export function drawSmelter(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, lit: boolean, working: boolean, time: number): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 34, 17, 0, 0, TAU);
  ctx.fill();
  // The stone base, drawn as an iso block three subtiles by two.
  const w = 32;
  const d = 16;
  const h = 30;
  const base = '#7d7a74';
  const dark = '#5c5а56'.replace('а', 'a');
  const top = '#928e86';
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.moveTo(-w, -d / 2);
  ctx.lineTo(0, d / 2);
  ctx.lineTo(0, d / 2 - h);
  ctx.lineTo(-w, -d / 2 - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(0, d / 2);
  ctx.lineTo(w, -d / 2);
  ctx.lineTo(w, -d / 2 - h);
  ctx.lineTo(0, d / 2 - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(-w, -d / 2 - h);
  ctx.lineTo(0, d / 2 - h);
  ctx.lineTo(w, -d / 2 - h);
  ctx.lineTo(0, -d / 2 - h - d / 2 - 4);
  ctx.closePath();
  ctx.fill();
  // Courses of stone.
  ctx.strokeStyle = 'rgba(40,38,34,0.35)';
  ctx.lineWidth = 1;
  for (const k of [0.3, 0.6]) {
    ctx.beginPath();
    ctx.moveTo(-w, -d / 2 - h * k);
    ctx.lineTo(0, d / 2 - h * k);
    ctx.lineTo(w, -d / 2 - h * k);
    ctx.stroke();
  }
  // The chimney.
  ctx.fillStyle = top;
  ctx.fillRect(-7, -h - 26, 14, 16);
  ctx.fillStyle = dark;
  ctx.fillRect(3, -h - 26, 4, 16);
  ctx.fillStyle = '#3b3833';
  ctx.beginPath();
  ctx.ellipse(0, -h - 26, 7, 3, 0, 0, TAU);
  ctx.fill();
  // The firebox mouth, and the heat coming out of it.
  const mouthY = -h * 0.42;
  ctx.fillStyle = lit ? '#f0a03c' : '#2b2723';
  ctx.beginPath();
  ctx.moveTo(-11, mouthY + 6);
  ctx.lineTo(0, mouthY + 12);
  ctx.lineTo(11, mouthY + 6);
  ctx.lineTo(11, mouthY - 7);
  ctx.lineTo(0, mouthY - 1);
  ctx.lineTo(-11, mouthY - 7);
  ctx.closePath();
  ctx.fill();
  if (lit) {
    ctx.fillStyle = 'rgba(255,238,180,0.85)';
    const f = 3 + Math.sin(time * 6) * 1.4;
    ctx.beginPath();
    ctx.ellipse(0, mouthY + 3, 6, f, 0, 0, TAU);
    ctx.fill();
    // Smoke from the chimney, thicker while there is work in it.
    ctx.fillStyle = 'rgba(220,216,210,0.35)';
    const puffs = working ? 4 : 2;
    for (let i = 0; i < puffs; i++) {
      const t = (time * 0.5 + i / puffs) % 1;
      ctx.globalAlpha = 0.4 * (1 - t);
      ctx.beginPath();
      ctx.arc(Math.sin((time + i) * 1.5) * 4, -h - 30 - t * 26, 3 + t * 6, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** A kiln: a brick beehive with a stoke hole at the foot and a vent on top. */
export function drawKiln(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, lit: boolean, working: boolean, time: number): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 24, 12, 0, 0, TAU);
  ctx.fill();
  const brick = '#8e6a52';
  const dark = '#6c4e3c';
  const pale = '#a8836a';
  // The dome, squat and round, sitting on a low plinth.
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(0, -3, 21, 9, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = brick;
  ctx.beginPath();
  ctx.moveTo(-20, -4);
  ctx.bezierCurveTo(-20, -30, -11, -38, 0, -38);
  ctx.bezierCurveTo(11, -38, 20, -30, 20, -4);
  ctx.ellipse(0, -4, 20, 8, 0, 0, Math.PI, true);
  ctx.closePath();
  ctx.fill();
  // A lit face on the left, courses of brick across it.
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.moveTo(-20, -4);
  ctx.bezierCurveTo(-20, -30, -11, -38, 0, -38);
  ctx.lineTo(0, -4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(48,34,26,0.35)';
  ctx.lineWidth = 0.9;
  for (const [w, y] of [
    [19.4, -11],
    [17.2, -20],
    [12.6, -28],
  ] as Array<[number, number]>) {
    ctx.beginPath();
    ctx.ellipse(0, y, w, w * 0.36, 0, 0.15, Math.PI - 0.15);
    ctx.stroke();
  }
  // The vent at the crown.
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(0, -38, 5.4, 2.4, 0, 0, TAU);
  ctx.fill();
  if (lit) {
    ctx.fillStyle = 'rgba(255,196,108,0.7)';
    ctx.beginPath();
    ctx.ellipse(0, -38, 3.6, 1.5, 0, 0, TAU);
    ctx.fill();
  }
  // The stoke hole, arched, with the fire showing through it when it is going.
  ctx.fillStyle = lit ? '#f2a53f' : '#2a2320';
  ctx.beginPath();
  ctx.moveTo(-7, -3);
  ctx.lineTo(-7, -12);
  ctx.quadraticCurveTo(0, -19, 7, -12);
  ctx.lineTo(7, -3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = pale;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  if (lit) {
    ctx.fillStyle = 'rgba(255,240,190,0.85)';
    const f = 3.4 + Math.sin(time * 6.5) * 1.5;
    ctx.beginPath();
    ctx.ellipse(0, -6, 4.6, f, 0, 0, TAU);
    ctx.fill();
    // Heat off the crown, heavier while there is ware inside.
    ctx.fillStyle = 'rgba(224,218,208,0.4)';
    const puffs = working ? 4 : 2;
    for (let i = 0; i < puffs; i++) {
      const t = (time * 0.45 + i / puffs) % 1;
      ctx.globalAlpha = 0.35 * (1 - t);
      ctx.beginPath();
      ctx.arc(Math.sin((time + i) * 1.4) * 3.5, -42 - t * 22, 2.4 + t * 5, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** An anvil on its block, coloured by the metal it was cast from. */
/**
 * A work post: a pointed stake with a crossbar nailed near the top and a
 * strip of metal tacked to it for a marker. It leans further the more rotten
 * it is, and the marker hangs the right way up only while somebody is working
 * out of it.
 */
/**
 * A trap on the ground. A snare is a bent shaft with a loop of rope pegged
 * open at the foot of it; a deadfall is a board propped on a stick over the
 * bait. Either one is drawn sprung when there is something in it.
 */
/**
 * One tile of bridge deck, drawn at the height the deck is carried at. The
 * unfinished part is drawn as bare stringers so you can see what is left.
 */
export function drawDeck(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  zoom: number,
  kind: string,
  done: boolean,
  drop: number,
): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  // The deck fills its tile exactly, or the spans do not meet.
  const W = 48;
  const D = 24;
  const stone = kind === 'stone';
  const top = stone ? '#9a968c' : kind === 'rope' ? '#8a7550' : '#7d6243';
  const side = stone ? '#6f6b62' : '#523d28';
  // What holds it up: piers for stone and wood, two hawsers for a rope bridge.
  if (drop > 2) {
    if (kind !== 'rope') {
      // A pier down into whatever is underneath, cut off before it gets silly.
      const h = Math.min(34, drop * 0.8);
      ctx.fillStyle = side;
      ctx.beginPath();
      ctx.moveTo(-5, 2);
      ctx.lineTo(5, 2);
      ctx.lineTo(5, 2 + h);
      ctx.lineTo(-5, 2 + h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(1, 2, 4, h);
    }
  }
  if (!done) {
    // Stringers only: two beams across the gap and nothing to walk on.
    ctx.strokeStyle = side;
    ctx.lineWidth = 1.6;
    for (const o of [-0.42, 0.42]) {
      ctx.beginPath();
      ctx.moveTo(-W, o * D * 0.5);
      ctx.lineTo(0, o * D + D * 0.5 * o);
      ctx.lineTo(W, o * D * 0.5);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  // The deck itself: a flat lozenge on the tile, with a lip on the near side.
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(-W, 0);
  ctx.lineTo(0, -D);
  ctx.lineTo(W, 0);
  ctx.lineTo(0, D);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = side;
  ctx.beginPath();
  ctx.moveTo(-W, 0);
  ctx.lineTo(0, D);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, 2);
  ctx.lineTo(0, D + 2);
  ctx.lineTo(-W, 2);
  ctx.closePath();
  ctx.fill();
  // Planking across the run, or the courses of an arch.
  ctx.strokeStyle = 'rgba(0,0,0,0.14)';
  ctx.lineWidth = 0.8;
  for (let i = -3; i <= 3; i++) {
    const t = i / 4;
    ctx.beginPath();
    ctx.moveTo(t * W, -D + Math.abs(t) * D);
    ctx.lineTo(t * W, D - Math.abs(t) * D);
    ctx.stroke();
  }
  if (kind === 'rope') {
    // Handropes along both sides, which is all that is between you and the drop.
    ctx.strokeStyle = '#cfc3a4';
    ctx.lineWidth = 1;
    for (const o of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-W, o * D * 0.5 - 5);
      ctx.lineTo(0, o * D - 6);
      ctx.lineTo(W, o * D * 0.5 - 5);
      ctx.stroke();
    }
  } else {
    // A kerb along both edges so the deck reads as something you stay on.
    ctx.strokeStyle = side;
    ctx.lineWidth = 1.4;
    for (const o of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-W, o * D * 0.5 - 1);
      ctx.lineTo(0, o * D - 1);
      ctx.lineTo(W, o * D * 0.5 - 1);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawTrap(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, kind: string, baited: boolean, sprung: boolean): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 6, 2.6, 0, 0, TAU);
  ctx.fill();
  const wood = '#6b543a';
  const dark = '#4a3a28';
  if (kind === 'creel') {
    // A woven basket sitting low, with a float and a line up to the bank.
    ctx.strokeStyle = '#cfc3a4';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(4, -5.5);
    ctx.lineTo(7, -9);
    ctx.stroke();
    ctx.fillStyle = '#c9b06a';
    ctx.beginPath();
    ctx.ellipse(-2, -2.4, 5.2, 3, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#a68f52';
    ctx.beginPath();
    ctx.ellipse(-2, -1.2, 5.2, 3, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#7d6a3c';
    ctx.lineWidth = 0.5;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.ellipse(-2, -2.4 + i * 1.1, 5.2 - Math.abs(i) * 0.8, 2.6, 0, Math.PI * 0.06, Math.PI * 0.94);
      ctx.stroke();
    }
    // The throat, turned inward.
    ctx.fillStyle = '#4a3f22';
    ctx.beginPath();
    ctx.ellipse(2.4, -2.6, 1.4, 1.1, 0, 0, TAU);
    ctx.fill();
    if (sprung) {
      ctx.fillStyle = '#8fb6c8';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(-3.4 + i * 1.6, -2.2 + (i % 2) * 0.9, 1.2, 0.5, 0, 0, TAU);
        ctx.fill();
      }
    }
    if (baited) {
      ctx.fillStyle = '#c06a4a';
      ctx.beginPath();
      ctx.ellipse(-2, -2.6, 0.9, 0.6, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  if (kind === 'deadfall') {
    // A board, propped at an angle on a stick, or lying flat once it has gone.
    ctx.strokeStyle = dark;
    ctx.lineWidth = 1;
    if (!sprung) {
      ctx.beginPath();
      ctx.moveTo(3, 0);
      ctx.lineTo(3, -6);
      ctx.stroke();
    }
    ctx.fillStyle = wood;
    ctx.beginPath();
    if (sprung) {
      ctx.moveTo(-6, -1.4);
      ctx.lineTo(6, -1.4);
      ctx.lineTo(6, 0.4);
      ctx.lineTo(-6, 0.4);
    } else {
      ctx.moveTo(-6, -1);
      ctx.lineTo(5, -7);
      ctx.lineTo(6, -5.6);
      ctx.lineTo(-5, 0.4);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(-6, sprung ? 0.2 : -0.4, 12, 0.7);
  } else {
    // A shaft bent over, with a noose off the head of it.
    ctx.strokeStyle = wood;
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    if (sprung) ctx.quadraticCurveTo(-3.4, -8, -2, -10);
    else ctx.quadraticCurveTo(-2, -8, 3, -7);
    ctx.stroke();
    ctx.strokeStyle = '#cfc3a4';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    if (sprung) ctx.ellipse(-2, -6, 1.1, 1.8, 0, 0, TAU);
    else ctx.ellipse(3, -2.2, 3.4, 1.5, 0, 0, TAU);
    ctx.stroke();
    if (!sprung) {
      ctx.beginPath();
      ctx.moveTo(3, -7);
      ctx.lineTo(3, -3.7);
      ctx.stroke();
    }
  }
  // A crumb of bait in the middle of it, so a set trap reads as set.
  if (baited && !sprung) {
    ctx.fillStyle = '#c06a4a';
    ctx.beginPath();
    ctx.ellipse(kind === 'deadfall' ? 0 : 3, -0.6, 1.1, 0.8, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

export function drawWorkPost(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, left: number, worked: boolean): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 5.5, 2.4, 0, 0, TAU);
  ctx.fill();
  // Standing straight when new and leaning badly by the end.
  ctx.rotate((1 - Math.max(0, Math.min(1, left))) * 0.3);
  const h = 26;
  ctx.strokeStyle = '#8a6a44';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(0, -1);
  ctx.lineTo(0, -h);
  ctx.stroke();
  ctx.strokeStyle = '#6d5234';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-6, -h + 6);
  ctx.lineTo(6, -h + 6);
  ctx.stroke();
  // The ribbon: bright while it is being worked, dull and furled when not.
  ctx.fillStyle = worked ? '#d8b03c' : '#8e8478';
  ctx.beginPath();
  if (worked) {
    ctx.moveTo(1, -h + 1);
    ctx.lineTo(9, -h + 4.5);
    ctx.lineTo(1, -h + 8);
  } else {
    ctx.moveTo(1, -h + 2);
    ctx.lineTo(5, -h + 4);
    ctx.lineTo(1, -h + 6);
  }
  ctx.closePath();
  ctx.fill();
  // A nail head apiece where the crossbar is fixed.
  ctx.fillStyle = '#4a463f';
  for (const nx of [-4.5, 4.5]) {
    ctx.beginPath();
    ctx.arc(nx, -h + 6, 0.8, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

export function drawAnvil(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, face: string, shade: string): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 10, 0, 0, TAU);
  ctx.fill();
  // Oak block.
  ctx.fillStyle = '#6b5236';
  ctx.beginPath();
  ctx.moveTo(-13, -4);
  ctx.lineTo(0, 2);
  ctx.lineTo(13, -4);
  ctx.lineTo(13, -12);
  ctx.lineTo(0, -6);
  ctx.lineTo(-13, -12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#4e3c28';
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.lineTo(13, -4);
  ctx.lineTo(13, -12);
  ctx.lineTo(0, -6);
  ctx.closePath();
  ctx.fill();
  // The anvil: waist, body and horn.
  ctx.fillStyle = shade;
  ctx.fillRect(-4, -18, 8, 8);
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.moveTo(-11, -18);
  ctx.lineTo(11, -18);
  ctx.lineTo(14, -22);
  ctx.lineTo(-9, -22);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.moveTo(11, -18);
  ctx.lineTo(14, -22);
  ctx.lineTo(14, -25);
  ctx.lineTo(11, -21);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.moveTo(-9, -22);
  ctx.lineTo(14, -22);
  ctx.lineTo(11, -25);
  ctx.lineTo(-7, -25);
  ctx.closePath();
  ctx.fill();
  // The horn.
  ctx.beginPath();
  ctx.moveTo(-7, -25);
  ctx.quadraticCurveTo(-16, -25, -19, -22);
  ctx.quadraticCurveTo(-14, -21, -9, -22);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The same colour taken down or brought up, for a far leg or a lit back. */
function shade(hex: string, by: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number): number => Math.max(0, Math.min(255, Math.round(by < 0 ? v * (1 + by) : v + (255 - v) * by)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export interface CreaturePose {
  /**
   * Which of the eight ways it is turned, as `facingOf` counts them: 0 coming
   * at you, 2 to screen right, 4 going away, 6 to screen left.
   */
  facing: number;
  phase: number;
  moving: boolean;
  /**
   * How hard it is going: 0 at an ordinary walk, 1 at a run.
   *
   * Read off the ground it actually covers rather than set by anything, so
   * every body gets one — a person, a peer, a hunter running you down, a
   * wildermon in the traces — with nothing added to any of them. Left out, it
   * is a walk, and every drawing here comes out exactly as it did before.
   */
  gait?: number;
  colors: [string, string];
  /** 0..1 health fraction; a bar shows when below 1. */
  health: number;
  label?: string;
  /** Species id; decides which body is drawn. */
  species?: string;
  /** How much fleece is on it, 0..1, for the species that grow one. */
  fleece?: number;
  /** How much of its full size it is: a yearling is small and an old one heavy. */
  scale?: number;
}

/**
 * A limb through its swing, shaped by how hard the thing is going.
 *
 * A walk and a run are not the same cycle at different speeds, which is what
 * this island has drawn for its whole life. Three things change:
 *
 *   **It swings further.** A run reaches, and by the better part of double.
 *
 *   **It stops being a sine.** A walking leg swings like a pendulum, because
 *   at a walk it more or less is one. A running leg is driven back hard and
 *   recovers fast, which is a wave leaning forward in time rather than a
 *   symmetrical one. A touch of the second harmonic is all that takes, and it
 *   is the difference between a thing trotting and a thing running for its
 *   life.
 *
 *   **A foot is always down at a walk and often not at a run**, which is what
 *   `gaitLift` is for: at a run the whole body leaves the ground twice a
 *   stride, and a run drawn without that reads as a very fast walk.
 *
 * At a gait of nought this is `Math.sin(phase * k + at)` and nothing else, to
 * the last bit. Every drawing in this file is untouched at a walk, which is
 * the only way to change fifty-two of them at once and sleep.
 */
export interface Moving {
  phase: number;
  moving: boolean;
  gait?: number;
}

export function gaitSin(pose: Moving, k = 1, at = 0): number {
  const p = pose.phase * k + at;
  const g = pose.gait ?? 0;
  if (g <= 0) return Math.sin(p);
  return (Math.sin(p) + g * 0.3 * Math.sin(2 * p)) * (1 + g * 0.55);
}

/**
 * How far a running body is off the ground, over and above whatever bob the
 * drawing already has. Twice a stride, and nothing at all at a walk.
 */
export const gaitLift = (pose: Moving): number =>
  pose.moving ? (pose.gait ?? 0) * Math.max(0, gaitSin(pose, 2)) * 1.6 : 0;

/**
 * And how far it is pitched into the run. A body at a sprint is leaning at
 * the ground ahead of it; a body strolling is upright.
 */
export const gaitPitch = (pose: Moving): number => (pose.moving ? (pose.gait ?? 0) * -0.13 : 0);

/**
 * A body seen from somewhere other than the side.
 *
 * Every animal on this island is drawn in profile, nose at +x and tail at -x,
 * and for a long time the only thing the view could do with that was mirror
 * it. So a rabba heading north and one heading east were the same picture, and
 * turning the camera did not turn the animal — it flipped, once, when the
 * heading crossed the screen's middle, and otherwise stood there showing you
 * the same flank however far round you walked. Reported as models twisting in
 * place, which is exactly what it looks like from inside the game.
 *
 * There is no second drawing here and there does not need to be one. A body is
 * long one way and thin the other, so what the angle decides is how much of
 * its length you are looking along:
 *
 *   `squash`  what is left of the length across the screen — all of it from
 *             the side, and only the animal's own thickness end on, which is
 *             why it never collapses to a line.
 *   `mirror`  which way the nose points, as before.
 *   `lean`    how far the far end rides up the screen. A thing pointed away
 *             has its nose deeper into the picture than its tail, and in a
 *             2:1 diamond a step into the picture is half a step up it.
 *
 * Eight angles out of one drawing, and every species gets them at once.
 */
/**
 * What is left of a body's length when you are looking straight down it.
 *
 * Half rather than the third an animal really is, because the truth reads as a
 * stick. A 2:1 diamond looks down steeply enough that a body end on is a tall
 * narrow thing however it is drawn, and the last sliver of width is what keeps
 * it an animal rather than a mark.
 */
const BODY_THICK = 0.5;
/**
 * And what is left of one that stands on two legs.
 *
 * A thing on four legs is long one way and narrow the other, which is the
 * whole reason turning it does anything. A thing on two is as wide from the
 * front as it is from the side — a goblin end on is a goblin, not a plank —
 * so it barely narrows at all, and what turning it moves is the face and the
 * arms rather than the outline.
 */
const UPRIGHT_THICK = 0.92;
/**
 * How far up the screen a step into the picture carries.
 *
 * A 2:1 diamond says a half exactly. A shade under, for the same reason the
 * thickness is a shade over: the far end of a long animal riding a full half
 * of its length up the screen puts its head above its own shoulders.
 */
const DEPTH_LEAN = 0.42;

export interface BodyTurn {
  mirror: number;
  squash: number;
  lean: number;
  /** A step along the body, nose-wards, as a screen vector. */
  along: [number, number];
  /** And a step across it, as a screen vector: the width of the animal. */
  across: [number, number];
}

export function beastTurn(facing: number, thick = BODY_THICK): BodyTurn {
  // Facing 2 is screen right, which is the angle every one of these is drawn
  // at, so that is where the turn is measured from.
  const a = ((facing - 2) / FACINGS) * TAU;
  const out = Math.cos(a);
  const at = -Math.sin(a);
  return {
    mirror: out < 0 ? -1 : 1,
    squash: Math.max(thick, Math.abs(out)),
    lean: at * DEPTH_LEAN,
    // The two directions anything on a body is placed along. Side on, the
    // length runs across the screen and the width runs up it; end on they
    // swap. Everything between falls out of the same two numbers.
    along: [out, at * DEPTH_LEAN],
    across: [at, -out * DEPTH_LEAN],
  };
}

/**
 * Step out of the turn at a point on the body, into plain drawing space.
 *
 * Inside the frame everything is squashed along the body and sheared, which is
 * what a flank wants and not what a head wants: a head is a ball and stays a
 * ball however you look at it, and what moves round is the face on it. So the
 * head is placed in body space — where it belongs, so it lands right — and
 * then drawn in a square space, out of the squash, with its ears and its eyes
 * put on it along the two directions the turn hands back.
 */
export function atBody(ctx: CanvasRenderingContext2D, pose: CreaturePose, x: number, y: number,
                       draw: (t: BodyTurn) => void): void {
  const t = beastTurn(pose.facing);
  const k = t.mirror * t.squash;
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(1 / k, -t.lean / k, 0, 1, 0, 0);
  draw(t);
  ctx.restore();
}

/**
 * Put the canvas into a body's own space: the origin at its feet, x along it
 * with the nose at +x, y up, turned to whichever way it is facing.
 *
 * Replaces the `translate` and `scale` every one of these used to open with,
 * so a body drawn in profile needs to know nothing at all about the angle.
 */
export function bodyFrame(ctx: CanvasRenderingContext2D, sx: number, sy: number, k: number, pose: CreaturePose,
                          thick = BODY_THICK): BodyTurn {
  const t = beastTurn(pose.facing, thick);
  /*
   * And off the ground, if it is running.
   *
   * Every drawing in here puts its feet at the origin and builds upward, so
   * lifting the whole body is one number here rather than a change to
   * nineteen bodies — and a run without it reads as a very fast walk, because
   * the one thing a walk never does is leave the ground.
   *
   * The pitch goes with it: a body at a sprint leans at the ground ahead of
   * it. It is applied about the feet, which is where a leaning body pivots,
   * and it is mirrored with the rest of the frame so a thing running to
   * screen left leans left.
   */
  ctx.transform(k * t.mirror * t.squash, 0, 0, k, sx, sy - gaitLift(pose) * k);
  const pitch = gaitPitch(pose);
  if (pitch) ctx.transform(1, 0, pitch, 1, 0, 0);
  if (t.lean) ctx.transform(1, t.lean, 0, 1, 0, 0);
  return t;
}

/**
 * Run a drawing flat on the ground, out of the lean the body is drawn with.
 *
 * A body pointed into the picture has its far end higher up the screen, and
 * the shear that does that is applied to the whole of it — which is right for
 * a body and wrong for the shadow it casts, because a shadow lies on the
 * ground and the ground does not lean. Left in, an animal coming at you stood
 * on a long diagonal smear.
 */
export function onGround(ctx: CanvasRenderingContext2D, pose: CreaturePose, draw: () => void): void {
  const { lean } = beastTurn(pose.facing);
  /*
   * And back down, if it is running.
   *
   * The lean was the whole of this when bodies learned to turn; a running
   * body that leaves the ground added the other half. A shadow does not go up
   * with the thing casting it — it stays where the light puts it, which for a
   * thing overhead is under the feet that left — so the lift has to come off
   * here as surely as the shear does. Left in, a galloping orse carries its
   * own shadow around at chest height.
   */
  const lift = gaitLift(pose);
  const pitch = gaitPitch(pose);
  if (!lean && !lift && !pitch) {
    draw();
    return;
  }
  ctx.save();
  if (pitch) ctx.transform(1, 0, pitch, 1, 0, 0);
  if (lift) ctx.translate(0, lift);
  if (lean) ctx.transform(1, -lean, 0, 1, 0, 0);
  draw();
  ctx.restore();
}

/** Draws a wildermon of any species with its feet at (sx, sy), then its health bar and name. */
/**
 * The things that are not wildermon. Three of them stand on two legs and
 * carry something; the fourth does not need to carry anything.
 */
interface MonsterShape {
  /** Overall size, against a goblin at one. */
  size: number;
  /** Half-width and half-height of the torso. */
  torso: [number, number];
  head: number;
  /** Tusks out of the lower jaw. */
  tusk?: number;
  /** What is in its hand: a notched blade, an axe, or a whole tree. */
  arm: 'blade' | 'axe' | 'club';
  /** How much it stoops. */
  hunch: number;
}

const MONSTER_SHAPES: Record<string, MonsterShape> = {
  goblin: { size: 0.78, torso: [4, 5], head: 3.4, arm: 'blade', hunch: 2.4 },
  orc: { size: 1.15, torso: [6, 7], head: 4.2, tusk: 1.6, arm: 'axe', hunch: 1.2 },
  ogre: { size: 1.75, torso: [9, 9.5], head: 5.4, tusk: 2.4, arm: 'club', hunch: 2 },
};

/** A thing on two legs with something in its hand. Feet at (sx, sy). */
function drawMonsterBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose, m: MonsterShape): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom * m.size, pose, UPRIGHT_THICK);
  const swing = pose.moving ? gaitSin(pose) * 3 : 0;
  const [tw, th] = m.torso;
  const hip = -(th + 6);
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 0, tw * 1.3, tw * 0.55, 0, 0, TAU);
    ctx.fill();
  });
  // Legs: short, wide and bent.
  ctx.fillStyle = pose.colors[0];
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * tw * 0.55 - 1.4, hip);
    ctx.lineTo(side * tw * 0.55 + 1.4, hip);
    ctx.lineTo(side * tw * 0.7 + 1.6 + side * swing * 0.3, -0.5);
    ctx.lineTo(side * tw * 0.7 - 1.8 + side * swing * 0.3, -0.5);
    ctx.closePath();
    ctx.fill();
  }
  // Torso, leaning forward.
  ctx.save();
  ctx.rotate((-m.hunch * Math.PI) / 180);
  ctx.fillStyle = pose.colors[0];
  ctx.beginPath();
  ctx.ellipse(0, hip - th * 0.8, tw, th, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pose.colors[1];
  ctx.beginPath();
  ctx.ellipse(tw * 0.25, hip - th * 0.55, tw * 0.6, th * 0.65, 0, 0, TAU);
  ctx.fill();
  // The arm and what is in it.
  const shoulder = hip - th * 1.35;
  ctx.strokeStyle = pose.colors[0];
  ctx.lineWidth = tw * 0.42;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tw * 0.5, shoulder);
  ctx.lineTo(tw * 1.3, shoulder + th * 0.5 + swing);
  ctx.stroke();
  const hx = tw * 1.3;
  const hy = shoulder + th * 0.5 + swing;
  if (m.arm === 'club') {
    ctx.strokeStyle = '#6b543a';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(hx - 1, hy + 5);
    ctx.lineTo(hx + 3, hy - th * 1.5);
    ctx.stroke();
    ctx.fillStyle = '#5a4630';
    ctx.beginPath();
    ctx.ellipse(hx + 3.4, hy - th * 1.6, 3.4, 4.4, 0.3, 0, TAU);
    ctx.fill();
  } else {
    ctx.strokeStyle = '#8d8f92';
    ctx.lineWidth = m.arm === 'axe' ? 2.2 : 1.3;
    ctx.beginPath();
    ctx.moveTo(hx, hy + 2);
    ctx.lineTo(hx + 2, hy - th * 1.3);
    ctx.stroke();
    if (m.arm === 'axe') {
      ctx.fillStyle = '#9a9ca0';
      ctx.beginPath();
      ctx.moveTo(hx + 2, hy - th * 1.3);
      ctx.lineTo(hx + 7, hy - th * 1.15);
      ctx.lineTo(hx + 2.6, hy - th * 0.8);
      ctx.closePath();
      ctx.fill();
    }
  }
  // Head, jaw and eyes.
  const headY = shoulder - m.head * 0.9;
  ctx.fillStyle = pose.colors[0];
  ctx.beginPath();
  ctx.ellipse(tw * 0.25, headY, m.head, m.head * 0.9, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pose.colors[1];
  ctx.beginPath();
  ctx.ellipse(tw * 0.25 + m.head * 0.55, headY + m.head * 0.35, m.head * 0.5, m.head * 0.4, 0, 0, TAU);
  ctx.fill();
  if (m.tusk) {
    ctx.fillStyle = '#e8e2cf';
    for (const side of [-0.15, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(tw * 0.25 + m.head * (0.35 + side), headY + m.head * 0.55);
      ctx.lineTo(tw * 0.25 + m.head * (0.5 + side), headY - m.tusk);
      ctx.lineTo(tw * 0.25 + m.head * (0.62 + side), headY + m.head * 0.55);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.fillStyle = '#e0574d';
  ctx.beginPath();
  ctx.ellipse(tw * 0.25 + m.head * 0.45, headY - m.head * 0.2, m.head * 0.16, m.head * 0.14, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

/** The one thing on the island with wings. Feet at (sx, sy). */
function drawDragonBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom * 2.1, pose);
  const beat = gaitSin(pose, 0.9) * 3;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 15, 6, 0, 0, TAU);
    ctx.fill();
  });
  // Wings behind, half spread.
  ctx.fillStyle = pose.colors[1];
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-1, -14);
    ctx.quadraticCurveTo(-14 * side, -26 - beat, -20 * side, -12 - beat);
    ctx.quadraticCurveTo(-10 * side, -14, -1, -10);
    ctx.closePath();
    ctx.fill();
  }
  // Tail, out behind and down.
  ctx.strokeStyle = pose.colors[0];
  ctx.lineWidth = 3.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-6, -9);
  ctx.quadraticCurveTo(-20, -6, -26, -1);
  ctx.stroke();
  // Legs.
  ctx.lineWidth = 3;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 4, -9);
    ctx.lineTo(side * 5.5, -0.5);
    ctx.stroke();
  }
  // Barrel.
  ctx.fillStyle = pose.colors[0];
  ctx.beginPath();
  ctx.ellipse(0, -11, 11, 6.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pose.colors[1];
  ctx.beginPath();
  ctx.ellipse(2, -8.5, 8, 3.6, 0, 0, TAU);
  ctx.fill();
  // Neck and head, carried high.
  ctx.strokeStyle = pose.colors[0];
  ctx.lineWidth = 4.4;
  ctx.beginPath();
  ctx.moveTo(7, -13);
  ctx.quadraticCurveTo(15, -20, 17, -26);
  ctx.stroke();
  ctx.fillStyle = pose.colors[0];
  ctx.beginPath();
  ctx.ellipse(18.5, -27.5, 5, 3.4, -0.35, 0, TAU);
  ctx.fill();
  // Jaw, horns and an eye that is looking at you.
  ctx.fillStyle = pose.colors[1];
  ctx.beginPath();
  ctx.moveTo(17, -26);
  ctx.lineTo(24.5, -27.5);
  ctx.lineTo(17.5, -24.6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = pose.colors[1];
  ctx.lineWidth = 1.1;
  for (const o of [0, 1.6]) {
    ctx.beginPath();
    ctx.moveTo(16.5 - o * 0.4, -29.4);
    ctx.lineTo(13 - o, -33.4);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffd76a';
  ctx.beginPath();
  ctx.ellipse(19.6, -28.8, 1.1, 0.9, 0, 0, TAU);
  ctx.fill();
  // Plates along the spine.
  ctx.fillStyle = pose.colors[1];
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 4 - 1.6, -16.5);
    ctx.lineTo(i * 4, -20.5);
    ctx.lineTo(i * 4 + 1.6, -16.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawCreature(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  // Age is drawn rather than written: a yearling is two thirds the size of
  // its parents and an old one has put weight on.
  zoom *= pose.scale ?? 1;
  const kept = standingSprite(pose);
  if (kept) ctx.drawImage(kept.canvas, sx - kept.ax * zoom, sy - kept.ay * zoom, kept.w * zoom, kept.h * zoom);
  else drawBody(ctx, sx, sy, zoom, pose);
  drawCreatureOverlay(ctx, sx, sy, zoom, pose);
}

/** One body, drawn out of paths, with its feet at (sx, sy). */
function drawBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  const own = pose.species ? OWN_BODY[pose.species] : undefined;
  if (own) own(ctx, sx, sy, zoom, pose);
  else if (pose.species && MONSTER_SHAPES[pose.species]) drawMonsterBody(ctx, sx, sy, zoom, pose, MONSTER_SHAPES[pose.species]);
  else if (pose.species && BEASTS[pose.species]) drawBeastBody(ctx, sx, sy, zoom, pose, BEASTS[pose.species]);
  else if (pose.species && BIRDS[pose.species]) drawBirdBody(ctx, sx, sy, zoom, pose, BIRDS[pose.species]);
  else drawRabbaBody(ctx, sx, sy, zoom, pose);
}

/**
 * How much room a body is given on its own canvas, and where its feet sit on
 * it. Generous on purpose: the box is measured back to the ink that was
 * actually laid down, so being too big costs one pass over some empty pixels
 * when a species is first drawn and nothing thereafter, while being too small
 * would clip an animal and there would be no way to tell from the code.
 */
const BODY_PAD = 256;
const BODY_FOOT = 384;
/** And how tall the pad is: everything above the feet, and a little below. */
const BODY_SKY = 448;
/** A fleece grows; five steps of it is finer than anybody can see. */
const FLEECE_STEPS = 5;

/**
 * A standing body, kept as a picture rather than drawn again every frame.
 *
 * Every animal on the island was fifty-odd path operations per frame —
 * ellipses, strokes, fills — where a tree is one `drawImage`. Thirty of them
 * on screen is fifteen hundred canvas calls a frame for bodies alone.
 *
 * Only while it is standing still and settled: a walk is a continuous thing
 * and cutting it into frames would either read as steppy or want more pictures
 * than the memory is worth. What that leaves is the common case and the one
 * that hurts — a settled deed with a dozen animals standing about it, and
 * every idle beast on a live island. `gait` is eased rather than switched, so
 * the wait for it to reach nought is what keeps a body that has just stopped
 * from being frozen halfway out of its run.
 *
 * Nothing that changes without the body changing is in here: the health bar,
 * the name and the hit flash are all drawn over the top, live, as before.
 */
function standingSprite(pose: CreaturePose): Sprite | null {
  if (pose.moving || (pose.gait ?? 0) > 0.02 || !pose.species) return null;
  const fleece = Math.round((pose.fleece ?? 1) * (FLEECE_STEPS - 1));
  const key = `${SPRITE_SCALE}|body:${pose.species}:${pose.colors.join(',')}:${pose.facing ?? 0}:${fleece}`;
  const had = cache.get(key);
  if (had) return had;
  const still: CreaturePose = { ...pose, moving: false, gait: 0, scale: 1, health: 1, label: undefined };
  const box = inkBox((ctx) => drawBody(ctx, BODY_PAD, BODY_FOOT, 1, still), BODY_PAD * 2, BODY_SKY);
  // A body that laid down no ink at all is not worth a canvas; draw it live.
  if (!box) return null;
  const spr = makeSprite(box.w, box.h, BODY_PAD - box.x, BODY_FOOT - box.y,
    (ctx) => drawBody(ctx, BODY_PAD - box.x, BODY_FOOT - box.y, 1, still), 1);
  cache.set(key, spr);
  return spr;
}

/**
 * Where a drawing actually put ink, so a picture of it can be cut to size.
 *
 * Done once per body the first time it is wanted and never again: the
 * alternative is a box guessed by hand, which is either wasteful or clips
 * something, and a clipped animal is the sort of fault that sits there for
 * weeks because nothing in the code says it is happening.
 */
function inkBox(draw: (ctx: CanvasRenderingContext2D) => void, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  const pad = document.createElement('canvas');
  pad.width = w;
  pad.height = h;
  const ctx = pad.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  draw(ctx);
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  // A pixel of slack all round, so nothing is shaved by rounding on the blit.
  x0 = Math.max(0, x0 - 1);
  y0 = Math.max(0, y0 - 1);
  x1 = Math.min(w - 1, x1 + 1);
  y1 = Math.min(h - 1, y1 + 1);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * The species that are drawn by hand rather than off one of the three shape
 * tables. This was a ladder of twenty-odd string comparisons walked for every
 * creature on screen on every frame, with a dragon — the last of them — paying
 * for all nineteen in front of it.
 */
const OWN_BODY: Record<string, (ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose) => void> = {
  vola: drawVolaBody, bevere: drawBevereBody, seavic: drawSeavicBody, mola: drawMolaBody,
  crawler: drawCrawlerBody, noot: drawNootBody, embra: drawEmbraBody, quarra: drawQuarraBody,
  woola: drawWoolaBody, ulva: drawUlvaBody, magga: drawMaggaBody, roxxen: drawRoxxenBody,
  orse: drawOrseBody, rowl: drawRowlBody, vesp: drawVespBody, lume: drawLumeBody,
  dragon: drawDragonBody,
};

/** A Roxxen: a wall of ox, head low, horns forward. Feet at (sx, sy). */
function drawRoxxenBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose);
  const plod = pose.moving ? Math.abs(gaitSin(pose, 0.8)) * 0.8 : 0;
  const [hide, pale] = pose.colors;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 14, 5.6, 0, 0, TAU);
    ctx.fill();
  });
  // Four posts of legs, swinging slowly and barely leaving the ground.
  ctx.strokeStyle = hide;
  ctx.lineWidth = 3.4;
  ctx.lineCap = 'round';
  for (const [lx, ph] of [[-7, 0], [-5, Math.PI], [5.5, Math.PI], [7.5, 0]] as Array<[number, number]>) {
    const step = pose.moving ? gaitSin(pose, 0.8, ph) * 1.6 : 0;
    ctx.beginPath();
    ctx.moveTo(lx, -10 - plod);
    ctx.lineTo(lx + step, -0.8);
    ctx.stroke();
  }
  // A deep barrel of a body with a hump over the shoulders.
  ctx.fillStyle = hide;
  ctx.beginPath();
  ctx.ellipse(-0.5, -13 - plod, 10.5, 6.4, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(4.5, -18 - plod, 5, 3.4, -0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(-1, -9.5 - plod, 8, 2.6, 0, 0, TAU);
  ctx.fill();
  // Tail with a tuft on the end of it.
  ctx.strokeStyle = hide;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-10, -15 - plod);
  ctx.quadraticCurveTo(-13.5, -12 - plod, -12.6, -5 - plod);
  ctx.stroke();
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(-12.6, -4.2 - plod, 1.2, 2, 0, 0, TAU);
  ctx.fill();
  // Head carried low, and horns that sweep forward past the muzzle.
  ctx.fillStyle = hide;
  ctx.beginPath();
  ctx.ellipse(11.5, -13 - plod, 5, 4.2, 0.15, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(15.5, -11.5 - plod, 3.4, 2.6, 0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(17.4, -11 - plod, 1.8, 1.7, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#e8e2d0';
  ctx.lineWidth = 2;
  for (const up of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(10.5, -16.5 - plod + up * 0.8);
    ctx.quadraticCurveTo(15, -18.5 - plod + up * 1.6, 18.5, -15.5 - plod + up * 2.4);
    ctx.stroke();
  }
  ctx.fillStyle = '#2a2018';
  ctx.beginPath();
  ctx.arc(13.4, -14 - plod, 0.8, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** An Orse: long legs, deep chest, a mane over one side. Feet at (sx, sy). */
function drawOrseBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose);
  const gait = pose.moving ? Math.abs(gaitSin(pose)) * 1.4 : 0;
  const [coat, mane] = pose.colors;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 12, 4.8, 0, 0, TAU);
    ctx.fill();
  });
  // Long legs, a fore and a hind pair out of phase.
  ctx.strokeStyle = coat;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  for (const [lx, ph] of [[-6.4, 0], [-4.6, Math.PI], [5, Math.PI], [7, 0]] as Array<[number, number]>) {
    const swing = pose.moving ? gaitSin(pose, 1, ph) * 3 : 0;
    ctx.beginPath();
    ctx.moveTo(lx, -13 - gait);
    ctx.quadraticCurveTo(lx + swing * 0.4, -7 - gait, lx + swing, -0.7);
    ctx.stroke();
  }
  // Barrel and quarters.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(0, -15.5 - gait, 9.4, 4.8, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-6.4, -16 - gait, 4.4, 4.4, 0, 0, TAU);
  ctx.fill();
  // Tail.
  ctx.strokeStyle = mane;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-9.6, -17 - gait);
  ctx.quadraticCurveTo(-13.4, -13 - gait, -12.4, -5.5 - gait);
  ctx.stroke();
  // Neck up to a small head, with the mane lying along it.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.moveTo(6, -13 - gait);
  ctx.quadraticCurveTo(10.6, -16 - gait, 12.4, -23 - gait);
  ctx.lineTo(15.4, -22.4 - gait);
  ctx.quadraticCurveTo(13.6, -15.4 - gait, 9.6, -12.4 - gait);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = mane;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(7.6, -17.4 - gait);
  ctx.quadraticCurveTo(11.4, -20 - gait, 13.2, -24 - gait);
  ctx.stroke();
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(15, -24 - gait, 3.6, 2.5, 0.35, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(17.6, -22.4 - gait, 2.2, 1.7, 0.35, 0, TAU);
  ctx.fill();
  // Ears pricked, and an eye.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.moveTo(13.4, -26.4 - gait);
  ctx.lineTo(14.4, -29 - gait);
  ctx.lineTo(15.4, -26 - gait);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#20191a';
  ctx.beginPath();
  ctx.arc(15.8, -24.4 - gait, 0.8, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A Rowl: leaner than an Ulva, ruffed at the shoulder, nose down. */
function drawRowlBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose);
  const lope = pose.moving ? Math.abs(gaitSin(pose, 1.2)) * 1.1 : 0;
  const [coat, ruff] = pose.colors;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 11, 4.4, 0, 0, TAU);
    ctx.fill();
  });
  ctx.strokeStyle = coat;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  for (const [lx, ph] of [[-5.4, 0], [-3.8, Math.PI], [4.2, Math.PI], [6, 0]] as Array<[number, number]>) {
    const swing = pose.moving ? gaitSin(pose, 1.2, ph) * 2.6 : 0.2;
    ctx.beginPath();
    ctx.moveTo(lx, -9.5 - lope);
    ctx.quadraticCurveTo(lx + swing * 0.5, -5 - lope, lx + swing, -0.7);
    ctx.stroke();
  }
  // A long back that drops away to the hips.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.moveTo(-7.6, -9.4 - lope);
  ctx.quadraticCurveTo(-2, -12.6 - lope, 4.4, -13.6 - lope);
  ctx.quadraticCurveTo(9, -13.8 - lope, 9.4, -9.6 - lope);
  ctx.quadraticCurveTo(2, -7.4 - lope, -7.2, -7.6 - lope);
  ctx.closePath();
  ctx.fill();
  // The ruff, which is what tells it from an Ulva at a distance.
  ctx.fillStyle = ruff;
  ctx.beginPath();
  ctx.ellipse(6.6, -12 - lope, 3.6, 3.2, -0.3, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(1.5, -8.6 - lope, 3.6, 1.4, -0.1, 0, TAU);
  ctx.fill();
  // Brush of a tail, carried low.
  ctx.strokeStyle = coat;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-7.6, -10.2 - lope);
  ctx.quadraticCurveTo(-12.4, -9 - lope, -14.8, -5.6 - lope);
  ctx.stroke();
  // Head low and long, muzzle first, ears back.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(10.4, -11.4 - lope, 3.8, 3, -0.18, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(12.2, -12.6 - lope);
  ctx.lineTo(17.4, -10.4 - lope);
  ctx.lineTo(12.2, -9 - lope);
  ctx.closePath();
  ctx.fill();
  for (const dx of [-1.4, 0.9]) {
    ctx.beginPath();
    ctx.moveTo(9.4 + dx, -13.8 - lope);
    ctx.lineTo(9.9 + dx, -16.4 - lope);
    ctx.lineTo(11.4 + dx, -13.4 - lope);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#c9a227';
  ctx.beginPath();
  ctx.arc(12.2, -12 - lope, 0.75, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#1b1714';
  ctx.beginPath();
  ctx.arc(17.2, -10.4 - lope, 0.7, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A Rabba: round body, long ears, twitchy. Feet at (sx, sy). */
function drawRabbaBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose);
  const hop = pose.moving ? Math.abs(gaitSin(pose)) * 3 : 0;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 11, 5, 0, 0, TAU);
    ctx.fill();
  });
  const [fur, belly] = pose.colors;
  // body and belly
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(-0.5, -6 - hop, 7.5, 5.2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(0.5, -4.5 - hop, 4.5, 2.6, 0, 0, TAU);
  ctx.fill();
  // tail
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.arc(-7.5, -6.5 - hop, 2, 0, TAU);
  ctx.fill();
  /*
   * The head, and the two ears over it, placed rather than drawn flat.
   *
   * A rabba is the commonest thing on the island and the one most often seen
   * from behind, so the pair of ears wants to open out as it turns away from
   * you and the face wants to be gone when it has. The two directions come
   * from the turn; the drawing knows nothing about the angle.
   */
  atBody(ctx, pose, 5, -10 - hop, (t) => {
    const out = (n: number): [number, number] => [t.along[0] * n, t.along[1] * n];
    const wide = (n: number): [number, number] => [t.across[0] * n, t.across[1] * n];
    const front = t.along[1] >= -1e-6;
    const [bx, bY] = out(-1.2);
    for (const side of [-1, 1]) {
      const [ex, ey] = wide(side * 1.7);
      ctx.fillStyle = fur;
      ctx.beginPath();
      ctx.ellipse(bx + ex, bY + ey - 5.8, 1.7, 5, side * 0.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#e8a6a6';
      ctx.beginPath();
      ctx.ellipse(bx + ex, bY + ey - 5.8, 0.7, 3, side * 0.2, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.arc(0, 0, 4.2, 0, TAU);
    ctx.fill();
    if (!front) return;
    ctx.fillStyle = '#2a1a10';
    for (const side of [-1, 1]) {
      const [ex, ey] = wide(side * 1.4);
      const [fx, fy] = out(1.5);
      ctx.beginPath();
      ctx.arc(fx + ex, fy + ey - 1, 0.9, 0, TAU);
      ctx.fill();
    }
    const [nx, ny] = out(4);
    ctx.fillStyle = '#d98f8f';
    ctx.beginPath();
    ctx.arc(nx, ny + 0.5, 0.8, 0, TAU);
    ctx.fill();
  });
  ctx.restore();
}

/**
 * A Vola: a low, velvety digger. Broad pale shovel paws in front, a pink
 * snout, tiny eyes and a stubby tail. It waddles rather than hops.
 */
function drawVolaBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose);
  // A waddle: the body rocks side to side instead of leaving the ground.
  const rock = pose.moving ? gaitSin(pose) * 0.9 : gaitSin(pose, 0.25) * 0.15;
  const lift = pose.moving ? Math.abs(gaitSin(pose)) * 0.8 : 0;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 11, 5, 0, 0, TAU);
    ctx.fill();
  });
  const [fur, belly] = pose.colors;
  const paw = '#e9cdbd';
  // hind foot
  ctx.fillStyle = paw;
  ctx.beginPath();
  ctx.ellipse(-5, -1.6, 2.4, 1.4, 0, 0, TAU);
  ctx.fill();
  // tail: short and tapered
  ctx.strokeStyle = belly;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-7.5, -4.5 - lift);
  ctx.quadraticCurveTo(-10.5, -5.5 - lift, -11, -8 - lift);
  ctx.stroke();
  // body: a long low loaf that tapers into the snout
  ctx.save();
  ctx.rotate(rock * 0.03);
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(-0.5, -5 - lift, 8.2, 4.4, -0.06, 0, TAU);
  ctx.fill();
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(-0.5, -3.4 - lift, 5.6, 2.2, -0.06, 0, TAU);
  ctx.fill();
  // head runs straight on from the body, no neck
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(6, -5.6 - lift, 4, 3.6, 0, 0, TAU);
  ctx.fill();
  // snout
  ctx.fillStyle = '#e8a0a4';
  ctx.beginPath();
  ctx.ellipse(9.6, -4.9 - lift, 2.1, 1.5, 0.25, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#c9767c';
  ctx.beginPath();
  ctx.arc(11.1, -4.7 - lift, 0.7, 0, TAU);
  ctx.fill();
  // whiskers
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 0.5;
  for (const a of [-0.35, 0, 0.35]) {
    ctx.beginPath();
    ctx.moveTo(10.4, -4.9 - lift);
    ctx.lineTo(13.6, -4.9 - lift + a * 3.4);
    ctx.stroke();
  }
  // eye: a bead, nearly buried in fur
  ctx.fillStyle = '#221712';
  ctx.beginPath();
  ctx.arc(6.4, -6.6 - lift, 0.7, 0, TAU);
  ctx.fill();
  // ear: a small fold, no pinna
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(3.4, -7.6 - lift, 1.2, 0.9, -0.3, 0, TAU);
  ctx.fill();
  ctx.restore();
  // digging paws: broad, pale and turned outward, swinging as it walks
  const dig = pose.moving ? gaitSin(pose) * 1.6 : 0;
  ctx.fillStyle = paw;
  for (const [px, py, ph] of [
    [5.6, -1.2, dig],
    [3.2, -1.6, -dig],
  ] as Array<[number, number, number]>) {
    ctx.save();
    ctx.translate(px + ph * 0.6, py - Math.max(0, ph) * 0.5);
    ctx.rotate(0.3);
    ctx.beginPath();
    ctx.ellipse(0, 0, 2.8, 1.7, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#c9a692';
    ctx.lineWidth = 0.4;
    for (const c of [-1.1, 0, 1.1]) {
      ctx.beginPath();
      ctx.moveTo(1.2, c * 0.5);
      ctx.lineTo(3.1, c * 0.75);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/**
 * A Bevere: heavy in the haunches, low to the ground, with a broad scaled tail
 * it drags behind, small round ears and a pair of orange teeth.
 */
function drawBevereBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose);
  const waddle = pose.moving ? Math.abs(gaitSin(pose)) * 1.1 : 0;
  const sway = pose.moving ? gaitSin(pose) * 2.2 : gaitSin(pose, 0.3) * 0.6;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 11, 5, 0, 0, TAU);
    ctx.fill();
  });
  const [fur, belly] = pose.colors;
  // The tail: a broad paddle dragged behind, swinging as it walks.
  ctx.save();
  ctx.translate(-7, -3 - waddle);
  ctx.rotate(sway * 0.05);
  ctx.fillStyle = '#4a3c34';
  ctx.beginPath();
  ctx.ellipse(-4.5, 1.5, 6.2, 2.9, -0.12, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 0.5;
  for (const d of [-2.5, 0, 2.5]) {
    ctx.beginPath();
    ctx.moveTo(-8.5, 1.5 + d * 0.35);
    ctx.lineTo(-1, 1.5 + d * 0.5);
    ctx.stroke();
  }
  ctx.restore();
  // Hind foot and body.
  ctx.fillStyle = '#3f342c';
  ctx.beginPath();
  ctx.ellipse(-3.5, -0.8, 2.8, 1.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(-0.5, -6 - waddle, 8.6, 5.4, -0.05, 0, TAU);
  ctx.fill();
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(0, -4 - waddle, 6, 2.6, -0.05, 0, TAU);
  ctx.fill();
  // Head: blunt and set low on the shoulders.
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.arc(6.5, -8 - waddle, 4.4, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(9.8, -6.6 - waddle, 2.6, 2.1, 0.15, 0, TAU);
  ctx.fill();
  // Small round ear.
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.arc(4.2, -11 - waddle, 1.5, 0, TAU);
  ctx.fill();
  // Eye, nose and the orange teeth it is known for.
  ctx.fillStyle = '#241a12';
  ctx.beginPath();
  ctx.arc(7.6, -9 - waddle, 0.8, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(11.8, -6.8 - waddle, 0.8, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#e0a03c';
  ctx.fillRect(10.3, -5.6 - waddle, 1.5, 2.2);
  // Front paw.
  ctx.fillStyle = '#3f342c';
  ctx.beginPath();
  ctx.ellipse(5.4 + (pose.moving ? gaitSin(pose) * 1.2 : 0), -0.9, 2.3, 1.4, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * A Seavic: upright on its haunches with a great plume of a tail curled up
 * behind it, tufted ears and cheeks packed with seed.
 */
function drawSeavicBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose, UPRIGHT_THICK);
  const hop = pose.moving ? Math.abs(gaitSin(pose)) * 3.4 : 0;
  const flick = gaitSin(pose, pose.moving ? 1 : 0.35) * 0.12;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 11, 5, 0, 0, TAU);
    ctx.fill();
  });
  const [fur, belly] = pose.colors;
  // The tail: a broad plume sweeping up behind and over the back.
  ctx.save();
  ctx.translate(-5, -5 - hop);
  ctx.rotate(flick);
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.moveTo(1, 3);
  ctx.quadraticCurveTo(-11, 1, -8.5, -11);
  ctx.quadraticCurveTo(-7, -18, -1.5, -16.5);
  ctx.quadraticCurveTo(-4.5, -12.5, -3.5, -7);
  ctx.quadraticCurveTo(-2.5, -1.5, 1, -1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = belly;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.moveTo(-2, -2);
  ctx.quadraticCurveTo(-6.5, -5, -5.5, -12);
  ctx.quadraticCurveTo(-4.5, -15, -2.5, -14.5);
  ctx.quadraticCurveTo(-4, -10, -2, -3);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
  // Haunches and upright body.
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(-1.5, -4 - hop, 5, 4.2, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(1, -9.5 - hop, 4.2, 5.2, -0.12, 0, TAU);
  ctx.fill();
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(2.4, -8.5 - hop, 2.4, 3.6, -0.12, 0, TAU);
  ctx.fill();
  // Head with tufted ears.
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.arc(3.2, -15.5 - hop, 3.8, 0, TAU);
  ctx.fill();
  for (const [ex, ey] of [
    [1.4, -19.2],
    [4.6, -19],
  ] as Array<[number, number]>) {
    ctx.beginPath();
    ctx.moveTo(ex - 1.5, ey + 2.4);
    ctx.quadraticCurveTo(ex - 0.3, ey - 3.4, ex + 1.5, ey + 2.2);
    ctx.closePath();
    ctx.fill();
  }
  // Cheek stuffed with seed, eye and nose.
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(5.4, -14 - hop, 2.2, 1.9, 0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#241a12';
  ctx.beginPath();
  ctx.arc(4.4, -16.6 - hop, 0.9, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(7, -14.6 - hop, 0.6, 0, TAU);
  ctx.fill();
  // Forepaws held up at the chest, the way a squirrel holds a nut.
  ctx.fillStyle = belly;
  const paw = pose.moving ? gaitSin(pose) * 0.8 : 0;
  ctx.beginPath();
  ctx.ellipse(4, -9.5 - hop + paw, 1.5, 1.1, 0.3, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * A Mola: a Vola's bigger cousin, built around its claws. Heavy shoulders, a
 * blunt pink snout and two great pale digging hands it keeps out in front.
 */
function drawMolaBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose);
  const dig = pose.moving ? gaitSin(pose) : gaitSin(pose, 0.6) * 0.35;
  const lift = pose.moving ? Math.abs(gaitSin(pose)) * 0.9 : 0;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 11, 5, 0, 0, TAU);
    ctx.fill();
  });
  const [fur, belly] = pose.colors;
  const claw = '#efe3d2';
  // Stubby tail and hind foot.
  ctx.strokeStyle = belly;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-8, -4 - lift);
  ctx.quadraticCurveTo(-10.5, -4.5 - lift, -10.8, -7);
  ctx.stroke();
  ctx.fillStyle = '#3a332e';
  ctx.beginPath();
  ctx.ellipse(-5, -1.4, 2.6, 1.5, 0, 0, TAU);
  ctx.fill();
  // A body that swells at the shoulders rather than the hips.
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0.5, -6 - lift, 8.8, 5.2, -0.08, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(4.5, -7.5 - lift, 5.4, 4.6, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(0, -4 - lift, 5.6, 2.2, -0.08, 0, TAU);
  ctx.fill();
  // Head running straight out of the shoulders into a bare snout.
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(8.4, -7.4 - lift, 3.6, 3.2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#e8a0a4';
  ctx.beginPath();
  ctx.ellipse(11.8, -6.6 - lift, 2.4, 1.7, 0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#c9767c';
  ctx.beginPath();
  ctx.arc(13.4, -6.4 - lift, 0.75, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#1e1611';
  ctx.beginPath();
  ctx.arc(8.6, -8.8 - lift, 0.7, 0, TAU);
  ctx.fill();
  // The claws: broad pale spades, working one forward one back.
  for (const [px, py, ph, scale] of [
    [7.6, -1.6, dig, 1],
    [4.4, -2.2, -dig, 0.88],
  ] as Array<[number, number, number, number]>) {
    ctx.save();
    ctx.translate(px + ph * 1.5, py - Math.max(0, ph) * 1.2);
    ctx.rotate(0.25 + ph * 0.18);
    ctx.scale(scale, scale);
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(-1.6, 0, 2.4, 1.9, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = claw;
    ctx.beginPath();
    ctx.ellipse(1.2, 0, 3.2, 2.3, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#b9a894';
    ctx.lineWidth = 0.55;
    for (const d of [-1.3, -0.45, 0.45, 1.3]) {
      ctx.beginPath();
      ctx.moveTo(1.6, d * 1.1);
      ctx.lineTo(4.6, d * 1.5);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/** An Embra: low, soot-dark and softly alight along the back. */
function drawEmbraBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose, UPRIGHT_THICK);
  const lift = pose.moving ? Math.abs(gaitSin(pose)) * 1 : 0;
  const glow = 0.55 + gaitSin(pose, 1.6) * 0.2;
  const [coat, ember] = pose.colors;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 10, 4.6, 0, 0, TAU);
    ctx.fill();
  });
  // The heat it carries, showing under it before the body is drawn.
  ctx.globalAlpha = glow * 0.5;
  ctx.fillStyle = ember;
  ctx.beginPath();
  ctx.ellipse(0, -1, 9, 3.4, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = coat;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  for (const [lx, ph] of [[-5, 0], [-1.5, 1.6], [2, 3.1], [5, 4.6]] as Array<[number, number]>) {
    const step = pose.moving ? gaitSin(pose, 1, ph) * 1.4 : 0;
    ctx.beginPath();
    ctx.moveTo(lx, -5 - lift);
    ctx.lineTo(lx + step, -0.8);
    ctx.stroke();
  }
  // A long, low body with a ridge of banked coals down it.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(0, -7 - lift, 9.4, 4.6, -0.03, 0, TAU);
  ctx.fill();
  ctx.fillStyle = ember;
  ctx.globalAlpha = glow;
  for (const [rx, r] of [[-5.5, 1.5], [-2, 1.9], [1.6, 1.7], [5, 1.3]] as Array<[number, number]>) {
    ctx.beginPath();
    ctx.ellipse(rx, -10.4 - lift, r, r * 0.7, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Head, low and blunt, with one banked eye.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(8.6, -7.6 - lift, 4.2, 3.6, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = ember;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.ellipse(10.6, -7.8 - lift, 1.1, 0.8, 0.2, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#12100e';
  ctx.beginPath();
  ctx.arc(9.4, -9 - lift, 0.75, 0, TAU);
  ctx.fill();
  // A tail like a poker, trailing sparks when it moves.
  ctx.strokeStyle = coat;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-8.6, -7 - lift);
  ctx.quadraticCurveTo(-12.5, -7.5 - lift, -13.4, -10.5 - lift);
  ctx.stroke();
  if (pose.moving) {
    ctx.fillStyle = ember;
    for (let i = 0; i < 3; i++) {
      const t = (pose.phase * 0.3 + i / 3) % 1;
      ctx.globalAlpha = 0.6 * (1 - t);
      ctx.beginPath();
      ctx.arc(-13.4 - t * 4, -11 - t * 5 - lift, 0.9 * (1 - t) + 0.3, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** A Quarra: a slab of a creature with a jaw made for stone. */
function drawQuarraBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose);
  const plod = pose.moving ? Math.abs(gaitSin(pose)) * 0.8 : 0;
  const [stone, pale] = pose.colors;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 12, 5.4, 0, 0, TAU);
    ctx.fill();
  });
  // Four short, thick legs.
  ctx.fillStyle = stone;
  for (const [lx, ph] of [[-6.5, 0], [-2.5, Math.PI], [3, 0.8], [6.5, 3.6]] as Array<[number, number]>) {
    const step = pose.moving ? Math.max(0, gaitSin(pose, 1, ph)) * 1.2 : 0;
    ctx.beginPath();
    ctx.ellipse(lx, -2.4 - step, 2.2, 2.6, 0, 0, TAU);
    ctx.fill();
  }
  // Body: a boulder with a flat back.
  ctx.beginPath();
  ctx.moveTo(-9.5, -5 - plod);
  ctx.quadraticCurveTo(-10.5, -12 - plod, -3, -12.6 - plod);
  ctx.lineTo(5, -12.2 - plod);
  ctx.quadraticCurveTo(10, -11.6 - plod, 9.6, -5 - plod);
  ctx.quadraticCurveTo(0, -2.6 - plod, -9.5, -5 - plod);
  ctx.closePath();
  ctx.fill();
  // Plates of lighter stone across the back.
  ctx.fillStyle = pale;
  for (const [px, w] of [[-5.5, 3.4], [-0.5, 3.8], [4.4, 3]] as Array<[number, number]>) {
    ctx.beginPath();
    ctx.ellipse(px, -11.4 - plod, w, 1.5, -0.04, 0, TAU);
    ctx.fill();
  }
  // Head: mostly jaw, set low and forward.
  ctx.fillStyle = stone;
  ctx.beginPath();
  ctx.ellipse(11, -7.4 - plod, 4.6, 3.8, -0.1, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.moveTo(8.6, -5.4 - plod);
  ctx.lineTo(15.8, -6.2 - plod);
  ctx.lineTo(15.2, -4 - plod);
  ctx.lineTo(8.8, -3.8 - plod);
  ctx.closePath();
  ctx.fill();
  // Chisel teeth.
  ctx.fillStyle = '#f2efe6';
  for (const tx of [10.2, 12.2, 14.2]) {
    ctx.beginPath();
    ctx.moveTo(tx, -5.6 - plod);
    ctx.lineTo(tx + 1.1, -5.6 - plod);
    ctx.lineTo(tx + 0.55, -4.2 - plod);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#1d1c1a';
  ctx.beginPath();
  ctx.arc(11.6, -9.4 - plod, 0.85, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A Woola: a fleece with a face, and the fleece shows what is on it. */
function drawWoolaBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose);
  const bob = pose.moving ? Math.abs(gaitSin(pose)) * 1.2 : 0;
  const [fleece, shade] = pose.colors;
  // How much wool is on it, passed through on the health slot's sibling.
  const full = pose.fleece ?? 1;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 10, 4.6, 0, 0, TAU);
    ctx.fill();
  });
  // Legs, thin and dark under all that wool.
  ctx.strokeStyle = '#4a423a';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  for (const [lx, ph] of [[-4.5, 0], [-2, 2.2], [2.5, 1.1], [5, 3.3]] as Array<[number, number]>) {
    const step = pose.moving ? gaitSin(pose, 1, ph) * 1.3 : 0;
    ctx.beginPath();
    ctx.moveTo(lx, -6 - bob);
    ctx.lineTo(lx + step, -0.6);
    ctx.stroke();
  }
  // The fleece itself: a cloud of overlapping curls that thins as it is shorn.
  const r = 4.4 + full * 3.2;
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.ellipse(-0.5, -9 - bob, r + 1.4, r * 0.85, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = fleece;
  for (const [cx, cy, cr] of [
    [-5, -9.5, 0.62],
    [-1.5, -11, 0.72],
    [2, -10.4, 0.66],
    [4.6, -8.6, 0.55],
    [-3.5, -7.4, 0.55],
    [0.6, -7, 0.6],
  ] as Array<[number, number, number]>) {
    ctx.beginPath();
    ctx.ellipse(cx, cy - bob, r * cr, r * cr * 0.82, 0, 0, TAU);
    ctx.fill();
  }
  // Head: bare, dark and entirely untroubled.
  ctx.fillStyle = '#574e44';
  ctx.beginPath();
  ctx.ellipse(8, -8.6 - bob, 3.4, 3, -0.1, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(10.6, -7.6 - bob, 2, 1.5, 0.15, 0, TAU);
  ctx.fill();
  // Ears out sideways.
  ctx.strokeStyle = '#574e44';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(6.6, -10.4 - bob);
  ctx.lineTo(4.6, -11.6 - bob);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(7.4, -10.2 - bob);
  ctx.lineTo(6.6, -12 - bob);
  ctx.stroke();
  ctx.fillStyle = '#14110f';
  ctx.beginPath();
  ctx.arc(9, -9.4 - bob, 0.7, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** An Ulva: long in the leg, low in the head, and coming your way. */
function drawUlvaBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose);
  const run = pose.moving ? gaitSin(pose) : gaitSin(pose, 0.3) * 0.15;
  const lift = pose.moving ? Math.abs(gaitSin(pose, 2)) * 0.9 : 0;
  const [coat, belly] = pose.colors;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 11, 4.6, 0, 0, TAU);
    ctx.fill();
  });
  // Legs: two pairs, swinging opposite.
  ctx.strokeStyle = coat;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  for (const [lx, ph, len] of [
    [-5.6, 0, 8],
    [-4.2, Math.PI, 8],
    [4.4, Math.PI, 8.5],
    [5.8, 0, 8.5],
  ] as Array<[number, number, number]>) {
    const swing = gaitSin(pose, 1, ph) * (pose.moving ? 2.4 : 0.3);
    ctx.beginPath();
    ctx.moveTo(lx, -9 - lift);
    ctx.quadraticCurveTo(lx + swing * 0.5, -9 + len * 0.5 - lift, lx + swing, -0.8);
    ctx.stroke();
  }
  // A deep chest tapering to the hips.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.moveTo(-7.5, -9.5 - lift);
  ctx.quadraticCurveTo(-2, -13.4 - lift, 5, -13 - lift);
  ctx.quadraticCurveTo(9.4, -12.6 - lift, 9, -8.4 - lift);
  ctx.quadraticCurveTo(2, -7 - lift, -7, -7.6 - lift);
  ctx.closePath();
  ctx.fill();
  // A pale throat and chest, tucked under the ribs rather than hung below them.
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(3.4, -8.6 - lift, 3.2, 1.5, -0.18, 0, TAU);
  ctx.fill();
  // Tail, low and level when hunting.
  ctx.strokeStyle = coat;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-7.4, -10 - lift);
  ctx.quadraticCurveTo(-12, -9.6 - lift + run * 0.8, -14.6, -11.6 - lift + run * 1.4);
  ctx.stroke();
  // Head held out level, muzzle first.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(9.6, -11 - lift, 4, 3.2, -0.12, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(11.4, -12.4 - lift);
  ctx.lineTo(16.4, -10.6 - lift);
  ctx.lineTo(11.4, -8.8 - lift);
  ctx.closePath();
  ctx.fill();
  // Ears pricked forward.
  for (const [ex, ey] of [[8, -13.6], [10.4, -13.2]] as Array<[number, number]>) {
    ctx.beginPath();
    ctx.moveTo(ex - 1.1, ey + 1.4 - lift);
    ctx.lineTo(ex + 0.3, ey - 2.6 - lift);
    ctx.lineTo(ex + 1.5, ey + 1 - lift);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#e8d76a';
  ctx.beginPath();
  ctx.ellipse(10.6, -11.6 - lift, 0.9, 0.7, -0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#100e0c';
  ctx.beginPath();
  ctx.arc(16.2, -10.6 - lift, 0.7, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A Magga: black and white, long-tailed, and always about to take something. */
function drawMaggaBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose);
  const hop = pose.moving ? Math.abs(gaitSin(pose)) * 3.2 : 0;
  const [feather, pale] = pose.colors;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 7.5, 3.4, 0, 0, TAU);
    ctx.fill();
  });
  // Spindly legs, tucked when it hops.
  ctx.strokeStyle = '#d8a04c';
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  for (const lx of [-1.4, 1.4]) {
    ctx.beginPath();
    ctx.moveTo(lx, -5 - hop);
    ctx.lineTo(lx + (hop > 0 ? 1 : 0), -0.6 - hop * 0.5);
    ctx.stroke();
  }
  // Long tail, angled up behind.
  ctx.fillStyle = feather;
  ctx.beginPath();
  ctx.moveTo(-2.5, -7 - hop);
  ctx.lineTo(-12.5, -11.5 - hop);
  ctx.lineTo(-11.5, -9 - hop);
  ctx.lineTo(-2.5, -5 - hop);
  ctx.closePath();
  ctx.fill();
  // Body and the white flash on the flank.
  ctx.beginPath();
  ctx.ellipse(0, -7.6 - hop, 5.4, 4.2, -0.1, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(0.8, -6.8 - hop, 3.4, 2.6, -0.1, 0, TAU);
  ctx.fill();
  // Folded wing over the white.
  ctx.fillStyle = feather;
  ctx.beginPath();
  ctx.ellipse(-1.4, -8.6 - hop, 4, 2, -0.25, 0, TAU);
  ctx.fill();
  // Head and beak.
  ctx.beginPath();
  ctx.ellipse(5, -11.4 - hop, 3, 2.8, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2b2b2e';
  ctx.beginPath();
  ctx.moveTo(7.2, -12 - hop);
  ctx.lineTo(11.4, -11 - hop);
  ctx.lineTo(7.2, -10 - hop);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f6f4ee';
  ctx.beginPath();
  ctx.arc(6, -12.2 - hop, 0.9, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#100e0c';
  ctx.beginPath();
  ctx.arc(6.2, -12.2 - hop, 0.5, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A Noot: upright, plump, bill first, with a flat tail to sit back on. */
function drawNootBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose, UPRIGHT_THICK);
  // A waddle rather than a walk: it rocks from foot to foot.
  const rock = pose.moving ? gaitSin(pose) * 0.16 : gaitSin(pose, 0.35) * 0.04;
  const bob = pose.moving ? Math.abs(gaitSin(pose)) * 1.2 : 0;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 10, 4.5, 0, 0, TAU);
    ctx.fill();
  });
  const [coat, front] = pose.colors;
  const foot = '#e09340';
  // Feet, planted wide and turned out.
  ctx.fillStyle = foot;
  for (const [fx, ph] of [
    [-3.4, 0],
    [3.2, Math.PI],
  ] as Array<[number, number]>) {
    const lift = pose.moving ? Math.max(0, gaitSin(pose, 1, ph)) * 1.4 : 0;
    ctx.beginPath();
    ctx.ellipse(fx, -1 - lift, 3.4, 1.6, 0, 0, TAU);
    ctx.fill();
  }
  ctx.rotate(rock);
  // The flat tail it leans back on.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.moveTo(-4, -4 - bob);
  ctx.quadraticCurveTo(-11, -2.5 - bob, -12.5, -0.6);
  ctx.quadraticCurveTo(-8.5, -1.2, -4, -1.4 - bob);
  ctx.closePath();
  ctx.fill();
  // Body: a wide-bottomed pear standing on end.
  ctx.beginPath();
  ctx.ellipse(0, -10 - bob, 7.4, 9.2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = front;
  ctx.beginPath();
  ctx.ellipse(1.2, -9.4 - bob, 5.2, 7.4, 0.04, 0, TAU);
  ctx.fill();
  // Flippers: one tucked against the near side, one swinging behind.
  const swing = pose.moving ? gaitSin(pose) * 1.6 : 0;
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(-6.6, -10 - bob + swing * 0.3, 2.1, 5, 0.3 + swing * 0.06, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(6.4, -10.4 - bob - swing * 0.3, 1.9, 4.6, -0.32 - swing * 0.06, 0, TAU);
  ctx.fill();
  // Head, set straight on the shoulders.
  ctx.beginPath();
  ctx.ellipse(0.6, -20.4 - bob, 5.4, 5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = front;
  ctx.beginPath();
  ctx.ellipse(2.4, -19.4 - bob, 3.4, 3.6, 0.1, 0, TAU);
  ctx.fill();
  // The bill: broad, blunt and orange, the whole reason it is any use in a clay pit.
  ctx.fillStyle = foot;
  ctx.beginPath();
  ctx.moveTo(3.4, -21.6 - bob);
  ctx.quadraticCurveTo(10.6, -21 - bob, 11.6, -19.2 - bob);
  ctx.quadraticCurveTo(9.4, -17.4 - bob, 3.6, -17.8 - bob);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,70,20,0.5)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(4, -19.6 - bob);
  ctx.lineTo(11, -19.4 - bob);
  ctx.stroke();
  // Eye.
  ctx.fillStyle = '#1a1712';
  ctx.beginPath();
  ctx.arc(2.6, -22.4 - bob, 0.95, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.arc(2.9, -22.7 - bob, 0.32, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A Crawler: a broad crab on eight legs, one claw far bigger than the other. */
function drawCrawlerBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose);
  const swing = pose.moving ? 1 : 0.18;
  const sway = gaitSin(pose, pose.moving ? 1 : 0.4) * (pose.moving ? 0.5 : 0.2);
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 12, 5, 0, 0, TAU);
    ctx.fill();
  });
  const [shell, pale] = pose.colors;
  const hips = [-6.2, -2.4, 1.2, 4.6];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The four legs on the far side stand up over the shell, as they do in this view.
  ctx.strokeStyle = pale;
  ctx.lineWidth = 1.1;
  hips.forEach((hx, i) => {
    const lift = Math.max(0, gaitSin(pose, 1, i * 0.9)) * swing * 1.3;
    const tip = hx - 3.2 + i * 1.7;
    ctx.beginPath();
    ctx.moveTo(hx, -8.6);
    ctx.quadraticCurveTo(hx - 1.4 + i * 0.5, -13.4 - lift, tip, -11.8 - lift * 0.6);
    ctx.stroke();
  });
  // Carapace: broad, domed, and darker where it turns under.
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.ellipse(0, -6.8 + sway * 0.3, 9.8, 5.3, -0.03, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0.2, -4.4 + sway * 0.3, 8.6, 2.1, -0.03, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(-2.4, -9.8 + sway * 0.3, 4.2, 1.2, -0.12, 0, TAU);
  ctx.fill();
  // Two seams down the shell.
  ctx.strokeStyle = 'rgba(60,40,26,0.35)';
  ctx.lineWidth = 0.55;
  for (const [ax, r] of [
    [-3.4, 3],
    [2.6, 3.4],
  ] as Array<[number, number]>) {
    ctx.beginPath();
    ctx.arc(ax, -7.4 + sway * 0.3, r, 0.5, 2.4);
    ctx.stroke();
  }
  // Eyestalks on the leading edge, and the mouthparts under them.
  ctx.strokeStyle = shell;
  ctx.lineWidth = 1;
  for (const ex of [4.6, 7.2]) {
    ctx.beginPath();
    ctx.moveTo(ex, -9.4 + sway * 0.3);
    ctx.quadraticCurveTo(ex + 1.2, -12.4, ex + 0.7, -13.6 + sway * 0.4);
    ctx.stroke();
  }
  ctx.fillStyle = '#1a1410';
  for (const ex of [5.1, 7.7]) {
    ctx.beginPath();
    ctx.arc(ex, -14, 1.05, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(8.8, -7.2 + sway * 0.3, 1.5, 1.1, 0.25, 0, TAU);
  ctx.fill();
  // The four near legs come down in front, feet on the sand.
  ctx.strokeStyle = shell;
  ctx.lineWidth = 1.5;
  hips.forEach((hx, i) => {
    const lift = Math.max(0, gaitSin(pose, 1, 1.6 + i * 0.9)) * swing * 1.6;
    const tip = hx - 3.4 + i * 1.8;
    ctx.beginPath();
    ctx.moveTo(hx, -5.4);
    ctx.quadraticCurveTo(hx - 2.6 + i * 0.6, -4.2 - lift, tip, -0.7 - lift);
    ctx.stroke();
  });
  // Both claws held out front, the big one first: it does the digging.
  for (const [px, py, scale, tilt, ph] of [
    [6, -2.6, 0.66, 0.16, -swing * gaitSin(pose, 1, 1.1)],
    [7.4, -5.6, 1.08, -0.2, swing * gaitSin(pose)],
  ] as Array<[number, number, number, number, number]>) {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(tilt + ph * 0.12);
    ctx.scale(scale, scale);
    // Upper arm out to the elbow.
    ctx.strokeStyle = shell;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-0.6, 1.2);
    ctx.lineTo(2.6, 0.4);
    ctx.stroke();
    // The hand.
    ctx.fillStyle = shell;
    ctx.beginPath();
    ctx.ellipse(5.2, -0.2, 3.6, 2.5, -0.12, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath();
    ctx.ellipse(5.4, 1, 3.2, 1.1, -0.12, 0, TAU);
    ctx.fill();
    // The pincer, held a crack open.
    ctx.fillStyle = pale;
    ctx.beginPath();
    ctx.moveTo(7.4, -1.9);
    ctx.quadraticCurveTo(11.6, -3.4 - ph, 13.4, -2.2 - ph * 1.2);
    ctx.quadraticCurveTo(10.6, -1.4, 7.8, -0.9);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(7.4, 1.1);
    ctx.quadraticCurveTo(11.2, 1.8 + ph * 0.7, 13, 0.6 + ph * 0.9);
    ctx.quadraticCurveTo(10.4, 0.2, 7.8, -0.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The eighteen newer wildermon are not drawn one at a time. Three kits cover
 * the lot: a thing on four legs, a thing standing on two, and a thing with no
 * bones in it at all. What tells a Shaggan from a Dowse is the numbers handed
 * to the kit — how long the legs are, how deep the barrel, what is carried on
 * the head — which is enough to know one across a field, and a great deal
 * less to keep than eighteen bodies would be.
 */
interface BeastShape {
  /** Half-width and half-height of the barrel. */
  body: [number, number];
  /** How high its belly rides off the ground. */
  ride: number;
  /** Legs: how long they swing, how thick they are, how wide they stand. */
  leg: number;
  legW: number;
  span: number;
  /** Head: how big, and where its middle sits from the middle of the barrel. */
  head: number;
  neck: [number, number];
  /** Snout out past the head; nothing for a blunt face. */
  muzzle?: number;
  ear?: 'round' | 'point' | 'long' | 'flop';
  horn?: 'curl' | 'sweep' | 'nub';
  tail?: 'tuft' | 'flat' | 'brush' | 'stub';
  /** A raised shoulder, for the ones built to push. */
  hump?: number;
  /** Tufts of hair hanging off the barrel. */
  shag?: number;
  /** A throat pouch under the jaw. */
  pouch?: number;
  /** An udder that fills, for the ones that are milked. */
  udder?: boolean;
  whisker?: boolean;
  /** Moss growing along the back. */
  moss?: boolean;
  /**
   * How quickly its legs go over, as a multiple of everything else's.
   *
   * A cadence, not a gait: this is a fact about the species — a dowse takes
   * quick short steps and a holla takes slow long ones — and it does not
   * change with how hard the animal is working. `CreaturePose.gait` is that
   * other thing, and the two used to share a name.
   */
  cadence?: number;
}

const BEASTS: Record<string, BeastShape> = {
  bogga: { body: [10, 5.5], ride: 3.5, leg: 4, legW: 2.6, span: 7, head: 4, neck: [11, 0.5], muzzle: 2.4, ear: 'round', tail: 'flat', cadence: 0.9 },
  holla: { body: [11, 7], ride: 5, leg: 6, legW: 3.2, span: 8, head: 4.6, neck: [12, -1], muzzle: 2.6, ear: 'round', tail: 'stub', pouch: 4, cadence: 0.8 },
  dowse: { body: [7.5, 4.4], ride: 2.6, leg: 3.2, legW: 2, span: 5, head: 3.4, neck: [8.5, 0.6], muzzle: 2.8, ear: 'round', tail: 'stub', whisker: true, cadence: 1.3 },
  sappa: { body: [9, 5.4], ride: 5, leg: 6, legW: 2.4, span: 6.5, head: 4, neck: [10, -1.4], muzzle: 2, ear: 'long', tail: 'brush', moss: true, cadence: 1.1 },
  // Neck up in the branches, and a head that is mostly mouth.
  snedda: { body: [8.5, 5], ride: 5.5, leg: 6.5, legW: 2.2, span: 6, head: 3.6, neck: [10, -4.2], muzzle: 2.8, ear: 'long', tail: 'brush', cadence: 1.15 },
  // Shoulders over the head, and the head at the ground.
  grubba: { body: [10, 6], ride: 3, leg: 3.8, legW: 3.4, span: 7, head: 4.2, neck: [10.5, 1.4], muzzle: 3.6, ear: 'round', tail: 'stub', hump: 4, cadence: 0.9 },
  // Arms as long as its body, and a tail to hang by.
  plucka: { body: [7.5, 4.2], ride: 4.5, leg: 5.8, legW: 1.8, span: 5.4, head: 3.4, neck: [9, -3], muzzle: 2, ear: 'round', tail: 'brush', cadence: 1.35 },
  cobbe: { body: [10, 6], ride: 4, leg: 5, legW: 3.6, span: 7.5, head: 4.4, neck: [11, 0], muzzle: 2.2, ear: 'point', tail: 'stub', hump: 4.5, cadence: 0.85 },
  tinka: { body: [6, 4], ride: 3.4, leg: 4, legW: 1.8, span: 4.2, head: 3.6, neck: [6.8, -2.2], muzzle: 1.6, ear: 'point', tail: 'brush', whisker: true, cadence: 1.5 },
  middun: { body: [9, 4.6], ride: 3, leg: 3.6, legW: 2.2, span: 6.4, head: 3.4, neck: [10, 0.4], muzzle: 3.6, ear: 'round', tail: 'brush', cadence: 1.1 },
  bura: { body: [12, 7], ride: 6.5, leg: 7.5, legW: 3.4, span: 9, head: 4.6, neck: [13.5, -2], muzzle: 2.6, ear: 'long', tail: 'tuft', cadence: 0.75 },
  gorral: { body: [9, 5], ride: 6.5, leg: 7.5, legW: 2.2, span: 6.5, head: 3.8, neck: [10.5, -2.6], muzzle: 2.2, ear: 'point', horn: 'curl', tail: 'stub', shag: 2, cadence: 1.25 },
  wadd: { body: [11, 4.8], ride: 2.8, leg: 3.4, legW: 2.4, span: 7.5, head: 3.8, neck: [11.5, 0.4], muzzle: 2.4, ear: 'round', tail: 'flat', cadence: 1.2 },
  shaggan: { body: [14, 8.5], ride: 5.5, leg: 6.5, legW: 4.4, span: 10, head: 5.4, neck: [15, 0.5], muzzle: 2.6, horn: 'sweep', tail: 'tuft', hump: 6, shag: 5, cadence: 0.6 },
  cudda: { body: [11.5, 7], ride: 5.5, leg: 6.5, legW: 3, span: 8, head: 4.4, neck: [12.5, -1], muzzle: 2.6, ear: 'long', horn: 'nub', tail: 'tuft', udder: true, cadence: 0.8 },
  snout: { body: [9, 5], ride: 3.4, leg: 4, legW: 2.6, span: 6.4, head: 3.6, neck: [9.8, 0.2], muzzle: 4.2, ear: 'flop', tail: 'stub', whisker: true, cadence: 1.05 },
};

/** A wildermon on four legs, built to the numbers above. Feet at (sx, sy). */
function drawBeastBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose, s: BeastShape): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose);
  const [hide, pale] = pose.colors;
  const cadence = s.cadence ?? 1;
  const bob = pose.moving ? Math.abs(gaitSin(pose, cadence)) * (0.5 + s.ride * 0.08) : 0;
  const [bw, bh] = s.body;
  const by = -(s.ride + bh) - bob;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 1, bw * 1.25, bw * 0.48, 0, 0, TAU);
    ctx.fill();
  });
  // Four legs, the near pair a shade darker so the far pair reads as behind.
  ctx.lineCap = 'round';
  ctx.lineWidth = s.legW;
  const hip = by + bh * 0.5;
  for (const [lx, ph, near] of [
    [-s.span, 0, 0],
    [s.span - 1.4, Math.PI, 0],
    [-s.span + 1.6, Math.PI, 1],
    [s.span, 0, 1],
  ] as Array<[number, number, number]>) {
    const step = pose.moving ? gaitSin(pose, cadence, ph) * (s.leg * 0.28) : 0;
    ctx.strokeStyle = near ? hide : shade(hide, -0.22);
    ctx.beginPath();
    ctx.moveTo(lx, hip);
    ctx.lineTo(lx + step, -0.8);
    ctx.stroke();
  }
  // Tail, before the barrel so it hangs off the back of it.
  const tail = s.tail;
  if (tail) {
    const tx = -bw * 0.92;
    if (tail === 'flat') {
      ctx.fillStyle = shade(hide, -0.12);
      ctx.beginPath();
      ctx.moveTo(tx, by - bh * 0.1);
      ctx.quadraticCurveTo(tx - bw * 0.9, by + bh * 0.4, tx - bw * 1.05, by + bh * 0.95);
      ctx.quadraticCurveTo(tx - bw * 0.45, by + bh * 0.75, tx, by + bh * 0.5);
      ctx.closePath();
      ctx.fill();
    } else if (tail === 'stub') {
      ctx.fillStyle = hide;
      ctx.beginPath();
      ctx.ellipse(tx - 1, by - bh * 0.2, 2.2, 1.8, 0.5, 0, TAU);
      ctx.fill();
    } else {
      ctx.strokeStyle = hide;
      ctx.lineWidth = tail === 'brush' ? 2.2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(tx, by - bh * 0.3);
      ctx.quadraticCurveTo(tx - bw * 0.35, by + bh * 0.2, tx - bw * 0.28, by + bh * 1.1);
      ctx.stroke();
      ctx.fillStyle = pale;
      ctx.beginPath();
      ctx.ellipse(tx - bw * 0.28, by + bh * 1.3, 1.3, 2.1, 0, 0, TAU);
      ctx.fill();
    }
  }
  // The barrel, with a pale belly under it and a shoulder over it.
  ctx.fillStyle = hide;
  ctx.beginPath();
  ctx.ellipse(0, by, bw, bh, 0, 0, TAU);
  ctx.fill();
  if (s.hump) {
    ctx.beginPath();
    ctx.ellipse(bw * 0.4, by - bh * 0.6, s.hump, s.hump * 0.66, -0.18, 0, TAU);
    ctx.fill();
  }
  if (s.shag) {
    // Hanging hair: the longer it is the less of the legs you see.
    ctx.fillStyle = shade(hide, 0.08);
    for (let i = -3; i <= 3; i++) {
      const hx = (i / 3) * bw * 0.85;
      ctx.beginPath();
      ctx.ellipse(hx, by + bh * 0.6 + s.shag * 0.4, bw * 0.17, s.shag, (i / 3) * 0.2, 0, TAU);
      ctx.fill();
    }
  }
  // The pale underside, kept low and short so it reads as a belly rather
  // than a patch painted on the flank.
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(-bw * 0.04, by + bh * 0.52, bw * 0.68, bh * 0.32, 0, 0, TAU);
  ctx.fill();
  if (s.udder) {
    // Fills as the milk comes in, and hangs slack once it has been taken.
    const full = 0.5 + (pose.fleece ?? 0) * 0.9;
    ctx.fillStyle = '#e8bfae';
    ctx.beginPath();
    ctx.ellipse(-bw * 0.2, by + bh * 0.95, 2.6 * full, 2.2 * full, 0, 0, TAU);
    ctx.fill();
  }
  if (s.moss) {
    ctx.fillStyle = '#6f8a4a';
    for (let i = -2; i <= 2; i++) {
      const mx = (i / 2) * bw * 0.7;
      ctx.beginPath();
      ctx.ellipse(mx, by - bh * 0.8 - Math.abs(i) * 0.3, bw * 0.2, 1.6, (i / 2) * 0.3, 0, TAU);
      ctx.fill();
    }
  }
  /*
   * Head, muzzle and whatever is on it — placed rather than drawn flat.
   *
   * A head is a ball and stays a ball whichever way the animal is turned; what
   * moves is the face on it. So the head goes where the neck puts it, in body
   * space, and everything hung on it is placed along the two directions the
   * turn hands back: the muzzle out along the body, the ears and the eyes and
   * the horns spread across it. Side on the across-axis is almost nothing and
   * the pair lie on top of one another, which is the one eye and the one ear a
   * profile has always shown; end on it opens out to the animal's full width
   * and you are looking at a face.
   */
  atBody(ctx, pose, s.neck[0], by + s.neck[1], (t) => {
    const [ax, ay] = t.across;
    const [lx, ly] = t.along;
    const r = s.head;
    const out = (n: number): [number, number] => [lx * n, ly * n];
    const wide = (n: number): [number, number] => [ax * n, ay * n];
    /*
     * Whether you are looking at the face or at the back of the head. A step
     * towards the nose that carries *down* the screen is a nose pointed at
     * you; level is a profile, and a profile still has a face on it.
     */
    const front = ly >= -1e-6;
    const muzzle = (): void => {
      if (!s.muzzle) return;
      const [mx, my] = out(r * 0.85);
      ctx.fillStyle = shade(hide, 0.1);
      ctx.beginPath();
      ctx.ellipse(mx, my + r * 0.22, s.muzzle, s.muzzle * 0.62, 0, 0, TAU);
      ctx.fill();
      const [nx, ny] = out(r * 0.85 + s.muzzle * 0.8);
      ctx.fillStyle = '#3a2c24';
      ctx.beginPath();
      ctx.ellipse(nx, ny + r * 0.22, 0.7, 0.6, 0, 0, TAU);
      ctx.fill();
    };
    // Ears first: they sit behind the skull and the skull laps over them.
    if (s.ear) {
      ctx.fillStyle = shade(hide, -0.1);
      const [bx2, by2] = out(-r * 0.45);
      for (const side of [-1, 1]) {
        const [ex, ey] = wide(side * r * 0.52);
        const cx2 = bx2 + ex;
        const cy2 = by2 + ey - r * 0.8;
        if (s.ear === 'round') {
          ctx.beginPath();
          ctx.ellipse(cx2, cy2, r * 0.38, r * 0.36, 0, 0, TAU);
          ctx.fill();
        } else if (s.ear === 'point') {
          ctx.beginPath();
          ctx.moveTo(cx2 - r * 0.3, cy2 + r * 0.3);
          ctx.lineTo(cx2 + r * 0.12, cy2 - r * 0.75);
          ctx.lineTo(cx2 + r * 0.42, cy2 + r * 0.24);
          ctx.closePath();
          ctx.fill();
        } else if (s.ear === 'long') {
          ctx.beginPath();
          ctx.ellipse(cx2, cy2 - r * 0.3, r * 0.2, r * 0.72, side * 0.2, 0, TAU);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.ellipse(cx2, cy2 + r * 0.5, r * 0.24, r * 0.64, side * -0.35, 0, TAU);
          ctx.fill();
        }
      }
    }
    if (s.horn) {
      ctx.strokeStyle = '#e6ddc8';
      ctx.lineWidth = s.horn === 'sweep' ? 2.2 : 1.6;
      ctx.lineCap = 'round';
      const [hbx, hby] = out(-r * 0.2);
      for (const side of [-1, 1]) {
        const [sx2, sy2] = wide(side * r * 0.45);
        const ox = hbx + sx2;
        const oy = hby + sy2 - r * 0.8;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        if (s.horn === 'curl') {
          const [cx3, cy3] = out(-r * 1.4);
          ctx.bezierCurveTo(ox + cx3 * 0.8, oy + cy3 * 0.8 - r * 0.9, ox + cx3 * 1.4, oy + cy3 * 1.4 + r * 0.4,
            ox + cx3 * 0.6 + sx2 * 0.6, oy + cy3 * 0.6 + r * 0.9);
        } else if (s.horn === 'sweep') {
          const [cx3, cy3] = out(r * 1.3);
          ctx.quadraticCurveTo(ox + cx3 * 0.85, oy + cy3 * 0.85 - r * 0.7, ox + cx3 * 1.7 + sx2 * 0.8, oy + cy3 * 1.7 + r * 0.2);
        } else {
          ctx.lineTo(ox + sx2 * 0.2, oy - r * 0.5);
        }
        ctx.stroke();
      }
    }
    // A snout you are looking up the back of is hidden by the head in front
    // of it, which is what putting it down first amounts to.
    if (!front) muzzle();
    ctx.fillStyle = hide;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.86, 0, 0, TAU);
    ctx.fill();
    if (s.pouch) {
      ctx.fillStyle = shade(pale, -0.08);
      ctx.beginPath();
      ctx.ellipse(0, r * 0.75, s.pouch, s.pouch * 0.82, 0, 0, TAU);
      ctx.fill();
    }
    if (front) muzzle();
    if (front && s.whisker) {
      const [wx0, wy0] = out(r * 0.8);
      ctx.strokeStyle = 'rgba(240,235,225,0.75)';
      ctx.lineWidth = 0.45;
      for (const w of [-1, 0, 1]) {
        const [wx1, wy1] = out(r * 0.8 + (s.muzzle ?? 2) * 2.1);
        const [sx2, sy2] = wide(w * 2.4);
        ctx.beginPath();
        ctx.moveTo(wx0, wy0 + r * 0.2);
        ctx.lineTo(wx1 + sx2, wy1 + r * 0.2 + sy2);
        ctx.stroke();
      }
    }
    /*
     * Two eyes on the front of a ball. Side on they lie almost on one another
     * and read as the one eye a profile always had; coming at you they open
     * out to the width of the face; going away there are none, because the
     * back of a head has no eyes in it — which is the whole of what tells a
     * beast walking towards you from one walking off.
     */
    if (front) {
      ctx.fillStyle = '#1c1712';
      const [ex0, ey0] = out(r * 0.4);
      for (const side of [-1, 1]) {
        const [sx2, sy2] = wide(side * r * 0.42);
        ctx.beginPath();
        ctx.arc(ex0 + sx2, ey0 + sy2 - r * 0.2, Math.max(0.7, r * 0.17), 0, TAU);
        ctx.fill();
      }
    }
  });
  ctx.restore();
}

interface BirdShape {
  body: [number, number];
  ride: number;
  leg: number;
  neck: number;
  beak: 'shear' | 'hook' | 'stub';
  /** Feathers standing up off the crown. */
  crest?: number;
  /** Long feathers trailing behind, which is what a Quill is kept for. */
  plume?: number;
  eye?: number;
  /** How quickly its legs go over. See `BeastShape.cadence`. */
  cadence?: number;
}

const BIRDS: Record<string, BirdShape> = {
  sedra: { body: [5.5, 4.6], ride: 9, leg: 10, neck: 9, beak: 'shear', cadence: 1 },
  warda: { body: [6, 6], ride: 7.5, leg: 8.5, neck: 7, beak: 'hook', crest: 3, eye: 1.5, cadence: 0.9 },
  quill: { body: [8, 7], ride: 4.5, leg: 5, neck: 4.5, beak: 'stub', plume: 9, cadence: 1.3 },
};

/** A wildermon that stands on two legs, built to the numbers above. */
function drawBirdBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose, s: BirdShape): void {
  ctx.save();
  bodyFrame(ctx, sx, sy, zoom, pose, UPRIGHT_THICK);
  const [coat, front] = pose.colors;
  const cadence = s.cadence ?? 1;
  const bob = pose.moving ? Math.abs(gaitSin(pose, cadence)) * 1.1 : 0;
  const [bw, bh] = s.body;
  const by = -(s.ride + bh) - bob;
  onGround(ctx, pose, () => {
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath();
    ctx.ellipse(0, 1, bw * 1.1, bw * 0.44, 0, 0, TAU);
    ctx.fill();
  });
  // Two legs with a backward knee, and a splayed foot on each.
  ctx.strokeStyle = '#c8975a';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  for (const [lx, ph] of [
    [-1.6, 0],
    [1.6, Math.PI],
  ] as Array<[number, number]>) {
    const step = pose.moving ? gaitSin(pose, cadence, ph) * 2.2 : 0;
    ctx.beginPath();
    ctx.moveTo(lx, by + bh * 0.6);
    ctx.quadraticCurveTo(lx - 1.2, by + bh * 0.6 + s.leg * 0.55, lx + step, -0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(lx + step - 1.8, -0.6);
    ctx.lineTo(lx + step + 2.2, -0.6);
    ctx.stroke();
  }
  if (s.plume) {
    // The long wing feathers, which grow back as fast as they are taken.
    const grown = 0.35 + (pose.fleece ?? 1) * 0.65;
    ctx.fillStyle = front;
    for (const a of [-0.35, -0.1, 0.15]) {
      ctx.beginPath();
      ctx.ellipse(-bw * 0.9 - s.plume * grown * 0.4, by + a * 5, s.plume * grown * 0.5, 1.5, a + 0.25, 0, TAU);
      ctx.fill();
    }
  }
  // Body: an egg standing a little back on itself.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(0, by, bw, bh, -0.1, 0, TAU);
  ctx.fill();
  ctx.fillStyle = front;
  ctx.beginPath();
  ctx.ellipse(bw * 0.24, by + bh * 0.12, bw * 0.62, bh * 0.72, -0.05, 0, TAU);
  ctx.fill();
  // A wing folded against the near side.
  ctx.fillStyle = shade(coat, -0.12);
  ctx.beginPath();
  ctx.ellipse(-bw * 0.12, by + bh * 0.05, bw * 0.6, bh * 0.5, -0.22, 0, TAU);
  ctx.fill();
  // Neck and head.
  const hy = by - bh - s.neck;
  ctx.strokeStyle = coat;
  ctx.lineWidth = Math.max(2, bw * 0.34);
  ctx.beginPath();
  ctx.moveTo(bw * 0.1, by - bh * 0.4);
  ctx.quadraticCurveTo(bw * 0.7, by - bh - s.neck * 0.55, bw * 0.5, hy + 1);
  ctx.stroke();
  const hx = bw * 0.5;
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(hx, hy, bw * 0.46, bw * 0.42, 0.1, 0, TAU);
  ctx.fill();
  if (s.crest) {
    ctx.strokeStyle = front;
    ctx.lineWidth = 1;
    for (const a of [-0.5, -0.15, 0.2]) {
      ctx.beginPath();
      ctx.moveTo(hx - 1, hy - bw * 0.3);
      ctx.lineTo(hx - 1 - Math.sin(a) * s.crest, hy - bw * 0.3 - Math.cos(a) * s.crest);
      ctx.stroke();
    }
  }
  // The bill, which is the whole of what each of them is for.
  ctx.fillStyle = '#d8a54a';
  const bx = hx + bw * 0.4;
  if (s.beak === 'shear') {
    ctx.beginPath();
    ctx.moveTo(bx, hy - 1.2);
    ctx.lineTo(bx + 11, hy - 0.2);
    ctx.lineTo(bx, hy + 1.4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,60,20,0.5)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(bx, hy + 0.2);
    ctx.lineTo(bx + 10.4, hy - 0.1);
    ctx.stroke();
  } else if (s.beak === 'hook') {
    ctx.beginPath();
    ctx.moveTo(bx - 0.6, hy - 1.6);
    ctx.quadraticCurveTo(bx + 5.4, hy - 1.4, bx + 4.6, hy + 2.4);
    ctx.quadraticCurveTo(bx + 2.6, hy + 0.6, bx - 0.6, hy + 1.2);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(bx - 0.4, hy - 1.4);
    ctx.lineTo(bx + 4.4, hy + 0.2);
    ctx.lineTo(bx - 0.4, hy + 1.6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#181410';
  ctx.beginPath();
  ctx.arc(hx + bw * 0.16, hy - bw * 0.1, s.eye ?? 0.95, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.arc(hx + bw * 0.22, hy - bw * 0.2, (s.eye ?? 0.95) * 0.34, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A Vesp: not one creature so much as a cloud of them, all going at once. */
function drawVespBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  const [band, dark] = pose.colors;
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 8, 3.2, 0, 0, TAU);
  ctx.fill();
  const churn = pose.moving ? 1.6 : 0.7;
  for (let i = 0; i < 14; i++) {
    // Each of them keeps its own orbit, so the swarm boils rather than spins.
    const a = (i / 14) * TAU + pose.phase * churn * (0.6 + (i % 4) * 0.22);
    const r = 4 + (i % 5) * 2.1;
    const bx = Math.cos(a) * r;
    const byy = -11 + Math.sin(a * 1.4 + i) * (r * 0.6);
    ctx.fillStyle = i % 3 ? band : dark;
    ctx.beginPath();
    ctx.ellipse(bx, byy, 1.7, 1.25, a, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.ellipse(bx - 0.5, byy - 1.2, 1.5, 0.6, a * 0.4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** A Lume: a cold light drifting a foot off the ground, and very little else. */
function drawLumeBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  const [pale, bright] = pose.colors;
  const drift = gaitSin(pose, 0.5) * 1.6;
  const cy = -11 + drift;
  const glow = ctx.createRadialGradient(0, cy, 0.5, 0, cy, 13);
  glow.addColorStop(0, bright);
  glow.addColorStop(0.35, `${pale}cc`);
  glow.addColorStop(1, 'rgba(230,240,220,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(0, cy, 13, 12, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = bright;
  ctx.beginPath();
  ctx.ellipse(0, cy, 4.4, 4.8, 0, 0, TAU);
  ctx.fill();
  // A few slow trailing motes that say which way it is drifting.
  ctx.fillStyle = `${pale}aa`;
  for (let i = 0; i < 4; i++) {
    const a = pose.phase * 0.3 + (i / 4) * TAU;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * 7, cy + Math.sin(a) * 5.5, 1.1, 1.1, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawCreatureOverlay(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  if (pose.health < 1) {
    const w = 18 * zoom;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(sx - w / 2, sy - 24 * zoom, w, 3 * zoom);
    ctx.fillStyle = pose.health > 0.5 ? '#7ccf5a' : pose.health > 0.25 ? '#e3b657' : '#e0574d';
    ctx.fillRect(sx - w / 2, sy - 24 * zoom, w * Math.max(0, pose.health), 3 * zoom);
  }
  if (pose.label) {
    ctx.font = `${Math.max(9, 10 * zoom)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(pose.label, sx, sy - 26 * zoom);
    ctx.fillStyle = '#e3b657';
    ctx.fillText(pose.label, sx, sy - 26 * zoom);
  }
}

export interface PlayerPose {
  phase: number;
  moving: boolean;
  /** How hard they are going: 0 at a walk, 1 at a run. See `CreaturePose.gait`. */
  gait?: number;
  /** Which of the eight ways it is turned. See `facingOf`. */
  facing: number;
  swimming: boolean;
  working: boolean;
  /** Sitting on a seat with the reins in both hands rather than walking. */
  driving?: boolean;
  /** The colour of what is on the chest and the legs, when either has been dyed. */
  tunic?: string;
  trousers?: string;
  /** Who this is: skin, hair, eyes, build and the clothes they came ashore in. */
  look?: Look;
  /** An emote in progress, and how far through it is (0 to 1). */
  emote?: string;
  emoteT?: number;
}

const BELT = '#33241a';

/**
 * The colours and the build a pose comes to.
 *
 * Dyed cloth beats the clothes you were made in, and that order is the right
 * way round: the shirt in a look is what you washed ashore wearing, and a
 * tunic you dyed madder is what you are wearing now.
 */
interface Worn {
  look: Look;
  skin: string;
  shade: string;
  hair: string;
  hairShade: string;
  eye: string;
  tunic: string;
  trousers: string;
  build: (typeof BUILDS)[Gender];
}

function wornOf(pose: PlayerPose): Worn {
  const look = pose.look ?? DEFAULT_LOOK;
  const skin = skinColour(look);
  const hair = hairColour(look);
  return {
    look,
    skin,
    shade: darken(skin, 0.18),
    hair,
    hairShade: darken(hair, 0.3),
    eye: eyeColour(look),
    tunic: pose.tunic ?? shirtColour(look),
    trousers: pose.trousers ?? trouserColour(look),
    build: BUILDS[look.gender] ?? BUILDS.neither,
  };
}

/* ---- Hair ------------------------------------------------------------- */

/**
 * Twenty haircuts on a head nine pixels across.
 *
 * Nothing about hair survives that scale except its outline, so each of these
 * is a silhouette: how far down the sides it comes, what happens behind the
 * neck, and whether anything stands up. Drawn in the head's own space, centre
 * at the origin, radius `r`, and facing **right** — the figure as a whole is
 * mirrored by the caller when it turns, so there is only ever one side to
 * draw.
 *
 * Two passes rather than one. A ponytail, a mane and an afro all sit *behind*
 * the skull, and painting them after it would put the hair over the face; so
 * `hairBehind` runs before the head goes down and `hairOver` after it. The
 * split is what makes long hair possible at all without a second sprite.
 */
function hairBehind(ctx: CanvasRenderingContext2D, w: Worn, r: number): void {
  const id = w.look.hair;
  ctx.fillStyle = w.hairShade;
  const rope = (x: number, y: number, len: number, wide: number): void => {
    ctx.fillRect(x - wide / 2, y, wide, len);
  };
  switch (id) {
    case 'afro':
      ctx.fillStyle = w.hair;
      ctx.beginPath();
      ctx.arc(-0.35 * r, -0.4 * r, r * 1.55, 0, TAU);
      ctx.fill();
      break;
    case 'long':
      ctx.beginPath();
      ctx.moveTo(-r * 1.15, -r * 0.4);
      ctx.quadraticCurveTo(-r * 1.6, r * 1.6, -r * 0.5, r * 2.4);
      ctx.lineTo(r * 0.5, r * 2.2);
      ctx.quadraticCurveTo(r * 0.6, r * 0.2, r * 0.2, -r * 0.8);
      ctx.closePath();
      ctx.fill();
      break;
    case 'waves':
      ctx.beginPath();
      ctx.moveTo(-r * 1.1, -r * 0.5);
      ctx.quadraticCurveTo(-r * 1.5, r * 0.7, -r * 0.7, r * 1.3);
      ctx.lineTo(r * 0.7, r * 1.2);
      ctx.quadraticCurveTo(r * 0.9, r * 0.2, r * 0.3, -r * 0.7);
      ctx.closePath();
      ctx.fill();
      break;
    case 'ponytail':
      rope(-r * 1.25, -r * 0.5, r * 2.2, r * 0.7);
      ctx.beginPath();
      ctx.arc(-r * 1.25, r * 1.7, r * 0.42, 0, TAU);
      ctx.fill();
      break;
    case 'braid':
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(-r * 1.2, -r * 0.3 + i * r * 0.62, r * 0.36, r * 0.34, 0, 0, TAU);
        ctx.fill();
      }
      break;
    case 'braids':
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(-r * 0.95, r * 0.35 + i * r * 0.55, r * 0.3, r * 0.3, 0, 0, TAU);
        ctx.fill();
      }
      break;
    case 'locs':
      for (let i = 0; i < 5; i++) rope(-r * 1.1 + i * r * 0.5, -r * 0.6, r * 2 - i * r * 0.18, r * 0.3);
      break;
    case 'bun':
      ctx.beginPath();
      ctx.arc(-r * 0.95, -r * 0.5, r * 0.62, 0, TAU);
      ctx.fill();
      break;
    case 'topknot':
      rope(-r * 0.1, -r * 1.75, r * 1.1, r * 0.34);
      ctx.beginPath();
      ctx.arc(-r * 0.1, -r * 1.7, r * 0.5, 0, TAU);
      ctx.fill();
      break;
    default:
      break;
  }
}

function hairOver(ctx: CanvasRenderingContext2D, w: Worn, r: number): void {
  const id = w.look.hair;
  if (id === 'bald') return;
  ctx.fillStyle = w.hair;
  /** A cap over the skull: from `a` to `b` in turns of π, closed across the front. */
  const cap = (grow: number, from: number, to: number, front: number): void => {
    ctx.beginPath();
    ctx.arc(0, -r * 0.2, r * grow, Math.PI * from, Math.PI * to);
    ctx.lineTo(r * front, -r * 0.2);
    ctx.closePath();
    ctx.fill();
  };
  switch (id) {
    case 'crop':
      cap(1.02, 1.05, 1.98, 0.8);
      break;
    case 'short':
      cap(1.06, 1, 2, 0.85);
      break;
    case 'bowl':
      ctx.beginPath();
      ctx.arc(0, -r * 0.3, r * 1.1, Math.PI, TAU);
      ctx.rect(-r * 1.1, -r * 0.3, r * 2.2, r * 0.28);
      ctx.fill();
      break;
    case 'side':
      cap(1.06, 1, 2, 0.85);
      ctx.fillStyle = w.hairShade;
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 1.2);
      ctx.quadraticCurveTo(r * 0.6, -r * 1.3, r * 1, -r * 0.35);
      ctx.lineTo(r * 0.45, -r * 0.4);
      ctx.closePath();
      ctx.fill();
      break;
    case 'swept':
      ctx.beginPath();
      ctx.moveTo(-r * 1.15, -r * 0.1);
      ctx.quadraticCurveTo(-r * 1.1, -r * 1.7, r * 0.2, -r * 1.35);
      ctx.quadraticCurveTo(r * 1.05, -r * 1.1, r * 0.95, -r * 0.35);
      ctx.closePath();
      ctx.fill();
      break;
    case 'fringe':
      cap(1.06, 1, 2, 0.85);
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 1.2);
      ctx.lineTo(r * 1.05, -r * 1.1);
      ctx.lineTo(r * 0.95, -r * 0.1);
      ctx.lineTo(-r * 0.5, -r * 0.3);
      ctx.closePath();
      ctx.fill();
      break;
    case 'curls':
      for (const [cx, cy] of [[-0.85, -0.5], [-0.5, -1.05], [0.05, -1.25], [0.6, -1.05], [0.95, -0.5]]) {
        ctx.beginPath();
        ctx.arc(cx * r, cy * r, r * 0.46, 0, TAU);
        ctx.fill();
      }
      break;
    case 'afro':
      cap(1.12, 1, 2, 0.9);
      break;
    case 'waves':
    case 'long':
      cap(1.08, 1, 2, 0.88);
      break;
    case 'ponytail':
    case 'bun':
    case 'topknot':
      cap(1.04, 1, 2, 0.86);
      break;
    case 'braid':
      cap(1.06, 1, 2, 0.86);
      break;
    case 'braids':
      cap(1.06, 1, 2, 0.86);
      // The near braid, in front of the cheek. Its twin is behind the skull.
      ctx.fillStyle = w.hairShade;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(r * 0.92, r * 0.35 + i * r * 0.55, r * 0.3, r * 0.3, 0, 0, TAU);
        ctx.fill();
      }
      break;
    case 'locs':
      cap(1.06, 1, 2, 0.86);
      break;
    case 'ridge':
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, -r * 0.95);
      ctx.lineTo(-r * 0.5, -r * 1.85);
      ctx.lineTo(r * 0.25, -r * 2);
      ctx.lineTo(r * 0.7, -r * 1.1);
      ctx.closePath();
      ctx.fill();
      break;
    case 'undercut':
      ctx.beginPath();
      ctx.arc(0, -r * 0.2, r * 1.06, Math.PI * 1.08, Math.PI * 1.92);
      ctx.lineTo(r * 0.7, -r * 0.62);
      ctx.lineTo(-r * 0.7, -r * 0.62);
      ctx.closePath();
      ctx.fill();
      break;
    case 'tonsure':
      ctx.beginPath();
      ctx.arc(0, -r * 0.2, r * 1.06, Math.PI * 1.02, Math.PI * 1.98);
      ctx.arc(0, -r * 0.2, r * 0.62, Math.PI * 1.98, Math.PI * 1.02, true);
      ctx.closePath();
      ctx.fill();
      break;
    default:
      cap(1.06, 1, 2, 0.85);
      break;
  }
}

/** Whatever is on the chin, if anything is. */
function beard(ctx: CanvasRenderingContext2D, w: Worn, r: number, t: Turn): void {
  const id = w.look.beard;
  if (id === 'none') return;
  // A beard is on the front of a face, and gone by the time the face is.
  const show = Math.min(1, Math.max(0, (t.depth + 0.35) / 0.55));
  if (show <= 0) return;
  ctx.fillStyle = id === 'stubble' ? darken(w.hair, -0.05) : w.hair;
  ctx.globalAlpha = (id === 'stubble' ? 0.45 : 1) * show;
  switch (id) {
    case 'stubble':
      ctx.beginPath();
      ctx.arc(r * 0.15, r * 0.35, r * 0.85, Math.PI * 1.85, Math.PI * 0.95);
      ctx.closePath();
      ctx.fill();
      break;
    case 'moustache':
      ctx.fillRect(r * 0.3, r * 0.12, r * 0.75, r * 0.22);
      break;
    case 'goatee':
      ctx.fillRect(r * 0.3, r * 0.12, r * 0.6, r * 0.2);
      ctx.beginPath();
      ctx.ellipse(r * 0.45, r * 0.72, r * 0.26, r * 0.36, 0, 0, TAU);
      ctx.fill();
      break;
    case 'short':
      ctx.beginPath();
      ctx.arc(r * 0.1, r * 0.3, r * 0.92, Math.PI * 1.8, Math.PI * 0.9);
      ctx.closePath();
      ctx.fill();
      break;
    case 'full':
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, -r * 0.1);
      ctx.quadraticCurveTo(-r * 0.4, r * 1.5, r * 0.45, r * 1.45);
      ctx.quadraticCurveTo(r * 1.15, r * 1.1, r * 1.02, -r * 0.2);
      ctx.closePath();
      ctx.fill();
      break;
    case 'long':
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, -r * 0.1);
      ctx.quadraticCurveTo(-r * 0.45, r * 2.6, r * 0.35, r * 2.7);
      ctx.quadraticCurveTo(r * 1.2, r * 1.4, r * 1.02, -r * 0.2);
      ctx.closePath();
      ctx.fill();
      break;
    default:
      break;
  }
  ctx.globalAlpha = 1;
}

/* ---- Which way a figure is turned -------------------------------------- */

/** How many ways round a figure can be turned, now that the view has eight. */
export const FACINGS = 8;
/** How far to each side of the nose an eye sits, in radians. */
const EYE_APART = 0.61;
/**
 * How deep a body is front to back against how wide across the shoulders. It
 * is what a figure edge on narrows to, and the one number here that is a
 * judgement rather than geometry.
 */
const BODY_DEPTH = 0.58;
/**
 * How far past the halfway line a heading swings before the figure turns.
 *
 * Only just past it. The deadband is there to stop a heading that is sitting
 * exactly on a boundary from flicking between two drawings on numerical noise,
 * and that takes a hair — half a step plus three degrees. Wider is worse than
 * none: a *steady* heading a little way past the line then sticks on the wrong
 * facing and stays there, which is not a flicker but a figure walking along
 * looking somewhere else.
 */
const TURN_HOLD = 0.56;

/**
 * Which of the eight ways a figure is turned, from where it is heading.
 *
 * Zero is straight at you, two is screen right, four straight away, six screen
 * left. Take the heading *on screen* rather than in the world: the projection
 * squashes one axis and not the other, so a thing walking north and a thing
 * walking east do not leave at the same angle, and the angle you can see is
 * the one it should be facing.
 *
 * `was` is what it faces now, and it keeps it while the heading stays within a
 * little over half a step. Without that, a walk along a line that happens to
 * sit on a boundary is spent flicking between two drawings.
 */
export function facingOf(sx: number, sy: number, was?: number): number {
  if (Math.abs(sx) + Math.abs(sy) < 1e-6) return was ?? 0;
  const at = (((Math.atan2(sx, sy) / (TAU / FACINGS)) % FACINGS) + FACINGS) % FACINGS;
  if (was !== undefined) {
    let off = at - was;
    if (off > FACINGS / 2) off -= FACINGS;
    if (off < -FACINGS / 2) off += FACINGS;
    if (Math.abs(off) < TURN_HOLD) return was;
  }
  return Math.round(at) % FACINGS;
}

/**
 * A figure is a body in plan rather than a picture with two sides.
 *
 * Everything below is drawn facing right and flipped when it turns the other
 * way, which is the whole of what a two-way figure ever needed. Eight ways
 * needs one number more — how much of the front is showing — and then nothing
 * has to be decided twice. The shoulders find their own width, because a torso
 * seen end on is as wide as the body is thick; the arms find their own places
 * on either side of that, and meet in the middle when it is edge on; the eyes
 * sit on the front of a ball and go round the back with it.
 */
interface Turn {
  /** -1 when the figure is turned to screen left, and the drawing is flipped. */
  mirror: number;
  /** How much of the front shows: 1 straight at you, 0 edge on, -1 away. */
  depth: number;
  /** And how much of the side: 0 square to you, 1 edge on. */
  side: number;
  /** What is left of the shoulders' width at this angle, as a share of it. */
  girth: number;
}

function turnOf(facing: number): Turn {
  const a = (facing / FACINGS) * TAU;
  const depth = Math.cos(a);
  const across = Math.sin(a);
  const side = Math.abs(across);
  return { mirror: across < -1e-9 ? -1 : 1, depth, side, girth: Math.hypot(depth, BODY_DEPTH * side) };
}

/**
 * A head at (cx, cy): hair behind, skull, eyes, hair over, beard.
 *
 * The eyes are placed rather than drawn. A head is a ball with two eyes on the
 * front of it; where each lands on screen and whether it is on the near side
 * at all both fall out of the angle. So the same three lines give two eyes
 * face on, one in profile and none from behind, and every step between them.
 */
function head(ctx: CanvasRenderingContext2D, w: Worn, cx: number, cy: number, r: number, t: Turn): void {
  ctx.save();
  ctx.translate(cx, cy);
  const front = t.depth >= 0;
  // Whatever hangs behind the skull is behind it while you can see the face —
  // which is what hides a ponytail when somebody is walking towards you — and
  // in front of it the moment you are looking at the back of their head.
  if (front) hairBehind(ctx, w, r);
  ctx.fillStyle = w.skin;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  const nose = Math.atan2(t.side, t.depth);
  ctx.fillStyle = w.eye;
  for (const off of [-EYE_APART, EYE_APART]) {
    const at = nose + off;
    const on = Math.cos(at);
    if (on <= 0.12) continue;
    // Foreshortened on its way round the side, so the last one to go narrows
    // rather than winking out at full width.
    const wide = r * 0.28 * Math.max(0.4, on);
    ctx.fillRect(r * 0.62 * Math.sin(at) - wide / 2, -r * 0.33, wide, r * 0.28);
  }
  if (!front) {
    // The back of a head is hair rather than face. Nothing to do for a bald
    // one, which is the point of doing it this way round.
    if (w.look.hair !== 'bald') {
      // The whole skull, not most of it: a cap short of the jaw leaves a pale
      // crescent under it, and a crescent of skin at the bottom of the back of
      // a head reads as a chin on backwards.
      ctx.globalAlpha = Math.min(1, -t.depth * 1.4);
      ctx.fillStyle = w.hair;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    hairBehind(ctx, w, r);
  }
  bothSides(ctx, t, () => hairOver(ctx, w, r));
  bothSides(ctx, t, () => beard(ctx, w, r, t));
  ctx.restore();
}

/**
 * Draw something on both sides of a face.
 *
 * A fringe and a beard are the same on the left of a head as on the right, and
 * every one of these silhouettes is drawn facing right because that was all a
 * two-way figure ever needed. So the far half is the same drawing squashed
 * across: the full width of it when the face is square to you, none of it at
 * all in profile, and the right amount of it at every angle between — which is
 * what a cheek looks like from three quarters on.
 *
 * Both halves are the same opaque colours, so where they overlap there is
 * nothing to see and no seam down the middle of anybody.
 */
function bothSides(ctx: CanvasRenderingContext2D, t: Turn, draw: () => void): void {
  const far = 1 - t.side;
  if (far > 0.01) {
    ctx.save();
    ctx.scale(-far, 1);
    draw();
    ctx.restore();
  }
  draw();
}

/**
 * The same figure, sat down: knees forward over the footboard, both hands out
 * on the reins, and no shadow, because what is under it is the cart.
 */
function drawDriver(ctx: CanvasRenderingContext2D, pose: PlayerPose, w: Worn, t: Turn): void {
  const jolt = pose.moving ? gaitSin(pose, 0.9) * 0.6 : 0;
  const chest = 4.5 * w.build.shoulder;
  // thighs forward, shins down
  ctx.fillStyle = w.trousers;
  ctx.fillRect(-1, -8 + jolt, 8, 3);
  ctx.fillRect(5.5, -8 + jolt, 3, 7);
  // body
  ctx.fillStyle = w.tunic;
  ctx.fillRect(-chest, -20 + jolt, chest * 2, 13);
  ctx.fillStyle = BELT;
  ctx.fillRect(-chest, -9.5 + jolt, chest * 2, 1.6);
  // arms out to the reins
  ctx.fillStyle = w.tunic;
  ctx.fillRect(2, -18 + jolt, 6, 2.4);
  ctx.fillStyle = w.skin;
  ctx.fillRect(7.5, -18.2 + jolt, 2.4, 2.4);
  // reins, running off to the team
  ctx.strokeStyle = '#4a3524';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(9, -17 + jolt);
  ctx.lineTo(15, -12 + jolt);
  ctx.stroke();
  head(ctx, w, 0, -24.5 + jolt, 4.6, t);
}

/** Draws the character with its feet at (sx, sy). */
export function drawPlayer(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: PlayerPose): void {
  const w = wornOf(pose);
  const b = w.build;
  const t = turnOf(pose.facing);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * t.mirror, zoom);
  if (pose.swimming) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 4.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = w.tunic;
    ctx.fillRect(-6, -8, 12, 7);
    head(ctx, w, 0, -12, 5.5, t);
    ctx.restore();
    return;
  }
  if (pose.driving) {
    drawDriver(ctx, pose, w, t);
    ctx.restore();
    return;
  }
  const swing = pose.moving ? gaitSin(pose) : 0;
  /*
   * A hop lifts the whole figure and a wave swings one arm, and both of them
   * ride the numbers that were already here: `bob` is subtracted from every y
   * below, and the shadow is drawn before it and stays where it is — which is
   * what makes a hop look like leaving the ground rather than growing.
   */
  const em = pose.emote ? emotePose(pose.emote, pose.emoteT ?? 0) : null;
  const bob = pose.moving ? Math.abs(Math.cos(pose.phase)) * 1.2 : 0;
  /*
   * A hop lifts the *whole* figure, legs included, which the walking bob above
   * deliberately does not — a stride rides the chest a pixel over still legs.
   * Seven pixels of it does not: the first screenshot of a hop had a torso
   * floating clear of a pair of legs still standing on the ground. So `lift`
   * is its own number and reaches everything drawn, and only the shadow is
   * left where it was, because the shadow is the ground.
   */
  const lift = em?.lift ?? 0;
  // Across the shoulders, and then what is left of it at this angle.
  const span = 4.5 * b.shoulder;
  const chest = span * t.girth;
  const waist = 4.5 * b.waist * t.girth;
  const hips = 3.5 * b.hip;
  // The shadow marks the one subtile the character stands on.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 11, 5, 0, 0, TAU);
  ctx.fill();
  /*
   * Legs. They do not get thinner as the figure turns, they come together:
   * two hips a fixed distance apart, swinging round with the body until edge
   * on they are one behind the other. Same for the arms below.
   */
  const legW = Math.max(1.8, hips * 0.92);
  const apart = hips * 0.55 * t.depth;
  ctx.fillStyle = darken(w.trousers, 0.16);
  ctx.fillRect(apart - legW / 2, -12 - swing * 2 - lift, legW, 12 + swing * 2);
  ctx.fillStyle = w.trousers;
  ctx.fillRect(-apart - legW / 2, -12 + swing * 2 - lift, legW, 12 - swing * 2);
  // arms
  const armSwing = pose.working ? gaitSin(pose, 2.2) * 5 : swing * 3;
  const arm = (span + 0.9) * t.depth;
  const sleeve = 3.3;
  const hand = 2.5;
  // The far one goes down before the body and comes up a shade darker, so a
  // figure with its back to you has an arm behind it rather than stuck on.
  ctx.fillStyle = darken(w.tunic, 0.16);
  ctx.fillRect(arm - sleeve / 2, -25 - bob - lift - armSwing, sleeve, 8);
  ctx.fillStyle = darken(w.skin, 0.16);
  ctx.fillRect(arm - hand / 2, -17 - bob - lift - armSwing, hand, hand);
  // body: shoulders at the top, waist at the belt, so a build is a taper
  // rather than a wider rectangle.
  ctx.fillStyle = w.tunic;
  ctx.beginPath();
  ctx.moveTo(-chest, -26 - bob - lift);
  ctx.lineTo(chest, -26 - bob - lift);
  ctx.lineTo(waist, -12 - bob - lift);
  ctx.lineTo(-waist, -12 - bob - lift);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = BELT;
  ctx.fillRect(-waist - 0.2, -14.5 - bob - lift, waist * 2 + 0.4, 1.6);
  // and the near arm over the body it swings across — or up beside the head,
  // when there is a wave in it.
  ctx.fillStyle = w.tunic;
  if (em && em.wave !== 0) {
    const lean = em.wave * 2.2;
    ctx.fillRect(-arm - sleeve / 2 + lean, -33 - bob - lift, sleeve, 9);
    ctx.fillStyle = w.skin;
    ctx.fillRect(-arm - hand / 2 + lean * 1.6, -35 - bob - lift, hand, hand);
  } else {
    ctx.fillRect(-arm - sleeve / 2, -25 - bob - lift + armSwing, sleeve, 8);
    ctx.fillStyle = w.skin;
    ctx.fillRect(-arm - hand / 2, -17 - bob - lift + armSwing, hand, hand);
  }
  head(ctx, w, 0, -31 - bob - lift, 4.6, t);
  ctx.restore();
}

/**
 * Just the head, filling the box.
 *
 * Choosing a haircut off a whole body means judging nine pixels of it; the
 * same head at four times the size is the difference between twenty choices
 * and twenty thumbnails that all look the same. Same `head()` as the figure,
 * so a thumbnail cannot drift from the body it is promising.
 */
export function drawHeadshot(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, look: Look): void {
  const w = wornOf({ phase: 0, moving: false, facing: 1, swimming: false, working: false, look });
  const r = size / 6.6;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  // A ground of its own. Without it black hair on a dark card is twenty
  // identical squares, which is the one thing a row of thumbnails must not be.
  ctx.fillStyle = '#4b5460';
  ctx.fillRect(x, y, size, size);
  // Shoulders, so a head is not a balloon and long hair has something to fall
  // on — small, because the head is what is being chosen.
  ctx.fillStyle = w.tunic;
  ctx.beginPath();
  ctx.ellipse(x + size / 2, y + size * 1.24, size * 0.36, size * 0.3, 0, 0, TAU);
  ctx.fill();
  head(ctx, w, x + size / 2, y + size * 0.5, r, turnOf(1));
  ctx.restore();
}

/**
 * The same figure, standing still and big, for the creator to draw into a
 * square of its own. It is `drawPlayer` and not a second drawing of a person:
 * a preview that is its own code is a preview that can lie to you, and the
 * whole point of choosing a face is seeing the one you will get.
 */
export function drawPortrait(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, look: Look, phase = 0, facing = 1): void {
  const zoom = Math.min(w / 26, h / 42);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  // Three quarters on by default, which is the angle a face is easiest to
  // judge at and the one the game showed everybody before it could turn.
  drawPlayer(ctx, x + w / 2, y + h - h * 0.08, zoom, {
    phase, moving: false, facing, swimming: false, working: false, look,
  });
  ctx.restore();
}
