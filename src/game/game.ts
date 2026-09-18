import { generateWorld } from '../world/generate';
import { EMOTES, EMOTE_BY_ID } from './emotes';
import { brazierBurn } from './placeables';
import type { Hoard } from './treasure';
import { packTreeData, TILE_DEFS, TileType, TREE_DEFS, TREE_AGES, TREE_ROOM_ONE, TREE_ROOM_TWO, TREE_SEED_BOTH, TREE_SEED_NONE, TREE_SEED_REACH, TREE_SEEDS, lastDawn, treeAge, treeSpecies, LAWN_AFTER, mownDays, mownToday } from '../world/tiles';
import { oreAt } from '../world/ore';
import { World } from '../world/world';
import { ACTIONS, ACTION_BY_ID, TRY_LEARN, type ActionDef, type Target } from './actions';
import { aimPin, BELT_MAX, loopsFor, pinLabel, type BeltPin } from './belt';
import { bodyForward } from '../net/felt';
import type { ItemRow } from '../net/island';
import { packed, type Aged } from '../net/packed';
import { DROWN_RATE, DROWN_WARN, EXHAUSTED, HEAL_FED, HEAL_RATE, HUNGER_RATE, SWIM_LEARN, SWIM_WIND, THIRST_RATE, WIND_PER_LEVEL, WIND_REST, WIND_STARVING, WIND_WALK } from './body';
import { markName, MARK_CAP, MARK_COLOURS, type Marker } from './marks';
import { Buildings, connectsDown, floorKind, isDone, MAX_LEVELS, walkableKind, type BuildingsJSON, type Building, type Wall, type Side } from './building';
import { crateCentre, crateName, crateCapacity, crateUnits, subtileOf, type CrateKind, type PlacedCrate } from './crates';
import { anvilAnchor, anvilCovers, ANVIL_SUBTILES, type PlacedAnvil } from './anvil';
import { fireAnchor, fireCentre, fireCovers, FIRE_SUBTILES, type PlacedCampfire } from './campfire';
import { smelterAnchor, smelterCentre, smelterCovers, SMELTER_H, SMELTER_W, type PlacedSmelter, type SmeltJob } from './smelter';
import { kilnAnchor, kilnCovers, KILN_SUBTILES, type PlacedKiln } from './kiln';
import { furnitureAnchor, furnitureCapacity, furnitureCentre, furnitureCovers, furnitureDef, furnitureRefuses, furnitureUnits, hiveRoom, rackDeck, rackSpots, teamOf, vehicleOf, type LiquidKind, type PlacedFurniture, furnitureName, LIQUID_NAME, isBoat, furnitureFootprint } from './furniture';
import { cropDef, RIPE, type Crop } from './farming';
import { ageDef, bloodMul, CALL_WINDOW, Creatures, FIGHT_BACK_GOES, HAUL_SKILL, isBaitFor, isShod, PLAYER_ATTACKER, SHOE_PACE, SHOE_STEP, type Creature, type CreatureJSON, type Stance } from './creatures';
import { knackable, type Station } from './recipes';
import { Actor, type ActiveAction, type GuestSave } from './actor';
import { HOST_ID, type PeerId } from '../net/protocol';
import { Roster } from './roster';
import { GameEmitter, type LogEntry, type LogKind } from './events';
import { bagTake, groundDecayRate, Inventory, ITEM_DEFS, itemName, type Item, rarityOf, itemDef } from './items';
import { BASE_SPEED, CLIMB_PER_LEVEL, groundStep, MAX_STAND, MAX_STEP, Player, readPlayer, standsOn, writePlayer, SWIM_DEPTH, SWIM_SPEED } from './player';
import { randomLook, type Look } from './look';
import { ACTION_FLOOR, ACTION_PACE, world } from './pace';
import { ARMOUR_BY_ID, ARMOUR_CLASSES, HIT_LOCATIONS, pieceBurden, pieceSoak, SHIELDS, WEAPON_BY_ID, type Slot } from './gear';
import { boonOf, boonTime, BOON_BONUS, clockLeft, REST_CAP, REST_MULT, REST_PER_SECOND, type Boon } from './boons';
import { cleanSaid } from './chat';
import { ALL_GOALS } from './journal';
import { matOf, rollEase, workingQl } from './materials';
import { postCentre, postDecayRate, postName, postRadius, postSite, type PlacedPost } from './posts';
import { catchChance, CHECK_EVERY, trapCentre, trapDecayRate, trapHolds, trapName, TRAPS, type PlacedTrap, type TrapKind } from './traps';
import { BAIT_BY_ID, fishHere, pickFish, waterDepth } from './fishing';
import { BRIDGES, bridgeDone, CLEARANCE, END_SLOP, spanBill, spanTiles, type Bridge, type BridgeKind } from './bridges';
import { liveSettings, type Settings } from './settings';
import { Skills, SKILL_DEFS } from './skills';
import { gemOf, JEWEL_BONUS } from './gems';
import { earnedBy, knackBonus, knackLands, KNACK_CAP, KNACK_ODDS, TITLE_BY_ID } from './titles';
import { TileIndex } from './tileindex';
import { DARK_HIT, NIGHT_EYES_FROM, WORK_HAND, WORK_WIND, WORK_WIND_SPENT, HEAVY_SKILLS, WORK_BACK } from './learn';
import { AWARENESS, Vision } from './vision';
import { blessBonus, favourCap, FAITH, FAVOUR_TRICKLE } from './faith';
import { hasStep, MEDITATION, type PathId } from './meditation';
import { ledgerTotals, record, type Ledger } from './ledger';
import { FIRE_REACH, heldReach, HELD_LIGHTS, lanternReach, OVEN_REACH, type LightSource } from './light';
import { helpingOf, NUTRIENTS, NUTRIENT_DECAY, NUTRIENT_NAMES, tableMul, upkeepMul, type Nutrient } from './nutrition';
import { sailFactor, sailWord, windAt, windFrom, windWord, type Wind } from './wind';
import { festerChance, PART_NAMES, woundClose, woundDrain, WOUND_KINDS, woundText, type Wound, type WoundKind } from './wounds';

export type { ActiveAction } from './actor';

/** A settlement: a square of land around a token that the player may build on. */
/** One place on the deed that holds things, whatever it is underneath. */
export interface DeedStore {
  x: number;
  y: number;
  centre: [number, number];
  items: Item[];
  name: string;
  /** The settlement's own crate, which a worker fills before any other. */
  deed: boolean;
  /** Whether this would take the thing being carried. */
  room(item: Item): boolean;
  add(item: Item): boolean;
  /** Tell the windows something in here changed. */
  changed(): void;
}

export interface Deed {
  name: string;
  x: number;
  y: number;
  radius: number;
  /** Upgrades bought so far; level 1 is a freshly founded settlement. */
  level?: number;
  /** Standing orders for every wildermon kept here. */
  stance?: Stance;
  /**
   * Whether this one is yours.
   *
   * On an island somebody else's settlement is a thing you can see and walk
   * around and may not build on — so the browser has to hold it, and has to
   * know the difference. False here means the token in the ground belongs to
   * somebody else; absent means the single-player game, where it is always
   * yours because there is only you.
   */
  mine?: boolean;
}

export const DEED_RADIUS = 5;
/** Every upgrade pushes the border out this far and takes on one more worker. */
export const DEED_RADIUS_PER_LEVEL = 2;
export const DEED_WORKERS_AT_LEVEL_ONE = 1;
export const MAX_DEED_LEVEL = 5;
/**
 * How many settlements you may be a citizen of, besides the one you founded.
 *
 * One deed is yours: you planted the stake, you pay for the upgrades, you are
 * the one who can disband it. Beyond that a person can belong to other
 * people's land — help build it, keep things in its crates, work its fields —
 * and three is enough to be a neighbour, a partner and a guest without the
 * word *citizen* ceasing to mean anything.
 */
export const DEEDS_JOINED = 3;

/**
 * How many people have to be about before the island stops saying where
 * everybody is.
 *
 * A list of every body on the island with a position beside it is a radar, and
 * `rpc_social` has said so in a comment since the day it was written: your
 * friends' whereabouts, and everybody else's name and nothing more. That is
 * the right rule for a place with people in it.
 *
 * It is the wrong rule for an empty one. On four thousand tiles with a
 * half-dozen ashore you can play for a week and never learn that anybody else
 * exists, and the thing a new island needs most is for its handful of people
 * to run into each other. So while there are fewer than this many about,
 * everybody is on the map, with their name on them.
 *
 * A headcount rather than a switch, deliberately: a switch is a thing somebody
 * has to remember to turn off, and this turns itself off on the day it stops
 * being true. The Social window says which side of the line the island is on,
 * so the day it changes is a thing people read rather than notice.
 */
export const CROWD_HIDES = 20;

/**
 * Following somebody: how often to think about it, how close is close enough,
 * and how far off is gone.
 *
 * Twice a second rather than every frame, because re-pathing sixty times a
 * second to the same tile is a walk that restarts before it takes a step.
 * Two tiles is close enough to talk and near enough that it reads as
 * following rather than as treading on somebody. And forty is the distance
 * at which they are somebody else's problem — past it a follow is a walk
 * across the island with no arrival, and it should end saying so rather than
 * quietly going on.
 */
export const FOLLOW_EVERY = 0.5;
export const FOLLOW_CLOSE = 2;
export const FOLLOW_LOSE = 40;

export const deedLevel = (d: Deed | null): number => Math.max(1, Math.min(MAX_DEED_LEVEL, d?.level ?? 1));
export const deedRadiusAt = (level: number): number => DEED_RADIUS + (level - 1) * DEED_RADIUS_PER_LEVEL;
export const deedWorkersAt = (level: number): number => DEED_WORKERS_AT_LEVEL_ONE + (level - 1);

/**
 * UI questions the game needs; main.ts wires them to the interface.
 *
 * Both answer with a promise, because both used to be `window.prompt` and
 * `window.confirm` and neither of those is a dialogue on a phone: Chrome on
 * Android suppresses them in more cases than it documents, and once anybody
 * has dismissed one with "don't let this page create more dialogs" every
 * later call returns null and false, silently, for the rest of the session.
 * What that looks like from the outside is a game that ignores you.
 */
export interface GameHooks {
  prompt: (question: string, fallback: string) => Promise<string | null>;
  confirm: (question: string) => Promise<boolean>;
}

export interface GameInit {
  seed: number;
  world: World;
  /** When the woods were last turned over, in real seconds. */
  treesAt?: number;
  spawn: { x: number; y: number };
  deed?: Deed | null;
  buildings?: BuildingsJSON;
  creatures?: { nextId: number; list: CreatureJSON[]; banked?: Array<[number, number]> };
  crates?: PlacedCrate[];
  /** Pre-crate-grid saves kept a single deed crate. */
  crate?: { x: number; y: number; items: Item[] } | null;
  campfires?: PlacedCampfire[];
  smelters?: PlacedSmelter[];
  kilns?: PlacedKiln[];
  furniture?: PlacedFurniture[];
  posts?: PlacedPost[];
  traps?: PlacedTrap[];
  nextTrapId?: number;
  bridges?: Bridge[];
  nextBridgeId?: number;
  tally?: Record<string, number>;
  ledger?: Ledger;
  ticked?: string[];
  anvils?: PlacedAnvil[];
  crops?: Crop[];
  marks?: Marker[];
  hoards?: Hoard[];
  player?: { x: number; y: number; name: string; stats: Player['stats']; level?: number; equipped?: Record<string, number | null>; rested?: number; boons?: Boon[]; knacks?: Record<string, number>; nutrition?: Record<Nutrient, number>;
  /** What knacks were called before they were called knacks. */
  affinities?: Record<string, number>; titles?: string[]; title?: string | null; wounds?: Wound[]; nextWound?: number; favour?: number; prayedAt?: number; way?: PathId | null; satAt?: number; usedAt?: Record<string, number>; belt?: Array<BeltPin | null>; look?: Look };
  inventory?: Item[];
  nextUid?: number;
  ground?: Record<string, Item[]>;
  skills?: Record<string, number>;
  time?: number;
  /** The island's guest book: everybody who has visited, and what they had. */
  guests?: GuestSave[];
}

/** Skills picked up by doing something else, which do not narrate themselves. */
const QUIET_SKILLS = new Set(['climbing', 'swimming']);
/** Actions you can hold in your head before any mind logic is earned. */
const BASE_QUEUE = 3;
/** Where every characteristic starts, and so what counts as a point gained. */
const CHAR_START = 20;
/** Ashes left per second of burning: a log's worth of fire leaves about five. */
const ASH_RATE = 1 / 120;
/** Damage at which a tool starts warning you, and every five points after. */
const DAMAGE_WARN = 75;
/** No team takes a vehicle faster than this, whatever is in the traces. */
const MAX_VEHICLE_SPEED = 4;
/** How far ahead of the shafts a hitched team walks. */
const TRACE_LENGTH = 1.6;
/** How fast a wildermon in the traces works its dinner off while hauling. */
const HAUL_HUNGER = 0.0006;
/** Steepest ground a green team will take a wheel up, against a walker's limit. */
const VEHICLE_STEP = MAX_STEP / 2;
/** Height units of extra slope every point of a beast's climbing is worth. */
const CLIMB_PITCH = 0.16;
/** No mount carries a rider faster than this. */
const MAX_MOUNT_SPEED = 5;
/** What practice on bad ground is worth: nothing at all to half again. */
const footing = (climb: number): number => 0.9 + climb / 140;
/** Tiles to a side of a new island. */
export const WORLD_SIZE = 1024;
/**
 * The island the keeper serves: 4096 tiles a side.
 *
 * Sixteen kilometres across and 268 km2, against the one square kilometre a
 * 256-tile island covers. It is affordable because nothing about it travels:
 * the land is a pure function of the seed and every browser works out the
 * ground it is standing on, so what a join costs is the same on a big island
 * as on a small one. `docs/tile-map-cost-analysis.md` is the arithmetic.
 *
 * The single-player island in this browser keeps `WORLD_SIZE`. It is a
 * different thing with a different life — it lives in IndexedDB, it is rolled
 * by `generate.ts` rather than from the survey chart, and making everybody's
 * saved island sixteen times bigger is not a change anybody asked for.
 */
export const ISLAND_SIZE = 4096;
/**
 * A day and a night, in seconds.
 *
 * At the world's pace, which is the most visible thing about slowing that
 * clock: an hour of real time to the day now, and twenty-five minutes of dark
 * in it rather than ten. It has to move with everything else or the whole
 * point is lost — a crop that took a third of a day to ripen would take most
 * of one, and every "twice a day" thing in the game would quietly become once.
 *
 * It also keeps the lights honest. A torch was five minutes against a
 * ten-minute night; it is twelve and a half against a twenty-five minute one,
 * which is the same half a night it always was.
 */
export const DAY_SECONDS = world(1440);
/** When the sun comes up and goes down, in game hours. */
export const DAWN = 6;
export const DUSK = 20;
const FORAGE_COOLDOWN = world(180);
/**
 * How dark it has to be before a fight teaches you anything about noticing.
 * Dusk is not night: a scuffle at seven in the evening is still fought by eye.
 */
/**
 * The things a single tile can be worked over for, each with its own
 * cooldown: picking berries does not stop you cutting the grass.
 */
const FORAGE_KINDS = ['forage', 'botanize', 'grass', 'reed', 'dig'];
/** How long ore stays lit after prospecting. */
const PROSPECT_MARK_TIME = 120;
const MAX_LOG = 400;
/** Seconds between ground decay passes while playing. */
const DECAY_STEP = 5;
/** Ground a sprout will take, which is the same ground a tree grows on. */
/** How far a prospector moves on before reading the ground again. */
const PROSPECT_STRIDE = 4;

export const PLANTABLE = new Set<number>([TileType.Grass, TileType.Dirt, TileType.Lawn, TileType.Steppe, TileType.Tundra, TileType.Moss]);

/** Central simulation state: the world, the player and everything they do. */
/** What a back takes before it tells on you, in kilos, and what each point of body strength adds. */
export const CARRY_BASE = 120;
export const CARRY_PER_STRENGTH = 5;

export class Game {
  readonly seed: number;
  readonly world: World;
  /** Where you wake up: the shore you came in on until a bed says otherwise. */
  spawn: { x: number; y: number };
  /**
   * Whoever is acting at this instant: their body, their pack, their skills.
   *
   * These were `readonly` and pointed at the one person on the island. They
   * still point at one person — they are simply no longer always the same
   * person. Everything that reads them reads them exactly as it always did;
   * `as()` decides who that is, and puts it back afterwards. See `actor.ts`
   * for why it was done this way round and not the other.
   */
  player: Player;
  inventory: Inventory;
  skills: Skills;
  /** Everyone with a body on this island, by who they are on the wire. */
  readonly actors = new Map<PeerId, Actor>();
  /**
   * The guest book: everyone who has ever set foot here, and what they had
   * when they left.
   *
   * Filed by a durable name the visitor keeps on their own machine, not by
   * the number they are given when they connect — that is handed out fresh
   * every session and would make everyone a stranger every time. Somebody who
   * comes back finds their pack where they left it, their skills where they
   * earned them, and themselves standing where they logged out.
   */
  readonly guestbook = new Map<string, GuestSave>();
  /** Whoever is playing on this machine. Never changes for the life of a game. */
  readonly local: Actor;
  /** Whoever `player`, `inventory` and `skills` are pointing at this instant. */
  private acting: Actor;
  readonly events = new GameEmitter();
  readonly log: LogEntry[] = [];
  /**
   * What the person sitting here likes, which is theirs rather than the
   * island's — see `settings.ts`. They put themselves away as they are
   * changed, so a refresh comes back to the view you left.
   */
  readonly settings: Settings = liveSettings();
  /**
   * Everything placed, filed by the tile it stands on. The renderer asks what
   * is on a tile for every tile it draws, so these are what keep that from
   * being a walk of every crate and every stick of furniture in the world.
   */
  readonly placed = {
    crates: new TileIndex<PlacedCrate>(),
    campfires: new TileIndex<PlacedCampfire>(),
    smelters: new TileIndex<PlacedSmelter>(),
    kilns: new TileIndex<PlacedKiln>(),
    furniture: new TileIndex<PlacedFurniture>(),
    anvils: new TileIndex<PlacedAnvil>(),
    posts: new TileIndex<PlacedPost>(),
    traps: new TileIndex<PlacedTrap>(),
  };
  /**
   * The other people on the island, when there are any. Empty on a world
   * nobody else is in, which is every world until somebody opens one up, so
   * everything that reads it can ask once and skip.
   */
  readonly roster = new Roster();
  /**
   * Hoards in the ground, by the map that points at each.
   *
   * On an island this is `treasure`, a table nothing may read. Here it is in
   * the save, which hides nothing — a single-player island is the player's own
   * machine and always was. What makes it a hunt is the picture, not the
   * secrecy: the map shows you a stretch of country and you go and look.
   */
  hoards: Hoard[] = [];

  /** Names pinned to spots on the island, and the next id to give one. */
  readonly marks: Marker[] = [];
  private nextMarkId = 1;
  readonly buildings: Buildings;
  /** What can be seen from where you are, and what is only remembered. */
  readonly vision: Vision;
  readonly creatures: Creatures;
  deed: Deed | null = null;
  /** Work posts by id; each stands on one subtile off the deed. */
  readonly posts = new Map<number, PlacedPost>();
  readonly traps = new Map<number, PlacedTrap>();
  nextTrapId = 1;
  /** Game time a fair wind holds until; the weather does as it is told till then. */
  favourWind = -1e9;
  readonly bridges = new Map<number, Bridge>();
  nextBridgeId = 1;
  /** Tile key to the bridge whose deck covers it, rebuilt whenever one changes. */
  private deckIndex = new Map<string, number>();
  private nextPostId = 1;
  /**
   * A running count of things done: felled trees, landed fish, brews set
   * going. Nothing in the game reads these but the journal, which is the
   * only place that knows there is anything worth doing.
   */
  readonly tally: Record<string, number> = {};
  /** Everything ever made: how many, and the best one. */
  readonly ledger: Ledger = {};
  /** Goals already ticked off, which stay ticked whatever happens after. */
  readonly ticked = new Set<string>();
  /**
   * Who to tell when one is ticked, on an island. Nothing here off one.
   *
   * The journal reads the book, the pack, the ground and what is standing on
   * it, all of which the island keeps and this side draws — so the *reading*
   * stays here and the record goes over. Eighty-five predicates are eighty-five
   * ports for another day; a list of ids is one column.
   */
  tickedGoal?: (id: string) => void;
  /**
   * Whether the journal is worth reading yet.
   *
   * True by itself, because a browser playing alone has its journal the moment
   * it has loaded one. On an island it is the island's, and the first beat is
   * a second away — so until that lands, this side is holding an empty tally
   * and no ticks, and every goal already met would be announced again on every
   * refresh. Nothing is lost by waiting a second for the book.
   */
  journalReady = true;
  private journalAt = -1e9;

  /** Note that something was done, once. */
  note(key: string, n = 1): void {
    this.tally[key] = (this.tally[key] ?? 0) + n;
  }

  /**
   * Write a finished thing into the ledger, and say so when it is the best of
   * its kind you have ever managed. A first one is worth saying too: it is the
   * only time you will ever make your first of anything.
   */
  madeIt(id: string, ql: number, count = 1, rare = 0): void {
    const had = this.ledger[id];
    const before = had?.best ?? 0;
    const rec = record(this.ledger, id, ql, count, rare, this.time);
    this.note('made');
    this.note(`made:${id}`);
    const name = itemDef(id).name.toLowerCase();
    if (!had) this.logMsg(`The first ${name} you have ever made. (Ledger, J)`, 'skill');
    else if (rec.best > before + 0.05 && rec.n > 1) this.logMsg(`The best ${name} you have made: QL ${rec.best.toFixed(1)}, over ${before.toFixed(1)}.`, 'skill');
  }

  /** What the ledger adds up to. */
  ledgerTotals(): ReturnType<typeof ledgerTotals> {
    return ledgerTotals(this.ledger);
  }

  /**
   * Look over the journal for anything newly done. Only the goals still open
   * are tested, and only now and again, so a list of fifty costs nothing.
   */
  private checkJournal(): void {
    // The journal belongs to the person at this screen, and is written down in
    // their save. A guest's mining skill is not the host's progress, and a
    // guest has no journal of their own yet — so theirs ticks nothing.
    if (this.acting !== this.local) return;
    if (!this.journalReady) return;
    if (this.time - this.journalAt < 2) return;
    this.journalAt = this.time;
    for (const goal of ALL_GOALS) {
      if (this.ticked.has(goal.id)) continue;
      let met = false;
      try {
        met = goal.met(this);
      } catch {
        met = false;
      }
      if (!met) continue;
      this.ticked.add(goal.id);
      // And the island keeps the record of it, so that done stays done through
      // a refresh. An island session never saves — `main.ts` starts the save
      // loop behind `if (!island)` — so until now every tick was a thing this
      // tab knew and nothing else did.
      this.tickedGoal?.(goal.id);
      this.logMsg(`Journal: ${goal.text.toLowerCase()}. (${this.ticked.size} of ${ALL_GOALS.length})`, 'skill');
      this.events.emit('journal');
    }
  }

  /** Placed crates by id; each sits on one subtile. */
  readonly crates = new Map<number, PlacedCrate>();
  nextCrateId = 1;
  /** Campfires by id; each covers a two by two block of subtiles. */
  readonly campfires = new Map<number, PlacedCampfire>();
  nextFireId = 1;
  /** Smelters by id; each covers six subtiles. */
  readonly smelters = new Map<number, PlacedSmelter>();
  nextSmelterId = 1;
  /** Kilns by id; each covers four subtiles. */
  readonly kilns = new Map<number, PlacedKiln>();
  nextKilnId = 1;
  /** Furniture by id; each covers the block of subtiles its kind takes. */
  readonly furniture = new Map<number, PlacedFurniture>();
  nextFurnitureId = 1;
  /** Anvils by id; each covers four subtiles. */
  readonly anvils = new Map<number, PlacedAnvil>();
  nextAnvilId = 1;
  /** Crops growing on tilled fields, keyed by "x,y". */
  readonly crops = new Map<string, Crop>();
  /** Tiles a prospector has marked, and when the marks fade. */
  prospected: { tiles: Set<number>; until: number } | null = null;
  hooks: GameHooks = { prompt: async (_q, fallback) => fallback, confirm: async () => true };
  /** What the acting person is in the middle of, and what is behind it. */
  get action(): ActiveAction | null {
    return this.acting.action;
  }

  set action(a: ActiveAction | null) {
    this.acting.action = a;
  }

  /**
   * Set by a `perform` that swung and did not land, read once by the gain
   * above and cleared there. On the row rather than a return value because
   * `perform` already uses its return to say whether to go round again.
   */
  /**
   * When the woods were last turned over, in real seconds.
   *
   * Real seconds and not the world's own faster hours: a stage was asked for as
   * a real life day, so a tree planted on a Tuesday is a young tree on
   * Wednesday whether or not this tab was open for any of it.
   */
  treesAt = Date.now() / 1000;

  private swingMissed = false;

  /** Said by a `perform` whose swing found nothing. */
  missed(): void {
    this.swingMissed = true;
  }

  /** Actions lined up behind the one in hand, oldest first. */
  get queue(): Array<{ def: ActionDef; target: Target; goes?: number; was?: string }> {
    return this.acting.queue;
  }
  /** Items lying on tiles, keyed by "x,y". */
  readonly ground = new Map<string, Item[]>();
  /** Game seconds since the world was created. */
  time = 0;

  /**
   * What time it is on the island, when there is one, in seconds since it
   * began. Null in the game you play by yourself, where this browser's own
   * count is the only clock there is.
   *
   * "Day and night only seem to change on client refresh." This is why. The
   * hour used to be `time`, and `time` is added up a frame at a time — with a
   * frame capped at a tenth of a second, so that a tab coming back from a
   * stall does not walk anybody a minute across the island in one step. Every
   * scrap of real time past that cap is gone, and a tab that is not being
   * drawn at all gets no frames to cap. So on a phone the clock fell behind by
   * most of the session, and the one thing that ever put it right was a reload
   * reading the hour again.
   *
   * A seam rather than a number, filled in by `play.ts`, because what is
   * behind it is the island's own reading pinned against a monotonic clock —
   * and a monotonic clock keeps running while a tab is asleep.
   */
  islandClock: (() => number) | null = null;
  rand: () => number = Math.random;
  private foraged = new Map<number, number>();

  private decayClock = 0;

  /**
   * The guest book as it stands, with everybody currently on the island
   * written into it as they are this instant.
   *
   * A record is normally filed when somebody leaves, which is the moment their
   * pack stops changing. But a host who saves and then closes the tab never
   * sees anybody leave, and the evening four guests just spent filling their
   * packs would go with the tab. So a save asks, and everybody still standing
   * here is written down mid-sentence.
   */
  guestRecords(): GuestSave[] {
    const out = new Map(this.guestbook);
    for (const actor of this.actors.values()) if (actor !== this.local) out.set(actor.who, this.guestSave(actor));
    return [...out.values()];
  }

  /** Everything of a visitor's that outlives their visit. */
  private guestSave(actor: Actor): GuestSave {
    return {
      who: actor.who,
      body: writePlayer(actor.player),
      items: actor.inventory.items,
      skills: actor.skills.toJSON(),
      seen: Date.now(),
    };
  }

  static create(seed: number, size = WORLD_SIZE): Game {
    const gen = generateWorld(seed, size);
    const game = new Game({ seed, world: gen.world, spawn: gen.spawn });
    // Somebody, rather than the same somebody every time. An account replaces
    // this with whatever was chosen on the landing page; a browser that has
    // never seen one still gets a face of its own.
    game.player.look = randomLook();
    game.giveStarterKit();
    // A new island is stocked on the books; what is near the player takes a
    // body on the first streaming pass, and the rest waits to be walked to.
    game.creatures.stockIsland(game);
    game.logMsg('Welcome to Wildermon. You wash ashore on an untouched island with a few tools and your wits.', 'system');
    game.logMsg('Left-click to walk — it is the only thing that moves you. Right-click a tile for actions. WASD or the arrows push the view about, scroll to zoom. Settings (O) has a Keys tab if you would rather they did something else. Press F1 for help.', 'system');
    return game;
  }

