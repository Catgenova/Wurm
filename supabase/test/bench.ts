/**
 * What the bench gives back, and what a click is worth.
 *
 * Three reports in one message, and all three are about the moment a go ends:
 *
 *   "free body control gains from examining as well as keeping/putting back
 *    items"
 *   "my bronze anvil isn't letting me improve it saying that i need bronze,
 *    but i have 37 bronze lumps on me ... actually it looks like everything i
 *    try to improve is telling me that"
 *   "i've made a lot of whetstones and haven't managed anything other than
 *    QL 1, even got a rare QL 1"
 *
 * The first is a list nobody could keep up with, the second is a column read
 * where an item's own name was the answer, and the third is a miss that paid
 * nothing. Each is measured here rather than eyeballed, and the middle one is
 * put to the island as well, because that is the side it was reported from and
 * the side that had it wrong.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { execFileSync } from 'node:child_process';
import { ACTIONS, ACTION_BY_ID, TEACHES_NOTHING } from '../../src/game/actions';
import { Game } from '../../src/game/game';
import { materialOfItem } from '../../src/game/materials';

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
void ACTIONS.length;

/* ---- a click is not work -------------------------------------------------- */
/*
 * Driven rather than reasoned about: the job is asked for and the body's
 * numbers are read before and after, which is the only way to be sure the
 * rule is the one that actually runs.
 */
const bodyAfter = (id: string, target: { kind: 'item'; uid: number } | { kind: 'tile'; x: number; y: number; cx: number; cy: number }): number => {
  const g = Game.create(4242);
  g.player.x = 64.5;
  g.player.y = 64.5;
  const def = ACTION_BY_ID.get(id);
  if (!def) return -1;
  const before = g.skills.get('body_control');
  for (let i = 0; i < 20; i++) {
    g.requestAction(def, target as never);
    for (let t = 0; t < 40 && g.action; t++) g.update(0.25);
  }
  return g.skills.get('body_control') - before;
};

const free = ACTIONS.filter((a) => !TEACHES_NOTHING.has(a.id) && (a.stamina ?? 0) === 0 && (a.baseTime ?? 0) === 0);
check('there are jobs that cost no wind and take no time', free.length > 20,
  `${free.length} of them, among them ${free.slice(0, 3).map((a) => a.id).join(', ')}`);

const g0 = Game.create(4242);
const thing = g0.inventory.items[0];
const examined = bodyAfter('examine_item', { kind: 'item', uid: thing.uid });
const kept = bodyAfter('lock_item', { kind: 'item', uid: thing.uid });
check('twenty goes at examining a thing teach the hands nothing', examined === 0, `${examined.toFixed(6)} of body control`);
check('and twenty at keeping one back teach them nothing either', kept === 0, `${kept.toFixed(6)} of body control`);

/*
 * And real work still does. Where the body actually came ashore, rather than
 * at the middle of the map: the middle of this one is a hundred and forty
 * under the sea, where a shovel is answered with "the water is too deep here
 * to work in" and nothing is measured at all.
 */
const gw = Game.create(4242);
const digDef = ACTION_BY_ID.get('dig')!;
const at = (x: number, y: number) => ({ kind: 'tile', x, y, cx: x, cy: y }) as never;
const [hx, hy] = [Math.floor(gw.player.x), Math.floor(gw.player.y)];
gw.inventory.add('shovel', { ql: 40 });
/*
 * Six separate corners rather than six goes at one, which digs itself into a
 * hole too steep to keep digging and measures five spadefuls and a refusal —
 * and well apart, because a corner taken down a step is shared with the tiles
 * beside it and can make a neighbour too steep to work as well.
 */
const spots: Array<[number, number]> = [];
const apart = (x: number, y: number): boolean =>
  spots.every(([px, py]) => Math.max(Math.abs(px - x), Math.abs(py - y)) >= 3);
for (let r = 0; r < 30 && spots.length < 6; r++) {
  for (let dx = -r; dx <= r && spots.length < 6; dx++) {
    for (const dy of [-r, r]) {
      const [x, y] = [hx + dx, hy + dy];
      if (spots.length >= 6) break;
      if (apart(x, y) && digDef.applies?.(at(x, y), gw) && !digDef.check?.(at(x, y), gw)) spots.push([x, y]);
    }
  }
}
check('there is ground near the landing a shovel will go into', spots.length === 6,
  spots.length ? `${spots.length} corners, the first at ${spots[0][0]},${spots[0][1]} in ${gw.world.tileName(spots[0][0], spots[0][1]).toLowerCase()}` : `nothing within 20 of ${hx},${hy}`);
