import type { Game } from '../game/game';
import { EMOTES } from '../game/emotes';
import type { Pick, Renderer } from '../render/renderer';
import { TileType, TREE_DEFS, treeAge, treeSpecies, SLAB_BY_ITEM } from '../world/tiles';
import { ACTION_BY_ID, type ActionDef, type Target, fruitSprout, SPOIL_TILE } from '../game/actions';
import { BUILD_ACTION_BY_ID, materialName } from '../game/buildActions';
import {
  describeNeeds,
  FENCE_TYPES,
  FLOOR_KIND_NAMES,
  floorBill,
  floorKind,
  isDone,
  MATERIALS,
  progressOf,
  SIDE_NAMES,
  wallBill,
  WALL_TYPE_BY_ID,
  WALL_TYPES,
  workLevel,
  type Side,
} from '../game/building';
import { baitHint, CREATURE_ACTION_BY_ID } from '../game/creatureActions';
import { crateLine, crateOf, CREATURE_CRATE, CREATURE_CRATE_ACTION_BY_ID, occupiedRefusal } from '../game/creaturecrate';
import { isBaitFor, SPECIES, STANCE_HINTS, STANCE_NAMES, STANCES, GATHER_VERB, GATHER_DO } from '../game/creatures';
import { itemDef, itemName, storedLine, type Item } from '../game/items';
import { nearestSide } from '../render/renderer';
import { crateKindOfItem, crateName, crateCapacity, crateUnits, subtileOf } from '../game/crates';
import { butcherPreview } from '../game/butcher';
import { anvilAnchor, anvilName, type PlacedAnvil } from '../game/anvil';
import { postCandidates, postLife, postName, postRadius, postState, type PlacedPost } from '../game/posts';
import { baitInPack, trapDef, trapHolds, trapLife, trapName, TRAPS, trapState, type PlacedTrap } from '../game/traps';
import { BAIT_BY_ID } from '../game/fishing';
import { BRIDGES, bridgeDef, bridgeName, bridgeState, spanWants, type Bridge } from '../game/bridges';
import { foundationState } from '../game/foundations';
import { CASTS, FAITH, favourCap } from '../game/faith';
import { abilitiesOf, CHOOSE_AT, MEDITATION, nextStep, PATHS, PATH_LIST, sittingWorth } from '../game/meditation';
import { canImprove } from '../game/improve';
import { BREWS } from '../game/brewing';
import { fireAnchor, fireState, FIRE_COST, isFuel, type PlacedCampfire } from '../game/campfire';
import { COIN_METALS, DIE_WEAR, METAL_BY_LUMP, MOULD_BY_ID, MOULD_BY_MAKES, isCasting, isLump, isMould, isOreItem, mouldLumps, mouldUsesLeft } from '../game/metal';
import { meltable } from '../game/melt';
import { jobName, smelterAnchor, smelterState, type PlacedSmelter } from '../game/smelter';
import { isGreenware, kilnAnchor, kilnState, type PlacedKiln } from '../game/kiln';
import { furnitureAnchor, furnitureCapacity, furnitureDef, furnitureHeft, furnitureHolds, furnitureKg, furnitureName, furnitureState, furnitureUnits, isFurniture, rackDeck, rackSpots, type PlacedFurniture, turnedFacing } from '../game/furniture';
import { DEED_ACTION_BY_ID, leaveQuestion, standingWord, upgradeProgress, upgradeReason } from '../game/deed';
import { CROP_BY_SEED, cropDef, describeCrop } from '../game/farming';
import { cornerReading, groundReading } from './tileinfo';
import { deedWorkersAt, MAX_DEED_LEVEL, rankAtLeast, type Deed } from '../game/game';
import { CRAFT_REACH, recipeNeeds, recipeReason, recipeStatus, RECIPES, type CraftStock } from '../game/recipes';
import { CraftPanel } from './panels/craft';
import { CratePanel } from './panels/crate';
import { TilePanel } from './panels/tile';
import type { DragPayload } from './dragdrop';
import { WildermonPanel } from './panels/wildermon';
import { StoresPanel } from './panels/stores';
import { DeedPanel } from './panels/deed';
import { LedgerPanel } from './panels/ledger';
import { JournalPanel } from './panels/journal';
import { ContextMenu, type MenuItem } from './contextmenu';
import { jobEntry, pinEntry, pinnable } from './beltmenu';
import { creatureLines } from './creatureinfo';
import { MARK_COLOURS } from '../game/marks';
import { SettingsPanel } from './panels/settings';
import { LookPanel } from './panels/looks';
import { keyName, type Keybinds } from '../game/keybinds';
import { Hud, WINDOWS } from './hud';
import { EventLogPanel } from './panels/eventlog';
import { InventoryPanel } from './panels/inventory';
import { MinimapPanel } from './panels/minimap';
import { SkillsPanel } from './panels/skills';
import { TradesPanel } from './panels/trades';
import { SocialPanel } from './panels/social';
import { MarketPanel } from './panels/market';
import { HoardPanel } from './panels/hoard';
import { TrackerPanel } from './panels/tracker';
import { Tooltip } from './tooltip';
import { WindowManager } from './windows';
import type { Island } from '../net/island';
import { uiBox } from './screen';

export interface UICallbacks {
  /** Quarter-turn the camera: +1 or -1. */
  turn: (step: number) => void;
  /** What every key does, for the Keys tab in Settings to write to. */
  keys: Keybinds;
  /**
   * The island, when there is one.
   *
   * The only thing in here that talks to it directly. Everything else on this
   * canvas asks the game and the game asks the island — but who somebody is to
   * you is not a fact about the world being drawn: there is no wildermon, no
   * tile and no item behind a friend, only a door and an answer.
   */
  island?: Island | null;
}

/** Builds and updates every HTML overlay above the canvas. */
/**
 * Something on its way to the ground. A piece of furniture follows the cursor
 * until it is clicked down; a staircase or a ladder sits on its tile until
 * the side to climb from is chosen. Q and E turn either.
 */
type Placing =
  | { kind: 'furniture'; itemUid: number; piece: string; material?: string; facing: Side }
  | { kind: 'stairs'; x: number; y: number; cx: number; cy: number; level: number; material: string; floorKind: 'stairs' | 'ladder'; side: Side };

/**
 * Where a stack at hand is, on its menu row, when it is not on you: "in the
 * wagon (pine)". A station takes what it uses up from your stores within
 * `CRAFT_REACH` as well as from the pack, and says so here.
 */
const storedIn = (s: CraftStock): string | undefined =>
  s.carried || !s.store ? undefined : `in the ${s.store.charAt(0).toLowerCase()}${s.store.slice(1)}`;
/** What a station's menu says when nothing it takes is at hand: on you, and in your stores too unless Settings keeps them out. */
const noneAtHand = (g: Game, what: string): string =>
  g.settings.fromStores ? `You have ${what} on you or in your stores within ${CRAFT_REACH} tiles.` : `You have ${what} on you.`;

export class UI {
  readonly windows: WindowManager;
  readonly menu: ContextMenu;
  readonly tooltip: Tooltip;
  readonly hud: Hud;
  readonly minimap: MinimapPanel;
  private readonly eventLog: EventLogPanel;
  private readonly settings: SettingsPanel;
  private readonly cratePanel: CratePanel;
  private readonly wildermon: WildermonPanel;
  private readonly stores: StoresPanel;
  private readonly craftPanel: CraftPanel;
  private readonly ledgerPanel: LedgerPanel;
  private readonly trades: TradesPanel;
  private readonly deedPanel: DeedPanel;
  private readonly tilePanel: TilePanel;
  private readonly social: SocialPanel;
  private readonly market: MarketPanel;
  private readonly hoard: HoardPanel;
  /** The island, for the one window that asks it things directly. */
  private readonly island: Island | null;
  /** What every key does, so the window menu can name them. */
  private readonly keys: Keybinds;
  /** Something on its way to the ground, or nothing. */
  placing: Placing | null = null;

  constructor(
    private readonly game: Game,
    private readonly renderer: Renderer,
    root: HTMLElement,
    canvas: HTMLCanvasElement,
    cb: UICallbacks,
  ) {
    this.keys = cb.keys;
    this.island = cb.island ?? null;
    this.windows = new WindowManager(root);
    this.menu = new ContextMenu(root, canvas);
    this.tooltip = new Tooltip(root);
    this.hud = new Hud(root, game, {
      toggle: (id) => this.toggleWindow(id),
      toggleGrid: () => (game.settings.grid = !game.settings.grid),
      center: () => (renderer.camera.follow = true),
      windows: (x, y) => this.showWindowMenu(x, y),
      turn: cb.turn,
      useLoop: (loop) => this.useLoop(loop),
      numbersTaken: () => this.numbersTaken,
      keys: cb.keys,
    });
    /*
     * One place hears about a rebinding and tells the rest. The Keys tab redraws
     * its own rows; the toolbar has to be told, because the button that says
     * `Inventory I` is not the thing that changed it.
     */
    cb.keys.onChange = () => {
      this.hud.drawKeys();
      this.settings.drawKeys();
    };

    const events = this.windows.create({ id: 'events', title: 'Event', x: 12, y: 12, width: 420, height: 210, anchor: 'bl' });
    this.eventLog = new EventLogPanel(events, game);
    const inventory = this.windows.create({ id: 'inventory', title: 'Inventory', x: 12, y: 56, width: 340, height: 300, anchor: 'tr' });
    new InventoryPanel(inventory, game, this.menu, (p) => this.moveDragged(p, 'inventory'), (uid) => this.cratePanel.openBag(uid), (uid) => this.hoard.openOn(uid));
    const skills = this.windows.create({ id: 'skills', title: 'Skills', x: 364, y: 56, width: 260, height: 380, anchor: 'tr', open: false });
    new SkillsPanel(skills, game);
    // The handful you are moving today, beside the book that holds all forty.
    const tracker = this.windows.create({ id: 'tracker', title: 'Tracker', x: 364, y: 446, width: 260, height: 210, anchor: 'tr', open: false });
    new TrackerPanel(tracker, game, (x, y, title, items) => this.menu.show(x, y, title, items));
    const craft = this.windows.create({ id: 'craft', title: 'Crafting', x: 364, y: 56, width: 360, height: 360, anchor: 'tr', open: false });
    this.craftPanel = new CraftPanel(craft, game);
    const tileWin = this.windows.create({ id: 'tile', title: 'Tile', x: 12, y: 200, width: 300, height: 320, open: false });
    this.tilePanel = new TilePanel(tileWin, game, (pick) => this.menuFor(pick), this.tooltip);
    const map = this.windows.create({ id: 'map', title: 'Map', x: 12, y: 370, width: 236, height: 262, anchor: 'tr', open: false });
    this.minimap = new MinimapPanel(map, game, renderer);
    const settings = this.windows.create({ id: 'settings', title: 'Settings', x: 12, y: 56, width: 380, height: 520, anchor: 'tr', open: false });
    // How you look: the creator, opened from Settings. Wide enough for the
    // mirror beside the choices; narrower, and the mirror goes over them.
    const lookWin = this.windows.create({ id: 'look', title: 'How you look', x: 60, y: 48, width: 720, height: 640, anchor: 'tl', open: false });
    new LookPanel(lookWin, game, this.island);
    this.settings = new SettingsPanel(settings, game, cb.keys, () => lookWin.open());
    const crate = this.windows.create({ id: 'crate', title: 'Deed crate', x: 364, y: 56, width: 320, height: 260, anchor: 'tr', open: false });
    this.cratePanel = new CratePanel(crate, game, (p) => this.moveDragged(p, 'store'),
      (x, y, title, items) => this.menu.show(x, y, title, items));
    const journal = this.windows.create({ id: 'journal', title: 'Journal', x: 12, y: 56, width: 330, height: 420, anchor: 'tr', open: false });
    new JournalPanel(journal, game);
    // "The rest of it" on the first-steps card opens the whole list.
    this.hud.openJournal = () => journal.open();
    const pals = this.windows.create({ id: 'wildermon', title: 'Wildermon', x: 364, y: 330, width: 330, height: 320, anchor: 'tr', open: false });
    this.wildermon = new WildermonPanel(
      pals,
      game,
      (id) => this.creatureEntries(id),
      (x, y, title, items) => this.menu.show(x, y, title, items),
    );
    const stores = this.windows.create({ id: 'stores', title: 'Stores', x: 12, y: 486, width: 360, height: 300, anchor: 'tr', open: false });
    this.stores = new StoresPanel(
      stores,
      game,
      (id) => this.cratePanel.open(id),
      (id) => this.cratePanel.openFurniture(id),
    );
    const deedWin = this.windows.create({ id: 'deed', title: 'Settlement', x: 12, y: 56, width: 330, height: 440, anchor: 'tr', open: false });
    this.deedPanel = new DeedPanel(deedWin, game, (x, y) => {
      game.moveTo(x, y);
      game.logMsg(`Walking to (${x}, ${y}).`, 'info');
    }, this.island ? (d) => void this.leaveSettlement(d) : undefined);
    // Everybody, and what they are to you: who is waiting on an answer, who
    // you know and where they are, and what has been written.
    const socialWin = this.windows.create({ id: 'social', title: 'Social', x: 12, y: 56, width: 340, height: 420, anchor: 'tr', open: false });
    this.social = new SocialPanel(socialWin, game, this.island);
    /*
     * Where goods change hands. Beside the social window because it is the
     * same subject — other people — and reads its roll of who you know rather
     * than keeping a second one.
     */
    const marketWin = this.windows.create({ id: 'market', title: 'Market', x: 12, y: 56, width: 360, height: 440, anchor: 'tr', open: false });
    this.market = new MarketPanel(marketWin, game, this.island, () => this.social.folk());
    /*
     * Not on the Menu, because it is not a window you open — it is a window a
     * particular map opens. Reading a second map while the first is up shows
     * the second: there is only ever one picture in front of you.
     */
    const hoardWin = this.windows.create({ id: 'hoard', title: 'The map', x: 12, y: 56, width: 412, height: 520, anchor: 'tl', open: false });
    this.hoard = new HoardPanel(hoardWin, game, this.island);
    const ledgerWin = this.windows.create({ id: 'ledger', title: 'Ledger', x: 12, y: 56, width: 340, height: 420, anchor: 'tr', open: false });
    this.ledgerPanel = new LedgerPanel(ledgerWin, game);
    /*
     * Wider than most, because a tree is three columns of three and a node has
     * a sentence on it: at this width the grid opens in three, and narrowing
     * the window stacks them rather than squeezing them. 560 is what three
     * readable cards and their gaps come to.
     */
    const tradesWin = this.windows.create({ id: 'trades', title: 'Trades', x: 12, y: 56, width: 560, height: 560, anchor: 'tl', open: false });
    this.trades = new TradesPanel(tradesWin, game, this.island);
    const help = this.windows.create({ id: 'help', title: 'Help', x: 0, y: 0, width: 440, height: 460, open: false });
    help.el.style.left = `${Math.max(0, (uiBox().w - 440) / 2)}px`;
    help.el.style.top = `${Math.max(0, (uiBox().h - 460) / 2)}px`;
    /*
     * The handbook, fetched the first time it is opened and not before.
     *
     * It is a hundred and thirty kilobytes of prose — the single largest thing
     * in the bundle after the drawings, and every one of them was being
     * parsed and built into the page before the first frame, for a window that
     * starts closed and that most sessions never open at all. It is its own
     * file now: the island starts sooner, and the handbook costs a moment the
     * first time somebody asks for it, by which point they are reading.
     */
    let built = false;
    help.onOpen = () => {
      if (built) return;
      built = true;
      void import('./panels/help').then((m) => m.buildHelp(help));
    };
  }

