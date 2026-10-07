import { ACTION_BY_ID } from './actions';
import { attackOf, BLOW_SHARE, bloodMul, type Creature } from './creatures';
import {
  ARROWS, blowEvery, blowOf, CONSIDER_EASY, CONSIDER_HARD, CRIT_HIT, critChance, fightBase, headBlow, headHide, hideTakes, nockedArrow,
  stanceDealt, swungWith,
} from './fight';
import type { Game } from './game';
import { hitChance, WEAPON_BY_ID, weaponDamage } from './gear';
import { matOfItem } from './materials';

/**
 * How a fight with something would go, worked out from the rules rather than
 * guessed: how many of your landed blows it would take to down it, how many of
 * its blows it would take to down you, and which way that leans once each
 * side's pace and your chance of landing are counted.
 *
 * Yours is a blow of what is in your hand at the middle of its spread, with
 * its share of critical ones, through its hide; with a bow in hand, a shot of
 * the arrows you would loose. Its is a blow at you after your stance, your
 * dodge, your shield's chance and what your armour turns where it might land
 * (`Game.expectedBlow`).
 */
export type ConsiderRating = 'easy' | 'even' | 'hard';
export interface Consider {
  /** Your landed blows to down it. */
  mine: number;
  /** Its blows to down you. */
  its: number;
  rating: ConsiderRating;
}

export function consider(g: Game, c: Creature): Consider {
  const def = g.creatures.species(c);
  const held = g.worn('weapon');
  const bow = held && WEAPON_BY_ID.get(held.id);
  const arrow = bow?.ammo ? nockedArrow(g, g.settings.nock) : undefined;
  let blow: number;
  let hit: number;
  let secs: number;
  if (held && bow && arrow) {
    const head = ARROWS[arrow.id];
    blow = weaponDamage(g, bow, held) * matOfItem(arrow).edge * (0.6 + arrow.ql / 140) * stanceDealt(g.settings.fightStance, (k, o) => g.perk(k, o))
      * hideTakes(def.hide, headBlow(head, bow)) * headHide(head, def.hide) * (1 + critChance(g.skills.get('archery'), bow) * (CRIT_HIT - 1));
    hit = hitChance(g, bow, held);
    const shoot = ACTION_BY_ID.get('shoot_creature');
    secs = (shoot && fightBase(g, shoot)) || bow.swing;
  } else {
    const { def: w, item } = swungWith(g);
    blow = weaponDamage(g, w, item) * stanceDealt(g.settings.fightStance, (k, o) => g.perk(k, o)) * hideTakes(def.hide, blowOf(w))
      * (1 + critChance(g.skills.get(w.kind), w) * (CRIT_HIT - 1));
    hit = hitChance(g, w, item);
    const attack = ACTION_BY_ID.get('attack_creature');
    secs = (attack && fightBase(g, attack)) || w.swing;
  }
  hit *= bloodMul(c, 'evade');
  const mine = Math.max(1, Math.ceil(Math.max(0, c.health) / Math.max(1e-6, blow)));
  const its = Math.max(1, Math.ceil(Math.max(0, g.player.stats.health) / Math.max(1e-6, g.expectedBlow(attackOf(c, def) * BLOW_SHARE, def.wound ?? 'bite'))));
  // How long each would take: yours at your pace over the blows you land, its at its own clock.
  const lean = (its * blowEvery(def)) / Math.max(1e-6, (mine / Math.max(0.05, hit)) * secs);
  return { mine, its, rating: lean >= CONSIDER_EASY ? 'easy' : lean >= CONSIDER_HARD ? 'even' : 'hard' };
}

/** The same, in the words the log and the target panel use. */
export function considerSays(g: Game, c: Creature): string {
  const k = consider(g, c);
  const name = g.creatures.species(c).name.toLowerCase();
  return `Against the ${name}: about ${k.mine} of your blows to down it, and about ${k.its} of its to down you. ${k.rating === 'easy' ? 'Easy' : k.rating === 'even' ? 'Even' : 'Hard'}.`;
}
