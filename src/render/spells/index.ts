/**
 * How every spell is cast and what it looks like.
 *
 * A spell is drawn twice over: on the caster, as a cast -- a pose the body
 * goes through, wound up, let go and recovered from -- and in the world, as
 * effects: at the caster while it is cast, along the way to what it was cast
 * at, where it lands, and lingering there for as long as what it did lasts.
 * Both are a `SpellVisual`, one per spell, kept in this folder a group to a
 * file:
 *
 *   blade.ts berserker.ts pikeman.ts archer.ts skirmisher.ts chirurgeon.ts
 *   beastmaster.ts kindler.ts binder.ts warder.ts      the fighting trades
 *   blessing.ts justice.ts chaos.ts                    the patrons
 *
 * (the six arcane spells -- ember, pyre, snare, stillfield, aegis, bulwark --
 * are in kindler.ts, binder.ts and warder.ts). Each file exports its palette
 * and a record of its spells' visuals by spell id. Every spell starts as a
 * stand-in (`placeholder`, from `./generic`), picked by how it is cast
 * (`CastKind`) and drawn in its group's colours; drawing a spell properly is
 * replacing its line in its own file with a visual of its own. Nobody else's
 * file is touched, and neither is this one or the kit.
 *
 * ## A visual
 *
 *     blade_lunge: {
 *       cast: {
 *         timing: { secs: 0.9, release: 0.45 },
 *         pose: (r, t, c) => { ... write the Rig at t, nought to one over the cast ... },
 *       },
 *       fx: {
 *         charge: (k, t) => { ... at the caster while it is cast ... },
 *         release: (k) => { ... once, the moment it leaves the hand ... },
 *         travel: { secs: (tiles) => tiles * 0.05, draw: (k, u) => { ... on its way, u nought to one ... } },
 *         hit: (k) => { ... once, the moment it lands ... },
 *         impact: { secs: 0.6, draw: (k, u) => { ... where it landed ... } },
 *         linger: { draw: (k, age, left) => { ... for as long as it lasts ... } },
 *       },
 *     },
 *
 * Every part is optional. The times run off the cast's start: the pose plays
 * over `timing.secs`; the spell leaves the hand at `release` of the way through
 * it; with a `travel` it lands that many seconds later, without one at once;
 * `impact` plays from the landing; `linger` from the landing for the spell's
 * `lasts` (its `secs`, or how long it holds -- see `SpellInfo`) or the
 * `secs` it gives itself.
 *
 * ### The pose
 *
 * `pose(r, t, c)` writes the body's `Rig` (render/figure.ts: degrees per joint,
 * `arm[k]` = [forward, out, turned in] with k = 1 the right; `elbow[k]` bend;
 * `spine`/`chest`/`neck`/`head` = [pitch, roll, yaw], a positive pitch leaning
 * back; `leg`, `knee`, `open[k]` for an open hand, `wield` to have a weapon in
 * the right fist follow the forearm through a blow). Write the pose as it is at
 * full strength: the stage blends into it over the first `blendIn` and out of
 * it over the last `blendOut` of the cast (unless `blend: false`), so a cast
 * never snaps. While the caster walks, swims or drives only the arms and the
 * trunk are taken from it. The body is turned to face what it is cast at
 * before the cast starts, so "ahead" is at the target.
 *
 * ### The effects
 *
 * Every `fx` function gets `k`, an `FxScene` (`./kit`): `k.caster`,
 * `k.target` (the caster again for a spell on oneself) and `k.spot` (where it
 * lands on the ground), `k.hand()`, `k.chest()`, `k.head()`, `k.heart(target)`,
 * `k.weaponAt(len)`, `k.local(body, right, ahead, up)`, `k.fx` (the spell's own
 * numbers: `k.fx.reach`, `k.fx.secs` ...), `k.state` for anything a cast keeps
 * between frames, and every shape the kit has: `ring`, `disc`, `sigil`,
 * `scorch` on the ground; `orb`, `bolt`, `beam`, `ribbon`, `slash`, `shell`,
 * `pillar`, `shards`, `mark`, `polyline`, `string`, `shapes` in the world
 * (`groundPath` on the ground); `glow`, `flare` as light; `light` for the
 * night; `burst` and `emit` for particles; `flash` for the screen. They are
 * called afresh every frame and draw only that frame. `k.bodiesWithin(r)`
 * finds who an area covers; `k.from` is where the island moved the caster
 * from for this cast; `k.target.burning` (and `bleeding`, `held`) what the
 * island says is on a creature.
 *
 * Opt-in, and nothing changes for a spell that does not ask: `cast.face`
 * (turn to the companion, or not at all), `cast.hold` (hold the pose past the
 * cast), `cast.move` (when a move the island made is travelled),
 * `linger.on` (what a linger ends with), the cue's `at` (what it was cast at)
 * and `held`; `cast.mirror` (a shouldered weapon swung left-handed from the
 * left shoulder, rather than changed into the right hand in a frame),
 * `cast.close` (the body carried in to what it strikes for the blow, the
 * island's blows being struck from up to 2.2 tiles), `cast.pull` and
 * `cast.companion` (a target or a companion the island moved, carried from
 * where it stood); the cue's `aim` (where the target stands and how tall it
 * is), `moved`, `companion`, `lefty`, `look`.
 *
 * ## Seeing one
 *
 *     node /home/user/Wurm/node_modules/.cache/anim/spell.mjs --root <worktree> --spell blade_lunge \
 *       --facing 1 --frames 10 --zoom 4 --target creature --out /path/sheet.png
 *
 * draws a sheet of frames through the cast -- the caster, a stand-in target at
 * the right distance, every effect -- on a patch of ground (`--target`
 * creature | player | tile | self; `--night 1` for the dark, `--fast 1` for
 * fast graphics, `--secs` to run on past the cast for what lingers). In the
 * game, `wurm.spell('blade_lunge')` in the console plays it from you at
 * whatever is under the cursor, with no island needed (`?alone` works), and
 * `wurm.spells` lists every id.
 *
 * SPELLS.md, in this folder, is the long form of all of this for
 * whoever draws the spells: the palettes, the conventions, the budgets.
 */
