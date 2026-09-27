/**
 * The Herdsman's eighteen perks, each measured where its rule is.
 *
 * `perks.ts` holds the two sides to each other for every trade on perks; this
 * asks the one thing that is the Herdsman's own: that each perk does what its
 * note says, on the island. Where a perk is a chance, the island's dice are put
 * either side of its number inside the transaction (`dice.random`, first on the
 * search path), so a go shows the number itself:
 *
 *   * taming: Soft Hand's points, Patient Coax's step, Young Trust's young and
 *     Any Bait's any food, in the chance, the words and the refusal;
 *   * the brush: Brushwork's care and Healing Hands' health;
 *   * a beast you keep: the keeper's numbers stamped on it when it is tamed and
 *     when the keeper's perks change, and read by the tick, the work and the
 *     age -- Light Eaters, Lasting Care, Well Kept and Long-lived -- and sent
 *     to the browser with the beast;
 *   * the pairing: Short Rest, Quick Gestation, Twins, True Blood, Bred Up and
 *     Choose the Sex, at the covering and the birth;
 *   * Light Crate's weight, Stud Book's odds, and the Herdsman's tree gone;
 *   * and the browser reckons and says the same.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { coaxStep, tameChance, TAME_MOST } from '../../src/game/creatureActions';
import { AGES, BREED_REST, CARE_BONUS, CARE_HOURS, careMul, COAX_STEP, GESTATION, keptOf, OLD_AT, ageOf, setLocalKept, type Creature } from '../../src/game/creatures';
import { breedChance, GROOM_HEAL, groomGain, studBook } from '../../src/game/husbandry';
import { ITEM_DEFS } from '../../src/game/items';
import { perksOf, type PerkDef } from '../../src/game/perks';
import { breedTraits, inheritChance, TRAIT_SLOTS, upgradeChance } from '../../src/game/traits';

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
const near = (a: number, b: number, by = 1e-6): boolean => Math.abs(a - b) <= by * Math.max(1, Math.abs(b));

const HERDSMAN = perksOf('herdsman');
const P = (name: string): PerkDef => {
  const p = HERDSMAN.find((x) => x.name === name);
  if (!p) throw new Error(`the Herdsman has no perk called ${name}`);
  return p;
};
const fx = (name: string, key: string): number => {
  const v = P(name).fx[key];
  if (v === undefined) throw new Error(`${name} has no ${key}`);
  return v;
};
const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const hold = (...names: string[]): string =>
  `perform pg_temp.hold(w, u, array[${names.map((n) => q(P(n).id)).join(', ')}]::text[])`;
const count = (def: string): string =>
  `(select coalesce(sum(i.count), 0) from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = '${def}')`;
const clear = (...defs: string[]): string =>
  `delete from item where world_id = w and holder = 'player' and holder_uid = u and def in (${defs.map(q).join(', ')})`;
const last = (like: string): string =>
  `(select e.text from event e where e.world_id = w and e.uid = u and e.text like ${q(like)} order by e.n desc limit 1)`;
const beast = (a: string, id = 'v_c', more = ''): string =>
  `perform act_perform(w, u, '${a}', jsonb_build_object('kind', 'creature', 'id', ${id}${more}))`;
const refused = (a: string, id = 'v_c'): string =>
  `coalesce(act_refusal(w, u, '${a}', jsonb_build_object('kind', 'creature', 'id', ${id})), 'ALLOWED')`;
const row = (id: string): string => `(select c from creature c where c.world_id = w and c.id = ${id})`;
const dice = (...xs: number[]): string => `perform pg_temp.dice('${xs.join(',')}')`;
const nodice = 'perform pg_temp.nodice()';
/** A creature held still where it was put, fed, and out of anybody's way. */
const still = (id: string, set = ''): string =>
  `update creature set hunger = 1, from_x = to_x, from_y = to_y, leg_at = now(), leg_ends = now()${set.includes('settled_at') ? '' : ', settled_at = now()'}${set}
     where world_id = w and id = ${id}`;
const SKILL = 40;
const BRUSH_QL = 50;
const SIRE = ['fanged', 'thick_hided', 'plated'];
const DAM = ['fanged', 'thick_hided', 'plated'];
const arr = (xs: string[]): string => `'{${xs.join(',')}}'::text[]`;
/** Between the plain odds a slot is drawn from the pair and True Blood's, at no husbandry and no care. */
const KEEP_AT = inheritChance(0, 0) + fx('True Blood', 'breed:inherit') / 2;
/** Under Bred Up's odds a slot comes out a tier better, at no husbandry and no care, where the plain odds are none. */
const UP_AT = fx('Bred Up', 'breed:upgrade') / 2;
const AGED = 20 * 3600;
/** A tick long enough to measure and short enough that a kept one is not yet hungry enough to go to the stores. */
const TICK = 1200;

