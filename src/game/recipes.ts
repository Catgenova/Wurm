import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { itemDef } from './items';
import { FURNITURE } from './furniture';
import { MOULDS } from './metal';

/**
 * Everything the player can make from what they carry. A recipe is a tool
 * (kept) plus materials (used up) that become a result. Each recipe is also
 * an item action, so it shows on the material's menu as well as in the
 * crafting window.
 */
export type RecipeCategory = 'Woodwork' | 'Furniture' | 'Stonework' | 'Clay & thatch' | 'Cloth' | 'Cooking' | 'Smelting';
/** A place a recipe has to be worked at, beyond what is carried. */
export type Station = 'campfire' | 'smelter' | 'spindle' | 'loom';
const STATION_NAME: Record<Station, string> = { campfire: 'lit campfire', smelter: 'hot smelter', spindle: 'spindle', loom: 'loom' };

export interface RecipeInput {
  item: string;
  count?: number;
}

export interface Recipe {
  id: string;
  category: RecipeCategory;
  /** Item id made. */
  result: string;
  /** Units of the result per craft. */
  count?: number;
  /** Materials used up per craft; the first is the one shown in the item menu label. */
  inputs: RecipeInput[];
  /** Tool that must be carried but is not used up. */
  tool?: string;
  /** Something that must be standing nearby, such as a lit fire to cook on. */
  station?: Station;
  skill: string;
  /** Menu label on the material, such as "Saw into planks". */
  label: string;
  verb: string;
  baseTime: number;
  stamina: number;
  /** When set, a skill check can fail. */
  difficulty?: number;
  /** Food burns: a failed attempt eats the ingredients anyway. */
  consumeOnFail?: boolean;
  /**
   * The product's quality comes from what went into it rather than from the
   * worker's hands. Mixing two fine lumps gives fine metal; skill only decides
   * how little of that quality is lost in the pouring.
   */
  qlFromInputs?: boolean;
  done: string;
  fail?: string;
}

