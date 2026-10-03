/**
 * Dodging, critical hits, arrow heads, venom and burns, threat, and consider.
 *
 * Both sides off the same names (`src/game/fight.ts` and
 * `dodge_crits_arrows_venom_and_threat.sql`). What this asks:
 *
 *   * the numbers behind all of it are the same numbers, and so are the
 *     dodge and the critical chances worked from them;
 *   * a blow is dodged as often as the chance says, a dodge costs nothing and
 *     says so, and armour worn takes the chance down by its kilograms;
 *   * critical blows happen, and say so;
 *   * a shot looses the arrows asked for, else plain ones; a broadhead bleeds,
 *     a blunt staggers, a bodkin lands harder through a hide;
 *   * a venomous bite leaves venom that takes health until the wound is
 *     dressed, and a burn wears armour twice as fast;
 *   * a wild thing turns on a companion that hurt it, holds on it while it
 *     keeps hurting it, comes back to you after, and turns at once for one
 *     guarding you;
 *   * consider rates a rabba easier than an ogre.
 *
 * Runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID } from '../../src/game/actions';
import { consider } from '../../src/game/consider';
import { SPECIES } from '../../src/game/creatures';
import {
  FIST, ARROWS, BODKIN_HIDE, BURN_WEAR, CRIT_BASE, CRIT_HIT, CRIT_KNIFE, CRIT_PER_SKILL, critChance, DODGE_GAIN, DODGE_MOST, DODGE_PER_CONTROL,
  DODGE_PER_KG, dodgeChance, KNIFE_BLEED_SECS, nockedArrow, STAGGER_MAUL, THREAT_HOLD, VENOM_DRAIN, VENOM_SECS,
} from '../../src/game/fight';
import { Game } from '../../src/game/game';
import { WEAPON_BY_ID } from '../../src/game/gear';
import { TileType } from '../../src/world/tiles';

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
const near = (a: number, b: number, by = 1e-6): boolean => Math.abs(a - b) <= by * Math.max(1, Math.abs(b));

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w record; v_px double precision; v_py double precision; g int; pet int; i int; v_n int; v_id bigint;
        v_h0 double precision; v_h1 double precision; v_d0 double precision; v_d1 double precision; q creature;
        v_coif bigint; v_haub bigint; v_bow bigint; v_ws jsonb;
begin
  perform setseed(0.42);
  -- Off the beach of the biggest island there is, where things may come for you (\`at_peace\`).
  select p.world_id, p.uid, wd.size, wd.spawn_x, wd.spawn_y into w
    from player p join world wd on wd.id = p.world_id order by wd.size desc, p.world_id, p.uid limit 1;
  v_px := case when w.spawn_x + peace_reach() + 6 < w.size then w.spawn_x + peace_reach() + 6.5
               else w.spawn_x - peace_reach() - 5.5 end;
  v_py := w.spawn_y + 0.5;
  update player set act = null, act_target = null, act_ends = null, act_left = null, act_goes = null,
         act_queue = '[]'::jsonb, equipped = '{}'::jsonb, fight_stance = 'balanced', fight_back = false,
         moved_at = now() - interval '1 minute', x = v_px, y = v_py, level = 0, wounds = '[]'::jsonb, away = false,
         stats = (coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1, 'aegis', 0)) - 'hurtAt' - 'hurtBy'
    where world_id = w.world_id and uid = w.uid;
  update creature set hunting = null, brawl = null where world_id = w.world_id and hunting = w.uid;

  -- The numbers, and what is worked from them.
  insert into said values ('NUMS', dodge_per_control() || '|' || dodge_per_kg() || '|' || dodge_most() || '|' || dodge_gain()
    || '|' || crit_base() || '|' || crit_per_skill() || '|' || crit_knife() || '|' || crit_hit() || '|' || bodkin_hide()
    || '|' || venom_drain() || '|' || venom_secs() || '|' || burn_wear() || '|' || threat_hold());
  insert into said select 'HEAD:' || id, coalesce(arrow_head_of(id), 'none')
    from unnest(array['arrow', 'broadhead_arrow', 'bodkin_arrow', 'blunt_arrow', 'shaft']) id;
  insert into said select 'VENOM:' || id, venom::text from species_def;
  insert into said values ('DODGE:f', dodge_chance(40, 0) || '|' || dodge_chance(100, 10) || '|' || dodge_chance(200, 0) || '|' || dodge_chance(10, 30));
  insert into said values ('CRIT:f', crit_chance(50, 'sword', 'swords') || '|' || crit_chance(50, 'hunting_knife', 'knives')
    || '|' || crit_chance(50, 'fist', 'knives'));
  v_coif := give(w.world_id, w.uid, 'chain_coif', 1, 40);
  v_haub := give(w.world_id, w.uid, 'chain_hauberk', 1, 40);
  update player set equipped = jsonb_build_object('head', v_coif, 'chest', v_haub) where world_id = w.world_id and uid = w.uid;
  insert into said values ('KG', worn_kg(w.world_id, w.uid)::text);
  update player set equipped = '{}'::jsonb where world_id = w.world_id and uid = w.uid;

  -- Four hundred blows from a goblin at body control 100 and nothing worn: a fifth of them dodged.
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'body_control', 100)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  g := creature_spawn(w.world_id, 'goblin', v_px + 0.8, v_py, 'wild', now() - interval '2 hours');
  update player set stats = jsonb_set(stats, '{aegis}', '1000') where world_id = w.world_id and uid = w.uid;
  delete from event where uid = w.uid;
  for i in 1..400 loop
    perform mark_attacker(w.world_id, w.uid, g);
    perform hurt_player(w.world_id, w.uid, 0.001, 'The goblin is on you', 'cut');
  end loop;
  insert into said values ('DODGED', (select count(*) from event where uid = w.uid and text = 'You dodge the goblin.')::text);
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'body_control', 0)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  update player set stats = jsonb_set(stats, '{aegis}', '0') where world_id = w.world_id and uid = w.uid;

  -- Critical blows: a knife at skill 100, a hundred swings at a goblin that will not die.
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'knives', 100)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  v_id := give(w.world_id, w.uid, 'hunting_knife', 1, 40);
  update player set equipped = jsonb_build_object('weapon', v_id) where world_id = w.world_id and uid = w.uid;
  update creature set health = 1e6, traits = '{}' where world_id = w.world_id and id = g;
  delete from event where uid = w.uid;
  for i in 1..100 loop
    perform perform_fight(w.world_id, w.uid, 'attack_creature', jsonb_build_object('kind', 'creature', 'id', g));
  end loop;
  insert into said values ('CRITS', (select count(*) from event where uid = w.uid and text like '%, a critical blow.%')::text
    || '|' || (select count(*) from event where uid = w.uid and text like 'You strike the goblin%')::text);
  update creature set hunting = null, brawl = null where world_id = w.world_id and hunting = w.uid;

  -- Arrows: five of each, a bow, and a goblin at four tiles.
  v_bow := give(w.world_id, w.uid, 'short_bow', 1, 40);
  perform give(w.world_id, w.uid, 'arrow', 5, 40);
  perform give(w.world_id, w.uid, 'bodkin_arrow', 5, 40);
  update player set equipped = jsonb_build_object('weapon', v_bow) where world_id = w.world_id and uid = w.uid;
  update creature set from_x = v_px + 4, from_y = v_py, to_x = v_px + 4, to_y = v_py, leg_at = now(), leg_ends = now(),
      until = now() + interval '1 hour', settled_at = now()
    where world_id = w.world_id and id = g;
  perform perform_fight(w.world_id, w.uid, 'shoot_creature', jsonb_build_object('kind', 'creature', 'id', g, 'arrow', 'bodkin_arrow'));
  insert into said values ('ASKED', pack_count(w.world_id, w.uid, 'arrow') || '|' || pack_count(w.world_id, w.uid, 'bodkin_arrow'));
  perform perform_fight(w.world_id, w.uid, 'shoot_creature', jsonb_build_object('kind', 'creature', 'id', g));
  perform perform_fight(w.world_id, w.uid, 'shoot_creature', jsonb_build_object('kind', 'creature', 'id', g, 'arrow', 'blunt_arrow'));
  insert into said values ('PLAIN', pack_count(w.world_id, w.uid, 'arrow') || '|' || pack_count(w.world_id, w.uid, 'bodkin_arrow'));
  -- A broadhead that lands opens it up; a blunt that lands knocks its heavy blow off its stroke.
  insert into skill (world_id, uid, id, value) values (w.world_id, w.uid, 'archery', 100)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  perform give(w.world_id, w.uid, 'broadhead_arrow', 40, 40);
  perform give(w.world_id, w.uid, 'blunt_arrow', 40, 40);
  update creature set bleed_rate = null, bleed_until = null where world_id = w.world_id and id = g;
  v_n := 0;
  while v_n < 40 and (select bleed_until from creature where world_id = w.world_id and id = g) is null loop
    v_n := v_n + 1;
    perform perform_fight(w.world_id, w.uid, 'shoot_creature', jsonb_build_object('kind', 'creature', 'id', g, 'arrow', 'broadhead_arrow'));
  end loop;
  insert into said select 'BROAD', coalesce(round(extract(epoch from (bleed_until - now()))::numeric, 2)::text, 'none')
    from creature where world_id = w.world_id and id = g;
  v_n := 0;
  update creature set windup_at = now() + interval '1 hour' where world_id = w.world_id and id = g;
  while v_n < 40 and (select windup_at from creature where world_id = w.world_id and id = g) is not null loop
    v_n := v_n + 1;
    perform perform_fight(w.world_id, w.uid, 'shoot_creature', jsonb_build_object('kind', 'creature', 'id', g, 'arrow', 'blunt_arrow'));
  end loop;
  insert into said select 'BLUNT', coalesce(windup_at::text, 'none') || '|' || v_n from creature where world_id = w.world_id and id = g;
  update player set equipped = '{}'::jsonb where world_id = w.world_id and uid = w.uid;
  update creature set hunting = null, brawl = null where world_id = w.world_id and hunting = w.uid;
  delete from creature where world_id = w.world_id and id = g;

  -- Venom: a crawler's bite, then four seconds of it undressed.
  g := creature_spawn(w.world_id, 'crawler', v_px + 0.8, v_py, 'wild', now() - interval '2 hours');
  update player set wounds = '[]'::jsonb, stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{aegis}', '0')
    where world_id = w.world_id and uid = w.uid;
  perform mark_attacker(w.world_id, w.uid, g);
  perform hurt_player(w.world_id, w.uid, 0.01, 'The crawler is on you', 'cut');
  select wounds into v_ws from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('BITTEN', coalesce(v_ws->0->>'venom', 'none') || '|' || wound_text(v_ws->0));
  -- Settled four seconds on, with nothing else bleeding: the wound's own drain and the venom's.
  update player set wounds = jsonb_build_array(jsonb_set(jsonb_set(v_ws->0, '{bleeding}', 'false'), '{severity}', '0.5')),
      stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{hurtSettled}', to_jsonb(now() - interval '4 seconds'))
    where world_id = w.world_id and uid = w.uid;
  perform wounds_settle(w.world_id, w.uid);
  select (stats->>'health')::double precision, wounds into v_h0, v_ws from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('VENOMED', (1 - v_h0) || '|' || (v_ws->0->>'venom'));
  -- The same, dressed.
  update player set wounds = jsonb_build_array(jsonb_set(jsonb_set(jsonb_set(v_ws->0, '{venom}', '8'), '{dressing}', '""'), '{severity}', '0.5')),
      stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{hurtSettled}', to_jsonb(now() - interval '4 seconds'))
    where world_id = w.world_id and uid = w.uid;
  perform wounds_settle(w.world_id, w.uid);
  insert into said select 'DRESSED', (1 - (stats->>'health')::double precision)::text from player where world_id = w.world_id and uid = w.uid;
  update player set wounds = '[]'::jsonb, stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = w.uid;
  delete from creature where world_id = w.world_id and id = g;

  -- A burn on a hauberk, against a cut: until each has landed on it.
  v_haub := give(w.world_id, w.uid, 'chain_hauberk', 1, 40);
  update player set equipped = jsonb_build_object('chest', v_haub) where world_id = w.world_id and uid = w.uid;
  v_n := 0;
  loop
    v_n := v_n + 1;
    select dmg into v_d0 from item where id = v_haub;
    perform hurt_player(w.world_id, w.uid, 0.001, 'Something is on you', 'cut');
    select dmg into v_d1 from item where id = v_haub;
    exit when v_d1 > v_d0 or v_n > 60;
  end loop;
  insert into said values ('WEAR:cut', (v_d1 - v_d0)::text);
  v_n := 0;
  loop
    v_n := v_n + 1;
    select dmg into v_d0 from item where id = v_haub;
    perform hurt_player(w.world_id, w.uid, 0.001, 'Something is on you', 'burn');
    select dmg into v_d1 from item where id = v_haub;
    exit when v_d1 > v_d0 or v_n > 60;
  end loop;
  insert into said values ('WEAR:burn', (v_d1 - v_d0)::text);
  update player set equipped = '{}'::jsonb, wounds = '[]'::jsonb, stats = jsonb_set(stats, '{health}', '1')
    where world_id = w.world_id and uid = w.uid;

  -- Threat: a goblin on you, and your companion's bite.
  pet := creature_spawn(w.world_id, 'rowl', v_px + 1.5, v_py, 'active', now() - interval '2 hours', w.uid);
  g := creature_spawn(w.world_id, 'goblin', v_px + 2.2, v_py, 'wild', now() - interval '2 hours');
  update creature set stance = 'defensive', health = 5000 where world_id = w.world_id and id = pet;
  update creature set health = 5000, traits = '{}', hunting = w.uid, hunt_x = to_x, hunt_y = to_y, threat_at = null
    where world_id = w.world_id and id = g;
  delete from event where uid = w.uid;
  perform creature_attack(w.world_id, pet, g);
  insert into said select 'TURNED', coalesce((brawl = pet)::text, 'none') || '|'
    || (select count(*) from event where uid = w.uid and text like 'The goblin turns on %')
    from creature where world_id = w.world_id and id = g;
  -- Your blow within the hold: it stays on the companion, and is after you still.
  perform engage_beast(w.world_id, g, w.uid);
  insert into said select 'HELD', coalesce((brawl = pet)::text, 'none') || '|' || coalesce((hunting = w.uid)::text, 'none')
    from creature where world_id = w.world_id and id = g;
  -- Past the hold: back on you.
  update creature set threat_at = now() - interval '1 minute' where world_id = w.world_id and id = g;
  perform engage_beast(w.world_id, g, w.uid);
  insert into said select 'BACK', coalesce(brawl::text, 'none') || '|' || coalesce((hunting = w.uid)::text, 'none') || '|'
    || (select count(*) from event where uid = w.uid and text = 'The goblin turns back on you.')
    from creature where world_id = w.world_id and id = g;
  -- A defensive companion's bite within the hold does not pull it; a guarding one's does.
  perform creature_attack(w.world_id, pet, g);
  insert into said select 'DEFENSIVE', coalesce(brawl::text, 'none') from creature where world_id = w.world_id and id = g;
  update creature set stance = 'guard' where world_id = w.world_id and id = pet;
  perform creature_attack(w.world_id, pet, g);
  insert into said select 'GUARD', coalesce((brawl = pet)::text, 'none') from creature where world_id = w.world_id and id = g;
  -- And it fights the companion, on its own clock, and not you.
  select health into v_h0 from creature where world_id = w.world_id and id = pet;
  update player set stats = jsonb_set(stats, '{health}', '1') where world_id = w.world_id and uid = w.uid;
  update creature set from_x = v_px + 2.2, from_y = v_py, to_x = v_px + 2.2, to_y = v_py, leg_at = now(), leg_ends = now(),
      until = now() - interval '3 seconds', settled_at = now() - interval '3 seconds'
    where world_id = w.world_id and id = g;
  perform creature_settle(w.world_id, g);
  select health into v_h1 from creature where world_id = w.world_id and id = pet;
  insert into said select 'BRAWL', (v_h0 - v_h1)::text || '|' || (1 - (stats->>'health')::double precision)::text
    from player where world_id = w.world_id and uid = w.uid;
  -- What the browser is told of it.
  perform set_config('request.jwt.claims', json_build_object('sub', w.uid)::text, true);
  insert into said select 'SAID', coalesce(e->>'brawl', 'none')
    from jsonb_array_elements(rpc_creatures(w.world_id, 40)) e where (e->>'id')::int = g;
  delete from creature where world_id = w.world_id and id in (pet, g);
end $b$;
select k || '=' || v from said order by k;
rollback;
`);

const said = new Map<string, string>();
for (const line of out.split('\n')) {
  const at = line.indexOf('=');
  if (at > 0) said.set(line.slice(0, at), line.slice(at + 1));
}
const island = (k: string): string => said.get(k) ?? 'MISSING';

/* ---- Both sides off the same numbers ----------------------------------------- */