import { castPosesBy, figureShoulder, mirrorRig, weaponCarry, type FigurePose, type HandGoal, type Rig, type V3 } from '../figure';
import type { FxScene, SpellPalette } from './kit';
import type { CastKind, SpellGroup, SpellInfo } from './info';
import { BLADE } from './blade';
import { BERSERKER } from './berserker';
import { PIKEMAN } from './pikeman';
import { ARCHER } from './archer';
import { SKIRMISHER } from './skirmisher';
import { CHIRURGEON } from './chirurgeon';
import { BEASTMASTER } from './beastmaster';
import { KINDLER } from './kindler';
import { BINDER } from './binder';
import { WARDER } from './warder';
import { BLESSING } from './blessing';
import { JUSTICE } from './justice';
import { CHAOS } from './chaos';

export type { CastKind, SpellGroup, SpellInfo };
export { ALL_SPELL_IDS, spellInfo, spellsIn, SPELL_GROUPS } from './info';

/** When a cast's moments fall: all of it `secs` long, the spell let go at `release` of the way through. */
export interface CastTiming {
  /** Seconds, start of the wind-up to the end of the recovery. A quick blow is half a second; a great working two. */
  secs: number;
  /** Nought to one: when it leaves the hand, which is when a blow lands and when a bolt sets off. */
  release: number;
  /** Shares of the cast taken blending into the pose and back out of it. 0.12 and 0.25 when not given. */
  blendIn?: number;
  blendOut?: number;
}

/**
 * What a cast went at, as its pose is told it: the caster themselves (a
 * self-heal, a skin), another person, a creature, a patch of ground. A pose
 * that reaches out at an ally can keep its hands in when it is on itself.
 */
export type CastTarget = 'self' | 'person' | 'creature' | 'spot';

