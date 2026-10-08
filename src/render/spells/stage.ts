/**
 * Every spell on the screen, from the cast to the last of what it left.
 *
 * `play` starts one: who cast it and at what. Every frame `update` runs each
 * one's functions (`SpellVisual.fx`) against an `FxScene` -- the caster and
 * the target where they are this frame, followed wherever they walk -- and
 * what they record is laid out (`layout`) and drawn in the renderer's passes:
 * the ground a line at a time (`groundLine`), what stands in the world sorted
 * in with everything else standing there (`itemsAt`, `drawItem`), light over
 * the night (`glowPass`), the screen last (`screenPass`). Lights for the night
 * are in `lights`, which `Game.lights` hands on with its own.
 *
 * A cast ends when its pose, its impact and its lingering are all over; what
 * it lingers on going away (a creature killed, a person gone) ends it then.
 * The island does not say when an effect is over before its time -- a skin
 * used up, a hold broken -- so a linger lasts the spell's own seconds.
 *
 * Nothing here is the island's. A cast is drawn when the island said yes to
 * it, on this browser and on everybody else's watching (`Island.castSeen`).
 */
import { FIGURE_TOP, figureJoint, type FigurePose } from '../figure';
import { HEIGHT_SCALE } from '../iso';
import { depthOf, type View } from '../view';
import { lingerSecs, visualOf, type SpellVisual } from './index';
import { spellInfo, type SpellInfo } from './info';
import { drawParticle, FxFrame, FxScene, isLightKind, MOST_PARTICLES, Particles, rngOf, type Body, type Eye, type P3, type WorldRec } from './kit';

/** Somebody or something a spell is cast by or at. */
export type Who = { kind: 'player' } | { kind: 'peer'; id: number } | { kind: 'creature'; id: number };
/** What a spell was cast at: somebody, a spot on the ground, or the caster themselves. */
export type Aim = Who | { kind: 'spot'; x: number; y: number } | { kind: 'self' };

/** How the stage finds things in the world: the renderer's answers, or the preview's. */
export interface Where {
  /** Where somebody is this frame, or nothing when they are gone. */
  body(w: Who): Body | null;
  /** The ground's height, in height units. */
  ground(x: number, y: number): number;
  /** Turn somebody to face a point, as a cast begins. */
  turn?(w: Who, x: number, y: number): void;
  /** What follows somebody, for a Beastmaster's spells. */
  companion?(w: Who): Body | null;
}

/** The most casts kept going at once; past it, the oldest one that has finished casting goes. */
const MOST_PLAYING = 32;
/** A cast whose caster cannot be found for this long is let go. */
const LOST_FOR = 2;

interface Playing {
  id: string;
  vis: SpellVisual;
  info: SpellInfo | undefined;
  by: Who;
  at: Aim;
  mine: boolean;
  start: number;
  seed: number;
  released: boolean;
  landed: boolean;
  /** Seconds from the start: when it lets go, when it lands, when everything is over. */
  release: number;
  arrive: number;
  end: number;
  lingers: number;
  caster: Body | null;
  target: Body | null;
  spot: P3;
  lostAt: number;
  state: Record<string, number>;
}

const sameWho = (a: Who, b: Who): boolean => a.kind === b.kind && (a.kind === 'player' || (a as { id: number }).id === (b as { id: number }).id);

export class SpellStage {
  private playing: Playing[] = [];
  readonly out = new FxFrame();
  readonly parts = new Particles(MOST_PARTICLES);
  private readonly k = new FxScene();
  private now = 0;
  private eye: Eye | null = null;
  private seeds = 1;
  /** Lines of the ground to what stands on them this frame, and the clip of each line's tiles for what lies on them. */
  private lines = new Map<number, WorldRec[]>();
  private spare: WorldRec[][] = [];
  /** Each line's tiles under what lies on the ground, and the box round them in the screen's own pixels. */
  private groundClip = new Map<number, { path: Path2D; x0: number; y0: number; x1: number; y1: number; recs: number[] }>();
  /** How the ground's share of a line is put down: copied out of a layer drawn once, or drawn again under the line's clip. */
  static groundMode: 'layer' | 'vector' = 'vector';
  /** The part of the ground layer drawn on last frame, in its own pixels, which is all that needs clearing. */
  private groundDirty: [number, number, number, number] | null = null;
  private groundLayer: HTMLCanvasElement | null = null;
  private groundAny = false;
  /** Joints asked for this frame, by body and bone. */
  private joints = new Map<string, P3>();

