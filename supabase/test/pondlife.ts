/**
 * The water garden, on both sides.
 *
 * Asked for: stepping stones laid across shallow water and walked dry-shod; a
 * tiered fountain that is a water source exactly as a well is; water lilies
 * and lotus planted in still water, growing through the island's year.
 *
 * Measured here:
 *
 *   * the year: `seasonBegan` and `waterPlantState` against the island's
 *     `season_began` and `water_plant_state`, at moments every few hours for
 *     two years and a second either side of every season's turn, for plants
 *     rooting and rooted, picked and not;
 *   * the ground: one scene -- a shore shelving into deep sea, a pond on the
 *     slope above it and the stream it spills down to the sea, and tiles of
 *     things that stand, are sown or are laid -- built on both sides, and every
 *     tile of it asked whether stepping stones may be laid there and whether a
 *     water lily and a lotus may be planted, in the same words;
 *   * walking: stones laid through the doors, and a body on a line of tiles
 *     across water deeper than swimming depth, swimming or not the same way on
 *     both sides with and without stones; `rpc_move` along the stones blocks
 *     nothing, and the browser walks them at a walking pace;
 *   * the doors: laying and taking up stones, and planting, picking and pulling
 *     up a water lily and a lotus, in each of the four seasons pinned for the
 *     length of the transaction, the refusals word for word;
 *   * the fountain: a well to every rule on both sides -- it fills, a bucket is
 *     drawn from it, and it is drunk from;
 *   * botanizing at the water's edge rolls the table with the water plants in
 *     it, on both sides the same tiles, and the island is sent the plants.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTIONS, type ActionDef, type Target } from '../../src/game/actions';
import { STONES_DEPTH, atWaterEdge, plantRefusal, stonesRefusal } from '../../src/game/watergarden';
import { BOTANIZE_WATER_TABLE } from '../../src/game/forage';
import { SWIM_DEPTH, BASE_SPEED } from '../../src/game/player';
import { WELL_HOLDS } from '../../src/game/furniture';
import { sourceFor } from '../../src/game/placeables';
import { TileType, stonesData } from '../../src/world/tiles';
import { SEASONS, SEASON_DAYS, YEAR_DAYS, YEAR_FROM } from '../../src/world/calendar';
import {
  WATER_PLANTS, WATER_PLANT_BY_ID, WATER_ROOTING, seasonBegan, stateLine, waterPlantState,
} from '../../src/world/waterplants';

const psql = (sql: string): string =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: {
      ...process.env,
      PGHOST: process.env.PGHOST ?? '/var/run/postgresql',
      PGPORT: process.env.PGPORT ?? '5433',
      PGUSER: process.env.PGUSER ?? 'wurm',
      PGDATABASE: process.env.PGDATABASE ?? 'postgres',
    },
  }).trim();

let bad = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`);
};

const HOUR = 3600;
const DAY = 24 * HOUR;

/* ---- The year ------------------------------------------------------------------------------------ */

{
  // Every five hours for two years from a year before the first spring, and a second either side of every turn.
  const moments: number[] = [];
  for (let t = YEAR_FROM - YEAR_DAYS * DAY; t <= YEAR_FROM + YEAR_DAYS * DAY; t += 5 * HOUR) moments.push(t);
  for (let d = -YEAR_DAYS; d <= 2 * YEAR_DAYS; d += SEASON_DAYS) moments.push(YEAR_FROM + d * DAY - 1, YEAR_FROM + d * DAY, YEAR_FROM + d * DAY + 1);
  const island = psql(`select string_agg(extract(epoch from season_began(to_timestamp(t)))::bigint::text, ',' order by i)
    from unnest(array[${moments.join(',')}]::double precision[]) with ordinality m(t, i)`).split(',').map(Number);
  let same = 0;
  let first = '';
  moments.forEach((t, i) => {
    if (seasonBegan(t) === island[i]) same++;
    else if (!first) first = `${new Date(t * 1000).toISOString()}: ${seasonBegan(t)} against ${island[i]}`;
  });
  say(same === moments.length, `the season began at the same moment on both sides at ${same} of ${moments.length} moments${first ? ` -- first difference ${first}` : ''}`);

  /*
   * Plants in every state: planted a little before and after a turn, rooted
   * and not, never picked, picked before this season began and in it --
   * asked at moments round every turn, and round every one's rooting.
   */
  const cases: Array<[string, number, number | null, number]> = [];
  for (let d = 0; d <= YEAR_DAYS + SEASON_DAYS; d += SEASON_DAYS) {
    const turn = YEAR_FROM + d * DAY;
    for (const def of WATER_PLANTS) {
      for (const planted of [turn - 3 * DAY, turn - WATER_ROOTING, turn - WATER_ROOTING + 1, turn - HOUR]) {
        for (const picked of [null, turn - 2 * DAY, turn - 1, turn, turn + HOUR]) {
          for (const now of [turn - 1, turn, turn + 1, turn + 2 * HOUR, planted + WATER_ROOTING - 1, planted + WATER_ROOTING, turn + 4 * DAY]) {
            if (picked !== null && (picked < planted || picked > now)) continue;
            cases.push([def.id, planted, picked, now]);
          }
        }
      }
    }
  }
  const lines = psql(`select string_agg(water_plant_state(k, to_timestamp(a), case when p is null then null else to_timestamp(p) end, to_timestamp(n)), ';' order by i)
    from unnest(array[${cases.map((c) => `'${c[0]}'`).join(',')}]::text[], array[${cases.map((c) => c[1]).join(',')}]::double precision[],
                array[${cases.map((c) => (c[2] === null ? 'null' : c[2])).join(',')}]::double precision[],
                array[${cases.map((c) => c[3]).join(',')}]::double precision[]) with ordinality u(k, a, p, n, i)`).split(';');
  let agree = 0;
  let differ = '';
  const seen = new Set<string>();
  cases.forEach(([kind, a, p, n], i) => {
    const mine = stateLine(waterPlantState(WATER_PLANT_BY_ID.get(kind as 'lily')!, a, p, n));
    seen.add(`${kind} ${mine}`);
    if (mine === lines[i]) agree++;
    else if (!differ) differ = `${kind} planted ${a} picked ${p} at ${n}: browser ${mine}, island ${lines[i]}`;
  });
  say(agree === cases.length, `a water plant is in the same state on both sides in ${agree} of ${cases.length} cases, ${seen.size} states between them${differ ? ` -- first difference ${differ}` : ''}`);
  // And the year as the plants live it, read off the browser's rule: what each does in each season once rooted.
  const year = WATER_PLANTS.map((def) => `${def.id}: ${SEASONS.map((s, k) => {
    const t = YEAR_FROM + (k * SEASON_DAYS + 3) * DAY;
    const st = waterPlantState(def, t - 2 * DAY, null, t);
    return `${s} ${st.leaves ? 'leaves' : 'root'}${st.bears ? ` ${st.bears}` : ''}`;
  }).join(', ')}`).join(' | ');
  say(year === 'lily: spring leaves flower, summer leaves flower, autumn leaves, winter root | lotus: spring leaves, summer leaves flower, autumn leaves seed, winter root',
    `round the year: ${year}`);
}

