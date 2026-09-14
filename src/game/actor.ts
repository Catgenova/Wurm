import type { ActionDef, Target } from './actions';
import { Inventory, type Item, type UidWell } from './items';
import type { LogKind } from './events';
import { Player, type PlayerSave } from './player';
import { Skills } from './skills';
import type { PeerId } from '../net/protocol';

/**
 * One person on the island: a body, a pack, and whatever they are in the
 * middle of doing.
 *
 * ## Why it is not a rewrite
 *
 * `game.player`, `game.inventory` and `game.skills` are read in a thousand
 * places — a thousand and forty-four of them, counted. Threading a "who" down
 * through every one of those is not a refactor, it is a different program, and
 * it would break every action in the game on the way past.
 *
 * So instead of changing what those names mean everywhere, the game changes
 * **who they point at**. `Game.as(actor, fn)` swaps the three names for the
 * length of one call and swaps them back; everything inside reads exactly what
 * it always read and gets the right person's arms. A guest's dig runs through
 * the very same `perform` the host's dig runs through, with the guest's
 * shovel, the guest's skill and the guest's stamina, because for the length of
 * that call the guest is who `g.player` is.
 *
 * The swap is synchronous, always undone in a `finally`, and nothing anywhere
 * holds on to `game.player` across a call — which was checked before any of
 * this was written, and is the one thing that would quietly break it.
 *
 * ## What is one per person and what is one per island
 *
 * Here: the body, the pack, the skills, the job in hand and the queue behind
 * it, and the two little clocks that belong to a body rather than to a world
 * (how long you have been swimming, when you were last warned about drowning).
 *
 * Not here: the land, the creatures, the buildings, the weather, the time of
 * day. Those are the island, there is one of it, and the host owns it.
 *
 * Not here either, deliberately: the **fog**. What you have walked is yours
 * and is tracked on your own machine. The host does not know, or need to know,
 * which corners of the island its guests have seen.
 */
export interface ActiveAction {
  def: ActionDef;
  target: Target;
  state: 'walking' | 'performing';
  elapsed: number;
  duration: number;
  /** Standing still until this time, waiting for a called wildermon to arrive. */
  waitUntil?: number;
  /** Goes left, when a number was asked for; undefined runs until the wind goes. */
  left?: number;
  /** How many were asked for, for saying so when it is done. */
  goes?: number;
}

/** Where somebody's news goes. The local player's goes on screen; a guest's goes home. */
export type Hearer = (text: string, kind: LogKind) => void;

export class Actor {
  /** What they are in the middle of, and what is lined up behind it. */
  action: ActiveAction | null = null;
  queue: Array<{ def: ActionDef; target: Target; goes?: number }> = [];
  /** Clocks that belong to a body: time spent swimming, and the last warning given. */
  swimClock = 0;
  drownWarning = 0;
  /** How far this body went on its last turn, in tiles: what a cart is hauled by. */
  stepped = 0;
  /** Told whenever something happens to them. */
  hear: Hearer = () => {};
  /** Told when their pack changes, so their own screen can look again. */
  packed: () => void = () => {};

  constructor(
    /** Who they are on the wire. The host is 0; single player is 0 as well. */
    readonly id: PeerId,
    /**
     * Who they are across sessions: a name their own machine keeps and hands
     * over on arrival. The wire id is handed out fresh every time somebody
     * connects, so an island that filed its visitors by it would greet
     * everybody as a stranger every evening.
     */
    readonly who: string,
    readonly player: Player,
    readonly inventory: Inventory,
    readonly skills: Skills,
  ) {}

  get name(): string {
    return this.player.name;
  }

  /**
   * Somebody new, arriving with nothing but their name.
   *
   * What a guest starts with is a decision, not an accident. They come with
   * empty hands and the skills anybody starts with, because the alternative —
   * arriving wearing a copy of the host's pack — hands out the host's tools to
   * everyone who knocks.
   */
  static arriving(id: PeerId, who: string, name: string, x: number, y: number, uids: UidWell): Actor {
    const player = new Player(x, y);
    player.name = name;
    // The island's well of item numbers, not a copy of where it had got to:
    // two guests counting from the same number hand out the same item twice.
    const inventory = new Inventory([], uids);
    return new Actor(id, who, player, inventory, new Skills());
  }
}

/** Everything of a visitor's that outlives their visit, as the island writes it down. */
export interface GuestSave {
  /** The durable name they keep on their own machine. */
  who: string;
  body: PlayerSave;
  items: Item[];
  skills: Record<string, number>;
  /** When they were last here, so a host can tell an old hand from a stranger. */
  seen: number;
}