  constructor(private readonly where: Where) {
    this.k.parts = this.parts;
    this.k.out = this.out;
    this.k.ground = (x, y) => this.where.ground(x, y);
    this.k.jointOf = (b, bone, at) => this.jointOf(b, bone, at);
  }

  /** Lights for the night this frame. */
  get lights(): FxFrame['lights'] {
    return this.out.lights;
  }

  /** How many casts are going, for a footer or a test. */
  get count(): number {
    return this.playing.length;
  }

  /**
   * Start a cast: `by` casting `spell` at `at`. False when the spell has no
   * visual, or the caster is not to be found. `mine` is your own cast, which
   * alone may tint the screen.
   */
  play(spell: string, by: Who, at: Aim, opts: { mine?: boolean; now?: number } = {}): boolean {
    const vis = visualOf(spell);
    if (!vis) return false;
    const caster = this.where.body(by);
    if (!caster) return false;
    const now = opts.now ?? this.now;
    const info = spellInfo(spell);
    const target = this.targetOf(at, caster, null);
    // Turned to face it first: a cast is aimed with the whole body.
    if (target && target !== caster && (Math.abs(target.x - caster.x) > 0.05 || Math.abs(target.y - caster.y) > 0.05)) this.where.turn?.(by, target.x, target.y);
    const timing = vis.cast.timing;
    const p: Playing = {
      id: spell, vis, info, by, at, mine: !!opts.mine, start: now, seed: (this.seeds = (this.seeds * 1103515245 + 12345) >>> 0) || 1,
      released: false, landed: false, release: timing.secs * timing.release, arrive: Infinity, end: Infinity, lingers: lingerSecs(vis, info),
      caster, target, spot: { x: target?.x ?? caster.x, y: target?.y ?? caster.y, z: target?.z ?? caster.z }, lostAt: -1, state: {},
    };
    // A second cast by the same caster takes the body over from the first; the first's effects play on.
    this.playing.push(p);
    if (this.playing.length > MOST_PLAYING) {
      const old = this.playing.findIndex((q) => now - q.start > q.vis.cast.timing.secs);
      this.playing.splice(old >= 0 ? old : 0, 1);
    }
    return true;
  }

  /** The cast somebody is part way through, for their figure (`FigurePose.cast`). */
  poseOf(w: Who): { id: string; t: number } | undefined {
    for (let i = this.playing.length - 1; i >= 0; i--) {
      const p = this.playing[i];
      if (!sameWho(p.by, w)) continue;
      const t = (this.now - p.start) / p.vis.cast.timing.secs;
      if (t >= 0 && t < 1) return { id: p.id, t };
    }
    return undefined;
  }

  /** Forget everything: a new island, a new body. */
  clear(): void {
    this.playing.length = 0;
    this.parts.clear();
    this.out.reset();
  }

  private targetOf(at: Aim, caster: Body, last: Body | null): Body | null {
    if (at.kind === 'self') return caster;
    if (at.kind === 'spot') return { x: at.x, y: at.y, z: this.where.ground(at.x, at.y), tall: 0, wide: 0, facing: 0, kind: 'spot' };
    return this.where.body(at) ?? last;
  }

  private jointOf(b: Body, bone: string, at?: [number, number, number]): P3 | null {
    const f = b.figure;
    if (!f) return null;
    const key = `${b.x.toFixed(3)},${b.y.toFixed(3)},${bone},${at ? at.join(',') : ''}`;
    const had = this.joints.get(key);
    if (had) return had;
    const j = figureJoint({ ...f, facing: b.facing }, bone, at);
    const p = this.k.local(b, j[0], j[1], j[2]);
    this.joints.set(key, p);
    return p;
  }

  /* ---- a frame ------------------------------------------------------------------------- */

  /**
   * Run every cast for this frame, `now` seconds on the drawing clock: their
   * bodies found where they are, their moments passed, their effects recorded.
   */
  update(env: { eye: Eye; now: number; dt: number; fast: boolean }): void {
    this.now = env.now;
    this.eye = env.eye;
    this.out.reset();
    this.joints.clear();
    this.parts.step(Math.min(0.1, env.dt));
    const k = this.k;
    k.eye = env.eye;
    k.zoom = env.eye.zoom;
    k.now = env.now;
    k.dt = Math.min(0.1, env.dt);
    k.fast = env.fast;
    k.partCap = env.fast ? Math.round(MOST_PARTICLES / 3) : MOST_PARTICLES;
    let keep = 0;
    for (const p of this.playing) {
      if (this.run(p)) this.playing[keep++] = p;
    }
    this.playing.length = keep;
  }

