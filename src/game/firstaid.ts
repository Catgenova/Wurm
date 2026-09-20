import { tryGain } from './learn';
import type { ActionDef, Target } from './actions';
import { maxHealth, SPECIES, type Creature } from './creatures';
import type { Game } from './game';
import { itemName, type Item } from './items';
import { PART_NAMES, worstWound, WOUND_KINDS, woundText, type Wound } from './wounds';

/** What a dressing and a scour teach, well done or badly. */
export const BANDAGE_GAIN = 0.35;
export const CLEAN_GAIN = 0.8;

/**
 * First aid. A wound closes on its own eventually, but a clean dressing is
 * the difference between carrying on and lying down. Bandages are cut from
 * cloth; binding a wound with one is a skill, and the same hands will do as
 * much for a hurt wildermon as for their owner.
 */

/** Fraction of a life a single dressing puts back, by the hand and the cloth. */
export const healAmount = (skill: number, ql: number): number => 0.06 + (skill / 100) * 0.24 + (ql / 100) * 0.1;

/** The soundest bandage carried: the good cloth is what you want on a wound. */
const bestBandage = (g: Game) =>
  g.inventory.items.filter((it) => it.id === 'bandage').sort((a, b) => b.ql - a.ql)[0];

const creatureOf = (g: Game, t: Target): Creature | undefined => (t.kind === 'creature' ? g.creatures.get(t.id) : undefined);

/** The best cover carried whose herb suits this wound, or the best of any. */
function bestCover(g: Game, w: Wound | null): Item | undefined {
  const want = w ? WOUND_KINDS[w.kind].herb : null;
  const covers = g.inventory.items.filter((it) => it.id === 'cover');
  const right = want ? covers.filter((it) => it.extra?.toLowerCase() === want) : [];
  return (right.length ? right : covers).sort((a, b) => b.ql - a.ql)[0];
}

/** The dressing that will actually go on: the right herb, any herb, or cloth. */
function dressingFor(g: Game, w: Wound | null): { item: Item; herb: string } | null {
  const cover = bestCover(g, w);
  if (cover) return { item: cover, herb: (cover.extra ?? '').toLowerCase() };
  const cloth = bestBandage(g);
  return cloth ? { item: cloth, herb: '' } : null;
}

