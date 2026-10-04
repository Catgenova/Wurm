import type { FaithSaid, Island } from '../net/island';

/**
 * Your faith as the island last said it, shared by the Faith window and the
 * spell bar so that neither asks twice and a choice made in one shows in the
 * other at once.
 *
 * Every faith door answers with the whole of it (`faith_said`), so a choice
 * is one round trip: the answer replaces what is held and everybody listening
 * redraws. A refusal comes back as `why` alone and replaces nothing.
 *
 * Playing by yourself in the browser there is no island to keep a patron, and
 * this holds nothing.
 */
export class FaithBook {
  said: FaithSaid | null = null;
  /** When `said` came, by the page's clock, so a spell's rest can be counted down between answers. */
  private at = 0;
  private asking = false;
  private readonly listeners = new Set<() => void>();

  constructor(readonly island: Island | null) {}

  /** Told whenever what is held changes. */
  on(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Ask the island again, unless an ask is already out. */
  async ask(): Promise<void> {
    if (!this.island || this.asking) return;
    this.asking = true;
    try {
      this.take(await this.island.faith());
    } finally {
      this.asking = false;
    }
  }

  async takePatron(id: string): Promise<string | null> {
    return this.answer(this.island ? await this.island.takePatron(id) : null);
  }

  async takeSpell(id: string): Promise<string | null> {
    return this.answer(this.island ? await this.island.takeFaithSpell(id) : null);
  }

  async setSlot(slot: number, spell: string | null): Promise<string | null> {
    return this.answer(this.island ? await this.island.setSpellSlot(slot, spell) : null);
  }

  /** Call the spell in a slot. The island's sentence for what it did goes to the log by itself; this returns only a refusal. */
  async cast(slot: number, target: Record<string, unknown>): Promise<string | null> {
    return this.answer(this.island ? await this.island.castSpell(slot, target) : null);
  }

  /** Seconds before a spell can be called again, counted down since the last answer. */
  restLeft(id: string): number {
    const r = this.said?.rest[id] ?? 0;
    return Math.max(0, r - (performance.now() - this.at) / 1000);
  }

  private answer(s: FaithSaid | null): string | null {
    if (!s) return this.island ? 'The island did not answer.' : 'Playing by yourself there is no island to keep a patron.';
    if (s.why) return s.why;
    this.take(s);
    return null;
  }

  private take(s: FaithSaid | null): void {
    if (!s || s.why) return;
    this.said = s;
    this.at = performance.now();
    for (const fn of this.listeners) fn();
  }
}
