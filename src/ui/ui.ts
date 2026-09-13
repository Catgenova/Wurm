import type { Game } from '../game/game';
import type { Pick, Renderer } from '../render/renderer';
import { TileType, TREE_DEFS, treeSpecies, treeVariant } from '../world/tiles';
import { ACTION_BY_ID } from '../game/actions';
import { itemName } from '../game/items';
import { ContextMenu, type MenuItem } from './contextmenu';
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
    });

    const events = this.windows.create({ id: 'events', title: 'Event', x: 12, y: 12, width: 420, height: 210, anchor: 'bl' });
    this.eventLog = new EventLogPanel(events, game);
    const inventory = this.windows.create({ id: 'inventory', title: 'Inventory', x: 12, y: 56, width: 340, height: 300, anchor: 'tr' });
    new InventoryPanel(inventory, game, this.menu);
    const skills = this.windows.create({ id: 'skills', title: 'Skills', x: 364, y: 56, width: 260, height: 380, anchor: 'tr', open: false });
    new SkillsPanel(skills, game);
    const map = this.windows.create({ id: 'map', title: 'Map', x: 12, y: 370, width: 236, height: 262, anchor: 'tr', open: false });
    this.minimap = new MinimapPanel(map, game, renderer);
    const help = this.windows.create({ id: 'help', title: 'Help', x: 0, y: 0, width: 440, height: 460, open: false });
    help.el.style.left = `${Math.max(0, (window.innerWidth - 440) / 2)}px`;
    help.el.style.top = `${Math.max(0, (window.innerHeight - 460) / 2)}px`;
    buildHelp(help);
  }

  toggleWindow(id: string): void {
    this.windows.toggle(id);
  }

  focusChat(): void {
    this.windows.get('events')?.open();
    this.eventLog.focus();
  }

  update(fps: number): void {
    this.hud.update(this.renderer, fps);
    this.minimap.update();
  }

  /** Describe what is under the cursor. */
  setHover(pick: Pick | null, sx: number, sy: number): void {
    if (!pick) {
      this.tooltip.hide();
      return;
    }
    const w = this.game.world;
    const lines: string[] = [];
    const t = w.getTile(pick.x, pick.y);
    if (t === TileType.Tree) {
      const data = w.getData(pick.x, pick.y);
      lines.push(`${['Young', 'Mature', 'Old'][treeVariant(data)]} ${TREE_DEFS[treeSpecies(data)].name.toLowerCase()} tree`);
    } else {
      lines.push(w.tileName(pick.x, pick.y));
    }
    lines.push(`${pick.x}, ${pick.y} · slope ${w.slope(pick.x, pick.y)} · corner h ${w.getHeight(pick.cx, pick.cy)}`);
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
    const target = { kind: 'tile' as const, x: pick.x, y: pick.y, cx: pick.cx, cy: pick.cy };
    const entries: MenuItem[] = [];
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
    for (const { def, reason } of this.game.actionsFor(target)) {
      entries.push({ label: def.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => this.game.requestAction(def, target) });
    }
    this.menu.show(sx, sy, `${this.game.world.tileName(pick.x, pick.y)} (${pick.x}, ${pick.y})`, entries);
  }
}
