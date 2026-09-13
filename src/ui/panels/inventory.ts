import type { Game } from '../../game/game';
import { itemDef, itemName, type Item, type ItemCategory } from '../../game/items';
import type { ContextMenu, MenuItem } from '../contextmenu';
import type { UIWindow } from '../windows';

const CATEGORY_ORDER: Array<[ItemCategory, string]> = [
  ['tool', 'Tools'],
  ['material', 'Materials'],
  ['food', 'Food'],
  ['plant', 'Plants & seeds'],
  ['misc', 'Other'],
];

export class InventoryPanel {
  private list: HTMLDivElement;
  private footer: HTMLDivElement;
  private selected: number | null = null;

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly menu: ContextMenu,
  ) {
    const head = document.createElement('div');
    head.className = 'inv-head';
    head.innerHTML = '<span>Item</span><span>QL</span><span>Dmg</span><span>Wt</span>';
    this.list = document.createElement('div');
    this.list.className = 'inv-list';
    this.footer = document.createElement('div');
    this.footer.className = 'inv-footer';
    win.body.append(head, this.list, this.footer);
    win.body.classList.add('inv-body');
    game.events.on('inventory', () => this.render());
    this.render();
  }

  render(): void {
    const items = this.game.inventory.items;
    this.list.replaceChildren();
    for (const [cat, label] of CATEGORY_ORDER) {
      const group = items.filter((it) => itemDef(it.id).category === cat);
      if (!group.length) continue;
      const header = document.createElement('div');
      header.className = 'inv-group';
      header.textContent = label;
      this.list.append(header);
      for (const item of group.sort((a, b) => itemName(a).localeCompare(itemName(b)))) this.list.append(this.row(item));
    }
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = 'Your inventory is empty.';
      this.list.append(empty);
    }
    const weight = this.game.inventory.totalWeight();
    this.footer.textContent = `${items.reduce((n, it) => n + it.count, 0)} items · ${weight.toFixed(1)} kg`;
  }

  private row(item: Item): HTMLDivElement {
    const def = itemDef(item.id);
    const row = document.createElement('div');
    row.className = 'inv-row' + (item.uid === this.selected ? ' selected' : '');
    const name = document.createElement('span');
    name.className = 'inv-name';
    name.textContent = item.count > 1 ? `${itemName(item)} (${item.count})` : itemName(item);
    const ql = document.createElement('span');
    ql.textContent = item.ql.toFixed(1);
    const dmg = document.createElement('span');
    dmg.textContent = item.dmg.toFixed(1);
    const wt = document.createElement('span');
    wt.textContent = (def.weight * item.count).toFixed(1);
    row.append(name, ql, dmg, wt);
    const open = (e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      this.selected = item.uid;
      this.render();
      this.openMenu(item, e.clientX, e.clientY);
    };
    row.addEventListener('click', open);
    row.addEventListener('contextmenu', open);
    return row;
  }

  /** Action menu for an item; stack actions get a one / all submenu. */
  private openMenu(item: Item, x: number, y: number): void {
    const target = { kind: 'item' as const, uid: item.uid };
    const entries: MenuItem[] = this.game.actionsFor(target).map(({ def, reason }) => {
      const all = def.maxRepeat ? def.maxRepeat(target, this.game) : item.count;
      if (def.quantity && all > 1 && !reason) {
        return {
          label: def.label,
          children: [
            { label: 'One', onSelect: () => this.game.requestAction(def, { ...target, count: 1 }) },
            { label: `All (${all})`, onSelect: () => this.game.requestAction(def, { ...target, count: all }) },
          ],
        };
      }
      return { label: def.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => this.game.requestAction(def, target) };
    });
    this.win.focus();
    this.menu.show(x, y, itemName(item), entries);
  }
}
