/**
 * Perks: six tiers of three, and the Terraformer's eighteen.
 *
 * Asked for: "Every class will have 6 tiers: level 50, 60, 70, 80, 90, 100.
 * Each tier allows one choice between 3 choices." What this asks, of both
 * sides and in the same words:
 *
 *   * the island holds the browser's perks field for field -- tier, name, note
 *     and every number in `fx` -- the same six tiers at the same skill, the
 *     same rule for folding two numbers under one key, and the same roads;
 *   * choosing is refused in the browser's words (`perkRefusal`): another
 *     trade's perk, one you have, a second at the same tier, and a tier that
 *     is not open yet; a perk taken says what it does, and the tree the
 *     Trades window draws has every tier with its three, open or not, taken
 *     or not, and the reason under each that cannot be taken;
 *   * the island's fold is the browser's `foldPerks` and `foldFx`: times
 *     multiply, a carry adds, the rest is the larger;
 *   * every key a perk has is read by some rule on the island, so no perk is
 *     a number nothing looks at;
 *   * and each Terraformer perk does what its note says, measured where the
 *     rule is: the time a job is started with, a flatten's two units, dig and
 *     flatten in deeper water, dredging deeper, a steeper cut, a road walked
 *     faster, a stronger back, lighter soil, slabs that never fail, cobbles
 *     that now and then cost no brick, a stump's log, a whole tile dug in a
 *     go, cleaner and rarer earth, a map, and soil taken from and put into a
 *     cart further off -- the last five through the clock, where a go's
 *     perks are its context and nowhere else;
 *   * and putting the trade down takes its perks with it.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, DIG_TILE_TIME, digDepth, FLATTEN_STEP, MINE_DEPTH, SLOPE_FLOOR, SLOPE_PER_SKILL, slopeNeeds, SPOIL_REACH, TILE_CORNERS } from '../../src/game/actions';
import { CLASSES, PERK_CLASSES, PERK_TIER_AT, PERKS_PER_TIER } from '../../src/game/classes';
import { foldFx, foldPerks, FX_RULE, type Fx, PERKS, perkRefusal, perksOf, type PerkDef } from '../../src/game/perks';
import { ITEM_DEFS, MARK_FAMILIES } from '../../src/game/items';
import { BRIDGES } from '../../src/game/bridges';
import { buildWork } from '../../src/game/buildActions';
import { MATERIALS as BUILD_MATERIALS } from '../../src/game/building';
import { ROAD_TILES, TILE_DEFS } from '../../src/world/tiles';

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
const near = (a: number, b: number, by = 1e-6): boolean => Math.abs(a - b) <= by;
/** Two folds, key for key, to within a float's last bits. */
const sameFx = (a: Fx, b: Fx): boolean => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.join() === kb.join() && ka.every((k) => near(a[k], b[k], 1e-9));
};

const TF = perksOf('terraformer');
const P = (name: string): PerkDef => {
  const p = TF.find((x) => x.name === name);
  if (!p) throw new Error(`the Terraformer has no perk called ${name}`);
  return p;
};
const tierOf = (t: number): PerkDef[] => TF.filter((p) => p.tier === t);
const [T1A, T1B] = tierOf(1);
const [T2A] = tierOf(2);
// One at every tier, the first of each: the most a Terraformer can hold.
const EACH = PERK_TIER_AT.map((_, i) => tierOf(i + 1)[0]);
const MAIN = CLASSES.find((c) => c.id === 'terraformer')!.main;
const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const arr = (ps: PerkDef[]): string => `array[${ps.map((p) => q(p.id)).join(', ')}]::text[]`;

// A made-up perk for the fold's rules, with a key of every family the others use.
const ZZ: Fx = { 'time:flatten': 0.5, carry: 10, 'depth:dig': 30, 'ql:dig': 2, 'reach:soil': 3, 'weight:dirt': 0.5 };
const FOLDSET = ['Quick Level', 'Strong Back', 'Wader', 'Clean Earth', 'Long Reach', 'Soil Porter'].map(P);

/*
 * Until something comes of a go: a skill check fails one go in fifty however
 * good the hand, and what is measured here is what a go that works brings.
 */
const until = (what: string, done: string): string => `
  for k in 1..12 loop
    update item set dmg = 0 where id = v_shovel;
    ${what};
    exit when ${done};
  end loop;`;
const dig = (x: number, y: number): string =>
  `perform pg_temp.go(w, u, 'dig', jsonb_build_object('kind', 'tile', 'x', ${x}, 'y', ${y}, 'cx', ${x}, 'cy', ${y}))`;

