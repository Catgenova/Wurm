/** requestAnimationFrame driven loop with a capped variable timestep. */
export class GameLoop {
  fps = 0;
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
