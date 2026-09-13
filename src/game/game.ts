import { generateWorld } from '../world/generate';
import { TileType } from '../world/tiles';
import { World } from '../world/world';
import { ACTIONS, type ActionDef, type Target } from './actions';
import { Buildings, connectsDown, floorKind, isDone, MAX_LEVELS, walkableKind, type BuildingsJSON, type Building } from './building';
import { CRATE_DEFS, crateCentre, crateUnits, type CrateKind, type PlacedCrate } from './crates';
import { fireAnchor, fireCentre, fireCovers, FIRE_SUBTILES, type PlacedCampfire } from './campfire';
import { cropDef, RIPE, type Crop } from './farming';
import { rockKindAt } from '../world/ore';
import { CALL_WINDOW, Creatures, type CreatureJSON } from './creatures';
import type { Station } from './recipes';
import { Emitter, type GameEvents, type LogEntry, type LogKind } from './events';
import { groundDecayRate, Inventory, ITEM_DEFS, itemName, type Item } from './items';
import { groundStep, Player } from './player';
import { Skills, SKILL_DEFS } from './skills';

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
export interface Deed {
  name: string;
  x: number;
  y: number;
  radius: number;
  /** Upgrades bought so far; level 1 is a freshly founded settlement. */
  level?: number;
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
  creatures?: { nextId: number; list: CreatureJSON[] };
  crates?: PlacedCrate[];
  /** Pre-crate-grid saves kept a single deed crate. */
  crate?: { x: number; y: number; items: Item[] } | null;
  campfires?: PlacedCampfire[];
  crops?: Crop[];
  player?: { x: number; y: number; name: string; stats: Player['stats']; level?: number };
  inventory?: Item[];
  nextUid?: number;
  ground?: Record<string, Item[]>;
  skills?: Record<string, number>;
  time?: number;
}

const FORAGE_COOLDOWN = 180;
/** How long ore stays lit after prospecting. */
const PROSPECT_MARK_TIME = 120;
const MAX_LOG = 400;
/** Seconds between ground decay passes while playing. */
const DECAY_STEP = 5;

/** Central simulation state: the world, the player and everything they do. */
export class Game {
  readonly seed: number;
  readonly world: World;
  readonly spawn: { x: number; y: number };
  readonly player: Player;
  readonly inventory: Inventory;
  readonly skills: Skills;
  readonly events = new Emitter<GameEvents>();
  readonly log: LogEntry[] = [];
  readonly settings = { grid: true, rotation: 0, deedBorder: true };
  readonly buildings: Buildings;
  readonly creatures: Creatures;
  deed: Deed | null = null;
  /** Placed crates by id; each sits on one subtile. */
  readonly crates = new Map<number, PlacedCrate>();
  nextCrateId = 1;
  /** Campfires by id; each covers a two by two block of subtiles. */
  readonly campfires = new Map<number, PlacedCampfire>();
  nextFireId = 1;
  /** Crops growing on tilled fields, keyed by "x,y". */
  readonly crops = new Map<string, Crop>();
  /** Tiles a prospector has marked, and when the marks fade. */
  prospected: { tiles: Set<number>; until: number } | null = null;
  hooks: GameHooks = { prompt: (_q, fallback) => fallback, confirm: () => true };
  action: ActiveAction | null = null;
  /** Items lying on tiles, keyed by "x,y". */
  readonly ground = new Map<string, Item[]>();
  /** Game seconds since the world was created. */
  time = 0;
  rand: () => number = Math.random;
  private foraged = new Map<number, number>();
  private drownWarning = 0;
  private decayClock = 0;

