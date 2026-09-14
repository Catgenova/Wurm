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

    // Stand next to a corner worth digging, and ask.
    const me = island.me!;
    const cx = Math.floor(me.x);
    const cy = Math.floor(me.y);
    await supabase().rpc('rpc_move', { p_world: id, p_x: cx + 0.5, p_y: cy + 0.5, p_level: 0 });
    const before = back.getHeight(cx, cy);
    const asked = await island.act('dig', { x: cx, y: cy, cx, cy }, 1);
    check('asked to dig', asked.started || !!asked.why, asked.started ? 'started' : `refused: ${asked.why}`);

    if (asked.started) {
      // Nothing is running to finish it, so wait it out and then nudge.
      for (let i = 0; i < 20 && ground.length === 0; i++) {
        await sleep(1000);
        await supabase().rpc('rpc_sweep');
      }
      await island.refreshPack();
      const { data: rows } = await supabase().from('tile_change').select('*').eq('world_id', id);
      const { data: evs } = await supabase().from('event').select('*').eq('world_id', id).order('n');
      const lines = (evs ?? []).map((e) => (e as { text: string }).text);
      check('the hole got dug', (rows ?? []).length > 0 || lines.some((l) => /dig/i.test(l)),
        `${(rows ?? []).length} tile change(s), height ${before} → ${back.getHeight(cx, cy)}`);
      check('the island told us about it', lines.length > 0, lines.slice(-2).join(' | '));
      check('Realtime carried the change', ground.length > 0,
        ground.length ? `${ground.length} tile(s) arrived on the channel` : 'nothing arrived on the channel');
    }

    const { data: pack } = await supabase().from('item').select('*').eq('world_id', id).eq('holder_uid', uid);
    check('we are carrying the starting kit', (pack ?? []).length >= 9, `${(pack ?? []).length} things`);

    // What a client must not be able to do, asked for real through PostgREST.
    const { error: wrote } = await supabase().from('player').update({ x: 0, y: 0 }).eq('world_id', id).eq('uid', uid);
    check('writing to our own body directly is refused', !!wrote, wrote?.message ?? 'IT WENT THROUGH');
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
