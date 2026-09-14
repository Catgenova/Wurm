import { clockLeft } from '../game/boons';
import {
  ageOf,
  attackOf,
  careWord,
  coaxBonus,
  creatureLevel,
  GATHER_VERB,
  growsAt,
  maxHealth,
  SEX_NAMES,
  SPECIES,
  STANCE_NAMES,
  taskSkill,
  workRangeOf,
  type Creature,
} from '../game/creatures';
import { baitHint, tameChance } from '../game/creatureActions';
import type { Game } from '../game/game';
import { itemDef } from '../game/items';
import { traitOf } from '../game/traits';
import { TIER_LEVEL } from '../game/husbandry';

const pct = (v: number): number => Math.round(v * 100);

/** A bar of blocks, so a figure can be read without reading the figure. */
const bar = (v: number, width = 8): string => {
  const full = Math.max(0, Math.min(width, Math.round(v * width)));
  return '█'.repeat(full) + '░'.repeat(width - full);
};

/**
 * Everything worth knowing about a creature at a glance, as lines for a
 * tooltip. What it says depends on what the creature is to you: a wild one
 * tells you only what you could learn by looking at it and what it would take
 * to win it over; one of your own tells you its condition, its blood, what it
 * is doing and how well it does it. Nothing here is decoration — every line is
 * a number you would otherwise have to go and look up.
 */
export function creatureLines(g: Game, c: Creature): string[] {
  const def = SPECIES[c.species] ?? SPECIES.rabba;
  const lines: string[] = [];
  const age = ageOf(c, g.time);
  const growing = growsAt(c, g.time);

  // A monster is not a wildermon and nothing about it is negotiable.
  if (def.monster) {
    lines.push(`${def.name} · hostile`);
    lines.push(`Health ${Math.ceil(c.health)}/${maxHealth(c, def)} ${bar(c.health / maxHealth(c, def))} · hits for ${attackOf(c, def).toFixed(0)}`);
    lines.push('It cannot be tamed. Kill it and butcher it, or keep well clear.');
    return lines;
  }

  if (c.mode === 'wild') {
    lines.push(`Wild ${def.name} · ${age}${growing > 0 ? `, grown in ${clockLeft(growing)}` : ''}`);
    lines.push(`Eats ${baitHint(c)}`);
    const taming = g.skills.get('taming');
    if (taming < def.tameLevel) lines.push(`Taming ${def.tameLevel} to try · you have ${taming.toFixed(1)}`);
    else lines.push(`Taming ${def.tameLevel} to try · you have ${taming.toFixed(1)} · ${pct(tameChance(g, c))}% an offering`);
    const warm = coaxBonus(c, g.time);
    if (warm > 0) lines.push(`It has taken ${c.coaxed} offering${c.coaxed === 1 ? '' : 's'} from your hand · ${pct(warm)} of those points are the run`);
    if (c.trapped !== null) lines.push('Held in a trap. Take it out, or let it go.');
    return lines;
  }

  // One of your own: name, what it is, and how far along it is.
  lines.push(`${c.name} · ${SEX_NAMES[c.sex]} ${def.name} · ${age}${growing > 0 ? `, grown in ${clockLeft(growing)}` : ''} · Lv ${creatureLevel(c)}`);
  const max = maxHealth(c, def);
  lines.push(`Health ${Math.ceil(c.health)}/${max} ${bar(c.health / max)}`);
  lines.push(`Fed ${pct(c.hunger)}% ${bar(c.hunger)} · care ${pct(c.care)}%, ${careWord(c.care)}`);

  // What it is doing, and how well it does it.
  if (c.ridden) lines.push('Under the saddle');
  else if (c.hitchedTo !== null) lines.push('In the traces');
  else if (c.mode === 'stored') lines.push('Kept at the token · idle');
  else if (c.mode === 'deed') {
    // A reach means nothing to something with no trade to range out and do.
    if (def.gathers) lines.push(`Deed worker · ${GATHER_VERB[def.gathers]} at ${taskSkill(c, def).toFixed(1)} · reaches ${workRangeOf(c, def)} tiles`);
    else lines.push(`Deed worker · no trade of its own, so it keeps the deed company`);
    if (c.carrying) lines.push(`Carrying ${itemDef(c.carrying.id).name.toLowerCase()} home`);
  } else lines.push(`Your companion · ${STANCE_NAMES[c.stance].toLowerCase()} · hits for ${attackOf(c, def).toFixed(0)}`);

  // Blood, which is the whole of what breeding is for.
  const husbandry = g.skills.get('animal_husbandry');
  const traits = c.traits.map((id) => {
    const t = traitOf(id);
    if (!t) return null;
    if (husbandry < 1 + TIER_LEVEL[t.tier]) return 'something unread';
    // Nearly everything is common, so only what is better than common says so.
    return t.tier === 'common' ? t.name : `${t.name} (${t.tier})`;
  }).filter(Boolean);
  if (traits.length) lines.push(`Traits: ${traits.join(', ')}`);
  if (c.due > 0) lines.push(`In calf · due in ${clockLeft(c.due - g.time)}`);
  return lines;
}
