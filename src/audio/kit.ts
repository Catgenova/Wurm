/**
 * A noise kit, built rather than recorded.
 *
 * There was no sound on this island at all. Not a quiet mix, not a stub — no
 * `AudioContext` anywhere in the source, so a pickaxe going into marble and a
 * needle going into linen were both silence.
 *
 * Nothing here is a file. Every sound in the game is made out of noise and a
 * handful of oscillators at the moment it is wanted, which is not a clever
 * way of doing it so much as the only way that suits what this is: an island
 * with four hundred and thirty-one jobs on it, served off a static page with
 * no asset pipeline and no budget for one. A recorded kit good enough to tell
 * a chisel from a hammer would be a hundred files and a loader; two
 * primitives and a table of numbers is smaller than the loader alone.
 *
 * The two primitives are the whole of it:
 *
 *   `burst`  noise, filtered to a band, with an envelope on it. This is
 *            every dull sound there is — a boot in wet grass, a spade in
 *            clay, a file down a blade, water.
 *   `ring`   an oscillator, or a stack of them, with an envelope on it. This
 *            is everything that has a pitch — an anvil, a bell, a plank.
 *
 * Between them: where the band sits says what the thing is made of, how
 * narrow it is says how hard and hollow, and how long it takes to die away
 * says how big. Those three numbers are what the tables below are.
 */

/**
 * One second of noise, made once per context and played from over and over.
 *
 * It is a fixed sequence rather than `Math.random`, so the island sounds the
 * same on Tuesday as it did on Monday and a fault in here is one you can hear
 * twice.
 */
const NOISE = new WeakMap<BaseAudioContext, AudioBuffer>();

export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const had = NOISE.get(ctx);
  if (had) return had;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 0x2f6e2b1;
  for (let i = 0; i < d.length; i += 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    d[i] = s / 0x80000000 - 1;
  }
  NOISE.set(ctx, buf);
  return buf;
}

/** The smallest gain the exponential ramps will take; zero is not allowed one. */
const FLOOR = 0.00012;

export interface Burst {
  /** How long it lasts, in seconds. */
  dur: number;
  /** The middle of the band the noise is cut down to. */
  freq: number;
  /** Where that band has moved to by the end, for anything that falls away. */
  to?: number;
  /** How narrow the band is: under 1 is a wash, over 8 is nearly a pitch. */
  q?: number;
  type?: BiquadFilterType;
  gain: number;
  /** How fast it arrives. A click is 0.001; a brush stroke is 0.04. */
  attack?: number;
}

/** Noise through a filter through an envelope: everything dull. */
export function burst(ctx: BaseAudioContext, dest: AudioNode, at: number, b: Burst): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  // Start somewhere different in the second each time, so a run of footfalls
  // is a run of footfalls rather than the same click eight times.
  src.loopStart = 0;
  const filter = ctx.createBiquadFilter();
  filter.type = b.type ?? 'bandpass';
  filter.frequency.setValueAtTime(Math.max(30, b.freq), at);
  if (b.to !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(30, b.to), at + b.dur);
  filter.Q.value = b.q ?? 1;
  const gain = ctx.createGain();
  const rise = Math.min(b.attack ?? 0.0015, b.dur * 0.5);
  gain.gain.setValueAtTime(FLOOR, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(FLOOR * 2, b.gain), at + rise);
  gain.gain.exponentialRampToValueAtTime(FLOOR, at + b.dur);
  src.connect(filter).connect(gain).connect(dest);
  src.start(at, Math.random() * 0.9);
  src.stop(at + b.dur + 0.02);
}

export interface Ring {
  freq: number;
  dur: number;
  gain: number;
  type?: OscillatorType;
  /** Where the pitch ends up: a thing that sags as it dies, or a chime that does not. */
  to?: number;
  attack?: number;
  /**
   * The partials over the root, as multiples of it, each with its own share
   * of the gain. A bar of metal is inharmonic — 2.76 and 5.40 are roughly
   * where a struck bar sits, which is why it reads as metal rather than as a
   * note.
   */
  partials?: ReadonlyArray<readonly [number, number]>;
}

