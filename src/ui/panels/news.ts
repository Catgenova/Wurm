import {
  BODKIN_HIDE, BURN_WEAR, CONSIDER_EASY, CONSIDER_HARD, CRIT_BASE, CRIT_HIT, CRIT_KNIFE, CRIT_PER_SKILL, DODGE_FROM, DODGE_PER_CONTROL, DODGE_PER_KG, KNIFE_BLEED,
  KNIFE_BLEED_SECS, STAGGER_MAUL, THREAT_HOLD, VENOM_DRAIN, VENOM_SECS,
} from '../../game/fight';
import { BACK_PACE, BACK_SLACK, CIRCLE_R, COWARD_AT, COWARD_DRAG, DRAW_WALK, FALL_BACK, GUARD_RANGE, HUNTER_TURN, KEEP_OFF, MONSTER_TURN, PACK_CALL, PACK_MOST, THROW_HIT, THROW_REACH } from '../../game/fight';
import { FIGHT_QUIET, ARM_SLOW_MOST, ARMOUR_VS, armourSays, BLINDSIDE, blowSays, CROWD_BLOCK, FLANK_HIT, HEAVY_EVERY, HEAVY_HIT, HIDE_NAMES, HIDES, hideSays, LEG_SLOW_MOST, sideOf, WIND_UP, BLOW_DEFENSIVE, BLOW_HUNTER, BLOW_PREY, FIGHT_BACK_STILL, FIGHT_GIVE_UP, FIGHT_LEASH, FIGHT_STANCE_NAMES, FIGHT_STANCES, FIST, FOLLOW_RANGE, stanceSays, SWING_WIND, SWING_WIND_KG, TARGET_RANGE, TIRED_AT, TIRED_SLOW } from '../../game/fight';
import {
  CELLAR_DECAY, CELLAR_DEPTH, CELLAR_SOIL, COLUMN_SHARE, columnBill, floorBill, GLASS_ROOF, heftWord, onlySaid, takesAs, INDOORS_DECAY, INDOORS_REST, JETTY_REACH, MATERIAL_BY_ID, MATERIALS as WALL_MATERIALS, RAILING_HEIGHT,
  roofShapeDef, roofShapeOf, WALL_HEIGHT, WALL_TYPE_BY_ID, wallBill as typeBill,
} from '../../game/building';
import { CELLAR_DAYLIGHT } from '../../game/cellar';
import { materialName } from '../../game/buildActions';
import { COUNTER_HOLDS, COUNTER_REACH, COUNTER_WALL } from '../../game/counters';
import { candleBurn, lanternReach } from '../../game/light';
import { flameSources } from '../../game/lantern';
import { WORLD_PACE } from '../../game/pace';
import { SKILL_BY_ID } from '../../game/skills';
import { deckBill, metres, PIER_CLEAR, PIER_DROP, PIER_WALL_DROP, PIER_WATER } from '../../game/piers';
import { TILE_DEFS, TileType, TREE_AGES, TREE_DAWN_UTC, TREE_DEFS } from '../../world/tiles';
import { SEASON_DAYS, seasonLine, YEAR_DAYS, YEAR_FROM } from '../../world/calendar';
import { BLOOMS, BUSH_FLOWER_FROM, evergreen, LEAF_DAYS, SHED_DAYS, TURN_DAYS } from '../../render/foliage';
import { lifeSeasons } from '../../render/life';
import { furnitureDef, liquidCapacity, POND_EVERY, type PlacedFurniture } from '../../game/furniture';
import { billWords, countOf, type Item } from '../../game/items';
import { INGOT_LUMPS, INGOT_WEIGHT, MOULD_BY_ID } from '../../game/metal';
import { meltLumps } from '../../game/melt';
import { ORDER_LIFE } from '../../game/orders';
import { POST_LIFE_MIN } from '../../game/posts';
import { ACTION_BY_ID, GLAZE_ASH, KIT_MEND, MOSS_PER_CUT, MOSS_PLANT } from '../../game/actions';
import { CIRCLET_SHARE, CIRCLET_STONES, GEMS } from '../../game/gems';
import { RECIPE_BY_ID, RECIPES, TRADE_BOOK_AT } from '../../game/recipes';
import { BOARD_TOP } from '../../game/boards';
import { IDLE_LOGOUT, WORKER_REST_EVERY, WORKER_REST_FIRST, WORKER_REST_MOST } from '../../game/keep';
import { REPORTS_A_SESSION } from '../../net/errors';
import { ALIGNMENT_NAMES, BAR_SLOTS, FAITH_SPELLS, FAITH_TIER_AT, PATRON_AT, PATRONS, SCHOOL_NAMES, slotsFor, SPELL_ON_WORDS, SPELL_ONS, SPELL_REACH, SPELLS_PER_TIER } from '../../game/patrons';
import { article, capital, finePercent, listed, listedOr, NumberWord, numberWord, percent, share, spanWords, times } from '../../game/words';
import { ANCIENT_EFFECTS, ANCIENT_PLUS, BAUBLE_HIGH, BAUBLE_LOW, BAUBLE_SHARE, BAUBLE_TIERS, baubleTimes, REGRET_SHARE, YIELD_TIMES } from '../../game/baubles';
import { CLASS_CHANGE_COST, CLASSES, PERK_TIER_AT, PERKS_PER_TIER } from '../../game/classes';
import { perksOf } from '../../game/perks';
import { HUSBANDRY_ACTIONS } from '../../game/husbandry';
import { TINCTURE_BONUS, TINCTURE_SECONDS } from '../../game/boons';
import { TINCTURE_NAMES } from '../../game/remedies';
import { FED_SAID, MOTE_CHANCE } from '../../game/sacrifice';
import { GRAVE_KEEPS, GRAVE_REACH } from '../../game/graves';
import { RESTORE_HARM, RESTORE_HARM_SPREAD } from '../../game/archaeology';
import { DAMAGE_MAX, DAY_SECONDS, goSeconds } from '../../game/game';
import { UI_SIZE_MAX, UI_SIZE_MIN } from '../screen';
import { defaultKey } from '../../game/keybinds';
import { guidePages } from '../../game/guide';
import { MUTE_FOR, MUTE_SHUTS } from '../../game/keeper';
import { awayFor } from '../../game/away';
import { ARMOUR, SHIELDS, WEAPON_BY_ID, WEAPONS } from '../../game/gear';
import { JEWEL_PIECES } from '../../game/gems';
import { itemDef, RARITIES, rarityChance } from '../../game/items';
import { weaponCarry } from '../../render/figure';
import { TRY_LEARN } from '../../game/learn';
import { CLIMB_LEARN_FROM, CLIMB_PER_LEVEL, MAX_STEP } from '../../game/player';
import { ALL_GOALS } from '../../game/journal';
import { COMPANION_SIGHT, SPECIES } from '../../game/creatures';
import { betterThanCommon, CHANNELS, husbandryOdds, pct as cardPct } from '../../game/traits';
import { CHAIN_MOST, FALL_DROP, FILL_RATE, POOL_DEPTH, POOL_LIP, RUN_RATE, SPRING_DEPTH, SPRINGS_EACH } from '../../world/springs';
import { POOL_FILL } from '../../game/foundations';
import { MAX_STAND, SWIM_DEPTH } from '../../game/player';
import {
  STEPS_BRICKS, STEPS_LEAST, STEPS_MOST, STEPS_PLANKS, STEPS_SLABS, STEPS_TWIST, TILE_DEFS as GROUNDS, TileType as Ground, WEAR_FALL, WEAR_MOST,
  WEAR_TRAIL, WEARS,
} from '../../world/tiles';
import { STEPS_BACK, stepsBack, STONE_STEPS_BILL, TIMBER_STEPS_BILL } from '../../game/steps';
import { ROSE_BUD, ROSE_FLOWER, ROSE_LEAFY, ROSES_RULE } from '../../game/roses';
import { DEVICE_COUNT } from '../../render/furniture';
import { FLOWER_MOST, FLOWER_SEASONS } from '../../world/flowers';
import { DYES } from '../../game/dyestuffs';
import { GREEN_ACTIONS, GREEN_DAYS, GREEN_SHADE, GREEN_SUN, GREEN_WET } from '../../game/greening';
import { FURNITURE, WELL_TRICKLE, WELL_TRICKLE_QL } from '../../game/furniture';
import { BRIDGES, CLEARANCE, PULL_REACH } from '../../game/bridges';
import { AQUEDUCT } from '../../game/aqueducts';
import { AQUEDUCT_FLOW, AQUEDUCT_LPS, CHANNEL_DEEP, CHANNEL_WIDE, TILE_METRES } from '../../world/aqueducts';
import { gateJobWords, gateReach, HIDDEN_DOOR_IRON, HIDDEN_DOOR_LAPSE } from '../../game/gates';
import { CROPS, growthWords } from '../../game/farming';
import { GLASSHOUSE_GROWTH, PLANTER_GROWTH, SEASON_GROWTH, SEASON_SECONDS, YEAR_SECONDS } from '../../game/growth';
import { SEASONS } from '../../world/calendar';
import { STONES_DEPTH, STONES_SLABS, yearSays } from '../../game/watergarden';
import { WATER_PLANT_BY_ID, WATER_PLANT_DEEPEST, WATER_PLANT_SHALLOWEST, WATER_ROOTING, type WaterPlantDef } from '../../world/waterplants';
import type { UIWindow } from '../windows';

/**
 * What's new: what changed on the island, a line each, shown once as you come
 * ashore after it changed.
 *
 * Asked for: "What's new, on login. Players aren't told when things change,
 * such as today's cost increases and the caravel. A short note after each
 * deploy would say what changed."
 *
 * One entry a deploy, numbered in the order they went out. A browser keeps
 * the highest number it has shown (`SEEN`), and the window opens by itself on
 * the way in when there is a higher one, with the ones it has not shown
 * marked. A browser nobody has played in before is not behind, it is new: it
 * is marked up to date without being shown anything, since a list of what
 * changed is no use to somebody who never saw it the other way.
 *
 * Every line says what changed and by how much, in the game's own terms, and
 * takes its numbers from the rule where the rule has them (CLAUDE.md). So a
 * line reads what is true now, which for a note a few days old is what it
 * said when it was written.
 */

interface News {
  /** Counted up from one, a deploy each; see `SEEN`. */
  n: number;
  /** The day it reached the island. */
  day: string;
  /** What changed. Worked out when the window is drawn, from the rules as they stand. */
  lines: () => string[];
}

/** A piece's bill, as its recipe has it. */
const pieceBill = (id: string): string => billWords(furnitureDef(id).bill, true);
/** A recipe's bill. */
const recipeBill = (id: string): string =>
  billWords((RECIPE_BY_ID.get(id)?.inputs ?? []).map((i): [string, number] => [i.item, i.count ?? 1]), true);
/** A solid wall's bill in a material. */
const wallBill = (id: string): string => billWords(MATERIAL_BY_ID.get(id)?.bill ?? [], true);
const pct = (k: number): string => `${Math.round(k * 100)}%`;
/** "a, b or c". */
const either = (parts: string[]): string =>
  parts.length > 1 ? `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}` : (parts[0] ?? '');
/** A shop counter's wall type (`counters.ts`), for what entry 70 says it costs. */
const counterType = () => WALL_TYPE_BY_ID.get(COUNTER_WALL);
/** The skill a recipe is worked at, by name. */
const skillOf = (id: string): string => (SKILL_BY_ID.get(RECIPE_BY_ID.get(id)?.skill ?? '')?.name ?? '').toLowerCase();

