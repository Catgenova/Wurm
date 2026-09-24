import { crateCentre, crateName, crateCapacity, crateSpare, STORE_REACH } from '../../game/crates';
import { furnitureCapacity, furnitureCentre, furnitureHeft, furnitureName, furnitureRefuses, furnitureRoom } from '../../game/furniture';
import { bloodMul } from '../../game/creatures';
import { ACTION_BY_ID, type ActionDef } from '../../game/actions';
import type { Game } from '../../game/game';
import { bagAdd, bagRefuses, bagRoom, bagSpare, bagTake, itemDef, type Item, itemName } from '../../game/items';
import type { MenuItem } from '../contextmenu';
import { makeDraggable, makeDropZone, type DragPayload } from '../dragdrop';
import type { UIWindow } from '../windows';
import { orderBy, sortSelect, type SortKey } from '../sorting';
import { damageCell, nameCell, qualityCell } from '../itemcells';

/** A crate or a piece of storage furniture, seen through the same window. */
export interface Store {
  title: string;
  /**
   * Which one it is: a crate id, a placed id, a bag's uid, a beast's id.
   *
   * The window knew which container it was showing and the ask did not, so a
   * put went into whichever container stood nearest — "trying to place any
   * items in any of the pine crates gives an error that the maple crate is
   * full", off a rack with eight crates on one tile. This is what the ask
   * carries now.
   */
  id: number;
  items: Item[];
  capacity: number;
  /**
   * Kilograms it holds, where that is the limit rather than a count. Set on
   * the craft material bin and nothing else, and the footer reads the other
   * way round when it is: weight against the limit, and the count as an
   * aside, because the count is not what fills it.
   */
  heft?: number;
  centre: [number, number];
  /**
   * The padlock on it, when it is one of the things that can carry one, with
   * the tile it stands on so the ground can be asked about the master key.
   * Absent on a pannier and a bag, which are carried rather than standing.
   */
  lock?: { lock?: number; x: number; y: number };
  what: string;
  /**
   * Which of the island's doors this one is behind, when it is behind one.
   *
   * A pannier is carried in your own copy and has no door of its own, so a
   * drag into or out of one stays where it always was. A crate, a chest and —
   * since the bag work — a bag on your back are the island's, and a drag has
   * to ask: `take_from_store` knows about all three.
   */
  kind: 'crate' | 'furniture' | 'bag' | 'carried';
  take: (uid: number) => Item | null;
  /** Why it will not take this at all, or null. */
  refuses: (item: Item) => string | null;
  /**
   * How many of a stack it will take, which is not always all of them.
   *
   * Asked for: "when trying to put 48 items in a container that has room for
   * 13, deposit 13 and reject the 35." `refuses` answers about the whole
   * armful and is still the right question for a bin that will not have a
   * tool; this is the other question, and the one a part-full crate answers.
   */
  fits: (item: Item) => number;
  add: (item: Item) => boolean;
}

