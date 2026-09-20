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
import { CRAFT_BIN_REFUSAL, FURNITURE, furnitureCapacity, furnitureDef, furnitureHeft, furnitureHolds, furnitureKg, furnitureRefuses, furnitureRoom, LARDER_REFUSAL, RAW_BIN_REFUSAL, SEED_BIN_REFUSAL, SPROUT_BIN_REFUSAL, TAKES, type PlacedFurniture } from '../../src/game/furniture';
import { CROP_LIST } from '../../src/game/farming';
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
check('and is the one piece that takes raw materials only', FURNITURE.filter((f) => f.takes === 'raw').map((f) => f.id).join() === 'bulk_bin',
  FURNITURE.filter((f) => f.takes === 'raw').map((f) => f.id).join() || 'none');
// Ash went across to the raw bin once -- "count Ash as a raw material" -- and
// has come back: "change Ash back to a crafted item from a raw item." It was
// only ever there because a furnace turns it out by the cartload and there was
// nowhere bulk to put it. There is now. A fire is a bench like any other, so
// ash is a worked material and goes in the other bin.
const taken = ['iron_ore', 'log', 'dirt', 'rock_shards', 'wool', 'clay', 'coal', 'hide'];
check('ore, a log, dirt, shards, wool, clay, coal and a hide go in', taken.every((id) => said(id) === 'taken'), taken.map((id) => `${id}: ${said(id)}`).join(' | '));
const refused = ['plank', 'stone_brick', 'iron_lump', 'wheat', 'hatchet', 'nail', 'casting', 'wax', 'ash'];
check('a plank, a brick, a lump, wheat, a hatchet, nails, a casting, wax and ash do not', refused.every((id) => said(id) === RAW_BIN_REFUSAL),
  refused.map((id) => `${id}: ${said(id) === RAW_BIN_REFUSAL ? 'refused' : said(id)}`).join(' | '));
check('in the same words the island uses', RAW_BIN_REFUSAL === 'A raw material bin takes raw materials — ore, logs, dirt, shards, wool — and nothing a bench has touched.', RAW_BIN_REFUSAL);

const raw = Object.entries(ITEM_DEFS).filter(([, d]) => d.raw).map(([id]) => id);
const made = new Set(RECIPES.map((r) => r.result));
check('forty raw materials on the list', raw.length === 40, String(raw.length));
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