/** What a pose is told besides the time. */
export interface PoseCue {
  timing: CastTiming;
  /**
   * What it was cast at. Always given by the stage; optional only so that a cue
   * a pose builds for itself (`{ ...c, timing }`) still type-checks.
   */
  at?: CastTarget;
  /** How far through a held pose (`cast.hold`) it is, nought to one: nought before and with no hold, one once it is let go. */
  held?: number;
  /** Which of the eight ways the body is turned, as drawn: nought at the viewer, two to screen right. */
  facing: number;
  /** On the move: only the arms and the trunk will be kept. */
  moving: boolean;
  /** How what is in the right hand (or a bow, the left) is carried, or nothing. */
  carry: 'fist' | 'staff' | 'bow' | 'shoulder' | null;
  /**
   * Played left-handed (`cast.mirror`): the pose is written right-handed as ever, and mirrored onto the left side of
   * the body after. `facing` is then the facing of the picture as a mirror shows it (`(8 - facing) % 8`), and `aim`
   * mirrored with it, so a pose that does something by facing does it where it shows.
   */
  lefty?: boolean;
  /**
   * Where what it was cast at stands from the caster, for a blow that has to get there: see `CastAim`. Nothing for
   * a cast on oneself. Given by the stage; a cue a pose builds for itself may leave it out.
   */
  aim?: CastAim;
  /** The caster's look, for a pose that solves a hand or a foot for the caster's own build (`stepIn`, `reachHand`). */
  look?: import('../../game/look').Look;
  /**
   * Tiles the island moved the caster for this cast (a Lunge's stride, a Parting Throw's leap), which the stage carries
   * the body over (`cast.move`); nought when it did not -- already in reach, a Lunge has nothing to run.
   */
  moved?: number;
  /**
   * Where the caster's companion stands from the caster, in the body's frame and height units (`ahead`, `aside` to the
   * right), for a pose that reaches to it or turns to it (a wound licked, a command pointed); nothing with none.
   */
  companion?: { ahead: number; aside: number };
}

/**
 * Where a cast's target is from the caster, in the body's own frame and units (height units, a tenth of a metre;
 * a tile is `UNITS_PER_TILE` = 40; a person about 18 tall): `ahead` along the way the caster faces to the middle of
 * the target, `aside` to the caster's right of that line (the body is turned to the nearest of eight ways, so up to
 * a little under half `ahead`), `near` ahead to its near side (its middle less its half-width), and `head`,
 * `chest`, `top` how high its head, its chest and the top of it stand over the caster's feet. For a spot on the
 * ground the three heights are the ground's there. All from where the caster stands, before any closing in: `close`
 * is how far the stage carries the body in toward it for the blow (`cast.close`), nought without.
 */
export interface CastAim {
  ahead: number;
  aside: number;
  near: number;
  head: number;
  chest: number;
  top: number;
  close: number;
}

/**
 * A melee cast closing in on what it strikes: the body drawn carried toward the target over the wind-up, from `from`
 * to `to` of the way through the cast (nought to the release), by as much as the blow falls short of its near side
 * -- the blow reaching `reach` height units ahead of the feet (six, and the weapon's length) -- and no further than
 * `most` tiles (two); and back from `back` (the follow-through, a third of the way from the release to the end) to the
 * end. The island has not moved the body, so it is put back where it stands. Not while it walks.
 */
export interface CastClose {
  from?: number;
  to?: number;
  back?: number;
  reach?: number;
  most?: number;
}

/** A cast's pose: write `r` as the body is `t` (nought to one) of the way through the cast. */
export type CastPose = (r: Rig, t: number, c: PoseCue) => void;

/** The effects, each part optional; see the top of this file for when each is called. */
export interface SpellFx {
  charge?: (k: FxScene, t: number) => void;
  release?: (k: FxScene) => void;
  travel?: { secs: (tiles: number) => number; draw: (k: FxScene, u: number) => void };
  hit?: (k: FxScene) => void;
  impact?: { secs: number; draw: (k: FxScene, u: number) => void };
  /**
   * `age` seconds since it landed and `left` to go; `secs` to last other than the spell's own `lasts`. `on` is what it
   * lingers on, which is what ends it early by going: the target (the default: a creature killed, a person gone), the
   * caster (a stance, a skin of one's own after a strike: it plays on when the creature struck dies), or the spot
   * (an area on the ground, which only its seconds end).
   */
  linger?: { secs?: number; on?: 'target' | 'caster' | 'spot'; draw: (k: FxScene, age: number, left: number) => void };
}

/** How the caster is turned as a cast begins: to what it is cast at (the default), to the companion, or not at all. */
export type CastFace = 'target' | 'companion' | 'none';

/**
 * Holding a pose past the cast: the pose stops at `at` of the way through (its
 * own clock, nought to one) for `secs` seconds, or for as long as the spell
 * lingers when `secs` is not given, and then plays on to its end. Walking off
 * ends the hold at once. Everything keyed to the cast -- `charge`, the release
 * when `at` comes before it, the blend out -- waits through the hold with it.
 */
export interface CastHold {
  at: number;
  secs?: number;
}

