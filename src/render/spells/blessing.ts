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
import type { Euler, HandShape, Rig } from '../figure';
import type { SpellVisual } from './index';
import { spellInfo } from './info';
import { TAU, arcAt, bump, channelsOf, clamp, easeBack, easeOut, eatTail, flashOf, hashOf, lerp, mid3, seg, smooth, type Body, type BurstOpts, type FxScene, type P3, type SpellPalette } from './kit';
import { euler, heldFor, one, onSelf as castOnSelf, stepIn, type Key } from './poses';

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
const LEAF_CORE = '#e8f6c0';

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
 * Rays of light fanned round a point, in the picture's own plane: the dawn's
 * mark. Long and short by turns, `r` pixels at zoom one, starting `inner` of
 * the way out; `squash` flattens it to lie toward the ground. Laid over the
 * picture in the light's own gold and cream, as `shaft` is, rather than added
 * to it: added over grass, gold goes lime. After the night, so it still shines
 * in the dark, and a soft glow is added under it there only.
 */
function rays(k: FxScene, p: P3, r: number, o: { n?: number; alpha?: number; turn?: number; inner?: number; width?: number; short?: number; squash?: number; colour?: string } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r <= 0.2) return;
  // Going, the rays draw in more than they thin: half-clear gold over grass is olive.
  const n = o.n ?? 8, x = k.sx(p), y = k.sy(p), R = k.px(r) * (0.45 + 0.55 * clamp(a)), r0 = k.px(r) * (o.inner ?? 0.3), w = o.width ?? 0.13;
  const sq = o.squash ?? 1, turn = o.turn ?? 0, short = o.short ?? 0.58, outer = o.colour ?? k.pal.main, heart = k.pal.core;
  const fan = (g: CanvasRenderingContext2D, reach: number, wide: number): void => {
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const an = turn + (i / n) * TAU, len = Math.max(r0 * 1.05, R * reach * (i % 2 ? short : 1));
      g.moveTo(x + Math.cos(an - wide) * r0, y + Math.sin(an - wide) * r0 * sq);
      g.lineTo(x + Math.cos(an) * len, y + Math.sin(an) * len * sq);
      g.lineTo(x + Math.cos(an + wide) * r0, y + Math.sin(an + wide) * r0 * sq);
    }
    g.fill();
  };
  k.glowDraw((g) => {
    g.globalCompositeOperation = 'source-over';
    // The gold rays, and a cream heart down the middle of each.
    g.globalAlpha = clamp(Math.sqrt(a) * 0.7);
    g.fillStyle = outer;
    fan(g, 1, w);
    g.globalAlpha = clamp(Math.sqrt(a) * 0.85);
    g.fillStyle = heart;
    fan(g, 0.62, w * 0.45);
    g.globalCompositeOperation = 'lighter';
  });
  if (k.night > 0.05) k.glow(p, r * 0.7, a * 0.45 * k.night);
}

/**
 * A soft glow round something of the dawn's: by day laid over in its own gold
 * (added, gold over grass goes lime), and added in the light's cream by night,
 * where adding is what makes it shine.
 */
function warm(k: FxScene, p: P3, r: number, a: number): void {
  const n = k.night;
  if (n < 0.95) k.glow(p, r, a * 0.45 * (1 - n), k.pal.main, true);
  if (n > 0.05) k.glow(p, r, a * n);
}

/** A glint laid over in the dawn's own cream and gold, so it stays gold on grass: where light lands. */
const glint = (k: FxScene, p: P3, r: number, a: number, turn = 0): void => k.flare(p, r, a, k.pal.core, turn, k.pal.main, true);

/**
 * The dawn's sparks and motes: gold more than cream, and laid over (`over`)
 * rather than added, so they stay gold over grass instead of going lime, and
 * are not a white sparkle.
 */
const GOLD: readonly string[] = [PALETTE.main, PALETTE.main, PALETTE.core];

/**
 * The way into the picture over the ground, in tiles, a unit long: the way a
 * point goes up the screen fastest. What is that way of a body is behind it.
 */
function awayOf(k: FxScene, c: P3): { x: number; y: number } {
  const y0 = k.sy(c);
  const ex = k.sy({ x: c.x + 1, y: c.y, z: c.z }) - y0, ey = k.sy({ x: c.x, y: c.y + 1, z: c.z }) - y0;
  const l = Math.hypot(ex, ey) || 1;
  return { x: -ex / l, y: -ey / l };
}

interface HoopLook { alpha?: number; n?: number; turn?: number; main?: string; deep?: string; core?: string; ink?: string; glow?: number; dash?: number; back?: number; front?: number; wall?: boolean }
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
  if (o.wall) {
    // A wall round a whole area: its far half sorted at its far edge and its near half at its near edge, so all
    // that stands inside is behind the near half wherever in it they stand.
    const d = awayOf(k, c), R = Math.max(r0, r1);
    k.worldDraw({ x: c.x + d.x * R, y: c.y + d.y * R, z: c.z }, half(false), -0.5);
    k.worldDraw({ x: c.x - d.x * R, y: c.y - d.y * R, z: c.z }, half(true), 0.8);
  } else {
    const foot = { x: c.x, y: c.y, z: c.z };
    k.worldDraw(foot, half(false), -0.5);
    k.worldDraw(foot, half(true), 0.8);
  }
  const gl = o.glow ?? 1;
  // One soft glow, no bigger than a body's: a glow the size of Benediction's halo costs a great deal to draw and shows nothing more.
  if (gl > 0) warm(k, lift(c, dz / 2), Math.min(28, (rx / k.zoom) * 1.3), a * gl * 0.45);
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
  warm(k, p, r * 2.6, a * 0.55);
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
  warm(k, p, r * 4, a * 0.7);
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

/** Rays laid on the ground out from a spot, from `r0` to `r1` tiles: sunlight across the land, long and short by turns. */
function groundRays(k: FxScene, c: P3, r0: number, r1: number, n: number, o: { alpha?: number; turn?: number; spread?: number; colour?: string } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r1 <= r0 + 0.05) return;
  const turn = o.turn ?? 0, w = o.spread ?? 0.07;
  const paths: number[][] = [];
  for (let i = 0; i < n; i++) {
    const an = turn + (i / n) * TAU, len = i % 2 ? lerp(r0, r1, 0.62) : r1;
    paths.push([
      c.x + Math.cos(an - w) * r0, c.y + Math.sin(an - w) * r0,
      c.x + Math.cos(an) * len, c.y + Math.sin(an) * len,
      c.x + Math.cos(an + w) * r0, c.y + Math.sin(an + w) * r0,
    ]);
  }
  k.groundShape(c.x, c.y, r1 + 0.2, [{ kind: 'fill', colour: o.colour ?? k.pal.main, alpha: clamp(a * 0.8), paths, lift: 0.12, glow: 0.6 * k.night }]);
}

/**
 * Out of a wound: drops of blood lifted out of it that turn to gold as they
 * rise, and a few motes of gold with them. What every heal that stops
 * bleeding shows. `up` how fast they are lifted, height units a second.
 */
function mend(k: FxScene, at: P3, n: number, up: [number, number] = [10, 20]): void {
  k.burst(at, n, { kind: 'drop', colour: BLOOD, fade: k.pal.main, size: 2.3, sizeEnd: 1.2, life: [0.7, 1.1], speed: [0.04, 0.22], up, gravity: 6, drag: 0.3, jitter: 0.05, jitterZ: 2, bias: 3 });
  k.burst(at, Math.round(n * 0.5), { kind: 'mote', colour: [k.pal.main, k.pal.core], over: true, size: 1.2, life: [0.6, 1.1], speed: [0.03, 0.15], up: [up[0] * 0.8, up[1] * 0.9], gravity: 0, jitter: 0.08, jitterZ: 3 });
}

/** Light rising off someone: the dawn's gold motes going up, `perSecond`, laid over so they stay gold. */
const rising = (k: FxScene, at: P3, perSecond: number, spread = 0.12, size = 1.2): void =>
  k.emit(at, perSecond, { kind: 'mote', colour: [k.pal.main, k.pal.main, k.pal.core], over: true, size, life: [0.6, 1.2], speed: [0.01, 0.06], up: [8, 16], gravity: 0, jitter: spread, jitterZ: 2 });

/** Where a spell meets a body: the middle of a creature, the chest of a person. */
const heartOf = (k: FxScene, b = k.target): P3 => k.heart(b);
/** Where Soothe's band closes: a person's breastbone, two units under where a bolt goes in; a creature's middle. */
const sootheAt = (k: FxScene, b = k.target): P3 => lift(k.heart(b), b.kind === 'creature' ? 0 : -2);

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
  warm(k, lift(p, 1), r * 2.4, a * 0.45);
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
  warm(k, p, r * 2.2, a * 0.5);
}

/**
 * A sprout drawn at screen point (x, y): three blades and a gold bud, `H`
 * pixels tall, `W` pixels a blade's half-width, leaning `lean` (a share of its
 * height, to the right).
 */
function drawSprout(g: CanvasRenderingContext2D, k: FxScene, x: number, y: number, H: number, W: number, lean: number): void {
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
  g.strokeStyle = LEAF_INK;
  blade(-W * 2.2, H * 0.62, LEAF_DEEP);
  blade(W * 2.2, H * 0.7, LEAF_DEEP);
  blade(0, H, LEAF);
  const bx = x + lean * H * 0.2, by = y - H;
  g.fillStyle = k.pal.main;
  g.beginPath();
  g.moveTo(bx, by - W * 1.3);
  g.lineTo(bx + W * 0.9, by);
  g.lineTo(bx, by + W * 0.7);
  g.lineTo(bx - W * 0.9, by);
  g.closePath();
  g.fill();
  g.strokeStyle = k.pal.ink;
  g.stroke();
}

/**
 * A sapling drawn at screen point (x, y), `H` pixels tall: a stem, a faceted
 * crown of leaves lit on its left, and a gold bud at its top -- a young tree,
 * since what Bless the Land grows is trees, and a crown reads at play size
 * where blades of grass are lost in the grass.
 */
function drawSapling(g: CanvasRenderingContext2D, k: FxScene, x: number, y: number, H: number, lean: number): void {
  const tx = x + lean * H * 0.18, ty = y - H * 0.5, rr = H * 0.3, cx = x + lean * H * 0.22, cy = y - H * 0.68;
  g.strokeStyle = LEAF_INK;
  g.lineWidth = Math.max(1, H * 0.06);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(tx, ty);
  g.stroke();
  // Six facets round a heart up and to the left of the crown's middle: lit, mid and shaded.
  const hx = cx - rr * 0.2, hy = cy - rr * 0.25;
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const an = (i / 6) * TAU - Math.PI / 2;
    pts.push(cx + Math.cos(an) * rr * 0.9, cy + Math.sin(an) * rr * 1.05);
  }
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6, m = ((i + 0.5) / 6) * TAU - Math.PI / 2;
    const lit = -0.6 * Math.cos(m) - 0.8 * Math.sin(m);
    g.fillStyle = lit > 0.3 ? LEAF_CORE : lit > -0.4 ? LEAF : LEAF_DEEP;
    g.beginPath();
    g.moveTo(hx, hy);
    g.lineTo(pts[i * 2], pts[i * 2 + 1]);
    g.lineTo(pts[j * 2], pts[j * 2 + 1]);
    g.closePath();
    g.fill();
  }
  g.lineWidth = Math.max(0.7, 0.6 * k.zoom);
  g.beginPath();
  for (let i = 0; i < 6; i++) (i ? g.lineTo : g.moveTo).call(g, pts[i * 2], pts[i * 2 + 1]);
  g.closePath();
  g.stroke();
  const bx = cx, by = cy - rr * 1.05, W = Math.max(1.2, H * 0.07);
  g.fillStyle = k.pal.main;
  g.beginPath();
  g.moveTo(bx, by - W * 1.6);
  g.lineTo(bx + W, by);
  g.lineTo(bx, by + W * 0.6);
  g.lineTo(bx - W, by);
  g.closePath();
  g.fill();
  g.strokeStyle = k.pal.ink;
  g.stroke();
}

/** A sprout: three blades and a gold bud, `h` height units tall, out of the ground at `base`. */
function sprout(k: FxScene, base: P3, h: number, a: number, lean: number): void {
  if (a <= 0.01 || h <= 0.3) return;
  const x = k.sx(base), y = k.sy(base), H = k.hpx(h), W = k.px(2.2);
  k.worldDraw(base, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    g.lineWidth = Math.max(0.7, 0.6 * k.zoom);
    drawSprout(g, k, x, y, H, W, lean);
    g.lineJoin = 'round';
  });
  warm(k, lift(base, h), 4, a * 0.6);
}

