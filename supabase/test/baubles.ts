/**
 * Baubles.
 *
 * Asked for: a share of what archaeology turns up is a bauble -- minor, major
 * or ancient -- restored like any relic, set into a settlement's altar, into
 * one of its sockets for that tier, and giving every citizen working on that
 * settlement what is written on it; rarity doubling, tripling or quadrupling
 * it; one set in replaced but never taken out. What this asks:
 *
 *   * the lists the rules are made of hold together: a minor bauble speaks
 *     for every trade some job is done with, a major one for every trade
 *     that yields something, and neither for anything else;
 *   * the island holds the same tiers, skills, kinds, ancient jobs and loose
 *     numbers as the browser, and writes and reads a bauble in the same
 *     words, so one restored on either side is read the same on the other;
 *   * what is rolled is what the rules say: the tiers in their shares, the
 *     amounts inside their range times the rarity, every roll readable;
 *   * the island turns them up, restores them and refuses one too far gone;
 *   * it sets one only at an altar, standing at it, on a settlement of yours,
 *     as a citizen, into the next empty socket or the one asked for -- a
 *     filled one only by the founder or a mayor, the old one lost -- in the
 *     browser's words, and says it the same way;
 *   * and what is set works for a citizen standing on the settlement and for
 *     nobody else: on a job's time, to its cap, on what a go teaches, and on
 *     what a go yields, through the clock itself, said after the go's own
 *     words the same way on both sides.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game, type Deed } from '../../src/game/game';
import { ACTION_BY_ID, ACTIONS, type Target } from '../../src/game/actions';
import { RECIPES } from '../../src/game/recipes';
import { SKILL_DEFS } from '../../src/game/skills';
import {
  ANCIENT_EFFECTS, ANCIENT_PLUS, BAUBLE_HIGH, BAUBLE_KINDS, BAUBLE_LOW, BAUBLE_SAID, BAUBLE_SHARE, BAUBLE_TIER_BY_ID,
  BAUBLE_TIERS, baubleText, baubleTimes, fullSaid, MAJOR_SKILLS, MINOR_SKILLS, readBauble, rollBauble, rollTier,
  TARNISHED, YIELD_TIMES, type BaubleKind, type BaubleTier,
} from '../../src/game/baubles';
import { rarityStep } from '../../src/game/items';
import { TileType } from '../../src/world/tiles';

const psql = (sql: string): string =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      PGHOST: process.env.PGHOST ?? '/var/run/postgresql',
      PGPORT: process.env.PGPORT ?? '5433',
      PGUSER: process.env.PGUSER ?? 'wurm',
      PGDATABASE: process.env.PGDATABASE ?? 'postgres',
    },
  }).trim();
const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};
const near = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;

/* ---- the lists ------------------------------------------------------------ */
const sorted = (xs: readonly string[]): string => [...xs].sort().join(',');
const worked = new Set([...ACTIONS.map((a) => a.skill), ...RECIPES.map((r) => r.skill)].filter(Boolean) as string[]);
const trades = SKILL_DEFS.filter((s) => s.group === 'Skills' && worked.has(s.id)).map((s) => s.id);
check('a minor bauble speaks for every trade some job is done with, and no other', sorted(MINOR_SKILLS) === sorted(trades),
  `missing ${trades.filter((s) => !MINOR_SKILLS.includes(s)).join(' ') || 'none'}, extra ${MINOR_SKILLS.filter((s) => !trades.includes(s)).join(' ') || 'none'}`);
const recipeSkills = [...new Set(RECIPES.map((r) => r.skill))];
check('a major bauble speaks for every trade made at the crafting window', recipeSkills.every((s) => MAJOR_SKILLS.includes(s)),
  recipeSkills.filter((s) => !MAJOR_SKILLS.includes(s)).join(' '));
check('and only for trades a minor one may speak for too', MAJOR_SKILLS.every((s) => MINOR_SKILLS.includes(s)));
check('never for archaeology, which would make baubles, nor paving, which yields only what was laid',
  !MAJOR_SKILLS.includes('archaeology') && !MAJOR_SKILLS.includes('paving'));
check('each list names a skill once', new Set(MINOR_SKILLS).size === MINOR_SKILLS.length && new Set(MAJOR_SKILLS).size === MAJOR_SKILLS.length);
check('every ancient bauble names a job the browser has', ANCIENT_EFFECTS.every((e) => ACTION_BY_ID.has(e.action)),
  ANCIENT_EFFECTS.filter((e) => !ACTION_BY_ID.has(e.action)).map((e) => e.action).join(' '));
check('the tiers\' shares make a whole', near(BAUBLE_TIERS.reduce((n, t) => n + t.odds, 0), 1, 1e-9));
check('a set bauble comes out of the ground as one thing, and each tier restores to one of its own',
  BAUBLE_TIERS.every((t) => t.item !== TARNISHED) && new Set(BAUBLE_TIERS.map((t) => t.item)).size === BAUBLE_TIERS.length);

/* ---- the same rules on the island ----------------------------------------- */
const rows = (sql: string): string[] => psql(sql).split('\n').filter(Boolean);
check('the island has the same tiers',
  rows(`select id || '|' || ord || '|' || odds || '|' || slots || '|' || difficulty || '|' || item from bauble_tier order by ord`).join(';')
    === BAUBLE_TIERS.map((t, i) => [t.id, i, t.odds, t.slots, t.difficulty, t.item].join('|')).join(';'));
