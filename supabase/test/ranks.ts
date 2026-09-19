/**
 * Ranks on a deed, a padlock with one key, and a wall two people can build.
 *
 * Three holes in the same wall, and one of them turned out to be already
 * filled in.
 *
 * **`deed_member` was a flat list.** In or out, and everybody in it could dig
 * up the gardens, empty the stores and pull the walls down — so inviting
 * anybody to anything was a decision nobody could take back short of throwing
 * them out. Four ranks now, and the shaping question goes through `may_shape`
 * rather than "are you on the roll".
 *
 * **And everything anybody built was open to everybody.** A crate on your own
 * deed was safe because the *ground* was; a crate anywhere else was a thing
 * anybody could empty. A padlock is forged with no key and cuts one when it
 * is fitted; the number they share is the padlock's own id. The one way back
 * in is the ground, because a game where losing a small item costs you a
 * building is a game nobody enjoys.
 *
 * **Two people on one job** I suggested as missing and it is not:
 * `building_yours` has always been true for anybody whose deed the building
 * stands on, and the wall's bill is a row in the database that both of them
 * decrement. It is measured here so it stays true.
 *
 * Runs against the database the suite leaves behind.
 */
import { Game } from '../../src/game/game';
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID } from '../../src/game/actions';
import { DEED_RANKS, rankAtLeast, type DeedRole } from '../../src/game/game';
import { isLocked, keyFor, lockRefusal } from '../../src/game/locks';
import { ITEM_DEFS } from '../../src/game/items';
import { RECIPES } from '../../src/game/recipes';

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

/* ---- the ranks ------------------------------------------------------------ */

check('there are four ranks, from a guest up to whoever planted the stake',
  DEED_RANKS.join(' < ') === 'guest < builder < mayor < founder', DEED_RANKS.join(' < '));
check('a builder may shape the ground and a guest may not',
  rankAtLeast('builder', 'builder') && !rankAtLeast('guest', 'builder'), 'the line is drawn between them');
check('and a mayor may do everything a builder may',
  (['guest', 'builder', 'mayor', 'founder'] as DeedRole[]).filter((r) => rankAtLeast(r, 'builder')).join(', ') === 'builder, mayor, founder',
  'three of the four');
/*
 * The solo game has one person who founded everything, and every rule that
 * asks a rank must read that as the top one rather than as nobody.
 */
check('and the game you play by yourself is played by a founder',
  rankAtLeast(undefined, 'founder'), 'no rank means the whole of it');

/* ---- a padlock, and the one key cut to it --------------------------------- */

check('a padlock and a key are both things that exist',
  !!ITEM_DEFS.padlock && !!ITEM_DEFS.key, `${ITEM_DEFS.padlock?.name} and ${ITEM_DEFS.key?.name}`);
const forge = RECIPES.find((r) => r.result === 'padlock');
check('and a padlock is forged rather than found',
  !!forge && forge.skill === 'blacksmithing', `${forge?.label ?? 'no recipe'} — ${forge?.skill}`);

const store = (lock?: number) => ({ lock, x: 10, y: 10 });
const keyTo = (n: number) => ({ uid: 1, id: 'key', keyed: n, ql: 40, count: 1, dmg: 0 } as never);

check('a store with nothing on it opens for anybody',
  lockRefusal([], store(), false) === null, 'no padlock, no question');
check('one with a padlock on it opens for nobody without the key',
  lockRefusal([], store(77), false) !== null, lockRefusal([], store(77), false) ?? '');
check('and for whoever holds it',
  lockRefusal([keyTo(77)], store(77), false) === null, 'the key fits');
check('while a key to another lock is a key to nothing here',
  lockRefusal([keyTo(78)], store(77), false) !== null, 'the wrong key');
check('and the founder of the settlement it stands on holds the master key',
  lockRefusal([], store(77), true) === null, 'the ground, rather than a person');
check('a locked store says so, and an unlocked one says nothing',
  isLocked(store(77)) && !isLocked(store()) && !isLocked(store(0)), 'nought is no lock');
check('and the key can be found in a pack to be handed over',
  keyFor([keyTo(77)], store(77))?.keyed === 77 && keyFor([keyTo(78)], store(77)) === undefined,
  'one key, by its number');

/* ---- driven, on a crate --------------------------------------------------- */

