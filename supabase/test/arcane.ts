/**
 * A stone, and what you can get out of it.
 *
 * There is no mana here. A focus is a cut gem in a silver claw, casting wears
 * it away, and every number the system needs was already on the item: the kind
 * it is, how well it was cut, how rare a find it was, and how much of it is
 * left.
 *
 * What this asks:
 *
 *   * both sides hold the same three schools and the same six spells, field
 *     for field;
 *   * the four pieces of arithmetic agree to the last bit -- what a cast takes
 *     out of a stone, what it does when it arrives, how long its mark lasts
 *     and how far it carries -- fed the same inputs on both sides;
 *   * a better cut wastes less, a rarer find holds more, and high dark ground
 *     is cheaper to cast on than low bright ground;
 *   * the three refusals are the same sentences on both sides;
 *   * all three effects land: a burn takes health off a beast, a hold pushes
 *     its next turn out, and a skin stands between a blow and the body;
 *   * a skin spent against a blow stays spent -- which it did not, before;
 *   * and the three channels move their own school's numbers and nobody
 *     else's.
 *
 * Runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';
import {
  SCHOOLS, SPELLS, spellDef, spellWear, spellForce, spellSecs, spellRange,
  landEase, spellRefusal,
} from '../../src/game/arcane';

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

const out = psql(`
begin;
create temp table said (k text);

insert into said select 'SCHOOLS|' || string_agg(sc.id || ':' || sc.name || ':' || sc.skill || ':'
  || (select string_agg(st.gem, '+' order by st.ord) from school_stone st where st.school = sc.id),
  '|' order by sc.id) from school_def sc;
-- The three trades behind the three schools, and their rites, which fight.ts
-- deliberately leaves out so that neither file counts the other's.
insert into said select 'MAGIC|' || string_agg(c.id || ':' || c.main || ':'
  || coalesce((select r.id from rite_def r where r.class = c.id), 'none'), '|' order by c.id)
  from class_def c where c.kind = 'combat'
   and exists (select 1 from school_def sc where sc.skill = c.main);
insert into said select 'SPELLS|' || string_agg(d.id || ':' || d.school || ':' || d.name || ':'
  || d.level::int || ':' || d.gem || ':' || d.wear || ':' || d.power || ':' || d.secs || ':'
  || d.range || ':' || d.at_what, '|' order by d.id) from spell_def d;

do $$
declare w record; v jsonb; f bigint; f2 bigint; r creature; a double precision; b double precision;
        v_was double precision; v_x int; v_y int; v_id int;
begin
  select p.world_id, p.uid into w from player p order by p.world_id, p.uid limit 1;
  update player set craft_class = null, combat_class = null, class_mul = null,
         act = null, act_target = null, act_ends = null, act_left = null, act_queue = '[]'::jsonb,
         wounds = '[]'::jsonb, equipped = '{}'::jsonb,
         stats = jsonb_build_object('health', 1, 'stamina', 1, 'hunger', 1, 'thirst', 1)
    where world_id = w.world_id and uid = w.uid;
  delete from player_node where world_id = w.world_id and uid = w.uid;
  delete from item where world_id = w.world_id and holder = 'player'
    and holder_uid = w.uid and def = 'focus';
  delete from caller where uid = w.uid;
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'kindling', 60)
    on conflict (world_id, uid, id) do update set value = 60;
  perform set_config('request.jwt.claims', json_build_object('sub', w.uid)::text, false);
  perform rpc_take_class(w.world_id, 'kindler');

  -- The three refusals. The card opens at fifty, so the school is dropped to
  -- ten only after it has been taken, to ask the one about the level.
  insert into said values ('NOSTONE|' || spell_refusal(w.world_id, w.uid, 'ember'));
  insert into said values ('THEIRS|' || spell_refusal(w.world_id, w.uid, 'snare'));
  update skill set value = 10 where world_id = w.world_id and uid = w.uid and id = 'kindling';
  insert into said values ('TOOLOW|' || spell_refusal(w.world_id, w.uid, 'pyre'));
  update skill set value = 60 where world_id = w.world_id and uid = w.uid and id = 'kindling';
  -- And binding, because the hold below is asked of a binding spell and would
  -- otherwise be measured against a school this body has never touched.
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'binding', 45)
    on conflict (world_id, uid, id) do update set value = 45;

  -- The arithmetic, on a stone of known cut and the ground actually underfoot.
  f := give(w.world_id, w.uid, 'focus', 1, 70, 'Garnet');
  select floor(x)::int, floor(y)::int into v_x, v_y from player
    where world_id = w.world_id and uid = w.uid;
  insert into said select 'SUMS|' || 60 || '|' || 70 || '|'
    || land_height(w.world_id, v_x, v_y) || '|' || darkness(w.world_id) || '|'
    || land_ease(w.world_id, v_x, v_y) || '|'
    || spell_wear(w.world_id, w.uid, (select d from spell_def d where id = 'ember'),
                  focus_for(w.world_id, w.uid, 'garnet')) || '|'
    || spell_force(w.world_id, w.uid, (select d from spell_def d where id = 'ember'),
                   focus_for(w.world_id, w.uid, 'garnet')) || '|'
    || spell_secs(w.world_id, w.uid, (select d from spell_def d where id = 'snare')) || '|'
    || skill_of(w.world_id, w.uid, 'binding') || '|'
    || spell_range(w.world_id, w.uid, (select d from spell_def d where id = 'ember'));
  insert into said values ('READY|' || coalesce(spell_refusal(w.world_id, w.uid, 'ember'), 'may be cast'));

  -- A better cut wastes less.
  a := spell_wear(w.world_id, w.uid, (select d from spell_def d where id = 'ember'),
                  focus_for(w.world_id, w.uid, 'garnet'));
  update item set ql = 20 where id = f;
  b := spell_wear(w.world_id, w.uid, (select d from spell_def d where id = 'ember'),
                  focus_for(w.world_id, w.uid, 'garnet'));
  insert into said values ('CUT|' || a || '|' || b);
  update item set ql = 70, rare = 'rare' where id = f;
  insert into said values ('FIND|' || spell_wear(w.world_id, w.uid,
    (select d from spell_def d where id = 'ember'), focus_for(w.world_id, w.uid, 'garnet')));
  update item set rare = null where id = f;

  -- Thrift, on this school and on nobody else's.
  perform rpc_take_node(w.world_id, 'kindler_3_1');
  insert into said values ('THRIFT|' || class_mul(w.world_id, w.uid, 'thrift', 'kindling')
    || '|' || class_mul(w.world_id, w.uid, 'thrift', 'warding')
    || '|' || spell_wear(w.world_id, w.uid, (select d from spell_def d where id = 'ember'),
                         focus_for(w.world_id, w.uid, 'garnet')));

  /*
   * A burn takes health off a beast, and the stone wears.
   *
   * The beast is put there rather than looked for. A sweep runs this after
   * sixty other files and what they leave behind is not a promise.
   */
  v_id := creature_spawn(w.world_id, 'sappa',
    (select x from player where world_id = w.world_id and uid = w.uid),
    (select y from player where world_id = w.world_id and uid = w.uid));
  select * into r from creature where world_id = w.world_id and id = v_id;
  if r.id is not null then
    update creature set health = 900 where world_id = w.world_id and id = r.id;
    update item set dmg = 0 where id = f;
    v_was := 900;
    v := rpc_spell(w.world_id, 'ember', jsonb_build_object('id', r.id));
    insert into said select 'BURN|' || coalesce(v->>'cast', v->>'why') || '|'
      || (v_was - (select health from creature where world_id = w.world_id and id = r.id)) || '|'
      || (select dmg from item where id = f);

    -- A hold pushes its next turn out past now.
    update player set combat_class = 'binder', class_mul = null where world_id = w.world_id and uid = w.uid;
    perform class_fold(w.world_id, w.uid);
    f2 := give(w.world_id, w.uid, 'focus', 1, 70, 'Sapphire');
    update creature set until = now() - interval '1 minute' where world_id = w.world_id and id = r.id;
    v := rpc_spell(w.world_id, 'snare', jsonb_build_object('id', r.id));
    insert into said select 'HOLD|' || coalesce(v->>'cast', v->>'why') || '|'
      || round(extract(epoch from ((select until from creature where world_id = w.world_id and id = r.id) - now()))::numeric, 0);
  end if;

  -- The skin: it stands in front of a blow, and stays spent afterwards.
  update player set combat_class = 'warder', class_mul = null, wounds = '[]'::jsonb,
      stats = jsonb_build_object('health', 1, 'stamina', 1, 'hunger', 1, 'thirst', 1, 'aegis', 0.15)
    where world_id = w.world_id and uid = w.uid;
  perform class_fold(w.world_id, w.uid);
  perform hurt_player(w.world_id, w.uid, 0.20, 'a bite', 'bite');
  insert into said select 'SKIN|' || coalesce(stats->>'aegis', 'gone') || '|'
    || round((wounds->0->>'severity')::numeric, 3) || '|' || round((stats->>'health')::numeric, 3)
    from player where world_id = w.world_id and uid = w.uid;

  -- And a stone worn through goes.
  update player set combat_class = 'kindler', class_mul = null where world_id = w.world_id and uid = w.uid;
  perform class_fold(w.world_id, w.uid);
  update item set dmg = 99.5 where id = f;
  if r.id is not null then
    v := rpc_spell(w.world_id, 'ember', jsonb_build_object('id', r.id));
    insert into said select 'SPENT|' || coalesce((v->>'spent'), 'no') || '|'
      || (select count(*) from item where id = f);
  end if;
