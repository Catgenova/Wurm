/**
 * Every wildermon and every drop of blood it can be born with, as JSON.
 *
 * The roster on the page nobody should ever have to hand-edit. `SPECIES` and
 * `TRAITS` are the book — the browser reads them, `dump-defs.ts` turns them
 * into rows for the island, and this turns them into a page. Add a species or
 * a trait in `src/game/` and the guide is one `npm run wildermon` behind it;
 * copy a number out by hand and it is wrong the first time either side moves.
 *
 * Nothing here decides anything. Every figure is read off the definitions, and
 * the only things invented are the words a chip is printed with.
 */
import {
  AGES, COMPANION_SIGHT, GATHER_DO, GATHER_SKILL, GATHER_VERB, MONSTERS, MONSTER_CAP, MONSTER_SHARE,
  OLD_AT, RANGE_PER_STEP, SPECIES, WILD_SPECIES, YOUNG_FOR,
  type GatherKind, type SpeciesDef,
} from '../src/game/creatures';
import {
  CHANNELS, FIGHT_SHARE, FIGHTING, GRADE_STEP, HUSBANDRY_LIFT, TIER_COLOUR, TIERS, TRAIT_SLOTS, TRAITS,
  WILD_ODDS, husbandryOdds, isGain, pct, type TraitChannel, type TraitDef,
} from '../src/game/traits';
import { BUTCHER_PARTS } from '../src/game/butcher';
import { itemDef } from '../src/game/items';
import { SKILL_DEFS } from '../src/game/skills';
import { WOUND_KINDS } from '../src/game/wounds';

const skillName = (id: string): string => SKILL_DEFS.find((s) => s.id === id)?.name ?? id;
const itemName = (id: string): string => itemDef(id).name;

/** What a trade is worth on a card: the trade, the skill it trains, and what the animal actually does. */
const trade = (kind: GatherKind) => ({
  id: kind,
  name: GATHER_VERB[kind],
  does: GATHER_DO[kind],
  skill: GATHER_SKILL[kind],
  skillName: skillName(GATHER_SKILL[kind]),
});

/** Where it will settle, in the words the ground is written in. */
const HABITAT: Array<[keyof SpeciesDef, string]> = [
  ['nearWater', 'by water'],
  ['nearTrees', 'among trees'],
  ['onOre', 'on a seam'],
  ['onSand', 'on sand'],
  ['nearClay', 'by clay'],
  ['nearTar', 'on the black ground'],
  ['onStone', 'on bare rock'],
];

/**
 * What the thing is *for*, beyond its trade. Each of these is a capability the
 * definition either has or has not; the word beside it is the only invention.
 */
function roles(d: SpeciesDef): Array<{ id: string; name: string; note: string }> {
  const out: Array<{ id: string; name: string; note: string }> = [];
  const add = (id: string, name: string, note: string) => out.push({ id, name, note });
  if (d.monster) add('monster', 'Monster', 'Cannot be tamed, trapped, bred or kept. It comes at you.');
  if (d.gathers) add('work', GATHER_VERB[d.gathers], `Set to work on a deed it will ${GATHER_DO[d.gathers]}.`);
  for (const k of d.trades ?? []) if (k !== d.gathers) add('work', GATHER_VERB[k], `It may be set instead to ${GATHER_DO[k]}.`);
  if (d.mount) add('mount', 'Mount', 'Saddle and bridle it and ride.');
  if (d.draught) add('draught', 'Draught', 'It goes in the traces and learns the hills as it pulls.');
  if (d.pannier) add('pannier', 'Packbeast', `Panniers on its own back: ${d.pannier} kg.`);
  if (d.swims) add('swims', 'Swimmer', 'It crosses deep water with a rider on its back.');
  if (d.fleece) add('fleece', d.shearYield === 'feather' ? 'Feathers' : 'Fleece', `Shear it every ${Math.round(1 / d.fleece / 60)} minutes.`);
  if (d.milk) add('milk', 'Dairy', 'It can be milked into an empty bucket.');
  if (d.hives) add('hives', 'Bees', 'It keeps a hive of its own going while one stands on the deed.');
  if (d.glow) add('glow', 'Lantern', `It lights ${d.glow} tiles of ground at any hour.`);
  if ((d.sight ?? COMPANION_SIGHT) > COMPANION_SIGHT) add('sight', 'Watcher', `It sees ${d.sight} tiles for you.`);
  if (d.hunter && !d.monster) add('hunter', 'Hunter', 'It comes for you on sight rather than waiting to be struck.');
  return out;
}

