/**
 * The definition tables, as SQL.
 *
 * With the rules in Postgres there are two places that need to know what a
 * shovel weighs and what grass yields. Writing them down twice is writing
 * them down wrong: one of the two drifts, and the one that drifts is whichever
 * you are not looking at.
 *
 * So the numbers keep living in TypeScript, where they always have, and this
 * turns them into rows. What Postgres holds is generated, never hand-edited —
 * the algorithms are ported, the constants are not.
 */
import { CATEGORY_DECAY, ITEM_DEFS } from '../src/game/items';
import { BURYABLE, BUSH_DEFS, ROCK_VARIANTS, TILE_DEFS, TREE_AGES, TREE_DEFS, TREE_ROOM_ONE, TREE_ROOM_TWO, TREE_SEEDS, TREE_SEED_BOTH, TREE_SEED_NONE, TREE_SEED_REACH, TREE_STAGE } from '../src/world/tiles';
import { SKILL_DEFS } from '../src/game/skills';
import { MATERIALS } from '../src/game/materials';
import { ACTIONS } from '../src/game/actions';
import { RECIPES } from '../src/game/recipes';
import { FURNITURE } from '../src/game/furniture';
import { FORAGE_TABLE, BOTANIZE_TABLE } from '../src/game/forage';
import { CROP_LIST } from '../src/game/farming';
import { FISH, BAITS } from '../src/game/fishing';
import { WALL_TYPES, MATERIALS as BUILD_MATERIALS } from '../src/game/building';
import { COAX_LAPSE, COAX_STEP, HUNT_LEASH, HUNT_REST, OLD_AT, YOUNG_FOR, WILD_REACH, WILD_REST, WILD_REST_SPREAD, SHOE_DAYS, SHOE_PACE, SHOE_STEP, SHOES_PER_MOUNT } from '../src/game/creatures';
import { FAMILY_OF, KNACK_BONUS, KNACK_CAP, KNACK_HOME, KNACK_ODDS, TITLES } from '../src/game/titles';
import { KEPT_BEST, NUTRIENT_DECAY, TABLE_BEST } from '../src/game/nutrition';
import { SPECIES, WILD_SPECIES, MONSTERS, MONSTER_CAP, MONSTER_SHARE, AGES,
         GATHER_SKILL, GATHER_VERB, GATHER_DO } from '../src/game/creatures';
import { CHANNELS, TRAITS, WILD_ODDS, TRAIT_SLOTS } from '../src/game/traits';
import { CRAFT_HEAD } from '../src/game/recipes';
import { SMITH_GAIN } from '../src/game/anvil';
import { BREW_GAIN } from '../src/game/brewing';
import { IMPROVE_GAIN } from '../src/game/improve';
import { RESTORE_GAIN } from '../src/game/archaeology';
import { FREE_GAIN } from '../src/game/traps';
import { BANDAGE_GAIN, CLEAN_GAIN } from '../src/game/firstaid';
import { SHOT_ARCHERY, SHOT_FIGHT, SWING_ARM, SWING_BODY, SWING_FIGHT, TAME_GAIN, TAME_NERVE } from '../src/game/creatureActions';
import { NET_GAIN, ROD_GAIN } from '../src/game/fishing';
import { BREED_GAIN } from '../src/game/husbandry';
import { WEAPONS, ARMOUR, ARMOUR_CLASSES, SHIELDS, HIT_LOCATIONS } from '../src/game/gear';
import { WOUND_KINDS } from '../src/game/wounds';
import { BUTCHER_PARTS, HOARD_METALS } from '../src/game/butcher';
import { CRATE_DEFS } from '../src/game/crates';
import { METALS, MOULDS, ORE_PER_LUMP, RARE_LUMP_FACTOR, RARE_METALS } from '../src/game/metal';
import { POTTERY } from '../src/game/kiln';
import { MATERIALS as IMPROVE_MATERIALS, improvable, canImprove } from '../src/game/improve';
import { NUTRIENTS } from '../src/game/nutrition';
import { BOON_SKILLS, BOON_SECONDS, BOON_BONUS } from '../src/game/boons';
import { CROWD_HIDES, DEEDS_JOINED, PLANTABLE } from '../src/game/game';
import { RARITIES, RARITY_LIFT, RARITY_ODDS, RARITY_WORD } from '../src/game/items';
import { DYES } from '../src/game/dyestuffs';
import { SLAB_VARIANTS } from '../src/world/tiles';
import { DREDGE_DEPTH, MINE_DEPTH, WORMY, RICH_WORMS } from '../src/game/actions';
import { MELT_HEAT, MELT_KEEP, MELT_SHARE, METAL_CONTENT } from '../src/game/melt';
import { COIN_DIFFICULTY, COIN_METALS, COINS_PER_LUMP, DIE_WEAR } from '../src/game/metal';
import { VESSELS, LIQUID_NAME, type LiquidKind } from '../src/game/furniture';
import { isBrew, drinkable } from '../src/game/brewing';
import { TACK } from '../src/game/creatureActions';
import { CASTS, FAVOUR_TRICKLE, PRAYER_FAVOUR, PRAYER_REST, FAVOUR_CEILING, BLESS_CAP, BLESS_STEP } from '../src/game/faith';
import { PATH_LIST, CHOOSE_AT, SIT_REST } from '../src/game/meditation';
import { BRIDGES, CLEARANCE, END_SLOP } from '../src/game/bridges';
import { BREWS } from '../src/game/brewing';
import { DYEABLE_ITEMS } from '../src/game/dyes';
import { PAIR_RANGE, GROOM_CAP, TIER_LEVEL } from '../src/game/husbandry';
import { BREED_REST, GESTATION } from '../src/game/creatures';
import { REST_CAP, REST_MULT, REST_PER_SECOND } from '../src/game/boons';
import { DAWN, DAY_SECONDS } from '../src/game/game';
import { RELICS, DIGGABLE } from '../src/game/archaeology';
import { isSeam } from '../src/world/tiles';
import { CHIP_CHANCE, TRY_LEARN } from '../src/game/actions';
import { BRAZIER_BURN_AT_HUNDRED, BRAZIER_BURN_AT_ONE, BRAZIER_CAPACITY } from '../src/game/placeables';
import { CARE_BONUS, GRAZE_FILL, GRAZE_HUNGRY } from '../src/game/creatures';
import {
  MAP_BANDS, MAP_KILL_CAP, MAP_KILL_SCALE, MAP_ODDS, MAP_RANGE, MAP_SNIPPET, TREASURE_TIERS,
  UNEARTH_REACH,
} from '../src/game/treasure';
import { GEMS, GEM_ODDS, JEWEL_BONUS, JEWEL_PIECES } from '../src/game/gems';
import { TRAPS } from '../src/game/traps';
import { DEFAULT_LOOK, LOOK_TABLES } from '../src/game/look';
import { ACTION_FLOOR, ACTION_PACE, COTTON_SECONDS, COTTON_WEIGHT, MINING_SECONDS, MINING_WEIGHT, WORKER_WEIGHT, WORLD_PACE } from '../src/game/pace';
import { DROWN_RATE, DROWN_WARN, EXHAUSTED, HEAL_FED, HEAL_RATE, HUNGER_RATE, SWIM_LEARN, SWIM_WIND, THIRST_RATE, WIND_PER_LEVEL, WIND_REST, WIND_STARVING, WIND_WALK } from '../src/game/body';
import { SAY_A_MINUTE, SAY_MAX } from '../src/game/chat';
import { CALLS_A_MINUTE, CHANGE_KEEP, EVENT_KEEP, FOG_BYTES, FOUND_MAX, IDLE_LOGOUT, ISLAND_KEEP, LAND_ASK, LEG_SLACK, PEACE_REACH, REGION, SWEEP_EVERY, SWEEP_ROWS, TICK_PLAYERS, TICK_SECONDS, TICK_WORLDS, WALK_SAMPLES } from '../src/game/keep';
import { CLIMB_PER_LEVEL, MAX_STAND, SWIM_DEPTH } from '../src/game/player';
import { CHUNK } from '../src/world/world';
import { FUELS, FUEL_SAID } from '../src/game/campfire';
import { DARK_HIT, DARK_SHOT, DARK_SWING, NIGHT_EYES_FROM, WORK_HAND, WORK_WIND, WORK_WIND_SPENT } from '../src/game/learn';

