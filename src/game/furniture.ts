import type { ActionDef, Target } from './actions';
import { SIDE_NAMES, type Side } from './building';
import { STORE_REACH, SUBTILES } from './crates';
import { CROP_BY_SEED } from './farming';
import type { Game } from './game';
import { isWorked, itemDef, itemName, rarityOf, roomFor, storedLine, type Item } from './items';
import { matOf } from './materials';

/**
 * What a store takes, for the five that take one sort of thing: raw materials,
 * worked materials, food, seed, sprouts. `TAKES` below holds the test and the
 * sentence for each.
 */
export type Takes = 'raw' | 'worked' | 'food' | 'seed' | 'sprout';

/**
 * Furniture: everything a fine carpenter nails together and sets down indoors.
 * A piece covers a block of subtiles like a smelter does, and the ones with
 * doors and shelves on them hold far more than any crate.
 */
export interface FurnitureDef {
  id: string;
  name: string;
  /** Subtiles it covers, across and down. */
  w: number;
  h: number;
  /** Things it holds, for the pieces that hold anything. */
  capacity?: number;
  /**
   * Kilograms it holds, for a piece measured that way instead.
   *
   * A count is the wrong unit for worked materials. Twelve hundred nails and
   * twelve hundred planks are the same number and not remotely the same load,
   * and a smith who has spent a morning at the anvil has thousands of the one
   * and dozens of the other. So the craft material bin has no count limit at
   * all: what fills it is weight, and a bin of nails takes a quarter of a
   * million of them where a bin of timber takes four hundred.
   *
   * Capacity and this are exclusive. A piece has one or the other, and
   * `furnitureRoom` is the one place that knows which.
   */
  heft?: number;
  /**
   * A counter that sells. What is in it carries a price, anybody may buy from
   * it, and the coins wait in its till for whoever set it up.
   */
  stall?: boolean;
  /**
   * A box the post uses. A parcel goes in at one and comes out at any other,
   * which is the only way anything but words crosses an island between two
   * people who are not standing together.
   */
  post?: boolean;
  /** A board made to be written on: its name is painted across the world. */
  sign?: boolean;
  /** Boards, shafts and nails it is nailed together from. */
  bill: Array<[string, number]>;
  /** How hard it is to make well. */
  difficulty: number;
  /** Seconds of work. */
  time: number;
  /** What the carpenter says when it comes out right. */
  done: string;
  /** Trade that builds it; fine carpentry with a mallet unless it says otherwise. */
  skill?: string;
  tool?: string;
  /**
   * What this store takes, for the ones that take one sort of thing.
   *
   * It was two booleans, `raw` and `crafted`, while the raw material bin and
   * the craft material bin were the only two restricted stores. There are five
   * now, and five parallel flags would be five places to forget one: instead a
   * single field naming the kind, and `TAKES` holding the test and the
   * sentence for each, so the sixth is a row rather than a branch in two files.
   */
  takes?: Takes;
  /** What is put in rots this many times faster than it would in the open. */
  trash?: number;
  /** Can be taken hold of and pulled along behind you. */
  cart?: boolean;
  /** A wheeled thing a team is hitched to and a driver sits on. */
  vehicle?: VehicleDef;
  /** A hull that floats, and is pushed along by whoever is sitting in it. */
  boat?: BoatDef;
  /** Litres of one liquid it holds, and nothing else. */
  liquid?: number;
  /** Draws its own water, up to this many litres. */
  well?: number;
  /** Burns fuel, and cooks whatever a campfire cooks. */
  hearth?: boolean;
  /** Can be slept in; the number is how much of a rest it is. */
  bed?: number;
  /** A stone table to kneel at. Praying at one banks favour. */
  altar?: boolean;
  /** Rung on a settlement: every wildermon of the deed comes, and every citizen hears where it hangs. */
  bell?: boolean;
  /** On the map from the day it is set up. */
  landmark?: boolean;
  /** What the piece is of, when it is not the wood it was built from. */
  material?: 'wood' | 'metal';
  /**
   * A swarm's own house. Nobody puts anything into a hive: a tamed Vesp on
   * the deed fills it with comb, and the number is how much it will hold
   * before the swarm stops and waits for it to be emptied.
   */
  hive?: number;
  /**
   * Crate spots on its deck: one to a subtile, so a rack of `w` by `h` holds
   * `w * h` of them.
   *
   * Nothing is stored *in* a piece with this on it. What stands on the deck is
   * an ordinary placed crate at an ordinary subtile — the same crate, with the
   * same contents, the same name and the same deed flag it would have on bare
   * ground. The rack's footprint simply *is* its crate spots, which is why
   * this needs no store of its own on either side of the wire and why a crate
   * on it survives the rack being a browser's idea rather than an island's.
   */
  crates?: number;
}

/**
 * What it takes to put a vehicle on the road.
 *
 * A large cart rolls behind one wildermon and rolls better behind two; a wagon
 * has four yokes and will not stir until every one of them is filled. Nothing
 * about the load decides it — a full wagon is no slower than an empty one —
 * but the team does: a fast animal gets there sooner, and more of them pull
 * better than fewer.
 */
export interface VehicleDef {
  /** Places a wildermon can be hitched. */
  yokes: number;
  /** Yokes that have to be filled before it will move at all. */
  needs: number;
  /** How high off the ground the seat is in pixels, for drawing the driver. */
  seat: number;
}

/**
 * What it takes to float. A boat goes on water and nowhere else: it is
 * launched into it, it will not cross dry land, and the one aboard has to
 * find a shore again before getting out. Nothing is hitched to it; the pace
 * is the hull's and the arms or the wind behind it.
 */
export interface BoatDef {
  /** Tiles a second at a fair effort. */
  speed: number;
  /** Height units of water it needs under it. */
  draught: number;
  /** How high the deck sits, for drawing whoever is in it. */
  seat: number;
  /** True when the wind does the work, so the body behind it matters less. */
  sail?: boolean;
}

