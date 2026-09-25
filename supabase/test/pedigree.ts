/**
 * A pedigree on the creature window.
 *
 * Asked for: "A pedigree on the creature window. Show the dam, the sire and
 * which traits came from which, so breeding can be planned."
 *
 * Asked of both sides, of a dam and a sire with known traits -- one trait
 * they share, and fanged in a different grade on each:
 *
 *   * a covering through the door writes the sire, by id and by name, and
 *     where each trait came from into what the dam carries;
 *   * the young one is born with a pedigree: its dam and its sire by id and
 *     by name, and where each of its traits came from;
 *   * over five hundred coverings more, every trait a young one carries says
 *     where it came from and nothing else does; one from the dam is a trait
 *     the dam carries and the sire does not, grade and all, one from the sire
 *     the other way about, one from both a trait they both carry, and one
 *     bred up is above common; all five words turn up, they are the same five
 *     words on both sides, and how often each turns up agrees between them;
 *   * a young one of a covering made before pedigrees were kept has none;
 *
 * of the browser, that a pedigree and a covering in hand go through a save
 * and come back, that the tooltip names the dam and the sire of a bred one
 * and says nothing of one that was not, and that the island's answer is taken
 * as it comes, a creature it sends none for having none;
 *
 * and of the island, that `rpc_creatures` sends your own young one's pedigree
 * whole and nothing for a creature with none, and somebody else's saying where
 * a trait came from only for the traits they can read: a common one at any
 * husbandry, a rare one at one past its tier's level and not a point under,
 * and all of them on the third step of the way of knowledge.
 */
import { execFileSync } from 'node:child_process';
// `game` first: the root of the module graph, so nothing below comes out half-built.
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import { Creatures, type Creature, type IslandCreature, type Pedigree } from '../../src/game/creatures';
import { TIER_LEVEL } from '../../src/game/husbandry';
import { packLand, packWorld, unpack } from '../../src/game/save';
import { TRAIT_SOURCES, traitTier, type TraitSource } from '../../src/game/traits';
import { creatureLines } from '../../src/ui/creatureinfo';

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

/* ---- the pair, the same on both sides --------------------------------------- */

const DAM = { name: 'Snow', traits: ['willing', 'fleet', 'fanged_rare'] };
const SIRE = { name: 'Horn', traits: ['willing', 'thrifty', 'fanged'] };
const HUSBANDRY = 50;
const CARE = 0.5;
const COVERINGS = 500;
const WORDS = Object.keys(TRAIT_SOURCES).sort();
/** A young one whose record is written by hand, for the reading of it: a common, a rare and a supreme trait. */
const KNOWN = { traits: ['willing', 'fleet', 'swift'], from: { willing: 'both', fleet: 'dam', swift: 'up' } as Record<string, TraitSource> };

const sorted = (xs: Iterable<string>): string => JSON.stringify([...xs].sort());
/**
 * The same record, whatever order its keys were written in: jsonb keeps an
 * object's keys shortest first, so the island's `{dam, from, sire}` is the
 * browser's `{dam, sire, from}`. A list keeps its order, since that is the
 * order the traits were drawn in.
 */
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, canon(x)]))
  : v;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
/** A record's words, keyed as its traits are: the same keys, whatever order they were written in. */
const keyedAs = (from: Record<string, string> | undefined, traits: string[]): boolean => sorted(Object.keys(from ?? {})) === sorted(traits);

interface Young {
  traits: string[];
  pedigree: Pedigree | null;
}

/**
 * The same questions of a side's young ones, whichever side bred them. Hands
 * back how often each word turned up, as a share of every trait they carry.
 */
