/**
 * A citizen of somebody else's settlement may found one of their own.
 *
 * Reported from the island's chat: "i disbanded my settlement so i could make
 * a new one but it's still telling me i can't because i already have a deed
 * ... i think it must be because i'm a citizen of oceanport". It was. The
 * island refuses a stake only to somebody who founded a settlement
 * (`deed_refusal` asks `founded_by`), but the browser refused whenever it
 * held a settlement at all -- and on an island the one it holds is the first
 * of `deeds_of`: your own, and with none of your own, one you were asked onto.
 * So the refusal never reached the island.
 *
 * Asked of both sides:
 *
 *   * a settlement of your own still refuses a second, in the same words on
 *     both sides -- in the game you play alone, and as a founder on an island;
 *   * a mayor, a builder or a guest of somebody else's is offered the stake,
 *     and the island agrees;
 *   * the one refusal a citizen still meets is the border: inside the other
 *     settlement, it says whose it is;
 *   * and on the island a builder of the other settlement founds their own,
 *     which is then the settlement they are handed, as its founder, while they
 *     stay a builder of the other -- and a second stake is refused.
 */
import { execFileSync } from 'node:child_process';
import { Game, type DeedRole } from '../../src/game/game';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';

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

const HELD = 'You already hold a settlement. Disband it first.';

/* ---- the browser ----------------------------------------------------------- */

const found = ACTION_BY_ID.get('found_settlement')!;
const game = Game.create(4242);
const [sx, sy] = [game.spawn.x, game.spawn.y];
game.player.x = sx + 0.5;
game.player.y = sy + 0.5;
game.inventory.add('deed_stake');
const here: Target = { kind: 'tile', x: sx, y: sy, cx: sx, cy: sy };
// Oceanport, somebody else's, far enough off that its border is not in the way.
const oceanport = { name: 'Oceanport', x: sx + 20, y: sy, radius: 5, level: 1 };
const asked = (t: Target = here): string => found.check?.(t, game) ?? 'none';

console.log('--- the browser');
game.neighbourDeeds = [];
game.deed = { ...oceanport, name: 'Hearth' };
check('a settlement of your own refuses a second, in the game you play alone', asked() === HELD, asked());
game.deed = { ...oceanport, name: 'Hearth', mine: true, role: 'founder' };
check('and as its founder on an island', asked() === HELD, asked());
const browserHeld = asked();
for (const role of ['mayor', 'builder', 'guest'] as DeedRole[]) {
  // What the island hands a citizen with no settlement of their own: the one
  // they were asked onto, as "the deed", and the same one among the others.
  game.deed = { ...oceanport, mine: true, role };
  game.neighbourDeeds = [{ ...oceanport, holder: 'Somebody', mine: true, role }];
  check(`a ${role} of somebody else's settlement is offered the stake`, asked() === 'none', asked());
}
const inside: Target = { kind: 'tile', x: sx + 18, y: sy, cx: sx + 18, cy: sy };
check('the one refusal a citizen still meets is the border, and it says whose',
  asked(inside) === 'Oceanport, which is Somebody\'s, already reaches there. Found yours further out.', asked(inside));

/* ---- the island ------------------------------------------------------------ */

const isle = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; boss uuid; cit uuid; v_x int; v_y int; aim jsonb;
begin
  select id into w from world where name = 'Hoarding';
  select founded_by into boss from deed where world_id = w order by founded_at limit 1;
  select p.uid into cit from player p where p.world_id = w and p.uid <> boss
     and not exists (select 1 from deed d where d.world_id = w and d.founded_by = p.uid)
   order by p.uid limit 1;
  -- Somewhere a token may go: clear of every border, dry, open, and in from the edge.
  select gx, gy into v_x, v_y
    from generate_series(6, 250, 3) gx, generate_series(6, 250, 3) gy
   where in_bounds(w, gx + deed_radius(1), gy + deed_radius(1))
     and not exists (select 1 from deed d where d.world_id = w
                      and abs(d.x - gx) <= d.radius + deed_radius(1) + 1
                      and abs(d.y - gy) <= d.radius + deed_radius(1) + 1)
     and not has_water(w, gx, gy) and passable(w, gx, gy)
   order by gx, gy limit 1;
  update player set x = v_x + 0.5, y = v_y + 0.5, act = null, act_queue = '[]'::jsonb
   where world_id = w and uid = cit;
  delete from item where world_id = w and holder = 'player' and holder_uid = cit and def = 'deed_stake';
  perform give(w, cit, 'deed_stake', 1, 50);
  delete from deed_member where world_id = w and uid = cit;
  insert into deed_member (world_id, founder, uid, role) values (w, boss, cit, 'builder');
  aim := jsonb_build_object('kind', 'tile', 'x', v_x, 'y', v_y, 'cx', v_x, 'cy', v_y, 'name', 'Newport');

  -- What the browser is handed as the citizen's settlement, and what it is.
  insert into said select 'HANDED|' || (select deed_role(w, d.founded_by, cit) || ',' || (d.founded_by = boss)::text
    from my_deed(w, cit) d);
  insert into said values ('BUILDER|' || coalesce(act_refusal(w, cit, 'found_settlement', aim), 'none'));
  update deed_member set role = 'mayor' where world_id = w and founder = boss and uid = cit;
  insert into said values ('MAYOR|' || coalesce(act_refusal(w, cit, 'found_settlement', aim), 'none'));
  update deed_member set role = 'builder' where world_id = w and founder = boss and uid = cit;

  perform act_perform(w, cit, 'found_settlement', aim);
  insert into said select 'FOUNDED|' || (select d.name || ',' || deed_role(w, d.founded_by, cit)
    from my_deed(w, cit) d) || ',' || coalesce(deed_role(w, boss, cit), 'none');
  perform give(w, cit, 'deed_stake', 1, 50);
  insert into said values ('SECOND|' || coalesce(act_refusal(w, cit, 'found_settlement', aim), 'none'));
  insert into said values ('FOUNDER|' || coalesce(act_refusal(w, boss, 'found_settlement', aim), 'none'));
end $$;
select string_agg(k, E'\\n') from said;
rollback;
`);
const said = (key: string): string => isle.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? '(nothing)';

console.log('--- the island');
check('the island hands a citizen with none of their own the settlement they were asked onto, as a builder',
  said('HANDED') === 'builder,true', said('HANDED'));
check('and offers a builder of it the stake', said('BUILDER') === 'none', said('BUILDER'));
check('and a mayor of it', said('MAYOR') === 'none', said('MAYOR'));
check('the builder founds their own, which is then the settlement they are handed, as its founder, and they stay a builder of the other',
  said('FOUNDED') === 'Newport,founder,builder', said('FOUNDED'));
check('a second stake is refused', said('SECOND') === HELD, said('SECOND'));
check('and the founder of the first is refused in the words the browser uses',
  said('FOUNDER') === browserHeld, `${said('FOUNDER')} / ${browserHeld}`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a citizen of somebody else's settlement may found their own — ${ok.length} of ${ok.length}`);
