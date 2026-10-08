/**
 * The Sworn Blade's spells: how each is cast and what it looks like.
 *
 * A Blade is a swordsman who fights by measure: the distance judged, the blow
 * placed, the guard kept. Everything here is drawn in that one language --
 * cold steel and a white edge for what the sword does, brass for where a blow
 * lands and for what is being kept count of -- and three shapes carry it:
 *
 *   the smear    the sword's own path, sampled off the posed body through the
 *                cast (`bladeAt`), so a cut's light is exactly where the blade
 *                went rather than a stock crescent laid near it;
 *   the line     a straight ruled stroke: the cut left hanging in the air
 *                across what was struck, the measure taken before a blow, the
 *                line scored on the ground;
 *   the measure  a brass arc on the ground that unwinds over what a spell
 *                lasts (`measure`), so how long is left reads at a glance under
 *                every one of the Blade's lasting spells, on the Blade or on
 *                what the Blade marked.
 *
 * Blows swing the real weapon through the target (`wield`); the buffs are
 * stances and breaths, each a different silhouette and a different tempo.
 */
import { figureJoint, type Rig, type V3 } from '../figure';
import { HALF_H, HALF_W, HEIGHT_SCALE } from '../iso';
import type { CastPose, SpellVisual } from './index';
import { spellInfo } from './info';
import { bump, clamp, flashOf, hashOf, lerp, mid3, seg, smooth, TAU, type Body, type FxScene, type Look, type P3, type SpellPalette } from './kit';
import { euler, one, track, type Key } from './poses';

/** Steel and a cold white edge, with brass where a blow lands. */
export const PALETTE: SpellPalette = {
  core: '#ffffff',
  main: '#c9d6e3',
  deep: '#6d7f94',
  accent: '#e8c35a',
  ink: '#27303d',
  light: '#bfd8ff',
};

/** The brass of the palette as a shape's own colours: where a blow lands, and what is kept count of. */
const BRASS: Look = { main: PALETTE.accent, deep: '#a37a2a', core: '#fff4cc' };
const BRASS_DEEP = '#a37a2a';
/** Breath in the cold: pale, a little blue. */
const BREATH = '#e6eef8';
const DUST = '#8a7a62';

/* ---- where the sword is ----------------------------------------------------------------- */

/** How far from the fist to the point, in height units, by what is in it: a sword's own length, and a middling one for the rest. */
const BLADE_LEN: Record<string, number> = { sword: 7.6, short_sword: 5.4, hunting_knife: 2.6, butchering_knife: 2.9, carving_knife: 4.0 };
const bladeLen = (b: Body): number => BLADE_LEN[b.figure?.gear?.weapon?.id ?? ''] ?? 6;

/**
 * A point `along` height units out along the blade, on the caster as the cast has them at `t` (nought to one) --
 * not the frame now: what the blade's path was a moment ago, so a smear can lie exactly along it. The same
 * point `FxScene.weaponAt` finds, asked of the figure at another moment of the cast.
 */
function bladeAt(k: FxScene, t: number, along: number): P3 {
  const b = k.caster, f = b.figure, cast = f?.cast;
  if (!f || !cast) return k.weaponAt(along);
  const at: V3 = [0, 0.87 * along, -0.62 - 0.5 * along];
  const j = figureJoint({ ...f, facing: b.facing, cast: { id: cast.id, t } }, 'wrist1', at);
  return k.local(b, j[0], j[1], j[2]);
}

/* ---- the Blade's shapes -------------------------------------------------------------------- */

/**
 * The sword's smear: the band the blade swept between cast times `t0` and `t1`, from a little out from the
 * fist to the point, laid in facets that come up from nothing at the tail to full at the head. The leading
 * edge (the point's path) carries the white edge and the ink; the rest is steel going to nothing.
 */
function smear(k: FxScene, t0: number, t1: number, o: { alpha?: number; inner?: number; brass?: boolean } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || t1 <= t0 || !k.caster.figure?.cast) return;
  const n = k.fast ? 5 : 8;
  const L = bladeLen(k.caster);
  const tip: number[] = [], root: number[] = [];
  let near: P3 = k.caster, nearY = -Infinity;
  for (let i = 0; i <= n; i++) {
    const t = lerp(t0, t1, i / n);
    const p = bladeAt(k, t, L), q = bladeAt(k, t, L * (o.inner ?? 0.5));
    tip.push(k.sx(p), k.sy(p));
    root.push(k.sx(q), k.sy(q));
    // Sorted by whichever of its points is nearest the viewer on the ground, as a ribbon is.
    const gy = k.eye.worldToScreenY(p.x, p.y, k.ground(p.x, p.y));
    if (gy > nearY) { nearY = gy; near = p; }
  }
  const main = o.brass ? PALETTE.accent : PALETTE.main;
  const core = o.brass ? '#fff4cc' : PALETTE.core, ink = PALETTE.ink;
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  const z = k.zoom;
  k.worldDraw(near, (g) => {
    for (let i = 0; i < n; i++) {
      // Each facet a flat tone, coming up from nothing at the tail: steel on the inside, the white edge outside.
      const w = Math.pow((i + 1) / n, 1.4);
      const mx0 = lerp(root[2 * i], tip[2 * i], 0.6), my0 = lerp(root[2 * i + 1], tip[2 * i + 1], 0.6);
      const mx1 = lerp(root[2 * i + 2], tip[2 * i + 2], 0.6), my1 = lerp(root[2 * i + 3], tip[2 * i + 3], 0.6);
      g.globalAlpha = clamp(a * w * 0.6);
      g.fillStyle = main;
      g.beginPath();
      g.moveTo(root[2 * i], root[2 * i + 1]);
      g.lineTo(root[2 * i + 2], root[2 * i + 3]);
      g.lineTo(mx1, my1);
      g.lineTo(mx0, my0);
      g.closePath();
      g.fill();
      g.globalAlpha = clamp(a * w);
      g.fillStyle = core;
      g.beginPath();
      g.moveTo(mx0, my0);
      g.lineTo(mx1, my1);
      g.lineTo(tip[2 * i + 2], tip[2 * i + 3]);
      g.lineTo(tip[2 * i], tip[2 * i + 1]);
      g.closePath();
      g.fill();
    }
    // The edge in one line over the front half of it, where it is bright enough to want one: ink, and white on it.
    const from = Math.floor(n * 0.4);
    const edge = (): void => {
      g.beginPath();
      g.moveTo(tip[2 * from], tip[2 * from + 1]);
      for (let i = from + 1; i <= n; i++) g.lineTo(tip[2 * i], tip[2 * i + 1]);
    };
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.globalAlpha = clamp(a * 0.9);
    g.strokeStyle = ink;
    g.lineWidth = inkW + 1.3 * z;
    edge();
    g.stroke();
    g.strokeStyle = core;
    g.lineWidth = 1.3 * z;
    edge();
    g.stroke();
    g.lineCap = 'butt';
  }, 1);
  k.glow(bladeAt(k, t1, L), 6, a * 0.6);
  k.glowDraw((g) => {
    g.globalAlpha = clamp(a * 0.16);
    g.strokeStyle = PALETTE.light;
    g.lineWidth = 5 * z;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(tip[0], tip[1]);
    for (let i = 1; i <= n; i++) g.lineTo(tip[2 * i], tip[2 * i + 1]);
    g.stroke();
    g.lineCap = 'butt';
  });
}

/** The caster's ahead and right over the ground, as unit steps in tiles, ahead being at the target. */
function frameOf(k: FxScene): { fwd: { x: number; y: number }; right: { x: number; y: number } } {
  const fwd = k.toward(k.caster, k.target);
  const r0 = k.local(k.caster, 1, 0, 0);
  const rx = r0.x - k.caster.x, ry = r0.y - k.caster.y;
  // The perpendicular to ahead that lies on the body's right.
  const s = -fwd.y * rx + fwd.x * ry >= 0 ? 1 : -1;
  return { fwd, right: { x: -fwd.y * s, y: fwd.x * s } };
}

/** A point off `p`: `right` and `ahead` tiles along the caster's frame, `up` height units. */
const off = (p: P3, f: ReturnType<typeof frameOf>, right: number, ahead: number, up: number): P3 =>
  ({ x: p.x + f.right.x * right + f.fwd.x * ahead, y: p.y + f.right.y * right + f.fwd.y * ahead, z: p.z + up });

/**
 * The two ends of a stroke `len` pixels long (at zoom one) through `c`, slanting `deg` degrees up from the
 * screen's level: the first end on the caster's right as the screen has it, raised; the second on the left,
 * lowered. A cut is laid in the screen's terms rather than the body's, so a level cut reads level and a
 * slanting one slants from wherever it is seen.
 */
function slant(k: FxScene, c: P3, len: number, deg: number): [P3, P3] {
  const e = k.eye;
  let dx = e.unrotateX(1, -1), dy = e.unrotateY(1, -1);
  const l = Math.hypot(dx, dy) || 1;
  dx /= l;
  dy /= l;
  // Which way the caster's right lies across the screen; square on to the viewer, the right of the screen.
  const rt = k.local(k.caster, 1, 0, 0);
  const sign = k.sx(rt) - k.sx(k.caster) < -0.05 * k.zoom ? -1 : 1;
  const a = (deg * Math.PI) / 180;
  const h = ((len / 2) * Math.cos(a)) / (Math.SQRT2 * HALF_W) * sign, v = ((len / 2) * Math.sin(a)) / HEIGHT_SCALE;
  return [{ x: c.x + dx * h, y: c.y + dy * h, z: c.z + v }, { x: c.x - dx * h, y: c.y - dy * h, z: c.z - v }];
}

/**
 * The cut left in the air: a long thin straight stroke from `a` to `b`, sharp at both ends, brass with a white
 * heart and an ink edge, drawn out from `a` as `grow` goes to one. Then it hangs, and `part` opens it into two
 * edges drifting apart -- what was struck, cut.
 */
function cutLine(k: FxScene, a: P3, b: P3, o: { grow?: number; part?: number; alpha?: number; width?: number } = {}): void {
  const al = o.alpha ?? 1;
  if (al <= 0.01) return;
  const grow = clamp(o.grow ?? 1), part = clamp(o.part ?? 0);
  const end = mid3(a, b, grow);
  const pts = [a, mid3(a, end, 0.25), mid3(a, end, 0.5), mid3(a, end, 0.75), end];
  const w = (o.width ?? 3.4) * (1 - 0.55 * part);
  if (part <= 0) {
    k.ribbon(pts, { ...BRASS, alpha: al, width: w, taper: 'both', glow: 0.8 });
    return;
  }
  // Parted: the two edges, each a hair of the stroke, drifting a few units apart up and down.
  const gap = 1.6 * part;
  for (const s of [-1, 1]) {
    const q = pts.map((p) => ({ x: p.x, y: p.y, z: p.z + s * gap }));
    k.ribbon(q, { ...BRASS, alpha: al * (1 - part * 0.6), width: w, taper: 'both', glow: 0.5 });
  }
}

/**
 * A line scored into the ground from `a` to `b`: a long brass diamond lying flat on the land, `w` tiles across at
 * its widest, inked, with a white groove down its middle. On the ground rather than standing over it, so
 * whoever stands on it stands on it, from any side.
 */
