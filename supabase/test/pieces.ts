/**
 * A flag flies its colour and an arch its roses, the same on both sides.
 *
 * Three new pieces -- a flagpole and two rose arches -- and one old gap: a
 * piece set down on an island kept its wood, its rarity and its maker's mark
 * and dropped its dye, so a banner dyed in the pack stood in the settlement
 * undyed and a sail went up white. The browser always kept it. So:
 *
 *   * the three pieces are the same pieces on both sides: their footprint,
 *     who builds them out of what, which carry roses, and that a flagpole
 *     takes a dye;
 *   * a dyed flagpole and a dyed banner set down on each side stand dyed, the
 *     ground read hands the colour to a browser, the browser reads it back,
 *     and picked up again they are still dyed;
 *   * an arch's roses grow from when it was set down: the island hands that
 *     moment over for a rose arch and for nothing else, the browser grows its
 *     roses off it, a night's sleep on the island does not move it, and
 *     setting it down again plants the roses again, on both sides.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on
 * it. Everything it does there is rolled back.
 */
import { execFileSync } from 'node:child_process';
import { Game, type IslandGround } from '../../src/game/game';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import { FURNITURE_BY_ID } from '../../src/game/furniture';
import { RECIPE_BY_ID } from '../../src/game/recipes';
import { DYEABLE_ITEMS } from '../../src/game/dyes';
import { ROSE_BUD, ROSE_FLOWER, ROSE_LEAFY, roseStage } from '../../src/game/roses';

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
const said = (lines: string, tag: string): string =>
  lines.split('\n').map((l) => l.trim()).find((l) => l.startsWith(`${tag}|`))?.slice(tag.length + 1) ?? '(nothing)';

const PIECES = ['flagpole', 'rose_arch', 'stone_rose_arch'];
const X = 50, Y = 20;
const DAY = 86400;

/* ---- the pieces themselves ------------------------------------------------ */

const defs = psql(`
select string_agg(f.id || ' ' || f.w || 'x' || f.h || ' ' || f.roses || ' ' || r.skill || ' ' || coalesce(r.tool, '-') || ' '
    || (select string_agg(i.item || ':' || i.count, ',' order by i.item) from recipe_input i where i.recipe = r.id)
    || ' ' || exists (select 1 from dyeable_item d where d.id = f.id), '|' order by f.id)
  from furniture_def f join recipe r on r.id = 'make_' || f.id
 where f.id in (${PIECES.map((p) => `'${p}'`).join(', ')});`);
const mine = PIECES.slice().sort().map((id) => {
  const f = FURNITURE_BY_ID.get(id);
  const r = RECIPE_BY_ID.get(`make_${id}`);
  const bill = (r?.inputs ?? []).map((i) => `${i.item}:${i.count ?? 1}`).sort().join(',');
  return `${id} ${f?.w}x${f?.h} ${!!f?.roses} ${r?.skill} ${r?.tool ?? '-'} ${bill} ${DYEABLE_ITEMS.has(id)}`;
}).join('|');
check('the flagpole and the two rose arches are the same pieces, built the same way, on both sides', defs === mine, `browser ${mine}, island ${defs}`);

/* ---- set down dyed, read dyed, picked up dyed ---------------------------- */

