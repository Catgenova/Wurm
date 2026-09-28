/**
 * A flight of garden steps is the same flight on both sides.
 *
 * Everything a flight decides is written twice -- `stepsFit`, the three doors
 * of `STEPS_ACTIONS`, `standsOn` and `groundStep` and `Game.driveRule` in the
 * browser; `steps_fit`, `steps_refusal` and `perform_steps`, `walk_share`,
 * `creature_tile_ok` and `walk_climbs` on the island -- because a solo world
 * lays and walks one by the browser's rules and an island by its own. So the
 * same ground is put to both:
 *
 *   * a dozen shapes of tile, and whether each takes a flight and why not;
 *   * the doors of laying one in stone and in timber, one missing thing at a
 *     time, and of taking one up;
 *   * a flight laid on each side with every roll passing, and what it spent,
 *     what it wrote in the tile, and what came back when it was taken up;
 *   * walking onto a flight at eighty and onto bare ground at eighty, off it
 *     onto a landing, and with a cart; a wild thing standing on each; and
 *     whether a step onto one teaches any climbing;
 *   * and every stone's and every wood's name.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on
 * it. Everything it does there is rolled back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID } from '../../src/game/actions';
import { onSteps } from '../../src/game/player';
import {
  SLAB_VARIANTS, STEPS_BRICKS, STEPS_LEAST, STEPS_MORTAR, STEPS_MOST, STEPS_NAILS, STEPS_PLANKS, STEPS_SLABS,
  STEPS_TIMBER, STEPS_TWIST, TREE_DEFS, TileType, stepsFit, stepsGroundRefusal, stepsName,
} from '../../src/world/tiles';
import { STEPS_BACK, stepsBack } from '../../src/game/steps';
import type { Target } from '../../src/game/actions';

const psql = (sql: string): string =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
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
const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
/** The island's answers, one `tag|value` a line, read back out of a temp table before everything is rolled back. */
const said = (lines: string, tag: string): string =>
  lines.split('\n').map((l) => l.trim()).find((l) => l.startsWith(`${tag}|`))?.slice(tag.length + 1) ?? '(nothing)';

/** The tile everything is tried on, the landing south of it, and the bare slope west of it. */
const X = 52, Y = 52;

const game = Game.create(4242);
const w = game.world;

/* ---- the shape of the ground ---------------------------------------------- */

/** Corners north-west, north-east, south-east, south-west. */
const SHAPES: Array<[string, [number, number, number, number]]> = [
  ['level ground', [20, 20, 20, 20]],
  ['a rise of nine', [29, 29, 20, 20]],
  [`a rise of ${STEPS_LEAST} to the north`, [30, 30, 20, 20]],
  ['a rise of forty to the east', [20, 60, 60, 20]],
  [`a rise of ${STEPS_MOST} to the south`, [20, 20, 100, 100]],
  [`a rise of ${STEPS_MOST + 1} to the west`, [101, 20, 20, 101]],
  [`a rise twisted by ${STEPS_TWIST}`, [60, 60 + STEPS_TWIST, 20, 20]],
  [`a rise twisted by ${STEPS_TWIST + 1}`, [60, 60 + STEPS_TWIST + 1, 20, 20]],
  ['a corner raised on its own', [20, 60, 20, 20]],
  ['a plane tilted both ways', [20, 40, 60, 40]],
  ['a rise to the west, out of level by three at its head', [60, 20, 20, 57]],
  ['a hollow', [40, 40, 20, 40]],
];
const island = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; s record; f record;
begin
  select id into w from world where name = 'Hoarding';
  for s in select * from (values ${SHAPES.map(([, c], i) => `(${i}, ${c.join(', ')})`).join(', ')}) v(i, nw, ne, se, sw) loop
    perform land_set_height(w, ${X}, ${Y}, s.nw);
    perform land_set_height(w, ${X + 1}, ${Y}, s.ne);
    perform land_set_height(w, ${X + 1}, ${Y + 1}, s.se);
    perform land_set_height(w, ${X}, ${Y + 1}, s.sw);
    select * into f from steps_fit(w, ${X}, ${Y});
    insert into said values ('SHAPE' || s.i || '|' || f.up || ' ' || f.rise || ' ' || f.twist || ' ' || f.slope || ' '
      || coalesce(steps_ground_refusal(w, ${X}, ${Y}), 'ALLOWED'));
  end loop;
