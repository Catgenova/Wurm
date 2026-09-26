import { MATERIAL_BY_ID } from '../../game/building';
import { furnitureDef } from '../../game/furniture';
import { billWords } from '../../game/items';
import { MOULD_BY_ID } from '../../game/metal';
import { ORDER_LIFE } from '../../game/orders';
import { RECIPE_BY_ID } from '../../game/recipes';
import { BOARD_TOP } from '../../game/boards';
import { IDLE_LOGOUT, WORKER_REST_EVERY, WORKER_REST_FIRST, WORKER_REST_MOST } from '../../game/keep';
import { REPORTS_A_SESSION } from '../../net/errors';
import { numberWord, spanWords } from '../../game/words';
import { GRAVE_KEEPS, GRAVE_REACH } from '../../game/graves';
import { UI_SIZE_MAX, UI_SIZE_MIN } from '../screen';
import { defaultKey } from '../../game/keybinds';
import { guidePages } from '../../game/guide';
import { MUTE_FOR, MUTE_SHUTS } from '../../game/keeper';
import { awayFor } from '../../game/away';
import { ARMOUR, SHIELDS, WEAPONS } from '../../game/gear';
import { JEWEL_PIECES } from '../../game/gems';
import { itemDef, RARITIES } from '../../game/items';
import { weaponCarry } from '../../render/figure';
import type { UIWindow } from '../windows';

/**
 * What's new: what changed on the island, a line each, shown once as you come
 * ashore after it changed.
 *
 * Asked for: "What's new, on login. Players aren't told when things change,
 * such as today's cost increases and the caravel. A short note after each
 * deploy would say what changed."
 *
 * One entry a deploy, numbered in the order they went out. A browser keeps
 * the highest number it has shown (`SEEN`), and the window opens by itself on
 * the way in when there is a higher one, with the ones it has not shown
 * marked. A browser nobody has played in before is not behind, it is new: it
 * is marked up to date without being shown anything, since a list of what
 * changed is no use to somebody who never saw it the other way.
 *
 * Every line says what changed and by how much, in the game's own terms, and
 * takes its numbers from the rule where the rule has them (CLAUDE.md). So a
 * line reads what is true now, which for a note a few days old is what it
 * said when it was written.
 */

interface News {
  /** Counted up from one, a deploy each; see `SEEN`. */
  n: number;
  /** The day it reached the island. */
  day: string;
  /** What changed. Worked out when the window is drawn, from the rules as they stand. */
  lines: () => string[];
}

/** A piece's bill, as its recipe has it. */
const pieceBill = (id: string): string => billWords(furnitureDef(id).bill, true);
/** A recipe's bill. */
const recipeBill = (id: string): string =>
  billWords((RECIPE_BY_ID.get(id)?.inputs ?? []).map((i): [string, number] => [i.item, i.count ?? 1]), true);
/** A solid wall's bill in a material. */
const wallBill = (id: string): string => billWords(MATERIAL_BY_ID.get(id)?.bill ?? [], true);
const pct = (k: number): string => `${Math.round(k * 100)}%`;
/** "a, b or c". */
const either = (parts: string[]): string =>
  parts.length > 1 ? `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}` : (parts[0] ?? '');

