/**
 * Piers and stilts, on both sides.
 *
 * Asked for: a building may take in tiles that slope or lie under shallow
 * water by standing its ground floor on piers -- a level deck at the
 * building's floor height, carried down to the ground or the bed of the sea
 * or a pond -- walked at its height on both sides, with the ground under it
 * left alone while the building stands.
 *
 * Everything a deck decides is written twice: `src/game/piers.ts`,
 * `Game.planReason`, `pierSite`, `deckStep`, the building actions, the
 * movement rules, the crate's footing and Examine in the browser; and on the
 * island `pier_refusal`, `pier_deck_for`, `extend_reason`,
 * `pier_site_refusal`, `pier_step`, `deck_surface`, `deck_bill`,
 * `deck_refusal`, `deck_carries`, `deck_bears`, `pier_shoo_all`, `pier_says` and
 * the shared functions they are called from. So one scene is built on both sides -- a
 * sea shelving deep to the west, land rising east from it, a spring's pond in
 * a bowl with a water lily in it, a steep bank in the south-east, a level
 * terrace of packed dirt, and tiles of things that stand, are sown or are
 * laid -- and put to both:
 *
 *   * every tile of it, whether a building may be planned there and on what
 *     deck, in the same words; and again with a level taken over the pond;
 *   * a house planned at the top of the bank and carried down it a tile at a
 *     time until a pier would span too far, a jetty planned on the shore and
 *     carried out into the sea until the water is too deep, and a hut on the
 *     terrace carried onto the slope beside it: every message, the deck and
 *     the tiles on piers, and every tile round each asked whether it may join
 *     and under what deck;
 *   * the piers' bill in every material over drops from a tenth of a metre to
 *     the most, and decks planned through the doors with their bills;
 *   * walls and a staircase on a tile on piers, and a deck taken up with
 *     something on it and from on top of it;
 *   * walking onto a deck not built, on and off a deck at its height, off its
 *     edge high over the ground, along it, with a cart and in a hull; in the
 *     water or not on a deck over the sea; and whether a step teaches
 *     climbing;
 *   * the ground under a tile on piers dug, flattened, packed, cultivated, paved,
 *     laid with stones, planted with a lily, a sprout or moss, mined at a
 *     corner, and raised by dirt dropped at your feet on the deck -- refused
 *     alike;
 *   * a crate on a deck over the sea and on one not built, a hull launched
 *     under a deck, Examine on a deck built and not, and the ground read;
 *   * a creature refused every tile on piers and its walk across under a
 *     deck, a woola on a tile as it is taken onto piers moved off it to the
 *     same tile, and a companion that does not follow its keeper out along
 *     the jetty;
 *   * bridges over a gully between two decks, from a deck over the water to a
 *     bank and from a deck to a bank: refused while a deck is not built, and
 *     then landing at the decks' height; walked onto from a deck and off onto
 *     one; and the deck and the tile a bridge lands on not taken up or taken
 *     onto piers;
 *   * walls and decks a building's decks would or would not carry, a tile
 *     taken onto piers with a cart, the planner or somebody else on it, a
 *     deck taken up with somebody on it, and Examine once the water has
 *     risen close under a deck and over it.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, GRASS_PLANT, MOSS_PLANT, type Target } from '../../src/game/actions';
import { BUILD_ACTION_BY_ID } from '../../src/game/buildActions';
import { CRATE_ACTIONS } from '../../src/game/crates';
import { MATERIALS, isDone } from '../../src/game/building';
import type { Item } from '../../src/game/items';
import { CREATURE_CRATE, letOut, shutIn } from '../../src/game/creaturecrate';
import { furnitureCentre } from '../../src/game/furniture';
import { UI } from '../../src/ui/ui';
import type { MenuItem } from '../../src/ui/contextmenu';
import { metres, PIER_CLEAR, PIER_DROP, PIER_SHOO, PIER_WALL_DROP, PIER_WATER, pierBill } from '../../src/game/piers';
import { onSteps } from '../../src/game/player';
import { TileType, stonesData } from '../../src/world/tiles';

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
let good = 0;
const say = (ok: boolean, line: string): void => {
  if (ok) good++;
  else bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`);
};
const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
/** The island's answers, one `tag=value` a row, `~~` between rows. */
const answers = (out: string): Map<string, string> =>
  new Map(out.split('\n~~\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

/* ---- The scene ---------------------------------------------------------------------------------- */

/*
 * On the Hoarding island (64 across), in its south-west quarter: corners x 0
 * to 32 and y 32 to 64. A sea shelving west from x 6 to three and a half
 * metres deep at the edge; land rising east from it a step and a half a
 * corner; a bowl dug into the slope at (19, 48), where a spring fills a pond
 * that spills west down the slope to the sea; a terrace of packed dirt level
 * at 30; and a bank in the south-east falling eight a corner to the west.
 * Everywhere else on the island stands at 30.
 */
const SEA = [-34, -26, -18, -11, -6, -2];
const BOWL: [number, number] = [19, 48];
function height(x: number, y: number): number {
  if (x > 32 || y < 32) return 30;
  if (x < SEA.length) return SEA[x];
  if (x >= 24 && x <= 27 && y >= 38 && y <= 41) return 30;
  if (y >= 56 && x >= 22) return 20 + (x - 22) * 8;
  let h = 2 + Math.floor((x - SEA.length) * 1.5);
  const d = Math.hypot(x - BOWL[0], y - BOWL[1]);
  if (d < 3.6) h -= Math.round((3.6 - d) * 3.4);
  return h;
}
const SPRING: [number, number] = [BOWL[0] - 1, BOWL[1] - 1];
function tileAt(x: number, y: number): [number, number] {
  // The terrace is packed but for its south-east tile, level grass.
  if (x >= 24 && x <= 26 && y >= 38 && y <= 40) return [x === 26 && y === 40 ? TileType.Grass : TileType.PackedDirt, 0];
  if (x === 4 && y === 36) return [TileType.Cobblestone, 0];
  if (x === 3 && y === 38) return [TileType.SteppingStones, stonesData(2, TileType.Sand)];
  if (x === 20 && y === 47) return [TileType.Tree, 2];
  if (x === 12 && y === 46) return [TileType.Field, 0];
  if (x < 32 && Math.min(height(x, y), height(x + 1, y), height(x, y + 1), height(x + 1, y + 1)) < 0) return [TileType.Sand, 0];
  return [TileType.Grass, 0];
}
const LILY_AT: [number, number] = [17, 48];
/** The settlement over the scene, and its token: the same on both sides. */
const DEED = { name: 'Pierside', x: 16, y: 47, radius: 17, level: 1 };

const cornerRows: string[] = [];
for (let y = 31; y <= 64; y++) for (let x = 0; x <= 40; x++) cornerRows.push(`(${x}, ${y}, ${height(x, y)})`);
const tileRows: string[] = [];
for (let y = 31; y < 64; y++) for (let x = 0; x < 40; x++) {
  const [t, d] = tileAt(x, y);
  tileRows.push(`(${x}, ${y}, ${t}, ${d})`);
}

/** What Crowd4 carries for all of it. */
const TOOLS = ['mallet', 'shovel', 'trowel', 'pickaxe'];

/** The scene laid on the island, in the transaction the caller has open, with `w`, `me` and `v_spring` declared. */
const ISLAND_SCENE = `
  select id into w from world where name = 'Hoarding';
  select uid into me from player where world_id = w and name = 'Crowd4';
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  delete from spring where world_id = w;
  delete from water_plant where world_id = w;
  delete from placed where world_id = w and x < 41 and y > 29;
  delete from crate where world_id = w and x < 41 and y > 29;
  delete from foundation where world_id = w and x < 41 and y > 29;
  delete from item where world_id = w and holder = 'ground' and gx < 41 and gy > 29;
  delete from building b where b.world_id = w and exists (select 1 from building_tile bt
    where bt.world_id = w and bt.building = b.id and bt.x < 41 and bt.y > 29);
  -- Anybody's token in the scene goes too, not only Crowd4's: the island test founds Dane's
  -- Latecomer over a hoard buried wherever it fell, and its token, standing at 25,43, refused a
  -- plan there that the browser, which holds only Pierside, took (run 921).
  delete from deed where world_id = w and (founded_by = me or (x < 41 and y > 29));
  insert into deed (world_id, name, x, y, radius, level, founded_by)
    values (w, ${q(DEED.name)}, ${DEED.x}, ${DEED.y}, ${DEED.radius}, ${DEED.level}, me);
  perform land_set_height(w, v.x, v.y, v.h) from (values ${cornerRows.join(', ')}) v(x, y, h);
  perform land_set_tile(w, v.x, v.y, v.t), land_set_data(w, v.x, v.y, v.d) from (values ${tileRows.join(', ')}) v(x, y, t, d);
  insert into spring (world_id, x, y, cx, cy, made_by)
    values (w, ${SPRING[0]}, ${SPRING[1]}, (spring_corner(w, ${SPRING[0]}, ${SPRING[1]}))[1], (spring_corner(w, ${SPRING[0]}, ${SPRING[1]}))[2], me)
    returning id into v_spring;
  perform settle_spring(w, v_spring);
  insert into water_plant (world_id, x, y, kind, planted_at) values (w, ${LILY_AT[0]}, ${LILY_AT[1]}, 'lily', now() - interval '3 days');
  update player set x = 28.5, y = 44.5, level = 0, level_h = null, act = null, act_queue = '[]'::jsonb, aboard = null
    where world_id = w and uid = me;
  delete from item where world_id = w and holder = 'player' and holder_uid = me;
  ${TOOLS.map((t) => `perform give(w, me, ${q(t)}, 1, 50);`).join(' ')}
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
  g.springs.dig(SPRING[0], SPRING[1], null, Date.now() - 3600 * 1000);
  g.update(0.01);
  g.plantWater(LILY_AT[0], LILY_AT[1], 'lily', Date.now() / 1000 - 3 * 86400);
  for (const it of [...g.inventory.items]) g.inventory.remove(it.uid, it.count);
  for (const t of TOOLS) g.inventory.add(t, { ql: 50 });
  g.deed = { ...DEED } as typeof g.deed;
  g.player.x = 28.5;
  g.player.y = 44.5;
  g.level = null;
  return g;
}

/** A tile target, as both sides take one. */
const tile = (x: number, y: number, more: Record<string, unknown> = {}): Target => ({ kind: 'tile', x, y, cx: x, cy: y, ...more } as Target);
const jt = (x: number, y: number, more: Record<string, string | number> = {}): string =>
  `jsonb_build_object('kind', 'tile', 'x', ${x}, 'y', ${y}, 'cx', ${x}, 'cy', ${y}${Object.entries(more).map(([k, v]) => `, ${q(k)}, ${typeof v === 'number' ? v : q(v)}`).join('')})`;
const build = (id: string) => BUILD_ACTION_BY_ID.get(id)!;
/** The browser's door and then its deed, as the island's `build_refusal` and `perform_building` are asked; the message it logs, or its refusal. */
function run(g: Game, id: string, t: Target): string {
  const why = build(id).check?.(t, g) ?? null;
  if (why) return `REFUSED ${why}`;
  build(id).perform(t, g);
  return g.log[g.log.length - 1]?.text ?? '';
}
/** The same on the island, in a block with `w`, `me` and `v_why` declared. */
const runSql = (tag: string, id: string, target: string): string => `
  v_why := build_refusal(w, me, ${q(id)}, ${target});
  if v_why is null then
    perform perform_building(w, me, ${q(id)}, ${target});
    insert into said values (${q(tag)}, (select e.text from event e where e.world_id = w and e.uid = me order by e.n desc limit 1));
  else
    insert into said values (${q(tag)}, 'REFUSED ' || v_why);
  end if;`;
/** A finished floor at every one of a building's tiles on both sides, as if its every unit were laid. */
const finishSql = (x0: number, x1: number, y: number): string =>
  `update floor_tile set needed = (select jsonb_object_agg(k, 0) from jsonb_object_keys(needed) k)
     where world_id = w and level = 0 and y = ${y} and x between ${x0} and ${x1};`;
function finish(g: Game, x0: number, x1: number, y: number): void {
  for (let x = x0; x <= x1; x++) {
    const f = g.buildings.floor(0, x, y);
    if (f) for (const k of Object.keys(f.needed)) f.needed[k] = 0;
  }
}

/* ---- Every tile of the scene: a plan, and on what deck ------------------------------------------ */

{
  const island = answers(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; v_spring bigint;
begin
  ${ISLAND_SCENE}
  insert into said select 'water', (select chain::text from spring where id = v_spring);
  insert into said select 'plan', string_agg(x || ',' || y || '=' || coalesce(plan_reason(w, me, x, y), 'OK')
      || '|' || coalesce(pier_deck_for(w, me, x, y, null)::text, '-'), E'\\n' order by y, x)
    from generate_series(0, 31) x, generate_series(32, 63) y;
  update player set level_h = 26 where world_id = w and uid = me;
  insert into said select 'sighted', string_agg(x || ',' || y || '=' || coalesce(plan_reason(w, me, x, y), 'OK')
      || '|' || coalesce(pier_deck_for(w, me, x, y, null)::text, '-'), E'\\n' order by y, x)
    from generate_series(0, 31) x, generate_series(32, 63) y;
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\\n~~\\n' order by k) from said;
rollback;`));
  const g = browserScene();
  const s = [...g.springs.list.values()][0];
  const chain = JSON.parse(island.get('water') ?? 'null');
  say(!!s && !!chain && s.chain.ponds.length === chain.ponds.length && s.chain.ponds[0].level === chain.ponds[0].level,
    `the scene's water is the same on both sides: a pond at ${s?.chain.ponds[0]?.level} over a floor of ${s?.chain.ponds[0]?.floor}`);
  for (const [tag, level] of [['plan', null], ['sighted', 26]] as Array<[string, number | null]>) {
    g.level = level;
    const rows = (island.get(tag) ?? '').split('\n');
    let same = 0;
    let first = '';
    const tally = new Map<string, number>();
    for (const row of rows) {
      const [at, theirs] = row.split('=');
      const [x, y] = at.split(',').map(Number);
      const why = g.planReason(x, y);
      const mine = `${why ?? 'OK'}|${g.pierSite(x, y).deck ?? '-'}`;
      const kind = why === null ? (g.pierSite(x, y).deck === null ? 'level ground' : 'on piers') : why.replace(/\d+(\.\d+)?/g, 'N');
      tally.set(kind, (tally.get(kind) ?? 0) + 1);
      if (mine === theirs) same++;
      else if (!first) first = `at ${x},${y}: browser "${mine}" | island "${theirs}"`;
    }
    say(same === rows.length && rows.length === 32 * 32,
      `${level === null ? 'every tile of the scene' : `with a level taken at ${level}, every tile`} is planned on, or refused, in the same words and on the same deck: ${same} of ${rows.length}${first ? ` -- first difference ${first}` : ''}`);
    const kinds = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} × ${k.slice(0, 60)}`);
    say(kinds.length >= 8 && (tally.get('on piers') ?? 0) > 100 && (tally.get('level ground') ?? 0) > 0,
      `and the scene asks every question there is: ${kinds.join('; ')}`);
  }
}

/* ---- Three buildings put up a tile at a time ------------------------------------------------------- */

/** Each: its name, the tile it is planned on, the tiles added to it in order, and the window of tiles round it asked whether they may join. */
const HOUSES: Array<{ name: string; at: [number, number]; add: Array<[number, number]>; window: [number, number, number, number] }> = [
  // Down the bank from its top, until a pier would span more than ${PIER_DROP}.
  { name: 'Bank house', at: [30, 58], add: [29, 28, 27, 26, 25, 24, 23].map((x) => [x, 58] as [number, number]), window: [20, 55, 31, 61] },
  // Off the shore into the sea, until the water is deeper than a pier stands in.
  { name: 'Jetty', at: [7, 44], add: [6, 5, 4, 3, 2, 1].map((x) => [x, 44] as [number, number]), window: [0, 41, 10, 47] },
  // A hut on the terrace, carried onto the slope west of it and refused the rise east of it.
  { name: 'Hut', at: [25, 39], add: [[24, 39], [23, 39], [26, 39], [27, 39], [22, 39]], window: [20, 36, 29, 42] },
];
{
  const island = answers(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; v_spring bigint; v_why text; v_b int;
begin
  ${ISLAND_SCENE}
  ${HOUSES.map((h, i) => `
  ${runSql(`H${i}plan`, 'plan_building', jt(h.at[0], h.at[1], { name: h.name }))}
  ${h.add.map(([x, y], k) => runSql(`H${i}add${k}`, 'add_to_building', jt(x, y))).join('\n')}
  v_b := building_at(w, ${h.at[0]}, ${h.at[1]});
  insert into said select 'H${i}shape', b.deck || ' ' || coalesce((select string_agg(bt.x || ',' || bt.y, ' ' order by bt.x, bt.y)
      from building_tile bt where bt.world_id = w and bt.building = b.id and bt.pier), '-')
    from building b where b.world_id = w and b.id = v_b;
  insert into said select 'H${i}ring', string_agg(x || ',' || y || '=' || coalesce(extend_reason(w, me, x, y, v_b), 'OK')
      || '|' || coalesce(pier_deck_for(w, me, x, y, v_b)::text, '-'), E'\\n' order by y, x)
    from generate_series(${h.window[0]}, ${h.window[2]}) x, generate_series(${h.window[1]}, ${h.window[3]}) y;`).join('\n')}
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\\n~~\\n' order by k) from said;
rollback;`));
  const g = browserScene();
  HOUSES.forEach((h, i) => {
    const said = [run(g, 'plan_building', tile(h.at[0], h.at[1], { name: h.name })), ...h.add.map(([x, y]) => run(g, 'add_to_building', tile(x, y)))];
    const theirs = [island.get(`H${i}plan`) ?? '', ...h.add.map((_, k) => island.get(`H${i}add${k}`) ?? '')];
    said.forEach((mine, k) => {
      const what = k === 0 ? `planned at ${h.at.join(',')}` : `extended to ${h.add[k - 1].join(',')}`;
      say(mine === theirs[k], `${h.name} ${what}: "${mine}"${mine === theirs[k] ? '' : ` -- island "${theirs[k]}"`}`);
    });
    const b = g.buildings.buildingAt(h.at[0], h.at[1])!;
    const shape = `${b.deck ?? 'null'} ${[...(b.piers ?? [])].map((k) => k.split(',').map(Number)).sort((p, r) => p[0] - r[0] || p[1] - r[1]).map((p) => p.join(',')).join(' ') || '-'}`;
    say(shape === island.get(`H${i}shape`), `${h.name} stands on the same deck and the same tiles on piers: ${shape}${shape === island.get(`H${i}shape`) ? '' : ` -- island ${island.get(`H${i}shape`)}`}`);
    const rows = (island.get(`H${i}ring`) ?? '').split('\n');
    let same = 0;
    let first = '';
    for (const row of rows) {
      const [at, theirs2] = row.split('=');
      const [x, y] = at.split(',').map(Number);
      const mine = `${g.planReason(x, y, b) ?? 'OK'}|${g.pierSite(x, y, b).deck ?? '-'}`;
      if (mine === theirs2) same++;
      else if (!first) first = `at ${x},${y}: browser "${mine}" | island "${theirs2}"`;
    }
    say(same === rows.length, `every tile round ${h.name} may join it, or not, in the same words and under the same deck: ${same} of ${rows.length}${first ? ` -- first difference ${first}` : ''}`);
  });
}