  constructor(init: GameInit) {
    this.seed = init.seed;
    this.world = init.world;
    this.spawn = init.spawn;
    this.player = new Player(init.player?.x ?? init.spawn.x + 0.5, init.player?.y ?? init.spawn.y + 0.5);
    if (init.player) readPlayer(this.player, init.player);
    this.hoards = init.hoards ?? [];
    for (const m of init.marks ?? []) {
      this.marks.push(m);
      if (m.id >= this.nextMarkId) this.nextMarkId = m.id + 1;
    }
    this.inventory = new Inventory(init.inventory, init.nextUid);
    this.inventory.onChange = () => this.events.emit('inventory');
    if (init.ground) {
      for (const [key, items] of Object.entries(init.ground)) {
        if (items.length) this.ground.set(key, items);
        for (const it of items) if (it.uid >= this.inventory.nextUid) this.inventory.nextUid = it.uid + 1;
      }
    }
    this.skills = new Skills(init.skills);
    for (const g of init.guests ?? []) {
      if (!g || typeof g.who !== 'string') continue;
      this.guestbook.set(g.who, g);
      // A visitor's numbers are the island's numbers. Nothing made while they
      // are away may be given a number one of their things is already wearing,
      // or the two become one the evening they walk back in.
      for (const it of g.items ?? []) if (it.uid >= this.inventory.nextUid) this.inventory.nextUid = it.uid + 1;
    }
    // The one person a single-player island has. On a shared one they are the
    // host, which is the same thing said differently.
    this.local = new Actor(HOST_ID, 'local', this.player, this.inventory, this.skills);
    this.local.hear = (text, kind) => this.write(text, kind);
    this.local.packed = () => this.events.emit('inventory');
    this.acting = this.local;
    // News about a person only reaches this screen when it is about the person
    // at it.
    this.events.mine = () => this.acting === this.local;
    this.actors.set(this.local.id, this.local);
    // A new castaway washes ashore at eight in the morning, not at midnight.
    this.time = init.time ?? (8 / 24) * DAY_SECONDS;
    /*
     * And the woods' own clock, which is a real one.
     *
     * A save that has never held it starts from now rather than from nothing:
     * a world opened for the first time should not find its whole forest a
     * lifetime overdue on the first pass.
     */
    this.treesAt = init.treesAt ?? Date.now() / 1000;
    this.deed = init.deed ?? null;
    this.buildings = Buildings.fromJSON(init.buildings);
    this.creatures = Creatures.fromJSON(init.creatures);
    for (const c of init.crates ?? []) {
      this.crates.set(c.id, c);
      if (c.id >= this.nextCrateId) this.nextCrateId = c.id + 1;
    }
    if (init.crate && !this.crates.size) this.addCrate('plank', init.crate.x, init.crate.y, 1, 1, init.crate.items, true);
    for (const f of init.campfires ?? []) {
      this.campfires.set(f.id, f);
      if (f.id >= this.nextFireId) this.nextFireId = f.id + 1;
    }
    for (const c of init.crops ?? []) this.crops.set(`${c.x},${c.y}`, c);
    for (const k of init.kilns ?? []) {
      this.kilns.set(k.id, k);
      if (k.id >= this.nextKilnId) this.nextKilnId = k.id + 1;
    }
    for (const f of init.furniture ?? []) {
      this.furniture.set(f.id, f);
      if (f.id >= this.nextFurnitureId) this.nextFurnitureId = f.id + 1;
    }
    Object.assign(this.tally, init.tally ?? {});
    Object.assign(this.ledger, init.ledger ?? {});
    for (const id of init.ticked ?? []) this.ticked.add(id);
    for (const p of init.posts ?? []) {
      this.posts.set(p.id, p);
      this.placed.posts.add(p);
      if (p.id >= this.nextPostId) this.nextPostId = p.id + 1;
    }
    for (const t of init.traps ?? []) {
      this.traps.set(t.id, t);
      this.placed.traps.add(t);
      if (t.id >= this.nextTrapId) this.nextTrapId = t.id + 1;
    }
    if (init.nextTrapId) this.nextTrapId = Math.max(this.nextTrapId, init.nextTrapId);
    for (const b of init.bridges ?? []) {
      this.bridges.set(b.id, b);
      if (b.id >= this.nextBridgeId) this.nextBridgeId = b.id + 1;
    }
    if (init.nextBridgeId) this.nextBridgeId = Math.max(this.nextBridgeId, init.nextBridgeId);
    if (this.bridges.size) this.reindexDecks();
    for (const s of init.smelters ?? []) {
      this.smelters.set(s.id, s);
      if (s.id >= this.nextSmelterId) this.nextSmelterId = s.id + 1;
    }
    for (const a of init.anvils ?? []) {
      this.anvils.set(a.id, a);
      if (a.id >= this.nextAnvilId) this.nextAnvilId = a.id + 1;
    }
    // Everything that came out of the save still has to be filed by tile.
    this.placed.crates.reset(this.crates.values());
    this.placed.campfires.reset(this.campfires.values());
    this.placed.smelters.reset(this.smelters.values());
    this.placed.kilns.reset(this.kilns.values());
    this.placed.furniture.reset(this.furniture.values());
    this.placed.anvils.reset(this.anvils.values());
    // Which beast is in which traces is the vehicle's business, so it is read
    // back off the vehicles rather than saved twice and left to disagree.
    for (const f of this.furniture.values()) {
      if (!f.team?.length) continue;
      f.team = f.team.filter((id) => this.creatures.get(id));
      for (const id of f.team) {
        const c = this.creatures.get(id);
        if (c) c.hitchedTo = f.id;
      }
      if (!f.team.length) f.driven = false;
    }
    this.vision = new Vision(this);
    this.world.onChange((x, y) => {
      // Felling a tree or raising a wall changes what can be seen past it.
      this.vision.invalidate();
      this.events.emit('world', x, y);
    });
  }

  giveStarterKit(): void {
    // Everything here is marked as issued: rough gear off the beach, good
    // enough to get a first tool made with and not worth working on. Copper
    // heads on pine handles, which is the poorest of everything: the first
    // bronze tool you cast for yourself is already better than any of it.
    for (const [id, ql, made] of [
      ['hatchet', 20, 'Copper'],
      ['shovel', 20, 'Copper'],
      ['pickaxe', 20, 'Copper'],
      ['carving_knife', 20, 'Copper'],
      ['chisel', 15, 'Copper'],
      ['mallet', 20, 'Pine'],
      ['trowel', 20, 'Copper'],
      ['saw', 20, 'Copper'],
      ['butchering_knife', 20, 'Copper'],
      ['rake', 20, 'Copper'],
      ['water_skin', 30, ''],
    ] as Array<[string, number, string]>) {
      this.inventory.add(id, { ql, issued: true, extra: made || undefined });
    }
    this.inventory.add('deed_stake', { ql: 50, extra: 'Pine' });
  }

  /** Whether the player can stand on a tile at a storey: the ground, or a finished floor, staircase or ladder. */
  standable(x: number, y: number, level: number): boolean {
    if (!this.world.isPassable(x, y)) return false;
    if (level <= 0) return true;
    const f = this.buildings.floor(level, x, y);
    return !!f && isDone(f) && walkableKind(floorKind(f));
  }

  /** A finished staircase or ladder occupying a tile's floor slot at a storey. */
  private connector(x: number, y: number, level: number): boolean {
    const f = this.buildings.floor(level, x, y);
    return !!f && isDone(f) && connectsDown(floorKind(f));
  }

  /**
   * The one rule for moving between neighbouring tiles: stepping onto a
   * staircase or ladder from below takes you up a storey, stepping off one
   * can take you down, walls of the storey you cross on block you, and on
   * the ground cliffs do too. Returns the storey you arrive on or null.
   */
  readonly stepRule = (x0: number, y0: number, level: number, x1: number, y1: number): number | null => {
    const b = this.buildings;
    if (this.connector(x1, y1, level + 1) && !b.blocksAt(level, x0, y0, x1, y1)) return level + 1;
    // Deck is ground: it is flat, and the drop under it is not your problem.
    if (level === 0 && this.bridges.size && this.bridgeStep(x0, y0, x1, y1)) return 0;
    if (this.standable(x1, y1, level) && !b.blocksAt(level, x0, y0, x1, y1)) {
      if (level === 0 && (!groundStep(this.world, x0, y0, x1, y1, this.climbStep()) || !standsOn(this.world, x1, y1, this.standSlope()))) return null;
      return level;
    }
    if (level > 0 && this.connector(x0, y0, level) && this.standable(x1, y1, level - 1) && !b.blocksAt(level - 1, x0, y0, x1, y1)) {
      return level - 1;
    }
    return null;
  };

  /**
   * The rule for driving rather than walking. Wheels keep to the open ground:
   * no fords, no stairs, no climbing anything a horse would baulk at.
   */
  readonly driveRule = (x0: number, y0: number, level: number, x1: number, y1: number): number | null => {
    if (level !== 0) return null;
    // A wooden bridge or a stone arch carries wheels; a rope bridge does not.
    if (this.bridges.size && this.bridgeStep(x0, y0, x1, y1)) {
      const b = this.bridgeAt(x1, y1) ?? this.bridgeAt(x0, y0);
      if (!b || !BRIDGES[b.kind].carts) return null;
      // Coming off the deck onto the bank: the bank still has to take wheels.
      if (!this.bridgeAt(x1, y1) && !this.vehicleGround(x1, y1)) return null;
      return 0;
    }
    if (!this.vehicleGround(x1, y1)) return null;
    if (this.buildings.blocksAt(0, x0, y0, x1, y1)) return null;
    // Wheels get the bare cap: no team makes a cart stand on a wall.
    return groundStep(this.world, x0, y0, x1, y1, this.vehicleStep(this.driving())) && standsOn(this.world, x1, y1) ? 0 : null;
  };

  /**
   * The rule for riding. A mount takes a slope a walker would balk at, the
   * better the further it has been worked, but it will not swim and it will
   * not go indoors.
   */
  readonly rideRule = (x0: number, y0: number, level: number, x1: number, y1: number): number | null => {
    const up = this.mounted();
    if (!up || level !== 0) return null;
    if (!this.world.inBounds(x1, y1) || !this.world.isPassable(x1, y1)) return null;
    // Only the web-footed sort will take a rider into deep water.
    if (!this.creatures.species(up).swims && this.world.heightAt(x1 + 0.5, y1 + 0.5) < -SWIM_DEPTH) return null;
    if (this.buildings.blocksAt(0, x0, y0, x1, y1)) return null;
    return groundStep(this.world, x0, y0, x1, y1, this.mountStep(up)) && standsOn(this.world, x1, y1, this.mountStand(up)) ? 0 : null;
  };

  /**
   * The rule for being afloat. A hull goes where there is water enough under
   * it and nowhere else: no beaching, no dragging it over a sandbar, and
   * nothing indoors.
   */
  readonly sailRule = (_x0: number, _y0: number, level: number, x1: number, y1: number): number | null => {
    const boat = this.afloat();
    if (!boat || level !== 0) return null;
    const def = furnitureDef(boat.kind).boat;
    if (!def || !this.world.inBounds(x1, y1)) return null;
    return -this.world.centerHeight(x1, y1) >= def.draught ? 0 : null;
  };

  /** The boat the player is sitting in, if any. */
  afloat(): PlacedFurniture | undefined {
    const f = this.driving();
    return f && isBoat(f) ? f : undefined;
  }

  /** The wind at this hour, worked out from the clock rather than stored. */
  wind(): Wind {
    const w = windAt(this.seed, this.time);
    // A fair wind is still the weather; it has only been asked to oblige.
    if (this.time < this.favourWind) return { dir: this.heading(), force: Math.max(0.62, w.force) };
    return w;
  }

  /** Where the player is pointed, in the same radians the wind uses. */
  heading(): number {
    const p = this.player;
    return Math.atan2(p.dirY, p.dirX);
  }

  /**
   * How fast the hull goes: the build, the arms behind it, and — under sail —
   * the weather and the angle you are holding to it.
   */
  boatSpeed(f: PlacedFurniture): number {
    const def = furnitureDef(f.kind).boat;
    if (!def) return 0;
    // Oars are worked by the body; a sail is worked by the weather, and the
    // best you can do is hold the angle that suits her.
    const body = def.sail ? 0.9 + this.skills.get('body_control') / 320 : 0.6 + this.skills.get('body_strength') / 150;
    const hull = 0.75 + f.ql / 220;
    const weather = def.sail ? sailFactor(this.heading(), this.wind()) : 1;
    // What is in the hold rides on the hull, and the hull feels it: a boat
    // loaded to her marks is a third slower than one running empty.
    const cap = furnitureCapacity(f);
    const load = cap ? Math.min(1, furnitureUnits(f) / cap) : 0;
    return def.speed * body * hull * weather * (1 - load * 0.33);
  }

  /**
   * Whether a step of the chosen path is behind you. Everything the paths give
   * is asked for here, so nothing else has to know how they are counted.
   */
  walks(way: 'love' | 'knowledge' | 'power', step: number): boolean {
    return this.player.way === way && hasStep(this.player.way, this.skills.get(MEDITATION), step);
  }

  /** Work one of the abilities a path opens. Returns what it did, for the log. */
  workAbility(id: string): string {
    const p = this.player;
    switch (id) {
      case 'refresh':
        p.stats.hunger = 1;
        p.stats.thirst = 1;
        return 'You are neither hungry nor thirsty, and cannot say when that happened.';
      case 'mendflesh': {
        const n = p.wounds.length;
        p.wounds = [];
        p.stats.health = Math.min(1, p.stats.health + 0.4);
        return n === 1 ? 'The wound closes and the ache goes with it.' : n ? `All ${n} of them close and the ache goes with them.` : 'There was nothing to mend, and you feel better anyway.';
      }
      case 'sense': {
        const found = this.senseRock(15);
        return found ? `The ground gives up what is in it: ${found} seams within fifteen tiles, marked.` : 'There is nothing under this ground but rock.';
      }
      case 'recall': {
        if (!this.deed) return 'You have nowhere to be recalled to.';
        this.player.stop();
        this.player.x = this.deed.x + 0.5;
        this.player.y = this.deed.y + 1.5;
        this.events.emit('world', this.deed.x, this.deed.y);
        return `You are standing at the token of ${this.deed.name}, and the walk is simply not in your legs.`;
      }
      case 'secondwind':
        p.stats.stamina = 1;
        return 'Your wind comes back all at once.';
      case 'fury':
        this.furyUntil = this.time + 30;
        return 'For half a minute nothing you swing at is going to enjoy it.';
      default:
        return 'Nothing happens.';
    }
  }

  /** Game time the fury runs out at. */
  furyUntil = -1e9;
  /** What everything you hit takes, over what it would take. */
  furyMult(): number {
    return this.time < this.furyUntil ? 2 : 1;
  }

  /** Mark every seam within a radius as read, as a prospector would. */
  private senseRock(radius: number): number {
    const px = this.player.tileX;
    const py = this.player.tileY;
    const tiles: number[] = [];
    for (let y = py - radius; y <= py + radius; y++) {
      for (let x = px - radius; x <= px + radius; x++) {
        if (!this.world.inBounds(x, y) || Math.hypot(x - px, y - py) > radius) continue;
        if (oreAt(this.world, x, y)) tiles.push(y * this.world.w + x);
      }
    }
    this.markProspected(tiles);
    if (tiles.length) this.events.emit('world', px, py);
    return tiles.length;
  }

  /** Bring every crop on the settlement on one stage, and say how many. */
  hastenCrops(): number {
    let n = 0;
    for (const crop of this.crops.values()) {
      if (!this.onDeed(crop.x, crop.y)) continue;
      if (crop.stage >= RIPE) continue;
      crop.stage += 1;
      crop.stageAt = this.time;
      crop.tendedNow = false;
      this.events.emit('world', crop.x, crop.y);
      n++;
    }
    return n;
  }

  /** What the wind is doing, and what the hull under you makes of it. */
  sailNote(): string {
    const w = this.wind();
    const from = `${windWord(w.force)} out of the ${windFrom(w)}`;
    const boat = this.afloat();
    const def = boat && furnitureDef(boat.kind).boat;
    if (!def?.sail) return from;
    return `${from} \u00b7 ${sailWord(this.heading(), w)}`;
  }

  /** Water deep enough to float this hull, near where the player is standing. */
  launchSpot(kind: string, x: number, y: number): boolean {
    const def = furnitureDef(kind).boat;
    return !!def && this.world.inBounds(x, y) && -this.world.centerHeight(x, y) >= def.draught;
  }

  /** How the player may move right now, and how many storeys they may cross. */
  movement(): { rule: (x0: number, y0: number, level: number, x1: number, y1: number) => number | null; levels: number } {
    if (this.afloat()) return { rule: this.sailRule, levels: 1 };
    if (this.driving()) return { rule: this.driveRule, levels: 1 };
    if (this.mounted()) return { rule: this.rideRule, levels: 1 };
    return { rule: this.stepRule, levels: MAX_LEVELS };
  }

  /** Height of the player's feet, storeys included. */
  playerHeight(): number {
    return this.world.heightAt(this.player.x, this.player.y) + this.player.visualLevel * 30;
  }

  /**
   * Whose border you are standing in, when it is not your own.
   *
   * Drawn, and used to say why the ground will not take a building — never to
   * light anything, which is the whole distinction this pair exists for.
   */
  neighbourDeeds: Array<{ name: string; x: number; y: number; radius: number; level: number; holder: string | null; mine?: boolean }> = [];

  /**
   * Everybody else ashore, as of the last slow read.
   *
   * Only those with an `x` on them can be drawn, and whether anybody has one
   * is the island's call rather than this machine's: while fewer than
   * `CROWD_HIDES` are about it says where everybody is, and after that it says
   * where your friends are and no more.
   */
  folkAshore: Array<{ uid: string; name: string; online: boolean; x?: number; y?: number }> = [];

  /** The neighbour whose settlement covers this tile, if one does. */
  deedAt(x: number, y: number): { name: string; holder: string | null } | null {
    for (const d of this.neighbourDeeds) {
      if (Math.abs(x - d.x) <= d.radius && Math.abs(y - d.y) <= d.radius) return d;
    }
    return null;
  }

  /**
   * Every settlement this body may work: its own, and any it was asked into.
   *
   * The island has held a list since citizens landed — `deeds_of` is founder
   * first, citizen otherwise, and `deed_here` asks it about a tile. This
   * browser held one deed and one only: `ground.deed` is `my_deed`, which is
   * the *first* of that list. For anybody who founded a stake of their own and
   * was then asked onto somebody else's, the one it held was their own, and
   * every rule that asked "is this my land" said no while standing in the
   * middle of the settlement they are a citizen of. Reported from the island:
   * "i'm a citizen of your deed but i'm unable to place down a smelter."
   *
   * `ground.deeds` has carried the rest all along, each marked `mine` — it was
   * drawn on the map and read by nothing else.
   */
  myDeeds(): Deed[] {
    const out: Deed[] = [];
    if (this.deed) out.push(this.deed);
    for (const d of this.neighbourDeeds) if (d.mine) out.push(d);
    return out;
  }

  /** Which settlement of ours covers this tile, when one does. */
  deedOfMineAt(x: number, y: number): Deed | null {
    for (const d of this.myDeeds()) {
      if (Math.abs(x - d.x) <= d.radius && Math.abs(y - d.y) <= d.radius) return d;
    }
    return null;
  }

  onDeed(x: number, y: number): boolean {
    return !!this.deedOfMineAt(x, y);
  }

  /**
   * On the one settlement this browser calls its own, and no other.
   *
   * What an upgrade is counted against. `onDeed` is "may I work here" and is
   * rightly the whole list; this is "does this count towards *this* token",
   * and a crate on a settlement you are a citizen of does not buy the founder
   * of another one their next level.
   */
  onOwnDeed(x: number, y: number): boolean {
    const d = this.deed;
    return !!d && Math.abs(x - d.x) <= d.radius && Math.abs(y - d.y) <= d.radius;
  }

  /** The settlement's upgrade level, 1 when freshly founded. */
  get deedLevel(): number {
    return deedLevel(this.deed);
  }

  /** How many wildermon may work the deed at this level. */
  get workerCap(): number {
    return deedWorkersAt(this.deedLevel);
  }

  /** The token tile of any settlement of ours — nobody builds on one. */
  isToken(x: number, y: number): boolean {
    return this.myDeeds().some((d) => d.x === x && d.y === y);
  }

  insideBuilding(): Building | undefined {
    return this.buildings.buildingAt(this.player.tileX, this.player.tileY);
  }

  /** Why a tile cannot take a building plan, or null when it can. */
  planReason(x: number, y: number): string | null {
    if (!this.onDeed(x, y)) return 'You may only build on your own deed.';
    if (this.isToken(x, y)) return 'The settlement token stands here.';
    if (this.buildings.buildingAt(x, y)) return 'That tile is already part of a building.';
    if (this.world.getTile(x, y) !== TileType.PackedDirt) return 'Buildings need flat packed dirt. Pack the tile first.';
    if (this.world.slope(x, y) !== 0) return 'The tile must be perfectly flat. Flatten it first.';
    if (this.world.hasWater(x, y)) return 'You cannot build in water.';
    if (this.groundAt(x, y).length) return 'Clear away the items lying there first.';
    return null;
  }

  /**
   * How many actions you can hold in your head at once, the one in hand
   * included: three to start with, and one more for every ten points of mind
   * logic above where you began.
   */
  queueCapacity(): number {
    if (this.remoteCap !== null) return this.remoteCap;
    return BASE_QUEUE + Math.floor(Math.max(0, this.skills.get('mind_logic') - CHAR_START) / 10);
  }

  /** Body control quickens every action; the effect is small but it is always there. */
  controlSpeed(): number {
    return Math.max(0.6, 1 - (this.skills.get('body_control') - CHAR_START) * 0.003);
  }

  /** Body stamina makes the same work cost less wind; armour makes it dearer. */
  staminaCost(cost: number): number {
    const body = Math.max(0.45, 1 - (this.skills.get('body_stamina') - CHAR_START) * 0.0045);
    return cost * body * (1 + this.burden());
  }

  /** Mind logic takes the edge off a difficult craft, though never more than half of it. */
  mindEase(): number {
    return Math.max(0, (this.skills.get('mind_logic') - CHAR_START) * 0.2);
  }

  /** The orders every wildermon on the deed works under. */
  deedStance(): Stance {
    return this.deed?.stance ?? 'defensive';
  }

  /** Give every wildermon kept here the same orders. */
  setDeedStance(stance: Stance): void {
    if (!this.deed) return;
    this.deed.stance = stance;
    let n = 0;
    for (const c of this.creatures.list.values()) {
      if (c.mode !== 'deed' && c.mode !== 'stored') continue;
      c.stance = stance;
      c.enemy = null;
      n++;
    }
    this.logMsg(`The wildermon of ${this.deed.name} are set to ${stance}${n ? `; ${n} of them take the word` : ''}.`, 'system');
    this.events.emit('creature');
  }

  /** The best food you are carrying, for the eat button. */
  bestFood(): Item | undefined {
    let best: Item | undefined;
    for (const it of this.inventory.items) {
      if (!ITEM_DEFS[it.id]?.food) continue;
      if (!best || it.ql > best.ql) best = it;
    }
    return best;
  }

  /** The poorest thing your companion will eat, for the feed button: keep the good stuff. */
  worstFoodFor(c: Creature): Item | undefined {
    const def = this.creatures.species(c);
    let worst: Item | undefined;
    for (const it of this.inventory.items) {
      if (!def.diet.includes(it.id)) continue;
      if (!worst || it.ql < worst.ql) worst = it;
    }
    return worst;
  }

  /** The item in a slot, if anything is there and still in the pack. */
  worn(slot: Slot): Item | undefined {
    const uid = this.player.equipped[slot];
    if (uid === null || uid === undefined) return undefined;
    const item = this.inventory.get(uid);
    if (!item) {
      this.player.equipped[slot] = null;
      return undefined;
    }
    return item;
  }

  isEquipped(uid: number): boolean {
    return Object.values(this.player.equipped).some((v) => v === uid);
  }

  /** Whether the thing in hand takes both of them. */
  twoHandedInHand(): boolean {
    const held = this.worn('weapon');
    return !!held && !!WEAPON_BY_ID.get(held.id)?.twoHanded;
  }

  /** Put something on or take it off; a two-handed weapon pushes the shield away. */
  equip(slot: Slot, uid: number | null): void {
    const before = this.worn(slot);
    this.player.equipped[slot] = uid;
    const item = uid === null ? undefined : this.inventory.get(uid);
    if (uid !== null && slot === 'weapon' && item && WEAPON_BY_ID.get(item.id)?.twoHanded && this.worn('offhand')) {
      const shield = this.worn('offhand');
      this.player.equipped.offhand = null;
      if (shield) this.logMsg(`You need both hands for that, so the ${itemName(shield).toLowerCase()} goes on your back.`, 'info');
    }
    if (item) this.logMsg(`You ${slot === 'weapon' || slot === 'offhand' ? 'take up' : 'put on'} the ${itemName(item).toLowerCase()}.`, 'info');
    else if (before) this.logMsg(`You put the ${itemName(before).toLowerCase()} away.`, 'info');
    this.events.emit('inventory');
  }

  /**
   * How many loops the belt you are wearing has: one for every ten points of
   * how well it was made, and none at all when you are not wearing one. A belt
   * worn to pieces is still a belt, so damage does not take loops away.
   */
  beltLoops(): number {
    const belt = this.worn('belt');
    return belt ? loopsFor(belt.ql) : 0;
  }

  /** Hang a job on a loop. */
  pinToBelt(loop: number, pin: BeltPin): void {
    if (loop < 0 || loop >= BELT_MAX) return;
    this.player.belt[loop] = pin;
    const def = ACTION_BY_ID.get(pin.action);
    this.logMsg(`${pinLabel(pin, def)} goes on loop ${loop + 1}.`, 'info');
    this.events.emit('inventory');
  }

  /** The first empty loop within reach, or -1 when they are all full. */
  freeLoop(): number {
    const loops = this.beltLoops();
    for (let i = 0; i < loops; i += 1) if (!this.player.belt[i]) return i;
    return -1;
  }

  /** Take a job off a loop. */
  clearLoop(loop: number): void {
    if (loop < 0 || loop >= BELT_MAX || !this.player.belt[loop]) return;
    this.player.belt[loop] = null;
    this.events.emit('inventory');
  }

  /** What a loop would do right now, for drawing the bar and for pressing it. */
  aimLoop(loop: number, where: Target | null): { pin: BeltPin; def: ActionDef; target: Target; reason: string | null } | null {
    const pin = this.player.belt[loop];
    if (!pin || loop >= this.beltLoops()) return null;
    const def = ACTION_BY_ID.get(pin.action);
    if (!def) return null;
    const aim = aimPin(this, pin, def, where);
    if (!aim) return { pin, def, target: { kind: 'tile', x: this.player.tileX, y: this.player.tileY, cx: this.player.tileX, cy: this.player.tileY }, reason: `You carry no ${itemName({ uid: 0, id: pin.item ?? '', ql: 1, dmg: 0, count: 1 }).toLowerCase()}.` };
    return { pin, def, target: aim.target, reason: aim.reason };
  }

  /** Press a loop: do what hangs on it, where you are pointing. */
  useLoop(loop: number, where: Target | null): void {
    if (!this.beltLoops()) {
      this.logMsg('You are wearing no toolbelt, so there is nothing to hang a job on.', 'error');
      return;
    }
    const aim = this.aimLoop(loop, where);
    if (!aim) {
      this.logMsg(`Loop ${loop + 1} is empty.`, 'error');
      return;
    }
    if (aim.reason) {
      this.logMsg(aim.reason, 'error');
      return;
    }
    this.requestAction(aim.def, aim.target);
  }

  /** Ask for the name this action wants, then start it again carrying one. */
  private async askName(def: ActionDef, target: Target, goes?: number): Promise<void> {
    const asks = def.asks;
    if (!asks) return;
    const said = await this.hooks.prompt(asks.question, asks.fallback?.(target, this) ?? '');
    const name = said === null ? null : said.trim().slice(0, asks.max ?? 32);
    if (name === null || (!name && !asks.allowEmpty)) {
      if (asks.declined) this.logMsg(asks.declined, 'info');
      return;
    }
    this.requestAction(def, { ...target, name } as unknown as Target, goes);
  }

  /** Ask whether to go ahead, then start it again with the answer on it. */
  private async askSure(def: ActionDef, target: Target, goes: number | undefined, question: string): Promise<void> {
    if (!(await this.hooks.confirm(question))) return;
    this.requestAction(def, { ...target, sure: true } as unknown as Target, goes);
  }

  /**
   * Pin a name to a spot. The colour is chosen from the small list in
   * `marks.ts`; past the cap the oldest mark is pushed off, since a map with
   * a hundred pins on it is a map with none.
   */
  addMark(x: number, y: number, name: string, colour = MARK_COLOURS[0].id): Marker {
    const mark: Marker = { id: this.nextMarkId++, name: markName(name, x, y), x, y, colour };
    this.marks.push(mark);
    while (this.marks.length > MARK_CAP) this.marks.shift();
    this.logMsg(`You mark ${mark.name} on the map at (${x}, ${y}).`, 'info');
    this.events.emit('world', x, y);
    return mark;
  }

  removeMark(id: number): void {
    const i = this.marks.findIndex((m) => m.id === id);
    if (i < 0) return;
    const [gone] = this.marks.splice(i, 1);
    this.logMsg(`You rub ${gone.name} off the map.`, 'info');
    this.events.emit('world', gone.x, gone.y);
  }

  renameMark(id: number, name: string): void {
    const mark = this.marks.find((m) => m.id === id);
    if (!mark) return;
    mark.name = markName(name, mark.x, mark.y);
    this.events.emit('world', mark.x, mark.y);
  }

