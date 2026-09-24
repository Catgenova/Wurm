/**
 * A new look, worn on an island.
 *
 * Asked: "allow players to change their appearance back through the
 * customizer in Settings". The window is the creator from the account page;
 * what it does with a look on an island is `Island.wearLook`, and that is what
 * this measures, against a keeper that is a stub on `fetch`:
 *
 *   * the look goes to `rpc_set_look` as `p_look`, whole;
 *   * what is worn is what the keeper says it kept, not what was asked for --
 *     the keeper cleans every field against its own tables, and a body that
 *     wore the asking would look one way to its owner and another to everybody
 *     else;
 *   * standing still, the next body broadcast carries it anyway: a broadcast
 *     only goes out when something about the body changed, and before this a
 *     new look was not one of the things that counted;
 *   * and a refusal changes nothing and says why.
 *
 * `rpc_set_look` itself -- the cleaning, the account, every body ashore --
 * is measured by the island suite (563 to 565).
 */
import { Island, type PlayerRow } from '../../src/net/island';
import { cleanLook, type Look } from '../../src/game/look';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/* The keeper: every call is written down, and `rpc_set_look` answers as the refusal or the cleaning says. */
const calls: Array<{ url: string; body: unknown }> = [];
let refuse: string | null = null;
/** What the keeper does to a look on the way in: here, it has no green eyes. */
const keeperCleans = (l: Look): Look => ({ ...l, eyes: l.eyes === 'green' ? 'grey' : l.eyes });
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const body = init?.body ? JSON.parse(String(init.body)) as unknown : null;
  calls.push({ url, body });
  if (url.endsWith('/rest/v1/rpc/rpc_set_look')) {
    if (refuse) return json({ code: 'P0001', message: refuse, details: null, hint: null }, 400);
    return json(keeperCleans(cleanLook((body as { p_look?: unknown }).p_look)));
  }
  return json([]);
}) as typeof fetch;

/* An island joined as far as a body goes: a name, a look, somewhere to stand, and a channel that writes down what is sent on it. */
const before: Look = cleanLook({ gender: 'woman', skin: 'olive', hair: 'long', hairColour: 'auburn', eyes: 'hazel', beard: 'none', shirt: 'madder', trousers: 'bark' });
const isle = new Island({} as never);
isle.info = { id: 'w', name: 'w', seed: 1, size: 64, spawn_x: 0, spawn_y: 0, ready: true, epoch: '2026-01-01T00:00:00Z' };
isle.uid = 'u-alice';
isle.me = { world_id: 'w', uid: 'u-alice', name: 'Alice', x: 10.5, y: 10.5, level: 0, look: before, act: null, act_ends: null } as PlayerRow;
const sent: Array<{ payload: { look?: unknown; name?: string } }> = [];
const inside = isle as unknown as Record<string, unknown>;
inside.bodies = { send: async (m: { payload: { look?: unknown } }) => { sent.push(m); return 'ok'; } };
// The twenty-second reconcile is not what is being asked about, and the feet are where the island last heard they were.
inside.lastReconcile = Number.MAX_SAFE_INTEGER;
inside.lastSaid = '10.50,10.50,0';

await isle.move(10.5, 10.5, 0, 100);
check('a body on the island is shown as it is', sent.length === 1 && same(sent[0].payload.look, before), `${sent.length} sent`);
await isle.move(10.5, 10.5, 0, 101);
check('and standing still, nothing more is sent', sent.length === 1, `${sent.length} sent`);

const want: Look = cleanLook({ ...before, hair: 'braids', hairColour: 'black', eyes: 'green', shirt: 'woad' });
const kept = await isle.wearLook(want);
const asked = calls.find((c) => c.url.endsWith('/rest/v1/rpc/rpc_set_look'));
check('the look goes to rpc_set_look, whole', !!asked && same(asked.body, { p_look: want }), JSON.stringify(asked?.body ?? null));
check('what is worn is what the keeper kept', same(kept, keeperCleans(want)) && same(isle.me?.look, kept),
  `${kept.eyes} eyes kept, ${String((isle.me?.look as Look | undefined)?.eyes)} worn`);

await isle.move(10.5, 10.5, 0, 102);
check('standing still, the next broadcast carries the new look', sent.length === 2 && same(sent[1]?.payload.look, kept),
  `${sent.length} sent, the last in ${JSON.stringify(sent.at(-1)?.payload.look ?? null)}`);
check('under the same name', sent[1]?.payload.name === 'Alice', String(sent[1]?.payload.name));
await isle.move(10.5, 10.5, 0, 103);
check('and once only', sent.length === 2, `${sent.length} sent`);

refuse = 'not signed in';
let why = '';
try {
  await isle.wearLook(cleanLook({ ...kept, hair: 'bald' }));
} catch (e) {
  why = e instanceof Error ? e.message : String(e);
}
check('a refusal is said, in the keeper\'s words', why === 'not signed in', why || 'nothing thrown');
check('and changes nothing', same(isle.me?.look, kept), JSON.stringify(isle.me?.look));
await isle.move(10.5, 10.5, 0, 104);
check('and sends nothing', sent.length === 2, `${sent.length} sent`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a new look, worn on an island — ${ok.length} of ${ok.length}`);
