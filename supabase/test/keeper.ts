/**
 * The island's keepers, and their four tools.
 *
 * Asked for: "Island tools for the owner: who's online, move a stuck player,
 * mute, clear a stray pile."
 *
 * On two islands of its own, Keepers Hold (founded by Fenna) and Keepers
 * Elsewhere (founded by Otto), with Osric made an owner of every island by the
 * deploy's own SQL:
 *
 *   * every door refuses nobody signed in, a token with nobody in it, an
 *     account that keeps nothing, a player of the island, a player of another
 *     island, the founder of another island and an address the deploy has not
 *     made an owner yet -- and refuses before anything else, so nothing is
 *     moved, muted, cleared, counted or written down;
 *   * `supabase/owner.sql`, as the deploy runs it: an address in any case and
 *     with spaces round it finds its account once, a second run adds nothing,
 *     an address nobody has and one that tries to be SQL add nothing, and the
 *     address is never in what it prints;
 *   * the founder of an island keeps that island and no other, and an owner
 *     row keeps both;
 *   * who is on: everybody with a body, ashore first, where they stand, how
 *     long since they were heard from, whether they are away or muted, and
 *     where Move would put them, in the same words the island uses;
 *   * a move to a settlement token stops the job and empties the queue, tells
 *     both ends in so many words and sends the browser the spot; a move to
 *     where newcomers come ashore takes the body off what it rode, drove,
 *     pulled and was aboard, and sends nothing to a browser that is away;
 *   * a mute refuses talk, letters and a parcel's note, saying until when,
 *     lets a parcel with no note go, holds on one island only, lifts on time
 *     and lifts when a keeper lifts it;
 *   * a pile, its stacks and what was inside them, gone, the tile beside it
 *     left alone, and the keeper told how many;
 *   * the trail: every door that did something wrote it down, a second look
 *     is counted on the first one's row, and nobody else wrote anything;
 *   * and no browser can read the tables or call the helpers.
 *
 * Makes and removes everything it uses, so it runs on the database the suite
 * leaves behind or on any other with the migrations in it.
 */
import { execFileSync } from 'node:child_process';
import { awayFor } from '../../src/game/away';
import { clearQuestion, heardLine, moveTarget, MUTE_FOR, muteLabel, muteLine, type Kept, type KeptBody } from '../../src/game/keeper';

const ENV = {
  ...process.env,
  PGHOST: process.env.PGHOST ?? '/var/run/postgresql',
  PGPORT: process.env.PGPORT ?? '5433',
  PGUSER: process.env.PGUSER ?? 'wurm',
  PGDATABASE: process.env.PGDATABASE ?? 'postgres',
};

interface Ran { out: string; err: string }

/** psql, reading from stdin or a file, with whatever it said and whatever it complained of. */
function run(args: string[], input = ''): Ran {
  try {
    const out = execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', ...args],
      { input, encoding: 'utf8', env: ENV, stdio: ['pipe', 'pipe', 'pipe'] });
    return { out: out.trim(), err: '' };
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string };
    return { out: (x.stdout ?? '').trim(), err: (x.stderr ?? '').trim() || String(e) };
  }
}
const sql = (text: string): Ran => run(['-f', '-'], text);
/** As the owner of the database, which is how the setting up and the looking are done. */
const psql = (text: string): string => {
  const r = sql(text);
  if (r.err) throw new Error(r.err);
  return r.out;
};
/** Through the role a browser has, as somebody signed in, or with a token that names nobody. */
const as = (who: string | null, text: string): Ran => sql(
  `select set_config('request.jwt.claims', '${who ? JSON.stringify({ sub: who }) : ''}', false) \\g /dev/null\n`
  + `set role authenticated;\n${text}\n`);
