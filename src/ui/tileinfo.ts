import { TILLABLE } from '../game/farming';
import type { Game } from '../game/game';
import { itemDef } from '../game/items';
import { groundRoll, TILE_DEFS, TileType, dustiness } from '../world/tiles';

/**
 * What a piece of ground is *for*.
 *
 * The tile window already lists everything you could do to a tile this
 * moment, and hovering it says what is standing on it. Neither answers the
 * question you actually have when you are deciding where to put a road, a
 * field or a settlement: what is this ground like to live on. That is all
 * property rather than state — the pace it is walked at, what a loaded cart
 * makes of it, what digging gives you, whether anything grows on it, whether
 * it will take paving — and none of it shows anywhere until you have tried it
 * and noticed.
 *
 * Every line is a number read out of the tile's own definition, so this cannot
 * drift away from what the game actually does.
 */
export function tileUses(g: Game, x: number, y: number): string[] {
  const w = g.world;
  const type = w.getTile(x, y);
  const def = TILE_DEFS[type];
  const lines: string[] = [`${def.name} — what it is good for`];

  // Getting about on it, on foot and under a load.
  if (def.blocks) lines.push('Cannot be walked at all.');
  else {
    const pace = Math.round(def.speed * 100);
    const laden = Math.round(groundRoll(def.roll, 1) * 100);
    const word = pace > 100 ? ', better than open ground' : pace < 70 ? ', heavy going' : pace < 100 ? ', slow' : '';
    lines.push(`On foot: ${pace}% pace${word} · a full cart keeps ${laden}% of its own`);
  }

  // Working it with a tool.
  if (def.digYield) {
    const gives = itemDef(def.digYield).name.toLowerCase();
    lines.push(`Shovel: ${def.collect ? `fill from the top for ${gives}, and the ground is as it was after` : `digs ${gives}${def.turnsToDirt ? ', and the tile turns to dirt' : ''}`}`);
  }
  if (def.mineable) lines.push('Pickaxe: worked for what is in the rock, and cut back corner by corner');

  // What grows on it.
  const grows: string[] = [];
  if (def.forage) grows.push('foraged for food');
  if (def.botanize) grows.push('botanized for herbs');
  if (grows.length) {
    const held = [def.forage && !g.isForaged(x, y, 'forage') ? 'something to pick' : null, def.botanize && !g.isForaged(x, y, 'botanize') ? 'something to gather' : null].filter(Boolean);
    lines.push(`Can be ${grows.join(' and ')} · ${held.length ? `${held.join(' and ')} on it now` : 'picked clean for the moment'}`);
  }
  if (TILLABLE.has(type)) lines.push('Rake: turns into a field, ready for sowing');
  if (type === TileType.Field) lines.push('Sow it, tend it and reap it. An untended field gives back only its seed.');

  // What can be laid over it or built on it. Saying a road will not take a
  // road, or that bare rock will not take one, is not worth a line.
  const paved = type === TileType.Gravel || type === TileType.Cobblestone || type === TileType.Slabs;
  if (paved) lines.push('This is paving already. Break it up with a pickaxe and it goes back to dirt.');
  else if (def.pavable) lines.push('Takes paving: gravel, cobblestone or slabs, once it is packed hard');
  else if (!def.blocks && type !== TileType.Rock) lines.push('Will not take paving');

  // What it does underfoot, which is the one thing about ground you notice.
  const dust = dustiness(type);
  if (dust >= 0.8) lines.push('Loose and dry: it goes up in a cloud behind you');
  else if (dust === 0) lines.push('Too wet to raise anything underfoot');
  else if (dust <= 0.12) lines.push('Holds together underfoot and barely marks');

  return lines;
}
