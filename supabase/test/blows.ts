/**
 * Heavy blows, hides, wounds that tell, and who is on whom.
 *
 * Both sides off the same names (`src/game/fight.ts` and
 * `heavy_blows_hides_and_wounds.sql`). What this asks:
 *
 *   * every weapon strikes the same kind of blow, every hide and every class
 *     of armour makes the same of each kind, and every kind of creature wears
 *     the same hide and hits as heavy on both sides;
 *   * a wounded arm slows a swing by the same on both sides;
 *   * a kind that hits heavy draws back and lands it on you standing there,
 *     and it falls short of you once you have stepped out of its reach;
 *   * a maul knocks a heavy blow off its stroke and staggers, a knife bleeds,
 *     and bleeding never takes the last of it;
 *   * a blow from something that is not what you are fighting lands harder.
 *
 * Runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID } from '../../src/game/actions';
import { SPECIES } from '../../src/game/creatures';
import { ARMOUR_VS, armPace, BLOW_KINDS, blowOf, fightBase, FLANK_HIT, HEAVY_HIT, HIDE_TAKES, HIDES, KNIFE_BLEED, KNIFE_BLEED_SECS, STAGGER_MAUL, WIND_UP } from '../../src/game/fight';
import { Game } from '../../src/game/game';
import { WEAPONS } from '../../src/game/gear';
import type { Wound, WoundKind } from '../../src/game/wounds';
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
const ATTACK = ACTION_BY_ID.get('attack_creature');
if (!ATTACK) throw new Error('no attack');

/** A wound of this kind and severity on this part. */
const wound = (part: string, severity: number): Wound =>
  ({ id: 1, kind: 'cut', part, severity, bleeding: true, infected: false, dressing: null, at: 0 }) as Wound;
const ARM_WOUNDS = [wound('arms', 0.08), wound('weapon', 0.05), wound('legs', 0.3)];

/* ---- The island's half ------------------------------------------------- */

