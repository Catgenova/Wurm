/**
 * A field guide of the wildermon.
 *
 * Asked for: a field guide of the wildermon, one page per species, marking
 * whether you have seen, tamed and bred it, and where it lives.
 *
 * Asked of the browser:
 *
 *   * there is a page for every kind, and the counts are over the kinds each
 *     mark can be set on: seen over all of them, tamed and bred over all but
 *     the monsters;
 *   * where a kind lives is its own rules read out: each thing the ground has
 *     to be has its line and no line is there without it, and every number
 *     on the page is the rule's own;
 *   * what a kind is kept for is what its definition says, number for number;
 *   * a creature standing in view is marked seen, once and with a line, and
 *     one out of sight is not, nor one in a crate;
 *   * an offering that takes marks the kind tamed, and so does a catch got out
 *     of a trap; a young one born to a dam you keep marks it bred, and one
 *     born to a dam that is nobody's does not;
 *   * the book goes through a save and comes back;
 *   * and on an island the look hands a kind over rather than writing it
 *     down, and it is what the island says that goes in the book.
 *
 * And of the island:
 *
 *   * a kind handed over is taken while one stands near you out of a crate,
 *     and is answered for as had the second time; a kind with nothing of it
 *     near, one standing further off than a browser is told about, one in a
 *     crate and one there is no such thing as are all absent;
 *   * more kinds than one look may name are refused, and so is somebody not
 *     signed in and somebody not on the island;
 *   * an offering that takes, a catch got out of a trap and a birth to a dam
 *     somebody keeps write their marks, and a birth to a wild dam or one
 *     turned loose writes none;
 *   * `rpc_guide` hands back exactly the book, and only its owner's, which the
 *     browser takes as it comes;
 *   * and nobody reads or writes the table but through those two doors, which
 *     are a signed-in browser's to call while the mark itself is nobody's.
 *
 * Runs against the database the suite leaves behind: Hoarding, and Dane on it,
 * and puts it all back.
 */
import { execFileSync } from 'node:child_process';
// `game` first: the root of the module graph, so nothing below comes out half-built.
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import {
  HERD_REACH, MONSTER_CAP, MONSTER_KEEP_OFF, PULL_DEFAULT, SPECIES, WATER_RANGE, WILD_RANGE, type Creature, type SpeciesDef,
} from '../../src/game/creatures';
import {
  countsLine, FieldGuide, guideCounts, guidePage, guidePages, seenLine, whereItLives, wildShare,
} from '../../src/game/guide';
import { GUIDE_BATCH, MOBS_RANGE, PEACE_REACH } from '../../src/game/keep';
import { packLand, packWorld, unpack } from '../../src/game/save';
import { TILE_DEFS } from '../../src/world/tiles';
import { numberWord, percent, spanWords } from '../../src/game/words';

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
const sorted = (xs: Iterable<string>): string => [...xs].sort().join(',');

/* ---- the pages -------------------------------------------------------------- */
console.log('--- the pages');
const KINDS = Object.values(SPECIES);
const KEEPABLE = KINDS.filter((d) => !d.monster);
check('a page for every kind there is, in the order they are written', sorted(guidePages().map((d) => d.id)) === sorted(Object.keys(SPECIES))
  && guidePages().map((d) => d.id).join() === Object.keys(SPECIES).join(), `${guidePages().length} pages`);
const empty = guideCounts(new FieldGuide());
check('seen is counted over every kind, tamed and bred over all but the monsters',
  empty.kinds === KINDS.length && empty.keepable === KEEPABLE.length && KEEPABLE.length < KINDS.length,
  `${empty.kinds} and ${empty.keepable}`);

/** Every line a page has, flattened, for asking whether something is said. */
const says = (def: SpeciesDef, island = false): string => guidePage(def, island).flatMap((s) => s.lines).join(' | ');
const GRAZING = Object.values(TILE_DEFS).filter((t) => t.forage).map((t) => t.name.toLowerCase());

