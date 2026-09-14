import { crateCentre, crateName, crateCapacity, crateUnits } from '../../game/crates';
import { furnitureCapacity, furnitureCentre, furnitureName, furnitureRefuses, furnitureUnits } from '../../game/furniture';
import { bloodMul } from '../../game/creatures';
import type { Game } from '../../game/game';
import { bagAdd, bagRefuses, bagRoom, bagTake, itemDef, type Item, itemName } from '../../game/items';
import { makeDraggable, makeDropZone, type DragPayload } from '../dragdrop';
import type { UIWindow } from '../windows';

/** A crate or a piece of storage furniture, seen through the same window. */
export interface Store {
  title: string;
  items: Item[];
  capacity: number;
  centre: [number, number];
  what: string;
  take: (uid: number) => Item | null;
  /** Why it will not take this, or null. */
  refuses: (item: Item) => string | null;
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

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly dropped?: (p: DragPayload) => void,
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
    this.bar.append(takeAll, putAll, putKind);
    win.body.append(head, this.list, this.bar, this.footer);
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
    return Math.hypot(cx - this.game.player.x, cy - this.game.player.y) <= 2.4;
  }

  private store(): Store | undefined {
    const crate = this.crateId !== null ? this.game.crates.get(this.crateId) : undefined;
    if (crate) {
      return {
        title: crateName(crate),
        items: crate.items,
        capacity: crateCapacity(crate),
        centre: crateCentre(crate),
        what: 'crate',
        take: (uid) => this.game.crateTake(crate, uid),
        refuses: (item) => (crateUnits(crate) + item.count > crateCapacity(crate) ? `The ${crateName(crate).toLowerCase()} is full.` : null),
        add: (item) => this.game.crateAdd(crate, item),
      };
    }
    const beast = this.creatureId !== null ? this.game.creatures.get(this.creatureId) : undefined;
    if (beast) {
      const cap = Math.round((this.game.creatures.species(beast).pannier ?? 0) * bloodMul(beast, 'haul'));
      const units = (): number => beast.pannier.reduce((n, it) => n + it.count, 0);
      return {
        title: `${beast.name}'s panniers`,
        items: beast.pannier,
        capacity: cap,
        centre: [beast.x, beast.y],
        what: 'panniers',
        take: (uid) => this.game.pannierTake(beast, uid),
        refuses: (item) => (units() + item.count > cap ? `${beast.name} is loaded as it is.` : null),
        add: (item) => this.game.pannierAdd(beast, item),
      };
    }
    // A bag carried in the pack, seen through the same window as a crate.
    const bag = this.bagUid !== null ? this.game.inventory.get(this.bagUid) : undefined;
    if (bag && bagRoom(bag)) {
      return {
        title: `${itemName(bag)} (QL ${bag.ql.toFixed(0)})`,
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
        refuses: (item) => bagRefuses(bag, item),
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
        items: piece.items,
        capacity: furnitureCapacity(piece),
        centre: furnitureCentre(piece),
        what: furnitureName(piece).toLowerCase(),
        take: (uid) => this.game.furnitureTake(piece, uid),
        refuses: (item) => furnitureRefuses(piece, item) ?? (furnitureUnits(piece) + item.count > furnitureCapacity(piece) ? `The ${furnitureName(piece).toLowerCase()} is full.` : null),
        add: (item) => this.game.furnitureAdd(piece, item),
      };
    }
    return undefined;
  }

  /** Empty the open store into the pack, as far as it will go. */
  private takeAll(): void {
    const store = this.store();
    if (!store) return;
    if (!this.withinReach()) {
      this.game.logMsg(`Stand next to the ${store.what} to take things out.`, 'error');
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
    let moved = 0;
    let refused = '';
    for (const item of [...this.game.inventory.items]) {
      if (item.locked || this.game.isEquipped(item.uid)) continue;
      if (sameKinds && !kinds.has(item.id)) continue;
      const why = store.refuses(item);
      if (why) {
        refused ||= why;
        continue;
      }
      const taken = this.game.inventory.take(item.uid, item.count);
      if (!taken) continue;
      if (store.add(taken)) moved += taken.count;
      else this.game.inventory.addItem(taken);
    }
    this.game.events.emit('inventory');
    this.game.logMsg(
      moved ? `You put ${moved} things into the ${store.what}.${refused ? ` ${refused}` : ''}` : refused || `There is nothing loose to put in the ${store.what}.`,
      moved ? 'event' : 'error',
    );
    this.render();
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
    this.win.titleText.textContent = store.title;
    this.bar.hidden = false;
    if (!store.items.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = `The ${store.what} is empty.`;
      this.list.append(empty);
    }
    for (const item of [...store.items].sort((a, b) => itemName(a).localeCompare(itemName(b)))) {
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
        const [cx, cy] = store.centre;
        if (Math.hypot(cx - this.game.player.x, cy - this.game.player.y) > 2.4) {
          this.game.logMsg(`Stand next to the ${store.what} to take things out.`, 'error');
          return;
        }
        const it = store.take(item.uid);
        if (it) this.game.inventory.addItem(it);
      });
      row.append(name, ql, dmg, take);
      makeDraggable(row, { uid: item.uid, from: 'store', name: itemName(item) });
      this.list.append(row);
    }
    const weight = store.items.reduce((s, it) => s + itemDef(it.id).weight * it.count, 0);
    const used = store.items.reduce((n, it) => n + it.count, 0);
    this.footer.textContent = `${used} / ${store.capacity} things · ${weight.toFixed(1)} kg`;
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