function scored(k: FxScene, a: P3, b: P3, w: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  const px = (-dy / l) * w, py = (dx / l) * w;
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const P = (x: number, y: number): [number, number] => [k.eye.worldToScreenX(x, y), k.eye.worldToScreenY(x, y, k.ground(x, y) + 0.2)];
  const out = [P(a.x, a.y), P(m.x + px, m.y + py), P(b.x, b.y), P(m.x - px, m.y - py)];
  const groove = [P(lerp(a.x, m.x, 0.3), lerp(a.y, m.y, 0.3)), P(m.x + px * 0.3, m.y + py * 0.3), P(lerp(b.x, m.x, 0.3), lerp(b.y, m.y, 0.3)), P(m.x - px * 0.3, m.y - py * 0.3)];
  const z = k.zoom;
  const poly = (g: CanvasRenderingContext2D, q: Array<[number, number]>): void => {
    g.beginPath();
    g.moveTo(q[0][0], q[0][1]);
    for (let i = 1; i < q.length; i++) g.lineTo(q[i][0], q[i][1]);
    g.closePath();
  };
  k.groundDraw(m.x, m.y, l / 2 + 0.2, (g) => {
    g.globalAlpha = clamp(alpha);
    poly(g, out);
    g.fillStyle = PALETTE.accent;
    g.fill();
    g.lineWidth = Math.max(0.8, 0.8 * z);
    g.strokeStyle = PALETTE.ink;
    g.stroke();
    poly(g, groove);
    g.fillStyle = '#fff4cc';
    g.fill();
  });
  k.glowDraw((g) => {
    g.globalAlpha = clamp(alpha * 0.45);
    g.strokeStyle = PALETTE.accent;
    g.lineWidth = 4 * z;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(groove[0][0], groove[0][1]);
    g.lineTo(groove[2][0], groove[2][1]);
    g.stroke();
    g.lineCap = 'butt';
  });
}

/**
 * The measure: a brass arc on the ground round `c`, `r` tiles out, that runs clockwise from the top of the
 * screen through `share` of a full turn -- how much of a lasting spell is left -- over a faint track of the
 * whole, with a tick at each quarter. One shape under every lasting Blade spell, so how long reads the same
 * everywhere.
 */
function measure(k: FxScene, c: { x: number; y: number }, r: number, share: number, alpha: number, o: { band?: number; ticks?: number } = {}): void {
  if (alpha <= 0.01 || r <= 0.05) return;
  const s = clamp(share);
  const band = o.band ?? Math.max(0.022, r * 0.065);
  const n = Math.max(8, Math.round(k.facets(r, 40) * Math.max(s, 0.25)));
  // Clockwise on the screen from its top: the view's own (-1, -1) is straight up the screen.
  const e = k.eye;
  const a0 = -0.75 * Math.PI;
  const pt = (ang: number, rr: number, lift: number): [number, number] => {
    const u = Math.cos(ang), v = Math.sin(ang);
    const x = c.x + e.unrotateX(u, v) * rr, y = c.y + e.unrotateY(u, v) * rr;
    return [e.worldToScreenX(x, y), e.worldToScreenY(x, y, k.ground(x, y) + lift)];
  };
  const outer: number[] = [], inner: number[] = [];
  for (let i = 0; i <= n; i++) {
    const ang = a0 + (i / n) * s * TAU;
    outer.push(...pt(ang, r, 0.2));
    inner.push(...pt(ang, r - band, 0.2));
  }
  const track: number[] = [];
  const nt = k.facets(r, 32);
  for (let i = 0; i < nt; i++) track.push(...pt(a0 + (i / nt) * TAU, r - band * 0.5, 0.15));
  const ticks: number[] = [];
  const nTicks = o.ticks ?? 4;
  for (let i = 0; i < nTicks; i++) {
    const ang = a0 + (i / nTicks) * TAU;
    ticks.push(...pt(ang, r + band * 0.6, 0.2), ...pt(ang, r - band * 1.6, 0.2));
  }
  const head = s > 0.002 ? [...pt(a0 + s * TAU, r + band * 1.1, 0.2), ...pt(a0 + s * TAU, r - band * 2.1, 0.2)] : null;
  const z = k.zoom;
  k.groundDraw(c.x, c.y, r + 0.3, (g) => {
    g.globalAlpha = clamp(alpha * 0.22);
    g.strokeStyle = PALETTE.ink;
    g.lineWidth = Math.max(0.8, 0.7 * z);
    g.beginPath();
    for (let i = 0; i < nt; i++) (i ? g.lineTo : g.moveTo).call(g, track[2 * i], track[2 * i + 1]);
    g.closePath();
    g.stroke();
    g.beginPath();
    for (let i = 0; i < ticks.length; i += 4) {
      g.moveTo(ticks[i], ticks[i + 1]);
      g.lineTo(ticks[i + 2], ticks[i + 3]);
    }
    g.lineWidth = Math.max(0.8, 0.9 * z);
    g.stroke();
    if (s <= 0.002) return;
    g.globalAlpha = clamp(alpha);
    g.beginPath();
    g.moveTo(outer[0], outer[1]);
    for (let i = 1; i <= n; i++) g.lineTo(outer[2 * i], outer[2 * i + 1]);
    for (let i = n; i >= 0; i--) g.lineTo(inner[2 * i], inner[2 * i + 1]);
    g.closePath();
    g.fillStyle = PALETTE.accent;
    g.fill();
    g.lineWidth = Math.max(0.8, 0.7 * z);
    g.strokeStyle = PALETTE.ink;
    g.stroke();
    if (head) {
      g.lineWidth = Math.max(1.2, 1.3 * z);
      g.strokeStyle = PALETTE.ink;
      g.beginPath();
      g.moveTo(head[0], head[1]);
      g.lineTo(head[2], head[3]);
      g.stroke();
      g.lineWidth = Math.max(0.7, 0.6 * z);
      g.strokeStyle = '#fff4cc';
      g.stroke();
    }
  });
  // A faint light along what is left, so it still reads in the dark, and a brighter one on its head.
  if (head) k.glowDraw((g) => {
    g.lineCap = 'round';
    g.globalAlpha = clamp(alpha * 0.1);
    g.strokeStyle = PALETTE.accent;
    g.lineWidth = 2.5 * z;
    g.beginPath();
    g.moveTo(outer[0], outer[1]);
    for (let i = 1; i <= n; i++) g.lineTo(outer[2 * i], outer[2 * i + 1]);
    g.stroke();
    g.globalAlpha = clamp(alpha * 0.5);
    g.beginPath();
    g.moveTo(head[0], head[1]);
    g.lineTo(head[2], head[3]);
    g.stroke();
    g.lineCap = 'butt';
  });
}

/** Tiles out from the middle of a creature or a person that a mark on the ground under it goes: clear of its feet. */
const markR = (b: Body): number => 0.16 + (b.wide / 40) * 1.4;

/** The measure of a lasting spell at `age` with `left` to go: how much of it is left, faded in and out at the ends. */
function measureFor(k: FxScene, c: { x: number; y: number }, r: number, age: number, left: number, alpha = 0.85): void {
  measure(k, c, r, left / Math.max(1e-3, age + left), alpha * smooth(age / 0.35) * smooth(left / 0.5));
}

/**
 * A small sword drawn at screen point (x, y), point toward `ang` (nought straight down), `R` pixels from pommel
 * to point: a blade lit down its left, a brass guard, grip and pommel, inked. Drawn into `g` as it stands, for
 * a record of one sword or of several.
 */
function drawSword(g: CanvasRenderingContext2D, x: number, y: number, R: number, ang: number, alpha: number, zoom: number, brass = false): void {
  g.save();
  g.globalAlpha = clamp(alpha);
  g.translate(x, y);
  g.rotate(ang);
  // Pommel at the top (-y), the point down (+y): the blade two thirds of it, the guard across at a third.
  const gy = -R * 0.18, w = R * 0.11;
  g.lineJoin = 'miter';
  g.lineWidth = Math.max(0.9, 0.8 * zoom);
  g.strokeStyle = PALETTE.ink;
  g.beginPath();
  g.moveTo(-w, gy);
  g.lineTo(w, gy);
  g.lineTo(w * 0.8, R * 0.62);
  g.lineTo(0, R * 0.82);
  g.lineTo(-w * 0.8, R * 0.62);
  g.closePath();
  g.fillStyle = brass ? PALETTE.accent : PALETTE.main;
  g.fill();
  g.stroke();
  // The lit half of the blade, down its left.
  g.fillStyle = PALETTE.core;
  g.beginPath();
  g.moveTo(-w * 0.85, gy);
  g.lineTo(0, gy);
  g.lineTo(0, R * 0.8);
  g.lineTo(-w * 0.7, R * 0.62);
  g.closePath();
  g.fill();
  // Guard and grip in one path, the pommel a diamond.
  g.beginPath();
  g.rect(-R * 0.3, gy - R * 0.07, R * 0.6, R * 0.09);
  g.moveTo(0, -R * 0.56);
  g.lineTo(w * 1.1, -R * 0.47);
  g.lineTo(0, -R * 0.38);
  g.lineTo(-w * 1.1, -R * 0.47);
  g.closePath();
  g.fillStyle = PALETTE.accent;
  g.fill();
  g.stroke();
  g.fillStyle = brass ? BRASS_DEEP : PALETTE.deep;
  g.beginPath();
  g.rect(-w * 0.6, -R * 0.38, w * 1.2, R * 0.13);
  g.fill();
  g.stroke();
  g.restore();
}

/**
 * A small sword in the air at `p`, point toward `ang` on the screen (nought straight down), `r` pixels at zoom one
 * from pommel to point. What marks something as the Blade's.
 */
function swordGlyph(k: FxScene, p: P3, r: number, ang: number, alpha: number, o: { brass?: boolean; bias?: number } = {}): void {
  if (alpha <= 0.01) return;
  const x = k.sx(p), y = k.sy(p), R = r * k.zoom, z = k.zoom;
  k.worldDraw(p, (g) => drawSword(g, x, y, R, ang, alpha, z, o.brass), o.bias ?? 2);
  k.glow(p, r * 1.2, alpha * 0.22);
}

/**
 * A wide ring on the ground as a run of brass dashes, `r` tiles out and `band` across, turned by `turn`. Each dash
 * is its own small record: a ring several tiles across laid down as one would be redrawn under every line of
 * the ground it spans, which for a reach of five tiles is a score of times a frame for the whole of it.
 */
function dashes(k: FxScene, c: { x: number; y: number }, r: number, band: number, alpha: number, turn = 0): void {
  if (alpha <= 0.01) return;
  const n = Math.max(8, Math.min(k.fast ? 16 : 28, Math.round(r * 5)));
  const span = (TAU / n) * 0.62;
  const z = k.zoom;
  for (let i = 0; i < n; i++) {
    const a0 = turn + (i / n) * TAU;
    const pts: number[] = [];
    for (let j = 0; j <= 3; j++) {
      const an = a0 + (span * j) / 3;
      const x = c.x + Math.cos(an) * r, y = c.y + Math.sin(an) * r;
      pts.push(k.eye.worldToScreenX(x, y), k.eye.worldToScreenY(x, y, k.ground(x, y) + 0.15));
    }
    for (let j = 3; j >= 0; j--) {
      const an = a0 + (span * j) / 3;
      const x = c.x + Math.cos(an) * (r - band), y = c.y + Math.sin(an) * (r - band);
      pts.push(k.eye.worldToScreenX(x, y), k.eye.worldToScreenY(x, y, k.ground(x, y) + 0.15));
    }
    const mid = a0 + span / 2;
    k.groundDraw(c.x + Math.cos(mid) * r, c.y + Math.sin(mid) * r, (span * r) / 2 + band + 0.1, (g) => {
      g.globalAlpha = clamp(alpha);
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      for (let j = 2; j < pts.length; j += 2) g.lineTo(pts[j], pts[j + 1]);
      g.closePath();
      g.fillStyle = PALETTE.accent;
      g.fill();
      g.lineWidth = Math.max(0.7, 0.6 * z);
      g.strokeStyle = PALETTE.ink;
      g.stroke();
    });
  }
}

/**
 * A dart on the ground at `c`, pointing along `dir` (a step in tiles), `s` tiles long: brass, inked. Which way
 * something is turned: a challenged creature at the one who challenged it, the called ones inward.
 */
