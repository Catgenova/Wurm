import { oreKindFor, ORE_DENSITY, stoneKindAt } from '../world/ore';
import { World } from '../world/world';
import type { BuildingsJSON } from './building';
import type { PlacedAnvil } from './anvil';
import type { PlacedCampfire } from './campfire';
import type { PlacedSmelter } from './smelter';
import type { PlacedKiln } from './kiln';
import type { PlacedFurniture } from './furniture';
import type { PlacedPost } from './posts';
import type { Boon } from './boons';
import type { Crop } from './farming';
import type { PlacedCrate } from './crates';
import type { CreatureJSON } from './creatures';
import type { Item } from './items';
import { Game, type Deed } from './game';
import type { Stats } from './player';

const KEY = 'wurm-iso-save';
/**
 * The small half of a save, written the instant the page goes away.
 *
 * A write to IndexedDB is asked for, not done: a page that is closing is torn
 * down long before the browser gets round to it, so shutting the tab would
 * cost whatever had happened since the last autosave. The land is big and
 * changes slowly; everything else — where you stand, what you carry, what you
 * know — is small and changes constantly, and local storage takes it there and
 * then, no waiting. It is laid over the last full save when the world is read
 * back.
 */
const PATCH = 'wurm-iso-latest';
const VERSION = 1;
/**
 * Where a world is kept.
 *
 * The terrain of a 1024 by 1024 island is about ten megabytes of typed array.
 * Turning that into text to put in local storage makes it thirteen, which is
 * more than local storage will hold — the save simply failed, quietly, on
 * every big world. IndexedDB takes the arrays as they are, no text in the
 * middle, and has room for them. Local storage is still read for worlds saved
 * the old way, and is still written to for small ones as a fallback for
 * anywhere IndexedDB is not to be had.
 */
const DB_NAME = 'wurm-iso';
const STORE = 'world';
/**
 * Three records, not one, because they change at three different rates.
 *
 * Handing a typed array to the store copies it, and ten megabytes of island
 * costs about thirty milliseconds of the frame it happens on — a stutter every
 * twenty seconds. So the ground goes in one record and is only rewritten when
 * something has been dug, felled or built; what is known of the island goes in
 * another and is only rewritten when new ground has been walked; and the rest,
 * which is small and always changing, goes in a third that is written every
 * time.
 */
const SLOT = 'current';
const SLOT_GROUND = 'ground';
const SLOT_FOG = 'fog';

/** The shape of the land. */
interface GroundBlob {
  heights: Int16Array;
  tiles: Uint8Array;
  data: Uint8Array;
  dirt: Uint8Array;
  rock: Uint8Array;
}

/** What is known of the land, and how it looked when it was last seen. */
interface FogBlob {
  seen: Uint8Array;
  mem: Uint8Array;
  memData: Uint8Array;
}

/**
 * The one connection, held open for the life of the page.
 *
 * Opening the database costs a turn of the event loop, and the save that
 * matters most — the one as the tab is closed — does not have a turn to
 * spare. With the handle already in hand the write is asked for in the same
 * breath as the event, and the browser sees it through on its way out.
 */
let conn: IDBDatabase | null = null;
let opening: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (conn) return Promise.resolve(conn);
  if (opening) return opening;
  opening = new Promise<IDBDatabase | null>((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      conn = req.result;
      // A second tab wanting to change the shape of the store would wait on
      // this one forever otherwise.
      conn.onversionchange = () => {
        conn?.close();
        conn = null;
        opening = null;
      };
      resolve(conn);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return opening;
}

/** Open the store now, so the first save does not have to wait for it. */
export function warmSave(): void {
  void openDb();
}

/** What to put away this time, keyed by slot. Left out means left alone. */
type Parts = Array<[string, unknown]>;

function write(db: IDBDatabase, parts: Parts): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      // One transaction for the lot: a world is never half written down.
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const [slot, record] of parts) store.put(record, slot);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      // A connection that has gone stale is worth one more try later.
      conn = null;
      opening = null;
      resolve(false);
    }
  });
}

function putSave(parts: Parts): Promise<boolean> {
  // Warm, the write starts here and now; cold, it waits for the store to open.
  if (conn) return write(conn, parts);
  return openDb().then((db) => (db ? write(db, parts) : false));
}