export const RECIPES: Recipe[] = [
  // Woodwork
  { id: 'make_planks', category: 'Woodwork', result: 'plank', count: 3, inputs: [{ item: 'log' }], tool: 'saw', skill: 'carpentry', label: 'Saw into planks', verb: 'sawing', baseTime: 5, stamina: 0.04, done: 'You saw the log into three planks.' },
  { id: 'make_timbers', category: 'Woodwork', result: 'timber', count: 2, inputs: [{ item: 'log' }], tool: 'saw', skill: 'carpentry', label: 'Saw into timbers', verb: 'sawing', baseTime: 5, stamina: 0.04, done: 'You saw the log into two timbers.' },
  { id: 'make_shafts', category: 'Woodwork', result: 'shaft', count: 4, inputs: [{ item: 'log' }], tool: 'carving_knife', skill: 'carpentry', label: 'Carve shafts', verb: 'carving shafts', baseTime: 5, stamina: 0.03, done: 'You carve the log into four shafts.' },
  { id: 'make_mallet', category: 'Woodwork', result: 'mallet', inputs: [{ item: 'log' }], tool: 'carving_knife', skill: 'carpentry', label: 'Carve a mallet', verb: 'carving a mallet', baseTime: 8, stamina: 0.04, difficulty: 8, done: 'You carve a mallet from the log.', fail: 'The head splits as you shape it. You fail to carve a mallet.' },
  { id: 'make_deed_stake', category: 'Woodwork', result: 'deed_stake', inputs: [{ item: 'shaft' }], tool: 'carving_knife', skill: 'carpentry', label: 'Carve a deed stake', verb: 'carving a deed stake', baseTime: 10, stamina: 0.05, difficulty: 10, done: 'You whittle the shaft to a point and notch it for a claim.', fail: 'The shaft splits along the grain. You fail to carve a deed stake.' },
  { id: 'make_log_crate', category: 'Woodwork', result: 'crate_log', inputs: [{ item: 'log', count: 3 }, { item: 'nail', count: 8 }], tool: 'mallet', skill: 'carpentry', label: 'Build log crate', verb: 'building a crate', baseTime: 6, stamina: 0.05, done: 'You nail together a log crate. Place it on any spot of a tile.' },
  { id: 'make_plank_crate', category: 'Woodwork', result: 'crate_plank', inputs: [{ item: 'plank', count: 6 }, { item: 'nail', count: 12 }], tool: 'mallet', skill: 'carpentry', label: 'Build plank crate', verb: 'building a crate', baseTime: 6, stamina: 0.05, done: 'You nail together a plank crate. Place it on any spot of a tile.' },
  // Stonework
  { id: 'make_stone_brick', category: 'Stonework', result: 'stone_brick', inputs: [{ item: 'rock_shards' }], tool: 'chisel', skill: 'stonecutting', label: 'Chisel stone brick', verb: 'chiselling', baseTime: 6, stamina: 0.04, difficulty: 12, done: 'You chisel a stone brick.', fail: 'The shard splits the wrong way. You fail to make a brick.' },
  { id: 'make_slate_brick', category: 'Stonework', result: 'slate_brick', inputs: [{ item: 'slate_shards' }], tool: 'chisel', skill: 'stonecutting', label: 'Chisel slate brick', verb: 'chiselling', baseTime: 6, stamina: 0.04, difficulty: 12, done: 'You chisel a slate brick.', fail: 'The slate flakes apart. You fail to make a brick.' },
  { id: 'make_marble_brick', category: 'Stonework', result: 'marble_brick', inputs: [{ item: 'marble_shards' }], tool: 'chisel', skill: 'stonecutting', label: 'Chisel marble brick', verb: 'chiselling', baseTime: 6, stamina: 0.04, difficulty: 12, done: 'You chisel a marble brick.', fail: 'The marble cracks. You fail to make a brick.' },
  { id: 'make_sandstone_brick', category: 'Stonework', result: 'sandstone_brick', inputs: [{ item: 'sandstone_shards' }], tool: 'chisel', skill: 'stonecutting', label: 'Chisel sandstone brick', verb: 'chiselling', baseTime: 6, stamina: 0.04, difficulty: 12, done: 'You chisel a sandstone brick.', fail: 'The sandstone crumbles. You fail to make a brick.' },
  // Slabs: two shards squared off into one flat stone, for paving.
  { id: 'make_stone_slab', category: 'Stonework', result: 'stone_slab', inputs: [{ item: 'rock_shards', count: 2 }], tool: 'chisel', skill: 'stonecutting', label: 'Cut a stone slab', verb: 'cutting a slab', baseTime: 9, stamina: 0.05, difficulty: 16, done: 'You square off a stone slab.', fail: 'The stone splits across the face. You fail to cut a slab.' },
  { id: 'make_slate_slab', category: 'Stonework', result: 'slate_slab', inputs: [{ item: 'slate_shards', count: 2 }], tool: 'chisel', skill: 'stonecutting', label: 'Cut a slate slab', verb: 'cutting a slab', baseTime: 9, stamina: 0.05, difficulty: 14, done: 'You split a clean slate slab.', fail: 'The slate shears into flakes. You fail to cut a slab.' },
  { id: 'make_marble_slab', category: 'Stonework', result: 'marble_slab', inputs: [{ item: 'marble_shards', count: 2 }], tool: 'chisel', skill: 'stonecutting', label: 'Cut a marble slab', verb: 'cutting a slab', baseTime: 10, stamina: 0.05, difficulty: 20, done: 'You cut a marble slab and rub the face smooth.', fail: 'A vein runs the wrong way and the marble parts. You fail to cut a slab.' },
  { id: 'make_sandstone_slab', category: 'Stonework', result: 'sandstone_slab', inputs: [{ item: 'sandstone_shards', count: 2 }], tool: 'chisel', skill: 'stonecutting', label: 'Cut a sandstone slab', verb: 'cutting a slab', baseTime: 9, stamina: 0.05, difficulty: 15, done: 'You cut a sandstone slab.', fail: 'The sandstone crumbles at the edge. You fail to cut a slab.' },
  { id: 'make_mortar', category: 'Stonework', result: 'mortar', count: 2, inputs: [{ item: 'clay' }, { item: 'sand' }], skill: 'masonry', label: 'Mix mortar', verb: 'mixing mortar', baseTime: 4, stamina: 0.03, done: 'You mix clay and sand into two lots of mortar.' },
  // Clay & thatch
  { id: 'make_clay_brick', category: 'Clay & thatch', result: 'unfired_clay_brick', inputs: [{ item: 'clay' }], skill: 'pottery', label: 'Shape clay brick', verb: 'shaping clay', baseTime: 4, stamina: 0.02, difficulty: 6, done: 'You shape a clay brick. It needs a kiln before it is any use.', fail: 'The clay slumps. You fail to shape a brick.' },
  { id: 'make_clay_pot', category: 'Clay & thatch', result: 'unfired_clay_pot', inputs: [{ item: 'clay', count: 2 }], skill: 'pottery', label: 'Shape a pot', verb: 'shaping a pot', baseTime: 8, stamina: 0.03, difficulty: 12, done: 'You raise the walls of a deep pot. Fire it in a kiln.', fail: 'The pot goes out of true as you draw it up and you press it back into a lump.' },
  { id: 'make_clay_jar', category: 'Clay & thatch', result: 'unfired_clay_jar', inputs: [{ item: 'clay' }], skill: 'pottery', label: 'Shape a jar', verb: 'shaping a jar', baseTime: 7, stamina: 0.02, difficulty: 10, done: 'You shape a jar and a lid to sit on it. Fire them in a kiln.', fail: 'The neck collapses. You fail to shape a jar.' },
  { id: 'make_adobe', category: 'Clay & thatch', result: 'adobe', inputs: [{ item: 'clay' }, { item: 'mixed_grass' }], skill: 'pottery', label: 'Make adobe', verb: 'making adobe', baseTime: 4, stamina: 0.02, done: 'You press clay and grass into an adobe block.' },
  { id: 'fit_rake_head', category: 'Woodwork', result: 'rake', inputs: [{ item: 'rake_head' }, { item: 'shaft' }, { item: 'nail', count: 2 }], skill: 'carpentry', label: 'Fit a shaft', verb: 'fitting a shaft', baseTime: 5, stamina: 0.02, done: 'You fit a shaft and the rake is finished.' },
  { id: 'fit_shovel_head', category: 'Woodwork', result: 'shovel', inputs: [{ item: 'shovel_head' }, { item: 'shaft' }, { item: 'nail', count: 2 }], skill: 'carpentry', label: 'Fit a shaft', verb: 'fitting a shaft', baseTime: 5, stamina: 0.02, done: 'You fit a shaft and the shovel is finished.' },
  { id: 'fit_hatchet_head', category: 'Woodwork', result: 'hatchet', inputs: [{ item: 'hatchet_head' }, { item: 'shaft' }, { item: 'nail', count: 2 }], skill: 'carpentry', label: 'Fit a shaft', verb: 'fitting a shaft', baseTime: 5, stamina: 0.02, done: 'You fit a shaft and the hatchet is finished.' },
  { id: 'fit_pickaxe_head', category: 'Woodwork', result: 'pickaxe', inputs: [{ item: 'pickaxe_head' }, { item: 'shaft' }, { item: 'nail', count: 2 }], skill: 'carpentry', label: 'Fit a shaft', verb: 'fitting a shaft', baseTime: 5, stamina: 0.02, done: 'You fit a shaft and the pickaxe is finished.' },
  { id: 'fit_knife_blade', category: 'Woodwork', result: 'butchering_knife', inputs: [{ item: 'knife_blade' }, { item: 'shaft' }, { item: 'nail', count: 2 }], skill: 'carpentry', label: 'Fit a shaft', verb: 'fitting a shaft', baseTime: 5, stamina: 0.02, done: 'You fit a shaft and the butchering knife is finished.' },
  { id: 'fit_sword_blade', category: 'Woodwork', result: 'sword', inputs: [{ item: 'sword_blade' }, { item: 'shaft' }, { item: 'nail', count: 2 }], skill: 'carpentry', label: 'Fit a shaft', verb: 'fitting a shaft', baseTime: 5, stamina: 0.02, done: 'You fit a shaft and the sword is finished.' },
  // Fibre is spun on a spindle and woven on a loom; nothing shortcuts either.
  { id: 'spin_wool', category: 'Cloth', result: 'yarn', count: 2, inputs: [{ item: 'wool', count: 2 }], station: 'spindle', skill: 'tailoring', label: 'Spin into yarn', verb: 'spinning', baseTime: 6, stamina: 0.02, difficulty: 8, done: 'You spin the wool into two lengths of yarn.', fail: 'The thread breaks over and over and the wool is a tangle.', consumeOnFail: true },
  { id: 'spin_cotton', category: 'Cloth', result: 'yarn', count: 2, inputs: [{ item: 'cotton', count: 2 }], station: 'spindle', skill: 'tailoring', label: 'Spin into yarn', verb: 'spinning', baseTime: 6, stamina: 0.02, difficulty: 10, done: 'You spin the cotton into two lengths of yarn.', fail: 'The thread breaks over and over and the cotton is a tangle.', consumeOnFail: true },
  { id: 'spin_wemp', category: 'Cloth', result: 'yarn', count: 2, inputs: [{ item: 'wemp', count: 2 }], station: 'spindle', skill: 'tailoring', label: 'Spin into yarn', verb: 'spinning', baseTime: 6, stamina: 0.02, difficulty: 12, done: 'You spin the wemp into two lengths of coarse yarn.', fail: 'The fibre will not hold together and the lot is wasted.', consumeOnFail: true },
  { id: 'weave_cloth', category: 'Cloth', result: 'cloth', inputs: [{ item: 'yarn', count: 3 }], station: 'loom', skill: 'tailoring', label: 'Weave cloth', verb: 'weaving', baseTime: 9, stamina: 0.03, difficulty: 12, done: 'You weave a length of cloth on the loom.', fail: 'The warp parts halfway down and the piece is ruined.', consumeOnFail: true },
  { id: 'make_bow_string', category: 'Cloth', result: 'bow_string', inputs: [{ item: 'yarn', count: 2 }], skill: 'bowyery', label: 'Twist a bowstring', verb: 'twisting a string', baseTime: 6, stamina: 0.02, difficulty: 14, done: 'You twist and wax a bowstring.', fail: 'The twist runs out of it and the string is no good.', consumeOnFail: true },
  // Cloth armour: sewn from what the loom gives you.
  { id: 'make_wool_cap', category: 'Cloth', result: 'wool_cap', inputs: [{ item: 'cloth', count: 2 }], skill: 'tailoring', label: 'Sew a wool cap', verb: 'sewing a cap', baseTime: 10, stamina: 0.03, difficulty: 14, done: 'You felt and sew a thick wool cap.', fail: 'The seams will not sit true and you unpick the lot.' },
  { id: 'make_cloth_tunic', category: 'Cloth', result: 'cloth_tunic', inputs: [{ item: 'cloth', count: 4 }], skill: 'tailoring', label: 'Sew a cloth tunic', verb: 'sewing a tunic', baseTime: 14, stamina: 0.04, difficulty: 18, done: 'You sew and pad a cloth tunic.', fail: 'The panels will not sit square and you unpick the lot.' },
  { id: 'make_cloth_sleeves', category: 'Cloth', result: 'cloth_sleeves', inputs: [{ item: 'cloth', count: 2 }], skill: 'tailoring', label: 'Sew cloth sleeves', verb: 'sewing sleeves', baseTime: 10, stamina: 0.03, difficulty: 15, done: 'You sew a pair of padded sleeves.', fail: 'One comes out shorter than the other and you unpick them.' },
  { id: 'make_cloth_trousers', category: 'Cloth', result: 'cloth_trousers', inputs: [{ item: 'cloth', count: 3 }], skill: 'tailoring', label: 'Sew cloth trousers', verb: 'sewing trousers', baseTime: 12, stamina: 0.03, difficulty: 16, done: 'You sew a pair of cloth trousers.', fail: 'The seat sits all wrong and you unpick them.' },
  { id: 'make_cloth_shoes', category: 'Cloth', result: 'cloth_shoes', inputs: [{ item: 'cloth', count: 2 }], skill: 'tailoring', label: 'Sew cloth shoes', verb: 'sewing shoes', baseTime: 9, stamina: 0.03, difficulty: 14, done: 'You sew a pair of soft cloth shoes.', fail: 'The soles will not take the stitching.' },
  // Leather, cut from hide with a knife.
  { id: 'make_leather_cap', category: 'Cloth', result: 'leather_cap', inputs: [{ item: 'leather', count: 2 }], tool: 'carving_knife', skill: 'leatherworking', label: 'Cut a leather cap', verb: 'working leather', baseTime: 11, stamina: 0.04, difficulty: 16, done: 'You cut and stitch a leather cap.', fail: 'The hide tears along the stitch line.', consumeOnFail: true },
  { id: 'make_leather_jerkin', category: 'Cloth', result: 'leather_jerkin', inputs: [{ item: 'leather', count: 5 }], tool: 'carving_knife', skill: 'leatherworking', label: 'Cut a leather jerkin', verb: 'working leather', baseTime: 16, stamina: 0.05, difficulty: 22, done: 'You cut and stitch a leather jerkin.', fail: 'The hide tears along the stitch line.', consumeOnFail: true },
  { id: 'make_leather_sleeves', category: 'Cloth', result: 'leather_sleeves', inputs: [{ item: 'leather', count: 3 }], tool: 'carving_knife', skill: 'leatherworking', label: 'Cut leather sleeves', verb: 'working leather', baseTime: 12, stamina: 0.04, difficulty: 19, done: 'You cut and stitch a pair of leather sleeves.', fail: 'The hide tears along the stitch line.', consumeOnFail: true },
  { id: 'make_leather_trousers', category: 'Cloth', result: 'leather_trousers', inputs: [{ item: 'leather', count: 4 }], tool: 'carving_knife', skill: 'leatherworking', label: 'Cut leather trousers', verb: 'working leather', baseTime: 14, stamina: 0.05, difficulty: 20, done: 'You cut and stitch a pair of leather trousers.', fail: 'The hide tears along the stitch line.', consumeOnFail: true },
  { id: 'make_leather_boots', category: 'Cloth', result: 'leather_boots', inputs: [{ item: 'leather', count: 3 }], tool: 'carving_knife', skill: 'leatherworking', label: 'Cut leather boots', verb: 'working leather', baseTime: 13, stamina: 0.04, difficulty: 18, done: 'You cut and stitch a pair of leather boots.', fail: 'The hide tears along the stitch line.', consumeOnFail: true },
  // Weapons: a head from the anvil and a length of wood to put it on.
  { id: 'fit_short_sword_blade', category: 'Woodwork', result: 'short_sword', inputs: [{ item: 'short_sword_blade' }, { item: 'shaft' }, { item: 'nail', count: 2 }], skill: 'carpentry', label: 'Fit a grip', verb: 'fitting a grip', baseTime: 6, stamina: 0.03, done: 'You bind a grip to the blade and the short sword is finished.' },
  { id: 'fit_long_sword_blade', category: 'Woodwork', result: 'long_sword', inputs: [{ item: 'long_sword_blade' }, { item: 'shaft', count: 2 }, { item: 'nail', count: 3 }], skill: 'carpentry', label: 'Fit a grip', verb: 'fitting a grip', baseTime: 8, stamina: 0.04, done: 'You bind a two-handed grip to the blade and the long sword is finished.' },
  { id: 'fit_axe_head', category: 'Woodwork', result: 'battle_axe', inputs: [{ item: 'axe_head' }, { item: 'shaft', count: 2 }, { item: 'nail', count: 3 }], skill: 'carpentry', label: 'Fit a haft', verb: 'fitting a haft', baseTime: 8, stamina: 0.04, done: 'You wedge the head onto a long haft and the battle axe is finished.' },
  { id: 'fit_maul_head', category: 'Woodwork', result: 'maul', inputs: [{ item: 'maul_head' }, { item: 'shaft', count: 2 }, { item: 'nail', count: 4 }], skill: 'carpentry', label: 'Fit a haft', verb: 'fitting a haft', baseTime: 8, stamina: 0.05, done: 'You wedge the head onto a long haft and the maul is finished.' },
  { id: 'fit_spear_head', category: 'Woodwork', result: 'spear', inputs: [{ item: 'spear_head' }, { item: 'shaft', count: 2 }, { item: 'nail', count: 2 }], skill: 'carpentry', label: 'Fit a shaft', verb: 'fitting a shaft', baseTime: 6, stamina: 0.03, done: 'You bind the head to a long shaft and the spear is finished.' },
  { id: 'make_hunting_knife', category: 'Woodwork', result: 'hunting_knife', inputs: [{ item: 'knife_blade' }, { item: 'shaft' }, { item: 'nail' }], skill: 'carpentry', label: 'Fit a grip', verb: 'fitting a grip', baseTime: 5, stamina: 0.02, done: 'You fit a grip and the hunting knife is finished.' },
  { id: 'make_club', category: 'Woodwork', result: 'club', inputs: [{ item: 'log' }], tool: 'carving_knife', skill: 'carpentry', label: 'Carve a club', verb: 'carving a club', baseTime: 7, stamina: 0.04, difficulty: 8, done: 'You carve a heavy club out of the log.', fail: 'The grain runs out of true and the club splits.' },
  { id: 'make_wooden_shield', category: 'Woodwork', result: 'wooden_shield', inputs: [{ item: 'plank', count: 4 }, { item: 'nail', count: 8 }], tool: 'mallet', skill: 'carpentry', label: 'Build a wooden shield', verb: 'building a shield', baseTime: 11, stamina: 0.05, difficulty: 16, done: 'You nail up a wooden shield and fit its grip.', fail: 'The boards will not pull together and the shield is scrap.' },
  { id: 'make_metal_shield', category: 'Woodwork', result: 'metal_shield', inputs: [{ item: 'shield_boss' }, { item: 'plank', count: 3 }, { item: 'nail', count: 8 }], tool: 'mallet', skill: 'carpentry', label: 'Build a metal shield', verb: 'building a shield', baseTime: 13, stamina: 0.06, difficulty: 20, done: 'You face the boards with the boss and the metal shield is finished.', fail: 'The rivets pull through the boards and the shield is scrap.' },
  // Bows and arrows.
  { id: 'make_short_bow', category: 'Woodwork', result: 'short_bow', inputs: [{ item: 'shaft', count: 2 }, { item: 'bow_string' }], tool: 'carving_knife', skill: 'bowyery', label: 'Tiller a short bow', verb: 'tillering a bow', baseTime: 12, stamina: 0.04, difficulty: 16, done: 'You tiller a short bow and string it.', fail: 'The limbs come out uneven and the stave is firewood.', consumeOnFail: true },
  { id: 'make_medium_bow', category: 'Woodwork', result: 'medium_bow', inputs: [{ item: 'shaft', count: 3 }, { item: 'bow_string' }], tool: 'carving_knife', skill: 'bowyery', label: 'Tiller a medium bow', verb: 'tillering a bow', baseTime: 15, stamina: 0.05, difficulty: 22, done: 'You tiller a medium bow and string it.', fail: 'The limbs come out uneven and the stave is firewood.', consumeOnFail: true },
  { id: 'make_long_bow', category: 'Woodwork', result: 'long_bow', inputs: [{ item: 'shaft', count: 4 }, { item: 'bow_string' }], tool: 'carving_knife', skill: 'bowyery', label: 'Tiller a long bow', verb: 'tillering a bow', baseTime: 18, stamina: 0.06, difficulty: 30, done: 'You tiller a long bow and string it. It takes an age to draw and ends most things at the end of it.', fail: 'The limbs come out uneven and the stave is firewood.', consumeOnFail: true },
  { id: 'make_arrows', category: 'Woodwork', result: 'arrow', count: 3, inputs: [{ item: 'shaft' }, { item: 'arrow_head', count: 3 }, { item: 'feather', count: 3 }], tool: 'carving_knife', skill: 'fletching', label: 'Fletch arrows', verb: 'fletching', baseTime: 8, stamina: 0.03, difficulty: 12, done: 'You split the shaft, set the heads and fletch three arrows.', fail: 'The fletching will not sit straight and the arrows are spoiled.', consumeOnFail: true },
  { id: 'make_thatch', category: 'Clay & thatch', result: 'thatch', inputs: [{ item: 'mixed_grass', count: 2 }], skill: 'carpentry', label: 'Bundle into thatch', verb: 'bundling thatch', baseTime: 3, stamina: 0.02, done: 'You bundle the grass into thatch.' },
  { id: 'make_clay_bowl', category: 'Clay & thatch', result: 'unfired_clay_bowl', inputs: [{ item: 'clay' }], skill: 'pottery', label: 'Shape a bowl', verb: 'shaping a bowl', baseTime: 6, stamina: 0.02, difficulty: 8, done: 'You shape a clay bowl. It needs a kiln before it will hold anything.', fail: 'The walls collapse as you draw them up. You fail to shape a bowl.' },
  // Cooking. Everything here needs a lit campfire to work at.
  { id: 'cook_meat', category: 'Cooking', result: 'cooked_meat', inputs: [{ item: 'meat' }], station: 'campfire', skill: 'cooking', label: 'Cook over the fire', verb: 'cooking', baseTime: 8, stamina: 0.02, difficulty: 6, done: 'You cook the meat through.', fail: 'You char the outside and leave the middle raw. The meat is ruined.', consumeOnFail: true },
  { id: 'bake_potato', category: 'Cooking', result: 'baked_potato', inputs: [{ item: 'potato' }], station: 'campfire', skill: 'cooking', label: 'Bake in the embers', verb: 'baking', baseTime: 7, stamina: 0.02, done: 'You rake a potato out of the embers.' },
  { id: 'roast_onion', category: 'Cooking', result: 'roast_onion', inputs: [{ item: 'onion' }], station: 'campfire', skill: 'cooking', label: 'Roast over the fire', verb: 'roasting', baseTime: 6, stamina: 0.02, done: 'You roast an onion until it is sweet.' },
  { id: 'roast_nuts', category: 'Cooking', result: 'roast_nuts', inputs: [{ item: 'nuts' }], station: 'campfire', skill: 'cooking', label: 'Roast the nuts', verb: 'roasting nuts', baseTime: 4, stamina: 0.01, done: 'You roast the nuts on a hot stone.' },
  { id: 'make_compote', category: 'Cooking', result: 'berry_compote', inputs: [{ item: 'blueberry', count: 3 }], tool: 'clay_bowl', station: 'campfire', skill: 'cooking', label: 'Stew into compote', verb: 'stewing berries', baseTime: 10, stamina: 0.02, done: 'You stew the berries down into a compote.' },
  { id: 'fry_meat', category: 'Cooking', result: 'cooked_meat', count: 2, inputs: [{ item: 'meat', count: 2 }], tool: 'frying_pan', station: 'campfire', skill: 'cooking', label: 'Fry in the pan', verb: 'frying', baseTime: 9, stamina: 0.02, done: 'You fry the meat through in the pan, and none of it is wasted.' },
  { id: 'make_pottage', category: 'Cooking', result: 'pottage', count: 2, inputs: [{ item: 'cabbage' }, { item: 'carrot' }, { item: 'wheat' }], tool: 'clay_pot', station: 'campfire', skill: 'cooking', label: 'Simmer a pottage', verb: 'simmering a pottage', baseTime: 14, stamina: 0.03, difficulty: 8, done: 'You simmer the pot down into two thick helpings of pottage.', fail: 'The pot boils dry and catches. The lot is spoiled.', consumeOnFail: true },
  { id: 'make_preserves', category: 'Cooking', result: 'preserves', count: 2, inputs: [{ item: 'strawberry', count: 2 }, { item: 'raspberry', count: 2 }], tool: 'clay_jar', station: 'campfire', skill: 'cooking', label: 'Put up preserves', verb: 'putting up preserves', baseTime: 12, stamina: 0.02, difficulty: 10, done: 'You seal two jars of preserves while they are still hot.', fail: 'The fruit catches on the bottom and turns bitter.', consumeOnFail: true },
  { id: 'make_stew', category: 'Cooking', result: 'stew', inputs: [{ item: 'cooked_meat' }, { item: 'potato' }, { item: 'onion' }], tool: 'clay_bowl', station: 'campfire', skill: 'cooking', label: 'Simmer a stew', verb: 'simmering a stew', baseTime: 16, stamina: 0.03, difficulty: 10, done: 'You simmer meat and vegetables into a thick stew.', fail: 'The pot catches and the stew is spoiled.', consumeOnFail: true },
  ...[],
];

