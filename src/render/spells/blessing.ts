/**
 * Blessing's spells: how each is cast and what it looks like.
 *
 * The Blessing is the dawn, and every one of its fifteen spells is drawn in
 * the dawn's terms: gold and white light that comes down from above or rises
 * up, never thrown; rays fanned out from a heart of light (`rays`); bands of
 * light laid level round a body (`hoop`) that close on a wound, climb a body
 * or stand over a head as a halo; and a sun that rises over the ground it is
 * cast on. A cast is a prayer -- hands together, a hand on the heart, a knee
 * put down, palms turned up -- and never a blow.
 *
 * What each spell does is what it shows. A heal closes a band on the heart
 * and lifts the blood out of the wound as gold; Ward is one plate for the
 * one blow it turns; Renewal counts its heals off round the feet; Sanctuary
 * stands its posts on exactly the ring it holds and lets them burn down with
 * its seconds; Radiance's sun hangs over its reach and beats once a second.
 * Every reach, every count and every second is read off the spell's own
 * numbers (`k.fx`, `spellInfo`), never written here.
 *
 * This file is this group's alone; anything its spells share is written here,
 * not in the kit.
 */
import type { Euler, Rig } from '../figure';
import type { SpellVisual } from './index';
import { spellInfo } from './info';
import { TAU, arcAt, bump, channelsOf, clamp, easeBack, easeOut, flashOf, hashOf, lerp, mid3, seg, smooth, type FxScene, type P3, type SpellPalette } from './kit';
import { euler, one, type Key } from './poses';

/** Dawn: gold and white. */
export const PALETTE: SpellPalette = {
  core: '#fffbea',
  main: '#ffd86b',
  deep: '#d69a2e',
  accent: '#ffffff',
  ink: '#5a3b0e',
  light: '#ffe9a0',
};

/** What is drawn out of a wound: blood, which turns to gold as it leaves; venom, which burns away. */
const BLOOD = '#a8242b';
const VENOM = '#7f9a2e';
const VENOM_DEEP = '#43521c';
const VENOM_CORE = '#d3e98c';
const VENOM_INK = '#1f2810';
/** Green for what grows: the land, and the leaves of a creature tended. */
const LEAF = '#a8d25c';
const LEAF_DEEP = '#5a8a30';
const LEAF_INK = '#203a12';

/* ---- numbers ------------------------------------------------------------------------- */

/** Tiles round the spot a spell on the ground reaches, as the island casts it. */
const reachOf = (id: string, or: number): number => spellInfo(id)?.radius || or;
/** Seconds a spell lasts, as the island casts it. */
const lastsOf = (id: string, or: number): number => spellInfo(id)?.lasts ?? or;

const onSelf = (k: FxScene): boolean => k.target === k.caster;
const lift = (p: P3, dz: number): P3 => ({ x: p.x, y: p.y, z: p.z + dz });
/** Nought to one in, held, and one to nought out: a linger's strength by its age and what is left of it. */
const held = (age: number, left: number, inS = 0.4, outS = 1): number => smooth(age / inS) * smooth(left / outS);

/* ---- the dawn's shapes ------------------------------------------------------------- */

/**
 * Rays of light fanned round a point, in the picture's own plane, added as
 * light: the dawn's mark. Long and short by turns, `r` pixels at zoom one,
 * starting `inner` of the way out; `squash` flattens it to lie toward the ground.
 */
function rays(k: FxScene, p: P3, r: number, o: { n?: number; alpha?: number; turn?: number; inner?: number; width?: number; short?: number; squash?: number; colour?: string } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r <= 0.2) return;
  const n = o.n ?? 8, x = k.sx(p), y = k.sy(p), R = k.px(r), r0 = R * (o.inner ?? 0.3), w = o.width ?? 0.13;
  const sq = o.squash ?? 1, turn = o.turn ?? 0, short = o.short ?? 0.58, col = o.colour ?? k.pal.light;
  k.glowDraw((g) => {
    g.globalAlpha = clamp(a);
    g.fillStyle = col;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const an = turn + (i / n) * TAU, len = R * (i % 2 ? short : 1);
      g.moveTo(x + Math.cos(an - w) * r0, y + Math.sin(an - w) * r0 * sq);
      g.lineTo(x + Math.cos(an) * len, y + Math.sin(an) * len * sq);
      g.lineTo(x + Math.cos(an + w) * r0, y + Math.sin(an + w) * r0 * sq);
    }
    g.fill();
  });
}

interface HoopLook { alpha?: number; n?: number; turn?: number; main?: string; deep?: string; core?: string; ink?: string; glow?: number; dash?: number; back?: number; front?: number }
/**
 * A band of light level with the ground round a body standing at `c`: from a
 * circle `r0` tiles out at `c`'s height to one `r1` out `dz` height units
 * higher. A halo is a flat one narrowing inward, a hoop climbing a body a
 * straight one, a course of a dome one narrowing as it rises. Its far half is
 * drawn behind whatever stands at `c` and its near half in front, so whoever
 * is in it is inside it. Lit from the left as everything is.
 */
function hoop(k: FxScene, c: P3, r0: number, r1: number, dz: number, o: HoopLook = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || Math.max(r0, r1) <= 0.004) return;
  const n = o.n ?? (k.fast ? 10 : 16);
  const turn = o.turn ?? 0;
  const eye = k.eye;
  const ax: number[] = [], ay: number[] = [], bx: number[] = [], by: number[] = [];
  for (let i = 0; i < n; i++) {
    const an = turn + (i / n) * TAU, cs = Math.cos(an), sn = Math.sin(an);
    ax.push(eye.worldToScreenX(c.x + cs * r0, c.y + sn * r0));
    ay.push(eye.worldToScreenY(c.x + cs * r0, c.y + sn * r0, c.z));
    bx.push(eye.worldToScreenX(c.x + cs * r1, c.y + sn * r1));
    by.push(eye.worldToScreenY(c.x + cs * r1, c.y + sn * r1, c.z + dz));
  }
  const cx = k.sx(c), cy = k.sy(c);
  let rx = 1;
  for (let i = 0; i < n; i++) rx = Math.max(rx, Math.abs(ax[i] - cx), Math.abs(bx[i] - cx));
  // Each facet: which half it is in, and its tone -- the near left lit, the near right shaded, the far half dim.
  const tones: number[] = [];
  const near: boolean[] = [];
  const dash = o.dash ?? 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const front = ay[i] + ay[j] > 2 * cy - 0.01;
    near.push(front);
    const nx = (ax[i] + ax[j] - 2 * cx) / (2 * rx);
    tones.push(dash && i % dash === dash - 1 ? -1 : front ? (nx < -0.55 ? 0 : nx > 0.3 ? 2 : 1) : i % 2 ? 1 : 2);
  }
  const fills = [o.core ?? k.pal.core, o.main ?? k.pal.main, o.deep ?? k.pal.deep];
  const ink = o.ink ?? k.pal.ink;
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  const half = (front: boolean) => (g: CanvasRenderingContext2D): void => {
    g.globalAlpha = clamp(a * (front ? o.front ?? 1 : o.back ?? 0.5));
    for (let t = 0; t < 3; t++) {
      g.beginPath();
      let any = false;
      for (let i = 0; i < n; i++) {
        if (near[i] !== front || tones[i] !== t) continue;
        const j = (i + 1) % n;
        g.moveTo(ax[i], ay[i]);
        g.lineTo(ax[j], ay[j]);
        g.lineTo(bx[j], by[j]);
        g.lineTo(bx[i], by[i]);
        g.closePath();
        any = true;
      }
      if (!any) continue;
      g.fillStyle = fills[t];
      g.fill();
    }
    if (!front) return;
    g.globalAlpha = clamp(a);
    // The near edges inked, top and bottom, so a thin band still reads against a body.
    g.beginPath();
    for (let i = 0; i < n; i++) {
      if (!near[i] || tones[i] < 0) continue;
      const j = (i + 1) % n;
      g.moveTo(ax[i], ay[i]);
      g.lineTo(ax[j], ay[j]);
      g.moveTo(bx[i], by[i]);
      g.lineTo(bx[j], by[j]);
    }
    g.lineWidth = inkW;
    g.strokeStyle = ink;
    g.stroke();
  };
  const foot = { x: c.x, y: c.y, z: c.z };
  k.worldDraw(foot, half(false), -0.5);
  k.worldDraw(foot, half(true), 0.8);
  const gl = o.glow ?? 1;
  // One soft glow, no bigger than a body's: a glow the size of Benediction's halo costs a great deal to draw and shows nothing more.
  if (gl > 0) k.glow(lift(c, dz / 2), Math.min(28, (rx / k.zoom) * 1.3), a * gl * 0.45);
}

/**
 * A ward's plate: a round sun-disc stood on its edge, eight short rays round
 * its rim, turned `spin` about the upright so it narrows as it turns. `r`
 * pixels at zoom one.
 */
function plate(k: FxScene, p: P3, r: number, spin: number, a: number): void {
  if (a <= 0.01 || r <= 0.2) return;
  const x = k.sx(p), y = k.sy(p), R = k.px(r);
  const sq = 0.28 + 0.72 * Math.abs(Math.cos(spin));
  const { core, main, deep, ink } = k.pal;
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    // The rays first, behind the disc.
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const an = (i / 8) * TAU + Math.PI / 8;
      g.moveTo(x + Math.cos(an - 0.2) * R * 0.85 * sq, y + Math.sin(an - 0.2) * R * 0.85);
      g.lineTo(x + Math.cos(an) * R * 1.5 * sq, y + Math.sin(an) * R * 1.5);
      g.lineTo(x + Math.cos(an + 0.2) * R * 0.85 * sq, y + Math.sin(an + 0.2) * R * 0.85);
    }
    g.fillStyle = deep;
    g.fill();
    g.lineWidth = inkW;
    g.strokeStyle = ink;
    g.stroke();
    // The disc: facets toward a heart up and to the left, lit there and shaded down and right.
    const hx = x - R * 0.2 * sq, hy = y - R * 0.22;
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * TAU, a1 = ((i + 1) / 8) * TAU, m = (a0 + a1) / 2;
      const lit = -0.6 * Math.cos(m) - 0.8 * Math.sin(m);
      g.fillStyle = lit > 0.35 ? core : lit > -0.3 ? main : deep;
      g.beginPath();
      g.moveTo(hx, hy);
      g.lineTo(x + Math.cos(a0) * R * sq, y + Math.sin(a0) * R);
      g.lineTo(x + Math.cos(a1) * R * sq, y + Math.sin(a1) * R);
      g.closePath();
      g.fill();
    }
    g.beginPath();
    for (let i = 0; i <= 8; i++) {
      const an = (i / 8) * TAU;
      if (i === 0) g.moveTo(x + Math.cos(an) * R * sq, y + Math.sin(an) * R);
      else g.lineTo(x + Math.cos(an) * R * sq, y + Math.sin(an) * R);
    }
    g.stroke();
    // A boss in the middle of it.
    g.fillStyle = core;
    g.beginPath();
    g.moveTo(x, y - R * 0.38);
    g.lineTo(x + R * 0.22 * sq, y);
    g.lineTo(x, y + R * 0.38);
    g.lineTo(x - R * 0.22 * sq, y);
    g.closePath();
    g.fill();
    g.stroke();
    g.lineJoin = 'round';
  }, 1.5);
  k.glow(p, r * 2.6, a * 0.55);
}

/**
 * The sun itself, hung in the air: a twelve-sided disc lit from the upper
 * left, a crown of twelve inked rays round it, long and short by turns and
 * turning slowly. `r` pixels at zoom one, the disc's radius.
 */
function sun(k: FxScene, p: P3, r: number, turn: number, a: number): void {
  if (a <= 0.01 || r <= 0.3) return;
  const x = k.sx(p), y = k.sy(p), R = k.px(r);
  const { core, main, deep, ink } = k.pal;
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  const sides = k.fast ? 8 : 12;
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    g.lineWidth = inkW;
    g.strokeStyle = ink;
    for (const lit of [true, false]) {
      g.beginPath();
      for (let i = 0; i < 12; i++) {
        const an = turn + (i / 12) * TAU;
        if ((-0.6 * Math.cos(an) - 0.8 * Math.sin(an) > -0.2) !== lit) continue;
        const len = R * (i % 2 ? 1.5 : 1.95);
        g.moveTo(x + Math.cos(an - 0.17) * R * 0.9, y + Math.sin(an - 0.17) * R * 0.9);
        g.lineTo(x + Math.cos(an) * len, y + Math.sin(an) * len);
        g.lineTo(x + Math.cos(an + 0.17) * R * 0.9, y + Math.sin(an + 0.17) * R * 0.9);
      }
      g.fillStyle = lit ? main : deep;
      g.fill();
      g.stroke();
    }
    const hx = x - R * 0.25, hy = y - R * 0.28;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * TAU, a1 = ((i + 1) / sides) * TAU, m = (a0 + a1) / 2;
      const lit = -0.6 * Math.cos(m) - 0.8 * Math.sin(m);
      g.fillStyle = lit > 0.3 ? core : lit > -0.4 ? main : deep;
      g.beginPath();
      g.moveTo(hx, hy);
      g.lineTo(x + Math.cos(a0) * R, y + Math.sin(a0) * R);
      g.lineTo(x + Math.cos(a1) * R, y + Math.sin(a1) * R);
      g.closePath();
      g.fill();
    }
    g.beginPath();
    for (let i = 0; i <= sides; i++) {
      const an = (i / sides) * TAU;
      if (i === 0) g.moveTo(x + Math.cos(an) * R, y + Math.sin(an) * R);
      else g.lineTo(x + Math.cos(an) * R, y + Math.sin(an) * R);
    }
    g.stroke();
    g.lineJoin = 'round';
  });
  k.glow(p, r * 4, a * 0.7);
}

/**
 * A shaft of light let down from the sky onto a point, fading out as it goes
 * up, `w` pixels at zoom one wide at its foot. Laid over the picture rather
 * than added to it, so it is the light's own cream on any ground and not the
 * ground's colour brightened; the night is cut by `light` instead.
 */
