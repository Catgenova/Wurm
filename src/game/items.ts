import { matOfItem, workingQl } from './materials';
import { dyeWord } from './dyestuffs';

export type ItemCategory = 'tool' | 'material' | 'food' | 'plant' | 'misc';

import type { Nutrient } from './nutrition';

export interface ItemDef {
  name: string;
  category: ItemCategory;
  /** Weight in kilograms per unit. */
  weight: number;
  stackable?: boolean;
  /** Restores this much hunger (0..1) when eaten. */
  food?: number;
  /** Restores this much thirst (0..1) per drink. */
  drink?: number;
  /**
   * What is actually in it, by nutrient. Raw food feeds one of them a little;
   * a cooked dish feeds several, and feeds them properly. Anything nourishing
   * without a line here feeds nothing but the food bar.
   */
  feeds?: Partial<Record<Nutrient, number>>;
  /** Container capacity in drinks; the item carries `charges` of them. */
  charges?: number;
  /** Damage taken per real hour while lying on the ground; defaults by category. */
  decay?: number;
  description?: string;
  /**
   * A thing that holds other things: how many it takes. What is in a bag is
   * out of reach until it comes out again, which is the point of a bag.
   */
  holds?: number;
  /**
   * How much of the weather it keeps off what is inside, for a bag left on
   * the ground. Half means what is in it rots at half the rate.
   */
  shelter?: number;
}

/** Ground decay per hour by category: food rots in about half an hour, tools last most of a day. */
export const CATEGORY_DECAY: Record<ItemCategory, number> = { food: 200, plant: 100, material: 25, tool: 12, misc: 12 };