function dart(k: FxScene, c: { x: number; y: number }, dir: { x: number; y: number }, s: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const px = -dir.y, py = dir.x;
  const P = (a: number, b: number): [number, number] => {
    const x = c.x + dir.x * a + px * b, y = c.y + dir.y * a + py * b;
    return [k.eye.worldToScreenX(x, y), k.eye.worldToScreenY(x, y, k.ground(x, y) + 0.2)];
  };
  const pts = [P(s * 0.6, 0), P(-s * 0.4, s * 0.55), P(-s * 0.15, 0), P(-s * 0.4, -s * 0.55)];
  const z = k.zoom;
  k.groundDraw(c.x, c.y, s + 0.2, (g) => {
    g.globalAlpha = clamp(alpha);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < 4; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fillStyle = PALETTE.accent;
    g.fill();
    g.lineWidth = Math.max(0.8, 0.7 * z);
    g.strokeStyle = PALETTE.ink;
    g.stroke();
    // Its lit half.
    g.fillStyle = '#fff4cc';
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    g.lineTo(pts[1][0], pts[1][1]);
    g.lineTo(pts[2][0], pts[2][1]);
    g.closePath();
    g.fill();
  });
}

/**
 * A hoop round a body, level, at `c`, `r` tiles across: its far half drawn behind the body and its near half
 * over it, so it goes round rather than across. A band of steel (or brass) with an ink edge and a white lip.
 */
function hoop(k: FxScene, c: P3, r: number, o: { alpha?: number; width?: number; brass?: boolean; foot?: { x: number; y: number } } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r <= 0.01) return;
  const x = k.sx(c), y = k.sy(c);
  const rx = r * HALF_W * k.zoom, ry = r * HALF_H * k.zoom;
  const W = (o.width ?? 2) * k.zoom;
  const main = o.brass ? PALETTE.accent : PALETTE.main, core = o.brass ? '#fff4cc' : PALETTE.core;
  const foot = o.foot ?? c;
  const half = (g: CanvasRenderingContext2D, near: boolean): void => {
    g.globalAlpha = clamp(a * (near ? 1 : 0.6));
    const a0 = near ? 0 : Math.PI, a1 = near ? Math.PI : TAU;
    g.lineCap = 'butt';
    g.strokeStyle = PALETTE.ink;
    g.lineWidth = W + Math.max(1.2, 1.1 * k.zoom);
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, a0, a1);
    g.stroke();
    g.strokeStyle = near ? main : o.brass ? BRASS_DEEP : PALETTE.deep;
    g.lineWidth = W;
    g.stroke();
    if (near) {
      g.strokeStyle = core;
      g.lineWidth = Math.max(0.6, W * 0.35);
      g.beginPath();
      g.ellipse(x, y - W * 0.2, rx, ry, 0, a0 + 0.35, a1 - 0.35);
      g.stroke();
    }
  };
  k.worldDraw({ x: foot.x, y: foot.y, z: c.z }, (g) => half(g, false), -0.4);
  k.worldDraw({ x: foot.x, y: foot.y, z: c.z }, (g) => half(g, true), 0.7);
  k.glow(c, Math.max(4, r * HALF_W * 0.9), a * 0.35);
}

/** A ring of steel light going out over the ground from `c` to `r` tiles as `u` goes to one, thinning as it goes. */
function wave(k: FxScene, c: { x: number; y: number }, u: number, r: number, alpha = 1, o: Look & { band?: number } = {}): void {
  const rr = 0.08 + r * (1 - Math.pow(1 - clamp(u), 2.2));
  k.ring(c, rr, { ...o, band: Math.min(rr * 0.4, (o.band ?? 0.2) * (1 - 0.7 * u)), alpha: alpha * (1 - u * u), turn: u * 0.4 });
}

/** Sparks off steel: white and brass, quick, falling. */
function clash(k: FxScene, at: P3, n: number, heading?: { x: number; y: number }, cone = 2.2, speed = 1): void {
  k.burst(at, n, {
    kind: 'spark', colour: [PALETTE.core, PALETTE.accent, '#fff4cc'], size: 1.8, life: [0.18, 0.45], speed: [0.8 * speed, 2.4 * speed],
    up: [4, 26], heading, cone: heading ? cone : undefined, gravity: 70, drag: 0.05,
  });
}

/* ---- the poses ----------------------------------------------------------------------------- */

/*
 * Where the sword points, which is the whole of a Blade's cast: with `wield` the blade leaves the fist on the
 * thumb's side, sixty degrees off the line down the forearm, and every pitch down the arm turns it in the same
 * plane. So in the arm's own plane the blade stands at
 *
 *     60 + arm pitch + elbow + hand pitch     degrees from straight down, toward ahead
 *
 * -- 90 level ahead, 180 straight up, 210 back over the shoulder -- and an arm's roll out to the side lays that
 * plane over (a full roll out makes it level, for a flat sweep). The keys below are written from it: each
 * comment says where the blade is. Pointing it down in front wants the grip turned over (a hand pitch near
 * 180), which is how a sword is held to be driven into the ground.
 */

/** Feet and knees for a stance at `t`, keyed: [left forward, left out, right forward, right out, left knee, right knee]. */
function legs(r: Rig, t: number, keys: readonly Key[]): void {
  const v = track(t, keys);
  r.leg[0] = [v[0], v[1], 0];
  r.leg[1] = [v[2], v[3], 0];
  r.knee = [v[4], v[5]];
}

/**
 * Measured Cut: the sword taken up beside the head, its point back over the right shoulder, the left hand put
 * out toward the creature to take its distance, a held beat -- the measure -- and then the cut, over and down
 * through it on a long step, the body turning in behind the blade, and back to guard.
 */
const measuredCut: CastPose = (r, t) => {
  // Blade: 124 at guard, 210 over the shoulder at the top, 82 level at the blow, 72 going down and across, 116.
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.28, [150, 40, -6]], [0.42, [156, 42, -8]], [0.5, [62, 4, 14]], [0.62, [30, -16, 40]], [1, [26, 14, 6]]]);
  r.elbow[1] = one(t, [[0, 40], [0.28, 30], [0.42, 32], [0.5, 8], [0.62, 22], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.28, [-30, 0, 0]], [0.42, [-32, 0, 0]], [0.5, [-48, 0, 0]], [0.62, [-40, 0, 0]], [1, [-10, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.24, [62, 10, 8]], [0.42, [64, 8, 8]], [0.5, [6, 22, 0]], [0.7, [10, 18, 0]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 24], [0.24, 18], [0.42, 16], [0.5, 80], [1, 30]]);
  r.open[0] = t > 0.12 && t < 0.52;
  r.chest = euler(t, [[0, [0, 0, 0]], [0.28, [4, -2, -20]], [0.42, [5, -3, -24]], [0.5, [-8, 4, 20]], [0.62, [-8, 3, 26]], [1, [0, 0, 4]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.28, [3, 0, -6]], [0.42, [4, 0, -8]], [0.5, [-12, 0, 6]], [0.62, [-10, 0, 6]], [1, [-2, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.28, [-4, 0, 16]], [0.42, [-5, 0, 20]], [0.5, [-8, 0, -12]], [1, [-2, 0, -2]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.28, [6, 4, -4, 4, 14, 14]], [0.42, [6, 4, -4, 4, 18, 16]], [0.5, [30, 4, -18, 3, 32, 14]],
    [0.62, [28, 4, -17, 3, 30, 14]], [1, [8, 3, -3, 2, 8, 6]]]);
  r.wield = 1;
};

/**
 * Lunge: the body arrives low and still going -- the island puts it by the creature the moment the spell is
 * cast, so the pose starts a stride back and drives the last of it -- then the fencer's lunge, front knee deep,
 * back leg straight, the back arm flung out behind, the point driven straight through.
 */
const lunge: CastPose = (r, t) => {
  r.at = [0, one(t, [[0, -9], [0.3, -2], [0.4, 3], [0.62, 3], [1, 0]]), one(t, [[0, -1], [0.4, -2.4], [0.62, -2.2], [1, 0]])];
  // Blade: level ahead from the hip as it comes in (92), and level ahead at the full reach of the arm (90).
  r.arm[1] = euler(t, [[0, [-14, 18, 0]], [0.22, [-20, 16, 4]], [0.4, [104, 0, -4]], [0.62, [100, 2, -4]], [1, [28, 14, 4]]]);
  r.elbow[1] = one(t, [[0, 80], [0.22, 92], [0.4, 0], [0.62, 4], [1, 40]]);
  r.hand[1] = euler(t, [[0, [-36, 0, 0]], [0.22, [-40, 0, 0]], [0.4, [-52, 0, 0]], [0.62, [-50, 0, 0]], [1, [-10, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [40, 14, 0]], [0.22, [46, 12, 0]], [0.4, [-40, 36, 0]], [0.62, [-38, 36, 0]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 60], [0.22, 70], [0.4, 8], [0.62, 10], [1, 26]]);
  r.open[0] = t > 0.3 && t < 0.8;
  r.chest = euler(t, [[0, [-4, 0, -8]], [0.22, [-2, 0, -14]], [0.4, [-6, 0, 18]], [0.62, [-6, 0, 16]], [1, [0, 0, 2]]]);
  r.spine = euler(t, [[0, [-16, 0, 0]], [0.22, [-14, 0, -4]], [0.4, [-16, 0, 8]], [0.62, [-14, 0, 8]], [1, [-2, 0, 0]]]);
  r.head = euler(t, [[0, [6, 0, 6]], [0.4, [10, 0, -14]], [0.62, [8, 0, -12]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [34, 3, -26, 3, 44, 26]], [0.22, [14, 3, -6, 3, 40, 36]], [0.4, [56, 4, -36, 3, 60, 4]], [0.62, [54, 4, -35, 3, 58, 6]],
    [1, [8, 3, -4, 2, 8, 6]]]);
  r.wield = 1;
};

/**
 * Hamstring: down low on bent knees, the sword drawn back wide on the right with the arm out level, then swept
 * flat across at the height of the creature's legs, the body turning through it, and up again.
 */
const hamstring: CastPose = (r, t) => {
  // Blade: laid flat out to the right and back with the arm rolled out level, then down and ahead (66) as it sweeps.
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.3, [14, 76, -24]], [0.48, [44, -6, 30]], [0.62, [36, -34, 42]], [1, [28, 14, 4]]]);
  r.elbow[1] = one(t, [[0, 40], [0.3, 20], [0.48, 6], [0.62, 14], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.3, [-60, 0, 0]], [0.48, [-44, 0, 0]], [0.62, [-40, 0, 0]], [1, [-10, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.3, [60, -10, 10]], [0.48, [20, 50, 0]], [0.62, [16, 52, 0]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 24], [0.3, 60], [0.48, 20], [1, 26]]);
  r.open[0] = t > 0.2 && t < 0.8;
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [-4, 4, -40]], [0.48, [-6, -2, 28]], [0.62, [-6, -2, 36]], [1, [0, 0, 2]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [-20, 0, -8]], [0.48, [-26, 0, 8]], [0.62, [-24, 0, 8]], [1, [-2, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [12, 0, 22]], [0.48, [12, 0, -14]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.3, [30, 8, -14, 6, 56, 48]], [0.48, [46, 8, -26, 6, 66, 40]], [0.62, [44, 8, -24, 6, 62, 40]],
    [1, [8, 3, -3, 2, 8, 6]]]);
  r.wield = 1;
};

/**
 * Shield Bash: the left shoulder drawn back with the shield tucked across the chest and the weight on the back
 * foot, then the whole body driven in behind it, the shield punched out square, the sword kept back by the hip.
 */
const shieldBash: CastPose = (r, t) => {
  r.arm[0] = euler(t, [[0, [20, 12, 0]], [0.3, [30, 2, 44]], [0.42, [90, 2, 8]], [0.56, [86, 4, 8]], [1, [20, 14, 0]]]);
  r.elbow[0] = one(t, [[0, 40], [0.3, 108], [0.42, 34], [0.56, 40], [1, 40]]);
  // The sword kept back out of the way by the right hip, in its carry, as the shield does the work.
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.3, [-16, 20, 0]], [0.42, [-24, 22, 0]], [0.56, [-22, 22, 0]], [1, [24, 14, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [0.3, 40], [0.42, 46], [1, 40]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [4, 0, 30]], [0.42, [-8, 0, -26]], [0.56, [-8, 0, -22]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [6, 0, 6]], [0.42, [-20, 0, -6]], [0.56, [-18, 0, -6]], [1, [-2, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [-6, 0, -18]], [0.42, [6, 0, 18]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.3, [-4, 4, 10, 4, 18, 30]], [0.42, [38, 4, -28, 3, 40, 6]], [0.56, [36, 4, -26, 3, 38, 8]],
    [1, [6, 3, -2, 2, 6, 5]]]);
};