function judge(side: string, young: Young[], dam: { id: number; name: string; traits: string[] }, sire: { id: number; name: string; traits: string[] }): Record<string, number> {
  let named = 0;
  let keyed = 0;
  const wrong: string[] = [];
  const count: Record<string, number> = {};
  let total = 0;
  for (const y of young) {
    const p = y.pedigree;
    if (p && same(p.dam, { id: dam.id, name: dam.name }) && same(p.sire, { id: sire.id, name: sire.name })) named++;
    if (p && keyedAs(p.from, y.traits)) keyed++;
    for (const [id, src] of Object.entries(p?.from ?? {})) {
      count[src] = (count[src] ?? 0) + 1;
      total++;
      const inDam = dam.traits.includes(id);
      const inSire = sire.traits.includes(id);
      const fits = src === 'dam' ? inDam && !inSire
        : src === 'sire' ? inSire && !inDam
        : src === 'both' ? inDam && inSire
        : src === 'up' ? traitTier(id) !== 'common'
        : src === 'roll';
      if (!fits) wrong.push(`${id} said to be ${src}`);
    }
  }
  check(`${side}: every young one names its dam and its sire, by id and by name`, named === young.length, `${named} of ${young.length}`);
  check(`${side}: every trait a young one carries says where it came from, and nothing else does`, keyed === young.length, `${keyed} of ${young.length}`);
  check(`${side}: from the dam is the dam's very trait and not the sire's, from the sire the other way about, from both theirs, bred up above common`,
    wrong.length === 0, wrong.slice(0, 5).join('; '));
  check(`${side}: all five words turn up, and no other`, sorted(Object.keys(count)) === JSON.stringify(WORDS), sorted(Object.keys(count)));
  const share: Record<string, number> = {};
  for (const w of WORDS) share[w] = (count[w] ?? 0) / Math.max(1, total);
  console.log(`   ${side}, ${young.length} young ones: ${WORDS.map((w) => `${w} ${(share[w] * 100).toFixed(1)}%`).join(', ')}`);
  return share;
}

/* ---- the browser ------------------------------------------------------------ */

console.log('--- the browser');
const game = Game.create(4242);
// Seeded, so the five hundred are the same five hundred every run.
let seed = 20260925;
game.rand = (): number => {
  seed = (seed * 48271) % 2147483647;
  return seed / 2147483647;
};
game.skills.values.set('animal_husbandry', HUSBANDRY);
game.deed = { name: 'Hearth', x: game.player.tileX + 4, y: game.player.tileY + 4, radius: 5, level: 3 };
for (const c of [...game.creatures.list.values()]) if (c.mode !== 'wild') c.mode = 'wild';
const raise = (who: { name: string; traits: string[] }, sex: 'male' | 'female', dx: number): Creature => {
  const c = game.creatures.spawn('rabba', game.player.x + dx, game.player.y, 'deed', game.rand, 0);
  Object.assign(c, { name: who.name, sex, traits: [...who.traits], hunger: 1, care: CARE });
  return c;
};
const dam = raise(DAM, 'female', 0.3);
const sire = raise(SIRE, 'male', -0.3);

// Through the door once, as a keeper does it. The pairing is a roll, so it is tried until it takes.
const pairIt = ACTION_BY_ID.get('pair_creature')!;
const onDam: Target = { kind: 'creature', id: dam.id };
let refused: string | null = null;
for (let i = 0; i < 12 && dam.due === 0; i++) {
  dam.bredAt = -1e9;
  sire.bredAt = -1e9;
  refused = pairIt.check?.(onDam, game) ?? null;
  if (refused) break;
  pairIt.perform(onDam, game);
}
check('browser: the pair is put together through the door', dam.due > 0, refused ?? '');
const carried = dam.unborn;
check('browser: the covering writes the sire, by id and by name, and where each trait came from, into what she carries',
  same(carried?.sire, { id: sire.id, name: 'Horn' }) && keyedAs(carried?.from, carried?.traits ?? []), JSON.stringify(carried));
dam.due = game.time;
const first = game.creatures.giveBirth(game, dam);
check('browser: the young one is born with its pedigree: its dam, its sire, and where each trait came from, as the covering wrote it',
  !!first && same(first.traits, carried?.traits) && same(first.pedigree, { dam: { id: dam.id, name: 'Snow' }, sire: { id: sire.id, name: 'Horn' }, from: carried?.from }),
  JSON.stringify(first?.pedigree));

const browserYoung: Young[] = [];
for (let i = 0; i < COVERINGS; i++) {
  game.creatures.pair(game, dam, sire, HUSBANDRY);
  dam.due = game.time;
  const c = game.creatures.giveBirth(game, dam);
  if (!c) continue;
  browserYoung.push({ traits: c.traits, pedigree: c.pedigree });
  game.creatures.remove(c.id);
}
const browserShare = judge('browser', browserYoung, { id: dam.id, ...DAM }, { id: sire.id, ...SIRE });

dam.unborn = { traits: ['willing'], sex: 'female' };
dam.due = game.time;
const old = game.creatures.giveBirth(game, dam);
check('browser: a young one of a covering made before pedigrees were kept has none', !!old && old.pedigree === null, JSON.stringify(old?.pedigree));

// What pointing at one says.
const pointed = creatureLines(game, first!);
check('browser: pointing at a bred one names its dam and its sire', pointed.includes('Dam Snow · sire Horn'), pointed.join(' | '));
const pointedDam = creatureLines(game, dam);
check('browser: pointing at one that was not bred says nothing of it', !pointedDam.some((l) => l.startsWith('Dam ')), pointedDam.join(' | '));

