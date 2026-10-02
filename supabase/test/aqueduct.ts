/**
 * Aqueducts, on both sides.
 *
 * Asked for: an aqueduct -- a stone bridge whose deck is a water channel --
 * built from a pond or a pool to a basin no higher than it (a pool, a pond
 * hollow, a fountain), which once finished carries water along its channel
 * and fills the basin at a stated rate, what it carries leaving the source,
 * and a full basin spilling on as pools do.
 *
 * Measured here:
 *
 *   * the numbers: the channel's flow (`AQUEDUCT_LPS`, `AQUEDUCT_FLOW`), the
 *     litres over a corner, a fountain's rim and the aqueduct's bridge
 *     definition, the same on both sides;
 *   * the water: `settle_chain` running from a corner against `settleChain`
 *     with `run`, and `settle_water` against `settleWater` over one scene --
 *     a spring on a plateau, its pond spilling over a cliff into a valley and
 *     a catch pond there, and an aqueduct from the pond across the valley --
 *     with the aqueduct pouring into a hollow, a pool, a fountain, with its
 *     channel over its head's water, unfinished, and with the hollow filled
 *     in: corner for corner the same;
 *   * setting one out: twenty-two heads and feet asked on both sides, every
 *     refusal and every plan in the same words;
 *   * the doors: set out, built span by span and finished on both sides, the
 *     water leaving the source (the catch pond goes dry) and filling the
 *     hollow at the channel's flow, the finished line word for word; a
 *     fountain kept full at the channel's rate on top of its own; the spring
 *     stopped (the source runs low) and the channel dry; the hollow filled in
 *     (the target lost) and the water running away from its foot; pulled
 *     down for half its bill, and the catch pond full again;
 *   * its piers: a pool at its foot goes over an edge other than the one its
 *     end pier stands on, and with that pool filled in the water lands on the
 *     slab and goes off it at a corner of its edge, on both sides;
 *   * under it: a cliff under its arches as steep as without it, its piers in
 *     the way along its run and its arches open across it, and nothing
 *     planted, planned or dug under a span, on both sides in the same words;
 *   * set out over a tree, over a pool standing too high, from water
 *     another aqueduct takes, and where one runs already: refused alike;
 *   * a spring dug in the pool at its head, and one finished into a spring's
 *     pond standing full: said alike; its stone greening from the day it is
 *     finished;
 *   * nobody walks it: no step goes onto its deck in the browser, and out of
 *     your depth under one on the island, you swim.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTIONS, type ActionDef, type Target } from '../../src/game/actions';
import { BRIDGES } from '../../src/game/bridges';
import { WELL_HOLDS } from '../../src/game/furniture';
import { TileType } from '../../src/world/tiles';
import { NOTHING_YET } from '../../src/game/greening';
import { AQ_OVER, AQUEDUCT, aqueductPlan, fillWords, footSays } from '../../src/game/aqueducts';
import { pondFull, RUN_RATE, settleChain, springCorner, type Chain, type Slab } from '../../src/world/springs';
import {
  AQUEDUCT_FLOW, AQUEDUCT_LPS, aqueductShut, CHANNEL_DEEP, CHANNEL_WIDE, CORNER_LITRES, FOUNTAIN_RIM, fillSeconds, pondRate, settleWater,
  type AqueductLine, type Channel,
} from '../../src/world/aqueducts';

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
/** A chain as JSON with its keys in one order, so two can be compared as text. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
const answer = (c: Chain | string): unknown => (typeof c === 'string' ? { refused: c } : c);
/** The lines `said` holds, by key. */
const lines = (out: string): Map<string, string> =>
  new Map(out.split('\n~~\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)] as [string, string]));

/* ---- The scene -------------------------------------------------------------------------------- */

/*
 * On the Hoarding island (64 across, 30 high everywhere). West: a plateau at
 * 150 with a bowl at (13, 40) whose rim opens east at (16, 40), 138, over a
 * cliff. East of it a valley at 52 along y 40, falling 2 a corner south from
 * y 36 to a bay of the sea, with a catch hollow at (19, 46) the spring's
 * stream fills on its way down, and a hollow at (24, 40) for the aqueduct to
 * fill: its floor 40, its rim 46. East of x 30 the island's own flat, with
 * pools poured on it, a pit dug under the sea's level at (40, 32), a basin
 * too wide for any pond east of x 44, and a pool in the valley at (28, 46).
 */
const BOWL: [number, number] = [13, 40];
const HEAD: [number, number] = [15, 40];
const FOOT: [number, number] = [24, 40];
const CATCH: [number, number] = [19, 46];
function height(x: number, y: number): number {
  if (x >= 6 && x <= 30 && y >= 30) {
    // The valley runs out into a bay of the sea at its south end.
    if (y >= 60) return -5;
    if (x <= 16) {
      if (x >= 12 && x <= 14 && y >= 39 && y <= 41) return x === 13 && y === 40 ? 120 : 135;
      if (x === 15 && y === 40) return 136;
      if (x === 16 && y === 40) return 138;
      return 150;
    }
    if (x >= 18 && x <= 20 && y >= 45 && y <= 47) return 20;
    if (x >= 23 && x <= 25 && y >= 39 && y <= 41) return x === 24 && y === 40 ? 40 : 46;
    return 60 - Math.max(0, y - 36) * 2;
  }
  if (x >= 39 && x <= 41 && y >= 31 && y <= 33) return -5;
  // A basin in the east wider than any pond: more corners at its floor than a spring's water ever fills.
  if (x >= 44 && y >= 34 && y <= 63) return 25;
  return 30;
}
const hAt = (x: number, y: number): number | null => (x < 0 || y < 0 || x > 64 || y > 64 ? null : height(x, y));
/** The valley's own fall, where nothing is dug in it. */
const valley = (y: number): number => 60 - Math.max(0, y - 36) * 2;
/** The slabs poured on it: top, and whether a pool is dug in it. */
const SLABS: Array<[number, number, number, boolean]> = [
  [35, 40, 70, true], [35, 44, 50, true], [36, 44, 50, true], [37, 44, 50, true], [35, 48, 90, true], [40, 38, 70, true],
  [35, 36, 40, false], [28, 46, 60, true], [43, 50, 70, true],
];
const cornerRows: string[] = [];
for (let y = 0; y <= 64; y++) for (let x = 0; x <= 64; x++) cornerRows.push(`(${x}, ${y}, ${height(x, y)})`);
const slabRows = SLABS.map(([x, y, top, pool], i) => `(w, ${9000 + i}, ${x}, ${y}, ${top}, '{"concrete":0}', '{"concrete":1}', ${pool})`);

/** The scene laid on the island, in the transaction the caller has open; `me` somebody holding a trowel, near the foot. */
const ISLAND_SCENE = `
  select id into w from world where name = 'Hoarding';
  select uid into me from player where world_id = w and name = 'Crowd5';
  select uid into them from player where world_id = w and name = 'Crowd6';
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  delete from spring where world_id = w;
  delete from bridge_span where world_id = w;
  delete from bridge where world_id = w;
  delete from placed where world_id = w;
  delete from foundation where world_id = w;
  delete from deed where world_id = w;
  delete from building_tile where world_id = w;
  perform land_set_height(w, v.x, v.y, v.h) from (values ${cornerRows.join(', ')}) v(x, y, h);
  -- No trees or bushes on it, on either side: the browser's island grew its own.
  perform land_set_tile(w, x, y, 0) from generate_series(0, 63) x, generate_series(0, 63) y where land_tile(w, x, y) in (16, 17);
  insert into foundation (world_id, id, x, y, top, needed, total, pool) values ${slabRows.join(', ')};
  update player set x = 22.5, y = 40.5, level = 0, act = null, act_queue = '[]'::jsonb, aboard = null where world_id = w and uid in (me, them);
  delete from item where world_id = w and holder = 'player' and holder_uid = me;
  insert into item (world_id, def, holder, holder_uid, ql, count) values (w, 'trowel', 'player', me, 40, 1), (w, 'shovel', 'player', me, 40, 1);
`;

/** The same scene in a browser's game of its own, the same somebody near the foot with the same tools. */
function browserScene(): Game {
  const g = Game.create(31337, 64);
  const w = g.world;
  for (let y = 0; y <= 64; y++) for (let x = 0; x <= 64; x++) w.setHeight(x, y, height(x, y));
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (w.getTile(x, y) === TileType.Tree || w.getTile(x, y) === TileType.Bush) w.setTile(x, y, TileType.Grass);
  for (const [x, y, top, pool] of SLABS) {
    const f = g.addFoundation(x, y, top, 0);
    if (pool) f.pool = true;
  }
  g.springs.lay();
  g.neighbourDeeds = [];
  for (const it of [...g.inventory.items]) g.inventory.remove(it.uid, it.count);
  g.inventory.add('trowel', { ql: 40 });
  g.inventory.add('shovel', { ql: 40 });
  g.player.x = 22.5;
  g.player.y = 40.5;
  g.update(0.01);
  return g;
}
const act = (id: string): ActionDef => ACTIONS.find((a) => a.id === id) as ActionDef;
const tile = (x: number, y: number, extra: Partial<Extract<Target, { kind: 'tile' }>> = {}): Target => ({ kind: 'tile', x, y, cx: x, cy: y, ...extra });


/** A chain as the island keeps it, without when each pond rose (which only the island's clock says), as canonical text. */
function stripFill(c: { ponds: Array<Record<string, unknown>> } & Record<string, unknown>): string {
  return viaOne(canon({ ...c, ponds: c.ponds.map(({ from: _f, since: _s, ...p }) => p) }));
}
/** Every aqueduct named as the first, since the two sides number their bridges each their own way. */
const viaOne = (text: string): string => text.replace(/"via":\d+/g, '"via":1');
/** What a span wants, written out as the island's `span_wants` does it. */
function spanWantsOf(needed: Record<string, number>): string {
  return Object.keys(needed).sort().filter((k) => needed[k] > 0).map((k) => `${needed[k]} ${k === 'stone_brick' ? 'stone brick' : k === 'stone_slab' ? 'stone slab' : k}`).join(', ');
}

/* ---- The numbers ------------------------------------------------------------------------------ */

{
  const [lps, flow, litres, rim, deep, def] = psql(`select aqueduct_lps() || '|' || aqueduct_flow() || '|' || corner_litres() || '|' || fountain_rim()
      || '|' || channel_deep() || '|' || (select d.span || ',' || d.tool || ',' || d.skill || ',' || d.difficulty || ',' || d.carts
      || ',' || (select string_agg(b.item || ':' || b.count, ' ' order by b.item) from bridge_bill b where b.kind = d.id)
      from bridge_def d where d.id = 'aqueduct')`).split('|');
  const mine = `${AQUEDUCT.span},${AQUEDUCT.tool},${AQUEDUCT.skill},${AQUEDUCT.difficulty},${AQUEDUCT.carts},${AQUEDUCT.bill.map(([i, n]) => `${i}:${n}`).join(' ')}`;
  say(Number(lps) === AQUEDUCT_LPS && Number(flow) === AQUEDUCT_FLOW && Number(litres) === CORNER_LITRES && Number(rim) === FOUNTAIN_RIM
      && Number(deep) === CHANNEL_DEEP && def === mine,
    `the numbers agree: a channel ${CHANNEL_WIDE * 4} m wide and ${CHANNEL_DEEP / 10} m deep carries ${AQUEDUCT_LPS} litres a second, ${AQUEDUCT_FLOW} a minute; `
    + `${CORNER_LITRES} litres a unit over a corner; a fountain's rim ${FOUNTAIN_RIM}; an aqueduct spans ${def}`);
  const stone = new Map(BRIDGES.stone.bill);
  say(AQUEDUCT.span === BRIDGES.stone.span && AQUEDUCT.bill.every(([id, n]) => n >= (stone.get(id) ?? 0)),
    `an aqueduct is a stone arch's span (${BRIDGES.stone.span}) at a stone arch's bill and its channel's lining: ${AQUEDUCT.bill.map(([i, n]) => `${n} ${i}`).join(', ')} a span`);
}

/* ---- The same water from the same ground ------------------------------------------------------ */

/*
 * Every way the water can go at the foot, each laid on the island in one go
 * with the settling: the scene, the aqueduct as a finished bridge (or not), a
 * pool or a fountain at its foot, and the spring's water settled through it.
 */
interface Variant { name: string; height?: number; open?: boolean; pool?: number; fountain?: boolean; fill?: boolean }
const VARIANTS: Variant[] = [
  { name: 'into the hollow' },
  { name: 'into a pool poured at its foot', pool: 60 },
  { name: 'into a fountain', fountain: true },
  { name: 'with its channel over its head\'s water', height: 139 },
  { name: 'unfinished', open: true },
  { name: 'with the hollow filled in', fill: true },
];
const HEIGHT = 138;
const baseSlab = new Map(SLABS.map(([x, y, top, pool]) => [`${x},${y}`, { top, pool } as Slab]));
{
  const [cx, cy] = springCorner((x, y) => hAt(x, y) ?? 0, BOWL[0], BOWL[1]);
  const island = JSON.parse(psql(`
begin;
create temp table said (i int, a jsonb);
do $b$
declare w uuid; me uuid; them uuid; v_b bigint;
begin
  ${ISLAND_SCENE}
  ${VARIANTS.map((v, i) => `
  insert into bridge (world_id, kind, ax, ay, bx, by, height) values (w, 'aqueduct', ${HEAD[0]}, ${HEAD[1]}, ${FOOT[0]}, ${FOOT[1]}, ${v.height ?? HEIGHT})
    returning id into v_b;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select w, v_b, t.n, t.x, t.y, case when ${!!v.open} and t.n = 3 then '{"mortar":1}'::jsonb else '{}'::jsonb end, '{}'::jsonb
    from span_tiles(${HEAD[0]}, ${HEAD[1]}, ${FOOT[0]}, ${FOOT[1]}) t;
  ${v.pool ? `insert into foundation (world_id, id, x, y, top, needed, total, pool) values (w, 9990, ${FOOT[0]}, ${FOOT[1]}, ${v.pool}, '{"concrete":0}', '{"concrete":1}', true);` : ''}
  ${v.fountain ? `insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql) values (w, 'furniture', 'fountain', ${FOOT[0]}, ${FOOT[1]}, 0, 0, ${FOOT[0]} + 0.375, ${FOOT[1]} + 0.375, 80);` : ''}
  ${v.fill ? `perform land_set_height(w, x, y, 60 - greatest(0, y - 36) * 2) from generate_series(23, 25) x, generate_series(39, 41) y;` : ''}
  insert into said values (${i}, settle_water(w, ${cx}, ${cy}, ${BOWL[0]}, ${BOWL[1]}));
  ${v.fill ? `perform land_set_height(w, x, y, case when x = 24 and y = 40 then 40 else 46 end) from generate_series(23, 25) x, generate_series(39, 41) y;` : ''}
  delete from placed where world_id = w;
  delete from foundation where world_id = w and id = 9990;
  delete from bridge_span where world_id = w;
  delete from bridge where world_id = w;`).join('\n')}
  insert into said values (100, settle_chain(w, ${FOOT[0]}, ${FOOT[1]}, null, null, true));
  insert into said values (101, settle_chain(w, 26, 38, null, null, true));
  insert into said values (102, settle_chain(w, 40, 32, null, null, true));
  insert into said values (103, settle_chain(w, ${cx}, ${cy}, ${BOWL[0]}, ${BOWL[1]}));
end $b$;
select jsonb_object_agg(i, a) from said;
rollback;`)) as Record<string, unknown>;

  // Running from a corner: into the hollow, down the valley, and into the sea's pit.
  const runs: Array<[string, number, number]> = [['into the hollow at the foot', FOOT[0], FOOT[1]], ['down the valley', 26, 38], ['into the pit under the sea\'s level', 40, 32]];
  runs.forEach(([what, x, y], i) => {
    const mine = answer(settleChain(hAt, x, y, undefined, undefined, true));
    say(canon(mine) === canon(island[String(100 + i)]),
      `water poured out at a corner runs the same way on both sides, ${what}: ${canon(mine).slice(0, 200)}${canon(mine) === canon(island[String(100 + i)]) ? '' : ` | island ${canon(island[String(100 + i)]).slice(0, 200)}`}`);
  });
  const plain = settleChain(hAt, cx, cy, (x, y) => baseSlab.get(`${x},${y}`) ?? null, BOWL) as Chain;
  say(canon(plain) === canon(island['103']) && plain.ponds.length === 2 && plain.streams[0].to === 1,
    `with no aqueduct, the spring's pond at ${plain.ponds[0]?.level} spills over the cliff into the catch pond at ${plain.ponds[1]?.level}, on both sides alike`);

  VARIANTS.forEach((v, i) => {
    const slabs = new Map(baseSlab);
    if (v.pool) slabs.set(`${FOOT[0]},${FOOT[1]}`, { top: v.pool, pool: true });
    const h = v.fill ? (x: number, y: number): number | null => (x >= 23 && x <= 25 && y >= 39 && y <= 41 ? valley(y) : hAt(x, y)) : hAt;
    const channels: Channel[] = v.open ? [] : [{ id: 1, from: HEAD, to: FOOT, height: v.height ?? HEIGHT, along: 8, fountain: !!v.fountain }];
    const mine = settleWater(h, cx, cy, (x, y) => slabs.get(`${x},${y}`) ?? null, BOWL, channels) as Chain;
    // The island's aqueduct ids differ run to run; the browser's is 1.
    const theirs = JSON.parse(JSON.stringify(island[String(i)]).replace(/"via":\d+/g, '"via":1')) as Chain;
    const via = mine.streams.find((s) => s.via !== undefined);
    const shape = via
      ? `leaves its pond by the channel${via.fountain ? ' into the fountain, which keeps it' : `, and makes ${mine.ponds.slice(1).map((p) => (p.tiles ? `a pool at ${p.level}` : `a pond at ${p.level}${p.volume ? ` of ${p.volume} litres` : ''}`)).join(', ') || 'no pond'} after it, ${mine.streams[mine.streams.length - 1].to === 'lost' ? 'running on out of the window' : `on to ${mine.streams[mine.streams.length - 1].to}`}`}`
      : `stays as it was (${mine.ponds.length} ponds)`;
    say(canon(mine) === canon(theirs), `the aqueduct ${v.name}: the spring's water ${shape}, the same on both sides${canon(mine) === canon(theirs) ? '' : ` -- browser ${canon(mine).slice(0, 400)} | island ${canon(theirs).slice(0, 400)}`}`);
  });
}


/* ---- Setting one out ------------------------------------------------------------------------ */

/*
 * Heads and feet asked of both sides with the spring running: each with
 * what is laid or dug for it first and taken away after -- a settlement over
 * the foot, a bridge over an end or across the span, a bank raised under the
 * channel, a fountain set down at the foot.
 */
interface Ask {
  what: string; head: [number, number]; foot: [number, number]; deed?: boolean; bridge?: [number, number, number, number]; raise?: [number, number]; fountain?: boolean;
  /** A tree on a tile, a pool poured on one, or another aqueduct set out first. */
  tree?: [number, number]; pool?: [number, number, number]; aq?: [number, number, number, number, number];
}
const ASKS: Ask[] = [
  { what: 'not in a line', head: HEAD, foot: [24, 41] },
  { what: 'side by side', head: HEAD, foot: [16, 40] },
  { what: 'too far', head: HEAD, foot: [25, 40] },
  { what: 'onto somebody else\'s settlement', head: HEAD, foot: FOOT, deed: true },
  { what: 'from dry ground', head: [24, 33], foot: FOOT },
  { what: 'from the sea', head: [40, 32], foot: [40, 38] },
  { what: 'onto a slab with no pool in it', head: [35, 40], foot: [35, 36] },
  { what: 'into the sea', head: [40, 38], foot: [40, 32] },
  { what: 'onto a slope', head: [28, 46], foot: [28, 40] },
  { what: 'into a basin too wide to fill', head: [43, 50], foot: [50, 50] },
  { what: 'within one pool', head: [35, 44], foot: [37, 44] },
  { what: 'within one pond', head: [12, 40], foot: [14, 40] },
  { what: 'uphill', head: [35, 40], foot: [35, 48] },
  { what: 'under a bridge', head: HEAD, foot: FOOT, bridge: [15, 38, 15, 42] },
  { what: 'across a bridge', head: HEAD, foot: FOOT, bridge: [20, 38, 20, 42] },
  { what: 'through a bank', head: HEAD, foot: FOOT, raise: [20, 40] },
  { what: 'from the pond to the hollow', head: HEAD, foot: FOOT },
  { what: 'from a pool to a pool', head: [35, 40], foot: [35, 44] },
  { what: 'from a pool to a fountain', head: [40, 38], foot: [37, 38], fountain: true },
  { what: 'over a tree', head: HEAD, foot: FOOT, tree: [20, 40] },
  { what: 'over a pool standing too high', head: HEAD, foot: FOOT, pool: [20, 40, 137] },
  { what: 'from water another aqueduct takes', head: [35, 44], foot: [35, 48], aq: [37, 44, 39, 44, 48] },
  { what: 'where one runs already', head: [35, 44], foot: [35, 48], aq: [35, 44, 35, 48, 48] },
];
{
  const [sx, sy] = springCorner((x, y) => hAt(x, y) ?? 0, BOWL[0], BOWL[1]);
  const island = lines(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; them uuid; v_spring bigint; v_b bigint;
begin
  ${ISLAND_SCENE}
  insert into spring (world_id, x, y, cx, cy, made_by) values (w, ${BOWL[0]}, ${BOWL[1]}, ${sx}, ${sy}, me) returning id into v_spring;
  perform settle_spring(w, v_spring);
  ${ASKS.map((a, i) => `
  ${a.deed ? `insert into deed (world_id, name, x, y, radius, founded_by) values (w, 'Hildsmoor', ${a.foot[0]}, ${a.foot[1]}, 1, them);` : ''}
  ${a.bridge ? `insert into bridge (world_id, kind, ax, ay, bx, by, height) values (w, 'rope', ${a.bridge.join(', ')}, 150) returning id into v_b;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total) select w, v_b, t.n, t.x, t.y, '{}'::jsonb, '{}'::jsonb from span_tiles(${a.bridge.join(', ')}) t;` : ''}
  ${a.raise ? `perform land_set_height(w, x, y, 140) from generate_series(${a.raise[0]}, ${a.raise[0] + 1}) x, generate_series(${a.raise[1]}, ${a.raise[1] + 1}) y;` : ''}
  ${a.fountain ? `insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql) values (w, 'furniture', 'fountain', ${a.foot[0]}, ${a.foot[1]}, 0, 0, ${a.foot[0]} + 0.375, ${a.foot[1]} + 0.375, 80);` : ''}
  ${a.tree ? `perform land_set_tile(w, ${a.tree[0]}, ${a.tree[1]}, 16);` : ''}
  ${a.pool ? `insert into foundation (world_id, id, x, y, top, needed, total, pool) values (w, 9991, ${a.pool[0]}, ${a.pool[1]}, ${a.pool[2]}, '{"concrete":0}', '{"concrete":1}', true);` : ''}
  ${a.aq ? `insert into bridge (world_id, kind, ax, ay, bx, by, height) values (w, 'aqueduct', ${a.aq.slice(0, 4).join(', ')}, ${a.aq[4]}) returning id into v_b;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total) select w, v_b, t.n, t.x, t.y, '{}'::jsonb, '{}'::jsonb from span_tiles(${a.aq.slice(0, 4).join(', ')}) t;` : ''}
  insert into said values ('${i}', aqueduct_plan(w, me, ${a.head[0]}, ${a.head[1]}, ${a.foot[0]}, ${a.foot[1]})::text);
  ${a.tree ? `perform land_set_tile(w, ${a.tree[0]}, ${a.tree[1]}, 0);` : ''}
  delete from foundation where world_id = w and id = 9991;
  delete from deed where world_id = w;
  delete from bridge_span where world_id = w;
  delete from bridge where world_id = w;
  delete from placed where world_id = w;
  ${a.raise ? `perform land_set_height(w, x, y, 60 - greatest(0, y - 36) * 2) from generate_series(${a.raise[0]}, ${a.raise[0] + 1}) x, generate_series(${a.raise[1]}, ${a.raise[1] + 1}) y;` : ''}`).join('\n')}
end $b$;
select string_agg(k || '=' || v, E'\\n~~\\n' order by k) from said;
rollback;`));
  const g = browserScene();
  g.springs.dig(BOWL[0], BOWL[1], null, Date.now() - 3600 * 1000);
  g.update(0.01);
  let same = 0;
  const differ: string[] = [];
  const kinds = new Set<string>();
  let refusals = 0;
  ASKS.forEach((a, i) => {
    if (a.deed) g.neighbourDeeds = [{ name: 'Hildsmoor', x: a.foot[0], y: a.foot[1], radius: 1, level: 1, holder: 'Crowd6' }];
    const b = a.bridge ? g.addBridge('rope', a.bridge[0], a.bridge[1], a.bridge[2], a.bridge[3], 150, 'Oak') : null;
    if (b) for (const s of b.spans) for (const k of Object.keys(s.needed)) s.needed[k] = 0;
    if (a.raise) for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) g.world.setHeight(a.raise[0] + x, a.raise[1] + y, 140);
    const f = a.fountain ? g.addFurniture('fountain', a.foot[0], a.foot[1], 0, 0, 80) : null;
    if (a.tree) g.world.setTile(a.tree[0], a.tree[1], TileType.Tree);
    const slab = a.pool ? g.addFoundation(a.pool[0], a.pool[1], a.pool[2], 0) : null;
    if (slab) slab.pool = true;
    const other = a.aq ? g.addBridge('aqueduct', a.aq[0], a.aq[1], a.aq[2], a.aq[3], a.aq[4]) : null;
    g.update(0.01);
    const r = aqueductPlan(g, a.head[0], a.head[1], a.foot[0], a.foot[1]);
    if (a.tree) g.world.setTile(a.tree[0], a.tree[1], TileType.Grass);
    if (slab) g.removeFoundation(slab.id);
    if (other) g.removeBridge(other.id);
    const mine = typeof r === 'string' ? { refused: r } : r;
    const theirs = JSON.parse(island.get(String(i)) ?? 'null');
    if (canon(mine) === canon(theirs)) same++;
    else differ.push(`${a.what}: browser ${canon(mine)} | island ${canon(theirs)}`);
    kinds.add(`${a.what} -- ${typeof r === 'string' ? `"${r}"` : canon(r)}`);
    if (typeof r === 'string') refusals++;
    g.neighbourDeeds = [];
    if (b) g.removeBridge(b.id);
    if (a.raise) for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) g.world.setHeight(a.raise[0] + x, a.raise[1] + y, valley(a.raise[1] + y));
    if (f) g.removeFurniture(f.id);
    g.update(0.01);
  });
  say(same === ASKS.length, `an aqueduct is set out, or refused, in the same words on both sides: ${same} of ${ASKS.length}${differ.length ? ` -- ${differ.join(' || ')}` : ''}`);
  for (const k of kinds) console.log(`       ${k}`);
  // Every ask refused but the three plans, each in words of its own but one pool's and one pond's, which are the same refusal.
  say(refusals === ASKS.length - 3 && new Set([...kinds].map((k) => k.split(' -- ')[1])).size === ASKS.length - 1,
    `every refusal there is is met, ${refusals} asks refused, and the three plans pass`);
}

/* ---- Through the doors ------------------------------------------------------------------------ */

/*
 * The spring running, the aqueduct set out from its pond to the hollow,
 * worked a go, laid to its last unit and finished; then the spring stopped
 * and dug again, the hollow filled in and dug out again, and the aqueduct
 * pulled down. The same on both sides, word for word where anything is said.
 */
const AT = `{"kind":"tile","x":${FOOT[0]},"y":${FOOT[1]},"cx":${FOOT[0]},"cy":${FOOT[1]},"head":[${HEAD[0]},${HEAD[1]}]}`;
{
  const [sx, sy] = springCorner((x, y) => hAt(x, y) ?? 0, BOWL[0], BOWL[1]);
  const island = lines(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; them uuid; v_spring bigint; v_b bigint; v_t jsonb; v_chain jsonb;
begin
  ${ISLAND_SCENE}
  insert into spring (world_id, x, y, cx, cy, made_by) values (w, ${BOWL[0]}, ${BOWL[1]}, ${sx}, ${sy}, me) returning id into v_spring;
  perform settle_spring(w, v_spring);
  insert into said values ('before', (select chain::text from spring where id = v_spring));
  insert into said values ('ok', coalesce(act_refusal(w, me, 'plan_aqueduct', '${AT}'), 'none'));
  perform act_perform(w, me, 'plan_aqueduct', '${AT}');
  insert into said values ('planned', (select text from event where world_id = w and uid = me order by n desc limit 1));
  select id into v_b from bridge where world_id = w and kind = 'aqueduct';
  v_t := jsonb_build_object('kind', 'bridge', 'id', v_b);
  insert into said values ('bridge', (select jsonb_build_object('ends', array[ax, ay, bx, "by"], 'height', height,
      'spans', (select count(*) from bridge_span sp where sp.world_id = w and sp.bridge = v_b),
      'wants', (select span_wants(sp.needed) from bridge_span sp where sp.world_id = w and sp.bridge = v_b and sp.n = 1))::text
    from bridge where id = v_b));
  insert into said values ('thrown', coalesce(act_refusal(w, me, 'plan_bridge', '{"kind":"tile","x":24,"y":40,"cx":24,"cy":40,"material":"aqueduct"}'), 'none'));
  update player set x = 16.5, y = 40.5 where world_id = w and uid = me;
  insert into said values ('empty', coalesce(act_refusal(w, me, 'build_aqueduct', v_t), 'none'));
  insert into said values ('asbridge', coalesce(act_refusal(w, me, 'build_bridge', v_t), 'none'));
  insert into item (world_id, def, holder, holder_uid, ql, count) values (w, 'mortar', 'player', me, 40, 1);
  perform act_perform(w, me, 'build_aqueduct', v_t);
  insert into said values ('go', (select text from event where world_id = w and uid = me order by n desc limit 1));
  insert into said values ('open', (select chain::text from spring where id = v_spring));
  -- Every span laid but the last unit of the last.
  update bridge_span set needed = case when n = 8 then '{"mortar":1}'::jsonb else '{}'::jsonb end where world_id = w and bridge = v_b;
  insert into item (world_id, def, holder, holder_uid, ql, count) values (w, 'mortar', 'player', me, 40, 1);
  update player set x = 22.5, y = 40.5 where world_id = w and uid = me;
  perform act_perform(w, me, 'build_aqueduct', v_t);
  insert into said values ('finished', (select text from event where world_id = w and uid = me order by n desc limit 1));
  -- Its stone starts greening from bare as it is finished, and there is nothing to scrub yet.
  update player set x = 16.5, y = 40.5 where world_id = w and uid = me;
  insert into item (world_id, def, holder, holder_uid, ql, count) values (w, 'brush', 'player', me, 40, 1);
  insert into said values ('scrub', coalesce(act_refusal(w, me, 'scrub_moss', v_t), 'none'));
  update player set x = 22.5, y = 40.5 where world_id = w and uid = me;
  select chain into v_chain from spring where id = v_spring;
  insert into said values ('after', v_chain::text);
  insert into said values ('water', has_water(w, ${CATCH[0]}, ${CATCH[1]})::text || ' ' || has_water(w, ${FOOT[0]}, ${FOOT[1]})::text
    || ' ' || water_surface(w, ${FOOT[0]}, ${FOOT[1]}));
  insert into said values ('feed', (select string_agg(f.x || ',' || f.y || ',' || f.fountain, ' ') from aqueduct_feed f where f.world_id = w));
  -- When the hollow starts to fill after now, and when it is full, in seconds; and when the stream on from it starts.
  insert into said values ('fill', extract(epoch from ((v_chain->'ponds'->1->>'since')::timestamptz - now())) || ' '
    || (v_chain->'ponds'->1->>'from') || ' ' || (v_chain->'ponds'->1->>'volume'));
  -- The source runs low: the spring stopped up, and the channel dry.
  update player set x = 13.5, y = 42.5 where world_id = w and uid = me;
  perform act_perform(w, me, 'stop_spring', '{"kind":"tile","x":${BOWL[0]},"y":${BOWL[1]},"cx":${BOWL[0]},"cy":${BOWL[1]}}');
  insert into said values ('stopped', (select count(*) from aqueduct_feed f where f.world_id = w) || ' ' || has_water(w, ${FOOT[0]}, ${FOOT[1]})::text);
  insert into spring (world_id, x, y, cx, cy, made_by) values (w, ${BOWL[0]}, ${BOWL[1]}, ${sx}, ${sy}, me) returning id into v_spring;
  perform settle_spring(w, v_spring);
  -- The target lost: the hollow filled in, and the water running away from where it was.
  perform land_set_height(w, x, y, 60 - greatest(0, y - 36) * 2) from generate_series(23, 25) x, generate_series(39, 41) y;
  insert into said values ('lost', (select chain::text from spring where id = v_spring));
  perform land_set_height(w, x, y, case when x = ${FOOT[0]} and y = ${FOOT[1]} then 40 else 46 end) from generate_series(23, 25) x, generate_series(39, 41) y;
  -- Pulled down.
  update player set x = 22.5, y = 40.5 where world_id = w and uid = me;
  insert into said values ('downok', coalesce(act_refusal(w, me, 'demolish_aqueduct', v_t), 'none'));
  perform act_perform(w, me, 'demolish_aqueduct', v_t);
  insert into said values ('down', (select text from event where world_id = w and uid = me and text like 'You take the aqueduct down%' order by n desc limit 1));
  insert into said values ('downafter', (select chain::text from spring where id = v_spring) || ' | ' || has_water(w, ${CATCH[0]}, ${CATCH[1]})::text
    || ' ' || (select count(*) from bridge where world_id = w) || ' ' || coalesce((select sum(count) from item where world_id = w and holder_uid = me
                                                                                    and def in ('mortar', 'stone_brick', 'stone_slab')), 0));
end $b$;
select string_agg(k || '=' || v, E'\\n~~\\n' order by k) from said;
rollback;`));
  const r = (k: string): string => island.get(k) ?? '';
  const g = browserScene();
  const now0 = Date.now();
  g.springs.dig(BOWL[0], BOWL[1], null, now0 - 3600 * 1000);
  g.update(0.01);
  const spring = (): Chain => [...g.springs.list.values()][0]?.chain as Chain;
  const said = (): string => g.log[g.log.length - 1]?.text ?? '';
  const at = tile(FOOT[0], FOOT[1], { head: HEAD });
  const before = viaOne(canon(spring()));
  say(before === stripFill(JSON.parse(r('before'))) && spring().ponds.length === 2,
    `the spring runs over the cliff into the catch pond at ${spring().ponds[1]?.level} on both sides`);
  const plan = act('plan_aqueduct');
  const ok = plan.check?.(at, g) ?? 'none';
  plan.perform(at, g);
  const planned = said();
  say(ok === 'none' || ok === null, `it may be set out from the pond to the hollow on both sides -- island: ${r('ok')}`);
  say(r('ok') === 'none' && planned === r('planned'), `and it is, in the same words: "${planned}"${planned === r('planned') ? '' : ` | island "${r('planned')}"`}`);
  const b = [...g.bridges.values()].find((x) => x.kind === 'aqueduct')!;
  const theirs = JSON.parse(r('bridge') || 'null');
  say(!!b && canon({ ends: [b.ax, b.ay, b.bx, b.by], height: b.height, spans: b.spans.length, wants: spanWantsOf(b.spans[0].needed) }) === canon(theirs),
    `an aqueduct of ${b?.spans.length} spans, its channel at ${b?.height}, each span wanting ${theirs?.wants}, on both sides`);
  say(r('thrown') === (g.bridgeReason('aqueduct', 22, 40, FOOT[0], FOOT[1]) ?? 'none'), `and "Throw a bridge across" will not make one: "${r('thrown')}"`);
  const build = act('build_aqueduct');
  const bt: Target = { kind: 'bridge', id: b.id };
  g.player.x = 16.5;
  const empty = build.check?.(bt, g) ?? 'none';
  say(empty === r('empty') && r('asbridge') === r('empty'), `worked with nothing to lay, it says what it wants, as a bridge's job aimed at it does: "${empty}"`);
  g.inventory.add('mortar', { count: 1, ql: 40 });
  g.player.x = 16.5;
  build.perform(bt, g);
  g.update(0.01);
  say(said() === r('go') && viaOne(canon(spring())) === before && stripFill(JSON.parse(r('open'))) === before,
    `a go lays a unit, in the same words, and an open aqueduct carries nothing: "${said()}"`);
  for (const sp of b.spans) for (const k of Object.keys(sp.needed)) sp.needed[k] = 0;
  b.spans[7].needed.mortar = 1;
  g.inventory.add('mortar', { count: 1, ql: 40 });
  g.player.x = 22.5;
  const t0 = Date.now();
  build.perform(bt, g);
  const finished = said();
  say(finished === r('finished'), `the last span laid, it says so in the same words: "${finished}"${finished === r('finished') ? '' : ` | island "${r('finished')}"`}`);
  g.player.x = 16.5;
  g.inventory.add('brush', { ql: 40 });
  const scrub = act('scrub_moss').check?.(bt, g) ?? 'none';
  g.player.x = 22.5;
  say(scrub === r('scrub') && scrub === NOTHING_YET && b.greenSince !== undefined,
    `its stone greens as a stone arch's does, from bare on the day it is finished, on both sides: "${scrub}"${scrub === r('scrub') ? '' : ` | island "${r('scrub')}"`}`);
  const after = spring();
  const theirsAfter = JSON.parse(r('after'));
  say(viaOne(canon(after)) === stripFill(theirsAfter), `and the spring's water goes along it on both sides: ${after.ponds.length} ponds, ${after.streams.map((st) => `${st.from}->${st.to}${st.via !== undefined ? ' (along the channel)' : ''}`).join(' ')}`);
  const [catchWet, footWet, surface] = r('water').split(' ');
  say(catchWet === 'false' && !g.world.hasWater(CATCH[0], CATCH[1]) && footWet === 'true' && g.world.hasWater(FOOT[0], FOOT[1])
      && Number(surface) === g.world.surfaceAt(FOOT[0], FOOT[1]),
    `what it carries leaves the source: the catch pond below the cliff is dry on both sides, and the hollow at the foot is water at ${surface}`);
  say(r('feed') === `${FOOT[0]},${FOOT[1]},false`, `the island writes down which aqueduct the spring runs along: ${r('feed')}`);
  // The hollow fills at the channel's flow: from its floor, after the water has run the channel, for its litres over the channel's.
  const [delay, from, volume] = r('fill').split(' ').map(Number);
  const s = [...g.springs.list.values()][0];
  const pond = s.chain.ponds[1];
  const fill = s.fill[1];
  const full = pondFull({ from: fill.from, level: pond.level, since: fill.since, rate: pondRate(pond) });
  const via = s.chain.streams.find((st) => st.via !== undefined)!;
  const run = (((via.along ?? 0) + via.path.length / 2) / RUN_RATE) * 1000;
  say(Math.abs(delay * 1000 - run) < 50 && Math.abs(fill.since - t0 - run) < 50 && from === pond.floor && fill.from === pond.floor
      && volume === pond.volume && Math.abs(full - fill.since - fillSeconds(pond.volume!) * 1000) < 1,
    `the hollow starts to fill ${(run / 1000).toFixed(2)} s on, the channel's ${via.along} tiles and the corner it lands on at the springs' ${RUN_RATE} a second (island ${delay.toFixed(2)} s), `
    + `from its floor at ${pond.floor}, and is full ${fillSeconds(pond.volume!)} s after: ${pond.volume} litres at ${AQUEDUCT_LPS} a second -- "${fillWords(fillSeconds(pond.volume!))}"`);
  const next = s.chain.streams.find((st) => st.from === 1);
  const laid = g.world.water?.streams.find((st) => st.from === 1 && st.spring === s.id);
  say(!!next && !!laid && Math.abs(laid.since - full) < 1, `and only when it is full does it spill on over its lip`);
  // Nobody walks it: no step goes up onto it, and its deck holds nobody up.
  say(g.bridgeStepLevel(HEAD[0], HEAD[1], 16, 40) === null && g.bridgeStepLevel(16, 40, 17, 40) === null && g.deckAt(20, 40) === null && g.laidOver(20, 40) === null,
    'nobody walks it: no step goes onto its deck, and nobody stands on it');
  // The source runs low.
  g.player.x = 13.5;
  g.player.y = 42.5;
  act('stop_spring').perform(tile(BOWL[0], BOWL[1]), g);
  g.update(0.01);
  say(r('stopped') === '0 false' && !g.world.hasWater(FOOT[0], FOOT[1]) && g.springs.flowingSince(b.id) === null,
    `the spring stopped up, the channel runs dry and the hollow with it, on both sides -- ${r('stopped')}`);
  g.springs.dig(BOWL[0], BOWL[1], null, Date.now());
  g.update(0.01);
  for (let y = 39; y <= 41; y++) for (let x = 23; x <= 25; x++) g.world.setHeight(x, y, valley(y));
  g.update(0.01);
  const lost = spring();
  say(viaOne(canon(lost)) === stripFill(JSON.parse(r('lost'))) && lost.streams.some((st) => st.via === b.id && st.path.length > 2 && st.to === 'sea'),
    `the hollow filled in, the water pours out at the foot and runs away downhill to the sea, the same on both sides`);
  for (let y = 39; y <= 41; y++) for (let x = 23; x <= 25; x++) g.world.setHeight(x, y, x === FOOT[0] && y === FOOT[1] ? 40 : 46);
  g.update(0.01);
  g.player.x = 22.5;
  g.player.y = 40.5;
  const down = act('demolish_aqueduct');
  const downOk = down.check?.(bt, g) ?? 'none';
  down.perform(bt, g);
  g.update(0.01);
  const [downChain, downRest] = r('downafter').split(' | ');
  const [catchAgain, bridges, back] = downRest.split(' ');
  const carried = ['mortar', 'stone_brick', 'stone_slab'].reduce((n, id) => n + g.inventory.count(id), 0);
  const downSaid = [...g.log].reverse().find((l) => l.text.startsWith('You take the aqueduct down'))?.text ?? '';
  say(downOk === r('downok') && downSaid === r('down') && stripFill(JSON.parse(downChain)) === viaOne(canon(spring())) && catchAgain === 'true'
      && g.world.hasWater(CATCH[0], CATCH[1]) && bridges === '0' && Number(back) === carried,
    `pulled down for half its bill, the water goes back over the pond's own lip into the catch pond: "${downSaid}"${downSaid === r('down') ? '' : ` | island "${r('down')}"`}`);
}

