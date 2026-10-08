/** requestAnimationFrame driven loop with a capped variable timestep. */
export class GameLoop {
  fps = 0;
  /**
   * The most frames a second to draw, or none for as many as the screen
   * refreshes. A screen refreshing at 144 draws everything 144 times a second
   * otherwise, which is two and a half times the work of 60 for a picture
   * nobody can tell apart from it.
   */
  maxFps = 0;
  /** When the next frame is due, and how far apart the screen's refreshes come. */
  private due = 0;
  private lastTick = 0;
  private refresh = 1000 / 60;
  private running = false;
  private last = 0;
  private raf = 0;
  private frames = 0;
  private fpsClock = 0;

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: (dt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const gap = now - this.lastTick;
    this.lastTick = now;
    if (gap > 0 && gap < 100) this.refresh += (gap - this.refresh) * 0.1;
    if (this.maxFps > 0) {
      const every = 1000 / this.maxFps;
      // Up to half a refresh early, or a cap that does not divide the refresh rate comes out well under itself.
      if (now < this.due - this.refresh / 2) {
        this.raf = requestAnimationFrame(this.tick);
        return;
      }
      this.due = (this.due > now - every ? this.due : now) + every;
    }
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.update(dt);
    this.render(dt);
    this.frames++;
    this.fpsClock += dt;
    if (this.fpsClock >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsClock);
      this.frames = 0;
      this.fpsClock = 0;
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
