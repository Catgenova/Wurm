import { TILLABLE } from '../game/farming';
import { isSeam } from '../world/tiles';
import type { Game } from '../game/game';
import { itemDef } from '../game/items';
import { bedrockAt } from '../world/ore';
import { groundRoll, TILE_DEFS, TileType, dustiness } from '../world/tiles';
import { SLOW_SLOPE } from '../game/player';

/**
 * What the rock under a tile is, when anybody has looked.
 *
 * Bare rock says what it is by being bare. Everything else has soil on top and
 * only a prospector can tell you — and the reading fades, because a prospector
 * remembers what they read for a while and not for ever.
 *
 * This was a line in the mouseover and nowhere else, which on a phone is
 * nowhere at all: there is no hovering with a finger, so the one thing
 * prospecting is *for* — is this seam worth mining, and what quality will it
 * give — could be lit up on the ground and unreadable. It is one sentence in
 * one place now, and the mouseover, the tile window and the right-click menu
 * all say it, so none of them can drift from the others.
 *
 * Null when nobody has read this ground, which is the honest answer and not a
 * guess.
 */
export function groundReading(g: Game, x: number, y: number): string | null {
  const w = g.world;
  const bare = w.getTile(x, y) === TileType.Rock;
  if (!bare && !g.isProspected(x, y)) return null;
  const rock = bedrockAt(w, x, y);
  return `${rock.name}${isSeam(rock) ? ` · mining ${rock.level}` : ''} · up to QL ${rock.maxQl}${bare ? '' : ', buried'}`;
}

/**
 * Where the corner you have picked stands, and what is on it.
 *
 * Every corner action is about one corner and about how high it is: mining and
 * chipping a face back, dropping dirt, digging, flattening, and whether a wall
 * will stand. The renderer marks the one you picked with a dot, and the number
 * behind the dot was a mouseover line and nowhere else — which on a phone is
 * nowhere at all. The same hole the prospector's reading fell down, and the
 * same fix: one sentence in one place, said by the mouseover, the tile window
 * and the right-click menu alike.
 *
 * Read against the water line rather than as a bare number, because that is
 * what every one of those actions is actually asking. Zero *is* the water
 * line — so a corner sitting on it reads as sitting on it, which is worth
 * saying plainly: it is dry ground, it is a face you can work, and it is the
 * one height that used to be refused for being wet.
 */
export function cornerReading(g: Game, cx: number, cy: number): string {
  const w = g.world;
  const h = w.getHeight(cx, cy);
  const soil = w.getDirt(cx, cy);
  const stands = h === 0 ? 'at the water line' : h > 0 ? `${h} above the water` : `${-h} under water`;
  // And where it stands against the level, when one has been taken, which is
  // the number every job on this corner is working towards.
  const mark = g.level === null ? ''
    : h === g.level ? ' · at the level'
    : ` · ${Math.abs(h - g.level)} ${h > g.level ? 'above' : 'below'} the level of ${g.level}`;
  return `Corner ${cx}, ${cy} · ${stands} · ${soil > 0 ? `${soil} soil over rock` : 'bare rock'}${mark}`;
}

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
    // And whether it can be stood on at all, which is the one thing about a
    // dug tile you otherwise find out by walking into it.
    const slope = w.slope(x, y);
    const cap = g.standSlope();
    if (slope > cap) lines.push(`Slope ${slope}: too steep to stand on. You manage ${Math.floor(cap)}, and climbing raises it`);
    else if (slope > SLOW_SLOPE) lines.push(`Slope ${slope}: slow going, ${Math.round((100 * SLOW_SLOPE) / slope)}% pace across it`);
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
  const paved = type === TileType.Cobblestone || type === TileType.Slabs;
  if (paved) lines.push('This is paving already. Break it up with a pickaxe and it goes back to dirt.');
  else if (def.pavable) lines.push('Takes paving: cobblestone or slabs, once it is packed hard');
  else if (!def.blocks && type !== TileType.Rock) lines.push('Will not take paving');

  // What it does underfoot, which is the one thing about ground you notice.
  const dust = dustiness(type);
  if (dust >= 0.8) lines.push('Loose and dry: it goes up in a cloud behind you');
  else if (dust === 0) lines.push('Too wet to raise anything underfoot');
  else if (dust <= 0.12) lines.push('Holds together underfoot and barely marks');

  return lines;
}
