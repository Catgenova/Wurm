import { FullscreenCanvas } from './engine/canvas';
import { Input } from './engine/input';
import { GameLoop } from './engine/loop';
import { partsMissing, piecesHeld, RELICS } from './game/archaeology';
import { cropSprite } from './render/sprites';
import { creatureLines } from './ui/creatureinfo';
import { tameChance } from './game/creatureActions';
import { ACTIONS } from './game/actions';
import { FURNITURE } from './game/furniture';
import { MATERIALS } from './game/materials';
import { TRAITS } from './game/traits';
import { DYES } from './game/dyestuffs';
import { WOUND_KINDS } from './game/wounds';
import { TRAPS } from './game/traps';
import { BRIDGES, bridgeDone } from './game/bridges';
import { BAITS, catchFish, FISH } from './game/fishing';
import { pointOfSail, sailWord, windAt, windFrom, windWord } from './game/wind';
import { favourCap, prayerWorth } from './game/faith';
import { PATHS, sittingWorth } from './game/meditation';
import { BELT_MAX, loopsFor } from './game/belt';
import { coaxBonus, COAX_CAP, COAX_LAPSE, COAX_STEP } from './game/creatures';
import { PER_ROLL, rollsAt } from './game/forage';
import { AFFINITY_EVERY, knackBonus, knackLands, KNACK_BONUS, KNACK_CAP, KNACK_HOME } from './game/titles';
import { affinityOf, affinityTime, AFFINITY_BONUS } from './game/boons';
import { weaponDamage, WEAPON_BY_ID } from './game/gear';
import { SPECIES } from './game/creatures';
import { TITLES } from './game/titles';
import { itemName } from './game/items';
import { RECIPES } from './game/recipes';
import { Game } from './game/game';
import { clearSave, loadGame, saveGame, saveOnExit, warmSave } from './game/save';
import { Renderer } from './render/renderer';
import { UI } from './ui/ui';

const canvasEl = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
// Raising a thousand-tile island holds the thread for a second or more, and
// nothing painted after that point is seen until it is done. Two frames of
// waiting is what it takes for the notice in the page to actually reach the
// screen first.
await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
// Reading a saved world means reading it out of IndexedDB, which is a thing
// that takes a turn of the loop. Nothing else can start until it is here.
const game = (seedParam ? null : await loadGame()) ?? Game.create(seedParam ? Number(seedParam) >>> 0 : (Math.random() * 0x7fffffff) >>> 0);

const canvas = new FullscreenCanvas(canvasEl);
const renderer = new Renderer(canvas, game);
const camera = renderer.camera;
const input = new Input(canvasEl);
/** Quarter-turn the view (+1 or -1) and remember the choice in the save. */
function turnView(step: number): void {
  camera.turn(step, (x, y) => game.world.heightAt(x, y));
  game.settings.rotation = camera.rotation;
}

const ui = new UI(game, renderer, uiRoot, canvasEl, {
  newWorld: () => {
    if (!confirm('Start a new world? Your current island, items and skills will be lost.')) return;
    void clearSave();
    location.href = location.pathname;
  },
  turn: turnView,
});

game.hooks = {
  prompt: (question, fallback) => window.prompt(question, fallback),
  confirm: (question) => window.confirm(question),
};

const player = game.player;
camera.rotation = game.settings.rotation & 3;
camera.focus(player.x, player.y, game.playerHeight(), null);

declare global {
  interface Window {
    /** Console handle for poking at the running game. */
    wurm: { game: Game; renderer: Renderer; camera: typeof camera; ACTIONS: typeof ACTIONS; RECIPES: typeof RECIPES; FURNITURE: typeof FURNITURE; MATERIALS: typeof MATERIALS; RELICS: typeof RELICS; TRAITS: typeof TRAITS; TITLES: typeof TITLES; DYES: typeof DYES; WOUND_KINDS: typeof WOUND_KINDS; TRAPS: typeof TRAPS; BRIDGES: typeof BRIDGES; bridgeDone: typeof bridgeDone; BAITS: typeof BAITS; FISH_IDS: string[]; SPECIES: typeof SPECIES; WEAPON_BY_ID: typeof WEAPON_BY_ID; itemName: typeof itemName; arch: { partsMissing: typeof partsMissing; piecesHeld: typeof piecesHeld }; ui: UI; save: () => Promise<boolean> };
  }
}
Object.assign(window as unknown as Record<string, unknown>, { catchFish, windAt, windFrom, windWord, pointOfSail, sailWord, favourCap, prayerWorth, PATHS, sittingWorth, weaponDamage, loopsFor, BELT_MAX, coaxBonus, COAX_STEP, COAX_CAP, COAX_LAPSE, rollsAt, PER_ROLL, cropSprite, creatureLines, tameChance, knackLands, knackBonus, AFFINITY_EVERY, KNACK_CAP, KNACK_BONUS, KNACK_HOME, affinityTime, affinityOf, AFFINITY_BONUS });
window.wurm = { game, renderer, camera, ACTIONS, RECIPES, FURNITURE, MATERIALS, RELICS, TRAITS, TITLES, DYES, WOUND_KINDS, TRAPS, BRIDGES, bridgeDone, BAITS, FISH_IDS: FISH.map((f) => f.id), SPECIES, WEAPON_BY_ID, itemName, arch: { partsMissing, piecesHeld }, ui, save: () => saveGame(game) };

input.onClick = (x, y, button) => {
  // A press that closed an open menu is spent, unless it is asking for a new menu.
  if (ui.menu.consumeSwallow() && button !== 2) return;
  ui.menu.hide();
  const pick = renderer.pick(x, y);
  if (!pick) return;
  if (button === 0) {
    // A left click both walks you there and chooses the tile, so the tile
    // window follows wherever you are looking.
    game.moveTo(pick.x, pick.y);
    ui.selectTile(pick);
  } else if (button === 2) {
    ui.selectTile(pick);
    ui.showTileMenu(pick, x, y);
  }
};

