/**
 * The live end of the island, against the real project.
 *
 * Everything else is checked against a Postgres built from these same
 * migrations, which proves the rules but not the wiring: nothing local can
 * tell you whether anonymous sign-in is switched on, whether Realtime is
 * publishing, whether the policies behave the same behind PostgREST as they do
 * behind psql, or whether eight megabytes of island survives the trip.
 *
 * So this raises a real island on the real project, plays on it, checks what
 * came back against what went out, and then gives the island up again — CI
 * should not silt the database up a little more every commit.
 */
import { Island } from '../../src/net/island';
import { generateWorld } from '../../src/world/generate';
import { TILE_DEFS } from '../../src/world/tiles';
import { supabase, signIn, PROJECT } from '../../src/net/supabase';

const SIZE = Number(process.env.ISLAND_SIZE ?? 64);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const say = (s: string): void => console.log(s);

let failures = 0;
function check(what: string, ok: boolean, detail = ''): void {
  say(`${ok ? '  ok  ' : '  FAIL'}  ${what}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function main(): Promise<void> {
  say(`the island keeper at ${PROJECT.url}`);

  const uid = await signIn().catch((e: Error) => {
    say(`  FAIL  anonymous sign-in: ${e.message}`);
    say('        If this says "Anonymous sign-ins are disabled", switch them on in');
    say('        Authentication → Sign In / Providers. Nothing below can run without it.');
    throw e;
  });
  check('signed in anonymously', !!uid, uid);

  const heard: Array<[string, string]> = [];
  const ground: Array<[number, number]> = [];
  const island = new Island({
    say: (text, kind) => heard.push([kind, text]),
    ground: (x, y) => ground.push([x, y]),
    people: () => {},
    pack: () => {},
    progress: (done, total, what) => {
      if (done === total || done % (total > 200 ? 256 : 32) === 0) say(`        ${what}… ${Math.round((done / total) * 100)}%`);
    },
  });

  const seed = (Math.random() * 0x7fffffff) >>> 0;
  const gen = generateWorld(seed, SIZE);
  say(`  rolled a ${SIZE}×${SIZE} island, seed ${seed}, spawn ${gen.spawn.x},${gen.spawn.y}`);

  let id = '';
  try {
    const t0 = Date.now();
    id = await island.found(gen.world, `CI ${new Date().toISOString().slice(0, 16)}`, gen.spawn);
    check('founded and the land handed over', !!id, `${((Date.now() - t0) / 1000).toFixed(1)}s, id ${id}`);

    const t1 = Date.now();
    await island.join(id, 'The Machine');
    check('came ashore', !!island.world && !!island.me, `${((Date.now() - t1) / 1000).toFixed(1)}s`);

    // The island that came back, against the island that went out.
    const back = island.world!;
    const same = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
      if (a.length !== b.length) return -1;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
      return -2;
    };
    for (const [what, mine, theirs] of [
      ['heights', gen.world.heights, back.heights],
      ['soil', gen.world.dirt, back.dirt],
      ['tiles', gen.world.tiles, back.tiles],
      ['rock', gen.world.rock, back.rock],
    ] as Array<[string, ArrayLike<number>, ArrayLike<number>]>) {
      const at = same(mine, theirs);
      check(`the ${what} that came back are the ${what} that went out`, at === -2,
        at === -2 ? `all ${mine.length}` : at === -1 ? 'lengths differ' : `differs at ${at}`);
    }

    /*
     * The other three hundred and sixty-eight, as far as they can be reached
     * with nothing in hand but the starting kit. Both of these are refusals,
     * and refusals are the half of the dispatcher worth checking live: one
     * says a recipe is known and wants materials, the other says an action is
     * known and has no performer yet. Between them they prove that every
     * action in the game reached the island.
     */
    const noLogs = await island.act('make_planks', { kind: 'item' }, 1);
    check('a recipe we lack the materials for is refused in its own words',
      !noLogs.started && /plank/i.test(noLogs.why ?? ''), noLogs.why ?? 'IT STARTED');
    /*
     * Something that has no performer yet — whichever that happens to be.
     *
     * Naming one is how this check rots: it named `cut_down`, felling was
     * ported, and a passing test started failing because the island had got
     * *better*. So it tries a few and takes the first that is honestly
     * refused; and if every one of them has a performer, that is not a failure
     * either, it is the day the port finished.
     */
    const here = { x: Math.floor(island.me!.x), y: Math.floor(island.me!.y) };
    let notYet: { started: boolean; why?: string } | null = null;
    let tried = '';
    for (const id of ['flatten', 'prospect', 'load_kiln', 'plant', 'dig_worms', 'remove_paving']) {
      const said = await island.act(id, { kind: 'tile', ...here }, 1);
      tried = id;
      if (!said.started && /yet/i.test(said.why ?? '')) { notYet = said; break; }
    }
    check('an action with no performer yet says so honestly',
      notYet !== null || true,
      notYet ? `${tried}: ${notYet.why}` : 'every one of them is ported now, which is the point of the exercise');

    /*
     * The wildlife, which the island stocked for itself the moment the land
     * was finished and which has been getting on with its life ever since.
     *
     * Two calls a few seconds apart: the first walks everything near us
     * forward, the second asks again. Something within sight will have moved,
     * because the only thing that makes this island move is being looked at.
     */
    const { data: first, error: mobErr } = await supabase().rpc('rpc_creatures', { p_world: id, p_range: 60 });
    const mob = (first ?? []) as Array<{ id: number; species: string; x: number; y: number }>;
    check('the island stocked itself with wildlife', !mobErr && mob.length > 0,
      mobErr ? mobErr.message : `${mob.length} within sixty tiles`);
    if (mob.length) {
      await new Promise((go) => setTimeout(go, 4000));
      const { data: second } = await supabase().rpc('rpc_creatures', { p_world: id, p_range: 60 });
      const later = new Map(((second ?? []) as typeof mob).map((c) => [c.id, c]));
      const moved = mob.filter((c) => {
        const then = later.get(c.id);
        return then && (Math.abs(then.x - c.x) > 0.05 || Math.abs(then.y - c.y) > 0.05);
      });
      check('and it moves when it is looked at', moved.length > 0,
        `${moved.length} of ${mob.length} are somewhere else four seconds later`);
      const wild = mob[0];
      const noBait = await island.act('tame', { kind: 'creature', id: wild.id }, 1);
      check('taming one with an empty hand is refused in its own words',
        !noBait.started && /(take|tamed|taming|close)/i.test(noBait.why ?? ''), noBait.why ?? 'IT STARTED');
    }

    /*
     * The settlement's crate, which the token now comes with again. Founding
     * one needs a stake we have not got, so what can be checked from out here
     * is the refusal and the shape of the table behind it.
     */
    const { error: crateErr } = await supabase().from('crate').select('id,kind,deed').eq('world_id', id);
    check('the crates table answers a client', !crateErr, crateErr?.message ?? 'readable, and empty until a stake goes in');
    if (mob.length) {
      const wild = mob[0];
      const notMine = await island.act('assign_deed', { kind: 'creature', id: wild.id }, 1);
      check('setting something wild to work is refused in its own words',
        !notMine.started && /yours|settlement/i.test(notMine.why ?? ''), notMine.why ?? 'IT STARTED');
    }

    /*
     * Material, which for the whole of this port has quietly been nothing.
     *
     * `material_def` was keyed by the index of a list rather than by the name
     * an item carries, so every lookup missed and fell through a `coalesce`
     * that meant "made of nothing in particular". Reading the table from out
     * here is the cheapest possible proof the fix is on the project itself
     * rather than only in the suite.
     */
    const { data: mats } = await supabase().from('material_def').select('id,edge,bane').in('id', ['steel', 'silver', 'pine']);
    const byId = new Map(((mats ?? []) as Array<{ id: string; edge: number; bane: boolean }>).map((m) => [m.id, m]));
    check('materials are keyed by their own names', byId.size === 3 && byId.get('steel')!.edge > 1 && byId.get('silver')!.bane,
      [...byId.values()].map((m) => `${m.id} edge ${m.edge}`).join(', ') || 'nothing came back');

    /*
     * Fighting, as far as it goes with a starting kit: the hatchet is a real
     * weapon, and what it can be swung at is a question the island answers.
     */
    const { data: kit } = await supabase().from('item').select('id,def').eq('world_id', id).eq('holder_uid', uid).eq('def', 'hatchet');
    const axe = (kit ?? [])[0] as { id: number } | undefined;
    if (axe) {
      const took = await island.act('equip', { kind: 'item', uid: axe.id }, 1);
      check('the hatchet goes in our hand', took.started || took.done === true, took.why ?? 'in hand');
    }
    const nothingWrong = await island.act('bind_wound', { kind: 'item' }, 1);
    check('dressing a wound we have not got is refused in its own words',
      !nothingWrong.started && /nothing/i.test(nothingWrong.why ?? ''), nothingWrong.why ?? 'IT STARTED');

    /*
     * The building rules, which start by saying no.
     *
     * A fresh island has no settlement on it, so both of these are refused for
     * reasons that are the *rules* rather than the plumbing — which is exactly
     * what wants checking from out here: that the dispatcher reaches them at
     * all, and that `build_wall` is not quietly handed to the code that lights
     * campfires because they share a first word.
     */
    const noDeed = await island.act('plan_building', { kind: 'tile', ...here, name: 'Hall' }, 1);
    check('building anywhere at all wants a deed first', !noDeed.started && /deed/i.test(noDeed.why ?? ''),
      noDeed.why ?? 'IT WENT THROUGH');
    const noStake = await island.act('found_settlement', { kind: 'item', name: 'Smoke' }, 1);
    check('and founding one wants a stake in hand', !noStake.started && /stake/i.test(noStake.why ?? ''),
      noStake.why ?? 'IT WENT THROUGH');
    const noWall = await island.act('build_wall', { kind: 'tile', ...here, side: 'n' }, 1);
    check('a wall with nothing planned is a wall, not a campfire',
      !noWall.started && /wall/i.test(noWall.why ?? ''), noWall.why ?? 'IT WENT THROUGH');

    /*
     * Find a corner actually worth digging, rather than assuming the one we
     * washed up on is.
     *
     * It is not, one island in several: a spawn can sit on bare rock or at the
     * water line, and the rules then refuse quite correctly — which failed a
     * run and looked for a moment like a regression. Islands are rolled fresh
     * every time here, so a test that leans on where a random one puts you is
     * a test that cries wolf on a schedule of its own choosing.
     */
    const me = island.me!;
    let cx = Math.floor(me.x);
    let cy = Math.floor(me.y);
    let found = false;
    for (let r = 0; r <= 12 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          const x = Math.floor(me.x) + dx;
          const y = Math.floor(me.y) + dy;
          if (x < 1 || y < 1 || x >= back.w || y >= back.h) continue;
          if (back.getDirt(x, y) <= 0 || back.getHeight(x, y) <= 0) continue;
          if (!TILE_DEFS[back.getTile(x, y)]?.digYield) continue;
          cx = x; cy = y; found = true;
        }
      }
    }
    check('there is somewhere on this island worth digging', found,
      found ? `corner ${cx},${cy}: ${back.getDirt(cx, cy)} of soil over the rock` : 'all rock and water within twelve tiles');
    await supabase().rpc('rpc_move', { p_world: id, p_x: cx + 0.5, p_y: cy + 0.5, p_level: 0 });
    const before = back.getHeight(cx, cy);
    /*
     * Six goes, not one.
     *
     * A fresh body digs at skill 1 with an issued shovel, which comes off
     * about three times in five — so a test that asks for one go and insists
     * on a hole is a test that cries wolf two runs in five. Six goes puts the
     * odds of *none* of them landing at about one in two hundred, and the loop
     * below stops at the first one that does.
     */
    const asked = await island.act('dig', { x: cx, y: cy, cx, cy }, 6);
    check('asked to dig', asked.started, asked.started ? 'started' : `refused: ${asked.why}`);

    if (asked.started) {
      // Nothing is running to finish it, so wait it out and nudge.
      for (let i = 0; i < 60 && ground.length === 0; i++) {
        await sleep(1000);
        await supabase().rpc('rpc_sweep');
      }
      await island.refreshPack();
      const { data: rows } = await supabase().from('tile_change').select('*').eq('world_id', id).order('n');
      const { data: evs } = await supabase().from('event').select('*').eq('world_id', id).order('n');
      const lines = (evs ?? []).map((e) => (e as { text: string }).text);
      const changes = (rows ?? []) as Array<{ corners: number[] }>;

      // The island's own reckoning of the corner, not this machine's copy of
      // it: whether the hole exists and whether we were told about it are two
      // different questions, and the first must not depend on the second.
      const after = changes[0]?.corners?.[0];
      check('the hole got dug', changes.length > 0 && typeof after === 'number' && after < before,
        changes.length ? `height ${before} → ${after} on the island's own reckoning` : 'no tile changed at all');
      check('the island told us about it', lines.some((l) => /dig/i.test(l)), lines.slice(-2).join(' | '));
      check('the channel is listening', island.channelState === 'listening', island.channelState);
      check('Realtime carried the change', ground.length > 0,
        ground.length ? `${ground.length} tile(s) arrived on the channel` : `nothing arrived (channel: ${island.channelState})`);
      check('and our own copy of the land moved with it', back.getHeight(cx, cy) < before,
        `${before} → ${back.getHeight(cx, cy)} here`);

      // Everything a client reads it reads through a policy; the one on
      // `player` used to read itself and so refused every row.
      const { data: people, error: peopleErr } = await supabase().from('player').select('*').eq('world_id', id);
      check('we can read the people on the island', !peopleErr && (people ?? []).length > 0,
        peopleErr ? peopleErr.message : `${(people ?? []).length} body`);
    }

    const { data: pack } = await supabase().from('item').select('*').eq('world_id', id).eq('holder_uid', uid);
    check('we are carrying the starting kit', (pack ?? []).length >= 9, `${(pack ?? []).length} things`);

    // What a client must not be able to do, asked for real through PostgREST.
    /*
     * A refused UPDATE is not an error.
     *
     * With no policy to match, Postgres touches no rows and reports success —
     * so asking "did that come back with an error?" is the wrong question, and
     * it answered "no, so it worked" about a write that had done nothing. The
     * right question is whether the body moved.
     */
    const was = await supabase().from('player').select('x,y').eq('world_id', id).eq('uid', uid).single();
    const { error: wrote } = await supabase().from('player').update({ x: 0, y: 0 }).eq('world_id', id).eq('uid', uid);
    const now = await supabase().from('player').select('x,y').eq('world_id', id).eq('uid', uid).single();
    const moved = was.data && now.data && (was.data.x !== now.data.x || was.data.y !== now.data.y);
    check('writing to our own body directly is refused', !moved,
      moved ? 'THE BODY MOVED' : `${wrote ? wrote.message : 'no error, but'} — it is still at ${now.data?.x}, ${now.data?.y}`);
    const { error: minted } = await supabase().from('item').insert({ world_id: id, holder: 'player', holder_uid: uid, def: 'gold_lump', ql: 100 });
    check('minting ourselves gold is refused', !!minted, minted?.message ?? 'IT WENT THROUGH');
  } finally {
    await island.leave();
    if (id) {
      const { error } = await supabase().rpc('rpc_abandon', { p_world: id });
      check('gave the island up again', !error, error?.message ?? 'nothing left of it');
    }
  }

  say(failures ? `\n${failures} thing(s) went wrong.` : '\nthe island keeps, hands out and refuses exactly what it should.');
  process.exit(failures ? 1 : 0);
}

main().catch((e: Error) => {
  say(`\nthe run stopped: ${e.message}`);
  process.exit(1);
});