export const NEWS: News[] = [
  {
    n: 1,
    day: '2026-09-25',
    lines: () => [
      'Creature crates: a crate holds one wildermon. With one already following you, another is tamed only into an empty crate in your pack. Nothing is kept at the token any more: what was is in crates set down beside it, or in its keeper\'s pack where there was no room.',
      'A young one follows its keeper when nothing else does; otherwise it goes into an empty crate in their pack, then into an empty crate of theirs standing on their settlement, the nearest its dam; with none of those it goes wild.',
      'Butchering is raised by butchering on an island as well as by yourself, and what comes off a carcass is made at your Butchering and your knife, the way every trade makes its work. The carcass\'s own quality no longer lowers it.',
      'A citizen may leave a settlement they were asked onto, from its menu on its land or from the Settlement window, and may found one of their own.',
      'The market board, in the Market window at a settlement token or a mailbox: every stall on the island, what is priced on it, where it stands and whose it is. A wildermon in its crate can be offered in a deal, sold off a stall or posted, and whoever the crate goes to keeps it.',
      `Leaderboards: the ${BOARD_TOP} highest in each skill, the ${BOARD_TOP} best-bred wildermon and the ${BOARD_TOP} biggest settlements on the island.`,
      'A young one\'s creature window names its dam and its sire, and says which of them each trait you can read came from.',
      `While you were away: coming back ashore, a window lists what your workers put into the stores, the young your wildermon had, what your stalls sold and the parcels posted to you, counted from ${IDLE_LOGOUT / 60} minutes after your browser was last heard from.`,
    ],
  },
  {
    n: 2,
    day: '2026-09-25',
    lines: () => {
      const caravel = furnitureDef('caravel'), sailer = furnitureDef('sailing_boat');
      return [
        `Walls cost more, to the scale of the cobblestone wall's ${wallBill('cobblestone')}: a log wall is ${wallBill('log')}, a plank wall ${wallBill('plank')}, a marble wall ${wallBill('marble')}. Floors, stairs, roofs and fences rise with their material. What was already planned keeps the bill it was planned with.`,
        `Furniture's planks, timber, cloth, stone bricks and mortar went up four times and its nails and metal ribbon twice; legs, wheels, ropes, castings and the other parts you count did not. A chest is ${pieceBill('chest')}.`,
        `A smelter is ${recipeBill('make_smelter')}, a kiln ${recipeBill('make_kiln')}, and an anvil is poured from ${MOULD_BY_ID.get('anvil_mould')?.lumps ?? 0} lumps. Traps went up the way furniture did.`,
        `A rowing boat is ${pieceBill('rowing_boat')}; a sailing boat ${pieceBill('sailing_boat')}.`,
        `The caravel, a third hull: ${pieceBill('caravel')}. She holds ${caravel.capacity} things, carries ${caravel.boat?.passengers} passengers as well as whoever has her helm, sails at ${caravel.boat?.speed} tiles a second against the sailing boat's ${sailer.boat?.speed}, and wants ${numberWord(caravel.boat?.draught ?? 0)} deep of water under her.`,
      ];
    },
  },
  {
    n: 3,
    day: '2026-09-25',
    lines: () => [
      'A padlock on a ship, a wagon or a cart: without its key nobody takes her helm or the reins, comes aboard, takes hold of the shafts or picks her up. Stepping ashore and getting down are never refused.',
      `Settings, Display: text and window size, from ${pct(UI_SIZE_MIN)} to ${pct(UI_SIZE_MAX)}. Every window, menu and bar and the writing in them; the island itself is not scaled.`,
      `A worker with nothing to do looks for work again after ${WORKER_REST_FIRST} seconds, a second later for every ${WORKER_REST_EVERY} it has stood idle, and never less often than every ${WORKER_REST_MOST} seconds.`,
      `Something that goes wrong in your browser is sent to the island, each different thing once and at most ${REPORTS_A_SESSION} a session, with the version of the game it happened in, so it can be found and fixed.`,
    ],
  },
  {
    n: 4,
    day: '2026-09-25',
    lines: () => [
      'People on a caravel are drawn among her sails: a sail nearer you than they are is drawn over them, and one further off behind them.',
      'A piece is clicked anywhere it is drawn, where that is bigger than the tile it stands on: a caravel at her bow and her stern.',
      `Buy orders, in the Market window at a settlement token or a mailbox: name a thing, the least quality that will do, how many and the silver for each, and the whole price is held out of your purse. Anybody else there can fill some or all of it from their pack and is paid at once; what they bring comes to you by the post. Take an order back whenever you like; one left open for ${ORDER_LIFE / 86400} days takes itself back, with what it still holds.`,
      `The Field guide (${defaultKey('win_guide')}): a page for each of the ${guidePages().length} kinds of creature, marking whether you have seen, tamed and bred it, where it lives and what it gives.`,
      'What\'s new: this window, opened as you come ashore when something has changed since you last read it, and from the UI Menu at any time.',
    ],
  },
  {
    n: 5,
    day: '2026-09-25',
    lines: () => [
      `Dying: your pack, what is in your hands, your toolbelt and every bag with what is in it go into a grave where you fell, or on the nearest dry ground within ${GRAVE_REACH} tiles if you fell in deep water. Only you can open it or take from it, and ${spanWords(GRAVE_KEEPS)} after you fell it crumbles with whatever is still in it. What you wear stays on you, and so does a crate with a wildermon in it.`,
      'Two payments out of one purse at the same moment no longer both go through: the second waits for the first, and is refused if what is left will not cover it.',
    ],
  },
  {
    n: 6,
    day: '2026-09-26',
    lines: () => [
      'An island has keepers: whoever founded it, and whoever keeps every island. A keeper sees everybody on the island, can move a body that is stuck to the token of the settlement it founded, or to where newcomers come ashore if it founded none, and can clear everything lying on a tile.',
      `A keeper can mute somebody ${either(MUTE_FOR.map((secs) => (secs === null ? 'until a keeper lifts it' : `for ${awayFor(secs)}`)))}. Until then the island refuses ${MUTE_SHUTS}, and says until when.`,
    ],
  },
  {
    n: 7,
    day: '2026-09-26',
    lines: () => {
      const shine = RARITIES.slice(1).map((r) => r.name);
      return [
        `What you wear and hold is drawn on you, on everybody else and on you as they see you: each of the ${ARMOUR.length} pieces of armour, ${WEAPONS.length} weapons, ${Object.keys(SHIELDS).length} shields, the toolbelt and the ${JEWEL_PIECES.length} jewels is a model of its own, in the metal, wood or stone it was made of and the colour it was dyed, and any of them can be worn with any other.`,
        'A weapon is held in the hand, a bow in the other and a shield on the arm.',
        `${either(shine).replace(/^./, (c) => c.toUpperCase())} things shine where they are worn, each in its own colour: a glint crosses everything of one rarity together, a ${shine[1]} one's colour comes and goes, and a ${shine[2]} one sparkles.`,
      ];
    },
  },
  {
    n: 8,
    day: '2026-09-26',
    lines: () => {
      const shine = RARITIES.slice(1).map((r) => r.name);
      // The weapons each way, named as the figure draws them.
      const held = (pick: (c: { carry: string; stow: string }) => boolean): string =>
        either(WEAPONS.filter((w) => { const c = weaponCarry(w.id); return !!c && pick(c); }).map((w) => itemDef(w.id).name.toLowerCase()));
      return [
        `A ${held((c) => c.carry === 'shoulder')} is carried over your shoulder.`,
        `While you work, swim, hold the reins, wave or hop, what you hold is put away: a ${held((c) => c.stow === 'hip')} into its scabbard at your left hip, a ${held((c) => c.stow === 'belt')} through your belt at the right, and anything else across your back on a strap, with a shield over it.`,
        `A ${either(shine)} piece is edged in its colour on the side away from the light, and whatever is worn over it covers its shine as well as the piece.`,
      ];
    },
  },
  {
    n: 9,
    day: '2026-09-26',
    lines: () => {
      const carried = (how: string): string[] => WEAPONS.filter((w) => weaponCarry(w.id)?.carry === how).map((w) => itemDef(w.id).name.toLowerCase());
      const shouldered = carried('shoulder');
      return [
        'Each class of armour has an outline of its own: cloth is padded to the knee and split for the stride, leather has a tall collar, shoulder caps and a skirt in four flared panels, mail is split front and back, and dragon scale lies in overlapping courses from the head to the feet.',
        `A ${either(shouldered)} goes over whichever shoulder keeps it clear of your head from where you are seen. A bow is held upright at your side, higher the longer it is and higher again at a run, so its lower tip never reaches the ground, and a ${either(carried('staff'))} leans out past your face.`,
      ];
    },
  },
  {
    n: 10,
    day: '2026-09-26',
    lines: () => {
      const shine = RARITIES.slice(1).map((r) => r.name);
      const carried = (how: string): string[] => WEAPONS.filter((w) => weaponCarry(w.id)?.carry === how).map((w) => itemDef(w.id).name.toLowerCase());
      return [
        `A ${either(carried('fist'))} in your hand turns out to your side wherever it would otherwise point at whoever is looking or hide behind you, so it shows from every side. A ${either(['bow', ...carried('staff')])} leans back rather than forward where forward would cross your head, and a ${either(carried('shoulder'))} is carried more upright seen from behind.`,
        `A ${either(shine)} piece keeps its own metal, wood or dye: its rarity's colour is in the line along its edges, the glint that crosses it and the stars, and nowhere else.`,
        'Mail is drawn as rows of rings and dragon scale as overlapping scales at the size the island is played at. Cloth and leather show a lit side and a shaded side as the body does, and a cap, a coat and breeches of one dye are each a step lighter or darker.',
        'The toolbelt carries a claw hammer behind your left hip and a pocket of chisel and awl handles at your right.',
      ];
    },
  },
  {
    n: 11,
    day: '2026-09-26',
    lines: () => {
      const shine = RARITIES.slice(1).map((r) => r.name);
      const named = (id: string): string => itemDef(id).name.toLowerCase();
      const knives = WEAPONS.filter((w) => weaponCarry(w.id)?.front).map((w) => named(w.id));
      return [
        `Your hair shows below the rim of a ${either(['wool_cap', 'leather_cap', 'helm', 'scale_helm'].map(named))}, and long hair hangs down below a ${named('wool_cap')} or a ${named('leather_cap')} as it is cut. A ${named('chain_coif')} covers all of it.`,
        `A ${either(knives)} is put away upright at the front of your belt, right of the buckle, rather than at your hip.`,
        `The ${named('hatchet')} has a square bit with a hammer's poll behind it, the ${named('throwing_axe')} a head sweeping up above a haft bowed toward it, the ${named('javelin')} vanes at its tail and the ${named('carving_knife')} a guard for the fingers. A ${named('chain_hauberk')} hangs longer and flares out past the hips.`,
        `Dragon scale's scales end in a broad U rather than a point, each hanging over the course below. A ${either(shine)} piece of it shows its colour on the lit tips of its scales rather than in a line round its edge.`,
      ];
    },
  },
  {
    n: 12,
    day: '2026-09-26',
    lines: () => {
      const shine = RARITIES.slice(1).map((r) => r.name);
      const named = (id: string): string => itemDef(id).name.toLowerCase();
      return [
        `Under a ${either(['wool_cap', 'leather_cap', 'helm', 'scale_helm'].map(named))} your hair is cut off at the rim: what shows is what hangs below it, and none of it through the crown. The ${named('helm')} and the ${named('scale_helm')} stand clear of the hair, with a guard over the back of the neck, and the ${named('leather_cap')} is sewn from four panels of a darker, redder hide than the coat.`,
        `A ${either(shine)} piece shows its colour as a sheen over the side of it the light falls on, rather than as a line round its edges. Its glint crosses it nearly all the time instead of most of it, and a ${shine[2]} one's glint is paler and its stars bigger.`,
        `A ${named('maul')} is slung head up; a ${named('spear')} or ${named('javelin')} is slung higher, so its butt is off the ground; a ${named('throwing_axe')} leans out from the belt, so its haft shows; and a sword in its scabbard hangs out from the leg, where it can be seen from the front.`,
        "Dragon scale's lower edges are pale where the light is on them and a mid green where it is not, instead of a dark line under every course.",
      ];
    },
  },
  {
    n: 13,
    day: '2026-09-26',
    lines: () => {
      const named = (id: string): string => itemDef(id).name.toLowerCase();
      return [
        `A ${named('leather_jerkin')} is studded with rivets over the chest and down its skirt.`,
        `A ${named('chain_hauberk')} bells out wider below the hips, and every skirt swings out wider the longer the stride.`,
      ];
    },
  },
  {
    n: 14,
    day: '2026-09-26',
    lines: () => {
      const shine = RARITIES.slice(1).map((r) => r.name);
      const named = (id: string): string => itemDef(id).name.toLowerCase();
      const onBack = WEAPONS.filter((w) => weaponCarry(w.id)?.stow === 'back').map((w) => named(w.id));
      const bows = WEAPONS.filter((w) => weaponCarry(w.id)?.carry === 'bow').map((w) => named(w.id));
      return [
        `A ${either(onBack)} put away on your back goes up over whichever shoulder shows it from where you are seen, with an axe's bit and a bow's bend turned to face you. A ${named('battle_axe')} or ${named('maul')} carried on the shoulder rises back over it, its head above and behind.`,
        `A ${either(bows)} is held upright at your side with its lower tip clear of your boots.`,
        `A ${named('chain_coif')} closes under the chin and over the ears, leaving the face framed in mail.`,
        `A ${shine[2]} piece's sheen is gold, and its glint gold rather than white. The colour of any ${either(shine)} piece goes under the rings of mail and the edges of scale rather than over them, and none of it goes on a thin rim.`,
        `Leather is lighter in colour. A ${named('leather_jerkin')} has a strap and buckle across the chest, stitching down the front and a pale collar and shoulders; a ${named('leather_cap')} has a rolled rim, seams from the rim to the crown and narrower ear flaps.`,
        `The ${named('hatchet')} has a bearded bit, and put away it and the ${named('throwing_axe')} turn their blades out from the hip. The ${named('butchering_knife')} has a broad sheath, scabbards are dark leather, and seated, a sword's lies back along the seat. A ${named('jewelled_ring')} is a band on one finger.`,
        `Plate arms have one domed plate over two lames at the shoulder, a ${named('helm')}'s cheek plates curve round the jaw, and a ${named('scale_helm')}'s spines are fins. Long hair narrows in under a cap or helm.`,
      ];
    },
  },
  {
    n: 15,
    day: '2026-09-26',
    lines: () => {
      const named = (id: string): string => itemDef(id).name.toLowerCase();
      return [
        `Dragon scale is laid in fewer, larger scales, mail's rows of rings are further apart, and a ${named('chain_hauberk')} flares wider below the hips.`,
        `A ${either(Object.keys(SHIELDS).map(named))} is thicker at the rim, so seen edge on it is a band rather than a line. A blade in full light is pale steel rather than white, and bare arms are outlined as darkly as armour is.`,
      ];
    },
  },
  {
    n: 16,
    day: '2026-09-26',
    lines: () => {
      const named = (id: string): string => itemDef(id).name.toLowerCase();
      return [
        `Filling, emptying or pouring out one ${named('bucket')} of several you got at once takes that one off the pile, in your pack or the same bag. It used to do nothing, and filling still drew the water out of the well or barrel.`,
      ];
    },
  },
  {
    n: 17,
    day: '2026-09-26',
    lines: () => {
      const shine = RARITIES.slice(1).map((r) => r.name);
      const named = (id: string): string => itemDef(id).name.toLowerCase();
      const bows = WEAPONS.filter((w) => weaponCarry(w.id)?.carry === 'bow').map((w) => named(w.id));
      const shouldered = WEAPONS.filter((w) => weaponCarry(w.id)?.carry === 'shoulder').map((w) => named(w.id));
      const slungHeavy = WEAPONS.filter((w) => { const c = weaponCarry(w.id); return c?.carry === 'shoulder' && c.stow === 'back' && c.headUp; }).map((w) => named(w.id));
      const slungPoles = WEAPONS.filter((w) => weaponCarry(w.id)?.carry === 'staff' && weaponCarry(w.id)?.stow === 'back').map((w) => named(w.id));
      return [
        `A ${either(shine)} piece is its rarity's colour over the whole of its lit side, wood and leather as well as metal, and keeps it between glints.`,
        `A ${either(bows)} is held out past the hip, where it shows from every side, and turned so its bend shows rather than its edge.`,
        `Seen from behind, a ${either(shouldered)} carried on the shoulder rises from behind it, its haft showing under an axe's or a maul's head, and the arm that carries it goes round the far side of the body.`,
        `While you work, a ${either(slungHeavy)} on your back hangs head down, and a ${either(slungPoles)} hangs lower, clear of the hammer.`,
        `Leather is red-brown, apart from the colour of skin, with a sheen on its lit side. The knee pads on ${named('leather_trousers')} are flat and darker.`,
        `${itemDef('cloth_sleeves').name} run into the coat at the shoulder and bend at the elbow without a joint showing. A ${named('cloth_tunic')}'s collar, hem and cuffs are faced in a lighter shade of its cloth.`,
        `A ${named('helm')}'s cheek plates narrow toward the chin and its neck guard flares; a ${named('scale_helm')} has a crest of splayed fins and cheek plates of scale. Long hair under a cap or helm is drawn in at the nape and falls in locks.`,
        `A ${named('chain_coif')}'s face opening narrows at the chin and is cut back at the cheek, so the face shows side on.`,
        `The hammer on a ${named('toolbelt')} hangs head down from a loop with its handle above the belt; a ${named('jewelled_ring')} shows a point of gold from every side; a ${named('wooden_shield')} has weathered boards and a dark rawhide rim; a ${named('chain_hauberk')}'s skirt flies out behind at a run; and an axe through the belt shows its blade from three-quarters on.`,
      ];
    },
  },
  {
    n: 18,
    day: '2026-09-26',
    lines: () => {
      const shine = RARITIES.slice(1).map((r) => r.name);
      const named = (id: string): string => itemDef(id).name.toLowerCase();
      return [
        `A ${either(shine)} piece is tinted its rarity's colour all over, on the side turned from the light as well as the lit side, and still shows what it is made of; the line round it is a dark of that colour.`,
        `Dragon scale is laid in courses of overlapping scales, its edges cut in points at the shoulders, elbows, knees, hem and boot tops, and its gauntlets are of the dark scale.`,
        `${itemDef('chain_sleeves').name} flare over the back of the hand and ${named('chain_leggings')} hang over the knee in ragged points; a ${named('chain_hauberk')}'s hem is a band of bright rings of its own metal.`,
        `Leather is a browner red, and dyed leather keeps the colour of its dye. ${itemDef('leather_sleeves').name} have no knob at the elbow. The pieces of a cloth or leather suit step further apart in shade from cap to shoes, and quilting is in wider channels. Copper is warmer, with pale edges and a green shadow.`,
        `Whatever is slung on your back hangs from a strap over the same shoulder, and while you work left-handed both are on the other shoulder. A ${named('long_bow')} is longer, and held further out in front at a run; a ${named('throwing_axe')} is held head up.`,
        `A ${named('chain_coif')}'s face opening comes to a point under the chin; a ${named('scale_helm')}'s fins stand on its crown; long hair under a cap or helm falls as one curtain.`,
      ];
    },
  },
  {
    n: 19,
    day: '2026-09-26',
    lines: () => [
      'Climbing is kept. It went up as you walked and then back to where the island had it at its next update or when you reloaded, because only your browser was raising it; the island raises it now.',
      `A step between tiles of more than ${share(CLIMB_LEARN_FROM)} of ${MAX_STEP} up or down trains it on your own feet only: not in a saddle, on a cart or a boat, on a bridge or on an upper floor.`,
    ],
  },
  {
    n: 20,
    day: '2026-09-26',
    lines: () => [
      'An altar is a coursed stone pedestal with the gold sun in its face and a gold dish on top. Over the dish a figure of stars joined by lines turns, with a ring of light round it, and at night the stars shine through the dark.',
    ],
  },
  {
    n: 21,
    day: '2026-09-26',
    lines: () => [
      'An altar can only be built while you stand on a settlement of yours: one you founded or one you are a citizen of.',
    ],
  },
  {
    n: 22,
    day: '2026-09-26',
    lines: () => [
      'An altar can only be set down on a settlement of yours as well. Altars already standing elsewhere stay where they are.',
    ],
  },
  {
    n: 23,
    day: '2026-09-26',
    lines: () => [
      `Baubles: ${percent(BAUBLE_SHARE)} of what archaeology turns up is now a tarnished bauble, ${listed(BAUBLE_TIERS.map((t) => `${percent(t.odds)} ${t.name.toLowerCase()}`))}. Restore it as you would a relic, and what it gives is rolled and written on it.`,
      `Set it into an altar on a settlement of yours, from Baubles on the altar's menu. A settlement has ${listed(BAUBLE_TIERS.map((t) => `${numberWord(t.slots)} ${t.name.toLowerCase()}`))} sockets, and its founder, mayors and builders get what is in them on every action they do on its land.`,
      `Minor: ${BAUBLE_LOW} to ${BAUBLE_HIGH}% less time per action, or ${BAUBLE_LOW} to ${BAUBLE_HIGH}% more skill gained, in one skill. Major: a ${BAUBLE_LOW} to ${BAUBLE_HIGH}% chance of ${times(YIELD_TIMES)} the yield of each action in one skill. Ancient: +${ANCIENT_PLUS} to every yield of one action, such as ${ANCIENT_EFFECTS[1].said}.`,
      `Rarity multiplies what it rolled: ${listed(RARITIES.slice(1).map((r, i) => `${times(baubleTimes(i + 1))} for ${article(r.name)} ${r.name} one`))}.`,
      'A bauble set into an altar stays there. Another can take its socket, and the one it replaces is destroyed.',
    ],
  },
  {
    n: 24,
    day: '2026-09-26',
    lines: () => [
      'A settlement has one altar. A second cannot be built or set down on a settlement that already has one standing; turning the one that stands still works.',
      'A settlement that already had more than one keeps them, but it cannot get another. Its bauble sockets were always the settlement\'s, so an altar picked up and set down again keeps what is set in it.',
    ],
  },
  {
    n: 25,
    day: '2026-09-26',
    lines: () => [
      `An altar no longer takes a gold lump. It takes ${billWords(furnitureDef('altar').bill)}.`,
    ],
  },
  {
    n: 26,
    day: '2026-09-26',
    lines: () => [
      `Sacrifice, on an altar's menu, gives up one rare, supreme or fantastic thing from your pack. ${FED_SAID}`,
      `${percent(MOTE_CHANCE)} of sacrifices leave a mote of the same rarity. Absorb it into an ordinary thing in your pack (Absorb into, on the mote) and that thing takes the mote's rarity.`,
    ],
  },
  {
    n: 27,
    day: '2026-09-26',
    lines: () => [
      `A Bauble of Regret is ${percent(REGRET_SHARE)} of what archaeology turns up, whole. A tarnished bauble is still ${percent(BAUBLE_SHARE)}.`,
      `With one in your pack, Undo on a trade you hold in the Trades window breaks the bauble and puts that trade down with the nodes you bought or the perks you took for it. The next trade you take up in that slot costs nothing, where a change costs ${CLASS_CHANGE_COST} silver.`,
    ],
  },
  {
    n: 28,
    day: '2026-09-27',
    lines: () => {
      const main = (CLASSES.find((c) => c.id === 'terraformer')?.main ?? '').replace(/_/g, ' ');
      return [
        `The Terraformer has perks instead of a tree: ${numberWord(PERK_TIER_AT.length)} tiers of ${numberWord(PERKS_PER_TIER)}. The first tier opens with the trade and the others at ${listed(PERK_TIER_AT.slice(1).map(String))} in ${main}, and at each tier you take one of the ${numberWord(PERKS_PER_TIER)} in the Trades window, where every card says what it changes and by how much.`,
        'The nodes a Terraformer had bought went with the tree. Putting the trade down, for silver or with a Bauble of Regret, takes its perks with it the same way.',
      ];
    },
  },
  {
    n: 29,
    day: '2026-09-27',
    lines: () => {
      const main = (CLASSES.find((c) => c.id === 'miner')?.main ?? '').replace(/_/g, ' ');
      return [
        `The Miner has perks instead of a tree too: ${numberWord(PERK_TIER_AT.length)} tiers of ${numberWord(PERKS_PER_TIER)}, the first with the trade and the others at ${listed(PERK_TIER_AT.slice(1).map(String))} in ${main}. Among them a new job, Pan, on sand with water at a corner.`,
        'The nodes a Miner had bought went with the tree.',
      ];
    },
  },
  {
    n: 30,
    day: '2026-09-27',
    lines: () => [
      'The Terraformer’s perks are set out in their final tiers. A perk you had taken that moved to another tier is cleared, and yours to choose again in the Trades window; the Wader and the Dredger stayed where they were.',
    ],
  },
  {
    n: 31,
    day: '2026-09-27',
    lines: () => [
      'The Miner’s perks are set out in their final tiers too. A perk you had taken that moved is cleared, and yours to choose again in the Trades window; only Pan stayed where it was.',
    ],
  },
  {
    n: 32,
    day: '2026-09-27',
    lines: () => {
      const main = (CLASSES.find((c) => c.id === 'mason')?.main ?? '').replace(/_/g, ' ');
      return [
        `The Mason has perks instead of a tree now: ${numberWord(PERK_TIER_AT.length)} tiers of ${numberWord(PERKS_PER_TIER)}, the first with the trade and the others at ${listed(PERK_TIER_AT.slice(1).map(String))} in ${main}. Among them two new jobs, Repoint, which lays a finished stone wall again in another stone, and Raise the rock with rubble.`,
        'The nodes a Mason had bought went with the tree.',
      ];
    },
  },
  {
    n: 33,
    day: '2026-09-27',
    lines: () => [
      `Every card in the Trades window has What it offers: the trade’s ${numberWord(PERK_TIER_AT.length)} tiers of perks, or its rite and its tree, laid out before you take it up, with the skill each tier opens at and what you have. Playing by yourself, the window shows the same for every trade.`,
      'Taking up a trade and taking a perk now ask a second time, saying what goes, what it costs and which perks close.',
    ],
  },
  {
    n: 34,
    day: '2026-09-27',
    lines: () => {
      const main = (CLASSES.find((c) => c.id === 'carpenter')?.main ?? '').replace(/_/g, ' ');
      return [
        `The Carpenter has perks instead of a tree now: ${numberWord(PERK_TIER_AT.length)} tiers of ${numberWord(PERKS_PER_TIER)}, the first with the trade and the others at ${listed(PERK_TIER_AT.slice(1).map(String))} in ${main}. The nodes a Carpenter had bought went with the tree.`,
        'Some of them go into what a Carpenter makes and stay there: a chest that holds more, a boat or a wagon that goes faster, a bow that hits harder or reaches further, whoever owns it after. Examine a thing to see what its maker put into it.',
        'On an island the bench now wears its tool with every go, as it always did playing by yourself: saws, carving knives, mallets, files and the rest.',
      ];
    },
  },
  {
    n: 35,
    day: '2026-09-27',
    lines: () => {
      const barrel = (material: string): number =>
        liquidCapacity({ id: 0, x: 0, y: 0, sx: 0, sy: 0, kind: 'barrel', ql: 20, items: [], material } as PlacedFurniture);
      return [
        `On an island a barrel holds what its wood holds, as the barrel always said: ${barrel('Oak')} litres of oak and ${barrel('Pine')} of pine where every barrel held ${furnitureDef('barrel').liquid}. A barrel already fuller than its wood allows keeps what is in it and takes no more until it is drawn below the line.`,
        'And a few other pieces hold one more or one less than they did, mostly rare ones and ones of pine, willow or fig: what the island lets in is now exactly the number the window shows.',
      ];
    },
  },
  {
    n: 36,
    day: '2026-09-27',
    lines: () => {
      const main = (CLASSES.find((c) => c.id === 'smith')?.main ?? '').replace(/_/g, ' ');
      const hauberk = { uid: 0, id: 'chain_hauberk', ql: 50, dmg: 0, count: 1, extra: 'Iron' } as Item;
      return [
        `The Smith has perks instead of a tree now: ${numberWord(PERK_TIER_AT.length)} tiers of ${numberWord(PERKS_PER_TIER)}, the first with the trade and the others at ${listed(PERK_TIER_AT.slice(1).map(String))} in ${main}. The nodes a Smith had bought went with the tree.`,
        'Some of them go into what a Smith beats out and stay there: a blade that hits harder or lands more often goes into the weapon whoever fits it, chain and plate that turn aside more, a mould that lasts longer, and a weapon or tool that can be quenched once for more quality. Examine a thing to see what its maker put into it.',
        `A Smith with Ingots pours ${INGOT_LUMPS} lumps into a bar that weighs ${share(INGOT_WEIGHT)} what they did and counts as all ${numberWord(INGOT_LUMPS)} at the smelter, the anvil, the bench and the file.`,
        `And melting down takes a half up on an island as it always did playing alone: a chain hauberk gives back ${meltLumps(hauberk, 1)} lumps, not one fewer.`,
      ];
    },
  },
  {
    n: 37,
    day: '2026-09-27',
    lines: () => {
      const main = (CLASSES.find((c) => c.id === 'forester')?.main ?? '').replace(/_/g, ' ');
      return [
        `The Forester has perks instead of a tree now: ${numberWord(PERK_TIER_AT.length)} tiers of ${numberWord(PERKS_PER_TIER)}, the first with the trade and the others at ${listed(PERK_TIER_AT.slice(1).map(String))} in ${main}. The nodes a Forester had bought went with the tree.`,
        'Three of them are new jobs: Coppice cuts a grown tree back to young for its logs and leaves it standing, Tap Resin takes tar from a living pine once a day, and Clear Brush clears the bushes and reeds around a tile in one go.',
        'And Look on a tree with strokes in it counts them as you would fell it, for a Forester who fells in fewer.',
      ];
    },
  },
  {
    n: 38,
    day: '2026-09-27',
    lines: () => {
      const main = (CLASSES.find((c) => c.id === 'farmer')?.main ?? '').replace(/_/g, ' ');
      return [
        `The Farmer has perks instead of a tree now: ${numberWord(PERK_TIER_AT.length)} tiers of ${numberWord(PERKS_PER_TIER)}, the first with the trade and the others at ${listed(PERK_TIER_AT.slice(1).map(String))} in ${main}. The nodes a Farmer had bought went with the tree.`,
        'Three of them are new jobs: Sow a patch, Tend a patch and Harvest a patch work every field in the square around the one you choose as one job.',
        'A crop keeps the pace it was sown at, so a field a Farmer sowed faster grows faster whoever harvests it.',
        'And a wildermon set to farm brings home the harvest and leaves the seed in the furrow. It had them the wrong way round on an island.',
      ];
    },
  },
  {
    n: 39,
    day: '2026-09-27',
    lines: () => {
      const main = (CLASSES.find((c) => c.id === 'cook')?.main ?? '').replace(/_/g, ' ');
      return [
        `The Cook has perks instead of a tree now: ${numberWord(PERK_TIER_AT.length)} tiers of ${numberWord(PERKS_PER_TIER)}, the first with the trade and the others at ${listed(PERK_TIER_AT.slice(1).map(String))} in ${main}. The nodes a Cook had bought went with the tree.`,
        'What a Cook puts into a dish stays with it whoever eats it, and examining a thing on an island now says what its maker put into it, as it always did offline.',
        'Two new things to make, broth and spirit, and a new bait, offal, for a Cook who has learned them.',
        'And part of a pile set down on an island keeps what the pile had: its maker\'s marks, its rarity, its colour and its blessing.',
      ];
    },
  },
  {
    n: 40,
    day: '2026-09-27',
    lines: () => {
      const main = (CLASSES.find((c) => c.id === 'tailor')?.main ?? '').replace(/_/g, ' ');
      const tent = furnitureDef('tent');
      const mends = perksOf('tailor').find((p) => p.fx.patch_item)?.fx.patch_item ?? 0;
      const sprouts = perksOf('forester').find((p) => p.fx['count:sprout']);
      return [
        `The Tailor has perks instead of a tree now: ${numberWord(PERK_TIER_AT.length)} tiers of ${numberWord(PERKS_PER_TIER)}, the first with the trade and the others at ${listed(PERK_TIER_AT.slice(1).map(String))} in ${main}. The nodes a Tailor had bought went with the tree.`,
        `Two new things for a Tailor who has learned them: a tent (${billWords(tent.bill, false)}), a night in which rests you ${percent((tent.bed ?? 0) / (furnitureDef('bed').bed ?? 1))} as well as a night in a bed, `
          + `and Patch, which takes ${mends} damage off a cloth or leather piece for one cloth or one leather.`,
        'Offline, every perk that makes a job fail less often now works as it does on an island, where before only the anvil\'s did; and so does Nothing Wasted, which keeps what a failed craft used.',
        ...(sprouts ? [`Offline, ${sprouts.name} gives its ${numberWord(sprouts.fx['count:sprout'])} sprouts, as it does on an island.`] : []),
        'Offline, a go that makes more than its recipe says now says how many it made, as it did on an island.',
      ];
    },
  },
  {
    n: 41,
    day: '2026-09-27',
    lines: () => {
      const main = (CLASSES.find((c) => c.id === 'herdsman')?.main ?? '').replace(/_/g, ' ');
      const kept = perksOf('herdsman').filter((p) => Object.keys(p.fx).some((k) => k.startsWith('kept:'))).map((p) => p.name);
      return [
        `The Herdsman has perks instead of a tree now: ${numberWord(PERK_TIER_AT.length)} tiers of ${numberWord(PERKS_PER_TIER)}, the first with the trade and the others at ${listed(PERK_TIER_AT.slice(1).map(String))} in ${main}. The nodes a Herdsman had bought went with the tree.`,
        `${listed(HUSBANDRY_ACTIONS.map((a) => a.label))} are on a wildermon's menu now. The rules had them and no menu offered them.`,
        `${listed(kept)} work on every wildermon their Herdsman keeps, on an island and off it. One that changes hands takes its new keeper's.`,
      ];
    },
  },
  {
    n: 42,
    day: '2026-09-27',
    lines: () => {
      const main = (CLASSES.find((c) => c.id === 'naturalist')?.main ?? '').replace(/_/g, ' ');
      return [
        `The Naturalist has perks instead of a tree now: ${numberWord(PERK_TIER_AT.length)} tiers of ${numberWord(PERKS_PER_TIER)}, the first with the trade and the others at ${listed(PERK_TIER_AT.slice(1).map(String))} in ${main}. The nodes a Naturalist had bought went with the tree.`,
        `Three new things for a Naturalist who has learned them, and for anybody to use: herb tea, a cup of which puts back ${percent(itemDef('herb_tea').stamina ?? 0)} of your stamina; `
          + `a salve, which keeps a dressed wound from going bad; and a tincture, which makes ${TINCTURE_NAMES} each go in ${percent(TINCTURE_BONUS)} faster for ${spanWords(TINCTURE_SECONDS)}.`,
        'A Naturalist with Field Medic can dress somebody else\'s wounds, from that person\'s menu.',
        'On an island a hive now fills with honey and beeswax for the Vesp kept on its settlement, as it always did offline. Nothing on an island gave beeswax before.',
        'Offline, a rare thing made at a bench no longer makes the whole pile it goes onto rare.',
      ];
    },
  },
  {
    n: 43,
    day: '2026-09-27',
    lines: () => {
      const main = (CLASSES.find((c) => c.id === 'fisher')?.main ?? '').replace(/_/g, ' ');
      const smoked = perksOf('fisher').find((p) => p.name === 'Smoke Fish')?.fx['rot:trout'] ?? 1;
      return [
        `The Fisher has perks instead of a tree now: ${numberWord(PERK_TIER_AT.length)} tiers of ${numberWord(PERKS_PER_TIER)}, the first with the trade and the others at ${listed(PERK_TIER_AT.slice(1).map(String))} in ${main}. The nodes a Fisher had bought went with the tree.`,
        `New for a Fisher who has learned them: smoked fish, which rot ${percent(1 - smoked)} slower wherever they are left; a fish pond, set down on your settlement, `
          + `which stocks itself at a fish in ${spanWords(POND_EVERY)} until it holds ${furnitureDef('fish_pond').pond}; and a Fishing Journal, which says what the water holds for you when you examine it.`,
        'A net clicked on water out of its reach goes into the deepest water within the whole tiles of its reach, as a line does. On an island it used to look further round you than offline.',
        'Offline a rod, a net and a spadeful turned for worms wore their tool as much again on top of their own wear; they wear as they do on an island now.',
        'Offline a net let the deep fish in all together or not at all; each deep fish in a haul is its own chance now, as on an island.',
      ];
    },
  },
  {
    n: 44,
    day: '2026-09-27',
    lines: () => {
      const main = (CLASSES.find((c) => c.id === 'mender')?.main ?? '').replace(/_/g, ' ');
      return [
        `The Mender has perks instead of a tree now: ${numberWord(PERK_TIER_AT.length)} tiers of ${numberWord(PERKS_PER_TIER)}, the first with the trade and the others at ${listed(PERK_TIER_AT.slice(1).map(String))} in ${main}. The nodes a Mender had bought went with the tree.`,
        `New for a Mender who has learned them, and for anybody to use: a repair kit, which takes ${KIT_MEND} damage off anything, anywhere, and none of its quality; and sealant, which stops a thing decaying wherever it is left, one to a thing.`,
        'A perk that takes time off a job takes it off after the shortest time a job may take, where it had taken it off before: it is what it says at any skill now, and a go of Repair, which is always that short, takes less for a Mender\'s Quick Hands.',
        `On an island the roughest work post stands ${spanWords(POST_LIFE_MIN)} now, as it does offline; it had fallen over in well under half that.`,
        'Offline, brushing a wildermon wears the brush by its quality, as on an island, where it had taken a sliver off whatever the brush.',
        `A hammer: a head cast in a hammer head mould at a smelter, beaten true on an anvil and fitted to a shaft. There had been none, so nothing that asks for one could be made; `
          + `${listed(RECIPES.filter((r) => r.tool === 'hammer').map((r) => itemDef(r.result).name.toLowerCase()))} can be now.`,
      ];
    },
  },
  {
    n: 45,
    day: '2026-09-27',
    lines: () => {
      const main = (CLASSES.find((c) => c.id === 'artisan')?.main ?? '').replace(/_/g, ' ');
      const wheel = furnitureDef('potters_wheel').pace;
      const more = GEMS.filter((g) => g.perk);
      return [
        `The Artisan has perks instead of a tree now: ${numberWord(PERK_TIER_AT.length)} tiers of ${numberWord(PERKS_PER_TIER)}, the first with the trade and the others at ${listed(PERK_TIER_AT.slice(1).map(String))} in ${main}. The nodes an Artisan had bought went with the tree, and no craft trade has a tree now.`,
        `New for an Artisan who has learned them: a gold circlet, worn on the head, that takes ${numberWord(CIRCLET_STONES)} stones at ${share(CIRCLET_SHARE)} of a ring's each, set by anybody; an amphora, which holds ${itemDef('amphora').holds} of one food or drink; a potter's wheel, which takes ${percent(1 - (wheel?.by ?? 1))} off a go at pottery for anybody within ${wheel?.reach} tiles of it; a glaze of ${numberWord(GLAZE_ASH)} lot of ashes, after which a pot never decays; and a book on any craft trade the writer has ${TRADE_BOOK_AT} of, which teaches that trade.`,
        `${NumberWord(more.length)} more stones in the rock for an Artisan with More Stones: ${listed(more.map((g) => g.name.toLowerCase()))}.`,
        'Jewellery is a heading in the crafting window: a ring, a pendant and a focus had only been set from the stone\'s own menu.',
        'A pot, a bowl or a jar keeps what its maker put into it through the kiln, where the fire had dropped it.',
        'On an island, what is in a bag left lying about rots at the share of the weather the bag keeps off, as it always has offline, where it had not rotted at all; and a thing set down is not charged for the time it spent in a pack.',
      ];
    },
  },
  {
    n: 46,
    day: '2026-09-27',
    lines: () => [
      `On an island, restoring a relic or a bauble raises Restoration: a whole go when it comes off and ${percent(TRY_LEARN)} of one when it does not, as offline. It had raised only Mind Logic, so Restoration stood where it started however much you restored.`,
    ],
  },
  {
    n: 47,
    day: '2026-09-27',
    lines: () => [
      `On an island, the Wildermon window lists the wildermon you have tamed and nobody else's. It had listed every tame one near you, so somebody new was shown their neighbours' before taming any. "${ALL_GOALS.find((g) => g.id === 'five')?.text}", the wildermon you can set to a post and your herd's best tier had counted the same way, and count only yours now.`,
    ],
  },
  {
    n: 48,
    day: '2026-09-27',
    lines: () => {
      const kinds = ['rabba', 'woola', 'noot', 'seavic', 'vola', 'dowse', 'cudda', 'bura', 'sappa', 'cobbe', 'quarra', 'embra', 'bogga', 'wadd', 'holla', 'middun', 'sedra', 'warda', 'quill', 'lume'];
      return [
        `${NumberWord(kinds.length)} wildermon are drawn as models, each animated standing, walking, running and foraging: ${listed(kinds.map((k) => SPECIES[k]?.name ?? k))}. The rest are drawn as they were until theirs are done.`,
        'One drawn as a model is clicked anywhere on it, its head as well as its feet, and its name and health sit over the top of it.',
      ];
    },
  },
  {
    n: 49,
    day: '2026-09-27',
    lines: () => {
      const steps = RARITIES.map((_, s) => s).slice(1);
      const name = (s: number): string => RARITIES[s].name;
      // A step's figure against each of the three, the first saying what it is for.
      const each = (fig: (s: number) => string): string =>
        listed(steps.map((s, i) => `${fig(s)} for ${i === 0 ? `${article(name(s))} ${name(s)} one` : `${article(name(s))} ${name(s)}`}`));
      // How far a multiplier moves a figure, as a card rounds it (`cardPct`), without its sign.
      const by = (m: number): string => cardPct(m).slice(1);
      // How much of what a wild roll gives it comes out better than common.
      const better = (s: number): string => {
        const n = Math.round(100 * betterThanCommon(husbandryOdds(0, s)));
        return n === 100 ? 'all' : `${n}%`;
      };
      const up = CHANNELS.filter((ch) => ch.up).map((ch) => ch.label);
      const down = CHANNELS.filter((ch) => !ch.up).map((ch) => ch.label);
      return [
        `A wildermon can come into the world rare, at the odds a made thing has: ${listed(steps.map((s) => `one in ${numberWord(Math.round(1 / rarityChance(s)))} ${name(s)}`))}. A monster never does, and a young one is rolled for as it is born, whatever its parents were.`,
        `${capital(article(name(1)))} ${name(1)} one is ${times(RARITIES[1].size)} the size of its kind, ${listed(steps.slice(1).map((s) => `${article(name(s))} ${name(s)} one ${times(RARITIES[s].size)}`))}.`,
        `Its ${listed(up)} go up by ${each((s) => by(RARITIES[s].blood))}, and its ${listed(down)} go down by ${each((s) => by(1 / RARITIES[s].blood))}.`,
        `One out of the wild rolls its traits on better odds: ${listed(steps.map((s) => `${better(s)} of ${article(name(s))} ${name(s)} one's`))} come out better than common, where ${better(0)} of an ordinary one's do.`,
        'The whole beast shimmers in its rarity\'s colour the way rare gear does, and its card, the Wildermon window and Look it over say how rare it is and what that does.',
      ];
    },
  },
  {
    n: 50,
    day: '2026-09-27',
    lines: () => {
      // The youngest a tree is with timber in it, along the stages it grows through from the first.
      let age = TREE_AGES.find((a) => !TREE_AGES.some((b) => b.next === a.id));
      while (age && !age.logs && age.next !== null) age = TREE_AGES.find((a) => a.id === age?.next);
      return [
        `A tree that dies of age leaves grass where it stood, not a stump. A stump is only left by felling a tree with timber in it, ${(age?.name ?? 'Young').toLowerCase()} or older.`,
        `Every stump goes at the next turn of the woods, at ${TREE_DAWN_UTC}:00 UTC, and goes for everybody: one you had seen stayed in your view until you next loaded the island.`,
      ];
    },
  },
  {
    n: 51,
    day: '2026-09-27',
    lines: () => {
      const m = (units: number): string => (units / 10).toFixed(1);
      return [
        `Dig a spring with a shovel at the bottom of a hollow that holds ${m(SPRING_DEPTH)} m of water or more: it fills the hollow to the lowest point of its rim, rising ${m(FILL_RATE)} m a second, at any height above the sea.`,
        `Full, it spills over that point and runs downhill to the next hollow and fills that too, and so on to the sea, up to ${numberWord(CHAIN_MOST)} ponds. Hollows dug one below another down a slope are a stream of ponds, and wherever the water drops ${m(FALL_DROP)} m or more it falls.`,
        `A pond is water to everything: a bucket fills from it, a line is cast into it, nothing is built in it, and deeper than ${m(SWIM_DEPTH)} m you swim. A notch cut in its rim lets it down to the notch; filling the hollow in, or Stop up the spring, takes its water away.`,
        `Each of us keeps ${numberWord(SPRINGS_EACH)} springs at most. Off a settlement only whoever dug a spring may stop it up; on one, whoever may shape its ground may dig a spring or stop any there, and nobody else may.`,
        `Dig a pool in a poured foundation with a pickaxe: it holds water ${m(POOL_DEPTH - POOL_LIP)} m deep, ${m(POOL_LIP)} m under the top of the slab, with or without a spring, and pools side by side poured to the same top are one pool. A spring dug in one goes over its lowest edge, down the slab to the ground or into a lower pool, and runs on from there. Filling a pool in takes ${POOL_FILL} concrete.`,
      ];
    },
  },
  {
    n: 52,
    day: '2026-09-27',
    lines: () => [
      'A foundation is set out on bare rock only: plain stone, a seam or an ore. Dig the soil off every corner of the tile first. Set out a foundation is no longer offered on grass, dirt or any tile with soil left on a corner.',
      'A poured slab stays packed ground to build or pave on when a corner it shares is dug or mined. Foundations already set out or poured stay as they are.',
    ],
  },
  {
    n: 53,
    day: '2026-09-28',
    lines: () => [
      'Yarn is spun and cloth woven standing at a spindle or a loom set down on the ground; one in your pack does not count. The crafting window now says so in the row: "spindle: set yours down" when you carry one, "stand at one" when you do not. Right-click the ground, choose Set furniture down and pick it.',
    ],
  },
  {
    n: 54,
    day: '2026-09-28',
    lines: () => [
      `Nothing repairs a fragment or a tarnished bauble until it is restored: not Repair, not a repair kit, not Mend, not a worker mending the stores. Its damage only goes up, and one that reaches ${DAMAGE_MAX} before it is restored breaks and is gone.`,
      `Restore is tried at any damage short of that now, rather than refusing a badly damaged piece and sending you to repair it first. A failure puts ${RESTORE_HARM} to ${RESTORE_HARM + RESTORE_HARM_SPREAD} more damage on every piece.`,
    ],
  },
  {
    n: 55,
    day: '2026-09-28',
    lines: () => {
      const keep = TREE_DEFS.filter((_, i) => evergreen(i)).map((t) => t.name.toLowerCase());
      const bloom = (['deep pink', 'pale pink', 'white'] as const).map((family) =>
        `${family} on ${listed(TREE_DEFS.filter((t) => BLOOMS[t.fruit ?? '']?.family === family).map((t) => t.name.toLowerCase()))}`);
      return [
        `The woods follow the island's year. ${capital(listed(keep))} keep their leaves; every other tree comes into leaf over the first ${numberWord(LEAF_DAYS)} days of spring, turns its own colour over the first ${numberWord(TURN_DAYS)} days of autumn, drops its leaves over the last ${numberWord(SHED_DAYS)}, and stands bare through winter. Roses and thorns do the same and lavender keeps its leaves.`,
        `Every tree old enough to fruit is in flower for all ${numberWord(SEASON_DAYS)} days of spring (${bloom.join('; ')}), and drops its petals on the wind and on any water under it. Roses and lavender flower from day ${BUSH_FLOWER_FROM} of spring to the end of summer. The look only: trees and bushes give what they gave.`,
        `Butterflies come out at whatever is in flower by day, dragonflies over ponds, pools and streams from morning to dusk, and fireflies over the grass by trees and water at night: ${lifeSeasons()}. Only to look at.`,
      ];
    },
  },
  {
    n: 56,
    day: '2026-09-28',
    lines: () => {
      const bill = (id: string): string => billWords((RECIPE_BY_ID.get(`make_${id}`)?.inputs ?? []).map((i) => [i.item, i.count ?? 1] as const));
      return [
        `Garden steps: lay a flight up a tile of packed dirt whose slope is ${STEPS_LEAST} to ${STEPS_MOST}, with the corners at each end within ${STEPS_TWIST} of each other. In stone with a trowel (masonry), ${STONE_STEPS_BILL}; in timber with a mallet (carpentry), ${TIMBER_STEPS_BILL}.`,
        `A tile of steps is stood on at any slope up to ${STEPS_MOST}, where bare ground stops at ${MAX_STAND}, and a step onto it or off it is not held to the ${MAX_STEP} between tile centres that bare ground is. No cart or wagon goes onto one. Taking it up with a pickaxe keeps ${share(STEPS_BACK)} of it whole: ${numberWord(stepsBack(STEPS_SLABS))} of ${numberWord(STEPS_SLABS)} slabs and ${numberWord(stepsBack(STEPS_BRICKS))} of ${numberWord(STEPS_BRICKS)} bricks, or ${numberWord(stepsBack(STEPS_PLANKS))} of ${numberWord(STEPS_PLANKS)} planks.`,
        `A rose arch (carpentry: ${bill('rose_arch')}) or a stone rose arch (masonry: ${bill('stone_rose_arch')}), set down over a path and walked through. ${ROSES_RULE}`,
        `A flagpole (tailoring: ${bill('flagpole')}) flies its flag down the wind, straight out at its full force and hanging in a calm, and a banner's cloth swings down the same wind. Either takes dye, and on a settlement carries its device, one of ${numberWord(DEVICE_COUNT)} chosen by the settlement's name. A banner or a sail set down on the island keeps its dye now; it used to come out undyed.`,
      ];
    },
  },
  {
    n: 57,
    day: '2026-09-28',
    lines: () => [
      `Collect works on dirt now, as it does on sand and clay: stand on a tile of dirt with a shovel and choose Collect dirt, and you fill a shovel off the top of it while the tile keeps its type and its height.`,
      `Cut moss on a moss tile gives ${numberWord(MOSS_PER_CUT)} moss, as Cut grass gives mixed grass, and the tile stays moss. Plant moss on a tile of dirt with ${MOSS_PLANT} moss in your pack and the tile turns to moss.`,
    ],
  },
  {
    n: 58,
    day: '2026-09-28',
    lines: () => {
      const dye = DYES.find((d) => d.id === 'wildflowers');
      const boil = RECIPE_BY_ID.get('make_wildflowers');
      return [
        `${capital(listed([...WEARS].map((t) => GROUNDS[t as Ground].name.toLowerCase())))} wear where people walk: a step on your own feet puts one wear on a tile, up to ${WEAR_MOST}, and at ${WEAR_TRAIL} it is a trail of bare earth, walked and rolled like packed dirt. Each tile loses ${WEAR_FALL} at every turn of the woods, at ${TREE_DAWN_UTC}:00 UTC, and a trail with none left is what it was again. Paved, built on, tilled or planted ground never wears.`,
        `Grass flowers in ${listed(FLOWER_SEASONS)}, in drifts: up to ${numberWord(FLOWER_MOST.summer)} clumps a tile in summer and ${numberWord(FLOWER_MOST.spring)} in spring. Pick flowers gives a wildflower a clump, at your foraging quality, and the tile has none again until next spring.`,
        `Wildflowers are for dye: ${billWords((boil?.inputs ?? []).map((i) => [i.item, i.count ?? 1] as const))} boil into ${numberWord(boil?.count ?? 1)} pots of ${dye?.word ?? 'orange'}, at alchemy ${boil?.difficulty ?? 0}.`,
        'Steep rock is drawn with the grass above it hanging over its top edge, moss down its upper face, ferns and tufts in its cracks and the damp dark over water at its foot. Drawing only: nothing about the ground changes.',
      ];
    },
  },
  {
    n: 59,
    day: '2026-09-28',
    lines: () => {
      const [clear, scrub] = GREEN_ACTIONS;
      const a = (name: string): string => `${article(name)} ${name.toLowerCase()}`;
      return [
        `Stone greens over as it stands. Ivy climbs every finished wall, fence and half wall of stone or brick, and moss gathers on paving, on a poured foundation, on ${listed([...FURNITURE.filter((f) => f.mossy).map((f) => a(f.name)), a(BRIDGES.stone.name)])}. Each is bare the day it is built, laid, set down or poured and greens a day at a time for ${GREEN_DAYS} days; everything already standing starts from bare stone today.`,
        `How much shows is its days over ${GREEN_DAYS} times a pace: ${GREEN_SUN} on tops and on south and east faces, ${+(GREEN_SUN + GREEN_SHADE).toFixed(2)} on north and west faces, which the sun never reaches, and up to ${GREEN_WET} more beside water.`,
        `${clear.label} with ${a(itemDef(clear.tool ?? '').name)}, a side of a wall at a time and every storey of it at once; ${scrub.label} with ${a(itemDef(scrub.tool ?? '').name)}, on paving, a foundation, a statue or an arch. Either starts it again from bare stone. On a settlement only its builders may; anywhere else anybody may. On an island the island keeps the clock, so everybody sees the same green.`,
        'A bridge on an island is drawn and walked by everybody now. The island kept them and never said so, so nobody saw one or could cross it.',
      ];
    },
  },
  {
    n: 60,
    day: '2026-09-28',
    lines: () => {
      const rotation = perksOf('farmer').find((p) => 'rotate:plant_seed' in p.fx)?.name ?? 'Crop Rotation';
      return [
        `A crop in a field grows with the year: ${listed(SEASONS.map((s) => `${growthWords(SEASON_GROWTH[s])} in ${s}`))}. In winter it keeps its stage and waits for spring; nothing dies, and a field can still be sown, tended and harvested.`,
        `A planter grows one crop ${growthWords(PLANTER_GROWTH)} in every season, winter too, indoors or out: a stage of cotton takes ${spanWords(CROPS.cotton.stageSeconds / PLANTER_GROWTH)} in one. Sow, tend, harvest or pull it up from its menu, with the same seeds, stages and yields as a field; the Farmer's perks on a sowing or a harvest work on it, and ${rotation} reads the planter's own last crop. A planter with something growing in it will not be picked up, and an empty one is bare earth.`,
        'Hovering over a field or a planter, and sowing one, says when the next stage comes in real time, and a field in winter how long it waits for spring.',
        'Bounty brings on the crops on your own settlements, the planters standing on them included, and no longer those on everybody else\'s.',
      ];
    },
  },
  {
    n: 61,
    day: '2026-09-28',
    lines: () => {
      const lily = WATER_PLANT_BY_ID.get('lily') as WaterPlantDef;
      const lotus = WATER_PLANT_BY_ID.get('lotus') as WaterPlantDef;
      const dyeWord = (item: string): string => DYES.find((d) => d.from === item)?.word ?? '';
      const metres = (units: number): string => (units / 10).toFixed(1);
      return [
        `Lay stepping stones across shallow water — the sea's edge, a pond, or where a stream runs — with a trowel and ${numberWord(STONES_SLABS)} cut slab a tile, where the water is ${metres(STONES_DEPTH)} m deep or less (you swim from ${metres(SWIM_DEPTH)} m). On them you walk at ${percent(TILE_DEFS[TileType.SteppingStones].speed / TILE_DEFS[TileType.Grass].speed)} of your pace on grass and neither wade nor swim. Take up the stepping stones gives the slab back.`,
        `A tiered fountain (masonry: ${pieceBill('fountain')}) is a well to every rule: it draws its own water, ${(WELL_TRICKLE * 60).toFixed(1)} to ${((WELL_TRICKLE + WELL_TRICKLE_QL) * 60).toFixed(1)} litres a minute by its quality, up to ${furnitureDef('fountain').well} litres; fill a bucket or a skin at it or drink from it.`,
        `Botanizing at the water's edge turns up ${itemDef(lily.from).name.toLowerCase()}s and ${itemDef(lotus.from).name.toLowerCase()}. Plant them in still water ${metres(WATER_PLANT_SHALLOWEST)} to ${metres(WATER_PLANT_DEEPEST)} m deep; they root in ${spanWords(WATER_ROOTING)} and keep the island's year: a water lily ${yearSays(lily)}, a lotus ${yearSays(lotus)}. Water lily flowers boil into ${dyeWord(lily.flower)} dye and lotus flowers into ${dyeWord(lotus.flower)}; a seed head gives ${numberWord(lotus.seedCount ?? 0)} lotus seeds to eat or plant.`,
      ];
    },
  },
  {
    n: 62,
    day: '2026-09-28',
    lines: () => [
      `A day of the island's year is as long as a day and night of the clock, ${spanWords(DAY_SECONDS)} of real time, where it was a whole real day: a season is ${numberWord(SEASON_DAYS)} of them, ${spanWords(SEASON_SECONDS)}, and a year ${numberWord(YEAR_DAYS)}, ${spanWords(YEAR_SECONDS)}. The line beside your position counts them: "${seasonLine(YEAR_FROM + DAY_SECONDS)}".`,
      `Everything that keeps the year keeps it in those days. The woods come into leaf over the first ${numberWord(LEAF_DAYS)} days of spring, turn over the first ${numberWord(TURN_DAYS)} of autumn and drop their leaves over the last ${numberWord(SHED_DAYS)}; roses and lavender flower from day ${BUSH_FLOWER_FROM} of spring. An arch's roses are in leaf ${numberWord(ROSE_LEAFY)} day after it is set down, in bud ${numberWord(ROSE_BUD)} and in flower ${numberWord(ROSE_FLOWER)}; a water plant roots in ${spanWords(WATER_ROOTING)}; and a crop in a field grows ${listed(SEASONS.map((s) => `${growthWords(SEASON_GROWTH[s])} in ${s}`))}: ${spanWords(SEASON_SECONDS)} of each.`,
    ],
  },
  {
    n: 63,
    day: '2026-09-28',
    lines: () => [
      `The last of a trade's ${numberWord(PERK_TIER_AT.length)} tiers of perks opens at ${PERK_TIER_AT[PERK_TIER_AT.length - 1]} in its main skill, where it was 100. After the first, which comes with the trade, the tiers open at ${listed(PERK_TIER_AT.slice(1).map(String))}.`,
    ],
  },
  {
    n: 64,
    day: '2026-10-02',
    lines: () => {
      const bill = (b: { needed: Record<string, number> }): string => billWords(Object.entries(b.needed), true);
      return [
        `Jetties: on a storey above the ground, Plan jetty floor lays a floor ${numberWord(JETTY_REACH)} tile out past the footprint, over open ground on your own settlement, resting on a finished full-height wall of the storey below on the side it shares with the building (a door counts; a half wall, a fence or a railing does not). It costs what a floor inside does and may be no heavier than the lightest wall or column under it carries. A storey over a jettied room floors out over the room as far as it goes, on the room's walls. The ground under a jetty stays open: nothing is planned or planted there, no bridge or aqueduct crosses it, its corners are not dug or raised, and you walk under it. Off a building on piers the storeys count from its deck.`,
        'Open to its storey, a jetty is part of it: walls, railings or columns on its outer sides close the storey in. The roof may go out over it on walls or columns only: every side of it out of the storey wants a finished full-height wall, or at each end a finished column or the end of a finished full-height wall, since a railing carries nothing. The wall a side of it rests on, and a wall whose end is all that carries an end of one, stay up until columns take the roof; a column that is all that carries an end of one stays up until that side is walled or the roof is off. Behind a wall or a door it is a balcony, outside the storey, and takes no roof.',
        'The jetty and column rows name their storey (Jetty of ‹house› (storey N), Plan column (‹corner› corner, storey N)), and every job on a building goes to the storey you are working on, on the island too, so a storey below the top can be worked from it; stairs asked for on the ground floor of a building with a storey over it say to work on storey 2 or above. A finished full-height wall with a wall of its building\'s storey above on the same side, once any of that wall\'s materials are in, stays up until that wall comes down, or until a finished column at each end carries the side; so does the last wall a jetty rests on.',
        `Railings: a wall type for the open edges of upper storeys, jetties, balconies, finished decks on piers and finished flat roofs (Plan railing round the roof), never on the ground. ${capital(share(WALL_TYPE_BY_ID.get('railing')?.factor ?? 0))} of a solid wall's bill (${bill(typeBill('log', 'railing'))} in log), ${metres(RAILING_HEIGHT * WALL_HEIGHT)} m high, see-through; a finished one stops anyone crossing it.`,
        `Columns: Plan column on the corner of a tile of a building, ${share(COLUMN_SHARE)} of a solid wall's bill (${bill(columnBill('log'))} in log, ${bill(columnBill('marble'))} in marble), on the ground, on a finished deck on piers or on a finished floor of its storey; never in glass, and on piers no heavier than the lightest deck, which has to carry the heaviest column as it does the heaviest wall. On the ground it takes the corner spot of each tile round it: no piece of furniture, smelter or kiln is set down in one, and no column goes up over a piece of furniture standing in one. A side with a finished column at each end is closed as a wall closes it: a column on each corner of a tile and a roof over it are an open hall, a row of them a colonnade, and a storey can go up on them. A column counts in what may be raised over it and in how many storeys the building stands, as a wall of its material does. It comes down unless it carries a side on the edge of its storey with no full-height wall, under a floor or a roof; the refusal names that side. Where walls meet on its corner it is drawn as a pilaster.`,
        `Under a roof on columns, what is left decays at ${share(INDOORS_DECAY)} of the rate in the open, as in a room. A bed there is still in the open: the ×${INDOORS_REST} rest of a bed indoors wants walls all round.`,
        'Examine on a tile names the jetty or balcony over it, the columns on its corners and what one still going up needs.',
      ];
    },
  },
  {
    n: 65,
    day: '2026-10-02',
    lines: () => {
      const full = deckBill('plank', PIER_DROP).needed;
      return [
        `A tile that is not level and dry at a building's floor height — one that slopes, one lower than the floor, or one under at most ${metres(PIER_WATER)} m of water — takes the building on piers: a level deck at the floor height on timber posts braced across, or on stone piers with arches between them, up to ${metres(PIER_DROP)} m over the tile's lowest corner. Level, dry ground at the floor height is still packed first and built on as it stands.`,
        `Planned on such a tile, a building's deck is set at its highest corner, ${metres(PIER_CLEAR)} m over the water, or a level you have taken, whichever is highest; every tile added must lie wholly under it. Plan deck on each: the floor's materials and ${share(10 / PIER_WALL_DROP)} of a solid wall more for every metre of drop, rounded up item by item — a plank deck ${metres(PIER_DROP)} m up takes ${full.plank} planks and ${full.timber} timbers. A deck carries no wall heavier than the material it is laid in, and the lightest deck under a building carries all of it.`,
        `A deck is walked at its height once it is built, never in the water under it: you step onto or off it from ground up to ${metres(MAX_STEP)} m above or below it, and ${(CLIMB_PER_LEVEL / 10).toFixed(2)} m more for each level of climbing; a bridge lands on it as on a bank. Walls, stairs, furniture and crates go on it; no creature, cart, mount or boat goes onto it or under it. On an island, as offline, the ground under any building cannot now be dug at a corner, raised, mined, cut back, packed, cultivated, paved or planted.`,
      ];
    },
  },
  {
    n: 66,
    day: '2026-10-02',
    lines: () => [
      `A building whose ground-floor walls are all built can have a cellar dug out under it, a tile at a time, ${numberWord(CELLAR_DEPTH)} slices down to a storey, by somebody on its ground floor or down in its cellar: the soil with a shovel and Digging, a dirt a slice, and the rock under it with a pickaxe and Mining, a slice of that stone's own shards or the ore where a vein runs under the building. It is begun where there are ${numberWord(CELLAR_SOIL)} or more of soil at every corner of the tile, and its floor has to lie above the sea; not under a poured foundation or a deck on piers.`,
      `What lies on a cellar's floor rots at ${share(CELLAR_DECAY)} of the rate out of doors, against ${share(INDOORS_DECAY)} in a closed room, and a bed down there rests you as one in a closed room does. Every piece of furniture goes down but what burns an open fire, what is on wheels or afloat, and the pieces the help names. A staircase down or a ladder down from the ground floor is the way in, climbed from its foot and from no other side, and nothing in tow and no mount goes down it; the cellar of the building next door is another room, with the ground between. It is dark down there at every hour but for what you carry alight and, by day, ${numberWord(CELLAR_DAYLIGHT)} tiles of daylight round the way in. The ground over a cellar is not dug while it is there, and the building is taken off the plan only once its cellar is filled in again.`,
    ],
  },
  {
    n: 67,
    day: '2026-10-02',
    lines: () => {
      const shape = roofShapeOf(undefined);
      const tile = listed(Object.entries(floorBill(GLASS_ROOF.id, 'roof', shape).total).map(([id, n]) => `${n} ${materialName(id, n)}`));
      return [
        `A roof can be laid in glass: Plan roof offers it, panes on timber glazing bars, ${tile} to a tile of the ${roofShapeDef(undefined).name.toLowerCase()} roof Plan roof lays, built with a mallet and trained as carpentry. It goes on a roof and on nothing else.`,
        `A building of one storey, walled all round to full height, with every tile of its footprint under finished glass is a glasshouse. Till its ground-floor tiles where no floor is planned and no slab is poured, and sow, tend and harvest them as fields, a Farmer's patches and perks and Bounty included. A crop in one grows ${growthWords(GLASSHOUSE_GROWTH)} in every season, winter too: a stage of cotton takes ${spanWords(CROPS.cotton.stageSeconds / GLASSHOUSE_GROWTH)} in one all year, where a field in winter waits for spring. While a building has a field in it, it takes no floor over the field, no roof but glass and no storey over it until Clear the field packs the ground flat again.`,
        `When the last pane or the last wall goes in, whatever already grows in the building carries on from as far into its stage as it had grown, at the glasshouse's pace; take a tile of the roof or a wall down, or add a tile to the footprint, and it carries on at a field's pace from there. A glasshouse is indoors, and what is left lying in it rots at ${share(INDOORS_DECAY)} of the rate in the open.`,
      ];
    },
  },
  {
    n: 68,
    day: '2026-10-02',
    lines: () => [
      `Aqueducts. Right-click a pool, a pond, a tiered fountain or a hollow that would hold ${metres(SPRING_DEPTH)} m of water, and Lead an aqueduct here from the first pond or pool straight out from it, up to ${numberWord(AQUEDUCT.span)} tiles off: a stone arcade built a span at a time with a trowel, ${billWords(AQUEDUCT.bill)} a span. Its channel is carried at the height of the water at its head, which must stand no lower than the water at its foot, with everything under it ${metres(CLEARANCE)} m or more below its bed.`,
      `Finished, it takes all the water that went over that pond's lip or that pool's edge — a channel ${CHANNEL_WIDE * TILE_METRES} m wide and ${metres(CHANNEL_DEEP)} m deep running ${RUN_RATE} tiles a second, ${AQUEDUCT_FLOW} litres a minute — and the stream it fed dries up. A pool at its foot goes over its lowest edge; a hollow fills at that rate and then spills on; a fountain takes ${AQUEDUCT_LPS} litres a second on top of its own well's; bare ground sends it downhill.`,
      'When the water at its head stands lower than the channel, the channel runs dry and whatever only it kept goes dry with it; take the fountain away and the water runs off downhill there, fill the pool in and it goes off the foundation over its lowest edge. One pond or pool feeds one aqueduct. Nobody walks along one, and pulling it down gives back half of what went into it.',
      'Under one you go through its arches, and its piers stand in the way along it; the ground there is walked, worn and climbed as it was. Nothing is planted, built, poured or dug under a span, and none is set out over a tree or a bush. Its stone takes moss as a stone arch\'s does.',
    ],
  },
  {
    n: 69,
    day: '2026-10-02',
    lines: () => {
      const stones = WALL_MATERIALS.filter((m) => m.kind === 'stone' && takesAs(m, { wall: 'portcullis' })).map((m) => m.name.toLowerCase());
      const portReach = gateReach('raise_portcullis');
      const winchReach = gateReach('raise_drawbridge');
      const planWall = ACTION_BY_ID.get('plan_wall');
      const pull = ACTION_BY_ID.get('demolish_bridge')?.label;
      return [
        `A portcullis is a new wall type for a ground-floor wall of ${listed(stones)}: a gateway as wide as a double door with an iron grille of ${billWords(WALL_TYPE_BY_ID.get('portcullis')?.fittings ?? [])} over the stone's own bill. Raise the portcullis takes ${gateJobWords('raise_portcullis', goSeconds)} and Lower the portcullis ${gateJobWords('lower_portcullis', goSeconds)}, from either side, within ${numberWord(portReach)} tile${portReach === 1 ? '' : 's'} of the tile beside it. Down, nothing passes it, no person, cart or wildermon, and it is still seen through; up, everything passes, carts included.`,
        `A drawbridge is a new bridge of planks from open ground to open ground with at most ${numberWord(BRIDGES.draw.span)} tiles of deck, each span taking ${billWords(BRIDGES.draw.bill)} and its first ${billWords(BRIDGES.draw.winch ?? [])} more for its gallows and winch. ${winchReach === 0 ? 'Standing on the tile it was set out from' : `Within ${numberWord(winchReach)} tiles of the tile it was set out from`}, Raise the drawbridge takes ${gateJobWords('raise_drawbridge', goSeconds)} and Lower the drawbridge ${gateJobWords('lower_drawbridge', goSeconds)}. Up, it stands on end over its hinge: nothing crosses it or sees past it, and anybody out on its deck is left in whatever is under it; down, ${BRIDGES.draw.carts ? 'a cart crosses it' : 'it carries foot traffic'}. Its winch is not set on the ground under a jetty, nor a jetty floored out over its winch: its gallows rise there higher than a storey.`,
        `A hidden door is built of exactly a solid wall's bill and drawn exactly as one. Plan wall, Hidden door plans a solid wall there in every way anybody else can see or read, ${spanWords(goSeconds(planWall?.baseTime ?? 0))} and ${percent(planWall?.stamina ?? 0)} of your stamina; as the plan is finished it takes ${billWords(HIDDEN_DOOR_IRON)} and the padlock becomes its key. Each is asked for with its own plan, for that side of that tile, and kept only if the plan is started or lined up; then for as long as a plan of a wall on that side is in hand or lined up, so several may be lined up. Walking away puts the work down and keeps the ask; Esc forgets it with the jobs. The next solid wall you plan on that side, on whichever storey you are working, is the door. One still waiting ${spanWords(HIDDEN_DOOR_LAPSE)} after it was asked for lapses, and its plan is a solid wall. To whoever holds that key, and to the founder of the settlement it stands on, it is a door with a dashed seam and a keyhole on its face; to everybody else it is a solid wall in every way, and on an island their browser is told nothing else.`,
        'Fit a padlock to a portcullis or to a drawbridge\'s winch and only its key, and the founder of the settlement it stands on, raise it, lower it, or take it down.',
        'Every bridge thrown across now starts and ends on open ground, on a finished deck on piers or on a finished upper floor, a jetty\'s among them, never inside a building on a ground floor laid on the ground nor on another bridge\'s end, and never meets its deck through a wall: from a storey or a deck it goes out through a doorway, an archway or an open side. Nothing is built on a tile a bridge comes ashore on.',
        `${pull} works on a bridge on an island again: it had been answering with an error. Where either end of the bridge stands on a settlement, only its builders may ${pull?.toLowerCase()}, as only they may take down a building's wall there, and a guest may not; anywhere else, anybody may. It is done within ${PULL_REACH} tiles of the middle of either end. ${ACTION_BY_ID.get('demolish_aqueduct')?.label} goes by the same two rules.`,
      ];
    },
  },
  {
    n: 70,
    day: '2026-10-02',
    lines: () => [
      `Shop counters: a wall type with a market stall in it, planned and built like any wall at ${share(counterType()?.factor ?? 1)} of a solid wall's material and ${countOf('hinge', counterType()?.fittings?.find(([id]) => id === 'hinge')?.[1] ?? 0)}. It goes in an outside wall of the ground floor with no building across it, holds ${numberWord(COUNTER_HOLDS)} things priced on the Market window's Stall tab, and sells to the street only, within ${COUNTER_REACH} tiles of its middle and not to anybody inside a building; the silver waits in its till for whoever planned it.`,
      `Lantern posts and lantern pillars: a lantern hung on a timber post (${skillOf('make_lamp_post')}) or set in a stone pillar (${skillOf('make_lamp_pillar')}) stays where it is put, takes candles, is lit and put out as it is in your hand, and at night lights the ground round it out to the lantern's reach, ${numberWord(lanternReach(1))} to ${numberWord(lanternReach(100))} tiles, for everybody. A padlock on one keeps its lantern for the key; lighting it is anybody's.`,
      `On an island a candle in a lantern burned ${times(WORLD_PACE)} too fast. It lasts what it does here now, ${spanWords(candleBurn(1))} to ${spanWords(candleBurn(100))} by the lantern's quality. A light taken off a brazier or a lit lantern post says which it came off, where it said an oven, and a lantern with nothing burning near it names what it can be lit at: a burning ${flameSources()}.`,
      `Where the warm glow of two lights overlaps at night, the stronger of the two is drawn there rather than both added together.`,
    ],
  },
  {
    n: 71,
    day: '2026-10-03',
    lines: () => [
      `A swing takes its weapon's own time before skill, ${[...WEAPONS].filter((w) => !w.ammo).sort((a, b) => a.swing - b.swing).map((w) => `${itemDef(w.id).name.toLowerCase()} ${w.swing}`).join(', ')} seconds and bare hands ${FIST.swing}. A bow draws at its own pace the same way.`,
      `Every swing or draw costs ${pct(SWING_WIND)} of your stamina and ${pct(SWING_WIND_KG)} more for every kilogram in your hand. Below ${pct(TIRED_AT)} stamina every swing is slower, up to ${pct(TIRED_SLOW)} slower with none left.`,
      `What you strike that does not run fights back on its own clock, swinging or not: a hunter or a monster every ${BLOW_HUNTER} seconds, a kind that stands up for itself every ${BLOW_DEFENSIVE}, anything else every ${BLOW_PREY}. It follows you up to ${FIGHT_LEASH} tiles from where it was struck and lets you go ${FIGHT_GIVE_UP} tiles off. It no longer answers each of your swings with a roll.`,
      `Stances, on the button beside your health bar or the \` key: ${FIGHT_STANCES.map((st) => `${FIGHT_STANCE_NAMES[st]}, ${stanceSays(st).toLowerCase()}`).join(' ')}`,
      `Left-click something that is after you, or a kind that hunts on sight, to fight it, and you follow it up to ${FOLLOW_RANGE} tiles when it steps away. Tab marks the nearest foe within ${TARGET_RANGE} tiles and Space attacks what is marked. A fight never waits behind work: the job in hand goes to the front of the line.`,
      `Walking leaves a fight: a click on the ground no longer keeps the swing-back for later, and a bite while you walk does not turn you round. A bite turns you on what bit you once your feet have been still ${FIGHT_BACK_STILL} seconds, and Settings, Fighting turns that off.`,
    ],
  },
  {
    n: 72,
    day: '2026-10-03',
    lines: () => [
      `Heavy blows: ${Object.values(SPECIES).filter((d) => d.heavy).map((d) => `${d.name.toLowerCase()}s`).join(', ')} draw back every ${HEAVY_EVERY} blows. A red ring shows the reach for ${WIND_UP} second; anything still inside it takes ${HEAVY_HIT} times the blow.`,
      `Blows cut, puncture or crush: ${blowSays('cut')} cut, ${blowSays('pierce')} puncture, ${blowSays('crush')} crush. ${HIDES.map((h) => `A ${HIDE_NAMES[h].toLowerCase()} (${Object.values(SPECIES).filter((d) => d.hide === h).map((d) => d.name.toLowerCase()).join(', ')}) ${hideSays(h)}.`).join(' ')}`,
      `Armour against each kind: ${(Object.keys(ARMOUR_VS) as Array<keyof typeof ARMOUR_VS>).map((c) => `${c} ${armourSays(c)}`).join('; ')}.`,
      `A landed maul ${sideOf(WEAPON_BY_ID.get('maul')!)}; a spear ${sideOf(WEAPON_BY_ID.get('spear')!)}; a knife ${sideOf(WEAPON_BY_ID.get('hunting_knife')!)}, never taking the last of it.`,
      `Wounds to an arm or a hand slow every swing, up to ${pct(ARM_SLOW_MOST)}; wounds to a leg or a foot slow your walking, up to ${pct(LEG_SLOW_MOST)}.`,
      `A blow from something that is not what you are fighting lands ${pct(FLANK_HIT - 1)} harder; each other thing on you takes ${pct(CROWD_BLOCK)} off a shield's chance to block; and your blow at something fighting somebody else lands ${pct(BLINDSIDE - 1)} harder.`,
      'A panel at the top of the screen shows what you are fighting or have marked: its health, what it is doing, and what its hide makes of the blow in your hand.',
      'A health bar over everything after you, a ring at your feet that fills as your swing comes, arrows at the edge of the view pointing at anything after you out of sight, and a red edge to the view when you are struck.',
      `With the cursor on a hunter not yet after you, a dashed ring shows how far off it will notice you.`,
      `Settings, Fighting, One line for a whole fight: skill gains in a fight are said once, ${FIGHT_QUIET} seconds after the last blow, with how long it lasted, what you dealt and what you took. On by default.`,
    ],
  },
  {
    n: 73,
    day: '2026-10-03',
    lines: () => [
      `Packs: ${listed(Object.values(SPECIES).filter((d) => d.pack).map((d) => `${d.name.toLowerCase()}s`))} share a home, up to ${PACK_MOST} to one. When one has your scent, every other of its kind within ${PACK_CALL} tiles comes too, and they spread round you ${CIRCLE_R} tiles out before coming in from their own sides.`,
      `Throwers: ${listed(Object.values(SPECIES).filter((d) => d.throws).map((d) => `${d.name.toLowerCase()}s`))} stand off ${KEEP_OFF} tiles and throw from up to ${THROW_REACH}, ${pct(THROW_HIT)} of a blow; closer than ${KEEP_OFF - BACK_SLACK} they back away at ${pct(BACK_PACE)} of their walk.`,
      `Nerve: a hunter turns tail below ${pct(HUNTER_TURN)} health, a monster below ${pct(MONSTER_TURN)}, ${listed(Object.values(SPECIES).filter((d) => d.coward).map((d) => `${d.name.toLowerCase()}s`))} below ${pct(COWARD_AT)}, or ${pct(COWARD_DRAG)} once one of their kind nearby has run. Kill or rout the one leading a pack and the whole pack runs.`,
      `Companion orders, from wherever you stand: Attack my target (${defaultKey('pet_attack')}, or Set … on it from a wild one's menu), whatever its stance; Fall back (${defaultKey('pet_back')}), no fight of its own for ${FALL_BACK} seconds; and a Guarding you stance that goes for anything hunting you within ${COMPANION_SIGHT} tiles and stays within ${GUARD_RANGE} tiles of you. A dashed blue line shows what it is fighting.`,
      `Bows on the move: walking keeps a draw going at ${pct(DRAW_WALK)} of your pace, and it keeps loosing while the target is in range. A line to the target fills with the draw, amber in range and grey out of it.`,
    ],
  },
  {
    n: 74,
    day: '2026-10-03',
    lines: () => [
      `Dodge: every blow a creature lands on you is first rolled against ${finePercent(DODGE_PER_CONTROL)} for every point of body control past the ${DODGE_FROM} everyone starts with, less ${finePercent(DODGE_PER_KG)} for every kilogram of armour you wear. A dodged blow takes nothing and trains body control.`,
      `Critical hits: a blow or shot that lands is critical ${percent(CRIT_BASE)} of the time plus ${finePercent(CRIT_PER_SKILL)} for every point of the weapon's subskill, ${times(CRIT_KNIFE)} as often with a knife, and lands ${percent(CRIT_HIT - 1)} harder. Its number rises larger and in orange.`,
      `Arrow heads, fletched like arrows: broadheads bleed ${percent(KNIFE_BLEED)} of the shot a second for ${KNIFE_BLEED_SECS} seconds; bodkins land ${percent(BODKIN_HIDE - 1)} harder on a thick hide, shell or scales; blunts crush, knock a heavy blow off its stroke and put the next back ${STAGGER_MAUL} second. Shoot these first on a stack of arrows picks the kind a shot takes.`,
      `Venom: ${listed(Object.values(SPECIES).filter((d) => d.venom).map((d) => `${d.name.toLowerCase()}`))} bites take ${percent(VENOM_DRAIN)} of your health a second for ${VENOM_SECS} seconds while the wound is undressed. Burns wear the armour they land on ${times(BURN_WEAR)} as fast.`,
      `Threat: a creature turns on your companion when it strikes, once you have not hurt it for ${THREAT_HOLD} seconds, or at once for a companion Guarding you, and back to you the same way. While it fights your companion it strikes at your companion and does not count among those on you.`,
      `Consider: Examine on a wild creature, and the target panel, say about how many of your blows would down it and how many of its would down you, and rate it Easy (it would take it ${times(CONSIDER_EASY)} as long or more to down you), Hard (less than ${percent(CONSIDER_HARD)} as long) or Even.`,
    ],
  },
  {
    n: 75,
    day: '2026-10-04',
    lines: () => [
      `Patrons: at ${PATRON_AT} faith take ${PATRONS.map((p) => `${p.name} (${ALIGNMENT_NAMES[p.alignment].toLowerCase()})`).join(', ').replace(/, ([^,]*)$/, ' or $1')} as your patron, for good, in the new Faith window. Each offers ${SPELLS_PER_TIER} spells at each of ${FAITH_TIER_AT.length} tiers (${FAITH_TIER_AT.join(', ')} faith), one taken per tier. The first spells, the Blessing's, are next.`,
      `The spell bar, bottom and middle: ${BAR_SLOTS} slots, ${(['class', 'faith', 'path'] as const).map((s) => `${slotsFor(s)} ${SCHOOL_NAMES[s].toLowerCase()}`).join(', ')}. Click a slot or press Shift and its number to call it; right-click to choose what goes in it.`,
      `The Prayer skill is called Faith now. Nothing else about it has changed.`,
    ],
  },
  {
    n: 76,
    day: '2026-10-04',
    lines: () => [
      `Faith has ${FAITH_TIER_AT.length} tiers now, at ${FAITH_TIER_AT.join(', ')} faith, each still offering ${SPELLS_PER_TIER} spells of which you take one.`,
      `Every spell says what it can be cast on: ${listedOr(SPELL_ONS.map((o) => SPELL_ON_WORDS[o]))}. Right-click a person, a creature, a thing or the ground to cast a spell from your bar on it; anything but you and what you carry has to be within ${SPELL_REACH} tiles.`,
    ],
  },
  {
    n: 77,
    day: '2026-10-04',
    lines: () => [
      `The Blessing's spells are written, ${SPELLS_PER_TIER} at each tier: ${listed(FAITH_SPELLS.filter((s) => s.patron === 'blessing').map((s) => s.name))}. What each does, to the number, is in the Faith window.`,
      `Take the Blessing as your patron at ${PATRON_AT} faith, take a spell at each tier as your faith reaches it, and put ${numberWord(slotsFor('faith'))} of them on the spell bar.`,
    ],
  },
  {
    n: 78,
    day: '2026-10-04',
    lines: () => [
      `Justice's spells are written, ${SPELLS_PER_TIER} at each tier: ${listed(FAITH_SPELLS.filter((s) => s.patron === 'justice').map((s) => s.name))}. What each does, to the number, is in the Faith window.`,
      `At each tier one judges what it is cast on, one keeps order in a fight, and one measures: an Oath binds only friends, and Restitution brings home whatever your latest grave holds.`,
    ],
  },
  {
    n: 79,
    day: '2026-10-04',
    lines: () => [
      `Chaos's spells are written, ${SPELLS_PER_TIER} at each tier: ${listed(FAITH_SPELLS.filter((s) => s.patron === 'chaos').map((s) => s.name))}. What each does, to the number, is in the Faith window.`,
      `At each tier one ruins, one dreads, and one is a bargain paid for in your own health or your own things rather than favour. None of them is cast on another person.`,
    ],
  },
  {
    n: 80,
    day: '2026-10-04',
    lines: () => {
      const job = (id: string): string => {
        const r = RECIPE_BY_ID.get(id);
        return r ? `<b>${r.label}</b> (${billWords(r.inputs.map((i) => [i.item, i.count ?? 1] as const), true)} into ${countOf(r.result, r.count ?? 1, true)})` : id;
      };
      const panes = (type: 'window' | 'bay'): number => WALL_TYPE_BY_ID.get(type)?.fittings?.find(([item]) => item === 'glass')?.[1] ?? 0;
      const stained = MATERIAL_BY_ID.get('stained_glass');
      const bottle = itemDef('bottle');
      return [
        `Glassblowing is a new skill, and the Artisan's: at a hot smelter, ${listed(['make_glass', 'make_glass_panel', 'make_bottle', 'make_stained_glass'].map(job))}. A firing of stained glass that fails keeps the gem and the sand.`,
        `Windows, bay windows and glasshouse roofs are glazed with glass panels: a window takes ${panes('window')} and a bay window ${panes('bay')}. Every pane you had is a glass panel now.`,
        stained ? `A new material to build in, stained glass: ${billWords(stained.bill, true)} to a solid wall, as heavy as ${heftWord(stained.heft)} and up to ${stained.storeys} storeys tall. ${onlySaid(stained)}` : '',
        `A bottle holds ${bottle.holds} of one food or drink, and what is in it rots at ${share(bottle.shelter ?? 1)} the rate if it is left lying about.`,
      ].filter(Boolean);
    },
  },
];

