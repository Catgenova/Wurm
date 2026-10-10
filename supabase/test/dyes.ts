/**
 * Dye as a liquid (`dyestuffs.ts`, `dyes.ts`), on both sides.
 *
 * Dye is boiled in three colours only and every other colour is mixed by
 * pouring; its QL is its brightness, black at 1 and white at 100; a thing
 * dyed takes exactly the dye's colour, by litres out of a bucket of it; and
 * everything from before dye was mixed keeps its colour. So this asks:
 *
 *   * of the arithmetic, over thousands of seeded random mixes: the hex, the
 *     colour word, QL 1 black and QL 100 white for any mix, a pour of one dye
 *     into another, the text a dye is written in and what Examine says of it
 *     are the same on the island as in the browser;
 *   * of the tables: every dyestuff boils into its one primary and nothing
 *     else boils at all, the litres a dyeing takes, the colour words, and the
 *     mix nearest each old dye;
 *   * of the island, playing it: a boil of each dyestuff leaves a bucket of its
 *     primary; 2 litres of red and 2 of blue at QL 50 poured into a barrel are
 *     4 litres half and half at QL 50; a bucket drawn back out of it is the
 *     same mix; dye refuses to go in with water and water with dye, in the
 *     browser's words; Examine on the barrel and the bucket says the hex, QL,
 *     litres and mix; dyeing a tunic gives it exactly the dye's hex; and a pot,
 *     a dyed tunic and a dyed banner from before are what the browser's save
 *     loader makes of them;
 *   * and of the browser, on a game of its own: the same boil, pour, draw,
 *     refusals, Examine and dyeing, in the same words as the island.
 *
 * Everything random is seeded: `mulberry32` here, and the island's dice are
 * taken out of it (a check that always passes, a product QL that is fixed).
 * The island half is rolled back.
 *
 *   npx esbuild supabase/test/dyes.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/dyes.mjs && node node_modules/.cache/dyes.mjs
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import { ARMOUR } from '../../src/game/gear';
import { itemName, ITEM_DEFS, type Item } from '../../src/game/items';
import { RECIPES, RECIPE_BY_ID } from '../../src/game/recipes';
import {
  colourWord, DYE_BOIL_LITRES, DYE_LITRES, DYE_PARTS, DYE_QL_BLACK, DYE_QL_WHITE, DYE_WORDS, dyeHex, dyeIn, dyeLitresFor, dyeRecipeId, dyeSays,
  DYESTUFFS, dyeText, LEGACY_DYES, legacyLiquid, mixDye, pureDye, readDye, upgradeDyes, type DyeLiquid,
} from '../../src/game/dyestuffs';
import { DYEABLE_ITEMS, dyedAlready, NO_DYE, takesDye, tooLittleDye } from '../../src/game/dyes';
import { BUCKET_LITRES, type PlacedFurniture } from '../../src/game/furniture';
import { noMixing, vesselSays } from '../../src/game/placeables';
import { mulberry32 } from '../../src/world/noise';

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
/** The first place two lists differ, for a failure's detail. */
const firstDiff = (a: string[], b: string[]): string => {
  const i = a.findIndex((x, k) => x !== b[k]);
  return i < 0 ? (a.length === b.length ? '' : `${a.length} against ${b.length}`) : `at ${i}: island ${a[i]}, browser ${b[i]}`;
};

/* ---- the arithmetic, over many mixes ------------------------------------------ */

const rand = mulberry32(20261010);
const int = (n: number): number => Math.floor(rand() * n);
/** A mix: any parts of the three, any QL to the hundredth; and now and then a pure one, an even one, and the ends of the QL. */
const randomMix = (): DyeLiquid => {
  const r = int(DYE_PARTS + 1);
  const y = int(DYE_PARTS - r + 1);
  const qls = [DYE_QL_BLACK, DYE_QL_WHITE, 50, 1 + int(9900) / 100];
  return { red: r, yellow: y, blue: DYE_PARTS - r - y, ql: qls[int(8) < 6 ? 3 : int(3)] };
};
const MIXES: DyeLiquid[] = [pureDye('red', 50), pureDye('yellow', 50), pureDye('blue', 50),
  { red: 500, yellow: 500, blue: 0, ql: 50 }, { red: 0, yellow: 500, blue: 500, ql: 50 }, { red: 500, yellow: 0, blue: 500, ql: 50 },
  { red: 334, yellow: 333, blue: 333, ql: 50 }];
while (MIXES.length < 3000) MIXES.push(randomMix());
const asRows = (ls: DyeLiquid[]): string =>
  `unnest(array[${ls.map((l) => l.red).join(',')}]::int[], array[${ls.map((l) => l.yellow).join(',')}]::int[],
          array[${ls.map((l) => l.blue).join(',')}]::int[], array[${ls.map((l) => l.ql).join(',')}]::double precision[]) with ordinality u(r, y, b, ql, o)`;
const mixOf = 'row(u.r, u.y, u.b, u.ql, null)::dye_mix';

