/**
 * Seven ways to fight, and a rite for each.
 *
 * Three melee, two ranged, a healer, and one that fights with what fights
 * beside it -- drawn from the skills the craft trades leave alone, plus two
 * that had to be made.
 *
 * What this asks:
 *
 *   * both sides hold the same seven trades skill for skill, and the same
 *     seven rites field for field;
 *   * `act_scope` calls a swing by the thing in your hand rather than by
 *     `fighting`, which is what lets `hands` and `wind` tell a berserker from
 *     an archer at all;
 *   * each of the five new channels moves the number it claims, measured at
 *     the site that reads it -- and moves nothing for a trade that does not
 *     cover that skill, which is the whole of what separates two trades
 *     sharing a channel. Each is measured on a fighting trade that still has
 *     a tree with a column of it: the trades are moving to spells and
 *     passives one at a time (`talents.ts`), and one that has moved has no
 *     nodes to buy;
 *   * `aim` goes inside the ceiling, so a blow can never land more than
 *     ninety-six times in a hundred however much of it you buy;
 *   * a wound is closed by `chirurgy` now and not by `first_aid`;
 *   * and the rite: the same four refusals in the same words on both sides, a
 *     multiplier while it holds, nothing once it lapses, and a perk taken in
 *     the middle of one that does not put it out.
 *
 * Runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';
import {
  CLASS_COLUMNS, COMBAT_CLASSES, nodeDef, PERK_CLASSES, RITES, riteDef, riteRefusal, type ClassDef,
} from '../../src/game/classes';
import { WEAPON_BY_ID } from '../../src/game/gear';
import { perksOf } from '../../src/game/perks';

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
const near = (a: number, b: number, by = 1e-9): boolean => Math.abs(a - b) <= by;

/**
 * The first fighting trade that still has a tree with a column of this
 * channel, and the minor at the head of that column; none once every trade
 * that had one has moved to perks. `fits` says what else the trade must be
 * for the channel to be measured on it.
 */
const treed = (channel: string, fits: (c: ClassDef) => boolean = () => true): { c: ClassDef; node: string; mul: number } | null => {
  for (const c of COMBAT_CLASSES) {
    if (PERK_CLASSES.has(c.id) || !fits(c)) continue;
    const col = CLASS_COLUMNS[c.id].findIndex((x) => x.channel === channel);
    const n = col >= 0 ? nodeDef(`${c.id}_${col + 1}_1`) : undefined;
    if (n) return { c, node: n.id, mul: n.mul };
  }
  return null;
};
/** A line of armour or the shield, covered by the trade or not. */
const GUARDS = ['shields', 'chain_armour', 'plate_armour', 'leather_armour'];
const guardOf = (c: ClassDef, mine: boolean): string => GUARDS.find((s) => c.skills.includes(s) === mine)!;
const AIM = treed('aim');
const EDGE = treed('edge');
// Guard is measured on what it guards: a trade whose tree has it and that covers a line of armour or the shield.
const GUARD = treed('guard', (c) => GUARDS.some((s) => c.skills.includes(s)));
/** Knit, on the first fighting trade still on a tree with a column of it, and on first aid, which no fighting trade covers. */
const KNIT = treed('knit');
/** A kind of weapon the trade does not cover, for the channel to leave alone. */
const KINDS = [...new Set([...WEAPON_BY_ID.values()].map((x) => x.kind))].sort();
const otherKind = (c: ClassDef): string => KINDS.find((k) => !c.skills.includes(k))!;
/** A Sworn Blade's first passive, taken in the middle of its rite. */
const BLADE_PERK = perksOf('blade').find((p) => p.tier === 1 && Object.keys(p.fx).length > 0)!.id;

/** The trade put down and this one taken up afresh, at 55 in its main skill: below the ceiling, so aim shows. */
const takeUp = (c: ClassDef): string => `
  update player set combat_class = null, class_mul = null where world_id = w.world_id and uid = w.uid;
  delete from player_node where world_id = w.world_id and uid = w.uid;
  delete from caller where uid = w.uid;
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, '${c.main}', 55)
    on conflict (world_id, uid, id) do update set value = 55;
  perform rpc_take_class(w.world_id, '${c.id}');`;