const before = gw.skills.get('body_control');
gw.log.length = 0;
for (const [x, y] of spots) {
  gw.player.x = x + 0.5;
  gw.player.y = y + 0.5;
  gw.player.stats.stamina = 1;
  gw.requestAction(digDef, at(x, y));
  // A spadeful at a beginner's pace is longer than it looks, and a go that
  // has not finished when the next is asked for goes into the queue rather
  // than being lost — so run the clock until there is nothing in hand.
  for (let t = 0; t < 400 && (gw.action || gw.queue.length); t++) {
    gw.player.stats.stamina = 1;
    gw.update(0.25);
  }
}
const dug = gw.log.filter((l) => l.text.startsWith('You dig up') || l.text.startsWith('You fail to dig')).length;
check('and a spadeful out of each is a go at a real job', dug === spots.length, `${dug} of ${spots.length} went in`);
check('while work that costs wind and takes time still teaches them', gw.skills.get('body_control') - before > 0,
  `${(gw.skills.get('body_control') - before).toFixed(6)} of body control off ${dug} spadefuls`);

/*
 * And the island, which is where the body control anybody actually has is
 * kept. It pays this from `spend_wind`, on every go that comes due — and an
 * instant job comes due the moment it is asked for, since `rpc_act` sets it
 * going and settles it in the same call.
 */
const clicks = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid; was double precision;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  insert into said values ('ALL|' || (select string_agg(id, ',' order by id) from action_def));
  insert into said values ('FREE|' || coalesce((select string_agg(id, ',' order by id) from action_def
    where coalesce(stamina, 0) = 0 and coalesce(base_time, 0) = 0), ''));
  was := skill_of(w, u, 'body_control');
  for i in 1..20 loop perform spend_wind(w, u, 'examine_item'); end loop;
  insert into said values ('CLICKED|' || round((skill_of(w, u, 'body_control') - was)::numeric, 6));
  was := skill_of(w, u, 'body_control');
  perform spend_wind(w, u, 'dig');
  insert into said values ('DUG|' || round((skill_of(w, u, 'body_control') - was)::numeric, 6));
end $$;
select k from said;
rollback;
`);
const saidBy = (from: string) => (tag: string): string =>
  from.split('\n').map((l) => l.trim()).find((l) => l.startsWith(`${tag}|`))?.slice(tag.length + 1) ?? '';
const clicked = saidBy(clicks);
const islandAll = new Set(clicked('ALL').split(',').filter(Boolean));
const islandFree = new Set(clicked('FREE').split(',').filter(Boolean));
// Every job that costs nothing and takes no time, not just the ones the old
// list had missed: the island keeps no such list, so this is the whole rule.
const browserFree = new Set(ACTIONS.filter((a) => (a.stamina ?? 0) === 0 && (a.baseTime ?? 0) === 0).map((a) => a.id));
const apartOn = [...islandAll].filter((id) => islandFree.has(id) !== browserFree.has(id));
check('the two sides agree about which jobs are not work', apartOn.length === 0,
  apartOn.length ? `${apartOn.length} disagree, among them ${apartOn.slice(0, 4).join(', ')}` : `${islandFree.size} of the island's ${islandAll.size} jobs, the browser's ${browserFree.size} of ${ACTIONS.length}`);
check('and the island pays nothing for twenty clicks either', Number(clicked('CLICKED')) === 0,
  `${clicked('CLICKED')} of body control`);
check('while a spadeful there is still worth something', Number(clicked('DUG')) > 0,
  `${clicked('DUG')} of body control off one`);

/* ---- a lump's metal is written on the lump ------------------------------- */
const gi = Game.create(4242);
for (const id of ['file', 'whetstone']) gi.inventory.add(id, { ql: 40 });
gi.skills.values.set('blacksmithing', 40);
const anvil = gi.inventory.add('anvil', { ql: 20, extra: 'bronze' });
const lump = gi.inventory.add('bronze_lump', { ql: 40, count: 37 });
const imp = ACTION_BY_ID.get('improve_item')!;
check('a bronze lump with nothing written beside it is still bronze',
  materialOfItem(lump)?.name === 'Bronze', String(materialOfItem(lump)?.name));
check('so the browser lets you work one into a bronze anvil',
  (imp.check?.({ kind: 'item', uid: anvil.uid }, gi) ?? null) === null,
  imp.check?.({ kind: 'item', uid: anvil.uid }, gi) ?? 'allowed');
/* And the wrong metal is still the wrong metal. */
for (const it of [...gi.inventory.items]) if (it.id === 'bronze_lump') gi.inventory.remove(it.uid, it.count);
gi.inventory.add('iron_lump', { ql: 40, count: 37 });
check('and iron will not do instead', (imp.check?.({ kind: 'item', uid: anvil.uid }, gi) ?? '').includes('no bronze'),
  imp.check?.({ kind: 'item', uid: anvil.uid }, gi) ?? 'allowed');

/* The island had this wrong, and it is the side it was reported from. */
const isle = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  delete from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u
    and i.def in ('bronze_lump', 'iron_lump', 'plank', 'anvil', 'file', 'whetstone');
  insert into item (world_id, holder, holder_uid, def, ql, count, extra) values
    (w, 'player', u, 'bronze_lump', 40, 37, null),
    (w, 'player', u, 'plank', 30, 5, null),
    (w, 'player', u, 'anvil', 20, 1, 'bronze'),
    (w, 'player', u, 'file', 50, 1, null), (w, 'player', u, 'whetstone', 50, 1, null);
  insert into said values ('LUMP|' || coalesce((mat_of_item('bronze_lump', null)).name, 'NOTHING'));
  insert into said values ('BRONZE|' || coalesce((stock_for(w, u, 'metal', 'Bronze')).def, 'NONE'));
  insert into said values ('IRON|' || coalesce((stock_for(w, u, 'metal', 'Iron')).def, 'NONE'));
  insert into said values ('PLAIN|' || coalesce((stock_for(w, u, 'wood', 'Pine')).def, 'NONE'));
end $$;
select k from said;
rollback;
`);
const field = saidBy(isle);
check('the island reads a lump the same way the browser does', field('LUMP') === 'Bronze', field('LUMP'));
check('and finds the bronze in your pack', field('BRONZE') === 'bronze_lump', field('BRONZE'));
check('without finding bronze where there is none', field('IRON') === 'NONE', field('IRON'));
check('and an unmarked plank is wood enough for anything wooden', field('PLAIN') === 'plank', field('PLAIN'));