/** As nobody at all: the role a page has before it signs in. */
const anon = (text: string): Ran => sql(`set role anon;\n${text}\n`);
const parsed = <T>(r: Ran): T | null => {
  try {
    return JSON.parse(r.out) as T;
  } catch {
    return null;
  }
};

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const KEEP = 'ee000000-0000-4000-8000-0000000000a1';
const THERE = 'ee000000-0000-4000-8000-0000000000a2';
const FOUNDER = 'ee000000-0000-4000-8000-000000000001'; // Fenna, who founded Keepers Hold
const OWNER = 'ee000000-0000-4000-8000-000000000002'; // Osric, whom the deploy makes an owner
const PLAYER = 'ee000000-0000-4000-8000-000000000003'; // Pell, who plays on Keepers Hold
const STUCK = 'ee000000-0000-4000-8000-000000000004'; // Stig, who founded Stuckholm there
const DRIFTER = 'ee000000-0000-4000-8000-000000000005'; // Dray, who founded nothing
const OTHER = 'ee000000-0000-4000-8000-000000000006'; // Otto, who founded Keepers Elsewhere
const STRANGER = 'ee000000-0000-4000-8000-000000000007'; // Sten, who plays only there
const NOBODY = 'ee000000-0000-4000-8000-000000000008'; // signed in, with no body and no island
const ALL = [FOUNDER, OWNER, PLAYER, STUCK, DRIFTER, OTHER, STRANGER, NOBODY];
const list = (xs: string[]): string => xs.map((x) => `'${x}'`).join(', ');
const OWNER_EMAIL = 'owner@keeper.test';

// The trail and the mutes go with their island; said again for a database whose
// `private` schema outlived a rebuild of `public` and the ties to it.
const CLEAN = `
delete from private.owner_log where world_id in ('${KEEP}', '${THERE}');
delete from private.island_mute where world_id in ('${KEEP}', '${THERE}');
delete from world where id in ('${KEEP}', '${THERE}');
delete from private.island_owner where uid in (${list(ALL)});
delete from auth.users where id in (${list(ALL)});
delete from caller where uid in (${list(ALL)});
delete from realtime.messages where topic like '%:${KEEP}%' or topic like '%:${THERE}%';
`;
psql(CLEAN);
const BODY = `'{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb`;
psql(`
insert into auth.users (id, email) values
  ('${FOUNDER}', 'founder@keeper.test'), ('${OWNER}', '${OWNER_EMAIL}'), ('${PLAYER}', 'player@keeper.test'),
  ('${STUCK}', 'stuck@keeper.test'), ('${DRIFTER}', 'drifter@keeper.test'), ('${OTHER}', 'other@keeper.test'),
  ('${STRANGER}', 'stranger@keeper.test'), ('${NOBODY}', 'nobody@keeper.test');
insert into world (id, name, seed, size, spawn_x, spawn_y, ready, made_by) values
  ('${KEEP}', 'Keepers Hold', 1, 32, 10, 12, true, '${FOUNDER}'),
  ('${THERE}', 'Keepers Elsewhere', 2, 16, 4, 4, true, '${OTHER}');
select land_blank('${KEEP}', 32) \\g /dev/null
select land_blank('${THERE}', 16) \\g /dev/null
insert into player (world_id, uid, name, x, y, stats) values
  ('${KEEP}', '${FOUNDER}', 'Fenna', 10.5, 12.5, ${BODY}), ('${KEEP}', '${OWNER}', 'Osric', 11.5, 12.5, ${BODY}),
  ('${KEEP}', '${PLAYER}', 'Pell', 12.5, 12.5, ${BODY}), ('${KEEP}', '${STUCK}', 'Stig', 3.5, 28.5, ${BODY}),
  ('${KEEP}', '${DRIFTER}', 'Dray', 30.2, 1.7, ${BODY}),
  ('${THERE}', '${OTHER}', 'Otto', 4.5, 4.5, ${BODY}), ('${THERE}', '${STRANGER}', 'Sten', 5.5, 4.5, ${BODY}),
  ('${THERE}', '${STUCK}', 'Stig', 6.5, 4.5, ${BODY});
update player set away = true, seen_at = now() - interval '2 hours', left_at = now() - interval '2 hours'
 where world_id = '${KEEP}' and uid = '${DRIFTER}';
insert into deed (world_id, name, x, y, founded_by) values ('${KEEP}', 'Stuckholm', 20, 22, '${STUCK}');
-- A pile at (15, 16): four logs, a rope, and a backpack with two ropes in it; and a log beside it.
insert into item (world_id, holder, gx, gy, def, ql, count) values
  ('${KEEP}', 'ground', 15, 16, 'log', 20, 4), ('${KEEP}', 'ground', 15, 16, 'rope', 30, 1),
  ('${KEEP}', 'ground', 15, 16, 'backpack', 30, 1), ('${KEEP}', 'ground', 15, 17, 'log', 20, 1);
insert into item (world_id, holder, inside, def, ql, count)
  select '${KEEP}', 'bag', i.id, 'rope', 30, 2 from item i
   where i.world_id = '${KEEP}' and i.def = 'backpack' and i.holder = 'ground';
`);

