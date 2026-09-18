import { GEMS, tradeName, type GemDef } from './gems';
import { METAL_BY_LUMP, METALS } from './metal';
import { TREE_DEFS } from '../world/tiles';

/**
 * What a thing is made of, and what that is worth.
 *
 * Wurm's rule is that the same bill of materials in two different woods, or
 * two different metals, makes two different things. An oak chest outlasts a
 * pine one and is harder work to build; a cedar barrel is still sound when
 * the birch one beside it has gone; a lead sword is a joke and an adamantine
 * one is not. Every wood and every metal carries the same eight numbers, and
 * everything made of it reads whichever of them apply to the sort of thing
 * it is.
 */
export type MaterialKind = 'wood' | 'metal' | 'gem';

export interface MaterialDef {
  id: string;
  name: string;
  kind: MaterialKind;
  /** Added to the difficulty of anything made of it: hard woods fight back. */
  difficulty: number;
  /** Multiplier on the finished thing's weight. */
  weight: number;
  /** Multiplier on damage it takes in use, and on the blows armour soaks up. */
  wear: number;
  /** Multiplier on how fast it rots when it is left out. */
  decay: number;
  /** Multiplier on the harm a weapon of it does. */
  edge: number;
  /** Multiplier on the share of a blow armour of it turns aside. */
  soak: number;
  /** Multiplier on a tool's working quality: how fast and how true it cuts. */
  bite: number;
  /** Multiplier on what a container or a cart of it will hold. */
  hold: number;
  /** Strikes the unnatural harder than its edge alone would say. */
  bane?: boolean;
  /** One line, for the examine window. */
  note: string;
}

type Props = Omit<MaterialDef, 'id' | 'name' | 'kind'>;

/**
 * The six woods. Pine is the cheap softwood that grows everywhere and rots as
 * fast as it grew; oak is the one that costs you an afternoon and outlives
 * you; cedar is the one that does not rot. Birch and willow are light and
 * springy, which is what a bow wants and a wall does not.
 */
const WOOD_PROPS: Record<string, Props> = {
  Birch: { difficulty: -1, weight: 0.88, wear: 1.02, decay: 1.05, edge: 1, soak: 0.96, bite: 1.04, hold: 1, note: 'Light and even-grained. The bowyer\'s wood for a medium bow.' },
  Pine: { difficulty: -3, weight: 0.8, wear: 1.2, decay: 1.25, edge: 0.9, soak: 0.88, bite: 1.06, hold: 0.95, note: 'Soft, quick to work and quick to rot. Good for what you mean to replace.' },
  Oak: { difficulty: 5, weight: 1.22, wear: 0.68, decay: 0.85, edge: 1.12, soak: 1.16, bite: 0.94, hold: 1.12, note: 'Hard going and worth it: an oak thing takes a third of the knocks and carries more.' },
  Maple: { difficulty: 1, weight: 1.05, wear: 0.9, decay: 1, edge: 1.05, soak: 1.02, bite: 1, hold: 1.05, note: 'Even-tempered. Nothing it is best at and nothing it is bad at.' },
  Willow: { difficulty: -3, weight: 0.78, wear: 1.12, decay: 1.12, edge: 0.94, soak: 0.9, bite: 1.08, hold: 0.95, note: 'Springy and very light. The bowyer\'s wood for a short bow.' },
  Cedar: { difficulty: 4, weight: 0.9, wear: 0.86, decay: 0.35, edge: 1, soak: 1, bite: 0.98, hold: 1, note: 'Barely rots at all. Whatever you leave out in the rain, make it of this.' },
  // Orchard woods: little of them off any one tree, and all three are close
  // grained and hard for it.
  Apple: { difficulty: 3, weight: 1.18, wear: 0.74, decay: 0.95, edge: 1.08, soak: 1.1, hold: 1.06, bite: 1.02, note: 'Close, hard and heavy for a small tree. Wears like oak and takes a finer edge.' },
  Cherry: { difficulty: 2, weight: 1.02, wear: 0.82, decay: 0.9, edge: 1.06, soak: 1.06, bite: 1.1, hold: 1.04, note: 'Fine in the grain and stable with it. The best wood on the island for a tool handle.' },
  Olive: { difficulty: 6, weight: 1.3, wear: 0.6, decay: 0.55, edge: 1.14, soak: 1.2, bite: 0.9, hold: 1.08, note: 'Wild grained, oily and nearly unsplittable. Murder to work and it outlasts everything.' },
  // And the eight held to their islands, which are orchard woods too: close
  // grained, hard for their size, and little of any of them off one tree.
  Pear: { difficulty: 3, weight: 1.16, wear: 0.76, decay: 0.95, edge: 1.06, soak: 1.08, bite: 1.06, hold: 1.05, note: 'Close and pink-brown, and it carves cleaner than apple. The turner\'s wood.' },
  Plum: { difficulty: 3, weight: 1.12, wear: 0.78, decay: 0.9, edge: 1.08, soak: 1.06, bite: 1.02, hold: 1.04, note: 'Hard and streaked with red. Handsome in a handle, and it holds a polish.' },
  Peach: { difficulty: 1, weight: 1, wear: 0.94, decay: 1.05, edge: 1.02, soak: 1, bite: 1.02, hold: 1, note: 'Soft for an orchard wood and quick to rot. Good for what you mean to replace.' },
  Fig: { difficulty: 0, weight: 0.86, wear: 1.05, decay: 1.15, edge: 0.96, soak: 0.94, bite: 1, hold: 0.98, note: 'Light, spongy and not much good for anything but the fruit. Plant it for that.' },
  Lemon: { difficulty: 2, weight: 1.06, wear: 0.86, decay: 0.85, edge: 1.04, soak: 1.04, bite: 1.04, hold: 1.02, note: 'Pale, even and faintly scented on the saw. A fine wood for small work.' },
  Pomegranate: { difficulty: 4, weight: 1.2, wear: 0.72, decay: 0.8, edge: 1.1, soak: 1.1, bite: 0.98, hold: 1.06, note: 'Dense and twisted, off a small tree. Stubborn to work and very hard-wearing.' },
  Apricot: { difficulty: 2, weight: 1.08, wear: 0.84, decay: 0.9, edge: 1.06, soak: 1.04, bite: 1.04, hold: 1.02, note: 'Hard and golden, close to plum. Little of it, and worth keeping for a handle.' },
  Quince: { difficulty: 3, weight: 1.14, wear: 0.78, decay: 0.92, edge: 1.06, soak: 1.06, bite: 1.02, hold: 1.04, note: 'Close-grained like pear and a shade harder. It takes a fine edge.' },
};

