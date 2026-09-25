/**
 * The island saying that it cannot save.
 *
 * On 09-25 the island's database filled and went read-only. Every door that
 * writes was refused with SQLSTATE 25006, and nothing on the screen said so:
 * an action went off, was refused, and the click did nothing. Asked for: "Show
 * players a banner instead of a stream of failed actions."
 *
 * `watchedFetch` sees every call the browser makes to the island on its way
 * back. What this asks of it, with a stand-in for the network:
 *
 *   * a door refused for being read-only turns the banner on, once, however
 *     many doors are refused after it;
 *   * a door that only reads goes through read-only, so its answering does not
 *     turn the banner off;
 *   * a door that was refused, answering again, does -- once;
 *   * any other refusal (a rule, a missing row) leaves it alone;
 *   * and the answer handed back to the caller is the one the island gave,
 *     body and all, so a caller reading the error still reads it.
 */
import { CANNOT_SAVE, onSaving, READ_ONLY, watchedFetch } from '../../src/net/supabase';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const REST = 'https://island.example/rest/v1/rpc/';
/** What the stand-in network answers each door with, set per call below. */
let answer: (door: string) => Response = () => new Response('null', { status: 200 });
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return answer(url.slice(REST.length));
}) as typeof fetch;

// PostgREST answers 25006 with a 405 and the database's own words.
const readOnly = (): Response =>
  new Response(JSON.stringify({ code: READ_ONLY, message: 'cannot execute UPDATE in a read-only transaction' }), {
    status: 405,
    headers: { 'content-type': 'application/json' },
  });
const refusedByRule = (): Response =>
  new Response(JSON.stringify({ code: 'P0001', message: 'You are too far away from that.' }), { status: 400 });
const fine = (): Response => new Response('{"done":true}', { status: 200 });

const heard: boolean[] = [];
onSaving((saving) => heard.push(saving));
const call = async (door: string): Promise<Response> => watchedFetch(`${REST}${door}`, { method: 'POST' });

answer = refusedByRule;
await call('rpc_act');
check('a door refused by a rule says nothing about saving', heard.length === 0, `heard ${JSON.stringify(heard)}`);

answer = readOnly;
const first = await call('rpc_act');
check('a door refused for being read-only turns the banner on', heard.join() === 'false', `heard ${JSON.stringify(heard)}`);
const body = (await first.json()) as { code?: string; message?: string };
check('and the caller still gets the island\'s own answer', first.status === 405 && body.code === READ_ONLY,
  `${first.status} ${JSON.stringify(body)}`);
await call('rpc_settle');
await call('rpc_move');
check('more refused doors do not turn it on again', heard.join() === 'false', `heard ${JSON.stringify(heard)}`);

answer = fine;
await call('rpc_creatures');
check('a door that only reads, answering, does not turn it off', heard.join() === 'false', `heard ${JSON.stringify(heard)}`);
await call('rpc_settle');
check('a refused door answering again turns it off', heard.join() === 'false,true', `heard ${JSON.stringify(heard)}`);
await call('rpc_act');
check('and only once', heard.join() === 'false,true', `heard ${JSON.stringify(heard)}`);

answer = readOnly;
await call('rpc_fog');
check('it comes back on the next time', heard.join() === 'false,true,false', `heard ${JSON.stringify(heard)}`);
check('the banner says what the player loses, in the game\'s words',
  CANNOT_SAVE === "The island can't save right now. Until it can, nothing you do is kept.", CANNOT_SAVE);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the island saying that it cannot save — ${ok.length} of ${ok.length}`);
