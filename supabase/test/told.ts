/**
 * Where the body is, told to the island in order, and never piled up.
 *
 * The island takes a change of storey only from the tile it heard of last
 * (`cellar_move_ok`): down from a flight's head onto its foot, up from the
 * foot onto the head. The browser says the step onto the flight and the
 * storey change off it each as it happens (`Game.atStairs`). When a word
 * before them was slow to be answered, both used to wait for that one and then
 * go together, and the island could hear the storey change first, refuse it,
 * and keep the body up top while the browser went on below.
 *
 * This is the real `Island.move` and the real client, against a keeper that
 * is a stub on `fetch` holding one body to `rpc_move`'s rules -- its pull-back
 * on a walk claimed faster than the time since its last word allows, and
 * `cellar_move_ok` -- on a link whose every call takes as long as the case
 * says:
 *
 *   * a slow word on its way, then the step onto the flight and the step off
 *     it, down and then up, with the two quick calls landing either way
 *     round: the island hears them in the order they were said, takes every
 *     one, and ends on the storey the browser is on;
 *   * a word held up on its way just before the step onto the stairs, so the
 *     island pulls the step onto them short, down and then up: the word on the
 *     stairs is said again, and the storey change after it is taken;
 *   * a storey change the island refuses: the body is put where the island
 *     has it, storey and all; a word said from below while that was on its
 *     way is not sent; and a job asked meanwhile goes once the answer is in;
 *   * a job asked while a word about walking is on its way goes at once;
 *   * thirty seconds of walking on a quick link: a word a second, as before;
 *   * the same walk on a link three times slower than a word a second: one
 *     call on its way at a time, each carrying the newest place, and the
 *     place it stops at heard within two round trips of its word;
 *   * a word on the stairs that never reaches the island holds the storey
 *     change up for `MOVE_LOST` seconds and no longer, and is then said again
 *     before it, and a job asked behind them goes once the storey change is
 *     answered;
 *   * a storey change that never reaches the island is said again, after the
 *     word on the stairs, before the next word on the storey it went to;
 *   * and an answer that comes back after a newer word went changes nothing.
 */
import { Island, MOVE_EVERY, MOVE_LOST, type PlayerRow } from '../../src/net/island';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const t0 = performance.now();
/** Milliseconds since the start, on the clock the link runs on. */
const clock = (): number => performance.now() - t0;

/* The flight: its head up top on tile (10,10), its foot a storey down on (10,9). */
const HEAD = '10,10';
const FOOT = '10,9';
const tileOf = (x: number, y: number): string => `${Math.floor(x)},${Math.floor(y)}`;
/** A walking pace, in tiles a second, as the island allows a body that walks (`travel_speed`). */
const WALK = 2.4;

/*
 * The keeper. Each call reaches it after the first of its two delays and is
 * answered after the second. It takes them in the order they arrive, as
 * `rpc_move` does: a claim further than `pace × min(gap, 10) × 1.6 + 1.5`
 * from where it has the body, `gap` the seconds since it last took a word, is
 * pulled back to that; then `cellar_move_ok`, which keeps the body where it
 * was; and it answers with where the body then is.
 */
