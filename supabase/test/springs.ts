/**
 * Springs: ponds above the sea, and streams of ponds down to it.
 *
 * Asked for: player-made ponds at any height, and streams made of ponds one
 * below the next, with a waterfall wherever a step down is a tall one.
 *
 * Measured here:
 *
 *   * the island's `settle_chain` and the browser's `settleChain` put the
 *     water in the same places from the same ground, corner for corner: on
 *     the natural hollows of a big island and on terraces dug down a slope;
 *   * a spring is dug through the door, at the bottom of a hollow only, no
 *     more than `SPRINGS_EACH` to a person, and fills its hollow and every
 *     hollow its water runs down into;
 *   * a pond is water to everything that asks: a bucket fills from it, it
 *     has a depth to fish, nothing is built in it, and out of your depth in
 *     one you swim;
 *   * digging its lip lower lets it down to the new lip, and stopping the
 *     spring takes all of its water away.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTIONS, type ActionDef, type Target } from '../../src/game/actions';
import { fishable, waterDepth } from '../../src/game/fishing';
import { packLand, packWorld, unpack } from '../../src/game/save';
import type { IslandSpring } from '../../src/game/springs';
import { settleChain, springCorner, SPRING_REACH, type Chain } from '../../src/world/springs';

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
const tsAnswer = (c: Chain | string): unknown => (typeof c === 'string' ? { refused: c } : c);

/* ---- The same water from the same ground ---------------------------------------------------- */

// A square of a big island, read once: every spring below is far enough inside it that its window is too.
const LO = 200;
const HI = 520;
const region = (): number[][] => psql(`
  select string_agg(r, ';' order by y) from (
    select c.y, (select string_agg(b_i16(c.heights, x)::text, ',' order by x) from generate_series(${LO}, ${HI}) x) r
    from land_corner c join world w on w.id = c.world_id
    where w.name = 'Elsewhere' and c.y between ${LO} and ${HI}) q`).split(';').map((row) => row.split(',').map(Number));

/** Springs at every bottom of a hollow in the square, and at some slopes, well inside it. */
function places(ground: number[][]): Array<[number, number]> {
  const at = (x: number, y: number): number => ground[y - LO][x - LO];
  const out: Array<[number, number]> = [];
  const m = SPRING_REACH + 2;
  for (let y = LO + m; y < HI - m; y++) {
    for (let x = LO + m; x < HI - m; x++) {
      const v = at(x, y);
      if (at(x - 1, y) >= v && at(x + 1, y) >= v && at(x, y - 1) >= v && at(x, y + 1) >= v && (x * 7 + y * 13) % 5 === 0) out.push([x, y]);
    }
  }
  for (let i = 0; i < 12; i++) out.push([LO + m + ((i * 37) % (HI - LO - 2 * m)), LO + m + ((i * 53) % (HI - LO - 2 * m))]);
  return out.slice(0, 80);
}

function compare(label: string, ground: number[][], spots: Array<[number, number]>): void {
  const height = (x: number, y: number): number | null =>
    x < LO || y < LO || x > HI || y > HI ? null : ground[y - LO][x - LO];
  const corners = spots.map(([tx, ty]) => springCorner((x, y) => height(x, y) ?? 0, tx, ty));
  const island = JSON.parse(psql(`
    select coalesce(jsonb_agg(settle_chain(w.id, v.x, v.y) order by v.i), '[]'::jsonb)
    from world w, (values ${corners.map(([x, y], i) => `(${i}, ${x}, ${y})`).join(', ')}) v(i, x, y)
    where w.name = 'Elsewhere'`)) as unknown[];
  let same = 0;
  let ponds = 0;
  let streams = 0;
  let refused = 0;
  let first = '';
  corners.forEach(([sx, sy], i) => {
    const mine = tsAnswer(settleChain(height, sx, sy));
    if (canon(mine) === canon(island[i])) same++;
    else if (!first) first = `at (${sx}, ${sy}): browser ${canon(mine).slice(0, 300)} | island ${canon(island[i]).slice(0, 300)}`;
    const c = mine as Chain & { refused?: string };
    if (c.refused) refused++;
    else {
      ponds += c.ponds.length;
      streams += c.streams.length;
    }
  });
  say(same === corners.length,
    `${label}: the island and the browser settle ${same} of ${corners.length} springs the same (${ponds} ponds, ${streams} streams, ${refused} refused)${first ? ` -- first difference ${first}` : ''}`);
}