  static create(seed: number, size = 256): Game {
    const gen = generateWorld(seed, size);
    const game = new Game({ seed, world: gen.world, spawn: gen.spawn });
    game.giveStarterKit();
    game.creatures.spawnWild(game, 45);
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
    this.time = init.time ?? 0;
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
    this.world.onChange((x, y) => this.events.emit('world', x, y));
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
      if (level === 0 && !groundStep(this.world, x0, y0, x1, y1)) return null;
      return level;
    }
    if (level > 0 && this.connector(x0, y0, level) && this.standable(x1, y1, level - 1) && !b.blocksAt(level - 1, x0, y0, x1, y1)) {
      return level - 1;
    }
    return null;
  };

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

  /** Raise a skill and announce it. Returns the gain. */
  gainSkill(id: string, base = 0.45): number {
    const def = SKILL_DEFS.find((d) => d.id === id);
    const gain = this.skills.gain(id, base, this.rand);
    if (gain > 0.00005 && def) {
      this.logMsg(`${def.name} increased by ${gain.toFixed(4)} to ${this.skills.get(id).toFixed(4)}.`, 'skill');
      this.events.emit('skill', id, gain);
    }
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
    const p = this.player;
    const moved = p.update(dt, this.world, this.stepRule);
    const s = p.stats;
    s.hunger = Math.max(0, s.hunger - dt * 0.0004);
    s.thirst = Math.max(0, s.thirst - dt * 0.0006);

    const performing = this.action?.state === 'performing';
    if (p.swimming) {
      s.stamina = Math.max(0, s.stamina - dt * 0.03);
      if (s.stamina <= 0) {
        s.health = Math.max(0, s.health - dt * 0.05);
        if (this.time - this.drownWarning > 4) {
          this.drownWarning = this.time;
          this.logMsg('You are exhausted and swallowing water. Get to shore!', 'error');
        }
      }
    } else if (!performing) {
      const regen = moved > 0 ? 0.012 : 0.05;
      const starving = s.hunger <= 0 || s.thirst <= 0 ? 0.3 : 1;
      s.stamina = Math.min(1, s.stamina + dt * regen * starving);
      if (s.hunger > 0.2 && s.thirst > 0.2 && s.health < 1) s.health = Math.min(1, s.health + dt * 0.004);
    }
    if (s.health <= 0) this.die();

    if (this.action) this.updateAction(dt);
    if (this.campfires.size) this.burnFires(dt);
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
    const reason = a.def.check?.(a.target, this);
    if (reason) {
      this.logMsg(reason, 'error');
      this.action = null;
      this.events.emit('action');
      return;
    }
    const again = a.def.perform(a.target, this) === true;
    this.player.stats.stamina = Math.max(0, this.player.stats.stamina - a.def.stamina);
    if (a.def.skill) this.gainSkill(a.def.skill);
    if (again && a.def.repeat && this.player.stats.stamina > 0.05 && this.action === a) {
      a.elapsed = 0;
      a.duration = this.duration(a.def);
    } else if (this.action === a) {
      this.action = null;
    }
    this.events.emit('action');
  }

  cancelAction(silent = false): void {
    const a = this.action;
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
    this.cancelAction(true);
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
    }
    this.events.emit('action');
  }

  /** Walk to a tile; when the tile itself is blocked, stop next to it. */
  moveTo(x: number, y: number): void {
    this.cancelAction();
    const p = this.player;
    if (!this.world.inBounds(x, y)) return;
    if (this.world.isPassable(x, y) && p.walkTo(this.world, x, y, this.stepRule, MAX_LEVELS)) return;
    const candidates = this.neighbours(x, y).filter((c) => this.world.isPassable(c.x, c.y));
    candidates.sort((a, b) => this.distanceToPlayer(a.x, a.y) - this.distanceToPlayer(b.x, b.y));
    for (const c of candidates) if (p.walkTo(this.world, c.x, c.y, this.stepRule, MAX_LEVELS)) return;
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
    return { x: target.x, y: target.y };
  }

  inRange(def: ActionDef, target: Target): boolean {
    if (target.kind === 'item') return true;
    const tile = this.targetTile(target);
    if (!tile) return false;
    const px = this.player.tileX;
    const py = this.player.tileY;
    if (def.corner && target.kind === 'tile') return px >= target.cx - 1 && px <= target.cx && py >= target.cy - 1 && py <= target.cy;
    return Math.max(Math.abs(px - tile.x), Math.abs(py - tile.y)) <= 1;
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
    for (const c of candidates) {
      if (this.player.walkTo(this.world, c.x, c.y, this.stepRule, MAX_LEVELS)) return true;
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
    return Math.max(1.2, def.baseTime * (1 - skill / 140) * (1 - toolQl / 400));
  }

  toolQl(id: string): number {
    return this.inventory.tool(id)?.ql ?? 0;
  }

  /** Wurm-flavoured success roll: better skill and tools help, difficulty hurts. */
  skillCheck(skill: string, difficulty = 10, toolQl = 0): boolean {
    const s = this.skills.get(skill);
    const chance = Math.min(0.98, Math.max(0.3, 0.6 + (s / 100) * 0.38 + toolQl / 500 - difficulty / 150));
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
    return crate;
  }

  removeCrate(id: number): void {
    this.crates.delete(id);
    this.events.emit('crate');
  }

  crateAt(x: number, y: number, sx: number, sy: number): PlacedCrate | undefined {
    for (const c of this.crates.values()) if (c.x === x && c.y === y && c.sx === sx && c.sy === sy) return c;
    return undefined;
  }

  cratesOnTile(x: number, y: number): PlacedCrate[] {
    const out: PlacedCrate[] = [];
    for (const c of this.crates.values()) if (c.x === x && c.y === y) out.push(c);
    return out;
  }

  /** The settlement's crate, where deed workers deliver. */
  deedCrate(): PlacedCrate | undefined {
    for (const c of this.crates.values()) if (c.deed) return c;
    return undefined;
  }

  /** The crate closest to the player. */
  nearestCrate(): PlacedCrate | undefined {
    let best: PlacedCrate | undefined;
    let bestD = Infinity;
    for (const c of this.crates.values()) {
      const [cx, cy] = crateCentre(c);
      const d = Math.hypot(cx - this.player.x, cy - this.player.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
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
    this.events.emit('crate');
    return fire;
  }

  removeCampfire(id: number): void {
    this.campfires.delete(id);
    this.events.emit('crate');
  }

  campfiresOnTile(x: number, y: number): PlacedCampfire[] {
    const out: PlacedCampfire[] = [];
    for (const f of this.campfires.values()) if (f.x === x && f.y === y) out.push(f);
    return out;
  }

  /** The fire covering a subtile, if any. */
  campfireAt(x: number, y: number, sx: number, sy: number): PlacedCampfire | undefined {
    for (const f of this.campfires.values()) if (f.x === x && f.y === y && fireCovers(f, sx, sy)) return f;
    return undefined;
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
    for (const f of this.campfires.values()) {
      if (!f.lit) continue;
      const [cx, cy] = fireCentre(f);
      const d = Math.hypot(cx - this.player.x, cy - this.player.y);
      if (d <= bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  /** Whether the player is standing somewhere a recipe's station requires. */
  atStation(station: Station): boolean {
    return station === 'campfire' ? this.litFireNear() !== undefined : false;
  }

  /** Burn down every lit fire; one that runs out goes cold. */
  private burnFires(dt: number): void {
    for (const f of this.campfires.values()) {
      if (!f.lit) continue;
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
    this.world.reconcileAround(cx, cy, (x, y) => rockKindAt(this.world.seed, x, y));
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
    const k = kind === 'forage' ? 0 : kind === 'botanize' ? 1 : 2;
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
