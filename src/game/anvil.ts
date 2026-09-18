import { tryGain } from './learn';
import type { ActionDef, Target } from './actions';
import { SUBTILES } from './crates';
import type { Game } from './game';
import { itemDef, rollRarity, RARITY_WORD, type Item } from './items';
import { matOf, matOfItem, workingQl } from './materials';
import { metalOfItem } from './melt';
import { COIN_DIFFICULTY, COIN_METALS, COINS_PER_LUMP, DIE_WEAR, isCasting, METAL_BY_ID, METAL_BY_LUMP, MOULD_BY_MAKES, type MouldDef } from './metal';

/**
 * An anvil: cast whole in a smelter, set down on four subtiles, and the place
 * every casting is beaten true. What it is made of shows in its colour and in
 * how kindly it treats the work.
 */
export interface PlacedAnvil {
  id: number;
  /**
   * Whose this is, on an island. Absent in the game you play by yourself,
   * where everything on the ground is yours because there is only you.
   */
  mine?: boolean;

  x: number;
  y: number;
  /** Top-left subtile of its two by two block. */
  sx: number;
  sy: number;
  /** Metal it was cast from. */
  metal: string;
  ql: number;
}

/** An anvil covers two subtiles each way: four in all. */
/** What one go at the anvil teaches, whichever way it comes out. */
export const SMITH_GAIN = 0.5;

export const ANVIL_SUBTILES = 2;

export const anvilCentre = (a: PlacedAnvil): [number, number] => [a.x + (a.sx + 1) / SUBTILES, a.y + (a.sy + 1) / SUBTILES];
export const anvilCovers = (a: { sx: number; sy: number }, sx: number, sy: number): boolean =>
  sx >= a.sx && sx < a.sx + ANVIL_SUBTILES && sy >= a.sy && sy < a.sy + ANVIL_SUBTILES;
export const anvilAnchor = (sx: number, sy: number): [number, number] => [
  Math.max(0, Math.min(SUBTILES - ANVIL_SUBTILES, sx)),
  Math.max(0, Math.min(SUBTILES - ANVIL_SUBTILES, sy)),
];
export const anvilName = (a: PlacedAnvil): string => `${METAL_BY_ID.get(a.metal)?.name ?? 'Iron'} anvil`;

type AnvilTarget = Extract<Target, { kind: 'anvil' }>;
const anvilOf = (g: Game, t: Target): PlacedAnvil | undefined => (t.kind === 'anvil' ? g.anvils.get((t as AnvilTarget).id) : undefined);

/** A name said of more than one, without doubling an s that is already there. */
const plural = (name: string, n: number): string => (n > 1 && !name.endsWith('s') ? `${name}s` : name);

/** The casting to beat out: the one the player chose, or any in the pack when none was. */
function castingFor(g: Game, uid?: number): Item | undefined {
  if (uid !== undefined) {
    const it = g.inventory.get(uid);
    return it && isCasting(it) ? it : undefined;
  }
  return g.inventory.items.find(isCasting);
}

/** The metal to strike: whichever lump the player chose. */
function lumpFor(g: Game, uid?: number): Item | undefined {
  if (uid !== undefined) {
    const it = g.inventory.get(uid);
    return it && METAL_BY_LUMP.has(it.id) ? it : undefined;
  }
  return g.inventory.items.find((it) => METAL_BY_LUMP.has(it.id));
}

/** What the anvil is worth to beat on: its quality, and how hard its own metal is. */
export const anvilQl = (a: PlacedAnvil): number => workingQl(a.ql, METAL_BY_ID.get(a.metal)?.name);

/**
 * How good a piece comes out: the smith, the mould, the metal and the anvil
 * all have a say. A casting carries the mould and the metal it was poured
 * from in its one quality, which stands for both here.
 */
export function smithQl(g: Game, def: MouldDef, mouldQl: number, lumpQl: number, anvil: PlacedAnvil): number {
  const skill = g.skills.get(def.skill);
  return Math.max(1, Math.min(100, (g.productQl(def.skill) + mouldQl + lumpQl + anvilQl(anvil)) / 4 + skill / 25));
}

