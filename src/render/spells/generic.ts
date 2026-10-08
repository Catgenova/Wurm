/**
 * The stand-ins: a decent, plain cast and effect for every spell until its
 * own is drawn, picked by how the spell is cast (`CastKind`) and drawn in its
 * group's palette. They are also the worked examples of the kit -- each is a
 * dozen lines a part -- and a starting point: `{ ...placeholder(id, P), fx:
 * { ...placeholder(id, P).fx, hit: myHit } }` keeps the rest of a stand-in
 * while one part of it is replaced.
 */
import type { CastTiming, SpellFx, SpellVisual } from './index';
import { spellInfo, type CastKind, type SpellInfo } from './info';
import { arcAt, bump, clamp, flashOf, mid3, seg, smooth, type FxScene, type P3, type SpellPalette } from './kit';
import { POSE_OF, TIMING_OF } from './poses';

/** A mark over a creature or a person while what was cast on it lasts: a small turning rune, and a faint band under its feet. */
export function lingerMark(k: FxScene, age: number, left: number, points = 4): void {
  const a = smooth(age / 0.4) * smooth(left / 0.8);
  const b = k.target;
  k.mark(k.at(b, 1.12), { r: 4.2, points, turn: age * 2.2, alpha: 0.9 * a });
  k.ring(b, Math.max(0.28, (b.wide / 40) * 3.2), { band: 0.05, alpha: 0.45 * a, glow: 0.4, turn: age * 0.8, dash: 3 });
  if (!k.fast) k.emit(k.at(b, 0.4), 3, { kind: 'mote', size: 1.6, life: [0.6, 1.1], speed: [0.02, 0.08], up: [6, 12], gravity: 0, jitter: 0.15 });
}

/** A skin or a blessing over a body while it lasts: a faint shell breathing, brighter the first second. */
export function lingerShell(k: FxScene, age: number, left: number, b = k.target): void {
  const a = smooth(age / 0.3) * smooth(left / 0.8);
  const breath = 0.5 + 0.5 * Math.sin(age * 2.6);
  k.shell(b, { alpha: (0.22 + 0.1 * breath + 0.5 * Math.max(0, 1 - age)) * a, turn: age * 0.4, glow: 0.6 });
  if (!k.fast) k.emit(k.at(b, 0.15), 2.5, { kind: 'mote', size: 1.5, life: [0.8, 1.4], speed: [0.03, 0.1], up: [8, 14], gravity: 0, jitter: 0.12 });
}

/** A charge gathering at a point: an orb swelling and the light coming up round it. */
function gather(k: FxScene, at: P3, t: number, until: number, size = 3.2): void {
  const g = smooth(seg(t, 0.05, until));
  if (g <= 0) return;
  k.orb(at, size * (0.35 + 0.65 * g), { alpha: g, turn: k.now * 3 });
  k.light(at, 2 + 2 * g, 0.5 * g);
  k.emit(at, 18 * g, { kind: 'ember', size: 1.5, life: [0.25, 0.5], speed: [0.05, 0.25], up: [-4, 6], gravity: 0, drag: 0.1, jitter: 0.06, jitterZ: 2 });
}

/** A landing: a flare and a burst of sparks off the body, a ring on the ground, light. */
function landing(k: FxScene, scale = 1): void {
  const at = k.heart(k.target);
  const away = k.toward(k.caster, k.target);
  k.burst(at, 22 * scale, { kind: 'spark', size: 2, life: [0.25, 0.55], speed: [0.8, 2.2], up: [0, 30], heading: away, cone: 2.4, gravity: 60, drag: 0.08 });
  k.burst(at, 8 * scale, { kind: 'ember', size: 2, life: [0.4, 0.8], speed: [0.2, 0.7], up: [6, 20], gravity: 20 });
}

const ringOut = (k: FxScene, c: { x: number; y: number }, u: number, r: number, alpha = 1, band = 0.16): void => {
  const rr = 0.1 + r * smooth(u);
  k.ring(c, rr, { band: Math.min(rr * 0.35, band * (1 - 0.6 * u)), alpha: alpha * (1 - u * u), turn: u * 0.6 });
};