const q = (v: unknown): string => {
  if (v === undefined || v === null) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replace(/'/g, "''")}'`;
};

const out: string[] = [];
out.push(`-- Generated by scripts/dump-defs.ts from the TypeScript definitions.`);
out.push(`-- Do not edit: run \`npm run defs\` instead.`);
out.push('');
out.push(`create table if not exists item_def (
  id text primary key, name text not null, category text not null, weight real not null,
  stackable boolean not null default false, decay real, charges int
);`);
out.push(`create table if not exists tile_def (
  id int primary key, name text not null, speed real not null, blocks boolean not null default false,
  dig_yield text, mineable boolean not null default false, forage boolean not null default false,
  botanize boolean not null default false, pavable boolean not null default false,
  turns_to_dirt boolean not null default false, collect boolean not null default false
);`);
/* Laid stone or gravel: a shod mount goes quicker on it. */
out.push(`alter table tile_def add column if not exists paved boolean not null default false;`);
out.push(`create table if not exists skill_def (
  id text primary key, name text not null, start real not null, parent text
);`);
out.push(`create table if not exists material_def (
  id text primary key, difficulty real not null, weight real not null, wear real not null,
  decay real not null, edge real not null, soak real not null, bite real not null, hold real not null
);`);
/*
 * What a wall is made of, and what shape it takes.
 *
 * Two tables rather than one because a bill is a list: a timbercraft wall
 * wants planks and thatch and timber, and the order they are listed in is the
 * order they go into the wall. `ord` keeps that order, which a jsonb object
 * would not.
 */
out.push(`create table if not exists wall_type_def (
  id text primary key, name text not null, factor real not null,
  passable boolean not null default false, height real,
  low boolean not null default false, railed boolean not null default false,
  standalone boolean not null default false
);`);
/* Passable for people and for nothing else; and the cast metal a wall takes over its material's bill. */
out.push(`alter table wall_type_def add column if not exists beast_proof boolean not null default false;`);
out.push(`create table if not exists wall_fitting (type text not null, item text not null, count int not null, primary key (type, item));`);
out.push(`create table if not exists build_material_def (
  id text primary key, name text not null, kind text not null, tool text not null, skill text not null
);`);
out.push(`create table if not exists build_material_bill (
  material text not null, ord int not null, item text not null, n int not null,
  primary key (material, item)
);`);
/*
 * The wildermon, their blood and their ages.
 *
 * Everything here is a number the browser already had: what a Rabba can take,
 * what it eats, what ground it settles on, what a trait is worth on each
 * channel. The rules that read them are ported by hand; none of this is.
 */
out.push(`create table if not exists species_def (
  id text primary key, name text not null, description text not null,
  health real not null, attack real not null, speed real not null,
  tame_level real not null, tame_chance real not null, bait_hint text not null,
  timid boolean not null default false, gathers text, work_range real not null default 0,
  tame_fail text not null, leaves text not null, variants int not null default 1,
  near_water boolean not null default false, near_trees boolean not null default false,
  on_ore boolean not null default false, on_sand boolean not null default false,
  near_clay boolean not null default false, near_tar boolean not null default false,
  on_stone boolean not null default false, hunter boolean not null default false,
  nocturnal boolean not null default false, monster boolean not null default false,
  defensive boolean not null default false, milk boolean not null default false,
  fleece real, unruly real, default_stance text, shear_yield text, wound text,
  notice real, sight real
);`);
out.push(`create table if not exists species_diet (
  species text not null, item text not null, primary key (species, item)
);`);
out.push(`create table if not exists wild_table (
  species text primary key, weight real not null, monster boolean not null default false, cap int
);`);
/*
 * What you swing, what you wear, where a blow lands and what it leaves.
 */
out.push(`create table if not exists weapon_def (
  id text primary key, kind text not null, damage real not null, swing real not null,
  range real, ammo text, two_handed boolean not null default false
);`);
out.push(`create table if not exists armour_class_def (
  id text primary key, name text not null, skill text not null, soak real not null, burden real not null
);`);
out.push(`create table if not exists armour_def (
  id text primary key, slot text not null, cls text not null
);`);
out.push(`create table if not exists shield_def (
  id text primary key, block real not null, burden real not null
);`);
out.push(`create table if not exists hit_location (
  slot text primary key, ord int not null, share real not null
);`);
out.push(`create table if not exists wound_kind_def (
  id text primary key, name text not null, bleed real not null, fester real not null,
  herb text not null, note text not null
);`);
out.push(`create table if not exists butcher_part (
  part text primary key, item text not null, ord int not null
);`);
out.push(`create table if not exists species_butcher (
  species text not null, part text not null, n real not null, primary key (species, part)
);`);
out.push(`create table if not exists hoard_metal (item text primary key, ord int not null);`);
/* Two columns that arrived after their tables did. A generated table is made
 * with `if not exists`, so the only way to widen one is to say so. */
out.push(`alter table material_def add column if not exists bane boolean not null default false;`);
/* The label an item carries — `Oak`, `Steel` — as against the lower-cased id
 * it is keyed by. Anything that has to *say* what a thing is made of wants
 * this one. */
out.push(`alter table material_def add column if not exists name text;`);
/* And the sentence about it that an examine reads out. */
out.push(`alter table material_def add column if not exists note text;`);
out.push(`alter table species_def add column if not exists glow real;`);
/*
 * The firing chain: what ore becomes, what green ware becomes, and what a
 * mould full of metal cools into.
 */
/*
 * What a thing is made of, for the file and the whetstone.
 *
 * `improvable()` is a chain of questions asked of static tables — is it
 * armour, is it a metal tool, is it a bow — and the answer for any one item id
 * never changes. A constant is a constant: it is generated rather than ported,
 * which is the rule the rest of this file already follows.
 */
/** Ground a sprout takes, for the planter that puts the wood back. */
out.push(`create table if not exists plantable (tile int primary key);`);
/** Ground a spadeful of dirt covers over, leaving dirt. */
out.push(`create table if not exists buryable (tile int primary key);`);
out.push(`create table if not exists improve_material_def (
  id text primary key, name text not null, skill text not null
);`);
out.push(`create table if not exists improve_tool (
  material text not null, ord int not null, tool text not null, primary key (material, tool)
);`);
out.push(`create table if not exists improve_stock (
  material text not null, ord int not null, item text not null, primary key (material, item)
);`);
out.push(`create table if not exists improvable_def (
  item text primary key, material text not null, skill text not null
);`);
out.push(`create table if not exists item_feeds (
  item text not null, nutrient text not null, amount real not null, primary key (item, nutrient)
);`);
out.push(`create table if not exists boon_skill (ord int primary key, skill text not null);`);
/* What a trade earns you the right to be called, four to a trade. Kept here
   rather than derived down there because the names are writing, not rules. */
out.push(`create table if not exists title_def (
  id text primary key, skill text not null, at real not null, name text not null
);`);
/* And the trades that sit beside each other, so a knack earned at one can land
   on its neighbour: the same hands and the same wood. */
out.push(`create table if not exists knack_kin (skill text primary key, family text not null);`);
/* How fast a thing left lying on the ground goes off, by what sort of thing it
   is, when its own row does not say. Food rots in about half an hour; a tool
   lasts most of a day. */
out.push(`create table if not exists category_decay (category text primary key, per_hour real not null);`);
out.push(`alter table item_def add column if not exists food real;`);
out.push(`alter table item_def add column if not exists drink real;`);
/* What a thing says about itself when you look at it, and how many other
 * things it will hold. Both were only ever read by the browser until a pair
 * of hands down here wanted to examine a shovel and put it in a satchel. */
out.push(`alter table item_def add column if not exists description text;`);
/* Ground with anything living in it, and the damp ground that is full of them. */
out.push(`alter table tile_def add column if not exists wormy boolean not null default false;`);
out.push(`alter table tile_def add column if not exists rich_worms boolean not null default false;`);
/* The four stones a slab is cut from, kept in the tile's data byte the way a
 * rock tile keeps its seam. */
out.push(`create table if not exists slab_def (
  id int primary key, name text not null, item text not null
);`);
/* What a barrel holds and what a well finds for itself, in litres. */
out.push(`alter table furniture_def add column if not exists liquid real;`);
out.push(`alter table furniture_def add column if not exists well real;`);
/* A bin that takes bulk and nothing else, a hive that is the swarm's, and a
 * crate whose bottom is rotten through. */
out.push(`alter table furniture_def add column if not exists bulk boolean not null default false;`);
out.push(`alter table furniture_def add column if not exists hive real;`);
out.push(`alter table furniture_def add column if not exists trash real;`);
/* Ground worth turning over with a trowel: soil and sand, not bare rock or
 * standing water. */
out.push(`alter table tile_def add column if not exists diggable boolean not null default false;`);
/* What the old people left in the ground, and what it takes to put one back. */
out.push(`create table if not exists relic_def (
  name text primary key, parts int not null, result text not null, difficulty real not null
);`);
/*
 * What a map of a given quality is a map to, and what the map says as you get
 * warm. The bands are prose because the island says them: told a distance in
 * tiles anybody would triangulate, and the picture would be decoration.
 */
out.push(`create table if not exists treasure_def (
  id text primary key, ord int not null, min_ql real not null, name text not null,
  guard text not null, guards int not null, lumps int not null, things int not null
);`);
out.push(`create table if not exists map_band (
  ord int primary key, within real not null, say text not null
);`);
/* The stones the rock gives up, in the order they are drawn, and the pieces they are set in. */
out.push(`create table if not exists gem_def (id text primary key, name text not null, skill text not null, weight real not null, flavour text not null, ord int not null);`);
out.push(`create table if not exists jewel_def (id text primary key);`);
/* What you set and walk away from, and what it will hold. */
out.push(`create table if not exists trap_def (
  id text primary key, name text not null, difficulty real not null, holds real not null,
  reach real not null, odds real not null, life_min real not null, life_max real not null,
  water boolean not null default false, hold int, note text not null
);`);
/*
 * What a wildermon is for besides eating: a back to sit on and a shoulder to
 * pull with.
 *
 * `draught` is the flag a beast is *born* with and `pull` is what its share of
 * a team is worth; `mount` is a seat height in pixels in the browser, and down
 * here it is only ever asked whether it is there at all, which is why it stays
 * the number rather than becoming a boolean — a generated column that quietly
 * drops information is a generated column somebody has edited.
 */
out.push(`alter table species_def add column if not exists mount real;`);
out.push(`alter table species_def add column if not exists draught boolean not null default false;`);
out.push(`alter table species_def add column if not exists pull real;`);
out.push(`alter table species_def add column if not exists pitch real;`);
/* And the trades a species may be set to, for one with more than one. */
out.push(`alter table species_def add column if not exists trades text[];`);
out.push(`alter table species_def add column if not exists swims boolean not null default false;`);
out.push(`alter table species_def add column if not exists pannier real;`);
/* A cart is pulled by hand; a vehicle is driven from a seat with a team in
 * front of it; a boat is neither and wants water under it. */
out.push(`alter table furniture_def add column if not exists cart boolean not null default false;`);
out.push(`create table if not exists vehicle_def (
  id text primary key, yokes int not null, needs int not null, seat real not null
);`);
out.push(`create table if not exists boat_def (
  id text primary key, speed real not null, draught real not null, seat real not null,
  sail boolean not null default false
);`);
/* What has to be fitted before anything can be ridden. */
out.push(`create table if not exists tack_def (ord int primary key, item text not null);`);
/* A run of deck between two banks, and what one tile of it takes. */
out.push(`create table if not exists bridge_def (
  id text primary key, name text not null, span int not null, tool text not null,
  skill text not null, difficulty real not null, carts boolean not null, note text not null
);`);
out.push(`create table if not exists bridge_bill (
  kind text not null, item text not null, count int not null, primary key (kind, item)
);`);
/* Something to sleep in, and how much of a night it is worth. */
out.push(`alter table furniture_def add column if not exists bed real;`);
/* Crate spots on a rack's deck: its footprint is what it carries. */
out.push(`alter table furniture_def add column if not exists crates int;`);
/* What a barrel of water becomes if you leave it alone. */
out.push(`create table if not exists brew_def (
  id text primary key, name text not null, input text not null, count int not null,
  litres real not null, seconds real not null, difficulty real not null, done text not null
);`);
/* What will take a dye: anything woven or tanned, and the things made of them. */
out.push(`create table if not exists dyeable_item (id text primary key);`);
out.push(`create table if not exists dyeable_class (cls text primary key);`);
/* The husbandry it takes to read a trait off an animal. */
out.push(`alter table tier_odds add column if not exists level real not null default 0;`);
/*
 * What a prayer buys, and the three ways of looking at the island.
 *
 * A path's steps are a table rather than a list in a function because the
 * only thing ever asked of them is "how many of these are behind you" and
 * "which of them is called on by this name" — both of which are a `where`.
 */
out.push(`create table if not exists cast_def (
  id text primary key, name text not null, cost real not null, level real not null,
  on_what text not null, note text not null
);`);
out.push(`create table if not exists path_def (
  id text primary key, name text not null, note text not null
);`);
out.push(`create table if not exists path_step (
  path text not null, n int not null, at real not null, name text not null, note text not null,
  ability text, rest real, said text, primary key (path, n)
);`);
/* Which full bucket carries which liquid, and which empty one it leaves. */
out.push(`create table if not exists vessel_def (
  item text primary key, liquid text not null, empty text not null
);`);
out.push(`create table if not exists liquid_def (
  id text primary key, name text not null,
  drinkable boolean not null default false, brew boolean not null default false
);`);
out.push(`alter table item_def add column if not exists holds real;`);
/* Rarity and colour, which are half of what a thing is called. */
out.push(`create table if not exists rarity_def (
  id text primary key, ord int not null, boost real not null, keep real not null, ceiling real not null
);`);
/*
 * And the odds of each step, which lived in `rarity_roll` as three literals.
 *
 * Every other number about rarity is in this table and crossed from
 * `RARITIES`; the odds were the one that was not, and `improve_ceiling` is
 * what a second copy costs — it said a rare thing could be bettered 4 past
 * your skill while the table, the browser and this island's own examine line
 * all said 5. One table, and nothing to keep in step by hand.
 */
out.push(`alter table rarity_def add column if not exists odds real not null default 0;`);
/*
 * And the two sentences, which `rarity_word` also wrote out by hand.
 *
 * `word` is what is said when one comes off the bench; `lift` is what is said
 * when a thing already in your hands becomes one under the file. Both are
 * prose and both belong with the numbers they go with, for the same reason the
 * numbers do: there is one of each now instead of two.
 */
out.push(`alter table rarity_def add column if not exists word text not null default '';`);
out.push(`alter table rarity_def add column if not exists lift text not null default '';`);
out.push(`create table if not exists dye_def (
  id text primary key, name text not null, word text not null
);`);
out.push(`create table if not exists metal_def (
  id text primary key, name text not null, ore text, lump text not null,
  level real not null, work real not null
);`);
/* The six that come out of the same charge of ore as a tenth of a lump. */
out.push(`alter table metal_def add column if not exists rare boolean not null default false;`);
/* Which metals a coin is struck from. */
out.push(`alter table metal_def add column if not exists coins boolean not null default false;`);
out.push(`create table if not exists pottery_def (
  unfired text primary key, fired text not null, seconds real not null
);`);
out.push(`create table if not exists mould_def (
  id text primary key, name text not null, makes text not null, skill text not null,
  sand int not null, difficulty real not null, lumps int not null, per int not null default 1
);`);
out.push(`create table if not exists crate_def (
  kind text primary key, name text not null, item text not null, capacity int not null
);`);
out.push(`create table if not exists gather_def (
  id text primary key, skill text not null, verb text not null, plain text not null
);`);
/* What the fire gives back of a thing: the lumps it was cast from, a piece at a time. */
out.push(`create table if not exists melt_def (item text primary key, content real not null);`);
out.push(`create table if not exists trait_def (
  id text primary key, name text not null, tier text not null,
  aura boolean not null default false, note text not null
);`);
out.push(`create table if not exists trait_effect (
  trait text not null, channel text not null, mul real not null, primary key (trait, channel)
);`);
/* And what each of those channels *is*, in the words a card prints. The
 * channels were declared as a TypeScript union with a line of comment over
 * each arm, and a comment is not something either side can read out. */
out.push(`create table if not exists channel_def (
  id text primary key, ord int not null, label text not null, note text not null,
  up boolean not null default true
);`);
out.push(`create table if not exists age_def (
  id text primary key, name text not null, speed real not null, pull real not null,
  yield real not null, growth real not null, tame real not null, works boolean not null
);`);
out.push(`create table if not exists tier_odds (
  tier text primary key, ord int not null, weight real not null
);`);
out.push(`create table if not exists action_def (
  id text primary key, label text not null, verb text not null, skill text, tool text,
  corner boolean not null default false, range real, stamina real not null default 0,
  base_time real not null, difficulty real
);`);
/* The first cut of this table was written by hand for one action and had the
 * shape one action needs: a difficulty that is always set, a range in whole
 * tiles. Most actions have no difficulty at all, and a fishing rod reaches
 * three and a half tiles. */
out.push(`alter table action_def alter column difficulty drop not null;`);
out.push(`alter table action_def alter column range type real;`);
out.push(`alter table action_def add column if not exists instant boolean not null default false;`);
out.push(`alter table action_def add column if not exists repeatable boolean not null default false;`);
out.push(`create table if not exists recipe (
  id text primary key, result text not null, count int not null default 1,
  tool text, station text, skill text not null, label text not null, verb text not null,
  base_time real not null, stamina real not null default 0, difficulty real,
  consume_on_fail boolean not null default false, ql_from_inputs boolean not null default false,
  material text, wood text, extra text, done text not null, fail text
);`);
/*
 * What a thing set down on the ground takes up, and what it is good for.
 *
 * Footprints are in subtiles, four to a tile each way, which is what decides
 * where its centre is and therefore whether you are standing near enough to
 * use it. A hearth is anything with a fire in it.
 */
/*
 * The rock under the island, in the order it is stored in.
 *
 * The index is the storage, not the ladder — a tile's rock is written down as
 * a number, so this list may only ever be appended to. `level` is the ladder:
 * what mining a seam takes.
 */
out.push(`create table if not exists rock_def (
  id int primary key, name text not null, yields text not null,
  level real not null default 1, ore boolean not null default false
);`);
/*
 * And whether a face gives up anything but shards, which is not the same
 * question as whether it is metal.
 *
 * `ore` is `yields` ending in `_ore` and nothing more — which makes a coal
 * seam, yielding plain `coal`, indistinguishable from bare stone to every rule
 * that goes looking for something worth mining.
 */
out.push(`alter table rock_def add column if not exists seam boolean not null default false;`);
/* What stands on a tile. A tile's `data` byte holds the species in its low four
 * bits, the age in the next two, and how many cuts it has taken in the top two. */
out.push(`create table if not exists tree_def (id int primary key, name text not null, logs int not null);`);
/* What it bears, for whoever is standing under it in season. */
out.push(`alter table tree_def add column if not exists fruit text;`);
/* And not what it is worth felling: that is the age's to say now, not the
 * species'. A birch and an oak of the same age come down for the same timber. */
out.push(`alter table tree_def drop column if exists logs;`);
/* How many landed cuts each age takes, what it leaves on the ground, and
 * whether it is grown enough to fruit. */
out.push(`create table if not exists tree_age_def (
  id int primary key, name text not null, hits int not null, logs int not null,
  bears boolean not null, next int
);`);
/* And what each age becomes when its day is up, which came a change later than
 * the table did. */
out.push(`alter table tree_age_def add column if not exists next int;`);
/* And what a hatchet prunes each back to, a change later again. */
out.push(`alter table tree_age_def add column if not exists pruned int;`);
/* And whether there is life in it, which a shrivelled tree has not. */
out.push(`alter table tree_age_def add column if not exists alive boolean not null default true;`);
out.push(`create table if not exists bush_def (id int primary key, name text not null);`);
/* And what a sickle cuts off each, a change later than the table. */
out.push(`alter table bush_def add column if not exists yields text;`);
/* Weighted tables, shared by foraging people and foraging creatures. */
out.push(`create table if not exists loot_table (
  id text not null, item text not null, weight real not null, primary key (id, item)
);`);
/* What grows in a field: the seed it is sown from, what it gives, and how long
 * each of its four stages takes. */
out.push(`create table if not exists crop_def (
  id text primary key, name text not null, seed text not null, produce text not null,
  stage_seconds real not null
);`);
/* What swims where, and what brings it up. `depth` is the water it will not be
 * found in less than; `level` the skill before one comes up at all. */
out.push(`create table if not exists fish_def (
  id text primary key, name text not null, depth real not null, level real not null, weight real not null
);`);
out.push(`create table if not exists bait_def (id text primary key, note text not null);`);
/* Ordered: a bait's first favourite bites hardest. */
out.push(`create table if not exists bait_favours (
  bait text not null references bait_def on delete cascade,
  rank int not null, fish text not null, primary key (bait, rank)
);`);
out.push(`create table if not exists furniture_def (
  id text primary key, name text not null, w int not null, h int not null,
  capacity real, hearth boolean not null default false, altar boolean not null default false
);`);
/* A bell is rung; a landmark is on the map from the day it is set up. */
out.push(`alter table furniture_def add column if not exists bell boolean not null default false;`);
out.push(`alter table furniture_def add column if not exists landmark boolean not null default false;`);
out.push(`create table if not exists recipe_input (
  recipe text not null references recipe on delete cascade,
  ord int not null, item text not null, count int not null default 1,
  primary key (recipe, ord)
);`);
/* What a craft hands back besides the thing itself: the bucket the lye was
 * mixed in on success, and what is left of a spoiled batch on failure. */
out.push(`create table if not exists recipe_gives (
  recipe text not null references recipe on delete cascade,
  item text not null, count int not null default 1,
  kind text not null check (kind in ('return', 'salvage')),
  primary key (recipe, item, kind)
);`);
out.push('');
out.push(`do $rls$
begin
  execute 'alter table action_def enable row level security';
  execute 'alter table recipe enable row level security';
  execute 'alter table recipe_input enable row level security';
  execute 'alter table recipe_gives enable row level security';
  execute 'alter table furniture_def enable row level security';
  execute 'alter table rock_def enable row level security';
  execute 'alter table tree_def enable row level security';
  execute 'alter table bush_def enable row level security';
  execute 'alter table loot_table enable row level security';
  execute 'alter table crop_def enable row level security';
  execute 'alter table fish_def enable row level security';
  execute 'alter table bait_def enable row level security';
  execute 'alter table bait_favours enable row level security';
end $rls$;`);
for (const t of ['action_def', 'recipe', 'recipe_input', 'recipe_gives', 'furniture_def', 'rock_def', 'tree_def', 'bush_def', 'loot_table', 'crop_def', 'fish_def', 'bait_def', 'bait_favours']) {
  out.push(`drop policy if exists ${t}_read on ${t};`);
  out.push(`create policy ${t}_read on ${t} for select to anon, authenticated using (true);`);
  out.push(`grant select on ${t} to anon, authenticated;`);
  out.push(`revoke insert, update, delete on ${t} from anon, authenticated;`);
}
/*
 * Player data may not point at generated data — and this makes sure of it.
 *
 * `crop.id` referenced `crop_def`, which reads like good hygiene and is a
 * trap: these tables are reloaded wholesale, and a table cannot be truncated
 * while anything references it. Regenerating after adding a crop would have
 * meant failing outright, or truncating the players' fields along with the
 * rulebook.
 *
 * The generated file drops such keys itself rather than relying on a separate
 * migration, because a separate one sorts wherever its timestamp puts it and
 * this has to happen first, every time, on a fresh database as much as an old
 * one.
 */
out.push('');
out.push('alter table if exists crop drop constraint if exists crop_id_fkey;');
out.push('');
out.push('truncate item_def, tile_def, skill_def, material_def, rarity_def, dye_def, slab_def, vessel_def, liquid_def, relic_def, trap_def, treasure_def, map_band, gem_def, jewel_def;');
GEMS.forEach((g, i) => out.push(`insert into gem_def values (${q(g.id)}, ${q(g.name)}, ${q(g.skill)}, ${q(g.weight)}, ${q(g.flavour)}, ${q(i)});`));
for (const id of JEWEL_PIECES) out.push(`insert into jewel_def values (${q(id)});`);
out.push('');

/*
 * Eighteen things this game can make and has no definition for: seventeen
 * moulds and the altar. The browser does not notice, because `itemDef()` hands
 * back `{ name: id, category: 'misc', weight: 1 }` for anything it has never
 * heard of — so a mould is called `arrow_head_mould` on screen and weighs a
 * kilo, which is wrong and harmless.
 *
 * Down here it is neither. A missing row is a null, and a null in a
 * concatenation is a null all the way out: `item_name` of a mould was null,
 * and the action that tried to say its name died on a not-null constraint
 * rather than saying anything at all. That is the same bug the starting kit's
 * `knife` caused, and the fix is not another `coalesce` in another accessor —
 * it is the row. The browser's own fallback, written down, so that every
 * lookup on this island finds something the way every lookup in the browser
 * does.
 */
const NAMED = new Set(Object.keys(ITEM_DEFS));
const unnamed = new Set<string>();
for (const r of RECIPES) {
  if (!NAMED.has(r.result)) unnamed.add(r.result);
  for (const i of r.inputs) if (i.item && !NAMED.has(i.item)) unnamed.add(i.item);
}
for (const [id, d] of Object.entries(ITEM_DEFS)) {
  out.push(`insert into item_def values (${q(id)}, ${q(d.name)}, ${q(d.category)}, ${q(d.weight)}, ${q(!!d.stackable)}, ${q(d.decay)}, ${q(d.charges)});`);
}
for (const [id, d] of Object.entries(TILE_DEFS)) {
  out.push(`insert into tile_def values (${q(Number(id))}, ${q(d.name)}, ${q(d.speed)}, ${q(!!d.blocks)}, ${q(d.digYield)}, ${q(!!d.mineable)}, ${q(!!d.forage)}, ${q(!!d.botanize)}, ${q(!!d.pavable)}, ${q(!!d.turnsToDirt)}, ${q(!!d.collect)});`);
  if (d.paved) out.push(`update tile_def set paved = true where id = ${q(Number(id))};`);
}
for (const d of SKILL_DEFS) {
  out.push(`insert into skill_def values (${q(d.id)}, ${q(d.name)}, ${q(d.start)}, ${q((d as { parent?: string }).parent)});`);
}
/*
 * `Object.entries` of an *array* hands you indices.
 *
 * This loop read `[id, m]` out of `MATERIALS`, which is a list, so every
 * material went into the database keyed '0', '1', '2' — and every lookup
 * against an item's `Oak` or `steel` missed, fell through a `coalesce(..., 1)`
 * and behaved as if the thing were made of nothing in particular. Silent for
 * the whole port: a seryll hatchet wore out exactly as fast as a pine one.
 */
for (const m of MATERIALS) {
  out.push(`insert into material_def (id, name, difficulty, weight, wear, decay, edge, soak, bite, hold, bane, note) values (` + [q(m.id), q(m.name), q(m.difficulty), q(m.weight), q(m.wear), q(m.decay), q(m.edge), q(m.soak), q(m.bite), q(m.hold), q(!!(m as { bane?: boolean }).bane), q(m.note)].join(', ') + `);`);
}

/*
 * Every action there is, as rows.
 *
 * The *data* half of an action — what it is called, what it needs in hand,
 * how far away you may stand, how long it takes and how hard it is — is the
 * same in both places and so is generated. Only the doing of it is ported by
 * hand, which is what `act_perform` is.
 *
 * Writing them all down even before they can all be done is deliberate: an
 * island that knows `chop_down` exists can say "that cannot be done here yet"
 * rather than "there is no such thing", which is the difference between a
 * feature that is coming and a client that looks broken.
 */
type A = Record<string, unknown>;

/**
 * Two things with one name is one thing, silently.
 *
 * `ACTION_BY_ID` and `RECIPE_BY_ID` are both `new Map(...)`, which keeps the
 * last of any repeated key without a word — so a duplicate id is not an error
 * in the browser, it is simply one of the two quietly never happening. The
 * database has a primary key and says so, which is how the creel was found;
 * this says so earlier and in a more useful place.
 */
const clash = (what: string, ids: string[]): void => {
  const seen = new Set<string>();
  const twice = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  if (twice.length) {
    throw new Error(`${what} defined more than once: ${[...new Set(twice)].join(', ')}`);
  }
};
clash('actions', (ACTIONS as unknown as A[]).map((a) => String(a.id)));
clash('recipes', RECIPES.map((r) => r.id));

out.push('');
out.push(`truncate action_def;`);
for (const a of ACTIONS as unknown as A[]) {
  out.push(`insert into action_def (id, label, verb, skill, tool, corner, range, stamina, base_time, difficulty, instant, repeatable) values (` +
    [q(a.id), q(a.label), q(a.verb), q(a.skill), q(a.tool), q(!!a.corner), q(a.range === undefined ? null : a.range),
     q(a.stamina ?? 0), q(a.baseTime ?? 1), q(a.difficulty === undefined ? null : a.difficulty),
     q(!!a.instant), q(!!a.repeat)].join(', ') + `);`);
}

/*
 * And every recipe, which is where the count stops being frightening.
 *
 * Two hundred and five of the actions above are a recipe with a label on it:
 * take these things, hold that tool, stand near that fire, roll against this
 * difficulty, and be left with that. None of them needs a line of its own in
 * the doing — one `craft` knows how to read a row.
 */
out.push('');
out.push(`truncate melt_def, wall_fitting, recipe, recipe_input, recipe_gives, furniture_def, rock_def, tree_def, tree_age_def, bush_def, loot_table, crop_def, fish_def, bait_favours, bait_def, wall_type_def, build_material_def, build_material_bill, species_def, species_diet, wild_table, trait_def, trait_effect, channel_def, age_def, tier_odds, gather_def, weapon_def, armour_class_def, armour_def,
  shield_def, hit_location, wound_kind_def, butcher_part, species_butcher, hoard_metal, crate_def, metal_def, pottery_def, mould_def,
  improve_material_def, improve_tool, improve_stock, improvable_def, item_feeds, boon_skill, plantable, buryable,
  title_def, knack_kin, category_decay,
  vehicle_def, boat_def, tack_def, cast_def, path_def, path_step,
  bridge_def, bridge_bill, brew_def, dyeable_item, dyeable_class;`);

/*
 * Every choice the character creator offers.
 *
 * Ten skin tones, twenty haircuts, fourteen hair colours, eight eyes, seven
 * beards, sixteen cloths and three builds — all of it numbers, so all of it
 * lives in `src/game/look.ts` and arrives here rather than being written twice.
 *
 * `fallback` is the row `look_clean()` falls to when a look asks for something
 * that is not in the table, and it is generated from `DEFAULT_LOOK` for the
 * same reason as the rest: a default hardcoded in SQL is a default that drifts
 * from the one the browser draws.
 *
 * The table itself is created in `20260915033000_looks.sql` as well as here,
 * because that one is stamped by hand and this one by the wall clock, and the
 * two clocks cross. Both say `if not exists`; neither cares which won.
 */
out.push(`create table if not exists look_option (
  kind text not null, id text not null, ord int not null, name text not null,
  colour text, fallback boolean not null default false, primary key (kind, id)
);`);
out.push('truncate look_option;');
for (const [kind, table] of Object.entries(LOOK_TABLES)) {
  table.forEach((o, n) => {
    const colour = (o as { colour?: string }).colour ?? null;
    const isDefault = DEFAULT_LOOK[kind as keyof typeof DEFAULT_LOOK] === o.id;
    out.push(`insert into look_option values (${q(kind)}, ${q(o.id)}, ${n}, ${q(o.name)}, ${q(colour)}, ${q(isDefault)});`);
  });
}
type S = Record<string, unknown>;
for (const d of Object.values(SPECIES) as unknown as S[]) {
  out.push(`insert into species_def values (` + [
    q(d.id), q(d.name), q(d.description), q(d.health), q(d.attack), q(d.speed),
    q(d.tameLevel), q(d.tameChance), q(d.baitHint), q(!!d.timid), q(d.gathers),
    q(d.workRange ?? 0), q(d.tameFail), q(d.leaves), q((d.variants as unknown[]).length),
    q(!!d.nearWater), q(!!d.nearTrees), q(!!d.onOre), q(!!d.onSand), q(!!d.nearClay),
    q(!!d.nearTar), q(!!d.onStone), q(!!d.hunter), q(!!d.nocturnal), q(!!d.monster),
    q(!!d.defensive), q(!!d.milk), q(d.fleece ?? null), q(d.unruly ?? null),
    q(d.defaultStance ?? null), q(d.shearYield ?? null), q(d.wound ?? null),
    q(d.notice ?? null), q(d.sight ?? null)].join(', ') + `);`);
  if (d.glow !== undefined) out.push(`update species_def set glow = ${q(d.glow)} where id = ${q(d.id)};`);
  for (const [col, v] of [['mount', d.mount], ['pull', d.pull], ['pitch', d.pitch], ['pannier', d.pannier]] as Array<[string, unknown]>) {
    if (v !== undefined) out.push(`update species_def set ${col} = ${q(v)} where id = ${q(d.id)};`);
  }
  if (d.draught) out.push(`update species_def set draught = true where id = ${q(d.id)};`);
  if (d.swims) out.push(`update species_def set swims = true where id = ${q(d.id)};`);
  for (const item of d.diet as string[]) out.push(`insert into species_diet values (${q(d.id)}, ${q(item)});`);
  const trades = (d as unknown as { trades?: string[] }).trades;
  if (trades) out.push(`update species_def set trades = array[${trades.map(q).join(', ')}]::text[] where id = ${q(d.id)};`);
}
for (const id of [...unnamed].sort()) {
  out.push(`insert into item_def values (${q(id)}, ${q(id)}, 'misc', 1, false, null, null);`);
}
for (const t of [...PLANTABLE].sort((a, b) => a - b)) out.push(`insert into plantable values (${q(t)});`);
for (const t of [...BURYABLE].sort((a, b) => a - b)) out.push(`insert into buryable values (${q(t)});`);
/*
 * Only the three that have a name. The browser keys rarity by an index into a
 * list whose first entry is the ordinary one with an empty name, and a row
 * called '' would be a row every lookup had to remember to skip. Down here an
 * ordinary thing has a null rarity and nothing to say about itself.
 */
RARITIES.forEach((r, ord) => {
  if (!r.name) return;
  out.push(`insert into rarity_def values (${q(r.name)}, ${q(ord)}, ${q(r.boost)}, ${q(r.keep)}, ${q(r.ceiling)}, ${q(RARITY_ODDS[ord - 1])}, ${q(RARITY_WORD[ord])}, ${q(RARITY_LIFT[ord])});`);
});
for (const d of DYES) out.push(`insert into dye_def values (${q(d.id)}, ${q(d.name)}, ${q(d.word)});`);
for (const m of Object.values(IMPROVE_MATERIALS)) {
  out.push(`insert into improve_material_def values (${q(m.id)}, ${q(m.name)}, ${q(m.skill)});`);
  m.tools.forEach((t, ord) => out.push(`insert into improve_tool values (${q(m.id)}, ${q(ord)}, ${q(t)});`));
  m.stock.forEach((i, ord) => out.push(`insert into improve_stock values (${q(m.id)}, ${q(ord)}, ${q(i)});`));
}
for (const id of Object.keys(ITEM_DEFS)) {
  const what = canImprove(id) ? improvable(id) : null;
  if (what) out.push(`insert into improvable_def values (${q(id)}, ${q(what.material.id)}, ${q(what.skill)});`);
}
for (const [id, d] of Object.entries(ITEM_DEFS)) {
  if (d.food !== undefined) out.push(`update item_def set food = ${q(d.food)} where id = ${q(id)};`);
  if (d.drink !== undefined) out.push(`update item_def set drink = ${q(d.drink)} where id = ${q(id)};`);
  if (d.description !== undefined) out.push(`update item_def set description = ${q(d.description)} where id = ${q(id)};`);
  if (d.holds !== undefined) out.push(`update item_def set holds = ${q(d.holds)} where id = ${q(id)};`);
  for (const n of NUTRIENTS) {
    const v = d.feeds?.[n];
    if (v) out.push(`insert into item_feeds values (${q(id)}, ${q(n)}, ${q(v)});`);
  }
}
BOON_SKILLS.forEach((id, ord) => out.push(`insert into boon_skill values (${q(ord)}, ${q(id)});`));
out.push(`create or replace function boon_seconds() returns double precision language sql immutable as $fn$ select ${q(BOON_SECONDS)}::double precision $fn$;`);
out.push(`create or replace function boon_bonus() returns double precision language sql immutable as $fn$ select ${q(BOON_BONUS)}::double precision $fn$;`);
for (const t of TITLES) out.push(`insert into title_def values (${q(t.id)}, ${q(t.skill)}, ${q(t.at)}, ${q(t.name)});`);
for (const [skill, family] of FAMILY_OF) out.push(`insert into knack_kin values (${q(skill)}, ${q(family)});`);
for (const [cat, per] of Object.entries(CATEGORY_DECAY)) out.push(`insert into category_decay values (${q(cat)}, ${q(per)});`);
for (const m of METALS) {
  out.push(`insert into metal_def values (${q(m.id)}, ${q(m.name)}, ${q(m.ore)}, ${q(m.lump)}, ${q(m.level)}, ${q(m.work)}, ${q(RARE_METALS.has(m.id))});`);
}
for (const id of COIN_METALS) out.push(`update metal_def set coins = true where id = ${q(id)};`);
for (const d of POTTERY) out.push(`insert into pottery_def values (${q(d.unfired)}, ${q(d.fired)}, ${q(d.seconds)});`);
for (const d of MOULDS) {
  out.push(`insert into mould_def values (${q(d.id)}, ${q(d.name)}, ${q(d.makes)}, ${q(d.skill)}, ${q(d.sand)}, ${q(d.difficulty)}, ${q(d.lumps)}, ${q(d.per ?? 1)});`);
}
for (const [kind, d] of Object.entries(CRATE_DEFS)) {
  out.push(`insert into crate_def values (${q(kind)}, ${q(d.name)}, ${q(d.item)}, ${q(d.capacity)});`);
}
for (const w of WEAPONS) {
  out.push(`insert into weapon_def values (${q(w.id)}, ${q(w.kind)}, ${q(w.damage)}, ${q(w.swing)}, ${q(w.range ?? null)}, ${q(w.ammo ?? null)}, ${q(!!w.twoHanded)});`);
}
for (const c of Object.values(ARMOUR_CLASSES)) {
  out.push(`insert into armour_class_def values (${q(c.id)}, ${q(c.name)}, ${q(c.skill)}, ${q(c.soak)}, ${q(c.burden)});`);
}
for (const a of ARMOUR) out.push(`insert into armour_def values (${q(a.id)}, ${q(a.slot)}, ${q(a.cls)});`);
for (const sh of Object.values(SHIELDS)) out.push(`insert into shield_def values (${q(sh.id)}, ${q(sh.block)}, ${q(sh.burden)});`);
HIT_LOCATIONS.forEach(([slot, share], ord) => out.push(`insert into hit_location values (${q(slot)}, ${q(ord)}, ${q(share)});`));
for (const k of Object.values(WOUND_KINDS)) {
  out.push(`insert into wound_kind_def values (${q(k.id)}, ${q(k.name)}, ${q(k.bleed)}, ${q(k.fester)}, ${q(k.herb)}, ${q(k.note)});`);
}
BUTCHER_PARTS.forEach(([part, item], ord) => out.push(`insert into butcher_part values (${q(part)}, ${q(item)}, ${q(ord)});`));
HOARD_METALS.forEach((item, ord) => out.push(`insert into hoard_metal values (${q(item)}, ${q(ord)});`));
for (const d of Object.values(SPECIES) as unknown as S[]) {
  for (const [part, n] of Object.entries(d.butcher as Record<string, number>)) {
    out.push(`insert into species_butcher values (${q(d.id)}, ${q(part)}, ${q(n)});`);
  }
}
for (const [id, skill] of Object.entries(GATHER_SKILL)) {
  out.push(`insert into gather_def values (${q(id)}, ${q(skill)}, ${q(GATHER_VERB[id as 'forage'])}, ${q(GATHER_DO[id as 'forage'])});`);
}
for (const [item, content] of Object.entries(METAL_CONTENT).sort()) out.push(`insert into melt_def values (${q(item)}, ${q(content)});`);
for (const [id, weight] of WILD_SPECIES) out.push(`insert into wild_table values (${q(id)}, ${q(weight)}, false, null);`);
for (const [id, weight] of MONSTERS) out.push(`insert into wild_table values (${q(id)}, ${q(weight)}, true, ${q(MONSTER_CAP[id] ?? 1)});`);
for (const t of TRAITS) {
  out.push(`insert into trait_def values (${q(t.id)}, ${q(t.name)}, ${q(t.tier)}, ${q(!!t.aura)}, ${q(t.note)});`);
  for (const [channel, mul] of Object.entries(t.effects)) out.push(`insert into trait_effect values (${q(t.id)}, ${q(channel)}, ${q(mul)});`);
}
CHANNELS.forEach((ch, ord) =>
  out.push(`insert into channel_def values (${q(ch.id)}, ${q(ord)}, ${q(ch.label)}, ${q(ch.note)}, ${q(ch.up)});`));
for (const a of Object.values(AGES)) {
  out.push(`insert into age_def values (${q(a.id)}, ${q(a.name)}, ${q(a.speed)}, ${q(a.pull)}, ${q(a.yield)}, ${q(a.growth)}, ${q(a.tame)}, ${q(a.works)});`);
}
['common', 'rare', 'supreme', 'fantastic'].forEach((tier, ord) =>
  out.push(`insert into tier_odds values (${q(tier)}, ${q(ord)}, ${q(WILD_ODDS[tier as 'common'])});`));
// The two loose numbers, as functions rather than a row with no table to be in.
out.push(`create or replace function monster_share() returns double precision language sql immutable as $fn$ select ${q(MONSTER_SHARE)}::double precision $fn$;`);
out.push(`create or replace function trait_slots() returns int language sql immutable as $fn$ select ${q(TRAIT_SLOTS)} $fn$;`);
/* A gap worth bridging, two banks that will carry one deck, and a pair that
 * will stand close enough to be put together. */
for (const [fn, v] of [
  ['clearance', CLEARANCE], ['end_slop', END_SLOP], ['pair_range', PAIR_RANGE],
  ['groom_cap', GROOM_CAP], ['breed_rest', BREED_REST], ['gestation', GESTATION],
  ['rest_cap', REST_CAP], ['rest_mult', REST_MULT], ['rest_per_second', REST_PER_SECOND],
  ['dawn_hour', DAWN], ['day_seconds', DAY_SECONDS],
  /*
   * What one unit of `base_time` is worth in seconds, and the shortest a go at
   * anything can be. `base_time` in `action_def` and `recipe` is a weight, not
   * a clock — see `src/game/pace.ts` — and these two are what turn it into
   * one. Generated for the same reason as everything else here: the browser
   * and the database have to price a job the same, and two hand-written
   * numbers are two numbers that drift.
   */
  ['action_pace', ACTION_PACE], ['action_floor', ACTION_FLOOR], ['worker_weight', WORKER_WEIGHT],
  /*
   * And the yardstick itself, so that the suite can check it has not drifted:
   * `act_duration(base_time('mine'), 0, 0, 1)` must come to `mining_seconds()`,
   * which walks the whole chain — the weight, the pace and the floor — in one
   * sentence. Change mining's weight without changing `MINING_WEIGHT` and
   * every timer in the game quietly re-prices itself around a mining job that
   * is no longer thirty seconds; this is what notices.
   */
  ['mining_seconds', MINING_SECONDS], ['mining_weight', MINING_WEIGHT],
  /*
   * And the world's own clock, which is the same idea against a second
   * yardstick: cotton takes five minutes a stage, and everything the world
   * does on its own keeps the ratio to that it always had.
   *
   * `world_pace` is not read by anything down here — every world duration is
   * scaled where it is *defined*, so what arrives in `crop_def` and the rest
   * is already paced. It is emitted so the suite can say out loud what the
   * pace is and check that cotton is still the thing it was worked out from.
   */
  ['world_pace', WORLD_PACE], ['cotton_seconds', COTTON_SECONDS], ['cotton_weight', COTTON_WEIGHT],
  /*
   * How long a beast is young, when it turns old, and how long a run of
   * offerings is worth anything.
   *
   * These *were* in the migrations as `interval '1 hour'`, `interval '6 hours'`
   * and `interval '90 seconds'` — the same three numbers as the TypeScript,
   * written down a second time. Nothing noticed until the world's clock moved
   * and only one copy went with it, which would have left the browser calling
   * a beast grown at two and a half hours while the database still called it
   * young. Generated now, like everything else that is a number.
   */
  ['young_for', YOUNG_FOR], ['old_at', OLD_AT], ['coax_lapse', COAX_LAPSE],
  /* What one offering is worth to the next one. There is no ceiling on the run
     any more, so this is the whole of the rule and belongs in one place. */
  ['coax_step', COAX_STEP],
  /* How far a hunter comes from where it first had your scent, and how long it
     wants nothing to do with hunting after it gives one up. */
  ['hunt_leash', HUNT_LEASH], ['hunt_rest', HUNT_REST],
  /* A knack: what one is worth, how many a trade holds, how often a go leaves
     one behind, and how often it lands on the trade you were working rather
     than a neighbour. */
  ['knack_each', KNACK_BONUS], ['knack_cap', KNACK_CAP],
  ['knack_odds', KNACK_ODDS], ['knack_home', KNACK_HOME],
  /* And what a table with all four things on it is worth: to what you learn,
     and to how slowly hunger and thirst come on. */
  ['table_best', TABLE_BEST], ['kept_best', KEPT_BEST], ['nutrient_decay', NUTRIENT_DECAY],
  /*
   * And the keeper's own numbers: how often the island's clock comes round,
   * how long a shut tab is left standing there, how long talk and tile changes
   * are kept, when an island nobody visits goes back to the sea, and how much
   * one round of the clock will bite off.
   *
   * Real seconds rather than world seconds — a crop ripening answers to
   * `WORLD_PACE`, a database tidying up after itself does not.
   */
  /* What a level of climbing adds to the steepest step a body can take. */
  ['climb_per_level', CLIMB_PER_LEVEL],
  /* The steepest tile a body can stand on, before climbing. */
  ['max_stand', MAX_STAND],
  /* And how far under the waterline a rock face may still be worked. */
  ['mine_depth', MINE_DEPTH],
  ['dredge_depth', DREDGE_DEPTH],
  /* What the fire gives back of a thing melted down, and the heat it takes. */
  ['melt_share', MELT_SHARE], ['melt_keep', MELT_KEEP], ['melt_heat', MELT_HEAT],
  /* Coins: how many a lump strikes, what a strike costs the die, and how hard a strike is. */
  ['coins_per_lump', COINS_PER_LUMP], ['die_wear', DIE_WEAR], ['coin_difficulty', COIN_DIFFICULTY],
  /* Horseshoes: four to a mount, a week on, a share quicker on stone and a step higher. */
  ['shoes_per_mount', SHOES_PER_MOUNT], ['shoe_days', SHOE_DAYS], ['shoe_pace', SHOE_PACE], ['shoe_step', SHOE_STEP],
  /* And how long a tree stands at one age, in real seconds, and what it leaves. */
  ['tree_stage', TREE_STAGE], ['tree_seeds', TREE_SEEDS], ['tree_seed_reach', TREE_SEED_REACH],
  ['tree_seed_none', TREE_SEED_NONE], ['tree_seed_both', TREE_SEED_BOTH],
  ['tree_room_two', TREE_ROOM_TWO], ['tree_room_one', TREE_ROOM_ONE],
  /* And how many other people's settlements you may be a citizen of. */
  ['deeds_joined', DEEDS_JOINED], ['crowd_hides', CROWD_HIDES],
  /* And what a brush is worth, which the card had been claiming and no rule read. */
  ['care_bonus', CARE_BONUS],
  /* What a lump costs in ore, and what a lump of the rare six is worth against one. */
  ['ore_per_lump', ORE_PER_LUMP], ['rare_lump_factor', RARE_LUMP_FACTOR],
  ['tick_seconds', TICK_SECONDS], ['idle_logout', IDLE_LOGOUT], ['event_keep', EVENT_KEEP],
  ['change_keep', CHANGE_KEEP], ['island_keep', ISLAND_KEEP],
  ['tick_worlds', TICK_WORLDS], ['tick_players', TICK_PLAYERS], ['calls_a_minute', CALLS_A_MINUTE],
  ['walk_samples', WALK_SAMPLES], ['sweep_every', SWEEP_EVERY], ['sweep_rows', SWEEP_ROWS],
  ['region_size', REGION],
  /* And the side of the biggest square of land one ask may carry. */
  ['land_ask', LAND_ASK],
  /* And the square the land is read in, which is the browser's streaming square. */
  ['chunk_size', CHUNK],
  /* And the biggest island a tab may found, which is how the keeper tells a
     browser's island from the tool's. */
  ['found_max', FOUND_MAX], ['peace_reach', PEACE_REACH],
  /* And the slack that lets the creature box be looked up rather than scanned. */
  ['leg_slack', LEG_SLACK],
  /* And the most fog of war the island keeps for one body, so the one thing
     a browser writes by the yard cannot become free storage. */
  ['fog_bytes', FOG_BYTES],
  /*
   * And what keeping a body alive costs.
   *
   * The island owned the player and owned everything about them except this,
   * so nothing over there ever got hungry, tired or better — "thirst and
   * hunger reset to full on every client reset", because the browser was
   * moving its own copy and a refresh read one that had never moved.
   */
  /* And how far a wild thing drifts, and how long it stands between. */
  ['wild_reach', WILD_REACH], ['wild_rest', WILD_REST], ['wild_rest_spread', WILD_REST_SPREAD],
  ['hunger_rate', HUNGER_RATE], ['thirst_rate', THIRST_RATE],
  ['say_max', SAY_MAX], ['say_a_minute', SAY_A_MINUTE],
  ['wind_rest', WIND_REST], ['wind_walk', WIND_WALK], ['wind_per_level', WIND_PER_LEVEL],
  ['wind_starving', WIND_STARVING], ['heal_rate', HEAL_RATE], ['heal_fed', HEAL_FED],
  /*
   * And deep water, which the island kept two numbers for and never spent.
   *
   * `swim_wind` and `drown_rate` were crossed the day the body was and called
   * by nothing, so an island charged nothing for open water. The depth it
   * starts at and what a second of it teaches were literals in the browser,
   * which is fine while one side owns a rule and no use at all once both do.
   */
  ['swim_wind', SWIM_WIND], ['drown_rate', DROWN_RATE], ['exhausted', EXHAUSTED],
  ['swim_depth', SWIM_DEPTH], ['swim_learn', SWIM_LEARN], ['drown_warn', DROWN_WARN],
] as Array<[string, number]>) {
  out.push(`create or replace function ${fn}() returns double precision language sql immutable as $fn$ select ${q(v)}::double precision $fn$;`);
}
/*
 * What one go at a trade is worth, named once and read by both sides.
 *
 * These were seventeen literals written out twice — once in the browser and
 * once down here — and several of them had already drifted or been paid on the
 * wrong side of the roll. `try_gain` multiplies whichever of these applies by
 * one or by `try_learn`, so the only thing a call site decides is whether it
 * came off.
 */
for (const [fn, v] of [
  ['craft_head', CRAFT_HEAD], ['smith_gain', SMITH_GAIN], ['brew_gain', BREW_GAIN],
  ['improve_gain', IMPROVE_GAIN], ['restore_gain', RESTORE_GAIN], ['free_gain', FREE_GAIN],
  ['bandage_gain', BANDAGE_GAIN], ['clean_gain', CLEAN_GAIN],
  ['tame_gain', TAME_GAIN], ['tame_nerve', TAME_NERVE],
  ['swing_fight', SWING_FIGHT], ['swing_arm', SWING_ARM], ['swing_body', SWING_BODY],
  ['shot_fight', SHOT_FIGHT], ['shot_archery', SHOT_ARCHERY],
  ['rod_gain', ROD_GAIN], ['net_gain', NET_GAIN], ['breed_gain', BREED_GAIN],
] as Array<[string, number]>) {
  out.push(`create or replace function ${fn}() returns double precision language sql immutable as $fn$ select ${q(v)}::double precision $fn$;`);
}
/*
 * What a go of work teaches the body, and how dark it has to be before a fight
 * teaches you anything about noticing.
 *
 * Both lived in the browser and nowhere else, so on an island `body_control`
 * rose from nothing at all, `body_stamina` only from sleeping, and `awareness`
 * never — which is a body that digs for a week and is no stronger for it.
 */
for (const [fn, v] of [
  ['work_wind', WORK_WIND], ['work_wind_spent', WORK_WIND_SPENT], ['work_hand', WORK_HAND],
  ['night_eyes_from', NIGHT_EYES_FROM],
  ['dark_swing', DARK_SWING], ['dark_shot', DARK_SHOT], ['dark_hit', DARK_HIT],
] as Array<[string, number]>) {
  out.push(`create or replace function ${fn}() returns double precision language sql immutable as $fn$ select ${q(v)}::double precision $fn$;`);
}
/* How often a chip finds a line in the rock, and what a swing that misses teaches. */
for (const [fn, v] of [
  ['chip_chance', CHIP_CHANCE], ['try_learn', TRY_LEARN],
] as Array<[string, number]>) {
  out.push(`create or replace function ${fn}() returns double precision language sql immutable as $fn$ select ${q(v)}::double precision $fn$;`);
}
/* When a wildermon goes looking for food, and what a meal is worth. */
for (const [fn, v] of [
  ['graze_hungry', GRAZE_HUNGRY], ['graze_fill', GRAZE_FILL],
] as Array<[string, number]>) {
  out.push(`create or replace function ${fn}() returns double precision language sql immutable as $fn$ select ${q(v)}::double precision $fn$;`);
}
/*
 * What burns, and for how long.
 *
 * `fuel_value` was typed out by hand on this side, in three separate
 * migrations, beside a `FUEL_VALUES` in `campfire.ts` that said the same six
 * things. A number written twice is a number that drifts, and the drift this
 * one would produce is a browser offering the fire something the island will
 * not burn — so the browser lays the fuel, the island refuses, and what you
 * see is a fire that quietly will not take what you are holding.
 *
 * One table now, in the browser, generated down here.
 */
out.push(`create or replace function fuel_value(p_item text) returns double precision language sql immutable as $fn$
  select case p_item
${FUELS.map((f) => `    when ${q(f.id)} then ${q(f.secs)}`).join('\n')}
  end::double precision
$fn$;`);
out.push(`create or replace function fuel_said() returns text language sql immutable as $fn$ select ${q(FUEL_SAID)} $fn$;`);

/* What a brazier is: how much it holds, and how fast it goes by how well it was built. */
for (const [fn, v] of [
  ['brazier_capacity', BRAZIER_CAPACITY],
  ['brazier_burn_one', BRAZIER_BURN_AT_ONE], ['brazier_burn_hundred', BRAZIER_BURN_AT_HUNDRED],
] as Array<[string, number]>) {
  out.push(`create or replace function ${fn}() returns double precision language sql immutable as $fn$ select ${q(v)}::double precision $fn$;`);
}
/* What a hunt is: how often a map turns up, how far it points and how near you must stand. */
for (const [fn, v] of [
  ['map_odds', MAP_ODDS], ['map_kill_scale', MAP_KILL_SCALE], ['map_kill_cap', MAP_KILL_CAP],
  ['map_range', MAP_RANGE], ['unearth_reach', UNEARTH_REACH], ['map_snippet', MAP_SNIPPET],
  /* A stone in the rock, and what a worn one is worth. */
  ['gem_odds', GEM_ODDS], ['jewel_bonus', JEWEL_BONUS],
] as Array<[string, number]>) {
  out.push(`create or replace function ${fn}() returns double precision language sql immutable as $fn$ select ${q(v)}::double precision $fn$;`);
}
/* What a prayer is worth and what it takes; what a sitting is worth and how often. */
for (const [fn, v] of [
  ['favour_trickle', FAVOUR_TRICKLE], ['prayer_favour', PRAYER_FAVOUR], ['prayer_rest', PRAYER_REST],
  ['favour_ceiling', FAVOUR_CEILING], ['bless_cap', BLESS_CAP], ['bless_step', BLESS_STEP],
  ['choose_at', CHOOSE_AT], ['sit_rest', SIT_REST],
] as Array<[string, number]>) {
  out.push(`create or replace function ${fn}() returns double precision language sql immutable as $fn$ select ${q(v)}::double precision $fn$;`);
}
for (const w of WALL_TYPES) {
  out.push(`insert into wall_type_def values (${q(w.id)}, ${q(w.name)}, ${q(w.factor)}, ${q(w.passable)}, ${q(w.height ?? null)}, ${q(!!w.low)}, ${q(!!w.railed)}, ${q(!!w.standalone)});`);
  if (w.beastProof) out.push(`update wall_type_def set beast_proof = true where id = ${q(w.id)};`);
  for (const [item, n] of w.fittings ?? []) out.push(`insert into wall_fitting values (${q(w.id)}, ${q(item)}, ${q(n)});`);
}
for (const m of BUILD_MATERIALS) {
  out.push(`insert into build_material_def values (${q(m.id)}, ${q(m.name)}, ${q(m.kind)}, ${q(m.tool)}, ${q(m.skill)});`);
  m.bill.forEach(([item, n], ord) => out.push(`insert into build_material_bill values (${q(m.id)}, ${q(ord)}, ${q(item)}, ${q(n)});`));
}
for (const f of FISH) out.push(`insert into fish_def values (${q(f.id)}, ${q(f.name)}, ${q(f.depth)}, ${q(f.level)}, ${q(f.weight)});`);
for (const b of BAITS) {
  out.push(`insert into bait_def values (${q(b.id)}, ${q(b.note)});`);
  b.favours.forEach((fish, rank) => out.push(`insert into bait_favours values (${q(b.id)}, ${q(rank)}, ${q(fish)});`));
}
for (const c of CROP_LIST) {
  out.push(`insert into crop_def values (${q(c.id)}, ${q(c.name)}, ${q(c.seed)}, ${q(c.produce)}, ${q(c.stageSeconds)});`);
}
TREE_DEFS.forEach((t, i) => {
  out.push(`insert into tree_def values (${q(i)}, ${q(t.name)});`);
  if (t.fruit) out.push(`update tree_def set fruit = ${q(t.fruit)} where id = ${q(i)};`);
});
for (const a of TREE_AGES) {
  out.push(`insert into tree_age_def values (${q(a.id)}, ${q(a.name)}, ${q(a.hits)}, ${q(a.logs)}, ${q(a.bears)}, ${q(a.next)}, ${q(a.pruned)}, ${q(a.alive)});`);
}
SLAB_VARIANTS.forEach((v, i) => out.push(`insert into slab_def values (${q(i)}, ${q(v.name)}, ${q(v.item)});`));
for (const [item, v] of Object.entries(VESSELS)) {
  out.push(`insert into vessel_def values (${q(item)}, ${q(v.liquid)}, ${q(v.empty)});`);
}
for (const [id, name] of Object.entries(LIQUID_NAME)) {
  const l = id as LiquidKind;
  out.push(`insert into liquid_def values (${q(id)}, ${q(name)}, ${q(drinkable(l))}, ${q(isBrew(l))});`);
}
for (const id of WORMY) out.push(`update tile_def set wormy = true where id = ${q(id)};`);
for (const id of RICH_WORMS) out.push(`update tile_def set rich_worms = true where id = ${q(id)};`);
for (const id of DIGGABLE) out.push(`update tile_def set diggable = true where id = ${q(id)};`);
for (const r of RELICS) {
  out.push(`insert into relic_def values (${q(r.name)}, ${q(r.parts)}, ${q(r.result)}, ${q(r.difficulty)});`);
}
for (const t of TREASURE_TIERS) {
  out.push(`insert into treasure_def values (${q(t.id)}, ${q(t.ord)}, ${q(t.minQl)}, ${q(t.name)}, `
    + `${q(t.guard)}, ${q(t.guards)}, ${q(t.lumps)}, ${q(t.things)});`);
}
/*
 * `Infinity` is a number in TypeScript and is not one in Postgres's `real`, so
 * the last band — the one that catches everything left — is written as a
 * distance no island is wide rather than as infinity.
 */
MAP_BANDS.forEach((b, ord) => out.push(
  `insert into map_band values (${q(ord)}, ${q(Number.isFinite(b.within) ? b.within : 1e9)}, ${q(b.say)});`));
for (const t of Object.values(TRAPS)) {
  out.push(`insert into trap_def values (${q(t.id)}, ${q(t.name)}, ${q(t.difficulty)}, ${q(t.holds)}, `
    + `${q(t.reach)}, ${q(t.odds)}, ${q(t.lifeMin)}, ${q(t.lifeMax)}, ${q(!!t.water)}, ${q(t.hold ?? null)}, ${q(t.note)});`);
}
BUSH_DEFS.forEach((b, i) => {
  out.push(`insert into bush_def values (${q(i)}, ${q(b.name)});`);
  if (b.yields) out.push(`update bush_def set yields = ${q(b.yields)} where id = ${q(i)};`);
});
for (const [id, table] of [['forage', FORAGE_TABLE], ['botanize', BOTANIZE_TABLE]] as Array<[string, Array<[string, number]>]>) {
  for (const [item, weight] of table) out.push(`insert into loot_table values (${q(id)}, ${q(item)}, ${q(weight)});`);
}
ROCK_VARIANTS.forEach((r, i) => {
  const rock = r as unknown as A;
  out.push(`insert into rock_def values (${q(i)}, ${q(rock.name)}, ${q(rock.yields)}, ${q(rock.level ?? 1)}, `
    + `${q(String(rock.yields).endsWith('_ore'))}, ${q(isSeam(rock))});`);
});
for (const f of FURNITURE as unknown as A[]) {
  out.push(`insert into furniture_def values (${q(f.id)}, ${q(f.name)}, ${q(f.w)}, ${q(f.h)}, ${q(f.capacity)}, ${q(!!f.hearth)}, ${q(!!f.altar)});`);
  if (f.liquid !== undefined) out.push(`update furniture_def set liquid = ${q(f.liquid)} where id = ${q(f.id)};`);
  if (f.well !== undefined) out.push(`update furniture_def set well = ${q(f.well)} where id = ${q(f.id)};`);
  if (f.bulk) out.push(`update furniture_def set bulk = true where id = ${q(f.id)};`);
  if (f.bell) out.push(`update furniture_def set bell = true where id = ${q(f.id)};`);
  if (f.landmark) out.push(`update furniture_def set landmark = true where id = ${q(f.id)};`);
  if (f.hive !== undefined) out.push(`update furniture_def set hive = ${q(f.hive)} where id = ${q(f.id)};`);
  if (f.trash !== undefined) out.push(`update furniture_def set trash = ${q(f.trash)} where id = ${q(f.id)};`);
  if (f.bed !== undefined) out.push(`update furniture_def set bed = ${q(f.bed)} where id = ${q(f.id)};`);
  if (f.crates !== undefined) out.push(`update furniture_def set crates = ${q(f.crates)} where id = ${q(f.id)};`);
  if (f.cart) out.push(`update furniture_def set cart = true where id = ${q(f.id)};`);
  const v = f.vehicle as A | undefined;
  if (v) out.push(`insert into vehicle_def values (${q(f.id)}, ${q(v.yokes)}, ${q(v.needs)}, ${q(v.seat)});`);
  const b = f.boat as A | undefined;
  if (b) out.push(`insert into boat_def values (${q(f.id)}, ${q(b.speed)}, ${q(b.draught)}, ${q(b.seat)}, ${q(!!b.sail)});`);
}
TACK.forEach((id, ord) => out.push(`insert into tack_def values (${q(ord)}, ${q(id)});`));
for (const c of CASTS) {
  out.push(`insert into cast_def values (${q(c.id)}, ${q(c.name)}, ${q(c.cost)}, ${q(c.level)}, ${q(c.on)}, ${q(c.note)});`);
}
for (const b of Object.values(BRIDGES)) {
  out.push(`insert into bridge_def values (` + [q(b.id), q(b.name), q(b.span), q(b.tool),
    q(b.skill), q(b.difficulty), q(b.carts), q(b.note)].join(', ') + `);`);
  for (const [item, n] of b.bill) out.push(`insert into bridge_bill values (${q(b.id)}, ${q(item)}, ${q(n)});`);
}
for (const b of BREWS) {
  out.push(`insert into brew_def values (` + [q(b.id), q(b.name), q(b.input), q(b.count),
    q(b.litres), q(b.time), q(b.difficulty), q(b.done)].join(', ') + `);`);
}
for (const id of [...DYEABLE_ITEMS].sort()) out.push(`insert into dyeable_item values (${q(id)});`);
for (const cls of ['cloth', 'leather']) out.push(`insert into dyeable_class values (${q(cls)});`);
for (const [tier, level] of Object.entries(TIER_LEVEL)) {
  out.push(`update tier_odds set level = ${q(level)} where tier = ${q(tier)};`);
}
for (const path of PATH_LIST) {
  out.push(`insert into path_def values (${q(path.id)}, ${q(path.name)}, ${q(path.note)});`);
  path.steps.forEach((step, n) => out.push(`insert into path_step values (` + [
    q(path.id), q(n + 1), q(step.at), q(step.name), q(step.note),
    q(step.ability?.id ?? null), q(step.ability?.rest ?? null), q(step.ability?.note ?? null)].join(', ') + `);`));
}
for (const r of RECIPES) {
  out.push(`insert into recipe (id, result, count, tool, station, skill, label, verb, base_time, stamina, difficulty, consume_on_fail, ql_from_inputs, material, wood, extra, done, fail) values (` +
    [q(r.id), q(r.result), q(r.count ?? 1), q(r.tool), q(r.station), q(r.skill), q(r.label), q(r.verb),
     q(r.baseTime), q(r.stamina), q(r.difficulty === undefined ? null : r.difficulty),
     q(!!r.consumeOnFail), q(!!r.qlFromInputs), q(r.material), q(r.wood), q(r.extra), q(r.done), q(r.fail)].join(', ') + `);`);
  r.inputs.forEach((i, n) => {
    out.push(`insert into recipe_input values (${q(r.id)}, ${n}, ${q(i.item)}, ${q(i.count ?? 1)});`);
  });
  for (const [item, count] of r.returns ?? []) {
    out.push(`insert into recipe_gives values (${q(r.id)}, ${q(item)}, ${q(count)}, 'return');`);
  }
  for (const [item, count] of r.salvage ?? []) {
    out.push(`insert into recipe_gives values (${q(r.id)}, ${q(item)}, ${q(count)}, 'salvage');`);
  }
}
console.log(out.join('\n'));