const out = psql(`
begin;
create temp table said (k text, v text);

create function pg_temp.hold(w uuid, u uuid, ids text[]) returns jsonb language plpgsql as $f$
begin
  delete from player_node where world_id = w and uid = u;
  insert into player_node (world_id, uid, node) select w, u, x from unnest(ids) x;
  return class_fold(w, u);
end $f$;
create schema dice;
create function dice.random() returns double precision language plpgsql volatile as $f$
declare xs text[] := string_to_array(current_setting('wurm.dice'), ',');
        n int := coalesce(nullif(current_setting('wurm.dice_n', true), ''), '0')::int;
begin
  perform set_config('wurm.dice_n', (n + 1)::text, true);
  return xs[1 + n % array_length(xs, 1)]::double precision;
end $f$;
create function pg_temp.dice(v text) returns void language plpgsql as $f$
begin
  perform set_config('wurm.dice', v, true);
  perform set_config('wurm.dice_n', '0', true);
  perform set_config('search_path', 'dice, public, pg_catalog', true);
end $f$;
create function pg_temp.nodice() returns void language plpgsql as $f$
begin
  perform set_config('search_path', '"$user", public', true);
end $f$;

do $$
declare w uuid; u uuid; tx int; ty int; v_t text; v_u text; v_c int; v_y int; v_dam int; v_sire int; v_n int;
begin
  -- The suite's own island and its first body, a Herdsman now, on flat grass on its settlement.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  for tx in 0..15 loop for ty in 0..15 loop
    perform land_set_height(w, tx, ty, 40); perform land_set_dirt(w, tx, ty, 20);
    perform land_set_tile(w, tx, ty, tile_id('Grass')); perform land_set_data(w, tx, ty, 0);
  end loop; end loop;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  delete from player_node where world_id = w and uid = u;
  -- Nothing of its own about: what it kept goes wild, and nothing else stands near.
  update creature set rider = null where world_id = w and rider = u;
  update creature set mode = 'wild', keeper = null where world_id = w and keeper = u;
  delete from creature where world_id = w and greatest(abs(to_x - 9.5), abs(to_y - 9.5)) < 12;
  delete from caller where uid = u;
  update player set x = 9.5, y = 9.5, act = null, act_target = null, act_started = null, act_ends = null,
         act_left = null, act_goes = null, act_queue = '[]', craft_class = 'herdsman', combat_class = null,
         class_mul = null, level_h = null, way = null, body_at = now(), swim_at = now(), equipped = '{}'::jsonb,
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
   where world_id = w and uid = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  insert into skill (world_id, uid, id, value)
    select w, u, s, ${SKILL} from unnest(array['animal_husbandry', 'taming', 'soul_strength']) s
    on conflict (world_id, uid, id) do update set value = excluded.value;
  update skill set value = 20 where world_id = w and uid = u and id = 'soul_strength';
  insert into said values ('DEED', coalesce((my_deed(w, u)).name, 'none'));

  /* ---- Taming: a wild rabba, grown and young, and what each perk makes of the chance. ---- */
  v_c := creature_spawn(w, 'rabba', 10.4, 9.5, 'wild', now() - interval '3 hours', null);
  ${still('v_c', ', coaxed = 0, coaxed_at = null')};
  v_y := creature_spawn(w, 'rabba', 10.4, 9.8, 'wild', now() - interval '1 minute', null);
  ${still('v_y', ', coaxed = 0, coaxed_at = null')};
  perform pg_temp.hold(w, u, '{}');
  v_t := tame_chance(w, u, ${row('v_c')}) || ':' || tame_chance(w, u, ${row('v_y')});
  ${hold('Soft Hand')};
  v_t := v_t || '|' || tame_chance(w, u, ${row('v_c')});
  ${hold('Young Trust')};
  v_t := v_t || '|' || tame_chance(w, u, ${row('v_y')});
  -- Three refused offerings behind it.
  update creature set coaxed = 3, coaxed_at = now() where world_id = w and id = v_c;
  perform pg_temp.hold(w, u, '{}');
  v_t := v_t || '|' || tame_chance(w, u, ${row('v_c')}) || ':' || coax_bonus(${row('v_c')});
  ${beast('examine_creature')};
  v_u := coalesce(${last('A wild rabba:%')}, 'unsaid');
  ${hold('Patient Coax')};
  v_t := v_t || ':' || tame_chance(w, u, ${row('v_c')});
  ${beast('examine_creature')};
  insert into said values ('TAME', v_t);
  insert into said values ('COAXSAID', v_u || '#' || coalesce(${last('A wild rabba:%')}, 'unsaid'));
  update creature set coaxed = 0, coaxed_at = null where world_id = w and id = v_c;

  /* ---- Any Bait: a bowl of stew is no rabba's food, and it is for a Herdsman who has it. ---- */
  perform give(w, u, 'stew', 1, 40);
  perform pg_temp.hold(w, u, '{}');
  v_t := ${refused('tame')} || '#' || coalesce(bait_in_pack(w, u, 'rabba'), 'none');
  ${hold('Any Bait')};
  v_t := v_t || '#' || ${refused('tame')} || '#' || coalesce(bait_in_pack(w, u, 'rabba', true), 'none');
  -- Offered, it goes; and the rabba, with the dice under the chance, is won over and kept.
  ${dice(0.01)};
  ${beast('tame')};
  ${nodice};
  insert into said values ('ANYBAIT', v_t || '|' || ${count('stew')} || ':' || (select mode || ':' || coalesce(keeper::text = u::text, false) from creature where world_id = w and id = v_c));
  delete from creature where world_id = w and id = v_y;

  /* ---- A beast you keep: stamped when it is tamed, and when the keeper's perks change. ---- */
  ${hold('Light Eaters', 'Lasting Care', 'Well Kept', 'Long-lived')};
  v_t := coalesce((select kept::text from creature where world_id = w and id = v_c), 'none');
  perform pg_temp.hold(w, u, '{}');
  v_t := v_t || '|' || coalesce((select kept::text from creature where world_id = w and id = v_c), 'none');
  -- Tamed by somebody with the perks, and it comes stamped.
  update creature set mode = 'wild', keeper = null where world_id = w and id = v_c;
  ${hold('Light Eaters', 'Lasting Care', 'Well Kept', 'Long-lived')};
  update creature set mode = 'active', keeper = u where world_id = w and id = v_c;
  insert into said values ('STAMP', v_t || '|' || coalesce((select kept::text from creature where world_id = w and id = v_c), 'none'));
  -- The tick: twenty minutes of hunger and care, with the keeper's numbers and without, on a beast of no traits.
  ${still('v_c', `, care = 1, traits = '{}'::text[], settled_at = now() - interval '${TICK} seconds'`)};
  perform creature_settle(w, v_c);
  v_t := (select round(hunger::numeric, 6) || ':' || round(care::numeric, 6) from creature where world_id = w and id = v_c);
  update creature set kept = null where world_id = w and id = v_c;
  ${still('v_c', `, care = 1, settled_at = now() - interval '${TICK} seconds'`)};
  perform creature_settle(w, v_c);
  v_t := v_t || '|' || (select round(hunger::numeric, 6) || ':' || round(care::numeric, 6) from creature where world_id = w and id = v_c);
  -- Well Kept: the work and learning a shine is worth, and half of one.
  update creature set kept = kept_of(w, u), care = 1 where world_id = w and id = v_c;
  v_t := v_t || '|' || care_mul(${row('v_c')}) || ':' || beast_mul(${row('v_c')}, 'work') / trait_mul((select traits from creature where world_id = w and id = v_c), 'work');
  update creature set care = 0.5 where world_id = w and id = v_c;
  v_t := v_t || ':' || care_mul(${row('v_c')});
  update creature set kept = null where world_id = w and id = v_c;
  v_t := v_t || ':' || care_mul(${row('v_c')});
  -- Long-lived: twenty hours old, grown for the perk and old without it; and the browser told both.
  update creature set born = now() - make_interval(secs => ${AGED}), kept = kept_of(w, u) where world_id = w and id = v_c;
  v_t := v_t || '|' || age_of((select born from creature where world_id = w and id = v_c), old_of(${row('v_c')}))
    || '#' || coalesce((select x->>'age' from jsonb_array_elements(rpc_creatures(w, 20)) x where (x->>'id')::int = v_c), 'unsent')
    || '#' || coalesce((select (x->'kept')::text from jsonb_array_elements(rpc_creatures(w, 20)) x where (x->>'id')::int = v_c), 'unsent');
  update creature set kept = null where world_id = w and id = v_c;
  v_t := v_t || '#' || age_of((select born from creature where world_id = w and id = v_c), old_of(${row('v_c')}));
  insert into said values ('KEPT', v_t);
  update creature set born = now() - interval '3 hours' where world_id = w and id = v_c;

  /* ---- The brush: a brushing's care and its healing, with the perks and without. ---- */
  -- Each stroke told with the brush and the hand as they were when it was made: the brush wears and the hand learns.
  perform give(w, u, 'brush', 1, ${BRUSH_QL});
  perform pg_temp.hold(w, u, '{}');
  update creature set care = 0, health = max_health(c) / 2 from creature c where creature.world_id = w and creature.id = v_c and c.world_id = w and c.id = v_c;
  v_u := tool_ql(w, u, 'brush') || ':' || skill_of(w, u, 'animal_husbandry');
  ${beast('groom')};
  v_t := (select round(care::numeric, 6) || ':' || round((health / max_health(c))::numeric, 6) from creature c where c.world_id = w and c.id = v_c) || ':' || v_u;
  ${hold('Brushwork', 'Healing Hands')};
  update creature set care = 0, health = max_health(c) / 2 from creature c where creature.world_id = w and creature.id = v_c and c.world_id = w and c.id = v_c;
  v_u := tool_ql(w, u, 'brush') || ':' || skill_of(w, u, 'animal_husbandry');
  ${beast('groom')};
  insert into said values ('BRUSH', v_t || '|' || (select round(care::numeric, 6) || ':' || round((health / max_health(c))::numeric, 6) from creature c where c.world_id = w and c.id = v_c)
    || ':' || v_u);
  delete from creature where world_id = w and id = v_c;

  /* ---- The pairing: a pair of rabbas, put together with the dice under the odds. ---- */
  v_dam := creature_spawn(w, 'rabba', 10.1, 9.5, 'active', now() - interval '3 hours', u);
  v_sire := creature_spawn(w, 'rabba', 10.6, 9.5, 'deed', now() - interval '3 hours', u);
  ${still('v_dam', ", sex = 'female', name = 'Snow', care = 0.5, traits = " + arr(DAM))};
  ${still('v_sire', ", sex = 'male', name = 'Horn', care = 0.5, traits = " + arr(SIRE))};
  -- Stud Book, before they are put together.
  perform pg_temp.hold(w, u, '{}');
  ${beast('examine_creature', 'v_dam')};
  v_t := coalesce(${last('Snow (%')}, 'unsaid');
  ${hold('Stud Book')};
  ${beast('examine_creature', 'v_dam')};
  insert into said values ('STUD', v_t || '#' || coalesce(${last('Snow (%')}, 'unsaid'));
  -- Plain: taken, and the rest and the carrying the rule's; the sex the dice's.
  perform pg_temp.hold(w, u, '{}');
  ${dice(0.1)};
  ${beast('pair_creature', 'v_dam', ", 'sex', 'female'")};
  ${nodice};
  v_t := (select extract(epoch from due - now())::int || ':' || (breed_rest() - extract(epoch from now() - bred_at))::int || ':'
           || (unborn->>'sex') || ':' || (unborn ? 'twin') from creature where world_id = w and id = v_dam)
    || ':' || coalesce(${last('Horn is put to Snow%')}, 'unsaid');
  update creature set due = null, unborn = null, bred_at = null where world_id = w and id in (v_dam, v_sire);
  -- A breeder with all six: a quarter of an hour's carrying, twenty-five minutes' rest, twins, and the sex asked for.
  ${hold('Short Rest', 'Quick Gestation', 'Twins', 'Choose the Sex')};
  ${dice(0.1)};
  ${beast('pair_creature', 'v_dam', ", 'sex', 'female'")};
  ${nodice};
  v_t := v_t || '|' || (select extract(epoch from due - now())::int || ':' || (breed_rest() - extract(epoch from now() - bred_at))::int || ':'
           || (unborn->>'sex') || ':' || (unborn ? 'twin') || ':' || coalesce(unborn->'twin'->>'sex', 'none') from creature where world_id = w and id = v_dam)
    || ':' || (select (breed_rest() - extract(epoch from now() - bred_at))::int from creature where world_id = w and id = v_sire)
    || ':' || coalesce(${last('Horn is put to Snow%')}, 'unsaid');
  -- The hour comes with the dam at work on the settlement and nothing following: two young, the first
  -- following and the second where a second one goes, into the empty crate in the pack.
  perform give(w, u, 'creature_crate', 1, 40);
  update creature set mode = 'deed', due = now() - interval '1 second' where world_id = w and id = v_dam;
  v_n := give_birth(w, v_dam);
  v_t := v_t || '|' || (select count(*) from creature where world_id = w and pedigree->'dam'->>'id' = v_dam::text)
    || ':' || (select string_agg(sex || '/' || mode, ',' order by id) from creature where world_id = w and pedigree->'dam'->>'id' = v_dam::text)
    || ':' || (select count(*) from creature where world_id = w and pedigree->'dam'->>'id' = v_dam::text and pedigree->'sire'->>'name' = 'Horn');
  delete from creature where world_id = w and pedigree->'dam'->>'id' = v_dam::text;
  ${clear('creature_crate')};
  update creature set mode = 'active', due = null, unborn = null, bred_at = null where world_id = w and id = v_dam;
  update creature set due = null, unborn = null, bred_at = null where world_id = w and id in (v_dam, v_sire);
  -- And one that does not take: half of Short Rest's rest.
  ${dice(0.99)};
  ${beast('pair_creature', 'v_dam')};
  ${nodice};
  v_t := v_t || '|' || (select (breed_rest() - extract(epoch from now() - bred_at))::int || ':' || (due is null) from creature where world_id = w and id = v_dam);
  -- Without Choose the Sex a sex asked for is not the breeder's to ask.
  update creature set due = null, unborn = null, bred_at = null where world_id = w and id in (v_dam, v_sire);
  ${hold('Short Rest')};
  ${dice(0.1)};
  ${beast('pair_creature', 'v_dam', ", 'sex', 'female'")};
  ${nodice};
  insert into said values ('PAIR', v_t || '|' || (select unborn->>'sex' from creature where world_id = w and id = v_dam));

  /* ---- True Blood and Bred Up: the draw itself, at no husbandry and no care, with the dice held. ---- */
  ${dice(KEEP_AT)};
  v_t := (select string_agg(value, ',' order by value) from jsonb_each_text(breed_traits(${arr(SIRE)}, ${arr(DAM)}, 0, 0)->'from'))
    || '|' || (select string_agg(value, ',' order by value) from jsonb_each_text(breed_traits(${arr(SIRE)}, ${arr(DAM)}, 0, 0, ${fx('True Blood', 'breed:inherit')}, 0)->'from'));
  ${dice(UP_AT)};
  v_t := v_t || '|' || (select string_agg(value, ',' order by value) from jsonb_each_text(breed_traits(${arr(SIRE)}, ${arr(DAM)}, 0, 0)->'from'))
    || '|' || (select string_agg(value, ',' order by value) from jsonb_each_text(breed_traits(${arr(SIRE)}, ${arr(DAM)}, 0, 0, 0, ${fx('Bred Up', 'breed:upgrade')})->'from'));
  ${nodice};
  -- And through the covering, read off the breeder: pair_them hands the perks on.
  update creature set due = null, unborn = null, bred_at = null where world_id = w and id in (v_dam, v_sire);
  update skill set value = 0 where world_id = w and uid = u and id = 'animal_husbandry';
  update creature set care = 0 where world_id = w and id in (v_dam, v_sire);
  ${hold('True Blood')};
  ${dice(KEEP_AT)};
  perform pair_them(w, v_dam, v_sire, 0, u);
  ${nodice};
  insert into said values ('BLOOD', v_t || '|' || (select string_agg(value, ',' order by value) from jsonb_each_text((select unborn->'from' from creature where world_id = w and id = v_dam))));
  delete from creature where world_id = w and id in (v_dam, v_sire);

  /* ---- Light Crate: what an empty creature crate weighs in the pack. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${clear('brush', 'stew')};
  perform give(w, u, 'creature_crate', 1, 40);
  v_t := carried_weight(w, u)::text;
  ${hold('Light Crate')};
  insert into said values ('CRATE', v_t || '|' || carried_weight(w, u));
  ${clear('creature_crate')};

  insert into said values ('NODES', (select count(*) from class_node where id ~ '^herdsman_')::text || ':'
    || (select count(*) from player_node where node ~ '^herdsman_[0-9]_[0-9]$'));
end $$;

select k || E'\\t' || coalesce(v, '') from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const [k, ...v] = l.split('\t');
  return [k, v.join('\t')];
}));
const say = (k: string): string => said.get(k) ?? 'unsaid';
const json = (s: string | undefined): Record<string, number> | null => (!s || s === 'none' || s === 'unsent' ? null : JSON.parse(s));
const sameMark = (a: Record<string, number> | null, b: Record<string, number> | null): boolean =>
  JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());

check('the Herdsman stands on a settlement of theirs, where breeding is done', say('DEED') !== 'none', say('DEED'));

/* ---- Taming ------------------------------------------------------------------------------- */

const [tamePlain, tameOffer, tameYoung, tameCoax] = say('TAME').split('|');
const [grownPlain, youngPlain] = tamePlain.split(':').map(Number);
const offer = fx('Soft Hand', 'tame:offer');
check(`${P('Soft Hand').name}: an offering to a grown rabba is ${Math.round(offer * 100)} points likelier, under the ceiling`,
  near(Number(tameOffer), Math.min(TAME_MOST, grownPlain + offer)), `${grownPlain} → ${tameOffer}`);
const young = fx('Young Trust', 'tame:young');
check(`${P('Young Trust').name}: a young one is ${young} times as easy where it was ${AGES.young.tame}`,
  near(Number(tameYoung) / youngPlain, young / AGES.young.tame), `${youngPlain} → ${tameYoung}`);
const [coaxPlain, coaxBonusPlain, coaxPerk] = tameCoax.split(':').map(Number);
const step = fx('Patient Coax', 'coax:step');
check(`${P('Patient Coax').name}: three refused offerings are worth ${Math.round(3 * step * 100)} points where they were ${Math.round(3 * COAX_STEP * 100)}`,
  near(coaxBonusPlain, 3 * COAX_STEP) && near(coaxPerk - coaxPlain, 3 * (step - COAX_STEP)), tameCoax);
const [coaxSaid0, coaxSaid1] = say('COAXSAID').split('#');
check('and examining it says so, in the step of whoever looks',
  coaxSaid0.includes(`${Math.round(3 * COAX_STEP * 100)}% readier`) && coaxSaid1.includes(`${Math.round(3 * step * 100)}% readier`), say('COAXSAID'));
const [baitAsk, baitGone] = say('ANYBAIT').split('|');
const [baitNo, baitNone, baitYes, baitAny] = baitAsk.split('#');
check(`${P('Any Bait').name}: a bowl of stew is refused for a rabba without it and offered with it`,
  baitNo.startsWith('Rabbas take') && baitNone === 'none' && baitYes === 'ALLOWED' && baitAny === 'stew', baitAsk);
check('and the rabba takes it and is kept', baitGone === '0:active:true', baitGone);

/* ---- A beast you keep --------------------------------------------------------------------- */

const [stampHeld, stampDropped, stampTamed] = say('STAMP').split('|');
const keptWant = {
  'kept:hunger': fx('Light Eaters', 'kept:hunger'), 'kept:care_hours': fx('Lasting Care', 'kept:care_hours'),
  'kept:care_bonus': fx('Well Kept', 'kept:care_bonus'), 'kept:old_at': fx('Long-lived', 'kept:old_at'),
};
check('a keeper who takes the perks has them stamped on what they keep, and loses them with the perks',
  sameMark(json(stampHeld), keptWant) && stampDropped === 'none', `${stampHeld} / ${stampDropped}`);
check('and a beast tamed by a keeper with them comes stamped', sameMark(json(stampTamed), keptWant), stampTamed);
const [tickKept, tickPlain, careMuls, ages] = say('KEPT').split('|');
const [hungerKept, careKept] = tickKept.split(':').map(Number);
const [hungerPlain, carePlain] = tickPlain.split(':').map(Number);
check(`${P('Light Eaters').name}: ${TICK / 60} minutes' hunger is ${fx('Light Eaters', 'kept:hunger')} of what it was`,
  hungerPlain < 1 && near((1 - hungerKept) / (1 - hungerPlain), fx('Light Eaters', 'kept:hunger'), 1e-4), `${tickKept} / ${tickPlain}`);
