/**
 * Island leaderboards: top skills, best-bred wildermon, biggest settlements.
 *
 * Asked for: "Island leaderboards. Top skills, best-bred wildermon, biggest
 * settlements." `rpc_boards` answers all three, each cut at `board_top()`,
 * and the Leaderboards window prints a line over each saying what it ranks
 * by.
 *
 * An island of three -- Ann, Bob and Cat -- is put down in a transaction that
 * is rolled back, beside a second island with Dee on it and bigger numbers
 * than anybody on the first. It has skills, a herd of tamed wildermon and two
 * wild ones worth more than any of them, and two settlements. Asked as the
 * three of them, as Dee, as nobody and as a client with no key, it checks:
 *
 *   * each board's order and contents, place by place, and that the second
 *     island's skills, beasts and settlement stay off the first's boards;
 *   * that a board holds ten and no more, for a skill and for the herd;
 *   * each of the settlement board's three keys in turn -- level, then
 *     citizens, then age -- by changing the two settlements between asks;
 *   * that wild ones are left out, even one with a keeper's name on it;
 *   * that no trait's id or name is anywhere in the answer;
 *   * that somebody who is not on the island, or not signed in, is refused;
 *   * that every field the window reads is there with the type it expects;
 *   * and that the window's lines are built from the numbers the island ranks
 *     by: the grade steps, the board's size, the top level and the trait slots.
 *
 * And the game you play by yourself, where there is nobody to rank against:
 * the window shows your best skill, your best-bred wildermon and your
 * settlement, measured the way the boards measure.
 *
 * Runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';
import { BOARD_TOP, bredScore } from '../../src/game/boards';
import { Game, MAX_DEED_LEVEL } from '../../src/game/game';
import { GRADE_STEP, TIERS, TRAIT_SLOTS } from '../../src/game/traits';
import { BOARD_RULES, BRED_MAX, figure, soloStanding } from '../../src/ui/panels/boards';

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

/* ---- the island ------------------------------------------------------------ */

const W = '00000000-0000-0000-0000-0000000b0a01';
const E = '00000000-0000-0000-0000-0000000b0a02';
const ANN = '00000000-0000-0000-0000-0000000b0b01';
const BOB = '00000000-0000-0000-0000-0000000b0b02';
const CAT = '00000000-0000-0000-0000-0000000b0b03';
const DEE = '00000000-0000-0000-0000-0000000b0b04';
/**
 * Enough more miners to fill the mining board past its end: with Ann, Bob and
 * Cat that is two more than it holds, mining from 20 up, one apart.
 */
const MORE = Array.from({ length: BOARD_TOP - 1 }, (_, i) => `00000000-0000-0000-0000-0000000b0c${String(i + 1).padStart(2, '0')}`);
/** And enough spare wildermon that the herd outnumbers its board by three, each a level apart. */
const SPARES = BOARD_TOP - 1;

