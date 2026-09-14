import type { PeerId, PeerState } from '../net/protocol';

/**
 * The other people on the island.
 *
 * The game has exactly one `player`, and three and a half thousand lines are
 * written on that assumption — it is the thing the camera follows, the thing
 * actions are performed by, the thing whose hunger the clock eats. Turning
 * that one into a list is a rebuild and would be a poor way to start.
 *
 * So other people are kept apart from it, here. A peer is not a `Player`: it
 * has no inventory, no skills, no stamina, nothing the simulation reads. It is
 * a position, a name and a pose — everything needed to draw somebody and
 * nothing else, because on this machine nobody else's body is simulated. The
 * host's machine has the truth about all of them; every other machine has this.
 *
 * That line is worth keeping sharp. The day the local player becomes one of
 * many, it will be because this grew up to meet `Player`, not because `Player`
 * was scattered across the game.
 */
export interface Peer extends PeerState {
  /** When this was last heard about, on the local clock, for easing and for timing out. */
  at: number;
  /**
   * Where they were the last time we were told, so the gap between one word
   * and the next can be walked rather than jumped. Twelve times a second is
   * plenty to know where somebody is and nowhere near enough to watch them
   * walk.
   */
  fromX: number;
  fromY: number;
  /** How long that walk should take, in seconds: the gap actually observed. */
  span: number;
  /** Their own walk cycle, so their legs move at their own pace. */
  walkPhase: number;
}

/** How far out of step a peer must be before they are snapped rather than walked. */
const TELEPORT = 6;

/**
 * One clock, read here and nowhere else.
 *
 * Whoever notes that somebody moved and whoever walks them there have to be
 * reading the same clock, and they are called from opposite ends of the
 * program — a session on the network's beat, the renderer on the drawing beat,
 * which counts from the first frame rather than from the page. Taking the time
 * from a caller meant two clocks could be mixed with nothing to say so, and a
 * peer eased between a stamp from one and a reading from the other walks
 * briskly off the map.
 */
const clock = (): number => performance.now() / 1000;

/** The people on the island who are not you. */
export class Roster {
  private readonly peers = new Map<PeerId, Peer>();
  /** Who we are on this island. Zero is the host; -1 means nobody, which is single player. */
  self: PeerId = -1;

  get size(): number {
    return this.peers.size;
  }

  list(): Peer[] {
    return [...this.peers.values()];
  }

  get(id: PeerId): Peer | undefined {
    return this.peers.get(id);
  }

  /** Everyone standing on a given tile, for the renderer, which asks per tile. */
  atTile(x: number, y: number, out: Peer[]): Peer[] {
    out.length = 0;
    for (const p of this.peers.values()) {
      if (Math.floor(p.x) === x && Math.floor(p.y) === y) out.push(p);
    }
    return out;
  }

  /**
   * What we have just been told about somebody. Where they were becomes where
   * they are walking from, so the frames between one word and the next have
   * something to draw.
   */
  saw(state: PeerState): void {
    const now = clock();
    if (state.id === this.self) return;
    const had = this.peers.get(state.id);
    if (!had) {
      this.peers.set(state.id, { ...state, at: now, fromX: state.x, fromY: state.y, span: 0, walkPhase: 0 });
      return;
    }
    const jumped = Math.hypot(state.x - had.x, state.y - had.y) > TELEPORT;
    had.fromX = jumped ? state.x : had.x;
    had.fromY = jumped ? state.y : had.y;
    // The gap actually observed rather than the one we hoped for: a link that
    // is running slow should be walked slowly, not walked fast and then waited.
    had.span = jumped ? 0 : Math.max(0.01, Math.min(1, now - had.at));
    had.at = now;
    Object.assign(had, { ...state, at: now, fromX: had.fromX, fromY: had.fromY, span: had.span, walkPhase: had.walkPhase });
  }

  /** Everybody, in one word, replacing whoever is no longer in the list. */
  sawAll(states: PeerState[]): void {
    const seen = new Set<PeerId>();
    for (const s of states) {
      if (s.id === this.self) continue;
      seen.add(s.id);
      this.saw(s);
    }
    for (const id of [...this.peers.keys()]) if (!seen.has(id)) this.peers.delete(id);
  }

  gone(id: PeerId): void {
    this.peers.delete(id);
  }

  clear(): void {
    this.peers.clear();
    this.self = -1;
  }

  /**
   * Move everybody along the walk they were last seen on. Called once a frame
   * from the renderer's clock rather than the game's, since this is drawing
   * rather than simulation and should be smooth even when the world is paused.
   */
  ease(dt: number): void {
    const now = clock();
    for (const p of this.peers.values()) {
      if (p.span > 0) {
        const t = Math.min(1, (now - p.at) / p.span);
        p.fromX += (p.x - p.fromX) * t;
        p.fromY += (p.y - p.fromY) * t;
        if (t >= 1) p.span = 0;
      }
      if (p.moving) p.walkPhase += dt * 11;
    }
  }

  /** Where somebody should be drawn this frame, which is not quite where they are. */
  drawnAt(p: Peer): [number, number] {
    return p.span > 0 ? [p.fromX, p.fromY] : [p.x, p.y];
  }
}
