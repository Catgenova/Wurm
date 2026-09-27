/**
 * Pools dug in foundations.
 *
 * Asked for: "Allow pools to be dug in foundations". A poured slab can have a
 * pool broken out of it: water `POOL_LIP` under its top over a floor
 * `POOL_DEPTH` under it, water to every rule whether or not a spring rises in
 * it, and one pool with every pool beside it poured to the same top. A spring
 * dug in one spills over its lowest edge -- down the face of the slab to the
 * ground, or into a pool below -- and runs on as any spring's water does.
 *
 * Checked here:
 *   * the island's `settle_chain` and the browser's `settleChain` put the same
 *     water on the same ground and slabs: a cascade of two pools that goes
 *     over onto a hillside and fills a hollow on its way down, a pool walled
 *     in by higher slabs that keeps its water, and a spring under a slab with
 *     no pool in it, which is buried;
 *   * on the island, a pool dug with a pickaxe is water with a surface, a
 *     depth to its floor and a swimmer in it; a spring dug in it says where
 *     its water goes, a second is refused, and filling the pool in with
 *     `POOL_FILL` concrete stops it;
 *   * in the browser, the same.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTIONS, type ActionDef, type Target } from '../../src/game/actions';
import { waterDepth } from '../../src/game/fishing';
import { POOL_FILL } from '../../src/game/foundations';
import { POOL_DEPTH, POOL_LIP, settleChain, springCorner, type Slab } from '../../src/world/springs';

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
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

/* ---- The same water from the same ground and slabs --------------------------------------------- */

// Hoarding is 64 across and 30 high everywhere. Here a hill falls east 1 m a corner to the flat at x 40, with a hollow on the way down.
const SIZE = 64;
const hill = (x: number, y: number): number => 30 + Math.max(0, 40 - x) * 10 - (x === 20 && y === 20 ? 25 : 0);
const slabs = new Map<string, Slab>([
  // Two tiles poured to 330 and a pool dug in both; one to 310 beside them with a pool; a plain slab to the north.
  ['10,20', { top: 330, pool: true }], ['11,20', { top: 330, pool: true }], ['12,20', { top: 310, pool: true }],
  ['10,19', { top: 330, pool: false }],
  // Out on the flat, a plinth with a pool in it walled in by higher slabs.
  ['50,50', { top: 40, pool: true }], ['51,50', { top: 45, pool: false }], ['49,50', { top: 45, pool: false }],
  ['50,49', { top: 45, pool: false }], ['50,51', { top: 45, pool: false }],
]);
const scenes: Array<[string, number, number]> = [
  ['a cascade of two pools that goes over onto the hill and fills a hollow on the way down', 10, 20],
  ['the same, dug in the other tile of the upper pool', 11, 20],
  ['the lower pool on its own', 12, 20],
  ['a pool walled in by higher slabs', 50, 50],
  ['a spring under a slab with no pool in it', 10, 19],
];
const island = JSON.parse(psql(`
begin;
do $b$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  perform land_set_height(w, x, y, 30 + greatest(0, 40 - x) * 10 - case when x = 20 and y = 20 then 25 else 0 end)
    from generate_series(0, ${SIZE}) x, generate_series(0, ${SIZE}) y;
  delete from foundation where world_id = w;
  insert into foundation (world_id, id, x, y, top, needed, total, pool)
  values ${[...slabs.entries()].map(([k, s], i) => `(w, ${i + 1}, ${k}, ${s.top}, '{"concrete":0}', '{"concrete":1}', ${s.pool})`).join(', ')};
  create temp table answers on commit drop as
    select v.i, settle_chain(w, (spring_corner(w, v.x, v.y))[1], (spring_corner(w, v.x, v.y))[2], v.x, v.y) a
    from (values ${scenes.map(([, x, y], i) => `(${i}, ${x}, ${y})`).join(', ')}) v(i, x, y);
end $b$;
select jsonb_agg(a order by i) from answers;
rollback;`)) as unknown[];
const height = (x: number, y: number): number | null => (x < 0 || y < 0 || x > SIZE || y > SIZE ? null : hill(x, y));
const slabAt = (x: number, y: number): Slab | null => slabs.get(`${x},${y}`) ?? null;
scenes.forEach(([what, tx, ty], i) => {
  const [cx, cy] = springCorner((x, y) => height(x, y) ?? 0, tx, ty);
  const r = settleChain(height, cx, cy, slabAt, [tx, ty]);
  const mine = typeof r === 'string' ? { refused: r } : r;
  say(canon(mine) === canon(island[i]), `${what}: the island and the browser agree -- ${canon(mine).slice(0, 240)}${canon(mine) === canon(island[i]) ? '' : ` | island ${canon(island[i]).slice(0, 240)}`}`);
});
const cascade = settleChain(height, ...springCorner((x, y) => height(x, y) ?? 0, 10, 20), slabAt, [10, 20]);
if (typeof cascade !== 'string') {
  const [upper, lower, hollow] = cascade.ponds;
  say(!!upper?.tiles && upper.tiles.length === 4 && upper.level === 330 - POOL_LIP && upper.spill?.to === lower?.level,
    `the upper pool is both tiles at ${330 - POOL_LIP} and goes over into the lower one at ${lower?.level}`);
  say(!!lower?.tiles && !!lower.spill && lower.spill.to < lower.level && !!hollow && !hollow.tiles && hollow.wet.length > 0,
    `the lower pool goes over onto the hill, ${lower?.spill ? (lower.level - lower.spill.to) / 10 : '?'} m down, and its water fills the hollow at x 20 on the way down`);
}