// A save, with a pedigree in it and a covering in hand, and back.
game.creatures.pair(game, dam, sire, HUSBANDRY);
const inHand = JSON.parse(JSON.stringify(dam.unborn));
const back = await unpack(await packLand(game), JSON.parse(JSON.stringify(packWorld(game))));
check('browser: a pedigree goes through a save and comes back', !!back && same(back.creatures.get(first!.id)?.pedigree, first!.pedigree),
  JSON.stringify(back?.creatures.get(first!.id)?.pedigree));
check('browser: and so does the sire of a covering in hand, with where each trait came from', !!back && same(back.creatures.get(dam.id)?.unborn, inHand),
  JSON.stringify(back?.creatures.get(dam.id)?.unborn));
check('browser: and one with none still has none', !!back && back.creatures.get(old!.id)?.pedigree === null);

// The island's answer, taken as it comes.
const herd = new Creatures();
const row: IslandCreature = { id: 7, species: 'rabba', name: 'Lamb', variant: 0, mode: 'deed', stance: 'defensive', x: 5, y: 5, health: 10,
  traits: KNOWN.traits, pedigree: { dam: { id: 3, name: 'Snow' }, sire: { id: 4, name: 'Horn' }, from: KNOWN.from } };
herd.sawAll([row]);
check('browser: a pedigree the island sends is the one the card reads', same(herd.get(7)?.pedigree, row.pedigree));
herd.sawAll([{ ...row, pedigree: undefined }]);
check('browser: and a creature it sends none for has none', herd.get(7)?.pedigree === null);

/* ---- the island ------------------------------------------------------------- */

