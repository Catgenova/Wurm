import type { Game } from '../game/game';
import { TileType } from '../world/tiles';
import { MATERIAL_BY_ID } from '../game/building';
import { blow, chime, footfall, stroke, type Footing, type Stroke } from './kit';

/**
 * What the game sounds like from where the camera is standing.
 *
 * Two jobs, and they are separate on purpose. The kit says what a thing
 * sounds like; this says how loud it is and which ear it is in, which is a
 * question about the view rather than about the thing.
 *
 * The rule is the one the picture already uses. The camera is the ear: it
 * detaches from the player when you drag it, and when it does, what you hear
 * goes with it rather than staying behind with your body. So a smelter you
 * have walked away from goes quiet, and a smelter you have merely *looked*
 * away from goes quiet too, which is right — you have taken the view
 * somewhere else and the view is where you are attending.
 *
 * Both numbers come off the screen rather than out of the world, which also
 * gets the zoom for free: pull the camera back and the whole island gets
 * further away and quieter together, instead of the ground shrinking while a
 * hammer two hundred tiles off stays at full volume.
 */

/** Enough of a camera to place a sound: everything here is read, nothing set. */
export interface Ear {
  width: number;
  height: number;
  worldToScreenX(wx: number, wy: number): number;
  worldToScreenY(wx: number, wy: number, h: number): number;
}

/**
 * How far off the middle of the screen a sound can be before it is not worth
 * starting, measured in half-screens. Past two the gain is under a fortieth
 * and the voice is a node allocated to play silence.
 */
const EARSHOT = 2.4;

/** Voices allowed to start in one window, so a herd cannot deafen anybody. */
const VOICE_CAP = 10;
const VOICE_WINDOW = 0.12;

/** Tiles between one footfall and the next. The dust uses the same stride. */
const STRIDE = 0.58;

/** The player's own feet, and where a peer's sit, in the one keyed-by-number table. */
const EARS_PLAYER = -1;
const EARS_PEER = -2;
/** Pairs of feet held before the stale ones are swept, and how stale is stale. */
const FEET_KEEP = 256;
const FEET_STALE = 600;

/** What each kind of ground sounds like underfoot. */
export const FOOTINGS: Partial<Record<number, Footing>> = {
  [TileType.Grass]: 'soft',
  [TileType.Lawn]: 'soft',
  [TileType.Moss]: 'soft',
  [TileType.Steppe]: 'soft',
  [TileType.Tundra]: 'soft',
  [TileType.Field]: 'soft',
  [TileType.Kelp]: 'soft',
  [TileType.Reed]: 'soft',
  [TileType.Bush]: 'soft',
  [TileType.Tree]: 'soft',
  [TileType.Stump]: 'soft',
  [TileType.Sand]: 'grit',
  [TileType.Dirt]: 'grit',
  [TileType.PackedDirt]: 'grit',
  [TileType.Clay]: 'grit',
  [TileType.Peat]: 'grit',
  [TileType.Tar]: 'grit',
  [TileType.Gravel]: 'grit',
  [TileType.Rock]: 'stone',
  [TileType.Cobblestone]: 'stone',
  [TileType.Slabs]: 'stone',
  [TileType.Snow]: 'snow',
  [TileType.Marsh]: 'water',
};

/**
 * What is under this pair of boots.
 *
 * A deck beats the ground under it, because a deck is what the foot is
 * actually on: a plank bridge over a river sounds like planks, and the river
 * is not consulted. Below that, water beats everything, and then it is
 * whatever the tile is made of.
 */
export function footingAt(g: Game, x: number, y: number, level: number): Footing {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const floor = level > 0 || g.buildings.buildingAt(tx, ty) ? g.buildings.floor(level, tx, ty) : null;
  if (floor) return MATERIAL_BY_ID.get(floor.material)?.kind === 'stone' ? 'stone' : 'wood';
  const bridge = g.bridgeAt(tx, ty);
  if (bridge) return bridge.kind === 'stone' ? 'stone' : 'wood';
  if (g.world.heightAt(x, y) < 0) return 'water';
  return FOOTINGS[g.world.viewTile(tx, ty, true)] ?? 'soft';
}

/**
 * What a job sounds like, which is a question about the stuff and not about
 * the person.
 *
 * Four hundred and thirty-five jobs, seven noises. The trade is nearly always
 * enough to say which — a mason is hitting stone whatever he is making out of
 * it, and a smith is hitting metal — so the skill carries most of the table
 * and the list by name is for the jobs the trade gets wrong, or that have no
 * trade at all because anybody can do them.
 *
 * And then a list of silences, which is the part that matters. A job missing
 * from every table would be silent too, and silently: adding a trade and
 * forgetting to say what it sounds like would look exactly like deciding it
 * makes no noise. So the ones that genuinely make none are named, and
 * `heard.ts` holds every job in the game to one list or the other.
 */