const piece = (
  id: string,
  name: string,
  w: number,
  h: number,
  bill: Array<[string, number]>,
  difficulty: number,
  time: number,
  done: string,
  capacity?: number,
  extra: Partial<FurnitureDef> = {},
): FurnitureDef => ({ id, name, w, h, bill, difficulty, time, done, capacity, ...extra });

/**
 * Every piece, from a three-legged stool to a wagon. Everything a carpenter
 * builds here is nailed rather than pegged, so every one of them takes nails.
 */
export const FURNITURE: FurnitureDef[] = [
  piece('stool', 'Stool', 1, 1, [['plank', 1], ['shaft', 3], ['nail', 6]], 8, 6, 'You nail up a three-legged stool.'),
  piece('chair', 'Chair', 1, 1, [['plank', 2], ['shaft', 4], ['nail', 10]], 12, 8, 'You nail up a chair with a proper back to it.'),
  piece('bench', 'Bench', 2, 1, [['plank', 4], ['shaft', 4], ['nail', 14]], 12, 9, 'You nail up a bench long enough for two.'),
  piece('table', 'Table', 2, 2, [['plank', 6], ['shaft', 4], ['nail', 16]], 14, 11, 'You nail up a square table.'),
  piece('long_table', 'Long table', 3, 2, [['plank', 10], ['timber', 2], ['shaft', 4], ['nail', 26]], 20, 16, 'You nail up a long table, the sort a hall is built around.'),
  piece('desk', 'Writing desk', 2, 2, [['plank', 8], ['timber', 2], ['nail', 20]], 22, 14, 'You nail up a writing desk, drawers and all.', 20),
  piece('bed', 'Bed', 3, 2, [['plank', 6], ['timber', 4], ['cloth', 2], ['nail', 20]], 18, 15, 'You nail up a bed and stuff the mattress.', undefined, { bed: 1 }),
  piece('cot', 'Cot', 2, 2, [['plank', 4], ['timber', 2], ['cloth', 1], ['nail', 12]], 12, 10, 'You nail up a narrow cot.', undefined, { bed: 0.7 }),
  piece('chest', 'Chest', 2, 2, [['plank', 8], ['timber', 2], ['nail', 18]], 16, 12, 'You nail up a banded chest.', 60),
  piece('coffer', 'Coffer', 1, 1, [['plank', 4], ['nail', 10]], 14, 8, 'You nail up a small coffer.', 25),
  piece('cupboard', 'Cupboard', 2, 1, [['plank', 10], ['timber', 2], ['nail', 22]], 20, 14, 'You nail up a cupboard and hang its doors.', 80),
  piece('wardrobe', 'Wardrobe', 2, 2, [['plank', 14], ['timber', 4], ['nail', 30]], 24, 18, 'You nail up a wardrobe tall enough to hang a cloak in.', 100),
  piece('shelves', 'Shelves', 3, 1, [['plank', 12], ['timber', 2], ['nail', 26]], 18, 15, 'You nail up a long rack of shelves.', 120),
  piece('bookshelf', 'Bookshelf', 2, 1, [['plank', 10], ['timber', 2], ['nail', 22]], 20, 14, 'You nail up a bookshelf with a cornice on top.', 90),
  piece('larder', 'Larder', 2, 2, [['plank', 16], ['timber', 4], ['nail', 34]], 26, 20,
    'You nail up a deep larder and slate the floor of it cold. Food, drink, flour and dough go in it, and nothing else.', 250,
    { takes: 'food' }),
  piece('barrel', 'Barrel', 1, 1, [['plank', 6], ['shaft', 2], ['nail', 10]], 18, 10, 'You raise the staves and hoop a barrel.', undefined, { liquid: 80 }),
  /*
   * The two pieces that exist for other people.
   *
   * A **stall** is a counter with goods on it and a price on each, and it
   * sells while you are asleep: anybody standing at it may buy, the coins go
   * into its till, and you empty the till when you next come by. It is the
   * only thing on this island that does anything for you while you are not
   * here, and it is the whole reason coins are worth striking.
   *
   * A **mailbox** is the other half of the post. A letter has carried four
   * hundred characters and nothing else since letters landed; a parcel goes
   * in at one of these and comes out at another, which is what turns writing
   * to somebody into sending them something.
   */
  piece('stall', 'Market stall', 3, 2, [['plank', 12], ['timber', 4], ['cloth', 4], ['nail', 26]], 22, 18,
    'You nail up a counter, stretch the awning over it and stand back. Set a price on anything you lay out and it sells whether you are here or not.', 60,
    { stall: true }),
  piece('mailbox', 'Mailbox', 1, 1, [['plank', 4], ['ribbon', 2], ['nail', 8]], 18, 10,
    'You nail up a box with a slot in it and a door on the back. A parcel goes in at one and comes out at any other.', 30,
    { post: true }),
  // One wildermon, shut in to be carried or set down: see `creaturecrate.ts`.
  piece('creature_crate', 'Creature crate', 2, 2, [['plank', 8], ['nail', 4], ['ribbon', 2]], 16, 10,
    'You nail up a creature crate. It holds one wildermon.'),
  piece('lectern', 'Lectern', 1, 1, [['plank', 4], ['shaft', 2], ['nail', 8]], 16, 9, 'You nail up a lectern with a good slant on it.'),
  piece('coat_rack', 'Coat rack', 1, 1, [['plank', 1], ['shaft', 4], ['nail', 6]], 10, 6, 'You nail up a rack of pegs for the door.'),
  piece('planter', 'Planter', 2, 1, [['plank', 6], ['nail', 10]], 10, 7, 'You nail up a planter and fill it with earth.'),
  piece('firewood_rack', 'Firewood rack', 2, 1, [['plank', 2], ['shaft', 6], ['nail', 10]], 12, 8, 'You nail up a rack to keep firewood off the wet.', 40),
  /*
   * The biggest thing a carpenter builds, and the only one whose footprint is
   * the point of it: two subtiles across and four deep, and every one of the
   * eight takes a plank crate.
   *
   * It holds nothing itself. Eight crates stand on it and each is its own
   * crate — a crate of iron ore beside a crate of wheat, named, filled and
   * emptied exactly as they are on the floor. What the rack gives is that they
   * stand in one place, in a row, and you can see across a warehouse how much
   * of it is full.
   */
  piece('crate_shelf', 'Crate shelf', 2, 4,
    [['plank', 20], ['timber', 8], ['nail', 44]], 24, 22,
    'You frame the rack, deck it over and set the runners. It will take eight crates.',
    undefined, { crates: 8 }),
  piece('bell', 'Bell', 1, 1, [['bell_casting', 1], ['timber', 2], ['thick_rope', 1], ['nail', 8]], 22, 18, 'You hang the bell in its frame and knot the rope to the tongue. Rung on your settlement, every wildermon of the deed comes and every citizen hears where it hangs.', undefined, { bell: true, material: 'metal' }),
  piece('statue', 'Statue', 1, 1, [['statue_casting', 1], ['stone_slab', 1]], 24, 20, 'You set the casting on its slab and it stands, and will go on standing. It is on the map from here on.', undefined, { landmark: true, material: 'metal', skill: 'masonry', tool: 'trowel' }),
  piece('hive', 'Hive', 2, 1, [['plank', 6], ['shaft', 2], ['cloth', 1], ['nail', 12]], 18, 13, 'You nail up a hive of shallow boxes and turn the mouth of it south. Now it wants a swarm.', undefined, { hive: 40 }),
  // The two the cloth trade is built on. Stand at one to spin or weave.
  piece('spindle', 'Spindle', 1, 1, [['plank', 2], ['shaft', 3], ['nail', 8]], 14, 9, 'You turn a spindle and set it on its stand.'),
  piece('loom', 'Loom', 2, 2, [['plank', 8], ['timber', 4], ['shaft', 6], ['nail', 24]], 22, 18, 'You build a loom and thread the warp.'),
  // Masonry, not carpentry: these two are laid in brick and mortar.
  piece('oven', 'Oven', 2, 2, [['stone_brick', 10], ['mortar', 4]], 24, 18, 'You lay the courses, turn an arch over the mouth and leave it to set. An oven.', undefined, { skill: 'masonry', tool: 'trowel', hearth: true }),
  /*
   * A fire you can put where you want one, which an oven is not.
   *
   * `hearth` is the whole of what makes it burn: fuelling, lighting, raking
   * out and taking the ashes have read `furnitureDef(kind).hearth` since the
   * oven was written, so a second hearth needed no action of its own. What it
   * needed was a reason to exist, and that is the night — a brazier lights
   * itself at dusk, goes out at dawn, and shows the ground around it while it
   * burns.
   */
  piece('brazier', 'Brazier', 1, 1, [['stone_brick', 6], ['mortar', 2], ['ribbon', 2]], 20, 12, 'You lay a shallow bowl of brick and band it with iron. A brazier.', undefined, { skill: 'masonry', tool: 'trowel', hearth: true }),
  piece('altar', 'Altar', 2, 2, [['stone_brick', 16], ['mortar', 8], ['stone_slab', 4], ['gold_lump', 1]], 40, 40, 'You lay the courses, bed the slab on top and set the gold into the face of it. Kneel here at dawn.', undefined, { skill: 'masonry', tool: 'trowel', altar: true }),
  piece('banner', 'Banner', 1, 1, [['cloth', 4], ['shaft', 2], ['rope', 1], ['nail', 6]], 10, 10, 'You hem the cloth, lash it to the staff and run it up. Dye it and it is your colour.', undefined, { skill: 'tailoring' }),
  piece('well', 'Well', 2, 2, [['stone_brick', 12], ['mortar', 4], ['shaft', 4], ['thick_rope', 1], ['nail', 8]], 30, 24, 'You line the shaft, cap it with a kerb and hang a windlass over it. It will find its own water.', undefined, { skill: 'masonry', tool: 'trowel', well: 50 }),
  // Storage of a different sort: raw materials, rubbish, and something to pull it in.
  piece('bulk_bin', 'Raw material bin', 2, 2, [['plank', 12], ['timber', 4], ['nail', 24]], 20, 16, 'You build a deep bin with a hinged lid, the sort a cartload of ore goes into.', 400, { takes: 'raw' }),
  /*
   * Its opposite number, off the same bill of materials.
   *
   * The raw bin solved half the problem: a cartload of ore has somewhere to
   * go. What a smith and a carpenter turn out all day had nowhere -- nails,
   * ribbons, hinges, planks, lumps, bricks -- and they fill a chest in an
   * afternoon because a chest counts things.
   *
   * Counting is the wrong unit for them. This one is measured in kilograms
   * instead: two and a half tonnes of whatever a bench has touched, which is
   * two hundred and fifty thousand nails or twelve hundred planks. There is
   * no count limit on it at all.
   */
  piece('craft_bin', 'Craft material bin', 2, 2, [['plank', 12], ['timber', 4], ['nail', 24]], 20, 16, 'You build a deep bin with a partitioned lid, the sort a morning at the anvil goes into.', undefined, { heft: 2500, takes: 'worked' }),
  /*
   * And the two small ones, for the two things a farmer and a forester carry
   * home by the handful.
   *
   * Both are weighed rather than counted, for the same reason the craft bin
   * is: a sprout weighs 0.1 kg and a wheat seed 0.02, so a hundred kilograms
   * is a thousand sprouts or five thousand seeds, and no one number of things
   * would have been right for both.
   */
  piece('seed_bin', 'Seed bin', 1, 1, [['plank', 5], ['nail', 10]], 12, 9,
    'You build a bin with a tight lid and a scoop, the sort a season\'s seed keeps dry in.',
    undefined, { heft: 100, takes: 'seed' }),
  piece('sprout_bin', 'Sprout bin', 1, 1, [['plank', 5], ['nail', 10]], 12, 9,
    'You build a bin with a damp cloth under the lid. Sprouts wilt in the open; they will keep in this.',
    undefined, { heft: 100, takes: 'sprout' }),
  piece('trash_crate', 'Trash crate', 1, 1, [['plank', 3], ['nail', 6]], 8, 5, 'You knock together an open crate with a rotten bottom. Nothing lasts in it.', 30, { trash: 30 }),
  piece('cart', 'Small cart', 2, 1, [['plank', 8], ['shaft', 4], ['nail', 16]], 18, 14, 'You build a small cart on two wheels, light enough for one person to pull.', 100, { cart: true }),
  // The two that are driven rather than carried. A wheelwright's bill: wheels
  // on cast axles, a body banded with metal ribbon, and a yoke a wildermon is
  // hitched into.
  piece('large_cart', 'Large cart', 3, 2, [['plank', 20], ['timber', 6], ['large_wheel', 2], ['big_axle', 1], ['ribbon', 8], ['yoke', 2], ['nail', 40]], 30, 40, 'You build a large cart: box body, seat over the axle and a yoke to each side.', 1000, { skill: 'carpentry', vehicle: { yokes: 2, needs: 1, seat: 15 } }),
  piece('wagon', 'Wagon', 4, 3, [['plank', 40], ['timber', 12], ['large_wheel', 4], ['big_axle', 2], ['ribbon', 16], ['yoke', 4], ['nail', 80]], 45, 75, 'You build a wagon: four wheels under a long bed, a driver\'s box at the front and four yokes ahead of it.', 10000, { skill: 'carpentry', vehicle: { yokes: 4, needs: 4, seat: 19 } }),
  // The two that float. Built on the bank and launched into water with a
  // couple of feet under it; they carry their load and their crew and will
  // not be dragged up a beach.
  piece('rowing_boat', 'Rowing boat', 3, 2, [['plank', 20], ['timber', 6], ['shaft', 2], ['rope', 2], ['nail', 30]], 28, 34, 'You lay the strakes over the ribs, caulk the seams and set a pair of oars in her.', 300, { skill: 'carpentry', boat: { speed: 1.9, draught: 2, seat: 9 } }),
  piece('sailing_boat', 'Sailing boat', 4, 3, [['plank', 40], ['timber', 14], ['shaft', 3], ['cloth', 6], ['rope', 8], ['thick_rope', 2], ['ribbon', 4], ['nail', 70]], 42, 70, 'You plank her, step the mast, bend the sail on and hang a rudder off the stern.', 1500, { skill: 'carpentry', boat: { speed: 3.4, draught: 4, seat: 13, sail: true } }),
  // Barrels hold liquid and nothing else, in three sizes.
  piece('small_barrel', 'Small barrel', 1, 1, [['plank', 3], ['shaft', 1], ['nail', 6]], 12, 7, 'You raise a small barrel and hoop it tight.', undefined, { liquid: 30 }),
  piece('large_barrel', 'Large barrel', 2, 2, [['plank', 14], ['shaft', 4], ['nail', 26]], 26, 20, 'You raise a great barrel, as tall as you are and twice as wide.', undefined, { liquid: 250 }),
  // A board on a post, made to carry writing. Name it and the name stands in
  // the world where anyone walking past can read it.
  piece('sign', 'Sign', 1, 1, [['plank', 2], ['shaft', 2], ['nail', 6]], 10, 7, 'You nail a board across two posts and set it up straight.', undefined, { sign: true }),
  piece('great_sign', 'Signboard', 2, 1, [['plank', 5], ['timber', 1], ['shaft', 2], ['nail', 12]], 18, 12, 'You nail up a board wide enough to write a sentence on.', undefined, { sign: true }),
];

