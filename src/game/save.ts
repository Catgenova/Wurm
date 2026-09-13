import { World } from '../world/world';
import { Game } from './game';
import type { Item } from './items';
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
  spawn: { x: number; y: number };
  player: { x: number; y: number; name: string; stats: Stats };
  inventory: Item[];
  skills: Record<string, number>;
  time: number;
  settings: { grid: boolean; rotation?: number };
  savedAt: number;
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
    spawn: game.spawn,
    player: { x: game.player.x, y: game.player.y, name: game.player.name, stats: game.player.stats },
    inventory: game.inventory.items,
    skills: game.skills.toJSON(),
    time: game.time,
    settings: { ...game.settings },
    savedAt: Date.now(),
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
    const world = new World(size, size, heights, tiles, extra);
    const game = new Game({
      seed: data.seed,
      world,
      spawn: data.spawn,
      player: data.player,
      inventory: data.inventory,
      skills: data.skills,
      time: data.time,
    });
    game.settings.grid = data.settings?.grid ?? true;
    game.settings.rotation = (data.settings?.rotation ?? 0) & 3;
    game.logMsg('Your journey continues where you left off.', 'system');
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