input.onDrag = (dx, dy, button) => {
  if (button === 0 || button === 1) camera.panBy(dx, dy);
};

input.onWheel = (delta, x, y) => {
  camera.zoomAt(x, y, Math.exp(-delta * 0.0012));
};

input.onPinch = (factor, x, y) => {
  camera.zoomAt(x, y, factor);
};

input.onKey = (code) => {
  // The number keys: the selection window when it is looking at something,
  // and the loops on a worn toolbelt otherwise. 0 is the tenth of either.
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) {
    ui.pressNumber((Number(digit[1]) + 9) % 10);
    return;
  }
  switch (code) {
    case 'KeyI':
      ui.toggleWindow('inventory');
      break;
    case 'KeyK':
      ui.toggleWindow('skills');
      break;
    case 'KeyR':
      ui.toggleWindow('craft');
      break;
    case 'KeyT':
      ui.toggleWindow('tile');
      break;
    case 'PageUp':
      ui.hud.stepStorey(1);
      break;
    case 'PageDown':
      ui.hud.stepStorey(-1);
      break;
    case 'KeyX':
      ui.hud.toggleCutaway();
      break;
    case 'KeyL':
      ui.toggleWindow('events');
      break;
    case 'KeyM':
      ui.toggleWindow('map');
      break;
    case 'F1':
    case 'KeyH':
      ui.toggleWindow('help');
      break;
    case 'KeyO':
      ui.toggleWindow('settings');
      break;
    case 'KeyP':
      ui.toggleWindow('wildermon');
      break;
    case 'KeyN':
      ui.toggleWindow('deed');
      break;
    case 'KeyG':
      game.settings.grid = !game.settings.grid;
      break;
    case 'KeyC':
      game.settings.follow = true;
      camera.follow = true;
      break;
    case 'Home':
      game.walkHome();
      break;
    case 'KeyQ':
      turnView(-1);
      break;
    case 'KeyE':
      turnView(1);
      break;
    case 'Equal':
    case 'NumpadAdd':
      camera.zoomAt(canvas.width / 2, canvas.height / 2, 1.25);
      break;
    case 'Minus':
    case 'NumpadSubtract':
      camera.zoomAt(canvas.width / 2, canvas.height / 2, 0.8);
      break;
    case 'Escape':
      if (ui.menu.isOpen) ui.menu.hide();
      else if (game.action) game.cancelAction();
      else player.stop();
      break;
    case 'Enter':
      ui.focusChat();
      break;
  }
};

const loop = new GameLoop(
  (dt) => {
    let dx = 0;
    let dy = 0;
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) {
      dx -= 1;
      dy -= 1;
    }
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) {
      dx += 1;
      dy += 1;
    }
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) {
      dx -= 1;
      dy += 1;
    }
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) {
      dx += 1;
      dy -= 1;
    }
    // dx/dy are screen-relative (view space); turn them into world directions.
    if ((dx !== 0 || dy !== 0) && !input.isTyping()) {
      camera.follow = true;
      player.inputDir.x = camera.unrotateX(dx, dy);
      player.inputDir.y = camera.unrotateY(dx, dy);
    } else {
      player.inputDir.x = 0;
      player.inputDir.y = 0;
    }

    game.update(dt);

    /*
     * The view at the screen edge. Resting the cursor in the outer band slides
     * the camera that way, harder the closer to the edge, and stops the camera
     * following you while it does: it is a way of looking about without having
     * to hold the mouse down.
     */
    if (game.settings.edgePan && input.pointer.overCanvas && !input.dragging && !ui.menu.isOpen) {
      const band = Math.max(24, Math.min(64, Math.min(canvas.width, canvas.height) * 0.06));
      const push = (v: number, size: number): number => (v < band ? (v - band) / band : v > size - band ? (v - (size - band)) / band : 0);
      const px = push(input.pointer.x, canvas.width);
      const py = push(input.pointer.y, canvas.height);
      if (px !== 0 || py !== 0) {
        const speed = 900 * dt;
        camera.panBy(-px * speed, -py * speed);
      }
    }

    // The camera keeps to you unless it has been dragged off, or told not to.
    if (game.settings.follow && camera.follow) {
      camera.focus(player.x, player.y, Math.max(-4, game.playerHeight()), dt);
    }

    if (input.pointer.overCanvas && !input.dragging && !ui.menu.isOpen) {
      renderer.hover = renderer.pick(input.pointer.x, input.pointer.y);
      ui.setHover(renderer.hover, input.pointer.x, input.pointer.y);
    } else {
      renderer.hover = null;
      ui.setHover(null, 0, 0);
    }
  },
  (dt) => {
    renderer.render(dt);
    ui.update(loop.fps);
  },
);
loop.start();
// The island is up and the first frame is drawn; the notice can go.
document.getElementById('boot')?.remove();

// Have the store open before anything asks it to write, so that the save on
// the way out of the page is a write rather than a request to open a database.
warmSave();
// A new island is put away early: the land only reaches the store on a full
// save, and until one has happened there is nothing for an exit patch to be
// laid over.
setTimeout(() => void saveGame(game), 3000);
setInterval(() => void saveGame(game), 20000);
// Three ways out of a page, and the last of them is the only one a phone
// reliably gives you.
window.addEventListener('beforeunload', () => saveOnExit(game));
window.addEventListener('pagehide', () => saveOnExit(game));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveOnExit(game);
});