  /**
   * A press, offered to the Keys tab before the game sees it.
   *
   * True means it was taken: something in Settings was waiting for a key, and
   * this one was it. Nothing else in the UI swallows keys, which is why this is
   * a question with one asker and one answerer rather than a chain.
   */
  grabKey(code: string): boolean {
    return this.settings.grab(code);
  }

  toggleWindow(id: string): void {
    this.windows.toggle(id);
  }

  /** Open the storage window on a crate or a piece of furniture. */
  openCrate(id: number): void {
    this.cratePanel.open(id);
  }

  openFurniture(id: number): void {
    this.cratePanel.openFurniture(id);
  }

  /**
   * What standing in the world a dragged thing could be let go into, under the
   * cursor: a crate, or a piece of furniture that holds things -- a chest, a
   * larder, a cart, a wagon. Not a trash crate, which destroys what goes in,
   * and not a market stall, whose wares want a price; both keep to the menu.
   */
  storeAt(pick: Pick | null): { kind: 'crate' | 'furniture'; id: number } | null {
    if (!pick) return null;
    if (pick.crate !== undefined && this.game.crates.has(pick.crate)) return { kind: 'crate', id: pick.crate };
    if (pick.furniture === undefined) return null;
    const f = this.game.furniture.get(pick.furniture);
    if (!f || !furnitureHolds(f)) return null;
    const def = furnitureDef(f.kind);
    return def.trash || def.stall ? null : { kind: 'furniture', id: f.id };
  }

  /**
   * A thing dragged out of the pack and let go over something in the world
   * that holds things goes into it: the whole stack, by the same door the
   * store window's drop and the "Put in" entries use, so the same rules hold.
   * Across the yard the feet go first. False when there was nothing there to
   * take it.
   */
  dropOnWorld(p: DragPayload, pick: Pick | null): boolean {
    const g = this.game;
    const at = this.storeAt(pick);
    if (!at || p.from !== 'inventory') return false;
    const held = g.inventory.get(p.uid);
    if (!held) return true;
    if (g.isEquipped(held.uid)) {
      g.logMsg(`Take the ${p.name.toLowerCase()} off first.`, 'error');
      return true;
    }
    const def = ACTION_BY_ID.get(at.kind === 'crate' ? 'store_in_crate' : 'store_in_furniture');
    if (!def) return true;
    const target: Target = { kind: 'item', uid: held.uid, count: held.count, into: at.id };
    if (!def.applies(target, g)) {
      const where = at.kind === 'crate' ? crateName(g.crates.get(at.id)!) : furnitureName(g.furniture.get(at.id)!);
      g.logMsg(`The ${p.name.toLowerCase()} will not go in the ${where.toLowerCase()}.`, 'error');
      return true;
    }
    g.requestAction(def, target);
    return true;
  }

  /**
   * Carry a dragged thing from one window to the other. The same rules apply as
   * to the menu entries that do the same job: you have to be able to reach the
   * container, and it has to be willing to hold what you are giving it.
   */
  private moveDragged(p: DragPayload, to: 'inventory' | 'store'): void {
    const g = this.game;
    const store = this.cratePanel.currentStore();
    if (!store) return;
    if (!this.cratePanel.withinReach()) {
      g.logMsg(`Stand next to the ${store.what} to move things in and out of it.`, 'error');
      return;
    }
    /*
     * On an island a drag is an ask like any other.
     *
     * Reported as rubber-banding: "it's happening when I click and drag but
     * not when I click and hit button". This half moved the row from one
     * window to the other in the browser's own copy and told nobody, so the
     * next answer from the island put it straight back. The menu entries have
     * always gone through `requestAction`; this now does too, and a drag ends
     * up meaning exactly what the entry beside it means.
     *
     * A bag on your back is the island's too, since the bag work: it holds
     * rows like any other store and `take_from_store` and `stow_item` are its
     * doors. Panniers have none of their own and are still carried here, which
     * is right: they are a beast's and travel with it.
     */
    if (g.ask && store.kind !== 'carried') {
      const id = to === 'inventory' ? 'take_from_store'
        : store.kind === 'crate' ? 'store_in_crate'
        : store.kind === 'bag' ? 'stow_item' : 'store_in_furniture';
      const def = ACTION_BY_ID.get(id);
      if (!def) return;
      const held = to === 'inventory'
        ? store.items.find((it) => it.uid === p.uid)
        : g.inventory.get(p.uid);
      // Which store it was dragged into, so that it goes into that one rather
      // than into whichever happens to stand nearest.
      g.requestAction(def, { kind: 'item', uid: p.uid, count: held?.count ?? 1, into: store.id });
      return;
    }
    if (to === 'inventory') {
      const item = store.take(p.uid);
      if (!item) return;
      g.inventory.addItem(item);
      g.logMsg(`You take the ${p.name.toLowerCase()} out of the ${store.what}.`, 'event');
      return;
    }
    const held = g.inventory.get(p.uid);
    if (!held) return;
    if (g.isEquipped(held.uid)) {
      g.logMsg(`Take the ${p.name.toLowerCase()} off first.`, 'error');
      return;
    }
    const occupied = occupiedRefusal(g, 'store_in_furniture', { kind: 'item', uid: held.uid });
    if (occupied) {
      g.logMsg(occupied, 'error');
      return;
    }
    const refused = store.refuses(held);
    if (refused) {
      g.logMsg(refused, 'error');
      return;
    }
    // What there is room for rather than the whole armful: the rest stays in
    // the pack and is said so, instead of the drag being refused outright.
    const fits = store.fits(held);
    const item = fits > 0 ? g.inventory.take(held.uid, fits) : null;
    if (!item) {
      g.logMsg(`The ${store.what} is full.`, 'error');
      return;
    }
    if (!store.add(item)) {
      g.inventory.addItem(item);
      g.logMsg(`The ${store.what} will not take the ${p.name.toLowerCase()}.`, 'error');
      return;
    }
    g.logMsg(storedLine(item.count, p.name, store.what, held.count - item.count), 'event');
  }

  /**
   * Point the tile window at what was clicked. Opening it on a click is what
   * makes the game playable with one button; the setting turns that off for
   * anyone who would rather keep to the right-click menu.
   */
  selectTile(pick: Pick | null): void {
    this.tilePanel.select(pick, this.game.settings.tileWindow);
    this.renderer.selected = pick ? { x: pick.x, y: pick.y } : null;
  }

  focusChat(): void {
    this.windows.get('events')?.open();
    this.eventLog.focus();
  }

  update(fps: number): void {
    this.hud.update(this.renderer, fps);
    this.renderer.selected = this.tilePanel.target ? { x: this.tilePanel.target.x, y: this.tilePanel.target.y } : null;
    this.minimap.update();
    this.settings.refresh();
    this.wildermon.update(performance.now());
    this.stores.update(performance.now());
    this.deedPanel.update(performance.now());
    this.social.update(performance.now() / 1000);
    this.market.update(1 / 60);
    this.hoard.update(performance.now() / 1000);
    this.tilePanel.update(performance.now());
    this.craftPanel.update(performance.now());
    this.ledgerPanel.update(performance.now());
    this.trades.update(performance.now() / 1000);
  }

  /** Describe what is under the cursor. */
  /**
   * One job in a menu. A job that runs on and on is offered by the handful as
   * well: five, ten, twenty-five, or until your wind gives out. That way a
   * hundred bricks is one right-click and not a hundred.
   */
  private jobEntry(def: ActionDef, target: Target, reason: string | null, label: string): MenuItem {
    return jobEntry(this.game, def, target, reason, label);
  }

  /**
   * The thing under the cursor as a target: whatever is standing on the tile
   * if anything is, and the tile itself otherwise. What the belt aims at.
   */
  private targetOf(pick: Pick): Target {
    if (pick.creature !== undefined) return { kind: 'creature', id: pick.creature };
    if (pick.crate !== undefined) return { kind: 'crate', id: pick.crate };
    if (pick.fire !== undefined) return { kind: 'campfire', id: pick.fire };
    if (pick.smelter !== undefined) return { kind: 'smelter', id: pick.smelter };
    if (pick.kiln !== undefined) return { kind: 'kiln', id: pick.kiln };
    if (pick.anvil !== undefined) return { kind: 'anvil', id: pick.anvil };
    if (pick.post !== undefined) return { kind: 'post', id: pick.post };
    if (pick.trap !== undefined) return { kind: 'trap', id: pick.trap };
    if (pick.bridge !== undefined) return { kind: 'bridge', id: pick.bridge };
    if (pick.furniture !== undefined) return { kind: 'furniture', id: pick.furniture };
    return { kind: 'tile', x: pick.x, y: pick.y, cx: pick.cx, cy: pick.cy };
  }

  /**
   * Press a number key. What it does depends on what is in front of you: the
   * Tile window takes the numbers whenever it is open and looking at
   * something, since the thing selected is what you mean; otherwise they press
   * the loops on your belt.
   */
  pressNumber(index: number): void {
    if (this.tilePanel.press(index)) return;
    this.useLoop(index);
  }

  /** Whether the selection window is holding the number keys just now. */
  get numbersTaken(): boolean {
    return this.bindings.length > 0;
  }

  /**
   * What each number key would do right now, for the help and for tests. The
   * HUD is built before the windows are and draws its belt straight away, so
   * this has to answer before there is a selection window to ask.
   */
  get bindings(): Array<{ key: string; label: string }> {
    return this.tilePanel?.bindings ?? [];
  }

  /** Press a loop on the belt, aimed at whatever the cursor is on. */
  useLoop(loop: number): void {
    const pick = this.renderer.hover;
    this.game.useLoop(loop, pick ? this.targetOf(pick) : null);
  }

  /** Pick up a piece to set down: it follows the cursor from here, and Q and E turn it. */
  startPlacing(item: Item): void {
    this.placing = { kind: 'furniture', itemUid: item.uid, piece: item.id, material: item.extra, facing: 's' };
    this.game.logMsg(`The ${itemName(item).toLowerCase()} follows the cursor: Q and E turn it, a click sets it down, Escape keeps it.`, 'info');
  }

  /** Plan a staircase or a ladder on a tile: the side to climb from turns with Q and E. */
  startPlacingStairs(base: Target, level: number, material: string, floorKind: 'stairs' | 'ladder', side: Side): void {
    if (base.kind !== 'tile') return;
    this.placing = { kind: 'stairs', x: base.x, y: base.y, cx: base.cx, cy: base.cy, level, material, floorKind, side };
    this.game.logMsg('Q and E choose the side to climb from, a click plans it, Escape lets it go.', 'info');
  }

