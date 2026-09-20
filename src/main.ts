import { FullscreenCanvas } from './engine/canvas';
import { Input } from './engine/input';
import { GameLoop } from './engine/loop';
import { partsMissing, piecesHeld, RELICS } from './game/archaeology';
import { cropSprite } from './render/sprites';
import { creatureLines, creatureSkills } from './ui/creatureinfo';
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
import { coaxBonus, COAX_LAPSE, COAX_STEP } from './game/creatures';
import { PER_ROLL, rollsAt } from './game/forage';
import { knackBonus, knackLands, KNACK_BONUS, KNACK_CAP, KNACK_HOME, KNACK_ODDS } from './game/titles';
import { boonOf, boonTime, BOON_BONUS } from './game/boons';
import { balance, fedness, NUTRIENTS, tableMul, upkeepMul } from './game/nutrition';
import { weaponDamage, WEAPON_BY_ID } from './game/gear';
import { SPECIES } from './game/creatures';
import { TITLES } from './game/titles';
import { ITEM_DEFS, itemName } from './game/items';
import { RECIPES } from './game/recipes';
import { Game } from './game/game';
import { Keybinds } from './game/keybinds';
import { loadGame, saveGame, saveOnExit, warmSave } from './game/save';
import { Renderer, skyWash, sunAt } from './render/renderer';
import { Sound } from './audio/sound';
import { SWAY_MAX, swayAt } from './render/sway';
import { PUFFS, PUFF_LIFE, PUFF_RISE, puffAge, puffOf } from './render/smoke';
import { DUST_LIFE } from './render/dust';
import { FLOAT_LIFE, FLOAT_RISE, Floaters, MERGE_WINDOW } from './render/floaters';
import { HAZE_MAX, HAZE_REACH, skyAt, unknownInk } from './render/sky';
import { Asker } from './ui/ask';
import { UI } from './ui/ui';
// Debug surface only. These come last on purpose: main is the entry point, so
// the order of its imports is the order the module graph is evaluated in.
import { groundRoll, ROCK_VARIANTS, TILE_DEFS } from './world/tiles';
import { crateName } from './game/crates';
import { furnitureName } from './game/furniture';
import { trapName } from './game/traps';
import { postName } from './game/posts';
import { candleBurn, lanternReach } from './game/light';
import { METALS } from './game/metal';
import { lanternState } from './game/lantern';
import { smeltableIn } from './game/smelter';
import { ClientSession, HostSession, bodyOf } from './net/session';
import { loopback } from './net/transport';
import { PROTOCOL, cleanName, cleanText, decode, encode } from './net/protocol';
import { packLand, packWorld, unpack } from './game/save';
import { smeltSeconds } from './game/metal';
import { needsIron } from './world/ore';
import { tileUses } from './ui/tileinfo';
import { startIsland } from './net/play';
import type { Island } from './net/island';
import { LOOK_TABLES, cleanLook, randomLook } from './game/look';
import { WORLD_PACE } from './game/pace';
import { CROPS } from './game/farming';
import { DAY_SECONDS } from './game/game';
import { TORCH_BURN } from './game/light';
import { findPath } from './world/pathfinding';
import { WATER_PALETTE, waterRgb } from './render/water';
import { drawHeadshot, drawPortrait } from './render/sprites';
import { followScreen, pageZoom, unzoomPage } from './ui/screen';

const canvasEl = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
// Raising a thousand-tile island holds the thread for a second or more, and
// nothing painted after that point is seen until it is done. Two frames of
// waiting is what it takes for the notice in the page to actually reach the
// screen first.
await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));

/**
 * The island, which is what this page is now.
 *
 * With nothing in the address bar this asks the keeper which island it keeps
 * and comes ashore on it. `?island=<id>` goes to a particular one, `?found=`
 * rolls a small one, and `?alone` is the single-player game — still all here,
 * still saved in this browser, one link away rather than the default.
 *
 * It is also the fallback. A keeper that cannot be reached, or that has no
 * island on it yet, leaves you with the game in this browser and a line saying
 * which one you got and why; a page that cannot reach the island should still
 * have a game.
 */
