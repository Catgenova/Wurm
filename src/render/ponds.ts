/**
 * The water springs make, as it is drawn: ponds standing at their own level,
 * the streams running down from one to the next, the falls where a stream
 * goes over a step, and the spring itself welling up.
 *
 * Where the water is, is the rules' business (`../world/springs`): which
 * corners each pond covers and how high it stands, which corners each stream
 * runs over, and when each starts. This is only how that looks. A pond's water
 * is drawn tile by tile with the ground, the way the sea is
 * (`Renderer.drawPonds`); everything here is laid over a line of the ground
 * once that line is down -- the light on a pond, a stream, a fall -- so ground
 * standing in front of it still hides it. The mist off a fall goes up with the
 * smoke, after everything.
 *
 * Nothing here is kept but what can be worked out again. A pond rising, a
 * stream running down to the next and the water going over a fall are all
 * read off the clock. What moves is drawn as strokes -- ripples, streaks,
 * threads of falling water -- rather than as pictures laid over whole
 * surfaces, so it costs what there is of it and not what the water covers:
 * a frame with no spring in it pays nothing, and a pond the width of the
 * screen pays for its ripples and not for its width.
 *
 * Spring water is turquoise, not the sea's blue, and is coloured from the one
 * set in `./water` that everything drawing it shares.
 */
import type { Camera } from '../engine/camera';
import { hash2 } from '../world/noise';
import { FALL_DROP, pondLevelAt, RUN_RATE, type PondWater, type StreamWater, type WaterField } from '../world/springs';
import type { World } from '../world/world';
import { HALF_H, HALF_W, HEIGHT_SCALE } from './iso';
import { depthOf, type View } from './view';
import { SPRING_DARK, SPRING_EDGE, SPRING_FOAM, SPRING_PALE, SPRING_WATER } from './water';

/** What a frame of the water is drawn with, handed over by the renderer before the ground. */
export interface WaterFrame {
  world: World;
  cam: Camera;
  view: View;
  /** The wall clock, in milliseconds: what a pond rises and a stream runs by, as the rules have it. */
  now: number;
  /** The drawing clock, in seconds: what the water moves by. */
  t: number;
  width: number;
  height: number;
  /** The first and last line of the ground this frame draws. */
  dLo: number;
  dHi: number;
  /** Which way the wind leans things on screen, and how hard. */
  lean: { x: number; y: number; force: number };
  /** Where the sun is, and how dark it has got. */
  sun: readonly [number, number, number];
  dark: number;
  /** The corner a spring wells up at, by its id. */
  wellAt: (spring: number) => readonly [number, number] | null;
}

/** How deep the water running down a stream is over the ground, in height units: enough to lie on it. */
const FILM = 0.35;
/** Half a stream's width, in tiles, where it runs level and where it runs steepest. */
const STREAM_HALF = 0.1;
const STREAM_HALF_STEEP = 0.066;
/** How many points a stream's line is drawn through for each corner it runs over. */
const PER_CORNER = 8;
/** How far above or below the middle of a stream its banks may be drawn, in height units, so a bank running along a drop does not drag the water down it. */
const BANK_LEAN = 1.5;
/** How far a stream wanders either side of the line of corners it follows, in tiles, and over how many corners it swings back. */
const MEANDER = 0.075;
const MEANDER_LONG = 2.6;
/** How much wider than the water the damp ground along its banks is. */
const DAMP = 1.45;
/** How far past each end each piece of a stream is carried, in steps between points, to close the join with the next. */
const SEAM = 0.12;
/** How fast the water in a stream goes, in corners a second: level, and for each root of a height unit it drops by a corner. */
const RUN_LEVEL = 0.5;
const RUN_STEEP = 0.35;
/** The drop over one corner, in height units, from which a stream breaks white, and where it is white all through. */
const WHITE_FROM = 4;
const WHITE_FULL = 12;
/** How far apart the streaks on a stream are, in seconds of the water's travel, and how long each one is. */
const STREAK_EVERY = 0.42;
const STREAK_LONG = 0.24;
/** Below this zoom the water is its shapes and colours: streaks, ripples, rings and lily pads are too small to see. */
const DETAIL_FROM = 0.6;

/** How far back from its lip a fall's smooth curl begins, on the water coming to it, in tiles. */
const TONGUE = 0.12;
/** Half the width of a falling sheet at its lip, in tiles, how much wider one is that spills straight out of a pond, and how much wider it has spread by the bottom. */
const SHEET_HALF = 0.22;
const SHEET_SPILL = 1.4;
const SHEET_SPREAD = 0.12;
/**
 * The shape of a fall, as a curve from the lip (0, 0) to the foot (1, 1):
 * how far along the step it has gone against how far down. It leaves the lip
 * going straight out, which is the curl, and meets the foot coming straight
 * down.
 */
const CURL_OUT = 0.55;
const CURL_DOWN = 0.3;
/** How fast the streaks and the broken edges of a sheet go down it at its lip, in pixels a second at zoom one. */
const SHEET_SPEED = 46;
/** A fall this tall, in height units, throws up the most spray and mist there is. */
const FALL_TALL = 50;
/** How much of the way down a sheet its threads of falling water start, below the smooth curl. */
const THREADS_FROM = 0.1;

/** A step down a stream at least this tall, in height units, and short of a fall, comes down white and foams at its foot. */
const CASCADE_DROP = 7;
/** Of the corners a pond covers all round, how many carry a lily pad, on the ponds that have them at all; and how close to the water coming in or going out, or to a spring or a fall, one will float, in tiles. */
const PAD_SOME = 0.16;
const PAD_CLEAR = 2;

/** How fast a pond's ripples drift toward its lip, in tiles a second. */
const DRIFT = 0.12;
/** How long a ring on a pond takes to open out and go, in seconds, and how wide it gets, in tiles. */
const RING_LIFE = 3.4;
const RING_WIDE = 0.42;
/** Seconds a puff of mist lasts. */
const MIST_LIFE = 3.4;

/** How far a circle a tile in radius on the ground reaches on screen, at zoom one, to either side and up and down: the iso squash, the same at every turn of the view. */
const DISC_W = HALF_W * Math.SQRT2;
const DISC_H = HALF_H * Math.SQRT2;

/** A pond as it is drawn: where it rises from and when, and which way its water drifts. */
interface PondDraw {
  pond: PondWater;
  level: number;
  from: number;
  since: number;
  /** Where its water comes in, and a unit step in the ground from there toward the lip it leaves by. */
  inX: number;
  inY: number;
  driftX: number;
  driftY: number;
  /** The lily pads on it, if it is a pond that has them. */
  pads: Pad[];
  /**
   * The corners whose four tiles lie wholly under it, as x, y pairs, and the
   * highest ground round each: ripples, rings and lily pads are put only
   * there, where they cannot wander onto the bank, so nothing on a pond
   * needs cutting to the shape of it.
   */
  inner: Int32Array;
  innerTop: Float64Array;
  /** The line of the ground each of those goes after, for the view `rowsFor`. */
  rows: Int32Array;
  rowsFor: number;
  box: [number, number, number, number, number, number];
}

/**
 * A stretch of a stream between two falls, or from a lip to a fall, or a fall
 * to where the stream ends: a line smoothed through the corners it runs over,
 * cut into points, each with the ground under it, how far down the stream it
 * is, how wide the water is there and how long it takes the water to get
 * there.
 */
interface Run {
  stream: number;
  n: number;
  x: Float64Array;
  y: Float64Array;
  /** The ground under the middle and under each bank. */
  g: Float64Array;
  gl: Float64Array;
  gr: Float64Array;
  /** How far down the stream, in corners from its lip. */
  s: Float64Array;
  /** Square to the line, in the ground, and half the water's width there, in tiles. */
  nx: Float64Array;
  ny: Float64Array;
  half: Float64Array;
  /** Seconds of the water's travel from the top of the run. */
  flow: Float64Array;
  /** How white the water is. */
  white: Float64Array;
  /** The line of the ground each piece between two points is drawn after, for the view `rowsFor`. */
  rows: Int32Array;
  rowsFor: number;
  /** Where each point is on screen this frame: the middle and each bank, and the frame that was. */
  scr: Float64Array;
  shown: number;
  box: [number, number, number, number, number, number];
}

/** A step down a stream tall enough to fall: from the lip at corner `at` of its path to the foot at `at + 1`. */
interface Fall {
  stream: number;
  at: number;
  ax: number;
  ay: number;
  top: number;
  bx: number;
  by: number;
  foot: number;
  dx: number;
  dy: number;
  seed: number;
  /** Whether it goes over straight out of a pond, the whole of its spill at once, rather than partway down a stream. */
  spill: boolean;
  /**
   * This frame: the line its sheet is drawn after, or NaN when it is not
   * drawn (a line can be any number, below nought too); the line where it
   * lands is drawn after, which is further forward, since the foam and the
   * rings there lie out over the water in front of the foot; how much of it
   * the water has reached; where it lands, and whether in water; and where
   * the foot of the sheet came on screen, and half its width there.
   */
  row: number;
  footRow: number;
  reach: number;
  land: number;
  wet: boolean;
  footX: number;
  footY: number;
  footWx: number;
  footWy: number;
}

interface StreamDraw {
  src: StreamWater;
  since: number;
  /** The corners it runs over, and the ground at each. */
  px: Int32Array;
  py: Int32Array;
  ph: Float64Array;
  /** Where it goes: a pond, by its place in `ponds`, the sea, or into the ground. */
  into: number | 'sea' | 'lost';
  /** How far it runs, in corners. */
  length: number;
  /** How many corners of level ground it crosses from its pond's water to the lip before the rules' own path begins. */
  lead: number;
  /** This frame: how far down it the water has got, and where it meets the water it runs into. */
  head: number;
  end: number;
}

/** A spring as it is drawn: the corner it wells up at, the pond it fills first, and the line it goes after this frame, NaN when it is not drawn. */
interface WellDraw {
  x: number;
  y: number;
  pond: number;
  row: number;
}

/** A foam where the water ends: a stream's running head, or where it meets a pond or the sea. */
interface Splash {
  x: number;
  y: number;
  h: number;
  /** Across, in tiles. */
  r: number;
  /** A head is a tongue of white water; an entry is rings on the surface. */
  head: boolean;
  row: number;
}

/**
 * A lily pad: where it floats, how wide it is in tiles, which way the notch
 * in it faces, whether it has a flower out, and which of its pond's inner
 * corners it floats over, for the line it goes after and whether the pond
 * has risen to it yet.
 */
interface Pad {
  x: number;
  y: number;
  r: number;
  a: number;
  flower: boolean;
  k: number;
  seed: number;
}

/** A step down a stream that breaks white without falling: the run it is on, how far down the stream its foot is, how tall it is, and this frame where its foot is on screen and after which line, NaN when it is not drawn. */
interface Cascade {
  run: number;
  s: number;
  drop: number;
  seed: number;
  row: number;
  x: number;
  y: number;
}

/** A ring opening out on a pond this frame: where, how wide in tiles, how strong, and after which line. */
interface Ring {
  x: number;
  y: number;
  h: number;
  r: number;
  a: number;
  row: number;
}