check(`${P('Lasting Care').name}: a shine lasts ${fx('Lasting Care', 'kept:care_hours')} hours where it lasted ${CARE_HOURS}`,
  near(1 - careKept, TICK / 3600 / fx('Lasting Care', 'kept:care_hours'), 1e-4) && near(1 - carePlain, TICK / 3600 / CARE_HOURS, 1e-4), `${careKept} / ${carePlain}`);
const [careShine, workShine, careHalf, carePlainShine] = careMuls.split(':').map(Number);
const bonus = fx('Well Kept', 'kept:care_bonus');
check(`${P('Well Kept').name}: a shine is worth ${bonus} on work and learning, and half of one half that; ${CARE_BONUS} without`,
  near(careShine, 1 + bonus) && near(workShine, 1 + bonus, 1e-3) && near(careHalf, 1 + bonus / 2) && near(carePlainShine, 1 + CARE_BONUS / 2),
  careMuls);
const [ageKept, ageSent, keptSent, agePlain] = ages.split('#');
check(`${P('Long-lived').name}: twenty hours old is grown to its keeper and old without, and the browser is told both the age and the numbers`,
  ageKept === 'grown' && agePlain === 'old' && ageSent === 'grown' && sameMark(json(keptSent), keptWant), ages);

/* ---- The brush ---------------------------------------------------------------------------- */