function shaft(k: FxScene, foot: P3, h: number, w: number, a: number, colour = k.pal.light): void {
  if (a <= 0.01) return;
  const x = k.sx(foot), y = k.sy(foot), top = y - k.hpx(h), W = k.px(w), ch = channelsOf(colour);
  k.glowDraw((g) => {
    const grad = g.createLinearGradient(0, top, 0, y);
    grad.addColorStop(0, `rgba(${ch},0)`);
    grad.addColorStop(0.55, `rgba(${ch},0.32)`);
    grad.addColorStop(1, `rgba(${ch},0.85)`);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = clamp(a * 0.75);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x - W * 1.7, top);
    g.lineTo(x + W * 1.7, top);
    g.lineTo(x + W, y);
    g.lineTo(x - W, y);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(x - W * 0.5, top);
    g.lineTo(x + W * 0.5, top);
    g.lineTo(x + W * 0.3, y);
    g.lineTo(x - W * 0.3, y);
    g.closePath();
    g.fill();
    g.globalCompositeOperation = 'lighter';
  });
}

/** Rays laid on the ground out from a spot, from `r0` to `r1` tiles: sunlight across the land. Added to the ground's own colour, as light on it. */
function groundRays(k: FxScene, c: P3, r0: number, r1: number, n: number, o: { alpha?: number; turn?: number; spread?: number; colour?: string } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r1 <= r0 + 0.05) return;
  const turn = o.turn ?? 0, w = o.spread ?? 0.07;
  const eye = k.eye;
  const path = new Path2D();
  const at = (an: number, r: number): [number, number] => {
    const x = c.x + Math.cos(an) * r, y = c.y + Math.sin(an) * r;
    return [eye.worldToScreenX(x, y), eye.worldToScreenY(x, y, k.ground(x, y) + 0.12)];
  };
  for (let i = 0; i < n; i++) {
    const an = turn + (i / n) * TAU, len = i % 2 ? lerp(r0, r1, 0.62) : r1;
    const [lx, ly] = at(an - w, r0), [tx, ty] = at(an, len), [rx, ry] = at(an + w, r0);
    path.moveTo(lx, ly);
    path.lineTo(tx, ty);
    path.lineTo(rx, ry);
    path.closePath();
  }
  const col = o.colour ?? k.pal.deep;
  k.groundDraw(c.x, c.y, r1 + 0.5, (g) => {
    g.globalAlpha = clamp(a);
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = col;
    g.fill(path);
    g.globalCompositeOperation = 'source-over';
  });
}

/** Out of a wound: drops of blood lifted out of it that turn to gold as they rise. What every heal that stops bleeding shows. */
function mend(k: FxScene, at: P3, n: number): void {
  k.burst(at, n, { kind: 'drop', colour: BLOOD, fade: k.pal.main, size: 2.3, sizeEnd: 1.2, life: [0.7, 1.1], speed: [0.04, 0.22], up: [10, 20], gravity: 6, drag: 0.3, jitter: 0.05, jitterZ: 2, bias: 3 });
  k.burst(at, Math.round(n * 0.8), { kind: 'mote', size: 1.8, life: [0.6, 1.1], speed: [0.03, 0.15], up: [8, 18], gravity: 0, jitter: 0.08, jitterZ: 3 });
}

/** Light rising off someone: the dawn's gold motes going up, `perSecond`. */
const rising = (k: FxScene, at: P3, perSecond: number, spread = 0.12, size = 1.6): void =>
  k.emit(at, perSecond, { kind: 'mote', size, life: [0.6, 1.2], speed: [0.01, 0.06], up: [8, 16], gravity: 0, jitter: spread, jitterZ: 2 });

/** Where a spell meets a body: the middle of a creature, the chest of a person. */
const heartOf = (k: FxScene, b = k.target): P3 => k.heart(b);

/**
 * A sun half risen over a line of horizon, with rays over it: a creature's
 * hunt set to rest, over its head. `rise` nought to one, how far up its
 * horizon it stands.
 */
function sunMark(k: FxScene, p: P3, r: number, a: number, rise = 1): void {
  if (a <= 0.01) return;
  const x = k.sx(p), y = k.sy(p), R = k.px(r);
  const { core, main, deep, ink } = k.pal;
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  const up = R * (0.15 + 0.85 * rise);
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    // Five short rays over it.
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const an = Math.PI + ((i + 0.5) / 5) * Math.PI;
      const ox = x, oy = y + R - up;
      g.moveTo(ox + Math.cos(an - 0.16) * R * 1.12, oy + Math.sin(an - 0.16) * R * 1.12);
      g.lineTo(ox + Math.cos(an) * R * (i % 2 ? 1.5 : 1.75), oy + Math.sin(an) * R * (i % 2 ? 1.5 : 1.75));
      g.lineTo(ox + Math.cos(an + 0.16) * R * 1.12, oy + Math.sin(an + 0.16) * R * 1.12);
    }
    g.fillStyle = main;
    g.fill();
    g.lineWidth = inkW;
    g.strokeStyle = ink;
    g.stroke();
    // The half sun, cut off by its horizon.
    g.save();
    g.beginPath();
    g.rect(x - R * 2, y - R * 3, R * 4, R * 3 + R * 0.02);
    g.clip();
    const oy = y + R - up;
    for (let i = 0; i < 6; i++) {
      const a0 = Math.PI + (i / 6) * Math.PI, a1 = Math.PI + ((i + 1) / 6) * Math.PI;
      g.fillStyle = i < 2 ? core : i < 4 ? main : deep;
      g.beginPath();
      g.moveTo(x, oy);
      g.lineTo(x + Math.cos(a0) * R, oy + Math.sin(a0) * R);
      g.lineTo(x + Math.cos(a1) * R, oy + Math.sin(a1) * R);
      g.closePath();
      g.fill();
    }
    g.beginPath();
    g.arc(x, oy, R, Math.PI, TAU);
    g.stroke();
    g.restore();
    // The horizon.
    g.lineWidth = Math.max(1.2, 1.1 * k.zoom);
    g.strokeStyle = ink;
    g.beginPath();
    g.moveTo(x - R * 1.5, y);
    g.lineTo(x + R * 1.5, y);
    g.stroke();
    g.lineWidth = Math.max(0.6, 0.5 * k.zoom);
    g.strokeStyle = core;
    g.beginPath();
    g.moveTo(x - R * 1.3, y - 0.5);
    g.lineTo(x + R * 1.3, y - 0.5);
    g.stroke();
    g.lineJoin = 'round';
  }, 2);
  k.glow(lift(p, 1), r * 2.4, a * 0.45);
}

/** Two rings through each other, over a creature: a bond between it and whoever cast at it. `r` pixels at zoom one. */
function knot(k: FxScene, p: P3, r: number, a: number, turn: number): void {
  if (a <= 0.01) return;
  const x = k.sx(p), y = k.sy(p), R = k.px(r);
  const sq = 0.55 + 0.45 * Math.abs(Math.cos(turn));
  const { core, main, ink } = k.pal;
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    for (const pass of [0, 1, 2]) {
      g.lineWidth = pass === 0 ? Math.max(2.2, 2.2 * k.zoom) : pass === 1 ? Math.max(1.3, 1.3 * k.zoom) : Math.max(0.6, 0.5 * k.zoom);
      g.strokeStyle = pass === 0 ? ink : pass === 1 ? main : core;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.ellipse(x + s * R * 0.45 * sq, y, R * 0.7 * sq, R * 0.7, 0, 0, TAU);
        g.stroke();
      }
    }
  }, 2);
  k.glow(p, r * 2.2, a * 0.5);
}

/**
 * A post of light stood on the ground: a thin four-sided spire, inked, its
 * left face lit and its right shaded, with a glint at its tip. `h` height
 * units, `w` pixels at zoom one across.
 */
function post(k: FxScene, base: P3, h: number, w: number, a: number): void {
  if (a <= 0.01 || h <= 0.3) return;
  const x = k.sx(base), y = k.sy(base), H = k.hpx(h), W = k.px(w);
  const { core, main, deep, ink } = k.pal;
  k.worldDraw(base, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    g.fillStyle = core;
    g.beginPath();
    g.moveTo(x, y - H);
    g.lineTo(x - W, y - H * 0.12);
    g.lineTo(x, y + W * 0.3);
    g.closePath();
    g.fill();
    g.fillStyle = deep;
    g.beginPath();
    g.moveTo(x, y - H);
    g.lineTo(x, y + W * 0.3);
    g.lineTo(x + W, y - H * 0.12);
    g.closePath();
    g.fill();
    g.fillStyle = main;
    g.beginPath();
    g.moveTo(x, y - H);
    g.lineTo(x - W * 0.35, y - H * 0.3);
    g.lineTo(x, y - H * 0.08);
    g.closePath();
    g.fill();
    g.lineWidth = Math.max(0.8, 0.7 * k.zoom);
    g.strokeStyle = ink;
    g.beginPath();
    g.moveTo(x, y - H);
    g.lineTo(x - W, y - H * 0.12);
    g.lineTo(x, y + W * 0.3);
    g.lineTo(x + W, y - H * 0.12);
    g.closePath();
    g.stroke();
    g.lineJoin = 'round';
  });
}

/** A sprout: three blades and a gold bud, `h` height units tall, out of the ground at `base`. */
function sprout(k: FxScene, base: P3, h: number, a: number, lean: number): void {
  if (a <= 0.01 || h <= 0.3) return;
  const x = k.sx(base), y = k.sy(base), H = k.hpx(h), W = k.px(2.2);
  const bud = k.pal.main, budInk = k.pal.ink;
  k.worldDraw(base, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    g.lineWidth = Math.max(0.7, 0.6 * k.zoom);
    g.strokeStyle = LEAF_INK;
    const blade = (dx: number, tall: number, fill: string): void => {
      g.fillStyle = fill;
      g.beginPath();
      g.moveTo(x - W * 0.6 + dx * 0.2, y);
      g.lineTo(x + dx + lean * H * 0.2, y - tall);
      g.lineTo(x + W * 0.6 + dx * 0.2, y);
      g.closePath();
      g.fill();
      g.stroke();
    };
    blade(-W * 2.2, H * 0.62, LEAF_DEEP);
    blade(W * 2.2, H * 0.7, LEAF_DEEP);
    blade(0, H, LEAF);
    const bx = x + lean * H * 0.2, by = y - H;
    g.fillStyle = bud;
    g.beginPath();
    g.moveTo(bx, by - W * 1.3);
    g.lineTo(bx + W * 0.9, by);
    g.lineTo(bx, by + W * 0.7);
    g.lineTo(bx - W * 0.9, by);
    g.closePath();
    g.fill();
    g.strokeStyle = budInk;
    g.stroke();
    g.lineJoin = 'round';
  });
  k.glow(lift(base, h), 4, a * 0.6);
}

/**
 * Wings of light opened behind somebody, in the picture's own plane: six
 * feathers a side fanned from the shoulders, `open` nought (folded up behind
 * the head) to one (spread). Drawn behind the body.
 */
function wings(k: FxScene, b: P3, at: P3, span: number, open: number, a: number): void {
  if (a <= 0.01 || open <= 0.01) return;
  const x = k.sx(at), y = k.sy(at), L = k.px(span);
  const { core, main, deep, ink } = k.pal;
  k.worldDraw(b, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    g.lineWidth = Math.max(0.8, 0.7 * k.zoom);
    g.strokeStyle = ink;
    for (const s of [-1, 1]) {
      for (let j = 5; j >= 0; j--) {
        // Folded, every feather stands up behind the head; open, they fan from up and out to out and down.
        const th = (0.18 + open * (0.25 + j * 0.27)) * s;
        const len = L * (1 - j * 0.11) * (0.55 + 0.45 * open);
        const rx = x + s * L * 0.08, ry = y - L * 0.04 * j;
        const dx = Math.sin(th), dy = -Math.cos(th);
        const nx = -dy, ny = dx;
        const wd = len * 0.13;
        g.fillStyle = j % 2 ? main : j === 0 ? core : deep;
        g.beginPath();
        g.moveTo(rx + nx * wd * 0.4, ry + ny * wd * 0.4);
        g.lineTo(rx + dx * len * 0.55 + nx * wd, ry + dy * len * 0.55 + ny * wd);
        g.lineTo(rx + dx * len, ry + dy * len);
        g.lineTo(rx + dx * len * 0.5 - nx * wd * 0.6, ry + dy * len * 0.5 - ny * wd * 0.6);
        g.lineTo(rx - nx * wd * 0.4, ry - ny * wd * 0.4);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }
    g.lineJoin = 'round';
  }, -0.6);
  k.glow(at, span * 0.9, a * 0.4 * open);
}

/* ---- the poses ----------------------------------------------------------------------- */

type E = Euler;
const REST: E = [8, 10, 0];
const STAND: E = [2, 2, 0];
/** Hands pressed together before the chest, the heels of them at the breastbone. */
const PALMS: E = [34, -10, 50];
const PALMS_BEND = 104;
/** A hand laid flat on the heart. */
const ON_HEART: E = [24, 4, 52];
const ON_HEART_BEND = 100;
/** Both forearms crossed over the chest, each hand at the other shoulder. */
const CROSSED: E = [26, 2, 62];
const CROSSED_BEND = 104;

/** Both arms, mirrored: the same keys for each. */
function both(r: Rig, t: number, arm: readonly Key[], elbow: ReadonlyArray<readonly [number, number]>): void {
  r.arm[0] = euler(t, arm);
  r.arm[1] = euler(t, arm);
  r.elbow[0] = r.elbow[1] = one(t, elbow);
}

/**
 * Down on one knee, `w` of the way: the left foot planted ahead with its
 * thigh level, the right knee put down under the hip. The body is stood on
 * its lowest sole, so it goes down as the legs fold.
 */
function kneel(r: Rig, w: number): void {
  if (w <= 0) return;
  const l0 = r.leg[0], l1 = r.leg[1];
  r.leg[0] = [lerp(l0[0], 84, w), lerp(l0[1], 6, w), lerp(l0[2], 4, w)];
  r.knee[0] = lerp(r.knee[0], 92, w);
  r.leg[1] = [lerp(l1[0], -10, w), lerp(l1[1], 4, w), lerp(l1[2], 0, w)];
  r.knee[1] = lerp(r.knee[1], 104, w);
  r.flat[1] = w < 0.5;
  r.foot[1] = lerp(r.foot[1], -30, w);
}

