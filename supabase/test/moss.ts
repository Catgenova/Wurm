/**
 * Collect dirt, moss cut as grass is, and moss planted on dirt, the same on both sides.
 *
 * Asked for: "Add a collect dirt and collect moss option for each respective
 * tile, that operates like collect clay/sand. Moss can be planted in 10qty on
 * a dirt tile to change it to moss." And then: "Nix collect moss, make that
 * cuttable like grass into mixed grass, but yielding moss." So:
 *
 *   * Collect is offered on dirt as it is on sand and clay, and fills a shovel
 *     off the top of the tile without changing it; a moss tile and a grass
 *     tile have no bed to collect off, refused in the same words both sides;
 *   * Cut moss, on a moss tile, gives `MOSS_PER_CUT` moss and leaves the tile
 *     moss, and the tile cannot be cut again until it has grown back, as with
 *     Cut grass, in the same words both sides;
 *   * Plant moss takes `MOSS_PLANT` moss from the pack and turns a tile of
 *     dirt to moss, refused in the same words when there is too little moss,
 *     when the tile is not dirt and when it is under water;
 *   * and Plant grass, asked after a player found no way to plant grass, takes
 *     `GRASS_PLANT` mixed grass and turns a tile of dirt to grass, uncut and
 *     unpicked, refused in the same words as moss is;
 *   * a tile of dirt dug to its last spadeful shows the rock under it on both
 *     sides, as it did before dirt could be collected from, while a bed of
 *     sand stays sand;
 *   * and the tiles the island reads say the same as the browser's.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, GRASS_PER_CUT, GRASS_PLANT, MOSS_PER_CUT, MOSS_PLANT, type Target } from '../../src/game/actions';
import { itemDef } from '../../src/game/items';
import { numberWord } from '../../src/game/words';
import { TILE_DEFS, TileType } from '../../src/world/tiles';

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

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

/** The tiles everything is tried on, all dry and level: dirt, moss, grass, and a dirt tile under the sea. */
const DIRT = [3, 3] as const;
const MOSS = [5, 3] as const;
const GRASS = [7, 3] as const;
const WET = [9, 3] as const;
/** A second tile of dirt, for grass to be planted on once the first is moss. */
const PATCH = [5, 5] as const;
/** A tile of dirt and a bed of sand, each with no soil left on any corner. */
const BARE_DIRT = [3, 5] as const;
const BARE_SAND = [7, 5] as const;
const LEVEL = 40;
const SUNK = -5;

/* ---- the island ------------------------------------------------------------ */
const tileT = (at: readonly [number, number]): string => `jsonb_build_object('kind', 'tile', 'x', ${at[0]}, 'y', ${at[1]}, 'cx', ${at[0]}, 'cy', ${at[1]})`;
const stand = (at: readonly [number, number]): string =>
  `update player set x = ${at[0]} + 0.5, y = ${at[1]} + 0.5 where world_id = w and uid = u;`;
const count = (def: string): string =>
  `(select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = '${def}')`;
const refused = (a: string, at: readonly [number, number]): string => `coalesce(act_refusal(w, u, '${a}', ${tileT(at)}), 'ALLOWED')`;
/** The last thing said to that person that begins so: a skill gained is said after the work. */
const lastSaid = (start: string): string =>
  `coalesce((select e.text from event e where e.world_id = w and e.uid = u and e.text like '${start}%' order by e.n desc limit 1), 'unsaid')`;