/**
 * Disarming Cut: the sword laid low across to the left hip, point down, then whipped up and out through the
 * creature's guard from low left to high right on a quick rise of the body, the wrist flicking at the top.
 */
const disarmingCut: CastPose = (r, t) => {
  // Blade: down and ahead across the left hip (30), up through the blow (158), up and a little back at the top (194).
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.3, [10, -30, 40]], [0.45, [110, 30, -20]], [0.56, [148, 44, -28]], [1, [28, 14, 4]]]);
  r.elbow[1] = one(t, [[0, 40], [0.3, 20], [0.45, 8], [0.56, 14], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.3, [-60, 0, 0]], [0.45, [-20, 0, 0]], [0.56, [-28, 0, 0]], [1, [-10, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.3, [30, 30, 0]], [0.45, [40, 12, 30]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 24], [0.3, 40], [0.45, 96], [1, 26]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [-6, 2, 28]], [0.45, [6, -2, -22]], [0.56, [6, -2, -26]], [1, [0, 0, 2]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [-12, 0, 8]], [0.45, [4, 0, -6]], [0.56, [5, 0, -6]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [6, 0, -16]], [0.45, [2, 0, 14]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.3, [14, 4, -6, 4, 36, 32]], [0.45, [22, 4, -12, 3, 8, 6]], [0.56, [22, 4, -12, 3, 6, 6]],
    [1, [6, 3, -2, 2, 6, 5]]]);
  r.wield = 1;
};

/**
 * Challenge: feet together, the hilt brought up before the chin in a salute, blade upright, and held; then the
 * blade swept down and out to point level at the creature, held there while the left hand calls it on, twice.
 */
const challenge: CastPose = (r, t) => {
  // Blade: upright before the face (180), then level at the creature (90).
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.26, [42, -12, 30]], [0.4, [42, -12, 30]], [0.55, [86, 6, -2]], [0.82, [84, 6, -2]], [1, [28, 14, 4]]]);
  r.elbow[1] = one(t, [[0, 40], [0.26, 112], [0.4, 112], [0.55, 2], [0.82, 4], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.26, [-34, 0, 0]], [0.4, [-34, 0, 0]], [0.55, [-58, 0, 0]], [0.82, [-56, 0, 0]], [1, [-10, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [0.4, [8, 12, 0]], [0.56, [56, 28, -16]], [0.64, [58, 26, -18]], [0.72, [56, 28, -16]], [0.86, [52, 26, -14]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [0.4, 22], [0.56, 30], [0.64, 96], [0.72, 34], [0.8, 92], [0.88, 40], [1, 24]]);
  r.open[0] = t > 0.44;
  r.chest = euler(t, [[0, [0, 0, 0]], [0.26, [4, 0, 0]], [0.4, [4, 0, 0]], [0.55, [2, 0, 14]], [0.82, [2, 0, 12]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.26, [3, 0, 0]], [0.55, [-2, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.26, [-10, 0, 0]], [0.4, [-10, 0, 0]], [0.55, [6, 0, -10]], [0.82, [6, 0, -10]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.26, [0, 1, 0, 1, 2, 2]], [0.4, [0, 1, 0, 1, 2, 2]], [0.55, [20, 3, -8, 3, 16, 6]], [0.82, [20, 3, -8, 3, 16, 6]],
    [1, [4, 2, -2, 2, 5, 4]]]);
  r.wield = 1;
};

/**
 * Second Breath: bent over spent, hands toward the knees, then the great breath -- the body coming up and the
 * chest opening, the arms going wide and low, the head back -- and let out as it settles.
 */
const secondBreath: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [20, 10, 0]], [0.2, [44, 4, 10]], [0.5, [22, 56, -10]], [0.66, [20, 48, -8]], [1, [14, 12, 0]]]);
    r.elbow[k] = one(t, [[0, 20], [0.2, 30], [0.5, 16], [1, 20]]);
  }
  r.open[0] = t > 0.1;
  const sh = one(t, [[0, 0], [0.2, -0.2], [0.5, 0.7], [0.66, 0.5], [1, 0]]);
  r.shrug = [sh, sh];
  r.chest = euler(t, [[0, [0, 0, 0]], [0.2, [-14, 0, 0]], [0.5, [14, 0, 0]], [0.66, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.2, [-20, 0, 0]], [0.5, [6, 0, 0]], [0.66, [3, 0, 0]], [1, [0, 0, 0]]]);
  r.neck = euler(t, [[0, [0, 0, 0]], [0.2, [-6, 0, 0]], [0.5, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.2, [-14, 0, 0]], [0.5, [20, 0, 0]], [0.66, [12, 0, 0]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.2, [10, 4, 8, 4, 30, 30]], [0.5, [2, 4, 0, 4, 2, 2]], [0.66, [2, 4, 0, 4, 6, 6]], [1, [2, 2, 0, 2, 4, 4]]]);
};

/**
 * Deflect: snapped into a hanging guard, the blade upright across the front of the body, and a short hard beat
 * of the wrist out as a blow is met -- quick, and held.
 */
const deflect: CastPose = (r, t) => {
  // Blade: upright before the body (170), beaten out at the meeting (185), back to upright.
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.22, [50, -10, 30]], [0.35, [54, -2, 18]], [0.5, [50, -8, 26]], [0.8, [48, -10, 28]], [1, [28, 14, 4]]]);
  r.elbow[1] = one(t, [[0, 40], [0.22, 70], [0.35, 62], [0.5, 70], [0.8, 72], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.22, [-10, 0, 0]], [0.35, [9, 0, -16]], [0.5, [-10, 0, 0]], [0.8, [-10, 0, 0]], [1, [-10, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.22, [30, 30, 0]], [0.8, [28, 30, 0]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 24], [0.22, 60], [1, 26]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.22, [2, 0, 14]], [0.35, [0, 0, 6]], [0.5, [2, 0, 12]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.22, [4, 0, 0]], [0.35, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.22, [-4, 0, -6]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.22, [-6, 5, 12, 5, 20, 22]], [0.35, [-8, 5, 14, 5, 24, 24]], [0.8, [-6, 5, 12, 5, 20, 22]], [1, [2, 2, 0, 2, 4, 4]]]);
  r.wield = 1;
};

/**
 * Hold the Line: the sword turned over in the fist and raised high, point down, the left hand coming to the
 * pommel, then driven down into the ground before the feet as the stance goes wide and low, and leant on.
 */
const holdTheLine: CastPose = (r, t) => {
  // Blade: from the guard (124) turned over in the hand to point down from over the head (360), and driven down (350).
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.36, [128, 10, 10]], [0.46, [132, 10, 10]], [0.55, [40, 4, 16]], [0.8, [40, 4, 16]], [1, [28, 14, 4]]]);
  r.elbow[1] = one(t, [[0, 40], [0.36, 22], [0.46, 24], [0.55, 80], [0.8, 82], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.36, [150, 0, 0]], [0.46, [150, 0, 0]], [0.55, [168, 0, 0]], [0.8, [168, 0, 0]], [1, [-10, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.36, [126, -12, 20]], [0.46, [130, -12, 20]], [0.55, [42, -14, 26]], [0.8, [42, -14, 26]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 24], [0.36, 26], [0.55, 84], [0.8, 86], [1, 26]]);
  r.open[0] = t > 0.3 && t < 0.86;
  r.chest = euler(t, [[0, [0, 0, 0]], [0.36, [8, 0, 0]], [0.55, [-10, 0, 0]], [0.8, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.36, [6, 0, 0]], [0.55, [-16, 0, 0]], [0.8, [-14, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.36, [10, 0, 0]], [0.55, [-8, 0, 0]], [0.8, [0, 0, 0]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.36, [2, 3, 0, 3, 6, 6]], [0.55, [12, 12, -8, 12, 36, 30]], [0.8, [12, 12, -8, 12, 32, 26]], [1, [2, 2, 0, 2, 4, 4]]]);
  r.wield = 1;
};

/**
 * Measured Breathing: the sword let down at the side, point low, the left hand flat on the belly, and one slow
 * breath in and out -- the chest and the shoulders rising and falling, the knees softening on the out-breath.
 */
const measuredBreathing: CastPose = (r, t) => {
  // Blade: down and ahead at the side (34).
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.2, [10, 18, 0]], [0.85, [10, 18, 0]], [1, [24, 14, 0]]]);
  r.elbow[1] = one(t, [[0, 40], [0.2, 14], [0.85, 14], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.2, [-50, 0, 0]], [0.85, [-50, 0, 0]], [1, [-10, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.18, [26, -12, 40]], [0.85, [26, -12, 40]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 24], [0.18, 96], [0.85, 96], [1, 26]]);
  r.open[0] = t > 0.1 && t < 0.92;
  const s = one(t, [[0, 0], [0.18, 0], [0.4, 0.8], [0.48, 0.8], [0.7, -0.2], [0.85, 0], [1, 0]]);
  r.shrug = [s, s];
  r.chest = euler(t, [[0, [0, 0, 0]], [0.18, [0, 0, 0]], [0.4, [10, 0, 0]], [0.48, [10, 0, 0]], [0.7, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.18, [-6, 0, 0]], [0.4, [8, 0, 0]], [0.48, [8, 0, 0]], [0.7, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.4, [2, 0, 0]], [0.7, [-3, 0, 0]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.18, [2, 4, 0, 4, 4, 4]], [0.4, [2, 4, 0, 4, 2, 2]], [0.7, [2, 4, 0, 4, 14, 14]], [1, [2, 2, 0, 2, 4, 4]]]);
  r.wield = 1;
};

/**
 * Guardian's Call: gathered over the sword with the knees bent and the head down, then up -- the sword thrust
 * straight up over the head, the left arm flung wide, the head back in the shout -- and held, for everything
 * round to see.
 */
const guardiansCall: CastPose = (r, t) => {
  // Blade: upright before the chest (170), then straight up over the head (180).
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.32, [56, -14, 30]], [0.5, [172, 12, 0]], [0.78, [170, 12, 0]], [1, [28, 14, 4]]]);
  r.elbow[1] = one(t, [[0, 40], [0.32, 104], [0.5, 4], [0.78, 6], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.32, [-50, 0, 0]], [0.5, [-56, 0, 0]], [0.78, [-56, 0, 0]], [1, [-10, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.32, [40, -6, 30]], [0.5, [70, 80, 0]], [0.78, [66, 78, 0]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 24], [0.32, 100], [0.5, 6], [0.78, 8], [1, 26]]);
  r.open[0] = t > 0.4 && t < 0.9;
  r.chest = euler(t, [[0, [0, 0, 0]], [0.32, [-10, 0, 0]], [0.5, [12, 0, 0]], [0.78, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.32, [-12, 0, 0]], [0.5, [6, 0, 0]], [0.78, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.32, [-16, 0, 0]], [0.5, [20, 0, 0]], [0.78, [16, 0, 0]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.32, [10, 6, 4, 6, 36, 34]], [0.5, [6, 10, -4, 10, 4, 4]], [0.78, [6, 10, -4, 10, 6, 6]], [1, [2, 2, 0, 2, 4, 4]]]);
  r.wield = 1;
};

/**
 * Last Stand: down on the right knee, the sword turned over and planted point down before it, the head bowed
 * over the hilt -- spent -- then up all at once into a wide stance, the sword swung up through the front to
 * stand upright before the face in both hands, and held.
 */