/**
 * How the caster's body travels for a move the island made before the cast
 * was drawn (a Lunge, a Parting Throw: the island has already put the body
 * where it ends up): from where it stood to where it is, between `from` and
 * `to` of the way through the cast (nought to the release when not given),
 * eased smoothly. Without one, such a cast still travels over that much.
 */
export interface CastMove {
  from?: number;
  to?: number;
}

/**
 * The caster's companion moved by the spell: the island has already put it where it ends up, and the stage draws it
 * carried from where it stood as the cast was made, between `from` and `to` of the way through (nought to the
 * release). Put on its master's own spot (`beside`, the default), it is drawn a step off to its master's left
 * instead of inside the body.
 */
export interface CastCompanion {
  from?: number;
  to?: number;
  beside?: boolean;
}

/** The cast laid on a figure (`FigurePose.cast`): its id and how far through, and what the pose is told besides. */
export interface CastNow {
  id: string;
  t: number;
  at?: CastTarget;
  held?: number;
  aim?: CastAim;
  moved?: number;
  companion?: { ahead: number; aside: number };
}

export interface SpellVisual {
  /** Whose colours. */
  palette: SpellPalette;
  /**
   * `mirror`: played left-handed when what is in the hands is shouldered (a maul, a battle axe) and is on the left
   * shoulder as the cast is drawn -- which the figure does from three of the eight ways (3, 6 and 7), to keep it off
   * the head -- so the weapon is swung from the hand it is already in rather than changing hands in a frame. The
   * pose is written right-handed; the framework mirrors it, its `reach` goals and its kneel, and tells the pose
   * (`c.lefty`) and the effects (`k.lefty`, `k.side`).
   *
   * `close`: a melee cast closing in on what it strikes (`CastClose`; `true` for the defaults).
   *
   * `pull`: the target moved by the spell (a Hook dragging a creature in): the island has already put it where it
   * ends up, and the stage draws it carried from where it stood as the cast was made, between `from` and `to` of
   * the way through (nought to the release), as `move` carries the caster.
   *
   * `companion`: the caster's companion moved by the spell (`CastCompanion`): a Pounce's leap, a Guard Me's step in.
   */
  cast: { timing: CastTiming; pose: CastPose; blend?: boolean; face?: CastFace; hold?: CastHold; move?: CastMove; mirror?: boolean; close?: boolean | CastClose; pull?: boolean | CastMove; companion?: boolean | CastCompanion };
  fx: SpellFx;
  /** A stand-in, until somebody draws it properly. */
  placeholder?: boolean;
}

/** Every spell's visual by id, the thirteen files' records together. */
export const SPELL_VISUALS = new Map<string, SpellVisual>();
for (const group of [BLADE, BERSERKER, PIKEMAN, ARCHER, SKIRMISHER, CHIRURGEON, BEASTMASTER, KINDLER, BINDER, WARDER, BLESSING, JUSTICE, CHAOS]) {
  for (const [id, v] of Object.entries(group)) SPELL_VISUALS.set(id, v);
}
export const visualOf = (id: string): SpellVisual | undefined => SPELL_VISUALS.get(id);

/** How long a spell lingers once it has landed, in seconds: its own `linger.secs`, or what the spell lasts. */
export function lingerSecs(v: SpellVisual, info: SpellInfo | undefined): number {
  if (!v.fx.linger) return 0;
  return v.fx.linger.secs ?? info?.lasts ?? 0;
}

/* ---- the cast on the body ------------------------------------------------------------ */

type Deep = number | boolean | Deep[] | { [k: string]: Deep } | undefined;
const copy = (v: Deep): Deep => (Array.isArray(v) ? v.map(copy) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])) : v);
/** `to`, `w` of the way from `from`: every number in it, however deep; a switch goes over at halfway. */
function mixDeep(from: Deep, to: Deep, w: number): Deep {
  if (typeof to === 'number') return (typeof from === 'number' ? from : 0) + (to - (typeof from === 'number' ? from : 0)) * w;
  if (typeof to === 'boolean') return w >= 0.5 ? to : from ?? to;
  if (Array.isArray(to)) return to.map((x, i) => mixDeep(Array.isArray(from) ? from[i] : undefined, x, w));
  if (to && typeof to === 'object') {
    const f = from && typeof from === 'object' && !Array.isArray(from) ? from : {};
    const out: { [k: string]: Deep } = {};
    for (const k of Object.keys(to)) out[k] = mixDeep(f[k], to[k], w);
    return out;
  }
  return w >= 0.5 ? to : from;
}