const skills = [...new Set([...MINOR_SKILLS, ...MAJOR_SKILLS])].sort();
check('the same skills, minor and major',
  rows(`select skill || '|' || minor || '|' || major from bauble_skill order by skill`).join(';')
    === skills.map((s) => `${s}|${MINOR_SKILLS.includes(s)}|${MAJOR_SKILLS.includes(s)}`).join(';'));
check('the same ancient jobs, in the same words',
  rows(`select id || '|' || ord || '|' || action || '|' || said from bauble_ancient order by ord`).join(';')
    === ANCIENT_EFFECTS.map((e, i) => [e.id, i, e.action, e.said].join('|')).join(';'));
check('the same kinds, written the same way and capped the same',
  rows(`select id || '|' || lead || '|' || tail || '|' || cap from bauble_kind order by ord`).join(';')
    === Object.entries(BAUBLE_KINDS).map(([id, k]) => [id, k.lead, k.tail, k.cap].join('|')).join(';'));
check('and the same loose numbers',
  psql(`select bauble_share() || '|' || bauble_low() || '|' || bauble_high() || '|' || ancient_plus() || '|' || bauble_yield_times()`)
    === [BAUBLE_SHARE, BAUBLE_LOW, BAUBLE_HIGH, ANCIENT_PLUS, YIELD_TIMES].join('|'));
check('every ancient bauble names a job the island has',
  psql(`select count(*) from bauble_ancient a where not exists (select 1 from action_def d where d.id = a.action)`) === '0');
check('a rarity multiplies it the same on both sides',
  psql(`select string_agg(bauble_times(r)::text, ',' order by n) from (values (1, null), (2, 'rare'), (3, 'supreme'), (4, 'fantastic')) v(n, r)`)
    === [undefined, 'rare', 'supreme', 'fantastic'].map((r) => baubleTimes(rarityStep(r))).join(','));

/* ---- written and read the same way ---------------------------------------- */
const SAMPLES: Array<[BaubleKind, string, number]> = [
  ['time', 'stonecutting', 3.4], ['learn', 'cooking', 2.1], ['double', 'butchering', 3.5], ['double', 'fine_carpentry', 20],
  ['time', 'first_aid', 10.2], ['learn', 'animal_husbandry', 15.6], ['time', 'digging', 1], ['plus', 'felling', 2],
  ['plus', 'mining', 4], ['plus', 'harvest', 1],
];
const written = rows(SAMPLES.map(([k, key, n]) => `select bauble_text(${lit(k)}, ${lit(key)}, ${n});`).join('\n'));
const mine = SAMPLES.map(([k, key, n]) => baubleText(k, key, n));
check('the island writes a bauble in the browser\'s words', written.join(';') === mine.join(';'),
  written.map((w, i) => (w === mine[i] ? '' : `${w} ≠ ${mine[i]}`)).filter(Boolean).join('; '));
const tierOfKind = (k: BaubleKind): BaubleTier => (k === 'plus' ? 'ancient' : k === 'double' ? 'major' : 'minor');
const itemOf = (t: BaubleTier): string => BAUBLE_TIER_BY_ID.get(t)?.item ?? '';
const READS: Array<[string, string]> = [
  ...SAMPLES.map(([k, key, n]) => [itemOf(tierOfKind(k)), baubleText(k, key, n)] as [string, string]),
  ['bauble_minor', 'butchering: 3.5% chance of twice the yield'],
  ['bauble_major', 'archaeology: 3.5% chance of twice the yield'],
  ['bauble_major', 'paving: 3.5% chance of twice the yield'],
  ['bauble_minor', 'swimming: 2.0% less time'],
  ['bauble_minor', 'stonecutting: +3.4% less time'],
  ['bauble_minor', 'stonecutting: lots'],
  ['bauble_ancient', 'felling: 2 to the logs from each tree felled'],
  ['bauble_ancient', 'felling: +1.5 to the logs from each tree felled'],
  ['bauble_ancient', 'juggling: +1 to each ball'],
  ['fragment', 'stonecutting: 3.4% less time'],
  [TARNISHED, 'minor'],
];
const theirs = rows(READS.map(([def, extra]) =>
  `select coalesce(r.kind || '|' || r.key || '|' || r.amount, 'null') from bauble_read(${lit(def)}, ${lit(extra)}) r;`).join('\n'));
const ours = READS.map(([id, extra]) => {
  const b = readBauble({ id, extra });
  return b ? `${b.kind}|${b.key}|${b.amount}` : 'null';
});
check('and reads one back as the browser does, and refuses what the browser refuses', theirs.join(';') === ours.join(';'),
  READS.map(([, e], i) => (theirs[i] === ours[i] ? '' : `"${e}": island ${theirs[i]}, browser ${ours[i]}`)).filter(Boolean).join('; '));
check('every sample the browser writes, it reads back as it was',
  SAMPLES.every(([k, key, n]) => {
    const b = readBauble({ id: itemOf(tierOfKind(k)), extra: baubleText(k, key, n) });
    return b?.kind === k && b.key === key && b.amount === n;
  }));

/* ---- what is rolled -------------------------------------------------------- */
const RARES: Array<string | null> = [null, 'rare', 'supreme', 'fantastic'];
const islandRolls = rows(`select t.id || '|' || coalesce(r, '') || '|' || bauble_roll(t.id, r)
  from bauble_tier t cross join (values (null), ('rare'), ('supreme'), ('fantastic')) v(r) cross join generate_series(1, 40)`);