interface Call { x: number; y: number; level: number; sentAt: number; heardAt: number; doneAt: number; kept: boolean; pulled: boolean; behind: number }
let calls: Call[] = [];
let acts: number[] = [];
let held = { x: 0, y: 0, level: 0 };
/** When the keeper last took a word, on the test's clock. */
let heldAt = 0;
/** The pace the keeper allows, in tiles a second of the test's clock. */
let pace = WALK;
/** How long the nth call takes there and back, in milliseconds; `Infinity` never arrives. */
let link: (n: number) => [number, number] = () => [5, 5];
/** The keeper will not let the body down the flight, whatever it hears first. */
let barred = false;
/** Where the browser's body is along a walk, for how far behind a call is when it goes. */
let walkedTo = 0;
const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const args = (init?.body ? JSON.parse(String(init.body)) : {}) as Record<string, number>;
  if (url.endsWith('/rest/v1/rpc/rpc_move')) {
    const call: Call = {
      x: args.p_x, y: args.p_y, level: args.p_level, sentAt: clock(), heardAt: NaN, doneAt: NaN,
      kept: false, pulled: false, behind: walkedTo - args.p_x,
    };
    const [there, back] = link(calls.length);
    calls.push(call);
    if (there === Infinity) return new Promise<Response>(() => undefined);
    await sleep(there);
    call.heardAt = clock();
    let { x, y } = call;
    const gap = Math.max(0.05, (call.heardAt - heldAt) / 1000);
    const allowed = pace * Math.min(gap, 10) * 1.6 + 1.5;
    const far = Math.hypot(x - held.x, y - held.y);
    if (far > allowed) {
      x = held.x + ((x - held.x) * allowed) / far;
      y = held.y + ((y - held.y) * allowed) / far;
      call.pulled = true;
    }
    const from = tileOf(held.x, held.y);
    const to = tileOf(x, y);
    call.kept = call.level === held.level
      || (!barred && held.level === 0 && call.level === -1 && from === HEAD && to === FOOT)
      || (held.level === -1 && call.level === 0 && from === FOOT && to === HEAD);
    if (call.kept) held = { x, y, level: call.level };
    heldAt = call.heardAt;
    const answer = { ...held };
    await sleep(back);
    call.doneAt = clock();
    return json(answer);
  }
  if (url.endsWith('/rest/v1/rpc/rpc_act')) {
    acts.push(clock());
    return json({ started: false, why: 'Asked only to see when it goes.' });
  }
  return json([]);
}) as typeof fetch;

/* The browser's body, which only the island's answer moves (`hooks.moved`). */
const body = { x: 0, y: 0, level: 0 };
let put: Array<{ x: number; y: number; level: number }> = [];

/** An island joined with the body standing at x, y on a storey, the keeper agreeing. */
const ashore = (x: number, y: number, level: number): Island => {
  const isle = new Island({
    moved: (mx: number, my: number, ml: number) => {
      put.push({ x: mx, y: my, level: ml });
      Object.assign(body, { x: mx, y: my, level: ml });
    },
  } as never);
  isle.info = { id: 'w', name: 'w', seed: 1, size: 64, spawn_x: 0, spawn_y: 0, ready: true, epoch: '2026-01-01T00:00:00Z' };
  isle.uid = 'u-alice';
  isle.me = { world_id: 'w', uid: 'u-alice', name: 'Alice', x, y, level, act: null, act_ends: null } as PlayerRow;
  const inside = isle as unknown as Record<string, unknown>;
  // Only the words about where the body is are asked about here: the reads
  // of the ground, the mobs, the fog and the channel stand still.
  for (const still of ['reconcile', 'refreshMobs', 'refreshGround', 'refreshSprings', 'keepFog', 'keepGuide', 'watch', 'catchUpQuietly', 'armBeat']) {
    inside[still] = () => Promise.resolve();
  }
  inside.hasLand = () => true;
  inside.block = '0,0';
  inside.lastLevel = level;
  calls = [];
  acts = [];
  put = [];
  held = { x, y, level };
  heldAt = clock();
  pace = WALK;
  Object.assign(body, { x, y, level });
  return isle;
};

/** The body walks to x, y on a storey, and the game hands that to `move` with the time on its own clock. */
const go = (isle: Island, x: number, y: number, level: number, now: number, stairs: boolean): void => {
  Object.assign(body, { x, y, level });
  void isle.move(x, y, level, now, undefined, stairs);
};

/** Run a case's steps at their times, in seconds from its start, and wait until `until`. */
const play = async (steps: Array<[number, () => void]>, until: number): Promise<void> => {
  const start = clock();
  for (const [at, step] of steps) {
    await sleep(Math.max(0, start + at * 1000 - clock()));
    step();
  }
  await sleep(Math.max(0, start + until * 1000 - clock()));
};
const heard = (name: (c: Call) => string): string => calls
  .filter((c) => !Number.isNaN(c.heardAt)).sort((a, b) => a.heardAt - b.heardAt).map(name).join(' ');
const refusals = (): number => calls.filter((c) => !Number.isNaN(c.heardAt) && !c.kept).length;

/*
 * Down the flight and up it again, with a word before each that is slow to be
 * answered. Down: M on the ground floor, F onto the flight's head, L off it
 * onto the foot, C on along the cellar. Up: the same steps the other way.
 */
