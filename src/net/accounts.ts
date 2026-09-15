import { cleanLook, type Look } from '../game/look';
import { supabase } from './supabase';

/**
 * Accounts: a username, a password, and nothing else.
 *
 * ## Why the username is an e-mail address
 *
 * Supabase Auth signs people in by address. There is no address here — nobody
 * is being asked for one and nobody is being sent anything — so the username
 * becomes one:
 *
 *     alice  ->  alice@players.wurm.invalid
 *
 * `.invalid` is reserved by RFC 2606 and can never be delegated to anybody, so
 * that address is guaranteed to reach no one, forever. What it buys is that
 * signing up **is** the reservation: the unique index Auth already keeps over
 * its own addresses is the index that makes a name yours, so there is no
 * window between "free when I looked" and "mine now" for a second browser to
 * get into. No lock, no retry, and no second authority to disagree with the
 * first.
 *
 * What it costs is written down where it will be read rather than hidden here:
 * an address that reaches no one cannot carry a reset link, so **a forgotten
 * password is a lost account**. The page says so before you choose one.
 *
 * ## Where each rule is actually enforced
 *
 * Everything in this file runs in the browser, and a check in the browser is a
 * courtesy to the honest rather than a control:
 *
 *   * The **shape of a name** is enforced again in Postgres, and the name a
 *     player carries is read back out of their own address by `rpc_my_name()`
 *     rather than taken from a client that could say anything.
 *   * The **eight characters** and the **breach check** cannot be: the
 *     password never reaches Postgres at all. Auth takes it, hashes it, and
 *     the database only ever learns that a row appeared. The settings that
 *     make those two real live in the project's Auth configuration, and
 *     `supabase/migrations/20260915025000_accounts.sql` names them.
 */

/** The suffix a username wears so that Auth has an address to sign in. */
const DOMAIN = '@players.wurm.invalid';
/** Three to twenty, a letter first. The same expression as `name_ok()` in SQL. */
const SHAPE = /^[a-z][a-z0-9_-]{2,19}$/;
/** Eight, as asked. */
export const PASSWORD_MIN = 8;
/**
 * And seventy-two, which nobody asked for but bcrypt imposes: it hashes the
 * first 72 bytes and silently ignores the rest, so a passphrase longer than
 * that is not the passphrase you think you chose. Refused rather than
 * truncated, because a password that quietly means something else is worse
 * than one that is turned down.
 */
export const PASSWORD_MAX = 72;

/** What the game will actually call you, given what you typed. */
export const foldName = (raw: string): string => raw.trim().toLowerCase();

/** The address a username signs in with. */
export const nameEmail = (name: string): string => foldName(name) + DOMAIN;

/** What is wrong with this name, in a sentence, or null if nothing is. */
export function nameTrouble(raw: string): string | null {
  const name = foldName(raw);
  if (!name) return 'A name, then.';
  if (name.length < 3) return 'Three letters at the least.';
  if (name.length > 20) return `Twenty at the most. That is ${name.length}.`;
  if (!/^[a-z]/.test(name)) return 'Start it with a letter.';
  if (!SHAPE.test(name)) return 'Letters, numbers, underscore and hyphen only.';
  return null;
}

/** What is wrong with this password, before anybody goes looking it up. */
export function passwordTrouble(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) {
    return `Eight characters at the very least — that is ${pw.length}.`;
  }
  if (new Blob([pw]).size > PASSWORD_MAX) {
    return `Seventy-two bytes is all the hashing looks at, so anything past it would be quietly thrown away. Shorten it.`;
  }
  return null;
}

/** Where the breach list lives. */
const BREACH_LIST = 'https://api.pwnedpasswords.com/range/';