const [brushPlain, brushPerk] = say('BRUSH').split('|');
const [carePlainB, healthPlainB, qlPlainB, skillPlainB] = brushPlain.split(':').map(Number);
const [carePerkB, healthPerkB, qlPerkB, skillPerkB] = brushPerk.split(':').map(Number);
const gain = groomGain(skillPlainB, qlPlainB);
check(`a brushing puts in what the browser says it does (${gain.toFixed(4)} at husbandry ${skillPlainB.toFixed(2)} and a QL ${qlPlainB.toFixed(2)} brush)`,
  near(carePlainB, gain, 1e-4), `${carePlainB}`);
check(`${P('Brushwork').name}: and ${fx('Brushwork', 'groom:care')} times that with it`,
  near(carePerkB, Math.min(1, groomGain(skillPerkB, qlPerkB) * fx('Brushwork', 'groom:care')), 1e-4), brushPerk);
check(`${P('Healing Hands').name}: it heals ${fx('Healing Hands', 'groom:heal')} of its health where it healed ${GROOM_HEAL}`,
  near(healthPlainB, 0.5 + GROOM_HEAL, 1e-4) && near(healthPerkB, 0.5 + fx('Healing Hands', 'groom:heal'), 1e-4), `${healthPlainB} / ${healthPerkB}`);