const island = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid; v_it bigint; v_id bigint; v_row jsonb; v_set double precision; v_kind text;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  update player set x = ${X}.5, y = ${Y}.5, level = 0 where world_id = w and uid = u;
  delete from placed where world_id = w and x between ${X - 1} and ${X + 3} and y between ${Y - 1} and ${Y + 1};
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  foreach v_kind in array array['flagpole', 'banner'] loop
    v_it := give(w, u, v_kind, 1, 40);
    update item set dye = 'woad' where id = v_it;
    insert into said values ('PLACE_' || v_kind || '|' || coalesce(act_refusal(w, u, 'place_furniture',
      jsonb_build_object('kind', 'tile', 'x', ${X + 1}, 'y', ${Y}, 'sx', 1, 'sy', 1, 'itemUid', v_it)), 'ALLOWED'));
    perform act_perform(w, u, 'place_furniture', jsonb_build_object('kind', 'tile', 'x', ${X + 1}, 'y', ${Y}, 'sx', 1, 'sy', 1, 'itemUid', v_it));
    select pl.id into v_id from placed pl where pl.world_id = w and pl.sub = v_kind and pl.x = ${X + 1} and pl.y = ${Y} order by pl.id desc limit 1;
    insert into said values ('STANDS_' || v_kind || '|' || coalesce((select dye from placed where id = v_id), 'undyed'));
    v_row := (select e from jsonb_array_elements(rpc_ground(w, 40, false)->'placed') e where (e->>'id')::bigint = v_id);
    insert into said values ('ROW_' || v_kind || '|' || v_row::text);
    perform act_perform(w, u, 'pick_up_furniture', jsonb_build_object('kind', 'furniture', 'id', v_id));
    insert into said values ('BACK_' || v_kind || '|' || coalesce((select string_agg(coalesce(i.dye, 'undyed'), ',') from item i
      where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = v_kind), 'gone'));
  end loop;

  -- An arch: set down, read, slept past, and read again.
  v_it := give(w, u, 'rose_arch', 1, 40, 'Oak');
  perform act_perform(w, u, 'place_furniture', jsonb_build_object('kind', 'tile', 'x', ${X}, 'y', ${Y}, 'sx', 0, 'sy', 1, 'facing', 'e', 'itemUid', v_it));
  select id into v_id from placed where world_id = w and sub = 'rose_arch' order by id desc limit 1;
  insert into said values ('ARCH_MADE|' || extract(epoch from (select made_at from placed where id = v_id)));
  v_row := (select e from jsonb_array_elements(rpc_ground(w, 40, false)->'placed') e where (e->>'id')::bigint = v_id);
  insert into said values ('ARCH_ROW|' || v_row::text);
  -- Two and a half days ago, as far as its roses know.
  update placed set made_at = now() - interval '2.5 days' where id = v_id;
  perform sleep_forward(w, u, 36000);
  v_row := (select e from jsonb_array_elements(rpc_ground(w, 40, false)->'placed') e where (e->>'id')::bigint = v_id);
  insert into said values ('ARCH_OLD|' || (v_row->>'set') || ' ' || extract(epoch from now()));
  -- Picked up and set down again: planted again.
  perform act_perform(w, u, 'pick_up_furniture', jsonb_build_object('kind', 'furniture', 'id', v_id));
  select id into v_it from item where world_id = w and holder = 'player' and holder_uid = u and def = 'rose_arch' order by id desc limit 1;
  perform act_perform(w, u, 'place_furniture', jsonb_build_object('kind', 'tile', 'x', ${X}, 'y', ${Y}, 'sx', 0, 'sy', 1, 'facing', 'e', 'itemUid', v_it));
  select id into v_id from placed where world_id = w and sub = 'rose_arch' order by id desc limit 1;
  v_row := (select e from jsonb_array_elements(rpc_ground(w, 40, false)->'placed') e where (e->>'id')::bigint = v_id);
  insert into said values ('ARCH_AGAIN|' || (v_row->>'set') || ' ' || extract(epoch from now()) || ' ' || coalesce(v_row->>'material', '-'));
end $$;
select k from said;
rollback;`);

const game = Game.create(4242);
const place = (kind: string, dye?: string, extra?: string): { set: string; back: string } => {
  game.inventory.items.length = 0;
  const it = game.inventory.add(kind, { ql: 40, extra });
  if (dye) it.dye = dye;
  const t: Target = { kind: 'tile', x: game.player.tileX + 1, y: game.player.tileY, cx: 0, cy: 0, sx: 1, sy: 1, itemUid: it.uid, facing: 's' };
  const def = ACTION_BY_ID.get('place_furniture');
  const why = def?.check?.(t, game) ?? null;
  if (why) return { set: `refused: ${why}`, back: '-' };
  def?.perform(t, game);
  const f = [...game.furniture.values()].pop();
  const stood = f?.dye ?? 'undyed';
  const setAt = f?.setAt;
  if (f) ACTION_BY_ID.get('pick_up_furniture')?.perform({ kind: 'furniture', id: f.id }, game);
  const back = game.inventory.items.filter((i) => i.id === kind).map((i) => i.dye ?? 'undyed').join(',');
  return { set: `${stood}${setAt === undefined ? '' : ` set ${setAt}`}`, back };
};

for (const kind of ['flagpole', 'banner']) {
  check(`a dyed ${kind} is let down on the island`, said(island, `PLACE_${kind}`) === 'ALLOWED', said(island, `PLACE_${kind}`));
  const b = place(kind, 'woad');
  check(`a dyed ${kind} stands dyed on both sides`, b.set === 'woad' && said(island, `STANDS_${kind}`) === 'woad', `browser ${b.set}, island ${said(island, `STANDS_${kind}`)}`);
  // The browser reads the island's row as it comes.
  const row = JSON.parse(said(island, `ROW_${kind}`));
  const reader = Game.create(4242);
  reader.sawGround({ placed: [row] } as unknown as IslandGround);
  const read = [...reader.furniture.values()][0];
  check(`the ground read hands a ${kind}'s colour over, and the browser reads it`, row.dye === 'woad' && read?.dye === 'woad' && read?.kind === kind,
    `the row says ${row.dye}, the browser reads ${read?.dye} on a ${read?.kind}`);
  check(`and a ${kind} carries no moment of planting, having no roses`, row.set === undefined && read?.setAt === undefined, `row ${row.set}, browser ${read?.setAt}`);
  check(`picked up again it is still dyed, on both sides`, b.back === 'woad' && said(island, `BACK_${kind}`) === 'woad', `browser ${b.back}, island ${said(island, `BACK_${kind}`)}`);
}

