/**
 * Sacrifice at the altar, and motes.
 *
 * Asked for: rare, supreme and fantastic things given up at the altar; each
 * one fills every nutrient to the top; one in a hundred leaves a mote of the
 * same rarity; a mote absorbed into an ordinary thing gives it that rarity.
 * What this asks, of both sides and in the same words:
 *
 *   * the share of sacrifices that leave a mote, and the nutrients a sacrifice
 *     fills, are the same numbers on the island as in the browser;
 *   * a sacrifice is made only kneeling at an altar, of a thing in the pack
 *     that is rare or better -- never a mote, a locked thing, a worn one or a
 *     bag with something in it -- and gives up one, of a stack one;
 *   * it fills all four nutrients to the top, and says so;
 *   * when a mote comes of it, it is of the rarity of what was given up;
 *   * a mote goes only into an ordinary thing, never another mote, a bauble or
 *     a thing that is rare already; one of a stack takes it, the rest stay as
 *     they were, and a thing on its own takes it where it is; the mote is used.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game, type Deed } from '../../src/game/game';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import { NUTRIENTS } from '../../src/game/nutrition';
import { ABSORB_SAID, alreadyRare, FED_SAID, MOTE, MOTE_CHANCE, SACRIFICE_SAID } from '../../src/game/sacrifice';
import { RARITIES } from '../../src/game/items';

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

/* ---- the same numbers ------------------------------------------------------ */
check('the island leaves a mote as often as the browser', psql('select mote_chance()') === String(MOTE_CHANCE), psql('select mote_chance()'));
check('and fills the same nutrients', psql(`select array_to_string(nutrients(), ',')`) === NUTRIENTS.join(','), psql(`select array_to_string(nutrients(), ',')`));
check('and says so in the same words', psql('select fed_said()') === FED_SAID, psql('select fed_said()'));
check('a mote is a thing both sides know, and stacks by its rarity', psql(`select stackable from item_def where id = '${MOTE}'`) === 't');