const where: string[] = [];
for (const d of KINDS) {
  const lines = whereItLives(d).join(' | ');
  const want: Array<[string, boolean, boolean]> = [
    ['over a seam', !!d.onOre, lines.includes('vein or a coal seam')],
    ['on sand', !!d.onSand, / on sand/.test(lines)],
    ['on bare rock', !!d.onStone, lines.includes('bare rock')],
    ['on the grazing ground', !d.onOre && !d.onSand && !d.onStone, GRAZING.every((t) => lines.includes(t))],
    [`within ${WATER_RANGE} tiles of something`, !!(d.nearWater || d.nearTrees || d.nearClay || d.nearTar), lines.includes(`Within ${WATER_RANGE} tiles of`)],
    ['by water', !!d.nearWater, /tiles of[^|]*water/.test(lines)],
    ['by trees', !!d.nearTrees, /tiles of[^|]*tree/.test(lines)],
    ['by clay', !!d.nearClay, /tiles of[^|]*clay/.test(lines)],
    ['by the black ground', !!d.nearTar, /tiles of[^|]*tar, peat or marsh/.test(lines)],
    ['only at night', !!d.nocturnal, lines.includes('only at night')],
    [`in herds within ${HERD_REACH}`, !d.hunter, lines.includes(`In herds: one put down within ${HERD_REACH} tiles`)],
    ['alone, a hunter', !!d.hunter, lines.includes('Alone: a hunter')],
    [`home within ${WILD_RANGE}`, true, lines.includes(`Keeps within ${WILD_RANGE} tiles of its home ground`)],
    [`1 in ${Math.round(1 / wildShare(d))}`, true, lines.includes(`1 in ${Math.round(1 / wildShare(d))} of what the wild puts down`)],
    [`off a token by ${MONSTER_KEEP_OFF[d.id]}`, !!d.monster, lines.includes(`Never within ${MONSTER_KEEP_OFF[d.id]} tiles of a settlement's token`)],
    [`no more than ${MONSTER_CAP[d.id]}`, !!d.monster, lines.includes(`No more than ${numberWord(MONSTER_CAP[d.id] ?? 0)} on the island at once`)],
    ['no quiet beach alone', false, lines.includes('comes ashore')],
  ];
  for (const [what, should, is] of want) if (should !== is) where.push(`${d.id} ${should ? 'lacks' : 'has'} ${what}`);
  const ashore = whereItLives(d, true).some((l) => l === `Never within ${PEACE_REACH} tiles of where everybody comes ashore`);
  if (ashore !== !!d.monster) where.push(`${d.id} ${d.monster ? 'lacks' : 'has'} the quiet beach on an island`);
}
check('where each kind lives is its own rules read out: every line is there for its rule and none without one, every number the rule\'s',
  !where.length, where.slice(0, 6).join('; '));
const share = KINDS.reduce((n, d) => n + wildShare(d), 0);
check('and the shares the pages quote are the whole of the wild\'s roll between them', Math.abs(share - 1) < 1e-9, share.toFixed(12));

const kept: string[] = [];
for (const d of KINDS) {
  const text = says(d);
  const want: Array<[string, boolean, boolean]> = [
    ['a fleece', !!d.fleece, /(Shorn|Plucked) with a carving knife/.test(text)],
    ['what it grows back in', !!d.fleece, !!d.fleece && text.includes(`back in full in ${spanWords(1 / d.fleece)}`)],
    ['milk', !!d.milk, text.includes('is milked into an empty bucket')],
    ['a hive', !!d.hives, text.includes('fills a hive')],
    ['a saddle', !!d.mount, text.includes('Carries a rider once it wears a saddle and a bridle')],
    ['deep water', !!d.swims, text.includes('across deep water')],
    ['the traces', !!d.draught, text.includes(`In the traces it adds ${percent(d.pull ?? PULL_DEFAULT)} to a team's pull`)],
    ['panniers', !!d.pannier, text.includes(`Carries ${d.pannier} things in panniers`)],
    ['a watcher\'s eyes', !!d.sight, text.includes(`Sees ${d.sight} tiles for you`)],
    ['a light', !!d.glow, text.includes(`Lights ${d.glow} tiles round itself`)],
    ['its temper', !!d.unruly, !!d.unruly && text.includes(`${percent(d.unruly)} odds`)],
    ['its taming', !d.monster, text.includes(`Taming ${d.tameLevel} to try, and at that a base ${percent(d.tameChance)} chance`)],
    ['that it is not a wildermon', !!d.monster, text.includes('cannot be tamed, trapped, bred or kept')],
    ['its body', true, text.includes(`Grown: ${d.health} health, hits for ${d.attack}`)],
    ['its carcass', Object.values(d.butcher).some((n) => !!n), Object.entries(d.butcher).filter(([p]) => p !== 'hoard').every(([, n]) => text.includes(`${n} × `))],
  ];
  for (const [what, should, is] of want) if (should !== is) kept.push(`${d.id} ${should ? 'lacks' : 'has'} ${what}`);
}
check('what a kind is for, and what it is like to meet, is what its definition says, number for number',
  !kept.length, kept.slice(0, 6).join('; '));