/** An oscillator, or a stack of them, through an envelope: everything pitched. */
export function ring(ctx: BaseAudioContext, dest: AudioNode, at: number, r: Ring): void {
  const parts = r.partials ?? [[1, 1]];
  for (const [mul, share] of parts) {
    const osc = ctx.createOscillator();
    osc.type = r.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(20, r.freq * mul), at);
    if (r.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, r.to * mul), at + r.dur);
    const gain = ctx.createGain();
    const rise = Math.min(r.attack ?? 0.001, r.dur * 0.5);
    // A high partial dies before a low one, which is most of what makes a
    // struck thing sound struck rather than played.
    const life = r.dur / (1 + (mul - 1) * 0.55);
    gain.gain.setValueAtTime(FLOOR, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(FLOOR * 2, r.gain * share), at + rise);
    gain.gain.exponentialRampToValueAtTime(FLOOR, at + life);
    osc.connect(gain).connect(dest);
    osc.start(at);
    osc.stop(at + life + 0.02);
  }
}

/** A struck bar of metal, which is three partials that do not belong to a scale. */
const METAL_PARTIALS = [[1, 0.5], [2.76, 0.32], [5.4, 0.18]] as const;

/**
 * What is under a boot.
 *
 * The four that matter are what you are mostly walking on; `snow` and `water`
 * are the two the island has that nothing else does, and both are worth the
 * line they cost because the north of the map is made of one and half the
 * travel is through the other.
 */
export type Footing = 'soft' | 'grit' | 'stone' | 'wood' | 'snow' | 'water';

/**
 * A footfall, by what it lands on.
 *
 * Grass is a low brushed wash with no edge on it at all; grit has a sharper
 * band and a scatter above it; stone is a hard narrow click with a little
 * pitch; wood is a board, so it is a click with a real note under it; snow is
 * the strange one, a high squeak with almost no bottom; and water is a band
 * that falls as it goes, which is the sound of something closing over.
 */
const FOOT: Record<Footing, (v: number) => Burst> = {
  soft: (v) => ({ dur: 0.085, freq: 260 + v * 90, q: 0.7, gain: 0.30, attack: 0.006 }),
  grit: (v) => ({ dur: 0.075, freq: 900 + v * 500, q: 0.6, gain: 0.26, attack: 0.003 }),
  stone: (v) => ({ dur: 0.055, freq: 1700 + v * 700, q: 2.4, gain: 0.30 }),
  wood: (v) => ({ dur: 0.07, freq: 700 + v * 260, q: 1.8, gain: 0.26 }),
  snow: (v) => ({ dur: 0.1, freq: 2600 + v * 900, q: 3.2, gain: 0.2, attack: 0.012 }),
  water: (v) => ({ dur: 0.2, freq: 1500 + v * 700, to: 320, q: 0.8, gain: 0.34, attack: 0.004 }),
};

export function footfall(ctx: BaseAudioContext, dest: AudioNode, at: number, footing: Footing, v: number): void {
  burst(ctx, dest, at, FOOT[footing](v));
  // A board answers underfoot and stone does not, which is the whole
  // difference between walking through a house and walking past one.
  if (footing === 'wood') ring(ctx, dest, at, { freq: 168 + v * 30, dur: 0.1, gain: 0.05, type: 'triangle' });
  if (footing === 'stone') ring(ctx, dest, at, { freq: 420 + v * 90, dur: 0.045, gain: 0.03, type: 'triangle' });
}

/**
 * What a turn of work sounds like, which is a question about the stuff rather
 * than about the job.
 *
 * A hundred and some actions come through here and there are seven answers,
 * because there are seven kinds of thing to hit. Mining marble and cutting a
 * slab out of it are the same noise made by different people.
 */
export const STROKES = ['earth', 'stone', 'wood', 'metal', 'cloth', 'water', 'fire'] as const;
export type Stroke = (typeof STROKES)[number];

