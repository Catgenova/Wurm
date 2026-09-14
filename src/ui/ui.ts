import type { Game } from '../game/game';
import type { Pick, Renderer } from '../render/renderer';
import { TileType, TREE_DEFS, treeSpecies, treeVariant , SLAB_BY_ITEM } from '../world/tiles';
import { ACTION_BY_ID, type ActionDef, type Target } from '../game/actions';
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
} from '../game/building';
import { baitHint, CREATURE_ACTION_BY_ID } from '../game/creatureActions';
import { isBaitFor, SPECIES, STANCE_HINTS, STANCE_NAMES, STANCES, GATHER_VERB, GATHER_DO } from '../game/creatures';
import { itemDef, itemName, type Item } from '../game/items';
import { nearestSide } from '../render/renderer';
import { crateKindOfItem, crateName, crateCapacity, crateUnits, subtileOf } from '../game/crates';
import { butcherPreview } from '../game/butcher';
import { anvilAnchor, anvilName, type PlacedAnvil } from '../game/anvil';
import { postCandidates, postLife, postName, postRadius, postState, type PlacedPost } from '../game/posts';
import { baitInPack, trapDef, trapHolds, trapLife, trapName, TRAPS, trapState, type PlacedTrap } from '../game/traps';
import { BAIT_BY_ID } from '../game/fishing';
import { BRIDGES, bridgeDef, bridgeName, bridgeState, spanWants, type Bridge } from '../game/bridges';
import { CASTS, FAITH, favourCap } from '../game/faith';
import { abilitiesOf, CHOOSE_AT, MEDITATION, nextStep, PATHS, PATH_LIST, sittingWorth } from '../game/meditation';
import { canImprove } from '../game/improve';
import { BREWS } from '../game/brewing';
import { fireAnchor, fireState, FIRE_COST, isFuel, type PlacedCampfire } from '../game/campfire';
import { isLump, isMould, isOreItem, METAL_BY_LUMP, MOULD_BY_ID, mouldUsesLeft } from '../game/metal';
import { smelterAnchor, smelterState, type PlacedSmelter } from '../game/smelter';
import { isGreenware, kilnAnchor, kilnState, type PlacedKiln } from '../game/kiln';
import { furnitureAnchor, furnitureCapacity, furnitureDef, furnitureName, furnitureState, furnitureUnits, isFurniture, type PlacedFurniture } from '../game/furniture';
import { DEED_ACTION_BY_ID, upgradeProgress, upgradeReason } from '../game/deed';
import { CROP_BY_SEED, cropDef, describeCrop } from '../game/farming';
import { bedrockAt } from '../world/ore';
import { deedWorkersAt, MAX_DEED_LEVEL } from '../game/game';
import { recipeNeeds, recipeReason, recipeStatus, RECIPES } from '../game/recipes';
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
import { Hud } from './hud';
import { buildHelp } from './panels/help';
import { EventLogPanel } from './panels/eventlog';
import { InventoryPanel } from './panels/inventory';
import { MinimapPanel } from './panels/minimap';
import { SkillsPanel } from './panels/skills';
import { Tooltip } from './tooltip';
import { WindowManager } from './windows';

export interface UICallbacks {
  newWorld: () => void;
  /** Quarter-turn the camera: +1 or -1. */
  turn: (step: number) => void;
}

/** Builds and updates every HTML overlay above the canvas. */
export class UI {
  readonly windows: WindowManager;
  readonly menu: ContextMenu;
  readonly tooltip: Tooltip;
  readonly hud: Hud;
  private readonly minimap: MinimapPanel;
  private readonly eventLog: EventLogPanel;
  private readonly settings: SettingsPanel;
  private readonly cratePanel: CratePanel;
  private readonly wildermon: WildermonPanel;
  private readonly stores: StoresPanel;
  private readonly craftPanel: CraftPanel;
  private readonly ledgerPanel: LedgerPanel;
  private readonly deedPanel: DeedPanel;
  private readonly tilePanel: TilePanel;