/* ---- the browser ------------------------------------------------------------ */
console.log('--- the browser');
const game = Game.create(4242);
game.rand = (): number => 0;
game.settings.fog = true;
for (const c of [...game.creatures.list.values()]) game.creatures.remove(c.id);
const { x: px, y: py } = game.player;
/** A tile at least this far from the body that is on the island, for something out of sight. */
const far = (d: number): [number, number] => {
  for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d]]) {
    const x = Math.floor(px) + dx;
    const y = Math.floor(py) + dy;
    if (game.world.inBounds(x, y)) return [x + 0.5, y + 0.5];
  }
  throw new Error('no ground that far off');
};
const put = (species: string, x: number, y: number, mode: Creature['mode'] = 'wild'): Creature =>
  game.creatures.spawn(species, x, y, mode, game.rand, 0);
const woola = put('woola', px + 1.5, py);
const [fx, fy] = far(MOBS_RANGE);
const lume = put('lume', fx, fy);
const quill = put('quill', px + 0.5, py, 'stored');
game.log.length = 0;
game.update(1.1);
check('the body can see the one beside it and not the one far off', game.vision.isWatched(woola.x, woola.y) && !game.vision.isWatched(lume.x, lume.y));
check('a creature standing in view is marked seen', game.guide.seen.has('woola'), sorted(game.guide.seen));
check('and one out of sight is not, nor one in a crate beside you', !game.guide.seen.has('lume')
  && quill.mode === 'stored' && game.vision.isWatched(quill.x, quill.y) && !game.guide.seen.has('quill'), sorted(game.guide.seen));
const line = seenLine(SPECIES.woola, game.guide);
check('and the log says so, in the words both sides use', game.log.filter((l) => l.text === line).length === 1,
  game.log.map((l) => l.text).join(' | '));
game.update(1.1);
check('once: a kind already in the book is not said again', game.log.filter((l) => l.text === line).length === 1);

// An offering that takes.
const rabba = put('rabba', px + 0.6, py);
game.inventory.add('blueberry', { count: 3 });
const at = (c: Creature): Target => ({ kind: 'creature', id: c.id });
ACTION_BY_ID.get('tame')?.perform(at(rabba), game);
check('an offering that takes marks the kind tamed, and seen with it', rabba.mode !== 'wild' && game.guide.tamed.has('rabba') && game.guide.seen.has('rabba'),
  `${rabba.mode}, tamed ${sorted(game.guide.tamed)}`);

// A catch got out of the noose, with the rabba off somewhere so there is room for it.
rabba.mode = 'wild';
const vola = put('vola', px + 0.4, py + 0.4);
const trap = game.addTrap('snare', Math.floor(px), Math.floor(py), 0, 0, 60);
trap.caught = vola.id;
vola.trapped = trap.id;
game.skills.values.set('taming', 60);
ACTION_BY_ID.get('take_catch')?.perform({ kind: 'trap', id: trap.id } as Target, game);
check('a catch got out of a trap marks the kind tamed too', trap.caught === null && game.guide.tamed.has('vola'), `caught ${trap.caught}, tamed ${sorted(game.guide.tamed)}`);

// Births: to a dam that is kept, and to one that is nobody's.
vola.mode = 'wild';
const dam = put('cudda', px + 1, py + 1, 'deed');
dam.unborn = { traits: [], sex: 'female' };
dam.due = game.time;
game.creatures.giveBirth(game, dam);
check('a young one born to a dam you keep marks the kind bred', game.guide.bred.has('cudda') && game.guide.seen.has('cudda'), sorted(game.guide.bred));
const wildDam = put('sedra', fx, fy);
wildDam.unborn = { traits: [], sex: 'female' };
wildDam.due = game.time;
game.creatures.giveBirth(game, wildDam);
check('and one born to a dam that is nobody\'s does not', !game.guide.bred.has('sedra') && !game.guide.seen.has('sedra'), sorted(game.guide.bred));

check('the counts over the index are the book\'s', countsLine(game.guide) === `Seen 4 of ${KINDS.length} · Tamed 2 of ${KEEPABLE.length} · Bred 1 of ${KEEPABLE.length}`,
  countsLine(game.guide));