const downNamed = (c: Call): string => (c.level === -1 ? (c.y < 9 ? 'C' : 'L') : c.y > 11 ? 'M' : 'F');
const upNamed = (c: Call): string => (c.level === 0 ? (c.y > 11 ? 'G' : 'F') : c.y < 9 ? 'C' : 'L');
for (const [label, legs] of [
  ['the first answer slow, the storey change quicker than the step before it', [[350, 350], [60, 60], [30, 30]]],
  ['the first answer slow, the step onto the flight quicker', [[350, 350], [30, 30], [60, 60]]],
  ['the first answer quick', [[25, 25], [60, 60], [30, 30]]],
] as Array<[string, Array<[number, number]>]>) {
  link = (n) => legs[n] ?? [5, 5];
  // The game's clock, which `move` is handed, reads 100 at the start of each case.
  let isle = ashore(10.5, 13.5, 0);
  await play([
    [0, () => go(isle, 10.5, 12.5, 0, 100, false)],
    [0.25, () => go(isle, 10.5, 10.6, 0, 100.25, true)],
    [0.5, () => go(isle, 10.5, 9.4, -1, 100.5, true)],
    [1.6, () => go(isle, 10.5, 8.4, -1, 101.6, false)],
  ], 2);
  const down = heard(downNamed);
  check(`down, ${label}: the island hears M F L C in that order`, down === 'M F L C', down);
  check(`down, ${label}: and takes every one, ending a storey down with the browser`,
    refusals() === 0 && held.level === -1 && body.level === -1 && put.length === 0,
    `${refusals()} refused; island on ${held.level}, browser on ${body.level}`);

  isle = ashore(10.5, 7.5, -1);
  await play([
    [0, () => go(isle, 10.5, 8.5, -1, 100, false)],
    [0.25, () => go(isle, 10.5, 9.4, -1, 100.25, true)],
    [0.5, () => go(isle, 10.5, 10.4, 0, 100.5, true)],
    [1.6, () => go(isle, 10.5, 11.6, 0, 101.6, false)],
  ], 2);
  const up = heard(upNamed);
  check(`up, ${label}: the island hears C L F G in that order`, up === 'C L F G', up);
  check(`up, ${label}: and takes every one, ending on the ground floor with the browser`,
    refusals() === 0 && held.level === 0 && body.level === 0 && put.length === 0,
    `${refusals()} refused; island on ${held.level}, browser on ${body.level}`);
}

/*
 * Pulled short of the stairs. A word about walking is held up on its way out
 * for 1.6 s; the step onto the stairs, said 1.4 s after it, lands straight
 * after it, so the island allows it the walk of the moment between the two
 * and not of the 1.4 s, and pulls it short. Down: W toward the flight, F onto
 * its head, L off it onto the foot, C on along the cellar. Up: W along the
 * cellar toward the foot, T onto the foot, U onto the flight's head, G on
 * along the ground floor.
 */
{
  link = (n) => (n === 0 ? [1600, 40] : [5, 5]);
  let isle = ashore(10.5, 15.5, 0);
  await play([
    [0, () => go(isle, 10.5, 14.3, 0, 100, false)],
    [1.4, () => go(isle, 10.5, 10.98, 0, 101.4, true)],
    [1.45, () => go(isle, 10.5, 9.9, -1, 101.45, true)],
    [2.6, () => go(isle, 10.5, 8.4, -1, 102.6, false)],
  ], 3.2);
  const down = heard((c) => (c.level === -1 ? (c.y < 9 ? 'C' : 'L') : c.y > 11 ? 'W' : 'F'));
  check('down, the step onto the flight pulled short of it: it is said again before the storey change, and the island hears W F F L C',
    down === 'W F F L C' && calls[1]?.pulled === true, `${down}${calls[1]?.pulled ? ', the first F pulled' : ''}`);
  check('and takes the storey change, ending a storey down with the browser and nothing snapped back',
    refusals() === 0 && held.level === -1 && body.level === -1 && put.length === 0,
    `${refusals()} refused; island on ${held.level}, browser on ${body.level}; put ${JSON.stringify(put)}`);

  isle = ashore(10.5, 4.5, -1);
  await play([
    [0, () => go(isle, 10.5, 5.7, -1, 100, false)],
    [1.4, () => go(isle, 10.5, 9.02, -1, 101.4, true)],
    [1.45, () => go(isle, 10.5, 10.02, 0, 101.45, true)],
    [2.6, () => go(isle, 10.5, 11.2, 0, 102.6, false)],
  ], 3.2);
  const up = heard((c) => (c.level === -1 ? (c.y < 9 ? 'W' : 'T') : c.y < 11 ? 'U' : 'G'));
  check('up, the step onto the foot pulled short of it: it is said again before the storey change, and the island hears W T T U G',
    up === 'W T T U G' && calls[1]?.pulled === true, `${up}${calls[1]?.pulled ? ', the first T pulled' : ''}`);
  check('and takes the storey change, ending on the ground floor with the browser and nothing snapped back',
    refusals() === 0 && held.level === 0 && body.level === 0 && put.length === 0,
    `${refusals()} refused; island on ${held.level}, browser on ${body.level}; put ${JSON.stringify(put)}`);
}