/* ---- The pairing -------------------------------------------------------------------------- */

const [pairPlain, pairPerk, births, failed, unasked] = say('PAIR').split('|');
const pp = pairPlain.split(':');
check('a plain pairing carries for the rule\'s time and rests for the rule\'s, one young of the dice\'s sex whatever is asked',
  Number(pp[0]) === GESTATION && Number(pp[1]) === BREED_REST && pp[2] === 'male' && pp[3] === 'false', pairPlain);
const pk = pairPerk.split(':');
const gest = fx('Quick Gestation', 'breed:gestation');
const rest = fx('Short Rest', 'breed:rest');
check(`${P('Quick Gestation').name}: carried for ${GESTATION * gest} seconds`, Number(pk[0]) === GESTATION * gest, pairPerk);
check(`${P('Short Rest').name}: both rest ${BREED_REST * rest} seconds`, Number(pk[1]) === BREED_REST * rest && Number(pk[5]) === BREED_REST * rest, pairPerk);
check(`${P('Choose the Sex').name}: the sex asked for, twin and all`, pk[2] === 'female' && pk[4] === 'female', pairPerk);
check(`${P('Twins').name}: with the dice under ${fx('Twins', 'breed:twins')}, a second young at the covering`, pk[3] === 'true', pairPerk);
check('and the words say the time she carries', pk.slice(6).join(':').includes('drop in about'), pk.slice(6).join(':'));
const [bornN, bornWho, bornSired] = births.split(':');
check('the hour comes and two are dropped, each with its pedigree, the first following and the second into the crate in the pack',
  bornN === '2' && bornSired === '2' && bornWho === 'female/active,female/stored', births);