const worked = ['plank', 'nail', 'ribbon', 'hinge', 'iron_lump', 'stone_brick', 'cloth', 'arrow', 'ash'];
check('planks, nails, ribbons, hinges, a lump, a brick, cloth, an arrow and ash go in',
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
check('which is the forty raw and the rest worked',
  mats.filter((id) => said(id) === 'taken').length === 40
    && mats.filter((id) => csaid(id) === 'taken').length === mats.length - 40,
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
 * The other three restricted stores, added when the two became five.
 *
 * Asked for: "change the larder to only allow raw and cooked food and up items
 * hold to 250", and "create a Sprout Bin and Seed Bin, each that can hold
 * 100kg of items". A fifth flag would have been a fifth place to forget one,
 * so there is one field naming the kind and one table holding the question:
 * `TAKES`. What follows asks each of the five its own question, and then asks
 * the island the same ones off `furniture_takes`.
 */
const store = (kind: string): PlacedFurniture =>
  ({ id: 3, x: 5, y: 6, sx: 0, sy: 0, kind, ql: 50, items: [] } as unknown as PlacedFurniture);
const asked = (f: PlacedFurniture) => (id: string): string => furnitureRefuses(f, thing(id)) ?? 'taken';

const larder = store('larder');
const lsaid = asked(larder);
check('the larder holds 250 things rather than 150',
  furnitureDef('larder').capacity === 250 && furnitureCapacity(larder) === 250,
  `${furnitureCapacity(larder)} things`);
const eaten = ['meat', 'cooked_meat', 'bread', 'stew', 'apple', 'wheat', 'cheese', 'ale_bucket', 'cooked_fish'];
check('raw meat, cooked meat, bread, stew, an apple, wheat, cheese, ale and fish go in it',
  eaten.every((id) => lsaid(id) === 'taken'), eaten.map((id) => `${id}: ${lsaid(id)}`).join(' | '));
/*
 * Four of these are on the list deliberately, and are the whole of what is
 * arguable about a larder of food.
 *
 * Flour, dough and cornmeal are `material` and not `food` -- nobody eats a
 * sack of flour -- so the larder turns them away and the craft material bin
 * takes them. A bucket of water is a `tool`: it is what lye is mixed in, it
 * has no drink in it, and the buckets that *are* drunk -- ale, cider, milk,
 * mead, wine, juice -- are food and go in. All four are the honest reading of
 * the word, and they are written down here so they are decisions rather than
 * surprises.
 */
const notEaten = ['plank', 'log', 'iron_ore', 'hatchet', 'flour', 'dough', 'cornmeal', 'water_bucket', 'sprout', 'wheat_seed'];
check('planks, ore, a hatchet, flour, dough, cornmeal, water, a sprout and seed do not',
  notEaten.every((id) => lsaid(id) === LARDER_REFUSAL),
  notEaten.map((id) => `${id}: ${lsaid(id) === LARDER_REFUSAL ? 'refused' : lsaid(id)}`).join(' | '));
check('and the three that are turned away for being material go in the craft bin',
  ['flour', 'dough', 'cornmeal'].every((id) => csaid(id) === 'taken'),
  ['flour', 'dough', 'cornmeal'].map((id) => `${id}: ${csaid(id)}`).join(' | '));
const foods = Object.keys(ITEM_DEFS).filter((id) => ITEM_DEFS[id].category === 'food');
check(`every one of the ${foods.length} foods goes in and nothing else does`,
  foods.every((id) => lsaid(id) === 'taken')
    && Object.keys(ITEM_DEFS).filter((id) => lsaid(id) === 'taken').length === foods.length,
  `${Object.keys(ITEM_DEFS).filter((id) => lsaid(id) === 'taken').length} of ${foods.length}`);

const seedBin = store('seed_bin');
const ssaid = asked(seedBin);
const sproutBin = store('sprout_bin');
const psaid = asked(sproutBin);
for (const [what, f] of [['seed bin', seedBin], ['sprout bin', sproutBin]] as Array<[string, PlacedFurniture]>) {
  const def = furnitureDef(f.kind);
  check(`the ${what} is a hundred kilograms and counts nothing`,
    def.heft === 100 && def.capacity === undefined && furnitureHeft(f) === 100 && furnitureHolds(f),
    `heft ${furnitureHeft(f)} kg, capacity ${def.capacity ?? 'none'}`);
  check(`and comes off five planks and ten nails on one subtile`,
    JSON.stringify(def.bill) === JSON.stringify([['plank', 5], ['nail', 10]]) && def.w === 1 && def.h === 1,
    `${def.bill.map(([i, n]) => `${n} ${i}`).join(', ')} · ${def.w}×${def.h}`);
}
const seeds = CROP_LIST.map((c) => c.seed);
check(`all ${seeds.length} sowable seeds go in the seed bin`,
  seeds.every((id) => ssaid(id) === 'taken'), seeds.filter((id) => ssaid(id) !== 'taken').join() || 'all of them');
check('and nothing else in the game does',
  Object.keys(ITEM_DEFS).filter((id) => ssaid(id) === 'taken').length === seeds.length,
  Object.keys(ITEM_DEFS).filter((id) => ssaid(id) === 'taken' && !seeds.includes(id)).join() || 'nothing else');
check('a sprout, wheat and a plank are turned away from it',
  ['sprout', 'wheat', 'plank'].every((id) => ssaid(id) === SEED_BIN_REFUSAL),
  ['sprout', 'wheat', 'plank'].map((id) => `${id}: ${ssaid(id) === SEED_BIN_REFUSAL ? 'refused' : ssaid(id)}`).join(' | '));
check('the sprout bin takes sprouts and nothing else at all',
  psaid('sprout') === 'taken' && Object.keys(ITEM_DEFS).filter((id) => psaid(id) === 'taken').join() === 'sprout',
  Object.keys(ITEM_DEFS).filter((id) => psaid(id) === 'taken').join() || 'nothing');
check('seed goes in one and is turned away from the other',
  psaid('wheat_seed') === SPROUT_BIN_REFUSAL && ssaid('sprout') === SEED_BIN_REFUSAL,
  `${psaid('wheat_seed').slice(0, 30)}… / ${ssaid('sprout').slice(0, 30)}…`);
/*
 * A hundred kilograms in the units of what goes in it, which is the whole
 * reason both are weighed rather than counted: a sprout is 0.1 kg and a wheat
 * seed 0.02, and no one count would have been right for both.
 */
check('a thousand sprouts, five thousand wheat seeds, a thousand seed potatoes',
  furnitureRoom(sproutBin, { id: 'sprout' }) === 1000
    && furnitureRoom(seedBin, { id: 'wheat_seed' }) === 5000
    && furnitureRoom(seedBin, { id: 'potato_seed' }) === 1000,
  `${furnitureRoom(sproutBin, { id: 'sprout' })} sprouts · ${furnitureRoom(seedBin, { id: 'wheat_seed' })} wheat seeds`
    + ` · ${furnitureRoom(seedBin, { id: 'potato_seed' })} seed potatoes`);

/*
 * And the field itself: five stores, five rows in `TAKES`, and every one of
 * them pointed at by exactly one piece.
 */
const restricted = FURNITURE.filter((f) => f.takes);
check('five stores take one sort of thing, one for each row of the table',
  restricted.map((f) => `${f.id}:${f.takes}`).join(' ') === 'larder:food bulk_bin:raw craft_bin:worked seed_bin:seed sprout_bin:sprout'
    && Object.keys(TAKES).length === 5,
  restricted.map((f) => `${f.id}:${f.takes}`).join(' '));

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
const EATEN = eaten.map((id) => `'${id}'`).join(',');
const NOT_EATEN = notEaten.map((id) => `'${id}'`).join(',');
const SEEDS = seeds.map((id) => `'${id}'`).join(',');
const out = psql(`
begin;
create temp table said (line text) on commit drop;
do $$
declare w uuid; v_raw bigint; v_craft bigint; p placed; q placed;
        v_larder bigint; v_seed bigint; v_sprout bigint; l placed; sd placed; sp placed;
        v_oak bigint; oak placed; v_apple bigint; app placed;
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
    || '|' || furniture_room(q, 'timber') || '|' || furniture_room(p, 'log')
    || '|' || furniture_room(q, 'sprout');
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

  /*
   * And the three that came with them: a larder of food, a bin of seed and a
   * bin of sprouts. Same questions, same words, same numbers.
   */
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql)
    values (w, 'furniture', 'larder', 400, 402, 0, 0, 400.5, 402.5, 50) returning id into v_larder;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql)
    values (w, 'furniture', 'seed_bin', 400, 403, 0, 0, 400.5, 403.5, 50) returning id into v_seed;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql)
    values (w, 'furniture', 'sprout_bin', 400, 404, 0, 0, 400.5, 404.5, 50) returning id into v_sprout;
  select * into l from placed where id = v_larder;
  select * into sd from placed where id = v_seed;
  select * into sp from placed where id = v_sprout;

  insert into said select 'LARDER|' || furniture_capacity(l) || '|' || furniture_heft(l);
  insert into said select 'ATE|' || coalesce(string_agg(d.id || ':'
      || coalesce(furniture_refuses(l, d.id), 'taken'), ' | ' order by d.id), 'none')
    from item_def d where d.id in (${EATEN});
  insert into said select 'NOTATE|' || coalesce(string_agg(d.id || ':'
      || coalesce(furniture_refuses(l, d.id), 'taken'), ' | ' order by d.id), 'none')
    from item_def d where d.id in (${NOT_EATEN});
  -- Every food in the rulebook goes in it, and nothing that is not one does.
  insert into said select 'FOODS|' || count(*) filter (where d.category = 'food')
    || '|' || count(*) filter (where furniture_refuses(l, d.id) is null)
    from item_def d;
  insert into said select 'SMALL|' || furniture_heft(sd) || '|' || furniture_capacity(sd)
    || '|' || furniture_heft(sp) || '|' || furniture_capacity(sp);
  insert into said select 'SEEDS|' || count(*) filter (where furniture_refuses(sd, d.id) is null)
    || '|' || count(*) filter (where furniture_refuses(sd, d.id) is null and d.id in (${SEEDS}))
    || '|' || count(*) filter (where furniture_refuses(sp, d.id) is null)
    from item_def d;
  insert into said select 'SMALLROOM|' || furniture_room(sp, 'sprout')
    || '|' || furniture_room(sd, 'wheat_seed') || '|' || furniture_room(sd, 'potato_seed');
  insert into said select 'SMALLWORDS|' || furniture_refuses(l, 'plank')
    || '~' || furniture_refuses(sd, 'sprout') || '~' || furniture_refuses(sp, 'wheat_seed');
  /*
   * And one built of oak, which holds 1.12 times what a plain one does. The
   * product has to be rounded the same way on both sides or the bin is a
   * sprout short: 112 kg and 1,120 sprouts, not 111.999999 and 1,119.
   */
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material)
    values (w, 'furniture', 'sprout_bin', 400, 405, 0, 0, 400.5, 405.5, 50, 'oak') returning id into v_oak;
  select * into oak from placed where id = v_oak;
  insert into said select 'OAK|' || furniture_heft(oak) || '|' || furniture_room(oak, 'sprout');
  -- And one of apple, which is one of the four the rounding was wrong for.
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material)
    values (w, 'furniture', 'sprout_bin', 400, 406, 0, 0, 400.5, 406.5, 50, 'apple') returning id into v_apple;
  select * into app from placed where id = v_apple;
  insert into said select 'APPLE|' || furniture_heft(app) || '|' || furniture_room(app, 'sprout');
end $$;
select * from said;
rollback;
`);
const say = (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

check('the island stands one up and calls it a store, measured in kilograms',
  say('HOLDS') === 'true|2500|0', say('HOLDS'));
check('and takes the same nine worked things the browser takes',
  say('TAKEN') === worked.map((id) => `${id}:taken`).sort().join(' | '), say('TAKEN'));
check('and refuses the same eight, in the browser’s words',
  say('REFUSED') === notWorked.map((id) => `${id}:${CRAFT_BIN_REFUSAL}`).sort().join(' | '),
  say('REFUSED').slice(0, 90));
check('word for word, both ways round',
  say('WORDS') === CRAFT_BIN_REFUSAL && say('RAWWORDS') === RAW_BIN_REFUSAL,
  `${say('WORDS').slice(0, 44)}… / ${say('RAWWORDS').slice(0, 40)}…`);
/*
 * The last of those five is the one that had been wrong all along.
 *
 * `item_def.weight` is a `real` and the browser's weight is a double, and
 * both were written from the same decimal. 0.1 is not exactly representable
 * in either, and the two roundings are not the same one: the island divided
 * 2500 by 0.100000001490116 and said 24,999 where the browser divided by
 * 0.100000000000000006 and said 25,000. Every weight the bin had been asked
 * about until now -- 0.01, 2, 6 -- happened to come out the same either way.
 * `item_kg` reads the weight back through its own text, which is the decimal
 * it was written from, so both sides now divide the same two numbers.
 */
check('and counts out the same room as the browser does, 0.1 kg included',
  say('ROOM') === `${room('nail')}|${room('plank')}|${room('timber')}|400|${room('sprout')}`
    && room('sprout') === 25000,
  `${say('ROOM')} · browser ${room('sprout')} for a sprout`);
check('five hundred planks in leaves the same seven hundred and fifty',
  say('PART') === `${furnitureKg(part)}|${furnitureRoom(part, { id: 'plank' })}`, say('PART'));
check('and the island splits the materials the way the browser does',
  say('SPLIT') === `40|${mats.length - 40}|0`, `${say('SPLIT')} raw | worked | both`);

check('the island stands a larder up and it holds 250 counted things',
  say('LARDER') === '250|0', say('LARDER'));
check('and takes the same nine foods the browser takes',
  say('ATE') === eaten.map((id) => `${id}:taken`).sort().join(' | '), say('ATE'));
check('and turns away the same ten, flour and a bucket of water among them',
  say('NOTATE') === notEaten.map((id) => `${id}:${LARDER_REFUSAL}`).sort().join(' | '),
  say('NOTATE').slice(0, 90));
check('every food on the island goes in it and nothing else does',
  say('FOODS') === `${foods.length}|${foods.length}`, `${say('FOODS')} foods | taken`);
check('the two small bins are a hundred kilograms apiece and count nothing',
  say('SMALL') === '100|0|100|0', say('SMALL'));
check(`and the seed bin takes the ${seeds.length} seeds, the sprout bin the one sprout`,
  say('SEEDS') === `${seeds.length}|${seeds.length}|1`, `${say('SEEDS')} taken | seeds | sprouts`);
check('with the same room in them the browser counts',
  say('SMALLROOM') === `${furnitureRoom(sproutBin, { id: 'sprout' })}|${furnitureRoom(seedBin, { id: 'wheat_seed' })}`
    + `|${furnitureRoom(seedBin, { id: 'potato_seed' })}`, say('SMALLROOM'));
/*
 * The same disagreement one step up, and the same fix.
 *
 * A bin built of a stronger wood holds more than a plain one. The browser
 * rounded that product to a whole kilogram and the island did not, and four
 * woods came out a sprout short of the browser's number: a hundred kilograms
 * of apple or pomegranate held 1059 sprouts against 1060, of maple or pear
 * 1049 against 1050. `furniture_heft` rounds now, as the browser always did.
 *
 * Oak is the one asked here rather than one of those four, because oak was
 * already right -- 112 kg either way -- and a check that only passes on the
 * four that were wrong would not notice the rounding being taken out again.
 */
const woodBin = (wood: string): PlacedFurniture => ({ ...sproutBin, material: wood } as unknown as PlacedFurniture);
const oakBin = woodBin('oak');
const appleBin = woodBin('apple');
check('a sprout bin of oak holds 112 kg, and the island agrees to the sprout',
  furnitureHeft(oakBin) === 112 && furnitureRoom(oakBin, { id: 'sprout' }) === 1120
    && say('OAK') === `112|1120`,
  `browser ${furnitureHeft(oakBin)} kg / ${furnitureRoom(oakBin, { id: 'sprout' })} sprouts · island ${say('OAK')}`);
check('and one of apple holds 106 kg and 1060 sprouts, which is the one that was 1059',
  furnitureHeft(appleBin) === 106 && furnitureRoom(appleBin, { id: 'sprout' }) === 1060
    && say('APPLE') === `106|1060`,
  `browser ${furnitureHeft(appleBin)} kg / ${furnitureRoom(appleBin, { id: 'sprout' })} sprouts · island ${say('APPLE')}`);
check('and all three refuse in the browser’s words, to the dash',
  say('SMALLWORDS') === [LARDER_REFUSAL, SEED_BIN_REFUSAL, SPROUT_BIN_REFUSAL].join('~'),
  say('SMALLWORDS').slice(0, 90));

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} went wrong` : `\nall ${ok.length} right`);
process.exit(bad.length ? 1 : 0);
