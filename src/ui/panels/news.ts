import { MATERIAL_BY_ID } from '../../game/building';
import { furnitureDef } from '../../game/furniture';
import { billWords } from '../../game/items';
import { MOULD_BY_ID } from '../../game/metal';
import { ORDER_LIFE } from '../../game/orders';
import { RECIPE_BY_ID } from '../../game/recipes';
import { BOARD_TOP } from '../../game/boards';
import { IDLE_LOGOUT, WORKER_REST_EVERY, WORKER_REST_FIRST, WORKER_REST_MOST } from '../../game/keep';
import { REPORTS_A_SESSION } from '../../net/errors';
import { article, listed, numberWord, percent, share, spanWords, times } from '../../game/words';
import { ANCIENT_EFFECTS, ANCIENT_PLUS, BAUBLE_HIGH, BAUBLE_LOW, BAUBLE_SHARE, BAUBLE_TIERS, baubleTimes, YIELD_TIMES } from '../../game/baubles';
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
import { CLIMB_LEARN_FROM, MAX_STEP } from '../../game/player';
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
  {
    n: 14,
    day: '2026-09-26',
    lines: () => {
      const shine = RARITIES.slice(1).map((r) => r.name);
      const named = (id: string): string => itemDef(id).name.toLowerCase();
      const onBack = WEAPONS.filter((w) => weaponCarry(w.id)?.stow === 'back').map((w) => named(w.id));
      const bows = WEAPONS.filter((w) => weaponCarry(w.id)?.carry === 'bow').map((w) => named(w.id));
      return [
        `A ${either(onBack)} put away on your back goes up over whichever shoulder shows it from where you are seen, with an axe's bit and a bow's bend turned to face you. A ${named('battle_axe')} or ${named('maul')} carried on the shoulder rises back over it, its head above and behind.`,
        `A ${either(bows)} is held upright at your side with its lower tip clear of your boots.`,
        `A ${named('chain_coif')} closes under the chin and over the ears, leaving the face framed in mail.`,
        `A ${shine[2]} piece's sheen is gold, and its glint gold rather than white. The colour of any ${either(shine)} piece goes under the rings of mail and the edges of scale rather than over them, and none of it goes on a thin rim.`,
        `Leather is lighter in colour. A ${named('leather_jerkin')} has a strap and buckle across the chest, stitching down the front and a pale collar and shoulders; a ${named('leather_cap')} has a rolled rim, seams from the rim to the crown and narrower ear flaps.`,
        `The ${named('hatchet')} has a bearded bit, and put away it and the ${named('throwing_axe')} turn their blades out from the hip. The ${named('butchering_knife')} has a broad sheath, scabbards are dark leather, and seated, a sword's lies back along the seat. A ${named('jewelled_ring')} is a band on one finger.`,
        `Plate arms have one domed plate over two lames at the shoulder, a ${named('helm')}'s cheek plates curve round the jaw, and a ${named('scale_helm')}'s spines are fins. Long hair narrows in under a cap or helm.`,
      ];
    },
  },
  {
    n: 15,
    day: '2026-09-26',
    lines: () => {
      const named = (id: string): string => itemDef(id).name.toLowerCase();
      return [
        `Dragon scale is laid in fewer, larger scales, mail's rows of rings are further apart, and a ${named('chain_hauberk')} flares wider below the hips.`,
        `A ${either(Object.keys(SHIELDS).map(named))} is thicker at the rim, so seen edge on it is a band rather than a line. A blade in full light is pale steel rather than white, and bare arms are outlined as darkly as armour is.`,
      ];
    },
  },
  {
    n: 16,
    day: '2026-09-26',
    lines: () => {
      const named = (id: string): string => itemDef(id).name.toLowerCase();
      return [
        `Filling, emptying or pouring out one ${named('bucket')} of several you got at once takes that one off the pile, in your pack or the same bag. It used to do nothing, and filling still drew the water out of the well or barrel.`,
      ];
    },
  },
  {
    n: 17,
    day: '2026-09-26',
    lines: () => {
      const shine = RARITIES.slice(1).map((r) => r.name);
      const named = (id: string): string => itemDef(id).name.toLowerCase();
      const bows = WEAPONS.filter((w) => weaponCarry(w.id)?.carry === 'bow').map((w) => named(w.id));
      const shouldered = WEAPONS.filter((w) => weaponCarry(w.id)?.carry === 'shoulder').map((w) => named(w.id));
      const slungHeavy = WEAPONS.filter((w) => { const c = weaponCarry(w.id); return c?.carry === 'shoulder' && c.stow === 'back' && c.headUp; }).map((w) => named(w.id));
      const slungPoles = WEAPONS.filter((w) => weaponCarry(w.id)?.carry === 'staff' && weaponCarry(w.id)?.stow === 'back').map((w) => named(w.id));
      return [
        `A ${either(shine)} piece is its rarity's colour over the whole of its lit side, wood and leather as well as metal, and keeps it between glints.`,
        `A ${either(bows)} is held out past the hip, where it shows from every side, and turned so its bend shows rather than its edge.`,
        `Seen from behind, a ${either(shouldered)} carried on the shoulder rises from behind it, its haft showing under an axe's or a maul's head, and the arm that carries it goes round the far side of the body.`,
        `While you work, a ${either(slungHeavy)} on your back hangs head down, and a ${either(slungPoles)} hangs lower, clear of the hammer.`,
        `Leather is red-brown, apart from the colour of skin, with a sheen on its lit side. The knee pads on ${named('leather_trousers')} are flat and darker.`,
        `${itemDef('cloth_sleeves').name} run into the coat at the shoulder and bend at the elbow without a joint showing. A ${named('cloth_tunic')}'s collar, hem and cuffs are faced in a lighter shade of its cloth.`,
        `A ${named('helm')}'s cheek plates narrow toward the chin and its neck guard flares; a ${named('scale_helm')} has a crest of splayed fins and cheek plates of scale. Long hair under a cap or helm is drawn in at the nape and falls in locks.`,
        `A ${named('chain_coif')}'s face opening narrows at the chin and is cut back at the cheek, so the face shows side on.`,
        `The hammer on a ${named('toolbelt')} hangs head down from a loop with its handle above the belt; a ${named('jewelled_ring')} shows a point of gold from every side; a ${named('wooden_shield')} has weathered boards and a dark rawhide rim; a ${named('chain_hauberk')}'s skirt flies out behind at a run; and an axe through the belt shows its blade from three-quarters on.`,
      ];
    },
  },
  {
    n: 18,
    day: '2026-09-26',
    lines: () => {
      const shine = RARITIES.slice(1).map((r) => r.name);
      const named = (id: string): string => itemDef(id).name.toLowerCase();
      return [
        `A ${either(shine)} piece is tinted its rarity's colour all over, on the side turned from the light as well as the lit side, and still shows what it is made of; the line round it is a dark of that colour.`,
        `Dragon scale is laid in courses of overlapping scales, its edges cut in points at the shoulders, elbows, knees, hem and boot tops, and its gauntlets are of the dark scale.`,
        `${itemDef('chain_sleeves').name} flare over the back of the hand and ${named('chain_leggings')} hang over the knee in ragged points; a ${named('chain_hauberk')}'s hem is a band of bright rings of its own metal.`,
        `Leather is a browner red, and dyed leather keeps the colour of its dye. ${itemDef('leather_sleeves').name} have no knob at the elbow. The pieces of a cloth or leather suit step further apart in shade from cap to shoes, and quilting is in wider channels. Copper is warmer, with pale edges and a green shadow.`,
        `Whatever is slung on your back hangs from a strap over the same shoulder, and while you work left-handed both are on the other shoulder. A ${named('long_bow')} is longer, and held further out in front at a run; a ${named('throwing_axe')} is held head up.`,
        `A ${named('chain_coif')}'s face opening comes to a point under the chin; a ${named('scale_helm')}'s fins stand on its crown; long hair under a cap or helm falls as one curtain.`,
      ];
    },
  },
  {
    n: 19,
    day: '2026-09-26',
    lines: () => [
      'Climbing is kept. It went up as you walked and then back to where the island had it at its next update or when you reloaded, because only your browser was raising it; the island raises it now.',
      `A step between tiles of more than ${share(CLIMB_LEARN_FROM)} of ${MAX_STEP} up or down trains it on your own feet only: not in a saddle, on a cart or a boat, on a bridge or on an upper floor.`,
    ],
  },
  {
    n: 20,
    day: '2026-09-26',
    lines: () => [
      'An altar is a coursed stone pedestal with the gold sun in its face and a gold dish on top. Over the dish a figure of stars joined by lines turns, with a ring of light round it, and at night the stars shine through the dark.',
    ],
  },
  {
    n: 21,
    day: '2026-09-26',
    lines: () => [
      'An altar can only be built while you stand on a settlement of yours: one you founded or one you are a citizen of.',
    ],
  },
  {
    n: 22,
    day: '2026-09-26',
    lines: () => [
      'An altar can only be set down on a settlement of yours as well. Altars already standing elsewhere stay where they are.',
    ],
  },
  {
    n: 23,
    day: '2026-09-26',
    lines: () => [
      `Baubles: ${percent(BAUBLE_SHARE)} of what archaeology turns up is now a tarnished bauble, ${listed(BAUBLE_TIERS.map((t) => `${percent(t.odds)} ${t.name.toLowerCase()}`))}. Restore it as you would a relic, and what it gives is rolled and written on it.`,
      `Set it into an altar on a settlement of yours, from Baubles on the altar's menu. A settlement has ${listed(BAUBLE_TIERS.map((t) => `${numberWord(t.slots)} ${t.name.toLowerCase()}`))} sockets, and its founder, mayors and builders get what is in them on every action they do on its land.`,
      `Minor: ${BAUBLE_LOW} to ${BAUBLE_HIGH}% less time per action, or ${BAUBLE_LOW} to ${BAUBLE_HIGH}% more skill gained, in one skill. Major: a ${BAUBLE_LOW} to ${BAUBLE_HIGH}% chance of ${times(YIELD_TIMES)} the yield of each action in one skill. Ancient: +${ANCIENT_PLUS} to every yield of one action, such as ${ANCIENT_EFFECTS[1].said}.`,
      `Rarity multiplies what it rolled: ${listed(RARITIES.slice(1).map((r, i) => `${times(baubleTimes(i + 1))} for ${article(r.name)} ${r.name} one`))}.`,
      'A bauble set into an altar stays there. Another can take its socket, and the one it replaces is destroyed.',
    ],
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
