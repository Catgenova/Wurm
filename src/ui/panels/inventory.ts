import type { Game } from '../../game/game';
import { itemDef, itemName, type Item, type ItemCategory } from '../../game/items';
import type { ContextMenu } from '../contextmenu';
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
    row.addEventListener('click', () => {
      this.selected = item.uid;
      this.render();
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.selected = item.uid;
      this.render();
      const target = { kind: 'item' as const, uid: item.uid };
      const actions = this.game.actionsFor(target);
      this.menu.show(
        e.clientX,
        e.clientY,
        itemName(item),
        actions.map(({ def: a, reason }) => ({
          label: a.label,
          hint: reason ?? undefined,
          disabled: !!reason,
          onSelect: () => this.game.requestAction(a, target),
        })),
      );
      this.win.el.dispatchEvent(new MouseEvent('mousedown'));
    });
    return row;
  }
}