/** Every mould is fired from sand at a smelter; the table decides the rest. */
const MOULD_RECIPES: Recipe[] = MOULDS.map((m) => ({
  id: `make_${m.id}`,
  category: 'Smelting' as RecipeCategory,
  result: m.id,
  inputs: [{ item: 'sand', count: m.sand }],
  station: 'smelter' as Station,
  skill: m.skill,
  label: `Fire a ${m.name.toLowerCase()}`,
  verb: 'firing a mould',
  baseTime: 8 + m.sand,
  stamina: 0.03,
  difficulty: Math.round(m.difficulty * 0.6),
  done: `You fire a ${m.name.toLowerCase()} from the sand.`,
  fail: 'The sand slumps as it heats and the mould is spoiled.',
  consumeOnFail: true,
}));

const SMELTER_RECIPES: Recipe[] = [
  { id: 'make_bronze', category: 'Smelting', result: 'bronze_lump', count: 4, inputs: [{ item: 'copper_lump', count: 3 }, { item: 'tin_lump', count: 1 }], station: 'smelter', skill: 'smelting', qlFromInputs: true, label: 'Mix bronze', verb: 'mixing an alloy', baseTime: 10, stamina: 0.03, difficulty: 12, done: 'You mix a crucible of bronze.', fail: 'The mix will not take and you pour off a ruined crucible.', consumeOnFail: true },
  { id: 'make_brass', category: 'Smelting', result: 'brass_lump', count: 4, inputs: [{ item: 'copper_lump', count: 3 }, { item: 'zinc_lump', count: 1 }], station: 'smelter', skill: 'smelting', qlFromInputs: true, label: 'Mix brass', verb: 'mixing an alloy', baseTime: 10, stamina: 0.03, difficulty: 12, done: 'You mix a crucible of brass.', fail: 'The mix will not take and you pour off a ruined crucible.', consumeOnFail: true },
  { id: 'make_pewter', category: 'Smelting', result: 'pewter_lump', count: 4, inputs: [{ item: 'tin_lump', count: 3 }, { item: 'lead_lump', count: 1 }], station: 'smelter', skill: 'smelting', qlFromInputs: true, label: 'Mix pewter', verb: 'mixing an alloy', baseTime: 10, stamina: 0.03, difficulty: 10, done: 'You mix a crucible of pewter.', fail: 'The mix will not take and you pour off a ruined crucible.', consumeOnFail: true },
  { id: 'make_electrum', category: 'Smelting', result: 'electrum_lump', count: 4, inputs: [{ item: 'silver_lump', count: 2 }, { item: 'gold_lump', count: 2 }], station: 'smelter', skill: 'smelting', qlFromInputs: true, label: 'Mix electrum', verb: 'mixing an alloy', baseTime: 10, stamina: 0.03, difficulty: 18, done: 'You mix a crucible of electrum.', fail: 'The mix will not take and you pour off a ruined crucible.', consumeOnFail: true },
];