/*
 * A storey change the island refuses. Its answer is slow, and in the
 * meantime the body takes a step along the cellar and a job is asked for.
 */
{
  barred = true;
  // The flight's head (call 0) is answered at once, the step down (call 1) half a second after it lands.
  link = (n) => (n === 1 ? [100, 500] : [5, 5]);
  const isle = ashore(10.5, 11.5, 0);
  let job: Promise<unknown> = Promise.resolve();
  await play([
    [0, () => go(isle, 10.5, 10.6, 0, 100, true)],
    [0.25, () => go(isle, 10.5, 9.4, -1, 100.25, true)],
    // A second of the game's clock on from the step down, so it is a word.
    [0.45, () => go(isle, 10.5, 8.4, -1, 100.25 + MOVE_EVERY, false)],
    [0.5, () => { job = isle.act('drop', { id: 1 }); }],
  ], 1.2);
  await Promise.race([job, sleep(MOVE_LOST * 1000)]);
  const refused = calls.find((c) => c.level === -1 && !c.kept);
  check('a storey change the island refuses puts the body where the island has it, storey and all',
    !!refused && put.length === 1 && put[0].level === 0 && put[0].x === held.x && put[0].y === held.y && tileOf(body.x, body.y) === HEAD,
    `put ${JSON.stringify(put)}; island at ${JSON.stringify(held)}`);
  check('the step along the cellar said while that was on its way is not sent',
    !calls.some((c) => c.y < 9), `${calls.length} sent: ${calls.map((c) => `${c.x},${c.y},${c.level}`).join(' ')}`);
  check('a job asked meanwhile goes once the answer is in',
    acts.length === 1 && !!refused && acts[0] >= refused.doneAt, `asked at ${acts[0]?.toFixed(0)} ms, answer at ${refused?.doneAt.toFixed(0)} ms`);
  await play([[0, () => go(isle, body.x, body.y, body.level, 100.25 + 2 * MOVE_EVERY, true)]], 0.2);
  check('and the next word is from where it was put, and is taken', calls.at(-1)?.kept === true && held.level === body.level,
    `last ${JSON.stringify(calls.at(-1))}`);
  barred = false;
}

/* A job asked while a word about walking is slow to be answered. */
{
  link = (n) => (n === 0 ? [400, 400] : [5, 5]);
  const isle = ashore(10.5, 20.5, 0);
  let askedAt = 0;
  await play([
    [0, () => go(isle, 10.5, 19.5, 0, 100, false)],
    [0.05, () => { askedAt = clock(); void isle.act('drop', { id: 1 }); }],
  ], 1);
  check('a job asked while a word about walking is on its way goes at once, and does not wait for its answer',
    acts.length === 1 && acts[0] - askedAt < 100 && acts[0] < calls[0].doneAt,
    `asked ${((acts[0] ?? NaN) - askedAt).toFixed(1)} ms after it was wanted, the walk answered ${(calls[0].doneAt - askedAt).toFixed(0)} ms after`);
}

/*
 * Thirty seconds of walking east at 2.4 tiles a second, the game's clock
 * running `fast` times the link's, so the walk takes thirty seconds over that.
 * Then ten seconds of standing at the end of it, as the game goes on calling
 * `move` every frame whether the body moves or not.
 */
