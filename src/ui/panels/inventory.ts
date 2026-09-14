import type { Game } from '../../game/game';
import { itemDef, itemName, type Item, type ItemCategory, itemWeight, rarityOf, bagRoom, bagUnits, isBag } from '../../game/items';
import type { ContextMenu, MenuItem } from '../contextmenu';
import { makeDraggable, makeDropZone, type DragPayload } from '../dragdrop';
import type { UIWindow } from '../windows';
import { COUNTS, pinEntry, pinnable } from '../beltmenu';

const CATEGORY_ORDER: Array<[ItemCategory, string]> = [
  ['tool', 'Tools'],
  ['material', 'Materials'],
  ['food', 'Food'],
  ['plant', 'Plants & seeds'],
  ['misc', 'Other'],
];

/** How a pack may be put in order. */
type SortKey = 'name' | 'ql' | 'weight' | 'dmg' | 'count';
const SORTS: Array<[SortKey, string]> = [
  ['name', 'Name'],
  ['ql', 'Quality'],
  ['weight', 'Weight'],
  ['dmg', 'Damage'],
  ['count', 'How many'],
];

export class InventoryPanel {
  private list: HTMLDivElement;
  private footer: HTMLDivElement;
  private search: HTMLInputElement;
  private query = '';
  private selected: number | null = null;
  private sort: SortKey = 'name';
  private grouped = true;

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly menu: ContextMenu,
    private readonly dropped?: (p: DragPayload) => void,
    /** Opens a carried bag in the store window. */
    private readonly openBag?: (uid: number) => void,
  ) {
    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.className = 'panel-search';
    this.search.placeholder = 'Search your pack…';
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase();
      this.render();
    });
    // Escape clears the box rather than closing the window out from under you.
    this.search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Escape') return;
      this.search.value = '';
      this.query = '';
      this.render();
    });
    // How the list is put in order, and whether it is grouped by kind.
    const bar = document.createElement('div');
    bar.className = 'panel-bar';
    const sortSel = document.createElement('select');
    sortSel.className = 'panel-select';
    sortSel.title = 'How to order the list';
    for (const [key, label] of SORTS) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = label;
      sortSel.append(opt);
    }
    sortSel.addEventListener('change', () => {
      this.sort = sortSel.value as SortKey;
      this.render();
    });
    const groupBtn = document.createElement('button');
    groupBtn.type = 'button';
    groupBtn.className = 'tb-btn tb-small';
    groupBtn.textContent = 'Grouped';
    groupBtn.title = 'Group by kind, or run everything together in one list';
    groupBtn.addEventListener('click', () => {
      this.grouped = !this.grouped;
      groupBtn.textContent = this.grouped ? 'Grouped' : 'Flat';
      groupBtn.classList.toggle('tb-on', this.grouped);
      this.render();
    });
    groupBtn.classList.add('tb-on');
    bar.append(sortSel, groupBtn);
    const head = document.createElement('div');
    head.className = 'inv-head';
    head.innerHTML = '<span>Item</span><span>QL</span><span>Dmg</span><span>Wt</span>';
    this.list = document.createElement('div');
    this.list.className = 'inv-list';
    this.footer = document.createElement('div');
    this.footer.className = 'inv-footer';
    win.body.append(this.search, bar, head, this.list, this.footer);
    win.body.classList.add('inv-body');
    makeDropZone(
      this.list,
      (p) => p.from === 'store',
      (p) => this.dropped?.(p),
    );
    game.events.on('inventory', () => this.render());
    this.render();
  }

  /** Whether an item answers to what has been typed in the search box. */
  private matches(item: Item): boolean {
    if (!this.query) return true;
    const def = itemDef(item.id);
    return `${itemName(item)} ${def.category} ${def.description ?? ''}`.toLowerCase().includes(this.query);
  }

  /** The order the list is asked for: name climbs, everything else falls. */
  private ordered(items: Item[]): Item[] {
    const by: Record<SortKey, (a: Item, b: Item) => number> = {
      name: (a, b) => itemName(a).localeCompare(itemName(b)),
      ql: (a, b) => b.ql - a.ql,
      weight: (a, b) => itemWeight(b) - itemWeight(a),
      dmg: (a, b) => b.dmg - a.dmg,
      count: (a, b) => b.count - a.count,
    };
    return [...items].sort(by[this.sort]);
  }

  render(): void {
    const items = this.game.inventory.items;
    const shown = items.filter((it) => this.matches(it));
    this.list.replaceChildren();
    if (!this.grouped) {
      for (const item of this.ordered(shown)) this.list.append(this.row(item));
    } else
    for (const [cat, label] of CATEGORY_ORDER) {
      const group = shown.filter((it) => itemDef(it.id).category === cat);
      if (!group.length) continue;
      const header = document.createElement('div');
      header.className = 'inv-group';
      header.textContent = label;
      this.list.append(header);
      for (const item of this.ordered(group)) this.list.append(this.row(item));
    }
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = items.length ? `Nothing you are carrying answers to “${this.search.value.trim()}”.` : 'Your inventory is empty.';
      this.list.append(empty);
    }
    const weight = this.game.inventory.totalWeight();
    const limit = this.game.carryLimit();
    const over = this.game.overloaded();
    const all = `${items.reduce((n, it) => n + it.count, 0)} items · ${weight.toFixed(1)} / ${limit.toFixed(0)} kg`;
    this.footer.textContent = this.query ? `${shown.reduce((n, it) => n + it.count, 0)} of ${all}` : all;
    this.footer.classList.toggle('inv-over', over > 0);
    this.footer.title = over > 0
      ? `${over.toFixed(1)} kg past what your back will take. You are slower and you tire faster; put something down or raise body strength.`
      : `${(limit - weight).toFixed(1)} kg to spare.`;
  }

  private row(item: Item): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'inv-row' + (item.uid === this.selected ? ' selected' : '');
    const name = document.createElement('span');
    name.className = 'inv-name';
    const worn = this.game.isEquipped(item.uid);
    const marks = [worn ? 'worn' : '', item.locked ? 'kept' : ''].filter(Boolean);
    const full = (item.count > 1 ? `${itemName(item)} (${item.count})` : itemName(item)) + (marks.length ? ` · ${marks.join(' · ')}` : '');
    name.textContent = full;
    // The column is narrow and some of these names are long.
    name.title = item.locked ? `${full}. Kept back: nothing will spend, drop or feed it away.` : full;
    // A rare thing is written in its own colour, so it is not lost in a list.
    const rare = rarityOf(item);
    if (rare.colour) name.style.color = rare.colour;
    if (worn) name.classList.add('inv-worn');
    if (item.locked) name.classList.add('inv-kept');
    const ql = document.createElement('span');
    ql.textContent = item.ql.toFixed(1);
    // What the thing is worth at the work now: its quality dragged down by the
    // state it is in and lifted by its metal, its rarity and any blessing.
    const worth = this.game.toolWorth(item);
    if (itemDef(item.id).category === 'tool') {
      ql.title = `Made at ${item.ql.toFixed(1)}; it works as a ${worth.toFixed(1)} today.`;
      if (worth < item.ql - 0.05) {
        ql.classList.add('inv-blunt');
        ql.textContent = `${item.ql.toFixed(1)}→${worth.toFixed(0)}`;
      } else if (worth > item.ql + 0.05) {
        ql.classList.add('inv-keen');
        ql.textContent = `${item.ql.toFixed(1)}→${worth.toFixed(0)}`;
      }
    }
    const dmg = document.createElement('span');
    dmg.textContent = item.dmg.toFixed(1);
    // A tool close to going to pieces says so where you are looking at it.
    if (item.dmg >= 90) {
      dmg.classList.add('inv-breaking');
      dmg.title = 'About to go to pieces. Repair it now.';
    } else if (item.dmg >= 75) {
      dmg.classList.add('inv-worn-out');
      dmg.title = 'Getting badly worn. Repair it before it breaks.';
    }
    const wt = document.createElement('span');
    wt.textContent = itemWeight(item).toFixed(1);
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
    makeDraggable(row, { uid: item.uid, from: 'inventory', name: itemName(item) });
    return row;
  }

  /** Action menu for an item; stack actions get a one / all submenu. */
  private openMenu(item: Item, x: number, y: number): void {
    const target = { kind: 'item' as const, uid: item.uid };
    const entries: MenuItem[] = [];
    // A bag is opened rather than used, so that entry comes first.
    if (isBag(item)) entries.push({ label: 'Open', note: `${bagUnits(item)} / ${bagRoom(item)} things`, onSelect: () => this.openBag?.(item.uid) });
    entries.push(...this.game.actionsFor(target).map(({ def, reason }) => {
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
      if (def.repeat && !reason) {
        return {
          label: def.label,
          children: [
            { label: 'Once', onSelect: () => this.game.requestAction(def, target, 1) },
            ...COUNTS.map((n) => ({ label: `${n} times`, onSelect: () => this.game.requestAction(def, target, n) })),
            { label: 'Until you stop', note: 'or until your wind gives out', onSelect: () => this.game.requestAction(def, target) },
          ],
        };
      }
      return { label: def.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => this.game.requestAction(def, target) };
    }));
    // Hanging one of this thing's jobs on the belt. The loop remembers the kind
    // of thing, not this one, so it still works on the next loaf you bake.
    const hangable = this.game.actionsFor(target).filter((a) => pinnable(a.def));
    if (hangable.length && this.game.beltLoops()) {
      entries.push({
        label: 'Hang a job on your belt',
        children: hangable.map(({ def }) => ({ label: def.label, children: pinEntry(this.game, { action: def.id, item: item.id }).children })),
      });
    }
    this.win.focus();
    this.menu.show(x, y, itemName(item), entries);
  }
}
