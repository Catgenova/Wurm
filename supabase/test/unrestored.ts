/**
 * A find nobody has restored takes no repair, and one that breaks first is gone.
 *
 * Asked for: "Artifacts that have not been restored should not be able to be
 * repaired. If not restored before broken they are gone." A fragment of a
 * relic and a tarnished bauble (`UNRESTORED`) are refused by everything that
 * takes damage off a thing, in the same words on both sides:
 *
 *   * Repair and a repair kit (`item_refusal`, and the actions' own checks),
 *     neither of them offered on one in the browser;
 *   * Mend (`cast_reason`, `castReason`);
 *   * a worker mending the stores, who passes them by for the worst of the
 *     rest (`damaged_in_stores`, `damagedInStores`);
 *
 * while Restore takes one at any damage short of breaking, where it used to
 * send you to repair it first, and damage that reaches the most a thing takes
 * leaves nothing behind. Anything else still repairs as it always did.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { DAMAGE_MAX, Game, type DeedStore } from '../../src/game/game';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import { CAST_BY_ID, castReason } from '../../src/game/faith';
import { itemDef, NOT_RESTORED, UNRESTORED, type Item } from '../../src/game/items';

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

/** What a find carries when it is looked at, and what it has got to when it is restored anyway. */
const DMG = 60;
const WORSE = 90;
const QL = 50;
/** A thing that is not a find, to show nothing else has changed. */
const TOOL = 'hatchet';

