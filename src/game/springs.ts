/**
 * The springs people have dug, and the water they keep.
 *
 * What the water does is worked out in `../world/springs`; this is who dug
 * which spring where, the water each one makes laid on the world
 * (`World.water`) for everything that asks about water to find, and the
 * spring settled again whenever the ground it looked at is dug or filled.
 *
 * On an island none of that is decided here. The island settles every spring
 * (`settle_spring`) and says where its water is; this side keeps what it was
 * told and draws it.
 */
import type { ActionDef } from './actions';
import type { World } from '../world/world';
import {
  FILL_RATE, pondFull, POND_MOST, RUN_RATE, settleChain, springCorner, SPRING_DEPTH, SPRINGS_EACH, WaterField,
  type Chain, type Pond, type PondWater, type Shut, type SlabAt, type Stream, type StreamWater,
} from '../world/springs';
import { AQUEDUCT_FLOW, pondRate, settleWater, type Channel } from '../world/aqueducts';

/** One spring, and what its water does. */
export interface Spring {
  id: number;
  /** The tile it was dug in, and the corner its water rises at: the tile's lowest. */
  x: number;
  y: number;
  cx: number;
  cy: number;
  /** Who dug it, by who they are on the island; null for whoever is playing here. */
  by: string | null;
  chain: Chain;
  /** For each pond, the level it rose from and when, in milliseconds of the wall clock: for drawing it rising. */
  fill: Array<{ from: number; since: number }>;
  /** Counted up each time the island settles it, so a browser asks again only for one that has changed. */
  ver: number;
  /** The tile each aqueduct its water goes along draws from, by the aqueduct's id, as it was settled: for saying so. */
  heads?: Record<number, [number, number]>;
}

/** A spring as a save keeps it: where it is and who dug it. Its water is worked out again from the ground. */
export interface SpringSave {
  id: number;
  x: number;
  y: number;
  by: string | null;
}

/** A pond as the island sends it: with the level it rose from and when, as a date. */
export interface IslandPond extends Pond {
  from?: number;
  since?: string;
}

/** A spring as the island sends it: whether it is yours rather than who dug it. */
export interface IslandSpring {
  id: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  mine: boolean;
  ver: number;
  chain: { ponds: IslandPond[]; streams: Stream[]; box: Chain['box'] };
}

/**
 * How each pond of a chain rises, for drawing: a pond that was there before
 * (its lowest corner was under water) goes on from the level it stood at, and
 * a new one rises from its floor once the one above it is full and the water
 * has run down to it -- along an aqueduct's channel first, where it comes by
 * one, and at the channel's flow rather than `FILL_RATE` where an aqueduct
 * fills it (`pondRate`).
 */
export function fillings(chain: Chain, was: WaterField | null, now: number): Array<{ from: number; since: number }> {
  const out: Array<{ from: number; since: number }> = [];
  let ready = now;
  chain.ponds.forEach((p, i) => {
    // A pool dug in foundations is full whether or not a spring rises in it.
    let from: number | null = p.tiles ? p.level : null;
    for (let k = 0; k < p.wet.length && from === null; k += 2) {
      const level = was?.levelAt(p.wet[k], p.wet[k + 1]) ?? null;
      if (level !== null) from = level;
    }
    const since = from !== null ? now : Math.max(now, ready);
    const f = { from: from ?? p.floor, since };
    out.push(f);
    const full = pondFull({ from: f.from, level: p.level, since, rate: pondRate(p) });
    const stream = chain.streams.find((s) => s.from === i);
    ready = full + (stream ? (((stream.along ?? 0) + stream.path.length / 2) / RUN_RATE) * 1000 : 0);
  });
  return out;
}