/* ---- What the piers take ------------------------------------------------------------------------- */

/** The materials a deck is laid in, the browser's `MATERIALS`: the island's table has glass in it too, which roofs and does nothing else. */
const FLOORED = MATERIALS.map((m) => `'${m.id}'`).join(', ');

{
  const DROPS = [1, 3, 16, 33, 50, 59, PIER_DROP, PIER_WALL_DROP - 1, PIER_WALL_DROP, PIER_WALL_DROP + 1];
  const theirs = psql(`select string_agg(m.id || ':' || d || '=' || (select coalesce(string_agg(e.key || ' ' || e.value, ',' order by e.key), '')
      from jsonb_each_text(pier_bill(m.id, d)) e), E'\\n' order by m.id, d)
    from build_material_def m, unnest(array[${DROPS.join(', ')}]) d where m.id in (${FLOORED})`).split('\n');
  const mine = MATERIALS.flatMap((m) => DROPS.map((d) => `${m.id}:${d}=${Object.entries(pierBill(m.id, d).needed).sort((a, b2) => a[0].localeCompare(b2[0])).map(([k, n]) => `${k} ${n}`).join(',')}`))
    .sort((a, b2) => (a.split(':')[0] === b2.split(':')[0] ? Number(a.split(':')[1].split('=')[0]) - Number(b2.split(':')[1].split('=')[0]) : a.localeCompare(b2)));
  const same = mine.filter((l) => theirs.includes(l)).length;
  say(same === mine.length && theirs.length === mine.length, `the piers under a deck cost the same in all ${MATERIALS.length} materials over ${DROPS.length} drops: ${same} of ${mine.length}`);
  const plank = pierBill('plank', 16).needed;
  say(plank.plank === Math.ceil((24 * 16) / PIER_WALL_DROP) && plank.timber === 1,
    `a plank deck 1.6 m over the ground takes ${plank.plank} planks and ${plank.timber} timber in piers: a tenth of a wall's ${24} and ${4} a metre, rounded up`);
}