RECIPES.push(...MOULD_RECIPES, ...SMELTER_RECIPES);

/** The twenty pieces of furniture, each nailed together by a fine carpenter. */
const FURNITURE_RECIPES: Recipe[] = FURNITURE.map((f) => ({
  id: `make_${f.id}`,
  category: 'Furniture' as RecipeCategory,
  result: f.id,
  inputs: f.bill.map(([item, count]) => ({ item, count })),
  tool: 'mallet',
  skill: 'fine_carpentry',
  label: `Build ${f.name.toLowerCase()}`,
  verb: `building a ${f.name.toLowerCase()}`,
  baseTime: f.time,
  stamina: 0.05,
  difficulty: f.difficulty,
  done: `${f.done} Set it down on any spot of a tile.`,
  fail: `The joints will not pull up square and you pull the ${f.name.toLowerCase()} apart again.`,
}));

RECIPES.push(...FURNITURE_RECIPES);

export const RECIPE_CATEGORIES: RecipeCategory[] = ['Woodwork', 'Furniture', 'Stonework', 'Clay & thatch', 'Cloth', 'Cooking', 'Smelting'];
export const stationName = (s: Station): string => STATION_NAME[s];

export interface RecipeStatus {
  /** Tool carried, or no tool needed. */
  tool: boolean;
  /** Standing at the station it needs, or none needed. */
  station: boolean;
  inputs: Array<{ item: string; need: number; have: number }>;
  /** Everything is at hand for at least one craft. */
  ready: boolean;
  /** How many times it can be made with what is carried. */
  max: number;
}

