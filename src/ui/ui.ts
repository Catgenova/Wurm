import type { Game } from '../game/game';
import type { Pick, Renderer } from '../render/renderer';
import { TileType, TREE_DEFS, treeSpecies, treeVariant } from '../world/tiles';
import { ACTION_BY_ID, type ActionDef, type Target } from '../game/actions';
import { BUILD_ACTION_BY_ID, materialName } from '../game/buildActions';
import {
  describeNeeds,
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
import { CREATURE_ACTION_BY_ID } from '../game/creatureActions';
import { isBaitFor, SPECIES, STANCE_HINTS, STANCE_NAMES, STANCES } from '../game/creatures';
import { itemName } from '../game/items';
import { nearestSide } from '../render/renderer';
import { crateKindOfItem, crateName, CRATE_DEFS, crateUnits, subtileOf } from '../game/crates';
import { CratePanel } from './panels/crate';
import { WildermonPanel } from './panels/wildermon';
import { ContextMenu, type MenuItem } from './contextmenu';
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
    const settings = this.windows.create({ id: 'settings', title: 'Settings', x: 12, y: 640, width: 300, height: 190, anchor: 'tr', open: false });
    this.settings = new SettingsPanel(settings, game);
    const crate = this.windows.create({ id: 'crate', title: 'Deed crate', x: 364, y: 56, width: 320, height: 260, anchor: 'tr', open: false });
    this.cratePanel = new CratePanel(crate, game);
    const pals = this.windows.create({ id: 'wildermon', title: 'Wildermon', x: 364, y: 330, width: 330, height: 320, anchor: 'tr', open: false });
    this.wildermon = new WildermonPanel(
      pals,
      game,
      (id) => this.creatureEntries(id),
      (x, y, title, items) => this.menu.show(x, y, title, items),
    );
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
    this.settings.refresh();
    this.wildermon.update(performance.now());
  }

  /** Describe what is under the cursor. */
  setHover(pick: Pick | null, sx: number, sy: number): void {
    if (!pick) {
      this.tooltip.hide();
      return;
    }
    const w = this.game.world;
    const lines: string[] = [];
    const creature = pick.creature !== undefined ? this.game.creatures.get(pick.creature) : undefined;
    if (creature) {
      const def = SPECIES[creature.species];
      lines.push(`${creature.name}${creature.name !== def.name ? ` the ${def.name}` : ''} · ${this.game.creatures.describe(creature)}`);
      // Only your own wildermon show their condition.
      if (creature.mode !== 'wild') lines.push(`Health ${Math.ceil(creature.health)}/${def.health} · ${creature.hunger < 0.3 ? 'hungry' : creature.hunger < 0.6 ? 'peckish' : 'well fed'}`);
      this.tooltip.show(sx, sy, lines);
      return;
    }
    const crate = pick.crate !== undefined ? this.game.crates.get(pick.crate) : undefined;
    if (crate) {
      lines.push(crateName(crate));
      lines.push(`${crateUnits(crate)} / ${CRATE_DEFS[crate.kind].capacity} things · spot ${crate.sx + 1},${crate.sy + 1} of tile ${crate.x}, ${crate.y}`);
      this.tooltip.show(sx, sy, lines);
      return;
    }
    const t = w.getTile(pick.x, pick.y);
    if (t === TileType.Tree) {
      const data = w.getData(pick.x, pick.y);
      lines.push(`${['Young', 'Mature', 'Old'][treeVariant(data)]} ${TREE_DEFS[treeSpecies(data)].name.toLowerCase()} tree`);
    } else {
      lines.push(w.tileName(pick.x, pick.y));
    }
    lines.push(`${pick.x}, ${pick.y} · slope ${w.slope(pick.x, pick.y)} · corner h ${w.getHeight(pick.cx, pick.cy)}`);
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
    const creature = pick.creature !== undefined ? this.game.creatures.get(pick.creature) : undefined;
    if (creature) {
      this.menu.show(sx, sy, `${creature.name} (${this.game.creatures.describe(creature)})`, this.creatureEntries(creature.id));
      return;
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
      this.menu.show(sx, sy, crateName(crate), entries);
      return;
    }
    const target = { kind: 'tile' as const, x: pick.x, y: pick.y, cx: pick.cx, cy: pick.cy };
    const entries: MenuItem[] = [];
    if (this.game.isToken(pick.x, pick.y)) {
      const kept = [...this.game.creatures.list.values()].filter((c) => c.mode === 'stored' || c.mode === 'deed');
      if (kept.length) {
        entries.push({
          label: 'Wildermon',
          children: kept.map((c) => ({ label: `${c.name} (${this.game.creatures.describe(c)})`, children: this.creatureEntries(c.id) })),
        });
      }
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
    const building = this.game.buildings.buildingAt(pick.x, pick.y);
    if (building) entries.push(...this.buildingEntries(pick));
    for (const { def, reason } of this.game.actionsFor(target)) {
      entries.push({ label: def.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => this.game.requestAction(def, target) });
    }
    if (!building) entries.push(...this.buildingEntries(pick));
    const title = building ? `${building.name} (${pick.x}, ${pick.y})` : `${this.game.world.tileName(pick.x, pick.y)} (${pick.x}, ${pick.y})`;
    this.menu.show(sx, sy, title, entries);
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
    push(item('tame', target, 'Tame (uses a berry or vegetable)'));
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
    push(item('assign_deed'));
    push(item('take_creature'));
    push(item('store_creature'));
    push(item('rename_creature'));
    push(item('release_creature'));
    return entries;
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