const sqlArray = (xs: string[]): string => `'{${xs.join(',')}}'::text[]`;
const isle = psql(`
begin;
select setseed(0.25) \\g /dev/null
create temp table said (k text);
do $b$
declare w uuid; me uuid; them uuid; v_x double precision; v_y double precision;
        v_dam int; v_sire int; v_first int; v_young int; v_known int; v_i int; v_why text;
        v_all jsonb := '[]'; v_seen jsonb;
begin
  select id into w from world where name = 'Hoarding';
  select uid into me from player where world_id = w and name = 'Dane';
  select uid into them from player where world_id = w and name = 'Crowd1';
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  update player set act = null, act_queue = '[]'::jsonb where world_id = w and uid = me;
  select x, y into v_x, v_y from player where world_id = w and uid = me;
  -- Nothing of his own about, and no crate for a young one to go into: each goes where it goes and is let go.
  update creature set mode = 'wild', keeper = null where world_id = w and keeper = me and mode in ('active', 'stored', 'deed');
  delete from item where world_id = w and holder = 'player' and holder_uid = me and def = 'creature_crate';
  delete from placed where world_id = w and sub = 'creature_crate' and made_by = me;
  insert into skill (world_id, uid, id, value) values (w, me, 'animal_husbandry', ${HUSBANDRY})
    on conflict (world_id, uid, id) do update set value = ${HUSBANDRY};
  v_dam := creature_spawn(w, 'rabba', v_x + 0.3, v_y, 'deed', now() - interval '3 hours', me);
  v_sire := creature_spawn(w, 'rabba', v_x - 0.3, v_y, 'deed', now() - interval '3 hours', me);
  update creature set sex = 'female', name = '${DAM.name}', traits = ${sqlArray(DAM.traits)}, hunger = 1, care = ${CARE},
      from_x = to_x, from_y = to_y, leg_at = now(), leg_ends = now(), settled_at = now()
    where world_id = w and id = v_dam;
  update creature set sex = 'male', name = '${SIRE.name}', traits = ${sqlArray(SIRE.traits)}, hunger = 1, care = ${CARE},
      from_x = to_x, from_y = to_y, leg_at = now(), leg_ends = now(), settled_at = now()
    where world_id = w and id = v_sire;
  insert into said values ('IDS|' || v_dam || ',' || v_sire);

  -- Through the door once, as a keeper does it. The pairing is a roll, so it is tried until it takes.
  for v_i in 1..12 loop
    exit when (select due from creature where world_id = w and id = v_dam) is not null;
    update creature set bred_at = null where world_id = w and id in (v_dam, v_sire);
    v_why := act_refusal(w, me, 'pair_creature', jsonb_build_object('kind', 'creature', 'id', v_dam));
    exit when v_why is not null;
    perform act_perform(w, me, 'pair_creature', jsonb_build_object('kind', 'creature', 'id', v_dam));
  end loop;
  insert into said values ('REFUSED|' || coalesce(v_why, ''));
  insert into said values ('UNBORN|' || coalesce((select unborn::text from creature where world_id = w and id = v_dam), 'null'));
  update creature set due = now() - interval '1 second' where world_id = w and id = v_dam;
  v_first := give_birth(w, v_dam);
  insert into said values ('FIRST|' || coalesce((select jsonb_build_object('traits', to_jsonb(c.traits), 'pedigree', c.pedigree)::text
                                                   from creature c where c.world_id = w and c.id = v_first), 'null'));

  -- Five hundred more, straight to the covering and the hour.
  for v_i in 1..${COVERINGS} loop
    perform pair_them(w, v_dam, v_sire, ${HUSBANDRY});
    update creature set due = now() - interval '1 second' where world_id = w and id = v_dam;
    v_young := give_birth(w, v_dam);
    select v_all || jsonb_build_array(jsonb_build_object('traits', to_jsonb(c.traits), 'pedigree', c.pedigree))
      into v_all from creature c where c.world_id = w and c.id = v_young;
    delete from creature where world_id = w and id = v_young;
  end loop;
  insert into said values ('YOUNG|' || v_all::text);

  -- A covering made before pedigrees were kept.
  update creature set unborn = jsonb_build_object('traits', '["willing"]'::jsonb, 'sex', 'female'),
      due = now() - interval '1 second' where world_id = w and id = v_dam;
  v_young := give_birth(w, v_dam);
  insert into said values ('OLD|' || coalesce((select pedigree::text from creature where world_id = w and id = v_young), 'null'));

  -- One whose record is known, working his deed where he and Crowd1 both stand, for the reading of it.
  update creature set unborn = jsonb_build_object('traits', '${JSON.stringify(KNOWN.traits)}'::jsonb, 'sex', 'female',
        'sire', jsonb_build_object('id', v_sire, 'name', '${SIRE.name}'), 'from', '${JSON.stringify(KNOWN.from)}'::jsonb),
      due = now() - interval '1 second' where world_id = w and id = v_dam;
  v_known := give_birth(w, v_dam);
  update creature set keeper = me, mode = 'deed', from_x = v_x, from_y = v_y, to_x = v_x, to_y = v_y,
      leg_at = now(), leg_ends = now(), settled_at = now()
    where world_id = w and id = v_known;
  insert into said values ('KNOWN|' || (select pedigree::text from creature where world_id = w and id = v_known));
  v_seen := rpc_creatures(w, 40);
  insert into said values ('MINE|' || coalesce((select e->>'pedigree' from jsonb_array_elements(v_seen) e where (e->>'id')::int = v_known), 'not sent'));
  insert into said values ('BARE|' || coalesce((select (e ? 'pedigree')::text from jsonb_array_elements(v_seen) e where (e->>'id')::int = v_dam), 'not sent'));

  -- Somebody else, at one husbandry under a rare trait, at one past it, and on the third step of knowledge with none.
  perform set_config('request.jwt.claims', json_build_object('sub', them)::text, true);
  insert into skill (world_id, uid, id, value) values (w, them, 'animal_husbandry', ${TIER_LEVEL.rare})
    on conflict (world_id, uid, id) do update set value = ${TIER_LEVEL.rare};
  update player set way = null where world_id = w and uid = them;
  v_seen := rpc_creatures(w, 40);
  insert into said values ('UNDER|' || coalesce((select e->>'pedigree' from jsonb_array_elements(v_seen) e where (e->>'id')::int = v_known), 'not sent'));
  update skill set value = ${1 + TIER_LEVEL.rare} where world_id = w and uid = them and id = 'animal_husbandry';
  v_seen := rpc_creatures(w, 40);
  insert into said values ('PAST|' || coalesce((select e->>'pedigree' from jsonb_array_elements(v_seen) e where (e->>'id')::int = v_known), 'not sent'));
  update skill set value = 1 where world_id = w and uid = them and id = 'animal_husbandry';
  update player set way = 'knowledge' where world_id = w and uid = them;
  insert into skill (world_id, uid, id, value)
    values (w, them, meditation_skill(), (select s.at from path_step s where s.path = 'knowledge' order by s.at offset 2 limit 1))
    on conflict (world_id, uid, id) do update set value = excluded.value;
  v_seen := rpc_creatures(w, 40);
  insert into said values ('KNOWING|' || coalesce((select e->>'pedigree' from jsonb_array_elements(v_seen) e where (e->>'id')::int = v_known), 'not sent'));
end $b$;
select string_agg(k, E'\\n') from said;
rollback;
`);
const said = (key: string): string => isle.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? '(nothing)';
const parsed = <T>(key: string): T | null => {
  try {
    return JSON.parse(said(key)) as T;
  } catch {
    return null;
  }
};