/* ---- One scene, on both sides -------------------------------------------------------------------- */

/*
 * On the Hoarding island (64 across), in its south-west quarter: corners x 0
 * to 32 and y 32 to 64. A sea shelving west from x 6 to fifteen deep at the
 * edge; land rising east from it a step and a half a corner; a bowl dug into
 * the slope at (19, 48), where a spring fills a pond that spills west down
 * the slope to the sea. Everywhere else on the island stands at 30.
 */
const SEA = [-15, -12, -10, -7, -5, -2];
const BOWL: [number, number] = [19, 48];
function height(x: number, y: number): number {
  if (x > 32 || y < 32) return 30;
  if (x < SEA.length) return SEA[x];
  let h = 2 + Math.floor((x - SEA.length) * 1.5);
  const d = Math.hypot(x - BOWL[0], y - BOWL[1]);
  if (d < 3.6) h -= Math.round((3.6 - d) * 3.4);
  return h;
}
/** The spring's tile: the bottom of the bowl. */
const SPRING: [number, number] = [BOWL[0] - 1, BOWL[1] - 1];
/** A few tiles of what stands, is sown or is laid, and the ground under the rest: sand in the sea, grass on land. */
function tileAt(x: number, y: number): [number, number] {
  if (x === 4 && y === 36) return [TileType.Cobblestone, 0];
  if (x === 3 && y === 38) return [TileType.SteppingStones, stonesData(2, TileType.Sand)];
  if (x === 20 && y === 47) return [TileType.Tree, 2];
  if (x === 12 && y === 46) return [TileType.Field, 0];
  if (x < 32 && Math.min(height(x, y), height(x + 1, y), height(x, y + 1), height(x + 1, y + 1)) < 0) return [TileType.Sand, 0];
  return [TileType.Grass, 0];
}
const LILY_AT: [number, number] = [17, 48];

/**
 * The corners the island is told, and the tiles, as rows of values: the
 * scene and a row of ground round it, so what other tests leave dug on the
 * island next to it is not water beside its edge on one side only.
 */
const cornerRows: string[] = [];
for (let y = 31; y <= 64; y++) for (let x = 0; x <= 40; x++) cornerRows.push(`(${x}, ${y}, ${height(x, y)})`);
const tileRows: string[] = [];
for (let y = 31; y < 64; y++) for (let x = 0; x < 40; x++) {
  const [t, d] = tileAt(x, y);
  tileRows.push(`(${x}, ${y}, ${t}, ${d})`);
}