/** Feet a little apart and the knees easy, giving by `dip` degrees: a body standing to pray, not stiff. */
function stance(r: Rig, t: number, dip: ReadonlyArray<readonly [number, number]>, step: ReadonlyArray<readonly [number, number]> = [[0, 0]]): void {
  const d = one(t, dip), s = one(t, step);
  r.leg[0] = [STAND[0] + d * 0.5 + s, 3, 0];
  r.leg[1] = [STAND[0] + d * 0.5 - s * 0.6, 3, 0];
  r.knee[0] = 4 + d + s * 0.6;
  r.knee[1] = 4 + d;
}

/* ---- the record ---------------------------------------------------------------------- */

export const BLESSING: Record<string, SpellVisual> = {
  /*
   * Soothe: one hand on the heart and the other laid out over them, smoothing
   * down; a breath of light goes to them, a band of gold closes on the heart
   * and the blood of the worst wound is lifted out of it as gold.
   */
  blessing_soothe: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.1, release: 0.5 },
      pose: (r, t) => {
        r.arm[0] = euler(t, [[0, REST], [0.22, ON_HEART], [0.8, ON_HEART], [1, REST]]);
        r.elbow[0] = one(t, [[0, 16], [0.22, ON_HEART_BEND], [0.8, ON_HEART_BEND - 4], [1, 16]]);
        r.arm[1] = euler(t, [[0, REST], [0.22, [60, 14, -10]], [0.38, [88, 10, -6]], [0.5, [58, 8, -4]], [0.68, [54, 8, -2]], [1, REST]]);
        r.elbow[1] = one(t, [[0, 16], [0.22, 44], [0.38, 24], [0.5, 12], [0.68, 16], [1, 16]]);
        r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.38, [-8, 0, 0]], [0.5, [-34, 0, 0]], [0.68, [-26, 0, 0]], [1, [0, 0, 0]]]);
        r.open = [t > 0.05, t > 0.05];
        r.spine = euler(t, [[0, [0, 0, 0]], [0.38, [2, 0, 0]], [0.5, [-8, 0, 0]], [0.7, [-6, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.38, [2, 0, 6]], [0.5, [-4, 0, -2]], [1, [0, 0, 0]]]);
        r.head = euler(t, [[0, [0, 0, 0]], [0.22, [-14, 6, 0]], [0.38, [-6, 4, 0]], [0.5, [-14, 6, 0]], [0.75, [-12, 6, 0]], [1, [0, 0, 0]]]);
        stance(r, t, [[0, 0], [0.38, 4], [0.5, 12], [0.75, 10], [1, 0]], [[0, 0], [0.5, 10], [0.8, 8], [1, 0]]);
      },
    },
    fx: {
      charge: (k, t) => {
        k.glow(k.hand(0), 5, 0.7 * bump(t, 0.1, 0.45, 0.9));
        const g = bump(t, 0.18, 0.48, 0.64);
        const h = k.hand(1);
        k.glow(h, 6, 0.8 * g);
        if (g > 0.15) k.emit(h, 20 * g, { kind: 'mote', size: 1.4, life: [0.3, 0.6], speed: [0.02, 0.08], up: [-8, -2], gravity: 0, jitter: 0.03 });
      },
      release: (k) => k.burst(k.hand(1), 6, { kind: 'mote', size: 1.6, life: [0.3, 0.6], speed: [0.1, 0.3], up: [0, 6], gravity: 0, heading: k.toward(k.caster, k.target), cone: 1.2 }),
      travel: {
        secs: (tiles) => (tiles < 0.3 ? 0 : 0.22 + tiles * 0.07),
        draw: (k, u) => {
          // A breath of light, slower than anything thrown, swaying as it goes and settling on them.
          const from = k.hand(1), to = heartOf(k);
          const pts: P3[] = [];
          for (let i = 6; i >= 0; i--) {
            const v = clamp(u - i * 0.05);
            const p = arcAt(from, to, smooth(v), 3 + k.dist * 1.2);
            pts.push(lift(p, Math.sin(v * 9 + 1) * 1.4 * (1 - v)));
          }
          const head = pts[pts.length - 1];
          k.ribbon(pts, { width: 3, taper: 'start', alpha: 0.85 });
          k.orb(head, 1.9, { turn: k.now * 4 });
          k.light(head, 1.5, 0.4);
        },
      },
      hit: (k) => mend(k, heartOf(k), 7),
      impact: {
        secs: 0.9,
        draw: (k, u) => {
          const b = k.target, c = heartOf(k);
          // The wound closing: a band round the heart drawn in tight, and a glint where it shuts.
          const close = smooth(seg(u, 0, 0.55));
          const r = lerp(0.17, 0.045, close);
          hoop(k, { x: b.x, y: b.y, z: c.z - 0.8 }, r, r * 0.92, 1.6, { alpha: 0.95 * (1 - seg(u, 0.55, 0.72)), turn: u * 2 });
          k.flare(c, 10 * bump(u, 0.5, 0.58, 0.95), 1, k.pal.core, 0.4);
          k.light(b, 2, 0.5 * (1 - u));
          rising(k, k.at(b, 0.3), 18 * (1 - u));
        },
      },
    },
  },

  /*
   * Ward: hands together, then the right raised in blessing to draw a sun in
   * the air and set it on them. One plate for the one blow it turns, going
   * slowly round them for as long as it waits.
   */
  blessing_ward: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.0, release: 0.55 },
      pose: (r, t) => {
        r.arm[0] = euler(t, [[0, REST], [0.2, PALMS], [0.3, PALMS], [0.45, ON_HEART], [0.82, ON_HEART], [1, REST]]);
        r.elbow[0] = one(t, [[0, 16], [0.2, PALMS_BEND], [0.45, ON_HEART_BEND], [0.82, ON_HEART_BEND], [1, 16]]);
        // The blessing hand: up beside the face, palm out, round the circle it draws, and set forward.
        r.arm[1] = euler(t, [[0, REST], [0.2, PALMS], [0.3, PALMS], [0.38, [100, 18, -6]], [0.46, [112, 10, -6]], [0.56, [92, 6, -4]], [0.78, [88, 8, -4]], [1, REST]]);
        r.elbow[1] = one(t, [[0, 16], [0.2, PALMS_BEND], [0.3, PALMS_BEND], [0.38, 74], [0.46, 52], [0.56, 14], [0.78, 18], [1, 16]]);
        r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.38, [40, 0, 0]], [0.56, [50, 0, 0]], [0.8, [36, 0, 0]], [1, [0, 0, 0]]]);
        r.open = [t > 0.05, t > 0.05];
        r.head = euler(t, [[0, [0, 0, 0]], [0.2, [-14, 0, 0]], [0.3, [-16, 0, 0]], [0.44, [4, 0, 0]], [0.56, [-4, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [-4, 0, 0]], [0.44, [6, 0, 10]], [0.56, [-4, 0, -4]], [1, [0, 0, 0]]]);
        r.spine = euler(t, [[0, [0, 0, 0]], [0.44, [3, 0, 0]], [0.56, [-6, 0, 0]], [1, [0, 0, 0]]]);
        stance(r, t, [[0, 0], [0.3, 8], [0.44, 2], [0.56, 10], [1, 0]], [[0, 0], [0.56, 12], [0.8, 10], [1, 0]]);
      },
    },
    fx: {
      charge: (k, t) => {
        // Light drawn in to the raised palm from all round, turning, and a sun-plate made of it there.
        const palm = wardPalm(k);
        const draw = seg(t, 0.28, 0.5);
        if (draw > 0 && draw < 1) rays(k, palm, lerp(16, 4, smooth(draw)), { n: 10, alpha: 0.85 * bump(draw, 0, 0.3, 1), turn: draw * 2.4, inner: 0.55 });
        const made = seg(t, 0.42, 0.52);
        plate(k, palm, 3.4 * easeBack(made), Math.sin(k.now * 3) * 0.3, smooth(made * 2) * (1 - seg(t, 0.55, 0.57)));
        k.glow(palm, 6, 0.7 * bump(t, 0.3, 0.5, 0.62));
        k.light(palm, 1.5, 0.4 * bump(t, 0.3, 0.5, 0.62));
      },
      release: (k) => {
        // Where it was set off from, so its flight starts there whatever the hand does next.
        const p = wardPalm(k);
        k.state.x = p.x;
        k.state.y = p.y;
        k.state.z = p.z;
      },
      travel: {
        secs: (tiles) => (tiles < 0.3 ? 0 : 0.16 + tiles * 0.06),
        draw: (k, u) => {
          const from = wardFrom(k), to = heartOf(k);
          const p = arcAt(from, to, smooth(u), 2 + k.dist * 0.6);
          plate(k, p, 3.4 - 0.6 * u, u * TAU * 1.5, 1);
          k.emit(p, 30, { kind: 'mote', size: 1.4, life: [0.2, 0.45], speed: [0.02, 0.08], up: [-2, 4], gravity: 0, jitter: 0.03 });
        },
      },
      hit: (k) => {
        k.burst(heartOf(k), 14, { kind: 'spark', size: 1.6, life: [0.2, 0.45], speed: [0.5, 1.2], up: [0, 16], gravity: 30, drag: 0.1 });
      },
      impact: {
        secs: 0.5,
        draw: (k, u) => {
          k.flare(heartOf(k), 9 * flashOf(u), 1, k.pal.core, 0.3);
          k.light(k.target, 2, 0.5 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          // The plate goes slowly round them at the chest, turned to face out, until the blow it waits for.
          const b = k.target;
          const a = held(age, left, 0.2, 1);
          const an = age * (TAU / 3.4) + 0.6;
          const orbit = { x: b.x + Math.cos(an) * 0.15, y: b.y + Math.sin(an) * 0.15, z: b.z + b.tall * 0.56 + Math.sin(age * 2.1) * 0.6 };
          const from = onSelf(k) ? wardFrom(k) : heartOf(k);
          const p = mid3(from, orbit, smooth(age / 0.4));
          plate(k, p, 2.7 * (1 + 0.25 * flashOf(clamp(age / 0.5))), an + Math.PI / 2, 0.9 * a);
        },
      },
    },
  },

  /*
   * Tend: crouched low to it with a hand out flat, stroking along its back; a
   * warm current runs low over the ground with leaves in it, a band closes
   * round its middle and the blood comes out of it as gold.
   */
  blessing_tend: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.3, release: 0.55 },
      pose: (r, t) => {
        const crouch = one(t, [[0, 0], [0.28, 1], [0.78, 1], [1, 0]]);
        r.leg[0] = [lerp(STAND[0], 80, crouch), lerp(2, 8, crouch), 0];
        r.leg[1] = [lerp(STAND[0], 40, crouch), lerp(2, 8, crouch), 0];
        r.knee[0] = lerp(4, 110, crouch);
        r.knee[1] = lerp(4, 100, crouch);
        r.spine = euler(t, [[0, [0, 0, 0]], [0.28, [-28, 0, 0]], [0.45, [-34, 0, 0]], [0.6, [-28, 0, 0]], [0.78, [-26, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.28, [-6, 0, 8]], [0.6, [-4, 0, 4]], [1, [0, 0, 0]]]);
        r.head = euler(t, [[0, [0, 0, 0]], [0.28, [6, 0, 0]], [0.45, [12, 0, -4]], [0.7, [10, 0, -4]], [1, [0, 0, 0]]]);
        // The right hand out low and flat, then drawn along as a hand strokes a beast's back.
        r.arm[1] = euler(t, [[0, REST], [0.28, [54, 8, -6]], [0.45, [66, 6, -6]], [0.6, [42, 8, -2]], [0.78, [38, 8, 0]], [1, REST]]);
        r.elbow[1] = one(t, [[0, 16], [0.28, 24], [0.45, 10], [0.6, 14], [0.78, 18], [1, 16]]);
        r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.45, [20, 0, 0]], [0.6, [-6, 0, 0]], [1, [0, 0, 0]]]);
        // The left hand on the knee, bearing the weight.
        r.arm[0] = euler(t, [[0, REST], [0.28, [40, 8, 16]], [0.78, [40, 8, 16]], [1, REST]]);
        r.elbow[0] = one(t, [[0, 16], [0.28, 46], [0.78, 46], [1, 16]]);
        r.open = [t > 0.05, t > 0.05];
      },
    },
    fx: {
      charge: (k, t) => {
        const g = bump(t, 0.2, 0.5, 0.62);
        const h = k.hand(1);
        k.glow(h, 6, 0.75 * g);
        if (g > 0.1) k.emit(h, 16 * g, { kind: 'shard', colour: [LEAF, LEAF_DEEP], size: 1.6, life: [0.4, 0.7], speed: [0.1, 0.25], up: [-2, 4], heading: k.toward(k.caster, k.target), cone: 0.9, gravity: 6, drag: 0.4, spin: 1 });
      },
      travel: {
        secs: (tiles) => 0.25 + tiles * 0.08,
        draw: (k, u) => {
          // A warm current along the ground, ankle high, with leaves in it.
          const from = k.on(k.caster.x, k.caster.y, 2), to = k.at(k.target, 0.25);
          const pts: P3[] = [];
          for (let i = 7; i >= 0; i--) {
            const v = clamp(u - i * 0.045);
            const p = mid3(from, to, v);
            pts.push(lift(p, 1 + Math.sin(v * 14 - k.now * 3) * 0.8));
          }
          const head = pts[pts.length - 1];
          k.ribbon(pts, { width: 3.2, taper: 'start', alpha: 0.9 });
          k.orb(head, 1.8, { turn: k.now * 3 });
          k.emit(head, 26, { kind: 'shard', colour: [LEAF, k.pal.main], size: 2.2, life: [0.35, 0.7], speed: [0.05, 0.2], up: [4, 10], gravity: 10, drag: 0.4, spin: 1.2 });
          k.light(head, 1.6, 0.4);
        },
      },
      hit: (k) => {
        mend(k, heartOf(k), 10);
        k.burst(k.at(k.target, 0.4), 12, { kind: 'shard', colour: [LEAF, k.pal.main], size: 2.4, life: [0.6, 1.0], speed: [0.2, 0.5], up: [6, 16], gravity: 14, drag: 0.4, spin: 1.2 });
      },
      impact: {
        secs: 1.1,
        draw: (k, u) => {
          const b = k.target;
          const close = smooth(seg(u, 0, 0.55));
          const r = lerp(0.28, 0.13, close);
          hoop(k, k.at(b, 0.3), r, r, 2.2, { alpha: 0.95 * (1 - seg(u, 0.55, 0.75)), turn: -u * 1.6 });
          k.flare(heartOf(k), 11 * bump(u, 0.5, 0.58, 0.95), 1, k.pal.core, 0.4);
          k.light(b, 2.4, 0.55 * (1 - u));
          rising(k, k.at(b, 0.3), 16 * (1 - u), 0.2);
        },
      },
    },
  },

  /*
   * Purify: both hands held over them, then closed and hauled up as if
   * drawing out a thread; the venom comes up out of them in a green twist,
   * gathers over their head and is burnt away in gold, and a band of light
   * washes down them, head to foot.
   */
  blessing_purify: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.5, release: 0.6 },
      pose: (r, t) => {
        both(r, t, [[0, REST], [0.24, [84, 10, 8]], [0.36, [88, 8, 8]], [0.5, [128, 18, 4]], [0.6, [150, 22, 0]], [0.68, [15, 140, 0]], [0.82, [18, 136, 0]], [1, REST]],
          [[0, 16], [0.24, 16], [0.36, 22], [0.5, 70], [0.6, 84], [0.68, 16], [0.82, 18], [1, 16]]);
        r.hand[0] = r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.24, [30, 0, 0]], [0.36, [40, 0, 0]], [0.6, [-20, 0, 0]], [0.7, [20, 0, 0]], [1, [0, 0, 0]]]);
        // Open over them, closed on what they draw out, flung open as it is let go.
        const open = t < 0.4 || t > 0.6;
        r.open = [open, open];
        r.spine = euler(t, [[0, [0, 0, 0]], [0.24, [-8, 0, 0]], [0.36, [-10, 0, 0]], [0.6, [10, 0, 0]], [0.7, [8, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.36, [-6, 0, 0]], [0.6, [8, 0, 0]], [1, [0, 0, 0]]]);
        r.head = euler(t, [[0, [0, 0, 0]], [0.24, [-10, 0, 0]], [0.5, [6, 0, 0]], [0.62, [18, 0, 0]], [0.82, [14, 0, 0]], [1, [0, 0, 0]]]);
        // The haul taken on the back foot.
        r.leg[0] = euler(t, [[0, STAND], [0.24, [14, 3, 0]], [0.6, [16, 4, 0]], [0.85, [12, 3, 0]], [1, STAND]]);
        r.leg[1] = euler(t, [[0, STAND], [0.36, [0, 3, 0]], [0.6, [-14, 4, 0]], [0.85, [-8, 3, 0]], [1, STAND]]);
        r.knee[0] = one(t, [[0, 4], [0.24, 12], [0.6, 6], [1, 4]]);
        r.knee[1] = one(t, [[0, 4], [0.36, 8], [0.6, 20], [0.85, 10], [1, 4]]);
      },
    },
    fx: {
      charge: (k, t) => {
        const b = k.target;
        // Drawn out until the release, when what was drawn is burnt (`hit`).
        const pull = smooth(seg(t, 0.3, 0.6)) * (t < 0.6 ? 1 : 0);
        const top = k.at(b, 1.4);
        // Venom wisping off them from the first, more and faster as the hands draw it.
        k.emit(k.at(b, 0.45), 8 + 26 * pull, { kind: 'smoke', colour: [VENOM, VENOM_DEEP], size: 2.2, life: [0.5, 0.9], speed: [0.02, 0.08], up: [6 + 22 * pull, 12 + 30 * pull], gravity: -4, jitter: 0.08, jitterZ: 3, bias: 2 });
        k.glow(mid3(k.hand(0), k.hand(1), 0.5), 6, 0.6 * bump(t, 0.1, 0.36, 0.62));
        if (pull > 0.02) {
          // Drawn up in a twist out of their middle to over their head, where it gathers.
          const pts: P3[] = [];
          const from = k.at(b, 0.4);
          const n = 9;
          for (let i = 0; i <= n; i++) {
            const s = (i / n) * pull;
            const an = s * TAU * 1.6 - k.now * 7;
            const rr = 0.06 * (1 - s);
            pts.push({ x: b.x + Math.cos(an) * rr, y: b.y + Math.sin(an) * rr, z: lerp(from.z, top.z, s) });
          }
          // The caster's hold on it: a thin line of light from the hands to what they draw up.
          k.beam(mid3(k.hand(0), k.hand(1), 0.5), top, { width: 1, alpha: 0.5 * pull, glow: 0.5 });
          k.ribbon(pts, { width: 2.4, taper: 'both', main: VENOM, core: VENOM_CORE, ink: VENOM_INK, glow: 0, alpha: 0.95 });
          k.orb(top, 1 + 2.6 * pull, { alpha: smooth(pull * 3), main: VENOM, deep: VENOM_DEEP, core: VENOM_CORE, ink: VENOM_INK, glow: 0, turn: k.now * 5 });
        }
      },
      hit: (k) => {
        const top = k.at(k.target, 1.4);
        // What was drawn out burnt away in the dawn's fire.
        k.burst(top, 34, { kind: 'spark', size: 2, life: [0.25, 0.55], speed: [0.6, 1.6], up: [0, 30], gravity: 30, drag: 0.1 });
        k.burst(top, 14, { kind: 'ember', size: 2, life: [0.4, 0.8], speed: [0.1, 0.4], up: [6, 20], gravity: -4 });
        k.burst(top, 8, { kind: 'smoke', colour: '#e9e2c8', size: 2.6, life: [0.5, 0.9], speed: [0.05, 0.2], up: [8, 16], bias: 2 });
      },
      impact: {
        secs: 1.0,
        draw: (k, u) => {
          const b = k.target, top = k.at(b, 1.4);
          k.flare(top, 14 * flashOf(u, 0.08), 1, k.pal.core, u * 0.8);
          rays(k, top, 16 * easeOut(u * 2), { n: 10, alpha: 0.7 * (1 - smooth(u * 1.6)), turn: u * 0.5 });
          // The wash: a band of light going down them, head to foot, leaving them clean.
          const z = b.z + b.tall * (1.05 - 1.05 * smooth(seg(u, 0.1, 0.85)));
          hoop(k, { x: b.x, y: b.y, z }, 0.12, 0.12, 1.6, { alpha: bump(u, 0.05, 0.2, 1), turn: u * 3 });
          if (u < 0.8) k.emit(k.at(b, 0.5), 14, { kind: 'ember', colour: [VENOM_CORE, k.pal.main], size: 1.4, life: [0.3, 0.6], speed: [0.05, 0.15], up: [6, 14], gravity: -2, jitter: 0.1, jitterZ: 5 });
          k.light(b, 2.6, 0.6 * (1 - u));
        },
      },
    },
  },

  /*
   * Calm: both palms turned down and let slowly lower, the head on one side:
   * hush. Slow lights drift to it, ripples go out from its feet as from
   * still water, and over its head a sun sets for as long as it will not hunt.
   */
  blessing_calm: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.6, release: 0.55 },
      pose: (r, t) => {
        both(r, t, [[0, REST], [0.25, [80, 16, -6]], [0.4, [74, 18, -6]], [0.55, [60, 18, -6]], [0.75, [44, 18, -4]], [0.88, [38, 16, -2]], [1, REST]],
          [[0, 16], [0.25, 26], [0.55, 18], [0.88, 16], [1, 16]]);
        r.hand[0] = r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.25, [18, 0, 0]], [0.55, [26, 0, 0]], [0.88, [22, 0, 0]], [1, [0, 0, 0]]]);
        r.open = [t > 0.05, t > 0.05];
        r.head = euler(t, [[0, [0, 0, 0]], [0.25, [-6, 10, 0]], [0.6, [-12, 12, 0]], [0.88, [-10, 10, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.25, [4, 0, 0]], [0.6, [-4, 2, 0]], [1, [0, 0, 0]]]);
        r.spine = euler(t, [[0, [0, 0, 0]], [0.6, [-4, 0, 0]], [1, [0, 0, 0]]]);
        // The weight let down with the hands.
        stance(r, t, [[0, 0], [0.25, 2], [0.6, 12], [0.88, 10], [1, 0]]);
      },
    },
    fx: {
      charge: (k, t) => {
        const g = bump(t, 0.2, 0.5, 0.7);
        for (const s of [0, 1]) {
          const h = k.hand(s);
          k.glow(h, 5, 0.6 * g);
          if (g > 0.1) k.emit(h, 8 * g, { kind: 'mote', size: 1.4, life: [0.6, 1.0], speed: [0.01, 0.04], up: [-6, -3], gravity: 0, jitter: 0.02 });
        }
      },
      travel: {
        secs: (tiles) => 0.4 + tiles * 0.11,
        draw: (k, u) => {
          // Three slow lights drifting to it one after another, bobbing, unhurried.
          const from = mid3(k.hand(0), k.hand(1), 0.5), to = k.at(k.target, 0.9);
          for (let i = 0; i < 3; i++) {
            const v = clamp((u - i * 0.12) / 0.76);
            if (v <= 0 || v >= 1) continue;
            const at = (w: number): P3 => lift(arcAt(from, to, smooth(w), 4 + k.dist), Math.sin(w * 10 + i * 2) * 1.2);
            const p = at(v);
            k.ribbon([at(Math.max(0, v - 0.12)), at(Math.max(0, v - 0.06)), p], { width: 2, taper: 'start', alpha: 0.6, glow: 0.4 });
            k.orb(p, 2.1, { turn: k.now * 2 + i, glow: 0.8 });
          }
        },
      },
      hit: (k) => {
        k.burst(k.at(k.target, 1.25), 10, { kind: 'shard', colour: [k.pal.core, k.pal.main], size: 1.6, life: [1.0, 1.6], speed: [0.02, 0.08], up: [-3, 0], gravity: 2, drag: 0.4, jitter: 0.15, spin: 0.6 });
      },
      impact: {
        secs: 1.6,
        draw: (k, u) => {
          // Ripples out from its feet, slow, as on still water.
          for (let i = 0; i < 3; i++) {
            const v = seg(u, i * 0.2, i * 0.2 + 0.7);
            if (v <= 0 || v >= 1) continue;
            k.ring(k.target, 0.12 + 0.55 * easeOut(v), { band: 0.045, alpha: 0.7 * (1 - v), turn: i, glow: 0.5 });
          }
          k.light(k.target, 2.4, 0.45 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          const b = k.target;
          const a = held(age, left, 1.0, 1.2);
          // A sun setting over its head: down to its horizon over the first second and a half, and resting there.
          const p = k.at(b, 1.12);
          sunMark(k, lift(p, Math.sin(age * 1.3) * 0.5), 5, 0.95 * a, 1 - 0.5 * smooth(age / 1.5));
          // Now and then another slow ripple, and petals drifting down on it.
          const v = (age % 4.5) / 3;
          if (v < 1 && age > 1.5) k.ring(b, 0.15 + 0.4 * easeOut(v), { band: 0.035, alpha: 0.4 * (1 - v) * a, glow: 0.3 });
          if (!k.fast) k.emit(k.at(b, 1.35), 1.4 * a, { kind: 'shard', colour: [k.pal.core, k.pal.main], size: 1.3, life: [1.2, 1.8], speed: [0.02, 0.06], up: [-3, -1], gravity: 1, drag: 0.4, jitter: 0.18, spin: 0.5 });
        },
      },
    },
  },

  /*
   * Steady Hands: the tool held in both hands low with the head bowed over
   * it, then lifted up before the face as an offering; a shaft of light comes
   * down on it, and while the blessing lasts a glint now and then runs along it.
   */
  blessing_steady: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.8, release: 0.6 },
      pose: (r, t) => {
        both(r, t, [[0, REST], [0.2, [36, -12, 26]], [0.34, [40, -12, 26]], [0.52, [138, -8, 22]], [0.6, [150, -8, 20]], [0.78, [148, -8, 20]], [1, REST]],
          [[0, 16], [0.2, 72], [0.34, 74], [0.52, 60], [0.6, 50], [0.78, 52], [1, 16]]);
        r.open = [false, false];
        r.head = euler(t, [[0, [0, 0, 0]], [0.2, [-22, 0, 0]], [0.36, [-26, 0, 0]], [0.56, [16, 0, 0]], [0.78, [14, 0, 0]], [1, [0, 0, 0]]]);
        r.neck = euler(t, [[0, [0, 0, 0]], [0.36, [-8, 0, 0]], [0.56, [6, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.36, [-6, 0, 0]], [0.6, [8, 0, 0]], [1, [0, 0, 0]]]);
        r.spine = euler(t, [[0, [0, 0, 0]], [0.36, [-4, 0, 0]], [0.6, [5, 0, 0]], [1, [0, 0, 0]]]);
        stance(r, t, [[0, 0], [0.36, 8], [0.56, 0], [1, 0]]);
        r.wield = one(t, [[0, 0], [0.2, 1], [0.85, 1], [1, 0]]);
      },
    },
    fx: {
      charge: (k, t) => {
        const at = steadyAt(k);
        const s = smooth(seg(t, 0.25, 0.58)) * (1 - seg(t, 0.75, 1));
        shaft(k, at, 70, 2 + 1.2 * s, 0.6 * s, k.pal.core);
        k.glow(at, 6, 0.7 * s);
        if (s > 0.1) k.emit(lift(at, 30), 22 * s, { kind: 'mote', size: 1.5, life: [0.5, 0.8], speed: [0, 0.02], up: [-50, -36], gravity: 0, jitter: 0.03 });
      },
      release: (k) => {
        const at = steadyAt(k);
        k.burst(at, 16, { kind: 'mote', size: 1.8, life: [0.4, 0.8], speed: [0.1, 0.4], up: [4, 14], gravity: 0 });
      },
      impact: {
        secs: 0.9,
        draw: (k, u) => {
          const at = steadyAt(k);
          rays(k, at, 14 * easeOut(u * 1.5), { n: 8, alpha: 0.8 * (1 - smooth(u)), turn: u * 0.6 });
          k.flare(at, 8 * flashOf(u, 0.1), 1);
          gleam(k, u, 0.9);
          k.light(at, 2, 0.6 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          // Half an hour: no more than a warmth at the hand and a glint along the tool every few seconds.
          const a = held(age, left, 0.5, 2);
          const at = steadyAt(k);
          k.glow(at, 3, 0.18 * a);
          const v = ((age + 1.5) % 6) / 0.7;
          if (v < 1) gleam(k, v, 0.7 * a);
        },
      },
    },
  },

  /*
   * Renewal: crouched to scoop with both hands cupped, lifted to the chest
   * and poured out to them: a stream of gold falls over them, and round
   * their feet a pip for every heal still to come, one going out at each.
   */
  blessing_renewal: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.4, release: 0.55 },
      pose: (r, t) => {
        both(r, t, [[0, REST], [0.22, [34, -10, 22]], [0.42, [70, -16, 30]], [0.55, [96, 2, 12]], [0.72, [90, 6, 8]], [1, REST]],
          [[0, 16], [0.22, 34], [0.42, 100], [0.55, 24], [0.72, 22], [1, 16]]);
        r.hand[0] = r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.22, [-30, 0, 0]], [0.42, [-40, 0, 0]], [0.55, [30, 0, 0]], [0.72, [36, 0, 0]], [1, [0, 0, 0]]]);
        r.open = [t > 0.05, t > 0.05];
        r.spine = euler(t, [[0, [0, 0, 0]], [0.22, [-26, 0, 0]], [0.42, [-2, 0, 0]], [0.55, [-10, 0, 0]], [0.72, [-8, 0, 0]], [1, [0, 0, 0]]]);
        r.head = euler(t, [[0, [0, 0, 0]], [0.22, [-8, 0, 0]], [0.42, [-14, 0, 0]], [0.55, [0, 0, 0]], [1, [0, 0, 0]]]);
        stance(r, t, [[0, 0], [0.22, 34], [0.42, 8], [0.55, 12], [0.75, 8], [1, 0]], [[0, 0], [0.42, 0], [0.55, 14], [0.8, 12], [1, 0]]);
      },
    },
    fx: {
      charge: (k, t) => {
        const cup = mid3(k.hand(0), k.hand(1), 0.5);
        const g = smooth(seg(t, 0.18, 0.45)) * (1 - seg(t, 0.55, 0.6));
        // What the hands have taken up: a little pool of light, spilling.
        k.orb(lift(cup, 1), 1.2 + 1.6 * g, { alpha: g, turn: k.now * 2, sides: 6 });
        if (g > 0.1) k.emit(cup, 14 * g, { kind: 'drop', colour: k.pal.main, size: 1.5, life: [0.3, 0.5], speed: [0.01, 0.05], up: [-4, 0], gravity: 40, jitter: 0.02, bias: 2 });
      },
      travel: {
        secs: (tiles) => (tiles < 0.3 ? 0.2 : 0.25 + tiles * 0.06),
        draw: (k, u) => {
          // A stream poured out in an arc, drops falling off it.
          const from = mid3(k.hand(0), k.hand(1), 0.5), to = lift(k.head(k.target), onSelf(k) ? 5 : 2);
          const lt = onSelf(k) ? 4 : 5 + k.dist * 2.5;
          const pts: P3[] = [];
          for (let i = 8; i >= 0; i--) pts.push(arcAt(from, to, clamp(u - i * 0.045), lt));
          const head = pts[pts.length - 1];
          k.ribbon(pts, { width: 3.4, taper: 'start', alpha: 0.9 });
          k.emit(head, 34, { kind: 'drop', colour: [k.pal.main, k.pal.core], size: 1.6, life: [0.3, 0.5], speed: [0.02, 0.08], up: [-6, 0], gravity: 50, bias: 2 });
          k.light(head, 1.6, 0.4);
        },
      },
      hit: (k) => {
        const h = lift(k.head(k.target), 2);
        k.burst(h, 16, { kind: 'drop', colour: [k.pal.main, k.pal.core], size: 1.8, life: [0.4, 0.7], speed: [0.1, 0.3], up: [-2, 10], gravity: 50, bias: 3 });
        k.burst(h, 8, { kind: 'mote', size: 1.8, life: [0.4, 0.8], speed: [0.05, 0.2], up: [-6, 4], gravity: 0 });
      },
      impact: {
        secs: 0.8,
        draw: (k, u) => {
          const b = k.target;
          hoop(k, { x: b.x, y: b.y, z: b.z + b.tall * smooth(u) * 0.95 }, 0.12, 0.12, 1.5, { alpha: bump(u, 0, 0.15, 1), turn: u * 2 });
          k.light(b, 2, 0.5 * (1 - u));
        },
      },
      linger: {
        // One heal at every `every` seconds through its `secs`: the last falls on the linger's last second, so it runs one over.
        secs: lastsOf('blessing_renewal', 30) + 1,
        draw: (k, age, left) => {
          const b = k.target;
          const every = k.fx.every || 3;
          const count = Math.round((k.fx.secs || 30) / every);
          const done = Math.min(count, Math.floor(age / every));
          const since = age - done * every;
          const a = held(age, left, 0.5, 1);
          renewalPips(k, b, count, done, since, a);
          // A heal: a band climbing them, and light rising off them.
          if (done > 0 && since < 0.9) {
            const v = since / 0.9;
            hoop(k, { x: b.x, y: b.y, z: b.z + b.tall * smooth(v) * 0.9 }, 0.115, 0.115, 1.3, { alpha: 0.8 * bump(v, 0, 0.15, 1) * a, turn: v * 2, glow: 0.6 });
            rising(k, k.at(b, 0.4), 18 * (1 - v));
          }
          if (!k.fast) rising(k, k.at(b, 0.1), 2 * a, 0.15, 1.3);
        },
      },
    },
  },

  /*
   * Bless Arms: the right hand raised to the sky, catching a sun in it, and
   * brought down to anoint their weapon hand; a gold band winds up the
   * forearm, a gleam runs the length of the blade, and the hand keeps a
   * light that sheds sparks while it lasts.
   */
  blessing_arms: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.2, release: 0.5 },
      pose: (r, t) => {
        r.arm[1] = euler(t, [[0, REST], [0.18, [120, 22, -4]], [0.34, [170, 12, 0]], [0.4, [172, 10, 0]], [0.5, [74, 4, 0]], [0.64, [68, 6, 0]], [1, REST]]);
        r.elbow[1] = one(t, [[0, 16], [0.18, 40], [0.34, 6], [0.4, 6], [0.5, 4], [0.64, 10], [1, 16]]);
        r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.4, [-10, 0, 0]], [0.5, [-30, 0, 0]], [0.7, [-20, 0, 0]], [1, [0, 0, 0]]]);
        r.arm[0] = euler(t, [[0, REST], [0.2, ON_HEART], [0.8, ON_HEART], [1, REST]]);
        r.elbow[0] = one(t, [[0, 16], [0.2, ON_HEART_BEND], [0.8, ON_HEART_BEND], [1, 16]]);
        r.open = [t > 0.05, t > 0.05];
        r.shrug[1] = one(t, [[0, 0], [0.34, 0.8], [0.45, 0.8], [0.55, 0], [1, 0]]);
        r.head = euler(t, [[0, [0, 0, 0]], [0.34, [22, 0, -4]], [0.42, [20, 0, -4]], [0.52, [-12, 0, 0]], [0.7, [-10, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.34, [8, 0, -8]], [0.5, [-6, 0, 6]], [0.7, [-4, 0, 4]], [1, [0, 0, 0]]]);
        r.spine = euler(t, [[0, [0, 0, 0]], [0.34, [4, 0, 0]], [0.5, [-10, 0, 0]], [0.7, [-8, 0, 0]], [1, [0, 0, 0]]]);
        stance(r, t, [[0, 0], [0.34, 0], [0.5, 14], [0.75, 10], [1, 0]], [[0, 0], [0.4, 0], [0.5, 16], [0.8, 12], [1, 0]]);
      },
    },
    fx: {
      charge: (k, t) => {
        // A sun caught in the raised hand.
        const g = bump(t, 0.15, 0.38, 0.5);
        const h = k.hand(1);
        k.orb(lift(h, 1.5), 1 + 2 * g, { alpha: g, turn: k.now * 3 });
        rays(k, lift(h, 1.5), 9 * g, { n: 8, alpha: 0.8 * g, turn: k.now * 0.8 });
        k.light(h, 1.8, 0.5 * g);
      },
      travel: {
        secs: (tiles) => 0.08 + tiles * 0.035,
        draw: (k, u) => {
          // A quick stroke of gold from the hand to theirs.
          const from = onSelf(k) ? lift(k.head(), 10) : k.hand(1), to = k.hand(1, k.target);
          const head = mid3(from, to, easeOut(u)), tail = mid3(from, to, easeOut(Math.max(0, u - 0.45)));
          k.ribbon([tail, mid3(tail, head, 0.5), head], { width: 3, taper: 'start', alpha: 0.95 });
          k.orb(head, 1.8, { turn: k.now * 6 });
        },
      },
      hit: (k) => {
        const h = k.hand(1, k.target);
        k.burst(h, 18, { kind: 'spark', size: 1.6, life: [0.2, 0.45], speed: [0.4, 1.2], up: [4, 22], gravity: 40, drag: 0.1 });
      },
      impact: {
        secs: 0.9,
        draw: (k, u) => {
          const b = k.target;
          const h = k.hand(1, b), el = k.joint(b, 'elbow1', [0, 0, 0], 0.6);
          k.flare(h, 12 * flashOf(u, 0.08), 1, k.pal.core, 0.3);
          rays(k, h, 16 * easeOut(u * 2), { n: 8, alpha: 0.85 * (1 - smooth(u * 1.4)), turn: 0.4 + u * 0.5 });
          // A gold band wound up the forearm, from the hand to the elbow.
          const wind = smooth(seg(u, 0, 0.5)), a = 1 - seg(u, 0.6, 1);
          const pts: P3[] = [];
          for (let i = 0; i <= 10; i++) {
            const s = (i / 10) * wind;
            const an = s * TAU * 2.2 + k.now * 2;
            const p = mid3(h, el, s);
            pts.push({ x: p.x + Math.cos(an) * 0.045, y: p.y + Math.sin(an) * 0.045, z: p.z + Math.sin(an * 0.5) * 0.4 });
          }
          if (wind > 0.05) k.ribbon(pts, { width: 2.2, taper: 'both', alpha: a });
          gleam(k, seg(u, 0.25, 0.85), 1, b);
          k.light(h, 1.8, 0.5 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          const b = k.target;
          const a = held(age, left, 0.5, 1);
          const h = k.hand(1, b), el = k.joint(b, 'elbow1', [0, 0, 0], 0.6);
          // A band of gold kept round the wrist, turning, for as long as the blows are blessed.
          const cuff = mid3(h, el, 0.22);
          hoop(k, { x: cuff.x, y: cuff.y, z: cuff.z - 0.4 }, 0.03, 0.03, 0.9, { alpha: 0.95 * a * smooth(seg(age, 0.6, 1)), turn: age * 1.5, n: 8, glow: 0.8 });
          k.glow(h, 4, (0.3 + 0.1 * Math.sin(age * 4)) * a);
          if (!k.fast) k.emit(h, 4 * a, { kind: 'spark', size: 1.2, life: [0.2, 0.4], speed: [0.02, 0.1], up: [6, 14], gravity: 10, jitter: 0.02 });
          const v = ((age + 1) % 2.5) / 0.6;
          if (v < 1) gleam(k, v, 0.8 * a, b);
        },
      },
    },
  },

  /*
   * Kinship: down on one knee with a hand held out to it palm up and the head
   * on one side; a light rises out of the palm and drifts to it like a
   * firefly, and a thread is spun back from it to the hand that offered,
   * kept between them, with a knot over its head, until the taming is tried.
   */
  blessing_kinship: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.6, release: 0.55 },
      pose: (r, t) => {
        kneel(r, one(t, [[0, 0], [0.3, 1], [0.82, 1], [1, 0]]));
        r.arm[1] = euler(t, [[0, REST], [0.3, [38, 12, -20]], [0.45, [44, 10, -24]], [0.55, [52, 8, -24]], [0.8, [48, 8, -22]], [1, REST]]);
        r.elbow[1] = one(t, [[0, 16], [0.3, 20], [0.55, 10], [0.8, 12], [1, 16]]);
        r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.3, [-10, 0, -70]], [0.55, [-20, 0, -80]], [0.8, [-14, 0, -70]], [1, [0, 0, 0]]]);
        r.arm[0] = euler(t, [[0, REST], [0.3, [56, 10, 14]], [0.82, [56, 10, 14]], [1, REST]]);
        r.elbow[0] = one(t, [[0, 16], [0.3, 40], [0.82, 40], [1, 16]]);
        r.open = [t > 0.05, t > 0.05];
        r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [-8, 0, 0]], [0.55, [-12, 0, 0]], [0.82, [-10, 0, 0]], [1, [0, 0, 0]]]);
        r.head = euler(t, [[0, [0, 0, 0]], [0.3, [-4, 12, 0]], [0.55, [0, 14, 0]], [0.82, [-2, 12, 0]], [1, [0, 0, 0]]]);
      },
    },
    fx: {
      charge: (k, t) => {
        // A light in the open palm, offered.
        const g = smooth(seg(t, 0.28, 0.52)) * (1 - seg(t, 0.54, 0.56));
        const palm = lift(k.hand(1), 2 + Math.sin(k.now * 5) * 0.4);
        k.orb(palm, 0.8 + 1.4 * g, { alpha: g, turn: k.now * 3 });
        k.light(palm, 1.4, 0.4 * g);
      },
      travel: {
        secs: (tiles) => 0.45 + tiles * 0.14,
        draw: (k, u) => {
          // Drifting to it like a firefly: unhurried, bobbing.
          const from = lift(k.hand(1), 2), to = k.head(k.target);
          const p = lift(arcAt(from, to, smooth(u), 3 + k.dist * 0.8), Math.sin(u * 13) * 1.2 * (1 - u));
          const back = lift(arcAt(from, to, smooth(Math.max(0, u - 0.08)), 3 + k.dist * 0.8), Math.sin(Math.max(0, u - 0.08) * 13) * 1.2);
          k.ribbon([back, p], { width: 1.6, taper: 'start', alpha: 0.6, glow: 0.4 });
          k.orb(p, 2.1, { turn: k.now * 3 });
          k.emit(p, 10, { kind: 'mote', size: 1.3, life: [0.3, 0.6], speed: [0, 0.03], up: [-2, 2], gravity: 0, jitter: 0.02 });
          k.light(p, 1.5, 0.45);
        },
      },
      hit: (k) => {
        k.burst(k.head(k.target), 12, { kind: 'mote', size: 1.8, life: [0.5, 0.9], speed: [0.05, 0.25], up: [4, 12], gravity: 0 });
      },
      impact: {
        secs: 1.2,
        draw: (k, u) => {
          k.flare(k.head(k.target), 8 * flashOf(u, 0.1), 1, k.pal.core, 0.3);
          k.light(k.target, 2, 0.45 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          const a = held(age, left, 0.3, 1);
          const b = k.target;
          // The thread, spun back from it to the hand over the first second; faint after, and gone when they are far apart.
          const near = 1 - seg(k.dist, 8, 12);
          const spun = smooth(age / 0.9);
          const bright = lerp(1, 0.32, smooth(seg(age, 1.2, 3)));
          const from = k.head(b), to = k.hand(1);
          if (near > 0.01) {
            const pts: P3[] = [];
            for (let i = 0; i <= 8; i++) pts.push(arcAt(from, to, (i / 8) * spun, -1.5 - k.dist * 0.4));
            k.ribbon(pts, { width: 1.3, taper: 'none', alpha: 0.85 * bright * a * near, glow: 0.4 });
            // Now and then a bead runs along it from the hand to the creature: the bond kept.
            const v = ((age + 2) % 3.5) / 0.9;
            if (v < 1 && age > 1.2) k.orb(arcAt(to, from, smooth(v), 1.5 + k.dist * 0.4), 1.3, { alpha: a * near * bump(v, 0, 0.15, 1), glow: 0.6 });
          }
          knot(k, lift(k.at(b, 1.1), 2 + Math.sin(age * 1.6) * 0.5), 3, 0.9 * a * smooth(seg(age, 0.3, 0.9)), age * 0.9);
        },
      },
    },
  },

  /*
   * Benediction: the arms lifted wide and high, palms up and the face to the
   * sky, then swept down and out over the ground before them. A sun gathers
   * over the spot and breaks into a rain of light over everything in its
   * reach, a ring running out to the edge of it.
   */
  blessing_benediction: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.9, release: 0.55 },
      pose: (r, t) => {
        both(r, t, [[0, REST], [0.18, [14, 80, 0]], [0.42, [10, 150, 0]], [0.47, [10, 152, 0]], [0.56, [34, 78, -16]], [0.78, [32, 80, -16]], [1, REST]],
          [[0, 16], [0.18, 20], [0.42, 14], [0.56, 6], [0.78, 10], [1, 16]]);
        r.hand[0] = r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.42, [-30, 0, 0]], [0.56, [20, 0, 0]], [0.8, [16, 0, 0]], [1, [0, 0, 0]]]);
        r.open = [t > 0.05, t > 0.05];
        r.shrug = [one(t, [[0, 0], [0.42, 0.8], [0.56, 0], [1, 0]]), one(t, [[0, 0], [0.42, 0.8], [0.56, 0], [1, 0]])];
        r.head = euler(t, [[0, [0, 0, 0]], [0.18, [6, 0, 0]], [0.42, [26, 0, 0]], [0.47, [26, 0, 0]], [0.58, [-14, 0, 0]], [0.8, [-10, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.42, [12, 0, 0]], [0.58, [-8, 0, 0]], [0.8, [-6, 0, 0]], [1, [0, 0, 0]]]);
        r.spine = euler(t, [[0, [0, 0, 0]], [0.42, [5, 0, 0]], [0.58, [-12, 0, 0]], [0.8, [-10, 0, 0]], [1, [0, 0, 0]]]);
        stance(r, t, [[0, 0], [0.18, 6], [0.42, 0], [0.58, 16], [0.8, 12], [1, 0]], [[0, 0], [0.45, 0], [0.58, 16], [0.82, 14], [1, 0]]);
      },
    },
    fx: {
      charge: (k, t) => {
        const R = reachOf('blessing_benediction', 6);
        const g = smooth(seg(t, 0.12, 0.52));
        const gone = 1 - seg(t, 0.55, 0.57);
        // A great halo gathering in the sky over the spot, turning, with the light kept in its middle.
        const sky = k.on(k.spot.x, k.spot.y, BENEDICTION_SKY);
        hoop(k, sky, 0.25 + 0.8 * g, (0.25 + 0.8 * g) * 0.82, 0, { alpha: smooth(seg(t, 0.1, 0.3)) * gone, turn: k.now * 0.6, glow: 0.8, back: 0.7 });
        k.glow(sky, 10 + 14 * g, 0.5 * g * gone);
        k.ring(k.spot, R, { band: 0.12, alpha: 0.55 * g * (1 - seg(t, 0.55, 0.75)), dash: 6, turn: k.now * 0.1, glow: 0.4 });
        k.light(k.spot, 2 + 3 * g, 0.55 * g);
        for (const s of [0, 1]) if (g > 0.1) k.emit(k.hand(s), 10 * g, { kind: 'mote', size: 1.5, life: [0.5, 0.9], speed: [0.02, 0.08], up: [14, 24], gravity: 0, jitter: 0.03 });
      },
      hit: (k) => {
        const sky = k.on(k.spot.x, k.spot.y, BENEDICTION_SKY);
        k.burst(sky, 30, { kind: 'spark', size: 2, life: [0.3, 0.6], speed: [0.8, 2.2], up: [-10, 10], gravity: 20, drag: 0.1 });
      },
      impact: {
        secs: 1.8,
        draw: (k, u) => {
          const R = reachOf('blessing_benediction', 6);
          const c = k.spot;
          const sky = k.on(c.x, c.y, BENEDICTION_SKY);
          // The halo opens wide and pours itself out: gone by the time the rain is down.
          const open = easeOut(seg(u, 0, 0.45));
          hoop(k, sky, 1.05 + 1.4 * open, (1.05 + 1.4 * open) * (0.82 + 0.1 * open), 0, { alpha: 1 - smooth(seg(u, 0.2, 0.55)), turn: k.now * 0.6, glow: 0.8, back: 0.7 });
          k.flare(sky, 16 * flashOf(u, 0.05), 1, k.pal.core, u);
          // A rain of light over everything within its reach, and the reach itself run out to.
          const out = easeOut(seg(u, 0, 0.5));
          k.ring(c, 0.2 + (R - 0.2) * out, { band: 0.3 * (1 - 0.5 * out), alpha: 0.95 * (1 - seg(u, 0.55, 1)) });
          k.disc(c, R * Math.max(0.05, out), { alpha: 0.1 * (1 - seg(u, 0.4, 1)), main: k.pal.core });
          if (u < 0.6) {
            // Three points a frame, each raining at a steady rate, so fast graphics thins the rain rather than losing it.
            for (let i = 0; i < 3; i++) {
              const an = k.rand() * TAU, rr = R * Math.sqrt(k.rand()) * Math.max(0.2, out);
              k.emit(k.on(c.x + Math.cos(an) * rr, c.y + Math.sin(an) * rr, BENEDICTION_SKY * (0.6 + 0.3 * k.rand())), 35, { kind: 'spark', colour: [k.pal.core, k.pal.main], size: 2.2, life: [0.4, 0.5], speed: [0, 0.01], up: [-70, -60], gravity: 0, drag: 1 });
            }
          }
          if (u > 0.3 && u < 0.9) {
            const an = k.rand() * TAU, rr = R * Math.sqrt(k.rand());
            k.emit(k.on(c.x + Math.cos(an) * rr, c.y + Math.sin(an) * rr, 2), 30, { kind: 'mote', size: 1.8, life: [0.6, 1.0], speed: [0, 0.03], up: [10, 18], gravity: 0 });
          }
          k.light(c, R * (0.4 + 0.6 * out), 0.85 * (1 - u * u));
        },
      },
    },
  },

  /*
   * Shield of Dawn: the arms crossed over the chest and the knees gathered,
   * then flung open wide -- a sunrise -- and held. A dome of light is built
   * up round them course by course from the ground, crowned with rays, and
   * stays over them, breathing, for as long as it lasts.
   */
  blessing_shield: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.5, release: 0.5 },
      pose: (r, t) => {
        both(r, t, [[0, REST], [0.3, CROSSED], [0.4, [CROSSED[0] - 2, CROSSED[1], CROSSED[2] + 4]], [0.5, [30, 105, -20]], [0.56, [28, 110, -20]], [0.8, [30, 106, -20]], [1, REST]],
          [[0, 16], [0.3, CROSSED_BEND], [0.4, CROSSED_BEND + 6], [0.5, 10], [0.56, 14], [0.8, 16], [1, 16]]);
        r.open = [t > 0.42, t > 0.42];
        r.hand[0] = r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.5, [-40, 0, 0]], [0.8, [-36, 0, 0]], [1, [0, 0, 0]]]);
        r.head = euler(t, [[0, [0, 0, 0]], [0.3, [-18, 0, 0]], [0.4, [-20, 0, 0]], [0.52, [10, 0, 0]], [0.8, [8, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.4, [-8, 0, 0]], [0.52, [10, 0, 0]], [0.8, [8, 0, 0]], [1, [0, 0, 0]]]);
        r.spine = euler(t, [[0, [0, 0, 0]], [0.4, [-10, 0, 0]], [0.52, [3, 0, 0]], [1, [0, 0, 0]]]);
        const dip = one(t, [[0, 0], [0.4, 26], [0.5, 4], [0.8, 6], [1, 0]]);
        const wide = one(t, [[0, 0], [0.5, 1], [0.82, 1], [1, 0]]);
        r.leg[0] = [STAND[0] + dip * 0.5, 3 + 8 * wide, 0];
        r.leg[1] = [STAND[0] + dip * 0.5, 3 + 8 * wide, 0];
        r.knee[0] = r.knee[1] = 4 + dip;
      },
    },
    fx: {
      charge: (k, t) => {
        // The light kept between the crossed arms, until they open.
        const g = smooth(seg(t, 0.15, 0.45)) * (1 - seg(t, 0.48, 0.52));
        const at = k.chest();
        k.orb(at, 1 + 2.4 * g, { alpha: g, turn: k.now * 4, bias: 3 });
        k.light(at, 1.8, 0.5 * g);
      },
      release: (k) => {
        k.burst(k.chest(), 20, { kind: 'spark', size: 1.8, life: [0.2, 0.45], speed: [0.6, 1.4], up: [-4, 18], gravity: 20, drag: 0.1 });
      },
      travel: {
        secs: (tiles) => (tiles < 0.3 ? 0 : 0.22 + tiles * 0.06),
        draw: (k, u) => {
          // Rising over to them as the sun does, high.
          const from = k.chest(), to = k.at(k.target, 1.1);
          const lt = 8 + k.dist * 3;
          const pts: P3[] = [];
          for (let i = 6; i >= 0; i--) pts.push(arcAt(from, to, clamp(u - i * 0.04), lt));
          const head = pts[pts.length - 1];
          k.ribbon(pts, { width: 3.2, taper: 'start', alpha: 0.9 });
          k.orb(head, 2.6, { turn: k.now * 4 });
          k.light(head, 2, 0.5);
        },
      },
      hit: (k) => {
        k.burst(k.at(k.target, 0.05), 18, { kind: 'mote', size: 1.8, life: [0.4, 0.8], speed: [0.3, 0.6], up: [2, 10], gravity: 0 });
      },
      impact: {
        secs: 1.1,
        draw: (k, u) => {
          const b = k.target;
          const H = b.tall * 1.12, R = shieldR(b);
          // Built up from the ground, course on course, each a band leaning in as the dome closes.
          const courses = 4;
          for (let i = 0; i < courses; i++) {
            const v = seg(u, i * 0.12, i * 0.12 + 0.22);
            if (v <= 0) continue;
            const h0 = (i / courses) * H, h1 = ((i + 1) / courses) * H * (0.6 + 0.4 * easeBack(v));
            const r0 = R * Math.sqrt(1 - (h0 / H) ** 2), r1 = R * Math.sqrt(Math.max(0, 1 - (h1 / H) ** 2));
            hoop(k, { x: b.x, y: b.y, z: b.z + h0 }, r0, Math.max(0.01, r1), h1 - h0, { alpha: v * (1 - seg(u, 0.7, 1)), turn: i * 0.3, n: k.fast ? 8 : 12, glow: 0.4, back: 0.3, front: 0.42 });
          }
          const crown = k.at(b, 1.15);
          rays(k, crown, 12 * bump(u, 0.45, 0.62, 1), { n: 10, alpha: 0.9, turn: u * 0.5 });
          k.flare(crown, 9 * bump(u, 0.45, 0.55, 0.9), 1, k.pal.core);
          k.light(b, 2.8, 0.7 * (1 - u * 0.6));
        },
      },
      linger: {
        draw: (k, age, left) => {
          const b = k.target;
          const a = smooth(seg(age, 0.7, 1.2)) * smooth(left / 1);
          const breath = 0.5 + 0.5 * Math.sin(age * 2.2);
          k.shell(b, { alpha: (0.28 + 0.08 * breath + 0.4 * Math.max(0, 1.6 - age)) * a, size: 1.05, turn: age * 0.3, glow: 0.5 });
          // Now and then the dawn goes over the top of it: a glint from one side to the other.
          const v = ((age + 2) % 4.5) / 1.1;
          if (v < 1) {
            const an = Math.PI * (0.15 + 0.7 * v);
            const p = k.local(b, Math.cos(an) * -6, 0, b.tall * (0.6 + 0.55 * Math.sin(an)));
            k.flare(p, 5 * bump(v, 0, 0.3, 1), a, k.pal.core, v);
          }
          k.ring(b, shieldR(b) * 1.05, { band: 0.04, alpha: 0.35 * a, dash: 3, turn: age * 0.4, glow: 0.3 });
          k.light(b, 1.6, 0.3 * a);
        },
      },
    },
  },

  /*
   * Sanctuary: the right arm raised as if holding a staff and brought down
   * hard to plant it, then both arms swept out low to mark the bounds. Light
   * strikes the spot, a ring runs out to the edge of its reach and posts of
   * light stand on it, burning down with the seconds it holds.
   */
  blessing_sanctuary: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.8, release: 0.55 },
      pose: (r, t) => {
        r.arm[1] = euler(t, [[0, REST], [0.3, [168, 8, 0]], [0.4, [172, 6, 0]], [0.52, [44, 4, 0]], [0.6, [40, 6, 0]], [0.8, [30, 80, -20]], [1, REST]]);
        r.elbow[1] = one(t, [[0, 16], [0.3, 8], [0.4, 6], [0.52, 4], [0.6, 6], [0.8, 10], [1, 16]]);
        r.arm[0] = euler(t, [[0, REST], [0.3, ON_HEART], [0.6, ON_HEART], [0.8, [30, 80, -20]], [1, REST]]);
        r.elbow[0] = one(t, [[0, 16], [0.3, ON_HEART_BEND], [0.6, ON_HEART_BEND], [0.8, 10], [1, 16]]);
        r.open = [t > 0.05, t > 0.58];
        r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.52, [-20, 0, 0]], [0.8, [20, 0, 0]], [1, [0, 0, 0]]]);
        r.shrug[1] = one(t, [[0, 0], [0.32, 0.8], [0.45, 0.6], [0.52, 0], [1, 0]]);
        r.head = euler(t, [[0, [0, 0, 0]], [0.32, [14, 0, -4]], [0.52, [-18, 0, 0]], [0.62, [-16, 0, 0]], [0.82, [-6, 0, 0]], [1, [0, 0, 0]]]);
        r.spine = euler(t, [[0, [0, 0, 0]], [0.32, [4, 0, 0]], [0.52, [-16, 0, 0]], [0.62, [-14, 0, 0]], [0.82, [-4, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.32, [6, 0, -8]], [0.52, [-6, 0, 4]], [0.82, [0, 0, 0]], [1, [0, 0, 0]]]);
        stance(r, t, [[0, 0], [0.32, 0], [0.52, 26], [0.62, 22], [0.82, 6], [1, 0]], [[0, 0], [0.4, 0], [0.52, 14], [0.82, 10], [1, 0]]);
      },
    },
    fx: {
      charge: (k, t) => {
        const g = bump(t, 0.15, 0.38, 0.56);
        const h = k.hand(1);
        k.glow(h, 6, 0.8 * g);
        k.light(h, 1.6, 0.4 * g);
        // The spot itself readied, a small ring gathering on it as the arm comes down.
        k.ring(k.spot, 0.35 * smooth(seg(t, 0.3, 0.55)), { band: 0.12, alpha: 0.8 * smooth(seg(t, 0.3, 0.5)) });
      },
      hit: (k) => {
        const at = k.on(k.spot.x, k.spot.y, 1);
        k.burst(at, 12, { kind: 'dust', colour: '#9a8a68', size: 3, life: [0.4, 0.8], speed: [0.4, 0.9], up: [2, 6], gravity: 2, drag: 0.1 });
        k.burst(at, 20, { kind: 'spark', size: 1.8, life: [0.25, 0.5], speed: [0.6, 1.4], up: [4, 20], gravity: 30, drag: 0.1 });
      },
      impact: {
        secs: 1.3,
        draw: (k, u) => {
          const R = reachOf('blessing_sanctuary', 4);
          const c = k.spot;
          shaft(k, k.on(c.x, c.y), 80, 4, flashOf(u, 0.05) * 0.8, k.pal.core);
          const out = easeOut(seg(u, 0, 0.42));
          k.ring(c, 0.2 + (R - 0.2) * out, { band: 0.26 * (1 - 0.5 * out), alpha: 0.95 });
          sanctuaryPosts(k, R, smooth(seg(u, 0.38, 0.75)), 1, 0);
          k.light(c, R * (0.3 + 0.7 * out), 0.7 * (1 - 0.4 * u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          const R = reachOf('blessing_sanctuary', 4);
          const lasts = lastsOf('blessing_sanctuary', 30);
          const c = k.spot;
          const a = smooth(seg(age, 1.0, 1.3)) * smooth(left / 1);
          const ring = smooth(left / 1);
          k.ring(c, R, { band: 0.13, alpha: 0.75 * ring, turn: age * 0.05, glow: 0.5, n: 36 });
          // The posts burn down with the seconds it holds.
          sanctuaryPosts(k, R, 0.3 + 0.7 * clamp(left / lasts), a, age);
          k.light(c, R * 0.85, 0.35 * ring);
        },
      },
    },
  },

  /*
   * Second Life: down on one knee with the hands pressed to the brow, long,
   * then up and both arms thrown to the sky. A light goes up and comes down
   * on them, wings of light open behind them and fold into a halo, and the
   * halo stays over their head until the blow that would have killed them.
   */
  blessing_second_life: {
    palette: PALETTE,
    cast: {
      timing: { secs: 2.2, release: 0.6 },
      pose: (r, t) => {
        kneel(r, one(t, [[0, 0], [0.22, 1], [0.48, 1], [0.6, 0.15], [0.8, 0], [1, 0]]));
        both(r, t, [[0, REST], [0.22, [70, -12, 45]], [0.48, [74, -12, 45]], [0.6, [10, 155, 0]], [0.8, [12, 152, 0]], [1, REST]],
          [[0, 16], [0.22, 135], [0.48, 137], [0.6, 6], [0.8, 8], [1, 16]]);
        r.hand[0] = r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.6, [-20, 0, 0]], [1, [0, 0, 0]]]);
        r.open = [t > 0.05, t > 0.05];
        r.shrug = [one(t, [[0, 0], [0.5, 0], [0.6, 1], [0.8, 1], [1, 0]]), one(t, [[0, 0], [0.5, 0], [0.6, 1], [0.8, 1], [1, 0]])];
        r.head = euler(t, [[0, [0, 0, 0]], [0.22, [-20, 0, 0]], [0.48, [-24, 0, 0]], [0.62, [24, 0, 0]], [0.8, [20, 0, 0]], [1, [0, 0, 0]]]);
        r.neck = euler(t, [[0, [0, 0, 0]], [0.22, [-8, 0, 0]], [0.48, [-8, 0, 0]], [0.62, [8, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.22, [-8, 0, 0]], [0.48, [-10, 0, 0]], [0.62, [12, 0, 0]], [0.8, [10, 0, 0]], [1, [0, 0, 0]]]);
        r.spine = euler(t, [[0, [0, 0, 0]], [0.22, [-6, 0, 0]], [0.62, [4, 0, 0]], [1, [0, 0, 0]]]);
      },
    },
    fx: {
      charge: (k, t) => {
        const g = smooth(seg(t, 0.15, 0.5)) * (1 - seg(t, 0.58, 0.62));
        const at = mid3(k.hand(0), k.hand(1), 0.5);
        k.glow(at, 7, 0.8 * g);
        k.light(at, 2, 0.5 * g);
        rising(k, k.at(k.caster, 0.2), 14 * g, 0.25);
      },
      release: (k) => {
        k.flash(0.16);
        k.burst(mid3(k.hand(0), k.hand(1), 0.5), 24, { kind: 'spark', size: 1.8, life: [0.3, 0.6], speed: [0.2, 0.6], up: [20, 50], gravity: 30, drag: 0.2 });
      },
      travel: {
        secs: (tiles) => 0.42 + tiles * 0.05,
        draw: (k, u) => {
          // Up to the sky from the hands and down on them.
          const from = mid3(k.hand(0), k.hand(1), 0.5), to = lift(k.head(k.target), 3);
          const lt = 22 + k.dist * 2;
          const pts: P3[] = [];
          for (let i = 8; i >= 0; i--) pts.push(arcAt(from, to, clamp(u - i * 0.035), lt));
          const head = pts[pts.length - 1];
          k.ribbon(pts, { width: 3.6, taper: 'start', alpha: 0.95 });
          k.orb(head, 2.8, { turn: k.now * 4 });
          k.light(head, 2.4, 0.6);
        },
      },
      hit: (k) => {
        const h = k.head(k.target);
        k.burst(h, 26, { kind: 'mote', size: 2, life: [0.6, 1.1], speed: [0.1, 0.5], up: [-6, 12], gravity: 0 });
        k.burst(h, 16, { kind: 'spark', size: 1.6, life: [0.3, 0.55], speed: [0.5, 1.2], up: [0, 20], gravity: 30 });
      },
      impact: {
        secs: 1.9,
        draw: (k, u) => {
          const b = k.target;
          // Wings opened behind them, held, then folded up into the halo.
          const open = easeOut(seg(u, 0, 0.3)) * (1 - smooth(seg(u, 0.6, 0.9)));
          const a = 1 - smooth(seg(u, 0.75, 1));
          wings(k, { x: b.x, y: b.y, z: b.z }, k.at(b, 0.75), b.tall * 1.6, Math.max(0.02, open), a);
          if (u < 0.6 && !k.fast) k.emit(k.at(b, 0.75), 20, { kind: 'mote', size: 1.6, life: [0.6, 1.0], speed: [0.2, 0.5], up: [-6, 2], gravity: 0, jitter: 0.1 });
          k.light(b, 3, 0.7 * (1 - u * 0.7));
          k.flare(lift(k.head(b), 3), 12 * flashOf(u, 0.05), 1, k.pal.core);
        },
      },
      linger: {
        draw: (k, age, left) => {
          // Ten minutes: the halo over their head, and the odd mote off it.
          const b = k.target;
          const a = smooth(seg(age, 1.0, 1.7)) * smooth(left / 1.5);
          const at = lift(k.head(b), 3.4 + Math.sin(age * 1.4) * 0.3);
          hoop(k, at, 0.09, 0.062, 0, { alpha: (0.75 + 0.6 * Math.max(0, 1.9 - age)) * a, turn: age * 0.5, n: k.fast ? 10 : 14, glow: 0.8, back: 0.6 });
          if (!k.fast) k.emit(at, 0.8 * a, { kind: 'mote', size: 1.3, life: [0.8, 1.2], speed: [0.01, 0.04], up: [-4, -1], gravity: 0, jitter: 0.06 });
        },
      },
    },
  },

  /*
   * Radiance: the sun lifted in cupped hands from low before the body to
   * high over the head, and held there. A sun rises out of the spot and
   * hangs over it, rays laid across the ground to the edge of its reach and
   * beating once a second as it burns whatever hunts there; at the end it sets.
   */
  blessing_radiance: {
    palette: PALETTE,
    cast: {
      timing: { secs: 2.0, release: 0.55 },
      pose: (r, t) => {
        both(r, t, [[0, REST], [0.2, [30, -6, 20]], [0.36, [98, -2, 16]], [0.55, [176, 6, 0]], [0.84, [174, 8, 0]], [1, REST]],
          [[0, 16], [0.2, 46], [0.36, 40], [0.55, 6], [0.84, 8], [1, 16]]);
        r.hand[0] = r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.2, [-36, 0, 0]], [0.55, [-50, 0, 0]], [0.84, [-46, 0, 0]], [1, [0, 0, 0]]]);
        r.open = [t > 0.05, t > 0.05];
        const up = one(t, [[0, 0], [0.4, 0.4], [0.55, 1], [0.84, 1], [1, 0]]);
        r.shrug = [up, up];
        r.head = euler(t, [[0, [0, 0, 0]], [0.2, [-10, 0, 0]], [0.55, [28, 0, 0]], [0.84, [26, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.2, [-6, 0, 0]], [0.55, [12, 0, 0]], [0.84, [11, 0, 0]], [1, [0, 0, 0]]]);
        r.spine = euler(t, [[0, [0, 0, 0]], [0.2, [-14, 0, 0]], [0.55, [6, 0, 0]], [0.84, [5, 0, 0]], [1, [0, 0, 0]]]);
        // Up from a crouch to the toes as the sun goes up.
        stance(r, t, [[0, 0], [0.2, 24], [0.55, 0], [1, 0]]);
        r.lift = one(t, [[0, 0], [0.45, 0], [0.56, 0.5], [0.82, 0.5], [0.92, 0], [1, 0]]);
        r.foot = [one(t, [[0, 0], [0.45, 0], [0.56, -14], [0.82, -14], [0.92, 0]]), one(t, [[0, 0], [0.45, 0], [0.56, -14], [0.82, -14], [0.92, 0]])];
      },
    },
    fx: {
      charge: (k, t) => {
        const R = reachOf('blessing_radiance', 8);
        const g = smooth(seg(t, 0.2, 0.55));
        const at = k.on(k.spot.x, k.spot.y, lerp(1, RADIANCE_SUN, g));
        sun(k, at, 1.5 + 8.5 * g, k.now * 0.3, smooth(seg(t, 0.15, 0.25)));
        rays(k, at, 6 + 26 * g, { n: 12, alpha: 0.6 * g, turn: -k.now * 0.4 + 0.26, inner: 0.5 });
        k.ring(k.spot, R, { band: 0.1, alpha: 0.5 * g, dash: 8, turn: -k.now * 0.08, glow: 0.3 });
        k.light(k.spot, 2 + 4 * g, 0.6 * g);
        k.glow(mid3(k.hand(0), k.hand(1), 0.5), 6, 0.6 * bump(t, 0.1, 0.4, 0.6));
      },
      release: (k) => {
        k.flash(0.2);
        k.burst(k.on(k.spot.x, k.spot.y, RADIANCE_SUN), 40, { kind: 'spark', size: 2, life: [0.35, 0.7], speed: [1, 2.6], up: [-20, 20], gravity: 10, drag: 0.15 });
      },
      impact: {
        secs: 1.1,
        draw: (k, u) => {
          const R = reachOf('blessing_radiance', 8);
          const c = k.spot;
          const out = easeOut(seg(u, 0, 0.55));
          k.ring(c, 0.3 + (R - 0.3) * out, { band: 0.32 * (1 - 0.5 * out), alpha: 0.95 * (1 - seg(u, 0.6, 1)) });
          groundRays(k, c, 0.5, Math.max(0.6, R * out), 16, { alpha: 0.5 * (1 - seg(u, 0.5, 1)) + 0.2, turn: 0 });
          const high = k.on(c.x, c.y, RADIANCE_SUN);
          k.flare(high, 30 * flashOf(u, 0.05), 1, k.pal.core, u);
          k.ring(c, 0.55, { band: 0.12, alpha: smooth(u * 3), glow: 0.4 });
          k.light(c, R * (0.4 + 0.6 * out), 0.9);
        },
      },
      linger: {
        draw: (k, age, left) => {
          const R = reachOf('blessing_radiance', 8);
          const c = k.spot;
          const fade = smooth(left / 0.6);
          // It sets over its last second and a half: down toward the ground and dimming.
          const set = smooth(seg(1.6 - left, 0, 1.6));
          // A beat a second: the burn on whatever is hunting there.
          const beat = 1 - smooth((age % 1) / 0.45);
          const at = k.on(c.x, c.y, lerp(RADIANCE_SUN, 6, set));
          sun(k, at, 10 + 1.5 * beat, age * 0.3, fade);
          rays(k, at, 30 + 10 * beat, { n: 12, alpha: (0.35 + 0.45 * beat) * fade * (1 - set * 0.7), turn: -age * 0.4 + 0.26, inner: 0.5 });
          k.ring(c, 0.55, { band: 0.12, alpha: 0.8 * fade, turn: -age * 0.3, glow: 0.4 });
          groundRays(k, c, 0.6, R, 12, { alpha: (0.2 + 0.16 * beat) * fade * (1 - set * 0.6), turn: age * 0.04, spread: 0.1 });
          k.ring(c, R, { band: 0.12, alpha: (0.45 + 0.2 * beat) * fade, dash: 8, turn: age * 0.06, glow: 0.4, n: 36 });
          k.light(c, R * 0.9, (0.5 + 0.15 * beat) * fade * (1 - set * 0.5));
          if (!k.fast) {
            const an = k.rand() * TAU, rr = R * Math.sqrt(k.rand());
            k.emit(k.on(c.x + Math.cos(an) * rr, c.y + Math.sin(an) * rr, 24), 8, { kind: 'mote', size: 1.8, life: [0.6, 0.8], speed: [0, 0.02], up: [-34, -28], gravity: 0 });
          }
        },
      },
    },
  },

  /*
   * Bless the Land: down on one knee and bent to lay both palms flat on the
   * ground, then up slowly with the arms lifting as things grow. Green light
   * runs from the hands to the spot and out across the land to the edge of
   * its reach, sprouting as it goes.
   */
  blessing_land: {
    palette: PALETTE,
    cast: {
      timing: { secs: 2.4, release: 0.6 },
      pose: (r, t) => {
        kneel(r, one(t, [[0, 0], [0.22, 1], [0.66, 1], [0.86, 0.2], [1, 0]]));
        both(r, t, [[0, REST], [0.22, [34, 12, 4]], [0.32, [30, 12, 4]], [0.55, [28, 12, 4]], [0.62, [32, 12, 4]], [0.82, [20, 125, 0]], [0.9, [18, 128, 0]], [1, REST]],
          [[0, 16], [0.22, 10], [0.55, 14], [0.62, 10], [0.82, 14], [1, 16]]);
        r.hand[0] = r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.22, [40, 0, 0]], [0.6, [50, 0, 0]], [0.82, [-30, 0, 0]], [1, [0, 0, 0]]]);
        r.open = [t > 0.05, t > 0.05];
        r.spine = euler(t, [[0, [0, 0, 0]], [0.22, [-42, 0, 0]], [0.55, [-44, 0, 0]], [0.6, [-48, 0, 0]], [0.82, [4, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.22, [-15, 0, 0]], [0.6, [-16, 0, 0]], [0.82, [8, 0, 0]], [1, [0, 0, 0]]]);
        r.head = euler(t, [[0, [0, 0, 0]], [0.22, [18, 0, 0]], [0.6, [22, 0, 0]], [0.82, [18, 0, 0]], [1, [0, 0, 0]]]);
      },
    },
    fx: {
      charge: (k, t) => {
        // What the palms press into the ground seeps out round them, green and gold.
        const g = smooth(seg(t, 0.22, 0.58));
        const at = mid3(k.hand(0), k.hand(1), 0.5);
        const ground = k.on(at.x, at.y);
        k.ring(ground, 0.12 + 0.5 * g, { band: 0.08, alpha: 0.8 * g, main: LEAF, deep: LEAF_DEEP, ink: LEAF_INK, turn: k.now * 0.3, glow: 0.3 });
        k.disc(ground, 0.12 + 0.5 * g, { alpha: 0.2 * g, main: LEAF });
        k.glow(at, 6, 0.6 * g);
        if (g > 0.1) k.emit(ground, 10 * g, { kind: 'shard', colour: [LEAF, LEAF_DEEP], size: 1.4, life: [0.4, 0.7], speed: [0.05, 0.2], up: [4, 10], gravity: 10, drag: 0.4, jitter: 0.15, spin: 1 });
      },
      travel: {
        secs: (tiles) => 0.15 + tiles * 0.09,
        draw: (k, u) => {
          // Green light running over the ground from the hands to the spot.
          const from = k.on(k.caster.x, k.caster.y, 0.5), to = k.on(k.spot.x, k.spot.y, 0.5);
          const head = mid3(from, to, u);
          k.ribbon([mid3(from, to, Math.max(0, u - 0.4)), mid3(from, to, Math.max(0, u - 0.2)), head], { width: 3.4, taper: 'start', main: LEAF, ink: LEAF_INK, alpha: 0.9 });
          k.emit(head, 30, { kind: 'shard', colour: [LEAF, LEAF_DEEP, k.pal.main], size: 1.5, life: [0.4, 0.7], speed: [0.05, 0.2], up: [6, 14], gravity: 12, drag: 0.4, spin: 1 });
        },
      },
      hit: (k) => {
        k.burst(k.on(k.spot.x, k.spot.y, 1), 24, { kind: 'shard', colour: [LEAF, LEAF_DEEP, k.pal.main], size: 1.8, life: [0.6, 1.1], speed: [0.3, 0.8], up: [8, 20], gravity: 14, drag: 0.4, spin: 1.2 });
      },
      impact: {
        secs: 2.6,
        draw: (k, u) => {
          const R = reachOf('blessing_land', 10);
          const c = k.spot;
          const out = easeOut(seg(u, 0, 0.72));
          const front = 0.2 + (R - 0.2) * out;
          const end = 1 - smooth(seg(u, 0.72, 1));
          // The leading edge gold, the land it has passed over greener behind it.
          k.ring(c, front, { band: 0.3 * (1 - 0.4 * out), alpha: 0.95 * end, turn: u });
          k.ring(c, front * 0.93, { band: 0.5 * (1 - 0.4 * out), alpha: 0.75 * end, main: LEAF, deep: LEAF_DEEP, ink: LEAF_INK, turn: -u, glow: 0 });
          k.disc(c, front, { alpha: 0.16 * end, main: LEAF });
          // A field of sprouts, each up out of the ground as the edge passes over it, with a glint as it breaks through.
          const n = k.fast ? 8 : 16;
          for (let i = 0; i < n; i++) {
            const an = (i / n) * TAU + hashOf(k.seed, i) * 0.9;
            const rr = R * (0.12 + 0.86 * Math.sqrt(hashOf(k.seed + 11, i)));
            const since = seg(front - rr, 0, 1.6);
            if (since <= 0) continue;
            const base = k.on(c.x + Math.cos(an) * rr, c.y + Math.sin(an) * rr);
            sprout(k, base, 11 * easeBack(since) * (0.7 + 0.5 * hashOf(k.seed + 5, i)), end, hashOf(k.seed + 9, i) - 0.5);
            if (since < 0.5) k.flare(lift(base, 4), 6 * bump(since, 0, 0.1, 0.5), 1, k.pal.core);
          }
          if (out < 1) {
            const an = k.rand() * TAU;
            k.emit(k.on(c.x + Math.cos(an) * front, c.y + Math.sin(an) * front, 1), 90, { kind: 'shard', colour: [LEAF, k.pal.main], size: 2.2, life: [0.6, 1.0], speed: [0.05, 0.2], up: [10, 18], gravity: 10, drag: 0.4, spin: 1 });
          }
          k.light(c, front, 0.6 * end);
        },
      },
    },
  },
};

