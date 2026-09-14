import { generateWorld } from '../world/generate';
import { TileType } from '../world/tiles';
import { World } from '../world/world';
import { ACTIONS, type ActionDef, type Target } from './actions';
import { Buildings, connectsDown, floorKind, isDone, MAX_LEVELS, walkableKind, type BuildingsJSON, type Building } from './building';
import { CRATE_DEFS, crateCentre, crateName, crateUnits, subtileOf, type CrateKind, type PlacedCrate } from './crates';
import { anvilAnchor, anvilCovers, ANVIL_SUBTILES, type PlacedAnvil } from './anvil';
import { fireAnchor, fireCentre, fireCovers, FIRE_SUBTILES, type PlacedCampfire } from './campfire';
import { smelterAnchor, smelterCentre, smelterCovers, SMELTER_H, SMELTER_W, type PlacedSmelter } from './smelter';
import { kilnAnchor, kilnCovers, KILN_SUBTILES, type PlacedKiln } from './kiln';
import { furnitureAnchor, furnitureCapacity, furnitureCentre, furnitureCovers, furnitureDef, furnitureRefuses, furnitureUnits, teamOf, vehicleOf, type PlacedFurniture } from './furniture';
import { cropDef, RIPE, type Crop } from './farming';
import { CALL_WINDOW, Creatures, type Creature, type CreatureJSON, type Stance } from './creatures';
import type { Station } from './recipes';
import { Emitter, type GameEvents, type LogEntry, type LogKind } from './events';
import { groundDecayRate, Inventory, ITEM_DEFS, itemName, type Item } from './items';
import { BASE_SPEED, groundStep, MAX_STEP, Player, SWIM_SPEED } from './player';
import { ARMOUR_BY_ID, ARMOUR_CLASSES, HIT_LOCATIONS, pieceSoak, SHIELDS, WEAPON_BY_ID, type Slot } from './gear';
import { Skills, SKILL_DEFS } from './skills';
import { TileIndex } from './tileindex';
import { Vision } from './vision';

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
  anvils?: PlacedAnvil[];
  crops?: Crop[];
  player?: { x: number; y: number; name: string; stats: Player['stats']; level?: number; equipped?: Record<string, number | null> };
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
/** Steepest ground a wheel will go up, against a walker's own limit. */
const VEHICLE_STEP = MAX_STEP / 2;
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
  };
  readonly buildings: Buildings;
  /** What can be seen from where you are, and what is only remembered. */
  readonly vision: Vision;
  readonly creatures: Creatures;
  deed: Deed | null = null;
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
    this.inventory.add('hatchet', { ql: 20 });
    this.inventory.add('shovel', { ql: 20 });
    this.inventory.add('pickaxe', { ql: 20 });
    this.inventory.add('carving_knife', { ql: 20 });
    this.inventory.add('chisel', { ql: 15 });
    this.inventory.add('mallet', { ql: 20 });
    this.inventory.add('trowel', { ql: 20 });
    this.inventory.add('saw', { ql: 20 });
    this.inventory.add('butchering_knife', { ql: 20 });
    this.inventory.add('rake', { ql: 20 });
    this.inventory.add('water_skin', { ql: 30 });
    this.inventory.add('deed_stake', { ql: 50 });
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
    if (!this.vehicleGround(x1, y1)) return null;
    if (this.buildings.blocksAt(0, x0, y0, x1, y1)) return null;
    return groundStep(this.world, x0, y0, x1, y1, VEHICLE_STEP) ? 0 : null;
  };

  /** How the player may move right now, and how many storeys they may cross. */
  movement(): { rule: (x0: number, y0: number, level: number, x1: number, y1: number) => number | null; levels: number } {
    return this.driving() ? { rule: this.driveRule, levels: 1 } : { rule: this.stepRule, levels: MAX_LEVELS };
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
    for (const { def } of this.wornArmour()) sum += ARMOUR_CLASSES[def.cls].burden / 5;
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

  /** Hurt the player through their armour, and say what happened. */
  hurtPlayer(raw: number, what: string): void {
    const hit = this.absorb(raw);
    if (hit.blocked) {
      this.logMsg(`You take ${what} on your ${itemName(hit.worn as Item).toLowerCase()}.`, 'error');
      return;
    }
    this.player.stats.health = Math.max(0, this.player.stats.health - hit.taken);
    const where = hit.worn ? `, though your ${itemName(hit.worn).toLowerCase()} takes the worst of it` : '';
    this.logMsg(`${what}${where}.`, 'error');
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
    if (this.furniture.size) this.runPlaceables(seconds);
    if (this.crops.size) this.growCrops();
    if (this.ground.size) this.applyDecay(seconds);
    const s = this.player.stats;
    s.stamina = 1;
    s.health = Math.min(1, s.health + 0.25 * rest);
    // Sleeping is hungry work, and a night is a long time to go without water.
    s.hunger = Math.max(0, s.hunger - 0.2);
    s.thirst = Math.max(0, s.thirst - 0.25);
    this.gainSkill('body_stamina', 0.3 * rest);
    this.logMsg(`You sleep in the ${what} and wake at ${this.clock()}, rested.`, 'event');
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
  gainSkill(id: string, base = 0.45): number {
    const def = SKILL_DEFS.find((d) => d.id === id);
    const before = this.skills.get(id);
    const gain = this.skills.gain(id, base, this.rand);
    if (gain <= 0.00005 || !def) return gain;
    const now = this.skills.get(id);
    // What you pick up in the background says less about itself than what you set out to do.
    if (def.group === 'Characteristics' || QUIET_SKILLS.has(id)) {
      if (Math.floor(now) > Math.floor(before)) {
        const room = id === 'mind_logic' && this.queueCapacity() > BASE_QUEUE + Math.floor(Math.max(0, before - CHAR_START) / 10);
        this.logMsg(`${def.name} is now ${Math.floor(now)}.${room ? ` You can keep ${this.queueCapacity()} jobs in your head.` : ''}`, 'skill');
      }
    } else {
      this.logMsg(`${def.name} increased by ${gain.toFixed(4)} to ${now.toFixed(4)}.`, 'skill');
    }
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
    // On a seat you go at your team's pace; on your feet, at your own.
    const driven = this.driving();
    p.speedMul = driven ? this.vehicleSpeed(driven) / BASE_SPEED : 1;
    const moved = p.update(dt, this.world, driven ? this.driveRule : this.stepRule);
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
    const performing = this.action?.state === 'performing';
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
      if (s.hunger > 0.2 && s.thirst > 0.2 && s.health < 1) s.health = Math.min(1, s.health + dt * 0.004);
    }
    if (s.health <= 0) this.die();

    if (this.action) this.updateAction(dt);
    if (this.campfires.size) this.burnFires(dt);
    if (this.smelters.size) this.runSmelters(dt);
    if (this.kilns.size) this.runKilns(dt);
    if (this.furniture.size) this.runPlaceables(dt);
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

  toolQl(id: string): number {
    const tool = this.inventory.tool(id);
    // A battered tool works like a poorer one than it was.
    return tool ? tool.ql * Math.max(0.3, 1 - tool.dmg / 160) : 0;
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
    item.dmg = Math.min(100, item.dmg + amount);
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

  productQl(skill: string, toolQl = 0): number {
    const s = this.skills.get(skill);
    return Math.min(100, Math.max(1, s * (0.6 + this.rand() * 0.8) + toolQl * 0.15 + 1));
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

  addCrate(kind: CrateKind, x: number, y: number, sx: number, sy: number, items: Item[] = [], deed = false): PlacedCrate {
    const crate: PlacedCrate = { id: this.nextCrateId++, x, y, sx, sy, kind, items, deed };
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
    if (crateUnits(crate) + item.count > CRATE_DEFS[crate.kind].capacity) return false;
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

  /**
   * Everything placed that works by itself: ovens burning down, wells filling,
   * rubbish rotting where it was thrown, and a cart following you about.
   */
  private runPlaceables(dt: number): void {
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
      if (def.vehicle && teamOf(f).length) this.haulVehicle(f, dt);
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
   * pull better than fewer, and a hungry one drags its feet. What is loaded on
   * the back has no say at all, which is the whole point of putting it there.
   */
  vehicleSpeed(f: PlacedFurniture): number {
    const v = vehicleOf(f);
    const team = this.team(f);
    if (!v || team.length < v.needs) return 0;
    let sum = 0;
    let worst = 1;
    for (const c of team) {
      sum += this.creatures.species(c).speed;
      worst = Math.min(worst, 0.6 + 0.4 * c.hunger);
    }
    const mean = sum / team.length;
    return Math.min(MAX_VEHICLE_SPEED, mean * (0.75 + 0.25 * team.length) * worst);
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
    if (!v || c.hitchedTo !== null || teamOf(f).length >= v.yokes) return false;
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
  private haulVehicle(f: PlacedFurniture, dt: number): void {
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
        // Hauling is work, and work is hungry.
        c.hunger = Math.max(0, c.hunger - dt * HAUL_HUNGER);
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

  addFurniture(kind: string, x: number, y: number, sx: number, sy: number, ql: number, items: Item[] = []): PlacedFurniture {
    const [ax, ay] = furnitureAnchor(kind, sx, sy);
    const f: PlacedFurniture = { id: this.nextFurnitureId++, x, y, sx: ax, sy: ay, kind, ql, items };
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
  deedStores(): DeedStore[] {
    // A field worker asks this for every tile it looks at, so build the list
    // once a tick. The entries hold the crates and pieces themselves, so what
    // is inside them is always current; only the set of them is cached.
    const stamp = this.crates.size * 1000 + this.furniture.size;
    if (this.storeCache && this.storeCache.at === this.time && this.storeCache.stamp === stamp) return this.storeCache.stores;
    const out: DeedStore[] = [];
    for (const c of this.crates.values()) {
      if (!this.onDeed(c.x, c.y)) continue;
      const cap = CRATE_DEFS[c.kind].capacity;
      out.push({
        x: c.x,
        y: c.y,
        centre: crateCentre(c),
        items: c.items,
        name: crateName(c),
        deed: !!c.deed,
        room: (item) => crateUnits(c) + item.count <= cap,
        add: (item) => this.crateAdd(c, item),
        changed: () => this.events.emit('crate'),
      });
    }
    for (const f of this.furniture.values()) {
      const def = furnitureDef(f.kind);
      if (!def.capacity || def.trash || !this.onDeed(f.x, f.y)) continue;
      out.push({
        x: f.x,
        y: f.y,
        centre: furnitureCentre(f),
        items: f.items,
        name: def.name,
        deed: false,
        room: (item) => !furnitureRefuses(f, item) && furnitureUnits(f) + item.count <= (def.capacity ?? 0),
        add: (item) => this.furnitureAdd(f, item),
        changed: () => this.events.emit('crate'),
      });
    }
    this.storeCache = { at: this.time, stamp, stores: out };
    return out;
  }

  private storeCache: { at: number; stamp: number; stores: DeedStore[] } | null = null;

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
