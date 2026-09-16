import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { itemDef, rollRarity, RARITY_WORD } from './items';
import { FURNITURE } from './furniture';
import { MOULDS } from './metal';
import { FISH } from './fishing';
import { DYES } from './dyes';
import { WOUND_KINDS } from './wounds';
import { TRAPS } from './traps';
import { BREWS } from './brewing';
import { isMaterialKind, matOf, type MaterialKind } from './materials';

/**
 * Everything the player can make from what they carry. A recipe is a tool
 * (kept) plus materials (used up) that become a result. Each recipe is also
 * an item action, so it shows on the material's menu as well as in the
 * crafting window.
 */
export type RecipeCategory = 'Woodwork' | 'Furniture' | 'Stonework' | 'Clay & thatch' | 'Cloth' | 'Alchemy' | 'Writing' | 'Cooking' | 'Smelting';
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
  /**
   * The product is made of something, and takes it from the first input that
   * carries a material of this kind: a plank crate is of the wood its planks
   * were, a fitted sword of the metal of its blade. One craft draws on one
   * material; you cannot nail an oak plank to a pine one and call it a chest.
   */
  material?: MaterialKind;
  /** The one wood it may be made from, for the things that are that fussy. */
  wood?: string;
  /**
   * A fixed qualifier stamped on the product instead of the material it was
   * made from: the dyestuff on a pot of dye, which is what tells eight
   * colours apart when they are all one item.
   */
  extra?: string;
  /** Things handed back when it succeeds, such as the bucket the lye was in. */
  returns?: Array<[string, number]>;
  /**
   * What you are left holding when it fails, if that is not simply what a
   * success hands back. A spoiled batch wastes what went into it; it does not
   * eat the bucket it was mixed in.
   */
  salvage?: Array<[string, number]>;
  done: string;
  fail?: string;
}