  constructor(
    private readonly game: Game,
    private readonly renderer: Renderer,
    root: HTMLElement,
    canvas: HTMLCanvasElement,
    cb: UICallbacks,
  ) {
    this.windows = new WindowManager(root);
    this.menu = new ContextMenu(root, canvas);
    this.tooltip = new Tooltip(root);
    this.hud = new Hud(root, game, {
      toggle: (id) => this.toggleWindow(id),
      toggleGrid: () => (game.settings.grid = !game.settings.grid),
      center: () => (renderer.camera.follow = true),
      newWorld: cb.newWorld,
      turn: cb.turn,
      useLoop: (loop) => this.useLoop(loop),
      numbersTaken: () => this.numbersTaken,
    });

    const events = this.windows.create({ id: 'events', title: 'Event', x: 12, y: 12, width: 420, height: 210, anchor: 'bl' });
    this.eventLog = new EventLogPanel(events, game);
    const inventory = this.windows.create({ id: 'inventory', title: 'Inventory', x: 12, y: 56, width: 340, height: 300, anchor: 'tr' });
    new InventoryPanel(inventory, game, this.menu, (p) => this.moveDragged(p, 'inventory'), (uid) => this.cratePanel.openBag(uid));
    const skills = this.windows.create({ id: 'skills', title: 'Skills', x: 364, y: 56, width: 260, height: 380, anchor: 'tr', open: false });
    new SkillsPanel(skills, game);
    const craft = this.windows.create({ id: 'craft', title: 'Crafting', x: 364, y: 56, width: 360, height: 360, anchor: 'tr', open: false });
    this.craftPanel = new CraftPanel(craft, game);
    const tileWin = this.windows.create({ id: 'tile', title: 'Tile', x: 12, y: 200, width: 300, height: 320, open: false });
    this.tilePanel = new TilePanel(tileWin, game, (pick) => this.menuFor(pick), this.tooltip);
    const map = this.windows.create({ id: 'map', title: 'Map', x: 12, y: 370, width: 236, height: 262, anchor: 'tr', open: false });
    this.minimap = new MinimapPanel(map, game, renderer);
    const settings = this.windows.create({ id: 'settings', title: 'Settings', x: 12, y: 640, width: 300, height: 190, anchor: 'tr', open: false });
    this.settings = new SettingsPanel(settings, game);
    const crate = this.windows.create({ id: 'crate', title: 'Deed crate', x: 364, y: 56, width: 320, height: 260, anchor: 'tr', open: false });
    this.cratePanel = new CratePanel(crate, game, (p) => this.moveDragged(p, 'store'));
    const journal = this.windows.create({ id: 'journal', title: 'Journal', x: 12, y: 56, width: 330, height: 420, anchor: 'tr', open: false });
    new JournalPanel(journal, game);
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
    });
    const ledgerWin = this.windows.create({ id: 'ledger', title: 'Ledger', x: 12, y: 56, width: 340, height: 420, anchor: 'tr', open: false });
    this.ledgerPanel = new LedgerPanel(ledgerWin, game);
    const help = this.windows.create({ id: 'help', title: 'Help', x: 0, y: 0, width: 440, height: 460, open: false });
    help.el.style.left = `${Math.max(0, (window.innerWidth - 440) / 2)}px`;
    help.el.style.top = `${Math.max(0, (window.innerHeight - 460) / 2)}px`;
    buildHelp(help);
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
    const refused = store.refuses(held);
    if (refused) {
      g.logMsg(refused, 'error');
      return;
    }
    const item = g.inventory.take(held.uid, held.count);
    if (!item) return;
    if (!store.add(item)) {
      g.inventory.addItem(item);
      g.logMsg(`The ${store.what} will not take the ${p.name.toLowerCase()}.`, 'error');
      return;
    }
    g.logMsg(`You put the ${p.name.toLowerCase()} in the ${store.what}.`, 'event');
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
    this.tilePanel.update(performance.now());
    this.craftPanel.update(performance.now());
    this.ledgerPanel.update(performance.now());
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
      if (furnitureCapacity(fu)) lines.push('Stand next to it to put things away.');
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
      lines.push(`${['Young', 'Mature', 'Old'][treeVariant(data)]} ${TREE_DEFS[treeSpecies(data)].name.toLowerCase()} tree`);
    } else if (growing) {
      lines.push(`${cropDef(growing.id).name} field`);
    } else {
      lines.push(w.tileName(pick.x, pick.y));
    }
    if (growing) lines.push(describeCrop(growing, this.game.time));
    const soil = w.getDirt(pick.cx, pick.cy);
    lines.push(`${pick.x}, ${pick.y} · slope ${w.slope(pick.x, pick.y)} · corner h ${w.getHeight(pick.cx, pick.cy)} · ${soil > 0 ? `${soil} soil over rock` : 'bare rock'}`);
    const rock = bedrockAt(w, pick.x, pick.y);
    const bare = w.getTile(pick.x, pick.y) === TileType.Rock;
    const known = bare || this.game.isProspected(pick.x, pick.y);
    if (known) lines.push(`${rock.name}${rock.ore ? ` · mining ${rock.level}` : ''} · up to QL ${rock.maxQl}${bare ? '' : ', buried'}`);
    const deed = this.game.deed;
    if (deed && this.game.isToken(pick.x, pick.y)) lines.push(`Settlement token of ${deed.name}`);
    else if (deed && this.game.onDeed(pick.x, pick.y)) lines.push(`Part of ${deed.name}`);
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

  showTileMenu(pick: Pick, sx: number, sy: number): void {
    const { title, entries } = this.menuFor(pick);
    this.menu.show(sx, sy, title, entries);
  }

  /**
   * Everything that can be done where you clicked, and what to call it. The
   * right-click menu and the tile window are the same list seen two ways, so
   * neither can fall behind the other.
   */
  menuFor(pick: Pick): { title: string; entries: MenuItem[] } {
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
    if (piece) return { title: `${furnitureName(piece)} (${furnitureState(piece)})`, entries: [...this.furnitureEntries(piece), ...this.nameEntry({ kind: 'furniture', id: piece.id })] };
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
    if (this.game.deed && this.game.onDeed(pick.x, pick.y)) entries.push(this.deedEntry());
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
      const [s0, t0] = subtileOf(pick.x, pick.y, pick.wx, pick.wy);
      entries.push({
        label: 'Set furniture down here',
        children: carried.map((it) => {
          const def = furnitureDef(it.id);
          const [ax, ay] = furnitureAnchor(it.id, s0, t0);
          const ft: Target = { ...target, sx: ax, sy: ay, itemUid: it.uid };
          const reason = placeFurnitureDef.check?.(ft, this.game) ?? null;
          return {
            label: it.count > 1 ? `${itemName(it)} (${it.count})` : itemName(it),
            note: reason ? undefined : `spots ${ax + 1},${ay + 1} to ${ax + def.w},${ay + def.h}`,
            hint: reason ?? undefined,
            disabled: !!reason,
            onSelect: () => this.game.requestAction(placeFurnitureDef, ft),
          };
        }),
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
            onSelect: () => {
              const said = this.game.hooks.prompt('What is this spot called?', here.name);
              if (said !== null) this.game.renameMark(here.id, said);
            },
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
          onSelect: () => {
            const said = this.game.hooks.prompt(`Name this spot (${pick.x}, ${pick.y}):`, '');
            if (said !== null) this.game.addMark(pick.x, pick.y, said, c.id);
          },
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
    return { title, entries };
  }

  /** Feeding, lighting and cooking at a campfire. */
  private campfireEntries(fire: PlacedCampfire): MenuItem[] {
    const g = this.game;
    const ft: Target = { kind: 'campfire', id: fire.id };
    const entries: MenuItem[] = [];
    const fuelDef = ACTION_BY_ID.get('fuel_campfire');
    const wood = g.inventory.items.filter((it) => isFuel(it.id));
    if (fuelDef && wood.length) {
      entries.push({
        label: 'Fuel',
        children: wood.map((it) => ({
          label: it.count > 1 ? `${itemName(it)} (${it.count})` : itemName(it),
          children:
            it.count > 1
              ? [
                  { label: 'One', onSelect: () => g.requestAction(fuelDef, { ...ft, itemUid: it.uid, count: 1 }) },
                  { label: `All (${it.count})`, onSelect: () => g.requestAction(fuelDef, { ...ft, itemUid: it.uid, count: it.count }) },
                ]
              : undefined,
          onSelect: it.count > 1 ? undefined : () => g.requestAction(fuelDef, { ...ft, itemUid: it.uid, count: 1 }),
        })),
      });
    }
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
    return RECIPES.filter((r) => r.station === 'campfire').map((r) => {
      const def = ACTION_BY_ID.get(r.id);
      const st = recipeStatus(r, g);
      const material = g.inventory.find(r.inputs[0].item);
      const reason = def ? recipeReason(r, g) : 'Not possible.';
      return {
        label: `${itemDef(r.result).name}${(r.count ?? 1) > 1 ? ` × ${r.count}` : ''}`,
        note: recipeNeeds(r),
        hint: reason ?? undefined,
        disabled: !!reason || !def || !material,
        onSelect: () => {
          if (def && material) g.requestAction(def, { kind: 'item', uid: material.uid, count: st.max });
        },
      };
    });
  }

  /** Fuelling, charging and drawing off a smelter. */
  private smelterEntries(s: PlacedSmelter): MenuItem[] {
    const g = this.game;
    const st: Target = { kind: 'smelter', id: s.id };
    const entries: MenuItem[] = [];
    const quantity = (def: ActionDef, it: Item, extra: Partial<Target> = {}): MenuItem => ({
      label: it.count > 1 ? `${itemName(it)} (${it.count})` : itemName(it),
      children:
        it.count > 1
          ? [
              { label: 'One', onSelect: () => g.requestAction(def, { ...st, itemUid: it.uid, count: 1, ...extra } as Target) },
              { label: `All (${it.count})`, onSelect: () => g.requestAction(def, { ...st, itemUid: it.uid, count: it.count, ...extra } as Target) },
            ]
          : undefined,
      onSelect: it.count > 1 ? undefined : () => g.requestAction(def, { ...st, itemUid: it.uid, count: 1, ...extra } as Target),
    });
    const fuelDef = ACTION_BY_ID.get('fuel_smelter');
    const fuel = g.inventory.items.filter((it) => isFuel(it.id));
    if (fuelDef && fuel.length) entries.push({ label: 'Fuel', children: fuel.map((it) => quantity(fuelDef, it)) });
    const smeltDef = ACTION_BY_ID.get('smelt_ore');
    const ores = g.inventory.items.filter((it) => isOreItem(it.id));
    if (smeltDef) {
      entries.push({
        label: 'Smelt ore',
        disabled: !ores.length,
        hint: ores.length ? undefined : 'You carry no ore.',
        children: ores.length ? ores.map((it) => quantity(smeltDef, it)) : undefined,
      });
    }
    const castDef = ACTION_BY_ID.get('cast_anvil');
    const lumps = g.inventory.items.filter((it) => isLump(it.id));
    if (castDef && g.inventory.has('anvil_mould')) {
      entries.push({
        label: 'Cast an anvil',
        disabled: !lumps.length,
        hint: lumps.length ? undefined : 'You carry no metal.',
        children: lumps.length
          ? lumps.map((it) => {
              const t: Target = { ...st, itemUid: it.uid };
              const reason = castDef.check?.(t, g) ?? null;
              return { label: `${itemName(it)} (${it.count})`, hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(castDef, t) };
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
      entries.push({ label: `In the furnace: ${itemDef(job.makes).name.toLowerCase()}`, note: `${Math.ceil(job.left)}s left, ${s.jobs.length} in all`, disabled: true });
    }
    if (s.output.length) entries.push({ label: `Finished: ${s.output.map((o) => itemName(o).toLowerCase()).join(', ')}`, disabled: true });
    return entries;
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
    if (furnitureCapacity(f)) {
      entries.push({ label: 'Open', note: `${furnitureUnits(f)} / ${furnitureCapacity(f)} things`, onSelect: () => this.cratePanel.openFurniture(f.id) });
    }
    // An oven is fed and lit like a fire, and cooks like one.
    if (def.hearth) {
      const fuelDef = ACTION_BY_ID.get('fuel_oven');
      const wood = g.inventory.items.filter((it) => isFuel(it.id));
      if (fuelDef && wood.length) {
        entries.push({
          label: 'Fuel',
          children: wood.map((it) => ({
            label: it.count > 1 ? `${itemName(it)} (${it.count})` : itemName(it),
            children:
              it.count > 1
                ? [
                    { label: 'One', onSelect: () => g.requestAction(fuelDef, { ...ft, itemUid: it.uid, count: 1 } as Target) },
                    { label: `All (${it.count})`, onSelect: () => g.requestAction(fuelDef, { ...ft, itemUid: it.uid, count: it.count } as Target) },
                  ]
                : undefined,
            onSelect: it.count > 1 ? undefined : () => g.requestAction(fuelDef, { ...ft, itemUid: it.uid, count: 1 } as Target),
          })),
        });
      }
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
    for (const id of ['light_oven', 'put_out_oven', 'take_ashes_oven', 'sleep', 'set_home', 'pull_cart', 'drop_cart', 'board_vehicle', 'leave_vehicle', 'unhitch_team', 'drink_from_vessel', 'empty_vessel', 'furniture_take_all', 'pick_up_furniture']) {
      const def = ACTION_BY_ID.get(id);
      if (!def || !def.applies(ft, g)) continue;
      const reason = def.check?.(ft, g) ?? null;
      entries.push({ label: def.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(def, ft) });
    }
    return entries;
  }

  /** Fuelling, packing and unloading a kiln. */
  private kilnEntries(k: PlacedKiln): MenuItem[] {
    const g = this.game;
    const kt: Target = { kind: 'kiln', id: k.id };
    const entries: MenuItem[] = [];
    const quantity = (def: ActionDef, it: Item): MenuItem => ({
      label: it.count > 1 ? `${itemName(it)} (${it.count})` : itemName(it),
      children:
        it.count > 1
          ? [
              { label: 'One', onSelect: () => g.requestAction(def, { ...kt, itemUid: it.uid, count: 1 } as Target) },
              { label: `All (${it.count})`, onSelect: () => g.requestAction(def, { ...kt, itemUid: it.uid, count: it.count } as Target) },
            ]
          : undefined,
      onSelect: it.count > 1 ? undefined : () => g.requestAction(def, { ...kt, itemUid: it.uid, count: 1 } as Target),
    });
    const fuelDef = ACTION_BY_ID.get('fuel_kiln');
    const fuel = g.inventory.items.filter((it) => isFuel(it.id));
    if (fuelDef && fuel.length) entries.push({ label: 'Fuel', children: fuel.map((it) => quantity(fuelDef, it)) });
    const loadDef = ACTION_BY_ID.get('load_kiln');
    const green = g.inventory.items.filter((it) => isGreenware(it.id));
    if (loadDef) {
      entries.push({
        label: 'Fire clay',
        disabled: !green.length,
        hint: green.length ? undefined : 'You carry no unfired clay.',
        children: green.length ? green.map((it) => quantity(loadDef, it)) : undefined,
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
    if (k.output.length) entries.push({ label: `Fired: ${k.output.map((o) => itemName(o).toLowerCase()).join(', ')}`, disabled: true });
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
    const moulds = g.inventory.items.filter((it) => isMould(it.id) && MOULD_BY_ID.get(it.id)?.makes !== 'anvil');
    const lumps = g.inventory.items.filter((it) => isLump(it.id));
    if (smithDef) {
      entries.push({
        label: 'Smith',
        disabled: !moulds.length || !lumps.length,
        hint: !moulds.length ? 'You carry no moulds.' : !lumps.length ? 'You carry no metal.' : undefined,
        children:
          moulds.length && lumps.length
            ? moulds.map((mould) => {
                const def = MOULD_BY_ID.get(mould.id)!;
                return {
                  label: itemName(mould),
                  note: `${itemDef(def.makes).name.toLowerCase()} · ${def.lumps} lump${def.lumps > 1 ? 's' : ''} · ${mouldUsesLeft(mould.ql, mould.dmg)} fillings left`,
                  children: lumps.map((lump) => {
                    const t: Target = { ...at, mouldUid: mould.uid, itemUid: lump.uid };
                    const reason = smithDef.check?.(t, g) ?? null;
                    return {
                      label: `${METAL_BY_LUMP.get(lump.id)?.name ?? itemName(lump)} (${lump.count})`,
                      hint: reason ?? undefined,
                      disabled: !!reason,
                      onSelect: () => g.requestAction(smithDef, t),
                    };
                  }),
                };
              })
            : undefined,
      });
    }
    const up = ACTION_BY_ID.get('pick_up_anvil');
    if (up) entries.push({ label: up.label, onSelect: () => g.requestAction(up, at) });
    return entries;
  }

  /** The settlement menu: its wildermon, its upgrade, its name. */
  private deedEntry(): MenuItem {
    const g = this.game;
    const d = g.deed!;
    const level = g.deedLevel;
    const kept = [...g.creatures.list.values()].filter((c) => c.mode === 'stored' || c.mode === 'deed');
    const children: MenuItem[] = [];
    const workers = g.creatures.workers().length;
    children.push({
      label: `Wildermon (${workers} of ${g.workerCap} working)`,
      disabled: !kept.length,
      hint: kept.length ? undefined : 'None kept here yet.',
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
      const def = CREATURE_ACTION_BY_ID.get(actionId);
      if (!def || !def.applies(t, g)) return null;
      const reason = def.check?.(t, g) ?? null;
      return { label: label ?? def.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(def, t) };
    };
    const push = (m: MenuItem | null): void => {
      if (m) entries.push(m);
    };
    push(item('examine_creature'));
    push(item('tame', target, `Tame (uses ${baitHint(c)})`));
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
    push(item('assign_deed'));
    push(item('take_creature'));
    push(item('store_creature'));
    push(item('rename_creature'));
    push(item('release_creature'));
    push(item('attack_creature'));
    return entries;
  }

  /** "Give it a name", for anything that will take one. */
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
      if (!g.deed || !g.onDeed(x, y)) return entries;
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
            entries.push({
              label: `Plan staircase (up from the ${sideName})`,
              children: MATERIALS.map((m) => ({
                label: m.name,
                note: describeNeeds(floorBill(m.id, 'stairs'), materialName),
                onSelect: () => g.requestAction(plan, { ...withSide, material: m.id, floorKind: 'stairs' }),
              })),
            });
            entries.push({
              label: `Plan ladder (on the ${sideName} side)`,
              note: describeNeeds(floorBill('plank', 'ladder'), materialName),
              onSelect: () => g.requestAction(plan, { ...withSide, material: 'plank', floorKind: 'ladder' }),
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