/**
 * Bless the Land's plantings: clumps of three saplings each, scattered over
 * its reach where the cast's seed puts them, each clump one record. A clump
 * is up out of the ground once `front` (tiles from the spot) has passed it,
 * stands `grow` of its height and sways by `sway`; a glint as it breaks through.
 */
function landClumps(k: FxScene, R: number, front: number, grow: number, sway: number): void {
  if (grow <= 0.01) return;
  const c = k.spot, n = k.fast ? 6 : 8;
  for (let i = 0; i < n; i++) {
    const an = (i / n) * TAU + hashOf(k.seed, i) * 0.6;
    const rr = R * (0.2 + 0.72 * Math.sqrt(hashOf(k.seed + 11, i)));
    const since = seg(front - rr, 0, 1.6);
    if (since <= 0) continue;
    const at = { x: c.x + Math.cos(an) * rr, y: c.y + Math.sin(an) * rr };
    const tall = 18 + 6 * hashOf(k.seed + 5, i), h = tall * easeBack(since) * grow;
    if (h <= 0.3) continue;
    // Three to a clump, one tall and two smaller set a little apart round it.
    const pts: number[] = [];
    for (let j = 0; j < 3; j++) {
      const ja = hashOf(k.seed + 17 + j, i) * TAU, jr = 0.12 + 0.1 * j;
      const p = k.on(at.x + Math.cos(ja) * jr * (j ? 1 : 0.3), at.y + Math.sin(ja) * jr * (j ? 1 : 0.3));
      pts.push(k.sx(p), k.sy(p), k.hpx(h * (1 - 0.22 * j)), hashOf(k.seed + 9 + j, i) - 0.5 + sway * Math.sin(k.now * 1.6 + i + j));
    }
    // Drawn from the back, so the nearer sapling is over the one behind it.
    const order = [0, 1, 2].sort((p, q) => pts[p * 4 + 1] - pts[q * 4 + 1]);
    k.worldDraw(k.on(at.x, at.y), (g) => {
      g.globalAlpha = 1;
      g.lineJoin = 'miter';
      g.lineWidth = Math.max(0.7, 0.6 * k.zoom);
      for (const j of order) drawSapling(g, k, pts[j * 4], pts[j * 4 + 1], pts[j * 4 + 2], pts[j * 4 + 3]);
      g.lineJoin = 'round';
    });
    if (since < 0.5) glint(k, k.on(at.x, at.y, h * 0.8), 7 * bump(since, 0, 0.1, 0.5), 1);
  }
}

/** The sort bias for something on a body's back: behind it (negative) while it faces the viewer, in front once its back is turned to them. */
function behindOf(k: FxScene, b: Body): number {
  const f = k.facingDir(b), d = awayOf(k, b);
  return f.x * d.x + f.y * d.y > 0.2 ? 0.6 : -0.6;
}

/**
 * Wings of light opened behind somebody, in the picture's own plane: six
 * feathers a side fanned from the shoulders, `open` nought (folded up behind
 * the head) to one (spread). Drawn on the body's back: behind it when it
 * faces the viewer, in front of it when its back is to the viewer.
 */
function wings(k: FxScene, b: Body, at: P3, span: number, open: number, a: number): void {
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
  }, behindOf(k, b));
  warm(k, at, span * 0.9, a * 0.4 * open);
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

/** Both hands one shape, each share scaled by `w`: a hand opens into it and closes out of it with the weight. */
function shaped(r: Rig, s: HandShape, w = 1, left = true, right = true): void {
  const by: HandShape = {};
  for (const [name, v] of Object.entries(s) as Array<[keyof HandShape, number]>) by[name] = v * w;
  r.shape = [left ? by : r.shape?.[0], right ? by : r.shape?.[1]];
}

/** The middle of the chest, before the breastbone, in the body's own frame (`Rig.reach`): where a hand is laid on one's own heart. */
const OWN_HEART: [number, number, number] = [-0.35, 1.45, 8.7];

/** Feet a little apart and the knees easy, giving by `dip` degrees: a body standing to pray, not stiff. */
function stance(r: Rig, t: number, dip: ReadonlyArray<readonly [number, number]>, step: ReadonlyArray<readonly [number, number]> = [[0, 0]]): void {
  const d = one(t, dip), s = one(t, step);
  r.leg[0] = [STAND[0] + d * 0.5 + s, 3, 0];
  r.leg[1] = [STAND[0] + d * 0.5 - s * 0.6, 3, 0];
  r.knee[0] = 4 + d + s * 0.6;
  r.knee[1] = 4 + d;
}

/** Calm's flecks of setting light: gold embers sinking slowly, laid over so they stay gold. */
const CALM_FLECKS: BurstOpts = { kind: 'ember', colour: [PALETTE.main, PALETTE.deep], over: true, size: 1.2, life: [1.0, 1.6], speed: [0.02, 0.06], up: [-4, -1], gravity: 1, drag: 0.4, jitter: 0.15 };

/** Seconds Bless the Land's plantings stand on after it lands (the first 2.6 its run out over the land). */
const LAND_STAYS = 8;