/* ---- what some of them share, below the record so the record reads first ---------------- */

/** Just before Ward's raised palm, where its plate is made. */
const wardPalm = (k: FxScene): P3 => {
  const h = k.hand(1), d = k.facingDir(k.caster);
  return { x: h.x + d.x * 0.05, y: h.y + d.y * 0.05, z: h.z + 1 };
};
/** Where Ward's plate set off from: the palm as it was at the release. */
const wardFrom = (k: FxScene): P3 => (k.state.z !== undefined ? { x: k.state.x, y: k.state.y, z: k.state.z } : wardPalm(k));

/** Where Steady Hands falls: on the hands holding the tool, or on a thing set down. */
function steadyAt(k: FxScene): P3 {
  return onSelf(k) ? mid3(k.hand(0), k.hand(1), 0.5) : k.on(k.spot.x, k.spot.y, 3);
}

/**
 * A gleam run along what is in somebody's right hand, `u` nought to one from
 * the fist out to its end, or a glint at the fist when the hand is empty. For
 * a thing set down, a glint where it stands. The run goes on out of the fist
 * the way the forearm points, as long again as the forearm: where a blade
 * held in a swing lies (`wield`), and near enough where one carried at the
 * hip hangs, which the figure does not say.
 */
function gleam(k: FxScene, u: number, a: number, b = k.caster): void {
  if (a <= 0.01 || u <= 0 || u >= 1) return;
  if (b === k.caster && !onSelf(k)) {
    k.flare(k.on(k.spot.x, k.spot.y, 3), 6 * bump(u, 0, 0.3, 1), a, k.pal.core, u * 2);
    return;
  }
  const h = k.hand(1, b);
  const armed = !!b.figure?.gear?.weapon;
  let p = h;
  if (armed) {
    const el = k.joint(b, 'elbow1', [0, 0, 0], 0.6), s = smooth(u);
    p = { x: h.x + (h.x - el.x) * s, y: h.y + (h.y - el.y) * s, z: h.z + (h.z - el.z) * s };
  }
  k.flare(p, (armed ? 6 : 5) * bump(u, 0, 0.25, 1), a, k.pal.core, u * 3);
}

