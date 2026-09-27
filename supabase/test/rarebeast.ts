/**
 * Rare wildermon.
 *
 * Asked for: "wildermon themselves can spawn rarity at the same rates as
 * normal rarity rolls: a rare wildermon is 1.5x larger, 1.2x better stats,
 * chances for better traits. Supreme 2x larger 1.4x stats; fantastic 3x
 * larger 1.6x stats. Rarity makes the entire wildermon shimmer like rare gear."
 *
 * Measured on both sides:
 *
 *   * a wildermon comes into the world rare at a made thing's odds
 *     (`rollRarity`, `rarity_roll`), and a monster never does;
 *   * it is the size and the blood its step says (`RARITIES`, `rarity_def`),
 *     every channel of its blood that much better -- multiplied where more is
 *     better, divided where less is -- in its health, its bite, its pace, its
 *     work, its upkeep and the rest (`bloodMul`, `beast_mul`), the two sides
 *     agreeing channel by channel;
 *   * its traits are rolled on the wild table lifted for each step, so a
 *     fantastic one has no common blood (`rollTraits`, `roll_traits`);
 *   * a young one is rolled for too, with its parents' traits kept;
 *   * the island says how rare each one is, and the browser reads it, keeps
 *     it in a save, draws it that much bigger and says what it is worth.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { attackOf, bloodMul, Creatures, maxHealth, rarityLine, rarityMul, raritySays, SPECIES, workRangeOf, type IslandCreature } from '../../src/game/creatures';
import { RARITIES, RARITY_ODDS, rarityChance } from '../../src/game/items';
import { CHANNELS, husbandryOdds, rollTraits, traitMul, traitTier, TIERS, type TraitChannel } from '../../src/game/traits';

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

let bad = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`);
};
const near = (a: number, b: number, by = 1e-4): boolean => Math.abs(a - b) <= by * Math.max(1, Math.abs(b));

/** A seeded roll, so a count here is the same count every time. */
const seeded = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/* ---- What was asked for, on the one table both sides read ---------------------------------- */

const ASKED = [{ size: 1, blood: 1 }, { size: 1.5, blood: 1.2 }, { size: 2, blood: 1.4 }, { size: 3, blood: 1.6 }];
say(RARITIES.every((r, i) => r.size === ASKED[i].size && r.blood === ASKED[i].blood),
  `rare, supreme and fantastic wildermon are ${RARITIES.slice(1).map((r) => `${r.size}× the size and ${r.blood}× the blood`).join(', ')}`);

/* ---- The browser: how often, and never a monster --------------------------------------------- */

const game = Game.create(4411);
const beasts = game.creatures;
const rand = seeded(20260927);
const ROLLS = 40000;
const got = [0, 0, 0, 0];
for (let i = 0; i < ROLLS; i++) {
  const c = beasts.spawn('rabba', 10, 10, 'active', rand);
  got[c.rare]++;
  beasts.list.delete(c.id);
}
// Three standard errors either way of the count the odds say, for the first two steps; a fantastic one is too rare to count.
const expect = (step: number): number => ROLLS * (rarityChance(step) - rarityChance(step + 1));
const within = (step: number): boolean => Math.abs(got[step] - expect(step)) <= 3 * Math.sqrt(expect(step)) + 1;
say(within(1) && within(2) && got[1] + got[2] + got[3] > 0,
  `${ROLLS} wildermon come into the world ${got[1]} rare, ${got[2]} supreme and ${got[3]} fantastic, where a made thing's odds (${RARITY_ODDS.join(', ')}) say ${expect(1).toFixed(0)}, ${expect(2).toFixed(0)} and ${expect(3).toFixed(1)}`);
let monsters = 0;
for (let i = 0; i < 4000; i++) {
  const c = beasts.spawn('goblin', 10, 10, 'active', rand);
  if (c.rare) monsters++;
  beasts.list.delete(c.id);
}
say(SPECIES.goblin?.monster === true && monsters === 0, `and four thousand goblins come into it ordinary: ${monsters} rare`);

/* ---- The browser: its blood, one channel at a time -------------------------------------------- */

const one = beasts.spawn('roxxen', 12, 12, 'active', rand);
one.traits = ['swift', 'fanged', 'thick_hided'];
const def = SPECIES.roxxen;
const upFor = (ch: TraitChannel): boolean => CHANNELS.find((c) => c.id === ch)?.up !== false;
let channelsRight = 0;
let figuresRight = 0;
for (let step = 0; step < RARITIES.length; step++) {
  one.rare = step;
  const k = RARITIES[step].blood;
  const right = CHANNELS.every((ch) => near(bloodMul(one, ch.id), traitMul(one.traits, ch.id) * (upFor(ch.id) ? k : 1 / k))
    && near(rarityMul(one, ch.id), upFor(ch.id) ? k : 1 / k));
  if (right) channelsRight++;
  const health = Math.round(def.health * traitMul(one.traits, 'hardy') * k);
  if (maxHealth(one, def) === health && near(attackOf(one, def), def.attack * traitMul(one.traits, 'tough') * k)
    && near(beasts.speedMul(one), bloodMul(one, 'speed') * beasts.aura(one, 'speed'))) figuresRight++;
}
say(channelsRight === RARITIES.length,
  `every one of the ${CHANNELS.length} channels of its blood is its step's blood better at each of the ${RARITIES.length} steps: multiplied on the ${CHANNELS.filter((c) => c.up).length} where more is better, divided on the ${CHANNELS.filter((c) => !c.up).length} where less is`);
