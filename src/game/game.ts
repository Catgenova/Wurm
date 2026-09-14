import { generateWorld } from '../world/generate';
import { packTreeData, TileType, TREE_DEFS } from '../world/tiles';
import { oreAt } from '../world/ore';
import { World } from '../world/world';
import { ACTIONS, type ActionDef, type Target } from './actions';
import { Buildings, connectsDown, floorKind, isDone, MAX_LEVELS, walkableKind, type BuildingsJSON, type Building, type Wall } from './building';
import { crateCentre, crateName, crateCapacity, crateUnits, subtileOf, type CrateKind, type PlacedCrate } from './crates';
import { anvilAnchor, anvilCovers, ANVIL_SUBTILES, type PlacedAnvil } from './anvil';
import { fireAnchor, fireCentre, fireCovers, FIRE_SUBTILES, type PlacedCampfire } from './campfire';
import { smelterAnchor, smelterCentre, smelterCovers, SMELTER_H, SMELTER_W, type PlacedSmelter } from './smelter';
import { kilnAnchor, kilnCovers, KILN_SUBTILES, type PlacedKiln } from './kiln';
import { furnitureAnchor, furnitureCapacity, furnitureCentre, furnitureCovers, furnitureDef, furnitureRefuses, furnitureUnits, hiveRoom, teamOf, vehicleOf, type LiquidKind, type PlacedFurniture, furnitureName, LIQUID_NAME, isBoat } from './furniture';
import { cropDef, RIPE, type Crop } from './farming';
import { ageDef, bloodMul, CALL_WINDOW, Creatures, HAUL_SKILL, isBaitFor, type Creature, type CreatureJSON, type Stance } from './creatures';
import type { Station } from './recipes';
import { Emitter, type GameEvents, type LogEntry, type LogKind } from './events';
import { groundDecayRate, Inventory, ITEM_DEFS, itemName, type Item, rarityOf, itemDef } from './items';
import { BASE_SPEED, groundStep, MAX_STEP, Player, SWIM_DEPTH, SWIM_SPEED } from './player';
import { ARMOUR_BY_ID, ARMOUR_CLASSES, HIT_LOCATIONS, pieceBurden, pieceSoak, SHIELDS, WEAPON_BY_ID, type Slot } from './gear';
import { affinityOf, affinityTime, AFFINITY_BONUS, clockLeft, REST_CAP, REST_MULT, REST_PER_SECOND, type Boon } from './boons';
import { ALL_GOALS } from './journal';
import { matOf, rollEase, workingQl } from './materials';
import { postCentre, postDecayRate, postName, postRadius, postSite, type PlacedPost } from './posts';
import { catchChance, CHECK_EVERY, trapCentre, trapDecayRate, trapHolds, trapName, TRAPS, type PlacedTrap, type TrapKind } from './traps';
import { BAIT_BY_ID, fishHere, pickFish, waterDepth } from './fishing';
import { BRIDGES, bridgeDone, CLEARANCE, END_SLOP, spanBill, spanTiles, type Bridge, type BridgeKind } from './bridges';
import { Skills, SKILL_DEFS } from './skills';
import { earnedBy, knackBonus, knackLands, KNACK_CAP, stepsCrossed, TITLE_BY_ID } from './titles';
import { TileIndex } from './tileindex';
import { Vision } from './vision';
import { sailFactor, sailWord, windAt, windFrom, windWord, type Wind } from './wind';
import { festerChance, PART_NAMES, woundClose, woundDrain, WOUND_KINDS, woundText, type Wound, type WoundKind } from './wounds';

export interface ActiveAction {
  def: ActionDef;
  target: Target;
  state: 'walking' | 'performing';
  elapsed: number;
  duration: number;
  /** Standing still until this time, waiting for a called wildermon to arrive. */
  waitUntil?: number;
}

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
}

export const DEED_RADIUS = 5;
/** Every upgrade pushes the border out this far and takes on one more worker. */
export const DEED_RADIUS_PER_LEVEL = 2;
export const DEED_WORKERS_AT_LEVEL_ONE = 1;
export const MAX_DEED_LEVEL = 5;