/* ---- the island ------------------------------------------------------------- */
const out = psql(`
begin;
create temp table said (k text, v text);
do $$
declare w uuid; u uuid; alt bigint; box bigint; axe bigint; planks bigint; plain bigint; kept bigint; worn bigint;
        bag bigint; mote bigint; stack bigint; single bigint; bauble bigint; j jsonb; v_n int;
begin
  -- The suite's own island, by name, and somebody on it.
  select id into w from world where name = 'Stonehaven';
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  update player set x = 8.5, y = 8.5, act = null, act_queue = '[]', equipped = '{}'::jsonb,
         nutrition = '{"starch": 0.2, "flesh": 0.1, "fat": 0, "greens": 0.5}'::jsonb
   where world_id = w and uid = u;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'furniture', 'altar', 9, 8, 0, 0, 9.5, 8.5, 50, u) returning id into alt;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (w, 'furniture', 'chest', 7, 8, 0, 0, 7.5, 8.5, 50, u) returning id into box;

  axe := give(w, u, 'hatchet', 1, 40, null, 'rare');
  planks := give(w, u, 'plank', 3, 40, null, 'supreme');
  plain := give(w, u, 'plank', 5, 40);
  kept := give(w, u, 'shovel', 1, 40, null, 'rare');
  update item set locked = true where id = kept;
  worn := give(w, u, 'pickaxe', 1, 40, null, 'fantastic');
  update player set equipped = jsonb_build_object('weapon', worn) where world_id = w and uid = u;
  bag := give(w, u, 'satchel', 1, 40, null, 'rare');
  insert into item (world_id, holder, holder_uid, inside, def, ql, count) values (w, 'player', u, bag, 'nail', 20, 3);
  mote := give(w, u, 'mote', 1, 40, null, 'rare');

  -- What is refused.
  insert into said values ('NOTALTAR', coalesce(act_refusal(w, u, 'sacrifice', jsonb_build_object('kind', 'furniture', 'id', box, 'itemUid', axe)), 'null'));
  update player set x = 12.5, y = 12.5 where world_id = w and uid = u;
  insert into said values ('REACH', coalesce(act_refusal(w, u, 'sacrifice', jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', axe)), 'null'));
  update player set x = 8.5, y = 8.5 where world_id = w and uid = u;
  insert into said values ('PICK', coalesce(act_refusal(w, u, 'sacrifice', jsonb_build_object('kind', 'furniture', 'id', alt)), 'null'));
  insert into said values ('MOTE', coalesce(act_refusal(w, u, 'sacrifice', jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', mote)), 'null'));
  insert into said values ('PLAIN', coalesce(act_refusal(w, u, 'sacrifice', jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', plain)), 'null'));
  insert into said values ('LOCKED', coalesce(act_refusal(w, u, 'sacrifice', jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', kept)), 'null'));
  insert into said values ('WORN', coalesce(act_refusal(w, u, 'sacrifice', jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', worn)), 'null'));
  insert into said values ('FULL', coalesce(act_refusal(w, u, 'sacrifice', jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', bag)), 'null'));

  -- A rare hatchet given up: gone, and every nutrient full; no mote, whatever the dice say.
  create or replace function mote_chance() returns double precision language sql immutable as 'select 0::double precision';
  j := jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', axe);
  insert into said values ('AXE', coalesce(act_refusal(w, u, 'sacrifice', j), 'null'));
  perform act_perform(w, u, 'sacrifice', j);
  insert into said select 'AXEGONE', count(*)::text from item where id = axe;
  insert into said select 'FED', (select string_agg(k || '=' || (nutrition->>k), ',' order by o)
    from unnest(nutrients()) with ordinality n(k, o)) from player where world_id = w and uid = u;
  insert into said select 'AXESAID', e.text from event e where e.world_id = w and e.uid = u order by e.n desc limit 1;

  -- One of the supreme planks, and a mote left, whatever the dice say.
  create or replace function mote_chance() returns double precision language sql immutable as 'select 1::double precision';
  update player set nutrition = '{}'::jsonb where world_id = w and uid = u;
  perform act_perform(w, u, 'sacrifice', jsonb_build_object('kind', 'furniture', 'id', alt, 'itemUid', planks));
  insert into said select 'PLANKSLEFT', count::text from item where id = planks;
  insert into said select 'MOTES', string_agg(coalesce(rare, 'plain') || ' x' || count, ',' order by rare)
    from item where world_id = w and holder = 'player' and holder_uid = u and def = 'mote';
  insert into said select 'MOTESAID', e.text from event e where e.world_id = w and e.uid = u order by e.n desc limit 1;
  insert into said select 'FEDAGAIN', (select bool_and((nutrition->>k)::double precision = 1) from unnest(nutrients()) k)::text
    from player where world_id = w and uid = u;

  -- Absorbing one.
  select id into mote from item where world_id = w and holder = 'player' and holder_uid = u and def = 'mote' and rare = 'supreme';
  insert into said values ('PICKMOTE', coalesce(act_refusal(w, u, 'absorb_mote', jsonb_build_object('kind', 'item', 'uid', plain, 'mote', plain)), 'null'));
  insert into said values ('PICKITEM', coalesce(act_refusal(w, u, 'absorb_mote', jsonb_build_object('kind', 'item', 'uid', -1, 'mote', mote)), 'null'));
  insert into said values ('INTOMOTE', coalesce(act_refusal(w, u, 'absorb_mote', jsonb_build_object('kind', 'item', 'uid', mote, 'mote', mote)), 'null'));
  bauble := give(w, u, 'bauble_minor', 1, 40, 'cooking: +2.1% skill gain');
  insert into said values ('BAUBLE', coalesce(act_refusal(w, u, 'absorb_mote', jsonb_build_object('kind', 'item', 'uid', bauble, 'mote', mote)), 'null'));
  insert into said values ('ALREADY', coalesce(act_refusal(w, u, 'absorb_mote', jsonb_build_object('kind', 'item', 'uid', kept, 'mote', mote)), 'null'));
  j := jsonb_build_object('kind', 'item', 'uid', plain, 'mote', mote);
  insert into said values ('ABSORB', coalesce(act_refusal(w, u, 'absorb_mote', j), 'null'));
  perform act_perform(w, u, 'absorb_mote', j);
  insert into said select 'SPLIT', string_agg(coalesce(rare, 'plain') || ' x' || count, ',' order by coalesce(rare, 'plain'))
    from item where world_id = w and holder = 'player' and holder_uid = u and def = 'plank';
  insert into said select 'MOTEUSED', count(*)::text from item where world_id = w and holder = 'player' and holder_uid = u and def = 'mote' and rare = 'supreme';
  insert into said select 'ABSORBSAID', e.text from event e where e.world_id = w and e.uid = u order by e.n desc limit 1;
  -- A thing on its own takes it where it is.
  mote := give(w, u, 'mote', 1, 40, null, 'fantastic');
  single := give(w, u, 'hatchet', 1, 40);
  perform act_perform(w, u, 'absorb_mote', jsonb_build_object('kind', 'item', 'uid', single, 'mote', mote));
  insert into said select 'SINGLE', coalesce((select rare from item where id = single), 'plain');
end $$;
select k || E'\\t' || coalesce(v, 'null') from said;
rollback;
`);
const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const at = l.indexOf('\t');
  return [l.slice(0, at), l.slice(at + 1)] as [string, string];
}));
const say = (k: string): string => said.get(k) ?? '(nothing)';