export const NEWS: News[] = [
  {
    n: 1,
    day: '2026-09-25',
    lines: () => [
      'Creature crates: a crate holds one wildermon. With one already following you, another is tamed only into an empty crate in your pack. Nothing is kept at the token any more: what was is in crates set down beside it, or in its keeper\'s pack where there was no room.',
      'A young one follows its keeper when nothing else does; otherwise it goes into an empty crate in their pack, then into an empty crate of theirs standing on their settlement, the nearest its dam; with none of those it goes wild.',
      'Butchering is raised by butchering on an island as well as by yourself, and what comes off a carcass is made at your Butchering and your knife, the way every trade makes its work. The carcass\'s own quality no longer lowers it.',
      'A citizen may leave a settlement they were asked onto, from its menu on its land or from the Settlement window, and may found one of their own.',
      'The market board, in the Market window at a settlement token or a mailbox: every stall on the island, what is priced on it, where it stands and whose it is. A wildermon in its crate can be offered in a deal, sold off a stall or posted, and whoever the crate goes to keeps it.',
      `Leaderboards: the ${BOARD_TOP} highest in each skill, the ${BOARD_TOP} best-bred wildermon and the ${BOARD_TOP} biggest settlements on the island.`,
      'A young one\'s creature window names its dam and its sire, and says which of them each trait you can read came from.',
      `While you were away: coming back ashore, a window lists what your workers put into the stores, the young your wildermon had, what your stalls sold and the parcels posted to you, counted from ${IDLE_LOGOUT / 60} minutes after your browser was last heard from.`,
    ],
  },
  {
    n: 2,
    day: '2026-09-25',
    lines: () => {
      const caravel = furnitureDef('caravel'), sailer = furnitureDef('sailing_boat');
      return [
        `Walls cost more, to the scale of the cobblestone wall's ${wallBill('cobblestone')}: a log wall is ${wallBill('log')}, a plank wall ${wallBill('plank')}, a marble wall ${wallBill('marble')}. Floors, stairs, roofs and fences rise with their material. What was already planned keeps the bill it was planned with.`,
        `Furniture's planks, timber, cloth, stone bricks and mortar went up four times and its nails and metal ribbon twice; legs, wheels, ropes, castings and the other parts you count did not. A chest is ${pieceBill('chest')}.`,
        `A smelter is ${recipeBill('make_smelter')}, a kiln ${recipeBill('make_kiln')}, and an anvil is poured from ${MOULD_BY_ID.get('anvil_mould')?.lumps ?? 0} lumps. Traps went up the way furniture did.`,
        `A rowing boat is ${pieceBill('rowing_boat')}; a sailing boat ${pieceBill('sailing_boat')}.`,
        `The caravel, a third hull: ${pieceBill('caravel')}. She holds ${caravel.capacity} things, carries ${caravel.boat?.passengers} passengers as well as whoever has her helm, sails at ${caravel.boat?.speed} tiles a second against the sailing boat's ${sailer.boat?.speed}, and wants ${numberWord(caravel.boat?.draught ?? 0)} deep of water under her.`,
      ];
    },
  },
  {
    n: 3,
    day: '2026-09-25',
    lines: () => [
      'A padlock on a ship, a wagon or a cart: without its key nobody takes her helm or the reins, comes aboard, takes hold of the shafts or picks her up. Stepping ashore and getting down are never refused.',
      `Settings, Display: text and window size, from ${pct(UI_SIZE_MIN)} to ${pct(UI_SIZE_MAX)}. Every window, menu and bar and the writing in them; the island itself is not scaled.`,
      `A worker with nothing to do looks for work again after ${WORKER_REST_FIRST} seconds, a second later for every ${WORKER_REST_EVERY} it has stood idle, and never less often than every ${WORKER_REST_MOST} seconds.`,
      `Something that goes wrong in your browser is sent to the island, each different thing once and at most ${REPORTS_A_SESSION} a session, with the version of the game it happened in, so it can be found and fixed.`,
    ],
  },
  {
    n: 4,
    day: '2026-09-25',
    lines: () => [
      'People on a caravel are drawn among her sails: a sail nearer you than they are is drawn over them, and one further off behind them.',
      'A piece is clicked anywhere it is drawn, where that is bigger than the tile it stands on: a caravel at her bow and her stern.',
      `Buy orders, in the Market window at a settlement token or a mailbox: name a thing, the least quality that will do, how many and the silver for each, and the whole price is held out of your purse. Anybody else there can fill some or all of it from their pack and is paid at once; what they bring comes to you by the post. Take an order back whenever you like; one left open for ${ORDER_LIFE / 86400} days takes itself back, with what it still holds.`,
      `The Field guide (${defaultKey('win_guide')}): a page for each of the ${guidePages().length} kinds of creature, marking whether you have seen, tamed and bred it, where it lives and what it gives.`,
      'What\'s new: this window, opened as you come ashore when something has changed since you last read it, and from the UI Menu at any time.',
    ],
  },
  {
    n: 5,
    day: '2026-09-25',
    lines: () => [
      `Dying: your pack, what is in your hands, your toolbelt and every bag with what is in it go into a grave where you fell, or on the nearest dry ground within ${GRAVE_REACH} tiles if you fell in deep water. Only you can open it or take from it, and ${spanWords(GRAVE_KEEPS)} after you fell it crumbles with whatever is still in it. What you wear stays on you, and so does a crate with a wildermon in it.`,
      'Two payments out of one purse at the same moment no longer both go through: the second waits for the first, and is refused if what is left will not cover it.',
    ],
  },
  {
    n: 6,
    day: '2026-09-26',
    lines: () => [
      'An island has keepers: whoever founded it, and whoever keeps every island. A keeper sees everybody on the island, can move a body that is stuck to the token of the settlement it founded, or to where newcomers come ashore if it founded none, and can clear everything lying on a tile.',
      `A keeper can mute somebody ${either(MUTE_FOR.map((secs) => (secs === null ? 'until a keeper lifts it' : `for ${awayFor(secs)}`)))}. Until then the island refuses ${MUTE_SHUTS}, and says until when.`,
    ],
  },
  {
    n: 7,
    day: '2026-09-26',
    lines: () => {
      const shine = RARITIES.slice(1).map((r) => r.name);
      return [
        `What you wear and hold is drawn on you, on everybody else and on you as they see you: each of the ${ARMOUR.length} pieces of armour, ${WEAPONS.length} weapons, ${Object.keys(SHIELDS).length} shields, the toolbelt and the ${JEWEL_PIECES.length} jewels is a model of its own, in the metal, wood or stone it was made of and the colour it was dyed, and any of them can be worn with any other.`,
        'A weapon is held in the hand, a bow in the other and a shield on the arm.',
        `${either(shine).replace(/^./, (c) => c.toUpperCase())} things shine where they are worn, each in its own colour: a glint crosses everything of one rarity together, a ${shine[1]} one's colour comes and goes, and a ${shine[2]} one sparkles.`,
      ];
    },
  },
  {
    n: 8,
    day: '2026-09-26',
    lines: () => {
      const shine = RARITIES.slice(1).map((r) => r.name);
      // The weapons each way, named as the figure draws them.
      const held = (pick: (c: { carry: string; stow: string }) => boolean): string =>
        either(WEAPONS.filter((w) => { const c = weaponCarry(w.id); return !!c && pick(c); }).map((w) => itemDef(w.id).name.toLowerCase()));
      return [
        `A ${held((c) => c.carry === 'shoulder')} is carried over your shoulder.`,
        `While you work, swim, hold the reins, wave or hop, what you hold is put away: a ${held((c) => c.stow === 'hip')} into its scabbard at your left hip, a ${held((c) => c.stow === 'belt')} through your belt at the right, and anything else across your back on a strap, with a shield over it.`,
        `A ${either(shine)} piece is edged in its colour on the side away from the light, and whatever is worn over it covers its shine as well as the piece.`,
      ];
    },
  },
  {
    n: 9,
    day: '2026-09-26',
    lines: () => {
      const carried = (how: string): string[] => WEAPONS.filter((w) => weaponCarry(w.id)?.carry === how).map((w) => itemDef(w.id).name.toLowerCase());
      const shouldered = carried('shoulder');
      return [
        'Each class of armour has an outline of its own: cloth is padded to the knee and split for the stride, leather has a tall collar, shoulder caps and a skirt in four flared panels, mail is split front and back, and dragon scale lies in overlapping courses from the head to the feet.',
        `A ${either(shouldered)} goes over whichever shoulder keeps it clear of your head from where you are seen. A bow is held upright at your side, higher the longer it is and higher again at a run, so its lower tip never reaches the ground, and a ${either(carried('staff'))} leans out past your face.`,
      ];
    },
  },
  {
    n: 10,
    day: '2026-09-26',
    lines: () => {
      const shine = RARITIES.slice(1).map((r) => r.name);
      const carried = (how: string): string[] => WEAPONS.filter((w) => weaponCarry(w.id)?.carry === how).map((w) => itemDef(w.id).name.toLowerCase());
      return [
        `A ${either(carried('fist'))} in your hand turns out to your side wherever it would otherwise point at whoever is looking or hide behind you, so it shows from every side. A ${either(['bow', ...carried('staff')])} leans back rather than forward where forward would cross your head, and a ${either(carried('shoulder'))} is carried more upright seen from behind.`,
        `A ${either(shine)} piece keeps its own metal, wood or dye: its rarity's colour is in the line along its edges, the glint that crosses it and the stars, and nowhere else.`,
        'Mail is drawn as rows of rings and dragon scale as overlapping scales at the size the island is played at. Cloth and leather show a lit side and a shaded side as the body does, and a cap, a coat and breeches of one dye are each a step lighter or darker.',
        'The toolbelt carries a claw hammer behind your left hip and a pocket of chisel and awl handles at your right.',
      ];
    },
  },
  {
    n: 11,
    day: '2026-09-26',
    lines: () => {
      const shine = RARITIES.slice(1).map((r) => r.name);
      const named = (id: string): string => itemDef(id).name.toLowerCase();
      const knives = WEAPONS.filter((w) => weaponCarry(w.id)?.front).map((w) => named(w.id));
      return [
        `Your hair shows below the rim of a ${either(['wool_cap', 'leather_cap', 'helm', 'scale_helm'].map(named))}, and long hair hangs down below a ${named('wool_cap')} or a ${named('leather_cap')} as it is cut. A ${named('chain_coif')} covers all of it.`,
        `A ${either(knives)} is put away upright at the front of your belt, right of the buckle, rather than at your hip.`,
        `The ${named('hatchet')} has a square bit with a hammer's poll behind it, the ${named('throwing_axe')} a head sweeping up above a haft bowed toward it, the ${named('javelin')} vanes at its tail and the ${named('carving_knife')} a guard for the fingers. A ${named('chain_hauberk')} hangs longer and flares out past the hips.`,
        `Dragon scale's scales end in a broad U rather than a point, each hanging over the course below. A ${either(shine)} piece of it shows its colour on the lit tips of its scales rather than in a line round its edge.`,
      ];
    },
  },
  {
    n: 12,
    day: '2026-09-26',
    lines: () => {
      const shine = RARITIES.slice(1).map((r) => r.name);
      const named = (id: string): string => itemDef(id).name.toLowerCase();
      return [
        `Under a ${either(['wool_cap', 'leather_cap', 'helm', 'scale_helm'].map(named))} your hair is cut off at the rim: what shows is what hangs below it, and none of it through the crown. The ${named('helm')} and the ${named('scale_helm')} stand clear of the hair, with a guard over the back of the neck, and the ${named('leather_cap')} is sewn from four panels of a darker, redder hide than the coat.`,
        `A ${either(shine)} piece shows its colour as a sheen over the side of it the light falls on, rather than as a line round its edges. Its glint crosses it nearly all the time instead of most of it, and a ${shine[2]} one's glint is paler and its stars bigger.`,
        `A ${named('maul')} is slung head up; a ${named('spear')} or ${named('javelin')} is slung higher, so its butt is off the ground; a ${named('throwing_axe')} leans out from the belt, so its haft shows; and a sword in its scabbard hangs out from the leg, where it can be seen from the front.`,
        "Dragon scale's lower edges are pale where the light is on them and a mid green where it is not, instead of a dark line under every course.",
      ];
    },
  },
  {
    n: 13,
    day: '2026-09-26',
    lines: () => {
      const named = (id: string): string => itemDef(id).name.toLowerCase();
      return [
        `A ${named('leather_jerkin')} is studded with rivets over the chest and down its skirt.`,
        `A ${named('chain_hauberk')} bells out wider below the hips, and every skirt swings out wider the longer the stride.`,
      ];
    },
  },
];