/* ---- a rough tool makes rough work, not rubbish -------------------------- */
/*
 * The issued chisel is quality fifteen and stonecutting starts at one, which
 * is the afternoon that was reported. What matters is not the average but the
 * floor: nothing should come off the bench at 1 five times in six.
 */
const gq = Game.create(4242);
const run = (skill: number, toolQl: number): { short: number; mean: number } => {
  gq.skills.values.set('stonecutting', skill);
  let short = 0;
  let total = 0;
  for (let i = 0; i < 4000; i++) {
    const q = gq.productQl('stonecutting', toolQl);
    // Your skill is the ceiling and always was; what was wrong was how far
    // below it a miss dropped you, which was all the way to the floor.
    if (q < Math.max(1, skill) - 0.0001) short++;
    total += q;
  }
  return { short: short / 4000, mean: total / 4000 };
};
const rough = run(6, 15);
check('a beginner with the issued chisel works at the top of their hands, not the bottom',
  rough.short === 0, `${(rough.short * 100).toFixed(0)}% come off under their own skill, averaging QL ${rough.mean.toFixed(1)} of a possible 6`);
const handy = run(60, 15);
check('and a good hand with a poor chisel is held back by the chisel, not ruined by it',
  handy.mean > 10 && handy.mean < 40, `mean QL ${handy.mean.toFixed(1)} at skill 60 with a QL 15 chisel`);
const kitted = run(60, 90);
check('while a good chisel puts nearly every piece at your own ceiling',
  kitted.mean > 50 && kitted.short < 0.05,
  `mean QL ${kitted.mean.toFixed(1)} against a ceiling of 60, with ${(kitted.short * 100).toFixed(1)}% of pieces short of it`);
check('and a better tool is never worse than a poorer one', kitted.mean > handy.mean,
  `${kitted.mean.toFixed(1)} against ${handy.mean.toFixed(1)}`);
check('a poor chisel still costs a good hand most of their ceiling', handy.short > 0.5,
  `${(handy.short * 100).toFixed(0)}% of pieces come off under a skill of 60`);

/* The island has to agree about all of that, since it is the side that rolls. */
const isleQl = psql(`
  select round(avg(q)::numeric, 2) || '|' || round((count(*) filter (where q < 5.9999))::numeric / count(*), 3)
    from (select product_ql(6, 15) as q from generate_series(1, 4000)) s;
`).trim().split('|');
check('and the island makes the same work of the same chisel',
  Number(isleQl[1]) === 0 && Math.abs(Number(isleQl[0]) - rough.mean) < 0.5,
  `island mean ${isleQl[0]} with ${(Number(isleQl[1]) * 100).toFixed(0)}% under skill, browser mean ${rough.mean.toFixed(2)}`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log('a click is not work, a lump knows its own metal, and a rough tool makes rough work rather than rubbish');