  /** Nearest mark to a spot, for saying where something is. */
  markNear(x: number, y: number, within = 4): Marker | undefined {
    let best: Marker | undefined;
    let close = within;
    for (const m of this.marks) {
      const d = Math.hypot(m.x - x, m.y - y);
      if (d <= close) {
        close = d;
        best = m;
      }
    }
    return best;
  }

  /**
   * Where home is: the settlement token when there is one, the bed you last
   * woke in otherwise. Somewhere to walk back to without hunting the map.
   */
  home(): { x: number; y: number; name: string } | null {
    if (this.deed) return { x: this.deed.x, y: this.deed.y, name: this.deed.name };
    if (this.spawn) return { x: this.spawn.x, y: this.spawn.y, name: 'where you wake' };
    return null;
  }

  /** Set off for home, saying so. Returns false when there is nowhere to go. */
  /**
   * Somebody you are walking after.
   *
   * Entirely on this machine. The island is not told and has nothing to be
   * told: following is a series of ordinary walks, and every one of them goes
   * through `rpc_move` like any other step. There is no rule over there that
   * would read it and nothing it could refuse.
   */
  private followed: { uid: string; name: string } | null = null;
  private followTick = 0;
  /** The tile we last set off for, so a stationary target is not re-pathed at. */
  private followTile: { x: number; y: number } | null = null;

  /**
   * Whether you are following somebody in particular, or anybody at all.
   *
   * Both questions, because both get asked: the menu wants to know whether
   * *this* row is the one you are following, and Escape only wants to know
   * whether there is anything to stop.
   */
  following(uid?: string): boolean {
    return uid === undefined ? this.followed !== null : this.followed?.uid === uid;
  }

  /** Walk after somebody until one of you stops it. Asking twice stops it. */
  follow(uid: string, name: string): void {
    if (this.followed?.uid === uid) {
      this.unfollow(`You stop following ${name}.`);
      return;
    }
    this.followed = { uid, name };
    this.followTile = null;
    this.followTick = FOLLOW_EVERY;
    this.logMsg(`You follow ${name}. Move anywhere yourself, or press Escape, to stop.`, 'info');
  }

  unfollow(why?: string): void {
    if (!this.followed) return;
    this.followed = null;
    this.followTile = null;
    if (why) this.logMsg(why, 'info');
  }

  /**
   * Keep up, a few times a second rather than every frame.
   *
   * Re-pathing at sixty frames a second would be sixty paths a second to the
   * same tile and a walk that restarts before it takes a step. So: only when
   * the clock comes round, and then only when they have actually moved off the
   * tile we set out for or we have arrived and stopped.
   */
  private updateFollow(dt: number): void {
    const f = this.followed;
    if (!f) return;
    this.followTick += dt;
    if (this.followTick < FOLLOW_EVERY) return;
    this.followTick = 0;
    const who = this.roster.list().find((p) => p.uid === f.uid);
    if (!who) {
      this.unfollow(`You have lost sight of ${f.name}.`);
      return;
    }
    const away = Math.hypot(who.x - this.player.x, who.y - this.player.y);
    if (away > FOLLOW_LOSE) {
      this.unfollow(`${f.name} is too far off to follow.`);
      return;
    }
    // Close enough. Stand still rather than shuffling into them, and stay
    // following, because they will move again.
    if (away <= FOLLOW_CLOSE) {
      if (this.followTile) {
        this.player.stop();
        this.followTile = null;
      }
      return;
    }
    const tx = Math.floor(who.x);
    const ty = Math.floor(who.y);
    if (this.followTile && this.followTile.x === tx && this.followTile.y === ty && this.player.moving) return;
    this.followTile = { x: tx, y: ty };
    // `moveTo` says so itself when there is no way through, so this does not.
    if (!this.moveTo(tx, ty, true)) this.unfollow();
  }

  walkHome(): boolean {
    const h = this.home();
    if (!h) {
      this.logMsg('You have nowhere to call home yet. Plant a settlement token, or sleep in a bed.', 'error');
      return false;
    }
    const away = Math.round(Math.hypot(h.x + 0.5 - this.player.x, h.y + 0.5 - this.player.y));
    if (away < 2) {
      this.logMsg(`You are at ${h.name} already.`, 'info');
      return true;
    }
    // moveTo says so itself when there is no way through.
    if (!this.moveTo(h.x, h.y)) return false;
    this.logMsg(`You set off for ${h.name}, ${away} tiles off.`, 'info');
    return true;
  }

  /** Everything worn, as pieces of armour. */
  private wornArmour(): Array<{ slot: Slot; item: Item; def: (typeof ARMOUR_BY_ID) extends Map<string, infer V> ? V : never }> {
    const out = [];
    for (const slot of ['head', 'chest', 'arms', 'legs', 'feet'] as Slot[]) {
      const item = this.worn(slot);
      const def = item && ARMOUR_BY_ID.get(item.id);
      if (item && def) out.push({ slot, item, def });
    }
    return out;
  }

  /**
   * What you can carry before it tells on you: `CARRY_BASE` kilos, and
   * `CARRY_PER_STRENGTH` more for every point of body strength. Nothing stops
   * you going over it; going over it simply costs. Asked for: "change base kg
   * players can carry to 120kg, increased 5kg per body strength point" — it
   * was forty and most of a kilo. The island does not read this: what you are
   * carrying is the browser's to weigh, and the drag of it is drawn here.
   */
  carryLimit(): number {
    return CARRY_BASE + this.skills.get('body_strength') * CARRY_PER_STRENGTH;
  }

  /** How far past the limit you are, 0 when you are inside it. */
  overloaded(): number {
    const over = this.inventory.totalWeight() - this.carryLimit();
    return over > 0 ? over : 0;
  }

  /** How much armour and a full pack slow you down and tire you. */
  burden(): number {
    let sum = 0;
    for (const { def, item } of this.wornArmour()) sum += pieceBurden(def, item);
    const shield = this.worn('offhand');
    const sh = shield && SHIELDS[shield.id];
    if (sh) sum += sh.burden;
    // Everything past what your back will take is carried at a price, and the
    // price climbs: twice your limit is not twice as bad, it is worse.
    const over = this.overloaded();
    if (over > 0) sum += Math.min(1.2, (over / this.carryLimit()) * 1.1);
    // A strong back carries the same steel, and the same load, for a fifth less.
    return this.walks('power', 1) ? sum * 0.8 : sum;
  }

  /**
   * Take a blow. The hit lands somewhere, whatever is worn there turns some of
   * it aside and wears a little for doing so, and the armour learns from it.
   * A shield in the off hand may stop the whole thing first.
   */
  absorb(raw: number): { taken: number; part: Slot; worn: Item | null; blocked: boolean } {
    // The shield, first of all.
    const shield = this.worn('offhand');
    const sh = shield && SHIELDS[shield.id];
    if (sh) {
      const chance = Math.min(0.6, sh.block * (0.6 + shield.ql / 160) + this.skills.get('shields') / 400);
      this.gainSkill('shields', 0.12);
      if (this.rand() < chance) {
        shield.dmg = Math.min(100, shield.dmg + raw * 3);
        this.gainSkill('shields', 0.5);
        this.events.emit('inventory');
        return { taken: 0, part: 'offhand', worn: shield, blocked: true };
      }
    }
    // Then wherever it lands.
    let roll = this.rand();
    let part: Slot = 'chest';
    for (const [slot, share] of HIT_LOCATIONS) {
      roll -= share;
      if (roll <= 0) {
        part = slot;
        break;
      }
    }
    const item = this.worn(part);
    const def = item && ARMOUR_BY_ID.get(item.id);
    if (!item || !def) return { taken: raw, part, worn: null, blocked: false };
    const skillId = ARMOUR_CLASSES[def.cls].skill;
    const soak = pieceSoak(def, item, this.skills.get(skillId));
    // Armour is learned by being hit in it, and worn out the same way.
    this.gainSkill(skillId, 0.4);
    item.dmg = Math.min(100, item.dmg + raw * 4);
    if (item.dmg >= 100) {
      this.inventory.remove(item.uid, 1);
      this.player.equipped[part] = null;
      this.logMsg(`Your ${itemName(item).toLowerCase()} is beaten to pieces and falls away.`, 'fight');
    }
    this.events.emit('inventory');
    const hide = this.walks('power', 5) ? 1.1 : 1;
    return { taken: raw * (1 - Math.min(0.92, soak * hide)), part, worn: item, blocked: false };
  }

  /**
   * Hurt the player through their armour, and say what happened. What gets
   * through is not only a number off the bar: it leaves a wound, of a kind,
   * in whichever place the blow landed, and that wound has its own life.
   */
  hurtPlayer(raw: number, what: string, kind: WoundKind = 'bite'): void {
    // Being hit in the dark teaches more about watching than hitting does.
    this.fought(DARK_HIT);
    const hit = this.absorb(raw);
    if (hit.blocked) {
      this.player.attackedAt = this.time;
      this.events.emit('hit', this.player.x, this.player.y, 0, 'taken');
      this.logMsg(`You take ${what} on your ${itemName(hit.worn as Item).toLowerCase()}.`, 'fight');
      this.fightBack();
      return;
    }
    this.player.stats.health = Math.max(0, this.player.stats.health - hit.taken);
    this.player.attackedAt = this.time;
    this.events.emit('hit', this.player.x, this.player.y, hit.taken, 'taken');
    const wound = this.wound(kind, hit.part, hit.taken);
    const where = hit.worn ? `, though your ${itemName(hit.worn).toLowerCase()} takes the worst of it` : '';
    this.logMsg(`${what}${where}. You have ${woundText(wound)}.`, 'fight');
    this.fightBack();
  }

  /**
   * Turn on whatever just bit you.
   *
   * Asked for: "players automatically attack back when attacked". Whoever
   * hurt you was marked before the blow (`attackedBy`); if it is something
   * wild and you are not already swinging at it, whatever was in hand goes to
   * the front of the line to be picked up again after, and you swing at it
   * `FIGHT_BACK_GOES` times or until the first refusal — dead, gone, out of
   * reach — ends the run. A companion that nipped you, a body with no wind
   * left, a thing already dead, are no fight. Reach is not asked here: the
   * bite is the proof of it, and every go of the swing asks again. The island
   * does the same in `fight_back`, off the same number and the same guards,
   * so a bite on an island turns you the same way.
   */
  private fightBack(): void {
    const id = this.player.attackedBy;
    if (id === null || id === PLAYER_ATTACKER || this.player.stats.health <= 0) return;
    if (this.player.stats.stamina < EXHAUSTED) return;
    const c = this.creatures.get(id);
    if (!c || c.mode !== 'wild' || c.health <= 0) return;
    if (this.action?.def.id === 'attack_creature' && this.action.target.kind === 'creature' && this.action.target.id === id) return;
    const def = ACTION_BY_ID.get('attack_creature');
    if (!def) return;
    const target: Target = { kind: 'creature', id };
    if (this.action) this.queue.unshift({ def: this.action.def, target: this.action.target, goes: this.action.left });
    this.action = null;
    this.logMsg(`You turn on the ${this.creatures.species(c).name.toLowerCase()}.`, 'fight');
    this.startAction(def, target, FIGHT_BACK_GOES);
  }

  /** Open a wound, or deepen one of the same kind already in that place. */
  wound(kind: WoundKind, part: Slot, severity: number): Wound {
    const had = this.player.wounds.find((w) => w.kind === kind && w.part === part && !w.infected);
    if (had) {
      had.severity += severity;
      if (WOUND_KINDS[kind].bleed > 0.001) had.bleeding = true;
      return had;
    }
    const w: Wound = {
      id: this.player.nextWound++,
      kind,
      part,
      severity,
      // A bruise does not bleed; everything else does until it is seen to.
      bleeding: kind !== 'crush',
      infected: false,
      dressing: null,
      at: this.time,
    };
    this.player.wounds.push(w);
    this.note('wounded');
    return w;
  }

  /**
   * What is open on you, once a second: blood out of anything still bleeding,
   * a little closing on anything dressed, and the chance that something left
   * alone goes bad.
   */
  private tendWounds(dt: number): void {
    const p = this.player;
    if (!p.wounds.length) return;
    const aid = this.skills.get('first_aid');
    let bad = false;
    for (const w of p.wounds) {
      const drain = woundDrain(w);
      if (drain > 0) {
        p.stats.health = Math.max(0, p.stats.health - drain * dt);
        bad = true;
      }
      w.severity = Math.max(0, w.severity - woundClose(w, aid) * dt);
      if (this.rand() < festerChance(w) * dt) {
        w.infected = true;
        w.dressing = null;
        this.logMsg(`The ${WOUND_KINDS[w.kind].name} on your ${PART_NAMES[w.part] ?? w.part} has gone bad. It wants cleaning out before anything will hold on it.`, 'error');
      }
    }
    const closed = p.wounds.filter((w) => w.severity <= 0.004 && !w.infected);
    for (const w of closed) this.logMsg(`The ${WOUND_KINDS[w.kind].name} on your ${PART_NAMES[w.part] ?? w.part} has closed.`, 'event');
    if (closed.length) p.wounds = p.wounds.filter((w) => !closed.includes(w));
    // Losing blood also means losing the wind to do anything about it.
    if (bad) p.stats.stamina = Math.max(0, p.stats.stamina - dt * 0.01);
  }

  /** Whether anything open is still working against you. */
  bleeding(): boolean {
    return this.player.wounds.some((w) => w.bleeding || w.infected);
  }

  /** The lit lantern you are carrying, if you are carrying one. */
  litLantern(): Item | undefined {
    return this.inventory.items.find((it) => it.id === 'lantern' && it.lit && (it.charges ?? 0) > 0);
  }

  /**
   * Anything you are carrying that is actually burning — a lantern or a torch.
   *
   * The best of them, so that a torch struck while a good lantern is already
   * going does not shorten your sight. Everything that asks "is there a light
   * in your hand" asks this; `litLantern` is kept for the one thing that is
   * specifically about the candle.
   */
  heldLight(): Item | undefined {
    let best: Item | undefined;
    for (const it of this.inventory.items) {
      if (!it.lit || (it.charges ?? 0) <= 0) continue;
      if (!(HELD_LIGHTS as readonly string[]).includes(it.id)) continue;
      if (!best || heldReach(it.id, it.ql) > heldReach(best.id, best.ql)) best = it;
    }
    return best;
  }

  /**
   * A blow struck or taken, for whatever wants to know that a fight happened.
   *
   * Awareness is learned in exactly one place: fighting in the dark. Nothing
   * teaches a person what they were not noticing like something coming out of
   * it at them, and nothing else on this island teaches it at all — so the
   * skill that decides how far you see is bought with the hours when you can
   * see least. Weighted by how dark it actually is, so a scuffle at dusk is
   * worth a fraction of one at the dead of night.
   */
  fought(weight = 1): void {
    const dark = this.darkness();
    if (dark <= NIGHT_EYES_FROM) return;
    this.gainSkill(AWARENESS, weight * dark);
  }

  /**
   * Everything burning near enough to matter, as circles of light. The
   * renderer cuts these out of the night and the eye reaches further inside
   * them. Only what is close is looked at: a fire forty tiles off lights
   * nothing you can see.
   */
  lights(): LightSource[] {
    if (this.darkness() <= 0.01) return [];
    const out: LightSource[] = [];
    const px = this.player.x;
    const py = this.player.y;
    const near = (x: number, y: number): boolean => Math.abs(x - px) < 60 && Math.abs(y - py) < 60;
    const lamp = this.litLantern();
    if (lamp) out.push({ x: px, y: py, radius: lanternReach(lamp.ql), strength: 0.92, steady: true });
    for (const f of this.campfires.values()) {
      if (!f.lit || !near(f.x, f.y)) continue;
      const [cx, cy] = fireCentre(f);
      out.push({ x: cx, y: cy, radius: FIRE_REACH, strength: 0.85 });
    }
    for (const f of this.furniture.values()) {
      if (!f.lit || !near(f.x, f.y)) continue;
      const [cx, cy] = furnitureCentre(f);
      out.push({ x: cx, y: cy, radius: OVEN_REACH, strength: 0.8 });
    }
    for (const k of this.kilns.values()) if (k.lit && near(k.x, k.y)) out.push({ x: k.x + 0.5, y: k.y + 0.5, radius: OVEN_REACH, strength: 0.8 });
    for (const sm of this.smelters.values()) if (sm.lit && near(sm.x, sm.y)) out.push({ x: sm.x + 1, y: sm.y + 0.5, radius: OVEN_REACH, strength: 0.85 });
    // The two that carry a light of their own.
    for (const c of this.creatures.list.values()) {
      const glow = this.creatures.species(c).glow;
      if (glow && near(c.x, c.y)) out.push({ x: c.x, y: c.y, radius: glow, strength: 0.7, steady: true });
    }
    return out;
  }

  /**
   * Everything actually burning, whatever the hour. `lights` answers a
   * different question — what is pushing back the dark — so it is empty at
   * noon and counts a lantern and a glowing wildermon among its answers. A
   * fire smokes whether or not anyone needs the light of it, and by day is
   * when you can see that it does.
   */
  fires(): Array<{ x: number; y: number; heat: number }> {
    const out: Array<{ x: number; y: number; heat: number }> = [];
    const px = this.player.x;
    const py = this.player.y;
    const near = (x: number, y: number): boolean => Math.abs(x - px) < 60 && Math.abs(y - py) < 60;
    for (const f of this.campfires.values()) {
      if (!f.lit || !near(f.x, f.y)) continue;
      const [cx, cy] = fireCentre(f);
      out.push({ x: cx, y: cy, heat: 0.7 });
    }
    for (const f of this.furniture.values()) {
      if (!f.lit || !near(f.x, f.y)) continue;
      const [cx, cy] = furnitureCentre(f);
      out.push({ x: cx, y: cy, heat: 0.62 });
    }
    for (const k of this.kilns.values()) if (k.lit && near(k.x, k.y)) out.push({ x: k.x + 0.5, y: k.y + 0.5, heat: 0.85 });
    for (const sm of this.smelters.values()) if (sm.lit && near(sm.x, sm.y)) out.push({ x: sm.x + 1, y: sm.y + 0.5, heat: 1 });
    return out;
  }

