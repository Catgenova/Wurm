import { crateCentre, crateName, CRATE_DEFS, crateUnits } from '../../game/crates';
import type { Game } from '../../game/game';
import { itemDef, itemName } from '../../game/items';
import type { UIWindow } from '../windows';

/** Contents of one placed crate, with a Take button per item. */
export class CratePanel {
  private list: HTMLDivElement;
  private footer: HTMLDivElement;
  private crateId: number | null = null;

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
    const crate = this.crateId !== null ? this.game.crates.get(this.crateId) : undefined;
    this.list.replaceChildren();
    if (!crate) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = 'Open a crate to see what is inside.';
      this.list.append(empty);
      this.footer.textContent = '';
      this.win.titleText.textContent = 'Crate';
      return;
    }
    this.win.titleText.textContent = crateName(crate);
    if (!crate.items.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = 'The crate is empty.';
      this.list.append(empty);
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
        const [cx, cy] = crateCentre(crate);
        if (Math.hypot(cx - this.game.player.x, cy - this.game.player.y) > 2.4) {
          this.game.logMsg('Stand next to the crate to take things out.', 'error');
          return;
        }
        const it = this.game.crateTake(crate, item.uid);
        if (it) this.game.inventory.addItem(it);
      });
      row.append(name, ql, dmg, take);
      this.list.append(row);
    }
    const weight = crate.items.reduce((s, it) => s + itemDef(it.id).weight * it.count, 0);
    this.footer.textContent = `${crateUnits(crate)} / ${CRATE_DEFS[crate.kind].capacity} things · ${weight.toFixed(1)} kg`;
  }

  open(id: number): void {
    this.crateId = id;
    this.render();
    this.win.open();
  }
}