/** A wildermon put down on an island: whose, how kept, what blood, and its best task skill. */
interface Beast { world: string; id: number; name: string; species: string; mode: string; keeper: string | null; traits: string[]; skill: number }
const BEASTS: Beast[] = [
  { world: W, id: 1, name: 'Stormcaller', species: 'rabba', mode: 'active', keeper: ANN, traits: ['windborn', 'swift', 'fleet'], skill: 0 },
  { world: W, id: 2, name: 'Plodder', species: 'roxxen', mode: 'deed', keeper: BOB, traits: ['light_footed', 'willing', 'thrifty'], skill: 0 },
  // The same blood twice: the one with the higher level goes first, though its number is the later.
  { world: W, id: 3, name: 'Twin Low', species: 'woola', mode: 'stored', keeper: CAT, traits: ['ironsides', 'keen_nosed', 'fanged_rare'], skill: 0 },
  { world: W, id: 4, name: 'Twin High', species: 'woola', mode: 'stored', keeper: CAT, traits: ['ironsides', 'keen_nosed', 'fanged_rare'], skill: 30 },
  // Two wild ones worth more than anything tamed, one of them with a keeper's name still on it.
  { world: W, id: 5, name: 'Wildking', species: 'ulva', mode: 'wild', keeper: null, traits: ['windborn', 'unflagging', 'old_blood'], skill: 0 },
  { world: W, id: 6, name: 'Stray', species: 'rabba', mode: 'wild', keeper: ANN, traits: ['pack_leader', 'ironsides', 'windborn'], skill: 0 },
  // Alike but for their level, Spare 1 the highest: the board has room for all but the last three.
  ...Array.from({ length: SPARES }, (_, i): Beast => ({
    world: W, id: 7 + i, name: `Spare ${i + 1}`, species: 'orse', mode: 'deed', keeper: ANN,
    traits: ['broad_backed', 'milky'], skill: 5 * (SPARES - 1 - i),
  })),
  // And the best there is, on the other island.
  { world: E, id: 1, name: 'Champion', species: 'rabba', mode: 'active', keeper: DEE, traits: ['windborn', 'unflagging', 'old_blood'], skill: 0 },
];
const sqlText = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const beastRows = BEASTS.map((b) => `(${sqlText(b.world)}, ${b.id}, ${sqlText(b.species)}, ${sqlText(b.name)}, ${sqlText(b.mode)}, `
  + `${b.keeper ? sqlText(b.keeper) : 'null'}, array[${b.traits.map(sqlText).join(', ')}]::text[], `
  + `${sqlText(JSON.stringify(b.skill ? { digging: b.skill } : {}))}::jsonb, 4, 4, 4, 4, 10, 'female')`).join(',\n  ');

/** Ask the board as somebody, as a client with the publishable key would. */
const ask = (key: string, uid: string, path = ''): string => `
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${uid}')::text, true) \\g /dev/null
select '${key}|' || (rpc_boards('${W}')${path})::text;
reset role;`;

/** Ask it and keep the refusal, in the island's words. */
const refused = (key: string, role: string, claims: string): string => `
set local role ${role};
select set_config('request.jwt.claims', ${claims}, true) \\g /dev/null
do $$ begin
  perform rpc_boards('${W}');
  perform set_config('boards.said', 'allowed', true);
exception when others then
  perform set_config('boards.said', sqlerrm, true);
end $$;
reset role;
select '${key}|' || current_setting('boards.said');`;