const wildWeight = new Map(WILD_SPECIES);
const monsterWeight = new Map(MONSTERS);
const wildTotal = WILD_SPECIES.reduce((n, [, w]) => n + w, 0);
const monsterTotal = MONSTERS.reduce((n, [, w]) => n + w, 0);

const species = Object.values(SPECIES).map((d) => {
  const wild = wildWeight.get(d.id);
  const mon = monsterWeight.get(d.id);
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    monster: !!d.monster,
    roles: roles(d),
    trade: d.gathers ? trade(d.gathers) : null,
    trades: (d.trades ?? []).map(trade),
    /** The share of what the wild throws up that is this, as a share of one. */
    share: wild !== undefined ? (wild / wildTotal) * (1 - MONSTER_SHARE)
      : mon !== undefined ? (mon / monsterTotal) * MONSTER_SHARE : null,
    cap: mon !== undefined ? MONSTER_CAP[d.id] ?? 1 : null,
    stats: {
      health: d.health,
      attack: d.attack,
      speed: d.speed,
      tameLevel: d.tameLevel,
      tameChance: d.tameChance,
      workRange: d.workRange,
      rangePerStep: d.rangePerStep ?? RANGE_PER_STEP,
      sight: d.sight ?? COMPANION_SIGHT,
      notice: d.notice ?? null,
      mount: d.mount ?? null,
      pull: d.draught || d.pull !== undefined ? d.pull ?? 0.25 : null,
      pitch: d.pitch ?? null,
      pannier: d.pannier ?? null,
      fleeceSeconds: d.fleece ? Math.round(1 / d.fleece) : null,
      glow: d.glow ?? null,
      unruly: d.unruly ?? null,
    },
    flags: {
      timid: !!d.timid,
      defensive: !!d.defensive,
      hunter: !!d.hunter,
      nocturnal: !!d.nocturnal,
      draught: !!d.draught,
      swims: !!d.swims,
      milk: !!d.milk,
      hives: !!d.hives,
    },
    stance: d.defaultStance ?? 'defensive',
    wound: WOUND_KINDS[d.wound ?? 'bite'].name,
    habitat: HABITAT.filter(([k]) => d[k]).map(([, word]) => word),
    diet: d.diet.map(itemName),
    baitHint: d.baitHint,
    butcher: BUTCHER_PARTS.filter(([p]) => (d.butcher[p] ?? 0) > 0)
      .map(([p, item]) => ({ part: p, name: itemName(item), n: d.butcher[p] as number })),
    variants: d.variants.map(([body, belly]) => ({ body, belly })),
    tameFail: d.tameFail,
    leaves: d.leaves,
  };
});

/** A trait's effects, written the way a card writes them. */
const effects = (t: TraitDef) => Object.entries(t.effects).map(([ch, mul]) => ({
  channel: ch,
  label: CHANNELS.find((c) => c.id === ch)?.label ?? ch,
  mul,
  pct: pct(mul),
  gain: isGain(ch as TraitChannel, mul),
}));

const traits = TRAITS.map((t) => ({
  id: t.id,
  name: t.name,
  tier: t.tier,
  family: t.family ?? null,
  aura: !!t.aura,
  note: t.note,
  effects: effects(t),
}));

const families = FIGHTING.map((f) => ({
  id: f.id,
  name: f.name,
  aura: !!f.aura,
  note: f.note,
  /** The four grades of the one name, in order. */
  grades: TIERS.map((tier) => traits.find((t) => t.family === f.id && t.tier === tier)!),
}));

const data = {
  slots: TRAIT_SLOTS,
  fightShare: FIGHT_SHARE,
  wildOdds: WILD_ODDS,
  /**
   * The same table for a keeper at the top of animal husbandry, as shares of
   * one: `rollTier` divides by the total, and lifted rows do not add up to it.
   */
  bredOdds: (() => {
    const odds = husbandryOdds(100);
    const total = TIERS.reduce((n, t) => n + odds[t], 0);
    return Object.fromEntries(TIERS.map((t) => [t, odds[t] / total])) as Record<string, number>;
  })(),
  husbandryLift: HUSBANDRY_LIFT,
  gradeStep: GRADE_STEP,
  tiers: TIERS.map((id) => ({ id, colour: TIER_COLOUR[id] })),
  channels: CHANNELS,
  ages: Object.values(AGES),
  youngFor: YOUNG_FOR,
  oldAt: OLD_AT,
  monsterShare: MONSTER_SHARE,
  rangePerStep: RANGE_PER_STEP,
  species,
  traits,
  families,
  plain: traits.filter((t) => !t.family),
};

process.stdout.write(JSON.stringify(data));
