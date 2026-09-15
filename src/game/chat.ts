/**
 * Talking, and what the island will take.
 *
 * The event window has had a **Talk** tab and a box to type in since long
 * before there was an island, and on an island neither did anything: `say`
 * wrote a line into this browser's own log and stopped there. Two people
 * standing on the same tile could not tell each other so.
 *
 * What makes it a *global* chat rather than a local one is where it is kept.
 * `event` already has a row shape for "something that happened", a `uid`
 * column meaning *who it is for*, and a policy that reads
 *
 *     uid = auth.uid() or uid is null
 *
 * — so a row with no `uid` is already, exactly, a thing everybody on the
 * island may read. It is already published to Realtime, and the browser
 * already draws whatever arrives on it. A chat line is one of those rows with
 * `kind = 'chat'`, and the whole of the carrying was built months ago for
 * something else.
 *
 * Which leaves the two things that were missing: a door to speak through,
 * because nothing may write `event` directly, and a backlog, because a chat
 * you cannot scroll back through after a refresh is not persistent.
 */

/** As long a line as the island will take, and the box will let you type. */
export const SAY_MAX = 200;

/**
 * And how many lines a minute one person may say.
 *
 * Not the same thing as the general call budget, which is about load: twenty
 * calls a minute is nothing to a database and twenty lines a minute is a
 * person nobody else can get a word in past. This is about the window.
 */
export const SAY_A_MINUTE = 20;

/**
 * A line, as it will actually be kept.
 *
 * Newlines and tabs become spaces rather than being refused, because a phone
 * keyboard puts them in by accident and a line silently lost is worse than a
 * line tidied. Runs of whitespace collapse, so a wall of spaces cannot be used
 * to push the window about. The island cleans it again the same way — this is
 * the courtesy, that is the rule.
 */
export const cleanSaid = (raw: string): string =>
  raw.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, SAY_MAX);