check('a chest is not an altar', say('NOTALTAR') === SACRIFICE_SAID.notAltar, say('NOTALTAR'));
check('a sacrifice is made kneeling at the altar', say('REACH') === SACRIFICE_SAID.reach, say('REACH'));
check('of something', say('PICK') === SACRIFICE_SAID.pick, say('PICK'));
check('never a mote', say('MOTE') === SACRIFICE_SAID.mote, say('MOTE'));
check('nor anything ordinary', say('PLAIN') === SACRIFICE_SAID.notRare, say('PLAIN'));
check('nor a thing put by', say('LOCKED') === SACRIFICE_SAID.locked, say('LOCKED'));
check('nor one worn', say('WORN') === SACRIFICE_SAID.worn, say('WORN'));
check('nor a bag with something in it', say('FULL') === SACRIFICE_SAID.full, say('FULL'));
check('a rare hatchet may be given up', say('AXE') === 'null', say('AXE'));
check('and is gone', say('AXEGONE') === '0', say('AXEGONE'));
check('and every nutrient is full', say('FED') === NUTRIENTS.map((k) => `${k}=1`).join(','), say('FED'));
check('said as the browser says it', say('AXESAID') === `You give up the rare hatchet at the altar. ${FED_SAID}`, say('AXESAID'));
check('of a stack, one is given up', say('PLANKSLEFT') === '2', say('PLANKSLEFT'));
check('and a mote left is of the rarity of what was given up', say('MOTES') === 'rare x1,supreme x1', say('MOTES'));
check('and says so', say('MOTESAID') === 'A supreme mote is left where the supreme plank was.', say('MOTESAID'));
check('every nutrient full again from empty', say('FEDAGAIN') === 'true', say('FEDAGAIN'));
check('a mote is absorbed only from a mote', say('PICKMOTE') === ABSORB_SAID.pickMote, say('PICKMOTE'));
check('into something', say('PICKITEM') === ABSORB_SAID.pickItem, say('PICKITEM'));
check('never another mote', say('INTOMOTE') === ABSORB_SAID.intoMote, say('INTOMOTE'));
check('nor a bauble', say('BAUBLE') === ABSORB_SAID.bauble, say('BAUBLE'));
check('nor a thing already rare', say('ALREADY') === alreadyRare({ rare: 1 }), say('ALREADY'));
check('an ordinary stack takes it', say('ABSORB') === 'null', say('ABSORB'));
check('one of it, and the rest stay as they were', say('SPLIT') === 'plain x4,supreme x2,supreme x1' || say('SPLIT') === 'plain x4,supreme x1,supreme x2', say('SPLIT'));
check('and the mote is used up', say('MOTEUSED') === '0', say('MOTEUSED'));
check('said as the browser says it', say('ABSORBSAID') === 'The supreme mote sinks into the plank, and it is supreme now.', say('ABSORBSAID'));
check('a thing on its own takes it where it is', say('SINGLE') === 'fantastic', say('SINGLE'));

/* ---- the browser ------------------------------------------------------------ */
const game = Game.create(4242);
const home: Deed = { name: 'Home', x: 40, y: 40, radius: 3, level: 1, mine: true };
game.deed = home;
game.player.x = 40.5; game.player.y = 40.5;
const altar = game.addFurniture('altar', 41, 40, 0, 0, 50);
const chest = game.addFurniture('chest', 39, 40, 0, 0, 50);
const sac = ACTION_BY_ID.get('sacrifice')!;
const absorb = ACTION_BY_ID.get('absorb_mote')!;
const at = (id: number, itemUid?: number): Target => ({ kind: 'furniture', id, ...(itemUid === undefined ? {} : { itemUid }) } as Target);
const lastSaid = (): string => game.log[game.log.length - 1]?.text ?? '';
const rare = (id: string, step: number, count = 1) => {
  const it = game.inventory.add(id, { ql: 40, count });
  const one = game.inventory.take(it.uid, count)!;
  one.rare = step;
  return game.inventory.addItem(one);
};
for (const it of [...game.inventory.items]) game.inventory.remove(it.uid, it.count);
const axe = rare('hatchet', 1);
const planks = rare('plank', 2, 3);
const plain = game.inventory.add('plank', { ql: 40, count: 5 });
const kept = rare('shovel', 1);
kept.locked = true;
const worn = rare('pickaxe', 3);
game.player.equipped.weapon = worn.uid;
const bag = rare('satchel', 1);
bag.inside = [{ uid: game.inventory.nextUid++, id: 'nail', ql: 20, dmg: 0, count: 3 }];
const mote1 = rare(MOTE, 1);
check('the browser: a chest is not an altar', sac.check?.(at(chest.id, axe.uid), game) === SACRIFICE_SAID.notAltar);
game.player.x = 44.5; game.player.y = 44.5;
check('kneel at the altar', sac.check?.(at(altar.id, axe.uid), game) === SACRIFICE_SAID.reach);
game.player.x = 40.5; game.player.y = 40.5;
check('of something', sac.check?.(at(altar.id), game) === SACRIFICE_SAID.pick);
check('never a mote', sac.check?.(at(altar.id, mote1.uid), game) === SACRIFICE_SAID.mote);
check('nor anything ordinary', sac.check?.(at(altar.id, plain.uid), game) === SACRIFICE_SAID.notRare);
check('nor a thing put by', sac.check?.(at(altar.id, kept.uid), game) === SACRIFICE_SAID.locked);
check('nor one worn', sac.check?.(at(altar.id, worn.uid), game) === SACRIFICE_SAID.worn);
check('nor a bag with something in it', sac.check?.(at(altar.id, bag.uid), game) === SACRIFICE_SAID.full);
const crate = game.inventory.add('creature_crate', { ql: 40 });
crate.rare = 1;
crate.creature = 1;
check('nor a crate with a wildermon in it', sac.check?.(at(altar.id, crate.uid), game) === SACRIFICE_SAID.creature);
for (const k of NUTRIENTS) game.player.nutrition[k] = 0.1;
game.rand = () => 0.5;
check('a rare hatchet may be given up', sac.check?.(at(altar.id, axe.uid), game) === null);
sac.perform(at(altar.id, axe.uid), game);
check('it is gone, and every nutrient is full, said as the island says it',
  !game.inventory.get(axe.uid) && NUTRIENTS.every((k) => game.player.nutrition[k] === 1) && lastSaid() === say('AXESAID'), lastSaid());