/** Each way of casting's stand-in effects. */
function fxFor(kind: CastKind, info: SpellInfo | undefined, timing: CastTiming): SpellFx {
  const rel = timing.release;
  const lasting = !!info?.lasts;
  const radius = info?.radius ?? 0;
  switch (kind) {
    case 'strike':
      return {
        charge: (k, t) => {
          k.glow(k.weaponAt(4), 5, 0.5 * bump(t, 0.05, rel, rel + 0.2));
          const u = seg(t, rel - 0.16, rel + 0.08);
          if (u > 0 && u < 1) k.slash(k.caster, { u, width: 7, alpha: 0.9 * (1 - seg(t, rel + 0.04, rel + 0.2)) });
        },
        hit: (k) => landing(k),
        impact: { secs: 0.45, draw: (k, u) => {
          ringOut(k, k.target, u, 0.35, 0.9);
          k.flare(k.heart(k.target), 9 * (1 - u), flashOf(u), k.pal.core, u);
        } },
        ...(lasting ? { linger: { draw: (k: FxScene, age: number, left: number) => lingerMark(k, age, left) } } : {}),
      };
    case 'thrust':
      return {
        charge: (k, t) => {
          const u = seg(t, rel - 0.1, rel + 0.1);
          if (u > 0 && u < 1) {
            const from = k.chest(), to = k.heart(k.target);
            k.ribbon([mid3(from, to, Math.max(0, u - 0.5)), mid3(from, to, u)], { width: 5, taper: 'start', alpha: 1 - u * 0.5 });
          }
        },
        hit: (k) => landing(k, 0.8),
        impact: { secs: 0.4, draw: (k, u) => {
          ringOut(k, k.target, u, 0.55);
          k.flare(k.heart(k.target), 8 * (1 - u), flashOf(u));
        } },
        ...(lasting ? { linger: { draw: (k: FxScene, age: number, left: number) => lingerMark(k, age, left) } } : {}),
      };
    case 'shot':
    case 'throw': {
      const lift = kind === 'shot' ? 1.4 : 3;
      const speed = kind === 'shot' ? 0.045 : 0.075;
      return {
        charge: (k, t) => k.glow(kind === 'shot' ? k.hand(0) : k.hand(1), 5, 0.6 * bump(t, 0.2, rel, rel + 0.1)),
        release: (k) => k.burst(k.hand(kind === 'shot' ? 0 : 1), 5, { kind: 'mote', size: 1.6, life: [0.2, 0.4], speed: [0.1, 0.4], up: [0, 6], gravity: 0 }),
        travel: { secs: (tiles) => 0.06 + tiles * speed, draw: (k, u) => {
          const from = k.hand(kind === 'shot' ? 0 : 1), to = k.heart(k.target);
          const lift2 = lift * k.dist;
          const pts: P3[] = [];
          for (let i = 5; i >= 0; i--) pts.push(arcAt(from, to, Math.max(0, u - i * 0.035), lift2));
          k.ribbon(pts, { width: kind === 'shot' ? 2.6 : 3.6, alpha: 0.85 });
          k.orb(pts[pts.length - 1], kind === 'shot' ? 1.4 : 2.2, { glow: 0.6, turn: k.now * (kind === 'throw' ? 18 : 0) });
        } },
        hit: (k) => {
          landing(k, 0.7);
          k.burst(k.at(k.target, 0.1), 6, { kind: 'dust', colour: '#8a7a62', size: 3, life: [0.4, 0.7], speed: [0.2, 0.5], up: [2, 6], gravity: 2 });
        },
        impact: { secs: 0.4, draw: (k, u) => k.flare(k.heart(k.target), 8 * (1 - u), flashOf(u)) },
        ...(lasting ? { linger: { draw: (k: FxScene, age: number, left: number) => lingerMark(k, age, left) } } : {}),
      };
    }
    case 'bolt':
      return {
        charge: (k, t) => gather(k, mid3(k.hand(0), k.hand(1), 0.5), t, rel),
        release: (k) => k.burst(k.hand(1), 10, { kind: 'ember', size: 1.8, life: [0.2, 0.4], speed: [0.3, 0.9], up: [0, 10], heading: k.toward(k.caster, k.target), cone: 1.2 }),
        travel: { secs: (tiles) => 0.12 + tiles * 0.07, draw: (k, u) => {
          const from = k.hand(1), to = k.heart(k.target);
          const pts: P3[] = [];
          for (let i = 6; i >= 0; i--) pts.push(arcAt(from, to, Math.max(0, u - i * 0.03), k.dist * 0.6));
          const head = pts[pts.length - 1];
          k.ribbon(pts, { width: 5, alpha: 0.85 });
          k.orb(head, 3.6, { turn: k.now * 4 });
          k.light(head, 3, 0.7);
          k.emit(head, 40, { kind: 'ember', size: 1.6, life: [0.2, 0.45], speed: [0.05, 0.3], up: [-4, 6], gravity: 4, jitter: 0.04 });
        } },
        hit: (k) => {
          landing(k, 1.2);
          k.flash(0.06);
        },
        impact: { secs: 0.7, draw: (k, u) => {
          ringOut(k, k.target, u, 1.1);
          k.flare(k.heart(k.target), 14 * (1 - u), flashOf(u));
          k.light(k.target, 4, 0.9 * (1 - u));
          k.scorch(k.target, 0.45, { alpha: 0.35 * (1 - u * u) });
        } },
        ...(lasting ? { linger: { draw: (k: FxScene, age: number, left: number) => lingerMark(k, age, left) } } : {}),
      };
    case 'curse':
      return {
        charge: (k, t) => k.glow(k.hand(1), 5, 0.7 * bump(t, 0.1, rel, rel + 0.15), k.pal.deep),
        travel: { secs: () => 0.2, draw: (k, u) => {
          const from = k.hand(1), to = k.heart(k.target);
          k.bolt(from, mid3(from, to, smooth(u * 1.4)), { width: 1.8, jag: 5, fork: 0, alpha: 0.9 });
        } },
        hit: (k) => {
          k.burst(k.heart(k.target), 12, { kind: 'mote', size: 2, life: [0.4, 0.8], speed: [0.2, 0.6], up: [4, 14], gravity: 0 });
          k.burst(k.heart(k.target), 6, { kind: 'smoke', colour: k.pal.deep, size: 3, life: [0.5, 0.9], speed: [0.1, 0.3], up: [4, 10] });
        },
        impact: { secs: 0.5, draw: (k, u) => {
          k.bolt(k.hand(1), k.heart(k.target), { width: 1.6 * (1 - u), jag: 6, fork: 1, alpha: 1 - u });
          k.mark(k.at(k.target, 1.12), { r: 6 * (1.4 - 0.4 * smooth(u * 2)), points: 4, alpha: smooth(u * 3), turn: u * 3 });
        } },
        ...(lasting ? { linger: { draw: (k: FxScene, age: number, left: number) => lingerMark(k, age, left, 3) } } : {}),
      };
    case 'buff':
      return {
        charge: (k, t) => {
          k.sigil(k.caster, 0.5, { grow: seg(t, 0.05, rel), turn: k.now * 0.7, alpha: 0.9 * (1 - seg(t, rel + 0.2, 1)) });
          k.emit(k.at(k.caster, 0.05), 24 * seg(t, 0, rel), { kind: 'mote', size: 1.6, life: [0.4, 0.8], speed: [0.05, 0.15], up: [10, 22], gravity: 0, jitter: 0.25 });
        },
        hit: (k) => {
          k.burst(k.at(k.caster, 0.5), 14, { kind: 'mote', size: 2, life: [0.4, 0.8], speed: [0.2, 0.6], up: [4, 18], gravity: 0 });
          k.flash(0.05);
        },
        impact: { secs: 0.7, draw: (k, u) => {
          ringOut(k, k.caster, u, 1.0, 0.9);
          k.shell(k.caster, { alpha: 0.7 * flashOf(u, 0.15), size: 1 + 0.15 * u });
          k.light(k.caster, 3.5, 0.6 * (1 - u));
        } },
        linger: { secs: lasting ? undefined : 0, draw: (k, age, left) => lingerShell(k, age, left, k.caster) },
      };
    case 'ally':
      return {
        charge: (k, t) => k.glow(k.hand(1), 6, 0.8 * bump(t, 0.1, rel, rel + 0.1)),
        travel: { secs: (tiles) => (tiles < 0.3 ? 0 : 0.18 + tiles * 0.05), draw: (k, u) => {
          const from = k.hand(1), to = k.heart(k.target);
          const head = arcAt(from, to, u, 6 + k.dist * 2);
          k.ribbon([arcAt(from, to, Math.max(0, u - 0.25), 6 + k.dist * 2), arcAt(from, to, Math.max(0, u - 0.12), 6 + k.dist * 2), head], { width: 3, alpha: 0.8 });
          k.orb(head, 2.4, { turn: k.now * 5 });
        } },
        hit: (k) => {
          k.burst(k.at(k.target, 0.3), 14, { kind: 'mote', size: 2, life: [0.5, 0.9], speed: [0.1, 0.4], up: [8, 20], gravity: 0, jitter: 0.2 });
        },
        impact: { secs: 0.8, draw: (k, u) => {
          k.shell(k.target, { alpha: 0.75 * flashOf(u, 0.15) });
          ringOut(k, k.target, u, 0.8, 0.8, 0.12);
          k.light(k.target, 3, 0.5 * (1 - u));
        } },
        ...(lasting ? { linger: { draw: (k: FxScene, age: number, left: number) => lingerShell(k, age, left) } } : {}),
      };
    case 'nova': {
      const R = Math.max(1.2, radius || 2);
      return {
        charge: (k, t) => {
          k.sigil(k.caster, Math.min(1.2, R * 0.4), { grow: seg(t, 0.05, rel), turn: -k.now * 1.2, alpha: 1 - seg(t, rel, rel + 0.15) });
          k.glow(k.chest(), 8, 0.6 * seg(t, 0, rel));
        },
        hit: (k) => {
          const c = k.at(k.caster, 0.3);
          k.burst(c, 40, { kind: 'spark', size: 2, life: [0.3, 0.6], speed: [R * 1.2, R * 2.4], up: [2, 14], gravity: 30, drag: 0.05 });
          k.burst(k.at(k.caster, 0.05), 16, { kind: 'dust', colour: '#8f8068', size: 3.5, life: [0.5, 0.9], speed: [R * 0.6, R * 1.2], up: [2, 6], gravity: 2, drag: 0.1 });
          k.flash(0.08);
        },
        impact: { secs: 0.8, draw: (k, u) => {
          ringOut(k, k.caster, u, R, 1, 0.3);
          if (u > 0.15) ringOut(k, k.caster, (u - 0.15) / 0.85, R * 0.7, 0.6, 0.12);
          k.light(k.caster, R + 2, 0.9 * (1 - u));
        } },
        ...(lasting ? { linger: { draw: (k: FxScene, age: number, left: number) => {
          const a = smooth(age / 0.5) * smooth(left / 1);
          k.ring(k.caster, R, { band: 0.08, alpha: 0.4 * a, dash: 4, turn: age * 0.5, glow: 0.5 });
          k.emit(k.at(k.caster, 0.1), 6 * a, { kind: 'mote', size: 1.5, life: [0.6, 1.2], speed: [R * 0.2, R * 0.5], up: [2, 8], gravity: 0, jitter: 0.2 });
        } } } : {}),
      };
    }
    case 'ground': {
      const R = Math.max(1, radius || 3);
      return {
        charge: (k, t) => {
          k.sigil(k.spot, R, { grow: seg(t, 0.1, rel + 0.05), turn: k.now * 0.25, alpha: 0.85, points: 7, step: 3 });
          k.glow(mid3(k.hand(0), k.hand(1), 0.5), 7, 0.7 * bump(t, 0.05, rel * 0.8, rel + 0.1));
        },
        hit: (k) => {
          k.burst(k.on(k.spot.x, k.spot.y, 2), 30, { kind: 'mote', size: 2, life: [0.6, 1.2], speed: [R * 0.2, R * 0.6], up: [10, 30], gravity: 0, drag: 0.3 });
          k.flash(0.05);
        },
        impact: { secs: 1.0, draw: (k, u) => {
          k.pillar(k.spot, { r: 10, h: 70, alpha: flashOf(u, 0.08) });
          ringOut(k, k.spot, u, R, 0.9, 0.22);
          k.sigil(k.spot, R, { turn: k.now * 0.25, alpha: 0.85, points: 7, step: 3 });
          k.light(k.spot, R + 1, 0.8 * (1 - u * 0.5));
        } },
        linger: { secs: lasting ? undefined : 0, draw: (k, age, left) => {
          const a = smooth(left / 1.2) * (0.35 + 0.15 * Math.sin(age * 2));
          k.sigil(k.spot, R, { turn: k.now * 0.25, alpha: a, points: 7, step: 3, glow: 0.4 });
          k.light(k.spot, R, 0.3 * smooth(left / 1.2));
          k.emit(k.on(k.spot.x, k.spot.y, 1), 4 + R, { kind: 'mote', size: 1.6, life: [0.8, 1.6], speed: [0.02, 0.08], up: [6, 14], gravity: 0, jitter: R * 0.7 });
        } },
      };
    }
    case 'command':
      return {
        release: (k) => k.burst(k.head(), 6, { kind: 'mote', size: 1.8, life: [0.2, 0.4], speed: [0.4, 0.9], up: [0, 6], heading: k.facingDir(k.caster), cone: 1, gravity: 0 }),
        impact: { secs: 0.6, draw: (k, u) => {
          // The word given, going out ahead in three arcs.
          for (let i = 0; i < 3; i++) {
            const v = clamp(u * 1.6 - i * 0.18);
            if (v <= 0 || v >= 1) continue;
            k.slash(k.caster, { u: 1, from: 0.6, to: -0.6, tilt: Math.PI / 2, reach: 6 + 14 * v, up: k.caster.tall * 0.85, width: 3, length: 1.2, alpha: 0.8 * (1 - v), glow: 0.5 });
          }
          const who = k.target === k.caster ? k.companion ?? k.caster : k.target;
          k.ring(who, 0.2 + 0.5 * smooth(u), { band: 0.08, alpha: 1 - u });
          k.mark(k.at(who, 1.15), { r: 5, points: 3, alpha: flashOf(u, 0.2), turn: u * 2 });
        } },
        ...(lasting ? { linger: { draw: (k: FxScene, age: number, left: number) => {
          const who = k.target === k.caster ? k.companion : k.target;
          if (who) lingerShell(k, age, left, who);
        } } } : {}),
      };
    case 'pray':
      return {
        charge: (k, t) => {
          k.glow(mid3(k.hand(0), k.hand(1), 0.5), 6, 0.8 * seg(t, 0.05, rel));
          k.emit(k.at(k.caster, 1.6), 14 * seg(t, 0.1, rel), { kind: 'mote', size: 1.6, life: [0.5, 0.9], speed: [0.02, 0.1], up: [-16, -8], gravity: 0, jitter: 0.25 });
        },
        hit: (k) => k.burst(k.head(), 10, { kind: 'mote', size: 2, life: [0.4, 0.8], speed: [0.1, 0.4], up: [8, 20], gravity: 0 }),
        impact: { secs: 0.9, draw: (k, u) => {
          k.pillar(k.target, { r: 6, h: 50, alpha: 0.8 * flashOf(u, 0.1) });
          k.flare(k.at(k.target, 1.25), 10 * (1 - u), flashOf(u));
          ringOut(k, k.target, u, 0.8, 0.8, 0.12);
          k.light(k.target, 3, 0.6 * (1 - u));
        } },
        ...(lasting ? { linger: { draw: (k: FxScene, age: number, left: number) => lingerShell(k, age, left) } } : {}),
      };
  }
}

/**
 * A spell's stand-in: the cast and the effects for how it is cast, in its
 * group's colours. Replace it with a visual of the spell's own.
 */
export function placeholder(id: string, palette: SpellPalette, kind?: CastKind): SpellVisual {
  const info = spellInfo(id);
  const how = kind ?? info?.kind ?? 'bolt';
  const timing = { ...TIMING_OF[how] };
  return { palette, cast: { timing, pose: POSE_OF[how] }, fx: fxFor(how, info, timing), placeholder: true };
}