export const RECIPES: Recipe[] = [
  // Woodwork
  { id: 'make_planks', category: 'Woodwork', result: 'plank', count: 3, inputs: [{ item: 'log' }], tool: 'saw', skill: 'carpentry', material: 'wood', label: 'Saw into planks', verb: 'sawing', baseTime: 5, stamina: 0.04, done: 'You saw the log into three planks.' },
  { id: 'make_timbers', category: 'Woodwork', result: 'timber', count: 2, inputs: [{ item: 'log' }], tool: 'saw', skill: 'carpentry', material: 'wood', label: 'Saw into timbers', verb: 'sawing', baseTime: 5, stamina: 0.04, done: 'You saw the log into two timbers.' },
  { id: 'make_shafts', category: 'Woodwork', result: 'shaft', count: 4, inputs: [{ item: 'log' }], tool: 'carving_knife', skill: 'carpentry', material: 'wood', label: 'Carve shafts', verb: 'carving shafts', baseTime: 5, stamina: 0.03, done: 'You carve the log into four shafts.' },
  { id: 'make_mallet', category: 'Woodwork', result: 'mallet', inputs: [{ item: 'log' }], tool: 'carving_knife', skill: 'carpentry', material: 'wood', label: 'Carve a mallet', verb: 'carving a mallet', baseTime: 8, stamina: 0.04, difficulty: 8, done: 'You carve a mallet from the log.', fail: 'The head splits as you shape it. You fail to carve a mallet.' },
  { id: 'make_deed_stake', category: 'Woodwork', result: 'deed_stake', inputs: [{ item: 'shaft' }], tool: 'carving_knife', skill: 'carpentry', material: 'wood', label: 'Carve a deed stake', verb: 'carving a deed stake', baseTime: 10, stamina: 0.05, difficulty: 10, done: 'You whittle the shaft to a point and notch it for a claim.', fail: 'The shaft splits along the grain. You fail to carve a deed stake.' },
  { id: 'make_log_crate', category: 'Woodwork', result: 'crate_log', inputs: [{ item: 'log', count: 3 }], tool: 'mallet', skill: 'carpentry', material: 'wood', label: 'Build log crate', verb: 'building a crate', baseTime: 6, stamina: 0.05, done: 'You notch the logs and lash a crate together, not a nail in it. Place it on any spot of a tile.' },
  { id: 'make_plank_crate', category: 'Woodwork', result: 'crate_plank', inputs: [{ item: 'plank', count: 6 }, { item: 'nail', count: 12 }], tool: 'mallet', skill: 'carpentry', material: 'wood', label: 'Build plank crate', verb: 'building a crate', baseTime: 6, stamina: 0.05, done: 'You nail together a plank crate. Place it on any spot of a tile.' },
  // Stonework
  { id: 'make_stone_brick', category: 'Stonework', result: 'stone_brick', inputs: [{ item: 'rock_shards' }], tool: 'chisel', skill: 'stonecutting', label: 'Chisel stone brick', verb: 'chiselling', baseTime: 6, stamina: 0.04, difficulty: 12, done: 'You chisel a stone brick.', fail: 'The shard splits the wrong way. You fail to make a brick.' },
  { id: 'make_slate_brick', category: 'Stonework', result: 'slate_brick', inputs: [{ item: 'slate_shards' }], tool: 'chisel', skill: 'stonecutting', label: 'Chisel slate brick', verb: 'chiselling', baseTime: 6, stamina: 0.04, difficulty: 12, done: 'You chisel a slate brick.', fail: 'The slate flakes apart. You fail to make a brick.' },
  { id: 'make_marble_brick', category: 'Stonework', result: 'marble_brick', inputs: [{ item: 'marble_shards' }], tool: 'chisel', skill: 'stonecutting', label: 'Chisel marble brick', verb: 'chiselling', baseTime: 6, stamina: 0.04, difficulty: 12, done: 'You chisel a marble brick.', fail: 'The marble cracks. You fail to make a brick.' },
  { id: 'make_sandstone_brick', category: 'Stonework', result: 'sandstone_brick', inputs: [{ item: 'sandstone_shards' }], tool: 'chisel', skill: 'stonecutting', label: 'Chisel sandstone brick', verb: 'chiselling', baseTime: 6, stamina: 0.04, difficulty: 12, done: 'You chisel a sandstone brick.', fail: 'The sandstone crumbles. You fail to make a brick.' },
  { id: 'make_whetstone', category: 'Stonework', result: 'whetstone', inputs: [{ item: 'rock_shards', count: 2 }], tool: 'chisel', skill: 'stonecutting', label: 'Shape a whetstone', verb: 'shaping a whetstone', baseTime: 8, stamina: 0.04, difficulty: 10, done: 'You shape and true a whetstone.', fail: 'The block breaks along a flaw. You fail to shape a whetstone.' },
  // The two brick-built workshops, carried flat-packed like any other piece.
  { id: 'make_smelter', category: 'Stonework', result: 'smelter', inputs: [{ item: 'stone_brick', count: 12 }, { item: 'mortar', count: 6 }], tool: 'trowel', skill: 'masonry', label: 'Build a smelter', verb: 'building a smelter', baseTime: 20, stamina: 0.07, difficulty: 22, done: 'You lay up a stone smelter, hearth, flue and all. Set it down on your deed.', fail: 'The courses will not run true and you knock the smelter down again.', consumeOnFail: true },
  { id: 'make_kiln', category: 'Stonework', result: 'kiln', inputs: [{ item: 'stone_brick', count: 6 }, { item: 'mortar', count: 2 }], tool: 'trowel', skill: 'masonry', label: 'Build a kiln', verb: 'building a kiln', baseTime: 14, stamina: 0.05, difficulty: 16, done: 'You build a kiln, domed over and vented at the top. Set it down anywhere dry and flat.', fail: 'The dome slumps before the mortar takes. You pull it down again.', consumeOnFail: true },
  { id: 'make_quern', category: 'Stonework', result: 'quern', inputs: [{ item: 'rock_shards', count: 3 }], tool: 'chisel', skill: 'stonecutting', label: 'Dress a quern', verb: 'dressing a quern', baseTime: 16, stamina: 0.06, difficulty: 24, done: 'You dress two stones flat, cut the grooves and pierce the top one. A quern, and it will grind.', fail: 'The upper stone splits across the eye. You fail to dress a quern.', consumeOnFail: true },
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
  { id: 'fit_rake_head', category: 'Woodwork', result: 'rake', inputs: [{ item: 'rake_head' }, { item: 'shaft' }, { item: 'nail', count: 2 }], skill: 'carpentry', material: 'metal', label: 'Fit a shaft', verb: 'fitting a shaft', baseTime: 5, stamina: 0.02, done: 'You fit a shaft and the rake is finished.' },
  { id: 'fit_shovel_head', category: 'Woodwork', result: 'shovel', inputs: [{ item: 'shovel_head' }, { item: 'shaft' }, { item: 'nail', count: 2 }], skill: 'carpentry', material: 'metal', label: 'Fit a shaft', verb: 'fitting a shaft', baseTime: 5, stamina: 0.02, done: 'You fit a shaft and the shovel is finished.' },
  { id: 'fit_hatchet_head', category: 'Woodwork', result: 'hatchet', inputs: [{ item: 'hatchet_head' }, { item: 'shaft' }, { item: 'nail', count: 2 }], skill: 'carpentry', material: 'metal', label: 'Fit a shaft', verb: 'fitting a shaft', baseTime: 5, stamina: 0.02, done: 'You fit a shaft and the hatchet is finished.' },
  { id: 'fit_pickaxe_head', category: 'Woodwork', result: 'pickaxe', inputs: [{ item: 'pickaxe_head' }, { item: 'shaft' }, { item: 'nail', count: 2 }], skill: 'carpentry', material: 'metal', label: 'Fit a shaft', verb: 'fitting a shaft', baseTime: 5, stamina: 0.02, done: 'You fit a shaft and the pickaxe is finished.' },
  { id: 'fit_knife_blade', category: 'Woodwork', result: 'butchering_knife', inputs: [{ item: 'knife_blade' }, { item: 'shaft' }, { item: 'nail', count: 2 }], skill: 'carpentry', material: 'metal', label: 'Fit a shaft', verb: 'fitting a shaft', baseTime: 5, stamina: 0.02, done: 'You fit a shaft and the butchering knife is finished.' },
  { id: 'fit_sword_blade', category: 'Woodwork', result: 'sword', inputs: [{ item: 'sword_blade' }, { item: 'shaft' }, { item: 'nail', count: 2 }], skill: 'carpentry', material: 'metal', label: 'Fit a shaft', verb: 'fitting a shaft', baseTime: 5, stamina: 0.02, done: 'You fit a shaft and the sword is finished.' },
  // Fibre is spun on a spindle and woven on a loom; nothing shortcuts either.
  { id: 'make_toolbelt', category: 'Cloth', result: 'toolbelt', inputs: [{ item: 'leather', count: 4 }, { item: 'ribbon', count: 2 }], tool: 'awl', skill: 'leatherworking', label: 'Stitch a toolbelt', verb: 'stitching a toolbelt', baseTime: 16, stamina: 0.04, difficulty: 22, done: 'You cut the loops, set the pouches and buckle it. One loop for every ten points of the work.', fail: 'The loops tear out of the belt one after another.', consumeOnFail: true },
  { id: 'make_rug', category: 'Cloth', result: 'rug', inputs: [{ item: 'cloth', count: 4 }, { item: 'yarn', count: 6 }], tool: 'needle', station: 'loom', skill: 'tailoring', label: 'Weave a rug', verb: 'weaving a rug', baseTime: 20, stamina: 0.04, difficulty: 20, done: 'You weave a rug wide enough to sit on cross-legged and knot the fringe.', fail: 'The weave draws in at the middle and the whole thing sits crooked.', consumeOnFail: true },
  { id: 'make_composite_bow', category: 'Cloth', result: 'composite_bow', inputs: [{ item: 'tusk', count: 2 }, { item: 'sinew', count: 4 }, { item: 'shaft', count: 2 }, { item: 'rope', count: 1 }], tool: 'carving_knife', skill: 'bowyery', label: 'Lay up a composite bow', verb: 'laying up a composite bow', baseTime: 30, stamina: 0.06, difficulty: 46, done: 'You groove the tusk into the belly, glue the sinew along the back and bind the whole of it. It comes off the form with a pull you can barely hold.', fail: 'The sinew lifts off the back as it dries and the whole lay-up is waste.', consumeOnFail: true },
  { id: 'make_scale_helm', category: 'Cloth', result: 'scale_helm', inputs: [{ item: 'dragon_scale', count: 3 }, { item: 'leather', count: 2 }, { item: 'ribbon', count: 1 }], tool: 'awl', skill: 'leatherworking', label: 'Rivet a scale helm', verb: 'riveting scale', baseTime: 22, stamina: 0.05, difficulty: 50, done: 'You drill the scale, rivet it to the cap and turn the edges.', fail: 'A scale splits under the drill and takes the piece with it.', consumeOnFail: true },
  { id: 'make_scale_cuirass', category: 'Cloth', result: 'scale_cuirass', inputs: [{ item: 'dragon_scale', count: 8 }, { item: 'leather', count: 5 }, { item: 'ribbon', count: 2 }], tool: 'awl', skill: 'leatherworking', label: 'Rivet a scale cuirass', verb: 'riveting scale', baseTime: 40, stamina: 0.08, difficulty: 58, done: 'You lay the scale in courses over the body and rivet every one of them home.', fail: 'The courses will not sit true and the whole front has to come off again.', consumeOnFail: true },
  { id: 'make_scale_sleeves', category: 'Cloth', result: 'scale_sleeves', inputs: [{ item: 'dragon_scale', count: 5 }, { item: 'leather', count: 3 }, { item: 'ribbon', count: 1 }], tool: 'awl', skill: 'leatherworking', label: 'Rivet scale sleeves', verb: 'riveting scale', baseTime: 30, stamina: 0.06, difficulty: 54, done: 'You lay scale down the outside of the arm and leave the inside soft.', fail: 'The scale binds at the elbow and the arm will not bend.', consumeOnFail: true },
  { id: 'make_scale_leggings', category: 'Cloth', result: 'scale_leggings', inputs: [{ item: 'dragon_scale', count: 6 }, { item: 'leather', count: 4 }, { item: 'ribbon', count: 2 }], tool: 'awl', skill: 'leatherworking', label: 'Rivet scale leggings', verb: 'riveting scale', baseTime: 34, stamina: 0.07, difficulty: 56, done: 'You cover the thigh and shin and leave the back of the knee open.', fail: 'The knee fouls and the whole leg is scrap.', consumeOnFail: true },
  { id: 'make_scale_boots', category: 'Cloth', result: 'scale_boots', inputs: [{ item: 'dragon_scale', count: 4 }, { item: 'leather', count: 3 }, { item: 'ribbon', count: 1 }], tool: 'awl', skill: 'leatherworking', label: 'Rivet scale boots', verb: 'riveting scale', baseTime: 26, stamina: 0.05, difficulty: 52, done: 'You scale the instep and leave the sole plain leather.', fail: 'The instep will not close over the scale.', consumeOnFail: true },
  { id: 'make_net', category: 'Cloth', result: 'fishing_net', inputs: [{ item: 'yarn', count: 12 }, { item: 'rope', count: 2 }], tool: 'needle', skill: 'ropemaking', label: 'Knot a net', verb: 'knotting a net', baseTime: 22, stamina: 0.05, difficulty: 24, done: 'You knot the mesh row by row and seize it to a rope headline.', fail: 'The mesh comes out of true and the whole panel has to come apart again.', consumeOnFail: true },
  { id: 'make_creel', category: 'Cloth', result: 'creel', inputs: [{ item: 'reed', count: 14 }, { item: 'rope', count: 1 }], skill: 'ropemaking', label: 'Weave a creel', verb: 'weaving a creel', baseTime: 16, stamina: 0.04, difficulty: 16, done: 'You weave the basket and turn the throat inward so what goes in stays in.', fail: 'The throat collapses and anything could swim out of it.', consumeOnFail: true },
  { id: 'make_rope_tool', category: 'Woodwork', result: 'rope_tool', inputs: [{ item: 'plank' }, { item: 'shaft' }], tool: 'carving_knife', skill: 'carpentry', material: 'wood', label: 'Carve a rope tool', verb: 'carving a rope tool', baseTime: 7, stamina: 0.02, difficulty: 6, done: 'You groove the block and fit the handle. It is ready to lay rope on.' },
  { id: 'make_rope', category: 'Cloth', result: 'rope', inputs: [{ item: 'wemp', count: 4 }], tool: 'rope_tool', skill: 'ropemaking', label: 'Lay up a rope', verb: 'laying up a rope', baseTime: 9, stamina: 0.03, difficulty: 10, done: 'You twist three strands against the lay and they hold each other fast.', fail: 'The lay runs out of the strands and the fibre unspools into a heap.', consumeOnFail: true },
  { id: 'make_thick_rope', category: 'Cloth', result: 'thick_rope', inputs: [{ item: 'rope', count: 3 }], tool: 'rope_tool', skill: 'ropemaking', label: 'Lay up a hawser', verb: 'laying up a hawser', baseTime: 16, stamina: 0.05, difficulty: 28, done: 'You lay three ropes up again into a hawser you could moor a hull with.', fail: 'The hawser takes an ugly turn in it and comes apart in your hands.', consumeOnFail: true },
  { id: 'spin_wool', category: 'Cloth', result: 'yarn', count: 2, inputs: [{ item: 'wool', count: 2 }], station: 'spindle', skill: 'tailoring', label: 'Spin into yarn', verb: 'spinning', baseTime: 6, stamina: 0.02, difficulty: 8, done: 'You spin the wool into two lengths of yarn.', fail: 'The thread breaks over and over and the wool is a tangle.', consumeOnFail: true },
  { id: 'spin_cotton', category: 'Cloth', result: 'yarn', count: 2, inputs: [{ item: 'cotton', count: 2 }], station: 'spindle', skill: 'tailoring', label: 'Spin into yarn', verb: 'spinning', baseTime: 6, stamina: 0.02, difficulty: 10, done: 'You spin the cotton into two lengths of yarn.', fail: 'The thread breaks over and over and the cotton is a tangle.', consumeOnFail: true },
  { id: 'spin_wemp', category: 'Cloth', result: 'yarn', count: 2, inputs: [{ item: 'wemp', count: 2 }], station: 'spindle', skill: 'tailoring', label: 'Spin into yarn', verb: 'spinning', baseTime: 6, stamina: 0.02, difficulty: 12, done: 'You spin the wemp into two lengths of coarse yarn.', fail: 'The fibre will not hold together and the lot is wasted.', consumeOnFail: true },
  { id: 'weave_cloth', category: 'Cloth', result: 'cloth', inputs: [{ item: 'yarn', count: 3 }], station: 'loom', skill: 'tailoring', label: 'Weave cloth', verb: 'weaving', baseTime: 9, stamina: 0.03, difficulty: 12, done: 'You weave a length of cloth on the loom.', fail: 'The warp parts halfway down and the piece is ruined.', consumeOnFail: true },
  { id: 'make_brush', category: 'Woodwork', result: 'brush', inputs: [{ item: 'plank' }, { item: 'wool', count: 2 }], tool: 'carving_knife', skill: 'animal_husbandry', material: 'wood', label: 'Set a brush', verb: 'setting a brush', baseTime: 8, stamina: 0.03, difficulty: 8, done: 'You drill the block through and draw the bristles tight into it.', fail: 'The bristles pull straight back out of the block.', consumeOnFail: true },
  { id: 'make_needle', category: 'Cloth', result: 'needle', count: 2, inputs: [{ item: 'bone' }], tool: 'carving_knife', skill: 'tailoring', label: 'Carve needles', verb: 'carving needles', baseTime: 6, stamina: 0.02, difficulty: 12, done: 'You carve two needles out of the bone.', fail: 'The bone splinters under the knife.', consumeOnFail: true },
  { id: 'make_sack', category: 'Cloth', result: 'sack', inputs: [{ item: 'cloth', count: 2 }], tool: 'needle', skill: 'tailoring', label: 'Stitch a sack', verb: 'stitching a sack', baseTime: 7, stamina: 0.02, difficulty: 10, done: 'You stitch up a cloth sack and hem the mouth of it.', fail: 'The seam runs out of true and the sack will hold nothing.', consumeOnFail: true },
  { id: 'make_satchel', category: 'Cloth', result: 'satchel', inputs: [{ item: 'leather', count: 3 }, { item: 'ribbon', count: 1 }], tool: 'awl', skill: 'leatherworking', label: 'Stitch a satchel', verb: 'stitching a satchel', baseTime: 12, stamina: 0.03, difficulty: 18, done: 'You cut the gusset, stitch the flap on and buckle it.', fail: 'The stitches tear out along the gusset and the leather is scrap.', consumeOnFail: true },
  { id: 'make_backpack', category: 'Cloth', result: 'backpack', inputs: [{ item: 'leather', count: 6 }, { item: 'ribbon', count: 2 }], tool: 'awl', skill: 'leatherworking', label: 'Stitch a backpack', verb: 'stitching a backpack', baseTime: 18, stamina: 0.05, difficulty: 26, done: 'You build the pack deep, stitch the straps to it and set the buckles.', fail: 'The straps pull clean out of the back and the whole thing is waste.', consumeOnFail: true },
  { id: 'make_bandage', category: 'Cloth', result: 'bandage', count: 3, inputs: [{ item: 'cloth' }], tool: 'carving_knife', skill: 'first_aid', label: 'Cut into bandages', verb: 'cutting bandages', baseTime: 6, stamina: 0.02, difficulty: 8, done: 'You cut and roll three bandages.', fail: 'You cut the strips ragged and they will not hold a dressing.', consumeOnFail: true },
  { id: 'make_awl', category: 'Cloth', result: 'awl', inputs: [{ item: 'bone' }], tool: 'carving_knife', skill: 'leatherworking', label: 'Carve an awl', verb: 'carving an awl', baseTime: 6, stamina: 0.02, difficulty: 12, done: 'You carve a bone awl and put a point on it.', fail: 'The bone splinters under the knife.', consumeOnFail: true },
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
  // Vehicle parts. A wheel is a carpenter's piece; the metal in it is banded on.
  { id: 'make_large_wheel', category: 'Woodwork', result: 'large_wheel', inputs: [{ item: 'plank', count: 4 }, { item: 'shaft', count: 6 }, { item: 'ribbon', count: 1 }, { item: 'nail', count: 12 }], tool: 'mallet', skill: 'carpentry', material: 'wood', label: 'Build a large wheel', verb: 'building a wheel', baseTime: 16, stamina: 0.05, difficulty: 28, done: 'You set the spokes into the hub, lay the felloes round them and shrink the tyre on hot.', fail: 'The wheel will not run true and you knock it apart again.', consumeOnFail: true },
  { id: 'make_saddle', category: 'Cloth', result: 'saddle', inputs: [{ item: 'leather', count: 6 }, { item: 'plank', count: 2 }, { item: 'ribbon', count: 1 }, { item: 'nail', count: 8 }], tool: 'awl', skill: 'leatherworking', label: 'Stitch a saddle', verb: 'stitching a saddle', baseTime: 18, stamina: 0.05, difficulty: 26, done: 'You build the tree, stretch the leather over it and hang the stirrups.', fail: 'The seat pulls out of line and the whole thing is scrap.', consumeOnFail: true },
  { id: 'make_bridle', category: 'Cloth', result: 'bridle', inputs: [{ item: 'leather', count: 3 }, { item: 'rope', count: 1 }, { item: 'ribbon', count: 1 }], tool: 'awl', skill: 'leatherworking', label: 'Stitch a bridle', verb: 'stitching a bridle', baseTime: 10, stamina: 0.03, difficulty: 18, done: 'You cut the headstall, set the bit and knot the reins to it.', fail: 'The cheekpieces come out uneven and the bit sits crooked.', consumeOnFail: true },
  { id: 'make_yoke', category: 'Cloth', result: 'yoke', inputs: [{ item: 'shaft', count: 1 }, { item: 'leather', count: 2 }, { item: 'nail', count: 4 }], tool: 'awl', skill: 'leatherworking', material: 'wood', label: 'Stitch a yoke', verb: 'stitching a yoke', baseTime: 12, stamina: 0.04, difficulty: 18, done: 'You shape the bar and stitch a harness to it. Something can be hitched to that.', fail: 'The harness tears along the stitch line.', consumeOnFail: true },
  { id: 'make_cheese', category: 'Cooking', result: 'cheese', count: 3, inputs: [{ item: 'milk_bucket' }], tool: 'clay_bowl', skill: 'cooking', returns: [['bucket', 1]], label: 'Press into cheese', verb: 'pressing cheese', baseTime: 14, stamina: 0.03, difficulty: 14, done: 'You curdle the milk, press it and turn out three cheeses.', fail: 'The milk will not take and you pour off a bucket of whey.', consumeOnFail: true },
  { id: 'make_lantern', category: 'Cloth', result: 'lantern', inputs: [{ item: 'ribbon', count: 4 }, { item: 'cloth', count: 2 }, { item: 'shaft' }], tool: 'hammer', skill: 'blacksmithing', label: 'Build a lantern', verb: 'building a lantern', baseTime: 18, stamina: 0.04, difficulty: 24, done: 'You bend the ribbons into a frame, stretch the oiled cloth over its sides and hang a handle off the top.', fail: 'The frame will not sit square and the whole thing has to come apart again.', consumeOnFail: true },
  { id: 'make_torch', category: 'Cloth', result: 'torch', inputs: [{ item: 'shaft' }, { item: 'cloth' }], skill: 'ropemaking', material: 'wood', label: 'Wind a torch', verb: 'winding a torch', baseTime: 5, stamina: 0.02, difficulty: 6, done: 'You wind the cloth round the head of the shaft and work the oil through it.', fail: 'The cloth unwinds off the head as fast as you can wrap it.', consumeOnFail: true },
  { id: 'make_candle', category: 'Cloth', result: 'candle', count: 2, inputs: [{ item: 'wax', count: 2 }, { item: 'yarn' }], skill: 'alchemy', label: 'Draw candles', verb: 'drawing candles', baseTime: 9, stamina: 0.02, difficulty: 10, done: 'You draw the wick through the wax until two candles hang off it.', fail: 'The wax sets in lumps and the wick is wasted.', consumeOnFail: true },
  { id: 'make_work_post', category: 'Woodwork', result: 'work_post', inputs: [{ item: 'plank', count: 2 }, { item: 'shaft', count: 2 }, { item: 'nail', count: 4 }, { item: 'ribbon', count: 1 }], tool: 'mallet', skill: 'carpentry', material: 'wood', label: 'Build a work post', verb: 'building a work post', baseTime: 9, stamina: 0.04, difficulty: 16, done: 'You nail a crossbar to the stake, point the foot of it and tack the ribbon on for a marker.', fail: 'The stake splits along the grain as you point it.' },
  { id: 'make_bucket', category: 'Woodwork', result: 'bucket', inputs: [{ item: 'plank', count: 3 }, { item: 'nail', count: 6 }], tool: 'mallet', skill: 'carpentry', material: 'wood', label: 'Build a bucket', verb: 'building a bucket', baseTime: 7, stamina: 0.03, difficulty: 12, done: 'You raise the staves and hoop a bucket.', fail: 'The staves will not pull together and the bucket leaks.' },
  // Weapons: a head from the anvil and a length of wood to put it on.
  { id: 'fit_short_sword_blade', category: 'Woodwork', result: 'short_sword', inputs: [{ item: 'short_sword_blade' }, { item: 'shaft' }, { item: 'nail', count: 2 }], skill: 'carpentry', material: 'metal', label: 'Fit a grip', verb: 'fitting a grip', baseTime: 6, stamina: 0.03, done: 'You bind a grip to the blade and the short sword is finished.' },
  { id: 'fit_long_sword_blade', category: 'Woodwork', result: 'long_sword', inputs: [{ item: 'long_sword_blade' }, { item: 'shaft', count: 2 }, { item: 'nail', count: 3 }], skill: 'carpentry', material: 'metal', label: 'Fit a grip', verb: 'fitting a grip', baseTime: 8, stamina: 0.04, done: 'You bind a two-handed grip to the blade and the long sword is finished.' },
  { id: 'fit_axe_head', category: 'Woodwork', result: 'battle_axe', inputs: [{ item: 'axe_head' }, { item: 'shaft', count: 2 }, { item: 'nail', count: 3 }], skill: 'carpentry', material: 'metal', label: 'Fit a haft', verb: 'fitting a haft', baseTime: 8, stamina: 0.04, done: 'You wedge the head onto a long haft and the battle axe is finished.' },
  { id: 'fit_maul_head', category: 'Woodwork', result: 'maul', inputs: [{ item: 'maul_head' }, { item: 'shaft', count: 2 }, { item: 'nail', count: 4 }], skill: 'carpentry', material: 'metal', label: 'Fit a haft', verb: 'fitting a haft', baseTime: 8, stamina: 0.05, done: 'You wedge the head onto a long haft and the maul is finished.' },
  { id: 'fit_spear_head', category: 'Woodwork', result: 'spear', inputs: [{ item: 'spear_head' }, { item: 'shaft', count: 2 }, { item: 'nail', count: 2 }], skill: 'carpentry', material: 'metal', label: 'Fit a shaft', verb: 'fitting a shaft', baseTime: 6, stamina: 0.03, done: 'You bind the head to a long shaft and the spear is finished.' },
  { id: 'make_hunting_knife', category: 'Woodwork', result: 'hunting_knife', inputs: [{ item: 'knife_blade' }, { item: 'shaft' }, { item: 'nail' }], skill: 'carpentry', material: 'metal', label: 'Fit a grip', verb: 'fitting a grip', baseTime: 5, stamina: 0.02, done: 'You fit a grip and the hunting knife is finished.' },
  { id: 'make_club', category: 'Woodwork', result: 'club', inputs: [{ item: 'log' }], tool: 'carving_knife', skill: 'carpentry', material: 'wood', label: 'Carve a club', verb: 'carving a club', baseTime: 7, stamina: 0.04, difficulty: 8, done: 'You carve a heavy club out of the log.', fail: 'The grain runs out of true and the club splits.' },
  { id: 'make_wooden_shield', category: 'Woodwork', result: 'wooden_shield', inputs: [{ item: 'plank', count: 4 }, { item: 'nail', count: 8 }], tool: 'mallet', skill: 'carpentry', material: 'wood', label: 'Build a wooden shield', verb: 'building a shield', baseTime: 11, stamina: 0.05, difficulty: 16, done: 'You nail up a wooden shield and fit its grip.', fail: 'The boards will not pull together and the shield is scrap.' },
  { id: 'make_metal_shield', category: 'Woodwork', result: 'metal_shield', inputs: [{ item: 'shield_boss' }, { item: 'plank', count: 3 }, { item: 'nail', count: 8 }], tool: 'mallet', skill: 'carpentry', material: 'metal', label: 'Build a metal shield', verb: 'building a shield', baseTime: 13, stamina: 0.06, difficulty: 20, done: 'You face the boards with the boss and the metal shield is finished.', fail: 'The rivets pull through the boards and the shield is scrap.' },
  // Bows and arrows.
  { id: 'make_short_bow', category: 'Woodwork', result: 'short_bow', inputs: [{ item: 'shaft', count: 2 }, { item: 'bow_string' }], tool: 'carving_knife', skill: 'bowyery', material: 'wood', wood: 'Willow', label: 'Tiller a short bow', verb: 'tillering a bow', baseTime: 12, stamina: 0.04, difficulty: 16, done: 'You tiller a short bow and string it.', fail: 'The limbs come out uneven and the stave is firewood.', consumeOnFail: true },
  { id: 'make_medium_bow', category: 'Woodwork', result: 'medium_bow', inputs: [{ item: 'shaft', count: 3 }, { item: 'bow_string' }], tool: 'carving_knife', skill: 'bowyery', material: 'wood', wood: 'Birch', label: 'Tiller a medium bow', verb: 'tillering a bow', baseTime: 15, stamina: 0.05, difficulty: 22, done: 'You tiller a medium bow and string it.', fail: 'The limbs come out uneven and the stave is firewood.', consumeOnFail: true },
  { id: 'make_long_bow', category: 'Woodwork', result: 'long_bow', inputs: [{ item: 'shaft', count: 4 }, { item: 'bow_string' }], tool: 'carving_knife', skill: 'bowyery', material: 'wood', wood: 'Oak', label: 'Tiller a long bow', verb: 'tillering a bow', baseTime: 18, stamina: 0.06, difficulty: 30, done: 'You tiller a long bow and string it. It takes an age to draw and ends most things at the end of it.', fail: 'The limbs come out uneven and the stave is firewood.', consumeOnFail: true },
  { id: 'make_arrows', category: 'Woodwork', result: 'arrow', count: 3, inputs: [{ item: 'shaft' }, { item: 'arrow_head', count: 3 }, { item: 'feather', count: 3 }], tool: 'carving_knife', skill: 'fletching', material: 'metal', label: 'Fletch arrows', verb: 'fletching', baseTime: 8, stamina: 0.03, difficulty: 12, done: 'You split the shaft, set the heads and fletch three arrows.', fail: 'The fletching will not sit straight and the arrows are spoiled.', consumeOnFail: true },
  // Alchemy: ashes leached in water, and what lye is for.
  { id: 'make_lye', category: 'Alchemy', result: 'lye_bucket', inputs: [{ item: 'water_bucket' }, { item: 'ash', count: 2 }], skill: 'alchemy', label: 'Leach into lye', verb: 'making lye', baseTime: 12, stamina: 0.03, difficulty: 14, done: 'You stir the ashes into the water and leave it to leach. It comes off sharp and slippery: lye.', fail: 'The ashes settle out again and you are left with dirty water.', consumeOnFail: true, salvage: [['bucket', 1]] },
  { id: 'tan_hide', category: 'Alchemy', result: 'leather', inputs: [{ item: 'hide' }, { item: 'lye_bucket' }], tool: 'carving_knife', skill: 'leatherworking', returns: [['bucket', 1]], label: 'Tan in lye', verb: 'tanning a hide', baseTime: 14, stamina: 0.05, difficulty: 16, done: 'The lye takes the hair off the hide and you work it soft. It is leather now, and the bucket is empty.', fail: 'The hide is left too long in the lye and comes out brittle and useless.', consumeOnFail: true },
  // Writing: reed beds into paper, and what is written on it.
  { id: 'make_papyrus', category: 'Writing', result: 'papyrus', count: 3, inputs: [{ item: 'reed', count: 4 }, { item: 'water_bucket' }], skill: 'papyrusmaking', returns: [['bucket', 1]], label: 'Press into papyrus', verb: 'pressing papyrus', baseTime: 13, stamina: 0.04, difficulty: 16, done: 'You split the reeds, lay them crosswise and press them until they take to each other. Three sheets.', fail: 'The sheet dries in ridges and tears as you lift it.', consumeOnFail: true },
  { id: 'make_ink', category: 'Writing', result: 'ink', count: 2, inputs: [{ item: 'gland' }, { item: 'ash', count: 2 }, { item: 'water_bucket' }], skill: 'alchemy', returns: [['bucket', 1]], label: 'Grind into ink', verb: 'grinding ink', baseTime: 11, stamina: 0.03, difficulty: 20, done: 'You grind soot and gland into the water until it flows black and stays black.', fail: 'It separates into grey water and grit. No ink today.', consumeOnFail: true },
  { id: 'make_book', category: 'Writing', result: 'book', inputs: [{ item: 'papyrus', count: 6 }, { item: 'leather', count: 2 }, { item: 'ink' }], tool: 'needle', skill: 'papyrusmaking', label: 'Write and bind a book', verb: 'binding a book', baseTime: 26, stamina: 0.07, difficulty: 28, done: 'You fill the sheets, sew the gatherings and bind them between leather boards.', fail: 'The ink runs on a sheet and the whole gathering is spoiled.', consumeOnFail: true },
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
  { id: 'make_flour', category: 'Cooking', result: 'flour', inputs: [{ item: 'wheat', count: 2 }], tool: 'quern', skill: 'milling', label: 'Grind into flour', verb: 'grinding flour', baseTime: 9, stamina: 0.05, difficulty: 10, done: 'You turn the quern until the wheat runs out as flour.', fail: 'You grind it too coarse and the grit spoils the lot.', consumeOnFail: true },
  { id: 'make_cornmeal', category: 'Cooking', result: 'cornmeal', inputs: [{ item: 'corn', count: 2 }], tool: 'quern', skill: 'milling', label: 'Grind into cornmeal', verb: 'grinding cornmeal', baseTime: 9, stamina: 0.05, difficulty: 12, done: 'You grind the corn down to a coarse yellow meal.', fail: 'The stones jam and what comes out is half husk.', consumeOnFail: true },
  { id: 'make_dough', category: 'Cooking', result: 'dough', count: 2, inputs: [{ item: 'flour', count: 2 }, { item: 'water_bucket' }], skill: 'cooking', returns: [['bucket', 1]], label: 'Work into dough', verb: 'working dough', baseTime: 8, stamina: 0.04, difficulty: 6, done: 'You work flour and water into two rounds of dough.', fail: 'It comes out sticky and slack and will not hold together.', consumeOnFail: true },
  { id: 'bake_bread', category: 'Cooking', result: 'bread', inputs: [{ item: 'dough' }], station: 'campfire', skill: 'cooking', label: 'Bake on the stone', verb: 'baking bread', baseTime: 12, stamina: 0.03, difficulty: 10, done: 'You bake the loaf on a hot stone until it sounds hollow.', fail: 'The loaf burns black on one side and raw on the other.', consumeOnFail: true },
  { id: 'make_porridge', category: 'Cooking', result: 'porridge', count: 2, inputs: [{ item: 'cornmeal' }, { item: 'water_bucket' }], tool: 'clay_bowl', station: 'campfire', skill: 'cooking', returns: [['bucket', 1]], label: 'Boil into porridge', verb: 'boiling porridge', baseTime: 10, stamina: 0.03, difficulty: 8, done: 'You boil the meal down into two bowls of porridge.', fail: 'It catches on the bottom of the bowl and turns bitter.', consumeOnFail: true },
  { id: 'make_fishing_rod', category: 'Woodwork', result: 'fishing_rod', inputs: [{ item: 'shaft', count: 2 }, { item: 'bow_string' }, { item: 'ribbon' }], tool: 'carving_knife', skill: 'carpentry', material: 'wood', label: 'Splice a fishing rod', verb: 'splicing a rod', baseTime: 10, stamina: 0.03, difficulty: 14, done: 'You splice the shafts, whip the line on and bend the ribbon into a hook.', fail: 'The splice will not hold and the whole thing comes apart in your hands.' },
  { id: 'make_apple_pie', category: 'Cooking', result: 'apple_pie', count: 2, inputs: [{ item: 'dough' }, { item: 'apple', count: 4 }], tool: 'clay_bowl', station: 'campfire', skill: 'cooking', label: 'Bake an apple pie', verb: 'baking a pie', baseTime: 18, stamina: 0.03, difficulty: 20, done: 'You stew the apples down, lay the pastry over and bake two pies.', fail: 'The bottom goes to pieces and the whole thing runs out into the fire.', consumeOnFail: true },
  { id: 'make_cherry_preserves', category: 'Cooking', result: 'preserves', count: 2, inputs: [{ item: 'cherry', count: 12 }], tool: 'clay_bowl', station: 'campfire', skill: 'cooking', label: 'Preserve cherries', verb: 'preserving cherries', baseTime: 14, stamina: 0.03, difficulty: 14, done: 'You boil the cherries down with their own sugar and jar two lots.', fail: 'It catches on the bottom and the whole batch tastes of burning.', consumeOnFail: true },
  { id: 'press_olives', category: 'Cooking', result: 'olive_oil', count: 2, inputs: [{ item: 'olive', count: 10 }], tool: 'quern', skill: 'milling', label: 'Press into oil', verb: 'pressing olives', baseTime: 16, stamina: 0.05, difficulty: 18, done: 'You crush the olives under the stone and draw off two measures of oil.', fail: 'You crush them to a paste that will not part with its oil.', consumeOnFail: true },
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
  label: `Fire ${/^[aeiou]/i.test(m.name) ? 'an' : 'a'} ${m.name.toLowerCase()}`,
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
  { id: 'make_steel', category: 'Smelting', result: 'steel_lump', count: 3, inputs: [{ item: 'iron_lump', count: 3 }, { item: 'coal', count: 1 }], station: 'smelter', skill: 'smelting', qlFromInputs: true, label: 'Make steel', verb: 'making steel', baseTime: 14, stamina: 0.04, difficulty: 20, done: 'You draw off a crucible of steel.', fail: 'The heat is wrong and the crucible comes off grey and crumbling.', consumeOnFail: true },
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
  tool: f.tool ?? 'mallet',
  skill: f.skill ?? 'fine_carpentry',
  // A carpenter's piece is of the wood it is built from; a mason's is brick.
  material: f.skill === 'masonry' ? undefined : ('wood' as const),
  label: `Build ${f.name.toLowerCase()}`,
  verb: `building a ${f.name.toLowerCase()}`,
  baseTime: f.time,
  stamina: 0.05,
  difficulty: f.difficulty,
  done: `${f.done} Set it down on any spot of a tile.`,
  fail: f.skill === 'masonry' ? `The courses will not run true and you knock the ${f.name.toLowerCase()} down again.` : `The joints will not pull up square and you pull the ${f.name.toLowerCase()} apart again.`,
}));