export class Springs {
  readonly list = new Map<number, Spring>();
  nextId = 1;
  /** Set on an island, where the island settles springs and this side only keeps what it is told. */
  fromIsland = false;
  private dirty = new Set<number>();
  private water: WaterField;
  /** The poured foundations, as the water sees them (\`SlabAt\`); none until the game says. */
  slabs: SlabAt = () => null;
  /** Every foundation with a pool dug in it, which is water whether or not a spring rises in it. */
  pools: () => Iterable<{ x: number; y: number; top: number }> = () => [];
  /** The finished aqueducts, as the water sees them (`Channel`); none until the game says. */
  channels: () => Channel[] = () => [];
  /** The edges every aqueduct's piers stand on, set out or built, which a pool's water does not go over (`aqueductShut`). */
  shut: () => Shut | undefined = () => undefined;
  /**
   * The aqueducts that pour into a fountain with water running along them,
   * and when each channel's water started along it and from water standing
   * at what level, by the aqueduct's id.
   */
  private fed = new Set<number>();
  private flowing = new Map<number, { since: number; level: number }>();

  constructor(private readonly world: World) {
    this.water = new WaterField(world.w, world.h);
    world.onChange((x, y) => this.touched(x, y));
  }

  private height = (x: number, y: number): number | null => (this.world.cornerInBounds(x, y) ? this.world.getHeight(x, y) : null);

  /** The spring dug in a tile, if there is one. */
  at(x: number, y: number): Spring | undefined {
    for (const s of this.list.values()) if (s.x === x && s.y === y) return s;
    return undefined;
  }

  /** How many springs somebody keeps. */
  keptBy(by: string | null): number {
    let n = 0;
    for (const s of this.list.values()) if (s.by === by) n++;
    return n;
  }

  /** What stops a spring being dug in a tile, or null: water already there, a hollow too shallow to hold a pond, or one too wide to fill. */
  refusal(x: number, y: number): string | null {
    const slab = this.slabs(x, y);
    if (slab && !slab.pool) return 'Dig a pool in the foundation first: a spring under a slab has nowhere to rise.';
    if (!slab && this.world.hasWater(x, y)) return 'There is water here already.';
    const [cx, cy] = springCorner((a, b) => this.world.getHeight(a, b), x, y);
    const r = settleChain(this.height, cx, cy, this.slabs, [x, y], { shut: this.shut() });
    if (slab && typeof r !== 'string') {
      // One spring to a pool: a second would only send the same water over the same edge.
      const tiles = r.ponds[0].tiles ?? [];
      for (let k = 0; k < tiles.length; k += 2) if (this.at(tiles[k], tiles[k + 1])) return 'A spring rises in this pool already.';
      return null;
    }
    if (r === 'flat') return `Water here would run straight off downhill. Dig a spring at the bottom of a hollow that holds ${(SPRING_DEPTH / 10).toFixed(1)} m of water or more.`;
    if (r === 'wide') return `This hollow is too wide for a spring ever to fill: a pond spreads over ${POND_MOST} corners at most.`;
    return null;
  }

  /** The tile each aqueduct a chain's water goes along draws from, by the aqueduct's id. */
  private headsOf(chain: Chain, channels: readonly Channel[]): Record<number, [number, number]> | undefined {
    let out: Record<number, [number, number]> | undefined;
    for (const st of chain.streams) {
      const c = st.via === undefined ? undefined : channels.find((ch) => ch.id === st.via);
      if (c) (out ??= {})[c.id] = [c.from[0], c.from[1]];
    }
    return out;
  }

  /** Dig a spring: its water rises now, and runs on down to wherever it goes. */
  dig(x: number, y: number, by: string | null, now: number): Spring | null {
    const [cx, cy] = springCorner((a, b) => this.world.getHeight(a, b), x, y);
    const channels = this.channels();
    const chain = settleWater(this.height, cx, cy, this.slabs, [x, y], channels, this.shut());
    if (typeof chain === 'string') return null;
    const s: Spring = { id: this.nextId++, x, y, cx, cy, by, chain, fill: fillings(chain, null, now), ver: 1, heads: this.headsOf(chain, channels) };
    this.list.set(s.id, s);
    this.lay();
    return s;
  }

  /** Stop a spring up, and all its water with it. */
  stop(id: number): void {
    if (!this.list.delete(id)) return;
    this.dirty.delete(id);
    this.lay();
  }