const DOORS: Array<[string, string]> = [
  ['who is on', `select rpc_owner_online('${KEEP}');`],
  ['move', `select rpc_owner_move('${KEEP}', '${STUCK}');`],
  ['mute', `select rpc_owner_mute('${KEEP}', '${STUCK}', 3600);`],
  ['unmute', `select rpc_owner_unmute('${KEEP}', '${STUCK}');`],
  ['clear', `select rpc_owner_clear('${KEEP}', 15, 16);`],
];
const REFUSED = 'only a keeper of this island may do that';
const NOT_OWNERS: Array<[string, string | null]> = [
  ['a token that names nobody', null],
  ['an account that keeps nothing and has no body anywhere', NOBODY],
  ['a player of this island', PLAYER],
  ['a player of another island', STRANGER],
  ['the founder of another island', OTHER],
  ['an address the deploy has not made an owner yet', OWNER],
];

/* ---- nobody else gets in ------------------------------------------------------ */
console.log('--- who may not');
for (const [door, call] of DOORS) {
  const a = anon(call);
  check(`${door}: nobody signed in may not so much as call it`, a.err.includes('permission denied for function'), a.err || a.out);
  for (const [who, uid] of NOT_OWNERS) {
    const r = as(uid, call);
    check(`${door}: refused to ${who}`, r.err.includes(REFUSED), r.err || r.out);
  }
}
const amI = (who: string | null, world: string): string => {
  const r = as(who, `select rpc_owner_am_i('${world}');`);
  return r.err ? `error: ${r.err}` : r.out;
};
check('asking whether you keep it: nobody signed in may not ask',
  anon(`select rpc_owner_am_i('${KEEP}');`).err.includes('permission denied for function'));
check('and everybody who does not keep it is told no',
  [null, NOBODY, PLAYER, STRANGER, OTHER, OWNER].every((who) => amI(who, KEEP) === 'f'),
  [null, NOBODY, PLAYER, STRANGER, OTHER, OWNER].map((who) => amI(who, KEEP)).join(' '));
const touched = psql(`
select (select count(*) from caller where uid in (${list([NOBODY, PLAYER, STRANGER, OTHER, OWNER])})) || '|'
    || (select count(*) from item where world_id = '${KEEP}' and holder = 'ground' and gx = 15 and gy = 16) || '|'
    || (select x || ',' || y from player where world_id = '${KEEP}' and uid = '${STUCK}') || '|'
    || (select count(*) from private.island_mute where world_id = '${KEEP}') || '|'
    || (select count(*) from private.owner_log where world_id = '${KEEP}');`);
check('refused before anything else: no call counted, nothing cleared, moved, muted or written down',
  touched === '0|3|3.5,28.5|0|0', touched);

/* ---- who keeps what ----------------------------------------------------------- */
console.log('--- who keeps what');
const ownersFrom = (email: string): Ran => run(['-v', `email=${email}`, '-f', 'supabase/owner.sql']);
const before = Number(psql('select count(*) from private.island_owner;'));
const first = ownersFrom(` ${OWNER_EMAIL.toUpperCase()} `);
check('the deploy\'s SQL finds the account whatever case the address is in and whatever space is round it',
  first.out === `1|1|${before + 1}` && !first.err, first.out || first.err);
const again = ownersFrom(OWNER_EMAIL);
check('and a second run adds nobody', again.out === `1|0|${before + 1}`, again.out || again.err);
const nobody = ownersFrom('nobody-has-this@keeper.test');
check('an address nobody has adds nobody', nobody.out === `0|0|${before + 1}`, nobody.out || nobody.err);
const sly = ownersFrom(`x' or '1'='1`);
check('an address that tries to be SQL is only ever an address', sly.out === `0|0|${before + 1}` && !sly.err, sly.out || sly.err);
check('and what it prints never has the address in it',
  [first, again, nobody].every((r) => !`${r.out}${r.err}`.toLowerCase().includes('keeper.test')),
  [first, again, nobody].map((r) => r.out).join(' '));
check('the owner it added is the account with that address',
  psql(`select count(*) from private.island_owner where uid = '${OWNER}';`) === '1');
check('an owner row keeps every island on the project', amI(OWNER, KEEP) === 't' && amI(OWNER, THERE) === 't',
  `${amI(OWNER, KEEP)} ${amI(OWNER, THERE)}`);
