/**
 * Glassblowing, held to its rule on both sides.
 *
 *   * the trade: a skill on both sides, and the Artisan's on both;
 *   * the four jobs at a hot smelter -- sand melted into lumps, a lump blown
 *     into a panel, sand blown into a bottle, a gem and sand fired into a
 *     batch of stained glass panes -- the same bill, count and trade on both sides,
 *     and each made on the island, the skill going up as it is worked;
 *   * a firing of stained glass that fails keeps the gem and the sand;
 *   * a window and a bay are glazed with panels, and a pane is called one;
 *   * the stained glass wall: the same bill, weight and height on both sides;
 *   * a bottle is a bag of one food or drink, and turns away a log in the
 *     browser's own words.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
// First, so the rules load in the order the game loads them: building and items lean on each other.
import { ACTIONS } from '../../src/game/actions';
import { MATERIAL_BY_ID, onlyRefusal, onlySaid, wallBill, WALL_TYPE_BY_ID, WALL_TYPES } from '../../src/game/building';
import { CRAFT_CLASSES } from '../../src/game/classes';
import { bagRefuses, ITEM_DEFS, type Item } from '../../src/game/items';
import { RECIPE_BY_ID, type Recipe } from '../../src/game/recipes';
import { SKILL_DEFS } from '../../src/game/skills';

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

void ACTIONS.length;
const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const recipe = (id: string): Recipe => {
  const r = RECIPE_BY_ID.get(id);
  if (!r) throw new Error(`there is no recipe ${id}`);
  return r;
};
const LUMPS = recipe('make_glass');
const PANEL = recipe('make_glass_panel');
const BOTTLE = recipe('make_bottle');
const PANES = recipe('make_stained_glass');
const JOBS = [LUMPS, PANEL, BOTTLE, PANES];

/* ---- the trade ------------------------------------------------------------- */
check('glassblowing is a skill on both sides',
  SKILL_DEFS.some((s) => s.id === 'glassblowing') && psql(`select count(*) from skill_def where id = 'glassblowing';`) === '1');
check('and the Artisan’s trade on both sides',
  !!CRAFT_CLASSES.find((c) => c.id === 'artisan')?.skills.includes('glassblowing')
    && psql(`select string_agg(class, ',') from class_skill where skill = 'glassblowing';`) === 'artisan',
  psql(`select coalesce(string_agg(class, ','), 'nobody') from class_skill where skill = 'glassblowing';`));

/* ---- the four jobs, as each side holds them ---------------------------------- */
const said = (r: Recipe): string => [r.result, r.count ?? 1, r.skill, r.station ?? '', !!r.consumeOnFail,
  r.inputs.map((i) => `${i.item}x${i.count ?? 1}`).join(',')].join('|');
for (const r of JOBS) {
  const theirs = psql(`select r.result || '|' || r.count || '|' || r.skill || '|' || coalesce(r.station, '') || '|' || r.consume_on_fail
      || '|' || (select string_agg(i.item || 'x' || i.count, ',' order by i.ord) from recipe_input i where i.recipe = r.id)
    from recipe r where r.id = '${r.id}';`).replace(/\|t\|/, '|true|').replace(/\|f\|/, '|false|');
  check(`${r.label}: the same job on both sides`, theirs === said(r), `browser ${said(r)}, island ${theirs || 'nothing'}`);
}
check('every one of them is glassblowing at a hot smelter', JOBS.every((r) => r.skill === 'glassblowing' && r.station === 'smelter'));

/* ---- and made on the island ------------------------------------------------- */
const count = (def: string): string =>
  `(select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = '${def}')`;
const newest = (def: string): string =>
  `(select i.id from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = '${def}' order by i.id desc limit 1)`;
const craft = (id: string, uid: string): string =>
  `perform perform_craft(w, u, '${id}', jsonb_build_object('kind', 'item', 'uid', ${uid}))`;
const checks = (pass: boolean): string =>
  `create or replace function skill_check(p_skill double precision, p_difficulty double precision,
     p_tool_ql double precision default 0, p_ease double precision default 0)
     returns boolean language sql as 'select ${pass}'`;
const n = (r: Recipe, item: string): number => r.inputs.find((i) => i.item === item)?.count ?? 1;