export const FURNITURE_BY_ID = new Map(FURNITURE.map((f) => [f.id, f]));
export const isFurniture = (id: string): boolean => FURNITURE_BY_ID.has(id);
export const furnitureDef = (id: string): FurnitureDef => FURNITURE_BY_ID.get(id) ?? FURNITURE[0];
/** Pieces that hold things, largest first: the point of a larder. */
export const STORES = FURNITURE.filter((f) => f.capacity).sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0));

export interface PlacedFurniture {
  id: number;
  /**
   * Whose this is, on an island. Absent in the game you play by yourself,
   * where everything on the ground is yours because there is only you.
   */
  mine?: boolean;

  x: number;
  y: number;
  /** Top-left subtile of the block it covers. */
  sx: number;
  sy: number;
  /**
   * Which way it faces: the side its front is turned to. It stands that way
   * whichever way the view is turned. Absent means south, which is how every
   * piece stood before pieces could be turned.
   */
  facing?: Side;
  /** Which of the twenty it is. */
  kind: string;
  ql: number;
  /**
   * 1 rare, 2 supreme, 3 fantastic; absent for the ordinary run of things.
   *
   * A piece set down used to lose it. `place_furniture` copied the quality,
   * the wood and the dye off the item and left the rarity behind, and picking
   * it up again made a plain new one -- so a rare chest was a rare chest until
   * the first time anybody put it in a room, and then it was a chest. It also
   * meant a rare thing could never shine on the ground, because by the time it
   * was on the ground it was not rare any more.
   */
  rare?: number;
  /** Who made it, which rare work and better carries. */
  maker?: string;
  /** What you have called it, when you have called it anything. */
  name?: string;
  /** What is stored in it, for the pieces that store anything. */
  items: Item[];
  /** Seconds of fuel left and whether it is alight, for the oven. */
  fuel?: number;
  lit?: boolean;
  ash?: number;
  /** Litres held, and of what, for barrels and the well. */
  litres?: number;
  liquid?: LiquidKind;
  /** Set while the cart is being pulled along behind you. */
  hitched?: boolean;
  /** Wildermon hitched to it, in yoke order; only vehicles have any. */
  team?: number[];
  /** Set while the player is up on the seat with the reins in hand. */
  driven?: boolean;
  /** Who has the reins, by who they are on the wire. Absent means whoever is local. */
  driverId?: number;
  /** Comb drawn but not yet capped, for a hive. */
  comb?: number;
  /** Seconds a brew still has to work before it can be drawn off. */
  ferment?: number;
  /** The wood it was built of, for the pieces a carpenter builds. */
  material?: string;
  /** The colour it was dyed, for a banner and for a sail. */
  dye?: string;
  /**
   * The padlock fitted to it, by the number it shares with its key. See
   * `locks.ts`. Only means anything on a piece that holds things.
   */
  lock?: number;
  /**
   * What a stall has taken, in silver, waiting for whoever set it up.
   *
   * It goes into the till rather than into a pocket because the pocket is
   * very likely asleep — which is the whole point of a stall and the only
   * thing on this island that does anything for you while you are away.
   */
  till?: number;
  /** The wildermon shut in it, for a creature crate standing on the ground. It is drawn inside. */
  creature?: number;
}

