import type { Game } from '../game/game';
import { packLand, packWorld, unpack } from '../game/save';
import { ACTION_BY_ID, type Target } from '../game/actions';
import type { Actor } from '../game/actor';
import type { TileType } from '../world/tiles';
import { cleanName, cleanText, cleanWho, encode, myWho, HOST_ID, MOVE_HZ, PROTOCOL, TIMEOUT, type FromClient, type FromHost, type Message, type PeerId, type PeerState, type Welcome } from './protocol';
import { Links, type Transport } from './transport';

/**
 * Keeping an island, and visiting one.
 *
 * Two classes, and the line between them is the whole design: the **host** has
 * a `Game` that is the island, and the **client** has a `Game` that is a
 * picture of one. Both are real games — the client's is built through the same
 * door a save comes through, so it draws, walks and reads exactly like a
 * single-player world. What the client's game does *not* do is decide
 * anything. Its clock is set by the host, its ground is changed by the host,
 * and when its owner wants to dig a hole they ask.
 *
 * What is here now is the frame: people arrive, people are seen, people talk,
 * and the ground one person changes changes for everybody. What is not here
 * yet is a guest doing anything — an action asked for is refused, out loud,
 * because a half-honoured request is worse than a refusal. That is the next
 * piece of work, and it is the one that needs a body and a pack per person
 * rather than one of each per island.
 */

/** How the world outside hears about a session: a line for the log, mostly. */
export interface SessionHooks {
  say: (text: string, kind?: string) => void;
  /** Somebody joined or left, so anything showing a list can look again. */
  changed?: () => void;
}

const now = (): number => performance.now() / 1000;

/** The body of whoever is playing on this machine, as everybody else sees it. */
export function bodyOf(game: Game): Omit<PeerState, 'id' | 'name'> {
  const p = game.player;
  return {
    x: p.x,
    y: p.y,
    dirX: p.dirX,
    dirY: p.dirY,
    level: p.level,
    moving: p.moving,
    swimming: p.swimming,
    working: game.action?.state === 'performing',
    act: game.action?.state === 'performing' ? game.action.def.id : undefined,
    look: p.look,
  };
}

interface Guest {
  id: PeerId;
  name: string;
  link: Transport;
  /** Their body and their pack, on the host's machine, where the island is. Null until they say who they are. */
  actor: Actor | null;
  /** Their body as they last reported it. */
  body: Omit<PeerState, 'id' | 'name'>;
  /** When we last heard anything at all from them. */
  heard: number;
  /** Whether they have said hello and been let in. */
  in: boolean;
  /** Whether the island had met them before, for the sake of what is said out loud. */
  known: boolean;
}

export class HostSession {
  readonly links = new Links();
  private readonly guests = new Map<PeerId, Guest>();
  private nextId: PeerId = HOST_ID + 1;
  private lastMoved = 0;
  private lastClock = 0;
  private offWorld: (() => void) | null = null;

  constructor(
    readonly game: Game,
    readonly island: string,
    private readonly hooks: SessionHooks,
  ) {
    game.roster.self = HOST_ID;
    // The world already shouts whenever a tile changes, for the renderer's
    // sake. That shout is the delta stream; nothing new has to be invented.
    this.offWorld = game.events.on('world', (x, y) => this.tileChanged(x, y));
  }

  /** Everyone on the island, the host included, as everyone should see them. */
  everyone(): PeerState[] {
    const out: PeerState[] = [{ id: HOST_ID, name: this.game.player.name, ...bodyOf(this.game) }];
    for (const g of this.guests.values()) if (g.in) out.push({ id: g.id, name: g.name, ...g.body });
    return out;
  }

  /** Somebody has got as far as being connected. They are not in yet. */
  accept(link: Transport): PeerId {
    const id = this.nextId++;
    // No body yet: which body they get depends on who they turn out to be,
    // and they have not said yet.
    const guest: Guest = { id, name: `Guest ${id}`, link, actor: null, body: { ...bodyOf(this.game) }, heard: now(), in: false, known: false };
    this.guests.set(id, guest);
    this.links.add(id, link);
    link.onMessage((m) => this.heard(guest, m));
    link.onClose(() => this.dropped(id, 'the link went down'));
    return id;
  }

