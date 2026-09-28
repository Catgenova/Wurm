/**
 * Collect dirt and collect moss, and moss planted on dirt, the same on both sides.
 *
 * Asked for: "Add a collect dirt and collect moss option for each respective
 * tile, that operates like collect clay/sand. Moss can be planted in 10qty on
 * a dirt tile to change it to moss." So:
 *
 *   * Collect is offered on dirt and on moss as it is on sand and clay, and
 *     fills a shovel off the top of the tile without changing it: dirt off
 *     dirt, moss off moss (though digging a moss tile still gives dirt), and
 *     nothing off grass, which is refused in the same words on both sides;
 *   * Plant moss takes `MOSS_PLANT` moss from the pack and turns a tile of
 *     dirt to moss, refused in the same words when there is too little moss,
 *     when the tile is not dirt and when it is under water;
 *   * and the tiles the island reads say the same as the browser's.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, MOSS_PLANT, type Target } from '../../src/game/actions';
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
const LEVEL = 40;
const SUNK = -5;

/* ---- the island ------------------------------------------------------------ */
const tileT = (at: readonly [number, number]): string => `jsonb_build_object('kind', 'tile', 'x', ${at[0]}, 'y', ${at[1]}, 'cx', ${at[0]}, 'cy', ${at[1]})`;
const stand = (at: readonly [number, number]): string =>
  `update player set x = ${at[0]} + 0.5, y = ${at[1]} + 0.5 where world_id = w and uid = u;`;
const count = (def: string): string =>
  `(select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = '${def}')`;
const refused = (a: string, at: readonly [number, number]): string => `coalesce(act_refusal(w, u, '${a}', ${tileT(at)}), 'ALLOWED')`;

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
  update player set act = null, act_queue = '[]', stats = '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb
    where world_id = w and uid = u;
  for x in 0..12 loop for y in 0..6 loop perform land_set_height(w, x, y, ${LEVEL}); end loop; end loop;
  perform land_set_tile(w, ${DIRT[0]}, ${DIRT[1]}, tile_id('Dirt'));
  perform land_set_tile(w, ${MOSS[0]}, ${MOSS[1]}, tile_id('Moss'));
  perform land_set_tile(w, ${GRASS[0]}, ${GRASS[1]}, tile_id('Grass'));
  perform land_set_tile(w, ${WET[0]}, ${WET[1]}, tile_id('Dirt'));
  for x in ${WET[0]}..${WET[0] + 1} loop for y in ${WET[1]}..${WET[1] + 1} loop perform land_set_height(w, x, y, ${SUNK}); end loop; end loop;
  perform give(w, u, 'shovel', 1, 50);

  insert into said values ('DEFS', (select string_agg(name || ':' || collect || ':' || coalesce(collect_yield, '-') || ':' || coalesce(dig_yield, '-'), ',' order by id)
    from tile_def where name in ('Dirt', 'Moss', 'Grass', 'Sand', 'Clay')));

  /* Collect: dirt off dirt, moss off moss, the tile as it was; grass refused. */
  ${stand(DIRT)}
  insert into said values ('DIRT_REF', ${refused('collect', DIRT)});
  perform perform_gather(w, u, 'collect', ${tileT(DIRT)});
  insert into said values ('DIRT', ${count('dirt')} || '|' || ${count('moss')} || '|' || land_tile(w, ${DIRT[0]}, ${DIRT[1]}));
  ${stand(MOSS)}
  insert into said values ('MOSS_REF', ${refused('collect', MOSS)});
  perform perform_gather(w, u, 'collect', ${tileT(MOSS)});
  insert into said values ('MOSS', ${count('dirt')} || '|' || ${count('moss')} || '|' || land_tile(w, ${MOSS[0]}, ${MOSS[1]}));
  ${stand(GRASS)}
  insert into said values ('GRASS_REF', ${refused('collect', GRASS)});

  /* Plant moss: too little of it, the wrong ground, under water, and then done. */
  ${stand(DIRT)}
  insert into said values ('FEW', ${refused('plant_moss', DIRT)});
  perform give(w, u, 'moss', ${MOSS_PLANT} - 1, 50);
  ${stand(GRASS)}
  insert into said values ('NOT_DIRT', ${refused('plant_moss', GRASS)});
  ${stand(WET)}
  insert into said values ('WET', ${refused('plant_moss', WET)});
  ${stand(DIRT)}
  insert into said values ('PLANT_REF', ${refused('plant_moss', DIRT)});
  perform perform_farm(w, u, 'plant_moss', ${tileT(DIRT)});
  insert into said values ('PLANTED', land_tile(w, ${DIRT[0]}, ${DIRT[1]}) || '|' || ${count('moss')});
  insert into said values ('SAID', coalesce((select e.text from event e where e.world_id = w and e.uid = u order by e.n desc limit 1), 'unsaid'));
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
  .map((id) => { const d = TILE_DEFS[id]; return `${d.name}:${d.collect ? 'true' : 'false'}:${d.collectYield ?? '-'}:${d.digYield ?? '-'}`; });