check('the founder of an island keeps it', amI(FOUNDER, KEEP) === 't' && amI(OTHER, THERE) === 't',
  `${amI(FOUNDER, KEEP)} ${amI(OTHER, THERE)}`);
check('and no other', amI(FOUNDER, THERE) === 'f' && amI(OTHER, KEEP) === 'f', `${amI(FOUNDER, THERE)} ${amI(OTHER, KEEP)}`);
const theirs = as(FOUNDER, `select rpc_owner_online('${THERE}');`);
check('a founder\'s tools stop at the edge of their island', theirs.err.includes(REFUSED), theirs.err || theirs.out);

/* ---- who is on ---------------------------------------------------------------- */
console.log('--- who is on');
const look = (who: string, world = KEEP): Kept | null => parsed<Kept>(as(who, `select rpc_owner_online('${world}');`));
psql(`update player set seen_at = now() - interval '5 minutes' where world_id = '${KEEP}' and uid = '${PLAYER}';`);
const seen = look(FOUNDER);
const body = (k: Kept | null, uid: string): KeptBody | undefined => k?.people.find((b) => b.uid === uid);
check('the founder sees everybody with a body on the island', seen?.people.length === 5,
  seen ? seen.people.map((b) => b.name).join(', ') : 'no answer');
check('ashore first, and whoever is away after',
  !!seen && seen.people.slice(0, 4).every((b) => !b.away) && seen.people[4]?.uid === DRIFTER && seen.people[4].away,
  seen ? seen.people.map((b) => `${b.name}${b.away ? ' (away)' : ''}`).join(', ') : '');
const stig = body(seen, STUCK);
check('where they stand, by the tile', stig?.x === 3 && stig?.y === 28, `${stig?.x}, ${stig?.y}`);
const pell = body(seen, PLAYER);
check('how long since the island heard from them', !!pell && Math.abs(pell.heard - 300) <= 5, String(pell?.heard));
check('and how the window says it', !!pell && heardLine(pell.heard) === 'heard from 5 minutes ago', pell ? heardLine(pell.heard) : '');
check('which of them keep it too, and which is you',
  body(seen, FOUNDER)?.you === true && body(seen, FOUNDER)?.keeper === true && body(seen, OWNER)?.keeper === true
    && body(seen, OWNER)?.you === false && stig?.keeper === false);
check('nobody muted yet', !!seen && seen.people.every((b) => !b.muted && b.muted_for === null && muteLine(b) === ''));
check('the token Move would use, and where newcomers come ashore for somebody with none',
  stig?.home?.name === 'Stuckholm' && stig.home.x === 20 && stig.home.y === 22
    && body(seen, DRIFTER)?.home === null && seen?.spawn.x === 10 && seen.spawn.y === 12,
  JSON.stringify({ home: stig?.home, spawn: seen?.spawn }));
const elsewhere = look(OWNER, THERE);
check('an owner row sees another island\'s people too', elsewhere?.people.length === 3,
  elsewhere ? elsewhere.people.map((b) => b.name).join(', ') : 'no answer');
check('and so does its founder', look(OTHER, THERE)?.people.length === 3);

/* ---- a move ------------------------------------------------------------------- */
console.log('--- a move');
const digging = psql(`select verb from action_def where id = 'dig';`);
psql(`
update player set act = 'dig', act_target = '{"kind":"tile","x":3,"y":28}'::jsonb, act_started = now(),
       act_ends = now() + interval '1 hour', act_left = 1, act_goes = 1,
       act_queue = '[{"action":"dig","target":{"kind":"tile","x":3,"y":28},"goes":1},
                     {"action":"dig","target":{"kind":"tile","x":4,"y":28},"goes":1}]'::jsonb
 where world_id = '${KEEP}' and uid = '${STUCK}';`);
const moved = parsed<{ x: number; y: number; to: string; stopped: string; queued: number; off: string[] }>(
  as(OWNER, `select rpc_owner_move('${KEEP}', '${STUCK}');`));
check('a body with a settlement goes to its token', moved?.x === 20.5 && moved?.y === 22.5, JSON.stringify(moved));
check('the window names the same place the island does', !!stig && !!seen && moved?.to === moveTarget(stig, seen.spawn),
  `${moved?.to} | ${stig && seen ? moveTarget(stig, seen.spawn) : ''}`);
const after = psql(`select x || ',' || y || ',' || level || ',' || coalesce(act, 'none') || ',' || act_queue::text
  from player where world_id = '${KEEP}' and uid = '${STUCK}';`);
