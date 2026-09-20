/**
 * Two bins, and the line drawn between them.
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
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { CRAFT_BIN_REFUSAL, FURNITURE, furnitureDef, furnitureHeft, furnitureHolds, furnitureKg, furnitureRefuses, furnitureRoom, RAW_BIN_REFUSAL, type PlacedFurniture } from '../../src/game/furniture';
import { ITEM_DEFS, type Item } from '../../src/game/items';
import { RECIPES } from '../../src/game/recipes';

void Game;
const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, right: boolean, saw: string): void => { (right ? ok : bad).push(`${right ? 'ok  ' : 'BAD '} ${what} — ${saw}`); };


const psql = (sql: string): string =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
    env: {
      ...process.env,
      PGHOST: process.env.PGHOST ?? '/var/run/postgresql',
      PGPORT: process.env.PGPORT ?? '5433',
      PGUSER: process.env.PGUSER ?? 'wurm',
      PGDATABASE: process.env.PGDATABASE ?? 'postgres',
    },
  }).trim();

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

/*
 * The other bin, and the line drawn between the two of them.
 *
 * Asked for: "a bin that can hold infinite item count, instead limited by KG.
 * 2500kg worth of crafted items, same material cost as raw material bin." So
 * it is the raw bin's bill to the nail, and the opposite door: the exact
 * complement of `raw` inside the material category, which is what makes the
 * pair a partition rather than two overlapping boxes.
 */
const cbin = { id: 2, x: 5, y: 6, sx: 0, sy: 0, kind: 'craft_bin', ql: 50, items: [] } as unknown as PlacedFurniture;
const csaid = (id: string): string => furnitureRefuses(cbin, thing(id)) ?? 'taken';

const rawDef = furnitureDef('bulk_bin');
const craftDef = furnitureDef('craft_bin');
check('the two bins come off the same bill, to the nail',
  JSON.stringify(craftDef.bill) === JSON.stringify(rawDef.bill)
    && craftDef.difficulty === rawDef.difficulty && craftDef.time === rawDef.time
    && craftDef.w === rawDef.w && craftDef.h === rawDef.h,
  `${craftDef.bill.map(([i, n]) => `${n} ${i}`).join(', ')} · difficulty ${craftDef.difficulty} · ${craftDef.time}s`);
check('and it is counted in kilograms rather than in things',
  craftDef.heft === 2500 && craftDef.capacity === undefined,
  `heft ${craftDef.heft} kg, capacity ${craftDef.capacity ?? 'none'}`);
check('which still makes it a thing that holds things',
  furnitureHolds(cbin) && furnitureHeft(cbin) === 2500, `holds ${furnitureHolds(cbin)}, ${furnitureHeft(cbin)} kg`);

const worked = ['plank', 'nail', 'ribbon', 'hinge', 'iron_lump', 'stone_brick', 'cloth', 'arrow'];
check('planks, nails, ribbons, hinges, a lump, a brick, cloth and an arrow go in',
  worked.every((id) => csaid(id) === 'taken'), worked.map((id) => `${id}: ${csaid(id)}`).join(' | '));
const notWorked = ['iron_ore', 'log', 'dirt', 'wool', 'hatchet', 'bread', 'sage', 'coin'];
check('ore, a log, dirt, wool, a hatchet, bread, sage and a coin do not',
  notWorked.every((id) => csaid(id) === CRAFT_BIN_REFUSAL),
  notWorked.map((id) => `${id}: ${csaid(id) === CRAFT_BIN_REFUSAL ? 'refused' : csaid(id)}`).join(' | '));
check('in the same words the island uses',
  CRAFT_BIN_REFUSAL === 'A craft material bin takes worked materials — planks, nails, ribbons, hinges — and nothing that has not been through a bench.',
  CRAFT_BIN_REFUSAL);

/*
 * The partition, asked of every item there is: each one goes in exactly one
 * of the two bins, or in neither, and never in both.
 */
const both = Object.keys(ITEM_DEFS).filter((id) => said(id) === 'taken' && csaid(id) === 'taken');
check('nothing at all goes in both bins', both.length === 0, both.join() || 'none');
const mats = Object.keys(ITEM_DEFS).filter((id) => ITEM_DEFS[id].category === 'material');
const homeless = mats.filter((id) => said(id) !== 'taken' && csaid(id) !== 'taken');
check(`and every one of the ${mats.length} materials goes in one of them`, homeless.length === 0, homeless.join() || 'all placed');
check('which is the forty-one raw and the rest worked',
  mats.filter((id) => said(id) === 'taken').length === 41
    && mats.filter((id) => csaid(id) === 'taken').length === mats.length - 41,
  `${mats.filter((id) => said(id) === 'taken').length} raw, ${mats.filter((id) => csaid(id) === 'taken').length} worked`);

/*
 * And the room it has, which is the whole point: the same bin is a quarter of
 * a million nails or twelve hundred planks, because what fills it is weight.
 */
const room = (id: string): number => furnitureRoom(cbin, { id });
check('a quarter of a million nails, or twelve hundred planks, in the same bin',
  room('nail') === 250000 && room('plank') === 1250 && room('timber') === 416,
  `nail ${room('nail')} · plank ${room('plank')} · timber ${room('timber')}`);
const part = { ...cbin, items: [{ uid: 9, id: 'plank', ql: 50, dmg: 0, count: 500 }] } as unknown as PlacedFurniture;
check('and a thousand kilos of planks in it leaves room for seven hundred and fifty more',
  furnitureKg(part) === 1000 && furnitureRoom(part, { id: 'plank' }) === 750,
  `${furnitureKg(part)} kg in it, ${furnitureRoom(part, { id: 'plank' })} planks to go`);
