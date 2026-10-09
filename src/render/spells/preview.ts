/**
 * A spell drawn frame by frame onto a sheet, away from the island: what
 * `node_modules/.cache/anim/spell.mjs` bundles and calls. The same stage, kit
 * and figure the island draws with, a patch of ground, the caster in the
 * middle of it and a stand-in target where the spell would find one; the
 * stage run at sixty frames a second from the start of the cast, and a
 * picture taken at each of the times asked for.
 *
 * Not part of the game: nothing in it imports this.
 */
import { Camera } from '../../engine/camera';
import { SPECIES } from '../../game/creatures';
import { beastReach, COMPANION_REACH, HUNT_REACH, reachOf } from '../../game/fight';
import { WEAPON_BY_ID } from '../../game/gear';
import { DEFAULT_LOOK } from '../../game/look';
import { drawFigure, FIGURE_TOP, type FigurePose, type GearLook } from '../figure';
import { HALF_H, HALF_W, HEIGHT_SCALE } from '../iso';
import { castShade, drawCreature } from '../sprites';
import { wildermonTop } from '../wildermon';
import { lingerSecs, visualOf } from './index';
import { spellInfo } from './info';
import { guessTold, type Standing } from './guess';
import { creatureWide, fallGradient, lightHole, type Body, type Told } from './kit';
import { personBody, SpellStage, type Aim, type Who } from './stage';

export interface SheetOpts {
  spell: string;
  /** Which of the eight ways the caster is turned; the target is put that way from them. */
  facing?: number;
  frames?: number;
  zoom?: number;
  target?: 'creature' | 'player' | 'tile' | 'self';
  /**
   * Tiles to the target along the ground; by default where the island has it (see `distFor`). `'reach'` is as far as
   * the weapon in hand reaches (`meleeReach`: 2.2 tiles, more for a spear), `'hunt'` as near as a creature comes to
   * strike (`HUNT_REACH`, 1.1). On a diagonal facing a tile's step crosses more of the drawn grid than side on.
   */
  dist?: number | 'reach' | 'hunt';
  /** The caster walking at this gait (nought a walk, one a run) through the cast, on the spot: the legs the walk's, the cast over the arms. */
  walk?: number;
  /** This many more creatures standing about the target (or about the caster, for a spell on oneself), in reach of it: for area spells. */
  crowd?: number;
  /** What a person target holds (a blessing on somebody's weapon). */
  targetWeapon?: string;
  /**
   * Where the companion stands: at the caster's heel (`'heel'`), in reach of the target as the island has it for a
   * blow through it (`'near'`, within `COMPANION_REACH`), or off at a distance (`'far'`); and where the island puts it
   * at `petSnap` seconds (the release when not given): on the target (`'target'`, a Pounce) or on the caster
   * (`'caster'`, a Guard Me). By default as the spell has it.
   */
  petAt?: 'heel' | 'near' | 'far';
  petTo?: 'target' | 'caster';
  petSnap?: number;
  species?: string;
  /** Seconds the sheet covers; by default the cast, its flight, its impact and a little of what lingers. */
  secs?: number;
  night?: boolean;
  fast?: boolean;
  /** What the caster holds; by default whatever the spell wants in the hand. */
  weapon?: string;
  offhand?: string;
  /** Pictures across, before a new row. */
  cols?: number;
  label?: boolean;
  /**
   * A companion standing by the caster, for the spells cast through one: a
   * species, true for the default, false for none. By default one stands by
   * for a Beastmaster's spells and nobody else's.
   */
  companion?: string | boolean;
  /** Tiles back along the way they face the caster stood before the island moved them (a Lunge), to be carried from. */
  from?: number;
  /** What the island says is on the target creature: a burn running, a bleed, a trap holding it (`Body.burning` ...). */
  state?: 'burning' | 'bleeding' | 'held';
  /**
   * Tiles further out along the way the caster faces the target stood before the cast, for a spell the island drags it
   * in with (`cast.pull`: a Hook): passed as the cast's `targetFrom`, so the creature is drawn hauled in. By default as the
   * spell's own numbers have it (`fx.reach`, `fx.pull`, `fx.least`) for a spell with `cast.pull`, and none otherwise.
   */
  pull?: number;
  /** This many people standing about the target (or about the caster, for a spell on oneself), for ally spells on everybody in reach. */
  peers?: number;
  /** What the crowd are (`crowd`), where they are not the target's kind: a monster among animals, for a spell that treats the two apart. */
  crowdSpecies?: string;
  /**
   * What the island says the cast did (`Told`): by default worked out from the island's rules for the scene drawn
   * (`guessTold`) -- whom an area reaches, a monster's share of a hold -- and a cast the island refuses on the target is
   * not drawn at all; `false` for none, the effects drawing from what stands near; or given, by the scene's own ids
   * (the target creature 1, the crowd from 10, the people about from 40, a person target peer 1, the caster player).
   */
  told?: Told | false;
  /**
   * A second cast by the caster `at` seconds in, at the same target: one that spends a waiting spell of the first (a
   * Scorch after a Stoke, a Ward after a Thicken), with what the island says it did (`told`, worked out as the first's is
   * where not given), so the first is seen let go when it is spent.
   */
  then?: { spell: string; at: number; told?: Told };
  /**
   * Seconds into the sheet the island says the cast fired after it (a Ward Link's skin back over somebody), how large,
   * and on whom: the target (the caster for a spell on oneself), or the first of the people about (`peers`).
   */
  fired?: Array<{ at: number; size?: number; on?: 'target' | 'peer' }>;
  /**
   * Tiles of ground round the caster the frame takes in at least, its sides trimmed back to what was drawn: so a stance's
   * ring or hedge round the caster is not cut off. Four for a spell on oneself by default, none otherwise.
   */
  room?: number;
}