/** Jobs that take time and still make no noise of their own. */
export const HUSHED: ReadonlySet<string> = new Set([
  // A blow is already spoken for. Every landed hit raises `hit`, which is
  // where the fighting is heard; a work stroke on top of it would be the same
  // swing twice.
  'attack_creature', 'shoot_creature',
  // Eating, drinking and sleeping. A body doing something to itself.
  'eat', 'drink', 'drink_skin', 'drink_from_vessel', 'sleep', 'study_book',
  // Faith and the paths, which are the two things on this island done by
  // sitting still.
  'pray', 'cast', 'meditate',
  // Getting on and off things, and being pulled along by one.
  'board_vehicle', 'mount_creature', 'dismount_creature', 'pull_cart', 'unhitch_team',
  // Winning an animal over, which is done by standing very quietly.
  'tame', 'take_catch', 'pair_creature',
  // Ceremony. A stake going in has already made the noise of a stake going in.
  'found_settlement', 'upgrade_deed',
]);

export const STROKE_BY_ID: Record<string, Stroke> = {
  // Ground.
  dig: 'earth', dredge: 'earth', flatten: 'earth', pack: 'earth', cultivate: 'earth',
  drop_dirt: 'earth', drop_dirt_here: 'earth', dig_stump: 'earth',
  take_ashes_oven: 'earth', take_ashes_fire: 'earth', take_ashes_smelter: 'earth', take_ashes_kiln: 'earth',
  // Stone, whether it is being cut or merely shifted.
  pave_gravel: 'stone', pave_cobble: 'stone', pave_slabs: 'stone', remove_paving: 'stone',
  raise_rock: 'stone', chip_corner: 'stone', strike_foundation: 'stone',
  place_smelter: 'stone', pick_up_smelter: 'stone', place_kiln: 'stone', pick_up_kiln: 'stone',
  place_anvil: 'stone', pick_up_anvil: 'stone',
  // Timber. Building is a mallet on pegs whatever the walls end up being made
  // of, which is the one place the material of the thing and the noise of
  // making it genuinely part company.
  plan_building: 'wood', add_to_building: 'wood', remove_from_plan: 'wood',
  plan_wall: 'wood', plan_fence: 'wood', build_wall: 'wood', remove_wall: 'wood',
  add_floor: 'wood', plan_floor: 'wood', build_floor: 'wood', remove_floor: 'wood', remove_storey: 'wood',
  plan_bridge: 'wood', build_bridge: 'wood', demolish_bridge: 'wood',
  place_crate: 'wood', pick_up_crate: 'wood', place_post: 'wood', pick_up_post: 'wood',
  place_furniture: 'wood', turn_furniture: 'wood', pick_up_furniture: 'wood',
  take_apart_campfire: 'wood', set_trap: 'wood', pick_up_trap: 'wood',
  // Metal on metal, which is the loudest thing anybody does here.
  smith: 'metal', strike_coins: 'metal', improve_item: 'metal', shoe_creature: 'metal', ring_bell: 'metal',
  fit_lock: 'metal', take_off_lock: 'metal',
  // Water, poured or drawn.
  fish: 'water', fill_bucket: 'water', fill_skin: 'water',
  empty_vessel: 'water', pour_into_barrel: 'water', empty_creel: 'water',
  damp_smelter: 'water', damp_kiln: 'water', put_out_oven: 'water', put_out_campfire: 'water',
  // A fire being got going, or kept going.
  light_oven: 'fire', light_campfire: 'fire', light_smelter: 'fire', light_kiln: 'fire',
  fuel_oven: 'fire', fuel_campfire: 'fire', fuel_smelter: 'fire', fuel_kiln: 'fire',
  // And handling: things going into a pack and straps going onto an animal.
  pick_up: 'cloth', pick_up_all: 'cloth', feed: 'cloth',
  tack_creature: 'cloth', untack_creature: 'cloth', hitch_creature: 'cloth',
  groom: 'cloth', make_brush: 'cloth',
  crate_take_all: 'cloth', smelter_take_all: 'cloth', kiln_take_all: 'cloth', furniture_take_all: 'cloth',
};

