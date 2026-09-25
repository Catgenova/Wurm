import { CARRY_STOP, type Game } from '../../game/game';
import { itemDef, itemName, type Item, type ItemCategory, itemWeight, bagRoom, bagUnits, isBag } from '../../game/items';
import { damageCell, nameCell, qualityCell } from '../itemcells';
import { occupantOf } from '../../game/creaturecrate';
import type { ContextMenu, MenuItem } from '../contextmenu';
import { makeDraggable, makeDropZone, type DragPayload } from '../dragdrop';
import type { UIWindow } from '../windows';
import { COUNTS, pinEntry, pinnable } from '../beltmenu';
import { orderBy, sortSelect, type SortKey } from '../sorting';
import type { ActionDef } from '../../game/actions';
import { improvable, improveCeiling } from '../../game/improve';

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
    /** Opens a treasure map's picture. */
    private readonly readMap?: (uid: number) => void,
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
    const sortSel = sortSelect('How to order the list', (key) => {
      this.sort = key;
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

  /** The order the list is asked for, which a store window now asks the same way. */
  private ordered(items: Item[]): Item[] {
    return orderBy(items, this.sort);
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
    // Half again over the limit is where the drag becomes a wall — one you can
    // still creep along, at `CARRY_CRAWL` — so the line says which of the two
    // you are in rather than only that you are over.
    const stuck = this.game.stalled();
    const stop = limit * CARRY_STOP;
    const all = `${items.reduce((n, it) => n + it.count, 0)} items · ${weight.toFixed(1)} / ${limit.toFixed(0)} kg${stuck ? ' · too heavy to walk properly' : ''}`;
    this.footer.textContent = this.query ? `${shown.reduce((n, it) => n + it.count, 0)} of ${all}` : all;
    this.footer.classList.toggle('inv-over', over > 0);
    this.footer.classList.toggle('inv-stuck', stuck);
    this.footer.title = stuck
      ? `${weight.toFixed(1)} kg on a back that takes ${limit.toFixed(0)}. Over ${stop.toFixed(0)} kg you are down to a twentieth of your pace: put ${(weight - stop).toFixed(1)} kg down, or into a cart or a crate.`
      : over > 0
        ? `${over.toFixed(1)} kg past what your back will take. You are slower and you tire faster; over ${stop.toFixed(0)} kg you are down to a crawl.`
        : `${(limit - weight).toFixed(1)} kg to spare.`;
  }

  private row(item: Item): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'inv-row' + (item.uid === this.selected ? ' selected' : '');
    const name = nameCell(item, { worn: this.game.isEquipped(item.uid), occupant: occupantOf(this.game, item) });
    const ql = qualityCell(this.game, item);
    const dmg = damageCell(item);
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

  /**
   * "Take it to sixty."
   *
   * A count of passes is the wrong unit for improving and always was. What a
   * pass is worth falls away as the piece gets better — forty to forty-one is
   * one pass and ninety to ninety-one is a dozen — so asking for fifty is
   * asking for a number nobody can work out in advance, and the answer is
   * always either short or wasted.
   *
   * A quality is the unit people actually think in, and it costs nothing to
   * offer: improving repeats until its own check refuses it, so a ceiling in
   * the target is the whole feature. The island reads the same field off the
   * same target and refuses in the same words.
   *
   * Only the rungs above where the piece already is are worth showing, and
   * only up to what the hands could manage, because a ceiling your skill
   * cannot reach is a job that stops early and says something else.
   */
  private upToEntry(item: Item, def: ActionDef): MenuItem {
    const rungs = [20, 40, 60, 70, 80, 90, 95];
    const reach = improveCeiling(this.game, improvable(item.id)?.skill ?? '', item);
    const worth = rungs.filter((q) => q > item.ql + 0.05);
    if (!worth.length) return { label: 'Up to…', hint: 'It is past every mark worth aiming at.', disabled: true };
    return {
      label: 'Up to…',
      note: `it is at QL ${item.ql.toFixed(1)}`,
      children: worth.map((q) => ({
        label: `Quality ${q}`,
        note: q > reach ? `your hands top out at ${reach.toFixed(0)}, so it will stop there` : undefined,
        onSelect: () => this.game.requestAction(def, { kind: 'item', uid: item.uid, upto: q }),
      })),
    };
  }

  /** Action menu for an item; stack actions get a one / all submenu. */
  private openMenu(item: Item, x: number, y: number): void {
    const target = { kind: 'item' as const, uid: item.uid };
    const entries: MenuItem[] = [];
    // A bag is opened rather than used, so that entry comes first.
    if (isBag(item)) entries.push({ label: 'Open', note: `${bagUnits(item)} / ${bagRoom(item)} things`, onSelect: () => this.openBag?.(item.uid) });
    /*
     * And a map is read rather than used. First, for the same reason: the
     * whole of what a map is for is looking at it, and "Dig it up" is a thing
     * you do once, at the end, somewhere else entirely.
     */
    if (item.id === 'treasure_map') entries.push({ label: 'Read', note: 'Look at the country on it', onSelect: () => this.readMap?.(item.uid) });
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
            ...(def.id === 'improve_item' ? [this.upToEntry(item, def)] : []),
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