console.log('--- the island');
const [islandDam, islandSire] = said('IDS').split(',').map(Number);
check('island: the pair is put together through the door', said('REFUSED') === '' && said('UNBORN') !== 'null', said('REFUSED'));
const islandCarried = parsed<{ traits: string[]; sire?: { id: number; name: string }; from?: Record<string, string> }>('UNBORN');
check('island: the covering writes the sire, by id and by name, and where each trait came from, into what she carries',
  same(islandCarried?.sire, { id: islandSire, name: 'Horn' }) && keyedAs(islandCarried?.from, islandCarried?.traits ?? []), said('UNBORN'));
const islandFirst = parsed<Young>('FIRST');
check('island: the young one is born with its pedigree: its dam, its sire, and where each trait came from, as the covering wrote it',
  !!islandFirst && same(islandFirst.traits, islandCarried?.traits)
  && same(islandFirst.pedigree, { dam: { id: islandDam, name: 'Snow' }, sire: { id: islandSire, name: 'Horn' }, from: islandCarried?.from }),
  said('FIRST'));
const islandYoung = parsed<Young[]>('YOUNG') ?? [];
check('island: five hundred more are born', islandYoung.length === COVERINGS, `${islandYoung.length}`);
const islandShare = judge('island', islandYoung, { id: islandDam, ...DAM }, { id: islandSire, ...SIRE });
check('island: a young one of a covering made before pedigrees were kept has none', said('OLD') === 'null', said('OLD'));

console.log('--- the two of them');
const words = (ys: Young[]): string => sorted(new Set(ys.flatMap((y) => Object.values(y.pedigree?.from ?? {}))));
check('both sides write the same five words', words(browserYoung) === words(islandYoung) && words(islandYoung) === JSON.stringify(WORDS),
  `${words(browserYoung)} and ${words(islandYoung)}`);
check('and the same record: a dam, a sire and where each trait came from',
  sorted(Object.keys(first?.pedigree ?? {})) === sorted(Object.keys(islandFirst?.pedigree ?? {})), `${sorted(Object.keys(first?.pedigree ?? {}))} and ${sorted(Object.keys(islandFirst?.pedigree ?? {}))}`);
for (const w of WORDS) {
  check(`how often a trait is ${TRAIT_SOURCES[w as TraitSource].label} agrees between the two sides`, Math.abs(browserShare[w] - islandShare[w]) < 0.08,
    `${(browserShare[w] * 100).toFixed(1)}% and ${(islandShare[w] * 100).toFixed(1)}%`);
}

// Who can read what of somebody else's, by the rule the card's chips keep.
const known = parsed<Pedigree>('KNOWN');
const readable = (husbandry: number): string[] => KNOWN.traits.filter((id) => husbandry >= 1 + TIER_LEVEL[traitTier(id)]);
const fromOf = (key: string): string => sorted(Object.keys(parsed<Pedigree>(key)?.from ?? {}));
check('island: your own young one\'s pedigree is sent whole', !!known && same(parsed<Pedigree>('MINE'), known), said('MINE'));
check('island: nothing is sent for a creature with none', said('BARE') === 'false', said('BARE'));
check('island: somebody else is sent its dam and its sire', same(parsed<Pedigree>('UNDER')?.dam, known?.dam) && same(parsed<Pedigree>('UNDER')?.sire, known?.sire), said('UNDER'));
check(`island: at ${TIER_LEVEL.rare} husbandry, where a trait came from only for the common one`,
  fromOf('UNDER') === sorted(readable(TIER_LEVEL.rare)) && readable(TIER_LEVEL.rare).length === 1, `${fromOf('UNDER')} of ${sorted(KNOWN.traits)}`);
check(`island: at ${1 + TIER_LEVEL.rare}, for the rare one as well, and not yet the supreme`,
  fromOf('PAST') === sorted(readable(1 + TIER_LEVEL.rare)) && readable(1 + TIER_LEVEL.rare).length === 2, `${fromOf('PAST')}`);
check('island: and on the third step of the way of knowledge, for all of them', fromOf('KNOWING') === sorted(KNOWN.traits), fromOf('KNOWING'));
check('island: in the words the record was written in', same(parsed<Pedigree>('PAST')?.from, Object.fromEntries(readable(1 + TIER_LEVEL.rare).map((id) => [id, KNOWN.from[id]]))),
  JSON.stringify(parsed<Pedigree>('PAST')?.from));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a pedigree — ${ok.length} of ${ok.length}`);
