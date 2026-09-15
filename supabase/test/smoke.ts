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
import { generateAtlasWorld } from '../../src/world/atlas-world';
import { TILE_DEFS } from '../../src/world/tiles';
import { supabase, signIn, PROJECT } from '../../src/net/supabase';
import { readAtlas } from '../../tools/atlas-node';
import { ACTION_PACE } from '../../src/game/pace';
import { pathOptions } from '../../src/game/player';
import { findPath } from '../../src/world/pathfinding';
import type { World } from '../../src/world/world';

const SIZE = Number(process.env.ISLAND_SIZE ?? 64);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Wait a timed action out.
 *
 * Nothing runs on this island but the looking, so a job started through the
 * front door sits in the player's head until somebody sweeps. Three of those
 * and the next `act` is refused for want of room — which is how one
 * un-settled `prospect` took four unrelated checks down with it. Anything with
 * a clock on it goes through here.
 */
/**
 * How long to wait for a job, in seconds.
 *
 * Every budget in this file was written against a world where a go at
 * something took a second or two, and they are all really counted in *jobs*
 * rather than in seconds. Actions are paced now — `src/game/pace.ts` — and the
 * first live run after that re-pacing failed here with exactly the sentence
 * `drain`'s own comment warns about: an instant action that did not answer at
 * once, which is a true sentence about a false cause. The cause was that
 * `drain` gave up after thirty seconds on a queue that now needs a hundred.
 *
 * Multiplied rather than raised, so re-pacing the game again cannot quietly
 * do it a second time.
 */
const waitFor = (jobs: number): number => Math.ceil(jobs * ACTION_PACE);

async function settle(ms = waitFor(12) * 1000): Promise<void> {
  for (let i = 0; i < ms / 1000; i++) {
    await sleep(1000);
    await supabase().rpc('rpc_settle');
  }
}

/**
 * Sweep until the head is actually empty.
 *
 * Six goes at a shovel is six jobs, and the dig above stops waiting at the
 * first tile change — so five of them are still queued when it moves on, and
 * the next `act` is *queued behind them* rather than run. That reads as an
 * instant action that did not answer at once, which is a true sentence about
 * a false cause.
 */
async function drain(id: string, uid: string, tries = waitFor(30)): Promise<number> {
  for (let i = 0; i < tries; i++) {
    const { data } = await supabase().from('player').select('act,act_queue').eq('world_id', id).eq('uid', uid).single();
    const left = ((data?.act_queue ?? []) as unknown[]).length + (data?.act ? 1 : 0);
    if (left === 0) return 0;
    await sleep(1000);
    await supabase().rpc('rpc_settle');
  }
  return -1;
}

/**
 * Walk somewhere, a step at a time.
 *
 * `rpc_move` believes about five tiles a call, so anywhere further than that
 * takes several — which is the ceiling doing exactly what it is for.
 */
/**
 * Walk somewhere the way a body walks somewhere.
 *
 * This used to claim the destination itself, over and over, and let the speed
 * ceiling pull it most of the way each time until it arrived. That worked
 * while the island believed anything that was slow enough. It does not now:
 * `rpc_move` reads the ground under a claimed walk, and a straight line from
 * here to there is not a walk — it goes through whatever is in between.
 *
 * The first live run after that check went in failed exactly here, with the
 * body stopped at 24.07, 48.36 on a shoreline and four checks downstream of it
 * failing for want of having arrived. Which is the island being right: no
 * browser has ever moved like that. A browser walks the waypoints `findPath`
 * gives it, over ground it has already decided it can cross, and so does this
 * now — the same function, the same step rule, off the same `World` the join
 * built.
 */