/**
 * How many known breaches this password already turns up in.
 *
 * The password does not leave this browser and neither does its hash. The list
 * is queried by k-anonymity: SHA-1 the password, send the **first five hex
 * characters** of the digest and nothing else, get back every suffix that
 * shares that prefix — some hundreds of them — and do the matching here. The
 * far end learns that somebody, somewhere, has a password whose hash starts
 * with those five characters, which is true of roughly one password in a
 * million and identifies nobody.
 *
 * `Add-Padding` asks for the reply to be bulked out with decoy rows, so that
 * an observer who can see the size of an encrypted response cannot read the
 * number of real hits out of it. It costs a few kilobytes once — and it is
 * asked for rather than insisted on, for the reason below.
 *
 * Throws if the list cannot be reached. That is deliberate and the caller must
 * not swallow it: the instruction was to deny breached passwords, and a
 * password nobody could check is not a password anybody has cleared.
 */
export async function breachCount(password: string): Promise<number> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  const head = hash.slice(0, 5);
  const tail = hash.slice(5);
  let reply: Response;
  try {
    reply = await fetch(BREACH_LIST + head, { headers: { 'Add-Padding': 'true' } });
  } catch {
    /*
     * A custom header makes this a preflighted request, and a browser whose
     * preflight is refused reports it in exactly the same way as the network
     * being down: a bare TypeError with nothing in it. So ask again plainly.
     *
     * Losing the padding costs a few bits to somebody who can already measure
     * the size of a TLS response and wants to narrow down which of a million
     * prefix buckets was asked for; it tells them nothing about the password.
     * Turning an honest player away over a response header would cost rather
     * more, and there is no way to tell the two failures apart from in here.
     */
    reply = await fetch(BREACH_LIST + head);
  }
  if (!reply.ok) throw new Error(`the breach list answered ${reply.status}`);
  for (const line of (await reply.text()).split('\n')) {
    const cut = line.indexOf(':');
    if (cut < 0) continue;
    if (line.slice(0, cut).trim().toUpperCase() !== tail) continue;
    return Number(line.slice(cut + 1).trim()) || 0;
  }
  return 0;
}

/** A number of breaches, written the way it will be read. */
export const breachWord = (n: number): string =>
  n >= 1000000 ? `${Math.round(n / 1000000)} million known breaches`
  : n >= 1000 ? `${Math.round(n / 1000)} thousand known breaches`
  : n === 1 ? 'one known breach'
  : `${n} known breaches`;

/** Thrown when the breach list could not be reached, so the caller can offer a retry. */
export class Unchecked extends Error {}

/**
 * Everything wrong with this password, including what the breach list says.
 *
 * Fails closed. If the list cannot be reached this throws `Unchecked` rather
 * than shrugging and letting the password past, because "deny breached
 * passwords" and "deny breached passwords when the internet is cooperating"
 * are different instructions and only one of them was given.
 */
export async function passwordVerdict(pw: string): Promise<string | null> {
  const local = passwordTrouble(pw);
  if (local) return local;
  if (!globalThis.crypto?.subtle) {
    throw new Unchecked('This browser will not hash anything here, so the password cannot be checked against the breach list. That needs a secure connection — an https:// address, or localhost.');
  }
  let seen: number;
  try {
    seen = await breachCount(pw);
  } catch (e) {
    throw new Unchecked(`The breach list could not be reached (${e instanceof Error ? e.message : 'no answer'}), so this password cannot be cleared.`);
  }
  if (seen > 0) {
    return `That one is in ${breachWord(seen)}. Somebody else chose it first and it is on a list now. Pick another.`;
  }
  return null;
}

/** Is this name still going spare? A courtesy — signing up is what reserves it. */
export async function nameFree(name: string): Promise<boolean> {
  const { data, error } = await supabase().rpc('rpc_name_free', { p_name: foldName(name) });
  if (error) throw new Error(`Could not ask the island keeper: ${error.message}`);
  return data === true;
}

/**
 * Auth's own complaints, in this game's words.
 *
 * Auth speaks about e-mail addresses because that is what it thinks it was
 * given; nobody on the landing page typed an e-mail address, so being told
 * that one is already registered would be nonsense. Anything not recognised is
 * passed through as it came rather than flattened into "something went wrong",
 * which is the message that helps nobody.
 */