export function recipeStatus(r: Recipe, g: Game): RecipeStatus {
  const tool = !r.tool || g.inventory.has(r.tool);
  const station = !r.station || g.atStation(r.station);
  const inputs = r.inputs.map((i) => ({ item: i.item, need: i.count ?? 1, have: g.inventory.count(i.item) }));
  const max = tool && station ? Math.min(...inputs.map((i) => Math.floor(i.have / i.need))) : 0;
  return { tool, station, inputs, ready: max >= 1, max };
}

const lower = (id: string): string => itemDef(id).name.toLowerCase();
const plural = (id: string, n: number): string => (n === 1 ? lower(id) : `${lower(id)}${itemDef(id).stackable && !lower(id).endsWith('s') ? 's' : ''}`);

/** Why a recipe cannot be made right now, or null. */
export function recipeReason(r: Recipe, g: Game): string | null {
  if (r.tool && !g.inventory.has(r.tool)) return `You need a ${lower(r.tool)}.`;
  if (r.station && !g.atStation(r.station)) return `You need to stand at a ${STATION_NAME[r.station]}.`;
  for (const i of r.inputs) {
    const need = i.count ?? 1;
    if (g.inventory.count(i.item) < need) return `${itemDef(r.result).name} takes ${need} ${plural(i.item, need)}${r.inputs.length > 1 ? ` (${r.inputs.map((x) => `${x.count ?? 1} ${plural(x.item, x.count ?? 1)}`).join(', ')})` : ''}.`;
  }
  return null;
}

