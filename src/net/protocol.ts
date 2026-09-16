import type { Look } from '../game/look';
import type { Target } from '../game/actions';

/**
 * What one island says to another.
 *
 * ## Why it is shaped like this
 *
 * There are two honest ways to run a world across several machines. In
 * **lockstep** every machine runs the same simulation and they exchange only
 * inputs, which is cheap on the wire and demands that every float operation on
 * every machine agree forever. This island has creature minds, decay timers,
 * weather and a hundred `rand()` calls threaded through three and a half
 * thousand lines of game; making all of that agree bit for bit across two
 * browsers is a rebuild, not a feature.
 *
 * So: **one machine is the island**. The host runs the only simulation there
 * is. Everyone else says what they would like to do and is told what happened.
 * A client that is wrong is wrong for one frame and then corrected, rather
 * than drifting quietly into a different world.
 *
 * ## Why the messages are shaped like the save file
 *
 * The save already cuts the world along exactly the seams the network needs:
 * the **land** (heights, tiles, rock — big, and the same for everyone), the
 * **world** (creatures, buildings, crates, the clock — small, and shared), and
 * the **fog** (what one person has seen — not shared at all, because two
 * people have walked different ground). A join is the first two; a session is
 * a stream of changes to the second; the third never leaves the machine it
 * belongs to.
 *
 * Nothing here is a network yet. This is the contract every layer above and
 * below is written against, so that the day a real connection is plugged in,
 * nothing above it has to change.
 */

/** Bumped whenever a message changes shape. A mismatch is refused at the door. */
export const PROTOCOL = 1;

/** Who someone is for the length of a session. The host is always 0. */
export type PeerId = number;
export const HOST_ID: PeerId = 0;

/** How often the host tells everyone where everyone is, in times a second. */
export const MOVE_HZ = 12;

/** How long a peer may say nothing at all before it is taken as gone, in seconds. */
export const TIMEOUT = 15;

/** Where somebody is and what they look like doing it. */
export interface PeerState {
  id: PeerId;
  name: string;
  /**
   * Who they are to the island, when there is an island.
   *
   * `id` is a hash: it tells two people apart on screen and is no use for
   * naming one to a door. Inviting somebody to your deed, asking to be their
   * friend or writing to them all want the uid the island knows them by, and
   * the only place the browser ever had it was the row it threw away building
   * this. Absent between two browsers talking to each other, which have no
   * island and no uids.
   */
  uid?: string;
  x: number;
  y: number;
  /** Facing, in world space; the renderer turns it into a screen side. */
  dirX: number;
  dirY: number;
  /** Storey they stand on. */
  level: number;
  moving: boolean;
  swimming: boolean;
  /** Mid-action, so they are drawn working rather than standing. */
  working: boolean;
  /** Dyed cloth, so people are told apart by more than a name over their head. */
  tunic?: string;
  trousers?: string;
  /**
   * Who they are to look at. Sent as the eight ids rather than as colours, so
   * that what arrives from somebody else's machine and goes into `fillStyle`
   * on this one cannot be anything but an entry in a table we wrote.
   */
  look?: Look;
}

/**
 * The land: big, sent once, identical for everyone.
 *
 * Six megabytes of it for a thousand-tile island, and it is the one message
 * that will ever be that size. It goes down the wire **gzipped**, which the
 * browser does itself and which this land is unusually good for: heights climb
 * smoothly and tiles repeat for acres, so it comes down by about four fifths.
 * `zip` says whether it did, so an island packed by a build without it still
 * unpacks.
 */
export interface LandBlob {
  size: number;
  zip: boolean;
  heights: string;
  tiles: string;
  data: string;
  dirt: string;
  rock: string;
}

/** Everything a client is told when it arrives. */
export interface Welcome {
  t: 'welcome';
  protocol: number;
  /** Who the newcomer is. */
  you: PeerId;
  /** What the island is called, and who keeps it. */
  island: string;
  host: string;
  land: LandBlob;
  /** The world as the save writes it, minus anything belonging to one person. */
  world: unknown;
  /** Where a newcomer starts. */
  spawn: { x: number; y: number };
  peers: PeerState[];
}

