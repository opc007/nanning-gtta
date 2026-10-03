/**
 * Fixed-timestep loop. Physics advances in constant `step` increments so the
 * simulation is stable and reproducible regardless of display refresh rate;
 * rendering happens once per animation frame. The accumulator is clamped to
 * avoid the "spiral of death" after a tab stall.
 *
 * `render` receives `alpha` — the fraction of the next step already
 * accumulated (0..1) — so visuals can interpolate between the previous and
 * current physics state and stay smooth when the frame rate doesn't divide
 * evenly into the step. It also gets the real `frameDt` for frame-rate-
 * independent camera smoothing.
 */
export class GameLoop {
  private readonly step: number;
  private readonly maxFrame: number;
  private accumulator = 0;
  lastFrameTime = 0;
  private last = 0;
  private running = false;
  private paused = false;

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: (alpha: number, frameDt: number) => void,
    stepHz = 60,
  ) {
    this.step = 1 / stepHz;
    this.maxFrame = this.step * 5;
  }

  start(now = performance.now()): void {
    this.running = true;
    this.last = now;
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
  }

  /** Freeze the simulation (e.g. a pause menu). Rendering continues so the
   * frozen scene stays visible behind the overlay; no sim time accumulates. */
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  isPaused(): boolean {
    return this.paused;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    let frameTime = (now - this.last) / 1000;
    this.last = now;
    // Exposed for the headless smoke test: a non-positive frameTime here is a
    // clock bug that silently freezes every exponential damper in the game.
    (this as unknown as { lastFrameTime: number }).lastFrameTime = frameTime;
    if (this.paused) {
      this.render(0, frameTime); // hold the current frame; advance no sim time
      requestAnimationFrame(this.frame);
      return;
    }
    // Clamp BOTH ends. A negative frameTime (a clock that steps backwards, a
    // tab restore, a start() whose timestamp predates the first rAF) reaches the
    // exponential dampers as a factor > 1, which amplifies instead of smoothing
    // and throws the camera to astronomical coordinates. Observed in headless
    // Chromium after a long synchronous build.
    if (!(frameTime > 0)) frameTime = 0;
    if (frameTime > this.maxFrame) frameTime = this.maxFrame;
    this.accumulator += frameTime;

    while (this.accumulator >= this.step) {
      this.update(this.step);
      this.accumulator -= this.step;
    }
    this.render(this.accumulator / this.step, frameTime);
    requestAnimationFrame(this.frame);
  };
}