say(figuresRight === RARITIES.length, 'and so is what it can take, what it bites for and how fast it goes');
one.rare = 3;
const reach = workRangeOf(one, def);
one.rare = 0;
say(reach > workRangeOf(one, def) || def.workRange === 0, `and how far it works from the token: ${workRangeOf(one, def)} tiles ordinary, ${reach} fantastic`);

/* ---- The browser: its traits ------------------------------------------------------------------ */

const tiersOf = (rare: number, n: number): Record<string, number> => {
  const r = seeded(77 + rare);
  const out: Record<string, number> = { common: 0, rare: 0, supreme: 0, fantastic: 0 };
  for (let i = 0; i < n; i++) for (const t of rollTraits(r, 0, rare)) out[traitTier(t)]++;
  return out;
};
const plain = tiersOf(0, 3000), fantastic = tiersOf(3, 3000), rareOnes = tiersOf(1, 3000);
const commonShare = (t: Record<string, number>): number => t.common / Object.values(t).reduce((a, b) => a + b, 0);
say(fantastic.common === 0 && husbandryOdds(0, 3).common === 0, `a fantastic one has no common blood: ${fantastic.common} common traits in ${Object.values(fantastic).reduce((a, b) => a + b, 0)}`);
say(commonShare(rareOnes) < commonShare(plain) - 0.15,
  `and a rare one far less of it than an ordinary one: ${(commonShare(rareOnes) * 100).toFixed(0)}% common against ${(commonShare(plain) * 100).toFixed(0)}%, the table lifted as a hundred husbandry lifts it`);
say(TIERS.every((t) => near(husbandryOdds(0, 1)[t], husbandryOdds(100, 0)[t])), 'a step of rarity lifts the table exactly as far as a hundred husbandry does');

/* ---- The browser: kept in a save, read off the island, and said ------------------------------ */

one.rare = 2;
const back = Creatures.fromJSON(JSON.parse(JSON.stringify(beasts.toJSON())));
const old = JSON.parse(JSON.stringify(beasts.toJSON()));
for (const j of old.list) delete j.rare;
const olden = Creatures.fromJSON(old);
say(back.get(one.id)?.rare === 2 && [...olden.list.values()].every((c) => c.rare === 0),
  'a save keeps how rare it is, and one from before there were rare ones reads every beast ordinary');
const row = (rare?: string): IslandCreature => ({ id: 900001, species: 'rabba', name: 'Rabba', variant: 0, mode: 'wild', stance: 'defensive', x: 5, y: 5, health: 10, ...(rare ? { rare } : {}) });
const seen = new Creatures();
seen.sawAll([row('fantastic')]);
const wasRare = seen.get(900001)?.rare;
seen.sawAll([row()]);
say(wasRare === 3 && seen.get(900001)?.rare === 0, 'the browser takes how rare it is off the island, and nothing said is an ordinary one');
const line = rarityLine({ rare: 1 }) + ' | ' + raritySays({ rare: 3 });
say(line.includes('half again the size') && line.includes('+20% speed') && line.includes('−17% upkeep')
  && line.includes('three times the size') && line.includes('+60% speed') && line.includes('−37% upkeep') && rarityLine({ rare: 0 }) === '',
  `and says what it is worth in the table's own numbers, stat by stat: ${line}`);

/* ---- The island ------------------------------------------------------------------------------- */