async function getSave(): Promise<{ meta: unknown; ground: unknown; fog: unknown } | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const store = db.transaction(STORE, 'readonly').objectStore(STORE);
      const got: Record<string, unknown> = {};
      const ask = (slot: string, as: string): void => {
        const req = store.get(slot);
        req.onsuccess = () => {
          got[as] = req.result ?? null;
        };
      };
      ask(SLOT, 'meta');
      ask(SLOT_GROUND, 'ground');
      ask(SLOT_FOG, 'fog');
      store.transaction.oncomplete = () => resolve({ meta: got.meta ?? null, ground: got.ground ?? null, fog: got.fog ?? null });
      store.transaction.onerror = () => resolve(null);
      store.transaction.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

interface SaveData {
  version: number;
  seed: number;
  size: number;
  heights: string;
  tiles: string;
  data: string;
  dirt?: string;
  rock?: string;
  /** The fog of war: what has been seen, and what it looked like. */
  seen?: string;
  mem?: string;
  memData?: string;
  spawn: { x: number; y: number };
  player: { x: number; y: number; name: string; stats: Stats; level?: number; equipped?: Record<string, number | null>; rested?: number; boons?: Boon[]; affinities?: Record<string, number>; titles?: string[]; title?: string | null };
  inventory: Item[];
  nextUid?: number;
  ground?: Record<string, Item[]>;
  skills: Record<string, number>;
  time: number;
  settings: { grid: boolean; rotation?: number; deedBorder?: boolean; cutaway?: boolean; tileWindow?: boolean; fog?: boolean };
  savedAt: number;
  deed?: Deed | null;
  buildings?: BuildingsJSON;
  creatures?: { nextId: number; list: CreatureJSON[]; banked?: Array<[number, number]> };
  crates?: PlacedCrate[];
  campfires?: PlacedCampfire[];
  smelters?: PlacedSmelter[];
  kilns?: PlacedKiln[];
  furniture?: PlacedFurniture[];
  posts?: PlacedPost[];
  tally?: Record<string, number>;
  ticked?: string[];
  anvils?: PlacedAnvil[];
  crops?: Crop[];
  crate?: { x: number; y: number; items: Item[] } | null;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Everything about a world except the land itself. */
type SaveMeta = Omit<SaveData, 'heights' | 'tiles' | 'data' | 'dirt' | 'rock' | 'seen' | 'mem' | 'memData'>;

function meta(game: Game): SaveMeta {
  const w = game.world;
  return {
    version: VERSION,
    seed: game.seed,
    size: w.w,
    spawn: game.spawn,
    player: { x: game.player.x, y: game.player.y, name: game.player.name, stats: game.player.stats, level: game.player.level, equipped: game.player.equipped, rested: game.player.rested, boons: game.player.boons, affinities: game.player.affinities, titles: game.player.titles, title: game.player.title },
    inventory: game.inventory.items,
    nextUid: game.inventory.nextUid,
    ground: game.groundToJSON(),
    skills: game.skills.toJSON(),
    time: game.time,
    settings: { ...game.settings },
    savedAt: Date.now(),
    deed: game.deed,
    buildings: game.buildings.toJSON(),
    creatures: game.creatures.toJSON(),
    crates: [...game.crates.values()],
    campfires: [...game.campfires.values()],
    smelters: [...game.smelters.values()],
    kilns: [...game.kilns.values()],
    furniture: [...game.furniture.values()],
    posts: [...game.posts.values()],
    tally: { ...game.tally },
    ticked: [...game.ticked],
    anvils: [...game.anvils.values()],
    crops: [...game.crops.values()],
  };
}

/** The land as it stands, ready to be put away as it is. */
function ground(game: Game): GroundBlob {
  const w = game.world;
  return { heights: w.heights, tiles: w.tiles, data: w.data, dirt: w.dirt, rock: w.rock };
}

function fog(game: Game): FogBlob {
  const w = game.world;
  return { seen: w.seen, mem: w.mem, memData: w.memData };
}

/**
 * Whether the store already holds this session's ground and fog. Until it
 * does, they go in whether or not anything has moved them.
 */
let stored = { ground: false, fog: false };

/**
 * Put the world away. The land goes into IndexedDB as the arrays it is; if
 * that is not to be had, the old text-in-local-storage way is tried, which
 * works for small islands and fails honestly for big ones.
 */
export async function saveGame(game: Game): Promise<boolean> {
  const w = game.world;
  const parts: Parts = [[SLOT, meta(game)]];
  // Copying an array the size of an island is the whole cost of a save, so it
  // is only done for the arrays that have moved since the last one.
  const wroteGround = !stored.ground || w.groundTouched;
  const wroteFog = !stored.fog || w.fogTouched;
  if (wroteGround) parts.push([SLOT_GROUND, ground(game)]);
  if (wroteFog) parts.push([SLOT_FOG, fog(game)]);
  // Cleared before the write rather than after it: anything changed while it
  // is in flight belongs to the next save, not to this one.
  if (wroteGround) w.groundTouched = false;
  if (wroteFog) w.fogTouched = false;
  if (await putSave(parts)) {
    if (wroteGround) stored.ground = true;
    if (wroteFog) stored.fog = true;
    // Once a world is in the new place, the old copy and any patch over it are
    // only in the way.
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(PATCH);
    } catch {
      // Nothing to clear.
    }
    return true;
  }
  // It did not land, so what it was carrying is still owed.
  if (wroteGround) w.groundTouched = true;
  if (wroteFog) w.fogTouched = true;
  return saveToText(game);
}