/** The two liquids worth keeping a barrel for. */
export type LiquidKind = 'water' | 'lye' | 'milk' | 'ale' | 'cider' | 'mead' | 'wine' | 'juice';
export const LIQUID_NAME: Record<LiquidKind, string> = { water: 'water', lye: 'lye', milk: 'milk', ale: 'ale', cider: 'cider', mead: 'mead', wine: 'wine', juice: 'juice' };
/** A bucket holds five litres, whichever way it is going. */
export const BUCKET_LITRES = 5;
/** Which liquid a full vessel is carrying, and which empty vessel it leaves. */
export const VESSELS: Record<string, { liquid: LiquidKind; empty: string }> = {
  water_bucket: { liquid: 'water', empty: 'bucket' },
  lye_bucket: { liquid: 'lye', empty: 'bucket' },
  milk_bucket: { liquid: 'milk', empty: 'bucket' },
  ale_bucket: { liquid: 'ale', empty: 'bucket' },
  cider_bucket: { liquid: 'cider', empty: 'bucket' },
  mead_bucket: { liquid: 'mead', empty: 'bucket' },
  wine_bucket: { liquid: 'wine', empty: 'bucket' },
  juice_bucket: { liquid: 'juice', empty: 'bucket' },
};
/** Which full vessel a litre of each liquid fills an empty bucket into. */
export const BUCKET_OF: Record<LiquidKind, string> = { water: 'water_bucket', lye: 'lye_bucket', milk: 'milk_bucket', ale: 'ale_bucket', cider: 'cider_bucket', mead: 'mead_bucket', wine: 'wine_bucket', juice: 'juice_bucket' };