const out = psql(`
begin;
create temp table said (k text);

-- The seven that are not schools, told apart by data rather than by a list:
-- a school's class is the one whose main skill a school_def names.
insert into said select 'LIST|' || string_agg(c.id || ':' || c.main || ':' ||
  (select string_agg(cs.skill, '+' order by cs.skill) from class_skill cs where cs.class = c.id),
  '|' order by c.id) from class_def c where c.kind = 'combat'
   and not exists (select 1 from school_def sc where sc.skill = c.main);
insert into said select 'ALLRITES|' || count(*) || '|'
  || (select count(*) from class_def where kind = 'combat') from rite_def;
-- The muls as a sorted key=value list rather than raw jsonb text, because
-- Postgres prints a space after the colon and JSON.stringify does not, and
-- that is a difference in printing rather than in the rulebook.
insert into said select 'RITES|' || string_agg(r.id || ':' || r.class || ':' || r.name || ':'
  || r.cost::int || ':' || r.level::int || ':' || r.secs::int || ':' || r.rest::int || ':'
  || (select string_agg(e.k || '=' || e.v, ';' order by e.k) from jsonb_each_text(r.muls) e(k, v)),
  '|' order by r.id) from rite_def r
 where r.class in (select c.id from class_def c where c.kind = 'combat'
   and not exists (select 1 from school_def sc where sc.skill = c.main));

do $$
declare w record; v jsonb; a double precision; b double precision;
        c double precision; d double precision; v_c creature; v_id int;
begin
  select p.world_id, p.uid into w from player p order by p.world_id, p.uid limit 1;
  update player set craft_class = null, combat_class = null, class_mul = null,
         act = null, act_target = null, act_ends = null, act_left = null, act_queue = '[]'::jsonb,
         favour = 120, used_at = '{}'::jsonb, rested = 0, boons = '[]'::jsonb,
         body_at = now(), swim_at = now(), equipped = '{}'::jsonb,
         stats = coalesce(stats, '{}'::jsonb)
           || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
    where world_id = w.world_id and uid = w.uid;
  delete from player_node where world_id = w.world_id and uid = w.uid;
  delete from caller where uid = w.uid;
  perform set_config('request.jwt.claims', json_build_object('sub', w.uid)::text, false);
  -- Below the ceiling on purpose: at a hundred in a weapon the chance is
  -- already pinned at 0.96 and aim would look like it did nothing.
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'swords', 55)
    on conflict (world_id, uid, id) do update set value = 55;
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'fighting', 10)
    on conflict (world_id, uid, id) do update set value = 10;
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'prayer', 60)
    on conflict (world_id, uid, id) do update set value = 60;
  perform rpc_take_class(w.world_id, 'blade');
  insert into said select 'SLOTS|' || coalesce(craft_class, 'none') || '|' || coalesce(combat_class, 'none')
    from player where world_id = w.world_id and uid = w.uid;

  -- act_scope: a swing is done with what is in your hand.
  update player set equipped = jsonb_build_object('weapon', (
      select id from item where world_id = w.world_id and holder = 'player'
        and holder_uid = w.uid and def = 'sword' limit 1))
    where world_id = w.world_id and uid = w.uid;
  if (select equipped->>'weapon' from player where world_id = w.world_id and uid = w.uid) is null then
    perform give(w.world_id, w.uid, 'sword', 1, 40);
    update player set equipped = jsonb_build_object('weapon', (
        select max(id) from item where world_id = w.world_id and holder = 'player'
          and holder_uid = w.uid and def = 'sword'))
      where world_id = w.world_id and uid = w.uid;
  end if;
  insert into said values ('SCOPE|' || act_scope(w.world_id, w.uid, 'fighting')
    || '|' || act_scope(w.world_id, w.uid, 'mining'));

  /*
   * The rite, on the Sworn Blade: four refusals, then the thing itself. A
   * hundred in swords, so nothing about the trade is short.
   */
  update skill set value = 100 where world_id = w.world_id and uid = w.uid and id = 'swords';
  insert into said values ('THEIRS|' || rite_refusal(w.world_id, w.uid, 'redhour'));
  update skill set value = 4 where world_id = w.world_id and uid = w.uid and id = 'prayer';
  insert into said values ('PRAYER|' || rite_refusal(w.world_id, w.uid, 'ward'));
  update skill set value = 60 where world_id = w.world_id and uid = w.uid and id = 'prayer';
  -- The settle time too, or favour trickles back up before the refusal is
  -- built and the sentence names a number nobody set.
  update player set favour = 3, favour_at = now() where world_id = w.world_id and uid = w.uid;
  insert into said values ('POOR|' || rite_refusal(w.world_id, w.uid, 'ward')
    || '|' || floor(favour_settle(w.world_id, w.uid))::int);
  update player set favour = 120, favour_at = now() where world_id = w.world_id and uid = w.uid;
  insert into said values ('READY|' || coalesce(rite_refusal(w.world_id, w.uid, 'ward'), 'ready'));

  a := class_mul(w.world_id, w.uid, 'guard', 'shields');
  v := rpc_rite(w.world_id, 'ward');
  b := class_mul(w.world_id, w.uid, 'guard', 'shields');
  insert into said values ('CALLED|' || coalesce(v->>'called', v->>'why') || '|' || (b / a)
    || '|' || class_mul(w.world_id, w.uid, 'guard', 'plate_armour'));
  insert into said values ('AGAIN|' || coalesce(rpc_rite(w.world_id, 'ward')->>'why', 'IT WENT THROUGH'));
  -- a perk taken mid-rite keeps it
  insert into said values ('KEPT|' || coalesce(rpc_take_perk(w.world_id, '${BLADE_PERK}')->>'why', 'taken')
    || '|' || class_mul(w.world_id, w.uid, 'guard', 'shields'));
  -- and it goes when its hour does
  update player set class_mul = jsonb_set(class_mul, '{rite,until}', to_jsonb(now() - interval '1 second'))
    where world_id = w.world_id and uid = w.uid;
  insert into said values ('LAPSED|' || class_mul(w.world_id, w.uid, 'guard', 'shields'));
${AIM ? `
  -- aim, below the ceiling and then hard against it, on a trade with a column of it.
  ${takeUp(AIM.c)}
  a := hit_chance(w.world_id, w.uid, '${AIM.c.main}');
  c := hit_chance(w.world_id, w.uid, '${otherKind(AIM.c)}');
  perform rpc_take_node(w.world_id, '${AIM.node}');
  b := hit_chance(w.world_id, w.uid, '${AIM.c.main}');
  insert into said values ('AIM|' || a || '|' || b || '|' || (hit_chance(w.world_id, w.uid, '${otherKind(AIM.c)}') / c));
  update skill set value = 100 where world_id = w.world_id and uid = w.uid and id = '${AIM.c.main}';
  insert into said values ('CEIL|' || hit_chance(w.world_id, w.uid, '${AIM.c.main}'));` : ''}
${EDGE ? `
  -- edge, on the trade's own weapon and on nothing else.
  ${takeUp(EDGE.c)}
  a := weapon_damage(w.world_id, w.uid, (select x from weapon_def x where kind = '${EDGE.c.main}' order by id limit 1), null::item);
  c := weapon_damage(w.world_id, w.uid, (select x from weapon_def x where kind = '${otherKind(EDGE.c)}' order by id limit 1), null::item);
  perform rpc_take_node(w.world_id, '${EDGE.node}');
  b := weapon_damage(w.world_id, w.uid, (select x from weapon_def x where kind = '${EDGE.c.main}' order by id limit 1), null::item);
  d := weapon_damage(w.world_id, w.uid, (select x from weapon_def x where kind = '${otherKind(EDGE.c)}' order by id limit 1), null::item);
  insert into said values ('EDGE|' || (b / a) || '|' || (d / c));` : ''}
${GUARD ? `
  -- guard, on the trade's own line of armour and not somebody else's.
  ${takeUp(GUARD.c)}
  perform rpc_take_node(w.world_id, '${GUARD.node}');
  insert into said values ('GUARD|' || class_mul(w.world_id, w.uid, 'guard', '${guardOf(GUARD.c, true)}')
    || '|' || class_mul(w.world_id, w.uid, 'guard', '${guardOf(GUARD.c, false)}'));` : ''}

  -- knit, and the skill that closes a wound.
${KNIT ? `
  update player set combat_class = null, class_mul = null where world_id = w.world_id and uid = w.uid;
  delete from player_node where world_id = w.world_id and uid = w.uid;
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, '${KNIT.c.main}', 60)
    on conflict (world_id, uid, id) do update set value = 60;
  perform give_coins(w.world_id, w.uid, class_change_cost()::bigint);
  perform rpc_take_class(w.world_id, '${KNIT.c.id}');
  perform rpc_take_node(w.world_id, '${KNIT.node}');
  insert into said values ('KNIT|' || class_mul(w.world_id, w.uid, 'knit', '${KNIT.c.main}')
    || '|' || class_mul(w.world_id, w.uid, 'knit', 'first_aid'));` : ''}
  insert into said select 'CLOSES|' || (select count(*) from pg_proc p join pg_namespace n
      on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'
       and p.proname = 'wounds_settle'
       and strpos(pg_get_functiondef(p.oid), quote_literal('chirurgy')) > 0);
  insert into said select 'ACTIONS|' || string_agg(id || ':' || skill, ',' order by id)
    from action_def where id in ('bind_wound', 'clean_wound', 'treat_creature');

  /*
   * fang, hide and quiet: the keeper's trade, on the animal.
   *
   * Put one there rather than looking for one. Asking the island for whatever
   * animal it happens to have leaves the measurement at the mercy of whatever
   * ran before it -- and in a full sweep, what ran before it had killed them.
   */
  v_id := creature_spawn(w.world_id, 'sappa',
    (select x from player where world_id = w.world_id and uid = w.uid),
    (select y from player where world_id = w.world_id and uid = w.uid), 'active', null, w.uid);
  select * into v_c from creature where world_id = w.world_id and id = v_id;
  if v_c.id is not null then
    a := attack_of(v_c); c := max_health(v_c);
    update player set combat_class = null, class_mul = null where world_id = w.world_id and uid = w.uid;
    delete from player_node where world_id = w.world_id and uid = w.uid;
    insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'soul_strength', 60)
      on conflict (world_id, uid, id) do update set value = 60;
    perform give_coins(w.world_id, w.uid, class_change_cost()::bigint);
    perform rpc_take_class(w.world_id, 'beastmaster');
    perform rpc_take_node(w.world_id, 'beastmaster_2_1');
    perform rpc_take_node(w.world_id, 'beastmaster_1_1');
    select * into v_c from creature where world_id = w.world_id and id = v_c.id;
    -- Creature health rounds to a whole number, so a ratio out of it is the
    -- multiplier plus whatever the rounding did. The channel itself is asked
    -- exactly; the health is asked only to have moved the right way.
    insert into said values ('BEAST|' || (attack_of(v_c) / a)
      || '|' || class_mul(w.world_id, w.uid, 'hide', 'soul_strength')
      || '|' || (case when max_health(v_c) > c then 'up' else 'no' end));
    -- and an animal with no keeper is nobody's business
    update creature set keeper = null where world_id = w.world_id and id = v_c.id;
    select * into v_c from creature where world_id = w.world_id and id = v_c.id;
    insert into said values ('STRAY|' || (attack_of(v_c) / a));
  end if;
end $$;

select * from said;
rollback;
`);