/** Seconds Radiance's sun is held up over the head after it is let go. */
const RADIANCE_HOLD = 4;

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
      pose: (r, t, c) => {
        r.arm[0] = euler(t, [[0, REST], [0.22, ON_HEART], [0.8, ON_HEART], [1, REST]]);
        r.elbow[0] = one(t, [[0, 16], [0.22, ON_HEART_BEND], [0.8, ON_HEART_BEND - 4], [1, 16]]);
        // The smoothing hand: raised high and out over them, then stroked down through the air the length of a body,
        // palm turned down, the chest leaning into it.
        r.arm[1] = euler(t, [[0, REST], [0.2, [70, 18, -10]], [0.36, [118, 18, -8]], [0.55, [48, 6, 0]], [0.7, [44, 8, 0]], [1, REST]]);
        r.elbow[1] = one(t, [[0, 16], [0.2, 50], [0.36, 30], [0.55, 8], [0.7, 12], [1, 16]]);
        r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.36, [10, 0, 0]], [0.55, [-36, 0, 0]], [0.7, [-28, 0, 0]], [1, [0, 0, 0]]]);
        r.open = [t > 0.05, t > 0.05];
        shaped(r, { flat: 1 }, one(t, [[0, 0], [0.15, 1], [0.85, 1], [1, 0]]));
        if (castOnSelf(c)) {
          // On oneself the right hand is laid over the left on the heart, then smoothed down the breastbone.
          const w = one(t, [[0, 0], [0.2, 1], [0.8, 1], [1, 0]]);
          const down = smooth(seg(t, 0.4, 0.62));
          r.reach = [undefined, { at: [OWN_HEART[0] + 0.3, OWN_HEART[1] + 0.25, OWN_HEART[2] - 1.6 * down], w }];
        }
        r.spine = euler(t, [[0, [0, 0, 0]], [0.36, [5, 0, 0]], [0.55, [-12, 0, 0]], [0.72, [-10, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.36, [6, 0, 10]], [0.55, [-6, 0, -4]], [1, [0, 0, 0]]]);
        r.head = euler(t, [[0, [0, 0, 0]], [0.2, [-12, 6, 0]], [0.36, [4, 4, 0]], [0.55, [-16, 6, 0]], [0.75, [-12, 6, 0]], [1, [0, 0, 0]]]);
        stance(r, t, [[0, 0], [0.36, 2], [0.55, 14], [0.75, 12], [1, 0]], [[0, 0], [0.55, 10], [0.8, 8], [1, 0]]);
        // A short step in to them with the stroke, taken on the front foot.
        stepIn(r, t, c, { hit: 0.55, most: 3 });
      },
    },
    fx: {
      charge: (k, t) => {
        warm(k, k.hand(0), 5, 0.7 * bump(t, 0.1, 0.45, 0.9));
        const g = bump(t, 0.18, 0.48, 0.64);
        const h = k.hand(1);
        warm(k, h, 6, 0.8 * g);
        if (g > 0.15) k.emit(h, 20 * g, { kind: 'mote', colour: GOLD, over: true, size: 1.4, life: [0.3, 0.6], speed: [0.02, 0.08], up: [-8, -2], gravity: 0, jitter: 0.03 });
      },
      release: (k) => k.burst(k.hand(1), 6, { kind: 'mote', colour: GOLD, over: true, size: 1.6, life: [0.3, 0.6], speed: [0.1, 0.3], up: [0, 6], gravity: 0, heading: k.toward(k.caster, k.target), cone: 1.2 }),
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
      // The blood lifted out at the breastbone and only so high, so on oneself it does not go up over the face.
      hit: (k) => mend(k, sootheAt(k), 5, onSelf(k) ? [5, 9] : [8, 16]),
      impact: {
        secs: 0.9,
        draw: (k, u) => {
          const b = k.target, c = sootheAt(k);
          // The wound closing: a band round the breastbone drawn in tight, and a glint where it shuts.
          const close = smooth(seg(u, 0, 0.55));
          const r = lerp(0.17, 0.045, close);
          hoop(k, { x: b.x, y: b.y, z: c.z - 0.5 }, r, r * 0.92, 1, { alpha: 0.95 * (1 - seg(u, 0.55, 0.72)), turn: u * 2 });
          glint(k, c, 10 * bump(u, 0.5, 0.58, 0.95), 1, 0.4);
          k.light(b, 2, 0.5 * (1 - u));
          rising(k, k.at(b, 0.3), 8 * (1 - u));
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
      pose: (r, t, c) => {
        r.arm[0] = euler(t, [[0, REST], [0.2, PALMS], [0.3, PALMS], [0.45, ON_HEART], [0.82, ON_HEART], [1, REST]]);
        r.elbow[0] = one(t, [[0, 16], [0.2, PALMS_BEND], [0.45, ON_HEART_BEND], [0.82, ON_HEART_BEND], [1, 16]]);
        // The blessing hand: up beside the face, palm out, round the circle it draws, and set forward.
        // Raised high beside the head, the sun drawn round over it at the full stretch of the arm, then pushed out to them.
        r.arm[1] = euler(t, [[0, REST], [0.2, PALMS], [0.28, PALMS], [0.38, [156, 18, -6]], [0.46, [132, 34, -6]], [0.5, [124, 20, -6]], [0.57, [92, 4, -4]], [0.78, [88, 6, -4]], [1, REST]]);
        r.elbow[1] = one(t, [[0, 16], [0.2, PALMS_BEND], [0.28, PALMS_BEND], [0.38, 40], [0.46, 26], [0.5, 30], [0.57, 4], [0.78, 10], [1, 16]]);
        r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.38, [30, 0, 0]], [0.5, [40, 0, 0]], [0.57, [58, 0, 0]], [0.8, [40, 0, 0]], [1, [0, 0, 0]]]);
        r.open = [t > 0.05, t > 0.05];
        shaped(r, { flat: 1 }, one(t, [[0, 0], [0.15, 1], [0.85, 1], [1, 0]]));
        // On oneself the plate is set on one's own chest, the raised palm brought down flat on it.
        if (castOnSelf(c)) r.reach = [undefined, { at: [0.25, 1.5, 8.8], w: one(t, [[0.5, 0], [0.6, 1], [0.82, 1], [0.95, 0]]) }];
        r.head = euler(t, [[0, [0, 0, 0]], [0.2, [-14, 0, 0]], [0.28, [-16, 0, 0]], [0.42, [14, 0, 0]], [0.57, [-6, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.28, [-4, 0, 0]], [0.42, [10, 0, 14]], [0.57, [-6, 0, -6]], [1, [0, 0, 0]]]);
        r.spine = euler(t, [[0, [0, 0, 0]], [0.42, [6, 0, 0]], [0.57, [-12, 0, 0]], [0.8, [-9, 0, 0]], [1, [0, 0, 0]]]);
        stance(r, t, [[0, 0], [0.28, 10], [0.42, 0], [0.57, 14], [1, 0]], [[0, 0], [0.57, 12], [0.8, 10], [1, 0]]);
        stepIn(r, t, c, { hit: 0.57, most: 3 });
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
        warm(k, palm, 6, 0.7 * bump(t, 0.3, 0.5, 0.62));
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
          const from = wardFrom(k), to = heartOf(k), lt = 2 + k.dist * 0.6;
          const pts: P3[] = [];
          for (let i = 5; i >= 0; i--) pts.push(arcAt(from, to, smooth(clamp(u - i * 0.05)), lt));
          const p = pts[pts.length - 1];
          k.ribbon(pts, { width: 3.2, taper: 'start', alpha: 0.8 });
          plate(k, p, 4.2 - 0.6 * u, u * TAU * 1.5, 1);
          k.emit(p, 18, { kind: 'mote', colour: GOLD, over: true, size: 1.2, life: [0.2, 0.45], speed: [0.02, 0.08], up: [-2, 4], gravity: 0, jitter: 0.03 });
        },
      },
      hit: (k) => {
        k.burst(heartOf(k), 14, { kind: 'spark', colour: GOLD, over: true, size: 1.6, life: [0.2, 0.45], speed: [0.5, 1.2], up: [0, 16], gravity: 30, drag: 0.1 });
      },
      impact: {
        secs: 0.5,
        draw: (k, u) => {
          glint(k, heartOf(k), 9 * flashOf(u), 1, 0.3);
          k.light(k.target, 2, 0.5 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          // The plate goes slowly round them, turned to face out, until the blow it waits for: on an orbit tilted so it
          // rides low in front and up over the shoulder behind, and is never lost behind the body.
          const b = k.target;
          const a = held(age, left, 0.2, 1);
          const an = age * (TAU / 3.4) + 0.6;
          const d = awayOf(k, b), cs = Math.cos(an), sn = Math.sin(an);
          const behind = cs * d.x + sn * d.y;
          const orbit = { x: b.x + cs * 0.22, y: b.y + sn * 0.22, z: b.z + b.tall * (0.62 + 0.3 * behind) + Math.sin(age * 2.1) * 0.6 };
          const from = onSelf(k) ? wardFrom(k) : heartOf(k);
          const p = mid3(from, orbit, smooth(age / 0.4));
          plate(k, p, 3.4 * (1 + 0.25 * flashOf(clamp(age / 0.5))), an + Math.PI / 2, 0.9 * a);
          k.light(p, 0.8, 0.25 * a);
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
        const w = one(t, [[0, 0], [0.2, 1], [0.85, 1], [1, 0]]);
        r.shape = [{ cup: 0.6 * w }, { flat: w }];
      },
    },
    fx: {
      charge: (k, t) => {
        const g = bump(t, 0.2, 0.5, 0.62);
        const h = k.hand(1);
        warm(k, h, 6, 0.75 * g);
        if (g > 0.1) k.emit(h, 16 * g, { kind: 'shard', colour: [LEAF, LEAF_DEEP], size: 1.6, life: [0.4, 0.7], speed: [0.1, 0.25], up: [-2, 4], heading: k.toward(k.caster, k.target), cone: 0.9, gravity: 6, drag: 0.4, spin: 1 });
      },
      travel: {
        secs: (tiles) => 0.25 + tiles * 0.08,
        draw: (k, u) => {
          // A warm current over the ground, no higher than the grass, with leaves in it and sprouts left behind it.
          const from = k.on(k.caster.x, k.caster.y, 0.5), to = k.on(k.target.x, k.target.y, 0.5);
          const pts: P3[] = [];
          for (let i = 7; i >= 0; i--) {
            const v = clamp(u - i * 0.045);
            pts.push(lift(mid3(from, to, v), 0.6 + Math.sin(v * 14 - k.now * 3) * 0.3));
          }
          const head = pts[pts.length - 1];
          tendSprouts(k, u, 1);
          k.ribbon(pts, { width: 3.2, taper: 'start', alpha: 0.9 });
          k.orb(lift(head, 0.8), 1.8, { turn: k.now * 3 });
          k.emit(head, 14, { kind: 'shard', ink: false, colour: [LEAF, k.pal.main], size: 1.8, life: [0.35, 0.7], speed: [0.05, 0.2], up: [4, 10], gravity: 10, drag: 0.4, spin: 1.2 });
          k.light(head, 1.6, 0.4);
        },
      },
      hit: (k) => {
        mend(k, heartOf(k), 5);
        k.burst(k.at(k.target, 0.4), 6, { kind: 'shard', ink: false, colour: [LEAF, k.pal.main], size: 2.2, life: [0.6, 1.0], speed: [0.2, 0.5], up: [6, 16], gravity: 14, drag: 0.4, spin: 1.2 });
      },
      impact: {
        secs: 1.1,
        draw: (k, u) => {
          const b = k.target;
          // Not Soothe's level band: two green arcs come in round its flanks from either side, like two hands
          // closing on it, meet into one ring about it, and are taken back from their tails.
          const close = smooth(seg(u, 0, 0.5)), gone = smooth(seg(u, 0.62, 0.95));
          const R = lerp(0.36, 0.16, close) * Math.max(0.8, b.wide / 5);
          const z = k.at(b, 0.42).z;
          const ahead = k.toward(k.caster, b), base = Math.atan2(ahead.y, ahead.x);
          for (const s of [-1, 1]) {
            const pts: P3[] = [];
            const span = lerp(0.3, 0.52, close) * Math.PI;
            for (let i = 0; i <= 10; i++) {
              const an = base + s * (Math.PI / 2) + s * (i / 10 - 0.5) * 2 * span;
              pts.push({ x: b.x + Math.cos(an) * R, y: b.y + Math.sin(an) * R, z: z + Math.sin(i * 0.9 + u * 6) * 0.5 });
            }
            if (gone < 0.98) k.ribbon(eatTail(pts, gone), { width: 2.8, taper: 'both', main: LEAF, deep: LEAF_DEEP, core: LEAF_CORE, ink: LEAF_INK, light: LEAF, glow: 0.3, around: b });
          }
          tendSprouts(k, 1, 1 - smooth(seg(u, 0, 0.5)));
          k.flare(k.at(b, 0.42), 11 * bump(u, 0.46, 0.54, 0.9), 1, LEAF_CORE, 0.4, LEAF, true);
          k.light(b, 2.4, 0.55 * (1 - u));
          rising(k, k.at(b, 0.3), 8 * (1 - u), 0.2);
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
      pose: (r, t, c) => {
        if (castOnSelf(c)) {
          // Out of one's own middle: the hands start at the belly and haul up past the face.
          both(r, t, [[0, REST], [0.24, [30, -8, 34]], [0.36, [34, -8, 34]], [0.5, [110, 10, 10]], [0.6, [150, 22, 0]], [0.68, [15, 140, 0]], [0.82, [18, 136, 0]], [1, REST]],
            [[0, 16], [0.24, 96], [0.36, 100], [0.5, 84], [0.6, 84], [0.68, 16], [0.82, 18], [1, 16]]);
        } else {
          both(r, t, [[0, REST], [0.24, [84, 10, 8]], [0.36, [88, 8, 8]], [0.5, [128, 18, 4]], [0.6, [150, 22, 0]], [0.68, [15, 140, 0]], [0.82, [18, 136, 0]], [1, REST]],
            [[0, 16], [0.24, 16], [0.36, 22], [0.5, 70], [0.6, 84], [0.68, 16], [0.82, 18], [1, 16]]);
        }
        r.hand[0] = r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.24, [30, 0, 0]], [0.36, [40, 0, 0]], [0.6, [-20, 0, 0]], [0.7, [20, 0, 0]], [1, [0, 0, 0]]]);
        // Open over them, closed on what they draw out, flung open as it is let go.
        const open = t < 0.4 || t > 0.6;
        r.open = [open, open];
        const claw = one(t, [[0.3, 0], [0.38, 1], [0.58, 1], [0.63, 0]]), w = one(t, [[0, 0], [0.15, 1], [0.85, 1], [1, 0]]);
        r.shape = [{ claw, flat: (1 - claw) * w }, { claw, flat: (1 - claw) * w }];
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
        warm(k, mid3(k.hand(0), k.hand(1), 0.5), 6, 0.6 * bump(t, 0.1, 0.36, 0.62));
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
          // A sickly glow of its own about it, more by night, so the dark does not swallow it.
          const ill = 0.3 + 0.5 * k.night;
          k.ribbon(pts, { width: 2.4, taper: 'both', main: VENOM, core: VENOM_CORE, ink: k.night > 0.5 ? VENOM_DEEP : VENOM_INK, glow: ill, light: VENOM_CORE, alpha: 0.95 });
          k.orb(top, 1 + 2.6 * pull, { alpha: smooth(pull * 3), main: VENOM, deep: VENOM_DEEP, core: VENOM_CORE, ink: VENOM_INK, glow: ill, light: VENOM_CORE, turn: k.now * 5 });
        }
      },
      hit: (k) => {
        const top = k.at(k.target, 1.4);
        // What was drawn out burnt away in the dawn's fire.
        k.burst(top, 28, { kind: 'spark', colour: [k.pal.main, k.pal.deep], over: true, size: 2, life: [0.25, 0.55], speed: [0.6, 1.6], up: [0, 30], gravity: 30, drag: 0.1 });
        k.burst(top, 12, { kind: 'ember', colour: [k.pal.main, k.pal.deep], over: true, size: 2, life: [0.4, 0.8], speed: [0.1, 0.4], up: [6, 20], gravity: -4 });
        // A breath of pale smoke where it went, soon gone: not a cloud left hanging after the gold.
        k.burst(top, 5, { kind: 'mist', colour: '#efe6c8', size: 2.4, life: [0.3, 0.5], speed: [0.05, 0.15], up: [8, 14], bias: 2 });
      },
      impact: {
        secs: 1.0,
        draw: (k, u) => {
          const b = k.target, top = k.at(b, 1.4);
          glint(k, top, 14 * flashOf(u, 0.08), 1, u * 0.8);
          rays(k, top, 16 * easeOut(u * 2), { n: 10, alpha: 0.7 * (1 - smooth(u * 1.6)), turn: u * 0.5 });
          // The wash: a band of light going down them, head to foot, leaving them clean.
          const z = b.z + b.tall * (1.05 - 1.05 * smooth(seg(u, 0.1, 0.85)));
          hoop(k, { x: b.x, y: b.y, z }, 0.12, 0.12, 1.6, { alpha: bump(u, 0.05, 0.2, 1), turn: u * 3 });
          if (u < 0.8) k.emit(k.at(b, 0.5), 10, { kind: 'ember', colour: [k.pal.main, k.pal.deep], over: true, size: 1.4, life: [0.3, 0.6], speed: [0.05, 0.15], up: [6, 14], gravity: -2, jitter: 0.1, jitterZ: 5 });
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
        // Both palms raised high before the body, turned down, and pressed slowly down through the whole of the
        // cast to the hips: hush, settle. The body sinks with them and the head goes over on one side.
        both(r, t, [[0, REST], [0.25, [100, 18, -6]], [0.4, [80, 18, -6]], [0.55, [60, 17, -4]], [0.75, [32, 16, 0]], [0.88, [28, 16, 0]], [1, REST]],
          [[0, 16], [0.25, 30], [0.55, 20], [0.75, 14], [0.88, 14], [1, 16]]);
        r.hand[0] = r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.25, [26, 0, 0]], [0.55, [34, 0, 0]], [0.88, [30, 0, 0]], [1, [0, 0, 0]]]);
        r.open = [t > 0.05, t > 0.05];
        shaped(r, { flat: 1 }, one(t, [[0, 0], [0.2, 1], [0.9, 1], [1, 0]]));
        r.head = euler(t, [[0, [0, 0, 0]], [0.25, [-4, 8, 0]], [0.6, [-14, 16, 0]], [0.88, [-12, 16, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.25, [4, 0, 0]], [0.6, [-6, 3, 0]], [1, [0, 0, 0]]]);
        r.spine = euler(t, [[0, [0, 0, 0]], [0.25, [2, 0, 0]], [0.6, [-8, 0, 0]], [0.88, [-7, 0, 0]], [1, [0, 0, 0]]]);
        // The weight let down with the hands.
        stance(r, t, [[0, 0], [0.25, 0], [0.6, 18], [0.88, 16], [1, 0]]);
      },
    },
    fx: {
      charge: (k, t) => {
        const g = bump(t, 0.2, 0.5, 0.7);
        for (const s of [0, 1]) {
          const h = k.hand(s);
          warm(k, h, 5, 0.6 * g);
          if (g > 0.1) k.emit(h, 8 * g, { kind: 'mote', colour: GOLD, over: true, size: 1.4, life: [0.6, 1.0], speed: [0.01, 0.04], up: [-6, -3], gravity: 0, jitter: 0.02 });
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
        // Flecks of the setting light drifting down on it, slow: gold embers, not paper.
        k.burst(k.at(k.target, 1.25), 6, CALM_FLECKS);
      },
      impact: {
        secs: 1.6,
        draw: (k, u) => {
          // Ripples out from its feet, slow and thin, as on still water.
          for (let i = 0; i < 3; i++) {
            const v = seg(u, i * 0.2, i * 0.2 + 0.7);
            if (v <= 0 || v >= 1) continue;
            k.ring(k.target, 0.12 + 0.55 * easeOut(v), { band: 0.03, alpha: 0.45 * (1 - v), turn: i, main: k.pal.core, glow: 0.5 });
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
          if (v < 1 && age > 1.5) k.ring(b, 0.15 + 0.4 * easeOut(v), { band: 0.025, alpha: 0.35 * (1 - v) * a, main: k.pal.core, glow: 0.3 });
          if (!k.fast) k.emit(k.at(b, 1.35), 0.8 * a, CALM_FLECKS);
          k.light(p, 0.8, 0.25 * a);
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
      pose: (r, t, c) => {
        // Held low in both hands, the forearms level and the head bowed over it, long; then lifted before the face,
        // not over the head, so the shaft comes down on it in view.
        both(r, t, [[0, REST], [0.2, [14, -10, 26]], [0.4, [16, -10, 26]], [0.56, [118, -8, 20]], [0.62, [122, -8, 20]], [0.8, [120, -8, 20]], [1, REST]],
          [[0, 16], [0.2, 88], [0.4, 90], [0.56, 44], [0.62, 40], [0.8, 42], [1, 16]]);
        r.open = [false, false];
        r.head = euler(t, [[0, [0, 0, 0]], [0.2, [-24, 0, 0]], [0.4, [-28, 0, 0]], [0.58, [8, 0, 0]], [0.8, [6, 0, 0]], [1, [0, 0, 0]]]);
        r.neck = euler(t, [[0, [0, 0, 0]], [0.4, [-10, 0, 0]], [0.58, [4, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.4, [-8, 0, 0]], [0.6, [6, 0, 0]], [1, [0, 0, 0]]]);
        r.spine = euler(t, [[0, [0, 0, 0]], [0.4, [-6, 0, 0]], [0.6, [4, 0, 0]], [1, [0, 0, 0]]]);
        stance(r, t, [[0, 0], [0.4, 10], [0.58, 0], [1, 0]]);
        const w = one(t, [[0, 0], [0.2, 1], [0.85, 1], [1, 0]]);
        r.wield = w;
        // Both hands on it: the left closed on the haft below the right. With nothing in the hands, cupped as though it were.
        if (c.carry) r.both = w;
        else shaped(r, { cup: 1 }, w);
      },
    },
    fx: {
      charge: (k, t) => {
        const at = steadyAt(k);
        const s = smooth(seg(t, 0.3, 0.6)) * (1 - seg(t, 0.75, 1));
        shaft(k, at, 70, 2 + 1.2 * s, 0.6 * s, k.pal.core);
        warm(k, at, 6, 0.7 * s);
        // Empty-handed, what the cupped hands hold up is a little light of its own, so they are seen to hold something.
        if (onSelf(k) && !k.caster.figure?.gear?.weapon) {
          const g = smooth(seg(t, 0.12, 0.3)) * (1 - seg(t, 0.8, 0.95));
          k.orb(lift(at, 1), 1.6 + 0.6 * s, { alpha: g, turn: k.now * 2, sides: 6 });
        }
        if (s > 0.1) k.emit(lift(at, 30), 22 * s, { kind: 'mote', colour: GOLD, over: true, size: 1.5, life: [0.5, 0.8], speed: [0, 0.02], up: [-50, -36], gravity: 0, jitter: 0.03 });
      },
      release: (k) => {
        const at = steadyAt(k);
        k.burst(at, 16, { kind: 'mote', colour: GOLD, over: true, size: 1.8, life: [0.4, 0.8], speed: [0.1, 0.4], up: [4, 14], gravity: 0 });
      },
      impact: {
        secs: 0.9,
        draw: (k, u) => {
          const at = steadyAt(k);
          rays(k, at, 14 * easeOut(u * 1.5), { n: 8, alpha: 0.8 * (1 - smooth(u)), turn: u * 0.6 });
          glint(k, at, 8 * flashOf(u, 0.1), 1);
          gleam(k, u, 0.9);
          k.light(at, 2, 0.6 * (1 - u));
        },
      },
      linger: {
        draw: (k, age, left) => {
          // Half an hour: no more than a warmth at the hand and a glint along the tool every six seconds, the first at
          // two and a half, once the cast is done, to say the tool is blessed.
          const a = held(age, left, 0.5, 2);
          const at = steadyAt(k);
          warm(k, at, 3, 0.18 * a);
          const v = ((age + 3.5) % 6) / 0.7;
          if (v < 1) gleam(k, v, (age < 4 ? 1 : 0.7) * a);
          // The first of them with a small sun struck off the tool as well: the blessing taken.
          const first = seg(age, 2.5, 3.3);
          if (first > 0 && first < 1 && onSelf(k)) rays(k, steadyTool(k), 10 * easeOut(first * 2), { n: 8, alpha: (1 - smooth(first)) * a, turn: first });
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
      pose: (r, t, c) => {
        if (castOnSelf(c)) {
          // Lifted over one's own head and tipped, poured down over oneself.
          both(r, t, [[0, REST], [0.22, [34, -10, 22]], [0.42, [70, -16, 30]], [0.55, [150, -6, 14]], [0.72, [146, -4, 12]], [1, REST]],
            [[0, 16], [0.22, 34], [0.42, 100], [0.55, 70], [0.72, 66], [1, 16]]);
        } else {
          both(r, t, [[0, REST], [0.22, [34, -10, 22]], [0.42, [70, -16, 30]], [0.55, [96, 2, 12]], [0.72, [90, 6, 8]], [1, REST]],
            [[0, 16], [0.22, 34], [0.42, 100], [0.55, 24], [0.72, 22], [1, 16]]);
        }
        r.hand[0] = r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.22, [-30, 0, 0]], [0.42, [-40, 0, 0]], [0.55, [30, 0, 0]], [0.72, [36, 0, 0]], [1, [0, 0, 0]]]);
        r.open = [t > 0.05, t > 0.05];
        const cup = one(t, [[0.1, 0], [0.2, 1], [0.5, 1], [0.56, 0]]), flat = one(t, [[0.5, 0], [0.56, 1], [0.85, 1], [1, 0]]);
        r.shape = [{ cup, flat }, { cup, flat }];
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
        secs: (tiles) => (tiles < 0.3 ? 0.45 : 0.3 + tiles * 0.06),
        draw: (k, u) => {
          const from = mid3(k.hand(0), k.hand(1), 0.5);
          const pts: P3[] = [];
          if (onSelf(k)) {
            // Poured down over oneself from the cupped hands over the head: a short stream falling past the head
            // to the shoulders, drawn in under the hands to the body's middle as it falls.
            const b = k.caster, top = k.head(b).z + 2, foot = k.at(b, 0.72).z;
            const fall = lerp(from.z, foot, smooth(u)), tail = Math.min(from.z, fall + 6);
            for (let i = 0; i <= 6; i++) {
              const z = lerp(tail, fall, i / 6), w = clamp((from.z - z) / Math.max(1, from.z - top));
              pts.push({ x: lerp(from.x, b.x, 0.7 * w), y: lerp(from.y, b.y, 0.7 * w), z });
            }
          } else {
            // A stream poured out to them in a high arc, so it reads as poured from any side, drops falling off it.
            const to = lift(k.head(k.target), 2), lt = 10 + k.dist * 3;
            for (let i = 8; i >= 0; i--) pts.push(arcAt(from, to, clamp(u - i * 0.045), lt));
          }
          const head = pts[pts.length - 1];
          k.ribbon(pts, { width: 3.4, taper: 'start', alpha: 0.9 });
          k.emit(head, 34, { kind: 'drop', colour: [k.pal.main, k.pal.core], size: 1.6, life: [0.3, 0.5], speed: [0.02, 0.08], up: [-6, 0], gravity: 50, bias: 2 });
          k.light(head, 1.6, 0.4);
        },
      },
      hit: (k) => {
        const h = lift(k.head(k.target), 2);
        k.burst(h, 16, { kind: 'drop', colour: [k.pal.main, k.pal.core], size: 1.8, life: [0.4, 0.7], speed: [0.1, 0.3], up: [-2, 10], gravity: 50, bias: 3 });
        k.burst(h, 8, { kind: 'mote', colour: GOLD, over: true, size: 1.8, life: [0.4, 0.8], speed: [0.05, 0.2], up: [-6, 4], gravity: 0 });
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
          renewalPips(k, b, count, done, since, every, a);
          // A heal: a band climbing them, and light rising off them.
          if (done > 0 && since < 0.9) {
            const v = since / 0.9;
            hoop(k, { x: b.x, y: b.y, z: b.z + b.tall * smooth(v) * 0.9 }, 0.115, 0.115, 1.3, { alpha: 0.8 * bump(v, 0, 0.15, 1) * a, turn: v * 2, glow: 0.6 });
            rising(k, k.at(b, 0.4), 9 * (1 - v));
          }
          if (!k.fast) rising(k, k.at(b, 0.1), 1.5 * a, 0.15);
          k.light(b, 0.6, 0.2 * a);
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
      pose: (r, t, c) => {
        // The right hand flung straight up to the sky and held there, the body stretched up after it on its toes,
        // then brought down hard to point at their weapon hand with a step in to them.
        r.arm[1] = euler(t, [[0, REST], [0.16, [120, 22, -4]], [0.26, [172, 10, 0]], [0.42, [174, 10, 0]], [0.5, [80, 4, 0]], [0.64, [72, 6, 0]], [1, REST]]);
        r.elbow[1] = one(t, [[0, 16], [0.16, 40], [0.26, 4], [0.42, 4], [0.5, 4], [0.64, 10], [1, 16]]);
        r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.42, [-10, 0, 0]], [0.5, [-30, 0, 0]], [0.7, [-20, 0, 0]], [1, [0, 0, 0]]]);
        r.arm[0] = euler(t, [[0, REST], [0.2, ON_HEART], [0.8, ON_HEART], [1, REST]]);
        r.elbow[0] = one(t, [[0, 16], [0.2, ON_HEART_BEND], [0.8, ON_HEART_BEND], [1, 16]]);
        r.open = [t > 0.05, t > 0.05];
        const toes = one(t, [[0.14, 0], [0.26, 1], [0.42, 1], [0.5, 0]]);
        r.lift = 0.5 * toes;
        r.foot = [-14 * toes, -14 * toes];
        if (castOnSelf(c)) {
          // On oneself the blessed hand comes down closed on the weapon and stands it up before the face, blade to
          // the sky, to take the light.
          const up = one(t, [[0.44, 0], [0.52, 1], [0.8, 1], [0.92, 0]]);
          r.elbow[1] = one(t, [[0, 16], [0.16, 40], [0.26, 4], [0.42, 4], [0.52, 96], [0.8, 100], [1, 16]]);
          r.arm[1] = euler(t, [[0, REST], [0.16, [120, 22, -4]], [0.26, [172, 10, 0]], [0.42, [174, 10, 0]], [0.52, [52, -4, 14]], [0.8, [50, -4, 14]], [1, REST]]);
          r.reach = [undefined, { at: [0.6, 3.0, 13], haft: [0, 0.3, 1], w: up }];
          r.wield = one(t, [[0.42, 0], [0.5, 1], [0.85, 1], [0.95, 0]]);
          r.shape = [{ flat: one(t, [[0, 0], [0.2, 1], [0.8, 1], [1, 0]]) }, { cup: one(t, [[0.1, 0], [0.2, 1], [0.4, 1], [0.46, 0]]) }];
        } else {
          r.shape = [{ flat: one(t, [[0, 0], [0.2, 1], [0.8, 1], [1, 0]]) }, { cup: one(t, [[0.1, 0], [0.2, 1], [0.4, 1], [0.46, 0]]), two: one(t, [[0.42, 0], [0.48, 1], [0.75, 1], [0.9, 0]]) }];
        }
        r.shrug[1] = one(t, [[0, 0], [0.26, 1], [0.42, 1], [0.52, 0], [1, 0]]);
        r.head = euler(t, [[0, [0, 0, 0]], [0.26, [24, 0, -4]], [0.42, [22, 0, -4]], [0.52, [-12, 0, 0]], [0.7, [-10, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.26, [10, 0, -8]], [0.42, [10, 0, -8]], [0.5, [-8, 0, 6]], [0.7, [-5, 0, 4]], [1, [0, 0, 0]]]);
        r.spine = euler(t, [[0, [0, 0, 0]], [0.26, [5, 0, 0]], [0.42, [5, 0, 0]], [0.5, [-12, 0, 0]], [0.7, [-9, 0, 0]], [1, [0, 0, 0]]]);
        stance(r, t, [[0, 0], [0.42, 0], [0.5, 16], [0.75, 12], [1, 0]], [[0, 0], [0.42, 0], [0.5, 16], [0.8, 12], [1, 0]]);
        stepIn(r, t, c, { hit: 0.5, most: 3 });
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
        k.burst(h, 18, { kind: 'spark', colour: GOLD, over: true, size: 1.6, life: [0.2, 0.45], speed: [0.4, 1.2], up: [4, 22], gravity: 40, drag: 0.1 });
      },
      impact: {
        secs: 0.9,
        draw: (k, u) => {
          const b = k.target;
          const h = k.hand(1, b), el = k.joint(b, 'elbow1', [0, 0, 0], 0.6);
          glint(k, h, 12 * flashOf(u, 0.08), 1, 0.3);
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
          const on = smooth(seg(age, 0.6, 1));
          const cuff = mid3(h, el, 0.22);
          hoop(k, { x: cuff.x, y: cuff.y, z: cuff.z - 0.45 }, 0.035, 0.035, 0.9, { alpha: 0.95 * a * on, turn: age * 1.5, n: 10, glow: 0.8 });
          // And the weapon itself kept in the light: a gold sheen the length of it, breathing, so what is blessed is
          // the blade and not only the hand.
          if (b.figure?.gear?.weapon) {
            const grip = k.joint(b, 'grip'), tip = k.joint(b, 'tip');
            k.ribbon([mid3(grip, tip, 0.12), mid3(grip, tip, 0.55), tip], { width: 1.6, taper: 'both', main: k.pal.main, core: k.pal.core, alpha: (0.45 + 0.15 * Math.sin(age * 2.4)) * a * on, glow: 0.5 });
          }
          warm(k, h, 4, (0.3 + 0.1 * Math.sin(age * 4)) * a);
          if (!k.fast) k.emit(h, 3 * a, { kind: 'spark', colour: GOLD, over: true, size: 1.2, life: [0.2, 0.4], speed: [0.02, 0.1], up: [6, 14], gravity: 10, jitter: 0.02 });
          const v = ((age + 1) % 4) / 0.6;
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
        r.kneel = one(t, [[0, 0], [0.3, 1], [0.82, 1], [1, 0]]);
        r.arm[1] = euler(t, [[0, REST], [0.3, [38, 12, -20]], [0.45, [44, 10, -24]], [0.55, [52, 8, -24]], [0.8, [48, 8, -22]], [1, REST]]);
        r.elbow[1] = one(t, [[0, 16], [0.3, 20], [0.55, 10], [0.8, 12], [1, 16]]);
        r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.3, [-10, 0, -70]], [0.55, [-20, 0, -80]], [0.8, [-14, 0, -70]], [1, [0, 0, 0]]]);
        r.arm[0] = euler(t, [[0, REST], [0.3, [56, 10, 14]], [0.82, [56, 10, 14]], [1, REST]]);
        r.elbow[0] = one(t, [[0, 16], [0.3, 40], [0.82, 40], [1, 16]]);
        r.open = [t > 0.05, t > 0.05];
        r.shape = [{ cup: 0.5 * one(t, [[0, 0], [0.3, 1], [0.82, 1], [1, 0]]) }, { flat: one(t, [[0, 0], [0.25, 1], [0.85, 1], [1, 0]]) }];
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
          k.emit(p, 10, { kind: 'mote', colour: GOLD, over: true, size: 1.3, life: [0.3, 0.6], speed: [0, 0.03], up: [-2, 2], gravity: 0, jitter: 0.02 });
          k.light(p, 1.5, 0.45);
        },
      },
      hit: (k) => {
        k.burst(k.head(k.target), 12, { kind: 'mote', colour: GOLD, over: true, size: 1.8, life: [0.5, 0.9], speed: [0.05, 0.25], up: [4, 12], gravity: 0 });
      },
      impact: {
        secs: 1.2,
        draw: (k, u) => {
          glint(k, k.head(k.target), 8 * flashOf(u, 0.1), 1, 0.3);
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
          const bright = lerp(1, 0.5, smooth(seg(age, 1.2, 3)));
          const from = k.head(b), to = k.hand(1), sag = -1.5 - k.dist * 0.4;
          if (near > 0.01) {
            // Sorted just behind the caster and stopped a little short of the hand, thinning away there: sorted at
            // its nearer end, the creature's, it was drawn down over the caster's legs whenever the creature stood
            // nearer the viewer. The creature is drawn over its own end of it either way.
            const short = clamp(0.3 / Math.max(0.6, k.dist));
            const pts: P3[] = [];
            for (let i = 0; i <= 8; i++) pts.push(arcAt(from, to, (1 - short) * (1 - i / 8) * spun, sag));
            k.ribbon(pts, { width: 1.4, taper: 'none', alpha: 0.85 * bright * a * near, glow: 0.4 + 0.4 * k.night, sortAt: { x: k.caster.x, y: k.caster.y, z: k.caster.z }, bias: -1 });
            // Now and then a bead runs along it from the hand to the creature: the bond kept.
            const v = ((age + 2) % 3.5) / 0.9;
            if (v < 1 && age > 1.2) k.orb(arcAt(from, to, 1 - smooth(v), sag), 1.4, { alpha: a * near * bump(v, 0, 0.15, 1), glow: 0.6 });
          }
          const over = lift(k.at(b, 1.1), 2.5 + Math.sin(age * 1.6) * 0.5), shown = 0.9 * a * smooth(seg(age, 0.3, 0.9));
          knot(k, over, 4.5, shown, age * 0.9);
          k.light(over, 0.5, 0.2 * shown);
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
        shaped(r, { flat: 1 }, one(t, [[0, 0], [0.15, 1], [0.88, 1], [1, 0]]));
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
        const shown = smooth(seg(t, 0.1, 0.3)) * gone;
        benedictionHalo(k, Math.min(0.25 + 0.8 * g, benedictionHaloMost(k, R)), shown, 0);
        warm(k, sky, 10 + 14 * g, 0.5 * g * gone);
        dashedEdge(k, k.spot, R, 0.7 * g * (1 - seg(t, 0.55, 0.75)), k.now * 0.05);
        k.light(k.spot, 2 + 3 * g, 0.55 * g);
        for (const s of [0, 1]) if (g > 0.1) k.emit(k.hand(s), 10 * g, { kind: 'mote', colour: GOLD, over: true, size: 1.5, life: [0.5, 0.9], speed: [0.02, 0.08], up: [14, 24], gravity: 0, jitter: 0.03 });
      },
      hit: (k) => {
        const sky = k.on(k.spot.x, k.spot.y, BENEDICTION_SKY);
        k.burst(sky, 30, { kind: 'spark', colour: GOLD, over: true, size: 2, life: [0.3, 0.6], speed: [0.8, 2.2], up: [-10, 10], gravity: 20, drag: 0.1 });
      },
      impact: {
        secs: 1.8,
        draw: (k, u) => {
          const R = reachOf('blessing_benediction', 6);
          const c = k.spot;
          const sky = k.on(c.x, c.y, BENEDICTION_SKY);
          // The halo opens wide and pours itself out: gone by the time the rain is down.
          const open = easeOut(seg(u, 0, 0.45));
          benedictionHalo(k, Math.min(1.05 + 1.4 * open, benedictionHaloMost(k, R)), 1 - smooth(seg(u, 0.2, 0.55)), open);
          glint(k, sky, 16 * flashOf(u, 0.05), 1, u);
          // Its reach is the wash of light laid over it, the rain falling on it and a dashed line at its edge: not a
          // gold band, which is Sanctuary's and Radiance's.
          const out = easeOut(seg(u, 0, 0.5)), left = 1 - seg(u, 0.6, 1);
          k.disc(c, R * Math.max(0.05, out), { alpha: 0.2 * left, main: k.pal.core });
          dashedEdge(k, c, 0.2 + (R - 0.2) * out, left, u * 0.3);
          benedictionRain(k, c, R * Math.max(0.15, out), u * 1.8, seg(u, 0.08, 0.16) * (1 - seg(u, 0.62, 0.8)));
          if (u > 0.3 && u < 0.9) {
            const an = k.rand() * TAU, rr = R * Math.sqrt(k.rand());
            k.emit(k.on(c.x + Math.cos(an) * rr, c.y + Math.sin(an) * rr, 2), 15, { kind: 'mote', colour: GOLD, over: true, size: 1.4, life: [0.6, 1.0], speed: [0, 0.03], up: [10, 18], gravity: 0 });
          }
          k.light(c, R * (0.4 + 0.6 * out), 0.85 * (1 - u * u));
          // Everybody it mended and every wildermon it tended, as the rain gets to them (those the island said it did, or
          // where it did not say, everybody standing in it): nearer ones first.
          let n = 0;
          for (const b of k.reached(R, c)) {
            if (n >= BENEDICTION_MENDED) break;
            const v = seg(u, 0.18 + 0.3 * (Math.hypot(b.x - c.x, b.y - c.y) / R), 0.95);
            const key = `m${n++}`;
            if (v <= 0) continue;
            const heart = k.heart(b);
            if (!k.state[key]) {
              k.state[key] = 1;
              mend(k, heart, k.fast ? 3 : 5);
            }
            const r = lerp(0.16, 0.05, smooth(v * 1.6));
            hoop(k, { x: b.x, y: b.y, z: heart.z - 0.8 }, r, r * 0.92, 1.4, { alpha: 0.9 * bump(v, 0, 0.1, 0.6), turn: v * 2, n: 10, glow: 0.5 });
          }
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
        // Fists on the shoulders while the light is kept between the arms, then flung open flat.
        shaped(r, { flat: 1 }, one(t, [[0.42, 0], [0.5, 1], [0.85, 1], [1, 0]]));
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
        k.burst(k.chest(), 20, { kind: 'spark', colour: GOLD, over: true, size: 1.8, life: [0.2, 0.45], speed: [0.6, 1.4], up: [-4, 18], gravity: 20, drag: 0.1 });
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
        k.burst(k.at(k.target, 0.05), 18, { kind: 'mote', colour: GOLD, over: true, size: 1.8, life: [0.4, 0.8], speed: [0.3, 0.6], up: [2, 10], gravity: 0 });
      },
      impact: {
        secs: 1.1,
        draw: (k, u) => {
          const b = k.target;
          // Built up from the ground, course on course: a band of gold laid level round them at each course, each
          // rising into its place and drawn in to the dome's own width there -- the very profile of the shell that
          // stands after (`shieldEgg`), so the last course closes where the shell begins. Bands, not walls: a wall
          // of thin gold over them is olive, and hides them.
          const egg = shieldEgg(k, b), courses = 5;
          for (let i = 0; i < courses; i++) {
            const v = seg(u, i * 0.1, i * 0.1 + 0.22);
            if (v <= 0) continue;
            const h = ((i + 0.5) / courses) * egg.top * (0.7 + 0.3 * easeBack(v)), r = egg.at(h);
            hoop(k, { x: b.x, y: b.y, z: b.z + h - 0.6 }, r, r, 1.2, { alpha: smooth(v * 2) * (1 - seg(u, 0.7, 1)), turn: i * 0.3, n: k.fast ? 8 : 12, glow: 0.4, back: 0.55, front: 0.95 });
          }
          const crown = k.at(b, 1.15);
          rays(k, crown, 12 * bump(u, 0.45, 0.62, 1), { n: 10, alpha: 0.9, turn: u * 0.5 });
          glint(k, crown, 9 * bump(u, 0.45, 0.55, 0.9), 1);
          k.light(b, 2.8, 0.7 * (1 - u * 0.6));
        },
      },
      linger: {
        draw: (k, age, left) => {
          const b = k.target;
          const a = smooth(seg(age, 0.7, 1.2)) * smooth(left / 1);
          const breath = 0.5 + 0.5 * Math.sin(age * 2.2);
          // Its edge drawn strong in gold and its fill kept thin: thin gold over grass is olive, a gold line is gold.
          // Not the Warder's skin: no lit facets, a gold rim rather than an inked one, and a small sun on its crown.
          k.shell(b, { alpha: (0.7 + 0.1 * breath + 0.3 * Math.max(0, 1.6 - age)) * a, back: 0.22, lit: false, rim: 1.5, ink: k.night > 0.5 ? k.pal.core : k.pal.main, size: 1.05, turn: age * 0.3, glow: 0.5 });
          rays(k, k.at(b, 1.17), 7 + 1.5 * breath, { n: 8, alpha: 0.55 * a, squash: 0.6, turn: age * 0.2 });
          // Now and then the dawn goes over the top of it: a glint from one side to the other.
          const v = ((age + 2) % 4.5) / 1.1;
          if (v < 1) {
            const an = Math.PI * (0.15 + 0.7 * v);
            const p = k.local(b, Math.cos(an) * -6, 0, b.tall * (0.6 + 0.55 * Math.sin(an)));
            glint(k, p, 5 * bump(v, 0, 0.3, 1), a, v);
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
      pose: (r, t, c) => {
        // A staff of light (drawn by the effects) raised high in the right fist, then driven down into the ground
        // before the feet, the knees going with it; then both arms opened low and wide to mark the bounds, held.
        const OUT_LOW: E = [30, 80, -20];
        r.arm[1] = euler(t, [[0, REST], [0.3, [168, 8, 0]], [0.42, [172, 6, 0]], [0.5, [40, 4, 0]], [0.6, [36, 6, 0]], [0.72, OUT_LOW], [0.88, OUT_LOW], [1, REST]]);
        r.elbow[1] = one(t, [[0, 16], [0.3, 8], [0.42, 6], [0.5, 4], [0.6, 6], [0.72, 10], [0.88, 10], [1, 16]]);
        r.arm[0] = euler(t, [[0, REST], [0.3, ON_HEART], [0.6, ON_HEART], [0.72, OUT_LOW], [0.88, OUT_LOW], [1, REST]]);
        r.elbow[0] = one(t, [[0, 16], [0.3, ON_HEART_BEND], [0.6, ON_HEART_BEND], [0.72, 10], [0.88, 10], [1, 16]]);
        r.reach = [undefined, { at: [0.3, 3.2, 2], stoop: true, w: one(t, [[0.42, 0], [0.5, 1], [0.6, 1], [0.68, 0]]) }];
        r.open = [t > 0.05, t > 0.62];
        r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.5, [-20, 0, 0]], [0.72, [20, 0, 0]], [1, [0, 0, 0]]]);
        r.shape = [{ flat: one(t, [[0, 0], [0.2, 1], [0.88, 1], [1, 0]]) }, { flat: one(t, [[0.6, 0], [0.68, 1], [0.88, 1], [1, 0]]) }];
        r.shrug[1] = one(t, [[0, 0], [0.32, 0.8], [0.42, 0.8], [0.5, 0], [1, 0]]);
        r.head = euler(t, [[0, [0, 0, 0]], [0.32, [14, 0, -4]], [0.42, [14, 0, -4]], [0.5, [-20, 0, 0]], [0.62, [-16, 0, 0]], [0.8, [-6, 0, 0]], [1, [0, 0, 0]]]);
        r.spine = euler(t, [[0, [0, 0, 0]], [0.32, [5, 0, 0]], [0.42, [5, 0, 0]], [0.5, [-18, 0, 0]], [0.62, [-14, 0, 0]], [0.8, [-4, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.32, [6, 0, -8]], [0.5, [-6, 0, 4]], [0.8, [0, 0, 0]], [1, [0, 0, 0]]]);
        stance(r, t, [[0, 0], [0.42, 0], [0.5, 30], [0.6, 30], [0.75, 10], [0.88, 8], [1, 0]], [[0, 0], [0.42, 0], [0.5, 14], [0.82, 10], [1, 0]]);
        stepIn(r, t, c, { hit: 0.5, most: 3 });
      },
    },
    fx: {
      charge: (k, t) => {
        const g = bump(t, 0.15, 0.38, 0.56);
        const h = k.hand(1);
        warm(k, h, 6, 0.8 * g);
        k.light(h, 1.6, 0.4 * g);
        // The staff: a rod of light stood upright in the fist, raised with it and driven down with it till its foot
        // is in the ground, then left standing where it was planted as the hands open, and gone.
        const staff = smooth(seg(t, 0.1, 0.24)) * (1 - smooth(seg(t, 0.74, 0.9)));
        if (staff > 0.01) {
          const s = t >= 0.5 ? k.once('staff', () => k.hand(1)) : h;
          const ground = k.on(s.x, s.y).z, foot = Math.max(ground, s.z - 9), top = Math.max(foot + 12, s.z + 11);
          k.ribbon([{ x: s.x, y: s.y, z: foot }, { x: s.x, y: s.y, z: top }], { width: 2.2, taper: 'none', alpha: staff, glow: 0.4 });
          glint(k, { x: s.x, y: s.y, z: top }, 4, staff * 0.8, k.now);
        }
        // At the plant, light runs along the ground from the staff's foot out to the spot.
        const run = seg(t, 0.5, 0.58);
        if (run > 0 && t < 0.66) {
          const s = k.once('staff', () => k.hand(1)), from = k.on(s.x, s.y, 0.6), to = k.on(k.spot.x, k.spot.y, 0.6);
          k.ribbon([mid3(from, to, Math.max(0, run - 0.5)), mid3(from, to, run)], { width: 3, taper: 'start', alpha: 1 - seg(t, 0.58, 0.66) });
        }
        // The spot itself readied, a small ring gathering on it as the arm comes down.
        k.ring(k.spot, 0.35 * smooth(seg(t, 0.3, 0.55)), { band: 0.12, alpha: 0.8 * smooth(seg(t, 0.3, 0.5)) });
      },
      hit: (k) => {
        const at = k.on(k.spot.x, k.spot.y, 1);
        k.burst(at, 12, { kind: 'dust', colour: '#9a8a68', size: 3, life: [0.4, 0.8], speed: [0.4, 0.9], up: [2, 6], gravity: 2, drag: 0.1 });
        k.burst(at, 20, { kind: 'spark', colour: GOLD, over: true, size: 1.8, life: [0.25, 0.5], speed: [0.6, 1.4], up: [4, 20], gravity: 30, drag: 0.1 });
      },
      impact: {
        secs: 1.3,
        draw: (k, u) => {
          const R = reachOf('blessing_sanctuary', 4);
          const c = k.spot;
          shaft(k, k.on(c.x, c.y), 80, 4, flashOf(u, 0.05) * 0.8, k.pal.core);
          // A wave run out to the edge, which then stands up there as the fence: posts and a low wall between them.
          const out = easeOut(seg(u, 0, 0.42));
          k.ring(c, 0.2 + (R - 0.2) * out, { band: 0.22 * (1 - 0.7 * out), alpha: 0.95 * (1 - seg(u, 0.45, 0.7)) });
          sanctuaryFence(k, R, smooth(seg(u, 0.38, 0.75)), smooth(seg(u, 0.36, 0.6)) * (1 - seg(u, 0.77, 1)), 0);
          k.light(c, R * (0.3 + 0.7 * out), 0.7 * (1 - 0.4 * u));
        },
      },
      linger: {
        on: 'spot',
        draw: (k, age, left) => {
          const R = reachOf('blessing_sanctuary', 4);
          const lasts = lastsOf('blessing_sanctuary', 30);
          const c = k.spot;
          const a = smooth(seg(age, 1.0, 1.3)) * smooth(left / 1);
          const ring = smooth(left / 1);
          // Everybody within it kept: a band of gold at their feet, slowly turning, for as long as they stand inside.
          let n = 0;
          for (const b of k.bodiesWithin(R, c, ['player', 'peer'])) {
            if (n++ >= SANCTUARY_KEPT) break;
            k.ring(b, 0.2, { band: 0.04, alpha: 0.6 * a, turn: age * 0.6, dash: 4, glow: 0.4 });
          }
          // The fence stands for as long as it holds, its posts burning down with the seconds.
          sanctuaryFence(k, R, 0.3 + 0.7 * clamp(left / lasts), a, age);
          k.light(c, R * 0.6, 0.35 * ring);
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
        r.kneel = one(t, [[0, 0], [0.22, 1], [0.48, 1], [0.58, 0], [1, 0]]);
        both(r, t, [[0, REST], [0.22, [70, -12, 45]], [0.48, [74, -12, 45]], [0.6, [10, 155, 0]], [0.8, [12, 152, 0]], [1, REST]],
          [[0, 16], [0.22, 135], [0.48, 137], [0.6, 6], [0.8, 8], [1, 16]]);
        r.hand[0] = r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.6, [-20, 0, 0]], [1, [0, 0, 0]]]);
        r.open = [t > 0.05, t > 0.05];
        shaped(r, { flat: 1 }, one(t, [[0, 0], [0.15, 1], [0.88, 1], [1, 0]]));
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
        warm(k, at, 7, 0.8 * g);
        k.light(at, 2, 0.5 * g);
        rising(k, k.at(k.caster, 0.2), 14 * g, 0.25);
      },
      release: (k) => {
        k.flash(0.16);
        k.burst(mid3(k.hand(0), k.hand(1), 0.5), 24, { kind: 'spark', colour: GOLD, over: true, size: 1.8, life: [0.3, 0.6], speed: [0.2, 0.6], up: [20, 50], gravity: 30, drag: 0.2 });
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
        k.burst(h, 26, { kind: 'mote', colour: GOLD, over: true, size: 2, life: [0.6, 1.1], speed: [0.1, 0.5], up: [-6, 12], gravity: 0 });
        k.burst(h, 16, { kind: 'spark', colour: GOLD, over: true, size: 1.6, life: [0.3, 0.55], speed: [0.5, 1.2], up: [0, 20], gravity: 30 });
      },
      impact: {
        secs: 1.9,
        draw: (k, u) => {
          const b = k.target;
          // Wings opened behind them, held, then folded up into the halo.
          const open = easeOut(seg(u, 0, 0.3)) * (1 - smooth(seg(u, 0.6, 0.9)));
          const a = 1 - smooth(seg(u, 0.75, 1));
          wings(k, b, k.at(b, 0.75), b.tall * 1.6, Math.max(0.02, open), a);
          if (u < 0.6 && !k.fast) k.emit(k.at(b, 0.75), 20, { kind: 'mote', colour: GOLD, over: true, size: 1.6, life: [0.6, 1.0], speed: [0.2, 0.5], up: [-6, 2], gravity: 0, jitter: 0.1 });
          k.light(b, 3, 0.7 * (1 - u * 0.7));
          glint(k, lift(k.head(b), 3), 12 * flashOf(u, 0.05), 1);
        },
      },
      linger: {
        draw: (k, age, left) => {
          // Ten minutes: the halo over their head, and the odd mote off it.
          const b = k.target;
          const a = smooth(seg(age, 1.0, 1.7)) * smooth(left / 1.5);
          // Clear of the hair, so it is a halo over the head and not a brim on it.
          const at = lift(k.head(b), 5.5 + Math.sin(age * 1.4) * 0.3);
          hoop(k, at, 0.075, 0.05, 0, { alpha: (0.75 + 0.6 * Math.max(0, 1.9 - age)) * a, turn: age * 0.5, n: k.fast ? 10 : 14, glow: 0.8, back: 0.6 });
          if (!k.fast) k.emit(at, 0.8 * a, { kind: 'mote', colour: GOLD, over: true, size: 1.2, life: [0.8, 1.2], speed: [0.01, 0.04], up: [-4, -1], gravity: 0, jitter: 0.06 });
          k.light(at, 0.5, 0.15 * a);
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
      // The sun held up a while after it is let go, the arms giving a little with each beat of it, then let down.
      hold: { at: 0.7, secs: RADIANCE_HOLD },
      pose: (r, t, c) => {
        both(r, t, [[0, REST], [0.2, [30, -6, 20]], [0.36, [98, -2, 16]], [0.55, [176, 6, 0]], [0.84, [174, 8, 0]], [1, REST]],
          [[0, 16], [0.2, 46], [0.36, 40], [0.55, 6], [0.84, 8], [1, 16]]);
        const beat = heldFor(c) > 0 ? 1 - smooth(((heldFor(c) * RADIANCE_HOLD) % 1) / 0.45) : 0;
        r.elbow[0] += 10 * beat;
        r.elbow[1] += 10 * beat;
        r.shape = [{ cup: one(t, [[0.05, 0], [0.18, 1], [0.86, 1], [1, 0]]) }, { cup: one(t, [[0.05, 0], [0.18, 1], [0.86, 1], [1, 0]]) }];
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
        // Up to the release this is the sun rising; after it the linger has the sun, and this only the hands holding it up.
        const up = 1 - seg(t, 0.55, 0.57);
        sun(k, at, 1.5 + 8.5 * g, k.now * 0.3, smooth(seg(t, 0.15, 0.25)) * up);
        rays(k, at, 6 + 26 * g, { n: 12, alpha: 0.6 * g * up, turn: -k.now * 0.4 + 0.26, inner: 0.5 });
        k.ring(k.spot, R, { band: 0.1, alpha: 0.5 * g * up, dash: 8, turn: -k.now * 0.08, glow: 0.3 });
        k.light(k.spot, 2 + 4 * g, 0.6 * g * up);
        const hands = mid3(k.hand(0), k.hand(1), 0.5);
        warm(k, hands, 6, 0.6 * bump(t, 0.1, 0.4, 0.6));
        // Held up: the cupped hands still lit, and a thin line of light from them to the sun they keep there.
        const keep = seg(t, 0.58, 0.68) * (1 - seg(t, 0.72, 0.8));
        if (keep > 0.01) {
          warm(k, hands, 5, 0.55 * keep);
          k.beam(hands, k.on(k.spot.x, k.spot.y, RADIANCE_SUN), { width: 1, alpha: 0.3 * keep, glow: 0.3 });
        }
      },
      release: (k) => {
        k.flash(0.2);
        k.burst(k.on(k.spot.x, k.spot.y, RADIANCE_SUN), 40, { kind: 'spark', colour: GOLD, over: true, size: 2, life: [0.35, 0.7], speed: [1, 2.6], up: [-20, 20], gravity: 10, drag: 0.15 });
      },
      impact: {
        secs: 1.1,
        draw: (k, u) => {
          const R = reachOf('blessing_radiance', 8);
          const c = k.spot;
          const out = easeOut(seg(u, 0, 0.55));
          k.ring(c, 0.3 + (R - 0.3) * out, { band: 0.32 * (1 - 0.5 * out), alpha: 0.95 * (1 - seg(u, 0.6, 1)) });
          groundRays(k, c, 0.5, Math.max(0.6, R * out), 12, { alpha: 0.5 * (1 - seg(u, 0.5, 1)) + 0.3, turn: 0, spread: 0.14 });
          const high = k.on(c.x, c.y, RADIANCE_SUN);
          glint(k, high, 30 * flashOf(u, 0.05), 1, u);
          k.light(c, R * (0.4 + 0.2 * out), 0.9);
        },
      },
      linger: {
        on: 'spot',
        draw: (k, age, left) => {
          const R = reachOf('blessing_radiance', 8);
          const c = k.spot;
          const fade = smooth(left / 0.6);
          // It sets over its last second and a half: down toward the ground and dimming.
          const set = smooth(seg(1.6 - left, 0, 1.6));
          // A beat a second: the burn on whatever is hunting there.
          const beat = 1 - smooth((age % 1) / 0.45);
          const sunZ = lerp(RADIANCE_SUN, 6, set), at = k.on(c.x, c.y, sunZ);
          sun(k, at, 14 + 2 * beat, age * 0.3, fade);
          rays(k, at, 34 + 10 * beat, { n: 12, alpha: (0.35 + 0.45 * beat) * fade * (1 - set * 0.7), turn: -age * 0.4 + 0.26, inner: 0.5 });
          // A faint shaft from the sun down to its spot, so it reads as hung over that ground.
          shaft(k, k.on(c.x, c.y), sunZ, 3, 0.2 * fade, k.pal.core);
          groundRays(k, c, 0.6, R, 12, { alpha: (0.55 + 0.2 * beat) * fade * (1 - set * 0.6), turn: age * 0.04, spread: 0.16, colour: k.pal.light });
          k.ring(c, R, { band: 0.12, alpha: (0.45 + 0.2 * beat) * fade, dash: 8, turn: age * 0.06, glow: 0.4 + 0.6 * k.night, main: k.night > 0.5 ? k.pal.core : k.pal.main, n: 36 });
          k.light(c, R * 0.6, (0.5 + 0.15 * beat) * fade * (1 - set * 0.5));
          // Each beat burns every wild creature within it that is hunting somebody: a beam let down on it from the sun, a gold
          // band drawn in tight round it, and sparks struck off it, once a second.
          const second = Math.floor(age);
          const struck = second > (k.state.beat ?? -1) && fade > 0.2;
          if (struck) k.state.beat = second;
          const v = (age % 1) / 0.4;
          let n = 0;
          for (const b of k.enemiesWithin(R, c)) {
            if (!b.hostile) continue;
            if (n++ >= RADIANCE_BURNT) break;
            const p = k.at(b, 0.5);
            if (beat * fade > 0.02) k.beam(at, p, { width: 2, alpha: 0.6 * beat * fade, glow: 0.5 });
            if (v < 1) hoop(k, { x: b.x, y: b.y, z: p.z - 1 }, lerp(0.18, 0.1, smooth(v)) * Math.max(0.8, b.wide / 5), lerp(0.18, 0.1, smooth(v)) * Math.max(0.8, b.wide / 5), 2, { alpha: (1 - smooth(v)) * fade, turn: age, n: 10, glow: 0.5 });
            glint(k, p, 8 * beat * fade, 0.9, age);
            if (struck) k.burst(p, k.fast ? 3 : 8, { kind: 'spark', colour: [k.pal.main, k.pal.deep], over: true, size: 1.6, life: [0.2, 0.45], speed: [0.3, 0.9], up: [6, 18], gravity: 30, drag: 0.1 });
          }
          if (!k.fast) {
            const an = k.rand() * TAU, rr = R * Math.sqrt(k.rand());
            k.emit(k.on(c.x + Math.cos(an) * rr, c.y + Math.sin(an) * rr, 24), 8, { kind: 'mote', colour: GOLD, over: true, size: 1.8, life: [0.6, 0.8], speed: [0, 0.02], up: [-34, -28], gravity: 0 });
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
        r.kneel = one(t, [[0, 0], [0.22, 1], [0.66, 1], [0.84, 0], [1, 0]]);
        // Both palms flat on the ground before the knee, bowed down to it as far as it takes.
        const press = one(t, [[0.08, 0], [0.24, 1], [0.6, 1], [0.7, 0]]);
        r.reach = [{ at: [-0.85, 4.2, 0.7], stoop: true, w: press }, { at: [0.85, 4.2, 0.7], stoop: true, w: press }];
        both(r, t, [[0, REST], [0.22, [34, 12, 4]], [0.32, [30, 12, 4]], [0.55, [28, 12, 4]], [0.62, [32, 12, 4]], [0.82, [20, 125, 0]], [0.9, [18, 128, 0]], [1, REST]],
          [[0, 16], [0.22, 10], [0.55, 14], [0.62, 10], [0.82, 14], [1, 16]]);
        r.hand[0] = r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.22, [40, 0, 0]], [0.6, [50, 0, 0]], [0.82, [-30, 0, 0]], [1, [0, 0, 0]]]);
        r.open = [t > 0.05, t > 0.05];
        shaped(r, { flat: 1 }, one(t, [[0, 0], [0.18, 1], [0.9, 1], [1, 0]]));
        r.spine = euler(t, [[0, [0, 0, 0]], [0.22, [-16, 0, 0]], [0.6, [-18, 0, 0]], [0.82, [4, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = euler(t, [[0, [0, 0, 0]], [0.22, [-8, 0, 0]], [0.6, [-8, 0, 0]], [0.82, [8, 0, 0]], [1, [0, 0, 0]]]);
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
        warm(k, at, 6, 0.6 * g);
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
          // The edge runs out at a pace that can be followed, not most of the way in the first frames.
          const v = seg(u, 0, 0.8), out = lerp(v, smooth(v), 0.5);
          const front = 0.2 + (R - 0.2) * out;
          const end = 1 - smooth(seg(u, 0.8, 1));
          // The leading edge gold with a narrow green one inside it: the land it has passed over is the clumps.
          k.ring(c, front, { band: 0.24 * (1 - 0.4 * out), alpha: 0.95 * end, turn: u });
          k.ring(c, front - 0.2, { band: 0.12 * (1 - 0.3 * out), alpha: 0.75 * end, main: LEAF_DEEP, deep: LEAF_INK, ink: LEAF_INK, turn: -u, glow: 0 });
          // Plantings up out of the ground as the edge passes over them; they stay on into the linger.
          landClumps(k, R, front, 1, 0);
          if (out < 1) {
            const an = k.rand() * TAU;
            k.emit(k.on(c.x + Math.cos(an) * front, c.y + Math.sin(an) * front, 1), 50, { kind: 'shard', ink: false, colour: [LEAF, k.pal.main], size: 2, life: [0.6, 1.0], speed: [0.05, 0.2], up: [10, 18], gravity: 10, drag: 0.4, spin: 1 });
          }
          k.light(c, Math.min(front, R * 0.6), 0.6 * end);
        },
      },
      linger: {
        // A while after, the land stays blessed: the plantings sway, and a faint ring of leaves stays at the reach,
        // till they sink back.
        on: 'spot',
        secs: LAND_STAYS,
        draw: (k, age, left) => {
          const R = reachOf('blessing_land', 10);
          if (age < 2.6) return;
          const a = smooth(left / 1.5);
          landClumps(k, R, R + 2, smooth(left / 1.2), 0.25 * smooth(seg(age, 2.6, 3.2)));
          k.ring(k.spot, R, { band: 0.08, alpha: 0.5 * a, main: LEAF, deep: LEAF_DEEP, ink: LEAF_INK, turn: age * 0.05, glow: 0.4 * k.night, light: LEAF });
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

/**
 * Tend's sprouts along the way its current ran, from the caster to the
 * creature: each up out of the ground as the current's head passes it (`u`
 * how far the head has got), and sunk back as `a` goes.
 */
function tendSprouts(k: FxScene, u: number, a: number): void {
  if (a <= 0.01) return;
  const from = k.caster, to = k.target;
  for (let i = 0; i < 4; i++) {
    const f = 0.18 + i * 0.19;
    const up = seg(u, f, f + 0.25);
    if (up <= 0) continue;
    const side = (hashOf(k.seed, i) - 0.5) * 0.16;
    const d = k.toward(from, to);
    const x = lerp(from.x, to.x, f) - d.y * side, y = lerp(from.y, to.y, f) + d.x * side;
    sprout(k, k.on(x, y), 4.5 * easeBack(up) * a * (0.8 + 0.4 * hashOf(k.seed + 3, i)), 1, hashOf(k.seed + 7, i) - 0.5);
  }
}

/** Where Steady Hands falls: on the hands holding the tool, or on a thing set down. */
function steadyAt(k: FxScene): P3 {
  return onSelf(k) ? mid3(k.hand(0), k.hand(1), 0.5) : k.on(k.spot.x, k.spot.y, 3);
}

/** The middle of the tool in the caster's hand, wherever the carry has it; the hand when it holds nothing. */
function steadyTool(k: FxScene): P3 {
  const b = k.caster;
  return b.figure?.gear?.weapon ? mid3(k.joint(b, 'grip'), k.joint(b, 'tip'), 0.5) : k.hand(1, b);
}

/**
 * A gleam run along what is in somebody's right hand, `u` nought to one from
 * the fist to its point, wherever the carry or the cast has it; a glint at
 * the fist when the hand is empty. For a thing set down, a glint where it stands.
 */
function gleam(k: FxScene, u: number, a: number, b = k.caster): void {
  if (a <= 0.01 || u <= 0 || u >= 1) return;
  if (b === k.caster && !onSelf(k)) {
    glint(k, k.on(k.spot.x, k.spot.y, 3), 6 * bump(u, 0, 0.3, 1), a, u * 2);
    return;
  }
  const armed = !!b.figure?.gear?.weapon;
  const p = armed ? mid3(k.joint(b, 'grip'), k.joint(b, 'tip'), smooth(u)) : k.hand(1, b);
  glint(k, p, (armed ? 6 : 5) * bump(u, 0, 0.25, 1), a, u * 3);
}

/** Round the feet: a pip for every heal Renewal has, lit for those still to come, the next one swelling as it comes due. */
function renewalPips(k: FxScene, b: P3, count: number, done: number, since: number, every: number, a: number): void {
  if (a <= 0.01) return;
  const r = 0.22;
  const lit: number[][] = [], spent: number[][] = [];
  // The next to fall swells to more than twice its size through its last second, and glows, so the count is seen going.
  const due = smooth(seg(since, every - 1, every));
  let dueAt: P3 | null = null;
  for (let i = 0; i < count; i++) {
    const an = -Math.PI / 2 + (i / count) * TAU, cs = Math.cos(an), sn = Math.sin(an);
    const x = b.x + cs * r, y = b.y + sn * r;
    const s = i === done ? 1 + 1.2 * due : 1;
    if (i === done) dueAt = k.on(x, y, 0.5);
    const along = 0.05 * s, across = 0.03 * s;
    (i < done ? spent : lit).push([x - sn * along, y + cs * along, x + cs * across, y + sn * across, x + sn * along, y - cs * along, x - cs * across, y - sn * across]);
  }
  const { main, core, deep, ink } = k.pal;
  const night = k.night;
  k.groundShape(b.x, b.y, r + 0.15, [
    { kind: 'fill', colour: deep, alpha: clamp(a * 0.4), paths: spent, lift: 0.15 },
    // Gold by day, where cream on grass is a white dash; cream and glowing by night.
    { kind: 'fill', colour: night > 0.5 ? core : main, alpha: clamp(a), paths: lit, lift: 0.15, glow: 0.4 + 0.6 * night },
    { kind: 'stroke', colour: ink, alpha: clamp(a), width: Math.max(0.7, 0.6 * k.zoom), paths: lit, closed: true, join: 'miter', lift: 0.16 },
  ]);
  k.ring(b, r + 0.07, { band: 0.03, alpha: 0.4 * a, glow: 0.3 + 0.5 * night });
  if (dueAt && due > 0.01) warm(k, dueAt, 5, 0.8 * due * a);
}

/** How far out Shield of Dawn's dome stands from the middle of whoever is in it, in tiles. */
const shieldR = (b: { wide: number }): number => Math.max(0.16, b.wide * 0.045);

/**
 * The profile of the shell Shield of Dawn leaves (`FxScene.shell` at size
 * 1.05, an egg on the screen round the body's middle), as a dome on the
 * ground: `top` how high over the feet it closes, in height units, and
 * `at(h)` its radius in tiles at `h` over the feet. Worked out as the kit's
 * shell is, so the courses that build it match it.
 */
function shieldEgg(k: FxScene, b: Body): { top: number; at: (h: number) => number } {
  const size = 1.05, mid = b.tall * 0.5, half = b.tall * 0.62 * size;
  const ry = k.hpx(half), rx = Math.max(ry * 0.55, b.wide * 2.6 * k.zoom * size);
  // Pixels across the screen a tile out on the ground at its widest.
  const x0 = k.sx(b), perTile = Math.hypot(k.sx({ x: b.x + 1, y: b.y, z: b.z }) - x0, k.sx({ x: b.x, y: b.y + 1, z: b.z }) - x0) || 1;
  const R = rx / perTile;
  return { top: mid + half, at: (h) => R * Math.sqrt(Math.max(0, 1 - ((h - mid) / half) ** 2)) };
}

/** How high over its spot Benediction's halo gathers and pours its rain from, in height units: well over a head. */
const BENEDICTION_SKY = 44;
/** At most this many bodies are drawn mended by Benediction, nearest first: each is a band of two halves. */
const BENEDICTION_MENDED = 5;

/**
 * How wide Benediction's halo may open, in tiles: when the caster stands
 * under it, no wider than reaches to just short of them, so its near half
 * does not cross their face.
 */
const benedictionHaloMost = (k: FxScene, R: number): number => (k.dist < R ? Math.max(0.6, k.dist - 0.4) : 9);

/**
 * Benediction's halo in the sky over its spot, `r` tiles across: tied to
 * the ground it is over by a thin shaft of light let down from it and its
 * shadow, a ring on the ground under it, so it reads as high and not as a
 * second ring lying on the land. `open` nought to one as it pours out.
 */
function benedictionHalo(k: FxScene, r: number, a: number, open: number): void {
  if (a <= 0.01) return;
  const c = k.spot, sky = k.on(c.x, c.y, BENEDICTION_SKY);
  hoop(k, sky, r, r * (0.82 + 0.1 * open), 0, { alpha: a, turn: k.now * 0.6, glow: 0.8, back: 0.7, core: k.pal.main, main: k.pal.main });
  shaft(k, k.on(c.x, c.y), BENEDICTION_SKY, 2.5, 0.35 * a, k.pal.core);
  k.ring(c, r * 0.9, { band: 0.05, alpha: 0.3 * a, main: k.pal.deep, deep: k.pal.deep, glow: 0 });
}

/**
 * A line of dashes on the ground round `c` at `r` tiles: the edge of a reach
 * drawn light, cream on a darker underline, glowing at night. One shape.
 */
function dashedEdge(k: FxScene, c: P3, r: number, a: number, turn = 0): void {
  if (a <= 0.01 || r <= 0.05) return;
  const n = Math.max(12, Math.min(48, Math.round(r * 7))), paths: number[][] = [];
  for (let i = 0; i < n; i++) {
    const path: number[] = [];
    for (let j = 0; j <= 2; j++) {
      const an = turn + ((i + j * 0.27) / n) * TAU;
      path.push(c.x + Math.cos(an) * r, c.y + Math.sin(an) * r);
    }
    paths.push(path);
  }
  const z = k.zoom;
  k.groundShape(c.x, c.y, r + 0.2, [
    { kind: 'stroke', colour: k.pal.deep, alpha: clamp(a * 0.6), width: 2.8 * z, paths, lift: 0.1, cap: 'round' },
    { kind: 'stroke', colour: k.pal.core, alpha: clamp(a), width: 1.4 * z, paths, lift: 0.12, cap: 'round', glow: 0.3 + 0.7 * k.night },
  ]);
}

/**
 * Benediction's rain: short streaks of light falling over the ground within
 * `r` tiles of `c`, from its sky to the ground, each where the cast's seed
 * puts it and falling on its own beat, `secs` into it. Laid over the picture
 * in one record, in the light's own cream and gold, with no particles.
 */
function benedictionRain(k: FxScene, c: P3, r: number, secs: number, a: number): void {
  if (a <= 0.01) return;
  const n = k.fast ? 14 : 26, fall = BENEDICTION_SKY / 50, len = k.hpx(6);
  const lines: number[] = [];
  for (let i = 0; i < n; i++) {
    const an = hashOf(k.seed, i) * TAU, rr = r * Math.sqrt(hashOf(k.seed + 13, i));
    const v = ((secs + hashOf(k.seed + 29, i) * fall) % fall) / fall;
    const p = k.on(c.x + Math.cos(an) * rr, c.y + Math.sin(an) * rr, BENEDICTION_SKY * (1 - v));
    lines.push(k.sx(p), k.sy(p), Math.min(len, k.hpx(BENEDICTION_SKY * (1 - v)) + len * 0.2));
  }
  const W = Math.max(1, 1.1 * k.zoom);
  k.glowDraw((g) => {
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round';
    for (const [colour, w, alpha] of [[k.pal.main, W * 1.8, 0.8], [k.pal.core, W, 1]] as const) {
      g.globalAlpha = clamp(a * alpha);
      g.strokeStyle = colour;
      g.lineWidth = w;
      g.beginPath();
      for (let i = 0; i < lines.length; i += 3) {
        g.moveTo(lines[i], lines[i + 1] - lines[i + 2]);
        g.lineTo(lines[i], lines[i + 1]);
      }
      g.stroke();
    }
    g.lineCap = 'butt';
    g.globalCompositeOperation = 'lighter';
  });
}

/** How high Radiance's sun hangs over its spot, in height units: well over the head of anybody standing there. */
const RADIANCE_SUN = 40;
/** At most this many creatures are drawn burnt by each of Radiance's beats, nearest first: a beam and a band each. */
const RADIANCE_BURNT = 3;

/** How tall Sanctuary's posts stand when it is new, in height units: nearly twice a person. */
const SANCTUARY_POST = 34;
/** At most this many people inside Sanctuary are drawn kept by it. */
const SANCTUARY_KEPT = 5;

/**
 * Sanctuary's fence round the edge of what it holds: posts of light, `h` of
 * their full height (they burn down with its seconds), and a low wall of
 * light between them, so it reads as a bound kept and not one more gold
 * ring. The posts of the far half and of the near half are each one record,
 * sorted at the fence's far and near edge, so whoever is inside is in front
 * of the far posts and behind the near ones; by night they shine.
 */
function sanctuaryFence(k: FxScene, R: number, h: number, a: number, age: number): void {
  if (a <= 0.01) return;
  const c = k.spot;
  const d = awayOf(k, c);
  hoop(k, c, R, R, 3, { alpha: 0.42 * a, n: k.fast ? 24 : 36, turn: age * 0.05, glow: 0, back: 0.6, front: 0.7, wall: true });
  k.ring(c, R, { band: 0.05, alpha: 0.7 * a, turn: age * 0.05, glow: 0.3 + 0.5 * k.night, n: 36 });
  if (h <= 0.01) return;
  const n = k.fast ? 6 : 8, tall = SANCTUARY_POST * h, W = k.px(5), H = k.hpx(tall);
  const far: number[] = [], near: number[] = [];
  for (let i = 0; i < n; i++) {
    const an = (i / n) * TAU + Math.PI / 8;
    const base = k.on(c.x + Math.cos(an) * R, c.y + Math.sin(an) * R);
    (Math.cos(an) * d.x + Math.sin(an) * d.y > 0 ? far : near).push(k.sx(base), k.sy(base));
    // One soft light up the post: gold by day, its own glow by night.
    warm(k, lift(base, tall * 0.55), 4 + tall * 0.35, a * (0.5 + 0.1 * Math.sin(age * 3 + i)));
    if (!k.fast && age > 0) k.emit(lift(base, tall), 0.8 * a, { kind: 'mote', colour: GOLD, over: true, size: 1.2, life: [0.6, 1.0], speed: [0, 0.02], up: [6, 12], gravity: 0, jitter: 0.03 });
  }
  const { core, main, deep, ink } = k.pal;
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  const posts = (xy: number[], night: boolean) => (g: CanvasRenderingContext2D): void => {
    g.lineJoin = 'miter';
    for (let i = 0; i < xy.length; i += 2) {
      const x = xy[i], y = xy[i + 1];
      if (night) {
        // Over the night, the lit face laid again in the light's cream, so a post is a post of light in the dark.
        g.globalAlpha = clamp(a * 0.6 * k.night);
        g.fillStyle = k.pal.light;
        g.beginPath();
        g.moveTo(x, y - H);
        g.lineTo(x - W, y - H * 0.12);
        g.lineTo(x, y + W * 0.3);
        g.lineTo(x + W * 0.5, y - H * 0.12);
        g.closePath();
        g.fill();
        continue;
      }
      g.globalAlpha = clamp(a);
      for (const [fill, pts] of [[core, [x, y - H, x - W, y - H * 0.12, x, y + W * 0.3]], [deep, [x, y - H, x, y + W * 0.3, x + W, y - H * 0.12]], [main, [x, y - H, x - W * 0.35, y - H * 0.3, x, y - H * 0.08]]] as const) {
        g.fillStyle = fill;
        g.beginPath();
        g.moveTo(pts[0], pts[1]);
        g.lineTo(pts[2], pts[3]);
        g.lineTo(pts[4], pts[5]);
        g.closePath();
        g.fill();
      }
      g.lineWidth = inkW;
      g.strokeStyle = ink;
      g.beginPath();
      g.moveTo(x, y - H);
      g.lineTo(x - W, y - H * 0.12);
      g.lineTo(x, y + W * 0.3);
      g.lineTo(x + W, y - H * 0.12);
      g.closePath();
      g.stroke();
    }
    g.lineJoin = 'round';
  };
  if (far.length) k.worldDraw({ x: c.x + d.x * R, y: c.y + d.y * R, z: c.z }, posts(far, false), -0.4);
  if (near.length) k.worldDraw({ x: c.x - d.x * R, y: c.y - d.y * R, z: c.z }, posts(near, false), 0.9);
  if (k.night > 0.05) k.glowDraw(posts([...far, ...near], true));
}