/* ---- an arch's roses ------------------------------------------------------ */

const made = Number(said(island, 'ARCH_MADE'));
const archRow = JSON.parse(said(island, 'ARCH_ROW'));
check('the ground read hands a rose arch over with the moment it was set down', Math.abs(Number(archRow.set) - made) < 1e-3, `set ${archRow.set}, made_at ${made}`);
const reader = Game.create(4242);
reader.sawGround({ placed: [archRow] } as unknown as IslandGround);
const arch = [...reader.furniture.values()][0];
check('and the browser plants its roses at that moment', arch?.setAt !== undefined && Math.abs((arch?.setAt ?? 0) - made) < 1e-3, `browser ${arch?.setAt}`);
check('just set down, its roses are bare', roseStage(arch?.setAt, made + 60).stage === 'bare');
const [oldSet, oldNow] = said(island, 'ARCH_OLD').split(' ').map(Number);
check('a night slept on the island does not move it', Math.abs(oldNow - oldSet - 2.5 * DAY) < 5, `${((oldNow - oldSet) / DAY).toFixed(3)} days`);
const grown = roseStage(oldSet, oldNow);
check(`two and a half days on, between ${ROSE_BUD} and ${ROSE_FLOWER}, they are in bud in their season and in leaf out of it`,
  grown.stage === (grown.blooms ? 'bud' : 'leafy'), `${grown.stage}, ${grown.blooms ? 'in season' : 'out of season'}`);
const [againSet, againNow, wood] = said(island, 'ARCH_AGAIN').split(' ');
check('picked up and set down again, its roses are planted again, and it is still of its wood', Math.abs(Number(againNow) - Number(againSet)) < 5 && wood === 'Oak',
  `set ${againSet}, now ${againNow}, ${wood}`);
const b = place('rose_arch', undefined, 'Oak');
const browserSet = Number(b.set.split(' set ')[1]);
check('and the browser plants the roses on an arch it sets down at the moment it does', Math.abs(browserSet - Date.now() / 1000) < 5, b.set);
// And the stages turn where the rule says they do.
const at = Date.UTC(2026, 9, 1, 15) / 1000;
check(`in spring: bare, in leaf at ${ROSE_LEAFY} day, in bud at ${ROSE_BUD}, in flower at ${ROSE_FLOWER}`,
  [0.5, ROSE_LEAFY + 0.01, ROSE_BUD + 0.01, ROSE_FLOWER + 0.01].map((d) => roseStage(at - d * DAY, at).stage).join(',') === 'bare,leafy,bud,flower');
const autumn = Date.UTC(2026, 9, 14, 15) / 1000;
check('in autumn a grown arch is in leaf', roseStage(autumn - 5 * DAY, autumn).stage === 'leafy');

for (const line of ok) console.log(line);
for (const line of bad) console.log(line);
console.log(bad.length === 0 ? `a flag flies its colour and an arch its roses, the same on both sides (${ok.length} agreements)` : `THEY DISAGREE (${bad.length})`);
process.exit(bad.length === 0 ? 0 : 1);