export const ITEM_DEFS: Record<string, ItemDef> = {
  shovel: { name: 'Shovel', category: 'tool', weight: 3, description: 'A shovel for digging, flattening and packing dirt.' },
  pickaxe: { name: 'Pickaxe', category: 'tool', weight: 4, description: 'A pickaxe for mining rock.' },
  hatchet: { name: 'Hatchet', category: 'tool', weight: 2, description: 'A small axe for felling trees.' },
  sickle: { name: 'Sickle', category: 'tool', weight: 1.5, description: 'A curved blade on a short handle. The forester\'s own: it prunes a tree back a stage and cuts what a bush has on it.' },
  carving_knife: { name: 'Carving knife', category: 'tool', weight: 0.5, description: 'A knife for carving wood.' },
  chisel: { name: 'Stone chisel', category: 'tool', weight: 1, description: 'A chisel for shaping stone.' },
  quern: { name: 'Quern', category: 'tool', weight: 9, description: 'Two dressed millstones, one turning on the other. Grinds grain into flour and nothing else.' },
  whetstone: { name: 'Whetstone', category: 'tool', weight: 1.2, description: 'A shaped block of stone. Takes the burr off metal and puts an edge back on it; needed to improve anything metal or stone.' },
  file: { name: 'File', category: 'tool', weight: 0.8, description: 'Cast at an anvil and cut with teeth. Needed to improve anything metal or wooden.' },
  coin_die: { name: 'Coin die', category: 'tool', weight: 1.5, description: 'A stamp of hard metal cut with a face. Set a lump of silver or gold on the anvil under it, strike, and it is twenty coins. It wears with every strike.' },
  coin_die_mould: { name: 'Coin die mould', category: 'tool', weight: 1.2, decay: 1, description: 'A sand mould. It wears a little every time it is filled, and no mould can be mended.' },
  coin: { name: 'Coins', category: 'misc', weight: 0.005, stackable: true, description: 'Struck from a lump of silver or gold under a die, twenty to the lump. Metal that goes in a pocket, and comes back out of the fire as a lump.' },
  needle: { name: 'Needle', category: 'tool', weight: 0.05, description: 'Carved from bone. Needed to improve cloth and leather.' },
  awl: { name: 'Awl', category: 'tool', weight: 0.2, description: 'A bone spike for punching holes in hide. Needed to improve leather.' },
  mallet: { name: 'Mallet', category: 'tool', weight: 1.5, description: 'Plans buildings and drives wooden walls together.' },
  trowel: { name: 'Trowel', category: 'tool', weight: 1, description: 'Lays bricks, mortar and stone floors.' },
  saw: { name: 'Saw', category: 'tool', weight: 1.5, description: 'Cuts logs into planks and timbers.' },
  rake: { name: 'Rake', category: 'tool', weight: 1.5, description: 'Tills grass and dirt into a field, ready for sowing.' },
  brush: { name: 'Brush', category: 'tool', weight: 0.6, description: 'A block of wood set with bristles. Brush a wildermon down and it works better, learns faster and throws better young.' },
  sword: { name: 'Sword', category: 'tool', weight: 2, description: 'A proper blade. It hits far harder than a working tool.' },
  short_sword: { name: 'Short sword', category: 'tool', weight: 1.4, description: 'Quick in the hand, and it leaves your other hand free for a shield.' },
  long_sword: { name: 'Long sword', category: 'tool', weight: 3, description: 'Two hands, a long reach and a heavy blow.' },
  hunting_knife: { name: 'Hunting knife', category: 'tool', weight: 0.8, description: 'Fast, light, and never quite enough on its own.' },
  battle_axe: { name: 'Battle axe', category: 'tool', weight: 4, description: 'Two hands. Slow, and it does not matter how slow when it lands.' },
  club: { name: 'Club', category: 'tool', weight: 2.5, description: 'A shaped length of oak. The first weapon anybody makes.' },
  maul: { name: 'Maul', category: 'tool', weight: 5, description: 'A block of metal on a long shaft. Chain and plate care very little; ribs care a great deal.' },
  spear: { name: 'Spear', category: 'tool', weight: 2.2, description: 'Reaches a tile further than anything else in the hand.' },
  short_bow: { name: 'Short bow', category: 'tool', weight: 1, description: 'Six tiles, and quick to draw.' },
  medium_bow: { name: 'Medium bow', category: 'tool', weight: 1.4, description: 'Nine tiles. The bow most people settle on.' },
  long_bow: { name: 'Long bow', category: 'tool', weight: 1.8, description: 'Thirteen tiles and a heavy draw. Takes an age to pull and ends most things at the end of it.' },
  helm: { name: 'Helm', category: 'tool', weight: 3, description: 'Turns aside much of what a cornered animal can do to you.' },
  wool_cap: { name: 'Wool cap', category: 'tool', weight: 0.4, description: 'A thick felted cap. Not a helm, but far better than a bare head.' },
  // Cloth armour: light, quiet and better than nothing.
  cloth_tunic: { name: 'Cloth tunic', category: 'tool', weight: 1.2, description: 'A padded tunic. It turns a little of everything and hinders nothing.' },
  cloth_sleeves: { name: 'Cloth sleeves', category: 'tool', weight: 0.7 },
  cloth_trousers: { name: 'Cloth trousers', category: 'tool', weight: 1 },
  cloth_shoes: { name: 'Cloth shoes', category: 'tool', weight: 0.6 },
  // Leather, cut and stitched from hide.
  leather_cap: { name: 'Leather cap', category: 'tool', weight: 0.8 },
  leather_jerkin: { name: 'Leather jerkin', category: 'tool', weight: 2.4, description: 'Hide stitched into a jerkin. The first armour worth the name.' },
  leather_sleeves: { name: 'Leather sleeves', category: 'tool', weight: 1.4 },
  leather_trousers: { name: 'Leather trousers', category: 'tool', weight: 2 },
  leather_boots: { name: 'Leather boots', category: 'tool', weight: 1.6 },
  // Chain, rings drawn and riveted at an anvil.
  chain_coif: { name: 'Chain coif', category: 'tool', weight: 2.6 },
  chain_hauberk: { name: 'Chain hauberk', category: 'tool', weight: 7.5, description: 'A shirt of riveted rings. Heavy, and worth every kilo of it.' },
  chain_sleeves: { name: 'Chain sleeves', category: 'tool', weight: 3.4 },
  chain_leggings: { name: 'Chain leggings', category: 'tool', weight: 5 },
  chain_boots: { name: 'Chain boots', category: 'tool', weight: 3 },
  // Plate, beaten out of a mould and strapped on over everything.
  plate_breastplate: { name: 'Breastplate', category: 'tool', weight: 11, description: 'Beaten plate over the chest. Almost nothing gets through it, and you will feel every step.' },
  plate_arms: { name: 'Plate arms', category: 'tool', weight: 5 },
  plate_legs: { name: 'Plate legs', category: 'tool', weight: 7.5 },
  plate_boots: { name: 'Plate boots', category: 'tool', weight: 4.5 },
  wooden_shield: { name: 'Wooden shield', category: 'tool', weight: 3.5, description: 'Planks and a boss. Held in the off hand, it turns blows aside outright.' },
  metal_shield: { name: 'Metal shield', category: 'tool', weight: 6, description: 'Held in the off hand. Heavier than wood and stops far more.' },
  frying_pan: { name: 'Frying pan', category: 'tool', weight: 2, description: 'Metal to cook in. Fried food is better than food cooked on a stone.' },
  anvil: { name: 'Anvil', category: 'misc', weight: 60, decay: 0.5, description: 'Heavy enough that you set it down once. Place it and smith at it.' },
  butchering_knife: { name: 'Butchering knife', category: 'tool', weight: 1, description: 'A broad blade for butchering corpses. Yields more from a carcass than bare hands.' },
  clay_bowl: { name: 'Clay bowl', category: 'tool', weight: 0.6, description: 'A fired bowl. Stews and compotes are cooked in it over a campfire.' },
  clay_pot: { name: 'Clay pot', category: 'tool', weight: 1.2, description: 'A deep fired pot. A pottage simmers in it over a campfire and feeds you for half a day.' },
  clay_jar: { name: 'Clay jar', category: 'tool', weight: 0.8, description: 'A fired jar with a close lid. Fruit put up in one keeps far longer than fruit that is not.' },
  deed_stake: { name: 'Deed stake', category: 'misc', weight: 1, decay: 4, description: 'A shaft whittled to a point and notched for a claim. Plant it to found a settlement where you stand: 11 by 11 tiles around a token. You may hold one deed at a time.' },
  crate_log: { name: 'Log crate', category: 'misc', weight: 30, decay: 6, description: 'A rough crate that holds 30 things. Place it on any spot of a tile.' },
  crate_plank: { name: 'Plank crate', category: 'misc', weight: 15, decay: 6, description: 'A neat crate that holds 60 things. Place it on any spot of a tile.' },
  water_skin: { name: 'Water skin', category: 'misc', weight: 0.5, drink: 0.35, charges: 5, description: 'Holds water for the road. Fill it at any shore.' },
  bucket: { name: 'Bucket', category: 'tool', weight: 1.6, decay: 8, description: 'A wooden bucket. Fill it at any shore; ashes and water make lye in it.' },
  water_bucket: { name: 'Bucket of water', category: 'tool', weight: 6, decay: 8, description: 'Water enough to leach ashes into lye.' },
  lye_bucket: { name: 'Bucket of lye', category: 'tool', weight: 6, decay: 10, description: 'Ash water, and it will take the hair off a hide. One bucket tans one skin.' },
  dirt: { name: 'Dirt', category: 'material', weight: 20, stackable: true, description: 'A pile of dirt. Drop it to raise the ground.' },
  sand: { name: 'Sand', category: 'material', weight: 20, stackable: true },
  clay: { name: 'Clay', category: 'material', weight: 2, stackable: true },
  peat: { name: 'Peat', category: 'material', weight: 2, stackable: true },
  ash: { name: 'Ashes', category: 'material', weight: 0.3, stackable: true, decay: 4, description: 'Raked out of a fire once it has burnt through. Water leaches lye out of it.' },
  tar: { name: 'Tar', category: 'material', weight: 2, stackable: true },
  rock_shards: { name: 'Rock shards', category: 'material', weight: 20, stackable: true, decay: 5, description: 'Chunks of rock. Paves gravel, builds cobblestone walls or becomes bricks.' },
  slate_shards: { name: 'Slate shards', category: 'material', weight: 20, stackable: true, decay: 5 },
  marble_shards: { name: 'Marble shards', category: 'material', weight: 20, stackable: true, decay: 5 },
  sandstone_shards: { name: 'Sandstone shards', category: 'material', weight: 20, stackable: true, decay: 5 },
  stone_brick: { name: 'Stone brick', category: 'material', weight: 15, stackable: true, decay: 3 },
  slate_brick: { name: 'Slate brick', category: 'material', weight: 15, stackable: true, decay: 3 },
  marble_brick: { name: 'Marble brick', category: 'material', weight: 15, stackable: true, decay: 3 },
  sandstone_brick: { name: 'Sandstone brick', category: 'material', weight: 15, stackable: true, decay: 3 },
  stone_slab: { name: 'Stone slab', category: 'material', weight: 18, stackable: true, decay: 2, description: 'A flat slab cut from rock. Laid as paving, a tile at a time.' },
  slate_slab: { name: 'Slate slab', category: 'material', weight: 18, stackable: true, decay: 2 },
  marble_slab: { name: 'Marble slab', category: 'material', weight: 18, stackable: true, decay: 2 },
  sandstone_slab: { name: 'Sandstone slab', category: 'material', weight: 18, stackable: true, decay: 2 },
  unfired_clay_brick: { name: 'Unfired clay brick', category: 'material', weight: 3, stackable: true, decay: 12, description: 'Shaped clay, still soft. Fire it in a kiln before it is any use.' },
  unfired_clay_bowl: { name: 'Unfired clay bowl', category: 'material', weight: 0.7, stackable: true, decay: 12, description: 'Green ware. It will not hold a stew until it has been through a kiln.' },
  unfired_clay_pot: { name: 'Unfired clay pot', category: 'material', weight: 1.4, stackable: true, decay: 12, description: 'Green ware, waiting on a kiln.' },
  unfired_clay_jar: { name: 'Unfired clay jar', category: 'material', weight: 0.9, stackable: true, decay: 12, description: 'Green ware, waiting on a kiln.' },
  clay_brick: { name: 'Clay brick', category: 'material', weight: 3, stackable: true, decay: 6 },
  adobe: { name: 'Adobe', category: 'material', weight: 3, stackable: true, decay: 10, description: 'Clay and grass pressed into a block.' },
  mortar: { name: 'Mortar', category: 'material', weight: 2, stackable: true, decay: 40 },
  concrete: { name: 'Concrete', category: 'material', weight: 2.5, stackable: true, decay: 40, description: 'Mortar worked stiff with ashes. A lot of it raises a bare rock corner by one; it will not set on soil or under water.' },
  // Ore comes out of the seam; the smelter turns it into lumps.
  copper_ore: { name: 'Copper ore', category: 'material', weight: 2, stackable: true, decay: 2 },
  iron_ore: { name: 'Iron ore', category: 'material', weight: 2, stackable: true, decay: 2 },
  tin_ore: { name: 'Tin ore', category: 'material', weight: 2, stackable: true, decay: 2 },
  zinc_ore: { name: 'Zinc ore', category: 'material', weight: 2, stackable: true, decay: 2 },
  lead_ore: { name: 'Lead ore', category: 'material', weight: 2, stackable: true, decay: 2 },
  silver_ore: { name: 'Silver ore', category: 'material', weight: 2, stackable: true, decay: 2 },
  gold_ore: { name: 'Gold ore', category: 'material', weight: 2, stackable: true, decay: 2 },
  adamantine_ore: { name: 'Adamantine ore', category: 'material', weight: 2, stackable: true, decay: 2 },
  glimmersteel_ore: { name: 'Glimmersteel ore', category: 'material', weight: 2, stackable: true, decay: 2 },
  mithril_ore: { name: 'Mithril ore', category: 'material', weight: 2, stackable: true, decay: 2 },
  seryll_ore: { name: 'Seryll ore', category: 'material', weight: 2, stackable: true, decay: 2 },
  copper_lump: { name: 'Copper lump', category: 'material', weight: 1, stackable: true, decay: 2 },
  iron_lump: { name: 'Iron lump', category: 'material', weight: 1, stackable: true, decay: 3 },
  coal: { name: 'Coal', category: 'material', weight: 1, stackable: true, decay: 3, description: 'Burns long and hot. A campfire will take it happily.' },
  tin_lump: { name: 'Tin lump', category: 'material', weight: 1, stackable: true, decay: 2 },
  zinc_lump: { name: 'Zinc lump', category: 'material', weight: 1, stackable: true, decay: 2 },
  lead_lump: { name: 'Lead lump', category: 'material', weight: 1, stackable: true, decay: 1 },
  silver_lump: { name: 'Silver lump', category: 'material', weight: 0.1, stackable: true, decay: 1 },
  gold_lump: { name: 'Gold lump', category: 'material', weight: 0.1, stackable: true, decay: 1 },
  adamantine_lump: { name: 'Adamantine lump', category: 'material', weight: 0.1, stackable: true, decay: 0.5, description: 'A blue-grey metal that turns a hatchet edge. Twenty kilograms of ore give a tenth of this.' },
  glimmersteel_lump: { name: 'Glimmersteel lump', category: 'material', weight: 0.1, stackable: true, decay: 0.5, description: 'Pale metal that holds a light of its own. Twenty kilograms of ore give a tenth of this.' },
  mithril_lump: { name: 'Mithril lump', category: 'material', weight: 0.1, stackable: true, decay: 0.5 },
  seryll_lump: { name: 'Seryll lump', category: 'material', weight: 0.1, stackable: true, decay: 0.5, description: 'The rarest metal in the rock, and the hardest won.' },
  // Alloys, mixed in a smelter.
  bronze_lump: { name: 'Bronze lump', category: 'material', weight: 1, stackable: true, decay: 1 },
  steel_lump: { name: 'Steel lump', category: 'material', weight: 1, stackable: true, decay: 1 },
  brass_lump: { name: 'Brass lump', category: 'material', weight: 1, stackable: true, decay: 1 },
  pewter_lump: { name: 'Pewter lump', category: 'material', weight: 1, stackable: true, decay: 1 },
  electrum_lump: { name: 'Electrum lump', category: 'material', weight: 1, stackable: true, decay: 1 },
  // Moulds, fired from sand, and the pieces beaten out of them.
  anvil_mould: { name: 'Anvil mould', category: 'tool', weight: 1.2, decay: 1, description: 'A sand mould. It wears a little every time it is filled, and no mould can be mended.' },
  nail_mould: { name: 'Nail mould', category: 'tool', weight: 1.2, decay: 1, description: 'A gang mould with a hundred little channels in it. One lump of metal runs out as a hundred nails. It wears like any mould and cannot be mended.' },
  pan_mould: { name: 'Pan mould', category: 'tool', weight: 1.2, decay: 1, description: 'A sand mould. It wears a little every time it is filled, and no mould can be mended.' },
  rake_head_mould: { name: 'Rake head mould', category: 'tool', weight: 1.2, decay: 1, description: 'A sand mould. It wears a little every time it is filled, and no mould can be mended.' },
  shovel_head_mould: { name: 'Shovel head mould', category: 'tool', weight: 1.2, decay: 1, description: 'A sand mould. It wears a little every time it is filled, and no mould can be mended.' },
  hatchet_head_mould: { name: 'Hatchet head mould', category: 'tool', weight: 1.2, decay: 1, description: 'A sand mould. It wears a little every time it is filled, and no mould can be mended.' },
  sickle_blade_mould: { name: 'Sickle blade mould', category: 'tool', weight: 1.2, decay: 1, description: 'A sand mould. It wears a little every time it is filled, and no mould can be mended.' },
  pickaxe_head_mould: { name: 'Pickaxe head mould', category: 'tool', weight: 1.2, decay: 1, description: 'A sand mould. It wears a little every time it is filled, and no mould can be mended.' },
  knife_blade_mould: { name: 'Knife blade mould', category: 'tool', weight: 1.2, decay: 1, description: 'A sand mould. It wears a little every time it is filled, and no mould can be mended.' },
  sword_blade_mould: { name: 'Sword blade mould', category: 'tool', weight: 1.2, decay: 1, description: 'A sand mould. It wears a little every time it is filled, and no mould can be mended.' },
  helm_mould: { name: 'Helm mould', category: 'tool', weight: 1.2, decay: 1, description: 'A sand mould. It wears a little every time it is filled, and no mould can be mended.' },
  axle_mould: { name: 'Axle mould', category: 'tool', weight: 1.4, decay: 1, description: 'A long sand mould for a wagon axle. It wears a little every time it is filled, and no mould can be mended.' },
  ribbon_mould: { name: 'Ribbon mould', category: 'tool', weight: 1.2, decay: 1, description: 'A gang mould that runs one lump out as four metal ribbons. It wears like any mould and cannot be mended.' },
  nail: { name: 'Nails', category: 'material', weight: 0.01, stackable: true, decay: 1, description: 'Ten grams of metal apiece. Nothing is nailed together without them.' },
  arrow: { name: 'Arrows', category: 'material', weight: 0.05, stackable: true, decay: 3, description: 'Shaft, head and feather. A bow spends one with every shot.' },
  arrow_head: { name: 'Arrow heads', category: 'material', weight: 0.02, stackable: true, decay: 1 },
  feather: { name: 'Feathers', category: 'material', weight: 0.01, stackable: true, decay: 20, description: 'Three to an arrow, and only a bird carries them.' },
  bow_string: { name: 'Bowstring', category: 'material', weight: 0.05, stackable: true, decay: 8 },
  yarn: { name: 'Yarn', category: 'material', weight: 0.15, stackable: true, decay: 12, description: 'Spun on a spindle. Woven on a loom it becomes cloth.' },
  long_sword_blade: { name: 'Long sword blade', category: 'material', weight: 2, stackable: true, decay: 1 },
  short_sword_blade: { name: 'Short sword blade', category: 'material', weight: 1, stackable: true, decay: 1 },
  axe_head: { name: 'Axe head', category: 'material', weight: 2.6, stackable: true, decay: 1 },
  maul_head: { name: 'Maul head', category: 'material', weight: 3.4, stackable: true, decay: 1 },
  spear_head: { name: 'Spear head', category: 'material', weight: 1.2, stackable: true, decay: 1 },
  shield_boss: { name: 'Shield boss', category: 'material', weight: 2, stackable: true, decay: 1 },
  rake_head: { name: 'Rake head', category: 'material', weight: 1.2, stackable: true, decay: 1 },
  shovel_head: { name: 'Shovel head', category: 'material', weight: 1.2, stackable: true, decay: 1 },
  hatchet_head: { name: 'Hatchet head', category: 'material', weight: 1.2, stackable: true, decay: 1 },
  sickle_blade: { name: 'Sickle blade', category: 'material', weight: 1, stackable: true, decay: 1 },
  // What a sickle cuts off a bush. Dyestuffs, both of them.
  rose_petals: { name: 'Rose petals', category: 'material', weight: 0.05, stackable: true, decay: 6, description: 'Cut off a rose bush with a sickle. Boiled, they give a pink that nothing else on the island gives.' },
  lavender: { name: 'Lavender', category: 'material', weight: 0.05, stackable: true, decay: 6, description: 'Cut off a lavender bush with a sickle. Boiled, it gives a violet.' },
  pickaxe_head: { name: 'Pickaxe head', category: 'material', weight: 1.2, stackable: true, decay: 1 },
  knife_blade: { name: 'Knife blade', category: 'material', weight: 1.2, stackable: true, decay: 1 },
  sword_blade: { name: 'Sword blade', category: 'material', weight: 1.2, stackable: true, decay: 1 },
  log: { name: 'Log', category: 'material', weight: 24, stackable: true, decay: 18 },
  plank: { name: 'Plank', category: 'material', weight: 2, stackable: true, decay: 20 },
  timber: { name: 'Timber', category: 'material', weight: 6, stackable: true, decay: 18 },
  wool: { name: 'Wool', category: 'material', weight: 0.4, stackable: true, decay: 14, description: 'A fleece shorn from a living Woola. It grows back, which fur never does.' },
  cloth: { name: 'Cloth', category: 'material', weight: 0.3, stackable: true, decay: 14, description: 'Wool or cotton spun and woven. Stuffs a mattress and makes what you wear.' },
  fur: { name: 'Fur', category: 'material', weight: 1, stackable: true, decay: 16, description: 'A soft pelt taken from a butchered wildermon.' },
  hide: { name: 'Hide', category: 'material', weight: 2, stackable: true, decay: 40, description: 'A raw skin off a carcass. Useless until it has been through lye.' },
  leather: { name: 'Leather', category: 'material', weight: 1.5, stackable: true, decay: 12, description: 'Hide tanned in lye and worked soft. What every leather thing is cut from.' },
  bone: { name: 'Bone', category: 'material', weight: 1, stackable: true, decay: 8 },
  gland: { name: 'Gland', category: 'material', weight: 0.2, stackable: true, decay: 90, description: 'A small scent gland. Rare, and prized by alchemists.' },
  shaft: { name: 'Shaft', category: 'material', weight: 1, stackable: true, decay: 20, description: 'A straight length of wood, carved from a log. Handles for tools and rails for fences.' },
  ribbon: { name: 'Metal ribbon', category: 'material', weight: 0.4, stackable: true, decay: 1, description: 'Flat bands of metal, beaten out four to a lump. Everything that has to hold together under a load is banded with them.' },
  big_axle: { name: 'Big axle', category: 'material', weight: 8, stackable: true, decay: 1, description: 'A cast axle as long as a cart is wide. Two wheels turn on one.' },
  large_wheel: { name: 'Large wheel', category: 'material', weight: 12, stackable: true, decay: 10, description: 'Spokes, felloes and a metal tyre shrunk on hot. A cart takes two and a wagon four.' },
  yoke: { name: 'Yoke', category: 'material', weight: 4, stackable: true, decay: 10, description: 'A shaped bar and a leather harness. A wildermon is hitched into one to pull.' },
  milk_bucket: { name: 'Bucket of milk', category: 'food', weight: 6, decay: 30, drink: 0.3, charges: 5, description: 'Five litres of milk, still warm. Drink it, or work it into cheese while it is fresh.', feeds: { fat: 0.1, flesh: 0.08 } },
  cheese: { name: 'Cheese', category: 'food', weight: 0.4, stackable: true, food: 0.3, decay: 4, description: 'Milk pressed and left to itself for a while. It keeps far better than what it was made of.', feeds: { fat: 0.12, flesh: 0.1 } },
  honey: { name: 'Honey', category: 'food', weight: 0.3, stackable: true, food: 0.22, decay: 0.4, description: 'Comb honey out of a hive. It keeps almost forever and everything on the island wants it.', feeds: { starch: 0.1, fat: 0.03 } },
  wax: { name: 'Beeswax', category: 'material', weight: 0.2, stackable: true, decay: 1, description: 'Comb rendered down. It is what a candle is, and what a waxed thread is drawn through.' },
  lantern: { name: 'Lantern', category: 'tool', weight: 1.4, decay: 3, description: 'Four ribbons of iron, two panes of oiled cloth and a handle. Put a candle in it, strike it, and the night stops being a wall.' },
  torch: { name: 'Torch', category: 'tool', weight: 0.8, decay: 4, description: 'A shaft with oiled cloth wound round the head of it. Touch it to a fire and it burns for a few minutes and throws a small circle — long enough to get somewhere, not long enough to work by.' },
  candle: { name: 'Candle', category: 'misc', weight: 0.2, stackable: true, decay: 2, description: 'Wax drawn round a wick. Set one in a lantern and it will show you the ground on the blackest night.' },
  compost: { name: 'Compost', category: 'material', weight: 1.2, stackable: true, decay: 2, description: 'What a Middun leaves behind, which is the best thing that ever happened to a field. Spread it on tilled ground.' },
  saddle: { name: 'Saddle', category: 'material', weight: 7, stackable: true, decay: 8, description: 'A tree of wood under stitched leather, girthed and stirruped. Fit one to an Orse and you can ride it.' },
  bridle: { name: 'Bridle', category: 'material', weight: 2, stackable: true, decay: 8, description: 'Headstall, bit and reins. Without one there is nothing to steer by.' },
  thatch: { name: 'Thatch', category: 'material', weight: 0.5, stackable: true, decay: 60 },
  sprout: { name: 'Sprout', category: 'plant', weight: 0.1, stackable: true, decay: 160, description: 'Plant it on grass or dirt to grow a tree. Wilts quickly if left lying around.' },
  blueberry: { name: 'Blueberries', category: 'food', weight: 0.1, stackable: true, food: 0.08, feeds: { greens: 0.05 } },
  raspberry: { name: 'Raspberries', category: 'food', weight: 0.1, stackable: true, food: 0.08, feeds: { greens: 0.05 } },
  strawberry: { name: 'Strawberries', category: 'food', weight: 0.1, stackable: true, food: 0.08, feeds: { greens: 0.05 } },
  lingonberry: { name: 'Lingonberries', category: 'food', weight: 0.1, stackable: true, food: 0.06, feeds: { greens: 0.04 } },
  acorn: { name: 'Acorn', category: 'food', weight: 0.05, stackable: true, food: 0.02, feeds: { fat: 0.02 } },
  nuts: { name: 'Nuts', category: 'food', weight: 0.1, stackable: true, food: 0.05, feeds: { fat: 0.05 } },
  meat: { name: 'Meat', category: 'food', weight: 0.5, stackable: true, food: 0.18, decay: 160, description: 'Raw meat from a butchered wildermon. Cook it at a campfire and it feeds you twice over.', feeds: { flesh: 0.09 } },
  cooked_meat: { name: 'Cooked meat', category: 'food', weight: 0.4, stackable: true, food: 0.35, decay: 90, feeds: { flesh: 0.22, fat: 0.05 } },
  baked_potato: { name: 'Baked potato', category: 'food', weight: 0.2, stackable: true, food: 0.22, decay: 90, feeds: { starch: 0.18, greens: 0.03 } },
  roast_onion: { name: 'Roast onion', category: 'food', weight: 0.15, stackable: true, food: 0.16, decay: 90, feeds: { greens: 0.12, fat: 0.02 } },
  roast_nuts: { name: 'Roasted nuts', category: 'food', weight: 0.1, stackable: true, food: 0.12, decay: 40, feeds: { fat: 0.14 } },
  berry_compote: { name: 'Berry compote', category: 'food', weight: 0.3, stackable: true, food: 0.3, decay: 60, description: 'Berries stewed down in a bowl over a fire.', feeds: { greens: 0.2, starch: 0.06 } },
  stew: { name: 'Stew', category: 'food', weight: 0.6, stackable: true, food: 0.75, decay: 70, description: 'Meat and vegetables simmered together. The best meal a campfire can make.', feeds: { flesh: 0.26, starch: 0.22, greens: 0.2, fat: 0.12 } },
  pottage: { name: 'Pottage', category: 'food', weight: 0.7, stackable: true, food: 0.6, decay: 50, description: 'A thick pot of vegetables and grain, simmered down slowly.', feeds: { starch: 0.24, greens: 0.22, fat: 0.1 } },
  bread: { name: 'Bread', category: 'food', weight: 0.35, stackable: true, food: 0.42, decay: 70, description: 'A baked loaf. The first food that keeps and travels.', feeds: { starch: 0.3, fat: 0.04 } },
  porridge: { name: 'Porridge', category: 'food', weight: 0.4, stackable: true, food: 0.32, decay: 80, description: 'Cornmeal boiled thick in a bowl.', feeds: { starch: 0.24, fat: 0.08, greens: 0.05 } },
  preserves: { name: 'Preserves', category: 'food', weight: 0.3, stackable: true, food: 0.28, decay: 12, description: 'Berries put up in a sealed jar. They keep for a very long time.', feeds: { greens: 0.18, starch: 0.1 } },
  flour: { name: 'Flour', category: 'material', weight: 0.1, stackable: true, decay: 30, description: 'Wheat ground between two stones. Wet it and it becomes dough.' },
  cornmeal: { name: 'Cornmeal', category: 'material', weight: 0.12, stackable: true, decay: 30, description: 'Corn ground coarse. Boiled up it makes porridge.' },
  dough: { name: 'Dough', category: 'material', weight: 0.3, stackable: true, decay: 150, description: 'Flour and water worked together. It wants a fire under it.' },
  bandage: { name: 'Bandage', category: 'misc', weight: 0.05, stackable: true, decay: 10, description: 'A strip of cloth for binding a wound. One strip, one wound.' },
  reed: { name: 'Reed', category: 'material', weight: 0.2, stackable: true, decay: 60, description: 'Cut from a reed bed. Soaked and pressed it becomes papyrus.' },
  papyrus: { name: 'Papyrus', category: 'material', weight: 0.05, stackable: true, decay: 14, description: 'A pressed sheet, smooth enough to take ink.' },
  ink: { name: 'Ink', category: 'material', weight: 0.1, stackable: true, decay: 8, description: 'Soot, gland and lye water, ground together until it flows black.' },
  book: { name: 'Book', category: 'misc', weight: 1.2, decay: 6, description: 'Papyrus sewn between leather boards. Reading it sharpens the head, and wears the pages.' },
  fragment: { name: 'Fragment', category: 'misc', weight: 0.6, decay: 3, description: 'A broken piece of something old. Find the rest of it and a restorer can put it back together.' },
  treasure_map: { name: 'Treasure map', category: 'misc', weight: 0.1, decay: 20, description: 'A square of oiled hide with a stretch of country drawn on it and no names anywhere. Read it to see the picture; walk until the ground matches, then dig. Something is always left to watch over a hoard. Keep it in a pack or a crate — left lying in a field it will rot, and take the hoard with it.' },
  statuette: { name: 'Statuette', category: 'misc', weight: 1.4, decay: 2, description: 'A small figure in worn stone, carried by people who are long gone.' },
  old_lamp: { name: 'Old lamp', category: 'misc', weight: 0.9, decay: 3, description: 'A closed clay lamp with a wick hole. It still smells faintly of oil.' },
  bronze_mirror: { name: 'Bronze mirror', category: 'misc', weight: 0.8, decay: 3, description: 'A disc of bronze polished on one face. It gives back a dim, honest likeness.' },
  bone_comb: { name: 'Bone comb', category: 'misc', weight: 0.15, decay: 3, description: 'Fine teeth cut in old bone. Somebody took a great deal of trouble over it.' },
  mixed_grass: { name: 'Mixed grass', category: 'material', weight: 0.1, stackable: true, decay: 120 },
  sage: { name: 'Sage', category: 'plant', weight: 0.05, stackable: true, food: 0.01, feeds: { greens: 0.01 } },
  basil: { name: 'Basil', category: 'plant', weight: 0.05, stackable: true, food: 0.01, feeds: { greens: 0.01 } },
  thyme: { name: 'Thyme', category: 'plant', weight: 0.05, stackable: true, food: 0.01, feeds: { greens: 0.01 } },
  mint: { name: 'Mint', category: 'plant', weight: 0.05, stackable: true, food: 0.01, feeds: { greens: 0.01 } },
  rosemary: { name: 'Rosemary', category: 'plant', weight: 0.05, stackable: true, food: 0.01, feeds: { greens: 0.01 } },
  // Crop seeds, gathered in the wild and sown on a tilled field.
  onion_seed: { name: 'Onion seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  carrot_seed: { name: 'Carrot seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  cabbage_seed: { name: 'Cabbage seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  potato_seed: { name: 'Seed potatoes', category: 'plant', weight: 0.1, stackable: true, decay: 40 },
  wheat_seed: { name: 'Wheat seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  corn_seed: { name: 'Corn seeds', category: 'plant', weight: 0.03, stackable: true, decay: 40 },
  sage_seed: { name: 'Sage seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  basil_seed: { name: 'Basil seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  thyme_seed: { name: 'Thyme seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  mint_seed: { name: 'Mint seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  rosemary_seed: { name: 'Rosemary seeds', category: 'plant', weight: 0.02, stackable: true, decay: 40 },
  cotton_seed: { name: 'Cotton seeds', category: 'plant', weight: 0.05, stackable: true, decay: 40 },
  wemp_seed: { name: 'Wemp seeds', category: 'plant', weight: 0.05, stackable: true, decay: 40 },
  potato: { name: 'Potato', category: 'food', weight: 0.2, stackable: true, food: 0.1, feeds: { starch: 0.06 } },
  carrot: { name: 'Carrot', category: 'food', weight: 0.12, stackable: true, food: 0.08, feeds: { greens: 0.05 } },
  cabbage: { name: 'Cabbage', category: 'food', weight: 0.4, stackable: true, food: 0.12, feeds: { greens: 0.07 } },
  wheat: { name: 'Wheat', category: 'food', weight: 0.1, stackable: true, food: 0.05, feeds: { starch: 0.04 } },
  corn: { name: 'Corn', category: 'food', weight: 0.2, stackable: true, food: 0.11, feeds: { starch: 0.06 } },
  cotton: { name: 'Cotton', category: 'material', weight: 0.1, stackable: true, decay: 30 },
  wemp: { name: 'Wemp fibre', category: 'material', weight: 0.1, stackable: true, decay: 30 },
  toolbelt: { name: 'Toolbelt', category: 'tool', weight: 1.1, decay: 3, description: 'A belt of loops and pouches. Wear it and it carries the jobs you do most, ready to hand: one loop for every ten points of how well it was made.' },
  rug: { name: 'Rug', category: 'tool', weight: 2.2, decay: 6, description: 'Woven wide enough to sit on cross-legged. Lay it down somewhere quiet and think about nothing.' },
  composite_bow: { name: 'Composite bow', category: 'tool', weight: 2, description: 'Tusk laid along the belly, sinew glued along the back, both off something that was trying to kill you. It throws an arrow seventeen tiles.' },
  scale_helm: { name: 'Scale helm', category: 'tool', weight: 1.6, description: 'Dragon scale riveted to a leather cap.' },
  scale_cuirass: { name: 'Scale cuirass', category: 'tool', weight: 5, description: 'Dragon scale laid in courses over a leather body. It turns more than plate and weighs less than chain.' },
  scale_sleeves: { name: 'Scale sleeves', category: 'tool', weight: 3, description: 'Dragon scale on the outside of the arm.' },
  scale_leggings: { name: 'Scale leggings', category: 'tool', weight: 4, description: 'Dragon scale down the thigh and shin.' },
  scale_boots: { name: 'Scale boots', category: 'tool', weight: 2.4, description: 'Dragon scale over the instep.' },
  tusk: { name: 'Tusk', category: 'material', weight: 1.6, stackable: true, decay: 1, description: 'Cut from the jaw of something that meant to use it on you. Hard, close-grained and springy: the belly of a composite bow is made of it.' },
  sinew: { name: 'Sinew', category: 'material', weight: 0.2, stackable: true, decay: 4, description: 'Dried back-strap. It pulls like nothing that grows and it is what the back of a composite bow is laid with.' },
  dragon_scale: { name: 'Dragon scale', category: 'material', weight: 1.2, stackable: true, decay: 0.2, description: 'A plate the size of your hand, warm to hold and lighter than it looks. Nothing on this island turns a blow like it, and there is only one place to get one.' },
  worm: { name: 'Worms', category: 'material', weight: 0.05, stackable: true, decay: 90, description: 'Turned out of damp dirt with a shovel. The first bait anybody uses, and the one that never stops working on small fish.' },
  fishing_net: { name: 'Fishing net', category: 'tool', weight: 3.5, decay: 5, description: 'Yarn knotted to a rope headline. Dragged through shallow water it takes a great many small fish at once and lets the big ones through.' },
  creel: { name: 'Creel', category: 'misc', weight: 3, decay: 4, description: 'A woven basket trap with a throat it is easy to swim into and hard to swim out of. Set it in water, bait it, and leave it.' },
  snare: { name: 'Snare', category: 'misc', weight: 1.2, decay: 5, description: 'A noose of rope on a bent shaft. Set it out in the country, bait it, and come back to whatever came to the bait.' },
  deadfall: { name: 'Deadfall', category: 'misc', weight: 12, decay: 4, description: 'A weighted board on a trigger. It holds very nearly anything that walks, and it is a great deal of work to build.' },
  cover: { name: 'Healing cover', category: 'tool', weight: 0.2, stackable: true, decay: 12, description: 'Herbs worked into cotton. Laid on the wound it suits, it stops the bleeding, keeps the dirt out and closes it twice as fast as cloth.' },
  dye: { name: 'Dye', category: 'material', weight: 0.8, stackable: true, decay: 5, description: 'A pot of colour, struck with lye so it bites and holds. One pot does one thing.' },
  banner: { name: 'Banner', category: 'misc', weight: 4, decay: 5, description: 'Cloth on a staff. Plant it on the deed and fly your colour over it.' },
  rope: { name: 'Rope', category: 'material', weight: 0.6, stackable: true, decay: 6, description: 'Wemp laid up into three strands on a rope tool. Everything that has to hold, hold fast or haul is roped.' },
  thick_rope: { name: 'Thick rope', category: 'material', weight: 2.4, stackable: true, decay: 4, description: 'Three ropes laid up again into a hawser. It moors a hull, hangs a bucket down a shaft and carries a span of bridge.' },
  onion: { name: 'Onion', category: 'food', weight: 0.15, stackable: true, food: 0.06, feeds: { greens: 0.04 } },
  corpse: { name: 'Corpse', category: 'misc', weight: 12, decay: 90, description: 'Something dead. Butcher it before it rots: meat, fur, leather, bone and glands off a wildermon, and off one of the bad things, tusk, sinew and worse.' },
  // Furniture, carried flat-packed and set down on the subtile grid.
  stool: { name: 'Stool', category: 'misc', weight: 4, decay: 4, description: 'Three legs and a seat. Set it down anywhere.' },
  sign: { name: 'Sign', category: 'misc', weight: 5, decay: 5, description: 'A board across two posts, made to be written on. Set it up and give it a name, and the name stands there for anyone walking past.' },
  great_sign: { name: 'Signboard', category: 'misc', weight: 11, decay: 5, description: 'A board wide enough to write a sentence on. Set it up where a road forks and nobody need guess again.' },
  chair: { name: 'Chair', category: 'misc', weight: 7, decay: 4, description: 'A chair with a proper back to it. Set it down anywhere.' },
  bench: { name: 'Bench', category: 'misc', weight: 12, decay: 4, description: 'Seats two at a pinch, three in a good mood.' },
  table: { name: 'Table', category: 'misc', weight: 18, decay: 4, description: 'A square table on four legs.' },
  long_table: { name: 'Long table', category: 'misc', weight: 34, decay: 4, description: 'The table a hall is built around.' },
  desk: { name: 'Writing desk', category: 'misc', weight: 24, decay: 4, description: 'A desk with drawers under the top. Holds 20 things.' },
  bed: { name: 'Bed', category: 'misc', weight: 30, decay: 5, description: 'A bed with a stuffed mattress on it.' },
  cot: { name: 'Cot', category: 'misc', weight: 16, decay: 5, description: 'A narrow bed for a narrow room.' },
  chest: { name: 'Chest', category: 'misc', weight: 26, decay: 4, description: 'A banded chest. Holds 60 things.' },
  coffer: { name: 'Coffer', category: 'misc', weight: 10, decay: 4, description: 'A small strongbox. Holds 25 things.' },
  cupboard: { name: 'Cupboard', category: 'misc', weight: 30, decay: 4, description: 'A cupboard with doors on it. Holds 80 things.' },
  wardrobe: { name: 'Wardrobe', category: 'misc', weight: 42, decay: 4, description: 'Tall enough to hang a cloak full length. Holds 100 things.' },
  shelves: { name: 'Shelves', category: 'misc', weight: 34, decay: 4, description: 'A long open rack of shelves. Holds 120 things.' },
  bookshelf: { name: 'Bookshelf', category: 'misc', weight: 30, decay: 4, description: 'Shelves with a back and a cornice. Holds 90 things.' },
  larder: { name: 'Larder', category: 'misc', weight: 48, decay: 4, description: 'A deep cool cupboard for a kitchen. The largest storage there is: 150 things.' },
  crate_shelf: { name: 'Crate shelf', category: 'misc', weight: 64, decay: 4, description: 'A decked rack two spots across and four deep. It holds nothing itself: eight plank crates stand on it, each its own crate, and you can see across a warehouse how many are full.' },
  barrel: { name: 'Barrel', category: 'misc', weight: 14, decay: 4, description: 'Staves and hoops. Holds 80 litres of one liquid, and nothing solid.' },
  lectern: { name: 'Lectern', category: 'misc', weight: 12, decay: 4, description: 'A slanted stand to read from.' },
  coat_rack: { name: 'Coat rack', category: 'misc', weight: 6, decay: 4, description: 'Pegs on a post, by the door.' },
  planter: { name: 'Planter', category: 'misc', weight: 12, decay: 4, description: 'A box of earth with something green in it.' },
  firewood_rack: { name: 'Firewood rack', category: 'misc', weight: 14, decay: 4, description: 'Keeps the wood off the wet ground. Holds 40 things.' },
  ale_bucket: { name: 'Bucket of ale', category: 'food', weight: 6, decay: 2, drink: 0.4, charges: 5, description: 'Thin, sour and honest. Drink it and the work goes easier for a good while.', feeds: { starch: 0.12 } },
  cider_bucket: { name: 'Bucket of cider', category: 'food', weight: 6, decay: 2, drink: 0.45, charges: 5, description: 'Pressed apples gone dangerous. A trade comes easier after it.', feeds: { greens: 0.1 } },
  mead_bucket: { name: 'Bucket of mead', category: 'food', weight: 6, decay: 1.5, drink: 0.5, charges: 5, description: 'Honey and time. The best thing to come out of a hive after the honey itself.', feeds: { starch: 0.12, greens: 0.04 } },
  wine_bucket: { name: 'Bucket of wine', category: 'food', weight: 6, decay: 1, drink: 0.5, charges: 5, description: 'Cherries, water and three quarters of an hour of patience.', feeds: { greens: 0.1 } },
  fishing_rod: { name: 'Fishing rod', category: 'tool', weight: 1.4, decay: 3, description: 'Two shafts spliced, a waxed line and a strip of metal bent into a hook. Stand at water and fish.' },
  minnow: { name: 'Minnow', category: 'food', weight: 0.1, stackable: true, food: 0.06, decay: 9, description: 'A finger of silver. Bait, if you are honest about it.', feeds: { flesh: 0.04 } },
  perch: { name: 'Perch', category: 'food', weight: 0.5, stackable: true, food: 0.2, decay: 8, description: 'Striped and spiny and everywhere there is water with a foot of depth.', feeds: { flesh: 0.09 } },
  trout: { name: 'Trout', category: 'food', weight: 1.2, stackable: true, food: 0.34, decay: 8, description: 'Runs where the water is properly deep. Worth cooking properly.', feeds: { flesh: 0.13 } },
  pike: { name: 'Pike', category: 'food', weight: 3, stackable: true, food: 0.55, decay: 7, description: 'All teeth and bad temper. It takes a good hand to land one.', feeds: { flesh: 0.18 } },
  sturgeon: { name: 'Sturgeon', category: 'food', weight: 9, stackable: true, food: 0.85, decay: 6, description: 'The deep water fish. Most people fish for a lifetime and never see one.', feeds: { flesh: 0.24 } },
  cooked_fish: { name: 'Cooked fish', category: 'food', weight: 0.6, stackable: true, food: 0.52, decay: 4, description: 'Fish over a fire, which is what fish is for.', feeds: { flesh: 0.28, fat: 0.1 } },
  apple: { name: 'Apple', category: 'food', weight: 0.2, stackable: true, food: 0.16, decay: 2, description: 'Picked off the tree. Keeps a while, bakes into a pie, and presses into cider.', feeds: { greens: 0.07 } },
  cherry: { name: 'Cherry', category: 'food', weight: 0.05, stackable: true, food: 0.07, decay: 5, description: 'Sweet and gone in a moment. Better preserved than eaten by the handful.', feeds: { greens: 0.04 } },
  olive: { name: 'Olive', category: 'food', weight: 0.06, stackable: true, food: 0.09, decay: 1.5, description: 'Bitter off the branch and worth a great deal pressed.', feeds: { fat: 0.05 } },
  olive_oil: { name: 'Olive oil', category: 'food', weight: 0.4, stackable: true, food: 0.3, decay: 0.6, description: 'Pressed from olives under a quern. Keeps almost indefinitely and makes anything cooked in it better.', feeds: { fat: 0.18 } },
  apple_pie: { name: 'Apple pie', category: 'food', weight: 0.9, stackable: true, food: 0.62, decay: 3, description: 'Pastry over stewed apple, baked in an oven. As good as food gets on this island.', feeds: { starch: 0.22, greens: 0.2, fat: 0.1 } },
  sack: { name: 'Sack', category: 'misc', weight: 0.4, decay: 8, holds: 40, shelter: 0.8, description: 'A cloth sack. Holds 40 things, and keeps a little of the weather off them if it is left out.' },
  satchel: { name: 'Satchel', category: 'misc', weight: 1.2, decay: 4, holds: 25, shelter: 0.5, description: 'A stitched leather satchel with a flap. Holds 25 things, and what is in it rots at half the rate if you leave it lying about.' },
  backpack: { name: 'Backpack', category: 'misc', weight: 2.4, decay: 4, holds: 60, shelter: 0.4, description: 'A deep leather pack on ribbon straps. Holds 60 things and sheds most of the weather. Drop a full one at a work post and it keeps.' },
  work_post: { name: 'Work post', category: 'misc', weight: 5, decay: 4, description: 'A stake, a crossbar and a strip of metal for a marker. Driven into open ground off your deed, it stands half an hour to three hours by its quality, and one wildermon will work out of it as it would out of a settlement. When it goes over, the creature comes back to you.' },
  hive: { name: 'Hive', category: 'misc', weight: 10, decay: 4, description: 'A stack of shallow boxes for a swarm to live in. Set it down on your deed and keep a Vesp there, and it fills itself with honey and beeswax. Holds 40 of them.' },
  rope_tool: { name: 'Rope tool', category: 'tool', weight: 1.2, description: 'A grooved block the strands are laid round and twisted against. Nothing is roped without one.' },
  spindle: { name: 'Spindle', category: 'misc', weight: 5, decay: 4, description: 'Spins wool, cotton and wemp into yarn. Stand at it to work.' },
  loom: { name: 'Loom', category: 'misc', weight: 30, decay: 4, description: 'Weaves yarn into cloth. Stand at it to work.' },
  // Brick and mortar, carried flat-packed like everything else until it is set down.
  smelter: { name: 'Smelter', category: 'misc', weight: 52, decay: 3, description: 'A stone smelter, built flat-packed and bedded in where you set it down. Turns ore into lumps, and mixes alloys. It stands on your own deed.' },
  kiln: { name: 'Kiln', category: 'misc', weight: 34, decay: 3, description: 'A brick kiln for firing clay. Set it down anywhere dry and flat; take it up again when it is cold and empty.' },
  oven: { name: 'Oven', category: 'misc', weight: 46, decay: 3, description: 'A bread oven of brick and mortar. Feed it wood, light it, and cook at it as you would a fire — only it does not burn the dinner.' },
  well: { name: 'Well', category: 'misc', weight: 58, decay: 3, description: 'A lined shaft with a windlass over it. It draws its own water, faster the better it was sunk, and holds 50 litres.' },
  bulk_bin: { name: 'Bulk storage bin', category: 'misc', weight: 38, decay: 4, description: 'A deep bin for bulk: bricks, ore, planks, grain. Holds 400 things, and nothing that does not stack.' },
  trash_crate: { name: 'Trash crate', category: 'misc', weight: 6, decay: 4, description: 'An open crate with a rotten bottom. Anything put in it rots thirty times faster than it would in the rain.' },
  cart: { name: 'Small cart', category: 'misc', weight: 26, decay: 4, description: 'Two wheels and a pair of shafts. Take hold of it and it follows you about, carrying 100 things you do not have to.' },
  large_cart: { name: 'Large cart', category: 'misc', weight: 180, decay: 4, description: 'A two-wheeled cart with a box body and a seat over the axle. It holds 1000 things of any weight, and nothing under a hitched wildermon will move it.' },
  wagon: { name: 'Wagon', category: 'misc', weight: 420, decay: 4, description: 'Four wheels, two axles and a bed you could sleep a family on. It holds 10000 things of any weight, and it does not roll until all four yokes have a wildermon in them.' },
  rowing_boat: { name: 'Rowing boat', category: 'misc', weight: 210, decay: 4, description: 'A clinker hull with a pair of oars in her. Launch her into two deep of water, climb aboard and row. Carries 300 things and you.' },
  sailing_boat: { name: 'Sailing boat', category: 'misc', weight: 620, decay: 4, description: 'A decked hull with a mast, a sail and a rudder. Four deep of water under her, and she goes where the coast goes. Carries 1500 things.' },
  small_barrel: { name: 'Small barrel', category: 'misc', weight: 7, decay: 4, description: 'Holds 30 litres of one liquid, and nothing solid at all.' },
  large_barrel: { name: 'Large barrel', category: 'misc', weight: 34, decay: 4, description: 'Holds 250 litres of one liquid. It takes a while to fill and longer to empty.' },
};

/**
 * What a hoard is made of: the deep metals, best first.
 *
 * Here rather than in `butcher.ts` with the dragon it used to come off,
 * because a hoard is come by two ways now and `butcher.ts` reaches into
 * `creatures.ts`. `treasure.ts` importing it from there closed a ring —
 * treasure → butcher → creatures → treasure — and the module that lost the
 * race was the one whose actions `ACTIONS` spreads, so the whole action list
 * came up empty at run time with "TREASURE_ACTIONS is not iterable". It
 * builds perfectly either way; only running it says so.
 */
export const HOARD_METALS = ['adamantine_lump', 'glimmersteel_lump', 'mithril_lump', 'seryll_lump', 'gold_lump', 'silver_lump'];

export interface Item {
  uid: number;
  id: string;
  ql: number;
  dmg: number;
  count: number;
  /** Free text qualifier such as a wood or tree species. */
  extra?: string;
  /** Remaining drinks in a container, or seconds of candle left in a lantern. */
  charges?: number;
  /** Alight, for the things that burn. */
  lit?: boolean;
  /**
   * Handed out rather than made. What you washed ashore with is serviceable
   * and no more: it can be mended, but there is nothing in it to better.
   */
  issued?: boolean;
  /** 1 rare, 2 supreme, 3 fantastic; absent for the ordinary run of things. */
  rare?: number;
  /** Who made it, for rare work and better: a maker's mark. The island keeps the same. */
  maker?: string;
  /** What is in it, for the things that hold things. */
  inside?: Item[];
  /** The colour it has been dyed, for the things that take a dye. */
  dye?: string;
  /** Circles of cunning worked into it, 1..3; absent for the ordinary run of things. */
  bless?: number;
  /**
   * Locked. A locked thing will not be dropped, eaten, fed to anything, put on
   * a hook, or swallowed by a craft that was looking for one of its kind. It
   * is the only way to keep your last good hatchet out of the next recipe.
   */
  locked?: boolean;
}

/**
 * Rarity. Now and again a thing comes off the bench better than the hands
 * that made it had any right to produce — the grain runs true, the temper
 * takes, the joint pulls up square the first time. Nothing about the maker
 * decides it and nothing can be done to bring it on; it simply happens, and
 * what it leaves behind is better at whatever it was for, slower to wear and
 * slower to rot, and can be bettered past the ceiling of the skill that made
 * it.
 */
export interface RarityDef {
  name: string;
  /** Multiplier on what the thing is for: its edge, its soak, its bite, its room. */
  boost: number;
  /** Multiplier on how fast it wears and rots. */
  keep: number;
  /** Quality it may be improved past your own skill by. */
  ceiling: number;
  /** Colour it is written in. */
  colour: string;
}

export const RARITIES: RarityDef[] = [
  { name: '', boost: 1, keep: 1, ceiling: 0, colour: '' },
  { name: 'rare', boost: 1.1, keep: 0.8, ceiling: 5, colour: '#8fc8f0' },
  { name: 'supreme', boost: 1.25, keep: 0.6, ceiling: 12, colour: '#c79bf0' },
  { name: 'fantastic', boost: 1.5, keep: 0.35, ceiling: 25, colour: '#f0c060' },
];

/**
 * Chance of each step, rolled in turn: one thing in a hundred is rare, one in
 * a thousand supreme, one in ten thousand fantastic. Nobody sets out to make
 * a fantastic anything; you make ten thousand ordinary ones and find you have.
 */
export const RARITY_ODDS = [1 / 100, 1 / 10, 1 / 10];
/** What is said when one comes off the bench. */
export const RARITY_WORD = [
  '',
  'Something in the grain runs true and it comes out better than it had any right to be.',
  'Your hands know what to do before you do, and what they leave is not far off perfect.',
  'For a moment the whole of it is obvious, and what you set down is the finest thing you will ever make.',
];

/**
 * What is said when a thing you are already working becomes more than it was.
 *
 * Its own three sentences rather than the bench's, because they are a
 * different moment: nothing has been set down, and the thing in your hands is
 * one you have been at for a while.
 */
export const RARITY_LIFT = [
  '',
  'Something gives under the file, and what was an ordinary thing is not one any more.',
  'You go over it once more and it comes back at you: a better thing than the one you started on.',
  'The last stroke lands and the whole of it settles. You will not make its like again.',
];

export const rarityOf = (item: { rare?: number }): RarityDef => RARITIES[Math.max(0, Math.min(3, item.rare ?? 0))];

/**
 * The chance a thing is this rare *at all*, rather than the chance of the step
 * on its own.
 *
 * `RARITY_ODDS` is rolled in turn, so each entry is conditional on the one
 * before it: a tenth, of a tenth, of a hundredth. What somebody actually means
 * by "the odds of a fantastic" is the three multiplied out — one in ten
 * thousand — and that is what this is.
 */
export const rarityChance = (step: number): number =>
  step < 1 || step >= RARITIES.length ? 0 : RARITY_ODDS.slice(0, step).reduce((p, o) => p * o, 1);

/**
 * A step up under the file, on a pass that went well.
 *
 * The same odds as making one outright, and one step at a time: a hundred good
 * passes turn a plain thing rare about once, a thousand turn a rare thing
 * supreme, ten thousand turn a supreme thing fantastic. Never two steps — an
 * ordinary thing does not become fantastic because somebody was lucky once,
 * and there is no way to reach the top of it but through the middle.
 *
 * Null when nothing happened, which is almost always, and when there is
 * nothing above what it already is.
 */
export function liftRarity(item: { rare?: number }, rand: () => number): number | null {
  const step = (item.rare ?? 0) + 1;
  if (step >= RARITIES.length) return null;
  return rand() < rarityChance(step) ? step : null;
}

/** Roll for rarity on a newly made thing: nothing helps and nothing hurts. */
export function rollRarity(rand: () => number): number {
  let step = 0;
  for (const odds of RARITY_ODDS) {
    if (rand() >= odds) break;
    step++;
  }
  return step;
}

export function itemDef(id: string): ItemDef {
  return ITEM_DEFS[id] ?? { name: id, category: 'misc', weight: 1 };
}

/**
 * Damage per real hour for an item lying on the ground; better quality holds
 * up longer, and what it is made of decides the rest. A cedar chest left in
 * the rain is still a chest a long time after the pine one has gone.
 */
export function groundDecayRate(item: Item): number {
  const def = itemDef(item.id);
  const base = def.decay ?? CATEGORY_DECAY[def.category];
  return base * Math.max(0.3, 1.4 - item.ql / 120) * matOfItem(item).decay * rarityOf(item).keep;
}

/** What one of a thing weighs, which is its make and what it is made of. */
export const unitWeight = (item: { id: string; extra?: string }): number => itemDef(item.id).weight * matOfItem(item).weight;
/** What a whole stack of it weighs, and everything it has inside it. */
export const itemWeight = (item: { id: string; extra?: string; count: number; inside?: Item[] }): number =>
  unitWeight(item) * item.count + (item.inside ?? []).reduce((n, it) => n + itemWeight(it), 0);

// ---- Bags: the things that hold other things. ----

/** How many a bag takes, or nothing at all for the things that are not bags. */
export const bagRoom = (item: Item): number => itemDef(item.id).holds ?? 0;
export const isBag = (item: Item): boolean => bagRoom(item) > 0;
export const bagUnits = (item: Item): number => (item.inside ?? []).reduce((n, it) => n + it.count, 0);

/**
 * Why a bag will not take something, or null. Nothing that holds things may
 * go inside something else that holds things: that way lies a bag inside a
 * bag inside a bag, and a weight nobody can work out.
 */
export function bagRefuses(bag: Item, item: Item): string | null {
  if (!isBag(bag)) return `A ${itemDef(bag.id).name.toLowerCase()} does not hold things.`;
  if (isBag(item)) return 'One bag will not go inside another.';
  if (bagUnits(bag) + item.count > bagRoom(bag)) return `The ${itemDef(bag.id).name.toLowerCase()} is full.`;
  return null;
}

/** Put something in a bag, stacking with what is already in it where it will. */
export function bagAdd(bag: Item, item: Item): boolean {
  if (bagRefuses(bag, item)) return false;
  if (!bag.inside) bag.inside = [];
  const def = ITEM_DEFS[item.id];
  const stack = def?.stackable ? bag.inside.find((it) => it.id === item.id && it.extra === item.extra && it.rare === item.rare && it.dye === item.dye) : undefined;
  if (stack) {
    stack.ql = (stack.ql * stack.count + item.ql * item.count) / (stack.count + item.count);
    stack.count += item.count;
  } else bag.inside.push(item);
  return true;
}

/** Take something out of a bag, whole. */
export function bagTake(bag: Item, uid: number): Item | null {
  const idx = (bag.inside ?? []).findIndex((it) => it.uid === uid);
  if (idx < 0) return null;
  const [item] = (bag.inside as Item[]).splice(idx, 1);
  return item;
}

export function itemName(item: Item): string {
  const def = itemDef(item.id);
  const rare = rarityOf(item).name;
  // Colour comes first, then rarity, then the thing itself: a Blue supreme
  // cloth tunic reads the way somebody would actually say it.
  const colour = dyeWord(item.dye);
  const words = [colour, rare].filter(Boolean).join(' ');
  const base = words ? `${words.charAt(0).toUpperCase()}${words.slice(1)} ${def.name.toLowerCase()}` : def.name;
  let name = item.extra ? `${base} (${item.extra.toLowerCase()})` : base;
  if (def.charges) name += ` (${item.charges ?? 0}/${def.charges})`;
  return name;
}

/**
 * Where item numbers come from: one well per island, not one per pack.
 *
 * Every item ever made here gets a number, and two items wearing the same
 * number are the same item as far as anything that looks one up is concerned
 * — a crate, a trade, a save. While each pack minted its own numbers, the
 * second guest through the door began counting from wherever the first had
 * begun, and their shovel and his spoon were the same item.
 *
 * So the counter is a thing that can be held rather than a number that can be
 * copied, and everybody on the island holds the same one.
 */
export class UidWell {
  constructor(public next = 1) {}
}

export class Inventory {
  items: Item[] = [];
  onChange?: () => void;
  /** The island's item numbers, shared with every other pack and with the ground. */
  readonly well: UidWell;

  constructor(items?: Item[], nextUid?: number | UidWell) {
    this.well = nextUid instanceof UidWell ? nextUid : new UidWell(nextUid ?? 1);
    if (items) {
      this.items = items;
      this.nextUid = Math.max(this.nextUid, items.reduce((m, it) => Math.max(m, it.uid), 0) + 1);
    }
  }

  /** Next item uid; shared with items lying on the ground so uids never collide. */
  get nextUid(): number {
    return this.well.next;
  }

  set nextUid(v: number) {
    this.well.next = v;
  }

  add(id: string, opts: { ql?: number; count?: number; extra?: string; issued?: boolean } = {}): Item {
    const def = itemDef(id);
    const count = opts.count ?? 1;
    const ql = Math.max(1, Math.min(100, opts.ql ?? 20));
    const item: Item = { uid: this.nextUid++, id, ql, dmg: 0, count, extra: opts.extra };
    if (opts.issued) item.issued = true;
    if (def.charges) item.charges = def.charges;
    return this.addItem(item);
  }

  /** Whether anything may quietly take this: a craft, a hook, a hungry beast. */
  loose(item: Item): boolean {
    return !item.locked;
  }

  /** Put an existing item into the inventory, merging it into a matching stack. */
  addItem(item: Item): Item {
    const def = itemDef(item.id);
    if (item.uid >= this.nextUid) this.nextUid = item.uid + 1;
    if (def.stackable) {
      const existing = this.items.find((it) => it.id === item.id && it.extra === item.extra && it.rare === item.rare && it.dye === item.dye && it.uid !== item.uid);
      if (existing) {
        existing.ql = (existing.ql * existing.count + item.ql * item.count) / (existing.count + item.count);
        existing.count += item.count;
        this.onChange?.();
        return existing;
      }
    }
    this.items.push(item);
    this.onChange?.();
    return item;
  }

  /** Take `count` units out as a separate item (the whole item when it has no more than that). */
  take(uid: number, count = 1): Item | null {
    const idx = this.items.findIndex((it) => it.uid === uid);
    if (idx < 0) return null;
    const item = this.items[idx];
    if (count >= item.count) {
      this.items.splice(idx, 1);
      this.onChange?.();
      return item;
    }
    item.count -= count;
    this.onChange?.();
    return { ...item, uid: this.nextUid++, count };
  }

  /** Removes `count` units of an item; returns false when there were not enough. */
  remove(uid: number, count = 1): boolean {
    const idx = this.items.findIndex((it) => it.uid === uid);
    if (idx < 0) return false;
    const item = this.items[idx];
    if (item.count < count) return false;
    item.count -= count;
    if (item.count <= 0) this.items.splice(idx, 1);
    this.onChange?.();
    return true;
  }

  /**
   * Consume `count` of an item id, drawing across as many stacks as it takes.
   * Once wood and metal are told apart, a pack holds three separate piles of
   * plank as often as one, and a bill for five of them should not care.
   */
  /**
   * Take things to be used up. A **locked** thing is never taken: that is the
   * whole of what locking is for, and it is why `find`, `consume` and `count`
   * look past one while `has`, `get` and `tool` do not — you can still work
   * with a locked hatchet, nothing will quietly eat it.
   */
  consume(id: string, count = 1, extra?: string): boolean {
    const stacks = this.items.filter((it) => it.id === id && !it.locked && (extra === undefined || it.extra === extra));
    if (stacks.reduce((n, it) => n + it.count, 0) < count) return false;
    let left = count;
    for (const st of [...stacks]) {
      if (left <= 0) break;
      const take = Math.min(left, st.count);
      if (this.remove(st.uid, take)) left -= take;
    }
    return left === 0;
  }

  /** The first loose one of a kind: something locked is not offered up. */
  find(id: string, extra?: string): Item | undefined {
    return this.items.find((it) => it.id === id && !it.locked && (extra === undefined || it.extra === extra));
  }

  get(uid: number): Item | undefined {
    return this.items.find((it) => it.uid === uid);
  }

  /**
   * A thing you are carrying, wherever in the pack it is: loose in your hands
   * or stowed in one of your bags.
   *
   * Deliberately not `get`. A hundred places ask `get` what is in your hands
   * and then spend it, and `remove` and `take` only know about the top level,
   * so widening that one would offer jobs that quietly did nothing — the
   * shape of bug the bag work exists to fix. This is asked by the few that
   * the island has agreed may reach into a bag: filling something, drinking
   * out of it, and taking one thing back out.
   */
  held(uid: number): Item | undefined {
    const loose = this.items.find((it) => it.uid === uid);
    if (loose) return loose;
    // One bag will not go inside another, so there is no deeper to look.
    for (const bag of this.items) {
      const inside = bag.inside?.find((it) => it.uid === uid);
      if (inside) return inside;
    }
    return undefined;
  }

  /** The bag a thing is stowed in, when it is in one. */
  bagWith(uid: number): Item | undefined {
    return this.items.find((b) => b.inside?.some((it) => it.uid === uid));
  }

  has(id: string): boolean {
    return this.items.some((it) => it.id === id);
  }

  /** How many of a kind are loose and could be spent. */
  count(id: string): number {
    return this.items.filter((it) => it.id === id && !it.locked).reduce((n, it) => n + it.count, 0);
  }

  /** How many there are of a kind, locked or not, for saying so plainly. */
  countAll(id: string): number {
    return this.items.filter((it) => it.id === id).reduce((n, it) => n + it.count, 0);
  }

  /**
   * The best tool of a kind to work with, or undefined. Quality is only half
   * of it once metals differ: a bronze hatchet at forty beats a copper one at
   * fifty, so they are weighed by what they are actually worth at the work.
   */
  tool(id: string): Item | undefined {
    let best: Item | undefined;
    let bestWorth = -1;
    for (const it of this.items) {
      if (it.id !== id) continue;
      const worth = workingQl(it.ql, it.extra) * Math.max(0.3, 1 - it.dmg / 160);
      if (worth > bestWorth) [bestWorth, best] = [worth, it];
    }
    return best;
  }

  /**
   * What a back will take before it starts to tell. Body strength is most of
   * it, and everything above this is carried at a price in pace and wind.
   */
  totalWeight(): number {
    return this.items.reduce((sum, it) => sum + itemWeight(it), 0);
  }
}