{
  const here = MIXES.map((l) => `${dyeHex(l)}:${colourWord(dyeHex(l)).replace(/ /g, '_')}`);
  // A word with a space in it is written with an underscore on both sides, so the list splits on spaces.
  const isleWords = psql(`select string_agg(dye_hex(${mixOf}) || ':' || replace(colour_word(dye_hex(${mixOf})), ' ', '_'), ' ' order by o) from ${asRows(MIXES)}`).split(' ');
  check(`the hex and the colour word of ${MIXES.length} seeded mixes are the same on both sides`, isleWords.join(' ') === here.join(' '),
    firstDiff(isleWords, here) || `${new Set(here.map((h) => h.split(':')[1])).size} words in use`);
  check('red, yellow and blue at QL 50 are the RYB cube\'s red, yellow and blue; red and blue make purple, and all three brown',
    here.slice(0, 7).join(' ') === '#ff0000:red #ffff00:yellow #2a5f99:blue #ff8000:orange #00a833:green #800080:purple #341800:dark_brown',
    here.slice(0, 7).join(' '));
}
{
  const ends = (ql: number): string[] => MIXES.map((l) => dyeHex({ ...l, ql }));
  const isle = psql(`select string_agg(dye_hex(row(u.r, u.y, u.b, ${DYE_QL_BLACK}, null)::dye_mix) || '/' || dye_hex(row(u.r, u.y, u.b, ${DYE_QL_WHITE}, null)::dye_mix), ' ' order by o) from ${asRows(MIXES)}`).split(' ');
  check(`at QL ${DYE_QL_BLACK} every one of them is #000000 and at QL ${DYE_QL_WHITE} #ffffff, on both sides`,
    ends(DYE_QL_BLACK).every((h) => h === '#000000') && ends(DYE_QL_WHITE).every((h) => h === '#ffffff') && isle.every((s) => s === '#000000/#ffffff'),
    `${new Set(isle).size} distinct on the island`);
}
{
  // Pours: any two dyes, any litres, mixed and written down.
  const as = MIXES.slice(0, 1500), bs = MIXES.slice(1500, 3000);
  const la = as.map(() => 1 + int(250)), lb = bs.map(() => 1 + int(250));
  const isle = psql(`select string_agg(dye_text(dye_mixed(row(a.r, a.y, a.b, a.ql, null)::dye_mix, la, row(b.r, b.y, b.b, b.ql, null)::dye_mix, lb)), ' ' order by a.o)
    from ${asRows(as).replace(/u\(r, y, b, ql, o\)/, 'a(r, y, b, ql, o)')}
    join ${asRows(bs).replace(/u\(r, y, b, ql, o\)/, 'b(r, y, b, ql, o)')} on b.o = a.o
    join unnest(array[${la.join(',')}]::double precision[], array[${lb.join(',')}]::double precision[]) with ordinality l(la, lb, o) on l.o = a.o`).split(' ');
  const here = as.map((a, i) => dyeText(mixDye(a, la[i], bs[i], lb[i])));
  check(`${as.length} seeded pours of one dye into another mix to the same parts and QL on both sides, the parts always adding up`,
    isle.join(' ') === here.join(' ') && here.every((t) => { const d = readDye(t)?.liquid; return !!d && d.red + d.yellow + d.blue === DYE_PARTS && d.red >= 0 && d.yellow >= 0 && d.blue >= 0; }),
    firstDiff(isle, here));
  const two = dyeText(mixDye(pureDye('red', 50), 2, pureDye('blue', 50), 2));
  const twoIsle = psql(`select dye_text(dye_mixed(dye_pure('red', 50), 2, dye_pure('blue', 50), 2)) || ' ' || dye_hex(dye_mixed(dye_pure('red', 50), 2, dye_pure('blue', 50), 2))`);
  check('2 litres of red at QL 50 and 2 of blue at QL 50 are half and half at QL 50, the browser\'s hex, on both sides',
    two === 'r500y0b500q5000' && twoIsle === `${two} ${dyeHex(readDye(two)!.liquid)}`, `${twoIsle} / ${two} ${dyeHex(readDye(two)!.liquid)}`);
}
{
  const some = MIXES.slice(0, 400);
  const litres = some.map(() => 1 + int(250));
  const isle = psql(`select string_agg(dye_says(${mixOf}, l.n) || '#' || dye_text(dye_read(dye_text(${mixOf}, l.n::int)), l.n::int), '|' order by u.o)
    from ${asRows(some)} join unnest(array[${litres.join(',')}]::double precision[]) with ordinality l(n, o) on l.o = u.o`).split('|');
  const here = some.map((l, i) => `${dyeSays(l, litres[i])}#${dyeText(readDye(dyeText(l, litres[i]))!.liquid, litres[i])}`);
  check(`what Examine says of dye, and a dye written down and read back, are the same on both sides for ${some.length} of them`,
    isle.join('|') === here.join('|'), firstDiff(isle, here));
}

/* ---- the tables ------------------------------------------------------------------ */