/** What went over budget in the last sheet drawn, frame by frame (`spellSheet`), for the tool to print. */
export const sheetWarnings: string[] = [];

/** The companion's creature id, beside the target's one. */
const PET_ID = 2;
/** Pixels at zoom one left over the tallest body for what is drawn over it, trimmed back to what was: a sword of 64 units stood over a creature. */
const TOP_ROOM = 260;
/** The first of the crowd's creature ids (`crowd`), and of the people standing about (`peers`). */
const CROWD_ID = 10;
const PEER_ID = 40;
/** The most a canvas may be, a side and in all. */
const SIDE_MOST = 32000;
const AREA_MOST = 250_000_000;

/** What a spell wants in the hand, for a caster drawn holding it. */
function gearFor(spell: string, weapon?: string, offhand?: string): GearLook {
  const info = spellInfo(spell);
  const by: Record<string, string> = {
    archery: 'short_bow', throwing: 'javelin', skirmish: 'javelin', knives: 'hunting_knife', axes: 'battle_axe', mauls: 'maul', shield: 'sword',
  };
  const group: Record<string, string> = { blade: 'sword', berserker: 'battle_axe', pikeman: 'spear', archer: 'short_bow', skirmisher: 'javelin', chirurgeon: 'hunting_knife' };
  const w = weapon ?? (info?.needs ? by[info.needs] : undefined) ?? (info ? group[info.group] : undefined);
  const gear: GearLook = {
    chest: { id: 'leather_jerkin' }, arms: { id: 'leather_sleeves' }, legs: { id: 'cloth_trousers' }, feet: { id: 'leather_boots' },
  };
  if (w && w !== 'none') gear.weapon = { id: w, material: 'iron' };
  const off = offhand ?? (info?.needs === 'shield' ? 'wooden_shield' : undefined);
  if (off && off !== 'none') gear.offhand = { id: off, material: 'iron' };
  return gear;
}

/** How far the weapon in hand reaches, in tiles, as the island has it (`melee_reach`, before anybody's perks). */
function meleeReachOf(weapon: string | undefined): number {
  const w = weapon ? WEAPON_BY_ID.get(weapon) : undefined;
  return w && !w.ammo ? reachOf(w) : reachOf({ range: undefined });
}

/**
 * Where the target stands by default, and where the caster stood before the island moved them: as the island has
 * it. A blow or a thrust as far as the weapon reaches (2.2 tiles, a spear's 3.2), which is where the island lets one
 * be struck from; a stride (a Lunge) ends 0.4 inside that reach, from as far back as its stride; a leap away (a
 * Parting Throw) starts that far nearer (a negative `from`); a spell on somebody else inside its own reach; the rest
 * at a middling throw.
 */
function distFor(spell: string, weapon: string | undefined): { dist: number; from?: number; pull?: number } {
  const info = spellInfo(spell);
  const fx = info?.fx ?? {}, reach = meleeReachOf(weapon);
  if (fx.leap) return { dist: Math.min(4, reach + fx.leap), from: -fx.leap };
  // Dragged in (a Hook): it stood as far out as the spell reaches, and is pulled in by its own pull, no nearer than its least.
  if (visualOf(spell)?.cast.pull && fx.pull) {
    const was = Math.min(4, fx.reach ?? reach), dist = Math.max(fx.least ?? 1, was - fx.pull);
    return { dist, pull: Math.max(0, was - dist) };
  }
  switch (info?.kind) {
    case 'strike': case 'thrust':
      // A stride to it: the island puts the body a pace inside its reach of it, from where it stood.
      if (fx.reach && fx.reach > reach) return { dist: reach - 0.4, from: Math.min(fx.reach, 4) - (reach - 0.4) };
      return { dist: reach };
    case 'throw':
      // A throwing trade's spell made with something that is not thrown -- a knife's Hit and Run -- is a blow, struck from
      // as far as it reaches.
      if (weapon && !WEAPON_BY_ID.get(weapon)?.thrown) return { dist: reach };
      return { dist: Math.min(4, fx.reach ?? 4) };
    case 'buff': case 'nova': case 'pray': return { dist: 0 };
    case 'ally': return { dist: Math.max(1, Math.min(2.5, (fx.reach ?? 3) * 0.8)) };
    case 'ground': return { dist: 3 };
    default: return { dist: Math.min(4, fx.reach ?? 4) };
  }
}

/** What the island says is on the target by default for a spell that wants it so (a Disembowel on a bleeding creature). */
const STATE_FOR: Record<string, 'burning' | 'bleeding' | 'held'> = { beastmaster_disembowel: 'bleeding' };

/** Where a Beastmaster's companion stands for each spell by default, and where the island puts it. */
const PET_FOR: Record<string, { at?: 'heel' | 'near' | 'far'; to?: 'target' | 'caster' }> = {
  beastmaster_sic: { at: 'near' }, beastmaster_drag_down: { at: 'near' }, beastmaster_disembowel: { at: 'near' },
  beastmaster_pounce: { at: 'heel', to: 'target' }, beastmaster_guard_me: { at: 'far', to: 'caster' },
};