let rolledRight = 0;
const rolledWrong: string[] = [];
for (const line of islandRolls) {
  const [tier, rare, text] = line.split('|') as [BaubleTier, string, string];
  const b = readBauble({ id: itemOf(tier), extra: text });
  const times = baubleTimes(rarityStep(rare || null));
  const inRange = b && (tier === 'ancient' ? b.amount === ANCIENT_PLUS * times
    : b.amount >= BAUBLE_LOW * times - 1e-9 && b.amount <= BAUBLE_HIGH * times + 1e-9);
  if (b && b.tier === tier && inRange) rolledRight++;
  else rolledWrong.push(`${tier} ${rare || 'plain'}: ${text}`);
}
check(`every bauble the island rolls the browser reads, inside its range times its rarity (${islandRolls.length})`,
  rolledWrong.length === 0 && islandRolls.length === BAUBLE_TIERS.length * RARES.length * 40, rolledWrong.slice(0, 4).join('; '));
const browserRolls: Array<[string, string]> = [];
for (const t of BAUBLE_TIERS) for (let rare = 0; rare <= 3; rare++) for (let i = 0; i < 25; i++) {
  browserRolls.push([t.item, rollBauble(t.id, rare, Math.random)]);
}
const readThere = rows(`select count(*) filter (where r.kind is not null) || '|' || count(*) from (values ${
  browserRolls.map(([d, e]) => `(${lit(d)}, ${lit(e)})`).join(', ')}) v(d, e) cross join lateral bauble_read(v.d, v.e) r`);
check('and every one the browser rolls, the island reads', readThere[0] === `${browserRolls.length}|${browserRolls.length}`, readThere[0]);
const kindsSeen = new Set(browserRolls.map(([d, e]) => readBauble({ id: d, extra: e })?.kind));
check('a minor bauble rolls either kind of its tier', kindsSeen.has('time') && kindsSeen.has('learn'));
const N = 6000;
const islandTiers = new Map(rows(`select id || '|' || count(*) from (select bauble_tier_roll() id from generate_series(1, ${N})) x group by id`)
  .map((l) => l.split('|') as [string, string]).map(([k, v]) => [k, Number(v) / N]));
const browserTiers = new Map<string, number>();
for (let i = 0; i < N; i++) { const t = rollTier(Math.random); browserTiers.set(t, (browserTiers.get(t) ?? 0) + 1 / N); }
check('the island rolls the tiers in their shares', BAUBLE_TIERS.every((t) => near(islandTiers.get(t.id) ?? 0, t.odds, 0.025)),
  BAUBLE_TIERS.map((t) => `${t.id} ${(islandTiers.get(t.id) ?? 0).toFixed(3)} of ${t.odds}`).join(', '));
check('and so does the browser', BAUBLE_TIERS.every((t) => near(browserTiers.get(t.id) ?? 0, t.odds, 0.025)),
  BAUBLE_TIERS.map((t) => `${t.id} ${(browserTiers.get(t.id) ?? 0).toFixed(3)} of ${t.odds}`).join(', '));

