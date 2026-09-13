import { generateWorld } from '../world/generate';
import { World } from '../world/world';
import { ACTIONS, type ActionDef, type Target } from './actions';
import { Emitter, type GameEvents, type LogEntry, type LogKind } from './events';
import { groundDecayRate, Inventory, ITEM_DEFS, itemName, type Item } from './items';
import { Player } from './player';
import { Skills, SKILL_DEFS } from './skills';

export interface ActiveAction {
  def: ActionDef;
  target: Target;
  state: 'walking' | 'performing';
  elapsed: number;
  duration: number;
}

export interface GameInit {
  seed: number;
  world: World;
  spawn: { x: number; y: number };
  player?: { x: number; y: number; name: string; stats: Player['stats'] };
  inventory?: Item[];
  nextUid?: number;
  ground?: Record<string, Item[]>;
  skills?: Record<string, number>;
  time?: number;
}

const FORAGE_COOLDOWN = 180;
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
  readonly settings = { grid: true, rotation: 0 };
  action: ActiveAction | null = null;
  /** Items lying on tiles, keyed by "x,y". */
  readonly ground = new Map<string, Item[]>();
  /** Game seconds since the world was created. */
  time = 0;
  rand: () => number = Math.random;
  private foraged = new Map<string, number>();
  private drownWarning = 0;
  private decayClock = 0;

  static create(seed: number, size = 256): Game {
    const gen = generateWorld(seed, size);
    const game = new Game({ seed, world: gen.world, spawn: gen.spawn });
    game.giveStarterKit();
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
    this.world.onChange((x, y) => this.events.emit('world', x, y));
  }

  giveStarterKit(): void {
    this.inventory.add('hatchet', { ql: 20 });
    this.inventory.add('shovel', { ql: 20 });
    this.inventory.add('pickaxe', { ql: 20 });
    this.inventory.add('carving_knife', { ql: 20 });
    this.inventory.add('chisel', { ql: 15 });
    this.inventory.add('water_skin', { ql: 30 });
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
    const moved = p.update(dt, this.world);
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

  /** How fast things rot at a spot: 1 in the wild. A deed would lower this for its land. */
  decayMultiplier(_x: number, _y: number): number {
    return 1;
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
        else {
          this.logMsg('You are too far away from that.', 'error');
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
    if (a.def.skill) {
      const def = SKILL_DEFS.find((d) => d.id === a.def.skill);
      const gain = this.skills.gain(a.def.skill, 0.45, this.rand);
      if (gain > 0.00005 && def) {
        this.logMsg(`${def.name} increased by ${gain.toFixed(4)} to ${this.skills.get(a.def.skill).toFixed(4)}.`, 'skill');
        this.events.emit('skill', a.def.skill, gain);
      }
    }
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
      if (!def.applies(target, this)) continue;
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
    if (!this.walkToward(def, target)) {
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
    if (this.world.isPassable(x, y) && p.walkTo(this.world, x, y)) return;
    const candidates = this.neighbours(x, y).filter((c) => this.world.isPassable(c.x, c.y));
    candidates.sort((a, b) => this.distanceToPlayer(a.x, a.y) - this.distanceToPlayer(b.x, b.y));
    for (const c of candidates) if (p.walkTo(this.world, c.x, c.y)) return;
    this.logMsg("You can't find a way there.", 'error');
  }

  inRange(def: ActionDef, target: Target): boolean {
    if (target.kind === 'item') return true;
    const px = this.player.tileX;
    const py = this.player.tileY;
    if (def.corner && target.kind === 'tile') return px >= target.cx - 1 && px <= target.cx && py >= target.cy - 1 && py <= target.cy;
    return Math.max(Math.abs(px - target.x), Math.abs(py - target.y)) <= 1;
  }

  private walkToward(def: ActionDef, target: Target): boolean {
    if (target.kind === 'item') return true;
    let candidates: Array<{ x: number; y: number }>;
    if (def.corner && target.kind === 'tile') {
      candidates = [
        { x: target.cx - 1, y: target.cy - 1 },
        { x: target.cx, y: target.cy - 1 },
        { x: target.cx - 1, y: target.cy },
        { x: target.cx, y: target.cy },
      ];
    } else {
      candidates = [{ x: target.x, y: target.y }, ...this.neighbours(target.x, target.y)];
    }
    candidates = candidates.filter((c) => this.world.isPassable(c.x, c.y));
    candidates.sort((a, b) => this.distanceToPlayer(a.x, a.y) - this.distanceToPlayer(b.x, b.y));
    for (const c of candidates) {
      if (this.player.walkTo(this.world, c.x, c.y)) return true;
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

  isForaged(x: number, y: number, kind: string): boolean {
    const t = this.foraged.get(`${kind}:${x},${y}`);
    return t !== undefined && this.time - t < FORAGE_COOLDOWN;
  }

  markForaged(x: number, y: number, kind: string): void {
    this.foraged.set(`${kind}:${x},${y}`, this.time);
  }

  private die(): void {
    const p = this.player;
    p.stats = { health: 1, stamina: 0.5, hunger: 0.6, thirst: 0.6 };
    p.stop();
    p.x = this.spawn.x + 0.5;
    p.y = this.spawn.y + 0.5;
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