  /** A quarter turn of what is being placed: to the right for +1, to the left for -1. */
  rotatePlacing(step: number): void {
    const p = this.placing;
    if (!p) return;
    if (p.kind === 'furniture') p.facing = turnedFacing(p.facing, step);
    else p.side = turnedFacing(p.side, step);
  }

  cancelPlacing(): void {
    this.placing = null;
    this.renderer.ghost = null;
  }

  /** The ghost the renderer draws for what is being placed, worked out from where the cursor is. */
  syncGhost(pick: Pick | null): void {
    const p = this.placing;
    if (!p) {
      this.renderer.ghost = null;
      return;
    }
    if (p.kind === 'stairs') {
      const plan = ACTION_BY_ID.get('plan_floor');
      const target: Target = { kind: 'tile', x: p.x, y: p.y, cx: p.cx, cy: p.cy, side: p.side, material: p.material, floorKind: p.floorKind };
      this.renderer.ghost = { kind: 'stairs', x: p.x, y: p.y, level: p.level, material: p.material, floorKind: p.floorKind, side: p.side, ok: !(plan?.check?.(target, this.game) ?? null) };
      return;
    }
    if (!pick) {
      this.renderer.ghost = null;
      return;
    }
    const [s0, t0] = subtileOf(pick.x, pick.y, pick.wx, pick.wy);
    const [ax, ay] = furnitureAnchor(p.piece, s0, t0, p.facing);
    this.renderer.ghost = { kind: 'furniture', piece: p.piece, material: p.material, x: pick.x, y: pick.y, sx: ax, sy: ay, facing: p.facing, ok: !this.game.furniturePlaceReason(p.piece, pick.x, pick.y, ax, ay, p.facing) };
  }

  /** A click while something is being placed: the left button sets it down where the cursor is, any other keeps it. */
  placeClick(pick: Pick | null, button: number): void {
    const p = this.placing;
    if (!p) return;
    if (button !== 0) {
      this.cancelPlacing();
      return;
    }
    if (p.kind === 'stairs') {
      const plan = ACTION_BY_ID.get('plan_floor');
      const target: Target = { kind: 'tile', x: p.x, y: p.y, cx: p.cx, cy: p.cy, side: p.side, material: p.material, floorKind: p.floorKind };
      const reason = plan?.check?.(target, this.game) ?? null;
      if (reason) {
        this.game.logMsg(reason, 'error');
        return;
      }
      if (plan) this.game.requestAction(plan, target);
      this.cancelPlacing();
      return;
    }
    if (!pick) return;
    const def = ACTION_BY_ID.get('place_furniture');
    const [s0, t0] = subtileOf(pick.x, pick.y, pick.wx, pick.wy);
    const [ax, ay] = furnitureAnchor(p.piece, s0, t0, p.facing);
    const target: Target = { kind: 'tile', x: pick.x, y: pick.y, cx: pick.cx, cy: pick.cy, sx: ax, sy: ay, itemUid: p.itemUid, facing: p.facing };
    const reason = def?.check?.(target, this.game) ?? null;
    if (reason) {
      this.game.logMsg(reason, 'error');
      return;
    }
    if (def) this.game.requestAction(def, target);
    this.cancelPlacing();
  }

  setHover(pick: Pick | null, sx: number, sy: number): void {
    if (!pick) {
      this.tooltip.hide();
      return;
    }
    const w = this.game.world;
    const lines: string[] = [];
    const growing = this.game.cropAt(pick.x, pick.y);
    const creature = pick.creature !== undefined ? this.game.creatures.get(pick.creature) : undefined;
    if (creature) {
      this.tooltip.show(sx, sy, creatureLines(this.game, creature));
      return;
    }
    const sm = pick.smelter !== undefined ? this.game.smelters.get(pick.smelter) : undefined;
    if (sm) {
      lines.push('Stone smelter');
      lines.push(smelterState(sm));
      if (sm.jobs.length) lines.push(`Working: ${itemDef(sm.jobs[0].makes).name.toLowerCase()}, ${Math.ceil(sm.jobs[0].left)}s left`);
      this.tooltip.show(sx, sy, lines);
      return;
    }
    const fu = pick.furniture !== undefined ? this.game.furniture.get(pick.furniture) : undefined;
    if (fu) {
      lines.push(furnitureName(fu));
      lines.push(furnitureState(fu));
      if (rackSpots(fu)) lines.push(this.rackLine(fu));
      if (furnitureHolds(fu)) lines.push('Stand next to it to put things away.');
      this.tooltip.show(sx, sy, lines);
      return;
    }
    const kl = pick.kiln !== undefined ? this.game.kilns.get(pick.kiln) : undefined;
    if (kl) {
      lines.push('Kiln');
      lines.push(kilnState(kl));
      if (kl.jobs.length) lines.push(`Firing: ${itemDef(kl.jobs[0].makes).name.toLowerCase()}, ${Math.ceil(kl.jobs[0].left)}s left`);
      this.tooltip.show(sx, sy, lines);
      return;
    }
    const an = pick.anvil !== undefined ? this.game.anvils.get(pick.anvil) : undefined;
    if (an) {
      lines.push(anvilName(an));
      lines.push(`QL ${an.ql.toFixed(1)} · bring a mould and metal`);
      this.tooltip.show(sx, sy, lines);
      return;
    }
    const fire = pick.fire !== undefined ? this.game.campfires.get(pick.fire) : undefined;
    if (fire) {
      lines.push('Campfire');
      lines.push(fireState(fire));
      if (fire.lit) lines.push('Stand here to cook.');
      this.tooltip.show(sx, sy, lines);
      return;
    }
    const crate = pick.crate !== undefined ? this.game.crates.get(pick.crate) : undefined;
    if (crate) {
      lines.push(crateName(crate));
      lines.push(`${crateUnits(crate)} / ${crateCapacity(crate)} things · spot ${crate.sx + 1},${crate.sy + 1} of tile ${crate.x}, ${crate.y}`);
      this.tooltip.show(sx, sy, lines);
      return;
    }
    const t = w.getTile(pick.x, pick.y);
    if (t === TileType.Tree) {
      const data = w.getData(pick.x, pick.y);
      lines.push(`${treeAge(data).name} ${TREE_DEFS[treeSpecies(data)].name.toLowerCase()} tree`);
    } else if (growing) {
      lines.push(`${cropDef(growing.id).name} field`);
    } else {
      lines.push(w.tileName(pick.x, pick.y));
    }
    if (growing) lines.push(describeCrop(growing, this.game.time));
    lines.push(`${pick.x}, ${pick.y} · slope ${w.slope(pick.x, pick.y)}`);
    lines.push(cornerReading(this.game, pick.cx, pick.cy));
    const reading = groundReading(this.game, pick.x, pick.y);
    if (reading) lines.push(reading);
    /*
     * Whose ground this is, and what you are on it.
     *
     * Your own settlement has said its name here for a long time; somebody
     * else's said nothing at all, so a stranger's land was a green border and
     * a stake, and the only way to find out whose it was or whether you were
     * allowed to dig was to try and be refused. A settlement is the most
     * conspicuous thing a person builds and it is worth being able to read
     * one from outside.
     */
    const mine = this.game.deedOfMineAt(pick.x, pick.y);
    const here = mine ?? this.game.deedAt(pick.x, pick.y);
    if (here) {
      const token = this.game.isToken(pick.x, pick.y);
      const who = 'holder' in here && here.holder ? `, ${here.holder}\u2019s` : '';
      const level = here.level && here.level > 1 ? ` \u00b7 level ${here.level}` : '';
      lines.push(`${token ? 'Settlement token of' : 'Part of'} ${here.name}${who}${level}`);
      lines.push(mine ? standingWord(mine.role) : 'You are a stranger here: you may walk it and shape nothing.');
    }
    const b = this.game.buildings.buildingAt(pick.x, pick.y);
    if (b) {
      const level = workLevel(b);
      lines.push(`${b.name} · ${b.levels === 1 ? 'one storey' : `${b.levels} storeys, working on storey ${level + 1}`}`);
      const side = nearestSide(pick.x, pick.y, pick.wx, pick.wy);
      const wall = this.game.buildings.wall(level, pick.x, pick.y, side);
      if (wall) {
        const type = WALL_TYPE_BY_ID.get(wall.type)?.name.toLowerCase() ?? wall.type;
        const mat = MATERIALS.find((m) => m.id === wall.material)?.name.toLowerCase() ?? wall.material;
        lines.push(`${SIDE_NAMES[side]} wall: ${type} ${mat}${isDone(wall) ? '' : ` · ${Math.round(progressOf(wall) * 100)}% built`}`);
      } else {
        lines.push(`${SIDE_NAMES[side]} side: no wall`);
      }
      const floor = this.game.buildings.floor(level, pick.x, pick.y);
      if (floor) {
        const k = floorKind(floor);
        const mat = MATERIALS.find((m) => m.id === floor.material)?.name.toLowerCase() ?? floor.material;
        lines.push(`${k === 'ladder' ? 'ladder' : `${mat} ${FLOOR_KIND_NAMES[k]}`}${isDone(floor) ? '' : ` · ${Math.round(progressOf(floor) * 100)}% built`}`);
      }
      const roof = this.game.buildings.floor(b.levels, pick.x, pick.y);
      if (roof) lines.push(`roof${isDone(roof) ? '' : ` · ${Math.round(progressOf(roof) * 100)}% built`}`);
    }
    const pile = this.game.groundAt(pick.x, pick.y);
    if (pile.length === 1) {
      const it = pile[0];
      lines.push(`On the ground: ${itemName(it).toLowerCase()}${it.count > 1 ? ` ×${it.count}` : ''}${it.dmg >= 1 ? ` · ${Math.round(it.dmg)}% damage` : ''}`);
    } else if (pile.length) {
      lines.push(`On the ground: ${pile.length} items`);
    }
    this.tooltip.show(sx, sy, lines);
  }

  /**
   * Every window there is, under the one button that opens them.
   *
   * Thirteen buttons across the top of a phone was four screens of sideways
   * scrolling; one button and a list is the same thirteen doors without the
   * wall of them. Each row says which key it answers to, so the menu teaches
   * its own way out of itself — and whether the window is open already, since
   * the row toggles rather than opens and a list that will not say which way
   * it is about to go is a list you have to try.
   */
  showWindowMenu(x: number, y: number): void {
    const entries: MenuItem[] = WINDOWS.map((wdw) => {
      const open = this.windows.get(wdw.id)?.isOpen ?? false;
      const codes = this.keys.codes(wdw.bind);
      return {
        label: `${open ? '✓ ' : ''}${wdw.label}`,
        note: codes.length ? keyName(codes[0]) : undefined,
        onSelect: () => this.toggleWindow(wdw.id),
      };
    });
    this.menu.show(x, y, 'Windows', entries);
  }

  /**
   * The emotes, in the middle of the screen where the key left the cursor.
   *
   * A menu rather than a key each: two of them is a pair of bindings and five
   * is a keyboard nobody can remember, and this costs one keypress more and
   * never runs out of room. Each row says the command that does the same
   * thing, so the menu teaches the way out of itself.
   */
  showEmotes(): void {
    const cam = this.renderer.camera;
    this.menu.show(cam.width / 2, cam.height / 2, 'Emotes',
      EMOTES.map((e) => ({
        label: e.label,
        note: `/${e.id}`,
        onSelect: () => this.game.emote(e.id),
      })));
  }

  showTileMenu(pick: Pick, sx: number, sy: number): void {
    let built: { title: string; facts?: string[]; entries: MenuItem[] };
    try {
      built = this.menuFor(pick);
    } catch (e) {
      // Said in the log and on the console rather than swallowed: a menu
      // that cannot be built is a bug, and one that took the click handler
      // down with it was reported as the game locking up.
      const why = e instanceof Error ? e.message : String(e);
      console.error('The menu for this could not be built', e);
      this.game.logMsg(`The menu for this could not be built: ${why}`, 'error');
      built = { title: 'Something here', entries: [{ label: `Could not list what can be done here: ${why}`, disabled: true }] };
    }
    this.menu.show(sx, sy, built.title, built.entries, built.facts);
  }