check('the island reads the same tiles as the browser: what can be collected, what it gives, what digging gives',
  say('DEFS') === browserDefs.join(','), `${say('DEFS')} against ${browserDefs.join(',')}`);

const [dirt1, moss1, dirtTile] = say('DIRT').split('|');
check('Collect on dirt fills a shovel with dirt on the island, and the tile stays dirt',
  say('DIRT_REF') === 'ALLOWED' && dirt1 === '1' && moss1 === '0' && Number(dirtTile) === TileType.Dirt, `${say('DIRT_REF')} / ${say('DIRT')}`);
const [dirt2, moss2, mossTile] = say('MOSS').split('|');
check('Collect on moss fills it with moss, not dirt, and the tile stays moss',
  say('MOSS_REF') === 'ALLOWED' && dirt2 === '1' && moss2 === '1' && Number(mossTile) === TileType.Moss, `${say('MOSS_REF')} / ${say('MOSS')}`);
check('grass has no bed to collect off', say('GRASS_REF') === 'There is no bed of anything here.', say('GRASS_REF'));
check(`Plant moss with one moss is refused for want of ${MOSS_PLANT}`, say('FEW') === `It takes ${MOSS_PLANT} moss to plant a tile; you have 1.`, say('FEW'));
check('and on grass, for it is not dirt', say('NOT_DIRT') === 'Moss is planted on a tile of dirt.', say('NOT_DIRT'));
check('and under water', say('WET') === 'You cannot plant moss underwater.', say('WET'));
const [plantedTile, left] = say('PLANTED').split('|');
check(`with ${MOSS_PLANT} moss the dirt turns to moss and the moss is used up`,
  say('PLANT_REF') === 'ALLOWED' && Number(plantedTile) === TileType.Moss && left === '0', `${say('PLANT_REF')} / ${say('PLANTED')}`);
check('and it says so', say('SAID') === `You plant ${MOSS_PLANT} moss and the dirt is moss now.`, say('SAID'));

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
const at = (p: readonly [number, number]): Target => ({ kind: 'tile', x: p[0], y: p[1], cx: p[0], cy: p[1] });
const collect = ACTION_BY_ID.get('collect')!;
const plant = ACTION_BY_ID.get('plant_moss')!;

check('Collect is offered on dirt and moss in the browser, as Collect dirt and Collect moss',
  collect.applies(at(DIRT), game) && collect.applies(at(MOSS), game)
    && collect.labelFor?.(at(DIRT), game) === 'Collect dirt' && collect.labelFor?.(at(MOSS), game) === 'Collect moss');
check('and not on grass', !collect.applies(at(GRASS), game));
collect.perform(at(DIRT), game);
collect.perform(at(MOSS), game);
check('the browser collects one dirt off dirt and one moss off moss, the tiles as they were',
  game.inventory.count('dirt') === 1 && game.inventory.count('moss') === 1
    && w.getTile(DIRT[0], DIRT[1]) === TileType.Dirt && w.getTile(MOSS[0], MOSS[1]) === TileType.Moss);
check('Plant moss is offered on dirt to somebody carrying moss, and not on grass',
  plant.applies(at(DIRT), game) && !plant.applies(at(GRASS), game));
check('and refused in the island\'s words for want of moss', plant.check?.(at(DIRT), game) === say('FEW'), String(plant.check?.(at(DIRT), game)));
game.inventory.add('moss', { ql: 50, count: MOSS_PLANT - 1 });
check('in the island\'s words on ground that is not dirt, and under water',
  plant.check?.(at(GRASS), game) === say('NOT_DIRT') && plant.check?.(at(WET), game) === say('WET'));
check('and allowed with enough on dry dirt', (plant.check?.(at(DIRT), game) ?? null) === null);
plant.perform(at(DIRT), game);
check(`the browser turns the dirt to moss and uses up ${MOSS_PLANT} moss`,
  w.getTile(DIRT[0], DIRT[1]) === TileType.Moss && game.inventory.count('moss') === 0);
check('and digging a moss tile still gives dirt', TILE_DEFS[TileType.Moss].digYield === 'dirt' && TILE_DEFS[TileType.Moss].collectYield === 'moss');

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`dirt and moss collected, and moss planted — ${ok.length} of ${ok.length}`);