check('is there, on the ground, with its job stopped and its queue empty', after === '20.5,22.5,0,none,[]', after);
const toldStig = psql(`select text from event where world_id = '${KEEP}' and uid = '${STUCK}' order by n desc limit 1;`);
check('and is told who moved it, where to, and what stopped',
  toldStig === `Osric, who keeps this island, has moved you to the token of Stuckholm at (20, 22). You stop ${digging}, and the 2 jobs queued after it are cleared.`,
  toldStig);
const toldOsric = psql(`select text from event where world_id = '${KEEP}' and uid = '${OWNER}' order by n desc limit 1;`);
check('and the keeper, in the same words about them',
  toldOsric === `You move Stig to the token of Stuckholm at (20, 22). They stop ${digging}, and the 2 jobs queued after it are cleared.`,
  toldOsric);
const sent = psql(`select payload::text from realtime.messages where topic = 'own:${KEEP}:${STUCK}' and event = 'moved' order by id desc limit 1;`);
check('and its browser is sent the spot', sent === '{"x": 20.5, "y": 22.5, "level": 0}', sent);

psql(`
do $$
declare c int := creature_spawn('${KEEP}', 'rabba', 30.2, 1.7, 'active', now() - interval '1 day', '${DRIFTER}');
begin
  update creature set rider = '${DRIFTER}', name = 'Bess' where world_id = '${KEEP}' and id = c;
end $$;
insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, driver) values
  ('${KEEP}', 'furniture', 'wagon', 28, 1, 0, 0, 28.5, 1.5, 30, '${DRIFTER}', '${DRIFTER}');
insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, puller) values
  ('${KEEP}', 'furniture', 'cart', 29, 2, 0, 0, 29.5, 2.5, 30, '${DRIFTER}', '${DRIFTER}');
insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by) values
  ('${KEEP}', 'furniture', 'caravel', 30, 3, 0, 0, 30.5, 3.5, 30, '${DRIFTER}');
update player set aboard = (select id from placed where world_id = '${KEEP}' and sub = 'caravel'), seat = 1
 where world_id = '${KEEP}' and uid = '${DRIFTER}';`);
const drifted = parsed<{ x: number; y: number; to: string; off: string[] }>(as(FOUNDER, `select rpc_owner_move('${KEEP}', '${DRIFTER}');`));
const dray = body(seen, DRIFTER);
check('a body with no settlement goes to where newcomers come ashore',
  drifted?.x === 10.5 && drifted?.y === 12.5 && !!dray && !!seen && drifted?.to === moveTarget(dray, seen.spawn),
  JSON.stringify(drifted));
const off = psql(`
select (select count(*) from creature where world_id = '${KEEP}' and rider = '${DRIFTER}') || '|'
    || (select count(*) from placed where world_id = '${KEEP}' and (driver = '${DRIFTER}' or puller = '${DRIFTER}')) || '|'
    || (select coalesce(aboard::text, 'none') || ',' || coalesce(seat::text, 'none') from player where world_id = '${KEEP}' and uid = '${DRIFTER}') || '|'
    || (select string_agg(sub || ' ' || x || ',' || y, '; ' order by sub) from placed where world_id = '${KEEP}' and made_by = '${DRIFTER}');`);
check('off the beast, the wagon, the cart\'s shafts and the ship, which all stay where they were',
  off === '0|0|none,none|caravel 30,3; cart 29,2; wagon 28,1', off);
const toldDray = psql(`select text from event where world_id = '${KEEP}' and uid = '${DRIFTER}' order by n desc limit 1;`);
check('and is told so, every one of them',
  toldDray === 'Fenna, who keeps this island, has moved you to where newcomers come ashore, at (10, 12). '
    + 'You are no longer riding Bess or driving the wagon or pulling the small cart or aboard the caravel.', toldDray);
check('a browser that is away is sent nothing',
  psql(`select count(*) from realtime.messages where topic = 'own:${KEEP}:${DRIFTER}' and event = 'moved';`) === '0');
const nowhere = parsed<{ why?: string }>(as(OWNER, `select rpc_owner_move('${KEEP}', '${NOBODY}');`));
check('and somebody with no body here is not moved', nowhere?.why === 'That person has no body on this island.', JSON.stringify(nowhere));