  /**
   * Everything that can be done where you clicked, and what to call it. The
   * right-click menu and the tile window are the same list seen two ways, so
   * neither can fall behind the other.
   */
  menuFor(pick: Pick): { title: string; facts?: string[]; entries: MenuItem[] } {
    if (pick.peer !== undefined) return this.personMenu(pick.peer);
    const creature = pick.creature !== undefined ? this.game.creatures.get(pick.creature) : undefined;
    if (creature) {
      return { title: `${creature.name} (${this.game.creatures.describe(creature)})`, entries: this.creatureEntries(creature.id) };
    }
    const crate = pick.crate !== undefined ? this.game.crates.get(pick.crate) : undefined;
    if (crate) {
      const ct: Target = { kind: 'crate', id: crate.id };
      const entries: MenuItem[] = [{ label: 'Open', onSelect: () => this.cratePanel.open(crate.id) }];
      for (const id of ['crate_take_all', 'pick_up_crate']) {
        const def = ACTION_BY_ID.get(id);
        if (!def) continue;
        const reason = def.check?.(ct, this.game) ?? null;
        entries.push({ label: def.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => this.game.requestAction(def, ct) });
      }
      entries.push(...this.nameEntry(ct));
      return { title: crateName(crate), entries };
    }
    const fire = pick.fire !== undefined ? this.game.campfires.get(pick.fire) : undefined;
    if (fire) return { title: `Campfire (${fireState(fire)})`, entries: this.campfireEntries(fire) };
    const smelter = pick.smelter !== undefined ? this.game.smelters.get(pick.smelter) : undefined;
    if (smelter) return { title: `Smelter (${smelterState(smelter)})`, entries: this.smelterEntries(smelter) };
    const piece = pick.furniture !== undefined ? this.game.furniture.get(pick.furniture) : undefined;
    if (piece) {
      const state = rackSpots(piece) ? `${furnitureState(piece)} · ${this.rackLine(piece)}`
        : piece.kind === CREATURE_CRATE ? `${furnitureState(piece)} · ${crateLine(this.game, piece)}`
        : furnitureState(piece);
      return { title: `${furnitureName(piece)} (${state})`, entries: [...this.furnitureEntries(piece), ...this.nameEntry({ kind: 'furniture', id: piece.id })] };
    }
    const kilnHere = pick.kiln !== undefined ? this.game.kilns.get(pick.kiln) : undefined;
    if (kilnHere) return { title: `Kiln (${kilnState(kilnHere)})`, entries: this.kilnEntries(kilnHere) };
    const anvilHere = pick.anvil !== undefined ? this.game.anvils.get(pick.anvil) : undefined;
    if (anvilHere) return { title: `${anvilName(anvilHere)} (QL ${anvilHere.ql.toFixed(0)})`, entries: this.anvilEntries(anvilHere) };
    const postHere = pick.post !== undefined ? this.game.posts.get(pick.post) : undefined;
    if (postHere) return { title: `${postName(postHere)} (${postState(postHere)})`, entries: [...this.postEntries(postHere), ...this.nameEntry({ kind: 'post', id: postHere.id })] };
    const trapHere = pick.trap !== undefined ? this.game.traps.get(pick.trap) : undefined;
    if (trapHere) return { title: `${trapName(trapHere)} (${trapState(trapHere, this.game)})`, entries: [...this.trapEntries(trapHere), ...this.nameEntry({ kind: 'trap', id: trapHere.id })] };
    const bridgeHere = pick.bridge !== undefined ? this.game.bridges.get(pick.bridge) : undefined;
    if (bridgeHere) return { title: `${bridgeName(bridgeHere)} (${bridgeState(bridgeHere)})`, entries: this.bridgeEntries(bridgeHere) };
    const target = { kind: 'tile' as const, x: pick.x, y: pick.y, cx: pick.cx, cy: pick.cy };
    const entries: MenuItem[] = [];
    entries.push(...this.settlementEntry(pick));
    // The settlement this tile is on, if it is one of yours: the whole menu
    // for one you founded, and what you are and the way off it for one you
    // were asked onto.
    const settled = this.game.deedOfMineAt(pick.x, pick.y);
    if (settled) entries.push(rankAtLeast(settled.role, 'founder') ? this.deedEntry() : this.citizenEntry(settled));
    // Laying a campfire on the block of subtiles under the cursor.
    const fireDef = ACTION_BY_ID.get('build_campfire');
    if (fireDef && this.game.inventory.count('shaft') >= FIRE_COST) {
      const [ax, ay] = fireAnchor(...subtileOf(pick.x, pick.y, pick.wx, pick.wy));
      const ft: Target = { ...target, sx: ax, sy: ay };
      const reason = fireDef.check?.(ft, this.game) ?? null;
      entries.push({
        label: `Build campfire here (spots ${ax + 1},${ay + 1} to ${ax + 2},${ay + 2})`,
        hint: reason ?? undefined,
        note: reason ? undefined : `Uses ${FIRE_COST} shafts`,
        disabled: !!reason,
        onSelect: () => this.game.requestAction(fireDef, ft),
      });
    }
    // Placing a carried crate on the subtile under the cursor.
    const crateItems = this.game.inventory.items.filter((it) => crateKindOfItem(it.id));
    const placeDef = ACTION_BY_ID.get('place_crate');
    if (crateItems.length && placeDef) {
      const [sx0, sy0] = subtileOf(pick.x, pick.y, pick.wx, pick.wy);
      for (const it of crateItems) {
        const pt: Target = { ...target, sx: sx0, sy: sy0, itemUid: it.uid };
        const reason = placeDef.check?.(pt, this.game) ?? null;
        entries.push({ label: `Place ${itemName(it).toLowerCase()} here (spot ${sx0 + 1},${sy0 + 1})`, hint: reason ?? undefined, disabled: !!reason, onSelect: () => this.game.requestAction(placeDef, pt) });
      }
    }
    // Driving a carried work post into the spot under the cursor.
    const postDef = ACTION_BY_ID.get('place_post');
    const postItems = this.game.inventory.items.filter((it) => it.id === 'work_post');
    if (postDef && postItems.length) {
      const [px0, py0] = subtileOf(pick.x, pick.y, pick.wx, pick.wy);
      for (const it of postItems) {
        const pt: Target = { ...target, sx: px0, sy: py0, itemUid: it.uid };
        const reason = postDef.check?.(pt, this.game) ?? null;
        entries.push({
          label: `Drive ${itemName(it).toLowerCase()} in here (spot ${px0 + 1},${py0 + 1})`,
          note: reason ? undefined : `${Math.round(postLife(it.ql) / 60)} min · reaches ${postRadius(it.ql)} tiles`,
          hint: reason ?? undefined,
          disabled: !!reason,
          onSelect: () => this.game.requestAction(postDef, pt),
        });
      }
    }
    // Sitting down on the rug, choosing a way, and calling on what it gave.
    const sit = ACTION_BY_ID.get('meditate');
    if (sit && this.game.inventory.has('rug') && pick.x === this.game.player.tileX && pick.y === this.game.player.tileY) {
      const g = this.game;
      const med = g.skills.get(MEDITATION);
      const why = sit.check?.(target, g) ?? null;
      const worth = sittingWorth(g);
      entries.push({
        label: 'Sit and think about nothing',
        note: why ? undefined : `meditation ${med.toFixed(1)} · this spot is worth ${(worth.gain / 1.5).toFixed(2)}×`,
        hint: why ?? undefined,
        disabled: !!why,
        onSelect: () => g.requestAction(sit, target),
      });
      const choose = ACTION_BY_ID.get('choose_path');
      if (choose && !g.player.way) {
        const ready = med >= CHOOSE_AT;
        entries.push({
          label: 'Choose a path',
          hint: ready ? 'Chosen once, and never again.' : `Sit until you have ${CHOOSE_AT} meditation behind you.`,
          disabled: !ready,
          children: ready
            ? PATH_LIST.map((path) => ({
                label: path.name,
                note: path.steps.map((st) => `${st.at}: ${st.name}`).join(' · '),
                hint: path.note,
                onSelect: () => g.requestAction(choose, { ...target, material: path.id }),
              }))
            : undefined,
        });
      }
      if (g.player.way) {
        const way = PATHS[g.player.way];
        const next = nextStep(g.player.way, med);
        entries.push({ label: `The path of ${way.name}`, note: next ? `next: ${next.name} at ${next.at}` : 'walked to the end', disabled: true });
        const use = ACTION_BY_ID.get('use_ability');
        const able = abilitiesOf(g.player.way, med);
        if (use && able.length) {
          entries.push({
            label: 'Call on what you know',
            children: able.map((st) => {
              const t: Target = { ...target, material: st.ability?.id };
              const reason = use.check?.(t, g) ?? null;
              return { label: st.name, note: st.note, hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(use, t) };
            }),
          });
        }
      }
    }
    // Throwing a bridge from where you are standing to the tile under the cursor.
    const planBridge = ACTION_BY_ID.get('plan_bridge');
    if (planBridge && (pick.x !== this.game.player.tileX || pick.y !== this.game.player.tileY)) {
      const options = (Object.keys(BRIDGES) as Array<keyof typeof BRIDGES>)
        .map((kind) => ({ kind, def: BRIDGES[kind], reason: planBridge.check?.({ ...target, material: kind }, this.game) ?? null }))
        .filter((o) => o.reason === null || !/runs straight|nothing between|a gap, it is ground|dry, solid ground/.test(o.reason));
      if (options.length) {
        entries.push({
          label: 'Throw a bridge across from here',
          children: options.map((o) => ({
            label: o.def.name,
            note: o.reason ? undefined : `${o.def.bill.map(([id, n]) => `${n} ${itemName({ uid: 0, id, ql: 1, dmg: 0, count: 1 }).toLowerCase()}`).join(', ')} a span · ${o.def.carts ? 'carts cross' : 'foot only'}`,
            hint: o.reason ?? undefined,
            disabled: !!o.reason,
            onSelect: () => this.game.requestAction(planBridge, { ...target, material: o.kind }),
          })),
        });
      }
    }
    // Setting a carried trap on the spot under the cursor.
    const trapSet = ACTION_BY_ID.get('set_trap');
    const trapItems = this.game.inventory.items.filter((it) => it.id === 'snare' || it.id === 'deadfall' || it.id === 'creel');
    if (trapSet && trapItems.length) {
      const [tx0, ty0] = subtileOf(pick.x, pick.y, pick.wx, pick.wy);
      for (const it of trapItems) {
        const tt: Target = { ...target, sx: tx0, sy: ty0, itemUid: it.uid };
        const reason = trapSet.check?.(tt, this.game) ?? null;
        const kind = TRAPS[it.id as 'snare' | 'deadfall' | 'creel'];
        entries.push({
          label: `Set ${itemName(it).toLowerCase()} here (spot ${tx0 + 1},${ty0 + 1})`,
          note: reason ? undefined : `${Math.round(trapLife(it.id as 'snare' | 'deadfall' | 'creel', it.ql) / 60)} min · ${kind.water ? `holds ${kind.hold ?? 8} fish` : `holds to taming ${Math.round(kind.holds * (0.6 + Math.max(1, Math.min(100, it.ql)) / 250))}`}`,
          hint: reason ?? undefined,
          disabled: !!reason,
          onSelect: () => this.game.requestAction(trapSet, tt),
        });
      }
    }
    // Setting carried furniture down on the block of subtiles under the cursor.
    const placeFurnitureDef = ACTION_BY_ID.get('place_furniture');
    const carried = this.game.inventory.items.filter((it) => isFurniture(it.id));
    if (placeFurnitureDef && carried.length) {
      // The piece follows the cursor from here: Q and E turn it, a click sets it down.
      entries.push({
        label: 'Set furniture down',
        children: carried.map((it) => ({
          label: it.count > 1 ? `${itemName(it)} (${it.count})` : itemName(it),
          note: 'follows the cursor · Q and E turn it · click to set down',
          onSelect: () => this.startPlacing(it),
        })),
      });
    }
    // Sowing on a tilled field: pick from the seeds you carry.
    const sowDef = ACTION_BY_ID.get('plant_seed');
    if (sowDef && sowDef.applies(target, this.game) && !this.game.cropAt(pick.x, pick.y)) {
      const seeds = this.game.inventory.items.filter((it) => CROP_BY_SEED.has(it.id));
      entries.push({
        label: 'Sow',
        disabled: !seeds.length,
        hint: seeds.length ? undefined : 'You carry no seeds. Forage and botanize for them.',
        children: seeds.length
          ? seeds.map((it) => {
              const crop = CROP_BY_SEED.get(it.id)!;
              const st: Target = { ...target, itemUid: it.uid };
              const reason = sowDef.check?.(st, this.game) ?? null;
              return {
                label: it.count > 1 ? `${itemName(it)} (${it.count})` : itemName(it),
                note: `${crop.name}, ${crop.stageSeconds}s a stage`,
                hint: reason ?? undefined,
                disabled: !!reason,
                onSelect: () => this.game.requestAction(sowDef, st),
              };
            })
          : undefined,
      });
    }
    const smelterDef = ACTION_BY_ID.get('place_smelter');
    const smelterItem = this.game.inventory.find('smelter');
    if (smelterDef && smelterItem) {
      const [ax, ay] = smelterAnchor(...subtileOf(pick.x, pick.y, pick.wx, pick.wy));
      const st: Target = { ...target, sx: ax, sy: ay, itemUid: smelterItem.uid };
      const reason = smelterDef.check?.(st, this.game) ?? null;
      entries.push({
        label: `Set the smelter down here (spots ${ax + 1},${ay + 1} to ${ax + 3},${ay + 2})`,
        note: reason ? undefined : `QL ${smelterItem.ql.toFixed(0)}`,
        hint: reason ?? undefined,
        disabled: !!reason,
        onSelect: () => this.game.requestAction(smelterDef, st),
      });
    }
    const kilnDef = ACTION_BY_ID.get('place_kiln');
    const kilnItem = this.game.inventory.find('kiln');
    if (kilnDef && kilnItem) {
      const [ax, ay] = kilnAnchor(...subtileOf(pick.x, pick.y, pick.wx, pick.wy));
      const st: Target = { ...target, sx: ax, sy: ay, itemUid: kilnItem.uid };
      const reason = kilnDef.check?.(st, this.game) ?? null;
      entries.push({
        label: `Set the kiln down here (spots ${ax + 1},${ay + 1} to ${ax + 2},${ay + 2})`,
        note: reason ? undefined : `QL ${kilnItem.ql.toFixed(0)}`,
        hint: reason ?? undefined,
        disabled: !!reason,
        onSelect: () => this.game.requestAction(kilnDef, st),
      });
    }
    const anvilDef = ACTION_BY_ID.get('place_anvil');
    const anvilItem = this.game.inventory.find('anvil');
    if (anvilDef && anvilItem) {
      const [ax, ay] = anvilAnchor(...subtileOf(pick.x, pick.y, pick.wx, pick.wy));
      const st: Target = { ...target, sx: ax, sy: ay, itemUid: anvilItem.uid };
      const reason = anvilDef.check?.(st, this.game) ?? null;
      entries.push({
        label: `Set the anvil down here (spots ${ax + 1},${ay + 1} to ${ax + 2},${ay + 2})`,
        hint: reason ?? undefined,
        disabled: !!reason,
        onSelect: () => this.game.requestAction(anvilDef, st),
      });
    }
    const pile = this.game.groundAt(pick.x, pick.y);
    const pickUp = ACTION_BY_ID.get('pick_up');
    if (pile.length && pickUp) {
      const children: MenuItem[] = pile.map((item) => ({
        label: (item.count > 1 ? `${itemName(item)} (${item.count})` : itemName(item)) + (item.dmg >= 1 ? ` · dmg ${Math.round(item.dmg)}` : ''),
        onSelect: () => this.game.requestAction(pickUp, { kind: 'ground', x: pick.x, y: pick.y, uid: item.uid }),
      }));
      if (pile.length > 1) children.push({ label: 'Everything', onSelect: () => this.game.requestAction(pickUp, { kind: 'ground', x: pick.x, y: pick.y, uid: null }) });
      entries.push({ label: 'Pick up', children });
    }
    // Anything else that can be done to a thing lying here, such as butchering a corpse.
    for (const item of pile) {
      const gt: Target = { kind: 'ground', x: pick.x, y: pick.y, uid: item.uid };
      for (const { def, reason } of this.game.actionsFor(gt)) {
        if (def.id === 'pick_up') continue;
        entries.push({
          label: `${def.label} the ${itemName(item).toLowerCase()}`,
          hint: reason ?? undefined,
          note: def.id === 'butcher' ? butcherPreview(this.game, item) : undefined,
          disabled: !!reason,
          onSelect: () => this.game.requestAction(def, gt),
        });
      }
    }
    const building = this.game.buildings.buildingAt(pick.x, pick.y);
    if (building) entries.push(...this.buildingEntries(pick));
    for (const { def, reason } of this.game.actionsFor(target)) {
      // Slabs come in four stones and they do not look alike: choose which goes down.
      if (def.id === 'pave_slabs') {
        const slabs = this.game.inventory.items.filter((it) => SLAB_BY_ITEM.has(it.id));
        if (slabs.length > 1) {
          entries.push({
            label: def.label,
            children: slabs.map((it) => {
              const st: Target = { ...target, itemUid: it.uid };
              const why = def.check?.(st, this.game) ?? null;
              return { label: it.count > 1 ? `${itemName(it)} (${it.count})` : itemName(it), hint: why ?? undefined, disabled: !!why, onSelect: () => this.game.requestAction(def, st) };
            }),
          });
          continue;
        }
      }
      // A spadeful of dirt, clay or sand lays down the ground it was: choose
      // which, when more than one is carried.
      if (def.id === 'drop_dirt') {
        const spoil = this.game.inventory.items.filter((it) => it.id in SPOIL_TILE);
        if (new Set(spoil.map((it) => it.id)).size > 1) {
          entries.push({
            label: def.label,
            children: spoil.map((it) => {
              const st: Target = { ...target, itemUid: it.uid };
              const why = def.check?.(st, this.game) ?? null;
              return { label: `Drop ${it.count > 1 ? `${itemName(it).toLowerCase()} (${it.count})` : itemName(it).toLowerCase()}`, hint: why ?? undefined, disabled: !!why, onSelect: () => this.game.requestAction(def, st) };
            }),
          });
          continue;
        }
      }
      // And sprouts, for the same reason: nine species, and a planted one is
      // what stands there for the next twenty years. A graft chooses among
      // the three that bear.
      if (def.id === 'plant' || def.id === 'graft') {
        const sprouts = this.game.inventory.items.filter((it) => it.id === 'sprout' && (def.id === 'plant' || fruitSprout(it)));
        if (sprouts.length > 1) {
          entries.push({
            label: def.label,
            children: sprouts.map((it) => {
              const st: Target = { ...target, itemUid: it.uid };
              const why = def.check?.(st, this.game) ?? null;
              return { label: it.count > 1 ? `${itemName(it)} (${it.count})` : itemName(it), hint: why ?? undefined, disabled: !!why, onSelect: () => this.game.requestAction(def, st) };
            }),
          });
          continue;
        }
      }
      entries.push(this.jobEntry(def, target, reason, def.labelFor?.(target, this.game) ?? def.label));
    }
    if (!building) entries.push(...this.buildingEntries(pick));
    // Pinning a name to this spot, or rubbing one off.
    const here = this.game.markNear(pick.x, pick.y, 1.5);
    if (here) {
      entries.push({
        label: `Mark: ${here.name}`,
        children: [
          {
            label: 'Rename it',
            onSelect: () => void (async () => {
              const said = await this.game.hooks.prompt('What is this spot called?', here.name);
              if (said !== null) this.game.renameMark(here.id, said);
            })(),
          },
          { label: 'Rub it off the map', onSelect: () => this.game.removeMark(here.id) },
          ...MARK_COLOURS.map((c) => ({
            label: c.name,
            note: c.note,
            onSelect: () => {
              here.colour = c.id;
              this.game.events.emit('world', here.x, here.y);
            },
          })),
        ],
      });
    } else {
      entries.push({
        label: 'Mark this spot on the map',
        children: MARK_COLOURS.map((c) => ({
          label: c.name,
          note: c.note,
          onSelect: () => void (async () => {
            const said = await this.game.hooks.prompt(`Name this spot (${pick.x}, ${pick.y}):`, '');
            if (said !== null) this.game.addMark(pick.x, pick.y, said, c.id);
          })(),
        })),
      });
    }
    // Hanging one of this tile's jobs on the belt, to be pressed anywhere after.
    const hangable = this.game.actionsFor(target).filter((a) => pinnable(a.def));
    if (hangable.length && this.game.beltLoops()) {
      entries.push({
        label: 'Hang a job on your belt',
        children: hangable.map(({ def }) => ({ label: def.label, children: pinEntry(this.game, { action: def.id }).children })),
      });
    }
    const title = building ? `${building.name} (${pick.x}, ${pick.y})` : `${this.game.world.tileName(pick.x, pick.y)} (${pick.x}, ${pick.y})`;
    /*
     * What is true of the ground, above the list of what can be done to it.
     *
     * Where the corner you picked stands, first, because half the list is
     * corner work and the dot on the ground says which corner without saying
     * how high it is. Then what a prospector read, when anybody has read it.
     * Both were mouseover lines, and neither was readable at all with a
     * finger.
     */
    const reading = groundReading(this.game, pick.x, pick.y);
    // And the slab, if there is one: a tile whose top is somewhere other than
    // the ground has to say where, or nothing else on this list makes sense.
    const slab = this.game.foundations.size ? this.game.foundationAt(pick.x, pick.y) : undefined;
    const facts = [
      cornerReading(this.game, pick.cx, pick.cy),
      ...(slab ? [`Concrete foundation · ${foundationState(slab)}`] : []),
      ...(reading ? [reading] : []),
    ];
    return { title, facts, entries };
  }