/**
 * What to call a piece standing on the ground.
 *
 * A name you gave it wins outright, and otherwise it is said the way the pack
 * says it: the word for what it is, the wood it was built of, and -- since a
 * piece keeps its rarity when it is set down -- rare, supreme or fantastic in
 * front of the lot.
 */
export const furnitureName = (f: PlacedFurniture): string => {
  if (f.name) return f.name;
  const plain = f.material ? `${furnitureDef(f.kind).name} (${f.material.toLowerCase()})` : furnitureDef(f.kind).name;
  const rare = rarityOf(f).name;
  return rare ? `${rare.charAt(0).toUpperCase()}${rare.slice(1)} ${plain.toLowerCase()}` : plain;
};
export const furnitureUnits = (f: PlacedFurniture): number => f.items.reduce((n, it) => n + it.count, 0);
/** How much more a counting piece will take. `furnitureRoom` is the general one. */
export const furnitureSpare = (f: PlacedFurniture): number => Math.max(0, furnitureCapacity(f) - furnitureUnits(f));
/** What it holds: its build, and how strong a wood it was built out of. */
export const furnitureCapacity = (f: PlacedFurniture): number => roomFor((furnitureDef(f.kind).capacity ?? furnitureDef(f.kind).hive ?? 0) * matOf(f.material).hold, f);
/** Kilograms it holds, for a piece measured that way. Nought for the rest. */
export const furnitureHeft = (f: PlacedFurniture): number => roomFor((furnitureDef(f.kind).heft ?? 0) * matOf(f.material).hold, f);
/** Kilograms standing in it, which is the only thing a heft bin counts. */
export const furnitureKg = (f: PlacedFurniture): number =>
  f.items.reduce((kg, it) => kg + itemDef(it.id).weight * it.count, 0);
/**
 * Whether a piece holds things at all.
 *
 * This used to be `furnitureCapacity(f) > 0` written out in eight places, and
 * every one of them would have said no to a bin whose limit is weight. One
 * question, asked once.
 */
export const furnitureHolds = (f: PlacedFurniture): boolean => furnitureCapacity(f) > 0 || furnitureHeft(f) > 0;
/**
 * How big a store a piece is for a given thing: what it holds when empty.
 *
 * The straight generalisation of `furnitureCapacity`, and what two stores
 * standing beside each other are ranked by -- so a counting piece is ranked on
 * exactly the number it always was, and a bin measured in kilograms joins the
 * ranking rather than sorting last on a capacity of nought.
 */
export const furnitureSize = (f: PlacedFurniture, item: { id: string }): number => {
  const heft = furnitureHeft(f);
  if (!heft) return furnitureCapacity(f);
  const each = itemDef(item.id).weight;
  return each > 0 ? Math.floor(heft / each) : furnitureCapacity(f);
};
/**
 * How many of a thing will go in.
 *
 * The one place that knows a piece may be measured either way, and the reason
 * it takes the thing as well as the piece: once weight is the limit, how much
 * room there is depends on what you are putting in it. Two hundred and fifty
 * thousand nails and four hundred timbers are the same bin.
 */
export const furnitureRoom = (f: PlacedFurniture, item: { id: string }): number => {
  const heft = furnitureHeft(f);
  if (!heft) return furnitureSpare(f);
  // Nothing on this island weighs nothing, but a divide is a divide.
  const each = itemDef(item.id).weight;
  if (each <= 0) return furnitureUnits(f) > 0 ? 0 : 1;
  return Math.max(0, Math.floor((heft - furnitureKg(f)) / each));
};
/** The four ways a piece can face, in the order a turn to the right takes them: south, west, north, east. */
export const FACINGS: readonly Side[] = ['s', 'w', 'n', 'e'];
/** Which way a piece faces; everything stood facing south before pieces could be turned. */
export const facingOf = (f: { facing?: Side }): Side => f.facing ?? 's';
/** The facing a quarter turn away: to the right for +1, to the left for -1. */
export const turnedFacing = (facing: Side, step: number): Side => FACINGS[(((FACINGS.indexOf(facing) + step) % 4) + 4) % 4];
/** The block of subtiles a piece covers: its width and depth, swapped when it stands across the tile. */
export function furnitureFootprint(kind: string, facing: Side = 's'): [number, number] {
  const def = furnitureDef(kind);
  return facing === 'e' || facing === 'w' ? [def.h, def.w] : [def.w, def.h];
}
export const furnitureCentre = (f: PlacedFurniture): [number, number] => {
  const [w, h] = furnitureFootprint(f.kind, facingOf(f));
  return [f.x + (f.sx + w / 2) / SUBTILES, f.y + (f.sy + h / 2) / SUBTILES];
};