const beastSql = CHANNELS.map((ch) => `'${ch.id}'`).join(', ');
const out = psql(`
begin;
create temp table said (k text, v text);
do $$
declare w uuid; u uuid; v_c int; v_m int; v_y int; c creature; v_dam int; v_sire int; v_t text;
begin
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;

  -- Each step, and a monster, with the roll held to that step.
  for v_t in select id from rarity_def order by ord loop
    execute format('create or replace function rarity_roll() returns text language sql as %L', 'select ' || quote_literal(v_t) || '::text');
    v_c := creature_spawn(w, 'roxxen', 12.5, 12.5, 'wild', null, null);
    v_m := creature_spawn(w, 'goblin', 12.5, 13.5, 'wild', null, null);
    select * into c from creature where world_id = w and id = v_c;
    insert into said values ('SPAWN|' || v_t, coalesce(c.rare, 'none') || '|' || coalesce((select rare from creature where world_id = w and id = v_m), 'none')
      || '|' || (select count(*) from unnest(c.traits) t join trait_def d on d.id = t where d.tier = 'common')
      || '|' || c.health || '|' || round(species_health('roxxen') * trait_mul(c.traits, 'hardy') * (select blood from rarity_def where id = v_t))
      || '|' || max_health(c));
    -- Its blood, channel by channel, with its traits as the browser holds them.
    update creature set traits = array['swift', 'fanged', 'thick_hided'] where world_id = w and id = v_c;
    select * into c from creature where world_id = w and id = v_c;
    insert into said select 'MUL|' || v_t || '|' || ch, beast_mul(c, ch)::text from unnest(array[${beastSql}]) ch;
    insert into said values ('HEALTH|' || v_t, max_health(c) || '|' || attack_of(c));
  end loop;
  create or replace function rarity_roll() returns text language sql as 'select null::text';
  v_c := creature_spawn(w, 'roxxen', 12.5, 14.5, 'wild', null, null);
  insert into said values ('PLAIN', coalesce((select rare from creature where world_id = w and id = v_c), 'none'));

  -- What the island says of them, to somebody standing by.
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  update player set x = 12.5, y = 13 where world_id = w and uid = u;
  delete from caller where uid = u;
  insert into said select 'SENT|' || (r->>'species') || '|' || (r->>'id'), coalesce(r->>'rare', 'none')
    from jsonb_array_elements(rpc_creatures(w, 6)) r where (r->>'species') in ('roxxen');

  -- A young one: rolled for as anything coming into the world is, and its parents' traits kept.
  create or replace function rarity_roll() returns text language sql as 'select ''supreme''::text';
  v_dam := creature_spawn(w, 'rabba', 20.5, 20.5, 'active', now() - interval '3 hours', u);
  update creature set sex = 'female', unborn = jsonb_build_object('traits', jsonb_build_array('swift'), 'sex', 'male',
      'sire', jsonb_build_object('id', 0, 'name', 'Nobody'), 'from', '{}'::jsonb), due = now() - interval '1 second'
    where world_id = w and id = v_dam;
  perform give_birth(w, v_dam);
  select * into c from creature where world_id = w and species = 'rabba' and id > v_dam order by id desc limit 1;
  insert into said values ('YOUNG', coalesce(c.rare, 'none') || '|' || array_to_string(c.traits, ',') || '|' || c.health || '|' || max_health(c));
end $$;
select k || '=' || v from said order by k;
rollback;
`);
const said = new Map(out.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)] as [string, string]));

const steps = RARITIES.slice(1).map((r) => r.name);
const spawns = steps.map((s) => (said.get(`SPAWN|${s}`) ?? '').split('|'));
say(spawns.every((p, i) => p[0] === steps[i] && p[1] === 'none'),
  `the island spawns a wildermon as rare as the roll says and a monster ordinary whatever it says: ${spawns.map((p) => `${p[0]}/${p[1]}`).join(', ')}`);
say(spawns[2][2] === '0', `a fantastic one on the island has no common blood either: ${spawns[2][2]} common traits`);
say(spawns.every((p) => p[3] === p[4] && p[3] === p[5]), `and comes in at the health its blood and its rarity give it: ${spawns.map((p) => `${p[3]} of ${p[5]}`).join(', ')}`);
say(said.get('PLAIN') === 'none', 'and an ordinary roll is an ordinary one, with no word for it');

// The browser's blood beside the island's, channel by channel, at each step, for the same three traits.
const twin = beasts.spawn('roxxen', 30, 30, 'wild', rand);
twin.traits = ['swift', 'fanged', 'thick_hided'];
let agree = 0, asked = 0;
const off: string[] = [];
steps.forEach((s, i) => {
  twin.rare = i + 1;
  for (const ch of CHANNELS) {
    asked++;
    const island = Number(said.get(`MUL|${s}|${ch.id}`));
    // The island's wild beast has no herd aura and no brushing on work and learning; the browser's blood is blood alone.
    if (near(island, bloodMul(twin, ch.id), 1e-5)) agree++;
    else off.push(`${s} ${ch.id} ${island} vs ${bloodMul(twin, ch.id)}`);
  }
});
say(agree === asked, `the browser and the island agree on all ${asked} channels at the three steps${off.length ? `: ${off.slice(0, 4).join('; ')}` : ''}`);
const healths = steps.map((s) => (said.get(`HEALTH|${s}`) ?? '').split('|').map(Number));
say(healths.every(([h, a], i) => { twin.rare = i + 1; return h === maxHealth(twin, SPECIES.roxxen) && near(a, attackOf(twin, SPECIES.roxxen)); }),
  `and on what it can take and what it bites for: ${healths.map(([h, a]) => `${h}/${a.toFixed(1)}`).join(', ')}`);

const sent = [...said.entries()].filter(([k]) => k.startsWith('SENT|')).map(([, v]) => v);
say(sent.length >= 4 && steps.every((s) => sent.includes(s)) && sent.includes('none'),
  `the island tells the browser how rare each one near you is, and says nothing of an ordinary one: ${sent.join(', ')}`);

const young = (said.get('YOUNG') ?? '').split('|');
say(young[0] === 'supreme' && young[1] === 'swift' && young[2] === young[3],
  `a young one is rolled for as anything else is, keeps the blood its parents gave it and is born at its whole health: ${said.get('YOUNG')}`);

if (bad) {
  console.error(`${bad} of them are not what they should be`);
  process.exit(1);
}
console.log('a wildermon comes into the world rare at a made thing\'s odds, bigger and better for it, on both sides');
