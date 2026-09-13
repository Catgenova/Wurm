export type LogKind = 'info' | 'event' | 'skill' | 'error' | 'chat' | 'system';

export interface LogEntry {
  time: number;
  text: string;
  kind: LogKind;
}

export type GameEvents = {
  log: [entry: LogEntry];
  inventory: [];
  skill: [id: string, gain: number];
  action: [];
  stats: [];
  world: [x: number, y: number];
  crate: [];
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