/**
 * The fourteen metals. Copper is the workhorse everything starts in; tin,
 * zinc, lead and pewter are too soft to be anything but stock; silver and
 * gold are for show and for the things silver is good against; bronze and
 * brass are the first real step up; and the four out of the deep seams —
 * adamantine, glimmersteel, mithril and seryll — are what a lifetime of
 * mining is for.
 */
const METAL_PROPS: Record<string, Props> = {
  copper: { difficulty: 0, weight: 1, wear: 1, decay: 1, edge: 0.85, soak: 0.9, bite: 0.9, hold: 1, note: 'The metal everything starts in. Soft, plentiful, forgiving.' },
  iron: { difficulty: 2, weight: 1.1, wear: 0.75, decay: 1.35, edge: 1.12, soak: 1.12, bite: 1.1, hold: 1, note: 'What the island is really built on. Harder than copper at everything, and it rusts if you leave it out.' },
  steel: { difficulty: 5, weight: 1.05, wear: 0.5, decay: 0.95, edge: 1.28, soak: 1.22, bite: 1.24, hold: 1, note: 'Iron with coal beaten through it. Keeps an edge twice as long and shrugs off the weather.' },
  tin: { difficulty: -2, weight: 0.85, wear: 1.5, decay: 1.1, edge: 0.5, soak: 0.55, bite: 0.6, hold: 1, note: 'Too soft to be anything but stock for an alloy.' },
  zinc: { difficulty: -1, weight: 0.9, wear: 1.4, decay: 1.05, edge: 0.55, soak: 0.6, bite: 0.65, hold: 1, note: 'Brittle. It goes into brass and not into anything you swing.' },
  lead: { difficulty: -3, weight: 1.95, wear: 1.6, decay: 0.7, edge: 0.45, soak: 0.72, bite: 0.5, hold: 1, note: 'Heavy and soft. A lead tool bends the first time you lean on it.' },
  silver: { difficulty: 4, weight: 1.2, wear: 1.2, decay: 0.45, edge: 0.9, soak: 0.86, bite: 0.86, hold: 1, bane: true, note: 'Barely tarnishes, and bites the unnatural far harder than its edge says.' },
  gold: { difficulty: 7, weight: 2.1, wear: 1.5, decay: 0.15, edge: 0.6, soak: 0.75, bite: 0.6, hold: 1, note: 'Never decays and is no use for anything else. Wear it, do not fight in it.' },
  bronze: { difficulty: 1, weight: 1.05, wear: 0.85, decay: 0.8, edge: 1.06, soak: 1.06, bite: 1.06, hold: 1, note: 'The first alloy worth the crucible: harder than copper in every way.' },
  brass: { difficulty: 1, weight: 1.05, wear: 0.9, decay: 0.72, edge: 1, soak: 1, bite: 1, hold: 1, note: 'Handsome, weather-proof and middling at everything else.' },
  pewter: { difficulty: -1, weight: 1, wear: 1.45, decay: 0.9, edge: 0.55, soak: 0.6, bite: 0.65, hold: 1, note: 'Soft enough to shape cold. Plates and cups, nothing more.' },
  electrum: { difficulty: 5, weight: 1.5, wear: 1.3, decay: 0.25, edge: 0.8, soak: 0.86, bite: 0.76, hold: 1, note: 'Silver and gold together: it keeps the shine and neither one\'s strength.' },
  adamantine: { difficulty: 10, weight: 0.75, wear: 0.35, decay: 0.15, edge: 1.45, soak: 1.25, bite: 1.3, hold: 1, note: 'Takes and holds the keenest edge on the island. A weaponsmith\'s metal.' },
  glimmersteel: { difficulty: 12, weight: 0.6, wear: 0.3, decay: 0.1, edge: 1.3, soak: 1.48, bite: 1.25, hold: 1, note: 'Light and immensely tough. What plate armour ought to be made of.' },
  mithril: { difficulty: 14, weight: 0.42, wear: 0.25, decay: 0.08, edge: 1.35, soak: 1.4, bite: 1.38, hold: 1, note: 'Lighter than the wood it is hafted to, and finer than anything but seryll.' },
  seryll: { difficulty: 16, weight: 0.7, wear: 0.08, decay: 0.02, edge: 1.25, soak: 1.36, bite: 1.2, hold: 1, note: 'Scarcely takes a mark. A seryll thing made well is a thing made once.' },
};