/** The scene laid on the island, in the transaction the caller has open. */
const ISLAND_SCENE = `
  select id into w from world where name = 'Hoarding';
  select uid into me from player where world_id = w and name = 'Crowd4';
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  delete from spring where world_id = w;
  delete from water_plant where world_id = w;
  delete from placed where world_id = w and x < 41 and y > 29;
  delete from foundation where world_id = w and x < 41 and y > 29;
  perform land_set_height(w, v.x, v.y, v.h) from (values ${cornerRows.join(', ')}) v(x, y, h);
  perform land_set_tile(w, v.x, v.y, v.t), land_set_data(w, v.x, v.y, v.d) from (values ${tileRows.join(', ')}) v(x, y, t, d);
  insert into spring (world_id, x, y, cx, cy, made_by)
    values (w, ${SPRING[0]}, ${SPRING[1]}, (spring_corner(w, ${SPRING[0]}, ${SPRING[1]}))[1], (spring_corner(w, ${SPRING[0]}, ${SPRING[1]}))[2], me)
    returning id into v_spring;
  perform settle_spring(w, v_spring);
  insert into water_plant (world_id, x, y, kind, planted_at) values (w, ${LILY_AT[0]}, ${LILY_AT[1]}, 'lily', now() - interval '3 days');
  update player set x = 8.5, y = 44.5, level = 0, act = null, act_queue = '[]'::jsonb, aboard = null where world_id = w and uid = me;
  delete from item where world_id = w and holder = 'player' and holder_uid = me;
`;

/** The same scene in a browser's game of its own. */
function browserScene(): Game {
  const g = Game.create(31337, 64);
  const w = g.world;
  for (let y = 0; y <= 64; y++) for (let x = 0; x <= 64; x++) w.setHeight(x, y, height(x, y));
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const [t, d] = y >= 31 && x < 40 ? tileAt(x, y) : [TileType.Grass, 0];
    w.setTile(x, y, t as TileType, d);
  }
  g.springs.dig(SPRING[0], SPRING[1], null, Date.now() - HOUR * 1000);
  g.update(0.01);
  g.plantWater(LILY_AT[0], LILY_AT[1], 'lily', Date.now() / 1000 - 3 * DAY);
  for (const it of [...g.inventory.items]) g.inventory.remove(it.uid, it.count);
  g.player.x = 8.5;
  g.player.y = 44.5;
  return g;
}