export function furnitureCovers(f: { kind: string; sx: number; sy: number; facing?: Side }, sx: number, sy: number): boolean {
  const [w, h] = furnitureFootprint(f.kind, facingOf(f));
  return sx >= f.sx && sx < f.sx + w && sy >= f.sy && sy < f.sy + h;
}

/** Whether a piece is a rack whose footprint is its crate spots. */
export const rackSpots = (f: { kind: string }): number => furnitureDef(f.kind).crates ?? 0;

/**
 * The subtiles of a rack's deck, in the order its spots fill.
 *
 * Front to back and left to right, which is the order somebody loading one
 * would actually work in and the order the model draws them — so a rack that
 * is three full looks three full from any side rather than showing a gap where
 * the fourth ought to be.
 */
export function rackDeck(f: { kind: string; sx: number; sy: number; facing?: Side }): Array<[number, number]> {
  const [w, h] = furnitureFootprint(f.kind, facingOf(f));
  const out: Array<[number, number]> = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([f.sx + dx, f.sy + dy]);
  return out;
}

/** Top-left subtile of the block a piece would take, kept inside the tile. */
export function furnitureAnchor(kind: string, sx: number, sy: number, facing: Side = 's'): [number, number] {
  const [w, h] = furnitureFootprint(kind, facing);
  return [Math.max(0, Math.min(SUBTILES - w, sx)), Math.max(0, Math.min(SUBTILES - h, sy))];
}

/** The vehicle a piece is, if it is one. */
export const vehicleOf = (f: { kind: string }): VehicleDef | undefined => furnitureDef(f.kind).vehicle;
export const isVehicle = (f: { kind: string }): boolean => !!furnitureDef(f.kind).vehicle;
/** The boat a piece is, if it is one. */
export const boatOf = (f: { kind: string }): BoatDef | undefined => furnitureDef(f.kind).boat;
export const isBoat = (f: { kind: string }): boolean => !!furnitureDef(f.kind).boat;
/** Anything that is boarded and steered: wheels or hull. */
export const isDriveable = (f: { kind: string }): boolean => isVehicle(f) || isBoat(f);
/** Wildermon hitched to it, which is an empty list for everything else. */
export const teamOf = (f: PlacedFurniture): number[] => f.team ?? [];

/** Litres a vessel holds: a barrel by its build, a well by how deep it was sunk. */
export const liquidCapacity = (f: PlacedFurniture): number => {
  const def = furnitureDef(f.kind);
  // A well is a lined shaft in the ground; only the coopered things vary.
  return def.liquid ? Math.round(def.liquid * matOf(f.material).hold) : def.well ?? 0;
};
export const holdsLiquid = (f: PlacedFurniture): boolean => liquidCapacity(f) > 0;
export const litresIn = (f: PlacedFurniture): number => f.litres ?? 0;
/** A well draws its own water; a barrel only holds what is poured into it. */
export const isWell = (f: PlacedFurniture): boolean => (furnitureDef(f.kind).well ?? 0) > 0;
/** A hive fills itself, and takes nothing from anyone's hands. */
export const hiveRoom = (f: PlacedFurniture): number => furnitureCapacity(f) - furnitureUnits(f);
export const isHive = (f: { kind: string }): boolean => (furnitureDef(f.kind).hive ?? 0) > 0;

/**
 * What a raw material bin says to anything a bench has touched. The island
 * says it in the same words (`furniture_refuses`).
 */
export const RAW_BIN_REFUSAL = 'A raw material bin takes raw materials — ore, logs, dirt, shards, wool — and nothing a bench has touched.';

/**
 * And what the other bin says to anything straight out of the ground. The
 * island says it in the same words (`furniture_refuses`).
 */
export const CRAFT_BIN_REFUSAL = 'A craft material bin takes worked materials — planks, nails, ribbons, hinges — and nothing that has not been through a bench.';

export const LARDER_REFUSAL = 'A larder takes food and drink, and the flour, dough and cornmeal a kitchen bakes from — and nothing else.';
export const SEED_BIN_REFUSAL = 'A seed bin takes seeds and nothing else.';
export const SPROUT_BIN_REFUSAL = 'A sprout bin takes sprouts and nothing else.';

/**
 * The five restricted stores: what each takes, and what it says to the rest.
 *
 * One table rather than a flag apiece, because the door is the same door five
 * times over and the only thing that varies is the question at it. The island
 * holds the same five under the same names, in `furniture_takes`, and the two
 * of them have to answer alike or a put the browser allows is a put the
 * island refuses.
 */
export const TAKES: Record<Takes, { is: (id: string) => boolean; refusal: string }> = {
  raw: { is: (id) => !!itemDef(id).raw, refusal: RAW_BIN_REFUSAL },
  worked: { is: isWorked, refusal: CRAFT_BIN_REFUSAL },
  /*
   * Food, drink, and the three things that are kept in a larder without being
   * food: flour, dough and cornmeal. Asked for: "flour and dough should go in
   * the larder too." They are ground grain and what is made of it, they keep
   * and decay like materials because that is what they are, and `ItemDef.larder`
   * says where they live rather than what they are.
   */
  food: { is: (id) => itemDef(id).category === 'food' || !!itemDef(id).larder, refusal: LARDER_REFUSAL },
  seed: { is: (id) => CROP_BY_SEED.has(id), refusal: SEED_BIN_REFUSAL },
  sprout: { is: (id) => id === 'sprout', refusal: SPROUT_BIN_REFUSAL },
};