/**
 * The boot screen, which says what it is doing and how long it has been at it.
 *
 * It used to be one line of text. That is fine while everything is quick and
 * is the whole problem when one step is not: a screenshot came back of
 * "catching up… 100%", which was a step that had *finished*, sitting there
 * while two later ones ran in silence. A percentage of an unknown total, and
 * no clock, and no way to tell a slow step from a dead page.
 *
 * So the bar is the steps, the line is the one it is on, the number beside it
 * is how long — appearing only once a step has taken long enough to wonder
 * about — and the list underneath is what it has already done and what each
 * cost. `total` of nought means counting up towards nobody knows what, which
 * is how the island's history is read; that shows the count instead of a
 * fraction, because a fraction would be made up.
 */
const boot = ((): { say: (text: string, at?: number, of?: number) => void; stop: () => void } => {
  const root = document.querySelector('#boot');
  const bar = root?.querySelector('.boot-bar i') as HTMLElement | null;
  const line = root?.querySelector('.boot-now span') as HTMLElement | null;
  const clock = root?.querySelector('.boot-now b') as HTMLElement | null;
  const past = root?.querySelector('.boot-done') as HTMLElement | null;
  let step = '';
  let since = performance.now();
  const secs = (): number => (performance.now() - since) / 1000;
  const tick = window.setInterval(() => {
    if (clock) clock.textContent = secs() < 0.8 ? '' : `${secs().toFixed(1)}s`;
  }, 100);
  return {
    say(text, at, of) {
      if (text !== step) {
        if (step && past) {
          const was = document.createElement('li');
          was.textContent = `${step} · ${secs().toFixed(1)}s`;
          past.append(was);
          // Four is enough to see where it has been without the card growing.
          while (past.children.length > 4) past.firstElementChild?.remove();
        }
        step = text;
        since = performance.now();
        if (clock) clock.textContent = '';
      }
      if (line) line.textContent = of === 0 && at ? `${text} — ${at.toLocaleString()}` : text;
      if (bar && of && of > 0 && at !== undefined) bar.style.width = `${Math.round((at / of) * 100)}%`;
    },
    stop() {
      window.clearInterval(tick);
    },
  };
})();
const tellBoot = (text: string, done?: number, total?: number): void => boot.say(text, done, total);
let started = null;
let why = '';
try {
  started = await startIsland(params, tellBoot);
  if (!started && !params.has('alone')) why = 'The island keeper has no island on it yet.';
} catch (e) {
  why = e instanceof Error ? e.message : 'The island keeper did not answer.';
  tellBoot(`${why} — playing on your own instead.`);
  await new Promise<void>((done) => setTimeout(done, 2500));
}
const island = started?.island ?? null;

// Reading a saved world means reading it out of IndexedDB, which is a thing
// that takes a turn of the loop. Nothing else can start until it is here.
const game = started?.game ?? (seedParam ? null : await loadGame()) ?? Game.create(seedParam ? Number(seedParam) >>> 0 : (Math.random() * 0x7fffffff) >>> 0);

const canvas = new FullscreenCanvas(canvasEl);
const renderer = new Renderer(canvas, game);
const camera = renderer.camera;
const input = new Input(canvasEl);
/** Screen pixels a second the view slides while a push key is held. */
const PAN_SPEED = 900;
/**
 * What the keys do. Read here and written by the Keys tab in Settings; kept in
 * `localStorage`, so it belongs to whoever is sitting here rather than to the
 * island they happen to have open.
 */
const keys = new Keybinds();
/** Turn the view an eighth (+1 or -1) and remember the choice in the save. */
function turnView(step: number): void {
  camera.turn(step, (x, y) => game.world.heightAt(x, y));
  game.settings.rotation = camera.rotation;
}

/*
 * The island's ear.
 *
 * It cannot start itself: a browser will not open an audio context until the
 * person sitting here has done something, and a page that tried would be
 * refused and stay refused. So it is armed off the first click or key, which
 * is a thing that happens in the first second of anybody playing.
 */
