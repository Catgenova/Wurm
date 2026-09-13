import { ACTION_BY_ID } from '../../game/actions';
import type { Game } from '../../game/game';
import { itemDef } from '../../game/items';
import { RECIPE_CATEGORIES, RECIPES, recipeStatus, stationName, type Recipe, type RecipeStatus } from '../../game/recipes';
import { SKILL_DEFS } from '../../game/skills';
import type { UIWindow } from '../windows';

const skillName = (id: string): string => SKILL_DEFS.find((s) => s.id === id)?.name ?? id;
const lower = (id: string): string => itemDef(id).name.toLowerCase();

/**
 * The recipe book, grouped by craft. Every recipe is listed with its tool and
 * materials marked green when carried and red when missing, and the ones that
 * can be made right now come first. A switch narrows it to just those.
 */
export class CraftPanel {
  private list: HTMLDivElement;
  private footer: HTMLDivElement;
  private search: HTMLInputElement;
  private query = '';
  private readyOnly = false;

  constructor(win: UIWindow, private readonly game: Game) {
    win.body.classList.add('inv-body');
    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.className = 'panel-search';
    this.search.placeholder = 'Search recipes: a thing, a skill, a material…';
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
    const head = document.createElement('div');
    head.className = 'craft-head';
    const hint = document.createElement('span');
    hint.textContent = 'Tool, place and materials each recipe needs';
    const toggle = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      this.readyOnly = box.checked;
      this.render();
    });
    toggle.append(box, document.createTextNode('Only what I can make'));
    head.append(hint, toggle);
    this.list = document.createElement('div');
    this.list.className = 'inv-list';
    this.footer = document.createElement('div');
    this.footer.className = 'inv-footer';
    win.body.append(this.search, head, this.list, this.footer);
    game.events.on('inventory', () => this.render());
    game.events.on('skill', () => this.render());
    this.render();
  }

  /**
   * Whether a recipe answers to what has been typed. Everything on the row is
   * searchable: what it makes, the trade it takes, where it is worked and what
   * goes into it, so "leather", "mason" and "nail" all find their own.
   */
  private matches(r: Recipe): boolean {
    if (!this.query) return true;
    const parts = [itemDef(r.result).name, r.label, r.category, skillName(r.skill), r.tool ? lower(r.tool) : '', r.station ? stationName(r.station) : '', ...r.inputs.map((i) => lower(i.item))];
    return parts.join(' ').toLowerCase().includes(this.query);
  }

  render(): void {
    const statuses = new Map<Recipe, RecipeStatus>(RECIPES.map((r) => [r, recipeStatus(r, this.game)]));
    this.list.replaceChildren();
    let shown = 0;
    let ready = 0;
    for (const cat of RECIPE_CATEGORIES) {
      const rows = RECIPES.filter((r) => r.category === cat && this.matches(r) && (!this.readyOnly || statuses.get(r)?.ready));
      // What can be made now sits above what still needs gathering.
      rows.sort((a, b) => Number(statuses.get(b)?.ready ?? false) - Number(statuses.get(a)?.ready ?? false));
      if (!rows.length) continue;
      const header = document.createElement('div');
      header.className = 'inv-group';
      header.textContent = cat;
      this.list.append(header);
      for (const r of rows) {
        const st = statuses.get(r)!;
        this.list.append(this.row(r, st));
        shown++;
        if (st.ready) ready++;
      }
    }
    if (!shown) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = this.query
        ? `No recipe answers to “${this.search.value.trim()}”${this.readyOnly ? ' that you can make right now' : ''}.`
        : 'Nothing can be made with what you carry. Untick "Only what I can make" to see what each thing needs.';
      this.list.append(empty);
    }
    this.footer.textContent = this.query
      ? `${shown} recipes match, ${ready} of them possible with what you carry`
      : `${ready} of ${RECIPES.length} recipes possible with what you carry`;
  }

  private row(r: Recipe, st: RecipeStatus): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'craft-row' + (st.ready ? '' : ' locked');
    const name = document.createElement('div');
    name.className = 'craft-name';
    const count = r.count ?? 1;
    name.textContent = count > 1 ? `${itemDef(r.result).name} × ${count}` : itemDef(r.result).name;
    const meta = document.createElement('small');
    meta.textContent = `${skillName(r.skill)} · ${this.game.duration(ACTION_BY_ID.get(r.id)!).toFixed(0)} s`;
    name.append(meta);
    const needs = document.createElement('div');
    needs.className = 'craft-needs';
    const parts: HTMLSpanElement[] = [];
    if (r.station) {
      const station = document.createElement('span');
      station.className = st.station ? 'have' : 'lack';
      station.textContent = stationName(r.station);
      station.title = st.station ? 'You are standing at one' : 'Not within reach of one';
      parts.push(station);
    }
    if (r.tool) {
      const tool = document.createElement('span');
      tool.className = st.tool ? 'have' : 'lack';
      tool.textContent = lower(r.tool);
      tool.title = st.tool ? 'Carried' : 'Not carried';
      parts.push(tool);
    }
    for (const i of st.inputs) {
      const span = document.createElement('span');
      span.className = i.have >= i.need ? 'have' : 'lack';
      span.textContent = `${i.need} ${lower(i.item)}`;
      span.title = `Have ${i.have}`;
      const have = document.createElement('em');
      have.textContent = ` (${i.have})`;
      span.append(have);
      parts.push(span);
    }
    parts.forEach((p, k) => {
      if (k) needs.append(document.createTextNode(' · '));
      needs.append(p);
    });
    const buttons = document.createElement('div');
    buttons.className = 'craft-btns';
    const craft = document.createElement('button');
    craft.type = 'button';
    craft.className = 'tb-btn tb-small';
    craft.textContent = 'Craft';
    craft.disabled = !st.ready;
    craft.addEventListener('click', () => this.craft(r, 1));
    buttons.append(craft);
    if (st.max > 1) {
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'tb-btn tb-small';
      all.textContent = `× ${st.max}`;
      all.title = `Make ${st.max}, one after another`;
      all.addEventListener('click', () => this.craft(r, st.max));
      buttons.append(all);
    }
    row.append(name, buttons, needs);
    return row;
  }

  private craft(r: Recipe, times: number): void {
    const def = ACTION_BY_ID.get(r.id);
    const material = this.game.inventory.find(r.inputs[0].item);
    if (!def || !material) return;
    this.game.requestAction(def, { kind: 'item', uid: material.uid, count: times });
  }
}
