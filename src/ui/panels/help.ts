import {
  ACTION_BY_ID, CHIP_CHANCE, CLEARED_TO, FRUIT_MATURE, FRUIT_OLD, GLAZE_ASH, KIT_MEND, MINE_COLLAPSE, MINE_DEPTH, MOSS_PER_CUT, MOSS_PLANT, PROSPECT_REACH,
  PROSPECT_STEP, REPAIR_FLOOR, repairGo, RESIN_TREE,
} from '../../game/actions';
import { CIRCLET_SHARE, CIRCLET_STONES, GEM_ODDS, GEMS, JEWEL_BONUS, tradeName } from '../../game/gems';
import { ANVIL_SUBTILES } from '../../game/anvil';
import { ARCHAEOLOGY_ACTION_BY_ID, FIND_DAMAGE, FIND_DAMAGE_SPREAD, LECTERN_GAIN, RELICS, RESTORE_AGE, RESTORE_HARM, RESTORE_HARM_SPREAD } from '../../game/archaeology';
import { BELT_MAX, QL_PER_LOOP } from '../../game/belt';
import { HUNGER_RATE } from '../../game/body';
import { BOON_BONUS, BOON_FOODS, boonTime, REST_CAP, REST_MULT, REST_PER_SECOND, TINCTURE_BONUS, TINCTURE_SECONDS } from '../../game/boons';
import { TINCTURE_NAMES } from '../../game/remedies';
import { BREW_BY_ID, BREWS } from '../../game/brewing';
import { BRIDGES, CLEARANCE, END_SLOP, PULL_REACH } from '../../game/bridges';
import { AQUEDUCT } from '../../game/aqueducts';
import { AQUEDUCT_FLOW, AQUEDUCT_LPS, CHANNEL_DEEP, CHANNEL_WIDE, CORNER_LITRES, FOUNTAIN_RIM, TILE_METRES } from '../../world/aqueducts';
import { gateJobWords, gateReach, HIDDEN_DOOR_IRON, HIDDEN_DOOR_LAPSE } from '../../game/gates';
import { HOARD_LUMPS, HOARD_MORE } from '../../game/butcher';
import {
  CELLAR_DECAY, CELLAR_DEPTH, CELLAR_SOIL, COLUMN_SHARE, columnBill, floorBill, GLASS_ROOF, HEFT_WORDS, INDOORS_DECAY, INDOORS_REST, JETTY_REACH, MATERIALS as WALL_MATERIALS,
  MAX_LEVELS, RAILING_HEIGHT, roofShapeDef, roofShapeOf, SIDE_NAMES, WALL_HEIGHT, wallBill, WALL_TYPE_BY_ID, WALL_TYPES,
} from '../../game/building';
import { CELLAR_ACTION_BY_ID, CELLAR_DAYLIGHT, cellarOutdoor } from '../../game/cellar';
import { materialName } from '../../game/buildActions';
import { COUNTER_HOLDS, COUNTER_REACH, COUNTER_SEEN, COUNTER_WALL } from '../../game/counters';
import { flameSources } from '../../game/lantern';
import { LAMP_INTO_WALL } from '../../game/lamps';
import { STORE_REACH } from '../../game/crates';
import { GREEN_ACTIONS, GREEN_DAY, GREEN_DAYS, GREEN_SHADE, GREEN_SUN, GREEN_WET, GREEN_WET_REACH } from '../../game/greening';
import { FIRE_COST, FIRE_SUBTILES } from '../../game/campfire';
import {
  CHANNELS, CLASS_AT, CLASS_CHANGE_COST, CLASS_COLUMNS, CLASS_NODES, CLASSES, channelSays, NODES_PER_TRADE, PERK_CLASSES, PERK_TIER_AT,
  PERKS_PER_TIER, riteDef, RITES, type Channel,
} from '../../game/classes';
import { PERKS, perksOf } from '../../game/perks';
import { CREATURE_CRATE } from '../../game/creaturecrate';
import { CRATE_DEFS, SUBTILES } from '../../game/crates';
import {
  AGES, BLOW_SHARE, BREED_REST, CARE_BONUS, CARE_HOURS, COAX_LAPSE, COAX_STEP, COMPANION_LEASH, COMPANION_SIGHT, GESTATION, HUNGRY, HUNT_REST, HUNT_SIGHT, MONSTER_CAP, MONSTER_KEEP_OFF,
  MONSTER_SHARE, MONSTERS, OLD_AT, PULL_DEFAULT, RANGE_PER_STEP, rangeSteps, SKILL_STEP, SPECIES, trainedHit, YOUNG_FOR,
} from '../../game/creatures';
import { DEED_UPGRADES } from '../../game/deed';
import { DYE_BY_ID, DYES } from '../../game/dyestuffs';
import { CROP_BY_SEED, CROPS, cropYield, growthWords, PATCH_TIME, RIPE, STAGE_NAMES } from '../../game/farming';
import { GLASSHOUSE_GROWTH, PLANTER_GROWTH, SEASON_GROWTH, SEASON_SECONDS, YEAR_SECONDS, YEARLESS_GROWTH } from '../../game/growth';
import { CASTS, FAITH, FAVOUR_CEILING, favourCap, PRAYER_BASE, PRAYER_LIFT, PRAYER_PEAKS, PRAYER_REST, PRAYER_TAPER } from '../../game/faith';
import { ANCIENT_EFFECTS, ANCIENT_PLUS, BAUBLE_HIGH, BAUBLE_KINDS, BAUBLE_LOW, BAUBLE_SHARE, BAUBLE_TIERS, baubleTimes, MAJOR_SKILLS, MINOR_SKILLS, REGRET_SHARE, YIELD_TIMES } from '../../game/baubles';
import { MOTE_CHANCE } from '../../game/sacrifice';
import { HERB_HEAL, healAmount, SUITS_HEAL } from '../../game/firstaid';
import { BAIT_BY_ID, biteShare, FISH, LINE_REACH } from '../../game/fishing';
import { PER_ROLL, rollsAt, watersideOdds } from '../../game/forage';
import { BUCKET_LITRES, FURNITURE, furnitureDef, POND_EVERY, teamSaid, WELL_TRICKLE, WELL_TRICKLE_QL } from '../../game/furniture';
import { STONES_DEPTH, STONES_DIFFICULTY, STONES_SLABS, WATER_GARDEN_ACTIONS, yearSays } from '../../game/watergarden';
import { WATER_PLANT_BY_ID, WATER_PLANT_DEEPEST, WATER_PLANT_SHALLOWEST, WATER_ROOTING, type WaterPlantDef } from '../../world/waterplants';
import { GRAVE_KEEPS, GRAVE_REACH } from '../../game/graves';
import {
  ASH_RATE, BASE_QUEUE, BOAT_LOAD_DRAG, CARRY_BASE, CARRY_PER_STRENGTH, CARRY_STOP, CHAR_START, DAMAGE_MAX, DAMAGE_WARN,
  DAMAGE_WARN_STEP, DAWN, DAY_SECONDS, DEED_RADIUS, DEED_RADIUS_PER_LEVEL, DEED_RANKS, DEEDS_JOINED, deedWorkersAt, DUSK,
  footing, Game, goSeconds, hullSpeed, kitQl, MAX_DEED_LEVEL, MAX_MOUNT_SPEED, ORDINARY_GAIN, overDrag, QL_BARE, QL_LOW,
  QL_SPAN, QUEUE_PER_MIND, TWILIGHT, WAKE_AFTER_DAWN, wearPerUse,
} from '../../game/game';
import { ARMOUR, ARMOUR_CLASSES, BANE_BONUS, WEAPONS, type ArmourClass } from '../../game/gear';
import { PAIR_RANGE, TIER_LEVEL } from '../../game/husbandry';
import { IMPROVE_DAMAGE, IMPROVE_FLOOR } from '../../game/improve';
import { billWords, countOf, DEED_DECAY, HOARD_METALS, itemDef, ITEM_DEFS, RARITIES, RARITY_ROOM, rarityChance, roomFor } from '../../game/items';
import { ALL_GOALS, JOURNAL, LEGEND_AT } from '../../game/journal';
import { guidePages, keepable } from '../../game/guide';
import { MOBS_RANGE } from '../../game/keep';
import { KILN_CAPACITY } from '../../game/kiln';
import { candleBurn, FIRE_REACH, HELD_LIGHTS, lanternReach, OVEN_REACH, torchBurn, torchReach } from '../../game/light';
import { MARK_CAP } from '../../game/marks';
import { MATERIAL_BY_ID, type MaterialDef } from '../../game/materials';
import { CHOOSE_AT, PATH_LIST, SIT_REST, SIT_WORTH } from '../../game/meditation';
import { COIN_METALS, INGOT_LUMPS, INGOT_WEIGHT, METALS, MOULDS, NAILS_PER_LUMP, RARE_METALS } from '../../game/metal';
import { COIN_WORTH } from '../../game/money';
import { ORDER_LIFE } from '../../game/orders';
import { KEPT_BEST, NUTRIENT_HOURS, NUTRIENT_NAMES, NUTRIENTS, TABLE_BEST } from '../../game/nutrition';
import { OVEN_CAPACITY } from '../../game/placeables';
import { BASE_SPEED, CARRY_CRAWL, CLIMB_LEARN_FROM, CLIMB_PER_LEVEL, MAX_STAND, MAX_STEP, SWIM_DEPTH } from '../../game/player';
import { deckBill, PIER_CLEAR, PIER_DROP, PIER_WALL_DROP, PIER_WATER } from '../../game/piers';
import { POST_LIFE_MAX, POST_LIFE_MIN, postRadius } from '../../game/posts';
import { CRAFT_REACH, RECIPE_BY_ID, RECIPES, TRADE_BOOK_AT, TRADE_BOOK_SKILLS } from '../../game/recipes';
import { MIN_GAIN, SKILL_BY_ID, skillGain } from '../../game/skills';
import { SMELTER_H, SMELTER_W } from '../../game/smelter';
import { KNACK_BONUS, KNACK_CAP, KNACK_HOME, KNACK_ODDS, TITLE_STEPS, titlesFor } from '../../game/titles';
import { CHECK_EVERY, CREEL_BAIT_LOSS, creelOdds, HUNTER_TRAPPED, TIMID_TRAPPED, TRAPS } from '../../game/traps';
import {
  betterThanCommon, CHANNELS as BLOOD, FIGHT_SHARE, FIGHTING, GRADE_STEP, husbandryOdds, inheritChance, pct as cardPct, TIERS, TRAIT_SLOTS,
  TRAIT_SOURCES, TRAITS, upgradeChance, type TraitTier,
} from '../../game/traits';
import { CHAIN_MOST, FALL_DROP, FILL_RATE, POND_MOST, POOL_DEPTH, POOL_LIP, RUN_MOST, RUN_RATE, SPRING_DEPTH, SPRINGS_EACH } from '../../world/springs';
import { CLEAR_OF_BUILDINGS, CONCRETE_PER_STEP, LIFT_PER_MASONRY, POOL_FILL } from '../../game/foundations';
import { AWARENESS, awarenessReach, BASE_SIGHT, LIGHT_GIVES_BACK, NIGHT_LOSS, TREE_OPACITY } from '../../game/vision';
import { NO_GO, pointAt, windWord, windWorth } from '../../game/wind';
import { article, capital, finePercent, listed, listedOr, NumberWord, numberWord, percent, share, spanWords, times } from '../../game/words';
import { BACK_PACE, BACK_SLACK, CIRCLE_ARC, CIRCLE_R, COWARD_AT, COWARD_DRAG, DRAW_WALK, FALL_BACK, FLEE_SECS, GUARD_RANGE, HUNTER_TURN, KEEP_OFF, MONSTER_TURN, PACK_CALL, PACK_MOST, PACK_RANGE, THROW_HIT, THROW_REACH } from '../../game/fight';
import { FIGHT_QUIET, ARM_SLOW, ARM_SLOW_MOST, armourSays, BLINDSIDE, blowSays, CROWD_BLOCK, FLANK_HIT, HEAVY_EVERY, HEAVY_HIT, HIDE_NAMES, HIDES, hideSays, LEG_SLOW_MOST, sideOf, WIND_UP, BLOW_DEFENSIVE, BLOW_HUNTER, BLOW_PREY, FIGHT_BACK_STILL, FIGHT_GIVE_UP, FIGHT_LEASH, FIGHT_STANCE_NAMES, FIGHT_STANCES, FIST, FOLLOW_RANGE, stanceSays, SWING_WIND, SWING_WIND_KG, TARGET_RANGE, TIRED_AT, TIRED_SLOW } from '../../game/fight';
import {
  ARROW_IDS, BODKIN_HIDE, BURN_WEAR, CONSIDER_EASY, CONSIDER_HARD, CRIT_BASE, CRIT_HIT, CRIT_KNIFE, CRIT_PER_SKILL, DODGE_FROM, DODGE_PER_CONTROL, DODGE_PER_KG, dodgeChance, KNIFE_BLEED,
  KNIFE_BLEED_SECS, STAGGER_MAUL, THREAT_HOLD, VENOM_DRAIN, VENOM_SECS,
} from '../../game/fight';
import { ALIGNMENT_NAMES, BAR_SLOTS, FAITH_SPELLS, FAITH_TIER_AT, PATRON_AT, PATRONS, SCHOOL_NAMES, slotsFor, SPELL_ON_WORDS, SPELL_ONS, SPELL_REACH, SPELLS_PER_TIER } from '../../game/patrons';
import { BIND_BY_ID, keyName } from '../../game/keybinds';
import {
  CLOSE_BARE, CLOSE_CLOTH, CLOSE_PACE, CLOSE_PER_SKILL, CLOSE_RIGHT, CLOSE_WRONG, FESTER_CLOTH, FESTER_WRONG, WOUND_KINDS,
} from '../../game/wounds';
import { TURNS } from '../../render/view';
import { ORE_DENSITY, seamShare } from '../../world/ore';
import {
  BUSH_DEFS, groundRoll, ROCK_VARIANTS, SLAB_VARIANTS, STEPS_BRICKS, STEPS_LEAST, STEPS_MOST, STEPS_PLANKS, STEPS_SLABS, STEPS_TWIST, TILE_DEFS, TileType,
  TREE_DAWN_UTC, TREE_DEFS, WEAR_FALL, WEAR_MOST, WEAR_TRAIL, WEARS,
} from '../../world/tiles';
import { STEPS_BACK, stepsBack, STONE_DIFFICULTY, STONE_STEPS_BILL, TIMBER_DIFFICULTY, TIMBER_STEPS_BILL } from '../../game/steps';
import { ROSES_RULE } from '../../game/roses';
import { DEVICE_COUNT } from '../../render/furniture';
import { FLOWER_MOST, FLOWER_SEASONS } from '../../world/flowers';
import { SEASON_DAYS, SEASONS, YEAR_DAYS, YEAR_FROM } from '../../world/calendar';
import { BLOOMS, BUSH_EVERGREEN, BUSH_FLOWER_FROM, evergreen, LEAF_DAYS, SHED_DAYS, TURN_DAYS } from '../../render/foliage';
import { lifeSeasons } from '../../render/life';
import { COUNTS } from '../beltmenu';
import { DAMAGE_BREAKING } from '../itemcells';
import type { UIWindow } from '../windows';
import { IDLE_LOGOUT } from '../../game/keep';
import { awayFor } from '../../game/away';
import { BOARD_RULES, REFRESH as BOARD_REFRESH } from './boards';
import { LETTER_MAX } from '../../net/island';
import { KEYS as NUMBER_KEYS } from './tile';
import { HUNGRY_AT, HURT_AT } from './wildermon';

/** What a cellar's rock gives, by the stone: every stone's own shards. */
const CELLAR_SHARDS = listed(ROCK_VARIANTS.filter((r) => r.yields.endsWith('_shards')).map((r) => itemDef(r.yields).name.toLowerCase()));
/** The perk that lowers what a vein wants of a miner (`ore:below`). */
const ORE_SENSE = PERKS.find((p) => 'ore:below' in p.fx);
/** The pieces that do not go down into a cellar, by name: what burns an open fire, and `cellarOutdoor` but the grave nobody makes. */
const CELLAR_BURNS = FURNITURE.filter((d) => d.hearth).map((d) => article(d.name) + ' ' + d.name.toLowerCase());
const CELLAR_NOT_DOWN = FURNITURE.filter((d) => cellarOutdoor().includes(d.id) && d.bill.length).map((d) => article(d.name) + ' ' + d.name.toLowerCase());

/** The Farmer's perk that holds an effect, by name. */
const farmerPerk = (key: string): string => perksOf('farmer').find((p) => key in p.fx)?.name ?? key;
/** What a tile of glass roof of a shape takes: "12 glass panes and 4 timbers". */
/** The wall types too low to close in a glasshouse, from their own `low`: "a fence, a fence gate, an iron-bound gate or a half wall". */
const lowWalls = (): string => {
  const names = WALL_TYPES.filter((w) => w.low).map((w) => w.name.toLowerCase()).map((n) => `${article(n)} ${n}`);
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
};
/** What a tile of glass roof takes, on the shape Plan roof lays: "12 glass panes and 4 timbers". */
const glassTile = (): string =>
  listed(Object.entries(floorBill(GLASS_ROOF.id, 'roof', roofShapeOf(undefined)).total).map(([id, n]) => `${n} ${materialName(id, n)}`));
/** The Farmer's perks that work on a planter as on a field: whatever a sowing or a harvest reads, but for Crop Rotation, which a planter keys to itself. */
const planterPerks = () => perksOf('farmer').filter((p) => !('rotate:plant_seed' in p.fx)
  && Object.keys(p.fx).some((k) => /:(plant_seed|harvest_crop)$/.test(k) || k.startsWith('plus:')));
/** How long a quiet browser is still counted as there: `idle_logout()` on the island. */
const awayAfter = (): string => (IDLE_LOGOUT % 60 ? `${+(IDLE_LOGOUT / 60).toFixed(1)} minutes` : awayFor(IDLE_LOGOUT));

/*
 * Every number in the help is the rule's own, read off the constant, the
 * table or the function that decides it, so that the text cannot drift from
 * what the game does (`CLAUDE.md`; `supabase/test/benefit.ts` asks). The few
 * helpers below read those tables the way a sentence wants them.
 */

/** A recipe by its id. A missing one is a mistake in the help, and says so. */
const recipe = (id: string) => {
  const r = RECIPE_BY_ID.get(id);
  if (!r) throw new Error(`The help names a recipe there is not: ${id}`);
  return r;
};
/** What a recipe takes, as it is read: "a shaft, two leathers and four nails", or in figures. */
const bill = (id: string, figures = false): string =>
  billWords(recipe(id).inputs.map((i) => [i.item, i.count ?? 1] as const), figures);
/** How many of one thing a recipe takes. */
const need = (id: string, item: string): number => {
  const input = recipe(id).inputs.find((i) => i.item === item);
  if (!input) throw new Error(`The help says ${id} takes ${item}, and it does not.`);
  return input.count ?? 1;
};
/** How many a recipe makes. */
const made = (id: string): number => recipe(id).count ?? 1;
/** What a skill a recipe is worked on is called, and how hard the recipe is: "ropemaking 6". */
const workedAt = (id: string): string => {
  const r = recipe(id);
  return `${(SKILL_BY_ID.get(r.skill)?.name ?? r.skill).toLowerCase()} ${r.difficulty ?? 0}`;
};
/** A material by its id. */
const mat = (id: string): MaterialDef => {
  const m = MATERIAL_BY_ID.get(id);
  if (!m) throw new Error(`The help names a material there is not: ${id}`);
  return m;
};
/** A kind of ground. */
const ground = (t: TileType) => TILE_DEFS[t];
/** What a kind of ground takes off a full wagon's pace. */
const rollCost = (t: TileType): number => 1 - groundRoll(ground(t).roll, 1);
/**
 * The day a tile walked `steps` times a day wears through to a trail, a
 * night's fall coming off between one day and the next; or none, when the
 * nights take off all the days put on.
 */
