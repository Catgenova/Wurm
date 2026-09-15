import type { Game } from '../../game/game';
import { BINDS, BIND_GROUPS, keyName, keyReserved, MAX_KEYS, type Keybinds } from '../../game/keybinds';
import { whoAmI } from '../../net/accounts';
import type { UIWindow } from '../windows';

interface Toggle {
  input: HTMLInputElement;
  read: () => boolean;
}

/**
 * Two tabs: what the island looks like, and what the keys do.
 *
 * The keys half is the only part of the UI that has to *stop* being the game
 * for a moment — while it is listening for a key, every press belongs to it and
 * none of them reach `main`. `grabbing` is that moment, and `grab()` is how the
 * key handler asks whether this press is one of the game's or not.
 */
export class SettingsPanel {
  private toggles: Toggle[] = [];
  private tabs = new Map<string, HTMLButtonElement>();
  private pages = new Map<string, HTMLDivElement>();
  private tab = 'display';
  /** The slot waiting for a key, and the button showing that it is waiting. */
  private grabbing: { id: string; slot: number; btn: HTMLButtonElement } | null = null;
  private note: HTMLParagraphElement;
  private keyRows = new Map<string, HTMLButtonElement[]>();

  constructor(
    win: UIWindow,
    game: Game,
    private readonly keys: Keybinds,
  ) {
    win.body.classList.add('settings-body');
    const bar = document.createElement('div');
    bar.className = 'log-tabs';
    for (const [id, label, title] of [
      ['display', 'Display', 'What the island looks like'],
      ['keys', 'Keys', 'What every key does'],
    ] as Array<[string, string, string]>) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tb-btn tb-small log-tab' + (id === this.tab ? ' tb-on' : '');
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', () => this.show(id));
      this.tabs.set(id, b);
      bar.append(b);
    }
    win.body.append(bar);

    const display = document.createElement('div');
    display.className = 'settings-page';
    const keyPage = document.createElement('div');
    keyPage.className = 'settings-page keys-page';
    keyPage.hidden = true;
    this.pages.set('display', display);
    this.pages.set('keys', keyPage);
    win.body.append(display, keyPage);

    const add = (label: string, hint: string, read: () => boolean, write: (v: boolean) => void): void => {
      const row = document.createElement('label');
      row.className = 'setting-row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = read();
      input.addEventListener('change', () => write(input.checked));
      const text = document.createElement('span');
      text.innerHTML = `<b>${label}</b><small>${hint}</small>`;
      row.append(input, text);
      display.append(row);
      this.toggles.push({ input, read });
    };
    add('Show tile grid', 'Outline every tile. Also toggled with G.', () => game.settings.grid, (v) => (game.settings.grid = v));
    add(
      'Cut away walls facing you',
      'Take away the walls standing between you and the inside of a building. Also toggled with X, or the ◪ button beside the storey arrows.',
      () => game.settings.cutaway,
      (v) => (game.settings.cutaway = v),
    );
    add(
      'Fog of war',
      'Hide the land nobody has laid eyes on, and show ground that is out of sight as it was when you last saw it. Turning it off shows the whole island and simulates every creature at once.',
      () => game.settings.fog,
      (v) => {
        game.settings.fog = v;
        game.vision.invalidate();
      },
    );
    add(
      'Open the tile window on a click',
      'Clicking a tile shows everything you could do to it in the Tile window (T). Untick to keep to the right-click menu.',
      () => game.settings.tileWindow,
      (v) => (game.settings.tileWindow = v),
    );
    add(
      'Keep the camera on you',
      'The view follows you about. Pushing it away with the keys, or dragging it, turns this off for the moment; C, or the Centre button, takes it back. Untick to leave the camera wherever it was put.',
      () => game.settings.follow,
      (v) => (game.settings.follow = v),
    );
    add(
      'Push the view at the screen edge',
      'Resting the cursor against the edge of the screen slides the view that way, the harder the closer to the edge. Untick if you would rather only drag.',
      () => game.settings.edgePan,
      (v) => (game.settings.edgePan = v),
    );
    add(
      'Always show deed border',
      'Draw the green boundary of your settlement at all times. Otherwise it only shows while pointing at the token.',
      () => game.settings.deedBorder,
      (v) => (game.settings.deedBorder = v),
    );

    /**
     * Who you are, and the one thing the game can do about it.
     *
     * Setting up an account happens on a page of its own rather than in a
     * window here, so all this can do is point at it — and pointing at it is
     * the whole job, because a landing page nobody can find from the game is a
     * landing page nobody lands on.
     *
     * The line starts out saying you have no account and is corrected once the
     * island keeper answers. That way round on purpose: a browser with no
     * session never asks anybody anything, and a browser that cannot reach the
     * keeper is told the truth about what it can prove, which is nothing.
     */
    const who = document.createElement('p');
    who.className = 'setting-note';
    display.append(who);
    const door = document.createElement('a');
    door.href = './account.html';
    const sayWho = (line: string, label: string): void => {
      who.textContent = `${line} `;
      door.textContent = label;
      who.append(door);
    };
    sayWho('No account here, so on an island you are whatever name the address bar says.', 'Set one up');
    void whoAmI().then(
      (name) => { if (name) sayWho(`Signed in as ${name}.`, 'Change account'); },
      () => {},
    );