/** Human readable list of what a recipe needs: "clay bowl · 1 cooked meat · 1 potato". */
export function recipeNeeds(r: Recipe): string {
  const parts = r.inputs.map((i) => `${i.count ?? 1} ${plural(i.item, i.count ?? 1)}`);
  return (r.tool ? [lower(r.tool), ...parts] : parts).join(' · ');
}

/** The quality of what a recipe is about to consume, weighted by how much of each it takes. */
function inputQl(g: Game, r: Recipe): number {
  let total = 0;
  let weight = 0;
  for (const i of r.inputs) {
    const need = i.count ?? 1;
    const stack = g.inventory.find(i.item);
    if (!stack) continue;
    total += stack.ql * need;
    weight += need;
  }
  return weight ? total / weight : 1;
}

/** Use up `n` units of an item, drawing from the clicked stack first, then any other (logs differ by wood). */
function consumeAcross(g: Game, id: string, n: number, preferUid?: number): boolean {
  if (g.inventory.count(id) < n) return false;
  const stacks = g.inventory.items.filter((it) => it.id === id).sort((a, b) => Number(b.uid === preferUid) - Number(a.uid === preferUid));
  let left = n;
  for (const st of stacks) {
    if (left <= 0) break;
    const take = Math.min(left, st.count);
    if (g.inventory.remove(st.uid, take)) left -= take;
  }
  return left === 0;
}