const lastStand: CastPose = (r, t) => {
  // Blade: point down before the knee (350), drawn up out of the ground and round past the shoulder to stand upright
  // before the face (180) -- turned the way back through the hand, as a hand pitch can only unwind.
  r.arm[1] = euler(t, [[0, [24, 14, 0]], [0.24, [40, -4, 16]], [0.44, [42, -4, 16]], [0.55, [60, -16, 34]], [0.82, [60, -16, 34]], [1, [28, 14, 4]]]);
  r.elbow[1] = one(t, [[0, 40], [0.24, 80], [0.44, 80], [0.55, 100], [0.82, 100], [1, 40]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.24, [170, 0, 0]], [0.44, [170, 0, 0]], [0.55, [-40, 0, 0]], [0.82, [-40, 0, 0]], [1, [-10, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [12, 10, 0]], [0.24, [40, -14, 26]], [0.44, [42, -14, 26]], [0.55, [58, -24, 40]], [0.82, [58, -24, 40]], [1, [10, 12, 0]]]);
  r.elbow[0] = one(t, [[0, 24], [0.24, 84], [0.55, 104], [0.82, 104], [1, 26]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.24, [-8, 0, 0]], [0.44, [-10, 0, 0]], [0.55, [10, 0, 0]], [0.82, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.24, [-14, 0, 0]], [0.44, [-16, 0, 0]], [0.55, [2, 0, 0]], [0.82, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.24, [-22, 0, 0]], [0.44, [-24, 0, 0]], [0.55, [6, 0, 0]], [0.82, [4, 0, 0]], [1, [0, 0, 0]]]);
  legs(r, t, [[0, [2, 2, 0, 2, 4, 4]], [0.24, [58, 4, -26, 4, 96, 104]], [0.44, [58, 4, -26, 4, 98, 106]], [0.55, [14, 14, -8, 14, 20, 16]],
    [0.82, [14, 14, -8, 14, 22, 18]], [1, [2, 2, 0, 2, 4, 4]]]);
  r.wield = 1;
};

/* ---- the numbers each spell is drawn from -------------------------------------------------- */

const fxOf = (id: string): Readonly<Record<string, number>> => spellInfo(id)?.fx ?? {};
/** Tiles round the caster a Guardian's Call reaches: what it turns. */
const CALL_REACH = spellInfo('blade_guardians_call')?.radius ?? 5;
/** Seconds a Shield Bash puts a creature's next blow back: how long it is shown reeling. */
const BASH_BACK = fxOf('blade_shield_bash').back ?? 2;

/* ---- the spells ---------------------------------------------------------------------------- */

