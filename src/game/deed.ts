import type { ActionDef } from './actions';
import { deedRadiusAt, deedWorkersAt, MAX_DEED_LEVEL, rankAtLeast, type Deed, type DeedRole, type Game } from './game';

/**
 * Settlement upgrades. Each one pushes the border out two tiles and lets one
 * more wildermon work the deed, and each has to be earned by building the
 * settlement up first.
 */
export interface DeedRequirement {
  label: string;
  met(g: Game): boolean;
}

const crates = (n: number): DeedRequirement => ({
  label: n === 1 ? 'A crate on the deed' : `${n} crates on the deed`,
  met: (g) => [...g.crates.values()].filter((c) => g.onOwnDeed(c.x, c.y)).length >= n,
});

const campfires = (n: number): DeedRequirement => ({
  label: n === 1 ? 'A campfire on the deed' : `${n} campfires on the deed`,
  met: (g) => [...g.campfires.values()].filter((f) => g.onOwnDeed(f.x, f.y)).length >= n,
});

const buildings = (n: number): DeedRequirement => ({
  label: n === 1 ? 'A building with every ground-floor wall up' : `${n} buildings with every ground-floor wall up`,
  met: (g) =>
    [...g.buildings.list.values()].filter((b) => {
      const [bx, by] = (b.tiles[0] ?? '').split(',').map(Number);
      return Number.isFinite(bx) && g.onOwnDeed(bx, by) && g.buildings.levelComplete(b, 0);
    }).length >= n,
});

const smelters = (n: number): DeedRequirement => ({
  label: n === 1 ? 'A stone smelter on the deed' : `${n} stone smelters on the deed`,
  met: (g) => [...g.smelters.values()].filter((s) => g.onOwnDeed(s.x, s.y)).length >= n,
});

const anvils = (n: number): DeedRequirement => ({
  label: n === 1 ? 'An anvil set down on the deed' : `${n} anvils set down on the deed`,
  met: (g) => [...g.anvils.values()].filter((a) => g.onOwnDeed(a.x, a.y)).length >= n,
});

const workers = (n: number): DeedRequirement => ({
  label: n === 1 ? 'A wildermon working the deed' : `${n} wildermon working the deed`,
  met: (g) => g.creatures.workers().length >= n,
});

/**
 * What each level beyond the first asks for. Upgrades are taken in order, so
 * each level's own requirement is the new thing the settlement has to show;
 * everything the levels below wanted is already standing.
 */
export const DEED_UPGRADES: Record<number, DeedRequirement[]> = {
  2: [crates(1), campfires(1)],
  3: [smelters(1)],
  4: [anvils(1)],
  5: [buildings(1), workers(3)],
};

export const nextDeedLevel = (g: Game): number | null => (g.deed && g.deedLevel < MAX_DEED_LEVEL ? g.deedLevel + 1 : null);

/** Requirements for the next upgrade, each marked met or not. */
export function upgradeProgress(g: Game): Array<{ label: string; met: boolean }> {
  const next = nextDeedLevel(g);
  if (!next) return [];
  return (DEED_UPGRADES[next] ?? []).map((r) => ({ label: r.label, met: r.met(g) }));
}

/** Why the settlement cannot be upgraded right now, or null. */
export function upgradeReason(g: Game): string | null {
  if (!g.deed) return 'You have no settlement.';
  // One you were asked onto is shown to you and is not yours to grow: the
  // island refuses anybody but the founder, and said "You have no settlement."
  if (!rankAtLeast(g.deed.role, 'founder')) return `Only whoever founded ${g.deed.name} can upgrade it.`;
  const next = nextDeedLevel(g);
  if (!next) return `${g.deed.name} is as grand as a settlement gets.`;
  const missing = upgradeProgress(g).filter((r) => !r.met);
  if (missing.length) return `Still wanted: ${missing.map((r) => r.label.toLowerCase()).join(', ')}.`;
  return null;
}

/** What your rank on a settlement lets you do, in one line. */
export function standingWord(role: DeedRole | undefined): string {
  switch (role ?? 'founder') {
    case 'founder': return 'You founded this one: everything here is yours, locks included.';
    case 'mayor': return 'You are a mayor here: you may build, and ask others in or out.';
    case 'guest': return 'You are a guest here: you may walk it and shape nothing.';
    default: return 'You are a citizen here: you may shape the ground and build on it.';
  }
}

/**
 * What leaving a settlement you were asked onto costs, asked before it is
 * done. It is `rpc_leave_deed`: off the roll at once, the founder is told, and
 * nothing but a fresh invitation puts you back on it.
 */
export const leaveQuestion = (d: Deed, holder?: string | null): string =>
  `Leave ${d.name}? You come off its roll at once and are a stranger there: you may walk it and `
  + `shape nothing, and of the stores on it only the ones you made yourself still open for you. `
  + `${holder ? `${holder} is` : 'Its founder is'} told, and only an invitation puts you back on it.`;

export const DEED_ACTIONS: ActionDef[] = [
  {
    id: 'upgrade_deed',
    label: 'Upgrade settlement',
    verb: 'marking out the new boundary',
    stamina: 0.05,
    baseTime: 8,
    // The founder's to do, so only a founder is offered it on every tile.
    applies: (_t, g) => !!g.deed && rankAtLeast(g.deed.role, 'founder'),
    check: (_t, g) => upgradeReason(g),
    perform: (_t, g) => {
      const d = g.deed;
      if (!d || upgradeReason(g) !== null) return;
      const level = g.deedLevel + 1;
      d.level = level;
      d.radius = deedRadiusAt(level);
      g.logMsg(
        `${d.name} grows to level ${level}. The border reaches ${d.radius} tiles from the token and ${deedWorkersAt(level)} wildermon may work here.`,
        'system',
      );
      g.events.emit('world', d.x, d.y);
    },
  },
];

export const DEED_ACTION_BY_ID = new Map(DEED_ACTIONS.map((a) => [a.id, a]));
