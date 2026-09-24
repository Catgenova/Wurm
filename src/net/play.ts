import { Game } from '../game/game';
import { EMOTE_BY_ID } from '../game/emotes';
import { cleanLook } from '../game/look';
import { whoAmI } from './accounts';
import { supabase } from './supabase';
import { Island, type ItemRow, type PlayerRow } from './island';
import { generateAtlasWorld, loadAtlas } from '../world/atlas-world';
import { ACTION_BY_ID, type ActionDef, type Target } from '../game/actions';
import { saidWords } from '../game/roster';
import { skillRises, tookOff } from './felt';
import { packAll } from './packed';

/**
 * Starting on an island that lives in Postgres rather than in this tab.
 *
 * The front door opens on the island. With nothing in the address bar at all
 * this asks the keeper which island it keeps and comes ashore on it, which is
 * what a front door should do — a page that needs a uuid pasted into it is not
 * one. The rest of the address bar still decides the unusual cases:
 *
 *   (nothing)        come ashore on the island this keeper keeps
 *   ?island=<id>     come ashore on a particular one
 *   ?found=<name>    roll a small one here, hand it over, and be its first
 *   ?alone           play by yourself, in this browser, with no keeper at all
 *
 * The single-player game is still all there and still saved in this browser;
 * it is one link away rather than the default. It is also where this lands
 * when the keeper cannot be reached or keeps no island yet — a page that
 * cannot get to the island should still have a game, and should say which it
 * gave you and why.
 */

export interface Started {
  game: Game;
  island: Island;
  id: string;
}

/** How long the front door waits for an answer before giving you the other game. */
const ASK_HOME_MS = 8000;

/** A line on the loading screen, since founding an island is not instant. */
/**
 * How the boot screen is told what is happening.
 *
 * `done` and `total` are given when the step is one of a known list, and left
 * out for a plain line. A `total` of nought means "counting up towards nobody
 * knows what", which is the island's history: a percentage of an unknown is
 * the one number that looks exactly like being stuck.
 */
type Telling = (text: string, done?: number, total?: number) => void;

/**
 * Which island this keeper keeps, if it keeps one.
 *
 * One small read of one small table. It is not an id anybody can set from a
 * browser: whoever could would be pointing every visitor at an island of their
 * own, so `home` is written by a migration and by the opening of an island
 * bigger than a tab may found, and by nothing else.
 */
async function homeIsland(): Promise<string | null> {
  /*
   * With a clock on it, because this is the first thing the page does.
   *
   * A front door that hangs is worse than one that opens on the wrong room:
   * the single-player game is right there, and eight seconds is already longer
   * than anybody should spend looking at a notice. A keeper that has not
   * answered by then is a keeper that is not answering.
   */
  const asked = supabase().from('home').select('island').limit(1).maybeSingle();
  const timeout = new Promise<never>((_, no) =>
    setTimeout(() => no(new Error('The island keeper did not answer.')), ASK_HOME_MS));
  const { data, error } = await Promise.race([asked, timeout]);
  if (error) throw new Error(`Could not ask the keeper which island it keeps: ${error.message}`);
  return ((data ?? {}) as { island?: string | null }).island ?? null;
}