{
  const g = Game.create(4242);
  g.skills.values.set('blacksmithing', 50);
  const [hx, hy] = [Math.floor(g.player.x), Math.floor(g.player.y)];
  const crate = g.addCrate('log', hx, hy, 0, 0);
  crate.items.push(g.inventory.add('plank', { ql: 30, count: 5 }));
  g.inventory.add('padlock', { ql: 40 });
  const fit = ACTION_BY_ID.get('fit_lock')!;
  const take = ACTION_BY_ID.get('crate_take_all')!;
  const put = ACTION_BY_ID.get('store_in_crate')!;
  const off = ACTION_BY_ID.get('take_off_lock')!;
  const t = { kind: 'crate' as const, id: crate.id };

  check('an open crate is one anybody can empty', (take.check?.(t, g) ?? null) === null, 'before the lock');
  fit.perform(t, g);
  const key = g.inventory.items.find((i) => i.id === 'key');
  check('fitting a padlock closes it and cuts one key to it',
    !!crate.lock && key?.keyed === crate.lock && !g.inventory.has('padlock'),
    `lock ${crate.lock}, key to ${key?.keyed}, and the padlock is used up`);
  check('and with the key in your pack it opens as before',
    (take.check?.(t, g) ?? null) === null, 'the key fits');

  // Hand the key away and there is no deed underfoot to fall back on.
  g.inventory.remove(key!.uid, 1);
  check('hand the key away and it is shut, in so many words',
    (take.check?.(t, g) ?? '').includes('no key'), take.check?.(t, g) ?? 'still open');
  const plank = g.inventory.add('plank', { ql: 30, count: 1 });
  check('and nothing goes into it either',
    (put.check?.({ kind: 'item', uid: plank.uid, into: crate.id }, g) ?? '').includes('no key'),
    put.check?.({ kind: 'item', uid: plank.uid, into: crate.id }, g) ?? 'still open');
  const pick = ACTION_BY_ID.get('pick_up_crate')!;
  check('and it cannot simply be carried off with the lock on it',
    (pick.check?.(t, g) ?? '').includes('no key'), pick.check?.(t, g) ?? 'carried off');
  check('nor can the padlock be taken off without it',
    (off.check?.(t, g) ?? '').includes('no key'), off.check?.(t, g) ?? 'taken off');

  /*
   * And the ground. A stake in the middle of it makes this body the founder
   * here, and the founder holds the master key to their own land — which is
   * the way back in when a key is lost, and the reason a lock is worth more
   * on somebody else's deed than on your own.
   */
  g.deed = { name: 'Hearth', x: hx, y: hy, radius: 5 };
  check('until you plant a stake over it, and then it is your own land again',
    (take.check?.(t, g) ?? null) === null, 'the founder holds the master key');
  off.perform(t, g);
  check('and the padlock comes off and goes back in your pack',
    !crate.lock && g.inventory.has('padlock'), 'open to anybody again');
}

/* ---- and the island says all of it the same way --------------------------- */

const isle = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; boss uuid; cit uuid; guest uuid; cid int; padlock bigint;
begin
  select id into w from world where name = 'Hoarding';
  select founded_by into boss from deed where world_id = w limit 1;
  -- Two more bodies on the island, one a builder and one a guest.
  select uid into cit from player where world_id = w and uid <> boss limit 1;
  select uid into guest from player where world_id = w and uid not in (boss, cit) limit 1;
  delete from deed_member where world_id = w and founder = boss and uid in (cit, guest);
  insert into deed_member (world_id, founder, uid, role) values (w, boss, cit, 'builder');
  if guest is not null then
    insert into deed_member (world_id, founder, uid, role) values (w, boss, guest, 'guest');
  end if;

  insert into said select 'FOUNDER|' || deed_role(w, boss, boss);
  insert into said select 'CITIZEN|' || deed_role(w, boss, cit);
  insert into said select 'GUEST|' || coalesce(deed_role(w, boss, guest), 'NONE');
  insert into said select 'STRANGER|' || coalesce(
    deed_role(w, boss, '00000000-0000-0000-0000-000000000000'::uuid), 'NONE');

  -- And what each of them may do with the ground in the middle of it.
  insert into said select 'SHAPE_F|' || may_shape(w, boss, (select x from deed where world_id = w and founded_by = boss),
                                                             (select y from deed where world_id = w and founded_by = boss))::text;
  insert into said select 'SHAPE_C|' || may_shape(w, cit, (select x from deed where world_id = w and founded_by = boss),
                                                          (select y from deed where world_id = w and founded_by = boss))::text;
  if guest is not null then
    insert into said select 'SHAPE_G|' || may_shape(w, guest, (select x from deed where world_id = w and founded_by = boss),
                                                              (select y from deed where world_id = w and founded_by = boss))::text;
    -- A guest still belongs to the settlement; they simply may not dig it up.
    insert into said select 'ON_G|' || on_my_deed(w, guest, (select x from deed where world_id = w and founded_by = boss),
                                                            (select y from deed where world_id = w and founded_by = boss))::text;
  end if;

  -- A padlock on a crate well away from anybody's land.
  insert into crate (world_id, id, kind, x, y, sx, sy, made_by)
    values (w, 9000, 'log', 900, 900, 0, 0, cit) returning id into cid;
  insert into item (world_id, holder, holder_uid, def, ql, count)
    values (w, 'player', cit, 'padlock', 40, 1) returning id into padlock;
  update crate set lock = padlock where world_id = w and id = 9000;
  insert into said select 'SHUT|' || lock_shut(w, cit, padlock, 900, 900)::text;
  insert into item (world_id, holder, holder_uid, def, ql, count, keyed)
    values (w, 'player', cit, 'key', 40, 1, padlock);
  insert into said select 'OPEN|' || lock_shut(w, cit, padlock, 900, 900)::text;
  insert into said select 'OTHER|' || lock_shut(w, boss, padlock, 900, 900)::text;
  insert into said select 'WHY|' || coalesce(lock_refusal(w, boss, padlock, 900, 900), 'ALLOWED');
  -- And the master key: the same crate, standing on the founder's own land.
  insert into said select 'MASTER|' || lock_shut(w, boss, padlock,
      (select x from deed where world_id = w and founded_by = boss),
      (select y from deed where world_id = w and founded_by = boss))::text;
  insert into said select 'PORTED|' || (act_ported('fit_lock') and act_ported('take_off_lock'))::text;
