/**
 * What the hands were asked for, and what a walk costs.
 *
 * Three things, and two of them are about asking for work in a unit a person
 * actually thinks in.
 *
 * **A walk no longer throws the list away.** `moveTo` cancelled, `rpc_cancel`
 * emptied `act_queue`, and a builder with four walls lined up who stepped
 * three tiles to the woodpile came back to an empty head. Walking holds now:
 * what was in hand goes back to the front of the queue and the rest stays
 * where it is, and nothing restarts itself, because being dragged back across
 * a yard you crossed on purpose would be worse than losing the list.
 *
 * **A piece can be asked for a quality.** A count of passes is the wrong unit
 * for improving: what a pass is worth falls away as the piece gets better, so
 * any number you name is either short or wasted. `upto` is a refusal and
 * nothing else, which is the whole feature — a repeating job asks its own
 * refusal before every go.
 *
 * **A store can be put in order.** The pack has had a sort since the storage
 * work and a three-hundred-thing crate has had none.
 *
 * The middle one is put to both sides, because improving runs on the island
 * and a ceiling the browser honours and the island does not is a button that
 * works until it doesn't. Runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID } from '../../src/game/actions';
import { Game } from '../../src/game/game';
import { orderBy } from '../../src/ui/sorting';
import type { Item } from '../../src/game/items';

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
const saidBy = (out: string) => (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

/* ---- a walk holds the work ------------------------------------------------ */

const at = (x: number, y: number) => ({ kind: 'tile', x, y, cx: x, cy: y }) as never;
const dig = ACTION_BY_ID.get('dig')!;

/** A body ashore with a shovel and somewhere dry to put it. */
function digger(): { g: Game; spots: Array<[number, number]> } {
  const g = Game.create(4242);
  g.inventory.add('shovel', { ql: 40 });
  g.skills.values.set('digging', 30);
  // A wide head, so the cap is not what this is measuring.
  g.skills.values.set('mind_logic', 60);
  const [hx, hy] = [Math.floor(g.player.x), Math.floor(g.player.y)];
  const spots: Array<[number, number]> = [];
  for (let r = 3; r <= 14 && spots.length < 4; r++) {
    for (let a = 0; a < 16 && spots.length < 4; a++) {
      const x = hx + Math.round(Math.cos((a / 16) * Math.PI * 2) * r);
      const y = hy + Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
      if (!g.world.inBounds(x, y) || g.world.heightAt(x + 0.5, y + 0.5) < 0) continue;
      if (spots.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < 5)) continue;
      spots.push([x, y]);
    }
  }
  return { g, spots };
}

/*
 * First, the thing the suggestion was wrong about, measured so it stays true:
 * the queue already walks. Three digs at three spots five tiles apart, asked
 * for from one place, and all three land.
 */
{
  const { g, spots } = digger();
  check('there are three separate corners to dig, well apart', spots.length >= 3, spots.slice(0, 3).map((s) => s.join(',')).join(' · '));
  for (const [x, y] of spots.slice(0, 3)) g.requestAction(dig, at(x, y));
  let walking = 0;
  for (let t = 0; t < 1500 && (g.action || g.queue.length); t++) {
    g.player.stats.stamina = 1;
    if (g.player.moving) walking++;
    g.update(0.2);
  }
  const digs = g.log.filter((l) => /^You (dig up|fail to dig)/.test(l.text)).length;
  check('a queued job walks you to it, and the next one, and the one after',
    digs >= 3 && walking > 0, `${digs} spadefuls out of three corners, ${walking} turns of it spent walking`);
}

/* And now the part that was not true: walking off used to forget the lot. */
{
  const { g, spots } = digger();
  for (const [x, y] of spots.slice(0, 3)) g.requestAction(dig, at(x, y));
  // Let it settle into the first job rather than still walking to it.
  for (let t = 0; t < 200 && g.action?.state !== 'performing'; t++) {
    g.player.stats.stamina = 1;
    g.update(0.2);
  }
  const wasDoing = g.action?.def.id;
  const lined = g.queue.length;
  const [ax, ay] = [Math.floor(g.player.x) + 2, Math.floor(g.player.y)];
  g.moveTo(ax, ay);
  check('walking somewhere puts the job down', g.action === null, `was ${wasDoing ?? 'nothing'}`);
  check('and keeps every job that was waiting, with the one in hand at the front',
    g.queue.length === lined + 1 && g.queue[0].def.id === 'dig',
    `${lined} waiting before, ${g.queue.length} after`);
  check('and says so, rather than leaving them for somebody to wonder about', g.held, String(g.held));
  /*
   * Nothing restarts itself. This is the half that is easy to get wrong and
   * the reason the hold is not a resume: a job that took itself up the moment
   * your feet stopped would walk you straight back across the yard.
   */
  for (let t = 0; t < 300; t++) {
    g.player.stats.stamina = 1;
    g.update(0.2);
  }
  check('and nothing takes itself back up while you are away',
    g.action === null && g.queue.length === lined + 1,
    `${g.queue.length} still waiting after a minute of standing about`);
  const went = g.resumeQueue();
  check('until you say so, and then it carries on where it was',
    went && g.action?.def.id === 'dig' && !g.held, `${g.queue.length} left behind it`);
}

/* Esc still means Esc. */
{
  const { g, spots } = digger();
  for (const [x, y] of spots.slice(0, 3)) g.requestAction(dig, at(x, y));
  g.cancelAction();
  check('stopping still forgets the lot, which is what stopping has always been for',
    g.action === null && g.queue.length === 0 && !g.held, `${g.queue.length} left`);
}