  private heard(guest: Guest, m: Message): void {
    guest.heard = now();
    const msg = m as FromClient;
    switch (msg.t) {
      case 'hello': {
        if (msg.protocol !== PROTOCOL) {
          guest.link.send({ t: 'refused', why: `This island is speaking version ${PROTOCOL} and you are speaking ${msg.protocol}.`, protocol: PROTOCOL });
          this.links.drop(guest.id, 'wrong version');
          this.guests.delete(guest.id);
          return;
        }
        guest.name = cleanName(msg.name);
        const who = cleanWho(msg.who ?? '');
        if (!who) {
          guest.link.send({ t: 'refused', why: 'Your build did not say who it is. It is too old for this island.', protocol: PROTOCOL });
          this.links.drop(guest.id, 'no name of its own');
          this.guests.delete(guest.id);
          return;
        }
        guest.known = !!this.game.remembers(who);
        guest.actor = this.game.welcome(guest.id, who, guest.name, (text, kind) => guest.link.send({ t: 'said', from: HOST_ID, name: this.island, text, kind }));
        // Whatever the island puts in their hands, they are told about.
        guest.actor.packed = () => this.sendPack(guest.id);
        // Somebody the island knows starts where they left off; a stranger
        // starts on the shore.
        const p = guest.actor.player;
        guest.body = { ...bodyOf(this.game), x: p.x, y: p.y, level: p.level };
        void this.welcome(guest);
        return;
      }
      case 'at': {
        if (!guest.in || !guest.actor || !sane(msg.body)) return;
        guest.body = msg.body;
        // Onto their real body, so that when the island reaches for them —
        // to see whether they are near enough to a tile to work it — it finds
        // them where they say they are.
        const p = guest.actor.player;
        p.x = msg.body.x;
        p.y = msg.body.y;
        p.dirX = msg.body.dirX;
        p.dirY = msg.body.dirY;
        p.level = msg.body.level;
        p.moving = msg.body.moving;
        p.swimming = msg.body.swimming;
        this.game.roster.saw({ id: guest.id, name: guest.name, ...guest.body });
        return;
      }
      case 'say': {
        if (!guest.in) return;
        const text = cleanText(msg.text);
        if (!text) return;
        const said: FromHost = { t: 'said', from: guest.id, name: guest.name, text, kind: 'chat' };
        this.links.all(said);
        this.hooks.say(`${guest.name}: ${text}`, 'chat');
        return;
      }
      case 'do': {
        if (!guest.in || !guest.actor) return;
        const actor = guest.actor;
        const def = ACTION_BY_ID.get(msg.action);
        if (!def) {
          actor.hear(`There is no such thing as ${msg.action}.`, 'error');
          return;
        }
        // Their work, with their arms. The very same `perform` the host's own
        // dig goes through — the only difference is who `g.player` is for the
        // length of it, which is the whole of what an actor is for.
        this.game.as(actor, () => {
          if (!def.applies(msg.target, this.game)) {
            actor.hear(`You cannot ${def.label.toLowerCase()} that.`, 'error');
            return;
          }
          this.game.requestAction(def, msg.target, msg.times);
        });
        return;
      }
      case 'ping':
        guest.link.send({ t: 'pong', at: msg.at });
        return;
      default:
        return;
    }
  }

  /**
   * Pack the island and hand it over. Squeezing six megabytes takes a moment,
   * so a guest is only counted as ashore once it has actually gone out — a
   * peer list that mentions somebody who has not been sent the world yet is a
   * peer everybody else can see and who can see nothing.
   */
  private async welcome(guest: Guest): Promise<void> {
    const land = await packLand(this.game);
    if (!this.guests.has(guest.id) || guest.link.state !== 'open') return;
    guest.link.send({
      t: 'welcome',
      protocol: PROTOCOL,
      you: guest.id,
      island: this.island,
      host: this.game.player.name,
      land,
      world: packWorld(this.game),
      spawn: this.game.spawn,
      peers: this.everyone(),
    });
    guest.in = true;
    this.sendPack(guest.id);
    this.game.roster.saw({ id: guest.id, name: guest.name, ...guest.body });
    this.announce(guest.known ? `${guest.name} is back.` : `${guest.name} comes ashore.`);
    this.links.all({ t: 'peers', peers: this.everyone() });
    this.hooks.changed?.();
  }

  /** Somebody's own pack, back to them. Their hands are here; their eyes are not. */
  private sendPack(id: PeerId): void {
    const guest = this.guests.get(id);
    if (!guest || guest.link.state !== 'open') return;
    const a = guest.actor;
    if (!a) return;
    guest.link.send({
      t: 'pack',
      items: a.inventory.items,
      skills: Object.fromEntries(a.skills.values),
      stats: a.player.stats,
      nextUid: a.inventory.nextUid,
    });
  }