{
  const isle = psql(`select string_agg(recipe || ':' || item || ':' || primary_colour, ' ' order by recipe) from dyestuff_def`);
  const here = DYESTUFFS.map((d) => `${dyeRecipeId(d.from)}:${d.from}:${d.primary}`).sort().join(' ');
  const boiled = RECIPES.filter((r) => r.result === 'dye_bucket');
  const isleRecipes = psql(`select string_agg(r.id || ':' || r.result || ':' || (select string_agg(i.item || '*' || i.count, ',' order by i.ord) from recipe_input i where i.recipe = r.id), ' ' order by r.id)
    from recipe r where r.result = 'dye_bucket' or r.id like 'make_dye_%' or exists (select 1 from recipe_input i where i.recipe = r.id and i.item in ('acorn', 'mint', 'nuts', 'water_lily') and r.result like 'dye%')`);
  const hereRecipes = boiled.map((r) => `${r.id}:${r.result}:${r.inputs.map((i) => `${i.item}*${i.count ?? 1}`).join(',')}`).sort().join(' ');
  check(`every dyestuff boils into its one primary, the same on both sides: ${DYESTUFFS.map((d) => `${d.from} ${d.primary}`).join(', ')}`,
    isle === here && isleRecipes === hereRecipes && boiled.length === DYESTUFFS.length
      && DYESTUFFS.every((d) => ['red', 'yellow', 'blue'].includes(d.primary)),
    isle === here ? isleRecipes : isle);
  check('acorns, mint, nuts and water lilies boil into nothing any more, and are still there for everything else',
    !RECIPES.some((r) => r.result === 'dye_bucket' && r.inputs.some((i) => ['acorn', 'mint', 'nuts', 'water_lily'].includes(i.item)))
      && ['acorn', 'mint', 'nuts', 'water_lily'].every((id) => !!ITEM_DEFS[id]) && !ITEM_DEFS.dye,
    hereRecipes);
}
{
  const ids = [...new Set([...DYEABLE_ITEMS, ...ARMOUR.filter((a) => takesDye(a.id)).map((a) => a.id), 'hatchet'])].sort();
  const isle = psql(`select string_agg(id || ':' || dye_litres_for(id), ' ' order by id collate "C") from unnest(array[${ids.map(q).join(',')}]::text[]) id`);
  const here = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((id) => `${id}:${dyeLitresFor(id)}`).join(' ');
  check(`a dyeing takes the same litres on both sides: ${DYE_LITRES.garment} for a garment, ${DYE_LITRES.banner} for a banner or a flag, ${DYE_LITRES.sail} a sail, ${DYE_LITRES.ship} a caravel`,
    isle === here && dyeLitresFor('cloth_tunic') === DYE_LITRES.garment && dyeLitresFor('banner') === DYE_LITRES.banner
      && dyeLitresFor('sailing_boat') === DYE_LITRES.sail && dyeLitresFor('caravel') === DYE_LITRES.ship
      && psql(`select dye_litres_of('wall') || ':' || dye_litres_of('floor')`) === `${DYE_LITRES.wall}:${DYE_LITRES.floor}`,
    isle === here ? '' : `island ${isle.slice(0, 200)}`);
}
{
  const isle = psql(`select string_agg(word || ':' || hex, ' ' order by ord) from dye_word_def`);
  check('the colour words are the browser\'s, each at the same colour', isle === DYE_WORDS.map(([w, h]) => `${w}:${h}`).join(' '), isle);
  const legacy = psql(`select string_agg(id || ':' || hex || ':' || liquid || ':' || dye_hex_of(id), ' ' order by ord) from dye_legacy`);
  const legacyHere = LEGACY_DYES.map((d) => `${d.id}:${d.colour}:${dyeText(legacyLiquid(d.id)!)}:${d.colour}`).join(' ');
  check('each old dye is handed over with its colour and the mix nearest it, which a dyed thing reads as that colour',
    legacy === legacyHere, legacy);
  const worst = LEGACY_DYES.map((d) => {
    const [a, b] = [d.colour, dyeHex(legacyLiquid(d.id)!)].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
    return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  });
  // The RYB cube has no violet as blue as lavender was: that one is the furthest, 14 out on its blue.
  check(`and the nearest mix is within ${Math.max(...worst)} of each old colour on every channel (out of 255)`, Math.max(...worst) <= 16, worst.join(','));
  const mixing = [['dye', 'water', 'barrel'], ['water', 'dye', 'barrel'], ['ale', 'dye', 'large barrel'], ['water', 'dye', 'bucket']] as const;
  const isleMix = psql(`select string_agg(no_mixing(f, i, v), '|' order by o) from unnest(array[${mixing.map((m) => q(m[0])).join(',')}], array[${mixing.map((m) => q(m[1])).join(',')}],
    array[${mixing.map((m) => q(m[2])).join(',')}]) with ordinality x(f, i, v, o)`);
  check('dye and anything else refuse each other in the same words', isleMix === mixing.map(([f, i, v]) => noMixing(f, i, v)).join('|'), isleMix);
}

/* ---- the island, played ------------------------------------------------------------ */