const [failRest, failDue] = failed.split(':');
check('and a pairing that does not take rests half of Short Rest\'s', Number(failRest) === BREED_REST * rest / 2 && failDue === 'true', failed);
check('without Choose the Sex a sex asked for is the dice\'s', unasked === 'male', unasked);

const [blood0, blood1, up0, up1, bloodPaired] = say('BLOOD').split('|');
const drawn = (s: string): boolean => s.split(',').every((x) => ['dam', 'sire', 'both'].includes(x));
check(`${P('True Blood').name}: with the dice between ${inheritChance(0, 0)} and ${inheritChance(0, 0) + fx('True Blood', 'breed:inherit')}, every slot is rolled without it and drawn from the pair with it`,
  blood0.split(',').every((x) => x === 'roll') && drawn(blood1), `${blood0} / ${blood1}`);
check(`${P('Bred Up').name}: with the dice under ${fx('Bred Up', 'breed:upgrade')}, nothing comes out better without it and every slot does with it`,
  !up0.includes('up') && up1.split(',').every((x) => x === 'up'), `${up0} / ${up1}`);
check('and a covering reads the breeder\'s True Blood', drawn(bloodPaired), bloodPaired);

/* ---- The crate, the book and the tree ----------------------------------------------------- */

const [crateNo, crateYes] = say('CRATE').split('|').map(Number);
const crateKg = ITEM_DEFS.creature_crate.weight;
check(`${P('Light Crate').name}: an empty creature crate weighs ${crateKg * fx('Light Crate', 'weight:creature_crate')} kg where it weighed ${crateKg}`,
  near(crateNo - crateYes, crateKg * (1 - fx('Light Crate', 'weight:creature_crate'))), `${crateNo} → ${crateYes}`);
