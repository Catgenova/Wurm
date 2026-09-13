import { FullscreenCanvas } from './engine/canvas';
import { Input } from './engine/input';
import { GameLoop } from './engine/loop';
import { Game } from './game/game';
import { clearSave, loadGame, saveGame } from './game/save';
import { Renderer } from './render/renderer';
import { UI } from './ui/ui';

const canvasEl = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const game = (seedParam ? null : loadGame()) ?? Game.create(seedParam ? Number(seedParam) >>> 0 : (Math.random() * 0x7fffffff) >>> 0);

const canvas = new FullscreenCanvas(canvasEl);
const renderer = new Renderer(canvas, game);
const camera = renderer.camera;
const input = new Input(canvasEl);
const ui = new UI(game, renderer, uiRoot, canvasEl, {
  newWorld: () => {
    if (!confirm('Start a new world? Your current island, items and skills will be lost.')) return;
    clearSave();
    location.href = location.pathname;
  },
});

const player = game.player;
camera.focus(player.x, player.y, game.world.heightAt(player.x, player.y), null);

declare global {
  interface Window {
    /** Console handle for poking at the running game. */
    wurm: { game: Game; renderer: Renderer; camera: typeof camera };
  }
}
window.wurm = { game, renderer, camera };

input.onClick = (x, y, button) => {
  if (ui.menu.consumeSwallow()) return;
  ui.menu.hide();
  const pick = renderer.pick(x, y);
  if (!pick) return;
  if (button === 0) game.moveTo(pick.x, pick.y);
  else if (button === 2) ui.showTileMenu(pick, x, y);
};

input.onDrag = (dx, dy, button) => {
  if (button === 0 || button === 1) camera.panBy(dx, dy);
};

input.onWheel = (delta, x, y) => {
  camera.zoomAt(x, y, Math.exp(-delta * 0.0012));
};

input.onKey = (code) => {
  switch (code) {
    case 'KeyI':
      ui.toggleWindow('inventory');
      break;
    case 'KeyK':
      ui.toggleWindow('skills');
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
    case 'KeyG':
      game.settings.grid = !game.settings.grid;
      break;
    case 'KeyC':
      camera.follow = true;
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
    if ((dx !== 0 || dy !== 0) && !input.isTyping()) {
      camera.follow = true;
    } else {
      dx = 0;
      dy = 0;
    }
    player.inputDir.x = dx;
    player.inputDir.y = dy;

    game.update(dt);

    if (camera.follow) {
      camera.focus(player.x, player.y, Math.max(-4, game.world.heightAt(player.x, player.y)), dt);
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

setInterval(() => saveGame(game), 20000);
window.addEventListener('beforeunload', () => saveGame(game));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveGame(game);
});