const MIRA = 'd7e00000-0000-4000-8000-000000000001';
const HANDS_QL = 37.5;
const RED2 = dyeText(pureDye('red', 50), 2), BLUE2 = dyeText(pureDye('blue', 50), 2);
const TOPUP = dyeText(pureDye('red', 20), 3), YELLOW_BARREL = dyeText(pureDye('yellow', 80));
const PURPLE4 = dyeText(mixDye(pureDye('red', 50), 2, pureDye('blue', 50), 2), 4);
const out = psql(`
begin;
create temp table said (k text, v text);
-- Nothing left to chance: every check passes, a boil comes off at ${HANDS_QL}, nothing comes up rare and no bauble adds a go.
create or replace function skill_check(p_skill double precision, p_difficulty double precision,
  p_tool_ql double precision default 0, p_ease double precision default 0) returns boolean language sql as 'select true';
create or replace function product_ql(p_skill double precision, p_tool_ql double precision default 0)
  returns double precision language sql as 'select ${HANDS_QL}::double precision';
create or replace function perk_rare(p_chance double precision) returns text language sql as 'select null::text';
create or replace function bauble_yield(p_world uuid, p_uid uuid, p_item text, p_n integer) returns integer language sql as 'select p_n';
do $t$
declare w uuid; u uuid := '${MIRA}'; d record; v_b bigint; v_r bigint; v_bl bigint; v_barrel bigint; v_tunic bigint; v_x bigint;
        bt jsonb; v_t text;
begin
  insert into world (name, seed, size, spawn_x, spawn_y, ready) values ('Dyes', 4245, 64, 30, 30, true) returning id into w;
  perform land_blank(w, 64);
  insert into said values ('WORLD', w::text);
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  perform rpc_join(w, 'Mira');
  update player set x = 30.5, y = 30.5, level = 0 where world_id = w and uid = u;

  -- 1. A boil of each dyestuff.
  for d in select * from dyestuff_def order by recipe loop
    delete from item where world_id = w and holder_uid = u;
    perform give(w, u, d.item, (select count from recipe_input where recipe = d.recipe and item = d.item), 30);
    perform give(w, u, 'lye_bucket', 1, 30);
    perform perform_craft(w, u, d.recipe, jsonb_build_object('kind', 'item', 'uid', null));
    insert into said select 'BOIL_' || d.recipe, string_agg(i.def || ':' || coalesce(i.dye, '-') || ':' || i.ql || ':' || i.count, ',' order by i.id)
      from item i where i.world_id = w and i.holder_uid = u;
  end loop;

  -- 2. Two litres of red and two of blue, poured into a barrel.
  delete from item where world_id = w and holder_uid = u;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, litres, since)
    values (w, 'furniture', 'barrel', 31, 30, 0, 0, 31.5, 30.5, 40, u, 0, now()) returning id into v_barrel;
  bt := jsonb_build_object('kind', 'furniture', 'id', v_barrel);
  v_r := give(w, u, 'dye_bucket', 1, 40); update item set dye = ${q(RED2)} where id = v_r;
  v_bl := give(w, u, 'dye_bucket', 1, 40); update item set dye = ${q(BLUE2)} where id = v_bl;
  delete from event where world_id = w and uid = u;
  perform act_perform(w, u, 'pour_into_barrel', jsonb_build_object('kind', 'item', 'uid', v_r));
  perform act_perform(w, u, 'pour_into_barrel', jsonb_build_object('kind', 'item', 'uid', v_bl));
  insert into said select 'POURED', string_agg(e.text, '#' order by e.n) from event e where e.world_id = w and e.uid = u;
  insert into said select 'BARREL', p.liquid || ':' || p.dye || ':' || p.litres from placed p where p.id = v_barrel;
  insert into said select 'EMPTIED', string_agg(i.def || ':' || coalesce(i.dye, '-'), ',' order by i.id) from item i where i.world_id = w and i.holder_uid = u;
  delete from event where world_id = w and uid = u;
  perform act_perform(w, u, 'examine_vessel', bt);
  insert into said select 'LOOK_BARREL', e.text from event e where e.world_id = w and e.uid = u order by e.n desc limit 1;

  -- 3. Drawn back out into an empty bucket: the same mix, and the barrel empty.
  delete from item where world_id = w and holder_uid = u;
  v_b := give(w, u, 'bucket', 1, 40);
  insert into said values ('FILL_ASK', coalesce(act_refusal(w, u, 'fill_bucket', jsonb_build_object('kind', 'item', 'uid', v_b)), 'ALLOWED'));
  delete from event where world_id = w and uid = u;
  perform act_perform(w, u, 'fill_bucket', jsonb_build_object('kind', 'item', 'uid', v_b));
  insert into said select 'FILLED', (select string_agg(i.def || ':' || coalesce(i.dye, '-'), ',') from item i where i.world_id = w and i.holder_uid = u)
    || '#' || (select coalesce(p.liquid, 'none') || ':' || coalesce(p.dye, 'none') || ':' || p.litres from placed p where p.id = v_barrel)
    || '#' || (select e.text from event e where e.world_id = w and e.uid = u order by e.n desc limit 1);
  insert into said select 'NAME', item_name(i) from item i where i.world_id = w and i.holder_uid = u and i.def = 'dye_bucket';
  insert into said select 'LOOK_BUCKET', examine_item_text(w, u, i) from item i where i.world_id = w and i.holder_uid = u and i.def = 'dye_bucket';

  -- 4. What will not mix: dye into water, water into dye, and a bucket of dye topped up beside water.
  delete from item where world_id = w and holder_uid = u;
  update placed set litres = 10, liquid = 'water', dye = null where id = v_barrel;
  v_x := give(w, u, 'dye_bucket', 1, 40); update item set dye = ${q(TOPUP)} where id = v_x;
  insert into said values ('NO_DYE_IN_WATER', coalesce(act_refusal(w, u, 'pour_into_barrel', jsonb_build_object('kind', 'item', 'uid', v_x)), 'ALLOWED'));
  insert into said values ('NO_TOPUP_FROM_WATER', coalesce(act_refusal(w, u, 'fill_bucket', jsonb_build_object('kind', 'item', 'uid', v_x)), 'ALLOWED'));
  update placed set litres = 10, liquid = 'dye', dye = ${q(YELLOW_BARREL)} where id = v_barrel;
  v_b := give(w, u, 'water_bucket', 1, 40);
  insert into said values ('NO_WATER_IN_DYE', coalesce(act_refusal(w, u, 'pour_into_barrel', jsonb_build_object('kind', 'item', 'uid', v_b)), 'ALLOWED'));

  -- 5. And topped up from dye: three litres of dark red and two of light yellow.
  delete from event where world_id = w and uid = u;
  insert into said values ('TOPUP_ASK', coalesce(act_refusal(w, u, 'fill_bucket', jsonb_build_object('kind', 'item', 'uid', v_x)), 'ALLOWED'));
  perform act_perform(w, u, 'fill_bucket', jsonb_build_object('kind', 'item', 'uid', v_x));
  insert into said select 'TOPPED', i.dye || '#' || (select p.litres || ':' || p.dye from placed p where p.id = v_barrel)
    || '#' || (select e.text from event e where e.world_id = w and e.uid = u order by e.n desc limit 1)
    from item i where i.id = v_x;

  -- 6. Dyeing a tunic out of four litres of purple.
  delete from item where world_id = w and holder_uid = u;
  v_x := give(w, u, 'dye_bucket', 1, 40); update item set dye = ${q(PURPLE4)} where id = v_x;
  v_tunic := give(w, u, 'cloth_tunic', 1, 30);
  insert into said select 'PLAIN', item_name(i) || '#' || examine_item_text(w, u, i) from item i where i.id = v_tunic;
  delete from event where world_id = w and uid = u;
  insert into said values ('DYE_ASK', coalesce(act_refusal(w, u, 'dye_item', jsonb_build_object('kind', 'item', 'uid', v_tunic)), 'ALLOWED'));
  perform act_perform(w, u, 'dye_item', jsonb_build_object('kind', 'item', 'uid', v_tunic));
  insert into said select 'DYED', (select i.dye || ':' || item_name(i) from item i where i.id = v_tunic) || '#' || (select i.dye from item i where i.id = v_x)
    || '#' || (select e.text from event e where e.world_id = w and e.uid = u order by e.n desc limit 1);
  insert into said values ('AGAIN', coalesce(act_refusal(w, u, 'dye_item', jsonb_build_object('kind', 'item', 'uid', v_tunic)), 'ALLOWED'));
  insert into said select 'LOOK_TUNIC', examine_item_text(w, u, i) from item i where i.id = v_tunic;
  v_b := give(w, u, 'caravel', 1, 30);
  insert into said values ('TOO_BIG', coalesce(act_refusal(w, u, 'dye_item', jsonb_build_object('kind', 'item', 'uid', v_b)), 'ALLOWED'));
  insert into said values ('STRIP_BUCKET', coalesce(act_refusal(w, u, 'strip_dye', jsonb_build_object('kind', 'item', 'uid', v_x)), 'ALLOWED'));
  delete from item where id = v_x;
  insert into said values ('NONE', coalesce(act_refusal(w, u, 'dye_item', jsonb_build_object('kind', 'item', 'uid', v_tunic)), 'ALLOWED'));

  -- 7. From before: seven pots of woad in the pack, a pot of lily on the ground, a madder tunic, a banner of lotus.
  delete from item where world_id = w and holder_uid = u;
  insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (w, 'player', u, 'dye', 55, 7, 'Woad');
  insert into item (world_id, holder, gx, gy, def, ql, count, extra) values (w, 'ground', 30, 31, 'dye', 45, 1, 'Lily');
  insert into item (world_id, holder, holder_uid, def, ql, count, dye) values (w, 'player', u, 'cloth_tunic', 30, 1, 'madder');
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, dye)
    values (w, 'furniture', 'banner', 33, 30, 0, 0, 33.5, 30.5, 40, u, 'lotus');
  perform dyes_from_before();
  v_t := (select string_agg(i.holder || ':' || i.def || ':' || i.ql || ':' || i.count || ':' || coalesce(i.extra, '-') || ':' || coalesce(i.dye, '-'), ',' order by i.id)
            from item i where i.world_id = w and (i.holder_uid = u or i.holder = 'ground'))
    || '|' || (select p.dye from placed p where p.world_id = w and p.sub = 'banner');
  insert into said values ('BEFORE', v_t);
  perform dyes_from_before();
  insert into said values ('TWICE', ((select string_agg(i.holder || ':' || i.def || ':' || i.ql || ':' || i.count || ':' || coalesce(i.extra, '-') || ':' || coalesce(i.dye, '-'), ',' order by i.id)
            from item i where i.world_id = w and (i.holder_uid = u or i.holder = 'ground'))
    || '|' || (select p.dye from placed p where p.world_id = w and p.sub = 'banner') = v_t)::text);
end $t$;
select k || '=' || v from said order by k;
rollback;`);
const isle = new Map(out.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)] as [string, string]));
const at = (k: string): string => isle.get(k) ?? `(${k} unsaid)`;

