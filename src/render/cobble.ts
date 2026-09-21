/**
 * Cobblestone, five ways, one seam.
 *
 * A cobblestone wall used to be a flat colour with a few ruled lines on it.
 * What it is now is a picture of one: the blocks a novice laid and the weather
 * has been at since, the ivy that has got over the top of it, the hedge grown
 * up its foot. The pictures are painted once, into canvases, and the renderer
 * fills the wall's faces with them; nothing here knows about the camera.
 *
 * Five of them, and they are interchangeable because they all keep one
 * contract at their edges. Sideways: on three of the four courses, and on the
 * band, a stone straddles the seam, drawn to the same shape and tone in every
 * variant, and the fourth course leaves a joint there no wider than any other,
 * so no two courses have an edge in the same place at a seam. Upwards: each
 * storey is a band course over four courses of blocks, so any variant stacks
 * on any variant and the band reads as the string course at each floor.
 *
 * What grows depends on where in the wall it is, so it is not painted into the
 * face. `spill` is the ivy, which belongs to the top storey, and is painted
 * taller than a face so the crest of it stands above the cap; `base` is the
 * hedge and `foot` the damp, which belong to the ground storey. Nothing that
 * is one variant's own comes within `MARGIN` of a seam.
 *
 * How things are drawn: every mass of growth is lobes the size of leaf
 * clusters under a dark olive line, lit from above -- a pale crown, a green
 * middle, a dark underside -- and every block is two flat tones with a bevel
 * along its top and the dark of its line only where the light leaves it. The
 * greens are sampled off the castle art the island is meant to sit beside.
 */

type Rand = () => number;
type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];
/** A lobe of a mass of growth: where it is, and how big. */
type Lobe = [number, number, number];
/** One block of a wall, and the outline it was drawn with. */
interface Block { x: number; y: number; w: number; h: number; course: number; pts: Pt[] }
/** How many more blocks of a tone are owed, so sand and brown come in pairs. */
interface Run { tone: string; left: number }
/** Ivy over the top of a section: a crest, and the curtain that falls from it. */
interface Drape { cx: number; w: number; fall: number; tongues?: number; seed: number }
/** A hedge at the foot of one. */
interface Hedge { cx: number; w: number; h: number; flowers: number; seed: number }
interface Variant {
  name: string;
  tells: string;
  seed: number;
  extras: { moss: number };
  drapes: Drape[];
  foot: { hedges: Hedge[] };
}

/**
 * Where an archway is cut, as fractions of a wall section.
 *
 * `t0` and `t1` are how far along the wall the jambs stand and `spring` how
 * far up it the curve starts. The rise is not here because it is not a free
 * number: a true semicircle rises by exactly the half span, and the renderer
 * works that out from these two in the units it already has.
 *
 * One statement, read by the texture that cuts the hole and by the renderer
 * that clips to it, because a hole in a picture and a hole in a wall that do
 * not agree is a wall with a seam of daylight round its doorway.
 *
 * Two numbers set by looking at it rather than by arithmetic.
 *
 * The head has to come down inside the wall: at half the storey the crown of
 * a 1.9 m opening stood 2.5 m up a 3 m wall, which leaves half a metre for
 * the ring that holds it and the course over that, so the ring ran off the
 * top of the section.
 *
 * And the straight part has to be longer than the curve is wide, or the
 * opening is a headstone. A semicircle on jambs its own radius long is the
 * shape of a grave marker and the eye says so before it says doorway. These
 * spans put the jamb at half again the radius: 1.7 m wide, 2.1 m to the
 * crown, and a course of field stone over the ring before the band.
 */
export const ARCH = { t0: 0.29, t1: 0.71, spring: 0.42 } as const;

/**
 * And where a window is cut, in the same fractions.
 *
 * Taller than the old one and a little narrower, for the reason a window in
 * rubble is always taller than it is wide: everything over it has to stand on
 * what is either side of it. The head comes down to 2.1 m so there is room
 * between it and the band for the lintel and the course of small wedges over
 * that, which is how a wall like this gets a metre and a third of nothing to
 * stay up.
 */
export const WINDOW = { t0: 0.33, t1: 0.67, k0: 0.3, k1: 0.7 } as const;

/**
 * And where a doorway is cut. It starts at the ground, so it has no `k0`.
 *
 * The numbers are the ones every other material's door has always used. A
 * doorway is the one opening whose size is settled by the man walking through
 * it rather than by what will stand up over it: 1.3 m by 2.2 m.
 */
export const DOOR = { t0: 0.34, t1: 0.66, k1: 0.74 } as const;

/**
 * And a cart gate, which is the same doorway twice as wide.
 *
 * Its head is a little lower than the single one's, and for a reason worth
 * saying: two and a half metres is further than the oak over it will go
 * unaided, so there is a corbel under each end of the beam and a corbel wants
 * a course to sit in. A gate is wide, not tall -- you drive a cart through it,
 * and a cart is not two and a quarter metres high.
 */
export const DOUBLE = { t0: 0.2, t1: 0.8, k1: 0.7 } as const;

/**
 * And a bay, which is a window that does not stay in the wall.
 *
 * Narrower than the old one, and for a reason the picture cares about and the
 * flat colours did not: the jambs of an opening this wide are drawn stones,
 * and at 0.18 they reached into the courses that straddle the section's seam
 * and cut them in half. At 0.24 there is a stone's width of ordinary field
 * between the jamb and the seam, so a bay butts its neighbours like anything
 * else. The head comes down for the same reason the window's did -- the
 * lintel and the wedges over it have to fit under the band.
 */
export const BAY = { t0: 0.24, t1: 0.76, k0: 0.33, k1: 0.72 } as const;

/** The painted wall, in the pieces a renderer fills its faces with. */
export interface Cobble {
  /** One per variant: the stone of a storey, which butts any other left or right and stacks on any. */
  face: HTMLCanvasElement[];
  /** The same, with an archway cut through it and a ring of rough voussoirs round the hole. */
  arch: HTMLCanvasElement[];
  /** What grows into that opening: ivy dangling from the head of it, and grass in the threshold. */
  archIvy: HTMLCanvasElement[];
  archWeed: HTMLCanvasElement[];
  /** The same with a window: the hole, the ivy over it, and what has seeded behind the sill. */
  window: HTMLCanvasElement[];
  winIvy: HTMLCanvasElement[];
  winWeed: HTMLCanvasElement[];
  /** And with a doorway, whose head is a baulk of oak rather than anything cut. */
  door: HTMLCanvasElement[];
  doorIvy: HTMLCanvasElement[];
  doorWeed: HTMLCanvasElement[];
  /** And a cart gate: the same at twice the span, with a corbel under each end of the beam. */
  gate: HTMLCanvasElement[];
  gateIvy: HTMLCanvasElement[];
  gateWeed: HTMLCanvasElement[];
  /** And a bay: the hole and the shelf it stands on. What stands on it is not flat, so it is not here. */
  bay: HTMLCanvasElement[];
  /** The ivy of the top storey, `pad` px taller than a face, the extra above its top edge. */
  spill: HTMLCanvasElement[];
  /** The hedge at the foot of the ground storey, and the damp along its ground line. */
  base: HTMLCanvasElement[];
  foot: HTMLCanvasElement[];
  /** The cap along the top of a wall, and the end grain where a run stops. */
  cap: HTMLCanvasElement;
  ends: HTMLCanvasElement;
  /**
   * The stone the wall's own thickness shows in the reveal of an archway.
   *
   * A painted wall's face is a picture, not the material's flat colour, so
   * the colour the material carries is no guide to what the side of a hole
   * cut through it should be. This is the picture's own shaded stone.
   */
  reveal: [number, number, number];
  /** And the ink it outlines every block with, for the edge of a hole cut in it. */
  line: [number, number, number];
  /** The oak over a doorway, for the leaf hung under it and the soffit it makes. */
  beam: [number, number, number];
  beamLine: [number, number, number];
  /** A section is `w` by `h`; the ivy reaches `pad` above it, and the cap is `capH` deep. */
  w: number;
  h: number;
  pad: number;
  capH: number;
  /** What each variant carries, for anything that wants to say. */
  tells: string[];
}

let painted: Cobble | undefined;

/**
 * The five, painted. It takes a moment, and it is done once: every cobblestone
 * wall on the island shares the result, so the cost of it does not go up with
 * the size of a deed.
 */