  /** Feeding, lighting and cooking at a campfire. */
  private campfireEntries(fire: PlacedCampfire): MenuItem[] {
    const g = this.game;
    const ft: Target = { kind: 'campfire', id: fire.id };
    const entries: MenuItem[] = [];
    const fuelDef = ACTION_BY_ID.get('fuel_campfire');
    const wood = g.stockChoices((it) => isFuel(it.id));
    if (fuelDef && wood.length) entries.push({ label: 'Fuel', children: wood.map((s) => this.stackRow(fuelDef, ft, s)) });
    for (const id of ['light_campfire', 'put_out_campfire', 'take_apart_campfire']) {
      const def = ACTION_BY_ID.get(id);
      if (!def || !def.applies(ft, g)) continue;
      const reason = def.check?.(ft, g) ?? null;
      entries.push({ label: def.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(def, ft) });
    }
    entries.push({ label: 'Cook', children: this.cookEntries() });
    return entries;
  }

  /** Everything a lit fire or a hot oven could turn into dinner. */
  private cookEntries(): MenuItem[] {
    const g = this.game;
    // What is at hand, carried or stored within reach, listed once for every dish.
    const stock = g.craftStock();
    return RECIPES.filter((r) => r.station === 'campfire').map((r) => {
      const def = ACTION_BY_ID.get(r.id);
      const st = recipeStatus(r, g, undefined, stock);
      const material = stock.find((s) => s.item.id === r.inputs[0].item)?.item;
      const reason = def ? recipeReason(r, g, undefined, stock) : 'Not possible.';
      return {
        label: `${itemDef(r.result).name}${(r.count ?? 1) > 1 ? ` × ${r.count}` : ''}`,
        note: recipeNeeds(r),
        hint: reason ?? undefined,
        disabled: !!reason || !def || !material,
        onSelect: () => {
          if (def && material) g.requestAction(def, { kind: 'item', uid: material.uid }, st.max);
        },
      };
    });
  }

  /**
   * One stack on a station's menu, to put in one at a time or all at once:
   * fuel for a fire, ore or scrap for a smelter, clay for a kiln. A stack in
   * one of your stores rather than on you says which store it is in.
   */
  private stackRow(def: ActionDef, target: Target, stack: CraftStock): MenuItem {
    const g = this.game;
    const it = stack.item;
    const put = (count: number) => (): void => g.requestAction(def, { ...target, itemUid: it.uid, count } as Target);
    return {
      label: it.count > 1 ? `${itemName(it)} (${it.count})` : itemName(it),
      note: storedIn(stack),
      children: it.count > 1 ? [{ label: 'One', onSelect: put(1) }, { label: `All (${it.count})`, onSelect: put(it.count) }] : undefined,
      onSelect: it.count > 1 ? undefined : put(1),
    };
  }

  /** Fuelling, charging and drawing off a smelter. */
  private smelterEntries(s: PlacedSmelter): MenuItem[] {
    const g = this.game;
    const st: Target = { kind: 'smelter', id: s.id };
    const entries: MenuItem[] = [];
    /*
     * Everything the furnace takes in -- fuel, ore, scrap and metal -- comes
     * from the same stock a craft spends: the pack, a bag on your back, and
     * your stores within reach, a wagon drawn up beside it included. The
     * moulds are tools, and are the ones you carry.
     */
    const fuelDef = ACTION_BY_ID.get('fuel_smelter');
    const fuel = g.stockChoices((it) => isFuel(it.id));
    if (fuelDef && fuel.length) entries.push({ label: 'Fuel', children: fuel.map((k) => this.stackRow(fuelDef, st, k)) });
    const smeltDef = ACTION_BY_ID.get('smelt_ore');
    const ores = g.stockChoices((it) => isOreItem(it.id));
    if (smeltDef) {
      entries.push({
        label: 'Smelt ore',
        disabled: !ores.length,
        hint: ores.length ? undefined : noneAtHand(g, 'no ore'),
        children: ores.length ? ores.map((k) => this.stackRow(smeltDef, st, k)) : undefined,
      });
    }
    // Scrap goes back into the fire: anything cast from metal, or hafted to a cast head.
    const meltDef = ACTION_BY_ID.get('melt_down');
    const scrap = g.stockChoices((it) => meltable(it));
    if (meltDef) {
      entries.push({
        label: 'Melt down',
        disabled: !scrap.length,
        hint: scrap.length ? undefined : noneAtHand(g, 'nothing made of metal'),
        children: scrap.length ? scrap.map((k) => this.stackRow(meltDef, st, k)) : undefined,
      });
    }
    const castDef = ACTION_BY_ID.get('cast_anvil');
    const lumps = g.stockChoices((it) => isLump(it.id));
    if (castDef && g.inventory.has('anvil_mould')) {
      entries.push({
        label: 'Cast an anvil',
        disabled: !lumps.length,
        hint: lumps.length ? undefined : noneAtHand(g, 'no metal'),
        children: lumps.length
          ? lumps.map((k) => {
              const it = k.item;
              const t: Target = { ...st, itemUid: it.uid };
              const reason = castDef.check?.(t, g) ?? null;
              return { label: `${itemName(it)} (${it.count})`, note: storedIn(k), hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(castDef, t) };
            })
          : undefined,
      });
    }
    // Every other mould is poured here too, and cools into a casting for the anvil.
    const pourDef = ACTION_BY_ID.get('pour_mould');
    const moulds = g.inventory.items.filter((it) => isMould(it.id) && MOULD_BY_ID.get(it.id)?.makes !== 'anvil');
    if (pourDef) {
      entries.push({
        label: 'Pour a mould',
        disabled: !moulds.length || !lumps.length,
        hint: !moulds.length ? 'You carry no moulds.' : !lumps.length ? noneAtHand(g, 'no metal') : undefined,
        children:
          moulds.length && lumps.length
            ? moulds.map((mould) => {
                const def = MOULD_BY_ID.get(mould.id)!;
                return {
                  label: itemName(mould),
                  note: `${itemDef(def.makes).name.toLowerCase()} · ${def.lumps} lump${def.lumps > 1 ? 's' : ''} · ${mouldUsesLeft(mould.ql, mould.dmg)} fillings left`,
                  children: lumps.map((k) => {
                    const lump = k.item;
                    const t: Target = { ...st, mouldUid: mould.uid, itemUid: lump.uid };
                    const reason = pourDef.check?.(t, g) ?? null;
                    // What this metal costs, which is not the same for all of
                    // them: a lump of the rare six weighs a tenth of an iron
                    // one, so a filling takes ten times as many.
                    const need = mouldLumps(def, METAL_BY_LUMP.get(lump.id)?.id ?? '');
                    return {
                      label: `${METAL_BY_LUMP.get(lump.id)?.name ?? itemName(lump)} (${lump.count}) · ${need} needed`,
                      note: storedIn(k),
                      hint: reason ?? undefined,
                      disabled: !!reason,
                      onSelect: () => g.requestAction(pourDef, t),
                    };
                  }),
                };
              })
            : undefined,
      });
    }
    for (const id of ['light_smelter', 'damp_smelter', 'smelter_take_all', 'take_ashes_smelter', 'pick_up_smelter']) {
      const def = ACTION_BY_ID.get(id);
      if (!def || !def.applies(st, g)) continue;
      const reason = def.check?.(st, g) ?? null;
      entries.push({ label: def.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(def, st) });
    }
    if (s.jobs.length) {
      const job = s.jobs[0];
      entries.push({ label: `In the furnace: ${jobName(job)}`, note: `${Math.ceil(job.left)}s left, ${s.jobs.length} in all`, disabled: true });
    }
    if (s.output.length) entries.push({ label: `Finished: ${s.output.map((o) => `${o.count > 1 ? `${o.count} × ` : ''}${itemName(o).toLowerCase()}`).join(', ')}`, disabled: true });
    return entries;
  }