const full = { ...cbin, items: [{ uid: 9, id: 'plank', ql: 50, dmg: 0, count: 1250 }] } as unknown as PlacedFurniture;
check('and a full one says so, in the words a full chest says',
  furnitureRoom(full, { id: 'plank' }) === 0 && furnitureRefuses(full, thing('plank')) === null,
  `${furnitureKg(full)} / ${furnitureHeft(full)} kg, room for ${furnitureRoom(full, { id: 'plank' })}`);
check('while a counting piece answers the same question the same way it always did',
  furnitureRoom(bin, thing('log')) === 400 && furnitureRoom({ ...bin, items: [{ uid: 9, id: 'log', ql: 50, dmg: 0, count: 90 }] } as unknown as PlacedFurniture, thing('log')) === 310,
  `${furnitureRoom(bin, thing('log'))} empty, 310 with ninety in it`);

/*
 * And the island, asked the same questions off its own tables.
 *
 * A bin is stood up in a transaction that is rolled back, so the suite's
 * island is exactly as it was afterwards. `furniture_refuses` has to say the
 * browser's sentences word for word, and `furniture_room` has to answer the
 * browser's numbers -- a quarter of a million nails, twelve hundred planks --
 * because that is the whole of what "the rules are written once per side"
 * means for a bin.
 */
const WORKED = worked.map((id) => `'${id}'`).join(',');
const NOT_WORKED = notWorked.map((id) => `'${id}'`).join(',');
const out = psql(`
begin;
create temp table said (line text) on commit drop;
do $$
declare w uuid; v_raw bigint; v_craft bigint; p placed; q placed;
begin
  select id into w from world order by made_at, id limit 1;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql)
    values (w, 'furniture', 'bulk_bin', 400, 400, 0, 0, 400.5, 400.5, 50) returning id into v_raw;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql)
    values (w, 'furniture', 'craft_bin', 400, 401, 0, 0, 400.5, 401.5, 50) returning id into v_craft;
  select * into p from placed where id = v_raw;
  select * into q from placed where id = v_craft;

  insert into said select 'HOLDS|' || furniture_holds(q) || '|' || furniture_heft(q)
    || '|' || furniture_capacity(q);
  insert into said select 'TAKEN|' || coalesce(string_agg(d.id || ':'
      || coalesce(furniture_refuses(q, d.id), 'taken'), ' | ' order by d.id), 'none')
    from item_def d where d.id in (${WORKED});
  insert into said select 'REFUSED|' || coalesce(string_agg(d.id || ':'
      || coalesce(furniture_refuses(q, d.id), 'taken'), ' | ' order by d.id), 'none')
    from item_def d where d.id in (${NOT_WORKED});
  insert into said select 'WORDS|' || furniture_refuses(q, 'log');
  insert into said select 'RAWWORDS|' || furniture_refuses(p, 'plank');
  insert into said select 'ROOM|' || furniture_room(q, 'nail') || '|' || furniture_room(q, 'plank')
    || '|' || furniture_room(q, 'timber') || '|' || furniture_room(p, 'log');
  -- Five hundred planks in, and what is left.
  insert into item (world_id, holder, placed, def, ql, count)
    values (w, 'furniture', v_craft, 'plank', 50, 500);
  select * into q from placed where id = v_craft;
  insert into said select 'PART|' || round(furniture_kg(q))::int || '|' || furniture_room(q, 'plank');
  -- Both bins partition the materials, on the island's own tables too.
  insert into said select 'SPLIT|' || count(*) filter (where furniture_refuses(p, d.id) is null)
    || '|' || count(*) filter (where furniture_refuses(q, d.id) is null)
    || '|' || count(*) filter (where furniture_refuses(p, d.id) is null
                                 and furniture_refuses(q, d.id) is null)
    from item_def d where d.category = 'material';
end $$;
select * from said;
rollback;
`);
const say = (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

check('the island stands one up and calls it a store, measured in kilograms',
  say('HOLDS') === 'true|2500|0', say('HOLDS'));
check('and takes the same eight worked things the browser takes',
  say('TAKEN') === worked.map((id) => `${id}:taken`).sort().join(' | '), say('TAKEN'));
check('and refuses the same eight, in the browser’s words',
  say('REFUSED') === notWorked.map((id) => `${id}:${CRAFT_BIN_REFUSAL}`).sort().join(' | '),
  say('REFUSED').slice(0, 90));
check('word for word, both ways round',
  say('WORDS') === CRAFT_BIN_REFUSAL && say('RAWWORDS') === RAW_BIN_REFUSAL,
  `${say('WORDS').slice(0, 44)}… / ${say('RAWWORDS').slice(0, 40)}…`);
check('and counts out the same room as the browser does',
  say('ROOM') === `${room('nail')}|${room('plank')}|${room('timber')}|400`, say('ROOM'));
check('five hundred planks in leaves the same seven hundred and fifty',
  say('PART') === `${furnitureKg(part)}|${furnitureRoom(part, { id: 'plank' })}`, say('PART'));
check('and the island splits the materials the way the browser does',
  say('SPLIT') === `41|${mats.length - 41}|0`, `${say('SPLIT')} raw | worked | both`);

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} went wrong` : `\nall ${ok.length} right`);
process.exit(bad.length ? 1 : 0);