const sound = new Sound(game, camera);
for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(ev, () => sound.arm(), { passive: true });
}

const ui = new UI(game, renderer, uiRoot, canvasEl, { turn: turnView, keys, island });

/*
 * The game asks in its own words, on its own canvas.
 *
 * `window.prompt` and `window.confirm` are not dialogues on a phone: Chrome on
 * Android suppresses them in more cases than it documents, and once anybody
 * has dismissed one with "don't let this page create more dialogs" every later
 * call answers null and false, silently, for the rest of the session. A player
 * on the island got no box at all and a settlement called Homestead.
 */
const asker = new Asker(uiRoot);
game.hooks = {
  prompt: (question, fallback) => asker.name(question, fallback),
  confirm: (question) => asker.sure(question),
};

const player = game.player;
camera.rotation = game.settings.rotation;
camera.focus(player.x, player.y, game.playerHeight(), null);

declare global {
  interface Window {
    /** Console handle for poking at the running game. */
    wurm: { game: Game; renderer: Renderer; camera: typeof camera; sound: Sound; ACTIONS: typeof ACTIONS; RECIPES: typeof RECIPES; FURNITURE: typeof FURNITURE; MATERIALS: typeof MATERIALS; RELICS: typeof RELICS; TRAITS: typeof TRAITS; TITLES: typeof TITLES; DYES: typeof DYES; WOUND_KINDS: typeof WOUND_KINDS; TRAPS: typeof TRAPS; BRIDGES: typeof BRIDGES; bridgeDone: typeof bridgeDone; BAITS: typeof BAITS; FISH_IDS: string[]; SPECIES: typeof SPECIES; WEAPON_BY_ID: typeof WEAPON_BY_ID; itemName: typeof itemName; arch: { partsMissing: typeof partsMissing; piecesHeld: typeof piecesHeld }; ui: UI; island: Island | null; save: () => Promise<boolean> };
  }
}
Object.assign(window as unknown as Record<string, unknown>, { catchFish, windAt, windFrom, windWord, pointOfSail, sailWord, favourCap, prayerWorth, PATHS, sittingWorth, weaponDamage, loopsFor, BELT_MAX, coaxBonus, COAX_STEP, COAX_LAPSE, rollsAt, PER_ROLL, cropSprite, creatureLines, tameChance, knackLands, knackBonus, KNACK_ODDS, KNACK_CAP, KNACK_BONUS, KNACK_HOME, boonTime, boonOf, BOON_BONUS, tableMul, upkeepMul, fedness, balance, NUTRIENTS, ITEM_DEFS, TILE_DEFS, groundRoll, crateName, furnitureName, trapName, postName, lanternReach, candleBurn, lanternState, sunAt, skyWash, swayAt, SWAY_MAX, puffAge, puffOf, PUFFS, PUFF_LIFE, PUFF_RISE, DUST_LIFE, FLOAT_LIFE, FLOAT_RISE, MERGE_WINDOW, Floaters, skyAt, unknownInk, findPath, WATER_PALETTE, waterRgb, CROPS, DAY_SECONDS, TORCH_BURN, WORLD_PACE, drawPortrait, drawHeadshot, LOOK_TABLES, cleanLook, randomLook, HAZE_MAX, HAZE_REACH, ROCK_VARIANTS, METALS, smeltableIn, smeltSeconds, needsIron, creatureSkills, tileUses, HostSession, ClientSession, bodyOf, loopback, PROTOCOL, cleanName, cleanText, encode, decode, packLand, packWorld, unpack, loadGame });
window.wurm = { game, renderer, camera, sound, ACTIONS, RECIPES, FURNITURE, MATERIALS, RELICS, TRAITS, TITLES, DYES, WOUND_KINDS, TRAPS, BRIDGES, bridgeDone, BAITS, FISH_IDS: FISH.map((f) => f.id), SPECIES, WEAPON_BY_ID, itemName, arch: { partsMissing, piecesHeld }, ui, island, save: () => saveGame(game) };