export const BLADE: Record<string, SpellVisual> = {
  // Measured Cut (strike, on enemy): A blow at 130% that cannot miss, on an enemy within your reach.
  // The measure: a ruled brass line from the point to the creature through the held beat, which the cut then
  // follows exactly -- it cannot miss -- and a straight cut left hanging across it that parts.
  blade_measured_cut: {
    palette: PALETTE,
    cast: { timing: { secs: 0.95, release: 0.5 }, pose: measuredCut },
    fx: {
      charge: (k, t) => {
        // The measure taken: drawn out from the left hand's reach to the creature, held, gone as the blade falls.
        const m = bump(t, 0.18, 0.3, 0.5) * (t < 0.46 ? 1 : 1 - seg(t, 0.46, 0.5));
        if (m > 0.01) {
          const a = k.hand(0), b = k.heart(k.target);
          const grow = smooth(seg(t, 0.18, 0.34));
          k.ribbon([a, mid3(a, b, grow * 0.5), mid3(a, b, grow)], { ...BRASS, width: 1.4, taper: 'none', alpha: 0.8 * m, glow: 0.4 });
          // Its ticks, at even steps, the last on the creature.
          for (let i = 1; i <= 3; i++) if (grow > i / 3 - 0.02) k.flare(mid3(a, b, i / 3), 3 + (i === 3 ? 2 : 0), 0.8 * m, '#fff4cc', 0);
        }
        k.glow(k.weaponAt(bladeLen(k.caster)), 5, 0.6 * bump(t, 0.2, 0.42, 0.5));
        if (t > 0.42 && t < 0.66) smear(k, Math.max(0.42, t - 0.1), Math.min(t, 0.6), { alpha: 1 - seg(t, 0.56, 0.66) });
      },
      hit: (k) => {
        const f = frameOf(k);
        clash(k, k.heart(k.target), 26, f.fwd, 1.8);
        k.burst(k.heart(k.target), 8, { kind: 'shard', colour: [PALETTE.main, PALETTE.accent], size: 1.6, life: [0.3, 0.6], speed: [0.4, 1.0], up: [8, 20], heading: f.fwd, cone: 1.6, gravity: 50 });
      },
      impact: { secs: 0.7, draw: (k, u) => {
        // From high on the caster's right to low on its left, the way the blade came down through it.
        const [a, b] = slant(k, k.heart(k.target), 40, 38);
        cutLine(k, a, b, { grow: smooth(u / 0.12), part: smooth(seg(u, 0.4, 1)), alpha: 1 - seg(u, 0.7, 1), width: 3.8 });
        k.flare(k.heart(k.target), 7 * (1 - u), flashOf(u, 0.08), PALETTE.core, 0.6);
        k.light(k.target, 2.5, 0.7 * (1 - u));
      } },
    },
  },

  // Challenge (curse, on enemy, lasts 10 s): The creature turns on you at once and hunts only you for 10 s.
  // A salute, then the point laid on it: a taut brass line from the point to the creature, and crossed swords
  // over it for as long as it hunts you, a dart under it turned at you, and the measure running out.
  blade_challenge: {
    palette: PALETTE,
    cast: { timing: { secs: 1.15, release: 0.55 }, pose: challenge },
    fx: {
      charge: (k, t) => {
        // The salute's glint as the hilt comes up before the face, and down the blade as it is laid on the creature.
        k.flare(k.weaponAt(bladeLen(k.caster) * 0.85), 7, bump(t, 0.2, 0.3, 0.42), PALETTE.core, 0.3);
        if (t > 0.42 && t < 0.58) smear(k, Math.max(0.4, t - 0.1), t, { alpha: 0.7, inner: 0.6 });
      },
      travel: { secs: (tiles) => 0.12 + tiles * 0.03, draw: (k, u) => {
        const a = k.weaponAt(bladeLen(k.caster)), b = k.heart(k.target);
        k.ribbon([a, mid3(a, b, smooth(u) * 0.5), mid3(a, b, smooth(u))], { ...BRASS, width: 1.8, taper: 'none', glow: 0.6 });
      } },
      hit: (k) => {
        k.burst(k.at(k.target, 1.05), 6, { kind: 'mote', colour: [PALETTE.accent, '#fff4cc'], size: 1.8, life: [0.3, 0.6], speed: [0.3, 0.7], up: [4, 12], gravity: 0 });
        clash(k, k.heart(k.target), 10, k.toward(k.target, k.caster), 1.4, 0.6);
      },
      impact: { secs: 0.6, draw: (k, u) => {
        const a = k.weaponAt(bladeLen(k.caster)), b = k.heart(k.target);
        k.ribbon([a, mid3(a, b, 0.5), b], { ...BRASS, width: 1.8 * (1 - u), taper: 'none', alpha: 1 - u, glow: 0.6 });
        k.flare(k.at(k.target, 1.15), 10 * (1 - u), flashOf(u, 0.1), '#fff4cc');
      } },
      linger: { draw: (k, age, left) => {
        const a = smooth(age / 0.3) * smooth(left / 0.6);
        const top = k.at(k.target, 1.18);
        // Crossed swords, struck together as it lands and then riding over it, bobbing a little.
        const lift = { ...top, z: top.z + 1.2 * Math.sin(age * 2.4) };
        const open = 0.55 + 0.3 * (1 - smooth(age / 0.25));
        swordGlyph(k, lift, 12, Math.PI - open, a, { brass: true });
        swordGlyph(k, lift, 12, Math.PI + open, a);
        // Turned at you: a dart under it, at you.
        const d = k.toward(k.target, k.caster);
        const r = markR(k.target);
        dart(k, { x: k.target.x + d.x * (r + 0.12), y: k.target.y + d.y * (r + 0.12) }, d, 0.22, 0.9 * a);
        measureFor(k, k.target, r, age, left);
        // Now and then a pulse down the line between you, from it to you: it is coming.
        const ph = (age % 2.2) / 2.2;
        if (ph < 0.45) {
          const p = mid3(k.heart(k.target), k.chest(), smooth(ph / 0.45));
          k.orb(p, 1.6, { ...BRASS, alpha: a * 0.8 * Math.sin((Math.PI * ph) / 0.45), glow: 0.6 });
        }
      } },
    },
  },

  // Lunge (strike, on enemy): You stride to an enemy up to 4 tiles off, over ground you could walk, and strike it at 150%.
  // The island puts the body by the creature at once, so the stride is shown arriving: wind lines streaming off
  // behind, dust kicked up, the body driving its last step; then the point straight through on a long line of
  // light, a ring of force standing round it where it goes in.
  blade_lunge: {
    palette: PALETTE,
    cast: { timing: { secs: 0.85, release: 0.4, blendIn: 0.04 }, pose: lunge },
    fx: {
      charge: (k, t) => {
        const f = frameOf(k);
        // The rush: streaks off behind the body at its height, drawn back to nothing as it stops.
        const run = 1 - smooth(seg(t, 0.05, 0.42));
        if (run > 0.01) {
          const L = 0.7 * run;
          for (let i = 0; i < 4; i++) {
            const h = k.caster.tall * (0.25 + 0.2 * i), side = (hashOf(k.seed, i) - 0.5) * 0.3;
            const a = off(k.at(k.caster, 0), f, side, -0.15 - 0.1 * hashOf(k.seed, i + 9), h);
            const tail = off(a, f, 0, -L * (0.55 + 0.45 * hashOf(k.seed, i + 4)), 0);
            k.ribbon([tail, mid3(tail, a, 0.5), mid3(tail, a, 0.85), a], { width: 1.6 + 0.8 * hashOf(k.seed, i + 7), taper: 'both', alpha: 0.7 * run, glow: 0.3 });
          }
        }
        if (t < 0.35) k.emit(off(k.at(k.caster, 0), f, 0, -0.1, 1), 40 * (1 - t / 0.35), { kind: 'dust', colour: DUST, size: 2, life: [0.3, 0.6], speed: [0.2, 0.6], up: [2, 8], heading: { x: -f.fwd.x, y: -f.fwd.y }, cone: 1.4, gravity: 4, drag: 0.1 });
        if (t > 0.26 && t < 0.56) smear(k, Math.max(0.22, t - 0.1), Math.min(t, 0.46), { alpha: 1 - seg(t, 0.44, 0.56), inner: 0.5 });
      },
      release: (k) => {
        const f = frameOf(k);
        k.burst(off(k.at(k.caster, 0), f, 0, 0.1, 1), 8, { kind: 'dust', colour: DUST, size: 2.6, life: [0.4, 0.8], speed: [0.3, 0.8], up: [2, 8], heading: { x: -f.fwd.x, y: -f.fwd.y }, cone: 2.6, gravity: 3, drag: 0.1 });
      },
      hit: (k) => {
        const f = frameOf(k);
        // Through and out the far side.
        clash(k, k.heart(k.target), 22, f.fwd, 0.9, 1.4);
        k.flash(0.06);
      },
      impact: { secs: 0.65, draw: (k, u) => {
        const f = frameOf(k), h = k.heart(k.target);
        // The line of the thrust: from behind the point, through it, out past the creature.
        const a = off(h, f, 0, -0.4, 0), b = off(h, f, 0, 0.28 + 0.14 * smooth(u * 3), 0);
        k.ribbon([a, mid3(a, b, 0.5), mid3(a, b, 0.8), b], { ...BRASS, width: 3 * (1 - 0.6 * u), taper: 'both', alpha: 1 - seg(u, 0.45, 0.9) });
        // A ring standing round the line where it went in, opening and thinning.
        const R = (0.06 + 0.13 * smooth(u * 1.6)) * HALF_W * k.zoom;
        const x = k.sx(h), y = k.sy(h);
        const dx = k.sx(off(h, f, 0, 1, 0)) - x, dy = k.sy(off(h, f, 0, 1, 0)) - y;
        const ang = Math.atan2(dy, dx);
        const al = 1 - smooth(seg(u, 0.25, 0.9));
        const across = Math.hypot(dx, dy) / (HALF_W * k.zoom);
        k.worldDraw(off(h, f, 0, 0.1, 0), (g) => {
          g.globalAlpha = clamp(al);
          g.translate(x, y);
          g.rotate(ang);
          // Seen edge on along the thrust, round when it goes straight at or away from the viewer.
          const rx = R * clamp(1 - across, 0.22, 1) * 0.9, ry = R;
          g.lineWidth = (1.8 * (1 - u) + 0.6) * k.zoom + Math.max(1.2, k.zoom);
          g.strokeStyle = PALETTE.ink;
          g.beginPath();
          g.ellipse(0, 0, rx, ry, 0, 0, TAU);
          g.stroke();
          g.lineWidth = (1.8 * (1 - u) + 0.6) * k.zoom;
          g.strokeStyle = PALETTE.main;
          g.stroke();
          g.lineWidth = Math.max(0.6, 0.8 * k.zoom);
          g.strokeStyle = PALETTE.core;
          g.beginPath();
          g.ellipse(0, 0, rx, ry, 0, Math.PI * 0.9, Math.PI * 1.6);
          g.stroke();
        }, 2);
        k.flare(h, 8 * (1 - u), flashOf(u, 0.06), PALETTE.core, 0.785);
        k.light(k.target, 3, 0.8 * (1 - u));
      } },
    },
  },

  // Hamstring (strike, on enemy, lasts 10 s): A blow at 80%; for 10 s it walks, hunts and flees at 50% of its pace.
  // Low and flat at its legs: a brass cut at knee height, then for as long as it lasts a hobble of brass round
  // its legs and a halting trail of marks behind it on the ground where it drags itself along.
  blade_hamstring: {
    palette: PALETTE,
    cast: { timing: { secs: 0.8, release: 0.48 }, pose: hamstring },
    fx: {
      charge: (k, t) => {
        if (t > 0.3 && t < 0.66) smear(k, Math.max(0.28, t - 0.14), Math.min(t, 0.6), { alpha: 1 - seg(t, 0.54, 0.66) });
        if (t > 0.3 && t < 0.5) k.emit(k.weaponAt(bladeLen(k.caster)), 40, { kind: 'dust', colour: DUST, size: 2, life: [0.25, 0.5], speed: [0.1, 0.3], up: [1, 4], gravity: 4 });
      },
      hit: (k) => {
        const f = frameOf(k), legs = k.at(k.target, 0.2);
        clash(k, legs, 20, f.right, 2, 0.8);
        k.burst(k.at(k.target, 0.05), 10, { kind: 'dust', colour: DUST, size: 3, life: [0.4, 0.8], speed: [0.2, 0.5], up: [2, 6], gravity: 3 });
      },
      impact: { secs: 0.55, draw: (k, u) => {
        const legs = k.at(k.target, 0.2);
        const [a, b] = slant(k, legs, 40, -4);
        cutLine(k, a, b, { grow: smooth(u / 0.14), part: smooth(seg(u, 0.4, 1)), alpha: 1 - seg(u, 0.7, 1), width: 3.4 });
        k.flare(legs, 6 * (1 - u), flashOf(u, 0.1), PALETTE.core, 0);
        k.light(k.target, 2.2, 0.6 * (1 - u));
      } },
      linger: { draw: (k, age, left) => {
        const a = smooth(age / 0.3) * smooth(left / 0.6);
        const b = k.target, r = 0.06 + (b.wide / 40) * 0.6;
        // The hobble: two brass bands round its legs, pulled tight as it lands.
        const tight = 1 + 0.5 * (1 - smooth(age / 0.3));
        hoop(k, k.at(b, 0.16), r * tight, { alpha: a * 0.95, width: 1.6, brass: true, foot: b });
        hoop(k, k.at(b, 0.3), r * 0.92 * tight, { alpha: a * 0.7, width: 1.1, brass: true, foot: b });
        measureFor(k, b, markR(b), age, left);
        // Where it has been: kept as a few marks at its slowed steps, each fading.
        const s = k.state;
        const step = 0.3;
        if (s.tx === undefined || Math.hypot(b.x - s.tx, b.y - s.ty) > step) {
          for (let i = 3; i > 0; i--) { s[`x${i}`] = s[`x${i - 1}`] ?? b.x; s[`y${i}`] = s[`y${i - 1}`] ?? b.y; s[`t${i}`] = s[`t${i - 1}`] ?? -9; }
          s.x0 = b.x; s.y0 = b.y; s.t0 = age;
          s.tx = b.x; s.ty = b.y;
          if (age > 0.4) k.burst(k.at(b, 0.02), 4, { kind: 'dust', colour: DUST, size: 2.6, life: [0.4, 0.7], speed: [0.05, 0.2], up: [1, 4], gravity: 2 });
        }
        for (let i = 1; i <= 3; i++) {
          const fade = 1 - seg(age - (s[`t${i}`] ?? -9), 0, 2.4);
          if (fade <= 0) continue;
          k.disc({ x: s[`x${i}`], y: s[`y${i}`] }, 0.07, { main: BRASS_DEEP, alpha: 0.6 * fade * a, n: 6 });
        }
      } },
    },
  },

  // Shield Bash (strike, on enemy): With a shield in your off hand: a crushing blow at 70% that knocks a heavy blow off its stroke and puts its next blow back 2 s.
  // Blunt, not sharp: a face of light the shape of the shield slammed flat into it, a shock going through, and
  // the creature reeling for the 2 s its next blow is put back, with the measure for those seconds under it.
  blade_shield_bash: {
    palette: PALETTE,
    cast: { timing: { secs: 0.75, release: 0.42 }, pose: shieldBash },
    fx: {
      charge: (k, t) => {
        k.glow(k.hand(0), 7, 0.6 * bump(t, 0.15, 0.4, 0.5));
      },
      hit: (k) => {
        const f = frameOf(k), h = k.heart(k.target);
        clash(k, off(h, f, 0, -0.12, 0), 18, { x: -f.fwd.x, y: -f.fwd.y }, 2.6, 0.7);
        k.burst(k.at(k.target, 0.02), 14, { kind: 'dust', colour: DUST, size: 3.2, life: [0.4, 0.9], speed: [0.3, 0.8], up: [2, 8], heading: f.fwd, cone: 1.8, gravity: 3, drag: 0.1 });
      },
      impact: { secs: 0.6, draw: (k, u) => {
        const f = frameOf(k), h = k.heart(k.target);
        // The shield's face, flat on to the blow, between you and it: a heater shield of light, struck and gone.
        const c = off(h, f, 0, -0.18 - 0.12 * smooth(u), 0);
        const x = k.sx(c), y = k.sy(c);
        const R = (6.5 + 3 * smooth(u * 2)) * k.zoom;
        const side = { x: k.sx(off(c, f, 1, 0, 0)) - x, y: k.sy(off(c, f, 1, 0, 0)) - y };
        const sl = Math.hypot(side.x, side.y) || 1;
        // Foreshortened across as the frame turns from the viewer, never less than a sliver.
        const sq = clamp(sl / (HALF_W * k.zoom), 0.3, 1);
        const al = Math.pow(flashOf(u, 0.05), 2.2) * 0.95;
        k.worldDraw(c, (g) => {
          g.globalAlpha = clamp(al);
          g.translate(x, y);
          g.scale(sq * Math.sign(side.x || 1), 1);
          const P = [[-1, -1], [1, -1], [1, 0.1], [0, 1.15], [-1, 0.1]];
          g.beginPath();
          P.forEach(([px, py], i) => (i ? g.lineTo(px * R * 0.75, py * R) : g.moveTo(px * R * 0.75, py * R)));
          g.closePath();
          g.fillStyle = PALETTE.main;
          g.fill();
          g.lineWidth = Math.max(1, 0.9 * k.zoom) / sq;
          g.strokeStyle = PALETTE.ink;
          g.stroke();
          // Its lit quarter and a brass boss.
          g.fillStyle = PALETTE.core;
          g.beginPath();
          g.moveTo(-R * 0.75, -R);
          g.lineTo(0, -R);
          g.lineTo(0, R * 1.15);
          g.lineTo(-R * 0.75, R * 0.1);
          g.closePath();
          g.globalAlpha = clamp(al * 0.6);
          g.fill();
          g.globalAlpha = clamp(al);
          g.fillStyle = PALETTE.accent;
          g.beginPath();
          g.arc(0, -R * 0.1, R * 0.22, 0, TAU);
          g.fill();
          g.stroke();
        }, 3);
        // The shock going on through it.
        for (let i = 0; i < 2; i++) {
          const v = clamp(u * 1.5 - i * 0.2);
          if (v <= 0 || v >= 1) continue;
          k.slash(k.target, { u: 1, from: 0.9, to: -0.9, tilt: Math.PI / 2, reach: 3 + 10 * v, up: k.target.tall * 0.5, width: 3.2 * (1 - v), length: 1.8, alpha: 0.8 * (1 - v), glow: 0.4 });
        }
        k.light(k.target, 2.5, 0.6 * (1 - u));
      } },
      linger: { secs: BASH_BACK, draw: (k, age, left) => {
        const a = smooth(age / 0.25) * smooth(left / 0.4);
        const top = k.at(k.target, 1.1);
        // Reeling: three brass pips going round over it, wobbling.
        for (let i = 0; i < 3; i++) {
          const ang = age * 5 + (i * TAU) / 3;
          const p = { x: top.x + Math.cos(ang) * 0.12, y: top.y + Math.sin(ang) * 0.12, z: top.z + 1.2 * Math.sin(ang * 2) };
          k.mark(p, { r: 2.6, points: 4, turn: age * 6 + i, alpha: a, glow: 0.4 });
        }
        measureFor(k, k.target, markR(k.target), age, left);
      } },
    },
  },

  // Second Breath (buff, on self): Costs no stamina. 40% of a full bar of stamina back at once.
  // The breath drawn in: streams of cold air pulled in to the chest from round about; then it goes out in a
  // white breath and a ring off the chest, and the measure fills to the share of a full bar given back.
  blade_second_breath: {
    palette: PALETTE,
    cast: { timing: { secs: 1.1, release: 0.5 }, pose: secondBreath },
    fx: {
      charge: (k, t) => {
        // The draw: wisps of air one after another out of the ground round about, each spiralling in and up to the
        // chest and gone into it, quicker as the breath deepens.
        const c = k.chest();
        const n = k.fast ? 4 : 7;
        for (let i = 0; i < n; i++) {
          const s0 = 0.12 + (0.3 * i) / n;
          const v = seg(t, s0, s0 + 0.2 - 0.06 * (i / n));
          if (v <= 0 || v >= 1) continue;
          const a0 = (i / n) * TAU * 1.618 + hashOf(k.seed, i) * 0.6;
          const pts: P3[] = [];
          for (let j = 0; j <= 5; j++) {
            const w = clamp(v - 0.4 * (1 - j / 5));
            const e = w * w;
            const rr = 1.0 * (1 - e);
            const ang = a0 + e * 2.4;
            pts.push({ x: c.x + Math.cos(ang) * rr, y: c.y + Math.sin(ang) * rr, z: lerp(k.caster.z + 3, c.z, Math.sqrt(w)) });
          }
          k.ribbon(pts, { main: BREATH, core: PALETTE.core, width: 2, taper: 'start', alpha: 0.85 * Math.sin(Math.PI * v), glow: 0.4, edge: false });
        }
        // The out-breath, in front of the face.
        if (t > 0.52 && t < 0.72) k.emit(k.local(k.caster, 0, 2.5, k.head().z - k.caster.z - 1.5), 40, { kind: 'smoke', colour: BREATH, size: 2, life: [0.5, 0.9], speed: [0.15, 0.35], up: [1, 3], heading: k.facingDir(k.caster), cone: 0.8, gravity: -2, drag: 0.3 });
      },
      hit: (k) => {
        k.burst(k.chest(), 9, { kind: 'mote', colour: [PALETTE.core, PALETTE.light], size: 1.5, life: [0.4, 0.8], speed: [0.4, 0.9], up: [2, 10], gravity: 0, drag: 0.15 });
      },
      impact: { secs: 0.9, draw: (k, u) => {
        const c = k.chest();
        // A ring off the chest, level, going out and thinning.
        hoop(k, c, 0.12 + 0.75 * (1 - Math.pow(1 - u, 2)), { alpha: (1 - u) * 0.9, width: 1.8 * (1 - u) + 0.5, foot: k.caster });
        // The measure filling to what came back, then let go.
        const back = k.fx.stamina ?? 0.4;
        measure(k, k.caster, 0.42, back * smooth(u / 0.35), (1 - seg(u, 0.65, 1)) * 0.95);
        k.light(k.caster, 2.5, 0.5 * (1 - u));
      } },
    },
  },

  // Deflect (buff, on self, lasts 6 s): For 6 s, every blow you block lands back on what struck at 50% of the blow.
  // The parry left hanging: a crescent of steel edge in front of the body, rising across it from low on the left
  // to high on the right as the guard was taken, a glint running along it, and now and then a blow met on it
  // -- a flare of steel and a brass stroke thrown back out the way the blow came.
  blade_deflect: {
    palette: PALETTE,
    cast: { timing: { secs: 0.65, release: 0.35 }, pose: deflect },
    fx: {
      charge: (k, t) => {
        if (t > 0.12 && t < 0.4) smear(k, Math.max(0.08, t - 0.12), t, { alpha: 0.8 * (1 - seg(t, 0.32, 0.4)), inner: 0.5 });
      },
      hit: (k) => {
        const p = k.weaponAt(bladeLen(k.caster) * 0.6);
        clash(k, p, 16, k.facingDir(k.caster), 2.2, 0.9);
        k.flare(p, 6, 1, PALETTE.core, 0.3);
      },
      linger: { draw: (k, age, left) => {
        const a = smooth(age / 0.2) * smooth(left / 0.5);
        const b = k.caster;
        // Sprung out wide as the guard is taken, then drawn in to sit a forearm's length off the body.
        const open = 1 + 0.4 * (1 - smooth(age / 0.25));
        // A crescent standing in front, bowed out at its middle like the edge of a shield, from low on the left to
        // high on the right as the guard was taken.
        const at = (s: number, out = 0): P3 => {
          const ang = s * 0.75 * open;
          const R = 6 + 4.5 * Math.cos((s * Math.PI) / 2) + out;
          return k.local(b, Math.sin(ang) * R, Math.cos(ang) * R + 1, b.tall * (0.55 + 0.42 * s));
        };
        const n = k.fast ? 6 : 10;
        const arc: P3[] = [];
        for (let i = 0; i <= n; i++) arc.push(at(-1 + (2 * i) / n));
        k.ribbon(arc, { width: 3, taper: 'both', alpha: 0.75 * a, glow: 0.5 });
        // The glint running up it.
        const g = (age * 0.8) % 1.4;
        if (g < 1) k.flare(at(-1 + 2 * g, 0.2), 4.5, a * Math.sin(Math.PI * g), PALETTE.core, 0.3);
        // A blow met: every so often, somewhere along it.
        const beat = Math.floor(age / 1.4);
        if (k.state.beat !== beat && age > 0.6 && left > 0.5) {
          k.state.beat = beat;
          const s = (hashOf(k.seed, beat) - 0.5) * 1.4;
          clash(k, at(s), 9, k.facingDir(b), 1.2, 0.8);
          k.state.met = age;
          k.state.ms = s;
        }
        const since = age - (k.state.met ?? -9);
        if (since < 0.35) {
          const v = since / 0.35;
          k.flare(at(k.state.ms), 7 * (1 - v), a, PALETTE.core, 0.4);
          // What lands back: a short brass stroke thrown out from it, the way the blow came.
          k.ribbon([at(k.state.ms, 1 + 5 * smooth(v)), at(k.state.ms, 2 + 9 * smooth(v))], { ...BRASS, width: 2.4, taper: 'start', alpha: a * (1 - v), glow: 0.5 });
        }
        measureFor(k, b, 0.4, age, left);
      } },
    },
  },

  // Hold the Line (buff, on self, lasts 15 s): For 15 s your wounds bleed 50% less, and those on your arms do not slow your swing.
  // The sword driven point down into the ground: a line scored across the ground where it went in, in brass, and
  // for as long as it lasts steel bands bound round both forearms -- arms that keep their swing -- with the
  // measure running out under the feet.
  blade_hold_the_line: {
    palette: PALETTE,
    cast: { timing: { secs: 1.2, release: 0.55 }, pose: holdTheLine },
    fx: {
      charge: (k, t) => {
        k.flare(k.weaponAt(bladeLen(k.caster)), 6, bump(t, 0.26, 0.4, 0.5), PALETTE.core, 0.2);
        if (t > 0.44 && t < 0.62) smear(k, Math.max(0.4, t - 0.1), Math.min(t, 0.56), { alpha: 0.8 * (1 - seg(t, 0.55, 0.62)) });
      },
      hit: (k) => {
        const tip = k.weaponAt(bladeLen(k.caster));
        const p = k.on(tip.x, tip.y, 0.5);
        clash(k, p, 24, undefined, 0, 0.7);
        k.burst(p, 16, { kind: 'dust', colour: DUST, size: 3, life: [0.4, 0.9], speed: [0.3, 0.8], up: [3, 10], gravity: 4, drag: 0.1 });
        // Where the line lies: where the point went in, square across the way the Blade faces, kept where it was scored.
        const f = k.facingDir(k.caster);
        k.state.lx = tip.x + f.x * 0.2; k.state.ly = tip.y + f.y * 0.2; k.state.fx = f.x; k.state.fy = f.y;
      },
      impact: { secs: 1.6, draw: (k, u) => {
        const s = k.state;
        if (s.lx === undefined) return;
        const c = { x: s.lx, y: s.ly }, px = -s.fy, py = s.fx;
        // Scored outward both ways from the point, fast.
        const half = 0.45 * smooth(u / 0.1);
        const a = k.on(c.x - px * half, c.y - py * half, 0.3), b = k.on(c.x + px * half, c.y + py * half, 0.3);
        const al = 1 - seg(u, 0.55, 1);
        scored(k, a, b, 0.05, al);
        if (u < 0.1) k.flare(mid3(a, b, 0.5), 8, 1 - u / 0.1, '#fff4cc', 0);
        // Sparks running out along it to its two ends as it is scored.
        if (u < 0.12) for (const q of [a, b]) k.emit(q, 120, { kind: 'spark', colour: [PALETTE.accent, '#fff4cc'], size: 1.4, life: [0.12, 0.3], speed: [0.3, 0.8], up: [6, 16], gravity: 60 });
        k.light(c, 2, 0.5 * al);
      } },
      linger: { draw: (k, age, left) => {
        const a = smooth(age / 0.4) * smooth(left / 0.6);
        const b = k.caster;
        // Bound as it lands: each band drawn tight from wider than the arm.
        const bind = 1 + 0.8 * (1 - smooth(age / 0.3));
        for (let s = 0; s < 2; s++) bracer(k, k.joint(b, `elbow${s}`), k.joint(b, `wrist${s}`), a, bind);
        measureFor(k, b, 0.4, age, left);
      } },
    },
  },

  // Disarming Cut (strike, on enemy, lasts 30 s): A blow at 70%; its next 3 blows within 30 s do 40% less damage.
  // A rising flick through its guard: a brass cut from low to high, steel chips thrown up off it, and over it
  // three broken blades -- its next three blows, blunted -- under a measure of the thirty seconds.
  blade_disarming_cut: {
    palette: PALETTE,
    cast: { timing: { secs: 0.8, release: 0.45 }, pose: disarmingCut },
    fx: {
      charge: (k, t) => {
        if (t > 0.3 && t < 0.62) smear(k, Math.max(0.28, t - 0.12), Math.min(t, 0.56), { alpha: 1 - seg(t, 0.52, 0.62) });
      },
      hit: (k) => {
        const f = frameOf(k), h = k.at(k.target, 0.62);
        clash(k, h, 18, f.fwd, 2.4, 0.9);
        // Chips knocked off whatever it fights with, up and away.
        k.burst(h, 9, { kind: 'shard', colour: [PALETTE.main, PALETTE.deep, PALETTE.accent], size: 1.4, life: [0.5, 0.9], speed: [0.4, 1.1], up: [18, 34], heading: f.right, cone: 2.4, gravity: 60, spin: 3 });
      },
      impact: { secs: 0.6, draw: (k, u) => {
        // From low on the caster's left to high on its right: the way the blade went up, steeper than a cut down.
        const [b, a] = slant(k, k.at(k.target, 0.62), 36, 58);
        cutLine(k, a, b, { grow: smooth(u / 0.12), part: smooth(seg(u, 0.4, 1)), alpha: 1 - seg(u, 0.7, 1), width: 3.2 });
        k.flare(k.at(k.target, 0.62), 7 * (1 - u), flashOf(u, 0.08), PALETTE.core, 0.3);
        k.light(k.target, 2.2, 0.6 * (1 - u));
      } },
      linger: { draw: (k, age, left) => {
        const a = smooth(age / 0.4) * smooth(left / 0.8);
        brokenBlades(k, k.at(k.target, 1.12), k.fx.blows ?? 3, 7, a * 0.9, age);
        measureFor(k, k.target, markR(k.target), age, left, 0.6);
      } },
    },
  },

  // Measured Breathing (buff, on self, lasts 20 s): For 20 s a swing or a draw costs no stamina.
  // One slow breath, the hand on the belly: a ring under the feet drawn in and let out with it, and for as long
  // as it lasts that ring breathing slowly under the Blade, the measure running round inside it.
  blade_measured_breathing: {
    palette: PALETTE,
    cast: { timing: { secs: 1.6, release: 0.6 }, pose: measuredBreathing },
    fx: {
      charge: (k, t) => {
        const breath = smooth(seg(t, 0.18, 0.44)) - smooth(seg(t, 0.48, 0.72));
        // Handed on to the linger's own ring as the spell lands, which picks the breath up from here.
        k.ring(k.caster, 0.42 + 0.2 * breath, { band: 0.025 + 0.02 * breath, alpha: 0.85 * seg(t, 0.05, 0.2) * (1 - seg(t, 0.6, 0.72)), turn: 0, glow: 0.5 });
        if (t > 0.5 && t < 0.72) k.emit(k.local(k.caster, 0, 2.5, k.head().z - k.caster.z - 1.5), 30, { kind: 'smoke', colour: BREATH, size: 1.6, life: [0.6, 1.1], speed: [0.06, 0.16], up: [1, 3], heading: k.facingDir(k.caster), cone: 0.8, gravity: -2, drag: 0.4 });
      },
      linger: { draw: (k, age, left) => {
        const a = smooth(age / 0.5) * smooth(left / 0.8);
        // A breath every four seconds: in, held, out.
        const ph = (age % 4) / 4;
        const breath = smooth(seg(ph, 0, 0.4)) - smooth(seg(ph, 0.5, 0.95));
        k.ring(k.caster, 0.5 + 0.12 * breath, { band: 0.022 + 0.012 * breath, alpha: (0.4 + 0.3 * breath) * a, glow: 0.3 + 0.3 * breath });
        measureFor(k, k.caster, 0.36, age, left, 0.75);
        if (!k.fast && ph > 0.5 && ph < 0.7) k.emit(k.local(k.caster, 0, 2.5, k.head().z - k.caster.z - 1.5), 6, { kind: 'smoke', colour: BREATH, size: 1.3, life: [0.6, 1], speed: [0.04, 0.1], up: [1, 2], heading: k.facingDir(k.caster), cone: 0.8, gravity: -2, drag: 0.4 });
      } },
    },
  },

  // Guardian’s Call (nova, on self, 5 tiles round, lasts 8 s): Every creature within 5 tiles of you that is hunting somebody turns on you and hunts only you for 8 s.
  // The sword thrust up: a ring of brass going out over the ground to exactly its reach, darts round its edge all
  // turned in at the Blade, and the sword raised over the Blade's head like a standard while they come.
  blade_guardians_call: {
    palette: PALETTE,
    cast: { timing: { secs: 1.3, release: 0.5 }, pose: guardiansCall },
    fx: {
      charge: (k, t) => {
        if (t > 0.34 && t < 0.56) smear(k, Math.max(0.32, t - 0.1), Math.min(t, 0.5), { alpha: 0.8 * (1 - seg(t, 0.5, 0.56)), inner: 0.5 });
        k.flare(k.weaponAt(bladeLen(k.caster)), 9, bump(t, 0.44, 0.52, 0.8), PALETTE.core, 0);
      },
      hit: (k) => {
        k.burst(k.at(k.caster, 0.05), 24, { kind: 'dust', colour: DUST, size: 3.2, life: [0.5, 0.9], speed: [CALL_REACH * 0.25, CALL_REACH * 0.5], up: [2, 6], gravity: 2, drag: 0.1 });
        k.burst(k.weaponAt(bladeLen(k.caster)), 7, { kind: 'mote', colour: [PALETTE.accent, '#fff4cc'], size: 1.6, life: [0.4, 0.8], speed: [0.2, 0.6], up: [4, 14], gravity: 0 });
        k.flash(0.06);
      },
      impact: { secs: 1.0, draw: (k, u) => {
        wave(k, k.caster, smooth(u / 0.7), CALL_REACH, 1, { ...BRASS, band: 0.22 });
        k.light(k.caster, CALL_REACH * 0.8, 0.7 * (1 - u));
      } },
      linger: { draw: (k, age, left) => {
        const a = smooth(age / 0.6) * smooth(left / 0.8);
        const b = k.caster;
        // The reach, faint, its edge dashed; and round it darts stepping in at the Blade.
        dashes(k, b, CALL_REACH, 0.06, a * 0.55, age * 0.05);
        // Two rings of darts at once, half a step apart, each closing in from the edge and fading as it comes.
        const n = k.fast ? 4 : 6;
        for (let w = 0; w < 2; w++) {
          const step = (age * 0.55 + w * 0.5) % 1;
          const rr = CALL_REACH * (1 - 0.45 * step);
          for (let i = 0; i < n; i++) {
            const ang = ((i + w * 0.5) / n) * TAU;
            const d = { x: -Math.cos(ang), y: -Math.sin(ang) };
            dart(k, { x: b.x - d.x * rr, y: b.y - d.y * rr }, d, 0.32, a * 0.85 * Math.sin(Math.PI * step));
          }
        }
        // The standard: a sword over the head.
        swordGlyph(k, k.at(b, 1.25 + 0.03 * Math.sin(age * 2)), 12, Math.PI, a, { brass: true });
        measureFor(k, b, 0.42, age, left);
      } },
    },
  },

  // Last Stand (buff, on self, lasts 10 s): Costs no stamina. Only below 25% of your health: for 10 s you take 60% less damage.
  // Down on a knee, then up: a ring of swords comes down point first into the ground all round the Blade -- a
  // palisade of steel to stand inside -- with a shock over the ground and a skin of steel flashing over the body
  // as it closes, standing for the ten seconds with the measure running out under it. The heaviest thing a Blade
  // wears.
  blade_last_stand: {
    palette: PALETTE,
    cast: { timing: { secs: 1.4, release: 0.55 }, pose: lastStand },
    fx: {
      charge: (k, t) => {
        // Down on the knee: the light drawn in close round the body, low.
        const g = bump(t, 0.2, 0.45, 0.56);
        if (g > 0.01) {
          k.ring(k.caster, 0.5 - 0.18 * g, { ...BRASS, band: 0.025 + 0.02 * g, alpha: g, turn: k.now * 0.6, dash: 4 });
          k.emit(k.at(k.caster, 0.05), 50 * g, { kind: 'ember', colour: [PALETTE.accent, '#fff4cc'], size: 1.5, life: [0.3, 0.6], speed: [0.05, 0.2], up: [6, 16], gravity: 0, jitter: 0.4 });
        }
        if (t > 0.46 && t < 0.62) smear(k, Math.max(0.44, t - 0.1), Math.min(t, 0.56), { alpha: 0.7 * (1 - seg(t, 0.55, 0.62)), brass: true });
      },
      hit: (k) => {
        clash(k, k.chest(), 30, undefined, 0, 1);
        k.burst(k.at(k.caster, 0.05), 20, { kind: 'dust', colour: DUST, size: 3.4, life: [0.5, 1], speed: [0.8, 1.6], up: [2, 8], gravity: 2, drag: 0.1 });
        k.flash(0.08, PALETTE.light);
      },
      impact: { secs: 0.8, draw: (k, u) => {
        wave(k, k.caster, u, 1.6, 0.75, { band: 0.07 });
        k.light(k.caster, 4, 0.9 * (1 - u));
      } },
      linger: { draw: (k, age, left) => {
        const a = smooth(left / 0.6);
        const b = k.caster;
        const n = k.fast ? 6 : 8, R = 0.36;
        // Each sword falls from over the head, one after another round the ring, and stands where it lands. Drawn as
        // two records rather than eight: the swords behind the Blade in one, under the body, and those in front in
        // another, over it, each lot nearest last.
        const L = 13, stand = (0.82 * L) / HEIGHT_SCALE, Rz = L * k.zoom, z = k.zoom;
        const by = k.sy(b);
        const back: number[] = [], front: number[] = [];
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * TAU + 0.2;
          const fall = smooth(seg(age, 0.03 * i, 0.03 * i + 0.16));
          if (fall <= 0) continue;
          const x = b.x + Math.cos(ang) * R, y = b.y + Math.sin(ang) * R;
          const p = k.on(x, y, stand + 26 * (1 - fall) * (1 - fall));
          const foot = k.on(x, y);
          // Leant a hair out from the middle, as swords stuck in the ground stand.
          const lean = ((k.sx(foot) - k.sx(b)) / (R * HALF_W * k.zoom * Math.SQRT2)) * 0.12;
          (k.sy(foot) < by ? back : front).push(k.sy(foot), k.sx(p), k.sy(p), lean, Math.min(1, fall * 3));
          if (fall >= 1 && !(k.state[`s${i}`] > 0)) {
            k.state[`s${i}`] = 1;
            k.burst(k.on(x, y, 0.5), 5, { kind: 'dust', colour: DUST, size: 2.4, life: [0.3, 0.6], speed: [0.1, 0.4], up: [2, 6], gravity: 3 });
            k.burst(k.on(x, y, 1), 4, { kind: 'spark', colour: [PALETTE.core, PALETTE.accent], size: 1.4, life: [0.15, 0.3], speed: [0.3, 0.8], up: [6, 16], gravity: 60 });
          }
        }
        const lot = (q: number[], bias: number): void => {
          if (!q.length) return;
          const order = Array.from({ length: q.length / 5 }, (_, j) => j).sort((u, v) => q[5 * u] - q[5 * v]);
          k.worldDraw(b, (g) => { for (const j of order) drawSword(g, q[5 * j + 1], q[5 * j + 2], Rz, q[5 * j + 3], a * q[5 * j + 4], z); }, bias);
        };
        lot(back, -0.5);
        lot(front, 0.8);
        k.glow(k.at(b, 0.3), 26, 0.3 * a);
        // A skin of steel over the body only as the ring slams shut: a shell is a lot of screen to fill every frame
        // for ten seconds, and the swords standing round say the rest.
        if (age < 0.6) k.shell(b, { size: 1.05 + 0.2 * (1 - smooth(age / 0.25)), sides: k.fast ? 8 : 10, alpha: 0.55 * (1 - smooth(age / 0.6)), glow: 0.4 });
        measureFor(k, b, 0.5, age, left);
        // A little light off the steel for the ten seconds, so the ring of swords stands in the dark.
        k.light(b, 1.8, 0.35 * a * smooth(age / 0.4));
        if (!k.fast) k.emit(k.at(b, 0.6), 6, { kind: 'mote', colour: [PALETTE.accent, PALETTE.core], size: 1.4, life: [0.6, 1.1], speed: [0.05, 0.12], up: [4, 10], gravity: 0, jitter: 0.2 });
      } },
    },
  },

};