// A save, and back.
const back = await unpack(await packLand(game), JSON.parse(JSON.stringify(packWorld(game))));
check('the book goes through a save and comes back', !!back && JSON.stringify(back.guide.toJSON()) === JSON.stringify(game.guide.toJSON()),
  JSON.stringify(back?.guide.toJSON()));
const old = await unpack(await packLand(game), { ...(JSON.parse(JSON.stringify(packWorld(game))) as object), guide: undefined });
check('and a save from before there was a book opens on an empty one', !!old && old.guide.seen.size === 0);

// On an island: handed over, and only what the island says goes in the book.
const isle = Game.create(4242);
for (const c of [...isle.creatures.list.values()]) isle.creatures.remove(c.id);
const handed: string[] = [];
isle.guideSaw = (id) => handed.push(id);
isle.creatures.spawn('woola', isle.player.x + 1.5, isle.player.y, 'wild', isle.rand, 0);
isle.creatures.spawn('woola', isle.player.x - 1.5, isle.player.y, 'wild', isle.rand, 0);
isle.log.length = 0;
isle.update(1.1);
check('on an island a kind in view is handed over, once a look however many of it there are, and not written down here',
  handed.join() === 'woola' && !isle.guide.seen.has('woola'), `${handed.join()}; ${sorted(isle.guide.seen)}`);
isle.guideHeard(['woola'], ['rabba']);
check('what the island wrote down just now goes in the book with its line; what it had already, without one',
  isle.guide.seen.has('woola') && isle.guide.seen.has('rabba')
    && isle.log.filter((l) => l.text.startsWith('The first ')).map((l) => l.text).join() === seenLine(SPECIES.woola, isle.guide),
  isle.log.map((l) => l.text).join(' | '));
handed.length = 0;
isle.update(1.1);
check('and a kind the book has is not handed over again', !handed.length, handed.join());