const wood = (name: string): MaterialDef => ({ id: name.toLowerCase(), name, kind: 'wood', ...(WOOD_PROPS[name] ?? WOOD_PROPS.Pine) });
const metal = (id: string, name: string): MaterialDef => ({ id, name, kind: 'metal', ...(METAL_PROPS[id] ?? METAL_PROPS.copper) });
/** A stone: nothing is made *of* one but the setting, and the rarer it is the harder it is to seat. Its line says what it favours. */
const gem = (g: GemDef): MaterialDef => ({ id: g.id, name: g.name, kind: 'gem', difficulty: 3 * (5 - g.weight), weight: 1, wear: 1, decay: 1, edge: 1, soak: 1, bite: 1, hold: 1, note: `${g.flavour} It favours ${tradeName(g.skill)}.` });

export const WOODS: MaterialDef[] = TREE_DEFS.map((t) => wood(t.name));
export const METAL_MATERIALS: MaterialDef[] = METALS.map((m) => metal(m.id, m.name));
export const GEM_MATERIALS: MaterialDef[] = GEMS.map(gem);
export const MATERIALS: MaterialDef[] = [...WOODS, ...METAL_MATERIALS, ...GEM_MATERIALS];

/** Looked up by the name written on the item, which is how it is stored. */
const BY_NAME = new Map(MATERIALS.map((m) => [m.name.toLowerCase(), m]));
export const MATERIAL_BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));

/** What a thing with nothing written on it is made of: nothing in particular. */
export const PLAIN: MaterialDef = { id: 'plain', name: '', kind: 'wood', difficulty: 0, weight: 1, wear: 1, decay: 1, edge: 1, soak: 1, bite: 1, hold: 1, note: '' };

/** The material an `extra` names, or null when it names something else. */
export function materialOf(extra: string | undefined): MaterialDef | null {
  return extra ? BY_NAME.get(extra.toLowerCase()) ?? null : null;
}

/** As materialOf, but never null: a thing of no particular stuff behaves as one. */
export const matOf = (extra: string | undefined): MaterialDef => materialOf(extra) ?? PLAIN;

/**
 * What an item is made of. Most things say so on the label; a lump says so by
 * being a lump of it, which is why its metal is read off the item id instead.
 */
export function materialOfItem(item: { id: string; extra?: string }): MaterialDef | null {
  const named = materialOf(item.extra);
  if (named) return named;
  const lump = METAL_BY_LUMP.get(item.id);
  return lump ? MATERIAL_BY_ID.get(lump.id) ?? null : null;
}

export const matOfItem = (item: { id: string; extra?: string }): MaterialDef => materialOfItem(item) ?? PLAIN;

/** Whether an `extra` names a material of this kind. */
export const isMaterialKind = (extra: string | undefined, kind: MaterialKind): boolean => materialOf(extra)?.kind === kind;

/**
 * The wood each bow must be tillered from. A bow stave is not a plank: the
 * limbs want a wood that bends and comes back, and each length of bow wants a
 * different one. Nothing else in the game is this fussy about its material.
 */
export const BOW_WOOD: Record<string, string> = {
  short_bow: 'Willow',
  medium_bow: 'Birch',
  long_bow: 'Oak',
};

/**
 * A tool's working quality is its own quality lifted or dragged by the metal
 * of its head. Kept inside a hundred, since a tool's quality is read
 * elsewhere as a chance out of a hundred.
 */
export const workingQl = (ql: number, extra: string | undefined): number => Math.min(100, ql * matOf(extra).bite);

/** How freely a body of this wood rolls: a light cart is a shade quicker. */
export const rollEase = (extra: string | undefined): number => 1 / (0.82 + matOf(extra).weight * 0.18);

/** What the material lends, for the examine window; empty for plain stuff. */
export function materialNote(extra: string | undefined): string {
  const m = materialOf(extra);
  return m ? `${m.name}: ${m.note}` : '';
}