game.rand = () => 0;
sac.perform(at(altar.id, planks.uid), game);
const motes = game.inventory.items.filter((it) => it.id === MOTE);
check('of a stack, one is given up, and a mote left of its rarity, said as the island says it',
  game.inventory.get(planks.uid)?.count === 2 && motes.some((m) => m.rare === 2) && lastSaid() === say('MOTESAID'), lastSaid());
const mote2 = motes.find((m) => m.rare === 2)!;
check('a mote is absorbed only from a mote', absorb.check?.({ kind: 'item', uid: plain.uid, mote: plain.uid }, game) === ABSORB_SAID.pickMote);
check('into something', absorb.check?.({ kind: 'item', uid: -1, mote: mote2.uid }, game) === ABSORB_SAID.pickItem);
check('never another mote', absorb.check?.({ kind: 'item', uid: mote2.uid, mote: mote2.uid }, game) === ABSORB_SAID.intoMote);
const bauble = game.inventory.add('bauble_minor', { ql: 40, extra: 'cooking: +2.1% skill gain' });
check('nor a bauble', absorb.check?.({ kind: 'item', uid: bauble.uid, mote: mote2.uid }, game) === ABSORB_SAID.bauble);
check('nor a thing already rare, in the island\'s words', absorb.check?.({ kind: 'item', uid: kept.uid, mote: mote2.uid }, game) === say('ALREADY'));
absorb.perform({ kind: 'item', uid: plain.uid, mote: mote2.uid }, game);
const planksNow = game.inventory.items.filter((it) => it.id === 'plank').map((it) => `${it.rare ? RARITIES[it.rare].name : 'plain'} x${it.count}`).sort();
check('one of an ordinary stack takes it, and the mote is used, said as the island says it',
  planksNow.includes('plain x4') && planksNow.some((p) => p.startsWith('supreme')) && !game.inventory.get(mote2.uid) && lastSaid() === say('ABSORBSAID'),
  `${planksNow.join(', ')} | ${lastSaid()}`);
const mote3 = rare(MOTE, 3);
const single = game.inventory.add('hatchet', { ql: 40 });
absorb.perform({ kind: 'item', uid: single.uid, mote: mote3.uid }, game);
check('a thing on its own takes it where it is', game.inventory.get(single.uid)?.rare === 3);

// And how often, in the browser, over many.
let left = 0;
const g2 = Game.create(99);
g2.player.x = 40.5; g2.player.y = 40.5;
const alt2 = g2.addFurniture('altar', 41, 40, 0, 0, 50);
const N = 20000;
const pile = g2.inventory.add('plank', { ql: 40, count: N });
const pileRare = g2.inventory.take(pile.uid, N)!;
pileRare.rare = 1;
g2.inventory.addItem(pileRare);
for (let i = 0; i < N; i++) sac.perform(at(alt2.id, pileRare.uid), g2);
left = g2.inventory.items.filter((it) => it.id === MOTE).reduce((n, it) => n + it.count, 0);
check(`about ${MOTE_CHANCE * 100}% of sacrifices leave a mote`, Math.abs(left / N - MOTE_CHANCE) < 0.004, `${left} of ${N}`);

for (const line of [...ok, ...bad]) console.log(line);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
if (bad.length) process.exit(1);