export function recipeAction(r: Recipe): ActionDef {
  const materials = r.inputs.map((i) => i.item);
  const toolQl = (g: Game): number => (r.tool ? g.toolQl(r.tool) : 0);
  /** Keep going while more crafts were asked for and can still be made. */
  const more = (t: Target, g: Game): boolean => {
    if (t.kind !== 'item' || (t.count ?? 1) <= 1) return false;
    t.count = (t.count ?? 1) - 1;
    return recipeReason(r, g) === null;
  };
  return {
    id: r.id,
    label: r.label,
    verb: r.verb,
    skill: r.skill,
    tool: r.tool,
    stamina: r.stamina,
    baseTime: r.baseTime,
    difficulty: r.difficulty,
    quantity: true,
    repeat: true,
    applies: (t, g) => t.kind === 'item' && materials.includes(g.inventory.get(t.uid)?.id ?? ''),
    check: (_t, g) => recipeReason(r, g),
    maxRepeat: (_t, g) => recipeStatus(r, g).max,
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      if (r.difficulty !== undefined && !g.skillCheck(r.skill, r.difficulty, toolQl(g), g.mindEase())) {
        if (r.consumeOnFail) for (const i of r.inputs) consumeAcross(g, i.item, i.count ?? 1, t.uid);
        g.logMsg(r.fail ?? `You fail to make ${lower(r.result)}.`, 'event');
        return more(t, g);
      }
      const fromInputs = r.qlFromInputs ? inputQl(g, r) : 0;
      for (const i of r.inputs) if (!consumeAcross(g, i.item, i.count ?? 1, t.uid)) return;
      const ql = r.qlFromInputs ? Math.max(1, Math.min(100, fromInputs * (0.78 + g.skills.get(r.skill) / 460))) : g.productQl(r.skill, toolQl(g));
      const item = g.inventory.add(r.result, { count: r.count ?? 1, ql });
      // Working a thing out with your hands is what sharpens the head.
      g.gainSkill('mind_logic', 0.25);
      g.logMsg(`${r.done} (QL ${item.ql.toFixed(1)})`, 'event');
      return more(t, g);
    },
  };
}

export const RECIPE_ACTIONS: ActionDef[] = RECIPES.map(recipeAction);
export const RECIPE_BY_ID = new Map(RECIPES.map((r) => [r.id, r]));