const nums = [DODGE_PER_CONTROL, DODGE_PER_KG, DODGE_MOST, DODGE_GAIN, CRIT_BASE, CRIT_PER_SKILL, CRIT_KNIFE, CRIT_HIT, BODKIN_HIDE,
  VENOM_DRAIN, VENOM_SECS, BURN_WEAR, THREAT_HOLD];
check('the numbers behind it are the same on both sides', island('NUMS').split('|').map(Number).every((v, i) => near(v, nums[i])),
  `island ${island('NUMS')}, browser ${nums.join('|')}`);
check('every arrow has the same head, and a shaft none',
  Object.entries(ARROWS).every(([id, head]) => island(`HEAD:${id}`) === head) && island('HEAD:shaft') === 'none',
  Object.keys(ARROWS).map((id) => `${id} ${island(`HEAD:${id}`)}`).join(', '));
const offVenom = Object.values(SPECIES).filter((d) => island(`VENOM:${d.id}`) !== String(!!d.venom));
check('the same kinds are venomous', offVenom.length === 0 && Object.values(SPECIES).some((d) => d.venom), offVenom.map((d) => d.id).join(', '));
{
  const want = [dodgeChance(40, 0), dodgeChance(100, 10), dodgeChance(200, 0), dodgeChance(10, 30)];
  check('the dodge chance is worked the same', island('DODGE:f').split('|').map(Number).every((v, i) => near(v, want[i])),
    `island ${island('DODGE:f')}, browser ${want.join('|')}`);
  const sword = WEAPON_BY_ID.get('sword');
  const knife = WEAPON_BY_ID.get('hunting_knife');
  const crits = sword && knife ? [critChance(50, sword), critChance(50, knife), critChance(50, FIST)] : [];
  check('and so is the critical chance, a knife twice a sword and a fist no more than one',
    island('CRIT:f').split('|').map(Number).every((v, i) => near(v, crits[i])) && near(crits[1], crits[0] * CRIT_KNIFE) && near(crits[2], crits[0]),
    `island ${island('CRIT:f')}, browser ${crits.join('|')}`);
}