export function cobble(): Cobble {
  if (painted) return painted;
  const PASTEL = {
    grass: '#91d693', shade: '#7ec391', sand: '#f3d192', cream: '#f4ecd5',
    // stone, sampled off the castle: light, mid, and the joints between
    stone: '#cbc0b0', stoneShade: '#aba796', stoneDark: '#a19d8d', joint: '#aeaa9c',
    dark: '#b5b1a0',
    warm: '#ccbea3', warmShade: '#ae9f84',
    /*
     * The stone of an opening, which is stone that was picked over rather
     * than picked up, and the mortar packed in behind it.
     *
     * It is a real step lighter than the field and the mortar a real step
     * darker than the field's, because at the far zoom a ring drawn in the
     * field's own tones is nine pixels of wall doing nothing: the arch goes
     * and a grey slab with a hole in it is left. `reveal` is what the wall's
     * own thickness shows in the way through -- warm, because a face turned
     * from the light loses light and not colour.
     */
    dress: '#ded5c4', dressShade: '#bbb0a0', dressHi: '#efe8dc',
    ringJoint: '#a09a8a', reveal: '#b3ab97',
    /*
     * And the one piece of wood in the whole wall.
     *
     * A window gets a stone lintel and a course of wedges over it because a
     * window is small. A doorway is not, and a man who cannot cut a voussoir
     * is not going to find and dress a stone four feet long either: he lays a
     * baulk of oak across it and builds on top of that. It is the only thing
     * in the picture that is not stone, and that is the point of it.
     */
    beam: '#b0906a', beamShade: '#927757', beamHi: '#c3a681', beamLine: '#6d5840',
    // the lit top bevel of each block: its own lit tone, a step lighter
    stoneHi: '#ddd4c6', warmHi: '#d9cdb3', darkHi: '#bdb9aa', bandHi: '#e3dbcc',
    blush: '#f2c4c0', blushShade: '#dfa39e', blushLine: '#b9797a',
    // moss as a stain: the stone's tones pulled half way to the leaf's
    stain: '#9eae8d', stainShade: '#81957c',
    band: '#d3c9b8', bandShade: '#b5ae9e', line: '#94896c',
    // greens, off the castle; their line is a deeper version of themselves
    leaf: '#8fb268', leafShade: '#729d6b', leafDeep: '#588463', leafPale: '#adca7b', leafLine: '#5e7d4b',
    creamShade: '#dacdb3', creamLine: '#9a8e70',
  };
  const TW = 512, TH = 384, MORTAR = 3;                 // a section: 4 m by 3 m, at 128 px to the metre
  const EDGE = 16;                                       // nothing private nearer the seam than this
  const BAND = 48;                                       // the flat course at the top of every storey
  const COURSES = 4, CH = (TH - BAND) / COURSES;         // and four courses of blocks under it
  /** The courses whose stone straddles the seam, and how far it reaches either side of it: three of
   *  them, reaching unequally, so the joints near the seam stagger the way a running bond does. */
  const STRADDLE: Record<number, [number, number]> = { 0: [-40, 58], 1: [-52, 68], 3: [-70, 46] };
  /** And the tone each straddling stone takes, the same in every variant, so colour reaches the seams too. */
  const STRADDLE_TONE: Record<number, string> = { 0: '', 1: 'brown', 3: 'green' };
  const CAP_H = 64;                                      // the top face's texture, front edge at the bottom

  function rand(seed: number): Rand {
    let s = (seed * 2654435761) >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

  /** A closed curve through the midpoints of a polygon: nothing is straight, nothing repeats. */
  function shape(g: Ctx, pts: Pt[]): void {
    const n = pts.length, m0 = mid(pts[n - 1], pts[0]);
    g.beginPath(); g.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) { const p = pts[i], m = mid(p, pts[(i + 1) % n]); g.quadraticCurveTo(p[0], p[1], m[0], m[1]); }
    g.closePath();
  }
  /** Points round a squarish oval (p near 1 is round, near 0.4 is a block with soft corners), jittered
   *  in angle and, inwards only, in radius: nothing drawn through them ever leaves the box, so a stone
   *  never reaches across its joint into the seam or the storey above. */
  function blob(cx: number, cy: number, rx: number, ry: number, n: number, R: Rand, p: number, aj: number, rj: number): Pt[] {
    const pts: Pt[] = [], step = Math.PI * 2 / n;
    for (let i = 0; i < n; i++) {
      const a = i * step + (R() - 0.5) * step * aj * 2, rr = 1 - R() * rj * 2;
      const c = Math.cos(a), s = Math.sin(a);
      pts.push([cx + Math.sign(c) * Math.pow(Math.abs(c), p) * rx * rr, cy + Math.sign(s) * Math.pow(Math.abs(s), p) * ry * rr]);
    }
    return pts;
  }
  /** Two flat tones and a line: shade underneath, lit sitting up-left of it, line on top. */
  function solid(g: Ctx, pts: Pt[], lit: string, shade: string, line: string, lw: number, dx: number, dy: number): void {
    shape(g, pts); g.fillStyle = shade; g.fill();
    g.save(); shape(g, pts); g.clip(); g.translate(dx, dy); shape(g, pts); g.fillStyle = lit; g.fill(); g.restore();
    shape(g, pts); g.strokeStyle = line; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke();
  }
  /** The outline of a union of circles, shifted and grown. */
  function unionPath(g: Ctx, cs: Lobe[], ox: number, oy: number, grow: number): void {
    g.beginPath();
    for (const [x, y, r] of cs) { const rr = Math.max(1, r + grow); g.moveTo(x + ox + rr, y + oy); g.arc(x + ox, y + oy, rr, 0, 7); }
  }
  /** A hex colour with an alpha, for the soft edge under a line. */
  const hexA = (hex: string, a: number): string => 'rgba(' + channels(hex).join(',') + ',' + a + ')';
  /** A hex colour as three numbers, for anything outside that wants to light it itself. */
  const channels = (hex: string): [number, number, number] =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  /** What a mass casts on the stones behind it: one flat darkening, down and right. */
  function shadowOf(g: Ctx, cs: Lobe[], ox: number, oy: number): void {
    unionPath(g, cs, ox, oy, 2); g.fillStyle = 'rgba(110,100,80,0.22)'; g.fill();
  }

  /* ---- stone -------------------------------------------------------------- */
  /* The tones a block can take. Most are the pale stone; the rest are sand, a warm brown, a grey-green
   * and the dark grey, all at the reference's low saturation, each with its own lit, shade and bevel. */
  const TONES: Record<string, { lit: string; shade: string; hi: string }> = {
    '':    { lit: PASTEL.stone, shade: PASTEL.stoneShade, hi: PASTEL.stoneHi },
    warm:  { lit: '#c6bdab', shade: '#a89d8b', hi: '#d3cabb' },
    dress: { lit: PASTEL.dress, shade: PASTEL.dressShade, hi: PASTEL.dressHi },
    brown: { lit: '#c6bba8', shade: '#a89e8c', hi: '#d0c6b5' },
    green: { lit: '#bdc09b', shade: '#a0a37f', hi: '#cccfaa' },
    dark:  { lit: '#bdb9a9', shade: '#a5a192', hi: '#c8c4b5' },
    flat:  { lit: PASTEL.band, shade: PASTEL.bandShade, hi: PASTEL.bandHi },
  };
  /** Which tone the next block takes. Sand and brown come singly or in pairs; the mossy greens are
   *  rare, twice as common on the two lowest courses, where the wall is damp, and under a crest,
   *  where it drips. `run` carries a pair over. */
  function pickTone(R: Rand, course: number, run: Run, underCrest: boolean): string {
    if (run.left > 0) { run.left--; return run.tone; }
    const t = R(), low = course >= COURSES - 2, pg = (low ? 0.09 : 0.04) * (underCrest ? 2.5 : 1);
    let tone = '';
    if (t < 0.07) tone = 'warm';
    else if (t < 0.16) tone = 'brown';
    else if (t < 0.16 + pg) tone = 'green';
    else if (t < 0.26 + pg) tone = 'dark';
    if ((tone === 'warm' || tone === 'brown') && R() < 0.4) { run.tone = tone; run.left = 1; }
    return tone;
  }
  /** One block: a squarish oval with a wobbly edge, two tones, a line, and a hairline bevel; one in
   *  three has a corner pulled in where it was knocked, and `tilt` turns it a degree or two. */
  function stone(g: Ctx, x: number, y: number, w: number, h: number, R: Rand, tone: string, flat?: boolean, tilt?: number): Pt[] {
    const cx = x + w / 2, cy = y + h / 2;
    const pts = blob(cx, cy, w / 2, h / 2, 14, R, flat ? 0.26 : 0.28, flat ? 0.16 : 0.28, flat ? 0.025 : 0.05);
    if (!flat && R() < 0.3) { const k = Math.floor(R() * pts.length); pts[k] = [pts[k][0] * 0.85 + cx * 0.15, pts[k][1] * 0.85 + cy * 0.15]; }
    if (tilt) { const c = Math.cos(tilt), s = Math.sin(tilt); for (const p of pts) { const px = p[0] - cx, py = p[1] - cy; p[0] = cx + px * c - py * s; p[1] = cy + px * s + py * c; } }
    const T = TONES[flat ? 'flat' : tone] || TONES[''];
    solid(g, pts, T.lit, T.shade, PASTEL.line, 2.4, -w * 0.1, -h * 0.14);
    // the bevel: the block's own outline, shifted a little down and right and clipped to the block,
    // shows as a light band along the top and the upper left, where the light lands
    g.save(); shape(g, pts); g.clip();
    g.beginPath(); g.rect(x - 4, y - 4, w + 8, h * 0.6); g.clip();
    g.globalAlpha = 0.45;
    g.translate(1.5, 2); shape(g, pts); g.strokeStyle = T.hi; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
    g.restore();
    return pts;
  }
  /* ---- what time does to a wall ------------------------------------------------ */
  /** A corner knocked off: the mortar shows through a bite at one corner, the stone's line round it. */
  function chipCorner(g: Ctx, s: Block, R: Rand): void {
    const cx = s.x + (R() < 0.5 ? 0 : s.w), cy = s.y + (R() < 0.5 ? 0 : s.h), r = Math.min(s.w, s.h) * (0.16 + 0.12 * R());
    const pts = blob(cx, cy, r, r * 0.8, 8, R, 0.85, 0.3, 0.2);
    g.save(); shape(g, s.pts); g.clip();
    shape(g, pts); g.fillStyle = PASTEL.joint; g.fill(); g.strokeStyle = PASTEL.line; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    g.restore();
  }
  /** A crack: two to three pixels wide with a kink, from one edge part way across the stone, and one
   *  in five right across it; a pale lip along its lower side where the broken edge catches the light. */
  function crack(g: Ctx, s: Block, R: Rand): void {
    const fromLeft = R() < 0.5, through = R() < 0.22, x0 = fromLeft ? s.x + 2 : s.x + s.w - 2, y0 = s.y + s.h * (0.25 + 0.5 * R()), dir = fromLeft ? 1 : -1;
    const len = s.w * (through ? 1 : 0.3 + 0.35 * R()), n = through ? 4 : 3, pts: Pt[] = [[x0, y0]];
    // it wanders, but never doubles back: each step drifts a little from the last, the same way more often than not
    let dy = (R() - 0.5) * s.h * 0.2;
    for (let i = 1; i <= n; i++) { dy = dy * 0.4 + (R() - 0.5) * s.h * (through ? 0.16 : 0.24); pts.push([x0 + dir * len * i / n, pts[i - 1][1] + dy]); }
    g.save(); shape(g, s.pts); g.clip();
    g.strokeStyle = hexA('#ffffff', 0.3); g.lineWidth = 1.2; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1] + 2); for (let i = 1; i <= n; i++) g.lineTo(pts[i][0], pts[i][1] + 2); g.stroke();
    g.strokeStyle = PASTEL.line;
    for (let i = 0; i < n; i++) { g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i + 1][0], pts[i + 1][1]); g.lineWidth = through ? 2.4 : 2.8 - i * 0.6; g.stroke(); }
    g.restore();
  }
  /** A flake of the face gone along one edge: a jagged region a shade darker, lined. */
  function spall(g: Ctx, s: Block, R: Rand): void {
    const top = R() < 0.5, x = s.x + s.w * (0.2 + 0.6 * R()), y = top ? s.y : s.y + s.h, rw = s.w * (0.15 + 0.2 * R()), rh = s.h * (0.2 + 0.2 * R());
    const pts = blob(x, y, rw, rh, 9, R, 0.7, 0.45, 0.35);
    g.save(); shape(g, s.pts); g.clip();
    shape(g, pts); g.fillStyle = hexA(PASTEL.line, 0.28); g.fill(); g.strokeStyle = PASTEL.line; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
    g.restore();
  }
  /** Abrasion: a patch of the face worn rough, paler and scratched. */
  function abrade(g: Ctx, s: Block, R: Rand): void {
    const x = s.x + s.w * (0.25 + 0.5 * R()), y = s.y + s.h * (0.3 + 0.4 * R()), rw = s.w * (0.18 + 0.2 * R()), rh = s.h * (0.2 + 0.25 * R());
    const pts = blob(x, y, rw, rh, 12, R, 0.85, 0.5, 0.4);
    g.save(); shape(g, s.pts); g.clip();
    shape(g, pts); g.fillStyle = hexA('#ffffff', 0.22); g.fill();
    g.strokeStyle = hexA(PASTEL.line, 0.4); g.lineWidth = 1; g.lineCap = 'round';
    for (let k = 0; k < 2 + Math.floor(R() * 3); k++) { const sx = x + (R() - 0.5) * rw * 1.6, sy = y + (R() - 0.5) * rh * 1.4, a = (R() - 0.5) * 0.6, l = 4 + 8 * R(); g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); g.stroke(); }
    g.restore();
  }
  /** Mortar squeezed out of a joint and left there: a lump of the joint tone over the stone's edge. */
  function slop(g: Ctx, s: Block, R: Rand): void {
    const top = R() < 0.5, x = s.x + s.w * (0.15 + 0.7 * R()), y = top ? s.y + 1 : s.y + s.h - 1, rw = 5 + 7 * R(), rh = 3 + 3 * R();
    const pts = blob(x, y, rw, rh, 8, R, 0.9, 0.3, 0.2);
    shape(g, pts); g.fillStyle = PASTEL.joint; g.fill(); g.strokeStyle = hexA(PASTEL.line, 0.6); g.lineWidth = 1.2; g.lineJoin = 'round'; g.stroke();
  }
  /** A stone sunk a little deeper than its neighbours: darker, with shade along its upper and left edges. */
  function recessed(g: Ctx, s: Block, R: Rand): void {
    g.save(); shape(g, s.pts); g.clip();
    g.fillStyle = hexA(PASTEL.line, 0.16); g.fillRect(s.x - 2, s.y - 2, s.w + 4, s.h + 4);
    g.fillStyle = hexA(PASTEL.line, 0.28); g.fillRect(s.x - 2, s.y - 2, s.w + 4, s.h * 0.22); g.fillRect(s.x - 2, s.y - 2, s.w * 0.12, s.h + 4);
    g.restore();
  }
  /** A stone gone: its pocket in the darker mortar, a shadow under its upper edge, and rubble left in it. */
  function missing(g: Ctx, s: Block, R: Rand): void {
    g.save(); shape(g, s.pts); g.clip();
    g.fillStyle = '#9b9789'; g.fillRect(s.x - 2, s.y - 2, s.w + 4, s.h + 4);
    g.fillStyle = hexA(PASTEL.line, 0.28); g.fillRect(s.x - 2, s.y - 2, s.w + 4, s.h * 0.3);
    for (let k = 0; k < 2 + Math.floor(R() * 2); k++) {
      const rw = s.w * (0.18 + 0.15 * R()), rh = s.h * (0.16 + 0.12 * R()), rx = s.x + s.w * (0.15 + 0.6 * R()), ry = s.y + s.h - rh * (0.4 + 0.3 * R());
      solid(g, blob(rx, ry, rw / 2, rh / 2, 8, R, 0.6, 0.3, 0.1), PASTEL.stoneShade, PASTEL.stoneDark, PASTEL.line, 1.8, -rw * 0.1, -rh * 0.15);
    }
    g.restore();
    shape(g, s.pts); g.strokeStyle = PASTEL.line; g.lineWidth = 2.4; g.lineJoin = 'round'; g.stroke();
  }
  /** A pit or two in the face of a stone. */
  function pits(g: Ctx, s: Block, R: Rand): void {
    for (let k = 0; k < 1 + Math.floor(R() * 2); k++) {
      const x = s.x + s.w * (0.15 + 0.7 * R()), y = s.y + s.h * (0.2 + 0.6 * R()), r = 2 + 1.5 * R();
      g.beginPath(); g.ellipse(x, y, r, r * 0.75, 0, 0, 7); g.fillStyle = hexA(PASTEL.line, 0.55); g.fill();
      g.beginPath(); g.ellipse(x + 0.5, y + 1.2, r, r * 0.6, 0, 0, Math.PI); g.strokeStyle = hexA('#ffffff', 0.35); g.lineWidth = 1; g.stroke();
    }
  }
  /** A water stain running down from the joint above a stone, over it and onto the one below. */
  function stain(g: Ctx, s: Block, R: Rand): void {
    const w = 6 + 10 * R(), x = s.x + s.w * (0.2 + 0.6 * R()), y0 = s.y - MORTAR, len = s.h * (0.7 + 0.7 * R());
    g.save(); g.beginPath(); g.rect(EDGE, 0, TW - 2 * EDGE, TH - 3); g.clip();
    for (const [ww, a] of [[w, 0.07], [w * 0.5, 0.06]]) {
      g.beginPath(); g.moveTo(x - ww / 2, y0); g.lineTo(x + ww / 2, y0); g.lineTo(x + ww * 0.3, y0 + len); g.lineTo(x - ww * 0.3, y0 + len); g.closePath();
      g.fillStyle = hexA('#5f5644', a); g.fill();
    }
    g.restore();
  }
  /** Wear, on the private stones only, so the seams and the storey line keep their contract. Cobble is
   *  a novice's masonry, and it shows: a chipped corner on one block in five, a crack on one in six, a
   *  flaked edge on one in fourteen, a block sunk deeper on one in twenty and gone on one in fifty;
   *  and over those, an abraded patch on one in five, pits on one in four, mortar squeezed out of one
   *  joint in seven, a water stain under one in seven. */
  function weather(g: Ctx, own: Block[], R: Rand): void {
    for (const s of own) {
      const t = R();
      if (t < 0.18) chipCorner(g, s, R);
      else if (t < 0.34) crack(g, s, R);
      else if (t < 0.41) spall(g, s, R);
      else if (t < 0.46) recessed(g, s, R);
      else if (t < 0.48) missing(g, s, R);
      if (R() < 0.22) abrade(g, s, R);
      if (R() < 0.25) pits(g, s, R);
      if (R() < 0.15) slop(g, s, R);
      if (R() < 0.14 && s.course < COURSES - 1) stain(g, s, R);
    }
  }
  /** Four flat slabs across a row, set half a slab over so the seam falls in the middle of one; that
   *  slab is drawn twice, half either side, from its own seed, so it is the same in every variant. */
  function slabs(g: Ctx, y: number, h: number, R: Rand): void {
    const n = 4, w = TW / n;
    for (let k = 0; k < n - 1; k++) stone(g, k * w + w / 2 + MORTAR, y + MORTAR / 2, w - 2 * MORTAR, h - MORTAR, R, '', true);
    for (const x of [TW - w / 2, -w / 2]) stone(g, x + MORTAR, y + MORTAR / 2, w - 2 * MORTAR, h - MORTAR, rand(98), '', true);
  }
  /** The band and the courses, the same contract in every variant, then `extras` marks each on a stone
   *  of its own. Returns the stones that are this variant's to mark, with the course each is on. */
  function paintCourses(g: Ctx, R: Rand, crests: Pt[]): Block[] {
    g.fillStyle = PASTEL.joint; g.fillRect(0, 0, TW, TH);
    slabs(g, 0, BAND, R);
    const own: Block[] = [];   // not the seam stones, not near the seam
    for (let i = 0; i < COURSES; i++) {
      const y = BAND + i * CH + MORTAR / 2, h = CH - MORTAR;
      let lo: number, hi: number;
      const st = STRADDLE[i];
      if (st) {
        // the seam stone: same shape, same tone, same place, in every variant
        const w = st[1] - st[0] - MORTAR;
        stone(g, TW + st[0] + MORTAR / 2, y, w, h, rand(777 + i), STRADDLE_TONE[i]);
        stone(g, st[0] + MORTAR / 2, y, w, h, rand(777 + i), STRADDLE_TONE[i]);
        lo = st[1]; hi = TW + st[0];               // so the joints either side of it are as wide as any other
      } else { lo = 0; hi = TW; }                  // and the seam falls in the middle of a joint of the usual width
      const L = hi - lo, n = Math.max(2, Math.round(L / (CH * 1.5)) + (R() < 0.35 ? 1 : 0));
      const ws: number[] = []; let sum = 0;
      for (let k = 0; k < n; k++) { const w = 0.5 + 1.2 * R(); ws.push(w); sum += w; }
      let x = lo; const run = { tone: '', left: 0 };
      // a novice's courses wander: each has a slow wave of its own, dying out at the section's edges
      const kw = 1 + Math.floor(R() * 2), aw = CH * 0.06 * (R() < 0.5 ? -1 : 1);
      for (let k = 0; k < n; k++) {
        // no two blocks sit quite alike: each drifts up or down, is shorter by a little, has a joint of
        // its own width, and one in five on the lower courses reaches up into the joint above; a third
        // tilt a degree or two
        const w = (ws[k] / sum) * L, mid = x + w / 2;
        const priv = x + MORTAR / 2 > EDGE && x + w - MORTAR / 2 < TW - EDGE;
        const wave = priv ? Math.sin(Math.PI * kw * (mid - EDGE) / (TW - 2 * EDGE)) * aw : 0;
        const drift = (R() - 0.5) * CH * 0.14 + wave, shrink = h * 0.14 * R(), jw = MORTAR + (priv ? R() * 3 : 0);
        const reach = i > 0 && R() < 0.2 ? CH * 0.05 : 0;
        const under = (crests || []).some(([a, b]) => mid > a && mid < b);
        const tone = pickTone(R, i, run, under);
        let sy = y + drift + shrink / 2 - reach, sh = h - shrink + reach;
        // the top course keeps under the band and the lowest above the storey line, whatever it does
        if (i === 0) { const top = BAND + MORTAR / 2; if (sy < top) { sh -= top - sy; sy = top; } }
        if (i === COURSES - 1) { const bot = TH - MORTAR / 2; if (sy + sh > bot) sh = bot - sy; }
        const tilt = priv && R() < 0.4 ? (R() - 0.5) * 0.08 : 0;
        if (priv && sh > 30 && R() < 0.08) {
          // a slot a novice had to pack: two thin stones one over the other
          const hh = (sh - MORTAR) / 2;
          for (const [yy, tn] of [[sy, tone], [sy + hh + MORTAR, pickTone(R, i, run, under)]] as Array<[number, string]>) {
            const s: Block = { x: x + jw / 2, y: yy, w: w - jw, h: hh, course: i, pts: [] };
            s.pts = stone(g, s.x, s.y, s.w, s.h, R, tn, false, 0);
            if (s.w > 40) own.push(s);
          }
        } else {
          const s: Block = { x: x + jw / 2, y: sy, w: w - jw, h: sh, course: i, pts: [] };
          s.pts = stone(g, s.x, s.y, s.w, s.h, R, tone, false, tilt);
          if (s.x > EDGE && s.x + s.w < TW - EDGE && s.w > 40) own.push(s);
        }
        x += w;
      }
    }
    weather(g, own, R);
    g.fillStyle = 'rgba(110,100,80,0.16)'; g.fillRect(0, BAND, TW, 9);
    // a handful of dark flecks, the grain of the stone
    g.fillStyle = hexA(PASTEL.line, 0.5);
    for (let k = 0; k < 8; k++) { const s = own[Math.floor(R() * own.length)]; if (!s) break; g.beginPath(); g.arc(s.x + (R() < 0.5 ? 3 : s.w - 3), s.y + (R() < 0.5 ? 3 : s.h - 3), 1 + R(), 0, 7); g.fill(); }
    return own;
  }

  /* ---- growth: blob painting ------------------------------------------------- */
  /* Growth, in the reference's own tones: a yellow-olive body, a deeper green in the shade, cream-lime
   * where the light catches an edge, and a dark olive line with a tight halo round every mass. */
  /* Growth, sampled off the castle reference: its light, mid and shade greens by k-means, the outline a
   * step darker than its darkest, the cream of its highlights. */
  const VEG = { top: '#b3d47f', lit: '#93b868', shade: '#6f9a62', pale: '#e0eab0', line: '#566c47' };
  const MOSS = { fill: '#a8c07a', under: '#86a262', fleck: '#6f8a55' };
  const MARGIN = 77;                                     // no growth over the top nearer a section edge than this
  const keepX = (x: number, r: number): number => clamp(x, EDGE + r + 5, TW - EDGE - r - 5);
  const keepD = (x: number, r: number): number => clamp(x, MARGIN + r, TW - MARGIN - r);
  /** A lobe's size: small, middling or large, so a mass is an aggregate of unequal lobes. */
  const lobeSize = (R: Rand): number => { const t = R(); return t < 0.3 ? 0.55 : t < 0.75 ? 0.9 : 1.4; };

  /** Lobes along a row in the three sizes: far enough apart to notch the edge a third deep, and where
   *  two neighbours fall short of touching, a small lobe bridges them, or the line would show in the gap.
   *  `notch` is the chance an end lobe is left out, biting the edge a lobe deep; and most rows get a
   *  crumb -- a lobe a third the size -- tucked against an end, so the edge is crumbly there. */
  function row(cs: Lobe[], x0: number, x1: number, y: number, r: number, R: Rand, spacing?: number, notch?: number, keep?: (x: number, r: number) => number): void {
    const K = keep || keepX;
    const n = Math.max(1, Math.round((x1 - x0) / (r * (spacing || 1.45)))), made: Lobe[] = [];
    for (let i = 0; i <= n; i++) {
      const rr = r * lobeSize(R);
      made.push([K(x0 + (x1 - x0) * (n ? i / n : 0.5) + (R() - 0.5) * r * 0.3, rr), y + (R() - 0.5) * r * 0.3, rr]);
    }
    if (notch && made.length >= 3 && R() < notch) made.splice(R() < 0.5 ? 0 : made.length - 1, 1);
    const m = made.length;
    for (let i = 0; i + 1 < m; i++) {
      const a = made[i], b = made[i + 1];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > a[2] + b[2] - 3) made.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.min(a[2], b[2]) * 0.8]);
    }
    for (const s of [-1, 1]) {
      const e = s < 0 ? made[0] : made[m - 1];
      if (R() < 0.7) { const rr = e[2] * 0.36; made.push([K(e[0] + s * e[2] * 0.95, rr), e[1] + (R() - 0.5) * e[2] * 0.8, rr]); }
    }
    cs.push(...made);
  }
  /** The union of a mass's lobes, rasterised: any pocket the lobes enclose that is smaller than
   *  `maxArea` gets a lobe over it, because the line drawn beneath the mass would otherwise show
   *  through the pocket as a dark speck. Bigger pockets are left: the wall shows through them. */
  function plugHoles(cs: Lobe[], maxArea: number): void {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y, r] of cs) { x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r); }
    const ox = Math.floor(x0) - 2, oy = Math.floor(y0) - 2, W = Math.ceil(x1) - ox + 3, Hh = Math.ceil(y1) - oy + 3;
    if (W <= 0 || Hh <= 0 || W * Hh > 4e6) return;
    const c = cnv(W, Hh), g = ctxOf(c);
    unionPath(g, cs, -ox, -oy, 0); g.fillStyle = '#000'; g.fill();
    const d = g.getImageData(0, 0, W, Hh).data, mark = new Uint8Array(W * Hh);
    for (let i = 0; i < W * Hh; i++) if (d[i * 4 + 3] > 127) mark[i] = 1;
    const stack: number[] = [];
    const flood = (start: number, tag: number, box?: number[]): void => {
      stack.push(start);
      while (stack.length) {
        const i = stack.pop() as number;
        if (mark[i]) continue;
        mark[i] = tag;
        const x = i % W, y = (i - x) / W;
        if (box) { box[0] = Math.min(box[0], x); box[1] = Math.max(box[1], x); box[2] = Math.min(box[2], y); box[3] = Math.max(box[3], y); box[4]++; }
        if (x > 0) stack.push(i - 1); if (x < W - 1) stack.push(i + 1); if (y > 0) stack.push(i - W); if (y < Hh - 1) stack.push(i + W);
      }
    };
    for (let x = 0; x < W; x++) { flood(x, 2); flood((Hh - 1) * W + x, 2); }
    for (let y = 0; y < Hh; y++) { flood(y * W, 2); flood(y * W + W - 1, 2); }
    for (let i = 0; i < W * Hh; i++) {
      if (mark[i]) continue;
      const box = [W, 0, Hh, 0, 0];
      flood(i, 3, box);
      if (box[4] <= maxArea) cs.push([ox + (box[0] + box[1] + 1) / 2, oy + (box[2] + box[3] + 1) / 2, Math.hypot(box[1] - box[0] + 1, box[3] - box[2] + 1) / 2 + 1.5]);
    }
  }

  /** One mass. An outline -- the halo, then the dark line -- round the union of the lobes, and a
   *  fainter line round every third lobe inside; then the light from above, the way the reference
   *  paints a bush -- the faint lines only in the middle band: the top third of the mass in the pale
   *  lime, with a cream leaf or three or four of
   *  different sizes on it if `o.lobe` is set, never two level side by side; the middle in the lit
   *  green, a third of its lobes carrying a crescent of shade at the lower right; the underside in the
   *  shade green, each lobe with a thin sliver of light at its upper left. Every mass has a light side
   *  and a dark side, and that survives being shrunk to a few pixels. */
  function mass(g: Ctx, cs: Lobe[], R: Rand, o: { r: number; lw?: number; lobe?: number }): void {
    const r = o.r, dx = -r * 0.38, dy = -r * 0.5, lw = o.lw || 3;
    const m0 = cs.length;
    for (let i = 0; i < m0; i++) for (let j = i + 1; j < m0; j++) {
      const a = cs[i], b = cs[j], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d > a[2] + b[2] - 2 && d < a[2] + b[2] + 2 * lw + 2) cs.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.min(a[2], b[2]) * 0.7]);
    }
    plugHoles(cs, 220);
    let y0 = Infinity, y1 = -Infinity;
    for (const [, y, rr] of cs) { y0 = Math.min(y0, y - rr); y1 = Math.max(y1, y + rr); }
    const Hh = Math.max(1, y1 - y0), band = (c: Lobe): number => (c[1] - y0) / Hh;
    unionPath(g, cs, 0, 0, lw + 1.8); g.fillStyle = hexA(VEG.line, 0.4); g.fill();
    unionPath(g, cs, 0, 0, lw); g.fillStyle = VEG.line; g.fill();
    unionPath(g, cs, 0, 0, 0); g.fillStyle = VEG.shade; g.fill();
    g.save(); unionPath(g, cs, 0, 0, 0); g.clip();
    unionPath(g, cs, dx, dy, 0); g.fillStyle = VEG.lit; g.fill();
    const topL = cs.filter((c) => band(c) < 0.3);
    if (topL.length) { unionPath(g, topL, 0, 0, -0.5); g.fillStyle = VEG.top; g.fill(); }
    for (const c of cs) {
      const b = band(c), low = b > 0.62;
      if (b < 0.3 || (!low && R() > 0.35)) continue;
      const k = low ? 1.05 : 0.3;
      g.save(); g.beginPath(); g.arc(c[0], c[1], c[2], 0, 7); g.clip();
      g.fillStyle = VEG.shade; g.fillRect(c[0] - c[2], c[1] - c[2], 2 * c[2], 2 * c[2]);
      g.beginPath(); g.arc(c[0] - c[2] * k, c[1] - c[2] * k * 1.15, c[2], 0, 7); g.fillStyle = VEG.lit; g.fill();
      g.restore();
    }
    // a few leaf edges inside the middle band: an open arc a third of the way round, low and right,
    // on one lobe in three or four, in the shade green -- never a closed ring
    g.strokeStyle = hexA(VEG.shade, 0.8); g.lineWidth = lw * 0.4; g.lineCap = 'round';
    for (let i = 0; i < m0; i += 3 + Math.floor(R() * 2)) { const c = cs[i], b = band(c); if (b < 0.3 || b > 0.62) continue; g.beginPath(); g.arc(c[0], c[1], Math.max(1, c[2] - lw * 0.35), Math.PI * 0.15, Math.PI * 0.8); g.stroke(); }
    if (o.lobe && topL.length) {
      const n = [1, 3, 3, 4][Math.floor(R() * 4)], pale: Lobe[] = [], cands = topL.slice().sort(() => R() - 0.5);
      for (const c of cands) {
        if (pale.length >= n) break;
        if (pale.some((p) => Math.abs(p[1] - c[1]) < r * 0.8 && Math.abs(p[0] - c[0]) < r * 5)) continue;
        pale.push([c[0] + (R() - 0.5) * c[2] * 0.6, c[1] + (R() - 0.5) * c[2] * 0.6, 5.5 + 1.5 * pale.length] as Lobe);
      }
      if (pale.length) { unionPath(g, pale, 0, 0, 0); g.fillStyle = VEG.pale; g.fill(); }
    }
    g.restore();
  }

  /** A drape and its crest, one silhouette, made of lobes the size of leaf clusters: a crest spilling
   *  over the cap, wider than it is tall, one shoulder a third wider than the other and dropping most
   *  of a course lower down the face; and under it, where `m.fall` asks for one, a curtain rooted at
   *  seven tenths of the crest's width, tapering to a third of it, that frays over its last third into
   *  two or three tongues side by side of unequal length, each narrowing to a lobe and stopping there.
   *  No neck, no club: the curtain is never more than three times as long as it is wide. */
  function drapeLayout(m: Drape, R: Rand): { cs: Lobe[]; r: number } {
    const cs: Lobe[] = [], W = m.w, half = W / 2, r0 = 11 + W * 0.012;
    const cx = clamp(m.cx, MARGIN + half, TW - MARGIN - half);
    const peak = (R() - 0.5) * 0.7, rise = 14 + W * 0.07, depth = 6 + W * 0.09, wideSide = R() < 0.5 ? -1 : 1;
    for (let y = -rise; y <= depth; y += r0) {
      const t = (y + rise) / (depth + rise);
      const wide = t < 0.4 ? 0.55 + 0.45 * Math.pow(t / 0.4, 0.6) : 1;
      const c = cx + peak * half * 0.5 * Math.max(0, 1 - t / 0.4);
      const w = half * wide * (0.94 + 0.12 * R()), spill = t > 0.25 ? w * 0.3 : 0;
      row(cs, c - w - (wideSide < 0 ? spill : 0), c + w + (wideSide > 0 ? spill : 0), y, r0 * (0.9 + 0.2 * R()), R, 1.3, t > 0.5 ? 0.25 : 0, keepD);
    }
    const drop = CH * (0.5 + 0.3 * R());
    for (let y = depth + r0; y < depth + drop; y += r0 * 1.1) {
      const t2 = (y - depth) / drop, xa = cx + wideSide * half * (0.25 + 0.3 * t2), xb = cx + wideSide * half * (1.2 - 0.55 * t2);
      row(cs, Math.min(xa, xb), Math.max(xa, xb), y, r0 * (0.95 - 0.25 * t2), R, 1.3, 0.3, keepD);
    }
    if (m.fall) {
      const top = depth + r0 * 0.8, L = TH * m.fall, span = Math.max(r0 * 2, L - top), lean = (R() - 0.5) * 0.2;
      const hwAt = (t: number): number => half * (0.72 - 0.4 * t), split = top + span * 0.62;
      for (let y = top; y < split; y += r0 * 1.15) {
        const t = (y - top) / span, hw = hwAt(t) * (0.94 + 0.12 * R()), c = cx + lean * (y - top);
        row(cs, c - hw, c + hw, y, r0 * (0.95 - 0.2 * t), R, 1.3, t > 0.2 ? 0.3 : 0, keepD);
      }
      const n = m.tongues || 2, lens = [1, 0.78, 0.6].sort(() => R() - 0.5).slice(0, n), hwS = hwAt((split - top) / span);
      for (let k = 0; k < n; k++) {
        const Lk = split + (L - split) * lens[k], u = (k - (n - 1) / 2) * (2 * hwS / n), hwT = hwS / n;
        let j = 0;
        for (let y = split; y < Lk; y += r0 * 1.15, j++) {
          const t = (y - split) / Math.max(1, Lk - split), hw = Math.max(r0 * 0.3, hwT * (1 - 0.6 * t)), c = cx + u + lean * (y - top) + (R() - 0.5) * r0 * 0.3;
          row(cs, c - hw, c + hw, y, r0 * (0.85 - 0.3 * t), R, 1.25, j > 0 ? 0.35 : 0, keepD);
        }
      }
    }
    return { cs, r: r0 };
  }
  /** A hedge at the foot: a long low mass of lobes painted on the wall itself, widest at the ground and
   *  narrowing to its top, its top notched, its rows close enough to leave no holes; its lowest rows
   *  lie below the ground line, so the canvas cuts it flat two pixels above it and the cut reads as the
   *  shadow it stands in. The mass's own tone rule darkens its underside along the scalloped foot. On
   *  half of them a few cream leaves, and a few blossoms over the upper half. */
  function hedge(g: Ctx, b: Hedge, R: Rand): void {
    const cs: Lobe[] = [], half = b.w / 2, r = 6 + b.h * 0.08;
    for (let y = TH - b.h + r; y <= TH + r; y += r * 1.25) {
      const t = (TH - y) / b.h;
      const w = half * (t > 0.2 ? 1 - 0.4 * Math.pow((t - 0.2) / 0.8, 1.4) : 1) * (0.94 + 0.12 * R());
      row(cs, b.cx - w, b.cx + w, y, r * (0.9 + 0.2 * R()), R, 1.3, t > 0.4 ? 0.3 : 0);
    }
    g.save(); g.beginPath(); g.rect(0, 0, TW, TH - 2); g.clip();
    shadowOf(g, cs, 6, 4);
    mass(g, cs, R, { r, lobe: R() < 0.5 ? 1 : 0 });
    // three to five blossoms on the crown, white and pink as the reference has them: four petals round
    // a sand centre, under a thin dark line so they hold against the pale lime, big enough to survive 1x
    const crown = cs.filter((c) => c[1] < TH - b.h * 0.55);
    for (let i = 0; i < (b.flowers || 0) && crown.length; i++) {
      const c = crown[Math.floor(R() * crown.length)], x = c[0] + (R() - 0.5) * c[2], y = c[1] + (R() - 0.5) * c[2], fr = 9 + 3 * R();
      const petals: Lobe[] = [[x, y - fr * 0.5, fr * 0.5], [x - fr * 0.5, y, fr * 0.5], [x + fr * 0.5, y, fr * 0.5], [x, y + fr * 0.5, fr * 0.5]];
      unionPath(g, petals, 0, 0, 1.3); g.fillStyle = VEG.line; g.fill();
      unionPath(g, petals, 0, 0, 0); g.fillStyle = R() < 0.6 ? '#f7f3e6' : PASTEL.blush; g.fill();
      g.beginPath(); g.arc(x, y, fr * 0.22, 0, 7); g.fillStyle = PASTEL.sand; g.fill();
    }
    g.restore();
  }
  /** Moss on a joint: a short lens, half a brick long, thick in the middle and thin at the ends, two
   *  or three shallow bumps along its top and flat along the joint, in a grey olive between the stone
   *  and the growth, with the darker olive showing only as a hairline along the underside. `y` is the
   *  joint; the lens hangs above it. */
  function mossLens(g: Ctx, s: Block, y: number, R: Rand): void {
    const len = Math.min(TW - 2 * EDGE - 10, s.w * (0.4 + 0.5 * R())), h = CH * (0.1 + 0.06 * R());
    const x0 = clamp(s.x + (s.w - len) * R(), EDGE + 5, TW - EDGE - len - 5), cx = x0 + len / 2;
    const body = blob(cx, y - h * 0.45, len / 2, h * 0.55, 14, R, 0.8, 0.25, 0.15), bumps: Lobe[] = [];
    for (let k = 0; k < 2 + (R() < 0.5 ? 1 : 0); k++) bumps.push([x0 + len * (0.2 + 0.6 * R()), y - h * 0.7, h * (0.35 + 0.2 * R())]);
    g.save(); g.beginPath(); g.rect(x0 - 12, y - CH, len + 24, CH); g.clip();
    const paint = (tone: string, oy: number): void => {
      g.fillStyle = tone;
      g.save(); g.translate(0, oy); shape(g, body); g.fill(); unionPath(g, bumps, 0, 0, 0); g.fill(); g.restore();
    };
    paint(MOSS.under, 1.5);
    paint(MOSS.fill, 0);
    g.restore();
  }
  /** A fleck of dark moss in the corner of a joint. */
  function mossFleck(g: Ctx, s: Block, R: Rand): void {
    const onTop = R() < 0.6, x = s.x + s.w * (0.05 + 0.9 * R()), y = onTop ? s.y + 2.5 : s.y + s.h - 2.5;
    g.beginPath(); g.arc(x, y, 1.5 + R(), 0, 7); g.fillStyle = hexA(MOSS.fleck, 0.8); g.fill();
  }
  /** A faint dab of moss on a brick's face. */
  function mossDab(g: Ctx, s: Block, R: Rand): void {
    const x = s.x + s.w * (0.15 + 0.7 * R()), y = s.y + s.h * (0.3 + 0.5 * R()), rr = 1.5 + 1.5 * R();
    g.beginPath(); g.arc(x, y, rr, 0, 7); g.fillStyle = hexA(MOSS.fill, 0.55); g.fill();
  }
  /** The foot of the ground storey: a band of shade along the ground line; one to three lenses of moss
   *  on as many different courses of the lowest three, one of them now and then rising from the ground
   *  line itself; three to six flecks in the corners of joints low down; a dab or two on the bricks. */
  function footMoss(g: Ctx, stones: Block[], count: number, R: Rand): void {
    g.fillStyle = 'rgba(110,100,80,0.16)'; g.fillRect(0, TH - 10, TW, 10);
    const courses = [COURSES - 1, COURSES - 2, COURSES - 3].sort(() => R() - 0.5).slice(0, Math.min(count, 1 + Math.floor(R() * 3)));
    for (const c of courses) {
      const pool = stones.filter((s) => s.course === c);
      if (!pool.length) continue;
      const s = pool[Math.floor(R() * pool.length)];
      mossLens(g, s, c === COURSES - 1 && R() < 0.34 ? TH + 1 : s.y - MORTAR / 2, R);
    }
    const low = stones.filter((s) => s.course >= COURSES - 2);
    for (let i = 0; i < 3 + Math.floor(R() * 4) && low.length; i++) mossFleck(g, low[Math.floor(R() * low.length)], R);
    for (let i = 0; i < 1 + Math.floor(R() * 2) && low.length; i++) mossDab(g, low[Math.floor(R() * low.length)], R);
  }

  /* ---- the five: the same register, placed differently ------------------------ */
  const VARIANTS: Variant[] = [
    { name: 'Cobblestone 1', tells: 'moss on two low joints; a big crest left of centre with a long curtain in two tongues; a flowering hedge to the right at the foot', seed: 11,
      extras: { moss: 2 },
      drapes: [{ cx: 180, w: 210, fall: 0.85, tongues: 2, seed: 101 }],
      foot: { hedges: [{ cx: 385, w: 150, h: 72, flowers: 4, seed: 111 }] } },
    { name: 'Cobblestone 2', tells: 'moss on three low joints; a small crest at the left with no curtain and a middling one to the right with a short curtain in three tongues; the widest hedge to the left at the foot', seed: 23,
      extras: { moss: 3 },
      drapes: [{ cx: 110, w: 90, fall: 0, seed: 202 }, { cx: 330, w: 150, fall: 0.5, tongues: 3, seed: 201 }],
      foot: { hedges: [{ cx: 125, w: 220, h: 96, flowers: 4, seed: 211 }] } },
    { name: 'Cobblestone 3', tells: 'moss on two low joints; nothing over the top; the tallest hedge at the foot', seed: 37,
      extras: { moss: 2 },
      drapes: [],
      foot: { hedges: [{ cx: 250, w: 300, h: 112, flowers: 5, seed: 311 }] } },
    { name: 'Cobblestone 4', tells: 'moss on three low joints; one middling crest to the right with a curtain in three tongues; nothing at the foot: the bare one', seed: 53,
      extras: { moss: 3 },
      drapes: [{ cx: 355, w: 170, fall: 0.7, tongues: 3, seed: 401 }],
      foot: { hedges: [] } },
    { name: 'Cobblestone 5', tells: 'moss on two low joints; the biggest crest to the left with a short curtain, and a small crest at the right with none; a hedge one block wide between them at the foot', seed: 71,
      extras: { moss: 2 },
      drapes: [{ cx: 165, w: 230, fall: 0.35, tongues: 2, seed: 501 }, { cx: 400, w: 90, fall: 0, seed: 502 }],
      foot: { hedges: [{ cx: 320, w: 110, h: 64, flowers: 3, seed: 512 }] } },
  ];

  /* ---- the archway ------------------------------------------------------- */
  /*
   * A rough cobbled archway whose shape is not rough at all.
   *
   * That is the whole of the idea. A novice can lay a true arch without being
   * able to cut a stone: he strikes the curve off a centre, props a former
   * under it, and jams whatever he has against it until it stands. The line of
   * the opening is therefore exact and everything touching it is not -- wedges
   * of no two depths, joints that are not quite radial, and a ragged pocket of
   * mortar where the field stones were broken away to make room.
   *
   * It is drawn in that order and cut last. Every stone of the ring is laid
   * generously, overhanging into the opening, and then the hole is taken out
   * of the lot of them in one pass -- so the intrados is a circle struck by a
   * compass, and the stone either side of it was shaped by somebody with a
   * hammer and no great hurry.
   */
  const A_CX = TW * (ARCH.t0 + ARCH.t1) / 2;
  /*
   * The half span, and the rise, which are the same number.
   *
   * A section is four metres across and three high at 128 px to the metre both
   * ways, so a circle in the world is a circle in the picture and one radius
   * does for both. The renderer works the rise out from the same two spans and
   * arrives at the same place, which is what lets its clip and this hole agree.
   */
  const A_R = TW * (ARCH.t1 - ARCH.t0) / 2;
  const A_CY = TH * (1 - ARCH.spring);

  /** The opening: two jambs and a true semicircular head. */
  function openingPath(g: Ctx): void {
    g.beginPath();
    g.moveTo(A_CX - A_R, TH);
    g.lineTo(A_CX - A_R, A_CY);
    g.arc(A_CX, A_CY, A_R, Math.PI, Math.PI * 2);
    g.lineTo(A_CX + A_R, TH);
    g.closePath();
  }

  /** A polygon with more corners than it needs, each shoved about: a stone cut by eye. */
  function roughen(poly: Pt[], R: Rand, per: number, jitter: number): Pt[] {
    const out: Pt[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      for (let k = 0; k < per; k++) {
        const u = k / per;
        out.push([a[0] + (b[0] - a[0]) * u + (R() - 0.5) * jitter * 2,
                  a[1] + (b[1] - a[1]) * u + (R() - 0.5) * jitter * 2]);
      }
    }
    return out;
  }

  const bbox = (pts: Pt[]): Block => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, course: 0, pts };
  };

  /** One stone of the ring or a jamb: the same two tones, line and bevel every block has. */
  function dressed(g: Ctx, pts: Pt[], tone: string): void {
    const T = TONES[tone] || TONES[''];
    solid(g, pts, T.lit, T.shade, PASTEL.line, 2.4, -3.5, -4.5);
    g.save(); shape(g, pts); g.clip();
    g.globalAlpha = 0.45; g.translate(1.5, 2);
    shape(g, pts); g.strokeStyle = T.hi; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
    g.restore();
  }

  /** What a hammer and the weather have had off one stone of an arch. Never `missing`: a ring is
   *  only standing while every wedge in it is. */
  function wearOne(g: Ctx, pts: Pt[], R: Rand): void {
    const s = bbox(pts);
    const t = R();
    if (t < 0.20) chipCorner(g, s, R);
    else if (t < 0.34) crack(g, s, R);
    else if (t < 0.40) spall(g, s, R);
    if (R() < 0.28) abrade(g, s, R);
    if (R() < 0.24) pits(g, s, R);
    if (R() < 0.18) slop(g, s, R);
  }

  /**
   * The reveal: a column of stone up each side of the opening, from the
   * springing down to the ground.
   *
   * These are the stones a novice takes trouble over, because they are the
   * ones a cart scrapes and a hand rests on, so they run squarer and a shade
   * warmer than the field they sit in. Their inner edge overhangs into the
   * opening and is taken off by the cut, which is what leaves the jamb dead
   * straight while every other edge of every one of them wanders.
   */
  function jamb(g: Ctx, R: Rand, side: number): void {
    const line = A_CX + side * A_R;
    let y = A_CY + IMPOST_H, course = side < 0 ? 0 : 1;
    while (y < TH + 20) {
      const h = 36 + R() * 22;
      // Long and short about, so the outer end of the stack is toothed into
      // the field. Even widths give a dead straight joint the length of the
      // reveal, which reads as the seam between two wall tiles.
      const w = (course++ % 2 ? 46 : 74) + R() * 16;
      const x = side < 0 ? line + OVER - w : line - OVER;
      const pts = stone(g, x, y, w, h, R, pickDressed(R), false, (R() - 0.5) * 0.035);
      wearOne(g, pts, R);
      y += h + MORTAR + R() * 3;
    }
  }

  /** How far every stone of the opening is laid into it, to be cut off again. */
  const OVER = 10;
  /** How deep the impost is, which is also where the jamb starts. */
  const IMPOST_H = 20;

  /**
   * The impost: the one flat stone at the springing that the ring comes down
   * on and the jamb carries.
   *
   * Without it the lowest wedge sits straight on whatever course of the jamb
   * happened to end there, and the ring and the reveal run into each other in
   * a muddle. It is the one piece of an arch that even a bad mason gets
   * right, because it is the piece that tells him where to start the curve.
   * It reaches a little further out than the ring does, the way a ledge does.
   */
  function impost(g: Ctx, R: Rand, side: number): void {
    const line = A_CX + side * A_R;
    // Past where the deepest wedge can reach, so it is a ledge and not the
    // last course of the jamb: this is the stone that says where the curve
    // begins, and a mason who can lay nothing else lays this one square.
    const deep = A_R * 0.48;
    const x = side < 0 ? line - deep : line - OVER;
    const pts = stone(g, x, A_CY - 3, deep + OVER, IMPOST_H + 3, R, 'dress', false, (R() - 0.5) * 0.015);
    wearOne(g, pts, R);
  }

  /**
   * The stone of the opening, jamb, impost and ring alike.
   *
   * All of it is stone that was picked over rather than picked up, so it runs
   * warmer than the field it is set in and the eye reads the whole doorway as
   * one piece of work instead of as a hole with a fringe.
   */
  const pickDressed = (R: Rand): string => { const t = R(); return t < 0.18 ? 'green' : t < 0.28 ? 'dark' : 'dress'; };

  /** The ring: wedges of no two depths, on joints that are not quite radial. */
  function voussoirs(g: Ctx, R: Rand): void {
    // Odd, so one stone caps the crown rather than a joint splitting it.
    const n = 9 + 2 * Math.floor(R() * 2);
    const cut: number[] = [];
    /*
     * A joint wanders by up to a quarter of a wedge either way, and no
     * further. Loose enough that no two wedges are the same width; tight
     * enough that none of them comes out a splinter, and that two joints
     * never cross -- a ring with a crossed joint is not a rough ring, it is a
     * ring that has fallen down.
     */
    for (let i = 0; i <= n; i++) cut.push(i / n + (i > 0 && i < n ? (R() - 0.5) * 0.36 / n : 0));
    const crown = (n - 1) / 2;
    /*
     * And the crown stone is the big one.
     *
     * It was the last wedge in, jammed against a ring that was already
     * standing, so it is the one he chose a lump for: half again the width of
     * its neighbours and reaching a good deal further out. It is also the
     * stone the eye goes to on an arch, and when the widest stone in the ring
     * was over at two o'clock the ring had no top.
     */
    cut[crown] -= 0.35 / n;
    cut[crown + 1] += 0.35 / n;
    /*
     * How far past the curve each joint reaches, and how far off true it
     * leans. The depth is held under half the radius because the crown of the
     * ring has to stay below the band: the extrados there is the springing
     * less the radius and its depth, and the band starts an eighth of the way
     * down the section.
     */
    const out = cut.map(() => 0.25 + R() * 0.11);
    const lean = cut.map(() => (R() - 0.5) * 0.10);
    /** A point on the ring: `c` along the half circle, `r` out from the curve. */
    const pt = (c: number, ln: number, r: number): Pt => {
      const a = Math.PI * (1 + c) + ln * r;
      return [A_CX + Math.cos(a) * A_R * (1 + r), A_CY + Math.sin(a) * A_R * (1 + r)];
    };
    const at = (j: number, r: number): Pt => pt(cut[j], lean[j], r);
    /*
     * The joint between one wedge and the next: shut at the face and open at
     * the back, which is what a joint cut by eye does. Taking it off the outer
     * corners only leaves the intrados solid stone the whole way round -- a
     * gap there shows as mortar on the line the compass struck, and a ring of
     * crescents round the opening is worse than no ring.
     */
    const GAP = 0.005;
    /*
     * First the pocket: the mortar behind the ring.
     *
     * The field was laid before anybody thought about a doorway, and the way
     * through was made by breaking stone out of it. What is left round the
     * ring is a ragged line of mortar and chips, a few pixels of it here and
     * a finger's width there, and it is the one thing that tells the eye at a
     * distance that there is a ring at all: without it the wedges are pale
     * stone butting pale stone, and at a hundred yards the arch is a hole.
     *
     * It is drawn out to a little past where the deepest wedge will reach and
     * in past the curve, so the wedges bury all of it but the ragged edge and
     * the cut takes the rest.
     */
    const lip = (j: number): number => out[j] + (j === crown || j === crown + 1 ? 0.09 : 0);
    const foot = A_CY - 1;
    const hem: Pt[] = [[A_CX - A_R * (1 + lip(0)), foot]];
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < 3; k++) {
        const u = k / 3;
        const a = Math.PI * (1 + cut[j] + (cut[j + 1] - cut[j]) * u);
        // Flush with the wedges two thirds of the way round and a bite of
        // mortar the rest, so what shows is a broken line and not a rim.
        const r = lip(j) + (lip(j + 1) - lip(j)) * u + (R() < 0.38 ? 0.02 + R() * 0.05 : -0.004);
        hem.push([A_CX + Math.cos(a) * A_R * (1 + r), A_CY + Math.sin(a) * A_R * (1 + r)]);
      }
    }
    hem.push([A_CX + A_R * (1 + lip(n)), foot]);
    hem.push([A_CX + A_R * 0.93, foot]);
    for (let j = n; j >= 0; j--) hem.push(at(j, -0.06));
    hem.push([A_CX - A_R * 0.93, foot]);
    g.beginPath();
    g.moveTo(hem[0][0], hem[0][1]);
    for (const q of hem) g.lineTo(q[0], q[1]);
    g.closePath();
    g.fillStyle = PASTEL.ringJoint; g.fill();
    for (let i = 0; i < n; i++) {
      const deep = (j: number): number => out[j] + (i === crown ? 0.09 : 0);
      // The inner pair sit well inside the opening, so the cut is what shapes
      // them; the outer pair come in by the joint.
      const wedge: Pt[] = [
        at(i, -0.12), at(i + 1, -0.12),
        pt(cut[i + 1] - GAP, lean[i + 1], deep(i + 1)), pt(cut[i] + GAP, lean[i], deep(i)),
      ];
      const pts = roughen(wedge, R, 3, 2.2);
      dressed(g, pts, i === crown ? 'dress' : pickDressed(R));
      // Not the crown: two or three pits at the top of an arch are two eyes
      // and a nose, and the top of an arch is where the eye lands.
      if (i !== crown) wearOne(g, pts, R);
      else if (R() < 0.5) crack(g, bbox(pts), R);
    }
    /*
     * And the chips: what was jammed into the gaps when the broken field
     * would not meet the ring. They are the evidence that the wall was opened
     * rather than built with a hole in it, and they cost nothing.
     */
    for (let j = 0; j <= n; j++) {
      // Not at the crown: anything standing over the keystone is a chimney.
      if (R() > 0.45 || j === crown || j === crown + 1) continue;
      const w = 7 + R() * 5, h = w * (0.6 + 0.3 * R());
      const [cx, cy] = at(j, lip(j) + 0.012 + R() * 0.025);
      wearOne(g, stone(g, cx - w / 2, cy - h / 2, w, h, R, R() < 0.35 ? 'dark' : 'dress', false, (R() - 0.5) * 0.6), R);
    }
  }

  /* ---- the window --------------------------------------------------------- */
  /*
   * A hole with something over it.
   *
   * An archway carries itself: the ring is the thing that stands up. A window
   * does not, and a novice's answer to that is always the same one -- a lintel
   * big enough to bridge the gap, and over the lintel a course of small wedges
   * on a flat curve to take the weight of the wall off it. That relieving arch
   * is the whole character of the asset: it is the piece of the wall that
   * exists only because he knew the lintel would crack if he did not put it
   * there, and it is set with the same hammer and the same want of skill as
   * everything else.
   *
   * Drawn in the order it was built and cut last, like the arch: sill, jambs,
   * lintel, relieving arch, then the rectangle taken out of the lot of them.
   * The opening is square to a hair and nothing round it is.
   */
  const W_X0 = TW * WINDOW.t0, W_X1 = TW * WINDOW.t1;
  const W_HEAD = TH * (1 - WINDOW.k1), W_SILL = TH * (1 - WINDOW.k0);
  const Y_X0 = TW * BAY.t0, Y_X1 = TW * BAY.t1;
  const Y_HEAD = TH * (1 - BAY.k1), Y_SILL = TH * (1 - BAY.k0);
  /** How deep the lintel is. */
  const LINTEL = 22;
  /** Where the top of it sits under a given head. */
  const lintelTop = (head: number): number => head - LINTEL + 3;

  /** The mortar the field was broken out for, ragged all round and buried by what goes over it. */
  function winPocket(g: Ctx, R: Rand, x0: number, x1: number, top: number, sill: number): void {
    const box: Pt[] = [[x0 - 24, top], [x1 + 24, top], [x1 + 24, sill + 26], [x0 - 24, sill + 26]];
    shape(g, roughen(box, R, 6, 4.5));
    g.fillStyle = PASTEL.ringJoint;
    g.fill();
  }

  /**
   * A column of stone up one side of the opening, built from the sill and
   * overhanging into it. `wide` is how big a stone he could spare for it: a
   * window gets the long ones, a bay the short ones, because a bay is already
   * most of the section across and a long jamb stone would reach the courses
   * that straddle the seam.
   */
  function winJamb(g: Ctx, R: Rand, side: number, x0: number, x1: number, head: number, sill: number, wide: number): void {
    const line = side < 0 ? x0 : x1;
    let y = sill - 2, course = side < 0 ? 0 : 1;
    while (y > head - 4) {
      const h = 34 + R() * 20;
      const w = (course++ % 2 ? wide * 0.68 : wide) + R() * 14;
      const x = side < 0 ? line + OVER - w : line - OVER;
      wearOne(g, stone(g, x, y - h, w, h, R, pickDressed(R), false, (R() - 0.5) * 0.03), R);
      y -= h + MORTAR + R() * 3;
    }
  }

  /**
   * The relieving arch: a flat curve of small wedges over the lintel.
   *
   * Its rise is a tenth of its span, which is what makes it look like work
   * rather than ornament -- it is there to throw the load out to the jambs,
   * and a mason who wanted it to look like an arch would have given it more.
   */
  function relieving(g: Ctx, R: Rand, x0: number, x1: number, head: number): void {
    const half = (x1 - x0) / 2 + 20, cx = (x0 + x1) / 2;
    const rise = 15 + R() * 7;
    const rad = (half * half + rise * rise) / (2 * rise);
    const cy = lintelTop(head) + rad - rise;
    const a0 = Math.asin(Math.min(1, half / rad));
    // Five or seven, so the stones are lumps rather than tally marks, and odd
    // so one of them caps the middle.
    const n = 5 + 2 * Math.floor(R() * 2);
    const cut: number[] = [];
    for (let i = 0; i <= n; i++) cut.push(-a0 + (2 * a0 * i) / n + (i > 0 && i < n ? (R() - 0.5) * 0.36 * (2 * a0) / n : 0));
    const crown = (n - 1) / 2;
    cut[crown] -= 0.35 * (2 * a0) / n;
    cut[crown + 1] += 0.35 * (2 * a0) / n;
    // In pixels rather than in radii: the flatter the curve the longer the
    // radius, and a depth taken as a fraction of it would put the crown of a
    // shallow one through the band.
    const out = cut.map(() => (17 + R() * 7) / rad);
    const pt = (a: number, r: number): Pt => [cx + Math.sin(a) * rad * (1 + r), cy - Math.cos(a) * rad * (1 + r)];
    // The joint is shut at the face and open at the back, as on the ring.
    const gap = 0.16 * (2 * a0) / n;
    for (let i = 0; i < n; i++) {
      const deep = (j: number): number => out[j] + (i === crown ? 0.02 : 0);
      const wedge: Pt[] = [
        pt(cut[i], -0.03), pt(cut[i + 1], -0.03),
        pt(cut[i + 1] - gap, deep(i + 1)), pt(cut[i] + gap, deep(i)),
      ];
      const pts = roughen(wedge, R, 3, 1.8);
      dressed(g, pts, i === crown ? 'dress' : pickDressed(R));
      if (i !== crown) wearOne(g, pts, R);
    }
  }

  /**
   * Sill, jambs, lintel and the wedges over it, in the order they went up.
   *
   * `shelf` is how far the sill stands proud and how deep it is. A window's
   * is a sill and a bay's is a shelf, because a bay is a box of glass standing
   * on it, and a stone that is only a sill under a bay is a stone that comes
   * out of the wall one winter with the bay on top of it.
   */
  function surround(g: Ctx, R: Rand, x0: number, x1: number, head: number, sill: number, wide: number, shelf: number): void {
    const top = lintelTop(head);
    winPocket(g, R, x0, x1, top - 46, sill);
    // The sill first, because everything either side of the hole stands on it.
    wearOne(g, stone(g, x0 - 16 - shelf, sill - 4, x1 - x0 + 32 + shelf * 2, 24 + shelf, R, 'dress', false, (R() - 0.5) * 0.012), R);
    winJamb(g, R, -1, x0, x1, head, sill, wide);
    winJamb(g, R, 1, x0, x1, head, sill, wide);
    relieving(g, R, x0, x1, head);
    // And the lintel over the jambs, under the wedges: one lump if he was
    // lucky with the quarry, two meeting over the middle if he was not.
    if (R() < 0.42 && x1 - x0 < 250) {
      wearOne(g, stone(g, x0 - 18, top, x1 - x0 + 36, LINTEL, R, 'dress', false, (R() - 0.5) * 0.008), R);
    } else {
      const mid = (x0 + x1) / 2 + (R() - 0.5) * 30;
      wearOne(g, stone(g, x0 - 18, top, mid - x0 + 18, LINTEL, R, 'dress', false, (R() - 0.5) * 0.01), R);
      wearOne(g, stone(g, mid, top, x1 + 18 - mid, LINTEL, R, 'dress', false, (R() - 0.5) * 0.01), R);
    }
  }

  /* ---- the doorway -------------------------------------------------------- */
  /*
   * The one opening he did not solve with stone.
   *
   * A window gets a lintel and a course of wedges over it because a window is
   * small. An archway gets a ring because a ring is the thing that stands up.
   * A doorway is a metre and a third across with two and a quarter metres of
   * wall over it, and a man who cannot cut a voussoir is not going to find and
   * dress a stone four feet long either. So he lays a baulk of oak across it
   * and builds on top of that, and the only piece of the wall that is not
   * stone is the piece holding up the most of it.
   *
   * Under the ends of it, where the load comes down, the jamb goes long and
   * short about -- an upright the height of two courses, then a flat one, then
   * an upright -- which is what a rough mason does when he wants a corner to
   * stay where he put it and cannot cut a quoin.
   */
  const D_X0 = TW * DOOR.t0, D_X1 = TW * DOOR.t1;
  const D_HEAD = TH * (1 - DOOR.k1);
  const V_X0 = TW * DOUBLE.t0, V_X1 = TW * DOUBLE.t1;
  const V_HEAD = TH * (1 - DOUBLE.k1);
  /** How deep the beam over a doorway is, and how deep the one over a gate. */
  const BEAM = 25, GATE_BEAM = 30;
  /** How far a corbel reaches in under the end of a gate's beam. */
  const CORBEL = 42, CORBEL_H = 22;

  /** The jamb: long and short about, from under the beam to the ground. */
  function doorJamb(g: Ctx, R: Rand, side: number, x0: number, x1: number, head: number): void {
    const line = side < 0 ? x0 : x1;
    let y = head + 1, tall = true;
    while (y < TH + 20) {
      const h = tall ? 70 + R() * 24 : 26 + R() * 12;
      const w = (tall ? 44 : 62) + R() * 14;
      const x = side < 0 ? line + OVER - w : line - OVER;
      wearOne(g, stone(g, x, y, w, h, R, pickDressed(R), false, (R() - 0.5) * 0.022), R);
      y += h + MORTAR + R() * 3;
      tall = !tall;
    }
  }

  /**
   * The beam: a squared baulk with the saw still on it, bedded a hand into the
   * wall at each end and sagging the width of a finger in the middle, because
   * it has been carrying a storey of rubble for some years.
   */
  function baulk(g: Ctx, R: Rand, x0: number, x1: number, bTop: number, deep: number): void {
    const sag = 2.5 + R() * 2.5;
    const top = (t: number): number => bTop + Math.sin(Math.PI * t) * sag;
    const pts: Pt[] = [];
    for (let i = 0; i <= 8; i++) pts.push([x0 + (x1 - x0) * (i / 8), top(i / 8) + (R() - 0.5) * 1.2]);
    for (let i = 8; i >= 0; i--) pts.push([x0 + (x1 - x0) * (i / 8), top(i / 8) + deep + (R() - 0.5) * 1.2]);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const q of pts) g.lineTo(q[0], q[1]);
    g.closePath();
    g.fillStyle = PASTEL.beamShade;
    g.fill();
    g.save(); g.clip();
    g.translate(-2, -3.5);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const q of pts) g.lineTo(q[0], q[1]);
    g.closePath();
    g.fillStyle = PASTEL.beam;
    g.fill();
    // The grain: two or three long lines that wander the way a sawn face does.
    g.strokeStyle = hexA(PASTEL.beamLine, 0.35);
    g.lineWidth = 1.2;
    for (let k = 0; k < 2 + Math.floor(R() * 2); k++) {
      const off = deep * (0.25 + 0.5 * R());
      g.beginPath();
      for (let i = 0; i <= 8; i++) {
        const t = i / 8, x = x0 + (x1 - x0) * t, y = top(t) + off + Math.sin(t * 7 + k) * 1.6;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.restore();
    // The lit edge along the top, and the line round the whole of it.
    g.strokeStyle = hexA(PASTEL.beamHi, 0.75);
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 8; i++) { const t = i / 8, x = x0 + (x1 - x0) * t; if (i === 0) g.moveTo(x, top(t) + 1.4); else g.lineTo(x, top(t) + 1.4); }
    g.stroke();
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const q of pts) g.lineTo(q[0], q[1]);
    g.closePath();
    g.strokeStyle = PASTEL.beamLine;
    g.lineWidth = 2.4;
    g.lineJoin = 'round';
    g.stroke();
  }

  /**
   * Pocket, jambs, corbels, beam: the order a doorway goes up in.
   *
   * `reach` is how far a corbel comes in under the end of the beam, and it is
   * nought for a doorway and a hand's breadth for a gate. That is the whole
   * difference between the two, and it is the right one: the beam over a
   * doorway spans the doorway, and the beam over a gate would not, so the
   * last course either side steps out to meet it and shortens what the timber
   * has to carry. It sits above the head of the opening, which is why the cut
   * leaves it and takes everything under it.
   */
  function doorway(g: Ctx, R: Rand, x0: number, x1: number, head: number, deep: number, reach: number): void {
    const bTop = head - (reach ? CORBEL_H : 0) - deep + 3;
    const box: Pt[] = [[x0 - 26, bTop - 10], [x1 + 26, bTop - 10], [x1 + 26, TH + 8], [x0 - 26, TH + 8]];
    shape(g, roughen(box, R, 6, 4.5));
    g.fillStyle = PASTEL.ringJoint;
    g.fill();
    doorJamb(g, R, -1, x0, x1, head);
    doorJamb(g, R, 1, x0, x1, head);
    if (reach) {
      for (const side of [-1, 1]) {
        const line = side < 0 ? x0 : x1;
        const a = side < 0 ? line - 20 : line - reach;
        wearOne(g, stone(g, a, head - CORBEL_H, reach + 20, CORBEL_H + 3, R, 'dress', false, (R() - 0.5) * 0.01), R);
      }
    }
    baulk(g, R, x0 - 22 + reach * 0.8, x1 + 22 - reach * 0.8, bTop, deep);
  }

  /* ---- what grows in a way through --------------------------------------- */
  /**
   * Growth does not stop at a doorway.
   *
   * The first arch clipped every green thing to the stone, so the ivy that had
   * got over the top of the section was sliced off along the curve and the
   * hedge at the foot stopped dead at the jamb, both on a line nothing in the
   * picture explains. But a plant does not know there is an opening. It grows
   * down the face and dangles in the gap; it grows round the jamb and into the
   * reveal; and where a wall has been broken through, the seed gets in and
   * there is grass standing in the way.
   *
   * These two layers are painted per variant off that variant's own drapes and
   * hedges, so a tongue over an opening hangs from ivy that is really there
   * and no two archways are overgrown the same. The variant with nothing over
   * its top gets no tongue; the one with the widest hedge gets it across the
   * threshold.
   */

  /** Lobes for a curtain hanging at `cx` from `y0`, `w` half-wide, fraying as it falls. */
  function tongueLobes(cs: Lobe[], cx: number, y0: number, w: number, len: number, R: Rand): void {
    const r0 = 8.5;
    for (let y = y0; y < y0 + len; y += r0 * 1.1) {
      const t = (y - y0) / len;
      const hw = Math.max(r0 * 0.5, w * (1 - 0.62 * t) * (0.9 + 0.2 * R()));
      row(cs, cx - hw + (R() - 0.5) * r0 * 0.4, cx + hw, y, r0 * (0.95 - 0.3 * t), R, 1.3, t > 0.2 ? 0.32 : 0, (x) => x);
    }
  }

  /** A low mound of growth standing on `base`, `w` by `h`, wherever it is rooted. */
  function tussock(g: Ctx, x: number, base: number, w: number, h: number, R: Rand): void {
    const cs: Lobe[] = [], r = 5.5 + h * 0.08;
    for (let y = base - h + r; y <= base + r; y += r * 1.2) {
      const t = (base - y) / h;
      const hw = (w / 2) * (t > 0.25 ? 1 - 0.55 * Math.pow((t - 0.25) / 0.75, 1.3) : 1) * (0.9 + 0.2 * R());
      row(cs, x - hw, x + hw, y, r * (0.9 + 0.2 * R()), R, 1.3, t > 0.35 ? 0.35 : 0, (q) => q);
    }
    g.save(); g.beginPath(); g.rect(0, 0, TW, TH - 2); g.clip();
    shadowOf(g, cs, 5, 4);
    mass(g, cs, R, { r, lobe: R() < 0.4 ? 1 : 0 });
    g.restore();
  }

  /* ---- the textures ------------------------------------------------------ */
  const cnv = (w: number, h: number): HTMLCanvasElement => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const ctxOf = (c: HTMLCanvasElement): Ctx => c.getContext('2d') as Ctx;
  const STONES: Block[][] = [];
  const FACE = VARIANTS.map((v, i) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    STONES[i] = paintCourses(g, rand(v.seed), v.drapes.map((d): Pt => { const h2 = d.w / 2, c = clamp(d.cx, MARGIN + h2, TW - MARGIN - h2); return [c - h2, c + h2]; }));
    return c;
  });
  /**
   * And the same section with a way through it.
   *
   * The field is painted first, off the variant's own seed, so an arch butts
   * its neighbours on the same straddling stones every other section does --
   * the opening is a long way inside the margin and never touches a seam. Then
   * the pocket, the jambs and the ring, and then the hole out of the lot in
   * one pass: the curve belongs to the compass and the stones to the hammer.
   */
  const ARCHED = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    paintCourses(g, rand(v.seed), v.drapes.map((d): Pt => { const h2 = d.w / 2, m = clamp(d.cx, MARGIN + h2, TW - MARGIN - h2); return [m - h2, m + h2]; }));
    const R = rand(v.seed * 131 + 17);
    jamb(g, R, -1);
    jamb(g, R, 1);
    impost(g, R, -1);
    impost(g, R, 1);
    voussoirs(g, R);
    // Opaque, deliberately: `destination-out` takes away as much as the source
    // puts down, so a fill left over at 0.55 from the last pitted stone would
    // leave the field ghosting through the opening at 0.45.
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.globalCompositeOperation = 'destination-out';
    openingPath(g);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    return c;
  });
  /**
   * The ivy that hangs into the opening, one tongue per curtain that reaches
   * over it. It is rooted six pixels above the curve, so it comes out from
   * under the ring rather than out of the air.
   */
  const ARCH_IVY = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    const R = rand(v.seed * 991 + 43);
    for (const d of v.drapes) {
      if (!d.fall) continue;
      const half = d.w / 2, dcx = clamp(d.cx, MARGIN + half, TW - MARGIN - half);
      if (dcx - half > A_CX + A_R * 0.85 || dcx + half < A_CX - A_R * 0.85) continue;
      const x = clamp(dcx, A_CX - A_R * 0.76, A_CX + A_R * 0.76);
      const y0 = A_CY - Math.sqrt(Math.max(0, A_R * A_R - (x - A_CX) ** 2)) - 6;
      const cs: Lobe[] = [];
      tongueLobes(cs, x, y0, 13 + 11 * R(), CH * (0.7 + 0.9 * R()), R);
      shadowOf(g, cs, 5, 6);
      mass(g, cs, R, { r: 8.5, lobe: R() < 0.4 ? 1 : 0 });
    }
    return c;
  });
  /** And what has seeded itself in the gap: grass in the threshold, a tuft on an impost. */
  const ARCH_WEED = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    const R = rand(v.seed * 557 + 29);
    for (const side of [-1, 1]) {
      if (R() < 0.4) continue;
      tussock(g, A_CX + side * A_R * (0.42 + R() * 0.42), TH + 3, 34 + R() * 30, 26 + R() * 26, R);
    }
    // The impost is a ledge, and rain that runs off the ring stands on it.
    for (const side of [-1, 1]) {
      if (R() < 0.55) continue;
      tussock(g, A_CX + side * (A_R - 6 + R() * 14), A_CY + 1, 22 + R() * 14, 14 + R() * 10, R);
    }
    return c;
  });
  /** And the same section with a window in it, drawn and cut the same way. */
  const WINDOWED = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    paintCourses(g, rand(v.seed), v.drapes.map((d): Pt => { const h2 = d.w / 2, m = clamp(d.cx, MARGIN + h2, TW - MARGIN - h2); return [m - h2, m + h2]; }));
    surround(g, rand(v.seed * 197 + 61), W_X0, W_X1, W_HEAD, W_SILL, 66, 0);
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.rect(W_X0, W_HEAD, W_X1 - W_X0, W_SILL - W_HEAD);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    return c;
  });
  /**
   * What grows at a window: ivy over the head of it, and whatever has seeded
   * in the joint behind the sill, which is where the rain that runs off the
   * glass ends up.
   */
  const WIN_IVY = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    const R = rand(v.seed * 883 + 19);
    for (const d of v.drapes) {
      if (!d.fall) continue;
      const half = d.w / 2, dcx = clamp(d.cx, MARGIN + half, TW - MARGIN - half);
      if (dcx - half > W_X1 - 10 || dcx + half < W_X0 + 10) continue;
      const x = clamp(dcx, W_X0 + 18, W_X1 - 18);
      const cs: Lobe[] = [];
      tongueLobes(cs, x, W_HEAD - 8, 11 + 9 * R(), (W_SILL - W_HEAD) * (0.35 + 0.5 * R()), R);
      shadowOf(g, cs, 5, 6);
      mass(g, cs, R, { r: 8.5, lobe: R() < 0.4 ? 1 : 0 });
    }
    return c;
  });
  const WIN_WEED = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    const R = rand(v.seed * 419 + 83);
    for (const side of [-1, 1]) {
      if (R() < 0.45) continue;
      const x = (W_X0 + W_X1) / 2 + side * (W_X1 - W_X0) * (0.18 + R() * 0.28);
      tussock(g, x, W_SILL - 2, 22 + R() * 18, 14 + R() * 12, R);
    }
    return c;
  });
  /** And with a bay: the same hole and surround, on a shelf rather than a sill. */
  const BAYED = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    paintCourses(g, rand(v.seed), v.drapes.map((d): Pt => { const h2 = d.w / 2, m = clamp(d.cx, MARGIN + h2, TW - MARGIN - h2); return [m - h2, m + h2]; }));
    surround(g, rand(v.seed * 251 + 13), Y_X0, Y_X1, Y_HEAD, Y_SILL, 46, 10);
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.rect(Y_X0, Y_HEAD, Y_X1 - Y_X0, Y_SILL - Y_HEAD);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    return c;
  });
  /** And the same section with a doorway in it. */
  const DOORED = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    paintCourses(g, rand(v.seed), v.drapes.map((d): Pt => { const h2 = d.w / 2, m = clamp(d.cx, MARGIN + h2, TW - MARGIN - h2); return [m - h2, m + h2]; }));
    doorway(g, rand(v.seed * 311 + 29), D_X0, D_X1, D_HEAD, BEAM, 0);
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.rect(D_X0, D_HEAD, D_X1 - D_X0, TH - D_HEAD);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    return c;
  });
  /** And the gate: the same drawing at twice the span, on corbels. */
  const GATED = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    paintCourses(g, rand(v.seed), v.drapes.map((d): Pt => { const h2 = d.w / 2, m = clamp(d.cx, MARGIN + h2, TW - MARGIN - h2); return [m - h2, m + h2]; }));
    doorway(g, rand(v.seed * 373 + 41), V_X0, V_X1, V_HEAD, GATE_BEAM, CORBEL);
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.rect(V_X0, V_HEAD, V_X1 - V_X0, TH - V_HEAD);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    return c;
  });
  /**
   * What grows at a doorway, which is less than anywhere else on the wall,
   * because a doorway is the one part of it somebody walks through every day.
   * Ivy over the head where the curtain reaches that far, and a tuft in each
   * bottom corner where a boot never goes.
   */
  const DOOR_IVY = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    const R = rand(v.seed * 733 + 37);
    for (const d of v.drapes) {
      if (!d.fall) continue;
      const half = d.w / 2, dcx = clamp(d.cx, MARGIN + half, TW - MARGIN - half);
      if (dcx - half > D_X1 - 10 || dcx + half < D_X0 + 10) continue;
      const x = clamp(dcx, D_X0 + 16, D_X1 - 16);
      const cs: Lobe[] = [];
      tongueLobes(cs, x, D_HEAD - 7, 12 + 10 * R(), CH * (0.4 + 0.7 * R()), R);
      shadowOf(g, cs, 5, 6);
      mass(g, cs, R, { r: 8.5, lobe: R() < 0.4 ? 1 : 0 });
    }
    return c;
  });
  const DOOR_WEED = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    const R = rand(v.seed * 617 + 53);
    for (const side of [-1, 1]) {
      if (R() < 0.5) continue;
      tussock(g, (side < 0 ? D_X0 : D_X1) + side * (R() * 12 - 4), TH + 2, 26 + R() * 18, 18 + R() * 14, R);
    }
    return c;
  });
  /**
   * And the gate's, which is thinner again: a cart wheel goes closer to a
   * jamb than a boot does, so only the ivy over the head is sure of itself
   * and there is nothing in the corners but a wisp.
   */
  const GATE_IVY = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    const R = rand(v.seed * 541 + 71);
    for (const d of v.drapes) {
      if (!d.fall) continue;
      const half = d.w / 2, dcx = clamp(d.cx, MARGIN + half, TW - MARGIN - half);
      if (dcx - half > V_X1 - 10 || dcx + half < V_X0 + 10) continue;
      const x = clamp(dcx, V_X0 + 20, V_X1 - 20);
      const cs: Lobe[] = [];
      tongueLobes(cs, x, V_HEAD - 7, 12 + 10 * R(), CH * (0.4 + 0.7 * R()), R);
      shadowOf(g, cs, 5, 6);
      mass(g, cs, R, { r: 8.5, lobe: R() < 0.4 ? 1 : 0 });
    }
    return c;
  });
  const GATE_WEED = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    const R = rand(v.seed * 467 + 97);
    for (const side of [-1, 1]) {
      if (R() < 0.62) continue;
      tussock(g, (side < 0 ? V_X0 : V_X1) + side * (R() * 10 - 3), TH + 2, 20 + R() * 14, 14 + R() * 10, R);
    }
    return c;
  });
  /** The growth over the top is painted PAD px taller than the face, the extra above the top edge: the
   *  crest of each drape, standing above the cap, is part of the same silhouette. */
  const PAD = 64;
  const SPILL = VARIANTS.map((v) => {
    const c = cnv(TW, TH + PAD), g = ctxOf(c);
    g.translate(0, PAD);
    for (const m of v.drapes) {
      const lay = drapeLayout(m, rand(m.seed)), R = rand(m.seed + 1);
      shadowOf(g, lay.cs, 6, 7);
      mass(g, lay.cs, R, { r: lay.r, lobe: R() < 0.33 ? 0 : 1 });
    }
    return c;
  });
  const BASE = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    for (const b of v.foot.hedges) hedge(g, b, rand(b.seed));
    return c;
  });
  const FOOT = VARIANTS.map((v, i) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    footMoss(g, STONES[i].slice(), v.extras.moss, rand(v.seed * 19 + 7));
    return c;
  });
  /** The cap's stone, the same for every variant, drawn under the island's light. */
  const CAP_STONE = (() => {
    const c = cnv(TW, CAP_H), g = ctxOf(c);
    g.fillStyle = PASTEL.joint; g.fillRect(0, 0, TW, CAP_H);
    slabs(g, 0, CAP_H, rand(99));
    return c;
  })();
  const ENDS = (() => {
    const Wc = 64, c = cnv(Wc, TH), g = ctxOf(c), R = rand(7);
    g.fillStyle = PASTEL.joint; g.fillRect(0, 0, Wc, TH);
    stone(g, MORTAR / 2, MORTAR / 2, Wc - MORTAR, BAND - MORTAR, R, '', true);
    for (let i = 0; i < COURSES; i++) stone(g, MORTAR / 2, BAND + i * CH + MORTAR / 2, Wc - MORTAR, CH - MORTAR, R, ['', 'brown', 'green', ''][i]);
    return c;
  })();
  painted = {
    face: FACE,
    arch: ARCHED,
    archIvy: ARCH_IVY,
    archWeed: ARCH_WEED,
    window: WINDOWED,
    winIvy: WIN_IVY,
    winWeed: WIN_WEED,
    door: DOORED,
    doorIvy: DOOR_IVY,
    doorWeed: DOOR_WEED,
    gate: GATED,
    gateIvy: GATE_IVY,
    gateWeed: GATE_WEED,
    bay: BAYED,
    spill: SPILL,
    base: BASE,
    foot: FOOT,
    cap: CAP_STONE,
    ends: ENDS,
    reveal: channels(PASTEL.reveal),
    line: channels(PASTEL.line),
    beam: channels(PASTEL.beam),
    beamLine: channels(PASTEL.beamLine),
    w: TW,
    h: TH,
    pad: PAD,
    capH: CAP_H,
    tells: VARIANTS.map((v) => v.tells),
  };
  return painted;
}

/**
 * Paint it while nobody is waiting on it.
 *
 * The whole set is a tenth of a second's drawing on a desktop and several
 * times that on a phone, and it is all done the first time a wall of it comes
 * into view — which is a frame somebody is looking at. So it is asked for
 * once at boot, on the idle the browser hands out after the first screen is
 * up; whoever gets to a wall before the idle does pays for it as before, and
 * the answer is the same one either way.
 */
export function warmCobble(): void {
  const idle = globalThis.requestIdleCallback;
  if (typeof idle === 'function') idle(() => { cobble(); });
  else setTimeout(() => { cobble(); }, 1500);
}