/** A sheet of pictures through a spell, as a canvas. */
export function spellSheet(o: SheetOpts): HTMLCanvasElement {
  const vis = visualOf(o.spell);
  const info = spellInfo(o.spell);
  if (!vis) throw new Error(`no visual for ${o.spell}`);
  const zoom = o.zoom ?? 3;
  const facing = ((Math.round(o.facing ?? 1) % 8) + 8) % 8;
  const frames = Math.max(1, o.frames ?? 10);
  const self = info?.on.length === 1 && info.on[0] === 'self';
  const want = o.target ?? (self ? 'self' : info?.on.includes('area') ? 'tile' : info?.on.includes('player') ? 'player' : 'creature');
  const weaponId = gearFor(o.spell, o.weapon, o.offhand).weapon?.id;
  const deflt = distFor(o.spell, weaponId);
  const dist = want === 'self' ? 0 : o.dist === 'reach' ? meleeReachOf(weaponId) : o.dist === 'hunt' ? HUNT_REACH : o.dist ?? Math.max(1, deflt.dist);
  const fromBack = o.from ?? (o.dist === undefined && want !== 'self' ? deflt.from : undefined);
  const pullBack = o.pull ?? (o.dist === undefined && want !== 'self' ? deflt.pull : undefined);
  const state = o.state ?? STATE_FOR[o.spell];
  const species = o.species ?? 'ulva';
  const look = { ...DEFAULT_LOOK, shirt: 'madder', trousers: 'unbleached' };
  const gear = gearFor(o.spell, o.weapon, o.offhand);
  // A Beastmaster's spells are cast through a companion, so one stands by unless told not to.
  const petSpecies = o.companion === false ? null : typeof o.companion === 'string' ? o.companion : o.companion || info?.group === 'beastmaster' ? 'ulva' : null;

  const cam = new Camera();
  cam.zoom = zoom;
  cam.rotation = 0;
  // The caster at the middle of a tile, the target along the way they face.
  const cx = 20.5, cy = 20.5;
  const th = Math.PI / 4 - (facing * Math.PI) / 4;
  const du = Math.cos(th), dv = Math.sin(th);
  const fx = cam.unrotateX(du, dv), fy = cam.unrotateY(du, dv);
  const tx = cx + fx * dist, ty = cy + fy * dist;
  const tFacing = (facing + 4) % 8;
  // The companion: by default a little behind the caster and off to their left, turned the way they are; for a blow
  // through it, in its reach of the target, as the island has it; and moved where the island moves it.
  const lx = cam.unrotateX(-dv, du), ly = cam.unrotateY(-dv, du);
  const petAt = o.petAt ?? PET_FOR[o.spell]?.at ?? 'heel', petTo = o.petTo ?? PET_FOR[o.spell]?.to;
  const pet0 = petAt === 'near' ? { x: tx - fx * COMPANION_REACH * 0.85 + lx * 0.3, y: ty - fy * COMPANION_REACH * 0.85 + ly * 0.3 }
    : petAt === 'far' ? { x: cx - fx * 1.5 + lx * 2.5, y: cy - fy * 1.5 + ly * 2.5 } : { x: cx - fx * 0.6 + lx * 1.1, y: cy - fy * 0.6 + ly * 1.1 };
  const pd = Math.hypot(tx - pet0.x, ty - pet0.y) || 1;
  const pet1 = petTo === 'target' ? { x: tx - ((tx - pet0.x) / pd) * COMPANION_REACH * 0.5, y: ty - ((ty - pet0.y) / pd) * COMPANION_REACH * 0.5 }
    : petTo === 'caster' ? { x: cx, y: cy } : pet0;
  const vis0 = visualOf(o.spell);
  const petSnap = o.petSnap ?? (vis0 ? vis0.cast.timing.secs * vis0.cast.timing.release : 0);
  let px = pet0.x, py = pet0.y;
  // Where the caster stood before the island moved them, for a move (`from` tiles back along the way they face; less
  // than nought for a leap away, nearer the target).
  const from = fromBack ? { x: cx - fx * fromBack, y: cy - fy * fromBack } : undefined;
  // The caster's facing, which the stage may turn (to the companion, for `cast.face: 'companion'`), as the game does
  // for somebody standing; and the walk, on the spot, at the game's own pace through the stride.
  let cf = facing, phase = 0;
  const walking = o.walk !== undefined;
  const gait = Math.max(0, Math.min(1, o.walk ?? 0));
  const casterPose = (): FigurePose => ({ phase, moving: walking, gait, facing: cf, swimming: false, working: false, look, gear });
  const tgear: GearLook = o.targetWeapon && o.targetWeapon !== 'none' ? { weapon: { id: o.targetWeapon, material: 'iron' } } : {};
  const targetPose: FigurePose = { phase: 0, moving: false, facing: tFacing, swimming: false, working: false, look: { ...DEFAULT_LOOK, gender: 'man', shirt: 'woad' }, gear: tgear };
  // Others standing about, in reach of where the spell lands: round the target, or round the caster for a spell on oneself.
  const crowd: Array<{ x: number; y: number; f: number }> = [];
  const ox = want === 'self' ? cx : tx, oy = want === 'self' ? cy : ty;
  const ring = Math.max(1.1, Math.min(3.5, (info?.radius || 2) * 0.7));
  for (let i = 0; i < (o.crowd ?? 0); i++) {
    const a = 0.6 + (i * 2 * Math.PI) / Math.max(3, o.crowd ?? 0), d = ring * (0.75 + 0.25 * ((i * 7) % 3) / 2);
    crowd.push({ x: ox + Math.cos(a) * d, y: oy + Math.sin(a) * d, f: (i * 3 + 1) % 8 });
  }
  // And people standing about, in reach of it, half a turn round from the crowd so the two do not stand in each other.
  const peers: Array<{ x: number; y: number; f: number; pose: FigurePose }> = [];
  const shirts = ['woad', 'weld', 'unbleached', 'madder'];
  for (let i = 0; i < (o.peers ?? 0); i++) {
    const a = 0.6 + Math.PI / Math.max(3, o.peers ?? 0) + (i * 2 * Math.PI) / Math.max(3, o.peers ?? 0), d = ring * (0.8 + 0.2 * ((i * 5) % 3) / 2);
    const f = (i * 3 + 2) % 8;
    peers.push({ x: ox + Math.cos(a) * d, y: oy + Math.sin(a) * d, f, pose: { phase: 0, moving: false, facing: f, swimming: false, working: false, look: { ...DEFAULT_LOOK, gender: i % 2 ? 'man' : 'woman', shirt: shirts[i % 4] }, gear: { weapon: { id: 'sword', material: 'iron' } } } });
  }
  const sp = SPECIES[species] ?? Object.values(SPECIES)[0];
  const csp = (o.crowdSpecies ? SPECIES[o.crowdSpecies] : undefined) ?? sp;
  const cTall = Math.max(22, wildermonTop(csp.id) ?? 0) / HEIGHT_SCALE;
  const spTall = Math.max(22, wildermonTop(sp.id) ?? 0) / HEIGHT_SCALE;
  const pet = petSpecies ? SPECIES[petSpecies] ?? sp : null;
  const petTall = pet ? Math.max(22, wildermonTop(pet.id) ?? 0) / HEIGHT_SCALE : 0;
  const flags = { burning: state === 'burning', bleeding: state === 'bleeding', held: state === 'held' };
  // Each creature as the game has it: its kind (for its head), how wide it stands and how near it strikes from.
  const beast = (kind: typeof sp, tall: number): Pick<Body, 'species' | 'wide' | 'reach'> => ({ species: kind.id, wide: creatureWide(kind.id) * tall / (Math.max(22, wildermonTop(kind.id) ?? 0) / HEIGHT_SCALE), reach: beastReach(kind) });
  const bodyOf = (w: Who): Body | null => {
    if (w.kind === 'player') return personBody(cx, cy, 0, cf, 'player', casterPose());
    if (w.kind === 'peer' && w.id >= PEER_ID) {
      const q = peers[w.id - PEER_ID];
      return q ? personBody(q.x, q.y, 0, q.f, 'peer', q.pose) : null;
    }
    if (w.kind === 'peer') return personBody(tx, ty, 0, tFacing, 'peer', targetPose);
    if (w.id === PET_ID) return pet ? { x: px, y: py, z: 0, tall: petTall, facing, kind: 'creature', ...beast(pet, petTall), tame: true, companion: true } : null;
    if (w.id >= CROWD_ID) {
      const q = crowd[w.id - CROWD_ID];
      return q ? { x: q.x, y: q.y, z: 0, tall: cTall, facing: q.f, kind: 'creature', ...beast(csp, cTall), hostile: true } : null;
    }
    return { x: tx, y: ty, z: 0, tall: spTall, facing: tFacing, kind: 'creature', ...beast(sp, spTall), hostile: true, ...flags };
  };
  const everyone: Who[] = [{ kind: 'player' }];
  if (want === 'player') everyone.push({ kind: 'peer', id: 1 });
  if (want === 'creature') everyone.push({ kind: 'creature', id: 1 });
  if (pet) everyone.push({ kind: 'creature', id: PET_ID });
  crowd.forEach((_, i) => everyone.push({ kind: 'creature', id: CROWD_ID + i }));
  peers.forEach((_, i) => everyone.push({ kind: 'peer', id: PEER_ID + i }));
  const stage = new SpellStage({
    body: bodyOf,
    ground: () => 0,
    // Turned to face what it is cast at, or the companion, as the game turns somebody standing (not walking).
    turn: (w, x, y) => {
      if (walking || w.kind !== 'player') return;
      let best = cf, most = -2;
      for (let f = 0; f < 8; f++) {
        const a = Math.PI / 4 - (f * Math.PI) / 4;
        const ux = cam.unrotateX(Math.cos(a), Math.sin(a)), uy = cam.unrotateY(Math.cos(a), Math.sin(a));
        const d = (ux * (x - cx) + uy * (y - cy)) / ((Math.hypot(ux, uy) || 1) * (Math.hypot(x - cx, y - cy) || 1));
        if (d > most) {
          most = d;
          best = f;
        }
      }
      cf = best;
    },
    companion: (w) => (w.kind === 'player' ? bodyOf({ kind: 'creature', id: PET_ID }) : null),
    near: (x, y, r) => everyone.map((w) => ({ w, b: bodyOf(w) })).filter(({ b }) => b && Math.hypot(b.x - x, b.y - y) <= r + 0.5).map(({ w, b }) => ({ ...(b as Body), who: w })),
  });
  const by: Who = { kind: 'player' };
  const at: Aim = want === 'self' ? { kind: 'self' } : want === 'tile' ? { kind: 'spot', x: tx, y: ty } : want === 'player' ? { kind: 'peer', id: 1 } : { kind: 'creature', id: 1 };

  // How long the sheet runs: the cast (and its hold), the flight, the impact and up to a second and a half of the linger.
  const timing = vis.cast.timing;
  const travel = vis.fx.travel ? vis.fx.travel.secs(dist) : 0;
  const lingers = lingerSecs(vis, info);
  const held = vis.cast.hold ? Math.max(0, vis.cast.hold.secs ?? lingers) : 0;
  const total = o.secs ?? Math.max(timing.secs + held, timing.secs * timing.release + travel + (vis.fx.impact?.secs ?? 0) + Math.min(1.5, lingers));

  // The cell: the caster and the target, a figure's height over them and a margin all round. Over the top, room for
  // whatever stands tallest (a big creature, the companion) and the effects over it, trimmed back once it is all drawn.
  const sx = (x: number, y: number): number => (x - y) * HALF_W;
  const sy = (x: number, y: number): number => (x + y) * HALF_H;
  const spread = info?.radius ? info.radius * 1.1 : 0;
  // A tile past the target as well: what stands beyond it (a grave over a friend, a sword planted behind) is in the frame.
  const past = want === 'self' ? { x: cx, y: cy } : { x: tx + fx, y: ty + fy };
  // Where a dragged creature stood (`pull`), along the way the caster faces past where the island put it.
  const targetFrom = pullBack && want !== 'self' && want !== 'tile' ? { x: tx + fx * pullBack, y: ty + fy * pullBack } : undefined;
  // Room round the caster for a stance's ring or hedge, trimmed back to what was drawn at the end.
  const room = o.room ?? (want === 'self' ? 4 : 0);
  const roomed = room > 0 ? [{ x: cx - room, y: cy - room }, { x: cx + room, y: cy + room }, { x: cx - room, y: cy + room }, { x: cx + room, y: cy - room }] : [];
  const spots = [{ x: cx, y: cy }, { x: tx, y: ty }, past, ...(pet ? [pet0, pet1] : []), ...(from ? [from] : []), ...(targetFrom ? [targetFrom] : []), ...crowd, ...peers, ...roomed];
  const xs = spots.map((q) => sx(q.x, q.y));
  const ys = spots.map((q) => sy(q.x, q.y));
  const tallest = Math.max(FIGURE_TOP, (want === 'creature' ? spTall : 0) * HEIGHT_SCALE, petTall * HEIGHT_SCALE);
  const minX = Math.min(...xs) - spread * HALF_W - 34;
  const maxX = Math.max(...xs) + spread * HALF_W + 34;
  const minY = Math.min(...ys) - spread * HALF_H - tallest - TOP_ROOM;
  const maxY = Math.max(...ys) + spread * HALF_H + 22;
  // Never smaller than a person and a sigil round them.
  const W = Math.ceil(Math.max(110, maxX - minX) * zoom), H = Math.ceil(Math.max(105, maxY - minY) * zoom);
  // A canvas over 32767 pixels a side, or over about 268 million in all, cannot be made: a big area spell at zoom six
  // was one cell wide and ten tall. More across, then, and a clear refusal where even one cell will not go.
  if (W > SIDE_MOST || H > SIDE_MOST || W * H > AREA_MOST) throw new Error(`a cell of ${W}x${H} px is too big at zoom ${zoom}: ask for less zoom`);
  let cols = Math.max(1, Math.min(frames, o.cols ?? Math.max(1, Math.floor(4200 / W))));
  while (cols < frames && (Math.ceil(frames / cols) * H > SIDE_MOST || W * cols * H * Math.ceil(frames / cols) > AREA_MOST)) cols++;
  if (W * cols > SIDE_MOST || W * cols * H * Math.ceil(frames / cols) > AREA_MOST) throw new Error(`${frames} frames of ${W}x${H} px will not go on one sheet: ask for fewer frames or less zoom`);
  const rows = Math.ceil(frames / cols);
  const sheet = document.createElement('canvas');
  sheet.width = W * cols;
  sheet.height = H * rows;
  // `g` is the sheet's, but for a moment while a tinted creature is drawn alone (`tinted`).
  let g = sheet.getContext('2d') as CanvasRenderingContext2D;
  let scratch: HTMLCanvasElement | null = null;
  cam.setViewport(W, H);
  // The camera on the middle of the cell's ground.
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  cam.cx = midX;
  cam.cy = midY;

  // Ground, and the tiles drawn faintly on it for scale.
  const ground = (c: CanvasRenderingContext2D): void => {
    c.fillStyle = '#4d6b3a';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(0,0,0,0.12)';
    c.lineWidth = 1;
    c.beginPath();
    for (let i = -14; i <= 14; i++) {
      const a0 = { x: cx - 0.5 + i, y: cy - 14.5 }, a1 = { x: cx - 0.5 + i, y: cy + 14.5 };
      const b0 = { x: cx - 14.5, y: cy - 0.5 + i }, b1 = { x: cx + 14.5, y: cy - 0.5 + i };
      c.moveTo(cam.worldToScreenX(a0.x, a0.y), cam.worldToScreenY(a0.x, a0.y, 0));
      c.lineTo(cam.worldToScreenX(a1.x, a1.y), cam.worldToScreenY(a1.x, a1.y, 0));
      c.moveTo(cam.worldToScreenX(b0.x, b0.y), cam.worldToScreenY(b0.x, b0.y, 0));
      c.lineTo(cam.worldToScreenX(b1.x, b1.y), cam.worldToScreenY(b1.x, b1.y, 0));
    }
    c.stroke();
  };

  // Frames evenly through the time, but a long hold squeezed to a second of it, so a held stance does not take every
  // frame there is and leave the wind-up and the letting go with one each.
  const holdAt = vis.cast.hold ? timing.secs * Math.max(0, Math.min(1, vis.cast.hold.at)) : 0;
  const squeeze = o.secs === undefined && held > 1 ? held - 1 : 0;
  const real = (v: number): number => (v <= holdAt ? v : v <= holdAt + 1 && squeeze ? holdAt + (v - holdAt) * held : v + squeeze);
  const times = Array.from({ length: frames }, (_, i) => (frames === 1 ? 0 : real(((total - squeeze) * i) / (frames - 1))));
  const labels: string[] = [];
  const dt = 1 / 60;
  let now = 0;
  const night01 = o.night ? 1 : 0;
  stage.update({ eye: cam, now, dt, fast: !!o.fast, night: night01 });
  sheetWarnings.length = 0;
  // What the island would say it did, by its rules for this scene, unless told otherwise; nothing drawn where it refuses.
  const standing = (w: Who): Standing | null => {
    const b = bodyOf(w);
    return b ? { who: w, x: b.x, y: b.y, kind: b.kind, species: b.species, tame: b.tame, hostile: b.hostile } : null;
  };
  const scene = everyone.map(standing).filter((q): q is Standing => !!q);
  const told = o.told === false ? undefined : o.told ?? guessTold(o.spell, standing(by) as Standing,
    at.kind === 'spot' ? { x: at.x, y: at.y } : at.kind === 'self' ? null : standing(at), scene);
  if (told === null) sheetWarnings.push(`the island refuses ${o.spell} on a ${sp.id}: nothing is drawn`);
  else stage.play(o.spell, by, at, { mine: true, now: 0, companion: pet ? PET_ID : undefined, from, targetFrom, told });
  // What comes after it, played as the clock reaches it: a second cast, and what the island says fired.
  const after: Array<{ at: number; go: () => void }> = [];
  if (o.then) {
    const then = o.then;
    const thenTold = then.told ?? guessTold(then.spell, standing(by) as Standing,
      at.kind === 'spot' ? { x: at.x, y: at.y } : at.kind === 'self' ? null : standing(at), scene) ?? undefined;
    after.push({ at: then.at, go: () => stage.play(then.spell, by, at, { mine: true, now: then.at, told: thenTold }) });
  }
  for (const f of o.fired ?? []) {
    const on: Who = f.on === 'peer' ? { kind: 'peer', id: PEER_ID } : at.kind === 'spot' || at.kind === 'self' ? by : at;
    after.push({ at: f.at, go: () => stage.fired(o.spell, by, on, f.size) });
  }
  after.sort((p, q) => p.at - q.at);
  const due = (t: number): void => {
    while (after.length && after[0].at <= t + 1e-9) (after.shift() as { go: () => void }).go();
  };
  const night = document.createElement('canvas');
  night.width = W;
  night.height = H;
  for (let f = 0; f < frames; f++) {
    // The world as it is at a moment: the companion where the island has it, and the stride as far on as the walk is.
    const at = (s: number): void => {
      const q = s >= petSnap ? pet1 : pet0;
      px = q.x;
      py = q.y;
      phase = walking ? s * 11 * (1 + 0.6 * gait) : 0;
    };
    while (now + dt <= times[f] + 1e-9) {
      now += dt;
      at(now);
      due(now);
      stage.update({ eye: cam, now, dt, fast: !!o.fast, night: night01 });
    }
    at(times[f]);
    due(times[f]);
    stage.update({ eye: cam, now: times[f], dt: Math.max(1e-4, times[f] - now), fast: !!o.fast, night: night01 });
    now = times[f];
    // What went over budget in this frame, or tinted the screen, said in its label.
    const warn = [...stage.over, ...(stage.out.screen.length ? ['FLASH'] : [])];
    const ox = (f % cols) * W, oy = Math.floor(f / cols) * H;
    g.save();
    g.translate(ox, oy);
    g.beginPath();
    g.rect(0, 0, W, H);
    g.clip();
    ground(g);
    // The lights' colour on the ground at night, under the spell's marks and everybody standing (`SpellStage.layLight`).
    stage.drawGroundLight(g);
    stage.drawGroundAll(g);
    // Everything standing, the bodies among the spell's own, nearest last; the caster where a move has carried them to.
    const shift = stage.shiftOf(by);
    const casterAt = { sx: cam.worldToScreenX(cx + (shift?.x ?? 0), cy + (shift?.y ?? 0)), sy: cam.worldToScreenY(cx + (shift?.x ?? 0), cy + (shift?.y ?? 0), 0) };
    const pull = stage.shiftOf(want === 'player' ? { kind: 'peer', id: 1 } : { kind: 'creature', id: 1 });
    const targetAt = { sx: cam.worldToScreenX(tx + (pull?.x ?? 0), ty + (pull?.y ?? 0)), sy: cam.worldToScreenY(tx + (pull?.x ?? 0), ty + (pull?.y ?? 0), 0) };
    const petShift = stage.shiftOf({ kind: 'creature', id: PET_ID });
    const petPos = { sx: cam.worldToScreenX(px + (petShift?.x ?? 0), py + (petShift?.y ?? 0)), sy: cam.worldToScreenY(px + (petShift?.x ?? 0), py + (petShift?.y ?? 0), 0) };
    type Item = { sy: number; draw: () => void };
    const items: Item[] = stage.worldItems().map((rec) => ({ sy: rec.sy, draw: () => stage.drawItem(g, rec) }));
    const shadow = (x: number, y: number, rx: number): void => {
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.beginPath();
      g.ellipse(x, y, rx * zoom, rx * 0.42 * zoom, 0, 0, Math.PI * 2);
      g.fill();
    };
    const pose = stage.poseOf(by);
    items.push({ sy: casterAt.sy, draw: () => {
      // Under the feet as the cast has them, as the island draws it (`castShade`).
      const sh = castShade({ ...casterPose(), cast: pose });
      shadow(casterAt.sx + sh[0] * zoom, casterAt.sy + sh[1] * zoom, 8 * (1 - 0.2 * sh[2]));
      drawFigure(g, casterAt.sx, casterAt.sy, zoom, { ...casterPose(), cast: pose, veil: stage.veilOf(by) }, { ink: 1.4 });
    } });
    if (want === 'player') items.push({ sy: targetAt.sy, draw: () => {
      shadow(targetAt.sx, targetAt.sy, 8);
      drawFigure(g, targetAt.sx, targetAt.sy, zoom, { ...targetPose, veil: stage.veilOf({ kind: 'peer', id: 1 }) }, { ink: 1.4 });
    } });
    // A creature tinted by a spell on it (`FxScene.tint`), as the island paints it: drawn alone, its own colour laid over it.
    const tinted = (tint: { colour: string; share: number } | undefined, draw: () => void): void => {
      if (!tint) return draw();
      const pad = scratch ?? (scratch = document.createElement('canvas'));
      pad.width = W;
      pad.height = H;
      const pg = pad.getContext('2d') as CanvasRenderingContext2D;
      const was = g;
      g = pg;
      draw();
      g = was;
      g.drawImage(pad, 0, 0);
      pg.globalCompositeOperation = 'source-atop';
      pg.fillStyle = tint.colour;
      pg.fillRect(0, 0, W, H);
      g.globalAlpha = tint.share;
      g.drawImage(pad, 0, 0);
      g.globalAlpha = 1;
    };
    const tTint = stage.tintOf({ kind: 'creature', id: 1 });
    if (want === 'creature') items.push({ sy: targetAt.sy, draw: () => tinted(tTint, () => {
      drawCreature(g, targetAt.sx, targetAt.sy, zoom, { species: sp.id, facing: tFacing, phase: 0, moving: false, gait: 0, colors: sp.variants[0], health: 1, fleece: 1 });
    }) });
    for (const [i, q] of crowd.entries()) {
      const qx = cam.worldToScreenX(q.x, q.y), qy = cam.worldToScreenY(q.x, q.y, 0);
      const tint = stage.tintOf({ kind: 'creature', id: CROWD_ID + i });
      items.push({ sy: qy, draw: () => tinted(tint, () => drawCreature(g, qx, qy, zoom, { species: csp.id, facing: q.f, phase: 0, moving: false, gait: 0, colors: csp.variants[0], health: 1, fleece: 1 })) });
    }
    for (const [i, q] of peers.entries()) {
      const qx = cam.worldToScreenX(q.x, q.y), qy = cam.worldToScreenY(q.x, q.y, 0);
      items.push({ sy: qy, draw: () => {
        shadow(qx, qy, 8);
        drawFigure(g, qx, qy, zoom, { ...q.pose, veil: stage.veilOf({ kind: 'peer', id: PEER_ID + i }) }, { ink: 1.4 });
      } });
    }
    if (pet) items.push({ sy: petPos.sy, draw: () => {
      drawCreature(g, petPos.sx, petPos.sy, zoom, { species: pet.id, facing, phase: 0, moving: false, gait: 0, colors: pet.variants[0], health: 1, fleece: 1 });
    } });
    items.sort((a, b) => a.sy - b.sy);
    for (const it of items) it.draw();
    if (o.night) {
      // The night as the island lays it: a cold wash, with every light's circle taken out of it and its cast added, a
      // spell's falling off smoothly and weakened for its size (`Renderer.lightLayers`).
      const n = night.getContext('2d') as CanvasRenderingContext2D;
      n.globalCompositeOperation = 'source-over';
      n.clearRect(0, 0, W, H);
      n.fillStyle = 'rgba(12, 18, 46, 0.62)';
      n.fillRect(0, 0, W, H);
      n.globalCompositeOperation = 'destination-out';
      for (const l of stage.lights) {
        const x = cam.worldToScreenX(l.x, l.y), y = cam.worldToScreenY(l.x, l.y, 0), r = l.radius * HALF_W * zoom;
        const a = l.strength * lightHole(l.radius);
        n.fillStyle = fallGradient(n, x, y, r, (f) => `rgba(0,0,0,${(a * f).toFixed(3)})`);
        n.fillRect(0, 0, W, H);
      }
      g.drawImage(night, 0, 0);
      g.globalCompositeOperation = 'lighter';
      for (const l of stage.lights) {
        const x = cam.worldToScreenX(l.x, l.y), y = cam.worldToScreenY(l.x, l.y, 0), r = l.radius * HALF_W * zoom;
        const a = l.castAlpha * 0.6 * lightHole(l.radius);
        g.fillStyle = fallGradient(g, x, y, r, (f) => `rgba(${l.cast}, ${(a * f).toFixed(3)})`);
        g.fillRect(0, 0, W, H);
      }
      g.globalCompositeOperation = 'source-over';
    }
    stage.glowPass(g);
    stage.screenPass(g, W, H);
    const castEnd = timing.secs + held;
    const part = now < timing.secs * timing.release ? 'cast' : now < castEnd ? 'release' : 'after';
    labels.push(`${o.spell}  t=${now.toFixed(2)}s  ${part}  f${cf}  ${want}${warn.length ? '  ! ' + warn.join(', ') : ''}`);
    if (warn.length) sheetWarnings.push(`t=${now.toFixed(2)}s  ${warn.join(', ')}`);
    g.restore();
  }

  // The room left over the top for tall effects, taken back down to what was drawn in it: the first row of any cell
  // that differs from the bare ground, less a little, and as much off every cell.
  const bare = document.createElement('canvas');
  bare.width = W;
  bare.height = H;
  const bg = bare.getContext('2d') as CanvasRenderingContext2D;
  ground(bg);
  if (o.night) {
    bg.fillStyle = 'rgba(12, 18, 46, 0.62)';
    bg.fillRect(0, 0, W, H);
  }
  const plain = bg.getImageData(0, 0, W, H).data;
  let top = H;
  for (let f = 0; f < frames && top > 0; f++) {
    const ox = (f % cols) * W, oy = Math.floor(f / cols) * H;
    const cell = g.getImageData(ox, oy, W, Math.min(top, H)).data;
    for (let y = 0; y < Math.min(top, H); y++) {
      let differs = false;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (Math.abs(cell[i] - plain[i]) + Math.abs(cell[i + 1] - plain[i + 1]) + Math.abs(cell[i + 2] - plain[i + 2]) > 12) {
          differs = true;
          break;
        }
      }
      if (differs) {
        top = y;
        break;
      }
    }
  }
  const lab = o.label !== false ? Math.max(15, 5 * zoom) : 0;
  const cut = Math.max(0, top - Math.round(lab + 6 * zoom));
  // With room round the caster, the sides and the bottom trimmed back the same way, to what any picture drew past the bare
  // ground: never narrower than a label wants.
  let x0 = 0, x1 = W, bottom = H;
  if (room > 0) {
    let lo = W, hi = 0, low = 0;
    for (let f = 0; f < frames; f++) {
      const cell = g.getImageData((f % cols) * W, Math.floor(f / cols) * H, W, H).data;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (Math.abs(cell[i] - plain[i]) + Math.abs(cell[i + 1] - plain[i + 1]) + Math.abs(cell[i + 2] - plain[i + 2]) > 12) {
            lo = Math.min(lo, x);
            hi = Math.max(hi, x);
            low = Math.max(low, y);
          }
        }
      }
    }
    if (low > cut) bottom = Math.min(H, low + Math.round(12 * zoom));
    const margin = Math.round(12 * zoom), least = Math.min(W, Math.round(Math.max(110 * zoom, 64 * Math.max(11, Math.round(4 * zoom)) * 0.62)));
    if (hi > lo) {
      x0 = Math.max(0, lo - margin);
      x1 = Math.min(W, hi + margin);
      if (x1 - x0 < least) {
        const mid = (x0 + x1) / 2;
        x0 = Math.max(0, Math.round(mid - least / 2));
        x1 = Math.min(W, x0 + least);
      }
    }
  }
  const W2 = x1 - x0, H2 = bottom - cut;
  const out = document.createElement('canvas');
  out.width = W2 * cols;
  out.height = H2 * rows;
  const og = out.getContext('2d') as CanvasRenderingContext2D;
  for (let f = 0; f < frames; f++) {
    const ox = (f % cols) * W, oy = Math.floor(f / cols) * H, oy2 = Math.floor(f / cols) * H2, ox2 = (f % cols) * W2;
    og.drawImage(sheet, ox + x0, oy + cut, W2, H2, ox2, oy2, W2, H2);
    if (o.label !== false) {
      og.font = `${Math.max(11, Math.round(4 * zoom))}px monospace`;
      og.fillStyle = 'rgba(0,0,0,0.55)';
      og.fillRect(ox2, oy2, W2, lab);
      og.fillStyle = '#efe8d4';
      og.fillText(labels[f], ox2 + 4, oy2 + Math.max(12, 4 * zoom));
    }
    og.strokeStyle = 'rgba(0,0,0,0.6)';
    og.strokeRect(ox2 + 0.5, oy2 + 0.5, W2 - 1, H2 - 1);
  }
  return out;
}