/** Round the feet: a pip for every heal Renewal has, lit for those still to come, the next one swelling as it comes due. */
function renewalPips(k: FxScene, b: P3, count: number, done: number, since: number, a: number): void {
  if (a <= 0.01) return;
  const r = 0.2;
  const eye = k.eye;
  const lit = new Path2D(), spent = new Path2D();
  for (let i = 0; i < count; i++) {
    const an = -Math.PI / 2 + (i / count) * TAU;
    const x = b.x + Math.cos(an) * r, y = b.y + Math.sin(an) * r;
    const sx = eye.worldToScreenX(x, y), sy = eye.worldToScreenY(x, y, k.ground(x, y) + 0.15);
    // The next to fall swells as its time comes.
    const s = k.px(i === done ? 1.6 + 0.8 * smooth(since / 3) : 1.6);
    const into = i < done ? spent : lit;
    into.moveTo(sx, sy - s);
    into.lineTo(sx + s * 1.3, sy);
    into.lineTo(sx, sy + s);
    into.lineTo(sx - s * 1.3, sy);
    into.closePath();
  }
  const { core, deep, ink } = k.pal;
  const inkW = Math.max(0.7, 0.6 * k.zoom);
  k.groundDraw(b.x, b.y, r + 0.3, (g) => {
    g.lineWidth = inkW;
    g.strokeStyle = ink;
    g.globalAlpha = clamp(a * 0.4);
    g.fillStyle = deep;
    g.fill(spent);
    g.globalAlpha = clamp(a);
    g.fillStyle = core;
    g.fill(lit);
    g.stroke(lit);
  });
  k.ring(b, r + 0.06, { band: 0.03, alpha: 0.4 * a, glow: 0.3 });
}

