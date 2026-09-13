import type { ActionDef } from './actions';
import { deedRadiusAt, deedWorkersAt, MAX_DEED_LEVEL, type Game } from './game';

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
  met: (g) => [...g.crates.values()].filter((c) => g.onDeed(c.x, c.y)).length >= n,
});

const campfires = (n: number): DeedRequirement => ({
  label: n === 1 ? 'A campfire on the deed' : `${n} campfires on the deed`,
  met: (g) => [...g.campfires.values()].filter((f) => g.onDeed(f.x, f.y)).length >= n,
});

const litFire = (): DeedRequirement => ({
  label: 'A campfire burning on the deed',
  met: (g) => [...g.campfires.values()].some((f) => f.lit && g.onDeed(f.x, f.y)),
});

const buildings = (n: number): DeedRequirement => ({
  label: n === 1 ? 'A building with every ground-floor wall up' : `${n} buildings with every ground-floor wall up`,
  met: (g) =>
    [...g.buildings.list.values()].filter((b) => {
      const [bx, by] = (b.tiles[0] ?? '').split(',').map(Number);
      return Number.isFinite(bx) && g.onDeed(bx, by) && g.buildings.levelComplete(b, 0);
    }).length >= n,
});

const workers = (n: number): DeedRequirement => ({
  label: n === 1 ? 'A wildermon working the deed' : `${n} wildermon working the deed`,
  met: (g) => g.creatures.workers().length >= n,
});

/** What each level beyond the first asks for. */
export const DEED_UPGRADES: Record<number, DeedRequirement[]> = {
  2: [crates(1), campfires(1)],
  3: [crates(2), litFire(), buildings(1)],
  4: [crates(3), buildings(2), workers(2)],
  5: [crates(4), campfires(2), buildings(3), workers(3)],
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
  const next = nextDeedLevel(g);
  if (!next) return `${g.deed.name} is as grand as a settlement gets.`;
  const missing = upgradeProgress(g).filter((r) => !r.met);
  if (missing.length) return `Still wanted: ${missing.map((r) => r.label.toLowerCase()).join(', ')}.`;
  return null;
}

export const DEED_ACTIONS: ActionDef[] = [
  {
    id: 'upgrade_deed',
    label: 'Upgrade settlement',
    verb: 'marking out the new boundary',
    stamina: 0.05,
    baseTime: 8,
    applies: (_t, g) => !!g.deed,
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