end $$;
select k from said;
rollback;
`);
const said = saidBy(isle);

check('the island calls whoever planted the stake the founder', said('FOUNDER') === 'founder', said('FOUNDER'));
check('and reads a member’s rank off the roll', said('CITIZEN') === 'builder', said('CITIZEN'));
check('and says nothing at all about a stranger', said('STRANGER') === 'NONE', said('STRANGER'));
check('a founder and a builder may both shape their settlement',
  said('SHAPE_F') === 'true' && said('SHAPE_C') === 'true', `${said('SHAPE_F')} and ${said('SHAPE_C')}`);
if (said('SHAPE_G') !== 'MISSING') {
  check('and a guest may not, though the settlement is still theirs to walk',
    said('SHAPE_G') === 'false' && said('ON_G') === 'true',
    `shape ${said('SHAPE_G')}, belongs ${said('ON_G')}`);
}
check('a padlock with no key out shuts its crate against the person who fitted it',
  said('SHUT') === 'true', said('SHUT'));
check('and the key opens it', said('OPEN') === 'false', said('OPEN'));
check('while somebody else is shut out of it, in the browser’s own words',
  said('OTHER') === 'true' && said('WHY') === lockRefusal([], store(77), false),
  `island: "${said('WHY')}"`);
check('and the founder of the land it stands on is not, wherever the key is',
  said('MASTER') === 'false', said('MASTER'));
check('and both halves of fitting one are jobs the island knows',
  said('PORTED') === 'true', said('PORTED'));

/* ---- two people on one wall ----------------------------------------------- */

const shared = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; boss uuid; cit uuid;
begin
  select id into w from world where name = 'Hoarding';
  select founded_by into boss from deed where world_id = w limit 1;
  select uid into cit from player where world_id = w and uid <> boss limit 1;
  delete from deed_member where world_id = w and founder = boss and uid = cit;
  insert into deed_member (world_id, founder, uid, role) values (w, boss, cit, 'builder');
  -- A building on the founder's land, planned by the founder.
  insert into building (world_id, id, name, levels, planned_by)
    values (w, 9100, 'Shared', 1, boss) on conflict do nothing;
  insert into building_tile (world_id, building, x, y)
    values (w, 9100, (select x from deed where world_id = w and founded_by = boss),
                     (select y from deed where world_id = w and founded_by = boss))
    on conflict do nothing;
  insert into said select 'MINE_F|' || building_yours(w, boss, 9100)::text;
  insert into said select 'MINE_C|' || building_yours(w, cit, 9100)::text;
  insert into said select 'MINE_S|' || building_yours(w, '00000000-0000-0000-0000-000000000000'::uuid, 9100)::text;
end $$;
select k from said;
rollback;
`);
const both = saidBy(shared);
check('a building on a settlement is every builder’s to work on, not only its planner’s',
  both('MINE_F') === 'true' && both('MINE_C') === 'true',
  'so two people fill one wall’s bill between them');
check('and a stranger’s is not', both('MINE_S') === 'false', both('MINE_S'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`what you are on a settlement, and what opens for you — ${ok.length} of ${ok.length}`);
