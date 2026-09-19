/**
 * What a go that missed still teaches you, and that somebody says so.
 *
 * Reported: "i'm not getting any smelting experience for failed smelting, not
 * sure if that's an oversight."
 *
 * Half an oversight. The experience was there all along — a failed craft has
 * paid `try_gain(false)` of the trade since the rule was written, and a
 * crucible of bronze that would not take put smelting from 1 to 1.2717 on the
 * island's own numbers. What was missing was anybody saying so: the line over
 * the log was written by hand at the end of a performer, and a failed craft
 * returned before reaching it. A number that moves in silence is a number
 * nobody believes moved.
 *
 * So the telling lives inside the raise now, where the browser has always kept
 * it, and this measures the two halves of that separately: what a miss is
 * worth, and that it is said. On both sides, over the same trade.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { RECIPE_BY_ID } from '../../src/game/recipes';
import { RECIPE_ACTIONS } from '../../src/game/recipes';
import { SKILL_DEFS, isQuiet } from '../../src/game/skills';
import { TRY_LEARN } from '../../src/game/learn';

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

const W = `(select id from world where name = 'Hoarding')`;
const DANE = `(select uid from player where world_id = ${W} and name = 'Dane')`;

/* ---- what a miss is worth, with the roll held still ---------------------- */
/*
 * The gain is the base times what room is left in the skill times a roll of
 * 0.6 to 1.4, so two goes never land on the same number — but the roll is the
 * only thing between them. Seed it the same twice, start from the same value
 * twice, and the ratio of the two gains is the whole of the rule.
 */
const pinned = (base: string): string => psql(`
  select setseed(0.4242);
  insert into skill (world_id, uid, id, value) values (${W}, ${DANE}, 'smelting', 1)
    on conflict (world_id, uid, id) do update set value = 1;
  select to_char(skill_raise(${W}, ${DANE}, 'smelting', ${base}), 'FM0.000000');
`).split('\n').pop()!.trim();

const hit = Number(pinned('1'));
const miss = Number(pinned('try_gain(false)'));
const ratio = miss / hit;
check('a go that missed is worth a share of one that landed, not nothing',
  miss > 0 && Math.abs(ratio - TRY_LEARN) < 1e-6,
  `${miss.toFixed(6)} against ${hit.toFixed(6)}, which is ${ratio.toFixed(4)} of it`);
const islandTry = Number(psql(`select to_char(try_learn(), 'FM0.000000');`));
check('and both sides price a miss the same', Math.abs(islandTry - TRY_LEARN) < 1e-9,
  `the island says ${islandTry}, the browser ${TRY_LEARN}`);

/* ---- a failed craft, on the island --------------------------------------- */
/*
 * Made to fail rather than waited for: the roll has a floor of three in ten,
 * so a hard enough recipe in green enough hands fails nearly every go, and the
 * loop takes the first one that does. The difficulty goes back on the rollback.
 */
const isle = psql(`
begin;
update recipe set difficulty = 95 where id = 'make_bronze';
do $$
declare w uuid; u uuid; i int;
begin
  select id into w from world where name = 'Hoarding';
  select uid into u from player where world_id = w and name = 'Dane';
  for i in 1..40 loop
    delete from item it where it.world_id = w and it.holder = 'player' and it.holder_uid = u
      and it.def in ('copper_lump', 'tin_lump');
    insert into item (world_id, holder, holder_uid, def, ql, count) values
      (w, 'player', u, 'copper_lump', 20, 3), (w, 'player', u, 'tin_lump', 20, 1);
    insert into skill (world_id, uid, id, value) values (w, u, 'smelting', 1)
      on conflict (world_id, uid, id) do update set value = 1;
    delete from event where uid = u;
    perform perform_craft(w, u, 'make_bronze', '{}'::jsonb);
    exit when exists (select 1 from event where uid = u and text like '%will not take%');
  end loop;
end $$;
select 'ROSE|' || to_char(skill_of(${W}, ${DANE}, 'smelting') - 1, 'FM0.000000');
select 'SAID|' || coalesce((select text from event where uid = ${DANE} and kind = 'skill'
                            and text like 'Smelting%' order by n desc limit 1), 'NOTHING SAID');
select 'TOLD|' || coalesce((select text from event where uid = ${DANE} and kind = 'event'
                            order by n limit 1), 'nothing');
rollback;
`);
const field = (tag: string, from: string): string =>
  from.split('\n').map((l) => l.trim()).find((l) => l.startsWith(`${tag}|`))?.slice(tag.length + 1) ?? '';