    // ---- The keys ----
    const lead = document.createElement('p');
    lead.className = 'keys-lead';
    lead.innerHTML =
      '<b>Click to walk.</b> A left click sets off for a tile and a right click asks what can be done to it; ' +
      'the keys below move the <i>view</i> and open things, and never move you. ' +
      'Click a key to set it, then press the one you want — <kbd>Esc</kbd> to think better of it, ' +
      '<kbd>Backspace</kbd> to leave it unbound. The number keys <kbd>1</kbd>–<kbd>0</kbd> are not here: ' +
      'they always answer to whatever the Tile window or the toolbelt is offering.';
    keyPage.append(lead);

    this.note = document.createElement('p');
    this.note.className = 'keys-note';
    this.note.hidden = true;
    keyPage.append(this.note);

    for (const group of BIND_GROUPS) {
      const rows = BINDS.filter((b) => b.group === group);
      if (!rows.length) continue;
      const h = document.createElement('h4');
      h.className = 'keys-group';
      h.textContent = group;
      keyPage.append(h);
      const table = document.createElement('div');
      table.className = 'keys-table';
      for (const bind of rows) {
        const row = document.createElement('div');
        row.className = 'keys-row';
        const text = document.createElement('span');
        text.className = 'keys-what';
        text.innerHTML = `<b>${bind.label}</b><small>${bind.hint}</small>`;
        const slots = document.createElement('span');
        slots.className = 'keys-slots';
        const btns: HTMLButtonElement[] = [];
        for (let slot = 0; slot < MAX_KEYS; slot++) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'tb-btn tb-small keys-key';
          b.addEventListener('click', () => this.listen(bind.id, slot, b));
          btns.push(b);
          slots.append(b);
        }
        this.keyRows.set(bind.id, btns);
        row.append(text, slots);
        table.append(row);
      }
      keyPage.append(table);
    }

    const foot = document.createElement('div');
    foot.className = 'keys-foot';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'tb-btn tb-small';
    reset.textContent = 'Put the keys back';
    reset.title = 'Every key back to what it was out of the box';
    reset.addEventListener('click', () => {
      this.stopListening();
      this.keys.reset();
      this.say('Back to the keys it came with.');
    });
    foot.append(reset);
    keyPage.append(foot);

    // Who redraws on a rebinding is `UI`'s business: the toolbar has to hear
    // about it too, and this panel is not the only thing that shows a key.
    this.drawKeys();
  }

  /** Switch tabs. */
  private show(id: string): void {
    if (!this.pages.has(id)) return;
    this.stopListening();
    this.tab = id;
    for (const [key, el] of this.tabs) el.classList.toggle('tb-on', key === id);
    for (const [key, el] of this.pages) el.hidden = key !== id;
  }

  /**
   * Take the next press for this slot.
   *
   * Clicking the slot that is already listening puts it back rather than
   * leaving somebody stuck waiting for a key they did not mean to change.
   */
  private listen(id: string, slot: number, btn: HTMLButtonElement): void {
    if (this.grabbing?.id === id && this.grabbing.slot === slot) {
      this.stopListening();
      return;
    }
    this.stopListening();
    this.grabbing = { id, slot, btn };
    btn.classList.add('keys-listening');
    btn.textContent = 'press…';
    this.say('Press the key you want. Esc to leave it as it was, Backspace to unbind it.');
  }

  private stopListening(): void {
    if (!this.grabbing) return;
    this.grabbing.btn.classList.remove('keys-listening');
    this.grabbing = null;
    this.drawKeys();
  }

  /**
   * A press, while a slot is listening.
   *
   * Answers whether the key was swallowed, which is what keeps `Escape` from
   * cancelling your work and `I` from opening the inventory behind the window
   * you are binding it in.
   */
  grab(code: string): boolean {
    const g = this.grabbing;
    if (!g) return false;
    if (code === 'Escape') {
      this.stopListening();
      this.say('Left as it was.');
      return true;
    }
    if (code === 'Backspace' || code === 'Delete') {
      this.keys.clear(g.id, g.slot);
      this.stopListening();
      this.say('Unbound.');
      return true;
    }
    const reserved = keyReserved(code);
    if (reserved) {
      this.say(reserved);
      return true;
    }
    const took = this.keys.bind(g.id, g.slot, code);
    this.stopListening();
    if (!took.ok) this.say(took.why ?? 'That key will not do.');
    else if (took.took) {
      const from = BINDS.find((b) => b.id === took.took);
      this.say(`${keyName(code)} set. It was ${from ? from.label.toLowerCase() : 'something else'}, which is now unbound.`);
    } else this.say(`${keyName(code)} set.`);
    return true;
  }

  private say(text: string): void {
    this.note.textContent = text;
    this.note.hidden = false;
  }

  /** Put every slot's caption back in step with the table. */
  drawKeys(): void {
    for (const [id, btns] of this.keyRows) {
      const codes = this.keys.codes(id);
      btns.forEach((b, i) => {
        const code = codes[i];
        b.textContent = code ? keyName(code) : '—';
        b.classList.toggle('keys-empty', !code);
        b.title = code ? `${keyName(code)} — click to change` : 'Unbound — click to set a key';
      });
    }
  }

  /** Keep the boxes in step with hotkeys that change the same settings. */
  refresh(): void {
    for (const t of this.toggles) {
      const v = t.read();
      if (t.input.checked !== v) t.input.checked = v;
    }
  }
}