export const ANVIL_ACTIONS: ActionDef[] = [
  {
    id: 'place_anvil',
    label: 'Set the anvil down',
    verb: 'setting the anvil down',
    hidden: true,
    stamina: 0.05,
    baseTime: 4,
    applies: (t) => t.kind === 'tile',
    check: (t, g) => {
      if (t.kind !== 'tile' || t.sx === undefined || t.sy === undefined) return 'Choose a spot.';
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.find('anvil');
      if (!item || item.id !== 'anvil') return 'You have no anvil to set down.';
      return g.anvilPlaceReason(t.x, t.y, t.sx, t.sy);
    },
    perform: (t, g) => {
      if (t.kind !== 'tile' || t.sx === undefined || t.sy === undefined) return;
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.find('anvil');
      if (!item || item.id !== 'anvil' || !g.inventory.remove(item.uid, 1)) return;
      const a = g.addAnvil(t.x, t.y, t.sx, t.sy, item.extra ?? 'copper', item.ql);
      g.logMsg(`You set the ${anvilName(a).toLowerCase()} down. Bring a casting to it.`, 'event');
      g.events.emit('world', a.x, a.y);
    },
  },
  {
    id: 'pick_up_anvil',
    label: 'Take the anvil up',
    verb: 'lifting the anvil',
    stamina: 0.08,
    baseTime: 5,
    applies: (t, g) => anvilOf(g, t) !== undefined,
    perform: (t, g) => {
      const a = anvilOf(g, t);
      if (!a) return;
      g.removeAnvil(a.id);
      g.inventory.add('anvil', { ql: a.ql, extra: a.metal });
      g.logMsg(`You heave the ${anvilName(a).toLowerCase()} up onto your shoulder.`, 'event');
      g.events.emit('world', a.x, a.y);
    },
  },
  {
    id: 'strike_coins',
    label: 'Strike coins',
    verb: 'striking coins',
    hidden: true,
    stamina: 0.05,
    baseTime: 8,
    applies: (t, g) => anvilOf(g, t) !== undefined,
    check: (t, g) => {
      const a = anvilOf(g, t);
      if (!a) return 'It is gone.';
      const [cx, cy] = anvilCentre(a);
      if (Math.hypot(cx - g.player.x, cy - g.player.y) > 2.4) return 'Stand at the anvil.';
      if (!g.inventory.has('coin_die')) return 'You need a coin die.';
      const lump = lumpFor(g, t.kind === 'anvil' ? t.itemUid : undefined);
      if (!lump) return 'You have no metal to strike.';
      if (!COIN_METALS.includes(METAL_BY_LUMP.get(lump.id)?.id ?? '')) return 'Coins are struck from silver or gold.';
      return null;
    },
    perform: (t, g) => {
      const a = anvilOf(g, t);
      if (!a || t.kind !== 'anvil') return;
      const die = g.inventory.find('coin_die');
      const lump = lumpFor(g, t.itemUid);
      const metal = lump && METAL_BY_LUMP.get(lump.id);
      if (!die || !lump || !metal || !COIN_METALS.includes(metal.id)) return;
      if (!g.inventory.remove(lump.uid, 1)) return;
      // The die wears with every strike, good or bad, and no die can be mended.
      const dieQl = Math.max(1, die.ql - die.dmg / 2);
      die.dmg = Math.min(100, die.dmg + DIE_WEAR);
      const broke = die.dmg >= 100;
      if (broke) g.inventory.remove(die.uid, 1);
      g.events.emit('inventory');
      const hard = COIN_DIFFICULTY + matOfItem(lump).difficulty;
      if (!g.skillCheck('blacksmithing', hard, anvilQl(a), g.mindEase())) {
        g.gainSkill('blacksmithing', tryGain(false, SMITH_GAIN));
        g.logMsg(`The blanks come out smeared and you throw the metal back.${broke ? ' The die is worn through.' : ''}`, 'event');
        return;
      }
      const ql = smithQl(g, { skill: 'blacksmithing' } as MouldDef, dieQl, lump.ql, a);
      g.gainSkill('blacksmithing', tryGain(true, SMITH_GAIN));
      const made = g.inventory.add('coin', { ql, extra: metal.name, count: COINS_PER_LUMP });
      const rare = rollRarity(g.rand);
      if (rare) {
        made.rare = rare;
        made.maker = g.player.name;
        g.note(['', 'rare', 'supreme', 'fantastic'][rare]);
        g.logMsg(RARITY_WORD[rare], 'skill');
      }
      g.note('minted');
      g.madeIt('coin', made.ql, COINS_PER_LUMP, rare);
      g.logMsg(
        `You strike ${COINS_PER_LUMP} ${metal.name.toLowerCase()} coins on the ${anvilName(a).toLowerCase()}. (QL ${made.ql.toFixed(1)})${
          broke ? ' The die is worn through and done.' : ` The die has ${Math.ceil((100 - die.dmg) / DIE_WEAR)} strikes left.`
        }`,
        'event',
      );
    },
  },
  {
    id: 'smith',
    label: 'Smith',
    verb: 'working the metal',
    hidden: true,
    stamina: 0.06,
    baseTime: 9,
    applies: (t, g) => anvilOf(g, t) !== undefined,
    check: (t, g) => {
      const a = anvilOf(g, t);
      if (!a) return 'It is gone.';
      const [cx, cy] = anvilCentre(a);
      if (Math.hypot(cx - g.player.x, cy - g.player.y) > 2.4) return 'Stand at the anvil.';
      // A casting poured at the smelter, which is the only thing an anvil takes.
      const named = t.kind === 'anvil' ? t.itemUid : undefined;
      const casting = castingFor(g, named);
      if (!casting) return named !== undefined ? 'Choose a casting.' : 'Pour a mould at the smelter first.';
      if (!MOULD_BY_MAKES.has(casting.piece as string)) return 'Choose a casting.';
      return null;
    },
    perform: (t, g) => {
      const a = anvilOf(g, t);
      if (!a || t.kind !== 'anvil') return;
      const casting = castingFor(g, t.itemUid);
      const def = casting && MOULD_BY_MAKES.get(casting.piece as string);
      if (!casting || !def) return;
      const metal = metalOfItem(casting);
      const metalWord = (metal?.name ?? casting.extra ?? 'metal').toLowerCase();
      if (!g.inventory.remove(casting.uid, 1)) return;
      g.events.emit('inventory');
      // The deeper the seam it came out of, the harder it is to beat into shape.
      const hard = def.difficulty + matOf(casting.extra).difficulty;
      if (!g.skillCheck(def.skill, hard, anvilQl(a), g.mindEase())) {
        g.gainSkill(def.skill, tryGain(false, SMITH_GAIN));
        g.logMsg(`The ${itemDef(def.makes).name.toLowerCase()} comes out misshapen and you throw the metal back.`, 'event');
        return;
      }
      // The casting carries the mould and the metal it was poured from, so it stands for both.
      const ql = smithQl(g, def, casting.ql, casting.ql, a);
      g.gainSkill(def.skill, tryGain(true, SMITH_GAIN));
      const per = def.per ?? 1;
      const made = g.inventory.add(def.makes, { ql, extra: casting.extra, count: per });
      const rare = rollRarity(g.rand);
      if (rare) {
        made.rare = rare;
        made.maker = g.player.name;
        g.note(['', 'rare', 'supreme', 'fantastic'][rare]);
        g.logMsg(RARITY_WORD[rare], 'skill');
      }
      g.note('smithed');
      g.madeIt(def.makes, made.ql, per, rare);
      if (metal && ['adamantine', 'glimmersteel', 'mithril', 'seryll'].includes(metal.id)) g.note('moonmetal');
      g.logMsg(
        `You beat out ${per > 1 ? `${per} ` : 'a '}${metalWord} ${plural(itemDef(def.makes).name.toLowerCase(), per)} on the ${anvilName(a).toLowerCase()}. (QL ${made.ql.toFixed(1)})`,
        'event',
      );
    },
  },
];

export const ANVIL_ACTION_BY_ID = new Map(ANVIL_ACTIONS.map((a) => [a.id, a]));