/* ---- the island ------------------------------------------------------------- */
console.log('--- the island');
const STRANGER = 'd9d9d9d9-d9d9-d9d9-d9d9-d9d9d9d9d9d9';
/** One kind more than a look may name. */
const TOO_MANY = Object.keys(SPECIES).slice(0, GUIDE_BATCH + 1);
const said = psql(`
begin;
create temp table said (k text, v text);
do $$
declare w uuid; dane uuid; them uuid; v_x double precision; v_y double precision; v_id int; v_trap bigint; v_i int;
begin
  select id into w from world where name = 'Hoarding';
  select uid into dane from player where world_id = w and name = 'Dane';
  perform set_config('request.jwt.claims', json_build_object('sub', dane)::text, true);
  update player set act = null, act_queue = '[]'::jsonb where world_id = w and uid = dane;
  select x, y into v_x, v_y from player where world_id = w and uid = dane;
  delete from guide where world_id = w and uid = dane;
  -- Nothing of any kind the test uses anywhere on the island but what it puts down itself.
  delete from creature where world_id = w
    and species in ('woola', 'lume', 'quill', 'rabba', 'vola', 'cudda', 'sedra', 'holla');
  -- And nothing following him, so a tamed one has somewhere to go.
  update creature set mode = 'wild', keeper = null where world_id = w and keeper = dane and mode in ('active', 'stored');

  -- Sightings.
  perform creature_spawn(w, 'woola', v_x + 3, v_y, 'wild', now() - interval '3 hours');
  perform creature_spawn(w, 'lume', v_x + ${MOBS_RANGE} + 10, v_y, 'wild', now() - interval '3 hours');
  v_id := creature_spawn(w, 'quill', v_x, v_y, 'active', now() - interval '3 hours', dane);
  update creature set mode = 'stored' where world_id = w and id = v_id;
  insert into said values ('FIRST', rpc_guide_seen(w, array['woola', 'woola', 'lume', 'quill', 'nosuch'])::text);
  insert into said values ('AGAIN', rpc_guide_seen(w, array['woola'])::text);
  insert into said values ('ROWS', (select string_agg(species || ':' || tamed || ':' || bred, ',' order by species)
    from guide where world_id = w and uid = dane));
  begin
    perform rpc_guide_seen(w, array[${TOO_MANY.map((s) => `'${s}'`).join(', ')}]);
    insert into said values ('TOO_MANY', 'allowed');
  exception when others then insert into said values ('TOO_MANY', sqlerrm);
  end;
  perform set_config('request.jwt.claims', '', true);
  begin
    perform rpc_guide_seen(w, array['woola']);
    insert into said values ('NOBODY', 'allowed');
  exception when others then insert into said values ('NOBODY', sqlerrm);
  end;
  begin
    perform rpc_guide(w);
    insert into said values ('NOBODY_READS', 'allowed');
  exception when others then insert into said values ('NOBODY_READS', sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', '${STRANGER}')::text, true);
  begin
    perform rpc_guide_seen(w, array['woola']);
    insert into said values ('STRANGER', 'allowed');
  exception when others then insert into said values ('STRANGER', sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', dane)::text, true);

  -- A catch got out of the noose.
  insert into skill (world_id, uid, id, value) values (w, dane, 'taming', 60)
    on conflict (world_id, uid, id) do update set value = 60;
  v_id := creature_spawn(w, 'vola', v_x + 0.6, v_y, 'wild', now() - interval '3 hours');
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, caught)
    values (w, 'trap', 'snare', floor(v_x)::int, floor(v_y)::int, 0, 0, floor(v_x) + 0.5, floor(v_y) + 0.5, 60, dane, v_id)
    returning id into v_trap;
  update creature set trapped = v_trap where world_id = w and id = v_id;
  for v_i in 1..20 loop
    exit when (select caught from placed where id = v_trap) is null;
    perform act_perform(w, dane, 'take_catch', jsonb_build_object('kind', 'trap', 'id', v_trap));
  end loop;
  insert into said values ('TRAPPED', (select coalesce(caught::text, 'out') from placed where id = v_trap) || '|'
    || coalesce((select tamed::text from guide where world_id = w and uid = dane and species = 'vola'), 'no row'));
  update creature set mode = 'wild', keeper = null where world_id = w and keeper = dane and mode in ('active', 'stored');
  delete from placed where id = v_trap;

  -- An offering that takes.
  perform give(w, dane, 'blueberry', 40, 40);
  v_id := creature_spawn(w, 'rabba', v_x + 0.6, v_y, 'wild', now() - interval '3 hours');
  for v_i in 1..40 loop
    exit when (select mode from creature where world_id = w and id = v_id) <> 'wild';
    perform act_perform(w, dane, 'tame', jsonb_build_object('kind', 'creature', 'id', v_id));
  end loop;
  insert into said values ('TAMED', (select mode from creature where world_id = w and id = v_id) || '|'
    || coalesce((select tamed::text from guide where world_id = w and uid = dane and species = 'rabba'), 'no row'));
  update creature set mode = 'wild', keeper = null where world_id = w and keeper = dane and mode in ('active', 'stored');

  -- Births: to a dam he keeps, to one that is nobody's, and to one of his turned loose.
  v_id := creature_spawn(w, 'cudda', v_x + 1, v_y + 1, 'deed', now() - interval '3 hours', dane);
  update creature set sex = 'female', unborn = '{"traits": [], "sex": "female"}'::jsonb, due = now() - interval '1 second'
    where world_id = w and id = v_id;
  perform give_birth(w, v_id);
  v_id := creature_spawn(w, 'sedra', v_x + 1, v_y - 1, 'wild', now() - interval '3 hours');
  update creature set sex = 'female', unborn = '{"traits": [], "sex": "female"}'::jsonb, due = now() - interval '1 second'
    where world_id = w and id = v_id;
  perform give_birth(w, v_id);
  v_id := creature_spawn(w, 'holla', v_x - 1, v_y + 1, 'wild', now() - interval '3 hours', dane);
  update creature set sex = 'female', unborn = '{"traits": [], "sex": "female"}'::jsonb, due = now() - interval '1 second'
    where world_id = w and id = v_id;
  perform give_birth(w, v_id);
  insert into said values ('BRED', (select string_agg(species || ':' || tamed || ':' || bred, ',' order by species)
    from guide where world_id = w and uid = dane));

  -- Somebody else's book, on the same island, which is theirs to read and nobody else's.
  select uid into them from player where world_id = w and uid <> dane order by uid limit 1;
  delete from guide where world_id = w and uid = them;
  perform guide_mark(w, them, 'dragon', 'seen');
  insert into said values ('BOOK', rpc_guide(w)::text);
  perform set_config('request.jwt.claims', json_build_object('sub', them)::text, true);
  insert into said values ('THEIRS', rpc_guide(w)::text);
  perform set_config('request.jwt.claims', json_build_object('sub', dane)::text, true);

  -- Nobody else's door onto it.
  insert into said values ('LOCKED', (select case when relrowsecurity then 'on' else 'OPEN' end from pg_class where relname = 'guide')
    || '|' || (select count(*) from pg_policies where tablename = 'guide')
    || '|' || coalesce((select string_agg(distinct privilege_type, ',') from information_schema.role_table_grants
                         where table_name = 'guide' and grantee in ('anon', 'authenticated')), 'nothing'));
  insert into said values ('DOORS', has_function_privilege('authenticated', 'rpc_guide_seen(uuid, text[])', 'execute')
    || '|' || has_function_privilege('authenticated', 'rpc_guide(uuid)', 'execute')
    || '|' || has_function_privilege('anon', 'rpc_guide(uuid)', 'execute')
    || '|' || has_function_privilege('authenticated', 'guide_mark(uuid, uuid, text, text)', 'execute'));
end $$;
select k || '|' || coalesce(v, 'NULL') from said;
rollback;
`);
const answer = (key: string): string => said.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