for (const d of DYESTUFFS) {
  const r = dyeRecipeId(d.from);
  const [def, dye, ql, count] = at(`BOIL_${r}`).split(':');
  check(`on the island a boil of ${d.from} turns the bucket of lye into ${DYE_BOIL_LITRES} litres of ${d.primary} at the boil's QL, and nothing else is left`,
    def === 'dye_bucket' && count === '1' && dye === dyeText(pureDye(d.primary, Number(ql)), DYE_BOIL_LITRES) && Number(ql) === HANDS_QL,
    at(`BOIL_${r}`));
}

/* ---- the browser, on a game of its own, the same way --------------------------------- */

const g = Game.create(4245);
g.rand = mulberry32(4245);
g.sureCheck = () => true;
const said = (fn: () => void): string => {
  g.log.length = 0;
  fn();
  // What is said of the work, as the island's events of that kind are read: not a skill rising.
  return g.log.filter((l) => l.kind === 'event').map((l) => l.text).join('#');
};
const clear = (): void => { g.inventory.items.length = 0; };
const give = (id: string, ql: number, dye?: string): Item => {
  const it = g.inventory.add(id, { ql });
  if (dye) it.dye = dye;
  return it;
};
const itemT = (it: Item): Target => ({ kind: 'item', uid: it.uid });
const ask = (id: string, t: Target): string => ACTION_BY_ID.get(id)?.check?.(t, g) ?? 'ALLOWED';
const act = (id: string, t: Target): string => said(() => { ACTION_BY_ID.get(id)?.perform(t, g); });
const px = Math.floor(g.player.x), py = Math.floor(g.player.y);
g.player.x = px + 0.5;
g.player.y = py + 0.5;