RECIPES.push(...FURNITURE_RECIPES);

/**
 * Every fish goes over the fire the same way; how much comes off it is the
 * only difference, and a sturgeon is ten times a perch.
 */
const FISH_PORTIONS: Record<string, number> = { minnow: 1, perch: 1, trout: 2, pike: 4, sturgeon: 10 };
const FISH_RECIPES: Recipe[] = FISH.map((f) => ({
  id: `cook_${f.id}`,
  category: 'Cooking' as RecipeCategory,
  result: 'cooked_fish',
  count: FISH_PORTIONS[f.id] ?? 1,
  inputs: [{ item: f.id }],
  station: 'campfire' as Station,
  skill: 'cooking',
  label: `Cook the ${f.name.toLowerCase()}`,
  verb: 'cooking fish',
  baseTime: 5 + (FISH_PORTIONS[f.id] ?? 1),
  stamina: 0.02,
  done: `You cook the ${f.name.toLowerCase()} through over the fire.`,
}));

RECIPES.push(...FISH_RECIPES);

/**
 * Every dye is boiled the same way: a quantity of something that grows, a
 * bucket of lye to bite it into the fibre, and a long simmer. The dyestuff
 * is written on the pot, so one item id carries all eight colours.
 */
const DYE_RECIPES: Recipe[] = DYES.map((d) => ({
  id: `make_${d.id}`,
  category: 'Alchemy' as RecipeCategory,
  result: 'dye',
  count: 2,
  inputs: [{ item: d.from, count: d.count }, { item: 'lye_bucket' }],
  skill: 'alchemy',
  returns: [['bucket', 1]] as Array<[string, number]>,
  salvage: [['bucket', 1]] as Array<[string, number]>,
  label: `Boil ${d.name.toLowerCase()}`,
  verb: `boiling ${d.name.toLowerCase()}`,
  baseTime: 12,
  stamina: 0.04,
  difficulty: d.difficulty,
  extra: d.name,
  done: `${d.note} Two pots of it, and the bucket is empty.`,
  fail: 'The colour breaks in the pot and goes out grey and streaky. The lot is wasted.',
  consumeOnFail: true,
}));

