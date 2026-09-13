import { HEIGHT_SCALE, isoToWorld, isoX, isoY } from '../render/iso';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The camera lives in iso space: (cx, cy) is the iso point shown at the centre
 * of the viewport, `zoom` scales iso units to CSS pixels.
 *
 * `rotation` turns the view in quarter turns. World coordinates are rotated
 * about the origin into "view space" (u, v) before the iso projection, so the
 * renderer can keep drawing axis-aligned diamonds whichever way you look.
 */
export class Camera {
  cx = 0;
  cy = 0;
  zoom = 1;
  /** Quarter turns, 0..3. */
  rotation = 0;
  minZoom = 0.35;
  maxZoom = 2.5;
  /** When true the camera glides towards the focus target every frame. */
  follow = true;
  width = 1;
  height = 1;

  setViewport(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** World x/y (point or vector) to view-space u. */
  rotateX(x: number, y: number): number {
    switch (this.rotation) {
      case 1:
        return y;
      case 2:
        return -x;
      case 3:
        return -y;
      default:
        return x;
    }
  }

  /** World x/y (point or vector) to view-space v. */
  rotateY(x: number, y: number): number {
    switch (this.rotation) {
      case 1:
        return -x;
      case 2:
        return -y;
      case 3:
        return x;
      default:
        return y;
    }
  }

  /** View-space u/v back to world x. */
  unrotateX(u: number, v: number): number {
    switch (this.rotation) {
      case 1:
        return -v;
      case 2:
        return -u;
      case 3:
        return v;
      default:
        return u;
    }
  }

  /** View-space u/v back to world y. */
  unrotateY(u: number, v: number): number {
    switch (this.rotation) {
      case 1:
        return u;
      case 2:
        return -v;
      case 3:
        return -u;
      default:
        return v;
    }
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

  /** View-space point to screen, skipping the rotation. */
  viewToScreenX(u: number, v: number): number {
    return (isoX(u, v) - this.cx) * this.zoom + this.width / 2;
  }

  viewToScreenY(u: number, v: number, h: number): number {
    return (isoY(u, v, h) - this.cy) * this.zoom + this.height / 2;
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

  /** Turn the view a quarter turn (+1 or -1) about the world point currently under the screen centre. */
  turn(step: number, heightAt: (x: number, y: number) => number): void {
    const cx = this.width / 2;
    const cy = this.height / 2;
    let p = this.screenToWorld(cx, cy, 0);
    for (let i = 0; i < 3; i++) p = this.screenToWorld(cx, cy, heightAt(p.x, p.y));
    const h = heightAt(p.x, p.y);
    this.rotation = (((this.rotation + step) % 4) + 4) % 4;
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