{
  const wrong: string[] = [];
  for (const d of DYESTUFFS) {
    clear();
    const r = RECIPE_BY_ID.get(dyeRecipeId(d.from))!;
    const stuff = give(d.from, 30);
    stuff.count = r.inputs[0].count ?? 1;
    give('lye_bucket', 30);
    ACTION_BY_ID.get(r.id)?.perform(itemT(stuff), g);
    const left = g.inventory.items;
    const b = left[0];
    if (left.length !== 1 || b?.id !== 'dye_bucket' || b.dye !== dyeText(pureDye(d.primary, b.ql), DYE_BOIL_LITRES)) {
      wrong.push(`${d.from}: ${left.map((i) => `${i.id}:${i.dye}`).join(',')}`);
    }
  }
  check(`in a game of your own a boil of each of the ${DYESTUFFS.length} dyestuffs leaves the same, a bucket of ${DYE_BOIL_LITRES} litres of its primary`,
    wrong.length === 0, wrong.join('; '));
}

const barrel = g.addFurniture('barrel', px + 1, py, 0, 0, 40) as PlacedFurniture;
const bT: Target = { kind: 'furniture', id: barrel.id };
{
  clear();
  const red = give('dye_bucket', 40, RED2);
  const blue = give('dye_bucket', 40, BLUE2);
  const poured = [act('pour_into_barrel', itemT(red)), act('pour_into_barrel', itemT(blue))].join('#');
  check('2 litres of red and 2 of blue poured into a barrel are 4 litres half and half at QL 50, on both sides',
    at('BARREL') === `dye:r500y0b500q5000:4` && `${barrel.liquid}:${barrel.dye}:${barrel.litres}` === at('BARREL'),
    `island ${at('BARREL')}, browser ${barrel.liquid}:${barrel.dye}:${barrel.litres}`);
  check('and each pour says what is in the barrel after it, in the same words', poured === at('POURED'), `island "${at('POURED')}", browser "${poured}"`);
  check('and the buckets are empty buckets, the dye gone out of them', at('EMPTIED') === 'bucket:-,bucket:-'
    && g.inventory.items.map((i) => `${i.id}:${i.dye ?? '-'}`).join(',') === at('EMPTIED'), at('EMPTIED'));
  const look = act('examine_vessel', bT);
  check('Examine on the barrel says its hex, QL, litres and mix, the same on both sides',
    look === at('LOOK_BARREL') && look.includes('#800080 at QL 50.00') && look.includes('4 litres') && look.includes('50% red and 50% blue'),
    `island "${at('LOOK_BARREL')}", browser "${look}"`);
  check('which is the browser\'s own line for the barrel', look === vesselSays(barrel), vesselSays(barrel));
}
{
  clear();
  const bucket = give('bucket', 40);
  const asked = ask('fill_bucket', itemT(bucket));
  const filled = act('fill_bucket', itemT(bucket));
  const now = g.inventory.items.map((i) => `${i.id}:${i.dye ?? '-'}`).join(',');
  const there = `${barrel.liquid ?? 'none'}:${barrel.dye ?? 'none'}:${barrel.litres}`;
  check('a bucket drawn out of it takes the 4 litres, the same mix, and leaves the barrel empty of dye, on both sides',
    asked === 'ALLOWED' && at('FILL_ASK') === 'ALLOWED' && `${now}#${there}#${filled}` === at('FILLED') && now === `dye_bucket:${PURPLE4}` && there === 'none:none:0',
    `island ${at('FILLED')}, browser ${now}#${there}#${filled}`);
  const b = g.inventory.items[0];
  check('and the bucket is called by its colour and its litres, the same on both sides', itemName(b) === at('NAME') && itemName(b) === 'Bucket of purple dye (4 litres)',
    `island ${at('NAME')}, browser ${itemName(b)}`);
  const look = act('examine_item', itemT(b));
  check('and Examine on it says the hex, QL, litres and mix, in the island\'s words', look === at('LOOK_BUCKET') && look.includes(dyeSays(dyeIn(b)!.liquid, 4)),
    `island "${at('LOOK_BUCKET')}", browser "${look}"`);
}
{
  clear();
  barrel.litres = 10;
  barrel.liquid = 'water';
  delete barrel.dye;
  const dye = give('dye_bucket', 40, TOPUP);
  const intoWater = ask('pour_into_barrel', itemT(dye));
  const topUp = ask('fill_bucket', itemT(dye));
  check('dye will not go into a barrel of water, refused in the same words on both sides',
    intoWater === at('NO_DYE_IN_WATER') && intoWater === noMixing('dye', 'water', 'barrel'), `island "${at('NO_DYE_IN_WATER')}", browser "${intoWater}"`);
  check('nor will water go into a bucket of dye that is topped up beside it', topUp === at('NO_TOPUP_FROM_WATER') && topUp === noMixing('water', 'dye', 'bucket'),
    `island "${at('NO_TOPUP_FROM_WATER')}", browser "${topUp}"`);
  barrel.liquid = 'dye';
  barrel.dye = YELLOW_BARREL;
  const water = give('water_bucket', 40);
  const waterIn = ask('pour_into_barrel', itemT(water));
  check('nor water into a barrel of dye', waterIn === at('NO_WATER_IN_DYE') && waterIn === noMixing('water', 'dye', 'barrel'), `island "${at('NO_WATER_IN_DYE')}", browser "${waterIn}"`);
  g.inventory.remove(water.uid, 1);
  const asked = ask('fill_bucket', itemT(dye));
  const topped = act('fill_bucket', itemT(dye));
  const want = dyeText(mixDye(pureDye('red', 20), 3, pureDye('yellow', 80), 2), BUCKET_LITRES);
  check('and a bucket of dye with room in it tops up from a barrel of dye, mixing by the litres of each, the same on both sides',
    asked === 'ALLOWED' && at('TOPUP_ASK') === 'ALLOWED' && `${dye.dye}#${barrel.litres}:${barrel.dye}#${topped}` === at('TOPPED') && dye.dye === want,
    `island ${at('TOPPED')}, browser ${dye.dye}#${barrel.litres}:${barrel.dye}#${topped}`);
}
{
  clear();
  const purple = give('dye_bucket', 40, PURPLE4);
  const tunic = give('cloth_tunic', 30);
  const plain = `${itemName(tunic)}#${act('examine_item', itemT(tunic))}`;
  check('an undyed tunic is called by no colour and Examine says none, the same on both sides',
    plain === at('PLAIN') && itemName(tunic) === 'Cloth tunic' && !plain.includes('dyed'), `island "${at('PLAIN')}", browser "${plain}"`);
  const asked = ask('dye_item', itemT(tunic));
  const dyed = act('dye_item', itemT(tunic));
  const hex = dyeHex(readDye(PURPLE4)!.liquid);
  const mine = `${tunic.dye}:${itemName(tunic)}#${purple.dye}#${dyed}`;
  check(`dyeing a tunic takes ${DYE_LITRES.garment} litre and gives it exactly the dye's hex, ${hex}, said and named the same on both sides`,
    asked === 'ALLOWED' && at('DYE_ASK') === 'ALLOWED' && mine === at('DYED') && tunic.dye === hex
      && purple.dye === dyeText(readDye(PURPLE4)!.liquid, 4 - DYE_LITRES.garment) && itemName(tunic) === 'Purple cloth tunic',
    `island ${at('DYED')}, browser ${mine}`);
  const again = ask('dye_item', itemT(tunic));
  check('dyeing it again in the same colour is refused in the same words', again === at('AGAIN') && again === dyedAlready(hex), `island "${at('AGAIN')}", browser "${again}"`);
  const look = act('examine_item', itemT(tunic));
  check('Examine on the tunic says its hex, in the island\'s words', look === at('LOOK_TUNIC') && look.includes(`It is dyed ${hex}.`), `island "${at('LOOK_TUNIC')}", browser "${look}"`);
  const ship = give('caravel', 30);
  const big = ask('dye_item', itemT(ship));
  check(`a caravel takes ${DYE_LITRES.ship} litres, more than the bucket holds, and is refused in the same words`,
    big === at('TOO_BIG') && big === tooLittleDye(DYE_LITRES.ship), `island "${at('TOO_BIG')}", browser "${big}"`);
  const strip = ask('strip_dye', itemT(purple));
  check('a bucket of dye has no colour to boil out of it', strip === at('STRIP_BUCKET') && strip === 'It has taken no colour.', `island "${at('STRIP_BUCKET')}", browser "${strip}"`);
  g.inventory.remove(purple.uid, 1);
  const none = ask('dye_item', itemT(tunic));
  check('and with no dye at all, it says where dye comes from', none === at('NONE') && none === NO_DYE, `island "${at('NONE')}", browser "${none}"`);
}

