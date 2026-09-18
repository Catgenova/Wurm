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

export type GameEvents = {
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
  /**
   * Something was hurt, somewhere. Carried so the renderer can put a number
   * over it without having to go looking for what changed; the log says what
   * happened in words, this says where to write it.
   */
  hit: [x: number, y: number, amount: number, kind: 'dealt' | 'taken'];
  /**
   * A turn of work landed somewhere: a swing of the pickaxe, a pass of the
   * file, one of a hundred repetitions. Carried so the renderer can show the
   * effort where the effort is going.
   */
  strike: [x: number, y: number];
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