  /**
   * How loaded a rack is, in one line: spots taken, and the gross of what is
   * in the crates standing on it. A rack holds nothing itself, so without
   * this it reads as a piece of furniture with nothing in it however full it
   * is. Asked for as "show inventory gross (x/x)".
   */
  private rackLine(f: PlacedFurniture): string {
    const load = this.game.rackLoad(f);
    if (!load.crates) return `no crates on it · room for ${load.spots}`;
    return `${load.crates} of ${load.spots} spots · ${load.units} / ${load.capacity} things`;
  }

  /** Opening, emptying and lifting a piece of furniture. */
  private furnitureEntries(f: PlacedFurniture): MenuItem[] {
    const g = this.game;
    const ft: Target = { kind: 'furniture', id: f.id };
    const def = furnitureDef(f.kind);
    const entries: MenuItem[] = [];
    // The stone table: kneel at it, and spend what kneeling banks.
    if (def.altar) {
      const pray = ACTION_BY_ID.get('pray');
      entries.push({ label: `Favour ${Math.floor(g.player.favour)} of ${Math.floor(favourCap(g.skills.get(FAITH)))}`, disabled: true });
      if (pray) {
        const why = pray.check?.(ft, g) ?? null;
        entries.push({ label: 'Pray', hint: why ?? undefined, disabled: !!why, onSelect: () => g.requestAction(pray, ft) });
      }
      const cast = ACTION_BY_ID.get('cast');
      if (cast) {
        entries.push({
          label: 'Call on it',
          children: CASTS.map((c) => {
            const wantsItem = c.on === 'item';
            const targets = wantsItem ? g.inventory.items.filter((it) => canImprove(it.id) || it.dmg > 0) : [];
            const plain: Target = { kind: 'tile', x: f.x, y: f.y, cx: 0, cy: 0, spell: c.id };
            const why = cast.check?.(wantsItem ? { kind: 'item', uid: targets[0]?.uid ?? -1, spell: c.id } : plain, g) ?? null;
            return {
              label: c.name,
              note: `${c.cost} favour · prayer ${c.level}`,
              hint: why ?? c.note,
              disabled: !!why && !wantsItem,
              children: wantsItem
                ? targets.slice(0, 20).map((it) => {
                    const t: Target = { kind: 'item', uid: it.uid, spell: c.id };
                    const reason = cast.check?.(t, g) ?? null;
                    return {
                      label: itemName(it),
                      note: it.bless ? `already ${it.bless} of 3` : it.dmg > 0 ? `damage ${it.dmg.toFixed(1)}` : undefined,
                      hint: reason ?? undefined,
                      disabled: !!reason,
                      onSelect: () => g.requestAction(cast, t),
                    };
                  })
                : undefined,
              onSelect: wantsItem ? undefined : () => g.requestAction(cast, plain),
            };
          }),
        });
      }
    }
    if (furnitureHolds(f)) {
      const heft = furnitureHeft(f);
      const note = heft ? `${furnitureKg(f).toFixed(0)} / ${heft} kg` : `${furnitureUnits(f)} / ${furnitureCapacity(f)} things`;
      entries.push({ label: 'Open', note, onSelect: () => this.cratePanel.openFurniture(f.id) });
    }
    /*
     * A rack, and the crates standing on it.
     *
     * Reported as "no way to add crates to crate shelf", and there was not:
     * the rules have known about racks since the thing was built —
     * `place_crate` skips the ground rules on a deck and refuses anything but
     * a plank crate on the runners — but the only way to reach that action was
     * the *tile* menu, and a click on a tile with furniture on it never gets
     * that far. The same went for what was standing on it: a crate on a deck
     * is drawn by the rack rather than as an entity of its own, so there was
     * nothing to click.
     *
     * So the rack's own menu is where it is loaded and where what is on it is
     * reached. Spots fill in `rackDeck` order, which is the order the model
     * draws them in, so a rack three full looks three full.
     */
    if (rackSpots(f)) {
      const deck = rackDeck(f);
      const on = g.cratesOn(f);
      const free = deck.find(([sx, sy]) => !g.crateAt(f.x, f.y, sx, sy));
      entries.push({ label: this.rackLine(f), disabled: true });
      const placeDef = ACTION_BY_ID.get('place_crate');
      const carried = g.inventory.items.filter((it) => crateKindOfItem(it.id));
      if (placeDef) {
        for (const it of carried) {
          const pt: Target = { kind: 'tile', x: f.x, y: f.y, cx: f.x, cy: f.y, sx: free?.[0] ?? 0, sy: free?.[1] ?? 0, itemUid: it.uid };
          const reason = free ? placeDef.check?.(pt, g) ?? null : 'Every spot on it is taken.';
          entries.push({
            label: `Put ${itemName(it).toLowerCase()} on it`,
            note: reason ? undefined : `spot ${on.length + 1} of ${rackSpots(f)}`,
            hint: reason ?? undefined,
            disabled: !!reason,
            onSelect: () => g.requestAction(placeDef, pt),
          });
        }
      }
      for (const c of on) {
        const ct: Target = { kind: 'crate', id: c.id };
        const children: MenuItem[] = [{ label: 'Open', onSelect: () => this.cratePanel.open(c.id) }];
        for (const id of ['crate_take_all', 'pick_up_crate']) {
          const d = ACTION_BY_ID.get(id);
          if (!d) continue;
          const reason = d.check?.(ct, g) ?? null;
          children.push({ label: d.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(d, ct) });
        }
        children.push(...this.nameEntry(ct));
        entries.push({ label: crateName(c), note: `${crateUnits(c)} / ${crateCapacity(c)} things`, children });
      }
    }
    // An oven is fed and lit like a fire, and cooks like one.
    if (def.hearth) {
      const fuelDef = ACTION_BY_ID.get('fuel_oven');
      const wood = g.stockChoices((it) => isFuel(it.id));
      if (fuelDef && wood.length) entries.push({ label: 'Fuel', children: wood.map((s) => this.stackRow(fuelDef, ft, s)) });
      if (f.lit) entries.push({ label: 'Cook', children: this.cookEntries() });
    }
    // A barrel of water is where every brew starts.
    const brewDef = ACTION_BY_ID.get('start_brew');
    if (brewDef && brewDef.applies(ft, g) && !(f.ferment ?? 0)) {
      entries.push({
        label: 'Set a brew going',
        children: BREWS.map((b) => {
          const bt: Target = { ...ft, brew: b.id } as Target;
          const reason = brewDef.check?.(bt, g) ?? null;
          return {
            label: b.name,
            note: `${b.count} × ${itemDef(b.input).name.toLowerCase()} · ${b.litres} litres · ${Math.round(b.time / 60)}m`,
            hint: reason ?? undefined,
            disabled: !!reason,
            onSelect: () => g.requestAction(brewDef, bt),
          };
        }),
      });
    }
    for (const id of ['light_oven', 'put_out_oven', 'take_ashes_oven', 'sleep', 'set_home', 'pull_cart', 'drop_cart', 'board_vehicle', 'leave_vehicle', 'unhitch_team', 'drink_from_vessel', 'empty_vessel', 'furniture_take_all', 'crate_follow', 'crate_work', 'pick_up_furniture']) {
      const def = ACTION_BY_ID.get(id);
      if (!def || !def.applies(ft, g)) continue;
      const reason = def.check?.(ft, g) ?? null;
      entries.push({ label: def.labelFor?.(ft, g) ?? def.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(def, ft) });
    }
    return entries;
  }

  /** Fuelling, packing and unloading a kiln. */
  private kilnEntries(k: PlacedKiln): MenuItem[] {
    const g = this.game;
    const kt: Target = { kind: 'kiln', id: k.id };
    const entries: MenuItem[] = [];
    // Fuel and clay from the same stock a craft spends, stores within reach included.
    const fuelDef = ACTION_BY_ID.get('fuel_kiln');
    const fuel = g.stockChoices((it) => isFuel(it.id));
    if (fuelDef && fuel.length) entries.push({ label: 'Fuel', children: fuel.map((s) => this.stackRow(fuelDef, kt, s)) });
    const loadDef = ACTION_BY_ID.get('load_kiln');
    const green = g.stockChoices((it) => isGreenware(it.id));
    if (loadDef) {
      entries.push({
        label: 'Fire clay',
        disabled: !green.length,
        hint: green.length ? undefined : noneAtHand(g, 'no unfired clay'),
        children: green.length ? green.map((s) => this.stackRow(loadDef, kt, s)) : undefined,
      });
    }
    for (const id of ['light_kiln', 'damp_kiln', 'kiln_take_all', 'take_ashes_kiln', 'pick_up_kiln']) {
      const def = ACTION_BY_ID.get(id);
      if (!def || !def.applies(kt, g)) continue;
      const reason = def.check?.(kt, g) ?? null;
      entries.push({ label: def.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(def, kt) });
    }
    if (k.jobs.length) {
      const job = k.jobs[0];
      entries.push({ label: `In the kiln: ${itemDef(job.makes).name.toLowerCase()}`, note: `${Math.ceil(job.left)}s left, ${k.jobs.length} in all`, disabled: true });
    }
    if (k.output.length) entries.push({ label: `Fired: ${k.output.map((o) => `${o.count > 1 ? `${o.count} × ` : ''}${itemName(o).toLowerCase()}`).join(', ')}`, disabled: true });
    return entries;
  }

  /** Beating a filled mould out on an anvil. */
  /** Setting a wildermon to a post, calling it off, and pulling the post up. */
  private postEntries(p: PlacedPost): MenuItem[] {
    const g = this.game;
    const pt: Target = { kind: 'post', id: p.id };
    const entries: MenuItem[] = [];
    const worker = p.worker !== null ? g.creatures.get(p.worker) : undefined;
    const reach = postRadius(p.ql);
    entries.push({ label: `QL ${p.ql.toFixed(0)} · reaches ${reach} tiles · ${postState(p)}`, disabled: true });
    if (worker) {
      const def = SPECIES[worker.species];
      entries.push({ label: `${worker.name} works out of it`, note: def.gathers ? GATHER_VERB[def.gathers] : 'no job', disabled: true });
    } else {
      const assign = ACTION_BY_ID.get('assign_post');
      const candidates = postCandidates(g);
      if (assign) {
        entries.push({
          label: 'Set a wildermon to it',
          disabled: !candidates.length,
          hint: candidates.length ? undefined : 'You have no wildermon free to set to it.',
          children: candidates.length
            ? candidates.map((c) => {
                const ct: Target = { kind: 'post', id: p.id, creatureId: c.id };
                const reason = assign.check?.(ct, g) ?? null;
                const def = SPECIES[c.species];
                return {
                  label: c.name,
                  note: def.gathers ? GATHER_DO[def.gathers].split(' and ')[0] : 'no job',
                  hint: reason ?? undefined,
                  disabled: !!reason,
                  onSelect: () => g.requestAction(assign, ct),
                };
              })
            : undefined,
        });
      }
    }
    for (const id of ['unassign_post', 'pick_up_post']) {
      const def = ACTION_BY_ID.get(id);
      if (!def || !def.applies(pt, g)) continue;
      const reason = def.check?.(pt, g) ?? null;
      entries.push({ label: def.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(def, pt) });
    }
    return entries;
  }

