import { HEIGHT_SCALE, isoToWorld, isoX, isoY } from '../render/iso';
import { TURNS, VIEWS, type View } from '../render/view';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The camera lives in iso space: (cx, cy) is the iso point shown at the centre
 * of the viewport, `zoom` scales iso units to CSS pixels.
 *
 * `rotation` turns the view an eighth of the way round at a time. World
 * coordinates are rotated about the origin into "view space" (u, v) before the
 * iso projection, so the renderer can keep drawing one fixed tile shape
 * whichever way you are looking.
 *
 * Every point drawn on the screen goes through `rotateX` and `rotateY`, so the
 * angle is kept to hand as a cosine and a sine rather than looked up each
 * time; setting `rotation` is what keeps them honest.
 */
export class Camera {
  cx = 0;
  cy = 0;
  zoom = 1;
  private turns = 0;
  private cos = 1;
  private sin = 0;
  minZoom = 0.35;
  /**
   * How far in you may go. Asked for: five.
   *
   * The ground costs nothing to zoom — it is drawn as polygons and gets
   * sharper. What has a resolution is the sprites: a tree or a body is a
   * little pre-rendered canvas, and `SPRITE_SCALE` says how many pixels it
   * holds per pixel at zoom 1. Past that it is being blown up, so the ceiling
   * here and that number are one decision in two places, which is why the
   * renderer reads this one to pick the other.
   */
  maxZoom = 5;
  /** When true the camera glides towards the focus target every frame. */
  follow = true;
  width = 1;
  height = 1;

  setViewport(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** Which of the eight viewpoints, 0..7, each an eighth of a turn on from the last. */
  get rotation(): number {
    return this.turns;
  }

  set rotation(r: number) {
    this.turns = ((r % TURNS) + TURNS) % TURNS;
    this.cos = VIEWS[this.turns].cos;
    this.sin = VIEWS[this.turns].sin;
  }

  /** Everything the renderer needs to walk the ground from where it is standing. */
  get view(): View {
    return VIEWS[this.turns];
  }

  /** World x/y (point or vector) to view-space u. */
  rotateX(x: number, y: number): number {
    return x * this.cos + y * this.sin;
  }

  /** World x/y (point or vector) to view-space v. */
  rotateY(x: number, y: number): number {
    return y * this.cos - x * this.sin;
  }

  /**
   * Which side of a line the camera is on, as +1 or -1 along the vector given.
   *
   * Everything further down the screen is nearer in this projection, and a
   * step by a world vector moves down the screen by `u + v` — so the sign of
   * that is the side facing us. A wall is a box with a face on each side of
   * its border and this is what picks the one that can be seen; get it wrong
   * and every wall on the island is drawn on the far side of its own line.
   */
  nearSide(dx: number, dy: number): 1 | -1 {
    return this.rotateX(dx, dy) + this.rotateY(dx, dy) >= 0 ? 1 : -1;
  }

  /** View-space u/v back to world x. */
  unrotateX(u: number, v: number): number {
    return u * this.cos - v * this.sin;
  }

  /** View-space u/v back to world y. */
  unrotateY(u: number, v: number): number {
    return u * this.sin + v * this.cos;
  }

  /** Move the camera towards a world point. */
  focus(wx: number, wy: number, h: number, dt: number | null): void {
    const u = this.rotateX(wx, wy);
    const v = this.rotateY(wx, wy);
    const tx = isoX(u, v);
    const ty = isoY(u, v, h);
    if (dt === null) {
      this.cx = tx;
      this.cy = ty;
      return;
    }
    const k = 1 - Math.exp(-dt * 9);
    this.cx += (tx - this.cx) * k;
    this.cy += (ty - this.cy) * k;
  }

  worldToScreenX(wx: number, wy: number): number {
    return (isoX(this.rotateX(wx, wy), this.rotateY(wx, wy)) - this.cx) * this.zoom + this.width / 2;
  }

  worldToScreenY(wx: number, wy: number, h: number): number {
    return (isoY(this.rotateX(wx, wy), this.rotateY(wx, wy), h) - this.cy) * this.zoom + this.height / 2;
  }

  screenToIso(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.width / 2) / this.zoom + this.cx, y: (sy - this.height / 2) / this.zoom + this.cy };
  }

  /** Screen point to world coordinates, assuming the ground there is at height `h`. */
  screenToWorld(sx: number, sy: number, h = 0): { x: number; y: number } {
    const iso = this.screenToIso(sx, sy);
    const view = isoToWorld(iso.x, iso.y, h);
    return { x: this.unrotateX(view.x, view.y), y: this.unrotateY(view.x, view.y) };
  }

  /** Turn the view an eighth (+1 or -1) about the world point currently under the screen centre. */
  turn(step: number, heightAt: (x: number, y: number) => number): void {
    const cx = this.width / 2;
    const cy = this.height / 2;
    let p = this.screenToWorld(cx, cy, 0);
    for (let i = 0; i < 3; i++) p = this.screenToWorld(cx, cy, heightAt(p.x, p.y));
    const h = heightAt(p.x, p.y);
    this.rotation = this.turns + step;
    this.focus(p.x, p.y, h, null);
  }

  /** Screen-space angle (degrees, clockwise from up) in which world north lies. */
  northAngle(): number {
    const u = this.rotateX(0, -1);
    const v = this.rotateY(0, -1);
    return (Math.atan2(u + v, u - v) * 180) / Math.PI + 90;
  }

  panBy(dx: number, dy: number): void {
    this.cx -= dx / this.zoom;
    this.cy -= dy / this.zoom;
    this.follow = false;
  }

  /** Zoom keeping the iso point under (sx, sy) fixed on screen. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToIso(sx, sy);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const after = this.screenToIso(sx, sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  /** Visible iso-space rectangle. */
  isoBounds(): { left: number; right: number; top: number; bottom: number } {
    const hw = this.width / 2 / this.zoom;
    const hh = this.height / 2 / this.zoom;
    return { left: this.cx - hw, right: this.cx + hw, top: this.cy - hh, bottom: this.cy + hh };
  }

  /** How many iso-space pixels one height unit lifts a point. */
  get heightScale(): number {
    return HEIGHT_SCALE;
  }
}