export async function startIsland(params: URLSearchParams, tell: Telling): Promise<Started | null> {
  if (params.has('alone')) return null;
  const founding = params.get('found');
  let joining = params.get('island');
  if (!joining && founding === null) {
    tell('Asking which island…');
    joining = await homeIsland();
    if (!joining) {
      tell('This keeper has no island on it yet — playing on your own instead.');
      return null;
    }
  }

  /**
   * What to call you.
   *
   * An account first, and the address bar only if there is no account. That
   * order is the whole point of having accounts: `?me=` is a string anybody
   * can type, while `whoAmI()` is the island keeper reading a name back out of
   * the address you signed in with, which nobody can type their way into.
   * With neither, you are a Wanderer, and the island still lets you in — an
   * account is a name you can prove, not a toll.
   */
  const account = await whoAmI().catch(() => null);
  /*
   * No account, no island. The landing page first.
   *
   * It has been there all along and the game walked straight past it, so
   * everybody who ever came ashore was an anonymous session called Wanderer —
   * indistinguishable on the roster, impossible to tell apart on the tables,
   * and hanging every skill they earned off a uid kept in `localStorage`,
   * which is a place browsers tidy up. "Just had all my skills wiped" is what
   * that looks like from inside.
   *
   * The single-player game needs no name and is still one link away; this is
   * only about coming ashore on somebody else's island, where being somebody
   * is the point.
   */
  if (!account) {
    tell('Sending you to the landing page to pick a name…');
    const carried = new URLSearchParams();
    for (const key of ['island', 'found', 'size', 'seed']) {
      const had = params.get(key);
      if (had !== null) carried.set(key, had);
    }
    location.replace(`./account.html${carried.toString() ? `?${carried}` : ''}`);
    // And hold here rather than hand back. Handing back starts the
    // single-player game behind the notice, which flashes up for as long as
    // the navigation takes and is not the game anybody asked for.
    return new Promise<never>(() => {});
  }
  const name = account;
  const log: Array<[string, string, number | undefined]> = [];
  const island = new Island({
    say: (text, kind, at) => log.push([text, kind, at]),
    ground: () => {},
    people: () => {},
    pack: () => {},
    /*
     * A total of nought means nobody knows how many there are — the island's
     * history is read until it runs out, and a percentage of an unknown is a
     * lie that looks exactly like being stuck. Reported as "hung on catching
     * up, 100%": it was not hung, it was counting, and saying 100% the whole
     * way through was the only thing wrong with it.
     */
    progress: (done, total, what) => tell(what, done, total),
  });

  let id = joining ?? '';
  if (!id) {
    tell('Rolling an island…');
    /*
     * Founding from a tab is for small islands, and `Island.found` says so
     * above 512. The big one — `ISLAND_SIZE`, four thousand and ninety-six —
     * is founded once by `tools/found-island.ts`, because it is three minutes
     * of ground and 138 MB of land and neither belongs in a page somebody is
     * waiting on. Coming *ashore* on it costs nothing extra, which is the
     * whole point of the change.
     */
    const size = Number(params.get('size')) || 256;
    const seed = (Math.random() * 0x7fffffff) >>> 0;
    /*
     * From the survey chart, not from the old radial mask.
     *
     * This has to be the generator the *join* uses, or an island is one shape
     * the day it is founded and another shape the day somebody comes back to
     * it: founding uploads what was rolled here, and joining works the ground
     * out from the seed. Two generators is two islands that have to agree
     * forever, and they would not.
     */
    const gen = generateAtlasWorld(seed, await loadAtlas(), size);
    id = await island.found(gen.world, founding || 'An island', gen.spawn);
    /**
     * Put the island's name in the address bar.
     *
     * Without this an island is founded and then immediately lost: the only
     * copy of the one thing anybody needs in order to visit it — its id — was
     * a string in a variable. Now the page you are looking at *is* the
     * invitation, and reloading comes back to the same island rather than
     * founding another one.
     */
    const here = new URLSearchParams(params);
    here.delete('found');
    here.delete('size');
    here.set('island', id);
    history.replaceState({}, '', `?${here.toString()}`);
  }

  tell('Coming ashore…');
  await island.join(id, name);
  const world = island.world;
  const info = island.info;
  const me = island.me;
  if (!world || !info || !me) throw new Error('The island did not arrive in one piece.');

  // A game built on the island's land, with its own body where the island says
  // it is. Everything it would normally decide, it now asks about.
  const game = new Game({
    seed: info.seed,
    world,
    spawn: { x: info.spawn_x, y: info.spawn_y },
    player: {
      x: me.x, y: me.y, name: me.name,
      // The island's copy, not this browser's: the face you chose is kept with
      // the account and handed back at the join, so a new machine comes ashore
      // looking like you rather than like a stranger.
      look: cleanLook(me.look),
      stats: (me.stats as Game['player']['stats']) ?? { health: 1, stamina: 1, hunger: 1, thirst: 1 },
    },
    time: island.time(),
  });

  /*
   * The hour comes from the island from here on, rather than being counted up
   * a frame at a time on this machine. Reported as "day and night only seem to
   * change on client refresh", and a reload was indeed the only thing that
   * ever put the clock right.
   */
  game.islandClock = () => island.time();

  /** What was last asked about, so the bar has something to point at. */
  let lastTarget: Target | null = null;
  /** Whether the island's book of skills has landed once, so a rise is a rise. */
  let seeded = false;

  game.ask = (def: ActionDef, target: Target, goes?: number) => {
    lastTarget = target;
    void island.act(def.id, target as unknown as Record<string, unknown>, goes ?? 1);
  };
  game.stop = () => {
    lastTarget = null;
    void island.stop();
  };
  game.hold = () => {
    lastTarget = null;
    void island.hold();
  };

  /*
   * The clock on what the island is doing.
   *
   * `ask` sends the whole of an action away, which is what makes the island
   * the authority — and left the screen with nothing to draw. `showAction`
   * puts the island's own reckoning on the bar without this machine owning any
   * of the work: the clock runs here between one answer and the next, and
   * whether the job happened is still the island's to say.
   */
  /*
   * The wildlife, which the browser had simply never asked for.
   *
   * `creatures.fromIsland` stops this machine thinking for any of them — their
   * hunger, wandering and hunting are all settled over there, the same seam as
   * actions — and leaves it drawing the legs the island hands over.
   */
  game.creatures.fromIsland = true;
  /*
   * And the body, which the island now keeps.
   *
   * Reported as "thirst and hunger reset to full on every client reset": the
   * bars fell here all session and the island's row had never moved, so a
   * refresh read the full mark it was made with. The island settles a body off
   * a timestamp now, and this side stops moving what it does not own.
   */
  game.bodyFromIsland = true;
  /*
   * And the pack, which it has always kept — the browser simply never read
   * most of a row off it. See `packed` below for the seven fields that were
   * dropped and the bugs each of them was.
   */
  game.packFromIsland = true;
  // And the record of what has been ticked off, which is the island's to keep:
  // nothing on this side is ever written down on an island.
  game.tickedGoal = (id) => island.tickGoal(id);
  // And nothing is read out of it until the island has sent it: a tally that
  // has not arrived yet is an empty one, and every goal already met would be
  // announced all over again on every refresh.
  game.journalReady = false;
  island.hooks.mobs = (rows) => {
    // Everything that lost health since the last answer gets its number, which
    // is the half of the fight that happens away from your own body.
    for (const h of game.creatures.sawAll(rows, game.time)) {
      game.events.emit('hit', h.x, h.y, h.taken, 'dealt');
    }
    // And which of them are in whose traces, which lives on the vehicle here.
    game.teamsFromCreatures();
    game.events.emit('creature');
  };

  /*
   * And everything standing on the ground, which had the same bug for the same
   * reason: the island keeps it and nothing here ever looked. A campfire laid
   * on a live island was a row in `placed` and a blank patch of grass.
   */
  // Whose uid this is, so the seat and the shafts that are ours can be told
  // from somebody else's.
  island.hooks.built = (ground) => game.sawGround(ground, island, island.uid || null);
  // Where the island put the body, which is only ever somewhere we did not put
  // it ourselves — and the only thing that does that is dying.
  island.hooks.moved = (x, y, level) => game.putBody(x, y, level);
  /*
   * And the crates our own ask touched, which come back with the answer to it.
   *
   * Laid down on their own rather than through `sawGround`, which clears
   * everything standing and rebuilds it: right for a ground read, wrong for an
   * answer that names the two crates at your elbow.
   */
  island.hooks.stored = (crates) => game.sawCrates(crates);

  /*
   * The rest of you, which the browser had no way of hearing about.
   *
   * Each of these was a separate-looking bug with one cause: the island owns
   * the player row and the browser read it once, at the join. The action bar
   * never said what was queued behind the job in hand; prospecting said "they
   * are marked for a while" and marked nothing; the health and stamina bars
   * were the ones you came ashore with; the skills window disagreed with the
   * log line that had just said a skill went up.
   */
  island.hooks.mine = (what) => {
    // Each of these only when the island said something about it: the answer to
    // a queued job carries the queue and nothing else, and a prospector's marks
    // must not go out because a different question was asked.
    if (what.queue) game.showQueue(what.queue, what.cap ?? null);
    if (what.stats) {
      const s = game.player.stats as unknown as Record<string, number>;
      // What health it took off, before it is written down: a body on an
      // island is hurt over there, so `hurtPlayer` — which is what puts a
      // number over you in a game of your own — never runs.
      const was = s.health;
      for (const k of ['health', 'stamina', 'hunger', 'thirst']) {
        if (typeof what.stats[k] === 'number') s[k] = what.stats[k];
      }
      const took = tookOff(was, s.health);
      if (took) game.events.emit('hit', game.player.x, game.player.y, took, 'taken');
      game.events.emit('stats');
    }
    if (what.skills) {
      /*
       * And which skill went up, which this had no way of saying.
       *
       * Reported as "floating text only shows for climbing". It was exactly
       * that: `gainSkill` is what raises a skill *and* emits the event the
       * floating number is drawn from, and on an island the island raises
       * them, so the only ones left running through it here are the two the
       * browser still owns — climbing and swimming, off your own feet in
       * `update`. Everything else came down this line, which set the numbers
       * and then emitted a nameless gain of nothing:
       *
       *     game.events.emit('skill', '', 0);
       *
       * The renderer drops a gain of nothing, so the log said "Mining
       * increased by 0.42" and nothing floated. Nothing new has to be sent:
       * the whole book arrives every beat, so the rise is the difference
       * between what it says and what we were holding.
       */
      for (const r of skillRises(what.skills, (id) => game.skills.get(id), seeded)) {
        game.events.emit('skill', r.id, r.gain);
      }
      for (const [id, value] of Object.entries(what.skills)) game.skills.values.set(id, value);
      seeded = true;
      game.events.emit('skill', '', 0);
    }
    /*
     * And what you are carrying.
     *
     * The island has kept wounds all along and no door ever mentioned them, so
     * the window was empty however cut about you were and a bandage had
     * nothing to be put on. Replaced wholesale rather than merged: the island
     * closes them, turns them bad and takes the blood out, and this side draws
     * what it is told. An empty list is "they have all closed over".
     */
    if (what.wounds) game.sawWounds(what.wounds);
    /*
     * And the rest of what you are.
     *
     * Every one of these is a column the island has kept since the day the
     * player row was made and has never once sent: the rest a night in a bed
     * banks, the dishes favouring a trade, the knacks earned over a long day,
     * the titles, and what is on your table. The hud and the Skills window
     * draw all five off the browser's own copy, which on an island was
     * whatever it came ashore with — so the rest bar counted down from
     * nothing, the title box was empty however long anybody played, and a
     * meal's favour showed for a browser that had granted it to itself.
     */
    if (typeof what.rested === 'number') game.player.rested = what.rested;
    /*
     * And what you have on, which is the same story one column over. The
     * island has dispatched `equip` and `unequip` and kept the answer in
     * `player.equipped` all along, and never sent it -- so a reload left the
     * browser holding an empty record. Nothing read as worn, no armour of
     * yours counted towards what you could carry, and the menu offered
     * `Wear or wield` on the helm already on your head and never `Take it
     * off` on anything: "there's no option to unequip gear."
     */
    if (what.equipped) game.sawEquipped(what.equipped as Record<string, number | null>);
    if (what.boons) game.player.boons = what.boons as typeof game.player.boons;
    if (what.knacks) game.player.knacks = what.knacks;
    if (what.titles) game.player.titles = what.titles;
    if (what.title !== undefined) game.player.title = what.title;
    if (what.nutrition) {
      const n = game.player.nutrition as unknown as Record<string, number>;
      for (const [k, v] of Object.entries(what.nutrition)) if (typeof v === 'number') n[k] = v;
    }
    if (what.marks !== undefined) game.showProspected(what.marks?.tiles ?? [], what.marks?.secs ?? 0);
    /*
     * And the journal, which had nothing to read and nowhere to keep it.
     *
     * Forty-six of its eighty-five goals count things done, the counting was
     * done by browser performers that do not run on an island, and an island
     * session never saves — so a whole afternoon's work ticked nothing and
     * whatever it did tick went with the tab. The island notes and keeps all
     * three of these now.
     *
     * The tally is *merged* rather than replaced, because two keys are still
     * this side's: `reach` and `laden` are sailing, and the browser still owns
     * how a hull moves through water. The island's count wins wherever it has
     * one, and a key only this tab knows about survives the beat.
     */
    if (what.tally) for (const [k, v] of Object.entries(what.tally)) {
      if (typeof v === 'number') game.tally[k] = v;
    }
    if (what.ledger) {
      for (const k of Object.keys(game.ledger)) delete game.ledger[k];
      Object.assign(game.ledger, what.ledger);
    }
    if (what.ticked) {
      for (const id of what.ticked) game.ticked.add(id);
      game.journalReady = true;
    }
  };

  island.hooks.doing = (what) => {
    if (!what.act) {
      game.showAction(null, null);
      return;
    }
    const def = ACTION_BY_ID.get(what.act);
    if (!def) return;
    game.showAction(def, lastTarget, what.total, what.secs, what.left, what.goes);
  };

  // Everything the island says, said here. The lines that arrived while the
  // land was still coming down go up first, in the order they were said.
  island.hooks.say = (text, kind) => game.write(text, kind as Parameters<Game['write']>[1]);

  /*
   * Talking, which the island keeps for everybody.
   *
   * The box in the event window has been there since before there was an
   * island and did nothing on one: a line went into this browser's own log and
   * no further. It goes over now and comes back down the subscription that is
   * already open, which is how everybody else gets it — so nothing is drawn
   * here, and the only thing that comes back is a refusal.
   */
  game.talk = (text: string) => {
    void island.say(text).then((why) => {
      if (why) game.write(why, 'error');
    });
  };

  /*
   * And what was said before you got here.
   *
   * A chat you cannot scroll back through after a refresh is not a persistent
   * one. Sixty lines, oldest first, written straight into the log so they read
   * exactly as they did when they were said — and before the subscription is
   * carrying anything, so nothing lands twice.
   */
  void island.recentChat().then((lines) => {
    // With the hour each was said at, which the island has always sent and
    // this line used to drop: sixty lines stamped with the second you opened
    // the page is not a chat you can scroll back through.
    for (const line of lines) game.write(line.text, 'chat', line.at);
  });
  island.hooks.ground = (x, y) => game.events.emit('world', x, y);
  island.hooks.pack = (items: ItemRow[]) => {
    game.inventory.items = packAll(items, island);
    game.events.emit('inventory');
  };
  /*
   * Everybody, in one word, rather than one at a time.
   *
   * `saw` adds and updates and never removes, so somebody who left stood there
   * for ever. `sawAll` replaces the list — which is what this now is: the
   * roster is reconciled from the table every twenty seconds, and Broadcast
   * carries the walking in between.
   */
  /*
   * Somebody waved. Stamped by the roster on arrival rather than carried, and
   * written into the log as well as the world — half the point of waving at
   * somebody is that they know you meant them.
   */
  island.hooks.emote = (uid: string, name: string, id: string) => {
    const def = EMOTE_BY_ID.get(id);
    if (!def) return;
    game.roster.emoted(hashId(uid), id);
    game.write(def.said.replace('{name}', name || 'Somebody'), 'event');
  };
  /*
   * A bubble over whoever said it. The roster holds everybody but this body,
   * so this body's goes on the game — and it is stamped by the clock the
   * frames are drawn on either way.
   */
  island.hooks.spoke = (uid: string, text: string) => {
    const words = saidWords(text);
    if (!words) return;
    if (uid === island.uid) game.saidAloud = { text: words, at: performance.now() / 1000 };
    else game.roster.spoke(hashId(uid), words);
  };
  game.emoted = (id: string) => island.emote(id);
  game.woreTitle = (id: string | null) => void island.wearTitle(id);
  /*
   * The two crafting settings. The island spends the stock, so it keeps a
   * copy on the body. A copy it already has wins -- it was set from some
   * browser, perhaps another one, and a setting that keeps rare stock safe
   * should not come undone because this browser never heard of it -- and a
   * body that has never been told is told what this browser has.
   */
  const toldStores = me.craft_from_stores;
  const toldRare = me.craft_spare_rare;
  if (typeof toldStores === 'boolean') game.settings.fromStores = toldStores;
  if (typeof toldRare === 'boolean') game.settings.spareRare = toldRare;
  game.craftPrefsChanged = () => void island.craftPrefs(game.settings.fromStores, game.settings.spareRare);
  if (typeof toldStores !== 'boolean' || typeof toldRare !== 'boolean') {
    void island.craftPrefs(game.settings.fromStores, game.settings.spareRare, true);
  }
  island.hooks.people = (people: PlayerRow[]) => {
    game.roster.sawAll(people
      .filter((p) => p.uid !== island.uid)
      .map((p) => ({
        id: hashId(p.uid), uid: p.uid, name: p.name, x: p.x, y: p.y, dirX: 0, dirY: 1,
        level: p.level, moving: false, swimming: false, working: !!p.act,
        act: p.act ?? undefined, look: cleanLook(p.look),
      })));
  };
  for (const [text, kind, at] of log) game.write(text, kind as Parameters<Game['write']>[1], at);
  game.write(`You are on ${info.name}. Send somebody this page's address and they can join you.`, 'system');
  game.write(
    account
      ? `You are signed in as ${account}.`
      : `You are playing as ${name}, which anybody could type. Settings (O) has a link to set up a name you can prove.`,
    'system',
  );
  await island.refreshPack();
  await island.refreshPeople();
  return { game, island, id };
}

/**
 * A uuid squeezed into the small number the roster files people under. The
 * roster is a drawing thing — it wants something to tell two bodies apart, not
 * something to look anybody up by, and it is never sent anywhere.
 */
function hashId(uid: string): number {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1000000;
}