export const deedLevel = (d: Deed | null): number => Math.max(1, Math.min(MAX_DEED_LEVEL, d?.level ?? 1));
export const deedRadiusAt = (level: number): number => DEED_RADIUS + (level - 1) * DEED_RADIUS_PER_LEVEL;
export const deedWorkersAt = (level: number): number => DEED_WORKERS_AT_LEVEL_ONE + (level - 1);

/** UI prompts the game needs; main.ts wires them to the browser. */
export interface GameHooks {
  prompt: (question: string, fallback: string) => string | null;
  confirm: (question: string) => boolean;
}

export interface GameInit {
  seed: number;
  world: World;
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
  ticked?: string[];
  anvils?: PlacedAnvil[];
  crops?: Crop[];
  player?: { x: number; y: number; name: string; stats: Player['stats']; level?: number; equipped?: Record<string, number | null>; rested?: number; boons?: Boon[]; affinities?: Record<string, number>; titles?: string[]; title?: string | null; wounds?: Wound[]; nextWound?: number };
  inventory?: Item[];
  nextUid?: number;
  ground?: Record<string, Item[]>;
  skills?: Record<string, number>;
  time?: number;
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
/** A day and a night, in seconds: one game hour to the real minute. */
export const DAY_SECONDS = 1440;
/** When the sun comes up and goes down, in game hours. */
export const DAWN = 6;
export const DUSK = 20;
const FORAGE_COOLDOWN = 180;
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

const PLANTABLE = new Set<number>([TileType.Grass, TileType.Dirt, TileType.Lawn, TileType.Steppe, TileType.Tundra, TileType.Moss]);

/** Central simulation state: the world, the player and everything they do. */
export class Game {
  readonly seed: number;
  readonly world: World;
  /** Where you wake up: the shore you came in on until a bed says otherwise. */
  spawn: { x: number; y: number };
  readonly player: Player;
  readonly inventory: Inventory;
  readonly skills: Skills;
  readonly events = new Emitter<GameEvents>();
  readonly log: LogEntry[] = [];
  readonly settings = {
    grid: true,
    rotation: 0,
    deedBorder: true,
    /** Hide walls standing between the viewer and the inside of a building. */
    cutaway: false,
    /** Storey being looked at, 0 for the ground floor; null follows the player. */
    viewLevel: null as number | null,
    /** Open the tile window when a tile is clicked. */
    tileWindow: true,
    /** Hide the land nobody has looked at, and cool what is out of sight. */
    fog: true,
  };
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
  readonly buildings: Buildings;
  /** What can be seen from where you are, and what is only remembered. */
  readonly vision: Vision;
  readonly creatures: Creatures;
  deed: Deed | null = null;
  /** Work posts by id; each stands on one subtile off the deed. */
  readonly posts = new Map<number, PlacedPost>();
  readonly traps = new Map<number, PlacedTrap>();
  nextTrapId = 1;
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
  /** Goals already ticked off, which stay ticked whatever happens after. */
  readonly ticked = new Set<string>();
  private journalAt = -1e9;

  /** Note that something was done, once. */
  note(key: string, n = 1): void {
    this.tally[key] = (this.tally[key] ?? 0) + n;
  }