/* ---- from before ------------------------------------------------------------------- */

{
  // The same things as the island was handed, as a save would have them.
  const save: Record<string, unknown> = {
    nextUid: 10,
    inventory: [
      { uid: 1, id: 'dye', ql: 55, dmg: 0, count: 7, extra: 'Woad' },
      { uid: 3, id: 'cloth_tunic', ql: 30, dmg: 0, count: 1, dye: 'madder' },
    ],
    ground: { '30,31': [{ uid: 2, id: 'dye', ql: 45, dmg: 0, count: 1, extra: 'Lily' }] },
    furniture: [{ id: 1, kind: 'banner', x: 33, y: 30, sx: 0, sy: 0, ql: 40, items: [], dye: 'lotus' }],
  };
  upgradeDyes(save, BUCKET_LITRES);
  const inv = save.inventory as Item[];
  const ground = (save.ground as Record<string, Item[]>)['30,31'];
  const banner = (save.furniture as Array<{ dye?: string }>)[0];
  // The island's rows in its own order: the pot's row, the tunic, the bucket the pot spilled into, and the ground's.
  const [isleItems, isleBanner] = at('BEFORE').split('|');
  const rows = isleItems.split(',').map((r) => r.split(':'));
  const isleBuckets = rows.filter((r) => r[1] === 'dye_bucket').map((r) => `${r[0]}:${r[2]}:${r[3]}:${r[5]}`).sort();
  const hereBuckets = [...inv.filter((i) => i.id === 'dye_bucket').map((i) => `player:${i.ql}:${i.count}:${i.dye}`),
    ...ground.map((i) => `ground:${i.ql}:${i.count}:${i.dye}`)].sort();
  const woad = legacyLiquid('woad')!, lily = legacyLiquid('lily')!;
  check(`seven pots of woad are ${7 * DYE_LITRES.garment} litres of the mix nearest woad, in buckets of ${BUCKET_LITRES}, and a pot of lily on the ground a litre where it lay, the same on both sides`,
    isleBuckets.join(',') === hereBuckets.join(',')
      && hereBuckets.join(',') === [`ground:45:1:${dyeText(lily, 1)}`, `player:55:1:${dyeText(woad, 2)}`, `player:55:1:${dyeText(woad, 5)}`].sort().join(','),
    `island ${isleBuckets.join(',')}, browser ${hereBuckets.join(',')}`);
  check('and none of them is a pot any more, on either side, and the save\'s well counts on past the bucket it added',
    !rows.some((r) => r[1] === 'dye') && !inv.some((i) => i.id === 'dye') && inv.find((i) => i.dye === dyeText(woad, 2))?.uid === 10 && save.nextUid === 11,
    `${inv.map((i) => `${i.uid}:${i.id}`).join(',')} next ${save.nextUid}`);
  const tunic = inv.find((i) => i.id === 'cloth_tunic');
  const isleTunic = rows.find((r) => r[1] === 'cloth_tunic')?.[5];
  const madder = LEGACY_DYES.find((d) => d.id === 'madder')!.colour, lotus = LEGACY_DYES.find((d) => d.id === 'lotus')!.colour;
  check('a tunic dyed madder and a banner dyed lotus keep exactly the colour they had, on both sides',
    tunic?.dye === madder && isleTunic === madder && banner.dye === lotus && isleBanner === lotus, `${tunic?.dye} ${isleTunic} ${banner.dye} ${isleBanner}`);
  check('and doing it again on the island changes nothing', at('TWICE') === 'true', at('TWICE'));
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`dye, boiled and mixed — ${ok.length} of ${ok.length}`);
