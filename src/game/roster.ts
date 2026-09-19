import type { PeerId, PeerState } from '../net/protocol';
import { tileKey } from './tileindex';

/** Handed back for a tile nobody is standing on, so the common answer is free. */
const NOBODY: readonly Peer[] = [];

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
  /**
   * And which of the eight ways they are drawn turned, kept here for the same
   * reason: it is worked out from a heading that can sit on the line between
   * two of them, and it must not be re-decided from scratch every frame.
   */
  facing: number;
  /**
   * An emote they are part way through, and when it reached us.
   *
   * On the local clock, like `at` and for the same reason: an emote runs for a
   * second or two and is drawn frame by frame, so it has to be timed by the
   * clock the frames are timed by rather than by anybody else's.
   */
  emote?: string;
  emoteAt?: number;
  /**
   * The last thing they said out loud, and when it reached us.
   *
   * On the local clock like `emoteAt` and for the same reason: a bubble is
   * drawn frame by frame for a few seconds, so it has to be timed by the clock
   * the frames are timed by rather than by the hour the island stamped on the
   * line. A line caught up on after a quiet spell is not somebody talking now
   * and never reaches this.
   */
  said?: string;
  saidAt?: number;
}

/**
 * The words out of a chat line, without the name in front of them.
 *
 * Every line said on this island is written `<Name> the words`, by `rpc_say`
 * over there and by `say` here, so that the log reads as a conversation. A
 * bubble over somebody's head does not need their name in it — their name is
 * already drawn under the bubble — and a bubble that carries it is a bubble
 * half full of something you can read anyway.
 */
export const saidWords = (line: string): string => line.replace(/^<[^>]*>\s*/, '');

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
  /** Who is standing where, rebuilt once a frame by `ease`. */
  private byTile = new Map<number, Peer[]>();
  /** The tiles written to this frame, so the rest are left alone. */
  private filled: number[] = [];

  get size(): number {
    return this.peers.size;
  }

  list(): Peer[] {
    return [...this.peers.values()];
  }

  get(id: PeerId): Peer | undefined {
    return this.peers.get(id);
  }

  /**
   * Everyone standing on a given tile, for the renderer, which asks per tile.
   *
   * Filed rather than searched. This used to walk every peer on the island for
   * every tile on screen — two thousand tiles against twenty people is forty
   * thousand comparisons a frame to answer "nobody" forty thousand times. The
   * index is built once a frame in `ease`, which already walks all of them.
   */
  atTile(x: number, y: number): readonly Peer[] {
    return this.byTile.get(tileKey(x, y)) ?? NOBODY;
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
      this.peers.set(state.id, { ...state, at: now, fromX: state.x, fromY: state.y, span: 0, walkPhase: 0, facing: 1 });
      return;
    }
    const jumped = Math.hypot(state.x - had.x, state.y - had.y) > TELEPORT;
    had.fromX = jumped ? state.x : had.x;
    had.fromY = jumped ? state.y : had.y;
    // The gap actually observed rather than the one we hoped for: a link that
    // is running slow should be walked slowly, not walked fast and then waited.
    had.span = jumped ? 0 : Math.max(0.01, Math.min(1, now - had.at));
    had.at = now;
    Object.assign(had, { ...state, at: now, fromX: had.fromX, fromY: had.fromY, span: had.span, walkPhase: had.walkPhase, facing: had.facing });
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
    // The tile index goes with the easing: one walk of the list does both, and
    // the renderer asks `atTile` immediately afterwards.
    for (const key of this.filled) {
      const at = this.byTile.get(key);
      if (at) at.length = 0;
    }
    this.filled.length = 0;
    for (const p of this.peers.values()) {
      if (p.span > 0) {
        const t = Math.min(1, (now - p.at) / p.span);
        p.fromX += (p.x - p.fromX) * t;
        p.fromY += (p.y - p.fromY) * t;
        if (t >= 1) p.span = 0;
      }
      if (p.moving) p.walkPhase += dt * 11;
      const key = tileKey(Math.floor(p.x), Math.floor(p.y));
      let at = this.byTile.get(key);
      if (!at) {
        at = [];
        this.byTile.set(key, at);
      }
      if (!at.length) this.filled.push(key);
      at.push(p);
    }
  }

  /** Where somebody should be drawn this frame, which is not quite where they are. */
  drawnAt(p: Peer): [number, number] {
    return p.span > 0 ? [p.fromX, p.fromY] : [p.x, p.y];
  }

  /**
   * Somebody waved.
   *
   * Stamped on arrival rather than carried with the message: a sender's clock
   * is not ours, and an emote a second and a half long timed against a clock a
   * second out is an emote that is over before it is drawn.
   */
  emoted(id: number, emote: string): void {
    const p = this.peers.get(id);
    if (!p) return;
    p.emote = emote;
    p.emoteAt = clock();
  }

  /** Somebody said something out loud, for the bubble over their head. */
  spoke(id: number, text: string): void {
    const p = this.peers.get(id);
    if (!p) return;
    p.said = text;
    p.saidAt = clock();
  }
}