const [studNo, studYes] = say('STUD').split('#');
const care = 0.5;
const studWant = ` Put to Horn, it takes ${Math.round(breedChance(SKILL, care) * 100)}% of the time; each of the young's ${TRAIT_SLOTS} traits is `
  + `drawn from their blood ${Math.round(inheritChance(SKILL, care) * 100)}% of the time and comes out a tier better `
  + `${Math.round(upgradeChance(SKILL, care) * 100)}% of the time.`;
check(`${P('Stud Book').name}: examining one of yours says the odds, in the browser's words, and nothing without it`,
  studYes.endsWith(studWant) && !studNo.includes('Put to'), `${studYes.slice(-160)} // ${studWant}`);
check('and the Herdsman\'s tree is gone', say('NODES') === '0:0', say('NODES'));

/* ---- the browser's half ------------------------------------------------------------------ */

const game = Game.create(2718);
game.time = 2 * AGED;
game.setPerks({});
game.skills.values.set('taming', SKILL);
game.skills.values.set('soul_strength', 20);
const wild = game.creatures.spawn('rabba', game.player.x + 0.4, game.player.y, 'wild', game.rand, game.time);
wild.hunger = 1;
wild.born = 0;
const plainChance = tameChance(game, wild);
game.setPerks(P('Soft Hand').fx);
check('the browser\'s Soft Hand adds the same points', near(tameChance(game, wild) - plainChance, Math.min(TAME_MOST, plainChance + offer) - plainChance),
  `${plainChance} → ${tameChance(game, wild)}`);