const out = psql(`
begin;
insert into world (id, name, seed, size, spawn_x, spawn_y, ready) values
  ('${W}', 'Boards test', 1, 8, 4, 4, true),
  ('${E}', 'Boards elsewhere', 2, 8, 4, 4, true);
insert into player (world_id, uid, name, x, y) values
  ('${W}', '${ANN}', 'Ann', 4, 4), ('${W}', '${BOB}', 'Bob', 4, 4), ('${W}', '${CAT}', 'Cat', 4, 4),
  ('${E}', '${BOB}', 'Bob', 4, 4), ('${E}', '${DEE}', 'Dee', 4, 4);
insert into skill (world_id, uid, id, value) values
  ('${W}', '${BOB}', 'mining', 55.25), ('${W}', '${ANN}', 'mining', 40.5), ('${W}', '${CAT}', 'mining', 12.75),
  ('${W}', '${CAT}', 'body_strength', 31), ('${W}', '${ANN}', 'body_strength', 24.5),
  ('${W}', '${BOB}', 'fishing', 3.5),
  -- Bob is a better miner elsewhere, and Dee better than anybody.
  ('${E}', '${BOB}', 'mining', 99), ('${E}', '${DEE}', 'mining', 80), ('${E}', '${DEE}', 'weaponsmithing', 70);
insert into creature (world_id, id, species, name, mode, keeper, traits, skills, from_x, from_y, to_x, to_y, health, sex) values
  ${beastRows};
insert into deed (world_id, name, x, y, radius, level, founded_by, founded_at) values
  ('${W}', 'Hearth', 2, 2, deed_radius(2), 2, '${ANN}', now() - interval '10 days'),
  ('${W}', 'Norhold', 6, 6, deed_radius(3), 3, '${BOB}', now() - interval '20 days'),
  ('${E}', 'Faraway', 4, 4, deed_radius(5), 5, '${DEE}', now() - interval '30 days');
-- Bob builds on Ann's land and Cat is a guest there: Hearth holds three.
insert into deed_member (world_id, founder, uid, role) values
  ('${W}', '${ANN}', '${BOB}', 'builder'), ('${W}', '${ANN}', '${CAT}', 'guest');
${ask('ANN', ANN)}
${ask('CAT', CAT)}
${refused('OUTSIDER', 'authenticated', `json_build_object('sub', '${DEE}')::text`)}
${refused('NOBODY', 'authenticated', "''")}
${refused('ANON', 'anon', `json_build_object('sub', '${ANN}')::text`)}
-- Level tied, so the roll decides.
update deed set level = 2 where world_id = '${W}' and founded_by = '${BOB}';
${ask('CITIZENS', ANN, "->'settlements'")}
-- Level and roll tied, so age decides.
delete from deed_member where world_id = '${W}' and founder = '${ANN}';
${ask('AGE', ANN, "->'settlements'")}
-- More miners, which makes two more than the board has places for.
insert into player (world_id, uid, name, x, y) values
  ${MORE.map((u, i) => `('${W}', '${u}', 'Miner ${i + 1}', 4, 4)`).join(', ')};
insert into skill (world_id, uid, id, value) values
  ${MORE.map((u, i) => `('${W}', '${u}', 'mining', ${20 + i})`).join(', ')};
${ask('CAP', ANN, "->'skills'->'mining'")}
-- The island's own copies of the numbers the window prints.
select 'STEPS|' || string_agg(tier || '=' || grade_step(tier), ',' order by ord) from tier_odds;
select 'TOP|' || board_top();
select 'MAXLEVEL|' || max_deed_level();
select 'SLOTS|' || trait_slots();
select 'TRAITS|' || json_agg(json_build_array(id, name, tier))::text from trait_def;
rollback;
`);

const said = (key: string): string => out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? '';
const json = <T>(key: string): T | null => {
  try {
    return JSON.parse(said(key)) as T;
  } catch {
    return null;
  }
};

type Place = { name: string; value: number; mine: boolean };
type Bred = { keeper: string; name: string; species: string; score: number; mine: boolean };
type Held = { name: string; founder: string; level: number; citizens: number; mine: boolean };
type Answer = { skills: Record<string, Place[]>; wildermon: Bred[]; settlements: Held[] };

const ann = json<Answer>('ANN');
const cat = json<Answer>('CAT');
check('the island answers somebody on it', !!ann && !!cat, said('ANN').slice(0, 80));
if (!ann || !cat) {
  for (const line of [...ok, ...bad]) console.log(line);
  console.error(out);
  process.exit(1);
}

/* Skills. */
const line = (ps: Place[] | undefined): string => (ps ?? []).map((p) => `${p.name} ${p.value}${p.mine ? '*' : ''}`).join(', ');
check('the skills board holds the three skills raised on this island and no others',
  Object.keys(ann.skills).sort().join(',') === 'body_strength,fishing,mining', Object.keys(ann.skills).sort().join(','));
check('mining: Bob, Ann, Cat, highest first, and Bob\'s 99 on the other island is not his here',
  line(ann.skills.mining) === 'Bob 55.25, Ann 40.5*, Cat 12.75', line(ann.skills.mining));
check('a characteristic has a board like any skill, and nobody who never raised it is on it',
  line(ann.skills.body_strength) === 'Cat 31, Ann 24.5*', line(ann.skills.body_strength));
check('a skill with one holder has one place', line(ann.skills.fishing) === 'Bob 3.5', line(ann.skills.fishing));
check('and what is yours is marked for whoever asks', line(cat.skills.mining) === 'Bob 55.25, Ann 40.5, Cat 12.75*',
  line(cat.skills.mining));
