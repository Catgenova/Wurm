/**
 * A raw material bin takes raw materials and nothing else.
 *
 * Asked for: "bulk storage bins can only accept raw materials e.g. ore, logs,
 * dirt. Rename them Raw Material Bins." The bin's door is `furnitureRefuses`,
 * and the word it reads is `ItemDef.raw`, set by hand on what comes out of
 * the ground, off a tree, out of a vein, off a beast or a field with no bench
 * between. This asks the door about a bin in a game of its own, and holds the
 * list to its own rule: every raw thing is a stackable material, none of them
 * is what a recipe makes, and every ore and every kind of shard is on it. The
 * island's `furniture_refuses` reads the same list off `item_def.raw` and
 * says the same words; the suite (404, 404b) asks it the same questions.
 */
import { Game } from '../../src/game/game';
import { FURNITURE, furnitureDef, furnitureRefuses, RAW_BIN_REFUSAL, type PlacedFurniture } from '../../src/game/furniture';
import { ITEM_DEFS, type Item } from '../../src/game/items';
import { RECIPES } from '../../src/game/recipes';

void Game;
const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, right: boolean, saw: string): void => { (right ? ok : bad).push(`${right ? 'ok  ' : 'BAD '} ${what} — ${saw}`); };

const bin = { id: 1, x: 5, y: 6, sx: 0, sy: 0, kind: 'bulk_bin', ql: 50, items: [] } as unknown as PlacedFurniture;
const thing = (id: string): Item => ({ uid: 1, id, ql: 50, dmg: 0, count: 1 });
const said = (id: string): string => furnitureRefuses(bin, thing(id)) ?? 'taken';

check('the piece is named for what it takes', furnitureDef('bulk_bin').name === 'Raw material bin' && ITEM_DEFS.bulk_bin.name === 'Raw material bin',
  `${furnitureDef('bulk_bin').name} / ${ITEM_DEFS.bulk_bin.name}`);
check('and is the one piece that takes raw materials only', FURNITURE.filter((f) => f.raw).map((f) => f.id).join() === 'bulk_bin',
  FURNITURE.filter((f) => f.raw).map((f) => f.id).join() || 'none');
// Ash moved across on the word of the person playing: "count Ash as a raw
// material." It is raked out of a fire and no bench has touched it, which is
// the whole of the test, and it is the one thing a furnace turns out by the
// cartload with nowhere bulk to put it.
const taken = ['iron_ore', 'log', 'dirt', 'rock_shards', 'wool', 'clay', 'coal', 'hide', 'ash'];
check('ore, a log, dirt, shards, wool, clay, coal, a hide and ash go in', taken.every((id) => said(id) === 'taken'), taken.map((id) => `${id}: ${said(id)}`).join(' | '));
const refused = ['plank', 'stone_brick', 'iron_lump', 'wheat', 'hatchet', 'nail', 'casting', 'wax'];
check('a plank, a brick, a lump, wheat, a hatchet, nails, a casting and wax do not', refused.every((id) => said(id) === RAW_BIN_REFUSAL),
  refused.map((id) => `${id}: ${said(id) === RAW_BIN_REFUSAL ? 'refused' : said(id)}`).join(' | '));
check('in the same words the island uses', RAW_BIN_REFUSAL === 'A raw material bin takes raw materials — ore, logs, dirt, shards, wool — and nothing a bench has touched.', RAW_BIN_REFUSAL);

const raw = Object.entries(ITEM_DEFS).filter(([, d]) => d.raw).map(([id]) => id);
const made = new Set(RECIPES.map((r) => r.result));
check('forty-one raw materials on the list', raw.length === 41, String(raw.length));
check('every one of them a stackable material', raw.every((id) => ITEM_DEFS[id].stackable && ITEM_DEFS[id].category === 'material'),
  raw.filter((id) => !(ITEM_DEFS[id].stackable && ITEM_DEFS[id].category === 'material')).join() || 'all of them');
check('none of them what a recipe makes', raw.every((id) => !made.has(id)), raw.filter((id) => made.has(id)).join() || 'none');
const ores = Object.keys(ITEM_DEFS).filter((id) => id.endsWith('_ore'));
const shards = Object.keys(ITEM_DEFS).filter((id) => id.endsWith('_shards'));
check(`every ore (${ores.length}) and every shard (${shards.length}) among them`, [...ores, ...shards].every((id) => ITEM_DEFS[id].raw),
  [...ores, ...shards].filter((id) => !ITEM_DEFS[id].raw).join() || 'all of them');

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} went wrong` : `\nall ${ok.length} right`);
process.exit(bad.length ? 1 : 0);