end $$;
select k from said;
rollback;`);
let shapes = 0;
SHAPES.forEach(([name, c], i) => {
  const f = stepsFit(c);
  const mine = `${f.up} ${f.rise} ${f.twist} ${f.slope} ${stepsGroundRefusal(c) ?? 'ALLOWED'}`;
  const theirs = said(island, `SHAPE${i}`);
  if (mine === theirs) shapes++;
  check(`${name} is read the same on both sides`, mine === theirs, `browser "${mine}", island "${theirs}"`);
});
check('and that is every shape', shapes === SHAPES.length, `${shapes} of ${SHAPES.length}`);

/* ---- the doors ------------------------------------------------------------- */

/** The ground under the doors: the tile at X, Y rising `rise` to the north, the tile south of it a landing, all soil. */
const ground = (rise: number, tile: number): { browser: () => void; sql: string } => ({
  browser: () => {
    for (let y = Y - 2; y <= Y + 3; y++) for (let x = X - 2; x <= X + 3; x++) {
      w.setHeight(x, y, y <= Y ? 20 + rise : 20);
      w.setDirt(x, y, 5);
    }
    for (let y = Y - 1; y <= Y + 2; y++) for (let x = X - 1; x <= X + 2; x++) w.setTile(x, y, TileType.Grass, 0);
    w.setTile(X, Y, tile as TileType, 0);
    w.setTile(X, Y + 1, TileType.PackedDirt, 0);
  },
  sql: `
    for gy in ${Y - 2}..${Y + 3} loop for gx in ${X - 2}..${X + 3} loop
      perform land_set_height(w, gx, gy, case when gy <= ${Y} then ${20 + rise} else 20 end);
      perform land_set_dirt(w, gx, gy, 5);
    end loop; end loop;
    for gy in ${Y - 1}..${Y + 2} loop for gx in ${X - 1}..${X + 2} loop
      perform land_set_tile(w, gx, gy, 0); perform land_set_data(w, gx, gy, 0);
    end loop; end loop;
    perform land_set_tile(w, ${X}, ${Y}, ${tile});
    perform land_set_tile(w, ${X}, ${Y + 1}, 2);`,
});
/** What Dane carries, on both sides: an id, a count and a wood. */
type Pack = Array<[string, number, string?]>;
const packBrowser = (pack: Pack): void => {
  game.inventory.items.length = 0;
  for (const [id, count, extra] of pack) game.inventory.add(id, { count, ql: 50, extra });
};
const packSql = (pack: Pack): string => `
    delete from item where world_id = w and holder = 'player' and holder_uid = u;
    ${pack.map(([id, count, extra]) => `perform give(w, u, ${q(id)}, ${count}, 50, ${extra ? q(extra) : 'null'});`).join('\n    ')}`;

const STONE: Pack = [['trowel', 1], ['marble_slab', STEPS_SLABS], ['marble_brick', STEPS_BRICKS], ['mortar', STEPS_MORTAR]];
const TIMBER: Pack = [['mallet', 1], ['plank', STEPS_PLANKS, 'Oak'], ['plank', 4, 'Pine'], ['nail', STEPS_NAILS]];
/** Each case: what it is, the rise of the tile, what it is, the action, what is carried. */
const DOORS: Array<[string, number, number, string, Pack]> = [
  ['stone steps on grass', 40, TileType.Grass, 'lay_steps', STONE],
  ['stone steps on packed ground too flat for them', STEPS_LEAST - 1, TileType.PackedDirt, 'lay_steps', STONE],
  [`stone steps on packed ground rising ${STEPS_MOST}`, STEPS_MOST, TileType.PackedDirt, 'lay_steps', STONE],
  ['stone steps with no trowel', 40, TileType.PackedDirt, 'lay_steps', STONE.filter(([id]) => id !== 'trowel')],
  ['stone steps a brick short', 40, TileType.PackedDirt, 'lay_steps', STONE.map(([id, n]) => [id, id === 'marble_brick' ? n - 1 : n] as [string, number])],
  ['stone steps with bricks of another stone', 40, TileType.PackedDirt, 'lay_steps', STONE.map(([id, n]) => [id === 'marble_brick' ? 'slate_brick' : id, n] as [string, number])],
  ['stone steps with no mortar', 40, TileType.PackedDirt, 'lay_steps', STONE.filter(([id]) => id !== 'mortar')],
  ['stone steps with all of it', 40, TileType.PackedDirt, 'lay_steps', STONE],
  ['timber steps with all of it', 40, TileType.PackedDirt, 'lay_timber_steps', TIMBER],
  ['timber steps with no mallet', 40, TileType.PackedDirt, 'lay_timber_steps', TIMBER.filter(([id]) => id !== 'mallet')],
  ['timber steps with planks of two woods', 40, TileType.PackedDirt, 'lay_timber_steps', [['mallet', 1], ['plank', STEPS_PLANKS - 2, 'Oak'], ['plank', 4, 'Pine'], ['nail', STEPS_NAILS]]],
  ['timber steps too few nails', 40, TileType.PackedDirt, 'lay_timber_steps', TIMBER.map(([id, n, e]) => [id, id === 'nail' ? n - 1 : n, e] as [string, number, string?])],
  ['taking up steps that are not there', 40, TileType.PackedDirt, 'take_up_steps', [['pickaxe', 1]]],
  ['taking up steps with no pickaxe', 40, TileType.Steps, 'take_up_steps', []],
  ['taking up steps', 40, TileType.Steps, 'take_up_steps', [['pickaxe', 1]]],
];
const doorSql = DOORS.map(([, rise, tile, action, pack], i) => `
    ${ground(rise, tile).sql}
    ${packSql(pack)}
    insert into said values ('DOOR${i}|' || coalesce(act_refusal(w, u, ${q(action)}, jsonb_build_object('kind', 'tile', 'x', ${X}, 'y', ${Y}, 'cx', ${X}, 'cy', ${Y})), 'ALLOWED'));`).join('\n');
const doors = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid; gx int; gy int;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  update player set x = ${X}.5, y = ${Y}.5, level = 0 where world_id = w and uid = u;
  ${doorSql}
end $$;
select k from said;
rollback;`);
let agreed = 0;
DOORS.forEach(([name, rise, tile, action, pack], i) => {
  ground(rise, tile).browser();
  packBrowser(pack);
  const def = ACTION_BY_ID.get(action);
  const t: Target = { kind: 'tile', x: X, y: Y, cx: X, cy: Y };
  const mine = def?.check?.(t, game) ?? 'ALLOWED';
  const theirs = said(doors, `DOOR${i}`);
  if (mine === theirs) agreed++;
  check(`${name}: the same answer on both sides`, mine === theirs, `browser "${mine}", island "${theirs}"`);
});
check('and that is every door', agreed === DOORS.length, `${agreed} of ${DOORS.length}`);

