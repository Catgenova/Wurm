/**
 * Where a frame's drawing goes, layer by layer, for the line under the frame
 * rate (`Settings.timings`).
 *
 * Asked for after "my fps is pretty consistently ~15": the cure for a slow
 * frame is different on every machine, and a number per layer on the machine
 * that is slow says which one to go after, where a guess from somewhere else
 * does not.
 *
 * Each layer is a handful of the renderer's own methods, timed by wrapping
 * them on the instance, so with the line switched off nothing is wrapped and
 * nothing is timed. The time is the layer's own: a wall drawn inside a
 * building's pass counts to the buildings once, not to the buildings and again
 * to whatever called them. What no layer claims is the ground and everything
 * else, worked out as the whole frame less the layers.
 *
 * This is the time spent giving the drawing orders. On a machine whose
 * graphics chip does the drawing, the chip's own share comes after and is not
 * in it: a frame that takes much longer than its drawing is waiting on the
 * chip.
 */

/** The layers, the methods each is made of, and what the line calls them. */
export const LAYERS = {
  water: ['drawWater', 'drawPonds', 'drawWakes'],
  swell: ['drawSwell'],
  trees: ['drawTree'],
  figures: ['paint'],
  buildings: ['drawStructures', 'drawPitchedRoof', 'drawPiers', 'drawFoundation'],
  haze: ['drawHaze', 'drawAir', 'drawFloaters'],
  light: ['drawOverlays'],
} as const satisfies Record<string, readonly string[]>;

export type Layer = keyof typeof LAYERS;

/** How long the figures are averaged over before the line is written again, in seconds. */
export const TIMING_WINDOW = 0.5;
/** How long each layer is left out for when measuring (`measure`), in seconds; the first quarter is let settle and not counted. */
export const TRIAL_SECONDS = 1;
const TRIAL_SETTLE = TRIAL_SECONDS / 4;

const NAMES = Object.keys(LAYERS) as Layer[];

/*
 * The times above are the time spent giving the orders, which on a machine
 * with a graphics chip is not where the time goes; asking the chip how long it
 * took means reading the picture back, and a browser that sees a canvas read
 * back often enough stops drawing it on the chip at all. So `measure` asks the
 * only question that cannot mislead: how fast the frames come with each layer
 * left out, a second at a time, on the screen in front of you.
 */
interface Trial {
  /** The layers left out in turn, nothing first and last so a drift in between shows. */
  order: Array<Layer | null>;
  i: number;
  /** When this layer was left out, and when the frame before this one began, in milliseconds. */
  from: number;
  last: number;
  gaps: number[];
  fps: Array<[Layer | null, number]>;
}

export class Timings {
  /** Milliseconds per layer so far this window, and the frames they were spread over. */
  private sums = new Map<Layer | 'frame', number>();
  private frames = 0;
  private since = 0;
  /** Each wrapped call's start and the time its own wrapped calls took, innermost last. */
  private starts: number[] = [];
  private inner: number[] = [];
  private frameAt = 0;
  /** The last window's averages, written out. */
  line = '';
  /** The frame rate with each layer left out, written out, once `measure` has run. */
  measured = '';
  private on = false;
  private target: object | null = null;
  private trial: Trial | null = null;

  /** Time the layers or not, on `target`. */
  set(target: object, on: boolean): void {
    this.target = target;
    if (on === this.on) return;
    this.on = on;
    this.apply();
    this.sums.clear();
    this.frames = 0;
    this.line = '';
  }

  /** Leave each layer out in turn, `TRIAL_SECONDS` apiece, and write down the frame rate without it. */
  measure(): void {
    this.trial = { order: [null, ...NAMES, null], i: 0, from: 0, last: 0, gaps: [], fps: [] };
    this.measured = '';
  }

  /** What is being measured now, for the line, or null. */
  get measuring(): string | null {
    const t = this.trial;
    if (!t) return null;
    const out = t.order[t.i];
    return `measuring ${t.i + 1} of ${t.order.length}: ${out ? `leaving out ${out}` : 'everything drawn'}`;
  }

  /** Each method as it is: timed, left out for a trial, or the plain one. */
  private apply(): void {
    const target = this.target;
    if (!target) return;
    const own = target as Record<string, unknown>;
    const out = this.trial ? this.trial.order[this.trial.i] : null;
    for (const layer of NAMES) {
      for (const name of LAYERS[layer]) {
        if (layer === out) own[name] = (): void => {};
        else if (!this.on) delete own[name];
        else {
          const fn = (Object.getPrototypeOf(target) as Record<string, unknown>)[name];
          if (typeof fn === 'function') own[name] = this.wrap(layer, fn as (...a: unknown[]) => unknown);
        }
      }
    }
  }

  private wrap(layer: Layer, fn: (...a: unknown[]) => unknown): (...a: unknown[]) => unknown {
    const t = this;
    return function (this: unknown, ...a: unknown[]): unknown {
      t.starts.push(performance.now());
      t.inner.push(0);
      try {
        return fn.apply(this, a);
      } finally {
        const took = performance.now() - (t.starts.pop() as number);
        const mine = took - (t.inner.pop() as number);
        t.sums.set(layer, (t.sums.get(layer) ?? 0) + mine);
        if (t.inner.length) t.inner[t.inner.length - 1] += took;
      }
    };
  }

  begin(): void {
    const now = performance.now();
    if (this.trial) this.step(now);
    if (this.on) this.frameAt = now;
  }

  /** A frame is starting at `now`: the gap since the last one counts to the layer left out, and the next layer goes out when its second is up. */
  private step(now: number): void {
    const t = this.trial as Trial;
    if (!t.from) {
      t.from = now;
      this.apply();
    } else if (now - t.from >= TRIAL_SETTLE * 1000) t.gaps.push(now - t.last);
    t.last = now;
    if (now - t.from < TRIAL_SECONDS * 1000) return;
    // The middle gap rather than the mean, so a frame held up by something else entirely does not count against a layer.
    const gaps = t.gaps.sort((a, b) => a - b);
    t.fps.push([t.order[t.i], gaps.length ? 1000 / gaps[gaps.length >> 1] : 0]);
    t.i++;
    t.from = now;
    t.gaps = [];
    if (t.i < t.order.length) {
      this.apply();
      return;
    }
    this.trial = null;
    this.apply();
    const all = t.fps.filter(([l]) => l === null).map(([, f]) => f);
    const base = all.reduce((a, b) => a + b, 0) / Math.max(1, all.length);
    const without = t.fps.filter(([l]) => l !== null).map(([l, f]) => `${l} ${Math.round(f)}`);
    this.measured = `fps leaving out: nothing ${Math.round(base)} · ${without.join(' · ')}`;
  }

  /** The frame is drawn; `now` in seconds. */
  end(now: number): void {
    if (!this.on) return;
    this.sums.set('frame', (this.sums.get('frame') ?? 0) + performance.now() - this.frameAt);
    this.frames++;
    if (now - this.since < TIMING_WINDOW && now >= this.since) return;
    this.since = now;
    const per = (k: Layer | 'frame'): number => (this.sums.get(k) ?? 0) / Math.max(1, this.frames);
    const frame = per('frame');
    let claimed = 0;
    const bits: string[] = [];
    for (const layer of NAMES) {
      const ms = per(layer);
      claimed += ms;
      bits.push(`${layer} ${ms.toFixed(1)}`);
    }
    this.line = `drawing ${frame.toFixed(1)} ms: ground ${Math.max(0, frame - claimed).toFixed(1)} · ${bits.join(' · ')}`;
    this.sums.clear();
    this.frames = 0;
  }
}