  /**
   * The ground changed at a tile: every spring that looked at a corner of it
   * is settled again, once, when the turn is over (`update`) -- a flatten
   * moves four corners and should not settle a spring four times.
   */
  touched(x: number, y: number, slab = false): void {
    // A foundation dug into a pool or filled back in changes the water on it with or without a spring.
    if (slab) this.lay();
    if (this.fromIsland || !this.list.size) return;
    for (const s of this.list.values()) {
      const [lx, ly, hx, hy] = s.chain.box;
      if (x + 1 >= lx && x <= hx && y + 1 >= ly && y <= hy) this.dirty.add(s.id);
    }
  }

  /** Settle whatever the ground has changed under since the last turn. */
  update(now: number): void {
    if (!this.dirty.size) return;
    const was = this.water;
    const channels = this.channels();
    for (const id of this.dirty) {
      const s = this.list.get(id);
      if (!s) continue;
      const chain = settleWater(this.height, s.cx, s.cy, this.slabs, [s.x, s.y], channels, this.shut());
      // A spring whose hollow has been filled in or dug out too wide, or whose pool has been filled in, stops: its water goes.
      if (typeof chain === 'string') {
        this.list.delete(id);
        continue;
      }
      s.chain = chain;
      s.fill = fillings(chain, was, now);
      s.heads = this.headsOf(chain, channels);
      s.ver++;
    }
    this.dirty.clear();
    this.lay();
  }

  /** Lay every spring's water, and every pool, on the world, where the rules and the drawing find it. */
  lay(): void {
    const ponds: PondWater[] = [];
    const streams: StreamWater[] = [];
    const cw = this.world.w + 1;
    this.fed.clear();
    // Water already running along a channel from water standing at the same level runs on: settling the ground again does not empty it.
    const ran = new Map(this.flowing);
    this.flowing.clear();
    for (const s of this.list.values()) {
      s.chain.ponds.forEach((p, i) => {
        const wet = new Set<number>();
        for (let k = 0; k < p.wet.length; k += 2) wet.add(p.wet[k + 1] * cw + p.wet[k]);
        const f = s.fill[i] ?? { from: p.level, since: 0 };
        const rate = pondRate(p);
        ponds.push({ spring: s.id, index: i, level: p.level, floor: p.floor, wet, lip: p.lip, over: p.over, from: f.from, since: f.since, ...(rate ? { rate } : {}) });
      });
      for (const st of s.chain.streams) {
        const f = s.fill[st.from];
        const above = s.chain.ponds[st.from];
        const full = f && above ? pondFull({ from: f.from, level: above.level, since: f.since, rate: pondRate(above) }) : 0;
        if (st.via === undefined) {
          streams.push({ spring: s.id, from: st.from, path: st.path, to: st.to, since: full });
          continue;
        }
        // Along the channel first, and on from its foot once the water has run the length of it.
        const before = ran.get(st.via);
        const start = before && above && before.level === above.level ? Math.min(before.since, full) : full;
        const was = this.flowing.get(st.via);
        this.flowing.set(st.via, { since: was === undefined ? start : Math.min(was.since, start), level: above?.level ?? 0 });
        const foot = start + ((st.along ?? 0) / RUN_RATE) * 1000;
        if (st.fountain) this.fed.add(st.via);
        streams.push({ spring: s.id, from: st.from, path: st.path, to: st.to, since: foot, via: st.via, along: st.along, ...(st.fountain ? { fountain: true } : {}) });
      }
    }
    const field = new WaterField(this.world.w, this.world.h);
    field.set(ponds, streams);
    field.setPools(this.pools());
    field.setSpills([...this.list.values()].flatMap((s) => s.chain.ponds));
    this.water = field;
    this.world.water = field.size ? field : null;
  }

  /** What a save keeps. */
  toJSON(): SpringSave[] {
    return [...this.list.values()].map((s) => ({ id: s.id, x: s.x, y: s.y, by: s.by }));
  }

  /** Back out of a save: each spring settled on the ground as it is, standing full, as it was when the game was left. */
  load(saved: SpringSave[] | undefined): void {
    this.list.clear();
    for (const r of saved ?? []) {
      const [cx, cy] = springCorner((a, b) => this.world.getHeight(a, b), r.x, r.y);
      const chain = settleWater(this.height, cx, cy, this.slabs, [r.x, r.y], this.channels(), this.shut());
      if (r.id >= this.nextId) this.nextId = r.id + 1;
      if (typeof chain === 'string') continue;
      this.list.set(r.id, { id: r.id, x: r.x, y: r.y, cx, cy, by: r.by, chain, fill: chain.ponds.map((p) => ({ from: p.level, since: 0 })), ver: 1 });
    }
    this.lay();
  }