export function stroke(ctx: BaseAudioContext, dest: AudioNode, at: number, kind: Stroke, v: number): void {
  switch (kind) {
    case 'earth':
      // A spade going in, and the load coming off it a moment later.
      burst(ctx, dest, at, { dur: 0.16, freq: 420 + v * 140, to: 180, q: 0.5, gain: 0.34, attack: 0.004 });
      burst(ctx, dest, at + 0.17, { dur: 0.19, freq: 700 + v * 200, to: 260, q: 0.4, gain: 0.16, attack: 0.02 });
      break;
    case 'stone':
      // A point into rock: a crack with nothing behind it, and chips after.
      burst(ctx, dest, at, { dur: 0.05, freq: 2400 + v * 900, q: 1.4, gain: 0.42 });
      ring(ctx, dest, at, { freq: 1500 + v * 400, to: 900, dur: 0.06, gain: 0.1, type: 'square' });
      burst(ctx, dest, at + 0.06, { dur: 0.22, freq: 3200, to: 1400, q: 0.8, gain: 0.1, attack: 0.01 });
      break;
    case 'wood':
      // A bite into a trunk. The note under it is the tree, and it is low.
      burst(ctx, dest, at, { dur: 0.09, freq: 1100 + v * 320, to: 430, q: 1.1, gain: 0.38, attack: 0.002 });
      ring(ctx, dest, at, { freq: 128 + v * 34, to: 96, dur: 0.2, gain: 0.16, type: 'triangle', partials: [[1, 0.6], [2.1, 0.3], [3.4, 0.1]] });
      break;
    case 'metal':
      // An anvil. All of the character is in the partials and none of it in
      // the noise, which is the opposite of everything else here.
      burst(ctx, dest, at, { dur: 0.02, freq: 4200, q: 0.8, gain: 0.26 });
      ring(ctx, dest, at, { freq: 520 + v * 120, dur: 0.75, gain: 0.3, type: 'sine', partials: METAL_PARTIALS });
      break;
    case 'cloth':
      // A needle, a shuttle, a pass of a file down leather: a long soft
      // stroke rather than a blow, so it arrives slowly and leaves slowly.
      burst(ctx, dest, at, { dur: 0.3, freq: 2600 + v * 900, to: 1500, q: 0.5, gain: 0.14, attack: 0.06 });
      break;
    case 'water':
      burst(ctx, dest, at, { dur: 0.34, freq: 1800 + v * 600, to: 280, q: 0.6, gain: 0.32, attack: 0.006 });
      break;
    case 'fire':
      // Bellows and a hearth: a wash with a slow breath in it.
      burst(ctx, dest, at, { dur: 0.42, freq: 620 + v * 240, to: 1400, q: 0.35, gain: 0.16, attack: 0.12 });
      break;
  }
}

/** A blow that landed on something, and one that landed on you. */
export function blow(ctx: BaseAudioContext, dest: AudioNode, at: number, taken: boolean, v: number): void {
  if (taken) {
    burst(ctx, dest, at, { dur: 0.22, freq: 300 + v * 90, to: 120, q: 0.6, gain: 0.44, attack: 0.002 });
    ring(ctx, dest, at, { freq: 96, to: 62, dur: 0.26, gain: 0.2, type: 'triangle' });
  } else {
    burst(ctx, dest, at, { dur: 0.13, freq: 700 + v * 300, to: 260, q: 0.9, gain: 0.34, attack: 0.002 });
    ring(ctx, dest, at, { freq: 150 + v * 40, to: 100, dur: 0.14, gain: 0.1, type: 'triangle' });
  }
}

/**
 * The three notes the game says things with, which are the only sounds in
 * here that are not something happening in the world.
 *
 * They are deliberately small and deliberately not a fanfare: a skill goes up
 * several times a minute for an entire evening, and anything with any
 * ceremony in it would be unbearable inside ten minutes.
 */
export function chime(ctx: BaseAudioContext, dest: AudioNode, at: number, kind: 'skill' | 'goal' | 'no'): void {
  if (kind === 'no') {
    // A refusal. Two low notes, the second lower, which is the shape every
    // language uses for no.
    ring(ctx, dest, at, { freq: 300, dur: 0.1, gain: 0.12, type: 'triangle' });
    ring(ctx, dest, at + 0.08, { freq: 228, dur: 0.16, gain: 0.12, type: 'triangle' });
    return;
  }
  if (kind === 'skill') {
    ring(ctx, dest, at, { freq: 784, dur: 0.22, gain: 0.07, type: 'sine', partials: [[1, 0.7], [2, 0.3]] });
    return;
  }
  // A goal ticked off: a rise of a fifth, which is as much ceremony as
  // anything in this game gets.
  ring(ctx, dest, at, { freq: 587, dur: 0.24, gain: 0.1, type: 'sine', partials: [[1, 0.7], [2, 0.3]] });
  ring(ctx, dest, at + 0.11, { freq: 880, dur: 0.4, gain: 0.1, type: 'sine', partials: [[1, 0.7], [2, 0.3]] });
}