const out = psql(`
begin;
create temp table said (k text, v text);

/* The rulebook, as the island holds it. */
insert into said select 'PERKS', jsonb_agg(jsonb_build_object('id', id, 'class', class, 'tier', tier, 'num', num,
  'name', name, 'note', note, 'fx', fx) order by id)::text from class_perk;
insert into said select 'TIERS_AT', string_agg(tier || ':' || at, ',' order by tier) from perk_tier;
insert into said select 'RULES', string_agg(family || ':' || rule, ',' order by family) from perk_fx_rule;
insert into said select 'ROADS', string_agg(id::text, ',' order by id) from tile_def where road;
insert into said select 'CONSTS', flatten_step() || '|' || spoil_reach() || '|' || slope_per_skill() || '|' || slope_floor()
  || '|' || corners_per_tile() || '|' || dig_tile_time() || '|' || mine_depth();
insert into said select 'DIGTILE', base_time || '|' || skill || '|' || tool || '|' || difficulty || '|' || act_ported('dig_tile')
  from action_def where id = 'dig_tile';
insert into said select 'TREELESS', count(*)::text from class_node n join class_perk k on k.class = n.class;
insert into said select 'OLDNODES', count(*)::text from player_node where node ~ '^terraformer_[0-9]_[0-9]$';

/*
 * Every key a perk has, and how many of the island's rules read it: by name,
 * or by its family where the rule reads the family with the job or the thing
 * put on the end ('time:' || the job).
 */
insert into said select 'WIRED', string_agg(k.key || ':' || (
    select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and (strpos(p.prosrc, quote_literal(k.key)) > 0
            or strpos(p.prosrc, quote_literal(split_part(k.key, ':', 1) || ':') || ' ||') > 0)), '|' order by k.key)
  from (select distinct jsonb_object_keys(fx) as key from class_perk) k;

/* Somebody's perks, set outright: choosing is asked of the doors, and this is for measuring what one does. */
create function pg_temp.hold(w uuid, u uuid, ids text[]) returns jsonb language plpgsql as $f$
begin
  delete from player_node where world_id = w and uid = u;
  insert into player_node (world_id, uid, node) select w, u, x from unnest(ids) x;
  return class_fold(w, u);
end $f$;

/* A go of a job through the clock, as the heartbeat has it: a go's perks are its context there and nowhere else. */
create function pg_temp.go(w uuid, u uuid, a text, t jsonb) returns void language plpgsql as $f$
begin
  update player set act = a, act_target = t, act_started = now() - interval '2 seconds',
         act_ends = now() - interval '1 second', act_left = 1, act_goes = 1, act_queue = '[]'
   where world_id = w and uid = u;
  perform settle(w, u);
end $f$;

do $$
declare w uuid; u uuid; tx int; ty int; j jsonb; v_a double precision; v_b double precision; v_c double precision;
        v_shovel bigint; v_cart bigint; v_boat bigint; n int; k int; v_t text; v_u text;
begin
  -- The suite's own island, sixteen a side, by name, and somebody on it, on flat dirt.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  for tx in 0..15 loop for ty in 0..15 loop
    perform land_set_height(w, tx, ty, 40); perform land_set_dirt(w, tx, ty, 20);
    perform land_set_tile(w, tx, ty, tile_id('Dirt')); perform land_set_data(w, tx, ty, 0);
  end loop; end loop;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  -- And no soil in any store on the island, so that the only soil within reach is what is put there.
  delete from item where world_id = w and holder in ('crate', 'furniture') and def in ('dirt', 'sand', 'clay');
  delete from player_node where world_id = w and uid = u;
  delete from caller where uid = u;
  update placed set driver = null where world_id = w and driver = u;
  update placed set puller = null where world_id = w and puller = u;
  update player set x = 8.5, y = 8.5, act = null, act_target = null, act_started = null, act_ends = null,
         act_left = null, act_goes = null, act_queue = '[]', craft_class = null, combat_class = null,
         class_mul = null, level_h = null, rested = 0, boons = '[]'::jsonb, body_at = now(), swim_at = now(),
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1)
   where world_id = w and uid = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);

  /* ---- 1. Choosing, at the doors the buttons knock on. ---- */
  insert into skill (world_id, uid, id, value) values (w, u, '${MAIN}', 55)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  insert into said values ('NOTYOURS', coalesce(rpc_take_perk(w, ${q(T1A.id)})->>'why', 'IT WENT THROUGH'));
  insert into said values ('NOSUCH', coalesce(rpc_take_perk(w, 'terraformer_no_such_thing')->>'why', 'IT WENT THROUGH'));
  j := rpc_take_class(w, 'terraformer');
  insert into said values ('TRADE', coalesce(j->>'took', '-') || '|' || coalesce(j->>'why', '-'));
  insert into said values ('SHUT', coalesce(rpc_take_perk(w, ${q(T2A.id)})->>'why', 'IT WENT THROUGH'));
  j := rpc_take_perk(w, ${q(T1A.id)});
  insert into said values ('FIRST', coalesce(j->>'took', '-') || '|' || coalesce(j->>'why', '-'));
  insert into said values ('FIRSTFX', coalesce(j->'mul'->'fx', 'null'::jsonb)::text);
  insert into said select 'TOLD', e.text from event e where e.world_id = w and e.uid = u order by e.n desc limit 1;
  insert into said values ('TWICE', coalesce(rpc_take_perk(w, ${q(T1A.id)})->>'why', 'IT WENT THROUGH'));
  insert into said values ('OTHER', coalesce(rpc_take_perk(w, ${q(T1B.id)})->>'why', 'IT WENT THROUGH'));
  j := rpc_tree(w);
  insert into said select 'TIERS', coalesce((select t.value->'tiers' from jsonb_array_elements(j->'trades') t
                                             where t.value->>'class' = 'terraformer'), 'null'::jsonb)::text;
  -- One at every tier, the way the buttons take them, at a hundred.
  update skill set value = 100 where world_id = w and uid = u and id = '${MAIN}';
  ${EACH.slice(1).map((p) => `j := rpc_take_perk(w, ${q(p.id)});
  insert into said values ('EACH${p.tier}', coalesce(j->>'took', '-') || '|' || coalesce(j->>'why', '-'));`).join('\n  ')}
  insert into said select 'FOLD', coalesce(class_mul->'fx', 'null'::jsonb)::text from player where world_id = w and uid = u;
  insert into said select 'HELD', string_agg(node, ',' order by node) from player_node where world_id = w and uid = u;

  /* ---- 2. The fold's rules, with a made-up perk over the real ones. ---- */
  insert into class_perk (id, class, tier, num, name, note, fx)
    values ('terraformer_zz_test', 'terraformer', 1, 99, 'Test', 'test', ${q(JSON.stringify(ZZ))}::jsonb);
  j := pg_temp.hold(w, u, ${arr(FOLDSET)} || array['terraformer_zz_test']);
  insert into said values ('FOLDX', coalesce(j->'fx', 'null'::jsonb)::text);
  delete from class_perk where id = 'terraformer_zz_test';

  /* ---- 3. A job's time, where it is started: Quick Level on a flatten. ---- */
  perform land_set_height(w, 10, 8, 43);
  v_shovel := give(w, u, 'shovel', 1, 1);
  update skill set value = 1 where world_id = w and uid = u and id = 'digging';
  perform pg_temp.hold(w, u, '{}');
  j := rpc_act(w, 'flatten', jsonb_build_object('kind', 'tile', 'x', 9, 'y', 8));
  select extract(epoch from act_ends - act_started) into v_a from player where world_id = w and uid = u;
  v_t := coalesce(j->>'why', '-');
  update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_goes = null
   where world_id = w and uid = u;
  perform pg_temp.hold(w, u, ${arr([P('Quick Level')])});
  j := rpc_act(w, 'flatten', jsonb_build_object('kind', 'tile', 'x', 9, 'y', 8));
  select extract(epoch from act_ends - act_started) into v_b from player where world_id = w and uid = u;
  insert into said values ('TIME', coalesce(v_a::text, 'none') || '|' || coalesce(v_b::text, 'none')
    || '|' || v_t || '|' || coalesce(j->>'why', '-'));
  update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_goes = null
   where world_id = w and uid = u;

  /* ---- 4. Level Hand: two units a go, never past the mark, and both ways. ---- */
  update skill set value = 50 where world_id = w and uid = u and id = 'digging';
  update item set ql = 100, dmg = 0 where id = v_shovel;
  perform land_set_height(w, 10, 8, 44);
  perform pg_temp.hold(w, u, '{}');
  perform perform_ground(w, u, 'flatten', jsonb_build_object('kind', 'tile', 'x', 9, 'y', 8));
  v_t := land_height(w, 10, 8) || ',' || pack_count(w, u, 'dirt');
  perform pg_temp.hold(w, u, ${arr([P('Level Hand')])});
  perform perform_ground(w, u, 'flatten', jsonb_build_object('kind', 'tile', 'x', 9, 'y', 8));
  v_t := v_t || '|' || land_height(w, 10, 8) || ',' || pack_count(w, u, 'dirt');
  perform perform_ground(w, u, 'flatten', jsonb_build_object('kind', 'tile', 'x', 9, 'y', 8));
  v_t := v_t || '|' || land_height(w, 10, 8) || ',' || pack_count(w, u, 'dirt');
  perform land_set_height(w, 10, 8, 37);
  perform perform_ground(w, u, 'flatten', jsonb_build_object('kind', 'tile', 'x', 9, 'y', 8));
  v_t := v_t || '|' || land_height(w, 10, 8) || ',' || pack_count(w, u, 'dirt');
  insert into said values ('LEVEL', v_t);
  perform land_set_height(w, 10, 8, 40);
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'dirt';

  /* ---- 5. Wader: digging and flattening in deeper water. ---- */
  for tx in 1..4 loop for ty in 3..6 loop perform land_set_height(w, tx, ty, -12); end loop; end loop;
  update player set x = 2.5, y = 4.5 where world_id = w and uid = u;
  perform pg_temp.hold(w, u, '{}');
  insert into said values ('DEEP',
    coalesce(act_refusal(w, u, 'dig', jsonb_build_object('kind', 'tile', 'x', 2, 'y', 4, 'cx', 3, 'cy', 5)), 'ALLOWED')
    || '|' || coalesce(act_refusal(w, u, 'flatten', jsonb_build_object('kind', 'tile', 'x', 3, 'y', 4)), 'ALLOWED'));
  perform pg_temp.hold(w, u, ${arr([P('Wader')])});
  insert into said values ('WADED',
    coalesce(act_refusal(w, u, 'dig', jsonb_build_object('kind', 'tile', 'x', 2, 'y', 4, 'cx', 3, 'cy', 5)), 'ALLOWED')
    || '|' || coalesce(act_refusal(w, u, 'flatten', jsonb_build_object('kind', 'tile', 'x', 3, 'y', 4)), 'ALLOWED'));

  /* ---- 6. Dredger: a bottom further down, from a boat. ---- */
  for tx in 1..4 loop for ty in 8..11 loop perform land_set_height(w, tx, ty, -40); end loop; end loop;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'furniture', 'rowing_boat', 2, 9, 0, 0, 2.5, 9.5, 50, u) returning id into v_boat;
  update placed set driver = u where id = v_boat;
  update player set x = 2.5, y = 9.5 where world_id = w and uid = u;
  perform pg_temp.hold(w, u, '{}');
  insert into said values ('DREDGE', coalesce(act_refusal(w, u, 'dredge',
    jsonb_build_object('kind', 'tile', 'x', 2, 'y', 9, 'cx', 3, 'cy', 10)), 'ALLOWED'));
  perform pg_temp.hold(w, u, ${arr([P('Dredger')])});
  insert into said values ('DREDGED', coalesce(act_refusal(w, u, 'dredge',
    jsonb_build_object('kind', 'tile', 'x', 2, 'y', 9, 'cx', 3, 'cy', 10)), 'ALLOWED'));
  update placed set driver = null where id = v_boat;
  update player set x = 8.5, y = 8.5 where world_id = w and uid = u;

  /* ---- 7. Steep Cut: the slope a spade may leave. ---- */
  update skill set value = 50 where world_id = w and uid = u and id = 'digging';
  perform land_set_height(w, 12, 4, 219);
  perform pg_temp.hold(w, u, '{}');
  insert into said values ('SLOPE', max_dig_slope(w, u) || '|' || coalesce(slope_refusal(w, u, 'digging', 12, 5, -1), 'ALLOWED'));
  perform pg_temp.hold(w, u, ${arr([P('Steep Cut')])});
  insert into said values ('STEEP', max_dig_slope(w, u) || '|' || coalesce(slope_refusal(w, u, 'digging', 12, 5, -1), 'ALLOWED'));
  perform land_set_height(w, 12, 4, 40);

  /* ---- 8. Road Legs: on a road, and off it. ---- */
  perform land_set_tile(w, 8, 8, tile_id('Packed dirt'));
  perform pg_temp.hold(w, u, '{}');
  v_a := travel_speed(w, u);
  perform pg_temp.hold(w, u, ${arr([P('Road Legs')])});
  v_b := travel_speed(w, u);
  perform land_set_tile(w, 8, 8, tile_id('Dirt'));
  v_c := travel_speed(w, u);
  insert into said values ('ROAD', v_a || '|' || v_b || '|' || v_c || '|' || base_speed());

  /* ---- 9. Strong Back and Soil Porter: what you carry. ---- */
  perform pg_temp.hold(w, u, '{}');
  v_a := carry_limit(w, u);
  perform pg_temp.hold(w, u, ${arr([P('Strong Back')])});
  insert into said values ('CARRY', v_a || '|' || carry_limit(w, u));
  perform give(w, u, 'dirt', 10, 30); perform give(w, u, 'sand', 4, 30); perform give(w, u, 'clay', 3, 30);
  perform pg_temp.hold(w, u, '{}');
  v_a := carried_weight(w, u);
  perform pg_temp.hold(w, u, ${arr([P('Soil Porter')])});
  v_b := carried_weight(w, u);
  insert into said select 'LOAD', v_a || '|' || v_b || '|' || string_agg(i.def || ':' || item_weight(i), ',' order by i.def)
    from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.inside is null;
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def in ('dirt', 'sand', 'clay');

  /* ---- 10. Bed True: slabs at no skill, off the worst slab there is. ---- */
  insert into skill (world_id, uid, id, value) values (w, u, 'paving', 0)
    on conflict (world_id, uid, id) do update set value = 0;
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'stone_slab', 40, 1);
  for k in 1..40 loop
    update skill set value = 0 where world_id = w and uid = u and id = 'paving';
    perform perform_ground(w, u, 'pave_slabs', jsonb_build_object('kind', 'tile', 'x', 6, 'y', 6));
  end loop;
  n := 40 - pack_count(w, u, 'stone_slab');
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'stone_slab';
  perform give(w, u, 'stone_slab', 40, 1);
  perform pg_temp.hold(w, u, ${arr([P('Bed True')])});
  for k in 1..40 loop
    update skill set value = 0 where world_id = w and uid = u and id = 'paving';
    perform perform_ground(w, u, 'pave_slabs', jsonb_build_object('kind', 'tile', 'x', 6, 'y', 6));
  end loop;
  insert into said values ('SLABS', n || '|' || (40 - pack_count(w, u, 'stone_slab')));
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'stone_slab';

  /* ---- 11. Frugal Cobbler: a brick a go, and now and then none. ---- */
  perform pg_temp.hold(w, u, '{}');
  perform give(w, u, 'stone_brick', 30, 30);
  for k in 1..20 loop
    perform perform_terrain(w, u, 'pave_cobble', jsonb_build_object('kind', 'tile', 'x', 6, 'y', 7));
  end loop;
  n := 30 - pack_count(w, u, 'stone_brick');
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'stone_brick';
  perform give(w, u, 'stone_brick', 900, 30);
  perform pg_temp.hold(w, u, ${arr([P('Frugal Cobbler')])});
  for k in 1..600 loop
    perform perform_terrain(w, u, 'pave_cobble', jsonb_build_object('kind', 'tile', 'x', 6, 'y', 7));
  end loop;
  insert into said values ('COBBLE', n || '|' || (900 - pack_count(w, u, 'stone_brick')));
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'stone_brick';

  /* ---- 12. Stump Puller: the stump, and a log of its tree. ---- */
  update skill set value = 100 where world_id = w and uid = u and id = 'digging';
  update item set ql = 100, dmg = 0 where id = v_shovel;
  perform pg_temp.hold(w, u, '{}');
  perform land_set_tile(w, 7, 6, tile_id('Stump')); perform land_set_data(w, 7, 6, 2);
  ${until(`perform perform_ground(w, u, 'dig_stump', jsonb_build_object('kind', 'tile', 'x', 7, 'y', 6))`,
    `land_tile(w, 7, 6) <> tile_id('Stump')`)}
  v_t := land_tile(w, 7, 6) || ',' || pack_count(w, u, 'log');
  perform pg_temp.hold(w, u, ${arr([P('Stump Puller')])});
  perform land_set_tile(w, 7, 6, tile_id('Stump')); perform land_set_data(w, 7, 6, 2);
  ${until(`perform perform_ground(w, u, 'dig_stump', jsonb_build_object('kind', 'tile', 'x', 7, 'y', 6))`,
    `land_tile(w, 7, 6) <> tile_id('Stump')`)}
  insert into said select 'STUMP', v_t || '|' || land_tile(w, 7, 6) || ',' || pack_count(w, u, 'log') || '|'
    || coalesce((select string_agg(distinct coalesce(i.extra, '-'), ',') from item i
                  where i.world_id = w and i.holder = 'player' and i.holder_uid = u and i.def = 'log'), 'none')
    || '|' || (select name from tree_def where id = tree_species(2));

  /* ---- 13. Dig Out the Tile: asked, and done through the clock. ---- */
  perform pg_temp.hold(w, u, '{}');
  insert into said values ('TILE_NO', coalesce(act_refusal(w, u, 'dig_tile', jsonb_build_object('kind', 'tile', 'x', 9, 'y', 9)), 'ALLOWED'));
  perform pg_temp.hold(w, u, ${arr([P('Dig Out the Tile')])});
  insert into said values ('TILE_YES', coalesce(act_refusal(w, u, 'dig_tile', jsonb_build_object('kind', 'tile', 'x', 9, 'y', 9)), 'ALLOWED'));
  ${until(`perform pg_temp.go(w, u, 'dig_tile', jsonb_build_object('kind', 'tile', 'x', 9, 'y', 9))`, `land_height(w, 9, 9) < 40`)}
  insert into said values ('DUG', land_height(w, 9, 9) || ',' || land_height(w, 10, 9) || ',' || land_height(w, 9, 10)
    || ',' || land_height(w, 10, 10) || '|' || pack_count(w, u, 'dirt'));
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'dirt';

  /* ---- 14. Clean Earth: a dig's quality, with the roll taken out (a perfect shovel gives the skill). ---- */
  perform pg_temp.hold(w, u, '{}');
  ${until(`update skill set value = 50 where world_id = w and uid = u and id = 'digging'; ${dig(9, 4)}`, `pack_count(w, u, 'dirt') > 0`)}
  select max(ql) into v_a from item where world_id = w and holder = 'player' and holder_uid = u and def = 'dirt';
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'dirt';
  perform pg_temp.hold(w, u, ${arr([P('Clean Earth')])});
  ${until(`update skill set value = 50 where world_id = w and uid = u and id = 'digging'; ${dig(9, 4)}`, `pack_count(w, u, 'dirt') > 0`)}
  select max(ql) into v_b from item where world_id = w and holder = 'player' and holder_uid = u and def = 'dirt';
  insert into said values ('QL', coalesce(v_a::text, 'none') || '|' || coalesce(v_b::text, 'none'));
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'dirt';

  /* ---- 15. Rare Earth, with its chance put at one so that the go must show it. ---- */
  perform pg_temp.hold(w, u, '{}');
  ${until(dig(9, 4), `pack_count(w, u, 'dirt') > 0`)}
  v_t := (select string_agg(coalesce(rare, 'plain'), ',') from item
           where world_id = w and holder = 'player' and holder_uid = u and def = 'dirt');
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'dirt';
  update class_perk set fx = fx || '{"rare:dig": 1}'::jsonb where id = ${q(P('Rare Earth').id)};
  perform pg_temp.hold(w, u, ${arr([P('Rare Earth')])});
  ${until(dig(9, 4), `pack_count(w, u, 'dirt') > 0`)}
  v_u := (select string_agg(coalesce(rare, 'plain'), ',') from item
           where world_id = w and holder = 'player' and holder_uid = u and def = 'dirt');
  insert into said values ('RARE', coalesce(v_t, 'none') || '|' || coalesce(v_u, 'none'));
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'dirt';
  insert into said select 'ODDS', count(*) filter (where r1 is not null) || '|' || count(*) filter (where r0 is null)
    from (select perk_rare(1) r1, perk_rare(0) r0 from generate_series(1, 50)) z;

  /* ---- 16. Treasure Nose, the same way: no map without it, and one a go with it at one. ---- */
  create or replace function map_odds() returns double precision language sql immutable as 'select 0::double precision';
  perform pg_temp.hold(w, u, '{}');
  ${until(dig(9, 4), `pack_count(w, u, 'dirt') > 0`)}
  n := pack_count(w, u, 'treasure_map');
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'dirt';
  update class_perk set fx = fx || '{"map:dig": 1}'::jsonb where id = ${q(P('Treasure Nose').id)};
  perform pg_temp.hold(w, u, ${arr([P('Treasure Nose')])});
  ${until(dig(9, 4), `pack_count(w, u, 'dirt') > 0`)}
  insert into said values ('MAP', n || '|' || pack_count(w, u, 'treasure_map'));
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def in ('dirt', 'treasure_map');
  insert into said values ('CONTEXT', coalesce(nullif(current_setting('wurm.pk', true), ''), 'clear')
    || '|' || coalesce(nullif(current_setting('wurm.pk_act', true), ''), 'clear'));

  /* ---- 17. Long Reach: a cart four tiles off, to take soil from and to dig into. ---- */
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'cart', 12, 8, 0, 0, 12.5, 8.5, 40, 'Pine', u) returning id into v_cart;
  insert into item (world_id, holder, placed, def, ql, count) values (w, 'furniture', v_cart, 'dirt', 30, 5);
  perform pg_temp.hold(w, u, '{}');
  insert into said values ('SPOIL', coalesce(spoil_near(w, u, null), 'none') || '|' || take_spoil(w, u, 'dirt'));
  perform pg_temp.hold(w, u, ${arr([P('Long Reach')])});
  -- Taken in a statement of its own: one statement reads the rows as they stood when it began.
  v_t := coalesce(spoil_near(w, u, null), 'none') || '|' || take_spoil(w, u, 'dirt');
  insert into said select 'SPOILED', v_t || '|' || (select coalesce(sum(count), 0) from item where placed = v_cart and def = 'dirt');
  perform pg_temp.hold(w, u, '{}');
  ${until(dig(9, 4), `pack_count(w, u, 'dirt') > 0`)}
  v_t := pack_count(w, u, 'dirt') || ',' || (select coalesce(sum(count), 0) from item where placed = v_cart and def = 'dirt');
  delete from item where world_id = w and holder = 'player' and holder_uid = u and def = 'dirt';
  perform pg_temp.hold(w, u, ${arr([P('Long Reach')])});
  ${until(dig(9, 4), `(select coalesce(sum(count), 0) from item where placed = v_cart and def = 'dirt') > 4`)}
  insert into said select 'CARTED', v_t || '|' || pack_count(w, u, 'dirt') || ','
    || (select coalesce(sum(count), 0) from item where placed = v_cart and def = 'dirt');

  /* ---- 18. And putting the trade down takes the perks with it. ---- */
  perform pg_temp.hold(w, u, ${arr(EACH)});
  insert into skill (world_id, uid, id, value) values (w, u, 'mining', class_at())
    on conflict (world_id, uid, id) do update set value = excluded.value;
  perform give_coins(w, u, class_change_cost()::bigint * 2);
  delete from caller where uid = u;
  j := rpc_take_class(w, 'miner');
  insert into said select 'DOWN', coalesce(j->>'took', '-') || '|' || coalesce(j->>'why', '-') || '|'
    || (select count(*) from player_node pn join class_perk k on k.id = pn.node where pn.world_id = w and pn.uid = u)
    || '|' || coalesce((select class_mul->'fx' from player where world_id = w and uid = u), 'null'::jsonb)::text;
end $$;

select k || E'\\t' || coalesce(v, 'null') from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const at = l.indexOf('\t');
  return [l.slice(0, at), l.slice(at + 1)] as [string, string];
}));
const say = (k: string): string => said.get(k) ?? '(nothing)';
const json = <T>(k: string): T | null => {
  try { return JSON.parse(say(k)) as T; } catch { return null; }
};

/* ---- the rulebook ------------------------------------------------------------ */

type Row = { id: string; class: string; tier: number; num: number; name: string; note: string; fx: Fx };
const island = json<Row[]>('PERKS') ?? [];
const byId = new Map(island.map((r) => [r.id, r]));
const differs = PERKS.filter((p) => {
  const r = byId.get(p.id);
  return !r || r.class !== p.class || r.tier !== p.tier || r.num !== p.num || r.name !== p.name
    || r.note !== p.note || !sameFx(r.fx, p.fx);
});
check('the island holds every perk the browser has, field for field', island.length === PERKS.length && differs.length === 0,
  `${island.length} on the island, ${PERKS.length} in the browser${differs.length ? `; first difference ${differs[0].id}` : ''}`);
check(`every trade moved to perks has ${PERK_TIER_AT.length * PERKS_PER_TIER}, ${PERKS_PER_TIER} to each of ${PERK_TIER_AT.length} tiers, and no tree`,
  [...PERK_CLASSES].every((c) => PERK_TIER_AT.every((_, i) => perksOf(c).filter((p) => p.tier === i + 1).length === PERKS_PER_TIER))
    && say('TREELESS') === '0', `${[...PERK_CLASSES].join(', ')}; ${say('TREELESS')} nodes left on them`);
check('the tiers open at the same skill on both sides',
  say('TIERS_AT') === PERK_TIER_AT.map((at, i) => `${i + 1}:${at}`).join(','), say('TIERS_AT'));
check('two numbers under one key fold by the same rule on both sides',
  say('RULES') === Object.entries(FX_RULE).sort(([a], [b]) => a.localeCompare(b)).map(([f, r]) => `${f}:${r}`).join(','), say('RULES'));
check('and the same tiles are roads', say('ROADS') === [...ROAD_TILES].sort((a, b) => a - b).join(','), say('ROADS'));
const [cStep, cReach, cPer, cFloor, cCorners, cTime, cDepth] = say('CONSTS').split('|').map(Number);
check('the numbers the notes quote are the island\'s',
  cStep === FLATTEN_STEP && cReach === SPOIL_REACH && cPer === SLOPE_PER_SKILL && cFloor === SLOPE_FLOOR
    && cCorners === TILE_CORNERS && cTime === DIG_TILE_TIME && cDepth === MINE_DEPTH, say('CONSTS'));
const dt = ACTION_BY_ID.get('dig_tile')!;
check('Dig out the tile is a job on both sides, and ported',
  say('DIGTILE') === `${dt.baseTime}|${dt.skill}|${dt.tool}|${dt.difficulty}|true`, say('DIGTILE'));
check('nobody keeps a node of the Terraformer\'s old tree', say('OLDNODES') === '0', say('OLDNODES'));

/*
 * A key's family says what it names after the colon: a job for a time, a
 * quality, a rarity, a map, a failure or a thing kept; a thing for a weight;
 * a skill for a slope. A typo there is a perk that reads nothing.
 */
const JOBS = new Set(['time', 'ql', 'rare', 'map', 'fail', 'keep', 'more', 'gem', 'find', 'cap', 'into', 'spare', 'need']);
/*
 * And a kind of work, where the rule asks what is being worked rather than
 * which job: a wall or floor of stone or of timber, a bridge of each kind.
 */
const WORKS = new Set([...BUILD_MATERIALS.map((m) => buildWork(m)), ...Object.keys(BRIDGES).map((k) => `bridge_${k}`), 'fence']);
const WORK_FAMILIES = new Set(['lay', 'storeys', 'salvage', 'span', 'bill']);
const OTHERS = new Set([
  'depth:dig', 'depth:dredge', 'flatten:step', 'stump:log', 'walk:road', 'reach:soil', 'carry', 'dig_tile',
  'ore:below', 'chip:chance', 'chip:step', 'slide:more', 'depth:mine', 'further:prospect', 'fit:relic', 'share:bauble', 'pan',
  'depth:raise_rock', 'lift:raise_rock', 'repoint', 'rubble',
]);
const unnamed = PERKS.flatMap((p) => Object.keys(p.fx).filter((key) => {
  const [fam, rest] = key.split(':');
  if (JOBS.has(fam)) return !ACTION_BY_ID.has(rest) && !WORKS.has(rest);
  if (WORK_FAMILIES.has(fam) || (fam === 'reach' && rest?.startsWith('build_'))) return !WORKS.has(rest);
  // A thing: what it weighs, how many come, how it wears, and a maker's mark on it.
  if (fam === 'weight' || fam === 'count' || fam === 'wear' || (MARK_FAMILIES as readonly string[]).includes(fam)) return !ITEM_DEFS[rest];
  if (fam === 'slope') return !['digging', 'masonry'].includes(rest);
  return !OTHERS.has(key);
}).map((key) => `${p.id} ${key}`));
check('every key names a job, a thing or a rule that exists', unnamed.length === 0, unnamed.join('; '));
const wired = say('WIRED').split('|').map((s) => s.split(':'));
const dead = wired.filter((w) => Number(w[w.length - 1]) === 0).map((w) => w.slice(0, -1).join(':'));
check('and every key is read by a rule on the island', wired.length > 0 && dead.length === 0,
  dead.length ? `nothing reads ${dead.join(', ')}` : `${wired.length} keys`);

/* ---- choosing ------------------------------------------------------------------ */

check('another trade\'s perk is refused in the browser\'s words',
  say('NOTYOURS') === perkRefusal(T1A, null, [], 55), say('NOTYOURS'));
check('as is a perk there is not', say('NOSUCH') === 'There is no such perk.', say('NOSUCH'));
check('the trade is taken up', say('TRADE') === 'terraformer|-', say('TRADE'));
check(`a tier that is not open yet is refused with the skill it opens at (${T2A.name}, at ${PERK_TIER_AT[1]})`,
  say('SHUT') === perkRefusal(T2A, 'terraformer', [], 55), say('SHUT'));
check('the first tier is open with the trade', say('FIRST') === `${T1A.id}|-`, say('FIRST'));
check('and a perk taken says what it does', say('TOLD') === `${T1A.name}. ${T1A.note}`, say('TOLD'));
check('the door answers with the fold, which has the perk in it',
  sameFx(json<Fx>('FIRSTFX') ?? {}, foldPerks([T1A.id])), say('FIRSTFX'));
check('one you have is refused', say('TWICE') === perkRefusal(T1A, 'terraformer', [T1A.id], 55), say('TWICE'));
check('and a second at the same tier', say('OTHER') === perkRefusal(T1B, 'terraformer', [T1A.id], 55), say('OTHER'));

type Tier = { tier: number; at: number; open: boolean; perks: Array<{ id: string; name: string; note: string; taken: boolean; why: string | null }> };
const tiers = json<Tier[]>('TIERS') ?? [];
const treeWrong = PERK_TIER_AT.flatMap((at, i) => {
  const t = tiers[i];
  const want = tierOf(i + 1);
  if (!t) return [`tier ${i + 1} missing`];
  const errs: string[] = [];
  if (t.tier !== i + 1 || t.at !== at) errs.push(`tier ${i + 1} is ${t.tier} at ${t.at}`);
  if (t.open !== (i === 0 || 55 >= at)) errs.push(`tier ${i + 1} open ${t.open}`);
  if (t.perks.map((p) => p.id).join() !== want.map((p) => p.id).join()) errs.push(`tier ${i + 1} holds ${t.perks.map((p) => p.id)}`);
  for (const p of want) {
    const c = t.perks.find((x) => x.id === p.id);
    if (!c) continue;
    if (c.name !== p.name || c.note !== p.note) errs.push(`${p.id} reads differently`);
    if (c.taken !== (p.id === T1A.id)) errs.push(`${p.id} taken ${c.taken}`);
    const why = perkRefusal(p, 'terraformer', [T1A.id], 55);
    if (c.why !== why) errs.push(`${p.id}: "${c.why}" where the browser says "${why}"`);
  }
  return errs;
});
check(`the tree the Trades window draws has ${PERK_TIER_AT.length} tiers of ${PERKS_PER_TIER}, open, taken and refused as the browser has them`,
  tiers.length === PERK_TIER_AT.length && treeWrong.length === 0, treeWrong.slice(0, 3).join('; ') || `${tiers.length} tiers`);
const each = EACH.slice(1).map((p) => say(`EACH${p.tier}`));
check(`at ${PERK_TIER_AT[PERK_TIER_AT.length - 1]} one can be taken at every tier`,
  each.every((s, i) => s === `${EACH[i + 1].id}|-`), each.join(' / '));
check('and what they fold to on the island is the browser\'s fold',
  sameFx(json<Fx>('FOLD') ?? {}, foldPerks(EACH.map((p) => p.id))), say('FOLD'));
check('with nothing else held', say('HELD') === EACH.map((p) => p.id).sort().join(','), say('HELD'));
check('times multiply, a carry adds and the rest is the larger, on both sides',
  sameFx(json<Fx>('FOLDX') ?? {}, foldFx([...FOLDSET.map((p) => p.fx), ZZ])), say('FOLDX'));

/* ---- what each one does ------------------------------------------------------------ */

const [tA, tB, tWhyA, tWhyB] = say('TIME').split('|');
check(`${P('Quick Level').name}: a flatten is started with ${P('Quick Level').fx['time:flatten']} of the time`,
  // A timestamp keeps microseconds, so the ratio is good to about one part in a million of a job's length.
  tWhyA === '-' && tWhyB === '-' && near(Number(tB) / Number(tA), P('Quick Level').fx['time:flatten'], 1e-5),
  `${tA} s, then ${tB} s${tWhyA !== '-' ? `; ${tWhyA}` : ''}${tWhyB !== '-' ? `; ${tWhyB}` : ''}`);

const step = P('Level Hand').fx['flatten:step'];
check(`${P('Level Hand').name}: a flatten moves ${step} units where it moved ${FLATTEN_STEP}, never past the mark, and packs ${step} back`,
  say('LEVEL') === `43,1|${43 - step},${1 + step}|40,${1 + step + (43 - step - 40)}|${37 + step},${1 + step + (43 - step - 40) - step}`,
  say('LEVEL'));

const deepDig = 'The water is too deep here to work in.';
check(`${P('Wader').name}: digging and flattening are refused at twelve deep without it`,
  say('DEEP') === `${deepDig}|${deepDig}`, say('DEEP'));
check(`and allowed with it, to ${P('Wader').fx['depth:dig']}`,
  say('WADED') === 'ALLOWED|That ground is already flat.', say('WADED'));
check(`${P('Dredger').name}: a bottom at forty is out of reach without it and in reach with it`,
  say('DREDGE') === 'The bottom is too deep to reach from a boat.' && say('DREDGED') === 'ALLOWED',
  `${say('DREDGE')} / ${say('DREDGED')}`);

const [capA, sentA] = say('SLOPE').split('|');
const [capB, sentB] = say('STEEP').split('|');
const would = Number(sentA.match(/slope of (\d+)/)?.[1] ?? NaN);
const per = P('Steep Cut').fx['slope:digging'];
check(`${P('Steep Cut').name}: the steepest a spade leaves is ${per} times digging, not ${SLOPE_PER_SKILL}`,
  Number(capA) === Math.max(SLOPE_FLOOR, Math.floor(50 * SLOPE_PER_SKILL)) && Number(capB) === Math.max(SLOPE_FLOOR, Math.floor(50 * per)),
  `${capA}, then ${capB}`);
check('and a cut between the two is refused in numbers without it and allowed with it',
  sentA === `That would leave a slope of ${would}. Your digging allows ${capA}; it would take digging ${slopeNeeds(would, SLOPE_PER_SKILL).toFixed(1)}.`
    && sentB === 'ALLOWED', `${sentA} / ${sentB}`);

const [sA, sB, sC, sBase] = say('ROAD').split('|').map(Number);
check(`${P('Road Legs').name}: a road is walked ${P('Road Legs').fx['walk:road']} times as fast, and nothing else is`,
  near(sA, sBase) && near(sB, sBase * P('Road Legs').fx['walk:road']) && near(sC, sBase), say('ROAD'));
const [cA, cB] = say('CARRY').split('|').map(Number);
check(`${P('Strong Back').name}: ${P('Strong Back').fx.carry} kg more before the load slows you`,
  near(cB - cA, P('Strong Back').fx.carry), say('CARRY'));
const [wA, wB, parts] = say('LOAD').split('|');
const lighter = (parts ?? '').split(',').reduce((s, x) => {
  const [def, kg] = x.split(':');
  return s + Number(kg) * (1 - (P('Soil Porter').fx[`weight:${def}`] ?? 1));
}, 0);
check(`${P('Soil Porter').name}: dirt, sand and clay weigh what the perk says in the pack`,
  lighter > 0 && near(Number(wA) - Number(wB), lighter, 1e-6), say('LOAD'));
const [slabsA, slabsB] = say('SLABS').split('|').map(Number);
check(`${P('Bed True').name}: forty slabs at no skill, off the worst slab, all bed down with it and not without`,
  slabsB === 40 && slabsA < 40, `${slabsA} of 40 without, ${slabsB} of 40 with`);
const [cobA, cobB] = say('COBBLE').split('|').map(Number);
const keep = P('Frugal Cobbler').fx['keep:pave_cobble'];
check(`${P('Frugal Cobbler').name}: a brick a go without it, and about ${Math.round((1 - keep) * 600)} for 600 goes with it`,
  cobA === 20 && Math.abs(1 - cobB / 600 - keep) < 0.08, `${cobA} for 20, then ${cobB} for 600`);
const [stumpA, stumpB, kind, tree] = say('STUMP').split('|');
check(`${P('Stump Puller').name}: a stump gives nothing but the ground without it, and ${P('Stump Puller').fx['stump:log']} log of its tree with it`,
  stumpA === '1,0' && stumpB === `1,${P('Stump Puller').fx['stump:log']}` && kind === tree, say('STUMP'));
check(`${P('Dig Out the Tile').name}: refused without it, in the island's words`,
  say('TILE_NO') === 'That wants a Terraformer who has learned to dig out a whole tile.', say('TILE_NO'));