const out = psql(`
begin;
create temp table said (k text, v text);
do $$
declare w uuid; u uuid; tx int; ty int; v_before double precision; v_b bigint;
begin
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  for tx in 0..15 loop for ty in 0..15 loop
    perform land_set_height(w, tx, ty, 40); perform land_set_dirt(w, tx, ty, 20);
    perform land_set_tile(w, tx, ty, tile_id('Dirt')); perform land_set_data(w, tx, ty, 0);
  end loop; end loop;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  delete from player_node where world_id = w and uid = u;
  delete from placed where world_id = w and x between 6 and 15 and y between 6 and 13;
  update player set x = 9.5, y = 9.5, act = null, act_target = null, act_queue = '[]', craft_from_stores = false,
         craft_spare_rare = false, stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
   where world_id = w and uid = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  insert into skill (world_id, uid, id, value) values (w, u, 'glassblowing', 20)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  insert into placed (world_id, kind, x, y, sx, sy, cx, cy, ql, fuel, lit, state, made_by)
    values (w, 'smelter', 10, 9, 0, 0, 10.375, 9.25, 50, 600, true, '{"jobs": [], "output": []}'::jsonb, u);
  ${checks(true)};

  perform give(w, u, 'sand', ${n(LUMPS, 'sand')}, 30, null, null, null, null, null);
  ${craft(LUMPS.id, newest('sand'))};
  insert into said values ('LUMPS', ${count(LUMPS.result)}::text || '|' || ${count('sand')});

  ${craft(PANEL.id, newest(LUMPS.result))};
  insert into said values ('PANEL', ${count(PANEL.result)}::text || '|' || ${count(LUMPS.result)});

  perform give(w, u, 'sand', ${n(BOTTLE, 'sand')}, 30, null, null, null, null, null);
  ${craft(BOTTLE.id, newest('sand'))};
  insert into said values ('BOTTLE', ${count(BOTTLE.result)}::text || '|' || ${count('sand')});

  select value into v_before from skill where world_id = w and uid = u and id = 'glassblowing';
  perform give(w, u, 'gem', 1, 40, 'Ruby', null, null, null, null);
  perform give(w, u, 'sand', ${n(PANES, 'sand')}, 30, null, null, null, null, null);
  ${craft(PANES.id, newest('gem'))};
  insert into said values ('PANES', ${count(PANES.result)}::text || '|' || ${count('gem')} || '|' || ${count('sand')});
  insert into said values ('LEARNT', ((select value from skill where world_id = w and uid = u and id = 'glassblowing') > v_before)::text);

  ${checks(false)};
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = '${PANES.result}';
  perform give(w, u, 'gem', 1, 40, 'Ruby', null, null, null, null);
  perform give(w, u, 'sand', ${n(PANES, 'sand')}, 30, null, null, null, null, null);
  ${craft(PANES.id, newest('gem'))};
  insert into said values ('SPOILT', ${count(PANES.result)}::text || '|' || ${count('gem')} || '|' || ${count('sand')});

  v_b := give(w, u, 'bottle', 1, 30, null, null, null, null, null);
  insert into said values ('REFUSE', coalesce(bag_refuses((select i from item i where i.id = v_b), 'log', 1), 'ALLOWED'));

  -- A half wall of stained glass, on open ground, trowel and all: refused for what it is laid as.
  perform give(w, u, 'trowel', 1, 30, null, null, null, null, null);
  insert into said values ('FENCE', coalesce(act_refusal(w, u, 'plan_fence', jsonb_build_object('kind', 'tile', 'x', 9, 'y', 10,
    'side', 'n', 'wallType', 'half_wall', 'material', 'stained_glass')), 'ALLOWED'));
  insert into said values ('SOLIDFENCE', coalesce(act_refusal(w, u, 'plan_fence', jsonb_build_object('kind', 'tile', 'x', 9, 'y', 10,
    'side', 'n', 'wallType', 'half_wall', 'material', 'stone_brick')), 'ALLOWED'));
end $$;
select k || '=' || v from said order by k;
rollback;`);
const got = (k: string): string => out.split('\n').find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1) ?? 'MISSING';

check(`${LUMPS.label}: ${n(LUMPS, 'sand')} sand make ${LUMPS.count} ${ITEM_DEFS[LUMPS.result].name.toLowerCase()}s, and the sand is spent`,
  got('LUMPS') === `${LUMPS.count}|0`, got('LUMPS'));
check(`${PANEL.label}: a lump makes a ${ITEM_DEFS[PANEL.result].name.toLowerCase()}`, got('PANEL') === `${PANEL.count ?? 1}|${(LUMPS.count ?? 1) - 1}`, got('PANEL'));
check(`${BOTTLE.label}: ${n(BOTTLE, 'sand')} sand make a bottle`, got('BOTTLE') === '1|0', got('BOTTLE'));
check(`${PANES.label}: a gem and ${n(PANES, 'sand')} sand make ${PANES.count} panes`, got('PANES') === `${PANES.count}|0|0`, got('PANES'));
check('and glassblowing goes up for the work', got('LEARNT') === 'true', got('LEARNT'));
check('a firing that fails keeps the gem and the sand', got('SPOILT') === `0|1|${n(PANES, 'sand')}`, got('SPOILT'));

/* ---- what glass goes into ---------------------------------------------------- */
check('a pane is a glass panel on both sides',
  ITEM_DEFS.glass.name === 'Glass panel' && psql(`select name from item_def where id = 'glass';`) === 'Glass panel');
