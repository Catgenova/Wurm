import { ACTION_BY_ID } from '../../game/actions';
import type { Game } from '../../game/game';
import { itemDef } from '../../game/items';
import { RECIPE_CATEGORIES, RECIPES, recipeStatus, type Recipe, type RecipeStatus } from '../../game/recipes';
import { SKILL_DEFS } from '../../game/skills';
import type { UIWindow } from '../windows';

const skillName = (id: string): string => SKILL_DEFS.find((s) => s.id === id)?.name ?? id;
const lower = (id: string): string => itemDef(id).name.toLowerCase();

/**
 * Everything that can be made from what the player carries, grouped by
 * craft. Recipes missing a tool or material stay hidden unless "show every
 * recipe" is on, in which case the missing parts are marked.
 */
export class CraftPanel {
  private list: HTMLDivElement;
  private footer: HTMLDivElement;
  private showAll = false;

  constructor(win: UIWindow, private readonly game: Game) {
    win.body.classList.add('inv-body');
    const head = document.createElement('div');
    head.className = 'craft-head';
    const hint = document.createElement('span');
    hint.textContent = 'Tool plus materials from your inventory';
    const toggle = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      this.showAll = box.checked;
      this.render();
    });
    toggle.append(box, document.createTextNode('Show every recipe'));
    head.append(hint, toggle);
    this.list = document.createElement('div');
    this.list.className = 'inv-list';
    this.footer = document.createElement('div');
    this.footer.className = 'inv-footer';
    win.body.append(head, this.list, this.footer);
    game.events.on('inventory', () => this.render());
    game.events.on('skill', () => this.render());
    this.render();
  }

  render(): void {
    const statuses = new Map<Recipe, RecipeStatus>(RECIPES.map((r) => [r, recipeStatus(r, this.game)]));
    this.list.replaceChildren();
    let shown = 0;
    let ready = 0;
    for (const cat of RECIPE_CATEGORIES) {
      const rows = RECIPES.filter((r) => r.category === cat && (this.showAll || statuses.get(r)?.ready));
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
      empty.textContent = 'Nothing can be made with what you carry. Tick "Show every recipe" to see what each thing needs.';
      this.list.append(empty);
    }
    this.footer.textContent = `${ready} of ${RECIPES.length} recipes possible with what you carry`;
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
