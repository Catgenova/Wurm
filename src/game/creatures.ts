import { TILE_DEFS } from '../world/tiles';
import { FORAGE_TABLE, rollTable } from './forage';
import type { Game } from './game';
import { itemDef, type Item } from './items';
import { groundStep } from './player';

/**
 * Wildermon: creatures that roam the wild, can be tamed with the taming
 * skill, and then either travel with the player or work on the deed.
 */

export type CreatureMode = 'wild' | 'active' | 'deed' | 'stored';
export type Stance = 'passive' | 'defensive' | 'aggressive';
export const STANCES: Stance[] = ['passive', 'defensive', 'aggressive'];
export const STANCE_NAMES: Record<Stance, string> = { passive: 'Passive', defensive: 'Defensive', aggressive: 'Aggressive' };
export const STANCE_HINTS: Record<Stance, string> = {
  passive: 'Never attacks.',
  defensive: 'Fights back when it or you are attacked.',
  aggressive: 'Hunts other wildermon within 5 tiles of you.',
};

export interface SpeciesDef {
  id: string;
  name: string;
  description: string;
  health: number;
  attack: number;
  /** Tiles per second. */
  speed: number;
  /** Taming skill needed to try. */
  tameLevel: number;
  /** Base chance per attempt at the minimum skill. */
  tameChance: number;
  /** Items it eats and that work as taming bait. */
  diet: string[];
  /** Runs rather than fights when hurt. */
  timid: boolean;
  /** Forages for food, and does so as a job on the deed. */
  forages: boolean;
  /** How far from the token a deed worker will roam. */
  workRange: number;
  /** Body and belly colours per variant. */
  variants: Array<[string, string]>;
}

export const SPECIES: Record<string, SpeciesDef> = {
  rabba: {
    id: 'rabba',
    name: 'Rabba',
    description: 'A plump, long-eared grazer with a twitching nose. Skittish, but it cannot resist a berry.',
    health: 20,
    attack: 3,
    speed: 2.2,
    tameLevel: 1,
    tameChance: 0.12,
    diet: ['blueberry', 'raspberry', 'strawberry', 'lingonberry', 'potato', 'onion'],
    timid: true,
    forages: true,
    workRange: 8,
    variants: [
      ['#9a7048', '#d2b08a'],
      ['#8c8a86', '#c8c5bf'],
      ['#c9b58a', '#ede2c8'],
      ['#eae6de', '#ffffff'],
    ],
  },
};

export const isBaitFor = (species: SpeciesDef, itemId: string): boolean => species.diet.includes(itemId);

export interface Creature {
  id: number;
  species: string;
  name: string;
  variant: number;
  x: number;
  y: number;
  mode: CreatureMode;
  stance: Stance;
  health: number;
  hunger: number;
  carrying: Item | null;
  /** Total experience earned from work. */
  xp: number;
  /** Task skills, on the same 1..100 scale as the player's. */
  skills: Record<string, number>;
  // Runtime state below; not saved.
  state: string;
  until: number;
  tx: number;
  ty: number;
  dirX: number;
  dirY: number;
  walkPhase: number;
  moving: boolean;
  enemy: number | null;
  attackedBy: number | null;
  attackedAt: number;
  cooldown: number;
  busyUntil: number;
  searchAt: number;
}

export interface CreatureJSON {
  id: number;
  species: string;
  name: string;
  variant: number;
  x: number;
  y: number;
  mode: CreatureMode;
  stance: Stance;
  health: number;
  hunger: number;
  carrying: Item | null;
  xp?: number;
  skills?: Record<string, number>;
}

export interface Crate {
  x: number;
  y: number;
  items: Item[];
}

export const WILD_TARGET = 32;
const RESPAWN_EVERY = 45;
/** Seconds a wild creature spends grazing. */
const FORAGE_TIME = 2.5;

/** A creature's level, read off its best task skill. */
export const creatureLevel = (c: Creature): number => 1 + Math.floor(Math.max(0, ...Object.values(c.skills), 0) / 5);