const ground = region();
compare('on the hollows of a big island', ground, places(ground));

/*
 * And on ground dug for it, in one go with the settling so the island reads
 * what was dug: a bowl, and a hillside cut into terraces one below the next
 * with a hollow dug in each, some steps short and some a drop, running out to
 * low ground.
 */
const BOWL: [number, number] = [300, 300];
const STAIR: [number, number] = [330, 360];
function dug(): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const at = (x: number, y: number): number => ground[y - LO][x - LO];
  // The bowl: the ground round a point let down, deepest in the middle.
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= 4) out.push([BOWL[0] + dx, BOWL[1] + dy, at(BOWL[0] + dx, BOWL[1] + dy) - Math.round((4 - d) * 6)]);
    }
  }
  // The terraces: eight steps along x, each a hollow two corners wide inside
  // raised walls, the steps alternately short and tall, then low ground.
  let top = 400;
  for (let k = 0; k < 8; k++) {
    for (let i = 0; i < 4; i++) {
      for (let j = -3; j <= 3; j++) {
        const x = STAIR[0] + k * 4 + i;
        const y = STAIR[1] + j;
        const wall = Math.abs(j) === 3 ? 60 : 0;
        const hollow = (i === 1 || i === 2) && Math.abs(j) <= 1 ? 8 : 0;
        out.push([x, y, top + wall - hollow]);
      }
    }
    top -= k % 2 ? 40 : 12;
  }
  for (let i = 0; i < 6; i++) for (let j = -3; j <= 3; j++) out.push([STAIR[0] + 32 + i, STAIR[1] + j, top - 30 - i * 10]);
  return out;
}
const writes = dug();
const tsGround = ground.map((row) => row.slice());
for (const [x, y, v] of writes) tsGround[y - LO][x - LO] = v;
const DUG_SPOTS: Array<[number, number]> = [[BOWL[0] - 1, BOWL[1] - 1], [BOWL[0], BOWL[1]], [STAIR[0] + 1, STAIR[1]], [STAIR[0] + 5, STAIR[1] - 1], [STAIR[0] + 17, STAIR[1]]];
function compareDug(): void {
  const height = (x: number, y: number): number | null => (x < LO || y < LO || x > HI || y > HI ? null : tsGround[y - LO][x - LO]);
  const corners = DUG_SPOTS.map(([tx, ty]) => springCorner((x, y) => height(x, y) ?? 0, tx, ty));
  const island = JSON.parse(psql(`
    begin;
    select count(land_set_height(w.id, v.x, v.y, v.h)) from world w, (values ${writes.map(([x, y, v]) => `(${x}, ${y}, ${v})`).join(', ')}) v(x, y, h)
      where w.name = 'Elsewhere' \\g /dev/null
    select coalesce(jsonb_agg(settle_chain(w.id, v.x, v.y) order by v.i), '[]'::jsonb)
    from world w, (values ${corners.map(([x, y], i) => `(${i}, ${x}, ${y})`).join(', ')}) v(i, x, y)
    where w.name = 'Elsewhere';
    rollback;`)) as unknown[];
  let same = 0;
  let first = '';
  const shapes: string[] = [];
  corners.forEach(([sx, sy], i) => {
    const mine = tsAnswer(settleChain(height, sx, sy));
    if (canon(mine) === canon(island[i])) same++;
    else if (!first) first = `at (${sx}, ${sy}): browser ${canon(mine).slice(0, 400)} | island ${canon(island[i]).slice(0, 400)}`;
    const c = mine as Chain & { refused?: string };
    shapes.push(c.refused ? c.refused : `${c.ponds.length} ponds (${c.ponds.map((p) => `${p.level - p.floor} deep`).join(', ')}), ${c.streams.map((s) => `${s.from}->${s.to}`).join(' ')}`);
  });
  say(same === corners.length, `on dug ground: the island and the browser settle ${same} of ${corners.length} springs the same -- ${shapes.join(' | ')}${first ? ` -- first difference ${first}` : ''}`);
}
compareDug();

/* ---- The island: through the door ------------------------------------------------------------ */

/*
 * A plateau at 20 m on a small island, with a bowl dug into it 2 m deep in
 * the middle, next to a person holding a shovel. Everything in one go, rolled
 * back at the end; what happened is written into `said` and read out.
 */