{
  const island = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; v_spring bigint;
begin
  ${ISLAND_SCENE}
  insert into said select 'water', (select chain::text from spring where id = v_spring);
  insert into said select 'refusals', string_agg(x || ',' || y || '=' || coalesce(stones_refusal(w, x, y), 'OK')
      || '|' || coalesce(plant_refusal(w, 'lily', x, y), 'OK') || '|' || coalesce(plant_refusal(w, 'lotus', x, y), 'OK')
      || '|' || water_edge(w, x, y)::text || '|' || water_runs(w, x, y)::text, E'\\n' order by y, x)
    from generate_series(0, 31) x, generate_series(32, 63) y;
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\\n~~\\n' order by k) from said;
rollback;`);
  const said = new Map(island.split('\n~~\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const g = browserScene();
  const s = [...g.springs.list.values()][0];
  const chain = JSON.parse(said.get('water') ?? 'null');
  say(!!s && !!chain && s.chain.ponds.length === chain.ponds.length && s.chain.ponds[0].level === chain.ponds[0].level
      && s.chain.streams.length === chain.streams.length && s.chain.streams.every((st, i) => st.path.join() === chain.streams[i].path.join()),
    `the scene's water is the same on both sides: a pond at ${s?.chain.ponds[0]?.level} over a floor of ${s?.chain.ponds[0]?.floor}, spilling down ${s?.chain.streams[0]?.path.length / 2} corners of stream to ${s?.chain.streams[0]?.to}`);
  const rows = (said.get('refusals') ?? '').split('\n');
  let same = 0;
  let first = '';
  const tally = new Map<string, number>();
  for (const row of rows) {
    const [at, theirs] = row.split('=');
    const [x, y] = at.split(',').map(Number);
    const mine = [
      stonesRefusal(g, x, y) ?? 'OK',
      plantRefusal(g, WATER_PLANT_BY_ID.get('lily')!, x, y) ?? 'OK',
      plantRefusal(g, WATER_PLANT_BY_ID.get('lotus')!, x, y) ?? 'OK',
      String(atWaterEdge(g, x, y)),
      String(g.world.water?.runsOver(x, y) ?? false),
    ].join('|');
    for (const part of mine.split('|').slice(0, 2)) tally.set(part, (tally.get(part) ?? 0) + 1);
    if (mine === theirs) same++;
    else if (!first) first = `at ${x},${y}: browser "${mine}" | island "${theirs}"`;
  }
  say(same === rows.length && rows.length === 32 * 32,
    `every tile of the scene is refused, or not, in the same words on both sides: ${same} of ${rows.length}${first ? ` -- first difference ${first}` : ''}`);
  const kinds = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} × ${k.slice(0, 48)}`);
  say(kinds.length >= 9 && tally.get('OK')! > 20, `and the scene asks every question there is: ${kinds.join('; ')}`);
}

/* ---- Stepping stones: laid, walked and taken up ---------------------------------------------------- */

/*
 * Down the shore at y 44: tile 4 is 0.35 m deep, under swimming depth; tile 3
 * is 0.6 m, over it and under the stones' limit; tile 2 is 0.85 m, too deep
 * for a stone. Stones go down on tile 3 and on the two tiles south of it.
 */
const act = (id: string): ActionDef => ACTIONS.find((a) => a.id === id) as ActionDef;
const tile = (x: number, y: number, itemUid?: number): Target => ({ kind: 'tile', x, y, cx: x, cy: y, ...(itemUid !== undefined ? { itemUid } : {}) });
{
  const island = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; v_spring bigint; v_slab bigint; r jsonb; v_moves text := ''; v_deep text := '';
begin
  ${ISLAND_SCENE}
  perform give(w, me, 'trowel', 1, 50);
  insert into said values ('far', coalesce(act_refusal(w, me, 'lay_stones', '{"kind":"tile","x":3,"y":44}'), 'none'));
  update player set x = 4.5, y = 44.5 where world_id = w and uid = me;
  insert into said values ('noslab', coalesce(act_refusal(w, me, 'lay_stones', '{"kind":"tile","x":3,"y":44}'), 'none'));
  perform give(w, me, 'marble_slab', 3, 40);
  select id into v_slab from item where world_id = w and holder_uid = me and def = 'marble_slab';
  update player set x = 3.5, y = 44.5 where world_id = w and uid = me;
  insert into said values ('deep', coalesce(act_refusal(w, me, 'lay_stones', '{"kind":"tile","x":2,"y":44}'), 'none'));
  update player set x = 4.5, y = 44.5 where world_id = w and uid = me;
  insert into said values ('ok', coalesce(act_refusal(w, me, 'lay_stones', '{"kind":"tile","x":3,"y":44}'), 'none'));
  -- Every go comes off, for the length of this.
  create or replace function skill_check(p_skill double precision, p_difficulty double precision,
     p_tool_ql double precision default 0, p_ease double precision default 0) returns boolean language sql as 'select true';
  perform act_perform(w, me, 'lay_stones', jsonb_build_object('kind', 'tile', 'x', 3, 'y', 44, 'itemUid', v_slab));
  insert into said values ('told', (select text from event where world_id = w and uid = me order by n desc limit 1));
  insert into said values ('laid', land_tile(w, 3, 44) || ',' || land_data(w, 3, 44) || ',' || pack_count(w, me, 'marble_slab')
                                   || ',' || (select count(*) from tile_change where world_id = w and x = 3 and y = 44));
  insert into said values ('again', coalesce(act_refusal(w, me, 'lay_stones', '{"kind":"tile","x":3,"y":44}'), 'none'));
  perform act_perform(w, me, 'lay_stones', '{"kind":"tile","x":3,"y":45}');
  update player set x = 4.5, y = 45.5 where world_id = w and uid = me;
  perform act_perform(w, me, 'lay_stones', '{"kind":"tile","x":3,"y":46}');
  -- Out of your depth beside the stones, and dry on them.
  update player set x = 2.5, y = 45.5 where world_id = w and uid = me;
  v_deep := v_deep || 'beside:' || in_deep_water(w, me)::text;
  update player set x = 3.5, y = 44.5, moved_at = now() - interval '1 second' where world_id = w and uid = me;
  v_deep := v_deep || ' on:' || in_deep_water(w, me)::text;
  -- Walked along the three, a tile a call, as a browser says where it has got to.
  foreach r in array array[jsonb_build_array(3.5, 45.5), jsonb_build_array(3.5, 46.5), jsonb_build_array(3.5, 45.2)] loop
    delete from caller where uid = me;
    update player set moved_at = now() - interval '1 second' where world_id = w and uid = me;
    r := rpc_move(w, (r->>0)::double precision, (r->>1)::double precision, 0);
    v_moves := v_moves || (r->>'x') || ',' || (r->>'y') || ',' || (r->>'blocked') || ',' || in_deep_water(w, me)::text || ' ';
  end loop;
  insert into said values ('walk', v_moves);
  insert into said values ('wet', v_deep);
  update player set x = 4.5, y = 44.5 where world_id = w and uid = me;
  insert into said values ('lift', coalesce(act_refusal(w, me, 'lift_stones', '{"kind":"tile","x":3,"y":44}'), 'none'));
  perform act_perform(w, me, 'lift_stones', '{"kind":"tile","x":3,"y":44}');
  insert into said values ('lifted', land_tile(w, 3, 44) || ',' || land_data(w, 3, 44) || ',' || pack_count(w, me, 'marble_slab'));
  insert into said values ('liftold', (select regexp_replace(text, ' \\(QL [0-9.]+\\)', '') from event where world_id = w and uid = me order by n desc limit 1));
  insert into said values ('none', coalesce(act_refusal(w, me, 'lift_stones', '{"kind":"tile","x":3,"y":44}'), 'none'));
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\\n' order by k) from said;
rollback;`);
  const said = new Map(island.split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

  // The browser, on the same ground, with the same things in hand.
  const g = browserScene();
  const w = g.world;
  const lay = act('lay_stones');
  const lift = act('lift_stones');
  g.inventory.add('trowel', { ql: 50 });
  g.player.x = 4.5;
  g.player.y = 44.5;
  const noslab = lay.check?.(tile(3, 44), g) ?? 'none';
  const slab = g.inventory.add('marble_slab', { ql: 40, count: 3 });
  const deep = lay.check?.(tile(2, 44), g) ?? 'none';
  const ok = lay.check?.(tile(3, 44), g) ?? 'none';
  const told: string[] = [];
  const hear = g.logMsg.bind(g);
  g.logMsg = (text, kind) => { told.push(text); hear(text, kind); };
  g.sureCheck = () => true;
  lay.perform(tile(3, 44, slab.uid), g);
  const laid = `${w.getTile(3, 44)},${w.getData(3, 44)},${g.inventory.items.filter((i) => i.id === 'marble_slab').reduce((n, i) => n + i.count, 0)}`;
  const again = lay.check?.(tile(3, 44), g) ?? 'none';
  say(noslab === said.get('noslab') && deep === said.get('deep') && ok === said.get('ok') && ok === 'none' && again === said.get('again'),
    `laying stones is refused and allowed alike: "${noslab}", "${deep}", "${again}"; the island first asks you to stand within reach: "${said.get('far')}"`);
  const [it, id, left, announced] = (said.get('laid') ?? '').split(',');
  say(`${it},${id},${left}` === laid && Number(it) === TileType.SteppingStones && Number(id) === stonesData(2, TileType.Sand) && Number(announced) >= 1,
    `laid, the tile is stepping stones of marble over sand on both sides (${laid}), one slab spent, and the island tells everybody (${announced} change)`);
  say(told[told.length - 1] === said.get('told'), `and says so in the same words: "${said.get('told')}"`);
  lay.perform(tile(3, 45), g);
  lay.perform(tile(3, 46), g);

  // Swimming beside them, and not on them.
  const { rule } = g.movement();
  const p = g.player;
  const swims = (x: number, y: number): boolean => {
    p.x = x;
    p.y = y;
    p.path = null;
    p.update(0.001, w, rule);
    return p.swimming;
  };
  const wet = `beside:${swims(2.5, 45.5)} on:${swims(3.5, 44.5)}`;
  say(wet === said.get('wet') && wet === 'beside:true on:false',
    `0.6 m of water, over swimming depth (${(SWIM_DEPTH / 10).toFixed(1)} m) and under the stones' (${(STONES_DEPTH / 10).toFixed(1)} m): out of your depth beside the stones and dry on them, on both sides -- ${wet}`);
  // Walked, on both sides: the island moves the body along without a pull or a block, and it stays dry.
  const walked = (said.get('walk') ?? '').trim().split(' ');
  say(walked.length === 3 && walked.every((m) => /,false,false$/.test(m)) && walked[1].startsWith('3.5,46.5'),
    `rpc_move along the stones: ${walked.join(' | ')}`);
  // And at what pace: a walking pace on the stones, a swimmer's share of it off them.
  const pace = (x: number, y: number, tx: number, ty: number): number => {
    p.x = x;
    p.y = y;
    p.path = [{ x: tx, y: ty, level: 0 }];
    let went = 0;
    for (let i = 0; i < 10; i++) went += p.update(0.05, w, rule);
    return went / 0.5;
  };
  const onStones = pace(3.5, 44.5, 3, 46);
  const offStones = pace(2.5, 44.5, 2, 46);
  say(Math.abs(onStones - BASE_SPEED) < 1e-9 && offStones < BASE_SPEED * 0.5,
    `walked along the line of them at ${onStones.toFixed(2)} tiles a second, the walking pace, and through the water beside them at ${offStones.toFixed(2)}`);

  // Taken up again.
  p.x = 4.5;
  p.y = 44.5;
  const liftOk = lift.check?.(tile(3, 44), g) ?? 'none';
  lift.perform(tile(3, 44), g);
  const lifted = `${w.getTile(3, 44)},${w.getData(3, 44)},${g.inventory.items.filter((i) => i.id === 'marble_slab').reduce((n, i) => n + i.count, 0)}`;
  const none = lift.check?.(tile(3, 44), g) ?? 'none';
  say(liftOk === said.get('lift') && lifted === said.get('lifted') && none === said.get('none') && Number(lifted.split(',')[0]) === TileType.Sand,
    `taken up, the tile is the sand it was and the slab is back in the pack on both sides (${lifted}); asked again: "${none}"`);
  say(told[told.length - 1].replace(/ \(QL [0-9.]+\)/, '') === said.get('liftold'), `in the same words: "${said.get('liftold')}"`);
}