  private tileChanged(x: number, y: number): void {
    if (!this.links.size) return;
    const w = this.game.world;
    if (!w.inBounds(x, y)) return;
    this.links.all({
      t: 'tile',
      x,
      y,
      tile: w.getTile(x, y),
      data: w.getData(x, y),
      // The four corners with it: ground that changes shape as well as kind is
      // the common case here, since digging does both.
      corners: [w.getHeight(x, y), w.getHeight(x + 1, y), w.getHeight(x + 1, y + 1), w.getHeight(x, y + 1)],
    });
  }

  private announce(text: string): void {
    this.hooks.say(text, 'system');
    this.links.all({ t: 'said', from: HOST_ID, name: this.island, text, kind: 'system' });
  }

  private dropped(id: PeerId, why: string): void {
    const guest = this.guests.get(id);
    if (!guest) return;
    this.guests.delete(id);
    this.links.drop(id, why);
    this.game.roster.gone(id);
    // Their body and their pack go into the island's guest book, to be handed
    // back the next time they knock.
    const kept = this.game.farewell(id);
    if (guest.in) {
      const things = kept ? kept.items.reduce((n, it) => n + (it.count ?? 1), 0) : 0;
      if (things) this.hooks.say(`${guest.name} takes ${things} thing${things === 1 ? '' : 's'} with them; the island keeps it for their return.`, 'system');
      this.announce(`${guest.name} has gone (${why}).`);
      this.links.all({ t: 'peers', peers: this.everyone() });
      this.hooks.changed?.();
    }
  }

  /** Called every frame. Cheap on the frames it does nothing, which is most of them. */
  update(): void {
    if (!this.links.size) return;
    const t = now();
    for (const g of [...this.guests.values()]) {
      if (t - g.heard > TIMEOUT) this.dropped(g.id, 'they went quiet');
    }
    if (t - this.lastMoved >= 1 / MOVE_HZ) {
      this.lastMoved = t;
      this.links.all({ t: 'moved', at: t, peers: this.everyone() });
    }
    // The day is the host's day, said rarely: it only has to stop the two
    // clocks drifting, not carry the time.
    if (t - this.lastClock >= 2) {
      this.lastClock = t;
      this.links.all({ t: 'clock', time: this.game.time });
      // Skill climbs a hair at a time and stamina drains without anything
      // being picked up, so a pack goes out on the slow beat as well.
      for (const id of this.guests.keys()) this.sendPack(id);
    }
  }

  /** Anything the host says out loud goes to everyone. */
  say(text: string): void {
    const clean = cleanText(text);
    if (!clean) return;
    this.links.all({ t: 'said', from: HOST_ID, name: this.game.player.name, text: clean, kind: 'chat' });
    this.hooks.say(`${this.game.player.name}: ${clean}`, 'chat');
  }

  close(why = 'the island is closing'): void {
    this.announce(why);
    this.links.closeAll(why);
    this.guests.clear();
    this.game.roster.clear();
    this.offWorld?.();
    this.offWorld = null;
  }
}

/** What a client turns into once it has been let in. */
export interface Visit {
  game: Game;
  you: PeerId;
  island: string;
  host: string;
}

export class ClientSession {
  private me: PeerId = -1;
  /** The world as it arrived. Null until the welcome lands. */
  private visiting: Visit | null = null;
  private lastAt = 0;
  private lastBody = '';

  constructor(
    private readonly link: Transport,
    private readonly name: string,
    private readonly hooks: SessionHooks,
    /** Called once, with the island, when the door opens — or with null when it does not. */
    private readonly arrived: (visit: Visit | null, why?: string) => void,
    /**
     * Who to knock as. Normally the one durable name this machine keeps, which
     * is what makes an island recognise you tomorrow; given explicitly when
     * one machine wants to be more than one person, which is how two visitors
     * are stood up in a single tab and run against each other.
     */
    private readonly who: string = myWho(),
  ) {
    link.onMessage((m) => this.heard(m));
    link.onClose((why) => {
      this.hooks.say(`The link to the island is gone (${why}).`, 'error');
      this.visiting?.game.roster.clear();
    });
    link.send({ t: 'hello', protocol: PROTOCOL, name: cleanName(name), who: this.who });
  }

  get game(): Game | null {
    return this.visiting?.game ?? null;
  }