/* ---- On the island ------------------------------------------------------------------------------ */

const TOP = 60;
const rules = new Map(psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; v_ver int;
begin
  select id into w from world where name = 'Hoarding';
  select uid into me from player where world_id = w and name = 'Crowd2';
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  update player set x = 9.5, y = 40.5, act = null, act_queue = '[]'::jsonb, level = 0 where world_id = w and uid = me;
  delete from spring where world_id = w;
  delete from foundation where world_id = w;
  perform land_set_height(w, x, y, 30) from generate_series(0, 20) x, generate_series(34, 46) y;
  -- A plinth two tiles long poured to ${TOP}, 3 m over the ground.
  insert into foundation (world_id, id, x, y, top, needed, total, made_by) values
    (w, 1, 10, 40, ${TOP}, '{"concrete":0}', '{"concrete":1}', me), (w, 2, 11, 40, ${TOP}, '{"concrete":0}', '{"concrete":1}', me);
  insert into item (world_id, def, holder, holder_uid, ql, count) values
    (w, 'pickaxe', 'player', me, 40, 1), (w, 'trowel', 'player', me, 40, 1), (w, 'shovel', 'player', me, 40, 1);

  insert into said values ('nopick', coalesce(act_refusal(w, me, 'fill_pool', '{"kind":"tile","x":10,"y":40}'), 'none'));
  insert into said values ('dig', coalesce(act_refusal(w, me, 'dig_pool', '{"kind":"tile","x":10,"y":40}'), 'none'));
  perform act_perform(w, me, 'dig_pool', '{"kind":"tile","x":10,"y":40}');
  perform act_perform(w, me, 'dig_pool', '{"kind":"tile","x":11,"y":40}');
  insert into said values ('pools', (select string_agg(pool::text, ',' order by x) from foundation where world_id = w));
  insert into said values ('water', has_water(w, 10, 40)::text || ' ' || water_surface(w, 10, 40) || ' ' || water_depth(w, 10, 40)
    || ' ' || has_water(w, 12, 40)::text);
  insert into said values ('again', coalesce(act_refusal(w, me, 'dig_pool', '{"kind":"tile","x":10,"y":40}'), 'none'));
  update player set x = 10.5, y = 40.5 where world_id = w and uid = me;
  insert into said values ('swim', in_deep_water(w, me)::text);
  update player set x = 9.5, y = 40.5 where world_id = w and uid = me;
  insert into said values ('ground', (select jsonb_agg(f) from jsonb_array_elements(rpc_ground(w, 20)->'foundations') f)::text);

  insert into said values ('spring', coalesce(act_refusal(w, me, 'dig_spring', '{"kind":"tile","x":10,"y":40}'), 'none'));
  perform act_perform(w, me, 'dig_spring', '{"kind":"tile","x":10,"y":40}');
  insert into said values ('chain', (select chain::text from spring where world_id = w));
  insert into said values ('told', (select text from event where world_id = w and uid = me order by n desc limit 1));
  update player set x = 11.5, y = 41.5 where world_id = w and uid = me;
  insert into said values ('second', coalesce(act_refusal(w, me, 'dig_spring', '{"kind":"tile","x":11,"y":40}'), 'none'));
  update player set x = 9.5, y = 40.5 where world_id = w and uid = me;

  insert into said values ('noconcrete', coalesce(act_refusal(w, me, 'fill_pool', '{"kind":"tile","x":10,"y":40}'), 'none'));
  insert into item (world_id, def, holder, holder_uid, ql, count) values (w, 'concrete', 'player', me, 40, ${POOL_FILL});
  perform act_perform(w, me, 'fill_pool', '{"kind":"tile","x":10,"y":40}');
  insert into said values ('filled', (select string_agg(pool::text, ',' order by x) from foundation where world_id = w)
    || ' ' || (select count(*) from spring where world_id = w)
    || ' ' || coalesce((select sum(count) from item where world_id = w and holder_uid = me and def = 'concrete'), 0));
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\\n' order by k) from said;
rollback;`).split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)] as const));
const r = (k: string): string => rules.get(k) ?? '';
say(r('dig') === 'none' && r('pools') === 'true,true', `island: a pool is dug in a poured foundation with a pickaxe, in each tile of the plinth -- ${r('dig')} / ${r('pools')}`);
const [wet, surface, depth, beside] = r('water').split(' ');
say(wet === 'true' && Number(surface) === TOP - POOL_LIP && Number(depth) === POOL_DEPTH - POOL_LIP && beside === 'false',
  `island: it is water ${(POOL_DEPTH - POOL_LIP) / 10} m deep standing at ${TOP - POOL_LIP}, and the ground beside it is not -- ${r('water')}`);
say(r('again') === 'There is a pool here already.', `island: a pool is not dug twice -- ${r('again')}`);
say(r('swim') === 'true', 'island: in a pool, you swim');
say(/"pool": true/.test(r('ground')), 'island: a browser is told which foundations have pools in them');
say(r('spring') === 'none', `island: a spring may be dug in a pool -- ${r('spring')}`);
const chain = JSON.parse(r('chain') || 'null') as { ponds: Array<{ tiles?: number[]; spill?: { to: number }; level: number }>; streams: unknown[] } | null;
say(!!chain && chain.ponds[0].tiles?.length === 4 && chain.ponds[0].spill?.to === 30,
  `island: its pool is both tiles, and it goes over the plinth's edge to the ground at 30 -- ${r('chain').slice(0, 200)}`);
say(/spills over its lowest edge, falling 2\.8 m to the ground/.test(r('told')), `island: the digger is told how far it falls -- "${r('told')}"`);
say(r('second') === 'A spring rises in this pool already.', `island: one spring to a pool -- ${r('second')}`);
say(r('noconcrete') === `Filling it in wants ${POOL_FILL} concrete, and you have 0.`, `island: filling it in wants concrete -- ${r('noconcrete')}`);
say(r('filled') === 'false,true 0 0', `island: filled in with ${POOL_FILL} concrete, the pool is gone and the spring in it with it -- ${r('filled')}`);

/* ---- In the browser ------------------------------------------------------------------------------ */

function browser(): void {
  const g = Game.create(31337, 128);
  const w = g.world;
  const [px, py] = [g.player.tileX, g.player.tileY];
  const bx = px + 2;
  const by = py;
  for (let y = by - 6; y <= by + 6; y++) for (let x = bx - 6; x <= bx + 8; x++) w.setHeight(x, y, 30);
  const act = (id: string): ActionDef => ACTIONS.find((a) => a.id === id) as ActionDef;
  const tile = (x: number, y: number): Target => ({ kind: 'tile', x, y, cx: x, cy: y });
  for (const x of [bx, bx + 1]) {
    const f = g.addFoundation(x, by, TOP, 1);
    f.needed.concrete = 0;
  }
  for (const t of ['pickaxe', 'trowel', 'shovel']) if (!g.inventory.has(t)) g.inventory.add(t, { ql: 40 });
  g.update(0.01);
  const dig = act('dig_pool');
  const could = dig.applies(tile(bx, by), g) && (dig.check?.(tile(bx, by), g) ?? null) === null;
  dig.perform(tile(bx, by), g);
  dig.perform(tile(bx + 1, by), g);
  say(could && !!g.slabAt(bx, by)?.pool && !!g.slabAt(bx + 1, by)?.pool, 'browser: a pool is dug in a poured foundation with a pickaxe');
  say(w.hasWater(bx, by) && w.surfaceAt(bx, by) === TOP - POOL_LIP && waterDepth(g, bx, by) === POOL_DEPTH - POOL_LIP && !w.hasWater(bx + 3, by),
    `browser: it is water ${(POOL_DEPTH - POOL_LIP) / 10} m deep standing at ${TOP - POOL_LIP} (${waterDepth(g, bx, by)}), and the ground beside it is not`);
  g.player.x = bx + 0.5;
  g.player.y = by + 0.5;
  g.player.update(0.01, w, g.movement().rule);
  say(g.player.swimming && g.laidOver(bx, by) === TOP - POOL_LIP - 4, 'browser: in a pool, you swim, with your head out');
  g.player.x = px + 0.5;
  g.player.y = py + 0.5;
  const spring = act('dig_spring');
  const may = spring.applies(tile(bx, by), g) && (spring.check?.(tile(bx, by), g) ?? null) === null;
  spring.perform(tile(bx, by), g);
  const s = [...g.springs.list.values()][0];
  say(may && !!s && s.chain.ponds[0].tiles?.length === 4 && s.chain.ponds[0].spill?.to === 30,
    `browser: a spring dug in it makes its pool both tiles, going over the edge to the ground at 30 -- ${s ? canon(s.chain.ponds[0]).slice(0, 160) : 'none'}`);
  say((spring.check?.(tile(bx + 1, by), g) ?? null) === 'A spring rises in this pool already.', 'browser: one spring to a pool');
  const fill = act('fill_pool');
  const refused = fill.check?.(tile(bx, by), g) ?? null;
  g.inventory.add('concrete', { count: POOL_FILL, ql: 40 });
  fill.perform(tile(bx, by), g);
  g.update(0.01);
  say(/wants \d+ concrete/.test(refused ?? '') && !g.slabAt(bx, by)?.pool && g.springs.list.size === 0 && !w.hasWater(bx, by) && w.hasWater(bx + 1, by),
    `browser: filled in with ${POOL_FILL} concrete, that tile is dry and the spring in it stops, and the tile beside it is still a pool -- "${refused}"`);
}
browser();

console.log(bad ? `${bad} of these are not what they should be` : 'all as they should be');
process.exit(bad ? 1 : 0);