  /** Working on a bridge, or taking it down again. */
  private bridgeEntries(b: Bridge): MenuItem[] {
    const g = this.game;
    const bt: Target = { kind: 'bridge', id: b.id };
    const def = bridgeDef(b);
    const entries: MenuItem[] = [];
    const open = b.spans.find((s) => !isDone(s));
    entries.push({ label: `${b.spans.length} spans · ${def.carts ? 'carries a cart' : 'foot traffic only'}`, disabled: true });
    if (open) entries.push({ label: `The open span wants ${spanWants(open)}`, disabled: true });
    for (const id of ['build_bridge', 'demolish_bridge']) {
      const a = ACTION_BY_ID.get(id);
      if (!a || !a.applies(bt, g)) continue;
      const reason = a.check?.(bt, g) ?? null;
      entries.push({ label: a.labelFor?.(bt, g) ?? a.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(a, bt) });
    }
    return entries;
  }

  /** Baiting a trap, taking what is in it, letting it go, and taking it up. */
  private trapEntries(t: PlacedTrap): MenuItem[] {
    const g = this.game;
    const tt: Target = { kind: 'trap', id: t.id };
    const entries: MenuItem[] = [];
    const def = trapDef(t);
    entries.push({
      label: def.water ? `QL ${t.ql.toFixed(0)} · holds ${def.hold ?? 8} fish` : `QL ${t.ql.toFixed(0)} · holds to taming ${trapHolds(t)} · reaches ${def.reach} tiles`,
      disabled: true,
    });
    const held = t.caught !== null ? g.creatures.get(t.caught) : undefined;
    if (held) {
      const s = SPECIES[held.species];
      entries.push({ label: `A ${s?.name.toLowerCase() ?? 'thing'} is held in it`, note: `taming ${s?.tameLevel ?? 1} to handle`, disabled: true });
    }
    const bait = ACTION_BY_ID.get('bait_trap');
    if (bait && bait.applies(tt, g)) {
      const choices = baitInPack(g);
      const reason = bait.check?.(tt, g) ?? null;
      entries.push({
        label: t.bait ? `Change the bait (${itemName(t.bait).toLowerCase()})` : 'Bait it',
        disabled: !!reason,
        hint: reason ?? undefined,
        children: choices.length
          ? choices.slice(0, 12).map((it) => {
              const comers = Object.values(SPECIES).filter((sp) => isBaitFor(sp, it.id) && sp.tameLevel <= trapHolds(t));
              const fishy = BAIT_BY_ID.get(it.id);
              return {
                label: itemName(it),
                note: def.water
                  ? fishy ? fishy.favours.map((f) => itemDef(f).name.toLowerCase()).join(', ') : 'nothing comes to that'
                  : comers.length ? comers.map((sp) => sp.name).slice(0, 4).join(', ') : 'nothing this will hold',
                onSelect: () => {
                  // Put the chosen one at the front so the action picks it up.
                  const idx = g.inventory.items.indexOf(it);
                  if (idx > 0) g.inventory.items.splice(0, 0, ...g.inventory.items.splice(idx, 1));
                  g.requestAction(bait, tt);
                },
              };
            })
          : undefined,
      });
    }
    for (const id of ['empty_creel', 'take_catch', 'free_catch', 'pick_up_trap']) {
      const a = ACTION_BY_ID.get(id);
      if (!a || !a.applies(tt, g)) continue;
      const reason = a.check?.(tt, g) ?? null;
      entries.push({ label: a.labelFor?.(tt, g) ?? a.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(a, tt) });
    }
    return entries;
  }

  private anvilEntries(a: PlacedAnvil): MenuItem[] {
    const g = this.game;
    const at: Target = { kind: 'anvil', id: a.id };
    const entries: MenuItem[] = [];
    const smithDef = ACTION_BY_ID.get('smith');
    // Castings poured at the smelter, each named for the piece it is of, and
    // the metal for coins: from the pack, a bag, or a store within reach.
    const castings = g.stockChoices(isCasting);
    const lumps = g.stockChoices((it) => isLump(it.id));
    if (smithDef) {
      entries.push({
        label: 'Smith',
        disabled: !castings.length,
        hint: castings.length ? undefined : 'Pour a mould at the smelter first.',
        children: castings.length
          ? castings.map((s) => {
              const c = s.item;
              const def = MOULD_BY_MAKES.get(c.piece as string);
              const t: Target = { ...at, itemUid: c.uid };
              const reason = smithDef.check?.(t, g) ?? null;
              const where = storedIn(s);
              return {
                label: `${itemName(c)} (${c.count})`,
                note: def ? `${def.per && def.per > 1 ? `${def.per} ` : 'a '}${itemDef(def.makes).name.toLowerCase()} · QL ${c.ql.toFixed(0)}${where ? ` · ${where}` : ''}` : where,
                hint: reason ?? undefined,
                disabled: !!reason,
                onSelect: () => g.requestAction(smithDef, t),
              };
            })
          : undefined,
      });
    }
    // Coins: a die in the pack, and a lump of silver or gold named off the menu.
    const strikeDef = ACTION_BY_ID.get('strike_coins');
    const die = g.inventory.find('coin_die');
    const precious = lumps.filter((s) => COIN_METALS.includes(METAL_BY_LUMP.get(s.item.id)?.id ?? ''));
    if (strikeDef) {
      entries.push({
        label: 'Strike coins',
        disabled: !die || !precious.length,
        hint: !die ? 'You need a coin die.' : !precious.length ? 'Coins are struck from silver or gold.' : undefined,
        note: die ? `${Math.ceil((100 - die.dmg) / DIE_WEAR)} strikes left in the die` : undefined,
        children:
          die && precious.length
            ? precious.map((s) => {
                const lump = s.item;
                const t: Target = { ...at, itemUid: lump.uid };
                const reason = strikeDef.check?.(t, g) ?? null;
                return { label: `${METAL_BY_LUMP.get(lump.id)?.name ?? itemName(lump)} (${lump.count})`, note: storedIn(s), hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(strikeDef, t) };
              })
            : undefined,
      });
    }
    const up = ACTION_BY_ID.get('pick_up_anvil');
    if (up) entries.push({ label: up.label, onSelect: () => g.requestAction(up, at) });
    return entries;
  }

  /**
   * A settlement you were asked onto: what you are on it, and the way off it.
   *
   * It used to get the founder's menu -- its wildermon, an upgrade, a new
   * name, disbanding -- all of which the island refuses to anybody but the
   * founder, and nothing that would take you off the roll. Leaving was a line
   * at the foot of the People window's settlement page and nowhere else.
   * Asked for: "add a leave settlement option so citizens can quit
   * oceanport".
   */
  private citizenEntry(d: Deed): MenuItem {
    const holder = this.holderOf(d);
    return {
      label: `${d.name}${holder ? ` \u00b7 ${holder}\u2019s` : ''}`,
      children: [
        { label: standingWord(d.role), disabled: true },
        {
          label: `Leave ${d.name}`,
          note: 'Takes you off its roll',
          hint: this.island ? undefined : 'Only on an island.',
          disabled: !this.island,
          onSelect: () => void this.leaveSettlement(d),
        },
      ],
    };
  }

  /** Who founded a settlement you belong to, as the island names them. */
  private holderOf(d: Deed): string | null {
    return this.game.neighbourDeeds.find((n) => n.x === d.x && n.y === d.y)?.holder ?? null;
  }

  /** Off the roll of one you were asked onto, once you have said you mean it. */
  private async leaveSettlement(d: Deed): Promise<void> {
    const isle = this.island;
    if (!isle) return;
    if (!(await this.game.hooks.confirm(leaveQuestion(d, this.holderOf(d))))) return;
    // Said by the island when it is done, in the log: "You are no longer a
    // citizen of ...". Only a refusal is said here.
    const why = await isle.leaveDeedAt(d.x, d.y);
    if (why) this.game.logMsg(why, 'error');
  }

  /** The settlement menu: its wildermon, its upgrade, its name. */
  private deedEntry(): MenuItem {
    const g = this.game;
    const d = g.deed!;
    const level = g.deedLevel;
    const kept = [...g.creatures.list.values()].filter((c) => c.mode === 'deed');
    const children: MenuItem[] = [];
    const workers = g.creatures.workers().length;
    children.push({
      label: `Wildermon (${workers} of ${g.workerCap} working)`,
      disabled: !kept.length,
      hint: kept.length ? undefined : 'None working here yet.',
      children: kept.length ? kept.map((c) => ({ label: `${c.name} (${g.creatures.describe(c)})`, children: this.creatureEntries(c.id) })) : undefined,
    });
    const upgrade = DEED_ACTION_BY_ID.get('upgrade_deed');
    if (upgrade) {
      const reason = upgradeReason(g);
      const progress = upgradeProgress(g);
      const t: Target = { kind: 'tile', x: d.x, y: d.y, cx: d.x, cy: d.y };
      children.push({
        label: level < MAX_DEED_LEVEL ? `Upgrade to level ${level + 1}` : `Level ${level}, fully grown`,
        note: level < MAX_DEED_LEVEL ? `Border ${d.radius + 2} tiles, ${deedWorkersAt(level + 1)} workers` : undefined,
        hint: reason ?? undefined,
        disabled: !!reason,
        onSelect: () => g.requestAction(upgrade, t),
      });
      for (const r of progress) children.push({ label: `${r.met ? '✓' : '✗'} ${r.label}`, disabled: true });
    }
    // Standing orders for everything kept here.
    const stance = g.deedStance();
    children.push({
      label: `Orders: ${STANCE_NAMES[stance]}`,
      note: 'Applies to every wildermon on the deed',
      children: STANCES.map((st) => ({
        label: st === stance ? `${STANCE_NAMES[st]} (current)` : STANCE_NAMES[st],
        note: st === 'aggressive' ? 'Goes for anything wild that crosses the border' : st === 'defensive' ? 'Fights back when it or you are attacked' : 'Never fights, whatever walks in',
        onSelect: () => g.setDeedStance(st),
      })),
    });
    for (const id of ['rename_deed', 'disband_deed']) {
      const def = ACTION_BY_ID.get(id);
      if (!def) continue;
      const t: Target = { kind: 'tile', x: d.x, y: d.y, cx: d.x, cy: d.y };
      children.push({ label: def.label, onSelect: () => g.requestAction(def, t) });
    }
    return { label: `${d.name} · level ${level}`, children };
  }

  /** Actions for a wildermon: taming and feeding, or for a tamed one its stance, job and home. */
  private creatureEntries(id: number): MenuItem[] {
    const g = this.game;
    const c = g.creatures.get(id);
    if (!c) return [];
    const target: Target = { kind: 'creature', id };
    const entries: MenuItem[] = [];
    const item = (actionId: string, t: Target = target, label?: string): MenuItem | null => {
      const def = CREATURE_ACTION_BY_ID.get(actionId) ?? CREATURE_CRATE_ACTION_BY_ID.get(actionId);
      if (!def || !def.applies(t, g)) return null;
      const reason = def.check?.(t, g) ?? null;
      return { label: label ?? def.labelFor?.(t, g) ?? def.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(def, t) };
    };
    const push = (m: MenuItem | null): void => {
      if (m) entries.push(m);
    };
    push(item('examine_creature'));
    push(item('tame', target, `Tame (uses ${baitHint(c)})`));
    // One in a crate is let out by opening the crate it is in, standing or carried.
    if (c.mode === 'stored') {
      const h = crateOf(g, c.id);
      const at: Target | null = h && 'piece' in h ? { kind: 'furniture', id: h.piece.id }
        : h?.carried ? { kind: 'item', uid: h.item.uid } : null;
      if (at) {
        push(item('crate_follow', at));
        push(item('crate_work', at));
      }
    }
    if (c.mode === 'active') {
      entries.push({
        label: `Stance: ${STANCE_NAMES[c.stance]}`,
        children: STANCES.map((s) => ({
          label: s === c.stance ? `${STANCE_NAMES[s]} (current)` : STANCE_NAMES[s],
          note: STANCE_HINTS[s],
          onSelect: () => {
            const def = CREATURE_ACTION_BY_ID.get('set_stance');
            if (def) g.requestAction(def, { ...target, stance: s });
          },
        })),
      });
    }
    if (c.mode === 'active' || c.mode === 'deed') {
      const def = SPECIES[c.species];
      const food = g.inventory.items.filter((it) => isBaitFor(def, it.id));
      if (food.length) {
        entries.push({
          label: 'Feed',
          children: food.map((it) => ({ label: it.count > 1 ? `${itemName(it)} (${it.count})` : itemName(it), onSelect: () => g.requestAction(CREATURE_ACTION_BY_ID.get('feed') as ActionDef, { ...target, itemUid: it.uid }) })),
        });
      } else push(item('feed'));
    }
    if ((SPECIES[c.species].pannier ?? 0) > 0 && c.mode !== 'wild' && c.mode !== 'stored') {
      entries.push({ label: 'Open the panniers', onSelect: () => this.cratePanel.openPannier(c.id) });
    }
    push(item('milk_creature'));
    push(item('tack_creature'));
    push(item('mount_creature'));
    push(item('dismount_creature'));
    push(item('untack_creature'));
    push(item('hitch_creature'));
    push(item('unhitch_creature'));
    // A species with more than one trade is set to one of them by name, and
    // which is your say. None has more than one at the moment; the door stays.
    {
      const def = CREATURE_ACTION_BY_ID.get('assign_deed');
      const trades = SPECIES[c.species]?.trades;
      if (def && trades && trades.length > 1 && def.applies(target, g)) {
        entries.push({
          label: def.label,
          children: trades.map((trade) => {
            const tt: Target = { ...target, job: trade };
            const why = def.check?.(tt, g) ?? null;
            const does = GATHER_DO[trade];
            return { label: does.charAt(0).toUpperCase() + does.slice(1), hint: why ?? undefined, disabled: !!why, onSelect: () => g.requestAction(def, tt) };
          }),
        });
      } else {
        push(item('assign_deed'));
      }
    }
    push(item('take_creature'));
    push(item('crate_creature'));
    push(item('rename_creature'));
    push(item('release_creature'));
    push(item('cull_creature'));
    push(item('attack_creature'));
    return entries;
  }