/* ---- the island ------------------------------------------------------------ */
const out = psql(`
begin;
create temp table said (k text, v text);
do $$
declare w uuid; u uuid; f1 bigint; f2 bigint; b bigint; t bigint; box int;
        item_t text := 'item';
begin
  -- The suite's own island, and the first person on it, with an empty pack.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  delete from deed where world_id = w;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  update player set x = 8.5, y = 8.5, act = null, act_queue = '[]', favour = 120, favour_at = now()
    where world_id = w and uid = u;
  insert into skill (world_id, uid, id, value) values (w, u, faith_skill(), 90), (w, u, 'restoration', 100), (w, u, 'repair', 50)
    on conflict (world_id, uid, id) do update set value = excluded.value;

  insert into said values ('SAYS', not_restored_says());
  insert into said values ('KINDS', (select string_agg(d, ',' order by d) from unnest(array['fragment', 'tarnished_bauble', '${TOOL}']) d
    where unrestored(d)));

  -- Both pieces of an old pot, a tarnished bauble, and a tool, each knocked about.
  f1 := give(w, u, 'fragment', 1, ${QL}, 'old pot 1/2');
  f2 := give(w, u, 'fragment', 1, ${QL}, 'old pot 2/2');
  b := give(w, u, 'tarnished_bauble', 1, ${QL}, 'minor');
  t := give(w, u, '${TOOL}', 1, ${QL});
  update item set dmg = ${DMG} where id in (f1, f2, b, t);
  perform give(w, u, 'repair_kit', 2, ${QL});

  /* Repair, a repair kit and Mend: refused on a find, as ever on the tool. */
  insert into said values
    ('REPAIR|f', coalesce(act_refusal(w, u, 'repair_item', jsonb_build_object('kind', item_t, 'uid', f1)), 'ALLOWED')),
    ('REPAIR|b', coalesce(act_refusal(w, u, 'repair_item', jsonb_build_object('kind', item_t, 'uid', b)), 'ALLOWED')),
    ('REPAIR|t', coalesce(act_refusal(w, u, 'repair_item', jsonb_build_object('kind', item_t, 'uid', t)), 'ALLOWED')),
    ('KIT|f', coalesce(act_refusal(w, u, 'mend_kit', jsonb_build_object('kind', item_t, 'uid', f1)), 'ALLOWED')),
    ('KIT|b', coalesce(act_refusal(w, u, 'mend_kit', jsonb_build_object('kind', item_t, 'uid', b)), 'ALLOWED')),
    ('KIT|t', coalesce(act_refusal(w, u, 'mend_kit', jsonb_build_object('kind', item_t, 'uid', t)), 'ALLOWED')),
    ('MEND|f', coalesce(cast_reason(w, u, 'mend', f1), 'ALLOWED')),
    ('MEND|b', coalesce(cast_reason(w, u, 'mend', b), 'ALLOWED')),
    ('MEND|t', coalesce(cast_reason(w, u, 'mend', t), 'ALLOWED'));

  /* Restore, on finds far past where it used to send you to repair them first. */
  update item set dmg = ${WORSE} where id in (f1, b);
  insert into said values
    ('RESTORE|f', coalesce(act_refusal(w, u, 'restore_relic', jsonb_build_object('kind', item_t, 'uid', f1)), 'ALLOWED')),
    ('RESTORE|b', coalesce(act_refusal(w, u, 'restore_relic', jsonb_build_object('kind', item_t, 'uid', b)), 'ALLOWED'));

  /* A worker mending the stores: the finds are the worst in the crate, and passed by. */
  insert into deed (world_id, name, x, y, radius, level, founded_by) values (w, 'Home', 8, 8, 3, 1, u);
  select coalesce(max(id), 0) + 1 into box from crate where world_id = w;
  insert into crate (world_id, id, kind, x, y, sx, sy, deed) values (w, box, 'plank', 8, 8, 0, 0, true);
  update item set holder = 'crate', crate = box, holder_uid = null where id in (f1, b, t);
  insert into said values ('STORES', coalesce((damaged_in_stores(w, u)).def, 'nothing'));
  update item set dmg = 0 where id = t;
  insert into said values ('STORES|finds', coalesce((damaged_in_stores(w, u)).def, 'nothing'));

  /* Broken before it is restored: gone. */
  perform damage_item(f2, ${DAMAGE_MAX - DMG});
  insert into said values ('BROKEN', (select count(*) from item where id = f2)::text);
end $$;
select k || E'\\t' || coalesce(v, 'null') from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const at = l.indexOf('\t');
  return [l.slice(0, at), l.slice(at + 1)] as [string, string];
}));
const say = (k: string): string => said.get(k) ?? '(nothing)';

check('the island says why in the browser\'s words', say('SAYS') === NOT_RESTORED, say('SAYS'));
check('and counts the same things as finds nobody has restored', say('KINDS') === [...UNRESTORED].sort().join(','), say('KINDS'));
for (const [what, key] of [['Repair', 'REPAIR'], ['A repair kit', 'KIT'], ['Mend', 'MEND']] as const) {
  check(`${what} is refused on a fragment and a tarnished bauble on the island`,
    say(`${key}|f`) === NOT_RESTORED && say(`${key}|b`) === NOT_RESTORED, `${say(`${key}|f`)} / ${say(`${key}|b`)}`);
  check(`and still goes on a ${TOOL}`, say(`${key}|t`) === 'ALLOWED', say(`${key}|t`));
}
check(`Restore takes a fragment and a tarnished bauble at ${WORSE} damage on the island`,
  say('RESTORE|f') === 'ALLOWED' && say('RESTORE|b') === 'ALLOWED', `${say('RESTORE|f')} / ${say('RESTORE|b')}`);
check('a worker mending the stores passes the finds by for the worst of the rest', say('STORES') === TOOL, say('STORES'));
check('and finds nothing to mend when the finds are all there is', say('STORES|finds') === 'nothing', say('STORES|finds'));
check(`a find that reaches ${DAMAGE_MAX} damage on the island is gone`, say('BROKEN') === '0', say('BROKEN'));

/* ---- the browser ----------------------------------------------------------- */
const game = Game.create(4404);
game.inventory.items.splice(0);
const add = (id: string, extra?: string): Item => {
  const it = game.inventory.add(id, { ql: QL, ...(extra ? { extra } : {}) });
  it.dmg = DMG;
  return it;
};
const f1 = add('fragment', 'old pot 1/2');
const f2 = add('fragment', 'old pot 2/2');
const b = add('tarnished_bauble', 'minor');
const t = add(TOOL);
game.inventory.add('repair_kit', { ql: QL, count: 2 });
game.skills.values.set('prayer', 90);
game.skills.values.set('restoration', 100);
game.player.favour = 120;
const on = (it: Item): Target => ({ kind: 'item', uid: it.uid });
const repair = ACTION_BY_ID.get('repair_item')!;
const kit = ACTION_BY_ID.get('mend_kit')!;
const restore = ACTION_BY_ID.get('restore_relic')!;
const mend = CAST_BY_ID.get('mend')!;

for (const [what, def, key] of [['Repair', repair, 'REPAIR'], ['A repair kit', kit, 'KIT']] as const) {
  check(`${what} is not offered on a fragment or a tarnished bauble in the browser`, !def.applies(on(f1), game) && !def.applies(on(b), game));
  check('and refused in the island\'s words if it is asked for',
    def.check?.(on(f1), game) === say(`${key}|f`) && def.check?.(on(b), game) === say(`${key}|b`));
  check(`and offered on a ${TOOL} as ever`, def.applies(on(t), game) && (def.check?.(on(t), game) ?? null) === null);
}
check('Mend is refused on a fragment and a tarnished bauble in the island\'s words',
  castReason(game, mend, f1) === say('MEND|f') && castReason(game, mend, b) === say('MEND|b'), String(castReason(game, mend, f1)));
check(`and goes on a ${TOOL}`, castReason(game, mend, t) === null, String(castReason(game, mend, t)));

f1.dmg = WORSE;
b.dmg = WORSE;
check(`the browser restores them at ${WORSE} damage too`,
  (restore.check?.(on(f1), game) ?? null) === null && (restore.check?.(on(b), game) ?? null) === null,
  `${restore.check?.(on(f1), game)} / ${restore.check?.(on(b), game)}`);

const store: DeedStore = { x: 8, y: 8, centre: [8.5, 8.5], items: [f1, b, t], name: 'Home', deed: true } as DeedStore;
(game as unknown as { deedStores: () => DeedStore[] }).deedStores = () => [store];
check('a worker in the browser passes the finds by for the worst of the rest', game.damagedInStores()?.item.id === TOOL,
  game.damagedInStores()?.item.id ?? 'nothing');
t.dmg = 0;
check('and finds nothing when the finds are all there is', game.damagedInStores() === undefined);

game.damageItem(f2, DAMAGE_MAX - DMG);
check(`a find that reaches ${DAMAGE_MAX} damage in the browser is gone`, game.inventory.get(f2.uid) === undefined);

check('both finds say so where they are looked at',
  [...UNRESTORED].every((id) => itemDef(id).description?.includes('Nothing repairs it before then, and if it breaks first it is gone.')));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a find nobody has restored — ${ok.length} of ${ok.length}`);