/** How far out Shield of Dawn's dome stands from the middle of whoever is in it, in tiles. */
const shieldR = (b: { wide: number }): number => Math.max(0.16, b.wide * 0.045);

/** How high over its spot Benediction's halo gathers and pours its rain from, in height units. */
const BENEDICTION_SKY = 34;

/** How high Radiance's sun hangs over its spot, in height units: well over the head of anybody standing there. */
const RADIANCE_SUN = 40;

/** Sanctuary's posts, round the edge of what it holds, `h` of their full height, `a` how bright. */
function sanctuaryPosts(k: FxScene, R: number, h: number, a: number, age: number): void {
  if (a <= 0.01 || h <= 0.01) return;
  const c = k.spot;
  const n = k.fast ? 6 : 8;
  for (let i = 0; i < n; i++) {
    const an = (i / n) * TAU + Math.PI / 8;
    const base = k.on(c.x + Math.cos(an) * R, c.y + Math.sin(an) * R);
    const tall = 22 * h;
    post(k, base, tall, 4, a);
    k.glow(lift(base, tall * 0.5), 3 + tall * 0.3, a * 0.35);
    k.glow(lift(base, tall), 6, a * (0.6 + 0.2 * Math.sin(age * 3 + i)));
    if (!k.fast && age > 0) k.emit(lift(base, tall), 0.8 * a, { kind: 'mote', size: 1.4, life: [0.6, 1.0], speed: [0, 0.02], up: [6, 12], gravity: 0, jitter: 0.03 });
  }
}