export class SpringWater {
  private field: WaterField | null = null;
  private stale = false;
  private ponds: PondDraw[] = [];
  private pondAt = new Map<PondWater, number>();
  private streams: StreamDraw[] = [];
  private runs: Run[] = [];
  private falls: Fall[] = [];
  private wells: WellDraw[] = [];
  private cascades: Cascade[] = [];
  /** Counted up each frame, so a run can say whether it was put on screen in this one. */
  private frameNo = 0;
  /** When each stream was first seen running and each pond rising, so settling the ground again does not start either over. */
  private started = new Map<string, number>();
  private rising = new Map<string, { from: number; since: number }>();
  /** Where each pond's surface stands this frame. */
  private levels = new Float64Array(0);

  /** This frame: the projection of the ground, one linear map for the whole island. */
  private f: WaterFrame | null = null;
  private zoom = 1;
  private ox = 0;
  private oy = 0;
  private xx = 0;
  private xy = 0;
  private yx = 0;
  private yy = 0;
  private hs = HEIGHT_SCALE;
  /** The pieces of stream to lay after each line of the ground, as run and first and last point, and the ripples on its ponds, bright and faint, as three points each. */
  private rowPieces: number[][] = [];
  private rowRipples: number[][] = [];
  private rowFaint: number[][] = [];
  /** The lily pads to lay after each line, as pond and pad. */
  private rowPads: number[][] = [];
  private rowBase = 0;
  private splashes: Splash[] = [];
  private rings: Ring[] = [];
  /** How strongly a bow shows in the spray this frame. */
  private bow = 0;

  private mistTex: HTMLCanvasElement | null = null;
  private foamTex: HTMLCanvasElement | null = null;
  private bowTex: HTMLCanvasElement | null = null;

  /**
   * A tile has changed: where it is under or beside a stream or a pond, the
   * lines they are drawn along are worked out again before the next frame.
   * Anywhere else it changes nothing here.
   */
  touched(x: number, y: number): void {
    if (!this.field || this.stale) return;
    const near = (b: readonly number[]): boolean => x + 1 >= b[0] && x <= b[2] + 1 && y + 1 >= b[1] && y <= b[3] + 1;
    for (const r of this.runs) if (near(r.box)) this.stale = true;
    for (const d of this.ponds) if (near(d.box)) this.stale = true;
  }

  /** Where a pond's surface stands this frame. */
  levelOf(p: PondWater): number {
    const i = this.pondAt.get(p);
    return i === undefined ? p.level : this.levels[i];
  }

  /** Once a frame, before the ground: where everything stands and runs, and which line of the ground each piece of it goes after. */
  frame(f: WaterFrame, field: WaterField): void {
    if (field !== this.field || this.stale) this.lay(field, f.world, f.wellAt);
    this.f = f;
    this.frameNo++;
    const cam = f.cam;
    this.zoom = cam.zoom;
    this.ox = cam.worldToScreenX(0, 0);
    this.oy = cam.worldToScreenY(0, 0, 0);
    this.xx = cam.worldToScreenX(1, 0) - this.ox;
    this.xy = cam.worldToScreenX(0, 1) - this.ox;
    this.yx = cam.worldToScreenY(1, 0, 0) - this.oy;
    this.yy = cam.worldToScreenY(0, 1, 0) - this.oy;
    this.hs = HEIGHT_SCALE * cam.zoom;
    for (let i = 0; i < this.ponds.length; i++) this.levels[i] = pondLevelAt(this.ponds[i], f.now);

    // How far each stream's water has got, and where it goes under the water it runs into.
    for (const st of this.streams) {
      // Nothing until its pond is full; then the level ground to the lip is covered at once, and the water runs on from there.
      const run = ((f.now - st.since) / 1000) * RUN_RATE;
      st.head = run < 0 ? 0 : Math.min(st.length, st.lead + run);
      const surf = st.into === 'sea' ? 0 : st.into === 'lost' ? -Infinity : this.levels[st.into];
      st.end = st.length;
      if (surf > -Infinity) {
        for (let k = 0; k < st.length; k++) {
          const a = st.ph[k];
          const b = st.ph[k + 1];
          if (a < surf) {
            st.end = k;
            break;
          }
          if (b < surf) {
            st.end = k + (a - surf) / (a - b);
            break;
          }
        }
      }
    }

    const rows = f.dHi - f.dLo + 1;
    this.rowBase = f.dLo;
    for (const list of [this.rowPieces, this.rowRipples, this.rowFaint, this.rowPads]) {
      while (list.length < rows) list.push([]);
      for (let i = 0; i < rows; i++) list[i].length = 0;
    }
    this.splashes.length = 0;
    this.rings.length = 0;
    const V = f.view;
    const margin = 60 * this.zoom;
    for (let r = 0; r < this.runs.length; r++) {
      const run = this.runs[r];
      const st = this.streams[run.stream];
      const reach = Math.min(st.head, st.end);
      if (reach <= run.s[0] || !this.onScreen(run.box, margin)) continue;
      this.project(run);
      run.shown = this.frameNo;
      if (run.rowsFor !== cam.rotation) this.runRows(run, V);
      // Consecutive pieces on the same line of the ground go down as one.
      let j0 = 0;
      for (let j = 0; j < run.n - 1; j++) {
        if (run.s[j] >= reach) break;
        const last = j === run.n - 2 || run.s[j + 1] >= reach || run.rows[j + 1] !== run.rows[j];
        if (!last) continue;
        this.rowPieces[this.clampRow(run.rows[j]) - f.dLo].push(r, j0, j);
        j0 = j + 1;
      }
    }
    for (const st of this.streams) {
      const reach = Math.min(st.head, st.end);
      if (reach <= 0) continue;
      // The running head, until it gets where it is going; then where it goes in.
      if (st.head < st.end) {
        if (!this.fallsAt(st, st.head)) this.splash(st, st.head, true);
      } else if (st.into !== 'lost' && !this.fallsAt(st, st.end)) this.splash(st, st.end, false);
    }
    for (const fall of this.falls) this.placeFall(fall);
    for (const c of this.cascades) {
      c.row = NaN;
      const run = this.runs[c.run];
      const st = this.streams[run.stream];
      if (run.shown !== this.frameNo || c.s > Math.min(st.head, st.end) - 0.05) continue;
      const at = CASCADE_AT;
      at.length = 0;
      this.onRun(run, c.s, 0, at);
      c.x = at[0];
      c.y = at[1];
      let j = 0;
      while (j < run.n - 2 && run.s[j + 1] < c.s) j++;
      c.row = this.clampRow(run.rows[j]);
    }
    for (const w of this.wells) {
      w.row = NaN;
      const x = w.x;
      const y = w.y;
      if (!this.onScreen([x - 1, y - 1, x + 1, y + 1, this.levels[w.pond] - 2, this.levels[w.pond] + 2], margin)) continue;
      w.row = this.clampRow(Math.max(depthOf(V, x - 1, y - 1), depthOf(V, x, y - 1), depthOf(V, x - 1, y), depthOf(V, x, y)));
    }
    if (this.zoom >= DETAIL_FROM) {
      for (let i = 0; i < this.ponds.length; i++) this.light(i, f, margin);
    }

    // A bow stands in spray with the sun at your back and low enough for the drops to send it back to you.
    const [sx, sy, sz] = f.sun;
    const toward = ((V.cos - V.sin) * sx + (V.sin + V.cos) * sy) / Math.SQRT2 / (Math.hypot(sx, sy) || 1);
    const low = 1 - Math.min(1, Math.max(0, (sz - 0.52) / 0.2));
    this.bow = Math.max(0, toward) * low * (sz > 0.05 ? 1 : 0) * (1 - f.dark);
  }