/* ---- The island ---------------------------------------------------------------- */

check('on the island, a chain coif and hauberk are the kilograms the items weigh', near(Number(island('KG')), 2.6 + 7.5, 1e-4), island('KG'));
{
  const n = Number(island('DODGED'));
  const want = 400 * dodgeChance(100, 0);
  check(`at body control 100 with nothing on, about ${Math.round(want)} of 400 blows are dodged`, Math.abs(n - want) <= 30, String(n));
  const [crit, all] = island('CRITS').split('|').map(Number);
  check('a knife at skill 100 lands some critical blows, and says so', crit >= 3 && crit < all, island('CRITS'));
}
check('a shot looses the arrows asked for', island('ASKED') === '5|4', island('ASKED'));
check('and plain ones when none are asked for, or none of those asked for are left', island('PLAIN') === '3|4', island('PLAIN'));
check(`a broadhead that lands leaves it bleeding ${KNIFE_BLEED_SECS} seconds`, near(Number(island('BROAD')), KNIFE_BLEED_SECS, 0.05), island('BROAD'));
check(`a blunt that lands knocks its heavy blow off its stroke`, island('BLUNT').startsWith('none|'), island('BLUNT'));
{
  const [venom, text] = island('BITTEN').split('|');
  check(`a crawler's bite leaves ${VENOM_SECS} seconds of venom in the wound, and the wound says so`,
    Number(venom) === VENOM_SECS && text.endsWith(', with venom in it'), island('BITTEN'));
  const [took, left] = island('VENOMED').split('|').map(Number);
  check(`four seconds of it undressed take ${VENOM_DRAIN} a second and leave four`, took >= 4 * VENOM_DRAIN - 1e-6 && near(left, VENOM_SECS - 4, 1e-3), island('VENOMED'));
  check('and dressed, the venom takes nothing', Number(island('DRESSED')) < 4 * VENOM_DRAIN - 1e-6, island('DRESSED'));
  check(`a burn wears armour ${BURN_WEAR} times as fast as a cut`, near(Number(island('WEAR:burn')), Number(island('WEAR:cut')) * BURN_WEAR, 1e-4),
    `${island('WEAR:cut')} / ${island('WEAR:burn')}`);
}
check("a goblin on you turns on the companion that bites it, and the keeper is told", island('TURNED') === 'true|1', island('TURNED'));
check(`your blow within ${THREAT_HOLD} seconds of the companion's leaves it on the companion, and after you still`, island('HELD') === 'true|true', island('HELD'));
check('past that, your blow takes it back, and says so', island('BACK') === 'none|true|1', island('BACK'));
check("a defensive companion's bite within the hold does not pull it; a guarding one's does",
  island('DEFENSIVE') === 'none' && island('GUARD') === 'true', `${island('DEFENSIVE')} / ${island('GUARD')}`);
{
  const [pet, you] = island('BRAWL').split('|').map(Number);
  check('and it fights the companion on its own clock, not you', pet > 0 && you === 0, island('BRAWL'));
}
check('the browser is told what it is fighting', /^\d+$/.test(island('SAID')), island('SAID'));