game.setPerks(P('Patient Coax').fx);
check('and its Patient Coax the same step', coaxStep(game) === step, String(coaxStep(game)));
// A kept one offline reads your own perks; one the island has spoken for reads the island's.
const kept = game.creatures.spawn('rabba', game.player.x + 0.8, game.player.y, 'active', game.rand, game.time) as Creature;
kept.born = game.time - AGED;
game.setPerks({ ...P('Long-lived').fx, ...P('Well Kept').fx, ...P('Lasting Care').fx, ...P('Light Eaters').fx });
check('offline, a beast of yours is kept by your own perks', keptOf(kept, 'kept:old_at', OLD_AT) === fx('Long-lived', 'kept:old_at')
  && ageOf(kept, game.time) === 'grown', `${keptOf(kept, 'kept:old_at', OLD_AT)} ${ageOf(kept, game.time)}`);
kept.care = 1;
check('and its care is worth what the island says', near(careMul(kept), 1 + bonus), String(careMul(kept)));
kept.kept = null;
check('and one the island has said nothing of keeps the rule\'s', ageOf(kept, game.time) === 'old' && near(careMul(kept), 1 + CARE_BONUS), ageOf(kept, game.time));
setLocalKept({});
// The draw in the browser, off the same dice.
const from = (keep: number, up: number, r: number): string =>
  Object.values(breedTraits(SIRE, DAM, 0, 0, () => r, keep, up).from).sort().join(',');
check('the browser draws as the island does with and without True Blood', from(0, 0, KEEP_AT) === blood0 && from(fx('True Blood', 'breed:inherit'), 0, KEEP_AT) === blood1,
  `${from(0, 0, KEEP_AT)} / ${from(fx('True Blood', 'breed:inherit'), 0, KEEP_AT)}`);
check('and with and without Bred Up', from(0, 0, UP_AT) === up0 && from(0, fx('Bred Up', 'breed:upgrade'), UP_AT) === up1,
  `${from(0, 0, UP_AT)} / ${from(0, fx('Bred Up', 'breed:upgrade'), UP_AT)}`);
// Stud Book in the browser, on a pair beside you.
game.setPerks(P('Stud Book').fx);
game.skills.values.set('animal_husbandry', SKILL);
const dam = game.creatures.spawn('rabba', game.player.x + 0.5, game.player.y, 'active', game.rand, game.time) as Creature;
const sire = game.creatures.spawn('rabba', game.player.x + 1, game.player.y, 'deed', game.rand, game.time) as Creature;
Object.assign(dam, { sex: 'female', care, name: 'Snow', due: 0 });
Object.assign(sire, { sex: 'male', care, name: 'Horn', due: 0 });
for (const c of [...game.creatures.list.values()]) if (c !== dam && c !== sire && c.sex === 'male' && c.species === 'rabba') c.mode = 'wild';
check('the browser\'s Stud Book says what the island\'s does', studBook(game, dam) === studWant, `${studBook(game, dam)} // ${studWant}`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the Herdsman's perks — ${ok.length} of ${ok.length}`);
