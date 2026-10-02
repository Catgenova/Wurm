/**
 * Drawing a portcullis, a drawbridge and the mark on a hidden door
 * (`src/game/gates.ts` for the rules).
 *
 * Everything here is handed a projection rather than a camera: a wall face as
 * `t` along the border, `k` up the storey and `s` through the thickness
 * (`WallFace`), or a world point and a height (`Project`). So nothing in here
 * knows which way the view is turned, and every turn of it draws the same
 * thing from its own side.
 */
import { DOOR, DOUBLE } from './masonry';
import { UNITS_PER_TILE } from './iso';

type RGB = readonly [number, number, number];
const rgb = (c: RGB, k: number, a = 1): string =>
  `rgba(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0},${a})`;

/** Wrought iron, lit and in shadow, and the ink every piece of it is outlined in. */
const IRON: RGB = [74, 78, 88];
const IRON_HI: RGB = [150, 156, 168];
const IRON_INK: RGB = [28, 29, 34];
/** The drawbridge's timber: the wooden bridge's planks and its side. */
const PLANK: RGB = [125, 98, 67];
const PLANK_SIDE: RGB = [82, 61, 40];
const TIMBER: RGB = [112, 84, 52];

/** A wall face: `t` along it, `k` up it, `s` from the near face (1) to the far one (-1). */
export interface WallFace {
  px: (t: number, k: number, s?: number) => number;
  py: (t: number, k: number, s?: number) => number;
}

/**
 * How far down a portcullis hangs, nought to one, off whether it is down and
 * when it last moved. It drops in `PORTCULLIS_DROP` seconds and is wound up
 * in `PORTCULLIS_RISE`: drawing only, the rule changes the moment the job does.
 */
export const PORTCULLIS_DROP = 0.7;
export const PORTCULLIS_RISE = 2.4;
/** And a drawbridge, nought lying down to one standing on end. */
export const DRAWBRIDGE_RISE = 3.2;
export const DRAWBRIDGE_FALL = 2.2;

/** Where something that moves between two ends is, now, and what it was going to. */
export interface Motion {
  from: number;
  to: number;
  at: number;
  secs: number;
}

/**
 * Move a motion on: where it is now, starting a new move from there when the
 * end it is going to has changed. A thing first seen is where it is, and so is
 * one whose clock has gone back past its last move.
 */
export function moveTo(m: Motion | undefined, to: number, now: number, up: number, down: number): { m: Motion; at: number } {
  if (!m || now < m.at) return { m: { from: to, to, at: now, secs: 0 }, at: to };
  const where = (): number => {
    if (m.secs <= 0) return m.to;
    const f = Math.min(1, Math.max(0, (now - m.at) / m.secs));
    // Eased: a load taken up slowly and let go quickly.
    const e = f * f * (3 - 2 * f);
    return m.from + (m.to - m.from) * e;
  };
  if (m.to !== to) {
    const here = where();
    const secs = (to > here ? up : down) * Math.abs(to - here);
    return { m: { from: here, to, at: now, secs }, at: here };
  }
  return { m, at: where() };
}

// ---------------------------------------------------------------------------
// The portcullis
// ---------------------------------------------------------------------------

/**
 * The way through a portcullis: as wide as a double door, the game's cart
 * gate (`DOUBLE`), under a segmental head -- a flat arc of a circle that
 * springs from the jambs at `spring` of the storey and rises to `crown` --
 * since a round head that wide would stand higher than the storey does.
 */
export const GATEWAY = { t0: DOUBLE.t0, t1: DOUBLE.t1, spring: 0.56, crown: 0.74 } as const;
/** The depth of the ring of voussoirs round its head, in height units, and how many stones are in it. */
const RING = 4;
const VOUSSOIRS = 11;

/** An opening with a curved head, as the renderer's own archway is (`Renderer.archGeom`), with the ring round it. */
export interface ArchShape {
  t0: number;
  t1: number;
  spring: number;
  steps: number;
  /** The head, `u` nought at one springing to one at the other. */
  headT: (u: number) => number;
  headK: (u: number) => number;
  /** A point on the head carried `out` height units out from it, along the radius: the ring's outer edge at `RING`. */
  ring: (u: number, out: number) => [number, number];
  /** How high the opening is over `t`, along the head as it is drawn, chord by chord; the springing past either jamb. */
  kAt: (t: number) => number;
  /** How far across the opening is at height `k`, jamb to jamb or along the head, as `[from, to]`; null over the crown. */
  span: (k: number) => [number, number] | null;
  hole: (s: number) => void;
  outline: (s: number) => void;
  rim: (s: number) => void;
}

/** The way through a portcullis, on a wall face: `GATEWAY` laid out on the storey, which is `storeyUnits` tall. */
export function gatewayArch(ctx: CanvasRenderingContext2D, f: WallFace, zoom: number, storeyUnits: number): ArchShape {
  const { t0, t1, spring, crown } = GATEWAY;
  const mid = (t0 + t1) / 2;
  // In height units on both axes, so the arc is a true arc on the ground.
  const half = ((t1 - t0) / 2) * UNITS_PER_TILE;
  const rise = (crown - spring) * storeyUnits;
  const r = (half * half + rise * rise) / (2 * rise);
  const sweep = Math.asin(half / r);
  const centre = crown - r / storeyUnits;
  const steps = zoom >= 0.9 ? 12 : 6;
  const ring = (u: number, out: number): [number, number] => {
    const a = sweep * (2 * u - 1);
    return [mid + ((r + out) * Math.sin(a)) / UNITS_PER_TILE, centre + ((r + out) * Math.cos(a)) / storeyUnits];
  };
  const headT = (u: number): number => ring(u, 0)[0];
  const headK = (u: number): number => ring(u, 0)[1];
  // The head as it is drawn: `steps` chords, left to right, the crown at the middle point.
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) pts.push(ring(i / steps, 0));
  const kAt = (t: number): number => {
    if (t <= t0 || t >= t1) return spring;
    for (let i = 0; i < steps; i++) {
      const [ta, ka] = pts[i];
      const [tb, kb] = pts[i + 1];
      if (t <= tb) return ka + ((kb - ka) * (t - ta)) / (tb - ta || 1);
    }
    return spring;
  };
  const span = (k: number): [number, number] | null => {
    if (k <= spring) return [t0, t1];
    for (let i = 0; i < steps / 2; i++) {
      const [ta, ka] = pts[i];
      const [tb, kb] = pts[i + 1];
      if (k <= kb) {
        const t = ta + ((tb - ta) * (k - ka)) / (kb - ka || 1);
        return [t, 2 * mid - t];
      }
    }
    return null;
  };
  const edge = (s: number, close: boolean): void => {
    ctx.moveTo(f.px(t0, 0, s), f.py(t0, 0, s));
    ctx.lineTo(f.px(t0, spring, s), f.py(t0, spring, s));
    for (let i = 1; i <= steps; i++) ctx.lineTo(f.px(pts[i][0], pts[i][1], s), f.py(pts[i][0], pts[i][1], s));
    ctx.lineTo(f.px(t1, 0, s), f.py(t1, 0, s));
    if (close) ctx.closePath();
  };
  return {
    t0, t1, spring, steps, headT, headK, ring, kAt, span,
    hole: (s) => edge(s, true),
    outline: (s) => { ctx.beginPath(); edge(s, true); },
    rim: (s) => { ctx.beginPath(); edge(s, false); },
  };
}