/* ---- laid, and taken up again ---------------------------------------------- */

/** Every roll passes, on both sides, for the length of it. */
game.skillCheck = () => true;
const counts = (): string => [...new Set(game.inventory.items.map((it) => `${it.id}${it.extra ? `:${it.extra}` : ''}`))].sort()
  .map((k) => `${k}=${game.inventory.items.filter((it) => `${it.id}${it.extra ? `:${it.extra}` : ''}` === k).reduce((n, it) => n + it.count, 0)}`).join(',');
const countsSql = `(select coalesce(string_agg(k || '=' || n, ',' order by k), '') from (
    select i.def || coalesce(':' || i.extra, '') k, sum(i.count) n from item i
     where i.world_id = w and i.holder = 'player' and i.holder_uid = u group by 1) q)`;
const run = (action: string, target: Target): void => {
  const def = ACTION_BY_ID.get(action);
  if (def && !def.check?.(target, game)) def.perform(target, game);
};
const tileT: Target = { kind: 'tile', x: X, y: Y, cx: X, cy: Y };
const rounds: Array<[string, string, Pack]> = [
  ['stone', 'lay_steps', [...STONE, ['pickaxe', 1]]],
  ['timber', 'lay_timber_steps', [...TIMBER, ['pickaxe', 1]]],
];
for (const [kind, action, pack] of rounds) {
  const theirs = psql(`
begin;
create temp table said (k text);
create or replace function skill_check(p_skill double precision, p_difficulty double precision,
   p_tool_ql double precision default 0, p_ease double precision default 0) returns boolean language sql as 'select true';
do $$
declare w uuid; u uuid; gx int; gy int;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  update player set x = ${X}.5, y = ${Y + 1}.5, level = 0 where world_id = w and uid = u;
  ${ground(40, TileType.PackedDirt).sql}
  ${packSql(pack)}
  perform act_perform(w, u, ${q(action)}, jsonb_build_object('kind', 'tile', 'x', ${X}, 'y', ${Y}, 'cx', ${X}, 'cy', ${Y}));
  insert into said values ('LAID|' || land_tile(w, ${X}, ${Y}) || ' ' || land_data(w, ${X}, ${Y}) || ' ' || ${countsSql});
  perform act_perform(w, u, 'take_up_steps', jsonb_build_object('kind', 'tile', 'x', ${X}, 'y', ${Y}, 'cx', ${X}, 'cy', ${Y}));
  insert into said values ('UP|' || land_tile(w, ${X}, ${Y}) || ' ' || land_data(w, ${X}, ${Y}) || ' ' || ${countsSql});
end $$;
select k from said;
rollback;`);
  ground(40, TileType.PackedDirt).browser();
  packBrowser(pack);
  run(action, tileT);
  const laid = `${w.getTile(X, Y)} ${w.getData(X, Y)} ${counts()}`;
  run('take_up_steps', tileT);
  const up = `${w.getTile(X, Y)} ${w.getData(X, Y)} ${counts()}`;
  check(`a flight laid in ${kind} is the same flight, and spends the same`, laid === said(theirs, 'LAID'), `browser "${laid}", island "${said(theirs, 'LAID')}"`);
  check(`and taken up it leaves the same ground and gives back the same`, up === said(theirs, 'UP'), `browser "${up}", island "${said(theirs, 'UP')}"`);
}
check(`stone comes up ${stepsBack(STEPS_SLABS)} of ${STEPS_SLABS} slabs and ${stepsBack(STEPS_BRICKS)} of ${STEPS_BRICKS} bricks, timber ${stepsBack(STEPS_PLANKS)} of ${STEPS_PLANKS} planks`,
  stepsBack(STEPS_SLABS) === Math.floor(STEPS_SLABS * STEPS_BACK) && stepsBack(STEPS_PLANKS) === Math.floor(STEPS_PLANKS * STEPS_BACK));