export const FIRST_AID_ACTIONS: ActionDef[] = [
  {
    id: 'bind_wound',
    label: 'Dress a wound',
    verb: 'dressing a wound',
    skill: 'chirurgy',
    stamina: 0.02,
    baseTime: 7,
    repeat: true,
    applies: (t, g) => t.kind === 'item' && ['bandage', 'cover'].includes(g.inventory.get(t.uid)?.id ?? ''),
    labelFor: (t, g) => {
      const w = worstWound(g.player.wounds);
      return w ? `Dress the ${WOUND_KINDS[w.kind].name} on your ${PART_NAMES[w.part] ?? w.part}` : 'Dress a wound';
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      if (!['bandage', 'cover'].includes(g.inventory.get(t.uid)?.id ?? '')) return 'That is not a dressing.';
      const w = worstWound(g.player.wounds);
      if (!w) return g.player.stats.health >= 0.999 ? 'There is nothing wrong with you.' : 'Nothing is open. You are only tired and thin.';
      if (w.infected) return `The ${WOUND_KINDS[w.kind].name} on your ${PART_NAMES[w.part] ?? w.part} has gone bad. Clean it out before anything will hold on it.`;
      if (!dressingFor(g, w)) return 'You have nothing to dress it with.';
      return null;
    },
    perform: (t, g) => {
      const w = worstWound(g.player.wounds);
      if (!w || w.infected) return;
      const use = dressingFor(g, w);
      if (!use || !g.inventory.remove(use.item.uid, 1)) return;
      const suits = use.herb === WOUND_KINDS[w.kind].herb;
      const clean = g.skillCheck('first_aid', w.infected ? 30 : 10, use.item.ql, g.mindEase());
      // Cloth holds a dressing on. The right herb closes the wound.
      const healed = healAmount(g.skills.get('first_aid'), use.item.ql) * (clean ? 1 : 0.35) * (suits ? 1.5 : use.herb ? 1.1 : 1);
      g.player.stats.health = Math.min(1, g.player.stats.health + healed);
      w.severity = Math.max(0, w.severity - healed);
      w.dressing = clean ? use.herb : w.dressing;
      if (clean) w.bleeding = false;
      g.gainSkill('first_aid', tryGain(clean, BANDAGE_GAIN));
      g.note('dressed');
      if (suits && clean) g.note('covered');
      g.logMsg(
        !clean
          ? `The dressing slips and you make a poor job of it. You still have ${woundText(w)}.`
          : suits
            ? `You lay the ${use.herb} cover on and bind it. The bleeding stops at once and it is already closing.`
            : use.herb
              ? `You bind the ${use.herb} cover over it. It is the wrong herb for a ${WOUND_KINDS[w.kind].name}, but it holds and the bleeding stops.`
              : `You clean it and bind it with cloth. The bleeding stops, though it will be slow to close.`,
        'event',
      );
      // Keep going while something is open and there is something to put on it.
      const next = worstWound(g.player.wounds);
      return !!next && !next.infected && !!dressingFor(g, next);
    },
  },
  {
    id: 'clean_wound',
    label: 'Clean out a wound that has gone bad',
    verb: 'cleaning a wound out',
    skill: 'chirurgy',
    stamina: 0.06,
    baseTime: 14,
    applies: (t, g) => t.kind === 'item' && g.inventory.get(t.uid)?.id === 'lye_bucket' && g.player.wounds.some((w) => w.infected),
    check: (t, g) => {
      if (!g.player.wounds.some((w) => w.infected)) return 'Nothing on you has gone bad.';
      if (!g.inventory.has('lye_bucket')) return 'You need a bucket of lye to clean it out with.';
      return null;
    },
    perform: (t, g) => {
      const w = g.player.wounds.find((x) => x.infected);
      const lye = g.inventory.find('lye_bucket');
      if (!w || !lye) return;
      g.inventory.remove(lye.uid, 1);
      g.inventory.add('bucket', { ql: lye.ql });
      const done = g.skillCheck('first_aid', 26, lye.ql, g.mindEase());
      g.gainSkill('first_aid', tryGain(done, CLEAN_GAIN));
      if (!done) {
        g.logMsg(`You scour the ${WOUND_KINDS[w.kind].name} out and it is no better for it. The lye is gone.`, 'error');
        return;
      }
      w.infected = false;
      w.bleeding = true;
      w.dressing = null;
      g.note('cleaned');
      g.logMsg(`You scour the ${WOUND_KINDS[w.kind].name} on your ${PART_NAMES[w.part] ?? w.part} out with lye. It is open and clean again, and bleeding. Dress it.`, 'event');
    },
  },
  {
    id: 'treat_creature',
    label: 'Treat its wounds',
    verb: 'dressing a wound',
    skill: 'chirurgy',
    stamina: 0.03,
    baseTime: 9,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && c.mode !== 'wild' && c.health < maxHealth(c, SPECIES[c.species]);
    },
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is gone.';
      if (c.mode === 'wild') return 'It will not stand still for you while it is wild.';
      if (c.health >= maxHealth(c, SPECIES[c.species])) return `${c.name} is not hurt.`;
      if (!bestBandage(g)) return 'You have no bandages. Cut some from cloth.';
      if (Math.hypot(c.x - g.player.x, c.y - g.player.y) > 1.9) return 'You need to be beside it.';
      return null;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      const bandage = bestBandage(g);
      if (!c || !bandage) return;
      const def = SPECIES[c.species];
      const ql = bandage.ql;
      if (!g.inventory.remove(bandage.uid, 1)) return;
      const clean = g.skillCheck('first_aid', 14, ql, g.mindEase());
      // A dressing that goes on badly still heals a third and still teaches
      // something; what it does not do is teach as much as a good one.
      if (!clean) g.missed();
      const top = maxHealth(c, def);
      const healed = top * healAmount(g.skills.get('first_aid'), ql) * (clean ? 1 : 0.35);
      c.health = Math.min(top, c.health + healed);
      g.logMsg(
        clean
          ? `You dress ${c.name}'s wounds with the ${itemName(bandage).toLowerCase()}. It is up to ${Math.ceil(c.health)} of ${top}.`
          : `${c.name} will not hold still and the dressing goes on badly. It is up to ${Math.ceil(c.health)} of ${top}.`,
        'event',
      );
    },
  },
];

export const FIRST_AID_ACTION_BY_ID = new Map(FIRST_AID_ACTIONS.map((a) => [a.id, a]));