/** How long a deed worker takes over a task: twice what a player of the same skill would. */
export function workDuration(skill: number): number {
  return 2 * Math.max(1.2, 5 * (1 - skill / 140));
}

type MoveResult = 'arrived' | 'moving' | 'blocked';

export class Creatures {
  readonly list = new Map<number, Creature>();
  nextId = 1;
  private byTile = new Map<string, Creature[]>();
  private respawnClock = 0;

  get(id: number): Creature | undefined {
    return this.list.get(id);
  }

  species(c: Creature): SpeciesDef {
    return SPECIES[c.species] ?? SPECIES.rabba;
  }

  spawn(species: string, x: number, y: number, mode: CreatureMode = 'wild', rand: () => number = Math.random): Creature {
    const c = Creatures.make(this.nextId++, species, x, y, mode, rand);
    this.list.set(c.id, c);
    return c;
  }

  private static make(id: number, species: string, x: number, y: number, mode: CreatureMode, rand: () => number): Creature {
    const def = SPECIES[species] ?? SPECIES.rabba;
    return {
      id,
      species: def.id,
      name: def.name,
      variant: Math.floor(rand() * def.variants.length),
      x,
      y,
      mode,
      stance: 'defensive',
      health: def.health,
      hunger: 0.6 + rand() * 0.4,
      carrying: null,
      xp: 0,
      skills: { foraging: 1 },
      state: 'idle',
      until: 0,
      tx: x,
      ty: y,
      dirX: 1,
      dirY: 0,
      walkPhase: 0,
      moving: false,
      enemy: null,
      attackedBy: null,
      attackedAt: -1e9,
      cooldown: 0,
      busyUntil: 0,
      searchAt: 0,
    };
  }

  remove(id: number): void {
    this.list.delete(id);
  }

  /** Creatures standing on a tile, from the index rebuilt each update. */
  atTile(x: number, y: number): Creature[] {
    return this.byTile.get(`${x},${y}`) ?? [];
  }

  /** The player's companion. */
  active(): Creature | undefined {
    for (const c of this.list.values()) if (c.mode === 'active') return c;
    return undefined;
  }

  stored(): Creature[] {
    return [...this.list.values()].filter((c) => c.mode === 'stored');
  }

  workers(): Creature[] {
    return [...this.list.values()].filter((c) => c.mode === 'deed');
  }

  wildCount(): number {
    let n = 0;
    for (const c of this.list.values()) if (c.mode === 'wild') n++;
    return n;
  }

  /** Whether a tile is somewhere a creature can walk: passable, dry, in bounds. */
  tileOk(game: Game, x: number, y: number): boolean {
    const w = game.world;
    return w.inBounds(x, y) && w.isPassable(x, y) && w.centerHeight(x, y) >= -1;
  }

  /** Drop wild creatures on grazing land away from the player and the deed. */
  spawnWild(game: Game, count: number, minDistance = 12): number {
    const w = game.world;
    let placed = 0;
    for (let tries = 0; tries < count * 40 && placed < count; tries++) {
      const x = Math.floor(game.rand() * w.w);
      const y = Math.floor(game.rand() * w.h);
      if (!this.tileOk(game, x, y) || !TILE_DEFS[w.getTile(x, y)].forage) continue;
      if (w.centerHeight(x, y) < 2 || game.onDeed(x, y)) continue;
      if (Math.hypot(x + 0.5 - game.player.x, y + 0.5 - game.player.y) < minDistance) continue;
      this.spawn('rabba', x + 0.5, y + 0.5, 'wild', game.rand);
      placed++;
    }
    return placed;
  }

