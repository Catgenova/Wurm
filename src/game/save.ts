import { World } from '../world/world';
import type { BuildingsJSON } from './building';
import type { PlacedCampfire } from './campfire';
import type { Crop } from './farming';
import type { PlacedCrate } from './crates';
import { SPECIES, type CreatureJSON } from './creatures';
import type { Item } from './items';
import { Game, type Deed } from './game';
import type { Stats } from './player';

const KEY = 'wurm-iso-save';
const VERSION = 1;

interface SaveData {
  version: number;
  seed: number;
  size: number;
  heights: string;
  tiles: string;
  data: string;
  dirt?: string;
  spawn: { x: number; y: number };
  player: { x: number; y: number; name: string; stats: Stats; level?: number };
  inventory: Item[];
  nextUid?: number;
  ground?: Record<string, Item[]>;
  skills: Record<string, number>;
  time: number;
  settings: { grid: boolean; rotation?: number; deedBorder?: boolean };
  savedAt: number;
  deed?: Deed | null;
  buildings?: BuildingsJSON;
  creatures?: { nextId: number; list: CreatureJSON[] };
  crates?: PlacedCrate[];
  campfires?: PlacedCampfire[];
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

export function saveGame(game: Game): boolean {
  const w = game.world;
  const data: SaveData = {
    version: VERSION,
    seed: game.seed,
    size: w.w,
    heights: toBase64(new Uint8Array(w.heights.buffer, w.heights.byteOffset, w.heights.byteLength)),
    tiles: toBase64(w.tiles),
    data: toBase64(w.data),
    dirt: toBase64(w.dirt),
    spawn: game.spawn,
    player: { x: game.player.x, y: game.player.y, name: game.player.name, stats: game.player.stats, level: game.player.level },
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
    crops: [...game.crops.values()],
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): Game | null {
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
    const world = new World(size, size, heights, tiles, extra, dirtBytes && dirtBytes.length === (size + 1) * (size + 1) ? dirtBytes : undefined);
    world.seed = data.seed;
    // Worlds saved before rock had a depth get soil worked out from their tiles.
    if (!dirtBytes || dirtBytes.length !== (size + 1) * (size + 1)) world.deriveDirt();
    const game = new Game({
      seed: data.seed,
      world,
      spawn: data.spawn,
      player: data.player,
      inventory: data.inventory,
      nextUid: data.nextUid,
      ground: data.ground,
      skills: data.skills,
      time: data.time,
      deed: data.deed ?? null,
      buildings: data.buildings,
      creatures: data.creatures,
      crates: data.crates,
      campfires: data.campfires,
      crops: data.crops,
      crate: data.crate ?? null,
    });
    if (!data.creatures) game.creatures.spawnWild(game, 45);
    // Saves made before a species existed have none of it; seed a few so the island is not one-note.
    for (const id of Object.keys(SPECIES)) {
      if ([...game.creatures.list.values()].some((c) => c.species === id)) continue;
      game.creatures.spawnSpecies(game, id, 12);
    }
    // The settlement deed form became a carved stake; rename it wherever it sits.
    const restake = (items: Item[]): void => {
      for (const it of items) if (it.id === 'settlement_deed') it.id = 'deed_stake';
    };
    restake(game.inventory.items);
    for (const pile of game.ground.values()) restake(pile);
    for (const crate of game.crates.values()) restake(crate.items);
    if (game.deed && !game.deedCrate()) game.placeDeedCrate();
    game.settings.grid = data.settings?.grid ?? true;
    game.settings.rotation = (data.settings?.rotation ?? 0) & 3;
    game.settings.deedBorder = data.settings?.deedBorder ?? true;
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
        game.inventory.add(id, { ql: 20 });
        granted.push(name);
      }
    }
    if (granted.length) game.logMsg(`You find ${granted.join(', ')} among your things.`, 'system');
    // Things left outside kept rotting while you were away, up to a week's worth.
    const away = Math.max(0, Math.min(7 * 86400, (Date.now() - (data.savedAt ?? Date.now())) / 1000));
    if (away > 60 && game.ground.size) {
      const lost = game.applyDecay(away);
      if (lost) game.logMsg(`While you were away, ${lost === 1 ? 'an item' : `${lost} items`} left on the ground rotted away.`, 'event');
    }
    return game;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage may be unavailable; nothing to clear.
  }
}