input.onClick = (x, y, button) => {
  // Something on its way to the ground takes the click: down it goes, or back into the pack.
  if (ui.placing) {
    ui.menu.hide();
    ui.placeClick(renderer.pick(x, y), button);
    return;
  }
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

/**
 * One press, looked up rather than hard-coded.
 *
 * Every entry in this table is a row in Settings → Keys. The digits are not:
 * they are ten of a kind, answering to whatever the selection window or the
 * toolbelt is offering, and they stay where they are.
 */
const PRESSES: Record<string, () => void> = {
  centre: () => {
    game.settings.follow = true;
    camera.follow = true;
  },
  // While something is being set down, the turn keys turn that instead of the view.
  turn_left: () => (ui.placing ? ui.rotatePlacing(-1) : turnView(-1)),
  turn_right: () => (ui.placing ? ui.rotatePlacing(1) : turnView(1)),
  zoom_in: () => camera.zoomAt(canvas.width / 2, canvas.height / 2, 1.25),
  zoom_out: () => camera.zoomAt(canvas.width / 2, canvas.height / 2, 0.8),
  storey_up: () => ui.hud.stepStorey(1),
  storey_down: () => ui.hud.stepStorey(-1),
  cutaway: () => ui.hud.toggleCutaway(),
  grid: () => (game.settings.grid = !game.settings.grid),
  win_inventory: () => ui.toggleWindow('inventory'),
  win_craft: () => ui.toggleWindow('craft'),
  win_tile: () => ui.toggleWindow('tile'),
  win_skills: () => ui.toggleWindow('skills'),
  win_trades: () => ui.toggleWindow('trades'),
  win_tracker: () => ui.toggleWindow('tracker'),
  win_events: () => ui.toggleWindow('events'),
  win_map: () => ui.toggleWindow('map'),
  win_wildermon: () => ui.toggleWindow('wildermon'),
  win_deed: () => ui.toggleWindow('deed'),
  win_ledger: () => ui.toggleWindow('ledger'),
  win_stores: () => ui.toggleWindow('stores'),
  win_journal: () => ui.toggleWindow('journal'),
  win_market: () => ui.toggleWindow('market'),
  win_settings: () => ui.toggleWindow('settings'),
  win_help: () => ui.toggleWindow('help'),
  walk_home: () => game.walkHome(),
  carry_on: () => {
    if (!game.resumeQueue()) game.logMsg('There is nothing waiting to be taken up.', 'info');
  },
  emotes: () => ui.showEmotes(),
  stop: () => {
    if (ui.menu.isOpen) ui.menu.hide();
    // Before the job and before the feet: Escape while walking after somebody
    // has to mean "stop following", or it stops the walk and the next tick
    // starts it again.
    else if (game.following()) game.unfollow('You stop following.');
    else if (game.action) game.cancelAction();
    else player.stop();
  },
  chat: () => ui.focusChat(),
};

input.onKey = (code, ev) => {
  /*
   * A key the Keys tab is listening for never reaches the game — and never
   * reaches the browser either. Binding F1 must not open the browser's help,
   * and binding Tab must not walk the focus out of the window.
   */
  if (ui.grabKey(code)) {
    ev.preventDefault();
    return;
  }
  if (code === 'Escape' && ui.placing) {
    ui.cancelPlacing();
    return;
  }
  // The number keys: the selection window when it is looking at something,
  // and the loops on a worn toolbelt otherwise. 0 is the tenth of either.
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) {
    ui.pressNumber((Number(digit[1]) + 9) % 10);
    return;
  }
  const id = keys.actionFor(code);
  if (id) PRESSES[id]?.();
};

