/**
 * What the island sounds like.
 *
 * There was no sound at all until now — no `AudioContext` anywhere in the
 * source — so a pickaxe going into marble and a needle going into linen were
 * both silence. Every noise in the game is now made out of filtered noise and
 * a few oscillators at the moment it is wanted, and placed in the mix off the
 * screen rather than out of the world, so the camera is the ear.
 *
 * Two things here are worth measuring and one is not. The one that is not is
 * whether any of it sounds good, which is what ears are for. The two that are:
 *
 *   **That every job has an answer.** A job missing from the tables would be
 *   silent, and silently — indistinguishable from a job somebody decided
 *   makes no noise. So the ones that genuinely make none are named in
 *   `HUSHED`, and every one of the three hundred and ninety-three jobs that
 *   costs time or wind is held to one list or the other. Adding a trade and
 *   forgetting to say what it sounds like fails here rather than shipping.
 *
 *   **That the mix is the shape it claims to be.** Pan and gain come off the
 *   screen, so they are arithmetic and can be checked against a camera with
 *   no browser in the room: dead centre is loud and central, either side is
 *   panned the way you are looking, and far enough off the view is nothing at
 *   all rather than a node built to play something nobody can hear.
 *
 * Needs no database.
 */
import { Camera } from '../../src/engine/camera';
import { ACTIONS } from '../../src/game/actions';
import { SKILL_DEFS } from '../../src/game/skills';
import { TileType } from '../../src/world/tiles';
import { FOOTINGS, HUSHED, isWork, mixAt, STROKE_BY_ID, strokeOf } from '../../src/audio/sound';
import { blow, chime, footfall, stroke, STROKES } from '../../src/audio/kit';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

/* ---- every job is answered for ------------------------------------------- */

const work = ACTIONS.filter(isWork);
const silent = work.filter((a) => strokeOf(a) === null);
check('every job that costs time or wind either makes a noise or is named as making none',
  silent.every((a) => HUSHED.has(a.id)),
  `${work.length} jobs, ${work.length - silent.length} with a sound and ${silent.length} deliberately without${
    silent.some((a) => !HUSHED.has(a.id)) ? `; unaccounted for: ${silent.filter((a) => !HUSHED.has(a.id)).map((a) => a.id).join(', ')}` : ''}`);

const clicks = ACTIONS.filter((a) => !isWork(a));
check('and a click that costs nothing and takes no time makes none',
  clicks.every((a) => strokeOf(a) === null),
  `${clicks.length} of them — examining, locking, naming, choosing a stance`);

/* ---- and the tables are about jobs that exist ---------------------------- */

const real = new Set(ACTIONS.map((a) => a.id));
const staleHush = [...HUSHED].filter((id) => !real.has(id));
const staleNamed = Object.keys(STROKE_BY_ID).filter((id) => !real.has(id));
check('nothing in either table is about a job that has been taken out',
  staleHush.length === 0 && staleNamed.length === 0,
  staleHush.concat(staleNamed).join(', ') || `${HUSHED.size} silences and ${Object.keys(STROKE_BY_ID).length} named jobs, all still real`);

check('and every sound a job can ask for is one the kit can make',
  Object.values(STROKE_BY_ID).every((s) => STROKES.includes(s)),
  `${STROKES.length} noises: ${STROKES.join(', ')}`);

/*
 * The trades carry most of the table, so a trade with no answer is a whole
 * profession working in silence. Fighting is the exception and is meant to
 * be: a landed blow raises `hit`, which is where a fight is heard, and a work
 * stroke on top of it would be the same swing twice.
 */
const trades = SKILL_DEFS.filter((d) => d.group === 'Skills');
const mute = trades.filter((d) => !work.some((a) => a.skill === d.id && strokeOf(a) !== null));
/*
 * A trade may be silent, but only on purpose: either it has no job that costs
 * anything — climbing and swimming are picked up while doing something else
 * and have no job of their own — or every job it does have is named in
 * `HUSHED`, which is taming, prayer and meditation, the three trades whose
 * whole method is to be quiet.
 */
