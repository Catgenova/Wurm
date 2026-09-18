/**
 * Everybody you may write to, each of them once.
 *
 * Reported from the island, with a picture of the Letters tab: "private
 * messaging doubles up deedmates and friends". Four rows for two people —
 * catgenova, marcoroni, catgenova, marcoroni — which is two lists laid end to
 * end rather than one list of who there is.
 *
 * The three sources overlap by design. Your friends, the people off your own
 * land, and anybody who has written to you are three different questions with
 * the same answers in them, and somebody you befriended and then invited home
 * is in two of the three. The Friends tab had always folded them through a
 * `Set`; the Letters tab concatenated them, three lines away in one file.
 *
 * So it is a function now rather than a line inside the drawing, and this is
 * what asks it the question.
 */
import { neighbours, writeTo } from '../../src/ui/panels/social';
import type { Social } from '../../src/net/island';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const folk = (uid: string, name: string) => ({ uid, name, online: true });
const cat = folk('u-cat', 'catgenova');
const marco = folk('u-marco', 'marcoroni');
const stranger = folk('u-sten', 'sten');

/** The island's answer as it stood in the report: friends with both, living with both. */
const said = (over: Partial<Social> = {}): Social => ({
  friends: [cat, marco],
  deeds: [{ name: 'Lambfold', x: 5, y: 7, radius: 5, level: 1, founder: 'u-cat', by: 'catgenova', mine: false, folk: [cat, marco] }],
  here: [], invites: [], asked: [], asking: [], sent: [], unread: [], room: 0,
  ...over,
} as unknown as Social);

const both = writeTo(said());
check('a friend you also live with is one person', both.length === 2,
  `${both.length} rows for ${new Set(both.map((p) => p.uid)).size} people: ${both.map((p) => p.name).join(', ')}`);
check('and they keep the order they were asked in', both[0].uid === 'u-cat' && both[1].uid === 'u-marco',
  both.map((p) => p.name).join(' then '));

/* Somebody on two of your settlements is still one person. */
const twice = said({
  friends: [],
  deeds: [
    { name: 'Lambfold', x: 5, y: 7, radius: 5, level: 1, founder: 'u-cat', by: 'catgenova', mine: false, folk: [cat, marco] },
    { name: 'Southfold', x: 2, y: 13, radius: 1, level: 1, founder: 'u-cat', by: 'catgenova', mine: false, folk: [cat] },
  ],
} as unknown as Partial<Social>);
check('and so is somebody off two of your settlements', neighbours(twice).length === 2,
  `${neighbours(twice).length} of 2`);

/* Somebody merely ashore is not in it: the Letters tab is for people you
 * already have something to do with, and the window says so in as many words —
 * "anybody ashore can be written to from the Friends tab". */
check('somebody merely ashore is not on the list',
  writeTo(said({ friends: [], deeds: [], here: [stranger] } as unknown as Partial<Social>)).length === 0);

/* Somebody who has only ever written to you is in the list, once. */
const wrote = said({ friends: [], deeds: [], unread: [{ uid: 'u-sten', name: 'sten', n: 2 }] } as unknown as Partial<Social>);
check('a stranger who wrote to you is in it', writeTo(wrote).length === 1 && writeTo(wrote)[0].uid === 'u-sten',
  writeTo(wrote).map((p) => p.name).join(', ') || 'nobody');

/* And is not added a second time when they are already there. */
const wroteToo = said({ unread: [{ uid: 'u-cat', name: 'catgenova', n: 1 }, { uid: 'u-sten', name: 'sten', n: 1 }] } as unknown as Partial<Social>);
const all = writeTo(wroteToo);
check('and a friend who wrote is not added again', all.length === 3,
  `${all.length} rows: ${all.map((p) => p.name).join(', ')}`);

/* Nobody to write to is an empty list rather than a row with nothing in it. */
check('nobody is nobody', writeTo(said({ friends: [], deeds: [] } as unknown as Partial<Social>)).length === 0);

/* And the shape that was reported, counted the way the window draws it. */
const names = writeTo(said()).map((p) => p.name);
check('the reported list is two rows, not four',
  names.length === 2 && names.join(',') === 'catgenova,marcoroni', names.join(', '));

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} went wrong` : `\nall ${ok.length} right`);
process.exit(bad.length ? 1 : 0);