  /** One cast's frame; false when it is over. */
  private run(p: Playing): boolean {
    const t = this.now - p.start;
    if (t < 0) return true;
    // The caster where they are now; somebody gone for long enough lets the cast go.
    const caster = this.where.body(p.by);
    if (caster) {
      p.caster = caster;
      p.lostAt = -1;
    } else {
      if (p.lostAt < 0) p.lostAt = this.now;
      if (this.now - p.lostAt > LOST_FOR || !p.caster) return false;
    }
    const c = p.caster as Body;
    // While it is being cast, the figure is the cast: its hands are where the pose has them.
    if (c.figure && t < p.vis.cast.timing.secs) c.figure = { ...c.figure, cast: { id: p.id, t: t / p.vis.cast.timing.secs } };
    const target = this.targetOf(p.at, c, p.target);
    const gone = p.at.kind !== 'self' && p.at.kind !== 'spot' && !this.where.body(p.at);
    p.target = target ?? c;
    // What it lands on: followed until it lands, then where it landed for anything on the ground.
    if (!p.landed || p.at.kind !== 'spot') p.spot = { x: p.target.x, y: p.target.y, z: p.target.z };

    const k = this.k;
    k.pal = p.vis.palette;
    k.fx = p.info?.fx ?? {};
    k.caster = c;
    k.target = p.target;
    k.spot = p.spot;
    k.dist = Math.hypot(p.spot.x - c.x, p.spot.y - c.y);
    k.state = p.state;
    k.seed = p.seed;
    k.mine = p.mine;
    k.rand = rngOf((p.seed ^ Math.imul(Math.floor(this.now * 60), 2654435761)) >>> 0);
    k.companion = this.where.companion?.(p.by) ?? null;

    const fx = p.vis.fx;
    const timing = p.vis.cast.timing;
    if (t < timing.secs && fx.charge) fx.charge(k, t / timing.secs);
    if (!p.released && t >= p.release) {
      p.released = true;
      fx.release?.(k);
      const travel = fx.travel ? Math.max(0, fx.travel.secs(k.dist)) : 0;
      p.arrive = p.release + travel;
      p.end = Math.max(timing.secs, p.arrive + (fx.impact?.secs ?? 0), p.arrive + p.lingers);
    }
    if (p.released && fx.travel && t >= p.release && t < p.arrive) fx.travel.draw(k, (t - p.release) / Math.max(1e-3, p.arrive - p.release));
    if (p.released && !p.landed && t >= p.arrive) {
      p.landed = true;
      fx.hit?.(k);
    }
    if (p.landed && fx.impact && t - p.arrive < fx.impact.secs) fx.impact.draw(k, (t - p.arrive) / fx.impact.secs);
    if (p.landed && fx.linger && p.lingers > 0) {
      // What it lingered on is gone: over now.
      if (gone && p.at.kind !== 'self') return t < p.arrive + (fx.impact?.secs ?? 0);
      const age = t - p.arrive;
      if (age < p.lingers) fx.linger.draw(k, age, p.lingers - age);
    }
    return !p.released || t < p.end;
  }

  /* ---- laying out --------------------------------------------------------------------- */