const out = psql(`
begin;
create temp table said (k text, v text);
do $b$
declare w record; v_px double precision; v_py double precision; v_ogre int; v_crawler int; v_id bigint;
        v_h0 double precision; v_h1 double precision; v_h2 double precision; r record;
begin
  -- Off the beach of the biggest island there is, where things may come for you (\`at_peace\`).
  select p.world_id, p.uid, wd.size, wd.spawn_x, wd.spawn_y into w
    from player p join world wd on wd.id = p.world_id order by wd.size desc, p.world_id, p.uid limit 1;
  v_px := case when w.spawn_x + peace_reach() + 6 < w.size then w.spawn_x + peace_reach() + 6.5
               else w.spawn_x - peace_reach() - 5.5 end;
  v_py := w.spawn_y + 0.5;
  update player set act = null, act_target = null, act_ends = null, act_left = null, act_goes = null,
         act_queue = '[]'::jsonb, equipped = '{}'::jsonb, fight_stance = 'balanced', fight_back = false,
         moved_at = now() - interval '1 minute', x = v_px, y = v_py, level = 0, wounds = '[]'::jsonb,
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('hunger', 1, 'thirst', 1, 'health', 1, 'stamina', 1, 'aegis', 0)
    where world_id = w.world_id and uid = w.uid;

  -- The tables.
  insert into said select 'BLOW:' || id, blow_of(id, kind) from weapon_def;
  insert into said values ('BLOW:fist', blow_of((swung_with(w.world_id, w.uid)).id, (swung_with(w.world_id, w.uid)).kind));
  insert into said select 'HIDE:' || h || ':' || b, hide_takes(h, b)::text
    from unnest(array['thick', 'shell', 'scaled', 'soft']) h, unnest(array['cut', 'pierce', 'crush']) b;
  insert into said select 'ARMOUR:' || c || ':' || k, armour_vs(c, k)::text
    from unnest(array['cloth', 'leather', 'chain', 'plate', 'scale']) c, unnest(array['cut', 'pierce', 'crush', 'bite', 'burn']) k;
  insert into said select 'KIND:' || id, coalesce(hide, 'soft') || '|' || heavy from species_def;

  -- A wounded arm, swinging a sword.
  v_id := give(w.world_id, w.uid, 'sword', 1, 40);
  update player set equipped = jsonb_build_object('weapon', v_id),
         wounds = '${JSON.stringify(ARM_WOUNDS)}'::jsonb
    where world_id = w.world_id and uid = w.uid;
  insert into said values ('ARM', arm_pace((select wounds from player where world_id = w.world_id and uid = w.uid))
    || '|' || act_base(w.world_id, w.uid, 'attack_creature', 2.5));
  -- And a ward over you that holds, so ten seconds of an ogre does not end the test.
  update player set wounds = '[]'::jsonb, equipped = '{}'::jsonb, stats = jsonb_set(stats, '{aegis}', '1000')
    where world_id = w.world_id and uid = w.uid;

  -- An ogre beside you, after you, and ten seconds of standing there.
  v_ogre := creature_spawn(w.world_id, 'ogre', v_px + 0.7, v_py, 'wild', now() - interval '2 hours');
  update creature set health = 50000, traits = '{}', hunting = w.uid, hunt_x = v_px + 0.7, hunt_y = v_py,
      fight_blows = 0, windup_at = null,
      from_x = v_px + 0.7, from_y = v_py, to_x = v_px + 0.7, to_y = v_py, leg_at = now(), leg_ends = now(),
      until = now() - interval '10 seconds', settled_at = now() - interval '10 seconds'
    where world_id = w.world_id and id = v_ogre;
  delete from event where uid = w.uid;
  perform creature_settle(w.world_id, v_ogre);
  insert into said values ('HEAVY', (select count(*) from event where uid = w.uid and text like '%draws back for a heavy blow%')::text
    || '|' || (select count(*) from event where uid = w.uid and text like '%heavy blow lands%')::text
    || '|' || (select count(*) from event where uid = w.uid and text like '%is on you%')::text);

  -- Drawing back again, with you three tiles off by the time it comes down.
  update creature set windup_at = now() - interval '1 second', until = now() - interval '1 second',
      settled_at = now() - interval '1 second'
    where world_id = w.world_id and id = v_ogre;
  update player set x = v_px - 2.3 where world_id = w.world_id and uid = w.uid;
  delete from event where uid = w.uid;
  perform creature_settle(w.world_id, v_ogre);
  insert into said values ('SHORT', (select count(*) from event where uid = w.uid and text like '%heavy blow falls short%')::text
    || '|' || (select count(*) from event where uid = w.uid and text like '%heavy blow lands%')::text);
  update player set x = v_px where world_id = w.world_id and uid = w.uid;

  -- A maul knocks it off its stroke; a knife opens it up.
  update creature set windup_at = now() + interval '1 second', until = now() + interval '1 second'
    where world_id = w.world_id and id = v_ogre;
  perform side_blow(w.world_id, w.uid, v_ogre, 'mauls', 10);
  insert into said values ('MAUL', coalesce((select windup_at::text from creature where world_id = w.world_id and id = v_ogre), 'none')
    || '|' || (select round(extract(epoch from (until - now()))::numeric, 3) from creature where world_id = w.world_id and id = v_ogre));
  v_crawler := creature_spawn(w.world_id, 'crawler', v_px - 0.7, v_py, 'wild', now() - interval '2 hours');
  update creature set health = 20, traits = '{}' where world_id = w.world_id and id = v_crawler;
  perform side_blow(w.world_id, w.uid, v_crawler, 'knives', 10);
  insert into said select 'KNIFE', bleed_rate || '|' || round(extract(epoch from (bleed_until - now()))::numeric, 3)
    from creature where world_id = w.world_id and id = v_crawler;
  -- Four seconds of it, and then a minute: it bleeds, and never the last of it.
  update creature set settled_at = now() - interval '4 seconds' where world_id = w.world_id and id = v_crawler;
  perform creature_settle(w.world_id, v_crawler);
  select health into v_h1 from creature where world_id = w.world_id and id = v_crawler;
  update creature set health = 3, settled_at = now() - interval '1 minute', bleed_until = now() + interval '1 minute'
    where world_id = w.world_id and id = v_crawler;
  perform creature_settle(w.world_id, v_crawler);
  select health into v_h2 from creature where world_id = w.world_id and id = v_crawler;
  insert into said values ('BLED', v_h1 || '|' || v_h2);

  -- Fighting the crawler, bitten by the ogre: at your back.
  update creature set hunting = null, windup_at = null where world_id = w.world_id and id = v_ogre;
  update player set act = 'attack_creature', act_target = jsonb_build_object('kind', 'creature', 'id', v_crawler),
         act_ends = now() + interval '1 minute', wounds = '[]'::jsonb,
         stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{aegis}', '0')
    where world_id = w.world_id and uid = w.uid;
  perform mark_attacker(w.world_id, w.uid, v_crawler);
  perform hurt_player(w.world_id, w.uid, 0.01, 'The crawler is on you', 'cut');
  select (stats->>'health')::double precision into v_h0 from player where world_id = w.world_id and uid = w.uid;
  perform mark_attacker(w.world_id, w.uid, v_ogre);
  perform hurt_player(w.world_id, w.uid, 0.01, 'The ogre is on you', 'cut');
  select (stats->>'health')::double precision into v_h1 from player where world_id = w.world_id and uid = w.uid;
  insert into said values ('FLANK', (1 - v_h0) || '|' || (v_h0 - v_h1));
  delete from creature where world_id = w.world_id and id in (v_ogre, v_crawler);
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

/* ---- The tables, both sides --------------------------------------------- */

const offBlow = WEAPONS.filter((w) => island(`BLOW:${w.id}`) !== blowOf(w));
check(`all ${WEAPONS.length} weapons strike the same kind of blow, and bare hands crush`,
  offBlow.length === 0 && island('BLOW:fist') === 'crush',
  [...offBlow.map((w) => `${w.id}: island ${island(`BLOW:${w.id}`)}, browser ${blowOf(w)}`), `fist: ${island('BLOW:fist')}`].join('; '));
const offHide = HIDES.flatMap((h) => BLOW_KINDS.filter((b) => !near(Number(island(`HIDE:${h}:${b}`)), HIDE_TAKES[h][b])).map((b) => `${h}/${b}`));
check('every hide makes the same of every kind of blow, and a soft one takes them as they come',
  offHide.length === 0 && BLOW_KINDS.every((b) => island(`HIDE:soft:${b}`) === '1'), offHide.join(', '));
const kinds: WoundKind[] = ['cut', 'pierce', 'crush', 'bite', 'burn'];
const offArmour = Object.entries(ARMOUR_VS).flatMap(([c, t]) => kinds.filter((k) => !near(Number(island(`ARMOUR:${c}:${k}`)), t[k])).map((k) => `${c}/${k}`));
check('every class of armour makes the same of every kind of blow', offArmour.length === 0, offArmour.join(', '));
const offKind = Object.values(SPECIES).filter((d) => island(`KIND:${d.id}`) !== `${d.hide ?? 'soft'}|${d.heavy ? 'true' : 'false'}`);
check(`all ${Object.keys(SPECIES).length} kinds wear the same hide and hit as heavy`, offKind.length === 0,
  offKind.map((d) => `${d.id}: island ${island(`KIND:${d.id}`)}, browser ${d.hide ?? 'soft'}|${!!d.heavy}`).join('; '));

/* ---- A wounded arm --------------------------------------------------------- */

/** A body on level grass. */
const body = (): Game => {
  const g = Game.create(4242);
  const w = g.world;
  for (let y = 16; y <= 26; y++) for (let x = 16; x <= 26; x++) { w.setHeight(x, y, 4); w.setDirt(x, y, 3); }
  for (let y = 16; y <= 25; y++) for (let x = 16; x <= 25; x++) w.setTile(x, y, TileType.Grass, 0);
  g.player.x = 20.5;
  g.player.y = 20.5;
  g.player.stats.stamina = 1;
  g.player.stats.health = 1;
  return g;
};
{
  const [pace, base] = island('ARM').split('|').map(Number);
  const g = body();
  g.equip('weapon', g.inventory.add('sword', { ql: 40 }).uid);
  g.player.wounds = ARM_WOUNDS.map((w) => ({ ...w }));
  const b = fightBase(g, ATTACK) ?? -1;
  check('a wounded arm slows a swing the same on both sides, and a wounded leg does not',
    near(pace, armPace(ARM_WOUNDS)) && near(base, b) && pace > 1,
    `island ${pace} / ${base}, browser ${armPace(ARM_WOUNDS)} / ${b}`);
}

/* ---- Heavy blows ------------------------------------------------------------ */

{
  const [drawn, landed, plain] = island('HEAVY').split('|').map(Number);
  check('on the island, an ogre on you draws back and lands a heavy blow between its others',
    drawn >= 1 && landed >= 1 && plain >= 2, `${drawn} drawn, ${landed} landed, ${plain} plain`);
  const [short, landedAway] = island('SHORT').split('|').map(Number);
  check('and one drawn back while you step three tiles off falls short', short === 1 && landedAway === 0, island('SHORT'));
}
{
  const g = body();
  g.settings.fightBack = false;
  const ogre = g.creatures.spawn('ogre', 21.2, 20.5, 'wild', () => 0.5, 0);
  ogre.health = 50000;
  ogre.traits = [];
  g.creatures.engage(g, ogre);
  const lines = (): string[] => g.log.map((l) => l.text);
  for (let i = 0; i < 100; i++) {
    g.time += 0.1;
    g.creatures.update(0.1, g);
    // Standing still beside it: put back where we were, whatever a blow did.
    g.player.x = 20.5;
    g.player.y = 20.5;
  }
  const drawn = lines().filter((t) => t.includes('draws back for a heavy blow')).length;
  const landed = lines().filter((t) => t.includes('heavy blow lands')).length;
  const plain = lines().filter((t) => t.includes('is on you')).length;
  check('in the browser, the same', drawn >= 1 && landed >= 1 && plain >= 2, `${drawn} drawn, ${landed} landed, ${plain} plain`);
  // Drawn back again, and three tiles off by the time it comes down.
  ogre.windup = WIND_UP;
  g.player.x = 18.2;
  const before = lines().length;
  for (let i = 0; i < 12; i++) {
    g.time += 0.1;
    g.creatures.update(0.1, g);
  }
  const after = lines().slice(before);
  check('and one drawn back while you step three tiles off falls short',
    after.some((t) => t.includes('heavy blow falls short')) && !after.some((t) => t.includes('heavy blow lands')), after.join(' | '));
  check(`a heavy blow is ${HEAVY_HIT} times a plain one`, HEAVY_HIT > 1);
}

/* ---- A maul and a knife -------------------------------------------------- */

{
  const [windup, until] = island('MAUL').split('|');
  check(`on the island, a maul knocks a heavy blow off its stroke and puts the next back ${STAGGER_MAUL} second`,
    windup === 'none' && near(Number(until), 1 + STAGGER_MAUL, 0.05), island('MAUL'));
  const [rate, secs] = island('KNIFE').split('|').map(Number);
  check(`and a knife leaves it bleeding ${KNIFE_BLEED} of the blow a second for ${KNIFE_BLEED_SECS} seconds`,
    near(rate, 10 * KNIFE_BLEED) && near(secs, KNIFE_BLEED_SECS, 0.05), island('KNIFE'));
  const [h1, h2] = island('BLED').split('|').map(Number);
  check('four seconds of it take four seconds of bleeding, and a minute of it never the last of it',
    near(h1, 20 - 4 * 10 * KNIFE_BLEED, 0.02) && h2 === 1, island('BLED'));
}
{
  const g = body();
  g.rand = () => 0;
  g.settings.fightBack = false;
  const maul = g.inventory.add('maul', { ql: 40 });
  g.equip('weapon', maul.uid);
  const ogre = g.creatures.spawn('ogre', 21.2, 20.5, 'wild', () => 0.5, 0);
  ogre.health = 50000;
  ogre.windup = 0.5;
  ogre.cooldown = 0;
  ATTACK.perform({ kind: 'creature', id: ogre.id }, g);
  const knocked = ogre.windup === 0 && near(ogre.cooldown, STAGGER_MAUL);
  g.equip('weapon', g.inventory.add('hunting_knife', { ql: 40 }).uid);
  const crawler = g.creatures.spawn('crawler', 19.8, 20.5, 'wild', () => 0.5, 0);
  crawler.traits = [];
  // Under its most, so nothing but the bleeding moves it.
  crawler.health = 20;
  ATTACK.perform({ kind: 'creature', id: crawler.id }, g);
  const opened = crawler.bleedRate > 0 && near(crawler.bleedUntil, g.time + KNIFE_BLEED_SECS);
  const at = crawler.health;
  for (let i = 0; i < 40; i++) {
    g.time += 0.1;
    g.creatures.update(0.1, g);
  }
  const bled = at - crawler.health;
  const rate = crawler.bleedRate;
  // A cut deep enough to take more than is left, the whole of its time.
  crawler.health = 3;
  crawler.bleedRate = 5;
  crawler.bleedUntil = g.time + KNIFE_BLEED_SECS;
  for (let i = 0; i < 10 * KNIFE_BLEED_SECS; i++) {
    g.time += 0.1;
    g.creatures.update(0.1, g);
  }
  check('in the browser, a maul knocks it off its stroke, a knife opens it up, and bleeding never takes the last of it',
    knocked && opened && near(bled, 4 * rate, 0.05) && crawler.health === 1,
    `knocked ${knocked} (windup ${ogre.windup}, cooldown ${ogre.cooldown}), opened ${opened}, bled ${bled} of ${4 * rate}, left ${crawler.health}`);
}

/* ---- At your back -------------------------------------------------------------- */

{
  const [front, back] = island('FLANK').split('|').map(Number);
  check(`on the island, a blow from what you are not fighting lands ${FLANK_HIT} times as hard`, near(back / front, FLANK_HIT, 1e-6), island('FLANK'));
  const g = body();
  g.settings.fightBack = false;
  const crawler = g.creatures.spawn('crawler', 21.2, 20.5, 'wild', () => 0.5, 0);
  const ogre = g.creatures.spawn('ogre', 19.8, 20.5, 'wild', () => 0.5, 0);
  crawler.health = 5000;
  g.requestAction(ATTACK, { kind: 'creature', id: crawler.id });
  g.player.attackedBy = crawler.id;
  g.hurtPlayer(0.01, 'The crawler is on you', 'cut');
  const h0 = g.player.stats.health;
  g.player.attackedBy = ogre.id;
  g.hurtPlayer(0.01, 'The ogre is on you', 'cut');
  const h1 = g.player.stats.health;
  check('in the browser, the same', near((h0 - h1) / (1 - h0), FLANK_HIT, 1e-6), `${1 - h0} then ${h0 - h1}`);
}

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`heavy blows, hides and wounds — ${ok.length} of ${ok.length}`);