/* ---- A fountain kept full ------------------------------------------------------------------------ */

/*
 * A spring dug in the pool at (40, 38), and an aqueduct from it to a fountain
 * at (37, 38), finished: the fountain takes the channel's litres a second on
 * top of its own. Emptied and left a twentieth of a second, it holds the
 * same on both sides; with the aqueduct pulled down, it is back to its own.
 */
{
  const POOL: [number, number] = [40, 38];
  const FOUNT: [number, number] = [37, 38];
  const FAT = `{"kind":"tile","x":${FOUNT[0]},"y":${FOUNT[1]},"cx":${FOUNT[0]},"cy":${FOUNT[1]},"head":[${POOL[0]},${POOL[1]}]}`;
  const [px, py] = springCorner((x, y) => hAt(x, y) ?? 0, POOL[0], POOL[1]);
  const island = lines(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; them uuid; v_spring bigint; v_b bigint; v_f bigint; v_t jsonb; f placed;
begin
  ${ISLAND_SCENE}
  insert into spring (world_id, x, y, cx, cy, made_by) values (w, ${POOL[0]}, ${POOL[1]}, ${px}, ${py}, me) returning id into v_spring;
  perform settle_spring(w, v_spring);
  insert into said values ('spilt', (select (chain->'ponds'->0 ? 'spill')::text from spring where id = v_spring) || ' ' || water_runs(w, ${POOL[0]}, ${POOL[1]})::text);
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql) values (w, 'furniture', 'fountain', ${FOUNT[0]}, ${FOUNT[1]}, 0, 0, ${FOUNT[0]} + 0.375, ${FOUNT[1]} + 0.375, 80)
    returning id into v_f;
  update player set x = ${FOUNT[0] + 1}.5, y = ${FOUNT[1] + 1}.5 where world_id = w and uid = me;
  insert into said values ('ok', coalesce(act_refusal(w, me, 'plan_aqueduct', '${FAT}'), 'none'));
  perform act_perform(w, me, 'plan_aqueduct', '${FAT}');
  select id into v_b from bridge where world_id = w and kind = 'aqueduct';
  v_t := jsonb_build_object('kind', 'bridge', 'id', v_b);
  update bridge_span set needed = case when n = 2 then '{"mortar":1}'::jsonb else '{}'::jsonb end where world_id = w and bridge = v_b;
  insert into item (world_id, def, holder, holder_uid, ql, count) values (w, 'mortar', 'player', me, 40, 1);
  perform act_perform(w, me, 'build_aqueduct', v_t);
  insert into said values ('finished', (select text from event where world_id = w and uid = me order by n desc limit 1));
  insert into said values ('chain', (select chain::text from spring where id = v_spring));
  insert into said values ('kept', (select (chain->'ponds'->0 ? 'spill')::text from spring where id = v_spring) || ' ' || water_runs(w, ${POOL[0]}, ${POOL[1]})::text);
  update placed set litres = 0, since = now() - interval '50 milliseconds' where id = v_f;
  select * into f from placed where id = v_f;
  insert into said values ('fed', placed_litres(f)::text);
  perform act_perform(w, me, 'demolish_aqueduct', v_t);
  update placed set litres = 0, since = now() - interval '50 milliseconds' where id = v_f;
  select * into f from placed where id = v_f;
  insert into said values ('unfed', placed_litres(f)::text || ' ' || (select count(*) from aqueduct_feed where world_id = w));
end $b$;
select string_agg(k || '=' || v, E'\\n~~\\n' order by k) from said;
rollback;`));
  const r = (k: string): string => island.get(k) ?? '';
  const g = browserScene();
  g.springs.dig(POOL[0], POOL[1], null, Date.now() - 3600 * 1000);
  const spilt = (): string => `${!![...g.springs.list.values()][0].chain.ponds[0].spill} ${g.world.water?.runsOver(POOL[0], POOL[1]) ?? false}`;
  const spiltBefore = spilt();
  const f = g.addFurniture('fountain', FOUNT[0], FOUNT[1], 0, 0, 80);
  g.update(0.01);
  g.player.x = FOUNT[0] + 1.5;
  g.player.y = FOUNT[1] + 1.5;
  const at = tile(FOUNT[0], FOUNT[1], { head: POOL });
  const ok = act('plan_aqueduct').check?.(at, g) ?? 'none';
  act('plan_aqueduct').perform(at, g);
  const b = [...g.bridges.values()].find((x) => x.kind === 'aqueduct')!;
  for (const sp of b.spans) for (const k of Object.keys(sp.needed)) sp.needed[k] = 0;
  b.spans[1].needed.mortar = 1;
  g.inventory.add('mortar', { count: 1, ql: 40 });
  act('build_aqueduct').perform({ kind: 'bridge', id: b.id }, g);
  const finished = g.log[g.log.length - 1]?.text ?? '';
  const chain = [...g.springs.list.values()][0].chain;
  say(ok === r('ok') || (ok === null && r('ok') === 'none'), `an aqueduct may be led from the spring's pool to the fountain on both sides -- ${r('ok')}`);
  say(finished === r('finished') && viaOne(canon(chain)) === stripFill(JSON.parse(r('chain'))) && chain.streams.some((st) => st.fountain),
    `finished, it pours into the fountain, which keeps what it is given, the same on both sides: "${finished}"`);
  const spiltAfter = spilt();
  say(spiltBefore === 'true true' && spiltBefore === r('spilt') && spiltAfter === 'false false' && spiltAfter === r('kept'),
    `what it carries leaves the pool at its head: the pool went over its edge before (${spiltBefore}, island ${r('spilt')}) and goes over it no more (${spiltAfter}, island ${r('kept')})`);
  f.litres = 0;
  g.update(0.05);
  const fed = f.litres ?? 0;
  const own = g.wellRate(f) * 0.05;
  say(Math.abs(fed - Number(r('fed'))) < 1e-3 && Math.abs(fed - Math.min(WELL_HOLDS, (g.wellRate(f) + AQUEDUCT_LPS) * 0.05)) < 1e-6,
    `emptied, a fountain an aqueduct keeps takes ${AQUEDUCT_LPS} litres a second on top of its own ${g.wellRate(f).toFixed(4)}: ${fed.toFixed(3)} litres in a twentieth of a second on both sides (island ${Number(r('fed')).toFixed(3)}), `
    + `full again in ${(WELL_HOLDS / (g.wellRate(f) + AQUEDUCT_LPS)).toFixed(3)} s`);
  act('demolish_aqueduct').perform({ kind: 'bridge', id: b.id }, g);
  g.update(0.01);
  f.litres = 0;
  g.update(0.05);
  const [unfed, rows] = r('unfed').split(' ').map(Number);
  say(Math.abs((f.litres ?? 0) - own) < 1e-6 && Math.abs(unfed - own) < 1e-3 && rows === 0,
    `with the aqueduct down it draws only its own again, ${own.toFixed(5)} litres in a twentieth of a second, on both sides (island ${unfed.toFixed(5)})`);
}