const cap = json<Place[]>('CAP') ?? [];
check(`a skill held by ${BOARD_TOP + 2} shows the highest ${BOARD_TOP}, and the lowest two are cut`,
  cap.length === BOARD_TOP && cap[0]?.name === 'Bob' && cap[BOARD_TOP - 1]?.name === 'Miner 2'
    && !cap.some((p) => p.name === 'Cat' || p.name === 'Miner 1'),
  line(cap));

/* Wildermon. */
const herd = (bs: Bred[]): string => bs.map((b) => `${b.name}/${b.keeper}/${b.species}/${b.score}${b.mine ? '*' : ''}`).join(', ');
const wantHerd = ['Stormcaller/Ann/rabba/14*', 'Twin High/Cat/woola/10.5', 'Twin Low/Cat/woola/10.5', 'Plodder/Bob/roxxen/3',
  ...Array.from({ length: BOARD_TOP - 4 }, (_, i) => `Spare ${i + 1}/Ann/orse/2*`)].join(', ');
check(`the best-bred board is the top ${BOARD_TOP} tamed by traits added up, and a tie goes to the higher level`,
  herd(ann.wildermon) === wantHerd, herd(ann.wildermon));
check('wild ones are left out, a stray with a keeper\'s name on it included, and so is the other island\'s champion',
  !ann.wildermon.some((b) => ['Wildking', 'Stray', 'Champion'].includes(b.name)), herd(ann.wildermon));
const scored = ann.wildermon.every((b) => {
  const beast = BEASTS.find((x) => x.world === W && x.name === b.name);
  return !!beast && bredScore(beast.traits) === b.score;
});
check('every score is what the browser makes of the same traits with GRADE_STEP', scored,
  ann.wildermon.map((b) => `${b.name} ${b.score}`).join(', '));

/* No traits, anywhere. */
const text = said('ANN').toLowerCase() + said('CAT').toLowerCase();
const traits = json<Array<[string, string, string]>>('TRAITS') ?? [];
const named = traits.filter(([id, name]) => text.includes(`"${id.toLowerCase()}"`) || text.includes(name.toLowerCase()));
check(`not one of the island's ${traits.length} traits is named in the answer, by id or by name`,
  traits.length > 0 && named.length === 0 && !text.includes('"traits"'),
  named.length ? named.map(([id]) => id).join(', ') : `${traits.length} looked for`);
const herdTraits = [...new Set(BEASTS.flatMap((b) => b.traits))];
check('including every one the herd carries', herdTraits.every((id) => traits.some(([t]) => t === id)) && herdTraits.every((id) => !text.includes(id)),
  herdTraits.join(', '));

/* Settlements. */
const held = (hs: Held[] | null): string => (hs ?? []).map((h) => `${h.name}/${h.founder}/${h.level}/${h.citizens}${h.mine ? '*' : ''}`).join(', ');
check('the higher level ranks first, though the other has three times the citizens',
  held(ann.settlements) === 'Norhold/Bob/3/1, Hearth/Ann/2/3*', held(ann.settlements));
check('citizens are the founder and the roll, a guest included, and the other island\'s level 5 is not here',
  ann.settlements.length === 2 && ann.settlements[1].citizens === 3, held(ann.settlements));
check('a settlement you are on the roll of is marked yours, as well as the one you founded',
  held(cat.settlements) === 'Norhold/Bob/3/1, Hearth/Ann/2/3*', held(cat.settlements));
check('with the levels tied, more citizens ranks first', held(json<Held[]>('CITIZENS')) === 'Hearth/Ann/2/3*, Norhold/Bob/2/1',
  held(json<Held[]>('CITIZENS')));
check('with the levels and the rolls tied, the older ranks first', held(json<Held[]>('AGE')) === 'Norhold/Bob/2/1, Hearth/Ann/2/1*',
  held(json<Held[]>('AGE')));

/* Who may ask. */
check('somebody who is not on the island is refused, though they are on another',
  said('OUTSIDER') === 'you are not on this island', said('OUTSIDER'));
check('and so is somebody not signed in', said('NOBODY') === 'not signed in', said('NOBODY'));
check('and a client with no key cannot call it at all', said('ANON').startsWith('permission denied'), said('ANON'));

