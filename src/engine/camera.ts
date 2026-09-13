import { HEIGHT_SCALE, isoToWorld, isoX, isoY } from '../render/iso';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The camera lives in iso space: (cx, cy) is the iso point shown at the centre
 * of the viewport, `zoom` scales iso units to CSS pixels.
 */
export class Camera {
  cx = 0;
  cy = 0;
  zoom = 1;
  minZoom = 0.5;
  maxZoom = 3;
  /** When true the camera glides towards the focus target every frame. */
  follow = true;
  width = 1;
  height = 1;

  setViewport(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** Move the camera towards a world point. */
  focus(wx: number, wy: number, h: number, dt: number | null): void {
    const tx = isoX(wx, wy);
    const ty = isoY(wx, wy, h);
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
    return (isoX(wx, wy) - this.cx) * this.zoom + this.width / 2;
  }

  worldToScreenY(wx: number, wy: number, h: number): number {
    return (isoY(wx, wy, h) - this.cy) * this.zoom + this.height / 2;
  }

  screenToIso(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.width / 2) / this.zoom + this.cx, y: (sy - this.height / 2) / this.zoom + this.cy };
  }

  /** Screen point to world coordinates, assuming the ground there is at height `h`. */
  screenToWorld(sx: number, sy: number, h = 0): { x: number; y: number } {
    const iso = this.screenToIso(sx, sy);
    return isoToWorld(iso.x, iso.y, h);
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