const walk = async (there: number, back: number, fast: number): Promise<{ took: number; stoppedAt: number; end: number; words: number[] }> => {
  link = () => [there, back];
  const isle = ashore(10.5, 20.5, 0);
  // The keeper's clock is the link's, which the game's runs `fast` times over.
  pace = WALK * fast;
  const start = clock();
  let stoppedAt = 0;
  // The words the one-a-second rule makes of the frames this walk was, worked out here on their own.
  const words: number[] = [];
  let lastWord = 0;
  let lastSaid = '';
  for (;;) {
    const secs = (clock() - start) / 1000 * fast;
    const now = 100 + secs;
    const x = 10.5 + WALK * Math.min(secs, 30);
    if (secs >= 30 && !stoppedAt) stoppedAt = clock();
    walkedTo = x;
    void isle.move(x, 20.5, 0, now, undefined, false);
    const said = x.toFixed(2);
    if (said !== lastSaid && now - lastWord >= MOVE_EVERY) {
      words.push(x);
      lastWord = now;
      lastSaid = said;
    }
    if (secs >= 40) break;
    await sleep(4);
  }
  await sleep(there + back + 50);
  return { took: stoppedAt - start, stoppedAt, end: 10.5 + WALK * 30, words };
};
const atOnce = (): number => Math.max(0, ...calls.map((c) => calls.filter((d) => d.sentAt < c.doneAt && d.doneAt > c.sentAt).length));
{
  // Five times over, so a word a second is a fifth of a second here: well past any pause in the test's own clock.
  const { words } = await walk(2, 2, 5);
  const sent = calls.map((c) => c.x.toFixed(2)).join(' ');
  check('thirty seconds of walking on a quick link sends every word of the one-a-second rule, as before, each in turn',
    sent === words.map((x) => x.toFixed(2)).join(' ') && atOnce() === 1,
    `${calls.length} calls for ${words.length} words, ${atOnce()} on the way at once`);
}
{
  const FAST = 10;
  const RTT = 3 * MOVE_EVERY * 1000 / FAST;
  const { took, stoppedAt, end, words } = await walk(RTT / 2, RTT / 2, FAST);
  const walking = calls.filter((c) => c.sentAt <= stoppedAt).length;
  const behind = Math.max(...calls.map((c) => c.behind));
  const last = calls.at(-1);
  check('on a link three times slower than a word a second, one call is on its way at a time',
    atOnce() === 1, `${atOnce()} at once`);
  check('and the island hears a word a round trip while walking, not one for every second walked',
    walking <= took / RTT + 1, `${walking} calls for ${words.length} words in ${(took / 1000).toFixed(2)} s, at ${RTT} ms a round trip`);
  check('each carrying the newest place said, not a backlog: none goes more than two seconds of walking behind the body',
    behind <= WALK * 2 * MOVE_EVERY, `at most ${behind.toFixed(2)} tiles, ${(behind / WALK).toFixed(2)} s, behind`);
  check('and the place it stopped at is heard within two round trips of its word',
    !!last && Math.abs(last.x - end) < 0.01 && last.doneAt - stoppedAt <= MOVE_EVERY * 1000 / FAST + 2 * RTT + 200,
    `last at x ${last?.x.toFixed(2)} of ${end.toFixed(2)}, answered ${((last?.doneAt ?? 0) - stoppedAt).toFixed(0)} ms after stopping`);
  walkedTo = 0;
}