  private heard(m: Message): void {
    const msg = m as FromHost;
    switch (msg.t) {
      case 'welcome':
        void this.comeAshore(msg);
        return;
      case 'refused':
        this.arrived(null, msg.why);
        return;
      case 'peers':
        this.visiting?.game.roster.sawAll(msg.peers);
        this.hooks.changed?.();
        return;
      case 'moved':
        this.visiting?.game.roster.sawAll(msg.peers);
        return;
      case 'tile': {
        const w = this.visiting?.game.world;
        if (!w || !w.inBounds(msg.x, msg.y)) return;
        const c = msg.corners;
        if (Array.isArray(c) && c.length === 4) {
          w.setHeight(msg.x, msg.y, c[0]);
          w.setHeight(msg.x + 1, msg.y, c[1]);
          w.setHeight(msg.x + 1, msg.y + 1, c[2]);
          w.setHeight(msg.x, msg.y + 1, c[3]);
        }
        w.setTile(msg.x, msg.y, msg.tile as TileType, msg.data);
        return;
      }
      case 'said':
        this.hooks.say(msg.from === this.me ? `${msg.name}: ${msg.text}` : msg.kind === 'chat' ? `${msg.name}: ${msg.text}` : msg.text, msg.kind);
        return;
      case 'pack': {
        const game = this.visiting?.game;
        if (!game || !Array.isArray(msg.items)) return;
        // Wholesale rather than a diff: a pack is a dozen things, and a client
        // that tried to keep its own tally would be a second truth about it.
        game.inventory.items = msg.items as typeof game.inventory.items;
        game.inventory.nextUid = Math.max(game.inventory.nextUid, msg.nextUid ?? 1);
        for (const [id, v] of Object.entries(msg.skills ?? {})) if (typeof v === 'number') game.skills.values.set(id, v);
        const stats = msg.stats as typeof game.player.stats | undefined;
        if (stats && typeof stats.health === 'number') game.player.stats = { ...stats };
        game.events.emit('inventory');
        game.events.emit('skill', '', 0);
        game.events.emit('stats');
        return;
      }
      case 'clock': {
        const game = this.visiting?.game;
        // Nudged rather than set: a clock that jumps backwards would take the
        // sun with it. A whole day out is a jump worth taking.
        if (game) game.time = Math.abs(game.time - msg.time) > 60 ? msg.time : game.time + (msg.time - game.time) * 0.25;
        return;
      }
      default:
        return;
    }
  }

  /** Build the island that arrived, and stand on it. */
  private async comeAshore(msg: Welcome): Promise<void> {
    const game = msg.land && typeof msg.land === 'object' ? await unpack(msg.land, msg.world) : null;
    if (!game) {
      this.arrived(null, 'The island did not arrive in one piece.');
      this.link.close('bad welcome');
      return;
    }
    this.me = msg.you;
    game.roster.self = msg.you;
    game.player.name = cleanName(this.name);
    game.player.x = msg.spawn.x + 0.5;
    game.player.y = msg.spawn.y + 0.5;
    game.roster.sawAll(msg.peers);
    this.visiting = { game, you: msg.you, island: msg.island, host: msg.host };
    this.arrived(this.visiting);
    this.hooks.say(`You come ashore on ${msg.island}, kept by ${msg.host}.`, 'system');
    this.hooks.changed?.();
  }

  /** Called every frame. Tells the island where we are, when that has changed. */
  update(): void {
    const game = this.visiting?.game;
    if (!game || this.link.state !== 'open') return;
    const t = now();
    if (t - this.lastAt < 1 / MOVE_HZ) return;
    this.lastAt = t;
    const body = bodyOf(game);
    // Standing still is worth saying once and then not saying again.
    const sig = encode({ t: 'at', body });
    if (sig === this.lastBody) return;
    this.lastBody = sig;
    this.link.send({ t: 'at', body });
  }

  say(text: string): void {
    const clean = cleanText(text);
    if (clean) this.link.send({ t: 'say', text: clean });
  }

  /** Ask to do something. Answered by the host, in its own time. */
  request(action: string, target: Target, times?: number): void {
    this.link.send({ t: 'do', action, target, times });
  }

  close(): void {
    this.link.close('you left');
    this.visiting?.game.roster.clear();
    this.visiting = null;
  }
}

/** A body that arrived off somebody else's machine, checked before it is believed. */
function sane(body: unknown): body is Omit<PeerState, 'id' | 'name'> {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
  return num(b.x) && num(b.y) && num(b.dirX) && num(b.dirY) && num(b.level) && typeof b.moving === 'boolean' && typeof b.swimming === 'boolean' && typeof b.working === 'boolean';
}
