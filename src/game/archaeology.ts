import { tryGain } from './learn';
import { TileType } from '../world/tiles';
import type { ActionDef } from './actions';
import type { Game } from './game';
import { itemName, RARITY_ODDS, RARITY_WORD, rollRarity, type Item } from './items';
import {
  BAUBLE_SHARE, BAUBLE_TIER_BY_ID, BAUBLE_TIERS, findKind, readBauble, REGRET, rollBauble, rollTier, TARNISHED, type BaubleTier, type BaubleTierDef,
} from './baubles';
import { article } from './words';

/** What one go at putting a relic back together teaches. */
export const RESTORE_GAIN = 0.4;

/**
 * Archaeology and restoration. People lived on this island before you did and
 * left their things in the ground. Investigating a tile with a trowel turns up
 * broken pieces of them; gathering every piece of one thing and putting it back
 * together is the restorer's work, and it is the only way to hold what the old
 * people held.
 */
export interface RelicDef {
  /** Name as it reads on a fragment, and the key it is found by. */
  name: string;
  /** Pieces a whole one broke into. */
  parts: number;
  /** Item id it becomes when the pieces go back together. */
  result: string;
  /** How hard it is to put back, and how deep in the skill it is found. */
  difficulty: number;
}

/**
 * What lies under the island, from the commonplace to the thing nobody has
 * seen whole in a lifetime. A relic is only turned up once archaeology has
 * come far enough to know what it is looking at.
 */
export const RELICS: RelicDef[] = [
  { name: 'old pot', parts: 2, result: 'clay_pot', difficulty: 12 },
  { name: 'bone comb', parts: 2, result: 'bone_comb', difficulty: 16 },
  { name: 'old file', parts: 3, result: 'file', difficulty: 22 },
  { name: 'old lamp', parts: 3, result: 'old_lamp', difficulty: 26 },
  { name: 'bronze mirror', parts: 3, result: 'bronze_mirror', difficulty: 30 },
  { name: 'old blade', parts: 4, result: 'short_sword', difficulty: 34 },
  { name: 'statuette', parts: 4, result: 'statuette', difficulty: 38 },
  { name: 'ancient helm', parts: 5, result: 'helm', difficulty: 44 },
];

/** Ground worth turning over: soil and sand, not bare rock or standing water. */
export const DIGGABLE: ReadonlySet<number> = new Set<number>([
  TileType.Grass,
  TileType.Dirt,
  TileType.PackedDirt,
  TileType.Sand,
  TileType.Steppe,
  TileType.Tundra,
  TileType.Moss,
  TileType.Lawn,
  TileType.Clay,
  TileType.Marsh,
]);

/** "old lamp 2/3" on the end of a fragment says what it is a piece of. */
const FRAGMENT = /^(.+) (\d+)\/(\d+)$/;

export const relicByName = (name: string): RelicDef | undefined => RELICS.find((r) => r.name.toLowerCase() === name.toLowerCase());

/** What a fragment is a piece of, and which piece, or null if it is not one. */
export function fragmentOf(item: Item): { relic: RelicDef; part: number } | null {
  if (item.id !== 'fragment') return null;
  const m = FRAGMENT.exec(item.extra ?? '');
  const relic = m && relicByName(m[1]);
  return relic ? { relic, part: Number(m[2]) } : null;
}

/** Every fragment of one relic that is carried, at most one of each piece. */
export function piecesHeld(g: Game, relic: RelicDef): Item[] {
  const seen = new Map<number, Item>();
  for (const it of g.inventory.items) {
    const f = fragmentOf(it);
    if (!f || f.relic.name !== relic.name) continue;
    // The soundest of any duplicates is the one that goes into the work.
    const best = seen.get(f.part);
    if (!best || it.dmg < best.dmg) seen.set(f.part, it);
  }
  return [...seen.values()];
}

/** Which pieces of a relic are still missing, in order. */
export function partsMissing(g: Game, relic: RelicDef): number[] {
  const held = new Set(piecesHeld(g, relic).map((it) => fragmentOf(it)?.part));
  const out: number[] = [];
  for (let n = 1; n <= relic.parts; n++) if (!held.has(n)) out.push(n);
  return out;
}

/**
 * How likely a turn of the trowel is to find anything at all: a base, a share
 * of your archaeology and a share of the trowel's QL, up to a cap. A Miner's
 * Keen Trowel adds to it (`find:investigate`) and raises the cap
 * (`cap:investigate`).
 */
