/**
 * What is left behind on the water.
 *
 * Anything crossing open water — a hull under sail, a swimmer, a wildermon
 * that has waded out of its depth — drags a wake. It is kept as a short trail
 * of points dropped every so many tiles travelled, and each point spreads and
 * fades on its own clock, so the shape behind a boat is the envelope of a
 * line of rings rather than a drawn V. Turn hard and the wake bends with you,
 * because the points are where you actually were.
 *
 * The trail is renderer state, not world state: it is never saved, and a
 * thing that stops leaves its wake to fade out behind it on its own.
 */
export interface WakePoint {
  x: number;
  y: number;
  /** When it was dropped. */
  at: number;
  /** How wide the thing that dropped it was, in tiles. */
  beam: number;
}

/** Seconds a wake stays on the water before it is gone. */
export const WAKE_LIFE = 3.6;

/** Tiles travelled between one point and the next. */
const WAKE_STEP = 0.34;

/** How many points one thing is allowed to leave, so a long voyage costs nothing. */
const WAKE_MAX = 24;

export class Wakes {
  private trails = new Map<string, WakePoint[]>();

  /** Note where something on the water is now. Points that are too close to the last one are dropped. */
  mark(id: string, x: number, y: number, now: number, beam: number): void {
    let trail = this.trails.get(id);
    if (!trail) {
      trail = [];
      this.trails.set(id, trail);
    }
    const last = trail[trail.length - 1];
    if (last && Math.hypot(last.x - x, last.y - y) < WAKE_STEP) return;
    trail.push({ x, y, at: now, beam });
    if (trail.length > WAKE_MAX) trail.shift();
  }

  /** Every trail still on the water, with what has faded out dropped as we go. */
  live(now: number): WakePoint[][] {
    const out: WakePoint[][] = [];
    for (const [id, trail] of this.trails) {
      while (trail.length && now - trail[0].at > WAKE_LIFE) trail.shift();
      if (!trail.length) {
        this.trails.delete(id);
        continue;
      }
      if (trail.length > 1) out.push(trail);
    }
    return out;
  }

  /** How far out a point has spread, in tiles, and how much of it is left. */
  static spread(p: WakePoint, now: number): { width: number; alpha: number } {
    const age = Math.max(0, Math.min(1, (now - p.at) / WAKE_LIFE));
    return { width: p.beam * (0.5 + age * 2.3), alpha: 0.3 * (1 - age) * (1 - age) };
  }

  /** Nothing is on the water any more: after a load, or a new world. */
  clear(): void {
    this.trails.clear();
  }
}