/* ---- a mute ------------------------------------------------------------------- */
console.log('--- a mute');
const TIMED = /^You are muted on this island for (\d+ \w+(?: and \d+ \w+)?) more, until \d{1,2} [A-Z][a-z]{2} \d{2}:\d{2} UTC\. Until then, nothing you say aloud, write in a letter or put in a parcel note is sent\.$/;
const say = (who: string, world = KEEP, text = 'hello'): { said?: string | null; why?: string } | null =>
  parsed(as(who, `select rpc_say('${world}', '${text}');`));
check('before a mute, talk goes out', say(STUCK)?.said === 'hello');
const muted = parsed<{ muted: boolean; secs: number }>(as(OWNER, `select rpc_owner_mute('${KEEP}', '${STUCK}', ${MUTE_FOR[0]});`));
check('a keeper mutes somebody for an hour', muted?.muted === true && muted.secs === MUTE_FOR[0], JSON.stringify(muted));
const hushed = say(STUCK);
check('what they say aloud is refused, saying for how long and until when',
  hushed?.said === null && TIMED.test(hushed.why ?? '') && TIMED.exec(hushed.why ?? '')?.[1] === awayFor(MUTE_FOR[0] ?? 0),
  hushed?.why ?? JSON.stringify(hushed));
check('and nothing is said', psql(`select count(*) from event where world_id = '${KEEP}' and said_by = '${STUCK}' and text like '%hello%';`) === '1');
const letter = parsed<{ why?: string }>(as(STUCK, `select rpc_letter('${KEEP}', '${PLAYER}', 'hi there');`));
check('a letter is refused in the same sentence', letter?.why === hushed?.why, letter?.why ?? '');
psql(`
insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by) values
  ('${KEEP}', 'furniture', 'mailbox', 20, 23, 0, 0, 20.5, 23.5, '${STUCK}');
select give('${KEEP}', '${STUCK}', 'rope', 1, 30) \\g /dev/null`);
const rope = psql(`select id from item where world_id = '${KEEP}' and holder = 'player' and holder_uid = '${STUCK}' and def = 'rope';`);
const noted = parsed<{ why?: string }>(as(STUCK, `select rpc_parcel('${KEEP}', '${PLAYER}', 'a note', array[${rope}]::bigint[]);`));
check('a parcel with a note is refused, and nothing leaves the pack',
  noted?.why === hushed?.why && psql(`select holder from item where id = ${rope};`) === 'player', noted?.why ?? '');
const plain = parsed<{ why?: string; parcel?: number }>(as(STUCK, `select rpc_parcel('${KEEP}', '${PLAYER}', '', array[${rope}]::bigint[]);`));
check('a parcel with no note goes, with only the island\'s line on it',
  plain?.parcel === 1 && psql(`select holder from item where id = ${rope};`) === 'post'
    && psql(`select text from letter where world_id = '${KEEP}' and sender = '${STUCK}' order by n desc limit 1;`) === psql('select parcel_note();'),
  JSON.stringify(plain));
check('no letter of their own words was written',
  psql(`select count(*) from letter where world_id = '${KEEP}' and sender = '${STUCK}' and text <> parcel_note();`) === '0');
const toldMuted = psql(`select text from event where world_id = '${KEEP}' and uid = '${STUCK}' and kind = 'system' and text like '%muted you%' order by n desc limit 1;`);
check('the one muted is told who muted them and for how long',
  /^Osric, who keeps this island, has muted you for 1 hour, until \d{1,2} [A-Z][a-z]{2} \d{2}:\d{2} UTC\. Until then, nothing you say aloud, write in a letter or put in a parcel note is sent\.$/.test(toldMuted),
  toldMuted);
const mutedSeen = body(look(OWNER), STUCK);
check('the list says they are muted and for how much longer',
  !!mutedSeen && mutedSeen.muted && mutedSeen.muted_for !== null && Math.abs(mutedSeen.muted_for - (MUTE_FOR[0] ?? 0)) <= 10,
  JSON.stringify(mutedSeen));
check('in the window\'s words', !!mutedSeen && muteLine(mutedSeen) === `muted for ${awayFor(mutedSeen.muted_for ?? 0)} more`,
  mutedSeen ? muteLine(mutedSeen) : '');
check('on this island only: elsewhere they talk', say(STUCK, THERE)?.said === 'hello');