  /** "Give it a name", for anything that will take one. */
  /**
   * Founding a settlement, on the ground rather than in a pocket.
   *
   * The action hangs off the stake, so the only way to it was to open the
   * inventory and right-click the thing — which on a phone, with no right
   * button and a window to go and find, is a way of hiding it. Reported as
   * "cant place a deed despite having a stake".
   *
   * On the tile you are standing on, because that is where the token goes: the
   * island founds it at your feet whatever you clicked, and an entry on some
   * other tile would be an offer it was not going to keep.
   */
  private settlementEntry(pick: Pick): MenuItem[] {
    const g = this.game;
    const stake = g.inventory.items.find((it) => it.id === 'deed_stake');
    const def = ACTION_BY_ID.get('found_settlement');
    if (!stake || !def) return [];
    /*
     * Offered wherever you pick, rather than only underfoot.
     *
     * It used to return nothing at all unless the tile you clicked was the one
     * you were standing on — right about where the token goes, and useless on
     * a phone, where that tile is underneath your own body and a thumb cannot
     * reach it. There was no entry, greyed or otherwise, and nothing to say
     * why. The action walks you there first now.
     */
    const t: Target = { kind: 'tile', x: pick.x, y: pick.y, cx: pick.x, cy: pick.y };
    const here = pick.x === g.player.tileX && pick.y === g.player.tileY;
    const reason = def.check?.(t, g) ?? null;
    return [{
      label: 'Found a settlement here',
      note: reason ? undefined : here ? 'Drives the stake where you stand' : 'Walks you there, then drives the stake in',
      hint: reason ?? undefined,
      disabled: !!reason,
      // The name is asked for by `requestAction`, which every other way of
      // starting this action also goes through — this entry used to be the
      // only one that knew to ask, which is how the island came to be handed a
      // settlement with no name on it and called it Homestead.
      onSelect: () => g.requestAction(def, t),
    }];
  }

  /**
   * What you can do to a person, which until now was nothing at all.
   *
   * Everything else on this canvas is picked and then acted on through the
   * game: a tile, a creature, a crate. A person is not in the game — the
   * roster is a name and a pose and nothing the simulation reads — so these go
   * straight to the island, which is the only thing that knows who they are.
   *
   * Written in the second person like every other menu here, and each one says
   * what it would do rather than what it is called: *ask Ivar to live at
   * Ravenhold* is the whole sentence, and it is the label.
   */
  private personMenu(uid: string): { title: string; facts?: string[]; entries: MenuItem[] } {
    const who = this.game.roster.list().find((p) => p.uid === uid);
    const name = who?.name ?? 'Somebody';
    const isle = this.island;
    if (!isle) {
      return { title: name, entries: [{ label: 'Nothing to be done', disabled: true, hint: 'There is no island here to ask.', onSelect: () => {} }] };
    }
    const said = (what: Promise<string | null>): void => {
      void what.then((why) => {
        if (why) this.game.logMsg(why, 'error');
      });
    };
    const entries: MenuItem[] = [];
    /*
     * First, because it is the only one of these that is about being in the
     * same place as somebody, and being in the same place is what the rest of
     * them are usually for. It is also the only one this machine answers by
     * itself — everything below goes to the island.
     */
    const after = this.game.following(uid);
    entries.push({
      label: after ? `Stop following ${name}` : `Follow ${name}`,
      note: after ? 'You are walking after them' : 'Walk after them until you go somewhere else',
      onSelect: () => this.game.follow(uid, name),
    });
    const deed = this.game.deed;
    if (deed) {
      entries.push({
        label: `Invite ${name} to ${deed.name}`,
        note: 'They may build and store here',
        onSelect: () => said(isle.invite(uid)),
      });
    }
    entries.push({
      label: `Ask ${name} to be a friend`,
      note: 'You will see where each other are',
      onSelect: () => said(isle.befriend(uid)),
    });
    entries.push({
      label: `Write to ${name}`,
      note: 'Kept, and read whenever they next look',
      onSelect: () => this.social.openOn(uid, 'letters'),
    });
    entries.push({ label: 'Everybody…', onSelect: () => this.social.openOn(uid, 'friends') });
    return {
      title: name,
      facts: [who ? `${name} is standing at ${Math.floor(who.x)}, ${Math.floor(who.y)}.` : `${name} is on this island.`],
      entries,
    };
  }

  private nameEntry(t: Target): MenuItem[] {
    const def = ACTION_BY_ID.get('name_thing');
    if (!def || !def.applies(t, this.game)) return [];
    return [{ label: def.labelFor?.(t, this.game) ?? def.label, onSelect: () => this.game.requestAction(def, t) }];
  }

  /** Planning and construction entries for a tile: footprint, walls on the nearest side, floors, storeys. */
  private buildingEntries(pick: Pick): MenuItem[] {
    const g = this.game;
    const bld = g.buildings;
    const { x, y } = pick;
    const entries: MenuItem[] = [];
    const act = (id: string): ActionDef => {
      const def = BUILD_ACTION_BY_ID.get(id);
      if (!def) throw new Error(`unknown building action ${id}`);
      return def;
    };
    const base: Target = { kind: 'tile', x, y, cx: pick.cx, cy: pick.cy };
    const item = (def: ActionDef, target: Target, label = def.label): MenuItem => {
      const reason = def.check?.(target, g) ?? null;
      return { label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(def, target) };
    };
    const b = bld.buildingAt(x, y);
    if (!b) {
      // No building here: a fence or a half wall still goes on any border,
      // and the border is decided by which edge of the tile was clicked.
      const side = nearestSide(x, y, pick.wx, pick.wy);
      const withSide: Target = { ...base, side };
      const standing = bld.wall(0, x, y, side);
      if (standing) {
        const what = WALL_TYPE_BY_ID.get(standing.type)?.name ?? 'Fence';
        if (!isDone(standing)) entries.push(item(act('build_wall'), withSide, `Build ${what.toLowerCase()} (${SIDE_NAMES[side]}) · needs ${describeNeeds(standing, materialName)}`));
        entries.push(item(act('remove_wall'), withSide, `Remove ${what.toLowerCase()} (${SIDE_NAMES[side]})`));
      } else {
        const fence = act('plan_fence');
        const probe = fence.check?.({ ...withSide, wallType: 'fence', material: 'log' }, g) ?? null;
        if (probe) entries.push({ label: `Plan fence (${SIDE_NAMES[side]})`, hint: probe, disabled: true });
        else {
          entries.push({
            label: `Plan fence (${SIDE_NAMES[side]})`,
            children: FENCE_TYPES.map((wt) => ({
              label: wt.name,
              children: MATERIALS.map((m) => ({
                label: m.name,
                note: describeNeeds(wallBill(m.id, wt.id), materialName),
                onSelect: () => g.requestAction(fence, { ...withSide, wallType: wt.id, material: m.id }),
              })),
            })),
          });
        }
      }
      if (!g.onDeed(x, y)) return entries;
      const nb = bld.neighbourBuilding(x, y);
      if (nb) entries.push(item(act('add_to_building'), base, `Add to ${nb.name}`));
      entries.push(item(act('plan_building'), base));
      return entries;
    }
    const level = workLevel(b);
    const side = nearestSide(x, y, pick.wx, pick.wy);
    const sideName = SIDE_NAMES[side];
    const withSide: Target = { ...base, side };
    if (b.levels > 1) {
      entries.push({
        label: `Work on storey ${level + 1}`,
        children: Array.from({ length: b.levels }, (_, i) => ({
          label: i === level ? `Storey ${i + 1} (current)` : `Storey ${i + 1}`,
          onSelect: () => {
            b.workLevel = i;
          },
        })),
      });
    }
    const wall = bld.wall(level, x, y, side);
    if (wall) {
      if (!isDone(wall)) entries.push(item(act('build_wall'), withSide, `Build wall (${sideName}) · needs ${describeNeeds(wall, materialName)}`));
      entries.push(item(act('remove_wall'), withSide, `Remove wall (${sideName})`));
    } else {
      const plan = act('plan_wall');
      const probe = plan.check?.({ ...withSide, wallType: 'solid', material: 'log' }, g) ?? null;
      if (probe) entries.push({ label: `Plan wall (${sideName})`, hint: probe, disabled: true });
      else {
        entries.push({
          label: `Plan wall (${sideName})`,
          children: WALL_TYPES.map((wt) => ({
            label: wt.name,
            children: MATERIALS.map((m) => ({
              label: m.name,
              note: describeNeeds(wallBill(m.id, wt.id), materialName),
              onSelect: () => g.requestAction(plan, { ...withSide, wallType: wt.id, material: m.id }),
            })),
          })),
        });
      }
    }
    const floor = bld.floor(level, x, y);
    const plan = act('plan_floor');
    if (floor) {
      const what = floorKind(floor) === 'floor' && level === 0 ? 'flooring' : FLOOR_KIND_NAMES[floorKind(floor)];
      if (!isDone(floor)) entries.push(item(act('build_floor'), base, `Build ${what} · needs ${describeNeeds(floor, materialName)}`));
      entries.push(item(act('remove_floor'), base, `Remove ${what}`));
    } else {
      const floorLabel = level > 0 ? 'floor' : 'flooring';
      const probe = plan.check?.({ ...base, material: 'log' }, g) ?? null;
      if (probe) entries.push({ label: `Plan ${floorLabel}`, hint: probe, disabled: true });
      else {
        entries.push({
          label: `Plan ${floorLabel}`,
          children: MATERIALS.map((m) => ({
            label: m.name,
            note: describeNeeds(floorBill(m.id), materialName),
            onSelect: () => g.requestAction(plan, { ...base, material: m.id, floorKind: 'floor' }),
          })),
        });
        if (level > 0) {
          const stairs = plan.check?.({ ...withSide, material: 'log', floorKind: 'stairs' }, g) ?? null;
          if (stairs) entries.push({ label: `Plan staircase (up from the ${sideName})`, hint: stairs, disabled: true });
          else {
            // The side to climb from is chosen on the tile: Q and E turn it, a click plans it.
            entries.push({
              label: 'Plan staircase',
              children: MATERIALS.map((m) => ({
                label: m.name,
                note: `${describeNeeds(floorBill(m.id, 'stairs'), materialName)} · Q and E choose the side`,
                onSelect: () => this.startPlacingStairs(base, level, m.id, 'stairs', side),
              })),
            });
            entries.push({
              label: 'Plan ladder',
              note: `${describeNeeds(floorBill('plank', 'ladder'), materialName)} · Q and E choose the side`,
              onSelect: () => this.startPlacingStairs(base, level, 'plank', 'ladder', side),
            });
          }
        }
      }
    }
    const roof = bld.floor(b.levels, x, y);
    const roofTarget: Target = { ...base, floorKind: 'roof' };
    if (roof) {
      if (!isDone(roof)) entries.push(item(act('build_floor'), roofTarget, `Build roof · needs ${describeNeeds(roof, materialName)}`));
      entries.push(item(act('remove_floor'), roofTarget, 'Remove roof'));
    } else {
      const probe = plan.check?.({ ...roofTarget, material: 'log' }, g) ?? null;
      if (probe) entries.push({ label: 'Plan roof', hint: probe, disabled: true });
      else {
        entries.push({
          label: 'Plan roof',
          children: MATERIALS.map((m) => ({
            label: m.name,
            note: describeNeeds(floorBill(m.id, 'roof'), materialName),
            onSelect: () => g.requestAction(plan, { ...roofTarget, material: m.id }),
          })),
        });
      }
    }
    entries.push(item(act('add_floor'), base));
    if (b.levels > 1) entries.push(item(act('remove_storey'), base));
    entries.push(item(act('remove_from_plan'), base));
    entries.push(item(act('rename_building'), base));
    return entries;
  }
}