check('and allowed with it', say('TILE_YES') === 'ALLOWED', say('TILE_YES'));
check(`and done through the clock: all ${TILE_CORNERS} corners down one, and ${TILE_CORNERS} of the dirt`,
  say('DUG') === `39,39,39,39|${TILE_CORNERS}`, say('DUG'));
const [qA, qB] = say('QL').split('|').map(Number);
check(`${P('Clean Earth').name}: a dig comes up at ${P('Clean Earth').fx['ql:dig']} of the quality`,
  near(qA, 50, 1e-3) && near(qB, 50 * P('Clean Earth').fx['ql:dig'], 1e-3), say('QL'));
const [rA, rB] = say('RARE').split('|');
check(`${P('Rare Earth').name}: nothing dug is rare without it, and a go at its chance comes up rare`,
  rA === 'plain' && ['rare', 'supreme', 'fantastic'].includes(rB), say('RARE'));
check('a perk\'s rarity always rolls at one and never at nought', say('ODDS') === '50|50', say('ODDS'));
check(`${P('Treasure Nose').name}: a go at its odds finds a map, and without it none`, say('MAP') === '0|1', say('MAP'));
check('and the clock leaves no perk behind it once the go is done', say('CONTEXT') === 'clear|clear', say('CONTEXT'));
check(`${P('Long Reach').name}: soil in a cart four tiles off is out of reach without it`,
  say('SPOIL') === 'none|false', say('SPOIL'));