// Two seconds of mute, said and waited out in one session so the clock is the island's alone.
const claims = (who: string): string => `select set_config('request.jwt.claims', '${JSON.stringify({ sub: who })}', false) \\g /dev/null`;
const brief = as(OWNER, `select rpc_owner_mute('${KEEP}', '${STUCK}', 2) \\g /dev/null
${claims(STUCK)}
select coalesce(rpc_say('${KEEP}', 'too soon')->>'said', 'refused');
select pg_sleep(2.2) \\g /dev/null
select coalesce(rpc_say('${KEEP}', 'back again')->>'said', 'refused');`);
const [soon, later] = brief.out.split('\n');
check('a mute for two seconds holds for those seconds', soon === 'refused', brief.err || soon);
check('and lifts by itself when they are up', later === 'back again', brief.err || later);

parsed(as(FOUNDER, `select rpc_owner_mute('${KEEP}', '${STUCK}', null);`));
const forever = say(STUCK);
check('a mute until lifted says so',
  forever?.why === 'You are muted on this island until one of its keepers lifts it. Until then, nothing you say aloud, write in a letter or put in a parcel note is sent.',
  forever?.why ?? '');
const liftedSeen = body(look(FOUNDER), STUCK);
check('and the list says it lasts until lifted', !!liftedSeen && liftedSeen.muted && liftedSeen.muted_for === null
  && muteLine(liftedSeen) === 'muted until lifted', JSON.stringify(liftedSeen));
const lifted = parsed<{ muted: boolean }>(as(FOUNDER, `select rpc_owner_unmute('${KEEP}', '${STUCK}');`));
check('a keeper lifts it', lifted?.muted === false, JSON.stringify(lifted));
check('and they are told',
  psql(`select text from event where world_id = '${KEEP}' and uid = '${STUCK}' order by n desc limit 1;`)
    === 'Fenna, who keeps this island, has lifted your mute. What you say aloud, write in a letter or put in a parcel note is sent again.');
check('talk and letters go out again', say(STUCK, KEEP, 'thank you')?.said === 'thank you'
  && !!parsed<{ n?: number }>(as(STUCK, `select rpc_letter('${KEEP}', '${PLAYER}', 'thanks');`))?.n);
check('lifting a mute that is not there says so',
  parsed<{ why?: string }>(as(FOUNDER, `select rpc_owner_unmute('${KEEP}', '${STUCK}');`))?.why === 'Stig is not muted.');
check('a mute of no time at all is not a mute',
  parsed<{ why?: string }>(as(FOUNDER, `select rpc_owner_mute('${KEEP}', '${STUCK}', 0);`))?.why === 'A mute lasts some seconds, or until it is lifted.');
check('and nobody without a body here is muted',
  parsed<{ why?: string }>(as(FOUNDER, `select rpc_owner_mute('${KEEP}', '${NOBODY}', 60);`))?.why === 'That person has no body on this island.');

/* ---- a pile ------------------------------------------------------------------- */
console.log('--- a pile');
const what = psql(`select pile_text(array_agg(id)) from item where world_id = '${KEEP}' and holder = 'ground' and gx = 15 and gy = 16;`);
const changes = psql(`select count(*) from tile_change where world_id = '${KEEP}' and x = 15 and y = 16;`);
const cleared = parsed<{ stacks: number; things: number; inside: number; what: string }>(
  as(OWNER, `select rpc_owner_clear('${KEEP}', 15, 16);`));
check('a keeper clears a pile: three stacks, six things, and the two inside the backpack',
  cleared?.stacks === 3 && cleared.things === 6 && cleared.inside === 2 && cleared.what === what, JSON.stringify(cleared));
const left = psql(`
select (select count(*) from item where world_id = '${KEEP}' and holder = 'ground' and gx = 15 and gy = 16) || '|'
    || (select count(*) from item where world_id = '${KEEP}' and holder = 'bag' and def = 'rope' and inside is not null) || '|'
    || (select count(*) from item where world_id = '${KEEP}' and holder = 'ground' and gx = 15 and gy = 17);`);
check('nothing is left on the tile or inside what was on it, and the tile beside it is untouched', left === '0|0|1', left);
check('browsers are told the tile changed',
  Number(psql(`select count(*) from tile_change where world_id = '${KEEP}' and x = 15 and y = 16;`)) === Number(changes) + 1);
const toldClear = psql(`select text from event where world_id = '${KEEP}' and uid = '${OWNER}' order by n desc limit 1;`);
check('and the keeper is told how many things went',
  toldClear === `You clear the pile at (15, 16) for good: 6 things in 3 stacks (${what}), and 2 more that were inside them.`, toldClear);