RECIPES.push(...DYE_RECIPES);

/**
 * A healing cover is the herb that suits a wound, bruised into cotton so it
 * will sit on one. The herb is written on the cover, which is what tells five
 * of them apart when they are all one item.
 */
const COVER_RECIPES: Recipe[] = Object.values(WOUND_KINDS).map((k) => ({
  id: `make_cover_${k.herb}`,
  category: 'Alchemy' as RecipeCategory,
  result: 'cover',
  count: 3,
  inputs: [{ item: k.herb, count: 2 }, { item: 'cotton', count: 1 }],
  skill: 'first_aid',
  label: `Work ${k.herb} into a cover`,
  verb: `working a ${k.herb} cover`,
  baseTime: 9,
  stamina: 0.02,
  difficulty: 12,
  extra: k.herb.charAt(0).toUpperCase() + k.herb.slice(1),
  done: `You bruise the ${k.herb} and work it into the cotton. Three covers. ${k.note}`,
  fail: `The ${k.herb} goes to a green paste that will sit on nothing.`,
  consumeOnFail: true,
}));

RECIPES.push(...COVER_RECIPES);

/**
 * The traps that are *built*, out of the same book the game reads them from.
 *
 * Not all of them are. A creel is reed and rope rather than plank and nail,
 * and it has its own recipe further up under ropemaking. It was generated here
 * as well, which gave two recipes one id — and since the map that looks them
 * up keeps whichever it saw last, the hand-written one was dead from the day
 * it was written, and weaving a reed basket trained carpentry and came out
 * made of wood.
 *
 * So anything that already has a recipe of its own keeps it, and the
 * duplicate check below makes sure this cannot happen again quietly.
 */