  /** Hours since midnight, 0 up to 24. */
  hourOfDay(): number {
    const secs = this.islandClock ? this.islandClock() : this.time;
    return ((((secs % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS) / DAY_SECONDS) * 24;
  }

  /** The clock as it reads on the hud: "06:30". */
  clock(): string {
    const h = this.hourOfDay();
    const m = Math.floor((h % 1) * 60);
    return `${Math.floor(h).toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  /**
   * How dark it is out, 0 in broad day and 1 at the dead of night, with an
   * hour of dusk and an hour of dawn between the two.
   */
  darkness(): number {
    const h = this.hourOfDay();
    if (h >= DAWN + 1 && h <= DUSK - 1) return 0;
    if (h >= DUSK + 1 || h <= DAWN - 1) return 1;
    return h > 12 ? Math.min(1, Math.max(0, (h - (DUSK - 1)) / 2)) : Math.min(1, Math.max(0, (DAWN + 1 - h) / 2));
  }

  isNight(): boolean {
    return this.darkness() > 0.45;
  }

  /**
   * Sleep until morning. The world does not stop for it: fires burn down,
   * crops come on and everything left outside ages by however long you slept.
   */
  sleepUntilMorning(rest: number, what: string): void {
    const h = this.hourOfDay();
    const hours = h < DAWN + 0.5 ? DAWN + 0.5 - h : 24 - h + DAWN + 0.5;
    const seconds = (hours / 24) * DAY_SECONDS;
    /*
     * On an island the night belongs to everybody standing in it.
     *
     * Winding this browser's clock on to dawn was honest while the clock was
     * this browser's. It is the island's now, and one sleeper cannot move the
     * sun for the rest of them — so the rest is still banked and the sun is
     * left where it stands. The line below says which of the two happened
     * rather than reporting a morning that did not come.
     */
    const skipped = !this.islandClock;
    if (skipped) {
      this.time += seconds;
      // Everything that works by itself carries on working while you are under.
      if (this.campfires.size) this.burnFires(seconds);
      if (this.smelters.size) this.runSmelters(seconds);
      if (this.kilns.size) this.runKilns(seconds);
      if (this.furniture.size) this.runPlaceables(seconds);
      if (this.posts.size) this.runPosts(seconds);
      if (this.traps.size) this.runTraps(seconds);
      if (this.crops.size) this.growCrops();
      if (this.ground.size) this.applyDecay(seconds);
    }
    const s = this.player.stats;
    s.stamina = 1;
    s.health = Math.min(1, s.health + 0.25 * rest);
    // Sleeping is hungry work, and a night is a long time to go without water.
    s.hunger = Math.max(0, s.hunger - 0.2);
    s.thirst = Math.max(0, s.thirst - 0.25);
    this.gainSkill('body_stamina', 0.3 * rest);
    // A good bed banks more of the night than a poor one.
    const banked = this.bankRest(seconds, rest);
    const bank = banked > 1 ? ` You have ${clockLeft(this.player.rested)} of rest in you; while it burns, everything teaches you twice as much.` : '';
    this.logMsg(
      skipped
        ? `You sleep in the ${what} and wake at ${this.clock()}, rested.${bank}`
        : `You doze in the ${what} and wake rested. It is still ${this.clock()} — the night runs on for everybody on the island, and it is not one sleeper's to skip.${bank}`,
      'event',
    );
    this.events.emit('world', this.player.tileX, this.player.tileY);
  }

  /** Soul strength is what a wild animal reads in you when you hold out food. */
  soulBonus(): number {
    return Math.max(0, (this.skills.get('soul_strength') - CHAR_START) * 0.002);
  }

  /** Steepest step the player can take, which climbing raises. */
  climbStep(): number {
    return MAX_STEP + this.skills.get('climbing') * CLIMB_PER_LEVEL;
  }

  /** Steepest tile the player can stand on, which climbing raises at the rate it raises the step. */
  standSlope(): number {
    return MAX_STAND + this.skills.get('climbing') * CLIMB_PER_LEVEL;
  }

  /** Raise a skill and announce it. Returns the gain. */
  /**
   * How much faster a trade goes into you than it otherwise would: doubled
   * while there is rest left to burn, and lifted again by whatever you have
   * eaten that favours it.
   */
  skillMult(id: string): number {
    let mult = this.player.rested > 0 ? REST_MULT : 1;
    // A knack earned on the way up never wears off, unlike a meal or a night's sleep.
    mult += knackBonus(this.player.knacks[id]);
    // And the stone you wear, worth a knack on the one trade it favours.
    if (gemOf(this.worn('jewel'))?.skill === id) mult += JEWEL_BONUS;
    // And the reader's path is a tenth on everything, for good.
    if (this.walks('knowledge', 1)) mult += 0.1;
    // A table with all four things on it is worth a fifth more on everything.
    // It reads off the worst of the four, so bread alone buys nothing.
    mult *= tableMul(this.player.nutrition);
    for (const b of this.player.boons) if (b.skill === id && b.until > this.time) mult += b.bonus;
    return mult;
  }

  /**
   * A knack from a go at a trade: one in five thousand, whatever the level and
   * whatever the go. It lands usually in that trade and sometimes in one
   * beside it. They are permanent and they stack, up to five to a trade, which
   * is half again on everything that trade teaches you.
   */
  private earnKnacks(skill: string): void {
    if (this.rand() >= 1 / KNACK_ODDS) return;
    const id = knackLands(skill, this.rand);
    const had = this.player.knacks[id] ?? 0;
    if (had >= KNACK_CAP) return;
    this.player.knacks[id] = had + 1;
    const def = SKILL_DEFS.find((d) => d.id === id);
    this.logMsg(
      `You have a knack for ${def?.name.toLowerCase() ?? id} now. It goes in ${Math.round(knackBonus(had + 1) * 100)}% faster.`,
      'skill',
    );
    this.note('knack');
  }

  /** Titles this level has earned that were not earned before, worn if you have none. */
  private earnTitles(skill: string, before: number, after: number): void {
    for (const t of earnedBy(skill, after)) {
      if (before >= t.at || this.player.titles.includes(t.id)) continue;
      this.player.titles.push(t.id);
      if (!this.player.title) this.player.title = t.id;
      this.logMsg(`They will call you ${t.name} for that. (Skills, to wear it)`, 'skill');
      this.note('title');
    }
  }

  /** Wear one of the titles you have earned, or none at all. */
  wearTitle(id: string | null): void {
    if (id !== null && !this.player.titles.includes(id)) return;
    this.player.title = id;
    // And tell the island, which keeps it. Without this the chip lights up
    // and the next heartbeat puts it back: the island reports `title` on
    // every beat and had never been told this one changed.
    this.woreTitle?.(id);
    this.events.emit('skill', '', 0);
  }

  /** Set by the island, when there is one, to carry a title across. */
  woreTitle?: (id: string | null) => void;

  /**
   * What this body last said out loud, for the bubble over its own head.
   *
   * Everybody else's lives on their `Peer`, which is where everything drawn
   * about somebody else lives. The one body the roster does not hold is this
   * one, so it keeps its own — and it is here rather than on `player` because
   * `player` is swapped between actors on a shared machine and what was said
   * belongs to the screen, not to whichever body it is pointing at.
   */
  saidAloud: { text: string; at: number } | null = null;

  /** The title being worn, written out. */
  titleName(): string | null {
    return this.player.title ? TITLE_BY_ID.get(this.player.title)?.name ?? null : null;
  }

  /** Everything running on you just now, for the hud to put up. */
  activeBoons(): Boon[] {
    return this.player.boons.filter((b) => b.until > this.time);
  }

  /**
   * Eat or drink something that favours a trade, and be better at it for a
   * while. A second helping of the same thing puts the clock back rather
   * than stacking on itself.
   */
  grantBoon(itemId: string, ql: number): string | null {
    // A knack comes off something somebody made. A berry off a bush is food.
    if (!knackable(itemId)) return null;
    const skill = boonOf(this.seed, itemId);
    if (!skill) return null;
    const seconds = boonTime(itemId, ql);
    const def = SKILL_DEFS.find((d) => d.id === skill);
    const already = this.player.boons.find((b) => b.skill === skill && b.until > this.time);
    if (already) already.until = Math.max(already.until, this.time + seconds);
    else this.player.boons.push({ skill, bonus: BOON_BONUS, until: this.time + seconds, from: itemName({ id: itemId, uid: 0, ql, dmg: 0, count: 1 }) });
    // Keep the list from growing without end as things run out.
    this.player.boons = this.player.boons.filter((b) => b.until > this.time);
    this.events.emit('inventory');
    return def ? `${def.name} comes easier for the next ${clockLeft(seconds)}.` : null;
  }

  /**
   * What a helping actually puts into you. Raw food feeds one of the four a
   * little; a cooked dish feeds several, and better food feeds them fuller.
   * Returns a word about it when something has been filled right up, since
   * that is the moment worth knowing about.
   */
  nourish(itemId: string, ql: number): string | null {
    const feeds = itemDef(itemId).feeds;
    if (!feeds) return null;
    const n = this.player.nutrition;
    const share = helpingOf(ql);
    const filled: string[] = [];
    for (const k of NUTRIENTS) {
      const gain = (feeds[k] ?? 0) * share;
      if (gain <= 0) continue;
      const was = n[k];
      n[k] = Math.min(1, was + gain);
      if (n[k] >= 1 && was < 1) filled.push(NUTRIENT_NAMES[k].toLowerCase());
    }
    if (!filled.length) return null;
    const all = NUTRIENTS.every((k) => n[k] >= 1);
    if (all) return 'You could not eat another thing. Everything you do goes in a fifth faster while it lasts.';
    return `That is as much ${filled.join(' and ')} as you can hold.`;
  }

  /** Bank a night's sleep as rest, up to the hour that will stay banked. */
  bankRest(seconds: number, quality: number): number {
    const before = this.player.rested;
    this.player.rested = Math.min(REST_CAP, before + seconds * REST_PER_SECOND * quality);
    return this.player.rested - before;
  }

  gainSkill(id: string, base = 0.45): number {
    const def = SKILL_DEFS.find((d) => d.id === id);
    const before = this.skills.get(id);
    const gain = this.skills.gain(id, base * this.skillMult(id), this.rand);
    // The last stretch of a skill moves in ten-thousandths, and a player at
    // ninety-nine deserves to see that it is moving at all.
    if (gain <= 0.000005 || !def) return gain;
    const now = this.skills.get(id);
    // What you pick up in the background says less about itself than what you set out to do.
    if (def.group === 'Characteristics' || QUIET_SKILLS.has(id)) {
      if (Math.floor(now) > Math.floor(before)) {
        const room = id === 'mind_logic' && this.queueCapacity() > BASE_QUEUE + Math.floor(Math.max(0, before - CHAR_START) / 10);
        this.logMsg(`${def.name} is now ${Math.floor(now)}.${room ? ` You can keep ${this.queueCapacity()} jobs in your head.` : ''}`, 'skill');
      }
    } else {
      const places = gain < 0.0001 ? 6 : 4;
      this.logMsg(`${def.name} increased by ${gain.toFixed(places)} to ${now.toFixed(4)}.`, 'skill');
    }
    /*
     * A knack and a title are the island's to hand out where there is one.
     *
     * Climbing and swimming are still earned off your own feet here, so this
     * still runs on an island — and `earn_knacks` and `earn_titles` run over
     * there for everything else. Both rolling would be two knacks for one go
     * and a title announced twice, and then the next answer disagreeing with
     * whichever of them wrote last.
     */
    if (!this.bodyFromIsland) {
      this.earnKnacks(id);
      this.earnTitles(id, before, now);
    }
    this.events.emit('skill', id, gain);
    return gain;
  }

  /**
   * Tell whoever is acting what just happened to them.
   *
   * Every one of these lines is in the second person — *you dig a hole*, *your
   * pick is blunt* — and every one of them was written on the assumption that
   * there is one *you*. There still is, per line: it is whoever the game is
   * acting as when the line is written, which is exactly who the line is
   * about. A guest's news goes home to their machine and never appears in the
   * host's log, which is right: the host did not dig that hole.
   */
  logMsg(text: string, kind: LogKind = 'info'): void {
    this.acting.hear(text, kind);
  }

  /**
   * Put a line on this machine's own screen. Where the local player's news
   * ends up.
   *
   * `at` is when the island says it was said, in milliseconds. Left out for
   * anything this machine came up with itself, which is now.
   *
   * Reported: *"when logging in, all prior world chats default to the login
   * timestamp."* They did — every line came through here and was stamped with
   * the moment it arrived, so a conversation from this morning read back as
   * sixty lines all said at once, at the second somebody opened the page.
   */
  write(text: string, kind: LogKind = 'info', at?: number): void {
    const entry: LogEntry = { time: at ?? Date.now(), text, kind };
    this.log.push(entry);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
    this.events.emit('log', entry);
  }

  /**
   * Do something as somebody else: their body, their pack, their skills, for
   * the length of one call and no longer.
   *
   * Nested swaps are fine and are what happens when one person's action stirs
   * another's — the previous actor is put back, not the local one. The
   * `finally` is the whole safety of the thing: an action that throws must not
   * leave the island wearing a guest's arms.
   */
  as<T>(actor: Actor, fn: () => T): T {
    const was = this.acting;
    this.acting = actor;
    this.player = actor.player;
    this.inventory = actor.inventory;
    this.skills = actor.skills;
    try {
      return fn();
    } finally {
      this.acting = was;
      this.player = was.player;
      this.inventory = was.inventory;
      this.skills = was.skills;
    }
  }

  /** Whoever the game is acting as this instant. */
  get actor(): Actor {
    return this.acting;
  }

  /**
   * Somebody has arrived and wants a body. They get an empty one: a guest
   * wearing a copy of the host's pack would be a guest handed the host's tools.
   */
  welcome(id: PeerId, who: string, name: string, hear: Actor['hear']): Actor {
    const had = this.actors.get(id);
    if (had) return had;
    const actor = Actor.arriving(id, who, name, this.spawn.x + 0.5, this.spawn.y + 0.5, this.inventory.well);
    const kept = this.guestbook.get(who);
    if (kept) {
      // Somebody who has been here before picks up exactly where they left
      // off: the same pack, the same skills, the same spot on the ground.
      readPlayer(actor.player, kept.body);
      actor.player.name = name;
      actor.inventory.items = kept.items.map((it) => ({ ...it }));
      for (const [skill, v] of Object.entries(kept.skills)) actor.skills.values.set(skill, v);
      // Their things came back from the book with the numbers they left
      // wearing; the island counts on from above them.
      for (const it of actor.inventory.items) if (it.uid >= actor.inventory.nextUid) actor.inventory.nextUid = it.uid + 1;
    }
    actor.hear = hear;
    actor.inventory.onChange = () => actor.packed();
    this.actors.set(id, actor);
    return actor;
  }

  /** Whether this island has seen somebody before, and what it remembers of them. */
  remembers(who: string): GuestSave | undefined {
    return this.guestbook.get(who);
  }

  /**
   * Somebody has gone. Their body and their pack go into the guest book
   * rather than onto the ground.
   *
   * They used to be tipped out where they stood, on the reasoning that a guest
   * who quits mid-haul should not take the island's ore with them. That was
   * the right call for a visitor the island would never see again; it is the
   * wrong one now that it will. A pack somebody spent an evening filling is
   * theirs, and it waits for them.
   */
  farewell(id: PeerId): GuestSave | null {
    const actor = this.actors.get(id);
    if (!actor || actor === this.local) return null;
    this.actors.delete(id);
    // Whatever they were in the middle of is not: an action is a moment, and
    // this one is over.
    actor.action = null;
    actor.queue.length = 0;
    const kept = this.guestSave(actor);
    this.guestbook.set(actor.who, kept);
    return kept;
  }

  update(dt: number): void {
    this.time += dt;
    // A slice of the woods, which keep a real day rather than the world's own.
    this.growTrees(Date.now() / 1000);
    // The fog is the one thing that stays on the machine it belongs to, so it
    // is advanced for the person sitting here and for nobody else.
    this.vision.update();
    // Every body on the island walks, tires, heals and gets on with whatever
    // it is doing — each wearing its own arms for the length of its own turn.
    if (this.actors.size > 1) {
      for (const actor of this.actors.values()) this.as(actor, () => this.updateBody(dt));
    } else this.updateBody(dt);
    /*
     * Outside the body loop, and deliberately.
     *
     * `updateBody` runs once per actor on a machine hosting other people, with
     * `this.player` swapped to each of them in turn — and following is one
     * person's, kept on the game rather than on a body. Inside that loop it
     * would walk every guest after whoever you picked.
     */
    if (this.followed) this.updateFollow(dt);
    this.updateWorld(dt);
  }

  /** One person's turn: their body, their wind, their wounds, their work. */
  private updateBody(dt: number): void {
    const p = this.player;
    // On a seat you go at your team's pace, in the saddle at your mount's, and
    // on your own feet at your own.
    const driven = this.driving();
    const up = this.mounted();
    const boat = this.afloat();
    p.speedMul = boat ? this.boatSpeed(boat) / BASE_SPEED : driven ? this.vehicleSpeed(driven) / BASE_SPEED : up ? this.mountSpeed(up) / BASE_SPEED : 1;
    // Only wheels feel the ground: a boat is on water and feet are feet.
    p.wheelLoad = driven ? this.vehicleLoad(driven) : 0;
    // And whether your own feet are in the water at all, which is the whole of
    // what deep water is asking. A hull, a cart bed or a saddle is not.
    p.carried = !!(driven || up);
    const { rule } = this.movement();
    const moved = p.update(dt, this.world, rule);
    this.acting.stepped = moved;
    if (boat && furnitureDef(boat.kind).boat?.sail && moved > 0) {
      const w = this.wind();
      if (w.force >= 0.5 && sailWord(this.heading(), w) === 'reaching') this.note('reach');
      const cap = furnitureCapacity(boat);
      if (cap && furnitureUnits(boat) > cap / 2) this.note('laden');
    }

    if (up) this.carryRider(up, dt, moved);
    const s = p.stats;
    // What is in you falls away on its own, and while it is there it holds
    // hunger and thirst off: a body with something behind it goes longer.
    const keep = upkeepMul(p.nutrition);
    for (const k of NUTRIENTS) p.nutrition[k] = Math.max(0, p.nutrition[k] - dt * NUTRIENT_DECAY);
    if (!this.bodyFromIsland) {
      s.hunger = Math.max(0, s.hunger - dt * HUNGER_RATE * keep);
      s.thirst = Math.max(0, s.thirst - dt * THIRST_RATE * keep);
    } else {
      /*
       * The island's body, drawn forward between one answer and the next.
       *
       * The four bars rode `rpc_settle` and nothing else, so standing still
       * they were up to a minute stale: eat a loaf and the hunger bar sat
       * there and then jumped. The answer is not to ask more often — it is
       * that a body is a function of elapsed time and fixed rates, and this
       * side has every one of them, generated from the same constants the
       * island's are. So the curve is drawn here at the frame rate and the
       * island re-pins it on every answer, exactly as the action bar and a
       * wildermon's leg already work.
       *
       * `bodyForward` is `body_settle` to the letter and deliberately not the
       * richer version above it — see the note on it.
       */
      const wind = 1 + Math.max(0, this.skills.get('body_stamina') - CHAR_START) * WIND_PER_LEVEL;
      // What the wounds are taking, by the island's own sum — `woundDrain` and
      // `wound_drain` are the same arithmetic over the same table.
      const drain = p.wounds.reduce((n, w) => n + woundDrain(w), 0);
      /*
       * And what the job in hand is costing, spread across it.
       *
       * The island's own sum, not this one's: `spend_wind` says in as many
       * words that it leaves the burden out — "the island does not know what
       * you are carrying" — so `staminaCost` would overshoot for a laden body
       * and be yanked back on every answer. Drawing the island's arithmetic is
       * the whole discipline here.
       */
      const a = this.action;
      const doing = a?.state === 'performing';
      const body = Math.max(0.45, 1 - Math.max(0, this.skills.get('body_stamina') - CHAR_START) * 0.0045);
      const spend = doing && a.def.stamina > 0
        ? (a.def.stamina * body) / Math.max(0.001, a.duration)
        : 0;
      const now = bodyForward(s, dt, { acting: doing, wind, drain, spend });
      s.hunger = now.hunger;
      s.thirst = now.thirst;
      s.stamina = now.stamina;
      s.health = now.health;
    }

    // What climbing and swimming have earned, and what the armour costs, before the next step.
    p.burden = this.burden();
    p.maxStep = this.climbStep();
    p.maxStand = this.standSlope();
    p.swimSpeed = Math.min(0.85, SWIM_SPEED + this.skills.get('swimming') * 0.0033);
    if (p.lastClimb > 0) {
      // Only ground that would have turned you back at the start teaches you anything.
      if (p.lastClimb > MAX_STEP / 3) this.gainSkill('climbing', 0.04 + (p.lastClimb / MAX_STEP) * 0.12);
      p.lastClimb = 0;
    }
    this.checkJournal();
    const performing = this.action?.state === 'performing';
    // Rest only goes while you are working; standing about does not spend it.
    if (performing && this.player.rested > 0) {
      const was = this.player.rested;
      this.player.rested = Math.max(0, was - dt);
      if (was > 0 && this.player.rested === 0) this.logMsg('The rest goes out of you. Skills go in at their ordinary pace again.', 'system');
    }
    if (p.swimming) {
      /*
       * Deep water is its own teacher, and a strong swimmer tires more slowly.
       *
       * All of it is the island's on an island now, down to the telling-off:
       * `swim_wind` and `drown_rate` were crossed the day the body was and
       * called by nothing over there, so deep water cost a body nothing at all
       * — and the trade this raised was raised into a number the next beat
       * threw away, because the island sends the whole book and has never had
       * a `swimming` row to send. An hour of open water, and a refresh put it
       * back to one.
       */
      this.acting.swimClock += dt;
      if (this.acting.swimClock >= 1) {
        this.acting.swimClock = 0;
        if (!this.bodyFromIsland) this.gainSkill('swimming', SWIM_LEARN);
      }
      if (!this.bodyFromIsland) {
        s.stamina = Math.max(0, s.stamina - dt * SWIM_WIND * Math.max(0.4, 1 - this.skills.get('swimming') / 200));
        if (s.stamina <= 0) {
          s.health = Math.max(0, s.health - dt * DROWN_RATE);
          if (this.time - this.acting.drownWarning > DROWN_WARN) {
            this.acting.drownWarning = this.time;
            this.logMsg('You are exhausted and swallowing water. Get to shore!', 'error');
          }
        }
      }
    } else if (!performing && !this.bodyFromIsland) {
      // Body stamina is what gets your wind back between jobs.
      const wind = 1 + Math.max(0, this.skills.get('body_stamina') - CHAR_START) * WIND_PER_LEVEL;
      const regen = (moved > 0 ? WIND_WALK : WIND_REST) * wind;
      const starving = s.hunger <= 0 || s.thirst <= 0 ? WIND_STARVING : 1;
      s.stamina = Math.min(1, s.stamina + dt * regen * starving);
      // Nothing knits while it is still open: see to the wound first.
      if (s.hunger > HEAL_FED && s.thirst > HEAL_FED && s.health < 1 && !this.bleeding()) s.health = Math.min(1, s.health + dt * HEAL_RATE);
    }
    /*
     * A light burns only while it is lit; a dark lantern costs nothing to
     * carry. Every lit thing in the pack burns at once, because two torches
     * held to the same night is two torches spent.
     *
     * A lantern that runs out goes dark and waits for another candle. A torch
     * that runs out is gone: there is nothing left of it but char.
     */
    for (const it of this.inventory.items) {
      if (!it.lit || !(HELD_LIGHTS as readonly string[]).includes(it.id)) continue;
      it.charges = Math.max(0, (it.charges ?? 0) - dt);
      if (it.charges > 0) continue;
      it.lit = false;
      // Going dark is what the eye sees, and this side may say so. What
      // becomes of the thing afterwards is the island's word where there is
      // one, and it will say it down the same subscription as everything else.
      if (!this.packFromIsland) {
        if (it.id === 'torch') {
          this.logMsg('The torch burns down to your hand and you drop what is left of it.', 'event');
          this.inventory.remove(it.uid, 1);
        } else {
          this.logMsg('The candle gutters out and the lantern goes dark.', 'event');
        }
      }
      this.events.emit('inventory');
    }
    /*
     * And the wounds themselves, which are the island's where there is one.
     *
     * `tendWounds` closes them, turns them bad and takes the blood out — all
     * three of which `wounds_settle` is already doing over there, off its own
     * clock and its own dice. Running both would close a wound twice as fast
     * and roll for infection twice as often, and then have the next answer
     * disagree with all of it. The blood is drawn forward above, because that
     * lands on a bar somebody is watching; the rest is drawn, not decided.
     */
    if (!this.bodyFromIsland) this.tendWounds(dt);
    // Favour comes back on its own, at a trickle, up to what faith carries.
    const cap = favourCap(this.skills.get(FAITH));
    if (this.player.favour < cap) this.player.favour = Math.min(cap, this.player.favour + dt * FAVOUR_TRICKLE);
    if (s.health <= 0) this.die();

    if (this.action) this.updateAction(dt);
  }

  /** The island's own turn: everything there is one of. */
  private updateWorld(dt: number): void {
    if (this.campfires.size) this.burnFires(dt);
    if (this.smelters.size) this.runSmelters(dt);
    if (this.kilns.size) this.runKilns(dt);
    if (this.furniture.size) this.runPlaceables(dt);
    if (this.posts.size) this.runPosts(dt);
    if (this.traps.size) this.runTraps(dt);
    if (this.crops.size) this.growCrops();
    this.creatures.update(dt, this);

    this.decayClock += dt;
    // On an island what is lying about rots on the island's clock, and every
    // ground answer replaces it; rotting it here as well would take a pile off
    // the screen a second before the next answer put it back, and say so.
    if (this.decayClock >= DECAY_STEP && this.ground.size && !this.bodyFromIsland) {
      this.applyDecay(this.decayClock);
      this.decayClock = 0;
    } else if (this.decayClock >= DECAY_STEP) {
      this.decayClock = 0;
    }
  }

  /**
   * Age everything lying on the ground by `seconds` of real time. Items that
   * reach 100 damage rot away. Returns how many units were lost.
   */
  applyDecay(seconds: number): number {
    const hours = seconds / 3600;
    let lost = 0;
    for (const [key, pile] of this.ground) {
      const [xs, ys] = key.split(',');
      const x = Number(xs);
      const y = Number(ys);
      const mult = this.decayMultiplier(x, y);
      for (let i = pile.length - 1; i >= 0; i--) {
        const item = pile[i];
        item.dmg = Math.min(100, item.dmg + groundDecayRate(item) * hours * mult);
        // A bag sheds the weather: what is in it ages slower than what is not.
        const shelter = itemDef(item.id).shelter;
        if (shelter !== undefined && item.inside?.length) {
          for (let k = item.inside.length - 1; k >= 0; k--) {
            const held = item.inside[k];
            held.dmg = Math.min(100, held.dmg + groundDecayRate(held) * hours * mult * shelter);
            if (held.dmg >= 100) item.inside.splice(k, 1);
          }
        }
        if (item.dmg >= 100) {
          pile.splice(i, 1);
          lost += item.count;
          if (seconds < 60 && Math.hypot(x + 0.5 - this.player.x, y + 0.5 - this.player.y) < 16) {
            this.logMsg(`The ${itemName(item).toLowerCase()} lying on the ground rots away.`, 'event');
          }
        }
      }
      if (!pile.length) this.ground.delete(key);
      this.events.emit('world', x, y);
    }
    return lost;
  }

  /** How fast things rot at a spot: full speed in the wild, a tenth of that on deed land. */
  decayMultiplier(x: number, y: number): number {
    return this.onDeed(x, y) ? 0.1 : 1;
  }

  private updateAction(dt: number): void {
    const a = this.action;
    if (!a) return;
    /*
     * A job being watched rather than done. The clock runs so the bar moves
     * between one answer from the island and the next; nothing else happens,
     * because nothing else here is entitled to.
     */
    if (this.watching) {
      a.elapsed = Math.min(a.duration, a.elapsed + dt);
      return;
    }
    /*
     * On the way to a job the island will be asked for. The walking is ours,
     * the deciding is not: arriving is what sends the ask, and after that the
     * island's own answer drives the bar.
     */
    if (this.ask && a.state === 'walking') {
      if (this.player.path) return;
      const { def, target, goes } = a;
      this.action = null;
      if (!this.inRange(def, target)) {
        this.logMsg('You are too far away from that.', 'error');
        this.events.emit('action');
        return;
      }
      this.ask(def, target, goes);
      return;
    }
    const p = this.player;
    if (a.state === 'walking') {
      // Walking off under your own steam used to cancel what you were on your
      // way to do. There is no longer a way to do that without clicking, and a
      // click cancels the action itself, so there is nothing left to catch.
      if (!p.path) {
        if (this.inRange(a.def, a.target)) this.beginPerform();
        else if (a.waitUntil !== undefined && this.time < a.waitUntil) {
          // A called wildermon is still on its way over.
        } else {
          const pet = a.target.kind === 'creature' ? this.creatures.get(a.target.id) : undefined;
          this.logMsg(a.waitUntil !== undefined && pet ? `${pet.name} cannot get to you.` : 'You are too far away from that.', 'error');
          this.action = null;
          this.nextInQueue();
          this.events.emit('action');
        }
      }
      return;
    }
    if (p.moving) {
      this.cancelAction();
      return;
    }
    a.elapsed += dt;
    if (a.elapsed >= a.duration) this.completeAction();
  }

  private beginPerform(): void {
    const a = this.action;
    if (!a) return;
    const reason = a.def.check?.(a.target, this);
    if (reason) {
      this.logMsg(reason, 'error');
      this.action = null;
      this.nextInQueue();
      this.events.emit('action');
      return;
    }
    a.state = 'performing';
    a.elapsed = 0;
    a.duration = this.duration(a.def);
    this.player.stop();
    if (a.target.kind === 'creature') {
      const c = this.creatures.get(a.target.id);
      if (c) c.busyUntil = this.time + a.duration + 0.2;
    }
    this.logMsg(`You start ${a.def.verb}.`, 'info');
    this.events.emit('action');
  }

  private completeAction(): void {
    const a = this.action;
    if (!a) return;
    const reason = this.jobReason(a.def, a.target);
    if (reason) {
      this.logMsg(reason, 'error');
      this.action = null;
      this.nextInQueue();
      this.events.emit('action');
      return;
    }
    // Where the work is going, so the renderer can put the effort there. Only
    // work done on the ground or on a beast has a place in the world; filing
    // a nail in your own hands does not.
    if (a.target.kind === 'tile') this.events.emit('strike', a.target.x + 0.5, a.target.y + 0.5);
    else if (a.target.kind === 'creature') {
      const c = this.creatures.get(a.target.id);
      if (c) this.events.emit('strike', c.x, c.y);
    }
    const again = a.def.perform(a.target, this) === true;
    if (a.def.tool) this.wearTool(a.def.tool);
    const cost = this.staminaCost(a.def.stamina);
    this.player.stats.stamina = Math.max(0, this.player.stats.stamina - cost);
    /*
     * The skill for the go, whether or not the go landed.
     *
     * It was a full measure either way, which made a failed dig and a chip
     * that found no line in the rock worth exactly as much as a good one — and
     * the island pays nothing at all for those, so the two sides disagreed
     * about it by the whole amount. Both say `TRY_LEARN` now: a swing teaches
     * you something, landing it teaches you more.
     */
    if (a.def.skill) this.gainSkill(a.def.skill, this.swingMissed ? TRY_LEARN : 1);
    this.swingMissed = false;
    // The body learns from the work itself: wind from spending it, control from doing it.
    if (cost > 0) this.gainSkill('body_stamina', WORK_WIND + cost * WORK_WIND_SPENT);
    this.gainSkill('body_control', WORK_HAND);
    // And the back, from the heavy trades: a shovel or a pick, whatever the go found.
    if (a.def.skill && HEAVY_SKILLS.has(a.def.skill)) this.gainSkill('body_strength', WORK_BACK);
    if (this.action !== a) {
      // Whatever was performed put something else in hand; leave it alone.
      this.events.emit('action');
      return;
    }
    const counted = a.left !== undefined;
    if (a.left !== undefined) a.left -= 1;
    // A job that says it is finished is finished, count or no count: the tree
    // is down, the wall is built. Everything else is only a matter of wind.
    const done = a.def.repeat ? !again : false;
    const winded = this.player.stats.stamina <= 0.05;
    const more = counted ? (a.left as number) > 0 : again && !!a.def.repeat;
    // Whether it could be started again this moment, so work that has run out
    // of ground stops now, and says so, rather than after another turn of the
    // timer.
    const barred = more && !done && !winded ? this.jobReason(a.def, a.target) : null;
    if (more && !done && !winded && !barred) {
      a.elapsed = 0;
      a.duration = this.duration(a.def);
      this.events.emit('action');
      return;
    }
    if (counted) {
      const did = (a.goes as number) - (a.left as number);
      if (did >= (a.goes as number)) this.logMsg(`That is ${a.goes} of them.`, 'info');
      else if (winded) this.logMsg(`Your wind gives out after ${did} of ${a.goes}. Rest and pick it up again.`, 'info');
      else if (barred) this.logMsg(`${barred} That was ${did} of ${a.goes}.`, 'info');
      else this.logMsg(`That is as far as that goes: ${did} of ${a.goes}.`, 'info');
    } else if (barred) this.logMsg(barred, 'error');
    this.action = null;
    this.nextInQueue();
    this.events.emit('action');
  }

  cancelAction(silent = false): void {
    const a = this.action;
    const lined = this.queue.length;
    this.clearQueue(silent || !a);
    if (!a && !lined) return;
    /*
     * And wherever the job really is.
     *
     * Only when there was something to put down — `moveTo` cancels on every
     * click of the ground, and a body walking across an empty field has no
     * business telling the island anything. Not on a silent one either: the
     * only silent cancel is dying, which is the island's own business on an
     * island and has already happened by the time we hear about it.
     */
    if (!silent) this.stop?.();
    if (!a) return;
    this.action = null;
    if (!silent && a.state === 'performing') this.logMsg(`You stop ${a.def.verb}.`, 'info');
    this.events.emit('action');
  }

  /** Actions that apply to a target, with the reason each may be unavailable. */
  actionsFor(target: Target): Array<{ def: ActionDef; reason: string | null }> {
    const out: Array<{ def: ActionDef; reason: string | null }> = [];
    for (const def of ACTIONS) {
      if (def.hidden || !def.applies(target, this)) continue;
      out.push({ def, reason: def.check?.(target, this) ?? null });
    }
    return out;
  }

  /**
   * Ask for a job. A repeating one may be given a **number of goes**: it stops
   * of its own accord after that many rather than running until your wind
   * gives out, which is most of what a count is for.
   */
  /**
   * Somewhere else to send the asking.
   *
   * On an island kept in Postgres nothing below decides anything: the checks,
   * the roll, the time it takes and the hole at the end all happen there, and
   * this machine's job is to ask and then listen. Setting this is what turns
   * the game from a thing that does into a thing that asks — one seam rather
   * than a second copy of every action.
   */
  ask: ((def: ActionDef, target: Target, goes?: number) => void) | null = null;

  /**
   * And somewhere else to send the putting down.
   *
   * `ask` had no opposite, which meant stopping was the one thing this machine
   * still decided for itself — and it decided it about a copy. Reported: "a
   * player that stops a task locally doesn't stop it on the server, the task
   * continues until completed." The bar went out here and the tree went on
   * falling there.
   */
  stop: (() => void) | null = null;

  /**
   * Whether the body is the island's to keep, rather than this machine's.
   *
   * Hunger, thirst, wind and health fell all session and came back full on a
   * refresh, because the browser was moving its own copy and the island — which
   * is where the row actually lives — had never moved it at all. The island
   * settles the body off a timestamp now, so this side stops moving it and
   * draws what it is told.
   *
   * The rest of `update` stays: nutrition, lights burning down, wounds, the
   * boat and the rider are still worked out here, and the two that matter are
   * plainly marked below.
   */
  bodyFromIsland = false;

  /**
   * Whether the pack is the island's to keep, in the same way.
   *
   * The count-down on a burning thing stays here either way — it is drawing,
   * between one answer and the next, like the action bar. What does not is
   * what happens when it reaches the bottom: the island holds the row, and a
   * browser that quietly drops a spent torch out of the pack is announcing
   * something that did not happen. The next refresh hands it straight back.
   */
  packFromIsland = false;

  /**
   * A job somebody else is doing, shown here so that there is a clock on it.
   *
   * `ask` sends the whole of an action away, which is what makes the island
   * the authority — and left the screen with nothing to draw. There was no
   * progress bar on an island at all: you pressed cut down, the log said "You
   * start cutting down", and then nothing moved for half a minute.
   *
   * So the island says what it is doing and this shows it. The clock runs here
   * and *only* the clock: `updateAction` will not finish a watched job, will
   * not perform it, and will not cancel it because the body moved. Whether it
   * happened is the island's to say, and it says so by stopping telling us
   * about it.
   */
  watching = false;

  /**
   * Put the island's job on the screen, or take it off.
   *
   * `total` is how long the whole go is and `secs` how much of it is left, both
   * worked out by the island — a browser clock that is a minute out would draw
   * a bar that is a minute wrong, and there is no reason to subtract two of the
   * island's timestamps here rather than there.
   */
  showAction(def: ActionDef | null, target: Target | null, total = 0, secs = 0, left?: number, goes?: number): void {
    this.watching = true;
    if (!def) {
      if (this.action) {
        this.action = null;
        this.events.emit('action');
      }
      return;
    }
    const had = this.action;
    const same = had && had.def.id === def.id && had.left === left;
    this.action = {
      def,
      target: target ?? (had?.target as Target) ?? { kind: 'self' } as unknown as Target,
      state: 'performing',
      duration: Math.max(0.001, total),
      elapsed: Math.max(0, Math.min(total, total - secs)),
      left,
      /*
       * What the island says was asked for, and nothing else.
       *
       * This used to fall back to the count of whatever was in hand before,
       * which is how the bar came to draw "3 of 10" off two numbers from two
       * different jobs: ask for ten while something is in hand and the ask is
       * queued, so nothing here ever heard the ten, and the one it was still
       * holding belonged to the job that had just finished. The island keeps
       * `act_goes` now, through the queue and out the other side.
       */
      goes,
    };
    if (!same) this.events.emit('action');
  }

  requestAction(def: ActionDef, target: Target, goes?: number): void {
    /*
     * A name, or a yes, before anything else.
     *
     * Asked here because this is the one door every way of starting an action
     * goes through — the tile menu, the settlement panel, the toolbelt, the
     * picker a thumb uses. It used to be asked inside `perform`, and on an
     * island `perform` is the island's half: so the name was asked for by the
     * single menu entry that knew about it and by nothing else, and the island
     * was handed an action with no name on it. It made one up for a new
     * settlement and refused to rename an old one, which is both halves of
     * what was reported.
     */
    const asked = target as Target & { name?: string; sure?: boolean };
    if (def.asks && typeof asked.name !== 'string') {
      void this.askName(def, target, goes);
      return;
    }
    if (def.confirms && asked.sure !== true) {
      const question = def.confirms(target, this);
      if (question) {
        void this.askSure(def, target, goes, question);
        return;
      }
    }
    if (this.ask) {
      /*
       * Walk there first, if it is not already within reach.
       *
       * The island checks the distance and refuses — "You are too far away
       * from that." — which used to be the whole of what happened when you
       * clicked something across the field: the menu opened, you chose, and
       * nothing moved. The single-player game has always walked to the job
       * first, and the walking is the one part of this that is not the
       * island's business: it says where a body may go, and this side does the
       * going.
       *
       * So the ask is held until the feet arrive, and sent from
       * `updateAction`. Nothing about who decides has changed — the island is
       * still asked, and may still say no when we get there.
       */
      if (!this.inRange(def, target)) {
        this.action = { def, target, state: 'walking', elapsed: 0, duration: 0, left: goes, goes };
        this.watching = false;
        if (!this.walkToward(def, target)) {
          this.action = null;
          this.logMsg("You can't find a way to get there.", 'error');
          return;
        }
        this.events.emit('action');
        return;
      }
      this.ask(def, target, goes);
      return;
    }
    const reason = def.check?.(target, this);
    if (reason) {
      this.logMsg(reason, 'error');
      return;
    }
    if (def.instant) {
      def.perform(target, this);
      return;
    }
    if (this.player.stats.stamina < EXHAUSTED) {
      this.logMsg('You are too exhausted to do that. Rest a moment.', 'error');
      return;
    }
    // Something already in hand: line this one up behind it instead of dropping it.
    if (this.action) {
      const room = this.queueCapacity() - 1 - this.queue.length;
      if (room <= 0) {
        this.logMsg(`You can only keep ${this.queueCapacity()} jobs in your head at once. Mind logic is what widens that.`, 'error');
        return;
      }
      // What it was, while there is still something to ask. Once the row is
      // gone there is nothing left to ask what kind of thing it had been.
      const was = target.kind === 'item' ? this.inventory.get(target.uid)?.id : undefined;
      this.queue.push({ def, target, goes, was });
      this.logMsg(`${def.label} is next, ${this.queue.length + 1} of ${this.queueCapacity()} in hand.`, 'info');
      this.events.emit('action');
      return;
    }
    this.startAction(def, target, goes);
  }

  /** Put an action in hand and either begin it or start walking to it. */
  private startAction(def: ActionDef, target: Target, goes?: number): void {
    this.action = { def, target, state: 'walking', elapsed: 0, duration: this.duration(def), left: goes, goes };
    if (this.inRange(def, target)) {
      this.beginPerform();
      return;
    }
    // A tamed wildermon comes to you, rather than being chased around the field.
    const pet = target.kind === 'creature' ? this.creatures.get(target.id) : undefined;
    if (pet && pet.mode !== 'wild' && pet.mode !== 'stored') {
      this.creatures.callToPlayer(this, pet);
      this.action.waitUntil = this.time + CALL_WINDOW;
      this.player.stop();
      this.logMsg(`You call ${pet.name} over.`, 'info');
    } else if (!this.walkToward(def, target)) {
      this.logMsg("You can't find a way to get there.", 'error');
      this.action = null;
      this.nextInQueue();
    }
    this.events.emit('action');
  }

  /** Take the next job off the queue, if there is one. */
  /**
   * Why a job cannot be done now, or null. The world moves between lining a job
   * up and reaching it: the tree you queued three chops at falls on the first,
   * and there is no sense swinging at the grass it left behind.
   */
  private jobReason(def: ActionDef, target: Target): string | null {
    if (!def.applies(target, this)) return `There is nothing here to ${def.label.toLowerCase()} now.`;
    return def.check?.(target, this) ?? null;
  }

  /**
   * Point a queued job at another one like it, when the one it named is gone.
   *
   * Queueing three eats means eat three times; the row id was how you pointed
   * at the onion, not which onion you had an appointment with. Nothing is
   * invented — with no other onion in the pack the job is refused exactly as
   * it was, in the same words.
   */
  private retarget(job: { target: Target; was?: string }): Target {
    const t = job.target;
    if (t.kind !== 'item' || !job.was) return t;
    if (this.inventory.get(t.uid)) return t;
    const other = this.inventory.items.find((it) => it.id === job.was && !it.locked);
    return other ? { ...t, uid: other.uid } : t;
  }

  private nextInQueue(): boolean {
    const next = this.queue.shift();
    if (!next) return false;
    next.target = this.retarget(next);
    const reason = this.jobReason(next.def, next.target);
    if (reason) {
      this.logMsg(`${next.def.label}: ${reason}`, 'error');
      return this.nextInQueue();
    }
    this.startAction(next.def, next.target, next.goes);
    return true;
  }

  /** Forget everything lined up; moving off or stopping does this. */
  clearQueue(silent = false): void {
    if (!this.queue.length) return;
    const n = this.queue.length;
    this.queue.length = 0;
    if (!silent) this.logMsg(`You put ${n === 1 ? 'the other job' : `the other ${n} jobs`} out of your mind.`, 'info');
    this.events.emit('action');
  }

  /** Walk to a tile; when the tile itself is blocked, stop next to it. */
  /**
   * Walk there.
   *
   * `keepFollowing` is only ever true from `updateFollow`, which is the one
   * caller that is not you deciding to go somewhere. Everything else — a
   * click, walking home, a job that wants you nearer — is you, and you going
   * somewhere is how anybody stops following without thinking about it.
   */
  moveTo(x: number, y: number, keepFollowing = false): boolean {
    if (!keepFollowing) this.unfollow();
    this.cancelAction();
    const p = this.player;
    if (!this.world.inBounds(x, y)) return false;
    const { rule, levels } = this.movement();
    if (this.world.isPassable(x, y) && p.walkTo(this.world, x, y, rule, levels)) return true;
    const candidates = this.neighbours(x, y).filter((c) => this.world.isPassable(c.x, c.y));
    candidates.sort((a, b) => this.distanceToPlayer(a.x, a.y) - this.distanceToPlayer(b.x, b.y));
    for (const c of candidates) if (p.walkTo(this.world, c.x, c.y, rule, levels)) return true;
    this.logMsg("You can't find a way there.", 'error');
    return false;
  }

  /** The tile a target occupies right now, or null for inventory items. */
  targetTile(target: Target): { x: number; y: number } | null {
    if (target.kind === 'item') return null;
    if (target.kind === 'creature') {
      const c = this.creatures.get(target.id);
      return c ? { x: Math.floor(c.x), y: Math.floor(c.y) } : null;
    }
    if (target.kind === 'crate') {
      const c = this.crates.get(target.id);
      return c ? { x: c.x, y: c.y } : null;
    }
    if (target.kind === 'campfire') {
      const f = this.campfires.get(target.id);
      return f ? { x: f.x, y: f.y } : null;
    }
    if (target.kind === 'smelter') {
      const s = this.smelters.get(target.id);
      return s ? { x: s.x, y: s.y } : null;
    }
    if (target.kind === 'kiln') {
      const k = this.kilns.get(target.id);
      return k ? { x: k.x, y: k.y } : null;
    }
    if (target.kind === 'furniture') {
      const f = this.furniture.get(target.id);
      return f ? { x: f.x, y: f.y } : null;
    }
    if (target.kind === 'anvil') {
      const a = this.anvils.get(target.id);
      return a ? { x: a.x, y: a.y } : null;
    }
    if (target.kind === 'post') {
      const p = this.posts.get(target.id);
      return p ? { x: p.x, y: p.y } : null;
    }
    if (target.kind === 'trap') {
      const t = this.traps.get(target.id);
      return t ? { x: t.x, y: t.y } : null;
    }
    if (target.kind === 'bridge') {
      const b = this.bridges.get(target.id);
      if (!b) return null;
      // The open span is where the work is; failing that, the near end.
      const open = b.spans.find((sp) => Object.values(sp.needed).some((n) => n > 0));
      return open ? { x: open.x, y: open.y } : { x: b.ax, y: b.ay };
    }
    return { x: target.x, y: target.y };
  }

  inRange(def: ActionDef, target: Target): boolean {
    if (target.kind === 'item') return true;
    const tile = this.targetTile(target);
    if (!tile) return false;
    const px = this.player.tileX;
    const py = this.player.tileY;
    if (def.corner && target.kind === 'tile') return px >= target.cx - 1 && px <= target.cx && py >= target.cy - 1 && py <= target.cy;
    return Math.max(Math.abs(px - tile.x), Math.abs(py - tile.y)) <= (def.range ?? 1);
  }

  private walkToward(def: ActionDef, target: Target): boolean {
    if (target.kind === 'item') return true;
    const tile = this.targetTile(target);
    if (!tile) return false;
    let candidates: Array<{ x: number; y: number }>;
    if (def.corner && target.kind === 'tile') {
      candidates = [
        { x: target.cx - 1, y: target.cy - 1 },
        { x: target.cx, y: target.cy - 1 },
        { x: target.cx - 1, y: target.cy },
        { x: target.cx, y: target.cy },
      ];
    } else if (def.range === 0) {
      // Nought tiles of reach means there is one place to stand: on it.
      candidates = [{ x: tile.x, y: tile.y }];
    } else {
      candidates = [{ x: tile.x, y: tile.y }, ...this.neighbours(tile.x, tile.y)];
    }
    candidates = candidates.filter((c) => this.world.isPassable(c.x, c.y));
    candidates.sort((a, b) => this.distanceToPlayer(a.x, a.y) - this.distanceToPlayer(b.x, b.y));
    const { rule, levels } = this.movement();
    for (const c of candidates) {
      if (this.player.walkTo(this.world, c.x, c.y, rule, levels)) return true;
    }
    return false;
  }

  private neighbours(x: number, y: number): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (this.world.inBounds(x + dx, y + dy)) out.push({ x: x + dx, y: y + dy });
      }
    }
    return out;
  }

  private distanceToPlayer(x: number, y: number): number {
    return Math.hypot(x + 0.5 - this.player.x, y + 0.5 - this.player.y);
  }

  /**
   * How long a go at something takes.
   *
   * `baseTime` is a weight rather than a number of seconds — see `pace.ts` —
   * so the pace is what turns it into a clock. Skill and a good tool shorten
   * it from there, and the floor moves with the pace so that the quickest jobs
   * stay quick relative to everything else rather than all landing on the same
   * second.
   */
  duration(def: ActionDef): number {
    const skill = def.skill ? this.skills.get(def.skill) : 50;
    const toolQl = def.tool ? this.toolQl(def.tool) : 0;
    return Math.max(ACTION_FLOOR,
      def.baseTime * ACTION_PACE * (1 - skill / 140) * (1 - toolQl / 400) * this.controlSpeed());
  }

  /**
   * What a tool is worth at the work: its quality, dragged down by the state
   * it is in and lifted or lowered by the metal of its head. This is what
   * decides how fast a job goes, how often it comes out right, and how good
   * what comes out of it is, so the metal reaches all three at once.
   */
  toolQl(id: string): number {
    const tool = this.inventory.tool(id);
    return tool ? this.toolWorth(tool) : 0;
  }

  /**
   * The same figure for one named tool rather than the best of its kind, so
   * the pack can say what each is actually worth: quality, dragged down by the
   * state it is in, lifted by its metal, its rarity and any blessing on it.
   */
  toolWorth(tool: Item): number {
    // A battered tool works like a poorer one than it was.
    return Math.min(100, workingQl(tool.ql, tool.extra) * rarityOf(tool).boost * blessBonus(tool.bless)) * Math.max(0.3, 1 - tool.dmg / 160);
  }

  /**
   * Wear on a tool from one use. A poor tool goes to pieces far faster than a
   * good one, which is most of what quality is for — but a tool is a long-term
   * thing, so this is a slow business: a rough shovel is good for hundreds of
   * holes and a fine one for thousands.
   */
  wearTool(id: string, multiplier = 1): void {
    const tool = this.inventory.tool(id);
    if (!tool) return;
    this.damageItem(tool, (0.06 + 3 / (10 + tool.ql)) * multiplier);
  }

  /**
   * Put damage on a thing, saying so in red as it passes three quarters gone
   * and at every twentieth after that, and taking it away when it is finished.
   */
  damageItem(item: Item, amount: number): void {
    if (amount <= 0) return;
    const before = item.dmg;
    // Oak takes a third of what pine takes; seryll barely marks at all.
    item.dmg = Math.min(100, item.dmg + amount * matOf(item.extra).wear * rarityOf(item).keep);
    const step = (v: number): number => Math.floor((v - DAMAGE_WARN) / 5);
    if (item.dmg >= 100) {
      this.inventory.remove(item.uid, 1);
      for (const [slot, uid] of Object.entries(this.player.equipped)) if (uid === item.uid) this.player.equipped[slot] = null;
      this.logMsg(`Your ${itemName(item).toLowerCase()} finally goes to pieces and is gone.`, 'error');
    } else if (item.dmg >= DAMAGE_WARN && (before < DAMAGE_WARN || step(item.dmg) > step(before))) {
      this.logMsg(`Your ${itemName(item).toLowerCase()} is at ${Math.floor(item.dmg)} damage. Repair it before it breaks.`, 'error');
    }
    this.events.emit('inventory');
  }

  /** Wurm-flavoured success roll: better skill and tools help, difficulty hurts. */
  skillCheck(skill: string, difficulty = 10, toolQl = 0, ease = 0): boolean {
    const s = this.skills.get(skill);
    // A clear head makes a hard piece of work easier, but never simple.
    const d = ease > 0 ? Math.max(difficulty * 0.5, difficulty - ease) : difficulty;
    const chance = Math.min(0.98, Math.max(0.3, 0.6 + (s / 100) * 0.38 + toolQl / 500 - d / 150));
    return this.rand() < chance;
  }

  /**
   * What a piece of work comes out at.
   *
   * Your skill is the ceiling — nothing you make is finer than the hands that
   * made it — and the tool decides whether you reach it. A tool's quality is
   * the percentage chance of the piece coming out at that ceiling; every other
   * time it comes out at 1, fit for nothing but being used up. A rough issued
   * hatchet is right four times in twenty; a hatchet somebody has worked up to
   * ninety is right nine times in ten, and that is the whole reason to better
   * a tool.
   *
   * Work done with no tool at all has nothing to roll against, so it keeps the
   * older reckoning: what your hands can do, give or take.
   */
  productQl(skill: string, toolQl = 0): number {
    const s = Math.min(100, Math.max(1, this.skills.get(skill)));
    if (toolQl <= 0) return Math.min(100, Math.max(1, s * (0.6 + this.rand() * 0.8) + 1));
    return this.rand() * 100 < toolQl ? s : 1;
  }

  nearestCornerToPlayer(): { cx: number; cy: number } {
    return { cx: Math.round(this.player.x), cy: Math.round(this.player.y) };
  }

  /** Whether the player stands on or next to a tile with water. */
  nearWater(): boolean {
    const px = this.player.tileX;
    const py = this.player.tileY;
    for (let y = py - 1; y <= py + 1; y++) {
      for (let x = px - 1; x <= px + 1; x++) {
        if (this.world.inBounds(x, y) && this.world.hasWater(x, y)) return true;
      }
    }
    return false;
  }

  // ---- Bridges: ground where there was none. ----

  addBridge(kind: BridgeKind, ax: number, ay: number, bx: number, by: number, height: number, material?: string): Bridge {
    const spans = spanTiles(ax, ay, bx, by).map(([x, y]) => ({ x, y, ...spanBill(kind) }));
    const b: Bridge = { id: this.nextBridgeId++, kind, ax, ay, bx, by, height, material, spans };
    this.bridges.set(b.id, b);
    this.reindexDecks();
    return b;
  }

  removeBridge(id: number): void {
    const b = this.bridges.get(id);
    if (!b) return;
    this.bridges.delete(id);
    this.reindexDecks();
    for (const s of b.spans) this.events.emit('world', s.x, s.y);
  }

  /** Which tiles have deck over them, worked out once rather than per step. */
  reindexDecks(): void {
    this.deckIndex.clear();
    for (const b of this.bridges.values()) {
      for (const s of b.spans) this.deckIndex.set(`${s.x},${s.y}`, b.id);
    }
  }

  /** The bridge whose deck covers this tile, finished or not. */
  bridgeAt(x: number, y: number): Bridge | undefined {
    const id = this.deckIndex.get(`${x},${y}`);
    return id === undefined ? undefined : this.bridges.get(id);
  }

  /** The height of finished deck over this tile, or null for open ground. */
  deckAt(x: number, y: number): number | null {
    const b = this.bridgeAt(x, y);
    return b && bridgeDone(b) ? b.height : null;
  }

  /** Whether a bridge's ends or deck cover this tile, which is where you may step on. */
  onBridge(b: Bridge, x: number, y: number): boolean {
    if ((x === b.ax && y === b.ay) || (x === b.bx && y === b.by)) return true;
    return b.spans.some((s) => s.x === x && s.y === y);
  }

  /**
   * Whether a step is a step along a bridge. You get onto a deck at an end
   * and walk it; you do not climb onto one out of the water underneath.
   */
  bridgeStep(x0: number, y0: number, x1: number, y1: number): boolean {
    // Onto the deck, from an end or from the deck itself.
    const to = this.bridgeAt(x1, y1);
    if (to && bridgeDone(to) && this.onBridge(to, x0, y0)) return true;
    // And off the far end of it again, which is a step down onto solid ground
    // from a deck the terrain underneath knows nothing about.
    const from = this.bridgeAt(x0, y0);
    return !!from && bridgeDone(from) && this.onBridge(from, x1, y1);
  }

  /** Why a bridge of this sort cannot be thrown between these two tiles, or null. */
  bridgeReason(kind: BridgeKind, ax: number, ay: number, bx: number, by: number): string | null {
    const def = BRIDGES[kind];
    const w = this.world;
    if (!w.inBounds(ax, ay) || !w.inBounds(bx, by)) return 'Not there.';
    if (ax !== bx && ay !== by) return 'A bridge runs straight. Pick an end level with this one, north, south, east or west.';
    const span = spanTiles(ax, ay, bx, by);
    if (!span.length) return 'There is nothing between those two. Bridge a gap.';
    if (span.length > def.span) return `A ${def.name.toLowerCase()} spans ${def.span} tiles; that is ${span.length}.`;
    for (const [x, y] of [[ax, ay], [bx, by]]) {
      // The bank of a ravine always shares a corner with the ravine, so what
      // matters is whether you can stand in the middle of the tile, not
      // whether every corner of it is dry.
      if (!w.isPassable(x, y) || w.centerHeight(x, y) < 0) return 'Both ends want dry, solid ground to stand on.';
      if (this.bridgeAt(x, y)) return 'One end is already under a bridge.';
    }
    const ha = w.centerHeight(ax, ay);
    const hb = w.centerHeight(bx, by);
    if (Math.abs(ha - hb) > END_SLOP) return `The two ends are ${Math.abs(ha - hb).toFixed(0)} apart in height. One deck will not meet both; level one of them.`;
    const height = Math.round((ha + hb) / 2);
    for (const [x, y] of span) {
      if (this.bridgeAt(x, y)) return 'Something is already bridged across there.';
      if (this.buildings.buildingAt(x, y)) return 'Not over a building.';
      if (height - w.centerHeight(x, y) < CLEARANCE) return 'That is not a gap, it is ground. Walk it.';
    }
    return null;
  }

  // ---- Traps: what you catch while you are somewhere else. ----

  addTrap(kind: TrapKind, x: number, y: number, sx: number, sy: number, ql: number, material?: string): PlacedTrap {
    const t: PlacedTrap = { id: this.nextTrapId++, x, y, sx, sy, kind, ql, dmg: 0, bait: null, caught: null, checkAt: this.time + CHECK_EVERY, material };
    this.traps.set(t.id, t);
    this.placed.traps.add(t);
    return t;
  }

  removeTrap(id: number): void {
    const t = this.traps.get(id);
    if (!t) return;
    this.placed.traps.remove(t);
    this.traps.delete(id);
  }

  trapAt(x: number, y: number, sx: number, sy: number): PlacedTrap | undefined {
    for (const t of this.placed.traps.at(x, y)) if (t.sx === sx && t.sy === sy) return t;
    return undefined;
  }

  trapsOnTile(x: number, y: number): readonly PlacedTrap[] {
    return this.placed.traps.at(x, y);
  }

  /** Why a trap cannot be set here, or null. */
  trapPlaceReason(x: number, y: number, sx: number, sy: number, kind: TrapKind = 'snare'): string | null {
    if (!this.world.inBounds(x, y)) return 'Not there.';
    if (TRAPS[kind]?.water) {
      // A creel goes in the water, within reach of a bank you can stand on.
      if (waterDepth(this, x, y) < 1) return 'A creel goes in the water. Set it off a bank with some depth to it.';
      if (Math.hypot(x + 0.5 - this.player.x, y + 0.5 - this.player.y) > 3.6) return 'Too far out. Set it within reach of where you stand.';
      if (this.trapAt(x, y, sx, sy)) return 'Something is already there.';
      return null;
    }
    if (this.onDeed(x, y)) return 'Nothing wild comes inside your own borders. Set it out in the country.';
    if (!this.world.isPassable(x, y) || this.world.hasWater(x, y)) return 'A trap needs dry ground it can be covered on.';
    if (this.buildings.buildingAt(x, y)) return 'Not inside a building.';
    if (this.occupiedSubtile(x, y, sx, sy)) return 'Something is already there.';
    return null;
  }

  /** Let whatever is in it go, and say so. */
  springTrap(t: PlacedTrap, why: string): void {
    const c = t.caught !== null ? this.creatures.get(t.caught) : undefined;
    t.caught = null;
    t.bait = null;
    if (c) {
      c.trapped = null;
      c.state = 'flee';
      c.until = this.time + 4;
      this.logMsg(why, 'event');
    }
    this.events.emit('world', t.x, t.y);
  }

  /**
   * Traps, on the clock. They rot where they stand like everything else left
   * out, and every so often a baited one is rolled against whatever wild
   * thing is within reach of the smell of it.
   */
  private runTraps(dt: number): void {
    for (const t of [...this.traps.values()]) {
      t.dmg = Math.min(100, t.dmg + dt * trapDecayRate(t));
      if (t.dmg >= 100) {
        if (t.caught !== null) this.springTrap(t, `The ${trapName(t).toLowerCase()} rots through and whatever was in it walks away.`);
        this.removeTrap(t.id);
        this.logMsg(`A ${trapName(t).toLowerCase()} has rotted through out in the country.`, 'system');
        continue;
      }
      if (!t.bait || this.time < t.checkAt) continue;
      t.checkAt = this.time + CHECK_EVERY;
      if (TRAPS[t.kind]?.water) this.rollCreel(t);
      else if (t.caught === null) this.rollTrap(t);
    }
  }

  /**
   * One roll of a creel. It takes what the water it sits in holds, weighted by
   * whatever is in it, and it goes on filling until it is full or the bait is
   * gone — which is the whole of why a creel is worth weaving.
   */
  private rollCreel(t: PlacedTrap): void {
    const def = TRAPS[t.kind];
    const held = (t.fish ?? []).reduce((a, f) => a + f.count, 0);
    if (held >= (def.hold ?? 8)) return;
    const depth = waterDepth(this, t.x, t.y);
    const pool = fishHere(depth, this.skills.get('fishing'));
    if (!pool.length) return;
    if (this.rand() >= def.odds * (0.6 + Math.max(1, Math.min(100, t.ql)) / 250)) return;
    const bait = t.bait ? BAIT_BY_ID.get(t.bait.id) : undefined;
    const got = pickFish(this, pool, bait);
    if (!got) return;
    t.fish ??= [];
    const ql = Math.max(1, Math.min(100, t.ql * (0.5 + this.rand() * 0.7)));
    const stack = t.fish.find((f) => f.id === got.id);
    if (stack) {
      stack.ql = (stack.ql * stack.count + ql) / (stack.count + 1);
      stack.count += 1;
    } else t.fish.push({ uid: this.inventory.nextUid++, id: got.id, ql, dmg: 0, count: 1 });
    // Every so often the bait is worked out of it and the creel goes on empty.
    if (this.rand() < 0.14 && t.bait) {
      t.bait = null;
      this.logMsg(`The bait is gone out of a creel. It will take nothing more until it is baited again.`, 'system');
    }
    this.events.emit('world', t.x, t.y);
  }

  /** One roll of one trap against the country round it. */
  private rollTrap(t: PlacedTrap): void {
    const bait = t.bait;
    if (!bait) return;
    const [cx, cy] = trapCentre(t);
    const reach = TRAPS[t.kind].reach;
    const holds = trapHolds(t);
    let best: Creature | null = null;
    let bestChance = 0;
    for (const c of this.creatures.list.values()) {
      if (c.mode !== 'wild' || c.trapped !== null) continue;
      if (Math.hypot(c.x - cx, c.y - cy) > reach) continue;
      const s = this.creatures.species(c);
      // Nothing that is not a wildermon walks into a noose for a berry.
      if (s.monster || !isBaitFor(s, bait.id)) continue;
      // Anything warier than the trap will hold simply takes the bait and goes.
      if (s.tameLevel > holds) {
        if (this.rand() < 0.3) {
          t.bait = null;
          this.logMsg(`Something took the bait out of your ${trapName(t).toLowerCase()} and was gone. It was too much trap for.`, 'system');
          return;
        }
        continue;
      }
      const chance = catchChance(t, c);
      if (chance > bestChance) {
        best = c;
        bestChance = chance;
      }
    }
    if (!best || this.rand() >= bestChance) return;
    best.trapped = t.id;
    best.state = 'idle';
    best.enemy = null;
    const [tx, ty] = trapCentre(t);
    best.x = tx;
    best.y = ty;
    t.caught = best.id;
    t.bait = null;
    this.note('caught');
    this.logMsg(`Your ${trapName(t).toLowerCase()} has sprung. There is a ${this.creatures.species(best).name.toLowerCase()} in it.`, 'event');
    this.events.emit('world', t.x, t.y);
  }

  // ---- Work posts: a settlement's worth of orders on a stake, for an hour. ----

  addPost(x: number, y: number, sx: number, sy: number, ql: number, material?: string): PlacedPost {
    const p: PlacedPost = { id: this.nextPostId++, x, y, sx, sy, ql, dmg: 0, worker: null, material };
    this.posts.set(p.id, p);
    this.placed.posts.add(p);
    return p;
  }

  postAt(x: number, y: number, sx: number, sy: number): PlacedPost | undefined {
    for (const p of this.placed.posts.at(x, y)) if (p.sx === sx && p.sy === sy) return p;
    return undefined;
  }

  postsOnTile(x: number, y: number): readonly PlacedPost[] {
    return this.placed.posts.at(x, y);
  }

  /** The post a worker is set to, if it is set to one that is still standing. */
  postOf(c: Creature): PlacedPost | undefined {
    return c.post !== null ? this.posts.get(c.post) : undefined;
  }

  /**
   * Where a wildermon works: the post it is set to, or the settlement. The
   * shape is the same either way, which is what lets one worker loop serve
   * both — only a post keeps its creature on a short rein, and a deed does
   * not.
   */
  workSite(c: Creature): { x: number; y: number; radius: number; post?: number } | null {
    const p = this.postOf(c);
    return p ? postSite(p) : this.deed;
  }

  /** Why a post cannot go in here, or null. */
  postPlaceReason(x: number, y: number, sx: number, sy: number): string | null {
    if (!this.world.inBounds(x, y)) return 'Not there.';
    if (this.onDeed(x, y)) return 'A post is for work away from home. Inside your own borders the token already gives the orders.';
    if (!this.world.isPassable(x, y) || this.world.hasWater(x, y)) return 'A post needs dry, open ground.';
    if (this.world.slope(x, y) > 25) return 'The ground is too steep to drive a post into.';
    if (this.buildings.buildingAt(x, y)) return 'Not inside a building.';
    if (this.occupiedSubtile(x, y, sx, sy)) return 'Something is already standing there.';
    return null;
  }

  /**
   * Take a worker off its post and send it where it belongs: to your side if
   * you are walking alone, to the settlement's keeping if you are not, and
   * back to the wild if you have neither.
   */
  leavePost(p: PlacedPost, why: string): void {
    const c = p.worker !== null ? this.creatures.get(p.worker) : undefined;
    p.worker = null;
    if (!c) return;
    c.post = null;
    c.state = 'idle';
    c.until = this.time;
    c.enemy = null;
    if (!this.creatures.active()) {
      c.mode = 'active';
      this.logMsg(`The post ${why}. ${c.name} comes looking for you.`, 'system');
    } else if (this.deed) {
      // Whatever it was holding goes into the settlement's own crate.
      const crate = this.deedCrate();
      if (c.carrying && crate && this.crateAdd(crate, c.carrying)) c.carrying = null;
      else if (c.carrying) this.dropOnGround(Math.floor(c.x), Math.floor(c.y), c.carrying);
      c.carrying = null;
      c.mode = 'stored';
      c.x = this.deed.x + 0.5;
      c.y = this.deed.y + 1.5;
      this.logMsg(`The post ${why}. ${c.name} goes back to the token of ${this.deed.name}.`, 'system');
    } else {
      c.mode = 'wild';
      this.logMsg(`The post ${why}, and with no settlement to go to and you already spoken for, ${c.name} wanders off.`, 'error');
    }
    this.events.emit('creature');
  }

  /** Take a creature off whatever post it is on, quietly, when it is re-ordered. */
  clearPost(c: Creature): void {
    const p = this.postOf(c);
    if (p) p.worker = null;
    c.post = null;
  }

  removePost(id: number, why = 'is gone'): void {
    const p = this.posts.get(id);
    if (!p) return;
    this.leavePost(p, why);
    this.placed.posts.remove(p);
    this.posts.delete(id);
    this.events.emit('world', p.x, p.y);
  }

  /**
   * Posts rotting where they stand. Nothing holds one up and nothing can be
   * done about it: the only question is whether the work got done first.
   */
  private runPosts(dt: number): void {
    for (const p of [...this.posts.values()]) {
      const before = p.dmg;
      p.dmg = Math.min(100, p.dmg + postDecayRate(p.ql) * dt);
      // One word of warning, once, when it is nearly through.
      if (before < 85 && p.dmg >= 85 && p.worker !== null) {
        const [cx, cy] = postCentre(p);
        this.logMsg(`The ${postName(p).toLowerCase()} at ${Math.floor(cx)}, ${Math.floor(cy)} is leaning badly and has not long left.`, 'error');
      }
      if (p.dmg >= 100) this.removePost(p.id, 'rots through and falls over');
    }
  }

  addCrate(kind: CrateKind, x: number, y: number, sx: number, sy: number, items: Item[] = [], deed = false, material?: string): PlacedCrate {
    const crate: PlacedCrate = { id: this.nextCrateId++, x, y, sx, sy, kind, items, deed, material };
    this.crates.set(crate.id, crate);
    this.placed.crates.add(crate);
    return crate;
  }

  removeCrate(id: number): void {
    const crate = this.crates.get(id);
    if (crate) this.placed.crates.remove(crate);
    this.crates.delete(id);
    this.events.emit('crate');
  }

  crateAt(x: number, y: number, sx: number, sy: number): PlacedCrate | undefined {
    return this.placed.crates.at(x, y).find((c) => c.sx === sx && c.sy === sy);
  }

  cratesOnTile(x: number, y: number): readonly PlacedCrate[] {
    return this.placed.crates.at(x, y);
  }

  /** The settlement's crate, where deed workers deliver. */
  deedCrate(): PlacedCrate | undefined {
    for (const c of this.crates.values()) if (c.deed) return c;
    return undefined;
  }

  /** The crate closest to the player. */
  nearestCrate(range = 3): PlacedCrate | undefined {
    let best: PlacedCrate | undefined;
    let bestD = Infinity;
    this.placed.crates.around(this.player.x, this.player.y, range, (c) => {
      const [cx, cy] = crateCentre(c);
      const d = Math.hypot(cx - this.player.x, cy - this.player.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    });
    return best;
  }

  /** Put the settlement's plank crate on a free spot beside the token. */
  placeDeedCrate(): void {
    const d = this.deed;
    if (!d) return;
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 1],
    ]) {
      const x = d.x + dx;
      const y = d.y + dy;
      if (this.world.inBounds(x, y) && this.world.isPassable(x, y) && !this.world.hasWater(x, y) && !this.buildings.buildingAt(x, y) && !this.crateAt(x, y, 1, 1)) {
        this.addCrate('plank', x, y, 1, 1, [], true);
        return;
      }
    }
    this.addCrate('plank', d.x, d.y, 3, 3, [], true);
  }

  /** Add an item to a crate; false when it would not fit. */
  crateAdd(crate: PlacedCrate, item: Item): boolean {
    if (crateUnits(crate) + item.count > crateCapacity(crate)) return false;
    const def = ITEM_DEFS[item.id];
    const stack = def?.stackable ? crate.items.find((it) => it.id === item.id && it.extra === item.extra && it.piece === item.piece) : undefined;
    if (stack) {
      stack.ql = (stack.ql * stack.count + item.ql * item.count) / (stack.count + item.count);
      stack.count += item.count;
    } else crate.items.push(item);
    this.events.emit('crate');
    return true;
  }

  /**
   * The crate or chest holding this thing, if one is.
   *
   * There has been a way to put a thing into a container and a way to take
   * *everything* out, and nothing in between — so taking one thing out was
   * done by the browser alone, moving the row from one window to the other in
   * its own copy with nobody told. On an island the next answer put it back,
   * which is what "it rubber bands from crate to inventory" was. This is what
   * `take_from_store` asks, so that there is a door.
   *
   * Crates and the chests and barrels that hold things are shown through the
   * same window, and had the same hole in them, so both are looked in.
   */
  storeWith(uid: number): { what: string; at: [number, number]; take: (id: number) => Item | null } | null {
    /*
     * A bag on your back is the third of these, and was missing.
     *
     * It did not show while a bag on an island was always empty, and would
     * have the moment its contents came down: the window would have moved the
     * row in this browser's copy and the next answer would have put it back.
     * A worn bag is never out of reach, so it stands where you do.
     */
    const bag = this.inventory.bagWith(uid);
    if (bag) {
      return {
        what: itemDef(bag.id).name.toLowerCase(),
        at: [this.player.x, this.player.y],
        take: (id) => {
          const got = bagTake(bag, id);
          if (got) this.inventory.addItem(got);
          this.events.emit('inventory');
          return got;
        },
      };
    }
    for (const c of this.crates.values()) {
      if (!c.items.some((it) => it.uid === uid)) continue;
      return { what: crateName(c).toLowerCase(), at: crateCentre(c), take: (id) => this.crateTake(c, id) };
    }
    for (const f of this.furniture.values()) {
      if (!f.items.some((it) => it.uid === uid)) continue;
      return {
        what: furnitureName(f).toLowerCase(),
        at: [f.x + 0.5, f.y + 0.5],
        take: (id) => this.furnitureTake(f, id),
      };
    }
    return null;
  }

  crateTake(crate: PlacedCrate, uid: number): Item | null {
    const idx = crate.items.findIndex((it) => it.uid === uid);
    if (idx < 0) return null;
    const [item] = crate.items.splice(idx, 1);
    this.events.emit('crate');
    return item;
  }

  addCampfire(x: number, y: number, sx: number, sy: number, fuel = 0, lit = false): PlacedCampfire {
    const [ax, ay] = fireAnchor(sx, sy);
    const fire: PlacedCampfire = { id: this.nextFireId++, x, y, sx: ax, sy: ay, fuel, lit };
    this.campfires.set(fire.id, fire);
    this.placed.campfires.add(fire);
    this.events.emit('crate');
    return fire;
  }

  removeCampfire(id: number): void {
    const fire = this.campfires.get(id);
    if (fire) this.placed.campfires.remove(fire);
    this.campfires.delete(id);
    this.events.emit('crate');
  }

  campfiresOnTile(x: number, y: number): readonly PlacedCampfire[] {
    return this.placed.campfires.at(x, y);
  }

  /** The fire covering a subtile, if any. */
  campfireAt(x: number, y: number, sx: number, sy: number): PlacedCampfire | undefined {
    return this.placed.campfires.at(x, y).find((f) => fireCovers(f, sx, sy));
  }

  /** Why a campfire cannot go on this spot, or null when it can. */
  firePlaceReason(x: number, y: number, sx: number, sy: number): string | null {
    const [ax, ay] = fireAnchor(sx, sy);
    if (!this.world.isPassable(x, y) || this.world.hasWater(x, y)) return 'A fire needs dry, open ground.';
    if (this.world.slope(x, y) > 20) return 'The ground is too steep to lay a fire.';
    if (this.isToken(x, y)) return 'Not on the token.';
    if (this.buildings.buildingAt(x, y)) return 'Not inside a building.';
    for (let dy = 0; dy < FIRE_SUBTILES; dy++) {
      for (let dx = 0; dx < FIRE_SUBTILES; dx++) {
        if (this.crateAt(x, y, ax + dx, ay + dy)) return 'A crate is standing in the way.';
        if (this.campfireAt(x, y, ax + dx, ay + dy)) return 'There is already a fire there.';
      }
    }
    return null;
  }

  /** The nearest lit fire within reach, for cooking. */
  litFireNear(range = 2.4): PlacedCampfire | undefined {
    let best: PlacedCampfire | undefined;
    let bestD = range;
    this.placed.campfires.around(this.player.x, this.player.y, range + 1, (f) => {
      if (!f.lit) return;
      const [cx, cy] = fireCentre(f);
      const d = Math.hypot(cx - this.player.x, cy - this.player.y);
      if (d <= bestD) {
        bestD = d;
        best = f;
      }
    });
    return best;
  }

  /** Whether the player is standing somewhere a recipe's station requires. */
  atStation(station: Station): boolean {
    if (station === 'campfire') return this.litFireNear() !== undefined || this.hotOvenNear() !== undefined;
    if (station === 'smelter') return this.hotSmelterNear() !== undefined;
    return this.furnitureNear(station) !== undefined;
  }

  /** The nearest piece of furniture of a kind, within arm's reach. */
  furnitureNear(kind: string, range = 2.4): PlacedFurniture | undefined {
    let best: PlacedFurniture | undefined;
    this.placed.furniture.around(this.player.x, this.player.y, range + 2, (f) => {
      if (best || f.kind !== kind) return;
      const [cx, cy] = furnitureCentre(f);
      if (Math.hypot(cx - this.player.x, cy - this.player.y) <= range) best = f;
    });
    return best;
  }

  /** The nearest smelter that is lit and within reach. */
  hotSmelterNear(range = 2.6): PlacedSmelter | undefined {
    let best: PlacedSmelter | undefined;
    this.placed.smelters.around(this.player.x, this.player.y, range + 1, (s) => {
      if (best || !s.lit) return;
      const [cx, cy] = smelterCentre(s);
      if (Math.hypot(cx - this.player.x, cy - this.player.y) <= range) best = s;
    });
    return best;
  }

  /** The nearest oven that is alight and within reach of the work. */
  hotOvenNear(range = 2.6): PlacedFurniture | undefined {
    let best: PlacedFurniture | undefined;
    this.placed.furniture.around(this.player.x, this.player.y, range + 2, (f) => {
      if (best || !f.lit || !furnitureDef(f.kind).hearth) return;
      const [cx, cy] = furnitureCentre(f);
      if (Math.hypot(cx - this.player.x, cy - this.player.y) <= range) best = f;
    });
    return best;
  }

  /** Litres a well draws in a second: a deep, true-lined shaft finds more water. */
  wellRate(f: PlacedFurniture): number {
    return 0.012 + (f.ql / 100) * 0.055;
  }

  /** Comb a hive draws in a second for each swarm keeping it. */
  hiveRate(f: PlacedFurniture): number {
    return 0.004 + (f.ql / 100) * 0.012;
  }

  /**
   * Swarms kept on the deed. A Vesp is not put to work like the other
   * wildermon: all it does is live here, and a hive within reach of where it
   * lives fills itself. Three of them is as much as one hive can hold with.
   */
  private swarms(): number {
    let n = 0;
    for (const c of this.creatures.list.values()) {
      if (c.mode !== 'deed' && c.mode !== 'active') continue;
      if (!this.creatures.species(c).hives || !this.onDeed(c.x, c.y)) continue;
      if (++n >= 3) break;
    }
    return n;
  }

  /** Three parts honey to one of wax, which is about what a comb is. */
  private fillHive(f: PlacedFurniture, swarms: number, dt: number): void {
    let comb = (f.comb ?? 0) + this.hiveRate(f) * swarms * dt;
    let made = 0;
    while (comb >= 1 && hiveRoom(f) > 0) {
      comb -= 1;
      const id = this.rand() < 0.25 ? 'wax' : 'honey';
      const ql = Math.min(100, Math.max(1, f.ql * (0.7 + this.rand() * 0.6)));
      this.furnitureAdd(f, { uid: this.inventory.nextUid++, id, ql, dmg: 0, count: 1 });
      made++;
    }
    f.comb = comb;
    if (made) this.events.emit('crate');
  }

  /**
   * Everything placed that works by itself: ovens burning down, wells filling,
   * rubbish rotting where it was thrown, and a cart following you about.
   */
  private runPlaceables(dt: number): void {
    // Counted the first time a hive with room in it asks, and not at all
    // when there is no hive on the deed.
    let swarms = -1;
    for (const f of this.furniture.values()) {
      const def = furnitureDef(f.kind);
      if (def.hearth && f.lit) {
        f.ash = (f.ash ?? 0) + Math.min(f.fuel ?? 0, dt) * ASH_RATE;
        f.fuel = (f.fuel ?? 0) - dt;
        if ((f.fuel ?? 0) <= 0) {
          f.fuel = 0;
          f.lit = false;
          this.logMsg('The oven burns down and goes cold.', 'event');
          this.events.emit('world', f.x, f.y);
        }
      }
      if (def.hive && hiveRoom(f) > 0 && this.onDeed(f.x, f.y)) {
        if (swarms < 0) swarms = this.swarms();
        if (swarms > 0) this.fillHive(f, swarms, dt);
      }
      if (f.ferment !== undefined && f.ferment > 0) {
        f.ferment = Math.max(0, f.ferment - dt);
        if (f.ferment === 0) {
          this.logMsg(`The ${furnitureName(f).toLowerCase()} has stopped working. There is ${LIQUID_NAME[f.liquid ?? 'water']} in it.`, 'event');
          this.events.emit('crate');
        }
      }
      if (def.well) {
        const before = f.litres ?? 0;
        if (before < def.well) {
          f.litres = Math.min(def.well, before + this.wellRate(f) * dt);
          f.liquid = 'water';
          if (Math.floor(f.litres) !== Math.floor(before)) this.events.emit('crate');
        }
      }
      if (def.trash && f.items.length) {
        // A trash crate is built to rot: what goes in it ages many times over.
        const hours = (dt / 3600) * def.trash;
        for (let i = f.items.length - 1; i >= 0; i--) {
          const item = f.items[i];
          item.dmg = Math.min(100, item.dmg + groundDecayRate(item) * hours);
          if (item.dmg < 100) continue;
          f.items.splice(i, 1);
          this.events.emit('crate');
        }
      }
      if (f.hitched) this.dragCart(f);
      // A cart goes at the pace of whoever has its reins, which on a shared
      // island is not always the person sitting at this screen.
      if (def.vehicle && teamOf(f).length) this.haulVehicle(f, dt, this.actors.get(f.driverId ?? this.local.id)?.stepped ?? 0);
      if (def.boat && f.driven) this.floatBoat(f);
    }
  }

  /**
   * The one vehicle the player is driving, if any. Nothing else in the world
   * can be driven at the same time, which is what keeps this a lookup.
   */
  driving(): PlacedFurniture | undefined {
    const me = this.acting.id;
    for (const f of this.furniture.values()) if (f.driven && (f.driverId ?? me) === me) return f;
    return undefined;
  }

  /** The wildermon in the traces of a vehicle, dead ones dropped. */
  team(f: PlacedFurniture): Creature[] {
    const out: Creature[] = [];
    for (const id of teamOf(f)) {
      const c = this.creatures.get(id);
      if (c) out.push(c);
    }
    return out;
  }

  /**
   * How fast a team takes a vehicle along, in tiles a second. The animals
   * decide it and nothing else: a quick one gets there sooner, more of them
   * pull better than fewer, a practised one finds its feet, and a hungry one
   * drags. What is loaded on the back has no say at all, which is the whole
   * point of putting it there.
   */
  vehicleSpeed(f: PlacedFurniture): number {
    const v = vehicleOf(f);
    const team = this.team(f);
    if (!v || team.length < v.needs) return 0;
    let sum = 0;
    let worst = 1;
    for (const c of team) {
      sum += this.creatures.species(c).speed * ageDef(c, this.time).speed * this.creatures.speedMul(c);
      worst = Math.min(worst, 0.6 + 0.4 * c.hunger);
    }
    const mean = sum / team.length;
    // Every beast adds its own share of the pull; the ones bred for it add more.
    let pull = 0.75;
    for (const c of team) pull += (this.creatures.species(c).pull ?? 0.25) * ageDef(c, this.time).pull * bloodMul(c, 'haul');
    // A body of light wood rolls a shade easier than one of oak, which is the
    // price oak charges for holding more and lasting longer.
    return Math.min(MAX_VEHICLE_SPEED, mean * pull * worst * footing(this.teamClimb(f)) * rollEase(f.material));
  }

  /** How full a vehicle is, 0..1. An empty one rolls over anything. */
  vehicleLoad(f: PlacedFurniture): number {
    const cap = furnitureCapacity(f);
    return cap ? Math.min(1, furnitureUnits(f) / cap) : 0;
  }

  /** What a team knows about hills between them, which is what a slope asks. */
  teamClimb(f: PlacedFurniture): number {
    const team = this.team(f);
    if (!team.length) return 0;
    let sum = 0;
    for (const c of team) sum += c.skills[HAUL_SKILL] ?? 0;
    return sum / team.length;
  }

  /**
   * The steepest step a vehicle will take, in height units. Wheels start off
   * worse than a walker and a trained team ends up better: what a draught
   * beast learns in the traces is which lines it can hold.
   */
  vehicleStep(f: PlacedFurniture | undefined): number {
    return VEHICLE_STEP + (f ? this.teamClimb(f) * CLIMB_PITCH : 0);
  }

  /** The wildermon the player is up on, if any. */
  mounted(): Creature | undefined {
    for (const c of this.creatures.list.values()) if (c.ridden) return c;
    return undefined;
  }

  /** How fast a mount carries a rider: its own pace, steadied by practice. */
  mountSpeed(c: Creature): number {
    const def = this.creatures.species(c);
    // Shod, it goes quicker on laid stone and gravel.
    const shod = isShod(this.time, c) && !!TILE_DEFS[this.world.getTile(this.player.tileX, this.player.tileY)].paved ? SHOE_PACE : 1;
    return Math.min(MAX_MOUNT_SPEED, def.speed * ageDef(c, this.time).speed * this.creatures.speedMul(c) * footing(c.skills[HAUL_SKILL] ?? 0) * (0.6 + 0.4 * c.hunger) * shod);
  }

  /**
   * The steepest step a mount will take. A green one is no worse than your own
   * legs and a worked one goes up what you would have to go round, which is
   * what the climbing it earns on bad ground is for.
   */
  mountStep(c: Creature): number {
    const sure = this.creatures.species(c).pitch ?? 1;
    return MAX_STEP + (c.skills[HAUL_SKILL] ?? 0) * CLIMB_PITCH * 2 * sure + (isShod(this.time, c) ? SHOE_STEP : 0);
  }

  /** The steepest tile a mount will carry a rider onto: the standing cap, raised by whatever raises its step. */
  mountStand(c: Creature): number {
    return MAX_STAND + this.mountStep(c) - MAX_STEP;
  }

  /** Get up on a saddled wildermon. */
  mount(c: Creature): boolean {
    if (!this.creatures.species(c).mount || !c.tacked || c.hitchedTo !== null || this.driving()) return false;
    const up = this.mounted();
    if (up) up.ridden = false;
    c.ridden = true;
    c.enemy = null;
    c.state = 'idle';
    c.x = this.player.x;
    c.y = this.player.y;
    this.events.emit('creature');
    return true;
  }

  /** Get down again, wherever the pair of you have got to. */
  dismount(): void {
    const c = this.mounted();
    if (!c) return;
    c.ridden = false;
    c.moving = false;
    this.player.speedMul = 1;
    this.player.stop();
    this.events.emit('creature');
  }

  // ---- What the errand workers need to know about the world. ----

  /** A barrel on the deed with room in it for more water. */
  thirstyVessel(): PlacedFurniture | undefined {
    for (const f of this.furniture.values()) {
      const def = furnitureDef(f.kind);
      if (!def.liquid || !this.onDeed(f.x, f.y)) continue;
      if ((f.litres ?? 0) >= def.liquid) continue;
      if (f.liquid && f.liquid !== 'water') continue;
      return f;
    }
    return undefined;
  }

  /** Pour a measure into a vessel, which is what a bucket does at either end. */
  pourInto(f: PlacedFurniture, litres: number, liquid: LiquidKind): void {
    const cap = furnitureDef(f.kind).liquid ?? 0;
    f.liquid = liquid;
    f.litres = Math.min(cap, (f.litres ?? 0) + litres);
    this.events.emit('crate');
    this.events.emit('world', f.x, f.y);
  }

  /** Somewhere within reach worth dipping into: a well, or open water. */
  waterSource(fromX: number, fromY: number, range: number, near: (x: number, y: number) => boolean): { x: number; y: number; well?: PlacedFurniture } | undefined {
    for (const f of this.furniture.values()) {
      if (!furnitureDef(f.kind).well || (f.litres ?? 0) < 1 || !this.onDeed(f.x, f.y)) continue;
      const [cx, cy] = furnitureCentre(f);
      return { x: cx, y: cy, well: f };
    }
    const r = Math.ceil(range);
    let best: { x: number; y: number } | undefined;
    let bestD = Infinity;
    for (let y = Math.floor(fromY) - r; y <= Math.floor(fromY) + r; y++) {
      for (let x = Math.floor(fromX) - r; x <= Math.floor(fromX) + r; x++) {
        if (!this.world.inBounds(x, y) || !this.world.hasWater(x, y) || !near(x, y)) continue;
        const d = Math.hypot(x + 0.5 - fromX, y + 0.5 - fromY);
        if (d < bestD) {
          bestD = d;
          best = { x: x + 0.5, y: y + 0.5 };
        }
      }
    }
    return best;
  }

  /** Take a measure out of a well, as a bucket would. */
  drawFromWell(f: PlacedFurniture, litres: number): void {
    f.litres = Math.max(0, (f.litres ?? 0) - litres);
    this.events.emit('crate');
  }

  /** An unfinished wall within reach that wants something, and what it wants. */
  wallNeeding(near: (x: number, y: number) => boolean, holding?: string): { wall: Wall; item: string; x: number; y: number } | undefined {
    for (const wall of this.buildings.walls.values()) {
      if (wall.level !== 0 || isDone(wall)) continue;
      if (!near(wall.x, wall.y)) continue;
      const wants = Object.entries(wall.needed).filter(([, n]) => n > 0);
      if (!wants.length) continue;
      const pick = holding ? wants.find(([id]) => id === holding) : undefined;
      const [item] = pick ?? wants[0];
      return { wall, item, x: wall.x, y: wall.y };
    }
    return undefined;
  }

  /** Fit one piece into a planned wall, the way a builder does by hand. */
  fitIntoWall(wall: Wall, item: string): void {
    if ((wall.needed[item] ?? 0) <= 0) return;
    wall.needed[item] -= 1;
    this.events.emit('world', wall.x, wall.y);
  }

  /** The most knocked-about thing in the deed's stores, and where it is kept. */
  damagedInStores(): { store: DeedStore; item: Item } | undefined {
    let best: { store: DeedStore; item: Item } | undefined;
    for (const store of this.deedStores()) {
      for (const item of store.items) {
        if (item.dmg <= 1) continue;
        if (!best || item.dmg > best.item.dmg) best = { store, item };
      }
    }
    return best;
  }

  /** Ground a sprout would take: open, dry and nothing standing on it. */
  plantableTile(x: number, y: number): boolean {
    if (!this.world.inBounds(x, y) || this.world.hasWater(x, y)) return false;
    if (this.buildings.buildingAt(x, y) || this.isToken(x, y)) return false;
    if (this.cratesOnTile(x, y).length || this.furnitureOnTile(x, y).length) return false;
    return PLANTABLE.has(this.world.getTile(x, y));
  }

  /**
   * Somewhere in range worth putting a tree, kept clear of its neighbours and
   * as near the planter as the ground allows. A worker that walks half a deed
   * to put one sprout in never gets to the second.
   */
  plantingSpot(cx: number, cy: number, range: number, near: (x: number, y: number) => boolean, fromX = cx, fromY = cy): { x: number; y: number } | undefined {
    const r = Math.ceil(range);
    let best: { x: number; y: number } | undefined;
    let bestD = Infinity;
    for (let i = 0; i < 60; i++) {
      const x = Math.round(cx + (this.rand() * 2 - 1) * r);
      const y = Math.round(cy + (this.rand() * 2 - 1) * r);
      if (!near(x, y) || !this.plantableTile(x, y)) continue;
      const d = Math.hypot(x - fromX, y - fromY);
      if (d >= bestD) continue;
      let crowded = false;
      for (let dy = -1; dy <= 1 && !crowded; dy++) for (let dx = -1; dx <= 1; dx++) if (this.world.getTile(x + dx, y + dy) === TileType.Tree) crowded = true;
      if (crowded) continue;
      bestD = d;
      best = { x, y };
    }
    return best;
  }

  /** Put a sprout in the ground, as the player's own planting would. */
  plantSprout(x: number, y: number, species: string | undefined): void {
    if (!this.plantableTile(x, y)) return;
    const i = Math.max(0, TREE_DEFS.findIndex((d) => d.name === species));
    this.world.setTile(x, y, TileType.Tree, packTreeData(i, 0));
  }

  /**
   * A tile in range worth reading, for a prospector to walk out to: the
   * nearest ground a stride or more from where it is standing, so it works
   * its way across the country rather than across it and back.
   */
  unreadGround(cx: number, cy: number, range: number, near: (x: number, y: number) => boolean, fromX = cx, fromY = cy): { x: number; y: number } | undefined {
    const r = Math.ceil(range);
    let best: { x: number; y: number } | undefined;
    let bestD = Infinity;
    for (let i = 0; i < 60; i++) {
      const x = Math.round(cx + (this.rand() * 2 - 1) * r);
      const y = Math.round(cy + (this.rand() * 2 - 1) * r);
      if (!near(x, y) || !this.world.inBounds(x, y) || this.world.hasWater(x, y)) continue;
      if (!this.world.isPassable(x, y)) continue;
      const d = Math.hypot(x - fromX, y - fromY);
      if (d < PROSPECT_STRIDE || d >= bestD) continue;
      bestD = d;
      best = { x, y };
    }
    return best;
  }

  /** Read the ground around a point and light up any metal under it. */
  readGround(by: Creature, x: number, y: number, radius: number): void {
    const found: number[] = [];
    const names = new Set<string>();
    for (let ty = y - radius; ty <= y + radius; ty++) {
      for (let tx = x - radius; tx <= x + radius; tx++) {
        if (!this.world.inBounds(tx, ty)) continue;
        const ore = oreAt(this.world, tx, ty);
        if (!ore) continue;
        found.push(ty * this.world.w + tx);
        names.add(ore.name.toLowerCase());
      }
    }
    if (!found.length) return;
    this.markProspected(found);
    if (this.time - by.noRoomAt < 30) return;
    by.noRoomAt = this.time;
    this.logMsg(`${by.name} scratches at the ground and stands over ${[...names].join(' and ')}.`, 'event');
  }

  /** Something rotting on the ground in reach, for whatever eats such things. */
  rottingNear(near: (x: number, y: number) => boolean): { x: number; y: number; uid: number } | undefined {
    for (const [key, pile] of this.ground) {
      const [x, y] = key.split(',').map(Number);
      if (!near(x, y)) continue;
      const item = pile.find((it) => it.id === 'corpse' || it.dmg >= 40);
      if (item) return { x, y, uid: item.uid };
    }
    return undefined;
  }

  /**
   * The nearest vehicle to a point with a yoke still free, within reach of
   * somebody standing there.
   */
  vehicleNear(x: number, y: number, range = 5): PlacedFurniture | undefined {
    let best: PlacedFurniture | undefined;
    let bestD = Infinity;
    this.placed.furniture.around(x, y, range, (f) => {
      const v = vehicleOf(f);
      if (!v || teamOf(f).length >= v.yokes) return;
      const [cx, cy] = furnitureCentre(f);
      const d = Math.hypot(cx - x, cy - y);
      if (d <= range && d < bestD) {
        bestD = d;
        best = f;
      }
    });
    return best;
  }

  /** The vehicle a wildermon is in the traces of. */
  vehicleOfCreature(c: Creature): PlacedFurniture | undefined {
    return c.hitchedTo === null ? undefined : this.furniture.get(c.hitchedTo);
  }

  /** Put a wildermon in a vehicle's traces. */
  hitch(c: Creature, f: PlacedFurniture): boolean {
    const v = vehicleOf(f);
    if (!v || c.hitchedTo !== null || c.ridden || teamOf(f).length >= v.yokes) return false;
    if (c.mode === 'stored') {
      // Fetched out of the token and walked round to the front.
      const [cx, cy] = furnitureCentre(f);
      c.x = cx;
      c.y = cy;
      c.mode = this.deed ? 'deed' : 'active';
    }
    f.team = [...teamOf(f), c.id];
    c.hitchedTo = f.id;
    c.carrying = null;
    c.enemy = null;
    c.state = 'idle';
    this.events.emit('world', f.x, f.y);
    this.events.emit('creature');
    return true;
  }

  /** Take a wildermon out of the traces, wherever it is standing. */
  unhitch(c: Creature): void {
    const f = this.vehicleOfCreature(c);
    c.hitchedTo = null;
    if (!f) return;
    f.team = teamOf(f).filter((id) => id !== c.id);
    if (!f.team.length && f.driven) this.leaveVehicle(f);
    this.events.emit('world', f.x, f.y);
    this.events.emit('creature');
  }

  /** Everything out of the traces at once, when the driver is done with it. */
  unhitchAll(f: PlacedFurniture): number {
    const team = this.team(f);
    for (const c of team) c.hitchedTo = null;
    f.team = [];
    if (f.driven) this.leaveVehicle(f);
    this.events.emit('world', f.x, f.y);
    this.events.emit('creature');
    return team.length;
  }

  /** Get down off a vehicle, leaving it where it stands. */
  leaveVehicle(f: PlacedFurniture): void {
    f.driven = false;
    this.player.speedMul = 1;
    this.player.stop();
    this.events.emit('world', f.x, f.y);
  }

  /**
   * Keep a mount under its rider, and let the work teach it something. A
   * beast learns the hills by being taken over them, which is the same thing
   * that happens in the traces.
   */
  private carryRider(c: Creature, dt: number, moved: number): void {
    c.x = this.player.x;
    c.y = this.player.y;
    c.dirX = this.player.dirX;
    c.dirY = this.player.dirY;
    c.moving = this.player.moving;
    if (!this.player.moving) return;
    c.walkPhase += dt * 10;
    c.hunger = Math.max(0, c.hunger - dt * HAUL_HUNGER);
    this.workClimb(c, moved);
  }

  /**
   * What a draught beast picks up from a stretch of ground: nothing on the
   * flat, and something worth having on a slope, which is why a hill team is
   * made on hills.
   */
  workClimb(c: Creature, moved: number): void {
    if (moved <= 0) return;
    const grade = Math.abs(this.world.heightAt(c.x, c.y) - this.world.heightAt(c.x - this.player.dirX * 0.5, c.y - this.player.dirY * 0.5));
    this.creatures.gainSkill(this, c, HAUL_SKILL, moved * (0.05 + Math.min(0.5, grade / 12)));
  }

  /** Whether a vehicle could stand on a tile: solid, dry, level enough ground. */
  vehicleGround(x: number, y: number): boolean {
    const w = this.world;
    if (!w.inBounds(x, y) || !w.isPassable(x, y) || w.hasWater(x, y)) return false;
    return !this.buildings.buildingAt(x, y);
  }

  /**
   * Move a hitched team, and the vehicle under the driver with it. A vehicle
   * being driven sits wherever the player does — they are on the seat — and
   * the team walks a length ahead of it, spread across the yokes.
   */
  /** Keep the hull under whoever is sitting in it. */
  private floatBoat(f: PlacedFurniture): void {
    const def = furnitureDef(f.kind);
    const x = Math.floor(this.player.x);
    const y = Math.floor(this.player.y);
    if (!this.launchSpot(f.kind, x, y)) return;
    const [sx, sy] = subtileOf(x, y, this.player.x, this.player.y);
    const [ax, ay] = furnitureAnchor(f.kind, sx - Math.floor(def.w / 2), sy - Math.floor(def.h / 2));
    if (f.x === x && f.y === y && f.sx === ax && f.sy === ay) return;
    const from = { x: f.x, y: f.y };
    f.x = x;
    f.y = y;
    f.sx = ax;
    f.sy = ay;
    this.placed.furniture.moved(f, from.x, from.y);
    this.events.emit('world', from.x, from.y);
    this.events.emit('world', f.x, f.y);
  }

  private haulVehicle(f: PlacedFurniture, dt: number, moved: number): void {
    const team = this.team(f);
    // Anything that died or was let go in the meantime leaves its yoke empty.
    if (team.length !== teamOf(f).length) f.team = team.map((c) => c.id);
    // A parked team stands where it was left; nothing moves without a driver.
    if (!f.driven) return;
    const def = furnitureDef(f.kind);
    const x = Math.floor(this.player.x);
    const y = Math.floor(this.player.y);
    if (this.vehicleGround(x, y)) {
      const [sx, sy] = subtileOf(x, y, this.player.x, this.player.y);
      const [ax, ay] = furnitureAnchor(f.kind, sx - Math.floor(def.w / 2), sy - Math.floor(def.h / 2));
      if (f.x !== x || f.y !== y || f.sx !== ax || f.sy !== ay) {
        const from = { x: f.x, y: f.y };
        f.x = x;
        f.y = y;
        f.sx = ax;
        f.sy = ay;
        this.placed.furniture.moved(f, from.x, from.y);
        this.events.emit('world', from.x, from.y);
        this.events.emit('world', f.x, f.y);
      }
    }
    // The team keeps its line whether the wheels are turning or not, so a
    // halted cart still has its animals stood in front of it rather than under.
    const [cx, cy] = furnitureCentre(f);
    const moving = this.player.moving;
    const len = Math.hypot(this.player.dirX, this.player.dirY) || 1;
    const fx = this.player.dirX / len;
    const fy = this.player.dirY / len;
    for (let i = 0; i < team.length; i++) {
      const c = team[i];
      // Abreast of one another, a pace and a half ahead of the shafts.
      const off = team.length === 1 ? 0 : (i / (team.length - 1) - 0.5) * 1.6;
      const tx = cx + fx * TRACE_LENGTH - fy * off;
      const ty = cy + fy * TRACE_LENGTH + fx * off;
      if (this.world.inBounds(Math.floor(tx), Math.floor(ty)) && this.world.isPassable(Math.floor(tx), Math.floor(ty))) {
        c.x = tx;
        c.y = ty;
      } else {
        c.x = cx;
        c.y = cy;
      }
      c.moving = moving;
      if (moving) {
        c.dirX = fx;
        c.dirY = fy;
        c.walkPhase += dt * 12;
        // Hauling is work, and work is hungry — and it teaches the hills.
        c.hunger = Math.max(0, c.hunger - dt * HAUL_HUNGER);
        if (c.skills[HAUL_SKILL] !== undefined) this.workClimb(c, moved);
      }
      c.enemy = null;
      c.state = 'idle';
    }
  }

  /** Keep a hitched cart at the player's heels, a step behind wherever they are. */
  private dragCart(f: PlacedFurniture): void {
    const def = furnitureDef(f.kind);
    const [cx, cy] = furnitureCentre(f);
    const dx = this.player.x - cx;
    const dy = this.player.y - cy;
    if (Math.hypot(dx, dy) < 0.9) return;
    const x = Math.floor(this.player.x);
    const y = Math.floor(this.player.y);
    if (!this.world.inBounds(x, y) || !this.world.isPassable(x, y) || this.world.hasWater(x, y)) return;
    const [sx, sy] = subtileOf(x, y, this.player.x, this.player.y);
    const [ax, ay] = furnitureAnchor(f.kind, sx - Math.floor(def.w / 2), sy - Math.floor(def.h / 2));
    if (f.x === x && f.y === y && f.sx === ax && f.sy === ay) return;
    const from = { x: f.x, y: f.y };
    f.x = x;
    f.y = y;
    f.sx = ax;
    f.sy = ay;
    this.placed.furniture.moved(f, from.x, from.y);
    this.events.emit('world', from.x, from.y);
    this.events.emit('world', f.x, f.y);
  }

  /** Burn down every lit fire; one that runs out goes cold. */
  private burnFires(dt: number): void {
    for (const f of this.campfires.values()) {
      if (!f.lit) continue;
      f.ash = (f.ash ?? 0) + Math.min(f.fuel, dt) * ASH_RATE;
      f.fuel -= dt;
      if (f.fuel > 0) continue;
      f.fuel = 0;
      f.lit = false;
      this.logMsg('A campfire burns down to ashes.', 'event');
      this.events.emit('world', f.x, f.y);
      this.events.emit('crate');
    }
    /*
     * And the braziers, which light themselves.
     *
     * A brazier exists to be a light, so leaving it burning through the
     * afternoon is fuel spent on nothing and asking somebody to walk round
     * their deed twice a day is a chore rather than a feature. One with fuel
     * in it takes at dusk and is raked out at dawn.
     *
     * Only braziers. An oven burns while somebody is baking and stops when
     * they stop, and an oven that lit itself every night would be an oven
     * nobody could keep fuel in.
     */
    const night = this.isNight();
    for (const f of this.furniture.values()) {
      if (f.kind !== 'brazier') continue;
      if (f.lit) {
        f.fuel = Math.max(0, (f.fuel ?? 0) - dt * brazierBurn(f.ql ?? 20));
        if (f.fuel <= 0) {
          f.lit = false;
          this.logMsg('A brazier burns down and goes dark.', 'event');
          this.events.emit('world', f.x, f.y);
        } else if (!night) {
          f.lit = false;
          this.events.emit('world', f.x, f.y);
        }
      } else if (night && (f.fuel ?? 0) > 0) {
        f.lit = true;
        this.events.emit('world', f.x, f.y);
      }
    }
  }

  /**
   * Bring the tiles around a corner in line with the soil left on it: strip
   * the last dirt from all four corners of a tile and its bedrock shows.
   */
  exposeRock(cx: number, cy: number): void {
    this.world.reconcileAround(cx, cy);
  }

  /**
   * Everything the island has on the ground here, in one word.
   *
   * The browser never asked. `placed` has been there since the island was
   * built and nothing under `src/` ever read it, so on a live island every
   * campfire, smelter, kiln, anvil, work post, trap and stick of furniture
   * anybody had ever set down was in Postgres and invisible — and so was every
   * crate, and so was the settlement. "Placed campfire doesn't show": it was
   * there, and nothing had ever been told to look.
   *
   * Replaces rather than merges, like the wildlife: what is not in the answer
   * is out of the range we asked about or gone, and either way it is not here.
   * Ids are the island's, which is what makes replacing safe — the same fire
   * comes back as the same fire.
   */
  sawGround(ground: IslandGround, aged: Aged = UNLIT): void {
    /*
     * What is lying on the ground, which until now the island never said.
     *
     * Reported as "killed a roxxa, no corpse dropped to butcher, or at least
     * isn't displaying". The corpse was there: the island drops one where
     * the thing fell, and the suite has measured it since kills were ported.
     * Nothing carried it: `rpc_ground` sent the fires, the crates, the crops
     * and the walls and never a thing lying on the grass, and this map was
     * only ever written by the browser's own rules, which do not run on an
     * island. So a corpse, a log a worker put down, a hatchet somebody else
     * dropped — all in Postgres and drawn by nobody.
     *
     * Replaced outright, like the rest of the fast half: what is not in the
     * answer has been picked up, has rotted, or is out of range. Ids are the
     * island's, so a pile clicked is the row the island will be asked about.
     */
    if (ground.lying) {
      this.ground.clear();
      for (const row of ground.lying) {
        const key = `${row.gx},${row.gy}`;
        const pile = this.ground.get(key) ?? [];
        pile.push(packed(row, aged));
        this.ground.set(key, pile);
      }
    }
    this.crates.clear();
    this.campfires.clear();
    this.smelters.clear();
    this.kilns.clear();
    this.furniture.clear();
    this.anvils.clear();
    this.posts.clear();
    this.traps.clear();
    this.placed.posts.reset([]);
    this.placed.traps.reset([]);
    for (const r of ground.placed ?? []) {
      /*
       * `mine` rides along with everything set down.
       *
       * The island has always said whose each thing is and the browser threw
       * it away here, which is how "launch a boat" and "raise an altar" came
       * to be ticked off in one person's journal by another person's work.
       * Absent means the single-player game, where everything is yours because
       * there is only you.
       */
      const at = { id: r.id, x: r.x, y: r.y, sx: r.sx, sy: r.sy, mine: r.mine };
      if (r.kind === 'campfire' || r.kind === 'fire') {
        this.campfires.set(r.id, { ...at, fuel: r.fuel ?? 0, lit: !!r.lit, ash: r.ash ?? 0 });
      } else if (r.kind === 'smelter') {
        this.smelters.set(r.id, {
          ...at, ql: r.ql ?? 20, fuel: r.fuel ?? 0, lit: !!r.lit, ash: r.ash ?? 0,
          jobs: furnaceJobs(r.state?.jobs),
          output: furnaceOutput(r.id, r.state?.output),
        });
      } else if (r.kind === 'kiln') {
        this.kilns.set(r.id, {
          ...at, ql: r.ql ?? 20, fuel: r.fuel ?? 0, lit: !!r.lit, ash: r.ash ?? 0,
          jobs: furnaceJobs(r.state?.jobs),
          output: furnaceOutput(r.id, r.state?.output),
        });
      } else if (r.kind === 'anvil') {
        this.anvils.set(r.id, { ...at, ql: r.ql ?? 20, metal: r.material ?? 'iron' });
      } else if (r.kind === 'post') {
        const p: PlacedPost = { ...at, ql: r.ql ?? 20, dmg: r.dmg ?? 0, worker: null, name: r.name ?? undefined, material: r.material ?? undefined };
        this.posts.set(r.id, p);
        this.placed.posts.add(p);
      } else if (r.kind === 'trap') {
        const t: PlacedTrap = {
          ...at, kind: (r.sub ?? 'deadfall') as PlacedTrap['kind'], ql: r.ql ?? 20, dmg: r.dmg ?? 0,
          bait: r.bait ? { uid: -r.id, id: r.bait, ql: r.bait_ql ?? 1, dmg: 0, count: 1 } : null,
          caught: r.caught ?? null, checkAt: this.time, name: r.name ?? undefined,
          material: r.material ?? undefined,
        };
        this.traps.set(r.id, t);
        this.placed.traps.add(t);
      } else if (r.kind === 'furniture') {
        this.furniture.set(r.id, {
          ...at, kind: r.sub ?? 'chest', ql: r.ql ?? 20, items: [],
          name: r.name ?? undefined,
          fuel: r.fuel ?? undefined, lit: r.lit ?? undefined, ash: r.ash ?? undefined,
          litres: r.litres ?? undefined, liquid: (r.liquid ?? undefined) as PlacedFurniture['liquid'],
          ferment: r.ferment ?? undefined,
          facing: (r.facing ?? 's') as Side,
        });
      }
    }
    /*
     * What is standing on the ground, which until now the island never said.
     * Replaced outright rather than merged, because a wall somebody else took
     * down has to be able to come down here too.
     */
    if (ground.buildings) this.buildings.sawIsland(ground.buildings);
    for (const c of ground.crates ?? []) {
      this.crates.set(c.id, {
        id: c.id, x: c.x, y: c.y, sx: c.sx, sy: c.sy,
        kind: c.kind as PlacedCrate['kind'],
        // What the island says is in it. Empty for a crate too far off to
        // reach into, which is why `units` rides along beside it.
        items: (c.things ?? []).map((it) => ({
          uid: it.id, id: it.def, ql: it.ql, dmg: it.dmg, count: it.count,
          extra: it.extra ?? undefined,
        })),
        units: c.units,
        name: c.name ?? undefined, deed: c.deed ?? undefined, material: c.material ?? undefined,
      });
    }
    /*
     * Your settlement, which is the island's word on it and not this machine's.
     *
     * `deed` decides what may be built where and what a worker will carry, and
     * the browser's copy was whatever it founded itself — which on an island is
     * nothing, ever. It is yours or it is nothing: other people's come in
     * beside it and are drawn, and light nothing.
     */
    /*
     * The settlements, which only arrive with the slow half.
     *
     * `buildings` has always been applied only when it was sent; these two
     * were not, so the fast ground read — everything burning, once a second —
     * would have wiped your own settlement and your neighbours' off the map
     * between reconciles. `undefined` is "nothing said about this"; `null` is
     * still "you have no settlement", which is what a disband sends.
     */
    if (ground.deeds !== undefined) this.neighbourDeeds = ground.deeds;
    if (ground.folk !== undefined) this.folkAshore = ground.folk;
    if (ground.deed !== undefined) {
      const d = ground.deed;
      const was = this.deed;
      this.deed = d ? { name: d.name, x: d.x, y: d.y, radius: d.radius, level: d.level, mine: d.mine } : null;
      // Only when it is actually different: this runs every few seconds, and a
      // settlement that has not moved is not news to anybody.
      if ((was?.name ?? null) !== (d?.name ?? null) || was?.x !== d?.x || was?.y !== d?.y
          || was?.radius !== d?.radius || was?.level !== d?.level) {
        if (d) this.events.emit('world', d.x, d.y);
        else if (was) this.events.emit('world', was.x, was.y);
      }
    }
    /*
     * And what is growing, which was the last thing on the ground nobody had
     * been told to look for.
     *
     * `placed` and `crates` were found and wired up when this read was built —
     * the note at the top of this function is about exactly that — and `crop`
     * sat in Postgres beside them and was missed. The whole of farming on an
     * island is that miss: sowing wrote a row nothing ever read, so the field
     * stayed bare, no stage was ever drawn, and `cropAt` answering nothing
     * meant Sow went on being offered while Tend and Harvest never were.
     *
     * The stage is the island's. `growCrops` still moves one along between
     * reads so a field looks alive rather than stepping every twenty seconds,
     * and this puts it right each time — the same arrangement the wildlife's
     * legs are drawn under.
     *
     * Applied only when it was *sent*, which is the whole of why the clear is
     * in here rather than at the top with the crates. Crops ride the slow half
     * and `placed` and `crates` ride the fast one, so a bare `clear()` up there
     * emptied the map about once a second and the reconcile put it back twenty
     * seconds later: crops that showed up and flickered away. The note under
     * the settlements a few lines down says this in so many words about
     * `deeds` and `folk`, and it was written after the same mistake.
     * `undefined` is "nothing said about this"; an empty array is "nothing is
     * growing here", and they are not the same answer.
     */
    if (ground.notches !== undefined) {
      this.world.notches.clear();
      for (const n of ground.notches) this.world.setNotch(n.x, n.y, n.cuts);
    }
    if (ground.treesAgo !== undefined && Number.isFinite(ground.treesAgo)) this.treesAt = Date.now() / 1000 - ground.treesAgo;
    if (ground.crops !== undefined) {
      this.crops.clear();
      for (const c of ground.crops) {
        this.crops.set(`${c.x},${c.y}`, {
          x: c.x, y: c.y, id: c.id, stage: c.stage,
          stageAt: this.time - (Number.isFinite(c.ago) ? c.ago : 0),
          tended: c.tended, tendedNow: c.tendedNow, ql: c.ql,
        });
      }
    }
    this.placed.crates.reset(this.crates.values());
    this.placed.campfires.reset(this.campfires.values());
    this.placed.smelters.reset(this.smelters.values());
    this.placed.kilns.reset(this.kilns.values());
    this.placed.furniture.reset(this.furniture.values());
    this.placed.anvils.reset(this.anvils.values());
    this.events.emit('crate');
    this.events.emit('smelter');
  }

  /**
   * The crates the island has just said something about, and only those.
   *
   * `sawGround` clears everything set down and builds it again, because a
   * ground read is the whole of what is standing near you. This is not that:
   * it is the answer to one ask, naming the crates within arm's reach, and
   * everything it does not mention is left exactly where it was.
   */
  sawCrates(crates: IslandCrate[]): void {
    for (const c of crates) {
      this.crates.set(c.id, {
        id: c.id, x: c.x, y: c.y, sx: c.sx, sy: c.sy,
        kind: c.kind as PlacedCrate['kind'],
        items: (c.things ?? []).map((it) => ({
          uid: it.id, id: it.def, ql: it.ql, dmg: it.dmg, count: it.count,
          extra: it.extra ?? undefined,
        })),
        units: c.units,
        name: c.name ?? undefined, deed: c.deed ?? undefined, material: c.material ?? undefined,
      });
    }
    this.placed.crates.reset(this.crates.values());
    this.events.emit('crate');
  }

  /**
   * What the island says you are carrying.
   *
   * Replaced wholesale rather than merged: over there `wounds_settle` closes
   * them, turns them bad and takes the blood out, so what arrives is the whole
   * truth about them and an empty list means they have all closed over. This
   * side draws them and lets `bodyForward` take the blood off the bar between
   * answers; it does not decide anything about them.
   */
  sawWounds(rows: unknown[]): void {
    this.player.wounds = rows as Wound[];
    this.events.emit('stats');
  }

  /**
   * Where the island says the body is, when that is not where we thought.
   *
   * There is one thing that moves a body without this side doing it: dying.
   * `player_die` fills the bars, empties the wounds and puts you back where
   * you first came ashore — and `rpc_move` has answered with the island's own
   * position since the day it was written, with nothing here ever reading the
   * answer. So being killed left a body walking about from where it fell,
   * which is exactly what was reported, and only a refresh put it right.
   *
   * The feet are stopped along with it: whatever it was walking to is hundreds
   * of tiles away now, and a body that keeps walking is a body that claims its
   * old ground again on the next call. What is in the hands and what was
   * queued behind it are the beat's to say, and the beat is asked for as this
   * lands.
   */
  putBody(x: number, y: number, level: number): void {
    this.player.stop();
    this.player.x = x;
    this.player.y = y;
    this.player.level = level;
    this.player.visualLevel = level;
    this.events.emit('world', Math.floor(x), Math.floor(y));
    this.events.emit('stats');
  }

  /** Light up the ore a prospector just read, for a while. */
  markProspected(tiles: number[]): void {
    this.prospected = tiles.length ? { tiles: new Set(tiles), until: this.time + PROSPECT_MARK_TIME } : null;
  }

  /**
   * The ore a prospector read, as the island has it.
   *
   * Seconds left rather than an instant, for the same reason the action bar
   * takes seconds: the island subtracts its own two clocks and this one does
   * not have to agree with them about what time it is.
   */
  showProspected(tiles: number[], secs: number): void {
    this.prospected = tiles.length && secs > 0
      ? { tiles: new Set(tiles), until: this.time + secs }
      : null;
  }

  /**
   * What the island says is lined up behind the job in hand.
   *
   * The queue lives on the island — `act_queue` on the player row — so the
   * browser's own list was empty for ever and the bar never said what was
   * next. Only the labels are wanted here: a queued job is a thing to read,
   * and the island is the one that will do it.
   */
  showQueue(lined: Array<{ action: string; goes: number }>, cap: number | null): void {
    this.remoteCap = cap;
    const q = this.queue;
    q.length = 0;
    for (const { action, goes } of lined) {
      const def = ACTION_BY_ID.get(action);
      // The count comes with it now. It used to be thrown away on the island
      // side, so the line under the bar named the job three times and could
      // not say that one of them was for ten goes.
      if (def) q.push({ def, target: { kind: 'self' } as unknown as Target, goes });
    }
    this.events.emit('action');
  }

  /** How many jobs the island says fit in this head, when the island is counting. */
  private remoteCap: number | null = null;

  /** Whether a tile is currently marked by prospecting. */
  isProspected(x: number, y: number): boolean {
    const p = this.prospected;
    if (!p || this.time >= p.until) return false;
    return p.tiles.has(y * this.world.w + x);
  }

  addSmelter(x: number, y: number, sx: number, sy: number, ql: number): PlacedSmelter {
    const [ax, ay] = smelterAnchor(sx, sy);
    const s: PlacedSmelter = { id: this.nextSmelterId++, x, y, sx: ax, sy: ay, ql, fuel: 0, lit: false, jobs: [], output: [] };
    this.smelters.set(s.id, s);
    this.placed.smelters.add(s);
    this.events.emit('smelter');
    return s;
  }

  removeSmelter(id: number): void {
    const s = this.smelters.get(id);
    if (s) this.placed.smelters.remove(s);
    this.smelters.delete(id);
    this.events.emit('smelter');
  }

  smeltersOnTile(x: number, y: number): readonly PlacedSmelter[] {
    return this.placed.smelters.at(x, y);
  }

  /** Why a smelter cannot stand on this block of subtiles, or null. */
  smelterPlaceReason(x: number, y: number, sx: number, sy: number): string | null {
    const [ax, ay] = smelterAnchor(sx, sy);
    if (!this.world.isPassable(x, y) || this.world.hasWater(x, y)) return 'A smelter needs dry, solid ground.';
    if (this.world.slope(x, y) > 12) return 'The ground is too uneven to lay stone on.';
    if (this.isToken(x, y)) return 'Not on the token.';
    for (let dy = 0; dy < SMELTER_H; dy++) {
      for (let dx = 0; dx < SMELTER_W; dx++) {
        if (this.occupiedSubtile(x, y, ax + dx, ay + dy)) return 'Something is already standing there.';
      }
    }
    return null;
  }

  addKiln(x: number, y: number, sx: number, sy: number, ql: number): PlacedKiln {
    const [ax, ay] = kilnAnchor(sx, sy);
    const k: PlacedKiln = { id: this.nextKilnId++, x, y, sx: ax, sy: ay, ql, fuel: 0, lit: false, jobs: [], output: [] };
    this.kilns.set(k.id, k);
    this.placed.kilns.add(k);
    this.events.emit('smelter');
    return k;
  }

  removeKiln(id: number): void {
    const k = this.kilns.get(id);
    if (k) this.placed.kilns.remove(k);
    this.kilns.delete(id);
    this.events.emit('smelter');
  }

  kilnsOnTile(x: number, y: number): readonly PlacedKiln[] {
    return this.placed.kilns.at(x, y);
  }

  /** Why a kiln cannot stand on this block of subtiles, or null. */
  kilnPlaceReason(x: number, y: number, sx: number, sy: number): string | null {
    const [ax, ay] = kilnAnchor(sx, sy);
    if (!this.world.isPassable(x, y) || this.world.hasWater(x, y)) return 'A kiln needs dry, solid ground.';
    if (this.world.slope(x, y) > 14) return 'The ground is too uneven to lay brick on.';
    if (this.isToken(x, y)) return 'Not on the token.';
    for (let dy = 0; dy < KILN_SUBTILES; dy++) {
      for (let dx = 0; dx < KILN_SUBTILES; dx++) {
        if (this.occupiedSubtile(x, y, ax + dx, ay + dy)) return 'Something is already standing there.';
      }
    }
    return null;
  }

  addFurniture(kind: string, x: number, y: number, sx: number, sy: number, ql: number, items: Item[] = [], material?: string, facing: Side = 's'): PlacedFurniture {
    const [ax, ay] = furnitureAnchor(kind, sx, sy, facing);
    const f: PlacedFurniture = { id: this.nextFurnitureId++, x, y, sx: ax, sy: ay, kind, ql, items, material, facing };
    this.furniture.set(f.id, f);
    this.placed.furniture.add(f);
    this.events.emit('crate');
    return f;
  }

  removeFurniture(id: number): void {
    const f = this.furniture.get(id);
    if (f) this.placed.furniture.remove(f);
    this.furniture.delete(id);
    this.events.emit('crate');
  }

  furnitureOnTile(x: number, y: number): readonly PlacedFurniture[] {
    return this.placed.furniture.at(x, y);
  }

  /** Why a piece of furniture cannot stand on this block of subtiles, or null. */
  furniturePlaceReason(kind: string, x: number, y: number, sx: number, sy: number, facing: Side = 's', except?: number): string | null {
    const def = furnitureDef(kind);
    const [fw, fh] = furnitureFootprint(kind, facing);
    const [ax, ay] = furnitureAnchor(kind, sx, sy, facing);
    if (def.boat) {
      // A hull goes in the water and nowhere else, and you have to be able to
      // reach the water you are putting it in.
      if (!this.launchSpot(kind, x, y)) return `There is not ${def.boat.draught} deep of water there. Launch her off a bank with some depth to it.`;
      if (Math.hypot(x + 0.5 - this.player.x, y + 0.5 - this.player.y) > 4) return 'Stand at the water you mean to launch her into.';
      for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) if (this.occupiedSubtile(x, y, ax + dx, ay + dy, except)) return 'Something is already in the water there.';
      return null;
    }
    if (!this.world.isPassable(x, y) || this.world.hasWater(x, y)) return 'Furniture needs dry, solid ground.';
    if (this.world.slope(x, y) > 16) return 'The floor is too uneven for it to stand.';
    if (this.isToken(x, y)) return 'Not on the token.';
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        if (this.occupiedSubtile(x, y, ax + dx, ay + dy, except)) return 'Something is already standing there.';
      }
    }
    return null;
  }

  /** The piece of storage furniture closest to the player. */
  nearestStore(item?: Item, range = 3): PlacedFurniture | undefined {
    let best: PlacedFurniture | undefined;
    let bestD = Infinity;
    for (const f of this.furnitureWithin(range)) {
      if (!furnitureCapacity(f)) continue;
      // A raw material bin that will not take a tool is not the nearest store for a tool.
      if (item && furnitureRefuses(f, item)) continue;
      // Nothing goes in the trash by accident: that one has to be asked for.
      if (furnitureDef(f.kind).trash) continue;
      const [cx, cy] = furnitureCentre(f);
      const d = Math.hypot(cx - this.player.x, cy - this.player.y);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  /** Every piece of furniture on the tiles within reach of the player. */
  furnitureWithin(range: number): PlacedFurniture[] {
    const out: PlacedFurniture[] = [];
    this.placed.furniture.around(this.player.x, this.player.y, range, (f) => out.push(f));
    return out;
  }

  /**
   * Every place on the deed that holds things, seen the same way: crates,
   * bins, chests, larders, carts. A worker looking for somewhere to put a load
   * down, something to eat or a seed to sow asks this rather than knowing
   * about the deed crate and nothing else. A trash crate is never offered,
   * since nothing a worker carries is meant for it.
   */
  /** One crate, as a place a worker can put something down. */
  private crateStore(c: PlacedCrate): DeedStore {
    const cap = crateCapacity(c);
    return {
      x: c.x,
      y: c.y,
      centre: crateCentre(c),
      items: c.items,
      name: crateName(c),
      deed: !!c.deed,
      room: (item) => crateUnits(c) + item.count <= cap,
      add: (item) => this.crateAdd(c, item),
      changed: () => this.events.emit('crate'),
    };
  }

  /** One piece of furniture, the same way; undefined for the ones that hold nothing. */
  private furnitureStore(f: PlacedFurniture): DeedStore | undefined {
    const def = furnitureDef(f.kind);
    if (!def.capacity || def.trash) return undefined;
    return {
      x: f.x,
      y: f.y,
      centre: furnitureCentre(f),
      items: f.items,
      name: def.name,
      deed: false,
      room: (item) => !furnitureRefuses(f, item) && furnitureUnits(f) + item.count <= furnitureCapacity(f),
      add: (item) => this.furnitureAdd(f, item),
      changed: () => this.events.emit('crate'),
    };
  }

  deedStores(): DeedStore[] {
    // A field worker asks this for every tile it looks at, so build the list
    // once a tick. The entries hold the crates and pieces themselves, so what
    // is inside them is always current; only the set of them is cached.
    const stamp = this.crates.size * 1000 + this.furniture.size;
    if (this.storeCache && this.storeCache.at === this.time && this.storeCache.stamp === stamp) return this.storeCache.stores;
    const out: DeedStore[] = [];
    for (const c of this.crates.values()) if (this.onDeed(c.x, c.y)) out.push(this.crateStore(c));
    for (const f of this.furniture.values()) {
      if (!this.onDeed(f.x, f.y)) continue;
      const store = this.furnitureStore(f);
      if (store) out.push(store);
    }
    this.storeCache = { at: this.time, stamp, stores: out };
    return out;
  }

  /**
   * Anything within reach of a worker's post that will hold what it is
   * carrying. Put a crate beside the post and a logging camp keeps itself;
   * leave the post bare and the loads go all the way home.
   */
  postStores(c: Creature): DeedStore[] {
    const p = this.postOf(c);
    if (!p) return [];
    const [cx, cy] = postCentre(p);
    const reach = postRadius(p.ql);
    const out: DeedStore[] = [];
    this.placed.crates.around(cx, cy, reach, (crate) => out.push(this.crateStore(crate)));
    this.placed.furniture.around(cx, cy, reach, (f) => {
      const store = this.furnitureStore(f);
      if (store) out.push(store);
    });
    return out;
  }

  private storeCache: { at: number; stamp: number; stores: DeedStore[] } | null = null;

  /** Load something onto a pack beast's back; false when it will not fit. */
  pannierAdd(c: Creature, item: Item): boolean {
    const cap = Math.round((this.creatures.species(c).pannier ?? 0) * bloodMul(c, 'haul'));
    const used = c.pannier.reduce((n, it) => n + it.count, 0);
    if (!cap || used + item.count > cap) return false;
    const def = ITEM_DEFS[item.id];
    const stack = def?.stackable ? c.pannier.find((it) => it.id === item.id && it.extra === item.extra && it.piece === item.piece) : undefined;
    if (stack) {
      stack.ql = (stack.ql * stack.count + item.ql * item.count) / (stack.count + item.count);
      stack.count += item.count;
    } else c.pannier.push(item);
    this.events.emit('crate');
    return true;
  }

  /** Take something back off a pack beast. */
  pannierTake(c: Creature, uid: number): Item | null {
    const i = c.pannier.findIndex((it) => it.uid === uid);
    if (i < 0) return null;
    const [item] = c.pannier.splice(i, 1);
    this.events.emit('crate');
    return item;
  }

  /** Put something away; false when it would not fit. */
  furnitureAdd(f: PlacedFurniture, item: Item): boolean {
    if (furnitureUnits(f) + item.count > furnitureCapacity(f)) return false;
    const def = ITEM_DEFS[item.id];
    const stack = def?.stackable ? f.items.find((it) => it.id === item.id && it.extra === item.extra && it.piece === item.piece) : undefined;
    if (stack) {
      stack.ql = (stack.ql * stack.count + item.ql * item.count) / (stack.count + item.count);
      stack.count += item.count;
    } else f.items.push(item);
    this.events.emit('crate');
    return true;
  }

  furnitureTake(f: PlacedFurniture, uid: number): Item | null {
    const idx = f.items.findIndex((it) => it.uid === uid);
    if (idx < 0) return null;
    const [item] = f.items.splice(idx, 1);
    this.events.emit('crate');
    return item;
  }

  addAnvil(x: number, y: number, sx: number, sy: number, metal: string, ql: number): PlacedAnvil {
    const [ax, ay] = anvilAnchor(sx, sy);
    const a: PlacedAnvil = { id: this.nextAnvilId++, x, y, sx: ax, sy: ay, metal, ql };
    this.anvils.set(a.id, a);
    this.placed.anvils.add(a);
    this.events.emit('smelter');
    return a;
  }

  removeAnvil(id: number): void {
    const a = this.anvils.get(id);
    if (a) this.placed.anvils.remove(a);
    this.anvils.delete(id);
    this.events.emit('smelter');
  }

  anvilsOnTile(x: number, y: number): readonly PlacedAnvil[] {
    return this.placed.anvils.at(x, y);
  }

  anvilPlaceReason(x: number, y: number, sx: number, sy: number): string | null {
    const [ax, ay] = anvilAnchor(sx, sy);
    if (!this.world.isPassable(x, y) || this.world.hasWater(x, y)) return 'An anvil needs dry, level ground.';
    if (this.world.slope(x, y) > 16) return 'The ground is too uneven.';
    if (this.isToken(x, y)) return 'Not on the token.';
    for (let dy = 0; dy < ANVIL_SUBTILES; dy++) {
      for (let dx = 0; dx < ANVIL_SUBTILES; dx++) {
        if (this.occupiedSubtile(x, y, ax + dx, ay + dy)) return 'Something is already standing there.';
      }
    }
    return null;
  }

  /** Whether anything already stands on one subtile. */
  /**
   * The crate rack whose deck covers this subtile, when one does.
   *
   * A rack's footprint *is* its crate spots — eight subtiles, eight crates —
   * so this is the one question everything about it turns on: whether the spot
   * somebody is pointing at is a rack's deck or bare ground.
   */
  rackAt(x: number, y: number, sx: number, sy: number): PlacedFurniture | undefined {
    for (const f of this.placed.furniture.at(x, y)) {
      if (rackSpots(f) && furnitureCovers(f, sx, sy)) return f;
    }
    return undefined;
  }

  /** The crates standing on a rack, in the order its spots fill. */
  cratesOn(f: PlacedFurniture): PlacedCrate[] {
    const out: PlacedCrate[] = [];
    for (const [sx, sy] of rackDeck(f)) {
      const crate = this.crateAt(f.x, f.y, sx, sy);
      if (crate) out.push(crate);
    }
    return out;
  }

  /** Whether a spot is taken, leaving out one piece of furniture when it is that piece asking about its own turn. */
  occupiedSubtile(x: number, y: number, sx: number, sy: number, exceptFurniture?: number): boolean {
    if (this.crateAt(x, y, sx, sy)) return true;
    if (this.campfireAt(x, y, sx, sy)) return true;
    for (const s of this.placed.smelters.at(x, y)) if (smelterCovers(s, sx, sy)) return true;
    for (const k of this.placed.kilns.at(x, y)) if (kilnCovers(k, sx, sy)) return true;
    for (const f of this.placed.furniture.at(x, y)) if (f.id !== exceptFurniture && furnitureCovers(f, sx, sy)) return true;
    for (const a of this.placed.anvils.at(x, y)) if (anvilCovers(a, sx, sy)) return true;
    for (const p of this.placed.posts.at(x, y)) if (p.sx === sx && p.sy === sy) return true;
    return false;
  }

  /** Burn fuel in every lit smelter and move its work along. */
  private runSmelters(dt: number): void {
    for (const s of this.smelters.values()) {
      if (!s.lit) continue;
      const burn = Math.min(s.fuel, dt);
      s.ash = (s.ash ?? 0) + burn * ASH_RATE;
      s.fuel -= burn;
      if (s.fuel <= 0) {
        s.fuel = 0;
        s.lit = false;
        this.logMsg('A smelter burns through the last of its fuel and goes cold.', 'event');
        this.events.emit('smelter');
        this.events.emit('world', s.x, s.y);
      }
      const job = s.jobs[0];
      if (!job || burn <= 0) continue;
      job.left -= burn;
      if (job.left > 0) continue;
      /*
       * On an island the furnace is the island's. The count runs down here so
       * the menu reads right between two looks at the ground, but what came
       * out is the island's to say: it settles the furnace on its own clock
       * and the next look brings the lump. A browser that made the lump
       * itself made one the island had never heard of.
       */
      if (this.islandClock) { job.left = 0; continue; }
      s.jobs.shift();
      const made: Item =
        job.makes === 'anvil'
          ? { uid: this.inventory.nextUid++, id: 'anvil', ql: job.ql, dmg: 0, count: 1, extra: job.item.id.replace('_lump', '') }
          : { uid: this.inventory.nextUid++, id: job.makes, ql: job.ql, dmg: 0, count: 1, extra: job.extra, piece: job.piece };
      furnaceOut(s.output, made);
      this.logMsg(`The smelter finishes a ${itemName(made).toLowerCase()}. (QL ${made.ql.toFixed(1)})`, 'event');
      this.events.emit('smelter');
    }
  }

  /** Burn fuel in every lit kiln and bring its ware on. */
  private runKilns(dt: number): void {
    for (const k of this.kilns.values()) {
      if (!k.lit) continue;
      const burn = Math.min(k.fuel, dt);
      k.ash = (k.ash ?? 0) + burn * ASH_RATE;
      k.fuel -= burn;
      if (k.fuel <= 0) {
        k.fuel = 0;
        k.lit = false;
        this.logMsg('A kiln burns through the last of its fuel and goes cold.', 'event');
        this.events.emit('smelter');
        this.events.emit('world', k.x, k.y);
      }
      const job = k.jobs[0];
      if (!job || burn <= 0) continue;
      job.left -= burn;
      if (job.left > 0) continue;
      // As for the smelter: on an island the ware is the island's to fire.
      if (this.islandClock) { job.left = 0; continue; }
      k.jobs.shift();
      const made: Item = { uid: this.inventory.nextUid++, id: job.makes, ql: job.ql, dmg: 0, count: 1 };
      furnaceOut(k.output, made);
      this.logMsg(`The kiln fires a ${ITEM_DEFS[made.id]?.name.toLowerCase() ?? made.id}. (QL ${made.ql.toFixed(1)})`, 'event');
      this.events.emit('smelter');
    }
  }

  cropAt(x: number, y: number): Crop | undefined {
    return this.crops.get(`${x},${y}`);
  }

  plantCrop(x: number, y: number, id: string, seedQl: number): Crop {
    const c: Crop = { x, y, id, stage: 0, stageAt: this.time, tended: 0, tendedNow: false, ql: seedQl };
    this.crops.set(`${x},${y}`, c);
    this.events.emit('world', x, y);
    return c;
  }

  removeCrop(x: number, y: number): void {
    this.crops.delete(`${x},${y}`);
    this.events.emit('world', x, y);
  }

  /** Move every crop on to its next stage once its time is up. */
  private growCrops(): void {
    for (const c of this.crops.values()) {
      if (c.stage >= RIPE) continue;
      // The gardener's path hurries everything that is in your own ground.
      const green = this.walks('love', 1) && this.deed && this.onDeed(c.x, c.y) ? 0.8 : 1;
      const per = cropDef(c.id).stageSeconds * green;
      let moved = false;
      while (c.stage < RIPE && this.time - c.stageAt >= per) {
        c.stage += 1;
        c.stageAt += per;
        c.tendedNow = false;
        moved = true;
      }
      if (moved) this.events.emit('world', c.x, c.y);
    }
  }

  groundAt(x: number, y: number): Item[] {
    return this.ground.get(`${x},${y}`) ?? [];
  }

  dropOnGround(x: number, y: number, item: Item): void {
    const key = `${x},${y}`;
    const pile = this.ground.get(key) ?? [];
    const def = ITEM_DEFS[item.id];
    const stack = def?.stackable ? pile.find((it) => it.id === item.id && it.extra === item.extra && it.piece === item.piece) : undefined;
    if (stack) {
      stack.ql = (stack.ql * stack.count + item.ql * item.count) / (stack.count + item.count);
      stack.count += item.count;
    } else pile.push(item);
    this.ground.set(key, pile);
    this.events.emit('world', x, y);
  }

  /** Remove one item (by uid) or everything (null) from a tile. */
  /** How far a sweep of the ground reaches: the tile you are on and its neighbours. */
  private static readonly SWEEP = 1;

  /** How many loose things are lying within reach of a spot. */
  sweepable(x: number, y: number): number {
    let n = 0;
    for (let dy = -Game.SWEEP; dy <= Game.SWEEP; dy++) {
      for (let dx = -Game.SWEEP; dx <= Game.SWEEP; dx++) n += this.groundAt(x + dx, y + dy).length;
    }
    return n;
  }

  /** Gather up everything lying within reach of a spot, nearest first. */
  sweep(x: number, y: number): Item[] {
    const got: Item[] = [];
    const spots: Array<[number, number]> = [];
    for (let dy = -Game.SWEEP; dy <= Game.SWEEP; dy++) for (let dx = -Game.SWEEP; dx <= Game.SWEEP; dx++) spots.push([x + dx, y + dy]);
    spots.sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y));
    for (const [sx, sy] of spots) {
      for (const it of this.takeFromGround(sx, sy, null)) {
        this.inventory.addItem(it);
        got.push(it);
      }
    }
    return got;
  }

  takeFromGround(x: number, y: number, uid: number | null): Item[] {
    const key = `${x},${y}`;
    const pile = this.ground.get(key);
    if (!pile) return [];
    let taken: Item[];
    if (uid === null) {
      taken = pile.splice(0, pile.length);
    } else {
      const idx = pile.findIndex((it) => it.uid === uid);
      taken = idx >= 0 ? pile.splice(idx, 1) : [];
    }
    if (!pile.length) this.ground.delete(key);
    this.events.emit('world', x, y);
    return taken;
  }

  groundToJSON(): Record<string, Item[]> {
    const out: Record<string, Item[]> = {};
    for (const [k, v] of this.ground) out[k] = v;
    return out;
  }

  private forageKey(x: number, y: number, kind: string): number {
    const k = Math.max(0, FORAGE_KINDS.indexOf(kind));
    return k * this.world.w * this.world.h + y * this.world.w + x;
  }

  isForaged(x: number, y: number, kind: string): boolean {
    const t = this.foraged.get(this.forageKey(x, y, kind));
    return t !== undefined && this.time - t < FORAGE_COOLDOWN;
  }

  /** The stage nothing else grows into: the beginning of a tree. */
  private static readonly FIRST = TREE_AGES.find((a) => !TREE_AGES.some((b) => b.next === a.id))?.id ?? 0;

  /**
   * A day in the woods: every tree one stage older, the old ones gone, and two
   * saplings out of each stump.
   *
   * Once a day and not a moment otherwise. The first cut of this crept — a
   * slice of the map every few seconds, each tree carrying its own hour so the
   * wood would not turn over all at once — and on the island that cost a tenth
   * of a second every second to answer a question that changes once a day, and
   * showed up as a second of input delay. A day's rule does not want a second's
   * clock. What is left here is one comparison, which is free.
   *
   * The day turns at dawn (`TREE_DAWN_UTC`), the same moment on every island
   * and in every game of your own, rather than a day after the last turnover:
   * once the last dawn is past what was stamped, the woods move on, and are
   * stamped with now. A game shut for a week turns over once when it is
   * opened, and again at the next dawn.
   */
  growTrees(nowSeconds: number): void {
    if (this.ask) return; // On a live island the woods are the island's.
    if (this.treesAt >= lastDawn(nowSeconds)) return;
    this.treesAt = nowSeconds;
    const w = this.world;
    const stumps: Array<[number, number, number]> = [];
    for (let y = 0; y < w.h; y++) {
      for (let x = 0; x < w.w; x++) {
        const here = w.getTile(x, y);
        // A stump left a day is gone.
        if (here === TileType.Stump) {
          w.setTile(x, y, TileType.Grass, 0);
          continue;
        }
        // Grass kept cut on a deed becomes lawn; a day without a cut starts
        // the count over.
        if (here === TileType.Grass) {
          const data = w.getData(x, y);
          if (data) {
            if (!mownToday(data)) w.setTile(x, y, TileType.Grass, 0);
            else if (mownDays(data) + 1 >= LAWN_AFTER) w.setTile(x, y, TileType.Lawn, 0);
            else w.setTile(x, y, TileType.Grass, mownDays(data) + 1);
          }
          continue;
        }
        if (here !== TileType.Tree) continue;
        const data = w.getData(x, y);
        const age = treeAge(data);
        if (age.next === null) {
          // What a dead tree leaves: a stump of its kind, for a day.
          w.setTile(x, y, TileType.Stump, packTreeData(treeSpecies(data), 0));
          stumps.push([x, y, treeSpecies(data)]);
        } else {
          w.setTile(x, y, TileType.Tree, packTreeData(treeSpecies(data), age.next));
        }
      }
    }
    // A year's growth closes whatever was cut into anything.
    w.notches.clear();
    // The stumps seed after the whole island has turned, so a sapling dropped
    // into ground the walk had not reached yet cannot be aged the same day.
    for (const [x, y, species] of stumps) this.seedTrees(x, y, species);
  }

  /**
   * What an old tree leaves behind it: its own kind, on ground a sprout could
   * have been planted in, and not inside anybody's settlement. A wood is
   * welcome to spread, and not over the place somebody levelled and built on.
   */
  private seedTrees(x: number, y: number, species: number): void {
    const w = this.world;
    const spots: Array<[number, number]> = [];
    for (let dy = -TREE_SEED_REACH; dy <= TREE_SEED_REACH; dy++) {
      for (let dx = -TREE_SEED_REACH; dx <= TREE_SEED_REACH; dx++) {
        if (!dx && !dy) continue;
        const gx = x + dx;
        const gy = y + dy;
        if (!w.inBounds(gx, gy) || !PLANTABLE.has(w.getTile(gx, gy))) continue;
        if (this.deedAt(gx, gy)) continue;
        spots.push([gx, gy]);
      }
    }
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    /*
     * What it wants, and what the ground will have.
     *
     * The roll averages a shade over replacement; the room is what keeps a
     * thick wood from running away, because a stump with nothing open round it
     * leaves nothing. Neither alone settles anywhere — together they do.
     */
    const roll = this.rand();
    const wants = roll < TREE_SEED_NONE ? 0 : roll < 1 - TREE_SEED_BOTH ? 1 : TREE_SEEDS;
    const room = spots.length >= TREE_ROOM_TWO ? TREE_SEEDS : spots.length >= TREE_ROOM_ONE ? 1 : 0;
    for (const [gx, gy] of spots.slice(0, Math.min(wants, room))) {
      w.setTile(gx, gy, TileType.Tree, packTreeData(species, Game.FIRST));
    }
  }

  markForaged(x: number, y: number, kind: string): void {
    this.foraged.set(this.forageKey(x, y, kind), this.time);
  }

  private die(): void {
    const p = this.player;
    p.stats = { health: 1, stamina: 0.5, hunger: 0.6, thirst: 0.6 };
    p.stop();
    p.x = this.spawn.x + 0.5;
    p.y = this.spawn.y + 0.5;
    p.level = 0;
    // Whatever killed you stays with the body. The wounds that did it would
    // open you again in a minute, and nothing you could do would be quick
    // enough; waking up is waking up whole.
    p.wounds = [];
    p.attackedBy = null;
    p.attackedAt = -1e9;
    this.player.boons = this.player.boons.filter((b) => b.until > this.time);
    this.cancelAction(true);
    this.logMsg('You have died. You wake up, shivering, where you first came ashore.', 'error');
    this.events.emit('inventory');
  }

  /**
   * Somewhere for a line to go when there is an island listening.
   *
   * Filled in by `play.ts`, like `ask` and `stop`. Null in the game you play
   * by yourself, where the only person who could hear you is you.
   */
  talk: ((text: string) => void) | null = null;

  /**
   * Wave, or hop.
   *
   * Drawn here at once and said over the wire in the same breath: an emote
   * that waited for the island to answer would be an emote you pressed and
   * then watched for, which is the opposite of the point of one.
   */
  emote(id: string): void {
    const def = EMOTE_BY_ID.get(id);
    if (!def) return;
    this.player.emote = id;
    this.player.emoteAt = performance.now() / 1000;
    this.logMsg(def.said.replace('{name}', 'You').replace(/s\.$/, '.'), 'event');
    this.emoted?.(id);
  }

  /** Filled in by whatever is carrying this game to other people, if anything. */
  emoted?: (id: string) => void;

  say(text: string): void {
    const trimmed = cleanSaid(text);
    if (!trimmed) return;
    if (trimmed.startsWith('/')) {
      this.command(trimmed.slice(1));
      return;
    }
    /*
     * On an island the line is not drawn here. It goes over, and comes back
     * down the same subscription that carries it to everybody else — at the
     * same moment and in the same words.
     */
    if (this.talk) {
      this.talk(trimmed);
      return;
    }
    this.logMsg(`<${this.player.name}> ${trimmed}`, 'chat');
  }

  private command(cmd: string): void {
    const [name, ...rest] = cmd.split(/\s+/);
    switch (name.toLowerCase()) {
      case 'name': {
        const n = rest.join(' ').trim();
        if (n) {
          this.player.name = n.slice(0, 24);
          this.logMsg(`You are now known as ${this.player.name}.`, 'system');
        }
        break;
      }
      case 'where':
        this.logMsg(`You are at (${this.player.tileX}, ${this.player.tileY}), height ${this.world.heightAt(this.player.x, this.player.y).toFixed(1)}.`, 'system');
        break;
      case 'help':
        this.logMsg(`Commands: /name <name>, /where, ${EMOTES.map((e) => `/${e.id}`).join(', ')}, /help.`
          + ' Press F1 for controls.', 'system');
        break;
      default:
        // An emote is its own command, so /wave reads the way anybody would
        // guess it does rather than as an argument to something else.
        if (EMOTE_BY_ID.has(name.toLowerCase())) {
          this.emote(name.toLowerCase());
          break;
        }
        this.logMsg(`Unknown command: /${name}`, 'error');
    }
  }
}

