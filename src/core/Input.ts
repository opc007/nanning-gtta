/**
 * Keyboard and mouse state with edge detection. `isDown` is level-triggered;
 * `wasPressed` / `wasReleased` are edge-triggered and consumed once per frame
 * via `endFrame()`.
 *
 * Mouse look deltas accumulate only while the pointer is locked. Buttons use
 * synthetic codes `Mouse0` (left) and `Mouse2` (right).
 */
export class Input {
  private down = new Set<string>();
  private justPressed = new Set<string>();
  private justReleased = new Set<string>();
  private lookX = 0;
  private lookY = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.justPressed.add(e.code);
      if (HANDLED.has(e.code)) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => {
      if (!this.down.has(e.code)) return;
      this.down.delete(e.code);
      this.justReleased.add(e.code);
    });
    target.addEventListener('blur', () => this.down.clear());
    target.addEventListener('mousedown', (e) => {
      const code = `Mouse${e.button}`;
      this.down.add(code);
      this.justPressed.add(code);
      if (e.button === 2) e.preventDefault();
    });
    target.addEventListener('mouseup', (e) => {
      const code = `Mouse${e.button}`;
      if (this.down.delete(code)) this.justReleased.add(code);
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  wasReleased(code: string): boolean {
    return this.justReleased.has(code);
  }

  /** Returns -1, 0, or +1 from a pair of keys. */
  axis(negative: string[], positive: string[]): number {
    const neg = negative.some((c) => this.down.has(c)) ? 1 : 0;
    const pos = positive.some((c) => this.down.has(c)) ? 1 : 0;
    return pos - neg;
  }

  /** Radians of pointer-lock look since the last consume. */
  consumeLook(): { x: number; y: number } {
    const x = this.lookX * 0.0025;
    const y = this.lookY * 0.0025;
    this.lookX = 0;
    this.lookY = 0;
    return { x, y };
  }

  endFrame(): void {
    this.justPressed.clear();
    this.justReleased.clear();
  }
}

const HANDLED = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);