const TRAP_RECIPES: Recipe[] = Object.values(TRAPS)
  .filter((d) => !RECIPES.some((r) => r.id === `make_${d.id}`))
  .map((d) => ({
    id: `make_${d.id}`,
    category: 'Woodwork' as RecipeCategory,
    result: d.id,
    inputs: d.bill.map(([item, count]) => ({ item, count })),
    tool: d.id === 'deadfall' ? 'mallet' : undefined,
    skill: 'carpentry',
    material: 'wood' as MaterialKind,
    label: `Build a ${d.name.toLowerCase()}`,
    verb: `building a ${d.name.toLowerCase()}`,
    baseTime: d.time,
    stamina: 0.03,
    difficulty: d.difficulty,
    done: d.note,
    fail: `The trigger will not sit and the whole thing falls in on itself.`,
  }));

RECIPES.push(...TRAP_RECIPES);

export const RECIPE_CATEGORIES: RecipeCategory[] = ['Woodwork', 'Furniture', 'Stonework', 'Clay & thatch', 'Cloth', 'Alchemy', 'Writing', 'Cooking', 'Smelting'];
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
  /** What it would come out made of, for the recipes that are made of something. */
  material?: string;
}

export function recipeStatus(r: Recipe, g: Game): RecipeStatus {
  const tool = !r.tool || g.inventory.has(r.tool);
  const station = !r.station || g.atStation(r.station);
  const material = chooseMaterial(g, r);
  const inputs = r.inputs.map((i) => ({ item: i.item, need: i.count ?? 1, have: countFor(g, r, i.item, material) }));
  const max = tool && station ? Math.min(...inputs.map((i) => Math.floor(i.have / i.need))) : 0;
  return { tool, station, inputs, ready: max >= 1, max, material };
}