/* ---- Water lilies and lotus, through the doors, in every season ----------------------------------- */

/*
 * The season is pinned for each run -- on the island `season_at` says it and
 * `season_began` says it began three days ago; in the browser the clock is
 * three days into it -- so what is asked does not depend on the day this runs.
 * Four plants: a lily planted two days ago and never picked; a lily planted
 * two hours ago; a lotus picked an hour ago; a lotus picked before the season
 * began.
 */
const POND_TILES: Array<[number, number]> = [[16, 48], [17, 47], [18, 49], [19, 48]];
const PLANTS: Array<{ at: [number, number]; kind: 'lily' | 'lotus'; planted: number; picked: number | null }> = [
  { at: POND_TILES[0], kind: 'lily', planted: 2 * DAY, picked: null },
  { at: POND_TILES[1], kind: 'lily', planted: 2 * HOUR, picked: null },
  { at: POND_TILES[2], kind: 'lotus', planted: 2 * DAY, picked: HOUR },
  { at: POND_TILES[3], kind: 'lotus', planted: 5 * DAY, picked: 4 * DAY },
];
for (const [k, season] of SEASONS.entries()) {
  const island = psql(`
begin;
create temp table said (k text, v text);
create or replace function season_at(p_at timestamptz default now()) returns text language sql stable as $$ select '${season}'::text $$;
create or replace function season_began(p_at timestamptz default now()) returns timestamptz language sql stable as $$ select now() - interval '3 days' $$;
create or replace function product_ql(p_skill double precision, p_tool_ql double precision default 0)
  returns double precision language sql as 'select 40::double precision';
do $b$
declare w uuid; me uuid; v_spring bigint; v_n int := 0;
begin
  ${ISLAND_SCENE}
  delete from water_plant where world_id = w;
  ${PLANTS.map((q) => `insert into water_plant (world_id, x, y, kind, planted_at, picked_at) values (w, ${q.at[0]}, ${q.at[1]}, '${q.kind}',
      now() - interval '${q.planted} seconds', ${q.picked === null ? 'null' : `now() - interval '${q.picked} seconds'`});`).join('\n  ')}
  update player set x = 17.5, y = 48.5 where world_id = w and uid = me;
  ${PLANTS.map((q, i) => `
  insert into said values ('pick${i}', coalesce(act_refusal(w, me, 'pick_water_plant', '{"kind":"tile","x":${q.at[0]},"y":${q.at[1]}}'), 'none'));
  if act_refusal(w, me, 'pick_water_plant', '{"kind":"tile","x":${q.at[0]},"y":${q.at[1]}}') is null then
    perform act_perform(w, me, 'pick_water_plant', '{"kind":"tile","x":${q.at[0]},"y":${q.at[1]}}');
    insert into said values ('got${i}', (select text from event where world_id = w and uid = me order by n desc limit 1));
    insert into said values ('after${i}', coalesce(act_refusal(w, me, 'pick_water_plant', '{"kind":"tile","x":${q.at[0]},"y":${q.at[1]}}'), 'none'));
  end if;`).join('')}
  insert into said values ('pack', coalesce((select string_agg(i.def || ':' || i.count, ',' order by i.def) from item i
                                     where i.world_id = w and i.holder = 'player' and i.holder_uid = me), ''));
  insert into said values ('state', (select string_agg(x || ',' || y || ' ' || water_plant_state(kind, planted_at, picked_at), '; ' order by y, x)
                                      from water_plant where world_id = w));
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\\n' order by k) from said;
rollback;`);
  const said = new Map(island.split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

  // Three days into the season, on the browser's clock.
  const T = YEAR_FROM + (k * SEASON_DAYS + 3) * DAY + 5 * HOUR;
  const realNow = Date.now;
  Date.now = () => T * 1000;
  try {
    const g = browserScene();
    g.waterPlants.clear();
    for (const q of PLANTS) {
      const pl = g.plantWater(q.at[0], q.at[1], q.kind, T - q.planted);
      pl.picked = q.picked === null ? null : T - q.picked;
    }
    g.player.x = 17.5;
    g.player.y = 48.5;
    g.productQl = () => 40;
    const told: string[] = [];
    const hear = g.logMsg.bind(g);
    g.logMsg = (text, kind) => { told.push(text); hear(text, kind); };
    const pick = act('pick_water_plant');
    let same = 0;
    let first = '';
    const words: string[] = [];
    PLANTS.forEach((q, i) => {
      const t = tile(q.at[0], q.at[1]);
      const mine = pick.check?.(t, g) ?? 'none';
      const theirs = said.get(`pick${i}`);
      let also = true;
      if (mine === 'none') {
        pick.perform(t, g);
        also = told[told.length - 1] === said.get(`got${i}`) && (pick.check?.(t, g) ?? 'none') === said.get(`after${i}`);
        words.push(told[told.length - 1]);
      } else words.push(mine);
      if (mine === theirs && also) same++;
      else if (!first) first = `${q.kind} at ${q.at}: browser "${mine}" / "${told[told.length - 1]}" | island "${theirs}" / "${said.get(`got${i}`)}"`;
    });
    const pack = g.inventory.items.map((it) => `${it.id}:${it.count}`).sort().join(',');
    say(same === PLANTS.length && pack === (said.get('pack') ?? ''),
      `${season}: the four plants are picked, or not, alike on both sides, and the pack holds ${pack || 'nothing'} -- ${words.join(' / ')}${first ? ` -- first difference ${first}` : ''}`);
  } finally {
    Date.now = realNow;
  }
}

/* ---- Planting and pulling up, through the doors -------------------------------------------------- */

{
  const island = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; v_spring bigint;
begin
  ${ISLAND_SCENE}
  update player set x = 17.5, y = 49.5 where world_id = w and uid = me;
  insert into said values ('noroot', coalesce(act_refusal(w, me, 'plant_lotus', '{"kind":"tile","x":18,"y":47}'), 'none'));
  perform give(w, me, 'lotus_seed', 2, 30);
  insert into said values ('dry', coalesce(act_refusal(w, me, 'plant_lotus', '{"kind":"tile","x":18,"y":51}'), 'none'));
  insert into said values ('taken', coalesce(act_refusal(w, me, 'plant_lotus', '{"kind":"tile","x":${LILY_AT[0]},"y":${LILY_AT[1]}}'), 'none'));
  insert into said values ('ok', coalesce(act_refusal(w, me, 'plant_lotus', '{"kind":"tile","x":18,"y":47}'), 'none'));
  perform act_perform(w, me, 'plant_lotus', '{"kind":"tile","x":18,"y":47}');
  insert into said values ('told', (select text from event where world_id = w and uid = me order by n desc limit 1));
  insert into said values ('row', (select kind || ',' || (planted_at = now())::text || ',' || coalesce(picked_at::text, 'never')
                                     from water_plant where world_id = w and x = 18 and y = 47) || ',' || pack_count(w, me, 'lotus_seed'));
  insert into said values ('pick', coalesce(act_refusal(w, me, 'pick_water_plant', '{"kind":"tile","x":18,"y":47}'), 'none'));
  insert into said values ('pull', coalesce(act_refusal(w, me, 'pull_water_plant', '{"kind":"tile","x":18,"y":47}'), 'none'));
  perform act_perform(w, me, 'pull_water_plant', '{"kind":"tile","x":18,"y":47}');
  insert into said values ('pulled', (select count(*) from water_plant where world_id = w and x = 18 and y = 47) || ',' || pack_count(w, me, 'lotus_seed'));
  insert into said values ('pulltold', (select text from event where world_id = w and uid = me order by n desc limit 1));
  insert into said values ('ground', (rpc_ground(w, 40, true)->'waterPlants')::text);
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\\n' order by k) from said;
rollback;`);
  const said = new Map(island.split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const g = browserScene();
  g.player.x = 17.5;
  g.player.y = 49.5;
  const plant = act('plant_lotus');
  const noroot = plant.check?.(tile(18, 47), g) ?? 'none';
  g.inventory.add('lotus_seed', { ql: 30, count: 2 });
  const dry = plant.check?.(tile(18, 51), g) ?? 'none';
  const taken = plant.check?.(tile(LILY_AT[0], LILY_AT[1]), g) ?? 'none';
  const ok = plant.check?.(tile(18, 47), g) ?? 'none';
  const told: string[] = [];
  const hear = g.logMsg.bind(g);
  g.logMsg = (text, kind) => { told.push(text); hear(text, kind); };
  plant.perform(tile(18, 47), g);
  const row = g.waterPlantAt(18, 47);
  const seeds = (): number => g.inventory.items.filter((i) => i.id === 'lotus_seed').reduce((n, i) => n + i.count, 0);
  say(noroot === said.get('noroot') && dry === said.get('dry') && taken === said.get('taken') && ok === said.get('ok') && ok === 'none',
    `planting a lotus is refused and allowed alike on both sides: "${noroot}", "${dry}", "${taken}"`);
  const [kind, stamped, picked, left] = (said.get('row') ?? '').split(',');
  say(!!row && row.kind === kind && stamped === 'true' && picked === 'never' && row.picked === null && Number(left) === seeds() && told[told.length - 1] === said.get('told'),
    `planted, the tile keeps a ${kind} planted now and never picked on both sides, a seed spent, and it is said alike: "${said.get('told')}"`);
  const pick = act('pick_water_plant').check?.(tile(18, 47), g) ?? 'none';
  say(pick === said.get('pick'), `a new one is not picked: "${pick}"`);
  const pull = act('pull_water_plant');
  const pullOk = pull.check?.(tile(18, 47), g) ?? 'none';
  pull.perform(tile(18, 47), g);
  say(pullOk === said.get('pull') && `${g.waterPlantAt(18, 47) ? 1 : 0},${seeds()}` === said.get('pulled') && told[told.length - 1] === said.get('pulltold'),
    `pulled up, it is gone and its seed is back on both sides (${said.get('pulled')}): "${said.get('pulltold')}"`);
  // And what the island sends a browser about the plants near it, laid in as the browser keeps them.
  const sent = JSON.parse(said.get('ground') ?? '[]') as Array<{ x: number; y: number; kind: 'lily'; at: number; picked: number | null }>;
  const h = browserScene();
  h.sawGround({ placed: [], crates: [], waterPlants: sent });
  const kept = h.waterPlantAt(LILY_AT[0], LILY_AT[1]);
  say(sent.length === 1 && !!kept && kept.kind === 'lily' && Math.abs(kept.at - (Date.now() / 1000 - 3 * DAY)) < 60 && kept.picked === null,
    `the island sends the plants near a body on the slow ground read, and the browser keeps them: ${JSON.stringify(sent)}`);
}

/* ---- The fountain is a well ----------------------------------------------------------------------- */

{
  const island = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; v_spring bigint; v_f bigint; v_bucket bigint; f placed;
begin
  ${ISLAND_SCENE}
  update player set x = 12.5, y = 38.5, stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{thirst}', '0.3') where world_id = w and uid = me;
  perform give(w, me, 'bucket', 1, 50);
  select id into v_bucket from item where world_id = w and holder_uid = me and def = 'bucket';
  insert into said values ('before', coalesce(act_refusal(w, me, 'fill_bucket', jsonb_build_object('kind', 'item', 'uid', v_bucket)), 'none'));
  perform give(w, me, 'fountain', 1, 80);
  perform act_perform(w, me, 'place_furniture', jsonb_build_object('kind', 'item',
    'uid', (select id from item where world_id = w and holder_uid = me and def = 'fountain'), 'x', 12, 'y', 39, 'sx', 0, 'sy', 0));
  select * into f from placed where world_id = w and sub = 'fountain';
  insert into said values ('well', is_well(f)::text || ',' || placed_liquid(f) || ',' || liquid_capacity(f) || ',' || round(well_rate(80)::numeric, 5));
  update placed set since = now() - interval '5 minutes' where id = f.id;
  select * into f from placed where id = f.id;
  insert into said values ('five', round(placed_litres(f)::numeric, 3)::text);
  insert into said values ('fill', coalesce(act_refusal(w, me, 'fill_bucket', jsonb_build_object('kind', 'item', 'uid', v_bucket)), 'none'));
  perform act_perform(w, me, 'fill_bucket', jsonb_build_object('kind', 'item', 'uid', v_bucket));
  insert into said values ('filled', (select text from event where world_id = w and uid = me order by n desc limit 1)
                                     || ' | ' || pack_count(w, me, 'water_bucket'));
  insert into said values ('drink', coalesce(act_refusal(w, me, 'drink_from_vessel', jsonb_build_object('kind', 'furniture', 'id', f.id)), 'none'));
  perform act_perform(w, me, 'drink_from_vessel', jsonb_build_object('kind', 'furniture', 'id', f.id));
  insert into said values ('drank', (select text from event where world_id = w and uid = me order by n desc limit 1)
                                    || ' | ' || (select round((stats->>'thirst')::numeric, 2) from player where world_id = w and uid = me));
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\\n' order by k) from said;
rollback;`);
  const said = new Map(island.split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const g = browserScene();
  g.player.x = 12.5;
  g.player.y = 38.5;
  const bucket = g.inventory.add('bucket', { ql: 50 });
  const fillAct = act('fill_bucket');
  const before = fillAct.check?.({ kind: 'item', uid: bucket.uid }, g) ?? 'none';
  const f = g.addFurniture('fountain', 12, 39, 0, 0, 80);
  f.litres = Math.min(WELL_HOLDS, g.wellRate(f) * 300);
  f.liquid = 'water';
  const five = f.litres;
  const src = sourceFor(g);
  const fill = fillAct.check?.({ kind: 'item', uid: bucket.uid }, g) ?? 'none';
  const told: string[] = [];
  const hear = g.logMsg.bind(g);
  g.logMsg = (text, kind) => { told.push(text); hear(text, kind); };
  fillAct.perform({ kind: 'item', uid: bucket.uid }, g);
  const [isWell, liquid, holds, rate] = (said.get('well') ?? '').split(',');
  say(before === said.get('before') && isWell === 'true' && liquid === 'water' && Number(holds) === WELL_HOLDS && Math.abs(Number(rate) - g.wellRate(f)) < 1e-5,
    `a fountain is a well on the island (${said.get('well')}) and in the browser: water, ${WELL_HOLDS} litres, ${g.wellRate(f).toFixed(5)} a second at QL 80; before it stood there was no water: "${before}"`);
  say(Math.abs(Number(said.get('five')) - five) < 1e-3 && src?.from === f && fill === said.get('fill') && fill === 'none',
    `five minutes left alone it holds ${five.toFixed(3)} litres on both sides, and a bucket is filled from it`);
  const [filledText, buckets] = (said.get('filled') ?? '').split(' | ');
  say(told[told.length - 1] === filledText && Number(buckets) === 1 && g.inventory.has('water_bucket'), `in the same words: "${filledText}"`);
  say(said.get('drink') === 'none' && /tiered fountain/.test(said.get('drank') ?? ''), `and it is drunk from: "${said.get('drank')}"`);
}

/* ---- What botany turns up at the water's edge ------------------------------------------------------ */

{
  const rows = psql(`select string_agg(item || ':' || weight, ',' order by item) from loot_table where id = 'botanize_water'`);
  const mine = [...BOTANIZE_WATER_TABLE].sort((a, b) => a[0].localeCompare(b[0])).map(([i, w]) => `${i}:${w}`).join(',');
  const rolled = psql(`select string_agg(distinct roll_table('botanize_water', r / 400.0), ',') from generate_series(0, 400) r`).split(',');
  say(rows === mine && rolled.includes('lily_root') && rolled.includes('lotus_seed'),
    `the island's table at the water's edge is the browser's, ${BOTANIZE_WATER_TABLE.length} finds, and turns up both: ${rolled.filter((r) => r.includes('lily') || r.includes('lotus')).join(', ')}`);
}

console.log(bad ? `${bad} of these are not what they should be` : 'all as they should be');
process.exit(bad ? 1 : 0);