/**
 * Two steel bands round a forearm running from `e` (elbow) to `w` (wrist), at its middle and toward the wrist:
 * each a short hoop square across the arm as the screen shows it, its near half drawn, so it wraps the arm
 * rather than lying on it. `bind` above one draws them wider than the arm, for the moment they are put on.
 */
function bracer(k: FxScene, e: P3, w: P3, alpha: number, bind = 1): void {
  if (alpha <= 0.01) return;
  const ang = Math.atan2(k.sy(w) - k.sy(e), k.sx(w) - k.sx(e));
  const R = 1.5 * k.zoom * bind;
  const at = [mid3(e, w, 0.42), mid3(e, w, 0.8)];
  const pts = at.map((p) => [k.sx(p), k.sy(p)]);
  k.worldDraw(at[0], (g) => {
    g.globalAlpha = clamp(alpha * Math.min(1, 2.2 - bind));
    for (const [x, y] of pts) {
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.lineWidth = 1.1 * k.zoom + Math.max(1, 0.9 * k.zoom);
      g.strokeStyle = PALETTE.ink;
      g.beginPath();
      g.ellipse(0, 0, R * 0.38, R, 0, -Math.PI / 2, Math.PI / 2);
      g.stroke();
      g.lineWidth = 1.1 * k.zoom;
      g.strokeStyle = PALETTE.main;
      g.stroke();
      g.lineWidth = Math.max(0.5, 0.45 * k.zoom);
      g.strokeStyle = PALETTE.core;
      g.beginPath();
      g.ellipse(0, 0, R * 0.38, R, 0, -Math.PI / 2, -0.2);
      g.stroke();
      g.restore();
    }
  }, 3);
  k.glow(at[0], 3.5, alpha * 0.35);
}

