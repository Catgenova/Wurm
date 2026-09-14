import { decode, encode, type Message } from './protocol';

/**
 * How bytes get from one island to another.
 *
 * Everything above this line is written against the interface and nothing
 * else, which is the whole point of it being here: the sessions do not know
 * whether they are talking down a data channel, down a socket, or to another
 * tab on the same machine. Plugging in a real connection later is writing one
 * more class in this file.
 *
 * The one that exists today is the **loopback**, a pair of ends wired to each
 * other in memory. It is not a stand-in for a network — it is how the whole
 * stack above is run and tested without one, and it is the only way to be sure
 * the join handshake and the state stream are right before any of the
 * difficulty of getting two browsers to find each other is added.
 */
export type LinkState = 'opening' | 'open' | 'closed';

export interface Transport {
  readonly state: LinkState;
  /** Called with every message that arrives, already off the wire and checked. */
  onMessage(fn: (m: Message) => void): void;
  /** Called once, when the link goes down for any reason. */
  onClose(fn: (why: string) => void): void;
  send(m: Message): void;
  close(why?: string): void;
}

/** What a transport does with a message it could not deliver. */
export type Dropped = (m: Message, why: string) => void;

/**
 * One end of a pair. Anything sent at this end arrives at the other, next tick
 * rather than this one — a message that arrives inside the call that sent it
 * would let bugs hide that a real link would expose immediately.
 */
class LoopbackEnd implements Transport {
  state: LinkState = 'open';
  other: LoopbackEnd | null = null;
  private listeners: Array<(m: Message) => void> = [];
  private closers: Array<(why: string) => void> = [];
  /** Kept so a test can see exactly what crossed the wire, in order. */
  readonly sent: Message[] = [];

  constructor(
    readonly name: string,
    /** Seconds of delay in each direction, for trying the stack under a slow link. */
    private readonly lag = 0,
  ) {}

  onMessage(fn: (m: Message) => void): void {
    this.listeners.push(fn);
  }

  onClose(fn: (why: string) => void): void {
    this.closers.push(fn);
  }

  send(m: Message): void {
    if (this.state !== 'open' || !this.other) return;
    this.sent.push(m);
    // Round-tripped through the wire format even in memory, so that anything
    // which would not survive being written down — a function, a cycle, a
    // class instance — fails here rather than on the day of the first real
    // connection.
    const raw = encode(m);
    // Whose listeners, decided now rather than on arrival. A message handed to
    // an open wire arrives: a real link does not un-send what is already in
    // flight because the far end hung up a moment later, and a refusal that
    // the very hang-up it causes swallows is a bug that only shows up as
    // silence.
    const there = this.other;
    const to = [...there.listeners];
    const deliver = (): void => {
      const got = decode(raw);
      if (got) for (const fn of to) fn(got);
    };
    if (this.lag > 0) setTimeout(deliver, this.lag * 1000);
    else queueMicrotask(deliver);
  }

  close(why = 'closed'): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    for (const fn of this.closers) fn(why);
    const there = this.other;
    if (there && there.state !== 'closed') there.close(why);
  }
}

/** A pair of ends wired to each other: the host's end, and the client's. */
export function loopback(lag = 0): { host: Transport; client: Transport } {
  const a = new LoopbackEnd('host', lag);
  const b = new LoopbackEnd('client', lag);
  a.other = b;
  b.other = a;
  return { host: a, client: b };
}

/**
 * Everything a host is connected to at once, so it can say one thing to
 * everybody. Somewhere has to hold the list, and the host session has enough
 * to think about.
 */
export class Links {
  private readonly links = new Map<number, Transport>();

  add(id: number, link: Transport): void {
    this.links.set(id, link);
  }

  drop(id: number, why = 'dropped'): void {
    const link = this.links.get(id);
    this.links.delete(id);
    link?.close(why);
  }

  get(id: number): Transport | undefined {
    return this.links.get(id);
  }

  get size(): number {
    return this.links.size;
  }

  ids(): number[] {
    return [...this.links.keys()];
  }

  /** To one peer. Quietly does nothing for a peer that has already gone. */
  to(id: number, m: Message): void {
    const link = this.links.get(id);
    if (link && link.state === 'open') link.send(m);
  }

  /** To everyone, or to everyone but one — which is usually what you want, since the one already knows. */
  all(m: Message, except?: number): void {
    for (const [id, link] of this.links) {
      if (id === except) continue;
      if (link.state === 'open') link.send(m);
    }
  }

  closeAll(why = 'closed'): void {
    for (const link of this.links.values()) link.close(why);
    this.links.clear();
  }
}