/**
 * A thing the island says is on the ground, as the row comes off `placed`.
 *
 * The row itself, less the columns that are nobody's business — so a column
 * the island learns later arrives here without anybody having to widen a list.
 */
/**
 * What a furnace off the island is working on and has finished, as things the
 * browser knows.
 *
 * The island writes a finished piece as `{def, ql, count, extra}` — its own
 * shape for a thing — and a job as `{makes, left, total, ql}` with nothing
 * about what went in. The browser's item has an `id`, and its job has an
 * `item`. Reported from the island as a right-click on a smelter that locked
 * the game up: the menu named what was finished in it, a piece with no `id`
 * has no name, and a name with nothing in it cannot be lowercased. The list
 * had been taken as it came, cast and not looked at.
 *
 * The uid is the furnace's and the piece's place in it, negative so it can
 * never be a uid of anything in the pack, and the same on every read so a
 * menu built off one read and used after the next still names the same
 * piece.
 */
export function furnaceOutput(furnace: number, rows: unknown[] | undefined): Item[] {
  return (rows ?? []).map((raw, i) => {
    const o = raw as { id?: string; def?: string; ql?: number; dmg?: number; count?: number; extra?: string | null; piece?: string | null; uid?: number };
    return {
      uid: typeof o.uid === 'number' ? o.uid : -(furnace * 1000 + i + 1),
      id: o.id ?? o.def ?? 'lump',
      ql: o.ql ?? 1,
      dmg: o.dmg ?? 0,
      count: o.count ?? 1,
      extra: o.extra ?? undefined,
      piece: o.piece ?? undefined,
    };
  });
}