function saveToText(game: Game): boolean {
  const w = game.world;
  const data: SaveData = {
    ...meta(game),
    heights: toBase64(new Uint8Array(w.heights.buffer, w.heights.byteOffset, w.heights.byteLength)),
    tiles: toBase64(w.tiles),
    data: toBase64(w.data),
    dirt: toBase64(w.dirt),
    rock: toBase64(w.rock),
    seen: toBase64(w.seen),
    mem: toBase64(w.mem),
    memData: toBase64(w.memData),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/**
 * Save as the page goes away: the small half now, in case the rest does not
 * make it, and then the whole thing in the hope that it does.
 */
export function saveOnExit(game: Game): void {
  try {
    localStorage.setItem(PATCH, JSON.stringify(meta(game)));
  } catch {
    // No room, or no storage at all: the last full save stands on its own.
  }
  void saveGame(game);
}

/** The newer of a full save's own metadata and whatever was written over it. */
function patched(m: SaveMeta): SaveMeta {
  let raw: string | null;
  try {
    raw = localStorage.getItem(PATCH);
  } catch {
    return m;
  }
  if (!raw) return m;
  try {
    const later = JSON.parse(raw) as SaveMeta;
    // It has to belong to this world, and it has to be the later of the two.
    if (later.version !== VERSION || later.seed !== m.seed || later.size !== m.size) return m;
    return later.savedAt > m.savedAt ? later : m;
  } catch {
    return m;
  }
}

/** Whatever is in the new place, if anything is. */
async function loadFromDb(): Promise<{ meta: SaveMeta; ground: GroundBlob; fog: FogBlob | null } | null> {
  const rec = await getSave();
  const m = rec?.meta as SaveMeta | null;
  const g = rec?.ground as GroundBlob | null;
  if (!m || !g) return null;
  const size = m.size;
  // A record that does not measure up is no use; better a fresh island.
  if (g.tiles?.length !== size * size || g.heights?.length !== (size + 1) * (size + 1)) return null;
  const f = rec?.fog as FogBlob | null;
  const known = f && f.seen?.length === size * size && f.mem?.length === size * size && f.memData?.length === size * size ? f : null;
  return { meta: m, ground: g, fog: known };
}

export async function loadGame(): Promise<Game | null> {
  const found = await loadFromDb();
  if (found) {
    const { meta: m, ground: g, fog: f } = found;
    const size = m.size;
    const world = new World(size, size, g.heights, g.tiles, g.data, g.dirt, g.rock, f?.seen, f?.mem, f?.memData);
    world.seed = m.seed;
    if (!f) world.rememberAll();
    // Both halves are already in the store, so neither is written again until
    // something moves it.
    stored = { ground: true, fog: !!f };
    world.groundTouched = false;
    world.fogTouched = !f;
    return finish(world, patched(m));
  }
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== VERSION) return null;
    const size = data.size;
    const heightBytes = fromBase64(data.heights);
    const heights = new Int16Array(heightBytes.buffer, 0, (size + 1) * (size + 1));
    const tiles = fromBase64(data.tiles);
    const extra = fromBase64(data.data);
    if (tiles.length !== size * size || extra.length !== size * size) return null;
    const dirtBytes = data.dirt ? fromBase64(data.dirt) : null;
    const rockBytes = data.rock ? fromBase64(data.rock) : null;
    const sized = (b64: string | undefined): Uint8Array | undefined => {
      if (!b64) return undefined;
      const bytes = fromBase64(b64);
      return bytes.length === size * size ? bytes : undefined;
    };
    const seenBytes = sized(data.seen);
    const world = new World(
      size,
      size,
      heights,
      tiles,
      extra,
      dirtBytes && dirtBytes.length === (size + 1) * (size + 1) ? dirtBytes : undefined,
      rockBytes && rockBytes.length === size * size ? rockBytes : undefined,
      seenBytes,
      sized(data.mem),
      sized(data.memData),
    );
    // An island explored before there was any fog stays explored.
    if (!seenBytes) world.rememberAll();
    world.seed = data.seed;
    // Worlds saved before rock had a depth get soil worked out from their tiles.
    if (!dirtBytes || dirtBytes.length !== (size + 1) * (size + 1)) world.deriveDirt();
    // Worlds saved before the rock was written down get it laid in now, on the
    // same terms a new world would: metal thick under land, thin under water.
    if (!rockBytes || rockBytes.length !== size * size) {
      world.fillRock((x, y) => {
        const density = world.hasWater(x, y) ? ORE_DENSITY.water : ORE_DENSITY.land;
        const ore = oreKindFor(world.seed, x, y, density);
        return ore >= 0 ? ore : stoneKindAt(world.seed, x, y);
      });
    }
    return finish(world, patched(data));
  } catch {
    return null;
  }
}