  update(dt: number, game: Game): void {
    this.byTile.clear();
    this.respawnClock += dt;
    if (this.respawnClock >= RESPAWN_EVERY) {
      this.respawnClock = 0;
      if (this.wildCount() < WILD_TARGET) this.spawnWild(game, 1, 25);
    }
    for (const c of this.list.values()) {
      if (c.mode === 'stored') continue;
      c.cooldown = Math.max(0, c.cooldown - dt);
      c.moving = false;
      const def = this.species(c);
      if (c.health < def.health && game.time - c.attackedAt > 6) c.health = Math.min(def.health, c.health + dt * (c.mode === 'wild' ? 0.25 : 0.6));
      if (game.time >= c.busyUntil) {
        switch (c.mode) {
          case 'wild':
            this.updateWild(c, dt, game);
            break;
          case 'active':
            this.updateActive(c, dt, game);
            break;
          case 'deed':
            this.updateWorker(c, dt, game);
            break;
        }
      }
      if (c.moving) c.walkPhase += dt * 12;
      const key = `${Math.floor(c.x)},${Math.floor(c.y)}`;
      const arr = this.byTile.get(key);
      if (arr) arr.push(c);
      else this.byTile.set(key, [c]);
    }
  }

  private stepToward(game: Game, c: Creature, tx: number, ty: number, dt: number, speedMul = 1): MoveResult {
    const dx = tx - c.x;
    const dy = ty - c.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.12) return 'arrived';
    const pace = c.mode === 'deed' ? 1 + (c.skills.foraging ?? 1) / 500 : 1;
    const step = Math.min(this.species(c).speed * speedMul * pace * dt, dist);
    const vx = dx / dist;
    const vy = dy / dist;
    const nx = c.x + vx * step;
    const ny = c.y + vy * step;
    let moved = false;
    if (this.canMove(game, c.x, c.y, nx, ny)) {
      c.x = nx;
      c.y = ny;
      moved = true;
    } else if (this.canMove(game, c.x, c.y, nx, c.y)) {
      c.x = nx;
      moved = true;
    } else if (this.canMove(game, c.x, c.y, c.x, ny)) {
      c.y = ny;
      moved = true;
    }
    if (!moved) return 'blocked';
    c.dirX = vx;
    c.dirY = vy;
    c.moving = true;
    return 'moving';
  }

  private canMove(game: Game, fx: number, fy: number, tx: number, ty: number): boolean {
    const tX = Math.floor(tx);
    const tY = Math.floor(ty);
    if (!this.tileOk(game, tX, tY)) return false;
    const fX = Math.floor(fx);
    const fY = Math.floor(fy);
    if (fX !== tX || fY !== tY) {
      if (!groundStep(game.world, fX, fY, tX, tY)) return false;
      if (game.buildings.blocksAt(0, fX, fY, tX, tY)) return false;
    }
    return true;
  }

  private wanderTarget(game: Game, c: Creature, radius: number, aroundX = c.x, aroundY = c.y): void {
    for (let i = 0; i < 8; i++) {
      const x = aroundX + (game.rand() * 2 - 1) * radius;
      const y = aroundY + (game.rand() * 2 - 1) * radius;
      if (this.tileOk(game, Math.floor(x), Math.floor(y))) {
        c.tx = x;
        c.ty = y;
        c.state = 'wander';
        return;
      }
    }
    c.state = 'idle';
    c.until = game.time + 2;
  }

  /** Nearest tile within `range` of a point that can be foraged right now. */
  private findForageTile(game: Game, cx: number, cy: number, range: number): { x: number; y: number } | null {
    const w = game.world;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    for (let y = y0 - range; y <= y0 + range; y++) {
      for (let x = x0 - range; x <= x0 + range; x++) {
        if (!this.tileOk(game, x, y) || !TILE_DEFS[w.getTile(x, y)].forage || game.isForaged(x, y, 'forage')) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + game.rand() * 1.5;
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    return best;
  }

  private beginForage(game: Game, c: Creature): void {
    c.state = 'forage';
    c.until = game.time + (c.mode === 'deed' ? workDuration(c.skills.foraging ?? 1) : FORAGE_TIME);
  }

  /**
   * Finish a forage: the tile goes on cooldown as if a player had picked it
   * over. Workers roll like a player of their skill and learn from it at half
   * a player's pace.
   */
  private finishForage(game: Game, c: Creature): Item | null {
    const x = Math.floor(c.x);
    const y = Math.floor(c.y);
    game.markForaged(x, y, 'forage');
    if (c.mode !== 'deed') {
      if (game.rand() < 0.25) return null;
      const id = rollTable(FORAGE_TABLE, game.rand());
      return { uid: game.inventory.nextUid++, id, ql: 5 + game.rand() * 30, dmg: 0, count: 1 };
    }
    const skill = c.skills.foraging ?? 1;
    this.gainSkill(game, c, 'foraging', 0.225);
    const chance = Math.min(0.98, Math.max(0.3, 0.6 + (skill / 100) * 0.38 - 5 / 150));
    if (game.rand() < 0.2 || game.rand() >= chance) return null;
    const id = rollTable(FORAGE_TABLE, game.rand());
    const ql = Math.min(100, Math.max(1, skill * (0.6 + game.rand() * 0.8) + 1));
    return { uid: game.inventory.nextUid++, id, ql, dmg: 0, count: 1 };
  }

  /** Same diminishing curve as the player's skills. */
  gainSkill(game: Game, c: Creature, id: string, base: number): number {
    const v = c.skills[id] ?? 1;
    const room = Math.max(0, 1 - v / 100);
    const gain = base * Math.pow(room, 1.4) * (0.6 + 0.8 * game.rand());
    const before = creatureLevel(c);
    c.skills[id] = Math.min(100, v + gain);
    c.xp += gain;
    if (creatureLevel(c) > before) game.logMsg(`${c.name} reaches level ${creatureLevel(c)}.`, 'skill');
    return gain;
  }

  private updateWild(c: Creature, dt: number, game: Game): void {
    c.hunger = Math.max(0, c.hunger - dt * 0.004);
    if (c.state === 'flee') {
      if (game.time >= c.until) c.state = 'idle';
      else if (this.stepToward(game, c, c.tx, c.ty, dt, 1.6) !== 'moving') c.state = 'idle';
      return;
    }
    if (c.state === 'forage') {
      if (game.time >= c.until) {
        const food = this.finishForage(game, c);
        if (food) c.hunger = Math.min(1, c.hunger + 0.5);
        c.state = 'idle';
        c.until = game.time + 2 + game.rand() * 3;
      }
      return;
    }
    if (c.state === 'toForage') {
      const r = this.stepToward(game, c, c.tx, c.ty, dt);
      if (r === 'arrived') {
        if (!game.isForaged(Math.floor(c.x), Math.floor(c.y), 'forage')) this.beginForage(game, c);
        else c.state = 'idle';
      } else if (r === 'blocked') c.state = 'idle';
      return;
    }
    if (c.hunger < 0.5 && game.time >= c.searchAt) {
      c.searchAt = game.time + 4;
      const t = this.findForageTile(game, c.x, c.y, 3);
      if (t) {
        c.tx = t.x + 0.5;
        c.ty = t.y + 0.5;
        c.state = 'toForage';
        return;
      }
    }
    if (c.state === 'wander') {
      if (this.stepToward(game, c, c.tx, c.ty, dt, 0.7) !== 'moving') {
        c.state = 'idle';
        c.until = game.time + 1 + game.rand() * 5;
      }
      return;
    }
    if (game.time >= c.until) this.wanderTarget(game, c, 4);
  }

  private updateActive(c: Creature, dt: number, game: Game): void {
    c.hunger = Math.max(0, c.hunger - dt * 0.002);
    const p = game.player;
    const distP = Math.hypot(p.x - c.x, p.y - c.y);
    if (distP > 18) {
      // Lost sight of you: catches up.
      c.x = p.x;
      c.y = p.y;
      c.enemy = null;
      return;
    }
    if (c.stance === 'passive') c.enemy = null;
    else if (c.enemy === null) {
      if (c.stance === 'aggressive') {
        let best: Creature | null = null;
        let bestD = Infinity;
        for (const o of this.list.values()) {
          if (o.id === c.id || o.mode !== 'wild') continue;
          const d = Math.hypot(o.x - p.x, o.y - p.y);
          if (d <= 5 && d < bestD) {
            bestD = d;
            best = o;
          }
        }
        if (best) c.enemy = best.id;
      } else {
        const recent = (at: number): boolean => game.time - at < 8;
        const threat = recent(c.attackedAt) ? c.attackedBy : recent(p.attackedAt) ? p.attackedBy : null;
        if (threat !== null && threat !== c.id && this.list.has(threat)) c.enemy = threat;
      }
    }
    if (c.enemy !== null) {
      const e = this.list.get(c.enemy);
      if (!e || e.mode === 'stored' || Math.hypot(e.x - p.x, e.y - p.y) > 9) {
        c.enemy = null;
      } else {
        const d = Math.hypot(e.x - c.x, e.y - c.y);
        if (d <= 0.9) {
          if (c.cooldown <= 0) {
            this.attack(game, c, e);
            c.cooldown = 1.2;
          }
        } else if (this.stepToward(game, c, e.x, e.y, dt, 1.3) === 'blocked') {
          c.enemy = null;
        }
        return;
      }
    }
    if (distP > 2.2) {
      this.stepToward(game, c, p.x, p.y, dt, 1.25);
      return;
    }
    if (c.state === 'wander') {
      if (this.stepToward(game, c, c.tx, c.ty, dt, 0.6) !== 'moving') {
        c.state = 'idle';
        c.until = game.time + 2 + game.rand() * 4;
      }
    } else if (game.time >= c.until) this.wanderTarget(game, c, 1.5, p.x, p.y);
  }

  private updateWorker(c: Creature, dt: number, game: Game): void {
    c.hunger = Math.max(0, c.hunger - dt * 0.003);
    const deed = game.deed;
    if (!deed) {
      c.mode = 'wild';
      return;
    }
    const def = this.species(c);
    const crate = game.crate;
    if (c.state === 'forage') {
      if (game.time >= c.until) {
        c.carrying = this.finishForage(game, c);
        c.state = 'idle';
        c.until = game.time + 0.5;
      }
      return;
    }
    if (c.carrying) {
      if (c.hunger < 0.4 && isBaitFor(def, c.carrying.id)) {
        c.hunger = Math.min(1, c.hunger + 0.5);
        c.carrying = null;
        return;
      }
      if (!crate) {
        game.dropOnGround(deed.x, deed.y, c.carrying);
        c.carrying = null;
        return;
      }
      if (Math.hypot(crate.x + 0.5 - c.x, crate.y + 0.5 - c.y) <= 1.3) {
        game.crateAdd(c.carrying);
        c.carrying = null;
        c.state = 'idle';
        c.until = game.time + 1;
      } else if (this.stepToward(game, c, crate.x + 0.5, crate.y + 0.5, dt) === 'blocked') {
        c.state = 'idle';
        c.until = game.time + 2;
      }
      return;
    }
    if (c.hunger < 0.4 && crate && crate.items.some((it) => isBaitFor(def, it.id))) {
      if (Math.hypot(crate.x + 0.5 - c.x, crate.y + 0.5 - c.y) <= 1.3) {
        const idx = crate.items.findIndex((it) => isBaitFor(def, it.id));
        if (idx >= 0) {
          const it = crate.items[idx];
          it.count -= 1;
          if (it.count <= 0) crate.items.splice(idx, 1);
          game.events.emit('crate');
          c.hunger = Math.min(1, c.hunger + 0.5);
        }
      } else this.stepToward(game, c, crate.x + 0.5, crate.y + 0.5, dt);
      return;
    }
    if (c.state === 'toForage') {
      const r = this.stepToward(game, c, c.tx, c.ty, dt);
      if (r === 'arrived') {
        if (!game.isForaged(Math.floor(c.x), Math.floor(c.y), 'forage')) this.beginForage(game, c);
        else c.state = 'idle';
      } else if (r === 'blocked') {
        c.state = 'idle';
        c.until = game.time + 2;
      }
      return;
    }
    if (c.state === 'wander') {
      if (this.stepToward(game, c, c.tx, c.ty, dt, 0.7) !== 'moving') {
        c.state = 'idle';
        c.until = game.time + 2;
      }
      return;
    }
    if (game.time < c.until) return;
    if (def.forages) {
      const t = this.findForageTile(game, deed.x + 0.5, deed.y + 0.5, def.workRange);
      if (t) {
        c.tx = t.x + 0.5;
        c.ty = t.y + 0.5;
        c.state = 'toForage';
        return;
      }
    }
    // Nothing to do right now: potter about near the token.
    this.wanderTarget(game, c, 3, deed.x + 0.5, deed.y + 0.5);
    c.until = game.time + 4;
  }

  attack(game: Game, a: Creature, t: Creature): void {
    const dmg = this.species(a).attack * (0.7 + game.rand() * 0.6);
    t.health -= dmg;
    t.attackedBy = a.id;
    t.attackedAt = game.time;
    if (t.mode === 'wild' && this.species(t).timid) {
      const dx = t.x - a.x;
      const dy = t.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      t.tx = t.x + (dx / len) * 5;
      t.ty = t.y + (dy / len) * 5;
      t.state = 'flee';
      t.until = game.time + 3;
    }
    if (t.mode === 'active' && game.time - (t.busyUntil ?? 0) > 0) game.logMsg(`${t.name} is hurt by a ${this.species(a).name.toLowerCase()}!`, 'error');
    if (t.health <= 0) this.kill(game, t, a);
  }

  kill(game: Game, t: Creature, killer: Creature | null): void {
    this.list.delete(t.id);
    for (const o of this.list.values()) if (o.enemy === t.id) o.enemy = null;
    const owned = killer && killer.mode !== 'wild';
    if (t.mode === 'active' || t.mode === 'deed') game.logMsg(`${t.name} has died.`, 'error');
    else if (owned && killer) game.logMsg(`${killer.name} killed a wild ${this.species(t).name.toLowerCase()}.`, 'event');
  }

  describe(c: Creature): string {
    switch (c.mode) {
      case 'active':
        return `your companion · ${STANCE_NAMES[c.stance].toLowerCase()}`;
      case 'deed':
        return c.carrying ? `deed worker · carrying ${itemDef(c.carrying.id).name.toLowerCase()}` : c.state === 'forage' ? 'deed worker · foraging' : 'deed worker';
      case 'stored':
        return 'kept at the token';
      default:
        return c.state === 'forage' ? 'wild · foraging' : c.state === 'flee' ? 'wild · fleeing' : 'wild';
    }
  }

  toJSON(): { nextId: number; list: CreatureJSON[] } {
    return {
      nextId: this.nextId,
      list: [...this.list.values()].map((c) => ({
        id: c.id,
        species: c.species,
        name: c.name,
        variant: c.variant,
        x: c.x,
        y: c.y,
        mode: c.mode,
        stance: c.stance,
        health: c.health,
        hunger: c.hunger,
        carrying: c.carrying,
        xp: c.xp,
        skills: c.skills,
      })),
    };
  }

  static fromJSON(data: { nextId: number; list: CreatureJSON[] } | undefined): Creatures {
    const cs = new Creatures();
    if (!data) return cs;
    cs.nextId = data.nextId ?? 1;
    for (const j of data.list ?? []) {
      const c = Creatures.make(j.id, j.species, j.x, j.y, j.mode, Math.random);
      Object.assign(c, { name: j.name, variant: j.variant, stance: j.stance, health: j.health, hunger: j.hunger, carrying: j.carrying ?? null, xp: j.xp ?? 0, skills: { foraging: 1, ...(j.skills ?? {}) } });
      cs.list.set(c.id, c);
      if (c.id >= cs.nextId) cs.nextId = c.id + 1;
    }
    return cs;
  }
}