/** The highest entry this browser has shown. */
const SEEN = 'wurm.news.seen';

/**
 * Whether this browser has been played in before this page was opened: a
 * window put somewhere, which every session that did anything at all leaves
 * behind (`WindowManager.persist`). Read once, as the page loads, before this
 * session can write one of its own.
 */
const PLAYED_HERE = ((): boolean => {
  try {
    return localStorage.getItem('wurm-iso-windows') !== null || localStorage.getItem(SEEN) !== null;
  } catch {
    return false;
  }
})();

const latest = (): number => Math.max(0, ...NEWS.map((e) => e.n));

function seen(): number {
  try {
    const v = Number(localStorage.getItem(SEEN));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN, String(latest()));
  } catch {
    // A browser that keeps nothing is shown the news each time, which is the price of it.
  }
}

/**
 * The entries to show as you come ashore: those past the last one this
 * browser showed, or none for a browser nobody has played in.
 */
export function unseenNews(): number {
  if (!PLAYED_HERE) {
    markSeen();
    return 0;
  }
  return NEWS.filter((e) => e.n > seen()).length;
}

const DAY_WORDS = (day: string): string => {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/**
 * The window: every entry, newest first under the day it went out, the ones
 * this browser had not shown marked. Drawn each time it opens, since what it
 * marks depends on what was seen before it was opened, and then marked seen.
 */
export class NewsPanel {
  constructor(private readonly win: UIWindow) {
    win.body.classList.add('news-body');
    win.onOpen = () => this.draw();
    if (win.isOpen) this.draw();
  }

  private draw(): void {
    const was = seen();
    const body = this.win.body;
    body.replaceChildren();
    let day = '';
    for (const e of [...NEWS].sort((a, b) => b.n - a.n)) {
      if (e.day !== day) {
        day = e.day;
        const h = document.createElement('h4');
        h.className = 'news-day';
        h.textContent = DAY_WORDS(day);
        body.append(h);
      }
      const list = document.createElement('ul');
      list.className = 'news-entry' + (e.n > was ? ' news-new' : '');
      for (const line of e.lines()) {
        const li = document.createElement('li');
        li.textContent = line;
        list.append(li);
      }
      body.append(list);
    }
    markSeen();
  }
}