const smooth = (u: number): number => { const v = Math.max(0, Math.min(1, u)); return v * v * (3 - 2 * v); };
/** How much of the pose is the cast's at `t`: in over `blendIn`, out over `blendOut`. */
export function castWeight(t: number, timing: CastTiming): number {
  const a = timing.blendIn ?? 0.12, b = timing.blendOut ?? 0.25;
  return smooth(a > 0 ? t / a : 1) * smooth(b > 0 ? (1 - t) / b : 1);
}

/**
 * Whether a cast on a body posed as `pose` is played left-handed (`cast.mirror`): it asks to be, and what is in the
 * hands is on the left shoulder -- as the body drawn has it, between frames as well (`figureShoulder`). The stage
 * asks this for the effects (`k.lefty`); `castOver` asks the pose itself, which comes to the same.
 */
export function castLefty(pose: FigurePose): boolean {
  const v = pose.cast && SPELL_VISUALS.get(pose.cast.id);
  return !!v?.cast.mirror && !pose.swimming && !pose.driving && !pose.working && figureShoulder(pose) === 0;
}

/**
 * The pose the other way about, left for right, for a cast played left-handed: the figure's own mirror (the joints,
 * the hands' shapes), and what a cast adds to it -- each hand's goal (`reach`) put on the other hand at the mirror
 * place, the knee it kneels on, and the shoulder carried over. Its own undoing.
 */
function flip(r: Rig): void {
  mirrorRig(r);
  const m = (v: V3 | undefined): V3 | undefined => v && [-v[0], v[1], v[2]];
  if (r.reach) {
    const g = (h: HandGoal | undefined): HandGoal | undefined => h && { ...h, at: m(h.at) as V3, pole: m(h.pole), haft: m(h.haft) };
    r.reach = [g(r.reach[1]), g(r.reach[0])];
  }
  if (r.kneel !== undefined || r.kneelLeft !== undefined) r.kneelLeft = !r.kneelLeft;
  r.carried = 1 - r.carried;
}

/** Lay the cast in `p.cast` over the pose the body was going to be in. Registered with the figure below. */
export function castOver(r: Rig, p: FigurePose): void {
  const cast = p.cast as CastNow | undefined;
  const v = cast && SPELL_VISUALS.get(cast.id);
  if (!cast || !v) return;
  const t = Math.max(0, Math.min(1, cast.t));
  const base = v.cast.blend === false ? null : (copy(r as unknown as Deep) as unknown as Rig);
  const carry = p.gear?.weapon ? weaponCarry(p.gear.weapon.id)?.carry ?? null : null;
  // Played left-handed: the weapon is on the left shoulder, so the cast is made with the left hand, which already has it.
  const lefty = !!v.cast.mirror && carry === 'shoulder' && r.carried === 0 && !r.swapping && !r.stowed;
  const aim = cast.aim && (lefty ? { ...cast.aim, aside: -cast.aim.aside } : cast.aim);
  if (lefty) flip(r);
  v.cast.pose(r, t, {
    timing: v.cast.timing, facing: lefty ? (8 - p.facing) % 8 : p.facing, moving: p.moving || p.swimming || !!p.driving, carry,
    at: cast.at ?? 'creature', held: cast.held ?? 0, lefty, aim, look: p.look, moved: cast.moved ?? 0,
    companion: cast.companion && (lefty ? { ...cast.companion, aside: -cast.companion.aside } : cast.companion),
  });
  if (lefty) flip(r);
  if (!base) return;
  const w = castWeight(t, v.cast.timing);
  const mixed = mixDeep(base as unknown as Deep, r as unknown as Deep, w) as unknown as Rig;
  // Which shoulder a weapon is on, its spin and a swap under way are switches, as in the figure's own blend: half way between
  // the shoulders is no shoulder at all, and a wrist looked up by it is not there.
  const switched = w < 0.5 ? base : r;
  mixed.carried = switched.carried; mixed.spin = switched.spin; mixed.swapping = switched.swapping;
  // Arrows on the string are counted, not a share: one or two, as a switch is (from none, at once).
  mixed.nocked = w < 0.5 && base.nocked !== undefined ? base.nocked : r.nocked;
  Object.assign(r, mixed);
}

castPosesBy(castOver);