export const FIND_BASE = 0.14;
export const FIND_PER_SKILL = 0.4;
export const FIND_PER_TOOL = 0.1;
export const FIND_CAP = 0.7;
export const findChance = (skill: number, toolQl: number, more = 0, cap = FIND_CAP): number =>
  Math.min(cap, FIND_BASE + (skill / 100) * FIND_PER_SKILL + (toolQl / 100) * FIND_PER_TOOL + more);

/** The relics a given archaeologist would recognise if they turned one up. */
export const relicsWithin = (skill: number): RelicDef[] => RELICS.filter((r) => r.difficulty <= skill + 14);

/**
 * What a restoring that fails does to each piece: `RESTORE_HARM` and up to
 * `RESTORE_HARM_SPREAD` more, or nothing for a Mender's Gentle Hands. The
 * island's `restore_harm` and `restore_harm_spread`.
 */
export const RESTORE_HARM = 5;
export const RESTORE_HARM_SPREAD = 9;
const restoreHarm = (g: Game): number => (RESTORE_HARM + g.rand() * RESTORE_HARM_SPREAD) * g.perk('harm:restore_relic', 1);
/**
 * The damage on a piece that would halve what it restores to: each point takes
 * one `RESTORE_AGE`th off, or nothing for a Mender's Age Undone. The island's
 * `restore_age`.
 */
export const RESTORE_AGE = 200;
const aged = (g: Game, dmg: number): number => 1 - (dmg / RESTORE_AGE) * g.perk('age:restore_relic', 1);
/** What restoring brings out of what went in, at the restorer's skill, and more for a Mender's Fine Restore. */
const restoredQl = (g: Game, ql: number): number =>
  Math.max(1, Math.min(100, ql * (0.72 + g.skills.get('restoration') / 260) * g.perk('ql:restore_relic', 1)));

/**
 * What a bauble of this tier and rarity is rolled to give, and for a Mender's
 * Second Look the better of more rolls: the one that gives the most, and the
 * first where they give the same, which an ancient one always does.
 */
function bestRoll(g: Game, tier: BaubleTierDef, rare: number): string {
  let best = rollBauble(tier.id, rare, g.rand);
  const amount = (text: string): number => readBauble({ id: tier.item, extra: text })?.amount ?? 0;
  for (let i = 1; i < g.perk('rolls:bauble', 1); i++) {
    const again = rollBauble(tier.id, rare, g.rand);
    if (amount(again) > amount(best)) best = again;
  }
  return best;
}

/**
 * A tarnished bauble put right: at its tier's difficulty, and only as good as
 * it came out of the ground, less what age took, as a relic is. What it does
 * is rolled now, and its rarity with it, which multiplies what it does
 * (`rollBauble`); all of it is then written on the bauble. A Mender's perks
 * are the island's `restore_bauble`'s: surer, gentler on a failure, better
 * and rarer, and now and then a tier better than it looked.
 */
function restoreBauble(g: Game, item: Item): void {
  const found = BAUBLE_TIER_BY_ID.get(item.extra as BaubleTier) ?? BAUBLE_TIER_BY_ID.get('minor');
  if (!found) return;
  if (!g.sureCheck('restore_relic', 'restoration', found.difficulty, 0, g.mindEase())) {
    g.gainSkill('mind_logic', tryGain(false, RESTORE_GAIN));
    const gentle = g.perk('harm:restore_relic', 1) <= 0;
    g.damageItem(item, restoreHarm(g));
    g.logMsg(gentle
      ? `The tarnish will not lift from the ${found.id} bauble, and it takes no harm from the trying.`
      : `The tarnish will not lift from the ${found.id} bauble and you mark it trying.`, 'event');
    return;
  }
  // A tier better under the tarnish than it looked, now and then, for a Mender's Tier Up.
  const up = BAUBLE_TIERS[BAUBLE_TIERS.indexOf(found) + 1];
  const lift = g.perk('tier:restore_relic', 0);
  const tier = up && lift > 0 && g.rand() < lift ? up : found;
  const ql = restoredQl(g, item.ql * aged(g, item.dmg));
  // Rarer for a Mender's Lucky Polish: the first step at its odds, the rest at their own.
  const rare = rollRarity(g.rand, g.perk('rare:restore_relic', RARITY_ODDS[0]));
  if (!g.inventory.remove(item.uid, 1)) return;
  const made = g.inventory.add(tier.item, { ql, extra: bestRoll(g, tier, rare) });
  if (rare) {
    made.rare = rare;
    g.logMsg(RARITY_WORD[rare], 'skill');
  }
  g.gainSkill('mind_logic', tryGain(true, RESTORE_GAIN));
  g.logMsg(tier === found
    ? `The tarnish comes away and the bauble is whole: ${itemName(made).toLowerCase()}. (QL ${made.ql.toFixed(1)})`
    : `The tarnish comes away and the ${found.id} bauble is ${article(tier.id)} ${tier.id} one: ${itemName(made).toLowerCase()}. (QL ${made.ql.toFixed(1)})`,
  'event');
}