const PLATEAU = 200;
const island = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w uuid; me uuid; them uuid; v_id bigint; v_ver int; v_n int; v_chain jsonb; r jsonb;
begin
  select id into w from world where name = 'Hoarding';
  select uid into me from player where world_id = w and name = 'Crowd2';
  select uid into them from player where world_id = w and name = 'Crowd3';
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  update player set x = 48.5, y = 12.5, act = null, act_queue = '[]'::jsonb, level = 0 where world_id = w and uid in (me, them);
  delete from spring where world_id = w;
  insert into item (world_id, def, holder, holder_uid, ql, count) select w, 'shovel', 'player', u, 40, 1 from unnest(array[me, them]) u;
  -- The plateau, and the bowl in it: its middle corner 2 m down, the ring round it 1 m down.
  perform land_set_height(w, x, y, ${PLATEAU}) from generate_series(42, 58) x, generate_series(6, 20) y;
  perform land_set_height(w, x, y, ${PLATEAU - 10}) from generate_series(49, 51) x, generate_series(11, 13) y;
  perform land_set_height(w, 50, 12, ${PLATEAU - 20});

  insert into said values ('flat', coalesce(act_refusal(w, me, 'dig_spring', '{"kind":"tile","x":47,"y":11}'), 'none'));
  insert into said values ('ok', coalesce(act_refusal(w, me, 'dig_spring', '{"kind":"tile","x":49,"y":11}'), 'none'));
  perform act_perform(w, me, 'dig_spring', '{"kind":"tile","x":49,"y":11}');
  select id, ver, chain into v_id, v_ver, v_chain from spring where world_id = w;
  insert into said values ('chain', v_chain::text);
  insert into said values ('tiles', (select count(*)::text from spring_tile where spring_id = v_id));
  insert into said values ('wet', has_water(w, 49, 11)::text || ' ' || water_surface(w, 49, 11) || ' ' || water_depth(w, 49, 11));
  insert into said values ('dry', has_water(w, 45, 9)::text || ' ' || water_depth(w, 45, 9));
  insert into said values ('again', coalesce(act_refusal(w, me, 'dig_spring', '{"kind":"tile","x":49,"y":11}'), 'none'));
  insert into said values ('told', (select text from event where world_id = w and uid = me order by n desc limit 1));
  -- Standing in it, out of your depth.
  update player set x = 49.5, y = 11.5 where world_id = w and uid = me;
  insert into said values ('swim', in_deep_water(w, me)::text);
  update player set x = 48.5, y = 12.5 where world_id = w and uid = me;
  -- What a browser is sent, and not sent again once it has it.
  r := rpc_springs(w, 40, '{}'::jsonb);
  insert into said values ('sent', (r->'near')::text || ' ' || jsonb_array_length(r->'chains'));
  r := rpc_springs(w, 40, jsonb_build_object(v_id::text, v_ver));
  insert into said values ('resent', jsonb_array_length(r->'chains')::text);
  -- A notch cut in the rim a metre down lets the pond down to it.
  perform land_set_height(w, 52, 12, ${PLATEAU - 15});
  insert into said values ('notched', (select (chain->'ponds'->0->>'level') || ' ' || ver from spring where id = v_id)
                                     || ' ' || (select max(level)::text from spring_tile where spring_id = v_id and pond = 0));
  -- Somebody else cannot stop it up on open ground; whoever dug it can.
  insert into said values ('theirs', coalesce(act_refusal(w, them, 'stop_spring', '{"kind":"tile","x":49,"y":11}'), 'none'));
  insert into said values ('mine', coalesce(act_refusal(w, me, 'stop_spring', '{"kind":"tile","x":49,"y":11}'), 'none'));
  perform act_perform(w, me, 'stop_spring', '{"kind":"tile","x":49,"y":11}');
  insert into said values ('stopped', (select count(*)::text from spring where world_id = w) || ' ' || has_water(w, 49, 11)::text);
  -- Dug again, and then the hollow filled in: the spring stops of itself.
  perform act_perform(w, me, 'dig_spring', '{"kind":"tile","x":49,"y":11}');
  perform land_set_height(w, x, y, ${PLATEAU}) from generate_series(49, 52) x, generate_series(11, 13) y;
  insert into said values ('filled', (select count(*)::text from spring where world_id = w) || ' ' || (select count(*)::text from spring_tile st join spring s on s.id = st.spring_id where s.world_id = w));
  -- No more than so many to a person.
  insert into spring (world_id, x, y, cx, cy, made_by) select w, g, 2, g, 2, me from generate_series(1, springs_each()) g;
  perform land_set_height(w, x, y, ${PLATEAU - 10}) from generate_series(49, 51) x, generate_series(11, 13) y;
  perform land_set_height(w, 50, 12, ${PLATEAU - 20});
  insert into said values ('many', coalesce(act_refusal(w, me, 'dig_spring', '{"kind":"tile","x":49,"y":11}'), 'none'));