/* ---- Decks planned, walls and stairs on them, and taking one up ------------------------------------- */

{
  const DOORS: Array<[string, string, (g: Game) => Target, string]> = [
    // The Bank house's piers, in plank and in stone brick, and a wall on a deck not built.
    ['a plank deck on piers', 'plan_floor', () => tile(28, 58, { material: 'plank', floorKind: 'floor' }), jt(28, 58, { material: 'plank', floorKind: 'floor' })],
    ['a stone brick deck on piers', 'plan_floor', () => tile(25, 58, { material: 'stone_brick', floorKind: 'floor' }), jt(25, 58, { material: 'stone_brick', floorKind: 'floor' })],
    ['a wall on a tile on piers with no deck', 'plan_wall', () => tile(27, 58, { side: 'n', wallType: 'solid', material: 'plank' }), jt(27, 58, { side: 'n', wallType: 'solid', material: 'plank' })],
    ['a wall on a deck planned but not built', 'plan_wall', () => tile(28, 58, { side: 'n', wallType: 'solid', material: 'plank' }), jt(28, 58, { side: 'n', wallType: 'solid', material: 'plank' })],
  ];
  const island = answers(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; v_spring bigint; v_why text; v_b int;
begin
  ${ISLAND_SCENE}
  ${runSql('plan', 'plan_building', jt(30, 58, { name: 'Bank house' }))}
  ${[29, 28, 27, 26, 25].map((x) => runSql(`add${x}`, 'add_to_building', jt(x, 58))).join('\n')}
  ${DOORS.map(([, id, , target], i) => runSql(`D${i}`, id, target)).join('\n')}
  insert into said select 'bills', string_agg(f.x || ' ' || f.material || ' ' || f.needed::text || ' ' || f.total::text, '; ' order by f.x)
    from floor_tile f where f.world_id = w and f.level = 0 and f.y = 58;
  -- The deck at 28 built, a wall planned on it, and a storey over the house for a staircase.
  ${finishSql(28, 28, 58)}
  ${runSql('wallBuilt', 'plan_wall', jt(28, 58, { side: 'n', wallType: 'solid', material: 'plank' }))}
  update building set levels = 2, work_level = 1 where world_id = w and id = building_at(w, 30, 58);
  ${runSql('stairsNoDeck', 'plan_floor', jt(27, 58, { material: 'plank', floorKind: 'stairs', side: 'e' }))}
  ${runSql('stairsDeck', 'plan_floor', jt(28, 58, { material: 'plank', floorKind: 'stairs', side: 'e' }))}
  update building set work_level = 0 where world_id = w and id = building_at(w, 30, 58);
  -- Taking up the deck at 25: with a stick lying on it, then from on top of it, then from beside it.
  ${finishSql(25, 25, 58)}
  insert into item (world_id, holder, gx, gy, def, ql, count) values (w, 'ground', 25, 58, 'shaft', 20, 1);
  insert into said values ('upItem', coalesce(build_refusal(w, me, 'remove_floor', ${jt(25, 58)}), 'OK'));
  delete from item where world_id = w and holder = 'ground' and gx = 25 and gy = 58;
  update player set x = 25.5, y = 58.5 where world_id = w and uid = me;
  insert into said values ('upOn', coalesce(build_refusal(w, me, 'remove_floor', ${jt(25, 58)}), 'OK'));
  update player set x = 26.5, y = 58.5 where world_id = w and uid = me;
  insert into said values ('upBeside', coalesce(build_refusal(w, me, 'remove_floor', ${jt(25, 58)}), 'OK'));
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\\n~~\\n' order by k) from said;
rollback;`));
  const g = browserScene();
  run(g, 'plan_building', tile(30, 58, { name: 'Bank house' }));
  for (const x of [29, 28, 27, 26, 25]) run(g, 'add_to_building', tile(x, 58));
  DOORS.forEach(([name, id, target], i) => {
    const mine = run(g, id, target(g));
    say(mine === island.get(`D${i}`), `${name}: "${mine}"${mine === island.get(`D${i}`) ? '' : ` -- island "${island.get(`D${i}`)}"`}`);
  });
  const bills = [...g.buildings.floors.values()].filter((f) => f.level === 0 && f.y === 58).sort((a, b) => a.x - b.x)
    .map((f) => `${f.x} ${f.material} ${JSON.stringify(Object.fromEntries(Object.entries(f.needed).sort()))} ${JSON.stringify(Object.fromEntries(Object.entries(f.total).sort()))}`)
    .join('; ').replace(/":/g, '": ').replace(/,"/g, ', "');
  say(bills === island.get('bills'), `and they are the same decks with the same bills: ${bills}${bills === island.get('bills') ? '' : ` -- island ${island.get('bills')}`}`);
  finish(g, 28, 28, 58);
  const steps: Array<[string, string, Target]> = [
    ['wallBuilt', 'plan_wall', tile(28, 58, { side: 'n', wallType: 'solid', material: 'plank' })],
  ];
  for (const [tag, id, t] of steps) {
    const mine = run(g, id, t);
    say(mine === island.get(tag), `a wall on a deck built: "${mine}"${mine === island.get(tag) ? '' : ` -- island "${island.get(tag)}"`}`);
  }
  const b = g.buildings.buildingAt(30, 58)!;
  b.levels = 2;
  b.workLevel = 1;
  for (const [tag, x, what] of [['stairsNoDeck', 27, 'a staircase up from a tile on piers with no deck'], ['stairsDeck', 28, 'a staircase up from a deck']] as Array<[string, number, string]>) {
    const mine = run(g, 'plan_floor', tile(x, 58, { material: 'plank', floorKind: 'stairs', side: 'e' }));
    say(mine === island.get(tag), `${what}: "${mine}"${mine === island.get(tag) ? '' : ` -- island "${island.get(tag)}"`}`);
  }
  b.workLevel = 0;
  finish(g, 25, 25, 58);
  g.dropOnGround(25, 58, { uid: 9999, id: 'shaft', ql: 20, dmg: 0, count: 1 } as Item);
  const up = (): string => build('remove_floor').check?.(tile(25, 58), g) ?? 'OK';
  const withItem = up();
  g.ground.clear();
  g.player.x = 25.5;
  g.player.y = 58.5;
  const onTop = up();
  g.player.x = 26.5;
  const beside = up();
  for (const [tag, mine, what] of [['upItem', withItem, 'a deck taken up with a stick lying on it'], ['upOn', onTop, 'from on top of it'], ['upBeside', beside, 'and from beside it']] as Array<[string, string, string]>) {
    say(mine === island.get(tag), `${what}: "${mine}"${mine === island.get(tag) ? '' : ` -- island "${island.get(tag)}"`}`);
  }
}

/* ---- Walking on it ------------------------------------------------------------------------------------ */

{
  /*
   * The Bank house planned at the top of the bank and carried down it to 24,
   * every deck built but the one at 24; the jetty off the shore out to 2,
   * every deck built but the one at 2.
   */
  const WALKS: Array<[string, [number, number], [number, number]]> = [
    ['from the top of the bank onto the deck that meets it', [31, 58], [30, 58]],
    ['off the deck onto the top of the bank', [30, 58], [31, 58]],
    ['along the deck down the bank', [29, 58], [28, 58]],
    ['onto a deck not built', [25, 58], [24, 58]],
    ['off the side of the deck five metres over the bank', [25, 58], [25, 59]],
    ['up onto the deck from the bank five metres under it', [25, 57], [25, 58]],
    ['from the shore onto the jetty', [8, 44], [7, 44]],
    ['out along the jetty', [4, 44], [3, 44]],
    ['onto the jetty\'s last deck, not built', [3, 44], [2, 44]],
    ['off the jetty into the sea beside it', [4, 44], [4, 45]],
    ['out of the sea onto the jetty', [4, 45], [4, 44]],
  ];
  const DEEP: Array<[string, [number, number]]> = [
    ['on the jetty over the sea', [3.5, 44.5]],
    ['in the sea beside it', [3.5, 45.5]],
    ['in the sea under the deck not built', [2.5, 44.5]],
  ];
  const island = answers(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; v_spring bigint; v_why text; v_x int; v_cart bigint;
begin
  ${ISLAND_SCENE}
  delete from skill where world_id = w and uid = me and id = 'climbing';
  ${runSql('bank', 'plan_building', jt(30, 58, { name: 'Bank house' }))}
  for v_x in reverse 29..24 loop
    perform perform_building(w, me, 'add_to_building', ${jt(0, 58).replace("'x', 0", "'x', v_x").replace("'cx', 0", "'cx', v_x")});
  end loop;
  ${runSql('jetty', 'plan_building', jt(7, 44, { name: 'Jetty' }))}
  for v_x in reverse 6..2 loop
    perform perform_building(w, me, 'add_to_building', ${jt(0, 44).replace("'x', 0", "'x', v_x").replace("'cx', 0", "'cx', v_x")});
  end loop;
  for v_x in 24..30 loop perform perform_building(w, me, 'plan_floor', ${jt(0, 58, { material: 'plank', floorKind: 'floor' }).replace("'x', 0", "'x', v_x").replace("'cx', 0", "'cx', v_x")}); end loop;
  for v_x in 2..7 loop perform perform_building(w, me, 'plan_floor', ${jt(0, 44, { material: 'plank', floorKind: 'floor' }).replace("'x', 0", "'x', v_x").replace("'cx', 0", "'cx', v_x")}); end loop;
  ${finishSql(25, 30, 58)}
  ${finishSql(3, 7, 44)}
  insert into said select 'decks', string_agg(x || ',' || y || '=' || coalesce(deck_surface(w, x, y)::text, '-'), ' ' order by y, x)
    from (values ${[24, 25, 26, 27, 28, 29, 30, 31].map((x) => `(${x}, 58)`).join(', ')}, ${[1, 2, 3, 4, 5, 6, 7, 8].map((x) => `(${x}, 44)`).join(', ')}) v(x, y);
  ${WALKS.map(([, a, c], i) => `
  insert into said values ('W${i}', (walk_share(w, me, 0, ${a[0]}.5, ${a[1]}.5, ${c[0]}.5, ${c[1]}.5) >= 1)
    || ' ' || coalesce(array_length(walk_climbs(w, ${a[0]}.5, ${a[1]}.5, ${c[0]}.5, ${c[1]}.5), 1), 0));`).join('')}
  ${DEEP.map(([, [x, y]], i) => `
  update player set x = ${x}, y = ${y}, level = 0 where world_id = w and uid = me;
  insert into said values ('S${i}', in_deep_water(w, me)::text);`).join('')}
  update player set x = 8.5, y = 44.5 where world_id = w and uid = me;
  -- A cart on the reins, onto the jetty and along the shore.
  insert into placed (world_id, kind, sub, x, y, cx, cy, ql, made_by, driver)
    values (w, 'furniture', 'large_cart', 8, 44, 8.5, 44.5, 30, me, me) returning id into v_cart;
  insert into said values ('cart', (walk_share(w, me, 0, 8.5, 44.5, 7.5, 44.5) >= 1) || ' ' || (walk_share(w, me, 0, 8.5, 44.5, 8.5, 45.5) >= 1));
  delete from placed where id = v_cart;
  -- And a rowing boat, under the jetty's end and alongside it.
  insert into placed (world_id, kind, sub, x, y, cx, cy, ql, made_by, driver)
    values (w, 'furniture', 'rowing_boat', 2, 45, 2.5, 45.5, 30, me, me) returning id into v_cart;
  insert into said values ('hull', (walk_share(w, me, 0, 2.5, 45.5, 2.5, 44.5) >= 1) || ' ' || (walk_share(w, me, 0, 2.5, 45.5, 1.5, 45.5) >= 1)
    || ' ' || launch_spot(w, 'rowing_boat', 2, 44) || ' ' || launch_spot(w, 'rowing_boat', 1, 45));
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\\n~~\\n' order by k) from said;
rollback;`));
  const g = browserScene();
  g.skills.values.set('climbing', 0);
  run(g, 'plan_building', tile(30, 58, { name: 'Bank house' }));
  for (let x = 29; x >= 24; x--) run(g, 'add_to_building', tile(x, 58));
  run(g, 'plan_building', tile(7, 44, { name: 'Jetty' }));
  for (let x = 6; x >= 2; x--) run(g, 'add_to_building', tile(x, 44));
  for (let x = 24; x <= 30; x++) run(g, 'plan_floor', tile(x, 58, { material: 'plank', floorKind: 'floor' }));
  for (let x = 2; x <= 7; x++) run(g, 'plan_floor', tile(x, 44, { material: 'plank', floorKind: 'floor' }));
  finish(g, 25, 30, 58);
  finish(g, 3, 7, 44);
  const decks = [...[1, 2, 3, 4, 5, 6, 7, 8].map((x) => [x, 44]), ...[24, 25, 26, 27, 28, 29, 30, 31].map((x) => [x, 58])]
    .map(([x, y]) => `${x},${y}=${g.pierDeckAt(x, y) ?? '-'}`).join(' ');
  say(decks === island.get('decks'), `the decks stand at the same heights, and the ones not built nowhere: ${decks}${decks === island.get('decks') ? '' : ` -- island ${island.get('decks')}`}`);
  WALKS.forEach(([name, a, c], i) => {
    const walks = g.stepRule(a[0], a[1], 0, c[0], c[1]) !== null;
    const decked = g.onPierDeck(a[0], a[1]) || g.onPierDeck(c[0], c[1]);
    const climbs = !walks ? null : onSteps(g.world, a[0], a[1], c[0], c[1]) || decked ? 0 : 1;
    const [iw, ic] = (island.get(`W${i}`) ?? '').split(' ');
    say(String(walks) === iw, `${name}: ${walks ? 'walked' : 'refused'} on both sides${String(walks) === iw ? '' : ` -- island ${iw}`}`);
    if (climbs !== null) say(String(climbs) === ic, `${name}: ${climbs ? 'a climb' : 'no climb'} on both sides${String(climbs) === ic ? '' : ` -- island ${ic}`}`);
  });
  DEEP.forEach(([name, [x, y]], i) => {
    g.player.x = x;
    g.player.y = y;
    g.player.update(0.016, g.world, g.movement().rule, g.onPierDeck);
    const deep = String(g.player.swimming);
    say(deep === island.get(`S${i}`), `${name}: ${g.player.swimming ? 'swimming' : 'dry'} on both sides${deep === island.get(`S${i}`) ? '' : ` -- island ${island.get(`S${i}`)}`}`);
  });
  const cart = g.addFurniture('large_cart', 8, 44, 0, 0, 30);
  cart.driven = true;
  const drives = `${g.driveRule(8, 44, 0, 7, 44) !== null} ${g.driveRule(8, 44, 0, 8, 45) !== null}`;
  g.removeFurniture(cart.id);
  say(drives === island.get('cart'), `a cart is refused the jetty and driven along the shore on both sides: ${drives}${drives === island.get('cart') ? '' : ` -- island ${island.get('cart')}`}`);
  const boat = g.addFurniture('rowing_boat', 2, 45, 0, 0, 30);
  boat.driven = true;
  const hull = `${g.sailRule(2, 45, 0, 2, 44) !== null} ${g.sailRule(2, 45, 0, 1, 45) !== null} ${g.launchSpot('rowing_boat', 2, 44)} ${g.launchSpot('rowing_boat', 1, 45)}`;
  g.removeFurniture(boat.id);
  const theirHull = (island.get('hull') ?? '').replace(/\bt\b/g, 'true').replace(/\bf\b/g, 'false');
  say(hull === theirHull, `a hull is refused the water under the jetty and rows alongside it, and is launched beside it and not under it, on both sides: ${hull}${hull === theirHull ? '' : ` -- island ${theirHull}`}`);
}