const lower = (id: string): string => itemDef(id).name.toLowerCase();
const plural = (id: string, n: number): string => (n === 1 ? lower(id) : `${lower(id)}${itemDef(id).stackable && !lower(id).endsWith('s') ? 's' : ''}`);

/**
 * How many of an item are on hand for a craft. Once a material has been
 * settled on, only stock of that material counts towards the inputs that
 * carry one — the nails in an oak chest are still whatever metal the nails
 * are, but every plank in it has to be oak.
 */
function countFor(g: Game, r: Recipe, id: string, mat: string | undefined): number {
  if (!mat) return g.inventory.count(id);
  let matching = 0;
  let kindly = 0;
  let all = 0;
  for (const it of g.inventory.items) {
    if (it.id !== id) continue;
    all += it.count;
    if (it.extra === mat) matching += it.count;
    else if (isMaterialKind(it.extra, r.material as MaterialKind)) kindly += it.count;
  }
  // An input that could be of this material has to be of the chosen one; one
  // that never is — the nails in an oak chest — counts whatever it is.
  return matching > 0 || kindly > 0 ? matching : all;
}

/** Whether this input has to be of the settled material rather than anything. */
const strictInput = (g: Game, r: Recipe, id: string): boolean =>
  !!r.material && g.inventory.items.some((it) => it.id === id && isMaterialKind(it.extra, r.material as MaterialKind));