/*
 * A word on the stairs that never reaches the island. M on the ground floor is
 * answered; F onto the flight's head is lost on its way; L off it onto the
 * foot waits `MOVE_LOST` for it, and then the island has not heard F at all.
 */
{
  link = (n) => (n === 1 ? [Infinity, 0] : [5, 5]);
  const isle = ashore(10.5, 12.5, 0);
  let job: Promise<unknown> = Promise.resolve();
  let saidAt = 0;
  let askedAt = 0;
  await play([
    [0, () => go(isle, 10.5, 11.6, 0, 100, false)],
    [0.1, () => go(isle, 10.5, 10.6, 0, 100.1, true)],
    [0.2, () => { saidAt = clock(); go(isle, 10.5, 9.4, -1, 100.2, true); }],
    [0.3, () => { askedAt = clock(); job = isle.act('drop', { id: 1 }); }],
  ], MOVE_LOST + 0.6);
  await Promise.race([job, sleep(1000)]);
  const named = heard((c) => (c.level === -1 ? 'L' : c.y > 11 ? 'M' : 'F'));
  const waited = (calls[2]?.sentAt ?? Infinity) - saidAt;
  check(`a word on the stairs that never reaches the island holds the storey change up for ${MOVE_LOST} s and no longer`,
    waited >= MOVE_LOST * 1000 - 20 && waited <= MOVE_LOST * 1000 + 300,
    `the next call sent ${(waited / 1000).toFixed(2)} s after the storey change was said`);
  check('and is said again before it, so the island hears M F L and takes the storey change',
    named === 'M F L' && calls.length === 4 && refusals() === 0 && held.level === -1 && put.length === 0,
    `${calls.length} calls, the island hearing ${named}; ${refusals()} refused; island on ${held.level}; put ${JSON.stringify(put)}`);
  const changed = calls[3]?.doneAt ?? NaN;
  check('and a job asked behind them goes once the storey change is answered',
    acts.length === 1 && acts[0] >= changed && acts[0] - askedAt <= MOVE_LOST * 1000 + 300,
    `asked ${((acts[0] - askedAt) / 1000).toFixed(2)} s after it was wanted, ${((acts[0] - changed) / 1000).toFixed(3)} s after the storey change was answered`);
}

/*
 * A storey change that never reaches the island. F onto the flight's head is
 * answered; L off it onto the foot is lost on its way; C on along the cellar
 * waits `MOVE_LOST` for it, and the island still has the body up top.
 */
{
  link = (n) => (n === 2 ? [Infinity, 0] : [5, 5]);
  const isle = ashore(10.5, 12.5, 0);
  let saidAt = 0;
  await play([
    [0, () => go(isle, 10.5, 11.6, 0, 100, false)],
    [0.1, () => go(isle, 10.5, 10.6, 0, 100.1, true)],
    [0.2, () => go(isle, 10.5, 9.4, -1, 100.2, true)],
    [1.3, () => { saidAt = clock(); go(isle, 10.5, 8.4, -1, 100.2 + MOVE_EVERY + 0.1, false); }],
  ], MOVE_LOST + 1.8);
  const named = heard(downNamed);
  const waited = (calls[3]?.sentAt ?? Infinity) - saidAt;
  check('a storey change that never reaches the island is said again, after the word on the stairs, before the next word on its storey',
    named === 'M F F L C' && waited >= MOVE_LOST * 1000 - 20 && waited <= MOVE_LOST * 1000 + 300,
    `the island hearing ${named}, the first of them ${(waited / 1000).toFixed(2)} s after the word was said`);
  check('and takes it, ending a storey down with the browser and nothing snapped back',
    refusals() === 0 && held.level === -1 && body.level === -1 && put.length === 0,
    `${refusals()} refused; island on ${held.level}, browser on ${body.level}; put ${JSON.stringify(put)}`);
}

/*
 * An answer that comes back late. A taken on its way; its answer is held up
 * past `MOVE_LOST`, so B goes without it, and A's answer -- where the island
 * had the body before B -- comes back after B's.
 */
{
  link = (n) => (n === 0 ? [5, MOVE_LOST * 1000 + 600] : [5, 5]);
  const isle = ashore(10.5, 30.5, 0);
  await play([
    [0, () => go(isle, 10.5, 31.5, 0, 100, false)],
    [0.1, () => go(isle, 10.5, 32.5, 0, 100 + MOVE_EVERY, false)],
  ], MOVE_LOST + 1);
  const knows = (isle as unknown as { islandHas: { x: number; y: number; level: number } | null }).islandHas;
  check('an answer that comes back after a newer word went changes nothing: the island is known to have the body where it said last',
    calls.length === 2 && calls[0].doneAt > calls[1].doneAt && knows?.y === 32.5 && put.length === 0,
    `answers at ${calls.map((c) => (c.doneAt / 1000).toFixed(2)).join(' and ')} s; known at ${JSON.stringify(knows)}`);
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`where the body is, told in order — ${ok.length} of ${ok.length}`);
process.exit(0);