/* ---- The ground under it, a crate on it, Examine, and the ground read --------------------------------- */

{
  /** Each: what, the action, its target on both sides, and where the one asking stands. */
  const LEFT: Array<[string, string, Target, string, [number, number]]> = [
    ['digging a corner of a tile on piers', 'dig', { kind: 'tile', x: 4, y: 44, cx: 4, cy: 45 } as Target, `jsonb_build_object('kind', 'tile', 'x', 4, 'y', 44, 'cx', 4, 'cy', 45)`, [4.5, 44.5]],
    ['flattening one on the bank', 'flatten', { kind: 'tile', x: 26, y: 58, cx: 27, cy: 58 } as Target, `jsonb_build_object('kind', 'tile', 'x', 26, 'y', 58, 'cx', 27, 'cy', 58)`, [26.5, 57.5]],
    ['packing one', 'pack', tile(6, 44), jt(6, 44), [5.5, 44.5]],
    ['cultivating one', 'cultivate', tile(6, 44), jt(6, 44), [5.5, 44.5]],
    ['paving one with cobblestone', 'pave_cobble', tile(6, 44), jt(6, 44), [5.5, 44.5]],
    ['laying stepping stones under the jetty', 'lay_stones', tile(3, 44), jt(3, 44), [4.5, 44.5]],
    ['planting a water lily under it', 'plant_lily', tile(3, 44), jt(3, 44), [4.5, 44.5]],
    ['planting a sprout under the bank house, from beside it', 'plant', tile(27, 58), jt(27, 58), [27.5, 57.5]],
    ['planting moss on the dirt under it', 'plant_moss', tile(28, 58), jt(28, 58), [28.5, 57.5]],
    ['planting grass on the dirt under it', 'plant_grass', tile(28, 58), jt(28, 58), [28.5, 57.5]],
    ['mining a face at one of its corners', 'mine', { kind: 'tile', x: 27, y: 59, cx: 27, cy: 59 } as Target, `jsonb_build_object('kind', 'tile', 'x', 27, 'y', 59, 'cx', 27, 'cy', 59)`, [27.5, 59.5]],
  ];
  const island = answers(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; v_spring bigint; v_why text; v_x int; v_crate bigint; v_ground jsonb;
begin
  ${ISLAND_SCENE}
  perform give(w, me, 'stone_brick', 2, 50);
  perform give(w, me, 'lily_root', 1, 50);
  perform give(w, me, 'sprout', 1, 50);
  perform give(w, me, 'moss', ${MOSS_PLANT}, 50);
  perform give(w, me, 'mixed_grass', ${GRASS_PLANT}, 50);
  perform give(w, me, 'dirt', 1, 50);
  -- Dirt under the bank house, and bare rock beside it.
  perform land_set_tile(w, 28, 58, ${TileType.Dirt});
  perform land_set_tile(w, 27, 59, ${TileType.Rock});
  perform perform_building(w, me, 'plan_building', ${jt(7, 44, { name: 'Jetty' })});
  for v_x in reverse 6..2 loop
    perform perform_building(w, me, 'add_to_building', ${jt(0, 44).replace("'x', 0", "'x', v_x").replace("'cx', 0", "'cx', v_x")});
  end loop;
  for v_x in 2..7 loop perform perform_building(w, me, 'plan_floor', ${jt(0, 44, { material: 'plank', floorKind: 'floor' }).replace("'x', 0", "'x', v_x").replace("'cx', 0", "'cx', v_x")}); end loop;
  ${finishSql(3, 7, 44)}
  perform perform_building(w, me, 'plan_building', ${jt(30, 58, { name: 'Bank house' })});
  perform perform_building(w, me, 'add_to_building', ${jt(29, 58)});
  perform perform_building(w, me, 'add_to_building', ${jt(28, 58)});
  perform perform_building(w, me, 'add_to_building', ${jt(27, 58)});
  perform perform_building(w, me, 'add_to_building', ${jt(26, 58)});
  ${LEFT.map(([, id, , target, [px, py]], i) => `update player set x = ${px}, y = ${py} where world_id = w and uid = me;
  insert into said values ('L${i}', coalesce(act_refusal(w, me, ${q(id)}, ${target}), 'OK'));`).join('\n  ')}
  -- Dirt dropped at your feet, standing on the jetty's deck.
  update player set x = 4.3, y = 44.3 where world_id = w and uid = me;
  insert into said values ('dropHere', coalesce(act_refusal(w, me, 'drop_dirt_here', jsonb_build_object('kind', 'item', 'uid',
    (select it.id from item it where it.world_id = w and it.holder = 'player' and it.holder_uid = me and it.def = 'dirt' limit 1))), 'OK'));
  -- A crate on the jetty's deck over the sea, and on its last deck, not built.
  v_crate := give(w, me, 'crate_plank', 1, 50);
  insert into said values ('crateDeck', coalesce(crate_refusal(w, me, 'place_crate', ${jt(4, 44, { sx: 1, sy: 1 }).replace(')', ", 'itemUid', v_crate)")}), 'OK'));
  insert into said values ('crateBare', coalesce(crate_refusal(w, me, 'place_crate', ${jt(2, 44, { sx: 1, sy: 1 }).replace(')', ", 'itemUid', v_crate)")}), 'OK'));
  insert into said values ('crateSea', coalesce(crate_refusal(w, me, 'place_crate', ${jt(4, 45, { sx: 1, sy: 1 }).replace(')', ", 'itemUid', v_crate)")}), 'OK'));
  -- Examine, on a deck built and on one not.
  insert into said values ('xBuilt', examine_tile_text(w, 4, 44, me));
  insert into said values ('xBare', examine_tile_text(w, 2, 44, me));
  insert into said values ('xBank', examine_tile_text(w, 27, 58, me));
  -- And the ground read, from the jetty.
  update player set x = 5.5, y = 44.5 where world_id = w and uid = me;
  v_ground := rpc_ground(w, 40, true);
  insert into said select 'read', string_agg(b->>'name' || ' ' || coalesce(b->>'deck', '-') || ' ' || coalesce((b->'piers')::text, '-'), '; ' order by b->>'name')
    from jsonb_array_elements(v_ground->'buildings'->'list') b where (b->>'name') in ('Jetty', 'Bank house', 'Hut');
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\\n~~\\n' order by k) from said;
rollback;`));
  const g = browserScene();
  g.inventory.add('stone_brick', { ql: 50, count: 2 });
  g.inventory.add('lily_root', { ql: 50 });
  g.inventory.add('sprout', { ql: 50, extra: 'Oak' });
  g.inventory.add('moss', { ql: 50, count: MOSS_PLANT });
  g.inventory.add('mixed_grass', { ql: 50, count: GRASS_PLANT });
  const dirt = g.inventory.add('dirt', { ql: 50 });
  g.world.setTile(28, 58, TileType.Dirt, 0);
  g.world.setTile(27, 59, TileType.Rock, 0);
  run(g, 'plan_building', tile(7, 44, { name: 'Jetty' }));
  for (let x = 6; x >= 2; x--) run(g, 'add_to_building', tile(x, 44));
  for (let x = 2; x <= 7; x++) run(g, 'plan_floor', tile(x, 44, { material: 'plank', floorKind: 'floor' }));
  finish(g, 3, 7, 44);
  run(g, 'plan_building', tile(30, 58, { name: 'Bank house' }));
  for (const x of [29, 28, 27, 26]) run(g, 'add_to_building', tile(x, 58));
  LEFT.forEach(([name, id, t, , [px, py]], i) => {
    g.player.x = px;
    g.player.y = py;
    const mine = ACTION_BY_ID.get(id)?.check?.(t, g) ?? 'OK';
    say(mine === island.get(`L${i}`), `${name}: "${mine}"${mine === island.get(`L${i}`) ? '' : ` -- island "${island.get(`L${i}`)}"`}`);
  });
  g.player.x = 4.3;
  g.player.y = 44.3;
  const dropHere = ACTION_BY_ID.get('drop_dirt_here')?.check?.({ kind: 'item', uid: dirt.uid } as Target, g) ?? 'OK';
  say(dropHere === island.get('dropHere') && dropHere !== 'OK',
    `dropping dirt at your feet, standing on the jetty's deck: "${dropHere}"${dropHere === island.get('dropHere') ? '' : ` -- island "${island.get('dropHere')}"`}`);
  const crateItem = g.inventory.add('crate_plank', { ql: 50 });
  const place = CRATE_ACTIONS.find((a) => a.id === 'place_crate')!;
  for (const [tag, x, y, what] of [['crateDeck', 4, 44, 'a crate on the jetty\'s deck over the sea'], ['crateBare', 2, 44, 'on its deck not built'], ['crateSea', 4, 45, 'and in the sea beside it']] as Array<[string, number, number, string]>) {
    const mine = place.check?.(tile(x, y, { sx: 1, sy: 1, itemUid: crateItem.uid }), g) ?? 'OK';
    say(mine === island.get(tag), `${what}: "${mine}"${mine === island.get(tag) ? '' : ` -- island "${island.get(tag)}"`}`);
  }
  const examine = (x: number, y: number): string => {
    ACTION_BY_ID.get('examine')!.perform(tile(x, y), g);
    const text = g.log[g.log.length - 1]?.text ?? '';
    return text.slice(text.indexOf(' It belongs to'));
  };
  for (const [tag, x, y, what] of [['xBuilt', 4, 44, 'Examine on the jetty\'s deck'], ['xBare', 2, 44, 'on its deck not built'], ['xBank', 27, 58, 'on the bank house, no deck planned']] as Array<[string, number, number, string]>) {
    const theirs = island.get(tag) ?? '';
    const tail = theirs.slice(theirs.indexOf(' It belongs to'));
    const mine = examine(x, y);
    say(mine === tail && mine.includes('piers'), `${what}:${mine}${mine === tail ? '' : ` -- island:${tail}`}`);
  }
  const jetty = g.buildings.buildingAt(7, 44)!;
  const bank = g.buildings.buildingAt(30, 58)!;
  const read = [bank, jetty].sort((a, b) => a.name.localeCompare(b.name))
    .map((b) => `${b.name} ${b.deck ?? '-'} ${b.piers ? JSON.stringify([...b.piers].sort((p, r) => Number(p.split(',')[1]) - Number(r.split(',')[1]) || Number(p.split(',')[0]) - Number(r.split(',')[0]))).replace(/","/g, '", "') : '-'}`).join('; ');
  say(read === island.get('read'), `the ground read sends each building's deck and its tiles on piers: ${read}${read === island.get('read') ? '' : ` -- island ${island.get('read')}`}`);
}

/* ---- Creatures: never onto a tile on piers, nor under one ---------------------------------------- */

{
  // Where a creature crate stood on the jetty's deck at (5, 44), its door to the east, has its middle: the browser's own reckoning.
  const crateAt = ((): [number, number] => {
    const gg = browserScene();
    return furnitureCentre(gg.addFurniture(CREATURE_CRATE, 5, 44, 1, 1, 30, [], undefined, 'e'));
  })();
  /*
   * The Bank house carried down the bank and the jetty out from the shore,
   * every deck built; a woola grazing on the bank house's last tile before it
   * is taken in, and a companion at heel with its keeper out on the jetty.
   */
  const TILES: Array<[number, number]> = [];
  for (let y = 56; y <= 60; y++) for (let x = 22; x <= 31; x++) TILES.push([x, y]);
  for (let y = 43; y <= 45; y++) for (let x = 0; x <= 9; x++) TILES.push([x, y]);
  /** Lines a creature might walk: across under the bank house, along beside it, and along the shore past the jetty's root. */
  const LINES: Array<[string, [number, number, number, number]]> = [
    ['across under the bank house', [27.5, 56.5, 27.5, 60.4]],
    ['along the bank beside it', [24.5, 57.3, 30.5, 57.3]],
    ['along the shore past the jetty\'s root', [8.5, 42.5, 8.5, 46.4]],
    ['out along the jetty', [9.5, 44.5, 3.5, 44.5]],
  ];
  const island = answers(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; v_spring bigint; v_x int; v_woola int; v_comp int; v_crated int;
begin
  ${ISLAND_SCENE}
  v_woola := creature_spawn(w, 'woola', 25.5, 58.5, 'wild', now() - interval '400 days', null);
  perform perform_building(w, me, 'plan_building', ${jt(30, 58, { name: 'Bank house' })});
  for v_x in reverse 29..25 loop
    perform perform_building(w, me, 'add_to_building', ${jt(0, 58).replace("'x', 0", "'x', v_x").replace("'cx', 0", "'cx', v_x")});
  end loop;
  insert into said select 'shoo', floor(from_x)::int || ',' || floor(from_y)::int || ' ' || floor(to_x)::int || ',' || floor(to_y)::int
    from creature where world_id = w and id = v_woola;
  perform perform_building(w, me, 'plan_building', ${jt(7, 44, { name: 'Jetty' })});
  for v_x in reverse 6..2 loop
    perform perform_building(w, me, 'add_to_building', ${jt(0, 44).replace("'x', 0", "'x', v_x").replace("'cx', 0", "'cx', v_x")});
  end loop;
  for v_x in 2..7 loop perform perform_building(w, me, 'plan_floor', ${jt(0, 44, { material: 'plank', floorKind: 'floor' }).replace("'x', 0", "'x', v_x").replace("'cx', 0", "'cx', v_x")}); end loop;
  for v_x in 25..30 loop perform perform_building(w, me, 'plan_floor', ${jt(0, 58, { material: 'plank', floorKind: 'floor' }).replace("'x', 0", "'x', v_x").replace("'cx', 0", "'cx', v_x")}); end loop;
  ${finishSql(2, 7, 44)}
  ${finishSql(25, 30, 58)}
  -- A woola in a crate standing on the jetty's deck, its door to the east, let out.
  v_crated := creature_spawn(w, 'woola', ${crateAt[0]}, ${crateAt[1]}, 'stored', now() - interval '400 days', me);
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, facing, creature)
    values (w, 'furniture', ${q(CREATURE_CRATE)}, 5, 44, 1, 1, ${crateAt[0]}, ${crateAt[1]}, 30, me, 'e', v_crated);
  perform crate_let_out(w, v_crated);
  insert into said select 'crate', floor(to_x)::int || ',' || floor(to_y)::int from creature where world_id = w and id = v_crated;
  insert into said select 'tiles', string_agg(v.x || ',' || v.y || '=' || creature_tile_ok(w, v.x, v.y), ' ' order by v.y, v.x)
    from (values ${TILES.map(([x, y]) => `(${x}, ${y})`).join(', ')}) v(x, y);
  ${LINES.map(([, [x0, y0, x1, y1]], i) => `insert into said values ('line${i}', line_clear(w, ${x0}, ${y0}, ${x1}, ${y1})::text);`).join('\n  ')}
  -- Its keeper out on the jetty: the companion keeps to the shore.
  update player set x = 4.5, y = 44.5, level = 0 where world_id = w and uid = me;
  v_comp := creature_spawn(w, 'woola', 8.5, 44.5, 'active', now() - interval '400 days', me);
  perform companion_settle(w, v_comp);
  insert into said select 'heelOn', floor(to_x)::int || ',' || floor(to_y)::int from creature where world_id = w and id = v_comp;
  -- And back on the shore, at heel again.
  update player set x = 9.5, y = 43.5 where world_id = w and uid = me;
  update creature set until = now() - interval '1 second' where world_id = w and id = v_comp;
  perform companion_settle(w, v_comp);
  insert into said select 'heelOff', floor(to_x)::int || ',' || floor(to_y)::int from creature where world_id = w and id = v_comp;
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\\n~~\\n' order by k) from said;
rollback;`));
  const g = browserScene();
  const woola = g.creatures.spawn('woola', 25.5, 58.5, 'wild');
  run(g, 'plan_building', tile(30, 58, { name: 'Bank house' }));
  for (let x = 29; x >= 25; x--) run(g, 'add_to_building', tile(x, 58));
  const shoo = `${Math.floor(woola.x)},${Math.floor(woola.y)} ${Math.floor(woola.x)},${Math.floor(woola.y)}`;
  say(shoo === island.get('shoo') && !g.buildings.onPiers(Math.floor(woola.x), Math.floor(woola.y)),
    `a woola grazing on a tile as it is taken onto piers is moved off it to the same tile on both sides: ${shoo.split(' ')[0]}${shoo === island.get('shoo') ? '' : ` -- island ${island.get('shoo')}`}`);
  run(g, 'plan_building', tile(7, 44, { name: 'Jetty' }));
  for (let x = 6; x >= 2; x--) run(g, 'add_to_building', tile(x, 44));
  for (let x = 2; x <= 7; x++) run(g, 'plan_floor', tile(x, 44, { material: 'plank', floorKind: 'floor' }));
  for (let x = 25; x <= 30; x++) run(g, 'plan_floor', tile(x, 58, { material: 'plank', floorKind: 'floor' }));
  finish(g, 2, 7, 44);
  finish(g, 25, 30, 58);
  const crate = g.addFurniture(CREATURE_CRATE, 5, 44, 1, 1, 30, [], undefined, 'e');
  const crated = g.creatures.spawn('woola', crateAt[0], crateAt[1], 'wild');
  shutIn(g, crated, crate);
  letOut(g, crated);
  const out = `${Math.floor(crated.x)},${Math.floor(crated.y)}`;
  say(out === island.get('crate') && !g.buildings.onPiers(Math.floor(crated.x), Math.floor(crated.y)),
    `a woola let out of a crate standing on the jetty's deck is put down off it, on the same tile on both sides: ${out}${out === island.get('crate') ? '' : ` -- island ${island.get('crate')}`}`);
  const tiles = [...TILES].sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([x, y]) => `${x},${y}=${g.creatures.tileOk(g, x, y)}`).join(' ');
  const theirTiles = island.get('tiles') ?? '';
  const refused = TILES.filter(([x, y]) => g.buildings.onPiers(x, y));
  say(tiles === theirTiles && refused.every(([x, y]) => !g.creatures.tileOk(g, x, y)),
    `a creature is refused every one of the ${refused.length} tiles on piers, built or not, and the ${TILES.length - refused.length} round them are what they were, the same on both sides${tiles === theirTiles ? '' : ` -- browser ${tiles} | island ${theirTiles}`}`);
  LINES.forEach(([name, [x0, y0, x1, y1]], i) => {
    // The island's walk of a line: every tile it crosses, sampled at twice a tile (`line_clear`).
    const n = Math.max(1, Math.ceil(2 * Math.hypot(x1 - x0, y1 - y0)));
    let clear = true;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (!g.creatures.tileOk(g, Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t))) clear = false;
    }
    const theirs = (island.get(`line${i}`) ?? '').replace(/^t$/, 'true').replace(/^f$/, 'false');
    say(String(clear) === theirs, `a creature's walk ${name}: ${clear ? 'open' : 'refused'} on both sides${String(clear) === theirs ? '' : ` -- island ${theirs}`}`);
  });
  // A companion at heel, its keeper out on the jetty: it does not follow onto the deck, and does not catch up onto it from afar.
  g.player.x = 4.5;
  g.player.y = 44.5;
  const comp = g.creatures.spawn('woola', 8.5, 44.5, 'active');
  const heel = g.creatures as unknown as { updateActive(c: typeof comp, dt: number, game: Game): void };
  for (let k = 0; k < 40; k++) heel.updateActive(comp, 0.1, g);
  const on = `${Math.floor(comp.x)},${Math.floor(comp.y)}`;
  say(on === island.get('heelOn') && !g.buildings.onPiers(Math.floor(comp.x), Math.floor(comp.y)),
    `a companion whose keeper walks out onto the jetty waits on the shore, on both sides: at ${on}${on === island.get('heelOn') ? '' : ` -- island ${island.get('heelOn')}`}`);
  const far = g.creatures.spawn('woola', 30.5, 44.5, 'active');
  heel.updateActive(far, 0.1, g);
  say(Math.floor(far.x) === 30 && !g.buildings.onPiers(Math.floor(far.x), Math.floor(far.y)),
    `and one twenty-six tiles off does not catch up onto the deck: it stays at ${Math.floor(far.x)},${Math.floor(far.y)} until its keeper comes off`);
  say(island.get('heelOff') === '9,43', `back on the shore, its keeper has it at heel again on the island: ${island.get('heelOff')}`);
}

