import { crateCentre, crateCapacity, crateName, crateUnits } from '../../game/crates';
import { furnitureCapacity, furnitureCentre, furnitureHeft, furnitureHolds, furnitureKg, furnitureName, furnitureUnits } from '../../game/furniture';
import type { Game } from '../../game/game';
import { itemDef, itemName, type Item } from '../../game/items';
import type { UIWindow } from '../windows';

/**
 * Where everything is.
 *
 * A settlement of any age has a dozen crates, bins, chests and carts in it,
 * and the only way to find out which one has the planks used to be opening
 * all of them. This window is that question answered: type what you are
 * looking for and it says which store holds it, how many, and how far off it
 * is, and one click walks you there.
 */

interface Holder {
  name: string;
  centre: [number, number];
  items: Item[];
  units: number;
  capacity: number;
  /**
   * Kilograms in it and kilograms it holds, for a store measured that way
   * rather than by count. A craft material bin has no count limit at all, so
   * `capacity` is nought on one and reading fullness off it would call an
   * empty bin full.
   */
  kg?: number;
  heft?: number;
  /** A crate id or a furniture id, for opening it. */
  crate?: number;
  piece?: number;
}

/** Whether a store has nothing left, whichever way it is measured. */
const brimming = (h: Holder): boolean => (h.heft ? (h.kg ?? 0) >= h.heft : h.units >= h.capacity);

export class StoresPanel {
  private list: HTMLDivElement;
  private footer: HTMLDivElement;
  private search: HTMLInputElement;
  private query = '';
  private lastRender = 0;

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly openCrate: (id: number) => void,
    private readonly openFurniture: (id: number) => void,
  ) {
    win.body.classList.add('inv-body');
    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.className = 'panel-search';
    this.search.placeholder = 'What are you looking for?';
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
    this.list = document.createElement('div');
    this.list.className = 'inv-list';
    this.footer = document.createElement('div');
    this.footer.className = 'inv-footer';
    win.body.append(this.search, this.list, this.footer);
    game.events.on('crate', () => this.render());
    game.events.on('world', () => this.render());
    this.render();
  }

  /** Redraw a few times a second while open; workers are filling these. */
  update(now: number): void {
    if (!this.win.isOpen || now - this.lastRender < 700) return;
    this.lastRender = now;
    this.render();
  }

  /** Every container you own, wherever it is. */
  private holders(): Holder[] {
    const g = this.game;
    const out: Holder[] = [];
    for (const c of g.crates.values()) {
      out.push({ name: crateName(c), centre: crateCentre(c), items: c.items, units: crateUnits(c), capacity: crateCapacity(c), crate: c.id });
    }
    for (const f of g.furniture.values()) {
      if (!furnitureHolds(f)) continue;
      out.push({
        name: furnitureName(f), centre: furnitureCentre(f), items: f.items,
        units: furnitureUnits(f), capacity: furnitureCapacity(f),
        kg: furnitureKg(f), heft: furnitureHeft(f) || undefined, piece: f.id,
      });
    }
    return out;
  }

  private far(h: Holder): number {
    return Math.hypot(h.centre[0] - this.game.player.x, h.centre[1] - this.game.player.y);
  }

  /** What in this store answers to what was typed. */
  private hits(h: Holder): Item[] {
    if (!this.query) return [];
    return h.items.filter((it) => `${itemName(it)} ${itemDef(it.id).category}`.toLowerCase().includes(this.query));
  }

  render(): void {
    const all = this.holders();
    const shown = this.query ? all.filter((h) => this.hits(h).length) : all;
    shown.sort((a, b) => this.far(a) - this.far(b));
    this.list.replaceChildren();
    if (!all.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = 'You have put nothing down yet. Build a crate and set it somewhere.';
      this.list.append(empty);
      this.footer.textContent = '';
      return;
    }
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = `Nothing in any of your ${all.length} stores answers to “${this.search.value.trim()}”.`;
      this.list.append(empty);
    }
    for (const h of shown.slice(0, 60)) this.list.append(this.row(h));
    const held = all.reduce((n, h) => n + h.units, 0);
    const room = all.reduce((n, h) => n + h.capacity, 0);
    const full = all.filter(brimming).length;
    this.footer.textContent = `${all.length} stores · ${held} of ${room} things${full ? ` · ${full} full` : ''}`;
    this.footer.classList.toggle('inv-over', full > 0 && full === all.length);
  }

  private row(h: Holder): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'store-row';
    const name = document.createElement('div');
    name.className = 'store-name';
    const d = this.far(h);
    name.textContent = `${h.name} · ${d < 1.5 ? 'here' : `${Math.round(d)} tiles`}`;
    const fill = document.createElement('span');
    fill.className = 'store-fill';
    fill.textContent = h.heft ? `${(h.kg ?? 0).toFixed(0)}/${h.heft} kg` : `${h.units}/${h.capacity}`;
    if (brimming(h)) fill.classList.add('store-full');
    name.append(fill);
    const what = document.createElement('div');
    what.className = 'store-what';
    const hits = this.hits(h);
    const list = (hits.length ? hits : h.items).slice(0, 6);
    what.textContent = list.length
      ? `${hits.length ? '' : 'holds '}${list.map((it) => `${it.count} × ${itemName(it).toLowerCase()}`).join(', ')}${(hits.length ? hits : h.items).length > 6 ? ' …' : ''}`
      : 'empty';
    if (hits.length) what.classList.add('store-hit');
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'tb-btn tb-small';
    go.textContent = d < 2.4 ? 'Open' : 'Walk there';
    go.addEventListener('click', (e) => {
      e.stopPropagation();
      if (d < 2.4) {
        if (h.crate !== undefined) this.openCrate(h.crate);
        else if (h.piece !== undefined) this.openFurniture(h.piece);
        return;
      }
      this.game.moveTo(Math.floor(h.centre[0]), Math.floor(h.centre[1]));
      this.game.logMsg(`Walking to the ${h.name.toLowerCase()}.`, 'info');
    });
    row.append(name, what, go);
    return row;
  }
}