async function walkTo(id: string, world: World, uid: string, x: number, y: number): Promise<boolean> {
  for (let leg = 0; leg < 8; leg++) {
    const { data: here } = await supabase().from('player').select('x,y')
      .eq('world_id', id).eq('uid', uid).single();
    const from = (here ?? { x, y }) as { x: number; y: number };
    if (Math.hypot(from.x - x, from.y - y) < 0.6) return true;
    const path = findPath(world, Math.floor(from.x), Math.floor(from.y), 0,
      Math.floor(x), Math.floor(y), pathOptions(world));
    if (!path) return false;
    for (const wp of path) {
      const { data } = await supabase().rpc('rpc_move',
        { p_world: id, p_x: wp.x + 0.5, p_y: wp.y + 0.5, p_level: 0 });
      const got = data as { x: number; y: number; blocked?: boolean } | null;
      if (!got) return false;
      // The ceiling believes about five tiles a call, so a waypoint further
      // than that takes more than one go at it.
      for (let again = 0; again < 4 && Math.hypot(got.x - (wp.x + 0.5), got.y - (wp.y + 0.5)) > 0.4; again++) {
        await sleep(400);
        const { data: more } = await supabase().rpc('rpc_move',
          { p_world: id, p_x: wp.x + 0.5, p_y: wp.y + 0.5, p_level: 0 });
        const step = more as { x: number; y: number } | null;
        if (!step) break;
        got.x = step.x; got.y = step.y;
      }
      if (Math.hypot(got.x - x, got.y - y) < 0.6) return true;
    }
  }
  return false;
}
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
    // The join works the ground out from the chart rather than downloading it,
    // and `loadAtlas` is an Image and a canvas. There is neither out here, so
    // the chart is read the way `tools/` reads it — the same bytes, decoded by
    // hand instead of by a browser.
    chart: async () => readAtlas(),
  });

  const seed = (Math.random() * 0x7fffffff) >>> 0;
  // The same generator the join uses, or the island handed over and the island
  // come back to are two different islands.
  const gen = generateAtlasWorld(seed, readAtlas(), SIZE);
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
     * And which of them have no performer behind them yet — asked, not played.
     *
     * This was a loop that *tried* half a dozen actions until one was honestly
     * refused, and the comment above it worried about the check rotting as the
     * port caught up. It rotted in the direction nobody planned for: all six
     * are ported now, so the loop found no refusal and started six real jobs
     * instead. Three is all the head holds, so the next four checks were
     * refused for want of room — a live run failing on the island having got
     * better. Asking starts nothing and cannot rot either way.
     */
    const here = { x: Math.floor(island.me!.x), y: Math.floor(island.me!.y) };
    const { data: unported, error: portErr } = await supabase().rpc('rpc_unported');
    const noHands = (unported ?? []) as string[];
    check('the island is honest about what it cannot do yet', !portErr,
      portErr ? portErr.message
        : noHands.length ? `${noHands.length} without a performer: ${noHands.slice(0, 6).join(', ')}`
          : 'nothing: every action in the game has a performer, which was the point of the exercise');

    /*
     * The wildlife, which the island stocked for itself the moment the land
     * was finished and which has been getting on with its life ever since.
     *
     * Two calls a few seconds apart: the first walks everything near us
     * forward, the second asks again. Something within sight will have moved,
     * because the only thing that makes this island move is being looked at.
     */
    const { data: was0 } = await supabase().from('player').select('x,y').eq('world_id', id).eq('uid', uid).single();
    const { data: first, error: mobErr } = await supabase().rpc('rpc_creatures', { p_world: id, p_range: 60 });
    const mob = (first ?? []) as Array<{ id: number; species: string; x: number; y: number; hunting?: boolean }>;
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
      check('and a client is told which of it has our scent',
        mob.every((c) => 'hunting' in c),
        `${mob.filter((c) => c.hunting).length} of ${mob.length} are coming for us`);
    }

    /*
     * The aggression loop. Nothing out here can make a goblin come at us to
     * order — that wants one inside eleven tiles of wherever we happen to be
     * standing — so what reaches this far is the shape of it: the numbers a
     * hunt reads, and the columns it is kept in.
     */
    const { data: hunters, error: huntErr } = await supabase()
      .from('species_def').select('id,hunter,monster,notice').in('id', ['ulva', 'goblin', 'dragon']);
    const byHunter = new Map(((hunters ?? []) as Array<{ id: string; hunter: boolean; monster: boolean; notice: number | null }>)
      .map((h) => [h.id, h]));
    check('what hunts, and how far off it sees you, is on the project',
      !huntErr && byHunter.size === 3 && byHunter.get('ulva')!.hunter
        && (byHunter.get('dragon')!.notice ?? 0) > (byHunter.get('goblin')!.notice ?? 0),
      huntErr ? huntErr.message : byHunter.size
        ? `an ulva sees the seven everything else does, a goblin ${byHunter.get('goblin')!.notice}, a dragon ${byHunter.get('dragon')!.notice}`
        : 'no rows came back at all');
    const { error: legErr } = await supabase().from('creature').select('id,hunting,enemy,hurt_by').eq('world_id', id).limit(1);
    check('a creature carries what it is set on', !legErr,
      legErr?.message ?? 'the person it is hunting, the beast it is fighting, and what hurt it last');

    /*
     * Working the ground. Flattening and prospecting both want a tool the
     * starting kit has, so these two go through the front door for real;
     * examining a tile takes no time at all and answers at once.
     */
    const spot = { kind: 'tile', x: Math.floor(was0?.x ?? 0), y: Math.floor(was0?.y ?? 0) };
    const look = await island.act('examine', spot, 1);
    check('we can look at the ground we are standing on', look.started && !!look.done,
      look.why ?? 'it answered at once');
    const read = await island.act('prospect', spot, 1);
    check('and read it for metal', read.started, read.why ?? 'started');
    // Five seconds of somebody's time. Left in the head it fills the queue.
    if (read.started) await drain(id, uid);
    /*
     * A saddle and a set of traces, as far as they go with a starting kit —
     * which is the arithmetic, the refusal, and the one thing that changed
     * under everything else: `rpc_move` now asks what you are sitting on
     * before it decides how far you could have got.
     */
    const { data: beasts, error: beastErr } = await supabase().from('species_def')
      .select('id,name,mount,draught,pull').or('mount.not.is.null,draught.is.true');
    const carries = (beasts ?? []) as Array<{ name: string; mount: number | null; draught: boolean }>;
    check('what carries and what pulls is on the project', !beastErr && carries.length > 0,
      beastErr ? beastErr.message
        : `${carries.filter((b) => b.mount).length} take a saddle, ${carries.filter((b) => b.draught).length} take the traces`);
    const { data: wains, error: wainErr } = await supabase().from('vehicle_def').select('id,yokes,needs');
    const { data: hulls } = await supabase().from('boat_def').select('id,speed,draught,sail');
    check('and what is driven, and what floats', !wainErr && (wains ?? []).length > 0 && (hulls ?? []).length > 0,
      wainErr ? wainErr.message
        : `${((wains ?? []) as Array<{ id: string; yokes: number }>).map((v) => `${v.id} ${v.yokes} yokes`).join(', ')}`
          + ` · ${((hulls ?? []) as Array<{ id: string; draught: number }>).map((b) => `${b.id} draws ${b.draught}`).join(', ')}`);
    const noCart = await island.act('pull_cart', { kind: 'furniture', id: 1 }, 1);
    check('taking hold of a cart that is not there is refused in its own words',
      !noCart.started && /gone/i.test(noCart.why ?? ''), noCart.why ?? 'IT STARTED');
    /*
     * And a step on foot, believed. The ceiling used to be a constant and is
     * now a question — if that question ever answers null or nought, nobody
     * can walk anywhere on this island, so it is worth one round trip.
     */
    const afoot = island.me!;
    const { data: stepped, error: walkErr } = await supabase().rpc('rpc_move',
      { p_world: id, p_x: afoot.x + 0.5, p_y: afoot.y + 0.5, p_level: 0 });
    const got = stepped as { x: number; y: number; pulled: boolean } | null;
    check('and we may still walk half a tile on our own legs',
      !walkErr && !!got && !got.pulled,
      walkErr ? walkErr.message : got ? `${got.x.toFixed(1)}, ${got.y.toFixed(1)}${got.pulled ? ' — pulled back' : ''}` : 'nothing came back');

    /*
     * An altar and the three paths, which need a stone table and a rug and so
     * cannot be played from out here. What reaches this far is the rulebook
     * behind them and the two refusals in front.
     */
    const { data: casts, error: castErr } = await supabase().from('cast_def').select('id,name,cost,level');
    const spells = (casts ?? []) as Array<{ name: string; cost: number; level: number }>;
    check('what a prayer buys is on the project', !castErr && spells.length === 6,
      castErr ? castErr.message : spells.map((c) => `${c.name} ${c.cost}@${c.level}`).join(', '));
    const { data: steps, error: stepErr } = await supabase().from('path_step').select('path,n,at,ability');
    const rungs = (steps ?? []) as Array<{ path: string; ability: string | null }>;
    check('and the three ways of looking at it', !stepErr && rungs.length === 15,
      stepErr ? stepErr.message
        : `${new Set(rungs.map((w) => w.path)).size} paths, ${rungs.length} steps, ${rungs.filter((w) => w.ability).length} of them called on`);
    const noAltar = await island.act('pray', { kind: 'furniture', id: 1 }, 1);
    check('praying at an altar that is not there is refused in its own words',
      !noAltar.started && /gone/i.test(noAltar.why ?? ''), noAltar.why ?? 'IT STARTED');
    const noRug = await island.act('meditate', { kind: 'tile', ...here }, 1);
    check('and sitting with nothing to sit on', !noRug.started && /rug/i.test(noRug.why ?? ''),
      noRug.why ?? 'IT STARTED');

    /*
     * Eighteen things this game can make and had no definition for — seventeen
     * moulds and an altar. The browser hands back a fallback for anything it
     * has not heard of; down here a missing row was a null all the way out.
     */
    const { data: mould } = await supabase().from('item_def').select('id,name,weight').eq('id', 'altar').single();
    const alt = mould as { name: string; weight: number } | null;
    check('and a thing the browser only had a fallback for has a row', !!alt,
      alt ? `altar: "${alt.name}", ${alt.weight} kg` : 'still nothing');

    /*
     * And the last ten, which want a ravine, a bed, a herd and a barrel and so
     * cannot be played from out here either. The rulebook, and the refusals.
     */
    const { data: decks, error: deckErr } = await supabase().from('bridge_def').select('id,name,span,carts');
    const spans = (decks ?? []) as Array<{ name: string; span: number; carts: boolean }>;
    check('the three kinds of bridge are on the project', !deckErr && spans.length === 3,
      deckErr ? deckErr.message
        : spans.map((b) => `${b.name.toLowerCase()} spans ${b.span}${b.carts ? ', carts cross' : ', foot only'}`).join(', '));
    const { data: brews, error: brewErr } = await supabase().from('brew_def').select('id,name,input,seconds');
    check('and what a barrel of water becomes', !brewErr && (brews ?? []).length === 4,
      brewErr ? brewErr.message
        : ((brews ?? []) as Array<{ name: string; input: string; seconds: number }>)
            .map((b) => `${b.name.toLowerCase()} out of ${b.input} in ${Math.round(b.seconds / 60)}m`).join(', '));
    const noSpan = await island.act('build_bridge', { kind: 'bridge', id: 1 }, 1);
    check('working on a bridge that is not there is refused in its own words',
      !noSpan.started && /gone/i.test(noSpan.why ?? ''), noSpan.why ?? 'IT STARTED');
    const noBed = await island.act('sleep', { kind: 'furniture', id: 1 }, 1);
    check('and sleeping in a bed that is not there', !noBed.started && /bed/i.test(noBed.why ?? ''),
      noBed.why ?? 'IT STARTED');
    const noHerd = await island.act('pair_creature', { kind: 'creature', id: 999999 }, 1);
    check('and putting a wildermon to a mate it has not got',
      !noHerd.started && /(gone|settlement)/i.test(noHerd.why ?? ''), noHerd.why ?? 'IT STARTED');

    const { data: slabs, error: slabErr } = await supabase().from('slab_def').select('id,item');
    check('the four stones a slab is cut from are on the project',
      !slabErr && (slabs ?? []).length === 4,
      slabErr ? slabErr.message : `${(slabs ?? []).length}: ${((slabs ?? []) as Array<{ item: string }>).map((v) => v.item).join(', ')}`);
    const { data: fruiting, error: fruitErr } = await supabase().from('tree_def').select('name,fruit').not('fruit', 'is', null);
    check('and the trees that bear anything', !fruitErr && (fruiting ?? []).length > 0,
      fruitErr ? fruitErr.message : ((fruiting ?? []) as Array<{ name: string; fruit: string }>).map((t) => `${t.name.toLowerCase()} → ${t.fruit}`).join(', '));

    /*
     * Barrels and the well. Neither can be built with a starting kit, so what
     * reaches out here is the arithmetic behind them and the refusal in front.
     */
    const { data: vessels, error: vesselErr } = await supabase().from('furniture_def')
      .select('id,name,liquid,well').or('liquid.not.is.null,well.not.is.null');
    check('barrels and wells are on the project', !vesselErr && (vessels ?? []).length >= 4,
      vesselErr ? vesselErr.message
        : ((vessels ?? []) as Array<{ id: string; liquid: number | null; well: number | null }>)
            .map((v) => `${v.id} ${v.liquid ?? v.well}L`).join(', '));
    const { data: liquids, error: liquidErr } = await supabase().from('liquid_def').select('id,drinkable,brew');
    check('and what each of them may be full of', !liquidErr && (liquids ?? []).length === 7,
      liquidErr ? liquidErr.message
        : `${(liquids ?? []).length}, of which ${((liquids ?? []) as Array<{ drinkable: boolean }>).filter((l) => l.drinkable).length} you would drink`);
    const dry = await island.act('fill_bucket', { kind: 'item', uid: 1 }, 1);
    check('filling a bucket we have not got is refused in its own words',
      !dry.started && /gone|bucket/i.test(dry.why ?? ''), dry.why ?? 'IT STARTED');

    /*
     * The furnaces. Neither can be built with a starting kit, so what reaches
     * this far is the arithmetic behind them and the refusal in front.
     */
    const { data: metals, error: metalErr } = await supabase().from('metal_def').select('id,work').in('id', ['copper', 'seryll']);
    const work = new Map(((metals ?? []) as Array<{ id: string; work: number }>).map((m) => [m.id, m.work]));
    check('the smelting chain is on the project', work.size === 2 && work.get('seryll')! > work.get('copper')!,
      metalErr ? metalErr.message : work.size
        ? `copper ${work.get('copper')}, seryll ${work.get('seryll')} — seryll is the stubborn one`
        : 'no rows came back at all');

    /*
     * The rulebook, which a client could not read a row of until a live run
     * said so. A hand-kept `grant select` list went stale the first time a
     * table was generated after it was written; the doors are set by a rule
     * now — everything without a `world_id` on it is reference data — and this
     * asks about a spread of it rather than one table, so the next one that
     * goes missing is noticed here.
     */
    const rulebook = ['recipe', 'species_def', 'weapon_def', 'crate_def', 'pottery_def', 'improvable_def', 'trait_def'];
    const shut: string[] = [];
    for (const table of rulebook) {
      const { error } = await supabase().from(table).select('*', { count: 'exact', head: true });
      if (error) shut.push(`${table}: ${error.message}`);
    }
    check('every part of the rulebook answers a client', shut.length === 0,
      shut.length ? shut.join(' | ') : `${rulebook.length} tables, all readable`);
    const noKiln = await island.act('load_kiln', { kind: 'kiln', id: 1 }, 1);
    check('packing a kiln that is not there is refused in its own words',
      !noKiln.started && /gone|kiln/i.test(noKiln.why ?? ''), noKiln.why ?? 'IT STARTED');

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
    const noWall = await island.act('build_wall', { kind: 'tile', ...here, side: 'n' }, 1);
    check('a wall with nothing planned is a wall, not a campfire',
      !noWall.started && /wall/i.test(noWall.why ?? ''), noWall.why ?? 'IT WENT THROUGH');

    /*
     * And then founding one for real, which the kit can now do.
     *
     * This was a refusal check — founding wants a stake in hand, and a fresh
     * player had none. Then the starting kit learned to hand out the browser's
     * twelve things, one of which is a deed stake, and a true check began
     * failing because the island had got better. Again. So it stops asking for
     * the refusal it used to get and plants the stake instead: a settlement
     * founded through the front door, read back off the project, and the
     * refusal worth having is the second one.
     */
    /*
     * And first, ground the token will actually stand on.
     *
     * The same lesson the digging below already learned, not applied here
     * until a live run taught it twice: a spawn can be under a tree or at the
     * water line, and `The token needs a clear tile.` is the rules being
     * right. Islands are rolled fresh every run, so anything that leans on
     * where a random one puts you cries wolf on a schedule of its own.
     */
    const at = island.me!;
    let sx = Math.floor(at.x);
    let sy = Math.floor(at.y);
    for (let r = 0; r <= 12; r++) {
      let done = false;
      for (let dy = -r; dy <= r && !done; dy++) {
        for (let dx = -r; dx <= r && !done; dx++) {
          const x = Math.floor(at.x) + dx;
          const y = Math.floor(at.y) + dy;
          if (x - 5 < 0 || y - 5 < 0 || x + 5 >= back.w || y + 5 >= back.h) continue;
          if (back.getTile(x, y) === undefined || TILE_DEFS[back.getTile(x, y)]?.blocks) continue;
          const wet = Math.min(back.getHeight(x, y), back.getHeight(x + 1, y),
            back.getHeight(x + 1, y + 1), back.getHeight(x, y + 1)) < 0;
          if (wet) continue;
          sx = x; sy = y; done = true;
        }
      }
      if (done) break;
    }
    const walked = await walkTo(id, back, uid, sx + 0.5, sy + 0.5);
    check('there is somewhere on this island worth a settlement', walked, `${sx},${sy}`);
    const founded = await island.act('found_settlement', { kind: 'item', name: 'Smoke' }, 1);
    check('the stake in the kit founds a settlement', founded.started || founded.done === true,
      founded.why ?? 'the token is in the ground');
    await drain(id, uid);
    const { data: deeds } = await supabase().from('deed').select('name,radius').eq('world_id', id);
    const town = (deeds ?? []) as Array<{ name: string; radius: number }>;
    check('and the island keeps it', town.length === 1,
      town.length ? `${town[0].name}, ${town[0].radius * 2 + 1} tiles across` : 'no settlement came of it');
    const twice = await island.act('found_settlement', { kind: 'item', name: 'Twice' }, 1);
    check('and will not have a second', !twice.started && /already/i.test(twice.why ?? ''),
      twice.why ?? 'IT WENT THROUGH');

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
    /*
     * Where the island says we are, not where the client last thought. The
     * settlement above walked us somewhere, and a dig aimed from a stale idea
     * of where we stand is refused for being too far away — true, and nothing
     * whatever to do with digging.
     */
    const { data: standing } = await supabase().from('player').select('x,y')
      .eq('world_id', id).eq('uid', uid).single();
    const me = (standing ?? island.me!) as { x: number; y: number };
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
    /*
     * Nothing queued before the digging starts.
     *
     * Three jobs in the head and the next `act` is refused for want of room,
     * which reads as four unrelated checks failing at once and says nothing
     * about why. Asked here, a full head is one honest failure that names
     * what is in it.
     */
    const left = await drain(id, uid);
    check('everything we started has finished', left === 0,
      left === 0 ? 'the head is empty' : 'jobs still waiting after thirty seconds of sweeping');
    check('there is somewhere on this island worth digging', found,
      found ? `corner ${cx},${cy}: ${back.getDirt(cx, cy)} of soil over the rock` : 'all rock and water within twelve tiles');
    await walkTo(id, back, uid, cx + 0.5, cy + 0.5);
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
      /*
       * Nothing is running to finish it, so wait it out and nudge.
       *
       * Counted from where the channel already stood rather than from zero:
       * anything earlier in this run that moved a tile — putting something
       * down, picking it up — arrives here too, and a loop that stops at the
       * first tile change of any kind stops before the digging has begun.
       */
      /*
       * And ask again if something knocks it out of our hands.
       *
       * The island has a clock now, which means the wildlife on it moves and
       * hunts — and the first live run after that clock went in failed here,
       * with the dig started, four minutes of nudging, and no hole. What the
       * event log said was `The ulva is on you. You have a deep cut to the
       * leg, bleeding.` Being set upon cancels what you were doing, which is
       * the right rule and was simply never reachable before.
       *
       * So the loop asks again whenever the head has gone empty without the
       * ground moving. A test of whether digging digs should not be a test of
       * whether anything came out of the trees.
       */
      const groundWas = ground.length;
      for (let i = 0; i < waitFor(60) && ground.length === groundWas; i++) {
        await sleep(1000);
        const said = await supabase().rpc('rpc_settle');
        const now = (said.data ?? {}) as { act?: string | null };
        if (!now.act && ground.length === groundWas && i > 2) await island.act('dig', { x: cx, y: cy, cx, cy }, 6);
      }
      await island.refreshPack();
      /*
       * The change to *this* tile, newest first.
       *
       * It used to take the first row in the table, which was the dig's while
       * the dig was the only thing that had ever moved a tile. Putting a thing
       * down moves one, picking it up moves one, and a sweep moves several —
       * so row zero became somebody else's and the check read a corner that
       * had never been dug. Asking about the corner we dug is the question we
       * meant all along.
       */
      const { data: rows } = await supabase().from('tile_change').select('*')
        .eq('world_id', id).eq('x', cx).eq('y', cy).order('n', { ascending: false });
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
      check('Realtime carried the change', ground.length > groundWas,
        ground.length > groundWas ? `${ground.length - groundWas} tile(s) arrived on the channel`
                                  : `nothing arrived (channel: ${island.channelState})`);
      check('and our own copy of the land moved with it', back.getHeight(cx, cy) < before,
        `${before} → ${back.getHeight(cx, cy)} here`);

      /*
       * And whether this island winds itself.
       *
       * Everything here settles off a timestamp, so `world_tick` on `pg_cron`
       * is what makes a finished job land for somebody watching, a wild thing
       * move, a trap spring and a shut tab go home. Whether it is ever called
       * depends on something no migration controls — whether the extension is
       * available on the database it was applied to — and until this call
       * there was no way to ask the real project.
       *
       * It is reported rather than insisted on: a project without pg_cron is a
       * switch in a dashboard, not a broken build. The sentence is the point.
       */
      const { data: clock, error: clockErr } = await supabase().rpc('rpc_clock');
      const wound = (clock ?? {}) as { winds?: boolean; every?: number };
      check('the island can say whether it winds itself', !clockErr,
        clockErr ? clockErr.message
          : wound.winds ? `it does — a round every ${wound.every} seconds`
          : 'IT DOES NOT — no pg_cron on this project, so nothing turns world_tick and the world only moves when somebody asks');

      // Everything a client reads it reads through a policy; the one on
      // `player` used to read itself and so refused every row.
      const { data: people, error: peopleErr } = await supabase().from('player').select('*').eq('world_id', id);
      check('we can read the people on the island', !peopleErr && (people ?? []).length > 0,
        peopleErr ? peopleErr.message : `${(people ?? []).length} body`);
    }


    /*
     * The ground. Everything the island puts down has been out of reach of the
     * person standing on it until now, so this looks at one of the starting
     * kit, drops it, and picks it back up through the front door.
     *
     * After the digging rather than before it: dropping a thing moves a tile,
     * and a tile that moves arrives on the same channel the dig is waiting on.
     */
    /*
     * Nothing left running, and nothing that the island refuses to put down:
     * digging leaves dirt in the pack, and dirt goes back in a hole.
     *
     * The answer is checked rather than thrown away. It used to be discarded,
     * so a `drain` that gave up while the head was still full read as two
     * unrelated failures further down — "an instant action that did not answer
     * at once" and "nothing reached the ground" — and neither of them said the
     * true thing, which is that the queue was still busy.
     */
    const emptied = await drain(id, uid);
    check('the head is empty before we look at anything', emptied === 0,
      emptied === 0 ? 'nothing left running' : 'THE QUEUE NEVER EMPTIED — everything below is about that');
    const mine = await supabase().from('item').select('id,def,count')
      .eq('world_id', id).eq('holder_uid', uid).eq('holder', 'player').neq('def', 'dirt').limit(1);
    const one = (mine.data ?? [])[0] as { id: number; def: string; count: number } | undefined;
    if (one) {
      const look = await island.act('examine_item', { kind: 'item', uid: one.id }, 1);
      check('a thing says what it is when we look at it', look.started && !!look.done,
        look.why ?? 'it answered at once, as an instant action should');
      const put = await island.act('drop', { kind: 'item', uid: one.id, count: 1 }, 1);
      const { data: onGround } = await supabase().from('item').select('id,def').eq('world_id', id).eq('holder', 'ground');
      const lying = ((onGround ?? []) as Array<{ id: number; def: string }>).find((it) => it.def === one.def);
      check('we can put something down', put.started && !!lying,
        put.why ?? (lying ? `a ${one.def} is lying on the ground` : 'nothing reached the ground'));
      if (lying) {
        const here = await supabase().from('player').select('x,y').eq('world_id', id).eq('uid', uid).single();
        const got = await island.act('pick_up',
          { kind: 'ground', x: Math.floor(here.data?.x ?? 0), y: Math.floor(here.data?.y ?? 0), uid: lying.id }, 1);
        // Picking a thing up takes a few seconds of somebody's time, so it has
        // to be waited out and nudged like any other job with a clock on it.
        let left = 1;
        for (let i = 0; i < waitFor(20) && left > 0; i++) {
          await sleep(1000);
          await supabase().rpc('rpc_settle');
          const { count } = await supabase().from('item').select('*', { count: 'exact', head: true })
            .eq('world_id', id).eq('holder', 'ground').eq('id', lying.id);
          left = count ?? 0;
        }
        await settle(waitFor(2) * 1000);
        check('and pick it up again', got.started && left === 0,
          got.why ?? (left === 0 ? 'it is back in the pack' : 'it is still on the grass'));
      }
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