const BY_SKILL: Record<string, Stroke> = {
  digging: 'earth', farming: 'earth', archaeology: 'earth',
  paving: 'stone', mining: 'stone', prospecting: 'stone', masonry: 'stone',
  stonecutting: 'stone', pottery: 'stone',
  woodcutting: 'wood', forestry: 'wood', carpentry: 'wood', fine_carpentry: 'wood',
  bowyery: 'wood', fletching: 'wood', papyrusmaking: 'wood',
  blacksmithing: 'metal', weaponsmithing: 'metal', armorsmithing: 'metal',
  chainsmithing: 'metal', platesmithing: 'metal', jewellery: 'metal',
  smelting: 'fire', cooking: 'fire', milling: 'fire', brewing: 'fire', alchemy: 'fire',
  tailoring: 'cloth', leatherworking: 'cloth', ropemaking: 'cloth', repair: 'cloth',
  first_aid: 'cloth', butchering: 'cloth', restoration: 'cloth',
  foraging: 'cloth', botanizing: 'cloth',
  fishing: 'water',
};

/**
 * Whether a go at this job is work at all.
 *
 * The same question the hands are asked — a go that costs no wind and takes
 * no time is a click rather than a stroke — so examining a tile and locking a
 * chest stay silent for the same reason they teach the body nothing.
 */
export const isWork = (def: { baseTime?: number; stamina?: number }): boolean =>
  (def.baseTime ?? 0) > 0 || (def.stamina ?? 0) > 0;

/** The sound of one go at a job, or null for the ones that make none. */
export function strokeOf(def: { id: string; skill?: string; baseTime?: number; stamina?: number }): Stroke | null {
  if (!isWork(def) || HUSHED.has(def.id)) return null;
  return STROKE_BY_ID[def.id] ?? (def.skill ? BY_SKILL[def.skill] ?? null : null);
}

/**
 * Where a point on the island lands in the mix: which ear, and how loud.
 *
 * Both off the screen rather than out of the world, which is what makes the
 * camera the ear. Null when it is too far off the view to be worth a voice —
 * and that is a real saving rather than a tidiness: a herd of forty grazers
 * over the next hill would otherwise be forty nodes a second built to play
 * something nobody can hear.
 */