/**
 * Why a piece will not take something, or null if it will. A barrel takes no
 * solids at all, a hive is the swarm's, and the five restricted stores each
 * ask `TAKES` the one question they were built around.
 */
export function furnitureRefuses(f: PlacedFurniture, item: Item): string | null {
  const def = furnitureDef(f.kind);
  const it = `${/^[aeiou]/i.test(def.name) ? 'An' : 'A'} ${def.name.toLowerCase()}`;
  if (holdsLiquid(f)) return `${it} holds liquid and nothing else.`;
  if (def.hive) return `${it} is the swarm's, not yours. Take what is in it; do not put anything back.`;
  if (!furnitureHolds(f)) return `${it} does not hold things.`;
  // Its id is spelled out rather than imported: creaturecrate.ts imports this file.
  if (item.id === 'creature_crate' && !def.stall) return 'A creature crate goes on a stall, and in no other store.';
  const takes = def.takes && TAKES[def.takes];
  if (takes && !takes.is(item.id)) return takes.refusal;
  return null;
}

export function furnitureState(f: PlacedFurniture): string {
  const def = furnitureDef(f.kind);
  const ql = `QL ${f.ql.toFixed(0)}`;
  if (holdsLiquid(f)) {
    const litres = litresIn(f);
    const what = f.liquid ? LIQUID_NAME[f.liquid] : 'empty';
    // A barrel that is working says so, and how long it has to go.
    const left = f.ferment ?? 0;
    const working = left > 0 ? ` · working, ${left >= 60 ? `${Math.ceil(left / 60)}m` : `${Math.ceil(left)}s`} to go` : '';
    return `${ql} · ${litres.toFixed(0)} / ${liquidCapacity(f)} litres of ${what}${working}`;
  }
  if (def.hearth) return `${ql} · ${f.lit ? 'lit' : 'cold'}`;
  if (def.hive) return `${ql} · ${furnitureUnits(f)} / ${furnitureCapacity(f)} of comb`;
  // A bin measured in kilograms says so; everything else counts things.
  const heft = furnitureHeft(f);
  if (heft) return `${ql} · ${furnitureKg(f).toFixed(0)} / ${heft} kg`;
  const cap = furnitureCapacity(f);
  const held = cap ? `${ql} · ${furnitureUnits(f)} / ${cap} things` : ql;
  const v = def.vehicle;
  if (!v) return held;
  return `${held} · ${teamOf(f).length} of ${v.yokes} yoked${f.driven ? ' · you have the reins' : ''}`;
}

type FurnitureTarget = Extract<Target, { kind: 'furniture' }>;
const pieceOf = (g: Game, t: Target): PlacedFurniture | undefined => (t.kind === 'furniture' ? g.furniture.get((t as FurnitureTarget).id) : undefined);
const nearPiece = (g: Game, f: PlacedFurniture): boolean => {
  const [cx, cy] = furnitureCentre(f);
  return Math.hypot(cx - g.player.x, cy - g.player.y) <= STORE_REACH;
};

/**
 * The piece a thing is being put away into: the one the ask names, and
 * otherwise the nearest that will have it — which is all it used to be. Two
 * chests side by side took what you gave either of them into whichever stood
 * closer, the same way a rack of crates did.
 */
const storeInto = (g: Game, t: Target, item: Item): PlacedFurniture | undefined => {
  if (t.kind === 'item' && t.into !== undefined) {
    const named = g.furniture.get(t.into);
    if (named && furnitureHolds(named)) return named;
  }
  return g.nearestStore(item);
};