for (const type of ['window', 'bay'] as const) {
  const want = WALL_TYPE_BY_ID.get(type)?.fittings?.find(([item]) => item === 'glass')?.[1] ?? 0;
  const theirs = Number(psql(`select coalesce((wall_bill('stone_brick', '${type}')->>'glass')::int, 0);`));
  check(`a ${type === 'bay' ? 'bay window' : 'window'} is glazed with ${want} panels on both sides`,
    want > 0 && (wallBill('stone_brick', type).total.glass ?? 0) === want && theirs === want, `island ${theirs}`);
}

/* ---- the stained glass wall ----------------------------------------------------------- */
const STAINED = MATERIAL_BY_ID.get('stained_glass');
const mine = JSON.stringify(Object.entries(wallBill('stained_glass', 'solid').total).sort());
const theirs = JSON.stringify(Object.entries(JSON.parse(psql(`select wall_bill('stained_glass', 'solid')::text;`) || '{}') as Record<string, number>).sort());
check('a solid stained glass wall takes the same bill on both sides, stained glass panes and all',
  mine === theirs && mine.includes('stained_glass_pane'), `browser ${mine}, island ${theirs}`);
check('and is laid with a trowel, in masonry, as heavy and as tall on both sides',
  !!STAINED && psql(`select kind || '|' || tool || '|' || skill || '|' || storeys || '|' || heft from build_material_def where id = 'stained_glass';`)
    === `${STAINED.kind}|${STAINED.tool}|${STAINED.skill}|${STAINED.storeys}|${STAINED.heft}`);
check('one firing of stained glass glazes one solid wall', (PANES.count ?? 1) === (wallBill('stained_glass', 'solid').total.stained_glass_pane ?? 0));

/* ---- the bottle ------------------------------------------------------------------ */
const B = ITEM_DEFS.bottle;
check('a bottle holds as much, keeps as well, and one kind, on both sides',
  psql(`select holds || '|' || shelter || '|' || one_kind from item_def where id = 'bottle';`) === `${B.holds}|${B.shelter}|${!!B.oneKind}`);
const bottle: Item = { uid: 1, id: 'bottle', ql: 30, dmg: 0, count: 1, inside: [] };
const log: Item = { uid: 2, id: 'log', ql: 30, dmg: 0, count: 1 };
check('and turns a log away in the same words', got('REFUSE') === bagRefuses(bottle, log), `browser "${bagRefuses(bottle, log)}", island "${got('REFUSE')}"`);

/* ---- stained glass is a solid wall, a floor or a roof, and nothing else ----------------------------- */
const M = MATERIAL_BY_ID.get('stained_glass')!;
const asked = [
  ...WALL_TYPES.map((wt) => ({ what: `a ${wt.name.toLowerCase()}`, mine: onlyRefusal('stained_glass', { wall: wt.id }), sql: `'${wt.id}', null` })),
  ...(['floor', 'stairs', 'ladder', 'roof'] as const).map((k) => ({ what: `a ${k}`, mine: onlyRefusal('stained_glass', { floor: k }), sql: `null, '${k}'` })),
  { what: 'a column', mine: onlyRefusal('stained_glass', { column: true }), sql: `'column', null` },
];
const theirsOnly = psql(asked.map((a) => `select coalesce(material_only_refusal('stained_glass', ${a.sql}), 'ALLOWED');`).join('\n')).split('\n');
const allowed = asked.filter((a) => a.mine === null).map((a) => a.what);
check('stained glass is laid as a solid wall, a floor or a roof, and as nothing else, on both sides',
  asked.every((a, i) => (a.mine ?? 'ALLOWED') === theirsOnly[i]) && allowed.join() === 'a solid,a floor,a roof',
  `allowed: ${allowed.join(', ')}; differ: ${asked.filter((a, i) => (a.mine ?? 'ALLOWED') !== theirsOnly[i]).map((a) => a.what).join(', ') || 'none'}`);
check('and it says so in the same words everywhere it is refused', theirsOnly.filter((s) => s !== 'ALLOWED').every((s) => s === onlySaid(M)), onlySaid(M));
check('every other material is laid as anything', [...MATERIAL_BY_ID.values()].filter((m) => !m.only).every((m) =>
  WALL_TYPES.every((wt) => onlyRefusal(m.id, { wall: wt.id }) === null) && onlyRefusal(m.id, { column: true }) === null));
check('the island turns away a half wall of stained glass in those words, and lets one of stone brick through that check',
  got('FENCE') === onlySaid(M) && got('SOLIDFENCE') !== onlySaid(M), `${got('FENCE')} / ${got('SOLIDFENCE')}`);

for (const l of [...ok, ...bad]) console.log(l);
console.log(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
if (bad.length) process.exit(1);