/**
 * A finished piece put with what is waiting, folded into a stack of its kind
 * the way a pack folds it: twenty lumps wait as one entry of twenty rather
 * than twenty of one, and the quality is the average by the unit. The
 * island folds its furnace output the same way (`furnace_fold`).
 */
export function furnaceOut(output: Item[], made: Item): void {
  const def = ITEM_DEFS[made.id];
  const stack = def?.stackable ? output.find((it) => it.id === made.id && it.extra === made.extra && it.piece === made.piece) : undefined;
  if (stack) {
    stack.ql = (stack.ql * stack.count + made.ql * made.count) / (stack.count + made.count);
    stack.count += made.count;
  } else output.push(made);
}

/** And the jobs, each with something in the `item` a local finish would read. */
export function furnaceJobs(rows: unknown[] | undefined): SmeltJob[] {
  return (rows ?? []).map((raw) => {
    const j = raw as { makes?: string; left?: number; total?: number; ql?: number; extra?: string | null; piece?: string | null; item?: Item };
    const ql = j.ql ?? 1;
    return {
      item: j.item ?? { uid: 0, id: j.extra ? `${j.extra.toLowerCase()}_lump` : (j.makes ?? ''), ql, dmg: 0, count: 1 },
      makes: j.makes ?? '',
      left: j.left ?? 0,
      total: j.total ?? j.left ?? 0,
      ql,
      extra: j.extra ?? undefined,
      piece: j.piece ?? undefined,
    };
  });
}

