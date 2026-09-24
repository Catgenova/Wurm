import type { Game } from '../../game/game';
import { cleanLook, type Look } from '../../game/look';
import type { Island } from '../../net/island';
import { Creator } from '../creator';
import type { UIWindow } from '../windows';

/** Whether two looks are the same in every part. */
const same = (a: Look, b: Look): boolean => (Object.keys(a) as Array<keyof Look>).every((k) => a[k] === b[k]);

/**
 * How you look, changed after coming ashore.
 *
 * Asked for as "allow players to change their appearance back through the
 * customizer in Settings". The creator was only ever on the account page, and
 * the account page only showed it to somebody signed in who went there on
 * purpose, so from inside the game there was no way back to it at all. This is
 * the same creator, opened from Settings on the look you have on.
 *
 * Nothing changes until the button says so. Closing the window, or Cancel,
 * leaves you as you were, and it opens on what you are wearing every time.
 * The two buttons sit in a bar under the creator rather than in it, so they
 * are on screen however far down the choices somebody has scrolled.
 *
 * On an island the look goes through `Island.wearLook`, and what is worn is
 * what the island kept rather than what was asked for. On your own it is the
 * body in this browser, and the save carries it like everything else on it.
 */
export class LookPanel {
  private creator: Creator | null = null;
  private readonly scroll: HTMLDivElement;
  private readonly wear: HTMLButtonElement;
  private readonly note: HTMLSpanElement;
  private busy = false;

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly island: Island | null,
  ) {
    win.body.classList.add('look-body');
    this.scroll = document.createElement('div');
    this.scroll.className = 'look-scroll';
    const lead = document.createElement('p');
    lead.className = 'look-lead';
    lead.textContent = island
      ? 'Kept with your account, so every island you are on, or come ashore on later, shows it. Everybody on this island sees the change as soon as you wear it.'
      : 'Saved with this game, in this browser. On an island, this window changes the look kept with your account instead.';
    this.scroll.append(lead);

    const bar = document.createElement('div');
    bar.className = 'look-bar';
    this.note = document.createElement('span');
    this.note.className = 'look-note';
    this.note.setAttribute('role', 'status');
    this.note.setAttribute('aria-live', 'polite');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'tb-btn';
    cancel.textContent = 'Cancel';
    cancel.title = 'Close without changing anything';
    cancel.addEventListener('click', () => win.close());
    this.wear = document.createElement('button');
    this.wear.type = 'button';
    this.wear.className = 'tb-btn look-wear';
    this.wear.textContent = 'Wear this look';
    this.wear.addEventListener('click', () => void this.put());
    bar.append(this.note, cancel, this.wear);
    win.body.append(this.scroll, bar);

    win.onOpen = () => this.opened();
    // A window left open from last time is shown without being opened.
    if (win.isOpen) this.opened();
  }

  /**
   * Built the first time it is wanted rather than with the rest of the
   * interface: it draws a head for every haircut and every beard, and most
   * sessions never open it.
   */
  private opened(): void {
    if (!this.creator) {
      this.creator = new Creator(this.game.player.look, () => this.win.isOpen);
      this.creator.el.classList.add('cr-snug');
      this.scroll.append(this.creator.el);
    }
    if (!this.busy) {
      this.creator.look = this.game.player.look;
      this.say('');
    }
    this.creator.wake();
  }

  private async put(): Promise<void> {
    const creator = this.creator;
    if (!creator || this.busy) return;
    const want = cleanLook(creator.look);
    if (same(want, this.game.player.look)) {
      this.win.close();
      return;
    }
    if (!this.island) {
      this.game.player.look = want;
      this.done();
      return;
    }
    this.busy = true;
    this.wear.disabled = true;
    this.say('Telling the island…');
    try {
      const kept = await this.island.wearLook(want);
      this.game.player.look = kept;
      creator.look = kept;
      this.done();
    } catch (e) {
      this.say(`The island did not take it: ${e instanceof Error ? e.message : 'no answer'}. Nothing has changed.`, true);
    } finally {
      this.busy = false;
      this.wear.disabled = false;
    }
  }

  private done(): void {
    this.game.logMsg('You change how you look.', 'event');
    this.win.close();
  }

  private say(text: string, bad = false): void {
    this.note.textContent = text;
    this.note.classList.toggle('bad', bad);
  }
}