const out = psql(`
begin;
create temp table said (k text, v text);
-- Every go comes off: what is asked here is what a go gives, not how often.
create or replace function skill_check(p_skill double precision, p_difficulty double precision,
  p_tool_ql double precision default 0, p_ease double precision default 0) returns boolean language sql as 'select true';
do $$
declare w uuid; u uuid; x int; y int;
begin
  -- The suite's own island and the first person on it, with an empty pack and nobody's settlement.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  delete from deed where world_id = w;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  delete from foraged where world_id = w;
  update player set act = null, act_queue = '[]', stats = '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb
    where world_id = w and uid = u;
  for x in 0..12 loop for y in 0..6 loop perform land_set_height(w, x, y, ${LEVEL}); end loop; end loop;
  perform land_set_tile(w, ${DIRT[0]}, ${DIRT[1]}, tile_id('Dirt'));
  perform land_set_tile(w, ${MOSS[0]}, ${MOSS[1]}, tile_id('Moss'));
  perform land_set_tile(w, ${GRASS[0]}, ${GRASS[1]}, tile_id('Grass'));
  perform land_set_tile(w, ${WET[0]}, ${WET[1]}, tile_id('Dirt'));
  for x in ${WET[0]}..${WET[0] + 1} loop for y in ${WET[1]}..${WET[1] + 1} loop perform land_set_height(w, x, y, ${SUNK}); end loop; end loop;
  perform give(w, u, 'shovel', 1, 50);

  insert into said values ('DEFS', (select string_agg(name || ':' || collect || ':' || bed || ':' || coalesce(dig_yield, '-'), ',' order by id)
    from tile_def where name in ('Dirt', 'Moss', 'Grass', 'Sand', 'Clay')));
  insert into said values ('COLUMN', (select count(*)::text from information_schema.columns
    where table_name = 'tile_def' and column_name = 'collect_yield'));

  /* Dug bare: dirt shows the rock, a bed of sand stays sand. */
  perform land_set_tile(w, ${BARE_DIRT[0]}, ${BARE_DIRT[1]}, tile_id('Dirt'));
  perform land_set_tile(w, ${BARE_SAND[0]}, ${BARE_SAND[1]}, tile_id('Sand'));
  for x in 0..1 loop for y in 0..1 loop
    perform land_set_dirt(w, ${BARE_DIRT[0]} + x, ${BARE_DIRT[1]} + y, 0);
    perform land_set_dirt(w, ${BARE_SAND[0]} + x, ${BARE_SAND[1]} + y, 0);
  end loop; end loop;
  perform reconcile(w, ${BARE_DIRT[0]}, ${BARE_DIRT[1]});
  perform reconcile(w, ${BARE_SAND[0]}, ${BARE_SAND[1]});
  insert into said values ('BARED', land_tile(w, ${BARE_DIRT[0]}, ${BARE_DIRT[1]}) || '|' || land_tile(w, ${BARE_SAND[0]}, ${BARE_SAND[1]}));

  /* Collect: dirt off dirt, the tile as it was; moss and grass refused. */
  ${stand(DIRT)}
  insert into said values ('DIRT_REF', ${refused('collect', DIRT)});
  perform perform_gather(w, u, 'collect', ${tileT(DIRT)});
  insert into said values ('DIRT', ${count('dirt')} || '|' || land_tile(w, ${DIRT[0]}, ${DIRT[1]}));
  ${stand(MOSS)}
  insert into said values ('MOSS_REF', ${refused('collect', MOSS)});
  ${stand(GRASS)}
  insert into said values ('GRASS_REF', ${refused('collect', GRASS)});

  /* Cut moss: moss off moss, the tile as it was, then short; nothing to cut on grass. */
  ${stand(MOSS)}
  insert into said values ('CUT_REF', ${refused('cut_moss', MOSS)});
  perform perform_ground(w, u, 'cut_moss', ${tileT(MOSS)});
  insert into said values ('CUT', ${count('moss')} || '|' || ${count('mixed_grass')} || '|' || land_tile(w, ${MOSS[0]}, ${MOSS[1]}));
  insert into said values ('CUT_SAID', ${lastSaid('You cut')});
  insert into said values ('SHORT', ${refused('cut_moss', MOSS)});
  ${stand(GRASS)}
  insert into said values ('NO_MOSS', ${refused('cut_moss', GRASS)});

  /* Plant moss: too little of it, the wrong ground, under water, and then done. */
  ${stand(DIRT)}
  insert into said values ('FEW', ${refused('plant_moss', DIRT)});
  perform give(w, u, 'moss', ${MOSS_PLANT - MOSS_PER_CUT}, 50);
  ${stand(GRASS)}
  insert into said values ('NOT_DIRT', ${refused('plant_moss', GRASS)});
  ${stand(WET)}
  insert into said values ('WET', ${refused('plant_moss', WET)});
  ${stand(DIRT)}
  insert into said values ('PLANT_REF', ${refused('plant_moss', DIRT)});
  perform perform_farm(w, u, 'plant_moss', ${tileT(DIRT)});
  insert into said values ('PLANTED', land_tile(w, ${DIRT[0]}, ${DIRT[1]}) || '|' || ${count('moss')});
  insert into said values ('SAID', ${lastSaid('You plant')});

  /* Plant grass: a cut's worth of mixed grass is too little, then the wrong ground, under water, and done. */
  perform land_set_tile(w, ${PATCH[0]}, ${PATCH[1]}, tile_id('Dirt'));
  perform give(w, u, 'mixed_grass', ${GRASS_PER_CUT}, 50);
  ${stand(PATCH)}
  insert into said values ('G_FEW', ${refused('plant_grass', PATCH)});
  perform give(w, u, 'mixed_grass', ${GRASS_PLANT - GRASS_PER_CUT}, 50);
  ${stand(GRASS)}
  insert into said values ('G_NOT_DIRT', ${refused('plant_grass', GRASS)});
  ${stand(WET)}
  insert into said values ('G_WET', ${refused('plant_grass', WET)});
  ${stand(PATCH)}
  insert into said values ('G_REF', ${refused('plant_grass', PATCH)});
  perform perform_farm(w, u, 'plant_grass', ${tileT(PATCH)});
  insert into said values ('G_PLANTED', land_tile(w, ${PATCH[0]}, ${PATCH[1]}) || '|' || land_data(w, ${PATCH[0]}, ${PATCH[1]}) || '|' || ${count('mixed_grass')});
  insert into said values ('G_SAID', ${lastSaid('You plant')});
end $$;
select k || E'\\t' || coalesce(v, 'null') from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const at = l.indexOf('\t');
  return [l.slice(0, at), l.slice(at + 1)] as [string, string];
}));
const say = (k: string): string => said.get(k) ?? '(nothing)';

const browserDefs = [TileType.Grass, TileType.Sand, TileType.Dirt, TileType.Clay, TileType.Moss]
  .sort((a, b) => a - b)
  .map((id) => { const d = TILE_DEFS[id]; return `${d.name}:${d.collect ? 'true' : 'false'}:${d.bed ? 'true' : 'false'}:${d.digYield ?? '-'}`; });
check('the island reads the same tiles as the browser: what can be collected, which are beds, and what digging gives',
  say('DEFS') === browserDefs.join(','), `${say('DEFS')} against ${browserDefs.join(',')}`);
check('and the island keeps no column for what Collect gives apart from digging', say('COLUMN') === '0', say('COLUMN'));

const [baredDirt, baredSand] = say('BARED').split('|');
check('on the island a tile of dirt dug bare shows the rock, and a bed of sand dug bare stays sand',
  Number(baredDirt) === TileType.Rock && Number(baredSand) === TileType.Sand, say('BARED'));

const [dirt1, dirtTile] = say('DIRT').split('|');
check('Collect on dirt fills a shovel with dirt on the island, and the tile stays dirt',
  say('DIRT_REF') === 'ALLOWED' && dirt1 === '1' && Number(dirtTile) === TileType.Dirt, `${say('DIRT_REF')} / ${say('DIRT')}`);
check('moss has no bed to collect off', say('MOSS_REF') === 'There is no bed of anything here.', say('MOSS_REF'));
check('nor has grass', say('GRASS_REF') === 'There is no bed of anything here.', say('GRASS_REF'));

const [moss1, grass1, mossTile] = say('CUT').split('|');
check(`Cut moss gives ${MOSS_PER_CUT} moss on the island, no mixed grass, and the tile stays moss`,
  say('CUT_REF') === 'ALLOWED' && moss1 === String(MOSS_PER_CUT) && grass1 === '0' && Number(mossTile) === TileType.Moss,
  `${say('CUT_REF')} / ${say('CUT')}`);
check('and says so', say('CUT_SAID') === `You cut ${numberWord(MOSS_PER_CUT)} clumps of moss.`, say('CUT_SAID'));
check('cut once, the tile is short until it grows back', say('SHORT') === 'The moss here is still short.', say('SHORT'));
check('and there is no moss to cut on grass', say('NO_MOSS') === 'There is no moss here to cut.', say('NO_MOSS'));

check(`Plant moss with ${MOSS_PER_CUT} moss is refused for want of ${MOSS_PLANT}`,
  say('FEW') === `It takes ${MOSS_PLANT} moss to plant a tile; you have ${MOSS_PER_CUT}.`, say('FEW'));
check('and on grass, for it is not dirt', say('NOT_DIRT') === 'Moss is planted on a tile of dirt.', say('NOT_DIRT'));
check('and under water', say('WET') === 'You cannot plant moss underwater.', say('WET'));
const [plantedTile, left] = say('PLANTED').split('|');
check(`with ${MOSS_PLANT} moss the dirt turns to moss and the moss is used up`,
  say('PLANT_REF') === 'ALLOWED' && Number(plantedTile) === TileType.Moss && left === '0', `${say('PLANT_REF')} / ${say('PLANTED')}`);
check('and it says so', say('SAID') === `You plant ${MOSS_PLANT} moss and the dirt is moss now.`, say('SAID'));

check(`Plant grass with ${GRASS_PER_CUT} mixed grass is refused for want of ${GRASS_PLANT}`,
  say('G_FEW') === `It takes ${GRASS_PLANT} mixed grass to plant a tile; you have ${GRASS_PER_CUT}.`, say('G_FEW'));
check('and on grass, for it is not dirt', say('G_NOT_DIRT') === 'Grass is planted on a tile of dirt.', say('G_NOT_DIRT'));
check('and under water', say('G_WET') === 'You cannot plant grass underwater.', say('G_WET'));
const [grassTile, grassData, grassLeft] = say('G_PLANTED').split('|');
check(`with ${GRASS_PLANT} mixed grass the dirt turns to grass, uncut and unpicked, and the mixed grass is used up`,
  say('G_REF') === 'ALLOWED' && Number(grassTile) === TileType.Grass && grassData === '0' && grassLeft === '0',
  `${say('G_REF')} / ${say('G_PLANTED')}`);
check('and it says so', say('G_SAID') === `You plant ${GRASS_PLANT} mixed grass and the dirt is grass now.`, say('G_SAID'));

/* ---- the browser ----------------------------------------------------------- */
const game = Game.create(4405);
game.inventory.items.splice(0);
(game as unknown as { skillCheck: () => boolean }).skillCheck = () => true;
const w = game.world;
for (let x = 0; x <= 12; x++) for (let y = 0; y <= 6; y++) w.setHeight(x, y, LEVEL);
w.setTile(DIRT[0], DIRT[1], TileType.Dirt);
w.setTile(MOSS[0], MOSS[1], TileType.Moss);
w.setTile(GRASS[0], GRASS[1], TileType.Grass);
w.setTile(WET[0], WET[1], TileType.Dirt);
for (let x = WET[0]; x <= WET[0] + 1; x++) for (let y = WET[1]; y <= WET[1] + 1; y++) w.setHeight(x, y, SUNK);
game.inventory.add('shovel', { ql: 50 });
w.setTile(BARE_DIRT[0], BARE_DIRT[1], TileType.Dirt);
w.setTile(BARE_SAND[0], BARE_SAND[1], TileType.Sand);
for (let x = 0; x <= 1; x++) for (let y = 0; y <= 1; y++) {
  w.setDirt(BARE_DIRT[0] + x, BARE_DIRT[1] + y, 0);
  w.setDirt(BARE_SAND[0] + x, BARE_SAND[1] + y, 0);
}
w.reconcile(BARE_DIRT[0], BARE_DIRT[1]);
w.reconcile(BARE_SAND[0], BARE_SAND[1]);
check('and in the browser the same',
  w.getTile(BARE_DIRT[0], BARE_DIRT[1]) === TileType.Rock && w.getTile(BARE_SAND[0], BARE_SAND[1]) === TileType.Sand,
  `${w.getTile(BARE_DIRT[0], BARE_DIRT[1])}|${w.getTile(BARE_SAND[0], BARE_SAND[1])}`);
const at = (p: readonly [number, number]): Target => ({ kind: 'tile', x: p[0], y: p[1], cx: p[0], cy: p[1] });
const collect = ACTION_BY_ID.get('collect')!;
const cut = ACTION_BY_ID.get('cut_moss')!;
const plant = ACTION_BY_ID.get('plant_moss')!;

check('Collect is offered on dirt in the browser, as Collect dirt, and not on moss or grass',
  collect.applies(at(DIRT), game) && collect.labelFor?.(at(DIRT), game) === 'Collect dirt'
    && !collect.applies(at(MOSS), game) && !collect.applies(at(GRASS), game));
collect.perform(at(DIRT), game);
check('the browser collects one dirt off dirt, the tile as it was',
  game.inventory.count('dirt') === 1 && w.getTile(DIRT[0], DIRT[1]) === TileType.Dirt);
check('Cut moss is offered on moss in the browser, and not on grass or dirt',
  cut.applies(at(MOSS), game) && cut.label === 'Cut moss' && !cut.applies(at(GRASS), game) && !cut.applies(at(DIRT), game));
check('and allowed on moss not cut lately', (cut.check?.(at(MOSS), game) ?? null) === null);
const seen = game.log.length;
cut.perform(at(MOSS), game);
check(`the browser cuts ${MOSS_PER_CUT} moss off moss and no mixed grass, the tile as it was`,
  game.inventory.count('moss') === MOSS_PER_CUT && game.inventory.count('mixed_grass') === 0 && w.getTile(MOSS[0], MOSS[1]) === TileType.Moss);
check('and says so in the island\'s words', game.log.slice(seen).some((l) => l.text === say('CUT_SAID')),
  game.log.slice(seen).map((l) => l.text).join(' | '));
check('and refuses a second cut in the island\'s words', cut.check?.(at(MOSS), game) === say('SHORT'), String(cut.check?.(at(MOSS), game)));
check('Plant moss is offered on dirt to somebody carrying moss, and not on grass',
  plant.applies(at(DIRT), game) && !plant.applies(at(GRASS), game));
check('and refused in the island\'s words for want of moss', plant.check?.(at(DIRT), game) === say('FEW'), String(plant.check?.(at(DIRT), game)));
game.inventory.add('moss', { ql: 50, count: MOSS_PLANT - MOSS_PER_CUT });
check('in the island\'s words on ground that is not dirt, and under water',
  plant.check?.(at(GRASS), game) === say('NOT_DIRT') && plant.check?.(at(WET), game) === say('WET'));
check('and allowed with enough on dry dirt', (plant.check?.(at(DIRT), game) ?? null) === null);
plant.perform(at(DIRT), game);
check(`the browser turns the dirt to moss and uses up ${MOSS_PLANT} moss`,
  w.getTile(DIRT[0], DIRT[1]) === TileType.Moss && game.inventory.count('moss') === 0);
check('and digging a moss tile still gives dirt', TILE_DEFS[TileType.Moss].digYield === 'dirt');

const sow = ACTION_BY_ID.get('plant_grass')!;
w.setTile(PATCH[0], PATCH[1], TileType.Dirt);
check('Plant grass is not offered to somebody carrying no mixed grass', !sow.applies(at(PATCH), game));
game.inventory.add('mixed_grass', { ql: 50, count: GRASS_PER_CUT });
check('and is offered on dirt to somebody carrying some, and not on grass or moss',
  sow.applies(at(PATCH), game) && !sow.applies(at(GRASS), game) && !sow.applies(at(MOSS), game));
check('and refused in the island\'s words for want of mixed grass', sow.check?.(at(PATCH), game) === say('G_FEW'), String(sow.check?.(at(PATCH), game)));
game.inventory.add('mixed_grass', { ql: 50, count: GRASS_PLANT - GRASS_PER_CUT });
check('in the island\'s words on ground that is not dirt, and under water',
  sow.check?.(at(GRASS), game) === say('G_NOT_DIRT') && sow.check?.(at(WET), game) === say('G_WET'),
  `${sow.check?.(at(GRASS), game)} / ${sow.check?.(at(WET), game)}`);
check('and allowed with enough on dry dirt', (sow.check?.(at(PATCH), game) ?? null) === null);
const before = game.log.length;
sow.perform(at(PATCH), game);
check(`the browser turns the dirt to grass, uncut and unpicked, and uses up ${GRASS_PLANT} mixed grass`,
  w.getTile(PATCH[0], PATCH[1]) === TileType.Grass && w.getData(PATCH[0], PATCH[1]) === 0 && game.inventory.count('mixed_grass') === 0);
check('and says so in the island\'s words', game.log.slice(before).some((l) => l.text === say('G_SAID')),
  game.log.slice(before).map((l) => l.text).join(' | '));
check('mixed grass says what it plants', itemDef('mixed_grass').description
  === `Cutting a grass tile gives ${numberWord(GRASS_PER_CUT)}; plant ${GRASS_PLANT} of it on a tile of dirt and the tile is grass.`,
  String(itemDef('mixed_grass').description));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`dirt collected, moss cut, and moss and grass planted — ${ok.length} of ${ok.length}`);