  /**
   * Sort what the frame recorded into the lines of the ground it is drawn on,
   * and lay what lies on the ground into a layer of its own, to be cut a line
   * at a time (`groundLine`). `ctx` is the screen's, for its size and scale.
   */
  layout(ctx: CanvasRenderingContext2D, view: View, dLo: number, dHi: number): void {
    for (const [, list] of this.lines) {
      list.length = 0;
      this.spare.push(list);
    }
    this.lines.clear();
    this.groundClip.clear();
    this.groundAny = false;
    const eye = this.eye;
    if (!eye) return;
    const line = (x: number, y: number): number => Math.max(dLo, Math.min(dHi, depthOf(view, Math.floor(x), Math.floor(y))));
    const put = (rec: WorldRec): void => {
      const d = line(rec.x, rec.y);
      let list = this.lines.get(d);
      if (!list) {
        list = this.spare.pop() ?? [];
        this.lines.set(d, list);
      }
      list.push(rec);
    };
    for (const rec of this.out.world) put(rec);
    const ps = this.parts;
    for (let i = 0; i < ps.span; i++) {
      if (ps.life[i] <= 0 || isLightKind(ps.kind[i])) continue;
      const x = ps.x[i], y = ps.y[i];
      put({ x, y, sx: eye.worldToScreenX(x, y), sy: eye.worldToScreenY(x, y, this.where.ground(x, y)) + ps.bias[i], draw: null, p: i });
    }
    if (!this.out.ground.length) return;
    if (SpellStage.groundMode === 'vector') {
      this.groundAny = true;
      this.clipLines(ctx.getTransform(), view, dLo, dHi, ctx.canvas.width, ctx.canvas.height);
      return;
    }
    // The ground layer: the screen's size, everything on the ground drawn into it once.
    const W = ctx.canvas.width, H = ctx.canvas.height;
    if (!this.groundLayer) this.groundLayer = document.createElement('canvas');
    const layer = this.groundLayer;
    if (layer.width !== W || layer.height !== H) {
      layer.width = W;
      layer.height = H;
    }
    const g = layer.getContext('2d');
    if (!g) return;
    const m = ctx.getTransform();
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.groundDirty) g.clearRect(...this.groundDirty);
    g.setTransform(m);
    for (const rec of this.out.ground) {
      g.save();
      rec.draw(g);
      g.restore();
    }
    this.groundAny = true;
    this.clipLines(m, view, dLo, dHi, W, H);
  }

  private clipLines(m: DOMMatrix, view: View, dLo: number, dHi: number, W: number, H: number): void {
    const eye = this.eye as Eye;
    // And the tiles each covers, a path a line, so each line's share of it goes down with that line's ground; with the box
    // round each line's tiles, in the screen's pixels, so only that much of the layer is ever copied or cleared.
    const seen = new Set<number>();
    const h = (cx: number, cy: number): number => this.where.ground(cx, cy);
    let dx0 = Infinity, dy0 = Infinity, dx1 = -Infinity, dy1 = -Infinity;
    for (let ri = 0; ri < this.out.ground.length; ri++) {
      const rec = this.out.ground[ri];
      for (let x = Math.floor(rec.x0); x <= Math.floor(rec.x1); x++) {
        for (let y = Math.floor(rec.y0); y <= Math.floor(rec.y1); y++) {
          const d = depthOf(view, x, y);
          if (d < dLo || d > dHi) continue;
          let clip = this.groundClip.get(d);
          if (!clip) {
            clip = { path: new Path2D(), x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, recs: [] };
            this.groundClip.set(d, clip);
          }
          if (clip.recs[clip.recs.length - 1] !== ri) clip.recs.push(ri);
          const key = x * 65536 + y;
          if (seen.has(key)) continue;
          seen.add(key);
          for (let c = 0; c < 4; c++) {
            const cx = x + (c === 1 || c === 2 ? 1 : 0), cy = y + (c >= 2 ? 1 : 0);
            const px = eye.worldToScreenX(cx, cy), py = eye.worldToScreenY(cx, cy, h(cx, cy));
            if (c === 0) clip.path.moveTo(px, py);
            else clip.path.lineTo(px, py);
            const qx = m.a * px + m.c * py + m.e, qy = m.b * px + m.d * py + m.f;
            if (qx < clip.x0) clip.x0 = qx;
            if (qx > clip.x1) clip.x1 = qx;
            if (qy < clip.y0) clip.y0 = qy;
            if (qy > clip.y1) clip.y1 = qy;
          }
          clip.path.closePath();
        }
      }
    }
    for (const c of this.groundClip.values()) {
      c.x0 = Math.max(0, Math.floor(c.x0) - 2);
      c.y0 = Math.max(0, Math.floor(c.y0) - 2);
      c.x1 = Math.min(W, Math.ceil(c.x1) + 2);
      c.y1 = Math.min(H, Math.ceil(c.y1) + 2);
      dx0 = Math.min(dx0, c.x0);
      dy0 = Math.min(dy0, c.y0);
      dx1 = Math.max(dx1, c.x1);
      dy1 = Math.max(dy1, c.y1);
    }
    // What lies on the ground reaches a little past its tiles' box (a glow): clear that much more next time.
    this.groundDirty = dx1 > dx0 ? [Math.max(0, dx0 - 64), Math.max(0, dy0 - 64), Math.min(W, dx1 + 64) - Math.max(0, dx0 - 64), Math.min(H, dy1 + 64) - Math.max(0, dy0 - 64)] : [0, 0, W, H];
  }

  /* ---- the passes --------------------------------------------------------------------- */

  /** What lies on the ground of line `d`: after the line's ground, before anything stands on it. */
  groundLine(ctx: CanvasRenderingContext2D, d: number): void {
    if (!this.groundAny || (SpellStage.groundMode === 'layer' && !this.groundLayer)) return;
    const clip = this.groundClip.get(d);
    if (!clip || clip.x1 <= clip.x0 || clip.y1 <= clip.y0) return;
    ctx.save();
    ctx.clip(clip.path);
    if (SpellStage.groundMode === 'vector') {
      for (const ri of clip.recs) {
        ctx.save();
        this.out.ground[ri].draw(ctx);
        ctx.restore();
      }
      ctx.restore();
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const w = clip.x1 - clip.x0, hh = clip.y1 - clip.y0;
    if (this.groundLayer) ctx.drawImage(this.groundLayer, clip.x0, clip.y0, w, hh, clip.x0, clip.y0, w, hh);
    ctx.restore();
  }

  /** What stands on line `d`, to be sorted in with the line's bodies and trees by `sy`. */
  itemsAt(d: number): readonly WorldRec[] {
    return this.lines.get(d) ?? NONE;
  }

  /** Draw one thing standing in the world. */
  drawItem(ctx: CanvasRenderingContext2D, rec: WorldRec): void {
    ctx.save();
    if (rec.p >= 0) {
      if (this.parts.life[rec.p] > 0 && this.eye) drawParticle(ctx, this.parts, rec.p, this.eye, this.now);
    } else rec.draw?.(ctx);
    ctx.restore();
  }

  /** Light, over everything and over the night. */
  glowPass(ctx: CanvasRenderingContext2D): void {
    const ps = this.parts;
    if (!this.out.glow.length && !ps.n) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const draw of this.out.glow) {
      draw(ctx);
      ctx.globalAlpha = 1;
    }
    if (ps.n && this.eye) {
      ctx.lineCap = 'round';
      for (let i = 0; i < ps.span; i++) if (ps.life[i] > 0 && isLightKind(ps.kind[i])) drawParticle(ctx, ps, i, this.eye, this.now);
    }
    ctx.restore();
  }

  /** The screen, last: a flash for your own great casts. */
  screenPass(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.out.screen.length) return;
    ctx.save();
    for (const draw of this.out.screen) draw(ctx, w, h);
    ctx.restore();
  }

  /* ---- for the preview ------------------------------------------------------------------- */

  /** Everything on the ground at once, uncut: for a picture with nothing standing in front of it. */
  drawGroundAll(ctx: CanvasRenderingContext2D): void {
    for (const rec of this.out.ground) {
      ctx.save();
      rec.draw(ctx);
      ctx.restore();
    }
  }

  /** Everything standing in the world this frame, unsorted, for a picture to sort in with its own figures. */
  worldItems(): WorldRec[] {
    const out = [...this.out.world];
    const ps = this.parts, eye = this.eye;
    if (!eye) return out;
    for (let i = 0; i < ps.span; i++) {
      if (ps.life[i] <= 0 || isLightKind(ps.kind[i])) continue;
      const x = ps.x[i], y = ps.y[i];
      out.push({ x, y, sx: eye.worldToScreenX(x, y), sy: eye.worldToScreenY(x, y, this.where.ground(x, y)) + ps.bias[i], draw: null, p: i });
    }
    return out;
  }
}

const NONE: readonly WorldRec[] = [];

/** How tall a person stands, in height units, for a body the stage is given. */
export const PERSON_TALL = FIGURE_TOP / HEIGHT_SCALE;
/** And how far out from the middle of them a shell goes, in height units. */
export const PERSON_WIDE = 4;

/** A person as the stage wants them: where, turned which way, and enough of their pose to find a hand in. */
export function personBody(x: number, y: number, z: number, facing: number, kind: 'player' | 'peer', figure: FigurePose): Body {
  return { x, y, z, tall: PERSON_TALL, wide: PERSON_WIDE, facing, kind, figure };
}