const daysToTrail = (steps: number): number | null => {
  let wear = 0;
  for (let day = 1; day <= 4 * WEAR_MOST; day++) {
    wear = Math.min(WEAR_MOST, wear + steps);
    if (wear >= WEAR_TRAIL) return day;
    wear = Math.max(0, wear - WEAR_FALL);
  }
  return null;
};
/** "once", "twice", "three times": how often a thing is done in a day. */
const often = (n: number): string => (n === 1 ? 'once' : n === 2 ? 'twice' : `${numberWord(n)} times`);
/** A walk there and back puts a step on every tile of the way each way. */
const STEPS_A_TRIP = 2;
/** The walks there and back a day the help works a trail out for. */
const TRIPS_A_DAY = [1, 2] as const;
/** How much of one of the four a thing feeds. */
const feeds = (id: string, nutrient: string): number => (itemDef(id).feeds as Record<string, number> | undefined)?.[nutrient] ?? 0;
/** A shop counter's wall type, and the hinges it is hung with (`counters.ts`). */
const COUNTER_TYPE = WALL_TYPE_BY_ID.get(COUNTER_WALL) ?? { factor: 1, fittings: [] as Array<[string, number]> };
const counterHinges = COUNTER_TYPE.fittings?.find(([id]) => id === 'hinge')?.[1] ?? 0;
/** The best anything can be made, and the roughest. */
const TOP_QL = 100;
const LOW_QL = 1;
/** Seconds in an hour of the clock on the wall. */
const HOUR = 3600;
/** An hour of the island's clock as the hud shows it: "21:00". */
const hudHour = (h: number): string =>
  `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/** The creatures that carry a light of their own, and the ones whose blows burn. */
const GLOWING = Object.values(SPECIES).filter((s) => s.glow);
const BURNERS = Object.values(SPECIES).filter((s) => s.wound === 'burn');
/** The share of a day the sun is up. */
const DAYLIT = (DUSK - DAWN) / 24;
/** Where a skill starts, and the top of any skill. */
const startOf = (id: string): number => SKILL_BY_ID.get(id)?.start ?? 1;
const TOP_SKILL = 100;
/** Kilos over the mark to show the drag of, and what a full suit of iron plate drags. */
const OVER_EXAMPLE = 100;
const PLATE_SUIT = ARMOUR_CLASSES.plate.burden * mat('iron').weight;
/** Jobs a copper tool of this quality does before it goes to pieces, to the nearest ten. */
const jobsAt = (ql: number): number => Math.round(DAMAGE_MAX / (wearPerUse(ql) * mat('copper').wear) / 10) * 10;
/** A badly worn tool and a skilled repairer, to show what repair costs. */
const WORN = 80;
const SKILLED = 90;
const repairGoes = (skill: number): number => Math.ceil(WORN / repairGo(skill).healed);
const repairCost = (skill: number): string => `${+(WORN * repairGo(skill).cost).toFixed(1)} points`;
/** The kinds of wound. */
const KINDS = Object.values(WOUND_KINDS);
/** What a go's quality is spread over when it is not simply your skill. */
const QL_SPREAD = `${QL_LOW} to ${+(QL_LOW + QL_SPAN).toFixed(2)} times`;

/** Height units as metres, a tenth of a metre each, to one place: 0.3 for three. */
const metres = (units: number): string => (units / 10).toFixed(1);
/** The railing's wall type, for its share of a wall's bill. */
const railing = WALL_TYPE_BY_ID.get('railing') ?? { factor: 0 };
/** The weight rule in words: each weight of material, what it is, and what has to be under it. */
const heftGroups = (): string => {
  const hefts = [...new Set(WALL_MATERIALS.map((m) => m.heft))].sort((a, b) => a - b);
  const or = (xs: string[]): string => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
  return hefts.map((h) => `${HEFT_WORDS[h]} (${listed(WALL_MATERIALS.filter((m) => m.heft === h).map((m) => m.name.toLowerCase()))}) goes over `
    + `${h === hefts[0] ? 'anything' : h === hefts[hefts.length - 1] ? `${HEFT_WORDS[h]} only` : or(hefts.filter((k) => k >= h).map((k) => HEFT_WORDS[k]))}`).join('; ');
};
/** A column's bill in the lightest and the heaviest of the materials. */
const columnBills = (): string => ['log', 'marble'].map((m) => `${billWords(Object.entries(columnBill(m).needed), true)} in ${m}`).join(', ');

/** The steps of rarity above the ordinary. */
const RARE_STEPS = RARITIES.map((_, i) => i).slice(1);
/** How long a go at a book is, as the action has it. */
const STUDY_TIME = ARCHAEOLOGY_ACTION_BY_ID.get('study_book')?.baseTime ?? 0;

/** Stone that ages: the two clearings, and the day a thing at a pace is covered on. */
const [CLEAR_IVY, SCRUB_MOSS] = GREEN_ACTIONS;
/** Planning a wall, which a hidden door's plan is in every way anybody else can see. */
const PLAN_WALL = ACTION_BY_ID.get('plan_wall');
/** Pulling a bridge down, which a settlement keeps to its builders. */
const BRIDGE_PULL = ACTION_BY_ID.get('demolish_bridge');
const AQUEDUCT_PULL = ACTION_BY_ID.get('demolish_aqueduct');
const coveredBy = (pace: number): number => Math.ceil(GREEN_DAYS / pace);
/** A name as the middle of a sentence has it, with its article: "a statue". */
const aOrAn = (name: string): string => `${article(name)} ${name.toLowerCase()}`;
/** The dyes, easiest first. */
const DYES_EASIEST = [...DYES].sort((a, b) => a.difficulty - b.difficulty);

/** Where armour is worn, and the classes of it anybody can make: all but the one riveted from a dragon. */
const ARMOUR_SLOTS = [...new Set(ARMOUR.map((a) => a.slot))];
const MADE_ARMOUR = Object.values(ARMOUR_CLASSES).filter((c) =>
  !ARMOUR.some((a) => a.cls === c.id && RECIPE_BY_ID.get(`make_${a.id}`)?.inputs.some((i) => i.item === 'dragon_scale')));
/** The kinds of weapon, each its own subskill, and the bows strung with a bowstring. */
const WEAPON_KINDS = [...new Set(WEAPONS.map((w) => w.kind))];
const WOOD_BOWS = WEAPONS.filter((w) => w.ammo && RECIPE_BY_ID.get(`make_${w.id}`)?.inputs.some((i) => i.item === 'bow_string'));
/** What gives feathers: butchered, or plucked. */
const FEATHERED = Object.values(SPECIES).filter((s) => s.butcher?.feather || s.shearYield === 'feather');
/** The relic in the most pieces, which the list runs up to. */
const LAST_RELIC = RELICS[RELICS.length - 1];

/** The mining a metal's seam asks for. */
const METAL_LEVEL = (id: string): number => METALS.find((m) => m.id === id)?.level ?? 0;
/** An Orse under a rider, green and with its climbing worked right up. */
const ORSE_GREEN = SPECIES.orse.speed * footing(0);
const ORSE_WORKED = Math.min(MAX_MOUNT_SPEED, SPECIES.orse.speed * footing(TOP_SKILL));
/** What each settlement level asks for, as the deed menu says it. */
const UPGRADES_SAID = listed(Object.entries(DEED_UPGRADES).map(([level, reqs], i) =>
  `level ${level} ${i === 0 ? 'wants ' : ''}${listed(reqs.map((r) => `${r.label[0].toLowerCase()}${r.label.slice(1)}`))}`));
/** How far a worker starts from the token, sort by sort, and the sorts whose range grows by other than the usual step. */
const WORK_RANGES = [...new Set(Object.values(SPECIES).filter((s) => !s.monster).map((s) => s.workRange))].sort((a, b) => a - b);
const RANGE_STEPS_SAID = (() => {
  const odd = new Map<number, string[]>();
  for (const s of Object.values(SPECIES)) {
    if (s.rangePerStep && s.rangePerStep !== RANGE_PER_STEP) odd.set(s.rangePerStep, [...(odd.get(s.rangePerStep) ?? []), `a ${s.name}`]);
  }
  return listed([...odd.entries()].sort((a, b) => a[0] - b[0]).map(([n, names]) => `${listed(names).replace(/ and ([^,]*)$/, ' or $1')} ${n}`));
})();
/** How many passes a forager takes over a tile, at the skills worth naming. */
const PASSES_SAID = listed([0, PER_ROLL, 2 * PER_ROLL, TOP_SKILL].map((at, i) =>
  (i === 0 ? `${numberWord(rollsAt(at))} pass below ${numberWord(PER_ROLL)}` : `${numberWord(rollsAt(at))} at ${numberWord(at)}`)));

/** A sentence's first letter down, for one set inside another. */
const lowerFirst = (t: string): string => (t ? `${t[0].toLowerCase()}${t.slice(1)}` : t);
/** The things that are not wildermon, how far off they notice you, and how their weights add up. */
const MONSTER_SORTS = Object.values(SPECIES).filter((s) => s.monster);
const NOTICED = MONSTER_SORTS.map((s) => s.notice ?? HUNT_SIGHT).sort((a, b) => a - b);
const MONSTER_WEIGHT = MONSTERS.reduce((n, [, w]) => n + w, 0);
/** A hoard's deep metals: the ones nobody strikes a coin from. */
const HOARD_DEEP = HOARD_METALS.filter((id) => !COIN_METALS.some((m) => id === `${m}_lump`));
/** The composite bow, the best of the wooden ones, and what a suit of scale takes. */
const COMPOSITE = WEAPONS.find((w) => w.id === 'composite_bow') ?? WEAPONS[0];
const BEST_WOOD_BOW = [...WOOD_BOWS].sort((a, b) => (b.range ?? 0) - (a.range ?? 0))[0] ?? WEAPONS[0];
const SCALE_SUIT = ARMOUR.filter((a) => a.cls === 'scale').reduce((n, a) => n + need(`make_${a.id}`, 'dragon_scale'), 0);
/** The least and the most a trait of each tier moves the number it moves most. */
const TIER_SPAN = Object.fromEntries(TIERS.map((tier) => {
  const most = TRAITS.filter((t) => t.tier === tier).map((t) => Math.max(...Object.values(t.effects).map((m) => Math.abs((m ?? 1) - 1))));
  return [tier, [Math.min(...most), Math.max(...most)]];
})) as Record<TraitTier, [number, number]>;
/** The seams in the rock, by the mining each asks, and what one is called in a list. */
const SEAMS = ROCK_VARIANTS.filter((r) => r.level).sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
const seamName = (name: string): string => name.replace(/ (vein|seam)$/, '').toLowerCase();
/** What an ordinary go teaches at a level, and the levels worth showing it at. */
const GAIN_AT = [1, 50, 90, 99];
const gainAt = (level: number): number => skillGain(level, ORDINARY_GAIN, 1);
const gainSaid = (level: number): string => String(Number(gainAt(level).toPrecision(gainAt(level) >= 0.1 ? 2 : 1)));

/** What a creature crate is built of, read off its bill: "8 × plank, 4 × nails and 2 × metal ribbon". */
const crateBill = (): string => {
  const parts = furnitureDef(CREATURE_CRATE).bill.map(([id, n]) => `<b>${n} × ${itemDef(id).name.toLowerCase()}</b>`);
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};

// ---- What the help counts and compares, each off the table that decides it. ----

/** A trade's tree: its columns, and the ranks in each. */
const COLUMNS = CLASS_COLUMNS[CLASS_NODES[0].class].length;
const RANKS = NODES_PER_TRADE / COLUMNS;
/** What a node of this rank costs. */
const costOf = (rank: number): number => CLASS_NODES.find((n) => n.rank === rank)?.cost ?? 0;
/** The same, as it is said: "a point", "three points". */
const pointsFor = (rank: number): string => (costOf(rank) === 1 ? 'a point' : `${numberWord(costOf(rank))} points`);
/** What a node of this channel and rank says on its card. */
const nodeSays = (ch: Channel, rank: number): string => CLASS_NODES.find((n) => n.channel === ch && n.rank === rank)?.note ?? '';
/** The trades moved over to perks, and the first perk of the first of them, as its card says it. */
const PERK_TRADES = CLASSES.filter((c) => PERK_CLASSES.has(c.id));
const FIRST_PERK = PERK_TRADES.length ? perksOf(PERK_TRADES[0].id)[0] : undefined;
/** A Forester's perk's numbers, by the perk's name. */
const forester = (name: string): Record<string, number> => perksOf('forester').find((p) => p.name === name)?.fx ?? {};
const BRUSH_SIDE = 2 * (forester('Clear Brush').clear_brush ?? 0) + 1;
const farmer = (name: string): Record<string, number> => perksOf('farmer').find((p) => p.name === name)?.fx ?? {};
const cook = (name: string): Record<string, number> => perksOf('cook').find((p) => p.name === name)?.fx ?? {};
const fisher = (name: string): Record<string, number> => perksOf('fisher').find((p) => p.name === name)?.fx ?? {};
const tailor = (name: string): Record<string, number> => perksOf('tailor').find((p) => p.name === name)?.fx ?? {};
const herdsman = (name: string): Record<string, number> => perksOf('herdsman').find((p) => p.name === name)?.fx ?? {};
const PATCH_SIDE = 2 * (farmer('Sow a Patch').sow_patch ?? 0) + 1;
/** How many channels the rites push, from the narrowest to the widest. */
const riteWidths = [...new Set(RITES.map((r) => Object.keys(r.muls).length))].sort((a, b) => a - b);
/** What a rite does to its channels, as its card says it. */
const riteSays = (id: string): string =>
  Object.entries(riteDef(id)?.muls ?? {})
    .map(([ch, mul]) => `${CHANNELS[ch as Channel].note.toLowerCase()} ${channelSays(mul)}`)
    .join(', ');
/** Where awareness starts, which is not where the other characteristics do. */
const AWARE_START = SKILL_BY_ID.get(AWARENESS)?.start ?? CHAR_START;
/** The things that hold other things and go in a pack. */
const BAGS = Object.keys(ITEM_DEFS).filter((id) => ITEM_DEFS[id].holds);
/** The pieces a fine carpenter builds, and the ones among them that hold things. */
const FINE = FURNITURE.filter((f) => RECIPE_BY_ID.get(`make_${f.id}`)?.skill === 'fine_carpentry');
const HOLDERS = FINE.filter((f) => f.capacity && !f.liquid).sort((a, b) => (a.capacity ?? 0) - (b.capacity ?? 0));
/** How many ways a piece can face. */
const SIDES = Object.keys(SIDE_NAMES).length;
/** The hulls, and the vehicles that are driven. */
const BOATS = FURNITURE.filter((f) => f.boat);
const ROWER = furnitureDef('rowing_boat');
const SAILER = furnitureDef('sailing_boat');
const SHIP = furnitureDef('caravel');
const CART = furnitureDef('large_cart');
const WAGON = furnitureDef('wagon');
/** The barrels, smallest first. */
const BARRELS = FURNITURE.filter((f) => f.liquid).sort((a, b) => (a.liquid ?? 0) - (b.liquid ?? 0));
/** What the bins that weigh rather than count will take, in kilos. */
const CRAFT_HEFT = furnitureDef('craft_bin').heft ?? 0;
const SEED_HEFT = furnitureDef('seed_bin').heft ?? 0;
const SPROUT_HEFT = furnitureDef('sprout_bin').heft ?? 0;
/** A settlement's width, token and all. */
const DEED_ACROSS = DEED_RADIUS * 2 + 1;
/** What a gold coin is worth in silver, and a handful of small change for the example. */
const GOLD = (COIN_WORTH.Gold ?? 0) / (COIN_WORTH.Silver ?? 1);
const POCKET = 5;
/** The metals out of the deep seams: the rare ones nobody strikes a coin from. */
const DEEP_METALS = [...RARE_METALS].filter((m) => !COIN_METALS.includes(m));
/** A quality to show a hatchet at, and a helping at. */
const HATCHET_QL = 40;
const BOON_QL = 70;
/** The brew a quern skips the barrel for. */
const CIDER = BREW_BY_ID.get('cider') ?? BREWS[0];
/** The trees that bear. */
const FRUIT_TREES = TREE_DEFS.filter((t) => t.fruit);
/** Which of them flower in which colour, the colour first: "deep pink on cherry, peach and pomegranate". */
const FLOWER_KINDS: Array<[string, string[]]> = (['deep pink', 'pale pink', 'white'] as const).map((family) => [
  family, FRUIT_TREES.filter((t) => BLOOMS[t.fruit ?? '']?.family === family).map((t) => t.name.toLowerCase()),
]);
/** How long a helping's knack holds, from the least filling at its worst to the most at its best. */
const DISH_TIMES = BOON_FOODS.flatMap((id) => [boonTime(id, 1), boonTime(id, TOP_QL)]);
const DISH_SHORTEST = Math.min(...DISH_TIMES);
const DISH_LONGEST = Math.max(...DISH_TIMES);
/** What a mould asks of the smelter and gives back. */
const mouldNote = (id: string): string => {
  const m = MOULDS.find((x) => x.id === id);
  if (!m) throw new Error(`The help names a mould there is not: ${id}`);
  const lumps = m.lumps === 1 ? 'a lump of metal' : `${numberWord(m.lumps)} lumps of metal`;
  return `poured at the smelter and beaten out on an anvil, ${lumps} ${m.per ? `to ${numberWord(m.per)}` : 'to each'}`;
};
/** What a full wagon takes over this ground to cover what it covers in a minute on slabs. */
const wagonMinute = (t: TileType): number => {
  const pace = (g: (typeof TILE_DEFS)[TileType]): number => g.speed * groundRoll(g.roll, 1);
  return (60 * pace(ground(TileType.Slabs))) / pace(ground(t));
};
/** A sailing boat to show the wind on, and what she makes at each point of sail in it. */
const SAIL_EXAMPLE = { ql: 50, force: 0.6 };
const sailSpeeds = listed(
  [Math.PI / 2, Math.PI, NO_GO, 0].map((upwind) =>
    (SAILER.boat ? hullSpeed(SAILER.boat, SAIL_EXAMPLE.ql, CHAR_START, windWorth(SAIL_EXAMPLE.force) * pointAt(upwind), 0) : 0).toFixed(1)),
);

/** Where a bred one's trait can have come from, in the words its card uses: "<b>from the dam</b> (drawn from …), …". */
const pedigreeSources = (): string => {
  const parts = Object.values(TRAIT_SOURCES).map((s) => `<b>${s.label}</b> (${s.means})`);
  return `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`;
};

export function helpText(): string {
  const CRATE_BILL = crateBill();
  const PEDIGREE_SOURCES = pedigreeSources();
  return `
    <h3>Getting around</h3>
    <p><b>You walk by clicking.</b> Nothing on the keyboard moves you: the keys move the
    <i>view</i>, which is a different thing and used far more often. Click where you want to be
    and you will set off, going round whatever is in the way.</p>
    <table>
      <tr><td><kbd>Left click</kbd></td><td>Walk to a tile — the only thing that moves you</td></tr>
      <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / <kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></td><td>Push the view about (detaches the camera)</td></tr>
      <tr><td><kbd>Drag</kbd></td><td>The same, with the mouse</td></tr>
      <tr><td><kbd>Scroll</kbd> / <kbd>+</kbd> <kbd>-</kbd></td><td>Zoom</td></tr>
      <tr><td><kbd>C</kbd></td><td>Centre the camera on yourself, and have it follow again</td></tr>
      <tr><td><kbd>Q</kbd> <kbd>E</kbd></td><td>Turn the view ${share(1 / TURNS)} of a turn; the compass shows north</td></tr>
    </table>
    <p>Every key here can be changed: <b>Settings</b> (<kbd>O</kbd>) has a <b>Keys</b> tab with the
    whole list in it. Click a key, press the one you would rather have, and it is set — a key that
    was already doing something else is taken off it rather than doing both. The number keys
    <kbd>1</kbd>–<kbd>0</kbd> are the exception and cannot be moved: they always answer to whatever
    the Tile window or the toolbelt is offering.</p>
    <h3>Touch screens</h3>
    <table>
      <tr><td>Tap</td><td>Walk to a tile</td></tr>
      <tr><td>Drag</td><td>Look around</td></tr>
      <tr><td>Pinch</td><td>Zoom</td></tr>
      <tr><td>Long press</td><td>Actions for a tile or tree</td></tr>
    </table>
    <h3>Doing things</h3>
    <table>
      <tr><td><kbd>Right click</kbd></td><td>Actions for a tile or tree</td></tr>
      <tr><td><kbd>Click</kbd> an item</td><td>Its actions: eat, drink, drop, examine…</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Stop the current action and forget what is lined up</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Talk in the event window</td></tr>
    </table>
    <h3>The event log, and finding things in it</h3>
    <p>The log is cut into tabs: <b>All</b>, <b>Work</b> (what your hands have been doing),
    <b>Combat</b> (every blow given and taken, what has your scent, and what went down),
    <b>Skills</b> (what you have learned), <b>Talk</b> and <b>Trouble</b> (what went wrong, and why).
    A tab with lines waiting on it says how many, and opening it clears the count. The box beside the
    tabs searches whatever tab you are on, and <kbd>Esc</kbd> in it clears the search.</p>
    <h3>Marks on the map, and the way home</h3>
    <p>An island is a great many tiles and the good clay is on one of them. <b>Right-click the map</b>
    (<kbd>M</kbd>), or press <b>Mark here</b>, to pin a name to a spot; the tile's own menu offers the
    same with a colour chosen up front. Marks are drawn as pins with their names beside them, listed
    under the map nearest first, and each has a <b>Go</b> button that walks you to it. Click a pin's
    dot in the list to cycle its colour, click its name to rename it, and × rubs it off. The map holds
    ${numberWord(MARK_CAP)} of them; past that the oldest is pushed off.</p>
    <p><kbd>Home</kbd>, or the <b>Walk home</b> button on the map, sets off for your settlement token
    &mdash; or, before you have founded anything, for the shore you came in on or the last bed you
    woke in.</p>
    <h3>The camera</h3>
    <p>The view keeps to you by default; dragging it away lets it go, and <kbd>C</kbd> or the
    <b>Centre</b> button takes it back. Resting the cursor against the <b>edge of the screen</b>
    slides the view that way, harder the closer to the edge, which is a way of looking about without
    holding the mouse down &mdash; and, like dragging, it lets the camera go until you call it back.
    Neither happens while the cursor is over a window or the toolbar. Both can be turned off in
    Settings (<kbd>O</kbd>) if you would rather only drag.</p>
    <h3>Your wildermon, in order</h3>
    <p>The Wildermon window (<kbd>P</kbd>) has a search box and an order: by name, level, kind,
    health, hunger, care, age, or the best trait each one carries. The search matches a name, a kind,
    a job, an age, an orders setting or any trait, so "supreme" finds everything worth breeding from
    and "hungry" is answered by the footer, which counts the herd and says how many are hungry or
    hurt. Grouped lists them by where they are; Flat runs the whole herd together.</p>
    <p>Any one of them that wants something says so on its own card: a <b>hurt</b> tag on anything
    under ${percent(HURT_AT)} of the health it can carry, a <b>hungry</b> one on anything under ${percent(HUNGRY_AT)} fed, and the card
    itself outlined so it is found by scrolling rather than by reading. The counts in the footer are
    buttons &mdash; click one and the herd is laid out flat, worst first, with nothing filtered out,
    so a count of what is wrong takes you to it.</p>
    <h3>Other people</h3>
    <p>Right-click somebody standing on the island and you can <b>invite them to your settlement</b>,
    <b>ask them to be a friend</b>, or <b>write to them</b>. All of them live in the <b>Social</b> window
    (<kbd>Y</kbd>) as well, under its tabs: <b>Waiting</b> is everything that wants a yes or a no
    from you, <b>Friends</b> is everybody you know and where they are, and <b>Letters</b> is what has
    been written.</p>
    <p>A <b>citizen</b> of a settlement may build on its land, use its crates and stores, and draw from
    its water, exactly as the founder does. Disbanding, upgrading, renaming and setting wildermon to
    work stay with whoever planted the stake.</p>
    <p>You may found <b>one</b> settlement of your own and be a citizen of <b>${numberWord(DEEDS_JOINED)}</b> others, whether
    or not you hold one. A border you may work inside is drawn at the same weight as your own, so land
    you were asked onto does not look like a stranger's. Leaving a roll frees the place at once, and an
    invitation you had no room for is left standing until you do.</p>
    <p>To <b>leave</b> a settlement you were asked onto, right-click its land and choose <b>Leave</b> under
    its name, or use the button in the Settlement window or the People window. You come off its roll at
    once and are a stranger there: you may walk it and shape nothing, and of the stores on it only the ones
    you made yourself still open for you. Its founder is told, and only a new invitation puts you back.</p>
    <p>A <b>friend</b> is mutual: you ask, they say yes, and after that each of you can see where the
    other is &mdash; but only while they are actually at the keyboard. A friend who has gone shows as
    away and nothing more. <b>Letters</b> are kept: one reaches an open tab the moment it is written and
    is still waiting the next time somebody looks, however long that takes.</p>
    <p><b>While you were away.</b> Once your browser has said nothing to the island for
    ${awayAfter()}, the island counts you as gone, and from then until you come back it keeps count for
    you: every load your workers put into the stores, by item; every young one born to your wildermon,
    and any that went off into the wild because something already followed you and there was no empty
    creature crate for it; everything your stalls sold and the silver it went for; everything brought
    to your buy orders and the silver it cost; and every parcel posted to you, by who sent it. When you
    come back a window lists all of it, and the same lines go into the event log.</p>
    <h3>Leaderboards</h3>
    <p>The <b>Leaderboards</b> window (<kbd>F2</kbd>) ranks everybody on an island, and asks the island again
    every ${BOARD_REFRESH} seconds while it is open. <b>Skills:</b> ${BOARD_RULES.skills}
    <b>Wildermon:</b> ${BOARD_RULES.wildermon} <b>Settlements:</b> ${BOARD_RULES.settlements}
    In a game of your own there is nobody to rank against, so it shows your best skill (characteristics not
    counted), your best-bred wildermon and your settlement instead, each measured the way its board measures.</p>

    <h3>The settlement window</h3>
    <p><kbd>N</kbd> opens the settlement at a glance: its level and how far the border runs, how many
    wildermon are working of how many it can take, what the next upgrade still wants and the button
    that buys it, everything standing inside the border, and the standing orders for everything kept
    there. Each thing listed has a button that walks you to it.</p>
    <h3>What a tool is worth</h3>
    <p>A tool is rarely worth the number stamped on it. Damage drags it down, the metal of its head
    lifts or lowers it, and rarity and a blessing lift it further &mdash; and it is that figure, not
    the quality it was made at, that decides how fast a job goes, how often it comes out right, and
    how good what comes out of it is. The pack shows both when they differ, the quality and then
    <b>&rarr;</b> what it is worth, and examining a thing says it in words.</p>
    <h3>The number keys</h3>
    <p>The number keys mean different things depending on what is in front of you. With something
    <b>selected</b> in the Tile window (<kbd>T</kbd>) &mdash; a tile, a tree, a wildermon, a crate
    &mdash; <kbd>1</kbd> to <kbd>9</kbd> and <kbd>0</kbd> do the <b>first ${numberWord(NUMBER_KEYS.length)} things that can actually
    be done to it</b>, in the order the window lists them, and each row shows its key. A row that only
    opens onto more choices takes no key, and neither does one that is greyed out with a reason, so a
    number never does nothing. With <b>nothing selected</b>, or the window shut, the same keys press
    the loops on your belt; the belt bar dims while the window has them.</p>
    <h3>What a wildermon's tooltip tells you</h3>
    <p>Pointing at a creature says what is actually worth knowing about it rather than a line of
    colour. A <b>wild</b> one gives its kind and age, what it will take from your hand, the taming it
    asks against the taming you have, and <b>the real odds of one offering</b> &mdash; the same number
    the attempt itself rolls against, hunger, soul, age, path and a run of offerings all counted. One
    of <b>your own</b> gives its name, sex, kind, age and level; its health and how full it is, with a
    bar for each; how well it has been brushed; what it is doing and how good it is at it, with a
    worker's reach in tiles; the traits it carries, marked when they are better than common and left
    as <i>something unread</i> until your animal husbandry is high enough to read them; and how long a
    carried young has left. A <b>monster</b> gives its health and what it hits for, and says plainly
    that it cannot be tamed.</p>
    <h3>The belt, and doing a thing many times</h3>
    <p>A job that runs on and on &mdash; digging, mining, chopping, making bricks &mdash; is offered by
    the handful as well as one at a time: <b>once</b>, ${COUNTS.map(numberWord).join(', ')}, or <b>until you
    stop</b>. Pick a number and it counts itself down and puts the work away when it is done, and the
    action bar says how far through it is, so a run of bricks is one right-click rather than one
    each.</p>
    <p>Stitch a <b>toolbelt</b> (${bill('make_toolbelt')}, on an awl) and wear it, and it carries the
    jobs you do most. It has <b>one loop for every ${numberWord(QL_PER_LOOP)} points</b> of how well it was made, to a full ${numberWord(BELT_MAX)}
    loops on a perfect one, and every loop answers to a number key &mdash; <kbd>1</kbd> to <kbd>9</kbd>,
    and <kbd>0</kbd> for the tenth. Hang a job on a loop from any menu, by the entry
    <i>Hang a job on your belt</i>. A job hung from your pack remembers the <b>kind</b> of thing rather
    than the one in your hand, so the loop still works on the next loaf you bake; a job hung from the
    ground is done <b>wherever you are pointing</b>, and on the tile under your own feet when you are
    pointing at nothing. Right-click a loop to take the job off it again. Take the belt off and the
    loops go with it, but nothing on them is forgotten.</p>
    <p>Ask for a second job while the first is still going and it <b>lines up behind it</b> rather than
    pushing it aside: it starts the moment the one in hand is done, walking you over if it needs to. The
    bar above the action shows what is waiting. You can keep <b>${numberWord(BASE_QUEUE)}</b> jobs in your head to begin
    with, and one more for every ${numberWord(QUEUE_PER_MIND)} points of <b>mind logic</b>, which is earned by crafting. Walking
    off, stopping with <kbd>Esc</kbd> or clicking somewhere else forgets the lot.</p>
    <h3>What the characteristics are for</h3>
    <p><b>Work, and only work.</b> Eating, drinking, and carrying things in and out of crates, bags and
    barrels teach the body nothing: they cost what wind they cost and leave every characteristic where
    it was. Swinging, building, digging and hauling are what the body learns from.</p>
    <p>The characteristics start at ${CHAR_START} and rise slowly from the work that uses them, and each one
    does something plain:</p>
    <table>
      <tr><td><b>Body strength</b></td><td>How hard you hit. Earned by fighting.</td></tr>
      <tr><td><b>Body stamina</b></td><td>Less wind spent per action and quicker to get it back. Earned by spending it.</td></tr>
      <tr><td><b>Body control</b></td><td>Everything takes less time. Earned by doing any <i>work</i> at all.</td></tr>
      <tr><td><b>Mind logic</b></td><td>Jobs you can line up, and difficult crafts come out right more often. Earned by crafting.</td></tr>
      <tr><td><b>Soul strength</b></td><td>A wild animal is readier to trust you. Earned by taming, success or not.</td></tr>
    </table>
    <p><b>Climbing</b> raises the step you can take between tiles from ${MAX_STEP} and the slope of a tile
    you can stand on from ${MAX_STAND}, both by ${CLIMB_PER_LEVEL} a level &mdash; ground that turns you back
    at the start is walkable once you have worked at it. It is earned on your own feet, by every step
    between tiles more than ${share(CLIMB_LEARN_FROM)} of ${MAX_STEP} up or down, and more for a steeper
    one: not in a saddle, on a cart or a boat, on a bridge, on an upper floor or on or off a flight of garden steps.
    <b>Swimming</b> makes deep water less of a wade and costs less wind, and is earned by being out of
    your depth. Neither announces every scrap it picks up; both say so as they pass each whole point,
    and the Skills window (<kbd>K</kbd>) shows what each one is worth right now.</p>
    <h3>What you can see</h3>
    <p>The island starts unknown and is uncovered by walking it. Ground comes in the states below, and
    the map shows each of them differently.</p>
    <table>
      <tr><td><b>Unknown</b></td><td>Never laid eyes on. <b>Black</b>: no ground, no trees, nothing
      drawn at all, and it cannot be clicked or acted on. Not a dark patch of map &mdash; a hole in
      it.</td></tr>
      <tr><td><b>In sight</b></td><td>Somebody is looking at it now. Drawn as it is, in full colour,
      with everything standing on it.</td></tr>
      <tr><td><b>Remembered</b></td><td>Walked, but not watched. Drawn in <b>grey</b>, without detail,
      and <b>as it was when you last saw it</b> &mdash; fell a wood, walk away, and the map keeps the
      trees until you go back and look. Colour is what an eye is getting now; a memory of a place is
      its shape and nothing else.</td></tr>
    </table>
    <p>What you have seen is the map. The circle you can see from where you stand is what turns black
    into grey, so the shape of the island is the shape of everywhere you have been.</p>
    <h4>Awareness, and how far that circle reaches</h4>
    <p><b>Awareness</b> is a characteristic like body strength, and it is the whole of how far you
    see. Everybody washes ashore with a body and a mind half grown and nobody washes ashore able to
    read a dark hillside, so it <b>starts at ${AWARE_START}</b> where the others start at ${CHAR_START} &mdash; and the
    ${numberWord(BASE_SIGHT)} tiles on the flat that this island used to give everybody is what it gives somebody at the
    top of it. At ${AWARE_START} you see ${percent(awarenessReach(AWARE_START))} of that &mdash; ${numberWord(Math.round(BASE_SIGHT * awarenessReach(AWARE_START)))}
    tiles on the flat against ${numberWord(BASE_SIGHT)}. What it is worth goes as the square root of the level, so the
    early levels are worth the most, and a few tiles more is the difference between being walked into
    and seeing it coming.</p>
    <p>It is learned in exactly one place: <b>fighting in the dark</b>. Nothing else on this island
    teaches it at all. Nothing teaches a person what they were not noticing like something coming out
    of the night at them &mdash; and it is weighted by how dark it actually is, so a scuffle at dusk is
    worth a fraction of one at the dead of night. Taking a blow teaches more than landing one.</p>
    <p>On top of that: <b>height is worth real distance</b>, a ridge hides the hollow behind it, a wood
    is ${numberWord(Math.ceil(1 / TREE_OPACITY))} trees deep to the eye, and the <b>dark takes ${share(NIGHT_LOSS)} of everything</b>. Your
    settlement is watched while you hold it, and your own wildermon are eyes of their own wherever they
    are working.</p>
    <p>Of a building's walls, only a <b>solid</b> one stops the eye. A window, a bay, a door, a double
    door, an arch and a gate are seen through, and a fence or a half wall is seen over, as far as you
    can see anywhere else &mdash; from a doorway you see the wedge of the room beyond it, and from inside
    a room all of it.</p>
    <p>All of that is in Settings under <b>Fog of war</b>, if you would rather see the whole island at
    once.</p>
    <p>The wildlife works the same way. An island holds so much of it, but only the stretch of country
    you are walking has it in the flesh: a creature left a long way behind is <b>put back on the books</b>
    for the country it was in, and comes out again when somebody walks that way. Nothing is ever seen to
    come or go &mdash; it happens well past the edge of anybody's sight &mdash; and the island keeps the same
    head of wildlife however far you wander. It is what lets the map grow without the game slowing down.</p>
    <h3>Windows</h3>
    <table>
      <tr><td><kbd>I</kbd></td><td>Inventory</td></tr>
      <tr><td><kbd>R</kbd></td><td>Crafting: everything you can make with what you carry</td></tr>
      <tr><td><kbd>T</kbd></td><td>Tile: everything you can do to the tile you last clicked</td></tr>
      <tr><td><kbd>Page Up</kbd> / <kbd>Page Down</kbd></td><td>Look at the storey above or below</td></tr>
      <tr><td><kbd>X</kbd></td><td>Cut away the walls facing you</td></tr>
      <tr><td><kbd>K</kbd></td><td>Skills</td></tr>
      <tr><td><kbd>F</kbd></td><td>Trades: what every trade offers, the one you took up, its tree or its perks, and its rite</td></tr>
      <tr><td><kbd>L</kbd></td><td>Event log</td></tr>
      <tr><td><kbd>M</kbd></td><td>Map</td></tr>
      <tr><td><kbd>G</kbd></td><td>Toggle the tile grid</td></tr>
      <tr><td><kbd>P</kbd></td><td>Wildermon: your tamed creatures' stats and actions</td></tr>
      <tr><td><kbd>J</kbd></td><td>Journal: everything worth doing, ticking itself off</td></tr>
      <tr><td><kbd>B</kbd></td><td>Ledger: everything you have ever made</td></tr>
      <tr><td><kbd>N</kbd></td><td>Settlement: your deed at a glance</td></tr>
      <tr><td><kbd>Y</kbd></td><td>Social: who is waiting on you, who you know, and what has been written</td></tr>
      <tr><td><kbd>O</kbd></td><td>Settings: what the island looks like, what every key does, and how you look</td></tr>
      <tr><td><kbd>F1</kbd></td><td>This help</td></tr>
      <tr><td>⤢ / double-click title</td><td>Expand a window to nearly the whole screen, and back</td></tr>
    </table>
    <h3>Trades</h3>
    <p>A trade is the thing you are, on top of the things you know. Take one to <b>${CLASS_AT}</b> in any skill it
    covers and it opens; you may hold <b>one craft trade and one fighting trade</b> at once, and the
    <b>Trades</b> window (<kbd>F</kbd>) is where you take them up and spend what they earn.</p>
    <p>A trade on a <b>tree</b> earns <b>points</b> off the best skill it covers, and its tree is <b>${numberWord(COLUMNS)} columns of
    ${numberWord(RANKS)}</b>. A column is one <b>channel</b>: one number in the rules, and every card names it and says
    exactly what that node does to it &mdash; ${(['hands', 'aim', 'knit'] as Channel[]).map((ch, i) => `<i>${nodeSays(ch, [1, 1, RANKS][i])}</i>`).join(', ')}.
    The lower nodes cost ${pointsFor(1)} each, the one above them costs ${numberWord(costOf(RANKS))}, and the lower must be
    bought first. A few channels are better lower &mdash; ${listed(Object.values(CHANNELS).filter((c) => c.lower).map((c) => c.note.toLowerCase()))}
    &mdash; and the sign on the card is the change to the number, so those read as a minus.</p>
    ${FIRST_PERK ? `<p>A trade on <b>perks</b> &mdash; ${listed(PERK_TRADES.map((c) => `the ${c.name}`))} &mdash; has no tree and no points.
    It has <b>${numberWord(PERK_TIER_AT.length)} tiers of ${numberWord(PERKS_PER_TIER)}</b>: the first opens with the trade and the others
    at ${listed(PERK_TIER_AT.slice(1).map(String))} in its main skill, and at each tier you take <b>one</b> of the
    ${numberWord(PERKS_PER_TIER)}. Every card says exactly what that perk changes and by how much &mdash;
    ${FIRST_PERK.name}: <i>${FIRST_PERK.note}</i> A perk taken is kept for as long as the trade is.</p>` : ''}
    <p>A <b>rite</b> is the one thing a trade may ask for out loud: ${listed(riteWidths.map(numberWord)).replace(' and ', ' or ')} channels pushed much
    harder for a fixed number of seconds, paid out of the same <b>favour</b> a prayer is paid from, and
    then a rest before you may ask again. The card gives each of those figures. Some trade one channel away
    for another &mdash; ${riteDef('redhour')?.name} is <i>${riteSays('redhour')}</i> &mdash; so read both halves before you call one.
    Only the <b>fighting</b> trades have a rite; a craft trade has its perks and none. It sits at
    the head of its trade's tree, with the reason underneath when you cannot call it.</p>
    <p>Every card has <b>What it offers</b>, which lays the trade open before you take it up: its
    ${numberWord(PERK_TIER_AT.length)} tiers of perks with the skill each opens at and what you have, or its rite and its
    ${numberWord(COLUMNS)} columns with what each node costs and does. That is read from the rulebook, and it is there playing by
    yourself too. <b>Take up</b> and <b>Take this one</b> each ask a second time before anything is done, saying what
    goes with it, what it costs and which perks close.</p>
    <p>Everything else on that window is the <b>island's</b> answer rather than this browser's guess &mdash;
    what you have spent, what is in your purse, whether the altar will hear you &mdash; so when a button
    will not press, the sentence under it is the island's own, and it is the truth.</p>
    <p>Putting a trade down for another costs <b>${CLASS_CHANGE_COST} silver</b>, and the nodes you bought or the perks you
    took for the old one go with it. The other slot keeps what it had.</p>
    <p>A <b>Bauble of Regret</b> undoes a trade instead. ${capital(percent(REGRET_SHARE))} of what a trowel turns up is one,
    whole. With one in your pack, the card of a trade you hold has <i>Undo</i>: it breaks the bauble and puts
    that trade down with the nodes you bought or the perks you took for it, leaving its slot empty, so the next trade you take up in
    that slot costs nothing. The other slot keeps what it had.</p>
    <p>Drag a window by its title bar and resize it from the bottom-right corner. The layout is remembered.</p>
    <p><b>How you look</b> can be changed at any time: <i>Change…</i> under <b>How you look</b> in
    Settings (<kbd>O</kbd>) opens the creator from the account page on the look you have on. Nothing
    changes until you press <i>Wear this look</i>. On an island the look is kept with your account and
    goes on your body on every island you have one on; playing on your own, it is saved with the game.</p>
    <p>The <b>map</b> (<kbd>M</kbd>) shows the same states: dark where you have not been, dim
    where you have, and bright where somebody is looking now. An island is far bigger than the window, so
    the map does not try to show all of it at once: it looks at the ground you have walked and widens as
    you explore, out to the whole island once you have been round it. Click it to send the view there.</p>
    <p>Clicking a tile <b>chooses</b> it: it is outlined in the world and the <b>Tile</b> window fills
    with everything you could do to it &mdash; the same list the right-click menu shows, because it is
    built from the same list. Anything with a reason it cannot be done yet is greyed out with the reason
    beside it, and a row with a <b>&#9656;</b> opens in place. It works on whatever you clicked, not just
    bare ground: a chest, a smelter, a campfire, a wildermon. The game can be played from it with one
    button, which is what it is for. If you would rather keep to the right-click menu, untick
    <i>Open the tile window on a click</i> in Settings and it will stay where you put it.</p>
    <p>The little <b>i</b> beside the title answers the other question: not what you can do to a thing
    this moment but what it is <i>for</i>. On ground it gives the pace it is walked at, what a loaded
    cart makes of it, what a shovel or a pickaxe gets out of it, whether anything grows on it and
    whether it will take paving. On a wildermon it lists every skill the animal has and what each one
    decides. Hover it to read it, click it to pin it open.</p>
    <p><b>Trees are picked by their ground, not their canopy.</b> A mature tree is drawn leaning over
    the tiles behind it; the tile it stands on is the one that answers to a click or a hover, so the
    cursor never latches onto a tree it is nowhere near.</p>
    <p>The <b>inventory</b> and the <b>crafting</b> window each have a <b>search box</b> at the top.
    The inventory searches what you are carrying by name and kind; the recipe book searches on
    everything in a row at once &mdash; what it makes, the trade it takes, where it has to be worked and
    what goes into it &mdash; so <i>leather</i> finds every leather thing, <i>mason</i> finds the oven
    and the well, and <i>nail</i> finds all ${numberWord(RECIPES.filter((r) => r.inputs.some((i) => i.item === 'nail')).length)} recipes that want nails. The count at the foot
    tells you how many matched. <kbd>Esc</kbd> in the box clears it.</p>
    <h3>The ledger</h3>
    <p>Everything that has ever come off your bench, your anvil or your oven is written down in the
    Ledger (<kbd>B</kbd>): every kind of thing, how many of them, how many came off <b>rare</b> or
    better, and <b>the best one you ever managed</b>. It can be put in order by any of those, or by
    name, or newest first, and searched. The first of anything says so in the log, and so does every
    time you beat your own best at something.</p>
    <p>The journal says what there is to do. This says what you have done, which is the number a maker
    actually keeps.</p>
    <h3>The journal</h3>
    <p>There is a great deal to do on this island and nothing anywhere that says so. The <b>journal</b>
    (<kbd>J</kbd>) is that list: ${numberWord(ALL_GOALS.length)} goals in ${numberWord(JOURNAL.length)} chapters, from felling your first tree to
    taking a trade to ${LEGEND_AT}. Nothing is required and nothing is rewarded &mdash; a goal is only something
    somebody thought worth doing. Each ticks itself off the moment you have done it, says so in the
    events, and stays ticked for good afterwards whatever becomes of the thing that did it.</p>
    <h3>Crafting</h3>
    <p>The crafting window (<kbd>R</kbd>) is your recipe book, grouped by craft: a carving knife and a
    log give shafts or a mallet, a shaft becomes a deed stake, a saw gives planks and timbers, a chisel
    turns shards into bricks, and so on. Each recipe lists its tool and materials, green when you have
    them at hand and red when you do not, and whatever you can make right now sits at the top of its group. Tick
    <i>Only what I can make</i> to hide the rest. The same recipes are on each material's own menu,
    where <i>All</i> keeps going until the materials run out.</p>
    <p><b>What is at hand.</b> A craft, and any work at a station that uses something up, takes it from
    your pack, then the bags on your back, then your stores within <b>${CRAFT_REACH} tiles</b> of where you
    stand, nearest first. At a station that means the metal for a mould or an anvil, ore and scrap for
    a smelter, unfired clay for a kiln, fuel for a campfire, smelter, kiln or oven, a casting or coin
    metal at an anvil, the stock worked into a thing to improve it, and what goes into a brew. A stack in
    a store is marked with the store's name on the station's menu. Tools still have to be carried:
    the moulds, the coin die, files and the rest. Nothing is taken from a store behind a padlock you
    hold no key to, from one somebody else set down off your settlement, from a trash crate or a market
    stall, and nothing put by is ever used. A cart, a wagon or a boat is anybody's store, whoever built
    it.</p>
    <p>The settings under <b>Crafting</b> in Settings (<kbd>O</kbd>) narrow that.
    <i>Use stores within reach</i>, unticked, keeps it to your pack and the bags on your back.
    <i>Keep rare materials out of crafting</i> stops a craft or a station picking a
    ${RARITIES.slice(1, -1).map((r) => r.name).join(', ')} or ${RARITIES[RARITIES.length - 1].name} stack by itself; one you point it at is still
    used &mdash; the stack you right-click to make something, or one you choose off a station's menu.
    On an island the island keeps both with your body, and a job it finishes later goes by them.</p>
    <h3>What a thing is made of</h3>
    <p>The same bill of materials in a different wood, or a different metal, makes a different
    thing. A log keeps the wood it was cut from all the way through &mdash; planks, timbers, shafts and
    whatever you nail together out of them &mdash; and a lump keeps its metal from the seam to the
    finished blade. Every wood and every metal carries the same numbers: how hard it is to work,
    what it weighs, how much punishment it takes, how fast it rots, what it is worth as an edge, as
    armour, as a tool, and as a box to put things in. The examine line on any item says what it is made
    of and what that lends it.</p>
    <p><b>One craft, one material.</b> You cannot nail an oak plank to a pine one and call it a chest.
    The crafting window shows what the piece would come out <i>of</i>, and picks whichever you have most
    of; carry more than one kind and the row offers a choice of them, and clicking a stack in your pack
    uses that one instead. Nails and the like are exempt
    &mdash; they are whatever metal they are. <b>Improving</b> is the same rule: an oak chest wants more
    oak, and a bronze blade will not take copper.</p>
    <p><b>The ${numberWord(TREE_DEFS.filter((t) => !t.fruit).length)} woods that bear nothing.</b> <b>Pine</b> is soft, light and quick to work, and rots as fast as it grew.
    <b>Willow</b> and <b>birch</b> are light and springy. <b>Maple</b> is even-tempered. <b>Oak</b> is
    hard going and worth it: an oak thing takes ${percent(mat('oak').wear / mat('pine').wear)} of the knocks a pine one does, holds more
    and swings harder, at the price of weight. <b>Cedar</b> barely rots at all &mdash; whatever you mean
    to leave standing in the rain, build it of cedar. A <b>bow</b> is the fussiest thing on the island:
    a short bow is tillered from <b>willow</b>, a medium bow from <b>birch</b> and a long bow from
    <b>oak</b>, and nothing else will do.</p>
    <p><b>The ${numberWord(METALS.length)} metals.</b> <b>Copper</b> is what everything starts in and is soft with it.
    <b>Tin</b>, <b>zinc</b>, <b>lead</b> and <b>pewter</b> are stock for alloys and nothing you would
    want to swing. <b>Iron</b> is the working metal of the island: harder than copper at everything,
    and the one thing it asks in return is that you do not leave it out in the rain. <b>Steel</b>,
    which is iron with coal beaten through it, keeps an edge ${times(mat('copper').wear / mat('steel').wear)} as long as copper and does not
    mind the weather. <b>Bronze</b> and <b>brass</b> are the first alloys worth a crucible. <b>Silver</b> hardly
    tarnishes and bites anything that carries its own light ${times(BANE_BONUS)} as hard, which is what a
    <b>Lume</b> or an <b>Embra</b> is. <b>Gold</b> rots at ${percent(mat('gold').decay / mat('copper').decay)} of copper's pace, weighs
    ${times(mat('gold').weight / mat('copper').weight)} what copper does and is good for nothing else. The ${numberWord(DEEP_METALS.length)} out of the deep seams are what a
    lifetime of mining is for: <b>adamantine</b> takes the keenest edge, <b>glimmersteel</b> is light and turns
    aside ${percent(mat('glimmersteel').soak / mat('copper').soak - 1)} more than copper does, <b>mithril</b> is lighter than the wood it is hafted to, and
    <b>seryll</b> scarcely takes a mark at all. A tool's metal decides how fast and how true it works, so a
    bronze hatchet at ${HATCHET_QL} works as well as a copper one at ${Math.round(HATCHET_QL * mat('bronze').bite / mat('copper').bite)}; a weapon's metal decides
    what it does; armour's metal decides both what it stops and what it costs you to carry.</p>
    <h3>Brewing</h3>
    <p>Fill a barrel from a well or the shore, stand at it and <b>set a brew going</b>. ${NumberWord(BREWS.length)} of them:
    ${listed(BREWS.map((b) => `<b>${b.name.toLowerCase()}</b> from ${countOf(b.input, b.count, true)} and ${b.litres} litres of water in ${spanWords(b.time)}`))}.
    Each gives back as many litres of drink as it took of water.</p>
    <p>A <b>quern</b> presses fruit too: ${numberWord(need('press_apple_juice', 'apple'))} of any fruit into a <b>bucket of juice</b>, sweet and with
    nothing dangerous in it, and ${numberWord(need('press_apple_cider', 'apple'))} apples or pears straight into a <b>bucket of cider</b> with no
    barrel and no waiting &mdash; one bucket, where the barrel would have made ${numberWord(CIDER.litres / BUCKET_LITRES)} from ${countOf(CIDER.input, CIDER.count)}
    and ${numberWord(CIDER.litres)} litres of water.</p>
    <p>While it is working the barrel says so and nothing can be drawn off it &mdash; and nothing hurries
    it. When it stops, draw it into a bucket like any other liquid and drink from that. The quality of
    what comes out is half what went in and half your <b>brewing</b>, and a brew that will not take
    sours the whole barrel.</p>
    <p>What brewing is <i>for</i> is the knack. Anything drunk leaves one the way a cooked dish does,
    and a brew carries it far longer than food &mdash; at quality ${BOON_QL}, a baked potato's lasts
    ${spanWords(boonTime('baked_potato', BOON_QL))} and a bucket of wine's ${spanWords(boonTime('wine_bucket', BOON_QL))}. A barrel of the right thing
    before a long afternoon at the anvil is the single best use of an orchard.</p>
    <p>A Cook can learn to <b>distil</b>: ${bill('distil_wine')} boiled off over a campfire into a <b>bucket of spirit</b>,
    and ${numberWord(recipe('distil_wine').returns?.[0]?.[1] ?? 0)} of the buckets back. At quality ${BOON_QL} a drink of spirit gives a knack of
    ${spanWords(boonTime('spirit_bucket', BOON_QL))}. A Cook with Strong Brew marks every barrel they set going: a drink from it, or from a
    bucket drawn off it, gives a knack ${percent((cook('Strong Brew')['brewed:wine'] ?? 1) - 1)} longer, whoever drinks it. Brew poured together is only as
    strong as the weakest of it, and a barrel emptied forgets it. A Cook can learn to boil <b>broth</b> too: ${bill('make_broth')}
    over a campfire make ${numberWord(made('make_broth'))} bowls, each feeding a little of all ${numberWord(NUTRIENTS.length)}.</p>
    <h3>Fishing</h3>
    <p>Splice a <b>fishing rod</b> from ${bill('make_fishing_rod')}, the ribbon bent into a hook, stand at
    water and fish. The line reaches ${numberWord(LINE_REACH)} tiles, and it goes into whatever water within a cast is
    deepest &mdash; so where you stand is the whole trade. Standing inland catches nothing at all.</p>
    <p>${NumberWord(FISH.length)} fish run at ${numberWord(new Set(FISH.map((f) => f.depth)).size)} depths, and each wants a hand to match:
    ${listed(FISH.map((f) => `<b>${f.name.toLowerCase()}</b> ${f.depth > 0 ? `from ${numberWord(f.depth)} deep` : 'anywhere there is water'}${f.level > FISH[0].level ? ` with fishing ${f.level}` : ''}`))}.
    A gently shelving beach will never give you more than perch however good you get; a
    sheer bank with deep water right off the edge will give you everything. Each goes over a fire, and
    what comes off it follows the size of the fish &mdash; a pike is ${numberWord(made('cook_pike'))} helpings and a sturgeon
    ${numberWord(made('cook_sturgeon'))}.</p>
    <p><b>Bait</b> decides what bites. A bare hook catches whatever is passing, which mostly means
    minnows. Put something on it and you are fishing for a particular thing, and it is a ladder every
    rung of which is something you caught on the rung below: <b>worms</b> (turned out of damp dirt with
    a shovel &mdash; a marsh is full of them) bring up <b>perch</b>; a live <b>minnow</b> or raw
    <b>meat</b> brings up a <b>pike</b>; a whole <b>perch</b> on the hook is what brings a
    <b>sturgeon</b> up. Corn does at a pinch, and a Cook with Bait Maker cuts <b>offal</b> from every carcass, which
    ${listed((BAIT_BY_ID.get('offal')?.favours ?? []).map((f) => `${itemDef(f).name.toLowerCase()}`))} come to. Anything worth using is taken out of your pack and put on
    the hook by itself, and the menu says which. In water deep enough for everything, with the hand for
    all of it, a sturgeon is ${percent(biteShare('sturgeon'))} of what takes a bare hook and ${percent(biteShare('sturgeon', 'perch'))} of what
    takes a perch.</p>
    <p>A net and a creel fish without a rod. A <b>net</b> &mdash; ${bill('make_net')}, knotted with a
    needle &mdash; is <b>dragged</b> through water you can wade to: it takes several small fish at a
    haul and lets the big ones through, so it is how you feed a settlement rather than how you land a
    sturgeon. A <b>creel</b> &mdash; ${bill('make_creel')} &mdash; is a basket with the throat turned
    inward. <b>Sink it in water</b> off a bank, bait it, and walk away: it fishes on its own while you
    are elsewhere, holds ${numberWord(TRAPS.creel.hold ?? 0)}, and gives about <b>${numberWord(Math.round(1 / CREEL_BAIT_LOSS))} fish to a baiting</b> before the bait is
    worked out of it. Empty it from the bank. Kept baited and emptied, the best one that can be woven is
    worth around ${numberWord(Math.round(HOUR / CHECK_EVERY * creelOdds(TOP_QL)))} fish an hour for no work at all.
    A net a Tailor with Fisher's Friend knotted hauls ${percent((tailor("Fisher's Friend")['catch:fishing_net'] ?? 1) - 1)} more fish on the
    average, and a creel of theirs is ${percent((tailor("Fisher's Friend")['catch:creel'] ?? 1) - 1)} likelier to take one at each look.</p>
    <p>The <b>Wadd</b>, being the one thing on the island that swims, now fishes: set one to a deed or a
    work post and it works the banks in its range and carries the catch home.</p>
    <p>A <b>Fisher</b> who has learned it <b>smokes</b> fish: choose <b>Smoke the</b> <i>fish</i> at a lit campfire, and it comes off the
    same fish at its own quality, marked to rot ${percent(1 - (fisher('Smoke Fish')['rot:trout'] ?? 1))} slower wherever it is left. One
    with the <b>Fishing Journal</b> reads the water when they examine it: how deep it is, each fish's share of the bites with the bait they
    would put on, and how often a fish that bites stays on with their rod. One who has learned to dig a <b>fish pond</b>
    (${bill('make_fish_pond')}, with a shovel) sets it down on their settlement, where it stocks itself at a fish in
    ${spanWords(POND_EVERY)} until it holds ${furnitureDef('fish_pond').pond}; take the fish out of it as you would the comb from a hive,
    and put nothing in.</p>
    <h3>Fruit trees</h3>
    <p>${NumberWord(FRUIT_TREES.length)} of the ${numberWord(TREE_DEFS.length)} trees bear. <b>Apple</b> and <b>olive</b> grow wild here and there in
    the warm low country of any island, and the rest are each held to one island of the chart, where they
    grow among the apples and olives: <b>cherry</b> on East Isle,
    <b>pear</b> and <b>quince</b> on the Crescent, <b>pomegranate</b> and <b>apricot</b> on the Northwest
    Steppe, <b>plum</b> in the lowland of the Northeast Tundra, <b>lemon</b> on Volcano Isle, <b>peach</b>
    on Middle Isle and <b>fig</b> on West Skerry. An island of your own has no chart and grows them all.
    You can tell a fruit tree across a field by what is hanging in it, and in spring by its flower:
    ${FLOWER_KINDS.map(([family, kinds]) => `${family} on ${listed(kinds)}`).join('; ')}. Take a <b>sprout</b> off one
    with forestry and plant it, and you have the beginnings of an orchard, wherever the sprout came
    from. A <b>plucka</b> set to work on a deed picks what the bearing trees have on them and carries
    it to the crate.</p>
    <p>A sapling bears nothing; leave it to grow. A mature tree gives about ${numberWord(FRUIT_MATURE)} of its fruit to a
    picking and an old one about ${numberWord(FRUIT_OLD)}, more as your forestry rises, and a picked tree needs a few
    minutes before there is anything on it again. ${capital(countOf('apple', need('make_apple_pie', 'apple')))} and a dough bake into ${numberWord(made('make_apple_pie'))} <b>apple
    pies</b>, the best food on the island; ${countOf('cherry', need('make_cherry_preserves', 'cherry'))} boil down into ${numberWord(made('make_cherry_preserves'))} jars of <b>preserves</b>;
    and ${countOf('olive', need('press_olives', 'olive'))} crushed under a <b>quern</b> give ${numberWord(made('press_olives'))} measures of <b>olive oil</b>, which keeps almost
    for ever.</p>
    <p>All of them are also <b>woods</b>, and good ones: apple is as hard-wearing as oak and takes a finer
    edge, cherry is the best handle wood on the island, and olive is murder to work and outlasts
    everything. You get one log a tree, so an orchard felled is an orchard gone.</p>
    <p>A Forester can learn these jobs of the woods. <b>Coppice</b>, with a hatchet, cuts a mature or older
    tree back to young for ${numberWord(forester('Coppice').coppice ?? 0)} logs and leaves it standing to grow on.
    <b>Tap resin</b>, with a carving knife, takes ${numberWord(forester('Tap Resin').tap_resin ?? 0)} tar from a living
    ${TREE_DEFS[RESIN_TREE].name.toLowerCase()}, once a day for each; the day turns when the woods do. <b>Clear brush</b>,
    with a sickle, clears every bush and reed in the ${BRUSH_SIDE}&times;${BRUSH_SIDE} tiles around the one you choose
    in one go, and leaves ${TILE_DEFS[CLEARED_TO[TileType.Bush] as TileType].name.toLowerCase()} where the bushes were and
    ${TILE_DEFS[CLEARED_TO[TileType.Reed] as TileType].name.toLowerCase()} where the reeds were.</p>
    <h3>Farming</h3>
    <p>With a <b>rake</b> in your pack, <b>Till</b> any grass or dirt to rake it into a field. Seeds turn
    up while foraging and botanizing &mdash; vegetables and starches in the one, spices and fibres in the
    other &mdash; and a field's menu offers to <b>Sow</b> whichever you carry. A crop goes through ${numberWord(STAGE_NAMES.length)}
    stages: ${listed(STAGE_NAMES)}, each drawn differently, and every crop takes its own time
    per stage, from quick mint to slow corn.</p>
    <p>Each stage can be <b>Tended</b> once, and tending is what makes a field pay: an untended crop
    gives ${cropYield(0).produce} crop and ${cropYield(0).seeds} seed, while one tended at every stage gives <b>${cropYield(RIPE).produce} crops and ${cropYield(RIPE).seeds} seeds</b>. Tending
    and tilling both train <b>Farming</b>, and your farming skill sets the quality of what you harvest.
    Harvesting leaves the ground still tilled, so a field can be sown again without raking it afresh
    &mdash; which is what lets a Seavic keep one running on its own.</p>
    <p>A Farmer can learn to work a patch at a time: <b>Sow a patch</b>, <b>Tend a patch</b> and <b>Harvest
    a patch</b> each take the ${PATCH_SIDE}&times;${PATCH_SIDE} tiles around the field you choose as one job, in the time of
    ${numberWord(PATCH_TIME)} of the one-field job. Sow a patch sows the seed you choose on every empty field in it, one
    seed a field; Tend a patch tends every crop in it not yet tended at the stage it is at; Harvest a patch
    harvests every ripe crop in it, each for what its own tending earned. A crop keeps the pace it was sown
    at, so a field a Farmer sowed faster grows faster whoever harvests it.</p>
    <p>A crop in a field grows through the <b>year</b>: ${listed(SEASONS.map((s) => `${growthWords(SEASON_GROWTH[s])} in ${s}`))}.
    In winter a crop in a field <b>keeps its stage and waits for spring</b>; nothing dies, and a field can still be
    sown, tended and harvested, so it can be sown ready for the spring. A stage that runs into a winter finishes
    after it, and before the first spring a field grew ${growthWords(YEARLESS_GROWTH)}. Hover over a field and it
    says when the next stage comes in real time, and in winter how long it waits for spring.</p>
    <p>A <b>planter</b> grows one crop <b>${growthWords(PLANTER_GROWTH)} in every season</b>, winter too, wherever it
    stands, indoors or out: a stage of cotton, ${spanWords(CROPS.cotton.stageSeconds)} in a spring field, is
    ${spanWords(CROPS.cotton.stageSeconds / PLANTER_GROWTH)} in a planter. Its menu sows it from the seeds you carry, tends
    it and harvests it with the field's jobs, the same seeds, stages and yields, and <b>Pull it up</b> turns what grows
    in it back into the soil. A Farmer's ${listed(planterPerks().map((p) => p.name))} all work on a planter, and
    ${farmerPerk('rotate:plant_seed')} reads the planter's own last crop; ${listed(['sow_patch', 'tend_patch', 'harvest_patch'].map(farmerPerk))}
    work fields only. A planter with something growing in it will not be picked up, and Bounty brings on the planters
    standing on your settlement along with its fields.</p>
    <h3>Campfires and cooking</h3>
    <p>Right-click any dry, open spot and choose <b>Build campfire</b> to lay one from ${numberWord(FIRE_COST)} shafts; it
    fills a ${numberWord(FIRE_SUBTILES)} by ${numberWord(FIRE_SUBTILES)} block of the tile's spots. Feed it anything that burns &mdash; thatch, shafts,
    planks, peat, timbers, logs or coal &mdash; and each is worth so many minutes of burning, then
    <b>Light</b> it. Peat is dug off a peat bed with a shovel and costs nothing but the digging, which
    makes it the first fuel worth stacking. A burning
    fire is the place to <b>Cook</b>: raw meat becomes cooked meat that fills ${percent(itemDef('cooked_meat').food ?? 0)} of the food bar where
    raw fills ${percent(itemDef('meat').food ?? 0)}, potatoes bake
    in the embers, onions and nuts roast, and with a <b>clay bowl</b> you can stew berries into compote
    or simmer meat and vegetables into a proper stew. Cooking recipes sit in the crafting window with
    everything else and unlock when you stand by a lit fire; burning a dish costs you the ingredients,
    so cook where your skill can manage. A fire burns its fuel down in real time and goes cold when it
    runs out, and an unlit one can be taken apart to get the wood back.</p>
    <h3>Grain, the quern and bread</h3>
    <p>Wheat and corn are not food until they have been through a <b>quern</b>: stones dressed flat,
    grooved and pierced, chiselled out of ${bill('make_quern')} by a stonecutter. Turning it is the
    <b>Milling</b> skill. ${capital(countOf('wheat', need('make_flour', 'wheat')))} grind down to a lot of <b>flour</b>, ${countOf('corn', need('make_cornmeal', 'corn'))} to <b>cornmeal</b>,
    and a badly ground batch is nothing but grit.</p>
    <p>Flour and a bucket of water are worked into <b>dough</b> &mdash; ${numberWord(made('make_dough'))} rounds at a time, and the
    bucket comes back empty &mdash; and a round of dough baked on a hot stone at a lit fire is
    <b>bread</b>, which is the first food that keeps and travels. Cornmeal boiled in a clay bowl makes
    ${numberWord(made('make_porridge'))} bowls of <b>porridge</b>. Both are cooking rather than milling: the mill only makes the meal.</p>
    <h3>The oven</h3>
    <p>A campfire will cook, but it burns as much as it bakes. An <b>oven</b> is laid by a
    <b>mason</b> from ${bill('make_oven')} with a trowel, set down on a block of
    ${numberWord(furnitureDef('oven').w * furnitureDef('oven').h)} spots. Feed it anything a fire takes, peat and coal included &mdash; it holds ${spanWords(OVEN_CAPACITY)} of
    it &mdash; and light it. A lit oven is a cooking fire for every purpose: everything on the Cook menu
    is there, and anything that would have burnt over an open flame comes out right, and better, because
    the bricks hold their heat evenly. It leaves ashes like any other fire, and they rake out the same
    way.</p>
    <h3>Metal</h3>
    <p>Mining a seam brings up <b>ore</b>, not finished metal. A <b>stone smelter</b> is laid up by a
    mason from ${bill('make_smelter', true)} with a trowel &mdash; it is built in the crafting window like
    anything else, carried, and <b>set down</b> on ${numberWord(SMELTER_W * SMELTER_H)} spots of a tile on your own deed. Take it up again
    whole when it is cold, empty and raked out. It turns ore into lumps.
    Feed it the same fuel a campfire takes (coal burns longest), light it, and charge it with ore: each
    piece takes its own time to run, longer for fine ore and stubborn metal, shorter in a better
    smelter. Draw the lumps off when they are done.</p>
    <p>Lumps of the same metal gather into one larger lump whose quality is the average of what went in,
    weighted by size, so a poor lump drags a good stack down. At a hot smelter you can also mix
    <b>alloys</b> &mdash; bronze, brass, pewter, electrum and <b>steel</b>, which is ${bill('make_steel')}
    &mdash; and their quality comes from the
    metal you put in rather than from your hands; skill only decides how little is lost in the pouring.</p>
    <p>Sand fired in a smelter makes <b>moulds</b>: an anvil mould, a pan mould, heads for rakes,
    shovels, hatchets, pickaxes and knives, a sword blade and a helm. A mould wears every time it is
    filled and <b>cannot be mended</b>; a fine one is simply good for more fillings before it cracks
    through. Pour metal into an <b>anvil mould</b> at the smelter and it cools into an anvil of that
    metal, which you set down on ${numberWord(ANVIL_SUBTILES * ANVIL_SUBTILES)} spots of a tile.</p>
    <p>Every other mould is <b>poured at the smelter</b> too, with the metal of your choosing, and cools
    into a <b>casting</b> of the piece &mdash; a shovel head casting, a nail casting &mdash; that comes out
    with the lumps. A casting is carried to an <b>anvil</b> and beaten true there, using
    <b>blacksmithing</b>, <b>weaponsmithing</b> or <b>armoursmithing</b>, whichever that piece calls for.
    The skill decides whether the piece comes out at all and how good it is, alongside the casting, which
    carries the quality of the mould and the metal it was poured from, and the anvil. Tool heads and
    blades are finished by fitting a shaft to them. A sword hits far harder than any working tool, and a
    helm turns aside most of what a cornered animal does to you when you attack it.</p>
    <p>A Smith with <b>Ingots</b> pours ${numberWord(INGOT_LUMPS)} lumps of one metal into an <b>ingot</b> at the
    smelter (<b>Pour ingots</b>). It weighs ${share(INGOT_WEIGHT)} what its lumps did and counts as all ${numberWord(INGOT_LUMPS)} of
    them wherever the smelter, the anvil, a recipe or Improve takes lumps; what a job does not use of one
    comes back as lumps. A weapon or tool finished by a Smith with <b>Temper Bath</b> can be <b>quenched</b>
    once, by that Smith or another with the perk, from its menu, standing at water or beside a barrel or a
    well of it, for the quality its maker's mark says; Examine shows it.</p>
    <h3>Hunting and butchering</h3>
    <p>Wild wildermon can be <b>attacked</b> from their menu; an edged tool in your pack hits far harder
    than bare hands, and timid creatures bolt when hurt, so expect a chase. Whatever kills one leaves a
    <b>corpse</b> on the ground. Right-click the tile and choose <b>Butcher</b> for meat, fur, <b>hide</b>,
    bone and the occasional gland. The <b>Butchering</b> skill and a <b>butchering knife</b> both decide
    how much of the carcass is worth keeping: bare hands waste most of it. Corpses rot, so do it soon.
    Every carcass you butcher raises the Butchering skill, and the skill sets the <b>QL</b> of everything
    that comes off it. With a knife of QL <i>n</i> it comes off at your Butchering <i>n</i>% of the time,
    and otherwise at the knife's QL times ${QL_LOW.toFixed(1)} to ${(QL_LOW + QL_SPAN).toFixed(1)}, never above
    your Butchering; with bare hands it comes off at your Butchering times ${QL_LOW.toFixed(1)} to
    ${(QL_LOW + QL_SPAN).toFixed(1)}, plus ${QL_BARE}. The menu's <b>Butcher</b> line says the range for the knife you carry.
    A hide off a carcass is <b>raw</b> and no use for anything until it has been through lye.</p>
    <h3>Looking inside a building</h3>
    <p>Once anything is built, a small strip of arrows appears at the right-hand edge. It picks the
    <b>storey you are looking at</b>: the ceilings above it are lifted off so you can see straight down
    into that floor, and everything above it goes with them. The label reads <i>1st</i>, <i>2nd</i> and
    so on, and clicking it returns to <i>Auto</i>, which simply follows whichever storey you are
    standing on. <kbd>Page Up</kbd> and <kbd>Page Down</kbd> do the same as the arrows. Once anybody
    has dug a cellar, the arrows go one further down, to <i>Cellar</i>: the shape of every cellar
    near you, dug out as far as it is, with the buildings over them taken off. What is in a cellar,
    and who, shows only to somebody down in it, as far as they can see.</p>
    <p>The <b>◪</b> button beside them, <kbd>X</kbd>, or the matching box in Settings, <b>cuts away the
    walls facing you</b> &mdash; the ones standing between your eye and the inside of a building &mdash;
    leaving the far walls in place so the rooms still read. Together they let you look into any
    floor of a tall building from outside it.</p>
    <h3>Settling and building</h3>
    <p>Carve a <b>deed stake</b> from a shaft with a carving knife, then use it where you stand to
    found a settlement: ${DEED_ACROSS} by ${DEED_ACROSS} tiles
    around a stone token. You may hold one settlement at a time, and building is only allowed
    on its land. Things left outside on deed land rot ${times(1 / DEED_DECAY)} slower.</p>
    <p>To build, flatten and pack a tile, then with a mallet choose <b>Plan building</b> on it and
    <b>Add to building</b> on neighbouring flat packed tiles. Point at a tile's edge and <b>Plan wall</b>
    there: solid, window, bay window, door or double door, in log, plank, timbercraft, cobblestone,
    slate, marble, sandstone, stone brick, clay adobe, clay bricks, ornate silver or ornate gold. Then
    <b>Build wall</b> feeds it materials one at a time. Floors are planned the same way and laid with
    the paving skill. Another storey can only be planned once every side of the storey below has a finished wall,
    or a finished column at each end, up to ${numberWord(MAX_LEVELS)} in all. Every job on a building goes to the
    storey you are working on (<b>Work on storey N</b> on its menu). A finished full-height wall with a wall of its
    building's storey above on the same side, once any of that wall's materials are in, stays up until that wall
    comes down, or until a finished column stands at each end of it to carry the side, and so does the last wall a
    jetty rests on: so to make such a wall a door, raise a column at each end, take the wall down, and build the
    door in its place.
    On an upper storey, plan a <b>staircase</b> or <b>ladder</b> instead of a plain floor to climb up:
    walk onto it from below and you are upstairs, step off it toward the ground and you are down again.
    Once the top storey's walls are done you can <b>Plan roof</b> tile by tile; neighbouring roof tiles
    join into ridges and hips.</p>
    <p>A roof can be laid in <b>glass</b>: <b>Plan roof</b> offers it beside the building materials, panes on timber
    glazing bars, ${glassTile()} to a tile of the ${roofShapeDef(undefined).name.toLowerCase()} roof Plan roof lays,
    built with a mallet and trained as carpentry. Glass goes on a roof and nowhere else: not on a wall, a floor, a fence or
    a stair. A building of one storey, <b>walled all round to full height</b> (a door, a window or an arch is a wall;
    ${lowWalls()} is too low), with every tile of its footprint under finished glass is a <b>glasshouse</b>, and its
    menu says what it still wants. Its ground-floor tiles with no floor planned on them and no slab poured under them
    <b>Till</b> with a rake into fields, which are sown, tended and harvested as any field is, a Farmer's patches and
    perks and Bounty included. While a building has a field in it, no floor is planned over
    the field, no roof but glass on the building and no storey over it: <b>Clear the field</b> first, which packs the
    ground flat again. A crop in a glasshouse grows <b>${growthWords(GLASSHOUSE_GROWTH)} in every season</b>, winter too,
    where a field in the open grows ${listed(SEASONS.map((s) => `${growthWords(SEASON_GROWTH[s])} in ${s}`))}: a stage
    of cotton takes ${spanWords(CROPS.cotton.stageSeconds / GLASSHOUSE_GROWTH)} in one all year. When the last pane or
    the last wall goes in, whatever is already growing in the building carries on from as far into its stage as it had
    grown, at the glasshouse's pace; take a tile of the roof or a wall down, or add a tile to the footprint, and it
    carries on at a field's pace from there. Walled all round and roofed over, a glasshouse is indoors, and whatever is
    left lying in it rots at ${share(INDOORS_DECAY)} of the rate in the open.</p>
    <p><b>Fences, gates and half walls</b> are the same work at a fraction of the cost, and they do not
    need a building around them: point at the edge of any tile &mdash; on your deed or a mile from it,
    on packed ground or in the long grass &mdash; and choose <b>Plan fence</b>. A log fence is ${numberWord(wallBill('log', 'fence').needed.log)} logs
    where a log wall is ${numberWord(wallBill('log', 'solid').needed.log)}; a half wall is ${share(WALL_TYPE_BY_ID.get('half_wall')?.factor ?? 0)} of one. Both stop anything alive at that border,
    yourself included, which is how a paddock holds a Roxxen; a <b>fence gate</b> is the one kind you
    can walk through. Feed them materials with <b>Build fence</b> exactly as you would a wall, and take
    them down again from the same menu. Nothing rests on waist-high work: a storey cannot be planned
    over a run of fence, half wall or railing, so if you want a floor above, the side below needs a wall,
    or a finished column at each end.</p>
    <p>A <b>portcullis</b> is a wall type for a ground-floor wall of stone or brick &mdash;
    ${listed(WALL_MATERIALS.filter((m) => m.kind === 'stone').map((m) => m.name.toLowerCase()))} &mdash;
    a gateway as wide as a double door with an iron grille, ${billWords(WALL_TYPE_BY_ID.get('portcullis')?.fittings ?? [])} over the stone's own bill
    (in stone brick, ${billWords(Object.entries(wallBill('stone_brick', 'portcullis').total))}). <b>Raise the portcullis</b> takes
    ${gateJobWords('raise_portcullis', goSeconds)} and <b>Lower the portcullis</b> ${gateJobWords('lower_portcullis', goSeconds)},
    from either side of it, standing within ${numberWord(gateReach('raise_portcullis'))} tile${gateReach('raise_portcullis') === 1 ? '' : 's'} of the tile beside it.
    Down, nothing passes it: no person, no cart, no wildermon. Up, everything does, carts included. Up or down, it is seen
    through. Point at it from either side, on any storey, to read whether it is up or down and padlocked. Without a padlock
    anybody may raise or lower it; <b>Fit a padlock</b> to it and only its key and the founder of the settlement it stands on may
    raise it, lower it or take it down.</p>
    <p>A <b>hidden door</b> is built of exactly a solid wall's bill and drawn exactly as one. <b>Plan wall</b>, <b>Hidden door</b>
    plans a solid wall there, in every way anybody else can see or read: the same job, ${spanWords(goSeconds(PLAN_WALL?.baseTime ?? 0))} and
    ${percent(PLAN_WALL?.stamina ?? 0)} of your stamina, the same words over your head, and on an island the same record. Only you and
    the island know it was asked for as a door: on an island it is asked for in the one call that asks for the plan, when you
    reach the wall. The ask is for that side of that tile. It is kept only if the plan is started or lined up behind your other
    jobs, so a plan refused &mdash; too far away, too tired, your head already full, or the padlock and hinges not in your pack
    &mdash; asks for nothing. Kept, it waits as long as you have a plan of a wall on that side in hand or lined up, whichever plan
    that is: walking away puts the work down and the ask waits with it, and once no plan on that side is left &mdash; refused as it
    comes up, or forgotten with <kbd>Esc</kbd> &mdash; the ask goes too. The next solid wall you plan on that side, on whichever
    storey you are working, is the hidden door. So you may ask for one on several sides and line their plans up. An ask still
    waiting ${spanWords(HIDDEN_DOOR_LAPSE)} after it was made lapses, and its plan is a solid wall. As the plan is finished it takes ${billWords(HIDDEN_DOOR_IRON)} out of your pack and the padlock becomes its key; if they have left your pack by
    then, it stays a solid wall. To whoever holds that key, and to the founder of the
    settlement it stands on, it is a door: you walk through it and see through it, its face shows a dashed seam and a keyhole, and
    pointing at it from either side says your key opens it. To everybody else it is a solid wall in every way: they cannot pass it or
    see through it, it offers them a wall's work and nothing else, and on an island their browser is told it is a solid wall. No
    wildermon and no cart ever passes one.</p>
    <p><b>Piers and stilts.</b> A tile that is not level and dry at a building's floor height &mdash; one
    that slopes, one lower than the floor, or one under at most ${metres(PIER_WATER)} m of water &mdash; takes
    the building on piers: its ground floor is a <b>deck</b>, level with the building's floor and carried
    down to the ground or the bed of the water on timber posts braced across, or on stone piers with arches
    between them, by the material the deck is laid in. Level, dry ground at the floor's height is built on as
    it stands, packed first. Plan a building on a tile that needs piers and its deck is set at the tile's
    highest corner, or ${metres(PIER_CLEAR)} m over the water if that is higher, or at a level you have
    taken if that is higher still. Every tile added after it must lie wholly under the deck &mdash; so plan
    a house on a hillside from its highest tile &mdash; with its lowest corner at most ${metres(PIER_DROP)} m
    under the deck, on bare ground or what grows flat on it: no tree, field, paving or water plant, nothing
    standing on it, no bridge landing on it and nobody on it. A creature on it is moved off as it is planned.
    <b>Plan deck</b> on each: it takes the floor's materials and, for every metre from the deck down to the
    tile's lowest corner, ${share(10 / PIER_WALL_DROP)} of a solid wall of the same material more, rounded up
    item by item &mdash; a plank deck ${metres(PIER_DROP)} m up takes ${deckBill('plank', PIER_DROP).needed.plank}
    planks and ${deckBill('plank', PIER_DROP).needed.timber} timbers. A deck carries no wall heavier than the
    material it is laid in (${Object.entries(HEFT_WORDS).sort(([a], [b]) => Number(a) - Number(b)).map(([, w]) => w).join(', then ')}, lightest first), and the lightest deck under
    a building carries every storey of it. Until its deck is built nobody stands on the tile; built, it is
    floor at the deck's height, dry whatever is under it, walls, stairs, furniture and crates go on it as on
    any floor, and a bridge lands on it as on a bank. You step onto or off a deck from ground at most
    ${metres(MAX_STEP)} m above or below it, and ${(CLIMB_PER_LEVEL / 10).toFixed(2)} m more for each level of
    climbing. An edge higher than that stops you: a deck that high over every tile beside it is reached by
    carrying the building on until the ground beside it comes within the step, or over a bridge. No
    creature, cart, mount or boat goes onto a deck or under one, and the ground under a
    building cannot be dug, raised, flattened, mined, packed, cultivated, paved or planted while it stands,
    nor tilled unless the building is a glasshouse.</p>
    <p>Materials: saw logs into planks and timbers, bundle cut grass into thatch, mix clay and sand
    into mortar, press clay and grass into adobe, and chip silver and gold from veins in the mountains.</p>
    <h3>Cellars</h3>
    <p>Under a building whose ground-floor walls are all built, a <b>cellar</b> is dug out a tile at
    a time, ${numberWord(CELLAR_DEPTH)} slices down, a whole storey, by somebody inside that building: on its ground
    floor or down in its cellar, and not through a wall from outside or from the cellar of the
    building next door. <b>${CELLAR_ACTION_BY_ID.get('dig_cellar')?.label}</b> takes the soil a slice a go with a
    shovel and Digging, and gives a dirt a slice; once the shovel is down to the rock,
    <b>${CELLAR_ACTION_BY_ID.get('mine_cellar')?.label}</b> takes the rest with a pickaxe and Mining, and every
    slice gives what mining that rock gives: ${CELLAR_SHARDS}, by the stone it is, or the ore where a
    vein runs under the building. A vein wants its own Mining to work, ${ORE_SENSE ? `${ORE_SENSE.fx['ore:below']} less with ${ORE_SENSE.name}` : 'as a face of it does'}.
    A cellar is begun only where there is ${numberWord(CELLAR_SOIL)} or more of soil at every corner of the tile,
    and only where its floor, ${numberWord(CELLAR_DEPTH)} under the ground floor, is above the sea; never under a poured
    foundation or a deck on piers.</p>
    <p>The way down is a <b>staircase down</b> or a <b>ladder down</b>, planned on a dug-out tile from
    the ground floor, with <kbd>Q</kbd> and <kbd>E</kbd> choosing the side it is climbed from; where
    the tile is floored it takes the flooring up, and where it is a glasshouse's field the field is
    cleared first. Its foot comes down on the cellar tile on that
    side, which has to be dug out as well. Walk off it that way and you are down; walk onto it from
    its foot and you are up. Its sides and its back are as solid as the ground, and so is the
    ground between a cellar and the cellar of the building next door: each is reached by its own
    way down. A tile with a
    way down has no staircase up to the next storey, and one with a staircase up has no way down.
    Nothing in tow, no cart you are driving and no mount goes down a flight or a ladder: let go of
    the cart, or get down, first. Nothing is dropped standing on the head of one, up top: step off
    it first.</p>
    <p>A cellar needs no walls and is always indoors, roof or none over the ground floor: what lies
    on its floor rots at ${share(CELLAR_DECAY)} of the rate out of doors, against ${share(INDOORS_DECAY)} in a closed room up
    top, which makes it the slowest place there is; and a night in a bed down there is worth
    ${percent(INDOORS_REST - 1)} more rest than the same bed out of doors, as in a closed room up top. Every piece of furniture goes down there but ${listed(CELLAR_BURNS)}, which burn an open fire;
    anything on wheels or afloat; and ${listed(CELLAR_NOT_DOWN)}. It is dark at every hour, and counts as
    the dead of night for what a fight in it teaches of Awareness: you see what a lantern or a torch
    you carry lights, and a lantern or a torch is lit down there only off another alight in your
    hands, since every fire is up top. By day the daylight down the way in lights ${numberWord(CELLAR_DAYLIGHT)} tiles
    round its foot.</p>
    <p>The ground over a cellar is not dug, raised or levelled while the cellar is there, and a
    building with a cellar under it is not taken off the plan until every tile of it is filled in
    again: <b>${CELLAR_ACTION_BY_ID.get('fill_cellar')?.label}</b> packs a dirt, clay or sand back in a slice a go, from the
    pack or from something beside you, once what lies or stands down there is carried out and
    the way down that stands on the tile is taken out.</p>
    <h3>Jetties, balconies, railings and columns</h3>
    <p>A storey above the ground can be floored out <b>${numberWord(JETTY_REACH)} tile past the footprint</b>: a
    <b>jetty</b>. Right-click the open tile beside the building and choose <b>Jetty of &hellip; (storey N)</b>
    &rarr; <b>Plan jetty floor</b>: N is the storey you are working on (<b>Work on storey N</b> on the building's
    menu), or the storey over the ground floor while you work on that, and every job on the menu goes to the
    storey it names.
    The floor costs what a floor inside does. The tile must
    share a side with the building where the storey below has a <b>finished full-height wall</b> (a solid
    wall, a window, a bay or a door; not a half wall, a fence or a railing), be open ground on your own
    settlement with no tree or bush on it, and have no corner higher than the floor of the storey below.
    It is held to the weight rule of anything raised up there, which the lightest wall or column in the
    storeys under it sets: ${heftGroups()}. Stairs and ladders stay
    inside the footprint. A storey over a jettied room floors out over the room as far as it goes, resting on
    the room's walls, so a jettied house goes up storey on storey. Nothing can be planned or planted on the
    ground under a jetty, no bridge or aqueduct crosses it, and its corners are not dug or raised; the last wall it rests on
    stays up until the jetty is torn up or a finished column stands at each end of that wall to carry the side;
    and the jetty comes up only once the walls, railings and columns on it, the floor of the storey over it and
    the roof over it are down.</p>
    <p>With nothing between it and its storey a jetty <b>is part of that storey</b>: its open sides want a
    wall, a railing or columns before the storey counts as closed in for another storey or a roof. The roof
    may go out over it (<b>Plan roof over the jetty</b>) only on <b>walls or columns</b>: every side of it out of
    the storey wants a finished full-height wall, or at each end a finished column or the end of a finished
    full-height wall, because a railing carries nothing, and the refusal names the corner that still wants a column. The wall a roof over a jetty rests on
    stays up until a column at each end of it takes the roof, a wall whose end is all that carries an end of
    such a side stays up until a finished column stands on that corner, a column that is all that carries one
    stays up until that side is walled or the roof is off, and no wall or door goes between a storey and its
    roofed jetty. Shut off behind a wall or a door a jetty is a <b>balcony</b>: outside the storey, so the storey
    above asks nothing of its railings, and it takes no roof.</p>
    <p>A <b>railing</b> is a wall type for the open edges up there: ${share(railing.factor)} of a solid wall's bill
    (in log, ${numberWord(wallBill('log', 'railing').needed.log)} logs where a wall is ${numberWord(wallBill('log', 'solid').needed.log)}),
    ${metres(RAILING_HEIGHT * WALL_HEIGHT)} m high against a wall's ${metres(WALL_HEIGHT)} m, and see-through. A finished one stops anyone
    crossing it, as any wall does. It goes on the edges of a storey above the ground, a jetty, a balcony or a
    finished deck on piers &mdash; never on the ground, where a fence does the job &mdash; and round a finished <b>flat roof</b>,
    which is a terrace you can walk out on: <b>Plan railing round the roof</b> on its edge. A roof tile with a
    railing on it is not taken off until the railing is down. Up a storey, an edge with nothing built past it
    stops you whether or not it is railed, so a railing is there to close a storey in, not to catch you.</p>
    <p>A <b>column</b> stands on the corner of a tile: right-click near the corner and choose <b>Plan column
    (&hellip; corner, storey N)</b>, on the storey you are working on.
    It costs ${share(COLUMN_SHARE)} of a solid wall's bill in its material (${columnBills()}) and is built a unit
    at a time like a wall. On the ground floor it stands on the footprint, or on a finished deck where the
    footprint is on piers; higher up on a finished floor of its storey. It is held to the same weight rule as
    a wall there, and on piers to the deck's: no column heavier than the lightest deck under the building, and
    no deck lighter than its heaviest wall or column. Glass is for roofs, not columns. On the ground a
    column takes the corner spot of every tile round it: no piece of furniture, smelter or kiln is set down
    in one, and no column is planned over a piece of furniture standing in one. A side of a storey with a <b>finished
    column at each end</b> is closed as a wall closes it, so a column on each corner of a tile and a roof over it are an open hall,
    a row of them a colonnade, and a storey can be planned over them. A column counts toward how many storeys its
    material lets the building stand. A roof on columns keeps what lies under it as a room does: it decays
    at ${share(INDOORS_DECAY)} of the rate in the open. A bed under it is still a bed in the open: the
    &times;${INDOORS_REST} rest of a bed indoors wants walls all round. A column that carries a side &mdash; a side at its
    corner on the edge of the storey with no full-height wall, closed by it and the column at the other end, with a
    floor or a roof over it &mdash; does not come down until that side is walled or what is over it is off; one whose
    sides are walled or inside the storey comes down whenever you like. Where walls meet on its corner it is drawn
    as a pilaster standing out from them. The floor under one comes up only while another finished floor round the
    corner holds it.</p>
    <h3>Nails, furniture and storage</h3>
    <p>Anything that is nailed together needs <b>nails</b>, and nails need metal. Fire a <b>nail mould</b>
    from sand at a smelter: it is a gang mould with ${numberWord(NAILS_PER_LUMP)} channels in it, so one lump of metal
    poured into it there and beaten out on an anvil gives ${numberWord(NAILS_PER_LUMP)} nails at ${numberWord(Math.round(itemDef('nail').weight * 1000))} grams apiece. Crates, tool heads fitted to their
    shafts and every piece of furniture take them; sawing planks, carving shafts and bundling thatch do
    not, so the early game needs no smith.</p>
    <p><b>Fine carpentry</b> is the furniture hand, separate from the carpentry that cuts the wood. With
    a mallet, planks, timbers, shafts and nails it builds ${numberWord(FINE.length)} pieces &mdash;
    ${listed(FINE.map((f) => f.name.toLowerCase()))}. Each is carried like a crate and
    <b>set down</b> on a block of subtiles: right-click a tile and choose <b>Set furniture down</b>, and
    the piece follows the cursor until you click it down &mdash; <b>Q</b> and <b>E</b> turn it ${share(1 / SIDES)}, Escape
    keeps it. A piece stands the way it was set however the view is turned, and <b>Turn it</b> on a standing
    piece turns it ${share(1 / SIDES)} round. Staircases and ladders are planned the same way, Q and E
    choosing the side you climb from.</p>
    <p>${NumberWord(HOLDERS.length)} of them hold things: ${listed(HOLDERS.map((f, i) => `${f.name.endsWith('s') ? '' : 'a '}${f.name.toLowerCase()} ${i === 0 ? 'takes ' : ''}${f.capacity}`))},
    where a plank crate takes ${CRATE_DEFS.plank.capacity}. The <b>larder</b> is the only one of them that is fussy: it takes food and drink, raw
    or cooked, and the flour, dough and cornmeal a kitchen bakes from &mdash; and nothing else.
    Right-click one and <b>Open</b> it to see inside, or
    stand beside it and choose <b>Put away</b> on anything you are carrying. Nothing can be picked up
    again until it has been emptied.</p>
    <p>A stack <b>dragged</b> out of the inventory window and let go over a crate, a cart, a wagon or a
    piece that holds things goes into it whole, under the same rules as <b>Put away</b>. If it is out of
    reach you walk to it first. A trash crate and a market stall do not take a drop.</p>
    <h3>Shop counters</h3>
    <p>A <b>shop counter</b> is a wall with a market stall in it. Plan it as any wall &mdash; <b>Plan wall</b>,
    <b>Shop counter</b>, in any of the ${numberWord(WALL_MATERIALS.length)} materials &mdash; and build it with ${share(COUNTER_TYPE.factor ?? 1)} of a solid wall's
    material and ${countOf('hinge', counterHinges)}: in log, ${numberWord(wallBill('log', 'counter').needed.log ?? 0)} logs where a solid log wall takes ${numberWord(wallBill('log', 'solid').needed.log ?? 0)}.
    It goes only in a wall of the <b>ground floor</b> with no building across it: that side is its <b>street</b>, and once
    a counter is planned there no building is planned or added onto that tile. Nothing walks through it, a storey stands on it as on
    any wall, and it does not block sight.</p>
    <p>Whoever planned it keeps it. Within <b>${COUNTER_REACH} tiles</b> of the middle of its wall, on either side, choose
    <b>Set out on the counter</b> on a thing in your pack or drag the stack onto the counter: it holds
    <b>${numberWord(COUNTER_HOLDS)} things</b>, as a stall does, and a creature crate is the one piece of furniture that goes on it.
    Price each thing on the <b>Stall</b> tab of the <b>Market</b> window; a thing set out is not for sale until it has a price.
    Anybody else buys from the <b>street only</b>, within the same ${COUNTER_REACH} tiles: on the far side of the wall's line from the
    house, and not inside any building, the shop's other rooms and the house next door included. Right-click beside the counter and
    choose <b>Buy</b> (<b>Buy from</b> its keeper's counter, where more than one counter sells onto the tile), or <b>Look at</b> it and press <b>Buy</b>
    on a thing. What is on it, and at what price, is seen from within <b>${numberWord(COUNTER_SEEN)} tiles</b>; from further off,
    only how many things. The silver goes into its <b>till</b>, which its
    keeper empties from either side with <b>Take the takings</b>, and things come back off it with <b>Take</b>. The wall cannot
    be taken down while anything is on it or in its till.</p>
    <h3>Lantern posts</h3>
    <p>A <b>lantern post</b> (${bill('make_lamp_post')} &mdash; ${workedAt('make_lamp_post')}) is a timber post with an iron arm to
    hang a lantern on; a <b>lantern pillar</b> (${bill('make_lamp_pillar')} &mdash; ${workedAt('make_lamp_pillar')}) is a stone one
    that takes the lantern in its top. Each is set down like furniture and gives no light of its own.</p>
    <p>Within <b>${STORE_REACH} tiles</b> of one, choose <b>Hang a lantern on it</b> or <b>Set a lantern in it</b> to fit a lantern from your pack &mdash;
    the best you carry, or the one you choose &mdash; and from then on it is that lantern to every rule: <b>Put a candle in</b>
    when it has none, <b>Strike a light</b> at a fire or off something alight in your hand, <b>Put it out</b>, and it burns its
    candle only while lit, <b>${spanWords(candleBurn(LOW_QL))}</b> to a candle in the roughest lantern and <b>${spanWords(candleBurn(TOP_QL))}</b>
    in the best. Lit, at night it lights the ground round it out to the lantern's reach, <b>${numberWord(lanternReach(LOW_QL))} to
    ${numberWord(lanternReach(TOP_QL))} tiles</b>, for everybody, and that ground is in sight from as far off as you can see.
    <b>Take the lantern down</b> and it comes back to your pack with the candle it had left, alight if it was. A post with its
    lantern in it cannot be picked up.</p>
    <p>A <b>padlock</b> on a post or a pillar keeps its lantern: without the key nobody fits one, takes it down, puts a candle in,
    puts it out or picks the piece up. Anybody may <b>strike a light</b> in it. A post is not set down with its arm and lantern
    reaching into a wall beside it: <i>${LAMP_INTO_WALL}</i> <b>Turn it</b> goes on round past such a facing.</p>
    <h3>Calling things by name</h3>
    <p>A settlement of any age has bins, crates and a row of chests, and every one of them is
    called <i>Raw material bin (oak)</i>. Any crate, bin, chest, cart, piece of furniture, work post or trap
    will take a name of its own: its menu offers <b>Give it a name</b>, and after that the name is what
    it is called <b>everywhere</b> &mdash; in the Stores window, in the settlement window, in its own
    menu, and when you point at it. Answering with nothing takes the name off again. It is the
    difference between hunting through the lot and walking to the one marked Planks.</p>
    <p>A <b>sign</b> (${bill('make_sign', true)}) and a wider <b>signboard</b> (${bill('make_great_sign', true)})
    are boards made to be written on. Set one up, give it a name, and the name stands
    in the world above the board where anyone walking past can read it &mdash; which is what a fork in
    a road wants.</p>
    <h3>Bags</h3>
    <p>${NumberWord(BAGS.length)} things hold other things and are carried in your pack:
    ${listed(BAGS.map((id) => `a <b>${itemDef(id).name.toLowerCase()}</b> of ${bill(`make_${id}`, true)} (${itemDef(id).holds} things)`))}.
    Open one from its entry in your pack, or use <i>Put it in a bag</i> on anything you are
    carrying; <i>Empty it out</i> turns the whole thing back into your pack.</p>
    <p>What is in a bag is <b>out of reach</b> until it comes out again &mdash; no recipe will draw on it
    &mdash; and one bag will not go inside another. What a bag is for is that it <b>sheds the
    weather</b>: drop a full one on the ground and what is inside rots at
    ${listed(BAGS.map((id, i) => `${share(itemDef(id).shelter ?? 1)}${i === 0 ? ' the rate' : ''} in a ${itemDef(id).name.toLowerCase()}`))}.
    A backpack of food and tools left at a work post keeps far better than the same things thrown down beside it.</p>
    <h3>Work posts</h3>
    <p>A <b>work post</b> is a settlement's worth of orders on a stake. Build one from <b>${bill('make_work_post', true)}</b>
    with a mallet, then right-click a spot on any tile
    <b>outside your own borders</b> and drive it in &mdash; inside them the token already gives the
    orders, so it refuses.</p>
    <p>Set <b>one</b> wildermon to it from the post's own menu and it works out of the post exactly as it
    would work out of a settlement: the same job, the same wage of skill, only measured from the post
    instead of the token. A post is a work site rather than a settlement, so it holds its creature on a
    short rein &mdash; <b>${postRadius(1)} tiles round a rough post and ${postRadius(TOP_QL)} round the best</b>, however much the creature
    itself has learned. Anything with room in it standing inside that circle is where the loads go, so a
    crate beside the post makes a camp that keeps itself; leave the post bare and everything is carried
    all the way home.</p>
    <p>Nothing holds a post up and it <b>rots where it stands</b>: <b>${spanWords(POST_LIFE_MIN)}</b> for the
    roughest and <b>${spanWords(POST_LIFE_MAX)}</b> for the best that can be made, leaning further as it goes, with one
    word of warning near the end. When it falls over, whoever was working out of it <b>comes back to
    you</b> if you are walking alone; otherwise it <b>goes back to work on your settlement</b>, or into
    an empty <b>creature crate</b> in your pack if you have no settlement, and off into the wild if you
    have neither. You can also pull a post up before it goes, and what comes up is as worn as it had
    become.</p>
    <p>A wildermon on a post is <b>not</b> on the settlement's books, so it costs none of the working
    slots your deed level allows. That, and the fact you can put one down anywhere, is what a post is
    for: a logging camp in a far wood, a digger on a clay bank, a Snout turned loose over an old ruin
    &mdash; for as long as a stake in wet ground lasts.</p>
    <h3>Raw materials, worked materials, seed, sprouts, rubbish, and something to pull it in</h3>
    <p>More things to put things in, each for a job a chest does badly.</p>
    <p>A <b>raw material bin</b> holds <b>${furnitureDef('bulk_bin').capacity}</b> of what comes out of the ground, off a tree, out of a
    vein or off a beast unworked &mdash; ore, logs, dirt, sand, clay, shards, wool, hides &mdash; and
    refuses everything a bench, a kiln or a smelter has touched: no bricks, planks or lumps, and no
    food. It is where a mine's output goes.</p>
    <p>A <b>craft material bin</b> is its opposite number, off the same bill of materials, and takes
    exactly what the other one refuses: planks, nails, ribbons, hinges, lumps, bricks, cloth, arrows
    &mdash; every material a bench, a kiln or a smelter has turned out, and nothing else. Between them
    the bins take every material in the game, and neither takes a tool, a crop or a meal.</p>
    <p>It is the first of the ${numberWord(FURNITURE.filter((f) => f.heft).length)} stores that <b>do not count what is in them</b>. It weighs it:
    <b>${CRAFT_HEFT} kg</b>, which is ${numberWord(Math.round(CRAFT_HEFT / itemDef('nail').weight))} nails or ${numberWord(Math.round(CRAFT_HEFT / itemDef('plank').weight))} planks, and there is no
    limit on the number of things at all. Built of a stronger wood it holds proportionally more, the way
    every other store does. It is where a forge's and a carpenter's output goes.</p>
    <p>A <b>seed bin</b> and a <b>sprout bin</b> are the small pair, ${numberWord(furnitureDef('seed_bin').w * furnitureDef('seed_bin').h)} subtile each, ${bill('make_seed_bin')}
    apiece. Both weigh what is in them rather than counting it: the seed bin <b>${SEED_HEFT} kg</b>, which is
    ${Math.round(SEED_HEFT / itemDef('wheat_seed').weight)} wheat seeds or ${Math.round(SEED_HEFT / itemDef('potato_seed').weight)} seed potatoes, and the sprout bin <b>${SPROUT_HEFT} kg</b>, which is
    ${Math.round(SPROUT_HEFT / itemDef('sprout').weight)} sprouts. The seed bin takes the
    ${numberWord(CROP_BY_SEED.size)} sowable seeds and nothing else; the sprout bin takes sprouts and nothing else.</p>
    <p>A <b>trash crate</b> is built with a rotten bottom on purpose: anything put in it rots <b>${times(furnitureDef('trash_crate').trash ?? 1)}
    faster</b> than it would out in the rain, and is gone in minutes. <b>Put away</b> never picks
    it, whatever you are standing beside; you have to choose <b>Throw it in the trash</b> on the thing
    itself, so nothing goes in by accident.</p>
    <p>A <b>small cart</b> holds ${furnitureDef('cart').capacity} things and, once you <b>take hold of it</b>, follows you wherever
    you go until you <b>let go</b>. Load it at the mine and walk home. Only one cart at a time, and it
    will not follow you into water or up anything it cannot roll over.</p>
    <h3>Bridges</h3>
    <p>Water and ravines have been walls: the island is full of places you can see across and cannot get
    to. A <b>bridge</b> is a run of deck from one piece of solid ground to another at much the same height, and
    once it is finished it is simply ground &mdash; you walk it, you ride it, and depending on what it is
    made of you drive a cart over it.</p>
    <p>Stand on one bank and right-click the other: <b>Throw a bridge across from here</b>. It must run
    straight (north, south, east or west), both ends must be dry ground you can stand in the middle of,
    the ends must be within ${numberWord(END_SLOP)} height units of each other, and everything between must be at
    least ${numberWord(CLEARANCE)} units below the deck &mdash; a gap, not a slope. The deck is carried at the mean of its
    end tiles' heights, each taken at the tile's middle, the mean of its corners, or at the top of a foundation poured
    on it or of a finished deck on piers; an end on an upper floor is taken at that floor's height.
    ${NumberWord(Object.values(BRIDGES).filter((b) => b !== AQUEDUCT).length)} kinds:
    ${listed(Object.values(BRIDGES).filter((b) => b !== AQUEDUCT).map((b) => `a <b>${b.name.toLowerCase()}</b> (${billWords(b.bill)} a span${b.tool === 'trowel' ? ', with a trowel' : ''}) goes <b>${numberWord(b.span)}</b> tiles and ${b.carts ? 'carries a cart' : 'takes foot traffic only'}`))}.</p>
    <p>An end may also be a finished upper floor of a building, a jetty's floor among them, or a building's finished
    deck on piers. It may not be inside a building on a ground floor laid on the ground, nor on the end of another
    bridge, and no end meets its deck through a wall: from a storey or a deck, a bridge goes out through a doorway, an
    archway or an open side. Nothing is built on a tile a bridge comes ashore on.</p>
    <p>A planned bridge is built a span at a time, exactly as a wall is: stand by the open part and feed
    it what it wants, one unit a go. Until the last span is decked nothing crosses. Pulling one down
    again gives you half of what went into it. <b>${BRIDGE_PULL?.label}</b> is done within ${PULL_REACH} tiles of the middle of either end. Where either end stands on a
    settlement only its builders may do it, as only they may take down a building's wall there, and a guest may not; anywhere
    else, anybody may. A boat passes underneath.</p>
    <p>A <b>drawbridge</b> goes from open ground to open ground, neither end inside a building, with at most
    ${numberWord(BRIDGES.draw.span)} tiles of deck, and its first span also takes ${billWords(BRIDGES.draw.winch ?? [])} for its hinge,
    gallows, winch and chains. It is hinged at the end you set it out from, where its winch stands.
    ${gateReach('raise_drawbridge') === 0 ? 'Standing on that tile' : `Within ${numberWord(gateReach('raise_drawbridge'))} tiles of that tile`},
    <b>Raise the drawbridge</b> takes ${gateJobWords('raise_drawbridge', goSeconds)} and <b>Lower the drawbridge</b>
    ${gateJobWords('lower_drawbridge', goSeconds)}. Raised, it stands on end over its hinge: nobody, no cart and no wildermon
    crosses it, its hinge is shut, and it stops the eye there. What is under the span is then all there is, and anybody out on
    the deck as it goes up is left in it. A moat or a ditch under it keeps people off only where its sides are too steep to
    climb: a tile that falls more than ${MAX_STAND} height units from its highest corner to its lowest, or a step of more than
    ${MAX_STEP} between the middles of neighbouring tiles, each ${CLIMB_PER_LEVEL} more for every level of climbing. Water in it stops nobody; it
    is swum. Lowered, it is a bridge and carries a cart. Its deck is carried at the mean of its end tiles' heights, as every
    bridge's is, so one over a moat a tile wide, between the sloping tiles of its banks, sits halfway down it. A foundation
    on each end tile, dug to bare rock, set out and poured, is level with the tile's highest corner, the bank's, and the deck is
    then level with the bank. Its winch is not set on the ground under a jetty, and no jetty is floored out over its winch:
    its gallows rise there higher than a storey. Without a padlock anybody may raise or lower it; a padlock on its winch keeps raising,
    lowering and pulling it down to its key and the founder of the settlement it stands on, over and above who may pull a
    bridge down there.</p>
    <h3>Aqueducts</h3>
    <p>An <b>aqueduct</b> is a stone arcade with a channel of water along its top: it takes a spring's water out of a
    pond or a pool and carries it over whatever lies between to a basin up to <b>${numberWord(AQUEDUCT.span)}</b> tiles off.
    Right-click the tile it is to pour into &mdash; a pool dug in a foundation, a pond, a tiered fountain, or a hollow
    that would hold <b>${metres(SPRING_DEPTH)} m</b> of water or more over no more than ${POND_MOST} corners &mdash; and
    <b>Lead an aqueduct here</b> offers the first pond or pool met going straight out from it each way, north, south,
    east and west, as far as an aqueduct spans, and says why wherever one will not do. <b>Throw a bridge across</b>
    does not set one out.</p>
    <p>Its channel is carried at the height the water at its head stands when it is set out, and never moves. The
    water at its foot must stand no higher than that &mdash; a fountain holds its water <b>${FOUNTAIN_RIM}</b> height
    units over the ground it stands on &mdash; and everything under it at least <b>${metres(CLEARANCE)} m</b> below the
    channel's bed; nothing bridged or built may be in its way, nor a tree or a bush under a span, nor a bridge at
    either end, and on a settlement only its builders may lead water from it or to it. One pond or pool feeds one
    aqueduct: the first set out from it takes all its water, and another from the same water is refused. It is built
    as a bridge is, a span at a time and a unit a go, with a trowel: each span wants ${billWords(AQUEDUCT.bill)}, a
    masonry job at difficulty ${AQUEDUCT.difficulty}. <b>${AQUEDUCT_PULL?.label}</b> gives back half of what went into
    it, and is done as a bridge is pulled down: within ${PULL_REACH} tiles of the middle of either end, and where either end
    stands on a settlement, only by its builders. Its stone takes moss as a stone arch's does (see Ivy and moss on old stone).</p>
    <p>Nobody walks along it &mdash; its top is water between its parapets. Under it you go through its arches across
    its run, and once any of a span's stone is laid its piers stand in the way along it, from either end. The ground
    under its arches is walked, worn and climbed as it was, its cliffs as steep as ever. Nothing is planted, no
    building planned, no foundation poured and no pool dug under a span, and no tree seeds itself there.</p>
    <p>Finished, it runs whenever a spring's pond or pool stands over its head at the channel's height or higher:
    <b>all</b> the water that would have gone over that pond's lip, or that pool's edge, goes along the channel
    instead, and the stream that ran on from there dries up with every pond only it kept. The channel is
    <b>${CHANNEL_WIDE * TILE_METRES} m</b> wide and its water <b>${metres(CHANNEL_DEEP)} m</b> deep, running at the springs'
    own ${RUN_RATE} tiles a second: <b>${AQUEDUCT_LPS} litres a second</b>, ${AQUEDUCT_FLOW} a minute, and
    ${1 / RUN_RATE} s along each span. At its foot a <b>pool</b> is full already and goes over its lowest edge, as if a
    spring rose in it &mdash; never the edge its end pier stands on, which is a wall to it, as is every edge between
    neighbouring tiles of an aqueduct's line; a <b>hollow</b> fills at the channel's rate &mdash; ${CORNER_LITRES} litres for each corner under its
    water and each height unit of water over that corner &mdash; and then spills over its lip and runs on, at once if
    a spring's pond already stands in it; a
    <b>fountain</b> takes ${AQUEDUCT_LPS} litres a second on top of what its own well draws, so emptied it is full
    again in ${+((furnitureDef('fountain').well ?? 0) / AQUEDUCT_LPS).toFixed(2)} s; and onto bare ground it runs away downhill from the tile's lowest corner. The
    message as the last span is laid, and the aqueduct's own menu, say which, and how long a hollow takes to fill. A
    spring dug in the pond or the pool at its head says that its water goes along it.</p>
    <p>Where the water at its head stands lower than the channel &mdash; the spring stopped up, its pond cut lower
    &mdash; the channel runs dry, and whatever only it kept goes dry with it: a hollow it filled empties, a pool at its
    foot keeps its water and goes over its edge no more, and a fountain is back to its own well. Take the fountain
    away and the water pours onto that tile and away downhill from its lowest corner; fill the pool in and it lands on
    the foundation's top and goes off it over its lowest edge, as the pool's water did; set a fountain down there again
    and it keeps it again. The aqueduct's menu says why one stands dry: no spring's water at its head, water there
    standing under its channel, or another aqueduct from the same water taking it first.</p>
    <h3>Ivy and moss on old stone</h3>
    <p>Stone greens over as it stands. <b>Ivy</b> climbs every finished wall, fence and half wall of
    ${listed(WALL_MATERIALS.filter((m) => m.kind === 'stone').map((m) => m.name.toLowerCase()))}, up from its foot and down from its
    top where nothing stands on it, and keeps clear of doorways, arches, windows and gates. <b>Moss</b> gathers in the
    joints of paving (${listed(Object.values(TILE_DEFS).filter((d) => d.paved).map((d) => d.name.toLowerCase()))}), on a poured foundation, on
    ${listed(FURNITURE.filter((f) => f.mossy).map((f) => aOrAn(f.name)))}, on ${aOrAn(BRIDGES.stone.name)} and on ${aOrAn(BRIDGES.aqueduct.name)}. Each is bare on the day it is
    built, laid, set down or poured and greens a day at a time for <b>${GREEN_DAYS} days</b> &mdash; a day is
    ${GREEN_DAY / HOUR} hours of real time &mdash; and grows no more after that. Whatever was already standing when this came in
    started from bare stone that day. On an island the island keeps the clock, so everybody sees the same
    green on the same wall.</p>
    <p>How much of it shows is its days over ${GREEN_DAYS}, times a pace: <b>${GREEN_SUN}</b> for the top of anything
    and for a south or an east face, which the sun in the south-east is on; <b>${+(GREEN_SUN + GREEN_SHADE).toFixed(2)}</b> for a north
    or a west face, which it never reaches; and <b>${GREEN_WET}</b> more on a tile of water, ${percent(1 / GREEN_WET_REACH)} of that
    less for every tile further off, and none ${numberWord(GREEN_WET_REACH)} tiles away. So at the end a south or an east
    face shows ${percent(GREEN_SUN)} of its green, a north or a west face is covered after ${numberWord(coveredBy(GREEN_SUN + GREEN_SHADE))} days,
    and one looking out over water after ${numberWord(coveredBy(GREEN_SUN + GREEN_SHADE + GREEN_WET))}.</p>
    <p><b>${CLEAR_IVY.label}</b> with ${aOrAn(itemDef(CLEAR_IVY.tool ?? '').name)}: right-click a wall and choose the side, and every storey
    of the wall on that side comes clean at once. <b>${SCRUB_MOSS.label}</b> with ${aOrAn(itemDef(SCRUB_MOSS.tool ?? '').name)}: right-click
    the paving or the foundation (both, where one tile has both), the statue, the arch or the aqueduct. Either takes
    ${spanWords(goSeconds(CLEAR_IVY.baseTime))} a go with a tool of no quality, less with a better one, and ${percent(CLEAR_IVY.stamina)} of your
    stamina, and leaves bare stone that starts greening again from then. Nothing is cleared that has not
    grown a day yet. On a settlement only its builders may do it, and a guest may not; anywhere else,
    anybody may.</p>
    <h3>Boats</h3>
    <p>${NumberWord(BOATS.length)} hulls, all of them a carpenter's work. A <b>rowing boat</b> is ${bill('make_rowing_boat', true)};
    she carries <b>${ROWER.capacity} things</b>, wants <b>${numberWord(ROWER.boat?.draught ?? 0)} deep</b> of water under her and is rowed, so your
    <b>body strength</b> is the engine. A <b>sailing boat</b> is ${bill('make_sailing_boat', true)};
    she carries <b>${SAILER.capacity}</b>, wants <b>${numberWord(SAILER.boat?.draught ?? 0)} deep</b>, and the wind
    does the work, so it is <b>body control</b> that decides how much of it you waste. A <b>caravel</b> is
    ${bill('make_caravel', true)}, and she takes a whole tile; she carries <b>${SHIP.capacity}</b>, wants
    <b>${numberWord(SHIP.boat?.draught ?? 0)} deep</b>, makes <b>${SHIP.boat?.speed}</b> tiles a second at a fair effort to the
    sailing boat's <b>${SAILER.boat?.speed}</b>, and carries <b>${numberWord(SHIP.boat?.passengers ?? 0)} passengers</b> besides
    whoever has her helm.</p>
    <p><b>Launch</b> her by setting her down on water deep enough while you stand on the bank &mdash; she
    will not go on land and will not go in a puddle. <b>Climb aboard</b> from the shore and she moves
    with you, over any water with depth enough and over nothing else: no beaching, no dragging her over
    a sandbar. <b>Step ashore</b> puts you on the nearest dry ground, and refuses if there is none within
    reach, so bring her in before you get out.</p>
    <p><b>Passengers.</b> Stand beside a caravel and <b>Come aboard as a passenger</b>: you take the first of her
    ${numberWord(SHIP.boat?.passengers ?? 0)} places on deck that is free, and from then on you go where she goes and your own
    feet go nowhere. <b>Step ashore</b> works for a passenger as it does for the helm. Anybody on her deck may
    <b>Take the helm</b> when nobody holds it, or when whoever held it has gone away and left her at sea; nobody
    takes it out of the hands of somebody who is here. She is not picked up or turned with anybody aboard.</p>
    <p>What a boat is really for, besides the coast itself, is the water under it. A line cast over the
    side of a boat in deep water reaches everything that swims &mdash; pike and sturgeon
    included &mdash; which no bank on a shelving shore will ever do.</p>
    <h3>Wind, and how a sail uses it</h3>
    <p>The wind has a direction and a strength and neither of them is yours. Both wander &mdash; it may
    be a flat calm at one hour and a gale later the same day &mdash; and it is worked out from the clock,
    so it is the same wind for anybody who was there at that hour and it is a different wind on a
    different island.</p>
    <p>A <b>rowing boat</b> ignores all of it: oars are oars. A <b>sailing boat</b> lives on it, and far
    more on the <b>angle</b> you hold than on the strength. Across the wind is fastest; before it is
    steady and slower; hard up into it is hard work; and inside the last ${numberWord(Math.round((NO_GO * 180) / Math.PI))} degrees she is
    <b>in irons</b> &mdash; the sail shakes, she makes almost no way at all, and the only way to get
    somewhere upwind is to <b>tack</b>: sail as close as she will lie on one side of it, then bear away
    and do the same on the other. A sailing boat of quality ${SAIL_EXAMPLE.ql} with body control ${CHAR_START} at the tiller, in
    ${windWord(SAIL_EXAMPLE.force)}, makes ${sailSpeeds} tiles a second on a beam reach, running, close-hauled and in irons.</p>
    <p>The bars show the wind whenever you are under sail: an arrow flying with it, what it is called,
    where it is out of, and what point of sail you are on. The sail on the boat goes out on whichever
    side the wind is and empties when you point into it.</p>
    <p>A sailing boat <b>holds ${numberWord(SAILER.capacity ?? 0)} things</b>, crates included, and that is what she is for
    &mdash; but a hull loaded to her marks is ${percent(BOAT_LOAD_DRAG)} slower than one running empty.</p>
    <h3>Why a road is worth its stone</h3>
    <p>Feet hardly care what is under them: sand is walked at ${percent(ground(TileType.Sand).speed)} of the pace of grass and laid
    stone at ${percent(ground(TileType.Slabs).speed)}, and only a bog really tells, at ${percent(ground(TileType.Marsh).speed)}. A <b>laden wheel</b> cares about very
    little else. An empty cart rolls over anything at its own pace; a full one is held to what the ground
    will take, and between empty and full it is a straight blend, so a half-loaded cart pays half.</p>
    <p>Stone slabs and cobble cost a full wagon <b>nothing</b>. Packed dirt costs ${share(rollCost(TileType.PackedDirt))}, bare
    grass ${share(rollCost(TileType.Grass))}, sand ${share(rollCost(TileType.Sand))}, a tilled field ${share(rollCost(TileType.Field))}, and a <b>bog ${share(rollCost(TileType.Marsh))}</b>. What a full
    wagon crosses in a minute on a paved road takes it <b>${spanWords(wagonMinute(TileType.Grass))} over grass and
    ${spanWords(wagonMinute(TileType.Marsh))} through marsh</b> &mdash; which is the whole argument for paving, and why the stone is
    worth cutting.</p>
    <p>Walking somewhere with a load routes you the way a carter would take it: round the bog and along
    the stone, even when the stone is the longer way about. An empty cart still cuts straight through.
    The hud says what the ground under you is costing whenever it costs anything.</p>
    <h3>Paths worn by feet</h3>
    <p>${capital(listed([...WEARS].map((t) => ground(t as TileType).name.toLowerCase())))} wear where people walk. Every step
    onto a tile of it adds <b>one</b> to its wear, up to <b>${WEAR_MOST}</b>, and at <b>${WEAR_TRAIL}</b> it is worn through
    to a <b>trail</b> of bare earth. Every day at <b>${hudHour(TREE_DAWN_UTC)} UTC</b>, when the woods turn, each tile
    loses <b>${WEAR_FALL}</b>, and a trail with none left grows back into what it was.</p>
    <p>So a line walked there and back ${often(TRIPS_A_DAY[0])} a day is a trail in
    <b>${numberWord(daysToTrail(STEPS_A_TRIP * TRIPS_A_DAY[0]) ?? 0)} days</b>, and one walked there and back
    ${often(TRIPS_A_DAY[1])} a day in <b>${numberWord(daysToTrail(STEPS_A_TRIP * TRIPS_A_DAY[1]) ?? 0)}</b>;
    ${daysToTrail(WEAR_FALL) === null ? `crossing a tile ${often(WEAR_FALL)} a day never wears it through, though it keeps a trail that is there already open` : `crossing a tile ${often(WEAR_FALL)} a day wears it through in ${numberWord(daysToTrail(WEAR_FALL) ?? 0)} days`}.
    A trail nobody walks is gone again within <b>${numberWord(Math.ceil(WEAR_MOST / WEAR_FALL))} days</b>. Examine a tile to
    see its wear.</p>
    <p>Only your own feet wear the ground: riding, a seat on a cart and a deck do not, nor does walking a
    bridge or a floor above the ground. Paved, built on, tilled or planted ground never wears, and nor
    does ground a building or a foundation stands on. A trail is walked and rolled like packed dirt
    &mdash; at ${percent(ground(TileType.Trail).speed)} of the pace of grass on foot, costing a full wagon
    ${share(rollCost(TileType.Trail))} &mdash; and is dug, packed and paved like it. Nothing flowers on one.</p>
    <h3>Wildflowers</h3>
    <p>Grass flowers in ${listed(FLOWER_SEASONS)}: pink, white, yellow and a little blue, in drifts set by
    where the ground is, the same for everybody. A tile in a drift carries up to
    <b>${numberWord(FLOWER_MOST.summer)} clumps</b> in summer, when the drifts are widest, and up to
    <b>${numberWord(FLOWER_MOST.spring)}</b> in spring; nothing flowers in autumn or winter. Only grass flowers:
    lawn, steppe, tundra, moss, a trail, a field and paving never do, nor does anything under a building.</p>
    <p>Choose <b>Pick flowers</b> on a tile in flower, with bare hands: you get a <b>wildflower</b> for each clump
    on it, at your foraging quality, and foraging rises. The tile is bare of them for everybody until the
    first day of the next ${SEASONS[0]}, when every picked tile flowers again.</p>
    <p>Wildflowers are for <b>dye</b>: ${bill('make_wildflowers')} boil into ${numberWord(made('make_wildflowers'))} pots of
    ${DYES.find((d) => d.id === 'wildflowers')?.word ?? 'orange'}, at ${workedAt('make_wildflowers')}.</p>
    <h3>Large carts and wagons</h3>
    <p>A small cart is a barrow you pull yourself. The ones that follow are <b>driven</b>: a wildermon
    goes in the traces, you sit on the seat, and what is on the back weighs nothing at all as far as the
    wheels are concerned.</p>
    <p>Both are <b>rough carpentry</b> rather than fine, and both are built out of parts:</p>
    <ul>
      <li><b>Large wheel</b> &mdash; ${bill('make_large_wheel', true)}, with a mallet.</li>
      <li><b>Big axle</b> &mdash; an <b>axle mould</b> ${mouldNote('axle_mould')}.</li>
      <li><b>Metal ribbon</b> &mdash; a <b>ribbon mould</b> ${mouldNote('ribbon_mould')}.</li>
      <li><b>Yoke</b> &mdash; ${bill('make_yoke')}, stitched with an awl. One per hitch.</li>
    </ul>
    <p>A <b>large cart</b> takes ${bill('make_large_cart', true)}. It holds <b>${CART.capacity} things of any weight</b> and has ${numberWord(CART.vehicle?.yokes ?? 0)} yokes:
    ${numberWord(CART.vehicle?.needs ?? 0)} wildermon will move it, ${numberWord(CART.vehicle?.yokes ?? 0)} move it faster.</p>
    <p>A <b>wagon</b> takes ${bill('make_wagon', true)}. It holds <b>${WAGON.capacity} things</b> and will not stir until
    <b>${WAGON.vehicle ? teamSaid(WAGON.vehicle) : ''} yokes</b> have a wildermon in them.</p>
    <p>Set one down, stand beside it and <b>hitch</b> a tamed wildermon from its menu &mdash; one you
    have with you or a deed worker; one in a creature crate is let out of it first. Then <b>take the reins</b> and drive. How fast you go is the team's business and nothing
    else's: a quick animal gets there sooner, more of them pull better than fewer, and a hungry one
    drags its feet, so feed the team before it goes in. A Seavic pair will outrun you at a walk; ${numberWord(WAGON.vehicle?.needs ?? 0)}
    Quarra will not, but they will shift ${numberWord(WAGON.capacity ?? 0)} bricks.</p>
    <p>The team is not only the pace but the pitch: a draught beast trains <b>climbing</b> by hauling
    over bad ground, and what the team knows between them decides both how fast the wheels turn and how
    steep a step they will take. A green pair balks at a bank a worked pair goes straight up.</p>
    <p>Wheels keep to open ground: no fords, no stairs and nothing steeper than a horse would take. They
    go indoors on the ground floor through an <b>arch</b>, a <b>double door</b> or a <b>gate</b>, and never
    through a plain door. You
    cannot pick a vehicle up with anything on it or anything in the yokes.</p>
    <p>A beast in the traces <b>stays hitched until somebody takes it out</b> &mdash; one at a time from
    its own menu, or the whole team from the vehicle's. Until then it stands at the vehicle and goes
    where the vehicle goes. It does not follow you, work, answer the bell or wander; it cannot be put
    in a crate, set to a post, released or culled; <b>it does not get hungry</b>, though feeding it
    still fills it; and <b>nothing picks it as a target</b>.</p>
    <p>A vehicle is <b>anybody's to use</b>. Whoever built it and whosever ground it stands on, anyone
    standing at it may take the reins, take hold of a cart, hitch to it, take a beast out of it, load it,
    empty it or pick it up.</p>
    <p>While you have the reins of a cart or wagon, or a small cart by the shafts, <b>whatever you gather
    goes into it</b>: ore, stone and gems from mining, dirt, sand and clay from digging, logs, sprouts,
    forage and herbs, fruit, a harvest, a catch, what you butcher and what you shear. It fills the cart as
    far as it has room, and what does not fit goes in your pack, with one line to say the cart is full. A
    boat is not a cart: what you gather in one goes in your pack.</p>
    <h3>Water: the well and the barrels</h3>
    <p>Until now water meant walking to the shore. A <b>well</b> is a mason's job &mdash; ${bill('make_well')}
    &mdash; and once it is sunk it <b>draws its own water</b>, a little
    at a time, up to <b>${furnitureDef('well').well} litres</b>. How fast depends entirely on how well it was built: a poor shaft
    trickles, a fine one keeps up with a settlement. Fill a bucket or a waterskin at it exactly as you
    would at a shore, or <b>drink from it</b> where you stand.</p>
    <p><b>Barrels</b> hold liquid and nothing else, in ${numberWord(BARRELS.length)} sizes:
    ${listed(BARRELS.map((f, i) => `<b>${f.name.toLowerCase()}</b> (${f.liquid}${i === 0 ? ' litres' : ''})`))}. One barrel holds one liquid &mdash; water or lye, not
    both. <b>Pour</b> a full bucket in and you get the empty bucket back; point at a stack of them and
    the whole lot goes in one after another. Filling a bucket beside a barrel draws out of the barrel,
    so a large barrel of lye is a tannery's worth of work waiting to be done.</p>
    <h3>Rest, and what the cooking is for</h3>
    <p>Sleeping in a bed banks <b>rest</b> &mdash; ${share(REST_PER_SECOND)} the night at a perfect bed and less in a poorer one,
    up to ${spanWords(REST_CAP)} of it held at a time. Rest burns only while you are actually working, and everything you
    do while it burns <b>teaches you ${times(REST_MULT)} as much</b>. The hud shows how much you have left.</p>
    <p>Every cooked dish <b>favours one trade</b>, and eating it leaves a <b>knack</b> for that trade
    for a while &mdash; ${times(1 + BOON_BONUS)} as much, for anything from ${spanWords(DISH_SHORTEST)} to ${spanWords(DISH_LONGEST)} by how
    filling the dish was and how well it was made. It is the same kind of thing a long day at a trade
    leaves behind, with the one difference that a knack off the table wears off and a knack earned at
    the work never does. Which dish favours which trade is settled when the island is
    raised and never changes on it, and every island settles it differently, so <b>examine</b> a dish to see what it is
    good for. A second helping of the same thing puts the clock back rather than stacking. That is what
    the stews and the bread and the cheese are for: not the food bar, which a raw potato would fill, but
    an afternoon of carpentry that teaches you ${times(1 + BOON_BONUS)} as much.</p>
    <h3>What is actually in a meal</h3>
    <p>Filling the food bar takes a raw potato. Eating <i>well</i> is a different question. ${NumberWord(NUTRIENTS.length)} things
    a body wants are kept separately under the food bar, each fed by different food and each falling
    away on its own over <b>${spanWords(NUTRIENT_HOURS)}</b>:</p>
    <table>
      <tr><td><b>Starch</b></td><td>bread, porridge, roots and grain</td></tr>
      <tr><td><b>Flesh</b></td><td>meat and fish &mdash; cooked, meat is worth ${times(feeds('cooked_meat', 'flesh') / feeds('meat', 'flesh'))} raw</td></tr>
      <tr><td><b>Fat</b></td><td>oil, nuts, cheese and what is fried in them</td></tr>
      <tr><td><b>Greens</b></td><td>vegetables, fruit and berries</td></tr>
    </table>
    <p>Raw food feeds one of them a little: a potato is ${percent(feeds('potato', 'starch'))} starch, a piece of
    meat ${percent(feeds('meat', 'flesh'))} flesh. A <b>cooked dish feeds several, and feeds them properly</b> &mdash; bread is
    ${percent(feeds('bread', 'starch'))} starch, cooked fish ${percent(feeds('cooked_fish', 'flesh'))} flesh and ${percent(feeds('cooked_fish', 'fat'))} fat, and a <b>stew</b> is the only thing on
    the island that feeds all ${numberWord(NUTRIENTS.length)} at once. Better cooking fills them fuller, so quality tells here as
    everywhere.</p>
    <p>What comes of it: anything in you at all <b>holds hunger and thirst off</b>. On a full board
    they fall at <b>${share(1 - KEPT_BEST)}</b> of their ordinary pace, which is ${spanWords(0.5 / (HUNGER_RATE * (1 - KEPT_BEST)))} rather
    than ${spanWords(0.5 / HUNGER_RATE)} before the hunger bar is down to half. And a board with <b>all of them</b> full makes
    everything you do teach you <b>${share(TABLE_BEST)} more</b> &mdash; but that one reads off whichever of them
    is <b>shortest</b>, so every one of them full but one empty is worth nothing at all. Bread and nothing
    else buys you nothing; it is the spread that pays.</p>
    <h3>Money, and four ways to spend it</h3>
    <p>Coins have been struck on this island since there was an anvil to strike them on, and until
    now they have bought nothing at all. One number settles it: <b>a gold coin is worth ${numberWord(GOLD)}
    silver</b>, every price is named in silver, and change comes back in silver. Paying takes your
    largest coins first, so ${numberWord(GOLD + 1)} silver out of a gold and ${numberWord(POCKET)} leaves you the ${numberWord(POCKET - 1)} rather than
    breaking the small change.</p>
    <p>Goods change hands in the ways below, each the answer to a different question, and a board
    finds what is for sale and what is wanted. The <b>Market</b> window (<kbd>U</kbd>) holds all of them.</p>
    <p><b>The market board</b> is read at a settlement token or a mailbox: every stall on the island,
    where it stands, whose it is, what is for sale on it and at what price, nearest first. Buying is
    done at the stall: stand at its counter and press <b>Buy</b>, and the price comes out of your
    purse and goes into its till.</p>
    <p><b>A deal</b> is for when you are both there. Tick what you are giving, name what you want
    for it, and choose who: the offer goes out with its terms written down, and whatever you put up
    is held out of your pack while it stands, so nothing offered can be eaten, sold or promised
    to anybody else. They take it whole or turn it down whole — there is nothing to re-read at the last
    moment — and you can take it back until they answer. You both have to be within a few tiles to
    shake on it.</p>
    <p><b>A stall</b> is for when you are not there. Nail one up, put goods on the counter, set a
    price on each, and it sells while you are asleep: the coins go into its till and wait for you.
    It is the only thing on this island that does anything for you while you are away, and it is
    the whole reason coins are worth striking. What is on it comes back off it for its owner alone;
    anybody else buys it. A thing taken back off the counter is not for sale again until it is
    priced again.</p>
    <p><b>A buy order</b> is for what nobody has put out. At a settlement token or a mailbox, on the
    <b>Orders</b> tab, name a kind of thing, the lowest quality that will do (nought takes any), how many,
    and the silver you will pay for each: the whole price comes out of your purse there and then and is
    held against the order, which goes on the board after the stalls with your name and where you put it
    up. Anybody else at a token or a mailbox can fill it, all of it or some, and is paid out of what it
    holds at once. The island chooses what goes out of their pack: anything of that kind, whatever it is
    made of, at that quality or better, the poorest first &mdash; never anything locked, worn or in hand,
    held out in a deal, or with something inside it. What they bring comes to you by the post and waits
    at any mailbox, and you are told. Take an order back whenever you like, from anywhere, and what it
    still holds comes back to your purse; one left open for <b>${spanWords(ORDER_LIFE)}</b> lapses and gives
    it back by itself. Nobody fills their own.</p>
    <p><b>A parcel</b> is for when neither of you is there. A letter has carried ${numberWord(LETTER_MAX)}
    characters and nothing else; it carries things now, posted at a <b>mailbox</b> and drawn out at
    any other. Both ends want a box — without one you may still write, and nothing but words will
    cross the island. A parcel is the other person's from the moment it goes in.</p>
    <p><b>A wildermon</b> changes hands in its creature crate: in a deal, on a stall and in the post,
    and on a stall in no other store. Whoever the crate goes to keeps the wildermon in it. While the
    crate is on offer, on a stall or in the post it cannot be opened, and what is in it cannot be let
    go or culled.</p>
    <h3>Who may do what on a settlement</h3>
    <p>Being asked onto somebody's land used to be all or nothing: everybody on the roll could dig
    up the gardens, empty the stores and pull the walls down. There are ${numberWord(DEED_RANKS.length)} standings now.</p>
    <table>
      <tr><td><b>Founder</b></td><td>Planted the stake. Everything, and the master key to every lock on their own land.</td></tr>
      <tr><td><b>Mayor</b></td><td>Everything but founding: builds, and asks people in and out.</td></tr>
      <tr><td><b>Builder</b></td><td>The ordinary citizen, and what an invitation makes you: shapes the ground, builds, takes from the stores.</td></tr>
      <tr><td><b>Guest</b></td><td>Walks the land and shapes nothing. What you offer somebody you want to show round.</td></tr>
    </table>
    <p>A guest still belongs to the settlement — they may walk it, and their wildermon still work
    there — they simply may not dig it up. Pointing at any ground says whose it is and what you are
    on it, which is also how you read a <b>stranger's</b> settlement from outside: its name, who
    founded it, and that you may walk it and shape nothing.</p>
    <p>And a building on a settlement is every builder's to work on, not only its planner's, so
    several people can fill one wall's bill between them.</p>
    <h3>Padlocks and keys</h3>
    <p>Everything anybody built has been open to everybody who could walk to it. A crate on your own
    deed was safe because the <i>ground</i> was yours; a crate anywhere else, a cart at a work post,
    a cupboard in a house you had invited somebody into, was a thing anybody could empty.</p>
    <p>A <b>padlock</b> is forged at a smelter and comes with no key. <b>Fit</b> it to a crate, a
    piece of storage furniture, a portcullis or a drawbridge's winch and it closes and cuts <b>one key</b> to itself, there and then. A key
    is an ordinary item: hand it over and you have handed over what it opens, and there is no list
    anywhere saying you did. Take the padlock off and the key goes with it.</p>
    <p>On a <b>ship, a wagon or a cart</b> a padlock locks more than the hold: without its key
    nobody takes the helm or the reins, takes hold of the shafts, comes aboard as a passenger or
    picks it up to carry it off. Stepping ashore and getting down are never refused.</p>
    <p>One way back in, because losing a small item should not cost you a building: the
    <b>founder</b> of the settlement a store stands on may open anything on their own land. So a
    padlock is worth a great deal on somebody else's deed and rather less on your own.</p>
    <h3>Where the animals live</h3>
    <p>Everything wild has <b>a home</b>: a patch of country it keeps to, set where it was first
    put down. It wanders about that ground and turns back when it strays too far, so the places you
    learn to go for a particular animal stay the places you go for it.</p>
    <p>Grazers keep company. One that arrives near others of its kind takes <b>their</b> ground for
    its own, so you find them together and they move together — a herd, made without anybody
    writing a list. Hunters do not: each keeps its own range, because what makes a hunter
    frightening is meeting it where it lives rather than meeting a pack of them.</p>
    <p>That changes what running from one is like. A hunter gives up when it has run the length of
    its leash <i>or</i> when it has come as far from its own ground as it is willing to — whichever
    happens first. So one you walk in on at its den will chase you a long way, and one you meet at
    the edge of its range gives up quickly, because it is already nearly as far out as it goes.
    Either way it turns for home afterwards rather than staying where it stopped.</p>
    <h3>The field guide</h3>
    <p>The <b>Field guide</b> window (<kbd>F4</kbd>) has a page for each of the ${numberWord(guidePages().length)} kinds of
    creature there are, and marks which of them you have <b>seen</b>, <b>tamed</b> and <b>bred</b>. A kind is seen once one
    has stood out of a crate somewhere you could see it, which counts what your own wildermon and your settlement see for
    you; tamed once an offering takes, or you get one out of a trap; bred once a young one is born to a dam you keep. Taming
    or breeding one marks it seen as well, and the first time you see a kind the event log says so. The index draws every
    kind you have seen and leaves the rest as a shadow of their shape, and over it says how far along you are: seen out of
    all ${numberWord(guidePages().length)}, tamed and bred out of the ${numberWord(guidePages().filter(keepable).length)} that
    can be, since a monster cannot. A kind's page says where the wild puts it down and how far it keeps from its home, how
    often the wild's roll comes out as it, the taming it asks and what it takes from your hand, what it does for you once
    it is yours, what it is like to meet and what a carcass gives &mdash; all of it read off the rules. <b>Field guide</b>
    on any creature's menu opens its page. Alone, the book is kept in your save; on an island the island keeps it, and
    takes a kind you have seen only while one is standing within ${numberWord(MOBS_RANGE)} tiles of you.</p>
    <h3>What the island will not tell you</h3>
    <p>A handful of rules here are real, load-bearing, and findable only by being refused or by
    making a great many of something and noticing. They are worth knowing up front.</p>
    <p><b>Your skill is the ceiling; your tool decides how often you reach it.</b> Nothing you make
    is ever better than your hands. A go rolls against the quality of the tool: land it and the
    piece comes out at your skill, miss it and the piece comes out at roughly what the tool is
    worth. The copper chisel you washed ashore with is quality ${numberWord(kitQl('chisel'))}, so it reaches your ceiling
    about one go in ${numberWord(Math.round(100 / kitQl('chisel')))}. That is the whole reason to better a tool, and every recipe row in
    <b>Crafting</b> (<kbd>R</kbd>) now says what it would come out at and marks the ones where the
    tool rather than your hands is the thing in the way.</p>
    <p><b>A job that costs no wind and takes no time teaches your body nothing.</b> Examining a
    tile, locking a chest, naming a thing, choosing a stance — all free, all instant, and none of
    them exercise. Only work that costs something teaches anything.</p>
    <p><b>A cart needs an opening it fits through.</b> A person turns sideways through a single
    door; wheels do not. A double door, an archway or a gate is what a cart, a wagon or a team
    needs, and a fence with no way through it is a cart trap.</p>
    <p><b>Everything rots where it lies.</b> A deed slows that to ${share(DEED_DECAY)}, a roof over a closed
    room slows it to ${share(INDOORS_DECAY)} again, and a crate or a sack slows it further still. A pile of planks
    left in a field is a pile of planks you are going to lose.</p>
    <p><b>A refusal is information.</b> Nothing here fails silently: when a job will not go, the
    line in <b>Trouble</b> says which tool, which material, which skill or which distance is
    wrong. It is nearly always quicker to try the thing and read the refusal than to guess.</p>
    <h3>Walking, running, and looking into a room</h3>
    <p>A <b>run is not a walk gone faster</b>. Anything covering ground quickly — you on a good
    road, a mount at full stretch, a hunter closing on you — reaches further with each step,
    drives back harder than it recovers, leans at the ground ahead of it and leaves the ground
    between footfalls. Nothing has to be switched on: it is read from how much ground the thing is
    actually covering, so every animal and every person on the island has it.</p>
    <p>And standing <b>inside a building</b>, the walls between you and the camera fade — the walls
    of <i>your room</i>, not of the whole house, so the far end of a longhouse keeps its own and
    you can still tell where the building is. <kbd>X</kbd> is still there for taking every near
    wall away at once, everywhere.</p>
    <h3>Walking away from a job</h3>
    <p>Walking somewhere <b>puts the work down</b> rather than forgetting it. Whatever was in hand
    goes to the front of the list with however many goes it had left, everything queued behind it
    stays queued, and the bar says how many are waiting. Nothing starts itself again — being
    dragged back across a yard you crossed on purpose would be worse than losing the list — so
    press <b>Carry on</b> on the bar, or <kbd>B</kbd>, when you want them back. <kbd>Esc</kbd>
    still forgets the lot, which is what <kbd>Esc</kbd> has always been for.</p>
    <h3>Improving up to a quality</h3>
    <p>Asking for a number of passes is asking for a number nobody can work out: what a pass is
    worth falls away as the piece gets better, so the last few points of quality take many times the
    passes the first few did. An item's <b>Improve</b> menu offers <b>Up to…</b> instead — name a
    quality and it works until it gets there and then stops. It stops early, and says so, if your
    hands top out first.</p>
    <h3>Finding things in a store</h3>
    <p>A crate, a cupboard, a cart and a bag all have a <b>search box</b> and the same
    <b>ordering</b> the pack has: by name, quality, weight, damage or how many. A deed crate holds
    ${CRATE_DEFS.plank.capacity} things of every sort the deed turns up, so it is the store that needed it most.</p>
    <h3>What you can hear</h3>
    <p>The island makes a noise now, and what the noise is depends on what is being hit.
    <b>Footfalls</b> take their sound from the ground: grass is a brush with no edge on it, sand
    is sharper, laid stone is a hard click, a plank deck answers under you with a note
    in it, and snow is a squeak. Water closes over a boot rather than being stepped on.</p>
    <p><b>Work</b> is the same idea: the trade decides, because a mason is hitting stone whatever
    he is making out of it. A spade going into clay, a point cracking into rock, an axe biting a
    trunk, a hammer on an anvil — the anvil is the loud one, and the only thing in the game with a
    real ring to it.</p>
    <p>Everything is placed where it is happening, and the <b>camera is the ear</b>: a smelter you
    have walked away from goes quiet, and so does one you have merely looked away from, because
    both pan and volume are measured off the screen. Pull the view back and the whole island gets
    further away and quieter together.</p>
    <p>Nothing here is a recording. Every sound in the game is made out of filtered noise and a
    handful of oscillators at the moment it is wanted, which is why there is nothing to download.
    <b>Settings</b> (<kbd>O</kbd>) has the volume at the top of the Display tab; sliding it to
    nothing turns the island off entirely.</p>
    <h3>Light after dark</h3>
    <p>Night takes <b>${share(NIGHT_LOSS)}</b> of your sight, which is enough to be a reason to stop walking.
    ${NumberWord(HELD_LIGHTS.length)} things go in your hand against it.</p>
    <p>A <b>torch</b> is ${countOf('cloth', need('make_torch', 'cloth'))} wound round the head of ${countOf('shaft', need('make_torch', 'shaft'))} (${workedAt('make_torch')}) and is
    the poor relation in every way that matters: <b>${numberWord(torchReach(LOW_QL))} to ${numberWord(torchReach(TOP_QL))} tiles</b> of light
    for <b>${spanWords(torchBurn(LOW_QL))} to ${spanWords(torchBurn(TOP_QL))}</b>, by how well it was wound, and when it is
    done it is gone &mdash; there is nothing left to refill. What it has over a lantern is that anybody
    can wind one in the first hour of a new island, which is exactly when the dark is worst.</p>
    <p>A <b>lantern</b> (${bill('make_lantern')} &mdash; ${workedAt('make_lantern')}) takes a <b>candle</b>
    (${bill('make_candle')} &mdash; ${workedAt('make_candle')}). A better one keeps the draught off the flame and throws further:
    <b>${numberWord(lanternReach(LOW_QL))} tiles and ${spanWords(candleBurn(LOW_QL))}</b> to a candle at the roughest,
    <b>${numberWord(lanternReach(TOP_QL))} tiles and ${spanWords(candleBurn(TOP_QL))}</b> at the best.</p>
    <p>Either is <b>lit at anything burning</b> you are standing at &mdash; a ${flameSources()} &mdash;
    or off something already alight in your own hand. Both burn <b>only while lit</b>, so carrying a
    dark lantern costs nothing but its weight, and both say so when they go out.</p>
    <p>Carrying one lit gives back <b>${share(LIGHT_GIVES_BACK)}</b> of what the dark takes from your sight, and its
    own reach is a <b>floor</b> under your sight however black it gets: you can always see as far as the
    thing in your hand throws.</p>
    <p>Everything else that burns casts a circle too: a <b>lit campfire</b> ${numberWord(FIRE_REACH)} tiles, an
    <b>oven, kiln or smelter</b> in blast ${numberWord(OVEN_REACH)}, and the ${numberWord(GLOWING.length)} creatures that carry a
    light of their own as far as it reaches &mdash; ${listed(GLOWING.map((s) => `a ${s.name.toLowerCase()} ${numberWord(s.glow ?? 0)}`))}.
    Each one burns a soft-edged hole in the night with a little firelight in it. None of this is worked
    out at all while the sun is up.</p>
    <p>A lantern hung on a <b>lantern post</b> or set in a <b>lantern pillar</b> stays where it is put and lights the ground round
    it for everybody, as far as it throws from your hand: see <i>Lantern posts</i>.</p>
    <h3>Night, and a bed to wake in</h3>
    <p>The island keeps a clock, shown beside your position: a full day and night passes in
    <b>${spanWords(DAY_SECONDS)}</b> of real time, ${spanWords(DAY_SECONDS / 24)} to the game hour. The sun goes down at
    <b>${hudHour(DUSK)}</b> and comes up at <b>${hudHour(DAWN)}</b>, so <b>${share(DAYLIT)} of it is day and
    ${share(1 - DAYLIT)} night</b> &mdash; ${spanWords(DAY_SECONDS * (1 - DAYLIT))} of real time dark in every day
    &mdash; and the light goes over the ${numberWord(2 * TWILIGHT)} game hours around sundown and comes back over the
    ${numberWord(2 * TWILIGHT)} around sunrise.</p>
    <p>And it keeps a <b>year</b>: ${numberWord(SEASONS.length)} seasons, ${listed([...SEASONS])}, of
    <b>${numberWord(SEASON_DAYS)} days</b> each, ${numberWord(YEAR_DAYS)} days in all. A day of the year is as long as a day and
    night of the clock, <b>${spanWords(DAY_SECONDS)}</b> of real time, so a season lasts <b>${spanWords(SEASON_SECONDS)}</b> and a
    year ${spanWords(YEAR_SECONDS)}. The days are counted from the first dawn of the first spring, <b>${hudHour(TREE_DAWN_UTC)} UTC</b>
    on ${new Date(YEAR_FROM * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })},
    the same on every island, rather than from the clock's midnight, which a night slept through moves on. The same line says
    which season it is and which day of it.</p>
    <p>The woods keep the year. ${capital(listed(TREE_DEFS.filter((_, i) => evergreen(i)).map((t) => t.name.toLowerCase())))} keep
    their leaves all year, a shade darker in winter. Every other tree comes into leaf over the first
    <b>${numberWord(LEAF_DAYS)} days of spring</b>, is in full leaf through summer, turns its own autumn colour over the
    first ${numberWord(TURN_DAYS)} days of autumn, drops its leaves over the last ${numberWord(SHED_DAYS)}, and stands <b>bare through winter</b>.
    Every tree old enough to fruit is <b>in flower for all ${numberWord(SEASON_DAYS)} days of spring</b>, and fruits as before.
    ${capital(listed(BUSH_DEFS.filter((b) => !BUSH_EVERGREEN.has(b.name)).map((b) => b.name.toLowerCase().replace(' bush', 's'))))} go bare in winter
    too and ${listed(BUSH_DEFS.filter((b) => BUSH_EVERGREEN.has(b.name)).map((b) => b.name.toLowerCase().replace(' bush', '')))} keeps its leaves;
    roses and lavender flower from day ${BUSH_FLOWER_FROM} of spring to the end of summer, the thorn through spring.
    None of it changes what a tree or a bush gives: that is only the look of the thing.</p>
    <p>And there is small life about, only to look at: <b>butterflies</b> at whatever is in flower by day,
    <b>dragonflies</b> over ponds, pools and streams from morning to dusk, <b>fireflies</b> over the grass by
    trees and water at night: ${lifeSeasons()}.</p>
    <p>A <b>bed</b> or a <b>cot</b> is worth more than the corner it stands in. Choose <b>Make this your
    home</b> and it becomes the place you wake up &mdash; whatever happens to you, wherever it happens.
    Choose <b>Sleep until morning</b> after dark and you wake with your wind back and some of your hurt
    mended; a well-made bed is a better night than a thin cot. Playing on your own you wake at
    <b>${hudHour(DAWN + WAKE_AFTER_DAWN)}</b>, and the world has not waited for you: fires burn down, crops come on,
    kilns finish and everything left outside ages by however long you were under. On an island the
    night is everybody's and one sleeper cannot skip it, so you wake rested with the clock where it was.
    You wake up hungry and thirsty, too.</p>
    <p>A Tailor can learn to make a <b>tent</b>: ${bill('make_tent')}, with a needle. Set it down anywhere and sleep in it
    as in a bed: a night in it rests you ${percent((furnitureDef('tent').bed ?? 0) / (furnitureDef('bed').bed ?? 1))} as well as the same night in a bed of its quality.</p>
    <h3>Finding things, and moving them in bulk</h3>
    <p>A settlement of any age has crates, bins, chests and carts all over it, and opening all of them
    to find the planks is no way to live. The <b>Stores</b> window (<kbd>U</kbd>) lists every container
    you own, nearest first, with how full each is and what is in it. Type what you are after and it
    narrows to the stores that have it and says how many; <b>Walk there</b> takes you, and <b>Open</b>
    opens it when you are already standing at it.</p>
    <p>At the foot of any open container, <b>Take all</b> empties it into your pack, <b>Put all in</b>
    puts everything loose in your pack into it, and <b>Put in what it holds</b> puts in only the kinds
    already in there, which is how a store is topped up without emptying your pack into it. Nothing
    <b>kept back</b> and nothing worn moves either way.</p>
    <p>The <b>inventory</b> can be ordered by name, quality, weight, damage or how many, and grouped by
    kind or run together in one flat list.</p>
    <p><b>Pick up everything here</b> sweeps the tile you are standing on and the ${numberWord((2 * Game.SWEEP + 1) ** 2 - 1)} around it in
    one go, nearest pile first, rather than one entry per pile.</p>
    <h3>Keeping something back</h3>
    <p>Right-click anything in the pack and choose <b>Keep this back</b>. A kept thing is never spent: no
    recipe takes it, no hook baits with it, nothing is fed it, and it cannot be dropped. It can still be
    <b>worked with</b> &mdash; that is the point, so your best hatchet can chop all day without a craft
    quietly eating it &mdash; and <b>Put it back in the pack</b> undoes it. Kept things read
    <i>kept back</i> in the list.</p>
    <h3>What your back will take</h3>
    <p>You carry <b>${CARRY_BASE} kilos</b> plus <b>${numberWord(CARRY_PER_STRENGTH)} kilos</b> for every point of <b>body
    strength</b>, so ${CARRY_BASE + CHAR_START * CARRY_PER_STRENGTH} at the start and ${CARRY_BASE + TOP_SKILL * CARRY_PER_STRENGTH} at ${numberWord(TOP_SKILL)}. Going over it costs, and
    the cost climbs with how far over you are: everything past the mark slows you and every action
    takes more wind, as armour does &mdash; ${numberWord(OVER_EXAMPLE)} kilos past a starting back drags on you like about
    ${numberWord(Math.round(overDrag(OVER_EXAMPLE, CARRY_BASE + CHAR_START * CARRY_PER_STRENGTH) / PLATE_SUIT))} full suits of iron plate. Past <b>${times(CARRY_STOP)}</b> your limit you are down to
    <b>${share(CARRY_CRAWL)} of your pace</b>. The inventory footer turns red and says by how much, and the bars
    say so too.</p>
    <p>The damage column turns <b>amber past ${DAMAGE_WARN}</b> and <b>red past ${DAMAGE_BREAKING}</b>, so a tool about to go to
    pieces says so where you are looking rather than only in the log.</p>
    <h3>Eating, and keeping your things</h3>
    <p>The <b>Eat</b> button beside the food bar eats the best thing you are carrying, and the
    <b>Feed</b> button on your companion's line gives it the <i>poorest</i> thing it will take, so the
    good food stays in your pack. Both are there to save hunting through the inventory.</p>
    <p><b>Tools wear out</b>, slowly. Every use puts a little damage on whatever tool the work called
    for, and a poor tool goes to pieces far faster than a good one &mdash; which is most of what quality
    is for: a copper tool is good for about ${numberWord(jobsAt(LOW_QL))} jobs at quality ${LOW_QL} and ${numberWord(jobsAt(TOP_QL))} at
    ${numberWord(TOP_QL)}, and what it is made of stretches or shortens that. Damage also makes a tool work as though it
    were poorer than it is. Past <b>${DAMAGE_WARN} damage</b> it warns you in red, and again at every
    ${numberWord(DAMAGE_WARN_STEP)} points after; at ${DAMAGE_MAX} it breaks and is gone.</p>
    <p>Right-click anything damaged and choose <b>Repair</b> &mdash; anything but a fragment or a tarnished bauble nobody has
    restored yet, which nothing mends (see <b>Digging up the past</b>). It is its own skill: the work goes on a go
    at a time, taking damage out and a little quality with it, and you can stop whenever you like.
    Taking ${numberWord(WORN)} damage out of a tool is ${numberWord(repairGoes(startOf('repair')))} goes at repair ${startOf('repair')} and costs it
    ${repairCost(startOf('repair'))} of quality; at repair ${SKILLED} it is ${numberWord(repairGoes(SKILLED))} goes for ${repairCost(SKILLED)}.
    Nothing is repaired once it is down to quality ${REPAIR_FLOOR}, so a thing mended often enough is finished in the
    end &mdash; but that is a long way off, and a good tool kept mended will outlast most of what you
    build with it.</p>
    <p>A Tailor can learn to <b>Patch</b> cloth and leather armour instead: one cloth or one leather, of the piece's own
    stuff, takes ${tailor('Patch').patch_item ?? 0} damage off it at a go and none of its quality.</p>
    <p>A Mender who has learned it makes a <b>repair kit</b> (${bill('make_repair_kit')}, with a ${itemDef(recipe('make_repair_kit').tool ?? '').name.toLowerCase()}), which anybody may
    <b>use</b> on anything damaged, wherever they are: it takes ${KIT_MEND} damage off and none of the quality, and is used up.
    One who has learned <b>sealant</b> (${bill('make_sealant')}) works it over a thing with <b>Seal it</b>, one to a thing and
    one for each thing in a pile, and a sealed thing never decays wherever it is left. Anybody may use sealant too.</p>
    <h3>Wounds, herbs and covers</h3>
    <p>A blow is not only a number off the bar. What gets through your armour leaves a <b>wound</b>, of
    a kind, in whichever place it landed, and that wound has its own life: it <b>bleeds</b> until it is
    dressed, it goes <b>bad</b> if it never is, and nothing on you knits at all while something is still
    open. The bars panel lists what you are carrying, worst first, and says what each one wants.</p>
    <p>${NumberWord(KINDS.length)} kinds, and each has a herb that suits it:
    ${listed(KINDS.map((k, i) => `a <b>${k.name}</b> ${i === 0 ? 'wants ' : ''}<b>${k.herb}</b>`))}. What leaves which
    is what hit you &mdash; a hoof bruises, a claw opens, a sting goes deep and narrow, and
    ${listed(BURNERS.map((s) => `the ${s.name.toLowerCase()}`))} burn.</p>
    <p>A wound is dressed with a bandage or a cover. A <b>bandage</b> is cloth cut ${numberWord(made('make_bandage'))} to a length with a knife; a
    <b>healing cover</b> is the herb itself, bruised into cotton, ${numberWord(made(`make_cover_${KINDS[0].herb}`))} to a batch on the
    <b>first aid</b> skill. Put on cleanly, either stops the bleeding and puts back between ${percent(healAmount(startOf('first_aid'), LOW_QL))} and
    ${percent(healAmount(TOP_SKILL, TOP_QL))} of your health at once, by your first aid and its quality. Right-click either
    and it goes on the worst thing open.</p>
    <p>What is on a wound decides how fast it closes and whether it turns. Under cloth it closes
    ${times(CLOSE_CLOTH / CLOSE_BARE)} as fast as with nothing on it. The <b>right herb</b> puts back
    ${times(SUITS_HEAL)} as much at once, closes it ${times(CLOSE_RIGHT / CLOSE_CLOTH)} as fast as cloth, and it <b>never
    turns</b>; the wrong herb puts back ${times(HERB_HEAL)} as much and closes it ${percent(CLOSE_WRONG / CLOSE_CLOTH - 1)} faster than cloth.
    Cloth leaves ${percent(FESTER_CLOTH)} of an open wound's chance of going bad, the wrong herb ${percent(FESTER_WRONG)}.
    And every ${numberWord(Math.round(CLOSE_PACE / CLOSE_PER_SKILL))} points of <b>chirurgy</b> closes every wound on you as fast again as
    it closed at none.</p>
    <p>A wound that has <b>gone bad</b> is a different problem: it drains rather than closes and no
    dressing will hold on it. Scour it out with a bucket of <b>lye</b> first &mdash; a hard piece of
    first aid, and it leaves the wound open and bleeding again, so dress it straight after.</p>
    <p>A <b>Naturalist</b> who has learned them makes a tea, a salve and a tincture, each of any one of the ${numberWord(KINDS.length)} healing herbs,
    and anybody who has one may use it. <b>Herb tea</b> (${numberWord(recipe(`brew_tea_${KINDS[0].herb}`).inputs[0].count ?? 1)} of the herb
    and a bucket of water, ${numberWord(made(`brew_tea_${KINDS[0].herb}`))} cups) puts back ${percent(itemDef('herb_tea').stamina ?? 0)} of
    your stamina a cup. A <b>salve</b> (${numberWord(recipe(`make_salve_${KINDS[0].herb}`).inputs[0].count ?? 1)} of the herb and beeswax)
    is rubbed into the worst dressed wound on you that could still go bad, and while it is on, it never does; it goes on over a
    dressing, not in place of one, and scouring the wound out takes it off. A <b>tincture</b>
    (${numberWord(recipe(`make_tincture_${KINDS[0].herb}`).inputs[0].count ?? 1)} of the herb) makes ${TINCTURE_NAMES} each go in
    ${percent(TINCTURE_BONUS)} faster for ${spanWords(TINCTURE_SECONDS)}, beside anything a dish's knack is doing for the same trade.</p>
    <p>A Naturalist with <b>Field Medic</b> dresses somebody else: stand beside them, right-click them and choose
    <b>Dress</b> <i>their name</i><b>'s wounds</b>. It goes on their worst wound, at your first aid and out of your pack.</p>
    <p>The same hands do as much for a hurt <b>wildermon</b>. Stand beside a tame one that has been in
    a fight and choose <b>Treat its wounds</b>: it takes a bandage and puts back the same share of its
    whole health, which is far more forgiving than waiting for it to mend itself. A wild creature will
    not stand still for you.</p>
    <h3>Dying, and your grave</h3>
    <p>When your health runs out you <b>die</b>, and wake on the shore you first came in on with every
    wound closed. <b>What you were carrying stays where you fell</b>, in a <b>grave</b> dug on that spot:
    the pack, whatever was in your hands, the toolbelt, and every bag with what is in it. What you wear
    stays on you &mdash; clothing, armour and a jewel &mdash; and so do a crate with a wildermon in it and
    anything you have offered in a deal. Go down in water too deep to stand in and the grave is on the
    nearest dry ground within <b>${numberWord(GRAVE_REACH)} tiles</b>, or where you fell if there is none.
    Carrying nothing, you leave no grave.</p>
    <p>For <b>${spanWords(GRAVE_KEEPS)}</b> of real time, whether or not you are playing, it is yours and
    nobody else's: only you can open it or take anything out of it, and nobody can pick it up or break
    it &mdash; anybody who tries is told whose it is. Open it the way you open a chest and take things out
    one at a time, or choose <b>Take everything</b>; nothing goes back in. When the time is up it
    <b>crumbles</b>, and whatever is still in it goes with it. Every death digs a grave of its own, and
    each is marked on your map until it crumbles.</p>
    <h3>What quality is worth</h3>
    <p><b>Your skill is the ceiling and your tool is the chance of reaching it.</b> The quality of the
    tool in your hand is the percentage chance that a piece of work comes out at your skill in that
    trade. Every other go comes out at what the tool itself is worth &mdash; ${QL_SPREAD} its quality,
    and never above your skill. The hatchet you washed ashore with is quality ${kitQl('hatchet')}, so
    ${share(kitQl('hatchet') / TOP_QL)} of your logs come out at your skill. Nothing you make is ever finer than
    the hands that made it, so a fine tool in a beginner's hands still only makes beginner's work
    &mdash; it just stops wasting the material.</p>
    <p>Work done with no tool at all &mdash; picking berries, tending a field &mdash; has nothing to
    roll against and comes out at ${QL_SPREAD} your skill, plus ${QL_BARE}.</p>
    <h3>Rare things</h3>
    <p>Now and again a thing comes off the bench better than the hands that made it had any right to
    produce. About ${listed(RARE_STEPS.map((step, i) => `<b>one thing in ${numberWord(Math.round(1 / rarityChance(step)))}</b> ${i === 0 ? 'is ' : ''}<b>${RARITIES[step].name}</b>`))}.
    Nothing brings it on &mdash; not skill, not tools, not the metal &mdash; and nothing you do can make
    it more likely; you make ${numberWord(Math.round(1 / rarityChance(RARITIES.length - 1)))} ordinary things and find that you have one.</p>
    <p>A rare thing is <b>better at whatever it was for</b> by ${listed(RARE_STEPS.map((step) => share(RARITIES[step].boost - 1))).replace(/ and ([^,]*)$/, ' or $1')}
    &mdash; an edge that bites, armour that turns aside more, a tool that works truer &mdash; <b>wears and rots
    at ${listed(RARE_STEPS.map((step) => percent(RARITIES[step].keep)))}</b> of an ordinary one's pace, and can be <b>improved past the
    ceiling of your own skill</b> by ${listed(RARE_STEPS.map((step) => String(RARITIES[step].ceiling))).replace(/ and ([^,]*)$/, ' or $1')}.</p>
    <p>Anything that <b>holds things</b> holds more of them: a bag, a crate, a cupboard, a weight
    bin, the charge a smelter will take and the load a kiln will fire all go up by
    ${percent(RARITY_ROOM)} a step &mdash; ${RARE_STEPS.map((n) => `<b>${percent(RARITY_ROOM * n)}</b>`).join(', ')}
    for rare, supreme and fantastic, and never less than <b>one more unit a step</b>, so a kiln's
    ${numberWord(KILN_CAPACITY)} becomes ${listed(RARE_STEPS.map((n) => numberWord(roomFor(KILN_CAPACITY, { rare: n }))))}. A rare thing keeps
    the room when you set it down, and keeps it again when you pick it back up.</p>
    <p>They are written in their own colour in your pack, and on the ground they <b>shine</b> in it:
    a few slow motes for a rare thing, more over a bloom for a supreme one, and a gold bloom under a
    turning star for a fantastic one, which you can pick out across a field.</p>
    <h3>Improving</h3>
    <p>A finished thing can be made better than it was made. Right-click it and choose <b>Improve</b>:
    each pass eats a little stock, and a success raises the quality &mdash; a great deal at first and
    very little near the end. A failure marks the piece instead, and once it is knocked about past
    ${IMPROVE_DAMAGE} damage you must <b>Repair</b> it before you can work on it again.</p>
    <p><b>The kit you came ashore with cannot be improved.</b> It is issued gear, serviceable and no
    more: mend it as often as you like, but there is nothing in it to work up. The first real job on
    this island is making your own tools and then bettering those, because every quality roll you will
    ever make is a roll against the tool in your hand.</p>
    <p><b>What you need depends on what it is made of.</b></p>
    <table>
      <tr><td><b>Metal</b></td><td>A <b>file</b> and a <b>whetstone</b>, and a lump of metal per pass</td></tr>
      <tr><td><b>Wood</b></td><td>A <b>carving knife</b> and a <b>file</b>, and a plank or shaft</td></tr>
      <tr><td><b>Cloth</b></td><td>A <b>needle</b>, and a length of cloth</td></tr>
      <tr><td><b>Leather</b></td><td>An <b>awl</b> and a <b>needle</b>, and a piece of tanned leather</td></tr>
      <tr><td><b>Stone</b></td><td>A <b>chisel</b> and a <b>whetstone</b>, and shards</td></tr>
    </table>
    <p>A <b>whetstone</b> is chiselled from ${bill('make_whetstone')}, and a <b>needle</b> and an <b>awl</b> are
    carved from bone with a knife, so cloth, leather, wood and stone can all be bettered long before you
    have a forge. A <b>file</b> is poured from its own mould at the smelter and beaten out at an anvil,
    which is what gates metal.</p>
    <p>The skill the work is judged by is the one that would have made the thing &mdash; blacksmithing
    for tools, weaponsmithing for weapons, chain and plate armoursmithing for their armour, bowyery for
    bows, tailoring, leatherworking, carpentry, fine carpentry and stonecutting for the rest &mdash; and
    <b>nothing can be improved past that skill</b>, or past ${IMPROVE_FLOOR} while the skill is lower than that.
    Improving raises the skill as you go, so a long session lifts its own ceiling a little.</p>
    <h3>Ashes, lye and tanning</h3>
    <p>Nothing burns away to nothing. Any fire that has been alight a while &mdash; a <b>campfire</b>, a
    <b>smelter</b> or a <b>kiln</b> &mdash; leaves <b>ashes</b> under it, one lot for every
    ${spanWords(1 / ASH_RATE)} it burns, and you can <b>Take ashes</b> from it whether it is lit or cold. They pile up
    while you work, so a smelter you have been running all morning is worth raking out.</p>
    <p>A <b>bucket</b> is ${bill('make_bucket')} with a mallet. Stand at any shore and <b>Fill</b>
    it; on dry land it will not fill. ${capital(numberWord(need('make_lye', 'ash')))} lots of ashes leached into a bucket of water make a
    <b>bucket of lye</b> &mdash; that is the <b>Alchemy</b> skill. Lye is sharp stuff and one bucket does
    one skin. <b>Empty</b> a bucket at any time to get the plain bucket back.</p>
    <p><b>Tanning</b> is leatherworking: a raw <b>hide</b>, a bucket of lye and a carving knife. The lye
    takes the hair off, you work the skin soft, and it comes out as <b>leather</b> with the bucket
    empty in your hand again. Leather is what every leather thing is cut from &mdash; cap, jerkin,
    sleeves, trousers and boots &mdash; and what an awl and needle work into a leather piece when you
    improve it. Fail the tanning and the hide is left too long and spoils, so tan where your skill can
    manage it.</p>
    <h3>Reeds, papyrus and books</h3>
    <p>The <b>reed beds</b> along the shallows are worth cutting. Take a knife to one and you get
    reeds; cut it again too soon and there is nothing left to take. ${capital(countOf('reed', need('make_papyrus', 'reed')))} soaked in a bucket of
    water, split, laid crosswise and pressed give ${numberWord(made('make_papyrus'))} sheets of <b>papyrus</b>, which is the
    <b>Papyrusmaking</b> skill.</p>
    <p><b>Ink</b> is the alchemist's part: a gland &mdash; the rare thing off a carcass &mdash; ground with
    ${numberWord(need('make_ink', 'ash'))} lots of ashes into a bucket of water, for ${numberWord(made('make_ink'))} lots of ink.
    ${capital(numberWord(need('make_book', 'papyrus')))} sheets, ${numberWord(need('make_book', 'leather'))} leather boards, a lot of ink and a needle bind into a <b>book</b>.</p>
    <p>Right-click a book and <b>Study</b> it. Each go takes ${spanWords(goSeconds(STUDY_TIME))}, raises <b>mind logic</b>, which is
    what decides how many jobs you can keep in your head at once, and wears the pages a little. Held in
    one hand it is hard going; at a <b>lectern</b> you get ${times(LECTERN_GAIN)} as much out of the same go.</p>
    <p>An Artisan who has learned it writes a <b>trade book</b> (${bill(`write_trade_book_${TRADE_BOOK_SKILLS[0]}`)}, with a needle) on any
    craft trade they have ${TRADE_BOOK_AT} of, and studying it raises that trade where a plain book raises mind logic, as much a go.
    Anybody may read one. A book an Artisan binds may teach more from a go or wear less for their perks, and its examine line says by how much.</p>
    <h3>Titles and knacks</h3>
    <p>A long climb leaves titles and knacks behind it, and neither is asked for. Every trade hands out a
    <b>title</b> at ${listed(TITLE_STEPS.map(String))} &mdash; ${titlesFor('carpentry').map((t) => t.name).join(', ')}
    &mdash; and you wear <b>one at a time</b>, chosen in the Skills window (<kbd>K</kbd>) and shown
    beside your position. Click the one you are wearing to take it off again.</p>
    <p>A <b>knack</b> comes of the work itself: <b>one go in ${numberWord(KNACK_ODDS)}</b>, at any trade and at any
    level, leaves one behind. It lands on the trade you were working ${share(KNACK_HOME)} of the time, and
    otherwise on one of the trades beside it &mdash; a long day of carpentry may leave you better at
    bowyery, because it is the same hands and the same wood. A knack is worth ${share(KNACK_BONUS)} more on
    everything that trade teaches you from then on, it never wears off, and a trade holds
    <b>${numberWord(KNACK_CAP)}</b> of them: ${times(1 + KNACK_CAP * KNACK_BONUS)} on every gain, for good. They stack with a night's rest
    and with what you have eaten, and the Skills window shows how many each trade has.</p>
    <p>Because it is luck rather than levels, a knack can land at any moment and the well never runs
    dry: the last hour at a trade is as likely to leave one as the first. Nothing is owed to
    you at a round number, and nothing stops coming once the early levels are behind you.</p>
    <p>A cooked dish leaves a knack too, and a stronger one &mdash; ${times(1 + BOON_BONUS)} rather than
    ${share(KNACK_BONUS)} more &mdash; but it wears off, in ${spanWords(DISH_SHORTEST)} to ${spanWords(DISH_LONGEST)}. One is earned and kept;
    the other is eaten and spent. They stack, as does a night's rest.</p>
    <h3>Dye</h3>
    <p>Everything made here comes out the colour of what it was made from: cloth the grey-white of the
    wool, leather the brown of the hide. A <b>dye</b> changes that, and it is the first thing in the
    game that is yours rather than the island's.</p>
    <p>A dye is boiled out of something that grows with a bucket of <b>lye</b> to bite the colour in and
    hold it &mdash; without the lye it washes straight out. ${NumberWord(DYES.length)} of them, easiest first:
    ${listed(DYES_EASIEST.map((d) => `<b>${d.name.toLowerCase()}</b> (${d.word}, from ${countOf(d.from, d.count)}, alchemy ${d.difficulty})`))}.
    One boil gives ${numberWord(made(`make_${DYES[0].id}`))} pots and hands the bucket back.</p>
    <p>One pot colours one thing. Cloth and leather take dye and metal does not, so that is cloth and
    leather armour, cloth itself, sacks, satchels, backpacks, a saddle, a bridle, a <b>banner</b>, a
    <b>flagpole</b>'s flag and a <b>sailing boat</b>'s sail. A dyed chest or leg piece is worn where it shows: your own figure walks
    about in it. A banner is cloth on a staff &mdash; ${bill('make_banner')} &mdash; planted
    anywhere, and it flies whatever colour you dyed it. Boil it out again in lye if you change your
    mind.</p>
    <h3>Rope</h3>
    <p>Wemp is grown in a field and cut for <b>fibre</b>, and the fibre is spun or laid up. Spun on a spindle it
    is coarse yarn; laid up on a <b>rope tool</b> (${bill('make_rope_tool')}, carved) it is <b>rope</b> &mdash;
    ${numberWord(need('make_rope', 'wemp'))} fibres to a rope, on the <b>ropemaking</b> skill. ${capital(countOf('rope', need('make_thick_rope', 'rope')))} laid up again make a <b>thick
    rope</b>, which is the hawser everything heavy hangs on.</p>
    <p>Rope is not decoration. A <b>bridle</b> takes ${numberWord(need('make_bridle', 'rope'))} for the reins, a <b>rowing boat</b>
    ${numberWord(need('make_rowing_boat', 'rope'))}, a <b>sailing boat</b> ${numberWord(need('make_sailing_boat', 'rope'))} and ${numberWord(need('make_sailing_boat', 'thick_rope'))} hawsers for her standing
    rigging, and a <b>well</b> ${countOf('thick_rope', need('make_well', 'thick_rope'))} to hang the bucket down the shaft. Keep a field of
    wemp if you mean to build anything that floats.</p>
    <h3>Wool, cloth and the loom</h3>
    <p>Fibre becomes cloth at a spindle and then at a loom, and each is its own furniture. Build a <b>spindle</b> and a
    <b>loom</b> with fine carpentry, then stand at the spindle to spin wool, cotton or wemp into
    <b>yarn</b>, and at the loom to weave ${numberWord(need('weave_cloth', 'yarn'))} yarn into a length of <b>cloth</b>. Cloth stuffs a
    mattress, sews into clothing, and twisted into a <b>bowstring</b> it is the start of every bow.</p>
    <h3>Armour</h3>
    <p>Armour is worn a piece at a time in ${numberWord(ARMOUR_SLOTS.length)} places &mdash; ${listed(ARMOUR_SLOTS)} &mdash;
    and only counts where the blow actually lands. Right-click anything wearable and choose
    <b>Wear or wield</b>; the inventory marks what is on you.</p>
    <p>There are ${numberWord(MADE_ARMOUR.length)} kinds anybody can make, each with a skill of its own that rises <b>by being
    hit in it</b>, and each turns aside a share of a blow before its quality, its metal and that skill:
    <b>cloth</b>, sewn by tailoring, ${percent(ARMOUR_CLASSES.cloth.soak)}; <b>leather</b>, cut from tanned hide with a knife
    by leatherworking, ${percent(ARMOUR_CLASSES.leather.soak)}; <b>chain</b>, poured from moulds and riveted up at an anvil by
    chain armoursmithing, ${percent(ARMOUR_CLASSES.chain.soak)}; and <b>plate</b>, beaten out whole by plate armoursmithing,
    ${percent(ARMOUR_CLASSES.plate.soak)}. Quality and the skill behind it raise all of those, and damage lowers them: armour
    wears where it is struck, and a piece beaten to nothing falls off you. Weight is the price &mdash; a full
    suit of iron plate slows you by ${percent(PLATE_SUIT / (1 + PLATE_SUIT))} and makes every action cost ${percent(PLATE_SUIT)} more
    wind, where cloth costs ${percent(ARMOUR_CLASSES.cloth.burden)}.</p>
    <p>A <b>shield</b> in the off hand is different: it does not soften a blow, it stops the whole of
    one outright, and the shields skill and its quality decide how often. A weapon that takes both
    hands leaves none for one.</p>
    <h3>Weapons and the bow</h3>
    <p>A <b>left click</b> on anything wild that is after you, or of a kind that hunts on sight, fights it:
    you go to it and swing, or shoot with a bow in hand, and when it steps out of reach you go after it,
    up to ${numberWord(FOLLOW_RANGE)} tiles. <b>${keyName(BIND_BY_ID.get('fight_mark')?.keys[0] ?? '')}</b> marks the nearest such thing
    within ${numberWord(TARGET_RANGE)} tiles, and the next nearest at each press after; <b>${keyName(BIND_BY_ID.get('fight')?.keys[0] ?? '')}</b>
    attacks what you marked or last clicked. A fight never waits behind work: whatever was in hand goes
    to the front of the line and is picked up after. Clicking the ground walks you out of a fight, and
    nothing turns you back into it.</p>
    <p>What you strike that does not run <b>fights back on its own clock</b>, whether you are swinging or
    not: a hunter or a monster every ${BLOW_HUNTER} seconds, a kind that stands up for itself every
    ${BLOW_DEFENSIVE}, anything else every ${BLOW_PREY}. It comes after you up to ${numberWord(FIGHT_LEASH)} tiles from where
    it was struck and lets you go once you are ${numberWord(FIGHT_GIVE_UP)} tiles off.</p>
    <p>When something bites you and your feet have been still for ${FIGHT_BACK_STILL} seconds, you <b>turn on it</b>:
    whatever you were doing goes to the front of the line and is picked up again after, and you keep
    swinging until it is dead, gone or out of reach. A bite while you walk never turns you round, a swing
    you were already aiming at it is left alone, and nothing tame counts. Settings, Fighting turns it off.</p>
    <p>Your <b>stance</b> is on the button beside your health bar; click it or press
    <b>${keyName(BIND_BY_ID.get('fight_stance')?.keys[0] ?? '')}</b> for the next. ${FIGHT_STANCES.map((st) => `<b>${FIGHT_STANCE_NAMES[st]}</b>: ${stanceSays(st)}`).join(' ')}</p>
    <p>A swing takes its weapon's own time before skill: ${listed([...WEAPONS].filter((w) => !w.ammo).sort((a, b) => a.swing - b.swing).map((w) => `${itemDef(w.id).name.toLowerCase()} ${w.swing}`))}
    seconds, and bare hands ${FIST.swing}. A bow's draw is its own the same way. Every swing or draw costs
    ${percent(SWING_WIND)} of your stamina and ${percent(SWING_WIND_KG)} more for every kilogram in your hand, before body stamina
    and armour have their say; below ${percent(TIRED_AT)} stamina every swing is slower, up to ${percent(TIRED_SLOW)} slower with none left.</p>
    <p>${capital(listed(Object.values(SPECIES).filter((d) => d.heavy).map((d) => `${d.name.toLowerCase()}s`)))} <b>draw back for a heavy blow</b>
    every ${numberWord(HEAVY_EVERY)} blows: a red ring on the ground shows its reach for ${WIND_UP} second, and the blow lands
    ${times(HEAVY_HIT)} as hard on anything still inside it. Step out of the ring and it falls short.</p>
    <p>Every blow is a <b>cut</b>, a <b>puncture</b> or a <b>crush</b>: ${blowSays('cut')} cut, ${blowSays('pierce')} go in,
    ${blowSays('crush')} crush. A hide makes more or less of each: ${HIDES.map((h) => `a ${HIDE_NAMES[h].toLowerCase()} (${listed(Object.values(SPECIES).filter((d) => d.hide === h).map((d) => d.name.toLowerCase()))}) ${hideSays(h)}`).join('; ')}.
    Armour turns each kind differently too: ${(Object.keys(ARMOUR_CLASSES) as ArmourClass[]).map((c) => `${ARMOUR_CLASSES[c].name.toLowerCase()} ${armourSays(c)}`).join('; ')}.</p>
    <p>What a weapon does besides its damage, when it lands: ${listed(['mauls', 'polearms', 'knives'].map((k) => { const w = WEAPONS.find((x) => x.kind === k); return w ? `${k === 'polearms' ? 'a spear' : k === 'mauls' ? 'a maul' : 'a knife'} ${sideOf(w)}` : ''; }).filter(Boolean))}.
    Bleeding never takes the last of it: what finishes a thing is a blow.</p>
    <p>A <b>wound</b> to an arm or a hand slows every swing by ${times(ARM_SLOW)} the share of your health it took, up to
    ${percent(ARM_SLOW_MOST)} slower; to a leg or a foot, your walking the same way, up to ${percent(LEG_SLOW_MOST)} slower.
    A blow from something on you that is <b>not what you are fighting</b> lands ${percent(FLANK_HIT - 1)} harder: it is at your back.
    Every other thing on you takes ${percent(CROWD_BLOCK)} off your shield's chance of a block, and your own blow at something
    fighting somebody else lands ${percent(BLINDSIDE - 1)} harder.</p>
    <p>In a fight, the panel at the top of the screen shows what you are fighting or have marked: its health, what it is
    about this moment, and what its hide makes of the blow in your hand. A bar over everything after you shows its health,
    a ring at your feet fills as your swing or draw comes, an arrow at the edge of the view points at anything after you
    that is out of it, and the edge of the view reddens when you are struck. With the cursor on a hunter not yet after
    you, a dashed ring shows how far off it will notice you: ${HUNT_SIGHT} tiles, or for ${listed(Object.values(SPECIES).filter((d) => d.hunter && d.notice !== undefined).map((d) => `${d.name.toLowerCase()}s ${d.notice}`))}.
    With <b>One line for a whole fight</b> on in Settings, what you learn in a fight is said once, ${FIGHT_QUIET} seconds
    after its last blow, with how long it lasted, what you dealt and what you took.</p>
    <p>${capital(listed(Object.values(SPECIES).filter((d) => d.pack).map((d) => `${d.name.toLowerCase()}s`)))} <b>run in packs</b>. One that comes
    into the world near another of its kind shares that one's home, up to ${numberWord(PACK_MOST)} to a home, and keeps within
    ${numberWord(PACK_RANGE)} tiles of it. When one of them has your scent, every other of its kind within ${numberWord(PACK_CALL)} tiles
    comes too, and the first leads them. A pack <b>spreads round you</b>: each makes for its own side of you, an even share of
    the circle round from the one leading, going round ${CIRCLE_R} tiles out until it is within ${Math.round((CIRCLE_ARC * 180) / Math.PI)} degrees
    of its side, and then comes in, and every one on you but the one you are fighting lands ${percent(FLANK_HIT - 1)} harder.</p>
    <p>${capital(listed(Object.values(SPECIES).filter((d) => d.throws).map((d) => `${d.name.toLowerCase()}s`)))} <b>keep their distance</b>: they stand
    off ${KEEP_OFF} tiles and throw from up to ${THROW_REACH}, each throw ${percent(THROW_HIT)} of a blow, and a crush. Closer than
    ${KEEP_OFF - BACK_SLACK} tiles they back away at ${percent(BACK_PACE)} of their walk, and fight hand to hand only with nowhere to back to.</p>
    <p>A hunter <b>turns tail</b> below ${percent(HUNTER_TURN)} of its health and a monster below ${percent(MONSTER_TURN)};
    ${listed(Object.values(SPECIES).filter((d) => d.coward).map((d) => `${d.name.toLowerCase()}s`))} below ${percent(COWARD_AT)}, or below ${percent(COWARD_DRAG)}
    once another of their kind within ${numberWord(PACK_CALL)} tiles has run. One that turns tail runs from you for ${FLEE_SECS} seconds and
    takes no interest in you for ${Math.round(HUNT_REST)} seconds, and when the one leading a pack dies or runs, the whole pack runs.</p>
    <p>Your <b>companion</b> takes orders from wherever you stand. <b>Attack my target</b> on its menu, <b>Set</b> <i>its name</i> <b>on it</b>
    on a wild one's menu, or <b>${keyName(BIND_BY_ID.get('pet_attack')?.keys[0] ?? '')}</b> sends it at what you are fighting or have marked, or else the
    nearest foe, whatever its stance. <b>Fall back</b>, or <b>${keyName(BIND_BY_ID.get('pet_back')?.keys[0] ?? '')}</b>, calls it out of its
    fight to your side, and it starts no fight for ${FALL_BACK} seconds. The <b>Guarding you</b> stance sends it at anything hunting
    you within ${COMPANION_SIGHT} tiles before it lands a blow, as well as at what strikes it or you, and gives up a fight
    ${GUARD_RANGE} tiles from you rather than ${COMPANION_LEASH}. A dashed blue line runs from it to what it is fighting.</p>
    <p>A <b>bow is drawn on the move</b>: walking while you draw keeps the draw going, at ${percent(DRAW_WALK)} of your pace, and it
    looses when the draw is full; it keeps loosing while the target is within the bow's range and you have arrows. A line from you
    to the target fills as the draw comes, amber while the target is in range and grey once it is not.</p>
    <p>Every blow a creature lands on you is first rolled against your <b>dodge</b>: ${finePercent(DODGE_PER_CONTROL)} for every
    point of body control past the ${DODGE_FROM} everyone starts with, so ${percent(dodgeChance(TOP_SKILL, 0))} at ${numberWord(TOP_SKILL)}, less
    ${finePercent(DODGE_PER_KG)} for every kilogram of armour you wear. A dodged blow takes nothing, and every dodge trains body control.</p>
    <p>A blow or a shot that lands is <b>critical</b> ${percent(CRIT_BASE)} of the time, and ${finePercent(CRIT_PER_SKILL)} more for every
    point of the weapon's own subskill, so ${percent(CRIT_BASE + TOP_SKILL * CRIT_PER_SKILL)} at ${numberWord(TOP_SKILL)}, ${times(CRIT_KNIFE)} as often with a knife. A critical
    one lands ${percent(CRIT_HIT - 1)} harder, the log says so, and its number rises larger and in orange.</p>
    <p>${capital(listed(Object.values(SPECIES).filter((d) => d.venom).map((d) => `${d.name.toLowerCase()}s`)))} carry <b>venom</b>: the wound
    their bite opens takes ${percent(VENOM_DRAIN)} of your health a second for ${VENOM_SECS} seconds, and nothing while it is dressed.
    A <b>burn</b>, from ${listed(BURNERS.map((s) => `the ${s.name.toLowerCase()}`))}, wears the armour it lands on ${times(BURN_WEAR)} as fast as any other blow.</p>
    <p>A creature fights <b>what hurt it last</b>. When your companion strikes something that is on you, it turns on your companion
    once you have not hurt it for ${THREAT_HOLD} seconds, and the log says so; a companion in the <b>Guarding you</b> stance takes it at once.
    It stays on your companion until your companion has not hurt it for ${THREAT_HOLD} seconds, and then your next blow takes it back.
    While it fights your companion it strikes at your companion on its own clock and does not count among those on you.</p>
    <p><b>Examine</b> on a wild creature, and the target panel while one is marked, <b>consider</b> it: about how many of your blows
    would down it and how many of its would down you, from what is in your hand, your skill and stance, the arrows you would
    loose, its hide, and your dodge, shield and armour. It reads <b>Easy</b> when it would take it at least ${times(CONSIDER_EASY)} as
    long to down you as it would take you to down it, counting how often each of you strikes and how often you land,
    <b>Hard</b> when less than ${percent(CONSIDER_HARD)} as long, and <b>Even</b> between.</p>
    <p>Every weapon belongs to a kind, and each kind is its own subskill: ${listed(WEAPON_KINDS.map((k) => `<b>${k}</b>`))}.
    Swinging trains the weapon's own subskill and the <b>fighting</b> skill behind it, and both decide
    whether a blow lands and how hard. A weapon's own numbers matter as much: a hunting knife is quick
    and light, a maul or a battle axe is slow and ends things, a spear reaches further than anything
    else held in the hand, and the ones that take both hands take the shield off your arm.</p>
    <p>Heads are poured from <b>moulds</b> at the smelter, beaten true at an anvil and fitted to shafts: short and long sword blades,
    axe and maul heads, spear heads, and a gang mould that turns one lump of metal into
    ${numberWord(MOULDS.find((m) => m.id === 'arrow_head_mould')?.per ?? 0)} <b>arrow heads</b>. A club is simply carved from a log, which is what most people start with.</p>
    <p>Bows are tillered with <b>bowyery</b> from shafts and a bowstring, in ${numberWord(WOOD_BOWS.length)} sizes:
    ${listed(WOOD_BOWS.map((w, i) => `a <b>${itemDef(w.id).name.toLowerCase()}</b> ${i === 0 ? 'reaches ' : ''}${numberWord(w.range ?? 0)}${i === 0 ? ' tiles' : ''}`))},
    each slower to draw and heavier in the hit than the last. Arrows are made with <b>fletching</b> from
    ${bill('make_arrows')}, ${numberWord(made('make_arrows'))} to a go &mdash; and feathers come only off a bird:
    ${listed(FEATHERED.map((s) => `the ${s.name}`))}. With a bow in hand, <b>Shoot</b> appears on any wild creature
    in range; the far end of the range is a far harder shot than the near end, and every shot spends an
    arrow.</p>
    <p>${NumberWord(ARROW_IDS.length - 1)} other heads are fletched the same way. <b>Broadhead arrows</b>, from ${bill('make_broadhead_arrows')}, bleed what they
    land on as a knife does: ${percent(KNIFE_BLEED)} of the shot a second for ${KNIFE_BLEED_SECS} seconds. <b>Bodkin arrows</b>, from
    ${bill('make_bodkin_arrows')}, land ${percent(BODKIN_HIDE - 1)} harder on anything with a hide (${listed(HIDES.map((h) => HIDE_NAMES[h].toLowerCase()))}).
    <b>Blunt arrows</b>, from ${bill('make_blunt_arrows')}, crush rather than pierce, and as a maul does they knock a heavy blow off its
    stroke and put the next blow back ${STAGGER_MAUL} second${STAGGER_MAUL === 1 ? '' : 's'}. <b>Shoot these first</b> on a stack of arrows in your pack
    picks the kind a shot takes; when those run out it takes plain arrows, and then whatever arrows are left.</p>
    <h3>Stonecutting</h3>
    <p><b>Stonecutting</b> is the skill that turns what a pickaxe brings out of the rock into something
    square. With a chisel, rock, slate, marble and sandstone shards become <b>bricks</b> &mdash; what
    walls, smelters and kilns are built from &mdash; or, ${numberWord(need('make_stone_slab', 'rock_shards'))} shards at a time, a <b>slab</b>. Slabs are
    not for building: they are paving. Choose <b>Pave (slabs)</b> on any tile with a trowel in hand and
    the slab goes down as a floor of that stone, and each of the ${numberWord(SLAB_VARIANTS.length)} looks quite different from the
    others. Breaking paving up with a pickaxe usually lifts a slab out whole. Masonry still lays the
    stone; stonecutting is what cuts it.</p>
    <h3>Pottery and the kiln</h3>
    <p>Clay is dug from a clay pit with a shovel, and everything made of it is shaped cold and soft.
    <b>Pottery</b> shapes clay into <b>unfired</b> bricks, bowls, pots and jars, and green ware is no use
    to anybody: it will not hold a stew and it will not hold up a wall. Build a <b>kiln</b> from
    ${bill('make_kiln')} with a trowel, carry it, and set it down anywhere the ground is dry and
    flat; take it up again when it is cold and empty. Feed it anything a fire takes, peat and coal
    included, pack the green ware in, and light it: each piece needs its own time at heat, and a
    well-built kiln works faster and keeps more of the potter's quality. Take the fired ware out and the
    bowl will cook, the pot makes pottage, the jar puts up preserves, and the brick will build.</p>
    <p>An Artisan who has learned them shapes an <b>amphora</b> (${bill('make_amphora')}), fired like any pot, which holds
    ${itemDef('amphora').holds} of one food or drink at a time, and what is in it rots at ${share(itemDef('amphora').shelter ?? 1)} the rate if it is
    left lying about. They build a <b>potter's wheel</b> (${bill('make_potters_wheel')}), and anybody shaping clay within
    ${furnitureDef('potters_wheel').pace?.reach} tiles of one takes ${percent(1 - (furnitureDef('potters_wheel').pace?.by ?? 1))} less time a go.
    And they <b>glaze</b> a fired pot, bowl or jar, or an amphora, with ${numberWord(GLAZE_ASH)} lot of ashes, and it never decays after.</p>
    <h3>Stones and jewels</h3>
    <p>One go in ${numberWord(Math.round(1 / GEM_ODDS))} at the rock turns up a <b>gem</b>, and each favours one trade:
    ${listed(GEMS.filter((g) => !g.perk).map((g) => `${article(g.name)} ${g.name.toLowerCase()} ${tradeName(g.skill)}`))}. A jeweller sets one with a
    file, on <b>jewellery</b>, in a <b>ring</b> or a <b>pendant</b>, and worn in the jewel slot it gives ${percent(JEWEL_BONUS)} more skill from every
    go at its trade; or in silver as a <b>focus</b>, which a spell is cast from. The crafting window lists each of them under Jewellery.</p>
    <p>An Artisan who has learned it draws a gold <b>circlet</b> (${bill('make_circlet')}, with a file), worn on the head in place of a helm.
    Anybody sets its ${numberWord(CIRCLET_STONES)} stones, one at a time, with <b>Set in the circlet</b> on the stone, and each gives
    ${share(CIRCLET_SHARE)} what it would in a ring. The rock gives an Artisan with More Stones ${numberWord(GEMS.filter((g) => g.perk).length)} more:
    ${listed(GEMS.filter((g) => g.perk).map((g) => `${article(g.name)} ${g.name.toLowerCase()} ${tradeName(g.skill)}`))}.</p>
    <h3>Digging up the past</h3>
    <p>People lived here before you did and left their things in the ground. Right-click any soil or
    sand and choose <b>Investigate</b>: with a <b>trowel</b> and the <b>Archaeology</b> skill you go
    through the topsoil carefully, and now and then it gives up a <b>fragment</b> of something old.
    Ground you have been over is no good again for a while, so keep walking.</p>
    <p>Nothing comes out of the ground whole or sound. A fragment names what it is a piece of and which
    piece it is &mdash; <i>${LAST_RELIC.name} ${LAST_RELIC.parts - 1}/${LAST_RELIC.parts}</i> &mdash; and comes up with ${FIND_DAMAGE} to
    ${FIND_DAMAGE + FIND_DAMAGE_SPREAD} damage. <b>Nothing repairs a fragment or a tarnished bauble until it is restored</b>: not
    Repair, not a repair kit, not Mend, not a worker mending the stores. Its damage only goes up, from a restoring that
    fails and from lying out in the weather, and one that reaches ${DAMAGE_MAX} before it is restored breaks and is gone.
    Restored, it is a thing like any other and mends like one. There are ${numberWord(RELICS.length)} things under the island, from ${article(RELICS[0].name)} <b>${RELICS[0].name}</b> in
    ${numberWord(RELICS[0].parts)} pieces to ${article(LAST_RELIC.name)} <b>${LAST_RELIC.name}</b> in ${numberWord(LAST_RELIC.parts)}, and a relic is only recognised once your archaeology has
    come far enough to know what it is looking at. The commonplace turns up far more often than the
    rare, and the ground is kind enough to favour a piece you are still short of.</p>
    <p>With every piece in hand, right-click one and choose <b>Restore</b>. That is the
    <b>Restoration</b> skill, at any damage short of breaking: a success puts the thing back together, and a failure
    puts ${RESTORE_HARM} to ${RESTORE_HARM + RESTORE_HARM_SPREAD} more damage on every piece. What comes out is only as good as the pieces that went in,
    less ${percent(1 / RESTORE_AGE)} of it for each point of damage on them. Some of it is
    treasure and nothing more &mdash; a statuette, a bronze mirror, a bone comb, an old lamp &mdash;
    and some of it is an <b>old file</b>, an <b>old blade</b> or an <b>ancient helm</b>, which are the
    real prize: a file before you have a forge to cast one in.</p>
    <h3>Baubles</h3>
    <p>${capital(percent(BAUBLE_SHARE))} of what a trowel turns up is not a fragment but a <b>tarnished bauble</b>, whole in one
    piece: ${listed(BAUBLE_TIERS.map((t) => `${percent(t.odds)} of them ${t.name.toLowerCase()}`))}. Tarnished, it gives nothing. <b>Restore</b> it on
    its own, on restoration, at difficulty ${listed(BAUBLE_TIERS.map((t) => `${t.difficulty} for ${article(t.name.toLowerCase())} ${t.name.toLowerCase()} one`))}; a failure
    damages it, as it does a relic's pieces. What it gives is rolled when it comes clean, with its rarity, and
    written on it: a rare bauble gives ${times(baubleTimes(1))} what an ordinary one rolls, a supreme ${times(baubleTimes(2))} and a
    fantastic ${times(baubleTimes(3))}. Another ${percent(REGRET_SHARE)} is a <b>Bauble of Regret</b>, whole, which undoes one
    of your trades: see <b>Trades</b>.</p>
    <table>
      ${BAUBLE_TIERS.map((t) => `<tr><td><b>${t.name}</b></td><td>${NumberWord(t.slots)} sockets. ${
        t.id === 'minor' ? `${BAUBLE_LOW} to ${BAUBLE_HIGH}% less time per action, or ${BAUBLE_LOW} to ${BAUBLE_HIGH}% more skill gained, in one of the ${numberWord(MINOR_SKILLS.length)} skills an action is done with.`
        : t.id === 'major' ? `A ${BAUBLE_LOW} to ${BAUBLE_HIGH}% chance of ${times(YIELD_TIMES)} the yield of each action in one of ${numberWord(MAJOR_SKILLS.length)} skills: every skill the crafting window makes things with, and ${listed(MAJOR_SKILLS.filter((k) => !RECIPES.some((r) => r.skill === k)).map((k) => SKILL_BY_ID.get(k)?.name.toLowerCase() ?? k))}.`
        : `One of: ${listed(ANCIENT_EFFECTS.map((e) => `+${ANCIENT_PLUS} ${e.said}`))}.`}</td></tr>`).join('\n      ')}
    </table>
    <p>Set one at the altar of a settlement of yours: <b>Baubles</b> on the altar's menu. Its ${numberWord(BAUBLE_TIERS.reduce((n, t) => n + t.slots, 0))} sockets
    are the settlement's rather than the stone's &mdash; pick the altar up and set it down again and they are
    still filled &mdash; and its founder, a mayor or a builder may set a bauble into an empty one. Only the founder or a mayor may set one in place
    of another, and the one it replaces is destroyed; nothing set can be taken out again. What is set works
    for the settlement's citizens &mdash; its founder, mayors and builders, not its guests &mdash; on every action
    they do standing on its land. The same kind for the same skill adds up, to at most ${percent(BAUBLE_KINDS.time.cap / 100)} less time,
    ${times(1 + BAUBLE_KINDS.learn.cap / 100)} the skill gain, and a ${percent(BAUBLE_KINDS.double.cap / 100)} chance of ${times(YIELD_TIMES)} the yield, which a go gets
    all of or none of. The Settlement window adds up what yours give.</p>
    <h3>Wildermon</h3>
    <p>Wild creatures roam the island. The <b>Rabba</b> is a rabbit-like grazer that forages berries when
    hungry; the <b>Vola</b> is a mole-like digger that botanizes herbs and roots instead; the
    <b>Bevere</b> is a flat-tailed gnawer that never settles far from water, eats vegetables and
    starchy things, is placid by nature, and fells trees for its deed, carrying the logs to the crate;
    the <b>Seavic</b> is a squirrel that lives among the trees, eats acorns and nuts, is placid too, and
    runs a farm for its deed &mdash; sowing seed from the crate, tending every stage and carrying the
    harvest back. Seed it has no field to put in goes back to the stores with everything else, so what
    it reaps is on a shelf where you can count it rather than in its cheeks. It cannot rake a field of
    its own, so it only works ground you have tilled. The
    <b>Mola</b> is a heavier mole built around its claws, found sitting on metal, living on spices, and
    working the seams for its deed: it takes the nearest ore no other Mola has claimed, and the quality
    of what it brings back is its own mining skill, up to whatever the seam holds, and it leaves alone
    any metal beyond its skill &mdash; so a fresh one takes copper and coal, and starts on iron the day
    its mining reaches ${METAL_LEVEL('iron')}. It works <b>${numberWord(MINE_DEPTH)} units of water</b> deep, the same as you do, and a face it
    cannot stand on it works from the bank beside it: a shore seam is a Mola's to cut, and so is a
    seabed under wading depth. The same goes for a <b>Quarra</b> and plain rock. Its range grows by
    ${SPECIES.mola.rangePerStep ?? RANGE_PER_STEP} tiles every ${SKILL_STEP} levels rather than the usual ${RANGE_PER_STEP}. The <b>Crawler</b> is a broad crab that lives on the
    sand, eats vegetables, and digs sand for its deed &mdash; a clawful at a time, taken from the highest
    corner of the tile and carried to the crate, which is where the sand for mortar and moulds comes from
    once nobody wants to dig it themselves. It is the first of the defensive sort: strike one and it
    comes straight back at you every time, and even a tamed one is never quite tamed, so now and again it
    will round on whoever is standing next to it. A helm turns the worst of that aside. Each of them picks
    that spot clean for a while, exactly as you would. The <b>Quarra</b> is a slab of a creature with a
    jaw made for stone: it sits on bare rock, eats clay, and cuts rock, slate, marble and sandstone into
    shards for the deed, which is what keeps a mason in brick. The <b>Embra</b> sleeps in the peat and
    tar of the marshes, eats nothing that has not been cooked, and keeps every fire, smelter and kiln on
    the deed fed and lit from the crate &mdash; the one chore you otherwise have to come home for. The
    <b>Magga</b> is a magpie that clears a settlement of everything dropped and forgotten and puts it in
    the crate; wild ones do the reverse, so do not leave anything lying about near their trees. The
    <b>Woola</b> is a mild grazer that does no work at all: it grows a fleece, and once it has grown you
    <b>shear</b> it with a knife for <b>wool</b>, which grows back in ${spanWords(1 / (SPECIES.woola.fleece ?? 1))}. The
    <b>Ulva</b> is the first thing on this island that will come at you unprovoked: it hunts by scent
    from ${numberWord(SPECIES.ulva.notice ?? HUNT_SIGHT)} tiles off and does not stop until you are well away or it is badly hurt. It takes taming
    ${SPECIES.ulva.tameLevel} to try, and a tamed one keeps watch over the deed, going for anything wild that crosses the
    border. The
    <b>Roxxen</b> is a slab-shouldered ox that will not start anything and will finish most things that
    start with it. It does no job on a deed; it is there to be hitched, and what it learns in the traces
    (its <b>climbing</b>) decides how fast a cart or wagon goes and how steep a line the wheels will
    take. A green pair labours over ground a worked pair walks up. It also leaves the biggest carcass on
    the island by a long way. The <b>Orse</b> is long in the leg and learns the same skill, in the traces
    or under a rider: stitch a <b>saddle</b> and a <b>bridle</b>, fit both from its menu, and
    <b>mount</b> it. A green one carries you at ${times(ORSE_GREEN / BASE_SPEED)} your own pace and over the same ground;
    one whose climbing is worked right up is ${times(ORSE_WORKED / ORSE_GREEN)} as fast as a green one and goes up slopes you would
    have to walk round. Tack a Tailor with Saddler stitched lets a mount go ${percent((tailor('Saddler')['speed:saddle'] ?? 1) - 1)} faster,
    past the ${MAX_MOUNT_SPEED} tiles a second a mount is otherwise held to, and yokes of theirs do the same for the cart or
    wagon built on them. The
    <b>Rowl</b> hunts on sight in the wild &mdash; taming ${SPECIES.rowl.tameLevel}, and even then it is unruly &mdash; and
    tamed on a deed it hunts <b>for</b> you: it works a circuit of the token, runs down anything wild
    inside it, and carries the carcasses back to storage for butchering. Its <b>fighting</b> skill is
    both its bite and its beat: it hits ${times(trainedHit(TOP_SKILL))} as hard at mastery, and its circuit grows from
    ${numberWord(SPECIES.rowl.workRange)} tiles to ${numberWord(SPECIES.rowl.workRange + rangeSteps(TOP_SKILL) * (SPECIES.rowl.rangePerStep ?? RANGE_PER_STEP))}. The <b>Noot</b> is a plump upright waddler that
    lives beside the clay pits, eats root vegetables, and digs <b>clay</b> with its bill for its deed,
    carrying it to the crate a load at a time &mdash; which is what keeps a potter in clay without
    walking the shore for it. Carry what the creature eats (a berry or vegetable for
    a Rabba, a spice or vegetable for a Vola), long-press or right-click one and choose <b>Tame</b>: the
    food is used up, success is uncommon at low taming skill, and none of them holds a failed attempt
    against you.</p>
    <p><b>Keep at it.</b> A wild thing that has taken food from your hand and refused you is a little
    readier for the next offering: <b>${percent(COAX_STEP)} on the chance</b> for every attempt in a row, with no
    ceiling but the one on the whole chance. It is slight per go and it will not make a hard tame easy, but it
    means a long run of refusals is going somewhere. The run lapses if you leave it alone for
    ${spanWords(COAX_LAPSE)}, and <b>raising a hand to it ends the run outright</b> &mdash; nothing that has been hit
    takes food from the hand that hit it. Examining a wild one says how far you have got with it.</p>
    <p><b>Age.</b> Everything alive was born at some hour and gets older from there. A <b>young</b> one is
    ${percent(AGES.young.scale)} the size, moves at ${percent(AGES.young.speed)} of the pace, grows no fleece and gives no milk, and is no use in the
    traces or under a saddle &mdash; but it has not learned to mistrust you, so it is ${times(AGES.young.tame)} as easy
    to tame. It is <b>grown</b> after ${spanWords(YOUNG_FOR)}, and everything in the book describes it then. After
    ${spanWords(OLD_AT)} it is <b>old</b>: ${percent(AGES.old.speed)} of the pace, ${percent(AGES.old.pull)} of the pull in the traces and
    ${percent(AGES.old.growth)} of the pace growing a fleece back, but heavier, and an old carcass is worth ${percent(AGES.old.yield - 1)} more
    than a grown one. The Wildermon window says which
    it is and how long a yearling has left to grow. What was already walking about when the island was
    raised counts as grown.</p>
    <p><b>Putting one down.</b> An animal you keep can be <b>culled</b> from its own menu &mdash; one
    action, wherever it stands, and it leaves the same carcass anything else would. You are asked
    first, and asked harder if its blood is worth keeping, because there is no getting that back.
    <b>Release</b> is the other door out: it walks off into the country with everything it was bred
    for still in it. Neither is open to something in the traces or with you on its back.</p>
    <p><b>The working sorts.</b> More wildermon came out of the same country, and most of them
    are kept for a job. The <b>Bogga</b> wallows in the marshes and cuts <b>peat and tar</b> for the
    deed. The <b>Sedra</b> is a long-necked wader that shears <b>reeds</b> at the water's edge, which is
    where papyrus starts. The <b>Holla</b> carries <b>water</b> in its throat from the shore or a well
    and pours it into your barrels. The <b>Dowse</b> will not live anywhere there is no metal under it,
    and on a deed it <b>reads the ground</b> and marks what is down there. The <b>Sappa</b> buries more
    seed than it eats, and on a deed it <b>plants sprouts</b> where the axe has been. The <b>Cobbe</b>
    carries the <b>hod</b>: brick, mortar and timber out of your stores and into whatever wall you have
    planned, one piece at a time. The <b>Tinka</b> <b>mends</b> the damaged gear in your stores. The
    <b>Middun</b> eats what is rotting on the ground and turns it into <b>compost</b>. The <b>Snout</b>
    smells out <b>buried relics</b> and marks where to dig &mdash; taming ${SPECIES.snout.tameLevel}, and worth every point of
    it.</p>
    <p><b>Backs and traces.</b> The <b>Bura</b> does no work but carries <b>${SPECIES.bura.pannier} things</b> in panniers on
    its own back; open them from its menu. The <b>Gorral</b> is a horned cliff-goat that takes a saddle
    and goes up ground an Orse turns away from. The <b>Wadd</b> is the one mount that will swim deep
    water with a rider on it. The <b>Shaggan</b> is slower in the traces than anything else and stronger
    than all of them: each adds ${percent(SPECIES.shaggan.pull ?? PULL_DEFAULT)} to a team's pull where most beasts add ${percent(PULL_DEFAULT)}.</p>
    <p><b>Eyes and produce.</b> The <b>Warda</b> is a watcher: keep one and it sees ${SPECIES.warda.sight} tiles for you
    wherever it stands. The <b>Quill</b> is a ground-bird you <b>pluck</b> rather than shear, for
    <b>feathers</b>, which is what keeps an archer in arrows. The <b>Cudda</b> is <b>milked</b> into an
    empty bucket, and a bucket of milk presses into ${numberWord(made('make_cheese'))} <b>cheeses</b>. The <b>Vesp</b> is a swarm
    rather than a creature: build a <b>hive</b> (${bill('make_hive', true)}), set it down
    on your deed and keep a tamed Vesp there, and the swarm fills it with <b>honey</b> and
    <b>beeswax</b> &mdash; and ${bill('make_candle')} draw ${numberWord(made('make_candle'))} <b>candles</b>. The
    <b>Lume</b> is only ever out after dark and carries its own light about with it: keep one and it
    lights ${numberWord(SPECIES.lume.glow ?? 0)} tiles round itself however dark it is.</p>
    <p>Right-click any tile of your settlement for the <b>deed menu</b>: it lists the wildermon kept
    there, sets their <b>orders</b>, offers to <b>upgrade</b> the settlement, and renames or disbands it.
    Orders apply to every wildermon on the deed at once and take effect the moment something wild
    crosses the border: <b>aggressive</b> and they break off work and go for it, <b>defensive</b> and
    they only answer what has already struck at them or at you, <b>passive</b> and they carry on working
    whatever walks in. Each upgrade pushes the
    border out ${numberWord(DEED_RADIUS_PER_LEVEL)} tiles and lets ${deedWorkersAt(2) - deedWorkersAt(1) === 1 ? 'one' : numberWord(deedWorkersAt(2) - deedWorkersAt(1))} more wildermon work the deed, and each is earned by building the
    settlement out: ${UPGRADES_SAID}. Upgrades are
    taken in order, so each level only asks for the new thing. The menu ticks off what you have and names what is
    missing, and a settlement goes no higher than level ${MAX_DEED_LEVEL}.</p>
    <p>A deed worker feeds itself: once its belly falls below ${share(HUNGRY)} it goes to whichever crate on
    the deed holds something it eats, helps itself, and goes back to work. Keep food in a crate and your
    workers will look after themselves.</p>
    <p>A deed worker starts within ${numberWord(WORK_RANGES[0])} to ${numberWord(WORK_RANGES[WORK_RANGES.length - 1])} tiles of the token, by its sort, and earns another
    ${RANGE_PER_STEP} tiles of range for every ${SKILL_STEP} levels of its task skill &mdash; ${RANGE_STEPS_SAID} &mdash; so a
    seasoned one works a wide stretch of country. Its card in the Wildermon window shows the range it
    has now and how much skill the next step needs.</p>
    <p>A tamed wildermon either <b>travels with you</b> (one at a time; its stance is Passive, Defensive
    or Aggressive), is <b>assigned to your deed</b>, where a Rabba forages around the settlement and
    drops what it finds in the settlement's storage, or is shut in a <b>creature crate</b>. Feed them
    from your pack; deed workers help themselves from storage.
    The <b>Wildermon</b> window (<kbd>P</kbd>) shows the condition, level and skills of every creature
    you own; wild ones keep theirs to themselves. Deed workers learn from their work, gaining skill at
    half a player's pace and working at half a player's speed, and better skill means better quality
    finds and quicker work.</p>
    <p><b>Creature crates.</b> A creature crate holds <b>one</b> wildermon. A fine carpenter builds it
    with a mallet from ${CRATE_BILL}; it weighs <b>${itemDef(CREATURE_CRATE).weight} kg</b> and does not rot.
    The first wildermon you tame follows you; <b>every one after that goes into an empty crate in your
    pack</b>, and without one you cannot tame it. A catch taken out of a trap is the same. Put the one
    following you, or a deed worker, into an empty crate you carry from its menu. Set a crate down on
    any spot of a tile and the wildermon is drawn inside it with its name over it. Open a crate
    &mdash; standing beside it, or from your pack &mdash; to <b>let it out to follow you</b>, when the
    one following you goes into the crate in its place, or to <b>set it to work the deed</b>, which
    takes one of its working slots. A wildermon in a crate does not get hungry. A young one born while
    something follows you goes into a crate too: see breeding. A crate with a
    wildermon in it can be carried, set down or opened, and <b>nothing else</b>: it cannot be dropped,
    bagged, stored, sold, posted or traded. <b>Take with you</b> on a deed worker, with a companion
    already following you, leaves that companion on the deed in its place, or puts it in an empty
    crate you carry when the deed has no room for it.</p>
    <p>Every tile is a ${SUBTILES} by ${SUBTILES} grid of spots for placing things. Build a <b>log crate</b> from
    ${bill('make_log_crate')} &mdash; notched and lashed, not a nail in it &mdash; or a <b>plank crate</b> from
    ${bill('make_plank_crate')} (with a mallet), then right-click the spot on a tile
    where you want it; it snaps to the grid. They hold ${CRATE_DEFS.log.capacity} and ${CRATE_DEFS.plank.capacity} things, can be opened, emptied and
    picked up again when empty. The deed crate beside the token is one of them.</p>
    <p><b>Where a worker puts things.</b> A deed worker fills the deed crate first, and when that is
    full it walks to the nearest other thing on the deed that will take what it is carrying &mdash;
    another crate, a raw material bin, a chest, a larder, a cart. A <b>trash crate</b> is never chosen, so
    nothing anybody worked for ends up in it. When <b>everything on the deed is full</b> the worker
    keeps hold of its load and stands about near the token rather than tipping it on the ground, and
    says so once: empty something or build more storage and it picks up where it left off. Seed for
    sowing and wood for stoking come out of any store on the deed, not only the deed crate.</p>
    <p><b>Moving things by hand.</b> Anything in the inventory or in an open container can be
    <b>dragged</b> from one window to the other. The rules are the same as the menu's: you have to be
    standing next to the container, and it has to be willing to hold what you are giving it &mdash; a
    raw material bin takes nothing worked, a craft material bin takes nothing unworked, a larder takes
    food, drink and flour, a seed bin takes seed only, a sprout bin takes sprouts only, a barrel takes no
    solids, a full crate is full. It says which when
    it will not go.</p>
    <p>Ground does not advertise what it is holding. Grass is grass to look at, wherever it stands in
    its cycle &mdash; click a tile, or press <b>T</b>, and the Tile window says whether there is
    <b>something to pick</b> or <b>something to gather</b> on it. Pick it over and the line goes;
    leave it a while and it comes back. Every ground that grows anything can hold something &mdash;
    grass, steppe, tundra, moss, marsh and lawn &mdash; and sand, dirt and clay never do, having
    nothing to give.</p>
    <p><b>A practised eye goes over the same ground more than once.</b> Foraging and botanizing take
    <b>one more pass over the tile for every ${numberWord(PER_ROLL)} points</b> of the skill: ${PASSES_SAID}.
    Each pass is its own chance of a find and its own roll on the table, so a good forager comes off one
    tile with an armful where a beginner comes off it with a berry &mdash; and the menu says how many
    passes you are good for before you start. The tile is still picked clean for the same while
    afterwards, so every pass is a tile you did not have to walk to.</p>
    <h3>Meditation, and the three paths</h3>
    <p>Sitting still on a rug thinking about nothing is not obviously work, and it is the slowest thing
    anybody does here. Make a <b>rug</b> (${bill('make_rug')}, with a needle), stand where you mean to
    sit, and choose <b>Sit and think about nothing</b>. You may sit once every ${spanWords(SIT_REST)}, and
    <b>where</b> you sit decides what it is worth: your own yard ${percent(SIT_WORTH.yard)} of a sitting anywhere else,
    high ground off your settlement ${times(SIT_WORTH.high)} as much, and where the ground runs out and the air is thin
    <b>${times(SIT_WORTH.thin)}</b> as much; and your feet in the water add ${percent(SIT_WORTH.water - 1)} to wherever that is.</p>
    <p>At ${numberWord(CHOOSE_AT)} meditation ${numberWord(PATH_LIST.length)} ways of looking at the island become clear and you may walk exactly
    <b>one</b>, chosen at the rug and never changed. Each opens ${numberWord(PATH_LIST[0].steps.length)} things as the sitting goes on:
    ${numberWord(PATH_LIST[0].steps.filter((s) => s.ability).length)} of them are abilities you call on with a rest between, and ${numberWord(PATH_LIST[0].steps.filter((s) => !s.ability).length)} are simply true from then on.</p>
    <table>
      ${PATH_LIST.map((p) => `<tr><td><b>${p.name}</b></td><td>${p.note} ${p.steps.map((s) => (s.ability
        ? `<b>${s.name}</b> (${s.at}, then ${spanWords(s.ability.rest)} before it again): ${lowerFirst(s.note)}`
        : `<i>${s.name}</i> (${s.at}): ${lowerFirst(s.note)}`)).join(' ')}</td></tr>`).join('\n      ')}
    </table>
    <h3>An altar, and what kneeling at one buys</h3>
    <p>There is no god on this island with a name and nobody here would claim to know one. There is a
    stone table, there are the hours the clock favours, and there is the plain fact that a thing knelt
    over then comes out better than a thing that was not.</p>
    <p>An <b>altar</b> is masonry: ${bill('make_altar')}, laid with a trowel. It is built, and set down, only on a
    settlement of yours: one you founded or one you are a citizen of. A settlement has one altar: a second
    is neither built nor set down on one that has its altar standing. Kneel at it and you bank
    <b>favour</b>, on the <b>faith</b> skill. You may say what you have to say once every ${spanWords(PRAYER_REST)}, and it is
    worth most at <b>${listed(PRAYER_PEAKS.map(hudHour))}</b> &mdash; ${times((PRAYER_BASE + PRAYER_LIFT) / PRAYER_BASE)} what it is worth
    ${numberWord(PRAYER_TAPER)} hours or more from either &mdash; and less the further off you are. A good altar banks more
    than a rough one. Favour also trickles back on its own, slowly, up to whatever your faith carries
    &mdash; ${Math.round(favourCap(startOf(FAITH)))} at the start and ${FAVOUR_CEILING} at the very top.</p>
    <p>It also holds the settlement's bauble sockets: see <b>Baubles</b>, under digging up the past.</p>
    <p><b>Sacrifice</b>, on the altar's menu, gives up one ${RARITIES.slice(1, -1).map((r) => r.name).join(', ')} or ${RARITIES[RARITIES.length - 1].name} thing from your
    pack, one of a stack where it is a stack, and fills ${listed(NUTRIENTS.map((k) => NUTRIENT_NAMES[k].toLowerCase()))} to the top.
    ${capital(percent(MOTE_CHANCE))} of sacrifices also leave a <b>mote</b> of the rarity of what was given up. Absorb a mote
    (<b>Absorb into</b>, on the mote) into an ordinary thing in your pack and that thing, or one of it where it is a stack,
    takes the mote's rarity. A locked thing, a worn one, a bag with anything in it and a crate with a wildermon in it
    are not given up, and a bauble takes no mote: its rarity is rolled when it is restored.</p>
    <p>${NumberWord(CASTS.length)} things it buys, and none of them can be had any other way:</p>
    <table>
      ${CASTS.map((c) => `<tr><td><b>${c.name}</b></td><td>${c.cost} favour, faith ${c.level}. ${c.note}</td></tr>`).join('\n      ')}
    </table>
    <h3>Patrons and the spell bar</h3>
    <p>At <b>${PATRON_AT} faith</b> you may take a <b>patron</b>, in the <b>Faith</b> window: ${listed(PATRONS.map((p) => `<b>${p.name}</b> (${ALIGNMENT_NAMES[p.alignment].toLowerCase()})`))}.
    A patron is for good: once one is taken no other can be. Each offers ${numberWord(SPELLS_PER_TIER)} spells at each of
    ${numberWord(FAITH_TIER_AT.length)} tiers, which open at ${listed(FAITH_TIER_AT.map(String))} faith, and you take one of the ${numberWord(SPELLS_PER_TIER)} at each
    tier: ${numberWord(FAITH_TIER_AT.length)} spells in all, out of ${numberWord(FAITH_TIER_AT.length * SPELLS_PER_TIER)}. Every patron's tiers can be read in the window
    before you take one. Taking a patron or a spell waits for you to confirm it in the window. A spell is paid for in favour and rests a number of
    seconds of its own after each call.</p>
    <p>The <b>spell bar</b> along the bottom has ${numberWord(BAR_SLOTS)} slots: ${listed((['class', 'faith', 'path'] as const).map((s) => `${numberWord(slotsFor(s))} for ${SCHOOL_NAMES[s].toLowerCase()} spells`))}.
    A spell you take goes in the first empty faith slot; right-click a slot to put another of yours there or to empty it.
    A dark shade over a slot is the rest that spell has left. On an island only: playing by yourself in the browser there
    is nobody to keep a patron.</p>
    <p>Every spell says what it can be cast on: ${listedOr(SPELL_ONS.map((o) => `<b>${SPELL_ON_WORDS[o]}</b>`))}. A
    wildermon is any creature that is not after you; an enemy is any wild creature, so one minding its own business is both.
    A thing is anything in your pack or set down in the world, and a spell on the ground reaches everything within its own
    number of tiles of the spot. Anything but you and what you carry has to be within <b>${SPELL_REACH}</b> tiles.
    Click a slot, or hold <b>Shift</b> and press its number, and the spell goes at what you are fighting or have marked
    if it takes a creature, or else on you or round where you stand if it takes those; otherwise it asks what at.
    Right-click a person, a creature, a thing or the ground to cast any spell on your bar that takes it.</p>
    <p>The Blessing's ${numberWord(FAITH_SPELLS.filter((s) => s.patron === 'blessing').length)} spells are written: at each tier one that mends,
    one that guards, and one for creatures, things and the land. So are Justice's ${numberWord(FAITH_SPELLS.filter((s) => s.patron === 'justice').length)}:
    at each tier one that judges what it is cast on, one that keeps order in a fight, and one that measures. Chaos's are still to come. Every
    spell's numbers are in the Faith window, beside it.</p>
    <h3>The things that are not wildermon</h3>
    <p>Most of what walks this island can be tamed. ${NumberWord(MONSTER_SORTS.length)} things cannot. A <b>goblin</b> is knee-high and
    entirely malice; an <b>orc</b> is a head taller than you and carries sharpened iron; an <b>ogre</b>
    is mostly shoulder; and somewhere out there is the <b>dragon</b>.
    They notice you from ${numberWord(NOTICED[0])} to ${numberWord(NOTICED[NOTICED.length - 1])} tiles off, where anything else that hunts has your scent at
    ${numberWord(HUNT_SIGHT)}; they come straight at you, and they do not give up easily.</p>
    <p>They are <b>rare</b>: ${percent(MONSTER_SHARE)} of what stands up out in the country, and of those
    ${listed(MONSTERS.map(([id, w]) => `${percent(w / MONSTER_WEIGHT)} ${SPECIES[id].name.toLowerCase()}s`))}. Only so many of each are alive at once
    (${listed(MONSTERS.map(([id]) => `${numberWord(MONSTER_CAP[id] ?? 1)} ${SPECIES[id].name.toLowerCase()}${(MONSTER_CAP[id] ?? 1) === 1 ? '' : 's'}`))}), and the bigger the thing the further it keeps
    from your token &mdash; ${listed(MONSTERS.map(([id]) => `${article(SPECIES[id].name)} ${SPECIES[id].name.toLowerCase()} ${numberWord(MONSTER_KEEP_OFF[id] ?? 0)} tiles`))}. None of them can be tamed,
    trapped, bred or brushed. There is nothing to be done with one but kill it, and nothing to be gained
    by meeting one in your shirt: ${listed(MONSTERS.map(([id], i) => `${article(SPECIES[id].name)} ${SPECIES[id].name.toLowerCase()}'s ${i === 0 ? 'blow takes ' : ''}${percent(Math.round(SPECIES[id].attack * BLOW_SHARE * 100) / 100)}`))} of an unarmoured life.</p>
    <p>What they are worth is on the other side of that. Butchering one gives what a wildermon gives and
    then some: <b>tusk</b> and <b>sinew</b> off an orc or an ogre, and off a dragon ${numberWord(SPECIES.dragon.butcher.scale ?? 0)}
    <b>dragon scales</b> and a <b>hoard</b> &mdash; ${numberWord(HOARD_LUMPS)} to ${numberWord(HOARD_LUMPS + HOARD_MORE)} lumps, by how much of the carcass you keep,
    of the ${numberWord(HOARD_DEEP.length)} deep metals and the ${numberWord(HOARD_METALS.length - HOARD_DEEP.length)} precious ones, which is the only place on the
    island they turn up together.</p>
    <p>Tusk and sinew make a <b>composite bow</b>: ${bill('make_composite_bow')}, at ${workedAt('make_composite_bow')}. It
    throws an arrow <b>${numberWord(COMPOSITE.range ?? 0)}</b> tiles for ${COMPOSITE.damage} damage, where the best wooden bow throws
    ${numberWord(BEST_WOOD_BOW.range ?? 0)} for ${BEST_WOOD_BOW.damage}. Dragon scale riveted to leather makes <b>scale armour</b>, a class above
    plate: it turns <b>${percent(ARMOUR_CLASSES.scale.soak)}</b> of a blow where plate turns ${percent(ARMOUR_CLASSES.plate.soak)}, and it burdens you
    less than chain. A full suit takes ${numberWord(SCALE_SUIT)} scales, where one dragon carries ${numberWord(SPECIES.dragon.butcher.scale ?? 0)}.</p>
    <h3>Traps</h3>
    <p>Everything taken so far has been taken by hand: you stand in front of a wild thing with a berry
    out and hope. A <b>trap</b> is the other way. Set it, bait it, walk away, and whatever came to the
    bait while you were somewhere else is waiting when you come back &mdash; <b>alive</b>, and with
    whatever blood it was born with still in it, which is the point now that blood is worth something.</p>
    <p>A <b>snare</b> is a noose of rope on a bent shaft: ${billWords(TRAPS.snare.bill)}, and it holds anything
    up to about <b>taming ${TRAPS.snare.holds}</b>. A <b>deadfall</b> is a weighted board on a trigger &mdash;
    ${billWords(TRAPS.deadfall.bill)}, with a mallet &mdash; and it holds to about <b>taming ${TRAPS.deadfall.holds}</b>.
    Build quality moves both a little. Set one on any spot of a tile <b>outside your own
    borders</b> (nothing wild comes inside them), then <b>bait it</b> from your pack: the menu says
    which sorts would come to each thing you are carrying. Anything warier than the trap will hold
    simply takes the bait and goes.</p>
    <p>A trap rots where it stands, ${spanWords(TRAPS.snare.lifeMin)} to ${spanWords(TRAPS.snare.lifeMax)} for a snare and up to
    ${spanWords(TRAPS.deadfall.lifeMax)} for a good deadfall, and whatever is in it walks away when it goes over. A <b>timid</b>
    creature &mdash; the very thing you cannot walk up to &mdash; is ${times(TIMID_TRAPPED)} as likely to walk into
    one, and a hunter ${percent(HUNTER_TRAPPED)} as likely. Getting the catch out is still <b>taming</b>: the skill wall stands
    whether the animal is held or not, and a beast that thrashes has to be tried again.</p>
    <h3>Blood, the brush and breeding</h3>
    <p>Every wildermon is born <b>male</b> or <b>female</b> and carries <b>${numberWord(TRAIT_SLOTS)} traits</b>, and the
    traits are the whole difference between one Roxxen and the next. A trait sits in one of ${numberWord(TIERS.length)} tiers
    &mdash; ${listed(TIERS.map((t) => `<b>${t}</b>`))} &mdash; and what it is worth
    climbs steeply with the tier: a common trait moves its number by ${percent(TIER_SPAN.common[0])} to ${percent(TIER_SPAN.common[1])},
    a fantastic one by ${percent(TIER_SPAN.fantastic[0])} to ${percent(TIER_SPAN.fantastic[1])}. Traits lift how fast it <b>moves</b>, how quickly it <b>works</b>, how fast what it does
    goes into it as <b>skill</b>, what it can <b>carry and pull</b>, what it <b>brings back</b>, how
    little it <b>eats</b>, how much it can <b>take</b>, how hard it <b>hits</b>, how far it
    <b>sees</b>, how far it will <b>range</b>, how fast <b>fleece and milk</b> come back on it &mdash; and in a
    fight, what a blow <b>costs</b> it, how often a swing at it <b>lands</b>, how quickly its own <b>blows</b>
    come and how fast its wounds <b>close</b>.</p>
    <p>A few traits are <b>communal</b> (marked &#9673;): what they lift, they lift for every wildermon
    working the same settlement or the same post, the bearer included. One <i>pack leader</i> standing
    in the field makes a whole deed quicker and brighter.</p>
    <p>${NumberWord(FIGHTING.length)} of the traits are <b>fighting blood</b> &mdash; fanged, plated, slippery, quick-jawed,
    quick-healing and the rest &mdash; and those come in every tier under the one name. When one rolls,
    its <b>grade</b> is a roll of its own off the same odds, so a fanged animal may be fanged, fanged
    (rare), fanged (supreme) or fanged (fantastic), each worth steeply more than the last &mdash; ${listed(TIERS.map((t) => times(GRADE_STEP[t])).slice(1))} what
    the common grade is &mdash; and a line is bred up a grade at a time under the same husbandry.
    ${capital(percent(FIGHT_SHARE))} of what the wild throws up is fighting blood, and no animal carries more than one grade of a name.</p>
    <p>Now and again a wildermon comes into the world <b>rare</b>, at the odds a made thing has: ${listed(RARE_STEPS.map((s) => `one in ${numberWord(Math.round(1 / rarityChance(s)))} ${RARITIES[s].name}`))}.
    A monster never does, and a young one is rolled for as it is born, whatever its parents were. A rare one is <b>${times(RARITIES[1].size)} the size</b>
    of its kind, ${listed(RARE_STEPS.slice(1).map((s) => `${article(RARITIES[s].name)} ${RARITIES[s].name} one ${times(RARITIES[s].size)}`))}, and the whole beast
    <b>shimmers</b> in its rarity's colour the way rare gear does. Its ${listed(BLOOD.filter((ch) => ch.up).map((ch) => ch.label))}
    go up by ${listed(RARE_STEPS.map((s) => `<b>${cardPct(RARITIES[s].blood).slice(1)}</b> ${RARITIES[s].name}`))}, and its
    ${listed(BLOOD.filter((ch) => !ch.up).map((ch) => ch.label))} go down by ${listed(RARE_STEPS.map((s) => `<b>${cardPct(1 / RARITIES[s].blood).slice(1)}</b> ${RARITIES[s].name}`))},
    on top of what its traits do. One out of the wild also rolls its traits on better odds: ${listed(RARE_STEPS.map((s) => `${percent(Math.round(100 * betterThanCommon(husbandryOdds(0, s))) / 100)} of ${article(RARITIES[s].name)} ${RARITIES[s].name} one's`))}
    come out better than common, where ${percent(Math.round(100 * betterThanCommon(husbandryOdds(0, 0))) / 100)} of an ordinary one's do.
    Its card, the Wildermon window and <b>Look it over</b> say how rare it is.</p>
    <p>What is walking about in the wild is almost all common. Better blood is <b>bred</b>, and that is
    what <b>animal husbandry</b> is for. Make a <b>brush</b> (${bill('make_brush')}, with a carving
    knife) and <b>brush a wildermon down</b>: it puts <b>care</b> into the animal, and a cared-for beast
    works quicker, learns faster and heals as you go over it. Care runs out again over ${spanWords(CARE_HOURS * HOUR)}
    of being left alone, so it is a thing you keep up rather than do once.</p>
    <p>To breed, stand a <b>male</b> and a <b>female</b> of one sort within ${numberWord(PAIR_RANGE)} tiles of each other,
    both <b>grown</b>, both <b>fed</b>, and neither put to a mate in the last ${spanWords(BREED_REST)}, then
    choose <b>Put it to a mate</b>. The young one goes where a tamed one goes: it <b>follows you</b> when
    nothing else does, and goes into an <b>empty creature crate in your pack</b> when something does. Carrying
    none, it goes into an <b>empty creature crate of yours standing on your settlement</b>, the nearest the
    mother; and with none of those it goes off into the wild. If it takes,
    the female carries for ${spanWords(GESTATION)} and then drops a young one, and what it is born with was
    settled at that moment &mdash; a sire sold, released or eaten in between has already had his say.</p>
    <p>${capital(numberWord(TRAIT_SLOTS))} slots are filled one at a time. Each is drawn from what the pair carry between them, and
    husbandry decides <b>how often the parents' blood comes through</b> rather than whatever the wild throws up
    (${share(inheritChance(0, 0))} at no skill, ${percent(inheritChance(TOP_SKILL, 1))} at ${numberWord(TOP_SKILL)} with a well-brushed pair), and <b>how often a
    trait comes through one tier better than either parent had it</b> (never at no skill and with no care,
    ${percent(upgradeChance(TOP_SKILL, 1))} at ${numberWord(TOP_SKILL)} with a well-brushed pair) &mdash; commons becoming rares, rares becoming supremes.
    That second chance is the whole of why husbandry is worth having: it is how a line climbs. A
    high-husbandry eye also falls on the best of what the pair carry rather than picking evenly.</p>
    <p>You cannot read what you do not know. <b>Look it over</b> names the traits your husbandry is good
    enough to recognise: common blood is plain to anybody, ${listed(TIERS.slice(1).map((t, i) => `${t} ${i === 0 ? 'takes ' : ''}${TIER_LEVEL[t] + 1}`))}
    to know when it is standing in front of you. Until then the card shows only that there is
    <i>something</i> there. Only a <b>female</b> is in milk, and nothing young or past it will breed.</p>
    <p>A young one's <b>pedigree</b> names its <b>dam</b> and <b>sire</b> on its card in the Wildermon
    window and when you point at it, and on the card each of its traits you can read says where it came
    from &mdash; ${PEDIGREE_SOURCES}.</p>
    <p>A <b>Herdsman</b>'s keeping goes with every wildermon they keep, on an island and off it, and one that
    changes hands takes its new keeper's. With Lasting Care its care wears off over
    ${spanWords((herdsman('Lasting Care')['kept:care_hours'] ?? CARE_HOURS) * HOUR)} rather than ${spanWords(CARE_HOURS * HOUR)}; with Well Kept,
    brushed to a shine, it works and learns ${percent(herdsman('Well Kept')['kept:care_bonus'] ?? CARE_BONUS)} faster rather than ${percent(CARE_BONUS)};
    with Light Eaters it gets hungry ${percent(1 - (herdsman('Light Eaters')['kept:hunger'] ?? 1))} slower; and with Long-lived it grows old at
    ${spanWords(herdsman('Long-lived')['kept:old_at'] ?? OLD_AT)} rather than ${spanWords(OLD_AT)}. A Herdsman with Choose the Sex picks
    <i>For a female young</i> or <i>For a male young</i> under <b>Put it to a mate</b>. With Twins,
    one in ${numberWord(Math.round(1 / (herdsman('Twins')['breed:twins'] ?? 1)))} of their pairings give a second young as well, which goes where a
    second tamed one goes: into an empty creature crate once the first is following you. With Stud Book, <b>Examine</b> on one
    of theirs out with them says how often it takes with the mate it would be put to, and how often each of the young's
    traits is drawn from their blood and comes out a tier better.</p>
    <h3>Terraforming</h3>
    <p>Every corner of the map has soil sitting on bedrock. <b>Digging</b> lowers the corner nearest to
    where you click (the small marker) and takes a spadeful of that soil; when the last of it is gone
    your shovel grates on rock and will go no further. Strip every corner of a tile bare and the
    rock beneath is exposed, and the tile becomes rock &mdash; whatever kind lies there, which may be a
    seam of silver or gold. Drop dirt on a corner to bury the rock again.</p>
    <p><b>The level.</b> Right-click a corner and choose <b>Take the level here</b> and that corner's
    height becomes the mark every job works to. <b>Flatten</b> aims at it instead of at the tile you
    are standing on, so a whole yard can be brought to one height from wherever you happen to stand.
    <b>Digging</b> and <b>Chip corner</b> refuse a corner once it is down to the mark, and <b>dropping
    dirt</b> and <b>concrete</b> refuse one once it is up to it &mdash; so a long run of spadefuls
    asked for at a bank stops the moment the bank is level, rather than when the run is done.
    The Tile window says how far the corner under the cursor stands from the mark. <b>Clear the
    level</b> puts it away.</p>
    <p><b>A foundation</b> squares off a sloping tile without moving the ground round it, and it goes on
    bare rock only: plain stone, a seam or an ore. Dig the soil off every corner of the tile
    first. <b>Set out a foundation</b> is not offered on grass, dirt or any tile with soil left on a
    corner, nor on a tile that is already level. With a mallet it shutters the tile to be poured level
    with its highest corner, or with the level if you have taken one above that. <b>Pour the
    foundation</b> with a trowel takes <b>${CONCRETE_PER_STEP}</b> concrete for every step each corner
    is lifted, and the deepest corner wants a point of masonry for every <b>${LIFT_PER_MASONRY}</b>
    steps of it. It keeps ${numberWord(CLEAR_OF_BUILDINGS)} tile clear of any building or plan. Poured, it
    is packed ground to build or pave on, whatever is dug or mined round it.</p>
    <p><b>A spadeful out of the cart.</b> Dirt, clay and sand weigh <b>${itemDef('dirt').weight}kg</b> apiece, so a starting
    back carries ${numberWord(Math.floor((CARRY_BASE + CHAR_START * CARRY_PER_STRENGTH) / itemDef('dirt').weight))} before it starts to drag, and moving a bank is a great many walks. Dropping dirt and the packing-in half
    of flattening will take a spadeful out of any <b>crate, cart or bin within reach</b> when you are
    carrying none yourself: park the cart where the work is and it feeds itself.</p>
    <p><b>${capital(listed(Object.values(TILE_DEFS).filter((d) => d.collect).map((d) => d.name.toLowerCase())))}</b> are not dug like that unless you want them dug. Stand on
    one and choose <b>Collect</b> &mdash; the entry names what is underfoot, <i>Collect clay</i>,
    <i>Collect dirt</i> &mdash; and you fill a shovel off the top of it: the tile keeps its type, its
    corners keep their height and their soil, and the bed is there the next time you come back. It takes
    a moment longer than cutting a corner away, which is the whole of the difference. Digging the corner
    still does what it always did, for when you actually want the ground lower.</p>
    <p>A moss tile is cut as grass is: <b>Cut moss</b> gives <b>${numberWord(MOSS_PER_CUT)} moss</b> and leaves the tile moss,
    and like cut grass it cannot be cut again until it has grown back. Digging its corner gives dirt. <b>Plant moss</b> on a
    tile of <b>dirt</b> that is not under water takes <b>${MOSS_PLANT} moss</b> from your pack and turns the tile to moss;
    it is farm work, and on a settlement it is one of the jobs the border speaks for.</p>
    <p><b>Packing</b> is what makes a floor of the ground. A shovel treads <b>grass, dirt, lawn, steppe,
    tundra or moss</b> down into <b>packed dirt</b>: on sod it cuts the turf away first. Packed dirt is
    what a building wants under it, and it is the only thing <b>paving</b> will go on &mdash; both
    cobblestone and slabs want a hard, flat bed, and will not be laid on loose earth or on grass.
    Breaking paving up with a pickaxe leaves bare dirt, so repaving means packing it again.</p>
    <p>${NumberWord(SEAMS.length)} kinds of seam lie in the rock, and each needs a certain <b>mining</b> skill before it can be
    worked at all: ${listed(SEAMS.filter((r) => r.level === SEAMS[0].level).map((r) => seamName(r.name)))} from the very start, then
    ${listed(SEAMS.filter((r) => r.level !== SEAMS[0].level).map((r) => `${seamName(r.name)} at ${r.level}`))}. <b>Iron is
    ${percent(seamShare('iron_ore'))} of every seam on the island</b> and everything else shares what
    is left, which is why iron is the metal you build with and the rest are the ones you hoard. Coal burns longer than a log, so a campfire
    will take it gladly.</p>
    <p><b>Mining</b> with a pickaxe works bare rock for what is in it. Every swing that bites gives you
    shards or metal and leaves the face standing where it was; about <b>one swing in
    ${Math.round(1 / MINE_COLLAPSE)}</b> a slab comes away of its own accord and the corner drops a
    step, whether the hand on the pick is yours or a mola's. If you want the rock <i>moved</i>, that
    is <b>Chip corner</b>: the same pick at the same corner, but you are cutting the face back rather
    than working it, and it gives way about one attempt in ${numberWord(Math.round(1 / CHIP_CHANCE))}. What breaks away is yours either
    way.</p>
    <p>Every tile in the world sits on a particular rock of a particular quality &mdash; under grass,
    under a forest, under the sea, everywhere &mdash; settled when the world was made and unchanged by
    anything you do to the ground above it. Metal is laid far more thickly under dry land than under
    the sea, so most of what an island holds can actually be reached: about one land tile in
    ${numberWord(Math.round(1 / ORE_DENSITY.land))} carries some seam, and one sea tile in ${numberWord(Math.round(1 / ORE_DENSITY.water))}. <b>Prospecting</b> is how you read it. It marks every
    ore-bearing tile within range, buried or bare, and sampling where you stand names the rock, the
    mining skill any metal takes to work, the highest quality it will ever give up, and how deep it
    lies. The range starts at ${numberWord(PROSPECT_REACH)} tiles and grows by one for every ${numberWord(PROSPECT_STEP)} levels of the skill. Metal found
    under a meadow has to be dug down to before a pickaxe is any use.</p>
    <p><b>Flatten</b> brings a tile level with the ground you are standing on, corner by corner:
    ground above you is scraped down and pocketed as dirt, ground below you is packed up and spends
    dirt from your pack. Stand where you want the finished height and work outwards to terrace a
    hillside. Flattening the tile under your own feet has nothing to match, so it comes down to that
    tile's lowest corner instead.</p>
    <p>Dropped items lie where you stood; the tile's menu offers to pick them up again. Anything
    left outside slowly decays, even while you are away: food rots within the hour, stone lasts for
    days, and better quality holds up longer. Fill your water skin at any shore and drink from it on
    the road.</p>
    <p>Your skills rise with everything you do. Better skill means faster, more successful actions and
    the freedom to shape steeper slopes.</p>
    <p><b>What a gain is worth falls away as the skill fills.</b> An ordinary action gives about
    ${listed(GAIN_AT.map((v, i) => `<b>${gainSaid(v)}</b> at ${i === 0 ? 'level ' : ''}${v}`))} &mdash;
    ${numberWord(Math.round(1 / gainAt(GAIN_AT[0])))} goes for the first point of a skill, ${numberWord(Math.round(1 / gainAt(GAIN_AT[2])))} for the point after
    ${GAIN_AT[2]}, and something like <b>${numberWord(Math.round(1 / MIN_GAIN))}</b> for the last. Nobody finishes a skill in passing; the last
    point of one is a thing to go after on purpose, and the log shows it moving at the fourth place
    after the point while you do.</p>
    <h3>Garden steps, rose arches and flags</h3>
    <p><b>Garden steps</b> are a flight laid up a sloping tile of packed dirt, and a tile of them is walked
    where the bare ground would be too steep to stand on. The tile's slope, its highest corner to its
    lowest, has to be <b>${STEPS_LEAST} to ${STEPS_MOST}</b> (${metres(STEPS_LEAST)} to ${metres(STEPS_MOST)} m over the tile), and the
    corners at each end of the flight within <b>${STEPS_TWIST}</b> of each other; it climbs toward the higher
    side. <b>Lay stone steps</b> with a trowel, masonry ${STONE_DIFFICULTY}: ${STONE_STEPS_BILL}, in
    ${listed(SLAB_VARIANTS.map((v) => v.name.replace(/ slabs$/, '').toLowerCase()))}. <b>Lay timber steps</b> with a mallet, carpentry
    ${TIMBER_DIFFICULTY}: ${TIMBER_STEPS_BILL}, and the flight is of that wood. Carrying more than one stone
    or wood, the menu asks which. On a settlement it is shaping the ground, which a guest may not do.</p>
    <p>A tile of steps is stood on at any slope up to <b>${STEPS_MOST}</b>, where bare ground stops at
    ${MAX_STAND} and ${CLIMB_PER_LEVEL} more a level of climbing, and a step onto one or off one is not held
    to the ${MAX_STEP} between tile centres that a step over bare ground is: only the tile stepped onto has
    to be one you can stand on. Animals walk them by the same rule, and no cart or wagon goes onto one.
    <b>Take up the steps</b> with a pickaxe (paving) keeps ${share(STEPS_BACK)} of what went into them whole,
    rounded down &mdash; ${numberWord(stepsBack(STEPS_SLABS))} of the ${numberWord(STEPS_SLABS)} slabs and ${numberWord(stepsBack(STEPS_BRICKS))} of the
    ${numberWord(STEPS_BRICKS)} bricks, or ${numberWord(stepsBack(STEPS_PLANKS))} of the ${numberWord(STEPS_PLANKS)} planks &mdash; and leaves packed dirt.</p>
    <p>A <b>rose arch</b> (${workedAt('make_rose_arch')}: ${bill('make_rose_arch')}) and a
    <b>stone rose arch</b> (${workedAt('make_stone_rose_arch')}, with a trowel: ${bill('make_stone_rose_arch')})
    are ${numberWord(furnitureDef('rose_arch').w)} subtiles across and ${numberWord(furnitureDef('rose_arch').h)} deep, set down like any
    piece and walked through. ${ROSES_RULE} Pointing at one says how its roses stand and how long until
    they change.</p>
    <p>A <b>flagpole</b> (${workedAt('make_flagpole')}: ${bill('make_flagpole')}) flies its flag down
    the wind: straight out at the wind's full force, hanging down the pole in a calm, and
    rippling quicker the harder it blows. A <b>banner</b>'s cloth swings out down the same wind. Dye either
    before it is set down and it flies that colour; standing on a settlement, it carries the settlement's
    device, one of ${numberWord(DEVICE_COUNT)} chosen by the settlement's name.</p>
    <h3>Springs, ponds and streams</h3>
    <p>Water can stand above the sea. Dig a hollow, then right-click the bottom of it with a shovel and
    choose <b>Dig a spring</b>: water wells up and fills the hollow to the height of the lowest point
    of its rim, rising <b>${metres(FILL_RATE)} m a second</b>. The hollow has to hold at least
    <b>${metres(SPRING_DEPTH)} m</b> of water before a spring will rise in it, and one that would spread
    over more than <b>${POND_MOST} corners</b> is too wide ever to fill.</p>
    <p>Full, it <b>spills</b> over that lowest point and runs downhill, the steepest way, to the next
    hollow, fills that, spills again, and so on: into the sea, or away into the ground once it has run
    <b>${RUN_MOST} tiles</b> with nothing to fill, found a hollow too wide to fill, or filled
    <b>${numberWord(CHAIN_MOST)} ponds</b>. Level ground it crosses to the nearest way down. Dig hollows
    one below another down a slope and you have a stream of ponds; wherever the water drops
    <b>${metres(FALL_DROP)} m</b> or more from one corner to the next, it falls.</p>
    <p>A pond is water to everything: fill a bucket or a skin at it, drink from it, cast a line into
    it. Nothing is built or planted in one, no hull is launched in one, and deeper than
    <b>${metres(SWIM_DEPTH)} m</b> you swim. It follows the ground under it: cut a notch in the rim and it
    goes down to the notch, dig the hollow deeper and it deepens, fill the hollow in and the spring
    stops. <b>Stop up the spring</b> takes it and all its water away. Each of us keeps
    <b>${numberWord(SPRINGS_EACH)}</b> springs at most. Off a settlement only whoever dug a spring may stop
    it up; on one, whoever may shape its ground may dig a spring or stop any there, and nobody else may.</p>
    <p><b>Dig a pool</b> in a poured foundation with a pickaxe and it holds water
    <b>${metres(POOL_DEPTH - POOL_LIP)} m</b> deep, <b>${metres(POOL_LIP)} m</b> under the top of the slab, with
    or without a spring. Pools dug side by side in foundations poured to the same top are one pool;
    whatever stands on a slab has to be moved off before a pool is dug in it. Dig a spring in a pool and
    its water goes over the pool's lowest edge: down the face of the slab to the ground, falling where
    the drop is <b>${metres(FALL_DROP)} m</b> or more, or into a lower pool beside it, and on down the
    ground from there as any spring's water runs. A pool with nothing lower beside it keeps its water.
    A foundation with no pool in it is a wall to water, and one poured over a spring stops it.
    <b>Fill the pool in</b> takes a trowel and <b>${POOL_FILL}</b> concrete, and stops a spring in it.
    An <b>aqueduct</b> takes all a pond's or a pool's water elsewhere, ${AQUEDUCT_FLOW} litres a minute: see Aqueducts.</p>
    ${waterGarden()}
  `;
}

/** The water garden: stepping stones, the tiered fountain, and water lilies and lotus. */
function waterGarden(): string {
  const lily = WATER_PLANT_BY_ID.get('lily') as WaterPlantDef;
  const lotus = WATER_PLANT_BY_ID.get('lotus') as WaterPlantDef;
  const dyeOf = (item: string): { id: string; count: number; word: string } => {
    const d = [...DYE_BY_ID.values()].find((x) => x.from === item);
    return { id: d?.id ?? '', count: d?.count ?? 0, word: d?.word ?? '' };
  };
  const lilyDye = dyeOf(lily.flower);
  const lotusDye = dyeOf(lotus.flower);
  const reach = WATER_GARDEN_ACTIONS.find((a) => a.id === `plant_${lily.id}`)?.range ?? 1;
  const perMinute = (litres: number): string => (litres * 60).toFixed(1);
  const stones = SLAB_VARIANTS.map((v) => v.name.replace(/ slabs$/, '').toLowerCase());
  const stonesOf = `${stones.slice(0, -1).join(', ')} or ${stones[stones.length - 1]}`;
  return `
    <h3>A water garden: stepping stones, a fountain, lilies and lotus</h3>
    <p><b>Lay stepping stones</b> across shallow water &mdash; the edge of the sea, a pond, or ground a stream runs
    over &mdash; with a trowel in your pack: a masonry job at difficulty ${STONES_DIFFICULTY}, and <b>${numberWord(STONES_SLABS)}</b>
    cut slab a tile, of ${stonesOf}, which the stones are the colour of. They stand on the bottom, so only where the
    water at the middle of the tile is <b>${metres(STONES_DEPTH)} m</b> deep or less, which is twice the
    <b>${metres(SWIM_DEPTH)} m</b> you start to swim at; on bare ground or what grows flat on it, never on paving, a field or
    anything standing. On a tile of them you walk at <b>${percent(ground(TileType.SteppingStones).speed / ground(TileType.Grass).speed)}</b> of
    your pace on grass and neither wade nor swim, however deep the water round them is; a loaded cart loses
    ${share(rollCost(TileType.SteppingStones))} of its pace bumping over them. <b>Take up the stepping stones</b> gives the slab back and leaves the
    ground as it was.</p>
    <p>A <b>tiered fountain</b> is a mason's job &mdash; ${bill('make_fountain')} &mdash; and is <b>a well to every rule</b>: it draws its
    own water as a well does, <b>${perMinute(WELL_TRICKLE)}</b> litres a minute at the least and <b>${perMinute(WELL_TRICKLE + WELL_TRICKLE_QL)}</b> at
    quality ${TOP_QL}, up to <b>${furnitureDef('fountain').well} litres</b>. Fill a bucket or a waterskin at it, or drink from it where you stand.</p>
    <p><b>Water lilies</b> and <b>lotus</b> grow in still water. Botanizing on a tile with water on it or beside it &mdash; the sea, a
    pond or a pool &mdash; turns up a <b>${itemDef(lily.from).name.toLowerCase()}</b> about one find in ${watersideOdds(lily.from)} and
    <b>${itemDef(lotus.from).name.toLowerCase()}</b> one in ${watersideOdds(lotus.from)}, as well as everything it finds elsewhere.
    Plant one within ${numberWord(reach)} tiles, in a pond, a pool or the shallows of the sea, where the water is
    <b>${metres(WATER_PLANT_SHALLOWEST)} to ${metres(WATER_PLANT_DEEPEST)} m</b> deep &mdash; never where water runs, one to a tile, and not among
    stepping stones. Its leaves are up at once, in their seasons, and it <b>roots in ${spanWords(WATER_ROOTING)}</b>; from then on it keeps the island's year,
    the same for everybody. A water lily ${yearSays(lily)}; a lotus ${yearSays(lotus)}. In ${listed(SEASONS.filter((sn) => !lily.leaves.includes(sn) && !lotus.leaves.includes(sn)))}
    only the root of either is left, under the water, and its leaves come up again in ${SEASONS.find((sn) => lily.leaves.includes(sn) && lotus.leaves.includes(sn))}.</p>
    <p><b>Pick</b> a flower or a seed head and it is gone until the season turns. ${NumberWord(lilyDye.count)} water lily flowers and a bucket of
    lye boil into ${numberWord(made(`make_${lilyDye.id}`))} pots of <b>${lilyDye.word}</b> dye, and ${numberWord(lotusDye.count)} lotus flowers into
    ${numberWord(made(`make_${lotusDye.id}`))} of <b>${lotusDye.word}</b>. A seed head gives
    <b>${numberWord(lotus.seedCount ?? 0)} ${itemDef(lotus.seed ?? '').name.toLowerCase()}</b>: plant them, or eat them &mdash; raw they fill
    ${percent(itemDef(lotus.seed ?? '').food ?? 0)} of the food bar, roasted at a campfire (${numberWord(need('roast_lotus_seeds', lotus.seed ?? ''))} a handful)
    ${percent(itemDef('roast_lotus_seeds').food ?? 0)}. <b>Pull it up</b> gives the root or the seed back.</p>
  `;
}

/**
 * The help, cut into sections at every heading, with a list of contents at the
 * top and a box to search the lot. Searching keeps whole sections rather than
 * single lines, because half an explanation is worse than none.
 */
export function buildHelp(win: UIWindow): void {
  win.body.classList.add('help-body');
  const holder = document.createElement('div');
  holder.innerHTML = helpText();
  // Gather the run of nodes under each heading into a section of its own.
  const sections: Array<{ title: string; el: HTMLElement }> = [];
  let current: HTMLElement | null = null;
  for (const node of [...holder.childNodes]) {
    if (node instanceof HTMLHeadingElement && node.tagName === 'H3') {
      current = document.createElement('section');
      current.className = 'help-sec';
      current.id = `help-${sections.length}`;
      current.append(node);
      sections.push({ title: node.textContent ?? '', el: current });
      continue;
    }
    if (current) current.append(node);
    else if (node.nodeType !== Node.TEXT_NODE || (node.textContent ?? '').trim()) holder.removeChild(node);
  }

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'panel-search help-search';
  search.placeholder = 'Search the help…';
  const contents = document.createElement('nav');
  contents.className = 'help-contents';
  const pages = document.createElement('div');
  pages.className = 'help-pages';
  const count = document.createElement('div');
  count.className = 'help-count';
  count.hidden = true;

  const links = sections.map(({ title, el }, i) => {
    const a = document.createElement('button');
    a.type = 'button';
    a.className = 'help-link';
    a.textContent = title;
    a.addEventListener('click', () => {
      // Clear any search first, so the section being jumped to is on the page.
      if (search.value) {
        search.value = '';
        show('');
      }
      el.scrollIntoView({ block: 'start' });
      el.classList.add('help-found');
      setTimeout(() => el.classList.remove('help-found'), 1200);
    });
    a.title = `Jump to “${title}” (section ${i + 1} of ${sections.length})`;
    return a;
  });
  contents.append(...links);

  /** Keep only the sections that answer to what has been typed. */
  const show = (query: string): void => {
    const q = query.trim().toLowerCase();
    let kept = 0;
    for (let i = 0; i < sections.length; i += 1) {
      const { title, el } = sections[i];
      const hit = !q || `${title} ${el.textContent ?? ''}`.toLowerCase().includes(q);
      el.hidden = !hit;
      links[i].hidden = !hit;
      if (hit) kept += 1;
    }
    count.hidden = !q;
    count.textContent = kept ? `${kept} of ${sections.length} sections` : `Nothing in the help answers to “${query.trim()}”.`;
    pages.scrollTop = 0;
  };
  search.addEventListener('input', () => show(search.value));
  search.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key !== 'Escape') return;
    search.value = '';
    show('');
  });

  pages.append(...sections.map((s) => s.el));
  win.body.replaceChildren(search, contents, count, pages);
}