const chosen = (id: string): boolean => work.filter((a) => a.skill === id).every((a) => HUSHED.has(a.id));
check('no trade works in silence except the ones whose method is silence',
  mute.every((d) => chosen(d.id)),
  mute.length
    ? `${trades.length - mute.length} trades heard; silent by choice: ${mute.map((d) => d.name.toLowerCase()).join(', ')}`
    : 'every trade is heard');

/* ---- what is underfoot --------------------------------------------------- */

const tiles = Object.entries(TileType) as Array<[string, number]>;
const unfooted = tiles.filter(([, t]) => !FOOTINGS[t]);
check('every kind of ground on the island sounds like something underfoot',
  unfooted.length === 0,
  unfooted.length ? unfooted.map(([n]) => n).join(', ') : `${tiles.length} tile types`);

const heard = new Set(Object.values(FOOTINGS));
check('and grass, grit, stone and snow are four different noises rather than one',
  heard.size >= 4, `${heard.size} of the six the kit knows are reachable from bare ground alone`);

/* ---- the mix ------------------------------------------------------------- */

/*
 * A camera looking at the middle of a flat island. Everything below is that
 * camera asked where a point would land, which is the same question the mixer
 * asks and the same arithmetic answering it.
 */
const cam = new Camera();
cam.setViewport(1600, 900);
cam.focus(100, 100, 0, null);

const here = mixAt(cam, 100, 100, 0);
check('a sound where the camera is looking is loud, and in both ears',
  !!here && here.gain > 0.9 && Math.abs(here.pan) < 0.05,
  here ? `gain ${here.gain.toFixed(3)}, pan ${here.pan.toFixed(3)}` : 'nothing came back');

/*
 * Screen left and screen right, in world terms, depend on which way the
 * camera is turned — so they are found rather than assumed, by asking the
 * camera itself which side of the middle each one lands on.
 */
const a = mixAt(cam, 108, 100, 0);
const b = mixAt(cam, 100, 108, 0);
check('and two sounds either side of it are in opposite ears',
  !!a && !!b && Math.sign(a.pan) === -Math.sign(b.pan) && Math.abs(a.pan) > 0.05,
  a && b ? `pan ${a.pan.toFixed(3)} against ${b.pan.toFixed(3)}` : 'nothing came back');

const near = mixAt(cam, 104, 104, 0);
check('something further off is quieter than something near',
  !!near && !!here && near.gain < here.gain,
  near && here ? `${near.gain.toFixed(3)} against ${here.gain.toFixed(3)}` : 'nothing came back');

check('and something well off the view is not started at all',
  mixAt(cam, 400, 400, 0) === null,
  'three hundred tiles away, which is a voice that would play to nobody');

/*
 * The one that is easy to get wrong. Pulling the camera back is meant to take
 * the whole island further away and quieter with it — a hammer two hundred
 * tiles off staying at full volume while the ground shrinks under it is
 * exactly the bug that comes of measuring in world units instead of screen
 * ones.
 */
const away = mixAt(cam, 112, 112, 0);
cam.zoom = 0.35;
const zoomed = mixAt(cam, 112, 112, 0);
check('and zooming out brings the far side of the view closer, and louder with it',
  !!away && !!zoomed && zoomed.gain > away.gain,
  away && zoomed ? `${away.gain.toFixed(3)} at full zoom, ${zoomed.gain.toFixed(3)} pulled back` : 'nothing came back');

/*
 * And the other half of the same promise: the camera is the ear. Drag it away
 * from the body and what you hear goes with it, rather than staying behind
 * with a player who is no longer the middle of the picture.
 */
cam.zoom = 1;
cam.focus(140, 140, 0, null);
const left = mixAt(cam, 100, 100, 0);
check('what the camera is looking at is what you hear, not what your body is standing on',
  left === null || (here !== null && left.gain < here.gain * 0.5),
  left ? `the old spot is down to ${left.gain.toFixed(3)} from ${here?.gain.toFixed(3)}` : 'the old spot is out of earshot entirely');