check('what the window asks first says the same', clearQuestion(15, 16, 3, 6).includes('6 things in 3 stacks'));
check('a tile with nothing on it says so',
  parsed<{ why?: string }>(as(OWNER, `select rpc_owner_clear('${KEEP}', 15, 16);`))?.why === 'Nothing is lying on the ground at (15, 16).');

/* ---- the trail ---------------------------------------------------------------- */
console.log('--- the trail');
const trail = psql(`
select string_agg(l.what || ' ' || case l.owner when '${FOUNDER}' then 'Fenna' when '${OWNER}' then 'Osric' else l.owner::text end
                  || coalesce(' ' || (select p.name from player p where p.world_id = l.world_id and p.uid = l.whom), ''), ', ' order by l.n)
  from private.owner_log l where l.world_id = '${KEEP}';`);
check('every door that did something wrote it down, in order',
  trail === 'online Fenna, move Osric Stig, move Fenna Dray, mute Osric Stig, online Osric, mute Osric Stig, mute Fenna Stig, unmute Fenna Stig, clear Osric',
  trail);
check('a second look soon after the first is counted on the first one\'s row',
  psql(`select count(*) || ',' || max(detail->>'looks') || ',' || max(detail->>'people') from private.owner_log
         where world_id = '${KEEP}' and what = 'online' and owner = '${FOUNDER}';`) === '1,2,5',
  psql(`select string_agg(detail::text, ' ; ') from private.owner_log where world_id = '${KEEP}' and what = 'online';`));
const moveNote = psql(`select detail::text from private.owner_log where world_id = '${KEEP}' and what = 'move' and whom = '${STUCK}';`);
check('with where from, where to and what was stopped',
  moveNote.includes('"from": {"x": 3.5, "y": 28.5, "level": 0}') && moveNote.includes('"to": {"x": 20.5, "y": 22.5}')
    && moveNote.includes('"stopped": "dig"') && moveNote.includes('"queued": 2'), moveNote);
check('and what went off the ground',
  psql(`select detail->>'stacks' || ',' || (detail->>'things') || ',' || (detail->>'inside') from private.owner_log where world_id = '${KEEP}' and what = 'clear';`) === '3,6,2');
check('the other island\'s looks are on its own trail',
  psql(`select string_agg(what || ' ' || case owner when '${OWNER}' then 'Osric' when '${OTHER}' then 'Otto' else owner::text end, ', ' order by n) from private.owner_log where world_id = '${THERE}';`)
    === 'online Osric, online Otto');
check('and nobody who was refused wrote anything',
  psql(`select count(*) from private.owner_log where owner in (${list([NOBODY, PLAYER, STRANGER, STUCK, DRIFTER])});`) === '0');

/* ---- what a browser cannot see -------------------------------------------------- */
console.log('--- out of reach');
for (const table of ['private.island_owner', 'private.island_mute', 'private.owner_log']) {
  const r = as(PLAYER, `select count(*) from ${table};`);
  check(`${table} cannot be read from a browser`, r.err.includes('permission denied'), r.err || r.out);
}
const helpers = psql(`
select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'private' and p.proname in ('is_island_owner', 'muted_why', 'owner_note', 'mute_ends', 'mute_shuts', 'move_stops')
   and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));`);
check('and none of the helpers can be called from one', helpers === '', helpers);

/* ---- the words ---------------------------------------------------------------- */
console.log('--- the words');
const SPANS = [0, 1, 29, 30, 59, 60, 89, 90, 91, 150, 3599, 3600, 3629, 3630, 5400, 11520, 86399, 86400, 90000, 172800, 200000];
const island = psql(`select string_agg(time_words(s), '|' order by o) from unnest(array[${SPANS.join(', ')}]) with ordinality u(s, o);`);
check('a length of time is the same words on both sides', island === SPANS.map(awayFor).join('|'),
  `${island} | ${SPANS.map(awayFor).join('|')}`);
check('the mute menu offers what MUTE_FOR holds, in those words',
  MUTE_FOR.map(muteLabel).join(', ') === MUTE_FOR.map((s) => (s === null ? 'Until lifted' : `For ${awayFor(s)}`)).join(', '),
  MUTE_FOR.map(muteLabel).join(', '));
check('and somebody just heard from is heard from just now', heardLine(12) === 'heard from just now');

psql(CLEAN);
for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the island's keepers — ${ok.length} of ${ok.length}`);
