import { clamp } from './math';

/**
 * Gamepad support via the Web Gamepad API (see docs/research/gamepad-support.md).
 * The MAPPING is a pure function (`readGamepadIntent`) so it's node-unit-tested;
 * `GamepadInput` is thin browser glue that polls each frame and does edge
 * detection, mirroring the untested keyboard `Input`.
 */

export const STICK_DEADZONE = 0.12;
export const TRIGGER_DEADZONE = 0.06;

/** W3C "standard gamepad" button indices we use. */
export const GP = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, L3: 10, R3: 11, DU: 12, DD: 13, DL: 14, DR: 15,
} as const;

/**
 * Radial deadzone: treat (x,y) as a vector, ignore magnitude below `dz`, and
 * rescale `dz..1` → `0..1` so directional sensitivity stays uniform (no axis
 * bias, no drift). Pure.
 */
export function radialDeadzone(x: number, y: number, dz: number): { x: number; y: number } {
  const mag = Math.hypot(x, y);
  if (mag <= dz) return { x: 0, y: 0 };
  const scale = Math.min(1, (mag - dz) / (1 - dz)) / mag;
  return { x: x * scale, y: y * scale };
}

export interface GamepadIntent {
  steer: number; // left stick X (right +) — steering in a car, strafing on foot
  forward: number; // left stick Y mapped forward+ — walking on foot
  throttle: number; // RT − LT, analog — throttle/brake in a car ONLY
  /** Right stick, deadzoned, -1..1. Y is raw (down is +). */
  lookX: number;
  lookY: number;
  handbrake: boolean; // B, read while driving
  sprint: boolean; // LT held or L3
  jump: boolean; // A
  crouch: boolean; // B, read on foot
  attack: boolean; // X
  grab: boolean; // Y
  mount: boolean; // RB
  interact: boolean; // D-pad up
}

const trigger = (v: number | undefined): number => {
  const x = v ?? 0;
  return x > TRIGGER_DEADZONE ? x : 0;
};

/**
 * Map a standard gamepad's axes + button values to RAW intent channels. The
 * left stick X always steers; on FOOT the stick Y walks you; in a CAR the
 * triggers (RT−LT) drive throttle and the stick Y is ignored (a stick is for
 * aiming/steering, not the gas). The car-vs-foot choice is contextual and lives
 * in `Controls`, which knows the mode. Sticks use `axes` (up is −1, so
 * forward = −y); triggers are analog `button.value`. Pure.
 */
const down = (buttonValues: readonly number[], i: number): boolean => (buttonValues[i] ?? 0) > 0.5;

export function readGamepadIntent(axes: readonly number[], buttonValues: readonly number[]): GamepadIntent {
  const stick = radialDeadzone(axes[0] ?? 0, axes[1] ?? 0, STICK_DEADZONE);
  const look = radialDeadzone(axes[2] ?? 0, axes[3] ?? 0, STICK_DEADZONE);
  const throttle = trigger(buttonValues[GP.RT]) - trigger(buttonValues[GP.LT]);
  const lt = (buttonValues[GP.LT] ?? 0) > 0.5;
  return {
    steer: stick.x,
    forward: -stick.y || 0, // avoid -0 when the stick is centred
    throttle: clamp(throttle, -1, 1),
    lookX: look.x,
    lookY: look.y,
    handbrake: down(buttonValues, GP.B),
    sprint: lt || down(buttonValues, GP.L3),
    jump: down(buttonValues, GP.A),
    crouch: down(buttonValues, GP.B),
    attack: down(buttonValues, GP.X),
    grab: down(buttonValues, GP.Y),
    mount: down(buttonValues, GP.RB),
    interact: down(buttonValues, GP.DU),
  };
}

/**
 * Thin per-frame poller with button edge detection. Picks the first connected
 * `mapping === "standard"` pad fresh each frame (indices shift on connect/
 * disconnect). No-ops where the Gamepad API is absent. Not unit-tested (browser
 * glue) — the mapping above is the tested part.
 */
export class GamepadInput {
  private polledThisFrame = false;
  private intent: GamepadIntent | null = null;
  private down: boolean[] = [];
  private justPressed = new Set<number>();
  private justReleased = new Set<number>();

  private poll(): void {
    if (this.polledThisFrame) return;
    this.polledThisFrame = true;
    const pads =
      typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let gp: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected && p.mapping === 'standard') {
        gp = p;
        break;
      }
    }
    if (!gp) {
      this.intent = null;
      return;
    }
    this.intent = readGamepadIntent(gp.axes, gp.buttons.map((b) => b.value));
    for (let i = 0; i < gp.buttons.length; i++) {
      const pressed = gp.buttons[i].pressed;
      if (pressed && !this.down[i]) this.justPressed.add(i);
      if (!pressed && this.down[i]) this.justReleased.add(i);
      this.down[i] = pressed;
    }
  }

  /** Analog move, contextual: in a car the triggers drive the gas (stick steers
   * only); on foot the stick walks you. */
  move(onFoot: boolean): { x: number; y: number } {
    this.poll();
    if (!this.intent) return { x: 0, y: 0 };
    return { x: this.intent.steer, y: onFoot ? this.intent.forward : this.intent.throttle };
  }

  handbrake(): boolean {
    this.poll();
    return this.intent?.handbrake ?? false;
  }

  /** LT or L3. A is jump now, on foot and in a car. */
  sprint(_onFoot = false): boolean {
    this.poll();
    return this.intent?.sprint ?? false;
  }

  /** Right stick, deadzoned, -1..1. */
  look(): { x: number; y: number } {
    this.poll();
    if (!this.intent) return { x: 0, y: 0 };
    return { x: this.intent.lookX, y: this.intent.lookY };
  }

  /** Held state of a button this frame. */
  isDown(button: number): boolean {
    this.poll();
    return this.down[button] ?? false;
  }

  /** Edge-triggered: true the frame `button` transitions to pressed. */
  wasPressed(button: number): boolean {
    this.poll();
    return this.justPressed.has(button);
  }

  wasReleased(button: number): boolean {
    this.poll();
    return this.justReleased.has(button);
  }

  endFrame(): void {
    this.polledThisFrame = false;
    this.justPressed.clear();
    this.justReleased.clear();
  }
}