/* ---- walking on it ---------------------------------------------------------- */

/**
 * The flight at X, Y rising `rise` to the north with a landing south of it at
 * 20 and one north of it at the head, and a bare tile the same shape at X - 2.
 */
const slope = (rise: number): { browser: () => void; sql: string } => ({
  browser: () => {
    for (let y = Y - 3; y <= Y + 3; y++) for (let x = X - 4; x <= X + 3; x++) {
      w.setHeight(x, y, y <= Y ? 20 + rise : 20);
      w.setDirt(x, y, 5);
      w.setTile(x, y, TileType.Grass, 0);
    }
    w.setTile(X, Y, TileType.Steps, 2);
  },
  sql: `
    for gy in ${Y - 3}..${Y + 3} loop for gx in ${X - 4}..${X + 3} loop
      perform land_set_height(w, gx, gy, case when gy <= ${Y} then ${20 + rise} else 20 end);
      perform land_set_dirt(w, gx, gy, 5);
      perform land_set_tile(w, gx, gy, 0); perform land_set_data(w, gx, gy, 0);
    end loop; end loop;
    perform land_set_tile(w, ${X}, ${Y}, ${TileType.Steps}); perform land_set_data(w, ${X}, ${Y}, 2);`,
});
/** Each walk: what it is, from and to, in tiles. */
const WALKS: Array<[string, [number, number], [number, number]]> = [
  ['up onto the flight from its foot', [X, Y + 1], [X, Y]],
  ['up off the flight onto its head', [X, Y], [X, Y - 1]],
  ['down onto the flight from its head', [X, Y - 1], [X, Y]],
  ['down off it to its foot', [X, Y], [X, Y + 1]],
  ['up the same bare slope beside it', [X - 2, Y + 1], [X - 2, Y]],
  ['across from the bare slope onto the flight', [X - 1, Y], [X, Y]],
];
for (const rise of [64, STEPS_MOST, STEPS_MOST + 8]) {
  const s = slope(rise);
  const walkSql = WALKS.map(([, a, c], i) => `
    insert into said values ('WALK${i}|' || (walk_share(w, u, 0, ${a[0]}.5, ${a[1]}.5, ${c[0]}.5, ${c[1]}.5) >= 1)
      || ' ' || coalesce(array_length(walk_climbs(w, ${a[0]}.5, ${a[1]}.5, ${c[0]}.5, ${c[1]}.5), 1), 0));`).join('');
  const theirs = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid; gx int; gy int;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  delete from skill where world_id = w and uid = u and id = 'climbing';
  ${s.sql}
  ${walkSql}
  insert into said values ('BEAST|' || creature_tile_ok(w, ${X}, ${Y}) || ' ' || creature_tile_ok(w, ${X - 2}, ${Y}));
  -- And a cart on the reins.
  insert into placed (world_id, kind, sub, x, y, cx, cy, ql, made_by, driver)
    values (w, 'furniture', 'large_cart', ${X}, ${Y + 1}, ${X}.5, ${Y + 1}.5, 30, u, u);
  insert into said values ('CART|' || (walk_share(w, u, 0, ${X}.5, ${Y + 1}.5, ${X}.5, ${Y}.5) >= 1)
    || ' ' || (walk_share(w, u, 0, ${X}.5, ${Y + 1}.5, ${X + 1}.5, ${Y + 1}.5) >= 1));
end $$;
select k from said;
rollback;`);
  s.browser();
  game.skills.values.set('climbing', 0);
  WALKS.forEach(([name, a, c], i) => {
    const walks = game.stepRule(a[0], a[1], 0, c[0], c[1]) !== null;
    // A step between tiles counts toward climbing unless it is on or off a flight (`tryMove`, `walk_climbs`).
    const climbs = onSteps(w, a[0], a[1], c[0], c[1]) ? 0 : 1;
    const [iw, ic] = said(theirs, `WALK${i}`).split(' ');
    check(`at ${rise}, ${name}: ${walks ? 'walked' : 'refused'} on both sides`, String(walks) === iw, `browser ${walks}, island ${iw}`);
    check(`at ${rise}, ${name}: ${climbs ? 'a climb' : 'no climb'} on both sides`, String(climbs) === ic, `browser ${climbs}, island ${ic}`);
  });
  const beast = `${game.creatures.tileOk(game, X, Y)} ${game.creatures.tileOk(game, X - 2, Y)}`;
  check(`at ${rise}, a wild thing stands on the flight and on the bare slope the same on both sides`, beast === said(theirs, 'BEAST'), `browser ${beast}, island ${said(theirs, 'BEAST')}`);
  // A cart on the reins: onto the flight, and along the landing.
  const cart = game.addFurniture('large_cart', X, Y + 1, 0, 0, 30);
  cart.driven = true;
  const drives = `${game.driveRule(X, Y + 1, 0, X, Y) !== null} ${game.driveRule(X, Y + 1, 0, X + 1, Y + 1) !== null}`;
  game.removeFurniture(cart.id);
  check(`at ${rise}, a cart is refused the flight and driven along the landing on both sides`, drives === said(theirs, 'CART'), `browser ${drives}, island ${said(theirs, 'CART')}`);
}

/* ---- names ------------------------------------------------------------------ */

const datas = [...SLAB_VARIANTS.map((_, i) => i), ...TREE_DEFS.map((_, i) => STEPS_TIMBER | i)];
const names = psql(`select string_agg(steps_name(d), '|' order by o) from unnest(array[${datas.join(', ')}]) with ordinality v(d, o)`);
const mine = datas.map((d) => stepsName(d)).join('|');
check(`every stone's and every wood's flight has the same name (${datas.length})`, names === mine, `browser ${mine}, island ${names}`);

for (const line of ok) console.log(line);
for (const line of bad) console.log(line);
console.log(bad.length === 0 ? `a flight of garden steps is the same flight on both sides (${ok.length} agreements)` : `THEY DISAGREE (${bad.length})`);
process.exit(bad.length === 0 ? 0 : 1);