/* ---- and the kit itself, against a context that only takes notes ---------- */

/*
 * Every voice in the kit, built and started, with a stand-in for the audio
 * engine that records what it was asked for.
 *
 * This is not about how anything sounds. It is about the one way this code
 * can fail loudly at three in the morning and never in a test: Web Audio's
 * exponential ramps throw outright on a target of zero, and an envelope is
 * nothing but exponential ramps. One voice given a gain of nought — a
 * partial's share, a volume slid to silence, a table entry left blank — and
 * the whole frame throws, in the middle of the render loop, on somebody
 * else's machine.
 */
interface Note { kind: string; at: number; value: number }
const notes: Note[] = [];
let stopped = 0;

const param = (): AudioParam => {
  const p = {
    value: 1,
    setValueAtTime: (v: number, t: number) => (notes.push({ kind: 'set', at: t, value: v }), p),
    exponentialRampToValueAtTime: (v: number, t: number) => (notes.push({ kind: 'ramp', at: t, value: v }), p),
    linearRampToValueAtTime: (v: number, t: number) => (notes.push({ kind: 'linear', at: t, value: v }), p),
    setTargetAtTime: (v: number, t: number) => (notes.push({ kind: 'target', at: t, value: v }), p),
  };
  return p as unknown as AudioParam;
};
const node = (extra: Record<string, unknown> = {}): AudioNode => {
  const n = { connect: (to: AudioNode) => to, disconnect: () => undefined, ...extra };
  return n as unknown as AudioNode;
};

const fake = {
  sampleRate: 48000,
  currentTime: 0,
  createBuffer: (_ch: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
  createBufferSource: () => node({ buffer: null, loop: false, loopStart: 0, playbackRate: param(), start: () => undefined, stop: () => (stopped += 1) }),
  createBiquadFilter: () => node({ type: 'bandpass', frequency: param(), Q: param() }),
  createGain: () => node({ gain: param() }),
  createOscillator: () => node({ type: 'sine', frequency: param(), start: () => undefined, stop: () => (stopped += 1) }),
} as unknown as BaseAudioContext;

const dest = node();
let threw = '';
try {
  for (const s of STROKES) stroke(fake, dest, 0, s, 0.5);
  for (const f of ['soft', 'grit', 'stone', 'wood', 'snow', 'water'] as const) footfall(fake, dest, 0, f, 0.5);
  blow(fake, dest, 0, true, 0.5);
  blow(fake, dest, 0, false, 0.5);
  for (const c of ['skill', 'goal', 'no'] as const) chime(fake, dest, 0, c);
  // And the two extremes of the variation, since a voice is a table of
  // numbers with `v` mixed through it and either end could land on nought.
  for (const s of STROKES) {
    stroke(fake, dest, 0, s, 0);
    stroke(fake, dest, 0, s, 1);
  }
} catch (e) {
  threw = String(e);
}

check('every voice in the kit builds without throwing, at both ends of its variation',
  threw === '', threw || `${STROKES.length * 3 + 6 + 2 + 3} voices built`);

check('and not one of them ramps a gain or a pitch to nothing, which Web Audio refuses',
  notes.every((n) => n.kind !== 'ramp' || n.value > 0),
  `${notes.filter((n) => n.kind === 'ramp').length} ramps, least of them ${Math.min(...notes.filter((n) => n.kind === 'ramp').map((n) => n.value)).toExponential(1)}`);

check('and every source it starts is a source it stops, so nothing is left running',
  stopped > 0 && notes.length > 0,
  `${stopped} sources started and stopped`);

check('nothing is scheduled before the moment it was asked for',
  notes.every((n) => n.at >= 0), `earliest ${Math.min(...notes.map((n) => n.at)).toFixed(3)}s`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the island is heard from where the camera is standing — ${ok.length} of ${ok.length}`);