/**
 * Which material this craft will be made of: whatever was clicked if it will
 * serve, and otherwise whichever the player has most of. A recipe that names
 * its wood takes that and nothing else.
 */
export function chooseMaterial(g: Game, r: Recipe, preferUid?: number): string | undefined {
  if (!r.material) return undefined;
  if (r.wood) return r.wood;
  for (const i of r.inputs) {
    const stacks = g.inventory.items.filter((it) => it.id === i.item && isMaterialKind(it.extra, r.material as MaterialKind));
    if (!stacks.length) continue;
    const clicked = stacks.find((it) => it.uid === preferUid);
    if (clicked) return clicked.extra;
    const need = i.count ?? 1;
    const held = new Map<string, number>();
    for (const st of stacks) held.set(st.extra as string, (held.get(st.extra as string) ?? 0) + st.count);
    let best: string | undefined;
    let bestN = -1;
    for (const [name, n] of held) if (n >= need && n > bestN) [bestN, best] = [n, name];
    if (best) return best;
    // Nothing named covers it. Plain stock from before the woods were told
    // apart still will, so let that through rather than blocking on it.
    const plain = g.inventory.items.filter((it) => it.id === i.item && !it.extra).reduce((n, it) => n + it.count, 0);
    return plain >= need ? undefined : [...held.keys()][0];
  }
  return undefined;
}