export interface IslandPlaced {
  id: number;
  kind: string;
  sub: string | null;
  x: number;
  y: number;
  sx: number;
  sy: number;
  ql: number | null;
  fuel: number | null;
  ash: number | null;
  lit: boolean | null;
  dmg: number | null;
  name: string | null;
  material: string | null;
  /** Which way a piece faces, for furniture; absent from older islands. */
  facing?: string | null;
  litres: number | null;
  liquid: string | null;
  ferment: number | null;
  bait: string | null;
  bait_ql: number | null;
  caught: number | null;
  state: { jobs?: unknown[]; output?: unknown[] } | null;
  mine: boolean;
}

/** A crate, likewise. */
export interface IslandCrate {
  id: number;
  kind: string;
  x: number;
  y: number;
  sx: number;
  sy: number;
  material: string | null;
  name: string | null;
  deed: boolean;
  /**
   * What is in it, and how much of it.
   *
   * `units` comes for every crate in sight; `things` only for the ones near
   * enough to reach into. The browser used to be told neither, so every crate
   * on an island was drawn empty for ever — which is what "if I put things in
   * the deed crate it automatically puts them back in my inventory" was: the
   * thing went in, the crate never showed it, and the pack settled back to the
   * island's truth a moment later.
   */
  units?: number;
  things?: Array<{ id: number; def: string; ql: number; dmg: number; count: number; extra: string | null }>;
}