/* ---- The browser ---------------------------------------------------------------- */

const field = (): Game => {
  const g = Game.create(4242);
  const w = g.world;
  for (let y = 4; y <= 40; y++) for (let x = 4; x <= 40; x++) { w.setHeight(x, y, 4); w.setDirt(x, y, 3); w.setTile(x, y, TileType.Grass, 0); }
  g.player.x = 20.5;
  g.player.y = 20.5;
  g.player.stats.stamina = 1;
  g.player.stats.health = 1;
  g.settings.fightBack = false;
  for (const c of [...g.creatures.list.values()]) g.creatures.remove(c.id);
  return g;
};
const beast = (g: Game, kind: string, x: number, y: number) => {
  const c = g.creatures.spawn(kind, x, y, 'wild', () => 0.5, 0);
  c.traits = [];
  c.health = 500;
  return c;
};
const lines = (g: Game): string[] => g.log.map((l) => l.text);

{
  const g = field();
  g.equip('head', g.inventory.add('chain_coif', { ql: 40 }).uid);
  g.equip('chest', g.inventory.add('chain_hauberk', { ql: 40 }).uid);
  const kg = 2.6 + 7.5;
  g.skills.values.set('body_control', 60);
  check('in the browser, the dodge chance is your body control past where it starts, less the armour worn', near(g.dodge(), dodgeChance(g.skills.get('body_control'), kg)), String(g.dodge()));
  const gob = beast(g, 'goblin', 21.2, 20.5);
  g.player.attackedBy = gob.id;
  g.rand = () => 0;
  g.skills.values.set('body_control', 100);
  g.hurtPlayer(0.05, 'The goblin is on you', 'cut');
  const dodged = lines(g).includes('You dodge the goblin.') && g.player.stats.health === 1;
  g.rand = () => 0.99;
  g.hurtPlayer(0.05, 'The goblin is on you', 'cut');
  check('a blow under the chance is dodged and costs nothing; one over it lands', dodged && g.player.stats.health < 1, `health ${g.player.stats.health}`);
}
{
  const g = field();
  g.rand = () => 0;
  const gob = beast(g, 'goblin', 21.2, 20.5);
  g.equip('weapon', g.inventory.add('hunting_knife', { ql: 40 }).uid);
  const attack = ACTION_BY_ID.get('attack_creature');
  attack?.perform({ kind: 'creature', id: gob.id }, g);
  check('a blow under the critical chance is critical, and says so', lines(g).some((t) => t.includes(', a critical blow.')), lines(g).slice(-1)[0]);
}
{
  const g = field();
  g.inventory.add('arrow', { ql: 40, count: 5 });
  g.inventory.add('bodkin_arrow', { ql: 40, count: 5 });
  const picked = [nockedArrow(g, 'bodkin_arrow')?.id, nockedArrow(g)?.id, nockedArrow(g, 'blunt_arrow')?.id];
  check('in the browser, a shot looses the arrows asked for, else plain ones', picked.join('|') === 'bodkin_arrow|arrow|arrow', picked.join('|'));
  // A bodkin and a plain arrow at a shelled crawler, everything else the same
  // but the wear the first shot puts on the bow.
  g.rand = () => 0.5;
  g.skills.values.set('archery', 100);
  g.equip('weapon', g.inventory.add('short_bow', { ql: 40 }).uid);
  const shoot = ACTION_BY_ID.get('shoot_creature');
  const hit = (arrow: string): number => {
    const c = beast(g, 'crawler', 24.5, 20.5);
    c.health = 5000;
    const at = c.health;
    shoot?.perform({ kind: 'creature', id: c.id, arrow }, g);
    const took = at - c.health;
    g.creatures.remove(c.id);
    return took;
  };
  const plain = hit('arrow');
  const bodkin = hit('bodkin_arrow');
  check(`a bodkin lands ${BODKIN_HIDE} times as hard on a shell as a plain arrow`, near(bodkin / plain, BODKIN_HIDE, 0.005), `${plain} / ${bodkin}`);
  g.inventory.add('broadhead_arrow', { ql: 40, count: 3 });
  g.inventory.add('blunt_arrow', { ql: 40, count: 3 });
  const gob = beast(g, 'goblin', 24.5, 20.5);
  shoot?.perform({ kind: 'creature', id: gob.id, arrow: 'broadhead_arrow' }, g);
  const bled = gob.bleedUntil > g.time;
  gob.windup = 0.5;
  gob.cooldown = 0;
  shoot?.perform({ kind: 'creature', id: gob.id, arrow: 'blunt_arrow' }, g);
  check(`a broadhead leaves it bleeding, a blunt knocks its heavy blow off and puts the next back ${STAGGER_MAUL} second`,
    bled && gob.windup === 0 && near(gob.cooldown, STAGGER_MAUL), `bled ${bled}, windup ${gob.windup}, cooldown ${gob.cooldown}`);
}
{
  const g = field();
  g.skills.values.set('body_control', 0);
  const crawler = beast(g, 'crawler', 21.2, 20.5);
  g.player.attackedBy = crawler.id;
  g.rand = () => 0.99;
  g.hurtPlayer(0.01, 'The crawler is on you', 'cut');
  const w = g.player.wounds[0];
  const venomed = w?.venom === VENOM_SECS;
  w.bleeding = false;
  w.severity = 0.5;
  g.player.stats.health = 1;
  // Four seconds of it, a second at a time.
  for (let i = 0; i < 4; i++) (g as unknown as { tendWounds(dt: number): void }).tendWounds(1);
  const took = 1 - g.player.stats.health;
  check(`in the browser, a crawler's bite leaves ${VENOM_SECS} seconds of venom, and four of them take ${VENOM_DRAIN} a second`,
    venomed && took >= 4 * VENOM_DRAIN - 1e-6 && near(w.venom ?? -1, VENOM_SECS - 4, 1e-6), `venom ${w.venom}, took ${took}`);
}
{
  const g = field();
  const pet = g.creatures.spawn('rowl', 21.5, 20.5, 'active', () => 0.5, 0);
  pet.stance = 'defensive';
  pet.health = 5000;
  const gob = beast(g, 'goblin', 22.2, 20.5);
  gob.health = 5000;
  g.creatures.engage(g, gob);
  // A moment on, so its being struck by you is past the hold.
  g.time += THREAT_HOLD + 1;
  g.creatures.attack(g, pet, gob);
  const turned = gob.brawl === pet.id && lines(g).includes(`The goblin turns on ${pet.name}.`);
  g.creatures.engage(g, gob);
  const held = gob.brawl === pet.id;
  g.time += THREAT_HOLD + 1;
  g.creatures.engage(g, gob);
  const back = gob.brawl === null && lines(g).includes('The goblin turns back on you.');
  g.creatures.attack(g, pet, gob);
  const defensive = gob.brawl;
  pet.stance = 'guard';
  g.creatures.attack(g, pet, gob);
  check('in the browser, it turns on the companion that bites it, holds, comes back to you, and turns at once for a guarding one',
    turned && held && back && defensive === null && gob.brawl === pet.id, `turned ${turned}, held ${held}, back ${back}, defensive ${defensive}, guard ${gob.brawl}`);
  const before = pet.health;
  g.player.stats.health = 1;
  // A rowl is unruly and now and then nips its keeper (`maybeNip`), which is its own rule and not this one.
  pet.nipAt = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 30; i++) {
    g.time += 0.1;
    g.creatures.update(0.1, g);
  }
  check('and it fights the companion on its own clock, not you', pet.health < before && g.player.stats.health === 1,
    `companion ${before} to ${pet.health}, you ${g.player.stats.health}`);
}
{
  const g = field();
  g.equip('weapon', g.inventory.add('sword', { ql: 40 }).uid);
  const rabba = beast(g, 'rabba', 22, 20.5);
  rabba.health = 10;
  const ogre = beast(g, 'ogre', 23, 20.5);
  ogre.health = 170;
  const order = { easy: 0, even: 1, hard: 2 } as const;
  const r = consider(g, rabba);
  const o = consider(g, ogre);
  check('consider rates a rabba easier than an ogre, and an ogre takes more of your blows',
    order[r.rating] < order[o.rating] && o.mine > r.mine && o.its < r.its, `rabba ${JSON.stringify(r)}, ogre ${JSON.stringify(o)}`);
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`dodges, criticals, arrow heads, venom and threat — ${ok.length} of ${ok.length}`);