check(`and within ${P('Long Reach').fx['reach:soil']} with it, where ${SPOIL_REACH} was`,
  say('SPOILED') === 'dirt|true|4', say('SPOILED'));
check('and what is dug goes into that cart with it, and into the pack without it',
  say('CARTED') === '1,4|0,5', say('CARTED'));

check('putting the trade down takes every perk with it', say('DOWN') === 'miner|-|0|{}', say('DOWN'));

/* ---- the browser's half ------------------------------------------------------------ */

const game = Game.create(2718);
const carry0 = game.carryLimit();
game.setPerks(foldPerks([P('Strong Back').id, P('Road Legs').id, P('Soil Porter').id, P('Wader').id, P('Dig Out the Tile').id]));
check('the browser carries what the island does', near(game.carryLimit() - carry0, P('Strong Back').fx.carry), `${carry0} then ${game.carryLimit()}`);
check('and walks a road as fast', game.player.roadPace === P('Road Legs').fx['walk:road'], String(game.player.roadPace));
check('and weighs soil as light, and nothing else', game.inventory.weightMul?.('dirt') === P('Soil Porter').fx['weight:dirt']
  && game.inventory.weightMul?.('stone_brick') === 1, `${game.inventory.weightMul?.('dirt')}, ${game.inventory.weightMul?.('stone_brick')}`);
check('and works water as deep', digDepth(game) === P('Wader').fx['depth:dig'], String(digDepth(game)));
const px = Math.floor(game.player.x);
const py = Math.floor(game.player.y);
const spot = [...Array(25).keys()].map((i) => ({ x: px - 2 + (i % 5), y: py - 2 + Math.floor(i / 5) }))
  .map(({ x, y }) => ({ kind: 'tile' as const, x, y, cx: x, cy: y }))
  .find((t) => !!TILE_DEFS[game.world.getTile(t.x, t.y)].digYield);
check('and offers Dig out the tile with it', !!spot && dt.applies?.(spot, game) === true, spot ? `${spot.x},${spot.y}` : 'no ground to dig');
game.setPerks({});
check('and not without it', !!spot && dt.applies?.(spot, game) === false);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`perks — ${ok.length} of ${ok.length}`);