/** Everything on the ground within sight, as one answer. */
/** An island clock for a ground read that comes without one: nothing lying about has been burning. */
const UNLIT: Aged = { since: () => 0 };

export interface IslandGround {
  placed: IslandPlaced[];
  crates: IslandCrate[];
  /**
   * What is lying on the ground within range, whole rows, on the fast half.
   * Left out means nothing said; an empty list means nothing is there.
   */
  lying?: ItemRow[];
  /**
   * What is growing, and how far along.
   *
   * `ago` is seconds since the stage it is in began rather than the hour it
   * began at: the island keeps `stage_at` as a timestamp and this browser
   * counts in its own world seconds, and the one thing the two agree on
   * without any arrangement is how long a second is.
   */
  crops?: Array<{ x: number; y: number; id: string; stage: number; ago: number; tended: number; tendedNow: boolean; ql: number }>;
  /**
   * The felling notches near you and how long ago the woods last turned
   * over, both on the slow half. Look reads them: "2 of 3 strokes in it", and
   * "the woods turn over in 9 hours". A browser on an island keeps no clock
   * of its own for the woods, so this is the only place it hears the hour.
   */
  notches?: Array<{ x: number; y: number; cuts: number }>;
  treesAgo?: number;
  /**
   * Your own settlement, on the slow half.
   *
   * Optional, and the three states are three different answers: absent is
   * "this read said nothing about it", null is "you have no settlement" —
   * which is what a disband sends — and an object is the one you have. The
   * fast read carries none of the three, which is why `sawGround` applies it
   * only when it was sent, and why this was wrong to type as always present.
   */
  deed?: { name: string; x: number; y: number; radius: number; level: number; mine: boolean } | null;
  /**
   * Other people's settlements, and only those near enough to be standing in.
   *
   * Separate from `deed` because the browser does two quite different things
   * with the two. `deed` is yours: `vision.ts` lights it whatever the hour and
   * however far off, `journal.ts` counts it as a stake you planted, `onDeed`
   * decides what you may build. None of that is true of somebody else's, and
   * handing theirs over as `deed` — which is what an island with one
   * settlement in it did — lit their homestead in your fog and ticked their
   * work off in your journal.
   */
  deeds?: Array<{ name: string; x: number; y: number; radius: number; level: number; holder: string | null; mine?: boolean }>;
  /**
   * Everybody else ashore, with whereabouts while the island is quiet.
   *
   * On the slow half, beside the settlements, because it is the same kind of
   * thing: a fact about the island rather than about the tile you are on.
   * `folk_ashore` decides whether the positions come with it — see
   * `CROWD_HIDES`.
   */
  folk?: Array<{ uid: string; name: string; online: boolean; x?: number; y?: number }>;
  /**
   * What is standing, and what is half built.
   *
   * The island has kept `building`, `wall` and `floor_tile` since buildings
   * were ported and has never once said a word about them, so on an island a
   * building was invisible to everybody — including whoever planned it. It
   * went up in Postgres, the rules answered about it, and no browser ever drew
   * a wall of it.
   */
  buildings?: BuildingsJSON;
}