  /**
   * Look over the journal for anything newly done. Only the goals still open
   * are tested, and only now and again, so a list of fifty costs nothing.
   */
  private checkJournal(): void {
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
  hooks: GameHooks = { prompt: (_q, fallback) => fallback, confirm: () => true };
  action: ActiveAction | null = null;
  /** Actions lined up behind the one in hand, oldest first. */
  readonly queue: Array<{ def: ActionDef; target: Target }> = [];
  /** Items lying on tiles, keyed by "x,y". */
  readonly ground = new Map<string, Item[]>();
  /** Game seconds since the world was created. */
  time = 0;
  rand: () => number = Math.random;
  private foraged = new Map<number, number>();
  private drownWarning = 0;
  private swimClock = 0;
  private decayClock = 0;

  static create(seed: number, size = WORLD_SIZE): Game {
    const gen = generateWorld(seed, size);
    const game = new Game({ seed, world: gen.world, spawn: gen.spawn });
    game.giveStarterKit();
    // A new island is stocked on the books; what is near the player takes a
    // body on the first streaming pass, and the rest waits to be walked to.
    game.creatures.stockIsland(game);
    game.logMsg('Welcome to Wurm Iso. You wash ashore on an untouched island with a few tools and your wits.', 'system');
    game.logMsg('Left-click to walk. Right-click a tile for actions. Drag to look around, scroll to zoom. Press F1 for help.', 'system');
    return game;
  }

  constructor(init: GameInit) {
    this.seed = init.seed;
    this.world = init.world;
    this.spawn = init.spawn;
    this.player = new Player(init.player?.x ?? init.spawn.x + 0.5, init.player?.y ?? init.spawn.y + 0.5);
    if (init.player) {
      this.player.name = init.player.name;
      this.player.stats = { ...init.player.stats };
      this.player.level = init.player.level ?? 0;
      this.player.visualLevel = this.player.level;
      if (init.player.equipped) this.player.equipped = { ...this.player.equipped, ...init.player.equipped };
      this.player.rested = init.player.rested ?? 0;
      this.player.boons = init.player.boons ?? [];
      this.player.affinities = init.player.affinities ?? {};
      this.player.titles = init.player.titles ?? [];
      this.player.title = init.player.title ?? null;
      this.player.wounds = init.player.wounds ?? [];
      this.player.nextWound = init.player.nextWound ?? 1;
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
    // A new castaway washes ashore at eight in the morning, not at midnight.
    this.time = init.time ?? (8 / 24) * DAY_SECONDS;
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
      if (level === 0 && !groundStep(this.world, x0, y0, x1, y1, this.climbStep())) return null;
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
    return groundStep(this.world, x0, y0, x1, y1, this.vehicleStep(this.driving())) ? 0 : null;
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
    return groundStep(this.world, x0, y0, x1, y1, this.mountStep(up)) ? 0 : null;
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
    return windAt(this.seed, this.time);
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

  onDeed(x: number, y: number): boolean {
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

  isToken(x: number, y: number): boolean {
    return !!this.deed && this.deed.x === x && this.deed.y === y;
  }

  insideBuilding(): Building | undefined {
    return this.buildings.buildingAt(this.player.tileX, this.player.tileY);
  }

  /** Why a tile cannot take a building plan, or null when it can. */
  planReason(x: number, y: number): string | null {
    if (!this.deed || !this.onDeed(x, y)) return 'You may only build on your own deed.';
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

  /** How much armour slows you down and tires you: the price of plate. */
  burden(): number {
    let sum = 0;
    for (const { def, item } of this.wornArmour()) sum += pieceBurden(def, item);
    const shield = this.worn('offhand');
    const sh = shield && SHIELDS[shield.id];
    if (sh) sum += sh.burden;
    return sum;
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
      this.logMsg(`Your ${itemName(item).toLowerCase()} is beaten to pieces and falls away.`, 'error');
    }
    this.events.emit('inventory');
    return { taken: raw * (1 - soak), part, worn: item, blocked: false };
  }

  /**
   * Hurt the player through their armour, and say what happened. What gets
   * through is not only a number off the bar: it leaves a wound, of a kind,
   * in whichever place the blow landed, and that wound has its own life.
   */
  hurtPlayer(raw: number, what: string, kind: WoundKind = 'bite'): void {
    const hit = this.absorb(raw);
    if (hit.blocked) {
      this.logMsg(`You take ${what} on your ${itemName(hit.worn as Item).toLowerCase()}.`, 'error');
      return;
    }
    this.player.stats.health = Math.max(0, this.player.stats.health - hit.taken);
    const wound = this.wound(kind, hit.part, hit.taken);
    const where = hit.worn ? `, though your ${itemName(hit.worn).toLowerCase()} takes the worst of it` : '';
    this.logMsg(`${what}${where}. You have ${woundText(wound)}.`, 'error');
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

  /** Hours since midnight, 0 up to 24. */
  hourOfDay(): number {
    return ((this.time % DAY_SECONDS) / DAY_SECONDS) * 24;
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
    this.time += seconds;
    // Everything that works by itself carries on working while you are under.
    if (this.campfires.size) this.burnFires(seconds);
    if (this.smelters.size) this.runSmelters(seconds);
    if (this.kilns.size) this.runKilns(seconds);
    if (this.furniture.size) this.runPlaceables(seconds, 0);
    if (this.posts.size) this.runPosts(seconds);
    if (this.traps.size) this.runTraps(seconds);
    if (this.crops.size) this.growCrops();
    if (this.ground.size) this.applyDecay(seconds);
    const s = this.player.stats;
    s.stamina = 1;
    s.health = Math.min(1, s.health + 0.25 * rest);
    // Sleeping is hungry work, and a night is a long time to go without water.
    s.hunger = Math.max(0, s.hunger - 0.2);
    s.thirst = Math.max(0, s.thirst - 0.25);
    this.gainSkill('body_stamina', 0.3 * rest);
    // A good bed banks more of the night than a poor one.
    const banked = this.bankRest(seconds, rest);
    this.logMsg(
      `You sleep in the ${what} and wake at ${this.clock()}, rested.${banked > 1 ? ` You have ${clockLeft(this.player.rested)} of rest in you; while it burns, everything teaches you twice as much.` : ''}`,
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
    return MAX_STEP + this.skills.get('climbing') * 0.4;
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
    mult += knackBonus(this.player.affinities[id]);
    for (const b of this.player.boons) if (b.skill === id && b.until > this.time) mult += b.bonus;
    return mult;
  }

  /**
   * Every ten points of a trade leaves a knack behind: usually in that trade,
   * sometimes in one beside it. They are permanent and they stack, up to five
   * to a trade, which is half again on everything that trade teaches you.
   */
  private earnKnacks(skill: string, before: number, after: number): void {
    for (let i = 0; i < stepsCrossed(before, after); i++) {
      const id = knackLands(skill, this.rand);
      const had = this.player.affinities[id] ?? 0;
      if (had >= KNACK_CAP) continue;
      this.player.affinities[id] = had + 1;
      const def = SKILL_DEFS.find((d) => d.id === id);
      this.logMsg(
        `You have a knack for ${def?.name.toLowerCase() ?? id} now. It goes in ${Math.round(knackBonus(had + 1) * 100)}% faster.`,
        'skill',
      );
      this.note('knack');
    }
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
    this.events.emit('skill', '', 0);
  }

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
  grantAffinity(itemId: string, ql: number): string | null {
    const skill = affinityOf(this.seed, itemId);
    if (!skill) return null;
    const seconds = affinityTime(itemId, ql);
    const def = SKILL_DEFS.find((d) => d.id === skill);
    const already = this.player.boons.find((b) => b.skill === skill && b.until > this.time);
    if (already) already.until = Math.max(already.until, this.time + seconds);
    else this.player.boons.push({ skill, bonus: AFFINITY_BONUS, until: this.time + seconds, from: itemName({ id: itemId, uid: 0, ql, dmg: 0, count: 1 }) });
    // Keep the list from growing without end as things run out.
    this.player.boons = this.player.boons.filter((b) => b.until > this.time);
    this.events.emit('inventory');
    return def ? `${def.name} comes easier for the next ${clockLeft(seconds)}.` : null;
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
    this.earnKnacks(id, before, now);
    this.earnTitles(id, before, now);
    this.events.emit('skill', id, gain);
    return gain;
  }

  logMsg(text: string, kind: LogKind = 'info'): void {
    const entry: LogEntry = { time: Date.now(), text, kind };
    this.log.push(entry);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
    this.events.emit('log', entry);
  }

  update(dt: number): void {
    this.time += dt;
    this.vision.update();
    const p = this.player;
    // On a seat you go at your team's pace, in the saddle at your mount's, and
    // on your own feet at your own.
    const driven = this.driving();
    const up = this.mounted();
    const boat = this.afloat();
    p.speedMul = boat ? this.boatSpeed(boat) / BASE_SPEED : driven ? this.vehicleSpeed(driven) / BASE_SPEED : up ? this.mountSpeed(up) / BASE_SPEED : 1;
    const { rule } = this.movement();
    const moved = p.update(dt, this.world, rule);
    if (boat && furnitureDef(boat.kind).boat?.sail && moved > 0) {
      const w = this.wind();
      if (w.force >= 0.5 && sailWord(this.heading(), w) === 'reaching') this.note('reach');
      const cap = furnitureCapacity(boat);
      if (cap && furnitureUnits(boat) > cap / 2) this.note('laden');
    }

    if (up) this.carryRider(up, dt, moved);
    const s = p.stats;
    s.hunger = Math.max(0, s.hunger - dt * 0.0004);
    s.thirst = Math.max(0, s.thirst - dt * 0.0006);

    // What climbing and swimming have earned, and what the armour costs, before the next step.
    p.burden = this.burden();
    p.maxStep = this.climbStep();
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
      // Deep water is its own teacher, and a strong swimmer tires more slowly.
      this.swimClock += dt;
      if (this.swimClock >= 1) {
        this.swimClock = 0;
        this.gainSkill('swimming', 0.09);
      }
      s.stamina = Math.max(0, s.stamina - dt * 0.03 * Math.max(0.4, 1 - this.skills.get('swimming') / 200));
      if (s.stamina <= 0) {
        s.health = Math.max(0, s.health - dt * 0.05);
        if (this.time - this.drownWarning > 4) {
          this.drownWarning = this.time;
          this.logMsg('You are exhausted and swallowing water. Get to shore!', 'error');
        }
      }
    } else if (!performing) {
      // Body stamina is what gets your wind back between jobs.
      const wind = 1 + Math.max(0, this.skills.get('body_stamina') - CHAR_START) * 0.005;
      const regen = (moved > 0 ? 0.012 : 0.05) * wind;
      const starving = s.hunger <= 0 || s.thirst <= 0 ? 0.3 : 1;
      s.stamina = Math.min(1, s.stamina + dt * regen * starving);
      // Nothing knits while it is still open: see to the wound first.
      if (s.hunger > 0.2 && s.thirst > 0.2 && s.health < 1 && !this.bleeding()) s.health = Math.min(1, s.health + dt * 0.004);
    }
    this.tendWounds(dt);
    if (s.health <= 0) this.die();

    if (this.action) this.updateAction(dt);
    if (this.campfires.size) this.burnFires(dt);
    if (this.smelters.size) this.runSmelters(dt);
    if (this.kilns.size) this.runKilns(dt);
    if (this.furniture.size) this.runPlaceables(dt, moved);
    if (this.posts.size) this.runPosts(dt);
    if (this.traps.size) this.runTraps(dt);
    if (this.crops.size) this.growCrops();
    this.creatures.update(dt, this);

    this.decayClock += dt;
    if (this.decayClock >= DECAY_STEP && this.ground.size) {
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
    const p = this.player;
    if (a.state === 'walking') {
      if (p.inputDir.x !== 0 || p.inputDir.y !== 0) {
        this.cancelAction(true);
        return;
      }
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
    const again = a.def.perform(a.target, this) === true;
    if (a.def.tool) this.wearTool(a.def.tool);
    const cost = this.staminaCost(a.def.stamina);
    this.player.stats.stamina = Math.max(0, this.player.stats.stamina - cost);
    if (a.def.skill) this.gainSkill(a.def.skill);
    // The body learns from the work itself: wind from spending it, control from doing it.
    if (cost > 0) this.gainSkill('body_stamina', 0.05 + cost * 0.6);
    this.gainSkill('body_control', 0.05);
    if (again && a.def.repeat && this.player.stats.stamina > 0.05 && this.action === a) {
      a.elapsed = 0;
      a.duration = this.duration(a.def);
    } else if (this.action === a) {
      this.action = null;
      this.nextInQueue();
    }
    this.events.emit('action');
  }

  cancelAction(silent = false): void {
    const a = this.action;
    this.clearQueue(silent || !a);
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

  requestAction(def: ActionDef, target: Target): void {
    const reason = def.check?.(target, this);
    if (reason) {
      this.logMsg(reason, 'error');
      return;
    }
    if (def.instant) {
      def.perform(target, this);
      return;
    }
    if (this.player.stats.stamina < 0.08) {
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
      this.queue.push({ def, target });
      this.logMsg(`${def.label} is next, ${this.queue.length + 1} of ${this.queueCapacity()} in hand.`, 'info');
      this.events.emit('action');
      return;
    }
    this.startAction(def, target);
  }

  /** Put an action in hand and either begin it or start walking to it. */
  private startAction(def: ActionDef, target: Target): void {
    this.action = { def, target, state: 'walking', elapsed: 0, duration: this.duration(def) };
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

  private nextInQueue(): boolean {
    const next = this.queue.shift();
    if (!next) return false;
    const reason = this.jobReason(next.def, next.target);
    if (reason) {
      this.logMsg(`${next.def.label}: ${reason}`, 'error');
      return this.nextInQueue();
    }
    this.startAction(next.def, next.target);
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
  moveTo(x: number, y: number): void {
    this.cancelAction();
    const p = this.player;
    if (!this.world.inBounds(x, y)) return;
    const { rule, levels } = this.movement();
    if (this.world.isPassable(x, y) && p.walkTo(this.world, x, y, rule, levels)) return;
    const candidates = this.neighbours(x, y).filter((c) => this.world.isPassable(c.x, c.y));
    candidates.sort((a, b) => this.distanceToPlayer(a.x, a.y) - this.distanceToPlayer(b.x, b.y));
    for (const c of candidates) if (p.walkTo(this.world, c.x, c.y, rule, levels)) return;
    this.logMsg("You can't find a way there.", 'error');
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

  duration(def: ActionDef): number {
    const skill = def.skill ? this.skills.get(def.skill) : 50;
    const toolQl = def.tool ? this.toolQl(def.tool) : 0;
    return Math.max(1.2, def.baseTime * (1 - skill / 140) * (1 - toolQl / 400) * this.controlSpeed());
  }

  /**
   * What a tool is worth at the work: its quality, dragged down by the state
   * it is in and lifted or lowered by the metal of its head. This is what
   * decides how fast a job goes, how often it comes out right, and how good
   * what comes out of it is, so the metal reaches all three at once.
   */
  toolQl(id: string): number {
    const tool = this.inventory.tool(id);
    // A battered tool works like a poorer one than it was.
    return tool ? Math.min(100, workingQl(tool.ql, tool.extra) * rarityOf(tool).boost) * Math.max(0.3, 1 - tool.dmg / 160) : 0;
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
    const stack = def?.stackable ? crate.items.find((it) => it.id === item.id && it.extra === item.extra) : undefined;
    if (stack) {
      stack.ql = (stack.ql * stack.count + item.ql * item.count) / (stack.count + item.count);
      stack.count += item.count;
    } else crate.items.push(item);
    this.events.emit('crate');
    return true;
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
  private runPlaceables(dt: number, moved: number): void {
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
      if (def.vehicle && teamOf(f).length) this.haulVehicle(f, dt, moved);
      if (def.boat && f.driven) this.floatBoat(f);
    }
  }

  /**
   * The one vehicle the player is driving, if any. Nothing else in the world
   * can be driven at the same time, which is what keeps this a lookup.
   */
  driving(): PlacedFurniture | undefined {
    for (const f of this.furniture.values()) if (f.driven) return f;
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
    return Math.min(MAX_MOUNT_SPEED, def.speed * ageDef(c, this.time).speed * this.creatures.speedMul(c) * footing(c.skills[HAUL_SKILL] ?? 0) * (0.6 + 0.4 * c.hunger));
  }

  /**
   * The steepest step a mount will take. A green one is no worse than your own
   * legs and a worked one goes up what you would have to go round, which is
   * what the climbing it earns on bad ground is for.
   */
  mountStep(c: Creature): number {
    const sure = this.creatures.species(c).pitch ?? 1;
    return MAX_STEP + (c.skills[HAUL_SKILL] ?? 0) * CLIMB_PITCH * 2 * sure;
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
  }

  /**
   * Bring the tiles around a corner in line with the soil left on it: strip
   * the last dirt from all four corners of a tile and its bedrock shows.
   */
  exposeRock(cx: number, cy: number): void {
    this.world.reconcileAround(cx, cy);
  }

  /** Light up the ore a prospector just read, for a while. */
  markProspected(tiles: number[]): void {
    this.prospected = tiles.length ? { tiles: new Set(tiles), until: this.time + PROSPECT_MARK_TIME } : null;
  }

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

  addFurniture(kind: string, x: number, y: number, sx: number, sy: number, ql: number, items: Item[] = [], material?: string): PlacedFurniture {
    const [ax, ay] = furnitureAnchor(kind, sx, sy);
    const f: PlacedFurniture = { id: this.nextFurnitureId++, x, y, sx: ax, sy: ay, kind, ql, items, material };
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
  furniturePlaceReason(kind: string, x: number, y: number, sx: number, sy: number): string | null {
    const def = furnitureDef(kind);
    const [ax, ay] = furnitureAnchor(kind, sx, sy);
    if (def.boat) {
      // A hull goes in the water and nowhere else, and you have to be able to
      // reach the water you are putting it in.
      if (!this.launchSpot(kind, x, y)) return `There is not ${def.boat.draught} deep of water there. Launch her off a bank with some depth to it.`;
      if (Math.hypot(x + 0.5 - this.player.x, y + 0.5 - this.player.y) > 4) return 'Stand at the water you mean to launch her into.';
      for (let dy = 0; dy < def.h; dy++) for (let dx = 0; dx < def.w; dx++) if (this.occupiedSubtile(x, y, ax + dx, ay + dy)) return 'Something is already in the water there.';
      return null;
    }
    if (!this.world.isPassable(x, y) || this.world.hasWater(x, y)) return 'Furniture needs dry, solid ground.';
    if (this.world.slope(x, y) > 16) return 'The floor is too uneven for it to stand.';
    if (this.isToken(x, y)) return 'Not on the token.';
    for (let dy = 0; dy < def.h; dy++) {
      for (let dx = 0; dx < def.w; dx++) {
        if (this.occupiedSubtile(x, y, ax + dx, ay + dy)) return 'Something is already standing there.';
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
      // A bulk bin that will not take a tool is not the nearest store for a tool.
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
    const stack = def?.stackable ? c.pannier.find((it) => it.id === item.id && it.extra === item.extra) : undefined;
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
    const stack = def?.stackable ? f.items.find((it) => it.id === item.id && it.extra === item.extra) : undefined;
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
  occupiedSubtile(x: number, y: number, sx: number, sy: number): boolean {
    if (this.crateAt(x, y, sx, sy)) return true;
    if (this.campfireAt(x, y, sx, sy)) return true;
    for (const s of this.placed.smelters.at(x, y)) if (smelterCovers(s, sx, sy)) return true;
    for (const k of this.placed.kilns.at(x, y)) if (kilnCovers(k, sx, sy)) return true;
    for (const f of this.placed.furniture.at(x, y)) if (furnitureCovers(f, sx, sy)) return true;
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
      s.jobs.shift();
      const made: Item =
        job.makes === 'anvil'
          ? { uid: this.inventory.nextUid++, id: 'anvil', ql: job.ql, dmg: 0, count: 1, extra: job.item.id.replace('_lump', '') }
          : { uid: this.inventory.nextUid++, id: job.makes, ql: job.ql, dmg: 0, count: 1 };
      s.output.push(made);
      this.logMsg(`The smelter finishes a ${ITEM_DEFS[made.id]?.name.toLowerCase() ?? made.id}. (QL ${made.ql.toFixed(1)})`, 'event');
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
      k.jobs.shift();
      const made: Item = { uid: this.inventory.nextUid++, id: job.makes, ql: job.ql, dmg: 0, count: 1 };
      k.output.push(made);
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
      const per = cropDef(c.id).stageSeconds;
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
    const stack = def?.stackable ? pile.find((it) => it.id === item.id && it.extra === item.extra) : undefined;
    if (stack) {
      stack.ql = (stack.ql * stack.count + item.ql * item.count) / (stack.count + item.count);
      stack.count += item.count;
    } else pile.push(item);
    this.ground.set(key, pile);
    this.events.emit('world', x, y);
  }

  /** Remove one item (by uid) or everything (null) from a tile. */
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
    this.cancelAction(true);
    this.logMsg('You have died. You wake up, shivering, where you first came ashore.', 'error');
  }

  say(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('/')) {
      this.command(trimmed.slice(1));
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
        this.logMsg('Commands: /name <name>, /where, /help. Press F1 for controls.', 'system');
        break;
      default:
        this.logMsg(`Unknown command: /${name}`, 'error');
    }
  }
}