/* ---- a piece asked for a quality ------------------------------------------ */

const improve = ACTION_BY_ID.get('improve_item')!;
const smith = (ql: number): { g: Game; item: Item } => {
  const g = Game.create(4242);
  for (const id of ['file', 'whetstone']) g.inventory.add(id, { ql: 90 });
  g.skills.values.set('blacksmithing', 80);
  g.inventory.add('iron_lump', { ql: 60, count: 40 });
  return { g, item: g.inventory.add('anvil', { ql, extra: 'iron' }) };
};

{
  const { g, item } = smith(30);
  check('a piece below the quality you asked for is worked on',
    (improve.check?.({ kind: 'item', uid: item.uid, upto: 60 }, g) ?? null) === null,
    `QL ${item.ql} against a mark of 60`);
}
{
  const { g, item } = smith(62);
  const why = improve.check?.({ kind: 'item', uid: item.uid, upto: 60 }, g) ?? null;
  check('and one already past it is refused, in so many words',
    why !== null && why.includes('which is what you asked for'), why ?? 'allowed');
  check('while the same piece with no mark on it is worked on as before',
    (improve.check?.({ kind: 'item', uid: item.uid }, g) ?? null) === null,
    improve.check?.({ kind: 'item', uid: item.uid }, g) ?? 'allowed');
}

/*
 * And the whole point of it: the repeat does the counting. Asked to go to
 * fifty with no count at all, it stops at fifty rather than at your wind.
 */
{
  const { g, item } = smith(20);
  g.requestAction(improve, { kind: 'item', uid: item.uid, upto: 50 });
  for (let t = 0; t < 4000 && g.action; t++) {
    g.player.stats.stamina = 1;
    g.update(0.25);
  }
  check('so "take it to fifty" takes it to fifty and stops, with no count named',
    item.ql >= 50 && item.ql < 58, `QL ${item.ql.toFixed(1)} from 20`);
}

/* ---- and the island refuses in the same words ----------------------------- */

const isle = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid; v_id bigint;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  delete from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u
    and i.def in ('iron_lump', 'anvil', 'file', 'whetstone');
  insert into item (world_id, holder, holder_uid, def, ql, count, extra) values
    (w, 'player', u, 'iron_lump', 60, 40, null),
    (w, 'player', u, 'file', 90, 1, null), (w, 'player', u, 'whetstone', 90, 1, null);
  insert into item (world_id, holder, holder_uid, def, ql, count, extra)
    values (w, 'player', u, 'anvil', 62, 1, 'iron') returning id into v_id;
  insert into skill (world_id, uid, id, value) values (w, u, 'blacksmithing', 80)
    on conflict (world_id, uid, id) do update set value = 80;
  insert into said values ('OVER|' || coalesce(
    item_refusal(w, u, 'improve_item', jsonb_build_object('uid', v_id, 'upto', 60)), 'ALLOWED'));
  insert into said values ('UNDER|' || coalesce(
    item_refusal(w, u, 'improve_item', jsonb_build_object('uid', v_id, 'upto', 90)), 'ALLOWED'));
  insert into said values ('NOMARK|' || coalesce(
    item_refusal(w, u, 'improve_item', jsonb_build_object('uid', v_id)), 'ALLOWED'));
  insert into said values ('HOLD|' || (select count(*)::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_hold'));
end $$;
select k from said;
rollback;
`);
const said = saidBy(isle);

const { g: gb, item: ib } = smith(62);
const browserSaid = improve.check?.({ kind: 'item', uid: ib.uid, upto: 60 }, gb) ?? 'ALLOWED';
check('the island refuses a piece past its mark in the browser’s own words',
  said('OVER') === browserSaid, `island: "${said('OVER')}" · browser: "${browserSaid}"`);
check('and works on one below it, mark or no mark',
  said('UNDER') === 'ALLOWED' && said('NOMARK') === 'ALLOWED',
  `under: ${said('UNDER')} · unmarked: ${said('NOMARK')}`);
check('and the island knows how to put the work down without forgetting it',
  said('HOLD') === '1', `rpc_hold: ${said('HOLD')}`);

/* ---- a store put in order ------------------------------------------------- */

const it = (id: string, ql: number, count: number, dmg: number): Item =>
  ({ uid: ql * 1000 + count, id, ql, count, dmg } as Item);
const pile = [it('plank', 40, 3, 0), it('anvil', 90, 1, 12), it('nails', 10, 200, 0), it('plank', 70, 1, 4)];

check('a store can be put in order by quality, best first',
  orderBy(pile, 'ql').map((i) => i.ql).join(',') === '90,70,40,10', orderBy(pile, 'ql').map((i) => i.ql).join(','));
check('by how many there are',
  orderBy(pile, 'count')[0].count === 200, String(orderBy(pile, 'count')[0].count));
check('by what is most knocked about',
  orderBy(pile, 'dmg')[0].dmg === 12, String(orderBy(pile, 'dmg')[0].dmg));
/*
 * And ties fall back to the name rather than to wherever the row happened to
 * be, because a crate of two hundred identical planks that reshuffles itself
 * every time something else changes is unusable.
 */
const twins = [it('plank', 40, 1, 0), it('anvil', 40, 1, 0), it('nails', 40, 1, 0)];
const once = orderBy(twins, 'ql').map((i) => i.id).join(',');
const twice = orderBy([...twins].reverse(), 'ql').map((i) => i.id).join(',');
check('and a tie is broken by name, so a full crate holds still',
  once === twice, `${once} either way round`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a walk puts the work down and a piece can be asked for a quality — ${ok.length} of ${ok.length}`);