/* ---- the island at work ---------------------------------------------------- */
const out = psql(`
begin;
select setseed(0.4242);
create temp table said (k text, v text);
do $$
declare w uuid; u uuid; other uuid; tx int; ty int; alt bigint; far bigint; next_alt bigint; box bigint;
        b bigint; j jsonb; finds int := 0; fragments int := 0; tarnished int := 0; bad_tier int := 0; bad_dmg int := 0;
        v_it item; v_n int; d0 double precision; d1 double precision; m0 double precision; m1 double precision;
        dig jsonb := jsonb_build_object('kind', 'tile', 'x', 9, 'y', 9, 'cx', 9, 'cy', 9);
        full_stats jsonb := '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb;
begin
  -- The suite's own island, sixteen a side, by name, and two people on it: the founder, and somebody else.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  select p.uid into other from player p where p.world_id = w and p.uid <> u order by p.uid limit 1;
  delete from deed where world_id = w;
  -- Plain dry dirt everywhere, since the island is small.
  for tx in 0..15 loop for ty in 0..15 loop
    perform land_set_height(w, tx, ty, 40); perform land_set_tile(w, tx, ty, tile_id('Dirt'));
  end loop; end loop;
  delete from item where world_id = w and holder = 'player' and holder_uid in (u, other);
  update player set x = 8.5, y = 8.5, act = null, act_queue = '[]', stats = full_stats where world_id = w and uid in (u, other);

  /* What the trowel turns up. */
  perform give(w, u, 'trowel', 1, 90);
  insert into skill (world_id, uid, id, value) values (w, u, 'archaeology', 90), (w, u, 'restoration', 100)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  for tx in 1..400 loop
    perform perform_dig(w, u, 'investigate', jsonb_build_object('kind', 'tile', 'x', 9, 'y', 9));
  end loop;
  select coalesce(sum(i.count) filter (where i.def = 'fragment'), 0), coalesce(sum(i.count) filter (where i.def = 'tarnished_bauble'), 0),
         count(*) filter (where i.def = 'tarnished_bauble' and i.extra not in (select id from bauble_tier)),
         count(*) filter (where i.def = 'tarnished_bauble' and (i.dmg < 18 or i.dmg > 68))
    into fragments, tarnished, bad_tier, bad_dmg
    from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u;
  insert into said values ('FINDS', fragments || '|' || tarnished || '|' || bad_tier || '|' || bad_dmg);
  insert into said select 'FOUNDSAID', e.text from event e where e.world_id = w and e.uid = u and e.text like 'Your trowel turns up a tarnished%'
    order by e.n desc limit 1;
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def in ('fragment', 'tarnished_bauble');

  /* Restoring one. */
  b := give(w, u, 'tarnished_bauble', 1, 60, 'major');
  update item set dmg = 90 where id = b;
  insert into said values ('GONETOOFAR', coalesce(act_refusal(w, u, 'restore_relic', jsonb_build_object('kind', 'item', 'uid', b)), 'null'));
  update item set dmg = 20 where id = b;
  insert into said values ('RESTORE', coalesce(act_refusal(w, u, 'restore_relic', jsonb_build_object('kind', 'item', 'uid', b)), 'null'));
  perform act_perform(w, u, 'restore_relic', jsonb_build_object('kind', 'item', 'uid', b));
  insert into said select 'RESTORED', (select count(*) from item where id = b) || '|'
    || coalesce((select string_agg(i.def || '|' || coalesce(r.kind, 'unread'), ',') from item i cross join lateral bauble_read(i.def, i.extra) r
                  where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def like 'bauble\\_%'), 'none');
  insert into said select 'RESTORESAID', e.text from event e where e.world_id = w and e.uid = u and e.kind = 'event' order by e.n desc limit 1;
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def like 'bauble\\_%';
  -- And ones beyond the restorer, who still gets the odd one right.
  update skill set value = 1 where world_id = w and uid = u and id = 'restoration';
  finds := 0; bad_dmg := 0;
  for tx in 1..12 loop
    b := give(w, u, 'tarnished_bauble', 1, 60, 'ancient');
    update item set dmg = 20 where id = b;
    perform act_perform(w, u, 'restore_relic', jsonb_build_object('kind', 'item', 'uid', b));
    select * into v_it from item i where i.id = b;
    if v_it.id is not null then
      finds := finds + 1;
      if v_it.dmg < 25 or v_it.dmg > 34 then bad_dmg := bad_dmg + 1; end if;
      delete from item where id = b;
    end if;
  end loop;
  insert into said select 'FAILED', finds || '|' || bad_dmg || '|'
    || (select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = 'bauble_ancient');
  delete from item where world_id = w and holder = 'player' and holder_uid = u;

  /* A settlement, an altar on it, one off it, and a neighbour's. */
  insert into deed (world_id, name, x, y, radius, level, founded_by) values (w, 'Home', 8, 8, 3, 1, u);
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'furniture', 'altar', 9, 8, 0, 0, 9.5, 8.5, 50, u) returning id into alt;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'furniture', 'altar', 13, 8, 0, 0, 13.5, 8.5, 50, u) returning id into far;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'furniture', 'chest', 7, 8, 0, 0, 7.5, 8.5, 50, u) returning id into box;
  insert into deed (world_id, name, x, y, radius, level, founded_by) values (w, 'Next door', 2, 13, 1, 1, other);
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'furniture', 'altar', 2, 13, 0, 0, 2.5, 13.5, 50, other) returning id into next_alt;
  insert into said values ('ALTAR', alt::text);

  b := give(w, u, 'bauble_minor', 1, 40, 'stonecutting: 3.4% less time');
  insert into said values ('NOTALTAR', coalesce(act_refusal(w, u, 'set_bauble', jsonb_build_object('kind', 'furniture', 'id', box, 'itemUid', b)), 'null'));
  update player set x = 11.5, y = 11.5 where world_id = w and uid = u;
  insert into said values ('REACH', coalesce(act_refusal(w, u, 'set_bauble', jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', b)), 'null'));
  update player set x = 13.5, y = 9.5 where world_id = w and uid = u;
  insert into said values ('OFFDEED', coalesce(act_refusal(w, u, 'set_bauble', jsonb_build_object('kind', 'furniture', 'id', far, 'itemUid', b)), 'null'));
  update player set x = 2.5, y = 12.5 where world_id = w and uid = u;
  insert into said values ('STRANGER', coalesce(act_refusal(w, u, 'set_bauble', jsonb_build_object('kind', 'furniture', 'id', next_alt, 'itemUid', b)), 'null'));
  update player set x = 8.5, y = 8.5 where world_id = w and uid = u;
  j := jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', b);
  insert into said values ('SET', coalesce(act_refusal(w, u, 'set_bauble', j), 'null'));
  perform act_perform(w, u, 'set_bauble', j);
  insert into said select 'SETSAID', e.text from event e where e.world_id = w and e.uid = u order by e.n desc limit 1;
  insert into said select 'USED', count(*)::text from item where id = b;
  b := give(w, u, 'tarnished_bauble', 1, 40, 'minor');
  insert into said values ('TARNISHED', coalesce(act_refusal(w, u, 'set_bauble', jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', b)), 'null'));
  b := give(w, u, 'plank', 1, 40);
  insert into said values ('PLANK', coalesce(act_refusal(w, u, 'set_bauble', jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', b)), 'null'));
  b := give(w, u, 'bauble_minor', 1, 40, 'stonecutting: lots');
  insert into said values ('GARBLED', coalesce(act_refusal(w, u, 'set_bauble', jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', b)), 'null'));

  -- A guest may not; a builder may, into the next empty socket, but not over one already set.
  insert into deed_member (world_id, founder, uid, role) values (w, u, other, 'guest');
  b := give(w, other, 'bauble_minor', 1, 40, 'cooking: +2.1% skill gain');
  j := jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', b);
  insert into said values ('GUEST', coalesce(act_refusal(w, other, 'set_bauble', j), 'null'));
  update deed_member set role = 'builder' where world_id = w and founder = u and uid = other;
  insert into said values ('BUILDER', coalesce(act_refusal(w, other, 'set_bauble', j), 'null'));
  perform act_perform(w, other, 'set_bauble', j);
  b := give(w, other, 'bauble_minor', 1, 40, 'masonry: 2.0% less time');
  insert into said values ('BUILDEROVER', coalesce(act_refusal(w, other, 'set_bauble',
    jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', b, 'slot', 0)), 'null'));
  -- The founder may, and what was there is lost.
  b := give(w, u, 'bauble_minor', 1, 40, 'masonry: 2.0% less time');
  j := jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', b, 'slot', 0);
  insert into said values ('FOUNDEROVER', coalesce(act_refusal(w, u, 'set_bauble', j), 'null'));
  perform act_perform(w, u, 'set_bauble', j);
  insert into said select 'OVERSAID', e.text from event e where e.world_id = w and e.uid = u order by e.n desc limit 1;
  insert into said select 'SOCKETS', string_agg(tier || ':' || slot || ':' || kind || ':' || key || ':' || amount, ',' order by tier, slot)
    from deed_bauble where world_id = w;
  -- Every socket of a tier filled.
  insert into deed_bauble (world_id, founder, tier, slot, kind, key, amount)
    select w, u, 'minor', s, 'time', 'masonry', 1 from generate_series(2, 20) s on conflict do nothing;
  b := give(w, u, 'bauble_minor', 1, 40, 'cooking: +1.0% skill gain');
  insert into said values ('FULL', coalesce(act_refusal(w, u, 'set_bauble', jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', b)), 'null'));
  insert into said values ('SLOTPAST', coalesce(act_refusal(w, u, 'set_bauble', jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', b, 'slot', 21)), 'null'));
  insert into said values ('SLOTHALF', coalesce(act_refusal(w, u, 'set_bauble', jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', b, 'slot', 1.5)), 'null'));
  b := give(w, u, 'bauble_major', 1, 40, 'butchering: 3.5% chance of twice the yield');
  perform act_perform(w, u, 'set_bauble', jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', b));
  insert into said select 'MAJOR', coalesce((select tier || ':' || slot || ':' || kind || ':' || key || ':' || amount
    from deed_bauble where world_id = w and tier = 'major'), 'none');
  -- And a settlement of yours comes with its sockets.
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  insert into said select 'GROUND', coalesce(jsonb_array_length(rpc_ground(w)->'deed'->'baubles')::text, 'none');

  /* What they give. */
  delete from deed_bauble where world_id = w;
  insert into deed_bauble (world_id, founder, tier, slot, kind, key, amount) values
    (w, u, 'minor', 0, 'time', 'stonecutting', 10), (w, u, 'minor', 1, 'time', 'stonecutting', 45),
    (w, u, 'minor', 2, 'learn', 'cooking', 10), (w, u, 'major', 0, 'double', 'butchering', 20),
    (w, u, 'ancient', 0, 'plus', 'felling', 2), (w, u, 'ancient', 1, 'plus', 'digging', 1);
  insert into said values ('PACE', bauble_pace(w, u, 'stonecutting')::text);
  insert into said values ('LEARN', bauble_learn(w, u, 'cooking')::text);
  insert into said values ('DOUBLE', bauble_sum(w, u, 'double', 'butchering')::text);
  insert into said values ('PLUS', bauble_plus(w, u, 'cut_down') || '|' || bauble_plus(w, u, 'mine'));
  m1 := skill_mult(w, u, 'cooking');
  delete from deed_bauble where world_id = w and kind = 'learn';
  m0 := skill_mult(w, u, 'cooking');
  insert into deed_bauble (world_id, founder, tier, slot, kind, key, amount) values (w, u, 'minor', 2, 'learn', 'cooking', 10);
  insert into said values ('SKILLMULT', (m1 / m0)::text);
  insert into said values ('BUILDERPACE', bauble_pace(w, other, 'stonecutting')::text);
  update deed_member set role = 'guest' where world_id = w and founder = u and uid = other;
  insert into said values ('GUESTPACE', bauble_pace(w, other, 'stonecutting') || '|' || bauble_learn(w, other, 'cooking'));
  update player set x = 13.5, y = 8.5 where world_id = w and uid = u;
  insert into said values ('OFFPACE', bauble_pace(w, u, 'stonecutting') || '|' || bauble_learn(w, u, 'cooking'));
  update player set x = 8.5, y = 8.5 where world_id = w and uid = u;

  -- What a go yields: nothing outside one; inside one, the job's own and then, the go it comes up, twice as many.
  update player set act = 'cut_down' where world_id = w and uid = u;
  perform set_config('wurm.bauble_go', '', true);
  insert into said values ('OUTSIDE', bauble_yield(w, u, 'log', 3)::text);
  perform set_config('wurm.bauble_go', 'go', true);
  perform set_config('wurm.bauble_made', '', true);
  v_n := bauble_yield(w, u, 'log', 3);
  perform set_config('wurm.bauble_go', 'twice', true);
  insert into said values ('INSIDE', v_n || '|' || bauble_yield(w, u, 'log', 3));
  perform bauble_said(w, u);
  insert into said select 'YIELDSAID', e.text from event e where e.world_id = w and e.uid = u order by e.n desc limit 1;
  update player set act = null where world_id = w and uid = u;

  -- Through the clock: a dig, what the ancient bauble adds to it, said after the go's own words, and the next go's time.
  perform give(w, u, 'shovel', 1, 50);
  insert into skill (world_id, uid, id, value) values (w, u, 'digging', 50)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  update player set act = 'dig', act_target = dig, act_left = 3, act_goes = 3,
    act_started = now() - interval '10 seconds', act_ends = now() - interval '1 second' where world_id = w and uid = u;
  perform settle(w, u);
  select extract(epoch from act_ends - act_started) into d0 from player where world_id = w and uid = u;
  insert into said select 'DUG', coalesce(sum(count), 0)::text from item where world_id = w and holder = 'player' and holder_uid = u and def = 'dirt';
  insert into said select 'DUGSAID', string_agg(e.text, ' / ' order by e.n) from (
    select * from event e where e.world_id = w and e.uid = u and e.kind = 'event' order by e.n desc limit 2) e;
  insert into said values ('FOREIGN', coalesce(nullif(current_setting('wurm.bauble_go', true), ''), 'clear'));
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'dirt';
  insert into deed_bauble (world_id, founder, tier, slot, kind, key, amount) values (w, u, 'minor', 3, 'time', 'digging', 10);
  update skill set value = 50 where world_id = w and uid = u and id = 'digging';
  update player set act = 'dig', act_target = dig, act_left = 3, act_goes = 3,
    act_started = now() - interval '10 seconds', act_ends = now() - interval '1 second' where world_id = w and uid = u;
  perform settle(w, u);
  select extract(epoch from act_ends - act_started) into d1 from player where world_id = w and uid = u;
  insert into said values ('NEXTGO', (d1 / d0)::text);
  -- And the first go of a job asked for.
  update player set act = null, act_target = null, act_left = null, act_goes = null, act_started = null, act_ends = null, act_queue = '[]'
    where world_id = w and uid = u;
  update skill set value = 50 where world_id = w and uid = u and id = 'digging';
  perform rpc_act(w, 'dig', dig);
  select extract(epoch from p.act_ends - p.act_started) / act_duration(d.base_time, skill_of(w, u, 'digging'), tool_ql(w, u, 'shovel'),
           control_speed(w, u) * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands', act_scope(w, u, 'digging')))
    into d1 from player p join action_def d on d.id = p.act where p.world_id = w and p.uid = u;
  insert into said values ('FIRSTGO', coalesce(d1::text, 'none'));
end $$;
select k || E'\\t' || coalesce(v, 'null') from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const at = l.indexOf('\t');
  return [l.slice(0, at), l.slice(at + 1)] as [string, string];
}));
const say = (k: string): string => said.get(k) ?? '(nothing)';

const [frags, found, badTier, badDmg] = say('FINDS').split('|').map(Number);
const share = found / Math.max(1, frags + found);
check(`the island turns up a bauble for about ${BAUBLE_SHARE * 100}% of finds`, near(share, BAUBLE_SHARE, 0.1),
  `${found} baubles and ${frags} fragments`);
check('each with its tier on it and the damage of the ground', found > 0 && badTier === 0 && badDmg === 0, say('FINDS'));
check('and says so', /^Your trowel turns up a tarnished (minor|major|ancient) bauble\. Restore it to see what it does\. \(QL [\d.]+, damage \d+\)$/.test(say('FOUNDSAID')),
  say('FOUNDSAID'));
check('one too far gone is refused, as the browser refuses it', say('GONETOOFAR') === 'It is too far gone to restore. Repair it first.', say('GONETOOFAR'));
check('one in hand may be restored', say('RESTORE') === 'null', say('RESTORE'));
check('restored, it is a major bauble with what it gives written on it', say('RESTORED') === '0|bauble_major|double', say('RESTORED'));
check('and says what it came out as', /^The tarnish comes away and the bauble is whole: .*major bauble \([a-z ]+: [\d.]+% chance of twice the yield\)\. \(QL [\d.]+\)$/.test(say('RESTORESAID')),
  say('RESTORESAID'));
const [failed, failedBadly, restoredAnyway] = say('FAILED').split('|').map(Number);
check('beyond the restorer, most stay tarnished and take the damage of a failed go', failed >= 4 && failedBadly === 0 && failed + restoredAnyway === 12,
  `${failed} failed, ${restoredAnyway} restored`);

check('a chest is not an altar', say('NOTALTAR') === BAUBLE_SAID.notAltar, say('NOTALTAR'));
check('it is set standing at the altar', say('REACH') === BAUBLE_SAID.reach, say('REACH'));
check('an altar off the settlement will not take one', say('OFFDEED') === BAUBLE_SAID.notOurs, say('OFFDEED'));
check('nor a neighbour\'s', say('STRANGER') === BAUBLE_SAID.notOurs, say('STRANGER'));
check('its founder sets one', say('SET') === 'null', say('SET'));
check('and it is used up doing it', say('USED') === '0', say('USED'));
check('a tarnished one is refused until it is restored', say('TARNISHED') === BAUBLE_SAID.tarnished, say('TARNISHED'));
check('a plank is not a bauble', say('PLANK') === BAUBLE_SAID.notBauble, say('PLANK'));
check('nor one whose words say nothing', say('GARBLED') === BAUBLE_SAID.notBauble, say('GARBLED'));
check('a guest may not set one', say('GUEST') === BAUBLE_SAID.guest, say('GUEST'));
check('a builder may', say('BUILDER') === 'null', say('BUILDER'));
check('but not over one already set', say('BUILDEROVER') === BAUBLE_SAID.replace, say('BUILDEROVER'));
check('the founder may', say('FOUNDEROVER') === 'null', say('FOUNDEROVER'));
check('the sockets hold what was set, where it was set', say('SOCKETS') === 'minor:0:time:masonry:2,minor:1:learn:cooking:2.1', say('SOCKETS'));
check('every socket filled, it asks which to replace', say('FULL') === fullSaid(BAUBLE_TIER_BY_ID.get('minor')!), say('FULL'));
check('a socket past the last is no socket', say('SLOTPAST') === BAUBLE_SAID.notBauble, say('SLOTPAST'));
check('nor half of one', say('SLOTHALF') === BAUBLE_SAID.notBauble, say('SLOTHALF'));
check('a major bauble goes into a major socket', say('MAJOR') === 'major:0:double:butchering:3.5', say('MAJOR'));
check('a settlement of yours comes to the browser with its sockets', say('GROUND') === String(BAUBLE_TIER_BY_ID.get('minor')!.slots + 1), say('GROUND'));

check(`times add up, to the cap of ${BAUBLE_KINDS.time.cap}%`, near(Number(say('PACE')), 1 - BAUBLE_KINDS.time.cap / 100, 1e-9), say('PACE'));
check('a learning bauble is a multiplier on skill gain', near(Number(say('LEARN')), 1.1, 1e-9), say('LEARN'));
check('doubling chances add up', near(Number(say('DOUBLE')), 20, 1e-9), say('DOUBLE'));
check('an ancient bauble adds to its own job and to no other', say('PLUS') === '2|0', say('PLUS'));
check('what a go teaches is multiplied by it', near(Number(say('SKILLMULT')), 1.1, 1e-9), say('SKILLMULT'));
check('a builder is a citizen, and has it', near(Number(say('BUILDERPACE')), 0.5, 1e-9), say('BUILDERPACE'));
check('a guest is not, and has none of it', say('GUESTPACE') === '1|1', say('GUESTPACE'));
check('nor does anybody off the settlement', say('OFFPACE') === '1|1', say('OFFPACE'));
check('nothing is added outside a go', say('OUTSIDE') === '3', say('OUTSIDE'));
check('inside one, the ancient bauble adds, and the go that comes up is multiplied', say('INSIDE') === `5|${5 * YIELD_TIMES}`, say('INSIDE'));
check('through the clock a dig yields what the ancient bauble adds', say('DUG') === '2', say('DUG'));
check('said after the go\'s own words', /^You dig up some dirt\. \(QL [\d.]+\) \/ The baubles in the altar make that 2 × dirt\.$/.test(say('DUGSAID')), say('DUGSAID'));
check('and the go leaves nothing behind for the next', say('FOREIGN') === 'clear', say('FOREIGN'));
check('the next go takes the time off', near(Number(say('NEXTGO')), 0.9, 0.01), say('NEXTGO'));
check('and so does the first', near(Number(say('FIRSTGO')), 0.9, 1e-6), say('FIRSTGO'));

/* ---- the browser ------------------------------------------------------------ */
const game = Game.create(4242);
for (let y = 34; y <= 48; y++) for (let x = 34; x <= 50; x++) {
  game.world.setHeight(x, y, 4);
  game.world.setDirt(x, y, 5);
  game.world.setTile(x, y, TileType.Grass, 0);
}
game.neighbourDeeds = [];
const home: Deed = { name: 'Home', x: 40, y: 40, radius: 3, level: 1, mine: true, baubles: [] };
game.deed = home;
game.player.x = 40.5; game.player.y = 40.5;
const altar = game.addFurniture('altar', 41, 40, 0, 0, 50);
const chest = game.addFurniture('chest', 39, 40, 0, 0, 50);
const setDef = ACTION_BY_ID.get('set_bauble')!;
const aim = (id: number, uid: number, slot?: number): Target => ({ kind: 'furniture', id, itemUid: uid, ...(slot === undefined ? {} : { slot }) } as Target);
const lastSaid = (): string => game.log[game.log.length - 1]?.text ?? '';

// Found, and restored.
game.inventory.add('trowel', { ql: 90 });
game.skills.values.set('archaeology', 90);
const dig = ACTION_BY_ID.get('investigate')!;
for (let i = 0; i < 400; i++) {
  const x = 36 + (i % 12);
  const y = 36 + (Math.floor(i / 12) % 12);
  dig.perform({ kind: 'tile', x, y, cx: x, cy: y }, game);
}
const pack = [...game.inventory.items];
const bFound = pack.filter((i) => i.id === TARNISHED).reduce((n, i) => n + i.count, 0);
const bFrags = pack.filter((i) => i.id === 'fragment').reduce((n, i) => n + i.count, 0);
check(`the browser turns up a bauble for about ${BAUBLE_SHARE * 100}% of finds too`, near(bFound / Math.max(1, bFound + bFrags), BAUBLE_SHARE, 0.1),
  `${bFound} baubles and ${bFrags} fragments`);
check('each with its tier on it and the damage of the ground',
  pack.filter((i) => i.id === TARNISHED).every((i) => BAUBLE_TIER_BY_ID.has(i.extra as BaubleTier) && i.dmg >= 18 && i.dmg <= 68));
for (const i of pack) if (i.id === TARNISHED || i.id === 'fragment') game.inventory.remove(i.uid, i.count);
const restoreDef = ACTION_BY_ID.get('restore_relic')!;
const tarn = game.inventory.add(TARNISHED, { ql: 60, extra: 'major' });
tarn.dmg = 90;
check('the browser refuses one too far gone in the island\'s words', restoreDef.check?.({ kind: 'item', uid: tarn.uid }, game) === say('GONETOOFAR'));
tarn.dmg = 20;
game.skills.values.set('restoration', 100);
restoreDef.perform({ kind: 'item', uid: tarn.uid }, game);
const restored = game.inventory.items.find((i) => i.id === 'bauble_major');
check('and restores one to a major bauble it can read', !game.inventory.get(tarn.uid) && readBauble(restored ?? { id: '', extra: '' })?.kind === 'double',
  restored?.extra ?? 'nothing');
if (restored) game.inventory.remove(restored.uid, restored.count);

// Set into the altar.
const b1 = game.inventory.add('bauble_minor', { ql: 40, extra: 'stonecutting: 3.4% less time' });
check('the browser: a chest is not an altar', setDef.check?.(aim(chest.id, b1.uid), game) === BAUBLE_SAID.notAltar);
game.player.x = 43.5; game.player.y = 43.5;
check('it is set standing at the altar', setDef.check?.(aim(altar.id, b1.uid), game) === BAUBLE_SAID.reach);
game.player.x = 40.5; game.player.y = 40.5;
check('its founder sets one', setDef.check?.(aim(altar.id, b1.uid), game) === null);
setDef.perform(aim(altar.id, b1.uid), game);
check('into the first socket, and it is used up', home.baubles?.length === 1 && home.baubles[0].slot === 0 && !game.inventory.get(b1.uid));
check('saying it as the island says it', lastSaid() === say('SETSAID'), `${lastSaid()} | ${say('SETSAID')}`);
const b2 = game.inventory.add(TARNISHED, { ql: 40, extra: 'minor' });
check('a tarnished one is refused', setDef.check?.(aim(altar.id, b2.uid), game) === BAUBLE_SAID.tarnished);
const b3 = game.inventory.add('bauble_minor', { ql: 40, extra: 'masonry: 2.0% less time' });
home.role = 'builder';
check('a builder may not set one over another', setDef.check?.(aim(altar.id, b3.uid, 0), game) === BAUBLE_SAID.replace);
home.role = 'guest';
check('a guest may not set one at all', setDef.check?.(aim(altar.id, b3.uid), game) === BAUBLE_SAID.guest);
home.role = undefined;
setDef.perform(aim(altar.id, b3.uid, 0), game);
check('the founder may, and what was there is lost, said as the island says it',
  home.baubles?.length === 1 && home.baubles[0].key === 'masonry' && lastSaid() === say('OVERSAID'), `${lastSaid()} | ${say('OVERSAID')}`);
home.baubles = Array.from({ length: BAUBLE_TIER_BY_ID.get('minor')!.slots }, (_, slot) => ({ tier: 'minor' as const, slot, kind: 'time' as const, key: 'masonry', amount: 1 }));
const b4 = game.inventory.add('bauble_minor', { ql: 40, extra: 'cooking: +1.0% skill gain' });
check('every socket filled, it asks which to replace', setDef.check?.(aim(altar.id, b4.uid), game) === say('FULL'));
check('a socket past the last is no socket', setDef.check?.(aim(altar.id, b4.uid, 21), game) === BAUBLE_SAID.notBauble);
game.deed = null;
check('off a settlement of yours it is refused', setDef.check?.(aim(altar.id, b4.uid), game) === BAUBLE_SAID.notOurs);
game.deed = home;

// What they give.
home.baubles = [
  { tier: 'minor', slot: 0, kind: 'time', key: 'digging', amount: 10 },
  { tier: 'minor', slot: 1, kind: 'time', key: 'stonecutting', amount: 10 },
  { tier: 'minor', slot: 2, kind: 'time', key: 'stonecutting', amount: 45 },
  { tier: 'minor', slot: 3, kind: 'learn', key: 'cooking', amount: 10 },
  { tier: 'ancient', slot: 0, kind: 'plus', key: 'felling', amount: 2 },
];
const digDef = ACTION_BY_ID.get('dig')!;
game.skills.values.set('digging', 50);
const withTime = game.duration(digDef);
const learnWith = game.skillMult('cooking');
const kept = home.baubles;
home.baubles = [];
const withoutTime = game.duration(digDef);
const learnWithout = game.skillMult('cooking');
home.baubles = kept;
check('the browser takes the time off a job', near(withTime / withoutTime, 0.9, 1e-9), `${withTime} of ${withoutTime}`);
check('and multiplies what a go teaches', near(learnWith / learnWithout, 1.1, 1e-9));
const stoneDef = ACTION_BY_ID.get('cut_stone') ?? ACTIONS.find((a) => a.skill === 'stonecutting')!;
home.baubles = kept.filter((b) => b.key === 'stonecutting');
const capped = game.duration(stoneDef);
home.baubles = [];
const uncapped = game.duration(stoneDef);
home.baubles = kept;
check(`times add up, to the cap of ${BAUBLE_KINDS.time.cap}%`, near(capped / uncapped, 1 - BAUBLE_KINDS.time.cap / 100, 1e-9) || capped === uncapped,
  `${capped} of ${uncapped}`);
home.role = 'guest';
check('a guest has none of it', game.baubleHere().length === 0);
home.role = undefined;
game.player.x = 45.5;
check('nor does anybody off the settlement', game.baubleHere().length === 0);
game.player.x = 40.5;
const inGo = game as unknown as { baubleGo: { job: unknown; twice?: boolean; made: string[] } | null; sayBaubleGo(): void };
check('nothing is added outside a go', game.baubleYield('log', 3) === 3);
inGo.baubleGo = { job: ACTION_BY_ID.get('cut_down'), made: [] };
const once = game.baubleYield('log', 3);
inGo.baubleGo.twice = true;
const twice = game.baubleYield('log', 3);
inGo.sayBaubleGo();
check('inside one, what the island adds, and the go that comes up multiplied', `${once}|${twice}` === say('INSIDE'), `${once}|${twice}`);
check('said the way the island says it', lastSaid() === say('YIELDSAID'), `${lastSaid()} | ${say('YIELDSAID')}`);

for (const line of [...ok, ...bad]) console.log(line);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
if (bad.length) process.exit(1);