  /**
   * What the island says about the springs near here: `near` is every one in
   * range with how many times it has been settled, and `chains` the ones
   * asked for because they are new here or have changed. One no longer in
   * range, or gone, is dropped.
   */
  sawIsland(near: Array<{ id: number; ver: number }>, chains: IslandSpring[]): void {
    const keep = new Set(near.map((n) => n.id));
    let changed = false;
    for (const id of [...this.list.keys()]) {
      if (!keep.has(id)) {
        this.list.delete(id);
        changed = true;
      }
    }
    for (const c of chains) {
      this.list.set(c.id, {
        id: c.id, x: c.x, y: c.y, cx: c.cx, cy: c.cy, by: c.mine ? null : 'somebody else', ver: c.ver,
        // A pool's tiles and the edge it goes over, and the litres a pond an aqueduct fills holds, as well as where it stands.
        chain: {
          ponds: c.chain.ponds.map(({ level, floor, wet, lip, over, tiles, spill, volume }) => ({
            level, floor, wet, lip, over, ...(tiles ? { tiles } : {}), ...(spill ? { spill } : {}), ...(volume ? { volume } : {}),
          })),
          streams: c.chain.streams, box: c.chain.box,
        },
        fill: c.chain.ponds.map((p) => ({ from: p.from ?? p.level, since: p.since ? Date.parse(p.since) : 0 })),
      });
      changed = true;
    }
    if (changed) this.lay();
  }

  /** Which springs this side wants whole: new here, or settled since it last heard. */
  wanted(near: Array<{ id: number; ver: number }>): number[] {
    return near.filter((n) => this.list.get(n.id)?.ver !== n.ver).map((n) => n.id);
  }

  /** Whether an aqueduct keeps a fountain on this tile full: one pouring into it with a spring's water running along it. */
  feeds(x: number, y: number): boolean {
    if (!this.fed.size) return false;
    for (const c of this.channels()) if (this.fed.has(c.id) && c.to[0] === x && c.to[1] === y) return true;
    return false;
  }

  /** When a spring's water starts along an aqueduct's channel, in milliseconds of the wall clock, or null while none reaches its head. */
  flowingSince(id: number): number | null {
    return this.flowing.get(id)?.since ?? null;
  }

  /** How many aqueducts a spring's water runs along now. */
  get running(): number {
    return this.flowing.size;
  }

  /**
   * An aqueduct was finished or taken down, or what stands where one pours
   * changed: every spring whose water reaches either end is settled again at
   * the end of the turn. On an island the island does it.
   */
  channelChanged(c: { from: [number, number]; to: [number, number] }): void {
    this.touched(c.from[0], c.from[1]);
    this.touched(c.to[0], c.to[1]);
  }
}

/** How fast a pond rises, in metres a minute, for anything that says so. */
export const RISE_A_MINUTE = (FILL_RATE / 10) * 60;

/**
 * What is said when a spring is dug whose water an aqueduct takes: how deep
 * its pond will stand, and the aqueduct its water goes along instead of over
 * the lip, by the tile it draws from (`head`). The island's
 * `aqueduct_spring_says`. Null where no aqueduct takes it.
 */
export function aqueductSpringSays(chain: Chain, head: (id: number) => readonly [number, number] | undefined): string | null {
  const along = chain.streams.find((st) => st.via !== undefined);
  const at = along?.via !== undefined ? head(along.via) : undefined;
  if (!along || !at) return null;
  const first = chain.ponds[0];
  const k = along.from;
  const go = `along the aqueduct from ${at[0]}, ${at[1]}, ${AQUEDUCT_FLOW} litres a minute`;
  const more = `${k} more pond${k === 1 ? '' : 's'} below it, and from the last of those`;
  if (first.tiles) {
    return k ? `Water wells up in the pool. It runs down into ${more} ${go}.` : `Water wells up in the pool. It goes ${go}, instead of over its edge.`;
  }
  const stand = `Water wells up at the bottom of the hollow. It will stand ${((first.level - first.floor) / 10).toFixed(1)} m deep over ${first.wet.length / 2} corners`;
  return k ? `${stand}, then spill over the lowest point of its rim and run down into ${more} ${go}.` : `${stand}, then go ${go}, instead of over its rim.`;
}

