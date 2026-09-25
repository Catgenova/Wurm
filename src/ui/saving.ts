import { CANNOT_SAVE, onSaving } from '../net/supabase';

/**
 * The line across the top of the screen while the island is refusing changes.
 *
 * Asked for after the database filled on 09-25: "Show players a banner
 * instead of a stream of failed actions." While it was read-only an action
 * went off to the island, was refused, and nothing on the screen said so:
 * the click did nothing, and the next one did nothing too. This says once
 * what is happening and stays until a door that was refused goes through.
 */
export function mountSavingBanner(root: HTMLElement): void {
  const bar = document.createElement('div');
  bar.className = 'saving-banner';
  bar.setAttribute('role', 'alert');
  bar.textContent = CANNOT_SAVE;
  bar.hidden = true;
  root.append(bar);
  onSaving((saving) => {
    bar.hidden = saving;
  });
}
