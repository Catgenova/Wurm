import type { Game } from '../../game/game';
import { itemDef, itemName } from '../../game/items';
import type { UIWindow } from '../windows';

/** Contents of the settlement crate, with a Take button per item. */
export class CratePanel {
  private list: HTMLDivElement;
  private footer: HTMLDivElement;

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
  ) {
    win.body.classList.add('inv-body');
    const head = document.createElement('div');
    head.className = 'inv-head';
    head.innerHTML = '<span>Item</span><span>QL</span><span>Dmg</span><span></span>';
    this.list = document.createElement('div');
    this.list.className = 'inv-list';
    this.footer = document.createElement('div');
    this.footer.className = 'inv-footer';
    win.body.append(head, this.list, this.footer);
    game.events.on('crate', () => this.render());
    this.render();
  }

  render(): void {
    const crate = this.game.crate;
    this.list.replaceChildren();
    if (!crate || !crate.items.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = crate ? 'The crate is empty.' : 'There is no crate: found a settlement first.';
      this.list.append(empty);
      this.footer.textContent = '';
      return;
    }
    for (const item of [...crate.items].sort((a, b) => itemName(a).localeCompare(itemName(b)))) {
      const row = document.createElement('div');
      row.className = 'inv-row';
      const name = document.createElement('span');
      name.className = 'inv-name';
      name.textContent = item.count > 1 ? `${itemName(item)} (${item.count})` : itemName(item);
      const ql = document.createElement('span');
      ql.textContent = item.ql.toFixed(1);
      const dmg = document.createElement('span');
      dmg.textContent = item.dmg.toFixed(1);
      const take = document.createElement('button');
      take.type = 'button';
      take.className = 'tb-btn tb-small';
      take.textContent = 'Take';
      take.addEventListener('click', (e) => {
        e.stopPropagation();
        if (Math.hypot(crate.x + 0.5 - this.game.player.x, crate.y + 0.5 - this.game.player.y) > 2.2) {
          this.game.logMsg('Stand next to the crate to take things out.', 'error');
          return;
        }
        const it = this.game.crateTake(item.uid);
        if (it) this.game.inventory.addItem(it);
      });
      row.append(name, ql, dmg, take);
      this.list.append(row);
    }
    const weight = crate.items.reduce((s, it) => s + itemDef(it.id).weight * it.count, 0);
    this.footer.textContent = `${crate.items.reduce((n, it) => n + it.count, 0)} items · ${weight.toFixed(1)} kg`;
  }

  open(): void {
    this.render();
    this.win.open();
  }
}