end $$;

select * from said;
rollback;
`);

const said = (key: string): string =>
  out.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

const islandS = said('SCHOOLS').split('|').sort();
const browserS = SCHOOLS.map((s) => `${s.id}:${s.name}:${s.skill}:${s.stones.join('+')}`).sort();
check('both sides hold the same three schools, and the stones each works',
  islandS.join() === browserS.join(), islandS.join(' / '));

const islandP = said('SPELLS').split('|').sort();
const browserP = SPELLS.map((s) => `${s.id}:${s.school}:${s.name}:${s.level}:${s.gem}:${s.wear}:${s.power}:${s.secs}:${s.range}:${s.at}`).sort();
check('and the same six spells, field for field',
  islandP.join() === browserP.join(),
  islandP.join() === browserP.join() ? `${islandP.length} of them`
    : `island ${islandP.find((s, i) => s !== browserP[i])}, browser ${browserP.find((s, i) => s !== islandS[i])}`);
check('two to a school, the small one out of the commoner stone',
  SCHOOLS.every((sc) => {
    const mine = SPELLS.filter((s) => s.school === sc.id);
    return mine.length === 2 && mine.find((s) => s.level === 1)?.gem === sc.stones[0]
      && mine.find((s) => s.level > 1)?.gem === sc.stones[1];
  }));

const magic = said('MAGIC').split('|').sort();
check('each school has a trade behind it, and that trade has a rite',
  magic.length === SCHOOLS.length && magic.every((m) => !m.endsWith(':none')),
  magic.join(' / '));

const ember = spellDef('ember')!;
const snare = spellDef('snare')!;
const [skill, ql, height, dark, ease, wear, force, secs, bindSkill, range] = said('SUMS').split('|').map(Number);
check('the land is worth the same to a stone on both sides',
  near(ease, landEase(height, dark)),
  `at height ${height} and darkness ${dark}: island ${ease}, browser ${landEase(height, dark)}`);
check('what a cast takes out of the stone agrees to the last bit',
  near(wear, spellWear(ember, ql, 1, ease, 1)), `island ${wear}, browser ${spellWear(ember, ql, 1, ease, 1)}`);
check('and what it does when it arrives',
  near(force, spellForce(ember, skill, ql, 1)), `island ${force}, browser ${spellForce(ember, skill, ql, 1)}`);
check('and how long its mark lasts',
  near(secs, spellSecs(snare, bindSkill, 1)),
  `at ${bindSkill} binding: island ${secs}, browser ${spellSecs(snare, bindSkill, 1)}`);
check('and how far it carries',
  near(range, spellRange(ember, 1)), `island ${range}, browser ${spellRange(ember, 1)}`);

check('with no stone in your pack it will not be cast, in the same words',
  said('NOSTONE') === spellRefusal(ember, 'kindling', 60, null), said('NOSTONE'));
check('another school’s spell is not yours, ditto',
  said('THEIRS') === spellRefusal(snare, 'kindling', 60, null), said('THEIRS'));
check('and one above your school, ditto',
  said('TOOLOW') === spellRefusal(spellDef('pyre')!, 'kindling', 10, { ql: 70, dmg: 0 }), said('TOOLOW'));
check('with the stone in hand it may be cast', said('READY') === 'may be cast', said('READY'));

const [cut70, cut20] = said('CUT').split('|').map(Number);
check('a better cut wastes less of the stone', cut70 < cut20, `QL 70 costs ${cut70}, QL 20 costs ${cut20}`);
check('and a rarer find holds more casts', Number(said('FIND')) < cut70,
  `plain ${cut70}, rare ${said('FIND')}`);

const [thriftMine, thriftTheirs, thriftWear] = said('THRIFT').split('|').map(Number);
check('thrift tells on your own school and on nobody else’s',
  near(thriftMine, 0.97) && thriftTheirs === 1 && near(thriftWear, cut70 * 0.97, 1e-9),
  `kindling ×${thriftMine}, warding ×${thriftTheirs}, and the wear fell to ${thriftWear}`);

if (said('BURN') === 'MISSING') {
  check('a burn takes health off a beast and wears the stone', false, 'no creature to cast at');
} else {
  const [cast, tookOff, stoneWear] = said('BURN').split('|');
  check('a burn takes health off a beast and wears the stone',
    cast === 'ember' && Number(tookOff) > 0 && Number(stoneWear) > 0,
    `${cast}: ${tookOff} off the beast, ${stoneWear} marks off the stone`);
  const [held, until] = said('HOLD').split('|');
  check('a hold pushes the beast’s next turn out past now',
    held === 'snare' && Number(until) > 0, `${held}, next turn in ${until}s`);
}

const [skin, sev, health] = said('SKIN').split('|');
check('a skin stands in front of the blow and is spent doing it',
  Number(skin) === 0 && near(Number(sev), 0.05, 1e-6) && near(Number(health), 0.95, 1e-6),
  `skin ${skin}, wound ${sev}, health ${health}`);

const [spent, stillThere] = said('SPENT').split('|');
check('and a stone worn through goes to grit', spent === 'true' && stillThere === '0',
  `spent ${spent}, rows left ${stillThere}`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a stone, and what you can get out of it — ${ok.length} of ${ok.length}`);
