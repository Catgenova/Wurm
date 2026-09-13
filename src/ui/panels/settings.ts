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