export function mixAt(ear: Ear, wx: number, wy: number, h: number): { pan: number; gain: number } | null {
  const dx = (ear.worldToScreenX(wx, wy) - ear.width / 2) / (ear.width / 2);
  const dy = (ear.worldToScreenY(wx, wy, h) - ear.height / 2) / (ear.height / 2);
  const d = Math.hypot(dx, dy);
  if (!(d <= EARSHOT)) return null;
  return { pan: Math.max(-1, Math.min(1, dx)), gain: 1 / (1 + d * d * 2.2) };
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /**
   * Where each pair of feet last put one down, for working out when the next
   * step lands. Keyed by a number — the player is -1, a peer is below that,
   * a creature is its own id — because this is asked of everything walking on
   * the island on every frame, and `'c' + id` was a string apiece for all of
   * them. Stamped, so pairs of feet that have walked out of the world can be
   * swept rather than kept for the session.
   */
  private feet = new Map<number, { x: number; y: number; at: number }>();
  /** How many frames since the last sweep of the above. */
  private swept = 0;
  private started: number[] = [];
  private levels = new Map<string, number>();
  private vary = 0;

  constructor(private readonly game: Game, private readonly ear: Ear) {
    this.listen();
  }

  /**
   * Start the audio, which a browser will only do off the back of something
   * the person did. Safe to call on every click for ever: the second call
   * onwards is a comparison and a return.
   */
  arm(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    type WithLegacy = typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (globalThis as WithLegacy).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  get volume(): number {
    return Math.max(0, Math.min(1, this.game.settings.volume));
  }

  set volume(v: number) {
    this.game.settings.volume = Math.max(0, Math.min(1, v));
  }

  /**
   * Where to put a sound that is happening at a point on the island, or null
   * when it is happening too far off the view to be worth a voice.
   *
   * Pan is how far off the middle of the screen it is; gain falls away with
   * the square of the distance, which is what an inverse square law comes to
   * once the screen rather than the world is doing the measuring.
   */
  private place(wx: number, wy: number): { node: AudioNode; at: number } | null {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.volume <= 0) return null;
    // The setting is the one true answer and this follows it, rather than
    // being told when it changes. It costs a comparison per sound and it
    // means the slider — or a console, or anything else — needs no wire back
    // to here at all.
    if (master.gain.value !== this.volume) master.gain.setTargetAtTime(this.volume, ctx.currentTime, 0.02);
    const at = mixAt(this.ear, wx, wy, this.game.world.heightAt(wx, wy));
    if (!at) return null;
    const now = ctx.currentTime;
    // The cap is on voices *started*, not playing, so a long sound never
    // blocks a short one and the count clears itself.
    while (this.started.length && now - this.started[0] > VOICE_WINDOW) this.started.shift();
    if (this.started.length >= VOICE_CAP) return null;
    this.started.push(now);
    const gain = ctx.createGain();
    gain.gain.value = at.gain;
    // A browser without a panner is a browser that gets the sound in both
    // ears, which is worse than stereo and much better than nothing.
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = at.pan;
      gain.connect(pan).connect(master);
    } else {
      gain.connect(master);
    }
    return { node: gain, at: now };
  }

  /** A number that wanders about between 0 and 1, so nothing repeats exactly. */
  private next(): number {
    this.vary = (this.vary * 1103515245 + 12345) % 2147483648;
    return this.vary / 2147483648;
  }

  /**
   * Footfalls, worked out from ground covered rather than from a walk cycle,
   * which is the same rule the dust uses and for the same reason: something
   * that stops walking should stop making the noise, and something being
   * dragged along by a cart should make it.
   */
  step(): void {
    if (!this.ctx || this.volume <= 0) return;
    const g = this.game;
    const ear = this.ear;
    const now = ++this.swept;
    /*
     * Out of earshot before anything else is asked.
     *
     * This runs on every frame for every creature on the island, and on a live
     * one that is every creature the island has told us about — hundreds of
     * them, nearly all of them nowhere near the screen. It was doing a string
     * concat, a map lookup and a square root for each, to reach `place` and be
     * told the sound was inaudible. The same question, asked first, is two
     * multiplications: `mixAt` measures in half-screens from the middle, so
     * anything more than `EARSHOT` of them away can never make a sound.
     */
    const halfW = ear.width / 2;
    const halfH = ear.height / 2;
    const heard = (x: number, y: number): boolean => {
      const dx = (ear.worldToScreenX(x, y) - halfW) / halfW;
      if (dx < -EARSHOT || dx > EARSHOT) return false;
      const dy = (ear.worldToScreenY(x, y, 0) - halfH) / halfH;
      return dy >= -EARSHOT && dy <= EARSHOT;
    };
    const foot = (id: number, x: number, y: number, level: number): void => {
      const last = this.feet.get(id);
      if (!last) {
        this.feet.set(id, { x, y, at: now });
        return;
      }
      last.at = now;
      if (Math.hypot(last.x - x, last.y - y) < STRIDE) return;
      last.x = x;
      last.y = y;
      const put = this.place(x, y);
      if (!put) return;
      footfall(this.ctx!, put.node, put.at, footingAt(g, x, y, level), this.next());
    };
    const p = g.player;
    foot(EARS_PLAYER, p.x, p.y, p.level);
    for (const cr of g.creatures.list.values()) {
      if (heard(cr.x, cr.y)) foot(cr.id, cr.x, cr.y, 0);
    }
    for (const other of g.roster.list()) {
      if (heard(other.x, other.y)) foot(EARS_PEER - other.id, other.x, other.y, other.level);
    }
    // And the pairs of feet nobody has heard in a while, which otherwise pile
    // up for as long as the tab is open.
    if (this.feet.size > FEET_KEEP) {
      for (const [id, was] of this.feet) if (now - was.at > FEET_STALE) this.feet.delete(id);
    }
  }

  private say(wx: number, wy: number, play: (ctx: AudioContext, node: AudioNode, at: number) => void): void {
    const put = this.place(wx, wy);
    if (!put || !this.ctx) return;
    play(this.ctx, put.node, put.at);
  }

  /** The three notes, which come from nowhere in particular and so are not placed. */
  private note(kind: 'skill' | 'goal' | 'no'): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.volume <= 0) return;
    chime(ctx, master, ctx.currentTime, kind);
  }

  private listen(): void {
    const g = this.game;
    g.events.on('work', (x, y, kind) => this.say(x, y, (ctx, node, at) => stroke(ctx, node, at, kind as Stroke, this.next())));
    g.events.on('hit', (x, y, _amount, kind) => this.say(x, y, (ctx, node, at) => blow(ctx, node, at, kind === 'taken', this.next())));
    // A skill speaks when its whole number changes, which is the same rule
    // the log already uses for a characteristic. Anything else would be a
    // note every two seconds for an entire evening.
    g.events.on('skill', (id) => {
      const now = Math.floor(g.skills.get(id));
      const was = this.levels.get(id);
      this.levels.set(id, now);
      if (was !== undefined && now > was) this.note('skill');
    });
    g.events.on('journal', () => this.note('goal'));
    g.events.on('log', (entry) => {
      if (entry.kind === 'error') this.note('no');
    });
    g.events.on('reset', () => {
      this.feet.clear();
      this.levels.clear();
    });
  }
}