/** Why a recipe cannot be made right now, or null. */
export function recipeReason(r: Recipe, g: Game, preferUid?: number): string | null {
  if (r.tool && !g.inventory.has(r.tool)) return `You need a ${lower(r.tool)}.`;
  if (r.station && !g.atStation(r.station)) return `You need to stand at a ${STATION_NAME[r.station]}.`;
  const mat = chooseMaterial(g, r, preferUid);
  if (r.wood) {
    const i = r.inputs[0];
    const need = i.count ?? 1;
    if (countFor(g, r, i.item, r.wood) < need) return `A ${lower(r.result)} is tillered from ${r.wood.toLowerCase()} and nothing else: ${need} ${plural(i.item, need)} of it.`;
  }
  for (const i of r.inputs) {
    const need = i.count ?? 1;
    if (countFor(g, r, i.item, mat) < need) {
      const of = mat && strictInput(g, r, i.item) ? ` of ${mat.toLowerCase()}` : '';
      return `${itemDef(r.result).name} takes ${need} ${plural(i.item, need)}${of}${r.inputs.length > 1 ? ` (${r.inputs.map((x) => `${x.count ?? 1} ${plural(x.item, x.count ?? 1)}`).join(', ')})` : ''}.`;
    }
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

/**
 * Use up `n` units of an item, drawing from the clicked stack first and then
 * any other. Once a material has been settled on, only stock of that material
 * is drawn from for the inputs that have any of it — which is what stops a
 * chest being half oak and half pine.
 */
function consumeAcross(g: Game, id: string, n: number, preferUid?: number, mat?: string, strict = false): boolean {
  const pool = g.inventory.items.filter((it) => it.id === id && (!mat || it.extra === mat));
  const enough = pool.reduce((sum, it) => sum + it.count, 0) >= n;
  if (strict && !enough) return false;
  const stacks = (enough ? pool : g.inventory.items.filter((it) => it.id === id)).sort((a, b) => Number(b.uid === preferUid) - Number(a.uid === preferUid));
  if (stacks.reduce((sum, it) => sum + it.count, 0) < n) return false;
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
    return recipeReason(r, g, t.uid) === null;
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
    check: (t, g) => recipeReason(r, g, t.kind === 'item' ? t.uid : undefined),
    maxRepeat: (_t, g) => recipeStatus(r, g).max,
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      // An oven holds its heat evenly: what would burn over a fire comes out right.
      const oven = r.station === 'campfire' ? g.hotOvenNear() : undefined;
      const ease = g.mindEase() + (oven ? 10 : 0);
      // What it is being made of decides how stubborn the work is: oak and
      // the deep metals fight the hands that shape them.
      const mat = chooseMaterial(g, r, t.uid);
      // Worked out before anything is used up, since using things up changes
      // the answer.
      const strict = new Map(r.inputs.map((i) => [i.item, strictInput(g, r, i.item)]));
      const hard = (r.difficulty ?? 0) + matOf(mat).difficulty;
      if (r.difficulty !== undefined && !g.skillCheck(r.skill, hard, toolQl(g), ease)) {
        if (r.consumeOnFail) {
          for (const i of r.inputs) consumeAcross(g, i.item, i.count ?? 1, t.uid, mat, strict.get(i.item));
          // The batch is wasted, not the vessel: you tip the ruin out and keep
          // the bucket.
          for (const [id, n] of r.salvage ?? r.returns ?? []) g.inventory.add(id, { count: n, ql: 20 });
        }
        g.logMsg(r.fail ?? `You fail to make ${lower(r.result)}.`, 'event');
        return more(t, g);
      }
      const fromInputs = r.qlFromInputs ? inputQl(g, r) : 0;
      for (const i of r.inputs) if (!consumeAcross(g, i.item, i.count ?? 1, t.uid, mat, strict.get(i.item))) return;
      const ql = r.qlFromInputs ? Math.max(1, Math.min(100, fromInputs * (0.78 + g.skills.get(r.skill) / 460))) : g.productQl(r.skill, toolQl(g) + (oven ? oven.ql * 0.3 : 0));
      const item = g.inventory.add(r.result, { count: r.count ?? 1, ql, extra: r.extra ?? mat });
      // Now and again a thing comes off the bench better than the hands that
      // made it had any right to produce. Nothing brings it on.
      const rare = rollRarity(g.rand);
      if (rare) {
        item.rare = rare;
        g.note(['', 'rare', 'supreme', 'fantastic'][rare]);
        g.logMsg(RARITY_WORD[rare], 'skill');
      }
      g.madeIt(r.result, item.ql, r.count ?? 1, rare);
      for (const [id, n] of r.returns ?? []) g.inventory.add(id, { count: n, ql: 20 });
      // Working a thing out with your hands is what sharpens the head.
      g.gainSkill('mind_logic', 0.25);
      g.logMsg(`${r.done} (${mat ? `${mat.toLowerCase()}, ` : ''}QL ${item.ql.toFixed(1)})`, 'event');
      return more(t, g);
    },
  };
}

export const RECIPE_ACTIONS: ActionDef[] = RECIPES.map(recipeAction);
export const RECIPE_BY_ID = new Map(RECIPES.map((r) => [r.id, r]));

/**
 * Everything somebody made that is worth eating, worked out once.
 *
 * Reported: a knack off a raw berry. `boonOf` gated on "anything with
 * something in it", which is a handful of blueberries as much as a stew — so a
 * trade could be favoured for twenty minutes by eating fruit straight off a
 * bush, and the line over the list in `boons.ts` has said "everything cooked"
 * since the day it was written while the code under it said nothing of the
 * kind.
 *
 * It lives here rather than in `boons.ts` because the rule is "is there a
 * recipe for it", and `boons.ts` may not ask: `actions.ts` imports it, and
 * this file reaches back through traps to `actions.ts`. Everything that grants
 * a knack is already on this side of that ring.
 *
 * A dish off a fire, a cheese, an oil pressed under a quern, a barrel that has
 * finished working: things that took a fire, a tool or a month. Meat off a
 * kill, a fish off a line, a berry off a bush and milk out of a beast are food
 * and are not a knack.
 */
let cooked: Set<string> | null = null;
export function knackable(id: string): boolean {
  if (!cooked) {
    cooked = new Set(RECIPES.map((r) => r.result));
    // A barrel that has finished working is drawn off into `<brew>_bucket`.
    for (const brew of BREWS) cooked.add(`${brew.id}_bucket`);
  }
  return cooked.has(id);
}
