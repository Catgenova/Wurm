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
import { drawFigure, type FigurePose, type GearLook } from '../figure';
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
}

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

  const casterPose = (): FigurePose => ({ phase: 0, moving: false, facing, swimming: false, working: false, look, gear });
  const targetPose: FigurePose = { phase: 0, moving: false, facing: tFacing, swimming: false, working: false, look: { ...DEFAULT_LOOK, gender: 'man', shirt: 'woad' } };
  const sp = SPECIES[species] ?? Object.values(SPECIES)[0];
  const spTall = Math.max(22, wildermonTop(sp.id) ?? 0) / HEIGHT_SCALE;
  const bodyOf = (w: Who): Body | null => {
    if (w.kind === 'player') return personBody(cx, cy, 0, facing, 'player', casterPose());
    if (w.kind === 'peer') return personBody(tx, ty, 0, tFacing, 'peer', targetPose);
    return { x: tx, y: ty, z: 0, tall: spTall, wide: 5, facing: tFacing, kind: 'creature' };
  };
  const stage = new SpellStage({ body: bodyOf, ground: () => 0 });
  const by: Who = { kind: 'player' };
  const at: Aim = want === 'self' ? { kind: 'self' } : want === 'tile' ? { kind: 'spot', x: tx, y: ty } : want === 'player' ? { kind: 'peer', id: 1 } : { kind: 'creature', id: 1 };

  // How long the sheet runs: the cast, the flight, the impact and up to a second and a half of the linger.
  const timing = vis.cast.timing;
  const travel = vis.fx.travel ? vis.fx.travel.secs(dist) : 0;
  const total = o.secs ?? Math.max(timing.secs, timing.secs * timing.release + travel + (vis.fx.impact?.secs ?? 0) + Math.min(1.5, lingerSecs(vis, info)));

  // The cell: the caster and the target, a figure's height over them and a margin all round.
  const sx = (x: number, y: number): number => (x - y) * HALF_W;
  const sy = (x: number, y: number): number => (x + y) * HALF_H;
  const minX = Math.min(sx(cx, cy), sx(tx, ty)) - (info?.radius ? info.radius * HALF_W * 1.1 : 0) - 34;
  const maxX = Math.max(sx(cx, cy), sx(tx, ty)) + (info?.radius ? info.radius * HALF_W * 1.1 : 0) + 34;
  const minY = Math.min(sy(cx, cy), sy(tx, ty)) - (info?.radius ? info.radius * HALF_H * 1.1 : 0) - 64;
  const maxY = Math.max(sy(cx, cy), sy(tx, ty)) + (info?.radius ? info.radius * HALF_H * 1.1 : 0) + 22;
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

  const times = Array.from({ length: frames }, (_, i) => (frames === 1 ? 0 : (total * i) / (frames - 1)));
  const dt = 1 / 60;
  let now = 0;
  stage.update({ eye: cam, now, dt, fast: !!o.fast });
  stage.play(o.spell, by, at, { mine: true, now: 0 });
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
    // Ground, and the tiles drawn faintly on it for scale.
    g.fillStyle = '#4d6b3a';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = -14; i <= 14; i++) {
      const a0 = { x: cx - 0.5 + i, y: cy - 14.5 }, a1 = { x: cx - 0.5 + i, y: cy + 14.5 };
      const b0 = { x: cx - 14.5, y: cy - 0.5 + i }, b1 = { x: cx + 14.5, y: cy - 0.5 + i };
      g.moveTo(cam.worldToScreenX(a0.x, a0.y), cam.worldToScreenY(a0.x, a0.y, 0));
      g.lineTo(cam.worldToScreenX(a1.x, a1.y), cam.worldToScreenY(a1.x, a1.y, 0));
      g.moveTo(cam.worldToScreenX(b0.x, b0.y), cam.worldToScreenY(b0.x, b0.y, 0));
      g.lineTo(cam.worldToScreenX(b1.x, b1.y), cam.worldToScreenY(b1.x, b1.y, 0));
    }
    g.stroke();
    stage.drawGroundAll(g);
    // Everything standing, the two bodies among the spell's own, nearest last.
    const casterAt = { sx: cam.worldToScreenX(cx, cy), sy: cam.worldToScreenY(cx, cy, 0) };
    const targetAt = { sx: cam.worldToScreenX(tx, ty), sy: cam.worldToScreenY(tx, ty, 0) };
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
    if (o.label !== false) {
      const phase = now < timing.secs * timing.release ? 'cast' : now < timing.secs ? 'release' : 'after';
      g.font = `${Math.max(11, Math.round(4 * zoom))}px monospace`;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(0, 0, W, Math.max(15, 5 * zoom));
      g.fillStyle = '#efe8d4';
      g.fillText(`${o.spell}  t=${now.toFixed(2)}s  ${phase}  f${facing}  ${want}`, 4, Math.max(12, 4 * zoom));
    }
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.strokeRect(0.5, 0.5, W - 1, H - 1);
    g.restore();
  }
  return sheet;
}