/**
 * What a portcullis gateway is built of round its opening, on the face: a
 * ring of voussoirs over the head with its keystone standing a little proud,
 * and dressed stones up both jambs, long and short in turn, in `fill` and
 * outlined in `ink` -- the stone and the line the wall is drawn in -- with a
 * line `line` wide. Without `detail`, the ring and the jambs as shapes only.
 */
export function drawGatewayDressing(ctx: CanvasRenderingContext2D, f: WallFace, a: ArchShape, fill: RGB, ink: RGB,
  { detail, line }: { detail: boolean; line: number }): void {
  const at = (t: number, k: number): [number, number] => [f.px(t, k), f.py(t, k)];
  /** Each stone as a list of points, and the share of `fill` it takes. */
  const stones: Array<{ pts: Array<[number, number]>; tone: number }> = [];
  // The jambs, from the ground to the springing, both sides alike, long and short in turn.
  const courses = 4;
  const long = 4.4 / UNITS_PER_TILE;
  const short = 2.6 / UNITS_PER_TILE;
  for (let i = 0; i < courses; i++) {
    const k0 = (a.spring * i) / courses;
    const k1 = (a.spring * (i + 1)) / courses;
    const w = i % 2 ? short : long;
    for (const [ta, tb] of [[a.t0 - w, a.t0], [a.t1, a.t1 + w]] as Array<[number, number]>) {
      stones.push({ pts: [at(ta, k0), at(tb, k0), at(tb, k1), at(ta, k1)], tone: i % 2 ? 1.02 : 0.97 });
    }
  }
  // The ring, a stone at a time, the middle one the keystone.
  const n = detail ? VOUSSOIRS : 1;
  const sub = detail ? 2 : a.steps;
  for (let i = 0; i < n; i++) {
    const u0 = i / n;
    const u1 = (i + 1) / n;
    const key = detail && i === (n - 1) / 2;
    const out = key ? RING + 1.2 : RING;
    const pts: Array<[number, number]> = [];
    for (let j = 0; j <= sub; j++) pts.push(at(...a.ring(u0 + ((u1 - u0) * j) / sub, 0)));
    for (let j = sub; j >= 0; j--) pts.push(at(...a.ring(u0 + ((u1 - u0) * j) / sub, out)));
    stones.push({ pts, tone: key ? 1.12 : i % 2 ? 1.04 : 0.98 });
  }
  const trace = (pts: Array<[number, number]>): void => {
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  ctx.save();
  // One fill a tone, and one line round every stone.
  for (const tone of new Set(stones.map((st) => st.tone))) {
    ctx.beginPath();
    for (const st of stones) if (st.tone === tone) trace(st.pts);
    ctx.fillStyle = rgb(fill, tone);
    ctx.fill();
  }
  if (detail) {
    ctx.beginPath();
    for (const st of stones) trace(st.pts);
    ctx.lineJoin = 'round';
    ctx.lineWidth = line;
    ctx.strokeStyle = rgb(ink, 0.95, 0.75);
    ctx.stroke();
  }
  ctx.restore();
}

/** A masonry face's picture with a portcullis's gateway in it, made once for each picture. */
const GATEWAY_PICTURES = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
/**
 * The ink of the dressing in a picture, in its own pixels: about what the
 * line round a stone is drawn on the screen at zoom one and two, where a
 * section's 512 pixels go into fifty and a hundred.
 */
const PICTURE_LINE = 8;

/**
 * A masonry face's picture -- `t` across it, `k` up it, a storey
 * `storeyUnits` tall -- with a portcullis's gateway in it: the voussoirs and
 * jamb stones laid on in `fill` and `ink`, and the opening cut out of the lot,
 * as an archway's picture has its own hole cut and its ring laid. Made once
 * for each picture and kept, so that a gateway is a picture laid like any
 * other and only its grille is drawn new each frame.
 */
export function gatewayPicture(face: HTMLCanvasElement, storeyUnits: number, fill: RGB, ink: RGB): HTMLCanvasElement {
  const had = GATEWAY_PICTURES.get(face);
  if (had) return had;
  const c = document.createElement('canvas');
  c.width = face.width;
  c.height = face.height;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.drawImage(face, 0, 0);
  const f: WallFace = { px: (t) => t * c.width, py: (_t, k) => (1 - k) * c.height };
  // The head in its finest chords, which the frame's own outline of it follows at zoom one and over.
  const a = gatewayArch(g, f, 1, storeyUnits);
  drawGatewayDressing(g, f, a, fill, ink, { detail: true, line: PICTURE_LINE });
  // Opaque, so the hole takes out all of what is under it.
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  a.outline(1);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  GATEWAY_PICTURES.set(face, c);
  return c;
}

/** What grows over the face, with a portcullis's gateway cut out of it, made once for each picture. */
const GATEWAY_CLEAR = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/**
 * A picture laid over a masonry face -- the ivy that spills down it, the
 * tongue that hangs from the head of an opening, and the tussocks at the foot
 * of its jambs -- with the gateway's opening taken out of it, so what grows
 * there grows on the stone round it and nothing stands in front of the grille
 * or in its way. `top` is how high the
 * picture is laid, in storeys, from the foot of the face. Made once for each
 * picture and kept, as `gatewayPicture` is.
 */
export function gatewayClear(img: HTMLCanvasElement, storeyUnits: number, top = 1): HTMLCanvasElement {
  const had = GATEWAY_CLEAR.get(img);
  if (had) return had;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.drawImage(img, 0, 0);
  const f: WallFace = { px: (t) => t * c.width, py: (_t, k) => ((top - k) / top) * c.height };
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  gatewayArch(g, f, 1, storeyUnits).outline(1);
  g.fill();
  GATEWAY_CLEAR.set(img, c);
  return c;
}

/** How far either side of the middle of the wall's thickness a groove is cut, as a share of half of it. */
const GROOVE = 0.3;

/**
 * The grooves the grille runs in: a slot down the middle of each jamb's
 * thickness and on round the soffit, where the grille goes up out of sight --
 * dark, with its near lip catching the light, so it reads as cut. Laid on the
 * faces of the way through, so whatever stands in front of them (the face's
 * picture, laid after; a clip, on a wall drawn flat) keeps them to it.
 */
export function drawGrooves(ctx: CanvasRenderingContext2D, f: WallFace, zoom: number, a: ArchShape): void {
  if (zoom < 0.6) return;
  // The edge of the opening, jamb, head and jamb, as the faces of the way through are drawn.
  const edge: Array<[number, number]> = [[a.t0, 0], [a.t0, a.spring]];
  for (let i = 1; i < a.steps; i++) edge.push([a.headT(i / a.steps), a.headK(i / a.steps)]);
  edge.push([a.t1, a.spring], [a.t1, 0]);
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < edge.length - 1; i++) {
    const [ta, ka] = edge[i];
    const [tb, kb] = edge[i + 1];
    ctx.moveTo(f.px(ta, ka, -GROOVE), f.py(ta, ka, -GROOVE));
    ctx.lineTo(f.px(tb, kb, -GROOVE), f.py(tb, kb, -GROOVE));
    ctx.lineTo(f.px(tb, kb, GROOVE), f.py(tb, kb, GROOVE));
    ctx.lineTo(f.px(ta, ka, GROOVE), f.py(ta, ka, GROOVE));
    ctx.closePath();
  }
  ctx.fillStyle = 'rgba(14, 12, 10, 0.86)';
  ctx.fill();
  // The near lip, in the light.
  ctx.beginPath();
  edge.forEach(([t, k], i) => (i ? ctx.lineTo(f.px(t, k, GROOVE), f.py(t, k, GROOVE)) : ctx.moveTo(f.px(t, k, GROOVE), f.py(t, k, GROOVE))));
  ctx.strokeStyle = 'rgba(232, 222, 198, 0.62)';
  ctx.lineWidth = Math.max(0.8, 0.7 * zoom);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

/**
 * The grille of a portcullis in its gateway, `down` of the way from wound up
 * into the stone over the opening to standing on the threshold.
 *
 * It hangs in grooves cut in the jambs, halfway through the wall's thickness,
 * so it is laid on the wall's middle plane (`s` nought), and every bar and
 * rail is cut where it goes into the stone at the head of the opening there
 * (`ArchShape.kAt`, `ArchShape.span`): the near half of each jamb stands in
 * front of it, and the far half of the passage is seen through it. Wound up,
 * the points of its bars hang a rail's pitch under the crown; down, they are
 * in the ground. Nine bars across the double door's width of the gateway and
 * a rail every thirty centimetres, which is an iron grille's pitch and still
 * reads as a grille at the size a gate is drawn.
 */
export function drawGrille(ctx: CanvasRenderingContext2D, f: WallFace, a: ArchShape, zoom: number, down: number, lit: number,
  storeyUnits: number): void {
  const { t0, t1, crown } = GATEWAY;
  const tall = crown + 0.06;
  // Wound up, its points hang a rail's pitch under the crown, so a raised one is still seen to be there.
  const bottom = (1 - down) * (crown - 0.09);
  const top = bottom + tall;
  const S = 0;
  const bars = 9;
  const pitch = 0.3 / (storeyUnits / 10);
  /** Where a bar at `t` goes up into the stone. */
  const head = (t: number): number => Math.min(top, a.kAt(t));
  ctx.save();
  ctx.lineCap = 'butt';
  if (zoom < 0.6) {
    // Shapes and colours only: the grille as a shade of iron across the opening, up to its head.
    const foot = a.span(bottom);
    if (foot) {
      ctx.fillStyle = rgb(IRON, lit * 0.8, 0.45);
      ctx.beginPath();
      ctx.moveTo(f.px(foot[0], bottom, S), f.py(foot[0], bottom, S));
      ctx.lineTo(f.px(foot[1], bottom, S), f.py(foot[1], bottom, S));
      for (let i = a.steps; i >= 0; i--) {
        const t = a.headT(i / a.steps);
        const k = a.headK(i / a.steps);
        if (k > bottom) ctx.lineTo(f.px(t, k, S), f.py(t, k, S));
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  // Each layer is one path, laid over the whole grille at once: the bars do not cross one another, so a layer at a
  // time draws what a bar at a time did, in a tenth of the strokes.
  const lines = (segs: Array<[number, number, number, number]>): void => {
    ctx.beginPath();
    for (const [ta, ka, tb, kb] of segs) {
      if (kb <= ka && tb <= ta) continue;
      ctx.moveTo(f.px(ta, ka, S), f.py(ta, ka, S));
      ctx.lineTo(f.px(tb, kb, S), f.py(tb, kb, S));
    }
    ctx.stroke();
  };
  const w = Math.max(1.2, 1.9 * zoom);
  // The bars that come down out of the stone at all: one wound up clear of the sides is in it there.
  const across: number[] = [];
  for (let i = 0; i < bars; i++) {
    const t = t0 + ((t1 - t0) * (i + 0.5)) / bars;
    if (head(t) > bottom + 0.032) across.push(t);
  }
  const rails: Array<[number, number, number]> = [];
  for (let k = bottom + pitch * 0.6; k < top; k += pitch) {
    const sp = a.span(k);
    if (sp) rails.push([k, sp[0], sp[1]]);
  }
  const railSegs = rails.map(([k, ta, tb]): [number, number, number, number] => [ta, k, tb, k]);
  const barSegs = across.map((t): [number, number, number, number] => [t, bottom + 0.03, t, head(t)]);
  // The shadow it throws on the far side of the passage, a little down and along.
  ctx.strokeStyle = 'rgba(20, 18, 14, 0.22)';
  ctx.lineWidth = w;
  lines(across.map((t) => [t + 0.012, bottom, t + 0.012, head(t + 0.012)]));
  // The rails, behind the bars: flat iron laid across them, their ends in the grooves.
  ctx.strokeStyle = rgb(IRON_INK, 1, 0.95);
  ctx.lineWidth = w * 0.95 + Math.max(0.8, zoom * 0.9);
  lines(railSegs);
  ctx.strokeStyle = rgb(IRON, lit * 0.95);
  ctx.lineWidth = w * 0.95;
  lines(railSegs);
  // The bars, over them: outlined, then the iron, then the light down one edge of each, off the south-east.
  ctx.strokeStyle = rgb(IRON_INK, 1);
  ctx.lineWidth = w + Math.max(0.8, zoom * 0.9);
  lines(barSegs);
  ctx.strokeStyle = rgb(IRON, lit);
  ctx.lineWidth = w;
  lines(barSegs);
  ctx.strokeStyle = rgb(IRON_HI, lit, 0.55);
  ctx.lineWidth = Math.max(0.6, w * 0.35);
  lines(across.map((t) => [t - 0.004, bottom + 0.04, t - 0.004, head(t - 0.004)]));
  // The points: a wedge of iron on each bar, driven into the ground when it is down.
  const half = 0.011;
  ctx.beginPath();
  for (const t of across) {
    ctx.moveTo(f.px(t - half, bottom + 0.032, S), f.py(t - half, bottom + 0.032, S));
    ctx.lineTo(f.px(t + half, bottom + 0.032, S), f.py(t + half, bottom + 0.032, S));
    ctx.lineTo(f.px(t, bottom, S), f.py(t, bottom, S));
    ctx.closePath();
  }
  ctx.fillStyle = rgb(IRON, lit * 0.9);
  ctx.fill();
  ctx.strokeStyle = rgb(IRON_INK, 1);
  ctx.lineWidth = Math.max(0.6, zoom * 0.7);
  ctx.stroke();
  // Rivets where a rail crosses a bar, close enough in to be seen.
  if (zoom >= 1.1) {
    ctx.fillStyle = rgb(IRON_HI, lit, 0.7);
    const r = Math.max(0.6, 0.75 * zoom);
    ctx.beginPath();
    for (const t of across) {
      for (const [k] of rails) {
        if (k >= head(t)) continue;
        const x = f.px(t, k, S);
        const y = f.py(t, k, S);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The hidden door's mark
// ---------------------------------------------------------------------------

/**
 * The mark on a hidden door that only whoever its padlock admits is shown: the
 * seam of the leaf in the stone, a dashed line a little heavier than the
 * joints round it so that it is found at a glance, and the keyhole. Everybody
 * else is sent a solid wall and has nothing to draw it on (`wall_seen_type`).
 */
export function drawHiddenMark(ctx: CanvasRenderingContext2D, f: WallFace, zoom: number, ink: RGB): void {
  if (zoom < 0.6) return;
  const { t0, t1, k1 } = DOOR;
  ctx.save();
  ctx.setLineDash([Math.max(2, 3 * zoom), Math.max(1.5, 2.4 * zoom)]);
  ctx.lineWidth = Math.max(1.2, 1.4 * zoom);
  ctx.strokeStyle = rgb(ink, 0.75, 0.8);
  ctx.beginPath();
  ctx.moveTo(f.px(t0, 0.02), f.py(t0, 0.02));
  ctx.lineTo(f.px(t0, k1), f.py(t0, k1));
  ctx.lineTo(f.px(t1, k1), f.py(t1, k1));
  ctx.lineTo(f.px(t1, 0.02), f.py(t1, 0.02));
  ctx.stroke();
  ctx.setLineDash([]);
  // The keyhole, where a key goes into the stone: dark, in a rim of worn bright metal, so that it holds at a
  // glance and by night, when the seam round it has gone into the dark of the wall.
  const kx = f.px(t1 - 0.05, 0.38);
  const ky = f.py(t1 - 0.05, 0.38);
  const r = Math.max(1.2, 1.6 * zoom);
  const keyhole = (grow: number): void => {
    ctx.beginPath();
    ctx.arc(kx, ky - r * 0.6, r + grow, 0, Math.PI * 2);
    ctx.moveTo(kx - r * 0.5 - grow, ky - r * 0.3);
    ctx.lineTo(kx + r * 0.5 + grow, ky - r * 0.3);
    ctx.lineTo(kx + r * 0.35 + grow, ky + r * 1.5 + grow);
    ctx.lineTo(kx - r * 0.35 - grow, ky + r * 1.5 + grow);
    ctx.closePath();
  };
  const rim = Math.max(1, 0.9 * zoom);
  keyhole(rim);
  ctx.fillStyle = 'rgba(226, 214, 182, 0.92)';
  ctx.fill();
  keyhole(0);
  ctx.fillStyle = 'rgba(20, 18, 16, 0.95)';
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The drawbridge
// ---------------------------------------------------------------------------

/** A world point and a height, to the screen. */
export type Project = (x: number, y: number, h: number) => [number, number];

/**
 * Where everything about one drawbridge is in the world: the hinge, the way
 * it runs, how long its deck is, how high it is carried, and how far it is
 * standing up (`up`, nought lying on the far bank to one on end).
 */
export interface DrawbridgeGeom {
  /** The middle of the hinge, at the border between the winch end and the first span. */
  hx: number;
  hy: number;
  /** Along the bridge, from the winch end to the far end, and across it. */
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  /** Tiles of deck, the height it is carried at, and how far up it stands. */
  len: number;
  h: number;
  up: number;
  /** The ground at a world point: where a post or the winch stands on it. */
  groundAt: (x: number, y: number) => number;
}

/** Half the deck's width, in tiles, and where the gallows posts stand across it and behind the hinge. */
const HALF = 0.42;
const POST_OUT = 0.52;
const POST_BACK = 0.14;
const POST_SIDE = 0.045;
/** The deck's depth, in height units. */
const DEEP = 2.6;
/** How far in from the deck's far end the chains take hold of it, in tiles: at the far edge, where they lift it best. */
const CHAIN_IN = 0.06;
/**
 * How high the gallows' beam is carried over the deck, as a share of the
 * deck's length: more than three quarters of it, so the deck stood on end
 * rises only a little over the frame that holds it.
 */
const LIFT = 0.78;
/** How far behind each post its raking brace comes to the ground, in tiles, and how far up the post it meets it. */
const RAKE = 0.46;
const RAKE_UP = 0.55;
/**
 * The cribs a drawbridge rests on: squared timbers laid in courses, crossed,
 * from the ground up to the deck. One under the hinge and the gallows, as far
 * back as the posts and a little past them each side; one under the far end,
 * where the deck comes down on the far bank. Where a bank is level with the
 * deck they are its sill and nothing more; where it falls away under a hinge,
 * they are what carries it.
 */
const CRIB_BACK = POST_BACK + 0.16;
const CRIB_W = POST_OUT + 0.1;
const LAND_OUT = 0.26;
const LAND_W = HALF + 0.06;
const COURSE = 3.2;
const CRIB: RGB = [98, 76, 50];

/** A point on the deck: `d` tiles out from the hinge along it, `w` across, `z` up off its top face. */
const deckPoint = (g: DrawbridgeGeom, d: number, w: number, z = 0): [number, number, number] => {
  const a = g.up * Math.PI / 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Lying down, `z` is up; stood on end, it is back toward the winch.
  const along = d * c - (z / UNITS_PER_TILE) * s;
  const high = d * s * UNITS_PER_TILE + z * c;
  return [g.hx + g.ux * along + g.nx * w, g.hy + g.uy * along + g.ny * w, g.h + high];
};

/** Where the chains take hold of the deck, in tiles out from the hinge: at its far edge. */
const chainAt = (g: DrawbridgeGeom): number => g.len - CHAIN_IN;

/** The underside of the gallows' beam: `LIFT` of the deck's length over the deck. */
export const gallowsTop = (g: DrawbridgeGeom): number => g.h + LIFT * g.len * UNITS_PER_TILE;

/** What a foot stands on at a point by the hinge: the bank, or the crib's top where the bank falls away under the deck. */
const standAt = (g: DrawbridgeGeom, x: number, y: number): number => Math.max(g.groundAt(x, y), g.h);

const poly = (ctx: CanvasRenderingContext2D, pts: Array<[number, number]>): void => {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
};

/**
 * A length of chain between two points: a dark line with its links picked out
 * in a lighter iron, sagging a little in the middle when it is slack.
 */
function chain(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number], sag: number, zoom: number, lit: number): void {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2 + sag;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgb(IRON_INK, 1, 0.95);
  ctx.lineWidth = Math.max(1.4, 2.4 * zoom);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.quadraticCurveTo(mx, my, b[0], b[1]);
  ctx.stroke();
  if (zoom >= 0.6) {
    ctx.strokeStyle = rgb(IRON_HI, lit, 0.9);
    ctx.lineWidth = Math.max(0.9, 1.3 * zoom);
    ctx.setLineDash([Math.max(1.2, 1.8 * zoom), Math.max(1.2, 1.6 * zoom)]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(mx, my, b[0], b[1]);
    ctx.stroke();
  }
  ctx.restore();
}

/** How a face is lit, off the way it faces outward: the light walls are drawn in (`Renderer.faceLight`). */
export type FaceLit = (ox: number, oy: number) => number;

/**
 * A square post stood on the ground, as two faces and a top: `at` its foot,
 * `h0` and `h1` how high it runs.
 */
function post(ctx: CanvasRenderingContext2D, P: Project, x: number, y: number, h0: number, h1: number, side: number,
  near: (dx: number, dy: number) => boolean, lit: FaceLit, colour: RGB, zoom: number): void {
  const c: Array<[number, number]> = [[x - side, y - side], [x + side, y - side], [x + side, y + side], [x - side, y + side]];
  // The two faces turned toward the camera: the ones whose outward way the camera is on.
  const faces: Array<[number, number, number, number]> = [[0, 1, 0, -1], [1, 2, 1, 0], [2, 3, 0, 1], [3, 0, -1, 0]];
  ctx.lineWidth = Math.max(0.8, zoom * 0.9);
  ctx.strokeStyle = rgb(colour, 0.55);
  let most = 0;
  for (const [i, j, ox, oy] of faces) {
    if (!near(ox, oy)) continue;
    const a = c[i];
    const b = c[j];
    const l = lit(ox, oy);
    most = Math.max(most, l);
    poly(ctx, [P(a[0], a[1], h0), P(b[0], b[1], h0), P(b[0], b[1], h1), P(a[0], a[1], h1)]);
    ctx.fillStyle = rgb(colour, l);
    ctx.fill();
    ctx.stroke();
  }
  poly(ctx, c.map(([px, py]) => P(px, py, h1)));
  ctx.fillStyle = rgb(colour, Math.min(1.3, most * 1.2));
  ctx.fill();
  ctx.stroke();
}

/**
 * A crib: a box of squared timbers in courses, `d0` to `d1` tiles out from the
 * hinge along the bridge and `w` either side of its middle, from the ground
 * up to the deck's top. The faces turned to the camera are drawn down to the
 * ground under each corner, and only where they stand out of it; each course
 * a band of its own, the timbers crossing turn about, with a dark seam over
 * it; and the top, timbers across it, in the light the deck lies in (`flat`).
 */
export function drawCrib(ctx: CanvasRenderingContext2D, P: Project, g: DrawbridgeGeom, d0: number, d1: number, w: number, zoom: number,
  near: (dx: number, dy: number) => boolean, lit: FaceLit, flat: number): void {
  const at = (d: number, s: number): [number, number] => [g.hx + g.ux * d + g.nx * s, g.hy + g.uy * d + g.ny * s];
  const top = g.h;
  // Outward from each face, and its two corners.
  const faces: Array<[number, number, [number, number], [number, number]]> = [
    [-g.ux, -g.uy, at(d0, -w), at(d0, w)],
    [g.ux, g.uy, at(d1, -w), at(d1, w)],
    [-g.nx, -g.ny, at(d0, -w), at(d1, -w)],
    [g.nx, g.ny, at(d0, w), at(d1, w)],
  ];
  ctx.save();
  ctx.lineJoin = 'round';
  const seamW = Math.max(0.6, 0.8 * zoom);
  for (const [ox, oy, a, b] of faces) {
    if (!near(ox, oy)) continue;
    const ga = Math.min(top, g.groundAt(a[0], a[1]) - 1);
    const gb = Math.min(top, g.groundAt(b[0], b[1]) - 1);
    if (ga >= top - 0.2 && gb >= top - 0.2) continue;
    const l = lit(ox, oy);
    const quad: Array<[number, number]> = [P(a[0], a[1], ga), P(b[0], b[1], gb), P(b[0], b[1], top), P(a[0], a[1], top)];
    poly(ctx, quad);
    ctx.fillStyle = rgb(CRIB, l);
    ctx.fill();
    if (zoom >= 0.6) {
      ctx.save();
      poly(ctx, quad);
      ctx.clip();
      // Every other course a shade darker: the timbers that run the other way, end on.
      const low = Math.min(ga, gb);
      for (let i = 0, h = top; h > low; i++, h -= COURSE) {
        if (i % 2 === 1) {
          poly(ctx, [P(a[0], a[1], h), P(b[0], b[1], h), P(b[0], b[1], h - COURSE), P(a[0], a[1], h - COURSE)]);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
          ctx.fill();
        }
        const [x0, y0] = P(a[0], a[1], h - COURSE);
        const [x1, y1] = P(b[0], b[1], h - COURSE);
        ctx.strokeStyle = 'rgba(30, 20, 10, 0.45)';
        ctx.lineWidth = seamW;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      ctx.restore();
    }
    poly(ctx, quad);
    ctx.strokeStyle = rgb(CRIB, 0.45);
    ctx.lineWidth = Math.max(0.8, zoom * 0.9);
    ctx.stroke();
  }
  // The top: the last course, its timbers laid across the bridge.
  const q: Array<[number, number]> = [at(d0, -w), at(d1, -w), at(d1, w), at(d0, w)].map(([x, y]) => P(x, y, top));
  poly(ctx, q);
  ctx.fillStyle = rgb(CRIB, flat * 1.08);
  ctx.fill();
  ctx.strokeStyle = rgb(CRIB, 0.45);
  ctx.lineWidth = Math.max(0.8, zoom * 0.9);
  ctx.stroke();
  if (zoom >= 0.6) {
    const n = Math.max(1, Math.round((d1 - d0) / 0.1));
    ctx.strokeStyle = 'rgba(30, 20, 10, 0.3)';
    ctx.lineWidth = seamW;
    for (let i = 1; i < n; i++) {
      const d = d0 + ((d1 - d0) * i) / n;
      const [x0, y0] = at(d, -w);
      const [x1, y1] = at(d, w);
      const [sx0, sy0] = P(x0, y0, top);
      const [sx1, sy1] = P(x1, y1, top);
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** The crib under the hinge and the gallows: what carries both where the bank falls away under the deck. */
export const drawHingeCrib = (ctx: CanvasRenderingContext2D, P: Project, g: DrawbridgeGeom, zoom: number,
  near: (dx: number, dy: number) => boolean, lit: FaceLit, flat: number): void =>
  drawCrib(ctx, P, g, -CRIB_BACK, 0, CRIB_W, zoom, near, lit, flat);

/** And the one the far end comes down on. */
export const drawLandingCrib = (ctx: CanvasRenderingContext2D, P: Project, g: DrawbridgeGeom, zoom: number,
  near: (dx: number, dy: number) => boolean, lit: FaceLit, flat: number): void =>
  drawCrib(ctx, P, g, g.len, g.len + LAND_OUT, LAND_W, zoom, near, lit, flat);

/** A squared timber between two points, as a thick line with its edges: a brace. */
function brace(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number], zoom: number, l: number): void {
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.strokeStyle = rgb(TIMBER, 0.5);
  ctx.lineWidth = Math.max(2, 3.6 * zoom);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
  ctx.strokeStyle = rgb(TIMBER, l);
  ctx.lineWidth = Math.max(1.2, 2.4 * zoom);
  ctx.stroke();
  ctx.restore();
}

/**
 * The gallows and the winch at the hinge end: two squared posts either side
 * of the deck, each with a raking brace behind it against the deck's pull and
 * a knee brace under the beam across their heads, a sheave on the beam over
 * each edge of the deck, and the drum the chains wind onto, its axle through
 * the posts' feet and a crank wheel on its end. Each chain comes up off the
 * deck's far edge, over its sheave and straight down onto the drum, so what
 * lifts the deck is there to be followed from end to end. The posts
 * stand on the bank, or on the crib under the hinge where the bank falls away.
 */
export function drawGallows(ctx: CanvasRenderingContext2D, P: Project, g: DrawbridgeGeom, zoom: number,
  near: (dx: number, dy: number) => boolean, lit: FaceLit): void {
  const top = gallowsTop(g);
  const bx = g.hx - g.ux * POST_BACK;
  const by = g.hy - g.uy * POST_BACK;
  const posts = [-1, 1].map((s) => [bx + g.nx * POST_OUT * s, by + g.ny * POST_OUT * s] as [number, number]);
  // Drawn far one first: the one lower on the screen is the nearer.
  posts.sort((a, b) => P(a[0], a[1], standAt(g, a[0], a[1]))[1] - P(b[0], b[1], standAt(g, b[0], b[1]))[1]);
  const detail = zoom >= 0.6;
  // The light on the beam's face and the iron on it: the face of it turned to the camera.
  const beamLit = near(-g.ux, -g.uy) ? lit(-g.ux, -g.uy) : lit(g.ux, g.uy);
  const dh = standAt(g, bx, by) + DRUM_UP;
  const bh = 3.2;
  // The rakes: from the bank behind each post up to two thirds of it, behind the posts or in front of them.
  const rakesNear = near(-g.ux, -g.uy);
  const rakes = (): void => {
    for (const [x, y] of posts) {
      const fx = x - g.ux * RAKE;
      const fy = y - g.uy * RAKE;
      const foot = standAt(g, x, y);
      const lean = near(g.nx, g.ny) === (x - bx) * g.nx + (y - by) * g.ny > 0 ? lit(g.nx, g.ny) : lit(-g.nx, -g.ny);
      brace(ctx, P(fx, fy, g.groundAt(fx, fy) - 0.5), P(x - g.ux * POST_SIDE, y - g.uy * POST_SIDE, foot + (top - foot) * RAKE_UP), zoom, lean);
    }
  };
  if (!rakesNear) rakes();
  // The drum first: its ends are in the posts, which stand over them.
  drawDrum(ctx, P, g, bx, by, dh, zoom, beamLit, detail);
  // The chains down off the sheaves onto the drum.
  for (const s of [-1, 1]) {
    const x = bx + g.nx * HALF * s;
    const y = by + g.ny * HALF * s;
    chain(ctx, P(x, y, top + bh * 0.5), P(x, y, dh + 1.5), 0, zoom, beamLit);
  }
  // The crank wheel stands outside the post on its side: behind that post, or in front of it.
  const crankNear = near(g.nx, g.ny);
  if (detail && !crankNear) drawCrank(ctx, P, g, bx, by, dh, zoom);
  // A hand into what it stands on, so a post on a slope does not stand on one corner.
  for (const [x, y] of posts) post(ctx, P, x, y, standAt(g, x, y) - 1, top, POST_SIDE, near, lit, TIMBER, zoom);
  if (detail && crankNear) drawCrank(ctx, P, g, bx, by, dh, zoom);
  if (rakesNear) rakes();
  // The knee braces, from each post up under the beam.
  if (detail) {
    for (const s of [-1, 1]) {
      const px0 = bx + g.nx * (POST_OUT - POST_SIDE) * s;
      const py0 = by + g.ny * (POST_OUT - POST_SIDE) * s;
      const px1 = bx + g.nx * (POST_OUT - 0.16) * s;
      const py1 = by + g.ny * (POST_OUT - 0.16) * s;
      brace(ctx, P(px0, py0, top - 6), P(px1, py1, top), zoom * 0.8, beamLit);
    }
  }
  // The beam across their heads.
  const beam = (s: number): [number, number] => [bx + g.nx * (POST_OUT + 0.06) * s, by + g.ny * (POST_OUT + 0.06) * s];
  const [l, r] = [beam(-1), beam(1)];
  poly(ctx, [P(l[0], l[1], top), P(r[0], r[1], top), P(r[0], r[1], top + bh), P(l[0], l[1], top + bh)]);
  ctx.fillStyle = rgb(TIMBER, beamLit);
  ctx.fill();
  ctx.strokeStyle = rgb(TIMBER, 0.5);
  ctx.lineWidth = Math.max(0.8, zoom * 0.9);
  ctx.stroke();
  // The sheaves the chains run over, iron, on the beam over each edge of the deck.
  if (detail) {
    for (const s of [-1, 1]) {
      const [sx, sy] = P(bx + g.nx * HALF * s, by + g.ny * HALF * s, top + bh * 0.5);
      ctx.fillStyle = rgb(IRON, beamLit);
      ctx.strokeStyle = rgb(IRON_INK, 1);
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1.2, 2.2 * zoom), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

/** How high the winch's drum is carried over the ground, in height units: a man's waist. */
const DRUM_UP = 9;

/** The drum, from post to post, with the chain wound on it. */
function drawDrum(ctx: CanvasRenderingContext2D, P: Project, g: DrawbridgeGeom, bx: number, by: number, dh: number, zoom: number,
  lit: number, detail: boolean): void {
  const [a0, a1] = P(bx - g.nx * POST_OUT, by - g.ny * POST_OUT, dh);
  const [b0, b1] = P(bx + g.nx * POST_OUT, by + g.ny * POST_OUT, dh);
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgb(TIMBER, 0.55);
  ctx.lineWidth = Math.max(3, 7 * zoom);
  ctx.beginPath();
  ctx.moveTo(a0, a1);
  ctx.lineTo(b0, b1);
  ctx.stroke();
  ctx.strokeStyle = rgb(TIMBER, lit * 0.95);
  ctx.lineWidth = Math.max(2, 5 * zoom);
  ctx.stroke();
  if (detail) {
    // The chain wound on it, between where the two chains come down.
    const [c0, c1] = P(bx - g.nx * HALF, by - g.ny * HALF, dh);
    const [d0, d1] = P(bx + g.nx * HALF, by + g.ny * HALF, dh);
    ctx.strokeStyle = rgb(IRON, 0.9, 0.9);
    ctx.lineWidth = Math.max(1, 1.6 * zoom);
    ctx.setLineDash([Math.max(1, 1.4 * zoom), Math.max(1, 1.4 * zoom)]);
    ctx.beginPath();
    ctx.moveTo(c0, c1);
    ctx.lineTo(d0, d1);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.lineCap = 'butt';
}

/** The spoked wheel on the drum's end, outside the post on the deck's `+n` side, that a body turns to wind it. */
function drawCrank(ctx: CanvasRenderingContext2D, P: Project, g: DrawbridgeGeom, bx: number, by: number, dh: number, zoom: number): void {
  const out = POST_OUT + POST_SIDE + 0.04;
  const cx = bx + g.nx * out;
  const cy = by + g.ny * out;
  const [a0, a1] = P(bx + g.nx * POST_OUT, by + g.ny * POST_OUT, dh);
  const [wx, wy] = P(cx, cy, dh);
  // The axle out through the post to it.
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgb(IRON_INK, 1);
  ctx.lineWidth = Math.max(1, 1.6 * zoom);
  ctx.beginPath();
  ctx.moveTo(a0, a1);
  ctx.lineTo(wx, wy);
  ctx.stroke();
  // The wheel stands across the axle: a circle in the upright plane along the
  // deck, put on the screen as the view has it -- full face from the side, a
  // line end on -- with four spokes.
  const r = 0.09;
  const [ux0, uy0] = P(cx + g.ux * r, cy + g.uy * r, dh);
  const [zx0, zy0] = P(cx, cy, dh + r * UNITS_PER_TILE);
  const U = [ux0 - wx, uy0 - wy];
  const Z = [zx0 - wx, zy0 - wy];
  const at = (a: number): [number, number] => [wx + Math.cos(a) * U[0] + Math.sin(a) * Z[0], wy + Math.cos(a) * U[1] + Math.sin(a) * Z[1]];
  ctx.strokeStyle = rgb(TIMBER, 0.6);
  ctx.lineWidth = Math.max(1, 1.5 * zoom);
  ctx.beginPath();
  for (let i = 0; i <= 16; i++) {
    const [x, y] = at((i / 16) * Math.PI * 2);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = at((i * Math.PI) / 4);
    const [x1, y1] = at((i * Math.PI) / 4 + Math.PI);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

/** Twice the area a polygon on the screen encloses, signed by which way round it is drawn. */
const winding = (pts: ReadonlyArray<[number, number]>): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a;
};

/**
 * The deck, whole, at however far up it stands: a box of planks turned about
 * its hinge. Drawn on the hinge's border, like a wall, while it is anything
 * but lying flat on the far bank -- lying flat, it is laid a span at a time
 * with everything else that stands on those tiles (`drawDrawbridgeSpan`).
 *
 * Its edges, then whichever of its two broad faces is turned to the camera:
 * the top -- planks across it and the two iron straps the chains take hold
 * of -- or the underside, the planks' backs on the three stringers they are
 * nailed to. Which one is found off the screen rather than worked out from
 * the turn: the top's four corners go round the same way as the deck's
 * lying flat, which is always seen from above, exactly when the top faces the
 * camera. Seen from the winch, that is at every height; from the far bank,
 * until it is a little under halfway up. `lit` is the light on the top and
 * on the underside, off the way each faces (`FaceLit`, as a wall is lit)
 * blended with the light on it lying flat (`flat`) as far as it lies.
 */
export function drawStandingDeck(ctx: CanvasRenderingContext2D, P: Project, g: DrawbridgeGeom, zoom: number, flat: number,
  lit: FaceLit): void {
  const D = (d: number, w: number, z = 0): [number, number] => {
    const [x, y, h] = deckPoint(g, d, w, z);
    return P(x, y, h);
  };
  const lying = (d: number, w: number): [number, number] => P(g.hx + g.ux * d + g.nx * w, g.hy + g.uy * d + g.ny * w, g.h);
  const ref = winding([lying(0, -HALF), lying(g.len, -HALF), lying(g.len, HALF), lying(0, HALF)]);
  const top = winding([D(0, -HALF), D(g.len, -HALF), D(g.len, HALF), D(0, HALF)]);
  const topSeen = Math.sign(top) === Math.sign(ref) && top !== 0;
  const z0 = topSeen ? 0 : -DEEP;
  // The light: the top as the floor it was and the wall it becomes, the underside as the wall it becomes.
  const up = Math.min(1, Math.max(0, g.up));
  const faceLit = topSeen ? flat + (lit(-g.ux, -g.uy) - flat) * up : lit(g.ux, g.uy) * 0.92;
  // The far end's thickness and the edges, then the face, back to front.
  poly(ctx, [D(g.len, -HALF, 0), D(g.len, HALF, 0), D(g.len, HALF, -DEEP), D(g.len, -HALF, -DEEP)]);
  ctx.fillStyle = rgb(PLANK_SIDE, faceLit);
  ctx.fill();
  for (const w of [-HALF, HALF]) {
    poly(ctx, [D(0, w, 0), D(g.len, w, 0), D(g.len, w, -DEEP), D(0, w, -DEEP)]);
    ctx.fillStyle = rgb(PLANK_SIDE, faceLit * 0.95);
    ctx.fill();
  }
  const q = [D(0, -HALF, z0), D(g.len, -HALF, z0), D(g.len, HALF, z0), D(0, HALF, z0)];
  poly(ctx, q);
  ctx.fillStyle = rgb(topSeen ? PLANK : PLANK_SIDE, topSeen ? faceLit : faceLit * 1.15);
  ctx.fill();
  ctx.strokeStyle = rgb(PLANK_SIDE, 0.6);
  ctx.lineWidth = Math.max(0.8, zoom);
  ctx.stroke();
  if (zoom < 0.6) return;
  // The seams between the planks, across it, on either face.
  ctx.strokeStyle = topSeen ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.22)';
  ctx.lineWidth = Math.max(0.6, 0.8 * zoom);
  const n = Math.round(g.len * 8);
  for (let i = 1; i < n; i++) {
    const d = (g.len * i) / n;
    const [a0, a1] = D(d, -HALF, z0);
    const [b0, b1] = D(d, HALF, z0);
    ctx.beginPath();
    ctx.moveTo(a0, a1);
    ctx.lineTo(b0, b1);
    ctx.stroke();
  }
  if (topSeen) {
    // Two straps of iron along it, where the chains take hold at the far end.
    ctx.strokeStyle = rgb(IRON, faceLit * 0.9, 0.95);
    ctx.lineWidth = Math.max(1, 1.6 * zoom);
    for (const w of [-HALF * 0.78, HALF * 0.78]) {
      const [a0, a1] = D(0, w, z0);
      const [b0, b1] = D(g.len, w, z0);
      ctx.beginPath();
      ctx.moveTo(a0, a1);
      ctx.lineTo(b0, b1);
      ctx.stroke();
    }
    return;
  }
  // The stringers under it: three squared timbers along it, each a band with its shadowed edge.
  for (const w of [-HALF * 0.8, 0, HALF * 0.8]) {
    const band = [D(0.02, w - 0.05, -DEEP), D(g.len - 0.02, w - 0.05, -DEEP), D(g.len - 0.02, w + 0.05, -DEEP), D(0.02, w + 0.05, -DEEP)];
    poly(ctx, band);
    ctx.fillStyle = rgb(TIMBER, faceLit);
    ctx.fill();
    ctx.strokeStyle = rgb(PLANK_SIDE, 0.55);
    ctx.lineWidth = Math.max(0.7, 0.9 * zoom);
    ctx.stroke();
  }
}

/** Where a chain takes hold of the deck, and where it comes off the gallows. */
export function chainEnds(g: DrawbridgeGeom, side: -1 | 1): { deck: [number, number, number]; beam: [number, number, number] } {
  const top = gallowsTop(g) + 1.6;
  return {
    deck: deckPoint(g, chainAt(g), HALF * 0.78 * side),
    beam: [g.hx - g.ux * POST_BACK + g.nx * HALF * side, g.hy - g.uy * POST_BACK + g.ny * HALF * side, top],
  };
}

/**
 * Both chains, whole: from the sheaves on the gallows to the ring at the
 * deck's far edge, with the slack they have lying down.
 */
export function drawChains(ctx: CanvasRenderingContext2D, P: Project, g: DrawbridgeGeom, zoom: number, lit: number,
  part?: { d0: number; d1: number }): void {
  for (const side of [-1, 1] as const) {
    const { deck, beam } = chainEnds(g, side);
    if (!part) {
      const a = P(beam[0], beam[1], beam[2]);
      const b = P(deck[0], deck[1], deck[2]);
      chain(ctx, a, b, 4 * zoom * (1 - g.up), zoom, lit);
      continue;
    }
    // A share of it, between two distances along the bridge from the gallows: none past the ring.
    const reach = chainAt(g);
    if (part.d0 >= reach) continue;
    const span = reach + POST_BACK;
    const at = (d: number): [number, number] => {
      const f = Math.min(1, Math.max(0, (d + POST_BACK) / span));
      return P(beam[0] + (deck[0] - beam[0]) * f, beam[1] + (deck[1] - beam[1]) * f, beam[2] + (deck[2] - beam[2]) * f);
    };
    chain(ctx, at(part.d0), at(Math.min(part.d1, reach)), 0, zoom, lit);
  }
}

/**
 * One span of the deck lying down, as a tile of bridge is: its planks, its
 * edges, the straps along it, and the lengths of both chains over it. `i` is
 * which span, counted from the hinge; `done` whether this span is decked, and
 * `whole` whether it has chains -- the gallows and its chains go up with the
 * last span, and never on a building's floor, so until then, and there, there
 * are no chains to draw.
 */
export function drawDrawbridgeSpan(ctx: CanvasRenderingContext2D, P: Project, g: DrawbridgeGeom, i: number, zoom: number, lit: number, done: boolean,
  whole: boolean): void {
  const D = (d: number, w: number, z = 0): [number, number] => {
    const [x, y, h] = deckPoint(g, d, w, z);
    return P(x, y, h);
  };
  const d0 = i;
  const d1 = i + 1;
  if (!done) {
    // Stringers only, as any bridge is while it is being built.
    ctx.strokeStyle = rgb(PLANK_SIDE, 1);
    ctx.lineWidth = Math.max(1, 1.6 * zoom);
    for (const w of [-HALF * 0.8, HALF * 0.8]) {
      const [a0, a1] = D(d0, w);
      const [b0, b1] = D(d1, w);
      ctx.beginPath();
      ctx.moveTo(a0, a1);
      ctx.lineTo(b0, b1);
      ctx.stroke();
    }
    return;
  }
  // The thickness along both edges, then the top.
  for (const w of [-HALF, HALF]) {
    poly(ctx, [D(d0, w), D(d1, w), D(d1, w, -DEEP), D(d0, w, -DEEP)]);
    ctx.fillStyle = rgb(PLANK_SIDE, lit * 0.95);
    ctx.fill();
  }
  if (i === g.len - 1) {
    poly(ctx, [D(d1, -HALF), D(d1, HALF), D(d1, HALF, -DEEP), D(d1, -HALF, -DEEP)]);
    ctx.fillStyle = rgb(PLANK_SIDE, lit);
    ctx.fill();
  }
  poly(ctx, [D(d0, -HALF), D(d1, -HALF), D(d1, HALF), D(d0, HALF)]);
  ctx.fillStyle = rgb(PLANK, lit);
  ctx.fill();
  ctx.strokeStyle = rgb(PLANK_SIDE, 0.7);
  ctx.lineWidth = Math.max(0.8, zoom);
  ctx.stroke();
  if (zoom >= 0.6) {
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = Math.max(0.6, 0.8 * zoom);
    for (let j = 1; j < 8; j++) {
      const d = d0 + j / 8;
      const [a0, a1] = D(d, -HALF);
      const [b0, b1] = D(d, HALF);
      ctx.beginPath();
      ctx.moveTo(a0, a1);
      ctx.lineTo(b0, b1);
      ctx.stroke();
    }
    ctx.strokeStyle = rgb(IRON, lit * 0.9, 0.95);
    ctx.lineWidth = Math.max(1, 1.6 * zoom);
    for (const w of [-HALF * 0.78, HALF * 0.78]) {
      const [a0, a1] = D(d0, w, 0.2);
      const [b0, b1] = D(d1, w, 0.2);
      ctx.beginPath();
      ctx.moveTo(a0, a1);
      ctx.lineTo(b0, b1);
      ctx.stroke();
    }
    // The ring each chain takes hold of, at the far edge.
    if (i === Math.min(g.len - 1, Math.floor(chainAt(g)))) {
      ctx.strokeStyle = rgb(IRON_INK, 1);
      ctx.lineWidth = Math.max(0.8, zoom);
      for (const w of [-HALF * 0.78, HALF * 0.78]) {
        const [rx, ry] = D(chainAt(g), w, 0.5);
        ctx.beginPath();
        ctx.arc(rx, ry, Math.max(1, 1.6 * zoom), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  // And the chains over this span, from where they cross its near edge to its far one.
  if (whole) drawChains(ctx, P, g, zoom, lit, { d0, d1 });
}