const first = JSON.parse(answer('FIRST')) as { added: string[]; had: string[]; absent: string[] };
check('a kind handed over is taken while one stands near you, and a kind named twice is named once', first.added?.join() === 'woola' && !first.had?.length,
  answer('FIRST'));
check(`and one further off than the ${MOBS_RANGE} tiles a browser is told about, one in a crate and one there is no such thing as are absent`,
  first.absent?.join() === 'lume,nosuch,quill', answer('FIRST'));
check('handed over again, it is had rather than added, and nothing more is written', answer('AGAIN') === '{"had": ["woola"], "added": [], "absent": []}'
  && answer('ROWS') === 'woola:false:false', `${answer('AGAIN')} ${answer('ROWS')}`);
check(`more kinds than one look may name, which is ${GUIDE_BATCH}, are refused`, answer('TOO_MANY').startsWith('that is more kinds than one look hands over'),
  answer('TOO_MANY'));
check('and so is somebody not signed in, handing over or reading', answer('NOBODY') === 'not signed in' && answer('NOBODY_READS') === 'not signed in',
  `${answer('NOBODY')} / ${answer('NOBODY_READS')}`);
check('and somebody not on the island', answer('STRANGER') === 'you are not on this island', answer('STRANGER'));
check('a catch got out of a trap on the island marks the kind tamed', answer('TRAPPED') === 'out|true', answer('TRAPPED'));
check('an offering that takes on the island marks the kind tamed', answer('TAMED') === 'active|true', answer('TAMED'));
check('a birth to a dam he keeps marks the kind bred; to a wild dam or one of his turned loose, nothing',
  answer('BRED') === 'cudda:false:true,rabba:true:false,vola:true:false,woola:false:false', answer('BRED'));
const book = JSON.parse(answer('BOOK')) as { seen: string[]; tamed: string[]; bred: string[] };
check('rpc_guide hands back exactly the book', answer('BOOK') === '{"bred": ["cudda"], "seen": ["cudda", "rabba", "vola", "woola"], "tamed": ["rabba", "vola"]}',
  answer('BOOK'));
check('and only its owner\'s: somebody else on the island reads theirs, and neither reads the other\'s',
  answer('THEIRS') === '{"bred": [], "seen": ["dragon"], "tamed": []}', answer('THEIRS'));
const read = FieldGuide.fromJSON(book);
check('and the browser takes it as it comes', sorted(read.seen) === 'cudda,rabba,vola,woola' && sorted(read.tamed) === 'rabba,vola' && sorted(read.bred) === 'cudda'
  && countsLine(read) === `Seen 4 of ${KINDS.length} · Tamed 2 of ${KEEPABLE.length} · Bred 1 of ${KEEPABLE.length}`, countsLine(read));
check('nobody reads or writes the table but through the two doors', answer('LOCKED') === 'on|0|nothing', answer('LOCKED'));
check('and those two are a signed-in browser\'s to call, and the mark itself is nobody\'s', answer('DOORS') === 'true|true|false|false',
  answer('DOORS'));

for (const l of [...ok, ...bad]) console.log(l);
console.log(`a field guide of the wildermon — ${ok.length} of ${ok.length + bad.length}`);
if (bad.length) process.exit(1);