/** The highest entry this browser has shown. */
const SEEN = 'wurm.news.seen';

/**
 * Whether this browser has been played in before this page was opened: a
 * window put somewhere, which every session that did anything at all leaves
 * behind (`WindowManager.persist`). Read once, as the page loads, before this
 * session can write one of its own.
 */
const PLAYED_HERE = ((): boolean => {
  try {
    return localStorage.getItem('wurm-iso-windows') !== null || localStorage.getItem(SEEN) !== null;
  } catch {
    return false;
  }
})();

const latest = (): number => Math.max(0, ...NEWS.map((e) => e.n));

function seen(): number {
  try {
    const v = Number(localStorage.getItem(SEEN));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN, String(latest()));
  } catch {
    // A browser that keeps nothing is shown the news each time, which is the price of it.
  }
}

/**
 * The entries to show as you come ashore: those past the last one this
 * browser showed, or none for a browser nobody has played in.
 */
export function unseenNews(): number {
  if (!PLAYED_HERE) {
    markSeen();
    return 0;
  }
  return NEWS.filter((e) => e.n > seen()).length;
}

const DAY_WORDS = (day: string): string => {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/**
 * The window: every entry, newest first under the day it went out, the ones
 * this browser had not shown marked. Drawn each time it opens, since what it
 * marks depends on what was seen before it was opened, and then marked seen.
 */
export class NewsPanel {
  constructor(private readonly win: UIWindow) {
    win.body.classList.add('news-body');
    win.onOpen = () => this.draw();
    if (win.isOpen) this.draw();
  }

  private draw(): void {
    const was = seen();
    const body = this.win.body;
    body.replaceChildren();
    let day = '';
    for (const e of [...NEWS].sort((a, b) => b.n - a.n)) {
      if (e.day !== day) {
        day = e.day;
        const h = document.createElement('h4');
        h.className = 'news-day';
        h.textContent = DAY_WORDS(day);
        body.append(h);
      }
      const list = document.createElement('ul');
      list.className = 'news-entry' + (e.n > was ? ' news-new' : '');
      for (const line of e.lines()) {
        const li = document.createElement('li');
        li.textContent = line;
        list.append(li);
      }
      body.append(list);
    }
    markSeen();
  }
}