export const FURNITURE_ACTIONS: ActionDef[] = [
  {
    id: 'place_furniture',
    label: 'Set it down',
    verb: 'setting the furniture down',
    hidden: true,
    stamina: 0.03,
    baseTime: 3,
    applies: (t) => t.kind === 'tile',
    check: (t, g) => {
      if (t.kind !== 'tile' || t.itemUid === undefined || t.sx === undefined || t.sy === undefined) return 'Choose a piece and a spot.';
      const item = g.inventory.get(t.itemUid);
      if (!item || !isFurniture(item.id)) return 'That is not furniture.';
      return g.furniturePlaceReason(item.id, t.x, t.y, t.sx, t.sy, t.facing ?? 's');
    },
    perform: (t, g) => {
      if (t.kind !== 'tile' || t.itemUid === undefined || t.sx === undefined || t.sy === undefined) return;
      const item = g.inventory.get(t.itemUid);
      if (!item || !isFurniture(item.id) || !g.inventory.remove(item.uid, 1)) return;
      const f = g.addFurniture(item.id, t.x, t.y, t.sx, t.sy, item.ql, [], item.extra, t.facing ?? 's');
      if (item.dye) f.dye = item.dye;
      // Everything the thing was keeps standing when the thing is standing.
      if (item.rare) f.rare = item.rare;
      if (item.maker) f.maker = item.maker;
      // And whoever is shut in it, who stands where it stands and is seen in it.
      const inside = item.creature !== undefined ? g.creatures.get(item.creature) : undefined;
      if (inside?.mode === 'stored') {
        f.creature = inside.id;
        [inside.x, inside.y] = furnitureCentre(f);
        g.events.emit('creature');
      }
      g.logMsg(inside?.mode === 'stored'
        ? `You set the ${furnitureName(f).toLowerCase()} down with ${inside.name} in it.`
        : `You set the ${furnitureName(f).toLowerCase()} down.`, 'event');
      g.events.emit('world', f.x, f.y);
    },
  },
  {
    // A quarter turn to the right, in place. A piece standing across the tile
    // takes its width and depth swapped, and is walked to the nearest spot it
    // fits; what it would swing into stops it.
    id: 'turn_furniture',
    label: 'Turn it',
    verb: 'turning it round',
    stamina: 0.03,
    baseTime: 10,
    applies: (t) => t.kind === 'furniture',
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return 'It is gone.';
      if (f.lit) return 'Put it out first.';
      if (f.hitched) return 'Let go of it first.';
      if (teamOf(f).length) return 'Unhitch the team first.';
      if (f.driven) return 'Get down off it first.';
      if (rackSpots(f) && g.cratesOn(f).length) return 'Take the crates off it first.';
      const facing = turnedFacing(facingOf(f), 1);
      const [ax, ay] = furnitureAnchor(f.kind, f.sx, f.sy, facing);
      const why = g.furniturePlaceReason(f.kind, f.x, f.y, ax, ay, facing, f.id);
      return why ? 'Something is in the way of turning it.' : null;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return;
      const facing = turnedFacing(facingOf(f), 1);
      const [ax, ay] = furnitureAnchor(f.kind, f.sx, f.sy, facing);
      if (g.furniturePlaceReason(f.kind, f.x, f.y, ax, ay, facing, f.id)) return;
      f.facing = facing;
      f.sx = ax;
      f.sy = ay;
      g.logMsg(`You turn the ${furnitureName(f).toLowerCase()} to face ${SIDE_NAMES[facing]}.`, 'event');
      g.events.emit('world', f.x, f.y);
    },
  },
  {
    id: 'pick_up_furniture',
    label: 'Pick it up',
    verb: 'lifting the furniture',
    stamina: 0.04,
    baseTime: 3,
    applies: (t) => t.kind === 'furniture',
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return 'It is gone.';
      if (f.items.length) return 'Empty it first.';
      // A rack holds nothing of its own, so `items` is empty however loaded it
      // is: what stands on it are eight crates of somebody else's, and lifting
      // the rack out from under them would leave them standing in the air.
      if (rackSpots(f)) {
        const on = g.cratesOn(f).length;
        if (on) return `Take the ${on === 1 ? 'crate' : `${on} crates`} off it first.`;
      }
      if (f.lit) return 'Not while it is alight.';
      if (litresIn(f) > 0) return 'Empty it out first.';
      if (f.hitched) return 'Let go of it first.';
      if (teamOf(f).length) return 'Unhitch the team first.';
      if (f.driven) return 'Get down off it first.';
      return null;
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f || f.items.length || f.lit || litresIn(f) > 0 || f.hitched || f.driven || teamOf(f).length) return;
      if (rackSpots(f) && g.cratesOn(f).length) return;
      g.removeFurniture(f.id);
      const back = g.inventory.add(f.kind, { ql: f.ql, extra: f.material });
      if (f.dye) back.dye = f.dye;
      if (f.rare) back.rare = f.rare;
      if (f.maker) back.maker = f.maker;
      // Whoever is shut in it comes too, and is where you are from now on.
      const inside = f.creature !== undefined ? g.creatures.get(f.creature) : undefined;
      if (inside?.mode === 'stored') {
        back.creature = inside.id;
        inside.x = g.player.x;
        inside.y = g.player.y;
        g.events.emit('creature');
      }
      g.logMsg(inside?.mode === 'stored'
        ? `You pick the ${furnitureName(f).toLowerCase()} up with ${inside.name} in it.`
        : `You pick the ${furnitureName(f).toLowerCase()} up.`, 'event');
      g.events.emit('world', f.x, f.y);
    },
  },
  {
    id: 'furniture_take_all',
    label: 'Take everything',
    verb: 'emptying it',
    stamina: 0.01,
    baseTime: 1,
    applies: (t, g) => !!pieceOf(g, t)?.items.length,
    check: (t, g) => {
      const f = pieceOf(g, t);
      if (!f) return 'It is gone.';
      if (!nearPiece(g, f)) return 'Stand next to it.';
      const shut = g.lockRefusal(f);
      if (shut) return shut;
      return f.items.length ? null : 'It is empty.';
    },
    perform: (t, g) => {
      const f = pieceOf(g, t);
      if (!f || !f.items.length) return;
      const items = f.items.splice(0, f.items.length);
      for (const it of items) g.inventory.addItem(it);
      g.events.emit('crate');
      const names = items.map((it) => (it.count > 1 ? `${it.count} × ${itemName(it).toLowerCase()}` : itemName(it).toLowerCase()));
      g.logMsg(`You take ${names.join(', ')} out of the ${furnitureName(f).toLowerCase()}.`, 'event');
    },
  },
  {
    id: 'store_in_furniture',
    label: 'Put away',
    verb: 'putting it away',
    instant: true,
    quantity: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      // A piece of furniture goes into no store, but for a creature crate, which goes on a stall to be sold.
      return !!item && (!isFurniture(item.id) || item.id === 'creature_crate') && storeInto(g, t, item) !== undefined;
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.get(t.uid);
      const f = item && storeInto(g, t, item);
      if (!item) return 'It is gone.';
      if (!f || !nearPiece(g, f)) {
        // Say why the thing beside you will not take it, rather than that nothing will.
        const beside = [...g.furniture.values()].filter((o) => nearPiece(g, o));
        beside.sort((a, b) => furnitureSize(b, item) - furnitureSize(a, item));
        for (const other of beside) {
          const why = furnitureRefuses(other, item);
          if (why) return why;
        }
        return 'Stand next to something that will take it.';
      }
      const shut = g.lockRefusal(f);
      if (shut) return shut;
      const refused = furnitureRefuses(f, item);
      if (refused) return refused;
      // Room for some of it is enough; what will not fit stays in the pack.
      if (furnitureRoom(f, item) <= 0) return `The ${furnitureName(f).toLowerCase()} is full.`;
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const held = g.inventory.get(t.uid);
      const f = held && storeInto(g, t, held);
      if (!f) return;
      const want = t.count ?? 1;
      const fits = Math.min(want, furnitureRoom(f, held));
      if (fits <= 0) {
        g.logMsg(`The ${furnitureName(f).toLowerCase()} is full.`, 'error');
        return;
      }
      const item = g.inventory.take(t.uid, fits);
      if (!item) return;
      if (!g.furnitureAdd(f, item)) {
        g.inventory.addItem(item);
        g.logMsg(`The ${furnitureName(f).toLowerCase()} is full.`, 'error');
        return;
      }
      g.logMsg(storedLine(item.count, itemName(item), furnitureName(f), want - item.count), 'event');
    },
  },
];

export const FURNITURE_ACTION_BY_ID = new Map(FURNITURE_ACTIONS.map((a) => [a.id, a]));
export { itemDef };
