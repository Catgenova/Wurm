import type { Game } from '../../game/game';
import type { Island, TreasureMap } from '../../net/island';
import { TILE_DEFS, TileType, type TileDef } from '../../world/tiles';
import { waterRgb } from '../../render/water';
import { MAP_SNIPPET, TREASURE_TIERS, hoardOf, warmthOf } from '../../game/treasure';
import { ACTION_BY_ID } from '../../game/actions';
import type { UIWindow } from '../windows';

/** How often the warm line asks again while the map is open. */
const REFRESH = 1.5;

/** How wide the drawn square is, whatever the snippet's side. */
const VIEW = 384;

/**
 * The picture on a treasure map.
 *
 * Painted with the minimap's own palette, contours and water ramp, and that is
 * the point rather than a saving: the only way to find the place is to
 * recognise it, so the picture has to be drawn the way the ground is drawn
 * everywhere else. A map in a different set of colours would be a puzzle about
 * the colours.
 *
 * What it is *not* given is where any of it is. `rpc_treasure_map` answers
 * tiles and corner heights and nothing else — no origin, no bearing, no pin —
 * and the warm line under it is a band rather than a distance. Everything
 * needed to draw this is here; everything needed to skip the hunt is not.
 */
export class HoardPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly caption: HTMLDivElement;
  private readonly warm: HTMLDivElement;
  private readonly dig: HTMLButtonElement;
  private uid = 0;
  private shown: TreasureMap | null = null;
  private asking = false;
  private lastAsk = -1e9;
  private here = false;

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly island: Island | null,
  ) {
    const page = document.createElement('div');
    page.className = 'hoard-page';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hoard-view';
    this.canvas.width = VIEW;
    this.canvas.height = VIEW;
    this.caption = document.createElement('div');
    this.caption.className = 'hoard-caption';
    this.warm = document.createElement('div');
    this.warm.className = 'hoard-warm';
    this.dig = document.createElement('button');
    this.dig.className = 'hoard-dig';
    this.dig.textContent = 'Dig it up';
    this.dig.addEventListener('click', () => {
      const def = ACTION_BY_ID.get('unearth');
      if (def) this.game.requestAction(def, { kind: 'item', uid: this.uid });
    });
    page.append(this.canvas, this.caption, this.warm, this.dig);
    this.win.body.append(page);
  }

  /** Open it on one map in the pack. */
  openOn(uid: number): void {
    this.uid = uid;
    this.shown = null;
    this.lastAsk = -1e9;
    this.win.open();
    void this.ask();
  }

  /**
   * The picture, from whichever side of the wire knows it.
   *
   * On an island the island draws it, because the island is the only thing
   * that knows where to draw it from. In a game with no island under it the
   * world is right here, so it is read straight off the save — which hides
   * nothing and never did: a single-player island is the player's own machine.
   */
  private async ask(): Promise<void> {
    if (this.asking) return;
    this.asking = true;
    try {
      if (this.island) {
        const got = await this.island.treasureMap(this.uid);
        if (got && !got.why) this.shown = got;
        const warm = await this.island.treasureWarm(this.uid);
        if (warm) {
          this.here = warm.here;
          this.warm.textContent = warm.say;
        }
      } else {
        const h = hoardOf(this.game, this.uid);
        const map = this.game.inventory.get(this.uid);
        if (h && map) {
          this.shown = this.localMap(h.x, h.y, map.ql, h.tier);
          const warm = warmthOf(this.game, h);
          this.here = warm.here;
          this.warm.textContent = warm.say;
        }
      }
    } finally {
      this.asking = false;
    }
    this.paint();
  }

  /** The same square the island would have cut, cut here. */
  private localMap(hx: number, hy: number, ql: number, tier: string): TreasureMap {
    const n = MAP_SNIPPET;
    const w = this.game.world;
    const x0 = hx - (n >> 1);
    const y0 = hy - (n >> 1);
    const tiles: number[] = [];
    const heights: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = x0 + i;
        const y = y0 + j;
        tiles.push(x < 0 || y < 0 || x >= w.w || y >= w.h ? -1 : w.getTile(x, y));
      }
    }
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = x0 + i;
        const y = y0 + j;
        heights.push(x < 0 || y < 0 || x > w.w || y > w.h ? -1000 : w.getHeight(x, y));
      }
    }
    return { side: n, tier, ql, tiles, heights };
  }

  update(now: number): void {
    if (!this.win.isOpen || !this.uid) return;
    if (now - this.lastAsk < REFRESH) return;
    this.lastAsk = now;
    void this.ask();
  }

  private paint(): void {
    const m = this.shown;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, VIEW, VIEW);
    if (!m) {
      this.caption.textContent = 'The hide is worn blank.';
      this.dig.style.display = 'none';
      return;
    }
    const n = m.side;
    const cw = n + 1;
    const px = VIEW / n;
    const corner = (i: number, j: number): number => m.heights[j * cw + i] ?? -1000;
    const centre = (i: number, j: number): number =>
      (corner(i, j) + corner(i + 1, j) + corner(i + 1, j + 1) + corner(i, j + 1)) / 4;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const t = m.tiles[j * n + i];
        const h = centre(i, j);
        let r: number;
        let g: number;
        let b: number;
        if (t < 0 || h <= -900) {
          // Off the end of the island, which on a coastal hoard is half the
          // picture and is worth drawing: it is the best landmark there is.
          [r, g, b] = waterRgb(30);
        } else if (h < 0) {
          [r, g, b] = waterRgb(Math.max(0, -h));
        } else {
          const def: TileDef = (TILE_DEFS as Record<number, TileDef>)[t] ?? TILE_DEFS[TileType.Grass];
          [r, g, b] = def.color;
          const slope = corner(i + 1, j + 1) - corner(i, j);
          const shade = 0.9 + Math.max(-0.35, Math.min(0.25, -slope / 60));
          r *= shade; g *= shade; b *= shade;
          // The same contour banding the minimap draws, at the same step, so
          // the two pictures can be held up against one another.
          const band = Math.floor(h / 20);
          if (band !== Math.floor(centre(i + 1, j) / 20) || band !== Math.floor(centre(i, j + 1) / 20)) {
            const hard = band % 5 === 0 ? 0.55 : 0.74;
            r *= hard; g *= hard; b *= hard;
          }
        }
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        ctx.fillRect(i * px, j * px, Math.ceil(px), Math.ceil(px));
      }
    }
    /*
     * A cross at the middle, which gives nothing away: the hoard is always at
     * the middle of its own picture. What the cross says is "this spot in this
     * picture", and the picture is all anybody has.
     */
    const mid = VIEW / 2;
    ctx.strokeStyle = 'rgba(20,16,12,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(mid - 9, mid - 9); ctx.lineTo(mid + 9, mid + 9);
    ctx.moveTo(mid + 9, mid - 9); ctx.lineTo(mid - 9, mid + 9);
    ctx.stroke();

    const tier = TREASURE_TIERS.find((k) => k.id === m.tier);
    this.caption.textContent = `A ${tier?.name ?? 'map'}, quality ${m.ql.toFixed(0)} — `
      + `${n} tiles of country with the hoard at the cross.`
      + (tier ? ` Something like ${tier.guards > 1 ? `${tier.guards} ` : 'a '}${tier.guard} will be over it.` : '');
    this.dig.style.display = this.here ? '' : 'none';
  }
}
