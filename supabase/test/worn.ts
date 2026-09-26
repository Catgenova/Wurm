/**
 * What everybody on an island has on.
 *
 * A body is drawn in what it wears, and somebody else's pack is not yours to
 * read, so `rpc_worn` says what each body on the island has on: which thing
 * in each slot, how rare, what it is made of and the colour it took, and
 * nothing else about it.
 *
 * Anna wears a rare iron helm, a madder-dyed cloth tunic and holds a
 * fantastic steel sword; a pair of boots she has put down is still written
 * in her `equipped`. Bran, on the same island, asks: he is told her helm,
 * tunic and sword each as [def, rarity, material, dye] and not the boots she
 * no longer holds, and nothing of their quality. Somebody with no body on the
 * island is told nothing, nobody signed in is refused, and a signed-in
 * browser may call it at all. And what arrives is read in the browser only as
 * far as our own tables go: a thing, a slot, a material or a dye we do not
 * know draws nothing.
 *
 * Runs against the database the suite leaves behind and tidies itself away.
 */
import { execFileSync } from 'node:child_process';
import { gearFrom, wornWire } from '../../src/game/worn';

const ENV = {
  ...process.env,
  PGHOST: process.env.PGHOST ?? '/var/run/postgresql',
  PGPORT: process.env.PGPORT ?? '5433',
  PGUSER: process.env.PGUSER ?? 'wurm',
  PGDATABASE: process.env.PGDATABASE ?? 'postgres',
};
const ARGS = ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'];
const psql = (sql: string): string => execFileSync('psql', ARGS, { input: sql, encoding: 'utf8', env: ENV }).trim();
const fails = (sql: string): string => {
  try {
    execFileSync('psql', ARGS, { input: sql, encoding: 'utf8', env: ENV, stdio: ['pipe', 'pipe', 'pipe'] });
    return '';
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? e);
  }
};

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const ANNA = 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1';
const BRAN = 'e2e2e2e2-e2e2-e2e2-e2e2-e2e2e2e2e2e2';
const CARA = 'e3e3e3e3-e3e3-e3e3-e3e3-e3e3e3e3e3e3';
const world = psql(`select id from world where name = 'Hoarding';`);
const as = (uid: string): string => `select set_config('request.jwt.claims', json_build_object('sub', '${uid}')::text, false) \\g /dev/null`;
const tidy = `
delete from item where world_id = '${world}' and (holder_uid in ('${ANNA}', '${BRAN}') or (holder = 'ground' and def = 'leather_boots' and ql = 41.5));
delete from player where world_id = '${world}' and uid in ('${ANNA}', '${BRAN}');
`;
try {
  psql(`
${tidy}
insert into player (world_id, uid, name, x, y) values ('${world}', '${ANNA}', 'Anna', 8.5, 8.5), ('${world}', '${BRAN}', 'Bran', 9.5, 8.5);
with made as (
  insert into item (world_id, holder, holder_uid, def, ql, count, extra, rare, dye) values
    ('${world}', 'player', '${ANNA}', 'helm', 37.25, 1, 'Iron', 'rare', null),
    ('${world}', 'player', '${ANNA}', 'cloth_tunic', 22.5, 1, null, null, 'madder'),
    ('${world}', 'player', '${ANNA}', 'sword', 61.75, 1, 'Steel', 'fantastic', null),
    ('${world}', 'ground', null, 'leather_boots', 41.5, 1, null, null, null)
  returning id, def
)
update player set equipped = (select jsonb_object_agg(case def when 'helm' then 'head' when 'cloth_tunic' then 'chest'
                                                               when 'sword' then 'weapon' else 'feet' end, id) from made)
 where world_id = '${world}' and uid = '${ANNA}';
`);
  const told = JSON.parse(psql(`${as(BRAN)}\nselect rpc_worn('${world}');`) || '{}') as Record<string, Record<string, unknown[]>>;
  const hers = told[ANNA] ?? {};
  check('somebody on the island is told what another body has on', Object.keys(hers).sort().join(',') === 'chest,head,weapon',
    Object.keys(hers).sort().join(','));
  check('each piece as its def, how rare, what it is made of and its dye',
    JSON.stringify(hers.head) === '["helm",1,"Iron",null]' && JSON.stringify(hers.chest) === '["cloth_tunic",0,null,"madder"]'
      && JSON.stringify(hers.weapon) === '["sword",3,"Steel",null]',
    `${JSON.stringify(hers.head)} ${JSON.stringify(hers.chest)} ${JSON.stringify(hers.weapon)}`);
  check('and not a thing put down that is still written as worn', !('feet' in hers));
  check('and nothing of its quality', !JSON.stringify(told).includes('37.25') && !JSON.stringify(told).includes('61.75'));
  check('a body with nothing on is left out', !(BRAN in told), Object.keys(told).join(','));
  check('somebody with no body on the island is told nothing', psql(`${as(CARA)}\nselect rpc_worn('${world}');`) === '{}');
  check('nobody signed in is refused', /not signed in/.test(fails(`select set_config('request.jwt.claims', '', false) \\g /dev/null\nselect rpc_worn('${world}');`)));
  check('a signed-in browser may ask', psql(`${as(BRAN)}\nset role authenticated;\nselect rpc_worn('${world}') ? '${ANNA}';`) === 't');
  check('an anonymous one may not', /permission denied/.test(fails(`set role anon;\nselect rpc_worn('${world}');`)));

  // What the browser makes of it: the island's answer drawn as it says, the dye a colour out of our own table.
  const drawn = gearFrom(hers);
  check('the browser draws what the island says, in our own colours',
    drawn?.head?.id === 'helm' && drawn.head.rare === 1 && drawn.head.material === 'iron'
      && drawn.chest?.dye === '#a63f36' && drawn.weapon?.rare === 3 && drawn.weapon.material === 'steel',
    JSON.stringify(drawn));
  const junk = gearFrom({
    head: ['sword', 1, 'Iron', null], chest: ['no_such_thing', 0, null, null], weapon: ['sword', 7, 'Unobtainium', 'blood'],
    legs: 'plate_legs', feet: ['plate_boots', 1.5, 'Steel', '#ff0000'], offhand: [42], belt: ['toolbelt', -2, null, null],
  });
  check('and nothing it does not know: a thing in the wrong slot, a thing, a material or a dye it has never heard of',
    JSON.stringify(junk) === JSON.stringify({ feet: { id: 'plate_boots', material: 'steel' }, weapon: { id: 'sword', rare: 3 }, belt: { id: 'toolbelt' } }),
    JSON.stringify(junk));
  check('what the browser sends is what the island would say', JSON.stringify(wornWire((slot) => (slot === 'head'
    ? { id: 'helm', rare: 1, extra: 'Iron' } : slot === 'chest' ? { id: 'cloth_tunic', dye: 'madder' } : undefined)))
    === JSON.stringify({ head: hers.head, chest: hers.chest }));
} finally {
  psql(tidy);
}

for (const line of [...ok, ...bad]) console.log(line);
console.log(`what everybody has on — ${ok.length} of ${ok.length + bad.length}`);
if (bad.length) process.exit(1);