/* What the window reads. */
const typed = (rows: Array<Record<string, unknown>>, want: Record<string, string>): string[] =>
  rows.flatMap((r) => Object.entries(want).filter(([k, t]) => typeof r[k] !== t).map(([k, t]) => `${k} is ${typeof r[k]}, not ${t}`));
const wrong = [
  ...typed(Object.values(ann.skills).flat(), { name: 'string', value: 'number', mine: 'boolean' }),
  ...typed(ann.wildermon, { keeper: 'string', name: 'string', species: 'string', score: 'number', mine: 'boolean' }),
  ...typed(ann.settlements, { name: 'string', founder: 'string', level: 'number', citizens: 'number', mine: 'boolean' }),
];
check('every field the window reads is there, with the type it reads it as', wrong.length === 0, [...new Set(wrong)].join('; '));

/* The window's lines, against the island's numbers. */
const steps = new Map(said('STEPS').split(',').map((kv) => kv.split('=') as [string, string]));
check('the island ranks by the four grade steps the browser has, in the same order',
  [...steps.keys()].join(',') === TIERS.join(',') && TIERS.every((t) => Number(steps.get(t)) === GRADE_STEP[t]), said('STEPS'));
check('and the wildermon line prints each of them as the island counts it',
  TIERS.every((t) => BOARD_RULES.wildermon.includes(`${t} ${figure(Number(steps.get(t)))}`)), BOARD_RULES.wildermon);
const slots = Number(said('SLOTS'));
const most = slots * Number(steps.get(TIERS[TIERS.length - 1]));
check('and the most a wildermon can score is its trait slots at the top grade',
  slots === TRAIT_SLOTS && most === BRED_MAX && BOARD_RULES.wildermon.includes(`${figure(most)} at most for ${slots} traits`),
  `${figure(most)} of ${slots} slots`);
const top = Number(said('TOP'));
check('every line gives the board the size the island cuts it at',
  top === BOARD_TOP && Object.values(BOARD_RULES).every((l) => new RegExp(`\\btop ${top}\\b`, 'i').test(l)), `${said('TOP')} places`);
const maxLevel = Number(said('MAXLEVEL'));
check('and the settlement line the top level there is',
  maxLevel === MAX_DEED_LEVEL && BOARD_RULES.settlements.includes(`1 to ${maxLevel}`), `level ${said('MAXLEVEL')}`);

/* ---- the game you play by yourself ------------------------------------------ */

const game = Game.create(4242);
const alone = soloStanding(game);
check('alone, before anything: no skill raised, no wildermon tamed, no settlement',
  alone.skills.startsWith('You have not raised') && alone.wildermon === 'You have no tamed wildermon.'
    && alone.settlements === 'You have not founded a settlement.',
  Object.values(alone).join(' / '));
game.skills.values.set('body_strength', 40);
game.skills.values.set('mining', 12.5);
const [x, y] = [game.player.x, game.player.y];
for (const b of BEASTS.filter((b) => b.world === W && ['Stormcaller', 'Twin High', 'Wildking'].includes(b.name))) {
  const c = game.creatures.spawn(b.species, x, y, b.mode === 'wild' ? 'wild' : 'active', game.rand);
  c.name = b.name;
  c.traits = b.traits;
}
game.deed = { name: 'Hearth', x: Math.floor(x), y: Math.floor(y), radius: 7, level: 2 };
const mine = soloStanding(game);
check('your best skill, a characteristic higher than it not counted',
  mine.skills === 'Your best skill, characteristics not counted: Mining 12.50.', mine.skills);
check('your best-bred wildermon, by the board\'s own score, the wild one left out',
  mine.wildermon === `Your best-bred wildermon: Stormcaller, Rabba, at 14 of ${figure(BRED_MAX)}, level 1.`, mine.wildermon);
check('and your settlement, with its level of the most there is',
  mine.settlements === `Your settlement: Hearth, level 2 of ${MAX_DEED_LEVEL}, 1 citizen: you.`, mine.settlements);

for (const l of [...ok, ...bad]) console.log(l);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`island leaderboards — ${ok.length} of ${ok.length}`);
