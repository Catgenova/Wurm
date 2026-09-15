import type { ActionDef, Target } from './actions';
import { furnitureName, holdsLiquid, litresIn, type LiquidKind, type PlacedFurniture } from './furniture';
import type { Game } from './game';
import { itemDef } from './items';
import { world } from './pace';

/**
 * Brewing. Fill a barrel with water, tip in what you have grown or gathered,
 * and leave it alone. It works for as long as it works — a quarter of an hour
 * for ale, three quarters for wine — and nothing can hurry it. What comes out
 * is drawn off into a bucket like any other liquid and drunk from that, and
 * every one of them favours a trade far harder than any food does.
 */
export interface BrewDef {
  /** The liquid it becomes. */
  id: LiquidKind;
  name: string;
  /** What goes in besides the water, and how much of it. */
  input: string;
  count: number;
  /** Litres of water it wants, which is what you get back out. */
  litres: number;
  /** Seconds it works for. */
  time: number;
  /** How hard it is to set going right. */
  difficulty: number;
  done: string;
}

export const BREWS: BrewDef[] = [
  { id: 'ale', name: 'Ale', input: 'wheat', count: 12, litres: 15, time: world(15 * 60), difficulty: 12, done: 'You mash the wheat into the water and leave it to work. It will be ale.' },
  { id: 'cider', name: 'Cider', input: 'apple', count: 20, litres: 15, time: world(30 * 60), difficulty: 18, done: 'You break the apples into the water and bung the barrel. It will be cider.' },
  { id: 'mead', name: 'Mead', input: 'honey', count: 12, litres: 15, time: world(40 * 60), difficulty: 24, done: 'You stir the honey through until it goes. It will be mead, in its own time.' },
  { id: 'wine', name: 'Wine', input: 'cherry', count: 30, litres: 15, time: world(45 * 60), difficulty: 30, done: 'You crush the cherries into the water and seal it. It will be wine.' },
];

export const BREW_BY_ID = new Map(BREWS.map((b) => [b.id, b]));
export const isBrew = (liquid: LiquidKind | undefined): boolean => !!liquid && BREW_BY_ID.has(liquid);
/** Still working, and not to be drawn off until it has stopped. */
export const isWorking = (f: PlacedFurniture): boolean => (f.ferment ?? 0) > 0;

/** Anything you would actually put in your mouth. */
export const drinkable = (liquid: LiquidKind | undefined): boolean => liquid === 'water' || liquid === 'milk' || isBrew(liquid);

type FurnitureTarget = Extract<Target, { kind: 'furniture' }>;
const pieceOf = (g: Game, t: Target): PlacedFurniture | undefined => (t.kind === 'furniture' ? g.furniture.get((t as FurnitureTarget).id) : undefined);

/** Barrels near enough to tip something into. */
export function brewBarrel(g: Game, t: Target): PlacedFurniture | undefined {
  const f = pieceOf(g, t);
  return f && holdsLiquid(f) ? f : undefined;
}

/** Why this brew cannot be set going in this barrel, or null. */
export function brewReason(g: Game, f: PlacedFurniture | undefined, brew: BrewDef): string | null {
  if (!f) return 'Stand at a barrel.';
  if (!holdsLiquid(f)) return 'That holds no liquid.';
  if (isWorking(f)) return 'It is already working. Leave it alone.';
  if (f.liquid !== 'water') return `A brew is started in water. Empty the ${furnitureName(f).toLowerCase()} and fill it from a well.`;
  if (litresIn(f) < brew.litres) return `That takes ${brew.litres} litres of water; there are ${litresIn(f).toFixed(0)} in it.`;
  if (g.inventory.count(brew.input) < brew.count) return `That takes ${brew.count} × ${itemDef(brew.input).name.toLowerCase()}; you have ${g.inventory.count(brew.input)}.`;
  return null;
}

export const BREWING_ACTIONS: ActionDef[] = [
  {
    id: 'start_brew',
    label: 'Set a brew going',
    verb: 'setting a brew going',
    skill: 'brewing',
    hidden: true,
    stamina: 0.04,
    baseTime: 10,
    applies: (t, g) => brewBarrel(g, t) !== undefined,
    check: (t, g) => {
      const f = brewBarrel(g, t);
      const brew = t.kind === 'furniture' && t.brew ? BREW_BY_ID.get(t.brew as LiquidKind) : undefined;
      if (!brew) return 'Choose what to brew.';
      return brewReason(g, f, brew);
    },
    perform: (t, g) => {
      const f = brewBarrel(g, t);
      const brew = t.kind === 'furniture' && t.brew ? BREW_BY_ID.get(t.brew as LiquidKind) : undefined;
      if (!f || !brew || brewReason(g, f, brew)) return;
      // What goes in decides most of what comes out; the hand only decides
      // how much of it survives the working.
      const stock = g.inventory.find(brew.input);
      const stockQl = stock?.ql ?? 20;
      if (!g.inventory.consume(brew.input, brew.count)) return;
      if (!g.skillCheck('brewing', brew.difficulty, 0, g.mindEase())) {
        f.litres = Math.max(0, litresIn(f) - brew.litres);
        if (f.litres <= 0) f.liquid = undefined;
        g.gainSkill('brewing', 0.3);
        g.logMsg(`It will not take. You tip the whole soured lot out of the ${furnitureName(f).toLowerCase()}.`, 'event');
        g.events.emit('crate');
        return;
      }
      f.litres = brew.litres;
      f.liquid = brew.id;
      f.ferment = brew.time;
      f.ql = Math.max(1, Math.min(100, (stockQl + g.skills.get('brewing')) / 2));
      g.gainSkill('brewing', 0.6);
      g.note('brew');
      g.note(`brew:${brew.id}`);
      g.logMsg(`${brew.done} (about ${Math.round(brew.time / 60)} minutes)`, 'event');
      g.events.emit('crate');
    },
  },
];

export const BREWING_ACTION_BY_ID = new Map(BREWING_ACTIONS.map((a) => [a.id, a]));