/* ---- The fountain at its foot taken away --------------------------------------------------------- */

/*
 * The same aqueduct from the spring's pool to the fountain, finished, and
 * then the fountain taken away: the water pours out onto the ground at the
 * foot and runs off downhill, the island no longer counts the tile as a
 * fountain the channel keeps, and both sides settle the spring the same.
 */
{
  const POOL: [number, number] = [40, 38];
  const FOUNT: [number, number] = [37, 38];
  const FAT = `{"kind":"tile","x":${FOUNT[0]},"y":${FOUNT[1]},"cx":${FOUNT[0]},"cy":${FOUNT[1]},"head":[${POOL[0]},${POOL[1]}]}`;
  const [px, py] = springCorner((x, y) => hAt(x, y) ?? 0, POOL[0], POOL[1]);
  const island = lines(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; them uuid; v_spring bigint; v_b bigint; v_f bigint; v_t jsonb;
begin
  ${ISLAND_SCENE}
  insert into spring (world_id, x, y, cx, cy, made_by) values (w, ${POOL[0]}, ${POOL[1]}, ${px}, ${py}, me) returning id into v_spring;
  perform settle_spring(w, v_spring);
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql) values (w, 'furniture', 'fountain', ${FOUNT[0]}, ${FOUNT[1]}, 0, 0, ${FOUNT[0]} + 0.375, ${FOUNT[1]} + 0.375, 80)
    returning id into v_f;
  update player set x = ${FOUNT[0] + 1}.5, y = ${FOUNT[1] + 1}.5 where world_id = w and uid = me;
  perform act_perform(w, me, 'plan_aqueduct', '${FAT}');
  select id into v_b from bridge where world_id = w and kind = 'aqueduct';
  v_t := jsonb_build_object('kind', 'bridge', 'id', v_b);
  update bridge_span set needed = case when n = 2 then '{"mortar":1}'::jsonb else '{}'::jsonb end where world_id = w and bridge = v_b;
  insert into item (world_id, def, holder, holder_uid, ql, count) values (w, 'mortar', 'player', me, 40, 1);
  perform act_perform(w, me, 'build_aqueduct', v_t);
  insert into said values ('fed', (select string_agg(f.x || ',' || f.y || ',' || f.fountain, ' ') from aqueduct_feed f where f.world_id = w));
  delete from placed where id = v_f;
  insert into said values ('chain', (select chain::text from spring where id = v_spring));
  insert into said values ('feed', (select string_agg(f.x || ',' || f.y || ',' || f.fountain, ' ') from aqueduct_feed f where f.world_id = w));
end $b$;
select string_agg(k || '=' || v, E'\\n~~\\n' order by k) from said;
rollback;`));
  const r = (k: string): string => island.get(k) ?? '';
  const g = browserScene();
  g.springs.dig(POOL[0], POOL[1], null, Date.now() - 3600 * 1000);
  const f = g.addFurniture('fountain', FOUNT[0], FOUNT[1], 0, 0, 80);
  g.update(0.01);
  g.player.x = FOUNT[0] + 1.5;
  g.player.y = FOUNT[1] + 1.5;
  const at = tile(FOUNT[0], FOUNT[1], { head: POOL });
  act('plan_aqueduct').perform(at, g);
  const b = [...g.bridges.values()].find((x) => x.kind === 'aqueduct')!;
  for (const sp of b.spans) for (const k of Object.keys(sp.needed)) sp.needed[k] = 0;
  b.spans[1].needed.mortar = 1;
  g.inventory.add('mortar', { count: 1, ql: 40 });
  act('build_aqueduct').perform({ kind: 'bridge', id: b.id }, g);
  const keptBefore = footSays(g, b);
  const fedBefore = g.springs.feeds(FOUNT[0], FOUNT[1]);
  g.removeFurniture(f.id);
  g.update(0.01);
  const chain = [...g.springs.list.values()][0].chain;
  const via = chain.streams.find((st) => st.via !== undefined);
  const now = footSays(g, b);
  say(r('fed') === `${FOUNT[0]},${FOUNT[1]},true` && fedBefore && keptBefore === 'It keeps the fountain at its foot full.',
    `kept full while it stands: "${keptBefore}" (island ${r('fed')})`);
  say(viaOne(canon(chain)) === stripFill(JSON.parse(r('chain'))) && !!via && !via.fountain && via.path.length > 0 && !g.springs.feeds(FOUNT[0], FOUNT[1])
    && r('feed') === `${FOUNT[0]},${FOUNT[1]},false`,
    `the fountain taken away, the water pours out at the foot and runs off downhill, ${(via?.path.length ?? 0) / 2} corners of it, the same on both sides, `
    + `and neither side counts the tile as kept (island ${r('feed')}): "${now}"`);
}

/* ---- Its piers, and a foundation with no pool at its foot ---------------------------------------- */

/*
 * A spring dug in the pool at (40, 38) and an aqueduct from it south to a
 * pool at (40, 41), finished. On the flat every edge of the foot pool is as
 * low as the next, and the first of them is the north one, the edge its end
 * pier stands on: its water goes over another edge instead, on both sides.
 * Then the same with the foot pool filled in: the water lands on the slab's
 * top and goes off it at a corner of the slab, not out from under it.
 */
{
  const POOL: [number, number] = [40, 38];
  const TO: [number, number] = [40, 41];
  const [px, py] = springCorner((x, y) => hAt(x, y) ?? 0, POOL[0], POOL[1]);
  const island = lines(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; them uuid; v_b bigint;
begin
  ${ISLAND_SCENE}
  insert into foundation (world_id, id, x, y, top, needed, total, pool) values (w, 9990, ${TO[0]}, ${TO[1]}, 60, '{"concrete":0}', '{"concrete":1}', true);
  insert into bridge (world_id, kind, ax, ay, bx, by, height) values (w, 'aqueduct', ${POOL[0]}, ${POOL[1]}, ${TO[0]}, ${TO[1]}, 68) returning id into v_b;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select w, v_b, t.n, t.x, t.y, '{}'::jsonb, '{"mortar":1}'::jsonb from span_tiles(${POOL[0]}, ${POOL[1]}, ${TO[0]}, ${TO[1]}) t;
  insert into said values ('pool', settle_water(w, ${px}, ${py}, ${POOL[0]}, ${POOL[1]})::text);
  update foundation set pool = false where world_id = w and id = 9990;
  insert into said values ('slab', settle_water(w, ${px}, ${py}, ${POOL[0]}, ${POOL[1]})::text);
end $b$;
select string_agg(k || '=' || v, E'\\n~~\\n' order by k) from said;
rollback;`));
  const line: AqueductLine = { ax: POOL[0], ay: POOL[1], bx: TO[0], by: TO[1] };
  const channels: Channel[] = [{ id: 1, from: POOL, to: TO, height: 68, along: 2, fountain: false }];
  const slabsWith = (pool: boolean) => (x: number, y: number): Slab | null =>
    (x === TO[0] && y === TO[1] ? { top: 60, pool } : baseSlab.get(`${x},${y}`) ?? null);
  const pier = `${TO[0]},${TO[1]},${TO[0] + 1},${TO[1]}`;
  const mine = settleWater(hAt, px, py, slabsWith(true), POOL, channels, aqueductShut([line])) as Chain;
  const open = settleWater(hAt, px, py, slabsWith(true), POOL, channels) as Chain;
  const footOf = (c: Chain) => c.ponds.find((p) => p.tiles?.[0] === TO[0] && p.tiles?.[1] === TO[1]);
  const through = footOf(open)?.spill?.edge.join(',');
  const over = footOf(mine)?.spill?.edge.join(',');
  const theirs = viaOne(canon(JSON.parse(island.get('pool') ?? 'null')));
  say(viaOne(canon(mine)) === theirs && through === pier && !!over && over !== pier,
    `the foot pool's first lowest edge is the one its end pier stands on (${through}), and its water goes over ${over} instead, the same on both sides`
    + `${viaOne(canon(mine)) === theirs ? '' : ` -- browser ${canon(mine).slice(0, 300)} | island ${theirs.slice(0, 300)}`}`);
  const dry = settleWater(hAt, px, py, slabsWith(false), POOL, channels, aqueductShut([line])) as Chain;
  const off = dry.streams.find((st) => st.via !== undefined);
  const theirsDry = viaOne(canon(JSON.parse(island.get('slab') ?? 'null')));
  const [fx, fy] = [off?.path[0] ?? -1, off?.path[1] ?? -1];
  const corner = (fx === TO[0] || fx === TO[0] + 1) && (fy === TO[1] || fy === TO[1] + 1);
  say(viaOne(canon(dry)) === theirsDry && !!off && corner && (hAt(fx, fy) ?? 99) < 60,
    `the foot pool filled in, the water lands on the slab's top at 60 and goes off it at its corner ${fx}, ${fy}, down to the ground at ${hAt(fx, fy)}, `
    + `and runs on from there (${(off?.path.length ?? 0) / 2} corners, to ${off?.to}), the same on both sides`
    + `${viaOne(canon(dry)) === theirsDry ? '' : ` -- browser ${canon(dry).slice(0, 300)} | island ${theirsDry.slice(0, 300)}`}`);
}

