import type { Game } from '../../game/game';
import type { UIWindow } from '../windows';

interface Toggle {
  input: HTMLInputElement;
  read: () => boolean;
}

/** Simple on/off options, kept in the save with the rest of the settings. */
export class SettingsPanel {
  private toggles: Toggle[] = [];

  constructor(win: UIWindow, game: Game) {
    win.body.classList.add('settings-body');
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
      win.body.append(row);
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
      'The view follows you about. Dragging it away turns this off for the moment; C, or the Centre button, takes it back. Untick to leave the camera wherever it was put.',
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
  }

  /** Keep the boxes in step with hotkeys that change the same settings. */
  refresh(): void {
    for (const t of this.toggles) {
      const v = t.read();
      if (t.input.checked !== v) t.input.checked = v;
    }
  }
}