/**
 * `n` blades snapped short, side by side in the air over `p`, `r` pixels at zoom one each: a hilt and a stub of
 * blade ending in a jagged break, its lost point a little below. A creature's next blows, blunted -- one each.
 * All in one record, as they always sort together over the one head.
 */
function brokenBlades(k: FxScene, p: P3, n: number, r: number, alpha: number, age: number): void {
  if (alpha <= 0.01 || n <= 0) return;
  const x0 = k.sx(p), y0 = k.sy(p), R = r * k.zoom, gap = R * 0.95;
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'miter';
    g.lineWidth = Math.max(0.8, 0.7 * k.zoom);
    g.strokeStyle = PALETTE.ink;
    const w = R * 0.16;
    for (let i = 0; i < n; i++) {
      // Each bobbing a little on its own beat.
      const x = x0 + (i - (n - 1) / 2) * gap, y = y0 - Math.sin(age * 1.8 + i * 1.3) * R * 0.08;
      g.save();
      g.translate(x, y);
      // The stub, point down, broken on a slant.
      g.beginPath();
      g.moveTo(-w, -R * 0.2);
      g.lineTo(w, -R * 0.2);
      g.lineTo(w, R * 0.18);
      g.lineTo(0, R * 0.3);
      g.lineTo(-w * 0.3, R * 0.2);
      g.lineTo(-w, R * 0.34);
      g.closePath();
      // The lost point, apart below, in the same path.
      g.moveTo(-w, R * 0.5);
      g.lineTo(-w * 0.2, R * 0.42);
      g.lineTo(w, R * 0.48);
      g.lineTo(0, R * 0.86);
      g.closePath();
      g.fillStyle = PALETTE.main;
      g.fill();
      g.stroke();
      // The guard, brass, and the grip.
      g.fillStyle = PALETTE.accent;
      g.beginPath();
      g.rect(-R * 0.36, -R * 0.3, R * 0.72, R * 0.12);
      g.fill();
      g.stroke();
      g.fillStyle = PALETTE.deep;
      g.beginPath();
      g.rect(-w * 0.7, -R * 0.62, w * 1.4, R * 0.32);
      g.fill();
      g.stroke();
      g.restore();
    }
  }, 2);
  k.glow(p, r * 2.2, alpha * 0.3, PALETTE.accent);
}