import { BASE_SPEED } from '../game/player';

/**
 * How hard a thing is going.
 *
 * Every animal and every person on this island has had exactly one way of
 * moving its legs. `walkPhase` advances faster when you go faster — so a
 * horse at a gallop took the same steps as a body wading through marsh, only
 * more of them per second — and the shape of the cycle, the height of the
 * swing, the lift of the body were all fixed. A sprint was a walk on
 * fast-forward, which is the one thing a sprint is not.
 *
 * What is wanted is a single number saying how hard the thing is working, and
 * the honest way to get it is to watch it: how much ground it actually
 * covered, smoothed, rather than a flag somebody has to remember to set. That
 * works for the player, for other people, for a wildermon in the traces and
 * for a hunter running you down, with nothing added to any of them.
 *
 * 0 is an ordinary walk and 1 is a run. Above a run it stays 1, because there
 * is nothing past a flat run that a drawing can say.
 */

/** Speed at which a thing is judged to be running rather than walking. */
const RUN_SPEED = BASE_SPEED * 1.85;

/** And below which it is simply walking, however it got there. */
const WALK_SPEED = BASE_SPEED * 1.05;

/**
 * How fast the reading follows the truth, per second.
 *
 * Deliberately slow. A body pathing round a corner slows down and speeds up
 * several times a second, and a gait that answered every one of those would
 * flicker between a walk and a run while the thing was plainly doing neither.
 */
const EASE = 4;

export class Gaits {
  private seen = new Map<string, { x: number; y: number; v: number }>();

  /**
   * Note where something is, and say how hard it is going. Called once a
   * frame per body; anything not asked about for a while is forgotten, so a
   * herd that wanders out of the view costs nothing.
   */
  of(id: string, x: number, y: number, dt: number): number {
    const had = this.seen.get(id);
    if (!had) {
      this.seen.set(id, { x, y, v: 0 });
      return 0;
    }
    // A jump — a body teleported home, a peer's position snapping after a gap
    // in the wire — is not a sprint. Anything past a tile in one frame is
    // read as a move rather than as speed.
    const gone = Math.hypot(x - had.x, y - had.y);
    const raw = dt > 0 && gone < 1 ? gone / dt : had.v;
    const k = Math.min(1, EASE * dt);
    had.v += (raw - had.v) * k;
    had.x = x;
    had.y = y;
    return Math.max(0, Math.min(1, (had.v - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)));
  }

  /** Forget everything, for a world that has been put down and another taken up. */
  clear(): void {
    this.seen.clear();
  }

  /** Drop anything not asked about, so a map does not grow for ever. */
  keep(live: ReadonlySet<string>): void {
    if (this.seen.size <= live.size + 64) return;
    for (const id of [...this.seen.keys()]) if (!live.has(id)) this.seen.delete(id);
  }
}