const said = (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

const island = said('LIST').split('|').sort();
const browser = COMBAT_CLASSES
  .map((c) => `${c.id}:${c.main}:${[...c.skills].sort().join('+')}`).sort();
check('both sides hold the same seven fighting trades, skill for skill',
  island.join() === browser.join(),
  island.join() === browser.join() ? `${island.length} of them`
    : `island ${island.length}, browser ${browser.length}`);

const islandR = said('RITES').split('|').sort();
const browserR = RITES.filter((r) => COMBAT_CLASSES.some((c) => c.id === r.class))
  .map((r) => `${r.id}:${r.class}:${r.name}:${r.cost}:${r.level}:${r.secs}:${r.rest}:`
  + Object.keys(r.muls).sort().map((k) => `${k}=${r.muls[k as keyof typeof r.muls]}`).join(';')).sort();
check('and the same seven rites, field for field',
  islandR.join() === browserR.join(),
  islandR.join() === browserR.join() ? `${islandR.length} of them`
    : `island ${islandR[0]}, browser ${browserR[0]}`);
const [riteCount, combatCount] = said('ALLRITES').split('|').map(Number);
check('one rite to a trade, and every fighting trade has one',
  riteCount === combatCount && COMBAT_CLASSES.every((c) => RITES.some((r) => r.class === c.id)),
  `${riteCount} rites over ${combatCount} fighting trades`);

check('a fighting trade goes in the combat slot and leaves the craft one alone',
  said('SLOTS') === 'none|blade', said('SLOTS'));

const [swung, dug] = said('SCOPE').split('|');
check('a swing is done with what is in your hand, and a dig is still digging',
  swung === 'swords' && dug === 'mining', `fighting reads as ${swung}, mining as ${dug}`);

/** Said when no fighting trade has a tree with this channel any more, and there is nothing to buy to measure it. */
const moved = (channel: string): string => `no fighting trade has a tree with ${channel} in it any more`;
if (AIM) {
  const [aimPlain, aimTree, aimOther] = said('AIM').split('|').map(Number);
  check(`aim: a minor is ${Math.round((AIM.mul - 1) * 100)} per cent more of the blows landing, on ${AIM.c.main} alone (${AIM.c.name})`,
    near(aimTree / aimPlain, AIM.mul, 1e-9) && aimOther === 1,
    `${aimPlain} → ${aimTree}, and ${otherKind(AIM.c)} ×${aimOther}`);
  check('and it goes inside the ceiling, so nothing lands more than 96 times in 100',
    Number(said('CEIL')) <= 0.96, said('CEIL'));
} else {
  check(`aim: ${moved('aim')}`, said('AIM') === 'MISSING', said('AIM'));
}

if (EDGE) {
  const [edgeMine, edgeOther] = said('EDGE').split('|').map(Number);
  check(`edge: a minor is ${Math.round((EDGE.mul - 1) * 100)} per cent on ${EDGE.c.main} and nothing on ${otherKind(EDGE.c)} (${EDGE.c.name})`,
    near(edgeMine, EDGE.mul, 1e-9) && edgeOther === 1, `${EDGE.c.main} ×${edgeMine}, ${otherKind(EDGE.c)} ×${edgeOther}`);
} else {
  check(`edge: ${moved('edge')}`, said('EDGE') === 'MISSING', said('EDGE'));
}

if (GUARD) {
  const [gMine, gOther] = said('GUARD').split('|').map(Number);
  check(`guard: the trade’s own ${guardOf(GUARD.c, true).replace('_', ' ')}, and not somebody else’s ${guardOf(GUARD.c, false).replace('_', ' ')} (${GUARD.c.name})`,
    near(gMine, GUARD.mul, 1e-9) && gOther === 1, `×${gMine}, ×${gOther}`);
} else {
  check(`guard: ${moved('guard')}`, said('GUARD') === 'MISSING', said('GUARD'));
}

const ward = riteDef('ward')!;
check('a rite that is not yours is refused, in the same words on both sides',
  said('THEIRS') === riteRefusal(riteDef('redhour')!, 'blade', 99, 999, 0),
  said('THEIRS'));
check('too little prayer, ditto',
  said('PRAYER') === riteRefusal(ward, 'blade', 4, 999, 0), said('PRAYER'));
const [poorWhy, poorHeld] = said('POOR').split('|');
check('too little favour, ditto',
  poorWhy === riteRefusal(ward, 'blade', 60, Number(poorHeld), 0), poorWhy);
check('and with the prayer and the favour it is ready', said('READY') === 'ready', said('READY'));

const [called, riteMul, ritePlate] = said('CALLED').split('|');
check('calling it multiplies its channel, on the trade’s own skills only',
  called === 'ward' && near(Number(riteMul), ward.muls.guard!, 1e-9) && Number(ritePlate) === 1,
  `${called}, guard ×${riteMul}, plate ×${ritePlate}`);
check('and it will not be called twice in a row',
  said('AGAIN') === riteRefusal(ward, 'blade', 60, 120, ward.rest), said('AGAIN'));
const [keptPerk, keptMul] = said('KEPT').split('|');
check('a perk taken in the middle of a rite does not put the rite out',
  keptPerk === 'taken' && near(Number(keptMul), ward.muls.guard!, 1e-9), said('KEPT'));
check('and when its hour is up it stops',
  near(Number(said('LAPSED')), 1, 1e-9), said('LAPSED'));

if (KNIT) {
  const [knitMine, knitTheirs] = said('KNIT').split('|').map(Number);
  check(`knit tells on ${KNIT.c.main} and not on the forager’s first aid`,
    knitMine > 1 && knitTheirs === 1, `${KNIT.c.main} ×${knitMine}, first aid ×${knitTheirs}`);
} else {
  check(`knit: ${moved('knit')}`, said('KNIT') === 'MISSING', said('KNIT'));
}
check('and a wound is closed by chirurgy now', said('CLOSES') === '1', said('CLOSES'));
check('with the dressing of one taught by it too',
  said('ACTIONS') === 'bind_wound:chirurgy,clean_wound:chirurgy,treat_creature:chirurgy',
  said('ACTIONS'));

if (said('BEAST') === 'MISSING') {
  check('a beastmaster’s animal bites harder and takes more killing', false, 'no creature to try it on');
} else {
  const [fang, hide, went] = said('BEAST').split('|');
  check('a beastmaster’s animal bites harder and takes more killing',
    near(Number(fang), 1.04, 1e-9) && near(Number(hide), 1.04, 1e-9) && went === 'up',
    `fang ×${fang}, hide ×${hide}, health went ${went}`);
  check('and an animal with no keeper is nobody’s business',
    Number(said('STRAY')) === 1, said('STRAY'));
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`seven ways to fight, and a rite for each — ${ok.length} of ${ok.length}`);
