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
import { DEFAULT_LOOK } from '../../game/look';
import { drawFigure, FIGURE_TOP, type FigurePose, type GearLook } from '../figure';
import { HALF_H, HALF_W, HEIGHT_SCALE } from '../iso';
import { drawCreature } from '../sprites';
import { wildermonTop } from '../wildermon';
import { lingerSecs, visualOf } from './index';
import { spellInfo } from './info';
import type { Body } from './kit';
import { personBody, SpellStage, type Aim, type Who } from './stage';

export interface SheetOpts {
  spell: string;
  /** Which of the eight ways the caster is turned; the target is put that way from them. */
  facing?: number;
  frames?: number;
  zoom?: number;
  target?: 'creature' | 'player' | 'tile' | 'self';
  /** Tiles to the target; by default as near as the spell is cast from. */
  dist?: number;
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
}

/** The companion's creature id, beside the target's one. */
const PET_ID = 2;
/** Pixels at zoom one left over the tallest body for what is drawn over it, trimmed back to what was. */
const TOP_ROOM = 150;

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

/** How far off the target stands by default: in reach for a blow, at a middling throw for the rest. */
function distFor(spell: string): number {
  const info = spellInfo(spell);
  switch (info?.kind) {
    case 'strike': return 1.1;
    case 'thrust': return 1.7;
    case 'buff': case 'nova': case 'pray': return 0;
    case 'ally': return 2.5;
    case 'ground': return 3;
    default: return Math.min(4, info?.fx.reach ?? 4);
  }
}

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
  const dist = want === 'self' ? 0 : o.dist ?? Math.max(1, distFor(o.spell));
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
  // The companion a little behind the caster and off to their left, turned the way they are.
  const lx = cam.unrotateX(-dv, du), ly = cam.unrotateY(-dv, du);
  const px = cx - fx * 0.6 + lx * 1.1, py = cy - fy * 0.6 + ly * 1.1;
  // Where the caster stood before the island moved them, for a move (`from` tiles back along the way they face).
  const from = o.from ? { x: cx - fx * o.from, y: cy - fy * o.from } : undefined;

  const casterPose = (): FigurePose => ({ phase: 0, moving: false, facing, swimming: false, working: false, look, gear });
  const targetPose: FigurePose = { phase: 0, moving: false, facing: tFacing, swimming: false, working: false, look: { ...DEFAULT_LOOK, gender: 'man', shirt: 'woad' } };
  const sp = SPECIES[species] ?? Object.values(SPECIES)[0];
  const spTall = Math.max(22, wildermonTop(sp.id) ?? 0) / HEIGHT_SCALE;
  const pet = petSpecies ? SPECIES[petSpecies] ?? sp : null;
  const petTall = pet ? Math.max(22, wildermonTop(pet.id) ?? 0) / HEIGHT_SCALE : 0;
  const flags = { burning: o.state === 'burning', bleeding: o.state === 'bleeding', held: o.state === 'held' };
  const bodyOf = (w: Who): Body | null => {
    if (w.kind === 'player') return personBody(cx, cy, 0, facing, 'player', casterPose());
    if (w.kind === 'peer') return personBody(tx, ty, 0, tFacing, 'peer', targetPose);
    if (w.id === PET_ID) return pet ? { x: px, y: py, z: 0, tall: petTall, wide: 5, facing, kind: 'creature' } : null;
    return { x: tx, y: ty, z: 0, tall: spTall, wide: 5, facing: tFacing, kind: 'creature', ...flags };
  };
  const everyone: Who[] = [{ kind: 'player' }];
  if (want === 'player') everyone.push({ kind: 'peer', id: 1 });
  if (want === 'creature') everyone.push({ kind: 'creature', id: 1 });
  if (pet) everyone.push({ kind: 'creature', id: PET_ID });
  const stage = new SpellStage({
    body: bodyOf,
    ground: () => 0,
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
  const xs = [sx(cx, cy), sx(tx, ty), ...(pet ? [sx(px, py)] : []), ...(from ? [sx(from.x, from.y)] : [])];
  const ys = [sy(cx, cy), sy(tx, ty), ...(pet ? [sy(px, py)] : []), ...(from ? [sy(from.x, from.y)] : [])];
  const tallest = Math.max(FIGURE_TOP, (want === 'creature' ? spTall : 0) * HEIGHT_SCALE, petTall * HEIGHT_SCALE);
  const minX = Math.min(...xs) - spread * HALF_W - 34;
  const maxX = Math.max(...xs) + spread * HALF_W + 34;
  const minY = Math.min(...ys) - spread * HALF_H - tallest - TOP_ROOM;
  const maxY = Math.max(...ys) + spread * HALF_H + 22;
  // Never smaller than a person and a sigil round them.
  const W = Math.ceil(Math.max(110, maxX - minX) * zoom), H = Math.ceil(Math.max(105, maxY - minY) * zoom);
  const cols = Math.max(1, Math.min(frames, o.cols ?? Math.max(1, Math.floor(4200 / W))));
  const rows = Math.ceil(frames / cols);
  const sheet = document.createElement('canvas');
  sheet.width = W * cols;
  sheet.height = H * rows;
  const g = sheet.getContext('2d') as CanvasRenderingContext2D;
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

  const times = Array.from({ length: frames }, (_, i) => (frames === 1 ? 0 : (total * i) / (frames - 1)));
  const labels: string[] = [];
  const dt = 1 / 60;
  let now = 0;
  stage.update({ eye: cam, now, dt, fast: !!o.fast });
  stage.play(o.spell, by, at, { mine: true, now: 0, companion: pet ? PET_ID : undefined, from });
  const night = document.createElement('canvas');
  night.width = W;
  night.height = H;
  for (let f = 0; f < frames; f++) {
    while (now + dt <= times[f] + 1e-9) {
      now += dt;
      stage.update({ eye: cam, now, dt, fast: !!o.fast });
    }
    stage.update({ eye: cam, now: times[f], dt: Math.max(1e-4, times[f] - now), fast: !!o.fast });
    now = times[f];
    const ox = (f % cols) * W, oy = Math.floor(f / cols) * H;
    g.save();
    g.translate(ox, oy);
    g.beginPath();
    g.rect(0, 0, W, H);
    g.clip();
    ground(g);
    stage.drawGroundAll(g);
    // Everything standing, the bodies among the spell's own, nearest last; the caster where a move has carried them to.
    const shift = stage.shiftOf(by);
    const casterAt = { sx: cam.worldToScreenX(cx + (shift?.x ?? 0), cy + (shift?.y ?? 0)), sy: cam.worldToScreenY(cx + (shift?.x ?? 0), cy + (shift?.y ?? 0), 0) };
    const targetAt = { sx: cam.worldToScreenX(tx, ty), sy: cam.worldToScreenY(tx, ty, 0) };
    const petAt = { sx: cam.worldToScreenX(px, py), sy: cam.worldToScreenY(px, py, 0) };
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
      shadow(casterAt.sx, casterAt.sy, 8);
      drawFigure(g, casterAt.sx, casterAt.sy, zoom, { ...casterPose(), cast: pose }, { ink: 1.4 });
    } });
    if (want === 'player') items.push({ sy: targetAt.sy, draw: () => {
      shadow(targetAt.sx, targetAt.sy, 8);
      drawFigure(g, targetAt.sx, targetAt.sy, zoom, targetPose, { ink: 1.4 });
    } });
    if (want === 'creature') items.push({ sy: targetAt.sy, draw: () => {
      drawCreature(g, targetAt.sx, targetAt.sy, zoom, { species: sp.id, facing: tFacing, phase: 0, moving: false, gait: 0, colors: sp.variants[0], health: 1, fleece: 1 });
    } });
    if (pet) items.push({ sy: petAt.sy, draw: () => {
      drawCreature(g, petAt.sx, petAt.sy, zoom, { species: pet.id, facing, phase: 0, moving: false, gait: 0, colors: pet.variants[0], health: 1, fleece: 1 });
    } });
    items.sort((a, b) => a.sy - b.sy);
    for (const it of items) it.draw();
    if (o.night) {
      // The night as the island lays it: a cold wash, with every light's circle taken out of it and its colour laid in.
      const n = night.getContext('2d') as CanvasRenderingContext2D;
      n.globalCompositeOperation = 'source-over';
      n.clearRect(0, 0, W, H);
      n.fillStyle = 'rgba(12, 18, 46, 0.62)';
      n.fillRect(0, 0, W, H);
      n.globalCompositeOperation = 'destination-out';
      for (const l of stage.lights) {
        const x = cam.worldToScreenX(l.x, l.y), y = cam.worldToScreenY(l.x, l.y, 0), r = l.radius * HALF_W * zoom;
        const grad = n.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(0,0,0,${l.strength})`);
        grad.addColorStop(0.55, `rgba(0,0,0,${l.strength * 0.55})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        n.fillStyle = grad;
        n.fillRect(0, 0, W, H);
      }
      g.drawImage(night, 0, 0);
      g.globalCompositeOperation = 'lighter';
      for (const l of stage.lights) {
        const x = cam.worldToScreenX(l.x, l.y), y = cam.worldToScreenY(l.x, l.y, 0), r = l.radius * HALF_W * zoom;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(${l.cast}, ${l.castAlpha * 0.6})`);
        grad.addColorStop(1, `rgba(${l.cast}, 0)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, W, H);
      }
      g.globalCompositeOperation = 'source-over';
    }
    stage.glowPass(g);
    stage.screenPass(g, W, H);
    const castEnd = timing.secs + held;
    const phase = now < timing.secs * timing.release ? 'cast' : now < castEnd ? 'release' : 'after';
    labels.push(`${o.spell}  t=${now.toFixed(2)}s  ${phase}  f${facing}  ${want}`);
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
  const H2 = H - cut;
  const out = document.createElement('canvas');
  out.width = W * cols;
  out.height = H2 * rows;
  const og = out.getContext('2d') as CanvasRenderingContext2D;
  for (let f = 0; f < frames; f++) {
    const ox = (f % cols) * W, oy = Math.floor(f / cols) * H, oy2 = Math.floor(f / cols) * H2;
    og.drawImage(sheet, ox, oy + cut, W, H2, ox, oy2, W, H2);
    if (o.label !== false) {
      og.font = `${Math.max(11, Math.round(4 * zoom))}px monospace`;
      og.fillStyle = 'rgba(0,0,0,0.55)';
      og.fillRect(ox, oy2, W, lab);
      og.fillStyle = '#efe8d4';
      og.fillText(labels[f], ox + 4, oy2 + Math.max(12, 4 * zoom));
    }
    og.strokeStyle = 'rgba(0,0,0,0.6)';
    og.strokeRect(ox + 0.5, oy2 + 0.5, W - 1, H2 - 1);
  }
  return out;
}