/** What is said when a spring is dug: how deep its pond will stand, and where its water goes after that. */
export function springSays(s: Spring, head: (id: number) => readonly [number, number] | undefined = (id) => s.heads?.[id]): string {
  const along = aqueductSpringSays(s.chain, head);
  if (along) return along;
  const [first, ...rest] = s.chain.ponds;
  const last = s.chain.streams[s.chain.streams.length - 1];
  const deep = ((first.level - first.floor) / 10).toFixed(1);
  const on = rest.length ? `down into ${rest.length} more pond${rest.length === 1 ? '' : 's'} below it, and from the last of those ` : '';
  const end = last?.to === 'sea' ? 'on into the sea' : last?.to === 'lost' ? 'away into the ground' : 'back into a pond of its own';
  if (first.tiles) {
    if (!first.spill) return 'Water wells up in the pool. Nothing beside it is lower than its water, so it stays full and goes nowhere.';
    const fall = ((first.level - first.spill.to) / 10).toFixed(1);
    const onto = rest[0]?.tiles && first.spill.to === rest[0].level ? 'into the pool below' : 'to the ground';
    // The last of them a pool with nothing lower beside it: the water stops there.
    const bottom = s.chain.ponds[s.chain.ponds.length - 1];
    if (bottom.tiles && !bottom.spill) {
      return `Water wells up in the pool and spills over its lowest edge, falling ${fall} m ${onto}, and runs down into ${rest.length} more pond${rest.length === 1 ? '' : 's'} below it, where it stays.`;
    }
    return `Water wells up in the pool and spills over its lowest edge, falling ${fall} m ${onto}, and runs ${on}${end}.`;
  }
  return `Water wells up at the bottom of the hollow. It will stand ${deep} m deep over ${first.wet.length / 2} corners, then spill over the lowest point of its rim and run ${on}${end}.`;
}

export const SPRING_ACTIONS: ActionDef[] = [
  {
    id: 'dig_spring',
    label: 'Dig a spring',
    verb: 'digging for a spring',
    skill: 'digging',
    tool: 'shovel',
    stamina: 0.12,
    baseTime: 30,
    difficulty: 12,
    applies: (t, g) => t.kind === 'tile' && (!g.world.hasWater(t.x, t.y) || !!g.slabAt(t.x, t.y)?.pool) && !g.springs.at(t.x, t.y),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('shovel')) return 'You need a shovel to dig for a spring.';
      if (g.buildings.buildingAt(t.x, t.y)) return 'You cannot do that inside a building.';
      // On an island the island counts whose springs are whose; here every one is yours.
      if (!g.springs.fromIsland && g.springs.keptBy(null) >= SPRINGS_EACH) return `You keep ${SPRINGS_EACH} springs already. Stop one up before you dig another.`;
      return g.springs.refusal(t.x, t.y);
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const s = g.springs.dig(t.x, t.y, null, Date.now());
      if (!s) return;
      g.gainSkill('digging');
      g.logMsg(springSays(s), 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'stop_spring',
    label: 'Stop up the spring',
    verb: 'stopping up the spring',
    skill: 'digging',
    tool: 'shovel',
    stamina: 0.06,
    baseTime: 10,
    applies: (t, g) => t.kind === 'tile' && !!g.springs.at(t.x, t.y),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('shovel')) return 'You need a shovel to stop up a spring.';
      return g.springs.at(t.x, t.y) ? null : 'There is no spring here.';
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const s = g.springs.at(t.x, t.y);
      if (!s) return;
      g.springs.stop(s.id);
      g.logMsg('You pack the spring shut. Its water sinks away, and the ponds it kept go dry.', 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
];
