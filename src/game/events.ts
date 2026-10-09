/**
 * What sort of line it is, which is the tab of the log it lands on. `fight`
 * is every blow given and taken, what is coming for you, and what went down:
 * asked for as a combat log, and the island files its own lines the same way.
 */
export type LogKind = 'info' | 'event' | 'skill' | 'error' | 'chat' | 'system' | 'fight';

export interface LogEntry {
  time: number;
  text: string;
  kind: LogKind;
}

/**
 * A spell somebody cast, for the renderer to draw: which, by whom -- `by` a
 * peer's id, or null for you -- and at what. Raised when the island said yes
 * to your own cast, and when somebody else's browser says it said yes to
 * theirs (`Island.castSeen`). Only drawn: nothing in the game reads it.
 */
export interface CastSeen {
  spell: string;
  by: number | null;
  at: CastAt;
  /** The caster's companion, by its creature id, when they have one out: what a Beastmaster's spells act through. */
  companion?: number;
  /**
   * Where the caster stood before the cast, when the island moved them for it
   * (a Lunge strides up to four tiles, a Parting Throw steps back): drawn
   * carried from there rather than jumping.
   */
  from?: { x: number; y: number };
  /**
   * Where the creature it was cast at stood before the cast, when the island moved it for it (a Hook drags it in):
   * drawn carried from there over the cast (`cast.pull`) rather than jumping. Your own casts only.
   */
  targetFrom?: { x: number; y: number };
  /** What the island said the cast did (`CastTold`); left out by an island from before it, and for a cast drawn from the console. */
  told?: CastTold;
}

/**
 * What the island said a cast did, for drawing it as it went rather than from
 * the spell's own numbers and whatever stands near: who it reached, the
 * seconds what it left lasts on each and whether it holds them still; the
 * caster's waiting spells it spent (a Stoke, a Thicken); the largest skin it
 * laid or the skin a Ward Burst broke, as a share of health; and an Execute's
 * on a creature below its line.
 */
export interface CastTold {
  hit: CastHit[];
  used?: string[];
  size?: number;
  low?: boolean;
}
/** One that a cast reached: a creature, you or somebody else (never `spot`), how long what it left lasts on them, and whether it holds them still. */
export interface CastHit {
  at: CastAt;
  secs?: number;
  held?: boolean;
}
/**
 * Something of a spell's that fired after its cast, on its own: a Ward Link
 * laying a skin back over somebody. `by` the caster, a peer's id or null for
 * you; `on` whom; `size` how large, as a share of health.
 */
export interface CastFired {
  spell: string;
  by: number | null;
  on: CastAt;
  size?: number;
}
/** What a spell was cast at, as it is drawn: the caster, you, somebody else, a creature, or a spot on the ground. */
export type CastAt =
  | { kind: 'self' }
  | { kind: 'you' }
  | { kind: 'peer'; id: number; uid?: string }
  | { kind: 'creature'; id: number }
  | { kind: 'spot'; x: number; y: number };

export type GameEvents = {
  /** A spell was cast, by you or by somebody in sight: see `CastSeen`. */
  cast: [seen: CastSeen];
  /** Something of a spell's fired after its cast, by you or by somebody in sight: see `CastFired`. */
  castFired: [fired: CastFired];
  log: [entry: LogEntry];
  inventory: [];
  skill: [id: string, gain: number];
  /** A journal goal has just been ticked off. */
  journal: [];
  action: [];
  stats: [];
  world: [x: number, y: number];
  crate: [];
  smelter: [];
  creature: [];
  /** A page of the field guide took a mark: a kind seen, tamed or bred. */
  guide: [];
  /**
   * Something was hurt, somewhere. Carried so the renderer can put a number
   * over it without having to go looking for what changed; the log says what
   * happened in words, this says where to write it.
   */
  hit: [x: number, y: number, amount: number, kind: 'dealt' | 'taken' | 'crit'];
  /**
   * A turn of work landed somewhere: a swing of the pickaxe, a pass of the
   * file, one of a hundred repetitions. Carried so the renderer can show the
   * effort where the effort is going.
   */
  strike: [x: number, y: number];
  /**
   * The same go, said again for the ear rather than the eye.
   *
   * `strike` is where the effort went and is only ever raised for work done
   * out in the world, because dust in the air over your own hands would be
   * wrong. Sound has the opposite need: filing a nail is one of the noisiest
   * things a person does and it happens nowhere but where you are standing.
   * So this one is raised for every go at every job, positioned at the
   * target when there is one and at the body when there is not, and it
   * carries what the go sounded like.
   */
  work: [x: number, y: number, stroke: string];
  reset: [];
};

type Handler<T extends unknown[]> = (...args: T) => void;
type AnyHandler = (...args: unknown[]) => void;

/** Minimal typed event emitter used to keep the UI decoupled from the game. */
export class Emitter<E extends Record<string, unknown[]>> {
  private map = new Map<keyof E, Set<AnyHandler>>();

  on<K extends keyof E>(name: K, fn: Handler<E[K]>): () => void {
    let set = this.map.get(name);
    if (!set) {
      set = new Set();
      this.map.set(name, set);
    }
    const handler = fn as unknown as AnyHandler;
    set.add(handler);
    return () => set?.delete(handler);
  }

  emit<K extends keyof E>(name: K, ...args: E[K]): void {
    const set = this.map.get(name);
    if (!set) return;
    for (const fn of set) fn(...args);
  }
}

/**
 * The events that are about a *person* rather than about the island.
 *
 * Everything listening to these — the inventory window, the skill list, the
 * action bar, the floating numbers — is showing the person sitting at this
 * screen. When the game is acting as somebody else, on a host running a
 * guest's work, these must not fire: the host's inventory window has no
 * business flashing because a visitor picked up a stone.
 *
 * The island's own news — a tile changed, a crate changed, a creature moved —
 * is everybody's and goes out whoever is acting.
 */
const PERSONAL = new Set(['log', 'inventory', 'skill', 'action', 'stats', 'journal']);

/**
 * An emitter that knows the difference. One gate here rather than a condition
 * at forty call sites, half of which live in other files and would be missed.
 */
export class GameEmitter extends Emitter<GameEvents> {
  /** Whether the game is acting as the person at this screen. Set by the game. */
  mine: () => boolean = () => true;

  override emit<K extends keyof GameEvents>(name: K, ...args: GameEvents[K]): void {
    if (PERSONAL.has(name as string) && !this.mine()) return;
    super.emit(name, ...args);
  }
}
