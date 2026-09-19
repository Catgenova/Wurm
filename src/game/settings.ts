/**
 * What the person sitting here likes, kept where the person is.
 *
 * Reported from the island: *"settings like the screen pan seem to reset each
 * refresh/session."*
 *
 * They did, and only on an island, which is the shape of half the bugs this
 * week. `main.ts` reads:
 *
 *     if (!island) warmSave();
 *     if (!island) { setTimeout(saveGame, 3000); setInterval(saveGame, 20000); }
 *
 * — an island session never saves and never loads. The settings rode the save
 * and nowhere else, so in the solo world they came back and on an island
 * `game.settings` was the constructor's defaults every single time somebody
 * opened the page.
 *
 * They do not belong in a save at all. `Keybinds` says why, and the window
 * layout says it too: this is a fact about the person sitting here, not about
 * the island. Carrying it in a save means a keyboard — or a camera, or the
 * edge pan — changing under you when you load somebody else's world, and
 * losing it entirely the moment the world is somebody else's to keep.
 *
 * So: `localStorage`, beside the keys and the windows, written the moment
 * anything changes.
 */

const KEY = 'wurm.settings.v1';

/** Everything that is a preference, and their out-of-the-box answers. */
export const SETTING_DEFAULTS = {
  grid: true,
  /** Which of the eight ways round the camera is turned. */
  rotation: 0,
  deedBorder: true,
  /** Hide walls standing between the viewer and the inside of a building. */
  cutaway: false,
  /** Open the tile window when a tile is clicked. */
  tileWindow: true,
  /** Hide the land nobody has looked at, and cool what is out of sight. */
  fog: true,
  /** Keep the camera on the player rather than leaving it where it was dragged. */
  follow: true,
  /** Push the view along when the cursor rests against the edge of the screen. */
  edgePan: true,
  /**
   * How loud the island is, 0 for silence.
   *
   * Kept beside the camera and the keys rather than in the save, for the same
   * reason they are: how loud a room is, is a fact about the room, and
   * carrying it in a save means a volume that changes under you when you load
   * somebody else's world.
   */
  volume: 0.55,
  /**
   * Whether the first-steps card is shown.
   *
   * It stands down on its own once the first chapter of the journal is
   * behind you, so this is only about putting it away sooner — and it is a
   * fact about the person rather than about the island, like everything else
   * here: somebody who knows the game does not want to be told how to fell a
   * tree on every island they ever open.
   */
  guide: true,
};

export type Settings = typeof SETTING_DEFAULTS & {
  /**
   * Storey being looked at, 0 for the ground floor; null follows the player.
   *
   * The one thing here that is *not* kept. It is where you are rather than
   * what you like — coming back to an island on the second floor of a building
   * you are no longer standing in is not a preference anybody expressed.
   */
  viewLevel: number | null;
};

const KEPT = Object.keys(SETTING_DEFAULTS) as Array<keyof typeof SETTING_DEFAULTS>;

/** Whether anything has ever been put away here, which decides who wins a tie. */
export function settingsStored(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

function read(): Partial<typeof SETTING_DEFAULTS> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const got = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    // Type by type against the defaults rather than trusted: what comes out of
    // a browser's store is whatever was in a browser's store, including an
    // older build's idea of what these were.
    for (const k of KEPT) if (typeof got[k] === typeof SETTING_DEFAULTS[k]) out[k] = got[k];
    return out as Partial<typeof SETTING_DEFAULTS>;
  } catch {
    return {};
  }
}

/**
 * The live settings, which put themselves away whenever they are changed.
 *
 * A proxy rather than a `save()` beside every assignment: there are fourteen
 * places that set one of these, across the settings panel, the hud, the
 * toolbelt and the keys, and the fifteenth would have been written by somebody
 * who did not know there was a save to call. What cannot be forgotten is the
 * thing that happens on the assignment itself.
 */
export function liveSettings(): Settings {
  const live: Settings = { ...SETTING_DEFAULTS, ...read(), viewLevel: null };
  let due: ReturnType<typeof setTimeout> | null = null;
  const put = (): void => {
    due = null;
    try {
      const out: Record<string, unknown> = {};
      for (const k of KEPT) out[k] = live[k];
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch {
      // A browser that will not keep anything — private browsing, a store
      // that is full. The settings still work for as long as the page is open,
      // which is what they did before any of this.
    }
  };
  return new Proxy(live, {
    set(target, prop, value): boolean {
      (target as Record<string | symbol, unknown>)[prop] = value;
      // Coalesced, so a run of changes is one write; and only for the ones
      // that are kept, so following the player around a building does not
      // touch the store once a frame.
      if (KEPT.includes(prop as keyof typeof SETTING_DEFAULTS)) {
        if (due) clearTimeout(due);
        due = setTimeout(put, 200);
      }
      return true;
    },
  });
}