/** Contents of one placed container, with a Take button per item. */
export class CratePanel {
  private list: HTMLDivElement;
  private footer: HTMLDivElement;
  private bar: HTMLDivElement;
  private crateId: number | null = null;
  private furnitureId: number | null = null;
  private creatureId: number | null = null;
  private bagUid: number | null = null;
  private search: HTMLInputElement;
  private query = '';
  private sort: SortKey = 'name';

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly dropped?: (p: DragPayload) => void,
    /**
     * Somewhere to show an item's own menu, for the stores whose contents can
     * be worked on where they lie — which since the bag work means bags: a
     * skin in your backpack fills and pours without coming out of it, and a
     * window with only a Take button is no way to say so.
     */
    private readonly showMenu?: (x: number, y: number, title: string, items: MenuItem[]) => void,
  ) {
    win.body.classList.add('inv-body');
    const head = document.createElement('div');
    head.className = 'inv-head';
    head.innerHTML = '<span>Item</span><span>QL</span><span>Dmg</span><span></span>';
    this.list = document.createElement('div');
    this.list.className = 'inv-list';
    this.footer = document.createElement('div');
    this.footer.className = 'inv-footer';
    // Moving things a stack at a time is most of the tedium of a settlement.
    this.bar = document.createElement('div');
    this.bar.className = 'panel-bar';
    const takeAll = document.createElement('button');
    takeAll.type = 'button';
    takeAll.className = 'tb-btn tb-small';
    takeAll.textContent = 'Take all';
    takeAll.title = 'Empty it into your pack, as far as your back will take';
    takeAll.addEventListener('click', () => this.takeAll());
    const putAll = document.createElement('button');
    putAll.type = 'button';
    putAll.className = 'tb-btn tb-small';
    putAll.textContent = 'Put all in';
    putAll.title = 'Put everything loose in your pack into it';
    putAll.addEventListener('click', () => this.putAll());
    const putKind = document.createElement('button');
    putKind.type = 'button';
    putKind.className = 'tb-btn tb-small';
    putKind.textContent = 'Put in what it holds';
    putKind.title = 'Put in only the kinds already in it — top the store up without emptying your pack';
    putKind.addEventListener('click', () => this.putAll(true));
    this.bar.append(takeAll, putAll, putKind, sortSelect('How to order what is inside', (key) => {
      this.sort = key;
      this.render();
    }));
    /*
     * And a box to search it.
     *
     * The pack has had one of these since the storage work and a store has
     * had none, which is the wrong way round: a pack holds a dozen things and
     * a deed crate holds three hundred. Finding the one damaged hatchet in a
     * cupboard meant reading the cupboard.
     */
    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.className = 'panel-search';
    this.search.placeholder = 'Search what is inside\u2026';
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase();
      this.render();
    });
    this.search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Escape') return;
      this.search.value = '';
      this.query = '';
      this.render();
    });
    win.body.append(this.search, head, this.list, this.bar, this.footer);
    makeDropZone(
      this.list,
      (p) => p.from === 'inventory' && this.store() !== undefined,
      (p) => this.dropped?.(p),
    );
    game.events.on('crate', () => this.render());
    this.render();
  }

  /** Whichever container is open, seen the same way. */
  currentStore(): Store | undefined {
    return this.store();
  }

  /** Whether the player is close enough to reach into it. */
  withinReach(): boolean {
    const store = this.store();
    if (!store) return false;
    const [cx, cy] = store.centre;
    return Math.hypot(cx - this.game.player.x, cy - this.game.player.y) <= STORE_REACH;
  }

  private store(): Store | undefined {
    const crate = this.crateId !== null ? this.game.crates.get(this.crateId) : undefined;
    if (crate) {
      return {
        title: `${crateName(crate)} (QL ${crate.ql.toFixed(0)})`,
        id: crate.id,
        items: crate.items,
        capacity: crateCapacity(crate),
        centre: crateCentre(crate),
        what: 'crate',
        kind: 'crate',
        lock: crate,
        take: (uid) => this.game.crateTake(crate, uid),
        refuses: (item) => (crateSpare(crate) <= 0 ? `The ${crateName(crate).toLowerCase()} is full.` : null),
        fits: (item) => Math.min(item.count, crateSpare(crate)),
        add: (item) => this.game.crateAdd(crate, item),
      };
    }
    const beast = this.creatureId !== null ? this.game.creatures.get(this.creatureId) : undefined;
    if (beast) {
      const cap = Math.round((this.game.creatures.species(beast).pannier ?? 0) * bloodMul(beast, 'haul'));
      const units = (): number => beast.pannier.reduce((n, it) => n + it.count, 0);
      return {
        title: `${beast.name}'s panniers`,
        id: beast.id,
        items: beast.pannier,
        capacity: cap,
        centre: [beast.x, beast.y],
        what: 'panniers',
        kind: 'carried',
        take: (uid) => this.game.pannierTake(beast, uid),
        refuses: () => (units() >= cap ? `${beast.name} is loaded as it is.` : null),
        fits: (item) => Math.min(item.count, Math.max(0, cap - units())),
        add: (item) => this.game.pannierAdd(beast, item),
      };
    }
    // A bag carried in the pack, seen through the same window as a crate.
    const bag = this.bagUid !== null ? this.game.inventory.get(this.bagUid) : undefined;
    if (bag && bagRoom(bag)) {
      return {
        title: `${itemName(bag)} (QL ${bag.ql.toFixed(0)})`,
        id: bag.uid,
        kind: 'bag',
        items: bag.inside ?? [],
        capacity: bagRoom(bag),
        centre: [this.game.player.x, this.game.player.y],
        what: itemDef(bag.id).name.toLowerCase(),
        take: (uid) => {
          const it = bagTake(bag, uid);
          if (it) this.game.inventory.addItem(it);
          this.game.events.emit('inventory');
          return it;
        },
        refuses: (item) => bagRefuses(bag, { ...item, count: 1 }),
        fits: (item) => (bagRefuses(bag, { ...item, count: 1 }) ? 0 : Math.min(item.count, bagSpare(bag))),
        add: (item) => {
          const ok = bagAdd(bag, item);
          this.game.events.emit('inventory');
          return ok;
        },
      };
    }
    const piece = this.furnitureId !== null ? this.game.furniture.get(this.furnitureId) : undefined;
    if (piece) {
      return {
        title: `${furnitureName(piece)} (QL ${piece.ql.toFixed(0)})`,
        id: piece.id,
        items: piece.items,
        capacity: furnitureCapacity(piece),
        heft: furnitureHeft(piece),
        centre: furnitureCentre(piece),
        what: furnitureName(piece).toLowerCase(),
        kind: 'furniture',
        lock: piece,
        take: (uid) => this.game.furnitureTake(piece, uid),
        refuses: (item) => furnitureRefuses(piece, item) ?? (furnitureRoom(piece, item) <= 0 ? `The ${furnitureName(piece).toLowerCase()} is full.` : null),
        fits: (item) => (furnitureRefuses(piece, item) ? 0 : Math.min(item.count, furnitureRoom(piece, item))),
        add: (item) => this.game.furnitureAdd(piece, item),
      };
    }
    return undefined;
  }

  /**
   * The island's door for the store that is open, when there is an island.
   *
   * Every button on this bar moved rows about in the browser's own copy and
   * told nobody, which on an island means the next answer puts them back:
   * "container inventories need to update visually live on the browser. they
   * show as empty when transferring in items." A per-row Take has gone through
   * `take_from_store` since the rubber-banding was reported; the bar had not
   * caught up.
   */
  private door(store: Store, what: 'in' | 'out'): ActionDef | undefined {
    if (!this.game.ask || store.kind === 'carried') return undefined;
    const id = what === 'out'
      ? store.kind === 'crate' ? 'crate_take_all' : store.kind === 'bag' ? 'empty_bag' : 'furniture_take_all'
      : store.kind === 'crate' ? 'store_in_crate' : store.kind === 'bag' ? 'stow_item' : 'store_in_furniture';
    return ACTION_BY_ID.get(id);
  }

  /** Empty the open store into the pack, as far as it will go. */
  private takeAll(): void {
    const store = this.store();
    if (!store) return;
    if (!this.withinReach()) {
      this.game.logMsg(`Stand next to the ${store.what} to take things out.`, 'error');
      return;
    }
    const door = this.door(store, 'out');
    if (door) {
      // A bag is emptied by naming the bag; a crate and a chest by naming
      // themselves. The island says what came out.
      this.game.requestAction(door, store.kind === 'bag'
        ? { kind: 'item', uid: store.id }
        : { kind: store.kind === 'crate' ? 'crate' : 'furniture', id: store.id });
      return;
    }
    let moved = 0;
    for (const item of [...store.items]) {
      const it = store.take(item.uid);
      if (!it) break;
      this.game.inventory.addItem(it);
      moved += it.count;
    }
    this.game.logMsg(moved ? `You empty the ${store.what}: ${moved} things into your pack.` : `The ${store.what} is empty.`, 'event');
    this.render();
  }

  /**
   * Put the pack into the open store. Kept-back things stay where they are,
   * and so does anything worn; with `sameKinds` only what is already in there
   * goes in, which is how a store is topped up rather than filled with
   * everything you happen to be holding.
   */
  private putAll(sameKinds = false): void {
    const store = this.store();
    if (!store) return;
    if (!this.withinReach()) {
      this.game.logMsg(`Stand next to the ${store.what} to put things in.`, 'error');
      return;
    }
    const kinds = new Set(store.items.map((it) => it.id));
    const door = this.door(store, 'in');
    if (door) {
      /*
       * One ask a stack, which is what dragging them in one at a time already
       * did. The island decides what each store will hold — a raw material bin
       * takes no tools — so the asks go out and it answers for each of them,
       * rather than this side guessing and being corrected a moment later.
       */
      let asked = 0;
      for (const item of [...this.game.inventory.items]) {
        if (item.locked || this.game.isEquipped(item.uid)) continue;
        if (sameKinds && !kinds.has(item.id)) continue;
        asked++;
        this.game.requestAction(door, { kind: 'item', uid: item.uid, count: item.count, into: store.id });
      }
      if (!asked) this.game.logMsg(`There is nothing loose to put in the ${store.what}.`, 'error');
      return;
    }
    let moved = 0;
    let left = 0;
    let refused = '';
    for (const item of [...this.game.inventory.items]) {
      if (item.locked || this.game.isEquipped(item.uid)) continue;
      if (sameKinds && !kinds.has(item.id)) continue;
      const why = store.refuses(item);
      if (why) {
        refused ||= why;
        continue;
      }
      // What there is room for, which may be part of a stack and may by now
      // be none of it: the last few went in and filled the thing.
      const fits = store.fits(item);
      if (fits <= 0) {
        left += item.count;
        continue;
      }
      const taken = this.game.inventory.take(item.uid, fits);
      if (!taken) continue;
      if (store.add(taken)) {
        moved += taken.count;
        left += item.count - taken.count;
      } else this.game.inventory.addItem(taken);
    }
    if (left && !refused) refused = `${left} of them would not fit.`;
    this.game.events.emit('inventory');
    this.game.logMsg(
      moved ? `You put ${moved} things into the ${store.what}.${refused ? ` ${refused}` : ''}` : refused || `There is nothing loose to put in the ${store.what}.`,
      moved ? 'event' : 'error',
    );
    this.render();
  }

  /** Whether a thing answers to what has been typed in the box. */
  private matches(item: Item): boolean {
    if (!this.query) return true;
    const def = itemDef(item.id);
    return `${itemName(item)} ${def.category} ${def.description ?? ''}`.toLowerCase().includes(this.query);
  }

  render(): void {
    const store = this.store();
    this.list.replaceChildren();
    if (!store) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = 'Open a crate or a cupboard to see what is inside.';
      this.list.append(empty);
      this.footer.textContent = '';
      this.bar.hidden = true;
      this.win.titleText.textContent = 'Storage';
      return;
    }
    /*
     * A padlock, said in the title rather than only when you try something.
     * A window that looks exactly like an open one and refuses every button
     * is a window somebody presses four times before reading the log.
     */
    const shut = store.lock ? this.game.lockRefusal(store.lock) : null;
    this.win.titleText.textContent = store.title + (!store.lock?.lock ? ''
      : shut ? ' \u2014 locked' : ' \u2014 unlocked');
    this.bar.hidden = false;
    if (!store.items.length || !store.items.some((it) => this.matches(it))) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      // Two different emptinesses, and saying the wrong one is how somebody
      // comes to believe a full crate has been robbed.
      empty.textContent = store.items.length
        ? `Nothing in the ${store.what} answers to that.`
        : `The ${store.what} is empty.`;
      this.list.append(empty);
    }
    for (const item of orderBy(store.items.filter((it) => this.matches(it)), this.sort)) {
      const row = document.createElement('div');
      row.className = 'inv-row';
      /*
       * The same three cells the pack window writes, off the same helpers.
       * A rare thing in a crate was written in the ordinary colour and a
       * blunt tool in a crate said only the number it was made at, so the
       * one list you go to when you are looking for a particular thing was
       * the one list that told you least about what was in it.
       */
      const name = nameCell(item, { worn: this.game.isEquipped(item.uid) });
      const ql = qualityCell(this.game, item);
      const dmg = damageCell(item);
      const take = document.createElement('button');
      take.type = 'button';
      take.className = 'tb-btn tb-small';
      take.textContent = 'Take';
      take.addEventListener('click', (e) => {
        e.stopPropagation();
        const [cx, cy] = store.centre;
        if (Math.hypot(cx - this.game.player.x, cy - this.game.player.y) > STORE_REACH) {
          this.game.logMsg(`Stand next to the ${store.what} to take things out.`, 'error');
          return;
        }
        /*
         * The same door the drag uses. This took the row out of the browser's
         * own copy and told nobody, so on an island the next answer put it
         * back — "it still rubber bands from crate to inventory".
         */
        const def = ACTION_BY_ID.get('take_from_store');
        if (this.game.ask && def && store.kind !== 'carried') {
          this.game.requestAction(def, { kind: 'item', uid: item.uid, count: item.count });
          return;
        }
        const it = store.take(item.uid);
        if (it) this.game.inventory.addItem(it);
      });
      row.append(name, ql, dmg, take);
      if (store.kind === 'bag' && this.showMenu) {
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.openMenu(item, e.clientX, e.clientY);
        });
      }
      makeDraggable(row, { uid: item.uid, from: 'store', name: itemName(item) });
      this.list.append(row);
    }
    const weight = store.items.reduce((s, it) => s + itemDef(it.id).weight * it.count, 0);
    const used = store.items.reduce((n, it) => n + it.count, 0);
    this.footer.textContent = store.heft
      ? `${weight.toFixed(1)} / ${store.heft} kg · ${used} things`
      : `${used} / ${store.capacity} things · ${weight.toFixed(1)} kg`;
  }

  /**
   * What can be done with a thing where it lies.
   *
   * The same list the pack window shows, asked the same way: `actionsFor`
   * answers for a stowed thing now, and answers with the ones the island has
   * agreed may reach into a bag — filling, drinking, pouring. Taking it out
   * comes first, because it is what the window is otherwise for.
   */
  private openMenu(item: Item, x: number, y: number): void {
    const target = { kind: 'item' as const, uid: item.uid };
    const entries: MenuItem[] = [{
      label: 'Take out',
      onSelect: () => {
        const def = ACTION_BY_ID.get('take_from_store');
        if (this.game.ask && def) {
          this.game.requestAction(def, { ...target, count: item.count });
          return;
        }
        const store = this.store();
        const got = store?.take(item.uid);
        if (got) this.game.inventory.addItem(got);
        this.render();
      },
    }];
    for (const { def, reason } of this.game.actionsFor(target)) {
      entries.push({
        label: def.label,
        hint: reason ?? undefined,
        disabled: !!reason,
        onSelect: () => this.game.requestAction(def, target),
      });
    }
    this.win.focus();
    this.showMenu?.(x, y, itemName(item), entries);
  }

  open(id: number): void {
    this.crateId = id;
    this.furnitureId = null;
    this.creatureId = null;
    this.bagUid = null;
    this.render();
    this.win.open();
  }

  openFurniture(id: number): void {
    this.furnitureId = id;
    this.crateId = null;
    this.creatureId = null;
    this.bagUid = null;
    this.render();
    this.win.open();
  }

  /** The panniers on a pack beast's back, seen through the same window. */
  /** Open a bag carried in the pack. */
  openBag(uid: number): void {
    this.bagUid = uid;
    this.crateId = null;
    this.furnitureId = null;
    this.creatureId = null;
    this.render();
    this.win.open();
  }

  openPannier(id: number): void {
    this.creatureId = id;
    this.crateId = null;
    this.furnitureId = null;
    this.bagUid = null;
    this.render();
    this.win.open();
  }
}