function inOurWords(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('already registered') || m.includes('already been registered')) return 'That name is taken. Try another.';
  if (m.includes('invalid login credentials')) return 'No account of that name with that password.';
  if (m.includes('password should be at least')) return `Eight characters at the very least.`;
  if (m.includes('email address') && m.includes('invalid')) {
    return 'The island keeper will not accept an address ending .invalid, which is what a username becomes here. Its Auth settings need that restriction lifted.';
  }
  if (m.includes('rate limit') || m.includes('too many')) return 'That is a lot of tries in a short time. Wait a minute and go again.';
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return 'The island keeper is not taking new accounts at the moment.';
  return message;
}

/** Made an account, and what to do about it if it only half happened. */
export interface Made {
  name: string;
  /** True when Auth made the account but will not sign you in until a mail is answered. */
  unconfirmed: boolean;
}

/**
 * Make the account.
 *
 * The name checks happen here for the message; the reservation happens inside
 * Auth, where a duplicate address is a unique-index violation and not a race
 * anybody can win. So a name that was free a moment ago and is taken now comes
 * back as "that name is taken" rather than as two people called alice.
 */
export async function createAccount(rawName: string, password: string): Promise<Made> {
  const name = foldName(rawName);
  const bad = nameTrouble(name);
  if (bad) throw new Error(bad);
  const worse = passwordTrouble(password);
  if (worse) throw new Error(worse);

  const sb = supabase();
  const { data, error } = await sb.auth.signUp({ email: nameEmail(name), password });
  if (error) throw new Error(inOurWords(error.message));
  /**
   * The quiet duplicate.
   *
   * With confirmations on, Auth answers a sign-up for an address that already
   * exists with a user that has no identities rather than with an error — it
   * is refusing to confirm or deny to a stranger. Here the name is public by
   * design, so that shrug is passed on as the plain fact it stands for.
   */
  if (data.user && (data.user.identities?.length ?? 1) === 0) throw new Error('That name is taken. Try another.');
  if (!data.user) throw new Error('The island keeper did not say whether the account was made.');
  if (!data.session) return { name, unconfirmed: true };

  await sb.rpc('rpc_my_name');
  return { name, unconfirmed: false };
}

/** Come back to an account that already exists. */
export async function signInAs(rawName: string, password: string): Promise<string> {
  const name = foldName(rawName);
  const sb = supabase();
  const { error } = await sb.auth.signInWithPassword({ email: nameEmail(name), password });
  if (error) throw new Error(inOurWords(error.message));
  await sb.rpc('rpc_my_name');
  return name;
}

/**
 * Who is signed in here, or null.
 *
 * Asks the island keeper rather than reading the address out of the stored
 * session, which would be the same string arrived at by a route where nothing
 * had to be true. Anonymous sessions have no name and answer null, which is
 * how the game tells "signed in as somebody" from "signed in as anybody".
 */
export async function whoAmI(): Promise<string | null> {
  const sb = supabase();
  const had = await sb.auth.getSession();
  if (!had.data.session) return null;
  const { data, error } = await sb.rpc('rpc_my_name');
  if (error) return null;
  return typeof data === 'string' && data ? data : null;
}

/** Put the account down. The single-player game is still there without one. */
export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
}

/**
 * The face on the account, or null if nobody has chosen one yet.
 *
 * Null is the whole reason this exists: it is what sends a new account to the
 * creator and lets somebody coming back walk straight past it.
 */
export async function myLook(): Promise<Look | null> {
  const { data, error } = await supabase().rpc('rpc_my_look');
  if (error || data === null || data === undefined) return null;
  return cleanLook(data);
}

/**
 * Choose one.
 *
 * What comes back is what was stored, not what was sent: the island keeper
 * clamps every field against its own tables, so this returns the *cleaned*
 * look and the page draws that. Anything else and the mirror would be showing
 * a face nobody else would ever see.
 */
export async function setLook(look: Look): Promise<Look> {
  const { data, error } = await supabase().rpc('rpc_set_look', { p_look: look });
  if (error) throw new Error(`The island keeper would not take that face: ${error.message}`);
  return cleanLook(data);
}