const loop = new GameLoop(
  (dt) => {
    /*
     * The keys push the view, and nothing else moves you: walking is a click,
     * and a click is the only thing that walks.
     *
     * These are screen directions and stay screen directions — unlike the
     * walking they replaced, which had to be turned back into world directions
     * because the body moves through the world and the camera does not.
     */
    const held = (id: string): boolean => keys.isHeld(id, (c) => input.isDown(c));
    let px = 0;
    let py = 0;
    if (held('pan_up')) py += 1;
    if (held('pan_down')) py -= 1;
    if (held('pan_left')) px += 1;
    if (held('pan_right')) px -= 1;
    if ((px !== 0 || py !== 0) && !input.isTyping()) {
      // Diagonals go the same speed as the straights. `panBy` takes screen
      // pixels and divides by the zoom itself, so the view slides at the same
      // rate under the eye however far out it is — and it lets the camera off
      // following, exactly as a drag does.
      const len = Math.hypot(px, py);
      const step = PAN_SPEED * dt;
      camera.panBy((px / len) * step, (py / len) * step);
    }

    game.update(dt);

    // Where we have walked to, told rarely and never twice for standing still.
    // The island believes it only as far as its own clock allows.
    if (island) void island.move(player.x, player.y, player.level, performance.now() / 1000);

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

    sound.step();

    if (input.pointer.overCanvas && !input.dragging && !ui.menu.isOpen) {
      renderer.hover = renderer.hoverPick(input.pointer.x, input.pointer.y);
      ui.setHover(renderer.hover, input.pointer.x, input.pointer.y);
      ui.syncGhost(renderer.hover);
    } else {
      renderer.hover = null;
      renderer.forgetPick();
      ui.setHover(null, 0, 0);
      ui.syncGhost(null);
    }
  },
  (dt) => {
    renderer.render(dt);
    ui.update(loop.fps);
  },
);
loop.start();
// The island is up and the first frame is drawn; the notice can go.
/*
 * Keep the interface on the screen it is actually on.
 *
 * Not the page: on a phone those are different boxes. A browser rendering a
 * desktop layout gives the page nine hundred pixels and shrinks the lot onto
 * four hundred of glass, and zooming in to read it leaves everything `fixed`
 * off the side. `src/ui/screen.ts` has the whole of the reasoning; this is
 * where it is turned on, along with the way back from a zoom — which the game
 * itself has to offer, because the canvas takes a pinch and zooms the island.
 */
const zoomOut = document.createElement('button');
zoomOut.className = 'zoom-out';
zoomOut.type = 'button';
zoomOut.textContent = 'Fit the screen';
zoomOut.title = 'Put the page back to its own size';
zoomOut.hidden = true;
zoomOut.addEventListener('click', () => unzoomPage());
uiRoot.append(zoomOut);
followScreen(uiRoot, () => {
  zoomOut.hidden = pageZoom() <= 1.02;
  // The box the windows live in has just changed, and `resize` did not fire:
  // a pinch moves it, and so does a browser laying the page out for a desktop.
  ui.windows.clampAll();
});

boot.stop();
document.getElementById('boot')?.remove();

/*
 * Say which game this is, when it is not the island.
 *
 * Landing in the single-player game without having asked for it used to be the
 * only thing that could happen, so it needed no explaining. Now it means
 * something went wrong or you chose it, and either way the way back is worth
 * one line rather than a shrug.
 */
if (!island) {
  game.write(why
    ? `${why} This is the game kept in this browser instead — reload to try the island again.`
    : 'You are playing by yourself, in this browser. Drop the ?alone from the address to come ashore on the island.',
    'system');
}

// Have the store open before anything asks it to write, so that the save on
// the way out of the page is a write rather than a request to open a database.
if (!island) warmSave();
// A new island is put away early: the land only reaches the store on a full
// save, and until one has happened there is nothing for an exit patch to be
// laid over.
if (!island) {
  setTimeout(() => void saveGame(game), 3000);
  setInterval(() => void saveGame(game), 20000);
}
/*
 * Three ways out of a page, and the last of them is the only one a phone
 * reliably gives you.
 *
 * Almost everything about an island body is already written down in Postgres
 * and there is nothing to put away on the way out. The fog of war is the
 * exception: only the tab knows what its camera has covered, so it is handed
 * over on a slow beat while playing and once more here, which is what catches
 * the last three quarters of a minute of walking.
 */
const onExit = island ? (): void => island.fogOnExit() : (): void => saveOnExit(game);
window.addEventListener('beforeunload', onExit);
window.addEventListener('pagehide', onExit);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) onExit();
});