/**
 * Turn a world and its papers into a game, whichever place they came from.
 * Everything here is the passage of time and the mending of old saves: what
 * rotted while you were away, tools a world was made before, and settings that
 * did not exist when it was written down.
 */
function finish(world: World, m: SaveMeta): Game {
  const game = new Game({
    seed: m.seed,
    world,
    spawn: m.spawn,
    player: m.player,
    inventory: m.inventory,
    nextUid: m.nextUid,
    ground: m.ground,
    skills: m.skills,
    time: m.time,
    deed: m.deed ?? null,
    buildings: m.buildings,
    creatures: m.creatures,
    crates: m.crates,
    campfires: m.campfires,
    smelters: m.smelters,
    kilns: m.kilns,
    furniture: m.furniture,
    posts: m.posts,
    tally: m.tally,
    ticked: m.ticked,
    anvils: m.anvils,
    crops: m.crops,
    crate: m.crate ?? null,
  });
  // Whatever the save had, the island is brought up to the wildlife it should
  // hold. Species no longer need seeding one at a time: what is let out of the
  // bank is rolled from the whole table, so every one of them turns up.
  game.creatures.stockIsland(game);
  // The settlement deed form became a carved stake; rename it wherever it sits.
  const restake = (items: Item[]): void => {
    for (const it of items) if (it.id === 'settlement_deed') it.id = 'deed_stake';
  };
  restake(game.inventory.items);
  for (const pile of game.ground.values()) restake(pile);
  for (const crate of game.crates.values()) restake(crate.items);
  if (game.deed && !game.deedCrate()) game.placeDeedCrate();
  game.settings.grid = m.settings?.grid ?? true;
  game.settings.rotation = (m.settings?.rotation ?? 0) & 3;
  game.settings.deedBorder = m.settings?.deedBorder ?? true;
  game.settings.cutaway = m.settings?.cutaway ?? false;
  game.settings.tileWindow = m.settings?.tileWindow ?? true;
  game.settings.fog = m.settings?.fog ?? true;
  game.logMsg('Your journey continues where you left off.', 'system');
  // Older saves predate building: hand out the tools they never got.
  const granted: string[] = [];
  for (const [id, name] of [
    ['mallet', 'a mallet'],
    ['trowel', 'a trowel'],
    ['saw', 'a saw'],
    ['butchering_knife', 'a butchering knife'],
    ['rake', 'a rake'],
  ]) {
    if (!game.inventory.has(id)) {
      // Handed out, like the rest of the kit, and no more improvable for it.
      game.inventory.add(id, { ql: 20, issued: true });
      granted.push(name);
    }
  }
  if (granted.length) game.logMsg(`You find ${granted.join(', ')} among your things.`, 'system');
  // Things left outside kept rotting while you were away, up to a week's worth.
  const away = Math.max(0, Math.min(7 * 86400, (Date.now() - (m.savedAt ?? Date.now())) / 1000));
  if (away > 60 && game.ground.size) {
    const lost = game.applyDecay(away);
    if (lost) game.logMsg(`While you were away, ${lost === 1 ? 'an item' : `${lost} items`} left on the ground rotted away.`, 'event');
  }
  return game;
}

export async function clearSave(): Promise<void> {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(PATCH);
  } catch {
    // Storage may be unavailable; nothing to clear.
  }
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      for (const slot of [SLOT, SLOT_GROUND, SLOT_FOG]) tx.objectStore(STORE).delete(slot);
      stored = { ground: false, fog: false };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