/** Anything the host says. */
export type FromHost =
  | Welcome
  | { t: 'refused'; why: string; protocol: number }
  /** Somebody arrived, left, or was renamed. */
  | { t: 'peers'; peers: PeerState[] }
  /** Where everyone is, sent on a beat. The common case, so it is kept small. */
  | { t: 'moved'; at: number; peers: PeerState[] }
  /** One tile changed: the delta stream the world already emits for its own sake. */
  | { t: 'tile'; x: number; y: number; tile: number; data: number; corners: number[] }
  /** Something happened that belongs in the log. */
  | { t: 'said'; from: PeerId; name: string; text: string; kind: string }
  /**
   * Your own pack, as the island has it.
   *
   * A guest's hands are on the host's machine, because that is where the
   * island is: their dig runs there, their ore goes into their pack there.
   * This is how they find out. It is the one message that is about one person
   * and goes to that person only.
   */
  | { t: 'pack'; items: unknown[]; skills: Record<string, number>; stats: unknown; nextUid: number }
  /** The clock, so a client's day is the host's day. */
  | { t: 'clock'; time: number }
  | { t: 'pong'; at: number };

/**
 * Anything a client says.
 *
 * ## Who moves a body
 *
 * Everybody moves their own. A client walks itself and tells the host where it
 * ended up; the host passes that on and does not argue with it. The alternative
 * — the host walking everybody from held directions — is what a game played
 * against strangers needs, because a client that moves itself can move itself
 * through a wall. This is a game you host for people you know, and the cost of
 * the strict version is a second mover, a second set of collision rules, and
 * every remote body a quarter of a second behind its own keyboard.
 *
 * The world is the other way about entirely. Nothing a client says changes the
 * island: `do` is a request, the host runs it or refuses it, and what comes
 * back is what happened. That is where authority is worth its cost, because
 * that is where two people reach for the same ore.
 */
export type FromClient =
  | {
      t: 'hello';
      protocol: number;
      name: string;
      /**
       * Who I am across visits: a name my own machine keeps. The number I am
       * given when I connect is handed out fresh every time, so an island that
       * filed its visitors by it would greet everybody as a stranger every
       * evening. This is what a returning guest is recognised by.
       */
      who: string;
    }
  /** Where I am now, and what I look like being there. */
  | { t: 'at'; body: Omit<PeerState, 'id' | 'name'> }
  /** Ask to do something. The host decides whether it happens. */
  | { t: 'do'; action: string; target: Target; times?: number }
  | { t: 'say'; text: string }
  | { t: 'ping'; at: number };

export type Message = FromHost | FromClient;

const KNOWN = new Set(['welcome', 'refused', 'peers', 'moved', 'tile', 'said', 'pack', 'clock', 'pong', 'hello', 'at', 'do', 'say', 'ping']);

/**
 * On the wire. JSON, because everything the game already saves is JSON and a
 * dozen people moving is a few hundred bytes a beat; the one big message is
 * the land, which is base64 in the save for the same reason. Binary is an
 * optimisation for later and not a change to anything above.
 */
export const encode = (m: Message): string => JSON.stringify(m);

/**
 * Off the wire, and never trusted. Anything that arrives came off somebody
 * else's machine, so it is checked for being an object carrying a tag this
 * build knows before a single field of it is read.
 */
export function decode(raw: string): Message | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const t = (parsed as { t?: unknown }).t;
  return typeof t === 'string' && KNOWN.has(t) ? (parsed as Message) : null;
}

/** Strip anything that would not survive being written on a screen. */
const STRIP = new RegExp('[\\u0000-\\u001f\\u007f]', 'g');

/** A name somebody typed, made safe to show to everyone else. */
export const cleanName = (raw: string): string => raw.replace(STRIP, '').trim().slice(0, 20) || 'Wanderer';

/** A durable name for a machine, made safe to use as a key. */
export const cleanWho = (raw: string): string => raw.replace(STRIP, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

/**
 * The name this machine goes by on other people's islands. Made once and kept,
 * so that coming back to an island you have visited is coming back rather than
 * arriving.
 */
export function myWho(): string {
  const KEY = 'wurm.who';
  try {
    const had = localStorage.getItem(KEY);
    if (had) return cleanWho(had);
    const made = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, made);
    return made;
  } catch {
    // A browser that will not remember anything gets a new name every time,
    // which means every visit is a first visit. Better than not connecting.
    return `w${Math.random().toString(36).slice(2, 14)}`;
  }
}

/** Something somebody typed, made safe to show to everyone else. */
export const cleanText = (raw: string): string => raw.replace(STRIP, ' ').trim().slice(0, 240);