const isleRose = Number(field('ROSE', isle));
const isleSaid = field('SAID', isle);
check('the island pays for a crucible that would not take', isleRose > 0,
  `smelting up by ${isleRose.toFixed(6)} after "${field('TOLD', isle)}"`);
check('and says what it was worth, which is the half that was missing',
  /^Smelting increased by [0-9.]+ to [0-9.]+\.$/.test(isleSaid), `"${isleSaid}"`);

/* ---- and the same failed craft in the browser ---------------------------- */
const game = Game.create(4242);
game.skills.values.set('smelting', 1);
/*
 * Dry land first. An island is mostly not: stood where the number said, this
 * spent the whole craft swimming, and a body that is drowning stops what it is
 * doing — which is right, and is not what is being measured here.
 */
let dry: [number, number] | null = null;
for (let r = 0; r < 60 && !dry; r++) {
  for (let dx = -r; dx <= r && !dry; dx++) {
    for (const dy of [-r, r]) {
      const [x, y] = [64 + dx, 64 + dy];
      if (game.world.isPassable(x, y) && !game.world.hasWater(x, y) && game.world.slope(x, y) < 20) { dry = [x, y]; break; }
    }
  }
}
const [sx, sy] = dry ?? [64, 64];
game.player.x = sx + 0.5;
game.player.y = sy + 0.5;
// An alloy is mixed at a hot furnace, so there has to be one to stand at.
const furnace = game.addSmelter(sx, sy, 0, 0, 40);
furnace.fuel = 9999;
furnace.lit = true;
game.inventory.add('copper_lump', { ql: 20, count: 120 });
game.inventory.add('tin_lump', { ql: 20, count: 40 });
const bronze = RECIPE_BY_ID.get('make_bronze')!;
const was = bronze.difficulty;
bronze.difficulty = 95;
const act = RECIPE_ACTIONS.find((a) => a.id === 'make_bronze')!;
const copper = [...game.inventory.items].find((i) => i.id === 'copper_lump')!;
let said = '';
let brose = 0;
for (let go = 0; go < 40 && !said; go++) {
  const before = game.skills.get('smelting');
  // A crucible costs wind, and forty of them cost more than a body holds.
  game.player.stats.stamina = 1;
  game.log.length = 0;
  game.requestAction(act, { kind: 'item', uid: copper.uid });
  for (let t = 0; t < 200 && game.action; t++) game.update(0.25);
  if (!game.log.some((l) => l.text.includes('will not take'))) continue;
  brose = game.skills.get('smelting') - before;
  said = game.log.find((l) => l.kind === 'skill' && l.text.startsWith('Smelting'))?.text ?? 'NOTHING SAID';
}
bronze.difficulty = was;
check('the browser pays for the same ruined crucible', brose > 0,
  `smelting up by ${brose.toFixed(6)}`);
check('and says it in the same sentence the island says',
  /^Smelting increased by [0-9.]+ to [0-9.]+\.$/.test(said), `"${said}"`);

/* ---- and it cannot be forgotten again ------------------------------------ */
/*
 * The line used to be written out at the end of each performer, which is why
 * there were twenty-five of them and one trade with none. There is one now,
 * inside the raise, and nothing that raises a skill can leave it out.
 */
const byHand = psql(`
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '%skill_said(%'
     and p.proname not in ('skill_said', 'skill_raise');
`);
check('nothing writes the line by hand any more', byHand === '0',
  `${byHand} functions still call skill_said themselves`);
const raises = psql(`
  select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '%skill_raise(%'
     and p.proname <> 'skill_raise';
`);
check('and every place a skill goes up goes through the one that says so', Number(raises) > 15,
  `${raises} of them`);

/* ---- which skills keep quiet, agreed on both sides ------------------------ */
const quietHere = SKILL_DEFS.filter((d) => isQuiet(d.id)).map((d) => d.id).sort();
const quietThere = psql(`select id from skill_def where quiet order by id;`)
  .split('\n').map((s) => s.trim()).filter(Boolean).sort();
check('the skills that say nothing about themselves are the same list on both sides',
  quietHere.join(',') === quietThere.join(','),
  `${quietHere.length} of them: ${quietHere.join(', ')}`);
check('and every trade is a loud one', SKILL_DEFS.filter((d) => d.group !== 'Characteristics' && !isQuiet(d.id)).length > 30,
  `${SKILL_DEFS.filter((d) => !isQuiet(d.id)).length} skills narrate themselves`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log('a go that missed teaches you less and says so, on both sides and in one place');