/** What studying at a lectern is worth over holding the book in one hand. */
export const LECTERN_GAIN = 2;

export const ARCHAEOLOGY_ACTIONS: ActionDef[] = [
  {
    id: 'investigate',
    label: 'Investigate',
    verb: 'investigating the ground',
    skill: 'archaeology',
    tool: 'trowel',
    stamina: 0.05,
    baseTime: 10,
    applies: (t, g) => t.kind === 'tile' && DIGGABLE.has(g.world.getTile(t.x, t.y)) && !g.world.hasWater(t.x, t.y),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('trowel')) return 'You need a trowel to go through the soil carefully.';
      if (g.isForaged(t.x, t.y, 'dig')) return 'You have been over this ground already. Try somewhere else.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      g.markForaged(t.x, t.y, 'dig');
      const skill = g.skills.get('archaeology');
      const toolQl = g.toolQl('trowel');
      if (g.rand() > findChance(skill, toolQl, g.perk('find:investigate', 0), g.perk('cap:investigate', FIND_CAP))) {
        g.missed();
        g.logMsg('You go through the soil and turn up nothing but roots and small stones.', 'event');
        return;
      }
      // A share of whatever comes up is a bauble, whatever the archaeologist
      // knows: now and again a Bauble of Regret, whole; otherwise whole but
      // black with age, and good for nothing until restored.
      const kind = findKind(g.rand(), g.perk('share:bauble', BAUBLE_SHARE));
      if (kind === 'regret') {
        const found = g.gather(REGRET, { ql: Math.max(1, g.productQl('archaeology', toolQl) * (0.55 + g.rand() * 0.35)) });
        g.events.emit('inventory');
        g.logMsg(`Your trowel turns up a Bauble of Regret, whole. It undoes one of your trades, in the Trades window. (QL ${found.ql.toFixed(1)})`, 'event');
        return;
      }
      if (kind === 'bauble') {
        const tier = rollTier(g.rand);
        const found = g.gather(TARNISHED, { ql: Math.max(1, g.productQl('archaeology', toolQl) * (0.55 + g.rand() * 0.35)), extra: tier });
        found.dmg = 18 + g.rand() * 50;
        g.events.emit('inventory');
        g.logMsg(`Your trowel turns up a tarnished ${tier} bauble. Restore it to see what it does. (QL ${found.ql.toFixed(1)}, damage ${found.dmg.toFixed(0)})`, 'event');
        return;
      }
      const within = relicsWithin(skill);
      // A piece of a relic you already hold part of, now and again, for a Miner's
      // Pieces that Fit. Nothing is rolled for it without the perk, so the dice
      // everybody else throws fall as they always have.
      const fitShare = g.perk('fit:relic', 0);
      const unfinished = fitShare > 0 ? RELICS.filter((r) => piecesHeld(g, r).length > 0 && partsMissing(g, r).length > 0) : [];
      const fit = unfinished.length > 0 && g.rand() < fitShare
        ? unfinished[Math.floor(g.rand() * unfinished.length)] : undefined;
      if (!fit && !within.length) {
        g.missed();
        g.logMsg('You turn up a scrap of something worked, but you cannot tell what it was and it crumbles.', 'event');
        return;
      }
      // The commonplace comes up far more often than the rare, as it did when it was lost.
      const weights = within.map((r) => 1 / (1 + r.difficulty / 12));
      let roll = g.rand() * weights.reduce((a, b) => a + b, 0);
      let relic = fit ?? within[0];
      for (let i = 0; !fit && i < within.length; i++) {
        roll -= weights[i];
        if (roll <= 0) {
          relic = within[i];
          break;
        }
      }
      // A piece you are still short of, if you are short of any: the ground is kinder than it needs to be.
      const missing = partsMissing(g, relic);
      const part = missing.length ? missing[Math.floor(g.rand() * missing.length)] : 1 + Math.floor(g.rand() * relic.parts);
      const item = g.gather('fragment', {
        ql: Math.max(1, g.productQl('archaeology', toolQl) * (0.55 + g.rand() * 0.35)),
        extra: `${relic.name} ${part}/${relic.parts}`,
      });
      // Nothing comes out of the ground sound.
      item.dmg = 18 + g.rand() * 50;
      g.events.emit('inventory');
      const left = partsMissing(g, relic).length;
      const short = left ? ` ${left} of ${relic.parts} still missing.` : ` That is all ${relic.parts} of them.`;
      g.logMsg(`Your trowel turns up a fragment of ${relic.name}, piece ${part} of ${relic.parts}. (QL ${item.ql.toFixed(1)}, damage ${item.dmg.toFixed(0)})${short}`, 'event');
    },
  },
  {
    id: 'restore_relic',
    label: 'Restore',
    verb: 'restoring',
    skill: 'restoration',
    stamina: 0.07,
    baseTime: 20,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      return !!item && (fragmentOf(item) !== null || item.id === TARNISHED);
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.get(t.uid);
      if (item?.id === TARNISHED) return item.dmg >= 85 ? 'It is too far gone to restore. Repair it first.' : null;
      const f = item && fragmentOf(item);
      if (!f) return 'That is not a fragment of anything.';
      const missing = partsMissing(g, f.relic);
      if (missing.length) return `You are missing ${missing.length} of the ${f.relic.parts} pieces of the ${f.relic.name} (${missing.join(', ')}).`;
      const rough = piecesHeld(g, f.relic).find((it) => it.dmg >= 85);
      if (rough) return 'One of the pieces is too far gone to join. Repair it first.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      if (item?.id === TARNISHED) {
        restoreBauble(g, item);
        return;
      }
      const f = item && fragmentOf(item);
      if (!f) return;
      const pieces = piecesHeld(g, f.relic);
      if (pieces.length < f.relic.parts) return;
      if (!g.sureCheck('restore_relic', 'restoration', f.relic.difficulty, 0, g.mindEase())) {
        g.gainSkill('mind_logic', tryGain(false, RESTORE_GAIN));
        const gentle = g.perk('harm:restore_relic', 1) <= 0;
        for (const p of pieces) g.damageItem(p, restoreHarm(g));
        g.logMsg(gentle
          ? `The pieces of the ${f.relic.name} will not sit together, and they take no harm from the trying.`
          : `The pieces of the ${f.relic.name} will not sit together and you mark them trying.`, 'event');
        return;
      }
      // What comes out is only as good as the pieces that went in, less what age took.
      const avgQl = pieces.reduce((sum, p) => sum + p.ql * aged(g, p.dmg), 0) / pieces.length;
      const ql = restoredQl(g, avgQl);
      for (const p of pieces) g.inventory.remove(p.uid, 1);
      const made = g.inventory.add(f.relic.result, { ql });
      g.gainSkill('mind_logic', tryGain(true, RESTORE_GAIN));
      g.logMsg(`The pieces go back together and the ${f.relic.name} is whole: ${itemName(made).toLowerCase()}. (QL ${made.ql.toFixed(1)})`, 'event');
    },
  },
  {
    id: 'study_book',
    label: 'Study',
    verb: 'studying',
    stamina: 0.02,
    baseTime: 30,
    applies: (t, g) => t.kind === 'item' && g.inventory.get(t.uid)?.id === 'book',
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.get(t.uid);
      if (item?.id !== 'book') return 'That is not a book.';
      if (item.dmg >= 90) return 'The pages are too far gone to read. Repair it first.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      if (!item || item.id !== 'book') return;
      // A lectern holds the pages open at the right angle, and you get `LECTERN_GAIN` times as much out of the go.
      const lectern = g.furnitureNear('lectern') !== undefined;
      const gain = g.gainSkill('mind_logic', (0.5 + item.ql / 90) * (lectern ? LECTERN_GAIN : 1));
      g.damageItem(item, 2 + g.rand() * 3);
      const where = lectern ? ' The lectern holds it open at the right angle and you make good use of the hour.' : ' Held in one hand, it is hard going. A lectern would be better.';
      g.logMsg(`You work through the ${itemName(item).toLowerCase()}.${where}${gain > 0.0005 ? '' : ' There is nothing left in it you do not already know.'}`, 'event');
    },
  },
];

export const ARCHAEOLOGY_ACTION_BY_ID = new Map(ARCHAEOLOGY_ACTIONS.map((a) => [a.id, a]));