/* ---- Under it ---------------------------------------------------------------------------------- */

/*
 * An aqueduct down the edge of the plateau at x 16, finished, and another on
 * the flat at y 52. Under the first, the cliff between the plateau and the
 * valley is as steep as it ever was: no deck carries anybody over it. Along
 * the second, its piers stand between its tiles; across it, its arches are
 * walked through. Nothing is planted, no building planned and no pool dug
 * under a span, on either side, in the same words.
 */
{
  const island = lines(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; them uuid; v_b bigint;
begin
  ${ISLAND_SCENE}
  insert into said values ('cliff0', walk_share(w, me, 0, 17.5, 41.5, 16.5, 41.5)::text);
  insert into bridge (world_id, kind, ax, ay, bx, by, height) values (w, 'aqueduct', 16, 38, 16, 44, 160) returning id into v_b;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select w, v_b, t.n, t.x, t.y, '{}'::jsonb, '{"mortar":1}'::jsonb from span_tiles(16, 38, 16, 44) t;
  insert into said values ('cliff', walk_share(w, me, 0, 17.5, 41.5, 16.5, 41.5)::text);
  update bridge set kind = 'stone' where id = v_b;
  insert into said values ('arch', walk_share(w, me, 0, 17.5, 41.5, 16.5, 41.5)::text);
  delete from bridge_span where world_id = w;
  delete from bridge where world_id = w;
  insert into said values ('along0', walk_share(w, me, 0, 34.5, 52.5, 35.5, 52.5)::text);
  insert into bridge (world_id, kind, ax, ay, bx, by, height) values (w, 'aqueduct', 32, 52, 38, 52, 80) returning id into v_b;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select w, v_b, t.n, t.x, t.y, '{}'::jsonb, '{"mortar":1}'::jsonb from span_tiles(32, 52, 38, 52) t;
  insert into said values ('along', walk_share(w, me, 0, 34.5, 52.5, 35.5, 52.5)::text);
  insert into said values ('across', walk_share(w, me, 0, 34.5, 51.5, 34.5, 53.5)::text);
  insert into said values ('end', walk_share(w, me, 0, 31.5, 52.5, 32.5, 52.5)::text || ' ' || walk_share(w, me, 0, 32.5, 52.5, 33.5, 52.5)::text);
  update player set x = 33.5, y = 51.5 where world_id = w and uid = me;
  insert into item (world_id, def, holder, holder_uid, ql, count, extra) values (w, 'sprout', 'player', me, 40, 1, 'Oak');
  insert into said values ('plant', coalesce(act_refusal(w, me, 'plant', '{"kind":"tile","x":34,"y":52,"cx":34,"cy":52}'), 'none'));
  insert into said values ('beside', coalesce(act_refusal(w, me, 'plant', '{"kind":"tile","x":34,"y":51,"cx":34,"cy":51}'), 'none'));
  insert into deed (world_id, name, x, y, radius, founded_by) values (w, 'Hearth', 35, 49, 5, me);
  insert into said values ('build', coalesce(plan_reason(w, me, 34, 52), 'none'));
  insert into foundation (world_id, id, x, y, top, needed, total, pool) values (w, 9991, 34, 52, 40, '{"concrete":0}', '{"concrete":1}', false);
  insert into said values ('pool', coalesce(pool_reason(w, 34, 52), 'none'));
end $b$;
select string_agg(k || '=' || v, E'\\n~~\\n' order by k) from said;
rollback;`));
  const r = (k: string): string => island.get(k) ?? '';
  const g = browserScene();
  const cliff0 = g.stepRule(17, 41, 0, 16, 41);
  const a = g.addBridge('aqueduct', 16, 38, 16, 44, 160);
  for (const sp of a.spans) for (const k of Object.keys(sp.needed)) sp.needed[k] = 0;
  const cliff = g.stepRule(17, 41, 0, 16, 41);
  g.removeBridge(a.id);
  say(Number(r('cliff0')) < 1 && Number(r('cliff')) < 1 && Number(r('arch')) === 1 && cliff0 === null && cliff === null,
    `the cliff under an aqueduct is as steep as without it: a step up it is refused on both sides (island ${Number(r('cliff')).toFixed(2)} of the way, browser ${cliff}), `
    + `where a stone arch's deck carries you (island ${r('arch')})`);
  const along0 = g.stepRule(34, 52, 0, 35, 52);
  const b = g.addBridge('aqueduct', 32, 52, 38, 52, 80);
  for (const sp of b.spans) for (const k of Object.keys(sp.needed)) sp.needed[k] = 0;
  const along = g.stepRule(34, 52, 0, 35, 52);
  const across = g.stepRule(34, 51, 0, 34, 52) === 0 && g.stepRule(34, 52, 0, 34, 53) === 0;
  const ends = g.stepRule(31, 52, 0, 32, 52) === 0 && g.stepRule(32, 52, 0, 33, 52) === null;
  say(Number(r('along0')) === 1 && along0 === 0 && Number(r('along')) < 1 && along === null && Number(r('across')) === 1 && across
      && r('end') === `1 ${Number(r('end').split(' ')[1])}` && Number(r('end').split(' ')[1]) < 1 && ends,
    `along its run its piers stand in the way (island ${Number(r('along')).toFixed(2)} of a step, browser ${along}), from its end onto its first span too; `
    + `across it you walk under its arches (island ${r('across')}), on both sides`);
  g.player.x = 33.5;
  g.player.y = 51.5;
  g.inventory.add('sprout', { ql: 40, extra: 'Oak' });
  const plant = act('plant');
  const planted = plant.check?.(tile(34, 52), g) ?? 'none';
  const beside = plant.check?.(tile(34, 51), g) ?? 'none';
  g.deed = { name: 'Hearth', x: 35, y: 49, radius: 5, level: 1 };
  const build = g.planReason(34, 52) ?? 'none';
  const f = g.addFoundation(34, 52, 40, 0);
  const pool = g.poolReason(34, 52) ?? 'none';
  g.removeFoundation(f.id);
  say(planted === r('plant') && r('beside') === beside && beside !== planted && build === r('build') && pool === r('pool')
      && planted === AQ_OVER && build === AQ_OVER && pool === AQ_OVER,
    `nothing planted, no building planned and no pool dug under a span, on both sides: "${planted}" (beside it: ${beside}) `
    + `${planted === r('plant') && build === r('build') && pool === r('pool') ? '' : ` | island ${r('plant')} / ${r('build')} / ${r('pool')} / browser ${build} / ${pool}`}`);
}

/* ---- Water another aqueduct takes, and a spring dug in its head ---------------------------------- */

/*
 * An aqueduct from the pool at (40, 38) west to a pool at (37, 38), finished;
 * then a spring dug in the pool at its head, which says where its water goes,
 * the same on both sides. And a spring of its own in the hollow at (24, 40),
 * full, with the aqueduct from the plateau's pond finished into it: the pond
 * at its foot is full already, and both sides say so.
 */
{
  const POOL: [number, number] = [40, 38];
  const TO: [number, number] = [37, 38];
  const DIG = `{"kind":"tile","x":${POOL[0]},"y":${POOL[1]},"cx":${POOL[0]},"cy":${POOL[1]}}`;
  const [bx, by] = springCorner((x, y) => hAt(x, y) ?? 0, BOWL[0], BOWL[1]);
  const [hx, hy] = springCorner((x, y) => hAt(x, y) ?? 0, FOOT[0], FOOT[1]);
  const island = lines(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; them uuid; v_b bigint; v_s bigint; v_t jsonb;
begin
  ${ISLAND_SCENE}
  insert into foundation (world_id, id, x, y, top, needed, total, pool) values (w, 9990, ${TO[0]}, ${TO[1]}, 60, '{"concrete":0}', '{"concrete":1}', true);
  insert into bridge (world_id, kind, ax, ay, bx, by, height) values (w, 'aqueduct', ${POOL[0]}, ${POOL[1]}, ${TO[0]}, ${TO[1]}, 68) returning id into v_b;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select w, v_b, t.n, t.x, t.y, '{}'::jsonb, '{"mortar":1}'::jsonb from span_tiles(${POOL[0]}, ${POOL[1]}, ${TO[0]}, ${TO[1]}) t;
  update player set x = ${POOL[0] + 1}.5, y = ${POOL[1] + 1}.5 where world_id = w and uid = me;
  perform act_perform(w, me, 'dig_spring', '${DIG}');
  insert into said values ('dug', (select text from event where world_id = w and uid = me order by n desc limit 1));
  delete from spring where world_id = w;
  delete from bridge_span where world_id = w;
  delete from bridge where world_id = w;
  delete from foundation where world_id = w and id = 9990;
  -- A spring in the hollow at the foot, full; then one on the plateau, and the aqueduct between finished.
  insert into spring (world_id, x, y, cx, cy, made_by) values (w, ${FOOT[0]}, ${FOOT[1]}, ${hx}, ${hy}, me) returning id into v_s;
  perform settle_spring(w, v_s);
  insert into spring (world_id, x, y, cx, cy, made_by) values (w, ${BOWL[0]}, ${BOWL[1]}, ${bx}, ${by}, me) returning id into v_s;
  perform settle_spring(w, v_s);
  update player set x = 22.5, y = 40.5 where world_id = w and uid = me;
  perform act_perform(w, me, 'plan_aqueduct', '${AT}');
  select id into v_b from bridge where world_id = w and kind = 'aqueduct';
  v_t := jsonb_build_object('kind', 'bridge', 'id', v_b);
  update bridge_span set needed = case when n = 8 then '{"mortar":1}'::jsonb else '{}'::jsonb end where world_id = w and bridge = v_b;
  insert into item (world_id, def, holder, holder_uid, ql, count) values (w, 'mortar', 'player', me, 40, 1);
  perform act_perform(w, me, 'build_aqueduct', v_t);
  insert into said values ('full', (select text from event where world_id = w and uid = me order by n desc limit 1));
end $b$;
select string_agg(k || '=' || v, E'\\n~~\\n' order by k) from said;
rollback;`));
  const r = (k: string): string => island.get(k) ?? '';
  const g = browserScene();
  g.addFoundation(TO[0], TO[1], 60, 0).pool = true;
  const b = g.addBridge('aqueduct', POOL[0], POOL[1], TO[0], TO[1], 68);
  for (const sp of b.spans) for (const k of Object.keys(sp.needed)) sp.needed[k] = 0;
  g.springs.lay();
  g.player.x = POOL[0] + 1.5;
  g.player.y = POOL[1] + 1.5;
  act('dig_spring').perform(tile(POOL[0], POOL[1]), g);
  const dug = g.log[g.log.length - 1]?.text ?? '';
  say(dug === r('dug') && dug.includes(`along the aqueduct from ${POOL[0]}, ${POOL[1]}`),
    `a spring dug in the pool an aqueduct draws from says where its water goes: "${dug}"${dug === r('dug') ? '' : ` | island "${r('dug')}"`}`);
  const h = browserScene();
  h.springs.dig(FOOT[0], FOOT[1], null, Date.now() - 3600 * 1000);
  h.springs.dig(BOWL[0], BOWL[1], null, Date.now() - 3600 * 1000);
  h.update(0.01);
  h.player.x = 22.5;
  h.player.y = 40.5;
  const at = tile(FOOT[0], FOOT[1], { head: HEAD });
  act('plan_aqueduct').perform(at, h);
  const a = [...h.bridges.values()].find((x) => x.kind === 'aqueduct')!;
  for (const sp of a.spans) for (const k of Object.keys(sp.needed)) sp.needed[k] = 0;
  a.spans[7].needed.mortar = 1;
  h.inventory.add('mortar', { count: 1, ql: 40 });
  act('build_aqueduct').perform({ kind: 'bridge', id: a.id }, h);
  const full = h.log[h.log.length - 1]?.text ?? '';
  say(full === r('full') && full.endsWith('The pond at its foot is full already, and spills over its lip.'),
    `finished into a spring's pond standing full, it says so: "${full}"${full === r('full') ? '' : ` | island "${r('full')}"`}`);
}

/* ---- Nobody on its deck ------------------------------------------------------------------------ */

/*
 * An aqueduct across the catch pond, and somebody in the pond under it: out
 * of their depth, they swim, on both sides. A rope bridge in the same place
 * is still a deck to the island, as it was.
 */
{
  const [sx, sy] = springCorner((x, y) => hAt(x, y) ?? 0, BOWL[0], BOWL[1]);
  const island = lines(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; them uuid; v_spring bigint; v_b bigint;
begin
  ${ISLAND_SCENE}
  insert into spring (world_id, x, y, cx, cy, made_by) values (w, ${BOWL[0]}, ${BOWL[1]}, ${sx}, ${sy}, me) returning id into v_spring;
  perform settle_spring(w, v_spring);
  insert into bridge (world_id, kind, ax, ay, bx, by, height) values (w, 'aqueduct', ${CATCH[0]}, ${CATCH[1] - 3}, ${CATCH[0]}, ${CATCH[1] + 3}, 60)
    returning id into v_b;
  insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select w, v_b, t.n, t.x, t.y, '{}'::jsonb, '{}'::jsonb from span_tiles(${CATCH[0]}, ${CATCH[1] - 3}, ${CATCH[0]}, ${CATCH[1] + 3}) t;
  update player set x = ${CATCH[0]}.5, y = ${CATCH[1]}.5 where world_id = w and uid = me;
  insert into said values ('aqueduct', in_deep_water(w, me)::text);
  update bridge set kind = 'rope' where id = v_b;
  insert into said values ('rope', in_deep_water(w, me)::text);
end $b$;
select string_agg(k || '=' || v, E'\\n~~\\n' order by k) from said;
rollback;`));
  const g = browserScene();
  g.springs.dig(BOWL[0], BOWL[1], null, Date.now() - 3600 * 1000);
  g.update(0.01);
  const b = g.addBridge('aqueduct', CATCH[0], CATCH[1] - 3, CATCH[0], CATCH[1] + 3, 60);
  for (const sp of b.spans) for (const k of Object.keys(sp.needed)) sp.needed[k] = 0;
  g.player.x = CATCH[0] + 0.5;
  g.player.y = CATCH[1] + 0.5;
  g.player.update(0.01, g.world, g.movement().rule);
  const under = g.player.swimming;
  say(island.get('aqueduct') === 'true' && under, `out of your depth in the pond under an aqueduct, you swim, on both sides: its deck holds nobody up`);
  // What a bridge's deck does for somebody under it is as it was: this only takes an aqueduct out of it.
  say(island.get('rope') === 'false', 'and on the island a rope bridge in the same place still counts as a deck, as it did');
}

console.log(bad ? `${bad} of these are not what they should be` : 'all as they should be');
process.exit(bad ? 1 : 0);