/* ---- Bridges: a finished deck is landed on as a bank is, at the deck ------------------------------- */

{
  /*
   * A gully cut down through the north of the scene, rows 31 to 36: banks
   * level at 40 either side, its sides falling to 10 and its bed to -10,
   * under the sea. On its slopes: a deck at 40 over each side of row 34
   * ("West deck", "East deck"), one on the west side of row 36 carried out
   * over the water ("Landing"), and one on the east side of row 32 ("Perch").
   */
  const gully = (x: number): number => (x <= 27 ? 40 : x === 28 || x === 30 ? 10 : x === 29 ? -10 : 40);
  const ROWS = [31, 32, 33, 34, 35, 36, 37];
  const cornerSql = ROWS.flatMap((y) => [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33].map((x) => `(${x}, ${y}, ${gully(x)})`)).join(', ');
  const tileSql = ROWS.slice(0, -1).flatMap((y) => [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].map((x) => `(${x}, ${y}, ${x >= 28 && x <= 29 ? TileType.Sand : TileType.Grass})`)).join(', ');
  const BRIDGES: Array<[string, [number, number, number, number]]> = [
    ['between the two decks over the gully', [27, 34, 30, 34]],
    ['from the deck over the water to the east bank', [28, 36, 31, 36]],
    ['from the deck on the east slope to the west bank', [30, 32, 26, 32]],
  ];
  const BUILT = [[27, 34], [30, 34], [27, 36], [28, 36], [30, 32]];
  const island = answers(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; v_spring bigint; v_why text; v_br bigint;
begin
  ${ISLAND_SCENE}
  perform land_set_height(w, v.x, v.y, v.h) from (values ${cornerSql}) v(x, y, h);
  perform land_set_tile(w, v.x, v.y, v.t) from (values ${tileSql}) v(x, y, t);
  perform perform_building(w, me, 'plan_building', ${jt(27, 34, { name: 'West deck' })});
  perform perform_building(w, me, 'plan_building', ${jt(30, 34, { name: 'East deck' })});
  perform perform_building(w, me, 'plan_building', ${jt(27, 36, { name: 'Landing' })});
  perform perform_building(w, me, 'add_to_building', ${jt(28, 36)});
  perform perform_building(w, me, 'plan_building', ${jt(30, 32, { name: 'Perch' })});
  ${BUILT.map(([x, y]) => `perform perform_building(w, me, 'plan_floor', ${jt(x, y, { material: 'plank', floorKind: 'floor' })});`).join('\n  ')}
  insert into said select 'decks', string_agg(b.name || ' ' || coalesce(b.deck::text, '-'), ', ' order by b.name)
    from building b where b.world_id = w and b.name in ('West deck', 'East deck', 'Landing', 'Perch');
  insert into said values ('unbuilt', coalesce(bridge_reason(w, me, 'wood', 27, 34, 30, 34), 'ALLOWED'));
  ${BUILT.map(([x, y]) => finishSql(x, x, y)).join('\n  ')}
  ${BRIDGES.map(([, [ax, ay, bx, by]], i) => `insert into said values ('B${i}', coalesce(bridge_reason(w, me, 'wood', ${ax}, ${ay}, ${bx}, ${by}), 'ALLOWED')
    || ' ' || deck_height(w, ${ax}, ${ay}) || ' ' || deck_height(w, ${bx}, ${by}));`).join('\n  ')}
  -- The first of them thrown and built: walked onto from the deck, and the deck under its end not to be taken up.
  insert into bridge (world_id, kind, ax, ay, bx, by, height, made_by, level) values (w, 'wood', 27, 34, 30, 34, 40, me, 0) returning id into v_br;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total) values
    (w, v_br, 0, 28, 34, '{"plank": 0}', '{"plank": 10}'), (w, v_br, 1, 29, 34, '{"plank": 0}', '{"plank": 10}');
  update player set x = 27.5, y = 34.5, level = 0 where world_id = w and uid = me;
  insert into said values ('walkOn', (walk_share(w, me, 0, 27.5, 34.5, 28.5, 34.5) >= 1)::text);
  update player set x = 29.5, y = 34.5 where world_id = w and uid = me;
  insert into said values ('walkOff', (walk_share(w, me, 0, 29.5, 34.5, 30.5, 34.5) >= 1)::text);
  update player set x = 25.5, y = 34.5 where world_id = w and uid = me;
  insert into said values ('upUnder', coalesce(build_refusal(w, me, 'remove_floor', ${jt(27, 34)}), 'OK'));
  -- And a bridge thrown from slope to slope across row 35: its end is not then taken onto piers.
  insert into bridge (world_id, kind, ax, ay, bx, by, height, made_by, level) values (w, 'wood', 27, 35, 30, 35, 25, me, 0) returning id into v_br;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total) values
    (w, v_br, 0, 28, 35, '{"plank": 0}', '{"plank": 10}'), (w, v_br, 1, 29, 35, '{"plank": 0}', '{"plank": 10}');
  insert into said values ('endPlan', coalesce(build_refusal(w, me, 'plan_building', ${jt(27, 35, { name: 'End' })}), 'OK'));
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\\n~~\\n' order by k) from said;
rollback;`));
  const g = browserScene();
  for (const y of ROWS) for (let x = 22; x <= 33; x++) g.world.setHeight(x, y, gully(x));
  for (const y of ROWS.slice(0, -1)) for (let x = 22; x <= 32; x++) g.world.setTile(x, y, x >= 28 && x <= 29 ? TileType.Sand : TileType.Grass, 0);
  run(g, 'plan_building', tile(27, 34, { name: 'West deck' }));
  run(g, 'plan_building', tile(30, 34, { name: 'East deck' }));
  run(g, 'plan_building', tile(27, 36, { name: 'Landing' }));
  run(g, 'add_to_building', tile(28, 36));
  run(g, 'plan_building', tile(30, 32, { name: 'Perch' }));
  for (const [x, y] of BUILT) run(g, 'plan_floor', tile(x, y, { material: 'plank', floorKind: 'floor' }));
  const decks = [...g.buildings.list.values()].filter((b) => ['West deck', 'East deck', 'Landing', 'Perch'].includes(b.name))
    .sort((a, b) => a.name.localeCompare(b.name)).map((b) => `${b.name} ${b.deck ?? '-'}`).join(', ');
  say(decks === island.get('decks'), `four buildings on piers over the gully, on the same decks on both sides: ${decks}${decks === island.get('decks') ? '' : ` -- island ${island.get('decks')}`}`);
  const unbuilt = g.bridgeReason('wood', 27, 34, 30, 34) ?? 'ALLOWED';
  say(unbuilt === island.get('unbuilt'), `a bridge between two decks not yet built: "${unbuilt}"${unbuilt === island.get('unbuilt') ? '' : ` -- island "${island.get('unbuilt')}"`}`);
  for (const [x, y] of BUILT) finish(g, x, x, y);
  BRIDGES.forEach(([name, [ax, ay, bx, by]], i) => {
    const mine = `${g.bridgeReason('wood', ax, ay, bx, by) ?? 'ALLOWED'} ${g.topDeck(ax, ay).height} ${g.topDeck(bx, by).height}`;
    const theirs = island.get(`B${i}`) ?? '';
    say(mine === theirs, `a bridge ${name}, built: ${mine.replace(/ (\S+) (\S+)$/, ', its ends at $1 and $2')}${mine === theirs ? '' : ` -- island ${theirs}`}`);
  });
  const br = g.addBridge('wood', 27, 34, 30, 34, 40);
  for (const s of br.spans) for (const k of Object.keys(s.needed)) s.needed[k] = 0;
  const walkOn = String(g.stepRule(27, 34, 0, 28, 34) !== null);
  const walkOff = String(g.stepRule(29, 34, 0, 30, 34) !== null);
  say(walkOn === island.get('walkOn') && walkOff === island.get('walkOff'),
    `off the deck onto the bridge, and off the bridge onto the deck at its far end: ${walkOn}, ${walkOff} on both sides${walkOn === island.get('walkOn') && walkOff === island.get('walkOff') ? '' : ` -- island ${island.get('walkOn')}, ${island.get('walkOff')}`}`);
  g.player.x = 25.5;
  g.player.y = 34.5;
  const upUnder = build('remove_floor').check?.(tile(27, 34), g) ?? 'OK';
  say(upUnder === island.get('upUnder'), `taking up the deck the bridge lands on: "${upUnder}"${upUnder === island.get('upUnder') ? '' : ` -- island "${island.get('upUnder')}"`}`);
  const end = g.addBridge('wood', 27, 35, 30, 35, 25);
  for (const s of end.spans) for (const k of Object.keys(s.needed)) s.needed[k] = 0;
  const endPlan = build('plan_building').check?.(tile(27, 35, { name: 'End' }), g) ?? 'OK';
  say(endPlan === island.get('endPlan'), `taking the end of a bridge onto piers: "${endPlan}"${endPlan === island.get('endPlan') ? '' : ` -- island "${island.get('endPlan')}"`}`);
}

/* ---- What a deck carries, who stands on one, and the water under one ------------------------------- */

{
  /*
   * The Bank house down the bank with stone brick decks at its top two tiles
   * and a stone brick wall on one; the jetty with plank decks. Then: walls
   * and decks planned that the decks under them would or would not carry;
   * a tile taken onto piers with a cart on it, with the planner on it and
   * with somebody else on it; a deck taken up with somebody on it; and
   * Examine on the jetty once the water stands close under its deck.
   */
  const HEFT: Array<[string, string, Target, string]> = [
    ['a stone brick wall on the bank house, on its stone brick decks', 'plan_wall', tile(30, 58, { side: 'e', wallType: 'solid', material: 'stone_brick' }), jt(30, 58, { side: 'e', wallType: 'solid', material: 'stone_brick' })],
    ['then a plank deck under it', 'plan_floor', tile(28, 58, { material: 'plank', floorKind: 'floor' }), jt(28, 58, { material: 'plank', floorKind: 'floor' })],
    ['a stone brick one instead', 'plan_floor', tile(28, 58, { material: 'stone_brick', floorKind: 'floor' }), jt(28, 58, { material: 'stone_brick', floorKind: 'floor' })],
    ['a stone brick wall on the jetty\'s plank deck', 'plan_wall', tile(7, 44, { side: 'n', wallType: 'solid', material: 'stone_brick' }), jt(7, 44, { side: 'n', wallType: 'solid', material: 'stone_brick' })],
    ['a slate wall on it', 'plan_wall', tile(6, 44, { side: 'n', wallType: 'solid', material: 'slate' }), jt(6, 44, { side: 'n', wallType: 'solid', material: 'slate' })],
    ['a plank wall on it', 'plan_wall', tile(7, 44, { side: 'n', wallType: 'solid', material: 'plank' }), jt(7, 44, { side: 'n', wallType: 'solid', material: 'plank' })],
  ];
  const island = answers(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; v_spring bigint; v_why text; v_x int; v_other uuid; v_cart bigint;
begin
  ${ISLAND_SCENE}
  select uid into v_other from player where world_id = w and name = 'Crowd5';
  perform perform_building(w, me, 'plan_building', ${jt(30, 58, { name: 'Bank house' })});
  for v_x in reverse 29..27 loop
    perform perform_building(w, me, 'add_to_building', ${jt(0, 58).replace("'x', 0", "'x', v_x").replace("'cx', 0", "'cx', v_x")});
  end loop;
  perform perform_building(w, me, 'plan_floor', ${jt(30, 58, { material: 'stone_brick', floorKind: 'floor' })});
  perform perform_building(w, me, 'plan_floor', ${jt(29, 58, { material: 'stone_brick', floorKind: 'floor' })});
  ${finishSql(29, 30, 58)}
  perform perform_building(w, me, 'plan_building', ${jt(7, 44, { name: 'Jetty' })});
  for v_x in reverse 6..2 loop
    perform perform_building(w, me, 'add_to_building', ${jt(0, 44).replace("'x', 0", "'x', v_x").replace("'cx', 0", "'cx', v_x")});
  end loop;
  for v_x in 2..7 loop perform perform_building(w, me, 'plan_floor', ${jt(0, 44, { material: 'plank', floorKind: 'floor' }).replace("'x', 0", "'x', v_x").replace("'cx', 0", "'cx', v_x")}); end loop;
  ${finishSql(2, 7, 44)}
  ${HEFT.map(([, id, , target], i) => runSql(`H${i}`, id, target)).join('\n')}
  -- A deck in every material for the bank house's tile at 27, which has none yet: what its walls of stone will let it be.
  insert into said select 'menu', string_agg(m.id || '=' || coalesce(build_refusal(w, me, 'plan_floor',
      jsonb_build_object('kind', 'tile', 'x', 27, 'y', 58, 'cx', 27, 'cy', 58, 'material', m.id, 'floorKind', 'floor')), 'OK'), '|' order by m.id)
    from build_material_def m where m.id in (${FLOORED});
  -- People and things on a tile taken onto piers: a cart on one, the planner on another, Crowd5 on a third.
  insert into placed (world_id, kind, sub, x, y, cx, cy, ql, made_by)
    values (w, 'furniture', 'large_cart', 26, 57, 26.5, 57.5, 30, me) returning id into v_cart;
  insert into said values ('cart', coalesce(build_refusal(w, me, 'plan_building', ${jt(26, 57, { name: 'Shed' })}), 'OK'));
  update player set x = 27.5, y = 57.5, level = 0 where world_id = w and uid = me;
  insert into said values ('me', coalesce(build_refusal(w, me, 'plan_building', ${jt(27, 57, { name: 'Shed' })}), 'OK'));
  update player set x = 28.5, y = 57.5, level = 0 where world_id = w and uid = v_other;
  insert into said values ('other', coalesce(build_refusal(w, me, 'plan_building', ${jt(28, 57, { name: 'Shed' })}), 'OK'));
  -- Crowd5 out on the jetty while its deck is taken up.
  update player set x = 9.5, y = 44.5 where world_id = w and uid = me;
  update player set x = 5.5, y = 44.5, level = 0 where world_id = w and uid = v_other;
  insert into said values ('upOther', coalesce(build_refusal(w, me, 'remove_floor', ${jt(5, 44)}), 'OK'));
  -- And the jetty's deck let down to 3, the sea at 0 standing within ${PIER_CLEAR} of it.
  update building set deck = 3 where world_id = w and id = building_at(w, 7, 44);
  insert into said values ('risen', pier_says(w, 4, 44));
  update building set deck = 0 where world_id = w and id = building_at(w, 7, 44);
  insert into said values ('over', pier_says(w, 4, 44));
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\\n~~\\n' order by k) from said;
rollback;`));
  const g = browserScene();
  run(g, 'plan_building', tile(30, 58, { name: 'Bank house' }));
  for (let x = 29; x >= 27; x--) run(g, 'add_to_building', tile(x, 58));
  run(g, 'plan_floor', tile(30, 58, { material: 'stone_brick', floorKind: 'floor' }));
  run(g, 'plan_floor', tile(29, 58, { material: 'stone_brick', floorKind: 'floor' }));
  finish(g, 29, 30, 58);
  run(g, 'plan_building', tile(7, 44, { name: 'Jetty' }));
  for (let x = 6; x >= 2; x--) run(g, 'add_to_building', tile(x, 44));
  for (let x = 2; x <= 7; x++) run(g, 'plan_floor', tile(x, 44, { material: 'plank', floorKind: 'floor' }));
  finish(g, 2, 7, 44);
  HEFT.forEach(([name, id, t], i) => {
    const mine = run(g, id, t);
    const theirs = island.get(`H${i}`) ?? '';
    say(mine === theirs, `${name}: "${mine}"${mine === theirs ? '' : ` -- island "${theirs}"`}`);
  });
  /*
   * And the menu a player opens on the bank house's tile at 27, which has no
   * deck: every material listed, each refused or offered by its own check,
   * and the refusals the island's -- so a house with a stone wall is offered
   * its stone decks rather than a dead end.
   */
  const entries = (UI.prototype as unknown as { buildingEntries(this: unknown, pick: unknown): MenuItem[] }).buildingEntries
    .call({ game: g, startPlacingStairs() {} }, { x: 27, y: 58, cx: 27, cy: 58, wx: 27.5, wy: 58.5 });
  const planDeck = entries.find((e) => e.label === 'Plan deck');
  const byName = new Map(MATERIALS.map((m) => [m.name, m.id]));
  const offered = (planDeck?.children ?? []).map((c) => `${byName.get(c.label)}=${c.disabled ? c.hint : 'OK'}`).sort().join('|');
  const stoneOffered = (planDeck?.children ?? []).some((c) => c.label === 'Stone brick' && !c.disabled && !!c.onSelect);
  say(offered === island.get('menu') && planDeck?.children?.length === MATERIALS.length && stoneOffered,
    `the menu on a tile of the bank house with no deck lists all ${planDeck?.children?.length ?? 0} materials, offers stone brick and refuses plank in the island's words: ${planDeck?.children?.filter((c) => !c.disabled).map((c) => c.label).join(', ') ?? 'none'} offered${offered === island.get('menu') ? '' : ` -- menu ${offered} | island ${island.get('menu')}`}`);
  const cart = g.addFurniture('large_cart', 26, 57, 0, 0, 30);
  const cartSaid = build('plan_building').check?.(tile(26, 57, { name: 'Shed' }), g) ?? 'OK';
  g.removeFurniture(cart.id);
  g.player.x = 27.5;
  g.player.y = 57.5;
  const meSaid = build('plan_building').check?.(tile(27, 57, { name: 'Shed' }), g) ?? 'OK';
  g.roster.saw({ id: 7, name: 'Crowd5', x: 28.5, y: 57.5, dirX: 0, dirY: 1, level: 0, moving: false, swimming: false, working: false });
  const otherSaid = build('plan_building').check?.(tile(28, 57, { name: 'Shed' }), g) ?? 'OK';
  g.player.x = 9.5;
  g.player.y = 44.5;
  g.roster.saw({ id: 7, name: 'Crowd5', x: 5.5, y: 44.5, dirX: 0, dirY: 1, level: 0, moving: false, swimming: false, working: false });
  const upOther = build('remove_floor').check?.(tile(5, 44), g) ?? 'OK';
  for (const [tag, mine, what] of [
    ['cart', cartSaid, 'a tile taken onto piers with a cart standing on it'],
    ['me', meSaid, 'with the planner standing on it'],
    ['other', otherSaid, 'with somebody else standing on it'],
    ['upOther', upOther, 'a deck taken up with somebody else standing on it'],
  ] as Array<[string, string, string]>) {
    say(mine === island.get(tag), `${what}: "${mine}"${mine === island.get(tag) ? '' : ` -- island "${island.get(tag)}"`}`);
  }
  const jetty = g.buildings.buildingAt(7, 44)!;
  jetty.deck = 3;
  const risen = g.pierSays(4, 44);
  jetty.deck = 0;
  const over = g.pierSays(4, 44);
  say(risen === island.get('risen') && risen.includes('risen'), `Examine on the jetty, its deck let down to within ${metres(PIER_CLEAR)} m of the sea:${risen}${risen === island.get('risen') ? '' : ` -- island:${island.get('risen')}`}`);
  say(over === island.get('over'), `and let down to the sea itself:${over}${over === island.get('over') ? '' : ` -- island:${island.get('over')}`}`);
}

/* ---- The numbers ---------------------------------------------------------------------------------------- */

{
  const theirs = psql('select pier_drop() || \' \' || pier_water() || \' \' || pier_clear() || \' \' || pier_wall_drop() || \' \' || pier_shoo()');
  const mine = `${PIER_DROP} ${PIER_WATER} ${PIER_CLEAR} ${PIER_WALL_DROP} ${PIER_SHOO}`;
  say(theirs === mine, `the island has the browser's numbers: a pier spans ${PIER_DROP / 10} m, stands in ${PIER_WATER / 10} m of water, a deck clears it by ${PIER_CLEAR / 10} m, ${PIER_WALL_DROP / 10} m of drop costs a wall, and a creature is moved ${PIER_SHOO} tiles off at most${theirs === mine ? '' : ` -- island ${theirs}`}`);
  say(isDone({ needed: {}, total: {} } as never), 'and a bill with nothing left on it is done');
}

console.log(bad === 0 ? `a building on piers is the same building on both sides (${good} agreements)` : `THEY DISAGREE (${bad} of ${good + bad})`);
process.exit(bad === 0 ? 0 : 1);