  /** Lay the drawing out afresh from a new field, or from the old one over changed ground. */
  private lay(field: WaterField, world: World, wellAt: WaterFrame['wellAt']): void {
    const was = this.field === field;
    this.field = field;
    this.stale = false;
    const cw = world.w + 1;
    const keepRising = new Map<string, { from: number; since: number }>();
    this.ponds = field.ponds.map((p) => {
      // A pond the rules have laid again just as it was keeps rising from where it was rising from.
      const key = `${p.spring}:${p.index}:${p.level}:${p.floor}:${p.wet.size}`;
      const had = this.rising.get(key);
      const rise = had && (was || had.since <= p.since) ? had : { from: p.from, since: p.since };
      keepRising.set(key, rise);
      const inner: number[] = [];
      const innerTop: number[] = [];
      const box: PondDraw['box'] = [Infinity, Infinity, -Infinity, -Infinity, p.floor - 1, p.level + 1];
      for (const k of p.wet) {
        const x = k % cw;
        const y = (k - x) / cw;
        box[0] = Math.min(box[0], x - 1);
        box[1] = Math.min(box[1], y - 1);
        box[2] = Math.max(box[2], x + 1);
        box[3] = Math.max(box[3], y + 1);
        let all = true;
        let top = -Infinity;
        for (let dy = -1; dy <= 1 && all; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!p.wet.has((y + dy) * cw + x + dx)) {
              all = false;
              break;
            }
            top = Math.max(top, world.getHeight(x + dx, y + dy));
          }
        }
        if (!all) continue;
        inner.push(x, y);
        innerTop.push(top);
      }
      return {
        pond: p, level: p.level, from: rise.from, since: rise.since, inX: p.lip[0], inY: p.lip[1], driftX: 0, driftY: 0, pads: [],
        inner: Int32Array.from(inner), innerTop: Float64Array.from(innerTop), rows: new Int32Array(inner.length / 2), rowsFor: -1, box,
      };
    });
    this.rising = keepRising;
    this.pondAt.clear();
    this.ponds.forEach((d, i) => this.pondAt.set(d.pond, i));
    this.levels = new Float64Array(this.ponds.length);
    const pondOf = (spring: number, index: number): number => this.ponds.findIndex((d) => d.pond.spring === spring && d.pond.index === index);

    const keepStarted = new Map<string, number>();
    this.streams = field.streams.map((s) => {
      const above = field.ponds.find((p) => p.spring === s.spring && p.index === s.from);
      // A pond standing exactly level with ground between its water and its lip runs out across that ground first.
      const lead = above && above.wet.size ? leadIn(above, s.path[0], s.path[1], world) : [];
      const n = lead.length / 2 + s.path.length / 2;
      const px = new Int32Array(n);
      const py = new Int32Array(n);
      const ph = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        const from = k * 2 < lead.length ? lead : s.path;
        const at = k * 2 < lead.length ? k * 2 : k * 2 - lead.length;
        px[k] = from[at];
        py[k] = from[at + 1];
        ph[k] = world.getHeight(px[k], py[k]);
      }
      // The same water running the same way from the same pond keeps running: settling the ground again starts every stream over from its lip.
      const key = `${s.spring}:${s.from}:${above?.level}:${s.path.join(',')}`;
      const had = this.started.get(key);
      const since = had !== undefined ? Math.min(had, s.since) : s.since;
      keepStarted.set(key, since);
      const into = s.to === 'sea' || s.to === 'lost' ? s.to : pondOf(s.spring, s.to);
      return { src: s, since, px, py, ph, into: into === -1 ? 'lost' : into, length: n - 1, lead: lead.length / 2, head: 0, end: n - 1 };
    });
    this.started = keepStarted;

    // Which way each pond drifts: from where its water comes in toward the lip it goes out over.
    this.ponds.forEach((d) => {
      const p = d.pond;
      const feed = this.streams.find((s) => s.into !== 'sea' && s.into !== 'lost' && this.ponds[s.into] === d);
      const well = p.index === 0 ? wellAt(p.spring) : null;
      d.inX = feed ? feed.px[feed.length] : well ? well[0] : p.lip[0];
      d.inY = feed ? feed.py[feed.length] : well ? well[1] : p.lip[1];
      const dx = p.lip[0] - d.inX;
      const dy = p.lip[1] - d.inY;
      const l = Math.hypot(dx, dy);
      d.driftX = l > 0 ? dx / l : 0;
      d.driftY = l > 0 ? dy / l : 0;
    });

    this.runs = [];
    this.falls = [];
    this.streams.forEach((st, i) => this.lines(st, i, world));
    this.wells = [];
    for (const d of this.ponds) {
      // A pool poured into a slab has no corners of its own under water, and is drawn with the slab.
      if (d.pond.index !== 0 || !d.pond.wet.size) continue;
      const at = wellAt(d.pond.spring);
      if (at) this.wells.push({ x: at[0], y: at[1], pond: this.pondAt.get(d.pond) ?? 0, row: NaN });
    }
    // Where a stream steps down too little to fall but enough to break white, foam at the foot of the step.
    this.cascades = [];
    this.runs.forEach((run, r) => {
      const st = this.streams[run.stream];
      for (let k = Math.ceil(run.s[0]); k < Math.floor(run.s[run.n - 1]); k++) {
        const drop = st.ph[k] - st.ph[k + 1];
        if (drop >= CASCADE_DROP) this.cascades.push({ run: r, s: k + 1, drop, seed: hash2(st.px[k], st.py[k], 41), row: NaN, x: 0, y: 0 });
      }
    });
    for (const d of this.ponds) this.plantPads(d, world);
  }

  /**
   * Lily pads, on some of the still ponds: over a few of the corners the pond
   * covers all round, picked by where they are so they are always the same,
   * and never near where the water comes in or goes out, nor near the spring
   * or a fall, where the water is moving.
   */
  private plantPads(d: PondDraw, world: World): void {
    const p = d.pond;
    if (hash2(p.spring, p.index, 29) > 0.7) return;
    const clear: number[] = [p.lip[0], p.lip[1], d.inX, d.inY];
    const well = this.wells.find((w) => this.ponds[w.pond] === d);
    if (well) clear.push(well.x, well.y);
    for (const fall of this.falls) clear.push(fall.bx, fall.by);
    for (let k = 0; k < d.inner.length / 2; k++) {
      const cx = d.inner[k * 2];
      const cy = d.inner[k * 2 + 1];
      if (hash2(cx, cy, 31 + p.index) > PAD_SOME) continue;
      const x = cx + (hash2(cx, cy, 33) - 0.5) * 0.5;
      const y = cy + (hash2(cx, cy, 35) - 0.5) * 0.5;
      let ok = true;
      for (let i = 0; i < clear.length && ok; i += 2) if (Math.hypot(x - clear[i], y - clear[i + 1]) < PAD_CLEAR) ok = false;
      for (const q of d.pads) if (Math.hypot(x - q.x, y - q.y) < 0.6) ok = false;
      if (!ok || world.getHeight(cx, cy) > p.level - 1) continue;
      const seed = hash2(cx, cy, 37);
      d.pads.push({ x, y, r: 0.15 + 0.09 * hash2(cx, cy, 39), a: seed * Math.PI * 2, flower: hash2(cx, cy, 43) < 0.28, k, seed });
    }
  }

  /** A stream's runs and falls, from the corners it goes over. */
  private lines(st: StreamDraw, index: number, world: World): void {
    const n = st.length + 1;
    let first = 0;
    for (let k = 0; k < n - 1; k++) {
      if (st.ph[k] - st.ph[k + 1] < FALL_DROP) continue;
      if (k > first) this.runs.push(this.run(st, index, first, k, world));
      this.falls.push({
        stream: index, at: k, ax: st.px[k], ay: st.py[k], top: st.ph[k], bx: st.px[k + 1], by: st.py[k + 1], foot: st.ph[k + 1],
        dx: st.px[k + 1] - st.px[k], dy: st.py[k + 1] - st.py[k], seed: ((st.px[k] * 7919 + st.py[k] * 104729) % 1000) / 1000,
        spill: k === st.lead, row: NaN, footRow: NaN, reach: 0, land: 0, wet: false, footX: 0, footY: 0, footWx: 0, footWy: 0,
      });
      first = k + 1;
    }
    if (n - 1 > first) this.runs.push(this.run(st, index, first, n - 1, world));
  }

  /**
   * The line a stretch of stream runs along, from corner `i0` of its path to
   * `i1`. Straight down the middle of a corner-to-corner step, and round each
   * corner it turns at on a curve from halfway along the step before to
   * halfway along the step after, so a stream coming down a slope on the
   * diagonal runs down it rather than in steps.
   */
  private run(st: StreamDraw, stream: number, i0: number, i1: number, world: World): Run {
    const xs: number[] = [];
    const ys: number[] = [];
    const ss: number[] = [];
    const px = (k: number): number => st.px[k];
    const py = (k: number): number => st.py[k];
    const half = PER_CORNER / 2;
    if (i1 - i0 === 1) {
      for (let q = 0; q <= PER_CORNER; q++) {
        const t = q / PER_CORNER;
        xs.push(px(i0) + (px(i1) - px(i0)) * t);
        ys.push(py(i0) + (py(i1) - py(i0)) * t);
        ss.push(i0 + t);
      }
    } else {
      for (let q = 0; q < half; q++) {
        const t = q / PER_CORNER;
        xs.push(px(i0) + (px(i0 + 1) - px(i0)) * t);
        ys.push(py(i0) + (py(i0 + 1) - py(i0)) * t);
        ss.push(i0 + t);
      }
      for (let k = i0 + 1; k < i1; k++) {
        const mx0 = (px(k - 1) + px(k)) / 2;
        const my0 = (py(k - 1) + py(k)) / 2;
        const mx1 = (px(k) + px(k + 1)) / 2;
        const my1 = (py(k) + py(k + 1)) / 2;
        for (let q = 0; q < PER_CORNER; q++) {
          const u = q / PER_CORNER;
          const a = (1 - u) * (1 - u);
          const b = 2 * u * (1 - u);
          const c = u * u;
          xs.push(a * mx0 + b * px(k) + c * mx1);
          ys.push(a * my0 + b * py(k) + c * my1);
          ss.push(k - 0.5 + u);
        }
      }
      for (let q = 0; q <= half; q++) {
        const t = 0.5 + q / PER_CORNER;
        xs.push(px(i1 - 1) + (px(i1) - px(i1 - 1)) * t);
        ys.push(py(i1 - 1) + (py(i1) - py(i1 - 1)) * t);
        ss.push(i1 - 1 + t);
      }
    }
    const n = xs.length;
    const run: Run = {
      stream, n,
      x: Float64Array.from(xs), y: Float64Array.from(ys), s: Float64Array.from(ss),
      g: new Float64Array(n), gl: new Float64Array(n), gr: new Float64Array(n),
      nx: new Float64Array(n), ny: new Float64Array(n), half: new Float64Array(n),
      flow: new Float64Array(n), white: new Float64Array(n),
      rows: new Int32Array(Math.max(1, n - 1)), rowsFor: -1,
      scr: new Float64Array(n * 6), shown: 0,
      box: [Infinity, Infinity, -Infinity, -Infinity, Infinity, -Infinity],
    };
    // How steep the step each point is on, in height units over the corner.
    const dropAt = (s: number): number => {
      const k = Math.max(0, Math.min(st.length - 1, Math.floor(s)));
      return Math.max(0, st.ph[k] - st.ph[k + 1]);
    };
    const normals = (): void => {
      for (let j = 0; j < n; j++) {
        const a = Math.max(0, j - 1);
        const b = Math.min(n - 1, j + 1);
        const tx = run.x[b] - run.x[a];
        const ty = run.y[b] - run.y[a];
        const tl = Math.hypot(tx, ty) || 1;
        run.nx[j] = -ty / tl;
        run.ny[j] = tx / tl;
      }
    };
    normals();
    // A stream does not keep to a ruled line: it wanders a little either side of the corners it follows, and comes back to them at each end of the run, where it meets a lip or a fall.
    const seed = st.px[i0] * 0.731 + st.py[i0] * 0.377 + stream * 1.93;
    for (let j = 1; j < n - 1; j++) {
      const sj = run.s[j];
      const ends = Math.min(1, (sj - i0) / 0.7, (i1 - sj) / 0.7);
      const fade = ends * ends * (3 - 2 * ends);
      const off = MEANDER * fade * (Math.sin((sj / MEANDER_LONG) * Math.PI * 2 + seed) * 0.75 + Math.sin((sj / (MEANDER_LONG * 0.55)) * Math.PI * 2 + seed * 2.3) * 0.25);
      run.x[j] += run.nx[j] * off;
      run.y[j] += run.ny[j] * off;
    }
    normals();
    let speedWas = 0;
    for (let j = 0; j < n; j++) {
      const drop = dropAt(run.s[j] === i1 ? i1 - 0.5 : run.s[j]);
      const steep = Math.min(1, drop / WHITE_FULL);
      // Narrower where it hurries, and never quite the same width twice.
      let w = (STREAM_HALF + (STREAM_HALF_STEEP - STREAM_HALF) * steep) * (1 + 0.16 * Math.sin((run.s[j] / 1.7) * Math.PI * 2 + seed * 3.1));
      // Water that soaks away thins out over the last corner it runs.
      if (st.into === 'lost') w *= Math.max(0, Math.min(1, st.length - run.s[j]));
      run.half[j] = w;
      run.white[j] = Math.max(0, Math.min(1, (drop - WHITE_FROM) / (WHITE_FULL - WHITE_FROM)));
      const g = world.heightAt(run.x[j], run.y[j]);
      run.g[j] = g;
      const bank = (x: number, y: number): number => Math.max(g - BANK_LEAN, Math.min(g + BANK_LEAN, world.heightAt(x, y)));
      run.gl[j] = bank(run.x[j] - run.nx[j] * w, run.y[j] - run.ny[j] * w);
      run.gr[j] = bank(run.x[j] + run.nx[j] * w, run.y[j] + run.ny[j] * w);
      const speed = RUN_LEVEL + RUN_STEEP * Math.sqrt(drop);
      if (j > 0) run.flow[j] = run.flow[j - 1] + (run.s[j] - run.s[j - 1]) / ((speed + speedWas) / 2);
      speedWas = speed;
      const bx = run.box;
      bx[0] = Math.min(bx[0], run.x[j] - w * DAMP);
      bx[1] = Math.min(bx[1], run.y[j] - w * DAMP);
      bx[2] = Math.max(bx[2], run.x[j] + w * DAMP);
      bx[3] = Math.max(bx[3], run.y[j] + w * DAMP);
      bx[4] = Math.min(bx[4], g - BANK_LEAN);
      bx[5] = Math.max(bx[5], g + BANK_LEAN);
    }
    return run;
  }

  /** Which line of the ground each piece of a run goes down after: the nearest of the tiles its water lies on, so all of them are down before it. */
  private runRows(run: Run, V: View): void {
    for (let j = 0; j < run.n - 1; j++) {
      const w = Math.max(run.half[j], run.half[j + 1]) * DAMP + 0.02;
      const x0 = Math.floor(Math.min(run.x[j], run.x[j + 1]) - w);
      const x1 = Math.floor(Math.max(run.x[j], run.x[j + 1]) + w - 1e-6);
      const y0 = Math.floor(Math.min(run.y[j], run.y[j + 1]) - w);
      const y1 = Math.floor(Math.max(run.y[j], run.y[j + 1]) + w - 1e-6);
      run.rows[j] = Math.max(depthOf(V, x0, y0), depthOf(V, x1, y0), depthOf(V, x0, y1), depthOf(V, x1, y1));
    }
    run.rowsFor = this.f?.cam.rotation ?? -1;
  }

  private clampRow(d: number): number {
    const f = this.f;
    if (!f) return d;
    return Math.max(f.dLo, Math.min(f.dHi, d));
  }

  /** Whether a box of the ground, x, y and height from and to, comes anywhere near the screen. */
  private onScreen(b: readonly [number, number, number, number, number, number], margin: number): boolean {
    const f = this.f;
    if (!f) return false;
    let lx = Infinity;
    let hx = -Infinity;
    let ly = Infinity;
    let hy = -Infinity;
    for (let i = 0; i < 4; i++) {
      const x = i & 1 ? b[2] : b[0];
      const y = i & 2 ? b[3] : b[1];
      const sx = this.ox + this.xx * x + this.xy * y;
      const sy = this.oy + this.yx * x + this.yy * y;
      lx = Math.min(lx, sx);
      hx = Math.max(hx, sx);
      ly = Math.min(ly, sy - b[5] * this.hs);
      hy = Math.max(hy, sy - b[4] * this.hs);
    }
    return hx > -margin && lx < f.width + margin && hy > -margin && ly < f.height + margin;
  }

  /** Every point of a run on screen: the middle of the water and each bank. */
  private project(run: Run): void {
    const o = run.scr;
    for (let j = 0; j < run.n; j++) {
      const x = run.x[j];
      const y = run.y[j];
      const w = run.half[j];
      const nx = run.nx[j] * w;
      const ny = run.ny[j] * w;
      o[j * 6] = this.sx(x, y);
      o[j * 6 + 1] = this.sy(x, y, run.g[j] + FILM);
      o[j * 6 + 2] = this.sx(x - nx, y - ny);
      o[j * 6 + 3] = this.sy(x - nx, y - ny, run.gl[j] + FILM);
      o[j * 6 + 4] = this.sx(x + nx, y + ny);
      o[j * 6 + 5] = this.sy(x + nx, y + ny, run.gr[j] + FILM);
    }
  }

  private sx(x: number, y: number): number {
    return this.ox + this.xx * x + this.xy * y;
  }

  private sy(x: number, y: number, h: number): number {
    return this.oy + this.yx * x + this.yy * y - h * this.hs;
  }

  /** Whether a stream's water is going over a fall at a point down it, rather than running. */
  private fallsAt(st: StreamDraw, s: number): boolean {
    const k = Math.floor(s);
    return k < st.length && st.ph[k] - st.ph[k + 1] >= FALL_DROP;
  }

  /** Where a point down a stream is: its place on the ground, and the height of the ground there. */
  private pointOn(st: StreamDraw, s: number): [number, number, number] {
    const k = Math.max(0, Math.min(st.length - 1, Math.floor(s)));
    const t = Math.max(0, Math.min(1, s - k));
    return [
      st.px[k] + (st.px[k + 1] - st.px[k]) * t,
      st.py[k] + (st.py[k + 1] - st.py[k]) * t,
      st.ph[k] + (st.ph[k + 1] - st.ph[k]) * t,
    ];
  }

  private splash(st: StreamDraw, s: number, head: boolean): void {
    const f = this.f;
    if (!f) return;
    const [x, y, g] = this.pointOn(st, s);
    const surf = head ? g + FILM : st.into === 'sea' ? 0 : st.into === 'lost' ? g : this.levels[st.into];
    const r = head ? STREAM_HALF * 1.5 : 0.36;
    if (!this.onScreen([x - r, y - r, x + r, y + r, surf - 1, surf + 1], 40 * this.zoom)) return;
    this.splashes.push({ x, y, h: surf, r, head, row: this.rowAround(x, y, r) });
  }

  /** The line of the ground that the last of the tiles within `r` of a point is drawn on. */
  private rowAround(x: number, y: number, r: number): number {
    const V = this.f?.view;
    if (!V) return 0;
    const tx0 = Math.floor(x - r);
    const tx1 = Math.floor(x + r);
    const ty0 = Math.floor(y - r);
    const ty1 = Math.floor(y + r);
    return this.clampRow(Math.max(depthOf(V, tx0, ty0), depthOf(V, tx1, ty0), depthOf(V, tx0, ty1), depthOf(V, tx1, ty1)));
  }

  /** Where a fall is this frame: whether the water has got to it, how far down it has got, and what it lands on. */
  private placeFall(fall: Fall): void {
    fall.row = NaN;
    fall.footRow = NaN;
    const f = this.f;
    if (!f) return;
    const st = this.streams[fall.stream];
    fall.reach = Math.max(0, Math.min(1, st.head - fall.at));
    // Under the water it runs into, when a pond below has risen over its lip.
    if (fall.reach <= 0 || st.end <= fall.at + 0.02) return;
    fall.wet = st.end < fall.at + 1;
    fall.land = fall.wet ? (st.into === 'sea' ? 0 : st.into === 'lost' ? fall.foot : this.levels[st.into]) : fall.foot;
    if (fall.top + FILM - fall.land < 2) return;
    const x0 = Math.min(fall.ax, fall.bx) - 1;
    const y0 = Math.min(fall.ay, fall.by) - 1;
    if (!this.onScreen([x0, y0, x0 + 3, y0 + 3, fall.land - 4, fall.top + 12], 80 * this.zoom)) return;
    const V = f.view;
    const bx = fall.bx;
    const by = fall.by;
    fall.row = this.clampRow(Math.max(depthOf(V, bx - 1, by - 1), depthOf(V, bx, by - 1), depthOf(V, bx - 1, by), depthOf(V, bx, by)));
    // Out over water the foam and the rings spread a tile round the foot; on dry ground they keep closer in.
    fall.footRow = Math.max(fall.row, fall.reach < 1 ? fall.row : this.rowAround(bx, by, fall.wet ? 1 : 0.5));
  }

  /**
   * What is on a pond this frame: short curved ripples, each catching the
   * sky for a moment and going, drifting slowly from where the water comes
   * in toward the lip it leaves by; now and then a ring opening out where
   * something touched the surface; and its lily pads, once it has risen to
   * them. Put only where the pond has water all round, into the lists for
   * the lines they go after.
   */
  private light(i: number, f: WaterFrame, margin: number): void {
    const d = this.ponds[i];
    const n = d.inner.length / 2;
    if (!n || !this.onScreen(d.box, margin)) return;
    const level = this.levels[i];
    const V = f.view;
    if (d.rowsFor !== f.cam.rotation) {
      for (let k = 0; k < n; k++) {
        const x = d.inner[k * 2];
        const y = d.inner[k * 2 + 1];
        d.rows[k] = Math.max(depthOf(V, x - 1, y - 1), depthOf(V, x, y - 1), depthOf(V, x - 1, y), depthOf(V, x, y));
      }
      d.rowsFor = f.cam.rotation;
    }
    const z = this.zoom;
    const t = f.t;
    const long = 0.1 * DISC_W * z;
    for (let k = 0; k < n; k++) {
      // Not yet under a pond still rising.
      if (d.innerTop[k] >= level - 0.2) continue;
      const cx = d.inner[k * 2];
      const cy = d.inner[k * 2 + 1];
      const row = this.clampRow(d.rows[k]) - this.rowBase;
      for (let g = 0; g < 3; g++) {
        const h = hash2(cx, cy, g + i * 7);
        if (g > 0 && h > 0.85 - g * 0.25) continue;
        // Each ripple lives a few seconds, somewhere near its corner, and comes back somewhere else.
        const life = 2.2 + 1.6 * h;
        const age = t / life + h * 13.7;
        const cycle = Math.floor(age);
        const phase = age - cycle;
        const ox = (hash2(cx + cycle, cy, g) - 0.5) * 0.7 + d.driftX * DRIFT * phase * life;
        const oy = (hash2(cx, cy + cycle, g + 3) - 0.5) * 0.7 + d.driftY * DRIFT * phase * life;
        const size = Math.sin(Math.PI * phase) * long * (0.6 + 0.8 * hash2(cx + cycle, cy + cycle, g + 5));
        if (size < 0.6) continue;
        const x = this.sx(cx + ox, cy + oy);
        const y = this.sy(cx + ox, cy + oy, level);
        // A short curve, bowed up over a wavelet's back or down into the trough before it.
        const bow = size * (hash2(cx + cycle, cy, g + 9) < 0.7 ? -0.34 : 0.26);
        (h < 0.3 ? this.rowRipples : this.rowFaint)[row].push(x - size, y, x, y + bow, x + size, y);
      }
    }
    // The lily pads floating on it, once it has risen to them.
    d.pads.forEach((pad, q) => {
      if (d.innerTop[pad.k] < level - 0.5) this.rowPads[this.clampRow(d.rows[pad.k]) - this.rowBase].push(i, q);
    });
    // Two rings at a time at most, each on its own corner, opening and fading.
    for (let slot = 0; slot < 2; slot++) {
      const age = t / RING_LIFE + slot * 0.5 + d.pond.spring * 0.37 + d.pond.index * 0.19;
      const cycle = Math.floor(age);
      const phase = age - cycle;
      const k = Math.floor(hash2(cycle, slot, i) * n);
      if (d.innerTop[k] >= level - 0.2) continue;
      const cx = d.inner[k * 2] + (hash2(cycle, k, 1) - 0.5) * 0.3;
      const cy = d.inner[k * 2 + 1] + (hash2(k, cycle, 2) - 0.5) * 0.3;
      this.rings.push({
        x: cx, y: cy, h: level, r: 0.04 + RING_WIDE * phase,
        a: 0.34 * (1 - phase) * (1 - phase) * Math.min(1, phase * 8), row: this.clampRow(d.rows[k]),
      });
    }
  }

  /**
   * Everything laid over line `d` of the ground once it is down: the light on
   * its ponds, the streams across it, the falls landing on it and the springs
   * welling up in it.
   */
  row(ctx: CanvasRenderingContext2D, d: number): void {
    const f = this.f;
    if (!f) return;
    const at = d - this.rowBase;
    const ripples = this.rowRipples[at];
    const faint = this.rowFaint[at];
    if ((ripples && ripples.length) || (faint && faint.length)) this.ripples(ctx, ripples ?? [], faint ?? []);
    for (const r of this.rings) if (r.row === d) this.drawRing(ctx, r);
    const pads = this.rowPads[at];
    if (pads && pads.length) this.drawPads(ctx, f, pads);
    const pieces = this.rowPieces[at];
    if (pieces && pieces.length) this.streamPieces(ctx, f, pieces);
    for (const c of this.cascades) if (c.row === d) this.drawCascade(ctx, f, c);
    for (const s of this.splashes) if (s.row === d) this.drawSplash(ctx, f, s);
    for (const fall of this.falls) if (fall.row === d) this.drawFall(ctx, f, fall);
    for (const fall of this.falls) if (fall.footRow === d && fall.reach >= 1) this.plunge(ctx, f, fall);
    for (const w of this.wells) if (w.row === d) this.drawWell(ctx, f, w);
  }

  /* ---- Ponds ------------------------------------------------------------- */

  /** A line's ripples: short curved strokes of white lying across the water, the brighter few and the rest. */
  private ripples(ctx: CanvasRenderingContext2D, bright: number[], faint: number[]): void {
    const z = this.zoom;
    ctx.lineCap = 'round';
    for (const [list, ink, width] of [[faint, RIPPLE_FAINT, 1.1], [bright, RIPPLE_BRIGHT, 1.35]] as const) {
      if (!list.length) continue;
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(0.8, width * z);
      ctx.beginPath();
      for (let i = 0; i < list.length; i += 6) {
        ctx.moveTo(list[i], list[i + 1]);
        ctx.quadraticCurveTo(list[i + 2], list[i + 3], list[i + 4], list[i + 5]);
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1;
  }

  /** A ring on a pond, with a fainter one inside it once it has opened out. */
  private drawRing(ctx: CanvasRenderingContext2D, r: Ring): void {
    const z = this.zoom;
    const x = this.sx(r.x, r.y);
    const y = this.sy(r.x, r.y, r.h);
    ctx.lineWidth = Math.max(0.8, 1.1 * z);
    ctx.strokeStyle = foam(r.a);
    ctx.beginPath();
    ctx.ellipse(x, y, r.r * DISC_W * z, r.r * DISC_H * z, 0, 0, Math.PI * 2);
    ctx.stroke();
    if (r.r > 0.12) {
      ctx.strokeStyle = foam(r.a * 0.55);
      ctx.beginPath();
      ctx.ellipse(x, y, r.r * 0.62 * DISC_W * z, r.r * 0.62 * DISC_H * z, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  /**
   * A line's lily pads, each a flat green round with a notch cut out of it,
   * lying on the water with its shadow under it and turning a little as it
   * rides; now and then one with a flower out, pink round a yellow heart.
   * Laid a layer at a time for the whole line.
   */
  private drawPads(ctx: CanvasRenderingContext2D, f: WaterFrame, list: number[]): void {
    const z = this.zoom;
    const t = f.t;
    const at = PAD_AT;
    let m = 0;
    for (let i = 0; i < list.length; i += 2) {
      const d = this.ponds[list[i]];
      const pad = d.pads[list[i + 1]];
      at[m++] = this.sx(pad.x, pad.y);
      at[m++] = this.sy(pad.x, pad.y, this.levels[list[i]]) + Math.sin(t * 0.9 + pad.seed * 6) * 0.35 * z;
      at[m++] = pad.r * DISC_W * z;
      at[m++] = pad.r * DISC_H * z;
      at[m++] = pad.a + 0.14 * Math.sin(t * 0.21 + pad.seed * 9);
      at[m++] = pad.flower ? 1 : 0;
      if (m >= at.length) break;
    }
    const shape = (grow: number, dy: number, notch: boolean): void => {
      ctx.beginPath();
      for (let i = 0; i < m; i += 6) {
        const x = at[i];
        const y = at[i + 1] + at[i + 3] * dy;
        if (notch) {
          ctx.moveTo(x, y);
          ctx.ellipse(x, y, at[i + 2] * grow, at[i + 3] * grow, 0, at[i + 4] + PAD_NOTCH, at[i + 4] + Math.PI * 2 - PAD_NOTCH);
          ctx.closePath();
        } else {
          ctx.moveTo(x + at[i + 2] * grow, y);
          ctx.ellipse(x, y, at[i + 2] * grow, at[i + 3] * grow, 0, 0, Math.PI * 2);
        }
      }
    };
    shape(1.04, 0.24, false);
    ctx.fillStyle = PAD_SHADOW;
    ctx.fill();
    shape(1, 0, true);
    ctx.fillStyle = PAD_GREEN;
    ctx.fill();
    ctx.strokeStyle = PAD_RIM;
    ctx.lineWidth = Math.max(0.7, 0.8 * z);
    ctx.stroke();
    // The paler middle, and close in the veins running out from it.
    ctx.fillStyle = PAD_LIGHT;
    ctx.beginPath();
    for (let i = 0; i < m; i += 6) {
      ctx.moveTo(at[i] - at[i + 2] * 0.1 + at[i + 2] * 0.5, at[i + 1] - at[i + 3] * 0.14);
      ctx.ellipse(at[i] - at[i + 2] * 0.1, at[i + 1] - at[i + 3] * 0.14, at[i + 2] * 0.5, at[i + 3] * 0.46, 0, 0, Math.PI * 2);
    }
    ctx.fill();
    if (z >= 1.8) {
      ctx.strokeStyle = PAD_VEIN;
      ctx.lineWidth = Math.max(0.6, 0.55 * z);
      ctx.beginPath();
      for (let i = 0; i < m; i += 6) {
        for (let v = 1; v < 6; v++) {
          const a = at[i + 4] + PAD_NOTCH + ((Math.PI * 2 - 2 * PAD_NOTCH) * v) / 6;
          ctx.moveTo(at[i], at[i + 1]);
          ctx.lineTo(at[i] + Math.cos(a) * at[i + 2] * 0.85, at[i + 1] + Math.sin(a) * at[i + 3] * 0.85);
        }
      }
      ctx.stroke();
    }
    // The flowers, stood up off the pad: an outer ring of petals, a paler inner one, and the heart.
    for (const [ink, reach, size] of [[PAD_PETAL, 0.34, 0.3], [PAD_PETAL_LIGHT, 0.17, 0.2], [PAD_HEART, 0, 0.1]] as const) {
      ctx.fillStyle = ink;
      ctx.beginPath();
      for (let i = 0; i < m; i += 6) {
        if (!at[i + 5]) continue;
        const r = at[i + 2];
        const x = at[i];
        const y = at[i + 1] - r * 0.28;
        const petals = reach ? 6 : 1;
        for (let k = 0; k < petals; k++) {
          const a = (k / petals) * Math.PI * 2 + at[i + 4];
          const px = x + Math.cos(a) * r * reach;
          const py = y + Math.sin(a) * r * reach * 0.55 - (reach ? r * 0.06 : 0);
          ctx.moveTo(px + r * size, py);
          ctx.ellipse(px, py, r * size, r * size * (reach ? 0.62 : 0.8), 0, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    }
    ctx.lineWidth = 1;
  }

  /** Foam at the foot of a step down a stream: a few small lumps, shaded under, and a drop or two thrown off them. */
  private drawCascade(ctx: CanvasRenderingContext2D, f: WaterFrame, c: Cascade): void {
    const z = this.zoom;
    const t = f.t;
    const size = (0.03 + 0.03 * Math.min(1, c.drop / FALL_DROP)) * DISC_W * z;
    for (const [ink, lift] of [[PLUME_SHADE, -0.2], [FOAM_SOLID, 0.1]] as const) {
      ctx.fillStyle = ink;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const pulse = 0.5 + 0.5 * Math.sin(t * (3.3 + i) + c.seed * 17 + i * 2.1);
        const r = size * (i ? 0.7 : 1) * (0.8 + 0.3 * pulse) * (lift < 0 ? 1 : 0.9);
        const x = c.x + (i ? Math.cos(i * 2.1 + c.seed * 6) * size * 1.1 : 0);
        const y = c.y + (i ? Math.sin(i * 2.1 + c.seed * 6) * size * 0.5 : 0) - size * 0.4 * pulse - r * lift;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const age = (t / 0.8 + i / 3 + c.seed) % 1;
      const side = i % 2 ? 1 : -1;
      const x = c.x + side * size * (0.6 + 2.2 * age);
      const y = c.y - size * 2.4 * (age * 2 - age * age * 1.7);
      const r = Math.max(0.5, (1.4 - age) * 0.7 * z);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  /* ---- Streams ----------------------------------------------------------- */

  /**
   * The pieces of stream that go after this line of the ground: the damp
   * ground along it, the water itself, a paler run of sky down its middle,
   * the streaks going down it at the pace the slope sets, and white water
   * where it steepens.
   */
  private streamPieces(ctx: CanvasRenderingContext2D, f: WaterFrame, pieces: number[]): void {
    const z = this.zoom;
    ctx.fillStyle = STREAM_DAMP;
    ctx.beginPath();
    for (let i = 0; i < pieces.length; i += 3) this.ribbon(ctx, this.runs[pieces[i]], pieces[i + 1], pieces[i + 2], DAMP, 0);
    ctx.fill();
    /*
     * The water, edged with a thin darker teal where it meets its banks, and
     * a paler run of sky down the middle of it in two bands, so it has no
     * edge of its own. Each is solid, and carried a hair past each end of the
     * piece, the inner bands further than the outer: where the piece is laid
     * over the end of its neighbour, every edge of it falls on the same colour
     * or under the band laid next, so the pieces of one stream laid after
     * different lines meet without a seam whichever is laid last. See-through
     * bands would leave one, where the edge of the water half covered the sky
     * beneath it and the sky over it only half made up.
     */
    for (const [width, ink, past] of STREAM_BANDS) {
      ctx.fillStyle = ink;
      ctx.beginPath();
      for (let i = 0; i < pieces.length; i += 3) this.ribbon(ctx, this.runs[pieces[i]], pieces[i + 1], pieces[i + 2], width, past);
      ctx.fill();
    }
    if (z < DETAIL_FROM) return;
    // The streaks: each a short line down the water, placed by how long the water takes to get there, so they string out where it runs fast.
    ctx.lineCap = 'round';
    const bright = STREAKS;
    const dim = STREAKS_DIM;
    const whites = WHITES;
    bright.length = 0;
    dim.length = 0;
    whites.length = 0;
    for (let i = 0; i < pieces.length; i += 3) this.streaks(f, this.runs[pieces[i]], pieces[i + 1], pieces[i + 2], bright, dim, whites);
    for (const [list, ink, width] of [[dim, STREAK_DIM, 0.8], [bright, STREAK_BRIGHT, 1]] as const) {
      if (!list.length) continue;
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(0.6, width * z);
      ctx.beginPath();
      for (let i = 0; i < list.length; i += 6) {
        ctx.moveTo(list[i], list[i + 1]);
        ctx.quadraticCurveTo(list[i + 2], list[i + 3], list[i + 4], list[i + 5]);
      }
      ctx.stroke();
    }
    if (whites.length) {
      ctx.strokeStyle = STREAK_WHITE;
      ctx.lineWidth = Math.max(0.9, 1.35 * z);
      ctx.beginPath();
      for (let i = 0; i < whites.length; i += 4) {
        ctx.moveTo(whites[i], whites[i + 1]);
        ctx.lineTo(whites[i + 2], whites[i + 3]);
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1;
  }

  /**
   * One piece of a run as a closed outline: down one bank and back up the
   * other, `width` of the way out from the middle. `past` carries it that
   * much of a step on beyond each end, where another piece joins it, and it
   * stops where the water does.
   */
  private ribbon(ctx: CanvasRenderingContext2D, run: Run, j0: number, j1: number, width: number, past: number): void {
    const st = this.streams[run.stream];
    const reach = Math.min(st.head, st.end);
    const o = run.scr;
    // The end: the far point of the last piece, or partway along it where the water has got to.
    let tEnd = 1 + past;
    const sEnd = run.s[j1 + 1];
    if (sEnd > reach) tEnd = Math.max(0, (reach - run.s[j1]) / (sEnd - run.s[j1]));
    else if (j1 + 2 >= run.n) tEnd = 1;
    const endJ = tEnd > 1 ? Math.min(run.n - 2, j1 + 1) : j1;
    const endT = tEnd > 1 ? tEnd - 1 : tEnd;
    // And the start, as far back into the piece before, where there is one.
    const back = past > 0 && j0 > 0;
    const startJ = back ? j0 - 1 : j0;
    const startT = back ? 1 - past : 0;
    // A point on one bank (side 2 for the left, 4 for the right), `t` of the way from point j to the next.
    const bank = (j: number, side: number, t: number, first: boolean): void => {
      const k0 = j * 6;
      const k1 = Math.min(run.n - 1, j + 1) * 6;
      const mx = o[k0] + (o[k1] - o[k0]) * t;
      const my = o[k0 + 1] + (o[k1 + 1] - o[k0 + 1]) * t;
      const ex = o[k0 + side] + (o[k1 + side] - o[k0 + side]) * t;
      const ey = o[k0 + side + 1] + (o[k1 + side + 1] - o[k0 + side + 1]) * t;
      if (first) ctx.moveTo(mx + (ex - mx) * width, my + (ey - my) * width);
      else ctx.lineTo(mx + (ex - mx) * width, my + (ey - my) * width);
    };
    bank(startJ, 2, startT, true);
    for (let j = startJ + 1; j <= endJ; j++) bank(j, 2, 0, false);
    bank(endJ, 2, endT, false);
    bank(endJ, 4, endT, false);
    for (let j = endJ; j > startJ; j--) bank(j, 4, 0, false);
    bank(startJ, 4, startT, false);
    ctx.closePath();
  }

  /** The streaks and the white water on one piece of a run: streaks as three points apiece, the brighter third of them apart, and flecks of white as two. */
  private streaks(f: WaterFrame, run: Run, j0: number, j1: number, out: number[], dim: number[], white: number[]): void {
    const st = this.streams[run.stream];
    const reach = Math.min(st.head, st.end);
    const s0 = run.s[j0];
    const s1 = Math.min(run.s[j1 + 1], reach);
    const total = run.flow[run.n - 1];
    const count = Math.max(1, Math.ceil(total / STREAK_EVERY));
    const turn = Math.floor(f.t / STREAK_EVERY);
    const base = f.t - turn * STREAK_EVERY;
    // Each streak by how long the water has run to reach it, so a streak keeps its place across the stream as it goes.
    for (let k = 0; k <= count; k++) {
      const flow = base + k * STREAK_EVERY;
      if (flow > total) break;
      const s = this.sAtFlow(run, flow);
      if (s < s0 || s >= s1) continue;
      const id = (((k - turn) % (count + 1)) + count + 1) % (count + 1);
      const across = ((((id * 0.618034) % 1) + 1) % 1 - 0.5) * 1.3;
      const tail = this.sAtFlow(run, Math.max(0, flow - STREAK_LONG * (0.6 + ((id * 0.414) % 0.8))));
      const mid = (s + tail) / 2;
      const list = id % 3 === 0 ? out : dim;
      this.onRun(run, tail, across, list);
      this.onRun(run, mid, across, list);
      this.onRun(run, s, across, list);
    }
    // White water where the run steepens, broken up and hurrying down each step at its own pace.
    for (let q = j0; q <= j1; q++) {
      const w = run.white[q];
      if (w <= 0 || run.s[q] >= reach) continue;
      // About ten flecks a corner where it is white all through, and none where it only just breaks.
      const flecks = Math.floor(w * (12 / PER_CORNER) + ((q * 0.618034) % 1));
      const step = run.s[q + 1] - run.s[q];
      const pace = (RUN_LEVEL + RUN_STEEP * Math.sqrt(WHITE_FROM + w * (WHITE_FULL - WHITE_FROM))) / step;
      for (let i = 0; i < flecks; i++) {
        const h = Math.sin((q + 1) * 91.7 + i * 47.3) * 0.5 + 0.5;
        const u = (((f.t * pace * 0.35 + i / flecks + h) % 1) + 1) % 1;
        const s = run.s[q] + u * step;
        if (s >= reach) continue;
        const across = (h - 0.5) * 1.5;
        // Some a dash of broken water, some a bead of foam riding on it.
        const long = i % 3 === 2 ? 0.002 : 0.02 + 0.05 * ((h * 7.3) % 1);
        this.onRun(run, Math.max(run.s[0], s - long), across, white);
        this.onRun(run, s, across, white);
      }
    }
  }

  /** How far down a run the water has got after `flow` seconds of travel. */
  private sAtFlow(run: Run, flow: number): number {
    let k = 0;
    let hi = run.n - 1;
    while (hi - k > 1) {
      const mid = (k + hi) >> 1;
      if (run.flow[mid] <= flow) k = mid;
      else hi = mid;
    }
    const f0 = run.flow[k];
    const f1 = run.flow[k + 1];
    const t = f1 > f0 ? Math.max(0, Math.min(1, (flow - f0) / (f1 - f0))) : 0;
    return run.s[k] + (run.s[k + 1] - run.s[k]) * t;
  }

  /** Where on screen a point down a run is, `across` of the way from its middle to a bank, onto the end of a list. */
  private onRun(run: Run, s: number, across: number, out: number[]): void {
    let lo = 0;
    let hi = run.n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (run.s[mid] <= s) lo = mid;
      else hi = mid;
    }
    const t = run.s[hi] > run.s[lo] ? Math.max(0, Math.min(1, (s - run.s[lo]) / (run.s[hi] - run.s[lo]))) : 0;
    const o = run.scr;
    const b = across < 0 ? 2 : 4;
    const k = Math.abs(across);
    const x0 = o[lo * 6] + (o[lo * 6 + b] - o[lo * 6]) * k;
    const y0 = o[lo * 6 + 1] + (o[lo * 6 + b + 1] - o[lo * 6 + 1]) * k;
    const x1 = o[hi * 6] + (o[hi * 6 + b] - o[hi * 6]) * k;
    const y1 = o[hi * 6 + 1] + (o[hi * 6 + b + 1] - o[hi * 6 + 1]) * k;
    out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
  }

  /** The white tongue at the head of water running down, or the rings where a stream goes into a pond or the sea. */
  private drawSplash(ctx: CanvasRenderingContext2D, f: WaterFrame, s: Splash): void {
    const z = this.zoom;
    const x = this.sx(s.x, s.y);
    const y = this.sy(s.x, s.y, s.h);
    if (s.head) {
      const wob = 1 + 0.18 * Math.sin(f.t * 9 + s.x * 3.1);
      ctx.fillStyle = STREAK_WHITE;
      ctx.beginPath();
      ctx.ellipse(x, y, s.r * DISC_W * z * wob, s.r * DISC_H * z * wob, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.lineWidth = Math.max(0.8, 1.1 * z);
    for (let i = 0; i < 2; i++) {
      const phase = (f.t / 1.5 + i * 0.5 + s.x * 0.13) % 1;
      const r = s.r * (0.25 + 0.75 * phase);
      ctx.strokeStyle = foam(0.55 * (1 - phase) * (1 - phase));
      ctx.beginPath();
      ctx.ellipse(x, y, r * DISC_W * z, r * DISC_H * z, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = foam(0.35);
    ctx.beginPath();
    ctx.ellipse(x, y, 0.06 * DISC_W * z, 0.06 * DISC_H * z, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
  }

  /* ---- Falls ------------------------------------------------------------- */

  /**
   * A fall: a wide sheet of water, smooth and glassy, going over the lip and
   * down to the foot without narrowing.
   *
   * It is drawn on a curve that leaves the lip going straight out and meets
   * the foot coming straight down, so the water curls over the edge and
   * drops. Under it the body of the water, turquoise at the top and
   * whitening toward the foot, where it has taken in air; down it, streaks
   * of near white and of darker teal side by side, each broken into lengths
   * that run down it; over them, threads of falling water speeding and
   * stretching as they go, and the two thin edges of the sheet; and at the
   * top the bright rounded lip where it turns over. Where it lands, a plume
   * of foam, spray, and rings going out on the water.
   */
  private drawFall(ctx: CanvasRenderingContext2D, f: WaterFrame, fall: Fall): void {
    const z = this.zoom;
    const t = f.t;
    const top = fall.top + FILM;
    const drop = top - fall.land;
    const tall = Math.min(1, drop / FALL_TALL);
    // The lip on screen, a tile's step along the fall, and half the sheet's width.
    const tx = this.sx(fall.ax, fall.ay);
    const ty = this.sy(fall.ax, fall.ay, top);
    const fx = this.xx * fall.dx + this.xy * fall.dy;
    const fy = this.yx * fall.dx + this.yy * fall.dy;
    const half = SHEET_HALF * (fall.spill ? SHEET_SPILL : 1) * (0.85 + 0.3 * tall);
    let wx = (this.xx * -fall.dy + this.xy * fall.dx) * half;
    let wy = (this.yx * -fall.dy + this.yy * fall.dx) * half;
    if (wx < 0 || (wx === 0 && wy < 0)) {
      wx = -wx;
      wy = -wy;
    }
    const across = 2 * Math.hypot(wx, wy);
    const dropPx = drop * this.hs;
    const reach = fall.reach;
    // Enough slices that the curve reads as one, and no more.
    const slices = Math.max(3, Math.min(10, Math.round((Math.hypot(fx, fy) + dropPx) / 16)));
    const n = slices + 1;
    const cx = FALL_CX;
    const cy = FALL_CY;
    const spread = FALL_SPREAD;
    const len = FALL_LEN;
    // Going over an edge away from you, the water is seen to drop from it rather than to leap out: thrown out as far,
    // the sheet would rise up the screen as it went and stand over the edge in a hoop.
    const out = CURL_OUT * (1 - 0.72 * Math.max(0, -fy / (Math.hypot(fx, fy) || 1)));
    for (let i = 0; i < n; i++) {
      const tau = (i / slices) * reach;
      const u = 1 - tau;
      const along = 3 * u * u * tau * out + 3 * u * tau * tau + tau * tau * tau;
      const down = 3 * u * tau * tau * CURL_DOWN + tau * tau * tau;
      cx[i] = tx + fx * along;
      cy[i] = ty + fy * along + dropPx * down;
      spread[i] = 1 + SHEET_SPREAD * tau;
      len[i] = i ? len[i - 1] + Math.hypot(cx[i] - cx[i - 1], cy[i] - cy[i - 1]) : 0;
    }
    const outline = (grow: number): void => {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const k = spread[i] * grow;
        if (i === 0) ctx.moveTo(cx[i] - wx * k, cy[i] - wy * k);
        else ctx.lineTo(cx[i] - wx * k, cy[i] - wy * k);
      }
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(cx[i] + wx * spread[i] * grow, cy[i] + wy * spread[i] * grow);
      ctx.closePath();
    };
    // A line down the sheet `u` of the way from its middle to an edge, from `p0` of its length to `p1`, onto the path:
    // of the length drawn, which while the first water is still going over is only as far as it has got.
    const total = len[n - 1] || 1;
    const thread = (u: number, p0: number, p1: number): void => {
      let first = true;
      const put = (p: number): void => {
        const at = p * total;
        let i = 0;
        while (i < n - 2 && len[i + 1] < at) i++;
        const seg = len[i + 1] - len[i];
        const k = seg > 0 ? Math.max(0, Math.min(1, (at - len[i]) / seg)) : 0;
        const sp = (spread[i] + (spread[i + 1] - spread[i]) * k) * u;
        const x = cx[i] + (cx[i + 1] - cx[i]) * k + wx * sp;
        const y = cy[i] + (cy[i + 1] - cy[i]) * k + wy * sp;
        if (first) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        first = false;
      };
      put(p0);
      for (let i = 1; i < n - 1; i++) {
        const p = len[i] / total;
        if (p > p0 && p < p1) put(p);
      }
      put(p1);
    };
    // The wet rock behind it, darkened, so the sheet stands off the face.
    ctx.save();
    ctx.translate(-fx * 0.07, -fy * 0.07);
    outline(1.14);
    ctx.restore();
    ctx.fillStyle = FALL_WET_ROCK;
    ctx.fill();
    // The body: turquoise at the lip, paler as it falls, and white by the foot.
    const endX = cx[n - 1];
    const endY = cy[n - 1];
    const body = ctx.createLinearGradient(tx, ty, endX, endY);
    body.addColorStop(0, FALL_BODY[0]);
    body.addColorStop(0.5, FALL_BODY[1]);
    body.addColorStop(1, FALL_BODY[2]);
    outline(1);
    ctx.fillStyle = body;
    ctx.fill();
    // Streaks down it, near white and darker teal side by side, each broken into lengths that run down it, cut square.
    for (let k = 0; k < FALL_STREAKS; k++) {
      const h = hash2(k, 3, Math.round(fall.seed * 997));
      const pale = k % 2 === 1;
      const u = -0.8 + (1.6 * k) / (FALL_STREAKS - 1) + (h - 0.5) * 0.06;
      // Long lengths and short breaks, so each reads as one streak coming down in pieces rather than as dashes.
      const long = (30 + 34 * h) * z * (0.6 + 0.4 * tall);
      ctx.setLineDash([long, (3 + 4 * h) * z]);
      ctx.lineDashOffset = -t * SHEET_SPEED * z * (0.8 + 0.5 * h) - h * 90 * z;
      ctx.strokeStyle = pale ? FALL_STREAK_PALE : FALL_STREAK_DARK;
      ctx.lineWidth = across * (pale ? 0.15 : 0.11) * (0.85 + 0.3 * h);
      ctx.beginPath();
      thread(u, THREADS_FROM * 0.5, 1);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.lineCap = 'round';
    // A few threads of falling water over them, each let go below the curl and speeding and stretching as it falls.
    const lanes = Math.max(3, Math.min(10, Math.round(across / 7)));
    const period = 0.75 + 0.9 * tall;
    ctx.strokeStyle = FALL_THREAD;
    ctx.lineWidth = Math.max(0.7, 1.05 * z);
    ctx.beginPath();
    for (let k = 0; k < lanes; k++) {
      for (let j = 0; j < 2; j++) {
        const h = hash2(k, j, Math.round(fall.seed * 997));
        if (h > 0.6) continue;
        const u = -0.9 + (1.8 * (k + 0.5)) / lanes + (h - 0.5) * 0.08;
        const age = (t / (period * (0.85 + 0.3 * h)) + h + j * 0.5) % 1;
        const head = THREADS_FROM + (1 - THREADS_FROM) * age ** 1.6;
        const tail = Math.max(THREADS_FROM, head - (0.05 + 0.26 * age) * (0.5 + 0.5 * tall));
        thread(u, tail, head);
      }
    }
    ctx.stroke();
    // The two edges, thinnest and brightest, breaking up as they fall.
    ctx.setLineDash([5 * z, 3 * z]);
    ctx.lineDashOffset = -t * SHEET_SPEED * z;
    ctx.strokeStyle = FALL_EDGE;
    ctx.lineWidth = Math.max(0.8, 1.1 * z);
    ctx.beginPath();
    thread(-0.97, THREADS_FROM, 1);
    thread(0.97, THREADS_FROM, 1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    // The lip: smooth and bright where the water turns over the edge, the streaks coming out of it as it falls. It
    // starts a little back from the edge, on the water coming to it, so the sheet grows out of the surface rather
    // than off a cut.
    const capTo = Math.min(n - 1, Math.max(1, Math.round(n * 0.3)));
    const bx0 = tx - fx * TONGUE;
    const by0 = ty - fy * TONGUE;
    const gx = cx[capTo] - bx0;
    const gy = cy[capTo] - by0;
    const lip = Math.max(0.02, Math.min(0.8, ((tx - bx0) * gx + (ty - by0) * gy) / (gx * gx + gy * gy || 1)));
    const cap = ctx.createLinearGradient(bx0, by0, cx[capTo], cy[capTo]);
    cap.addColorStop(0, FALL_CAP[0]);
    cap.addColorStop(lip, FALL_CAP[1]);
    cap.addColorStop(lip + (1 - lip) * 0.18, FALL_CAP[2]);
    cap.addColorStop(lip + (1 - lip) * 0.45, FALL_CAP[3]);
    cap.addColorStop(1, FALL_CAP[4]);
    ctx.beginPath();
    ctx.moveTo(bx0 - wx, by0 - wy);
    for (let i = 0; i <= capTo; i++) ctx.lineTo(cx[i] - wx * spread[i], cy[i] - wy * spread[i]);
    for (let i = capTo; i >= 0; i--) ctx.lineTo(cx[i] + wx * spread[i], cy[i] + wy * spread[i]);
    ctx.lineTo(bx0 + wx, by0 + wy);
    ctx.closePath();
    ctx.fillStyle = cap;
    ctx.fill();
    // And the light along it, bowed as the water rounds over.
    const l1 = Math.min(n - 1, 1);
    const lipX = cx[0] + (cx[l1] - cx[0]) * 0.3;
    const lipY = cy[0] + (cy[l1] - cy[0]) * 0.3;
    ctx.strokeStyle = FALL_LIP;
    ctx.lineWidth = Math.max(1, 1.6 * z);
    ctx.beginPath();
    ctx.moveTo(lipX - wx * 0.92, lipY - wy * 0.92);
    ctx.quadraticCurveTo(lipX + fx * 0.06, lipY + fy * 0.06 + 1.6 * z, lipX + wx * 0.92, lipY + wy * 0.92);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1;
    if (reach < 1) {
      // The front of the water, on its way down.
      ctx.fillStyle = FOAM_SOLID;
      ctx.beginPath();
      ctx.ellipse(endX, endY, across * 0.55, across * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    fall.footX = endX;
    fall.footY = endY;
    fall.footWx = wx * spread[n - 1];
    fall.footWy = wy * spread[n - 1];
  }

  /**
   * Where a fall lands: a plume of white foam heaped at the foot of the
   * sheet, biggest in the middle; spray thrown out to either side and
   * falling back; and rings going out on the water under it. On dry ground
   * there are no rings: the water goes on as a stream.
   */
  private plunge(ctx: CanvasRenderingContext2D, f: WaterFrame, fall: Fall): void {
    const z = this.zoom;
    const x = fall.footX;
    const y = fall.footY;
    const wx = fall.footWx;
    const wy = fall.footWy;
    const tall = Math.min(1, (fall.top + FILM - fall.land) / FALL_TALL);
    const t = f.t;
    const sheetHalf = Math.hypot(wx, wy);
    const pool = 0.16 + 0.16 * tall;
    if (fall.wet) {
      ctx.lineWidth = Math.max(0.8, 1.3 * z);
      for (let i = 0; i < 3; i++) {
        const phase = (t / 2 + i / 3 + fall.seed) % 1;
        const r = pool * (1.2 + 2.6 * phase);
        ctx.strokeStyle = foam(0.6 * (1 - phase) * (1 - phase));
        ctx.beginPath();
        ctx.ellipse(x, y, r * DISC_W * z, r * DISC_H * z, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      // A pale patch of broken water spread under it.
      this.foamTex ??= foamTexture();
      const r = pool * 2;
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.foamTex, x - r * DISC_W * z, y - r * DISC_H * z, 2 * r * DISC_W * z, 2 * r * DISC_H * z);
      ctx.globalAlpha = 1;
    }
    // The plume: round lumps of foam heaped at the foot of the sheet and out a little past each edge of it, level on
    // the water however the sheet is turned, the biggest and highest in the middle, each swelling and sinking in its
    // turn; shaded underneath, then white over.
    const lumps = 10 + Math.round(5 * tall);
    const big = sheetHalf * (0.6 + 0.3 * tall);
    const heap = sheetHalf * (0.5 + 0.45 * tall);
    const wide = Math.max(wx, sheetHalf * 0.8);
    const plume = PLUME;
    let m = 0;
    for (let i = 0; i < lumps; i++) {
      const h = hash2(i, 5, Math.round(fall.seed * 997));
      const u = -1.2 + (2.4 * (i + 0.5)) / lumps + (h - 0.5) * 0.25;
      const middle = Math.max(0, 1 - Math.abs(u) / 1.25);
      const pulse = 0.5 + 0.5 * Math.sin(t * (3.1 + 1.7 * h) + i * 2.3);
      const r = big * (0.4 + 0.6 * middle) * (0.82 + 0.3 * pulse);
      // The outer lumps come forward a little, round the foot, so the heap has a front as well as a top.
      const px = x + wide * u + (h - 0.5) * big * 0.4;
      const py = y + wy * u * 0.3 - heap * middle * (0.75 + 0.35 * pulse) + (1 - middle) * big * 0.3;
      plume[m++] = px;
      plume[m++] = py;
      plume[m++] = r;
    }
    for (const [ink, lift] of [[PLUME_SHADE, -0.22], [FOAM_SOLID, 0.08]] as const) {
      ctx.fillStyle = ink;
      ctx.beginPath();
      for (let i = 0; i < m; i += 3) {
        const r = plume[i + 2] * (lift < 0 ? 1 : 0.9);
        const py = plume[i + 1] - plume[i + 2] * lift;
        ctx.moveTo(plume[i] + r, py);
        ctx.arc(plume[i], py, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    // Spray: drops thrown out to both sides from the top of the plume, arcing up and falling back, more and further
    // off a taller fall.
    const drops = 10 + Math.round(16 * tall);
    const lift = (8 + 22 * tall) * z;
    const reachOut = (sheetHalf * 1.2 + (6 + 10 * tall) * z);
    ctx.fillStyle = FOAM_SOLID;
    ctx.beginPath();
    for (let i = 0; i < drops; i++) {
      const h = hash2(i, 17, Math.round(fall.seed * 997));
      const side = i % 2 ? 1 : -1;
      const age = (t / (0.75 + 0.45 * h) + i * 0.618 + fall.seed) % 1;
      const ox = side * reachOut * (0.5 + 0.8 * h) * age;
      const oy = -lift * (0.6 + 0.8 * h) * (age * 2 - age * age * 1.7);
      const px = x + ox + wide * side * 0.3;
      const py = y - heap * 0.5 + oy;
      const r = Math.max(0.6, (1.6 - age) * (0.8 + 0.6 * tall) * z * (0.7 + 0.6 * h));
      ctx.moveTo(px + r, py);
      ctx.arc(px, py, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  /* ---- Springs ----------------------------------------------------------- */

  /** A spring welling up: the water domed a little over it, a ring going out, and bubbles coming up and breaking. */
  private drawWell(ctx: CanvasRenderingContext2D, f: WaterFrame, w: WellDraw): void {
    const z = this.zoom;
    const t = f.t;
    const ground = f.world.getHeight(w.x, w.y);
    const h = Math.max(ground + FILM, this.levels[w.pond]);
    const x = this.sx(w.x, w.y);
    const y = this.sy(w.x, w.y, h);
    ctx.fillStyle = rgba(SPRING_PALE, 0.34 + 0.1 * Math.sin(t * 2.7));
    ctx.beginPath();
    ctx.ellipse(x, y, 0.19 * DISC_W * z, 0.19 * DISC_H * z, 0, 0, Math.PI * 2);
    ctx.fill();
    const phase = (t / 1.7) % 1;
    const r = 0.1 + 0.34 * phase;
    ctx.strokeStyle = foam(0.5 * (1 - phase) * (1 - phase));
    ctx.lineWidth = Math.max(0.7, z);
    ctx.beginPath();
    ctx.ellipse(x, y, r * DISC_W * z, r * DISC_H * z, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = STREAK_WHITE;
    ctx.lineWidth = Math.max(0.6, 0.8 * z);
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const age = (t / (1.1 + (i % 3) * 0.23) + i / 7) % 1;
      const a = i * 2.39996 + Math.floor(t / 1.1 + i / 7) * 1.3;
      const d = 0.03 + 0.17 * age;
      const bx = x + Math.cos(a) * d * DISC_W * z;
      const by = y + Math.sin(a) * d * DISC_H * z;
      // Each grows as it comes up and is gone when it breaks.
      const br = (0.7 + 1.6 * age) * z * (age < 0.85 ? 1 : 0);
      if (br <= 0) continue;
      ctx.moveTo(bx + br, by);
      ctx.arc(bx, by, br, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  /* ---- In the air -------------------------------------------------------- */

  /**
   * The mist off every fall on screen, climbing and carried off down the
   * wind, and a bow standing in it when the sun is low behind you. Drawn with
   * the smoke, after everything on the ground, because it hangs over it.
   */
  air(ctx: CanvasRenderingContext2D): void {
    const f = this.f;
    if (!f) return;
    let any = false;
    for (const fall of this.falls) if (!Number.isNaN(fall.row) && fall.reach >= 1) any = true;
    if (!any) return;
    this.mistTex ??= mistTexture();
    const z = this.zoom;
    const t = f.t;
    for (const fall of this.falls) {
      if (Number.isNaN(fall.row) || fall.reach < 1) continue;
      const drop = fall.top + FILM - fall.land;
      const tall = Math.min(1, drop / FALL_TALL);
      if (tall < 0.2) continue;
      const x = this.sx(fall.bx, fall.by);
      const y = this.sy(fall.bx, fall.by, fall.land);
      const puffs = 3 + Math.round(4 * tall);
      // As big as the fall is tall, up to a point: closer in, the mist is more of the same rather than more screen.
      const size = Math.min(84, (12 + 32 * tall) * z);
      for (let i = 0; i < puffs; i++) {
        const age = (t / MIST_LIFE + i / puffs + fall.seed) % 1;
        const blown = f.lean.force * age * age * 40 * z;
        const px = x + f.lean.x * blown + Math.sin(age * 5 + i * 2.1) * 5 * z;
        const py = y - age * (18 + 56 * tall) * z + f.lean.y * blown * 0.4;
        const r = size * (0.4 + 0.9 * age);
        ctx.globalAlpha = 0.4 * tall * Math.sin(Math.PI * age) * (1 - 0.4 * f.dark);
        ctx.drawImage(this.mistTex, px - r, py - r * 0.8, r * 2, r * 1.6);
      }
      if (this.bow > 0.02) {
        // Standing in the thick of the mist, a little above the foot of the fall.
        this.bowTex ??= bowTexture();
        const r = size * 1.6;
        ctx.globalAlpha = Math.min(0.5, this.bow * tall * 0.55);
        ctx.drawImage(this.bowTex, x - r, y - r * 1.25, r * 2, r * 1.1);
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** A colour from one to another, `t` of the way. */
const mix = (a: readonly number[], b: readonly number[], t: number): number[] => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c: readonly number[]): string => `rgb(${c[0]},${c[1]},${c[2]})`;
const rgba = (c: readonly number[], a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
/** Foam white at a strength, for the rings that fade as they spread. */
const foam = (a: number): string => rgba(SPRING_FOAM, a);

/**
 * A stream's water from bank to bank, each band as wide across the water as
 * its first number and carried as far past each end of a piece as its last
 * (see `streamPieces`): the darker teal at its edges, the water, and the sky
 * down its middle, worked out rather than laid on thin. And the damp ground
 * along its banks.
 */
const STREAM_BANDS: ReadonlyArray<readonly [number, string, number]> = [
  [1, rgb(SPRING_EDGE), SEAM],
  [0.8, rgb(mix(SPRING_WATER, SPRING_EDGE, 0.08)), SEAM * 1.4],
  [0.52, rgb(mix(SPRING_WATER, SPRING_PALE, 0.3)), SEAM * 1.8],
  [0.24, rgb(mix(SPRING_WATER, SPRING_PALE, 0.55)), SEAM * 2.2],
];
const STREAM_DAMP = 'rgba(30,70,62,0.16)';
/** The streaks down a stream, the fainter and the brighter, and its white water. */
const STREAK_DIM = rgba(SPRING_FOAM, 0.42);
const STREAK_BRIGHT = rgba(SPRING_FOAM, 0.8);
const STREAK_WHITE = rgba(SPRING_FOAM, 0.88);
/** The ripples on a pond, the brighter and the fainter. */
const RIPPLE_BRIGHT = rgba(SPRING_FOAM, 0.9);
const RIPPLE_FAINT = rgba(SPRING_FOAM, 0.5);

/** How many streaks come down a fall side by side, near white and darker teal by turns. */
const FALL_STREAKS = 6;
/** A fall's colours: the wet rock behind it; its body at the lip, halfway and at the foot; its streaks, threads and edges; the light on its lip. */
const FALL_WET_ROCK = 'rgba(18,58,62,0.14)';
const FALL_BODY = [rgba(SPRING_WATER, 0.92), rgba(mix(SPRING_WATER, SPRING_PALE, 0.42), 0.9), rgba(mix(SPRING_PALE, SPRING_FOAM, 0.6), 0.95)];
const FALL_STREAK_PALE = rgba(SPRING_PALE, 0.72);
const FALL_STREAK_DARK = rgba(SPRING_DARK, 0.34);
const FALL_THREAD = rgba(SPRING_FOAM, 0.5);
const FALL_EDGE = rgba(SPRING_FOAM, 0.66);
const FALL_LIP = rgba(SPRING_FOAM, 0.95);
/** Its lip, from the water coming to it (clear) to where it turns over (bright) and on down into the sheet. */
const FALL_CAP = [
  rgba(SPRING_WATER, 0), rgba(mix(SPRING_WATER, SPRING_PALE, 0.55), 0.95), rgba(mix(SPRING_PALE, SPRING_FOAM, 0.5), 0.95),
  rgba(mix(SPRING_WATER, SPRING_PALE, 0.25), 0.55), rgba(SPRING_WATER, 0),
];
/** Foam, and the shade under each lump of it. */
const FOAM_SOLID = rgb(SPRING_FOAM);
const PLUME_SHADE = rgb(mix(SPRING_PALE, SPRING_EDGE, 0.22));
/** Scratch for a plume's lumps, as x, y and radius. */
const PLUME = new Float64Array(3 * 16);
/** Scratch for a cascade's foot on screen, and for a line's lily pads: where, how wide and deep, which way the notch faces, and whether in flower. */
const CASCADE_AT: number[] = [];
const PAD_AT = new Float64Array(6 * 256);
/** A lily pad's colours: its shadow on the water, its green, its rim and veins, its paler middle; a flower's petals and heart. */
const PAD_SHADOW = 'rgba(28,110,112,0.28)';
const PAD_GREEN = 'rgb(126,186,102)';
const PAD_RIM = 'rgb(78,140,72)';
const PAD_VEIN = 'rgba(78,140,72,0.55)';
const PAD_LIGHT = 'rgba(170,216,128,0.55)';
const PAD_PETAL = 'rgb(244,166,180)';
const PAD_PETAL_LIGHT = 'rgb(252,212,218)';
const PAD_HEART = 'rgb(248,212,96)';
/** Half the angle of the notch cut out of a lily pad. */
const PAD_NOTCH = 0.32;

/** Scratch for one fall's curve: the middle of each slice's edge on screen, how far it has spread, and how far down the curve it is. */
const FALL_CX = new Float64Array(12);
const FALL_CY = new Float64Array(12);
const FALL_SPREAD = new Float64Array(12);
const FALL_LEN = new Float64Array(12);
/** Scratch for one line's streaks and flecks, filled and emptied rather than made each time. */
const STREAKS: number[] = [];
const STREAKS_DIM: number[] = [];
const WHITES: number[] = [];

/** A soft round of mist, white in the middle and gone at the edge, drawn once and scaled. */
function mistTexture(): HTMLCanvasElement {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  if (!g) return cv;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(244,250,255,1)');
  grad.addColorStop(0.45, 'rgba(244,250,255,0.55)');
  grad.addColorStop(1, 'rgba(244,250,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return cv;
}

/** A lump of foam: white and nearly solid through the middle, soft at the edge. */
function foamTexture(): HTMLCanvasElement {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  if (!g) return cv;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(250,253,255,1)');
  grad.addColorStop(0.55, 'rgba(246,251,255,0.92)');
  grad.addColorStop(0.8, 'rgba(240,248,253,0.45)');
  grad.addColorStop(1, 'rgba(240,248,253,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return cv;
}

/**
 * A bow, as it stands in spray: an arch of the colours, red outermost, soft at
 * every edge and fading out toward its feet, where the mist is thinnest.
 */
function bowTexture(): HTMLCanvasElement {
  const W = 160;
  const H = 88;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  if (!g) return cv;
  const colours = ['255,70,60', '255,160,50', '255,236,80', '90,210,90', '70,150,255', '90,90,220', '150,80,200'];
  const cx = W / 2;
  const cy = H - 4;
  g.lineWidth = 3.2;
  colours.forEach((c, i) => {
    g.strokeStyle = `rgba(${c},0.8)`;
    g.beginPath();
    g.arc(cx, cy, 74 - i * 2.6, Math.PI, Math.PI * 2);
    g.stroke();
  });
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, 'rgba(0,0,0,0.9)');
  fade.addColorStop(0.55, 'rgba(0,0,0,0.6)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, W, H);
  return cv;
}

/**
 * The corners of level ground between a pond's water and its lip, as x, y
 * pairs from the pond outward, not counting the lip; none when the lip is at
 * the water's edge, which is most of the time. A hollow filled to the height
 * of a shelf running out to its lip stands level with the shelf: the water
 * crosses it at no depth at all, and it is drawn as the start of the stream.
 */
function leadIn(p: PondWater, lx: number, ly: number, world: World): number[] {
  const cw = world.w + 1;
  const wetBeside = (x: number, y: number): boolean =>
    p.wet.has(y * cw + x - 1) || p.wet.has(y * cw + x + 1) || p.wet.has((y - 1) * cw + x) || p.wet.has((y + 1) * cw + x);
  if (wetBeside(lx, ly)) return [];
  const from = new Map<number, number>([[ly * cw + lx, -1]]);
  const queue = [ly * cw + lx];
  for (let q = 0; q < queue.length && q < 96; q++) {
    const k = queue[q];
    const x = k % cw;
    const y = (k - x) / cw;
    for (const [nx, ny] of [[x, y - 1], [x - 1, y], [x + 1, y], [x, y + 1]]) {
      const nk = ny * cw + nx;
      if (from.has(nk) || !world.cornerInBounds(nx, ny) || world.getHeight(nx, ny) !== p.level || p.wet.has(nk)) continue;
      from.set(nk, k);
      if (wetBeside(nx, ny)) {
        const out: number[] = [];
        for (let at = nk; at !== ly * cw + lx; at = from.get(at) ?? ly * cw + lx) out.push(at % cw, Math.floor(at / cw));
        return out;
      }
      queue.push(nk);
    }
  }
  return [];
}