end $b$;
select string_agg(k || '=' || coalesce(v, 'null'), E'\\n' order by k) from said;
rollback;`);
const said = new Map(island.split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const chain = JSON.parse(said.get('chain') ?? 'null') as IslandSpring['chain'] | null;
say(/run straight off downhill/.test(said.get('flat') ?? ''), `island: level ground holds no spring -- "${said.get('flat')}"`);
say(said.get('ok') === 'none', `island: the bottom of a hollow does -- ${said.get('ok')}`);
say(!!chain && chain.ponds[0]?.level === PLATEAU && chain.ponds[0]?.floor === PLATEAU - 20,
  `island: digging it fills the bowl to its rim, ${PLATEAU} over a floor of ${PLATEAU - 20}: ${chain ? `level ${chain.ponds[0]?.level}, floor ${chain.ponds[0]?.floor}, ${chain.ponds.length} pond(s), ${chain.streams.length} stream(s)` : 'nothing'}`);
say(!!chain && chain.ponds.every((p) => typeof p.from === 'number' && !Number.isNaN(Date.parse(p.since ?? ''))), 'island: and says for each pond what it rises from and when');
say(Number(said.get('tiles')) >= 4, `island: the tiles it covers are kept for the questions asked of one tile -- ${said.get('tiles')}`);
const [wet, surface, depth] = (said.get('wet') ?? '').split(' ');
say(wet === 'true' && Number(surface) === PLATEAU && Number(depth) > 0, `island: a pond is water, with its own surface and a depth under it -- ${said.get('wet')}`);
say(said.get('dry')?.startsWith('false') === true, `island: and the plateau round it is not -- ${said.get('dry')}`);
say(said.get('again') === 'There is water here already.', `island: a second spring is not dug in a pond -- ${said.get('again')}`);
say(/Water wells up/.test(said.get('told') ?? ''), `island: the digger is told how deep it will stand and where it runs -- "${said.get('told')}"`);
say(said.get('swim') === 'true', 'island: out of your depth in a pond, you swim');
say(/"id"/.test(said.get('sent') ?? '') && said.get('sent')?.endsWith(' 1') === true && said.get('resent') === '0',
  `island: a browser is sent the springs near it, and a chain only when it has not got it -- ${said.get('sent')}, then ${said.get('resent')}`);
const [notched, notchVer, notchTile] = (said.get('notched') ?? '').split(' ');
say(Number(notched) === PLATEAU - 10 && Number(notchVer) > 1 && Number(notchTile) === PLATEAU - 10,
  `island: a notch cut in the rim lets the pond down to the lowest of the ring, ${PLATEAU - 10} -- ${said.get('notched')}`);
say(said.get('theirs') === 'Only whoever dug this spring may stop it up.', `island: somebody else cannot stop it up on open ground -- ${said.get('theirs')}`);
say(said.get('mine') === 'none' && said.get('stopped') === '0 false', `island: whoever dug it can, and its water goes with it -- ${said.get('stopped')}`);
say(said.get('filled') === '0 0', `island: filling the hollow in stops the spring and takes its water -- ${said.get('filled')}`);
say(/You keep \d+ springs already/.test(said.get('many') ?? ''), `island: no more than a few springs to a person -- ${said.get('many')}`);

/* ---- The browser: the same rules, on a game of its own -------------------------------------- */

async function browser(): Promise<void> {
  const g = Game.create(31337, 128);
  const w = g.world;
  const [px, py] = [g.player.tileX, g.player.tileY];
  // The same plateau and bowl, beside where the player stands.
  const bx = px + 2;
  const by = py;
  for (let y = by - 7; y <= by + 7; y++) for (let x = bx - 7; x <= bx + 8; x++) w.setHeight(x, y, PLATEAU);
  for (let y = by - 1; y <= by + 1; y++) for (let x = bx - 1; x <= bx + 1; x++) w.setHeight(x, y, PLATEAU - 10);
  w.setHeight(bx, by, PLATEAU - 20);
  g.update(0.01);
  const act = (id: string): ActionDef => ACTIONS.find((a) => a.id === id) as ActionDef;
  const tile = (x: number, y: number): Target => ({ kind: 'tile', x, y, cx: x, cy: y });
  if (!g.inventory.has('shovel')) g.inventory.add('shovel', { ql: 40 });
  const flat = act('dig_spring').check?.(tile(bx - 4, by - 4), g) ?? null;
  const here = tile(bx - 1, by - 1);
  const ok = act('dig_spring').check?.(here, g) ?? null;
  act('dig_spring').perform(here, g);
  const s = [...g.springs.list.values()][0];
  say(/run straight off downhill/.test(flat ?? '') && ok === null && !!s && s.chain.ponds[0].level === PLATEAU,
    `browser: level ground holds no spring, the bottom of a hollow does, and it fills to the rim at ${PLATEAU}: ${s ? `level ${s.chain.ponds[0].level}` : `refused "${ok}"`}`);
  const deep = waterDepth(g, bx - 1, by - 1);
  say(w.hasWater(bx - 1, by - 1) && w.surfaceAt(bx - 1, by - 1) === PLATEAU && deep > 0 && fishable(g, bx - 1, by - 1) && !w.hasWater(bx - 5, by - 5),
    `browser: a pond is water, with a surface and a depth to fish (${deep}), and the plateau is not`);
  say(!w.hasSea(bx - 1, by - 1) && !g.launchSpot('rowboat', bx - 1, by - 1), 'browser: but it is not the sea, and no hull is launched into it');
  say((act('dig_spring').check?.(here, g) ?? null) === 'There is water here already.', 'browser: a second spring is not dug in a pond');
  // Standing in it, out of your depth.
  g.player.x = bx - 0.5;
  g.player.y = by - 0.5;
  g.player.update(0.01, w, g.movement().rule);
  say(g.player.swimming, 'browser: out of your depth in a pond, you swim');
  // A notch cut in the rim: settled again at the end of the turn, down to the ring.
  w.setHeight(bx + 2, by, PLATEAU - 15);
  g.update(0.01);
  say(s.chain.ponds[0].level === PLATEAU - 10 && w.surfaceAt(bx - 1, by - 1) === PLATEAU - 10, `browser: a notch cut in the rim lets the pond down to ${PLATEAU - 10}: ${s.chain.ponds[0].level}`);
  // Kept in a save, and settled again from the ground when it comes back.
  const back = await unpack(await packLand(g), packWorld(g));
  const again = back ? [...back.springs.list.values()][0] : undefined;
  say(!!again && again.x === s.x && again.y === s.y && canon(again.chain) === canon(s.chain) && back?.world.hasWater(bx - 1, by - 1) === true,
    'browser: a save keeps the spring, and its water is the same when the game comes back');
  // Filled in, it stops of itself.
  for (let y = by - 1; y <= by + 1; y++) for (let x = bx - 1; x <= bx + 2; x++) w.setHeight(x, y, PLATEAU);
  g.update(0.01);
  say(g.springs.list.size === 0 && !w.hasWater(bx - 1, by - 1), 'browser: filling the hollow in stops the spring and takes its water');
  // Dug again and stopped up.
  for (let y = by - 1; y <= by + 1; y++) for (let x = bx - 1; x <= bx + 1; x++) w.setHeight(x, y, PLATEAU - 10);
  w.setHeight(bx, by, PLATEAU - 20);
  g.update(0.01);
  act('dig_spring').perform(here, g);
  const stop = act('stop_spring');
  const could = stop.applies(here, g) && (stop.check?.(here, g) ?? null) === null;
  stop.perform(here, g);
  say(could && g.springs.list.size === 0 && !w.hasWater(bx - 1, by - 1), 'browser: stopping a spring up takes all its water away');
}
await browser();

console.log(bad ? `${bad} of these are not what they should be` : 'all as they should be');
process.exit(bad ? 1 : 0);
